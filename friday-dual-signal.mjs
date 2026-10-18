// V31 isolated multi-market LONG/SHORT observation engine. Read-only: no execution.
import {DEFAULT_WATCHLIST} from './friday-market-selector.mjs';
const finite=x=>Number.isFinite(Number(x));
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function ema(values,span){const alpha=2/(span+1);let v=mean(values.slice(0,span));for(const x of values.slice(span))v=alpha*x+(1-alpha)*v;return v;}
function rsi(values,period=14){let gains=0,losses=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];gains+=Math.max(0,d);losses+=Math.max(0,-d);}return losses===0?(gains===0?50:100):100-100/(1+gains/losses);}
function parseCandles(raw){
 const rows=Array.isArray(raw)?raw:(raw?.candles||[]);
 if(!Array.isArray(rows))throw Error('Candles unavailable');
 return rows.map(c=>({time:Number(c.start??c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume)}))
 .filter(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.time>0&&c.low>0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)&&c.volume>=0)
 .sort((a,b)=>a.time-b.time).filter((c,i,a)=>!i||c.time!==a[i-1].time);
}
export function assessDualSignal(raw,{productId,now=Date.now(),candleSeconds=300,minimumNetRR=1.25,feeRatePerSide=.01}={}){
 const base={productId,long:{qualified:false,reasons:[]},short:{qualified:false,reasons:[]},readOnly:true};
 if(!DEFAULT_WATCHLIST.includes(productId))return {...base,error:'Unsupported market'};
 const all=parseCandles(raw),closed=all.filter(c=>c.time*1000+candleSeconds*1000<=now);
 if(closed.length<45)return {...base,error:'Insufficient completed candles (45 needed)'};
 const a=closed.slice(-60),last=a.at(-1),previous=a.at(-2);
 if(now-(last.time+candleSeconds)*1000>candleSeconds*2*1000)return {...base,error:'Last completed candle is stale'};
 const closes=a.map(c=>c.close),v=a.map(c=>c.volume);
 const trs=a.slice(-15).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-(a[a.length-16+i]?.close??c.close)),Math.abs(c.low-(a[a.length-16+i]?.close??c.close))));
 const atr=mean(trs),fast=ema(closes,12),slow=ema(closes,26),momentum=rsi(closes),volumeRatio=mean(v.slice(-15,-1))>0?last.volume/mean(v.slice(-15,-1)):0;
 if(![atr,fast,slow,momentum,volumeRatio].every(Number.isFinite)||atr<=0)return {...base,error:'Invalid ATR/indicator data'};
 // One directional closing candle is required. Two of three supportive confirmations
 // (EMA, RSI and volume) are enough: modestly looser than the original all-pass rules.
 const decisions={};
 for(const side of ['LONG','SHORT']){
  const long=side==='LONG';
  const directional=long?last.close>last.open&&last.close>previous.close:last.close<last.open&&last.close<previous.close;
  const confirmations=[long?fast>slow:fast<slow,long?momentum>=48&&momentum<=76:momentum<=52&&momentum>=24,volumeRatio>=1.05];
  const count=confirmations.filter(Boolean).length;
  const entry=last.close,stop=long?entry-1.25*atr:entry+1.25*atr,target=long?entry+2.5*atr:entry-2.5*atr;
  const grossRisk=Math.abs(entry-stop)/entry,grossReward=Math.abs(target-entry)/entry;
  const netRisk=grossRisk+2*feeRatePerSide,netReward=grossReward-2*feeRatePerSide;
  const reasons=[];
  if(!directional)reasons.push('Directional candle not confirmed');
  if(count<2)reasons.push('Fewer than 2 of 3 EMA/RSI/volume confirmations');
  if(!(stop>0&&target>0))reasons.push('Protective prices invalid');
  const costViable=netReward>0&&netReward/netRisk>=minimumNetRR;
  // Paper technical qualification is independent of exchange fees. Execution must
  // separately enforce real preview fees and minimums before risking funds.
  decisions[side.toLowerCase()]={qualified:reasons.length===0,reasons,costViable,executionWarnings:costViable?[]:['Estimated fee-adjusted reward/risk too low; not live trade-ready'],entry:Number(entry.toPrecision(9)),stop:Number(stop.toPrecision(9)),target:Number(target.toPrecision(9)),grossRR:2,estimatedNetRR:Number((netReward/netRisk).toFixed(2)),confirmations:count,directional};
 }
 return {...base,long:decisions.long,short:decisions.short,closedAt:new Date((last.time+candleSeconds)*1000).toISOString(),indicators:{ema12:fast,ema26:slow,rsi14:momentum,volumeRatio,atr14:atr},strategy:'Directional candle + any 2 of EMA/RSI/volume; 1.25 ATR stop, 2.5 ATR target; estimated 1% fee each side',paperOnly:true};
}
export async function scanDualMarkets({readCandles,markets=DEFAULT_WATCHLIST,now=Date.now()}={}){
 if(typeof readCandles!=='function')throw Error('Candle provider missing');
 const results=[];
 for(const productId of markets){
  if(!DEFAULT_WATCHLIST.includes(productId))throw Error('Market not allowed');
  try{results.push(assessDualSignal(await readCandles(productId),{productId,now}));}
  catch(e){results.push({productId,readOnly:true,error:String(e.message).slice(0,120),long:{qualified:false},short:{qualified:false}});}
 }
 const ranked=results.flatMap(r=>['long','short'].filter(side=>r[side]?.qualified).map(side=>({productId:r.productId,side:side.toUpperCase(),...r[side]})))
  .sort((a,b)=>b.estimatedNetRR-a.estimatedNetRR||a.productId.localeCompare(b.productId));
 return {readOnly:true,paperOnly:true,scannedAt:new Date(now).toISOString(),scanned:results.length,qualified:ranked.length,best:ranked[0]||null,ranked,results,disclaimer:'Paper LONG and SHORT signals only. Technical qualification does not imply fee-adjusted profitability or live order eligibility. No real short execution; Coinbase spot cannot open a borrowed short position.'};
}
