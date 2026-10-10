// 共享 3D 车模加载管线(控制页 3D ctl3d.js 与总览 3D ov3d.js 共用,测试页同用)
// 模型:
//  - model-y-juniper.glb  2025 新款 Model Y(BloxBloger @ Sketchfab,CC BY-NC,
//    经 aditano/tesla-studio 轴归一+材质化处理,meshopt 压缩,车头 = -Z,左侧 = -X)
//  - model-y.glb          2021 款 Model Y(Tina2088/tina-3d-tesla,MIT,车头 = -X)
//  - highland/model.glb   2024 款 Model 3 Highland(RBLXSupercars @ Sketchfab,CC BY 4.0,
//    经 aditano/tesla-studio 压缩+纹理外置;专用管线 highland3d.js:归一化+真实铰链面板)
//  - cybertruck/model.glb 2025 Cybertruck(Nieve5677 @ Sketchfab,CC BY 4.0;
//    专用管线 cybertruck3d.js:车壳逐面拆分+真实铰链面板;暂作 Model Y L 占位)
// Three.js 本地化(/vendor/three.module.min.js,MIT);GLTFLoader/MeshoptDecoder 同源自托管。
import * as THREE from '/vendor/three.module.min.js';
import { GLTFLoader } from '/vendor/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/vendor/libs/meshopt_decoder.module.js';

export { THREE };

