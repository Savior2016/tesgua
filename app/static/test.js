// 测试页面 · 真实 3D 车模原型(控制页候选方案)
// 车型注册表:不同车型/年款加载不同模型,区域映射统一抽象为「纵向/侧向」坐标。
// 模型:
//  - model-y-juniper.glb  2025 新款 Model Y(BloxBloger @ Sketchfab,CC BY-NC,
//    经 aditano/tesla-studio 轴归一+材质化处理,meshopt 压缩,车头 = -Z)
//  - model-y.glb          2021 款 Model Y(Tina2088/tina-3d-tesla,MIT,车头 = -X)
// Three.js 本地化(/vendor/three.module.min.js,MIT);GLTFLoader/MeshoptDecoder 同源自托管。
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/vendor/libs/meshopt_decoder.module.js';

const stage = document.getElementById('tx3d-stage');
const labelEl = document.getElementById('tx3d-label');
const logEl = document.getElementById('tx3d-log');
const loadingEl = document.getElementById('tx3d-loading');

// ---------- 车型注册表 ----------
// forward: 车头朝向的轴与符号;leftAxis/leftSign: 车辆左侧方向;halfLen: 半车长(米)
const MODELS = {
  'y-yl': {
    label: '新款 Model Y L', base: 'y-juniper', stretch: 4.976 / 4.794,   // 加长近似:仅拉伸车长
    note: '轮廓按 4.976m 车长近似(同款 mesh 纵向拉伸),六座布局不在模型内体现',
  },
  'y-juniper': {
    label: '新款 Model Y', url: '/models/model-y-juniper.glb', sizeMB: 5.2,
    meshopt: true, lenAxis: 'z', frontSign: -1, latAxis: 'x', leftSign: -1,
    paint: 'exterior_paint', glass: 'glass', keepGlass: true,
    wheelRe: /wheel_finish|tire_rubber|brake_/, halfLen: 2.397,
  },
  'y-legacy': {
    label: '2021 款 Model Y', url: '/models/model-y.glb', sizeMB: 8.6,
    meshopt: false, lenAxis: 'x', frontSign: -1, latAxis: 'z', leftSign: -1,
    paint: 'body', glass: 'glass_body', keepGlass: false,
    wheelRe: null, halfLen: 2.375,   // 旧模型轮胎材质无名,用包围盒位置判定
  },
};

// ---------- 渲染基础 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

// 环境反射:手工搭一个极简「摄影棚」,经 PMREM 预滤波后作为车漆/玻璃的环境贴图
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x10131a);
  const geo = new THREE.PlaneGeometry(9, 9);
  const strip = new THREE.PlaneGeometry(4.5, 2.2);
  const panel = (rgb, x, y, z, rx, ry, g) => {
    const m = new THREE.Mesh(g || geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setRGB(...rgb);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    env.add(m);
  };
  panel([2.2, 2.2, 2.2], 0, 6, 0, Math.PI / 2, 0, strip); // 顶部窄光带(黑漆只留一道高光,不整面泛白)
  panel([0.8, 1.0, 1.45], -7, 2, 0, 0, Math.PI / 2);   // 左·冷色
  panel([1.45, 1.15, 0.85], 7, 2, 0, 0, -Math.PI / 2); // 右·暖色
  panel([0.4, 0.48, 0.62], 0, 2, -8, 0, 0);            // 尾部补光
  scene.environment = pmrem.fromScene(env, 0.05).texture;
  pmrem.dispose();
}
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);

// ---------- 车模 ----------
const car = new THREE.Group();
scene.add(car);

// 车漆(可切换)与替换玻璃。源模型材质均为 doubleSided,替换材质保持双面。
const paintMat = new THREE.MeshPhysicalMaterial({
  color: 0x17191d, metalness: 0.45, roughness: 0.38,   // 默认星钻黑(用户车为钻黑)
  clearcoat: 0.85, clearcoatRoughness: 0.18, envMapIntensity: 0.8,   // 收敛环境反射,黑漆保持黑
  side: THREE.DoubleSide,
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0d1117, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.45,
  side: THREE.FrontSide,
});
// 无名材质网格(旧模型的轮胎/轮毂/门把手等,glTF 默认 metal=1 会白到爆)→ 统一深灰
const trimMat = new THREE.MeshStandardMaterial({
  color: 0x33373d, metalness: 0.25, roughness: 0.85, side: THREE.DoubleSide,
});

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let cfg = null;               // 当前车型配置(展开 base 后)
let modelReady = false;
let currentRoot = null;

function resolveCfg(key) {
  const c = { ...MODELS[key] };
  if (c.base) Object.assign(c, { ...MODELS[c.base], ...c });
  c.key = key;
  return c;
}

