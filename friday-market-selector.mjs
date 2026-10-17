// VaultX v28 — market-selection foundation. Pure decision logic only: NO order submissions.
export const DEFAULT_WATCHLIST=Object.freeze(['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD','LTC-USD']);
export const DEFAULT_STABLE_QUOTES=Object.freeze(['USD','USDC']);
const numeric=value=>Number(value);
const terminal = value=>['DISABLED','CANCEL_ONLY','OFFLINE','DELISTED'].includes(String(value||'').toUpperCase());
export function assessMarketCandidate(candidate,{maxOrderUsd=2.5,minimumNetRewardRisk=1.5,minimumVolumeUsd=1000000}={}){
  const c=candidate||{}, p=c.product||{}, s=c.signal||{}, reasons=[];
  const productId=String(p.product_id||c.productId||'');
  const [base,quote]=productId.split('-');
  if(!DEFAULT_WATCHLIST.includes(productId))reasons.push('Market is not enabled in watchlist');
  if(!DEFAULT_STABLE_QUOTES.includes(quote))reasons.push('Quote currency not enabled');
  if(['USDT','USDC','USD','DAI'].includes(base))reasons.push('Stablecoin base excluded from momentum entries');
  if(p.trading_disabled||p.is_disabled||p.cancel_only||terminal(p.status))reasons.push('Product restricted or disabled');
  const price=numeric(p.price||s.price), stop=numeric(s.stop), target=numeric(s.target);
  const quoteMin=numeric(p.quote_min_size), baseMin=numeric(p.base_min_size), baseStep=numeric(p.base_increment);
  const volUsd=numeric(c.volumeUsd);
  if(!(s.qualified===true&&s.side==='LONG'&&s.completedCandle===true&&s.fresh===true))reasons.push('Fresh completed-candle LONG qualification missing');
  if(!(price>0&&stop>0&&stop<price&&target>price))reasons.push('Protective prices invalid');
  if(!(quoteMin>0&&baseMin>0&&baseStep>0))reasons.push('Exchange size constraints unavailable');
  if(!(quoteMin<=maxOrderUsd))reasons.push('Order minimum exceeds pilot cap');
  if(!(Number.isFinite(volUsd)&&volUsd>=minimumVolumeUsd))reasons.push('USD liquidity insufficient or unknown');
  const spreadBps=numeric(c.spreadBps);
  if(!(Number.isFinite(spreadBps)&&spreadBps>=0&&spreadBps<=35))reasons.push('Spread unknown or too wide');
  const netRisk=numeric(c.netRiskUsd),netReward=numeric(c.netRewardUsd);
  if(!(netRisk>0&&netReward>=netRisk*minimumNetRewardRisk))reasons.push('Fee-inclusive net reward/risk insufficient');
  const score=Number.isFinite(numeric(c.score))?numeric(c.score):0;
  return {productId,eligible:reasons.length===0,reasons,score,quote,base};
}
export function selectMarket(candidates,options){
  const checks=(candidates||[]).map(c=>assessMarketCandidate(c,options));
  const eligible=checks.filter(c=>c.eligible).sort((a,b)=>b.score-a.score||a.productId.localeCompare(b.productId));
  return {selected:eligible[0]||null,checks,reason:eligible.length?'Highest ranked fully qualified market':'No eligible market. Remain in cash.'};
}
