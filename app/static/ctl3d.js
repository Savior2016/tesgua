// 测试页面 · 真实 3D 车模原型(控制页候选方案)
// 加载管线/车型注册表/幽灵开合件在 car3d.js(与总览 3D 方案共用)。
// 本文件:轨道视角 + 车身上直接显示的控制热点(前备箱/后备箱/车门二次确认,
// 确认后模型跟着开合;演示阶段不发送真实控制指令) + 部位拾取。
import {
  THREE, MODELS, resolveCfg, makeLoader, setupStudio, makeMats,
  prepareModel, makeGhostParts, applyMovers,
} from '/car3d.js';
import { prepareHighland, highlandMovers } from '/highland3d.js';
import { prepareCybertruck, cybertruckMovers } from '/cybertruck3d.js';

const stage = document.getElementById('tx3d-stage');
const labelEl = document.getElementById('tx3d-label');
const logEl = document.getElementById('tx3d-log');
const loadingEl = document.getElementById('tx3d-loading');
const hotEl = document.getElementById('tx3d-hot');
const confirmEl = document.getElementById('tx3d-confirm');

// ---------- 渲染基础 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
setupStudio(renderer, scene);

// ---------- 车模 ----------
const car = new THREE.Group();
car.scale.setScalar(1.15);   // 放大车模:原比例相对舞台圆盘偏小(热点锚点是 car 子节点,随组同步缩放)
scene.add(car);
const mats = makeMats();
const paintMat = mats.paintMat;
const loader = makeLoader();

let cfg = null;               // 当前车型配置(展开 base 后)
let modelReady = false;
let currentRoot = null;
let ghosts = null;            // 开合件(幽灵面板或真实铰链组,均含 movers)

// ---------- 控制热点 ----------
// pos 为模型局部坐标(车头 = -Z 轴方向);confirm = 需要二次确认的开合类控制
// 正式页注入 window.__ctl3d = { demo:false, onZone(name), ui:{...} } 后,
// 热点/部位点击不再走演示状态,改为回调正式页控制流程(底部滑层 + 真实指令)
const CONF = window.__ctl3d || {};
const DEMO_MODE = CONF.demo !== false;
const HOTSPOTS = [
  { id: 'frunk', label: '前备箱', pos: [0, 1.16, -1.5], confirm: true },
  { id: 'trunk', label: '后备箱', pos: [0, 1.28, 1.72], confirm: true },
  { id: 'doors', label: '车门', pos: [-1.02, 0.92, 0.62], confirm: true, demoOnly: true },
  { id: 'lock', label: '车锁', pos: [-1.02, 1.04, -0.55] },
  { id: 'windows', label: '车窗', pos: [1.02, 1.3, -0.2] },
  { id: 'climate', label: '空调', pos: [0, 1.64, 0.35] },
  { id: 'chargeport', label: '充电口', pos: [-0.98, 0.98, 1.82] },
  { id: 'sentry', label: '哨兵', pos: [0, 1.44, -0.92] },
];
const ZONE_LABEL = {
  frunk: '前备箱', sentry: '哨兵(前风挡)', climate: '空调(玻璃顶)',
  lock: '车锁(车门)', windows: '车窗', chargeport: '充电口',
  trunk: '后备箱', wheel: '轮胎', body: '车身', doors: '车门',
};
const chips = {};        // id → { el, anchor(Object3D) }
const openT = { frunk: 0, trunk: 0, doors: 0 };      // 开合动画当前值 0..1
const openTarget = { frunk: 0, trunk: 0, doors: 0 };
const zoneState = {};    // 开关类状态(lock/climate/...)

function buildHotspots() {
  for (const h of (cfg.hotspots || HOTSPOTS)) {
    if (!DEMO_MODE && (h.demoOnly || h.id === 'doors')) continue;   // 车门开合无真实指令,仅测试页演示
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tx3d-chip';
    el.dataset.id = h.id;
    el.innerHTML = `<i></i><span>${h.label}</span>`;
    el.addEventListener('click', () => onChip(h));
    hotEl.appendChild(el);
    const anchor = new THREE.Object3D();
    anchor.position.set(...h.pos);
    car.add(anchor);
    chips[h.id] = { el, anchor, def: h };
  }
}

