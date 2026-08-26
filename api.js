const WATCHLIST_GROUPS = [
  {
    category: '大盤／高息ETF',
    stocks: [
      { code: '0050', name: '元大台灣50' },
      { code: '0056', name: '元大高股息' },
      { code: '00919', name: '群益台灣精選高息' },
    ],
  },
  {
    category: '半導體／IC',
    stocks: [
      { code: '2330', name: '台積電' },
      { code: '2454', name: '聯發科' },
      { code: '2303', name: '聯電' },
      { code: '2337', name: '旺宏' },
      { code: '6770', name: '力積電' },
      { code: '2344', name: '華邦電' },
      { code: '2408', name: '南亞科' },
      { code: '2327', name: '國巨' },
      { code: '8150', name: '南茂' },
    ],
  },
  {
    category: '電子代工／系統廠',
    stocks: [
      { code: '2317', name: '鴻海' },
      { code: '2324', name: '仁寶' },
      { code: '2312', name: '金寶' },
      { code: '2353', name: '宏碁' },
      { code: '3231', name: '緯創' },
      { code: '2356', name: '英業達' },
      { code: '2352', name: '佳世達' },
      { code: '3706', name: '神達' },
    ],
  },
  {
    category: '面板',
    stocks: [
      { code: '2409', name: '友達' },
      { code: '3481', name: '群創' },
      { code: '6116', name: '彩晶' },
    ],
  },
  {
    category: '金融',
    stocks: [
      { code: '2887', name: '台新新光金' },
      { code: '2884', name: '玉山金' },
      { code: '2881', name: '富邦金' },
    ],
  },
  {
    category: '塑化',
    stocks: [
      { code: '1303', name: '南亞' },
      { code: '6505', name: '台塑化' },
      { code: '1301', name: '台塑' },
    ],
  },
  {
    category: '鋼鐵／金屬',
    stocks: [
      { code: '2002', name: '中鋼' },
      { code: '2027', name: '大成鋼' },
      { code: '1605', name: '華新' },
      { code: '1608', name: '華榮' },
    ],
  },
  {
    category: '航運／航空',
    stocks: [
      { code: '2610', name: '華航' },
      { code: '2618', name: '長榮航' },
      { code: '2603', name: '長榮' },
      { code: '2609', name: '陽明' },
      { code: '2634', name: '漢翔' },
    ],
  },
  {
    category: '電信／其他',
    stocks: [
      { code: '2412', name: '中華電' },
      { code: '1717', name: '長興' },
      { code: '1504', name: '東元' },
    ],
  },
];

const WATCHLIST = WATCHLIST_GROUPS.flatMap((g) => g.stocks);

const CODE_TO_CATEGORY = {};
WATCHLIST_GROUPS.forEach((g) => {
  g.stocks.forEach((s) => {
    CODE_TO_CATEGORY[s.code] = g.category;
  });
});

const DEFAULT_SKILL = `請分析以下股票資料：

股票：{name}({code})
價格：{price}
漲跌：{change} ({changePercent}%)
成交量：{volume}
內外盤：內盤 {innerVolume} ({innerPercent}%) / 外盤 {outerVolume} ({outerPercent}%)
均線：5日 {ma5} / 10日 {ma10} / 20日 {ma20} / 60日 {ma60}
錨點：{anchor} 價差 {anchorProfit}

【三大法人買賣超】
{institutional}

【融資融券】
{margin}

【估值】
本益比 {pe} 倍 / 殖利率 {yield}% / 股價淨值比 {pb} 倍

【今日價位】
開 {open} / 高 {high} / 低 {low} / 昨收 {prevClose}`;

let skillText = localStorage.getItem('skillText') || DEFAULT_SKILL;

let cache = {};
let lastRequestTime = 0;
let institutionalCache = {};
let marginCache = {};
let historyCache = {};
let marketInstCache = {};
let marketMarginCache = {};
let marketValuationCache = {};
let dailyFetchDone = {};
let prefetchInProgress = false;

try {
  institutionalCache = JSON.parse(localStorage.getItem('institutionalCache')) || {};
} catch (e) {}
try {
  marginCache = JSON.parse(localStorage.getItem('marginCache')) || {};
} catch (e) {}
try {
  marketValuationCache = JSON.parse(localStorage.getItem('marketValuationCache')) || {};
} catch (e) {}

function fmt(num) {
  if (num === null || num === undefined || isNaN(num)) return '--';
  if (num >= 100000) return (num / 10000).toFixed(0) + '萬';
  if (num >= 10000) return (num / 10000).toFixed(1) + '萬';
  return num.toLocaleString();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

function isAfterHours() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  return h > 13 || (h === 13 && m >= 30);
}

async function fetchTwseAPI(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    return null;
  }
}

