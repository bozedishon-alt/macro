'use strict';
// Turns raw data into factor scores (-2..+2) and market scores. Pure functions, no network.
const C = require('./config');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const biasOf = (s) => (s >= 10 ? 'vb' : s >= 4 ? 'b' : s <= -10 ? 'vbr' : s <= -4 ? 'br' : 'n');

/* ---------- technical ---------- */
function sma(arr, n) {
  if (arr.length < n) return null;
  let s = 0; for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

function techScores(points) {
  if (!points || points.length < 210) return { trend: null, seas: null };
  const closes = points.map((p) => p[1]);
  const last = closes[closes.length - 1];
  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const trend = (last > s50 ? 1 : -1) + (s50 > s200 ? 1 : -1);

  // seasonality: average return of the current calendar month over past completed years
  const monthClose = {}; // 'YYYY-MM' -> last close
  points.forEach((p) => {
    const d = new Date(p[0] * 1000);
    monthClose[d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')] = p[1];
  });
  const lastDate = new Date(points[points.length - 1][0] * 1000);
  const curM = lastDate.getUTCMonth() + 1, curY = lastDate.getUTCFullYear();
  const rets = [];
  for (let y = curY - 10; y < curY; y++) {
    const a = monthClose[y + '-' + String(curM).padStart(2, '0')];
    const pm = curM === 1 ? (y - 1) + '-12' : y + '-' + String(curM - 1).padStart(2, '0');
    const b = monthClose[pm];
    if (a && b) rets.push(a / b - 1);
  }
  let seas = null;
  if (rets.length >= 5) {
    const avg = rets.reduce((x, y) => x + y, 0) / rets.length;
    const hit = rets.filter((r) => r > 0).length / rets.length;
    seas = avg > 0 && hit >= 0.8 ? 2 : avg > 0 && hit >= 0.6 ? 1 : avg < 0 && hit <= 0.2 ? -2 : avg < 0 && hit <= 0.4 ? -1 : 0;
  }
  return { trend, seas };
}

/* ---------- COT ---------- */
function cotScore(entry) {
  if (!entry || !entry.series || entry.series.length < 20) return null;
  const nets = entry.series.slice(-156).map((x) => x.net);
  const latest = nets[nets.length - 1];
  const below = nets.filter((n) => n < latest).length;
  const pct = (below / (nets.length - 1)) * 100;
  return pct >= 80 ? 2 : pct >= 60 ? 1 : pct <= 20 ? -2 : pct <= 40 ? -1 : 0;
}

/* ---------- macro ---------- */
function byThreshold(v, table) { for (const [t, s] of table) if (v >= t) return s; return table[table.length - 1][1]; }

const MACRO_SCORERS = {
  gdp: (m) => {
    const lvl = m.v < 1 ? -1 : m.v > 2.5 ? 1 : 0;
    const mom = m.p == null ? 0 : m.v - m.p > 0.3 ? 1 : m.v - m.p < -0.3 ? -1 : 0;
    return lvl + mom;
  },
  mfg: (m) => (m.v >= 52 ? 2 : m.v >= 50 ? 1 : m.v >= 48 ? -1 : -2),
  svc: (m) => (m.v >= 52 ? 2 : m.v >= 50 ? 1 : m.v >= 48 ? -1 : -2),
  retail: (m) => byThreshold(m.v, [[3, 2], [1, 1], [-1, 0], [-3, -1], [-Infinity, -2]]),
  conf: (m) => {
    if (m.p == null || m.p === 0) return null;
    const ch = (m.v - m.p) / Math.abs(m.p);
    return ch > 0.05 ? 2 : ch > 0.02 ? 1 : ch < -0.05 ? -2 : ch < -0.02 ? -1 : 0;
  },
  cpi: (m) => byThreshold(m.v, [[3.5, 2], [2.4, 1], [1.6, 0], [0.8, -1], [-Infinity, -2]]),
  core: (m) => byThreshold(m.v, [[3.5, 2], [2.4, 1], [1.6, 0], [0.8, -1], [-Infinity, -2]]),
  ppi: (m) => byThreshold(m.v, [[3, 2], [1.5, 1], [-0.5, 0], [-2, -1], [-Infinity, -2]]),
  nfp: (m) => {
    if (m.v > 0) return m.p != null && m.v < m.p ? 1 : 2;
    if (m.v < 0) return m.p != null && m.v > m.p ? -1 : -2;
    return 0;
  },
  unemp: (m) => {
    if (m.p == null) return null;
    const d = m.v - m.p;
    return d <= -0.2 ? 2 : d < 0 ? 1 : d === 0 ? 0 : d <= 0.2 ? -1 : -2;
  },
  claims: (m) => {
    if (m.p == null || m.p === 0) return null;
    const ch = (m.v - m.p) / m.p;
    return ch <= -0.05 ? 2 : ch < -0.01 ? 1 : ch <= 0.01 ? 0 : ch <= 0.05 ? -1 : -2;
  },
};

function scoreMacro(macroByCur) {
  const out = {};
  C.CURRENCIES.forEach((cur) => {
    out[cur] = {};
    const m = (macroByCur && macroByCur[cur]) || {};
    Object.keys(MACRO_SCORERS).forEach((f) => {
      out[cur][f] = m[f] && m[f].v != null ? clamp(MACRO_SCORERS[f](m[f]) ?? NaN, -2, 2) : null;
      if (Number.isNaN(out[cur][f])) out[cur][f] = null;
    });
  });
  // policy rate rank across currencies that have a rate
  const rates = C.CURRENCIES.filter((c) => macroByCur && macroByCur[c] && macroByCur[c].rate && macroByCur[c].rate.v != null);
  const sorted = rates.slice().sort((a, b) => macroByCur[b].rate.v - macroByCur[a].rate.v);
  C.CURRENCIES.forEach((cur) => {
    const i = sorted.indexOf(cur);
    if (i < 0) { out[cur].rate = null; out[cur].exp = null; return; }
    const f = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
    out[cur].rate = f <= 0.15 ? 2 : f <= 0.35 ? 1 : f <= 0.65 ? 0 : f <= 0.85 ? -1 : -2;
    // direction of the most recent decision, only if recent (proxy for expectations)
    const r = macroByCur[cur].rate;
    const age = r.d ? (Date.now() - new Date(r.d).getTime()) / 864e5 : 9999;
    if (r.p == null || age > 200) out[cur].exp = 0;
    else {
      const d = r.v - r.p;
      out[cur].exp = d === 0 ? 0 : Math.abs(d) >= 0.5 ? Math.sign(d) * 2 : Math.sign(d);
    }
  });
  return out;
}

/* ---------- assembly ---------- */
function groupSizes() {
  const n = {}; C.FACTORS.forEach((f) => { n[f.g] = (n[f.g] || 0) + 1; }); return n;
}

function spreadGroup(score, n) {
  const base = Math.trunc(score / n), rem = score - base * n;
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(base + (i < Math.abs(rem) ? Math.sign(rem) : 0));
  return arr;
}

function makeMarket(o, vals) {
  // vals: array aligned with FACTORS, each number|null
  const factors = C.FACTORS.map((f, i) => ({ k: f.k, g: f.g, v: vals[i] == null ? 0 : vals[i], na: vals[i] == null }));
  const gs = {}; C.GROUPS.forEach((g) => { gs[g.k] = 0; });
  factors.forEach((f) => { gs[f.g] += f.v; });
  const score = factors.reduce((a, f) => a + f.v, 0);
  const nz = factors.filter((f) => f.v !== 0);
  const sg = Math.sign(score);
  const agree = sg === 0 ? 0 : nz.filter((f) => Math.sign(f.v) === sg).length;
  let level = 'lo';
  if (sg !== 0 && nz.length) { const r = agree / nz.length; level = r >= 0.75 ? 'hi' : r >= 0.55 ? 'mid' : 'lo'; }
  const naCount = factors.filter((f) => f.na).length;
  return {
    id: o.id, label: o.label, ar: o.ar, cat: o.cat, base: o.base || null, quote: o.quote || null,
    factors, gs, score, bias: biasOf(score), agree, nonzero: nz.length, level,
    coverage: Math.round((1 - naCount / factors.length) * 100),
  };
}

function priceInfo(points) {
  if (!points || points.length < 2) return { price: null, chg: null, series: [] };
  const last = points[points.length - 1][1], prev = points[points.length - 2][1];
  return {
    price: last, chg: (last / prev - 1) * 100,
    series: points.slice(-120).map((p) => [p[0], Number(p[1].toPrecision(7))]),
  };
}

function buildModel({ prices = {}, cot = {}, macro = {} }) {
  const tech = {};
  Object.keys(prices).forEach((id) => { tech[id] = techScores(prices[id]); });
  const ms = scoreMacro(macro);

  const cotCur = {};
  C.CURRENCIES.forEach((c) => { cotCur[c] = cotScore(cot[C.COT_KEY[c]]); });

  // currency factor vectors
  const cur = {};
  C.CURRENCIES.forEach((c) => {
    let tSum = 0, tN = 0, sSum = 0, sN = 0;
    C.FX_PAIRS.forEach((p) => {
      const b = p.slice(0, 3), q = p.slice(3);
      if (b !== c && q !== c) return;
      const sign = b === c ? 1 : -1;
      const t = tech[p];
      if (!t) return;
      if (t.trend != null) { tSum += sign * t.trend; tN++; }
      if (t.seas != null) { sSum += sign * t.seas; sN++; }
    });
    const v = {
      trend: tN ? clamp(Math.round(tSum / tN), -2, 2) : null,
      seas: sN ? clamp(Math.round(sSum / sN), -2, 2) : null,
      cot: cotCur[c], crowd: null,
    };
    cur[c] = C.FACTORS.map((f) => (f.k in v ? v[f.k] : ms[c][f.k]));
  });

  const markets = [];
  const priceOf = (id) => priceInfo(prices[id]);

  C.FX_PAIRS.forEach((p) => {
    const b = p.slice(0, 3), q = p.slice(3);
    const vals = C.FACTORS.map((f, i) => {
      if ((f.k === 'trend' || f.k === 'seas') && tech[p] && tech[p][f.k] != null) return tech[p][f.k];
      const a = cur[b][i], z = cur[q][i];
      if (a == null && z == null) return null;
      return clamp((a || 0) - (z || 0), -2, 2);
    });
    const m = makeMarket({ id: p, label: b + '/' + q, ar: C.AR_CUR[b] + ' / ' + C.AR_CUR[q], cat: 'fx', base: b, quote: q }, vals);
    markets.push(Object.assign(m, priceOf(p)));
  });

  C.CURRENCIES.forEach((c) => {
    markets.push(makeMarket({ id: c, label: c, ar: C.AR_CUR[c], cat: 'cur', base: c }, cur[c]));
  });

  const n = groupSizes();
  C.OTHERS.forEach((o) => {
    const t = tech[o.id] || { trend: null, seas: null };
    const regionVals = o.region ? cur[o.region] : null;
    const regionGroup = {};
    C.GROUPS.forEach((g) => { regionGroup[g.k] = null; });
    if (regionVals) {
      C.GROUPS.forEach((g) => {
        const idx = C.FACTORS.map((f, i) => (f.g === g.k ? i : -1)).filter((i) => i >= 0);
        const have = idx.filter((i) => regionVals[i] != null);
        regionGroup[g.k] = have.length ? have.reduce((a, i) => a + regionVals[i], 0) : null;
      });
    }
    const cotV = o.cot ? cotScore(cot[o.cot]) : null;
    const groupScore = {};
    ['growth', 'infl', 'jobs', 'mon'].forEach((g) => {
      const mult = (o.mult || {})[g];
      groupScore[g] = regionGroup[g] == null || mult == null ? null : clamp(Math.round(regionGroup[g] * mult), -2 * n[g], 2 * n[g]);
    });
    const spreadVals = {};
    ['growth', 'infl', 'jobs', 'mon'].forEach((g) => { spreadVals[g] = groupScore[g] == null ? null : spreadGroup(groupScore[g], n[g]); });
    const counter = {};
    const vals = C.FACTORS.map((f) => {
      if (f.k === 'trend') return t.trend;
      if (f.k === 'seas') return t.seas;
      if (f.k === 'cot') return cotV;
      if (f.k === 'crowd') return null;
      const arr = spreadVals[f.g];
      counter[f.g] = (counter[f.g] === undefined ? -1 : counter[f.g]) + 1;
      return arr ? arr[counter[f.g]] : null;
    });
    const m = makeMarket(o, vals);
    markets.push(Object.assign(m, priceOf(o.id)));
  });

  return markets;
}

module.exports = { techScores, cotScore, scoreMacro, buildModel, biasOf, clamp };
