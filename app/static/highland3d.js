// Model 3(2024 Highland)加载/铰链化管线 —— 移植自 aditano/tesla-studio
// (src/studio/vehicles/highland.ts + articulate.ts,仅保留 model-3 部分)。
// 源模型:RBLXSupercars @ Sketchfab,CC BY 4.0,见 models/highland/CREDITS.md。
// 与 Juniper 的差异:该模型车门/机盖/尾门有独立网格且面数充足,
// 可以沿真实缝线切分三角面并挂到铰链组上 —— 开合动画是真面板,不是幽灵贴片。
// 适配改动:
//  - 车漆角色直接用共享 paintMat(换漆与其它车型一致)
//  - 网格 userData.mat = 角色名、轮组 userData.zone='wheel'(控制页拾取用)
//  - 去掉表演性尾翼
import { THREE } from '/car3d.js';
import { mergeVertices } from '/vendor/utils/BufferGeometryUtils.js';

// ---------- 材质角色判定(源导出几乎全黑且未标车漆,按材质名+面心位置归类) ----------
function highlandRole(name, x, y, z) {
  let role = name;
  // 融合车壳导出成近黑且从未标记为车漆;两层壳都算外观件
  if (name === 'Geohoodsub00021Mtl' || name === 'Georimblurlfsub01Mtl') role = 'exterior_paint';
  if (name === 'Georimblurlfsub021Mtl') role = 'wheel_finish';
  // 作者把车灯和座椅共用同一个白色材质:灯组保持白,座舱归皮革
  if (name === 'Ln7Mtl') {
    if (z < -1.75 && y > 0.45 && y < 0.95) role = 'headlight_led';
    else if (z > -0.6) role = 'interior_leather';
  }
  if (name === 'Geodoorl2intsub651Mtl') role = 'interior_leather';
  // 屏幕后的蓝色导出带;Highland 仪表台是织物不是那个蓝
  if (name === 'Geodoorlintsub400251Mtl') role = 'dashboard';
  if (name === 'Geocockpithrsub1031Mtl') role = 'carpet';
  if (name === 'Geocockpithrsub000921Mtl') role = 'display';
  if (/Georimblurlfsub01/.test(name) && Math.abs(x) < 0.63 && z > -0.55 && z < 1.07 && y > 0.32 && y < 1.03)
    role = 'interior_leather';
  if (/window|extwindow|Geodoorl2sub31|Geodoorr2sub31/i.test(name)) {
    // 前灯罩与车门玻璃同材质:只把车头段当灯罩,风挡保持座舱玻璃
    role = z < -1.7 && y > 0.5 && y < 0.82 ? 'lamp_lens' : 'glass';
  }
  if (name === 'Ln12Mtl') role = 'taillight_led';
  if (/Tire1/.test(name)) role = 'tire_rubber';
  return role;
}

