import test from 'node:test';
import assert from 'node:assert/strict';
import { createOptimusState, paperBuy, paperSell, validateIpo, allocationAlert } from './optimus-engine.mjs';
const candidate = { symbol: 'NEW', firstTradingDate: '2026-11-01', listingType: 'IPO' };
test('default $300 paper allocation and no live execution', () => {
  const s = createOptimusState();
  assert.equal(s.cashCents, 30000);
  assert.equal(s.mode, 'paper');
  assert.throws(() => paperBuy({ ...s, mode: 'live' }, { candidate, priceCents: 1000, shares: 1 }), /not implemented/);
});
test('buy and sell ledger with realized profit', () => {
  const bought = paperBuy(createOptimusState(), { candidate, priceCents: 2500, shares: 2, timestamp: '2026-11-02T14:30:00Z' });
  assert.equal(bought.cashCents, 25000);
  const sold = paperSell(bought, { symbol: 'NEW', priceCents: 3000, shares: 1 });
  assert.equal(sold.cashCents, 28000);
  assert.equal(sold.trades.at(-1).realizedPnlCents, 500);
  assert.equal(sold.positions.NEW.shares, 1);
});
test('no overspending or pre-listing orders', () => {
  assert.throws(() => paperBuy(createOptimusState(), { candidate, priceCents: 30100, shares: 1 }), /Insufficient/);
  assert.throws(() => paperBuy(createOptimusState(), { candidate, priceCents: 100, shares: 1, timestamp: '2026-10-31T12:00:00Z' }), /before listing/);
});
test('only verified IPO classification', () => {
  assert.throws(() => validateIpo({ ...candidate, listingType: 'SPAC' }), /Only IPO/);
});
test('low cash and exhausted alerts', () => {
  const s = paperBuy(createOptimusState(), { candidate, priceCents: 26000, shares: 1 });
  assert.equal(s.notifications[0].type, 'LOW_CASH');
  assert.equal(allocationAlert(s, 5000).type, 'CANNOT_FUND_ORDER');
  const exhausted = paperBuy(s, { candidate, priceCents: 4000, shares: 1 });
  assert.equal(exhausted.notifications.at(-1).type, 'ALLOCATION_EXHAUSTED');
});
