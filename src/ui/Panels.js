import { LEVEL_NAME, STATUS_NAME, LEVELS } from '../config.js';

// 顶部 KPI、层级切换、关键依赖、告警、实时流转、聚焦 / 组件卡、底部控制：全部按 key 增量更新，避免鼠标下的元素被重建
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const setText = (el, t) => { if (el && el.textContent !== String(t)) el.textContent = t; };
const setClass = (el, cls) => { if (el && el.className !== cls) el.className = cls; };
const durText = (sec) => (sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`);

// 按 data-id 增量同步列表：保留 DOM 节点，只更新文本与顺序；鼠标悬停在列表上时冻结排序
function syncList(container, items, { create, update, hoverFreeze = true, tail = null }) {
  const keep = new Set(items.map((x) => String(x.id)));
  for (const el of [...container.children]) if (el.dataset.id && !keep.has(el.dataset.id)) { if (el.matches(':hover')) el.onmouseleave?.(); el.remove(); }
  const frozen = hoverFreeze && container.matches(':hover');
  items.forEach((it, i) => {
    const id = String(it.id);
    let el = container.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el) { el = create(it); el.dataset.id = id; el.classList.add('enter'); el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true }); container.appendChild(el); }
    update(el, it);
    if (!frozen && container.children[i] !== el) container.insertBefore(el, container.children[i] || null);
  });
  const old = container.querySelector('.list-tail');
  if (tail) { const t = old || document.createElement('div'); t.className = 'list-tail ' + tail.cls; t.textContent = tail.text; container.appendChild(t); } else old?.remove();
}

export function initPanels(h) {
  const kpis = $('kpis'), alertList = $('alert-list'), alertCount = $('alert-count'), focusPanel = $('focus-panel'), legend = $('legend'), crumb = $('crumb');
  const flowList = $('flow-list'), flowCount = $('flow-count'), layerTabs = $('layer-tabs'), layerHint = $('layer-hint'), compPanel = $('comp-panel'), hubList = $('hub-list');
  const btnBack = $('btn-back'), spotChip = $('spot-chip'), ticker = $('ticker'), banner = $('banner'), searchInput = $('search'), searchResults = $('search-results');

  btnBack.onclick = () => h.onBack();
  $('btn-reset').onclick = () => h.onReset();
  const settings = $('settings');
  $('btn-settings').onclick = (e) => { e.stopPropagation(); settings.classList.toggle('hidden'); };
  document.addEventListener('click', (e) => { if (!settings.contains(e.target)) settings.classList.add('hidden'); });
  for (const sw of settings.querySelectorAll('.sw')) sw.onclick = () => { sw.classList.toggle('on'); h.onToggle(sw.dataset.key, sw.classList.contains('on')); };
  for (const b of settings.querySelectorAll('#quality-seg button')) b.onclick = () => { h.onQuality(b.dataset.q); };
  legend.querySelector('.panel-title').onclick = () => { legend.classList.toggle('collapsed'); legend.querySelector('.kbd-hint').textContent = legend.classList.contains('collapsed') ? '展开 ▾' : '收起 ▴'; };

  // 搜索：输入即匹配，↑↓ 选择，Enter 进入，Shift+Enter 固定聚光，Esc 清空
  let srIndex = 0, srItems = [];
  const renderSearch = () => {
    if (!srItems.length) { searchResults.classList.add('hidden'); return; }
    searchResults.classList.remove('hidden');
    searchResults.innerHTML = srItems.map((r, i) => `<div class="sr ${i === srIndex ? 'on' : ''}" data-id="${esc(r.id)}"><span class="st ${r.status}"></span><span class="n">${esc(r.name)}</span><span class="d">${LEVEL_NAME[r.level]} · ${esc(r.dept)}</span></div>`).join('');
    for (const el of searchResults.querySelectorAll('.sr')) { el.onclick = (e) => h.onSearchPick(el.dataset.id, e.shiftKey); el.onmouseenter = () => h.onSearchHover(el.dataset.id); }
  };
  searchInput.oninput = () => { srItems = h.onSearch(searchInput.value.trim()); srIndex = 0; renderSearch(); };
  searchInput.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { srIndex = Math.min(srItems.length - 1, srIndex + 1); renderSearch(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { srIndex = Math.max(0, srIndex - 1); renderSearch(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = srItems[srIndex]; if (r) h.onSearchPick(r.id, e.shiftKey); }
    else if (e.key === 'Escape') { searchInput.value = ''; srItems = []; renderSearch(); searchInput.blur(); h.onSearch(''); }
  };
  searchResults.onmouseleave = () => h.onSearchHover(null);
  searchInput.onblur = () => setTimeout(() => searchResults.classList.add('hidden'), 150);
  searchInput.onfocus = () => { if (srItems.length) searchResults.classList.remove('hidden'); };

  const tick = () => {
    const d = new Date();
    setText($('clock'), d.toTimeString().slice(0, 8));
    setText($('date'), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${'日一二三四五六'.split('').map((c) => '星期' + c)[d.getDay()]}`);
  };
  tick(); setInterval(tick, 1000);

  // KPI：只建一次 DOM，之后按字段更新
  let kpiBuilt = false;
  function buildKPIs() {
    kpis.innerHTML = `
      <div class="kpi health" id="k-health"><div class="k-label">全网健康度</div><div class="k-value"><span class="score">--</span><small>/ 100</small></div><div class="k-note"></div></div>
      <div class="kpi alerts" id="k-alerts"><div class="k-label">异常关注</div><div class="k-value"><b class="c">0</b><small class="w"></small></div><div class="k-note"></div></div>
      ${LEVELS.map((lv) => `<div class="kpi clickable" id="k-${lv}" data-layer="${lv}" title="点击只看${LEVEL_NAME[lv]}层" style="--accent: var(--${lv})"><div class="k-label">${LEVEL_NAME[lv]}</div><div class="k-value"><span class="ok">0</span><small class="tot">/ 0</small></div><div class="k-bar"><i class="ok"></i><i class="warning"></i><i class="critical"></i></div></div>`).join('')}
      <div class="kpi" id="k-term" style="--accent: #7fa9d6"><div class="k-label">在线终端</div><div class="k-value"><span class="n">0</span></div><div class="k-note"></div></div>`;
    for (const el of kpis.querySelectorAll('.kpi.clickable')) el.onclick = () => h.onKpiLayer(el.dataset.layer);
    kpiBuilt = true;
  }

  return {
    setKPIs(s) {
      if (!kpiBuilt) buildKPIs();
      const hk = $('k-health');
      setText(hk.querySelector('.score'), s.score);
      setClass(hk, `kpi health ${s.score >= 95 ? 'good' : s.score >= 80 ? 'warn' : 'bad'}`);
      const d = s.scoreDelta;
      setText(hk.querySelector('.k-note'), d === null ? '采样中' : d === 0 ? '较 10 分钟前持平' : `较 10 分钟前 ${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`);
      setClass(hk.querySelector('.k-note'), `k-note ${d > 0 ? 'good' : d < 0 ? 'bad' : ''}`);
      const ak = $('k-alerts');
      setText(ak.querySelector('.c'), s.criticals); setText(ak.querySelector('.w'), s.warnings ? ` 故障 · ${s.warnings} 告警` : ' 故障');
      setClass(ak, `kpi alerts ${s.criticals ? 'bad' : s.warnings ? 'warn' : 'good'}`);
      setText(ak.querySelector('.k-note'), s.criticals ? '需立即处置' : s.warnings ? '需关注' : '全网正常');
      setClass(ak.querySelector('.k-note'), `k-note ${s.criticals ? 'bad' : s.warnings ? 'warn' : 'good'}`);
      for (const lv of LEVELS) {
        const x = s.byLevel[lv], el = $(`k-${lv}`), ok = x.count - x.warning - x.critical;
        setText(el.querySelector('.ok'), ok); setText(el.querySelector('.tot'), `/ ${x.count}`);
        const bars = el.querySelectorAll('.k-bar i');
        bars[0].style.width = `${(ok / x.count) * 100}%`; bars[1].style.width = `${(x.warning / x.count) * 100}%`; bars[2].style.width = `${(x.critical / x.count) * 100}%`;
        setClass(el, `kpi clickable ${s.layer === lv ? 'on' : ''} ${x.warning + x.critical === 0 && s.layer !== lv ? 'quiet' : ''}`);
      }
      const tk = $('k-term');
      setText(tk.querySelector('.n'), fmt(s.terminals));
      setText(tk.querySelector('.k-note'), `远端 ${fmt(s.remoteTerminals)}${s.terminalDelta === null ? '' : ` · 5 分钟 ${s.terminalDelta >= 0 ? '+' : ''}${fmt(s.terminalDelta)}`}`);
    },

    // 层级切换：当前层高亮，显示业务数与异常数；其它层有故障时给出提示
    setLayerTabs(byLevel, current, hint) {
      const rows = [...LEVELS.map((lv) => ({ id: lv, name: LEVEL_NAME[lv] + '层', c: byLevel[lv] })), { id: 'all', name: '全部层级', c: null }];
      syncList(layerTabs, rows, {
        hoverFreeze: false,
        create: (r) => { const el = document.createElement('div'); el.innerHTML = `<span class="bar"></span><span class="nm"></span><span class="cnt"></span><span class="st"></span>`; el.onclick = () => h.onLayer(r.id); el.style.setProperty('--c', `var(--${r.id === 'all' ? 'fg-dim' : r.id})`); return el; },
        update: (el, r) => {
          setClass(el, `ltab ${current === r.id ? 'on' : ''}`);
          setText(el.querySelector('.nm'), r.name); setText(el.querySelector('.cnt'), r.c ? r.c.count : '');
          const st = el.querySelector('.st');
          if (!r.c) { setText(st, ''); setClass(st, 'st'); }
          else if (r.c.critical) { setText(st, `故障 ${r.c.critical}`); setClass(st, 'st critical'); }
          else if (r.c.warning) { setText(st, `告警 ${r.c.warning}`); setClass(st, 'st warning'); }
          else { setText(st, '正常'); setClass(st, 'st ok'); }
        },
      });
      if (hint) { layerHint.classList.remove('hidden'); setText(layerHint, hint.text); layerHint.onclick = () => h.onLayer(hint.layer); } else layerHint.classList.add('hidden');
    },

    // 关键依赖：被依赖最多的业务
    setHubs(list) {
      syncList(hubList, list, {
        hoverFreeze: false,
        create: (x) => { const el = document.createElement('div'); el.innerHTML = `<span class="n"></span><span class="d"></span><span class="st"></span>`; el.onclick = () => h.onHubClick(x.id); el.onmouseenter = () => h.onHubHover(x.id); el.onmouseleave = () => h.onHubHover(null); return el; },
        update: (el, x) => { setClass(el, `hub ${x.status}`); el.querySelector('.n').innerHTML = `${esc(x.name)}<small>${LEVEL_NAME[x.level].slice(0, 2)}</small>`; setText(el.querySelector('.d'), `${x.dependents} 个业务依赖 · ${x.active} 条流转`); setClass(el.querySelector('.st'), `st ${x.status}`); },
      });
    },

    // 告警：影响面、新 / 持续标记、已恢复保留 60 秒；悬停在 3D 定位，点击进入局部
    setAlerts(alerts) {
      const live = alerts.filter((a) => !a.recoveredAt);
      setText(alertCount, live.length);
      alertCount.classList.toggle('alarm', live.length > 0);
      if (!alerts.length) { if (!alertList.querySelector('.alert-empty')) alertList.innerHTML = '<div class="alert-empty"><i></i>当前无异常，全网运行平稳</div>'; return; }
      alertList.querySelector('.alert-empty')?.remove();
      const now = Date.now();
      syncList(alertList, alerts, {
        create: (a) => {
          const el = document.createElement('div');
          el.innerHTML = `<div class="a-head"><span class="a-name"></span><span class="a-new hidden">新</span><span class="tag lv"></span><span class="tag st"></span></div><div class="a-msg"></div><div class="a-impact"></div><div class="a-time"></div>`;
          el.onclick = () => { if (!el.classList.contains('recovered')) h.onAlertClick(el.dataset.id); };
          el.onmouseenter = () => { if (!el.classList.contains('recovered')) h.onAlertHover(el.dataset.id); }; el.onmouseleave = () => h.onAlertHover(null);
          return el;
        },
        update: (el, a) => {
          const dur = Math.max(0, Math.round(((a.recoveredAt || now) - a.since) / 1000));
          setClass(el, `alert ${a.status} ${a.level === 'core' ? 'core' : ''} ${a.recoveredAt ? 'recovered' : ''}`);
          setText(el.querySelector('.a-name'), a.name);
          el.querySelector('.a-new').classList.toggle('hidden', !!a.recoveredAt || now - a.since > 60000);
          const lv = el.querySelector('.lv'), st = el.querySelector('.st');
          setClass(lv, `tag lv ${a.level}`); setText(lv, LEVEL_NAME[a.level]); setClass(st, `tag st ${a.status}`); setText(st, STATUS_NAME[a.status]);
          setText(el.querySelector('.a-msg'), `${a.kind === 'link' ? '连接 · ' : ''}${a.message}`);
          setText(el.querySelector('.a-impact'), a.impact ? `影响 ${a.impact.businesses} 个业务 · ${a.impact.coreDeps} 个核心 · ${fmt(a.impact.terminals)} 终端` : '');
          const t = el.querySelector('.a-time');
          if (a.recoveredAt) setText(t, `已恢复 · 持续 ${durText(dur)}`);
          else setText(t, `持续 ${durText(dur)}${a.status === 'critical' && dur > 120 ? ' · 未恢复' : a.status === 'warning' && dur > 300 ? ' · 持续 5 分+' : ''}`);
          setClass(t, `a-time ${(a.status === 'critical' && dur > 120) || (a.status === 'warning' && dur > 300) ? 'long' : ''}`);
        },
      });
    },

    // 当前正在流转的连接（按频次排序，最多 10 条）
    setFlows(flows, total, pinnedId) {
      setText(flowCount, total);
      if (!flows.length) { if (!flowList.querySelector('.flow-empty')) flowList.innerHTML = '<div class="flow-empty">当前层没有数据流转</div>'; return; }
      flowList.querySelector('.flow-empty')?.remove();
      syncList(flowList, flows, {
        create: (f) => { const el = document.createElement('div'); el.innerHTML = `<span class="fn from"></span><span class="fa"></span><span class="fn to"></span><span class="fr"></span><span class="st"></span>`; el.onmouseenter = () => h.onFlowHover(f.id); el.onmouseleave = () => h.onFlowHover(null); el.onclick = () => h.onFlowClick(f.id); return el; },
        update: (el, f) => { setClass(el, `flow ${f.id === pinnedId ? 'pinned' : ''}`); setText(el.querySelector('.from'), f.from); setText(el.querySelector('.fa'), f.dir); setText(el.querySelector('.to'), f.to); setText(el.querySelector('.fr'), `${f.rate}/min`); setClass(el.querySelector('.st'), `st ${f.status}`); el.title = `${f.from} ${f.dir} ${f.to} · ${f.type}`; },
        tail: total > flows.length ? { cls: 'flow-more', text: `还有 ${total - flows.length} 条正在流转` } : null,
      });
    },

    // 聚焦面板：切换业务时重建骨架，之后只更新字段与关联行
    showFocus(b, rels, health) {
      legend.classList.add('hidden'); $('layers-panel').classList.add('hidden'); $('hubs-panel').classList.add('hidden');
      focusPanel.classList.remove('hidden'); btnBack.classList.remove('hidden');
      if (focusPanel.dataset.id !== b.id) {
        focusPanel.dataset.id = b.id;
        focusPanel.innerHTML = `
          <div class="panel-title">当前业务</div>
          <div class="fp-head"><span class="fp-name">${esc(b.name)}</span><span class="tag ${b.level}">${LEVEL_NAME[b.level]}</span><span class="tag st"></span></div>
          <div class="fp-dept">${esc(b.dept)} · 负责人 ${esc(b.owner)} · 上线 ${esc(b.since)}</div>
          <div class="fp-msg hidden"></div><div class="fp-msg cause hidden"></div>
          <div class="fp-stats fp-health">
            <div class="fp-stat"><b class="av"></b><span>可用性 <small>目标 99.9</small></span></div>
            <div class="fp-stat"><b class="lat"></b><span>时延 P95 <small>基线 ${b.metrics.latency}ms</small></span></div>
            <div class="fp-stat"><b class="qps"></b><span>请求量 /s</span></div>
          </div>
          <div class="fp-stats">
            <div class="fp-stat"><b>${b.components.length}</b><span>组件</span></div>
            <div class="fp-stat"><b class="tl"></b><span>本地终端</span></div>
            <div class="fp-stat"><b class="tr"></b><span>远端终端</span></div>
          </div>
          <div class="fp-sub">关联业务 · <span class="rc"></span></div>
          <div class="rel-list"></div>
          <div class="hint">点击关联业务可跳转 · 滚轮拉远 / Esc 返回全网</div>`;
      }
      const st = focusPanel.querySelector('.tag.st'); setClass(st, `tag st ${b.status}`); setText(st, STATUS_NAME[b.status]);
      const msg = focusPanel.querySelector('.fp-msg:not(.cause)');
      msg.classList.toggle('hidden', !b.statusMessage); setClass(msg, `fp-msg ${b.status} ${b.statusMessage ? '' : 'hidden'}`); setText(msg, b.statusMessage ? `⚠ ${b.statusMessage}` : '');
      const cause = focusPanel.querySelector('.fp-msg.cause');
      cause.classList.toggle('hidden', !health.upstreamHint); setText(cause, health.upstreamHint || '');
      const av = focusPanel.querySelector('.av'); setText(av, `${health.availability}%`); setClass(av, `av ${Number(health.availability) < 99 ? 'critical' : Number(health.availability) < 99.9 ? 'warning' : ''}`);
      const lat = focusPanel.querySelector('.lat'); setText(lat, `${health.latency} ms`); setClass(lat, `lat ${health.latency > b.metrics.latency * 3 ? 'critical' : health.latency > b.metrics.latency * 1.5 ? 'warning' : ''}`);
      setText(focusPanel.querySelector('.qps'), fmt(health.qps));
      setText(focusPanel.querySelector('.tl'), fmt(b.terminals.local)); setText(focusPanel.querySelector('.tr'), fmt(b.terminals.remote));
      setText(focusPanel.querySelector('.rc'), rels.length);
      const list = focusPanel.querySelector('.rel-list');
      const items = [...rels.map((r) => ({ id: r.link.id, r })), { id: '__rt', terminal: true }];
      syncList(list, items, {
        create: (it) => {
          const el = document.createElement('div');
          if (it.terminal) { el.className = 'rel terminal'; el.innerHTML = `<span class="dir">◌</span><span class="name">远端终端（示意）</span><span class="rate"></span>`; return el; }
          el.innerHTML = `<span class="dir"></span><span class="name"></span><span class="tag lv"></span><span class="rate"></span><span class="st"></span>`;
          el.onclick = () => h.onRelClick(it.r.other.id); el.onmouseenter = () => h.onRelHover(it.id); el.onmouseleave = () => h.onRelHover(null);
          return el;
        },
        update: (el, it) => {
          if (it.terminal) { setText(el.querySelector('.rate'), fmt(b.terminals.remote)); return; }
          const r = it.r;
          setClass(el, `rel ${el.classList.contains('hl') ? 'hl' : ''}`);
          setText(el.querySelector('.dir'), r.dir); setText(el.querySelector('.name'), r.other.name);
          const lv = el.querySelector('.lv'); setClass(lv, `tag lv ${r.other.level}`); setText(lv, LEVEL_NAME[r.other.level].slice(0, 2));
          setText(el.querySelector('.rate'), r.link.active ? `${r.rate}/min` : '无数据');
          setClass(el.querySelector('.st'), `st ${r.status !== 'normal' ? r.status : r.link.active ? '' : 'idle'}`);
          el.title = r.other.status !== 'normal' ? `对端 ${STATUS_NAME[r.other.status]}` : '';
        },
      });
    },
    hideFocus() { legend.classList.remove('hidden'); $('layers-panel').classList.remove('hidden'); $('hubs-panel').classList.remove('hidden'); focusPanel.classList.add('hidden'); focusPanel.dataset.id = ''; btnBack.classList.add('hidden'); },
    setRelHighlight(linkId) { for (const el of focusPanel.querySelectorAll('.rel[data-id]')) el.classList.toggle('hl', el.dataset.id === linkId); },

    // 组件状态卡（局部视图中点击组件）
    showComponent(c, b, info) {
      compPanel.classList.remove('hidden');
      const bar = (label, v, unit = '%') => `<div class="meter"><span>${label}</span><span class="track"><span class="fill ${v > 90 ? 'critical' : v > 75 ? 'warning' : ''}" style="width:${Math.min(100, v)}%"></span></span><span class="val">${v}${unit}</span></div>`;
      const st = c.status;
      const healthy = st === 'critical' ? Math.max(0, c.instances - Math.ceil(c.instances / 2)) : st === 'warning' ? c.instances - 1 : c.instances;
      const cpu = st === 'warning' && /CPU/.test(c.message) ? 94 : c.cpu;
      const latency = st === 'warning' ? c.metrics.latency * 4 : st === 'critical' ? c.metrics.latency * 8 : c.metrics.latency;
      const err = c.metrics.errorRateNow ?? c.metrics.errorRate;
      compPanel.innerHTML = `
        <div class="panel-title">组件状态 <span class="cp-close" title="关闭">×</span></div>
        <div class="cp-head"><span class="cp-name">${esc(c.name)}</span>${b.rootCause === c.id ? '<span class="tag critical">根因</span>' : ''}<span class="tag ${st}">${STATUS_NAME[st]}</span></div>
        <div class="cp-sub">${esc(b.name)} · ${esc(c.type.toUpperCase())} · ${esc(c.version)}</div>
        ${c.message ? `<div class="cp-msg ${st}">⚠ ${esc(c.message)}</div>` : ''}
        <div class="cp-grid">
          <div class="cp-stat"><b class="${healthy < c.instances ? st : ''}">${healthy}<small> / ${c.instances} 健康</small></b><span>实例</span></div>
          <div class="cp-stat"><b class="${latency > c.metrics.latency * 3 ? st : ''}">${latency} ms</b><span>时延 P95</span></div>
          <div class="cp-stat"><b>${fmt(c.metrics.qps)}/s</b><span>请求量</span></div>
          <div class="cp-stat"><b class="${Number(err) > 1 ? st : ''}">${err}%</b><span>错误率</span></div>
        </div>
        ${bar('CPU', cpu)}
        ${bar('内存', c.mem)}
        <div class="cp-rel" style="margin-top:0.6rem">
          <div class="r"><span class="k">上游</span><span class="v">${info.upstream.length ? info.upstream.map((u) => `<span class="${u.status}">${esc(u.name)}</span>`).join(' · ') : '—'}</span></div>
          <div class="r"><span class="k">下游</span><span class="v">${info.downstream.length ? info.downstream.map((u) => `<span class="${u.status}">${esc(u.name)}</span>`).join(' · ') : '—'}</span></div>
          <div class="r"><span class="k">终端</span><span class="v">${info.terminals ? `约 ${fmt(info.terminals)} 个本地终端接入` : '不直接接入终端'}</span></div>
        </div>
        <div class="fp-sub">最近事件</div>
        <div class="cp-events">${c.events.slice(0, 4).map((e) => `<div class="e ${e.status || ''}"><span class="t">${esc(e.time)}</span><span class="txt">${esc(e.text)}</span></div>`).join('')}</div>`;
      compPanel.querySelector('.cp-close').onclick = () => h.onCloseComponent();
    },
    hideComponent() { compPanel.classList.add('hidden'); },

    setCrumb(items) { crumb.innerHTML = items.map((t, i) => `<span data-i="${i}">${esc(t)}</span>`).join('<span class="sep">›</span>'); for (const el of crumb.querySelectorAll('span[data-i]')) el.onclick = () => h.onCrumb(Number(el.dataset.i), items.length); },
    setSpotChip(text) { if (!text) { spotChip.classList.add('hidden'); return; } spotChip.classList.remove('hidden'); spotChip.innerHTML = `聚光：${esc(text)} <i title="取消（Esc）">×</i>`; spotChip.querySelector('i').onclick = () => h.onSpotClear(); },
    setTicker(events) { ticker.innerHTML = events.slice(0, 4).map((e) => `<span class="ev ${e.cls}"><i></i><span class="t">${e.time}</span>${esc(e.text)}</span>`).join(''); },
    showBanner(evt) {
      banner.classList.remove('hidden');
      banner.innerHTML = `<span>新增故障：<b>${esc(evt.name)}</b> · ${esc(evt.message)}</span><button class="locate">定 位</button>`;
      banner.querySelector('.locate').onclick = () => { h.onBannerLocate(evt); banner.classList.add('hidden'); };
      clearTimeout(banner._t); banner._t = setTimeout(() => banner.classList.add('hidden'), 8000);
    },
    setQuality(q, auto) {
      for (const b of settings.querySelectorAll('#quality-seg button')) b.classList.toggle('on', auto ? b.dataset.q === 'auto' : b.dataset.q === q);
      setText($('quality-note'), `当前：${{ high: '高', balanced: '均衡', low: '低' }[q]}${auto ? '（自动）' : ''}`);
    },
    setToggle(key, on) { const sw = settings.querySelector(`.sw[data-key="${key}"]`); sw?.classList.toggle('on', on); },
    focusSearch() { searchInput.focus(); searchInput.select(); },
    clearSearch() { searchInput.value = ''; srItems = []; renderSearch(); searchInput.blur(); },
  };
}
