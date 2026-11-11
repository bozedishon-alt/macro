'use strict';
// Macro Compass server: refreshes data on a schedule, computes scores, serves /api/* and the web page.
const http = require('http');
const fs = require('fs');
const path = require('path');

// tiny .env loader (no dependencies)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env file */ }

const C = require('./lib/config');
const S = require('./lib/sources');
const { buildModel } = require('./lib/scoring');

const PORT = Number(process.env.PORT) || 3000;
const TE_KEY = process.env.TE_API_KEY || '';
const FRED_KEY = process.env.FRED_API_KEY || '';
const EVERY = {
  prices: (Number(process.env.PRICE_REFRESH_MIN) || 30) * 60e3,
  cot: (Number(process.env.COT_REFRESH_MIN) || 720) * 60e3,
  macro: (Number(process.env.MACRO_REFRESH_MIN) || 360) * 60e3,
  calendar: (Number(process.env.CAL_REFRESH_MIN) || 60) * 60e3,
  news: (Number(process.env.NEWS_REFRESH_MIN) || 15) * 60e3,
};
const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, 'data', 'cache.json');

const raw = { prices: {}, cot: {}, macro: {}, calendar: [], news: [] };
const status = {
  prices: { ok: false, at: null, error: null, note: null },
  cot: { ok: false, at: null, error: null, note: null },
  macro: { ok: false, at: null, error: null, note: TE_KEY ? 'Trading Economics' : FRED_KEY ? 'FRED (أمريكا فقط)' : 'غير مفعّل: أضف TE_API_KEY أو FRED_API_KEY' },
  calendar: { ok: false, at: null, error: null, note: TE_KEY ? 'Trading Economics' : 'Forex Factory (هذا الأسبوع)' },
  news: { ok: false, at: null, error: null, note: 'Fed / BoE / ECB / FXStreet' },
};
let model = { markets: [], banks: {}, updatedAt: null };

try {
  const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  Object.assign(raw, c.raw || {});
  Object.keys(c.status || {}).forEach((k) => { if (status[k]) Object.assign(status[k], c.status[k], { note: status[k].note }); });
} catch (e) { /* first run */ }

function persist() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ raw, status }));
  } catch (e) { console.error('cache write failed:', e.message); }
}

function buildBanks() {
  const banks = {};
  C.CURRENCIES.forEach((cur) => {
    const r = raw.macro[cur] && raw.macro[cur].rate;
    const b = { cur, short: C.BANKS[cur].short, name: C.BANKS[cur].name, rate: null, prev: null, lastDate: null, next: null, lo: null, approx: false };
    if (r && r.v != null) { b.rate = r.v; b.prev = r.p; b.lastDate = r.d; b.approx = !!r.approx; }
    const lo = cur === 'USD' && raw.macro.USD && raw.macro.USD.rate_lo;
    if (lo && lo.v != null && r && lo.v < r.v) b.lo = lo.v;
    const now = Date.now();
    const next = (raw.calendar || [])
      .filter((e) => e.cur === cur && /interest rate decision|rate statement|monetary policy (meeting|decision)/i.test(e.event) && new Date(e.t).getTime() > now)
      .sort((a, z) => new Date(a.t) - new Date(z.t))[0];
    if (next) b.next = next.t;
    else if (C.MEETINGS[cur]) {
      const d = C.MEETINGS[cur].find((x) => new Date(x + 'T19:00:00Z').getTime() > now);
      if (d) b.next = d + 'T19:00:00Z';
    }
    banks[cur] = b;
  });
  return banks;
}

function recompute() {
  try {
    const markets = buildModel({ prices: raw.prices, cot: raw.cot, macro: raw.macro });
    model = { markets, banks: buildBanks(), updatedAt: new Date().toISOString() };
  } catch (e) { console.error('model build failed:', e); }
}

function summarize(errors, total) {
  if (!errors.length) return null;
  return errors.length + ' من ' + total + ' فشل: ' + errors.slice(0, 3).join(' | ');
}

const refreshers = {
  async prices() {
    const { data, errors } = await S.fetchPrices();
    if (Object.keys(data).length) Object.assign(raw.prices, data);
    status.prices.ok = Object.keys(data).length > 0;
    status.prices.error = summarize(errors, C.FX_PAIRS.length + C.OTHERS.length + Object.keys(C.CUR_PRICE).length);
  },
  async cot() {
    const { data, errors } = await S.fetchCot();
    if (Object.keys(data).length) Object.assign(raw.cot, data);
    status.cot.ok = Object.keys(data).length > 0;
    status.cot.error = summarize(errors, Object.keys(data).length + errors.length);
  },
  async macro() {
    if (!TE_KEY && !FRED_KEY) { status.macro.ok = false; return; }
    const { data, errors } = TE_KEY ? await S.fetchMacroTE(TE_KEY) : await S.fetchMacroFRED(FRED_KEY);
    const got = Object.values(data).some((o) => Object.keys(o).length);
    if (got) raw.macro = data;
    status.macro.ok = got;
    status.macro.error = errors.length ? errors.slice(0, 3).join(' | ') : null;
  },
  async calendar() {
    try { raw.calendar = TE_KEY ? await S.fetchCalendarTE(TE_KEY) : await S.fetchCalendarFF(); status.calendar.ok = true; status.calendar.error = null; }
    catch (e) { status.calendar.ok = false; status.calendar.error = e.message; }
  },
  async news() {
    const { data, errors } = await S.fetchNews();
    if (data.length) raw.news = data;
    status.news.ok = data.length > 0;
    status.news.error = errors.length ? errors.slice(0, 3).join(' | ') : null;
  },
};

