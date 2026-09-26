/* ===== 行车仪表盘:双开口表盘(弧填充,无指针)+ 中央导航地图 =====
   数据全部来自面板后端 /api/dash/*(MQTT 旁听,不直连车辆、不唤醒)。
   点击舞台任意处切换全屏(拖动地图不触发)。
   全局接口:window.TTVDash = { enter, leave } */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------- 统一实时状态 ---------- */
  const DS = {
    active: false,
    state: 'unknown',       // online/offline/asleep/driving/charging
    speed: 0, power: 0, heading: 0, shift: 'P',
    soc: null, rangeKm: null, odometer: null,
    lat: null, lng: null,
    dest: null,
    trip: null,             // 行程基线 {start_odometer, start_battery_level, ...}
    kwhPerPct: 0.85,
    eta: null,              // 充电剩余 {minutes, target_pct}
    _speed: 0, _power: 0,   // 渲染用平滑值
    dirty: true,
  };

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  /* WS 帧 → DS(键与 telemetry.DASH_KEYS 对应) */
  function applyKV(k, v) {
    switch (k) {
      case 'state': DS.state = v; break;
      case 'speed': DS.speed = num(v) ?? 0; break;
      case 'power': DS.power = num(v) ?? 0; break;
      case 'heading': DS.heading = num(v) ?? 0; break;
      case 'shift_state': DS.shift = v || 'P'; break;
      case 'battery_level': DS.soc = num(v); break;
      case 'rated_battery_range_km': DS.rangeKm = num(v); break;
      case 'odometer': DS.odometer = num(v); break;
      case 'latitude': DS.lat = num(v); break;
      case 'longitude': DS.lng = num(v); break;
      case 'active_route_destination': DS.dest = v || null; break;
      default: return;
    }
    DS.dirty = true;
  }

  const isDriving = () =>
    DS.state === 'driving' || ['D', 'R'].includes(DS.shift) || DS.speed > 1;

  /* ---------- 快照 + WebSocket ---------- */
  let ws = null, retry = 0, wsTimer = null;

  async function loadSnapshot() {
    try {
      const d = await window.__ttvApi('dash/snapshot');
      Object.entries(d.values || {}).forEach(([k, v]) => applyKV(k, v));
      DS.trip = d.trip || null;
      DS.kwhPerPct = d.kwh_per_pct || 0.85;
      DS.eta = d.charge_eta || null;
      DS.dirty = true;
    } catch (e) { /* 快照失败:等 WS 数据流入即可 */ }
  }

  function connectWs() {
    if (!DS.active || (ws && ws.readyState <= 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(`${proto}://${location.host}/api/dash/ws`); }
    catch (e) { scheduleReconnect(); return; }
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.k === '_ping') return;
        applyKV(m.k, m.v);
      } catch (e) { /* 忽略坏帧 */ }
    };
    ws.onopen = () => { retry = 0; };
    ws.onclose = () => { ws = null; scheduleReconnect(); };
    ws.onerror = () => { try { ws && ws.close(); } catch (e) { } };
  }

  function scheduleReconnect() {
    if (!DS.active || wsTimer) return;
    const wait = Math.min(30000, 1000 * 2 ** retry++);
    wsTimer = setTimeout(() => { wsTimer = null; connectWs(); }, wait);
  }

  function closeWs() {
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
    if (ws) { try { ws.close(); } catch (e) { } ws = null; }
  }

  /* ---------- 全屏 / 横屏 / 防息屏 ---------- */
  let wakeLock = null;
  let fsFallback = false;  // iPhone Safari 无 Fullscreen API:用 fixed 铺满眼见为全屏

  const isFullscreen = () => !!document.fullscreenElement || fsFallback;

  async function requestImmersive() {
    const stage = $('dash-stage');
    if (!stage || isFullscreen()) return;
    let realFs = false;
    if (stage.requestFullscreen) {
      try {
        await stage.requestFullscreen({ navigationUI: 'hide' });
        realFs = true;
        try { await screen.orientation.lock('landscape'); } catch (e) { }
      } catch (e) { /* 被拒绝:走伪全屏 */ }
    }
    if (!realFs) {
      fsFallback = true;
      stage.classList.add('fs-fallback');
      document.body.style.overflow = 'hidden';  // 锁底层页面滚动
      window.scrollTo(0, 0);
    }
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { }
    dashMap && dashMap.resize();
  }

  async function exitImmersive() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) { }
    if (fsFallback) {
      fsFallback = false;
      $('dash-stage')?.classList.remove('fs-fallback');
      document.body.style.overflow = '';
    }
    try { wakeLock && wakeLock.release(); } catch (e) { }
    wakeLock = null;
    dashMap && dashMap.resize();
  }

  /* 点击舞台切全屏;拖动/ pinch(位移>8px 或长按)不触发 */
  function bindTapFullscreen() {
    const stage = $('dash-stage');
    let down = null;
    stage.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    stage.addEventListener('pointerup', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      const tap = Math.hypot(dx, dy) < 8 && Date.now() - down.t < 500;
      down = null;
      if (!tap) return;
      // 地图控件(缩放钮等)上的点击不切换
      if (e.target.closest('.maplibregl-ctrl')) return;
      if (isFullscreen()) exitImmersive();
      else requestImmersive();
    });
    stage.addEventListener('pointercancel', () => { down = null; });
  }

  /* ---------- 表盘几何 ----------
     viewBox 320×320,中心 (160,160),轨道半径 126。
     角度:0=正东,顺时针(屏幕坐标 y 向下)。
     左表开口朝右(0°):弧从 42° 顺时针经 90/180/270 到 318°。
     右表开口朝左(180°):弧从 222° 顺时针经 270/0/90 到 138°。 */
  const CX = 160, CY = 160, R = 126, GAP = 42;
  const L_A0 = GAP, L_SPAN = 360 - 2 * GAP;         // 左表 42 → 318
  const R_A0 = 180 + GAP;                            // 右表 222 → 498(≡138)

  const SPEED_MAX = 180;    // km/h
  const PWR_MIN = -50, PWR_MAX = 150;  // kW

  const polar = (r, deg) => {
    const rad = deg * Math.PI / 180;
    return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
  };
  function arcPath(r, a0, a1) {
    const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const lDeg = (v) => L_A0 + Math.max(0, Math.min(1, v / SPEED_MAX)) * L_SPAN;
  const rDeg = (v) => R_A0 +
    Math.max(0, Math.min(1, (v - PWR_MIN) / (PWR_MAX - PWR_MIN))) * L_SPAN;

  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };

  let gaugesBuilt = false;
  function buildGauges() {
    if (gaugesBuilt) return;
    gaugesBuilt = true;

    // 渐变定义(两个 svg 各自需要)
    const defs = (svg, id, stops) => {
      const d = mk('defs', {});
      const g = mk('linearGradient', { id, x1: '0%', y1: '100%', x2: '100%', y2: '0%' });
      stops.forEach(([o, c]) => g.appendChild(mk('stop', { offset: o, 'stop-color': c })));
      d.appendChild(g);
      svg.appendChild(d);
    };
    const svgL = $('dg-l-svg'), svgR = $('dg-r-svg');
    defs(svgL, 'dg-grad-speed', [['0%', '#22d3ee'], ['55%', '#38bdf8'], ['100%', '#3b82f6']]);
    defs(svgR, 'dg-grad-power', [['0%', '#fbbf24'], ['60%', '#f59e0b'], ['100%', '#ef4444']]);

    // 轨道
    svgL.appendChild(mk('path', { class: 'dg-track', d: arcPath(R, L_A0, L_A0 + L_SPAN) }));
    svgR.appendChild(mk('path', { class: 'dg-track', d: arcPath(R, R_A0, R_A0 + L_SPAN) }));

    // 刻度与数字
    const ticks = (svg, degFn, vmin, vmax, minor, major, labels) => {
      for (let v = vmin; v <= vmax; v += minor) {
        const deg = degFn(v);
        const isMajor = v % major === 0;
        const [x0, y0] = polar(R - 12, deg);
        const [x1, y1] = polar(R - (isMajor ? 24 : 19), deg);
        svg.appendChild(mk('line', {
          class: 'dg-tick' + (isMajor ? ' major' : '') + (v === 0 && vmin < 0 ? ' zero' : ''),
          x1: x0, y1: y0, x2: x1, y2: y1,
        }));
        if (labels.includes(v)) {
          const [tx, ty] = polar(R - 40, deg);
          const t = mk('text', { class: 'dg-lab' + (v === 0 && vmin < 0 ? ' zero' : ''), x: tx, y: ty });
          t.textContent = String(v);
          svg.appendChild(t);
        }
      }
    };
    ticks(svgL, lDeg, 0, SPEED_MAX, 10, 30, [0, 30, 60, 90, 120, 150, 180]);
    ticks(svgR, rDeg, PWR_MIN, PWR_MAX, 25, 50, [-50, 0, 50, 100]);  // 150 在开口边缘且与电量胶囊重叠,不标

    // 填充弧(右表两条:正向功率 + 回收)
    svgL.appendChild(mk('path', { id: 'dg-l-fill', class: 'dg-fill speed', d: '' }));
    svgR.appendChild(mk('path', { id: 'dg-r-fill', class: 'dg-fill power', d: '' }));
    svgR.appendChild(mk('path', { id: 'dg-r-regen', class: 'dg-fill regen', d: '' }));
  }

  function renderGauges() {
    buildGauges();
    // 左表:速度填充(从底端 42° 起)
    const lf = $('dg-l-fill');
    const sd = lDeg(DS._speed);
    lf.setAttribute('d', DS._speed > 0.4 ? arcPath(R, L_A0, sd) : '');
    lf.style.opacity = DS._speed > 0.4 ? 1 : 0;

    // 右表:功率(零位 rDeg(0) 起,正向琥珀、回收绿)
    const rf = $('dg-r-fill'), rg = $('dg-r-regen');
    const zero = rDeg(0), pd = rDeg(DS._power);
    if (DS._power > 0.4) {
      rf.setAttribute('d', arcPath(R, zero, pd));
      rf.style.opacity = 1; rg.style.opacity = 0; rg.setAttribute('d', '');
    } else if (DS._power < -0.4) {
      rg.setAttribute('d', arcPath(R, pd, zero));
      rg.style.opacity = 1; rf.style.opacity = 0; rf.setAttribute('d', '');
    } else {
      rf.style.opacity = 0; rg.style.opacity = 0;
      rf.setAttribute('d', ''); rg.setAttribute('d', '');
    }

    // 中心读数
    setText('dg-speed', String(Math.round(DS._speed)));
    setText('dg-shift', DS.shift || 'P');
    const pw = Math.round(DS._power);
    setText('dg-power', String(Math.abs(pw)));
    document.querySelector('.dg-power')?.classList.toggle('regen', pw < 0);
    setText('dg-soc', DS.soc === null ? '—' : `${Math.round(DS.soc)}%`);
    setText('dg-range', DS.rangeKm === null ? '—' : `${Math.round(DS.rangeKm)} km`);
  }

  /* ---------- 中央地图 ---------- */
  let dashMap = null, dashMarker = null, mapReady = false;

  async function initDashMap() {
    if (dashMap || !window.maplibregl || !window.__ttvLoadMapStyle) return;
    const style = await window.__ttvLoadMapStyle('dark');  // 行车场景固定深色底图
    dashMap = new maplibregl.Map({
      container: 'dash-map',
      style,
      attributionControl: false,
      dragPan: true,
      pitchWithRotate: false,
    });
    dashMap.on('load', () => {
      mapReady = true;
      const el = document.createElement('div');
      el.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2l7 19-7-4-7 4z" fill="#3b82f6" stroke="#fff" stroke-width="1.4"/></svg>';
      dashMarker = new maplibregl.Marker({ element: el.firstChild, rotationAlignment: 'map' })
        .setLngLat([DS.lng ?? 116.39, DS.lat ?? 39.9]).addTo(dashMap);
      if (DS.lat && DS.lng) dashMap.jumpTo({ center: [DS.lng, DS.lat], zoom: 16 });
      DS.dirty = true;
    });
  }

  const setText = (id, v) => {
    const el = $(id);
    if (el && el.textContent !== v) el.textContent = v;
  };
  const fmt = (v, d = 0) => v === null || v === undefined || isNaN(v)
    ? '—' : Number(v).toFixed(d);

  function tripStats() {
    if (!DS.trip || DS.odometer === null || DS.odometer === undefined) return null;
    const km = DS.odometer - (DS.trip.start_odometer ?? DS.odometer);
    const kwh = DS.soc !== null && DS.trip.start_battery_level !== null
      ? (DS.trip.start_battery_level - DS.soc) * DS.kwhPerPct : null;
    const eff = km > 0.5 && kwh !== null ? kwh * 1000 / km : null;
    return { km, kwh, eff };
  }

  function renderMap() {
    if (!dashMap || !mapReady) return;
    const t = tripStats();
    setText('ds-map-trip', t && t.km > 0.1
      ? `本次 ${fmt(t.km, 1)} km · ${fmt(t.kwh, 1)} kWh · ${t.eff ? fmt(t.eff, 0) + ' Wh/km' : '—'}`
      : '本次行程待开始');
    const dest = $('ds-map-dest');
    if (dest) {
      dest.hidden = !DS.dest;
      if (DS.dest) dest.textContent = `→ ${DS.dest}`;
    }
    if (DS.lat && DS.lng && dashMarker) {
      dashMarker.setLngLat([DS.lng, DS.lat]);
      dashMarker.setRotation(DS.heading);
      dashMap.easeTo({
        center: [DS.lng, DS.lat],
        bearing: isDriving() ? -DS.heading : dashMap.getBearing(),
        duration: 400,
      });
    }
  }

  /* ---------- 驻车/离线/充电状态条 ---------- */
  function renderParked() {
    const bar = $('dash-parked');
    const parked = !isDriving();
    if (bar) bar.hidden = !parked;
    if (!parked) return;
    setText('ds-p-soc', DS.soc === null ? '—' : `${Math.round(DS.soc)}%`);
    setText('ds-p-range', DS.rangeKm === null ? '' : `续航 ${Math.round(DS.rangeKm)} km`);
    const eta = $('ds-p-eta');
    if (eta) {
      eta.hidden = !DS.eta;
      if (DS.eta) eta.textContent = `⚡约剩 ${DS.eta.minutes} 分(至 ${DS.eta.target_pct}%)`;
    }
  }

  /* ---------- 主循环 ---------- */
  let raf = null, lastClock = 0;

  function tick(ts) {
    if (!DS.active) { raf = null; return; }
    DS._speed += (DS.speed - DS._speed) * 0.18;
    DS._power += (DS.power - DS._power) * 0.18;
    if (ts - lastClock > 1000) {
      lastClock = ts;
      setText('ds-p-clock', new Date().toTimeString().slice(0, 5));
    }
    // 弧填充持续平滑动画,每帧渲染
    renderGauges();
    renderMap();
    renderParked();
    raf = requestAnimationFrame(tick);
  }

  /* ---------- 生命周期 ---------- */
  let bound = false;

  function bind() {
    if (bound) return;
    bound = true;
    bindTapFullscreen();
    document.addEventListener('visibilitychange', () => {
      if (!DS.active) return;
      if (document.hidden) closeWs();
      else { loadSnapshot(); connectWs(); }
    });
  }

  async function enter() {
    bind();
    DS.active = true;
    buildGauges();
    initDashMap();
    await loadSnapshot();
    connectWs();
    if (!raf) raf = requestAnimationFrame(tick);
    // 触屏/窄屏自动全屏(Tab 点击的短暂激活窗口内);__ttvNoAutoFs 供测试禁用
    const auto = window.matchMedia('(pointer: coarse)').matches || innerWidth < 1024;
    if (auto && !window.__ttvNoAutoFs) await requestImmersive();
  }

  function leave() {
    DS.active = false;
    closeWs();
    exitImmersive();
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  window.TTVDash = { enter, leave, DS };
})();
