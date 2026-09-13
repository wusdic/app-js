// 模块入口：在容器内构建 DOM（头部工具、画布、悬浮卡、状态条），接管交互与渲染循环，暴露数据接口
import { Scene, LEVELS, LEVEL_NAME, COLORS } from './scene.js';
import './style.css';

const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const svgRotate = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/><path d="M16.5 3.5v4h-4"/></svg>';
const svgHome = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5 10 4l6 5.5"/><path d="M5.5 8.5V16h9V8.5"/></svg>';

export function createTopologyModule(container, { data, layer = 'all', autoRotate = true, intro = true, flowStyle = 'wave', onSelect } = {}) {
  container.classList.add('ct-module');
  container.innerHTML = `
    <div class="ct-head">
      <div class="ct-title"><h2>全网业务运行态势</h2><span class="ct-live"><i></i>实时</span></div>
      <div class="ct-tools">
        <div class="ct-seg" role="tablist" aria-label="层级">
          <button type="button" role="tab" data-layer="all">全部</button>
          ${LEVELS.map((lv) => `<button type="button" role="tab" data-layer="${lv}">${LEVEL_NAME[lv].slice(0, 2)}</button>`).join('')}
        </div>
        <div class="ct-legend">
          ${LEVELS.map((lv) => `<span><i style="--c:${COLORS.level[lv]}"></i>${LEVEL_NAME[lv].slice(0, 2)}</span>`).join('')}
          <span><i style="--c:${COLORS.status.warning}"></i>告警</span><span><i style="--c:${COLORS.status.critical}"></i>故障</span>
        </div>
        <button type="button" class="ct-icon on" data-act="rotate" title="自动旋转" aria-pressed="true">${svgRotate}</button>
        <button type="button" class="ct-icon" data-act="reset" title="重置视角">${svgHome}</button>
      </div>
    </div>
    <div class="ct-body">
      <canvas class="ct-canvas" aria-label="全网业务拓扑"></canvas>
      <div class="ct-stats"></div>
      <div class="ct-hint">拖动旋转 · 悬停查看 · 点击锁定</div>
      <div class="ct-tip" hidden></div>
      <div class="ct-card" hidden></div>
    </div>`;
  const $ = (sel) => container.querySelector(sel);
  const canvas = $('.ct-canvas'), body = $('.ct-body'), tip = $('.ct-tip'), card = $('.ct-card'), stats = $('.ct-stats');
  const scene = new Scene(canvas);
  scene.autoRotate = autoRotate; scene.layer = layer; scene.flowStyle = flowStyle;
  scene.setData(data);
  if (intro) scene.startIntro();

  // ---- 尺寸 ----
  const ro = new ResizeObserver(() => { const r = body.getBoundingClientRect(); if (r.width && r.height) scene.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)); });
  ro.observe(body);
  { const r = body.getBoundingClientRect(); scene.resize(r.width || 800, r.height || 500, Math.min(2, window.devicePixelRatio || 1)); }

  // ---- 交互 ----
  let down = null, moved = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setHover = (n) => {
    const id = n ? n.id : null; if (id === scene.hover) return;
    scene.hover = id; canvas.style.cursor = id ? 'pointer' : down ? 'grabbing' : 'grab';
    if (!scene.pinned) scene.spot = id ? scene.spotlightFor(id) : null;
    if (id && id !== scene.pinned) { tip.innerHTML = tipHtml(n); tip.hidden = false; } else tip.hidden = true;
  };
  canvas.addEventListener('pointerdown', (e) => { down = pos(e); down.yaw = scene.yaw; moved = false; scene.dragging = true; scene.yawVel = 0; scene.idle = 0; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e); scene.idle = 0;
    if (down) {
      const dx = p.x - down.x; if (Math.abs(dx) > 3 || Math.abs(p.y - down.y) > 3) moved = true;
      const prev = scene.yaw; scene.yaw = down.yaw + dx * 0.0062; scene.yawVel = (scene.yaw - prev) * 30; tip.hidden = true;
      return;
    }
    setHover(scene.hitTest(p.x, p.y));
  });
  const endDrag = (e) => { if (!down) return; const wasMoved = moved; down = null; scene.dragging = false; canvas.style.cursor = scene.hover ? 'pointer' : 'grab'; if (!wasMoved) { const p = pos(e); const n = scene.hitTest(p.x, p.y); if (n) pin(n.id === scene.pinned ? null : n.id); else pin(null); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { down = null; scene.dragging = false; });
  canvas.addEventListener('pointerleave', () => { if (!down) setHover(null); });
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') pin(null); });
  canvas.tabIndex = 0;

  function pin(id) {
    scene.pinned = id; scene.spot = id ? scene.spotlightFor(id) : scene.hover ? scene.spotlightFor(scene.hover) : null;
    scene.view.tz = id ? 1.28 : 1; if (!id) { scene.view.tx = 0; scene.view.ty = 0; }
    tip.hidden = true; card.hidden = !id; if (id) card.innerHTML = cardHtml(scene.nodeById.get(id));
    card.querySelector('.ct-card-close')?.addEventListener('click', () => pin(null));
    onSelect?.(id ? scene.nodeById.get(id).b : null);
  }
  function tipHtml(n) {
    const b = n.b, ls = scene.linksOf(n.id), active = ls.filter((l) => l.active).length;
    return `<div class="ct-tip-name"><i style="--c:${COLORS.level[n.level]}"></i>${esc(b.name)}<span class="ct-chip ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="ct-tip-meta">${LEVEL_NAME[n.level]} · ${esc(b.dept)} · ${ls.length} 条连接，${active} 条流转中</div>`;
  }
  function cardHtml(n) {
    const b = n.b, ls = scene.linksOf(n.id);
    const up = ls.filter((l) => l.b.id === n.id || l.l.dir === 2).length, down = ls.filter((l) => l.a.id === n.id || l.l.dir === 2).length;
    const rel = ls.slice(0, 6).map((l) => { const o = l.a.id === n.id ? l.b : l.a; const arrow = l.l.dir === 2 ? '⇄' : l.a.id === n.id ? '→' : '←'; return `<li><span class="ct-arrow">${arrow}</span><i style="--c:${COLORS.level[o.level]}"></i>${esc(o.b.name)}<em>${l.active ? '流转中' : l.l.status !== 'normal' ? STATUS_NAME[l.l.status] : '空闲'}</em></li>`; }).join('');
    return `<button type="button" class="ct-card-close" aria-label="关闭">×</button>
      <div class="ct-card-head"><i style="--c:${COLORS.level[n.level]}"></i><b>${esc(b.name)}</b><span class="ct-chip ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="ct-card-meta">${LEVEL_NAME[n.level]} · ${esc(b.dept)} · 负责人 ${esc(b.owner)}</div>
      <div class="ct-card-grid">
        <div><b>${b.metrics.avail}%</b><span>可用性</span></div>
        <div><b>${b.metrics.latency}<small>ms</small></b><span>时延 P95</span></div>
        <div><b>${fmt(b.metrics.rps)}</b><span>请求 / 秒</span></div>
        <div><b>${fmt(b.terminals)}</b><span>在线终端</span></div>
      </div>
      <div class="ct-card-sub">关联业务 ${ls.length} · 上游 ${up} · 下游 ${down} · 组件 ${b.components}</div>
      <ul class="ct-card-rel">${rel}</ul>${ls.length > 6 ? `<div class="ct-card-more">还有 ${ls.length - 6} 个关联业务</div>` : ''}`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- 工具栏 ----
  const segBtns = [...container.querySelectorAll('.ct-seg button')];
  const syncSeg = () => segBtns.forEach((b) => { const on = b.dataset.layer === scene.layer; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  segBtns.forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));
  syncSeg();
  const rotateBtn = $('[data-act="rotate"]');
  rotateBtn.classList.toggle('on', autoRotate); rotateBtn.setAttribute('aria-pressed', String(autoRotate));
  rotateBtn.addEventListener('click', () => setAutoRotate(!scene.autoRotate));
  $('[data-act="reset"]').addEventListener('click', () => { pin(null); scene.resetView(); scene.layer = 'all'; syncSeg(); });

  // ---- 状态条 ----
  function refreshStats() {
    const flows = scene.links.filter((l) => l.active).length;
    const warn = data.businesses.filter((b) => b.status === 'warning').length, crit = data.businesses.filter((b) => b.status === 'critical').length;
    const terms = data.businesses.reduce((s, b) => s + b.terminals, 0);
    stats.innerHTML = `<span class="ct-stat"><b>${flows}</b>条数据流转中</span>
      <span class="ct-stat ${crit ? 'crit' : warn ? 'warn' : ''}"><b>${warn + crit}</b>${crit ? `异常 · ${crit} 故障` : '异常'}</span>
      <span class="ct-stat"><b>${fmt(terms)}</b>在线终端</span>`;
  }

  // ---- 渲染循环 ----
  let raf = 0, last = performance.now(), statTimer = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    scene.update(dt); scene.draw();
    if (!tip.hidden && scene.hover) place(tip, scene.hover, 14);
    if (!card.hidden && scene.pinned) place(card, scene.pinned, 18);
    if ((statTimer += dt) > 0.6) { statTimer = 0; refreshStats(); }
    raf = requestAnimationFrame(frame);
  };
  function place(el, id, gap) {
    const p = scene.screenOf(id); if (!p) return;
    const W = scene.W, H = scene.H, w = el.offsetWidth, h = el.offsetHeight;
    let x = p.x + p.r + gap, y = p.y - h / 2;
    if (x + w > W - 8) x = p.x - p.r - gap - w;
    y = Math.max(8, Math.min(H - h - 8, y));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  refreshStats();
  raf = requestAnimationFrame(frame);

  // ---- 对外接口 ----
  function setLayer(lv) { scene.layer = lv; syncSeg(); }
  function setAutoRotate(on) { scene.autoRotate = on; rotateBtn.classList.toggle('on', on); rotateBtn.setAttribute('aria-pressed', String(on)); }
  const api = {
    scene, data,
    setLayer, setAutoRotate,
    setFlowStyle: (style) => { scene.flowStyle = style === 'dash' ? 'dash' : 'wave'; },
    focus: (id) => pin(scene.nodeById.has(id) ? id : null),
    unfocus: () => pin(null),
    resetView: () => { pin(null); scene.resetView(); },
    touch: (linkId, dir = 1) => scene.touch(linkId, dir),
    setLinkActive: (linkId, on) => scene.setActive(linkId, on),
    setBusinessStatus: (id, status) => { const n = scene.nodeById.get(id); if (!n) return; n.b.status = status; scene.retarget(n); if (scene.pinned === id) card.innerHTML = cardHtml(n), card.querySelector('.ct-card-close')?.addEventListener('click', () => pin(null)); refreshStats(); },
    setLinkStatus: (linkId, status) => { const l = scene.linkById.get(linkId); if (l) l.l.status = status; },
    addTransientLink: (from, to, ttl = 10, dir = 1) => { const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`; const l = { id, from, to, dir, status: 'normal', transient: true, ttl }; const rec = scene.addLink(l); if (rec) { rec.active = true; setTimeout(() => api.touch(id, 1), 400); } return id; },
    setTerminals: (id, count) => { const n = scene.nodeById.get(id); if (!n) return; n.b.terminals = count; scene.setTerminalCount(n, count); },
    destroy: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); container.innerHTML = ''; container.classList.remove('ct-module'); },
  };
  return api;
}