// ---------- 车型注册表 ----------
// lenAxis/frontSign: 车头朝向的轴与符号;latAxis/leftSign: 车辆左侧方向;halfLen: 半车长(米)
export const MODELS = {
  'y-yl': {
    label: '新款 Model Y L', base: 'cybertruck',
    note: 'Y L 暂无 3D 模型(2025 中国特供新款,社区尚无作品),暂以 Cybertruck 占位显示',
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
  'cybertruck': {
    label: 'Cybertruck', url: '/models/cybertruck/model.glb', sizeMB: 1.1,
    meshopt: true, lenAxis: 'z', frontSign: -1, latAxis: 'x', leftSign: -1,
    paint: 'exterior_steel', glass: 'glass', keepGlass: true,
    wheelRe: /wheel_finish|tire_rubber/, halfLen: 2.84,
    cybertruck: true,   // 走 cybertruck3d.js 专用管线(车壳逐面拆分 + 真实铰链面板)
    note: '不锈钢车身不支持换漆;车门/前备箱/尾门沿真实缝线裁切,开合为真面板动画',
    // Cybertruck 更高更长(5.68m),热点锚点与 Model Y 不同
    hotspots: [
      { id: 'frunk', label: '前备箱', pos: [0, 1.34, -1.85], confirm: true },
      { id: 'trunk', label: '后备箱', pos: [0, 1.32, 2.45], confirm: true },
      { id: 'doors', label: '车门', pos: [-1.08, 1.0, 0.6], confirm: true },
      { id: 'lock', label: '车锁', pos: [-1.08, 1.15, -0.55] },
      { id: 'windows', label: '车窗', pos: [1.08, 1.45, 0.1] },
      { id: 'climate', label: '空调', pos: [0, 1.82, -0.2] },
      { id: 'chargeport', label: '充电口', pos: [-1.0, 0.75, 2.3] },
      { id: 'sentry', label: '哨兵', pos: [0, 1.56, -1.2] },
    ],
  },
  'model-3': {
    label: 'Model 3(2024 新款)', url: '/models/highland/model.glb', sizeMB: 4.8,
    meshopt: true, lenAxis: 'z', frontSign: -1, latAxis: 'x', leftSign: -1,
    paint: 'exterior_paint', glass: 'glass', keepGlass: true,
    wheelRe: /wheel_finish|tire_rubber/, halfLen: 2.36,
    highland: true,   // 走 highland3d.js 专用管线(归一化烘焙 + 真实铰链面板)
    note: '车门/前备箱/后备箱沿真实缝线裁切,开合为真面板动画',
    // Model 3 更低更矮(车顶 1.41m),热点锚点与 Model Y 不同
    hotspots: [
      { id: 'frunk', label: '前备箱', pos: [0, 1.0, -1.55], confirm: true },
      { id: 'trunk', label: '后备箱', pos: [0, 1.12, 1.95], confirm: true },
      { id: 'doors', label: '车门', pos: [-1.0, 0.85, 0.5], confirm: true },
      { id: 'lock', label: '车锁', pos: [-1.0, 0.95, -0.5] },
      { id: 'windows', label: '车窗', pos: [1.0, 1.15, -0.1] },
      { id: 'climate', label: '空调', pos: [0, 1.44, 0.3] },
      { id: 'chargeport', label: '充电口', pos: [-0.9, 0.78, 1.9] },
      { id: 'sentry', label: '哨兵', pos: [0, 1.28, -0.85] },
    ],
  },
  // ---------- 趣味模型(仅总览 3D;raw=保留原材质不换漆,hotspots=[] 控制页不建热点) ----------
  'sanbengzi': {
    label: '三蹦子', url: '/models/fun/sanbengzi.glb', sizeMB: 3.9,
    meshopt: true, raw: true, hotspots: [], wheelRe: null, halfLen: 1.3,
    note: '三轮摩托(Autorickshaw,iGauravRajput @ Sketchfab,CC-BY 4.0);仅供娱乐,无车身交互',
  },
  'mars-rover': {
    label: '火星车 · 毅力号', url: '/models/fun/mars-rover.glb', sizeMB: 2.2,
    meshopt: true, raw: true, hotspots: [], wheelRe: null, halfLen: 2.1,
    note: 'NASA 官方 3D 模型(Perseverance 工作构型,机械臂展开);仅供娱乐,无车身交互',
  },
  'yaoyao': {
    label: '摇摇车', url: '/models/fun/yaoyao.glb', sizeMB: 0.82,
    meshopt: true, raw: true, hotspots: [], wheelRe: null, halfLen: 1.8,
    rock: true, rockPivotY: 0.360,   // 绕底座顶面铰链缓摇(总览 3D,尊重减少动态)
    note: '写实玩具车(Khronos ToyCar,CC0)+ 程序化弹簧投币底座;仅供娱乐,无车身交互',
  },
  'ironman': {
    // ?v= 破缓存:/models/ 响应带一周强缓存,模型文件内容更新时必须递增
    label: '钢铁侠 · Mark 85', url: '/models/fun/ironman.glb?v=12', sizeMB: 3.6,
    meshopt: true, raw: true, hotspots: [], wheelRe: null, halfLen: 0.9,
    note: '战斗姿态(双掌朝前手指向上掌心炮+脉冲光束;9A Films @ Sketchfab rigged 版烘焙,CC-BY 4.0);仅供娱乐,无车身交互',
  },
  'hellokitty': {
    label: 'Hello Kitty', url: '/models/fun/hellokitty.glb', sizeMB: 0.13,
    meshopt: true, raw: true, hotspots: [], wheelRe: null, halfLen: 0.8,
    note: '雕塑版白模(ZxSimas/hello-kitty-3d)+ 程序化配色五官与红蝴蝶结;仅供娱乐,无车身交互',
  },
  'mickey': {
    label: '米奇', url: '/models/fun/mickey.glb', sizeMB: 0.07,
    meshopt: true, raw: true, hotspots: [], wheelRe: null, halfLen: 0.6,
    note: '汽船威利橡皮管米奇(frankilito/steamboat-willie,1928 公有领域风格);仅供娱乐,无车身交互',
  },
};

export function resolveCfg(key) {
  const c = { ...MODELS[key] };
  if (c.base) Object.assign(c, { ...MODELS[c.base], ...c });
  c.key = key;
  return c;
}

export function makeLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// ---------- 摄影棚环境(黑漆只留一道顶部高光,不整面泛白) ----------
export function setupStudio(renderer, scene, exposure = 1.05) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
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
  panel([2.2, 2.2, 2.2], 0, 6, 0, Math.PI / 2, 0, strip); // 顶部窄光带
  panel([0.8, 1.0, 1.45], -7, 2, 0, 0, Math.PI / 2);   // 左·冷色
  panel([1.45, 1.15, 0.85], 7, 2, 0, 0, -Math.PI / 2); // 右·暖色
  panel([0.4, 0.48, 0.62], 0, 2, -8, 0, 0);            // 尾部补光
  scene.environment = pmrem.fromScene(env, 0.05).texture;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(5, 8, 6);
  scene.add(key);
}

