// 测试页面 · 3D 车模原型(控制页候选方案)
// Three.js 本地化(/vendor/three.module.min.js,MIT),程序化建模,无外部模型文件。
import * as THREE from '/vendor/three.module.min.js';

const stage = document.getElementById('tx3d-stage');
const labelEl = document.getElementById('tx3d-label');
const logEl = document.getElementById('tx3d-log');

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

// ---------- 车模(与 2D 新方案同一副轮廓;svg 坐标 → 米,k 为缩放) ----------
const K = 0.0107;              // svg 单位 → 米(为挤出倒角预留外扩量)
const Z_STRETCH = 1.09;        // 长度方向再拉伸,最终长宽比 ≈ 2.48
const sx = (x) => (x - 170) * K;
const sy = (y) => (y - 232) * K;

// 车身俯视轮廓(同 test.html #tx-body)
function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(sx(170), sy(40));
  s.bezierCurveTo(sx(196), sy(40), sx(218), sy(50), sx(232), sy(68));
  s.bezierCurveTo(sx(243), sy(83), sx(247), sy(101), sx(247.5), sy(122));
  s.bezierCurveTo(sx(248), sy(140), sx(246.5), sy(156), sx(245), sy(172));
  s.bezierCurveTo(sx(246), sy(205), sx(246.5), sy(235), sx(245.5), sy(262));
  s.bezierCurveTo(sx(244.5), sy(292), sx(243.5), sy(318), sx(242), sy(338));
  s.bezierCurveTo(sx(241), sy(362), sx(238), sy(382), sx(231), sy(396));
  s.bezierCurveTo(sx(222), sy(414), sx(198), sy(424), sx(170), sy(424));
  s.bezierCurveTo(sx(142), sy(424), sx(118), sy(414), sx(109), sy(396));
  s.bezierCurveTo(sx(102), sy(382), sx(99), sy(362), sx(98), sy(338));
  s.bezierCurveTo(sx(96.5), sy(318), sx(95.5), sy(292), sx(94.5), sy(262));
  s.bezierCurveTo(sx(93.5), sy(235), sx(94), sy(205), sx(95), sy(172));
  s.bezierCurveTo(sx(93.5), sy(156), sx(92), sy(140), sx(92.5), sy(122));
  s.bezierCurveTo(sx(93), sy(101), sx(97), sy(83), sx(108), sy(68));
  s.bezierCurveTo(sx(122), sy(50), sx(144), sy(40), sx(170), sy(40));
  return s;
}

// 玻璃舱轮廓(前风挡 + 玻璃顶一体,同 #tx-ws + #tx-glass 合并范围)
function cabinShape() {
  const s = new THREE.Shape();
  s.moveTo(sx(170), sy(116));
  s.bezierCurveTo(sx(138), sy(116), sx(116), sy(128), sx(111), sy(154));
  s.bezierCurveTo(sx(109), sy(166), sx(114), sy(172), sx(118), sy(184));
  s.bezierCurveTo(sx(115.5), sy(224), sx(115.5), sy(292), sx(118.5), sy(328));
  s.bezierCurveTo(sx(120.5), sy(350), sx(142), sy(366), sx(170), sy(366));
  s.bezierCurveTo(sx(198), sy(366), sx(219.5), sy(350), sx(221.5), sy(328));
  s.bezierCurveTo(sx(224.5), sy(292), sx(224.5), sy(224), sx(222), sy(184));
  s.bezierCurveTo(sx(226), sy(172), sx(231), sy(166), sx(229), sy(154));
  s.bezierCurveTo(sx(224), sy(128), sx(202), sy(116), sx(170), sy(116));
  return s;
}

// 挤出后放平:shape XY(宽×长)→ 水平(x×z),挤出方向 → 高度 y
function layFlat(geo, yBase) {
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.translate(0, yBase - geo.boundingBox.min.y, 0);
  return geo;
}

const car = new THREE.Group();
scene.add(car);

// 车身(车漆)
const paintMat = new THREE.MeshPhysicalMaterial({
  color: 0xb9bdc4, metalness: 0.55, roughness: 0.32,
  clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.25,
});
const bodyGeo = layFlat(new THREE.ExtrudeGeometry(bodyShape(), {
  depth: 0.46, steps: 1, bevelEnabled: true,
  bevelThickness: 0.18, bevelSize: 0.13, bevelSegments: 5,
}), 0.32);
bodyGeo.scale(1, 1, Z_STRETCH);
const body = new THREE.Mesh(bodyGeo, paintMat);
body.userData.zone = 'body';
car.add(body);