function clearHotspots() {
  for (const id of Object.keys(chips)) {
    chips[id].el.remove();
    chips[id].anchor.removeFromParent();
    delete chips[id];
  }
  hideConfirm();
}

function isOpen(id) { return openTarget[id] > 0.5; }

function setChipState(id, on) {
  const c = chips[id];
  if (c) c.el.classList.toggle('on', on);
}

function stamp() { return new Date().toTimeString().slice(0, 8); }

function onChip(h) {
  if (!modelReady) return;
  const id = h.id;
  if (!DEMO_MODE) {   // 正式页:全部交给控制页底部滑层流程(自带确认/滑动/指令)
    if (CONF.onZone) CONF.onZone(id);
    return;
  }
  if (h.confirm) {
    showConfirm(h);
    return;
  }
  // 开关类:直接切换(演示,不发送真实指令)
  zoneState[id] = !zoneState[id];
  setChipState(id, !!zoneState[id]);
  logEl.innerHTML = `${stamp()} <b>${h.label}</b> → ${zoneState[id] ? '开' : '关'}(演示,正式接入时此处发送对应指令)`;
}

// ---------- 二次确认 ----------
let confirmFor = null;
function showConfirm(h) {
  confirmFor = h;
  const open = isOpen(h.id);
  confirmEl.querySelector('.msg').textContent = `确认${open ? '关闭' : '开启'}${h.label}?`;
  confirmEl.querySelector('.yes').textContent = open ? '确认关闭' : '确认开启';
  confirmEl.classList.add('show');
  positionConfirm(h);
}
function hideConfirm() {
  confirmFor = null;
  confirmEl.classList.remove('show');
}
function positionConfirm(h) {
  const c = chips[h.id];
  if (!c) return;
  const r = c.el.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  confirmEl.style.left = `${Math.min(Math.max(r.left - sr.left + r.width / 2, 120), sr.width - 120)}px`;
  confirmEl.style.top = `${r.top - sr.top - 10}px`;
}
confirmEl.querySelector('.no').addEventListener('click', hideConfirm);
confirmEl.querySelector('.yes').addEventListener('click', () => {
  const h = confirmFor;
  hideConfirm();
  if (!h) return;
  const open = !isOpen(h.id);
  openTarget[h.id] = open ? 1 : 0;
  setChipState(h.id, open);
  const canAnim = !!ghosts;
  logEl.innerHTML = `${stamp()} <b>${h.label}</b> → ${open ? '开启' : '关闭'}(演示,不发送控制指令)` +
    (canAnim ? '' : '<br>2021 款模型车门/舱盖与车身一体,无独立面板,无法演示开合动画');
});

