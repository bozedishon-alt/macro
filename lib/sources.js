'use strict';
// Data fetchers. Each returns plain objects; none of them throw for a single missing item.
const C = require('./config');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DELAY_SCALE = process.env.FETCH_DELAY_SCALE === undefined ? 1 : Number(process.env.FETCH_DELAY_SCALE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * DELAY_SCALE));

async function getJson(url, timeout = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ---------------- prices (Yahoo Finance chart endpoint, no key) ---------------- */
async function yahooSeries(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=10y&interval=1d';
  let j;
  try { j = await getJson(url); }
  catch (e) { if (e.status === 429) { await sleep(3000); j = await getJson(url); } else throw e; }
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error('no result for ' + symbol);
  const ts = r.timestamp || [];
  const cl = ((r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}).close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null && isFinite(cl[i])) points.push([ts[i], cl[i]]);
  if (points.length < 30) throw new Error('too few points for ' + symbol);
  return points;
}

/* ---------------- live quote (Yahoo, 1 minute bars) ---------------- */
async function yahooQuote(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=1m';
  const j = await getJson(url, 12000);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error('no quote for ' + symbol);
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const cl = ((r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}).close || [];
  let price = meta.regularMarketPrice, t = meta.regularMarketTime || null;
  for (let i = cl.length - 1; i >= 0 && price == null; i--) if (cl[i] != null) { price = cl[i]; t = ts[i] || t; }
  if (price == null) throw new Error('empty quote for ' + symbol);
  const prev = meta.chartPreviousClose != null ? meta.chartPreviousClose : (meta.previousClose != null ? meta.previousClose : null);
  return { price, prev, t };
}

async function yahooIntraday(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=5d&interval=15m';
  const j = await getJson(url, 15000);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error('no intraday for ' + symbol);
  const ts = r.timestamp || [];
  const cl = ((r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}).close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] != null && isFinite(cl[i])) points.push([ts[i], Number(cl[i].toPrecision(7))]);
  if (points.length < 20) throw new Error('too few intraday points for ' + symbol);
  return points.slice(-600);
}

function priceSymbols() {
  const list = C.FX_PAIRS.map((p) => ({ id: p, symbol: p + '=X' }));
  Object.keys(C.CUR_PRICE).forEach((c) => list.push({ id: c, symbol: C.CUR_PRICE[c] }));
  C.OTHERS.forEach((o) => list.push({ id: o.id, symbol: o.yahoo, alt: o.alt || null }));
  return list;
}

async function fetchPrices(delayMs = 450) {
  const out = {}; const errors = [];
  for (const s of priceSymbols()) {
    try { out[s.id] = await yahooSeries(s.symbol); }
    catch (e) {
      let ok = false;
      if (s.alt) { try { out[s.id] = await yahooSeries(s.alt); ok = true; } catch (e2) { /* fall through */ } }
      if (!ok) errors.push(s.id + ': ' + e.message);
    }
    await sleep(delayMs);
  }
  return { data: out, errors };
}

/* ---------------- COT (CFTC public reporting, legacy futures-only, no key) ---------------- */
async function cotSeries(key) {
  const where = "market_and_exchange_names like '%" + key + "%'";
  const url = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=' + encodeURIComponent(where) +
    '&$order=' + encodeURIComponent('report_date_as_yyyy_mm_dd DESC') + '&$limit=1500';
  const rows = await getJson(url);
  if (!Array.isArray(rows) || !rows.length) throw new Error('no rows');
  const groups = {};
  rows.forEach((r) => {
    const n = r.market_and_exchange_names;
    const l = Number(r.noncomm_positions_long_all), s = Number(r.noncomm_positions_short_all);
    const d = r.report_date_as_yyyy_mm_dd || r.report_date;
    if (!n || !isFinite(l) || !isFinite(s) || !d) return;
    (groups[n] = groups[n] || []).push({ d: String(d).slice(0, 10), net: l - s });
  });
  const names = Object.keys(groups);
  if (!names.length) throw new Error('no usable rows (field names changed?)');
  // choose the contract with the longest history; ties go to the shortest name
  names.sort((a, b) => groups[b].length - groups[a].length || a.length - b.length);
  const pick = names[0];
  const series = groups[pick].sort((a, b) => (a.d < b.d ? -1 : 1));
  return { name: pick, series };
}

