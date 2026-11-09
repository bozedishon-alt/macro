'use strict';
// Static definitions: markets, symbols, factor model. Edit this file to add markets or change mappings.

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

const AR_CUR = {
  USD: 'الدولار الأمريكي', EUR: 'اليورو', GBP: 'الجنيه الإسترليني', JPY: 'الين الياباني',
  CHF: 'الفرنك السويسري', CAD: 'الدولار الكندي', AUD: 'الدولار الأسترالي', NZD: 'الدولار النيوزيلندي',
};

// Trading Economics country names
const TE_COUNTRY = {
  USD: 'united states', EUR: 'euro area', GBP: 'united kingdom', JPY: 'japan',
  CHF: 'switzerland', CAD: 'canada', AUD: 'australia', NZD: 'new zealand',
};

const BANKS = {
  USD: { short: 'Fed', name: 'الاحتياطي الفيدرالي' },
  EUR: { short: 'ECB', name: 'البنك المركزي الأوروبي' },
  GBP: { short: 'BoE', name: 'بنك إنجلترا' },
  JPY: { short: 'BoJ', name: 'بنك اليابان' },
  CHF: { short: 'SNB', name: 'البنك الوطني السويسري' },
  CAD: { short: 'BoC', name: 'بنك كندا' },
  AUD: { short: 'RBA', name: 'بنك الاحتياطي الأسترالي' },
  NZD: { short: 'RBNZ', name: 'بنك الاحتياطي النيوزيلندي' },
};

// Factor model: key, group, Arabic label. Order matters (17 factors).
const FACTORS = [
  ['trend', 'tech', 'الاتجاه'], ['seas', 'tech', 'الموسمية'],
  ['cot', 'sent', 'مراكز COT'], ['crowd', 'sent', 'معنويات المتداولين'],
  ['gdp', 'growth', 'الناتج المحلي'], ['mfg', 'growth', 'PMI التصنيع'], ['svc', 'growth', 'PMI الخدمات'],
  ['retail', 'growth', 'مبيعات التجزئة'], ['conf', 'growth', 'ثقة المستهلك'],
  ['cpi', 'infl', 'التضخم CPI'], ['core', 'infl', 'التضخم الأساسي'], ['ppi', 'infl', 'أسعار المنتجين'],
  ['nfp', 'jobs', 'نمو الوظائف'], ['unemp', 'jobs', 'معدل البطالة'], ['claims', 'jobs', 'طلبات إعانة البطالة'],
  ['rate', 'mon', 'سعر الفائدة'], ['exp', 'mon', 'اتجاه الفائدة'],
].map(([k, g, ar]) => ({ k, g, ar }));

const GROUPS = [
  { k: 'tech', ar: 'الاتجاه الفني', short: 'الفني' },
  { k: 'sent', ar: 'المراكز والمعنويات', short: 'المعنويات' },
  { k: 'growth', ar: 'النمو الاقتصادي', short: 'النمو' },
  { k: 'infl', ar: 'التضخم', short: 'التضخم' },
  { k: 'jobs', ar: 'سوق العمل', short: 'الوظائف' },
  { k: 'mon', ar: 'السياسة النقدية', short: 'النقدية' },
];

const FX_PAIRS = [
  'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDJPY', 'USDCHF', 'USDCAD',
  'EURGBP', 'EURJPY', 'EURCHF', 'EURAUD', 'EURCAD', 'EURNZD',
  'GBPJPY', 'GBPCHF', 'GBPAUD', 'GBPCAD', 'GBPNZD',
  'AUDJPY', 'AUDCHF', 'AUDCAD', 'AUDNZD', 'NZDJPY', 'NZDCHF', 'NZDCAD',
  'CADJPY', 'CADCHF', 'CHFJPY',
];

// COT search keys (matched with LIKE against market_and_exchange_names)
const COT_KEY = {
  USD: 'USD INDEX', EUR: 'EURO FX', GBP: 'BRITISH POUND', JPY: 'JAPANESE YEN',
  CHF: 'SWISS FRANC', CAD: 'CANADIAN DOLLAR', AUD: 'AUSTRALIAN DOLLAR', NZD: 'NZ DOLLAR',
};

