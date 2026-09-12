import { LEVEL_NAME, STATUS_NAME, LEVELS } from '../config.js';

// 顶部 KPI、左侧聚焦面板、右侧告警、底部控制条
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString();

export function initPanels(h) {
  const kpis = $('kpis'), alertList = $('alert-list'), alertCount = $('alert-count'), focusPanel = $('focus-panel'), legend = $('legend'), crumb = $('crumb');
  const flowList = $('flow-list'), flowCount = $('flow-count'), layerTabs = $('layer-tabs'), compPanel = $('comp-panel');
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
        return `<div class="kpi clickable ${s.layer === level ? 'on' : ''}" data-layer="${level}" title="点击只看${LEVEL_NAME[level]}层" style="--accent: var(--${level})"><div class="k-label">${LEVEL_NAME[level]}</div><div class="k-value">${x.count}</div>${note}</div>`;
      };
      kpis.innerHTML = `
        ${lv('core')}${lv('important')}${lv('general')}
        <div class="kpi" style="--accent: #3aa6ff"><div class="k-label">业务连接</div><div class="k-value">${s.links.total}<small>活跃 ${s.links.active}</small></div><div class="k-note">${s.links.transient ? `临时连接 ${s.links.transient}` : '无临时连接'}</div></div>
        <div class="kpi" style="--accent: #9ad1ff"><div class="k-label">在线终端</div><div class="k-value">${fmt(s.terminals)}</div><div class="k-note">远端 ${fmt(s.remoteTerminals)}</div></div>
        <div class="kpi ${s.alerts ? 'alarm' : ''}" style="--accent: ${s.alerts ? 'var(--critical)' : 'var(--ok)'}"><div class="k-label">异常关注</div><div class="k-value">${s.alerts}</div><div class="k-note ${s.criticals ? 'bad' : s.alerts ? 'warn' : ''}">${s.criticals ? `${s.criticals} 项严重` : s.alerts ? '需关注' : '全网正常'}</div></div>`;
      for (const el of kpis.querySelectorAll('.kpi.clickable')) el.onclick = () => h.onKpiLayer(el.dataset.layer);
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

    // 层级切换：当前层高亮，显示业务数与异常数
    setLayerTabs(byLevel, current) {
      const rows = [...LEVELS.map((lv) => ({ key: lv, name: LEVEL_NAME[lv] + '层', c: byLevel[lv] })), { key: 'all', name: '全部层级', c: null }];
      layerTabs.innerHTML = rows.map((r) => {
        const st = !r.c ? '' : r.c.critical ? `<span class="st critical">故障 ${r.c.critical}</span>` : r.c.warning ? `<span class="st warning">告警 ${r.c.warning}</span>` : '<span class="st ok">正常</span>';
        return `<div class="ltab ${current === r.key ? 'on' : ''}" data-layer="${r.key}" style="--c: var(--${r.key === 'all' ? 'fg-dim' : r.key})"><span class="bar"></span><span>${r.name}</span><span class="cnt">${r.c ? r.c.count : ''}</span>${st}</div>`;
      }).join('');
      for (const el of layerTabs.querySelectorAll('.ltab')) el.onclick = () => h.onLayer(el.dataset.layer);
    },

    // 组件状态卡（局部视图中点击组件）
    showComponent(c, b, info) {
      compPanel.classList.remove('hidden');
      const bar = (label, v, unit = '%') => `<div class="meter"><span>${label}</span><span class="track"><span class="fill ${v > 90 ? 'critical' : v > 75 ? 'warning' : ''}" style="width:${Math.min(100, v)}%"></span></span><span class="val">${v}${unit}</span></div>`;
      const st = c.status;
      compPanel.innerHTML = `
        <div class="panel-title">组件状态 <span class="cp-close" title="关闭">×</span></div>
        <div class="cp-head"><span class="cp-name">${c.name}</span><span class="tag ${st}">${STATUS_NAME[st]}</span></div>
        <div class="cp-sub">${b.name} · ${c.type.toUpperCase()} · ${c.version}</div>
        ${c.message ? `<div class="cp-msg ${st}">⚠ ${c.message}</div>` : ''}
        <div class="cp-grid">
          <div class="cp-stat"><b>${c.instances}<small style="font-size:10px;color:var(--fg-faint)"> / ${st === 'critical' ? Math.max(0, c.instances - Math.ceil(c.instances / 2)) : st === 'warning' ? c.instances - 1 : c.instances} 健康</small></b><span>实例</span></div>
          <div class="cp-stat"><b class="${st === 'warning' ? 'warning' : ''}">${st === 'warning' ? c.metrics.latency * 6 : c.metrics.latency} ms</b><span>时延 P95</span></div>
          <div class="cp-stat"><b>${c.metrics.qps.toLocaleString()}/s</b><span>请求量</span></div>
          <div class="cp-stat"><b class="${st === 'critical' ? 'critical' : ''}">${st === 'critical' ? (12 + Math.random() * 30).toFixed(1) : c.metrics.errorRate}%</b><span>错误率</span></div>
        </div>
        ${bar('CPU', st === 'warning' && /CPU/.test(c.message) ? 94 : c.cpu)}
        ${bar('内存', c.mem)}
        <div class="cp-rel" style="margin-top:8px">
          <div class="r"><span class="k">上游</span><span class="v">${info.upstream.length ? info.upstream.map((u) => `<span class="${u.status}">${u.name}</span>`).join(' · ') : '—'}</span></div>
          <div class="r"><span class="k">下游</span><span class="v">${info.downstream.length ? info.downstream.map((u) => `<span class="${u.status}">${u.name}</span>`).join(' · ') : '—'}</span></div>
          <div class="r"><span class="k">终端</span><span class="v">${info.terminals ? `约 ${info.terminals.toLocaleString()} 个本地终端接入` : '不直接接入终端'}</span></div>
        </div>
        <div class="fp-sub">最近事件</div>
        <div class="cp-events">${c.events.slice(0, 4).map((e) => `<div class="e ${e.status || ''}"><span class="t">${e.time}</span><span class="txt">${e.text}</span></div>`).join('')}</div>`;
      compPanel.querySelector('.cp-close').onclick = () => h.onCloseComponent();
    },
    hideComponent() { compPanel.classList.add('hidden'); },

    // 当前正在流转的连接（按频次排序，最多 10 条），按 id 增量更新避免闪动
    setFlows(flows, total, pinnedId) {
      flowCount.textContent = total;
      if (!flows.length) { if (!flowList.querySelector('.flow-empty')) flowList.innerHTML = '<div class="flow-empty">当前没有数据流转</div>'; return; }
      flowList.querySelector('.flow-empty')?.remove();
      const keep = new Set(flows.map((f) => f.id));
      for (const el of [...flowList.querySelectorAll('.flow')]) if (!keep.has(el.dataset.id)) el.remove();
      flows.forEach((f, i) => {
        let el = flowList.querySelector(`.flow[data-id="${f.id}"]`);
        if (!el) {
          el = document.createElement('div'); el.className = 'flow'; el.dataset.id = f.id;
          el.innerHTML = `<span class="fn from"></span><span class="fa"></span><span class="fn to"></span><span class="fr"></span><span class="st"></span>`;
          el.onmouseenter = () => h.onFlowHover(f.id); el.onmouseleave = () => h.onFlowHover(null); el.onclick = () => h.onFlowClick(f.id);
        }
        const [fromEl, arrowEl, toEl, rateEl, stEl] = el.children;
        fromEl.textContent = f.from; toEl.textContent = f.to; arrowEl.textContent = f.dir; rateEl.textContent = `${f.rate}/min`; stEl.className = `st ${f.status}`;
        el.title = `${f.from} ${f.dir} ${f.to} · ${f.type}`;
        el.classList.toggle('pinned', f.id === pinnedId);
        if (flowList.children[i] !== el) flowList.insertBefore(el, flowList.children[i] || null);
      });
      let more = flowList.querySelector('.flow-more');
      if (total > flows.length) { if (!more) { more = document.createElement('div'); more.className = 'flow-more'; } more.textContent = `还有 ${total - flows.length} 条正在流转`; flowList.appendChild(more); }
      else more?.remove();
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
