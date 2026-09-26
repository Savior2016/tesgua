/* ===== 导航页:目的地搜索 / 途经点 / 沿途服务区 / 电量区间规划 / 推送 =====
   高德调用全部走后端代理(/api/nav/*),key 不下发浏览器。
   全局接口:window.TTNav = { enter } */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = (p, opts) => window.__ttvApi(p, opts);

  const NS = {
    inited: false, map: null, mapTheme: '',
    carPos: null,          // 车辆位置 [lng, lat](可能读不到)
    originManual: null,    // 手动起点 {name, location "lng,lat"}
    dest: null,            // {name, location "lng,lat", address}
    waypoints: [],         // [{name, location, kind: 'road'|'service'|'charger', id?}]
    paths: [], selPath: 0,
    plan: null,
    markers: [],
    carSoc: null,
  };
  // 实际起点:手动优先,其次车辆位置;返回值 "lng,lat" 或 null
  const originLoc = () =>
    NS.originManual ? NS.originManual.location
      : (NS.carPos ? NS.carPos.join(',') : null);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const msgEl = $('nav-msg');
  const msg = (t, cls = '') => { msgEl.textContent = t; msgEl.className = 'nav-msg ' + cls; };

  /* ---------- 地图 ---------- */
  async function initMap() {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const style = await window.__ttvLoadMapStyle(theme);
    NS.mapTheme = theme;
    NS.map = new maplibregl.Map({
      container: 'nav-map', style, attributionControl: false,
      center: [116.39, 39.9], zoom: 9,
    });
    NS.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    NS.map.on('load', () => {
      NS.map.addSource('nav-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      NS.map.addLayer({ id: 'nav-route-line', type: 'line', source: 'nav-route',
        paint: { 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.9 } });
      NS.map.addSource('nav-bands', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      NS.map.addLayer({ id: 'nav-bands-line', type: 'line', source: 'nav-bands',
        paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': 0.95 } },
        'nav-route-line');
      redrawMarkers();
    });
  }

  function setSource(id, features) {
    const src = NS.map && NS.map.getSource(id);
    if (src) src.setData({ type: 'FeatureCollection', features });
  }

  function bandColor(socHi) {
    if (socHi <= 0) return '#6b7280';  // 不可达段:灰
    const h = Math.max(0, Math.min(120, (socHi - 10) / 90 * 120));  // 100%→绿,10%→红
    return `hsl(${h}, 75%, 55%)`;
  }

  function redrawMarkers() {
    NS.markers.forEach((m) => m.remove());
    NS.markers = [];
    const add = (lngLat, html, cls) => {
      const el = document.createElement('div');
      el.className = cls; el.innerHTML = html;
      const mk = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(NS.map);
      NS.markers.push(mk);
    };
    const o = originLoc();
    if (o) { const [lng, lat] = o.split(',').map(Number); add([lng, lat], '🚗', 'nav-mk'); }
    NS.waypoints.forEach((w) => {
      const [lng, lat] = w.location.split(',').map(Number);
      add([lng, lat], w.kind === 'service' ? '⛽' : w.kind === 'charger' ? '⚡' : '🛣️', 'nav-mk');
    });
    if (NS.dest) {
      const [lng, lat] = NS.dest.location.split(',').map(Number);
      add([lng, lat], '🏁', 'nav-mk nav-mk-dest');
    }
    if (NS.plan) NS.plan.stops.forEach((s) => {
      const [lng, lat] = s.location.split(',').map(Number);
      add([lng, lat], '⚡', 'nav-mk nav-mk-chg');
    });
  }

  function drawPath(path) {
    setSource('nav-route', [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: path.polyline },
      properties: {},
    }]);
    const b = path.polyline.reduce((bb, p) => bb.extend(p),
      new maplibregl.LngLatBounds(path.polyline[0], path.polyline[0]));
    NS.map.fitBounds(b, { padding: 60, duration: 500 });
  }

  function drawBands(bands) {
    setSource('nav-bands', (bands || [])
      .filter((b) => b.pts.length >= 2)
      .map((b) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: b.pts },
        properties: { color: bandColor(b.soc_hi) },
      })));
    // 有电量区间带时压低底图蓝线,让色带成为主视觉
    if (NS.map && NS.map.getLayer('nav-route-line')) {
      NS.map.setPaintProperty('nav-route-line', 'line-opacity',
        bands && bands.length ? 0.25 : 0.9);
    }
  }

  /* ---------- 车辆位置 / 起点 ---------- */
  function renderOriginLine() {
    const el = $('nav-origin');
    if (NS.originManual) {
      el.innerHTML = `起点:${esc(NS.originManual.name)} <button class="nav-origin-reset" id="nav-origin-reset">恢复车辆位置</button>`;
      $('nav-origin-reset').onclick = () => {
        NS.originManual = null;
        $('nav-origin-inp').value = '';
        renderOriginLine();
        if (NS.map && NS.map.loaded()) redrawMarkers();
        doRoute();
      };
    } else if (NS.carPos) {
      el.textContent =
        `起点:车辆当前位置${NS.carSoc !== null ? `(电量 ${Math.round(NS.carSoc)}%)` : ''}`;
    } else {
      el.textContent = '起点:车辆位置未知,请在上方输入框手动搜索起点';
    }
  }

  async function loadOrigin() {
    try {
      const d = await api('dash/snapshot');
      const v = d.values || {};
      if (v.longitude && v.latitude) {
        NS.carPos = [parseFloat(v.longitude), parseFloat(v.latitude)];
        NS.carSoc = v.battery_level ? parseFloat(v.battery_level) : null;
        if (NS.carSoc !== null) $('nav-start-soc').textContent = String(Math.round(NS.carSoc));
        if (NS.map && NS.map.loaded()) redrawMarkers();
      }
    } catch (e) { /* 快照失败:carPos 保持 null,走手动起点 */ }
    renderOriginLine();
  }

  /* ---------- 输入提示 ---------- */
  function bindTips(inpId, tipsId, onPick, opts = {}) {
    const inp = $(inpId), box = $(tipsId);
    let timer = null, seq = 0;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const kw = inp.value.trim();
      if (kw.length < 2) { box.hidden = true; return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          let url = 'nav/tips?keywords=' + encodeURIComponent(kw);
          if (opts.charger && opts.charger()) url += '&charger=true';
          const d = await api(url);
          if (my !== seq) return;
          box.innerHTML = '';
          d.tips.forEach((t) => {
            const b = document.createElement('button');
            b.innerHTML = `${esc(t.name)}<small>${esc(t.district)} ${esc(t.address)}</small>`;
            b.onclick = () => { box.hidden = true; inp.value = ''; onPick(t); };
            box.appendChild(b);
          });
          box.hidden = !d.tips.length;
        } catch (e) { box.hidden = true; }
      }, 300);
    });
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 200));
  }

  /* ---------- 途经点 chips ---------- */
  function renderWaypoints() {
    const box = $('nav-waypts');
    box.innerHTML = '';
    NS.waypoints.forEach((w, i) => {
      const c = document.createElement('span');
      c.className = 'nav-chip';
      c.innerHTML = `${w.kind === 'service' ? '⛽' : w.kind === 'charger' ? '⚡' : '🛣️'} <b>${esc(w.name)}</b>`;
      const x = document.createElement('button');
      x.textContent = '✕';
      x.onclick = () => { NS.waypoints.splice(i, 1); NS.plan = null; renderWaypoints(); doRoute(); };
      c.appendChild(x);
      box.appendChild(c);
    });
    if (NS.map && NS.map.loaded()) redrawMarkers();
  }

  /* ---------- 路线规划 ---------- */
  async function doRoute() {
    const o = originLoc();
    if (!o || !NS.dest) {
      if (NS.dest && !o) msg('请先选择起点(车辆离线时手动输入)', 'err');
      return;
    }
    msg('规划路线中…');
    try {
      const d = await api('nav/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: o,
          destination: NS.dest.location,
          waypoints: NS.waypoints.map((w) => w.location),
        }),
      });
      NS.paths = d.paths;
      NS.selPath = 0;
      NS.plan = null;
      renderPaths();
      drawPath(NS.paths[0]);
      drawBands([]);
      msg('');
      $('nav-routes-card').hidden = false;
      $('nav-plan-card').hidden = false;
      $('nav-push-card').hidden = false;
      $('nav-svcs').hidden = true;
      $('nav-plan-summary').textContent = '';
      $('nav-stops').innerHTML = '';
    } catch (e) {
      msg(e.message || '路线规划失败', 'err');
    }
  }

  function renderPaths() {
    const box = $('nav-routes');
    box.innerHTML = '';
    NS.paths.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'nav-route-opt' + (i === NS.selPath ? ' on' : '');
      const h = Math.floor((p.duration_min || 0) / 60), m = (p.duration_min || 0) % 60;
      b.innerHTML = `<b>${p.distance_km} km</b>
        <span>${h ? h + ' 小时 ' : ''}${m} 分</span>
        <small>${p.tolls_yuan ? '¥' + p.tolls_yuan : '无收费'}</small>`;
      b.onclick = () => {
        NS.selPath = i; NS.plan = null;
        renderPaths(); drawPath(p); drawBands([]);
        $('nav-stops').innerHTML = ''; $('nav-plan-summary').textContent = '';
      };
      box.appendChild(b);
    });
  }

  /* ---------- 沿途服务区 ---------- */
  async function findServices() {
    const p = NS.paths[NS.selPath];
    if (!p) return;
    const btn = $('nav-svc-btn');
    btn.disabled = true; btn.textContent = '搜索中…';
    try {
      const poly = p.polyline.map((pt) => pt.join(',')).join(';');
      const d = await api('nav/along?kind=service&polyline=' + encodeURIComponent(poly));
      const box = $('nav-svcs');
      box.innerHTML = '';
      if (!d.pois.length) box.innerHTML = '<div class="nav-msg">沿途没有找到服务区</div>';
      d.pois.forEach((poi) => {
        const lab = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = NS.waypoints.some((w) => w.id === poi.id);
        cb.onchange = () => {
          if (cb.checked) {
            NS.waypoints.push({ name: poi.name, location: poi.location, kind: 'service', id: poi.id });
          } else {
            NS.waypoints = NS.waypoints.filter((w) => w.id !== poi.id);
          }
          NS.plan = null;
          renderWaypoints(); doRoute();
        };
        lab.appendChild(cb);
        const t = document.createElement('span');
        t.innerHTML = `${esc(poi.name)}<small>${esc(poi.address)}</small>`;
        lab.appendChild(t);
        box.appendChild(lab);
      });
      box.hidden = false;
    } catch (e) {
      msg(e.message || '服务区搜索失败', 'err');
    } finally {
      btn.disabled = false; btn.textContent = '找沿途服务区';
    }
  }

  /* ---------- 电量规划 ---------- */
  let planTimer = null;
  function schedulePlan() {
    clearTimeout(planTimer);
    planTimer = setTimeout(doPlan, 400);
  }

  async function doPlan(targets = {}) {
    const p = NS.paths[NS.selPath];
    if (!p || NS.carSoc === null) {
      $('nav-plan-summary').textContent = NS.carSoc === null ? '车辆电量未知,无法规划' : '';
      return;
    }
    $('nav-plan-summary').textContent = '规划中…';
    try {
      const poly = p.polyline.map((pt) => pt.join(',')).join(';');
      const d = await api('nav/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          polyline: poly,
          start_soc: NS.carSoc,
          arrival_soc: parseFloat($('nav-arr-soc').value) || 20,
          depart_soc: parseFloat($('nav-dep-soc').value) || 80,
          stop_targets: targets,
        }),
      });
      NS.plan = d;
      drawBands(d.bands);
      redrawMarkers();
      renderPlan();
    } catch (e) {
      $('nav-plan-summary').textContent = e.message || '规划失败';
    }
  }

  function renderPlan() {
    const d = NS.plan;
    const sum = $('nav-plan-summary');
    if (!d.reachable) {
      sum.textContent = `⚠️ 沿途超充不足,按当前电量无法到达(直达预计剩 ${d.arrival_soc_direct}%)`;
      sum.className = 'nav-msg err';
    } else if (!d.stops.length) {
      sum.textContent = `✓ 可直达,预计到达剩 ${d.arrival_soc}%(总能耗约 ${d.kwh_per_km * d.total_km | 0} kWh)`;
      sum.className = 'nav-msg ok';
    } else {
      sum.textContent = `需充 ${d.stops.length} 次,预计到达剩 ${d.arrival_soc}%`;
      sum.className = 'nav-msg';
    }
    const box = $('nav-stops');
    box.innerHTML = '';
    d.stops.forEach((s) => {
      const div = document.createElement('div');
      div.className = 'nav-stop';
      div.innerHTML = `<div class="ns-name">⚡ ${esc(s.name)}</div>
        <div class="ns-soc">距起点 ${s.at_km} km · 到达剩 <b>${s.arrive_soc}%</b> · 充到 <b class="ns-dep">${s.depart_soc}%</b></div>`;
      const range = document.createElement('input');
      range.type = 'range'; range.min = 30; range.max = 100; range.step = 5;
      range.value = s.depart_soc;
      range.oninput = () => { div.querySelector('.ns-dep').textContent = range.value + '%'; };
      range.onchange = () => {
        const targets = {};
        d.stops.forEach((x) => { targets[x.id] = x.depart_soc; });
        targets[s.id] = parseFloat(range.value);
        doPlan(targets);
      };
      div.appendChild(range);
      box.appendChild(div);
    });
    // 区间带图例
    const legend = $('nav-legend');
    legend.innerHTML = '';
    const seen = new Set();
    (d.bands || []).forEach((b) => {
      if (seen.has(b.soc_hi)) return;
      seen.add(b.soc_hi);
      const s = document.createElement('span');
      s.innerHTML = `<i style="background:${bandColor(b.soc_hi)}"></i>${Math.max(0, b.soc_lo)}–${b.soc_hi}%`;
      legend.appendChild(s);
    });
  }

  /* ---------- 推送 ---------- */
  async function pushToCar() {
    if (!NS.dest) return;
    const m = $('nav-push-msg');
    m.className = 'nav-msg'; m.textContent = '推送中…(车若休眠会先唤醒)';
    try {
      const text = `${NS.dest.name}\n${NS.dest.address || NS.dest.location}`;
      const r = await api('control/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'share', args: { value: text } }),
      });
      if (r.ok) { m.textContent = '✓ 已推送到车机导航'; m.className = 'nav-msg ok'; }
      else { m.textContent = '推送失败:' + (r.reason || '未知原因'); m.className = 'nav-msg err'; }
    } catch (e) { m.textContent = e.message; m.className = 'nav-msg err'; }
  }

  function openAmap() {
    const o = originLoc();
    if (!NS.dest || !o) return;
    const [dlng, dlat] = NS.dest.location.split(',');
    // 高德 URI:途经点最多带 3 个,超出的已在面板上可见
    const via = NS.waypoints.slice(0, 3).map((w) => w.location).join(';');
    let url = `https://uri.amap.com/navigation?from=${o},起点` +
      `&to=${dlng},${dlat},${encodeURIComponent(NS.dest.name)}&mode=car&policy=1&coordinate=gaode&callnative=1`;
    if (via) url += `&via=${via}`;
    window.open(url, '_blank', 'noopener');
  }

  /* ---------- 生命周期 ---------- */
  let bound = false;
  async function enter() {
    if (!bound) {
      bound = true;
      bindTips('nav-dest-inp', 'nav-tips', (t) => {
        NS.dest = { name: t.name, location: t.location, address: t.address };
        NS.plan = null;
        if (NS.map && NS.map.loaded()) redrawMarkers();
        doRoute();
      });
      bindTips('nav-origin-inp', 'nav-origin-tips', (t) => {
        NS.originManual = { name: t.name, location: t.location };
        renderOriginLine();
        NS.plan = null;
        if (NS.map && NS.map.loaded()) redrawMarkers();
        doRoute();
      });
      bindTips('nav-via-inp', 'nav-via-tips', (t) => {
        NS.waypoints.push({
          name: t.name, location: t.location,
          kind: $('nav-via-chg').checked ? 'charger' : 'road',
        });
        NS.plan = null;
        renderWaypoints();
        doRoute();
      }, { charger: () => $('nav-via-chg').checked });
      $('nav-svc-btn').onclick = findServices;
      $('nav-arr-soc').onchange = () => schedulePlan();
      $('nav-dep-soc').onchange = () => schedulePlan();
      $('nav-push-car').onclick = pushToCar;
      $('nav-push-amap').onclick = openAmap;
      // 路线选定后自动生成电量规划
      const obs = new MutationObserver(() => {
        if (!$('nav-plan-card').hidden && NS.paths.length && !NS.plan) schedulePlan();
      });
      obs.observe($('nav-plan-card'), { attributes: true, attributeFilter: ['hidden'] });
    }
    try {
      const c = await api('nav/config');
      if (!c.has_key) {
        msg('未配置高德 key:请在个人中心「导航服务」粘贴后使用', 'err');
      }
    } catch (e) { /* 静默 */ }
    if (!NS.inited) {
      NS.inited = true;
      await initMap();
      loadOrigin();
    } else {
      // 主题可能变了
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      if (theme !== NS.mapTheme && NS.map) {
        NS.mapTheme = theme;
        const style = await window.__ttvLoadMapStyle(theme);
        NS.map.setStyle(style);
        NS.map.once('styledata', () => {
          // setStyle 后图层被清空,重建
          if (!NS.map.getSource('nav-route')) {
            NS.map.addSource('nav-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            NS.map.addLayer({ id: 'nav-route-line', type: 'line', source: 'nav-route',
              paint: { 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.9 } });
            NS.map.addSource('nav-bands', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            NS.map.addLayer({ id: 'nav-bands-line', type: 'line', source: 'nav-bands',
              paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': 0.95 } },
              'nav-route-line');
            if (NS.paths[NS.selPath]) drawPath(NS.paths[NS.selPath]);
            if (NS.plan) drawBands(NS.plan.bands);
          }
        });
      }
      NS.map && NS.map.resize();
    }
  }

  window.TTNav = { enter, NS };
})();
