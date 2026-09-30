// 测试页面 · 方案③:总览 3D 全景(候选替代 2D 投影)
// 固定 3/4 俯视机位的新款 Model Y L(与②共用 test-car.js 加载管线),
// 数据直接叠在车模上:地面能量弧环=电量、四轮胎压、左列电量/续航、右列温度、上方里程。
import {
  THREE, resolveCfg, makeLoader, setupStudio, makeMats, prepareModel, applyStretchYL,
} from '/test-car.js';

const stage = document.getElementById('txov-stage');
const loadingEl = document.getElementById('txov-loading');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
stage.prepend(renderer.domElement);   // canvas 垫底,数据 chips 在其上

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(3.3, 2.9, -4.35);   // 右前上方 3/4 俯视
camera.lookAt(0.35, 0.45, 0.1);         // 车偏右,左侧留给电量卡
setupStudio(renderer, scene);

// 地面圆盘 + 柔和投影(与②同款)
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
    new THREE.PlaneGeometry(6.3, 3.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.position.y = 0.01;
  scene.add(shadow);
}

// ---------- 演示数据(与 2D 方案同源) ----------
const DEMO = { soc: 65 };

// ---------- 地面能量弧环(3D 场景内,正确遮挡/透视) ----------
// 椭圆轨道绕车一周:暗色整圈 + 亮弧 = 电量,从车头正前方起顺时针
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
  const RX = 1.5, RZ = 2.78, CZ = 0.1;
  const track = ellipseRibbon(RX, RZ, 0, Math.PI * 2, 0.05, 0.025, 0x808ca0, 0.22);
  const tSoc = (DEMO.soc / 100) * Math.PI * 2;
  const arc = ellipseRibbon(RX, RZ, 0, tSoc, 0.055, 0.03, 0x1baf7a, 0.95);
  const glow = ellipseRibbon(RX, RZ, 0, tSoc, 0.22, 0.022, 0x1baf7a, 0.18, true);
  track.position.z = CZ; arc.position.z = CZ; glow.position.z = CZ;
  scene.add(track, arc, glow);
}

// ---------- 加载用户车型(新款 Model Y L) ----------
const loader = makeLoader();
const cfg = resolveCfg('y-yl');
let wheelAnchors = null;   // { fl/fr/rl/rr: Vector3 世界坐标 }

loader.load(cfg.url, (gltf) => {
  prepareModel(gltf.scene, cfg, makeMats());
  applyStretchYL(gltf.scene);
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

function layout() {
  const W = stage.clientWidth, H = stage.clientHeight;
  place('txov-batt', W * 0.14, H * 0.24);
  place('txov-odo', W * 0.5, H * 0.075);
  place('txov-tin', W * 0.87, H * 0.30);
  place('txov-tout', W * 0.85, H * 0.52);
  if (wheelAnchors) {
    // 近侧三轮锚到车轮旁;远侧后轮(roof 后方,任何投影都落在玻璃上)叠放在 rr 上方
    let rrPos = null;
    for (const k of Object.keys(wheelAnchors)) {
      if (k === 'rl') continue;
      const p = wheelAnchors[k].clone();
      if (p.x < 0) { p.x *= 1.5; p.y = 0; }              // 远侧前轮:往车外地面让
      else { p.x *= 1.15; p.y = 0.1; }                   // 近侧轮:贴近车轮
      const [x, y] = project(p);
      if (k === 'rr') rrPos = [x, y - 28];
      place(`txov-tpms-${k}`, x, y - 28);
    }
    if (rrPos) place('txov-tpms-rl', rrPos[0], rrPos[1] - 46);
  }
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  layout();
}
new ResizeObserver(resize).observe(stage);
resize();

function frame() {
  requestAnimationFrame(frame);
  if (!window.__txovPaused) renderer.render(scene, camera);
}
frame();

// 调试钩子(自动化截图用)
window.__txov = {
  pause() { window.__txovPaused = true; },
  resume() { window.__txovPaused = false; },
  layout,
};
