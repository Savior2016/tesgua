// 测试页面 · 方案③:总览 3D 全景(候选替代 2D 投影)
// 固定 3/4 俯视机位的新款 Model Y L(与控制页共用 car3d.js 加载管线),
// 数据直接叠在车模上:地面能量弧环=电量、四轮胎压、左列电量/续航、右列温度、上方里程。
import {
  THREE, MODELS, resolveCfg, makeLoader, setupStudio, makeMats, prepareModel,
} from '/car3d.js';
import { prepareCybertruck } from '/cybertruck3d.js';
import { prepareHighland } from '/highland3d.js';

const stage = document.getElementById('txov-stage');
const loadingEl = document.getElementById('txov-loading');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
stage.prepend(renderer.domElement);   // canvas 垫底,数据 chips 在其上

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
setupStudio(renderer, scene);

// ---------- 轨道视角(默认右前上方 3/4 俯视;拖动旋转 / 滚轮或双指缩放) ----------
const target = new THREE.Vector3(0.35, 0.72, 0.1);   // 车偏右,左侧留给电量卡;抬高注视点→车在框内偏下
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
  let tap = null;   // 单击候选:抬起时位移 <8px → 查询色块信息
  el.addEventListener('pointerdown', (e) => {
    hideTip();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), r: orbitGoal.r };
      downAt = null;
      tap = null;
    } else {
      downAt = { x: e.clientX, y: e.clientY, theta: orbitGoal.theta, phi: orbitGoal.phi };
      tap = { x: e.clientX, y: e.clientY };
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
    if (pointers.size === 0) {
      downAt = null;
      if (e.type === 'pointerup' && tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) inspectRing(e);
      tap = null;
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    userZoomed = true;
    orbitGoal.r = Math.min(20, Math.max(3.2, orbitGoal.r * (1 + e.deltaY * 0.001)));
  }, { passive: false });
}

// 展示圆台(有厚度的展台,侧壁可见)+ 台面柔和投影;特斯拉红 T 车标贴在圆台侧壁正前方
{
  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(4.0, 4.0, 0.5, 72),
    [new THREE.MeshBasicMaterial({ color: 0x0b0e14 }),    // 侧壁
     new THREE.MeshBasicMaterial({ color: 0x171c26 }),    // 台面
     new THREE.MeshBasicMaterial({ color: 0x0b0e14 })]);  // 底面(不可见)
  ped.position.y = -0.249;   // 台面与旧圆盘同高(y≈0.001),台体向下延伸出厚度
  scene.add(ped);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.0, 3.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  shadow.position.y = 0.01;
  scene.add(shadow);

  // 侧壁车标:贴合柱面的弧形贴片(与圆台同心、略大一圈防 z-fighting),
  // 正对车头方向(-Z),默认右前俯视机位下清晰可见;特斯拉红 #E82127
  const lc = document.createElement('canvas');
  lc.width = lc.height = 512;
  const lctx = lc.getContext('2d');
  lctx.translate(66, 76);
  lctx.scale(380 / 24, 380 / 24);
  lctx.fillStyle = 'rgba(232,33,39,0.92)';
  lctx.fill(new Path2D('M12 5.362l2.475-3.026s4.245.09 8.471 2.054c-1.082 1.636-3.231 2.438-3.231 2.438-.146-1.439-1.154-1.79-4.354-1.79L12 24 8.619 5.034c-3.18 0-4.188.354-4.335 1.792 0 0-2.146-.795-3.229-2.43C5.28 2.431 9.525 2.34 9.525 2.34L12 5.362l-.004.002H12v-.002zm0-3.899c3.415-.03 7.326.528 11.328 2.28.535-.968.672-1.395.672-1.395C19.625.612 15.528.015 12 0 8.472.015 4.375.61 0 2.349c0 0 .195.525.672 1.396C4.674 1.989 8.585 1.435 12 1.46v.003z'));
  const logoTex = new THREE.CanvasTexture(lc);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  logoTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // 朝向默认机位方位角(orbit.theta=2.557,车头右前方):正前 -Z 会被透视挤到圆台右缘
  const LOGO_R = 4.012, LOGO_H = 0.42, LOGO_ARC = 0.62 / LOGO_R;  // 弧长 0.62m
  const logo = new THREE.Mesh(
    new THREE.CylinderGeometry(LOGO_R, LOGO_R, LOGO_H, 24, 1, true, 2.557 - LOGO_ARC / 2, LOGO_ARC),
    new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false, toneMapped: false }));
  logo.position.y = -0.19;   // 偏圆台上沿:高位俯视下侧壁被压扁,贴下沿会看不清
  logo.renderOrder = 1;
  scene.add(logo);
}