const running = {};
const retries = {};
async function run(name) {
  if (running[name]) return;
  running[name] = true;
  try { await refreshers[name](); status[name].at = new Date().toISOString(); if (!status[name].ok && !status[name].error) status[name].error = null; }
  catch (e) { status[name].ok = false; status[name].error = e.message; console.error('[' + name + ']', e.message); }
  finally {
    running[name] = false; recompute(); persist();
    // a failed or partial pull is retried a few times instead of waiting for the next scheduled run
    if ((name === 'cot' || name === 'calendar') && (!status[name].ok || status[name].error)) {
      retries[name] = (retries[name] || 0) + 1;
      if (retries[name] <= 4) setTimeout(() => run(name), 3 * 60e3).unref();
    } else retries[name] = 0; console.log('[' + name + '] ' + (status[name].ok ? 'ok' : 'failed') + (status[name].error ? ' - ' + status[name].error : '')); }
}

function startScheduler() {
  // stagger the first runs; macro and calendar are small, prices take about 30 seconds
  run('calendar'); run('news'); run('macro'); run('cot'); run('prices');
  Object.keys(EVERY).forEach((k) => setInterval(() => run(k), EVERY[k]).unref());
}

/* ---------------- http ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

const quoteCache = new Map();
const newsCache = new Map();
const intraCache = new Map();
function symbolsFor(id) {
  if (C.FX_PAIRS.includes(id)) return [id + '=X'];
  if (C.CUR_PRICE[id]) return [C.CUR_PRICE[id]];
  const o = C.OTHERS.find((x) => x.id === id);
  return o ? [o.yahoo].concat(o.alt ? [o.alt] : []) : null;
}
async function quoteFor(syms) {
  let err;
  for (const s of syms) { try { return await S.yahooQuote(s); } catch (e) { err = e; } }
  throw err;
}

function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function apiData() {
  return {
    updatedAt: model.updatedAt,
    ready: model.markets.length > 0 && Object.keys(raw.prices).length > 0,
    sources: status,
    markets: model.markets,
    banks: model.banks,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/data') return sendJson(res, apiData());
  if (url.pathname === '/api/status') return sendJson(res, { sources: status, updatedAt: model.updatedAt, counts: { prices: Object.keys(raw.prices).length, cot: Object.keys(raw.cot).length, calendar: (raw.calendar || []).length, news: (raw.news || []).length } });
  if (url.pathname === '/api/calendar') {
    const now = Date.now() - 12 * 3600e3;
    return sendJson(res, { source: status.calendar, events: (raw.calendar || []).filter((e) => new Date(e.t).getTime() >= now).sort((a, b) => new Date(a.t) - new Date(b.t)) });
  }
  if (url.pathname === '/api/news') {
    const nid = url.searchParams.get('id');
    if (!nid) return sendJson(res, { source: status.news, items: raw.news || [] });
    const q = C.newsQuery(nid);
    if (!q) return sendJson(res, { error: 'unknown market' }, 404);
    const hit = newsCache.get(nid);
    if (hit && Date.now() - hit.at < 15 * 60e3) return sendJson(res, hit.out);
    S.fetchMarketNews(q).then((items) => {
      const out = { id: nid, items };
      newsCache.set(nid, { at: Date.now(), out });
      sendJson(res, out);
    }).catch((e) => sendJson(res, { id: nid, items: [], error: e.message }));
    return;
  }
  if (url.pathname === '/api/intraday') {
    const iid = url.searchParams.get('id') || '';
    const isyms = symbolsFor(iid);
    if (!isyms) return sendJson(res, { error: 'unknown market' }, 404);
    const ihit = intraCache.get(iid);
    if (ihit && Date.now() - ihit.at < 60e3) return sendJson(res, ihit.out);
    (async () => {
      let err;
      for (const s of isyms) {
        try { const out = { id: iid, points: await S.yahooIntraday(s) }; intraCache.set(iid, { at: Date.now(), out }); return sendJson(res, out); }
        catch (e) { err = e; }
      }
      sendJson(res, { id: iid, points: [], error: err && err.message }, 502);
    })();
    return;
  }
  if (url.pathname === '/api/quote') {
    const id = url.searchParams.get('id') || '';
    const sym = symbolsFor(id);
    if (!sym) return sendJson(res, { error: 'unknown market' }, 404);
    const hit = quoteCache.get(id);
    if (hit && Date.now() - hit.at < 10000) return sendJson(res, hit.q);
    quoteFor(sym).then((q) => {
      const out = { id, price: q.price, prev: q.prev, chg: q.prev ? (q.price / q.prev - 1) * 100 : null, t: q.t || Math.floor(Date.now() / 1000) };
      quoteCache.set(id, { at: Date.now(), q: out });
      sendJson(res, out);
    }).catch((e) => sendJson(res, { error: e.message }, 502));
    return;
  }
  if (url.pathname === '/api/refresh' && req.method === 'POST') { Object.keys(refreshers).forEach((k) => run(k)); return sendJson(res, { started: true }); }
  if (url.pathname.startsWith('/api/')) return sendJson(res, { error: 'not found' }, 404);

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(__dirname, 'public', rel));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

if (require.main === module) {
  recompute();
  server.listen(PORT, () => {
    console.log('Macro Compass on http://localhost:' + PORT);
    console.log('Macro source: ' + status.macro.note);
    startScheduler();
  });
}

module.exports = { server, run, status, raw, recompute, apiData };
