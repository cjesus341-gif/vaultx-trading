import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {intentKey,validateProtection,createSafetyJournal,assessExecutionSafety} from './friday-safety.mjs';
const input={timeframe:'5m',direction:'LONG',closedAt:'2026-10-14T23:05:00Z'};
test('stable candle idempotency identity',()=>{assert.equal(intentKey(input),intentKey({...input}));assert.notEqual(intentKey(input),intentKey({...input,timeframe:'15m'}));});
test('reject missing price or unsafe stop, oversize, and cost-adjusted RR',()=>{
 const x={entry:100,stop:98,target:107,quantity:1,riskBudget:3,availableUsd:100,maxExposureUsd:100};assert.equal(validateProtection(x).ok,true);
 for(const y of [{stop:101},{target:99},{quantity:2},{feesUsd:2},{stop:NaN}])assert.equal(validateProtection({...x,...y}).ok,false);
});
test('durable duplicate suppression and restart fail closed',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'friday-test-'));try{const file=path.join(dir,'safety.json');const a=createSafetyJournal({filePath:file});const record=await a.prepare(input);
 await assert.rejects(()=>a.prepare(input),/Duplicate/);await assert.rejects(()=>a.prepare({...input,closedAt:'2026-10-14T23:10:00Z'}),/Outstanding/);
 await a.transition(record.id,'SUBMIT_UNKNOWN');const b=createSafetyJournal({filePath:file});await b.init();assert.equal(b.snapshot().halted,true);assert.equal(b.snapshot().armed,false);
 await assert.rejects(()=>b.prepare({...input,closedAt:'2026-10-14T23:15:00Z'}),/Outstanding/);
 await assert.rejects(()=>b.transition(record.id,'PROTECTED'),/Invalid/);assert.equal(assessExecutionSafety({journal:b.snapshot()}).ready,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unknown state cannot be silently cleared to protected',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'friday-test-'));try{const journal=createSafetyJournal({filePath:path.join(dir,'x.json')});const x=await journal.prepare(input);await journal.transition(x.id,'SUBMIT_UNKNOWN');await assert.rejects(()=>journal.transition(x.id,'CANCELLED'),/Invalid/);await journal.transition(x.id,'HALTED');assert.equal(journal.snapshot().intents[0].state,'HALTED');}finally{await rm(dir,{recursive:true,force:true});}
});
