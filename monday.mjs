import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const INTERVALS = { '5m':300, '15m':900, '1h':3600 };
const round = (x, digits=2) => Number(x.toFixed(digits));
export function normalizeCandles(rows, seconds, endMs, count=120) {
  if (!Array.isArray(rows)) throw new Error('Invalid candle response');
  const end=Math.floor(endMs / (seconds*1000))*seconds;
  const start=end-count*seconds, map=new Map();
  for(const row of rows) {
    if(!Array.isArray(row)||row.length<6||!row.slice(0,6).every(Number.isFinite)) continue;
    const [time,low,high,open,close,volume]=row;
    if(time<start||time>=end||time%seconds!==0||low<=0||high<low||open<low||open>high||close<low||close>high||volume<0) continue;
    map.set(time,{time,low,high,open,close,volume});
  }
  const candles=[...map.values()].sort((a,b)=>a.time-b.time);
  if(candles.length!==count||candles.some((x,i)=>x.time!==start+i*seconds)) throw new Error('Incomplete candle history');
  return candles;
}
function ema(values, period) {
  let average=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(const value of values.slice(period)) average+=(value-average)*2/(period+1);
  return average;
}
function rsi(values, period=14) {
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){const delta=values[i]-values[i-1];gains+=Math.max(delta,0);losses+=Math.max(-delta,0);}
  gains/=period;losses/=period;
  for(let i=period+1;i<values.length;i++){const delta=values[i]-values[i-1];gains=(gains*(period-1)+Math.max(delta,0))/period;losses=(losses*(period-1)+Math.max(-delta,0))/period;}
  return losses===0?(gains===0?50:100):100-100/(1+gains/losses);
}
function atr(candles, period=14) {
  const ranges=candles.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));
  let value=ranges.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(const range of ranges.slice(period))value=(value*(period-1)+range)/period;
  return value;
}
export function candlePatterns(candles) {
  const last=candles.at(-1),previous=candles.at(-2),range=last.high-last.low,body=Math.abs(last.close-last.open);
  const upper=last.high-Math.max(last.open,last.close),lower=Math.min(last.open,last.close)-last.low;
  const found=[];
  if(range>0&&body/range<=.1)found.push({name:'Doji',direction:'neutral',note:'Small body relative to range; indecision, not a reversal signal by itself.'});
  const rising=last.close>last.open,falling=last.close<last.open;
  if(previous.close<previous.open&&rising&&last.open<=previous.close&&last.close>=previous.open&&body>Math.abs(previous.close-previous.open))found.push({name:'Bullish engulfing',direction:'bullish',note:'Last body engulfed the preceding down candle; continuation requires confirmation.'});
  if(previous.close>previous.open&&falling&&last.open>=previous.close&&last.close<=previous.open&&body>Math.abs(previous.close-previous.open))found.push({name:'Bearish engulfing',direction:'bearish',note:'Last body engulfed the preceding up candle; continuation requires confirmation.'});
  const trendStart=candles.at(-6)?.close??previous.close,downtrend=previous.close<trendStart,uptrend=previous.close>trendStart;
  if(body>0&&range>0&&body/range<=.35&&lower>=body*2&&upper<=body*.5)found.push({name:downtrend?'Hammer-shaped candle':'Long lower wick',direction:downtrend?'bullish':'neutral',note:'Lower prices were rejected inside this candle; the broader trend still matters.'});
  if(body>0&&range>0&&body/range<=.35&&upper>=body*2&&lower<=body*.5)found.push({name:uptrend?'Shooting-star-shaped candle':'Long upper wick',direction:uptrend?'bearish':'neutral',note:'Higher prices were rejected inside this candle; it is not proof of a reversal.'});
  return found;
}
export function analyzeFrame(candles, label) {
  const closes=candles.map(x=>x.close),last=candles.at(-1),previous=candles.at(-2);
  const fast=ema(closes,20),slow=ema(closes,50),strength=rsi(closes),volatility=atr(candles);
  const recent=candles.slice(-25,-1),support=Math.min(...recent.map(x=>x.low)),resistance=Math.max(...recent.map(x=>x.high));
  const volumeMean=candles.slice(-21,-1).reduce((sum,c)=>sum+c.volume,0)/20,volumeRatio=volumeMean?last.volume/volumeMean:null;
  const patterns=candlePatterns(candles);
  const trend=last.close>fast&&fast>slow?'bullish':last.close<fast&&fast<slow?'bearish':'mixed';
  const momentum=strength>55?'positive':strength<45?'negative':'neutral';
  let score=trend==='bullish'?1:trend==='bearish'?-1:0;
  score+=momentum==='positive'?1:momentum==='negative'?-1:0;
  const patternDirections=new Set(patterns.map(p=>p.direction));
  if(patternDirections.has('bullish')&&!patternDirections.has('bearish'))score++;
  if(patternDirections.has('bearish')&&!patternDirections.has('bullish'))score--;
  const breakout=last.close>resistance?'above recent high':last.close<support?'below recent low':'inside recent range';
  return {timeframe:label,closedAt:new Date((last.time+INTERVALS[label])*1000).toISOString(),close:round(last.close,4),trend,momentum,score,
    ema20:round(fast,4),ema50:round(slow,4),rsi14:round(strength),atr14:round(volatility,4),volumeRatio:volumeRatio===null?null:round(volumeRatio),
    recentLow:round(support,4),recentHigh:round(resistance,4),breakout,patterns,
    lastCandleChangePct:round((last.close/last.open-1)*100),previousClose:previous.close};
}
// Conditional log-price extrapolation, deliberately not a calibrated probability model.
export function projectFridayPrice(candles, atrValue) {
  const recent=candles.slice(-24);
  if(recent.length!==24||recent.some(c=>!Number.isFinite(c.close)||c.close<=0)||!Number.isFinite(atrValue)||atrValue<0)throw new Error('Invalid projection history');
  const logs=recent.map(c=>Math.log(c.close)),mean=logs.reduce((a,b)=>a+b,0)/24,mid=11.5;
  let numerator=0,denominator=0;
  logs.forEach((value,i)=>{numerator+=(i-mid)*(value-mean);denominator+=(i-mid)**2;});
  const slope=numerator/denominator,last=recent.at(-1).close,projectedLog=Math.log(last)+slope*24;
  const returns=logs.slice(1).map((value,i)=>value-logs[i]),returnMean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const sigma=Math.sqrt(returns.reduce((sum,r)=>sum+(r-returnMean)**2,0)/(returns.length-1));
  const width=2*Math.max(sigma,atrValue/last)*Math.sqrt(24);
  const estimatedPrice=Math.exp(projectedLog),rangeLow=Math.exp(projectedLog-width),rangeHigh=Math.exp(projectedLog+width),changePct=(estimatedPrice/last-1)*100;
  if(![estimatedPrice,rangeLow,rangeHigh,changePct].every(Number.isFinite)||rangeLow<=0)throw new Error('Projection outside numeric bounds');
  return {methodVersion:'friday-price-action-v1',referencePrice:round(last,4),estimatedPrice:round(estimatedPrice,4),rangeLow:round(rangeLow,4),rangeHigh:round(rangeHigh,4),
    projectedChangePct:round(changePct),direction:changePct>.1?'upward':changePct<-.1?'downward':'roughly flat',
    slopePerFiveMinutes:slope,
    method:'Fit a straight-line slope to log closing prices from the last 24 completed five-minute candles, then extend that slope 24 more candles from the last close. The range uses recent return volatility and ATR; it is a heuristic sensitivity band, not a confidence interval.',
    assumptions:'Assumes the recent two-hour price slope continues. Does not model future news, liquidity, gaps, order flow or regime changes.'};
}

