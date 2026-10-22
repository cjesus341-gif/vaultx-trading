import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createEdithForward,EDITH_MARKETS,EDITH_RATIOS} from './edith-forward.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'edith-v36-'));
const file=path.join(dir,'edith.json');
const seed=Date.UTC(2026,0,1);let candles=[];
function candle(i){let close=100+Math.sin(i/3)*2+i*.08,open=close-.12;
 return {time:new Date(seed+i*300000).toISOString(),open,close,high:Math.max(open,close)+.5,low:Math.min(open,close)-.5,volume:90+i%7};}
const source=m=>candles;
try{
 const bot=createEdithForward({filePath:file,now:()=>seed+110*300000});
 candles=Array.from({length:95},(_,i)=>candle(i));
 let s=await bot.tick(source);assert.equal(s.strategies.length,15);assert.equal(s.scanCount,1);
 assert.ok(s.strategies.every(x=>x.trades===0&&!x.openPosition));
 assert.deepEqual(s.ratios,[1.5,2,3,5,10]);
 candles.push(candle(95));s=await bot.tick(source);assert.equal(s.scanCount,2);
 // Restart must not replay a closed bar.
 const restarted=createEdithForward({filePath:file,now:()=>seed+112*300000});
 s=await restarted.tick(source);assert.equal(s.scanCount,3);
 assert.equal(s.strategies.length,15);
 const doc=JSON.parse(await readFile(file,'utf8'));
 assert.equal(doc.watermarks['BTC-USD'],candle(95).time);
 assert.ok(doc.variants['ema-trend@1.5:1']);
 // A missing five-minute bar halts rather than fabricating fills or signals.
 candles.push(candle(97));s=await restarted.tick(source);
 assert.match(s.lastError,/gap/i);
 assert.equal(s.scanCount,3);
 assert.equal(JSON.parse(await readFile(file,'utf8')).watermarks['BTC-USD'],candle(95).time);
 // Upgrade an existing 9-variant journal without erasing any previous results.
 const legacy=JSON.parse(await readFile(file,'utf8'));
 for(const k of Object.keys(legacy.variants))if(k.includes('@5:1')||k.includes('@10:1'))delete legacy.variants[k];
 legacy.variants['ema-trend@2:1'].cash=997.25;
 await writeFile(file,JSON.stringify(legacy));
 const upgraded=createEdithForward({filePath:file});
 const restored=await upgraded.status();
 assert.equal(restored.strategies.length,15);
 assert.equal(restored.strategies.find(x=>x.name==='ema-trend@2:1').netPnlUsd,legacy.variants['ema-trend@2:1'].realizedUsd);
 const migrated=JSON.parse(await readFile(file,'utf8'));
 assert.equal(migrated.variants['ema-trend@2:1'].cash,997.25);
 assert.equal(migrated.variants['ema-trend@10:1'].cash,1000);
 assert.equal(migrated.watermarks['BTC-USD'],candle(95).time);
 // Corrupt journals must not be reset without operator intervention.
 await writeFile(file,'{}');
 await assert.rejects(createEdithForward({filePath:file}).status(),/journal invalid/);
 console.log('EDITH V36 extended: fifteen variants, fair ratios, restart persistence, gap fail-closed, corrupt journal passed');
}finally{await rm(dir,{recursive:true,force:true});}