function loadModel(key) {
  cfg = resolveCfg(key);
  modelReady = false;
  loadingEl.style.display = '';
  loadingEl.textContent = `3D 模型加载中(${cfg.sizeMB}MB)…`;
  // 卸载旧模型
  if (currentRoot) {
    currentRoot.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    car.remove(currentRoot);
    currentRoot = null;
  }
  car.scale.set(1, 1, 1);
  for (const m of Object.values(markers)) m.visible = false;
  for (const k of Object.keys(zoneState)) delete zoneState[k];

  loader.load(cfg.url, (gltf) => {
    const wb = new THREE.Box3();
    const wc = new THREE.Vector3();
    let paintCount = 0;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const name = (o.material && o.material.name) || '';
      if (name === cfg.paint) {
        o.material = paintMat;
        paintCount += 1;
      } else if (name === cfg.glass && !cfg.keepGlass) {
        o.material = glassMat;
      } else if (!name) {
        o.material = trimMat;   // 仅旧模型存在无名材质
      } else if (o.material && !cfg.keepGlass) {
        o.material.envMapIntensity = name === 'chrome' ? 0.7 : 1.0;
      }
      // 新款的 LED 灯带材质:压自发光+去透明,收敛到灯罩质感(原材质 BLEND 高自发光像一团红布)
      if (name === 'taillight_led' && o.material) {
        o.material.transparent = false;
        o.material.opacity = 1;
        o.material.roughness = 0.35;
        o.material.metalness = 0.2;
        o.material.emissiveIntensity = Math.min(o.material.emissiveIntensity ?? 1, 0.5);
      }
      if (name === 'signature_led' && o.material) {
        o.material.emissiveIntensity = Math.min(o.material.emissiveIntensity ?? 1, 1.2);
      }
      o.userData.mat = name;
      // 轮胎区域判定
      if (cfg.wheelRe) {
        if (cfg.wheelRe.test(name)) o.userData.zone = 'wheel';
      } else {
        wb.setFromObject(o);
        wb.getCenter(wc);
        if (wc.y < 0.72 && Math.abs(Math.abs(wc.x) - 1.45) < 0.55 && Math.abs(wc.z) > 0.55) {
          o.userData.zone = 'wheel';
        }
      }
    });
    currentRoot = gltf.scene;
    car.add(gltf.scene);
    if (cfg.stretch) car.scale.z = cfg.stretch;   // Y L 近似:拉伸车长方向
    modelReady = true;
    loadingEl.style.display = 'none';
    logEl.textContent = `${cfg.label}已加载(${paintCount} 个车漆网格可换色)` +
      (cfg.note ? `。${cfg.note}` : '') + '。点击车身部位试试。';
  }, undefined, (err) => {
    loadingEl.textContent = '模型加载失败:' + (err && err.message || err);
  });
}

// 地面:舞台圆盘 + 柔和投影(canvas 径向渐变;长边对车长方向)
let shadowMesh = null;
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
  shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6.1, 3.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadowMesh.position.y = 0.01;
  scene.add(shadowMesh);
}

// ---------- 轨道视角(自定义轻量实现:拖动旋转 / 滚轮缩放) ----------
// 两个模型车头/左侧都朝向 (-轴1,-轴2),同一组相机角度通用:前 3/4 = 左前视角(可见充电口一侧)
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
document.getElementById('tx3d-model').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-model]');
  if (!btn || (cfg && btn.dataset.model === cfg.key)) return;
  for (const b of btn.parentElement.children) b.classList.toggle('on', b === btn);
  loadModel(btn.dataset.model);
});

// ---------- 部位拾取(控制页指令区域映射) ----------
// 统一抽象:along = 纵向坐标(正值朝车头),sideL = 侧向坐标(正值朝车辆左侧)
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
  const p = hit.point;
  // 世界坐标 → 模型局部(car 可能有 Y L 拉伸,用局部坐标判定)
  const local = car.worldToLocal(p.clone());
  const along = local[cfg.lenAxis] * cfg.frontSign;        // 车头为正
  const sideL = local[cfg.latAxis] * cfg.leftSign;         // 左侧为正
  const mat = hit.object.userData.mat || '';
  if (hit.object.userData.zone === 'wheel') return 'wheel';
  // 玻璃舱:前风挡 → 哨兵,后风挡 → 后备箱,车顶 → 空调
  if (mat === cfg.glass) {
    if (along > 0.2) return 'sentry';
    if (along < -1.3) return 'trunk';
    return 'climate';
  }
  // 车身:按落点位置划分
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

// 默认加载用户车型(新款 Model Y L)
loadModel('y-yl');

// 调试钩子(自动化截图用):__tx3d.pause() 暂停渲染,__tx3d.resume() 恢复
window.__tx3d = {
  pause() { window.__tx3dPaused = true; },
  resume() { window.__tx3dPaused = false; },
  // 立即切到目标视角(跳过插值,低速渲染环境下截图用)
  setView(name) {
    if (VIEWS[name]) {
      autoSpin = false;
      Object.assign(orbit, VIEWS[name]);
      Object.assign(orbitGoal, VIEWS[name]);
    }
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
    const mats = {
      normal: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
      basic: new THREE.MeshBasicMaterial({ color: 0xff2222, side: THREE.DoubleSide }),
      std: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 0, roughness: 0.5, side: THREE.DoubleSide }),
    };
    car.traverse((o) => {
      if (o.isMesh && o.userData.mat === cfg.paint) o.material = mats[mode] || paintMat;
    });
  },
};
