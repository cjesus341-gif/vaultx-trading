// Input validation for non-executing Coinbase verification endpoints.
export function previewRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid preview input');
  const amount=Number(input.amountUsd),entry=Number(input.entryPrice),stop=Number(input.stopPrice),target=Number(input.targetPrice);
  if(![amount,entry,stop,target].every(Number.isFinite)||amount<1||amount>100||entry<=0||stop<=0||target<=0)throw Error('Enter a valid amount ($1–$100), BTC entry, stop and target');
  if(!(stop<entry&&entry<target))throw Error('For a BTC long, stop must be below entry and target above entry');
  const baseSize=Math.floor(amount/entry*1e8)/1e8;
  if(baseSize<=0)throw Error('Amount too small for BTC precision');
  return {product_id:'BTC-USD',side:'BUY',order_configuration:{limit_limit_gtc:{base_size:baseSize.toFixed(8),limit_price:entry.toFixed(2),post_only:false}},attached_order_configuration:{trigger_bracket_gtc:{base_size:baseSize.toFixed(8),limit_price:target.toFixed(2),stop_trigger_price:stop.toFixed(2)}}};
}
export function orderLookupId(value){
  if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{8,128}$/.test(value))throw Error('Enter a valid Coinbase order ID');
  return value;
}
export function summarizePreview(data){
  if(!data||typeof data!=='object')throw Error('Invalid Coinbase preview response');
  const errors=Array.isArray(data.errs)?data.errs.map(x=>String(x)).slice(0,12):[];
  if(typeof data.error==='string')errors.push(data.error);
  return {previewId:data.preview_id||null,feeEstimate:data.commission_total||null,orderTotal:data.order_total||null,quoteSize:data.quote_size||null,baseSize:data.base_size||null,slippage:data.slippage||null,errors,acceptedForPreview:errors.length===0&&Boolean(data.preview_id),protectionVerified:false,noOrderSubmitted:true};
}
export function summarizeOrder(data){
  const order=data?.order;
  if(!order||typeof order!=='object')throw Error('Coinbase did not return an order');
  if(order.product_id!=='BTC-USD')throw Error('Order is not BTC-USD');
  return {orderId:order.order_id,status:order.status||'UNKNOWN',side:order.side||null,filledSize:order.filled_size||null,completionPercentage:order.completion_percentage||null,averageFilledPrice:order.average_filled_price||null,attachedOrderConfiguration:order.attached_order_configuration||null,numberOfFills:order.number_of_fills??null,settled:order.settled??null,readOnly:true};
}

// Estimates TOTAL planned loss, including a previewed entry fee, estimated exit fee,
// and a slippage buffer. This does not guarantee stop execution or future fees.
export function feeAwareRisk({amountUsd,entryPrice,stopPrice,feeEstimate,availableUsd,riskPct=0.5,slippagePct=0.1}){
  const values=[amountUsd,entryPrice,stopPrice,feeEstimate,availableUsd,riskPct,slippagePct].map(Number);
  if(values.some(x=>!Number.isFinite(x)))return {allowed:false,reason:'Wallet or fee estimate unavailable; cannot verify risk.'};
  const [amount,entry,stop,fee,wallet,risk,slip]=values;
  if(!(amount>0&&entry>stop&&stop>0&&fee>=0&&wallet>=0&&risk>0&&risk<=1&&slip>=0&&slip<=2))return {allowed:false,reason:'Invalid amount, prices, fees or risk configuration.'};
  const plannedPriceLoss=amount*(entry-stop)/entry;
  // Exit fee assumes the same absolute charge as entry; actual fees can differ.
  const projectedExitFee=fee;
  const slippageReserve=amount*slip/100;
  const estimatedTotalRisk=plannedPriceLoss+fee+projectedExitFee+slippageReserve;
  const riskBudget=wallet*risk/100;
  const totalCashRequired=amount+fee;
  const capByStopAndFees=Math.max(0,(riskBudget-2*fee)/( (entry-stop)/entry + slip/100));
  const suggestedMaxAmount=Math.max(0,Math.min(wallet-fee,capByStopAndFees));
  const allowed=estimatedTotalRisk<=riskBudget+1e-9&&totalCashRequired<=wallet+1e-9;
  return {allowed,reason:allowed?'Within estimated risk allowance; Coinbase protections remain unverified.':
    (totalCashRequired>wallet?'Trade plus entry fee exceeds available USD.':'Estimated risk including both fees and slippage exceeds your risk budget.'),
    availableUsd:wallet,riskPct:risk,riskBudget,amountUsd:amount,entryFee:fee,projectedExitFee,
    plannedPriceLoss,slippageReserve,estimatedTotalRisk,totalCashRequired,suggestedMaxAmount,
    assumptions:'Exit fee estimated at entry fee; slippage allowance is a planning buffer, NOT a guaranteed maximum loss.',
    realOrderEnabled:false};
}
