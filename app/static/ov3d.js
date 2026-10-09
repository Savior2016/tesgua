// 测试页面 · 方案③:总览 3D 全景(候选替代 2D 投影)
// 固定 3/4 俯视机位的新款 Model Y L(与控制页共用 car3d.js 加载管线),
// 数据展示:地面能量弧环=电量,背景弧形墙两行=统计/胎压/能耗构成。
import {
  THREE, MODELS, resolveCfg, makeLoader, setupStudio, makeMats, prepareModel,
} from '/car3d.js';
import { prepareCybertruck } from '/cybertruck3d.js';
import { prepareHighland } from '/highland3d.js';

const stage = document.getElementById('txov-stage');
const loadingEl = document.getElementById('txov-loading');

// 总览 3D 模型(个人中心「总览 3D 模型」偏好,与控制页车模相互独立;localStorage 秒开,后台 /api/prefs 校准)
const loader = makeLoader();
const prefKey = localStorage.getItem('ttv-ovcarmodel');
const cfg = resolveCfg(prefKey && MODELS[prefKey] ? prefKey : 'y-yl');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
stage.prepend(renderer.domElement);   // canvas 垫底,数据 chips 在其上

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
setupStudio(renderer, scene);

// ---------- 轨道视角(默认右前上方 3/4 俯视;拖动旋转 / 滚轮或双指缩放) ----------
const target = new THREE.Vector3(0, 0.72, 0);   // 注视点抬高→车在框内偏下;数据在背景墙,车居中
const orbit = { theta: 2.557, phi: 1.139, r: 6.9 };  // 方向同旧固定机位,半径由 fitRadius 校准
const orbitGoal = { ...orbit };
let userZoomed = false;   // 用户手动缩放后不再随窗口尺寸重置
// 展示台缓转:加载后自动旋转,用户一上手(拖动/捏合/滚轮)即停,尊重系统减少动态设置
let autoSpin = !matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    autoSpin = false;   // 用户接管,停止自动旋转
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
    autoSpin = false;
    userZoomed = true;
    orbitGoal.r = Math.min(20, Math.max(3.2, orbitGoal.r * (1 + e.deltaY * 0.001)));
  }, { passive: false });
}