let loadSeq = 0;   // 加载代际:慢模型(SwiftShader 下数十秒)未完成时切换车型,旧回调必须丢弃
function loadModel(key) {
  const seq = ++loadSeq;
  cfg = resolveCfg(key);
  // 车型 seg 高亮跟随(含偏好加载的初始车型)
  document.querySelectorAll('#tx3d-model button').forEach((b) =>
    b.classList.toggle('on', b.dataset.model === key));
  modelReady = false;
  loadingEl.style.display = '';
  loadingEl.textContent = `3D 模型加载中(${cfg.sizeMB}MB)…`;
  if (currentRoot) {
    currentRoot.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    car.remove(currentRoot);
    currentRoot = null;
  }
  clearHotspots();
  ghosts = null;
  for (const m of Object.values(markers)) m.visible = false;
  for (const k of Object.keys(zoneState)) delete zoneState[k];
  for (const k of Object.keys(openT)) { openT[k] = 0; openTarget[k] = 0; }

  loader.load(cfg.url, (gltf) => {
    if (seq !== loadSeq) {   // 已被更新的加载取代:释放几何,不入场景
      gltf.scene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      return;
    }
    let paintCount;
    if (cfg.highland) {
      // Model 3 专用管线:归一化烘焙 + 逐面角色分类 + 真实铰链面板(车门/机盖/尾箱盖)
      const built = prepareHighland(gltf.scene, mats);
      paintCount = built.paintCount;
      gltf.scene = built.scene;
      ghosts = { movers: highlandMovers(built.body) };
      currentRoot = built.scene;
    } else if (cfg.cybertruck) {
      // Cybertruck 专用管线:车壳逐面拆分 + 真实铰链面板(车门/机盖/底铰链尾门)
      const built = prepareCybertruck(gltf.scene);
      paintCount = built.paintCount;
      gltf.scene = built.scene;
      ghosts = { movers: cybertruckMovers(built.body) };
      currentRoot = built.scene;
    } else if (cfg.raw) {
      // 趣味模型:保留原配色,不换漆、不做幽灵开合件、无车身热点(hotspots=[])
      paintCount = 0;
      currentRoot = gltf.scene;
    } else {
      paintCount = prepareModel(gltf.scene, cfg, mats).paintCount;
      ghosts = makeGhostParts(cfg, mats);
      if (ghosts) gltf.scene.add(ghosts.group);
      currentRoot = gltf.scene;
    }
    car.add(gltf.scene);
    buildHotspots();
    modelReady = true;
    loadingEl.style.display = 'none';
    logEl.textContent = `${cfg.label}已加载` +
      (paintCount ? `(${paintCount} 个车漆网格可换色)` : '') +
      (cfg.note ? `。${cfg.note}` : '') + '。点击车上控制点或车身部位试试。';
  }, undefined, (err) => {
    if (seq !== loadSeq) return;
    loadingEl.textContent = '模型加载失败:' + (err && (err.stack || err.message) || err);
  });
}

// 地面:舞台圆盘 + 柔和投影(canvas 径向渐变;长边对车长方向)
{
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5a6270, transparent: true, opacity: 0.12 }));
  disc.position.y = 0.001;
  scene.add(disc);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 3.6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.position.y = 0.01;
  scene.add(shadow);
}

// ---------- 轨道视角(拖动旋转 / 滚轮缩放) ----------
const target = new THREE.Vector3(0, 0.7, 0);
const orbit = { theta: -2.52, phi: 1.08, r: 6.5 };
const orbitGoal = { ...orbit };
const VIEWS = {
  front: { theta: -2.52, phi: 1.08, r: 6.5 },
  rear: { theta: 0.62, phi: 1.05, r: 6.8 },
  side: { theta: -Math.PI / 2, phi: 1.25, r: 6.8 },
  top: { theta: 0.0, phi: 0.14, r: 7.8 },
};
let autoSpin = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let downAt = null;
let spinVel = 0;            // 松手后的惯性角速度(rad/帧):甩动后车像转盘一样滑行衰减
let userZoomed = false;   // 滚轮缩放过 → 不再随舞台尺寸自适应
let viewR = 6.5;          // 视角按钮设定的基准半径(自适应只在其上兜底)

// 自适应半径:车+地面圆盘(半径 3.6)完整落入当前舞台画幅(窄舞台自动拉远)
function fitRadius() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w < 10 || h < 10) return viewR;   // 舞台隐藏中(width 0)→ 别算,tan(0) 会得 Infinity
  const aspect = w / h;
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return Math.max(6.5, (3.6 / Math.tan(Math.min(vHalf, hHalf))) * 1.08);
}

