// 模块入口：在容器内构建 DOM（头部区域芯片、画布、区域浮标、信息浮层、聚焦面板、状态条），接管交互与渲染循环，暴露数据接口
import { Scene, COLORS } from './scene.js';
import './style.css';

const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };
const LEVEL_NAME = { core: '核心', important: '重要', general: '一般' };
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svgHome = '<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5 10 4l6 5.5"/><path d="M5.5 8.5V16h9V8.5"/></svg>';

export function createTerritoryModule(container, { data, intro = true, sway = true, onSelect } = {}) {
  container.classList.add('tt-module');
  container.innerHTML = `
    <div class="tt-head">
      <div class="tt-title"><h2>全网业务版图</h2><span class="tt-live"><i></i>实时</span></div>
      <div class="tt-zones" role="tablist" aria-label="业务区域">
        ${data.zones.map((z) => `<button type="button" role="tab" class="tt-zone" data-zone="${z.id}" style="--c:${z.color}"><i></i>${esc(z.name)}<b></b></button>`).join('')}
      </div>
      <button type="button" class="tt-icon" data-act="reset" title="重置视角">${svgHome}</button>
    </div>
    <div class="tt-body">
      <canvas class="tt-canvas" aria-label="全网业务版图" tabindex="0"></canvas>
      <div class="tt-chips">${data.zones.map((z) => `<div class="tt-chip" data-zone="${z.id}" style="--c:${z.color}"><i></i><span>${esc(z.name)}</span><b></b></div>`).join('')}</div>
      <div class="tt-tip" hidden></div>
      <aside class="tt-panel" hidden></aside>
      <div class="tt-stats"></div>
      <div class="tt-hint">拖动旋转 · 点选区域聚焦 · 点击画布后滚轮缩放</div>
    </div>`;
  const $ = (s) => container.querySelector(s), $$ = (s) => [...container.querySelectorAll(s)];
  const canvas = $('.tt-canvas'), body = $('.tt-body'), tip = $('.tt-tip'), panel = $('.tt-panel'), stats = $('.tt-stats');
  const chips = new Map($$('.tt-chip').map((el) => [el.dataset.zone, el]));
  const tabs = new Map($$('.tt-zone').map((el) => [el.dataset.zone, el]));
  const scene = new Scene(canvas); scene.sway = sway;
  scene.setData(data);
  if (intro) scene.startIntro();

  const ro = new ResizeObserver(() => { const r = body.getBoundingClientRect(); if (r.width && r.height) scene.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)); });
  ro.observe(body);
  { const r = body.getBoundingClientRect(); scene.resize(r.width || 900, r.height || 520, Math.min(2, window.devicePixelRatio || 1)); }

  // ---- 交互 ----
  let down = null, moved = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function setHover(hit) {
    const blk = hit?.block || null, zone = hit?.zone || blk?.zone || null;
    if (blk !== scene.hover) { scene.hover = blk; if (blk) { tip.innerHTML = tipHtml(blk); tip.hidden = false; } else tip.hidden = true; }
    if (zone !== scene.hoverZone) { scene.hoverZone = zone; for (const [id, el] of chips) el.classList.toggle('hover', zone?.id === id); }
    canvas.style.cursor = blk || zone ? 'pointer' : down ? 'grabbing' : 'grab';
  }
  canvas.addEventListener('pointerdown', (e) => { down = pos(e); down.yaw = scene.yaw; moved = false; scene.dragging = true; scene.yawVel = 0; scene.yawTarget = null; scene.idle = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); scene.idle = 0;
    if (down) { const dx = p.x - down.x; if (Math.abs(dx) > 3 || Math.abs(p.y - down.y) > 3) moved = true; const prev = scene.yaw; scene.yaw = down.yaw + dx * 0.0058; scene.yawVel = (scene.yaw - prev) * 30; tip.hidden = true; return; }
    setHover(scene.hitTest(p.x, p.y));
  });
  const endDrag = (e) => { if (!down) return; const was = moved; down = null; scene.dragging = false; if (!was) { const hit = scene.hitTest(...Object.values(pos(e))); if (hit?.block) focusZone(hit.block.zone.id, hit.block.id); else if (hit?.zone) focusZone(hit.zone.id === scene.focus?.id ? null : hit.zone.id); else focusZone(null); } setHover(scene.hitTest(...Object.values(pos(e)))); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { down = null; scene.dragging = false; });
  canvas.addEventListener('pointerleave', () => { if (!down) setHover(null); });
  canvas.addEventListener('wheel', (e) => { if (document.activeElement !== canvas) return; e.preventDefault(); scene.view.tz = Math.max(0.75, Math.min(1.9, scene.view.tz * Math.exp(-e.deltaY * 0.0012))); scene.idle = 0; }, { passive: false });
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') focusZone(null); });
  for (const [id, el] of chips) { el.addEventListener('pointerenter', () => { scene.hoverZone = scene.zoneById.get(id); el.classList.add('hover'); }); el.addEventListener('pointerleave', () => { scene.hoverZone = null; el.classList.remove('hover'); }); el.addEventListener('click', () => focusZone(scene.focus?.id === id ? null : id)); }
  for (const [id, el] of tabs) el.addEventListener('click', () => focusZone(scene.focus?.id === id ? null : id));
  $('[data-act="reset"]').addEventListener('click', () => { focusZone(null); scene.resetView(); });

  function focusZone(id, blockId) {
    const zone = id ? scene.zoneById.get(id) : null;
    scene.focus = zone; scene.view.tz = zone ? 1.32 : 1; if (!zone) { scene.view.tx = 0; scene.view.ty = 0; }
    scene.idle = 0;
    for (const [zid, el] of tabs) { el.classList.toggle('on', zid === id); el.setAttribute('aria-selected', String(zid === id)); }
    for (const [zid, el] of chips) el.classList.toggle('on', zid === id);
    panel.hidden = !zone; if (zone) renderPanel(zone, blockId);
    container.classList.toggle('focused', !!zone);
    onSelect?.(zone ? zone.z : null, blockId ? scene.blockById.get(blockId)?.b : null);
  }
  function renderPanel(zone, blockId) {
    const st = scene.zoneStats(zone);
    const maxRps = Math.max(...zone.blocks.map((b) => b.b.metrics.rps));
    panel.innerHTML = `<button type="button" class="tt-close" aria-label="关闭">×</button>
      <div class="tt-panel-head"><i style="--c:${zone.z.color}"></i><b>${esc(zone.z.name)}</b></div>
      <p class="tt-panel-desc">${esc(zone.z.desc)}</p>
      <div class="tt-kpis"><div><b>${st.n}</b><span>业务</span></div><div><b>${st.flows}</b><span>流转中</span></div><div class="${st.crit ? 'crit' : st.bad ? 'warn' : ''}"><b>${st.bad}</b><span>异常</span></div><div><b>${fmt(st.terminals)}</b><span>在线终端</span></div></div>
      <ul class="tt-list">${zone.blocks.map((b) => `<li data-id="${b.id}" class="${b.b.status}${b.id === blockId ? ' sel' : ''}"><span class="tt-dot"></span><span class="tt-name">${esc(b.b.name)}</span><span class="tt-lv">${LEVEL_NAME[b.b.level]}</span><span class="tt-bar"><i style="width:${Math.round((b.b.metrics.rps / maxRps) * 100)}%"></i></span><span class="tt-rps">${fmt(b.b.metrics.rps)}<small>/s</small></span><span class="tt-st">${STATUS_NAME[b.b.status]}</span></li>`).join('')}</ul>`;
    panel.querySelector('.tt-close').addEventListener('click', () => focusZone(null));
    for (const li of panel.querySelectorAll('li')) {
      li.addEventListener('pointerenter', () => { scene.hover = scene.blockById.get(li.dataset.id) || null; });
      li.addEventListener('pointerleave', () => { if (scene.hover?.id === li.dataset.id) scene.hover = null; });
    }
  }
  function tipHtml(blk) {
    const b = blk.b, ls = scene.linksOf(blk.id), active = ls.filter((l) => l.active).length;
    return `<div class="tt-tip-name"><i style="--c:${blk.zone.z.color}"></i>${esc(b.name)}<span class="tt-badge ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="tt-tip-meta">${esc(blk.zone.z.name)} · ${LEVEL_NAME[b.level]}业务 · ${esc(b.dept)}</div>
      <div class="tt-tip-grid"><span><b>${fmt(b.metrics.rps)}</b>请求/秒</span><span><b>${b.metrics.latency}</b>ms 时延</span><span><b>${b.metrics.avail}%</b>可用性</span><span><b>${fmt(b.terminals)}</b>终端</span></div>
      <div class="tt-tip-foot">${ls.length} 条连接 · ${active} 条流转中</div>`;
  }

  // ---- 状态条 / 芯片计数 ----
  function refreshStats() {
    const flows = scene.links.filter((l) => l.active).length;
    const bad = data.businesses.filter((b) => b.status !== 'normal').length, crit = data.businesses.filter((b) => b.status === 'critical').length;
    const terms = data.businesses.reduce((s, b) => s + b.terminals, 0);
    stats.innerHTML = `<span><b>${data.zones.length}</b>区域</span><span><b>${data.businesses.length}</b>业务</span><span><b>${flows}</b>流转中</span><span class="${crit ? 'crit' : bad ? 'warn' : ''}"><b>${bad}</b>${crit ? `异常 · ${crit} 故障` : '异常'}</span><span><b>${fmt(terms)}</b>在线终端</span>`;
    for (const z of scene.zones) { const st = scene.zoneStats(z); const txt = st.bad ? `${st.bad} 异常` : `${st.n}`; const chip = chips.get(z.id), tab = tabs.get(z.id); chip.querySelector('b').textContent = txt; chip.classList.toggle('bad', st.bad > 0); chip.classList.toggle('crit', st.crit > 0); tab.querySelector('b').textContent = st.bad ? `${st.bad}` : ''; tab.classList.toggle('bad', st.bad > 0); }
    if (!panel.hidden && scene.focus) { const st = scene.zoneStats(scene.focus); const k = panel.querySelectorAll('.tt-kpis b'); if (k[1]) k[1].textContent = st.flows; }
  }

  // ---- 渲染循环 ----
  let raf = 0, last = performance.now(), statT = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    scene.update(dt); scene.draw();
    for (const z of scene.zones) { const el = chips.get(z.id); el.style.opacity = (z.reveal > 0.95 ? 1 : 0) * (0.35 + 0.65 * z.alpha); el.style.transform = `translate(${Math.round(z.anchor.sx - el.offsetWidth / 2)}px, ${Math.round(z.anchor.sy + 8)}px)`; }
    if (!tip.hidden && scene.hover) place(tip, scene.hover);
    if ((statT += dt) > 0.6) { statT = 0; refreshStats(); }
    raf = requestAnimationFrame(frame);
  };
  function place(el, blk) {
    const W = scene.W, H = scene.H, w = el.offsetWidth, h = el.offsetHeight, k = scene.s * scene.view.zoom;
    let x = blk.center.sx + 0.6 * k + 10, y = blk.center.sy - h / 2;
    if (x + w > W - 8) x = blk.center.sx - 0.6 * k - 10 - w;
    y = Math.max(8, Math.min(H - h - 8, y));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  refreshStats();
  raf = requestAnimationFrame(frame);

  // ---- 对外接口 ----
  const api = {
    scene, data,
    focusZone: (id) => focusZone(id), unfocus: () => focusZone(null), resetView: () => { focusZone(null); scene.resetView(); }, setSway: (on) => { scene.sway = on; },
    touch: (linkId, dir = 1) => scene.touch(linkId, dir),
    setLinkActive: (linkId, on) => scene.setActive(linkId, on),
    setBusinessStatus: (id, status) => { const b = scene.blockById.get(id); if (!b) return; b.b.status = status; scene.retarget(b); if (scene.focus === b.zone) renderPanel(b.zone); refreshStats(); },
    setLinkStatus: (linkId, status) => { const l = scene.linkById.get(linkId); if (l) l.l.status = status; },
    setMetrics: (id, metrics) => { const b = scene.blockById.get(id); if (!b) return; Object.assign(b.b.metrics, metrics); b.hT = scene.heightFor(b.b); },
    setTerminals: (id, count) => { const b = scene.blockById.get(id); if (b) b.b.terminals = count; },
    addLink: (l) => scene.addLink(l), removeLink: (id) => scene.removeLink(id),
    destroy: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); container.innerHTML = ''; container.classList.remove('tt-module', 'focused'); },
  };
  return api;
}
