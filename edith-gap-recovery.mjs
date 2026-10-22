// EDITH paper-only historical candle continuity verification.
// Uses exclusively candle timestamps and OHLC after the recorded paper entry.
export const FIVE_MINUTES_MS=300000;
export function verifyCandleCoverage(raw, fromExclusive, untilInclusive, barMs=FIVE_MINUTES_MS){
 const a=Date.parse(fromExclusive), b=Date.parse(untilInclusive);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||((b-a)%barMs)!==0)
  return {ok:false,reason:'Invalid recovery time range',bars:[]};
 const sorted=(Array.isArray(raw)?raw:[]).map(x=>({...x,time:String(x.time),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)}))
  .filter(x=>Date.parse(x.time)>a&&Date.parse(x.time)<=b)
  .sort((x,y)=>Date.parse(x.time)-Date.parse(y.time));
 const required=(b-a)/barMs;
 if(sorted.length!==required)return {ok:false,reason:`Expected ${required} complete candles, received ${sorted.length}; keep trade quarantined`,bars:[]};
 for(let i=0;i<sorted.length;i++){
  const c=sorted[i],t=Date.parse(c.time);
  if(t!==a+(i+1)*barMs||!Number.isFinite(c.open)||!Number.isFinite(c.high)||!Number.isFinite(c.low)||!Number.isFinite(c.close)||!Number.isFinite(c.volume)||c.low<=0||c.open<=0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.volume<0)
   return {ok:false,reason:'Missing, duplicated or invalid candle in recovery interval',bars:[]};
 }
 return {ok:true,reason:null,bars:sorted};
}
