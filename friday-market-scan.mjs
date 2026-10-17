// Friday V29: portfolio-scoped, read-only multi-market research. Never submits an order.
import {qualifyFriday} from './friday-engine.mjs';
import {DEFAULT_WATCHLIST,assessMarketCandidate,selectMarket} from './friday-market-selector.mjs';
const num=x=>Number(x);
const finite=x=>Number.isFinite(x);
function firstBook(raw){
  const b=raw?.pricebooks?.[0]||raw?.pricebook||raw||{};
  return {bid:num(b.bids?.[0]?.price),ask:num(b.asks?.[0]?.price)};
}
export async function scanFridayMarkets({markets=DEFAULT_WATCHLIST,reportFor,productFor,bookFor,settings,now=Date.now(),maxOrderUsd=2.5}={}){
  if(!reportFor||!productFor||!bookFor)throw Error('Missing read-only market providers');
  if(!Array.isArray(markets)||markets.length>DEFAULT_WATCHLIST.length||new Set(markets).size!==markets.length||markets.some(id=>!DEFAULT_WATCHLIST.includes(id)))throw Error('Invalid watchlist');
  const checks=[];const candidates=[];
  // Sequential and bounded: avoid hitting Coinbase or candle-provider API rate limits.
  for(const id of markets){
    const base=id.split('-')[0];
    try{
      const [report,rawProduct,rawBook]=await Promise.all([reportFor(base),productFor(id),bookFor(id)]);
      const p=rawProduct?.product||rawProduct;
      if(!p||p.product_id!==id)throw Error('Coinbase product identity mismatch');
      const signal=report?.status==='current'?qualifyFriday(report,settings,now):null;
      const {bid,ask}=firstBook(rawBook);
      const mid=(bid+ask)/2;
      const spreadBps=bid>0&&ask>=bid?10000*(ask-bid)/mid:NaN;
      const volumeUsd=num(p.volume_24h)*num(p.price);
      // Indicative fee reserve only; cannot authorize trading. Exchange preview is required before orders.
      const entry=num(p.price),stop=num(signal?.stop),target=num(signal?.target);
      const tradeSizeUsd=Math.min(maxOrderUsd,2.5);
      const size=entry>0?tradeSizeUsd/entry:0;
      const feeReserve=tradeSizeUsd*.02; // 1% on each leg, intentionally conservative estimate
      const netRiskUsd=(entry-stop)*size+feeReserve;
      const netRewardUsd=(target-entry)*size-feeReserve;
      const candidate={product:p,productId:id,signal:{...signal,completedCandle:!!signal?.closedAt,fresh:!!signal?.qualified},spreadBps,volumeUsd,netRiskUsd,netRewardUsd,
        score:signal?.qualified&&finite(netRiskUsd)&&netRiskUsd>0?netRewardUsd/netRiskUsd:0};
      const assessment=assessMarketCandidate(candidate,{maxOrderUsd});
      // A read-only estimate never makes an asset eligible for real execution.
      checks.push({...assessment,signalQualified:signal?.qualified===true,failedSignalChecks:signal?.checks?.filter(c=>!c.pass).map(c=>c.name)||[],
        signalCandle:signal?.closedAt||null,spreadBps:finite(spreadBps)?Number(spreadBps.toFixed(2)):null,
        volumeUsd:finite(volumeUsd)?Math.round(volumeUsd):null,estimatedNetRewardRisk:finite(candidate.score)?Number(candidate.score.toFixed(2)):null,
        readOnly:true,feeBasis:'Estimated 1% buy and 1% sell; Coinbase preview required'});
      candidates.push(candidate);
    }catch(e){checks.push({productId:id,eligible:false,signalQualified:false,reasons:['Market data unavailable: '+String(e.message||'unknown').slice(0,110)],readOnly:true});}
  }
  const selection=selectMarket(candidates,{maxOrderUsd});
  return {readOnly:true,liveRoutingEnabled:false,scannedAt:new Date(now).toISOString(),selected:selection.selected?.productId||null,
    qualifiedCount:checks.filter(x=>x.eligible).length,checks,
    note:'Research ranking only. No cross-market order submission is connected. Fee reserve is estimated; live order previews, global position checks, product precision and bracket support are still required.'};
}
