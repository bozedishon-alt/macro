'use strict';
// Fake responses shaped like the real services (Yahoo, CFTC, Trading Economics).
function install() {
function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
  
  function fakeYahoo(symbol) {
    const h = hash(symbol);
    const drift = ((h % 7) - 3) / 3000; // per-day drift between -0.1% and +0.1%
    const ts = [], close = [];
    let price = 50 + (h % 100), t = Math.floor(Date.now() / 1000) - 2600 * 86400, seed = h;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    while (t < Date.now() / 1000) {
      const d = new Date(t * 1000).getUTCDay();
      if (d !== 0 && d !== 6) { price *= 1 + drift + rnd() * 0.01; ts.push(t); close.push(price); }
      t += 86400;
    }
    close[5] = null; // holes happen
    return { chart: { result: [{ meta: { symbol }, timestamp: ts, indicators: { quote: [{ close }] } }] } };
  }
  
  function fakeCot(url) {
    const where = decodeURIComponent(url.match(/\$where=([^&]*)/)[1]);
    const key = where.match(/like '%(.*)%'/)[1];
    const rows = [];
    let seed = hash(key);
    for (let i = 0; i < 200; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const d = new Date(Date.now() - i * 7 * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000';
      rows.push({ market_and_exchange_names: key + ' - TEST EXCHANGE', report_date_as_yyyy_mm_dd: d, noncomm_positions_long_all: String(100000 + (seed % 50000)), noncomm_positions_short_all: String(90000 + (i * 300)) });
    }
    rows.push({ market_and_exchange_names: key + '/OTHER XRATE - TEST', report_date_as_yyyy_mm_dd: '2026-10-01T00:00:00.000', noncomm_positions_long_all: '5', noncomm_positions_short_all: '3' });
    return rows;
  }
  
  const MACRO = {
    'united states': { 'GDP Annual Growth Rate': [3.1, 2.4], 'Manufacturing PMI': [52.5, 51], 'Services PMI': [53, 52], 'Retail Sales YoY': [4, 3], 'Consumer Confidence': [105, 100], 'Inflation Rate': [3.7, 3.4], 'Core Inflation Rate': [3.4, 3.4], 'Producer Prices Change': [3.2, 2.1], 'Non Farm Payrolls': [210, 180], 'Unemployment Rate': [3.9, 4.1], 'Initial Jobless Claims': [210, 225], 'Interest Rate': [5.5, 5.25] },
    'euro area': { 'GDP Annual Growth Rate': [0.2, 0.5], 'Manufacturing PMI': [45, 46], 'Services PMI': [48, 49], 'Retail Sales YoY': [-1.5, -1], 'Consumer Confidence': [-16, -15], 'Inflation Rate': [2.0, 2.2], 'Core Inflation Rate': [2.2, 2.3], 'Producer Prices Change': [-1, -0.5], 'Employment Change': [0.1, 0.2], 'Unemployment Rate': [6.4, 6.4], 'Interest Rate': [4, 4] },
    'united kingdom': { 'GDP Annual Growth Rate': [0.5, 0.3], 'Inflation Rate': [4.6, 4.8], 'Interest Rate': [5.25, 5.25], 'Unemployment Rate': [4.2, 4.1] },
    japan: { 'Interest Rate': [-0.1, -0.1], 'Inflation Rate': [3.0, 3.1] },
    switzerland: { 'Interest Rate': [1.75, 1.75] },
    canada: { 'Interest Rate': [5, 4.75], 'Inflation Rate': [3.1, 3.3] },
    australia: { 'Interest Rate': [4.1, 4.1] },
    'new zealand': { 'Interest Rate': [5.5, 5.5] },
  };
  const GROUP_OF = { 'GDP Annual Growth Rate': 'gdp', 'Manufacturing PMI': 'business', 'Services PMI': 'business', 'Retail Sales YoY': 'consumer', 'Consumer Confidence': 'consumer', 'Inflation Rate': 'prices', 'Core Inflation Rate': 'prices', 'Producer Prices Change': 'prices', 'Non Farm Payrolls': 'labour', 'Employment Change': 'labour', 'Unemployment Rate': 'labour', 'Initial Jobless Claims': 'labour', 'Interest Rate': 'money' };
  
  function fakeTE(url) {
    const m = url.match(/\/country\/([^?]*)\?.*group=(\w+)/);
    if (m) {
      const country = decodeURIComponent(m[1]);
      const rows = [];
      Object.entries(MACRO[country] || {}).forEach(([cat, [v, p]]) => {
        if (GROUP_OF[cat] === m[2]) rows.push({ Country: country, Category: cat, LatestValue: v, PreviousValue: p, LatestValueDate: new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 19), PreviousValueDate: '2026-01-01T00:00:00' });
      });
      return rows;
    }
    if (url.includes('/calendar/country/')) {
      const mk = (days, cty, ev, imp) => ({ Date: new Date(Date.now() + days * 864e5).toISOString().slice(0, 19), Country: cty, Event: ev, Actual: '', Previous: '1%', Forecast: '1.1%', Importance: imp });
      return [mk(10, 'United States', 'Fed Interest Rate Decision', 3), mk(14, 'United Kingdom', 'BoE Interest Rate Decision', 3), mk(2, 'Japan', 'Retail Sales (YoY)', 2)];
    }
    throw new Error('unexpected TE url ' + url);
  }
  
  global.fetch = async (url) => {
    url = String(url);
    let body;
    try {
      if (url.includes('query1.finance.yahoo.com')) body = fakeYahoo(decodeURIComponent(url.match(/chart\/([^?]*)/)[1]));
      else if (url.includes('publicreporting.cftc.gov')) body = fakeCot(url);
      else if (url.includes('tradingeconomics.com')) body = fakeTE(url);
      else if (/federalreserve\.gov|bankofengland|ecb\.europa|fxstreet/.test(url)) {
        const host = url.match(/\/\/([^/]+)/)[1];
        const item = (n) => '<item><title><![CDATA[' + host + ' headline ' + n + ' &amp; more]]></title><link>https://example.com/' + host + '/' + n + '</link><pubDate>' + new Date(Date.now() - n * 3600e3).toUTCString() + '</pubDate></item>';
        body = '<?xml version="1.0"?><rss><channel>' + [1, 2, 3].map(item).join('') + '</channel></rss>';
      }
      else return { ok: false, status: 404, json: async () => ({}) };
    } catch (e) { return { ok: false, status: 500, json: async () => ({ error: e.message }) }; }
    return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  
  
}
module.exports = { install };