async function fetchCot() {
  const keys = {};
  Object.values(C.COT_KEY).forEach((k) => { keys[k] = true; });
  C.OTHERS.forEach((o) => { if (o.cot) keys[o.cot] = true; });
  const out = {}; const errors = [];
  for (const k of Object.keys(keys)) {
    try { out[k] = await cotSeries(k); }
    catch (e) { errors.push(k + ': ' + e.message); }
    await sleep(250);
  }
  return { data: out, errors };
}

/* ---------------- macro: Trading Economics (key) ---------------- */
function pickCategory(map, names) {
  for (const n of names) if (map[n] && map[n].v != null) return map[n];
  return null;
}

async function teCountry(country, key) {
  const map = {};
  for (const g of C.TE_GROUPS) {
    const url = 'https://api.tradingeconomics.com/country/' + country.replace(/ /g, '%20') +
      '?c=' + encodeURIComponent(key) + '&group=' + g + '&f=json';
    const arr = await getJson(url);
    if (!Array.isArray(arr)) throw new Error('unexpected response (' + g + ')');
    arr.forEach((r) => {
      if (!r || !r.Category) return;
      map[r.Category] = { v: num(r.LatestValue), p: num(r.PreviousValue), d: r.LatestValueDate || null, pd: r.PreviousValueDate || null };
    });
    await sleep(200);
  }
  const res = {};
  Object.keys(C.TE_CATEGORY).forEach((f) => { const hit = pickCategory(map, C.TE_CATEGORY[f]); if (hit) res[f] = hit; });
  return res;
}

function num(x) { const n = Number(x); return x === null || x === undefined || x === '' || !isFinite(n) ? null : n; }

async function fetchMacroTE(key) {
  const out = {}; const errors = [];
  for (const cur of C.CURRENCIES) {
    try { out[cur] = await teCountry(C.TE_COUNTRY[cur], key); }
    catch (e) { errors.push(cur + ': ' + e.message); out[cur] = {}; }
  }
  return { data: out, errors };
}

/* ---------------- macro: FRED fallback (US only, free key) ---------------- */
async function fredSeries(spec, key) {
  const url = 'https://api.stlouisfed.org/fred/series/observations?series_id=' + spec.id +
    '&api_key=' + encodeURIComponent(key) + '&file_type=json&sort_order=desc&limit=6&units=' + spec.units;
  const j = await getJson(url);
  const obs = ((j && j.observations) || []).filter((o) => o.value !== '.' && isFinite(Number(o.value)));
  if (obs.length < 2) throw new Error('no observations for ' + spec.id);
  return { v: Number(obs[0].value), p: Number(obs[1].value), d: obs[0].date, pd: obs[1].date };
}

async function fetchMacroFRED(key) {
  const us = {}; const errors = [];
  for (const f of Object.keys(C.FRED_US)) {
    try { us[f] = await fredSeries(C.FRED_US[f], key); }
    catch (e) { errors.push(f + ': ' + e.message); }
    await sleep(150);
  }
  const out = {}; C.CURRENCIES.forEach((c) => { out[c] = {}; });
  out.USD = us;
  for (const cur of Object.keys(C.FRED_RATES)) {
    try {
      const spec = C.FRED_RATES[cur];
      const r = await fredRate(spec, key);
      const age = (Date.now() - new Date(r.last).getTime()) / 864e5;
      if (age > 120) throw new Error('stale (' + r.last + ')');
      r.approx = !!spec.approx;
      out[cur].rate = r;
    } catch (e) { errors.push(cur + ' rate: ' + e.message); }
    await sleep(150);
  }
  try { const lo = await fredRate({ id: C.FRED_RATE_LOW, limit: 10 }, key); out.USD.rate_lo = { v: lo.v }; } catch (e) { /* range is optional */ }
  return { data: out, errors };
}

// Policy-rate history: current value, the previous different value and the date the current level started.
async function fredRate(spec, key) {
  const url = 'https://api.stlouisfed.org/fred/series/observations?series_id=' + spec.id +
    '&api_key=' + encodeURIComponent(key) + '&file_type=json&sort_order=desc&limit=' + (spec.limit || 60);
  const j = await getJson(url);
  const obs = ((j && j.observations) || []).filter((o) => o.value !== '.' && isFinite(Number(o.value)));
  if (!obs.length) throw new Error('no observations for ' + spec.id);
  const v = Number(obs[0].value);
  let i = 1; while (i < obs.length && Number(obs[i].value) === v) i++;
  const p = i < obs.length ? Number(obs[i].value) : null;
  return { v, p, d: p == null ? null : obs[i - 1].date, last: obs[0].date };
}

