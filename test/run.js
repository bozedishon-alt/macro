'use strict';
// Offline test: replaces fetch with fake responses shaped like the real services, then runs the whole pipeline.
const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.TE_API_KEY = 'test';
process.env.FETCH_DELAY_SCALE = '0';
process.env.CACHE_FILE = path.join(os.tmpdir(), 'mc-test-cache-' + Date.now() + '.json');

require('./fakes').install();

(async () => {
  const srv = require('../server');
  await Promise.all(['prices', 'cot', 'macro', 'calendar', 'news'].map((k) => srv.run(k)));
  const data = srv.apiData();

  console.log('status:', JSON.stringify(Object.fromEntries(Object.entries(data.sources).map(([k, v]) => [k, v.ok ? 'ok' : 'FAIL ' + v.error]))));
  assert.ok(data.ready, 'model not ready');
  assert.strictEqual(data.markets.length, 29 + 8 + 17, 'market count');
  Object.values(data.sources).forEach((s) => assert.ok(s.ok, 'source failed: ' + s.error));

  const byId = Object.fromEntries(data.markets.map((m) => [m.id, m]));
  const usd = byId.USD, eur = byId.EUR;
  console.log('USD score', usd.score, usd.bias, 'coverage', usd.coverage + '%');
  console.log('EUR score', eur.score, eur.bias, 'coverage', eur.coverage + '%');
  assert.ok(usd.score > eur.score, 'USD (strong data, high rate) should outscore EUR (weak data)');
  const pair = byId.EURUSD;
  assert.ok(pair.score < 0, 'EUR/USD should lean bearish, got ' + pair.score);
  assert.strictEqual(byId.USDEUR, undefined);
  assert.ok(pair.series.length === 120 && pair.price > 0, 'price series');
  pair.factors.forEach((f) => assert.ok(f.v >= -2 && f.v <= 2, 'factor range ' + f.k));
  const fx = pair.factors.reduce((a, f) => a + f.v, 0);
  assert.strictEqual(fx, pair.score, 'score equals factor sum');

  // factors with no data are flagged, not silently zero
  const jpy = byId.JPY;
  assert.ok(jpy.factors.some((f) => f.na), 'JPY should have missing factors');
  assert.ok(jpy.coverage < usd.coverage, 'coverage ordering');

  // non-FX market driven by USD macro
  assert.ok(byId.XAU.gs.growth < 0 && byId.XAU.gs.jobs < 0 && byId.USD.gs.growth > 0, 'gold mirrors the dollar macro');
  assert.ok(byId.XAG.gs.growth < 0, 'silver mirrors the dollar macro');
  const spx = byId.SPX;
  assert.ok(spx.factors.find((f) => f.k === 'cot' && !f.na), 'SPX has COT');
  assert.ok(spx.factors.find((f) => f.k === 'gdp' && !f.na), 'SPX has macro via USD');

  // banks and next meeting from calendar
  assert.strictEqual(data.banks.USD.rate, 5.5);
  assert.ok(data.banks.USD.next, 'Fed next meeting from calendar');
  assert.strictEqual(data.banks.JPY.next, null);

  // missing data on one side is left out, not counted as zero
  const uj = byId.USDJPY;
  assert.ok(uj.factors.find((f) => f.k === 'gdp').na, 'USDJPY gdp should be n/a (no JPY data)');
  assert.ok(byId.USDZAR && byId.USDZAR.factors.find((f) => f.k === 'cot' && !f.na), 'USDZAR with COT');
  assert.ok(byId.USDZAR.factors.find((f) => f.k === 'gdp').na, 'USDZAR macro n/a');
  assert.ok(uj.max < pair.max, 'max shrinks with coverage');
  const { biasOf } = require('../lib/scoring');
  assert.strictEqual(biasOf(11, 36), 'vb'); assert.strictEqual(biasOf(5, 36), 'b'); assert.strictEqual(biasOf(3, 36), 'n');
  assert.strictEqual(biasOf(3, 6), 'b'); assert.strictEqual(biasOf(6, 6), 'vb'); assert.strictEqual(biasOf(-2, 6), 'n');

  // HTTP layer
  await new Promise((r) => srv.server.listen(0, r));
  const port = srv.server.address().port;
  const http = require('http');
  const get = (p) => new Promise((res, rej) => http.get({ port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ code: r.statusCode, body: b })); }).on('error', rej));
  const a = await get('/api/data'); assert.strictEqual(a.code, 200); assert.strictEqual(JSON.parse(a.body).markets.length, 54);
  const cal = await get('/api/calendar'); assert.ok(JSON.parse(cal.body).events.length >= 2);
  const trav = await get('/..%2Fserver.js'); assert.ok(trav.code === 403 || trav.code === 404, 'path traversal blocked, got ' + trav.code);
  const nw = JSON.parse((await get('/api/news')).body);
  assert.ok(nw.items.length >= 9, 'news items parsed: ' + nw.items.length);
  assert.ok(nw.items[0].title.includes('&') && !nw.items[0].title.includes('CDATA') && !nw.items[0].title.includes('&amp;'), 'news title decoded: ' + nw.items[0].title);
  assert.ok(nw.items.every((n) => /^https?:/.test(n.link) && n.t), 'news links and dates');
  const qq = await get('/api/quote?id=GBPUSD'); assert.strictEqual(qq.code, 200); assert.ok(JSON.parse(qq.body).price > 0, 'quote price');
  assert.strictEqual((await get('/api/quote?id=nope')).code, 404, 'unknown quote id');
  assert.strictEqual((await get('/api/quote?id=USD')).code, 200, 'USD quotes the dollar index');
  assert.strictEqual((await get('/api/quote?id=EUR')).code, 404, 'EUR has no quote');
  const intra = JSON.parse((await get('/api/intraday?id=GBPUSD')).body); assert.ok(intra.points.length >= 20, 'intraday points');
  assert.strictEqual((await get('/api/intraday?id=nope')).code, 404, 'unknown intraday id');
  const mn = JSON.parse((await get('/api/news?id=XAU')).body); assert.ok(mn.items.length >= 1 && mn.items[0].src, 'market news');
  assert.strictEqual((await get('/api/news?id=nope')).code, 404, 'unknown news id');
  assert.ok(byId.USD.price > 0 && byId.USD.series.length > 10, 'USD has a dollar-index price');
  srv.server.close();

  // FRED path: policy-rate history, free rates for other currencies, Fed range
  const S = require('../lib/sources');
  const fr = await S.fetchMacroFRED('k');
  assert.strictEqual(fr.data.USD.rate.v, 4); assert.strictEqual(fr.data.USD.rate.p, 3.75); assert.ok(fr.data.USD.rate.d, 'last change date');
  assert.strictEqual(fr.data.USD.rate_lo.v, 3.75);
  assert.ok(fr.data.EUR.rate && fr.data.GBP.rate && fr.data.GBP.rate.approx === true, 'free rates for other currencies');
  assert.ok(data.banks.USD.next, 'next meeting');

  console.log('\nTop FX by |score|:');
  data.markets.filter((m) => m.cat === 'fx').sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5)
    .forEach((m) => console.log(' ', m.label, m.score, m.bias, 'agree', m.agree + '/' + m.nonzero));
  console.log('\nALL TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
