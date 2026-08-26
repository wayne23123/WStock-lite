function dateToISO(d) {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function ma(data, period) {
  const out = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j].close;
    out.push({ time: dateToISO(data[i].date), value: sum / period });
  }
  return out;
}

function bollinger(data, period, k) {
  const mid = [];
  const upper = [];
  const lower = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map((d) => d.close);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) * (b - avg), 0) / period;
    const sd = Math.sqrt(variance);
    const t = dateToISO(data[i].date);
    mid.push({ time: t, value: avg });
    upper.push({ time: t, value: avg + k * sd });
    lower.push({ time: t, value: avg - k * sd });
  }
  return { mid, upper, lower };
}

function kd(data, period) {
  const out = [];
  let prevK = 50;
  let prevD = 50;
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((d) => d.high));
    const ll = Math.min(...slice.map((d) => d.low));
    const rsv = hh === ll ? 50 : ((data[i].close - ll) / (hh - ll)) * 100;
    const k = (prevK * 2 + rsv) / 3;
    const d = (prevD * 2 + k) / 3;
    prevK = k;
    prevD = d;
    out.push({ time: dateToISO(data[i].date), k, d });
  }
  return out;
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function macd(data) {
  const closes = data.map((d) => d.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = closes.map((_, i) => ema12[i] - ema26[i]);
  const signal = ema(dif, 9);
  return data.map((d, i) => ({
    time: dateToISO(d.date),
    dif: dif[i],
    signal: signal[i],
    hist: dif[i] - signal[i],
  }));
}

function rsiPoint(date, avgGain, avgLoss) {
  const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  return { time: dateToISO(date), value, avgGain, avgLoss };
}

function rsi(data, period) {
  const out = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out.push(rsiPoint(data[i].date, avgGain, avgLoss));
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out.push(rsiPoint(data[i].date, avgGain, avgLoss));
    }
  }
  return out;
}

function lastValue(series) {
  return series.length ? series[series.length - 1].value : NaN;
}

const PATTERNS = [
  {
    name: '十字星 Doji',
    desc: '開盤與收盤價幾乎相同，多空拉鋸不分勝負，常出現在趨勢轉折點附近，需搭配前後K線判斷方向。',
    bars: [{ x: 28, topY: 10, bodyTopY: 48, bodyBottomY: 52, bottomY: 90, up: true }],
  },
  {
    name: '槌子 Hammer',
    desc: '出現在下跌趨勢末端，長下影線代表盤中殺低後被買方拉回，是常見的落底訊號。',
    bars: [{ x: 28, topY: 20, bodyTopY: 20, bodyBottomY: 35, bottomY: 90, up: true }],
  },
  {
    name: '上吊線 Hanging Man',
    desc: '外型與槌子相同，但出現在上漲趨勢末端，代表高檔開始出現賣壓，是潛在的反轉警訊。',
    bars: [{ x: 28, topY: 20, bodyTopY: 20, bodyBottomY: 35, bottomY: 90, up: false }],
  },
  {
    name: '多頭吞噬 Bullish Engulfing',
    desc: '第二根紅K實體完全吞噬前一根綠K，代表買方力道明顯轉強，常見於底部反轉。',
    bars: [
      { x: 20, topY: 35, bodyTopY: 38, bodyBottomY: 55, bottomY: 58, up: false },
      { x: 44, topY: 15, bodyTopY: 20, bodyBottomY: 75, bottomY: 80, up: true },
    ],
  },
  {
    name: '空頭吞噬 Bearish Engulfing',
    desc: '第二根綠K實體完全吞噬前一根紅K，代表賣方力道明顯轉強，常見於高檔反轉。',
    bars: [
      { x: 20, topY: 38, bodyTopY: 40, bodyBottomY: 55, bottomY: 58, up: true },
      { x: 44, topY: 15, bodyTopY: 20, bodyBottomY: 78, bottomY: 82, up: false },
    ],
  },
  {
    name: '晨星 Morning Star',
    desc: '三根K線組合：長黑K、跳空小實體、長紅K，代表跌勢衰竭、買方接手，是強力的底部反轉訊號。',
    bars: [
      { x: 16, topY: 15, bodyTopY: 20, bodyBottomY: 55, bottomY: 58, up: false },
      { x: 36, topY: 58, bodyTopY: 60, bodyBottomY: 66, bottomY: 70, up: true },
      { x: 56, topY: 20, bodyTopY: 25, bodyBottomY: 60, bottomY: 64, up: true },
    ],
  },
  {
    name: '夜星 Evening Star',
    desc: '三根K線組合：長紅K、跳空小實體、長黑K，代表漲勢衰竭、賣方接手，是強力的頭部反轉訊號。',
    bars: [
      { x: 16, topY: 20, bodyTopY: 25, bodyBottomY: 60, bottomY: 64, up: true },
      { x: 36, topY: 20, bodyTopY: 22, bodyBottomY: 28, bottomY: 32, up: false },
      { x: 56, topY: 15, bodyTopY: 20, bodyBottomY: 55, bottomY: 58, up: false },
    ],
  },
  {
    name: '紅三兵 Three White Soldiers',
    desc: '連續三根依序墊高的紅K，代表買方力道穩定增強，是偏多的延續訊號。',
    bars: [
      { x: 14, topY: 60, bodyTopY: 63, bodyBottomY: 80, bottomY: 83, up: true },
      { x: 34, topY: 45, bodyTopY: 48, bodyBottomY: 65, bottomY: 68, up: true },
      { x: 54, topY: 28, bodyTopY: 31, bodyBottomY: 50, bottomY: 53, up: true },
    ],
  },
  {
    name: '三隻烏鴉 Three Black Crows',
    desc: '連續三根依序走低的黑K，代表賣方力道穩定增強，是偏空的延續訊號。',
    bars: [
      { x: 14, topY: 17, bodyTopY: 20, bodyBottomY: 37, bottomY: 40, up: false },
      { x: 34, topY: 32, bodyTopY: 35, bodyBottomY: 52, bottomY: 55, up: false },
      { x: 54, topY: 47, bodyTopY: 50, bodyBottomY: 67, bottomY: 70, up: false },
    ],
  },
];

