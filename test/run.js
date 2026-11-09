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
  await Promise.all(['prices', 'cot', 'macro', 'calendar'].map((k) => srv.run(k)));
  const data = srv.apiData();

  console.log('status:', JSON.stringify(Object.fromEntries(Object.entries(data.sources).map(([k, v]) => [k, v.ok ? 'ok' : 'FAIL ' + v.error]))));
  assert.ok(data.ready, 'model not ready');
  assert.strictEqual(data.markets.length, 28 + 8 + 17, 'market count');
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
  const spx = byId.SPX;
  assert.ok(spx.factors.find((f) => f.k === 'cot' && !f.na), 'SPX has COT');
  assert.ok(spx.factors.find((f) => f.k === 'gdp' && !f.na), 'SPX has macro via USD');

  // banks and next meeting from calendar
  assert.strictEqual(data.banks.USD.rate, 5.5);
  assert.ok(data.banks.USD.next, 'Fed next meeting from calendar');
  assert.strictEqual(data.banks.JPY.next, null);

  // HTTP layer
  await new Promise((r) => srv.server.listen(0, r));
  const port = srv.server.address().port;
  const http = require('http');
  const get = (p) => new Promise((res, rej) => http.get({ port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ code: r.statusCode, body: b })); }).on('error', rej));
  const a = await get('/api/data'); assert.strictEqual(a.code, 200); assert.strictEqual(JSON.parse(a.body).markets.length, 53);
  const cal = await get('/api/calendar'); assert.ok(JSON.parse(cal.body).events.length >= 2);
  const trav = await get('/..%2Fserver.js'); assert.ok(trav.code === 403 || trav.code === 404, 'path traversal blocked, got ' + trav.code);
  srv.server.close();

  console.log('\nTop FX by |score|:');
  data.markets.filter((m) => m.cat === 'fx').sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5)
    .forEach((m) => console.log(' ', m.label, m.score, m.bias, 'agree', m.agree + '/' + m.nonzero));
  console.log('\nALL TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
