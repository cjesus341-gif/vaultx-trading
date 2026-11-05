// Isolated historical simulator for EDITH XRP perpetual research. Never writes orders or journals.
import {edithSignal,EDITH_STRATEGIES} from './edith-paper-lab.mjs';
const round=n=>Math.round(n*1e6)/1e6;
export function backtestEdithPerp(candles,{productId,contractSize,feeRate=0.0006,slippageRate=0.0005,startingBalance=300,leverage=3}={}){
 if(!/^(XRP-.*PERP|.*XPP.*)$/i.test(productId||''))throw Error('Not a verified XRP perpetual contract');
 if(!(contractSize>0&&feeRate>=0&&slippageRate>=0))throw Error('Invalid contract or cost assumptions');
 const bars=[...new Map(candles.map(c=>[c.time,c])).values()].sort((a,b)=>a.time.localeCompare(b.time));
 for(let i=0;i<bars.length;i++){const b=bars[i];if(!Number.isFinite(b.open)||!Number.isFinite(b.high)||!Number.isFinite(b.low)||!Number.isFinite(b.close)||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||(i&&Date.parse(b.time)-Date.parse(bars[i-1].time)!==900000))throw Error('Missing or invalid historical 15-minute candles: backtest refused');}
 if(bars.length<70)throw Error('Insufficient contiguous perpetual candles');
 const strategies=EDITH_STRATEGIES.map(strategy=>{
  let cash=startingBalance,peak=cash,dd=0,position=null,pending=null;const trades=[];
  for(let i=70;i<bars.length;i++){
   const b=bars[i];
   if(position){
    const stopHit=position.side==='LONG'?b.low<=position.stop:b.high>=position.stop;
    const targetHit=position.side==='LONG'?b.high>=position.target:b.low<=position.target;
    if(stopHit||targetHit){
     // When both touch in the same candle, conservatively assign the stop.
     const raw=stopHit?position.stop:position.target;
     const exit=raw*(position.side==='LONG'?1-slippageRate:1+slippageRate);
     const gross=(position.side==='LONG'?exit-position.entry:position.entry-exit)*contractSize;
     const fees=(position.entry+exit)*contractSize*feeRate;
     const net=round(gross-fees);
     cash=round(cash+net);peak=Math.max(peak,cash);dd=Math.max(dd,peak-cash);
     trades.push({...position,exit,exitTime:b.time,feesUsd:round(fees),grossPnlUsd:round(gross),netPnlUsd:net,outcome:stopHit?'STOP':'TARGET'});
     position=null;
    }
   }
   if(pending&&!position){
    // Entry at NEXT candle open, never the signal candle's closing price.
    const entry=b.open*(pending.side==='LONG'?1+slippageRate:1-slippageRate);
    const margin=contractSize*entry/leverage;
    const risk=contractSize*entry*(0.0074+2*feeRate+2*slippageRate);
    if(margin<=cash&&risk<=cash*.02){
     const distance=entry*.0074,targetDistance=entry*.0206;
     position={productId,strategy,side:pending.side,entry,entryTime:b.time,stop:pending.side==='LONG'?entry-distance:entry+distance,target:pending.side==='LONG'?entry+targetDistance:entry-targetDistance,contractSize,marginUsd:round(margin)};
    }
   }
   pending=null;
   // Signal uses only candles already closed, schedules an entry next bar.
   if(i<bars.length-1&&!position){const side=edithSignal(bars,i,strategy);if(side==='LONG'||side==='SHORT')pending={side};}
  }
  const wins=trades.filter(t=>t.netPnlUsd>0).length,tpHits=trades.filter(t=>t.outcome==='TARGET').length;
  return {name:strategy,strategy,trades:trades.length,netPnlUsd:round(cash-startingBalance),accountBalanceUsd:cash,startingBalanceUsd:startingBalance,winRate:trades.length?wins/trades.length:null,lossRate:trades.length?(trades.length-wins)/trades.length:null,leverage,marginPerTradeUsd:null,tpHitRate:trades.length?tpHits/trades.length:null,tpHits,tpFeeLosses:trades.filter(t=>t.outcome==='TARGET'&&t.netPnlUsd<=0).length,maxDrawdownUsd:round(dd),openPosition:position,tradeHistory:trades};
 });
 return {paperOnly:true,marketType:'COINBASE_US_PERPETUAL',productId,firstCandle:bars[0].time,lastCandle:bars.at(-1).time,candleCount:bars.length,strategies,assumptions:{feeRate,slippageRate,contractSize,leverage,fundingMode:'NOT_MODELED',liquidationMode:'NOT_MODELED',entry:'next-candle-open',sameCandleStopTarget:'stop-first'},limitations:'Funding, liquidation and intrabar execution are unavailable; results are indicative, not fully cost-complete. Data gaps cause a hard failure.'};
}
