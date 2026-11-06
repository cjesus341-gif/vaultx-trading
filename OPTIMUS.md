# Optimus — staged IPO investing bot

Status: **foundation only**. Not connected to E*TRADE, StockPro, a market-data feed, notifications service, or the deployed VaultX UI. No live orders can be placed by this module.

## Phase 1
- $300 simulated cash ledger, whole-share buy/sell, realized P&L, and low-cash notifications represented as events.
- IPO candidates require verified listing type, ticker and first trading date; this module does **not** verify source data or fetch IPOs.
- No order may be simulated before the listing date. Simulations are not execution-quality backtests: no fees, slippage, spreads, exchange hours or market halts yet.
- No top-ups or broker transfers.

## Before production
1. Integrate reliable IPO calendar and real-time/appropriate delayed quotes; validate exchange, listing status and corporate actions.
2. Wire Miscellaneous UI, persistent paper ledger, notifications delivery and independent performance history.
3. Test realistic fills, bid/ask spreads, volatility halts, partial fills, fees, and market hours.
4. Implement official E*TRADE OAuth on the server with encrypted tokens and read-only account discovery first; determine whether StockPro is accessible and **exclude employee stock-plan assets** from the trading budget.
5. Add separate, opt-in live trading mode only after approval, with user authorization, explicit order preview, per-order and daily limits, account selection, kill switch, and audit logs.
6. Validate broker permissions and order availability; newly listed securities and fractional shares may not be eligible.
7. Review the PR, run tests, and deploy only after validation. No real trading without the user's explicit authorization.
