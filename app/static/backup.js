/* 数据备份二级页:按月备份(生成/下载/删除/多选打包)+ 导入合并恢复 + 整库导出 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  async function api(path, opts) {
    const resp = await fetch(path, opts);
    if (resp.status === 401) {
      location.href = '/login?next=/backup.html';
      throw new Error('未登录');
    }
    if (resp.status === 403) {
      throw new Error('需要管理员权限');
    }
    if (!resp.ok) {
      let detail = `请求失败(${resp.status})`;
      try { detail = (await resp.json()).detail || detail; } catch (_) { /* 忽略 */ }
      throw new Error(detail);
    }
    return resp.json();
  }

  function msg(el, text, ok) {
    el.textContent = text;
    el.className = `form-msg ${ok ? 'ok' : 'err'}`;
  }

  function fmtSize(bytes) {
    if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
    if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  function fmtMonth(m) {
    return `${parseInt(m.slice(0, 4), 10)}年${parseInt(m.slice(5), 10)}月`;
  }

  /* ---------- 按月备份 ---------- */
  const listEl = $('month-list');
  const bkMsg = $('bk-msg');
  let monthsData = [];

  function selectedMonths() {
    return [...listEl.querySelectorAll('.month-check[data-month]:checked')]
      .map((c) => c.dataset.month);
  }

  function refreshSelBtn() {
    const n = selectedMonths().length;
    const btn = $('bk-dl-sel');
    btn.disabled = n === 0;
    btn.textContent = n ? `⬇ 下载选中 (${n})` : '⬇ 下载选中';
    const backed = monthsData.filter((m) => m.backup).length;
    const checked = listEl.querySelectorAll('.month-check[data-month]:checked').length;
    $('bk-all').checked = backed > 0 && checked === backed;
  }

  function renderMonths() {
    listEl.textContent = '';
    if (!monthsData.length) {
      const li = document.createElement('li');
      li.textContent = '暂无数据';
      li.style.color = 'var(--text-muted)';
      listEl.appendChild(li);
      return;
    }
    for (const m of monthsData) {
      const li = document.createElement('li');

      if (m.backup) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'month-check';
        cb.dataset.month = m.month;
        cb.onchange = refreshSelBtn;
        li.appendChild(cb);
      } else {
        const spacer = document.createElement('span');
        spacer.style.width = '16px';
        li.appendChild(spacer);
      }

      const name = document.createElement('span');
      name.className = 'month-name';
      name.textContent = fmtMonth(m.month);
      li.appendChild(name);
      if (m.is_current) {
        const cur = document.createElement('span');
        cur.className = 'month-cur';
        cur.textContent = '进行中';
        li.appendChild(cur);
      }

      const info = document.createElement('span');
      info.className = `month-info${m.backup ? ' backed' : ''}`;
      if (m.backup) {
        const rows = Object.values(m.backup.tables || {}).reduce((a, b) => a + b, 0);
        info.textContent = `已备份 · ${fmtSize(m.backup.size)} · ${(m.backup.created_at || '').slice(0, 16)} 生成 · ${rows.toLocaleString()} 行`;
      } else {
        info.textContent = '未备份';
      }
      li.appendChild(info);

      const actions = document.createElement('span');
      actions.className = 'month-actions';

      const gen = document.createElement('button');
      gen.className = 'btn ghost sm';
      gen.textContent = m.backup ? '重新生成' : '生成';
      gen.onclick = () => generate(m.month, gen);
      actions.appendChild(gen);

      if (m.backup) {
        const dl = document.createElement('button');
        dl.className = 'btn ghost sm';
        dl.textContent = '下载';
        dl.onclick = () => downloadMonths([m.month]);
        actions.appendChild(dl);

        const del = document.createElement('button');
        del.className = 'btn danger sm';
        del.textContent = '删除';
        del.onclick = () => remove(m.month);
        actions.appendChild(del);
      }
      li.appendChild(actions);
      listEl.appendChild(li);
    }
    refreshSelBtn();
  }

  async function load() {
    try {
      const data = await api('/api/backup/monthly');
      monthsData = data.months || [];
      renderMonths();
    } catch (e) {
      msg(bkMsg, e.message, false);
    }
  }

  async function generate(month, btn) {
    btn.disabled = true;
    msg(bkMsg, `正在生成 ${fmtMonth(month)} 的备份…`, true);
    try {
      const mf = await api('/api/backup/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      msg(bkMsg, `✓ ${fmtMonth(month)} 备份完成(${fmtSize(mf.size)})`, true);
      await load();
    } catch (e) {
      msg(bkMsg, e.message, false);
    } finally {
      btn.disabled = false;
    }
  }

  async function downloadMonths(months) {
    msg(bkMsg, '正在下载…', true);
    try {
      const resp = await fetch(`/api/backup/monthly/download?months=${months.join(',')}`);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `下载失败 (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = months.length === 1
        ? `tesla-home-backup-${months[0]}.tar.gz`
        : `tesla-home-backups-${months.length}个月.tar.gz`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msg(bkMsg, '备份已交给浏览器下载，请确认文件已保存', true);
    } catch (e) {
      msg(bkMsg, e.message, false);
    }
  }

  async function remove(month) {
    if (!confirm(`确定删除 ${fmtMonth(month)} 的备份文件？此操作不可撤销。`)) return;
    try {
      await api(`/api/backup/monthly/${month}`, { method: 'DELETE' });
      msg(bkMsg, `✓ 已删除 ${fmtMonth(month)} 的备份`, true);
      await load();
    } catch (e) {
      msg(bkMsg, e.message, false);
    }
  }

  $('bk-all').onchange = () => {
    const on = $('bk-all').checked;
    listEl.querySelectorAll('.month-check[data-month]').forEach((c) => { c.checked = on; });
    refreshSelBtn();
  };

  $('bk-dl-sel').onclick = () => {
    const sel = selectedMonths();
    if (sel.length) downloadMonths(sel);
  };

  /* ---------- 导入月度备份 ---------- */
  $('imp-submit').onclick = async () => {
    const file = $('imp-file').files[0];
    const m = $('imp-msg');
    if (!file) { msg(m, '请先选择备份文件', false); return; }
    const btn = $('imp-submit');
    btn.disabled = true;
    msg(m, '正在上传并分析备份月份…', true);
    try {
      const form = new FormData();
      form.append('file', file);
      const resp = await fetch('/api/backup/monthly/import', { method: 'POST', body: form });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.detail || `导入失败 (${resp.status})`);
      const rows = Object.entries(data.inserted || {})
        .map(([t, n]) => `${t} +${n}`).join('，');
      msg(m, `✓ 识别为 ${fmtMonth(data.month)},合并恢复完成:${rows || '无新增数据'}。${data.note || ''}`, true);
      $('imp-file').value = '';
      await load();
    } catch (e) {
      msg(m, e.message, false);
    } finally {
      btn.disabled = false;
    }
  };

  /* ---------- 整库导出 / 迁移 ---------- */
  $('bk-export').onclick = async () => {
    const password = $('bk-password').value;
    const m = $('full-msg');
    if (!password) { msg(m, '请先填写当前面板密码，再点击导出', false); $('bk-password').focus(); return; }
    const btn = $('bk-export');
    btn.disabled = true;
    msg(m, '正在生成整库备份，请等待下载完成…', true);
    try {
      const resp = await fetch('/api/backup/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `导出失败 (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tesla-home-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msg(m, '备份已生成并交给浏览器下载，请确认文件已保存', true);
    } catch (e) {
      msg(m, e.message, false);
    } finally {
      $('bk-password').value = '';
      btn.disabled = false;
    }
  };

  $('bk-import-note').onclick = () =>
    msg($('full-msg'), '整库恢复需要在服务器维护期间执行，操作说明见仓库 docs/MAINTENANCE.md', false);

  load();
})();