/* ---------------- economic calendar ---------------- */
const CUR_BY_COUNTRY = {};
Object.keys(C.TE_COUNTRY).forEach((c) => { CUR_BY_COUNTRY[C.TE_COUNTRY[c]] = c; });

function ymd(d) { return d.toISOString().slice(0, 10); }

async function fetchCalendarTE(key) {
  const from = new Date(Date.now() - 2 * 864e5), to = new Date(Date.now() + 35 * 864e5);
  const list = Object.values(C.TE_COUNTRY).map((c) => c.replace(/ /g, '%20')).join(',');
  const url = 'https://api.tradingeconomics.com/calendar/country/' + list + '/' + ymd(from) + '/' + ymd(to) +
    '?c=' + encodeURIComponent(key) + '&f=json';
  const arr = await getJson(url);
  if (!Array.isArray(arr)) throw new Error('unexpected calendar response');
  return arr.map((e) => ({
    t: e.Date ? new Date(e.Date.endsWith('Z') ? e.Date : e.Date + 'Z').toISOString() : null,
    cur: CUR_BY_COUNTRY[String(e.Country || '').toLowerCase()] || null,
    event: e.Event || e.Category || '',
    actual: e.Actual || '', previous: e.Previous || '', forecast: e.Forecast || e.TEForecast || '',
    imp: Number(e.Importance) || 1,
  })).filter((e) => e.t && e.cur);
}

// Free fallback: Forex Factory weekly feed (unofficial)
async function fetchCalendarFF() {
  const arr = await getJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
  if (!Array.isArray(arr)) throw new Error('unexpected feed');
  const impMap = { High: 3, Medium: 2, Low: 1 };
  return arr.map((e) => ({
    t: e.date ? new Date(e.date).toISOString() : null,
    cur: C.CURRENCIES.includes(e.country) ? e.country : null,
    event: e.title || '', actual: e.actual || '', previous: e.previous || '', forecast: e.forecast || '',
    imp: impMap[e.impact] || 1,
  })).filter((e) => e.t && e.cur);
}

/* ---------------- news (RSS, no key) ---------------- */
const FEEDS = [
  { src: 'Federal Reserve', cur: 'USD', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { src: 'Bank of England', cur: 'GBP', url: 'https://www.bankofengland.co.uk/rss/news' },
  { src: 'ECB', cur: 'EUR', url: 'https://www.ecb.europa.eu/rss/press.html' },
  { src: 'FXStreet', cur: null, url: 'https://www.fxstreet.com/rss/news' },
];

async function getText(url, timeout = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

function decodeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();
}
function tagText(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? decodeXml(m[1]) : '';
}
function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 20).map((b) => {
    const title = tagText(b, 'title');
    let link = tagText(b, 'link');
    if (!link) { const h = b.match(/<link[^>]*href="([^"]+)"/i); link = h ? h[1] : ''; }
    const d = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date');
    const t = d ? new Date(d).getTime() : NaN;
    return { title, link, t: isFinite(t) ? new Date(t).toISOString() : null, src: feed.src, cur: feed.cur };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link) && x.t);
}
async function fetchNews() {
  const items = []; const errors = [];
  for (const f of FEEDS) {
    try { items.push(...parseFeed(await getText(f.url), f)); }
    catch (e) { errors.push(f.src + ': ' + e.message); }
  }
  items.sort((a, b) => new Date(b.t) - new Date(a.t));
  return { data: items.slice(0, 80), errors };
}

// Market-specific headlines from the Google News RSS search (no key).
async function fetchMarketNews(query) {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query + ' when:2d') + '&hl=en-US&gl=US&ceid=US:en';
  const items = parseFeed(await getText(url), { src: 'Google News', cur: null });
  items.forEach((n) => {
    const k = n.title.lastIndexOf(' - ');
    if (k > 10) { n.src = n.title.slice(k + 3); n.title = n.title.slice(0, k); }
  });
  items.sort((a, b) => new Date(b.t) - new Date(a.t));
  return items.slice(0, 10);
}

module.exports = {
  fetchMarketNews, yahooIntraday, fredRate,
  fetchNews, parseFeed, fetchPrices, fetchCot, fetchMacroTE, fetchMacroFRED, fetchCalendarTE, fetchCalendarFF,
  yahooSeries, yahooQuote, cotSeries, getJson,
};
