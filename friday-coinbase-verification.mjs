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
