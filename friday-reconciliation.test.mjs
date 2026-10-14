import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBtcOrderInventory,assessRiskLimits} from './friday-reconciliation.mjs';
const order=(id,status='FILLED')=>({product_id:'BTC-USD',order_id:id,status,side:'BUY'});
test('paginated orders include unresolved from a later page',async()=>{
 const pages=[{orders:[order('1')],cursor:'next',has_next:true},{orders:[order('2','OPEN')],has_next:false}];let calls=0;
 const r=await fetchBtcOrderInventory(async()=>pages[calls++]);
 assert.equal(r.complete,true);assert.equal(r.pages,2);assert.equal(r.orders[1].status,'OPEN');
});
test('missing pagination cursor never claims complete',async()=>{
 const r=await fetchBtcOrderInventory(async()=>({orders:[],has_next:true}));assert.equal(r.complete,false);
});
test('pagination cap fails closed',async()=>{
 let i=0;const r=await fetchBtcOrderInventory(async()=>({orders:[order(String(++i))],cursor:'c'+i,has_next:true}),{maxPages:2});
 assert.equal(r.complete,false);assert.equal(r.pages,2);
});
test('unknown order states never disappear from inventory',async()=>{
 const r=await fetchBtcOrderInventory(async()=>({orders:[order('1','MYSTERY')],has_next:false}));assert.equal(r.orders[0].status,'MYSTERY');
});
test('risk constraints fail closed when realized PnL and total exposure unknown',()=>{
 const r=assessRiskLimits({usdAvailable:9.75,desiredRiskPct:0.5,maxOrderUsd:100});
 assert.equal(r.approved,false);assert.equal(r.plannedRiskUsd,0.04875);
 assert.equal(r.checks.find(x=>x.name==='Daily loss below limit').passed,false);
 assert.equal(r.checks.find(x=>x.name==='Total exposure reconciled').passed,false);
});