function candleSvg(bars) {
  const width = bars.length * 20 + 10;
  const shapes = bars
    .map((b) => {
      const cls = b.up ? 'up' : 'down';
      const bodyY = Math.min(b.bodyTopY, b.bodyBottomY);
      const bodyH = Math.max(Math.abs(b.bodyBottomY - b.bodyTopY), 2);
      return `<line x1="${b.x}" y1="${b.topY}" x2="${b.x}" y2="${b.bodyTopY}" class="wick ${cls}"></line>
        <rect x="${b.x - 6}" y="${bodyY}" width="12" height="${bodyH}" class="body ${cls}"></rect>
        <line x1="${b.x}" y1="${b.bodyBottomY}" x2="${b.x}" y2="${b.bottomY}" class="wick ${cls}"></line>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} 100" class="pattern-svg" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
}

function renderPatterns() {
  const grid = document.getElementById('patternGrid');
  grid.innerHTML = PATTERNS.map(
    (p) => `
    <div class="pattern-item">
      ${candleSvg(p.bars)}
      <div class="pattern-info">
        <strong>${p.name}</strong>
        <span>${p.desc}</span>
      </div>
    </div>
  `
  ).join('');
}

let mainChart;
let oscChart;
let oscSeries = [];
const maSeriesMap = {};
const bollSeriesMap = {};

function chartBaseOptions() {
  return {
    layout: { background: { color: '#ffffff' }, textColor: '#8a8a8a', fontSize: 11 },
    grid: { vertLines: { color: '#f5f3f0' }, horzLines: { color: '#f5f3f0' } },
    rightPriceScale: { borderColor: '#e5e1dc' },
    timeScale: { borderColor: '#e5e1dc' },
  };
}

function setOscillator(type, data) {
  oscSeries.forEach((s) => oscChart.removeSeries(s));
  oscSeries = [];
  if (type === 'kd') {
    const points = kd(data, 9);
    const kLine = oscChart.addLineSeries({ color: '#a17872', lineWidth: 1 });
    kLine.setData(points.map((p) => ({ time: p.time, value: p.k })));
    const dLine = oscChart.addLineSeries({ color: '#7a8fc9', lineWidth: 1 });
    dLine.setData(points.map((p) => ({ time: p.time, value: p.d })));
    oscSeries = [kLine, dLine];
  } else if (type === 'macd') {
    const points = macd(data);
    const hist = oscChart.addHistogramSeries({});
    hist.setData(points.map((p) => ({ time: p.time, value: p.hist, color: p.hist >= 0 ? '#a17872' : '#6f9188' })));
    const difLine = oscChart.addLineSeries({ color: '#c9b47a', lineWidth: 1 });
    difLine.setData(points.map((p) => ({ time: p.time, value: p.dif })));
    const sigLine = oscChart.addLineSeries({ color: '#7a8fc9', lineWidth: 1 });
    sigLine.setData(points.map((p) => ({ time: p.time, value: p.signal })));
    oscSeries = [hist, difLine, sigLine];
  } else if (type === 'rsi') {
    const points = rsi(data, 14);
    const line = oscChart.addLineSeries({ color: '#964e4a', lineWidth: 1 });
    line.setData(points.map((p) => ({ time: p.time, value: p.value })));
    oscSeries = [line];
  }
}

function renderCharts(data) {
  const mainEl = document.getElementById('mainChart');
  const oscEl = document.getElementById('oscChart');

  mainChart = LightweightCharts.createChart(mainEl, {
    ...chartBaseOptions(),
    width: mainEl.clientWidth,
    height: 320,
  });
  const candleSeries = mainChart.addCandlestickSeries({
    upColor: '#a17872',
    downColor: '#6f9188',
    borderVisible: false,
    wickUpColor: '#a17872',
    wickDownColor: '#6f9188',
  });
  candleSeries.setData(data.map((d) => ({ time: dateToISO(d.date), open: d.open, high: d.high, low: d.low, close: d.close })));

  maSeriesMap.ma5 = mainChart.addLineSeries({ color: '#c98f7a', lineWidth: 1 });
  maSeriesMap.ma5.setData(ma(data, 5));
  maSeriesMap.ma10 = mainChart.addLineSeries({ color: '#8f9fc9', lineWidth: 1 });
  maSeriesMap.ma10.setData(ma(data, 10));
  maSeriesMap.ma20 = mainChart.addLineSeries({ color: '#c9b47a', lineWidth: 1 });
  maSeriesMap.ma20.setData(ma(data, 20));
  maSeriesMap.ma60 = mainChart.addLineSeries({ color: '#9a7ac9', lineWidth: 1, visible: false });
  maSeriesMap.ma60.setData(ma(data, 60));

  const boll = bollinger(data, 20, 2);
  bollSeriesMap.upper = mainChart.addLineSeries({ color: '#b0b0b0', lineWidth: 1, visible: false });
  bollSeriesMap.upper.setData(boll.upper);
  bollSeriesMap.mid = mainChart.addLineSeries({ color: '#c0c0c0', lineWidth: 1, visible: false });
  bollSeriesMap.mid.setData(boll.mid);
  bollSeriesMap.lower = mainChart.addLineSeries({ color: '#b0b0b0', lineWidth: 1, visible: false });
  bollSeriesMap.lower.setData(boll.lower);

  document.getElementById('toggleMA5').addEventListener('change', (e) => maSeriesMap.ma5.applyOptions({ visible: e.target.checked }));
  document.getElementById('toggleMA10').addEventListener('change', (e) => maSeriesMap.ma10.applyOptions({ visible: e.target.checked }));
  document.getElementById('toggleMA20').addEventListener('change', (e) => maSeriesMap.ma20.applyOptions({ visible: e.target.checked }));
  document.getElementById('toggleMA60').addEventListener('change', (e) => maSeriesMap.ma60.applyOptions({ visible: e.target.checked }));
  document.getElementById('toggleBoll').addEventListener('change', (e) => {
    bollSeriesMap.upper.applyOptions({ visible: e.target.checked });
    bollSeriesMap.mid.applyOptions({ visible: e.target.checked });
    bollSeriesMap.lower.applyOptions({ visible: e.target.checked });
  });

  oscChart = LightweightCharts.createChart(oscEl, {
    ...chartBaseOptions(),
    width: oscEl.clientWidth,
    height: 140,
  });
  setOscillator('kd', data);

  document.querySelectorAll('.osc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.osc-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setOscillator(btn.dataset.osc, data);
    });
  });

  mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) oscChart.timeScale().setVisibleLogicalRange(range);
  });
  oscChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) mainChart.timeScale().setVisibleLogicalRange(range);
  });

  window.addEventListener('resize', () => {
    mainChart.applyOptions({ width: mainEl.clientWidth });
    oscChart.applyOptions({ width: oscEl.clientWidth });
  });
}

function renderCommentary(data, titleText) {
  const last = data[data.length - 1];
  const price = last.close;

  const ma5 = lastValue(ma(data, 5));
  const ma10 = lastValue(ma(data, 10));
  const ma20 = lastValue(ma(data, 20));
  const ma60v = data.length >= 60 ? lastValue(ma(data, 60)) : null;

  let maText;
  if (ma60v !== null && ma5 > ma10 && ma10 > ma20 && ma20 > ma60v) {
    maText = '均線呈多頭排列（5日>10日>20日>60日），中期趨勢偏多。';
  } else if (ma60v !== null && ma5 < ma10 && ma10 < ma20 && ma20 < ma60v) {
    maText = '均線呈空頭排列（5日<10日<20日<60日），中期趨勢偏空。';
  } else if (ma5 > ma20) {
    maText = '短期均線在長期均線之上，短線偏多但均線尚未完全排列。';
  } else {
    maText = '均線糾結或短均線在長均線之下，方向尚不明朗。';
  }

  const boll = bollinger(data, 20, 2);
  let bollText = '布林通道資料不足。';
  if (boll.upper.length) {
    const u = boll.upper[boll.upper.length - 1].value;
    const l = boll.lower[boll.lower.length - 1].value;
    if (price > u) bollText = '股價站上布林上軌，短線可能過熱，留意拉回風險。';
    else if (price < l) bollText = '股價跌破布林下軌，短線可能超跌，留意反彈機會。';
    else bollText = '股價位於布林通道區間內，波動屬正常範圍。';
  }

  const kdPoints = kd(data, 9);
  let kdText = 'KD 資料不足。';
  if (kdPoints.length >= 2) {
    const cur = kdPoints[kdPoints.length - 1];
    const prev = kdPoints[kdPoints.length - 2];
    if (prev.k <= prev.d && cur.k > cur.d) kdText = `KD 出現黃金交叉（K=${cur.k.toFixed(1)}, D=${cur.d.toFixed(1)}），短線轉強訊號。`;
    else if (prev.k >= prev.d && cur.k < cur.d) kdText = `KD 出現死亡交叉（K=${cur.k.toFixed(1)}, D=${cur.d.toFixed(1)}），短線轉弱訊號。`;
    else if (cur.k > 80) kdText = `KD 處於超買區（K=${cur.k.toFixed(1)}），留意過熱風險。`;
    else if (cur.k < 20) kdText = `KD 處於超賣區（K=${cur.k.toFixed(1)}），留意反彈機會。`;
    else kdText = `KD 中性（K=${cur.k.toFixed(1)}, D=${cur.d.toFixed(1)}），未出現明確訊號。`;
  }

  const macdPoints = macd(data);
  let macdText = 'MACD 資料不足。';
  if (macdPoints.length >= 2) {
    const cur = macdPoints[macdPoints.length - 1];
    const prev = macdPoints[macdPoints.length - 2];
    if (prev.hist <= 0 && cur.hist > 0) macdText = 'MACD 柱狀圖翻紅，短線動能轉強。';
    else if (prev.hist >= 0 && cur.hist < 0) macdText = 'MACD 柱狀圖翻綠，短線動能轉弱。';
    else macdText = cur.hist > 0 ? 'MACD 柱狀圖維持在零軸之上，動能偏多。' : 'MACD 柱狀圖維持在零軸之下，動能偏空。';
  }

  const rsiPoints = rsi(data, 14);
  let rsiText = 'RSI 資料不足。';
  if (rsiPoints.length) {
    const cur = rsiPoints[rsiPoints.length - 1].value;
    if (cur > 70) rsiText = `RSI 處於超買區間（${cur.toFixed(1)}）。`;
    else if (cur < 30) rsiText = `RSI 處於超賣區間（${cur.toFixed(1)}）。`;
    else rsiText = `RSI 為中性區間（${cur.toFixed(1)}）。`;
  }

  const text = `${titleText}　${last.date}\n收盤 ${price.toFixed(2)}\n\n【均線】${maText}\n【布林通道】${bollText}\n【KD】${kdText}\n【MACD】${macdText}\n【RSI】${rsiText}`;
  document.getElementById('commentaryText').textContent = text;
  window._commentaryText = text;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    el.className = 'toast hidden';
  }, 2500);
}

async function main() {
  renderPatterns();

  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const name = params.get('name') || code;
  const titleText = code ? `${name} (${code})` : '未指定股票';
  document.getElementById('stockTitle').textContent = titleText;

  document.getElementById('copyCommentaryBtn').addEventListener('click', () => {
    navigator.clipboard
      .writeText(window._commentaryText || '')
      .then(() => showToast('已複製到剪貼簿'))
      .catch(() => showToast('複製失敗'));
  });

  if (!code) {
    document.getElementById('commentaryText').textContent = '請從主頁面點選股票旁的 📊 按鈕進入本頁面。';
    return;
  }

  const [historyRes, quoteRes] = await Promise.all([
    fetch(`/api/history?codes=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .catch(() => ({})),
    fetch(`/api/quote?ex_ch=tse_${encodeURIComponent(code)}.tw`)
      .then((r) => r.json())
      .catch(() => null),
  ]);

  if (quoteRes && quoteRes.msgArray && quoteRes.msgArray[0]) {
    const raw = quoteRes.msgArray[0];
    const priceStr = raw.z && raw.z !== '-' ? raw.z : raw.y;
    const price = parseFloat(priceStr);
    document.getElementById('stockPrice').textContent = isNaN(price) ? '--' : price.toFixed(2);
  }

  const data = (historyRes[code] || []).filter((d) => d.open !== undefined && d.high !== undefined && d.low !== undefined);

  if (data.length < 20) {
    document.getElementById('commentaryText').textContent =
      `目前只有 ${data.length} 天可用的完整K線資料，技術指標至少需要 20 天以上才有參考價值。請回主頁點「📅」補齊歷史資料（若之前補過的是舊版只有收盤價的資料，需要重新補一次才會有完整開高低收）。`;
    return;
  }

  renderCharts(data);
  renderCommentary(data, titleText);
}

document.addEventListener('DOMContentLoaded', main);
