import assert from 'node:assert/strict';
import {reconcileBtcFills} from './friday-performance.mjs';
import {test} from 'node:test';
const rows=[{entry_id:'a',product_id:'BTC-USD',side:'BUY',size:'0.00002393',price:'81886.32',commission:'.02',trade_time:'2026-10-16T04:11:05Z',order_id:'buy'},{entry_id:'b',product_id:'BTC-USDC',side:'SELL',size:'0.00002393',price:'81945.84',commission:'.02',trade_time:'2026-10-16T06:12:40Z',order_id:'sell'}];
test('Matches USD buy and USDC sell, fee-inclusive, zero BTC open',()=>{const x=reconcileBtcFills(rows,{complete:true});assert.equal(x.fillCount,2);assert.equal(x.matchedTrades.length,1);assert.ok(Math.abs(x.realizedPnlUsd-(.00002393*(81945.84-81886.32)-.04))<1e-9);assert.equal(x.openBtc,0);assert.equal(x.matchedFillCoverage,true);assert.equal(x.reliable,false);});
test('Does not report fully reliable if coverage incomplete',()=>assert.equal(reconcileBtcFills(rows).reliable,false));
test('Sell without a matched buy is not invented',()=>{const x=reconcileBtcFills(rows.slice(1),{complete:true});assert.equal(x.matchedTrades.length,0);assert.ok(x.unmatchedSellBtc>0);assert.equal(x.reliable,false);});
test('Deduplicates identical fills',()=>assert.equal(reconcileBtcFills([...rows,rows[0]],{complete:true}).fillCount,2));
test('Reports open holdings rather than a realized gain',()=>{const x=reconcileBtcFills(rows.slice(0,1),{complete:true});assert.equal(x.realizedPnlUsd,0);assert.ok(x.openBtc>0);});
