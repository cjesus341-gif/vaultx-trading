import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createMarketServer} from './server.mjs';

test('prices, cache, delayed data, expired data and recovery',async()=>{
 let clock=1000000,calls=0,fail=false;
 const server=createMarketServer({now:()=>clock,fetcher:async url=>{
  calls++; if(fail)throw new Error('Network offline');
  return {ok:true,json:async()=>url.includes('BTC')?{last:'110',open:'100'}:{last:'90',open:'100'}};
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const get=async()=>{const r=await fetch(base+'/api/markets');return [r.status,await r.json()]};
  let [status,body]=await get();assert.equal(status,200);assert.equal(body.markets[0].change24h,10);assert.equal(body.markets[1].change24h,-10);assert.equal(calls,2);
  await Promise.all([get(),get()]);assert.equal(calls,2,'cached responses avoid upstream calls');
  clock+=16000;fail=true;[status,body]=await get();assert.equal(status,200);assert.equal(body.markets[0].status,'delayed');
  clock+=121000;[status,body]=await get();assert.equal(status,503);assert.equal(body.markets[0].price,null);
  fail=false;clock+=16000;[status,body]=await get();assert.equal(status,200);assert.equal(body.markets[0].status,'current');
  assert.equal((await fetch(base+'/api/markets?symbol=INVALID')).status,400);
  const html=await (await fetch(base)).text();assert.ok(html.includes('price-BTC'));assert.ok(!html.includes('BTC:68420'));
  assert.equal((await fetch(base+'/server.mjs')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('malformed provider content is unavailable, never a fabricated price',async()=>{
 const server=createMarketServer({fetcher:async()=>({ok:true,json:async()=>({last:'NaN',open:'0'})})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/markets`);assert.equal(r.status,503);assert.equal((await r.json()).markets[0].price,null);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
