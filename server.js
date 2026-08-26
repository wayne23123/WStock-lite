const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_HISTORY_PER_CODE = 90;
const MAX_BACKFILL_REQUESTS = 200;
const MAX_BACKFILL_DAYS = 200;
const BACKFILL_DELAY_MS = 400;
const BACKFILL_COOLDOWN_MS = 30000;

const TWSE_HEADERS = {
  Referer: 'https://www.twse.com.tw/',
  'User-Agent': 'Mozilla/5.0',
};

const US_SYMBOLS = ['SPY', 'QQQ', 'SMH', 'TLT'];
const US_MARKET_CACHE_TTL = 30000;
let usMarketCache = null;
let usMarketCacheTime = 0;

let backfillInProgress = false;
let lastBackfillFinishedAt = 0;
let knownCodes = new Set();
let autoRecordedDate = null;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isServerAfterHours() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  return h > 13 || (h === 13 && m >= 30);
}

function todayStrServer() {
  const d = new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveHistory(history) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
}

function rocDateToWestern(rocDate) {
  const [y, m, d] = rocDate.split('/');
  const year = parseInt(y, 10) + 1911;
  return `${year}${m.padStart(2, '0')}${d.padStart(2, '0')}`;
}

function monthsInRange(startStr, endStr) {
  const cur = new Date(`${startStr.slice(0, 4)}-${startStr.slice(4, 6)}-01`);
  const end = new Date(`${endStr.slice(0, 4)}-${endStr.slice(4, 6)}-01`);
  const months = [];
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    months.push(`${y}${m}01`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function parseTwseNum(s) {
  return parseFloat(String(s).replace(/,/g, ''));
}

async function fetchStockDayOHLC(code, monthDate) {
  try {
    const upstream = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${monthDate}&stockNo=${encodeURIComponent(code)}&response=json`;
    const res = await fetch(upstream, { headers: TWSE_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json.data) return [];
    return json.data
      .map((row) => {
        const close = parseTwseNum(row[6]);
        if (isNaN(close)) return null;
        return {
          date: rocDateToWestern(row[0]),
          open: parseTwseNum(row[3]),
          high: parseTwseNum(row[4]),
          low: parseTwseNum(row[5]),
          close: close,
        };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function runBackfill(codes, start, end) {
  const months = monthsInRange(start, end);
  const totalRequests = codes.length * months.length;
  if (totalRequests > MAX_BACKFILL_REQUESTS) {
    throw new Error(`請求量過大（${totalRequests} 次，上限 ${MAX_BACKFILL_REQUESTS} 次），請縮小日期範圍或分批補資料`);
  }
  const history = loadHistory();
  let requestCount = 0;
  const updated = {};
  for (const code of codes) {
    const byDate = {};
    (history[code] || []).forEach((entry) => {
      byDate[entry.date] = entry;
    });
    for (const monthDate of months) {
      const rows = await fetchStockDayOHLC(code, monthDate);
      requestCount++;
      rows.forEach((r) => {
        byDate[r.date] = r;
      });
      await delay(BACKFILL_DELAY_MS);
    }
    const merged = Object.keys(byDate)
      .sort()
      .map((date) => byDate[date]);
    history[code] = merged.slice(-MAX_HISTORY_PER_CODE);
    updated[code] = history[code].length;
  }
  saveHistory(history);
  return { requestCount, updated };
}

async function maybeAutoRecordToday() {
  const today = todayStrServer();
  if (!isServerAfterHours()) return;
  if (autoRecordedDate === today) return;
  if (backfillInProgress) return;
  if (knownCodes.size === 0) return;
  backfillInProgress = true;
  try {
    await runBackfill(Array.from(knownCodes), today, today);
    autoRecordedDate = today;
  } catch (e) {
    // will retry on the next /api/quote hit within the same day
  } finally {
    backfillInProgress = false;
  }
}

async function fetchUsSymbol(symbol) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
    const now = Math.floor(Date.now() / 1000);
    const regular = meta.currentTradingPeriod && meta.currentTradingPeriod.regular;
    const isLive = !!(regular && now >= regular.start && now <= regular.end);
    return { symbol, price, changePercent, isLive };
  } catch (e) {
    return null;
  }
}

async function fetchUsMarketData() {
  const now = Date.now();
  if (usMarketCache && now - usMarketCacheTime < US_MARKET_CACHE_TTL) {
    return usMarketCache;
  }
  const results = await Promise.all(US_SYMBOLS.map(fetchUsSymbol));
  const symbols = {};
  let anyLive = false;
  results.forEach((r) => {
    if (r) {
      symbols[r.symbol] = { price: r.price, changePercent: r.changePercent };
      if (r.isLive) anyLive = true;
    }
  });
  const data = { ok: Object.keys(symbols).length > 0, isLive: anyLive, fetchedAt: now, symbols };
  usMarketCache = data;
  usMarketCacheTime = now;
  return data;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function proxyJson(res, upstreamUrl) {
  try {
    const upstream = await fetch(upstreamUrl, { headers: TWSE_HEADERS });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'proxy_failed', message: String(e) }));
  }
}

function serveStatic(req, res, pathname) {
  const filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/quote') {
    const exCh = url.searchParams.get('ex_ch') || '';
    exCh.split('|').forEach((seg) => {
      const m = seg.match(/^tse_(.+)\.tw$/);
      if (m) knownCodes.add(m[1]);
    });
    const upstream = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`;
    proxyJson(res, upstream);
    maybeAutoRecordToday();
    return;
  }

  if (url.pathname === '/api/institutional') {
    const date = url.searchParams.get('date') || '';
    const upstream = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${encodeURIComponent(date)}&selectType=ALLBUT0999&response=json`;
    proxyJson(res, upstream);
    return;
  }

  if (url.pathname === '/api/margin') {
    const date = url.searchParams.get('date') || '';
    const upstream = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${encodeURIComponent(date)}&selectType=ALL`;
    proxyJson(res, upstream);
    return;
  }

  if (url.pathname === '/api/valuation') {
    const upstream = `https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_ALL?response=json`;
    proxyJson(res, upstream);
    return;
  }

  if (url.pathname === '/api/usmarket') {
    fetchUsMarketData()
      .then((data) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      })
      .catch((e) => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      });
    return;
  }

  if (url.pathname === '/api/history' && req.method === 'GET') {
    const codes = (url.searchParams.get('codes') || '').split(',').filter(Boolean);
    const history = loadHistory();
    const result = {};
    codes.forEach((c) => {
      result[c] = history[c] || [];
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/backfill' && req.method === 'POST') {
    if (backfillInProgress) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: '已有補資料任務正在執行中，請稍候再試' }));
      return;
    }
    const sinceLast = Date.now() - lastBackfillFinishedAt;
    if (sinceLast < BACKFILL_COOLDOWN_MS) {
      const waitSec = Math.ceil((BACKFILL_COOLDOWN_MS - sinceLast) / 1000);
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: `補資料太頻繁，請再等 ${waitSec} 秒後再試` }));
      return;
    }
    (async () => {
      backfillInProgress = true;
      try {
        const body = await readRequestBody(req);
        const payload = JSON.parse(body || '{}');
        const codes = Array.isArray(payload.codes) ? payload.codes.filter((c) => /^[0-9A-Za-z]{1,6}$/.test(c)) : [];
        const start = String(payload.start || '');
        const end = String(payload.end || '');
        if (!codes.length || !/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end) {
          throw new Error('參數錯誤：請確認股票代號與日期範圍（YYYYMMDD）');
        }
        const dayCount = Math.round(
          (new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`) -
            new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`)) /
            86400000
        );
        if (dayCount > MAX_BACKFILL_DAYS) {
          throw new Error(`日期範圍過大，最多 ${MAX_BACKFILL_DAYS} 天`);
        }
        const result = await runBackfill(codes, start, end);
        lastBackfillFinishedAt = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
      } finally {
        backfillInProgress = false;
      }
    })();
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`WStock-lite running at http://localhost:${PORT}`);
});