export function buildAnalysis(symbol, frames, nowMs) {
  const five=frames['5m'],fifteen=frames['15m'];
  const context=analyzeFrame(fifteen,'15m'),support=context.recentLow,resistance=context.recentHigh;
  const twoHours=five.slice(-24),change=round((twoHours.at(-1).close/twoHours[0].open-1)*100);
  const analysisFrames=Object.fromEntries(Object.entries(frames).map(([label,c])=>[label,analyzeFrame(c,label)]));
  // Indicator scores are transparent rules, not fitted probabilities or calibrated confidence.
  const score=analysisFrames['5m'].score+2*analysisFrames['15m'].score+2*analysisFrames['1h'].score;
  const outlook=score>=5?'bullish':score<=-5?'bearish':'mixed';
  const last=five.at(-1),asOf=(last.time+300)*1000;
  return {symbol,source:'Coinbase Exchange',methodVersion:'monday-rules-v1',status:'current',generatedAt:new Date(nowMs).toISOString(),
    dataAsOf:new Date(asOf).toISOString(),horizonAt:new Date(asOf+7200000).toISOString(),referencePrice:round(last.close,4),bias:outlook,score,
    preview:`${symbol} changed ${change>=0?'+':''}${change}% over the last two completed hours. My rule-based two-hour outlook is ${outlook==='mixed'?'mixed / range-bound':outlook}; it is conditional, not a certainty.`,
    evidence:Object.values(analysisFrames).map(f=>`${f.timeframe}: ${f.trend} EMA trend, RSI ${f.rsi14}; ${f.patterns.length?f.patterns.map(p=>p.name).join(', '):'no named pattern on the latest candle'}.`),
    priceProjection:projectFridayPrice(five,analysisFrames['5m'].atr14),
    frames:analysisFrames,levels:{recentLow:support,recentHigh:resistance},
    scenarios:[
      {name:'Bullish',condition:`15-minute candle closes above $${resistance} with volume above its preceding 20-candle average.`,invalidation:`Return inside the range below $${resistance}.`,description:'A sustained break would favor upward continuation; a brief wick alone is insufficient.'},
      {name:'Bearish',condition:`15-minute candle closes below $${support} with volume above its preceding 20-candle average.`,invalidation:`Return inside the range above $${support}.`,description:'A sustained break would favor downward continuation; a brief wick alone is insufficient.'},
      {name:'Range / mixed',condition:`Price remains between $${support} and $${resistance} without a sustained breakout.`,invalidation:'A sustained close outside the observed range.',description:'Alternating candles and failed breaks would support continued range behavior.'}
    ],
    limitations:'Rules-based technical analysis, not a trained AI model. No calibrated probabilities, order-book analysis, news or backtested accuracy claim. Recent extremes are reference levels, not guaranteed support/resistance. Signals can fail.'};
}

