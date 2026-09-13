// 「全网业务版图」主视觉模块：磨砂玻璃园区（WebGL）。构建模块 DOM，接管交互与渲染循环，暴露数据接口
import { GlassScene, COLORS } from './scene.js';
import { LEVEL_NAME, STATUS_NAME } from './data.js';
import { iconSvg } from './icons.js';
import './style.css';

const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export function createBusinessMap(container, { data, intro = true, labels = true, onSelect } = {}) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.classList.add('gm');
  container.innerHTML = `
    <div class="gm-head">
      <div class="gm-title"><h2>全网业务版图</h2><span class="gm-live"><i></i>实时</span><span class="gm-sub">按业务区域 · 数据流转 · 异常关注</span></div>
      <div class="gm-tools">
        <div class="gm-legend"><span><i style="--c:${hex(COLORS.level.core)}"></i>核心</span><span><i style="--c:${hex(COLORS.level.important)}"></i>重要</span><span><i style="--c:${hex(COLORS.level.general)}"></i>一般</span><span><i style="--c:${hex(COLORS.status.warning)}"></i>告警</span><span><i style="--c:${hex(COLORS.status.critical)}"></i>故障</span></div>
        <button type="button" class="gm-toggle on" data-act="labels" aria-pressed="true">名称</button>
        <button type="button" class="gm-toggle" data-act="alerts" aria-pressed="false">只看异常</button>
        <button type="button" class="gm-toggle" data-act="reset">重置视角</button>
      </div>
    </div>
    <div class="gm-body">
      <canvas class="gm-canvas" aria-label="全网业务版图"></canvas>
      <div class="gm-labels"></div>
      <div class="gm-tip" hidden></div>
      <aside class="gm-card" aria-hidden="true"></aside>
      <div class="gm-stats"></div>
      <div class="gm-hint">拖动微调视角 · 滚轮缩放 · 悬停查看 · 点击锁定</div>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const body = $('.gm-body'), canvas = $('.gm-canvas'), tip = $('.gm-tip'), card = $('.gm-card'), stats = $('.gm-stats');
  const scene = new GlassScene(canvas, $('.gm-labels'), { reduced });
  scene.setData(data);

  // ---- 尺寸 ----
  const fit = () => { const r = body.getBoundingClientRect(); if (r.width && r.height) { scene.resize(r.width, r.height, window.devicePixelRatio || 1); if (!scene.flying && !scene.pinned) scene.jumpOverview(); } };
  const ro = new ResizeObserver(fit); ro.observe(body); fit();

  // ---- 交互：指针只记录位置，拾取在渲染帧里做（每帧最多一次） ----
  let ptr = { x: 0, y: 0, moved: false, inside: false }, down = null;
  const ndc = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }; };
  canvas.addEventListener('pointermove', (e) => { Object.assign(ptr, ndc(e)); ptr.moved = true; ptr.inside = true; });
  canvas.addEventListener('pointerleave', () => { ptr.inside = false; ptr.moved = true; });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; down = null; if (moved) return;
    const hit = scene.pick(...Object.values(ndc(e)));
    pin(hit && hit.type === 'block' && hit.id !== scene.pinned ? hit.id : null);
  });
  container.addEventListener('keydown', (e) => { if (e.key === 'Escape') pin(null); });
  function doPick() {
    if (!ptr.moved) return; ptr.moved = false;
    const hit = ptr.inside && !down ? scene.pick(ptr.x, ptr.y) : null;
    const id = hit && hit.type === 'block' ? hit.id : null;
    for (const z of scene.zones.values()) z.el.classList.toggle('hover', !!hit && hit.type === 'zone' && z.id === hit.id);
    canvas.style.cursor = id ? 'pointer' : 'grab';
    if (id !== scene.hover) {
      scene.setHover(id);
      if (id && id !== scene.pinned) { tip.innerHTML = tipHtml(scene.blocks.get(id)); tip.hidden = false; } else tip.hidden = true;
    }
  }
  function placeTip() {
    const b = scene.blocks.get(scene.hover); if (!b) return;
    const p = b.group.position.clone(); p.y += b.h + 0.1; p.project(scene.camera);
    const W = body.clientWidth, H = body.clientHeight, x = (p.x + 1) / 2 * W, y = (1 - p.y) / 2 * H;
    const w = tip.offsetWidth, h = tip.offsetHeight; let tx = x + 16, ty = y - h - 4; if (tx + w > W - 8) tx = x - w - 16; ty = Math.max(8, ty);
    tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
  }

  // ---- 选中：镜头飞近 + 右侧玻璃卡滑入 ----
  function pin(id) {
    scene.setPinned(id); tip.hidden = true;
    container.classList.toggle('has-card', !!id); card.setAttribute('aria-hidden', String(!id));
    if (id) { card.innerHTML = cardHtml(scene.blocks.get(id)); card.querySelector('.gm-card-close').addEventListener('click', () => pin(null)); card.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => pin(a.dataset.go))); }
    onSelect?.(id ? scene.blocks.get(id).b : null);
  }
  function tipHtml(b) {
    const rs = scene.routesOf(b.id), on = rs.filter((r) => r.active).length, bz = b.b;
    return `<div class="gm-tip-name"><i style="--c:${hex(COLORS.level[bz.level] || COLORS.level.general)}"></i>${esc(bz.name)}<span class="gm-chip ${bz.status}">${STATUS_NAME[bz.status]}</span></div>
      <div class="gm-tip-meta">${esc(b.zone.z.name)} · ${LEVEL_NAME[bz.level] || ''}业务 · ${rs.length} 条连接，${on} 条流转中</div>`;
  }
  function cardHtml(b) {
    const bz = b.b, rs = scene.routesOf(b.id);
    const rows = rs.slice(0, 8).map((r) => { const o = r.a.id === b.id ? r.b : r.a; const arrow = r.l.dir === 2 ? '⇄' : r.a.id === b.id ? '→' : '←'; return `<li data-go="${esc(o.id)}"><span class="arrow">${arrow}</span><i style="--c:${hex(COLORS.level[o.b.level] || COLORS.level.general)}"></i><span class="n">${esc(o.b.name)}</span><small>${esc(o.zone.z.name.replace(/区$/, ''))}</small><em class="${r.active ? 'on' : ''}">${r.active ? '流转中' : r.l.status !== 'normal' ? STATUS_NAME[r.l.status] : '空闲'}</em></li>`; }).join('');
    return `<button type="button" class="gm-card-close" aria-label="关闭">×</button>
      <div class="gm-card-head"><span class="kind" style="--c:${hex(COLORS.level[bz.level] || COLORS.level.general)}">${iconSvg(bz.kind)}</span><div><b>${esc(bz.name)}</b><div class="gm-card-meta">${esc(b.zone.z.name)} · ${LEVEL_NAME[bz.level] || ''}业务 · ${esc(bz.dept)} · ${esc(bz.owner)}</div></div><span class="gm-chip ${bz.status}">${STATUS_NAME[bz.status]}</span></div>
      <div class="gm-card-grid"><div><b>${bz.metrics.avail}%</b><span>可用性</span></div><div><b>${bz.metrics.latency}<small>ms</small></b><span>时延 P95</span></div><div><b>${fmt(bz.metrics.rps)}</b><span>请求 / 秒</span></div><div><b>${fmt(bz.terminals)}</b><span>在线终端</span></div></div>
      <div class="gm-card-sub">关联业务 ${rs.length} · 组件 ${bz.components}<span>点击关联业务可跳转</span></div><ul class="gm-card-rel">${rows}</ul>${rs.length > 8 ? `<div class="gm-card-more">还有 ${rs.length - 8} 个关联业务</div>` : ''}`;
  }

  // ---- 工具栏 ----
  const labelsBtn = $('[data-act="labels"]'), alertsBtn = $('[data-act="alerts"]');
  const setLabels = (on) => { scene.setLabels(on); labelsBtn.classList.toggle('on', on); labelsBtn.setAttribute('aria-pressed', String(on)); };
  labelsBtn.addEventListener('click', () => setLabels(!labelsBtn.classList.contains('on')));
  const setAlertsOnly = (on) => { scene.setAlertsOnly(on); alertsBtn.classList.toggle('on', on); alertsBtn.setAttribute('aria-pressed', String(on)); };
  alertsBtn.addEventListener('click', () => setAlertsOnly(!alertsBtn.classList.contains('on')));
  $('[data-act="reset"]').addEventListener('click', () => { if (scene.pinned) pin(null); else scene.goOverview(0.7); });
  setLabels(labels);

  // ---- 状态条 ----
  function refreshStats() {
    let flows = 0; for (const r of scene.routes.values()) if (r.active) flows++;
    const warn = data.businesses.filter((b) => b.status === 'warning').length, crit = data.businesses.filter((b) => b.status === 'critical').length;
    const terms = data.businesses.reduce((s, b) => s + b.terminals, 0);
    stats.innerHTML = `<span class="gm-stat"><b>${data.zones.length}</b>业务区域</span><span class="gm-stat"><b>${data.businesses.length}</b>业务</span><span class="gm-stat"><b>${flows}</b>条流转中</span>
      <span class="gm-stat ${crit ? 'crit' : warn ? 'warn' : ''}"><b>${warn + crit}</b>${crit ? `异常 · ${crit} 故障` : '异常'}</span><span class="gm-stat"><b>${fmt(terms)}</b>在线终端</span>`;
  }

  // ---- 渲染循环：单一 rAF，拾取、插值、渲染、标签同步都在这里 ----
  let raf = 0, last = performance.now(), statT = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    doPick();
    scene.update(dt); scene.render();
    if (!tip.hidden) placeTip();
    if ((statT += dt) > 0.7) { statT = 0; refreshStats(); }
    raf = requestAnimationFrame(frame);
  };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  if (intro && !reduced) scene.startIntro(); else scene.jumpOverview();
  refreshStats();
  raf = requestAnimationFrame(frame);

  // ---- 对外接口 ----
  const api = {
    scene, data,
    touch: (linkId, dir = 1) => scene.pulse(linkId, dir),
    setLinkActive: (linkId, on) => scene.setLinkActive(linkId, on),
    setBusinessStatus: (id, status) => { scene.setBusinessStatus(id, status); if (scene.pinned === id) { card.innerHTML = cardHtml(scene.blocks.get(id)); card.querySelector('.gm-card-close').addEventListener('click', () => pin(null)); } refreshStats(); },
    setLinkStatus: (linkId, status) => scene.setLinkStatus(linkId, status),
    addTransientLink: (from, to, ttl = 9, dir = 1) => { const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`; const r = scene.addTransient({ id, from, to, dir, status: 'normal', transient: true, ttl }); if (r) setTimeout(() => api.touch(id, 1), 600); return id; },
    setTerminals: (id, count) => { const b = scene.blocks.get(id); if (b) b.b.terminals = count; },
    // 整体重载（区域 / 业务个数变化时重新动态布局）
    load: (next) => { Object.assign(data, next); scene.setData(data); scene.jumpOverview(); pin(null); refreshStats(); },
    focus: (id) => pin(scene.blocks.has(id) ? id : null), unfocus: () => pin(null),
    setLabels, setAlertsOnly, resetView: () => scene.goOverview(0.7),
    destroy: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); scene.dispose(); container.innerHTML = ''; container.classList.remove('gm'); },
  };
  return api;
}
