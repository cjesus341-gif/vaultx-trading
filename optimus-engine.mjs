// Optimus IPO paper-trading foundation. No brokerage calls or live execution.
export const OPTIMUS_INITIAL_CENTS = 30000;
export function createOptimusState(startingCents = OPTIMUS_INITIAL_CENTS) {
  if (!Number.isSafeInteger(startingCents) || startingCents < 0) throw new Error('Invalid starting allocation');
  return { mode: 'paper', cashCents: startingCents, startingCents, positions: {}, trades: [], notifications: [], nextTradeId: 1 };
}
export function validateIpo(candidate) {
  if (!candidate || !/^[A-Z][A-Z0-9.]{0,9}$/.test(candidate.symbol || '')) throw new Error('Invalid ticker');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.firstTradingDate || '') || !Number.isFinite(Date.parse(candidate.firstTradingDate + 'T00:00:00Z'))) throw new Error('Invalid listing date');
  if (candidate.listingType !== 'IPO') throw new Error('Only IPO listings are eligible');
  return true;
}
export function paperBuy(state, { candidate, priceCents, shares, timestamp = new Date().toISOString() }) {
  if (state.mode !== 'paper') throw new Error('Live execution is not implemented');
  validateIpo(candidate);
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || !Number.isSafeInteger(shares) || shares <= 0) throw new Error('Whole shares and positive cent prices required');
  if (!Number.isFinite(Date.parse(timestamp)) || timestamp.slice(0, 10) < candidate.firstTradingDate) throw new Error('Cannot buy before listing');
  const costCents = priceCents * shares;
  if (!Number.isSafeInteger(costCents)) throw new Error('Order exceeds safe bounds');
  if (costCents > state.cashCents) throw new Error('Insufficient allocated paper cash');
  const next = structuredClone(state);
  next.cashCents -= costCents;
  const p = next.positions[candidate.symbol] || { shares: 0, costCents: 0 };
  p.shares += shares; p.costCents += costCents; next.positions[candidate.symbol] = p;
  next.trades.push({ id: next.nextTradeId++, side: 'BUY', symbol: candidate.symbol, shares, priceCents, costCents, timestamp, mode: 'paper' });
  if (state.cashCents >= 5000 && next.cashCents < 5000) next.notifications.push({ type: 'LOW_CASH', cashCents: next.cashCents });
  if (next.cashCents === 0) next.notifications.push({ type: 'ALLOCATION_EXHAUSTED', cashCents: 0 });
  return next;
}
export function paperSell(state, { symbol, priceCents, shares, timestamp = new Date().toISOString() }) {
  if (state.mode !== 'paper') throw new Error('Live execution is not implemented');
  const p = state.positions[symbol];
  if (!p || !Number.isSafeInteger(shares) || shares <= 0 || shares > p.shares) throw new Error('Insufficient shares');
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) throw new Error('Invalid price');
  const proceedsCents = shares * priceCents;
  if (!Number.isSafeInteger(proceedsCents) || !Number.isSafeInteger(state.cashCents + proceedsCents)) throw new Error('Invalid proceeds');
  const next = structuredClone(state), held = next.positions[symbol];
  const basisCents = shares === held.shares ? held.costCents : Math.round(held.costCents * shares / held.shares);
  held.shares -= shares; held.costCents -= basisCents;
  if (!held.shares) delete next.positions[symbol];
  next.cashCents += proceedsCents;
  next.trades.push({ id: next.nextTradeId++, side: 'SELL', symbol, shares, priceCents, proceedsCents, realizedPnlCents: proceedsCents - basisCents, timestamp, mode: 'paper' });
  return next;
}
export function canAffordOrder(state, priceCents) {
  return state.mode === 'paper' && Number.isSafeInteger(priceCents) && priceCents > 0 && state.cashCents >= priceCents;
}
export function allocationAlert(state, minimumEligiblePriceCents) {
  if (!canAffordOrder(state, minimumEligiblePriceCents)) return { type: 'CANNOT_FUND_ORDER', cashCents: state.cashCents };
  return state.cashCents < 5000 ? { type: 'LOW_CASH', cashCents: state.cashCents } : null;
}
