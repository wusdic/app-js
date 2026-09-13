// 业务版图模块入口：构建 DOM（头部工具、3D 画布、标签层、悬浮卡、状态条），接管交互与渲染循环，暴露数据接口
import { MapScene, STATUS_COLOR } from './scene.js';
import './style.css';

const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createBusinessMap(container, { data, intro = true, sway = true, onSelect } = {}) {
  container.classList.add('bm-module');
  container.innerHTML = `
    <div class="bm-head">
      <div class="bm-title"><h2>全网业务版图</h2><small>${data.domains.length} 个业务域 · ${data.businesses.length} 项业务</small><span class="bm-live"><i></i>实时</span></div>
      <div class="bm-tools">
        <div class="bm-chips" role="tablist" aria-label="业务域">
          <button type="button" class="bm-chip on" data-domain="">全部</button>
          ${data.domains.map((d) => `<button type="button" class="bm-chip" data-domain="${d.id}" style="--c:${d.color}"><i></i>${esc(d.short)}</button>`).join('')}
        </div>
        <div class="bm-legend"><span><i style="--c:${STATUS_COLOR.warning}"></i>告警</span><span><i style="--c:${STATUS_COLOR.critical}"></i>故障</span></div>
        <button type="button" class="bm-icon" data-act="names" aria-pressed="false">名称</button>
        <button type="button" class="bm-icon" data-act="reset">重置视角</button>
      </div>
    </div>
    <div class="bm-body">
      <canvas class="bm-canvas" aria-label="全网业务版图"></canvas>
      <div class="bm-labels"></div>
      <div class="bm-stats"></div>
      <div class="bm-hint">拖动旋转 · 滚轮缩放 · 点击业务或业务域</div>
      <div class="bm-tip" hidden></div>
      <div class="bm-card" hidden></div>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const canvas = $('.bm-canvas'), body = $('.bm-body'), tip = $('.bm-tip'), card = $('.bm-card'), stats = $('.bm-stats');
  const scene = new MapScene(canvas, $('.bm-labels'));
  scene.sway = sway;
  scene.setData(data);
  if (intro) scene.startIntro();
  const domainOf = (id) => data.domains.find((d) => d.id === id);

  // ---- 尺寸 ----
  const size = () => { const r = body.getBoundingClientRect(); if (r.width && r.height) scene.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)); };
  const ro = new ResizeObserver(size); ro.observe(body); size();

  // ---- 交互 ----
  let downAt = null, moved = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setHover = (hit) => {
    const id = hit && hit.kind === 'block' ? hit.id : null;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (id === scene.hover) return;
    scene.hover = id;
    if (!scene.pinned) scene.spot = id ? scene.spotlightFor(id) : null;
    if (id && id !== scene.pinned) { tip.innerHTML = tipHtml(scene.blocks.get(id)); tip.hidden = false; } else tip.hidden = true;
  };
  canvas.addEventListener('pointerdown', (e) => { downAt = pos(e); moved = false; tip.hidden = true; });
  canvas.addEventListener('pointermove', (e) => { const p = pos(e); if (downAt && (Math.abs(p.x - downAt.x) > 4 || Math.abs(p.y - downAt.y) > 4)) moved = true; if (!downAt) setHover(scene.pick(p.x, p.y)); });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return; const wasMoved = moved; downAt = null; if (wasMoved) return;
    const p = pos(e), hit = scene.pick(p.x, p.y);
    if (!hit) { pin(null); focusDomain(null); return; }
    if (hit.kind === 'block') pin(hit.id === scene.pinned ? null : hit.id);
    else focusDomain(hit.id === scene.focusDomain ? null : hit.id);
  });
  canvas.addEventListener('pointerleave', () => { if (!downAt) setHover(null); });
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pin(null); focusDomain(null); } });

  function pin(id) {
    scene.pinned = id;
    scene.spot = id ? scene.spotlightFor(id) : scene.hover ? scene.spotlightFor(scene.hover) : null;
    tip.hidden = true;
    if (id) {
      const rec = scene.blocks.get(id);
      scene.target.set(rec.x, 0.3 + rec.h * 0.5, rec.z); scene.zoomT = Math.max(scene.zoomT, 1.45);
      showCard(blockCard(rec));
    } else if (scene.focusDomain) { const dm = scene.domains.get(scene.focusDomain); scene.target.set(dm.s.x, 0.3, dm.s.z); scene.zoomT = 1.35; showCard(domainCard(dm)); }
    else { scene.target.set(0, 0.3, 0); scene.zoomT = 1; card.hidden = true; }
    onSelect?.(id ? scene.blocks.get(id).b : null);
  }
  function focusDomain(id) {
    scene.focusDomain = id; scene.pinned = null; scene.spot = null; tip.hidden = true;
    if (id) { const dm = scene.domains.get(id); scene.target.set(dm.s.x, 0.3, dm.s.z); scene.zoomT = 1.35; showCard(domainCard(dm)); }
    else { scene.target.set(0, 0.3, 0); scene.zoomT = 1; card.hidden = true; }
    syncChips();
  }
  function showCard(html) { card.innerHTML = html; card.hidden = false; card.querySelector('.bm-card-close')?.addEventListener('click', () => { if (scene.pinned) pin(null); else focusDomain(null); }); }
  function tipHtml(rec) {
    const b = rec.b, d = domainOf(b.domain), ls = scene.linksOf(b.id), active = ls.filter((l) => l.active).length;
    return `<div class="bm-tip-name"><i class="bm-dot" style="--c:${d.color}"></i>${esc(b.name)}<span class="bm-chipst ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="bm-tip-meta">${esc(d.name)} · ${esc(b.dept)} · ${ls.length} 条连接，${active} 条流转中</div>`;
  }
  function blockCard(rec) {
    const b = rec.b, d = domainOf(b.domain), ls = scene.linksOf(b.id);
    const up = ls.filter((l) => l.b.b.id === b.id || l.l.dir === 2).length, down = ls.filter((l) => l.a.b.id === b.id || l.l.dir === 2).length;
    const rel = ls.slice(0, 6).map((l) => { const o = l.a.b.id === b.id ? l.b : l.a; const od = domainOf(o.b.domain); const arrow = l.l.dir === 2 ? '⇄' : l.a.b.id === b.id ? '→' : '←'; const s = l.active ? 'on' : l.l.status; return `<li><span class="bm-arrow">${arrow}</span><i class="bm-dot" style="--c:${od.color}"></i>${esc(o.b.name)}<em class="${s}">${l.active ? '流转中' : l.l.status !== 'normal' ? STATUS_NAME[l.l.status] : '空闲'}</em></li>`; }).join('');
    return `<button type="button" class="bm-card-close" aria-label="关闭">×</button>
      <div class="bm-card-head"><i class="bm-dot" style="--c:${d.color}"></i><b>${esc(b.name)}</b><span class="bm-chipst ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="bm-card-meta">${esc(d.name)} · ${esc(b.dept)} · 负责人 ${esc(b.owner)}</div>
      <div class="bm-grid">
        <div><b>${b.metrics.avail}%</b><span>可用性</span></div>
        <div><b>${b.metrics.latency}<small>ms</small></b><span>时延 P95</span></div>
        <div><b>${fmt(b.metrics.rps)}</b><span>请求 / 秒</span></div>
        <div><b>${fmt(b.terminals)}</b><span>在线终端</span></div>
      </div>
      <div class="bm-sub">关联业务 ${ls.length} · 上游 ${up} · 下游 ${down} · 组件 ${b.components}</div>
      <ul class="bm-rel">${rel}</ul>${ls.length > 6 ? `<div class="bm-more">还有 ${ls.length - 6} 个关联业务</div>` : ''}`;
  }
  function domainCard(dm) {
    const d = dm.d, list = dm.blocks.map((r) => r.b);
    const warn = list.filter((b) => b.status === 'warning').length, crit = list.filter((b) => b.status === 'critical').length, ok = list.length - warn - crit;
    const ids = new Set(list.map((b) => b.id));
    const flows = [...scene.links.values()].filter((l) => l.active && (ids.has(l.a.b.id) || ids.has(l.b.b.id)));
    const cross = flows.filter((l) => l.cross).length;
    const terms = list.reduce((s, b) => s + b.terminals, 0);
    const bad = list.filter((b) => b.status !== 'normal').map((b) => `<li><i class="bm-dot" style="--c:${STATUS_COLOR[b.status]}"></i>${esc(b.name)}<em class="${b.status}">${STATUS_NAME[b.status]}</em></li>`).join('');
    return `<button type="button" class="bm-card-close" aria-label="关闭">×</button>
      <div class="bm-card-head"><i class="bm-dot" style="--c:${d.color}"></i><b>${esc(d.name)}</b><span class="bm-chipst ${crit ? 'critical' : warn ? 'warning' : 'normal'}">${crit ? `${crit} 故障` : warn ? `${warn} 告警` : '全部正常'}</span></div>
      <div class="bm-card-meta">${esc(d.desc)}</div>
      <div class="bm-health" title="正常 ${ok} · 告警 ${warn} · 故障 ${crit}"><i class="ok" style="width:${(ok / list.length) * 100}%"></i><i class="warn" style="width:${(warn / list.length) * 100}%"></i><i class="crit" style="width:${(crit / list.length) * 100}%"></i></div>
      <div class="bm-grid three">
        <div><b>${list.length}</b><span>业务</span></div>
        <div><b>${flows.length}<small>/${cross} 跨域</small></b><span>流转中</span></div>
        <div><b>${fmt(terms)}</b><span>在线终端</span></div>
      </div>
      ${bad ? `<div class="bm-sub">需要关注</div><ul class="bm-rel">${bad}</ul>` : `<div class="bm-sub">域内 ${list.length} 项业务运行正常</div>`}`;
  }

  // ---- 工具栏 ----
  const chips = [...container.querySelectorAll('.bm-chip')];
  const syncChips = () => chips.forEach((c) => { const on = (c.dataset.domain || null) === scene.focusDomain; c.classList.toggle('on', on); c.setAttribute('aria-selected', on); });
  chips.forEach((c) => c.addEventListener('click', () => focusDomain(c.dataset.domain || null)));
  const namesBtn = $('[data-act="names"]');
  namesBtn.addEventListener('click', () => { scene.showNames = !scene.showNames; namesBtn.classList.toggle('on', scene.showNames); namesBtn.setAttribute('aria-pressed', String(scene.showNames)); });
  $('[data-act="reset"]').addEventListener('click', () => { pin(null); focusDomain(null); scene.resetView(); card.hidden = true; });

  // ---- 状态条 ----
  function refreshStats() {
    const flows = [...scene.links.values()].filter((l) => l.active).length;
    const warn = data.businesses.filter((b) => b.status === 'warning').length, crit = data.businesses.filter((b) => b.status === 'critical').length;
    const terms = data.businesses.reduce((s, b) => s + b.terminals, 0);
    const badDomains = new Set(data.businesses.filter((b) => b.status !== 'normal').map((b) => b.domain)).size;
    stats.innerHTML = `<span class="bm-stat"><b>${flows}</b>条数据流转中</span>
      <span class="bm-stat ${crit ? 'crit' : warn ? 'warn' : ''}"><b>${warn + crit}</b>${crit ? `异常 · ${crit} 故障` : '异常'}${badDomains ? ` · 涉及 ${badDomains} 个域` : ''}</span>
      <span class="bm-stat"><b>${fmt(terms)}</b>在线终端</span>`;
  }

  // ---- 渲染循环 ----
  let raf = 0, last = performance.now(), statT = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    scene.update(dt); scene.render();
    if (!tip.hidden && scene.hover) place(tip, scene.screenOf(scene.hover), 14);
    if (!card.hidden) place(card, scene.pinned ? scene.screenOf(scene.pinned) : scene.screenOfDomain(scene.focusDomain), 18);
    if ((statT += dt) > 0.6) { statT = 0; refreshStats(); }
    raf = requestAnimationFrame(frame);
  };
  function place(el, p, gap) {
    if (!p) return; const W = scene.W, H = scene.H, w = el.offsetWidth, h = el.offsetHeight;
    let x = p.x + p.r + gap, y = p.y - h / 2;
    if (x + w > W - 8) x = p.x - p.r - gap - w;
    x = Math.max(8, x); y = Math.max(8, Math.min(H - h - 8, y));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  refreshStats(); raf = requestAnimationFrame(frame);

  // ---- 对外接口 ----
  const api = {
    scene, data,
    focus: (id) => pin(scene.blocks.has(id) ? id : null),
    unfocus: () => { pin(null); focusDomain(null); },
    focusDomain: (id) => focusDomain(scene.domains.has(id) ? id : null),
    resetView: () => { pin(null); focusDomain(null); scene.resetView(); },
    setShowNames: (on) => { scene.showNames = !!on; namesBtn.classList.toggle('on', !!on); },
    setSway: (on) => { scene.sway = !!on; },
    touch: (linkId, dir = 1) => scene.pulse(linkId, dir),
    setLinkActive: (linkId, on) => scene.setActive(linkId, on),
    setBusinessStatus: (id, status) => { const rec = scene.blocks.get(id); if (!rec) return; rec.b.status = status; scene.retarget(rec); if (scene.pinned === id) showCard(blockCard(rec)); else if (scene.focusDomain === rec.b.domain && !card.hidden) showCard(domainCard(rec.dm)); refreshStats(); },
    setLinkStatus: (linkId, status) => { const l = scene.links.get(linkId); if (l) l.l.status = status; },
    addTransientLink: (from, to, ttl = 9, dir = 1) => { const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`; const rec = scene.addLink({ id, from, to, dir, status: 'normal', transient: true, ttl }); if (rec) { rec.active = true; setTimeout(() => api.touch(id, 1), 500); } return id; },
    setTerminals: (id, count) => { const rec = scene.blocks.get(id); if (!rec) return; rec.b.terminals = count; scene.syncTerminals(rec); },
    destroy: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); scene.dispose(); container.innerHTML = ''; container.classList.remove('bm-module'); },
  };
  return api;
}