// ---------- 展示圆台(按模型主题差异化) ----------
// 不同模型配不同台面/侧壁/边缘光;默认深色台 + 电蓝边缘光环,避免与深色背景相融。
// 侧壁特斯拉 T 标 / TESLA 字标除火星地表主题外均保留。
const ovModelKey = prefKey && MODELS[prefKey] ? prefKey : 'y-yl';
const pedTheme = { 'mars-rover': 'mars', ironman: 'stark', yaoyao: 'candy', sanbengzi: 'street', hellokitty: 'candy', mickey: 'club' }[ovModelKey] || 'default';
{
  // 确定性伪噪声(布景用):多组 sin 叠加,无需随机种子
  const pnoise = (x, y) => Math.sin(x * 2.1 + y * 1.3) * 0.5 + Math.sin(x * 4.7 - y * 3.1 + 1.7) * 0.3
    + Math.sin(x * 9.3 + y * 7.7 + 4.2) * 0.2;
  const smooth01 = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  // 侧壁竖向渐变(上亮下暗,让圆台从深色背景里"立"起来)
  const sideTex = (top, bottom) => {
    const t = canvasTex(8, 128, (c) => {
      const g = c.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      c.fillStyle = g; c.fillRect(0, 0, 8, 128);
    });
    t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  // 台面边缘发光环(无后处理泛光,additive 叠加模拟)
  const glowRing = (rIn, rOut, color, opacity) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(rIn, rOut, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    m.position.y = 0.004;
    m.renderOrder = 2;
    scene.add(m);
  };
  // 台面贴图圆片(盖在圆台顶面上,不动圆柱 UV)
  const topDisc = (tex) => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(3.98, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex }));
    m.position.y = 0.003;
    scene.add(m);
  };

  const THEMES = {
    default: { side: ['#2b3346', '#0b0e14'], top: 0x1b2130, glow: [0x3d7bff, 0.45] },
    mars:    { side: ['#5a3220', '#1c0e08'], top: 0x3a2115 },
    stark:   { side: ['#39414f', '#0e1118'], top: 0x14181f, glow: [0x6fd3ff, 0.8] },
    candy:   { side: ['#e89bb2', '#5c3547'], top: 0xfdf0f3, glow: [0xff9ec4, 0.5] },
    street:  { side: ['#3c3f45', '#121317'], top: 0x26282d, glow: [0xffc42e, 0.4] },
    club:    { side: ['#4a1518', '#0d0b0c'], top: 0x8f1216, glow: [0xffc42e, 0.6] },
  };
  const th = THEMES[pedTheme];
  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(4.0, 4.0, 0.5, 72),
    [new THREE.MeshBasicMaterial({ map: sideTex(th.side[0], th.side[1]) }),   // 侧壁
     new THREE.MeshBasicMaterial({ color: th.top }),                          // 台面
     new THREE.MeshBasicMaterial({ color: th.side[1] })]);                    // 底面(不可见)
  ped.position.y = -0.249;   // 台面与旧圆盘同高(y≈0.001),台体向下延伸出厚度
  scene.add(ped);

  if (pedTheme === 'mars') {
    // 3D 火星表面:实拍纹理(裁掉天空)+ 噪声起伏 + 散落岩石。
    // 布局:r<2.1 停车区压平;r 2.1~3.1 起伏带;再往外是能耗环/电量环丝带(r 3.2~3.82,
    // 离地仅 2~3cm),必须保持平整,岩石也不能越过 r≈3.05。
    const terrH = (x, z) => {
      const r = Math.hypot(x, z);
      return pnoise(x, z) * 0.1 * smooth01(2.1, 2.7, r) * (1 - smooth01(2.9, 3.15, r));
    };
    const terr = new THREE.Mesh(
      new THREE.RingGeometry(0.02, 3.96, 96, 18).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xb0714f, roughness: 1, metalness: 0 }));
    const tpos = terr.geometry.attributes.position;
    for (let i = 0; i < tpos.count; i++) {
      tpos.setY(i, terrH(tpos.getX(i), tpos.getZ(i)));
    }
    terr.geometry.computeVertexNormals();
    terr.position.y = 0.002;
    scene.add(terr);
    new THREE.TextureLoader().load('/mars-surface.webp', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      t.repeat.set(1, 0.42);   // 原图上半是天空,只取底部地表
      terr.material.map = t;
      terr.material.color.set(0xffffff);
      terr.material.needsUpdate = true;
    });
    // 散落岩石(黄金角散布,位置确定;限制在起伏带内,不碰能耗环)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d4b30, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = i * 2.399963 + 0.7;
      const r = 2.32 + ((i * 37) % 100) / 100 * 0.58;
      const s = 0.05 + ((i * 53) % 100) / 100 * 0.12;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
      rock.position.set(x, terrH(x, z) + s * 0.35, z);
      rock.rotation.set(i * 1.3, i * 2.1, i * 0.7);
      scene.add(rock);
    }
  } else if (pedTheme === 'stark') {
    // 斯塔克工业风:枪灰金属台面 + 方舟反应炉光环
    topDisc(canvasTex(512, 512, (c) => {
      const g = c.createRadialGradient(256, 256, 30, 256, 256, 256);
      g.addColorStop(0, '#232a36'); g.addColorStop(1, '#12161d');
      c.fillStyle = g; c.fillRect(0, 0, 512, 512);
      c.strokeStyle = 'rgba(111,211,255,0.9)';
      c.shadowColor = '#6fd3ff'; c.shadowBlur = 18;
      c.lineWidth = 7; c.beginPath(); c.arc(256, 256, 92, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 3; c.setLineDash([26, 18]);
      c.beginPath(); c.arc(256, 256, 150, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]); c.globalAlpha = 0.5; c.lineWidth = 2;
      c.beginPath(); c.arc(256, 256, 205, 0, Math.PI * 2); c.stroke();
    }));
  } else if (pedTheme === 'candy') {
    // 摇摇车:薄荷糖条纹台面
    topDisc(canvasTex(512, 512, (c) => {
      for (let i = 0; i < 16; i++) {
        c.fillStyle = i % 2 ? '#ffbdd2' : '#fff2f6';
        c.beginPath(); c.moveTo(256, 256);
        c.arc(256, 256, 260, i * Math.PI / 8, (i + 1) * Math.PI / 8);
        c.fill();
      }
      c.fillStyle = '#ff9ec4';
      c.beginPath(); c.arc(256, 256, 46, 0, Math.PI * 2); c.fill();
    }));
  } else if (pedTheme === 'street') {
    // 三蹦子:柏油路面 + 黄色虚线环岛
    topDisc(canvasTex(512, 512, (c) => {
      c.fillStyle = '#26282d'; c.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 900; i++) {   // 柏油颗粒(格点伪随机)
        const x = (i * 197) % 512, y = (i * 311) % 512;
        c.fillStyle = i % 3 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.16)';
        c.fillRect(x, y, 2, 2);
      }
      c.strokeStyle = '#ffc42e'; c.lineWidth = 6; c.setLineDash([30, 22]);
      c.beginPath(); c.arc(256, 256, 190, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 3;
      c.beginPath(); c.arc(256, 256, 240, 0, Math.PI * 2); c.stroke();
    }));
  } else if (pedTheme === 'club') {
    // 米奇俱乐部:红丝绒台面 + 一圈黄色圆点
    topDisc(canvasTex(512, 512, (c) => {
      const g = c.createRadialGradient(256, 256, 40, 256, 256, 256);
      g.addColorStop(0, '#c11e24'); g.addColorStop(1, '#7d0f14');
      c.fillStyle = g; c.fillRect(0, 0, 512, 512);
      c.fillStyle = '#ffc42e';
      for (let i = 0; i < 12; i++) {   // 外圈黄点
        const a = i * Math.PI / 6;
        c.beginPath(); c.arc(256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200, 13, 0, Math.PI * 2); c.fill();
      }
    }));
  }
  if (th.glow) {
    glowRing(3.55, 3.78, th.glow[0], th.glow[1] * 0.5);
    glowRing(3.9, 3.99, th.glow[0], th.glow[1]);
  }

  // 台面柔和投影(火星地表自带起伏与光影,跳过)
  if (pedTheme !== 'mars') {
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
  }

  // 侧壁车标:贴合柱面的弧形贴片(与圆台同心、略大一圈防 z-fighting),
  // 对齐车头(-Z);特斯拉红 #E82127 T 字徽章(图形标,火星地表主题除外)
  if (pedTheme !== 'mars') {
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
  // 对齐车头方向(-Z):CylinderGeometry theta 自 +Z 起算,车头 = θ=π
  const LOGO_R = 4.012, LOGO_H = 0.42, LOGO_ARC = 0.62 / LOGO_R;  // 弧长 0.62m
  const logo = new THREE.Mesh(
    new THREE.CylinderGeometry(LOGO_R, LOGO_R, LOGO_H, 64, 1, true, Math.PI - LOGO_ARC / 2, LOGO_ARC),
    new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, depthWrite: false, toneMapped: false }));
  logo.position.y = -0.19;   // 偏圆台上沿:高位俯视下侧壁被压扁,贴下沿会看不清
  logo.renderOrder = 1;
  scene.add(logo);
  }

  // 侧壁文字标:与图形标正对的一侧(θ=0,车尾方向 +Z),TESLA 红色字标。
  // SVG 含嵌套变换,Path2D 直译会画飞,故整图 base64 内嵌走 Image 绘制
  if (pedTheme !== 'mars') {
  const wc = document.createElement('canvas');
  wc.width = 1024; wc.height = 136;   // 与 SVG viewBox 1236×161 同比例
  const wctx = wc.getContext('2d');
  const wordTex = new THREE.CanvasTexture(wc);
  wordTex.colorSpace = THREE.SRGBColorSpace;
  wordTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const wimg = new Image();
  wimg.onload = () => { wctx.drawImage(wimg, 0, 0, 1024, 136); wordTex.needsUpdate = true; };
  wimg.src = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcKICAgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIgogICB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiCiAgIHhtbG5zOnN2Zz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciCiAgIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgdmVyc2lvbj0iMS4xIgogICBpZD0ic3ZnMTEwMzgiCiAgIHZpZXdCb3g9IjAgMCAxMjM2LjAwODcgMTYxLjEzMDE1IgogICBoZWlnaHQ9IjQ1LjQ3NDUxbW0iCiAgIHdpZHRoPSIzNDguODI5MTNtbSI+CiAgPGRlZnMKICAgICBpZD0iZGVmczExMDQwIiAvPgogIDxtZXRhZGF0YQogICAgIGlkPSJtZXRhZGF0YTExMDQzIj4KICAgIDxyZGY6UkRGPgogICAgICA8Y2M6V29yawogICAgICAgICByZGY6YWJvdXQ9IiI+CiAgICAgICAgPGRjOmZvcm1hdD5pbWFnZS9zdmcreG1sPC9kYzpmb3JtYXQ+CiAgICAgICAgPGRjOnR5cGUKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS9TdGlsbEltYWdlIiAvPgogICAgICAgIDxkYzp0aXRsZT48L2RjOnRpdGxlPgogICAgICA8L2NjOldvcms+CiAgICA8L3JkZjpSREY+CiAgPC9tZXRhZGF0YT4KICA8ZwogICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKDg1OC4wMDQzOCwtMTkzLjEyMjEyKSIKICAgICBpZD0ibGF5ZXIxIj4KICAgIDxnCiAgICAgICBpZD0iZzExNTk0Ij4KICAgICAgPGcKICAgICAgICAgaWQ9ImcxMDQ4MiIKICAgICAgICAgdHJhbnNmb3JtPSJtYXRyaXgoMjAuMzI2NzUxLDAsMCwtMjAuMzI2NzUxLC04Ljc1MjcyMTksMTkzLjMyNTM5KSI+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBkPSJtIDAsMCAtMS41NDEsLTAuMDA0IDAsLTcuOTA3IDcuMDY3LDAgYyAwLjc3MywwLjMyOCAxLjE4NywwLjg5NSAxLjM0NywxLjU1NyBsIC02Ljg3NywwIEwgMCwwIFogbSAxMS41MzIsLTEuNTggNS44OTUsMCBjIDAuODE5LDAuMTYyIDEuNDI5LDAuODg1IDEuNiwxLjU4NCBsIC05LjA5NiwwIGMgMC4xNywtMC42OTkgMC43ODksLTEuNDIyIDEuNjAxLC0xLjU4NCBtIC0xOS4wOTEsMC4wMjIgYyAwLjgxOSwwLjIzOCAxLjUwOSwwLjg2MyAxLjY3NywxLjU1NiBsIC04LjY1LDAgMCwtNC42NzIgNy4wOCwwIDAsLTEuNjQgLTUuNTUzLC0wLjAwNSBjIC0wLjg3MSwtMC4yNDIgLTEuNjA3LC0wLjgyNiAtMS45NzYsLTEuNTk4IGwgMC40NDksMC4wMDggOC42MDIsMCAwLDQuNzg4IC03LjA3NSwwIDAsMS41NjMgNS40NDYsMCB6IG0gMTcuNzI4LC02LjM1MSAxLjUzMywwIDAsMy4xODMgNS41ODEsMCAwLC0zLjE4MyAxLjUzMiwwIDAsNC43NzQgLTguNjQ2LDAuMDA4IDAsLTQuNzgyIHogbSAtMzYuNjE1LDYuMzM0IDUuODk0LDAgYyAwLjgyLDAuMTYzIDEuNDI5LDAuODg2IDEuNiwxLjU4NSBsIC05LjA5NSwwIGMgMC4xNywtMC42OTkgMC43ODgsLTEuNDIyIDEuNjAxLC0xLjU4NSBtIC0xNS4zMzQsMS41NjcgYyAwLjE3NywtMC42OTIgMC43NzYsLTEuMzk3IDEuNTk3LC0xLjU3NSBsIDIuNDgxLDAgMC4xMjYsLTAuMDUgMCwtNi4yNiAxLjU1LDAgMCw2LjI2IDAuMTQsMC4wNSAyLjQ4NCwwIGMgMC44MjksMC4yMTQgMS40MTUsMC44ODMgMS41OSwxLjU3NSBsIDAsMC4wMTUgLTkuOTY4LDAgMCwtMC4wMTUgeiBtIDE1LjMzNCwtNy45MDIgNS44OTQsMCBjIDAuODIsMC4xNjQgMS40MjksMC44ODUgMS42LDEuNTg1IGwgLTkuMDk1LDAgYyAwLjE3LC0wLjcgMC43ODgsLTEuNDIxIDEuNjAxLC0xLjU4NSBtIDAsMy4yMSA1Ljg5NCwwIGMgMC44MiwwLjE2MiAxLjQyOSwwLjg4NSAxLjYsMS41ODQgbCAtOS4wOTUsMCBjIDAuMTcsLTAuNjk5IDAuNzg4LC0xLjQyMiAxLjYwMSwtMS41ODQiCiAgICAgICAgICAgc3R5bGU9ImZpbGw6I2U4MjEyNztmaWxsLW9wYWNpdHk6MTtmaWxsLXJ1bGU6bm9uemVybztzdHJva2U6bm9uZSIKICAgICAgICAgICBpZD0icGF0aDEwNDg0IiAvPgogICAgICA8L2c+CiAgICA8L2c+CiAgPC9nPgo8L3N2Zz4K';
  const WORD_ARC = 2.4 / 4.012;   // 弧长 2.4m:字标宽高比大,弧长相应放宽
  const word = new THREE.Mesh(
    new THREE.CylinderGeometry(4.012, 4.012, 0.32, 64, 1, true, -WORD_ARC / 2, WORD_ARC),
    new THREE.MeshBasicMaterial({ map: wordTex, transparent: true, depthWrite: false, toneMapped: false }));
  word.position.y = -0.19;
  word.renderOrder = 1;
  scene.add(word);
  }
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
  bh: { pct: 98.2, kwh: 83.8 },   // 电池健康 %(= 最新估算满电 ÷ 历史最高)+ 最新估算满电 kWh
  monthKm: 1234,              // 本月里程
  weekKm: 210,                // 本周里程(周一起算)
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
// 上下两行:上排=里程/电量/电池健康/能耗/陪伴/车内空调/车外温度,
// 下排=胎压(四轮) + 本充电周期能耗构成比例(行驶/哨兵/驻车/未充/剩余,与底座内环同一份数据) + 本月里程
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
  const N = 7;   // 面板列数,均布一圈(每列上下两行)
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
  bigVal(p(0), cy1 + 10, dash(d.odoText), d.odoText ? ' km' : '', 145);
  // 上排 ② 当前电量
  label(p(1), cy1 - 125, '当前电量');
  bigVal(p(1), cy1 - 2, socT, d.soc == null ? '' : ' %', 155);
  sub(p(1), cy1 + 105, d.rangeKm == null ? '' : `续航约 ${d.rangeKm} km`);
  if (d.soc != null) bar(p(1), cy1 + 165, 340, d.soc / 100, GRN);
  // 上排 ③ 电池健康(最新估算满电 ÷ 历史最高;≥97 绿/≥90 黄/否则红,同 2D 口径)
  label(p(2), cy1 - 125, '电池健康');
  if (d.bh && d.bh.pct != null) {
    const bhC = d.bh.pct >= 97 ? GRN : d.bh.pct >= 90 ? '#fab219' : '#d03b3b';
    bigVal(p(2), cy1 - 2, `${Math.round(d.bh.pct * 10) / 10}`, ' %', 155, bhC);
    if (d.bh.kwh != null) sub(p(2), cy1 + 105, `满电约 ${Math.round(d.bh.kwh * 10) / 10} kWh`);
    bar(p(2), cy1 + 165, 340, d.bh.pct / 100, bhC);
  } else {
    bigVal(p(2), cy1 + 10, '—', '', 155);
  }
  // 上排 ④ 平均能耗
  label(p(3), cy1 - 125, '平均能耗');
  if (d.eff && d.eff.val != null) {
    bigVal(p(3), cy1 - 2, `${Math.round(d.eff.val)}`, ' Wh/km', 140);
    sub(p(3), cy1 + 105, `官方 ${Math.round(d.eff.official)} · 刻度 ${d.eff.lo}–${d.eff.hi}`);
    bar(p(3), cy1 + 165, 340, (d.eff.val - d.eff.lo) / (d.eff.hi - d.eff.lo), BLU,
        (d.eff.official - d.eff.lo) / (d.eff.hi - d.eff.lo));
  } else {
    bigVal(p(3), cy1 + 10, '—', '', 155);
  }
  // 上排 ⑤ 陪伴天数
  label(p(4), cy1 - 125, '已陪伴');
  bigVal(p(4), cy1 + 10, dash(d.companionDays), d.companionDays != null ? ' 天' : '', 155);
  // 上排 ⑥ 车内空调
  label(p(5), cy1 - 125, '车内空调');
  bigVal(p(5), cy1 + 10, d.tin == null ? '—' : `${d.tin}`, d.tin == null ? '' : '°', 155);
  // 上排 ⑦ 车外温度
  label(p(6), cy1 - 125, '车外温度');
  bigVal(p(6), cy1 + 10, d.tout == null ? '—' : `${d.tout}`, d.tout == null ? '' : '°', 155);

  // 下排 ① 胎压(四轮 2×2,按与标准 2.9 bar 的偏差着色)
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
    // 下排 ⑦ 本月里程(副标=本周里程)
    label(p(6), cy2 - 135, '本月里程');
    bigVal(p(6), cy2 - 8, d.monthKm == null ? '—' : `${Math.round(d.monthKm)}`,
           d.monthKm == null ? '' : ' km', 130);
    if (d.weekKm != null) sub(p(6), cy2 + 78, `本周 ${Math.round(d.weekKm)} km`);
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

