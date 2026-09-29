// 测试页面 · 真实 3D 车模原型(控制页候选方案)
// 模型:app/static/models/model-y.glb(来源 Tina2088/tina-3d-tesla,MIT;已剥离内饰/刹车并减面)
// Three.js 本地化(/vendor/three.module.min.js,MIT);GLTFLoader 同源自托管。
// 模型坐标:X = 车长(车头 = -X),Y = 高度,Z = 车宽(车辆左侧 = -Z)。
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/vendor/loaders/GLTFLoader.js';

const stage = document.getElementById('tx3d-stage');
const labelEl = document.getElementById('tx3d-label');
const logEl = document.getElementById('tx3d-log');
const loadingEl = document.getElementById('tx3d-loading');

// ---------- 渲染基础 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

// 环境反射:手工搭一个极简「摄影棚」,经 PMREM 预滤波后作为车漆/玻璃的环境贴图
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x10131a);
  const geo = new THREE.PlaneGeometry(9, 9);
  const panel = (rgb, x, y, z, rx, ry) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setRGB(...rgb);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    env.add(m);
  };
  panel([9, 9, 9], 0, 6, 0, Math.PI / 2, 0);          // 顶部主光带
  panel([1.1, 1.4, 2.0], -7, 2, 0, 0, Math.PI / 2);   // 左·冷色
  panel([2.0, 1.6, 1.2], 7, 2, 0, 0, -Math.PI / 2);   // 右·暖色
  panel([0.5, 0.6, 0.8], 0, 2, -8, 0, 0);             // 尾部补光
  scene.environment = pmrem.fromScene(env, 0.05).texture;
  pmrem.dispose();
}
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);

// ---------- 车模(GLB) ----------
const car = new THREE.Group();
scene.add(car);

// 车漆(可切换)与玻璃,加载后按材质名替换
// 源模型所有材质均为 doubleSided(法线方向不一致),替换材质必须保持双面,否则外壳会「透明见内腔」一片黑
const paintMat = new THREE.MeshPhysicalMaterial({
  color: 0xb9bdc4, metalness: 0.55, roughness: 0.32,
  clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.25,
  side: THREE.DoubleSide,
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0d1117, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.45,
  side: THREE.FrontSide,   // 双面时背面反射顶光,俯视会透出亮斑;低环境强度避免镜面反射顶灯爆白
});
// 无名材质网格(轮胎/轮毂/门把手等,glTF 默认 metal=1 会白到爆)→ 统一深灰
const trimMat = new THREE.MeshStandardMaterial({
  color: 0x33373d, metalness: 0.25, roughness: 0.85, side: THREE.DoubleSide,
});

let modelReady = false;
new GLTFLoader().load('/models/model-y.glb', (gltf) => {
  const bodyMeshes = [];
  const wb = new THREE.Box3();
  const wc = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material && o.material.name) || '';
    if (name === 'body') {
      o.material = paintMat;
      bodyMeshes.push(o);
    } else if (name === 'glass_body') {
      o.material = glassMat;
    } else if (!name) {
      o.material = trimMat;
    } else if (o.material) {
      o.material.envMapIntensity = name === 'chrome' ? 0.7 : 1.0;
    }
    // 轮胎区域(轮毂中心 ±1.45/±0.78、贴地)→ 点击归类为「轮胎」
    wb.setFromObject(o);
    wb.getCenter(wc);
    if (wc.y < 0.72 && Math.abs(Math.abs(wc.x) - 1.45) < 0.55 && Math.abs(wc.z) > 0.55) {
      o.userData.zone = 'wheel';
    }
    o.userData.mat = name;
  });
  car.add(gltf.scene);
  modelReady = true;
  loadingEl.remove();
  const n = gltf.scene.children.length;
  logEl.textContent = `模型已加载(${bodyMeshes.length} 个车漆网格可换色)。点击车身部位试试。`;
}, undefined, (err) => {
  loadingEl.textContent = '模型加载失败:' + (err && err.message || err);
});

// 地面:舞台圆盘 + 柔和投影(canvas 径向渐变;车长沿 X,阴影平面长边对 X)
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
    new THREE.PlaneGeometry(6.1, 3.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.position.y = 0.01;
  scene.add(shadow);
}

// ---------- 轨道视角(自定义轻量实现:拖动旋转 / 滚轮缩放) ----------
// 车头 = -X:前 3/4 视角相机在 x<0、z<0(左前,可见充电口一侧)
const target = new THREE.Vector3(0, 0.7, 0);
const orbit = { theta: -2.52, phi: 1.08, r: 6.5 };
const orbitGoal = { ...orbit };
const VIEWS = {
  front: { theta: -2.52, phi: 1.08, r: 6.5 },
  rear: { theta: 0.62, phi: 1.05, r: 6.8 },
  top: { theta: 0.0, phi: 0.14, r: 7.8 },
};
let autoSpin = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let downAt = null;

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
  downAt = { x: e.clientX, y: e.clientY, theta: orbit.theta, phi: orbit.phi, moved: 0 };
  el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', (e) => {
  if (!downAt) return;
  const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
  downAt.moved = Math.max(downAt.moved, Math.abs(dx) + Math.abs(dy));
  orbitGoal.theta = orbit.theta = downAt.theta - dx * 0.006;
  orbitGoal.phi = orbit.phi = Math.min(1.45, Math.max(0.12, downAt.phi - dy * 0.005));
});
el.addEventListener('pointerup', (e) => {
  const wasClick = downAt && downAt.moved < 6;
  downAt = null;
  if (wasClick) pick(e);
});
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  autoSpin = false;
  orbitGoal.r = orbit.r = Math.min(12, Math.max(4, orbit.r * (1 + e.deltaY * 0.001)));
}, { passive: false });