// ---------- 演示数据(与 2D 方案同源;bd = 本充电周期能耗构成,自车头起顺时针) ----------
const DEMO = {
  soc: 65,                    // 当前电量 %(= bd 中 remaining)
  rangeKm: 342,
  odoText: '12,345',          // 总里程 km(正式页来自 /api/vehicle)
  tin: 24.5,                  // 车内(空调)温度
  tout: 18,                   // 车外温度
  companionDays: 532,         // 陪伴天数(正式页来自 /api/vehicle/delivery)
  eff: { val: 152, lo: 120, hi: 210, official: 129 },   // 平均能耗 Wh/km + 近期区间 + 官方值
  bd: [
    { key: 'uncharged', label: '未充(充至 90%)', pct: 10, color: 0x5a6270, opacity: 0.5 },
    { key: 'idle', label: '驻车耗电', pct: 4, color: 0x4a3aa7, opacity: 0.95, kwh: 1.2 },
    { key: 'sentry', label: '哨兵模式', pct: 6, color: 0xe87ba4, opacity: 0.95, kwh: 1.8 },
    { key: 'drive', label: '行驶', pct: 15, color: 0xeda100, opacity: 0.95, kwh: 4.5 },
    { key: 'remaining', label: '剩余电量', pct: 65, color: 0x3987e5, opacity: 0.95 },
  ],
  tpms: { fl: '2.9', fr: '3.0', rl: '2.7', rr: '2.9' },
  tpmsColors: { fl: '#1baf7a', fr: '#1baf7a', rl: '#eda100', rr: '#1baf7a' },
};

