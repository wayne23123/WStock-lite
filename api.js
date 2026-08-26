const WATCHLIST = [
  { code: '2324', name: '仁寶' },
  { code: '00919', name: '群益台灣精選高息' },
  { code: '2330', name: '台積電' },
  { code: '2317', name: '鴻海' },
  { code: '2454', name: '聯發科' },
  { code: '2603', name: '長榮' },
  { code: '2881', name: '富邦金' },
  { code: '2303', name: '聯電' },
  { code: '2412', name: '中華電' },
];

const DEFAULT_SKILL = `請分析以下股票資料，提供買賣建議、技術面看法、風險評估：

股票：{name}({code})
價格：{price}
漲跌：{change} ({changePercent}%)
成交量：{volume}
內外盤：內盤 {innerVolume} ({innerPercent}%) / 外盤 {outerVolume} ({outerPercent}%)
均線：5日 {ma5} / 10日 {ma10} / 20日 {ma20}
錨點：{anchor} 價差 {anchorProfit}`;

let skillText = localStorage.getItem('skillText') || DEFAULT_SKILL;

function fmt(num) {
  if (num >= 100000) return (num / 10000).toFixed(0) + '萬';
  if (num >= 10000) return (num / 10000).toFixed(1) + '萬';
  return num.toLocaleString();
}

let cache = {};
let lastRequestTime = 0;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function genMockStock(code, name) {
  const seed = parseInt(String(code).replace(/\D/g, '')) || 2330;
  const base = 20 + (seed % 80) + Math.floor(seed / 100) * 0.5;
  const chgPct = Math.sin(Date.now() / 60000 + seed) * 0.5 * 3;
  const price = base * (1 + chgPct / 100);
  const vol = Math.round(15000 + (seed % 50000));
  return {
    code: String(code),
    name: name || String(code),
    price: Math.round(price * 100) / 100,
    open: Math.round(base * 100) / 100,
    high: Math.round((price + 0.5) * 100) / 100,
    low: Math.round((price - 0.5) * 100) / 100,
    prevClose: Math.round(base * 100) / 100,
    change: Math.round((price - base) * 100) / 100,
    changePercent: Math.round(chgPct * 100) / 100,
    volume: vol,
    innerVolume: Math.round(vol * 0.55),
    outerVolume: Math.round(vol * 0.45),
    ma5: Math.round(price * 0.97 * 100) / 100,
    ma10: Math.round(price * 0.94 * 100) / 100,
    ma20: Math.round(price * 0.91 * 100) / 100,
    date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    time: new Date().toTimeString().slice(0, 8),
    source: '模擬',
    _mock: true,
  };
}

async function fetchTwseQuote(code) {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0&_=${Date.now()}`;
    const response = await fetch(url, {
      headers: {
        Referer: 'https://mis.twse.com.tw/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.msgArray || data.msgArray.length === 0) return null;
    const raw = data.msgArray[0];
    if (raw.z === '-' && raw.y === '-') return null;
    const price = raw.z !== '-' && raw.z !== undefined && raw.z !== '' ? parseFloat(raw.z) : parseFloat(raw.y);
    const open = raw.o !== '-' && raw.o !== undefined && raw.o !== '' ? parseFloat(raw.o) : price;
    const high = raw.h !== '-' && raw.h !== undefined && raw.h !== '' ? parseFloat(raw.h) : price;
    const low = raw.l !== '-' && raw.l !== undefined && raw.l !== '' ? parseFloat(raw.l) : price;
    const prevClose = raw.y !== '-' && raw.y !== undefined && raw.y !== '' ? parseFloat(raw.y) : price;
    const volume = parseInt(raw.v) || 0;
    const change = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    const inner = raw.it && raw.it !== '-' ? parseInt(raw.it) : 0;
    const outer = raw.ot && raw.ot !== '-' ? parseInt(raw.ot) : 0;
    return {
      code: String(code),
      name: raw.n || String(code),
      price: price,
      open: open,
      high: high,
      low: low,
      prevClose: prevClose,
      change: change,
      changePercent: changePercent,
      volume: volume,
      innerVolume: inner,
      outerVolume: outer,
      ma5: price * 0.98,
      ma10: price * 0.96,
      ma20: price * 0.94,
      date: raw.d || '',
      time: raw.t || '',
      source: 'TWSE',
      raw: raw,
    };
  } catch (e) {
    return null;
  }
}

async function fetchSingle(code, name) {
  const key = `single_${code}`;
  const now = Date.now();
  if (cache[key] && now - cache[key].time < 3000) {
    return cache[key].data;
  }
  const elapsed = now - lastRequestTime;
  if (elapsed < 500) {
    await delay(500 - elapsed);
  }
  let data = await fetchTwseQuote(code);
  if (!data) {
    data = genMockStock(code, name);
  }
  cache[key] = { data: data, time: Date.now() };
  lastRequestTime = Date.now();
  return data;
}

async function fetchBatch(codes) {
  const codeList = codes.map((item) => (typeof item === 'string' ? item : item.code));
  const key = codeList.join(',');
  const now = Date.now();
  if (cache[key] && now - cache[key].time < 3000) {
    return cache[key].data;
  }
  const elapsed = now - lastRequestTime;
  if (elapsed < 500) {
    await delay(500 - elapsed);
  }
  const chStr = codeList.map((c) => `tse_${c}.tw`).join('|');
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${chStr}&json=1&delay=0&_=${Date.now()}`;
  let results = [];
  try {
    const response = await fetch(url, {
      headers: {
        Referer: 'https://mis.twse.com.tw/',
        'User-Agent': 'Mozilla/5.0',
      },
    });
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
          const price = raw.z !== '-' && raw.z !== undefined && raw.z !== '' ? parseFloat(raw.z) : parseFloat(raw.y);
          const open = raw.o !== '-' && raw.o !== undefined && raw.o !== '' ? parseFloat(raw.o) : price;
          const high = raw.h !== '-' && raw.h !== undefined && raw.h !== '' ? parseFloat(raw.h) : price;
          const low = raw.l !== '-' && raw.l !== undefined && raw.l !== '' ? parseFloat(raw.l) : price;
          const prevClose = raw.y !== '-' && raw.y !== undefined && raw.y !== '' ? parseFloat(raw.y) : price;
          const volume = parseInt(raw.v) || 0;
          const change = price - prevClose;
          const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
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
            open: open,
            high: high,
            low: low,
            prevClose: prevClose,
            change: change,
            changePercent: changePercent,
            volume: volume,
            innerVolume: inner,
            outerVolume: outer,
            ma5: price * 0.98,
            ma10: price * 0.96,
            ma20: price * 0.94,
            date: raw.d || '',
            time: raw.t || '',
            source: 'TWSE',
            raw: raw,
          };
        });
        const allCodes = codeList.slice();
        const foundCodes = results.map((r) => r.code);
        const missingCodes = allCodes.filter((c) => !foundCodes.includes(c));
        for (const c of missingCodes) {
          const name = nameMap[c] || c;
          results.push(genMockStock(c, name));
        }
        cache[key] = { data: results, time: Date.now() };
        lastRequestTime = Date.now();
        return results;
      }
    }
  } catch (e) {
    console.warn('批次抓取失敗，改用單筆:', e);
  }
  for (const item of codes) {
    const code = typeof item === 'string' ? item : item.code;
    const name = typeof item === 'string' ? code : item.name;
    const data = await fetchSingle(code, name);
    results.push(data);
  }
  cache[key] = { data: results, time: Date.now() };
  return results;
}

if (typeof module !== 'undefined') {
  module.exports = { WATCHLIST, fetchBatch, fmt };
}
