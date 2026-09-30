// 测试页面 · 方案③:总览 3D 全景(候选替代 2D 投影)
// 固定 3/4 俯视机位的新款 Model Y L(与②共用 test-car.js 加载管线),
// 数据直接叠在车模上:地面能量弧环=电量、四轮胎压、左列电量/续航、右列温度、上方里程。
import {
  THREE, MODELS, resolveCfg, makeLoader, setupStudio, makeMats, prepareModel,
} from '/test-car.js';
import { prepareCybertruck } from '/test-cybertruck.js';
import { prepareHighland } from '/test-highland.js';

const stage = document.getElementById('txov-stage');
const loadingEl = document.getElementById('txov-loading');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
stage.prepend(renderer.domElement);   // canvas 垫底,数据 chips 在其上

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
setupStudio(renderer, scene);

// ---------- 轨道视角(默认右前上方 3/4 俯视;拖动旋转 / 滚轮或双指缩放) ----------
const target = new THREE.Vector3(0.35, 0.45, 0.1);   // 车偏右,左侧留给电量卡
const orbit = { theta: 2.557, phi: 1.139, r: 6.9 };  // 方向同旧固定机位,半径由 fitRadius 校准
const orbitGoal = { ...orbit };
let userZoomed = false;   // 用户手动缩放后不再随窗口尺寸重置
function applyOrbit() {
  const { theta, phi, r } = orbit;
  camera.position.set(
    target.x + r * Math.sin(phi) * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
}
applyOrbit();

// 自适应半径:保证车身+底盘圆盘(半径 ~3.9m)完整落入当前舞台画幅
// (手机竖屏横向视场窄 → 自动拉远;宽屏保持原构图)
function fitRadius() {
  const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return Math.max(6.9, (3.9 / Math.tan(Math.min(vHalf, hHalf))) * 1.04);
}
{
  const el = renderer.domElement;
  const pointers = new Map();
  let downAt = null;
  let pinch = null;
  el.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), r: orbitGoal.r };
      downAt = null;
    } else {
      downAt = { x: e.clientX, y: e.clientY, theta: orbitGoal.theta, phi: orbitGoal.phi };
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) {
        userZoomed = true;
        orbitGoal.r = Math.min(20, Math.max(3.2, pinch.r * (pinch.dist / d)));
      }
      return;
    }
    if (!downAt) return;
    orbitGoal.theta = downAt.theta - (e.clientX - downAt.x) * 0.006;
    orbitGoal.phi = Math.min(1.45, Math.max(0.15, downAt.phi - (e.clientY - downAt.y) * 0.005));
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) downAt = null;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    userZoomed = true;
    orbitGoal.r = Math.min(20, Math.max(3.2, orbitGoal.r * (1 + e.deltaY * 0.001)));
  }, { passive: false });
}

// 地面圆盘 + 柔和投影(与②同款)
{
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(4.0, 48).rotateX(-Math.PI / 2),
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
    new THREE.PlaneGeometry(6.3, 3.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.position.y = 0.01;
  scene.add(shadow);
}

// ---------- 演示数据(与 2D 方案同源;bd = 本充电周期能耗构成,自车头起顺时针) ----------
const DEMO = {
  soc: 65,
  bd: [
    ['uncharged', 10, 0x5a6270, 0.5],   // 未充(充至 90%)
    ['idle', 4, 0x4a3aa7, 0.95],        // 驻车耗电
    ['sentry', 6, 0xe87ba4, 0.95],      // 哨兵
    ['drive', 15, 0xeda100, 0.95],      // 行驶
    ['remaining', 65, 0x3987e5, 0.95],  // 剩余(= 当前电量)
  ],
};

// ---------- 底盘圆盘上的能量环(3D 场景内,正确遮挡/透视) ----------
// 圆环画在车身底部圆盘靠近边缘处:暗色整圈 + 亮弧 = 电量,从车头正前方起顺时针
function ellipseRibbon(rx, rz, t0, t1, width, y, color, opacity, additive = false) {
  const N = 96;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const s = Math.sin(t), c = Math.cos(t);
    pos.push((rx + width / 2) * s, y, -(rz + width / 2) * c);
    pos.push((rx - width / 2) * s, y, -(rz - width / 2) * c);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  }));
  m.renderOrder = 2;
  return m;
}
{
  // 外圈:当前电量(绿弧);内圈:本充电周期能耗构成(五色分段,与 2D 玻璃顶能量环同口径)
  const R = 3.62;   // 圆盘半径 4.0,外圈贴圆盘边缘内侧
  const track = ellipseRibbon(R, R, 0, Math.PI * 2, 0.07, 0.025, 0x808ca0, 0.25);
  const tSoc = (DEMO.soc / 100) * Math.PI * 2;
  const arc = ellipseRibbon(R, R, 0, tSoc, 0.075, 0.03, 0x1baf7a, 0.95);
  const glow = ellipseRibbon(R, R, 0, tSoc, 0.26, 0.022, 0x1baf7a, 0.16, true);
  scene.add(track, arc, glow);
  const RB = 3.28;  // 内圈:能耗构成
  let acc = 0;
  for (const [, pct, color, opacity] of DEMO.bd) {
    if (pct <= 0.05) continue;
    const t0 = (acc / 100) * Math.PI * 2;
    acc += pct;
    const t1 = (acc / 100) * Math.PI * 2;
    scene.add(ellipseRibbon(RB, RB, t0, t1, 0.1, 0.028, color, opacity));
  }
}

