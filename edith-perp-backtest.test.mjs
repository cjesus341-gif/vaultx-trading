import test from 'node:test';
import assert from 'node:assert/strict';
import {backtestEdithPerp} from './edith-perp-backtest.mjs';
const candles=Array.from({length:90},(_,i)=>{const price=2+i*.001;return {time:new Date(Date.UTC(2026,0,1)+i*900000).toISOString(),open:price,high:price+.002,low:price-.002,close:price,volume:100};});
test('rejects spot markets',()=>assert.throws(()=>backtestEdithPerp(candles,{productId:'XRP-USD',contractSize:10}),/verified XRP perpetual/));
test('rejects invalid contract sizes',()=>assert.throws(()=>backtestEdithPerp(candles,{productId:'XRP-PERP',contractSize:0}),/Invalid contract/));
test('rejects missing candle intervals',()=>{const copy=candles.filter((_,i)=>i!==30);assert.throws(()=>backtestEdithPerp(copy,{productId:'XRP-PERP',contractSize:10}),/Missing or invalid/);});
test('returns independent zero-trade balances when signals do not fire',()=>{const flat=candles.map(x=>({...x,open:2,high:2.001,low:1.999,close:2}));const r=backtestEdithPerp(flat,{productId:'XRP-PERP',contractSize:10});assert.ok(r.strategies.length>0);for(const s of r.strategies){assert.equal(s.accountBalanceUsd,300);assert.equal(s.netPnlUsd,0);assert.equal(s.trades,0);}});