function applyOrbit() {
  const { theta, phi, r } = orbit;
  camera.position.set(
    target.x + r * Math.sin(phi) * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}

const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  autoSpin = false;
  spinVel = 0;   // 重新按住即刹停惯性
  downAt = { x: e.clientX, y: e.clientY, theta: orbitGoal.theta, phi: orbitGoal.phi, moved: 0, vel: 0 };
  el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', (e) => {
  if (!downAt) return;
  const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
  downAt.moved = Math.max(downAt.moved, Math.abs(dx) + Math.abs(dy));
  // 只写目标值,由帧循环以高跟随系数插值:事件抖动被抹平,拖动依然跟手
  const theta = downAt.theta - dx * 0.006;
  downAt.vel = downAt.vel * 0.7 + (theta - orbitGoal.theta) * 0.3;   // 平滑的瞬时角速度
  orbitGoal.theta = theta;
  orbitGoal.phi = Math.min(1.45, Math.max(0.12, downAt.phi - dy * 0.005));
});
el.addEventListener('pointerup', (e) => {
  const wasClick = downAt && downAt.moved < 6;
  if (downAt && downAt.moved >= 6) spinVel = Math.max(-0.06, Math.min(0.06, downAt.vel));
  downAt = null;
  if (wasClick) pick(e);
});
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  autoSpin = false;
  userZoomed = true;
  orbitGoal.r = orbit.r = Math.min(12, Math.max(4, orbit.r * (1 + e.deltaY * 0.001)));
}, { passive: false });

// 工具条(视角/换漆/车型):正式页可按 CONF.ui 隐藏部分条;元素缺失时容错
const viewBar = document.getElementById('tx3d-view');
const paintBar = document.getElementById('tx3d-paint');
const modelBar = document.getElementById('tx3d-model');
if (!DEMO_MODE && CONF.ui) {
  if (CONF.ui.paintPicker === false && paintBar) paintBar.style.display = 'none';
  if (CONF.ui.modelPicker === false && modelBar) modelBar.style.display = 'none';
  if (CONF.ui.viewPicker === false && viewBar) viewBar.style.display = 'none';
  if (CONF.ui.log === false && logEl) logEl.style.display = 'none';
}
if (viewBar) viewBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  autoSpin = false;
  spinVel = 0;
  userZoomed = false;   // 选视角后恢复画幅自适应
  Object.assign(orbitGoal, VIEWS[btn.dataset.view]);
  viewR = VIEWS[btn.dataset.view].r;
  orbitGoal.r = Math.max(viewR, fitRadius());
  for (const b of btn.parentElement.children) b.classList.toggle('on', b === btn);
});
if (paintBar) paintBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-paint]');
  if (!btn) return;
  paintMat.color.set(btn.dataset.paint);
  for (const b of btn.parentElement.children) b.classList.toggle('on', b === btn);
});
if (modelBar) modelBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-model]');
  if (!btn || (cfg && btn.dataset.model === cfg.key)) return;
  for (const b of btn.parentElement.children) b.classList.toggle('on', b === btn);
  loadModel(btn.dataset.model);
});

// ---------- 部位拾取(控制页指令区域映射) ----------
// 统一抽象:along = 纵向坐标(正值朝车头),sideL = 侧向坐标(正值朝车辆左侧)
const markers = {};             // zone → 高亮圆环
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function classify(hit) {
  const p = hit.point;
  const local = car.worldToLocal(p.clone());
  const along = local[cfg.lenAxis] * cfg.frontSign;        // 车头为正
  const sideL = local[cfg.latAxis] * cfg.leftSign;         // 左侧为正
  const mat = hit.object.userData.mat || '';
  if (hit.object.userData.zone === 'wheel') return 'wheel';
  if (mat === cfg.glass) {
    if (along > 0.2) return 'sentry';
    if (along < -1.3) return 'trunk';
    return 'climate';
  }
  if (along > 1.35) return 'frunk';
  if (along < -1.25 && sideL > 0.55) return 'chargeport';   // 左后翼子板(真实充电口位置)
  if (along < -1.5) return 'trunk';
  if (Math.abs(sideL) > 0.6) return sideL > 0 ? 'lock' : 'windows';
  return 'body';
}

function markerFor(zone) {
  if (!markers[zone]) {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.02, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0x1baf7a }));
    m.visible = false;
    markers[zone] = m;
    scene.add(m);
  }
  return markers[zone];
}

let labelTimer = 0;
const labelPos = new THREE.Vector3();
function showLabel(text, point) {
  labelEl.textContent = text;
  labelPos.copy(point);
  labelEl.classList.add('show');
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => labelEl.classList.remove('show'), 1600);
}

