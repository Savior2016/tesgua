/* TeslaMate 遥测面板前端逻辑 */
(function () {
  'use strict';

  const S = {
    carId: null,
    days: 7,
    theme: localStorage.getItem('ttv-theme') || 'dark',
    battMode: localStorage.getItem('ttv-batt-mode') || 'pct',
    carMode: localStorage.getItem('ttv-car-mode') || 'pct',
    overview: null,
    health: null,
    cycles: null,
    cycleIdx: 0,
    sessions: null,
    homeCharge: null,  // 家充设置(总开关 + 峰谷电价地点列表)
    delivery: null,   // 提车日期 YYYY-MM-DD(null = 未设置)
    timer: null,
  };

  const charts = {};
  const routeElev = {};  // 行程详情海拔图(行程 id → ECharts 实例),收起/重渲染时销毁
  const routeMaps = {};  // 行程 id → 详情小地图实例,同上
  const routeRows = {};  // 行程 id → 列表行 DOM(地图点选轨迹时定位展开用)
  const openRouteIds = new Set();  // 已展开的行程 id,60s 刷新重渲染后恢复展开状态
  let map = null;
  let mapFit = false;
  let mapInitPromise = null;
  const mapStyleCache = {};  // light/dark → 已改写资源 URL 的 MapLibre style JSON
  let routesBounds = null;   // 全部轨迹的视野范围(主题切换/首次显示时重算用)

  /* ---------- 工具 ---------- */

  const $ = (sel) => document.querySelector(sel);
  const cssVar = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // 窄屏(与 style.css 的 900px 断点一致):图表边距与触摸控件随之收紧/放大
  const isNarrow = () => window.matchMedia('(max-width: 900px)').matches;
  // 趋势图网格:桌面为末端数值标签多留右侧空间,窄屏收紧
  const trendGrid = (top) => ({
    left: 8, right: isNarrow() ? 24 : 40, top, bottom: 4, containLabel: true,
  });

  // 电量 ⇄ 里程换算:以最近一次上报的「额定续航 / 可用电量」推定满电续航,线性折算
  const kmFull = () => {
    const lat = S.overview && S.overview.latest;
    if (!lat) return null;
    const pct = Number(lat.usable_battery_level);
    const km = Number(lat.rated_battery_range_km);
    if (!(pct > 0) || !(km > 0)) return null;
    return km / pct * 100;
  };
  const kmAtPct = (pct) => {
    const f = kmFull();
    const p = Number(pct);
    if (f === null || p === null || isNaN(p)) return null;
    return f * p / 100;
  };
  // 电量百分比对应的里程提示,如「≈ 353 km」;无法折算时返回空串
  const kmSuffix = (pct) => {
    const km = kmAtPct(pct);
    return km === null ? '' : `≈ ${fmtNum(km, 0)} km`;
  };

  // 电量 ⇄ 度数(kWh)换算:kwh_per_pct 由后端按充电历史校准(充电量 ÷ 表显电量增幅)
  const kwhPerPct = () => {
    const v = S.overview ? Number(S.overview.kwh_per_pct) : NaN;
    return v > 0 ? v : null;
  };
  const kwhAtPct = (pct) => {
    const k = kwhPerPct();
    const p = Number(pct);
    if (k === null || p === null || isNaN(p)) return null;
    return k * p;
  };
  const kwhSuffix = (pct) => {
    const w = kwhAtPct(pct);
    return w === null ? '' : `≈ ${fmtNum(w, 1)} kWh`;
  };

  // 当前生效的电量维度:所选维度的换算数据缺失时自动回退 pct
  const battDim = () => {
    if (S.battMode === 'km' && kmFull() !== null) return 'km';
    if (S.battMode === 'kwh' && kwhPerPct() !== null) return 'kwh';
    return 'pct';
  };
  const BATT_SERIES_NAME = { pct: '电量', kwh: '剩余电量(折算)', km: '剩余里程(折算)' };
  const BATT_UNIT = { pct: '%', kwh: 'kWh', km: 'km' };
  // 电量值按当前维度格式化主单位(如「42%」「35.6 kWh」「353 km」)
  const battVal = (pct) => {
    const dim = battDim();
    if (dim === 'km') { const v = kmAtPct(pct); if (v !== null) return `${fmtNum(v, 0)} km`; }
    if (dim === 'kwh') { const v = kwhAtPct(pct); if (v !== null) return `${fmtNum(v, 1)} kWh`; }
    return `${fmtNum(pct, 0)}%`;
  };
  // 当前维度之外的其他维度提示,如「42% · ≈ 353 km」
  const battAlt = (pct) => {
    const p = Number(pct);
    if (pct === null || pct === undefined || isNaN(p)) return '';
    const dim = battDim();
    const parts = [];
    if (dim !== 'pct') parts.push(`${fmtNum(p, 0)}%`);
    if (dim !== 'kwh') { const w = kwhAtPct(p); if (w !== null) parts.push(`≈ ${fmtNum(w, 1)} kWh`); }
    if (dim !== 'km') { const m = kmAtPct(p); if (m !== null) parts.push(`≈ ${fmtNum(m, 0)} km`); }
    return parts.join(' · ');
  };
  // 电量曲线数据按当前维度换算(折算失败点剔除)
  const battSeriesData = (data) => {
    const dim = battDim();
    if (dim === 'pct') return data;
    const conv = dim === 'km' ? kmAtPct : kwhAtPct;
    return data.map(([t, p]) => [t, conv(p)]).filter((p) => p[1] !== null);
  };
  const battAxisMax = () => {
    const dim = battDim();
    if (dim === 'km') return Math.ceil(kmFull() / 100) * 100;
    if (dim === 'kwh') return Math.ceil(kwhAtPct(100) / 10) * 10;
    return 100;
  };

  // 电量曲线 tooltip 的双单位补充:主单位之外的其他维度
  const dualBatt = {
    '仪表电量': (v) => battAlt(v),
    '电量': (v) => battAlt(v),
    '剩余里程(折算)': (v) => {
      const f = kmFull();
      return !f ? '' : battAlt(v / f * 100);
    },
    '剩余电量(折算)': (v) => {
      const k = kwhPerPct();
      return !k ? '' : battAlt(v / k);
    },
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtNum = (n, d = 0) =>
    (n === null || n === undefined || isNaN(n)) ? '—'
      : Number(n).toLocaleString('zh-CN', {
          maximumFractionDigits: d, minimumFractionDigits: d });

  const fmtTime = (ms, withSec = false) => {
    if (ms === null || ms === undefined) return '—';
    const t = new Date(Number(ms));
    return t.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      second: withSec ? '2-digit' : undefined,
      hour12: false,
    }).replace(/\//g, '-');
  };

  const fmtClock = (ms) => {
    const t = new Date(Number(ms));
    return t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const localMidnight = (ms) => {
    const d = new Date(Number(ms));
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  const dayKey = (ms) => {
    const d = new Date(Number(ms));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const dayLabel = (ms) => {
    const d = new Date(Number(ms));
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日 · 周${wd}`;
  };

  // 活动分类:行驶 / 充电 / 哨兵 / 驻车耗电
  const CAT = {
    drive: { label: '行驶', cls: 'cat-drive', colorVar: '--cat-drive' },
    charge: { label: '充电', cls: 'cat-charge', colorVar: '--cat-charge' },
    sentry: { label: '哨兵', cls: 'cat-sentry', colorVar: '--cat-sentry' },
    idle: { label: '驻车耗电', cls: 'cat-idle', colorVar: '--cat-idle' },
  };

  const STATE_LABEL = {
    driving: '行驶中', charging: '充电中', online: '在线',
    offline: '驻车 / 离线', asleep: '休眠', unknown: '未知',
  };

  /* ---------- 主题 ---------- */

  function applyTheme() {
    document.documentElement.dataset.theme = S.theme;
    localStorage.setItem('ttv-theme', S.theme);
    const btn = $('#theme-btn');
    btn.textContent = S.theme === 'dark' ? '☀ 浅色' : '🌙 深色';
    const mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.content = S.theme === 'dark' ? '#0d0d0d' : '#f9f9f7';
    switchMapTheme();
    Object.values(charts).forEach((c) => c && c.setOption(chartTheme(), { notMerge: true }));
    renderAll();
  }

  /* ---------- 电量 / 里程 切换 ---------- */

  function setBattMode(mode) {
    if (mode !== 'pct' && mode !== 'kwh' && mode !== 'km') return;
    S.battMode = mode;
    localStorage.setItem('ttv-batt-mode', mode);
    document.querySelectorAll('.batt-toggle button').forEach((b) =>
      b.classList.toggle('on', b.dataset.mode === mode));
    // 仅重绘电量相关视图(避免地图 fitBounds 被重置)
    renderHeader(); renderActivity(); renderSentry();
  }

  function chartTheme() {
    return {
      backgroundColor: 'transparent',
      textStyle: {
        color: cssVar('--text-secondary'),
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      },
    };
  }

  /* ---------- 图表公共配置 ---------- */

  function axisCommon() {
    return {
      axisLine: { lineStyle: { color: cssVar('--baseline'), width: 1 } },
      axisTick: { show: false },
      axisLabel: { color: cssVar('--text-muted'), fontSize: 11 },
      splitLine: { lineStyle: { color: cssVar('--gridline'), width: 1 } },
    };
  }

  function tooltipAxis(unitMap, headerFmt, dual) {
    return {
      trigger: 'axis',
      backgroundColor: cssVar('--surface-1'),
      borderColor: cssVar('--border'),
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.18);border-radius:8px;',
      axisPointer: {
        type: 'line',
        lineStyle: { color: cssVar('--baseline'), width: 1 },
      },
      formatter(params) {
        const p0 = params[0];
        let s = `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">` +
                (headerFmt ? headerFmt(p0.axisValue) : p0.axisValue) + '</div>';
        params.forEach((p) => {
          const v = p.value != null && p.value[1] != null ? fmtNum(p.value[1], 1) : '—';
          const unit = (unitMap && unitMap[p.seriesName]) || '';
          const alt = (dual && dual[p.seriesName]) ? dual[p.seriesName](Number(p.value[1])) : '';
          s += `<div style="line-height:1.7"><span style="display:inline-block;width:14px;height:2px;` +
               `background:${p.color};vertical-align:middle;margin-right:6px"></span>` +
               `<b>${v} ${unit}</b>` +
               (alt ? ` <span style="color:${cssVar('--text-muted')}">${alt}</span>` : '') +
               ` <span style="color:${cssVar('--text-muted')}">${p.seriesName}</span></div>`;
        });
        return s;
      },
    };
  }

  function timeAxis(days) {
    return Object.assign(axisCommon(), {
      type: 'time',
      axisLabel: {
        color: cssVar('--text-muted'), fontSize: 11,
        formatter: (v) => (days <= 1 ? fmtClock(v) : `${fmtTime(v).slice(0, 5)}`),
      },
    });
  }

  /* ---------- 渲染:顶栏状态 ---------- */

  // 服务器硬盘 / 内存占用(页脚最底部)
  function renderSys(sys) {
    if (!sys) return;
    // 可视化仪表条:填充宽度 = 使用率,数值文字 + 悬停显示用量详情;
    // ≥75% 转黄,≥90% 转红(与电量胶囊的警示色一致)
    const setMeter = (id, pct, detail) => {
      const m = $(id);
      if (!m) return;
      if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
        m.hidden = true;
        return;
      }
      const v = Number(pct);
      m.hidden = false;
      m.title = detail;
      m.dataset.level = v >= 90 ? 'critical' : (v >= 75 ? 'warn' : 'ok');
      $(id + '-fill').style.width = `${Math.min(100, Math.max(0, v))}%`;
      $(id + '-val').textContent = `${fmtNum(v, 0)}%`;
    };
    setMeter('#meter-disk', sys.disk_pct,
      `硬盘 ${fmtNum(sys.disk_used_gb, 0)}/${fmtNum(sys.disk_total_gb, 0)} GB`);
    setMeter('#meter-mem', sys.mem_pct,
      `内存 ${fmtNum(sys.mem_used_mb / 1024, 1)}/${fmtNum(sys.mem_total_mb / 1024, 1)} GB`);
  }

  // 车型显示名:库中 model 为单字母;车主确认本车(Y / 74D 双电机)为 Model Y L
  const MODEL_LABEL = { S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y' };
  const TRIM_LABEL = { 'Y|74D': 'Model Y L' };
  // 顶栏车图:特斯拉设计 studio compositor 渲染图,按车型切换(S/X 国内无 compositor,无图回退)
  const MODEL_IMG = {
    'Model Y L': '/model-y-l.png',
    'Model Y': '/model-y.png',
    'Model 3': '/model-3.png',
  };

  // 车型信息集中判定:显示名 + 是否 Y L(官方尾标徽章)+ 顶栏渲染图
  function carModelInfo(car) {
    const trimKey = car ? `${car.model}|${car.trim_badging || ''}` : '';
    const label = TRIM_LABEL[trimKey] ||
      (car ? (MODEL_LABEL[car.model] || car.model || '') : '');
    return { label, isYL: label === 'Model Y L', img: MODEL_IMG[label] || null };
  }

  function renderHeader() {
    const o = S.overview;
    if (!o) return;
    const car = o.cars.find((c) => c.id === S.carId) || o.cars[0];
    $('#car-name').textContent = car ? car.name : '—';
    const mi = carModelInfo(car);
    // Model Y L 展示官方尾标徽章(PNG 蒙版 + currentColor 随主题变色);其他车型回退为字标文字
    $('#car-model-badge').hidden = !mi.isYL;
    const modelText = $('#car-model-text');
    modelText.hidden = mi.isYL;
    if (!mi.isYL) modelText.textContent = mi.label.toUpperCase();
    // 顶栏车图跟随车型;无对应渲染图的车型隐藏
    const icon = $('.model-icon');
    if (icon) {
      icon.style.display = mi.img ? '' : 'none';
      if (mi.img && !icon.src.endsWith(mi.img)) { icon.src = mi.img; icon.alt = mi.label; }
    }
    const badge = $('#state-badge');
    badge.dataset.state = o.state;
    $('#state-text').textContent = STATE_LABEL[o.state] || o.state;
    $('#sw-version').textContent = o.software_version ? `v${o.software_version}` : '';
    // 数据更新:固定第三行,文本更新时淡入(重启 CSS 动画)
    const ua = $('#updated-at');
    ua.textContent = o.latest ? `数据更新 ${fmtTime(Number(o.latest.date_ts))}` : '暂无数据';
    ua.classList.remove('fade-in');
    void ua.offsetWidth;
    ua.classList.add('fade-in');
  }

  /* ---------- 渲染:折线系列公共构造 ---------- */

  function lineSeries(name, data, color) {
    return {
      name, type: 'line', data,
      showSymbol: false,
      connectNulls: true,
      lineStyle: { width: 2, color, cap: 'round', join: 'round' },
      itemStyle: { color },
      emphasis: { lineStyle: { width: 2.5 } },
      endLabel: {
        show: true, formatter: (p) => fmtNum(p.value[1], 0),
        color: cssVar('--text-secondary'), fontSize: 11,
        backgroundColor: cssVar('--surface-1'), padding: [2, 5], borderRadius: 4,
      },
    };
  }

  /* ---------- 渲染:每日里程 / 充电 ---------- */

  function renderDaily() {
    const o = S.overview;
    if (!o || !charts.daily || !o.dailyRows) return;
    const map = {};
    o.dailyRows.forEach((r) => { map[r.day] = r; });
    const days = [], vals = [], now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (S.days - 1));
    for (let i = 0; i < S.days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push(key);
      vals.push(map[key] ? Number(map[key].distance_km) : 0);
    }
    charts.daily.setOption(Object.assign({}, chartTheme(), {
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssVar('--surface-1'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: [8, 12],
        textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
        axisPointer: { type: 'shadow', shadowStyle: { color: cssVar('--tile-track') } },
        formatter(params) {
          const p = params[0];
          const r = map[p.name];
          const drives = r ? r.drives : 0;
          const energy = r && o.kwhPerIdealKm ? Number(r.ideal_delta_km) * o.kwhPerIdealKm : 0;
          return `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">${escapeHTML(p.name)}</div>` +
                 `<div><span style="display:inline-block;width:14px;height:8px;border-radius:2px;` +
                 `background:${p.color};vertical-align:middle;margin-right:6px"></span>` +
                 `<b>${fmtNum(p.value, 1)} km</b> <span style="color:${cssVar('--text-muted')}">行驶里程</span></div>` +
                 `<div style="color:${cssVar('--text-muted')};margin-top:2px">${drives} 次行程 · 能耗约 ${fmtNum(energy, 1)} kWh</div>`;
        },
      },
      grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
      xAxis: Object.assign(axisCommon(), { type: 'category', data: days,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: (v) => v.slice(5) } }),
      yAxis: Object.assign(axisCommon(), { type: 'value',
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value}' } }),
      series: [{
        name: '行驶里程', type: 'bar', data: vals,
        barMaxWidth: 24,
        itemStyle: { color: cssVar('--series-1'), borderRadius: [4, 4, 0, 0] },
      }],
    }), { notMerge: true });
  }

  function renderCharging() {
    const o = S.overview;
    if (!o || !charts.charging || !o.chargingSessions) return;
    const sess = o.chargingSessions.slice().reverse();
    // 用户录入的费用优先于库内 cost
    const enteredCost = {};
    ((o.costs || {}).charges || []).forEach((c) => {
      if (c.cost !== null && c.cost !== undefined) enteredCost[c.id] = c.cost;
    });
    charts.charging.setOption(Object.assign({}, chartTheme(), {
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssVar('--surface-1'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: [8, 12],
        textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
        axisPointer: { type: 'shadow', shadowStyle: { color: cssVar('--tile-track') } },
        formatter(params) {
          const p = params[0];
          const s = sess[p.dataIndex];
          const up = (s.start_battery_level !== null && s.end_battery_level !== null)
            ? Number(s.end_battery_level) - Number(s.start_battery_level) : null;
          return `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">${fmtTime(Number(s.start_date_ts), true)}</div>` +
                 `<div><span style="display:inline-block;width:14px;height:8px;border-radius:2px;` +
                 `background:${p.color};vertical-align:middle;margin-right:6px"></span>` +
                 `<b>${fmtNum(s.charge_energy_added, 1)} kWh</b> <span style="color:${cssVar('--text-muted')}">充电量</span></div>` +
                 `<div style="color:${cssVar('--text-muted')};margin-top:2px">` +
                 `${fmtNum(s.start_battery_level, 0)}% → ${fmtNum(s.end_battery_level, 0)}%` +
                 (up !== null ? ` (+${fmtNum(up, 0)}% ${kmSuffix(up)})` : '') +
                 ` · ${fmtNum(s.duration_min, 0)} 分钟` +
                 (enteredCost[s.id] !== undefined ? ` · ¥${fmtNum(enteredCost[s.id], 2)}`
                   : s.cost != null ? ` · ¥${fmtNum(s.cost, 2)}` : '') + '</div>';
        },
      },
      grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
      xAxis: Object.assign(axisCommon(), { type: 'category',
        data: sess.map((s) => fmtTime(Number(s.start_date_ts)).slice(0, 5)),
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11 } }),
      yAxis: Object.assign(axisCommon(), { type: 'value',
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value}' } }),
      series: [{
        name: '充电量', type: 'bar',
        data: sess.map((s) => Number(s.charge_energy_added)),
        barMaxWidth: 24,
        itemStyle: { color: cssVar('--series-3'), borderRadius: [4, 4, 0, 0] },
      }],
    }), { notMerge: true });
  }

  /* ---------- 渲染:电量活动时间线(顶部全宽) ---------- */

  function stripSeries(name, data, tooltipBody) {
    // 泳道标注条:data = [laneIndex, startMs, endMs, color, meta]
    return {
      name, type: 'custom',
      xAxisIndex: 1, yAxisIndex: 1,
      data, animation: false,
      renderItem(params, api) {
        const lane = api.value(0);
        const x0 = api.coord([api.value(1), lane]);
        const x1 = api.coord([api.value(2), lane]);
        const yTop = api.coord([api.value(1), lane + 0.38]);
        const yBot = api.coord([api.value(1), lane - 0.38]);
        return {
          type: 'rect',
          shape: {
            x: x0[0],
            y: yBot[1],
            width: Math.max(x1[0] - x0[0], 2),
            height: yTop[1] - yBot[1],
          },
          style: { fill: api.value(3), opacity: 0.9 },
        };
      },
      encode: { x: [1, 2], y: 0 },
      tooltip: {
        trigger: 'item',
        backgroundColor: cssVar('--surface-1'),
        borderColor: cssVar('--border'),
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.18);border-radius:8px;',
        formatter(params) {
          return tooltipBody(params.data[4]);
        },
      },
    };
  }

  function activityDomain(a) {
    const nowMs = Date.now();
    const first = a.battery.length ? a.battery[0][0] : nowMs;
    return {
      min: Math.min(first, localMidnight(nowMs - S.days * 86400000)) - 3600000,
      max: nowMs + 60000,
    };
  }

  function renderActivity() {
    const o = S.overview;
    if (!o || !charts.activity || !o.activity) return;
    const a = o.activity;
    const domain = activityDomain(a);
    const batt = a.battery.map((p) => [Number(p[0]), Number(p[1])]);
    // 窄屏:y 轴标签绘制在图内,无需 96px 左边距,留出更多绘图区
    const narrow = isNarrow();
    // 电量 ⇄ 度数 ⇄ 里程维度切换
    const dim = battDim();
    const battLine = battSeriesData(batt);

    // 每一天的分隔:本地零点竖虚线
    const midnights = [];
    for (let t = localMidnight(domain.min); t <= domain.max; t += 86400000) {
      midnights.push({ xAxis: t });
    }

    const stripData = [];
    const catColor = (c) => cssVar(CAT[c].colorVar);
    a.drives.forEach((d) => stripData.push([
      1, Number(d.start_date_ts), Number(d.end_date_ts), catColor('drive'),
      {
        kind: 'drive', s: Number(d.start_date_ts), e: Number(d.end_date_ts),
        title: '行驶', body: `${fmtNum(d.distance, 1)} km · ${fmtNum(d.duration_min, 0)} 分` +
          `${d.start_name || d.end_name ? ` · ${escapeHTML(d.start_name || '—')} → ${escapeHTML(d.end_name || '—')}` : ''}`,
      },
    ]));
    a.charges.forEach((c) => stripData.push([
      1, Number(c.start_date_ts), c.end_date_ts === null ? domain.max : Number(c.end_date_ts),
      catColor('charge'),
      {
        kind: 'charge', s: Number(c.start_date_ts),
        title: '充电', body: `${fmtNum(c.charge_energy_added, 1)} kWh · ` +
          `${fmtNum(c.start_battery_level, 0)}% → ${fmtNum(c.end_battery_level, 0)}%` +
          (c.start_battery_level !== null && c.end_battery_level !== null
            ? ` · 增加 ${kmSuffix(Number(c.end_battery_level) - Number(c.start_battery_level))} ${kwhSuffix(Number(c.end_battery_level) - Number(c.start_battery_level))}` : '') +
          (c.cost !== null && c.cost !== undefined ? ` · ¥${fmtNum(c.cost, 2)}` : '') +
          `${c.address_name ? ` · ${escapeHTML(c.address_name)}` : ''}`,
      },
    ]));
    a.sentry.forEach((p) => stripData.push([
      0, p.s, p.e, catColor('sentry'),
      {
        kind: 'sentry', s: p.s, e: p.e,
        title: '哨兵耗电', body: `${fmtNum(p.dur_min, 0)} 分钟 · 耗电 ${battVal(-p.delta)}${battAlt(-p.delta) ? ' · ' + battAlt(-p.delta) : ''}` +
          (p.rate_pct_h !== null ? ` · 约 ${fmtNum(p.rate_pct_h, 2)} %/h` : ''),
      },
    ]));
    a.idle.forEach((p) => stripData.push([
      0, p.s, p.e, catColor('idle'),
      {
        kind: 'idle', s: p.s, e: p.e,
        title: p.kind === 'climate' ? '驻车耗电(空调)' : '驻车耗电(休眠)',
        body: `${fmtNum(p.dur_min, 0)} 分钟 · 耗电 ${battVal(-p.delta)}${battAlt(-p.delta) ? ' · ' + battAlt(-p.delta) : ''}`,
      },
    ]));

    const stripTip = (m) =>
      `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">` +
      `${m.title} · ${fmtTime(m.s)} – ${fmtTime(m.e)}</div>` +
      `<div><b>${m.body}</b></div>`;

    charts.activity.setOption(Object.assign({}, chartTheme(), {
      animation: false,
      tooltip: tooltipAxis({ '电量': '%', '剩余电量(折算)': 'kWh', '剩余里程(折算)': 'km' },
        (v) => fmtTime(v, true), dualBatt),
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: narrow ? 6 : 96, right: narrow ? 20 : 44, top: 30, bottom: '26%' },
        { left: narrow ? 6 : 96, right: narrow ? 20 : 44, top: '78%', bottom: '11%' },
      ],
      xAxis: [
        Object.assign(timeAxis(S.days), {
          min: domain.min, max: domain.max,
          axisLabel: { show: false },
          axisPointer: { label: { show: false } },
        }),
        Object.assign(timeAxis(S.days), {
          gridIndex: 1, min: domain.min, max: domain.max,
          axisPointer: { label: { show: false } },
        }),
      ],
      yAxis: [
        Object.assign(axisCommon(), {
          type: 'value', min: 0,
          max: battAxisMax(),
          axisLabel: { color: cssVar('--text-muted'), fontSize: 11,
            formatter: dim === 'pct' ? '{value}%' : '{value}', inside: true },
        }),
        Object.assign(axisCommon(), {
          gridIndex: 1, type: 'value', min: 0, max: 2, interval: 0.5,
          splitLine: { show: false },
          axisLabel: {
            color: cssVar('--text-muted'), fontSize: 11, inside: true,
            formatter: (v) => (v === 1.5 ? '行驶 · 充电' : v === 0.5 ? '哨兵 · 驻车耗电' : ''),
          },
        }),
      ],
      series: [
        Object.assign(lineSeries(BATT_SERIES_NAME[dim], battLine,
          cssVar('--series-1')), {
          markLine: {
            silent: true, symbol: 'none',
            data: midnights,
            lineStyle: { color: cssVar('--baseline'), type: 'dashed', width: 1 },
            label: {
              show: S.days <= 7, position: 'insideEndTop',
              formatter: (p) => fmtTime(p.value).slice(0, 5),
              color: cssVar('--text-muted'), fontSize: 10,
              backgroundColor: cssVar('--surface-1'), padding: [1, 5], borderRadius: 4,
            },
          },
        }),
        stripSeries('活动', stripData, stripTip),
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], filterMode: 'none' },
        {
          type: 'slider', xAxisIndex: [0, 1], filterMode: 'none',
          bottom: 2, height: narrow ? 20 : 16,
          handleSize: narrow ? '130%' : '100%',
          moveHandleSize: narrow ? 10 : 7,
          borderColor: cssVar('--border'),
          backgroundColor: 'transparent',
          fillerColor: 'rgba(57,135,229,0.12)',
          handleStyle: { color: cssVar('--series-1') },
          moveHandleStyle: { color: cssVar('--baseline') },
          dataBackground: {
            lineStyle: { color: cssVar('--baseline') },
            areaStyle: { color: 'transparent' },
          },
          selectedDataBackground: {
            lineStyle: { color: cssVar('--series-1') },
            areaStyle: { color: 'rgba(57,135,229,0.12)' },
          },
          textStyle: { color: cssVar('--text-muted'), fontSize: 10 },
        },
      ],
    }), { notMerge: true });
  }

  /* ---------- 渲染:活动事件列表(可折叠) ---------- */

  function eventRows(a) {
    const evs = [];
    a.drives.forEach((d) => evs.push({
      kind: 'drive', s: Number(d.start_date_ts), e: Number(d.end_date_ts), meta: d,
    }));
    a.charges.forEach((c) => evs.push({
      kind: 'charge', s: Number(c.start_date_ts),
      e: c.end_date_ts === null ? Date.now() : Number(c.end_date_ts), meta: c,
    }));
    a.sentry.forEach((p) => evs.push({ kind: 'sentry', s: p.s, e: p.e, meta: p }));
    a.idle.forEach((p) => evs.push({ kind: 'idle', s: p.s, e: p.e, meta: p }));
    evs.sort((x, y) => y.s - x.s);

    const groups = new Map();
    evs.forEach((ev) => {
      const key = dayKey(ev.s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    });
    return groups;
  }

  function eventTime(s, e) {
    const sameDay = dayKey(s) === dayKey(e);
    return sameDay
      ? `${fmtClock(s)} – ${fmtClock(e)}`
      : `${fmtTime(s).slice(0, 5)} ${fmtClock(s)} – ${fmtTime(e).slice(0, 5)} ${fmtClock(e)}`;
  }

  function eventDesc(ev) {
    const m = ev.meta;
    if (ev.kind === 'drive') {
      const delta = (m.start_ideal_range_km !== null && m.end_ideal_range_km !== null)
        ? Number(m.start_ideal_range_km) - Number(m.end_ideal_range_km) : null;
      const eff = (delta !== null && m.distance && o_kwh() > 0)
        ? delta * o_kwh() * 1000 / m.distance : null;
      return `${fmtNum(m.distance, 1)} km · ${fmtNum(m.duration_min, 0)} 分` +
        (eff !== null ? ` · 约 ${fmtNum(eff, 0)} Wh/km` : '') +
        (m.start_name || m.end_name ? ` · ${m.start_name || '—'} → ${m.end_name || '—'}` : '') +
        (m.cost_per_km_yuan !== null && m.cost_per_km_yuan !== undefined
          ? ` · ¥${fmtNum(m.cost_per_km_yuan, 2)}/km` : '');
    }
    if (ev.kind === 'charge') {
      return `${fmtNum(m.duration_min, 0)} 分` +
        `${m.address_name ? ` · ${m.address_name}` : ''}` +
        (m.rate_yuan_kwh !== null && m.rate_yuan_kwh !== undefined
          ? ` · ¥${fmtNum(m.rate_yuan_kwh, 2)}/kWh` : '');
    }
    const tag = m.kind === 'climate' ? '(空调)' : ev.kind === 'sentry' ? '' : '(休眠)';
    return `${fmtNum(m.dur_min, 0)} 分钟${tag}` +
      (ev.kind === 'sentry' && m.rate_pct_h !== null
        ? ` · 约 ${fmtNum(m.rate_pct_h, 2)} %/h` : '');
  }

  // 事件数值列:电量% / 度数kWh / 里程km / 电费¥(充电为增加量与已付费用,其余为消耗)
  function eventNums(ev) {
    const m = ev.meta;
    const na = { batt: '—', kwh: '—', km: '—', cost: '—', up: false };
    if (ev.kind === 'drive') {
      const battDrop = (m.start_battery_level !== null && m.start_battery_level !== undefined &&
          m.end_battery_level !== null && m.end_battery_level !== undefined)
        ? Number(m.start_battery_level) - Number(m.end_battery_level) : null;
      const delta = (m.start_ideal_range_km !== null && m.end_ideal_range_km !== null)
        ? Number(m.start_ideal_range_km) - Number(m.end_ideal_range_km) : null;
      return {
        batt: battDrop === null ? '—' : battDrop <= 0 ? '0%' : `-${fmtNum(battDrop, 0)}%`,
        kwh: m.energy_kwh === null || m.energy_kwh === undefined ? '—' : `-${fmtNum(m.energy_kwh, 1)}`,
        km: delta === null ? '—' : `-${fmtNum(delta, 1)}`,
        cost: m.cost_yuan === null || m.cost_yuan === undefined ? '—' : `¥${fmtNum(m.cost_yuan, 2)}`,
        up: false,
      };
    }
    if (ev.kind === 'charge') {
      const up = (m.start_battery_level !== null && m.end_battery_level !== null)
        ? Number(m.end_battery_level) - Number(m.start_battery_level) : null;
      const km = kmAtPct(up);
      return {
        batt: up === null ? '—' : `+${fmtNum(up, 0)}%`,
        kwh: m.charge_energy_added === null || m.charge_energy_added === undefined
          ? '—' : `+${fmtNum(m.charge_energy_added, 1)}`,
        km: km === null ? '—' : `+${fmtNum(km, 0)}`,
        cost: m.cost === null || m.cost === undefined ? '—' : `¥${fmtNum(m.cost, 2)}`,
        up: true,
      };
    }
    // 耗电为降幅;采样取整可能出现 ±0.0x 的抖动,钳到 0 避免「-0」
    const drop = Math.max(0, -m.delta);
    const km = kmAtPct(drop);
    return {
      batt: drop <= 0 ? '0%' : `-${fmtNum(drop, 0)}%`,
      kwh: m.energy_kwh === null || m.energy_kwh === undefined ? '—'
        : m.energy_kwh <= 0 ? '0.0' : `-${fmtNum(m.energy_kwh, 1)}`,
      km: km === null ? '—' : km <= 0 ? '0' : `-${fmtNum(km, 0)}`,
      cost: m.cost_yuan === null || m.cost_yuan === undefined ? '—' : `¥${fmtNum(m.cost_yuan, 2)}`,
      up: false,
    };
  }

  function o_kwh() {
    return S.overview ? (S.overview.kwhPerIdealKm || 0) : 0;
  }

  /* 折叠日组右侧的小型环状耗电图:按 行驶/哨兵/驻车耗电 的 kWh 占比分段
     (驻车空调已与休眠掉电合并为「驻车耗电」,与总览口径一致) */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DRAIN_SEGS = [
    ['drive', '行驶'], ['sentry', '哨兵'], ['idle', '驻车耗电'],
  ];

  function eventDrainKwh(ev) {
    const m = ev.meta;
    if (ev.kind !== 'drive' && ev.kind !== 'sentry' && ev.kind !== 'idle') return null;
    if (m.energy_kwh !== null && m.energy_kwh !== undefined) return Math.max(0, Number(m.energy_kwh));
    // 缺少能耗字段时按电量%降幅折算(与列表数值列同口径)
    const drop = ev.kind === 'drive'
      ? (m.start_battery_level !== null && m.start_battery_level !== undefined &&
          m.end_battery_level !== null && m.end_battery_level !== undefined)
        ? Number(m.start_battery_level) - Number(m.end_battery_level) : 0
      : -Number(m.delta || 0);
    const kwh = kwhAtPct(Math.max(0, drop));
    return kwh === null ? null : kwh;
  }

  function dayDrainDonut(evs) {
    const drain = { drive: 0, sentry: 0, idle: 0 };
    evs.forEach((ev) => {
      const kwh = eventDrainKwh(ev);
      if (kwh === null || kwh <= 0) return;
      drain[ev.kind] += kwh;  // idle 含驻车空调(kind='climate')与休眠掉电
    });
    const total = DRAIN_SEGS.reduce((s, [k]) => s + drain[k], 0);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('class', 'day-donut');
    const mk = (cls) => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', '18');
      c.setAttribute('cy', '18');
      c.setAttribute('r', '14');
      c.setAttribute('pathLength', '100');
      c.setAttribute('class', cls);
      return c;
    };
    svg.appendChild(mk('donut-track'));

    const tip = [];
    if (total > 0) {
      let acc = 0;
      DRAIN_SEGS.forEach(([k, label]) => {
        const v = drain[k];
        if (v <= 0) return;
        const len = v / total * 100;
        const seg = mk('donut-seg seg-' + k);
        // pathLength=100 归一化:dashoffset 25 处为环顶,段间留 1% 缝
        const shown = len >= 99 ? 100 : Math.max(len - 1, 0.6);
        seg.setAttribute('stroke-dasharray', `${shown} ${100 - shown}`);
        seg.setAttribute('stroke-dashoffset', String(25 - acc));
        svg.appendChild(seg);
        acc += len;
        tip.push(`${label} ${fmtNum(v, 1)} kWh`);
      });
    }
    const t = document.createElementNS(SVG_NS, 'title');
    t.textContent = tip.length ? tip.join(' · ') : '当日无耗电记录';
    svg.appendChild(t);
    return svg;
  }

  function renderEvents() {
    const o = S.overview;
    const box = $('#events-list');
    if (!o || !o.activity) return;
    const a = o.activity;
    const groups = eventRows(a);
    box.textContent = '';

    if (!groups.size) {
      box.appendChild(el('div', 'events-empty', '所选时间范围内暂无活动数据'));
      return;
    }

    // 列头:与 .ev-row 同一套栅格(窄屏隐藏,改由数值格自带小标签)
    const headRow = el('div', 'ev-row ev-head');
    ['时间', '类型', '详情', '电量', '度数', '里程', '电费'].forEach((t, i) =>
      headRow.appendChild(el('span',
        ['ev-time', 'ev-chip', 'ev-desc', 'ev-num', 'ev-num', 'ev-num', 'ev-num'][i], t)));
    box.appendChild(headRow);

    groups.forEach((evs, key) => {
      const isToday = key === dayKey(Date.now());
      const grp = el('div', 'day-group' + (isToday ? ' open' : ''));
      const head = el('button', 'day-head');
      head.type = 'button';
      head.appendChild(el('span', 'date', dayLabel(evs[0].s)));
      const summary = el('span', 'summary');
      ['drive', 'charge', 'sentry', 'idle'].forEach((k) => {
        const n = evs.filter((ev) => ev.kind === k).length;
        if (n) summary.appendChild(el('span', 'chip ' + CAT[k].cls,
          `${CAT[k].label} ${n}`));
      });
      head.appendChild(summary);
      head.appendChild(dayDrainDonut(evs));
      head.appendChild(el('span', 'chev', '▾'));
      head.addEventListener('click', () => grp.classList.toggle('open'));
      grp.appendChild(head);

      const body = el('div', 'day-body');
      evs.forEach((ev) => {
        const row = el('div', 'ev-row');
        row.appendChild(el('span', 'ev-time', eventTime(ev.s, ev.e)));
        row.appendChild(el('span', 'ev-chip ' + CAT[ev.kind].cls, CAT[ev.kind].label));
        row.appendChild(el('span', 'ev-desc', eventDesc(ev)));
        const nums = eventNums(ev);
        [['电量', nums.batt], ['度数', nums.kwh], ['里程', nums.km], ['电费', nums.cost]]
          .forEach(([lab, text]) => {
            const cell = el('span', 'ev-num' + (nums.up && lab !== '电费' ? ' up' : ''), text);
            cell.dataset.lab = lab;
            row.appendChild(cell);
          });
        body.appendChild(row);
      });
      grp.appendChild(body);
      box.appendChild(grp);
    });
  }

  /* ---------- 渲染:哨兵时间轴与耗电曲线 ---------- */

  function renderSentry() {
    const o = S.overview;
    if (!o || !charts.sentryLanes || !charts.sentryDrain || !o.activity) return;
    const a = o.activity;
    const sentry = a.sentry || [];

    // 概览统计
    const stats = $('#sentry-stats');
    stats.textContent = '';
    const hours = sentry.reduce((s, p) => s + (p.e - p.s), 0) / 3600000;
    const drain = -sentry.reduce((s, p) => s + p.delta, 0);
    function stat(label, value, unit, extra) {
      const t = el('span', 'mini-stat');
      t.appendChild(el('span', '', label + ' '));
      const b = el('b', '', fmtNum(value, value < 10 ? 1 : 0));
      t.appendChild(b);
      if (unit) t.appendChild(el('span', '', ' ' + unit));
      if (extra) t.appendChild(el('span', '', ' ' + extra));
      stats.appendChild(t);
    }
    stat('哨兵总时长', hours, '小时');
    const dim = battDim();
    const drainVal = dim === 'km' ? kmAtPct(drain) : dim === 'kwh' ? kwhAtPct(drain) : drain;
    stat('哨兵耗电', drainVal === null ? 0 : drainVal, BATT_UNIT[dim], battAlt(drain));
    const rateVal = hours > 0 ? (drainVal === null ? 0 : drainVal) / hours : 0;
    stat('平均耗电速率', rateVal, BATT_UNIT[dim] + '/h');
    stat('哨兵时段数', sentry.length, '');

    // 按天拆分哨兵时段(跨零点切开)
    const byDay = new Map();
    sentry.forEach((p) => {
      let cur = p.s;
      while (cur < p.e) {
        const ds = localMidnight(cur);
        const de = ds + 86400000;
        const segEnd = Math.min(p.e, de);
        const frac = (segEnd - cur) / (p.e - p.s);
        const key = dayKey(ds);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push({
          s: cur, e: segEnd,
          delta: Math.round(p.delta * frac),
          dur_min: Math.round(p.dur_min * frac),
          rate_pct_h: p.rate_pct_h,
        });
        cur = de;
      }
    });
    const domain = activityDomain(a);
    const days = [];
    for (let t = localMidnight(domain.max); t >= localMidnight(domain.min); t -= 86400000) {
      days.push({ key: dayKey(t), ms: t });
    }
    const laneData = [];
    days.forEach((d, idx) => {
      (byDay.get(d.key) || []).forEach((seg) => {
        laneData.push([idx, (seg.s - d.ms) / 3600000, (seg.e - d.ms) / 3600000,
          cssVar('--cat-sentry'), { d, seg }]);
      });
    });
    const laneH = Math.min(Math.max(days.length * 26 + 56, 170), 540);
    $('#chart-sentry-lanes').style.height = laneH + 'px';

    charts.sentryLanes.setOption(Object.assign({}, chartTheme(), {
      animation: false,
      tooltip: {
        trigger: 'item',
        backgroundColor: cssVar('--surface-1'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: [8, 12],
        textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.18);border-radius:8px;',
        formatter(params) {
          const m = params.data[4];
          const hh = (x) => `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.floor(x % 1 * 60)).padStart(2, '0')}`;
          return `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">` +
            `${dayLabel(m.d.ms)} · 哨兵开启</div>` +
            `<div><b>${hh((m.seg.s - m.d.ms) / 3600000)} – ${hh((m.seg.e - m.d.ms) / 3600000)}</b></div>` +
            `<div style="color:${cssVar('--text-secondary')};margin-top:2px">` +
            `约 ${fmtNum(m.seg.dur_min, 0)} 分钟 · 耗电 ${battVal(-m.seg.delta)}${battAlt(-m.seg.delta) ? ' · ' + battAlt(-m.seg.delta) : ''}` +
            (m.seg.rate_pct_h !== null ? ` · ${fmtNum(m.seg.rate_pct_h, 2)} %/h` : '') + `</div>`;
        },
      },
      grid: { left: 8, right: 20, top: 24, bottom: 4, containLabel: true },
      xAxis: Object.assign(axisCommon(), { type: 'value', min: 0, max: 24, interval: 3,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value}:00' } }),
      yAxis: Object.assign(axisCommon(), {
        type: 'category', inverse: true, data: days.map((d) => dayLabel(d.ms)),
        splitLine: { show: false },
        axisLabel: { color: cssVar('--text-secondary'), fontSize: 11 },
      }),
      series: [{
        name: '哨兵', type: 'custom', data: laneData,
        renderItem(params, api) {
          const idx = api.value(0);
          const x0 = api.coord([api.value(1), idx]);
          const x1 = api.coord([api.value(2), idx]);
          const band = api.size([0, 1]);
          const laneHpx = Math.min(Math.max(band[1] * 0.62, 6), 22);
          return {
            type: 'rect',
            shape: {
              x: x0[0], y: x0[1] - laneHpx / 2,
              width: Math.max(x1[0] - x0[0], 2), height: laneHpx,
            },
            style: { fill: api.value(3), opacity: 0.9 },
          };
        },
        encode: { x: [1, 2], y: 0 },
      }],
    }), { notMerge: true });

    // 每天哨兵耗电总和(柱状图;按当前电量维度 %/kWh/km 换算)
    const dimDrain = battDim();
    const convDrain = dimDrain === 'km' ? kmAtPct : dimDrain === 'kwh' ? kwhAtPct : (p) => p;
    const drainDays = days.slice().reverse();  // 旧 → 新
    const drainBars = drainDays.map((d) => {
      const pct = (byDay.get(d.key) || []).reduce((s, seg) => s - seg.delta, 0);
      const v = convDrain(pct);
      return { day: d, pct, value: v === null ? 0 : v };
    });
    charts.sentryDrain.setOption(Object.assign({}, chartTheme(), {
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssVar('--surface-1'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: [8, 12],
        textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.18);border-radius:8px;',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(128,128,128,0.08)' } },
        formatter(params) {
          const m = drainBars[params[0].dataIndex];
          return `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">` +
            `${dayLabel(m.day.ms)}</div>` +
            `<div>哨兵耗电 <b>${battVal(m.pct)}</b>` +
            (battAlt(m.pct) ? ` <span style="color:${cssVar('--text-secondary')}">${battAlt(m.pct)}</span>` : '') +
            `</div>`;
        },
      },
      grid: trendGrid(24),
      xAxis: Object.assign(axisCommon(), { type: 'category',
        data: drainBars.map((m) => fmtTime(m.day.ms).slice(0, 5)),
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11 } }),
      yAxis: Object.assign(axisCommon(), { type: 'value', min: 0,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11,
          formatter: dimDrain === 'pct' ? '{value}%' : '{value}' } }),
      series: [{
        name: '哨兵耗电', type: 'bar',
        data: drainBars.map((m) => Math.round(m.value * 100) / 100),
        barMaxWidth: 26,
        itemStyle: { color: cssVar('--cat-sentry'), borderRadius: [4, 4, 0, 0], opacity: 0.92 },
      }],
    }), { notMerge: true });
  }

  /* ---------- 渲染:平均能耗 / 胎压 ---------- */

  function renderEfficiency() {
    const o = S.overview;
    if (!o || !charts.efficiency || !o.efficiency) return;
    const pts = (o.efficiency.points || []).map((p) => [Number(p.start_ts), p.eff_wh_km]);
    const effTip = (params) => {
      const p0 = params[0];
      let s = `<div style="color:${cssVar('--text-muted')};font-size:11px;margin-bottom:4px">` +
              fmtTime(p0.axisValue, true) + '</div>';
      params.forEach((p) => {
        s += `<div style="line-height:1.7"><span style="display:inline-block;width:14px;height:2px;` +
             `background:${p.color};vertical-align:middle;margin-right:6px"></span>` +
             `<b>${fmtNum(p.value[1], 0)} Wh/km</b></div>`;
      });
      const d = o.efficiency.points.find((x) => x.start_ts === Number(p0.axisValue));
      if (d) {
        s += `<div style="color:${cssVar('--text-muted')};margin-top:2px">` +
             `${fmtNum(d.distance, 1)} km · ${fmtNum(d.duration_min, 0)} 分` +
             (d.start_name || d.end_name ? ` · ${escapeHTML(d.start_name || '—')} → ${escapeHTML(d.end_name || '—')}` : '') + '</div>';
      }
      return s;
    };
    const c = cssVar('--series-1');
    // hex → rgba(供渐变填充用)
    const h = c.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    const fade = (a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    charts.efficiency.setOption(Object.assign({}, chartTheme(), {
      tooltip: Object.assign(tooltipAxis({}, (v) => fmtTime(v, true)), { formatter: effTip }),
      grid: trendGrid(24),
      xAxis: timeAxis(S.days),
      yAxis: Object.assign(axisCommon(), { type: 'value', min: 0,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value}' } }),
      series: [
        Object.assign(lineSeries('平均能耗', pts, c), {
          // 平滑曲线 + 曲线下渐变填充;每次行程一个小圆点
          smooth: true,
          smoothMonotone: 'x',
          showSymbol: true, symbol: 'circle', symbolSize: 6,
          itemStyle: { color: c, borderColor: cssVar('--surface-1'), borderWidth: 1.5 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: fade(0.28) },
                { offset: 1, color: fade(0.02) },
              ],
            },
          },
        }),
      ],
    }), { notMerge: true });
  }

  /* ---------- 渲染:生涯总览(车况页顶部,SpaceX 字标背景) ---------- */

  function renderLifetime() {
    const d = S.lifetime;
    if (!d) return;
    $('#life-km').textContent = fmtNum(d.total_km, 0);
    $('#life-kwh').textContent = fmtNum(d.total_kwh, 0);
    $('#life-cost').textContent = fmtNum(d.total_cost, 2);
    $('#life-cycles').textContent = fmtNum(d.cycles, 1);
    $('#life-km-sub').textContent = `自统计起行驶 ${fmtNum(d.drive_km, 0)} km`;
    $('#life-kwh-sub').textContent =
      `行驶 ${fmtNum(d.drive_kwh, 0)} · 驻车 ${fmtNum(d.parked_kwh, 0)}`;
    const miss = (d.sessions || 0) - (d.priced_sessions || 0);
    $('#life-cost-sub').textContent =
      `${d.priced_sessions || 0} 次充电` +
      (d.rate_yuan_kwh ? ` · 均价 ¥${fmtNum(d.rate_yuan_kwh, 2)}/kWh` : '') +
      (miss > 0 ? ` · ${miss} 次未计价` : '');
    $('#life-cycles-sub').textContent = d.nominal_kwh
      ? `累计充入 ${fmtNum(d.charged_kwh, 0)} ÷ 满电 ${fmtNum(d.nominal_kwh, 1)} kWh`
      : '充电样本不足';
    if (d.since) {
      const day = new Date(Number(d.since)).toLocaleDateString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
      $('#life-sub').textContent = `能耗与费用统计始于 ${day} · 总里程为车辆表显值`;
    }
  }

  /* ---------- 渲染:通勤分析(车况页,整个车辆生涯累计,来自 /api/vehicle/lifetime) ---------- */

  function renderTraffic() {
    const t = S.lifetime && S.lifetime.traffic;
    if (!t) return;
    $('#tf-total').textContent = fmtDur(t.drive_min);
    $('#tf-jam').textContent = fmtSec(t.jam_s);
    $('#tf-jam-km').textContent = fmtNum(t.jam_km, 1);
    $('#tf-light').textContent = fmtSec(t.light_s);
    $('#tf-light-sub').textContent = `共 ${fmtNum(t.light_n, 0)} 次`;
  }

  function renderTpms() {
    const o = S.overview;
    if (!o || !charts.tpms || !o.tpms) return;
    const w = o.tpms.wheels || {};
    const names = [
      ['fl', '左前'], ['fr', '右前'], ['rl', '左后'], ['rr', '右后'],
    ];
    charts.tpms.setOption(Object.assign({}, chartTheme(), {
      tooltip: tooltipAxis({ '左前': 'bar', '右前': 'bar', '左后': 'bar', '右后': 'bar' },
        (v) => fmtTime(v, true)),
      legend: {
        top: 0, left: 6, itemWidth: 14, itemHeight: 8, itemGap: isNarrow() ? 10 : 14,
        textStyle: { color: cssVar('--text-secondary'), fontSize: 12 },
      },
      grid: trendGrid(34),
      xAxis: timeAxis(S.days),
      yAxis: Object.assign(axisCommon(), { type: 'value', scale: true,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value}' } }),
      series: names.map(([key, label], i) =>
        lineSeries(label, (w[key] || []).map((p) => [Number(p[0]), Number(p[1])]),
          cssVar(`--series-${i + 1}`))),
    }), { notMerge: true });
  }

  /* ---------- 渲染:车内 / 车外温度 ---------- */

  function renderTemp() {
    const o = S.overview;
    if (!o || !charts.temp || !o.temp) return;
    const mk = (arr) => (arr || []).map((p) => [Number(p[0]), Number(p[1])]);
    charts.temp.setOption(Object.assign({}, chartTheme(), {
      tooltip: tooltipAxis({ '车内': '°C', '车外': '°C' }, (v) => fmtTime(v, true)),
      legend: {
        top: 0, left: 6, itemWidth: 14, itemHeight: 8, itemGap: isNarrow() ? 10 : 14,
        textStyle: { color: cssVar('--text-secondary'), fontSize: 12 },
      },
      grid: trendGrid(34),
      xAxis: timeAxis(S.days),
      yAxis: Object.assign(axisCommon(), {
        type: 'value', scale: true,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value}°' },
      }),
      series: [
        // 车内暖色 / 车外冷色(参考调色板 series-2 橙 / series-1 蓝)
        lineSeries('车内', mk(o.temp.inside), cssVar('--series-2')),
        lineSeries('车外', mk(o.temp.outside), cssVar('--series-1')),
      ],
    }), { notMerge: true });
  }

  /* ---------- 渲染:车辆总览(俯视图 + 能耗占比 + 四轮胎压 + 电池健康) ---------- */

  // 本卡片独立的三态切换:电量 % / 度数 kWh / 里程 km
  function carModeEffective() {
    if (S.carMode === 'km' && kmFull() === null) return 'pct';
    return S.carMode;
  }

  // 电池 % → 当前展示单位(cap 为该充电周期估算的满电容量)
  function carConvPct(pct, cap) {
    const mode = carModeEffective();
    if (mode === 'kwh') return { v: pct / 100 * cap, unit: 'kWh', dec: 1 };
    if (mode === 'km') {
      const f = kmFull();
      return { v: f ? pct / 100 * f : null, unit: 'km', dec: 0 };
    }
    return { v: pct, unit: '%', dec: 0 };
  }

  // 玻璃顶能量环:pathLength=100,各段用 dasharray/offset 沿环分布(顶点=起点,顺时针)

  // 分段点选:能量环 ⇄ 图例详情 联动高亮(再点一次或点空白处取消)
  let carSel = null;
  function setCarSel(k) {
    carSel = k || null;
    document.querySelectorAll('.car-svg .carring').forEach((r) => {
      r.classList.toggle('dim', !!carSel && r.id !== `carring-${carSel}`);
    });
    document.querySelectorAll('.cl-item[data-k]').forEach((d) =>
      d.classList.toggle('on', !!carSel && d.dataset.k === carSel));
    const cv = $('.carview');
    if (cv) cv.classList.toggle('has-sel', !!carSel);
  }

  /* --- 总览两侧面板:默认只留小圆点,点任一侧两边一起展开,无操作几秒后自动收起 --- */
  const SIDE_AUTO_MS = 4500;
  let sideTimer = 0;
  function syncSidesStowed() {
    const cv = $('#carview');
    if (!cv) return;
    const stowed = ['l', 'r'].every((s) => {
      const box = $(`#car-side-${s}`);
      return !box || box.classList.contains('collapsed');
    });
    cv.classList.toggle('sides-stowed', stowed);
  }
  // 两侧始终联动:一起展开 / 一起收起
  function setCarSides(open) {
    ['l', 'r'].forEach((side) => {
      const box = $(`#car-side-${side}`);
      const btn = $(`#car-side-btn-${side}`);
      if (!box || !btn) return;
      box.classList.toggle('collapsed', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    clearTimeout(sideTimer);
    if (open) sideTimer = setTimeout(() => setCarSides(false), SIDE_AUTO_MS);
    syncSidesStowed();
  }
  // 展开期间面板内的悬停/点按/键盘焦点都重置自动收起计时
  function pokeCarSides() {
    const box = $('#car-side-l');
    if (!box || box.classList.contains('collapsed')) return;
    clearTimeout(sideTimer);
    sideTimer = setTimeout(() => setCarSides(false), SIDE_AUTO_MS);
  }
  function initCarSides() {
    ['l', 'r'].forEach((side) => {
      const box = $(`#car-side-${side}`);
      const btn = $(`#car-side-btn-${side}`);
      if (!box || !btn) return;
      btn.addEventListener('click', () =>
        setCarSides(box.classList.contains('collapsed')));
      ['pointerenter', 'pointerdown', 'focusin'].forEach((ev) =>
        box.addEventListener(ev, pokeCarSides));
    });
  }

  /* --- 顶部过冲徽标(#space-mark):只在真正下拉过冲(scrollY<0)时点亮 --- */
  function initSpaceMark() {
    const mark = $('#space-mark');
    if (!mark) return;
    addEventListener('scroll', () => {
      mark.classList.toggle('peek', (window.scrollY || 0) < -8);
    }, { passive: true });
  }

  function renderCar() {
    const o = S.overview;
    if (!o) return;

    /* --- 能量占比:车身纵向分带(按充电周期:充电结束 → 下次充电开始/现在) --- */
    const cycles = (S.cycles && S.cycles.cycles) || [];
    S.cycleIdx = Math.min(S.cycleIdx, Math.max(0, cycles.length - 1));
    const cyc = cycles.length ? cycles[S.cycleIdx] : null;

    // 充电周期横条:每个周期一枚可点选芯片(横向滑动),条内小进度条为充至电量
    const strip = $('#cycle-strip');
    strip.hidden = !cycles.length;
    const sig = cycles.map((c) => `${c.charge_id}:${c.level_after}:${c.charge_count}`).join(',');
    if (strip.dataset.sig !== sig) {
      strip.dataset.sig = sig;
      strip.textContent = '';
      cycles.forEach((c, i) => {
        const b = el('button', 'cyc-chip');
        b.type = 'button';
        b.dataset.idx = i;
        b.appendChild(el('b', '', `${fmtTime(Number(c.charge_end_ts))} 充至 ${fmtNum(c.level_after, 0)}%`));
        const parts = [];
        if (c.charge_count > 1) parts.push(`合并${c.charge_count}次`);
        if (c.active) parts.push('进行中');
        if (parts.length) b.appendChild(el('span', 'cyc-sub', parts.join(' · ')));
        const bar = el('span', 'cyc-bar');
        const fill = el('i');
        fill.style.width = Math.max(0, Math.min(100, Number(c.level_after))) + '%';
        bar.appendChild(fill);
        b.appendChild(bar);
        strip.appendChild(b);
      });
    }
    strip.querySelectorAll('.cyc-chip').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.idx) === S.cycleIdx));

    /* --- 能量占比环:围绕玻璃顶一圈(自顶点顺时针),pathLength=100 归一化 --- */
    const RING_KEYS = ['uncharged', 'idle', 'sentry', 'drive', 'remaining'];
    const GAP = 0.8;  // 段间缝隙(占环长 %)
    const setRing = (k, start, len) => {
      const p = $(`#carring-${k}`);
      if (!p) return;
      if (len <= GAP) {
        p.setAttribute('stroke-dasharray', '0 100');
        return;
      }
      p.setAttribute('stroke-dasharray',
        `${(len - GAP).toFixed(2)} ${(100 - len + GAP).toFixed(2)}`);
      p.setAttribute('stroke-dashoffset', (-(start + GAP / 2)).toFixed(2));
    };
    if (!cyc) {
      RING_KEYS.forEach((k) => {
        const p = $(`#carring-${k}`);
        if (p) p.setAttribute('stroke-dasharray', '0 100');
      });
    } else {
      // 顶点起第一段斜纹 = 本次未充(100% − 充至电量);充入区各段按估算值归一化填满
      // (驻车耗电后端已合并:驻车开空调 + 休眠掉电;哨兵单列)
      const inner = [
        ['uncharged', Number(cyc.uncharged_pct), true],
        ['idle', Number(cyc.idle_pct), false],
        ['sentry', Number(cyc.sentry_pct), false],
        ['drive', Number(cyc.drive_pct), false],
        ['remaining', Number(cyc.remaining_pct), false],
      ];
      const normSum = inner.slice(1).reduce((s, x) => s + x[1], 0);
      const scale = normSum > 0 ? cyc.level_after / normSum : 0;
      let cum = 100;
      inner.forEach(([k, v, raw]) => {
        const frac = raw ? v : v * scale;
        setRing(k, 100 - cum, frac);
        cum -= frac;
      });
    }

    /* --- 左列:里程统计(额定续航 / 本月里程 / 本周里程,仅展示) --- */
    const lat = o.latest || null;
    const t = o.totals || {};
    const rated = lat && lat.rated_battery_range_km != null ? Number(lat.rated_battery_range_km) : null;
    const odo = lat && lat.odometer != null ? Number(lat.odometer) : null;
    const usable = lat && lat.usable_battery_level != null ? Number(lat.usable_battery_level) : null;
    const fullKm = kmFull();
    const statCol = $('#car-legend-l');
    statCol.textContent = '';
    [
      { name: '额定续航', v: rated, sub: fullKm === null ? '' : `满电约 ${fmtNum(fullKm, 0)} km` },
      { name: '本月里程', v: t.month_km != null ? Number(t.month_km) : null, sub: '' },
      { name: '本周里程', v: t.week_km != null ? Number(t.week_km) : null, sub: '' },
    ].forEach((s) => {
      const d = el('div', 'cl-item cl-stat');
      const tx = el('div');
      tx.appendChild(el('b', '', s.name));
      tx.appendChild(el('span', 'cl-val', s.v === null ? '—' : `${fmtNum(s.v, 0)} km`));
      if (s.sub) tx.appendChild(el('span', 'cl-sub', s.sub));
      d.appendChild(tx);
      statCol.appendChild(d);
    });

    /* --- 电池健康(小模块,无曲线):基准=历史最高满电容量估算,当前=最新一次充电估算 --- */
    const bh = S.health;
    const bhItem = el('div', 'cl-item cl-stat');
    const bhTx = el('div');
    bhTx.appendChild(el('b', '', '电池健康'));
    const bhHas = bh && bh.health_pct !== null && bh.health_pct !== undefined;
    const bhVal = el('span', 'cl-val', bhHas ? `${fmtNum(bh.health_pct, 1)} %` : '—');
    if (bhHas) {
      bhVal.style.color =
        bh.health_pct >= 97 ? '#3fae72' : bh.health_pct >= 90 ? '#fab219' : '#d03b3b';
    }
    bhTx.appendChild(bhVal);
    bhTx.appendChild(el('span', 'cl-sub', bhHas
      ? `估算 ${fmtNum(bh.current_kwh, 1)} / 基准 ${fmtNum(bh.nominal_kwh, 1)} kWh`
      : '暂无充电数据'));
    if (bhHas) {
      bhTx.appendChild(el('span', 'cl-sub',
        `最近充电 ${fmtTime(bh.last_ts)} · ${bh.samples} 次样本`));
    }
    bhItem.appendChild(bhTx);
    statCol.appendChild(bhItem);

    /* --- 车身读数:车头总里程 / 前风挡电量横向填充 / 玻璃中央车标+车内温度 / 后风挡车外温度 --- */
    $('#car-odo').textContent = odo === null ? '—' : `${fmtNum(odo, 0)} km`;
    const wr = $('#carfill-batt');
    if (wr) {
      const WW = 146;  // 前风挡宽(x 97..243),横向填充
      wr.setAttribute('width',
        (usable === null ? 0 : Math.max(0, Math.min(100, usable)) / 100 * WW).toFixed(1));
      // 充电中:填充变绿并循环扫光(见 style.css .car-svg.charging)
      wr.closest('svg').classList.toggle('charging', o.state === 'charging');
    }
    $('#car-batt-val').textContent = usable === null ? '—' : `${fmtNum(usable, 0)}%`;
    // 玻璃顶中央固定 Tesla 图形车标(见 index.html #car-logo),不再随车型切换徽章
    const inT = lat && lat.inside_temp != null ? Number(lat.inside_temp) : null;
    const outT = lat && lat.outside_temp != null ? Number(lat.outside_temp) : null;
    $('#car-center-temp').textContent = inT === null ? '—' : `车内 ${fmtNum(inT, 1)}°`;
    $('#car-temp-val').textContent = outT === null ? '—' : `${fmtNum(outT, 1)}°`;
    renderCompanion();

    // 车辆顶部:本周期平均能耗条状控件(文字内嵌;官方能耗=额定折算系数,作刻度竖线)
    const effG = $('#car-eff');
    if (effG) {
      const dKwh = cyc && cyc.drive_kwh != null ? Number(cyc.drive_kwh) : 0;
      const dKm = cyc && cyc.drive_km != null ? Number(cyc.drive_km) : 0;
      const official = o.kwh_per_ideal_km ? Number(o.kwh_per_ideal_km) * 1000 : null;
      if (dKm >= 1 && official) {
        const eff = dKwh * 1000 / dKm;
        const LO = 100, HI = 200;   // 刻度 100..200 Wh/km
        const map = (v) => Math.max(0, Math.min(1, (v - LO) / (HI - LO))) * 100;
        // 两端刻度数字:量程端点,随 LO/HI 同步
        $('#car-eff-min').textContent = LO;
        $('#car-eff-max').textContent = HI;
        // 低于官方绿 / 高 10% 内黄 / 再高红
        const rel = eff / official;
        const c = rel <= 1 ? '#3fae72' : rel <= 1.1 ? '#fab219' : '#d03b3b';
        const bar = $('#car-eff-bar');
        bar.style.setProperty('--eff-c', c);
        bar.title = `本周期平均能耗 ${fmtNum(eff, 0)} Wh/km · 官方 ${fmtNum(official, 0)} Wh/km`;
        const fill = $('#car-eff-fill');
        fill.style.width = map(eff).toFixed(1) + '%';
        fill.style.background = `linear-gradient(90deg, ${c}14, ${c}30)`;
        fill.style.boxShadow = `inset 0 -3px 0 ${c}`;
        $('#car-eff-official').style.left = map(official).toFixed(1) + '%';
        const offVal = $('#car-eff-official-val');
        offVal.style.left = map(official).toFixed(1) + '%';
        offVal.textContent = fmtNum(official, 0);
        $('#car-eff-val').textContent = `${fmtNum(eff, 0)} Wh/km`;
        effG.hidden = false;
      } else {
        effG.hidden = true;
      }
    }

    /* --- 右列:全部电耗分段(未充/驻车耗电/哨兵/行驶/剩余,与车身分带点选联动) --- */
    const cap = cyc && cyc.cap_kwh ? Number(cyc.cap_kwh) : 84;
    const itemsR = [
      { k: 'uncharged', name: '本次未充', pct: cyc ? Number(cyc.uncharged_pct) : null, hatch: true },
      { k: 'idle', name: '驻车耗电', pct: cyc ? Number(cyc.idle_pct) : null, color: 'var(--cat-idle)' },
      { k: 'sentry', name: '哨兵', pct: cyc ? Number(cyc.sentry_pct) : null, color: 'var(--cat-sentry)' },
      { k: 'drive', name: '行驶', pct: cyc ? Number(cyc.drive_pct) : null, color: 'var(--cat-drive)' },
      { k: 'remaining', name: cyc && !cyc.active ? '周期末剩余' : '当前剩余',
        pct: cyc ? Number(cyc.remaining_pct) : null, color: 'var(--series-1)' },
    ];
    const fillCol = (id, items) => {
      const box = $(id);
      box.textContent = '';
      items.forEach((it) => {
        const d = el('div', 'cl-item');
        d.dataset.k = it.k;
        d.style.setProperty('--cl-c', it.color || 'var(--baseline)');
        if (carSel === it.k) d.classList.add('on');
        const dot = el('span', 'cl-dot' + (it.hatch ? ' dot-hatch' : ''));
        if (it.color) dot.style.background = it.color;
        d.appendChild(dot);
        const tx = el('div');
        tx.appendChild(el('b', '', it.name));
        if (it.pct === null || carModeEffective() === 'pct') {
          tx.appendChild(el('span', 'cl-val', it.pct === null ? '—' : `${fmtNum(it.pct, 1)}%`));
        } else {
          const conv = carConvPct(it.pct, cap);
          tx.appendChild(el('span', 'cl-val',
            conv.v === null ? '—' : `${fmtNum(conv.v, conv.dec)} ${conv.unit}`));
          tx.appendChild(el('span', 'cl-sub', `${fmtNum(it.pct, 1)}%`));
        }
        d.appendChild(tx);
        box.appendChild(d);
      });
    };
    fillCol('#car-legend-r', itemsR);


    /* --- 四轮胎压:当前值直接写在轮胎上(最近 24 小时最后一条上报);
           统一按与标准胎压 2.9 bar 的偏差着色;趋势图见「车况」页 --- */
    const TPMS_STD = 2.9;
    const tpmsColor = (v) => {
      const dev = Math.abs(v - TPMS_STD);
      return dev <= 0.15 ? '#3fae72' : dev <= 0.3 ? '#fab219' : '#d03b3b';
    };
    const w = (o.tpms24 && o.tpms24.wheels) || {};
    ['fl', 'fr', 'rl', 'rr'].forEach((key) => {
      const data = (w[key] || []).map((p) => [Number(p[0]), Number(p[1])]);
      const lastV = data.length ? data[data.length - 1][1] : null;
      const t = $(`#tpms-on-${key}`);
      if (!t) return;
      t.textContent = lastV === null ? '—' : fmtNum(lastV, 1);
      t.style.fill = lastV === null ? 'var(--text-muted)' : tpmsColor(lastV);
    });
  }

  /* ---------- 渲染:充电详情(卡片式,纵向布局,适配手机) ---------- */

  function fmtDur(min) {
    const m = Number(min);
    if (!m || m <= 0) return '—';
    if (m < 60) return `${fmtNum(m, 0)} 分`;
    return `${Math.floor(m / 60)} 小时 ${fmtNum(m % 60, 0)} 分`;
  }

  // 秒级时长(堵车/红灯统计用,0 也如实显示为「0 分」)
  function fmtSec(s) {
    const sec = Number(s) || 0;
    const m = sec / 60;
    if (m < 1) return `${Math.round(sec)} 秒`;
    if (m < 60) return `${fmtNum(m, 0)} 分`;
    return `${Math.floor(m / 60)} 小时 ${fmtNum(m % 60, 0)} 分`;
  }

  // 保存后定向刷新:sessions 必刷;费用变动还要同步活动事件的金额(不重置地图视野)
  async function csRefresh(withCosts) {
    const reqs = [api(`charging/sessions?days=${S.days}`)];
    if (withCosts) reqs.push(api(`activity?days=${S.days}`));
    const [sessions, act] = await Promise.all(reqs);
    S.sessions = sessions;
    if (withCosts) {
      S.overview.activity = act;
    }
    renderSessions();
    renderChargers();
    renderCsBatt();
    if (withCosts) { renderEvents(); renderActivity(); }
  }

  async function csSave(path, body, inps, withCosts) {
    try {
      await fetchJSON(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await csRefresh(withCosts);
    } catch (err) {
      console.error(err);
      (inps || []).forEach((inp) => {
        inp.disabled = false;
        inp.value = inp.dataset.orig || '';
        inp.title = '保存失败,请重试';
      });
    }
  }

  /* ---------- 家充设置(充电页底部):总开关 + 多地点峰谷电价 ---------- */

  // 家充配置影响 sessions 的自动电费与活动事件计价,保存后一并刷新
  async function hcRefresh() {
    const [home, sessions, act] = await Promise.all([
      api('charging/home'),
      api(`charging/sessions?days=${S.days}`),
      api(`activity?days=${S.days}`),
    ]);
    S.homeCharge = home;
    S.sessions = sessions;
    S.overview.activity = act;
    renderHomeCharge(); renderSessions(); renderChargers(); renderCsBatt();
    renderEvents(); renderActivity();
  }

  async function hcSave(path, body, method) {
    try {
      await fetchJSON(path, method === 'DELETE' ? { method: 'DELETE' } : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await hcRefresh();
    } catch (err) { console.error(err); }
  }

  function hcSwitch(checked, disabled, onChange) {
    const lab = el('label', 'tsw');
    const inp = el('input');
    inp.type = 'checkbox';
    inp.checked = checked;
    inp.disabled = !!disabled;
    inp.addEventListener('change', () => { inp.disabled = true; onChange(inp.checked); });
    lab.appendChild(inp);
    lab.appendChild(el('i'));
    return lab;
  }

  function hcNumInput(val, ph, disabled) {
    const i = el('input');
    i.type = 'number'; i.min = '0'; i.max = '50'; i.step = '0.01';
    i.inputMode = 'decimal'; i.placeholder = ph;
    if (val !== null && val !== undefined) i.value = val;
    i.disabled = !!disabled;
    return i;
  }

  function renderHomeCharge() {
    const body = $('#hc-body');
    if (!body) return;
    body.textContent = '';
    const hc = S.homeCharge;
    if (!hc) return;
    const canEdit = S.overview && S.overview.role === 'admin';

    // 折叠头部的小统计:已启用家充数
    const stats = $('#hc-stats');
    stats.textContent = '';
    if (hc.chargers.length) {
      const t = el('span', 'mini-stat');
      t.appendChild(el('span', '', '家充 '));
      t.appendChild(el('b', '', `${hc.chargers.filter((c) => c.enabled).length}/${hc.chargers.length}`));
      t.appendChild(el('span', '', ' 启用'));
      stats.appendChild(t);
    }

    // 总开关:开启后,已启用家充地点的充电默认按峰谷电价计费
    const master = el('div', 'hc-master');
    master.appendChild(hcSwitch(hc.master, !canEdit,
      (v) => hcSave('/api/charging/home/master', { enabled: v })));
    const mt = el('div');
    mt.appendChild(el('b', '', '家充自动计价'));
    mt.appendChild(el('div', 'hc-hint', hc.master
      ? '已开启:在已启用家充地点的充电按峰谷电价自动计费(手填费用仍优先)'
      : '开启后,在已启用家充地点的充电默认按家充峰谷电价计费'));
    master.appendChild(mt);
    body.appendChild(master);

    // 已配家充地点:开关 / 名称 / 峰谷电价 / 谷时段 / 删除
    const list = el('div', 'hc-list');
    hc.chargers.forEach((c) => {
      const row = el('div', 'hc-row' + (c.enabled ? '' : ' off'));

      const mid = el('div');
      const nameInp = el('input', 'hc-name');
      nameInp.type = 'text'; nameInp.value = c.name; nameInp.maxLength = 80;
      nameInp.placeholder = '家充名称'; nameInp.disabled = !canEdit;
      mid.appendChild(nameInp);
      mid.appendChild(el('div', 'hc-loc', `${c.location || c.key} · ${c.sessions} 次充电`));

      const prices = el('div', 'hc-prices');
      const peakInp = hcNumInput(c.peak, '峰价', !canEdit);
      const valleyInp = hcNumInput(c.valley, '谷价', !canEdit);
      const vsInp = el('input'); vsInp.type = 'time'; vsInp.value = c.vstart; vsInp.disabled = !canEdit;
      const veInp = el('input'); veInp.type = 'time'; veInp.value = c.vend; veInp.disabled = !canEdit;
      prices.appendChild(el('span', '', '峰'));
      prices.appendChild(peakInp);
      prices.appendChild(el('span', '', '谷'));
      prices.appendChild(valleyInp);
      prices.appendChild(el('span', '', '¥/kWh · 谷时段'));
      prices.appendChild(vsInp);
      prices.appendChild(el('span', '', '–'));
      prices.appendChild(veInp);

      // 读取当前所有输入组装整条配置(switch 的勾选值由调用方传入)
      const collect = (enabled) => ({
        key: c.key, enabled,
        name: nameInp.value.trim() || c.name,
        peak: peakInp.value.trim() === '' ? null : parseFloat(peakInp.value),
        valley: valleyInp.value.trim() === '' ? null : parseFloat(valleyInp.value),
        vstart: vsInp.value || null,
        vend: veInp.value || null,
      });
      const trySave = () => {
        const p = collect(c.enabled);
        const bad = (v) => v !== null && (isNaN(v) || v < 0 || v > 50);
        if (bad(p.peak) || bad(p.valley) || (p.peak === null && p.valley === null)) {
          peakInp.value = c.peak ?? ''; valleyInp.value = c.valley ?? '';
          peakInp.title = valleyInp.title = '电价需在 0–50 之间,峰/谷至少填一个';
          return;
        }
        [nameInp, peakInp, valleyInp, vsInp, veInp].forEach((i) => { i.disabled = true; });
        hcSave('/api/charging/home/charger', p);
      };
      [nameInp, peakInp, valleyInp, vsInp, veInp].forEach((i) => i.addEventListener('change', trySave));

      row.appendChild(hcSwitch(c.enabled, !canEdit,
        (v) => hcSave('/api/charging/home/charger', collect(v))));
      row.appendChild(mid);
      row.appendChild(prices);
      if (canEdit) {
        const del = el('button', 'hc-del', '✕');
        del.type = 'button';
        del.title = '删除该家充';
        del.addEventListener('click', () => {
          del.disabled = true;
          hcSave('/api/charging/home/charger?key=' + encodeURIComponent(c.key), null, 'DELETE');
        });
        prices.appendChild(del);
      }
      list.appendChild(row);
    });
    body.appendChild(list);

    if (!hc.chargers.length && !canEdit) {
      body.appendChild(el('div', 'empty', '尚未添加家充地点'));
      return;
    }

    // 添加家充:从有充电记录的地点中选择,至少填一个电价
    if (canEdit) {
      const avail = hc.candidates.filter((x) => !x.added);
      const add = el('div', 'hc-add');
      const sel = el('select');
      if (avail.length) avail.forEach((x) => sel.appendChild(new Option(`${x.name}(${x.count} 次)`, x.key)));
      else sel.appendChild(new Option('没有更多可添加的充电地点', ''));
      const pk = hcNumInput(null, '峰价', false);
      const vy = hcNumInput(null, '谷价', false);
      const btn = el('button', '', '添加家充');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (!sel.value) return;
        const peak = pk.value.trim() === '' ? null : parseFloat(pk.value);
        const valley = vy.value.trim() === '' ? null : parseFloat(vy.value);
        if ((peak === null || isNaN(peak)) && (valley === null || isNaN(valley))) {
          pk.title = vy.title = '峰时电价与谷时电价至少填写一个';
          return;
        }
        btn.disabled = true;
        hcSave('/api/charging/home/charger', {
          key: sel.value, name: '', enabled: true,
          peak: isNaN(peak) ? null : peak, valley: isNaN(valley) ? null : valley,
          vstart: null, vend: null,
        });
      });
      add.appendChild(sel);
      add.appendChild(el('span', '', '峰'));
      add.appendChild(pk);
      add.appendChild(el('span', '', '谷'));
      add.appendChild(vy);
      add.appendChild(el('span', '', '¥/kWh'));
      add.appendChild(btn);
      body.appendChild(add);
    }
  }

  function renderSessions() {
    const box = $('#cs-list');
    if (!box || !S.sessions) return;
    box.textContent = '';
    const charges = S.sessions.charges || [];

    // 概览统计
    const stats = $('#cs-stats');
    stats.textContent = '';
    const stat = (label, value, unit) => {
      const t = el('span', 'mini-stat');
      t.appendChild(el('span', '', label + ' '));
      t.appendChild(el('b', '', String(value)));
      if (unit) t.appendChild(el('span', '', ' ' + unit));
      stats.appendChild(t);
    };
    if (charges.length) {
      stat('充电', charges.length, '次');
      // 费用合计按有效费用(手填优先,家充自动计价其次)
      const eff = (c) => (c.cost !== null && c.cost !== undefined) ? c.cost : c.cost_effective;
      const paid = charges.filter((c) => eff(c) !== null && eff(c) !== undefined);
      if (paid.length) {
        stat('费用合计', fmtNum(paid.reduce((s, c) => s + eff(c), 0), 2), '¥');
      }
    }
    if (!charges.length) {
      box.appendChild(el('div', 'empty', '所选时间范围内暂无充电记录'));
      return;
    }

    const canEdit = S.overview && S.overview.role === 'admin';
    charges.forEach((c) => {
      const item = el('div', 'cs-item');

      /* 头部:充电时间(左)+ 充电桩名称/地点(右,可编辑,同地点自动带出) */
      const head = el('div', 'cs-head');
      const timeBox = el('div', 'cs-time');
      const sameDay = c.end_ts && dayKey(c.start_ts) === dayKey(c.end_ts);
      timeBox.appendChild(el('b', '', fmtTime(c.start_ts) +
        (c.end_ts ? ` → ${sameDay ? fmtClock(c.end_ts) : fmtTime(c.end_ts)}` : '')));
      if (!c.end_ts) timeBox.appendChild(el('span', 'cs-time-sub', '充电中'));
      head.appendChild(timeBox);

      const chg = el('div', 'cs-charger');
      const nameInp = el('input', 'cs-name-input');
      nameInp.type = 'text';
      nameInp.placeholder = '充电桩名称';
      nameInp.maxLength = 80;
      nameInp.value = c.charger_name || '';
      nameInp.dataset.orig = c.charger_name || '';
      const locInp = el('input', 'cs-loc-input');
      locInp.type = 'text';
      locInp.placeholder = c.loc_key ? '地点' : '地点(本次充电无地点信息,无法存档)';
      locInp.maxLength = 120;
      locInp.value = c.charger_location || '';
      locInp.dataset.orig = c.charger_location || '';
      // 品牌与名称/地点一起存档(按地点键,同地点自动带出)
      const brandInp = el('input', 'cs-brand-input');
      brandInp.type = 'text';
      brandInp.placeholder = '品牌';
      brandInp.maxLength = 40;
      brandInp.value = c.charger_brand || '';
      brandInp.dataset.orig = c.charger_brand || '';
      const saveCharger = () => {
        const name = nameInp.value.trim();
        const loc = locInp.value.trim();
        const brand = brandInp.value.trim();
        if (name === nameInp.dataset.orig && loc === locInp.dataset.orig
            && brand === brandInp.dataset.orig) return;
        nameInp.disabled = locInp.disabled = brandInp.disabled = true;
        csSave('/api/charging/charger',
          { charge_id: c.id, name, location: loc, brand },
          [nameInp, locInp, brandInp], false);
      };
      nameInp.addEventListener('change', saveCharger);
      locInp.addEventListener('change', saveCharger);
      brandInp.addEventListener('change', saveCharger);
      chg.appendChild(nameInp);
      chg.appendChild(brandInp);
      chg.appendChild(locInp);
      head.appendChild(chg);
      item.appendChild(head);

      /* 字段区:label + value,两列网格 */
      const fields = el('div', 'cs-fields');
      const field = (label, val) => {
        const f = el('div', 'cs-field');
        f.appendChild(el('span', 'cs-label', label));
        const v = el('span', 'cs-val');
        if (typeof val === 'string') v.textContent = val;
        else v.appendChild(val);
        f.appendChild(v);
        fields.appendChild(f);
      };
      const numInput = (placeholder) => {
        const inp = el('input', 'cost-input');
        inp.type = 'number';
        inp.min = '0';
        inp.step = '0.01';
        inp.inputMode = 'decimal';
        inp.placeholder = placeholder;
        return inp;
      };

      field('充电量', c.energy_kwh !== null && c.energy_kwh !== undefined
        ? `${fmtNum(c.energy_kwh, 2)} kWh` : '—');

      // 总耗电(桩端计费电量,含损耗):手填优先,未填显示车端记录值并标注
      const totalWrap = el('span', 'cs-inline');
      const totalInp = numInput('未填');
      if (c.total_kwh !== null && c.total_kwh !== undefined) totalInp.value = c.total_kwh;
      totalInp.dataset.orig = c.total_kwh !== null && c.total_kwh !== undefined
        ? String(c.total_kwh) : '';
      totalInp.addEventListener('change', () => {
        const raw = totalInp.value.trim();
        const v = raw === '' ? null : parseFloat(raw);
        if (raw !== '' && (isNaN(v) || v < 0 || v > 500)) {
          totalInp.value = totalInp.dataset.orig;
          return;
        }
        if ((v === null ? '' : String(v)) === totalInp.dataset.orig) return;
        totalInp.disabled = true;
        csSave('/api/charging/extras', { charge_id: c.id, total_kwh: v }, [totalInp], false);
      });
      totalWrap.appendChild(totalInp);
      totalWrap.appendChild(el('span', 'cs-unit', 'kWh'));
      if (c.total_kwh !== null && c.total_kwh !== undefined) {
        totalWrap.appendChild(el('span',
          c.total_kwh_manual ? 'cs-tag cs-tag-manual' : 'cs-tag',
          c.total_kwh_manual ? '手填' : '车端'));
      }
      field('总耗电', totalWrap);

      // 充电费用(与「充电费用」表共用同一份数据)
      const costWrap = el('span', 'cs-inline');
      const costInp = numInput('未填');
      if (c.cost !== null && c.cost !== undefined) costInp.value = c.cost;
      costInp.dataset.orig = c.cost !== null && c.cost !== undefined ? String(c.cost) : '';
      costInp.addEventListener('change', () => {
        const v = parseFloat(costInp.value);
        if (isNaN(v) || v < 0) {
          costInp.value = costInp.dataset.orig;
          return;
        }
        costInp.disabled = true;
        csSave('/api/charging/costs', { charge_id: c.id, cost: v }, [costInp], true);
      });
      costWrap.appendChild(costInp);
      costWrap.appendChild(el('span', 'cs-unit', '¥'));
      // 未手填费用且命中家充计价时,标注自动算出的电费(哪个家充见下方「家充计价」行)
      if ((c.cost === null || c.cost === undefined)
          && c.cost_home !== null && c.cost_home !== undefined) {
        costWrap.appendChild(el('span', 'cs-tag cs-tag-home', `家充 ¥${fmtNum(c.cost_home, 2)}`));
      }
      field('充电费用', costWrap);

      // 家充计价方式:自动(按地点)/ 本次不计 / 指定某个家充,改后自动重算电费
      const hcCfg = S.homeCharge;
      if (hcCfg && (hcCfg.chargers || []).length) {
        const mode = c.home_mode || 'auto';
        if (canEdit) {
          const sel = el('select', 'cs-home-sel');
          sel.appendChild(new Option('自动(按地点)', 'auto'));
          sel.appendChild(new Option('本次不按家充计', 'off'));
          hcCfg.chargers.forEach((h) => sel.appendChild(new Option(`按「${h.name}」计`, h.key)));
          sel.value = hcCfg.chargers.some((h) => h.key === mode) || mode === 'off' ? mode : 'auto';
          sel.addEventListener('change', () => {
            sel.disabled = true;
            csSave('/api/charging/home/assign', { charge_id: c.id, mode: sel.value }, [], true);
          });
          field('家充计价', sel);
        } else {
          field('家充计价', mode === 'off' ? '本次不按家充计'
            : mode === 'auto' ? '自动(按地点)' : `按「${c.home_name}」计`);
        }
      }

      field('电费单价', c.rate_yuan_kwh !== null && c.rate_yuan_kwh !== undefined
        ? `¥${fmtNum(c.rate_yuan_kwh, 2)} /kWh` : '—');
      field('起止电量', (c.start_battery_level !== null && c.end_battery_level !== null
        && c.start_battery_level !== undefined && c.end_battery_level !== undefined)
        ? `${fmtNum(c.start_battery_level, 0)}% → ${fmtNum(c.end_battery_level, 0)}%` : '—');
      field('充电时长', fmtDur(c.duration_min));
      field('充电后行驶里程', `${fmtNum(c.after_km, 1)} km`);
      field('充电后每公里费用', c.per_km_yuan !== null && c.per_km_yuan !== undefined
        ? `¥${fmtNum(c.per_km_yuan, 2)} /km` : '—');

      item.appendChild(fields);
      box.appendChild(item);
    });
  }

  /* ---------- 渲染:充电桩统计(按桩聚合 sessions 数据,可展开详情) ---------- */

  const cgOpen = new Set();  // 展开的充电桩(按地点键),跨刷新保持展开状态

  function renderChargers() {
    const box = $('#cg-list');
    if (!box || !S.sessions) return;
    box.textContent = '';
    const charges = S.sessions.charges || [];
    if (!charges.length) {
      box.appendChild(el('div', 'empty', '所选时间范围内暂无充电记录'));
      return;
    }

    // 按地点键分组;无地点信息的会话无法跨次关联,归入「未记录地点」
    const agg = new Map();
    charges.forEach((c) => {
      const key = c.loc_key || 'noloc';
      const g = agg.get(key) || {
        key, name: '', location: '', brand: '', firstId: c.id, list: [],
        count: 0, energy: 0, dur: 0, cost: 0, hasCost: false,
        ePaired: 0, uPaired: 0,  // 仅「充电量与总耗电都有值」的会话参与损耗计算
      };
      if (!g.name && c.charger_name) g.name = c.charger_name;
      if (!g.location && c.charger_location) g.location = c.charger_location;
      if (!g.brand && c.charger_brand) g.brand = c.charger_brand;
      g.count += 1;
      if (c.energy_kwh !== null && c.energy_kwh !== undefined) g.energy += Number(c.energy_kwh);
      g.dur += Number(c.duration_min) || 0;
      const effC = (c.cost !== null && c.cost !== undefined) ? c.cost : c.cost_effective;
      if (effC !== null && effC !== undefined) { g.cost += Number(effC); g.hasCost = true; }
      if (c.energy_kwh != null && c.total_kwh != null && Number(c.total_kwh) > 0) {
        g.ePaired += Number(c.energy_kwh);
        g.uPaired += Number(c.total_kwh);
      }
      g.list.push(c);
      agg.set(key, g);
    });
    const rows = [...agg.values()].sort((a, b) => b.energy - a.energy);

    rows.forEach((g) => {
      const open = cgOpen.has(g.key);
      const item = el('div', open ? 'cg-item open' : 'cg-item');

      /* 汇总行(点击展开/收起) */
      const row = el('div', 'cg-row');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const head = el('div', 'cg-head');
      const nameLine = el('div', 'cg-name');
      nameLine.appendChild(el('b', '', g.name || g.location || '未命名充电桩'));
      if (g.brand) nameLine.appendChild(el('span', 'cg-brand', g.brand));
      head.appendChild(nameLine);
      if (g.name && g.location) head.appendChild(el('span', 'cg-loc', g.location));
      row.appendChild(head);

      const stats = el('div', 'cg-stats');
      const chip = (label, value, cls) => {
        const t = el('span', ('cg-chip ' + (cls || '')).trim());
        t.appendChild(el('span', '', label + ' '));
        t.appendChild(el('b', '', value));
        stats.appendChild(t);
      };
      chip('充电', `${g.count} 次`);
      chip('充电量', `${fmtNum(g.energy, 1)} kWh`);
      chip('时长', fmtDur(g.dur));
      if (g.uPaired > 0) {
        const loss = g.uPaired - g.ePaired;
        const pct = loss / g.uPaired * 100;
        const cls = pct >= 10 ? 'cg-loss-high' : (pct < 5 ? 'cg-loss-low' : '');
        chip('损耗', `${fmtNum(pct, 1)}% (${fmtNum(loss, 1)} kWh)`, cls);
      } else {
        chip('损耗', '—');
      }
      if (g.hasCost) chip('费用', `¥${fmtNum(g.cost, 2)}`);
      row.appendChild(stats);
      row.appendChild(el('span', 'cg-arrow', '▾'));

      /* 详情(默认折叠):品牌填写 + 每次充电明细 */
      const detail = el('div', 'cg-detail');
      detail.hidden = !open;
      const toggle = () => {
        if (cgOpen.has(g.key)) cgOpen.delete(g.key);
        else cgOpen.add(g.key);
        const nowOpen = item.classList.toggle('open');
        detail.hidden = !nowOpen;
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      item.appendChild(row);

      const brandRow = el('div', 'cg-brand-row');
      brandRow.appendChild(el('span', 'cs-label', '品牌'));
      const brandInp = el('input', 'cg-brand-input');
      brandInp.type = 'text';
      brandInp.maxLength = 40;
      brandInp.placeholder = g.key === 'noloc'
        ? '无地点信息,无法存档' : '如 特来电 / 星星充电 / 家充';
      brandInp.value = g.brand;
      brandInp.dataset.orig = g.brand;
      if (g.key === 'noloc') brandInp.disabled = true;
      brandInp.addEventListener('change', () => {
        const v = brandInp.value.trim();
        if (v === brandInp.dataset.orig) return;
        brandInp.disabled = true;
        // 借用该地点下任意一次充电的 id 定位地点键;名称/地点原样带上,服务端保留不覆盖
        csSave('/api/charging/charger',
          { charge_id: g.firstId, name: g.name, location: g.location, brand: v },
          [brandInp], false);
      });
      brandRow.appendChild(brandInp);
      detail.appendChild(brandRow);

      g.list.forEach((c) => {  // sessions 本身新的在前
        const line = el('div', 'cg-line');
        line.appendChild(el('b', '', fmtTime(c.start_ts)));
        const parts = [];
        if (c.energy_kwh !== null && c.energy_kwh !== undefined) {
          parts.push(`${fmtNum(c.energy_kwh, 1)} kWh`);
        }
        if (c.total_kwh !== null && c.total_kwh !== undefined) {
          parts.push(`总耗电 ${fmtNum(c.total_kwh, 1)}`);
        }
        if (c.total_kwh != null && c.energy_kwh != null && Number(c.total_kwh) > 0) {
          parts.push(`损耗 ${fmtNum((c.total_kwh - c.energy_kwh) / c.total_kwh * 100, 1)}%`);
        }
        parts.push(fmtDur(c.duration_min));
        const effCost = (c.cost !== null && c.cost !== undefined) ? c.cost : c.cost_effective;
        if (effCost !== null && effCost !== undefined) {
          parts.push(`¥${fmtNum(effCost, 2)}` +
            ((c.cost === null || c.cost === undefined) ? '(家充)' : ''));
        }
        line.appendChild(el('span', 'cg-line-sub', parts.join(' · ')));
        detail.appendChild(line);
      });
      item.appendChild(detail);
      box.appendChild(item);
    });
  }

  /* ---------- 渲染:电池电量估算条形图(充电详情卡底部,并入同卡) ----------
     每次充电:充后总电量 = 充至电量% × 估算满电;估算满电 = 充电量 ÷ 增幅
     (与「电池健康」同口径:增幅 <10% 或估算超出 30–150 kWh 的样本不参与) */

  function renderCsBatt() {
    const box = $('#chart-cs-batt');
    if (!box || !S.overview) return;
    // 数据源同「充电记录」上图(charging/summary,最近 12 次,不随时间范围裁剪)
    const pts = [];
    (S.overview.chargingSessions || []).slice().reverse().forEach((c) => {  // 旧的在前
      const s = c.start_battery_level, e = c.end_battery_level;
      if (s == null || e == null || c.charge_energy_added == null || !c.end_date_ts) return;
      const d = e - s;
      if (d < 10) return;
      const full = Number(c.charge_energy_added) / d * 100;
      if (full < 30 || full > 150) return;
      pts.push({ ts: c.end_date_ts, level: e, full: Math.round(full * 10) / 10,
                 after: Math.round(e * full) / 100 });
    });
    const emptyEl = $('#cs-batt-empty');
    if (!pts.length) {
      box.style.display = 'none';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    box.style.display = '';
    if (emptyEl) emptyEl.hidden = true;
    if (!charts.csBatt) charts.csBatt = echarts.init(box);
    charts.csBatt.setOption(Object.assign({}, chartTheme(), {
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssVar('--surface-1'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: [6, 10],
        textStyle: { color: cssVar('--text-primary'), fontSize: 12 },
        extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.18);border-radius:8px;',
        axisPointer: { type: 'shadow', shadowStyle: { color: cssVar('--tile-track') } },
        formatter(params) {
          const p = pts[params[0].dataIndex];
          // 堆叠柱第二段是「差额」,tooltip 要显示换算出的完整估算值
          return `<div style="color:${cssVar('--text-muted')};font-size:10px">` +
                 `${fmtTime(p.ts)} · 充至 ${fmtNum(p.level, 0)}%</div>` +
                 `${params[0].marker} 充后总电量 <b>${fmtNum(p.after, 1)} kWh</b><br>` +
                 `${params[1].marker} 估算满电 <b>${fmtNum(p.full, 1)} kWh</b>`;
        },
      },
      legend: {
        top: 0, right: 0,
        textStyle: { color: cssVar('--text-muted'), fontSize: 11 },
        itemWidth: 12, itemHeight: 8,
        data: [
          { name: '充后总电量' },
          // 图例图标同步虚线框样式(系列本身是透明填充)
          { name: '估算满电', itemStyle: { color: 'transparent',
              borderColor: cssVar('--series-3'), borderWidth: 1.5, borderType: 'dashed' } },
        ],
      },
      grid: { left: 8, right: 12, top: 30, bottom: 4, containLabel: true },
      // 与上方「充电记录」一致:按充电日期类目轴
      xAxis: Object.assign(axisCommon(), { type: 'category',
        data: pts.map((p) => fmtTime(Number(p.ts)).slice(0, 5)),
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11 } }),
      yAxis: Object.assign({ type: 'value', name: 'kWh', scale: true,
        nameTextStyle: { color: cssVar('--text-muted'), fontSize: 10 } }, axisCommon()),
      series: [
        // 实心柱:充后总电量;上方虚线框柱:到估算满电的差额(柱顶即估算满电)
        { name: '充后总电量', type: 'bar', stack: 'batt', barMaxWidth: 22,
          data: pts.map((p) => p.after),
          itemStyle: { color: cssVar('--series-1'), borderRadius: [0, 0, 0, 0] } },
        { name: '估算满电', type: 'bar', stack: 'batt', barMaxWidth: 22,
          data: pts.map((p) => Math.round((p.full - p.after) * 10) / 10),
          itemStyle: {
            color: 'transparent',
            borderColor: cssVar('--series-3'),
            borderWidth: 1.5,
            borderType: 'dashed',
            borderRadius: [4, 4, 0, 0],
          },
          emphasis: { itemStyle: { color: cssVar('--series-3') + '22' } } },
      ],
    }), { notMerge: true });
  }

  /* ---------- 渲染:停车费(手动记录;默认当天,可选覆盖接下来 N 天) ---------- */

  function renderParking() {
    const box = $('#pk-list');
    if (!box || !S.parking) return;
    box.textContent = '';

    // 头部统计:本月合计 / 累计
    const stats = $('#pk-stats');
    stats.textContent = '';
    const stat = (label, value) => {
      const t = el('span', 'mini-stat');
      t.appendChild(el('span', '', label + ' '));
      t.appendChild(el('b', '', value));
      stats.appendChild(t);
    };
    stat('本月', `¥${fmtNum(S.parking.month_total || 0, 2)}`);
    stat('累计', `¥${fmtNum(S.parking.total || 0, 2)}`);

    const fees = S.parking.fees || [];
    if (!fees.length) {
      box.appendChild(el('div', 'empty', '暂无停车费记录'));
      return;
    }
    fees.forEach((f) => {
      const row = el('div', 'pk-row');
      row.appendChild(el('span', 'pk-date-t', f.date));
      if (f.days > 1) row.appendChild(el('span', 'pk-days-t', `覆盖 ${f.days} 天`));
      row.appendChild(el('span', 'pk-note-t', f.note || ''));
      row.appendChild(el('b', 'pk-cost-t', `¥${fmtNum(f.cost, 2)}`));
      const del = el('button', 'pk-del', '✕');
      del.title = '删除这条记录';
      del.addEventListener('click', async () => {
        if (!confirm(`删除 ${f.date} 的 ¥${fmtNum(f.cost, 2)} 停车费记录?`)) return;
        try {
          await fetchJSON(`/api/parking/fees/${encodeURIComponent(f.key)}`,
            { method: 'DELETE' });
          S.parking = await api('parking/fees');
          renderParking();
        } catch (err) { console.error(err); }
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ---------- 充电提醒(家⇄公司通勤推算,数据来源 /api/charging/reminder) ---------- */

  let rmPicker = null;   // 当前打开地点选择器的一侧:'home' | 'work' | null

  function renderReminder() {
    const body = $('#rm-body');
    if (!body || !S.reminder) return;
    const rm = S.reminder;
    body.textContent = '';
    const canEdit = S.overview && S.overview.role === 'admin';
    const short = (label) => (label || '未识别').split(/[,，]/)[0];

    // 第一行:家/公司双框。当前所在位置的框绿色、另一边红色;
    // 预计需要充电的位置,框上方有黄色三角箭头;管理员点击框可修改
    const places = el('div', 'rm-places');
    [['home', '家', rm.home], ['work', '公司', rm.work]].forEach(([key, title, place]) => {
      const wrap = el('div', 'rm-place-wrap');
      if (rm.ready && rm.charge_at === key) wrap.appendChild(el('i', 'rm-place-flag'));
      const state = rm.current_loc === key ? ' cur' : (rm.current_loc ? ' away' : '');
      const box = el('div', 'rm-place' + state + (canEdit ? ' editable' : ''));
      box.appendChild(el('span', 'rm-place-title', title));
      box.appendChild(el('b', 'rm-place-name', short(place && place.label)));
      if (canEdit) {
        box.setAttribute('role', 'button');
        box.tabIndex = 0;
        box.title = '点击修改地点';
        const toggle = () => { rmPicker = rmPicker === key ? null : key; renderReminder(); };
        box.addEventListener('click', toggle);
        box.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      }
      wrap.appendChild(box);
      places.appendChild(wrap);
    });
    body.appendChild(places);

    // 地点选择器:点击家/公司框后展开,从常用地点聚类中选;另一侧已占用的地点不可选
    if (canEdit && rmPicker) {
      const otherKey = rmPicker === 'home' ? 'work' : 'home';
      const otherIds = new Set((rm[otherKey] && rm[otherKey].address_ids) || []);
      const curIds = new Set((rm[rmPicker] && rm[rmPicker].address_ids) || []);
      const panel = el('div', 'rm-pick');
      panel.appendChild(el('div', 'rm-pick-title',
        `选择「${rmPicker === 'home' ? '家' : '公司'}」的位置`));
      const save = async (ids) => {
        panel.style.pointerEvents = 'none';
        try {
          await fetchJSON('/api/charging/anchors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              home: rmPicker === 'home' ? ids : [...curIds0(rm.home)],
              work: rmPicker === 'work' ? ids : [...curIds0(rm.work)],
            }),
          });
          rmPicker = null;
          S.reminder = await api('charging/reminder');
          renderReminder();
        } catch (err) { console.error(err); panel.style.pointerEvents = ''; }
      };
      function curIds0(place) { return (place && place.address_ids) || []; }
      (rm.candidates || []).filter((c) => c.address_ids && c.address_ids.length)
        .slice(0, 8).forEach((c) => {
          const taken = c.address_ids.some((id) => otherIds.has(id));
          const isCur = c.address_ids.some((id) => curIds.has(id));
          const item = el('div', 'rm-pick-item' + (isCur ? ' cur' : '') + (taken ? ' off' : ''));
          item.appendChild(el('b', '', short(c.label)));
          item.appendChild(el('span', '',
            `到访 ${c.visits} 次 · 夜停 ${c.nights} · 日停 ${c.days}${isCur ? ' · 当前' : ''}`));
          if (!taken && !isCur) {
            item.setAttribute('role', 'button');
            item.tabIndex = 0;
            const choose = () => save(c.address_ids);
            item.addEventListener('click', choose);
            item.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
            });
          }
          panel.appendChild(item);
        });
      const auto = el('div', 'rm-pick-item rm-pick-auto');
      auto.appendChild(el('b', '', '恢复自动识别'));
      auto.appendChild(el('span', '', '按夜间/白天停留自动判定'));
      auto.setAttribute('role', 'button');
      auto.tabIndex = 0;
      const chooseAuto = () => save([]);
      auto.addEventListener('click', chooseAuto);
      auto.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseAuto(); }
      });
      panel.appendChild(auto);
      body.appendChild(panel);
    }

    if (!rm.ready) {
      body.appendChild(el('div', 'rm-empty', rm.reason || '行程数据积累中,暂无法预测'));
    } else if (rm.days_left === null || rm.days_left === undefined) {
      body.appendChild(el('div', 'rm-ok', `✓ ${rm.reason || '未来 30 天内无需充电'}`));
    } else {
      // 第二行:日历样式的预计充电日期 + 时限与原因
      const d = new Date(rm.charge_by_ts);
      const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
      const row = el('div', 'rm-calrow');
      const cal = el('div', 'rm-cal' + (rm.days_left <= 1 ? ' rm-urgent' : ''));
      cal.appendChild(el('div', 'rm-cal-m', `${d.getMonth() + 1}月`));
      cal.appendChild(el('div', 'rm-cal-d', String(d.getDate())));
      cal.appendChild(el('div', 'rm-cal-w', `周${wd}`));
      row.appendChild(cal);
      const side = el('div', 'rm-cal-side');
      side.appendChild(el('b', '', rm.charge_kind === 'now' ? '现在就要充电' : `${fmtClock(rm.charge_by_ts)} 到达后充电`));
      let why;
      if (rm.charge_kind === 'now') why = `电量已接近 ${rm.min_pct}%`;
      else if (rm.charge_kind === 'parked') why = `还能用约 ${fmtNum(rm.days_left, 1)} 天 · 停放掉电会先跌破 ${rm.min_pct}%`;
      else why = `还能用约 ${fmtNum(rm.days_left, 1)} 天 · ${rm.next_leg === 'to_work' ? '家→公司' : '公司→家'} 后会低于 ${rm.min_pct}%`;
      side.appendChild(el('span', '', why));
      if (rm.charger && rm.charger.name)
        side.appendChild(el('span', 'rm-cal-charger',
          `${rm.charger.near_anchor === false ? '常去桩' : '附近桩'}:${rm.charger.name}${rm.charger.location ? `(${rm.charger.location})` : ''}`));
      row.appendChild(side);
      body.appendChild(row);
    }

    // 第三行:最低电量滑动条(管理员拖动调节,松开自动保存)
    const pctRow = el('div', 'rm-slider');
    pctRow.appendChild(el('span', 'rm-slider-label', '最低电量'));
    const slider = el('input', 'rm-slider-input');
    slider.type = 'range';
    slider.min = 10;
    slider.max = 40;
    slider.step = 5;
    slider.value = rm.min_pct || 20;
    slider.disabled = !canEdit;
    const val = el('b', 'rm-slider-val', `${slider.value}%`);
    slider.addEventListener('input', () => { val.textContent = `${slider.value}%`; });
    slider.addEventListener('change', async () => {
      slider.disabled = true;
      try {
        await fetchJSON('/api/charging/reminder-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ min_pct: Number(slider.value) }),
        });
        S.reminder = await api('charging/reminder');
        renderReminder();
      } catch (err) { console.error(err); slider.disabled = !canEdit; }
    });
    pctRow.appendChild(slider);
    pctRow.appendChild(val);
    body.appendChild(pctRow);

    // 第四行:推测的逐趟行程与耗电(默认折叠,状态存 localStorage)
    const proj = rm.projection || [];
    if (rm.ready && proj.length) {
      const wrap = el('div', 'rm-legs-wrap'
        + (localStorage.getItem('ttv-rm-legs-open') === '1' ? ' open' : ''));
      const head = el('div', 'rm-legs-head');
      head.setAttribute('role', 'button');
      head.tabIndex = 0;
      head.title = '点击展开 / 收起';
      head.appendChild(el('span', 'rm-legs-title', `推测行程与耗电(${proj.length} 趟)`));
      head.appendChild(el('span', 'chev rm-legs-chev', '▾'));
      const toggleLegs = () => {
        const open = wrap.classList.toggle('open');
        localStorage.setItem('ttv-rm-legs-open', open ? '1' : '0');
      };
      head.addEventListener('click', toggleLegs);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLegs(); }
      });
      wrap.appendChild(head);
      const list = el('div', 'rm-legs');
      const pctTxt = (v) => (v === undefined || v === null) ? '' : `·${fmtNum(v, 1)}%`;
      const colhead = el('div', 'rm-ev rm-legs-colhead');
      colhead.appendChild(el('span', '', '时间'));
      const colheadRight = el('div', 'rm-leg-main');
      ['项目', '耗电', '剩余'].forEach((t) => colheadRight.appendChild(el('span', '', t)));
      colhead.appendChild(colheadRight);
      list.appendChild(colhead);
      proj.forEach((p, idx) => {
        const hit = rm.days_left !== null && rm.days_left !== undefined && idx === proj.length - 1;
        const ev = el('div', 'rm-ev' + (hit ? ' hit' : ''));
        // 左列:方向小标签 + 出发时刻,随整个事件块垂直居中
        const timeCell = el('div', 'rm-ev-time');
        timeCell.appendChild(el('span', 'rm-leg-dir2' + (p.direction ? '' : ' breach'), p.direction
          ? (p.direction === 'to_work' ? '家→公司' : '公司→家')
          : `跌破 ${rm.min_pct}%`));
        timeCell.appendChild(el('span', '', fmtTime(p.ts)));
        ev.appendChild(timeCell);
        // 右侧:哨兵/驻车各一行(近零省略;无拆分时合并),最后是行程行
        const rows = el('div', 'rm-ev-rows');
        const parkRow = (label, hours, km, pct, cls) => {
          const r = el('div', 'rm-leg-main rm-park ' + cls);
          r.appendChild(el('span', 'rm-leg-dir', `${label} · ${fmtNum(hours, 1)}h`));
          r.appendChild(el('span', 'rm-leg-used', `-${fmtNum(km, 1)} km${pctTxt(pct)}`));
          r.appendChild(el('span', 'rm-leg-remain', ''));
          return r;
        };
        if (p.sentry_km !== undefined && p.sentry_km !== null) {
          if (p.sentry_km >= 0.05) rows.appendChild(parkRow('哨兵', p.sentry_h, p.sentry_km, p.sentry_pct, 'sentry'));
          if (p.idle_km >= 0.05) rows.appendChild(parkRow('驻车', p.idle_h, p.idle_km, p.idle_pct, 'idle'));
        } else if (p.parked_km > 0.05) {
          rows.appendChild(parkRow('驻车', p.parked_h, p.parked_km, p.parked_pct, 'idle'));
        }
        const main = el('div', 'rm-leg-main');
        main.appendChild(el('span', 'rm-leg-dir',
          p.direction && p.dist_km ? `${fmtNum(p.dist_km, 0)} km` : ''));
        main.appendChild(el('span', 'rm-leg-used',
          p.direction ? `-${fmtNum(p.leg_km, 1)} km${pctTxt(p.leg_pct)}` : ''));
        main.appendChild(el('span', 'rm-leg-remain',
          `${fmtNum(p.remain_km, 0)} km`
          + (p.remain_pct !== undefined ? `·${p.remain_pct}%` : '')
          + (hit ? ' ⚡' : '')));
        rows.appendChild(main);
        ev.appendChild(rows);
        list.appendChild(ev);
      });
      wrap.appendChild(list);
      body.appendChild(wrap);
    }
  }


  /* ---------- 陪伴天数(提车日期,存 panel_manual settings) ---------- */

  function renderCompanion() {
    const t = $('#car-companion');
    if (!t) return;
    if (!S.delivery) {
      t.textContent = '点这里设置提车日期';
      t.classList.add('is-empty');
      return;
    }
    t.classList.remove('is-empty');
    // 提车当天算第 1 天(本地时区)
    const [y, m, d] = S.delivery.split('-').map(Number);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.max(1, Math.round((today - new Date(y, m - 1, d)) / 86400000) + 1);
    t.textContent = `已陪伴 ${days} 天`;
    t.setAttribute('aria-label', `提车日期 ${S.delivery},已陪伴 ${days} 天,点击修改`);
  }

  function initCompanion() {
    const t = $('#car-companion');
    const pop = $('#companion-pop');
    if (!t || !pop) return;
    const dateInp = $('#companion-date');
    const openPop = () => {
      dateInp.value = S.delivery || '';
      dateInp.max = (() => {  // 不可选未来日期
        const n = new Date();
        const p = (v) => String(v).padStart(2, '0');
        return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
      })();
      $('#companion-clear').hidden = !S.delivery;
      pop.hidden = false;
      dateInp.focus();
    };
    const closePop = () => { pop.hidden = true; };
    t.addEventListener('click', openPop);
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop(); }
    });
    $('#companion-cancel').addEventListener('click', closePop);
    pop.addEventListener('click', (e) => { if (e.target === pop) closePop(); });
    const submit = async (date) => {
      const btn = $('#companion-save');
      btn.disabled = true;
      try {
        const r = await fetchJSON('/api/vehicle/delivery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date }),
        });
        S.delivery = r.date;
        renderCompanion();
        closePop();
      } catch (err) {
        console.error(err);
        dateInp.focus();
      } finally {
        btn.disabled = false;
      }
    };
    $('#companion-save').addEventListener('click', () => {
      if (!dateInp.value) { dateInp.focus(); return; }
      submit(dateInp.value);
    });
    $('#companion-clear').addEventListener('click', () => submit(''));
  }

  function initParking() {
    const dateInp = $('#pk-date');
    if (!dateInp) return;
    // 默认当天(本地时区)
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    dateInp.value = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    $('#pk-add').addEventListener('click', async () => {
      const cost = parseFloat($('#pk-cost').value);
      if (isNaN(cost) || cost <= 0) { $('#pk-cost').focus(); return; }
      const body = {
        date: dateInp.value,
        cost,
        days: parseInt($('#pk-days').value, 10) || 1,
        note: $('#pk-note').value.trim(),
      };
      if (!body.date) { dateInp.focus(); return; }
      const btn = $('#pk-add');
      btn.disabled = true;
      try {
        await fetchJSON('/api/parking/fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        $('#pk-cost').value = '';
        $('#pk-note').value = '';
        $('#pk-days').value = '1';
        S.parking = await api('parking/fees');
        renderParking();
      } catch (err) {
        console.error(err);
        btn.title = '保存失败,请重试';
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- 渲染:地图(MapLibre 矢量瓦片,数据为本站托管的 PMTiles) ---------- */

  // pmtiles 协议注册一次即可;两个库均为经典脚本,先于 app.js 加载(见 index.html)
  if (window.maplibregl && window.pmtiles) {
    maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
    // CSP 版默认 worker URL 为空,必须显式指向同目录的 worker 文件,否则 Worker 加载失败、GeoJSON 永不渲染
    maplibregl.setWorkerUrl('/maplibre-gl-csp-worker.js');
  }
  const isCoarsePointer = () => window.matchMedia('(pointer: coarse)').matches;

  async function loadMapStyle(name) {
    if (!mapStyleCache[name]) {
      const resp = await fetch(`/mapstyle-${name}.json`, { cache: 'no-store' });
      const s = await resp.json();
      // 样式内的占位符改写为本站绝对地址(worker 线程里相对路径不可靠)
      s.sources.protomaps.url = 'pmtiles://' + location.origin + '/api/map/china.pmtiles';
      s.glyphs = s.glyphs.replace('__ORIGIN__', location.origin);
      s.sprite = s.sprite.replace('__ORIGIN__', location.origin);
      mapStyleCache[name] = s;
    }
    return structuredClone(mapStyleCache[name]);
  }

  function initMap() {
    if (map) return Promise.resolve();
    if (mapInitPromise) return mapInitPromise;
    mapInitPromise = (async () => {
      const style = await loadMapStyle(S.theme === 'dark' ? 'dark' : 'light');
      map = new maplibregl.Map({
        container: 'map',
        style,
        attributionControl: { compact: true },
        // 触屏上禁用单指拖动,避免地图吞掉页面滚动;双指缩放仍可用,轨迹已 fitBounds 完整可见
        dragPan: !isCoarsePointer(),
      });
      window.__ttvMap = map;  // 测试钩子:离线回归用它投影轨迹点做精确点击
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
      // setStyle(主题切换)会清空自定义图层,样式就绪后统一重绘
      map.on('style.load', paintRoutes);
      map.on('click', 'ttv-routes-line', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        new maplibregl.Popup({ closeButton: false, maxWidth: '320px' })
          .setLngLat(e.lngLat).setHTML(f.properties.popup).addTo(map);
        focusRouteRow(Number(f.id));  // 点选轨迹:下方列表展开对应行程详情
      });
      map.on('mouseenter', 'ttv-routes-line', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'ttv-routes-line', () => { map.getCanvas().style.cursor = ''; });
    })().catch((e) => { mapInitPromise = null; throw e; });
    return mapInitPromise;
  }

  function switchMapTheme() {
    const name = S.theme === 'dark' ? 'dark' : 'light';
    loadMapStyle(name).then((style) => {
      if (map) map.setStyle(style);
      Object.values(routeMaps).forEach((m) => m && m.setStyle(structuredClone(style)));
    }).catch(() => {});
  }

  let routeSig = null;     // 轨迹集合签名,不变则不重绘(避免 60s 刷新重置视野)
  let selectedRouteId = null;

  /* 主地图自定义图层:全部轨迹一个 GeoJSON 源 + 数据驱动配色;选中态走 feature-state */
  function ensureRouteLayers() {
    if (map.getSource('ttv-routes')) return;
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('ttv-routes', { type: 'geojson', data: empty });
    map.addSource('ttv-routes-ends', { type: 'geojson', data: empty });
    map.addLayer({
      id: 'ttv-routes-line', type: 'line', source: 'ttv-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], cssVar('--seq-blue-500'), ['get', 'color']],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], ['+', ['get', 'width'], 2], ['get', 'width']],
        'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, ['get', 'opacity']],
      },
    });
    map.addLayer({
      id: 'ttv-routes-ends', type: 'circle', source: 'ttv-routes-ends',
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'fill'],
        'circle-stroke-color': cssVar('--surface-1'),
        'circle-stroke-width': 2,
      },
    });
  }

  /* 在样式就绪时(重)绘轨迹;setStyle 后本函数由 style.load 事件触发。
     注意不能用 isStyleLoaded() 兜底:底图源失败时它永远为 false,轨迹会永远画不上 */
  function paintRoutes() {
    if (!map) return;
    try { ensureRouteLayers(); } catch (e) { return; }  // 样式尚未就绪,等 style.load 再画
    const o = S.overview;
    const routes = (o && o.routes && o.routes.routes) || [];
    const latestId = routes.length ? routes[routes.length - 1].id : null;
    const features = [];
    routesBounds = null;
    routes.forEach((r) => {
      // 轨迹点原始顺序为 [lat, lng],GeoJSON 需要 [lng, lat]
      const pts = (r.points || []).filter((p) => p.length >= 2).map((p) => [p[1], p[0]]);
      if (pts.length < 2) return;
      const isLatest = r.id === latestId;
      features.push({
        type: 'Feature', id: r.id,
        properties: {
          color: cssVar(isLatest ? '--series-2' : '--series-1'),
          width: isLatest ? 4 : 3,
          opacity: isLatest ? 1 : 0.7,
          popup: `<b>${fmtTime(Number(r.start_date_ts), true)}</b><br>` +
            `${fmtNum(r.distance, 1)} km · ${fmtNum(r.duration_min, 0)} 分` +
            (r.start_name || r.end_name ? `<br>${escapeHTML(r.start_name || '—')} → ${escapeHTML(r.end_name || '—')}` : ''),
        },
        geometry: { type: 'LineString', coordinates: pts },
      });
      pts.forEach((c) => { routesBounds = routesBounds ? routesBounds.extend(c) : new maplibregl.LngLatBounds(c, c); });
    });
    // 最近一次行程的起终点
    const ends = [];
    const last = routes[routes.length - 1];
    if (last && (last.points || []).length >= 2) {
      const p0 = last.points[0].slice(0, 2), p1 = last.points[last.points.length - 1].slice(0, 2);
      [['--series-1', p0], ['--series-2', p1]].forEach(([colorVar, p]) => ends.push({
        type: 'Feature',
        properties: { fill: cssVar(colorVar) },
        geometry: { type: 'Point', coordinates: [p[1], p[0]] },
      }));
    }
    ensureRouteLayers();
    map.getSource('ttv-routes').setData({ type: 'FeatureCollection', features });
    map.getSource('ttv-routes-ends').setData({ type: 'FeatureCollection', features: ends });
    if (selectedRouteId != null) {  // setStyle 后 feature-state 丢失,恢复选中态
      map.setFeatureState({ source: 'ttv-routes', id: selectedRouteId }, { selected: true });
    }
    const canvas = map.getCanvas();
    if (!mapFit && routesBounds && canvas.width && canvas.height) {  // 0 尺寸画布上 fitBounds 会得到退化视野
      map.fitBounds(routesBounds, { padding: 30, animate: false });
      mapFit = true;
    }
  }

  function renderRoutes() {
    const o = S.overview;
    if (!o || !o.routes) return;
    const routes = o.routes.routes || [];
    const sig = routes.map((r) => r.id).join(',');
    const totalKm = routes.reduce((s, r) => s + Number(r.distance || 0), 0);
    $('#routes-title').textContent = routes.length
      ? `${routes.length} 条轨迹 · 合计 ${fmtNum(totalKm, 1)} km · ` +
        `最近 ${fmtTime(Number(routes[routes.length - 1].start_date_ts), true)}`
      : '所选时间范围内暂无行程轨迹';
    if (sig === routeSig) return;  // 同一批轨迹:保留用户当前缩放/选择状态
    routeSig = sig;
    selectedRouteId = null;
    mapFit = false;
    initMap().then(() => paintRoutes()).catch(() => {});
  }

  function selectRoute(id) {
    deselectRoute();
    if (map && map.getSource('ttv-routes')) {
      map.setFeatureState({ source: 'ttv-routes', id }, { selected: true });
    }
    selectedRouteId = id;
    // 顶部地图只作全览,不再缩放到单条轨迹;行程细节看详情里的小地图
  }

  function deselectRoute() {
    if (map && selectedRouteId != null && map.getSource('ttv-routes')) {
      map.setFeatureState({ source: 'ttv-routes', id: selectedRouteId }, { selected: false });
    }
    selectedRouteId = null;
  }

  /* 地图点选轨迹:展开列表中对应行程行(所在日组若为收起状态先展开)并滚动到位 */
  function focusRouteRow(id) {
    const row = routeRows[id];
    if (!row) return;
    const grp = row.closest('.day-group');
    if (grp && !grp.classList.contains('open')) grp.classList.add('open');
    if (!row.classList.contains('open')) row.click();  // 走同一套展开逻辑(选中轨迹 + 渲染海拔图)
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* 行程详情:小地图(只显示该条轨迹 + 起终点;顶部地图仅作全览)。
     每个 MapLibre 实例占一个 WebGL 上下文(浏览器上限约 16 个),超出时回收最早的实例 */
  const MINI_MAP_LIMIT = 8;

  /* 车速配色:0 → 150 km/h 区间,红→黄→绿(越慢越红,100 即达最绿,之后保持),与详情图例一致 */
  const SPEED_RAMP = [
    [0, '#e0483e'], [50, '#eda100'], [100, '#1baf7a'],
  ];
  function mixHex(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return '#' + pa.map((v, i) =>
      Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function speedColor(v) {
    for (let i = 1; i < SPEED_RAMP.length; i++) {
      if (v <= SPEED_RAMP[i][0]) {
        const t = (v - SPEED_RAMP[i - 1][0]) / (SPEED_RAMP[i][0] - SPEED_RAMP[i - 1][0]);
        return mixHex(SPEED_RAMP[i - 1][1], SPEED_RAMP[i][1], Math.max(0, Math.min(1, t)));
      }
    }
    return SPEED_RAMP[SPEED_RAMP.length - 1][1];
  }

  function renderRouteMap(r, box) {
    if (routeMaps[r.id]) { routeMaps[r.id].resize(); return; }
    const raw = (r.points || []).filter((p) => p.length >= 2);
    const pts = raw.map((p) => [p[1], p[0]]);
    if (pts.length < 2) return;
    const speeds = raw.map((p) =>
      (p.length >= 4 && p[3] !== null && p[3] !== undefined) ? Number(p[3]) : null);
    const hasSpeed = speeds.some((v) => v !== null);
    const liveIds = Object.keys(routeMaps);
    if (liveIds.length >= MINI_MAP_LIMIT) disposeRouteMap(Number(liveIds[0]));
    loadMapStyle(S.theme === 'dark' ? 'dark' : 'light').then((style) => {
      if (routeMaps[r.id] || !box.isConnected) return;  // 等待样式期间行已收起/列表已重渲染
      const m = new maplibregl.Map({
        container: box,
        style,
        attributionControl: false,
        dragPan: !isCoarsePointer(),  // 触屏禁用单指拖动,避免吞掉页面滚动
        scrollZoom: false,            // 小地图不响应滚轮,桌面滚动页面向下不被截住
      });
      m.doubleClickZoom.disable();
      // 有逐点速度时按速度分段着色(每段一个 feature),否则退回单色
      const lineFC = hasSpeed ? {
        type: 'FeatureCollection',
        features: pts.slice(1).map((c, i) => ({
          type: 'Feature',
          properties: { color: speedColor(speeds[i + 1] ?? speeds[i] ?? 0) },
          geometry: { type: 'LineString', coordinates: [pts[i], c] },
        })),
      } : {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }],
      };
      const endsFC = {
        type: 'FeatureCollection',
        features: [[pts[0], cssVar('--series-1')], [pts[pts.length - 1], cssVar('--series-2')]].map(([c, fill]) => ({
          type: 'Feature', properties: { fill }, geometry: { type: 'Point', coordinates: c },
        })),
      };
      const paint = () => {
        if (m.getSource('route')) return;
        m.addSource('route', { type: 'geojson', data: lineFC });
        m.addSource('route-ends', { type: 'geojson', data: endsFC });
        m.addLayer({
          id: 'route-line', type: 'line', source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': hasSpeed ? ['get', 'color'] : cssVar('--seq-blue-500'),
            'line-width': 4, 'line-opacity': 1,
          },
        });
        m.addLayer({
          id: 'route-ends', type: 'circle', source: 'route-ends',
          paint: {
            'circle-radius': 5, 'circle-color': ['get', 'fill'],
            'circle-stroke-color': cssVar('--surface-1'), 'circle-stroke-width': 2,
          },
        });
      };
      m.on('style.load', paint);  // 主题切换 setStyle 后图层被清空,需要重绘
      const b = new maplibregl.LngLatBounds();
      pts.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding: 16, animate: false });
      routeMaps[r.id] = m;
    }).catch(() => {});
  }

  function disposeRouteMap(id) {
    const m = routeMaps[id];
    if (!m) return;
    const box = m.getContainer();
    m.remove();
    delete routeMaps[id];
    box.className = 'rt-map';  // 复位容器,便于「已销毁」断言与再次初始化
  }

  /* 行程页:每个日组头部右侧的当日轨迹缩略图。
     2026-09-20 重写(v4):曾用屏外 MapLibre 快照,但日组行是超宽短条(桌面约 28:1),
     地理 contain 拟合把轨迹压成小点、底图标签巨大,cover 拟合又只剩一小段轨迹入画,
     用户看到的是「不正常的扭曲缩放」。改为 2D 画布直接绘制轨迹线:经纬度经 cos(纬度)
     修正后均匀缩放(contain 保形)进 CSS mask 的清晰带,任意行宽高比都不变形、永远完整可见。
     渲染为同步瞬时操作,不再需要屏外 WebGL 实例与串行快照队列;仍按 主题+尺寸+轨迹id 缓存
     (内存 + IndexedDB),60s 列表重渲染后直接复用 */
  const dayThumbCache = new Map();    // key → dataURL
  let dayThumbObserver = null;
  let lastThumbDim = '';

  /* 持久缓存(2026-09-19):缩略图 PNG 存 IndexedDB,刷新/重开页面免重新渲染。
     key 与内存缓存相同(主题:尺寸:轨迹id),value {u: dataURL, t: 写入时间};
     打开库时顺手清 14 天前条目;IDB 不可用(隐私模式等)静默回退纯内存缓存 */
  const dayThumbIdbMiss = new Set();  // 本会话已确认 IDB 未命中的 key,直接走渲染队列
  const thumbIdb = (() => {
    let dbp = null, pruned = false;
    function prune(db) {
      if (pruned) return;
      pruned = true;
      try {
        const cutoff = Date.now() - 14 * 864e5;
        const st = db.transaction('thumbs', 'readwrite').objectStore('thumbs');
        st.openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return;
          if (!c.value || !c.value.t || c.value.t < cutoff) c.delete();
          c.continue();
        };
      } catch (e) { /* 清理失败无碍使用 */ }
    }
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res) => {
        let req;
        try { req = indexedDB.open('ttv-thumbs', 1); } catch (e) { res(null); return; }
        req.onupgradeneeded = () => { req.result.createObjectStore('thumbs'); };
        req.onsuccess = () => { prune(req.result); res(req.result); };
        req.onerror = () => res(null);
      });
      return dbp;
    }
    async function get(key) {
      const db = await open();
      if (!db) return null;
      return new Promise((res) => {
        try {
          const rq = db.transaction('thumbs', 'readonly').objectStore('thumbs').get(key);
          rq.onsuccess = () => { const v = rq.result; res(v && v.u ? v.u : null); };
          rq.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    }
    async function put(key, url) {
      const db = await open();
      if (!db) return;
      try {
        db.transaction('thumbs', 'readwrite').objectStore('thumbs').put({ u: url, t: Date.now() }, key);
      } catch (e) { /* 写失败无碍,下次重新渲染 */ }
    }
    return { get, put };
  })();

  function applyDayThumb(box, url) {
    // 列表渲染期间组元素尚未挂载,isConnected 为 false;inline 样式挂上后依然生效,直接设
    box.style.backgroundImage = `url("${url}")`;
  }

  /* 快照画布跟随日期行的实际渲染尺寸:背景图等比无变形,且与蒙板清晰带逐像素对齐。
     列表渲染期间元素未挂载,需在挂载后(observer 触发/出队)才能测量 */
  function thumbRowSize() {
    const head = document.querySelector('#routes-list .day-head');
    const w0 = head ? head.clientWidth : 0, h0 = head ? head.clientHeight : 0;
    const w = Math.max(280, Math.round((w0 || 1040) / 20) * 20);  // 20px 一档,细微变化不触发重生成
    const h = Math.max(36, Math.round((h0 || 60) / 4) * 4);
    return { w, h, dim: `${w}x${h}` };
  }

  function requestDayThumb(box, rs) {
    if (!box.isConnected) return;
    const { dim } = thumbRowSize();
    lastThumbDim = dim;
    const key = `${S.theme}:${dim}:v4:${rs.map((r) => r.id).join(',')}`;  // 主题/尺寸/算法版本/轨迹任一变化都重生成
    if (dayThumbCache.has(key)) { applyDayThumb(box, dayThumbCache.get(key)); return; }
    box.__thumbKey = key;
    if (dayThumbIdbMiss.has(key)) { generateDayThumb(key, rs, box); return; }
    thumbIdb.get(key).then((url) => {
      if (url) {
        dayThumbCache.set(key, url);
        // 异步返回时列表可能已重渲染:应用到所有仍在等这个 key 的挂载元素
        document.querySelectorAll('#routes-list .rt-day-thumb').forEach((t) => {
          if (t.__thumbKey === key && t.isConnected) applyDayThumb(t, url);
        });
      } else {
        dayThumbIdbMiss.add(key);
        if (box.isConnected && box.__thumbKey === key) generateDayThumb(key, rs, box);
      }
    });
  }

  /* 2D 画布直绘当日轨迹:同步瞬时完成,应用到元素并写两级缓存 */
  function generateDayThumb(key, rs, box) {
    try {
      const { w, h } = thumbRowSize();
      const url = renderDayThumbPng(rs, w, h);
      if (!url) return;
      if (dayThumbCache.size > 240) dayThumbCache.clear();  // 换时间范围后防无限增长
      dayThumbCache.set(key, url);
      dayThumbIdbMiss.delete(key);
      thumbIdb.put(key, url);  // 持久化,下次打开页面直接命中
      document.querySelectorAll('#routes-list .rt-day-thumb').forEach((t) => {
        if (t.__thumbKey === key && t.isConnected) applyDayThumb(t, url);
      });
      if (box.isConnected && box.__thumbKey === key) applyDayThumb(box, url);
    } catch (e) { console.warn('[day-thumb] render failed:', e); /* 渲染失败留空,不影响列表 */ }
  }

  /* 把当日全部轨迹均匀缩放(contain 保形)进 mask 清晰带(60–88% 宽、26–74% 高)。
     经度乘 cos(平均纬度) 修正纵横比;发光线条 + 圆头,主题色 --series-1 */
  function renderDayThumbPng(rs, w, h) {
    const lines = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let latSum = 0, latN = 0;
    rs.forEach((r) => {
      const pts = (r.points || []).filter((p) => p.length >= 2);
      if (pts.length < 2) return;
      pts.forEach((p) => { latSum += p[0]; latN++; });
      lines.push(pts);
    });
    if (!lines.length) return null;
    const kx = Math.cos((latSum / latN) * Math.PI / 180);  // 经度→等距横坐标修正
    lines.forEach((pts) => pts.forEach((p) => {
      const x = p[1] * kx, y = p[0];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const bx0 = w * 0.60 + 4, bx1 = w * 0.88 - 4, by0 = h * 0.26 + 2, by1 = h * 0.74 - 2;
    const spanX = Math.max(1e-9, maxX - minX), spanY = Math.max(1e-9, maxY - minY);
    const s = Math.min((bx1 - bx0) / spanX, (by1 - by0) / spanY);
    const ox = (bx0 + bx1) / 2 - (minX + maxX) / 2 * s;
    const oy = (by0 + by1) / 2 + (minY + maxY) / 2 * s;  // 纬度向北 = 画面向上,y 取反
    const color = cssVar('--series-1');
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.globalAlpha = 0.95;
    lines.forEach((pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = p[1] * kx * s + ox, y = oy - p[0] * s;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    });
    return cv.toDataURL('image/png');
  }

  function observeDayThumb(box, rs) {
    if (!('IntersectionObserver' in window)) { requestDayThumb(box, rs); return; }
    if (!dayThumbObserver) {
      dayThumbObserver = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target;
          dayThumbObserver.unobserve(t);
          if (t.__thumbRs) requestDayThumb(t, t.__thumbRs);  // 此刻元素已挂载,可测量行尺寸
        });
      }, { rootMargin: '300px' });  // 提前一屏生成,滚到即见
    }
    box.__thumbRs = rs;
    dayThumbObserver.observe(box);
  }

  /* 窗口尺寸变化:行宽档位变了才重新生成(缓存 key 含尺寸,旧条目自然淘汰) */
  function checkThumbResize() {
    if (!document.querySelector('#routes-list .rt-day-thumb')) return;
    const { dim } = thumbRowSize();
    if (!lastThumbDim || dim === lastThumbDim) { lastThumbDim = dim || lastThumbDim; return; }
    lastThumbDim = dim;
    document.querySelectorAll('#routes-list .rt-day-thumb').forEach((t) => {
      if (t.__thumbRs) requestDayThumb(t, t.__thumbRs);
    });
  }

  /* 行程详情:海拔高度图(x = 累计里程 km,y = 海拔 m,平滑曲线 + 渐变填充) */
  function renderRouteElev(r, box) {
    if (routeElev[r.id]) { routeElev[r.id].resize(); return; }
    const pts = (r.points || []).filter((p) => p.length >= 3 && p[2] !== null && p[2] !== undefined);
    if (pts.length < 2) return;
    // 相邻轨迹点 haversine 累加出行程里程
    const R = 6371.0088, rad = Math.PI / 180;
    let cum = 0;
    const data = [[0, pts[0][2]]];
    for (let i = 1; i < pts.length; i++) {
      const dLat = (pts[i][0] - pts[i - 1][0]) * rad, dLng = (pts[i][1] - pts[i - 1][1]) * rad;
      const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(pts[i - 1][0] * rad) * Math.cos(pts[i][0] * rad) * Math.sin(dLng / 2) ** 2;
      cum += 2 * R * Math.asin(Math.sqrt(h));
      data.push([Number(cum.toFixed(3)), pts[i][2]]);
    }
    const c = cssVar('--series-1');
    // hex → rgba(供渐变填充用,同平均能耗图)
    const hx = c.replace('#', '');
    const n = parseInt(hx.length === 3 ? hx.split('').map((x) => x + x).join('') : hx, 16);
    const fade = (a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    const chart = echarts.init(box);
    routeElev[r.id] = chart;
    // axis tooltip 在起终点处会多出散点系列的重复行,过滤掉
    const tip = tooltipAxis({ '海拔': 'm' }, (v) => fmtNum(Number(v), 1) + ' km');
    const tipFmt = tip.formatter;
    tip.formatter = (params) => tipFmt(params.filter((p) => p.seriesName !== '起终点'));
    chart.setOption(Object.assign({}, chartTheme(), {
      tooltip: tip,
      grid: { left: 46, right: 18, top: 14, bottom: 24 },
      xAxis: Object.assign(axisCommon(), {
        type: 'value', min: 0, max: data[data.length - 1][0],
        // max 不是整刻度,ECharts 会额外补一个 max 标签与相邻刻度重叠,隐藏之
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value} km', showMaxLabel: false },
      }),
      yAxis: Object.assign(axisCommon(), {
        type: 'value', scale: true,
        axisLabel: { color: cssVar('--text-muted'), fontSize: 11, formatter: '{value} m' },
      }),
      series: [
        Object.assign(lineSeries('海拔', data, c), {
          smooth: true,
          smoothMonotone: 'x',
          endLabel: { show: false },  // 终点数值由起终点标注系列展示,避免重影
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: fade(0.28) },
                { offset: 1, color: fade(0.02) },
              ],
            },
          },
        }),
        {  // 起点/终点圆点 + 海拔标注(起点标签在点右侧、终点在左侧,避免贴边裁剪)
          name: '起终点', type: 'scatter',
          data: [
            { value: data[0], label: { position: 'right', distance: 6 } },
            { value: data[data.length - 1], label: { position: 'left', distance: 6 } },
          ],
          symbolSize: 7, z: 3,
          itemStyle: { color: c, borderColor: cssVar('--surface-1'), borderWidth: 1.5 },
          label: {
            show: true, fontSize: 11,
            color: cssVar('--text-secondary'),
            formatter: (p) => `${p.dataIndex === 0 ? '起点' : '终点'} ${fmtNum(p.value[1], 0)} m`,
          },
          tooltip: { show: false },
        },
      ],
    }), { notMerge: true });
  }

  function disposeRouteElev(id) {
    if (id === undefined) {  // 全部销毁(列表重渲染前)
      Object.keys(routeElev).forEach((k) => disposeRouteElev(Number(k)));
      return;
    }
    if (routeElev[id]) { routeElev[id].dispose(); delete routeElev[id]; }
    disposeRouteMap(id);
  }

  function renderRoutesList() {
    const o = S.overview;
    const box = $('#routes-list');
    if (!o || !o.routes) return;
    disposeRouteElev();
    Object.keys(routeRows).forEach((k) => delete routeRows[k]);
    box.textContent = '';
    const routes = [...(o.routes.routes || [])].reverse();  // 新的在前
    if (!routes.length) {
      box.appendChild(el('div', 'events-empty', '所选时间范围内暂无行程轨迹'));
      return;
    }
    const actById = {};
    ((S.overview.activity || {}).drives || []).forEach((d) => { actById[d.id] = d; });

    const groups = new Map();
    routes.forEach((r) => {
      const key = dayKey(Number(r.start_date_ts));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    groups.forEach((rs, key) => {
      const isToday = key === dayKey(Date.now());
      const grp = el('div', 'day-group' + (isToday ? ' open' : ''));
      const head = el('button', 'day-head');
      head.type = 'button';
      head.appendChild(el('span', 'date', dayLabel(Number(rs[0].start_date_ts))));
      const sum = el('span', 'summary');
      const km = rs.reduce((s, r) => s + Number(r.distance || 0), 0);
      sum.appendChild(el('span', 'chip', `${rs.length} 条轨迹 · ${fmtNum(km, 1)} km`));
      head.appendChild(sum);
      if (rs.some((r) => (r.points || []).length >= 2)) {  // 右侧:当日全部轨迹的地图缩略图
        const thumb = el('span', 'rt-day-thumb');
        observeDayThumb(thumb, rs);
        head.appendChild(thumb);
      }
      head.appendChild(el('span', 'chev', '▾'));
      head.addEventListener('click', () => grp.classList.toggle('open'));
      grp.appendChild(head);

      const body = el('div', 'day-body');
      rs.forEach((r) => {
        const row = el('div', 'rt-row');
        routeRows[r.id] = row;
        row.appendChild(el('span', 'rt-time', fmtClock(Number(r.start_date_ts))));
        row.appendChild(el('span', 'rt-names', `${r.start_name || '—'} → ${r.end_name || '—'}`));
        row.appendChild(el('span', 'rt-dist', `${fmtNum(r.distance, 1)} km`));
        row.appendChild(el('span', 'rt-dur', `${fmtNum(r.duration_min, 0)} 分`));
        row.appendChild(el('span', 'chev rt-chev', '▾'));

        const a = actById[r.id];
        const delta = (r.start_ideal_range_km !== null && r.end_ideal_range_km !== null)
          ? Number(r.start_ideal_range_km) - Number(r.end_ideal_range_km) : null;
        const eff = (delta !== null && delta > 0 && r.distance && o_kwh() > 0)
          ? delta * o_kwh() * 1000 / r.distance : null;
        const avg = (r.duration_min && r.distance)
          ? r.distance / (r.duration_min / 60) : null;
        // 详情:表格式键值网格 + 海拔高度图(缺数据的格子显示 —)
        const kv = el('div', 'rt-kv');
        const kvItem = (lab, val) => {
          const it = el('div', 'rt-kv-item');
          it.appendChild(el('span', 'rt-kv-lab', lab));
          it.appendChild(el('span', 'rt-kv-val', val));
          kv.appendChild(it);
        };
        kvItem('均速', avg !== null ? `${fmtNum(avg, 0)} km/h` : '—');
        kvItem('最高速', (r.speed_max !== null && r.speed_max !== undefined)
          ? `${fmtNum(r.speed_max, 0)} km/h` : '—');
        kvItem('能耗', eff !== null ? `${fmtNum(eff, 0)} Wh/km` : '—');
        kvItem('耗电', (a && a.energy_kwh !== null && a.energy_kwh !== undefined)
          ? `${fmtNum(a.energy_kwh, 1)} kWh` : '—');
        kvItem('Δ理想续航', delta !== null ? `${fmtNum(delta, 1)} km` : '—');
        kvItem('电费', (a && a.cost_yuan !== null && a.cost_yuan !== undefined)
          ? `¥${fmtNum(a.cost_yuan, 2)}` +
            (a.cost_per_km_yuan !== null && a.cost_per_km_yuan !== undefined
              ? ` (¥${fmtNum(a.cost_per_km_yuan, 2)}/km)` : '')
          : '—');
        // 堵车/红绿灯(后端按停车时长与缓行启发式判定,见 /api/routes traffic 字段)
        const tf = r.traffic;
        kvItem('堵车时间', tf ? fmtSec(tf.jam_s) : '—');
        kvItem('堵车路程', tf ? `${fmtNum(tf.jam_km, 1)} km` : '—');
        kvItem('红绿灯等待', tf
          ? `${fmtSec(tf.light_s)}${tf.light_n ? ` · ${tf.light_n} 次` : ''}` : '—');
        const detail = el('div', 'rt-detail');
        detail.appendChild(kv);
        let mapBox = null;
        if ((r.points || []).filter((p) => p.length >= 2).length >= 2) {
          mapBox = el('div', 'rt-map');
          detail.appendChild(mapBox);
          // 有逐点速度时轨迹按车速变色,附色带图例
          const hasSpeed = (r.points || []).some((p) => p.length >= 4 && p[3] !== null && p[3] !== undefined);
          if (hasSpeed) {
            const leg = el('div', 'rt-speed-legend');
            leg.appendChild(el('span', '', '0'));
            leg.appendChild(el('i', ''));
            leg.appendChild(el('span', '', '150+ km/h'));
            detail.appendChild(leg);
          }
        }
        let elevBox = null;
        const elevPts = (r.points || []).filter((p) => p.length >= 3 && p[2] !== null && p[2] !== undefined);
        if (elevPts.length >= 2) {
          // 落差 = 终点海拔 − 起点海拔(取原始采样值,未经曲线平滑)
          const drop = elevPts[elevPts.length - 1][2] - elevPts[0][2];
          const dropTxt = (drop > 0 ? '+' : '') + fmtNum(drop, 0) + ' m';
          const wrap = el('div', 'rt-elev-wrap');
          wrap.appendChild(el('div', 'rt-elev-title', `海拔变化 · 落差 ${dropTxt}`));
          elevBox = el('div', 'rt-elev');
          wrap.appendChild(elevBox);
          detail.appendChild(wrap);
        }
        row.addEventListener('click', () => {
          const open = row.classList.toggle('open');
          if (open) {
            openRouteIds.add(r.id);
            selectRoute(r.id);
            requestAnimationFrame(() => {
              if (mapBox) renderRouteMap(r, mapBox);
              if (elevBox) renderRouteElev(r, elevBox);
            });
          } else {
            openRouteIds.delete(r.id);
            if (selectedRouteId === r.id) deselectRoute();
            disposeRouteElev(r.id);
          }
        });
        body.appendChild(row);
        body.appendChild(detail);
      });
      grp.appendChild(body);
      box.appendChild(grp);
    });

    // 60s 刷新会重建列表:恢复此前展开的行程;已不在范围内的 id 清理掉
    openRouteIds.forEach((id) => {
      const row = routeRows[id];
      if (row && !row.classList.contains('open')) row.click();
      else if (!row) openRouteIds.delete(id);
    });
  }

  /* ---------- 数据加载 ---------- */

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401) {  // 会话失效:回登录页,登录后原路返回
      location.href = '/login?next=' + encodeURIComponent(location.pathname);
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }

  function api(path) {
    const q = S.carId === null ? '' : (path.includes('?') ? '&' : '?') + 'car_id=' + S.carId;
    return fetchJSON('/api/' + path + q);
  }

  async function refresh() {
    try {
      const o = await api('overview');
      if (S.carId === null) S.carId = o.car_id;
      const [daily, chg, routes, act, eff, tpms, sys, health, sessions, cyc, temp, tpms24, pk, del, rm, hm, life] = await Promise.all([
        api(`drives/daily?days=${S.days}`),
        api('charging/summary?limit=12'),
        api(`routes?days=${S.days}`),
        api(`activity?days=${S.days}`),
        api(`efficiency/trend?days=${S.days}`),
        api(`tpms/trend?days=${S.days}`),
        api('system'),
        api('battery/health'),
        api(`charging/sessions?days=${S.days}`),
        api('energy/cycles?limit=10'),
        api(`temp/trend?days=${S.days}`),
        api('tpms/trend?days=1'),
        api('parking/fees'),
        api('vehicle/delivery'),
        api('charging/reminder'),
        api('charging/home'),
        api('vehicle/lifetime'),
      ]);
      S.overview = {
        ...o,
        kwhPerIdealKm: o.kwh_per_ideal_km,
        dailyRows: daily.days_rows,
        chargingSessions: chg.sessions,
        routes,
        activity: act,
        efficiency: eff,
        tpms,
        tpms24,
        temp,
      };
      S.health = health;
      S.sessions = sessions;
      S.cycles = cyc;
      S.parking = pk;
      S.delivery = del.date;
      S.reminder = rm;
      S.homeCharge = hm;
      S.lifetime = life;
      $('#state-badge').dataset.state = 'unknown';
      renderSys(sys);
      renderHeader();
      renderCtlState();
      loadControlStatus();  // 车辆控制状态(车锁/哨兵推测 + 空调/充电实报)随刷新保持最新
      renderCar();
      renderSessions();
      renderChargers();
      renderCsBatt();
      renderParking();
      renderReminder();
      renderHomeCharge();
      renderDaily();
      renderCharging();
      renderRoutes();
      renderRoutesList();
      renderActivity();
      renderEvents();
      renderSentry();
      renderEfficiency();
      renderLifetime();
      renderTraffic();
      renderTpms();
      renderTemp();
    } catch (err) {
      $('#state-text').textContent = '数据连接失败';
      $('#updated-at').textContent = 'API 请求失败,稍后自动重试';
      console.error(err);
    }
  }

  function renderAll() {
    if (!S.overview) return;
    renderHeader();
    renderDaily(); renderCharging();
    renderRoutes(); renderRoutesList();
    renderActivity(); renderEvents(); renderSentry();
    renderEfficiency(); renderTpms(); renderCar(); renderSessions(); renderChargers(); renderCsBatt(); renderTemp(); renderParking(); renderReminder(); renderHomeCharge(); renderLifetime(); renderTraffic();
  }

  /* ---------- 功能分页(底部液态玻璃 Tab 栏) ---------- */

  const PAGE_IDS = ['overview', 'charging', 'drives', 'activity', 'vehicle', 'control'];
  let mapShown = false;  // 行程页首次显示时需 resize + 重新 fitBounds

  // 选中气泡跟随当前 Tab:用户切页时走 TTVPageTurn 拉伸滑动,首次定位/resize 直接落位
  function placeTabBubble(animate) {
    const bar = $('#tabbar');
    const btn = bar && bar.querySelector('.tab.on');
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

  let tabSeq = 0;  // 快速连点时作废旧切换的离场动画结果

  function switchTab(name, save) {
    if (!PAGE_IDS.includes(name)) name = 'overview';
    if (save !== false) localStorage.setItem('ttv-tab', name);
    const cur = document.querySelector('.page.active');
    const nxt = document.getElementById('page-' + name);
    const setTabs = () => {
      document.querySelectorAll('.tabbar .tab').forEach((t) => {
        const on = t.dataset.page === name;
        t.classList.toggle('on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    };
    // 隐藏页里的 ECharts / Leaflet 尺寸为 0,显示后要重算
    const afterShow = () => requestAnimationFrame(() => {
      const sec = document.getElementById('page-' + name);
      if (sec) Object.values(charts).forEach((c) => {
        if (c && sec.contains(c.getDom())) c.resize();
      });
      if (sec) Object.values(routeElev).forEach((c) => {
        if (c && sec.contains(c.getDom())) c.resize();
      });
      if (name === 'drives') Object.values(routeMaps).forEach((m) => m && m.resize());
      if (name === 'drives' && map) {
        map.resize();
        if (!mapShown && routesBounds) {  // 首次显示:此前 fitBounds 基于 0 尺寸,按全部轨迹重算
          mapShown = true;
          mapFit = true;
          map.fitBounds(routesBounds, { padding: 30, animate: false });
        }
      }
      if (name === 'overview') renderCar();  // 俯视图标注随舞台尺寸定位,重算一次
    });
    // 动画路径:Tab 态与气泡滑动先行(手感即时),旧页模块从四周退出,再切页、新页模块从四周进入
    if (cur && nxt && cur !== nxt && window.TTVPageTurn) {
      const seq = ++tabSeq;
      setTabs();
      placeTabBubble(true);
      TTVPageTurn.exit(cur).then(() => {
        if (seq !== tabSeq) return;  // 期间又点了别的 Tab,本次切页作废
        document.querySelectorAll('.page').forEach((p) =>
          p.classList.toggle('active', p === nxt));
        window.scrollTo(0, 0);  // 切换分页后回到页面顶部
        afterShow();
        TTVPageTurn.enter(nxt);
      });
      return;
    }
    window.scrollTo(0, 0);  // 切换分页后回到页面顶部
    document.querySelectorAll('.page').forEach((p) =>
      p.classList.toggle('active', p === nxt));
    setTabs();
    placeTabBubble(false);
    afterShow();
  }

  /* Control UI is isolated so changes do not affect telemetry pages. */
  function renderCtlState() { window.TeslaControl?.overview(S.overview); }
  function loadControlStatus() { window.TeslaControl?.load(); }
  function initControl() {}

  function init() {
    applyTheme();
    charts.daily = echarts.init($('#chart-daily'));
    charts.charging = echarts.init($('#chart-charging'));
    charts.activity = echarts.init($('#chart-activity'));
    charts.sentryLanes = echarts.init($('#chart-sentry-lanes'));
    charts.sentryDrain = echarts.init($('#chart-sentry-drain'));
    charts.efficiency = echarts.init($('#chart-efficiency'));
    charts.tpms = echarts.init($('#chart-tpms'));
    charts.temp = echarts.init($('#chart-temp'));

    // 功能分页:底部 Tab 栏点击切换,记忆上次所在页
    $('#tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) switchTab(b.dataset.page);
    });
    // 卡片解释说明(.card-sub)默认隐藏:点标题 h2 展开/收起;
    // capture 阶段拦截,避免触发折叠卡头(充电详情/停车费/家充)的整行点击
    document.addEventListener('click', (e) => {
      const h = e.target.closest('.card h2');
      if (!h) return;
      e.stopPropagation();
      h.closest('.card').classList.toggle('sub-on');
    }, true);
    // Tab 栏横向拖动:滑过按钮即逐一切页(不必逐个点按)
    window.TTVPageTurn?.enableTabDrag($('#tabbar'), (p) => switchTab(p));
    // #control 深链(配置流程返回)只生效一次:清掉 hash,否则之后每次刷新都会被它拉回控制页
    if (location.hash === '#control') {
      switchTab('control');
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      switchTab(localStorage.getItem('ttv-tab') || 'overview', false);
    }

    // 车辆总览:电量 % / 度数 kWh / 里程 km 三态切换(本卡片独立,持久化)
    const carSeg = $('#car-mode-seg');
    carSeg.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.mode === S.carMode));
    carSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      S.carMode = b.dataset.mode;
      localStorage.setItem('ttv-car-mode', S.carMode);
      carSeg.querySelectorAll('button').forEach((x) =>
        x.classList.toggle('on', x === b));
      renderCar();
    });

    // 充电周期横条:点选芯片切换周期
    $('#cycle-strip').addEventListener('click', (e) => {
      const b = e.target.closest('.cyc-chip');
      if (!b) return;
      S.cycleIdx = Number(b.dataset.idx);
      renderCar();
      // 只横向滚动条内居中选中芯片;scrollIntoView 会连页面一起滚,整个模块看起来在动
      const strip = $('#cycle-strip');
      strip.scrollTo({ left: b.offsetLeft - (strip.clientWidth - b.clientWidth) / 2, behavior: 'smooth' });
    });

    // 俯视图能量环 ⇄ 图例:点击互相定位高亮
    $('.car-svg').addEventListener('click', (e) => {
      // 两侧收起时,点车体 = 展开两侧面板(陪伴天数文字除外,它有自己的日期弹层)
      const sideL = $('#car-side-l');
      if (sideL && sideL.classList.contains('collapsed') && !e.target.closest('#car-companion')) {
        setCarSides(true);
        return;
      }
      const r = e.target.closest('.carring');
      if (!r) { setCarSel(null); return; }
      const k = r.id.replace('carring-', '');
      setCarSel(carSel === k ? null : k);
    });
    document.querySelectorAll('.car-legend').forEach((box) =>
      box.addEventListener('click', (e) => {
        const d = e.target.closest('.cl-item');
        if (!d || !d.dataset.k) return;  // 里程统计项不参与点选
        setCarSel(carSel === d.dataset.k ? null : d.dataset.k);
      }));

    // 总览两侧面板:收起窄条 ⇄ 展开 切换 + 自动收起
    initCarSides();
    initSpaceMark();

    // 点击车名刷新;点击电量胶囊循环切换 电量% → 度数kWh → 续航km
    const carNameEl = $('#car-name');
    carNameEl.addEventListener('click', refresh);
    carNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refresh(); }
    });
    // 顶栏随滚动收缩成紧凑徽章栏并钉在顶部,回顶展开(迟滞阈值防抖动)
    const headerEl = $('#header');
    let headerMini = false;
    const onHeaderScroll = () => {
      const y = window.scrollY || 0;
      if (!headerMini && y > 40) { headerMini = true; headerEl.classList.add('mini'); }
      else if (headerMini && y < 16) { headerMini = false; headerEl.classList.remove('mini'); }
    };
    window.addEventListener('scroll', onHeaderScroll, { passive: true });
    onHeaderScroll();
    $('#theme-btn').addEventListener('click', () => {
      S.theme = S.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
    });

    // 电量 ⇄ 里程切换:所有切换控件共享一个模式(含 localStorage 持久化恢复)
    setBattMode(S.battMode);
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.batt-toggle button');
      if (b) setBattMode(b.dataset.mode);
    });

    // 充电详情:整卡可折叠,默认折叠,展开状态跨会话记忆
    const csCard = $('#cs-card');
    if (localStorage.getItem('ttv-cs-open') === '1') csCard.classList.add('open');
    const csHead = $('#cs-head');
    const csToggle = () => {
      const open = csCard.classList.toggle('open');
      localStorage.setItem('ttv-cs-open', open ? '1' : '0');
    };
    csHead.addEventListener('click', csToggle);
    csHead.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); csToggle(); }
    });

    initParking();
    initCompanion();
    initControl();

    // 停车费:整卡可折叠,默认收起,展开状态跨会话记忆(与充电详情同款)
    const pkCard = $('#pk-card');
    if (localStorage.getItem('ttv-pk-open') === '1') pkCard.classList.add('open');
    const pkHead = $('#pk-head');
    const pkToggle = () => {
      const open = pkCard.classList.toggle('open');
      localStorage.setItem('ttv-pk-open', open ? '1' : '0');
    };
    pkHead.addEventListener('click', pkToggle);
    pkHead.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pkToggle(); }
    });

    // 家充设置:整卡可折叠,默认收起,展开状态跨会话记忆(与充电详情同款)
    const hcCard = $('#hc-card');
    if (localStorage.getItem('ttv-hc-open') === '1') hcCard.classList.add('open');
    const hcHead = $('#hc-head');
    const hcToggle = () => {
      const open = hcCard.classList.toggle('open');
      localStorage.setItem('ttv-hc-open', open ? '1' : '0');
    };
    hcHead.addEventListener('click', hcToggle);
    hcHead.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hcToggle(); }
    });

    window.addEventListener('resize', () => {
      Object.values(charts).forEach((c) => c && c.resize());
      Object.values(routeElev).forEach((c) => c && c.resize());
      Object.values(routeMaps).forEach((m) => m && m.resize());
      checkThumbResize();
      if (map) map.resize();
      renderCar();  // 引线与标注按舞台实际尺寸定位,需随布局重算
      placeTabBubble(false);  // 气泡宽度随 Tab 布局变化,不播滑动动画
    });

    // 默认时间范围:个人中心「显示偏好」设置,存服务端按账号隔离;
    // localStorage 做秒开缓存,服务端返回不同值时校正并重刷一次
    const cachedDays = Number(localStorage.getItem('ttv-days'));
    if ([1, 7, 30].includes(cachedDays)) S.days = cachedDays;
    api('prefs').then((p) => {
      if (p && [1, 7, 30].includes(p.days)) {
        localStorage.setItem('ttv-days', String(p.days));
        if (p.days !== S.days) { S.days = p.days; refresh(); }
      }
    }).catch(() => { /* 偏好拉取失败就用缓存/默认值 */ });

    refresh();
    S.timer = setInterval(refresh, 60 * 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
