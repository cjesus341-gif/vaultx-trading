import http from 'node:http';
import {createMondayService} from './monday.mjs';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {scrypt,randomBytes,randomUUID,createHash,timingSafeEqual,createPrivateKey,sign as cryptoSign} from 'node:crypto';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ADMIN_HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>VaultX \u00b7 Administrator</title><style>\n:root{font-family:Inter,system-ui,sans-serif;color:#16372c;background:#f2f5ee}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}button{cursor:pointer}.wrap{max-width:1200px;margin:auto;padding:28px}.top{background:#10271f;color:#fff}.top .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:22px;padding-bottom:22px}.brand{font-weight:850;font-size:24px;letter-spacing:-1px}.brand span{color:#d7f3ac;font-size:12px;letter-spacing:1px;margin-left:18px}a{color:inherit}h1{font-size:clamp(32px,5vw,48px);letter-spacing:-2px;margin:12px 0}h2{font-size:21px;margin:0 0 20px}p{line-height:1.5;color:#66766b}.eyebrow{font-size:11px;font-weight:800;letter-spacing:1.6px;color:#52775e}.sub{font-size:14px;margin-bottom:28px}.card{border:1px solid #d8e3d5;border-radius:18px;background:white;padding:24px}.login{max-width:440px;margin:65px auto}label{font-size:13px;font-weight:700;display:block;margin:19px 0 8px}input{width:100%;padding:13px;border-radius:10px;border:1px solid #cddccb}.button{padding:12px 18px;border-radius:10px;background:#183e2d;color:white;border:0;font-weight:750}.light{background:#d7f3ac;color:#17372b}.ghost{background:transparent;border:1px solid #b8cdbd;color:inherit}.login .button{width:100%;margin-top:24px}.status{font-size:12px;color:#66766b}.error{color:#a23d32}.heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:24px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.stat{padding:22px}.stat span{font-size:12px;color:#617667;display:block}.stat strong{display:block;font-size:39px;letter-spacing:-1.5px;margin-top:14px}.stat small{display:block;font-size:11px;line-height:1.5;color:#78887b;margin-top:8px}.accent{background:#17372b;color:white}.accent span,.accent small{color:#c0d4c2}.columns{display:grid;grid-template-columns:1.8fr 1fr;gap:20px;margin:20px 0}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}th{text-align:left;color:#687e6d;font-size:10px;text-transform:uppercase;letter-spacing:.8px;padding:12px 10px}td{padding:15px 10px;border-top:1px solid #e5ece2}td b{display:block}td small{display:block;color:#718676;margin-top:4px}.badge{padding:5px 8px;background:#edf5e4;border-radius:6px;color:#397447;font-size:10px}.events{list-style:none;margin:0;padding:0}.events li{border-top:1px solid #e4ece0;padding:15px 0;font-size:13px}.events strong{display:block}.events small{color:#748778;display:block;margin-top:6px}.feeds{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.feed{padding:14px;background:#f4f7f1;border-radius:10px;font-size:12px}.feed b{display:block}.feed span{display:block;color:#6c7e6e;font-size:11px;margin-top:7px}.note{padding:18px 22px;border-radius:12px;background:#e8efdf;color:#526549;font-size:12px;line-height:1.6}.actions{display:flex;gap:10px;align-items:center}.pagination{display:flex;gap:10px;margin-top:18px}.footer{color:#758879;font-size:12px;padding-bottom:40px}button:disabled{opacity:.5;cursor:default}[hidden]{display:none!important}@media(max-width:850px){.stats{grid-template-columns:repeat(2,1fr)}.columns{grid-template-columns:1fr}.feeds{grid-template-columns:repeat(3,1fr)}}@media(max-width:500px){.wrap{padding:18px}.brand span{display:block;margin:6px 0 0}.heading{align-items:start;flex-direction:column}.stats{gap:10px}.stat{padding:17px}.stat strong{font-size:30px}.card{padding:18px}.feeds{grid-template-columns:repeat(2,1fr)}.top .wrap{gap:15px}.top a{font-size:12px}}\n</style></head><body><header class=\"top\"><div class=\"wrap\"><div class=\"brand\">VaultX <span>OWNER CONSOLE</span></div><div class=\"actions\"><a href=\"/\">Back to site \u2197</a><button class=\"button ghost\" id=\"logout\" hidden>Log out</button></div></div></header>\n<main class=\"wrap\"><section class=\"card login\" id=\"login\"><div class=\"eyebrow\">PRIVATE ACCESS</div><h1>Your control room.</h1><p>Sign in with your administrator email and password.</p><form id=\"admin-form\"><label for=\"email\">Administrator email</label><input type=\"email\" id=\"email\" autocomplete=\"username\" required maxlength=\"254\"><label for=\"password\">Password</label><input type=\"password\" id=\"password\" autocomplete=\"current-password\" minlength=\"12\" maxlength=\"128\" required><button class=\"button\" id=\"submit\">Open dashboard \u2192</button><p id=\"login-error\" role=\"status\" class=\"error\"></p></form><p class=\"status\">Administrator credentials are configured privately by the site owner.</p></section>\n<section id=\"dashboard\" hidden><div class=\"heading\"><div><div class=\"eyebrow\">ADMINISTRATOR OVERVIEW</div><h1>The whole picture.</h1><p class=\"sub\">Real accounts and recorded activity. Your site, at a glance.</p></div><div><button class=\"button\" id=\"refresh\">\u21bb Refresh stats</button><p class=\"status\" id=\"updated\">Connecting\u2026</p></div></div><p id=\"dash-error\" role=\"status\" class=\"error\"></p>\n<div class=\"stats\"><article class=\"card stat accent\"><span>Registered users</span><strong id=\"totalUsers\">\u2014</strong><small>Saved customer accounts \u00b7 excludes administrator</small></article><article class=\"card stat\"><span>New users today</span><strong id=\"newToday\">\u2014</strong><small>Calendar day in UTC</small></article><article class=\"card stat\"><span>Signed in during 24 hours</span><strong id=\"active24h\">\u2014</strong><small>Distinct accounts with a recent login</small></article><article class=\"card stat\"><span>Signed-in sessions</span><strong id=\"signedInUsers\">\u2014</strong><small>Distinct accounts with unexpired sessions</small></article><article class=\"card stat\"><span>New users \u00b7 7 days</span><strong id=\"new7Days\">\u2014</strong><small>Accounts registered in the past week</small></article><article class=\"card stat\"><span>Successful user logins</span><strong id=\"totalLogins\">\u2014</strong><small>Includes first sign-in at registration</small></article><article class=\"card stat\"><span>Market chart opens</span><strong id=\"marketViews\">\u2014</strong><small>Recorded from signed-in users</small></article><article class=\"card stat\"><span>Server uptime</span><strong id=\"uptime\">\u2014</strong><small>Since the most recent server start</small></article></div>\n<p class=\"note\" id=\"setup-note\"></p><div class=\"columns\"><section class=\"card\"><h2>User directory</h2><p class=\"status\">Email addresses are not verified. Passwords are never shown.</p><div class=\"scroll\"><table><thead><tr><th>User</th><th>Joined</th><th>Last sign-in</th><th>Logins</th></tr></thead><tbody id=\"users\"></tbody></table></div><p class=\"status\" id=\"users-empty\" hidden>No registrations yet. Accounts created through the new sign-up form will appear here.</p><div class=\"pagination\"><button class=\"button ghost\" id=\"prev\">\u2190 Previous</button><button class=\"button ghost\" id=\"next\">Next \u2192</button></div></section><section class=\"card\"><h2>Recent account activity</h2><ul class=\"events\" id=\"events\"></ul><p class=\"status\" id=\"events-empty\" hidden>No account activity recorded yet.</p></section></div><section class=\"card\"><h2>Market feed overview</h2><p class=\"status\">Last data retrieved by this server. Loading stats does not request new market prices.</p><div class=\"feeds\" id=\"feeds\"></div></section><p class=\"footer\">Balances, deposits, withdrawals, trades, and revenue remain demonstrations. No real transaction metrics are available. Sessions expire and reset when the server restarts.</p></section></main>\n<script>\n(()=>{const $=id=>document.getElementById(id);let offset=0,busy=false;\nasync function api(url,method='GET',body){const response=await fetch(url,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});let data;try{data=await response.json();}catch{throw Error('Server response unavailable.');}if(!response.ok)throw Object.assign(Error(data.error||'Request failed'),{status:response.status});return data;}\nfunction view(admin){$('login').hidden=admin;$('dashboard').hidden=!admin;$('logout').hidden=!admin;}\nfunction cell(row,value){const td=document.createElement('td');td.textContent=value;row.append(td);return td;}\nconst date=v=>v?new Date(v).toLocaleString():'Never';\nasync function load(){if(busy)return;busy=true;$('refresh').disabled=true;\ntry{const data=await api('/api/admin/overview?offset='+offset);view(true);$('dash-error').textContent='';for(const key of ['totalUsers','newToday','active24h','signedInUsers','new7Days','totalLogins','marketViews'])$(key).textContent=data.stats[key].toLocaleString();$('uptime').textContent=Math.floor(data.stats.uptimeSeconds/3600)+'h '+Math.floor(data.stats.uptimeSeconds%3600/60)+'m';$('updated').textContent='Updated '+date(data.asOf);$('users').replaceChildren();for(const user of data.users){const row=document.createElement('tr'),identity=cell(row,'');const name=document.createElement('b'),email=document.createElement('small');name.textContent=user.name;email.textContent=user.email;identity.append(name,email);cell(row,date(user.createdAt));cell(row,date(user.lastLoginAt));cell(row,String(user.loginCount));$('users').append(row);}$('users-empty').hidden=data.stats.totalUsers!==0;$('prev').disabled=offset===0;$('next').disabled=!data.hasMore;\n$('events').replaceChildren();for(const event of data.activity){const li=document.createElement('li'),title=document.createElement('strong'),when=document.createElement('small');title.textContent=event.name+' \u00b7 '+event.event;when.textContent=date(event.at);li.append(title,when);$('events').append(li);}$('events-empty').hidden=data.activity.length>0;\n$('feeds').replaceChildren();for(const market of data.markets){const div=document.createElement('div'),title=document.createElement('b'),state=document.createElement('span');div.className='feed';title.textContent=market.symbol;state.textContent=market.status+' \u00b7 '+market.source+' \u00b7 '+(data.marketViews[market.symbol]||0)+' chart opens';div.append(title,state);$('feeds').append(div);}\n$('setup-note').textContent=data.setup.mode+'. '+(data.setup.persistentPathConfigured?'Account files use the configured data path. Keep it on a persistent disk.':'Persistent storage is not configured. Before collecting accounts on Render, attach a persistent disk and set DATA_DIR. Accounts may otherwise disappear on deploy.')+' '+data.setup.sessions;\n}catch(error){if(error.status===401||error.status===403){view(false);$('login-error').textContent=error.status===403?'This account does not have administrator access.':'';}else $('dash-error').textContent=error.message;}finally{busy=false;$('refresh').disabled=false;}}\n$('admin-form').addEventListener('submit',async e=>{e.preventDefault();$('submit').disabled=true;$('login-error').textContent='';try{const data=await api('/api/auth/login','POST',{email:$('email').value,password:$('password').value});$('password').value='';if(data.user.role!=='admin'){await api('/api/auth/logout','POST',{});throw Error('Administrator credentials required.');}offset=0;await load();}catch(error){$('login-error').textContent=error.message;}finally{$('submit').disabled=false;}});\n$('logout').addEventListener('click',async()=>{try{await api('/api/auth/logout','POST',{});view(false);$('users').replaceChildren();$('password').value='';$('login-error').textContent='Signed out.';}catch(error){$('dash-error').textContent=error.message;}});\n$('refresh').addEventListener('click',load);$('prev').addEventListener('click',()=>{offset=Math.max(0,offset-50);load();});$('next').addEventListener('click',()=>{offset+=50;load();});setInterval(()=>{if(!$('dashboard').hidden&&!document.hidden)load();},30000);load();})();\n</script></body></html>\n";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = [{"symbol": "BTC", "name": "Bitcoin", "id": "bitcoin", "providerSymbol": "BTC"}, {"symbol": "ETH", "name": "Ethereum", "id": "ethereum", "providerSymbol": "ETH"}, {"symbol": "XRP", "name": "XRP", "id": "ripple", "providerSymbol": "XRP"}, {"symbol": "SOL", "name": "Solana", "id": "solana", "providerSymbol": "SOL"}, {"symbol": "BNB", "name": "BNB", "id": "binancecoin", "providerSymbol": "BNB"}, {"symbol": "DOGE", "name": "Dogecoin", "id": "dogecoin", "providerSymbol": "DOGE"}, {"symbol": "SUI", "name": "Sui", "id": "sui", "providerSymbol": "SUI"}, {"symbol": "NEAR", "name": "NEAR Protocol", "id": "near", "providerSymbol": "NEAR"}, {"symbol": "ZEC", "name": "Zcash", "id": "zcash", "providerSymbol": "ZEC"}, {"symbol": "HYPE", "name": "Hyperliquid", "id": "hyperliquid", "providerSymbol": "HYPE"}, {"symbol": "SAND", "name": "The Sandbox", "id": "the-sandbox", "providerSymbol": "SAND"}, {"symbol": "ADA", "name": "Cardano", "id": "cardano", "providerSymbol": "ADA"}];
const SYMBOLS = ASSETS.map(a=>a.symbol);
const ANALYSIS_SYMBOLS = ['BTC','ETH'];
const QUOTE_SYMBOLS = ['BTC','ETH','XRP'];
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
  adminEmail=process.env.ADMIN_EMAIL||'',adminPassword=process.env.ADMIN_PASSWORD||'',
  coinbaseApiKeyName=process.env.COINBASE_API_KEY_NAME||'',coinbaseApiPrivateKey=process.env.COINBASE_API_PRIVATE_KEY||'',
  dataDir=process.env.DATA_DIR||path.join(ROOT,'data'),appOrigin=process.env.APP_ORIGIN||'',
  blueskyAccounts = process.env.BLUESKY_ACCOUNTS || '', rssFeeds = process.env.RSS_FEEDS || '',
  mondayHistoryPath = process.env.MONDAY_HISTORY_PATH || path.join(ROOT,'data','monday-history.json')} = {}) {
  const monday = createMondayService({fetcher,now,historyPath:mondayHistoryPath});
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
    return {symbol, source:'Coinbase Exchange', freshForSeconds:45, maxAgeSeconds:120, price:saved.price, change24h:saved.change24h,
      checkedAt:new Date(saved.checkedMs).toISOString(), status:age >= TTL ? 'delayed' : 'current'};
  }

  // One shared batch per minute, regardless of visitors or selected symbol.
  const broadCache = new Map(), historyCache = new Map(), historyPending = new Map();
  let broadPending = null, broadRetry = 0;
  const cgHeaders = {'Accept':'application/json', ...(process.env.COINGECKO_API_KEY ? {'x-cg-demo-api-key':process.env.COINGECKO_API_KEY} : {})};
  async function cg(endpoint, params) {
    const url = new URL('https://api.coingecko.com/api/v3/'+endpoint);
    url.search = new URLSearchParams(params).toString();
    const response = await fetcher(url.href,{headers:cgHeaders,signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('Market provider unavailable');
    return response.json();
  }
  async function refreshBroadMarkets(){
    if(!broadPending && now()>=broadRetry){
      broadRetry=now()+60000;
      broadPending=(async()=>{
        const rows=await cg('coins/markets',{vs_currency:'usd',ids:ASSETS.map(a=>a.id).join(','),per_page:'250',sparkline:'false',precision:'full'});
        if(!Array.isArray(rows))throw Error('Invalid market data');
        for(const a of ASSETS){
          const row=rows.find(r=>r.id===a.id && String(r.symbol).toUpperCase()===a.providerSymbol);
          if(!row || !Number.isFinite(row.current_price) || row.current_price<=0 || !Number.isFinite(Date.parse(row.last_updated)))continue;
          broadCache.set(a.symbol,{symbol:a.symbol,price:row.current_price,change24h:Number.isFinite(row.price_change_percentage_24h)?row.price_change_percentage_24h:null,checkedAt:row.last_updated,source:'CoinGecko',freshForSeconds:180,maxAgeSeconds:600});
        }
      })().catch(()=>{}).finally(()=>{broadPending=null;});
    }
    if(broadPending)await broadPending;
  }
  function broadMarket(symbol){
    const q=broadCache.get(symbol), age=q?now()-Date.parse(q.checkedAt):Infinity;
    if(!q || age< -30000 || age>600000)return {symbol,status:'unavailable',price:null,change24h:null,checkedAt:null,source:'CoinGecko'};
    return {...q,status:age>180000?'delayed':'current'};
  }
  async function history(symbol,days){
    const key=symbol+':'+days, saved=historyCache.get(key);
    if(saved && now()-saved.fetchedAt<60000)return saved;
    if(!historyPending.has(key)){
      const work=(async()=>{
        const asset=ASSETS.find(a=>a.symbol===symbol),raw=await cg('coins/'+asset.id+'/market_chart',{vs_currency:'usd',days:String(days)});
        const unique=new Map();
        for(const row of raw.prices||[])if(Array.isArray(row)&&Number.isFinite(row[0])&&row[0]>0&&row[0]<=now()+30000&&Number.isFinite(row[1])&&row[1]>0)unique.set(row[0],row);
        const prices=[...unique.values()].sort((a,b)=>a[0]-b[0]);
        if(prices.length<2 || now()-prices.at(-1)[0]>7200000)throw Error('Incomplete or stale chart history');
        const result={symbol,status:'current',source:'CoinGecko',kind:'sampled-price-line',days,prices,fetchedAt:now(),dataAsOf:new Date(prices.at(-1)[0]).toISOString()};
        historyCache.set(key,result);return result;
      })();
      historyPending.set(key,work);
      work.then(()=>historyPending.delete(key),()=>historyPending.delete(key));
    }
    try{return await historyPending.get(key);}catch{
      if(saved && now()-saved.fetchedAt<600000)return {...saved,status:'delayed'};
      return {symbol,status:'unavailable',prices:[]};
    }
  }

  // Local single-instance account store. Put DATA_DIR on a persistent disk.
  const accountFile=path.join(dataDir,'accounts.json');
  let accounts={schema:1,users:[],marketViews:{},activity:[]},storageFailed=false,writeQueue=Promise.resolve();
  const startedAt=now(),sessions=new Map(),attempts=new Map();
  const cleanEmail=v=>typeof v==='string'?v.trim().toLowerCase():'';
  const emailValid=v=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const adminAddress=cleanEmail(adminEmail),adminEnabled=emailValid(adminAddress)&&typeof adminPassword==='string'&&adminPassword.length>=12&&adminPassword.length<=128;
  const derive=promisify(scrypt);
  const coinbaseKeyName=String(coinbaseApiKeyName).trim();
  const coinbasePrivateKey=String(coinbaseApiPrivateKey).replace(/\\n/g,'\n').trim();
  const coinbaseConfigured=!!coinbaseKeyName&&coinbasePrivateKey.includes('PRIVATE KEY');
  const b64url=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
  function coinbaseJwt(method,requestPath){
    if(!coinbaseConfigured)throw Object.assign(Error('Coinbase API credentials are not configured.'),{status:503});
    const host='api.coinbase.com',nowSec=Math.floor(Date.now()/1000),uri=method.toUpperCase()+' '+host+requestPath;
    const header={alg:'ES256',kid:coinbaseKeyName,nonce:randomBytes(16).toString('hex'),typ:'JWT'};
    const payload={sub:coinbaseKeyName,iss:'cdp',nbf:nowSec,exp:nowSec+120,uri};
    const input=b64url(header)+'.'+b64url(payload);
    let key;try{key=createPrivateKey(coinbasePrivateKey);}catch{throw Object.assign(Error('Coinbase private key could not be read.'),{status:503});}
    const signature=cryptoSign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
    return input+'.'+signature;
  }
  async function coinbaseAccounts(){
    const requestPath='/api/v3/brokerage/accounts';
    const token=coinbaseJwt('GET',requestPath);
    const response=await fetcher('https://api.coinbase.com'+requestPath,{headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'VaultX/1.0'},signal:AbortSignal.timeout(10000)});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){
      const detail=typeof data?.message==='string'?data.message:typeof data?.error==='string'?data.error:'Coinbase rejected the authenticated request.';
      throw Object.assign(Error(detail),{status:502});
    }
    if(!Array.isArray(data.accounts))throw Object.assign(Error('Coinbase returned an unexpected account response.'),{status:502});
    return data.accounts.map(account=>({
      currency:account.currency||'',
      availableBalance:String(account.available_balance?.value??'0'),
      hold:String(account.hold?.value??'0'),
      active:account.active!==false,
      ready:account.ready!==false
    })).filter(account=>account.currency);
  }
  async function hashPassword(password){const salt=randomBytes(16).toString('hex');const key=await derive(password,salt,64);return {salt,hash:key.toString('hex')};}
  async function verifyPassword(password,saved){const key=await derive(password,saved.salt,64),hash=Buffer.from(saved.hash,'hex');return hash.length===key.length&&timingSafeEqual(key,hash);}
  const adminHash=hashPassword(adminEnabled?adminPassword:randomBytes(32).toString('hex'));
  const ready=(async()=>{
    await mkdir(dataDir,{recursive:true,mode:0o700});
    try{const data=JSON.parse(await readFile(accountFile,'utf8'));if(data.schema!==1||!Array.isArray(data.users)||!data.marketViews||!Array.isArray(data.activity))throw Error('Invalid account store');accounts=data;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  })().catch(()=>{storageFailed=true;});
  function mutate(change){
    const work=writeQueue.then(async()=>{
      await ready;if(storageFailed)throw Object.assign(Error('Account storage unavailable'),{status:503});
      const next=structuredClone(accounts),result=change(next),temp=accountFile+'.'+randomBytes(8).toString('hex')+'.tmp';
      try{await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,accountFile);}
      catch(error){await unlink(temp).catch(()=>{});throw Object.assign(Error('Account storage unavailable'),{status:503});}
      accounts=next;return result;
    });
    writeQueue=work.catch(()=>{});return work;
  }
  function activity(db,event,user){db.activity.unshift({at:new Date(now()).toISOString(),event,userId:user?.id||null});db.activity=db.activity.slice(0,100);}
  function sessionFor(req){
    const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('vaultx_session='))?.slice(15);
    if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
    const key=createHash('sha256').update(token).digest('hex'),session=sessions.get(key);
    if(!session||session.expires<=now()){sessions.delete(key);return null;}return {...session,key};
  }
  function issueSession(req,res,user){
    const old=sessionFor(req);if(old)sessions.delete(old.key);
    for(const [key,s]of sessions)if(s.expires<=now())sessions.delete(key);
    if(sessions.size>=10000)sessions.delete(sessions.keys().next().value);
    const token=randomBytes(32).toString('hex'),seconds=user.role==='admin'?7200:43200;
    sessions.set(createHash('sha256').update(token).digest('hex'),{user,expires:now()+seconds*1000});
    const secure=!!req.socket.encrypted||req.headers['x-forwarded-proto']==='https';
    res.setHeader('Set-Cookie','vaultx_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+seconds+(secure?'; Secure':''));
  }
  function publicUser(user){return {id:user.id,name:user.name,email:user.email,role:user.role};}
  function sameOrigin(req){
    try{const origin=new URL(req.headers.origin);if(appOrigin)return origin.origin===new URL(appOrigin).origin;return origin.host===req.headers.host&&['http:','https:'].includes(origin.protocol);}catch{return false;}
  }
  function throttled(req,email){
    // Render terminates proxy requests and appends the originating client address.
    const forwarded=process.env.RENDER?String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim():'';
    const ip=forwarded||req.socket.remoteAddress;
    for(const [key,value]of attempts)if(value.until<=now())attempts.delete(key);
    if(attempts.size>10000)return true;
    const keys=['ip:'+ip,'email:'+email],limits=[30,10];let blocked=false;
    keys.forEach((key,i)=>{let record=attempts.get(key);if(!record){record={n:0,until:now()+15*60000};attempts.set(key,record);}record.n++;if(record.n>limits[i])blocked=true;});return blocked;
  }
  function readJSON(req){
    return new Promise((resolve,reject)=>{
      if(!String(req.headers['content-type']||'').startsWith('application/json')){req.resume();reject(Object.assign(Error('Send JSON content'),{status:415}));return;}
      let size=0,chunks=[],finished=false;
      req.on('data',chunk=>{size+=chunk.length;if(size>8192){if(!finished){finished=true;chunks=[];reject(Object.assign(Error('Request too large'),{status:413}));}}else if(!finished)chunks.push(chunk);});
      req.on('end',()=>{if(finished)return;try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();resolve(data);}catch{reject(Object.assign(Error('Invalid request'),{status:400}));}});
      req.on('error',()=>reject(Object.assign(Error('Request interrupted'),{status:400})));
    });
  }
  async function accountRoute(req,res,url,send){
    const route=url.pathname;
    if(route==='/admin'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'"});res.end(ADMIN_HTML);return true;
    }
    if(!['/api/auth/signup','/api/auth/login','/api/auth/logout','/api/auth/session','/api/admin/overview','/api/admin/coinbase','/api/activity'].includes(route))return false;
    const post=['/api/auth/signup','/api/auth/login','/api/auth/logout','/api/activity'].includes(route);
    if(req.method!==(post?'POST':'GET')){send(405,{error:'Method not supported'});return true;}
    if(post&&!sameOrigin(req)){send(403,{error:'Request origin rejected'});return true;}
    await ready;
    if(storageFailed){send(503,{error:'Account storage unavailable. Check server configuration.'});return true;}
    const session=sessionFor(req);
    if(route==='/api/auth/session'){send(200,{user:session?publicUser(session.user):null});return true;}
    if(route==='/api/auth/logout'){
      if(session)sessions.delete(session.key);
      res.setHeader('Set-Cookie','vaultx_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+((req.socket.encrypted||req.headers['x-forwarded-proto']==='https')?'; Secure':''));send(200,{ok:true});return true;
    }
    if(route==='/api/admin/coinbase'){
      if(!session||session.user.role!=='admin'){send(session?403:401,{error:'Administrator access required'});return true;}
      if(!coinbaseConfigured){send(503,{error:'Coinbase API credentials are not configured.'});return true;}
      const list=await coinbaseAccounts();
      const wanted=new Set(['USD','USDC','BTC']),balances=list.filter(a=>wanted.has(a.currency));
      send(200,{connected:true,mode:'read-only connection test',checkedAt:new Date(now()).toISOString(),balances});return true;
    }
    if(route==='/api/admin/overview'){
      if(!session||session.user.role!=='admin'){send(session?403:401,{error:'Administrator access required'});return true;}
      const today=new Date(now()).toISOString().slice(0,10),users=accounts.users;
      const liveSessions=[...sessions.values()].filter(s=>s.expires>now()&&s.user.role==='user'),online=new Set(liveSessions.map(s=>s.user.id));
      const offset=Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0));
      const allQuotes=SYMBOLS.map(symbol=>{const q=cache.get(symbol);return q?{symbol,status:now()-q.checkedMs<MAX_AGE?'available':'stale',source:'Coinbase Exchange'}:{symbol,status:broadMarket(symbol).status,source:'CoinGecko'};});
      send(200,{asOf:new Date(now()).toISOString(),stats:{totalUsers:users.length,newToday:users.filter(u=>u.createdAt.slice(0,10)===today).length,new7Days:users.filter(u=>now()-Date.parse(u.createdAt)<7*86400000).length,active24h:users.filter(u=>u.lastLoginAt&&now()-Date.parse(u.lastLoginAt)<86400000).length,signedInUsers:online.size,totalLogins:users.reduce((n,u)=>n+u.loginCount,0),marketViews:Object.values(accounts.marketViews).reduce((n,v)=>n+v,0),uptimeSeconds:Math.floor((now()-startedAt)/1000)},
        users:users.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(offset,offset+50).map(u=>({...publicUser({...u,role:'user'}),createdAt:u.createdAt,lastLoginAt:u.lastLoginAt,loginCount:u.loginCount,emailVerified:false})),offset,hasMore:offset+50<users.length,
        activity:accounts.activity.slice(0,20).map(a=>({...a,name:users.find(u=>u.id===a.userId)?.name||'Administrator'})),markets:allQuotes,marketViews:accounts.marketViews,
        setup:{persistentPathConfigured:!!process.env.DATA_DIR||dataDir!==path.join(ROOT,'data'),storage:'Local account file; requires a persistent disk on Render',adminEmail:adminAddress,mode:'Real accounts; trading and wallet remain demonstrations',sessions:'Signed-in counts reflect unexpired sessions, not people currently viewing a page. Sessions reset on server restart.'}});return true;
    }
    if(route==='/api/activity'){
      if(!session){send(401,{error:'Log in first'});return true;}
      const body=await readJSON(req);if(!SYMBOLS.includes(body.symbol)){send(400,{error:'Unknown market'});return true;}
      if(session.user.role==='user'){const stored=sessions.get(session.key);if(stored.lastViewAt&&now()-stored.lastViewAt<2000){send(429,{error:'Activity already recorded. Try again shortly.'});return true;}stored.lastViewAt=now();}
      if(session.user.role==='user')await mutate(db=>{db.marketViews[body.symbol]=(db.marketViews[body.symbol]||0)+1;});send(200,{ok:true});return true;
    }
    const body=await readJSON(req),email=cleanEmail(body.email),password=body.password;
    if(throttled(req,email)){send(429,{error:'Too many attempts. Try again in 15 minutes.'});return true;}
    if(!emailValid(email)||typeof password!=='string'||password.length<8||password.length>128){send(400,{error:'Enter a valid email and a password with 8–128 characters.'});return true;}
    if(route==='/api/auth/signup'){
      const name=typeof body.name==='string'?body.name.trim():'';
      if(!name||name.length>40){send(400,{error:'Enter a name with 1–40 characters.'});return true;}
      if(email===adminAddress||accounts.users.some(u=>u.email===email)){send(409,{error:'Unable to register this address. Try logging in.'});return true;}
      const passwordHash=await hashPassword(password);
      const user=await mutate(db=>{
        if(db.users.some(u=>u.email===email))throw Object.assign(Error('Unable to register this address'),{status:409});
        const user={id:randomUUID(),name,email,passwordHash,createdAt:new Date(now()).toISOString(),lastLoginAt:new Date(now()).toISOString(),loginCount:1};db.users.push(user);activity(db,'Account created',user);return publicUser({...user,role:'user'});
      });issueSession(req,res,user);send(201,{user});return true;
    }
    if(email===adminAddress){
      if(!adminEnabled){send(503,{error:'Admin login needs ADMIN_EMAIL and ADMIN_PASSWORD (12–128 characters) in Render.'});return true;}
      if(!(await verifyPassword(password,await adminHash))){send(401,{error:'Email or password is incorrect.'});return true;}
      const user={id:'administrator',name:'Administrator',email,role:'admin'};issueSession(req,res,user);send(200,{user,redirect:'/admin'});return true;
    }
    const saved=accounts.users.find(u=>u.email===email);
    if(!(await verifyPassword(password,saved?.passwordHash||await adminHash))||!saved){send(401,{error:'Email or password is incorrect.'});return true;}
    const user=await mutate(db=>{const user=db.users.find(u=>u.id===saved.id);user.lastLoginAt=new Date(now()).toISOString();user.loginCount++;activity(db,'Signed in',user);return publicUser({...user,role:'user'});});
    issueSession(req,res,user);send(200,{user});return true;
  }

  return http.createServer(async (req, res) => {
    const send = (code, data) => {res.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const url = new URL(req.url, 'http://localhost');
      if(await accountRoute(req,res,url,send))return;
      if (req.method !== 'GET') return send(405, {error:'Only GET is supported'});
      if (url.pathname === '/health') return send(200, {status:'ok'});
      if (url.pathname === '/api/friday') {
        const symbol=url.searchParams.get('symbol')||'BTC';
        if(!ANALYSIS_SYMBOLS.includes(symbol))return send(400,{error:'Full forecast currently supports BTC and ETH only.'});
        const report=await monday.get(symbol);
        if(report.status!=='current'||!report.priceProjection)return send(503,{status:'unavailable',symbol,error:'Complete current price-action data is unavailable.'});
        return send(200,{status:'current',symbol,source:report.source,generatedAt:report.generatedAt,dataAsOf:report.dataAsOf,horizonAt:report.horizonAt,
          projection:report.priceProjection,preview:`You didn’t get this from me. My conditional two-hour projection for ${symbol} is ${report.priceProjection.direction}, if its recent price slope continues. Log in for the price estimate and full breakdown.`,
          evidence:report.evidence,frames:report.frames,levels:report.levels,scenarios:report.scenarios,
          limitations:'Experimental price-action extrapolation. Not financial advice, a guaranteed price target or a calibrated forecast. Candle patterns and indicators provide context; they do not prove the price projection. This price model has not been backtested for accuracy.'});
      }
      if (url.pathname === '/api/monday') {
        const symbol=url.searchParams.get('symbol')||'BTC';
        if(!ANALYSIS_SYMBOLS.includes(symbol))return send(400,{error:'Full forecast currently supports BTC and ETH only.'});
        const report=await monday.get(symbol);
        return send(report.status==='current'?200:503,report);
      }
      if (url.pathname === '/api/history') {
        const symbol=url.searchParams.get('symbol'),days=Number(url.searchParams.get('days')||1);
        if(!SYMBOLS.includes(symbol)||![1,7,30,90].includes(days))return send(400,{error:'Invalid market or chart range'});
        const result=await history(symbol,days);return send(result.status==='unavailable'?503:200,result);
      }
      if (url.pathname === '/api/voices') return send(200, await voices());
      if (url.pathname === '/api/markets') {
        const symbol = url.searchParams.get('symbol');
        if (symbol && !SYMBOLS.includes(symbol)) return send(400, {error:'Unknown market symbol'});
        await refreshBroadMarkets();
        const markets = await Promise.all((symbol ? [symbol] : SYMBOLS).map(async s=>{if(!QUOTE_SYMBOLS.includes(s))return broadMarket(s);const q=await market(s);return q.status==='unavailable'?broadMarket(s):q;}));
        return send(markets.every(m => m.status === 'unavailable') ? 503 : 200, {source:'Coinbase Exchange + CoinGecko', currency:'USD', refreshSeconds:15, markets});
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(path.join(ROOT, 'index.html'));
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
        return res.end(html);
      }
      send(404, {error:'Not found'});
    } catch(error) {if (!res.headersSent) send(error.status||500,{error:error.status?error.message:'Unable to complete request'});else res.end();}
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createMarketServer().listen(port, '0.0.0.0', () => console.log(`VaultX listening on port ${port}`));
}