// ---------- 圆柱形数据背景 ----------
// 车模后方一整圈 3D 曲面(相机在柱内,轨道旋转时各数据面板依次入画),
// 上下两行:上排=里程/电量/能耗/陪伴/车内空调/车外温度,
// 下排=胎压(四轮) + 本充电周期能耗构成比例(行驶/哨兵/驻车/未充/剩余,与底座内环同一份数据)
function drawBackdrop(cv, d) {
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // 底色:中部实、上下淡出(融入舞台渐变背景)
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(9,12,18,0)');
  bg.addColorStop(0.12, 'rgba(9,12,18,0.9)');
  bg.addColorStop(0.88, 'rgba(9,12,18,0.9)');
  bg.addColorStop(1, 'rgba(9,12,18,0)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const MUT = 'rgba(148,158,176,0.95)';   // 次级文字
  const TXT = 'rgba(236,241,249,1)';      // 主数值
  const GRN = '#1baf7a';
  const BLU = '#3987e5';
  const N = 6;   // 面板列数,均布一圈(每列上下两行)
  const pw = W / N;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 面板分隔:竖线贯通两行,中部一横分开上下两排
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 3;
  for (let i = 1; i < N; i++) {
    ctx.beginPath();
    ctx.moveTo(i * pw, H * 0.16);
    ctx.lineTo(i * pw, H * 0.88);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, H * 0.52);
  ctx.lineTo(W, H * 0.52);
  ctx.stroke();

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
  // 数值 + 小单位 组合居中
  function bigVal(cx, y, val, unit, size, color) {
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    const wv = ctx.measureText(val).width;
    ctx.font = `600 ${size * 0.38}px system-ui, sans-serif`;
    const wu = unit ? ctx.measureText(unit).width : 0;
    const x0 = cx - (wv + wu) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = color || TXT;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.fillText(val, x0, y);
    if (unit) {
      ctx.fillStyle = MUT;
      ctx.font = `600 ${size * 0.38}px system-ui, sans-serif`;
      ctx.fillText(unit, x0 + wv + 8, y + size * 0.16);
    }
    ctx.textAlign = 'center';
  }
  function label(cx, y, s) {
    ctx.fillStyle = MUT;
    ctx.font = '400 50px system-ui, sans-serif';
    ctx.fillText(s, cx, y);
  }
  function sub(cx, y, s) {
    ctx.fillStyle = MUT;
    ctx.font = '400 46px system-ui, sans-serif';
    ctx.fillText(s, cx, y);
  }
  function bar(cx, y, w, pct, color, officialPct) {
    rrect(cx - w / 2, y - 9, w, 18, 9);
    ctx.fillStyle = 'rgba(148,158,176,0.28)';
    ctx.fill();
    if (pct > 0) {
      rrect(cx - w / 2, y - 9, w * Math.min(1, pct), 18, 9);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (officialPct !== undefined) {
      ctx.fillStyle = 'rgba(236,241,249,0.85)';
      ctx.fillRect(cx - w / 2 + w * officialPct - 2.5, y - 17, 5, 34);
    }
  }

  const cy1 = H * 0.30;   // 上排文字带
  const cy2 = H * 0.75;   // 下排文字带
  const p = (i) => (i + 0.5) * pw;
  const dash = (v) => (v === null || v === undefined || v === '') ? '—' : `${v}`;
  const socT = d.soc === null || d.soc === undefined ? '—' : `${Math.round(d.soc)}`;
  // 上排 ① 总里程
  label(p(0), cy1 - 125, '总里程');
  bigVal(p(0), cy1 + 10, dash(d.odoText), d.odoText ? ' km' : '', 165);
  // 上排 ② 当前电量
  label(p(1), cy1 - 125, '当前电量');
  bigVal(p(1), cy1 - 2, socT, d.soc == null ? '' : ' %', 170);
  sub(p(1), cy1 + 105, d.rangeKm == null ? '' : `续航约 ${d.rangeKm} km`);
  if (d.soc != null) bar(p(1), cy1 + 165, 340, d.soc / 100, GRN);
  // 上排 ③ 平均能耗
  label(p(2), cy1 - 125, '平均能耗');
  if (d.eff && d.eff.val != null) {
    bigVal(p(2), cy1 - 2, `${Math.round(d.eff.val)}`, ' Wh/km', 155);
    sub(p(2), cy1 + 105, `官方 ${Math.round(d.eff.official)} · 刻度 ${d.eff.lo}–${d.eff.hi}`);
    bar(p(2), cy1 + 165, 340, (d.eff.val - d.eff.lo) / (d.eff.hi - d.eff.lo), BLU,
        (d.eff.official - d.eff.lo) / (d.eff.hi - d.eff.lo));
  } else {
    bigVal(p(2), cy1 + 10, '—', '', 170);
  }
  // 上排 ④ 陪伴天数
  label(p(3), cy1 - 125, '已陪伴');
  bigVal(p(3), cy1 + 10, dash(d.companionDays), d.companionDays != null ? ' 天' : '', 170);
  // 上排 ⑤ 车内空调
  label(p(4), cy1 - 125, '车内空调');
  bigVal(p(4), cy1 + 10, d.tin == null ? '—' : `${d.tin}`, d.tin == null ? '' : '°', 170);
  // 上排 ⑥ 车外温度
  label(p(5), cy1 - 125, '车外温度');
  bigVal(p(5), cy1 + 10, d.tout == null ? '—' : `${d.tout}`, d.tout == null ? '' : '°', 170);

  // 下排 ① 胎压(四轮 2×2,按与标准 2.9 bar 的偏差着色,与轮胎旁浮签同源)
  label(p(0), cy2 - 135, '胎压 bar');
  {
    const wheels = [['fl', -1, -1], ['fr', 1, -1], ['rl', -1, 1], ['rr', 1, 1]];
    ctx.font = '700 84px system-ui, sans-serif';
    for (const [k, sx, sy] of wheels) {
      const v = d.tpms && d.tpms[k] != null ? `${d.tpms[k]}` : '—';
      ctx.fillStyle = (d.tpmsColors && d.tpmsColors[k]) || TXT;
      ctx.fillText(v, p(0) + sx * 105, cy2 + sy * 62);
    }
  }
  // 下排 ②–⑥ 能耗构成比例(本充电周期:行驶/哨兵/驻车耗电/未充/剩余)
  {
    const bdMap = {};
    (d.bd || []).forEach((s) => { bdMap[s.key] = s; });
    const css = (c) => `#${c.toString(16).padStart(6, '0')}`;
    ['drive', 'sentry', 'idle', 'uncharged', 'remaining'].forEach((k, j) => {
      const s = bdMap[k];
      const cx = p(j + 1);
      label(cx, cy2 - 135, s ? s.label : '—');
      if (s) {
        bigVal(cx, cy2 - 8, `${Math.round(s.pct * 10) / 10}`, ' %', 130, css(s.color));
        if (s.kwh) sub(cx, cy2 + 78, `≈ ${Math.round(s.kwh * 10) / 10} kWh`);
      } else {
        bigVal(cx, cy2 + 10, '—', '', 130);
      }
    });
  }
}
const backdrop = (() => {
  const cv = document.createElement('canvas');
  cv.width = 4096; cv.height = 1152;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();   // 斜角柱面上文字保持锐利
  // 从柱内看 BackSide 纹理左右镜像 → 水平翻转补偿
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(5.4, 5.4, 5.0, 96, 1, true),   // 两行数据,柱面加高(原 4.2)
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.BackSide,
      depthWrite: false, toneMapped: false,
    }));
  wall.position.y = 2.08;
  wall.renderOrder = -1;   // 永远垫底
  scene.add(wall);
  return { canvas: cv, tex, redraw(d) { drawBackdrop(cv, d); tex.needsUpdate = true; } };
})();

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
const pickMeshes = [];   // 可点击查询的环段(userData.info = { title, sub })
const ringGroup = new THREE.Group();
scene.add(ringGroup);
// 外圈=当前电量(绿弧);内圈=本充电周期能耗构成(五色分段,与 2D 玻璃顶能量环同口径)
// 数据更新时整组重建(环段少,重建开销可忽略)
function buildRings(d) {
  for (const m of ringGroup.children) { m.geometry.dispose(); m.material.dispose(); }
  ringGroup.clear();
  pickMeshes.length = 0;
  const R = 3.62;   // 圆盘半径 4.0,外圈贴圆盘边缘内侧
  const track = ellipseRibbon(R, R, 0, Math.PI * 2, 0.105, 0.025, 0x808ca0, 0.25);
  ringGroup.add(track);
  const socInfo = {
    title: d.soc == null ? '当前电量 —' : `当前电量 ${Math.round(d.soc)}%`,
    sub: d.rangeKm == null ? '' : `续航约 ${d.rangeKm} km`,
  };
  track.userData.info = socInfo;
  pickMeshes.push(track);
  if (d.soc != null) {
    const tSoc = Math.max(0, Math.min(100, d.soc)) / 100 * Math.PI * 2;
    const arc = ellipseRibbon(R, R, 0, tSoc, 0.115, 0.03, 0x1baf7a, 0.95);
    const glow = ellipseRibbon(R, R, 0, tSoc, 0.39, 0.022, 0x1baf7a, 0.16, true);
    arc.userData.info = socInfo;
    pickMeshes.push(arc);
    ringGroup.add(arc, glow);
  }
  const RB = 3.28;  // 内圈:能耗构成
  let acc = 0;
  for (const seg of (d.bd || [])) {
    if (seg.pct <= 0.05) continue;
    const t0 = (acc / 100) * Math.PI * 2;
    acc += seg.pct;
    const t1 = (acc / 100) * Math.PI * 2;
    const m = ellipseRibbon(RB, RB, t0, t1, 0.15, 0.028, seg.color, seg.opacity);
    m.userData.info = {
      title: `${seg.label} ${Math.round(seg.pct * 10) / 10}%`,
      sub: seg.kwh ? `约 ${Math.round(seg.kwh * 10) / 10} kWh · 本充电周期` : '本充电周期',
    };
    pickMeshes.push(m);
    ringGroup.add(m);
  }
}