// ---------- 加载用户车型 ----------
fetch('/api/prefs').then((r) => r.json()).then((p) => {
  if (p.ov_car_model && MODELS[p.ov_car_model]) localStorage.setItem('ttv-ovcarmodel', p.ov_car_model);
  if (p.car_color_effective) localStorage.setItem('ttv-carcolor', p.car_color_effective);
}).catch(() => {});

let rockPivot = null;   // 摇摇车:绕底座顶面铰链的缓摇组(尊重 prefers-reduced-motion)
loader.load(cfg.url, (gltf) => {
  if (cfg.cybertruck) {
    gltf.scene = prepareCybertruck(gltf.scene).scene;
  } else if (cfg.highland) {
    gltf.scene = prepareHighland(gltf.scene, makeMats()).scene;
  } else if (!cfg.raw) {
    prepareModel(gltf.scene, cfg, makeMats());
  }   // raw:趣味模型保留原配色,不做换漆/玻璃重映射
  gltf.scene.scale.multiplyScalar(1.18);   // 放大车模:原比例相对圆台偏小
  let root = gltf.scene;
  if (cfg.rock && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const py = (cfg.rockPivotY || 0) * 1.18;   // 铰链高度换算到缩放后的世界坐标
    rockPivot = new THREE.Group();
    gltf.scene.position.y = -py;
    rockPivot.position.y = py;
    rockPivot.add(gltf.scene);
    root = rockPivot;
  }
  scene.add(root);
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

// 胎压 chips 已移除:胎压改在背景弧形墙下排展示,不再锚在四轮旁

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
  if (autoSpin) orbitGoal.theta += 0.0012;   // 展台缓转(比控制页略慢)
  if (rockPivot) rockPivot.rotation.x = Math.sin(performance.now() * 0.0022) * 0.05;  // 摇摇车缓摇
  orbit.theta += (orbitGoal.theta - orbit.theta) * 0.12;
  orbit.phi += (orbitGoal.phi - orbit.phi) * 0.12;
  orbit.r += (orbitGoal.r - orbit.r) * 0.15;
  applyOrbit();
  if (!window.__txovPaused) renderer.render(scene, camera);
}
frame();

// 调试钩子(自动化截图用)
window.__txov = {
  pause() { window.__txovPaused = true; autoSpin = false; },
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
  // 材质/贴图状态检查(自动化排障用)
  THREE, scene,
};

// ---------- 数据注入(测试页传演示数据;正式页 ovMode=3d 时由 app.js 喂真实数据) ----------
// d = { soc, rangeKm, odoText, tin, tout, companionDays,
//       eff: { val, lo, hi, official } | null,
//       bh: { pct, kwh } | null,   // 电池健康 % + 最新估算满电 kWh
//       monthKm, weekKm,           // 本月/本周里程
//       bd: [{ key, label, pct, color, opacity, kwh? }],
//       tpms: { fl, fr, rl, rr }, tpmsColors?: { fl..rr: css色 } }
function setData(d) {
  backdrop.redraw(d);
  buildRings(d);
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