function treatHighland(material, name, role) {
  material.side = THREE.DoubleSide;
  if (role === 'wheel_finish') {
    material.metalness = 0.9; material.roughness = 0.28; material.envMapIntensity = 1.05;
  }
  if (role === 'tire_rubber') {
    material.metalness = 0; material.roughness = 0.9; material.envMapIntensity = 0.22;
  }
  if (role === 'interior_leather') {
    material.metalness = 0; material.roughness = 0.55; material.envMapIntensity = 0.6;
  }
  if (role === 'dashboard') {
    material.map = null; material.color.set('#1c1e22');
    material.metalness = 0.04; material.roughness = 0.62; material.envMapIntensity = 0.35;
    material.emissive.set('#000000'); material.emissiveIntensity = 0;
  }
  if (role === 'carpet') {
    material.map = null; material.color.set('#16181c');
    material.metalness = 0; material.roughness = 0.94; material.envMapIntensity = 0.12;
  }
  if (role === 'headliner') {
    material.map = null; material.color.set('#d5d0c8');
    material.metalness = 0; material.roughness = 0.86; material.envMapIntensity = 0.2;
    material.emissive.set('#000000'); material.emissiveIntensity = 0;
  }
  if (role === 'display') {
    material.map = null; material.color.set('#10181c');
    material.emissive.set('#7eb8c4'); material.emissiveIntensity = 0.85;
    material.metalness = 0.02; material.roughness = 0.42; material.envMapIntensity = 0.25;
    material.transparent = false; material.opacity = 1;
  }
  if (role === 'glass' || role === 'lamp_lens' || material.transparent) {
    material.transparent = true;
    material.roughness = role === 'lamp_lens' ? 0.16 : 0.07;
    material.metalness = 0.04;
    material.opacity = role === 'lamp_lens' ? 0.72 : 0.34;
    material.transmission = 0; material.thickness = 0;
    material.clearcoat = 1; material.clearcoatRoughness = role === 'lamp_lens' ? 0.12 : 0.04;
    material.depthWrite = false;
    material.envMapIntensity = role === 'lamp_lens' ? 0.85 : 1.3;
    material.emissive.set('#000000'); material.emissiveIntensity = 0;
    if (role === 'lamp_lens') material.color.set('#1a2228');
  }
  if (name === 'Geohoodsub00031Mtl') {
    material.metalness = 0.92; material.roughness = 0.2; material.envMapIntensity = 1.2;
  }
  if (/Geocockpithrsub000/.test(name)) material.emissiveIntensity = 0.6;
  if (role === 'headlight_led') {
    material.emissive.set('#d5e4f6'); material.emissiveIntensity = 1.15;
    material.metalness = 0.08; material.roughness = 0.34;
    material.transparent = false; material.opacity = 1;
  }
  if (role === 'taillight_led') {
    material.emissive.set('#ed1828'); material.emissiveIntensity = 3.2;
    material.metalness = 0.18; material.roughness = 0.24;
    material.transparent = false; material.opacity = 1;
  }
  if (name === 'Ln1Mtl') {
    material.emissive.set('#d6743a'); material.emissiveIntensity = 0.55;
    material.metalness = 0.25; material.roughness = 0.28;
  }
}

// ---------- 铰链面板缝线规格(在归一化后的网格上量得;铰链位于面板边缘) ----------
const HIGHLAND_WHEELS = [
  { x: -0.81, z: -1.49, r: 0.42, y: 0.7 },
  { x: 0.81, z: -1.49, r: 0.42, y: 0.7 },
  { x: -0.81, z: 1.385, r: 0.42, y: 0.7 },
  { x: 0.81, z: 1.385, r: 0.42, y: 0.7 },
];

const below = (axis, value) => ({
  normal: [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0], offset: value,
});
const above = (axis, value) => ({
  normal: [axis === 0 ? -1 : 0, axis === 1 ? -1 : 0, axis === 2 ? -1 : 0], offset: -value,
});

function doorSpec(name, side, z0, z1, y0, y1, inner, skin) {
  return {
    name, side,
    pivot: [side * skin, (y0 + y1) * 0.5, z0],
    facing: 'out', facingMin: 0.22,
    clip: [
      side < 0 ? below(0, -inner) : above(0, inner),
      above(1, y0), below(1, y1), above(2, z0), below(2, z1),
    ],
  };
}

function panelSpecsModel3() {
  // 0.78 在漆皮内侧、座舱壳外侧之间
  const skin = {
    wheels: HIGHLAND_WHEELS, glass: 'side', facingMin: 0.4,
    split: [below(0, -0.78), above(0, 0.78)],
  };
  return [
    { ...doorSpec('door_fl', -1, -0.98, -0.02, 0.5, 1.33, 0.58, 0.93), ...skin },
    { ...doorSpec('door_fr', 1, -0.98, -0.02, 0.5, 1.33, 0.58, 0.93), ...skin },
    { ...doorSpec('door_rl', -1, 0.05, 0.96, 0.5, 1.32, 0.58, 0.93), ...skin },
    { ...doorSpec('door_rr', 1, 0.05, 0.96, 0.5, 1.32, 0.58, 0.93), ...skin },
    {
      name: 'hood', pivot: [0, 0.93, -1.06], facing: 'up', glass: 'none',
      clip: [above(0, -0.84), below(0, 0.84), above(1, 0.74), above(2, -2.05), below(2, -1.06)],
    },
    {
      // 三厢尾箱盖:铰链在后风挡下缘,玻璃不动
      name: 'tailgate', pivot: [0, 1.05, 1.64], facing: 'cover', glass: 'none',
      clip: [above(0, -0.86), below(0, 0.86), above(1, 0.88), above(2, 1.64)],
    },
  ];
}