// ---------- 色块点击查询(位移 <8px 的抬起视为点击;拖动/捏合不触发) ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tipEl = document.getElementById('txov-tip');
let tipTimer = 0;
function hideTip() { tipEl.classList.remove('show'); clearTimeout(tipTimer); }
function inspectRing(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickMeshes, false)[0];
  if (!hit) return;
  const info = hit.object.userData.info;
  tipEl.textContent = '';
  const b = document.createElement('b');
  b.textContent = info.title;
  tipEl.appendChild(b);
  if (info.sub) {
    const s = document.createElement('small');
    s.textContent = info.sub;
    tipEl.appendChild(s);
  }
  const px = (ndc.x * 0.5 + 0.5) * rect.width;
  const py = (-ndc.y * 0.5 + 0.5) * rect.height;
  tipEl.style.left = `${Math.min(rect.width - 80, Math.max(80, px))}px`;
  tipEl.style.top = `${Math.max(64, py)}px`;
  tipEl.classList.add('show');
  tipTimer = setTimeout(hideTip, 4000);
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
  gltf.scene.scale.multiplyScalar(1.18);   // 放大车模:原比例相对圆台偏小
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
}, undefined, (err) => {
  loadingEl.textContent = '模型加载失败:' + (err && err.message || err);
});