document.getElementById('tx3d-view').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  autoSpin = false;
  Object.assign(orbitGoal, VIEWS[btn.dataset.view]);
  for (const b of btn.parentElement.children) b.classList.toggle('on', b === btn);
});
document.getElementById('tx3d-paint').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-paint]');
  if (!btn) return;
  paintMat.color.set(btn.dataset.paint);
  for (const b of btn.parentElement.children) b.classList.toggle('on', b === btn);
});

// ---------- 部位拾取(控制页指令区域映射;落点坐标 = 模型世界坐标) ----------
const ZONE_LABEL = {
  frunk: '前备箱', sentry: '哨兵(前风挡)', climate: '空调(玻璃顶)',
  lock: '车锁(车门)', windows: '车窗', chargeport: '充电口',
  trunk: '后备箱', wheel: '轮胎', body: '车身',
};
const zoneState = {};           // zone → 开/关(演示)
const markers = {};             // zone → 高亮圆环
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function classify(hit) {
  const p = hit.point, mat = hit.object.userData.mat || '';
  if (hit.object.userData.zone === 'wheel') return 'wheel';
  // 玻璃舱:前风挡 → 哨兵,后风挡 → 后备箱,车顶 → 空调
  if (mat === 'glass_body') {
    if (p.x < -0.2) return 'sentry';
    if (p.x > 1.3) return 'trunk';
    return 'climate';
  }
  // 车身:按落点位置划分(车头 = -X,车辆左侧 = -Z)
  if (p.x < -1.35) return 'frunk';
  if (p.x > 1.25 && p.z < -0.55) return 'chargeport';   // 左后翼子板(真实充电口位置)
  if (p.x > 1.5) return 'trunk';
  if (Math.abs(p.z) > 0.6) return p.z < 0 ? 'lock' : 'windows';
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
  const hits = raycaster.intersectObjects(car.children, true);
  if (!hits.length) return;
  const zone = classify(hits[0]);
  const name = ZONE_LABEL[zone] || zone;
  const t = new Date().toTimeString().slice(0, 8);
  if (zone === 'wheel' || zone === 'body') {
    logEl.textContent = `${t} 点击 ${name}(未映射指令)`;
    showLabel(name, hits[0].point);
    return;
  }
  zoneState[zone] = !zoneState[zone];
  const on = zoneState[zone];
  // 开 = 在点击处留一个绿色发光环(对应控制页「部位发绿光 = 开」)
  const mk = markerFor(zone);
  mk.visible = on;
  if (on) {
    mk.position.copy(hits[0].point).addScaledVector(hits[0].face.normal, 0.02);
    mk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hits[0].face.normal.clone().normalize());
  }
  logEl.innerHTML = `${t} 点击 <b>${name}</b> → ${on ? '开' : '关'}(演示,正式接入时此处发送对应指令)`;
  showLabel(`${name} · ${on ? '开' : '关'}`, hits[0].point);
}

// ---------- 主循环 ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

function frame() {
  requestAnimationFrame(frame);
  if (autoSpin) orbitGoal.theta += 0.0016;
  // 视角过渡(按钮切换视角时平滑插值)
  orbit.theta += (orbitGoal.theta - orbit.theta) * 0.08;
  orbit.phi += (orbitGoal.phi - orbit.phi) * 0.08;
  orbit.r += (orbitGoal.r - orbit.r) * 0.12;
  applyOrbit();
  // 点击标签跟随
  if (labelEl.classList.contains('show')) {
    const v = labelPos.clone().project(camera);
    labelEl.style.left = `${(v.x * 0.5 + 0.5) * stage.clientWidth}px`;
    labelEl.style.top = `${(-v.y * 0.5 + 0.5) * stage.clientHeight}px`;
  }
  if (!window.__tx3dPaused) renderer.render(scene, camera);
}
frame();

// 调试钩子(自动化截图用):__tx3d.pause() 暂停渲染,__tx3d.resume() 恢复
window.__tx3d = {
  pause() { window.__tx3dPaused = true; },
  resume() { window.__tx3dPaused = false; },
  // 车身材质排障:normal=法线可视化 basic=无光照红 std=普通标准银
  debug(mode) {
    const mats = {
      normal: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
      basic: new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide }),
      std: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 0, roughness: 0.5, side: THREE.DoubleSide }),
    };
    car.traverse((o) => {
      if (o.isMesh && o.userData.mat === 'body') o.material = mats[mode] || paintMat;
    });
  },
};
