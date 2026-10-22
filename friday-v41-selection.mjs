// V41 read-only selection for the existing single Friday autopilot.
// Never authorizes execution; server's protected Coinbase preflight remains mandatory.
export const V41_MARKETS=Object.freeze(['BTC-USD','ETH-USD','SOL-USD','XRP-USD','ADA-USD','DOGE-USD','LINK-USD','AVAX-USD','LTC-USD']);
const finite=x=>Number.isFinite(Number(x));
export function evaluateLongCandidates(scan,{now=Date.now(),maxAgeMs=10*60000}={}){
 const rejected=[],eligible=[];
 if(scan?.readOnly!==true||!Array.isArray(scan?.results))return {readOnly:true,selected:null,eligible:[],rejected:[],reason:'Fresh read-only scan unavailable'};
 for(const item of scan.results){
  const id=String(item?.productId||'');const v=item?.long||{};
  const reasons=[];
  if(!V41_MARKETS.includes(id))reasons.push('Unsupported market');
  if(v.qualified!==true)reasons.push('No qualified LONG');
  const t=Date.parse(item?.closedAt||'');
  if(!Number.isFinite(t)||t>now+10000||now-t>maxAgeMs)reasons.push('Signal is stale or timestamp invalid');
  if(!finite(v.entry)||Number(v.entry)<=0||!finite(v.stop)||Number(v.stop)<=0||Number(v.stop)>=Number(v.entry)||!finite(v.target)||Number(v.target)<=Number(v.entry))reasons.push('Invalid protective levels');
  if(v.costViable!==true)reasons.push('Fee-aware costs not validated');
  if(!finite(v.estimatedNetRR)||Number(v.estimatedNetRR)<1.5)reasons.push('Net reward/risk below 1.5:1');
  if(reasons.length){rejected.push({productId:id,reasons});continue;}
  eligible.push({productId:id,closedAt:item.closedAt,side:'LONG',qualified:true,price:Number(v.entry),stop:Number(v.stop),target:Number(v.target),netRR:Number(v.estimatedNetRR),source:'V41_MULTI_LONG'});
 }
 eligible.sort((a,b)=>b.netRR-a.netRR||a.productId.localeCompare(b.productId));
 return {readOnly:true,selected:eligible[0]||null,eligible,rejected,reason:eligible.length?'Nomination only; Coinbase preflight and order guards still required':'No eligible fee-aware fresh LONG signals'};
}
