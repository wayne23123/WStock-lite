class StockApp {
  constructor() {
    this.data = [];
    this.isRefreshing = false;
    this.anchorValues = {};
    this.firstLoad = true;
    this.lastPrices = {};

    const savedPrices = localStorage.getItem('lastPrices');
    if (savedPrices) {
      try {
        this.lastPrices = JSON.parse(savedPrices);
      } catch (e) {
        this.lastPrices = {};
      }
    }

    this.elements = {
      stockList: document.getElementById('stockList'),
      moversStrip: document.getElementById('moversStrip'),
      lastUpdate: document.getElementById('lastUpdate'),
      refreshBtn: document.getElementById('refreshBtn'),
      clearCacheBtn: document.getElementById('clearCacheBtn'),
      skillModal: document.getElementById('skillModal'),
      closeSkillModal: document.getElementById('closeSkillModal'),
      skillText: document.getElementById('skillText'),
      saveSkillBtn: document.getElementById('saveSkillBtn'),
      toast: document.getElementById('toast'),
      loadingOverlay: document.getElementById('loadingOverlay'),
      institutionalBtn: document.getElementById('institutionalBtn'),
      institutionalModal: document.getElementById('institutionalModal'),
      closeInstitutionalModal: document.getElementById('closeInstitutionalModal'),
      institutionalBody: document.getElementById('institutionalBody'),
      historyBtn: document.getElementById('historyBtn'),
      historyModal: document.getElementById('historyModal'),
      closeHistoryModal: document.getElementById('closeHistoryModal'),
      historyStart: document.getElementById('historyStart'),
      historyEnd: document.getElementById('historyEnd'),
      startBackfillBtn: document.getElementById('startBackfillBtn'),
      historyStatus: document.getElementById('historyStatus'),
    };

    this.init();
  }

  init() {
    this.elements.refreshBtn.addEventListener('click', () => this.refresh());
    this.elements.clearCacheBtn.addEventListener('click', () => this.clearCache());
    this.elements.closeSkillModal.addEventListener('click', () => this.closeSkillModal());
    this.elements.saveSkillBtn.addEventListener('click', () => this.saveSkill());
    this.elements.skillModal.addEventListener('click', (e) => {
      if (e.target === this.elements.skillModal) this.closeSkillModal();
    });
    this.elements.skillText.value = skillText;

    this.elements.institutionalBtn.addEventListener('click', () => this.openInstitutionalModal());
    this.elements.closeInstitutionalModal.addEventListener('click', () => this.elements.institutionalModal.classList.add('hidden'));
    this.elements.institutionalModal.addEventListener('click', (e) => {
      if (e.target === this.elements.institutionalModal) this.elements.institutionalModal.classList.add('hidden');
    });

    this.elements.historyBtn.addEventListener('click', () => this.openHistoryModal());
    this.elements.closeHistoryModal.addEventListener('click', () => this.elements.historyModal.classList.add('hidden'));
    this.elements.historyModal.addEventListener('click', (e) => {
      if (e.target === this.elements.historyModal) this.elements.historyModal.classList.add('hidden');
    });
    this.elements.startBackfillBtn.addEventListener('click', () => this.startBackfill());

    this.refresh();
    setInterval(() => this.refresh(), 5000);
  }

  getEstimateMultiplier() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const totalMinutes = h * 60 + m;
    const start = 9 * 60;
    const end = 13 * 60 + 30;
    const elapsed = Math.max(0, Math.min(totalMinutes - start, end - start));
    const total = end - start;
    const ratio = elapsed / total;
    return Math.max(1, 1 + (6 - 1) * (1 - ratio));
  }

  clearCache() {
    localStorage.removeItem('institutionalCache');
    localStorage.removeItem('marginCache');
    institutionalCache = {};
    marginCache = {};
    dailyFetchDone = {};
    this.showToast('快取已清除，重新抓取中...');
    this.refresh();
  }

  async openInstitutionalModal() {
    const cellClass = (v) => (v > 0 ? 'profit' : v < 0 ? 'loss' : 'flat');
    const cellText = (v) => (v > 0 ? '+' : '') + v.toLocaleString();

    const watchRows = WATCHLIST.map((s) => {
      const key = `${s.code}_${getTodayStr()}`;
      const d = institutionalCache[key];
      if (!d) {
        return `<tr><td>${s.name}<span class="sub">${s.code}</span></td><td colspan="4" class="inst-empty">尚無資料</td></tr>`;
      }
      const total = d.foreign + d.investment + d.dealer;
      return `<tr>
        <td>${s.name}<span class="sub">${s.code}</span></td>
        <td class="${cellClass(d.foreign)}">${cellText(d.foreign)}</td>
        <td class="${cellClass(d.investment)}">${cellText(d.investment)}</td>
        <td class="${cellClass(d.dealer)}">${cellText(d.dealer)}</td>
        <td class="${cellClass(total)}">${cellText(total)}</td>
      </tr>`;
    }).join('');

    this.elements.institutionalBody.innerHTML = `
      <table class="inst-table">
        <thead>
          <tr><th>股票</th><th>外資</th><th>投信</th><th>自營商</th><th>合計</th></tr>
        </thead>
        <tbody>${watchRows}</tbody>
      </table>
      <div class="inst-note">單位：張。收盤前顯示的是最近一個已公布交易日的資料。</div>
      <div class="inst-ranking-section" id="instRankingSection">
        <div class="inst-ranking-loading">全市場排行載入中...</div>
      </div>
    `;
    this.elements.institutionalModal.classList.remove('hidden');

    const market = await fetchMarketInstitutionalData();
    const rankingSection = document.getElementById('instRankingSection');
    if (!rankingSection) return;
    if (!market) {
      rankingSection.innerHTML = `<div class="inst-ranking-loading">全市場排行暫時無法取得</div>`;
      return;
    }
    const rankRow = (r) => `<tr><td>${r.name}<span class="sub">${r.code}</span></td><td class="${cellClass(r.total)}">${cellText(r.total)}</td></tr>`;
    rankingSection.innerHTML = `
      <div class="inst-ranking-col">
        <div class="inst-ranking-title">買超排行 Top ${market.buyRanking.length}</div>
        <div class="inst-ranking-scroll">
          <table class="inst-table inst-ranking-table"><tbody>${market.buyRanking.map(rankRow).join('')}</tbody></table>
        </div>
      </div>
      <div class="inst-ranking-col">
        <div class="inst-ranking-title">賣超排行 Top ${market.sellRanking.length}</div>
        <div class="inst-ranking-scroll">
          <table class="inst-table inst-ranking-table"><tbody>${market.sellRanking.map(rankRow).join('')}</tbody></table>
        </div>
      </div>
    `;
  }

  async openHistoryModal() {
    this.elements.historyStatus.textContent = '計算建議日期範圍中...';
    this.elements.historyModal.classList.remove('hidden');

    const codes = WATCHLIST.map((s) => s.code);
    const history = await fetchHistoryData(codes);
    const todayStr = new Date().toISOString().slice(0, 10);

    const lastDates = codes.map((c) => {
      const closes = history[c] || [];
      return closes.length ? closes[closes.length - 1].date : null;
    });

    let suggestedStart;
    let statusText;
    if (lastDates.some((d) => !d)) {
      const d = new Date();
      d.setDate(d.getDate() - 100);
      suggestedStart = d.toISOString().slice(0, 10);
      statusText = '尚無歷史資料，已建議補最近 100 天（涵蓋 60 日均線所需天數）';
    } else {
      const earliestLast = lastDates.slice().sort()[0];
      const y = earliestLast.slice(0, 4);
      const m = earliestLast.slice(4, 6);
      const day = earliestLast.slice(6, 8);
      const d = new Date(`${y}-${m}-${day}`);
      d.setDate(d.getDate() + 1);
      suggestedStart = d.toISOString().slice(0, 10);
      statusText = suggestedStart > todayStr ? '資料已是最新，可視需要調整日期範圍再補' : '已自動接續上次補到的日期，可視需要調整';
    }
    if (suggestedStart > todayStr) {
      suggestedStart = todayStr;
    }

    this.elements.historyEnd.value = todayStr;
    this.elements.historyStart.value = suggestedStart;
    this.elements.historyStatus.textContent = statusText;
  }

  async startBackfill() {
    const start = this.elements.historyStart.value.replace(/-/g, '');
    const end = this.elements.historyEnd.value.replace(/-/g, '');
    if (!start || !end) {
      this.elements.historyStatus.textContent = '請選擇日期範圍';
      return;
    }
    this.elements.startBackfillBtn.disabled = true;
    this.elements.historyStatus.textContent = '補資料中，請稍候...（依股票數與日期範圍，可能需要數十秒）';
    try {
      const res = await fetch('/api/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: WATCHLIST.map((s) => s.code), start, end }),
      });
      const data = await res.json();
      if (data.ok) {
        this.elements.historyStatus.textContent = `完成，共發出 ${data.requestCount} 次請求`;
        this.showToast('均線資料補齊完成');
      } else {
        this.elements.historyStatus.textContent = `失敗：${data.error}`;
      }
    } catch (e) {
      this.elements.historyStatus.textContent = '失敗：連線錯誤';
    } finally {
      this.elements.startBackfillBtn.disabled = false;
    }
  }

  async refresh() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    if (this.firstLoad) {
      this.elements.loadingOverlay.classList.remove('hidden');
    }
    try {
      const results = await fetchBatch(WATCHLIST);
      const history = await fetchHistoryData(WATCHLIST.map((s) => s.code));

      for (const stock of results) {
        const code = String(stock.code);
        const last = this.lastPrices[code];
        const closes = history[code] || [];
        stock.ma5 = computeMA(closes, 5);
        stock.ma10 = computeMA(closes, 10);
        stock.ma20 = computeMA(closes, 20);
        stock.ma60 = computeMA(closes, 60);

        if (stock.hasTrade === true) {
          this.lastPrices[code] = {
            price: stock.price,
            change: stock.change,
            changePercent: stock.changePercent,
          };
        } else if (last) {
          stock.price = last.price;
          stock.change = last.change;
          stock.changePercent = last.changePercent;
        } else {
          this.lastPrices[code] = {
            price: stock.price,
            change: stock.change,
            changePercent: stock.changePercent,
          };
        }

        const instKey = `${code}_${getTodayStr()}`;
        if (institutionalCache[instKey]) {
          stock.instData = institutionalCache[instKey];
        }

        const marginKey = `${code}_${getTodayStr()}`;
        if (marginCache[marginKey]) {
          stock.marginData = marginCache[marginKey];
        }
      }

      localStorage.setItem('lastPrices', JSON.stringify(this.lastPrices));
      this.data = results;
      this.render(results);
      this.renderMoversStrip(results);
      const now = new Date();
      this.elements.lastUpdate.textContent = now.toTimeString().slice(0, 8);
      if (this.firstLoad) {
        this.firstLoad = false;
        this.elements.loadingOverlay.classList.add('hidden');
      }
    } catch (e) {
      console.error(e);
      if (this.firstLoad) {
        this.elements.loadingOverlay.classList.add('hidden');
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  renderMoversStrip(data) {
    const MOVER_THRESHOLD = 2;
    const movers = data
      .filter((s) => Math.abs(s.changePercent || 0) >= MOVER_THRESHOLD)
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    const container = this.elements.moversStrip;
    if (!movers.length) {
      container.innerHTML = '';
      container.classList.add('hidden');
      return;
    }
    container.classList.remove('hidden');
    container.innerHTML = movers
      .map((s) => {
        const dir = s.changePercent > 0 ? 'up' : 'down';
        const sign = s.changePercent > 0 ? '+' : '';
        return `<span class="mover-chip ${dir}">${s.name} ${sign}${s.changePercent.toFixed(1)}%</span>`;
      })
      .join('');
  }

  render(data) {
    const container = this.elements.stockList;
    container.innerHTML = '';
    data.forEach((stock) => {
      const row = this.createRow(stock);
      container.appendChild(row);
    });
  }

  createRow(stock) {
    const div = document.createElement('div');
    const p = stock.price || 0;
    const chg = stock.change || 0;
    const chgPct = stock.changePercent || 0;
    const v = stock.volume || 0;
    const inner = stock.innerVolume || 0;
    const outer = stock.outerVolume || 0;
    const total = inner + outer;
    const innerPct = total > 0 ? (inner / total) * 100 : 50;
    const outerPct = total > 0 ? (outer / total) * 100 : 50;
    const dir = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
    div.className = `quote-row ${dir}`;

    const code = String(stock.code);
    const anchor = this.anchorValues[code] || null;
    let anchorClass = 'flat';
    let anchorDisplay = '--';
    if (anchor !== null && anchor !== undefined && p > 0) {
      const profit = p - anchor;
      anchorDisplay = (profit > 0 ? '+' : '') + profit.toFixed(2);
      anchorClass = profit > 0 ? 'profit' : profit < 0 ? 'loss' : 'flat';
    }

    const maLine = (label, value) => {
      if (value === null || value === undefined) {
        return `<div class="ma-line"><span class="ma-label">${label}</span><span class="ma-value flat">--</span></div>`;
      }
      const cls = p > value ? 'ma-up' : 'ma-down';
      return `<div class="ma-line"><span class="ma-label">${label}</span><span class="ma-value ${cls}">${value.toFixed(2)}</span></div>`;
    };

    const avgVol = 65000;
    const ratio = avgVol > 0 ? v / avgVol : 1;
    let volSignal = 'normal';
    let volText = '正常';
    if (ratio > 1.5) {
      volSignal = 'danger';
      volText = '爆量';
    } else if (ratio > 1.1) {
      volSignal = 'warning';
      volText = '量增';
    }

    const multiplier = this.getEstimateMultiplier();
    const estVolume = Math.round(v * multiplier);

    const source = stock.source || 'TWSE';
    const timeStr = stock.time || '--:--:--';
    const dateStr = stock.date || '';

    const HINT_THRESHOLD = 500;
    let hintTag = '';
    if (stock.instData) {
      const instTotal = stock.instData.foreign + stock.instData.investment + stock.instData.dealer;
      if (instTotal > HINT_THRESHOLD) {
        hintTag = dir === 'down' ? '<span class="hint-tag profit">逢低承接</span>' : '<span class="hint-tag profit">大家在買</span>';
      } else if (instTotal < -HINT_THRESHOLD) {
        hintTag = dir === 'up' ? '<span class="hint-tag loss">高檔套現</span>' : '<span class="hint-tag loss">大家在賣</span>';
      }
    }

    div.innerHTML = `
            <span class="quote-stock-cell">
                <strong>${stock.name}</strong>
                <span class="sub">${stock.code}</span>
                ${hintTag}
            </span>
            <span class="quote-price-cell">
                <span class="price ${dir}">${p.toFixed(2)}</span>
                <span class="label">成交</span>
            </span>
            <span class="quote-change-cell">
                <span class="change ${dir}">${chg > 0 ? '+' : ''}${chg.toFixed(2)}</span>
                <span class="percent ${dir}">${chg > 0 ? '+' : ''}${chgPct.toFixed(2)}%</span>
            </span>
            <span class="quote-volume-cell">
                <span class="volume-topline">
                    <span class="vol">${fmt(v)}</span>
                    <span class="vol-est">估 ${fmt(estVolume)}</span>
                    <span class="volume-signal ${volSignal}">${volText}</span>
                </span>
                <span class="volume-split-bar">
                    <i class="buy-bar" style="width:${innerPct}%"></i>
                    <i class="sell-bar" style="width:${outerPct}%"></i>
                </span>
                <span class="volume-flow-grid">
                    <span><span class="buy-text">買 ${fmt(inner)}</span> <small>${innerPct.toFixed(0)}%</small></span>
                    <span><span class="sell-text">賣 ${fmt(outer)}</span> <small>${outerPct.toFixed(0)}%</small></span>
                    <span class="est-label">買賣比數（推估）</span>
                </span>
            </span>
            <span class="quote-ma-cell">
                ${maLine('5日', stock.ma5)}
                ${maLine('10日', stock.ma10)}
                ${maLine('20日', stock.ma20)}
                ${maLine('60日', stock.ma60)}
            </span>
            <span class="quote-profit-cell">
                <input class="anchor-input" type="number" step="0.01" placeholder="錨點" data-code="${code}" value="${anchor !== null ? anchor.toFixed(2) : ''}">
                <span class="anchor-profit ${anchorClass}">${anchorDisplay}</span>
            </span>
            <span class="quote-time-cell">
                <span>${dateStr} ${timeStr}</span>
                <span class="source-badge">${source}</span>
            </span>
            <span class="quote-action-cell">
                <button class="btn-ai" data-code="${code}" data-name="${stock.name}" title="複製給AI">📋</button>
                <button class="btn-skill" title="設定Skill">⚙️</button>
                <a class="btn-yahoo" href="https://tw.stock.yahoo.com/quote/${code}.TW" target="_blank" rel="noreferrer" title="Yahoo">Y</a>
                <a class="btn-analysis" href="analysis.html?code=${code}&name=${encodeURIComponent(stock.name)}" target="_blank" rel="noreferrer" title="技術分析">📊</a>
            </span>
        `;

    const anchorInput = div.querySelector('.anchor-input');
    anchorInput.addEventListener('change', (e) => {
      const val = parseFloat(e.target.value);
      const code2 = e.target.dataset.code;
      if (!isNaN(val) && val > 0) {
        this.anchorValues[code2] = val;
      } else {
        delete this.anchorValues[code2];
      }
      this.updateAnchorDisplay(div, stock);
    });

    const aiBtn = div.querySelector('.btn-ai');
    aiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code2 = aiBtn.dataset.code;
      const target = this.data.find((s) => String(s.code) === String(code2));
      if (target) this.copyToAI(target);
    });

    const skillBtn = div.querySelector('.btn-skill');
    skillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openSkillModal();
    });

    return div;
  }

  updateAnchorDisplay(div, stock) {
    const code = String(stock.code);
    const anchor = this.anchorValues[code] || null;
    const p = stock.price || 0;
    const profitSpan = div.querySelector('.anchor-profit');
    if (anchor !== null && anchor !== undefined && p > 0) {
      const profit = p - anchor;
      const cls = profit > 0 ? 'profit' : profit < 0 ? 'loss' : 'flat';
      profitSpan.className = `anchor-profit ${cls}`;
      profitSpan.textContent = (profit > 0 ? '+' : '') + profit.toFixed(2);
    } else {
      profitSpan.className = 'anchor-profit flat';
      profitSpan.textContent = '--';
    }
  }

  copyToAI(stock) {
    const code = String(stock.code);
    const anchor = this.anchorValues[code] || null;
    const p = stock.price || 0;
    const inner = stock.innerVolume || 0;
    const outer = stock.outerVolume || 0;
    const total = inner + outer;
    const innerPct = total > 0 ? (inner / total) * 100 : 50;
    const outerPct = total > 0 ? (outer / total) * 100 : 50;
    const maText = (v) => (v === null || v === undefined ? '--' : v.toFixed(2));
    const anchorProfit = anchor !== null ? p - anchor : null;
    const open = stock.open || 0;
    const high = stock.high || 0;
    const low = stock.low || 0;
    const prevClose = stock.prevClose || 0;

    let instText = '--';
    const instKey = `${code}_${getTodayStr()}`;
    if (institutionalCache[instKey]) {
      const d = institutionalCache[instKey];
      const f = d.foreign > 0 ? '+' + fmt(d.foreign) : fmt(d.foreign);
      const inv = d.investment > 0 ? '+' + fmt(d.investment) : fmt(d.investment);
      const dea = d.dealer > 0 ? '+' + fmt(d.dealer) : fmt(d.dealer);
      instText = `外資 ${f} 張 / 投信 ${inv} 張 / 自營商 ${dea} 張`;
    }

    let marginText = '--';
    const marginKey = `${code}_${getTodayStr()}`;
    if (marginCache[marginKey]) {
      const d = marginCache[marginKey];
      const mb = d.marginBuy > 0 ? '+' + fmt(d.marginBuy) : fmt(d.marginBuy);
      const ms = d.marginSell > 0 ? '+' + fmt(d.marginSell) : fmt(d.marginSell);
      const sb = d.shortBuy > 0 ? '+' + fmt(d.shortBuy) : fmt(d.shortBuy);
      const ss = d.shortSell > 0 ? '+' + fmt(d.shortSell) : fmt(d.shortSell);
      marginText = `融資 ${mb} 張（餘額 ${fmt(d.marginBalance)} 張） / 融券 ${ss} 張（餘額 ${fmt(d.shortBalance)} 張）`;
    }

    let text = skillText;
    text = text.replace(/{name}/g, stock.name);
    text = text.replace(/{code}/g, stock.code);
    text = text.replace(/{price}/g, p.toFixed(2));
    text = text.replace(/{change}/g, (stock.change || 0).toFixed(2));
    text = text.replace(/{changePercent}/g, (stock.changePercent || 0).toFixed(2));
    text = text.replace(/{volume}/g, fmt(stock.volume || 0));
    text = text.replace(/{innerVolume}/g, fmt(inner));
    text = text.replace(/{outerVolume}/g, fmt(outer));
    text = text.replace(/{innerPercent}/g, innerPct.toFixed(0));
    text = text.replace(/{outerPercent}/g, outerPct.toFixed(0));
    text = text.replace(/{ma5}/g, maText(stock.ma5));
    text = text.replace(/{ma10}/g, maText(stock.ma10));
    text = text.replace(/{ma20}/g, maText(stock.ma20));
    text = text.replace(/{ma60}/g, maText(stock.ma60));
    text = text.replace(/{anchor}/g, anchor !== null ? anchor.toFixed(2) : '未設定');
    text = text.replace(/{anchorProfit}/g, anchorProfit !== null ? (anchorProfit > 0 ? '+' : '') + anchorProfit.toFixed(2) : '--');
    text = text.replace(/{open}/g, open.toFixed(2));
    text = text.replace(/{high}/g, high.toFixed(2));
    text = text.replace(/{low}/g, low.toFixed(2));
    text = text.replace(/{prevClose}/g, prevClose.toFixed(2));
    text = text.replace(/{institutional}/g, instText);
    text = text.replace(/{margin}/g, marginText);

    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.showToast('已複製到剪貼簿');
      })
      .catch(() => {
        this.showToast('複製失敗');
      });
  }

  openSkillModal() {
    this.elements.skillText.value = skillText;
    this.elements.skillModal.classList.remove('hidden');
  }

  closeSkillModal() {
    this.elements.skillModal.classList.add('hidden');
  }

  saveSkill() {
    const val = this.elements.skillText.value.trim();
    if (val) {
      skillText = val;
      localStorage.setItem('skillText', val);
      this.showToast('Skill 已儲存');
      this.closeSkillModal();
    } else {
      this.showToast('請輸入內容');
    }
  }

  showToast(msg) {
    const el = this.elements.toast;
    el.textContent = msg;
    el.className = 'toast show';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.className = 'toast hidden';
    }, 2500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new StockApp();
});
