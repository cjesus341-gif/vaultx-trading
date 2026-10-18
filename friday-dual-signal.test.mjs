import test from 'node:test';import assert from 'node:assert/strict';
import {assessDualSignal,scanDualMarkets} from './friday-dual-signal.mjs';
const now=Date.UTC(2026,9,18,20,0);const s=Math.floor(now/1000)-62*300;
function candles({direction=1,n=60,vol=1000}={}){let p=100;return Array.from({length:n},(_,i)=>{const open=p;p+=direction*.09+(i%3===0?.04:0);return {start:String(s+i*300),open:String(open),high:String(Math.max(open,p)+.15),low:String(Math.min(open,p)-.15),close:String(p),volume:String(vol)};});}
test('no false live execution fields or endpoints',async()=>{const d=await scanDualMarkets({readCandles:async()=>({candles:candles()}),markets:['BTC-USD'],now});assert.equal(d.paperOnly,true);assert.equal(d.results.length,1);assert.equal(d.best?.productId===undefined||d.best.productId==='BTC-USD',true);});
test('insufficient candles cause no qualified signal',()=>{const d=assessDualSignal({candles:candles({n:10})},{productId:'XRP-USD',now});assert.equal(d.long.qualified,false);assert.ok(d.error);});
test('invalid market cannot be selected',()=>{const d=assessDualSignal({candles:candles()},{productId:'USDT-USD',now});assert.equal(d.short.qualified,false);});
test('downtrend produces short-side diagnostics',()=>{const d=assessDualSignal({candles:candles({direction:-1})},{productId:'ADA-USD',now});assert.ok(d.short.reasons);assert.ok(d.short.stop>d.short.entry);assert.ok(d.short.target<d.short.entry);});
test('uptrend produces long-side diagnostics',()=>{const d=assessDualSignal({candles:candles()},{productId:'ETH-USD',now});assert.ok(d.long.stop<d.long.entry);assert.ok(d.long.target>d.long.entry);});
test('stale candles always block',()=>{const d=assessDualSignal({candles:candles()},{productId:'BTC-USD',now:now+3600000});assert.ok(d.error);});
