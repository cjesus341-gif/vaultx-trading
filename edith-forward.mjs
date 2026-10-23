// EDITH v0.2 — paper-only forward engine. Never imports or calls a trade endpoint.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {edithSignal,EDITH_STRATEGIES} from './edith-paper-lab.mjs';
import {verifyCandleCoverage} from './edith-gap-recovery.mjs';
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
 const recoveryLogState=new Map();
 async function init(){
  if(state)return;
  if(!filePath)throw Error('EDITH requires persistent DATA_DIR');
  try{
   const doc=JSON.parse(await readFile(filePath,'utf8'));
   if(doc.schema!==1||!doc.variants||!doc.watermarks||typeof doc.enabled!=='boolean'||!Array.isArray(doc.trades))throw Error('Invalid EDITH journal');
   const expected=variants();let upgraded=false;
   // V36 already deployed? Keep existing fills, open paper positions, and watermarks.
   // Add new experiment IDs without altering existing fills, positions or watermarks. No backfill.
   for(const [k,initial] of Object.entries(expected)){
    if(!doc.variants[k]){
     if(!EDITH_RATIOS.slice(-2).includes(initial.rewardRisk)&&!initial.strategy.startsWith('ema-adx-rsi'))throw Error('Missing EDITH base strategy: '+k);
     doc.variants[k]=initial;upgraded=true;
    }else if(!finite(doc.variants[k].cash))throw Error('Invalid EDITH strategy: '+k);
    // V36 stored delayed candle-open intents without an actual observation timestamp.
    // Discard those intents rather than filling them retroactively after upgrading.
    else if(doc.variants[k].pending&&!doc.variants[k].pending.recordedAt){
     doc.variants[k].pending=null;upgraded=true;
    }
   }
   state=doc;
   if(!state.marketHealth||typeof state.marketHealth!=='object'){state.marketHealth={};upgraded=true;}
   if(upgraded)await persist();
  }catch(e){
   if(e.code!=='ENOENT')throw Error('EDITH journal invalid — paused; '+e.message);
   state={schema:1,enabled:true,watermarks:{},variants:variants(),trades:[],createdAt:new Date(now()).toISOString(),lastRun:null,lastError:null,marketHealth:{},scanCount:0};await persist();
  }
 }
 async function persist(){await mkdir(path.dirname(filePath),{recursive:true});const tmp=filePath+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,filePath);}
 function summary(){if(!state)return {initialized:false,paperOnly:true,canTradeRealMoney:false};
  const ranked=Object.entries(state.variants).map(([name,v])=>({name,strategy:v.strategy,targetToStopRatio:v.rewardRisk,
   netPnlUsd:v.realizedUsd,returnPct:100*v.realizedUsd/START_CAPITAL,winRate:v.completed?v.wins/v.completed:null,
   profitFactor:v.grossLosses>0?v.grossProfits/v.grossLosses:null,maxDrawdownUsd:v.maxDrawdownUsd,
   trades:v.completed,openPosition:v.position?{market:v.position.market,side:v.position.side,entry:v.position.entry,stop:v.position.stop,target:v.position.target,needsReview:!!v.position.dataGap,recoveryStatus:v.position.dataGap?(v.position.recoveryReason||'Awaiting complete price history'):'CLEAR'}:null,
   pendingSignal:v.pending?{market:v.pending.market,side:v.pending.side}:null,feesUsd:v.feesUsd}));
  ranked.sort((a,b)=>b.netPnlUsd-a.netPnlUsd);
  return {initialized:true,paperOnly:true,canTradeRealMoney:false,enabled:state.enabled,lastRun:state.lastRun,
   scanCount:state.scanCount,lastError:state.lastError,lastScanMarketsProcessed:state.lastScanMarketsProcessed??null,markets:EDITH_MARKETS,ratios:EDITH_RATIOS,
   assumptions:{startingCapitalUsd:START_CAPITAL,riskFraction:RISK_FRACTION,maxNotionalUsd:MAX_NOTIONAL,feeRatePerSide:FEE,slippagePerSide:SLIP,stopAtrMultiplier:STOP_MULT},
   strategies:ranked,recentTrades:state.trades.slice(-100).reverse(),marketHealth:state.marketHealth||{},
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
   stop:p.stop,target:p.target,quantity:p.qty,notionalUsd:p.entry*p.qty,feesUsd:p.entryFee+exitFee,grossPnlUsd:gross,netPnlUsd:net,
   outcome:stopped?'stop':'target',recoveredPriceGap:!!p.recoveredPriceGap,recoveryMethod:p.recoveredPriceGap?'verified_completed_candles_conservative_stop_first':null};
  v.trades.push(trade);if(v.trades.length>150)v.trades.shift();state.trades.push(trade);if(state.trades.length>500)state.trades.shift();v.position=null;
 }
 function fillPending(v,market,quote,observedAt){
  const p=v.pending;
  if(!p||p.market!==market)return;
  const price=Number(quote?.price),sampled=Date.parse(quote?.observedAt||'');
  const signalClose=Date.parse(p.signalTime)+BAR_MS;
  // A fill is possible only on a newly observed quote AFTER the signal candle closed.
  // Never fill at an already completed candle's opening price.
  if(!Number.isFinite(price)||price<=0||!Number.isFinite(sampled)||
     sampled<=signalClose||sampled<=Date.parse(p.recordedAt||p.signalTime)||
     Math.abs(sampled-observedAt)>60000)return;
  v.pending=null;
  const entry=price*(p.side==='LONG'?1+SLIP:1-SLIP),stopDistance=p.avgRange*STOP_MULT;
  if(!(stopDistance>0&&entry>stopDistance&&entry>0))return;
  const stop=p.side==='LONG'?entry-stopDistance:entry+stopDistance;
  const target=p.side==='LONG'?entry+stopDistance*v.rewardRisk:entry-stopDistance*v.rewardRisk;
  if(!(target>0))return;
  const riskDollars=Math.max(0,START_CAPITAL+v.realizedUsd)*RISK_FRACTION;
  const qty=Math.min(MAX_NOTIONAL/entry,riskDollars/(stopDistance+entry*FEE*2+entry*SLIP*2));
  if(!(qty>0))return;
  const entryFee=qty*entry*FEE;
  v.feesUsd+=entryFee;
  v.position={market,side:p.side,signalTime:p.signalTime,entryTime:new Date(sampled).toISOString(),
   entry,stop,target,qty,entryFee,quoteObservedAt:new Date(sampled).toISOString()};
 }
 function reconcilePositions(market,raw){
  const affected=Object.values(state.variants).filter(v=>v.position?.market===market&&v.position.dataGap);
  if(!affected.length)return {recovered:0,unresolved:0};
  const latest=raw.at(-1)?.time;let recovered=0,unresolved=0;
  for(const v of affected){
   const p=v.position;
   // Only restore positions backed by a complete contiguous record from the
   // last observed watermark; never use current price to infer an old exit.
   const start=p.gapSince;
   const entryMs=Date.parse(p.entryTime||''), startMs=Date.parse(start||''), latestMs=Date.parse(latest||'');
   if(!Number.isFinite(entryMs)||!Number.isFinite(startMs)||!Number.isFinite(latestMs)||
      entryMs>=latestMs||startMs>=latestMs){
    p.recoveryReason='Recovery timestamps invalid: position remains quarantined';unresolved++;continue;
   }
   const check=verifyCandleCoverage(raw,start,latest);
   if(!check.ok){p.recoveryReason=check.reason;unresolved++;continue;}
   p.dataGap=false;p.recoveredPriceGap=true;p.recoveryReason=null;
   // Historical candles occurred after the paper entry was actually recorded.
   // Price path inside a bar is unknown, so closeTrade() assumes STOP first.
   for(const bar of check.bars){
    if(!v.position)break;
    if(Date.parse(bar.time)>=Date.parse(p.entryTime))closeTrade(v,bar);
   }
   recovered++;
  }
  return {recovered,unresolved};
 }
 function processMarket(market,raw,quote,observedAt){
  if(!EDITH_MARKETS.includes(market))throw Error('Unknown EDITH market');
  if(!Array.isArray(raw)||raw.length<70)throw Error('Insufficient completed candles for '+market);
  const candles=raw.map(normalize).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(candles.some(x=>!validCandle(x)))throw Error('Invalid candle for '+market);
  for(let i=1;i<candles.length;i++)if(Date.parse(candles[i].time)<=Date.parse(candles[i-1].time))throw Error('Duplicate candle '+market);
  const latest=candles.at(-1),last=state.watermarks[market];
  if(!last){state.watermarks[market]=latest.time;return {status:'INITIALIZED',updated:false};}
  const unseen=candles.filter(x=>Date.parse(x.time)>Date.parse(last));
  if(!unseen.length)return {status:'WAITING',updated:false};
  // Resynchronize a delayed scan without replaying unknown historical executions.
  // Explicitly quarantine pre-existing positions, discard old pending signals,
  // and skip the missed candles. Resume normal forward processing next scan.
  if(unseen.length!==1||Date.parse(unseen[0].time)-Date.parse(last)!==BAR_MS){
   for(const v of Object.values(state.variants)){
    if(v.pending?.market===market)v.pending=null;
    if(v.position?.market===market){v.position.dataGap=true;v.position.gapSince=v.position.gapSince||last;}
   }
   state.watermarks[market]=latest.time;
   return {status:'RESYNCED_GAP',updated:false,skippedCandles:unseen.length,
     reason:'Missing candle interval(s) skipped, older positions quarantined; subsequent fresh candles can be evaluated safely.'};
  }
  const bar=unseen[0],barStart=Date.parse(bar.time),barEnd=barStart+BAR_MS;
  // Quote must be collected at the current scan, never sourced from OHLC history.
  if(!quote||!Number.isFinite(Number(quote.price))||Number(quote.price)<=0||
     !Number.isFinite(Date.parse(quote.observedAt))||Math.abs(Date.parse(quote.observedAt)-observedAt)>60000)
   throw Error('EDITH missing/stale live quote for '+market);
  if(barEnd>observedAt||observedAt-barEnd>BAR_MS+60000)
   throw Error('EDITH candle not freshly completed for '+market);
  for(const v of Object.values(state.variants)){
   // Existing positions may be evaluated only on fully completed candles that
   // BEGAN after the recorded actual paper entry time.
   if(v.position?.market===market&&!v.position.dataGap&&barStart>=Date.parse(v.position.entryTime))closeTrade(v,bar);
   if(v.pending?.market===market)fillPending(v,market,quote,observedAt);
   if(v.pending||v.position)continue;
   const signal=edithSignal(candles,candles.length-1,v.strategy);
   if(!signal)continue;
   const avgRange=candles.slice(-14).reduce((n,c)=>n+c.high-c.low,0)/14;
   if(!(avgRange>0))continue;
   // Signal recorded AFTER this completed candle is observed. No same-bar fill.
   v.pending={market,side:signal,signalTime:bar.time,avgRange,
     recordedAt:new Date(observedAt).toISOString()};
  }
  state.watermarks[market]=bar.time;
  return {status:'OK',updated:true};
 }
 async function tick(getCandles,getQuote,getRecoveryCandles=null){
  if(busy)return busy;
  busy=(async()=>{
   await init();if(!state.enabled)return summary();
   const observedAt=now(),failed=[];let processed=0;
   for(const market of EDITH_MARKETS){
    // Errors never roll back other markets. Avoid making unnecessary quote calls
    // when no new completed candle is present or while resynchronizing a gap.
    const original=clone(state);
    try{
     const candles=await getCandles(market);
     const sorted=Array.isArray(candles)?candles.slice().sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)):[];
     const last=state.watermarks[market],latest=sorted.at(-1);
     const unseen=last?sorted.filter(c=>Date.parse(c.time)>Date.parse(last)):[];
     const needsQuote=!!last&&unseen.length===1&&Date.parse(unseen[0].time)-Date.parse(last)===BAR_MS;
     const quote=needsQuote?await getQuote(market):null;
     // EDITH V44 ORDERED RECOVERY: quarantine new gaps before trying to repair them.
     const result=processMarket(market,candles,quote,observedAt);
     // Repair quarantined paper positions even if the latest candle is WAITING.
     // Fetch older Coinbase candles only when positions need reconciliation.
     const gaps=Object.values(state.variants).filter(v=>v.position?.market===market&&v.position.dataGap);
     let recovery={recovered:0,unresolved:gaps.length};let recoveryAttempted=false;
     if(gaps.length){
      const oldEnough=gaps.some(v=>!v.position.recoveryCheckedAt||observedAt-Date.parse(v.position.recoveryCheckedAt)>=300000);
      if(oldEnough){
       recoveryAttempted=true;
       // V45: legacy gapSince can be missing, malformed or ahead of the latest bar.
       // Trust the ORIGINAL recorded entry as our lower bound; never fast-forward
       // past historical price movement or assume a trade has survived a gap.
       const latestMs=Date.parse(latest?.time||'');
       const starts=[];
       for(const v of gaps){
        const p=v.position,entryMs=Date.parse(p.entryTime||''),gapMs=Date.parse(p.gapSince||'');
        if(!Number.isFinite(latestMs)||!Number.isFinite(entryMs)||entryMs>=latestMs){
         p.recoveryReason='Recovery timestamps invalid: recorded entry or latest candle';
         continue;
        }
        // OHLC stamps refer to the start of five-minute candles. Verify the
        // full path after the recorded entry, never fill missing bars by guess.
        const entryStart=Math.floor(entryMs/BAR_MS)*BAR_MS-BAR_MS;
        const safeGap=Number.isFinite(gapMs)&&gapMs%BAR_MS===0&&gapMs<latestMs
         ?Math.min(gapMs,entryStart):entryStart;
        if(gapMs!==safeGap){
         if(p.recoveryOriginalGapSince===undefined)p.recoveryOriginalGapSince=p.gapSince??null;
         p.gapSince=new Date(safeGap).toISOString();
         console.warn('[EDITH recovery]',market,'corrected legacy time boundary',
          'entry='+p.entryTime,'oldGap='+String(p.recoveryOriginalGapSince).slice(0,48),
          'newGap='+p.gapSince);
        }
        starts.push(safeGap);
       }
       const oldest=starts.length?new Date(Math.min(...starts)).toISOString():null;
       let history=[],feedError=null;
       if(oldest&&getRecoveryCandles){
        try{history=await getRecoveryCandles(market,oldest,latest.time);}
        catch(e){feedError='Recovery feed unavailable: '+String(e?.message||e).slice(0,110);history=[];}
       }
       if(!oldest)feedError='Recovery timestamps invalid: no verified position entry';
       recovery=oldest?reconcilePositions(market,history):{recovered:0,unresolved:gaps.length};
       if(feedError)for(const v of gaps)if(v.position?.dataGap)v.position.recoveryReason=feedError;
       for(const v of gaps)if(v.position?.dataGap)v.position.recoveryCheckedAt=new Date(observedAt).toISOString();
      }
     }
     // Recovery diagnostics are server-side only and deduplicated by outcome.
     if(recoveryAttempted){
      const remaining=Object.values(state.variants).filter(v=>v.position?.market===market&&v.position.dataGap);
      const reason=remaining[0]?.position?.recoveryReason||null;
      const fingerprint=JSON.stringify([remaining.length,reason]);
      if(recovery.recovered>0)console.info('[EDITH recovery]',market,'recovered='+recovery.recovered,'unresolved='+remaining.length);
      if(fingerprint!==recoveryLogState.get(market)){
       recoveryLogState.set(market,fingerprint);
       if(remaining.length)console.warn('[EDITH recovery]',market,'unresolved='+remaining.length,'reason='+String(reason||'Incomplete candle history').slice(0,160));
       else console.info('[EDITH recovery]',market,'all positions reconciled');
      }
     }
     result.recoveredPositions=recovery.recovered;
     result.unresolvedPositions=Object.values(state.variants).filter(v=>v.position?.market===market&&v.position.dataGap).length;
     const previous=state.marketHealth[market]||{};
     state.marketHealth[market]={status:result.status,checkedAt:new Date(observedAt).toISOString(),
       lastSuccessAt:result.status==='OK'||result.status==='INITIALIZED'?new Date(observedAt).toISOString():previous.lastSuccessAt||null,
       reason:result.reason||null,skippedCandles:result.skippedCandles||0,
       recoveredPositions:result.recoveredPositions||0,unresolvedPositions:result.unresolvedPositions||0,
       recoveryAttempted,recoveryReason:Object.values(state.variants).find(v=>v.position?.market===market&&v.position.dataGap)?.position.recoveryReason||null};
     if(result.status==='OK'||result.status==='WAITING'||result.status==='INITIALIZED')processed++;
    }catch(e){
     state=original;
     const message=String(e?.message||e).slice(0,180);
     failed.push(market+': '+message);
     state.marketHealth[market]={...state.marketHealth[market],status:'DATA_UNAVAILABLE',
       checkedAt:new Date(observedAt).toISOString(),reason:message};
    }
   }
   state.lastError=failed.length?failed.join(' | ').slice(0,300):null;
   state.lastRun=new Date(now()).toISOString();state.scanCount++;state.lastScanMarketsProcessed=processed;
   await persist();return summary();
  })();try{return await busy;}finally{busy=null;}
 }
 return {init,tick,status:async()=>{await init();return summary();}};
}
