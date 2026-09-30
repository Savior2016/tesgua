// Cybertruck 加载/铰链化管线 —— 移植自 aditano/tesla-studio
// (src/studio/vehicles/imported.ts 的 cybertruck 分支)。
// 源模型:Nieve5677 @ Sketchfab,CC BY 4.0,见 models/cybertruck/CREDITS.md。
// 该导出是单一不锈钢壳(玻璃/车门/车轮均未分离),这里按面分类拆出
// 玻璃/轮眉/轮胎/轮毂/灯条/座舱,再用共享 articulate 沿缝线裁出真铰链面板。
// 适配改动:钢壳保持拉丝不锈钢质感(不随换漆);轮胎/轮毂网格标记
// userData.zone='wheel'(总览胎压锚点用);去掉表演性尾翼。
import { THREE } from '/test-car.js';
import { articulate, panelSpecsCybertruck, addBox } from '/test-highland.js';

// ---------- 拉丝不锈钢纹理(横向细纹,避免平板银色的塑料感) ----------
let brushed = null;
function brushedSteel() {
  if (brushed) return brushed;
  const w = 64, h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const band = 214 + (y % 3) * 6;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grain = ((x * 17 + y * 3) % 11) - 5;
      const c = Math.max(0, Math.min(255, band + grain));
      data[i] = c; data[i + 1] = c; data[i + 2] = Math.min(255, c + 6); data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, w, h);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(28, 10);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  brushed = texture;
  return texture;
}

// ---------- 材质处理 ----------
function treatImported(material, role) {
  material.side = THREE.DoubleSide;
  if (role === 'exterior_steel') {
    material.map = brushedSteel();
    material.color.set('#d4d8de');
    material.metalness = 0.96; material.roughness = 0.34;
    material.envMapIntensity = 1.15;
    material.clearcoat = 0.22; material.clearcoatRoughness = 0.32;
  }
  // GLB 声明了 KHR_materials_anisotropy 但网格没切线,逐像素推导在平面上
  // 会出现彩虹条纹甚至 NaN 像素 → 关掉
  if (!material.userData.hasTangents) {
    material.anisotropy = 0;
    material.anisotropyMap = null;
  }
  if (role === 'glass' || role === 'lamp_lens') {
    material.transparent = true;
    material.transmission = 0; material.thickness = 0;
    material.depthWrite = role === 'glass';
    material.roughness = 0.06; material.metalness = 0.04;
    material.clearcoat = 1; material.clearcoatRoughness = 0.05;
    material.envMapIntensity = 1.35;
    material.side = THREE.FrontSide;
    material.emissive.set('#000000'); material.emissiveIntensity = 0;
    if (role === 'glass') {
      material.opacity = 0.32;
      if (material.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.55) material.color.set('#6a8898');
    } else {
      material.opacity = 0.42;
      material.color.set('#5c7384');
    }
  }
  if (role === 'tire_rubber') {
    material.metalness = 0; material.roughness = 0.92; material.envMapIntensity = 0.2;
  }
  if (role === 'wheel_finish') {
    material.metalness = 0.9; material.roughness = 0.28; material.envMapIntensity = 1.05;
  }
  if (role === 'headlight_led' || role === 'signature_led') {
    material.transparent = false; material.opacity = 1;
    material.metalness = 0.12; material.roughness = 0.2;
    material.emissive.set('#edf5ff'); material.emissiveIntensity = 4.8;
    material.color.set('#e8f1ff');
  }
  if (role === 'taillight_led') {
    material.transparent = false; material.opacity = 1;
    material.metalness = 0.16; material.roughness = 0.24;
    material.emissive.set('#ed1828'); material.emissiveIntensity = 3.2;
  }
}

// ---------- 车壳逐面拆分(轮胎/玻璃/轮眉/灯条/座舱内壁) ----------
function shellMaterial(base, role, materials) {
  const key = 'cybertruck-shell|' + role;
  let material = materials.get(key);
  if (material) return material;
  material = base.clone();
  material.name = role;
  material.userData.hasTangents = false;
  material.map = role === 'exterior_steel' ? material.map : null;
  treatImported(material, role);
  if (role === 'satin_trim') {
    material.map = null; material.color.set('#0c0e12');
    material.metalness = 0.08; material.roughness = 0.72; material.envMapIntensity = 0.28;
  }
  if (role === 'tire_rubber') material.color.set('#17191c');
  if (role === 'wheel_finish') {
    material.color.set('#2c3238'); material.metalness = 0.82; material.roughness = 0.32;
  }
  if (role === 'glass') {
    material.color.set('#1a3040'); material.opacity = 0.42;
    material.roughness = 0.05; material.metalness = 0.08;
  }
  if (role === 'signature_led' || role === 'headlight_led') material.color.set('#e7eef8');
  if (role === 'dashboard') {
    material.map = null; material.color.set('#1c1e22');
    material.metalness = 0.04; material.roughness = 0.74;
    material.envMapIntensity = 0.18; material.clearcoat = 0;
  }
  if (role === 'carpet') {
    material.map = null; material.color.set('#121418');
    material.metalness = 0; material.roughness = 0.95;
    material.envMapIntensity = 0.06; material.clearcoat = 0;
  }
  materials.set(key, material);
  return material;
}

