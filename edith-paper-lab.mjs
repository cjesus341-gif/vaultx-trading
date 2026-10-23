// EDITH v0.1: strictly paper-only, deterministic historical simulation.
// Input: chronologically ascending closed candles [{time,open,high,low,close,volume}].
// Signals at close of bar i; earliest fill at NEXT bar open. Never accesses Coinbase orders.
const num = x=>Number(x);
function average(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;}
function emaAt(c,period,i){if(i<period-1)return NaN;const alpha=2/(period+1);let x=average(c.slice(0,period).map(v=>v.close));for(let j=period;j<=i;j++)x=alpha*c[j].close+(1-alpha)*x;return x;}
function rsiAt(c,i,period=14){if(i<period)return NaN;let gain=0,loss=0;for(let j=i-period+1;j<=i;j++){const d=c[j].close-c[j-1].close;gain+=Math.max(0,d);loss+=Math.max(0,-d);}return loss===0?100:100-100/(1+gain/loss);}
// Each ID is immutable: journals use it as the experiment identity.
export const EDITH_STRATEGIES=['ema-trend','rsi-reversion','range-breakout',
 'ema-adx-rsi',
 'ema-adx-rsi-adx20-volume-off','ema-adx-rsi-adx25-volume-off',
 'ema-adx-rsi-adx20-volume-on','ema-adx-rsi-adx25-volume-on'];