// Cybertruck 缝线规格(铰链:门在 A/B 柱、机盖在舱后缘、尾门底铰链下折、卷帘盖滑动)
const CYBERTRUCK_WHEELS = [
  { x: -0.86, z: -1.82, r: 0.44, y: 0.72 },
  { x: 0.86, z: -1.82, r: 0.44, y: 0.72 },
  { x: -0.86, z: 1.82, r: 0.44, y: 0.72 },
  { x: 0.86, z: 1.82, r: 0.44, y: 0.72 },
];

export function panelSpecsCybertruck() {
  return [
    { ...doorSpec('door_fl', -1, -0.95, 0.08, 0.72, 1.48, 0.7, 0.86), glass: 'side', facingMin: 0.35, wheels: CYBERTRUCK_WHEELS },
    { ...doorSpec('door_fr', 1, -0.95, 0.08, 0.72, 1.48, 0.7, 0.86), glass: 'side', facingMin: 0.35, wheels: CYBERTRUCK_WHEELS },
    { ...doorSpec('door_rl', -1, 0.18, 1.28, 0.72, 1.48, 0.7, 0.9), glass: 'side', facingMin: 0.35, wheels: CYBERTRUCK_WHEELS },
    { ...doorSpec('door_rr', 1, 0.18, 1.28, 0.72, 1.48, 0.7, 0.9), glass: 'side', facingMin: 0.35, wheels: CYBERTRUCK_WHEELS },
    {
      // 前备箱盖:剖面实测(顶面 x=0:z -2.8→-1.12 斜面 y 1.32→1.59,风挡始于 z≈-1.1)
      // 铰链在盖后缘(风挡下缘),不是体内低点
      name: 'hood', pivot: [0, 1.58, -1.14], facing: 'up', glass: 'none',
      facingMin: 0.55, wheels: CYBERTRUCK_WHEELS,
      clip: [above(0, -0.86), below(0, 0.86), above(1, 1.05), above(2, -2.62), below(2, -1.14)],
    },
    {
      // 底铰链:尾门向下折。实测尾门≈竖直段(y 0.66..1.0, z≈2.78),
      // 其上(y>1.1)是大幅前倾的货箱后壁,留在车身;铰链在尾门下沿(z≈2.77)
      name: 'tailgate', pivot: [0, 0.66, 2.77], facing: 'back', glass: 'none',
      facingMin: 0.4, wheels: CYBERTRUCK_WHEELS,
      clip: [above(0, -0.95), below(0, 0.95), above(1, 0.6), below(1, 1.14), above(2, 2.5)],
    },
    {
      name: 'tonneau', pivot: [0, 1.52, 0.85], facing: 'up', glass: 'none',
      facingMin: 0.45, wheels: CYBERTRUCK_WHEELS,
      clip: [above(0, -0.88), below(0, 0.88), above(1, 1.42), above(2, 0.7), below(2, 2.3)],
    },
  ];
}

// ---------- 三角面切分/归并(把缝线从封闭车壳里裁出来,挂到铰链组) ----------
function nearWheel(spec, x, y, z) {
  return (spec.wheels || []).some((w) => y < w.y && Math.hypot(x - w.x, z - w.z) < w.r);
}

function claims(spec, c, n, glass) {
  if (!insideClip(spec.clip, c.x, c.y, c.z) || nearWheel(spec, c.x, c.y, c.z)) return false;
  const min = spec.facingMin ?? 0.2;
  const ax = Math.abs(c.x);
  switch (spec.facing) {
    case 'out': {
      const side = spec.side ?? -1;
      if (side * c.x <= 0) return false;
      const skin = Math.abs(spec.pivot[0]);
      if (glass) {
        if (spec.glass !== 'side') return false;
        // 全景顶面朝上;侧窗玻璃(含内面)随车门走
        if (n.y > 0.82 && Math.abs(n.x) < 0.35) return false;
        return ax > skin - 0.42;
      }
      const outward = side * n.x > min && ax > skin - 0.16;
      const skinBack = side * n.x < -0.22 && ax > skin - 0.14 && n.y < 0.5;
      return outward || skinBack;
    }
    case 'up':
      if (glass) return false;
      // 卷帘盖:尾箱上方朝上的面
      if (spec.name === 'tonneau') return n.y > 0.32 && c.z > 0.9;
      return n.y > 0.22;
    case 'back':
      if (glass) return false;
      return n.z > Math.max(min, 0.45) && n.y < 0.45;
    case 'forward':
      return !glass && n.z < -min;
    case 'cover':
      // 三厢尾箱盖,含不垂直朝上的拐角
      if (glass) return false;
      return n.y > 0.22;
    default:
      return false;
  }
}