// ---------- 共享材质(车漆可换色;源模型材质均为 doubleSided) ----------
// 车漆颜色:个人中心可改,默认跟随车辆自动识别(/api/prefs 校准进 localStorage 秒开)
function paintColor() {
  const v = localStorage.getItem('ttv-carcolor');
  return (v && /^#[0-9a-fA-F]{6}$/.test(v)) ? parseInt(v.slice(1), 16) : 0x17191d;   // 默认星钻黑
}
export function makeMats() {
  return {
    paintMat: new THREE.MeshPhysicalMaterial({
      color: paintColor(), metalness: 0.45, roughness: 0.38,
      clearcoat: 0.85, clearcoatRoughness: 0.18, envMapIntensity: 0.8,
      side: THREE.DoubleSide,
    }),
    glassMat: new THREE.MeshPhysicalMaterial({
      color: 0x0d1117, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.45,
      side: THREE.FrontSide,
    }),
    // 无名材质网格(旧模型的轮胎/轮毂/门把手等,glTF 默认 metal=1 会白到爆)→ 统一深灰
    trimMat: new THREE.MeshStandardMaterial({
      color: 0x33373d, metalness: 0.25, roughness: 0.85, side: THREE.DoubleSide,
    }),
  };
}

// ---------- 材质重映射 + 轮胎标记 ----------
export function prepareModel(root, cfg, mats) {
  const wb = new THREE.Box3();
  const wc = new THREE.Vector3();
  let paintCount = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = (o.material && o.material.name) || '';
    if (name === cfg.paint) {
      o.material = mats.paintMat;
      paintCount += 1;
    } else if (name === cfg.glass && !cfg.keepGlass) {
      o.material = mats.glassMat;
    } else if (!name) {
      o.material = mats.trimMat;   // 仅旧模型存在无名材质
    } else if (o.material && !cfg.keepGlass) {
      o.material.envMapIntensity = name === 'chrome' ? 0.7 : 1.0;
    }
    // 新款 LED 灯带:压自发光+去透明(原材质 BLEND 高自发光像一团红布)
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
  return { paintCount };
}

// ---------- 幽灵开合件(车门/前备箱盖/尾门) ----------
// 源模型的引擎盖/车门/尾门焊死在主体网格里(节点无独立面板),无法直接旋转;
// 用与车漆同材质的「幽灵面板」贴在对应部位,开阖动画作用在幽灵面板上,
// 开启时同时淡入深色内衬板模拟敞开的舱口。共享 paintMat,换漆自动跟随。
function quad(corners, mat) {
  // corners: [左下, 右下, 右上, 左上] 四个 Vector3,构双面四边形
  const g = new THREE.BufferGeometry().setFromPoints(corners);
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

export function makeGhostParts(cfg, mats) {
  if (!cfg.wheelRe) return null;   // 旧模型尺寸体系不同,不做开合演示
  const group = new THREE.Group();
  group.name = 'ghosts';
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x05070a, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
    transparent: true, opacity: 0, depthWrite: false,
  });
  const lampMat = () => new THREE.MeshBasicMaterial({
    color: 0xffe9c4, transparent: true, opacity: 0, depthWrite: false,
  });
  const doorGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b0f14, metalness: 0.6, roughness: 0.3, envMapIntensity: 0.5, side: THREE.DoubleSide,
  });
  const movers = {};   // id → { pivot, axis, open, closed, cavities: [] }

  // 前备箱盖:铰链在盖后缘(z≈-0.92);盖板关闭时略低于机盖表面(藏进车身),开启旋出
  {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.10, -0.92);
    pivot.visible = false;   // 关闭态隐藏,见 applyMovers
    const lid = quad([
      new THREE.Vector3(-0.55, -0.078, -1.06), new THREE.Vector3(0.55, -0.078, -1.06),
      new THREE.Vector3(0.73, 0, 0), new THREE.Vector3(-0.73, 0, 0),
    ], mats.paintMat);
    pivot.add(lid);
    const cavity = quad([   // 舱口内衬(固定在车身上,开启时淡入)
      new THREE.Vector3(-0.58, 1.06, -1.85), new THREE.Vector3(0.58, 1.06, -1.85),
      new THREE.Vector3(0.68, 1.14, -0.95), new THREE.Vector3(-0.68, 1.14, -0.95),
    ], darkMat);
    // 舱内照明灯条(开启时随内衬淡入,暖白;让「开」状态黑车身上也可辨)
    const lamp = quad([
      new THREE.Vector3(-0.45, 1.13, -1.06), new THREE.Vector3(0.45, 1.13, -1.06),
      new THREE.Vector3(0.45, 1.14, -0.94), new THREE.Vector3(-0.45, 1.14, -0.94),
    ], lampMat());
    group.add(pivot, cavity, lamp);
    movers.frunk = { pivot, axis: 'x', open: 0.72, cavities: [cavity, lamp], hideWhenClosed: true };
  }
  // 尾门(掀背):铰链在顶后缘(z≈0.98,y≈1.50);关闭时略沉进车身,开启沿铰链掀起
  {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.50, 0.98);
    pivot.visible = false;
    const slope = Math.atan2(0.52, 1.27);           // 尾门斜面倾角
    const len = 1.37;
    const frame = quad([
      new THREE.Vector3(-0.66, 0, 0), new THREE.Vector3(0.66, 0, 0),
      new THREE.Vector3(0.60, 0, len), new THREE.Vector3(-0.60, 0, len),
    ], mats.paintMat);
    // 四边形建在水平面(局部 +z 沿车长向后),绕 x 转 slope 即贴上后倾斜面
    // (此前误用 π/2 - slope 转了 68°,关门态竖插进舱内,开启时甩向错误方向)
    frame.rotation.x = slope;
    frame.position.set(0, -0.025, 0.01);
    const glass = quad([
      new THREE.Vector3(-0.52, 0, 0.10), new THREE.Vector3(0.52, 0, 0.10),
      new THREE.Vector3(0.50, 0, 0.86), new THREE.Vector3(-0.50, 0, 0.86),
    ], doorGlassMat);
    glass.rotation.x = frame.rotation.x;
    glass.position.set(0, -0.012, 0.012);
    pivot.add(frame, glass);
    // 舱口内衬:固定车身的水平暗板盖在尾箱开口上
    const cavity = quad([
      new THREE.Vector3(-0.68, 1.02, 1.1), new THREE.Vector3(0.68, 1.02, 1.1),
      new THREE.Vector3(0.68, 1.02, 2.1), new THREE.Vector3(-0.68, 1.02, 2.1),
    ], darkMat);
    // 舱内照明灯条(尾箱开口前缘)
    const lamp = quad([
      new THREE.Vector3(-0.55, 1.03, 1.12), new THREE.Vector3(0.55, 1.03, 1.12),
      new THREE.Vector3(0.55, 1.04, 1.28), new THREE.Vector3(-0.55, 1.04, 1.28),
    ], lampMat());
    group.add(pivot, cavity, lamp);
    movers.trunk = { pivot, axis: 'x', open: -0.65, cavities: [cavity, lamp], hideWhenClosed: true };
  }
  // 四门:铰链在各门前缘;左 = -X。门板 = 车漆下段 + 深色玻璃上段
  // 关闭时收于车身曲面内侧(|x|=0.94 < 半宽 0.97)不可见,开启时旋出
  const doorDefs = [
    { id: 'doorFL', x: -0.94, z: -1.0, len: 1.05, sign: -1 },   // 左前
    { id: 'doorFR', x: 0.94, z: -1.0, len: 1.05, sign: 1 },     // 右前
    { id: 'doorRL', x: -0.94, z: 0.12, len: 1.10, sign: -1 },   // 左后
    { id: 'doorRR', x: 0.94, z: 0.12, len: 1.10, sign: 1 },     // 右后
  ];
  const doorPivots = [];
  for (const d of doorDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, 0.5, d.z);
    pivot.visible = false;
    const lower = quad([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.56, 0),
      new THREE.Vector3(0, 0.58, d.len), new THREE.Vector3(0, 0, d.len),
    ], mats.paintMat);
    // 上段玻璃:顶部向车内收 0.13(车身曲面腰线以上内收,关闭时不外露)
    const inw = -d.sign * 0.13;
    const upper = quad([
      new THREE.Vector3(0, 0.56, 0.06), new THREE.Vector3(inw, 0.82, 0.12),
      new THREE.Vector3(inw, 0.84, d.len - 0.08), new THREE.Vector3(0, 0.58, d.len - 0.02),
    ], doorGlassMat);
    pivot.add(lower, upper);
    group.add(pivot);
    doorPivots.push({ pivot, sign: d.sign });
  }
  movers.doors = { list: doorPivots, axis: 'y', open: 0.5, cavities: [], hideWhenClosed: true };

  return { group, movers, darkMat };
}

// 开合状态应用(t 从 0=关 到 1=开,由调用方补间)
// 幽灵面板(hideWhenClosed)在完全关闭时隐藏(t<=0.01):关闭态呈现源模型原本的完整车身,
// 幽灵件与车身曲面的贴合误差只在开启动画中出现,且被舱口暗板盖住。
// Model 3 的真实铰链面板是车身本体,常显,不做隐藏。
export function applyMovers(movers, id, t) {
  const m = movers[id];
  if (!m) return;
  const kk = t * t * (3 - 2 * t);   // smoothstep
  const vis = t > 0.01;
  if (id === 'doors') {
    for (const d of m.list) {
      d.pivot.rotation.y = d.sign * m.open * kk;
      if (m.hideWhenClosed) d.pivot.visible = vis;
    }
  } else {
    m.pivot.rotation[m.axis] = m.open * kk;
    if (m.hideWhenClosed) m.pivot.visible = vis;
  }
  for (const c of (m.cavities || [])) c.material.opacity = 0.96 * kk;
}