function pick(e) {
  if (!modelReady) return;
  const rect = el.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = currentRoot ? raycaster.intersectObjects(currentRoot.children, true) : [];
  if (!hits.length) return;
  const zone = classify(hits[0]);
  const name = ZONE_LABEL[zone] || zone;
  if (zone === 'wheel' || zone === 'body') {
    logEl.textContent = `${stamp()} 点击 ${name}(未映射指令)`;
    showLabel(name, hits[0].point);
    return;
  }
  zoneState[zone] = !zoneState[zone];
  const on = zoneState[zone];
  if (!DEMO_MODE) {   // 正式页:部位点击 → 控制页对应模块滑层
    zoneState[zone] = !on;   // 状态由 setStates 驱动,撤销演示翻转
    if (CONF.onZone) CONF.onZone(zone);
    showLabel(name, hits[0].point);
    return;
  }
  const mk = markerFor(zone);
  mk.visible = on;
  if (on) {
    mk.position.copy(hits[0].point).addScaledVector(hits[0].face.normal, 0.02);
    mk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hits[0].face.normal.clone().normalize());
  }
  setChipState(zone, on);
  logEl.innerHTML = `${stamp()} 点击 <b>${name}</b> → ${on ? '开' : '关'}(演示,正式接入时此处发送对应指令)`;
  showLabel(`${name} · ${on ? '开' : '关'}`, hits[0].point);
}

// ---------- 主循环 ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!userZoomed) {   // 未手动缩放时随画幅自适应(窄舞台在视角半径上兜底拉远)
    orbitGoal.r = Math.max(viewR, fitRadius());
  }
}
new ResizeObserver(resize).observe(stage);
resize();

const clock = new THREE.Clock();
const projV = new THREE.Vector3();
const camOff = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (autoSpin) orbitGoal.theta += 0.0016;
  else if (!downAt && Math.abs(spinVel) > 0.0002) {   // 松手惯性滑行,摩擦衰减
    orbitGoal.theta += spinVel;
    spinVel *= 0.94;
  }
  // 拖动中用高跟随系数(直接手感、抹平事件抖动),松开后回到柔和阻尼
  const follow = downAt ? 0.4 : 0.08;
  orbit.theta += (orbitGoal.theta - orbit.theta) * follow;
  orbit.phi += (orbitGoal.phi - orbit.phi) * follow;
  orbit.r += (orbitGoal.r - orbit.r) * 0.12;
  applyOrbit();
  // 开合动画补间
  for (const id of Object.keys(openT)) {
    const d = openTarget[id] - openT[id];
    if (Math.abs(d) > 0.001) {
      openT[id] += Math.sign(d) * Math.min(Math.abs(d), dt / 0.7);
      if (ghosts) applyMovers(ghosts.movers, id, openT[id]);
    }
  }
  // 点击标签跟随
  if (labelEl.classList.contains('show')) {
    const v = labelPos.clone().project(camera);
    labelEl.style.left = `${(v.x * 0.5 + 0.5) * stage.clientWidth}px`;
    labelEl.style.top = `${(-v.y * 0.5 + 0.5) * stage.clientHeight}px`;
  }
  // 热点 chips 跟随锚点;背对相机的调淡
  if (modelReady) {
    camOff.copy(camera.position).sub(target);
    for (const id of Object.keys(chips)) {
      const c = chips[id];
      c.anchor.getWorldPosition(projV);
      const facing = projV.clone().sub(target).normalize().dot(camOff.clone().normalize());
      projV.project(camera);
      const x = (projV.x * 0.5 + 0.5) * stage.clientWidth;
      const y = (-projV.y * 0.5 + 0.5) * stage.clientHeight;
      c.el.style.left = `${x}px`;
      c.el.style.top = `${y}px`;
      c.el.classList.toggle('dim', facing < -0.05);
    }
    if (confirmFor) positionConfirm(confirmFor);
  }
  if (!window.__tx3dPaused) renderer.render(scene, camera);
}
frame();

