/* ===== 行车仪表盘:MQTT→WebSocket 实时状态 + 5 套可切换表盘 =====
   数据全部来自面板后端 /api/dash/*(MQTT 旁听,不直连车辆、不唤醒)。
   全局接口:window.TTVDash = { enter, leave, setSkin } */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SKINS = ['minimal', 'gauges', 'map', 'aviator', 'spacex'];

  /* ---------- 统一实时状态 ---------- */
  const DS = {
    active: false,          // 仪表盘页是否在前台
    skin: localStorage.getItem('ttv-dash-skin') || 'minimal',
    state: 'unknown',       // online/offline/asleep/driving/charging
    speed: 0, power: 0, heading: 0, shift: 'P',
    soc: null, rangeKm: null,
    inTemp: null, outTemp: null, odometer: null,
    lat: null, lng: null,
    dest: null, sentry: false, locked: null, climate: false,
    trip: null,             // 行程基线 {start_odometer, start_battery_level, ...}
    kwhPerPct: 0.85,
    eta: null,              // 充电剩余 {minutes, target_pct}
    // 渲染用平滑值
    _speed: 0, _power: 0,
    trace: [],              // 60s 功率曲线 [{t, p}]
    dirty: true,
  };

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const bool = (v) => v === 'true' || v === 'True' || v === '1';

  /* WS 帧 → DS(键与 telemetry.DASH_KEYS 对应) */
  function applyKV(k, v) {
    switch (k) {
      case 'state': DS.state = v; break;
      case 'speed': DS.speed = num(v) ?? 0; pushTrace(); break;
      case 'power': DS.power = num(v) ?? 0; pushTrace(); break;
      case 'heading': DS.heading = num(v) ?? 0; break;
      case 'shift_state': DS.shift = v || 'P'; break;
      case 'battery_level': DS.soc = num(v); break;
      case 'rated_battery_range_km': DS.rangeKm = num(v); break;
      case 'inside_temp': DS.inTemp = num(v); break;
      case 'outside_temp': DS.outTemp = num(v); break;
      case 'odometer': DS.odometer = num(v); break;
      case 'latitude': DS.lat = num(v); break;
      case 'longitude': DS.lng = num(v); break;
      case 'active_route_destination': DS.dest = v || null; break;
      case 'sentry_mode': DS.sentry = bool(v); break;
      case 'locked': DS.locked = bool(v); break;
      case 'is_climate_on': DS.climate = bool(v); break;
      default: return;
    }
    DS.dirty = true;
  }

  function pushTrace() {
    const t = Date.now();
    DS.trace.push({ t, p: DS.power });
    while (DS.trace.length && t - DS.trace[0].t > 60000) DS.trace.shift();
  }

  const isDriving = () =>
    DS.state === 'driving' || ['D', 'R'].includes(DS.shift) || DS.speed > 1;
  const isCharging = () => DS.state === 'charging' || !!DS.eta;

  /* ---------- 快照 + WebSocket ---------- */
  let ws = null, retry = 0, wsTimer = null;

  async function loadSnapshot() {
    try {
      const api = window.__ttvApi;
      const d = await api('dash/snapshot');
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

  async function requestImmersive(force = false) {
    const stage = $('dash-stage');
    // 桌面宽屏不自动全屏(全屏钮仍可手动触发);触屏/窄屏自动进沉浸态
    const auto = window.matchMedia('(pointer: coarse)').matches || innerWidth < 1024;
    if ((!auto && !force) || !stage || isFullscreen()) return;
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
    pokeChrome();
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
  }

  /* 全屏时 3s 无操作隐藏皮肤切换条,点舞台唤出 */
  let chromeTimer = null;
  function pokeChrome() {
    const stage = $('dash-stage');
    if (!stage) return;
    stage.classList.remove('chrome-hidden');
    if (chromeTimer) clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => {
      if (isFullscreen()) stage.classList.add('chrome-hidden');
    }, 3000);
  }

  /* ---------- 皮肤切换 ---------- */
  function setSkin(skin) {
    if (!SKINS.includes(skin)) skin = 'minimal';
    DS.skin = skin;
    localStorage.setItem('ttv-dash-skin', skin);
    document.querySelectorAll('#dash-dots .dash-dot').forEach((d) =>
      d.classList.toggle('on', d.dataset.skin === skin));
    document.querySelectorAll('.dash-skin').forEach((s) =>
      s.classList.toggle('on', s.dataset.skin === skin));
    if (skin === 'map') initDashMap();
    if (skin === 'aviator') sizeAviator();
    DS.dirty = true;
  }

  /* ---------- 渲染:公共 ---------- */
  const setText = (id, v) => {
    const el = $(id);
    if (el && el.textContent !== v) el.textContent = v;
  };
  const fmt = (v, d = 0) => v === null || v === undefined || isNaN(v)
    ? '—' : Number(v).toFixed(d);

  function tripStats() {
    if (!DS.trip || DS.odometer === null) return null;
    const km = DS.odometer - (DS.trip.start_odometer ?? DS.odometer);
    const kwh = DS.soc !== null && DS.trip.start_battery_level !== null
      ? (DS.trip.start_battery_level - DS.soc) * DS.kwhPerPct : null;
    const eff = km > 0.5 && kwh !== null ? kwh * 1000 / km : null;
    return { km, kwh, eff };
  }

  /* ---------- 皮肤 1:极简数字 ---------- */
  function renderMinimal() {
    setText('ds-m-speed', String(Math.round(DS._speed)));
    setText('ds-m-shift', DS.shift || 'P');
    setText('ds-m-soc', DS.soc === null ? '—' : `${Math.round(DS.soc)}%`);
    setText('ds-m-range', DS.rangeKm === null ? '—' : `${Math.round(DS.rangeKm)} km`);
    setText('ds-m-intemp', DS.inTemp === null ? '—' : `${fmt(DS.inTemp, 1)}°`);
    setText('ds-m-outtemp', `车外 ${DS.outTemp === null ? '—' : fmt(DS.outTemp, 0) + '°'}`);
    const p = DS._power;
    setText('ds-m-powerval', `${p < 0 ? '回收 ' : ''}${fmt(Math.abs(p), 0)} kW`);
    const fill = $('ds-m-powerfill');
    if (fill) {
      // 负功率(回收)绿色向左生长;正功率琥珀向右
      const w = Math.min(100, Math.abs(p) / 150 * 100);
      fill.style.width = w + '%';
      fill.style.backgroundColor = p < 0 ? '#4ade80' : '#f59e0b';
      fill.style.marginLeft = p < 0 ? (100 - w) + '%' : '0';
    }
    drawTrace();
  }

  function drawTrace() {
    const cv = $('ds-m-trace');
    if (!cv || !DS.trace.length) return;
    const w = cv.clientWidth, h = 36;
    if (cv.width !== w * devicePixelRatio) {
      cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const now = Date.now(), span = 60000, mid = h * 0.6;
    ctx.strokeStyle = 'rgba(232,238,245,.18)';
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
    ctx.beginPath();
    DS.trace.forEach((s, i) => {
      const x = w - (now - s.t) / span * w;
      const y = mid - Math.max(-1, Math.min(1, s.p / 150)) * (mid - 3);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = 'rgba(96,165,250,.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* ---------- 皮肤 2:双圆机械表 ---------- */
  let gaugesBuilt = false;
  const GA = { r: 150, a0: -210, a1: 30 };  // 240° 表盘

  function polar(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }
  function arcPath(cx, cy, r, d0, d1) {
    const [x0, y0] = polar(cx, cy, r, d0), [x1, y1] = polar(cx, cy, r, d1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  }
  const gDeg = (v, vmin, vmax) =>
    GA.a0 + Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin))) * (GA.a1 - GA.a0);

  function buildGauges() {
    if (gaugesBuilt) return;
    gaugesBuilt = true;
    const svg = $('ds-g-svg');
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
      return e;
    };
    // 左表:速度 0–180;右表:功率 -50–150
    [[190, 'speed'], [570, 'power']].forEach(([cx, kind]) => {
      const cy = 185;
      svg.appendChild(mk('path', {
        d: arcPath(cx, cy, GA.r, GA.a0, GA.a1),
        fill: 'none', stroke: 'rgba(232,238,245,.14)', 'stroke-width': 10,
        'stroke-linecap': 'round',
      }));
      const vmin = kind === 'speed' ? 0 : -50, vmax = kind === 'speed' ? 180 : 150;
      const step = kind === 'speed' ? 20 : 25;
      for (let v = vmin; v <= vmax; v += step) {
        const deg = gDeg(v, vmin, vmax);
        const [x0, y0] = polar(cx, cy, GA.r - 14, deg);
        const [x1, y1] = polar(cx, cy, GA.r - 26, deg);
        svg.appendChild(mk('line', {
          x1: x0, y1: y0, x2: x1, y2: y1,
          stroke: v < 0 ? 'rgba(74,222,128,.7)' : 'rgba(232,238,245,.4)',
          'stroke-width': 2,
        }));
        if ((kind === 'speed' && v % 40 === 0) || (kind === 'power' && v % 50 === 0)) {
          const [tx, ty] = polar(cx, cy, GA.r - 44, deg);
          const t = mk('text', {
            x: tx, y: ty, fill: 'rgba(232,238,245,.5)', 'font-size': 13,
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
          });
          t.textContent = String(v);
          svg.appendChild(t);
        }
      }
      // 彩色进度弧 + 指针
      svg.appendChild(mk('path', {
        id: `ds-g-${kind}-arc`, fill: 'none', 'stroke-width': 10,
        'stroke-linecap': 'round',
        stroke: kind === 'speed' ? '#3b82f6' : '#f59e0b',
      }));
      svg.appendChild(mk('line', {
        id: `ds-g-${kind}-needle`,
        x1: cx, y1: cy, x2: cx, y2: cy - GA.r + 34,
        stroke: '#e8eef5', 'stroke-width': 3, 'stroke-linecap': 'round',
        transform: `rotate(${GA.a0} ${cx} ${cy})`,
      }));
      svg.appendChild(mk('circle', { cx, cy, r: 8, fill: '#e8eef5' }));
      const lab = mk('text', {
        x: cx, y: cy + 108, fill: 'rgba(232,238,245,.45)', 'font-size': 13,
        'text-anchor': 'middle',
      });
      lab.textContent = kind === 'speed' ? 'km/h' : 'kW';
      svg.appendChild(lab);
      const val = mk('text', {
        id: `ds-g-${kind}-val`, x: cx, y: cy + 76, fill: '#e8eef5',
        'font-size': 30, 'text-anchor': 'middle', 'font-weight': 300,
      });
      val.textContent = '0';
      svg.appendChild(val);
    });
  }

  function renderGauges() {
    buildGauges();
    const sd = gDeg(DS._speed, 0, 180);
    const pd = gDeg(DS._power, -50, 150);
    const set = (kind, deg, vmin, vmax, val) => {
      const cx = kind === 'speed' ? 190 : 570, cy = 185;
      const n = $(`ds-g-${kind}-needle`);
      if (n) n.setAttribute('transform', `rotate(${deg} ${cx} ${cy})`);
      const a = $(`ds-g-${kind}-arc`);
      if (a) a.setAttribute('d', arcPath(cx, cy, GA.r, GA.a0, deg));
      const t = $(`ds-g-${kind}-val`);
      if (t) t.textContent = String(Math.round(Math.abs(val)));
    };
    set('speed', sd, 0, 180, DS._speed);
    set('power', pd, -50, 150, DS._power);
    const pa = $('ds-g-power-arc');
    if (pa) pa.setAttribute('stroke', DS._power < 0 ? '#4ade80' : '#f59e0b');
    setText('ds-g-soc', DS.soc === null ? '—' : `${Math.round(DS.soc)}%`);
    setText('ds-g-shift', DS.shift || 'P');
  }

  /* ---------- 皮肤 3:导航地图 ---------- */
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

  function renderMap() {
    if (!dashMap || !mapReady) return;
    setText('ds-map-speed', String(Math.round(DS._speed)));
    setText('ds-map-powerval', `${fmt(Math.abs(DS._power), 0)} kW`);
    const pw = $('ds-map-powerfill');
    if (pw) {
      pw.style.setProperty('--pw', Math.min(100, Math.abs(DS._power) / 150 * 100) + '%');
      pw.style.setProperty('--pc', DS._power < 0 ? '#4ade80' : '#f59e0b');
    }
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

  /* ---------- 皮肤 4:航空速带 ---------- */
  function sizeAviator() {
    const cv = $('ds-a-canvas');
    if (!cv) return;
    cv.width = cv.clientWidth * devicePixelRatio;
    cv.height = cv.clientHeight * devicePixelRatio;
  }

  function renderAviator() {
    const cv = $('ds-a-canvas');
    if (!cv || !cv.clientWidth) return;
    sizeAviator();
    const ctx = cv.getContext('2d');
    const w = cv.clientWidth, h = cv.clientHeight;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ink = 'rgba(125,211,252,.9)', dim = 'rgba(125,211,252,.35)';

    // 速度横带:每 10 km/h 一格,当前值居中(上下各留边,底部让位状态行)
    const midY = h / 2, pxPer = 7, yTop = 56, yBot = h - 44;
    ctx.strokeStyle = dim; ctx.fillStyle = dim;
    ctx.lineWidth = 1; ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const v0 = Math.max(0, DS._speed - midY / pxPer);
    const v1 = DS._speed + midY / pxPer;
    ctx.beginPath(); ctx.moveTo(60, yTop); ctx.lineTo(60, yBot); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, yTop - 14, w, yBot - yTop + 20); ctx.clip();
    for (let v = Math.ceil(v0 / 10) * 10; v <= v1; v += 10) {
      const y = midY - (v - DS._speed) * pxPer;
      ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(74, y); ctx.stroke();
      ctx.fillText(String(v), 40, y + 4);
    }
    ctx.restore();
    // 当前值游标框
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
    ctx.strokeRect(78, midY - 30, 92, 60);
    ctx.fillStyle = '#e0f2fe';
    ctx.font = '300 44px ui-monospace, monospace';
    ctx.fillText(String(Math.round(DS._speed)), 124, midY + 16);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = dim;
    ctx.fillText('KM/H', 124, midY + 48);

    // 顶部罗盘带
    const cy = 34, cxm = w / 2, degPx = 4;
    ctx.textAlign = 'center'; ctx.font = '11px ui-monospace, monospace';
    const h0 = DS.heading - cxm / degPx, h1 = DS.heading + cxm / degPx;
    const dirs = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = Math.ceil(h0 / 15) * 15; d <= h1; d += 15) {
      const x = cxm + (d - DS.heading) * degPx;
      const norm = ((d % 360) + 360) % 360;
      const major = norm % 45 === 0;
      ctx.strokeStyle = dim;
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy + (major ? 10 : 5)); ctx.stroke();
      if (major) { ctx.fillStyle = ink; ctx.fillText(dirs[norm] || String(norm), x, cy - 6); }
    }
    ctx.beginPath(); ctx.moveTo(cxm, cy + 14); ctx.lineTo(cxm - 6, cy + 24); ctx.lineTo(cxm + 6, cy + 24); ctx.closePath();
    ctx.fillStyle = '#e0f2fe'; ctx.fill();

    // 右侧功率竖带(-50..150)
    const px = w - 64, pTop = 60, pBot = h - 40, pSpan = pBot - pTop;
    const pDeg = (p) => pBot - (p + 50) / 200 * pSpan;
    ctx.strokeStyle = dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, pTop); ctx.lineTo(px, pBot); ctx.stroke();
    for (let p = 0; p <= 150; p += 50) {
      ctx.beginPath(); ctx.moveTo(px, pDeg(p)); ctx.lineTo(px - 8, pDeg(p)); ctx.stroke();
      ctx.fillStyle = dim; ctx.textAlign = 'right';
      ctx.fillText(String(p), px - 12, pDeg(p) + 4);
    }
    const py = pDeg(DS._power);
    ctx.fillStyle = DS._power < 0 ? '#4ade80' : '#f59e0b';
    ctx.fillRect(px - 4, Math.min(py, pDeg(0)), 8, Math.abs(pDeg(0) - py));
    ctx.fillStyle = '#e0f2fe'; ctx.textAlign = 'right';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(`${fmt(Math.abs(DS._power), 0)}kW`, px - 12, py + 4);

    // 底部状态行
    ctx.textAlign = 'left'; ctx.fillStyle = dim; ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(`SOC ${DS.soc === null ? '—' : Math.round(DS.soc) + '%'}   RNG ${DS.rangeKm === null ? '—' : Math.round(DS.rangeKm) + 'km'}   ${DS.shift}`, 20, h - 16);
  }

  /* ---------- 皮肤 5:SpaceX 遥测网格 ---------- */
  let spacexBuilt = false;
  const SX_CELLS = [
    { k: 'SPD', id: 'spd', hero: true, u: 'km/h' },
    { k: 'PWR', id: 'pwr', u: 'kW' },
    { k: 'SOC', id: 'soc', u: '%' },
    { k: 'RNG', id: 'rng', u: 'km' },
    { k: 'HDG', id: 'hdg', u: 'deg' },
    { k: 'TRIP', id: 'trip', u: 'km' },
    { k: 'NRG', id: 'nrg', u: 'kWh' },
    { k: 'EFF', id: 'eff', u: 'Wh/km' },
    { k: 'CABIN', id: 'tin', u: '°C' },
    { k: 'EXT', id: 'tout', u: '°C' },
    { k: 'ODO', id: 'odo', u: 'km' },
  ];

  function buildSpacex() {
    if (spacexBuilt) return;
    spacexBuilt = true;
    const grid = $('dsx-grid');
    SX_CELLS.forEach((c) => {
      const cell = document.createElement('div');
      cell.className = 'dsx-cell' + (c.hero ? ' hero' : '');
      cell.innerHTML = `<span class="dsx-k">${c.k}</span><b class="dsx-v" id="dsx-${c.id}">—</b><span class="dsx-u">${c.u}</span>`;
      grid.appendChild(cell);
    });
    // 4 列网格:hero 占 2×2,余下单元补足整行,空位用深色填充格(露出 gap 底色会像坏块)
    const cols = 4, used = 4 + (SX_CELLS.length - 1);
    const fillers = (Math.ceil(used / cols) * cols - used) % cols;
    for (let i = 0; i < fillers; i++) {
      const f = document.createElement('div');
      f.className = 'dsx-cell dsx-filler';
      f.innerHTML = '<span class="dsx-dots"><i></i><i></i><i class="on"></i><i></i><i></i></span>';
      grid.appendChild(f);
    }
  }

  function renderSpacex() {
    buildSpacex();
    const t = tripStats();
    setText('dsx-spd', fmt(DS._speed, 0));
    setText('dsx-pwr', fmt(DS._power, 0));
    setText('dsx-soc', DS.soc === null ? '—' : fmt(DS.soc, 0));
    setText('dsx-rng', DS.rangeKm === null ? '—' : fmt(DS.rangeKm, 0));
    setText('dsx-hdg', fmt(DS.heading, 0));
    setText('dsx-trip', t ? fmt(t.km, 1) : '—');
    setText('dsx-nrg', t && t.kwh !== null ? fmt(t.kwh, 1) : '—');
    setText('dsx-eff', t && t.eff ? fmt(t.eff, 0) : '—');
    setText('dsx-tin', DS.inTemp === null ? '—' : fmt(DS.inTemp, 1));
    setText('dsx-tout', DS.outTemp === null ? '—' : fmt(DS.outTemp, 0));
    setText('dsx-odo', DS.odometer === null ? '—' : fmt(DS.odometer, 0));
  }

  /* ---------- 驻车/离线/充电状态条 ---------- */
  function renderParked() {
    const bar = $('dash-parked');
    const parked = !isDriving();
    if (bar) bar.hidden = !parked;
    if (!parked) return;
    setText('ds-p-soc', DS.soc === null ? '—' : `${Math.round(DS.soc)}%`);
    setText('ds-p-range', DS.rangeKm === null ? '' : `续航 ${Math.round(DS.rangeKm)} km`);
    const chips = $('ds-p-chips');
    if (chips) {
      const items = [
        ['哨兵', DS.sentry], ['已锁', DS.locked === true],
        ['空调', DS.climate], ['离线', DS.state === 'offline'],
        ['休眠', DS.state === 'asleep'],
      ];
      chips.innerHTML = items
        .map(([n, on]) => `<span class="dsp-chip${on ? ' on' : ''}">${n}</span>`)
        .join('');
    }
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
    // 平滑跟随(机械表指针/速带滚动的阻尼感)
    DS._speed += (DS.speed - DS._speed) * 0.18;
    DS._power += (DS.power - DS._power) * 0.18;
    if (ts - lastClock > 1000) {
      lastClock = ts;
      const s = new Date().toTimeString().slice(0, 5);
      setText('ds-m-clock', s);
      setText('ds-p-clock', s);
    }
    if (DS.dirty || DS.skin === 'aviator' || DS.skin === 'gauges' || DS.skin === 'minimal') {
      DS.dirty = false;
      renderParked();
      if (DS.skin === 'minimal') renderMinimal();
      else if (DS.skin === 'gauges') renderGauges();
      else if (DS.skin === 'map') renderMap();
      else if (DS.skin === 'aviator') renderAviator();
      else if (DS.skin === 'spacex') renderSpacex();
    }
    raf = requestAnimationFrame(tick);
  }

  /* ---------- 生命周期 ---------- */
  let bound = false;

  function bind() {
    if (bound) return;
    bound = true;
    $('dash-dots').addEventListener('click', (e) => {
      const b = e.target.closest('.dash-dot');
      if (b) { setSkin(b.dataset.skin); pokeChrome(); }
    });
    $('dash-fs').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isFullscreen()) await exitImmersive();
      else await requestImmersive(true);
      pokeChrome();
    });
    $('dash-stage').addEventListener('pointerdown', pokeChrome);
    document.addEventListener('visibilitychange', () => {
      if (!DS.active) return;
      if (document.hidden) closeWs();
      else { loadSnapshot(); connectWs(); }
    });
  }

  async function enter() {
    bind();
    DS.active = true;
    setSkin(DS.skin);
    pokeChrome();
    await loadSnapshot();
    connectWs();
    if (!raf) raf = requestAnimationFrame(tick);
    // 触屏/窄屏自动全屏+横屏(Tab 点击的短暂激活窗口内);__ttvNoAutoFs 供测试禁用
    if (!window.__ttvNoAutoFs) await requestImmersive();
  }

  function leave() {
    DS.active = false;
    closeWs();
    exitImmersive();
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  window.TTVDash = { enter, leave, setSkin, DS };
})();