// 玻璃舱(嵌入车身顶部,露出约 0.22,避免「大拖鞋」也不能被淹没)
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0d1117, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.5,
});
const cabinGeo = layFlat(new THREE.ExtrudeGeometry(cabinShape(), {
  depth: 0.3, steps: 1, bevelEnabled: true,
  bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 4,
}), 0.82);
cabinGeo.scale(1, 1, Z_STRETCH);
const cabin = new THREE.Mesh(cabinGeo, glassMat);
cabin.userData.zone = 'cabin';
car.add(cabin);

// 轮胎 + 轮毂盖(内收到轮拱内,俯 3/4 视角看不到对侧整轮)
const tireMat = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.95 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0x6a7078, metalness: 0.8, roughness: 0.4 });
const tireGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 28).rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.235, 20).rotateZ(Math.PI / 2);
for (const [x, z] of [[-0.72, 1.28], [0.72, 1.28], [-0.72, -1.42], [0.72, -1.42]]) {
  const t = new THREE.Mesh(tireGeo, tireMat);
  t.position.set(x, 0.32, z);
  t.userData.zone = 'wheel';
  const h = new THREE.Mesh(hubGeo, hubMat);
  h.position.set(x + Math.sign(x) * 0.005, 0.32, z);
  car.add(t, h);
}

// 前大灯:与 2D 方案相同的楔形轮廓,压平贴在机盖前缘(顶盖平面 y≈1.14)
const headMat = new THREE.MeshStandardMaterial({
  color: 0x15181d, emissive: 0x9fc4ff, emissiveIntensity: 0.5,
});
function headlightShape(sign) {
  const s = new THREE.Shape();
  // tx-hl-l: M111 74 C103 84 98 97 96.5 112 C100 113 104 112.5 107 110 C108.5 96 113 84 121 75 C118 72.5 114.5 72.5 111 74 Z
  const pts = [[111, 74], [103, 84, 98, 97, 96.5, 112], [100, 113, 104, 112.5, 107, 110],
               [108.5, 96, 113, 84, 121, 75], [118, 72.5, 114.5, 72.5, 111, 74]];
  const X = (v) => sign * sx(v);
  s.moveTo(X(pts[0][0]), sy(pts[0][1]));
  for (let i = 1; i < pts.length; i++) {
    const c = pts[i];
    s.bezierCurveTo(X(c[0]), sy(c[1]), X(c[2]), sy(c[3]), X(c[4]), sy(c[5]));
  }
  return s;
}
for (const sign of [1, -1]) {
  const g = layFlat(new THREE.ExtrudeGeometry(headlightShape(sign), {
    depth: 0.025, bevelEnabled: false,
  }), 1.142);
  g.scale(1, 1, Z_STRETCH);
  car.add(new THREE.Mesh(g, headMat));
}
// 贯穿尾灯(压平贴在尾盖后缘)
const tailMat = new THREE.MeshStandardMaterial({
  color: 0x2a0d0d, emissive: 0xff2525, emissiveIntensity: 0.85,
});
const tail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.025, 0.08), tailMat);
tail.position.set(0, 1.155, -1.96);
car.add(tail);

// 充电口(左后翼子板;可点)
const portMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.5, metalness: 0.4 });
const port = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20).rotateZ(Math.PI / 2), portMat);
port.position.set(-0.93, 0.72, -1.17);
port.userData.zone = 'chargeport';
car.add(port);

// 地面:舞台圆盘 + 柔和投影( canvas 径向渐变)
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
    new THREE.PlaneGeometry(3.1, 6.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.position.y = 0.01;
  scene.add(shadow);
}

// ---------- 轨道视角(自定义轻量实现:拖动旋转 / 滚轮缩放) ----------
const target = new THREE.Vector3(0, 0.5, 0);
const orbit = { theta: 0.62, phi: 1.08, r: 6.2 };
const orbitGoal = { ...orbit };
const VIEWS = {
  front: { theta: 0.62, phi: 1.08, r: 6.2 },
  rear: { theta: Math.PI - 0.62, phi: 1.05, r: 6.6 },
  top: { theta: 0.0, phi: 0.14, r: 7.6 },
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

// ---------- 部位拾取(控制页指令区域映射) ----------
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
  const p = hit.point, zone = hit.object.userData.zone;
  if (zone === 'chargeport') return 'chargeport';
  if (zone === 'wheel') return 'wheel';
  if (zone === 'cabin') return p.z > 0.72 ? 'sentry' : 'climate';
  // body:按落点位置划分
  if (p.z > 1.45) return 'frunk';
  if (p.z < -1.62) return 'trunk';
  if (Math.abs(p.x) > 0.55) return p.x < 0 ? 'lock' : 'windows';
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
  const rect = el.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(car.children, false);
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
  if (zone === 'chargeport') portMat.emissive.set(on ? 0x1baf7a : 0x000000);
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
  renderer.render(scene, camera);
}
frame();