function segmentCybertruckShell(parent, geometry, name, base, materials) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  if (!position || !normal) {
    const mesh = new THREE.Mesh(geometry, base);
    mesh.name = name;
    mesh.userData.mat = 'exterior_steel';
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return;
  }
  // 轮心:四个象限内最低且最靠外的顶点
  const hubs = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      let bestX = sx * 0.86, bestZ = sz * 1.82, best = -1, minY = Infinity;
      for (let i = 0; i < position.count; i++) {
        const px = position.getX(i), pz = position.getZ(i);
        if (Math.sign(px) !== sx || Math.sign(pz) !== sz) continue;
        minY = Math.min(minY, position.getY(i));
      }
      for (let i = 0; i < position.count; i++) {
        const py = position.getY(i), px = position.getX(i), pz = position.getZ(i);
        if (py > minY + 0.06) continue;
        if (Math.sign(px) !== sx || Math.sign(pz) !== sz) continue;
        const score = Math.abs(px) + Math.abs(pz);
        if (score > best) { best = score; bestX = px; bestZ = pz; }
      }
      hubs.push({ x: bestX, z: bestZ });
    }
  }
  const buckets = new Map();
  const take = (role) => {
    let bucket = buckets.get(role);
    if (!bucket) { bucket = { positions: [], normals: [], uvs: [] }; buckets.set(role, bucket); }
    return bucket;
  };
  const classify = (x, y, z, nx, ny, nz) => {
    for (const hub of hubs) {
      const axial = Math.abs(x - hub.x);
      const radial = Math.hypot(y - 0.445, z - hub.z);
      if (axial < 0.28 && radial > 0.3 && radial < 0.56 && y < 0.62) {
        if (radial > 0.39) return 'tire_rubber';
        return 'wheel_finish';
      }
      if (axial < 0.5 && radial > 0.46 && radial < 0.86 && y < 0.78 && y > 0.08)
        return 'satin_trim';
    }
    if (y < 0.42 && y > 0.05 && Math.abs(x) > 0.62 && Math.abs(nx) > 0.28) return 'satin_trim';
    if (ny > 0.2 && nz < -0.45 && y > 1.2 && y < 1.72 && z < -0.35 && z > -1.65 && Math.abs(x) < 0.88)
      return 'glass';
    if (Math.abs(nx) > 0.45 && Math.abs(ny) < 0.55 && y > 1.28 && y < 1.58 && z > -0.9 && z < 1.15 && Math.abs(x) > 0.72)
      return 'glass';
    if (nz > 0.6 && y > 1.28 && y < 1.62 && z > 0.55 && z < 1.15 && Math.abs(x) < 0.72) return 'glass';
    if (y > 1.12 && y < 1.2 && z < -2.55 && Math.abs(x) < 0.78 && nz < -0.35) return 'signature_led';
    if (y > 1.15 && y < 1.28 && z > 2.55 && Math.abs(x) < 0.85 && nz > 0.45) return 'taillight_led';
    if (y < 0.36 && y > 0.08 && Math.abs(x) > 0.55 && Math.abs(nx) > 0.4) return 'satin_trim';
    // 朝向座舱内的面:壳体没有独立内饰,不归类的话座舱里会看到拉丝钢
    if (Math.abs(x) < 0.84 && y > 0.42 && y < 1.58 && z > -1.3 && z < 1.0) {
      if (nz > 0.4 && y > 0.7 && y < 1.38 && z < -0.05) return 'dashboard';
      if (ny > 0.5 && y < 0.92 && z > -0.95) return 'carpet';
      if (ny < -0.5 && y > 1.32) return 'dashboard';
      if (Math.abs(x) > 0.42 && Math.abs(nx) > 0.45 && x * nx < 0 && y > 0.55 && y < 1.48)
        return 'dashboard';
    }
    return 'exterior_steel';
  };
  for (let i = 0; i < position.count; i += 3) {
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) {
      x += position.getX(i + k); y += position.getY(i + k); z += position.getZ(i + k);
      nx += normal.getX(i + k); ny += normal.getY(i + k); nz += normal.getZ(i + k);
    }
    const role = classify(x / 3, y / 3, z / 3, nx / 3, ny / 3, nz / 3);
    const bucket = take(role);
    for (let k = 0; k < 3; k++) {
      const vtx = i + k;
      bucket.positions.push(position.getX(vtx), position.getY(vtx), position.getZ(vtx));
      bucket.normals.push(normal.getX(vtx), normal.getY(vtx), normal.getZ(vtx));
      bucket.uvs.push(uv ? uv.getX(vtx) : 0, uv ? uv.getY(vtx) : 0);
    }
  }
  if (source !== geometry) source.dispose();
  geometry.dispose();
  for (const [role, bucket] of buckets) {
    if (!bucket.positions.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
    const index = new Uint32Array(bucket.positions.length / 3);
    for (let i = 0; i < index.length; i++) index[i] = i;
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, shellMaterial(base, role, materials));
    mesh.name = name;
    mesh.userData.mat = role;
    if (role === 'tire_rubber' || role === 'wheel_finish') mesh.userData.zone = 'wheel';
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

// ---------- 座舱衬件(壳体无内饰,补地板/座椅/仪表台/屏幕/轭式方向盘) ----------
function addCybertruckCabin(body, materials) {
  const make = (name, color, roughness, metalness = 0) => {
    const key = 'cybertruck-cabin|' + name;
    let material = materials.get(key);
    if (material) return material;
    material = new THREE.MeshPhysicalMaterial({ color, roughness, metalness });
    material.name = name;
    materials.set(key, material);
    return material;
  };
  const leather = make('interior_leather', '#1a1c1f', 0.72);
  const dashMat = make('dashboard', '#1c1e22', 0.72, 0.04);
  const carpet = make('carpet', '#121418', 0.95);
  const screen = make('display', '#10181c', 0.35, 0.02);
  screen.emissive.set('#7eb8c4'); screen.emissiveIntensity = 0.9;
  const trim = make('satin_trim', '#14171c', 0.55, 0.12);
  const add = (mesh, name) => {
    mesh.name = name;
    mesh.userData.noPanel = true;
    mesh.userData.mat = mesh.material.name;
    mesh.castShadow = mesh.receiveShadow = true;
    body.add(mesh);
  };
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.03, 1.7), carpet);
  floor.position.set(0, 0.52, -0.05);
  add(floor, 'cybertruck_cabin_floor');
  const liner = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.03, 1.35), dashMat);
  liner.position.set(0, 1.56, -0.05);
  add(liner, 'cybertruck_cabin_headliner');
  for (const x of [-0.32, 0.32]) {
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.36), leather);
    cushion.position.set(x, 0.74, -0.22);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.07), leather);
    back.position.set(x, 1.0, -0.28);
    back.rotation.x = 0.08;
    add(cushion, x < 0 ? 'cybertruck_cabin_cushion_l' : 'cybertruck_cabin_cushion_r');
    add(back, x < 0 ? 'cybertruck_cabin_back_l' : 'cybertruck_cabin_back_r');
  }
  const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.42), dashMat);
  consoleBox.position.set(0, 0.7, -0.12);
  add(consoleBox, 'cybertruck_cabin_console');
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.46, 0.05), dashMat);
  dash.position.set(0, 0.98, -0.42);
  add(dash, 'cybertruck_cabin_dash');
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.012), screen);
  display.position.set(0.12, 1.04, -0.388);
  display.rotation.x = -0.12;
  add(display, 'cybertruck_cabin_screen');
  const yoke = new THREE.Group();
  yoke.name = 'cybertruck_cabin_yoke';
  yoke.position.set(-0.2, 0.97, -0.32);
  yoke.rotation.x = 0.18;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.024), trim);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.024), trim);
  bottom.position.y = -0.12;
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.13, 0.024), trim);
  left.position.set(-0.11, -0.06, 0);
  const right = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.13, 0.024), trim);
  right.position.set(0.11, -0.06, 0);
  yoke.add(top, bottom, left, right);
  yoke.userData.noPanel = true;
  yoke.traverse((child) => { if (child.isMesh) child.castShadow = child.receiveShadow = true; });
  body.add(yoke);
}