function parseInstRow(row) {
  const foreignShares = (parseInt(row[4].replace(/,/g, '')) || 0) + (parseInt(row[7].replace(/,/g, '')) || 0);
  const investmentShares = parseInt(row[10].replace(/,/g, '')) || 0;
  const dealerShares = parseInt(row[11].replace(/,/g, '')) || 0;
  const foreign = Math.round(foreignShares / 1000);
  const investment = Math.round(investmentShares / 1000);
  const dealer = Math.round(dealerShares / 1000);
  return {
    code: row[0],
    name: (row[1] || '').trim(),
    foreign: foreign,
    investment: investment,
    dealer: dealer,
    total: foreign + investment + dealer,
  };
}

async function fetchMarketInstitutionalData() {
  const today = getTodayStr();
  if (marketInstCache[today]) {
    return marketInstCache[today];
  }
  const yesterday = getYesterdayStr();
  let parsed = null;
  let usedDate = null;
  for (const dateStr of [today, yesterday]) {
    const url = `/api/institutional?date=${dateStr}`;
    const result = await fetchTwseAPI(url);
    if (result && result.data && result.data.length > 0) {
      parsed = result.data.map(parseInstRow);
      usedDate = dateStr;
      break;
    }
    await delay(300);
  }
  if (!parsed) return null;
  const byCode = {};
  parsed.forEach((r) => {
    byCode[r.code] = r;
  });
  const sorted = parsed.slice().sort((a, b) => b.total - a.total);
  const marketData = {
    date: usedDate,
    byCode: byCode,
    buyRanking: sorted.slice(0, 40),
    sellRanking: sorted.slice(-40).reverse(),
  };
  marketInstCache[today] = marketData;
  return marketData;
}

async function fetchInstitutionalData(code) {
  const today = getTodayStr();
  const cacheKey = `${code}_${today}`;
  if (institutionalCache[cacheKey]) {
    return institutionalCache[cacheKey];
  }
  const market = await fetchMarketInstitutionalData();
  if (!market || !market.byCode[code]) return null;
  const r = market.byCode[code];
  const data = { foreign: r.foreign, investment: r.investment, dealer: r.dealer, date: market.date };
  institutionalCache[cacheKey] = data;
  localStorage.setItem('institutionalCache', JSON.stringify(institutionalCache));
  return data;
}

function parseMarginRow(row) {
  const num = (s) => parseInt(String(s).replace(/,/g, ''), 10) || 0;
  return {
    code: row[0],
    name: (row[1] || '').trim(),
    marginBuy: num(row[2]),
    marginSell: num(row[3]),
    marginBalance: num(row[6]),
    shortBuy: num(row[8]),
    shortSell: num(row[9]),
    shortBalance: num(row[12]),
  };
}

async function fetchMarketMarginData() {
  const today = getTodayStr();
  if (marketMarginCache[today]) {
    return marketMarginCache[today];
  }
  const yesterday = getYesterdayStr();
  let byCode = null;
  let usedDate = null;
  for (const dateStr of [today, yesterday]) {
    const url = `/api/margin?date=${dateStr}`;
    const result = await fetchTwseAPI(url);
    const table = result && result.tables && result.tables.find((t) => t.title && t.title.includes('融資融券彙總'));
    if (table && table.data && table.data.length > 0) {
      byCode = {};
      table.data.forEach((row) => {
        const parsed = parseMarginRow(row);
        byCode[parsed.code] = parsed;
      });
      usedDate = dateStr;
      break;
    }
    await delay(300);
  }
  if (!byCode) return null;
  const marketData = { date: usedDate, byCode: byCode };
  marketMarginCache[today] = marketData;
  return marketData;
}

async function fetchMarginData(code) {
  const today = getTodayStr();
  const cacheKey = `${code}_${today}`;
  if (marginCache[cacheKey]) {
    return marginCache[cacheKey];
  }
  const market = await fetchMarketMarginData();
  if (!market || !market.byCode[code]) return null;
  const r = market.byCode[code];
  const data = {
    marginBuy: r.marginBuy,
    marginSell: r.marginSell,
    marginBalance: r.marginBalance,
    shortBuy: r.shortBuy,
    shortSell: r.shortSell,
    shortBalance: r.shortBalance,
    date: market.date,
  };
  marginCache[cacheKey] = data;
  localStorage.setItem('marginCache', JSON.stringify(marginCache));
  return data;
}

function parseValuationRow(row) {
  const num = (s) => {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  };
  return {
    code: row[0],
    name: (row[1] || '').trim(),
    pe: num(row[2]),
    dividendYield: num(row[3]),
    pb: num(row[4]),
  };
}

async function fetchMarketValuationData() {
  const today = getTodayStr();
  if (marketValuationCache[today]) {
    return marketValuationCache[today];
  }
  const url = `/api/valuation`;
  const result = await fetchTwseAPI(url);
  if (!result || !result.data || result.data.length === 0) return null;
  const byCode = {};
  result.data.forEach((row) => {
    const parsed = parseValuationRow(row);
    byCode[parsed.code] = parsed;
  });
  const marketData = { date: result.date || today, byCode: byCode };
  marketValuationCache[today] = marketData;
  localStorage.setItem('marketValuationCache', JSON.stringify(marketValuationCache));
  return marketData;
}

