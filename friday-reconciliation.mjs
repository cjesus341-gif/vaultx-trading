// Read-only BTC order inventory. Incomplete or inconsistent pagination fails closed.
export async function fetchBtcOrderInventory(request,{maxPages=20,pageSize=100}={}) {
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>50)throw Error('Invalid maximum pages');
  const orders=[],seen=new Set();let cursor=null,complete=false,pages=0;
  for(let i=0;i<maxPages;i++){
    const data=await request('GET','/api/v3/brokerage/orders/historical/batch',{query:{product_ids:'BTC-USD',limit:pageSize,...(cursor?{cursor}:{})}});
    if(!Array.isArray(data?.orders))throw Error('Coinbase order page unavailable');
    for(const raw of data.orders){
      if(raw?.product_id!=='BTC-USD')continue;
      const id=String(raw.order_id||'');if(!id)throw Error('Coinbase order missing ID');
      if(seen.has(id))continue;seen.add(id);
      orders.push({orderId:id,productId:'BTC-USD',side:String(raw.side||''),status:String(raw.status||''),clientOrderId:String(raw.client_order_id||''),createdTime:raw.created_time||null,filledSize:String(raw.filled_size||''),completionPercentage:String(raw.completion_percentage||'')});
    }
    pages++;
    const next=typeof data.cursor==='string'&&data.cursor?data.cursor:null;
    if(data.has_next===false){complete=true;break;}
    // Only an explicit has_next=false proves the endpoint has reached its end.
    if(data.has_next!==true||!next||seen.has('cursor:'+next))break;
    seen.add('cursor:'+next);cursor=next;
  }
  return {orders,complete,pages,scope:'BTC-USD returned by the connected API portfolio only',warning:complete?'Order history paginated to endpoint end; other portfolios and product positions remain unverified.':'Coinbase pagination incomplete; unresolved orders cannot be ruled out.'};
}
export function assessRiskLimits({usdAvailable,desiredRiskPct=0.5,maxOrderUsd=100,existingExposureUsd=null,realizedPnlUsd=null,dailyLossLimitUsd=2,maxExposureUsd=10}={}){
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const checks=[];const add=(name,passed,detail)=>checks.push({name,passed,detail});
  add('Risk budget valid',finite(usdAvailable)&&usdAvailable>=0&&finite(desiredRiskPct)&&desiredRiskPct>0&&desiredRiskPct<=1,`Risk ${desiredRiskPct}% of available USD; values are estimates`);
  const planned=finite(usdAvailable)?usdAvailable*desiredRiskPct/100:null;
  add('Maximum order constraint',finite(maxOrderUsd)&&maxOrderUsd>0&&finite(maxExposureUsd)&&maxExposureUsd>0,`Order cap $${maxOrderUsd}; exposure ceiling $${maxExposureUsd}`);
  add('Total exposure reconciled',finite(existingExposureUsd)&&existingExposureUsd>=0,existingExposureUsd===null?'Unknown across orders/holdings':'Reported exposure $'+existingExposureUsd);
  add('Daily realized P&L reconciled',finite(realizedPnlUsd),'Authoritative realized P&L is required, not inferred from a truncated fill history');
  add('Daily loss below limit',finite(realizedPnlUsd)&&finite(dailyLossLimitUsd)&&dailyLossLimitUsd>0&&realizedPnlUsd>-dailyLossLimitUsd,`Loss cutoff $${dailyLossLimitUsd}; unknown data blocks trading`);
  return {approved:false,plannedRiskUsd:planned,checks,notice:'Advisory only; these checks do not authorize automatic trading or represent authoritative portfolio-wide exposure.'};
}