function adxAt(c,i,period=14){
 if(i<period*2)return NaN;
 let tr=0,plus=0,minus=0;const dx=[];
 for(let j=1;j<=i;j++){
  const up=c[j].high-c[j-1].high,down=c[j-1].low-c[j].low;
  const t=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));
  const p=up>down&&up>0?up:0,m=down>up&&down>0?down:0;
  if(j<=period){tr+=t;plus+=p;minus+=m;if(j<period)continue;}
  else{tr=tr-tr/period+t;plus=plus-plus/period+p;minus=minus-minus/period+m;}
  const pd=tr>0?100*plus/tr:0,md=tr>0?100*minus/tr:0;
  dx.push(pd+md>0?100*Math.abs(pd-md)/(pd+md):0);
 }
 if(dx.length<period)return NaN;
 let a=average(dx.slice(0,period));for(let k=period;k<dx.length;k++)a=(a*(period-1)+dx[k])/period;
 return a;
}
function combinedSignal(c,i,strategy){
 if(i<60)return null;
 const baseline=strategy==='ema-adx-rsi';
 const threshold=baseline||strategy.includes('adx25')?25:20;
 const volumeRequired=!baseline&&strategy.endsWith('volume-on');
 const fast=emaAt(c,10,i),slow=emaAt(c,50,i),adx=adxAt(c,i),rsi=rsiAt(c,i),priorRsi=rsiAt(c,i-1);
 if(![fast,slow,adx,rsi,priorRsi].every(Number.isFinite)||adx<threshold)return null;
 if(volumeRequired&&!(c[i].volume>average(c.slice(i-20,i).map(x=>x.volume))))return null;
 // One new signal per RSI midline crossing, confirmed by EMA trend and ADX strength.
 if(fast>slow&&priorRsi<=50&&rsi>50)return 'LONG';
 if(fast<slow&&priorRsi>=50&&rsi<50)return 'SHORT';
 return null;
}
export function edithSignal(c,i,strategy){
 if(i<35)return null;
 if(strategy.startsWith('ema-adx-rsi'))return combinedSignal(c,i,strategy);
 const close=c[i].close,prev=c[i-1].close;
 if(strategy==='ema-trend'){
  const fast=emaAt(c,12,i),slow=emaAt(c,26,i),prevFast=emaAt(c,12,i-1),prevSlow=emaAt(c,26,i-1);
  return close>prev&&fast>slow&&prevFast<=prevSlow?'LONG':close<prev&&fast<slow&&prevFast>=prevSlow?'SHORT':null;
 }
 if(strategy==='rsi-reversion'){
  const r=rsiAt(c,i),before=rsiAt(c,i-1);
  return before<30&&r>=30?'LONG':before>70&&r<=70?'SHORT':null;
 }
 if(strategy==='range-breakout'){
  const range=c.slice(i-20,i);return close>Math.max(...range.map(x=>x.high))?'LONG':close<Math.min(...range.map(x=>x.low))?'SHORT':null;
 }
 throw Error('Unknown strategy');
}
export function runEdithPaper(candles,{strategy='ema-trend',feeRate=0.009,slippageRate=0.001,notionalUsd=2.5,maxHoldBars=12,allowShort=true}={}){
 if(!EDITH_STRATEGIES.includes(strategy))throw Error('Unknown strategy');
 if(![feeRate,slippageRate,notionalUsd,maxHoldBars].every(x=>Number.isFinite(x))||feeRate<0||slippageRate<0||notionalUsd<=0||maxHoldBars<1)throw Error('Invalid simulation settings');
 if(!Array.isArray(candles)||candles.length<70)throw Error('At least 70 closed candles required');
 const c=candles.map(x=>({time:String(x.time),open:num(x.open),high:num(x.high),low:num(x.low),close:num(x.close),volume:num(x.volume)}));
 if(c.some(x=>![x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite)||x.open<=0||x.low<=0||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close)||x.volume<0))throw Error('Invalid candle series');
 if(c.some((x,i)=>i>0&&!(Date.parse(x.time)>Date.parse(c[i-1].time))))throw Error('Candles must have strictly increasing timestamps');
 const trades=[];let nextFree=36;
 for(let i=35;i<c.length-1;i++){
  if(i<nextFree)continue;
  const side=edithSignal(c,i,strategy);if(!side||(side==='SHORT'&&!allowShort))continue;
  const entryIndex=i+1;
  const entry=c[entryIndex].open*(side==='LONG'?1+slippageRate:1-slippageRate);
  const ending=Math.min(c.length-1,entryIndex+maxHoldBars);
  // A fixed stop/target is constructed from historical volatility visible at signal time.
  const avgRange=average(c.slice(i-13,i+1).map(x=>x.high-x.low));
  if(!(avgRange>0))continue;
  const stop=side==='LONG'?entry-1.25*avgRange:entry+1.25*avgRange;
  const target=side==='LONG'?entry+2.5*avgRange:entry-2.5*avgRange;
  if(stop<=0||target<=0)continue;
  let exitIndex=ending,exit=c[ending].close,reason='time';
  for(let j=entryIndex;j<=ending;j++){
   const b=c[j];
   const hitsStop=side==='LONG'?b.low<=stop:b.high>=stop;
   const hitsTarget=side==='LONG'?b.high>=target:b.low<=target;
   // If both touched within one bar, assume the adverse stop first (conservative).
   if(hitsStop||hitsTarget){exitIndex=j;exit=hitsStop?stop:target;reason=hitsStop?'stop':'target';break;}
  }
  // Adverse exit slippage. No simulated leverage, liquidation or financing costs.
  const exitFill=exit*(side==='LONG'?1-slippageRate:1+slippageRate);
  const quantity=notionalUsd/entry;
  const gross=(side==='LONG'?exitFill-entry:entry-exitFill)*quantity;
  const fees=(notionalUsd+exitFill*quantity)*feeRate;
  trades.push({marketSide:side,strategy,signalTime:c[i].time,entryTime:c[entryIndex].time,exitTime:c[exitIndex].time,
   entry,exit:exitFill,quantity,notionalUsd,feesUsd:fees,netPnlUsd:gross-fees,reason});
  nextFree=exitIndex+1;
 }
 const total=trades.reduce((s,t)=>s+t.netPnlUsd,0),wins=trades.filter(t=>t.netPnlUsd>0);
 let equity=0,peak=0,maxDrawdown=0;
 for(const t of trades){equity+=t.netPnlUsd;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);}
 const profits=trades.filter(t=>t.netPnlUsd>0).reduce((s,t)=>s+t.netPnlUsd,0);
 const losses=-trades.filter(t=>t.netPnlUsd<0).reduce((s,t)=>s+t.netPnlUsd,0);
 return {strategy,candleCount:c.length,tradeCount:trades.length,netPnlUsd:total,winRate:trades.length?wins.length/trades.length:null,
   profitFactor:losses>0?profits/losses:null,maxDrawdownUsd:maxDrawdown,trades,
   limitations:'Historical paper simulation; assumes next-bar fills, conservative same-bar stops, fixed taker fees and slippage. No liquidity, funding, order-book or live execution modeling.'};
}
export function compareEdithStrategies(candles,options={}){
 // Chronological split, no random shuffling. A strategy must have unseen test trades.
 const cut=Math.floor(candles.length*0.7);
 const train=candles.slice(0,cut),test=candles.slice(Math.max(0,cut-35));
 return EDITH_STRATEGIES.map(strategy=>({strategy,train:runEdithPaper(train,{...options,strategy}),
   test:runEdithPaper(test,{...options,strategy})})).sort((a,b)=>b.test.netPnlUsd-a.test.netPnlUsd);
}
