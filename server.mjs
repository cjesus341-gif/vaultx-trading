import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SYMBOLS = ['BTC', 'ETH'];
const TTL = 15_000, MAX_AGE = 120_000;
const VOICE_TTL = 5 * 60_000;

function xmlText(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (match, number, named) => {
      if (number) {
        const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : parseInt(number, 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
      }
      return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[named.toLowerCase()];
    }).replace(/\s+/g, ' ').trim();
}
function xmlField(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'))?.[1] || '';
}
function feedItems(xml, sourceUrl) {
  const source = xmlText(xmlField(xml, 'channel') ? xmlField(xmlField(xml, 'channel'), 'title') : xmlField(xml, 'feed') ? xmlField(xmlField(xml, 'feed'), 'title') : '') || new URL(sourceUrl).hostname;
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)].slice(0, 10);
  return blocks.flatMap(([, kind, block]) => {
    const title = xmlText(xmlField(block, 'title'));
    const date = xmlText(xmlField(block, kind.toLowerCase() === 'entry' ? 'updated' : 'pubDate') || xmlField(block, 'published') || xmlField(block, 'dc:date'));
    const atomLink = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1];
    const rawLink = kind.toLowerCase() === 'entry' ? atomLink || xmlText(xmlField(block, 'link')) : xmlText(xmlField(block, 'link'));
    let link;
    try { link = new URL(rawLink, sourceUrl); } catch { return []; }
    if (!['https:', 'http:'].includes(link.protocol) || !title || !Number.isFinite(Date.parse(date))) return [];
    return [{id:link.href, source:'RSS', text:title.slice(0, 500), createdAt:new Date(date).toISOString(),
      author:{name:source.slice(0, 80), username:new URL(sourceUrl).hostname},url:link.href}];
  });
}

// Public market data only. No credentials, wallets, deposits, or trade execution.
export function createMarketServer({fetcher = globalThis.fetch, now = Date.now,
  blueskyAccounts = process.env.BLUESKY_ACCOUNTS || '', rssFeeds = process.env.RSS_FEEDS || ''} = {}) {
  const cache = new Map(), pending = new Map(), retryAt = new Map();
  const handles = [...new Set(blueskyAccounts.split(',').map(x => x.trim().replace(/^@/, '')).filter(x => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(x)))].slice(0, 5);
  const feeds = [...new Set(rssFeeds.split(',').map(x => x.trim()).filter(x => {
    try { const url = new URL(x); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }))].slice(0, 5);
  let voiceCache = null, voiceChecked = 0, voiceSuccess = 0, voicePending = null;
  async function refreshVoices() {
    const requests = [
      ...handles.map(async handle => {
        const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed');
        url.search = new URLSearchParams({actor:handle,limit:'10',filter:'posts_no_replies'}).toString();
        const response = await fetcher(url.href, {headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error('Bluesky unavailable');
        const data = await response.json();
        if (!Array.isArray(data.feed)) throw new Error('Invalid Bluesky feed');
        return data.feed.filter(item => !item.reason && !item.post?.record?.reply).slice(0, 2).flatMap(item => {
          const post = item.post, uri = post?.uri?.match(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([a-zA-Z0-9]+)$/);
          const username = post?.author?.handle;
          if (!uri || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(username || '') || typeof post?.record?.text !== 'string') return [];
          const date = post.record.createdAt || post.indexedAt;
          if (!Number.isFinite(Date.parse(date))) return [];
          return [{id:post.uri,source:'Bluesky',text:post.record.text.slice(0, 1000),createdAt:date,
            author:{name:post.author.displayName || username,username},url:`https://bsky.app/profile/${username}/post/${uri[1]}`}];
        });
      }),
      ...feeds.map(async feed => {
        const response = await fetcher(feed, {headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'},signal:AbortSignal.timeout(8000)});
        if (!response.ok) throw new Error('RSS unavailable');
        const xml = await response.text();
        if (xml.length > 1_000_000 || !/<(?:rss|feed)\b/i.test(xml)) throw new Error('Invalid RSS feed');
        return feedItems(xml, feed).slice(0, 2);
      })
    ];
    const results = await Promise.allSettled(requests);
    const good = results.filter(result => result.status === 'fulfilled');
    if (!good.length) throw new Error('Voices unavailable');
    voiceCache = good.flatMap(result => result.value).sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0, 6);
    voiceSuccess = now();
  }
  async function voices() {
    if (!handles.length && !feeds.length) return {status:'not_configured',posts:[],refreshSeconds:300};
    if (now() - voiceChecked >= VOICE_TTL || !voiceChecked) {
      if (!voicePending) {
        voiceChecked = now(); // Throttle upstream requests even after failures.
        voicePending = refreshVoices().finally(() => {voicePending = null;});
      }
      try {await voicePending;} catch { /* Keep the last successful feed if available. */ }
    }
    if (!voiceCache || now() - voiceSuccess > 2 * 60 * 60_000) return {status:'unavailable',posts:[],refreshSeconds:300};
    return {status:voiceSuccess === voiceChecked ? 'current' : 'delayed',posts:voiceCache,refreshSeconds:300,checkedAt:new Date(voiceSuccess).toISOString()};
  }
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
      if (url.pathname === '/api/voices') return send(200, await voices());
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
