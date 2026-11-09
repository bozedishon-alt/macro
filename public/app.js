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

  var state = { cat: 'all', bias: 'all', q: '', fg: 'all', calImp: 2, calCur: 'all' };
  var DATA = null, MAP = {}, currentId = null, CAL = null;

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
  function fmtPct(c) { return (c > 0 ? '+' : c < 0 ? MINUS : '') + Math.abs(c).toFixed(2) + '%'; }

  /* ---------- shared pieces ---------- */
  function badges(m) {
    if (m.cat === 'fx') return '<span class="pair-b"><span class="cc">' + m.base + '</span><span class="cc">' + m.quote + '</span></span>';
    if (m.cat === 'cur') return '<span class="pair-b"><span class="cc">' + m.base + '</span></span>';
    return '';
  }
  function tile(m) {
    var name = (m.cat === 'fx' || m.cat === 'cur') ? '<bdi class="ltr">' + esc(m.label) + '</bdi>' : '<span class="nm">' + esc(m.label) + '</span>';
    return '<a class="tile b-' + m.bias + '" href="#m-' + m.id + '"><span class="t1">' + badges(m) + name + '</span>' +
      '<span class="t2"><span>' + BIAS_AR[m.bias] + '</span>' + num(m.score) + '</span></a>';
  }
  function dbar(v, max) {
    var w = Math.min(Math.abs(v) / max * 50, 50);
    if (v === 0) return '<div class="dbar"></div>';
    return '<div class="dbar"><i class="' + (v > 0 ? 'p' : 'n') + '" style="width:' + w + '%"></i></div>';
  }
  function factorRow(f) {
    if (f.na) return '<div class="rw na"><div class="l"><span>' + FACTOR_AR[f.k] + '</span><b>—</b></div><div class="dbar"></div></div>';
    return '<div class="rw"><div class="l"><span>' + FACTOR_AR[f.k] + '</span><b class="' + toneOf(f.v) + '">' + fmt(f.v) + '</b></div>' + dbar(f.v, 2) + '</div>';
  }
  function groupCount(m, g) { return m.factors.filter(function (f) { return f.g === g; }).length; }

  function metaBar() {
    var s = DATA.sources || {};
    var names = { prices: 'الأسعار', cot: 'مراكز COT', macro: 'الاقتصاد الكلي', calendar: 'التقويم' };
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

  /* ---------- home ---------- */
  function viewHome() {
    var bars = CUR_ORDER.map(function (c) {
      var m = MAP[c]; if (!m) return '';
      var h = Math.min(Math.abs(m.score) / 20 * 50, 50);
      var cls = m.score > 0 ? 'up' : m.score < 0 ? 'dn' : 'zero';
      var st = m.score === 0 ? '' : ' style="height:' + h + '%"';
      return '<a class="col" href="#m-' + c + '" title="' + c + '"><div class="plot"><span class="bar-v ' + cls + '"' + st + '></span></div><span class="code">' + c + '</span><span class="lab">' + BIAS_AR[m.bias] + '</span></a>';
    }).join('');
    return '<section class="split"><div><div class="kicker">الانحياز الكلي</div><h1>خريطة الانحياز لكل الأسواق</h1>' +
      '<p>انحياز كل سوق من هبوطي قوي إلى صعودي قوي. افتح أي سوق لترى درجاته وما يحركه.</p>' +
      '<p><span class="num">' + DATA.markets.length + '</span> سوقاً</p>' + metaBar() + '</div>' +
      '<div class="strength" role="group" aria-label="قوة العملات">' + bars + '</div></section>' +
      '<section aria-label="كل الأسواق"><div class="tools"><input id="q" class="search" type="search" placeholder="ابحث: EUR، ذهب، S&amp;P…" value="' + esc(state.q) + '" aria-label="بحث في الأسواق"><div id="chips" style="display:contents"></div></div><div id="results"></div></section>';
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
    var bl = [['all', 'أي انحياز', catList.length], ['bull', 'صعودي', cnt(function (m) { return m.score >= 4; })], ['neu', 'محايد', cnt(function (m) { return m.bias === 'n'; })], ['bear', 'هبوطي', cnt(function (m) { return m.score <= -4; })]];
    var biasChips = '<div class="chips" role="group" aria-label="الانحياز">' + bl.map(function (b) { return '<button class="chip" type="button" data-bias="' + b[0] + '" aria-pressed="' + (state.bias === b[0]) + '">' + b[1] + '<small>' + b[2] + '</small></button>'; }).join('') + '</div>';
    var chipsEl = document.getElementById('chips');
    if (chipsEl) chipsEl.innerHTML = catChips + biasChips;
    var list = catList.filter(function (m) {
      if (state.bias === 'bull') return m.score >= 4;
      if (state.bias === 'neu') return m.bias === 'n';
      if (state.bias === 'bear') return m.score <= -4;
      return true;
    });
    var out = '';
    CATS.forEach(function (c) {
      var items = list.filter(function (m) { return m.cat === c.k; }).sort(function (a, b) { return b.score - a.score; });
      if (!items.length) return;
      out += '<div class="row-cat"><h2>' + c.ar + '</h2><div class="tiles">' + items.map(tile).join('') + '</div></div>';
    });
    if (!out) out = '<div class="empty">لا توجد أسواق مطابقة. جرّب كلمة بحث أخرى أو غيّر الفلتر.</div>';
    var r = document.getElementById('results');
    if (r) r.innerHTML = out;
  }

  /* ---------- market page ---------- */
  function related(m) {
    var list;
    if (m.cat === 'fx') list = DATA.markets.filter(function (x) { return x.cat === 'fx' && x.id !== m.id && (x.base === m.base || x.base === m.quote || x.quote === m.base || x.quote === m.quote); });
    else list = DATA.markets.filter(function (x) { return x.cat === m.cat && x.id !== m.id; });
    return list.sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score); }).slice(0, 8);
  }
  function opportunities() {
    return DATA.markets.filter(function (x) { return x.cat === 'fx'; }).sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score); }).slice(0, 8);
  }
  function drivers(m) {
    return GROUPS.map(function (g) {
      var s = m.gs[g.k];
      var fs = m.factors.filter(function (f) { return f.g === g.k; });
      var nz = fs.filter(function (f) { return f.v !== 0; });
      var allNa = fs.every(function (f) { return f.na; });
      var sub = nz.length ? nz.map(function (f) { return FACTOR_AR[f.k] + ' ' + sn(f.v); }).join('، ') : (allNa ? 'لا توجد بيانات' : 'كل العوامل محايدة');
      var lab = allNa ? '—' : s > 0 ? 'صعودي' : s < 0 ? 'هبوطي' : 'محايد';
      return '<li><div><div class="t">' + g.ar + '</div><div class="s">' + sub + '</div></div><div class="v ' + (allNa ? 'tone-zero' : toneOf(s)) + '">' + lab + '</div></li>';
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
    return '<div class="px"><span class="p">' + fmtPrice(m.price) + '</span><span class="c ' + toneOf(m.chg) + '">' + fmtPct(m.chg) + '</span><span class="muted" style="font-size:var(--fs-xs)">إغلاق يومي، آخر 120 يوم تداول</span></div>' +
      '<svg class="pchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="رسم سعري">' +
      '<line class="gr" x1="' + P + '" x2="' + (W - P) + '" y1="' + y(mx).toFixed(1) + '" y2="' + y(mx).toFixed(1) + '"/>' +
      '<line class="gr" x1="' + P + '" x2="' + (W - P) + '" y1="' + y(mn).toFixed(1) + '" y2="' + y(mn).toFixed(1) + '"/>' +
      '<path class="ar" d="' + area + '"/><path class="ln" d="' + line + '"/>' +
      '<circle class="dt" cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(last[1]).toFixed(1) + '" r="4"/>' +
      '<text x="' + (P + 2) + '" y="' + (y(mx) + 15).toFixed(1) + '">' + fmtPrice(mx) + '</text>' +
      '<text x="' + (P + 2) + '" y="' + (y(mn) - 4).toFixed(1) + '">' + fmtPrice(mn) + '</text></svg>';
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
    return '<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:end"><div><h2 class="sect-title" style="margin-top:0">تفصيل العوامل</h2><p class="sect-sub">كل عامل يُقيَّم من −2 (هبوطي قوي) إلى +2 (صعودي قوي). الشرطة تعني أن البيانات غير متوفرة.</p></div>' + chips + '</div><div class="grid3" id="factor-cards">' + cards + '</div>';
  }
  function viewMarket(m) {
    currentId = m.id;
    var total = m.factors.length;
    var pct = (clamp(m.score, -25, 25) + 25) / 50 * 100;
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
    var bankSec = banks ? '<h2 class="sect-title">البنوك المركزية</h2><p class="sect-sub">سعر الفائدة الحالي وموعد الاجتماع القادم.</p><div class="cbs" style="margin-top:12px">' + banks + '</div>' : '';
    var rel = related(m);
    var relSec = rel.length ? '<h2 class="sect-title">أسواق مرتبطة</h2><div class="tiles" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">' + rel.map(tile).join('') + '</div>' : '';
    var priceCard = m.series ? '<article class="card" style="margin-top:16px"><header><h2>السعر</h2><p>' + esc(m.label) + '</p></header><div class="body">' + priceChart(m) + '</div></article>' : '';
    return '<a class="back" href="#">→ كل الأسواق</a>' +
      '<section class="head"><div><h1>' + badges(m) + big + '</h1><div class="nm">' + esc(m.ar) + '</div></div>' +
      '<div class="stats">' +
      '<div class="stat"><span class="k">الانحياز العام</span><strong class="big ' + toneOf(m.score) + '">' + BIAS_AR[m.bias] + '</strong><span class="sub">عبر ' + total + ' عاملاً · تغطية ' + m.coverage + '%</span></div>' +
      '<div class="stat"><span class="k">الدرجة</span><strong class="big num ' + toneOf(m.score) + '" dir="ltr">' + fmt(m.score) + '</strong></div>' +
      '<div class="stat"><span class="k">اتفاق العوامل</span><strong class="big" style="font-size:var(--fs-lg)"><i class="dot ' + dotCls + '"></i>' + lvl + '</strong><span class="sub">' + agreeTxt + '</span></div>' +
      '</div></section>' + metaBar() +
      '<div class="grid3">' +
      '<article class="card"><header><h2>نظرة على الانحياز الكلي</h2></header><div class="body"><div class="gauge"><div class="ends"><span class="tone-neg">هبوطي</span><span class="tone-pos">صعودي</span></div><div class="track"><span class="mark" style="left:' + pct + '%"></span></div></div><h3 style="margin:22px 0 0;font-size:var(--fs-base)">المحركات الرئيسية</h3><ul class="drivers" style="margin-top:6px">' + drivers(m) + '</ul></div></article>' +
      '<article class="card"><header><h2>مساهمة المجموعات</h2><p>مجموع درجات كل مجموعة.</p></header><div class="body rows">' +
      GROUPS.map(function (g) { var n = groupCount(m, g.k); return '<div class="rw"><div class="l"><span>' + g.ar + '</span><b class="' + toneOf(m.gs[g.k]) + '">' + fmt(m.gs[g.k]) + '</b></div>' + dbar(m.gs[g.k], n * 2) + '</div>'; }).join('') +
      '</div></article>' +
      '<article class="card"><header style="display:flex;justify-content:space-between;align-items:baseline"><div><h2>أقوى فرص العملات</h2><p>الأعلى في القوة المطلقة.</p></div><a href="#" style="color:var(--accent);font-size:var(--fs-sm)">عرض الكل</a></header><div class="body"><ul class="opps">' + opps + '</ul></div></article>' +
      '</div>' + priceCard + bankSec +
      '<section id="factors">' + factorSection(m) + '</section>' + relSec;
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

  /* ---------- calendar ---------- */
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
      DATA = d; MAP = {}; (d.markets || []).forEach(function (m) { MAP[m.id] = m; }); return d;
    });
  }
  function setNav(id) {
    ['home', 'rates', 'calendar'].forEach(function (k) { var a = document.getElementById('nav-' + k); if (a) a.classList.toggle('on', k === id); });
  }
  function route(keepScroll) {
    var app = document.getElementById('app');
    if (!DATA) { app.innerHTML = '<div class="loading">جاري تحميل البيانات…</div>'; return; }
    if (!DATA.ready) { app.innerHTML = '<div class="loading">الخادم يجلب أول دفعة من البيانات، وقد يستغرق ذلك نحو دقيقة. ستظهر الصفحة تلقائياً.</div>'; return; }
    var h = location.hash.replace('#', '');
    var y = window.scrollY;
    if (h.indexOf('m-') === 0 && MAP[h.slice(2)]) {
      if (!keepScroll) state.fg = 'all';
      app.innerHTML = viewMarket(MAP[h.slice(2)]); setNav('home');
    } else if (h === 'rates') { app.innerHTML = viewRates(); setNav('rates'); currentId = null; }
    else if (h === 'calendar') { app.innerHTML = viewCalendar(); setNav('calendar'); currentId = null; renderCalendar(); loadCalendar(); }
    else { app.innerHTML = viewHome(); renderResults(); setNav('home'); currentId = null; }
    window.scrollTo(0, keepScroll ? y : 0);
  }
  window.addEventListener('hashchange', function () { route(false); });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cat],[data-bias],[data-fg],[data-ci],[data-cc]');
    if (!t) return;
    if (t.hasAttribute('data-cat')) { state.cat = t.getAttribute('data-cat'); renderResults(); }
    else if (t.hasAttribute('data-bias')) { state.bias = t.getAttribute('data-bias'); renderResults(); }
    else if (t.hasAttribute('data-fg') && currentId) { state.fg = t.getAttribute('data-fg'); document.getElementById('factors').innerHTML = factorSection(MAP[currentId]); }
    else if (t.hasAttribute('data-ci')) { state.calImp = Number(t.getAttribute('data-ci')); renderCalendar(); }
    else if (t.hasAttribute('data-cc')) { state.calCur = t.getAttribute('data-cc'); renderCalendar(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'q') { state.q = e.target.value; renderResults(); }
  });

  /* ---------- theme ---------- */
  var root = document.documentElement;
  try { var saved = localStorage.getItem('mc-theme'); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) { /* storage unavailable */ }
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
    if (!DATA || !DATA.ready) return;
    var typing = document.activeElement && document.activeElement.id === 'q';
    loadData().then(function () { if (!typing) route(true); }).catch(function () { /* keep the last data */ });
  }, 60000);
  boot();
})();
