(function () {
  'use strict';
  var MINUS = '−';
  var fmt = function (n) { return n > 0 ? '+' + n : n < 0 ? MINUS + Math.abs(n) : '0'; };
  var sn = function (n) { return '<bdi class="ltr">' + fmt(n) + '</bdi>'; };
  var num = function (n) { return '<span class="num" dir="ltr">' + fmt(n) + '</span>'; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var FACTOR_AR = {
    trend: 'الاتجاه', seas: 'الموسمية', cot: 'مراكز COT', crowd: 'معنويات المتداولين',
    gdp: 'الناتج المحلي', mfg: 'PMI التصنيع', svc: 'PMI الخدمات', retail: 'مبيعات التجزئة', conf: 'ثقة المستهلك',
    cpi: 'التضخم CPI', core: 'التضخم الأساسي', ppi: 'أسعار المنتجين',
    nfp: 'نمو الوظائف', unemp: 'معدل البطالة', claims: 'طلبات إعانة البطالة',
    rate: 'سعر الفائدة', exp: 'اتجاه الفائدة'
  };
  var GROUPS = [
    { k: 'tech', ar: 'الاتجاه الفني', short: 'الفني' },
    { k: 'sent', ar: 'المراكز والمعنويات', short: 'المعنويات' },
    { k: 'growth', ar: 'النمو الاقتصادي', short: 'النمو' },
    { k: 'infl', ar: 'التضخم', short: 'التضخم' },
    { k: 'jobs', ar: 'سوق العمل', short: 'الوظائف' },
    { k: 'mon', ar: 'السياسة النقدية', short: 'النقدية' }
  ];
  var CATS = [
    { k: 'fx', ar: 'أزواج العملات' }, { k: 'cur', ar: 'العملات' }, { k: 'idx', ar: 'المؤشرات' },
    { k: 'com', ar: 'السلع' }, { k: 'cry', ar: 'العملات الرقمية' }, { k: 'bnd', ar: 'السندات' }
  ];
  var CUR_ORDER = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
  var BIAS_AR = { vb: 'صعودي قوي', b: 'صعودي', n: 'محايد', br: 'هبوطي', vbr: 'هبوطي قوي' };
  var toneOf = function (s) { return s > 0 ? 'tone-pos' : s < 0 ? 'tone-neg' : 'tone-zero'; };
  var isBull = function (m) { return m.bias === 'vb' || m.bias === 'b'; };
  var isBear = function (m) { return m.bias === 'vbr' || m.bias === 'br'; };

  var CHEV = {
    vb: 'M2.5 6.5L6 3l3.5 3.5M2.5 10L6 6.5 9.5 10',
    b: 'M2.5 8L6 4.5 9.5 8',
    n: 'M3 6h6',
    br: 'M2.5 4L6 7.5 9.5 4',
    vbr: 'M2.5 2L6 5.5 9.5 2M2.5 5.5L6 9l3.5-3.5'
  };
  function chev(b) {
    return '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + CHEV[b] + '"/></svg>';
  }


  /* ---------- flags (simple drawings) and group icons ---------- */
  var FLAG_BODY = {
    USD: function () {
      var o = '<rect width="30" height="30" fill="#B22234"/>';
      for (var i = 0; i < 6; i++) o += '<rect y="' + (2.3 + i * 4.6).toFixed(1) + '" width="30" height="2.3" fill="#fff"/>';
      o += '<rect width="16" height="16" fill="#3C3B6E"/>';
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) o += '<circle cx="' + (3 + a * 5) + '" cy="' + (3 + b * 5) + '" r="1" fill="#fff"/>';
      return o;
    },
    EUR: function () {
      var o = '<rect width="30" height="30" fill="#003399"/>';
      for (var i = 0; i < 12; i++) { var t = i / 12 * Math.PI * 2; o += '<circle cx="' + (15 + 8 * Math.sin(t)).toFixed(1) + '" cy="' + (15 - 8 * Math.cos(t)).toFixed(1) + '" r="1.3" fill="#FFCC00"/>'; }
      return o;
    },
    GBP: function () {
      return '<rect width="30" height="30" fill="#012169"/><path d="M0 0L30 30M30 0L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0L30 30M30 0L0 30" stroke="#C8102E" stroke-width="2.4"/>' +
        '<rect x="12" width="6" height="30" fill="#fff"/><rect y="12" width="30" height="6" fill="#fff"/><rect x="13.3" width="3.4" height="30" fill="#C8102E"/><rect y="13.3" width="30" height="3.4" fill="#C8102E"/>';
    },
    JPY: function () { return '<rect width="30" height="30" fill="#fff"/><circle cx="15" cy="15" r="8.5" fill="#BC002D"/>'; },
    CHF: function () { return '<rect width="30" height="30" fill="#D52B1E"/><rect x="13" y="6" width="4" height="18" fill="#fff"/><rect x="6" y="13" width="18" height="4" fill="#fff"/>'; },
    CAD: function () { return '<rect width="30" height="30" fill="#fff"/><rect width="8" height="30" fill="#D80621"/><rect x="22" width="8" height="30" fill="#D80621"/><circle cx="15" cy="15" r="4.2" fill="#D80621"/>'; },
    AUD: function () {
      return '<rect width="30" height="30" fill="#00247D"/><rect width="15" height="15" fill="#012169"/><path d="M0 0L15 15M15 0L0 15" stroke="#fff" stroke-width="2.6"/><rect x="6.2" width="2.6" height="15" fill="#fff"/><rect y="6.2" width="15" height="2.6" fill="#fff"/><rect x="6.9" width="1.2" height="15" fill="#C8102E"/><rect y="6.9" width="15" height="1.2" fill="#C8102E"/>' +
        '<circle cx="22" cy="23" r="2.2" fill="#fff"/><circle cx="22" cy="9" r="1.3" fill="#fff"/><circle cx="27" cy="14" r="1.3" fill="#fff"/><circle cx="17" cy="19" r="1.3" fill="#fff"/>';
    },
    NZD: function () {
      return '<rect width="30" height="30" fill="#00247D"/><rect width="15" height="15" fill="#012169"/><path d="M0 0L15 15M15 0L0 15" stroke="#fff" stroke-width="2.6"/><rect x="6.2" width="2.6" height="15" fill="#fff"/><rect y="6.2" width="15" height="2.6" fill="#fff"/><rect x="6.9" width="1.2" height="15" fill="#C8102E"/><rect y="6.9" width="15" height="1.2" fill="#C8102E"/>' +
        '<circle cx="23" cy="9" r="1.8" fill="#CC142B" stroke="#fff" stroke-width=".6"/><circle cx="27" cy="16" r="1.8" fill="#CC142B" stroke="#fff" stroke-width=".6"/><circle cx="19" cy="17" r="1.8" fill="#CC142B" stroke="#fff" stroke-width=".6"/><circle cx="23" cy="24" r="1.8" fill="#CC142B" stroke="#fff" stroke-width=".6"/>';
    },
    ZAR: function () {
      return '<rect width="30" height="15" fill="#E03C31"/><rect y="15" width="30" height="15" fill="#001489"/><path d="M0 0L13 15 0 30" fill="#007749" stroke="#fff" stroke-width="2.4"/><path d="M0 0L13 15 0 30" fill="#007749"/><path d="M11 15H30" stroke="#fff" stroke-width="7"/><path d="M11 15H30" stroke="#007749" stroke-width="3.6"/>';
    }
  };
  function flag(code) {
    var f = FLAG_BODY[code];
    if (!f) return '<span class="cc">' + esc(code) + '</span>';
    return '<svg class="fl" width="26" height="26" viewBox="0 0 30 30" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' + code + '">' + f() + '</svg>';
  }
  var ICONS = {
    tech: 'M3 13l4-4 3 3 5-6',
    sent: 'M3 14c0-3 2-4.5 4-4.5s4 1.5 4 4.5M7 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM12 9.5c1.6 0 3 1.1 3 3.5',
    growth: 'M4 15V9M9 15V4M14 15V8',
    infl: 'M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM9 6.5v5M7.2 8.2h3a1 1 0 0 1 0 2H7.8',
    jobs: 'M3 7h12v7H3zM6.5 7V5h5v2',
    mon: 'M4 14L14 4M5.8 4.5a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM12.2 11a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z'
  };
  function icon(k) {
    return '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICONS[k] + '"/></svg>';
  }

  var state = { cat: 'all', bias: 'all', q: '', fg: 'all', calImp: 2, calCur: 'all', auto: true };
  try { if (localStorage.getItem('mc-auto') === '0') state.auto = false; } catch (e) { /* storage unavailable */ }
  var DATA = null, MAP = {}, currentId = null, CAL = null, NEWS = null, quoteTimer = null;

  /* ---------- formatting ---------- */
  function dateAr(d) {
    try { return new Intl.DateTimeFormat('ar-u-nu-latn', { day: 'numeric', month: 'long' }).format(new Date(d)); }
    catch (e) { return String(d).slice(0, 10); }
  }
  function timeAr(d) {
    try { return new Intl.DateTimeFormat('ar-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)); }
    catch (e) { return ''; }
  }
  function dayAr(d) {
    try { return new Intl.DateTimeFormat('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d)); }
    catch (e) { return String(d).slice(0, 10); }
  }
  function dayKey(d) { var x = new Date(d); return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); }
  function daysTo(d) { return Math.ceil((new Date(d) - Date.now()) / 864e5); }
  function fmtPrice(p) {
    if (p == null) return '—';
    var d = p >= 1000 ? 2 : p >= 100 ? 3 : p >= 10 ? 4 : 5;
    return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtPct(c) { return c == null ? '' : (c > 0 ? '+' : c < 0 ? MINUS : '') + Math.abs(c).toFixed(2) + '%'; }

  /* ---------- shared pieces ---------- */
  function badges(m) {
    if (m.cat === 'fx') return '<span class="pair-b">' + flag(m.base) + flag(m.quote) + '</span>';
    if (m.cat === 'cur') return '<span class="pair-b">' + flag(m.base) + '</span>';
    return '';
  }
  function tile(m) {
    var name = (m.cat === 'fx' || m.cat === 'cur') ? '<bdi class="ltr">' + esc(m.label) + '</bdi>' : '<span class="nm">' + esc(m.label) + '</span>';
    return '<a class="tile b-' + m.bias + '" href="#m-' + m.id + '"><span class="t1">' + badges(m) + name + '</span>' +
      '<span class="t2"><span class="bl">' + chev(m.bias) + BIAS_AR[m.bias] + '</span>' + num(m.score) + '</span></a>';
  }
  function dbar(v, max) {
    var w = Math.min(Math.abs(v) / max * 50, 50);
    if (v === 0) return '<div class="dbar"></div>';
    return '<div class="dbar"><i class="' + (v > 0 ? 'p' : 'n') + '" style="width:' + w + '%"></i></div>';
  }
  function factorRow(f) {
    if (f.na) return '<div class="rw na"><div class="l"><span>' + FACTOR_AR[f.k] + '</span><b>—</b></div><div class="dbar"></div></div>';
    return '<div class="rw"><div class="l"><span>' + FACTOR_AR[f.k] + '</span><b class="' + toneOf(f.v) + '" dir="ltr">' + fmt(f.v) + '</b></div>' + dbar(f.v, 2) + '</div>';
  }
  function groupAvail(m, g) { return m.factors.filter(function (f) { return f.g === g && !f.na; }).length; }

  function metaBar() {
    var s = DATA.sources || {};
    var names = { prices: 'الأسعار', cot: 'مراكز COT', macro: 'الاقتصاد الكلي', calendar: 'التقويم', news: 'الأخبار' };
    var pills = Object.keys(names).map(function (k) {
      var x = s[k] || {};
      var tip = (x.ok ? 'يعمل' : 'لا توجد بيانات') + (x.note ? ' · ' + x.note : '') + (x.error ? ' · ' + x.error : '') + (x.at ? ' · آخر جلب ' + timeAr(x.at) : '');
      return '<span class="src ' + (x.ok ? 'ok' : 'bad') + '" title="' + esc(tip) + '">' + names[k] + '</span>';
    }).join('');
    var upd = DATA.updatedAt ? 'آخر تحديث ' + timeAr(DATA.updatedAt) : '';
    var notices = '';
    if (s.macro && !s.macro.ok) {
      notices += '<div class="notice">بيانات الاقتصاد الكلي غير متوفرة. ' + esc(s.macro.error || s.macro.note || '') + ' الدرجات الحالية تعتمد على الأسعار ومراكز COT فقط.</div>';
    }
    if (s.prices && !s.prices.ok) {
      notices += '<div class="notice">تعذّر جلب الأسعار. ' + esc(s.prices.error || '') + '</div>';
    }
    return '<div class="meta"><span>' + upd + '</span>' + pills + '</div>' + notices;
  }
  function updateLive() {
    var el = document.getElementById('live'); if (!el) return;
    var ok = DATA && DATA.sources && DATA.sources.prices && DATA.sources.prices.ok;
    el.className = 'livepill ' + (ok ? 'ok' : 'bad');
    el.title = DATA && DATA.updatedAt ? 'آخر تحديث للبيانات ' + timeAr(DATA.updatedAt) : '';
    el.lastChild.nodeValue = ok ? 'مباشر' : 'متوقف';
  }

  /* ---------- home ---------- */
  function viewHome() {
    var ratios = CUR_ORDER.map(function (c) { var m = MAP[c]; return m && m.max ? m.score / m.max : 0; });
    var top = Math.max(0.1, Math.max.apply(null, ratios.map(Math.abs)));
    var bars = CUR_ORDER.map(function (c, i) {
      var m = MAP[c]; if (!m) return '';
      var h = Math.min(Math.abs(ratios[i]) / top * 48, 48);
      var cls = ratios[i] > 0 ? 'up' : ratios[i] < 0 ? 'dn' : 'zero';
      var st = ratios[i] === 0 ? '' : ' style="height:' + h + '%"';
      return '<a class="col" href="#m-' + c + '" title="' + c + '"><div class="plot"><span class="bar-v ' + cls + '"' + st + '></span></div><span class="code">' + c + '</span><span class="lab">' + BIAS_AR[m.bias] + '</span></a>';
    }).join('');
    return '<section class="split"><div><div class="kicker">الانحياز الكلي</div><h1>خريطة الماكرو</h1>' +
      '<p>انحياز كل سوق من هبوطي قوي إلى صعودي قوي. افتح أي سوق لترى درجاته وما يحركه.</p>' +
      '<p><span class="num">' + DATA.markets.length + '</span> سوقاً</p>' +
      '<div class="actions"><button class="btn" id="auto" type="button" aria-pressed="' + state.auto + '"><i class="blink"></i>تحديث تلقائي</button><button class="btn" id="refresh" type="button">تحديث</button></div>' +
      metaBar() + '</div>' +
      '<div class="strength" role="group" aria-label="قوة العملات">' + bars + '</div></section>' +
      '<section aria-label="كل الأسواق"><h2 class="sect-title" style="margin-top:8px">كل الأسواق</h2><p class="sect-sub">الأخضر صعودي والأحمر هبوطي، وكلما اشتد اللون قوي الانحياز.</p><div class="tools" style="margin-top:12px"><input id="q" class="search" type="search" placeholder="ابحث: EUR، ذهب، S&amp;P…" value="' + esc(state.q) + '" aria-label="بحث في الأسواق"><div id="chips" style="display:contents"></div></div><div id="results"></div></section>';
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.markets.filter(function (m) { return !q || (m.id + ' ' + m.label + ' ' + m.ar).toLowerCase().indexOf(q) > -1; });
  }
  function renderResults() {
    var base = filtered();
    var catList = base.filter(function (m) { return state.cat === 'all' || m.cat === state.cat; });
    var cnt = function (f) { return catList.filter(f).length; };
    var catChips = '<div class="chips" role="group" aria-label="الفئة"><button class="chip" type="button" data-cat="all" aria-pressed="' + (state.cat === 'all') + '">الكل<small>' + base.length + '</small></button>' +
      CATS.map(function (c) { var n = base.filter(function (m) { return m.cat === c.k; }).length; return '<button class="chip" type="button" data-cat="' + c.k + '" aria-pressed="' + (state.cat === c.k) + '">' + c.ar + '<small>' + n + '</small></button>'; }).join('') + '</div>';
    var bl = [['all', 'أي انحياز', catList.length], ['bull', 'صعودي', cnt(isBull)], ['neu', 'محايد', cnt(function (m) { return m.bias === 'n'; })], ['bear', 'هبوطي', cnt(isBear)]];
    var biasChips = '<div class="chips" role="group" aria-label="الانحياز">' + bl.map(function (b) { return '<button class="chip" type="button" data-bias="' + b[0] + '" aria-pressed="' + (state.bias === b[0]) + '">' + b[1] + '<small>' + b[2] + '</small></button>'; }).join('') + '</div>';
    var chipsEl = document.getElementById('chips');
    if (chipsEl) chipsEl.innerHTML = catChips + biasChips;
    var list = catList.filter(function (m) {
      if (state.bias === 'bull') return isBull(m);
      if (state.bias === 'neu') return m.bias === 'n';
      if (state.bias === 'bear') return isBear(m);
      return true;
    });
    var out = '';
    CATS.forEach(function (c) {
      var items = list.filter(function (m) { return m.cat === c.k; }).sort(function (a, b) { return (b.max ? b.score / b.max : 0) - (a.max ? a.score / a.max : 0); });
      if (!items.length) return;
      out += '<div class="row-cat"><h2>' + c.ar + '</h2><div class="tiles">' + items.map(tile).join('') + '</div></div>';
    });
    if (!out) out = '<div class="empty">لا توجد أسواق مطابقة. جرّب كلمة بحث أخرى أو غيّر الفلتر.</div>';
    var r = document.getElementById('results');
    if (r) r.innerHTML = out;
  }

  /* ---------- market page ---------- */
  var strength = function (m) { return m.max ? Math.abs(m.score) / m.max : 0; };
  function related(m) {
    var list;
    if (m.cat === 'fx') list = DATA.markets.filter(function (x) { return x.cat === 'fx' && x.id !== m.id && (x.base === m.base || x.base === m.quote || x.quote === m.base || x.quote === m.quote); });
    else list = DATA.markets.filter(function (x) { return x.cat === m.cat && x.id !== m.id; });
    return list.sort(function (a, b) { return strength(b) - strength(a); }).slice(0, 8);
  }
  function opportunities() {
    return DATA.markets.filter(function (x) { return x.cat === 'fx'; }).sort(function (a, b) { return strength(b) - strength(a); }).slice(0, 8);
  }
  function drivers(m) {
    return GROUPS.map(function (g) {
      var s = m.gs[g.k];
      var fs = m.factors.filter(function (f) { return f.g === g.k; });
      var nz = fs.filter(function (f) { return f.v !== 0; });
      var allNa = fs.every(function (f) { return f.na; });
      var sub = nz.length ? nz.map(function (f) { return FACTOR_AR[f.k] + ' ' + sn(f.v); }).join('، ') : (allNa ? 'لا توجد بيانات' : 'كل العوامل محايدة');
      var lab = allNa ? '—' : s > 0 ? chev('b') + 'صعودي' : s < 0 ? chev('br') + 'هبوطي' : chev('n') + 'محايد';
      return '<li><span class="gi">' + icon(g.k) + '</span><div class="gt"><div class="t">' + g.ar + '</div><div class="s">' + sub + '</div></div><div class="v ' + (allNa ? 'tone-zero' : toneOf(s)) + '">' + lab + '</div></li>';
    }).join('');
  }
  function priceChart(m) {
    if (!m.series || m.series.length < 2) return '<div class="empty">لا توجد بيانات سعرية.</div>';
    var pts = m.series, W = 1000, H = 240, P = 10;
    var vals = pts.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rg = (mx - mn) || 1;
    var x = function (i) { return P + (W - 2 * P) * i / (pts.length - 1); };
    var y = function (v) { return H - P - (H - 2 * P) * (v - mn) / rg; };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
    var area = line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + (H - P) + ' L' + x(0).toFixed(1) + ' ' + (H - P) + ' Z';
    var last = pts[pts.length - 1];
    return '<svg class="pchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="رسم سعري">' +
      '<line class="gr" x1="' + P + '" x2="' + (W - P) + '" y1="' + y(mx).toFixed(1) + '" y2="' + y(mx).toFixed(1) + '"/>' +
      '<line class="gr" x1="' + P + '" x2="' + (W - P) + '" y1="' + y(mn).toFixed(1) + '" y2="' + y(mn).toFixed(1) + '"/>' +
      '<path class="ar" d="' + area + '"/><path class="ln" d="' + line + '"/>' +
      '<circle class="dt" cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(last[1]).toFixed(1) + '" r="4"/>' +
      '<text x="' + (P + 2) + '" y="' + (y(mx) + 15).toFixed(1) + '">' + fmtPrice(mx) + '</text>' +
      '<text x="' + (P + 2) + '" y="' + (y(mn) - 6).toFixed(1) + '">' + fmtPrice(mn) + '</text></svg>';
  }
  function priceCard(m) {
    if (!m.series) return '';
    return '<article class="card" id="sec-details" style="margin-top:16px"><header><h2>السعر</h2><p>' + esc(m.label) + '</p></header><div class="body">' +
      '<div class="px"><span class="p" id="px-p">' + fmtPrice(m.price) + '</span><span class="c ' + toneOf(m.chg) + '" id="px-c">' + fmtPct(m.chg) + '</span><span class="livechip" id="px-live">آخر إغلاق</span></div>' +
      priceChart(m) + '<p class="muted note">الرسم: إغلاق يومي لآخر 120 يوم تداول. الرقم أعلاه يتحدث كل 15 ثانية عندما يكون السوق مفتوحاً.</p></div></article>';
  }
  function bankCard(cur) {
    var b = (DATA.banks || {})[cur]; if (!b) return '';
    var rateTxt = b.rate != null ? b.rate.toFixed(2) + '%' : '—';
    var last = 'غير متاح';
    if (b.rate != null && b.prev != null) {
      if (b.rate !== b.prev) { var d = Math.round((b.rate - b.prev) * 100); last = (d > 0 ? '+' : MINUS) + Math.abs(d) + ' نقطة أساس' + (b.lastDate ? ' · ' + dateAr(b.lastDate) : ''); }
      else last = 'بدون تغيير' + (b.lastDate ? ' منذ ' + dateAr(b.lastDate) : '');
    }
    var next = b.next ? dateAr(b.next) + ' · بعد ' + Math.max(daysTo(b.next), 0) + ' يوماً' : '—';
    return '<article class="cb"><h3><bdi class="ltr">' + b.short + '</bdi><span>' + b.name + '</span></h3><dl class="kv">' +
      '<div><dt>السعر الحالي</dt><dd class="big num" dir="ltr">' + rateTxt + '</dd></div>' +
      '<div><dt>الاجتماع القادم</dt><dd>' + next + '</dd></div>' +
      '<div><dt>آخر تغيير</dt><dd>' + last + '</dd></div></dl></article>';
  }
  function factorSection(m) {
    var chips = '<div class="chips" role="group" aria-label="تصفية العوامل"><button class="chip" type="button" data-fg="all" aria-pressed="' + (state.fg === 'all') + '">الكل</button>' +
      GROUPS.map(function (g) { return '<button class="chip" type="button" data-fg="' + g.k + '" aria-pressed="' + (state.fg === g.k) + '">' + g.short + '</button>'; }).join('') + '</div>';
    var cards = GROUPS.filter(function (g) { return state.fg === 'all' || state.fg === g.k; }).map(function (g) {
      var fs = m.factors.filter(function (f) { return f.g === g.k; });
      var have = fs.filter(function (f) { return !f.na; }).length;
      return '<article class="card"><header style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><div><h3>' + g.ar + '</h3><p>' + have + ' من ' + fs.length + ' عوامل مقيَّمة</p></div><b class="num ' + toneOf(m.gs[g.k]) + '" dir="ltr" style="font-size:var(--fs-lg)">' + fmt(m.gs[g.k]) + '</b></header><div class="body rows">' + fs.map(factorRow).join('') + '</div></article>';
    }).join('');
    return '<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:end"><div><h2 class="sect-title" style="margin-top:0">تفصيل العوامل</h2><p class="sect-sub">كل عامل يُقيَّم من −2 (هبوطي قوي) إلى +2 (صعودي قوي). الشرطة تعني أن البيانات غير متوفرة ولا تدخل في الدرجة.</p></div>' + chips + '</div><div class="grid3" id="factor-cards">' + cards + '</div>';
  }
  function calCurrencies(m) {
    if (m.cat === 'fx') return [m.base, m.quote];
    if (m.cat === 'cur') return [m.base];
    return m.region ? [m.region] : [];
  }
  function calNewsSection(m) {
    var cs = calCurrencies(m);
    return '<section id="sec-cal"><div class="duo"><div><h2 class="sect-title">التقويم الاقتصادي</h2><p class="sect-sub">أهم الإصدارات القادمة' + (cs.length ? ': <bdi class="ltr">' + cs.join(' · ') + '</bdi>' : '') + '</p><div id="mcal" class="card tw" style="margin-top:12px"><div class="empty">جاري تحميل التقويم…</div></div></div>' +
      '<div><h2 class="sect-title">آخر الأخبار</h2><p class="sect-sub">عناوين البنوك المركزية والأسواق.</p><div id="mnews" class="card" style="margin-top:12px"><div class="empty">جاري تحميل الأخبار…</div></div></div></div></section>';
  }
  function newsList(items) {
    return '<ul class="news">' + items.map(function (n) {
      var safe = /^https?:\/\//.test(n.link) ? n.link : '#';
      return '<li><a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer"><span class="nt">' + esc(n.title) + '</span><span class="nm2">' + esc(n.src) + ' · ' + dateAr(n.t) + ' ' + timeAr(n.t) + '</span></a></li>';
    }).join('') + '</ul>';
  }
  function renderMarketNews(m) {
    var el = document.getElementById('mnews'); if (!el || !NEWS) return;
    var cs = calCurrencies(m);
    var all = NEWS.items || [];
    var rel = all.filter(function (n) { return !n.cur || cs.indexOf(n.cur) > -1; });
    var list = (rel.length ? rel : all).slice(0, 6);
    el.innerHTML = list.length ? newsList(list) : '<div class="empty">لا توجد أخبار حالياً' + (NEWS.source && !NEWS.source.ok ? '. ' + esc(NEWS.source.error || '') : '.') + '</div>';
  }
  function driveBanner(m) {
    if (m.score === 0) return '';
    var best = null;
    GROUPS.forEach(function (g) {
      if (groupAvail(m, g.k) === 0) return;
      var s = m.gs[g.k];
      if (!best || Math.abs(s) > Math.abs(best.s)) best = { g: g, s: s };
    });
    if (!best || best.s === 0) return '';
    var dir = m.score > 0 ? 'الصعودي' : 'الهبوطي';
    var txt = Math.sign(best.s) === Math.sign(m.score)
      ? 'أكبر مساهم في الانحياز ' + dir + ' هو «' + best.g.ar + '» بدرجة ' + sn(best.s) + '.'
      : 'أقوى مجموعة هي «' + best.g.ar + '» (' + sn(best.s) + ') لكنها عكس الانحياز العام.';
    return '<aside class="drive"><div><strong>ما الذي يقود الانحياز؟</strong><p>' + txt + '</p></div><button class="btn" type="button" data-tab="factors">' + best.g.ar + '</button></aside>';
  }
  function renderMarketCal(m) {
    var el = document.getElementById('mcal'); if (!el || !CAL) return;
    var cs = calCurrencies(m), from = Date.now() - 3600e3;
    var list = (CAL.events || []).filter(function (e) { return cs.indexOf(e.cur) > -1 && e.imp >= 2 && new Date(e.t).getTime() >= from; }).slice(0, 10);
    if (!list.length) { el.innerHTML = '<div class="empty">لا توجد إصدارات مهمة قادمة' + (CAL.source && !CAL.source.ok ? '. تعذّر جلب التقويم: ' + esc(CAL.source.error || '') : '.') + '</div>'; return; }
    el.innerHTML = '<table class="compact"><thead><tr><th>اليوم</th><th>الوقت</th><th>العملة</th><th>الأهمية</th><th>الحدث</th><th>المتوقع</th><th>السابق</th></tr></thead><tbody>' + list.map(function (e) {
      return '<tr><td>' + dayAr(e.t) + '</td><td class="num">' + timeAr(e.t) + '</td><td><bdi class="ltr">' + e.cur + '</bdi></td><td><span class="imp' + (e.imp === 3 ? ' h' : '') + '">' + [1, 2, 3].map(function (n) { return '<i class="' + (n <= e.imp ? 'on' : '') + '"></i>'; }).join('') + '</span></td><td style="white-space:normal;min-width:200px">' + esc(e.event) + '</td><td class="num" dir="ltr">' + esc(e.forecast || '—') + '</td><td class="num" dir="ltr">' + esc(e.previous || '—') + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function tabsBar(m, hasBanks, hasCal, hasRel) {
    var tabs = [['overview', 'نظرة عامة']];
    if (m.series) tabs.push(['details', 'التفاصيل']);
    tabs.push(['factors', 'تفصيل العوامل']);
    if (hasBanks) tabs.push(['rates', 'أسعار الفائدة']);
    if (hasCal) tabs.push(['cal', 'التقويم']);
    if (hasRel) tabs.push(['related', 'أسواق مرتبطة']);
    return '<nav class="mtabs" id="mtabs" aria-label="أقسام الصفحة">' + tabs.map(function (t, i) {
      return '<button type="button" data-tab="' + t[0] + '" aria-pressed="' + (i === 0) + '">' + t[1] + '</button>';
    }).join('') + '</nav>';
  }
  function pairCards(m) {
    if (m.cat !== 'fx') return '';
    var banks = DATA.banks || {}, b = banks[m.base], q = banks[m.quote], diff;
    if (b && q && b.rate != null && q.rate != null) {
      var today = Math.round((b.rate - q.rate) * 100);
      var before = Math.round(((b.prev != null ? b.prev : b.rate) - (q.prev != null ? q.prev : q.rate)) * 100);
      var bps = function (v) { return '<span class="num" dir="ltr">' + (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v) + ' bps</span>'; };
      diff = '<dl class="kv3"><div><dt>اليوم</dt><dd>' + bps(today) + '</dd></div><div><dt>قبل آخر قرار</dt><dd>' + bps(before) + '</dd></div><div><dt>التغير</dt><dd>' + bps(today - before) + '</dd></div></dl><p class="muted note">الفرق = فائدة <bdi class="ltr">' + m.base + '</bdi> − فائدة <bdi class="ltr">' + m.quote + '</bdi>.</p>';
    } else {
      diff = '<div class="empty">يلزم سعر الفائدة للعملتين. أضف مفتاح Trading Economics ليظهر فرق الفائدة.</div>';
    }
    var rows = [m.base, m.quote].map(function (c) {
      var x = MAP[c]; if (!x) return '';
      return '<div class="strrow"><div class="sh"><span class="sl">' + flag(c) + '<bdi class="ltr">' + c + '</bdi><small>' + esc(x.ar) + '</small></span><span class="pill ' + toneOf(x.score) + '">' + BIAS_AR[x.bias] + '</span><b>' + num(x.score) + '</b></div>' + dbar(x.score, x.max || 34) + '</div>';
    }).join('');
    return '<section id="sec-diff" style="margin-top:28px"><div class="duo"><article class="card"><header><h2>فرق الفائدة</h2><p>الفرق بين فائدة العملتين بنقاط الأساس.</p></header><div class="body">' + diff + '</div></article>' +
      '<article class="card"><header><h2>قوة العملة</h2><p>درجة كل عملة من عواملها.</p></header><div class="body rows">' + rows + '</div></article></div></section>';
  }
  function viewMarket(m) {
    currentId = m.id;
    var total = m.factors.length, mx = m.max || 34;
    var pct = (clamp(m.score / mx * 1.5, -1, 1) / 2 + 0.5) * 100;
    var sg = Math.sign(m.score);
    var agreeTxt = sg === 0 ? 'لا يوجد اتجاه سائد' : m.agree + ' من ' + m.nonzero + ' عاملاً متفقة';
    var lvl = sg === 0 ? '—' : m.level === 'hi' ? 'مرتفع' : m.level === 'mid' ? 'متوسط' : 'منخفض';
    var dotCls = m.level === 'hi' ? 'hi' : m.level === 'lo' ? 'lo' : '';
    var big = (m.cat === 'fx' || m.cat === 'cur') ? '<bdi class="ltr">' + esc(m.label) + '</bdi>' : '<span>' + esc(m.label) + '</span>';
    var opps = opportunities().map(function (x) {
      return '<li><a href="#m-' + x.id + '"><span class="ot">' + badges(x) + '<bdi class="ltr">' + x.label + '</bdi></span><span class="ov"><span class="pill ' + toneOf(x.score) + '">' + BIAS_AR[x.bias] + '</span>' + num(x.score) + '</span></a></li>';
    }).join('');
    var banks = '';
    if (m.cat === 'fx') banks = bankCard(m.base) + bankCard(m.quote);
    else if (m.cat === 'cur') banks = bankCard(m.base);
    else if (m.region) banks = bankCard(m.region);
    var bankSec = banks ? '<section id="sec-rates"><h2 class="sect-title">البنوك المركزية</h2><p class="sect-sub">سعر الفائدة الحالي وموعد الاجتماع القادم.</p><div class="cbs" style="margin-top:12px">' + banks + '</div></section>' : '';
    var rel = related(m);
    var relSec = rel.length ? '<section id="sec-related"><h2 class="sect-title">أسواق مرتبطة</h2><div class="tiles" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">' + rel.map(tile).join('') + '</div></section>' : '';
    var cal = calNewsSection(m);
    return '<a class="back" href="#">→ كل الأسواق</a>' +
      '<section class="head"><div><h1>' + badges(m) + big + '</h1><div class="nm">' + esc(m.ar) + '</div></div>' +
      '<div class="stats">' +
      '<div class="stat"><span class="k">الانحياز العام</span><strong class="big ' + toneOf(m.score) + '">' + BIAS_AR[m.bias] + '</strong><span class="sub">عبر ' + total + ' عاملاً · تغطية ' + m.coverage + '%</span></div>' +
      '<div class="stat"><span class="k">الدرجة</span><strong class="big num ' + toneOf(m.score) + '" dir="ltr">' + fmt(m.score) + '</strong><span class="sub">من ±' + mx + '</span></div>' +
      '<div class="stat"><span class="k">اتفاق العوامل</span><strong class="big" style="font-size:var(--fs-lg)"><i class="dot ' + dotCls + '"></i>' + lvl + '</strong><span class="sub">' + agreeTxt + '</span></div>' +
      '</div></section>' + tabsBar(m, !!banks, !!cal, rel.length > 0) + metaBar() +
      '<div class="grid3" id="sec-overview">' +
      '<article class="card"><header><h2>نظرة على الانحياز الكلي</h2></header><div class="body"><div class="gauge"><div class="ends"><span class="tone-neg">هبوطي</span><span class="tone-pos">صعودي</span></div><div class="track"><span class="mark" style="left:' + pct + '%"></span></div></div><h3 style="margin:22px 0 0;font-size:var(--fs-base)">المحركات الرئيسية</h3><ul class="drivers" style="margin-top:6px">' + drivers(m) + '</ul></div></article>' +
      '<article class="card"><header><h2>مساهمة المجموعات</h2><p>مجموع درجات كل مجموعة.</p></header><div class="body rows">' +
      GROUPS.map(function (g) { var n = groupAvail(m, g.k) || m.factors.filter(function (f) { return f.g === g.k; }).length; return '<div class="rw"><div class="l"><span>' + g.ar + '</span><b class="' + toneOf(m.gs[g.k]) + '" dir="ltr">' + fmt(m.gs[g.k]) + '</b></div>' + dbar(m.gs[g.k], n * 2) + '</div>'; }).join('') +
      '</div></article>' +
      '<article class="card"><header style="display:flex;justify-content:space-between;align-items:baseline"><div><h2>أقوى فرص العملات</h2><p>الأعلى في القوة النسبية.</p></div><a href="#" style="color:var(--accent);font-size:var(--fs-sm)">عرض الكل</a></header><div class="body"><ul class="opps">' + opps + '</ul></div></article>' +
      '</div>' + priceCard(m) + bankSec + '<section id="sec-factors">' + factorSection(m) + '</section>' + driveBanner(m) + pairCards(m) + cal + relSec;
  }

  /* ---------- live quote ---------- */
  function stopQuotes() { if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; } }
  function startQuotes(m) {
    stopQuotes();
    if (!m.series) return;
    var pull = function () {
      fetch('/api/quote?id=' + encodeURIComponent(m.id), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (q) {
        var p = document.getElementById('px-p'), c = document.getElementById('px-c'), l = document.getElementById('px-live');
        if (!p || currentId !== m.id) return;
        if (!q || q.price == null) throw new Error('no price');
        p.textContent = fmtPrice(q.price);
        if (q.chg != null) { c.textContent = fmtPct(q.chg); c.className = 'c ' + toneOf(q.chg); }
        var age = q.t ? Math.max(0, Math.round(Date.now() / 1000 - q.t)) : null;
        var stale = age != null && age > 900;
        l.textContent = stale ? 'السوق مغلق أو متأخر' : 'مباشر';
        l.className = 'livechip' + (stale ? ' off' : ' on');
      }).catch(function () {
        var l = document.getElementById('px-live');
        if (l) { l.textContent = 'آخر إغلاق'; l.className = 'livechip'; }
      });
    };
    pull();
    quoteTimer = setInterval(pull, 15000);
  }
  function ensureCal(cb) {
    if (CAL) return cb();
    fetch('/api/calendar', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { CAL = c; cb(); }).catch(function () { CAL = { events: [], source: { ok: false, error: 'تعذّر الاتصال بالخادم' } }; cb(); });
  }

  /* ---------- news ---------- */
  function ensureNews(cb) {
    if (NEWS) return cb();
    fetch('/api/news', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) { NEWS = n; cb(); }).catch(function () { NEWS = { items: [], source: { ok: false, error: 'تعذّر الاتصال بالخادم' } }; cb(); });
  }
  function viewNews() {
    return '<section style="padding-block:28px 8px"><div class="kicker">الأخبار</div><h1 style="font-size:var(--fs-2xl);margin:0 0 8px;line-height:1.2">آخر العناوين</h1><p style="color:var(--muted);margin:0 0 4px;max-width:60ch">عناوين من الاحتياطي الفيدرالي وبنك إنجلترا والمركزي الأوروبي وFXStreet. الروابط تفتح في صفحة جديدة.</p>' + metaBar() + '</section><div id="newsbody" class="card" style="margin-top:16px"><div class="loading">جاري تحميل الأخبار…</div></div>';
  }
  function renderNewsPage() {
    var el = document.getElementById('newsbody'); if (!el || !NEWS) return;
    var items = NEWS.items || [];
    el.innerHTML = items.length ? newsList(items.slice(0, 40)) : '<div class="empty">لا توجد أخبار حالياً' + (NEWS.source && !NEWS.source.ok ? '. ' + esc(NEWS.source.error || '') : '.') + '</div>';
  }

  /* ---------- rates ---------- */
  function viewRates() {
    var rows = CUR_ORDER.map(function (c) {
      var b = (DATA.banks || {})[c]; if (!b) return '';
      var chg = '—';
      if (b.rate != null && b.prev != null) chg = b.rate === b.prev ? 'بدون تغيير' : (b.rate > b.prev ? '+' : MINUS) + Math.abs(Math.round((b.rate - b.prev) * 100)) + ' نقطة أساس';
      return '<tr><td><b>' + b.name + '</b> <bdi class="ltr muted">' + b.short + '</bdi></td><td><bdi class="ltr">' + c + '</bdi></td><td class="num" dir="ltr">' + (b.rate != null ? b.rate.toFixed(2) + '%' : '—') + '</td><td class="num" dir="ltr">' + (b.prev != null ? b.prev.toFixed(2) + '%' : '—') + '</td><td>' + chg + '</td><td>' + (b.lastDate ? dateAr(b.lastDate) : '—') + '</td><td>' + (b.next ? dateAr(b.next) + ' · بعد ' + Math.max(daysTo(b.next), 0) + ' يوماً' : '—') + '</td></tr>';
    }).join('');
    return '<section style="padding-block:28px 8px"><div class="kicker">أسعار الفائدة</div><h1 style="font-size:var(--fs-2xl);margin:0 0 8px;line-height:1.2">البنوك المركزية الثمانية</h1><p style="color:var(--muted);margin:0 0 4px;max-width:60ch">سعر الفائدة الحالي والسابق وآخر تغيير وموعد الاجتماع القادم.</p>' + metaBar() + '</section>' +
      '<div class="card tw" style="margin-top:16px"><table><thead><tr><th>البنك</th><th>العملة</th><th>السعر الحالي</th><th>السابق</th><th>آخر تغيير</th><th>تاريخ القرار</th><th>الاجتماع القادم</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- calendar page ---------- */
  function viewCalendar() {
    return '<section style="padding-block:28px 8px"><div class="kicker">التقويم الاقتصادي</div><h1 style="font-size:var(--fs-2xl);margin:0 0 8px;line-height:1.2">الأحداث القادمة</h1><p style="color:var(--muted);margin:0 0 4px;max-width:60ch">الإصدارات الاقتصادية للعملات الثماني بتوقيت جهازك.</p>' + metaBar() + '</section><div id="calbody"><div class="loading">جاري تحميل التقويم…</div></div>';
  }
  function renderCalendar() {
    var el = document.getElementById('calbody'); if (!el) return;
    if (!CAL) { el.innerHTML = '<div class="loading">جاري تحميل التقويم…</div>'; return; }
    var evs = CAL.events || [];
    var chipsImp = '<div class="chips" role="group" aria-label="الأهمية">' + [[1, 'الكل'], [2, 'متوسط وعالٍ'], [3, 'عالٍ فقط']].map(function (x) { return '<button class="chip" type="button" data-ci="' + x[0] + '" aria-pressed="' + (state.calImp === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var chipsCur = '<div class="chips" role="group" aria-label="العملة"><button class="chip" type="button" data-cc="all" aria-pressed="' + (state.calCur === 'all') + '">كل العملات</button>' + CUR_ORDER.map(function (c) { return '<button class="chip" type="button" data-cc="' + c + '" aria-pressed="' + (state.calCur === c) + '">' + c + '</button>'; }).join('') + '</div>';
    var list = evs.filter(function (e) { return e.imp >= state.calImp && (state.calCur === 'all' || e.cur === state.calCur); });
    var body = '';
    if (!list.length) body = '<div class="empty">لا توجد أحداث مطابقة.' + (CAL.source && !CAL.source.ok ? ' تعذّر جلب التقويم: ' + esc(CAL.source.error || '') : '') + '</div>';
    else {
      var cur = null;
      list.forEach(function (e) {
        var k = dayKey(e.t);
        if (k !== cur) { if (cur !== null) body += '</tbody></table></div>'; cur = k; body += '<div class="cal-day">' + dayAr(e.t) + '</div><div class="card tw"><table><thead><tr><th>الوقت</th><th>العملة</th><th>الأهمية</th><th>الحدث</th><th>الفعلي</th><th>المتوقع</th><th>السابق</th></tr></thead><tbody>'; }
        body += '<tr><td class="num">' + timeAr(e.t) + '</td><td><bdi class="ltr">' + e.cur + '</bdi></td><td><span class="imp' + (e.imp === 3 ? ' h' : '') + '">' + [1, 2, 3].map(function (n) { return '<i class="' + (n <= e.imp ? 'on' : '') + '"></i>'; }).join('') + '</span></td><td style="white-space:normal;min-width:220px">' + esc(e.event) + '</td><td class="num" dir="ltr"><b>' + esc(e.actual || '—') + '</b></td><td class="num" dir="ltr">' + esc(e.forecast || '—') + '</td><td class="num" dir="ltr">' + esc(e.previous || '—') + '</td></tr>';
      });
      body += '</tbody></table></div>';
    }
    el.innerHTML = '<div class="tools" style="margin-top:12px">' + chipsImp + chipsCur + '</div>' + body;
  }
  function loadCalendar() {
    return fetch('/api/calendar', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { CAL = c; renderCalendar(); }).catch(function () { CAL = { events: [], source: { ok: false, error: 'تعذّر الاتصال بالخادم' } }; renderCalendar(); });
  }

  /* ---------- router ---------- */
  function loadData() {
    return fetch('/api/data', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      DATA = d; MAP = {}; (d.markets || []).forEach(function (m) { MAP[m.id] = m; }); updateLive(); return d;
    });
  }
  function setNav(id) {
    ['home', 'rates', 'news', 'calendar'].forEach(function (k) { var a = document.getElementById('nav-' + k); if (a) a.classList.toggle('on', k === id); });
  }
  function route(keepScroll) {
    var app = document.getElementById('app');
    stopQuotes();
    if (!DATA) { app.innerHTML = '<div class="loading">جاري تحميل البيانات…</div>'; return; }
    if (!DATA.ready) { app.innerHTML = '<div class="loading">الخادم يجلب أول دفعة من البيانات، وقد يستغرق ذلك نحو دقيقة. ستظهر الصفحة تلقائياً.</div>'; return; }
    var h = location.hash.replace('#', '');
    var y = window.scrollY;
    if (h.indexOf('m-') === 0 && MAP[h.slice(2)]) {
      var m = MAP[h.slice(2)];
      if (!keepScroll) state.fg = 'all';
      app.innerHTML = viewMarket(m); setNav('home');
      startQuotes(m);
      ensureCal(function () { if (currentId === m.id) renderMarketCal(m); });
      ensureNews(function () { if (currentId === m.id) renderMarketNews(m); });
    } else if (h === 'rates') { app.innerHTML = viewRates(); setNav('rates'); currentId = null; }
    else if (h === 'news') { app.innerHTML = viewNews(); setNav('news'); currentId = null; ensureNews(renderNewsPage); }
    else if (h === 'calendar') { app.innerHTML = viewCalendar(); setNav('calendar'); currentId = null; renderCalendar(); loadCalendar(); }
    else { app.innerHTML = viewHome(); renderResults(); setNav('home'); currentId = null; }
    window.scrollTo(0, keepScroll ? y : 0);
  }
  window.addEventListener('hashchange', function () { route(false); });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cat],[data-bias],[data-fg],[data-ci],[data-cc],[data-tab],#auto,#refresh');
    if (!t) return;
    if (t.hasAttribute('data-cat')) { state.cat = t.getAttribute('data-cat'); renderResults(); }
    else if (t.hasAttribute('data-bias')) { state.bias = t.getAttribute('data-bias'); renderResults(); }
    else if (t.hasAttribute('data-fg') && currentId) { state.fg = t.getAttribute('data-fg'); document.getElementById('sec-factors').innerHTML = factorSection(MAP[currentId]); }
    else if (t.hasAttribute('data-ci')) { state.calImp = Number(t.getAttribute('data-ci')); renderCalendar(); }
    else if (t.hasAttribute('data-cc')) { state.calCur = t.getAttribute('data-cc'); renderCalendar(); }
    else if (t.hasAttribute('data-tab')) {
      var id = t.getAttribute('data-tab'), sec = document.getElementById('sec-' + id);
      Array.prototype.forEach.call(document.querySelectorAll('#mtabs button'), function (b) { b.setAttribute('aria-pressed', String(b === t)); });
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else if (t.id === 'auto') {
      state.auto = !state.auto; t.setAttribute('aria-pressed', String(state.auto));
      try { localStorage.setItem('mc-auto', state.auto ? '1' : '0'); } catch (err) { /* ignore */ }
    }
    else if (t.id === 'refresh') {
      t.textContent = 'جاري التحديث…';
      loadData().then(function () { route(true); }).catch(function () { t.textContent = 'تعذّر التحديث'; });
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') { state.q = e.target.value; renderResults(); }
  });

  /* ---------- theme ---------- */
  var root = document.documentElement;
  root.setAttribute('data-theme', 'light'); // light by default, like the reference; the toggle switches to dark
  try { if (localStorage.getItem('mc-theme') === 'dark') root.setAttribute('data-theme', 'dark'); } catch (e) { /* storage unavailable */ }
  document.getElementById('theme').addEventListener('click', function () {
    var cur = root.getAttribute('data-theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('mc-theme', next); } catch (e) { /* ignore */ }
  });

  /* ---------- boot + polling ---------- */
  function boot() {
    loadData().then(function () {
      route(false);
      if (!DATA.ready) setTimeout(boot, 5000);
    }).catch(function () {
      document.getElementById('app').innerHTML = '<div class="loading">تعذّر الاتصال بالخادم. أعد تحميل الصفحة بعد قليل.</div>';
      setTimeout(boot, 10000);
    });
  }
  setInterval(function () {
    if (!state.auto || !DATA || !DATA.ready) return;
    var typing = document.activeElement && document.activeElement.id === 'q';
    loadData().then(function () { if (!typing) route(true); }).catch(function () { /* keep the last data */ });
  }, 60000);
  boot();
})();
