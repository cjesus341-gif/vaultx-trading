import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createEdithPerpScanner} from './edith-cde-perp-forward.mjs';
import {EDITH_STRATEGIES} from './edith-paper-lab.mjs';

const id = 'XPP-20DEC30-CDE';
const start = Date.parse('2026-01-01T00:00:00Z');
const step = 900_000;
const time = index => new Date(start + index * step).toISOString();
const candle = index => ({time: time(index), open: 2, close: 2, low: 2, high: index >= 80 ? 2.08 : 2, volume: 1});
const bars = Array.from({length: 82}, (_, index) => candle(index));
const fetchProducts = async () => ({products: [{product_id: id, future_product_details: {contract_code: 'XPP', contract_size: 10}}]});

async function journal(t, {dataGap = false, watermark = 79, entry = 79} = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'edith-perp-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const filePath = join(folder, 'journal.json');
  const experiments = Object.fromEntries(EDITH_STRATEGIES.map(name => [name, {
    cash: 300, positions: [], trades: [], pending: {}, peak: 300, maxDrawdownUsd: 0
  }]));
  experiments['ema-trend'].positions.push({
    productId: id, entryTime: time(entry), entry: 2, side: 'LONG', stop: 1.98,
    target: 2.04, contractSize: 10, marginUsd: 7, dataGap
  });
  await writeFile(filePath, JSON.stringify({
    schema: 1, positions: [], trades: [], signals: [], health: {}, scans: 0,
    watermarks: {[id]: time(watermark)}, experiments
  }));
  return filePath;
}

test('catches up over multiple completed candles and keeps repeat polls healthy', async t => {
  const filePath = await journal(t);
  const settings = {filePath, fetchProducts, fetchCandles: async () => [...bars], now: () => start + 82 * step};
  const updated = await createEdithPerpScanner(settings).tick();
  assert.equal(updated.marketHealth[id].status, 'OK');
  assert.equal(updated.openPositions.length, 0);
  assert.equal(updated.recentTrades[0].exitTime, time(80));
  assert.equal(updated.recentTrades[0].outcome, 'TARGET');

  const repeated = await createEdithPerpScanner(settings).tick();
  assert.equal(repeated.marketHealth[id].status, 'OK');
  assert.equal(repeated.recentTrades.length, 1);
});

test('keeps an old position open until the missing historical interval is verified', async t => {
  const filePath = await journal(t, {dataGap: true, watermark: 81, entry: 0});
  let missing = true;
  let clock = start + 82 * step;
  const scanner = createEdithPerpScanner({
    filePath, fetchProducts, now: () => clock, fetchCandles: async () => bars.slice(2),
    fetchHistory: async (product, from, through) => {
      assert.equal(product, id);
      assert.equal(from, time(0));
      assert.equal(through, time(81));
      return bars.slice(missing ? 2 : 1);
    }
  });
  const incomplete = await scanner.tick();
  assert.equal(incomplete.marketHealth[id].status, 'MISSING_CANDLES');
  assert.equal(incomplete.recentTrades.length, 0);
  assert.match(incomplete.openPositions[0].dataGapReason, /Expected 81 complete candles/);

  missing = false;
  const recovered = await scanner.tick();
  assert.equal(recovered.marketHealth[id].status, 'OK');
  assert.equal(recovered.openPositions.length, 0);
  assert.equal(recovered.recentTrades[0].exitTime, time(80));

  clock += 2 * step;
  assert.equal((await scanner.tick()).marketHealth[id].status, 'STALE_CANDLES');
});
