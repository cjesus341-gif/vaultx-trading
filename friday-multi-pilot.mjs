// Strict multi-market Coinbase preparation. No submission occurs here.
import {DEFAULT_WATCHLIST} from './friday-market-selector.mjs';
const n=x=>Number(x);
const endStates=new Set(['FILLED','CANCELLED','EXPIRED','FAILED','REJECTED']);
function fixedUnits(units,increment){
  const step=String(increment);
  if(!/^\d+(?:\.\d+)?$/.test(step)||n(step)<=0)throw Error('Invalid Coinbase base increment');
  const dp=(step.split('.')[1]||'').length;
  if(dp>12)throw Error('Excessive base precision');
  const factor=10**dp,stepUnits=Math.round(n(step)*factor);
  if(stepUnits<1||Math.abs(stepUnits/factor-n(step))>1e-12)throw Error('Invalid base step');
  const whole=Math.floor((units*factor+1e-7)/stepUnits)*stepUnits;
  return (whole/factor).toFixed(dp);
}
export function qualifyMultiSignal(selected){
  if(!selected||!DEFAULT_WATCHLIST.includes(selected.productId))return null;
  const s=selected.signal;
  if(!s||s.qualified!==true||s.side!=='LONG'||!s.closedAt||!(n(s.stop)>0&&n(s.target)>n(s.stop)))return null;
  return {...s,productId:selected.productId};
}
export async function prepareMultiPilot({signal,readProduct,readInventory,preview,settings,usdAvailable,maxOrderUsd=2.5,now=Date.now()}={}){
  const reject=reason=>({ok:false,reason});
  try{
    const s=qualifyMultiSignal({productId:signal?.productId,signal});if(!s)return reject('Market/qualified LONG missing');
    if(typeof readProduct!=='function'||typeof readInventory!=='function'||typeof preview!=='function')return reject('Exchange verification unavailable');
    const inv=await readInventory();
    if(!inv||inv.complete!==true||inv.accountsComplete!==true)return reject('Full scoped account and order inventory incomplete');
    if(!Array.isArray(inv.orders)||!Array.isArray(inv.accounts))return reject('Invalid scoped inventory');
    const today=new Date(now).toISOString().slice(0,10);
    if(inv.orders.some(o=>!endStates.has(String(o.status||'').toUpperCase())))return reject('Existing unresolved crypto order');
    if(inv.orders.some(o=>String(o.createdTime||'').startsWith(today)))return reject('Earlier watched-market order today');
    if(inv.accounts.some(a=>!Number.isFinite(n(a.available))||!Number.isFinite(n(a.hold))||n(a.available)<0||n(a.hold)<0))return reject('Invalid account balances');
    const assets=new Set(DEFAULT_WATCHLIST.map(id=>id.split('-')[0]));
    if(inv.accounts.some(a=>assets.has(a.currency)&&n(a.available)+n(a.hold)>1e-10))return reject('Existing watched-asset position');
    const usd=inv.accounts.filter(a=>a.currency==='USD').reduce((sum,a)=>sum+n(a.available),0);
    if(!Number.isFinite(usd)||usd<2||Math.abs(usd-n(usdAvailable))>1)return reject('USD balance invalid or changed');
    const raw=await readProduct(s.productId),p=raw?.product||raw;
    if(p?.product_id!==s.productId||p?.trading_disabled||p?.is_disabled||p?.cancel_only)return reject('Product unavailable or restricted');
    const mid=n(p.price),signalPrice=n(s.price),stop=n(s.stop),target=n(s.target);
    if(!(mid>0&&signalPrice>0&&stop>0&&stop<mid&&target>mid)||Math.abs(mid/signalPrice-1)>0.003)return reject('Invalid protection or market drift');
    const priceStep=n(p.quote_increment);
    if(!(priceStep>0))return reject('Coinbase quote price increment missing');
    const dec=Math.min(10,(String(p.quote_increment).split('.')[1]||'').length);
    const entry=Math.ceil((mid+1e-12)/priceStep)*priceStep;
    const entryText=entry.toFixed(dec);
    const stopText=(Math.floor((stop+1e-12)/priceStep)*priceStep).toFixed(dec);
    const targetText=(Math.ceil((target-1e-12)/priceStep)*priceStep).toFixed(dec);
    if(!(n(stopText)>0&&n(stopText)<n(entryText)&&n(targetText)>n(entryText)))return reject('Exchange-precision protection invalid');
    const pct=Math.min(.5,n(settings?.riskPct)||.5);
    const budget=usd*pct/100;
    const riskRatio=(n(entryText)-n(stopText))/n(entryText);
    const allocation=Math.min(2.5,maxOrderUsd,usd-.5,budget/(riskRatio+.021));
    const baseSize=fixedUnits(allocation/n(entryText),p.base_increment),amount=n(baseSize)*n(entryText);
    if(!(n(baseSize)>=n(p.base_min_size)&&amount>=Math.max(1,n(p.quote_min_size))&&amount<=2.5&&amount<=maxOrderUsd))return reject('Coinbase minimum or $2.50 cap blocks position');
    const body={product_id:s.productId,side:'BUY',order_configuration:{limit_limit_gtc:{base_size:baseSize,limit_price:entryText,post_only:false}},attached_order_configuration:{trigger_bracket_gtc:{base_size:baseSize,limit_price:targetText,stop_trigger_price:stopText}}};
    const q=await preview(body);
    if(!q?.preview_id||q.success===false||(Array.isArray(q.errs)&&q.errs.length))return reject('Coinbase did not accept protective preview');
    const fee=n(q.commission_total);if(!Number.isFinite(fee)||fee<0)return reject('Actual preview commission unavailable');
    const risk=(n(entryText)-n(stopText))*n(baseSize)+fee*2+amount*.001;
    const reward=(n(targetText)-n(entryText))*n(baseSize)-fee*2-amount*.001;
    if(!(risk<=budget&&reward>=risk*1.5))return reject('Fee-adjusted risk/reward insufficient');
    return {ok:true,body,productId:s.productId,quantity:baseSize,entry:entryText,stop:stopText,target:targetText,risk};
  }catch(e){return reject('Market verification failed: '+String(e.message).slice(0,125));}
}
