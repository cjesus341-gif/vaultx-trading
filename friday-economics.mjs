// Cost-aware evaluation of prospective spot LONG positions. Not a forecast.
const finite = x => typeof x === 'number' && Number.isFinite(x);
export const DEFAULT_MIN_NET_PROFIT_USD = 0.01;
export function evaluateNetEconomics(d,{minNetProfitUsd=DEFAULT_MIN_NET_PROFIT_USD,minNetRR=1.5}={}) {
  const entry=Number(d?.entry), stop=Number(d?.stop), target=Number(d?.target), quantity=Number(d?.quantity),
    entryFee=Number(d?.entryFee), exitFee=Number(d?.exitFee), slippage=Number(d?.slippage);
  if(![entry,stop,target,quantity,entryFee,exitFee,slippage,minNetProfitUsd,minNetRR].every(finite)
    || !(entry>stop&&stop>0&&target>entry&&quantity>0)
    || Math.min(entryFee,exitFee,slippage,minNetProfitUsd,minNetRR)<0)
    return {ok:false,reason:'Invalid price, quantity or fee inputs'};
  const grossProfit=(target-entry)*quantity, grossRisk=(entry-stop)*quantity;
  const costs=entryFee+exitFee+slippage;
  const netProfit=grossProfit-costs, netRisk=grossRisk+costs;
  const grossRR=grossRisk>0?grossProfit/grossRisk:null;
  const netRR=netRisk>0?netProfit/netRisk:null;
  const meetsMinNetProfit=netProfit>=minNetProfitUsd;
  const meetsNetRR=netRR!==null&&netRR>=minNetRR;
  return {ok:meetsMinNetProfit&&meetsNetRR, grossProfitUsd:grossProfit,grossRiskUsd:grossRisk,
    estimatedRoundTripCostUsd:costs,netProfitUsd:netProfit,netRiskUsd:netRisk,grossRR,netRR,
    minNetProfitUsd,minNetRR,meetsMinNetProfit,meetsNetRR,
    reason:!meetsMinNetProfit?'Projected net profit below minimum':!meetsNetRR?'Net reward/risk below minimum':'Passes economic thresholds'};
}
// Only accept a farther take profit backed by provided resistance/target evidence.
// No expansion if the structure target is absent or too close.
export function chooseEvidenceBackedTarget({entry,baselineTarget,structureTarget,atr,maxExtraAtr=0.75}={}){
 const vals=[entry,baselineTarget,structureTarget,atr,maxExtraAtr].map(Number);
 if(!vals.every(finite))return baselineTarget;
 const [e,b,s,a,cap]=vals;
 if(!(e>0&&a>0&&b>e&&s>b&&cap>=0))return baselineTarget;
 return Math.min(s,b+a*cap);
}
export function rankNetOpportunities(rows,{minNetProfitUsd=DEFAULT_MIN_NET_PROFIT_USD,minNetRR=1.5}={}){
 if(!Array.isArray(rows))return [];
 return rows.map(r=>({...r,economics:evaluateNetEconomics(r,{minNetProfitUsd,minNetRR})}))
   .filter(r=>r.economics.ok)
   .sort((a,b)=>b.economics.netProfitUsd-a.economics.netProfitUsd || b.economics.netRR-a.economics.netRR || String(a.productId).localeCompare(String(b.productId)));
}
