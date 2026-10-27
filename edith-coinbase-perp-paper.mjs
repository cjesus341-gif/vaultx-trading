// EDITH Coinbase perpetual futures paper sizing. No order submission.
// Contract specifications must come from the authenticated Coinbase product catalog.
const positive=(v,label)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw Error('Invalid '+label);return n;};
export function sizeEdithPerpPaper({product,contracts,entryPrice,stopPrice,marginAvailableUsd,leverage,feeRate=0,slippageRate=0,maintenanceMarginRate=0}){
 if(!product||product.tradingDisabled||product.status&&product.status!=='online'&&product.status!=='ONLINE')throw Error('Contract not tradeable');
 const productId=String(product.productId||'');
 if(!productId)throw Error('Coinbase product ID required');
 const unit=positive(product.contractSize,'contract size');
 const qty=positive(contracts,'contract count');
 if(!Number.isInteger(qty))throw Error('Coinbase contracts must be whole numbers');
 const entry=positive(entryPrice,'entry price'),stop=positive(stopPrice,'stop price');
 const lev=positive(leverage,'leverage');
 const max=Number(product.maxLeverage);
 if(Number.isFinite(max)&&max>0&&lev>max)throw Error('Leverage exceeds product maximum');
 const fee=Number(feeRate),slip=Number(slippageRate),maint=Number(maintenanceMarginRate);
 if(![fee,slip,maint].every(n=>Number.isFinite(n)&&n>=0&&n<1))throw Error('Invalid cost rate');
 const exposure=qty*unit*entry,margin=exposure/lev;
 const available=Number(marginAvailableUsd);
 if(!Number.isFinite(available)||available<0||margin>available)throw Error('Insufficient paper margin');
 const risk=qty*unit*Math.abs(entry-stop);
 const estimatedRoundTripFees=exposure*fee*2;
 const estimatedSlippage=exposure*slip*2;
 return {paperOnly:true,productId,contracts:qty,contractSize:unit,contractRootUnit:product.contractRootUnit||null,entryPrice:entry,stopPrice:stop,leverage:lev,notionalUsd:exposure,initialMarginUsd:margin,marginAvailableUsd:available,priceStopLossUsd:risk,estimatedRoundTripFeesUsd:estimatedRoundTripFees,estimatedSlippageUsd:estimatedSlippage,estimatedStopLossUsd:risk+estimatedRoundTripFees+estimatedSlippage,maintenanceMarginEstimateUsd:exposure*maint,warning:'Stop losses are not guaranteed. Liquidation, funding, spread and price gaps can increase losses. Confirm quote currency and contract multiplier before using this model.'};
}
export function coinbasePerpCandidates(products){
 if(!Array.isArray(products))throw Error('Coinbase product catalog required');
 return products.filter(p=>p&&p.productId&&p.contractSize&&Number(p.contractSize)>0&&String(p.contractExpiryType||'').toUpperCase().includes('PERP')&&!p.tradingDisabled);
}


// One-contract Coinbase paper research gate. Does not submit orders.
export const EDITH_ONE_CONTRACT_POLICY=Object.freeze({startingBalanceUsd:300,contractsPerTrade:1,paperOnly:true});
export function previewEdithOneContract(args){
 const product=args?.product;
 if(!product||product.marketGroup==='international-catalog'||product.eligibleForEdith!==true)
  return {eligible:false,reason:'U.S. futures eligibility not verified'};
 try{
  const order=sizeEdithPerpPaper({...args,contracts:1});
  const limit=EDITH_ONE_CONTRACT_POLICY.startingBalanceUsd*0.02;
  if(order.estimatedStopLossUsd>limit)return {eligible:false,reason:'Stop loss exceeds 2% paper-account risk limit',estimatedStopLossUsd:order.estimatedStopLossUsd};
  return {eligible:true,order};
 }catch(error){return {eligible:false,reason:String(error.message||error)};}
}
