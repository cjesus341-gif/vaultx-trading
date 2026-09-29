import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SYMBOLS = ['BTC', 'ETH'];
const TTL = 15_000, MAX_AGE = 120_000;

// Public market data only. No credentials, wallets, deposits, or trade execution.
export function createMarketServer({fetcher = globalThis.fetch, now = Date.now} = {}) {
  const cache = new Map(), pending = new Map(), retryAt = new Map();
  async function market(symbol) {
    let saved = cache.get(symbol);
    if (!saved || now() - saved.checkedMs >= TTL) {
      if (!pending.has(symbol) && now() >= (retryAt.get(symbol) || 0)) {
        const work = (async () => {
          try {
            const response = await fetcher(`https://api.exchange.coinbase.com/products/${symbol}-USD/stats`, {
              headers: {'Accept':'application/json', 'User-Agent':'VaultXMarket/1.0'},
              signal: AbortSignal.timeout(6000)
            });
            if (!response.ok) throw new Error('Provider request failed');
            const raw = await response.json();
            const price = Number(raw.last), open = Number(raw.open);
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(open) || open <= 0) throw new Error('Invalid prices');
            const change = (price - open) / open * 100;
            if (!Number.isFinite(change)) throw new Error('Invalid change');
            cache.set(symbol, {symbol, price, change24h: change, checkedMs: now()});
            retryAt.delete(symbol);
          } catch {
            retryAt.set(symbol, now() + TTL);
          }
        })();
        pending.set(symbol, work);
        work.finally(() => pending.delete(symbol));
      }
      if (pending.has(symbol)) await pending.get(symbol);
      saved = cache.get(symbol);
    }
    const age = saved ? Math.max(0, now() - saved.checkedMs) : Infinity;
    if (!saved || age > MAX_AGE) return {symbol, status:'unavailable', price:null, change24h:null, checkedAt:null};
    return {symbol, price:saved.price, change24h:saved.change24h,
      checkedAt:new Date(saved.checkedMs).toISOString(), status:age >= TTL ? 'delayed' : 'current'};
  }
  return http.createServer(async (req, res) => {
    const send = (code, data) => {res.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET') return send(405, {error:'Only GET is supported'});
      if (url.pathname === '/health') return send(200, {status:'ok'});
      if (url.pathname === '/api/markets') {
        const symbol = url.searchParams.get('symbol');
        if (symbol && !SYMBOLS.includes(symbol)) return send(400, {error:'Supported symbols: BTC, ETH'});
        const markets = await Promise.all((symbol ? [symbol] : SYMBOLS).map(market));
        return send(markets.every(m => m.status === 'unavailable') ? 503 : 200, {source:'Coinbase Exchange', currency:'USD', refreshSeconds:15, markets});
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(path.join(ROOT, 'index.html'));
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
        return res.end(html);
      }
      send(404, {error:'Not found'});
    } catch {if (!res.headersSent) send(500,{error:'Unable to complete request'});else res.end();}
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createMarketServer().listen(port, '0.0.0.0', () => console.log(`VaultX listening on port ${port}`));
}
