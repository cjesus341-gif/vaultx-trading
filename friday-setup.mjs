// Friday V19: indicative BTC spot-long setup from completed candles, never a trade signal.
const PERIOD={ '5m':300,'15m':900,'1h':3600 };
const finite=x=>Number.isFinite(Number(x))?Number(x):NaN;
export function proposeFridaySetup({report,product,referencePrice,timeframe='5m',riskPct=0.5,availableUsd,nowMs=Date.now(),rr=2}={}){
  const rejected=(reason)=>({eligible:false,reason,noOrderSubmitted:true,executionEnabled:false,timeframe});
  if(!Object.hasOwn(PERIOD,timeframe))return rejected('Unsupported timeframe: use 5m, 15m, or 1h.');
  if(report?.status!=='current'||!report?.frames?.[timeframe])return rejected('Current, complete Friday candle analysis unavailable.');
  const frame=report.frames[timeframe],atr=finite(frame.atr14),entry=finite(referencePrice),usd=finite(availableUsd),risk=finite(riskPct);
  const closed=Date.parse(frame.closedAt),age=nowMs-closed;
  if(!Number.isFinite(closed)||age<0||age>PERIOD[timeframe]*2000+30000)return rejected('Timeframe candles are stale or timestamp invalid.');
  if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(atr)||atr<=0||!Number.isFinite(usd)||usd<0||!Number.isFinite(risk)||risk<=0||risk>1)return rejected('Price, ATR, wallet balance or risk setting invalid.');
  if(frame.recentCandles?.length<24)return rejected('Not enough completed candle history to suggest chart levels.');
  const priceIncrement=finite(product?.price_increment),baseIncrement=finite(product?.base_increment),quoteMin=finite(product?.quote_min_size),baseMin=finite(product?.base_min_size);
  if(!(priceIncrement>0&&baseIncrement>0&&quoteMin>0&&baseMin>0))return rejected('Coinbase minimum sizes and increments not verified.');
  if(product?.trading_disabled||product?.is_disabled||product?.cancel_only)return rejected('Coinbase product restricted.');
  const support=finite(frame.recentLow);
  // ATR-based initial stop; nearby support can only widen it, never pull it closer.
  const atrStop=entry-1.5*atr;
  const structureStop=Number.isFinite(support)&&support>0&&support<entry?support-0.1*atr:atrStop;
  const rawStop=Math.min(atrStop,structureStop);
  const stop=Math.floor(rawStop/priceIncrement)*priceIncrement;
  const target=Math.ceil((entry+(entry-stop)*rr)/priceIncrement)*priceIncrement;
  const distance=(entry-stop)/entry;
  if(!(stop>0&&stop<entry&&target>entry&&distance>0&&distance<=0.1))return rejected('Chart-derived stop is invalid or more than 10% below entry.');
  const minimumUsd=Math.max(quoteMin,baseMin*entry);
  // Conservative *provisional* fee allowance, not Coinbase's quote. 1% on each side + 0.1% slippage.
  const estimatedRiskRate=distance+0.021;
  const budget=usd*risk/100;
  const theoreticalMax=Math.min(usd/1.01,budget/estimatedRiskRate,100);
  const incrementUsd=baseIncrement*entry;
  const units=Math.floor((theoreticalMax/entry)/baseIncrement+1e-7);
  const executableBase=units*baseIncrement;
  const amountUsd=Math.floor((executableBase*entry)*100)/100;
  const format=n=>Number(n.toFixed(2));
  const output={eligible:false,noOrderSubmitted:true,executionEnabled:false,timeframe,entryMode:'market',entryPrice:format(entry),stopPrice:format(stop),targetPrice:format(target),
    atr:atr,stopDistancePct:Number((distance*100).toFixed(3)),riskPct:risk,riskBudget:budget,minimumUsd:Number(minimumUsd.toFixed(4)),suggestedAmountUsd:amountUsd,
    estimatedRiskAtSuggestion:amountUsd*estimatedRiskRate,feeModel:'Provisional 1% entry + 1% exit + 0.1% slippage; must be replaced with Coinbase preview fees.',
    candleClosedAt:frame.closedAt,chartTrend:frame.trend,patternNames:(frame.patterns||[]).map(x=>x.name),strategyQualified:false};
  // This tool proposes levels, does NOT confer strategy qualification.
  if(amountUsd<minimumUsd-1e-8||amountUsd<1)return {...output,reason:'NO TRADE: estimated fee-aware size is smaller than Coinbase minimum. Funding is optional; do not bypass the risk rule.'};
  if(!Number.isFinite(amountUsd)||amountUsd<=0)return {...output,reason:'NO TRADE: cannot size this setup.'};
  return {...output,eligible:true,reason:'Indicative setup ready for Coinbase preview ONLY. Friday entry conditions and exchange protections are not verified.'};
}