export function createMondayService({fetcher=globalThis.fetch,now=Date.now,historyPath=null}={}) {
  const cache=new Map(),pending=new Map(),retryAt=new Map();let history=[],loaded=false,loadWork=null,persistWork=Promise.resolve(),persistenceError=false;
  async function load(){if(loaded)return;if(!loadWork)loadWork=(async()=>{if(historyPath)try{const data=JSON.parse(await readFile(historyPath,'utf8'));if(!Array.isArray(data))throw new Error('Invalid history');history=data.filter(x=>x?.methodVersion==='monday-rules-v1'&&['BTC','ETH'].includes(x.symbol)&&Number.isFinite(Date.parse(x.horizonAt))&&Number.isFinite(x.referencePrice)).slice(-1000);}catch(e){if(e.code!=='ENOENT')persistenceError=true;}loaded=true;})();await loadWork;}
  async function persist(){if(!historyPath)return;persistWork=persistWork.catch(()=>{}).then(async()=>{try{await mkdir(path.dirname(historyPath),{recursive:true});const temp=historyPath+'.tmp';await writeFile(temp,JSON.stringify(history.slice(-1000)),'utf8');await rename(temp,historyPath);persistenceError=false;}catch{persistenceError=true;}});await persistWork;}
  async function candles(symbol,seconds,count,clock=now()) {
    const end=Math.floor(clock/(seconds*1000))*seconds;
    const url=new URL(`https://api.exchange.coinbase.com/products/${symbol}-USD/candles`);
    url.search=new URLSearchParams({granularity:String(seconds),start:new Date((end-count*seconds)*1000).toISOString(),end:new Date(end*1000).toISOString()}).toString();
    const r=await fetcher(url.href,{headers:{Accept:'application/json','User-Agent':'VaultXMonday/1.0'},signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error('Candle provider unavailable');return normalizeCandles(await r.json(),seconds,end*1000,count);
  }
  async function evaluate(symbol){
    let dirty=false;
    // Per-request cap bounds provider calls. Records are checked when Monday is requested.
    await Promise.all(history.filter(x=>x.symbol===symbol&&!x.result&&Date.parse(x.horizonAt)<=now()&&(x.evaluationRetryAt||0)<=now()).slice(0,5).map(async item => {
      try{const at=Date.parse(item.horizonAt),result=(await candles(symbol,300,1,at))[0];const change=(result.close/item.referencePrice-1)*100;
        // A neutral band is declared in advance; no claim that scenarios actually triggered.
        const realized=change>.1?'bullish':change<-.1?'bearish':'mixed';
        item.result={evaluatedAt:new Date(now()).toISOString(),close:result.close,changePct:round(change,4),realizedDirection:realized,directionalMatch:item.bias===realized};delete item.evaluationRetryAt;dirty=true;
      }catch{item.evaluationRetryAt=now()+300000;dirty=true;}
    }));
    if(dirty)await persist();
  }
  async function get(symbol){
    await load();const clock=now(),bucket=Math.floor(clock/300000)*300000;
    if(!pending.has(symbol)&&cache.get(symbol)?.bucket!==bucket&&clock>=(retryAt.get(symbol)||0)){
      pending.set(symbol,(async()=>{
        try{const sets=await Promise.all(Object.entries(INTERVALS).map(async([label,sec])=>[label,await candles(symbol,sec,120,clock)]));const report=buildAnalysis(symbol,Object.fromEntries(sets),clock);
          let record=history.find(x=>x.symbol===symbol&&x.dataAsOf===report.dataAsOf);
          if(!record){record={id:randomUUID(),symbol,methodVersion:report.methodVersion,dataAsOf:report.dataAsOf,generatedAt:report.generatedAt,horizonAt:report.horizonAt,referencePrice:report.referencePrice,bias:report.bias,score:report.score};history.push(record);history=history.slice(-1000);await persist();}
          report.forecastId=record.id;cache.set(symbol,{bucket,report});retryAt.delete(symbol);await evaluate(symbol);
        }catch{retryAt.set(symbol,now()+60000);}
      })().finally(()=>pending.delete(symbol)));
    }
    if(pending.has(symbol))await pending.get(symbol);
    const saved=cache.get(symbol);if(!saved||saved.bucket!==bucket)return {status:'unavailable',symbol,error:'Complete current candle data is unavailable. No current forecast generated.'};
    const records=history.filter(x=>x.symbol===symbol),evaluated=records.filter(x=>x.result);
    return {...saved.report,tracking:{storage:!historyPath?'memory':persistenceError?'save_failed':'file',totalRecorded:records.length,evaluated:evaluated.length,directionalMatches:evaluated.filter(x=>x.result.directionalMatch).length,
      grading:'After two hours, compare reference-close change to the recorded bias: above +0.1% bullish, below -0.1% bearish, otherwise mixed. Overlapping forecasts are correlated; matches are not calibrated confidence. Evaluation runs on new analysis requests.',records:records.slice(-10).reverse()}};
  }
  return {get};
}
