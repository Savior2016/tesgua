/* 个人中心:账号管理 + Tesla 授权状态/指引 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fmtAgo(ts) {
    if (!ts) return '—';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return `${Math.round(s)} 秒前`;
    if (s < 5400) return `${Math.round(s / 60)} 分钟前`;
    if (s < 129600) return `${(s / 3600).toFixed(1)} 小时前`;
    return `${Math.round(s / 86400)} 天前`;
  }

  // TeslaMate 管理页链接:与面板同主机,端口 4000(仅本机监听时提示 SSH 隧道)
  const tmUrl = 'http://localhost:4000';
  $('teslamate-link').href = tmUrl;
  $('teslamate-url').textContent = tmUrl;
  $('ssh-tunnel-cmd').textContent = `ssh -L 4000:127.0.0.1:4000 用户@${location.hostname}`;

  const STEP_ORDER = ['deployed', 'token', 'authorized', 'car', 'synced'];

  function renderSteps(steps) {
    // token(获取令牌)无法自动检测:前面的步骤完成即视为可执行
    const doneMap = {
      deployed: steps.deployed,
      token: steps.deployed,
      authorized: steps.authorized,
      car: steps.car_detected,
      synced: steps.synced,
    };
    let activeMarked = false;
    for (const key of STEP_ORDER) {
      const li = document.querySelector(`li[data-step="${key}"]`);
      const state = li.querySelector('[data-state]');
      li.classList.remove('done', 'active');
      if (doneMap[key]) {
        li.classList.add('done');
        if (state) { state.textContent = key === 'token' ? '' : '已完成'; }
      } else if (!activeMarked && key !== 'token') {
        li.classList.add('active');
        if (state) { state.textContent = '进行中'; state.className = 'step-state wait'; }
        activeMarked = true;
      } else if (state) {
        state.textContent = '';
      }
    }
  }

  function renderStatus(s) {
    $('control-settings-entry').style.display = s.role === 'admin' ? '' : 'none';
    $('acct-user-name').textContent = s.user || '—';
    if (s.role === 'admin') loadCertInfo();

    const banner = $('tesla-banner');
    if (s.tesla.authorized) {
      banner.className = 'tesla-banner ok';
      $('tesla-banner-text').textContent = 'Tesla 账号已授权';
      $('tesla-banner-sub').textContent =
        s.tesla.token_updated_ts ? `令牌最近刷新:${fmtAgo(s.tesla.token_updated_ts)}` : '';
    } else {
      banner.className = 'tesla-banner pending';
      $('tesla-banner-text').textContent = '尚未授权 Tesla 账号';
      $('tesla-banner-sub').textContent = '按下方步骤完成授权';
    }

    renderSteps(s.steps || {});

    if (s.cars && s.cars.length) {
      const c = s.cars[0];
      $('car-detect-desc').textContent =
        `已识别:${c.name || '未命名车辆'}(VIN 后 6 位 ${c.vin_tail || '—'})`;
    }

    if (s.sync && s.sync.positions > 0) {
      $('sync-stats').hidden = false;
      $('stat-positions').textContent = s.sync.positions.toLocaleString();
      $('stat-drives').textContent = s.sync.drives.toLocaleString();
      $('stat-charges').textContent = s.sync.charges.toLocaleString();
      $('stat-last').textContent = fmtAgo(s.sync.last_data_ts);
    }

    renderUsers(s.users || [], s.user);
  }

  function renderUsers(users, me) {
    const ul = $('user-list');
    ul.textContent = '';
    for (const u of users) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = u;
      li.appendChild(name);
      if (u === me) {
        const tag = document.createElement('span');
        tag.className = 'me-tag';
        tag.textContent = '当前登录';
        li.appendChild(tag);
      }
      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      li.appendChild(spacer);
      if (u !== me && users.length > 1) {
        const btn = document.createElement('button');
        btn.className = 'btn danger';
        btn.textContent = '删除';
        btn.onclick = () => removeUser(u);
        li.appendChild(btn);
      }
      ul.appendChild(li);
    }
  }

  async function api(path, opts) {
    const resp = await fetch(path, opts);
    if (resp.status === 401) {  // 会话失效:回登录页
      location.href = '/login?next=/account.html';
      throw new Error('未登录');
    }
    if (!resp.ok) {
      let detail = `请求失败(${resp.status})`;
      try { detail = (await resp.json()).detail || detail; } catch (_) { /* 忽略 */ }
      throw new Error(detail);
    }
    return resp.json();
  }

  // 退出登录:清除会话 Cookie 后回登录页
  $('logout-btn').onclick = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) { /* 忽略 */ }
    location.href = '/login';
  };

  let pollTimer = null;
  async function loadStatus() {
    try {
      const s = await api('/api/account/status');
      renderStatus(s);
      const allDone = s.steps && s.steps.authorized && s.steps.car_detected && s.steps.synced;
      if (allDone && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } catch (e) {
      $('tesla-banner-text').textContent = e.message;
    }
  }

  function msg(el, text, ok) {
    el.textContent = text;
    el.className = `form-msg ${ok ? 'ok' : 'err'}`;
  }

  $('pw-submit').onclick = async () => {
    const cur = $('pw-current').value;
    const nw = $('pw-new').value;
    const nw2 = $('pw-new2').value;
    const m = $('pw-msg');
    if (nw !== nw2) return msg(m, '两次输入的新密码不一致', false);
    try {
      await api('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: cur, new_password: nw }),
      });
      msg(m, '✓ 修改成功,即将回到登录页,请用新密码重新登录', true);
      setTimeout(async () => {
        try { await fetch('/api/logout', { method: 'POST' }); } catch (_) { /* 忽略 */ }
        location.href = '/login';
      }, 1800);
    } catch (e) {
      msg(m, e.message, false);
    }
  };

  $('nu-submit').onclick = async () => {
    const username = $('nu-name').value.trim();
    const password = $('nu-pass').value;
    const m = $('nu-msg');
    try {
      await api('/api/account/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      msg(m, `✓ 已添加账号 ${username}`, true);
      $('nu-name').value = '';
      $('nu-pass').value = '';
      loadStatus();
    } catch (e) {
      msg(m, e.message, false);
    }
  };

  async function removeUser(name) {
    if (!confirm(`确定删除账号「${name}」?`)) return;
    try {
      await api(`/api/account/users/${encodeURIComponent(name)}`, { method: 'DELETE' });
      loadStatus();
    } catch (e) {
      alert(e.message);
    }
  }

  /* ---------- iPhone 免密(设备证书) ---------- */
  let certLoaded = false;
  async function loadCertInfo() {
    if (certLoaded) return;
    certLoaded = true;
    const card = $('card-device-cert');
    try {
      const info = await api('/api/device/cert/info');
      if (!info.enabled) return;  // 免密通道未配置:卡片保持隐藏
      card.style.display = '';
      if (info.available) {
        $('dc-password').textContent = info.export_password || '(见服务器 data/pki/EXPORT_PASSWORD.txt)';
      } else {
        $('dc-download').style.display = 'none';
        $('dc-password').textContent = '—';
        msg($('dc-msg'), '设备证书尚未生成:请在服务器上运行 scripts/make-device-cert.sh', false);
      }
    } catch (e) {
      card.style.display = '';
      msg($('dc-msg'), e.message, false);
    }
  }

  /* 数据备份 / 迁移已迁至二级页 /backup.html(backup.js) */

  /* 显示偏好:默认时间范围(存服务端按账号隔离;localStorage 缓存供面板秒开) */
  const daysSeg = $('days-seg');
  const DAYS = [1, 7, 30];
  function markDays(d) {
    daysSeg.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', Number(b.dataset.days) === d));
  }
  daysSeg.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const d = Number(btn.dataset.days);
    markDays(d);
    localStorage.setItem('ttv-days', String(d));  // 面板下次打开即刻生效
    try {
      await api('/api/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: d }),
      });
      msg($('days-msg'), '已保存', true);
    } catch (err) {
      msg($('days-msg'), err.message, false);
    }
  });
  (async () => {
    try {
      const p = await api('/api/prefs');
      const d = DAYS.includes(p.days) ? p.days : 7;
      markDays(d);
      localStorage.setItem('ttv-days', String(d));
    } catch (e) {
      msg($('days-msg'), e.message, false);
    }
  })();

  loadStatus();
  pollTimer = setInterval(loadStatus, 15000); // 授权完成前每 15 秒自动刷新状态

  /* 车辆信息:提车日期(与总览页「已陪伴 N 天」同一数据源 /api/vehicle/delivery;
     总览页只在未设置时提供入口,修改/清除统一在这里) */
  const delDateInp = $('delivery-date');
  (async () => {
    try {
      const r = await api('/api/vehicle/delivery');
      if (r.date) delDateInp.value = r.date;
    } catch (e) {
      msg($('delivery-msg'), e.message, false);
    }
  })();
  const submitDelivery = async (date) => {
    const m = $('delivery-msg');
    try {
      await api('/api/vehicle/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      msg(m, date ? '✓ 已保存,总览页将显示陪伴天数' : '✓ 已清除', true);
    } catch (e) {
      msg(m, e.message, false);
    }
  };
  $('delivery-save').onclick = () => {
    if (!delDateInp.value) { delDateInp.focus(); return; }
    submitDelivery(delDateInp.value);
  };
  $('delivery-clear').onclick = () => {
    delDateInp.value = '';
    submitDelivery('');
  };
})();