async function fetchValuationData(code) {
  const market = await fetchMarketValuationData();
  if (!market || !market.byCode[code]) return null;
  return market.byCode[code];
}

async function fetchHistoryData(codes) {
  try {
    const url = `/api/history?codes=${encodeURIComponent(codes.join(','))}`;
    const result = await fetchTwseAPI(url);
    if (result) {
      historyCache = Object.assign({}, historyCache, result);
    }
  } catch (e) {}
  return historyCache;
}

function computeMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b.close, 0);
  return sum / period;
}

async function prefetchDailyData(results) {
  const today = getTodayStr();
  for (const stock of results) {
    const code = stock.code;
    const dayKey = `${code}_${today}`;
    if (!dailyFetchDone[dayKey]) {
      const inst = await fetchInstitutionalData(code);
      const margin = await fetchMarginData(code);
      const valuation = await fetchValuationData(code);
      if (inst || margin || valuation) {
        dailyFetchDone[dayKey] = true;
      }
      await delay(500);
    }
  }
}

async function fetchBatch(codes) {
  const codeList = codes.map((item) => (typeof item === 'string' ? item : item.code));
  const key = codeList.join(',');
  const now = Date.now();
  const cacheTtl = isAfterHours() ? 300000 : 3000;
  if (cache[key] && now - cache[key].time < cacheTtl) {
    return cache[key].data;
  }
  const elapsed = now - lastRequestTime;
  if (elapsed < 500) {
    await delay(500 - elapsed);
  }
  const chStr = codeList.map((c) => `tse_${c}.tw`).join('|');
  const url = `/api/quote?ex_ch=${encodeURIComponent(chStr)}`;
  let results = [];
  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.msgArray && data.msgArray.length > 0) {
        const nameMap = {};
        codes.forEach((item) => {
          const c = typeof item === 'string' ? item : item.code;
          const n = typeof item === 'string' ? c : item.name;
          nameMap[c] = n;
        });
        results = data.msgArray.map((raw) => {
          const code = raw.c || '';
          const hasTrade = raw.z !== '-' && raw.z !== undefined && raw.z !== '';
          const price = hasTrade ? parseFloat(raw.z) : null;
          const open = raw.o !== '-' && raw.o !== undefined && raw.o !== '' ? parseFloat(raw.o) : 0;
          const high = raw.h !== '-' && raw.h !== undefined && raw.h !== '' ? parseFloat(raw.h) : 0;
          const low = raw.l !== '-' && raw.l !== undefined && raw.l !== '' ? parseFloat(raw.l) : 0;
          const prevClose = raw.y !== '-' && raw.y !== undefined && raw.y !== '' ? parseFloat(raw.y) : 0;
          const volume = parseInt(raw.v) || 0;
          const change = hasTrade ? price - prevClose : 0;
          const changePercent = hasTrade ? (prevClose !== 0 ? (change / prevClose) * 100 : 0) : 0;
          let inner = Math.round(volume * 0.5);
          let outer = Math.round(volume * 0.5);
          if (raw.f && raw.f !== '-') {
            const fParts = raw.f
              .split('_')
              .filter((s) => s !== '')
              .map(Number);
            const gParts =
              raw.g && raw.g !== '-'
                ? raw.g
                    .split('_')
                    .filter((s) => s !== '')
                    .map(Number)
                : [];
            const fSum = fParts.reduce((a, b) => a + b, 0);
            const gSum = gParts.reduce((a, b) => a + b, 0);
            const totalFg = fSum + gSum;
            if (totalFg > 0) {
              inner = Math.round(volume * (fSum / totalFg));
              outer = volume - inner;
            }
          }
          return {
            code: code,
            name: nameMap[code] || raw.n || code,
            price: price,
            hasTrade: hasTrade,
            open: open,
            high: high,
            low: low,
            prevClose: prevClose,
            change: change,
            changePercent: changePercent,
            volume: volume,
            innerVolume: inner,
            outerVolume: outer,
            ma5: null,
            ma10: null,
            ma20: null,
            date: raw.d || '',
            time: raw.t || '',
            source: 'TWSE',
            raw: raw,
          };
        });
        cache[key] = { data: results, time: Date.now() };
        lastRequestTime = Date.now();

        if (isAfterHours() && !prefetchInProgress) {
          prefetchInProgress = true;
          prefetchDailyData(results).finally(() => {
            prefetchInProgress = false;
          });
        }

        return results;
      }
    }
  } catch (e) {
    console.warn('批次抓取失敗:', e);
  }
  cache[key] = { data: results, time: Date.now() };
  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { WATCHLIST, fetchBatch, fmt, skillText, fetchInstitutionalData, fetchMarginData };
}
