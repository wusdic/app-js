import { LEVEL_NAME, STATUS_NAME } from '../config.js';

// 顶部 KPI、左侧聚焦面板、右侧告警、底部控制条
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString();

export function initPanels(h) {
  const kpis = $('kpis'), alertList = $('alert-list'), alertCount = $('alert-count'), focusPanel = $('focus-panel'), legend = $('legend'), crumb = $('crumb');
  const btnBack = $('btn-back');

  btnBack.onclick = () => h.onBack();
  $('btn-reset').onclick = () => h.onReset();
  for (const [id, key] of [['btn-rotate', 'rotate'], ['btn-terminals', 'terminals'], ['btn-bloom', 'bloom']]) {
    const b = $(id);
    b.onclick = () => { b.classList.toggle('on'); h.onToggle(key, b.classList.contains('on')); };
  }
  const tick = () => {
    const d = new Date();
    $('clock').textContent = d.toTimeString().slice(0, 8);
    $('date').textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${'日一二三四五六'.split('').map((c) => '星期' + c)[d.getDay()]}`;
  };
  tick(); setInterval(tick, 1000);

  let lastKPI = '';
  return {
    setKPIs(s) {
      const sig = JSON.stringify(s); if (sig === lastKPI) return; lastKPI = sig;
      const lv = (level) => {
        const x = s.byLevel[level];
        const note = x.critical ? `<div class="k-note bad">故障 ${x.critical}${x.warning ? ` · 告警 ${x.warning}` : ''}</div>` : x.warning ? `<div class="k-note warn">告警 ${x.warning}</div>` : '<div class="k-note">运行正常</div>';
        return `<div class="kpi" style="--accent: var(--${level})"><div class="k-label">${LEVEL_NAME[level]}</div><div class="k-value">${x.count}</div>${note}</div>`;
      };
      kpis.innerHTML = `
        ${lv('core')}${lv('important')}${lv('general')}
        <div class="kpi" style="--accent: #3aa6ff"><div class="k-label">业务连接</div><div class="k-value">${s.links.total}<small>活跃 ${s.links.active}</small></div><div class="k-note">${s.links.transient ? `临时连接 ${s.links.transient}` : '无临时连接'}</div></div>
        <div class="kpi" style="--accent: #9ad1ff"><div class="k-label">在线终端</div><div class="k-value">${fmt(s.terminals)}</div><div class="k-note">远端 ${fmt(s.remoteTerminals)}</div></div>
        <div class="kpi ${s.alerts ? 'alarm' : ''}" style="--accent: ${s.alerts ? 'var(--critical)' : 'var(--ok)'}"><div class="k-label">异常关注</div><div class="k-value">${s.alerts}</div><div class="k-note ${s.criticals ? 'bad' : s.alerts ? 'warn' : ''}">${s.criticals ? `${s.criticals} 项严重` : s.alerts ? '需关注' : '全网正常'}</div></div>`;
    },

    setAlerts(alerts) {
      alertCount.textContent = alerts.length;
      alertCount.classList.toggle('alarm', alerts.length > 0);
      if (!alerts.length) { if (!alertList.querySelector('.alert-empty')) alertList.innerHTML = '<div class="alert-empty"><i></i>当前无异常，全网运行平稳</div>'; return; }
      alertList.querySelector('.alert-empty')?.remove();
      const now = Date.now();
      const keep = new Set(alerts.map((a) => a.id));
      for (const el of [...alertList.children]) if (!keep.has(el.dataset.id)) el.remove();
      alerts.forEach((a, i) => {
        const dur = Math.max(0, Math.round((now - a.since) / 1000));
        const durTxt = dur < 60 ? `${dur} 秒` : `${Math.floor(dur / 60)} 分 ${dur % 60} 秒`;
        let el = alertList.querySelector(`[data-id="${a.id}"]`);
        if (!el) {
          el = document.createElement('div');
          el.dataset.id = a.id;
          el.innerHTML = `<div class="a-head"><span class="a-name"></span><span class="tag"></span><span class="tag"></span></div><div class="a-msg"></div><div class="a-time"></div>`;
          el.onclick = () => h.onAlertClick(a.id);
        }
        el.className = `alert ${a.status}`;
        const [nameEl, lvEl, stEl] = el.querySelectorAll('.a-head > *');
        nameEl.textContent = a.name; lvEl.className = `tag ${a.level}`; lvEl.textContent = LEVEL_NAME[a.level]; stEl.className = `tag ${a.status}`; stEl.textContent = STATUS_NAME[a.status];
        el.querySelector('.a-msg').textContent = `${a.kind === 'link' ? '连接 · ' : ''}${a.message}`;
        el.querySelector('.a-time').textContent = `持续 ${durTxt}`;
        if (alertList.children[i] !== el) alertList.insertBefore(el, alertList.children[i] || null);
      });
    },

    showFocus(b, rels) {
      legend.classList.add('hidden'); focusPanel.classList.remove('hidden'); btnBack.classList.remove('hidden');
      const relRows = rels.map((r) => `<div class="rel" data-id="${r.other.id}"><span class="dir">${r.dir}</span><span class="name">${r.other.name}</span><span class="tag ${r.other.level}">${LEVEL_NAME[r.other.level].slice(0, 2)}</span><span class="rate">${r.rate}/min</span><span class="st ${r.status}"></span></div>`).join('');
      focusPanel.innerHTML = `
        <div class="panel-title">当前业务</div>
        <div class="fp-head"><span class="fp-name">${b.name}</span><span class="tag ${b.level}">${LEVEL_NAME[b.level]}</span><span class="tag ${b.status}">${STATUS_NAME[b.status]}</span></div>
        <div class="fp-dept">${b.dept} · 负责人 ${b.owner} · 上线 ${b.since}</div>
        <div class="fp-stats">
          <div class="fp-stat"><b>${b.components.length}</b><span>组件</span></div>
          <div class="fp-stat"><b>${fmt(b.terminals.local)}</b><span>本地终端</span></div>
          <div class="fp-stat"><b>${fmt(b.terminals.remote)}</b><span>远端终端</span></div>
        </div>
        ${b.statusMessage ? `<div class="fp-dept" style="color:var(--${b.status})">⚠ ${b.statusMessage}</div>` : ''}
        <div class="fp-sub">关联业务 · ${rels.length}</div>
        <div class="rel-list">${relRows || '<div class="rel terminal">暂无业务连接</div>'}<div class="rel terminal"><span class="dir">◌</span><span class="name">远端终端（示意）</span><span class="rate">${fmt(b.terminals.remote)}</span></div></div>
        <div class="hint">点击关联业务可跳转 · Esc 返回全网</div>`;
      for (const el of focusPanel.querySelectorAll('.rel[data-id]')) el.onclick = () => h.onNavigate(el.dataset.id);
    },

    hideFocus() { legend.classList.remove('hidden'); focusPanel.classList.add('hidden'); btnBack.classList.add('hidden'); },

    setCrumb(items) { crumb.innerHTML = items.map((t) => `<span>${t}</span>`).join('<span class="sep">›</span>'); },
  };
}