// ---------- 加载用户车型(个人中心「3D 车模」偏好;后台校准 localStorage) ----------
const loader = makeLoader();
const prefKey = localStorage.getItem('ttv-carmodel');
const cfg = resolveCfg(prefKey && MODELS[prefKey] ? prefKey : 'y-yl');
fetch('/api/prefs').then((r) => r.json()).then((p) => {
  if (p.car_model && MODELS[p.car_model]) localStorage.setItem('ttv-carmodel', p.car_model);
}).catch(() => {});
let wheelAnchors = null;   // { fl/fr/rl/rr: Vector3 世界坐标 }

loader.load(cfg.url, (gltf) => {
  if (cfg.cybertruck) {
    gltf.scene = prepareCybertruck(gltf.scene).scene;
  } else if (cfg.highland) {
    gltf.scene = prepareHighland(gltf.scene, makeMats()).scene;
  } else {
    prepareModel(gltf.scene, cfg, makeMats());
  }
  scene.add(gltf.scene);
  // 四轮锚点:按左(-X)/右、前(-Z)/后聚类轮网格包围盒中心
  const cls = { fl: [], fr: [], rl: [], rr: [] };
  const b = new THREE.Box3(); const c = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh || o.userData.zone !== 'wheel') return;
    b.setFromObject(o); b.getCenter(c);
    cls[c.x < 0 ? (c.z < 0 ? 'fl' : 'rl') : (c.z < 0 ? 'fr' : 'rr')].push(c.clone());
  });
  wheelAnchors = {};
  for (const k of Object.keys(cls)) {
    const arr = cls[k];
    wheelAnchors[k] = arr.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / arr.length);
  }
  loadingEl.style.display = 'none';
  layout();
}, undefined, (err) => {
  loadingEl.textContent = '模型加载失败:' + (err && err.message || err);
});

// ---------- 数据覆盖层定位 ----------
const v = new THREE.Vector3();
function project(p) {   // 世界坐标 → stage 像素
  v.copy(p).project(camera);
  return [(v.x * 0.5 + 0.5) * stage.clientWidth, (-v.y * 0.5 + 0.5) * stage.clientHeight];
}
function place(id, x, y) {
  const el = document.getElementById(id);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

// 固定卡片(电量/里程/温度):仅随尺寸布局,不随视角动
function layout() {
  const W = stage.clientWidth, H = stage.clientHeight;
  place('txov-batt', W * 0.14, H * 0.24);
  place('txov-odo', W * 0.5, H * 0.075);
  place('txov-tin', W * 0.87, H * 0.30);
  place('txov-tout', W * 0.85, H * 0.52);
}

// 胎压 chips:锚在四轮旁,每帧随视角重投影;侧视时背侧轮调淡
const tpmsP = new THREE.Vector3();
function layoutTpms() {
  if (!wheelAnchors) return;
  const camX = camera.position.x - target.x;
  const camZ = camera.position.z - target.z;
  const lat = Math.hypot(camX, camZ) || 1;
  for (const k of Object.keys(wheelAnchors)) {
    const a = wheelAnchors[k];
    // 沿水平径向往车外让出一小段,避免投影落在玻璃/车身上
    tpmsP.set(a.x, 0, a.z - 0.1).normalize().multiplyScalar(0.28);
    tpmsP.set(a.x + tpmsP.x, 0.05, a.z + tpmsP.z);
    // 相机明显偏向一侧时,另一侧的轮为背侧(被车身挡住)→ 调淡;
    // 前/后正视时两侧都可见,保持正常亮度
    const dim = a.x * camX < 0 && Math.abs(camX) / lat > 0.45;
    const [x, y] = project(tpmsP);
    const el = document.getElementById(`txov-tpms-${k}`);
    el.style.left = `${x}px`;
    el.style.top = `${y - 26}px`;
    el.classList.toggle('dim', dim);
  }
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!userZoomed) orbit.r = orbitGoal.r = fitRadius();   // 未手动缩放时随画幅自适应
  layout();
}
new ResizeObserver(resize).observe(stage);
resize();

function frame() {
  requestAnimationFrame(frame);
  orbit.theta += (orbitGoal.theta - orbit.theta) * 0.12;
  orbit.phi += (orbitGoal.phi - orbit.phi) * 0.12;
  orbit.r += (orbitGoal.r - orbit.r) * 0.15;
  applyOrbit();
  layoutTpms();
  if (!window.__txovPaused) renderer.render(scene, camera);
}
frame();

// 调试钩子(自动化截图用)
window.__txov = {
  pause() { window.__txovPaused = true; },
  resume() { window.__txovPaused = false; },
  layout,
  // 立即切到指定轨道视角(跳过插值):__txov.setOrbit(theta, phi, r)
  setOrbit(theta, phi, r) {
    if (theta !== undefined) orbit.theta = orbitGoal.theta = theta;
    if (phi !== undefined) orbit.phi = orbitGoal.phi = phi;
    if (r !== undefined) orbit.r = orbitGoal.r = r;
  },
};