// 尾部贯穿灯条(挂在尾门铰链组上,随尾门一起动)
function addCybertruckTailBar(body, materials) {
  let material = materials.get('cybertruck_tail_bar');
  if (!material) {
    material = new THREE.MeshPhysicalMaterial({
      color: '#8c0714', emissive: '#ed1828', emissiveIntensity: 3.4,
      metalness: 0.12, roughness: 0.28, anisotropy: 0,
    });
    material.name = 'taillight_led';
    materials.set('cybertruck_tail_bar', material);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.035, 0.018), material);
  bar.position.set(0, 1.02, 2.81);   // 贴在尾门竖直段顶沿(实测该处表面 z≈2.80)
  bar.name = 'cybertruck_tail_bar';
  bar.userData.noPanel = true;
  bar.userData.mat = 'taillight_led';
  body.add(bar);
  const gate = body.getObjectByName('tailgate');
  if (gate) gate.attach(bar);
}

// ---------- 导出缺陷修正(源网格头顶飘着 3 个游离三角块;车身偏心且偏窄) ----------
const CYBERTRUCK_BODY_WIDTH = 2.0316;   // 车主手册车宽(后视镜折叠)

function importFit(source) {
  const skip = new Set();
  const matrix = new THREE.Matrix4();
  const all = new THREE.Box3().setFromObject(source);
  const height = all.max.y - all.min.y;
  const body = new THREE.Box3();
  source.traverse((object) => {
    if (!object.isMesh) return;
    const box = new THREE.Box3().setFromObject(object);
    const triangles =
      (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
    if (triangles < 500 && box.min.y > all.min.y + height * 0.6) skip.add(object);
    else body.union(box);
  });
  if (body.isEmpty()) return { skip, matrix };
  const width = body.max.x - body.min.x;
  const mid = (body.max.x + body.min.x) / 2;
  const scale = width > 0 && width < CYBERTRUCK_BODY_WIDTH ? CYBERTRUCK_BODY_WIDTH / width : 1;
  matrix.makeScale(scale, 1, 1).multiply(new THREE.Matrix4().makeTranslation(-mid, 0, 0));
  return { skip, matrix };
}

// ---------- 主入口 ----------
// 源 GLB 已是米制、+Y 向上、-Z 朝车头;只需修正导出缺陷 + 车壳拆分 + 铰链化。
export function prepareCybertruck(source) {
  source.updateMatrixWorld(true);
  const fit = importFit(source);
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  scene.add(body);
  const materials = new Map();
  source.traverse((object) => {
    if (!object.isMesh || fit.skip.has(object)) return;
    const original = Array.isArray(object.material) ? object.material[0] : object.material;
    let material = materials.get('exterior_steel');
    if (!material) {
      material = new THREE.MeshPhysicalMaterial();
      if (original.isMeshPhysicalMaterial) material.copy(original);
      else THREE.MeshStandardMaterial.prototype.copy.call(material, original);
      material.name = 'exterior_steel';
      material.userData.hasTangents = !!object.geometry.getAttribute('tangent');
      treatImported(material, 'exterior_steel');
      materials.set('exterior_steel', material);
    }
    // 拍平层级,保留源节点的平移/旋转/缩放,并应用缺陷修正矩阵
    const geometry = object.geometry.clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit.matrix, object.matrixWorld));
    if (!Array.isArray(object.material)) {
      segmentCybertruckShell(body, geometry, object.name, material, materials);
      return;   // traverse 回调,非循环
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = object.name;
    mesh.userData.mat = 'exterior_steel';
    mesh.castShadow = mesh.receiveShadow = true;
    body.add(mesh);
  });
  addCybertruckCabin(body, materials);
  articulate(body, panelSpecsCybertruck());
  // 前备箱底衬(开机盖时不看穿) + 货箱底(开尾门时不看穿)
  addBox(body, materials, 'frunk_tub', 'carpet', [0, 0.78, -1.85], [1.25, 0.16, 0.85], '#14161a', 0.92);
  addBox(body, materials, 'bed_floor', 'carpet', [0, 0.7, 1.55], [1.5, 0.06, 1.5], '#14161a', 0.94);
  addCybertruckTailBar(body, materials);
  return { scene, body, paintCount: 0 };
}

// 铰链组 → 控制页 movers(尾门为底铰链下折;卷帘盖滑动,暂不做动画)
export function cybertruckMovers(body) {
  const g = (name) => body.getObjectByName(name);
  const movers = {};
  if (g('hood')) movers.frunk = { pivot: g('hood'), axis: 'x', open: 0.75, cavities: [] };
  if (g('tailgate')) movers.trunk = { pivot: g('tailgate'), axis: 'x', open: 1.25, cavities: [] };
  const doorList = [
    { pivot: g('door_fl'), sign: -1 },
    { pivot: g('door_fr'), sign: 1 },
    { pivot: g('door_rl'), sign: -1 },
    { pivot: g('door_rr'), sign: 1 },
  ].filter((d) => d.pivot);
  if (doorList.length) movers.doors = { list: doorList, axis: 'y', open: 0.5, cavities: [] };
  return movers;
}