// 默认加载用户车型(个人中心「控制页 3D 车模」偏好;localStorage 秒开,服务端后台校准)
// 趣味模型(raw,无车身热点)仅供总览:控制页落到默认车模
function preferredModel() {
  const m = localStorage.getItem('ttv-carmodel');
  return (m && MODELS[m] && !MODELS[m].raw) ? m : 'y-yl';
}
loadModel(preferredModel());
fetch('/api/prefs').then((r) => r.json()).then((p) => {
  if (p.car_color_effective) localStorage.setItem('ttv-carcolor', p.car_color_effective);
  if (p.car_model && MODELS[p.car_model]) {
    localStorage.setItem('ttv-carmodel', p.car_model);
    if (p.car_model !== cfg.key) loadModel(p.car_model);
  }
}).catch(() => {});

// 调试钩子(自动化截图用):__tx3d.pause() 暂停渲染,__tx3d.resume() 恢复
window.__THREE = THREE;
window.__tx3d = {
  car,
  pause() { window.__tx3dPaused = true; autoSpin = false; },
  resume() { window.__tx3dPaused = false; },
  // 立即切到目标视角(跳过插值,低速渲染环境下截图用)
  setView(name) {
    if (VIEWS[name]) {
      autoSpin = false;
      spinVel = 0;
      Object.assign(orbit, VIEWS[name]);
      Object.assign(orbitGoal, VIEWS[name]);
    }
  },
  // 开合演示:__tx3d.setOpen('frunk', true)
  setOpen(id, open) {
    openTarget[id] = open ? 1 : 0;
    openT[id] = open ? 1 : 0;
    if (ghosts) applyMovers(ghosts.movers, id, openT[id]);
    setChipState(id, open);
  },
  // 网格排障:__tx3d.list('taillight') → 匹配材质名的网格包围盒
  list(matSub) {
    const out = [];
    const b = new THREE.Box3();
    const c = new THREE.Vector3(), s = new THREE.Vector3();
    car.traverse((o) => {
      if (!o.isMesh || !(o.userData.mat || '').includes(matSub)) return;
      b.setFromObject(o);
      b.getCenter(c); b.getSize(s);
      out.push({ mat: o.userData.mat, center: [c.x, c.y, c.z].map((v) => +v.toFixed(2)), size: [s.x, s.y, s.z].map((v) => +v.toFixed(2)) });
    });
    return out;
  },
  // 车身材质排障:normal=法线可视化 basic=无光照红 std=普通标准银
  debug(mode) {
    const m = {
      normal: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
      basic: new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide }),
      std: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 0, roughness: 0.5, side: THREE.DoubleSide }),
    };
    car.traverse((o) => {
      if (o.isMesh && o.userData.mat === cfg.paint) o.material = m[mode] || paintMat;
    });
  },
  // 按节点名高亮网格(识别可动部件用):__tx3d.highlight('Plane012')
  highlight(nameSub) {
    const hot = new THREE.MeshBasicMaterial({ color: 0xff2bd6, side: THREE.DoubleSide });
    const found = [];
    car.traverse((o) => {
      if (o.isMesh && o.name.includes(nameSub)) { o.material = hot; found.push(o.name); }
    });
    return found;
  },
};

// ---------- 状态注入(正式页:/api/control/status 的 states → 热点亮灭 + 舱盖开合动画) ----------
const STATE_KEY = {
  lock: 'locked', sentry: 'sentry', windows: 'windows_open',
  chargeport: 'charge_port', climate: 'climate_on',
  frunk: 'frunk_open', trunk: 'trunk_open',
};
function setStates(states) {
  const s = states || {};
  for (const [id, key] of Object.entries(STATE_KEY)) {
    let on = s[key] === true;
    if (id === 'chargeport' && s.charging === true) on = true;   // 充电中充电口必然打开
    zoneState[id] = on;
    setChipState(id, on);
    if (id === 'frunk' || id === 'trunk') {
      openTarget[id] = on ? 1 : 0;   // 走补间动画(openT 在当前帧逐步逼近)
    }
  }
}
window.Ctl3D = {
  setStates,
  setOpen: window.__tx3d.setOpen,
  pause: window.__tx3d.pause,
  resume: window.__tx3d.resume,
  setView: window.__tx3d.setView,
};