// Non-FX markets. region = which currency's macro data drives the macro groups.
// mult = how each macro group transmits to the market (modelling assumption, edit freely).
const OTHERS = [
  { id: 'RUT', label: 'Russell 2000', ar: 'مؤشر راسل 2000', cat: 'idx', yahoo: '^RUT', cot: 'RUSSELL', region: 'USD', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'DJI', label: 'Dow Jones', ar: 'داو جونز الصناعي', cat: 'idx', yahoo: '^DJI', cot: 'DJIA', region: 'USD', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'SPX', label: 'S&P 500', ar: 'إس آند بي 500', cat: 'idx', yahoo: '^GSPC', cot: 'E-MINI S&P 500', region: 'USD', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'IXIC', label: 'Nasdaq', ar: 'ناسداك المركب', cat: 'idx', yahoo: '^IXIC', cot: 'NASDAQ', region: 'USD', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'CN50', label: 'China (FXI)', ar: 'الصين (صندوق FXI)', cat: 'idx', yahoo: 'FXI', region: null, mult: {} },
  { id: 'DAX', label: 'DAX', ar: 'داكس الألماني', cat: 'idx', yahoo: '^GDAXI', region: 'EUR', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'N225', label: 'Nikkei 225', ar: 'نيكاي 225', cat: 'idx', yahoo: '^N225', region: 'JPY', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'FTSE', label: 'FTSE 100', ar: 'فوتسي 100', cat: 'idx', yahoo: '^FTSE', region: 'GBP', mult: { growth: 1, infl: 0, jobs: 1, mon: -1 } },
  { id: 'XCU', label: 'Copper', ar: 'النحاس', cat: 'com', yahoo: 'HG=F', cot: 'COPPER', region: 'USD', mult: { growth: 1, infl: 0, jobs: 0.5, mon: -0.5 } },
  { id: 'XPT', label: 'Platinum', ar: 'البلاتين', cat: 'com', yahoo: 'PL=F', cot: 'PLATINUM', region: 'USD', mult: { growth: 0.5, infl: 0.5, jobs: 0, mon: -0.5 } },
  { id: 'WTI', label: 'WTI crude oil', ar: 'خام غرب تكساس', cat: 'com', yahoo: 'CL=F', cot: 'CRUDE OIL, LIGHT SWEET', region: 'USD', mult: { growth: 1, infl: 0.5, jobs: 0.5, mon: 0 } },
  { id: 'NG', label: 'Natural gas', ar: 'الغاز الطبيعي', cat: 'com', yahoo: 'NG=F', cot: 'NAT GAS NYME', region: 'USD', mult: { growth: 0.5, infl: 0.5, jobs: 0, mon: 0 } },
  { id: 'XAG', label: 'Silver', ar: 'الفضة', cat: 'com', yahoo: 'SI=F', cot: 'SILVER', region: 'USD', mult: { growth: 0, infl: 0.5, jobs: 0, mon: -1 } },
  { id: 'XAU', label: 'Gold', ar: 'الذهب', cat: 'com', yahoo: 'GC=F', cot: 'GOLD', region: 'USD', mult: { growth: 0, infl: 0.5, jobs: 0, mon: -1 } },
  { id: 'BTC', label: 'Bitcoin', ar: 'بيتكوين', cat: 'cry', yahoo: 'BTC-USD', cot: 'BITCOIN', region: 'USD', mult: { growth: 0.5, infl: 0, jobs: 0.5, mon: -1 } },
  { id: 'ETH', label: 'Ethereum', ar: 'إيثريوم', cat: 'cry', yahoo: 'ETH-USD', cot: 'ETHER', region: 'USD', mult: { growth: 0.5, infl: 0, jobs: 0.5, mon: -1 } },
  { id: 'US10Y', label: 'US 10Y yield', ar: 'عائد السندات الأمريكية 10 سنوات', cat: 'bnd', yahoo: '^TNX', region: 'USD', mult: { growth: 1, infl: 1, jobs: 1, mon: 0.5 } },
];

// Trading Economics: category names per factor, and the groups to request.
const TE_GROUPS = ['gdp', 'business', 'consumer', 'prices', 'labour', 'money'];
const TE_CATEGORY = {
  gdp: ['GDP Annual Growth Rate'],
  mfg: ['Manufacturing PMI'],
  svc: ['Services PMI'],
  retail: ['Retail Sales YoY'],
  conf: ['Consumer Confidence'],
  cpi: ['Inflation Rate'],
  core: ['Core Inflation Rate'],
  ppi: ['Producer Prices Change'],
  nfp: ['Non Farm Payrolls', 'Employment Change'],
  unemp: ['Unemployment Rate'],
  claims: ['Initial Jobless Claims'],
  rate: ['Interest Rate'],
};

// FRED fallback (US only): series id + transform units
const FRED_US = {
  gdp: { id: 'GDPC1', units: 'pc1' },
  retail: { id: 'RSAFS', units: 'pc1' },
  cpi: { id: 'CPIAUCSL', units: 'pc1' },
  core: { id: 'CPILFESL', units: 'pc1' },
  ppi: { id: 'PPIACO', units: 'pc1' },
  nfp: { id: 'PAYEMS', units: 'chg' },
  unemp: { id: 'UNRATE', units: 'lin' },
  claims: { id: 'ICSA', units: 'lin' },
  rate: { id: 'DFEDTARU', units: 'lin' },
  conf: { id: 'UMCSENT', units: 'lin' },
};

module.exports = {
  CURRENCIES, AR_CUR, TE_COUNTRY, BANKS, FACTORS, GROUPS, FX_PAIRS, COT_KEY, OTHERS,
  TE_GROUPS, TE_CATEGORY, FRED_US,
};