function insideClip(clip, x, y, z) {
  return clip.every(({ normal: [a, b, c], offset }) => a * x + b * y + c * z <= offset + 1e-5);
}

function lerpAttr(a, b, t) {
  return {
    p: a.p.clone().lerp(b.p, t),
    n: a.n.clone().lerp(b.n, t).normalize(),
    uv: a.uv.clone().lerp(b.uv, t),
  };
}

function splitPoly(poly, plane) {
  const [a0, b0, c0] = plane.normal;
  const d = poly.map((v) => a0 * v.p.x + b0 * v.p.y + c0 * v.p.z - plane.offset);
  if (d.every((v) => v >= -1e-7) || d.every((v) => v <= 1e-7)) return [poly];
  const under = [], over = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const da = d[i], db = d[j];
    if (da <= 0) under.push(poly[i]);
    if (da >= 0) over.push(poly[i]);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const cut = da < 0
        ? lerpAttr(poly[i], poly[j], da / (da - db))
        : lerpAttr(poly[j], poly[i], db / (db - da));
      under.push(cut);
      over.push(cut);
    }
  }
  return [under, over].filter((p) => p.length >= 3);
}

function pushTri(bucket, poly) {
  for (let k = 1; k + 1 < poly.length; k++) {
    for (const v of [poly[0], poly[k], poly[k + 1]]) {
      bucket.positions.push(v.p.x, v.p.y, v.p.z);
      bucket.normals.push(v.n.x, v.n.y, v.n.z);
      bucket.uvs.push(v.uv.x, v.uv.y);
    }
  }
}

function geometryFrom(bucket) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
  const welded = mergeVertices(geometry, 1e-5);
  geometry.dispose();
  welded.computeBoundingSphere();
  return welded;
}

const SKIP_ROLE = /tire_rubber|wheel_finish|brake_|headlight_led|taillight_led|signature_led|lamp_lens/;

export function articulate(body, specs) {
  if (!specs.length) return;
  const planes = [];
  const seen = new Set();
  for (const spec of specs) {
    for (const plane of [...spec.clip, ...(spec.split || [])]) {
      const sign = plane.normal.find((v) => v !== 0) < 0 ? -1 : 1;
      const key = [...plane.normal.map((v) => +(v * sign).toFixed(4)), +(plane.offset * sign).toFixed(4)].join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      planes.push(plane);
    }
  }
  const groups = new Map();
  for (const spec of specs) {
    const group = new THREE.Group();
    group.name = spec.name;
    group.position.set(...spec.pivot);
    groups.set(spec.name, group);
  }
  const meshes = body.children.filter((child) => child.isMesh);
  for (const mesh of meshes) {
    if (mesh.userData.noPanel) continue;
    const material = mesh.material;
    const names = (Array.isArray(material) ? material : [material]).map((m) => m.name).join(' ');
    if (SKIP_ROLE.test(names)) continue;
    const glass = /glass|window/i.test(names);
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    if (!position || !normal) continue;
    const buckets = new Map();
    const rest = { positions: [], normals: [], uvs: [] };
    const read = (i) => ({
      p: new THREE.Vector3().fromBufferAttribute(position, i),
      n: new THREE.Vector3().fromBufferAttribute(normal, i),
      uv: uv ? new THREE.Vector2().fromBufferAttribute(uv, i) : new THREE.Vector2(),
    });
    for (let i = 0; i < position.count; i += 3) {
      let polys = [[read(i), read(i + 1), read(i + 2)]];
      for (const plane of planes) polys = polys.flatMap((poly) => splitPoly(poly, plane));
      for (const poly of polys) {
        const c = new THREE.Vector3();
        const n = new THREE.Vector3();
        for (const v of poly) { c.add(v.p); n.add(v.n); }
        c.multiplyScalar(1 / poly.length);
        n.normalize();
        let target = '';
        for (const spec of specs) {
          const mirrorCap = spec.facing === 'out' && Math.abs(c.x) > 0.98 && insideClip(spec.clip, c.x, c.y, c.z);
          if (!claims(spec, c, n, glass) && !mirrorCap) continue;
          target = spec.name;
          break;
        }
        const bucket = target
          ? buckets.get(target) ?? buckets.set(target, { positions: [], normals: [], uvs: [] }).get(target)
          : rest;
        pushTri(bucket, poly);
      }
    }
    if (source !== mesh.geometry) source.dispose();
    if (!buckets.size) continue;
    mesh.geometry.dispose();
    if (rest.positions.length) mesh.geometry = geometryFrom(rest);
    else {
      mesh.geometry = new THREE.BufferGeometry();
      mesh.removeFromParent();
    }
    for (const [name, bucket] of buckets) {
      const geometry = geometryFrom(bucket);
      const pivot = specs.find((spec) => spec.name === name).pivot;
      geometry.translate(-pivot[0], -pivot[1], -pivot[2]);
      const piece = new THREE.Mesh(geometry, material);
      piece.name = mesh.name;
      piece.userData.mat = mesh.userData.mat;
      piece.castShadow = true; piece.receiveShadow = true;
      groups.get(name).add(piece);
    }
  }
  for (const group of groups.values()) if (group.children.length) body.add(group);
}

