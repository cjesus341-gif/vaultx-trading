import test from 'node:test';
import assert from 'node:assert/strict';
import {U_PAIRS,U_EXPERIMENTS,uStatus,uPipSize,backtestU} from './u-forex-engine.mjs';
const start=Date.parse('2026-01-05T00:00:00Z');
function candles(n=100){return Array.from({length:n},(_,i)=>{
 const open=1.1+i*0.00005,close=open+0.00004;
 return {time:new Date(start+i*900000).toISOString(),open,high:close+0.00002,low:open-0.00002,close};
});}
test('U contains all ten FX pairs and five independent experiments',()=>{
 assert.equal(U_PAIRS.length,10);assert.equal(new Set(U_PAIRS).size,10);
 assert.deepEqual(U_EXPERIMENTS.map(x=>x.id),['A','B','C','D','E']);
 assert.equal(uPipSize('USD/JPY'),0.01);assert.equal(uPipSize('GBP/USD'),0.0001);
 assert.equal(uStatus().liveExecution,false);assert.equal(uStatus().scanRunning,false);
});
test('no data connection cannot fabricate trades',()=>{
 assert.throws(()=>backtestU({pair:'GBP/USD',candles:candles()}),/news coverage/);
 assert.throws(()=>backtestU({pair:'GBP/USD',candles:candles(),newsEvents:[]}),/spread/);
});
test('reject incomplete or malformed historical bars',()=>{
 const broken=candles();broken[50].time=new Date(start+52*900000).toISOString();
 assert.throws(()=>backtestU({pair:'GBP/USD',candles:broken,newsEvents:[],spreadPips:1}),/Missing|unordered/);
});
test('each experiment returns separate metrics and trades without placing orders',()=>{
 const result=backtestU({pair:'GBP/USD',candles:candles(),newsEvents:[],spreadPips:1,slippagePips:0.2});
 assert.equal(result.paperOnly,true);assert.equal(result.timeframeMinutes,15);
 for(const e of U_EXPERIMENTS){assert.equal(result.experiments[e.id].metrics.trades,0);assert.deepEqual(result.experiments[e.id].trades,[]);}
});
