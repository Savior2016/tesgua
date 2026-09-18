/* ===== TESLA Home 演示页:虚拟数据 + 分页切换动效演示 =====
 * 无任何后端请求;图表数据由本地随机生成,仅用于预览界面与动效。 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------- 虚拟数据生成 ---------- */
  // 固定种子的伪随机,保证每次打开看到同一组"合理"数据
  let seed = 20260918;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const between = (a, b) => a + rnd() * (b - a);

  function lastDays(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return out;
  }

  /* ---------- 图表(懒初始化:隐藏页尺寸为 0,首次显示时才 init) ---------- */
  const charts = {};           // id → echarts 实例
  const chartPages = {         // 图表所在分页 → 构建函数
    charging: buildCharging,
    drives: buildDaily,
    activity: buildSentry,
    vehicle: buildVehicle,
  };
  const built = new Set();

  function baseAxis() {
    return {
      axisLine: { lineStyle: { color: cssVar('--border') } },
      axisLabel: { color: cssVar('--text-muted'), fontSize: 11 },
      splitLine: { lineStyle: { color: cssVar('--border'), type: 'dashed' } },
      axisTick: { show: false },
    };
  }
  const baseTooltip = () => ({
    trigger: 'axis',
    backgroundColor: cssVar('--surface-1'),
    borderColor: cssVar('--border'),
    textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
  });

  function makeChart(id, option) {
    const el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].dispose();
    charts[id] = echarts.init(el);
    charts[id].setOption(option);
  }

  function buildCharging() {
    const days = lastDays(14).filter(() => rnd() > 0.45);
    makeChart('d-chart-charging', {
      tooltip: baseTooltip(),
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: { type: 'category', data: days, ...baseAxis() },
      yAxis: { type: 'value', name: 'kWh', nameTextStyle: { color: cssVar('--text-muted') }, ...baseAxis() },
      series: [{
        type: 'bar', barMaxWidth: 26,
        data: days.map(() => Math.round(between(18, 52) * 10) / 10),
        itemStyle: { color: cssVar('--series-1'), borderRadius: [5, 5, 0, 0] },
      }],
    });
  }

  function buildDaily() {
    const days = lastDays(14);
    makeChart('d-chart-daily', {
      tooltip: baseTooltip(),
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: { type: 'category', data: days, ...baseAxis() },
      yAxis: { type: 'value', name: 'km', nameTextStyle: { color: cssVar('--text-muted') }, ...baseAxis() },
      series: [{
        type: 'bar', barMaxWidth: 22,
        data: days.map(() => Math.round(between(8, 96))),
        itemStyle: { color: cssVar('--cat-drive'), borderRadius: [5, 5, 0, 0] },
      }],
    });
  }

  function buildSentry() {
    const days = lastDays(14);
    makeChart('d-chart-sentry', {
      tooltip: baseTooltip(),
      grid: { left: 44, right: 12, top: 18, bottom: 26 },
      xAxis: { type: 'category', data: days, ...baseAxis() },
      yAxis: { type: 'value', name: 'kWh', nameTextStyle: { color: cssVar('--text-muted') }, ...baseAxis() },
      series: [{
        type: 'bar', barMaxWidth: 20,
        data: days.map(() => Math.round(between(0.4, 3.2) * 10) / 10),
        itemStyle: { color: cssVar('--cat-sentry'), borderRadius: [5, 5, 0, 0] },
      }],
    });
  }

  function buildVehicle() {
    const hours = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
    const mk = (base, amp) => hours.map((_, i) =>
      Math.round((base + Math.sin(i / 7 + base) * amp + between(-0.05, 0.05)) * 100) / 100);
    const line = (name, color, data) => ({
      name, type: 'line', data, showSymbol: false, smooth: true, smoothMonotone: 'x',
      lineStyle: { width: 2, color }, itemStyle: { color },
    });
    const ax = baseAxis();
    makeChart('d-chart-tpms', {
      tooltip: baseTooltip(),
      legend: { textStyle: { color: cssVar('--text-secondary'), fontSize: 11 }, top: 0 },
      grid: { left: 40, right: 12, top: 30, bottom: 26 },
      xAxis: { type: 'category', data: hours, ...ax },
      yAxis: { type: 'value', name: 'bar', min: 2.5, max: 3.1, nameTextStyle: { color: cssVar('--text-muted') }, ...ax },
      series: [
        line('左前', cssVar('--series-1'), mk(2.86, 0.07)),
        line('右前', cssVar('--series-2'), mk(2.9, 0.06)),
        line('左后', cssVar('--series-3'), mk(2.88, 0.07)),
        line('右后', cssVar('--series-4') || '#9085e9', mk(2.84, 0.06)),
      ],
    });
    makeChart('d-chart-temp', {
      tooltip: baseTooltip(),
      legend: { textStyle: { color: cssVar('--text-secondary'), fontSize: 11 }, top: 0 },
      grid: { left: 40, right: 12, top: 30, bottom: 26 },
      xAxis: { type: 'category', data: hours, ...ax },
      yAxis: { type: 'value', name: '°C', nameTextStyle: { color: cssVar('--text-muted') }, ...ax },
      series: [
        line('车内', cssVar('--series-2'), mk(29, 6)),
        line('车外', cssVar('--series-1'), mk(27, 5)),
      ],
    });
  }

  function ensureCharts(page) {
    const fn = chartPages[page];
    if (fn && !built.has(page)) { built.add(page); fn(); }
    Object.values(charts).forEach((c) => {
      const sec = document.getElementById('page-' + page);
      if (c && sec && sec.contains(c.getDom())) c.resize();
    });
  }

  /* ---------- 分页切换:与正式面板同一套 TTVPageTurn 动效 ---------- */
  const PAGE_IDS = ['overview', 'charging', 'drives', 'activity', 'vehicle', 'control'];
  let tabSeq = 0;

  function placeTabBubble(animate) {
    const btn = $('#tabbar .tab.on');
    const bubble = $('#tab-bubble');
    if (!btn || !bubble) return;
    if (window.TTVPageTurn?.isDragging()) return;  // 拖动中气泡跟随手指,松手时才吸附
    if (animate && window.TTVPageTurn) TTVPageTurn.slideBubble(bubble, btn);
    else {
      bubble.style.left = btn.offsetLeft + 'px';
      bubble.style.width = btn.offsetWidth + 'px';
      bubble.classList.remove('no-anim');
    }
  }

  function switchTab(name, animate) {
    if (!PAGE_IDS.includes(name)) name = 'overview';
    const cur = $('.page.active');
    const nxt = document.getElementById('page-' + name);
    const setTabs = () => $$('.tabbar .tab').forEach((t) => {
      const on = t.dataset.page === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const show = () => {
      $$('.page').forEach((p) => p.classList.toggle('active', p === nxt));
      window.scrollTo(0, 0);
      requestAnimationFrame(() => ensureCharts(name));
    };
    if (animate && cur && nxt && cur !== nxt && window.TTVPageTurn) {
      const seq = ++tabSeq;
      setTabs();
      placeTabBubble(true);
      TTVPageTurn.exit(cur).then(() => {
        if (seq !== tabSeq) return;
        show();
        TTVPageTurn.enter(nxt);
      });
      return;
    }
    show();
    setTabs();
    placeTabBubble(false);
  }

  /* ---------- 主题切换(与正式面板同一套令牌) ---------- */
  function applyThemeBtn() {
    const dark = document.documentElement.dataset.theme !== 'light';
    $('#theme-btn').textContent = dark ? '☀ 浅色' : '☾ 深色';
  }
  $('#theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ttv-theme', next);
    applyThemeBtn();
    // 图表颜色取自 CSS 变量,主题变化后重建
    const active = ($('.page.active') || {}).id || '';
    const page = active.replace('page-', '');
    built.delete(page);
    if (chartPages[page]) { built.add(page); chartPages[page](); }
  });

  /* ---------- 控制页演示开关:只切换外观,toast 提示不会下发 ---------- */
  let toastTimer = 0;
  function toast(text) {
    const t = $('#demo-toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }
  $$('.demo-switch').forEach((sw) => {
    sw.addEventListener('click', () => {
      sw.classList.toggle('on');
      const on = sw.classList.contains('on');
      const small = sw.closest('.demo-tile').querySelector('small');
      if (sw.dataset.label === '车锁') small.textContent = on ? '已解锁' : '已锁定';
      toast(`演示模式:${sw.dataset.label}「${on ? '开' : '关'}」不会下发到车辆`);
    });
  });

  /* ---------- 启动 ---------- */
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) switchTab(b.dataset.page, true);
  });
  // Tab 栏横向拖动选择页面
  window.TTVPageTurn?.enableTabDrag($('#tabbar'), (p) => switchTab(p, true));
  window.addEventListener('resize', () => {
    Object.values(charts).forEach((c) => c && c.resize());
    placeTabBubble(false);
  });
  applyThemeBtn();
  switchTab('overview', false);
})();
