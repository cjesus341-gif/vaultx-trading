import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateFridaySettings,qualifyFriday,createFridayEngine} from './friday-engine.mjs';

test('strict defaults and invalid settings are rejected',()=>{
 assert.equal(validateFridaySettings({}).timeframe,'5m');
 assert.throws(()=>validateFridaySettings({riskPct:20}),/riskPct/);
 assert.throws(()=>validateFridaySettings({timeframe:'1d'}),/supported/);
});
test('no candle pattern means no qualifying signal',()=>{
 const now=Date.now();const f={closedAt:new Date(now-1000).toISOString(),close:100,ema20:99,ema50:98,trend:'bullish',rsi14:60,volumeRatio:2,atr14:2,recentLow:99,recentHigh:102,patterns:[],recentCandles:Array.from({length:24},(_,i)=>({high:101+i*.01,low:99+i*.01}))};
 const result=qualifyFriday({frames:{'5m':f,'15m':{trend:'bullish'}}},{},now);
 assert.equal(result.qualified,false);assert.equal(result.stop,null);
 assert.ok(result.checks.some(x=>x.name==='Directional pattern'&&!x.pass));
});
test('disarmed monitor cannot fetch and arming needs persistence',async()=>{
 let fetches=0;const e=createFridayEngine({reporter:async()=>{fetches++;return {status:'unavailable'}}});
 await e.tick();assert.equal(fetches,0);await assert.rejects(()=>e.control('arm'),/DATA_DIR/);
});
test('armed monitor records once per completed candle and disarms after restart',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'vaultx-friday-'));const file=path.join(dir,'state.json');
 const now=Date.now();let fetches=0;
 const f={closedAt:new Date(now-1000).toISOString(),close:100,trend:'bullish',ema20:99,ema50:98,rsi14:60,volumeRatio:2,atr14:1,recentLow:99,recentHigh:102,patterns:[],recentCandles:Array.from({length:24},()=>({high:101,low:99}))};
 const reporter=async()=>{fetches++;return {status:'current',frames:{'5m':f,'15m':{trend:'bullish'}}}};
 const e=createFridayEngine({reporter,now:()=>now,filePath:file});await e.control('arm');await e.tick();await e.tick();
 assert.equal(fetches,2);assert.equal(e.snapshot().events.length,1);assert.equal(e.snapshot().events[0].decision,'WAIT');
 assert.equal(JSON.parse(await readFile(file,'utf8')).armed,true);
 const restarted=createFridayEngine({reporter,now:()=>now,filePath:file});await restarted.init();assert.equal(restarted.snapshot().armed,false);
});