// ---------- 舱内衬板(开盖时不至于看穿到路面) ----------
function coverMaterial(materials, name, color, roughness) {
  let material = materials.get(name);
  if (!material) {
    material = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0 });
    material.name = name;
    materials.set(name, material);
  }
  return material;
}

export function addBox(body, materials, name, role, center, size, color, roughness) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size), coverMaterial(materials, name, color, roughness));
  mesh.position.set(...center);
  mesh.name = name;
  mesh.userData.noPanel = true;
  mesh.userData.mat = role;
  mesh.castShadow = mesh.receiveShadow = true;
  body.add(mesh);
  return mesh;
}

// ---------- 主入口:归一化 + 角色重建 + 轮组分离 + 铰链面板 ----------
// 源 GLB 未归一化(米制但原点/轴向任意);把变换烘进几何:
// 车长 4.72m(车主手册),+Y 向上,-Z 朝车头,地面 y=0。
export function prepareHighland(source, mats) {
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 4.72 / (bounds.max.x - bounds.min.x);
  const transform = new THREE.Matrix4()
    .makeRotationY(Math.PI / 2)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  scene.add(body);
  const origins = {
    wheel_fl: [-0.81, 0.345, -1.49],
    wheel_fr: [0.81, 0.345, -1.49],
    wheel_rl: [-0.81, 0.345, 1.385],
    wheel_rr: [0.81, 0.345, 1.385],
  };
  const groups = { body };
  for (const [name, position] of Object.entries(origins)) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(...position);
    groups[name] = group;
    scene.add(group);
  }
  const materials = new Map();
  let paintCount = 0;
  source.traverse((object) => {
    if (!object.isMesh) return;
    const original = object.material;
    const name = original.name;
    const geometry = object.geometry.clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(transform, object.matrixWorld));
    const pos = geometry.getAttribute('position');
    const index = geometry.index;
    const buckets = new Map();
    for (let i = 0; i < (index?.count ?? pos.count); i += 3) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      let x = 0, y = 0, z = 0;
      for (const j of ids) { x += pos.getX(j); y += pos.getY(j); z += pos.getZ(j); }
      x /= 3; y /= 3; z /= 3;
      const normalAttr = geometry.getAttribute('normal');
      let nx = 0, ny = 0, nz = 0;
      if (normalAttr) {
        for (const j of ids) { nx += normalAttr.getX(j); ny += normalAttr.getY(j); nz += normalAttr.getZ(j); }
        nx /= 3; ny /= 3; nz /= 3;
      }
      let part = 'body';
      const wheelMaterial =
        /Tire1|Georimblurlfsub021/.test(name) ||
        (/Georimblurlfsub01/.test(name) && y < 0.65);
      if (wheelMaterial && Math.abs(x) > 0.7 &&
          Math.min(Math.abs(z + 1.49), Math.abs(z - 1.385)) < 0.4) {
        part = 'wheel_' + (z < 0 ? 'f' : 'r') + (x < 0 ? 'l' : 'r');
      }
      let role = highlandRole(name, x, y, z);
      // 轮辐面与车壳同材质:进了轮组就是轮毂不是车身,不吃漆色
      if (part !== 'body' && role === 'exterior_paint') role = 'wheel_finish';
      // 红色车壳的座舱内壁:门/盖/尾箱外皮保持车漆,内侧归座舱
      if (role === 'exterior_paint' &&
          Math.abs(x) < 0.84 && y > 0.24 && y < 1.34 && z > -0.98 && z < 1.45 &&
          !(ny > 0.4 && y > 0.7)) {
        const facesOut = Math.sign(x) * nx > 0.35 && Math.abs(x) > 0.7 && Math.abs(ny) < 0.45;
        if (!facesOut) {
          if (y < 0.55) role = 'carpet';
          else if (y > 1.14) role = 'headliner';
          else if (z < -0.05 && y < 1.08) role = 'dashboard';
          else role = 'interior_leather';
        }
      }
      const key = part + '|' + role;
      const list = buckets.get(key) ?? [];
      list.push(...ids);
      buckets.set(key, list);
    }
    for (const [key, ids] of buckets) {
      const [part, role] = key.split('|');
      let material;
      if (role === 'exterior_paint') {
        material = mats.paintMat;   // 共享车漆,换漆与其它车型一致
        paintCount += 1;
      } else {
        const materialKey = name + '|' + role;
        material = materials.get(materialKey);
        if (!material) {
          material = new THREE.MeshPhysicalMaterial();
          // 注意:不能用 material.copy(original) —— MeshPhysicalMaterial.copy 会读
          // 源材质没有的 clearcoatNormalScale 等物理属性而抛错;只拷标准属性。
          THREE.MeshStandardMaterial.prototype.copy.call(material, original);
          material.name = role;
          treatHighland(material, name, role);
          materials.set(materialKey, material);
        }
      }
      const selected = geometry.clone();
      selected.setIndex(ids);
      const expanded = selected.toNonIndexed();
      const compact = mergeVertices(expanded, 1e-6);
      selected.dispose();
      expanded.dispose();
      const origin = origins[part];
      if (origin) compact.translate(-origin[0], -origin[1], -origin[2]);
      compact.computeBoundingSphere();
      const mesh = new THREE.Mesh(compact, material);
      mesh.name = object.name;
      mesh.userData.mat = role;
      if (part !== 'body') mesh.userData.zone = 'wheel';
      mesh.castShadow = true; mesh.receiveShadow = true;
      groups[part].add(mesh);
    }
    geometry.dispose();
  });
  // 铰链面板:沿缝线裁出车门/机盖/尾箱盖挂到铰链组
  articulate(body, panelSpecsModel3());
  // 舱内衬板:前备箱底 / 后备箱地板 / 座舱地毯(开盖时不看穿)
  addBox(body, materials, 'frunk_tub', 'carpet', [0, 0.58, -1.55], [1.12, 0.14, 0.72], '#14161a', 0.92);
  addBox(body, materials, 'cargo_floor', 'carpet', [0, 0.42, 1.55], [1.15, 0.05, 0.7], '#14161a', 0.94);
  addBox(body, materials, 'highland_floor', 'carpet', [0, 0.38, -0.05], [1.3, 0.1, 2.15], '#16181c', 0.95);
  return { scene, body, paintCount };
}

// 铰链组 → 控制页 movers(复用 applyMovers 补间;真面板常显,不设 hideWhenClosed)
export function highlandMovers(body) {
  const g = (name) => body.getObjectByName(name);
  const movers = {};
  if (g('hood')) movers.frunk = { pivot: g('hood'), axis: 'x', open: 0.55, cavities: [] };
  if (g('tailgate')) movers.trunk = { pivot: g('tailgate'), axis: 'x', open: -0.5, cavities: [] };
  const doorList = [
    { pivot: g('door_fl'), sign: -1 },
    { pivot: g('door_fr'), sign: 1 },
    { pivot: g('door_rl'), sign: -1 },
    { pivot: g('door_rr'), sign: 1 },
  ].filter((d) => d.pivot);
  if (doorList.length) movers.doors = { list: doorList, axis: 'y', open: 0.55, cavities: [] };
  return movers;
}
