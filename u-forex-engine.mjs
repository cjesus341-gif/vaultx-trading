// U Forex research engine — deterministic, provider-independent, PAPER ONLY.
// All decisions use completed candles. Historical touch execution is conservative.
export const U_PAIRS=Object.freeze(['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/JPY','GBP/JPY','EUR/GBP']);
export const U_EXPERIMENTS=Object.freeze([
 {id:'A',name:'Original',lookback:10,rr:1,stopMode:'lookback'},
 {id:'B',name:'Tight stop',lookback:5,rr:1,stopMode:'lookback'},
 {id:'C',name:'Extended target',lookback:10,rr:2,stopMode:'lookback'},
 {id:'D',name:'Aggressive target',lookback:10,rr:3,stopMode:'lookback'},
 {id:'E',name:'Swing stop',lookback:10,rr:1,stopMode:'swing'}
]);
export const U_CONFIG=Object.freeze({timeframeMinutes:15,entryBars:9,fvgLookback:40,
  structurePivotBars:2,wickTolerancePips:0.05,nearMissPips:1,stopBufferPips:1,
  newsBlockMinutes:120,riskFraction:0.01,maxBars:25000});
export const uPipSize=pair=>pair.endsWith('/JPY')?0.01:0.0001;
const finite=n=>Number.isFinite(n);
function validate(pair,bars){
 if(!U_PAIRS.includes(pair))throw Error('Unsupported Forex pair');
 if(!Array.isArray(bars)||bars.length<60||bars.length>U_CONFIG.maxBars)throw Error('Need 60 to 25000 completed 15-minute candles');
 let previous=-Infinity;
 return bars.map(b=>{
  const time=Date.parse(b.time),open=Number(b.open),high=Number(b.high),low=Number(b.low),close=Number(b.close);
  if(!finite(time)||time<=previous||!finite(open)||!finite(high)||!finite(low)||!finite(close)||
   low<=0||low>Math.min(open,close)||high<Math.max(open,close))throw Error('Invalid or unordered OHLC data');
  if(previous!==-Infinity&&time-previous!==900000)throw Error('Missing or non-15-minute candles');
  previous=time;return {time,open,high,low,close};
 });
}
function pivot(bars,i,kind,depth=2){
 if(i<depth||i+depth>=bars.length)return false;
 const value=bars[i][kind];
 for(let j=i-depth;j<=i+depth;j++)if(j!==i&&(kind==='high'?bars[j].high>=value:bars[j].low<=value))return false;
 return true;
}
// A pivot is usable only depth bars after its center. No future leakage.
function structure(bars){
 let lastHigh=null,lastLow=null,trend=0;
 const result=[];
 for(let i=0;i<bars.length;i++){
  const confirmed=i-2;
  if(confirmed>=2){
   if(pivot(bars,confirmed,'high'))lastHigh=bars[confirmed].high;
   if(pivot(bars,confirmed,'low'))lastLow=bars[confirmed].low;
  }
  if(lastHigh!==null&&bars[i].close>lastHigh&&bars[i].close>bars[i].open){trend=1;lastHigh=null;}
  else if(lastLow!==null&&bars[i].close<lastLow&&bars[i].close<bars[i].open){trend=-1;lastLow=null;}
  result.push(trend);
 }
 return result;
}
function opposingFvg(bars,index,side,entry,stop){
 const start=Math.max(2,index-U_CONFIG.fvgLookback);
 for(let i=start;i<=index-2;i++){
  // Long is opposed by an unfilled bullish gap below entry; short by bearish gap above entry.
  const a=bars[i-2],c=bars[i],bull=a.high<c.low,bear=a.low>c.high;
  if(side==='LONG'&&!bull||side==='SHORT'&&!bear)continue;
  const lo=side==='LONG'?a.high:c.high,hi=side==='LONG'?c.low:a.low,mid=(lo+hi)/2;
  if(side==='LONG'&&hi>=entry||side==='SHORT'&&lo<=entry)continue;
  // Ignore gaps fully inside the stop's protective range.
  if(side==='LONG'&&lo>=stop||side==='SHORT'&&hi<=stop)continue;
  let filled=false;
  for(let j=i+1;j<index;j++)if(side==='LONG'?bars[j].low<=mid:bars[j].high>=mid){filled=true;break;}
  if(!filled)return true;
 }
 return false;
}
function tokyoBlocked(time){
 const hour=new Date(time).getUTCHours();
 // Tokyo UTC+9 has no daylight saving time.
 return (hour+9)%24>=9&&(hour+9)%24<12;
}
function newsBlocked(time,pair,events){
 const currencies=pair.split('/');
 return events.some(e=>currencies.includes(e.currency)&&e.highImpact===true&&
   finite(Date.parse(e.time))&&Math.abs(Date.parse(e.time)-time)<=U_CONFIG.newsBlockMinutes*60000);
}
function stopFor(bars,index,side,experiment,pip){
 const n=experiment.lookback;
 let subset=bars.slice(index-n,index);
 if(experiment.stopMode==='swing'){
  const kind=side==='LONG'?'low':'high';
  const pivots=[];
  for(let j=Math.max(2,index-20);j<=index-3;j++)
   if(pivot(bars,j,kind))pivots.push(bars[j][kind]);
  if(pivots.length)subset=[{low:pivots.at(-1),high:pivots.at(-1)}];
 }
 if(subset.length<n&&experiment.stopMode!=='swing')return null;
 return (side==='LONG'?Math.min(...subset.map(b=>b.low))-U_CONFIG.stopBufferPips*pip:
  Math.max(...subset.map(b=>b.high))+U_CONFIG.stopBufferPips*pip);
}
function nearMiss(bars,from,to,side,level,pip){
 const tolerance=U_CONFIG.nearMissPips*pip;
 for(let i=from;i<to;i++){
  const b=bars[i];
  if(side==='LONG'&&b.low>level&&b.low<=level+tolerance&&b.close>level+tolerance)return true;
  if(side==='SHORT'&&b.high<level&&b.high>=level-tolerance&&b.close<level-tolerance)return true;
 }
 return false;
}
function summary(trades){
 const wins=trades.filter(t=>t.rNet>0).length,losses=trades.filter(t=>t.rNet<0).length;
 const grossProfit=trades.reduce((s,t)=>s+Math.max(0,t.rNet),0);
 const grossLoss=trades.reduce((s,t)=>s+Math.max(0,-t.rNet),0);
 let equity=0,peak=0,maxDrawdownR=0;
 for(const t of trades){equity+=t.rNet;peak=Math.max(peak,equity);maxDrawdownR=Math.max(maxDrawdownR,peak-equity);}
 return {trades:trades.length,wins,losses,winRate:trades.length?wins/trades.length:null,
  netR:equity,profitFactor:grossLoss?grossProfit/grossLoss:null,maxDrawdownR};
}
// Supply completed candles, high-impact news events, and realistic bid/ask cost estimate.
// Missing news or spread coverage causes NO trades; never silently assume zero costs.
export function backtestU({pair,candles,newsEvents,spreadPips,slippagePips=0}={}){
 const bars=validate(pair,candles),pip=uPipSize(pair);
 if(!Array.isArray(newsEvents))throw Error('Verified historical high-impact news coverage required');
 if(!finite(spreadPips)||spreadPips<0||!finite(slippagePips)||slippagePips<0)
  throw Error('Verified spread and slippage assumptions required');
 const trends=structure(bars),results={};
 for(const experiment of U_EXPERIMENTS){
  const trades=[],pending=[];let active=null;
  for(let i=50;i<bars.length;i++){
   const bar=bars[i];
   if(active){
    const hitStop=active.side==='LONG'?bar.low<=active.stop:bar.high>=active.stop;
    const hitTarget=active.side==='LONG'?bar.high>=active.target:bar.low<=active.target;
    if(hitStop||hitTarget){
     const exit=hitStop?active.stop:active.target; // stop-first on ambiguous bars
     const gross=active.side==='LONG'?exit-active.entry:active.entry-exit;
     const cost=(spreadPips+2*slippagePips)*pip;
     trades.push({...active,exitTime:new Date(bar.time).toISOString(),exit,exitReason:hitStop?'STOP':'TARGET',
      rNet:(gross-cost)/active.risk});
     active=null;
    }
   }
   // Setups expire after nine bars, regardless of blocked entry.
   for(let j=pending.length-1;j>=0;j--){
    const p=pending[j];
    if(i-p.index>U_CONFIG.entryBars){pending.splice(j,1);continue;}
    if(active)continue;
    const touch=p.side==='LONG'?bar.low<=p.level:bar.high>=p.level;
    if(!touch)continue;
    pending.splice(j,1);
    if(trends[i-1]!==p.trend||tokyoBlocked(bar.time)||
       newsBlocked(bar.time,pair,newsEvents)||nearMiss(bars,p.index+1,i,p.side,p.level,pip))continue;
    const stop=stopFor(bars,i,p.side,experiment,pip);
    if(stop===null||p.side==='LONG'&&stop>=p.level||p.side==='SHORT'&&stop<=p.level)continue;
    if(opposingFvg(bars,i-1,p.side,p.level,stop))continue;
    const risk=Math.abs(p.level-stop),target=p.level+(p.side==='LONG'?1:-1)*risk*experiment.rr;
    if((spreadPips+2*slippagePips)*pip>=risk)continue;
    active={pair,experiment:experiment.id,side:p.side,signalTime:new Date(bars[p.index].time).toISOString(),
      entryTime:new Date(bar.time).toISOString(),entry:p.level,stop,target,risk};
    // Conservative: a position touched inside a candle cannot exit on that same
    // candle without intrabar sequencing. Start checking from the NEXT candle.
   }
   const tolerance=U_CONFIG.wickTolerancePips*pip;
   const long=bar.close>bar.open&&bar.open-bar.low<=tolerance;
   const short=bar.close<bar.open&&bar.high-bar.open<=tolerance;
   const side=long?'LONG':short?'SHORT':null;
   if(side&&trends[i]===(side==='LONG'?1:-1)){
    // Reject candles at a fresh swing extreme.
    const recent=bars.slice(i-5,i);
    if(side==='LONG'&&bar.low<=Math.min(...recent.map(x=>x.low))||
       side==='SHORT'&&bar.high>=Math.max(...recent.map(x=>x.high)))continue;
    pending.push({index:i,side,level:bar.open,trend:trends[i]===1?1:-1});
   }
  }
  results[experiment.id]={...experiment,metrics:summary(trades),trades,openPosition:active};
 }
 return {pair,timeframeMinutes:15,paperOnly:true,newsCoverageProvided:true,
  costAssumptions:{spreadPips,slippagePips},experiments:results};
}
export function uStatus(){return {name:'U',mode:'OFFLINE_RESEARCH',paperOnly:true,liveExecution:false,
 pairs:U_PAIRS,experiments:U_EXPERIMENTS,config:U_CONFIG,
 requirements:['Historical 15-minute bid/ask-aware FX candles','Historical high-impact news calendar','Spread/slippage estimates'],
 connectedProvider:false,scanRunning:false,verifiedTrades:0};}
