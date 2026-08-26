class StockApp {
  constructor() {
    this.data = [];
    this.isRefreshing = false;
    this.anchorValues = {};
    this.firstLoad = true;
    this.elements = {
      stockList: document.getElementById('stockList'),
      lastUpdate: document.getElementById('lastUpdate'),
      refreshBtn: document.getElementById('refreshBtn'),
      skillModal: document.getElementById('skillModal'),
      closeSkillModal: document.getElementById('closeSkillModal'),
      skillText: document.getElementById('skillText'),
      saveSkillBtn: document.getElementById('saveSkillBtn'),
      toast: document.getElementById('toast'),
      loadingOverlay: document.getElementById('loadingOverlay'),
    };
    this.init();
  }

  init() {
    this.elements.refreshBtn.addEventListener('click', () => this.refresh());
    this.elements.closeSkillModal.addEventListener('click', () => this.closeSkillModal());
    this.elements.saveSkillBtn.addEventListener('click', () => this.saveSkill());
    this.elements.skillModal.addEventListener('click', (e) => {
      if (e.target === this.elements.skillModal) this.closeSkillModal();
    });
    this.elements.skillText.value = skillText;
    this.refresh();
    setInterval(() => this.refresh(), 5000);
  }

  async refresh() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    if (this.firstLoad) {
      this.elements.loadingOverlay.classList.remove('hidden');
    }
    try {
      const results = await fetchBatch(WATCHLIST);
      this.data = results;
      this.render(results);
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
    let anchorProfit = null;
    let anchorClass = 'flat';
    let anchorDisplay = '--';
    if (anchor !== null && anchor !== undefined && p > 0) {
      const profit = p - anchor;
      anchorProfit = profit;
      anchorDisplay = (profit > 0 ? '+' : '') + profit.toFixed(2);
      anchorClass = profit > 0 ? 'profit' : profit < 0 ? 'loss' : 'flat';
    }

    const ma5 = stock.ma5 || p;
    const ma10 = stock.ma10 || p;
    const ma20 = stock.ma20 || p;

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

    const source = stock.source || 'TWSE';
    const timeStr = stock.time || '--:--:--';
    const dateStr = stock.date || '';

    div.innerHTML = `
            <span class="quote-stock-cell">
                <strong>${stock.name}</strong>
                <span class="sub">${stock.code}</span>
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
                    <span class="vol-est">估 ${fmt(Math.round(v * 6))}</span>
                    <span class="volume-signal ${volSignal}">${volText}</span>
                </span>
                <span class="volume-split-bar">
                    <i class="buy-bar" style="width:${innerPct}%"></i>
                    <i class="sell-bar" style="width:${outerPct}%"></i>
                </span>
               <span class="volume-flow-grid">
                    <span><span class="buy-text">買 ${inner}筆</span> <small>${innerPct.toFixed(0)}%</small></span>
                    <span><span class="sell-text">賣 ${outer}筆</span> <small>${outerPct.toFixed(0)}%</small></span>
                </span>
            </span>
            <span class="quote-ma-cell">
                <div class="ma-line"><span class="ma-label">5日</span><span class="ma-value ${p > ma5 ? 'ma-up' : 'ma-down'}">${ma5.toFixed(2)}</span></div>
                <div class="ma-line"><span class="ma-label">10日</span><span class="ma-value ${p > ma10 ? 'ma-up' : 'ma-down'}">${ma10.toFixed(2)}</span></div>
                <div class="ma-line"><span class="ma-label">20日</span><span class="ma-value ${p > ma20 ? 'ma-up' : 'ma-down'}">${ma20.toFixed(2)}</span></div>
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
                <button class="btn-skill" id="openSkillBtn" title="設定Skill">⚙️</button>
                <a class="btn-yahoo" href="https://tw.stock.yahoo.com/quote/${code}.TW" target="_blank" rel="noreferrer" title="Yahoo">Y</a>
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
    const ma5 = stock.ma5 || p;
    const ma10 = stock.ma10 || p;
    const ma20 = stock.ma20 || p;
    const anchorProfit = anchor !== null ? p - anchor : null;

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
    text = text.replace(/{ma5}/g, ma5.toFixed(2));
    text = text.replace(/{ma10}/g, ma10.toFixed(2));
    text = text.replace(/{ma20}/g, ma20.toFixed(2));
    text = text.replace(/{anchor}/g, anchor !== null ? anchor.toFixed(2) : '未設定');
    text = text.replace(/{anchorProfit}/g, anchorProfit !== null ? (anchorProfit > 0 ? '+' : '') + anchorProfit.toFixed(2) : '--');
    text = text.replace(/{date}/g, stock.date || '');
    text = text.replace(/{time}/g, stock.time || '');
    text = text.replace(/{source}/g, stock.source || 'TWSE');

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
