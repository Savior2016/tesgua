/* ===== TTVPageTurn:分页切换动效(主面板 index.html 与演示页 demo.html 共用) =====
 * 1) 翻页:旧页模块(.grid > .card)按各自最近的屏幕边缘方向加速退出并渐隐,
 *    新页模块从四周减速滑入并渐显,按模块 stagger 依次入场。
 * 2) Tab 气泡:选中气泡从旧位置滑动到新位置,中段先拉伸覆盖起止区间再回弹收窄,
 *    模拟 iOS 液态玻璃的 squash & stretch。
 * 全部走 Web Animations API;prefers-reduced-motion 时全部跳过。
 */
(function () {
  'use strict';

  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => RM.matches;

  /* 页面内的顶层模块卡片 */
  function modulesOf(page) {
    return page ? Array.from(page.querySelectorAll('.grid > .card')) : [];
  }

  /* 元素中心相对视口中心的主导方向 → 最近的屏幕边缘(左/右/上/下) */
  function edgeDir(el) {
    const r = el.getBoundingClientRect();
    const nx = (r.left + r.width / 2 - innerWidth / 2) / (innerWidth / 2);
    const ny = (r.top + r.height / 2 - innerHeight / 2) / (innerHeight / 2);
    if (Math.abs(nx) >= Math.abs(ny)) return [nx >= 0 ? 1 : -1, 0];
    return [0, ny >= 0 ? 1 : -1];
  }

  const EXIT_MS = 300;        // 单卡退出时长
  const ENTER_MS = 470;       // 单卡入场时长
  const EXIT_STAGGER = 34;    // 退出错峰(紧凑,先加速离场)
  const ENTER_STAGGER = 52;   // 入场错峰(舒展,依次落位)
  const EXIT_DIST = 64;       // 退出位移 px
  const ENTER_DIST = 78;      // 入场位移 px

  /* 旧页退出:Promise 在所有卡片离场完成后、且动画清理已排期后 resolve。
   * resolve 前调用方会立即隐藏页面(display:none),此处 rAF 后再 cancel,
   * 避免 fill:forwards 提前取消造成离场卡片闪回。 */
  function exit(page) {
    const cards = modulesOf(page);
    if (reduced() || !cards.length) return Promise.resolve();
    const anims = cards.map((card, i) => {
      const [dx, dy] = edgeDir(card);
      return card.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * EXIT_DIST}px, ${dy * EXIT_DIST}px) scale(0.97)`, opacity: 0 },
      ], {
        duration: EXIT_MS,
        delay: i * EXIT_STAGGER,
        easing: 'cubic-bezier(.5, 0, .75, 0)',  // 加速离场
        fill: 'forwards',
      });
    });
    return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(
      () => new Promise((res) => requestAnimationFrame(() => {
        anims.forEach((a) => a.cancel());
        res();
      })));
  }

  /* 新页入场:各卡片从最近的屏幕边缘方向滑入并渐显,按模块错峰 */
  function enter(page) {
    const cards = modulesOf(page);
    if (reduced() || !cards.length) return;
    cards.forEach((card, i) => {
      const [dx, dy] = edgeDir(card);
      card.animate([
        { transform: `translate(${dx * ENTER_DIST}px, ${dy * ENTER_DIST}px) scale(0.97)`, opacity: 0 },
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      ], {
        duration: ENTER_MS,
        delay: i * ENTER_STAGGER,
        easing: 'cubic-bezier(.16, 1, .3, 1)',  // 减速落位
      });
    });
  }

  /* Tab 气泡拉伸滑动:旧位置 → 中段拉伸覆盖起止区间(带少量过冲) → 新位置回弹收窄。
   * 无动画需求(首次定位/resize/reduced-motion/宽未就绪)时直接落位。 */
  function slideBubble(bubble, btn) {
    const toL = btn.offsetLeft;
    const toW = btn.offsetWidth;
    const fromL = parseFloat(bubble.style.left);
    const fromW = parseFloat(bubble.style.width);
    if (reduced() || !isFinite(fromL) || !isFinite(fromW) || fromW <= 0 ||
        (fromL === toL && fromW === toW)) {
      bubble.classList.add('no-anim');
      bubble.style.left = toL + 'px';
      bubble.style.width = toW + 'px';
      requestAnimationFrame(() => bubble.classList.remove('no-anim'));
      return;
    }
    const dist = Math.abs(toL - fromL);
    const over = Math.min(14, dist * 0.08);          // 中段过冲量
    const spanL = Math.min(fromL, toL);
    const spanR = Math.max(fromL + fromW, toL + toW);
    let midL, midW;
    if (toL >= fromL) { midL = spanL; midW = spanR - spanL + over; }        // 向右:向右拉伸
    else { midL = spanL - over; midW = spanR - spanL + over; }              // 向左:向左拉伸
    bubble.classList.add('no-anim');                 // 关 CSS 过渡,改由 WAAPI 驱动
    bubble.style.left = toL + 'px';
    bubble.style.width = toW + 'px';
    bubble.animate([
      { left: fromL + 'px', width: fromW + 'px', offset: 0 },
      { left: midL + 'px', width: midW + 'px', offset: 0.55 },
      { left: toL + 'px', width: toW + 'px', offset: 1 },
    ], {
      duration: 400 + Math.min(220, dist * 0.5),     // 距离越远滑得越久
      easing: 'cubic-bezier(.22, 1.2, .36, 1)',
    });
    requestAnimationFrame(() => bubble.classList.remove('no-anim'));
  }

  window.TTVPageTurn = { exit, enter, slideBubble };
})();
