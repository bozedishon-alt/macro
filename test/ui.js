'use strict';
// UI smoke test: loads the real page + app.js in jsdom against the pipeline output (fake sources) and visits every route.
// jsdom is not a project dependency. Run with: NODE_PATH=/path/to/node_modules node test/ui.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TE_API_KEY = 'test';
process.env.FETCH_DELAY_SCALE = '0';
process.env.CACHE_FILE = path.join(os.tmpdir(), 'mc-ui-cache-' + Date.now() + '.json');
require('./fakes').install();

const { JSDOM, VirtualConsole } = require('jsdom');

(async () => {
  const srv = require('../server');
  await Promise.all(['prices', 'cot', 'macro', 'calendar'].map((k) => srv.run(k)));
  const data = JSON.parse(JSON.stringify(srv.apiData()));
  const calendar = { source: data.sources.calendar, events: srv.raw.calendar };

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/<link[^>]*>/g, '').replace(/<script src="\/app.js"><\/script>/, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.fetch = (u) => Promise.resolve({ json: async () => (String(u).includes('calendar') ? calendar : data) });
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'));

  const tick = () => new Promise((r) => setTimeout(r, 30));
  const app = () => w.document.getElementById('app').innerHTML;
  const go = async (hash) => { w.location.hash = hash; await tick(); await tick(); };
  await tick(); await tick();

  // home
  assert.ok(app().includes('خريطة الانحياز'), 'home heading');
  assert.strictEqual(w.document.querySelectorAll('.tile').length, 53, 'home shows 53 tiles');
  assert.strictEqual(w.document.querySelectorAll('.strength .col').length, 8, '8 currency bars');

  // filters
  w.document.querySelector('[data-cat="idx"]').click();
  assert.strictEqual(w.document.querySelectorAll('.tile').length, 8, 'index filter');
  w.document.querySelector('[data-cat="all"]').click();
  const q = w.document.getElementById('q'); q.value = 'gold';
  q.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.strictEqual(w.document.querySelectorAll('.tile').length, 1, 'search finds gold');
  q.value = ''; q.dispatchEvent(new w.Event('input', { bubbles: true }));

  // market pages
  for (const id of ['GBPUSD', 'USD', 'XAU', 'SPX', 'US10Y', 'BTC']) {
    await go('m-' + id);
    const h = app();
    assert.ok(h.includes('تفصيل العوامل'), id + ' factor section');
    assert.ok(h.includes('المحركات الرئيسية'), id + ' drivers');
    assert.ok(w.document.querySelectorAll('#factor-cards .rw').length === 17, id + ' has 17 factor rows');
    if (id === 'GBPUSD') {
      assert.ok(h.includes('class="pchart"'), 'price chart');
      assert.ok(h.includes('البنوك المركزية') && w.document.querySelectorAll('.cb').length === 2, 'two bank cards');
    }
  }
  w.document.querySelector('[data-fg="mon"]').click();
  assert.strictEqual(w.document.querySelectorAll('#factor-cards .card').length, 1, 'factor group filter');

  // other pages
  await go('rates');
  assert.strictEqual(w.document.querySelectorAll('tbody tr').length, 8, 'rates table rows');
  await go('calendar');
  await tick();
  assert.ok(w.document.querySelectorAll('.cal-day').length >= 1, 'calendar days');
  w.document.querySelector('[data-ci="3"]').click();
  assert.ok(w.document.querySelectorAll('tbody tr').length >= 1, 'high importance events remain');

  assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  console.log('UI SMOKE TEST PASSED');
  process.exit(0);
})().catch((e) => { console.error('UI TEST FAILED:', e); process.exit(1); });