// ---------- 数据覆盖层定位 ----------
const v = new THREE.Vector3();
function project(p) {   // 世界坐标 → stage 像素
  v.copy(p).project(camera);
  return [(v.x * 0.5 + 0.5) * stage.clientWidth, (-v.y * 0.5 + 0.5) * stage.clientHeight];
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
  getOrbit() { return { ...orbit, camY: camera.position.y }; },
  // 立即切到指定轨道视角(跳过插值):__txov.setOrbit(theta, phi, r)
  setOrbit(theta, phi, r) {
    if (theta !== undefined) orbit.theta = orbitGoal.theta = theta;
    if (phi !== undefined) orbit.phi = orbitGoal.phi = phi;
    if (r !== undefined) orbit.r = orbitGoal.r = r;
  },
  // 世界坐标 → stage 像素(自动化点色块用)
  screenOf(x, y, z) { return project(new THREE.Vector3(x, y, z)); },
};

// ---------- 数据注入(测试页传演示数据;正式页 ovMode=3d 时由 app.js 喂真实数据) ----------
// d = { soc, rangeKm, odoText, tin, tout, companionDays,
//       eff: { val, lo, hi, official } | null,
//       bd: [{ key, label, pct, color, opacity, kwh? }],
//       tpms: { fl, fr, rl, rr }, tpmsColors?: { fl..rr: css色 } }
function setData(d) {
  backdrop.redraw(d);
  buildRings(d);
  if (d.tpms) {
    for (const k of ['fl', 'fr', 'rl', 'rr']) {
      const el = document.getElementById(`txov-tpms-${k}`);
      if (!el) continue;
      el.textContent = d.tpms[k] ?? '—';
      el.style.color = (d.tpmsColors && d.tpmsColors[k]) || '';
    }
  }
}
window.Ov3D = {
  setData,
  pause: window.__txov.pause,
  resume: window.__txov.resume,
  setOrbit: window.__txov.setOrbit,
};
// 测试页默认值:无注入配置 → 演示数据;正式页 window.__ov3d = { demo:false } 时等真实数据
const CONF = window.__ov3d || {};
if (CONF.demo !== false) setData(DEMO);
