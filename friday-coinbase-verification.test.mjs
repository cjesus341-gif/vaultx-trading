import test from 'node:test';import assert from 'node:assert/strict';
import {previewRequest,orderLookupId,summarizePreview,summarizeOrder,feeAwareRisk} from './friday-coinbase-verification.mjs';
const good={amountUsd:5,entryPrice:80000,stopPrice:79000,targetPrice:82000};
test('valid protected limit-buy preview constructed',()=>{const b=previewRequest(good);assert.equal(b.side,'BUY');assert.equal(b.order_configuration.limit_limit_gtc.base_size,'0.00006250');assert.equal(b.attached_order_configuration.trigger_bracket_gtc.stop_trigger_price,'79000.00')});
test('bad protection is rejected',()=>assert.throws(()=>previewRequest({...good,stopPrice:81000}),/stop must/));
test('amount cap rejects',()=>assert.throws(()=>previewRequest({...good,amountUsd:101}),/valid amount/));
test('order id rejects path injection',()=>assert.throws(()=>orderLookupId('../bad'),/valid/));
test('preview alone never certifies protection',()=>{const d=summarizePreview({preview_id:'p1'});assert.equal(d.protectionVerified,false);assert.equal(d.noOrderSubmitted,true)});
test('preview rejects quoted errors',()=>assert.equal(summarizePreview({errs:['PREVIEW_INVALID']}).acceptedForPreview,false));
test('only BTC order can be inspected',()=>assert.throws(()=>summarizeOrder({order:{product_id:'ETH-USD'}}),/BTC-USD/));

test('fee-aware stop-risk rejects $5 on $9.75 wallet at 0.5%',()=>{
 const r=feeAwareRisk({amountUsd:5,entryPrice:81000,stopPrice:79000,feeEstimate:0.0449317384524,availableUsd:9.75,riskPct:0.5});
 assert.equal(r.allowed,false);assert.ok(r.estimatedTotalRisk>r.riskBudget);
});
test('fee-aware risk permits sufficiently low cost and defined stop',()=>{
 const r=feeAwareRisk({amountUsd:20,entryPrice:100,stopPrice:99,feeEstimate:0.01,availableUsd:1000,riskPct:0.5});assert.equal(r.allowed,true);
});
test('missing fee quote fails closed',()=>assert.equal(feeAwareRisk({amountUsd:5,entryPrice:100,stopPrice:99,feeEstimate:undefined,availableUsd:10}).allowed,false));
import {assessProductEligibility} from './friday-coinbase-verification.mjs';
const sampleProduct={product_id:'BTC-USD',quote_min_size:'1',base_min_size:'0.00000001',base_increment:'0.00000001',price_increment:'0.01'};
test('BTC minimum rejects estimated allowable amount smaller than minimum',()=>{const r=assessProductEligibility(sampleProduct,{amountUsd:0.89,entryPrice:80700,risk:{allowed:true},previewAccepted:true});assert.equal(r.allowed,false);assert.match(r.reason,/minimum/);});
test('BTC preview approval cannot override fee risk',()=>{const r=assessProductEligibility(sampleProduct,{amountUsd:5,entryPrice:80700,risk:{allowed:false},previewAccepted:true});assert.equal(r.allowed,false);assert.match(r.reason,/risk/);});
test('BTC minimum missing, trading disabled and missing increments block',()=>{for(const p of [{...sampleProduct,quote_min_size:null,base_min_size:null},{...sampleProduct,trading_disabled:true},{...sampleProduct,base_increment:null}])assert.equal(assessProductEligibility(p,{amountUsd:5,entryPrice:80700,risk:{allowed:true},previewAccepted:true}).allowed,false);});
test('qualified product sizing still does not enable execution',()=>{const r=assessProductEligibility(sampleProduct,{amountUsd:5,entryPrice:80700,risk:{allowed:true},previewAccepted:true});assert.equal(r.allowed,true);assert.equal(r.liveOrderEnabled,false);});
