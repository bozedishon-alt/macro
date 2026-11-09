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
};
const CACHE_FILE = process.env.CACHE_FILE || path.join(__dirname, 'data', 'cache.json');

const raw = { prices: {}, cot: {}, macro: {}, calendar: [] };
const status = {
  prices: { ok: false, at: null, error: null, note: null },
  cot: { ok: false, at: null, error: null, note: null },
  macro: { ok: false, at: null, error: null, note: TE_KEY ? 'Trading Economics' : FRED_KEY ? 'FRED (أمريكا فقط)' : 'غير مفعّل: أضف TE_API_KEY أو FRED_API_KEY' },
  calendar: { ok: false, at: null, error: null, note: TE_KEY ? 'Trading Economics' : 'Forex Factory (هذا الأسبوع)' },
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
    const b = { cur, short: C.BANKS[cur].short, name: C.BANKS[cur].name, rate: null, prev: null, lastDate: null, next: null };
    if (r && r.v != null) { b.rate = r.v; b.prev = r.p; b.lastDate = r.d; }
    const now = Date.now();
    const next = (raw.calendar || [])
      .filter((e) => e.cur === cur && /interest rate decision|rate statement|monetary policy (meeting|decision)/i.test(e.event) && new Date(e.t).getTime() > now)
      .sort((a, z) => new Date(a.t) - new Date(z.t))[0];
    if (next) b.next = next.t;
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
    status.prices.error = summarize(errors, C.FX_PAIRS.length + C.OTHERS.length);
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
};

const running = {};
async function run(name) {
  if (running[name]) return;
  running[name] = true;
  try { await refreshers[name](); status[name].at = new Date().toISOString(); if (!status[name].ok && !status[name].error) status[name].error = null; }
  catch (e) { status[name].ok = false; status[name].error = e.message; console.error('[' + name + ']', e.message); }
  finally { running[name] = false; recompute(); persist(); console.log('[' + name + '] ' + (status[name].ok ? 'ok' : 'failed') + (status[name].error ? ' - ' + status[name].error : '')); }
}

function startScheduler() {
  // stagger the first runs; macro and calendar are small, prices take about 30 seconds
  run('calendar'); run('macro'); run('cot'); run('prices');
  Object.keys(EVERY).forEach((k) => setInterval(() => run(k), EVERY[k]).unref());
}

/* ---------------- http ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

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
  if (url.pathname === '/api/status') return sendJson(res, { sources: status, updatedAt: model.updatedAt, counts: { prices: Object.keys(raw.prices).length, cot: Object.keys(raw.cot).length, calendar: (raw.calendar || []).length } });
  if (url.pathname === '/api/calendar') {
    const now = Date.now() - 12 * 3600e3;
    return sendJson(res, { source: status.calendar, events: (raw.calendar || []).filter((e) => new Date(e.t).getTime() >= now).sort((a, b) => new Date(a.t) - new Date(b.t)) });
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
