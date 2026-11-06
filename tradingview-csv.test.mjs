import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTradingViewCsv} from './tradingview-csv.mjs';
const csv=(count=80)=>'time,open,high,low,close,Volume\n'+Array.from({length:count},(_,i)=>[1790006400+i*900,2,2.1,1.9,2.05,100].join(',')).join('\n');
test('accepts 15-minute TradingView UNIX timestamps',()=>{const bars=parseTradingViewCsv(csv());assert.equal(bars.length,80);assert.equal(Date.parse(bars[1].time)-Date.parse(bars[0].time),900000);});
test('rejects missing OHLC columns',()=>assert.throws(()=>parseTradingViewCsv('time,open,close\n1,2,3'),/requires/));
test('rejects non-15-minute timestamps',()=>assert.throws(()=>parseTradingViewCsv(csv().replace('1790006400','1790006401')),/aligned/));
test('rejects duplicates',()=>assert.throws(()=>parseTradingViewCsv(csv().replace('1790007300','1790006400')),/Duplicate/));
test('rejects fewer than 70 bars',()=>assert.throws(()=>parseTradingViewCsv(csv(69)),/70/));
