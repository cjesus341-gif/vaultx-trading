// Public read-only Coinbase data smoke test. Does not submit orders or access account data.
import assert from 'node:assert/strict';
const root='https://api.coinbase.com/api/v3/brokerage/market';
async function get(path){
 const r=await fetch(root+path,{headers:{'User-Agent':'VaultX-EDITH-historical-verification/1.0'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Coinbase public API HTTP '+r.status+' on '+path.split('?')[0]);
 return r.json();
}
const catalog=await get('/products?product_type=FUTURE&limit=250');
const items=Array.isArray(catalog.products)?catalog.products:[];
const eligible=items.filter(p=>String(p.future_product_details?.contract_code||'').toUpperCase().startsWith('XPP')&&Number(p.future_product_details?.contract_size)>0);
console.log('Futures catalog:',items.length,'XPP contracts:',eligible.map(x=>x.product_id));
assert.ok(eligible.length,'No XRP perpetual found in public futures catalog; cannot verify');
const product=eligible.find(p=>/PERP/i.test(JSON.stringify(p.future_product_details||{})))||eligible[0];
assert.equal(Number(product.future_product_details.contract_size),500,'Contract size differs from Coinbase published 500 XRP; review required');
const end=Math.floor(Date.now()/900000)*900;
const start=end-240*900;
const candles=await get('/products/'+encodeURIComponent(product.product_id)+'/candles?start='+start+'&end='+end+'&granularity=FIFTEEN_MINUTE&limit=240');
assert.ok(Array.isArray(candles.candles)&&candles.candles.length>=70,'Insufficient actual XRP perp candles');
console.log(JSON.stringify({verifiedProductId:product.product_id,contractSize:product.future_product_details.contract_size,candleCount:candles.candles.length,earliest:new Date(Math.min(...candles.candles.map(c=>Number(c.start)))*1000).toISOString(),latest:new Date(Math.max(...candles.candles.map(c=>Number(c.start)))*1000).toISOString()}));
