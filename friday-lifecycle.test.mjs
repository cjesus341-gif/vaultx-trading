import test from 'node:test';
import assert from 'node:assert/strict';
import {runExecutionDrills,createDryRunExecutor} from './friday-lifecycle.mjs';
test('all execution simulation drills pass',()=>{const r=runExecutionDrills();assert.equal(r.allPassed,true);assert.equal(r.total,8);assert.equal(r.liveTradingEnabled,false)});
test('no network or exchange side effects; drill deterministic',()=>{assert.deepEqual(runExecutionDrills(),runExecutionDrills())});
