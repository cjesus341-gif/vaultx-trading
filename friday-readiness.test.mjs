import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFridayReadiness,classifyBtcOrders,FRIDAY_LIVE_AUTO_EXECUTION_ENABLED} from './friday-readiness.mjs';
test('hard live gate stays closed even when basic API checks pass',()=>{
  const result=assessFridayReadiness({accounts:[{currency:'USD',availableBalance:'100'},{currency:'BTC',availableBalance:'0'}],orders:[],fills:[],liveTradingEnabled:true,maxOrderUsd:100,persistent:true});
  assert.equal(FRIDAY_LIVE_AUTO_EXECUTION_ENABLED,false);
  assert.equal(result.automaticExecutionEnabled,false);
  assert.equal(result.readyForUnattendedTrading,false);
  assert.equal(result.checks.find(c=>c.name==='Verified protected exit lifecycle').passed,false);
});
test('unsettled BTC order blocks readiness',()=>{
 const result=assessFridayReadiness({accounts:[],orders:[{productId:'BTC-USD',orderId:'1',side:'BUY',status:'OPEN'}],fills:[]});
 assert.equal(result.orders.unsettledCount,1);
 assert.equal(result.checks.find(c=>c.name==='No unresolved BTC orders in sample').passed,false);
});
test('unknown status is treated as unsettled and other products ignored',()=>{
 assert.equal(classifyBtcOrders([{productId:'ETH-USD',status:'OPEN'},{productId:'BTC-USD',status:'IN_REVIEW'}]).unsettledCount,1);
});
test('no failed API call can yield unattended readiness',()=>{
 const result=assessFridayReadiness({checksError:'Provider unavailable'});
 assert.equal(result.checks[0].passed,false);
 assert.equal(result.readyForUnattendedTrading,false);
});
