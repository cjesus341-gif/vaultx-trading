// EDITH v0.2 — paper-only forward engine. Never imports or calls a trade endpoint.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {edithSignal,EDITH_STRATEGIES} from './edith-paper-lab.mjs';
export const EDITH_MARKETS=['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD','LTC-USD'];
export const EDITH_RATIOS=[1.5,2,3,5,10];
const START_CAPITAL=1000, RISK_FRACTION=.005, MAX_NOTIONAL=100, FEE=.009, SLIP=.001, STOP_MULT=1.25, BAR_MS=300000;
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=n=>Number.isFinite(Number(n));
const variantKey=(s,r)=>`${s}@${r}:1`;
const variants=()=>Object.fromEntries(EDITH_STRATEGIES.flatMap(s=>EDITH_RATIOS.map(r=>[variantKey(s,r),{
 strategy:s,rewardRisk:r,cash:START_CAPITAL,realizedUsd:0,peakEquity:START_CAPITAL,maxDrawdownUsd:0,
 completed:0,wins:0,grossProfits:0,grossLosses:0,feesUsd:0,pending:null,position:null,trades:[]
}])));
function validCandle(c){return finite(c.open)&&finite(c.high)&&finite(c.low)&&finite(c.close)&&finite(c.volume)&&Number(c.low)>0&&Number(c.open)>0&&Number(c.high)>=Math.max(Number(c.open),Number(c.close))&&Number(c.low)<=Math.min(Number(c.open),Number(c.close))&&Number(c.volume)>=0&&finite(Date.parse(c.time));}
function normalize(c){return {time:String(c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume)};}
export function createEdithForward({filePath,now=Date.now}={}){
 let state=null,busy=null;
 async function init(){
  if(state)return;
  if(!filePath)throw Error('EDITH requires persistent DATA_DIR');
  try{
   const doc=JSON.parse(await readFile(filePath,'utf8'));
   if(doc.schema!==1||!doc.variants||!doc.watermarks||typeof doc.enabled!=='boolean'||!Array.isArray(doc.trades))throw Error('Invalid EDITH journal');
   const expected=variants();let upgraded=false;
   // V36 already deployed? Keep existing fills, open paper positions, and watermarks.
   // Only add the new 5:1 and 10:1 experiments; do not backfill prior candles.
   for(const [k,initial] of Object.entries(expected)){
    if(!doc.variants[k]){
     if(!EDITH_RATIOS.slice(-2).includes(initial.rewardRisk))throw Error('Missing EDITH base strategy: '+k);
     doc.variants[k]=initial;upgraded=true;
    }else if(!finite(doc.variants[k].cash))throw Error('Invalid EDITH strategy: '+k);
   }
   state=doc;
   if(upgraded)await persist();
  }catch(e){
   if(e.code!=='ENOENT')throw Error('EDITH journal invalid — paused; '+e.message);
   state={schema:1,enabled:true,watermarks:{},variants:variants(),trades:[],createdAt:new Date(now()).toISOString(),lastRun:null,lastError:null,scanCount:0};await persist();
  }
 }
 async function persist(){await mkdir(path.dirname(filePath),{recursive:true});const tmp=filePath+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,filePath);}
 function summary(){if(!state)return {initialized:false,paperOnly:true,canTradeRealMoney:false};
  const ranked=Object.entries(state.variants).map(([name,v])=>({name,strategy:v.strategy,targetToStopRatio:v.rewardRisk,
   netPnlUsd:v.realizedUsd,returnPct:100*v.realizedUsd/START_CAPITAL,winRate:v.completed?v.wins/v.completed:null,
   profitFactor:v.grossLosses>0?v.grossProfits/v.grossLosses:null,maxDrawdownUsd:v.maxDrawdownUsd,
   trades:v.completed,openPosition:v.position?{market:v.position.market,side:v.position.side,entry:v.position.entry,stop:v.position.stop,target:v.position.target}:null,
   pendingSignal:v.pending?{market:v.pending.market,side:v.pending.side}:null,feesUsd:v.feesUsd}));
  ranked.sort((a,b)=>b.netPnlUsd-a.netPnlUsd);
  return {initialized:true,paperOnly:true,canTradeRealMoney:false,enabled:state.enabled,lastRun:state.lastRun,
   scanCount:state.scanCount,lastError:state.lastError,markets:EDITH_MARKETS,ratios:EDITH_RATIOS,
   assumptions:{startingCapitalUsd:START_CAPITAL,riskFraction:RISK_FRACTION,maxNotionalUsd:MAX_NOTIONAL,feeRatePerSide:FEE,slippagePerSide:SLIP,stopAtrMultiplier:STOP_MULT},
   strategies:ranked,recentTrades:state.trades.slice(-25).reverse(),
   limitations:'Forward paper estimates, not live orders. Short trades are simulated. OHLC cannot determine intrabar order; stop wins ties. No borrow/funding, liquidity or true order-book fills. Ranking alone never authorizes live trading.'};
 }
 function closeTrade(v,bar){
  const p=v.position;if(!p)return;
  const stopped=p.side==='LONG'?bar.low<=p.stop:bar.high>=p.stop;
  const targeted=p.side==='LONG'?bar.high>=p.target:bar.low<=p.target;
  if(!stopped&&!targeted)return;
  const raw=stopped?p.stop:p.target;
  const exit=raw*(p.side==='LONG'?1-SLIP:1+SLIP);
  const gross=(p.side==='LONG'?exit-p.entry:p.entry-exit)*p.qty;
  const exitFee=exit*p.qty*FEE,net=gross-p.entryFee-exitFee;
  v.cash+=net;v.realizedUsd+=net;v.completed++;v.wins+=net>0?1:0;v.grossProfits+=Math.max(0,net);v.grossLosses+=Math.max(0,-net);v.feesUsd+=exitFee;
  v.peakEquity=Math.max(v.peakEquity,v.cash);v.maxDrawdownUsd=Math.max(v.maxDrawdownUsd,v.peakEquity-v.cash);
  const trade={variant:variantKey(v.strategy,v.rewardRisk),strategy:v.strategy,rewardRisk:v.rewardRisk,market:p.market,
   side:p.side,signalTime:p.signalTime,entryTime:p.entryTime,exitTime:bar.time,entry:p.entry,exit,
   stop:p.stop,target:p.target,quantity:p.qty,notionalUsd:p.entry*p.qty,feesUsd:p.entryFee+exitFee,netPnlUsd:net,
   outcome:stopped?'stop':'target'};
  v.trades.push(trade);if(v.trades.length>150)v.trades.shift();state.trades.push(trade);if(state.trades.length>500)state.trades.shift();v.position=null;
 }
 function fillPending(v,market,bar){
  const p=v.pending;if(!p||p.market!==market||!(Date.parse(bar.time)>Date.parse(p.signalTime)))return;
  v.pending=null;
  const entry=bar.open*(p.side==='LONG'?1+SLIP:1-SLIP),stopDistance=p.avgRange*STOP_MULT;
  if(!(stopDistance>0&&entry>stopDistance&&entry>0))return;
  const stop=p.side==='LONG'?entry-stopDistance:entry+stopDistance;
  const target=p.side==='LONG'?entry+stopDistance*v.rewardRisk:entry-stopDistance*v.rewardRisk;
  if(!(target>0))return;
  const riskDollars=Math.max(0,START_CAPITAL+v.realizedUsd)*RISK_FRACTION;
  const qty=Math.min(MAX_NOTIONAL/entry,riskDollars/(stopDistance+entry*FEE*2+entry*SLIP*2));
  if(!(qty>0))return;
  const entryFee=qty*entry*FEE;
  v.feesUsd+=entryFee;v.position={market,side:p.side,signalTime:p.signalTime,entryTime:bar.time,entry,stop,target,qty,entryFee};
  // Exit simulation is allowed on the entry bar; adverse stop takes precedence.
  closeTrade(v,bar);
 }
 function processMarket(market,raw){
  if(!EDITH_MARKETS.includes(market))throw Error('Unknown EDITH market');
  if(!Array.isArray(raw)||raw.length<70)throw Error('Insufficient completed candles for '+market);
  const candles=raw.map(normalize).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(candles.some(x=>!validCandle(x)))throw Error('Invalid candle for '+market);
  for(let i=1;i<candles.length;i++)if(Date.parse(candles[i].time)<=Date.parse(candles[i-1].time))throw Error('Duplicate candle '+market);
  const latest=candles.at(-1),last=state.watermarks[market];
  if(!last){state.watermarks[market]=latest.time;return;} // First read only establishes forward baseline.
  const unseen=candles.filter(x=>Date.parse(x.time)>Date.parse(last));
  if(!unseen.length)return;
  // Never assume fills on candles that the server missed, or backfill without complete context.
  if(Date.parse(unseen[0].time)-Date.parse(last)!==BAR_MS||unseen.some((c,i)=>i>0&&Date.parse(c.time)-Date.parse(unseen[i-1].time)!==BAR_MS))throw Error('EDITH gap on '+market+' — paper entries paused for reconciliation');
  for(const bar of unseen){
   const i=candles.findIndex(c=>c.time===bar.time);
   if(i<36)continue;
   for(const v of Object.values(state.variants)){
    if(v.pending?.market===market)fillPending(v,market,bar);
    if(v.position?.market===market&&v.position.entryTime!==bar.time)closeTrade(v,bar);
    if(v.pending||v.position)continue; // One global position per variant, across all nine markets.
    const prior=i-1,signal=edithSignal(candles,prior,v.strategy);
    if(!signal)continue;
    const avgRange=candles.slice(prior-13,prior+1).reduce((s,c)=>s+c.high-c.low,0)/14;
    if(!(avgRange>0))continue;
    // Signal at prior candle close, entry at next bar open. No lookahead.
    v.pending={market,side:signal,signalTime:candles[prior].time,avgRange};
    fillPending(v,market,bar);
   }
   state.watermarks[market]=bar.time;
  }
 }
 async function tick(getCandles){
  if(busy)return busy;
  busy=(async()=>{
   await init();if(!state.enabled)return summary();
   const batches={};
   try{
    // Fetch and validate ALL markets before applying any mutations.
    for(const m of EDITH_MARKETS){const c=await getCandles(m);if(!Array.isArray(c)||c.length<70)throw Error('Missing '+m+' data');batches[m]=c;}
    // Changes are atomic on disk; failed/gapped scans do not save partial updates.
    const backup=clone(state);
    try{for(const m of EDITH_MARKETS)processMarket(m,batches[m]);state.lastError=null;state.lastRun=new Date(now()).toISOString();state.scanCount++;await persist();}
    catch(e){state=backup;state.lastError=String(e.message).slice(0,180);await persist();}
   }catch(e){state.lastError=String(e.message).slice(0,180);await persist();}
   return summary();
  })();try{return await busy;}finally{busy=null;}
 }
 return {init,tick,status:async()=>{await init();return summary();}};
}
