// Read-only, fee-aware FIFO for matched BTC spot fills. Never infers missing history.
export function reconcileBtcFills(rawFills,{complete=false,usdcUsd=1}={}){
  if(!Array.isArray(rawFills))throw Error('Fill history missing');
  const seen=new Set(),fills=[],warnings=[];
  for(const f of rawFills){
    const product=String(f.product_id||f.productId||'');
    if(!['BTC-USD','BTC-USDC'].includes(product))continue;
    const id=String(f.entry_id||f.entryId||'');
    const side=String(f.side||'').toUpperCase();
    const size=Number(f.size),price=Number(f.price),fee=Number(f.commission??f.fee);
    const time=String(f.trade_time||f.tradeTime||'');
    if(!id||!time||!['BUY','SELL'].includes(side)||!(size>0&&price>0&&fee>=0)||!Number.isFinite(Date.parse(time))){warnings.push('Malformed Coinbase fill ignored');continue;}
    if(seen.has(id))continue;seen.add(id);
    fills.push({id,side,size,price,fee,time,product,orderId:String(f.order_id||f.orderId||'')});
  }
  fills.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)||a.id.localeCompare(b.id));
  const lots=[],trades=[];let unmatchedSellBtc=0,realized=0,feeTotalUsd=0,bought=0,sold=0;
  for(const f of fills){
    const rate=f.product==='BTC-USDC'?usdcUsd:1;
    if(!(rate>0&&Number.isFinite(rate)))throw Error('Quote valuation unavailable');
    feeTotalUsd+=f.fee*rate;
    if(f.side==='BUY'){lots.push({remaining:f.size,unitCost:f.price*rate+f.fee*rate/f.size,source:f});bought+=f.size;continue;}
    sold+=f.size;let remaining=f.size;
    const proceedsPerBtc=(f.price-f.fee/f.size)*rate;
    for(const lot of lots){if(remaining<=1e-12)break;if(lot.remaining<=1e-12)continue;
      const qty=Math.min(remaining,lot.remaining);lot.remaining-=qty;remaining-=qty;
      const cost=qty*lot.unitCost,proceeds=qty*proceedsPerBtc,pnl=proceeds-cost;
      trades.push({buyOrderId:lot.source.orderId,sellOrderId:f.orderId,boughtAt:lot.source.time,soldAt:f.time,buyPair:lot.source.product,sellPair:f.product,btc:qty,costUsd:cost,proceedsUsd:proceeds,pnlUsd:pnl,returnPct:cost>0?pnl/cost*100:null});realized+=pnl;
    }
    if(remaining>1e-12)unmatchedSellBtc+=remaining;
  }
  const openBtc=lots.reduce((a,l)=>a+l.remaining,0);
  if(!complete)warnings.push('Coinbase pagination or inventory coverage is incomplete');
  if(unmatchedSellBtc>1e-12)warnings.push('Sell fills without matching earlier buys; realized P&L incomplete');
  if(fills.some(f=>f.product==='BTC-USDC'))warnings.push('USDC valued at '+usdcUsd+' USD for this report; depeg/FX differences excluded');
  if(openBtc>1e-12)warnings.push('Open BTC lots have no mark-to-market price in this report');
  const matchedFillCoverage=complete&&unmatchedSellBtc<=1e-12&&warnings.every(w=>!w.includes('Malformed'));
  const reliable=false; // Transfers, outside fills, opening holdings and other portfolios can invalidate account-wide P&L.
  return {reliable,matchedFillCoverage,complete,matchedTrades:trades,realizedPnlUsd:realized,feesUsd:feeTotalUsd,openBtc,unmatchedSellBtc,boughtBtc:bought,soldBtc:sold,fillCount:fills.length,warnings,quoteAssumption:'BTC-USDC translated with USDC/USD='+usdcUsd};
}
