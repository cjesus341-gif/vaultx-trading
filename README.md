# VaultX — live market starter

## Run it

Install Node.js 22 or newer, open a terminal in this folder, and run:

```sh
npm start
```

Open http://localhost:3000 in your browser. No npm packages or API keys are required.
The HTML must be served by this app: opening index.html directly does not start the backend.

## What's connected

- BTC/USD and ETH/USD market snapshots from Coinbase Exchange.
- Latest price and 24-hour percentage change, refreshed every 15 seconds while the page is visible.
- Buy/sell preview coin estimates use the received market price; these are not executable quotes.
- Last successful fetch time and explicit delayed/unavailable states.
- Short server cache shared by visitors to the same server process; concurrent refreshes are coalesced.

Portfolio balances, deposits, trading, and Crypto voices remain demonstrations. There are no credentials, customer accounts, payment routes, private keys, or order execution in this project.

## Hosting

Run this as a Node web service, with this folder as the project root:

- Build command: `npm install`
- Start command: `npm start`
- Health path: `/health`
- Node version: 22 or newer
- Port: supplied through the hosting service's `PORT` environment variable

A render.yaml configuration is included. Upload the project files to a new repository and connect the web service to that repository. This is a separate project from the transmission website.

After hosting, open `/api/markets` on your site and confirm BTC and ETH return `status: "current"` and numeric prices. Check the displayed update time advances. Public API connectivity must be verified from your hosting region.

## Endpoints

- `GET /`: website
- `GET /api/markets`: BTC and ETH
- `GET /api/markets?symbol=BTC`: one supported currency
- `GET /health`: server health (not a guarantee that the external market feed is reachable)

Only BTC and ETH are accepted. The upstream URL cannot be chosen by the visitor.

## Failure behavior

Provider calls time out after six seconds. A failed refresh may retain the last successful snapshot for up to two minutes, visibly marked as delayed. Older quotes are removed. Trade preview confirmation is disabled without a current price. The app never substitutes mock numbers for an unavailable market feed. Failed requests are throttled for 15 seconds per symbol.

The timestamp is when the server fetched the snapshot, not the timestamp of an exchange trade. Coinbase stats are polling snapshots rather than a tick-by-tick stream. Prices may differ from another exchange or an eventual execution provider.

## Validation

Run `npm test` for automated server tests. Tests cover cache reuse, percentage-change math, provider outages, stale-data expiry, recovery, malformed responses, unsupported symbols, and HTML serving.

The development workspace could not retrieve live Coinbase data; it returned an unavailable page. The server was tested with controlled provider responses. A browser executable was also unavailable, so a full visual browser test was not completed. Verify the live feed and visual layout after running or hosting the app.

## Source

Official endpoint documentation:
https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats

The API uses `last` as the current snapshot price and calculates 24-hour change as `(last - open) / open * 100`.
