// 「全网业务版图」主视觉模块：斜向立体（等轴测）园区式拓扑
//   六块磨砂玻璃「业务区域」平台错落在柔和渐变的地面上，每个区域承载所属业务的 3D 方块；
//   区域内外用正交路线相连，有数据往来时蓝色数据包沿路线飞行；异常业务变色并浮出角标与涟漪。
//   实现：CSS 3D（真实的 backdrop-filter 磨砂）+ SVG 路线 + 少量 JS（布局、数据包、交互）
import { LEVEL_NAME, STATUS_NAME } from './data.js';
import { icon } from './icons.js';
import './scene.css';

const GW = 1020, GH = 680;               // 地面尺寸（地面坐标，px）
const TILE = 300, GAP = 40, PAD = 20;    // 区域平台尺寸与间距
const SLAB = 16;                         // 平台厚度
const CELL = 84, BLK = 48;               // 业务方块网格与底面尺寸
const BLK_H = { core: 30, important: 24, general: 18 };
const TILT = 58, SPIN = -45;             // 等轴测角度
const ZONE_SLOTS = { office: [0, 0], portal: [1, 0], hr: [2, 0], campus: [0, 1], core: [1, 1], service: [2, 1] };
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svgNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function createBusinessMap(container, { data, intro = true, labels = true, onSelect } = {}) {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.classList.add('bm');
  container.innerHTML = `
    <div class="bm-head">
      <div class="bm-title"><h2>全网业务版图</h2><span class="bm-live"><i></i>实时</span><span class="bm-sub">按业务区域 · 数据流转 · 异常关注</span></div>
      <div class="bm-tools">
        <div class="bm-legend"><span><i class="lv core"></i>核心</span><span><i class="lv important"></i>重要</span><span><i class="lv general"></i>一般</span><span><i class="st warning"></i>告警</span><span><i class="st critical"></i>故障</span></div>
        <button type="button" class="bm-toggle on" data-act="labels" aria-pressed="true">名称</button>
        <button type="button" class="bm-toggle" data-act="alerts" aria-pressed="false">只看异常</button>
        <button type="button" class="bm-toggle" data-act="reset" title="重置视图">重置</button>
      </div>
    </div>
    <div class="bm-body">
      <div class="bm-stage"><div class="bm-fit"><div class="bm-world pre">
        <div class="bm-ground"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i><i class="blob b4"></i><i class="blob b5"></i><span class="grid"></span></div>
      </div></div></div>
      <div class="bm-stats"></div>
      <div class="bm-hint">悬停查看 · 点击锁定 · 移动视差</div>
      <div class="bm-tip" hidden></div>
      <div class="bm-card" hidden></div>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const body = $('.bm-body'), stage = $('.bm-stage'), fit = $('.bm-fit'), world = $('.bm-world'), tip = $('.bm-tip'), card = $('.bm-card'), stats = $('.bm-stats');
  world.style.width = `${GW}px`; world.style.height = `${GH}px`;

  // ---------- 布局：区域与业务方块 ----------
  const zones = new Map(), blocks = new Map();
  data.zones.forEach((z, zi) => {
    const [cx, cy] = ZONE_SLOTS[z.id] || [zi % 3, Math.floor(zi / 3)];
    const x = PAD + cx * (TILE + GAP), y = PAD + cy * (TILE + GAP);
    const zone = el('div', `bm-zone ${z.accent} z-${z.id}`);
    zone.style.left = `${x}px`; zone.style.top = `${y}px`; zone.style.setProperty('--i', zi);
    zone.innerHTML = `<i class="z-shadow"></i><i class="z-left"></i><i class="z-right"></i><div class="z-top"></div>
      <div class="z-head"><b>${esc(z.name)}</b><small>${esc(z.en)}</small><span class="z-count">${z.businesses.length} 个业务</span><span class="z-bad"></span></div>`;
    zone.dataset.zone = z.id;
    world.appendChild(zone);
    const rec = { z, x, y, el: zone, bad: zone.querySelector('.z-bad') };
    zones.set(z.id, rec);
    const n = z.businesses.length, cols = 3, rows = Math.ceil(n / cols);
    const x0 = (TILE - cols * CELL) / 2 + (CELL - BLK) / 2, y0 = (TILE - rows * CELL) / 2 + (CELL - BLK) / 2;
    z.businesses.forEach((bid, i) => {
      const b = data.businesses.find((q) => q.id === bid);
      const bx = x0 + (i % cols) * CELL, by = y0 + Math.floor(i / cols) * CELL, h = BLK_H[b.level];
      const blk = el('div', `bm-blk ${b.level} ${b.status}`);
      blk.style.left = `${bx}px`; blk.style.top = `${by}px`; blk.style.setProperty('--h', `${h}px`); blk.style.setProperty('--i', zi * 8 + i);
      blk.innerHTML = `<i class="b-shadow"></i><i class="b-left"></i><i class="b-right"></i><div class="b-top">${icon(b.kind)}<i class="led"></i></div>
        <div class="b-label">${esc(b.name)}</div><div class="b-badge"><i class="ring"></i><span></span></div>`;
      blk.dataset.id = b.id;
      zone.appendChild(blk);
      blocks.set(b.id, { b, el: blk, zone: rec, cx: x + bx + BLK / 2, cy: y + by + BLK / 2, h, label: blk.querySelector('.b-label'), badge: blk.querySelector('.b-badge span') });
    });
  });

  // ---------- 路线（SVG，贴在平台顶面之上） ----------
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'bm-routes'); svg.setAttribute('viewBox', `0 0 ${GW} ${GH}`); svg.setAttribute('width', GW); svg.setAttribute('height', GH);
  const gRoads = document.createElementNS(svgNS, 'g'), gLines = document.createElementNS(svgNS, 'g'), gPk = document.createElementNS(svgNS, 'g');
  svg.append(gRoads, gLines, gPk); world.appendChild(svg);
  const routes = new Map();
  function routePath(a, b) {
    // 正交路线：先沿较长的轴走，再转向，转角圆滑；同轴时直线
    const dx = b.cx - a.cx, dy = b.cy - a.cy, r = 16;
    if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return `M${a.cx} ${a.cy}L${b.cx} ${b.cy}`;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    if (Math.abs(dx) >= Math.abs(dy)) { const kx = b.cx - sx * r; return `M${a.cx} ${a.cy}H${kx}Q${b.cx} ${a.cy} ${b.cx} ${a.cy + sy * r}V${b.cy}`; }
    const ky = b.cy - sy * r; return `M${a.cx} ${a.cy}V${ky}Q${a.cx} ${b.cy} ${a.cx + sx * r} ${b.cy}H${b.cx}`;
  }
  function addRoute(l) {
    const a = blocks.get(l.from), b = blocks.get(l.to); if (!a || !b) return null;
    const d = routePath(a, b);
    const road = document.createElementNS(svgNS, 'path'); road.setAttribute('d', d); road.setAttribute('class', 'road');
    const line = document.createElementNS(svgNS, 'path'); line.setAttribute('d', d); line.setAttribute('class', `line ${l.transient ? 'transient' : ''} ${l.status}`);
    gRoads.appendChild(road); gLines.appendChild(line);
    const rec = { l, a, b, road, line, len: line.getTotalLength(), packets: [], active: false, dieAt: l.transient ? performance.now() + (l.ttl || 9) * 1000 : Infinity };
    routes.set(l.id, rec); return rec;
  }
  function removeRoute(id) { const r = routes.get(id); if (!r) return; for (const p of r.packets) p.el.remove(); r.road.remove(); r.line.remove(); routes.delete(id); }
  data.links.forEach(addRoute);
  const routesOf = (id) => [...routes.values()].filter((r) => r.a.b.id === id || r.b.b.id === id);

  // ---------- 数据包 ----------
  let flowsOn = !intro || reduced;
  function spawnPacket(r, dir) {
    if (!flowsOn || r.packets.length >= 3) return;
    const g = document.createElementNS(svgNS, 'g'); g.setAttribute('class', `pk ${r.l.status}`);
    g.innerHTML = '<rect class="glow" x="-9" y="-4" width="18" height="8" rx="4"/><rect class="body" x="-6" y="-2" width="12" height="4" rx="2"/>';
    gPk.appendChild(g);
    r.packets.push({ el: g, t: dir > 0 ? 0 : 1, dir, spd: 190 / r.len });
  }
  function stepPackets(dt) {
    const now = performance.now();
    for (const r of routes.values()) {
      if (now > r.dieAt) { r.line.classList.add('fade'); r.road.classList.add('fade'); if (now > r.dieAt + 700) { removeRoute(r.l.id); continue; } }
      for (let i = r.packets.length - 1; i >= 0; i--) {
        const p = r.packets[i]; p.t += p.dir * p.spd * dt;
        if (p.t > 1 || p.t < 0) { p.el.remove(); r.packets.splice(i, 1); continue; }
        const L = p.t * r.len, q = r.line.getPointAtLength(L), q2 = r.line.getPointAtLength(Math.min(r.len, Math.max(0, L + p.dir * 4)));
        const ang = Math.atan2(q2.y - q.y, q2.x - q.x) * 180 / Math.PI;
        p.el.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
      }
    }
  }

  // ---------- 尺寸自适应：把地面菱形缩放到舞台内 ----------
  const diamondW = (GW + GH) * Math.SQRT1_2, diamondH = diamondW * Math.cos(TILT * Math.PI / 180) + 70;
  let scale = 1;
  function fitStage() {
    const r = stage.getBoundingClientRect(); if (!r.width) return;
    scale = Math.min((r.width - 24) / diamondW, (r.height - 36) / diamondH);
    fit.style.setProperty('--k', scale.toFixed(4));
  }
  const ro = new ResizeObserver(fitStage); ro.observe(stage); fitStage();

  // ---------- 视差 ----------
  let px = 0, py = 0, tx = 0, ty = 0;
  body.addEventListener('pointermove', (e) => { if (reduced) return; const r = body.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; });
  body.addEventListener('pointerleave', () => { tx = 0; ty = 0; });

  // ---------- 交互 ----------
  let hover = null, pinned = null, alertsOnly = false;
  const spotSet = (id) => { const rs = routesOf(id); const ns = new Set([id]); for (const r of rs) { ns.add(r.a.b.id); ns.add(r.b.b.id); } return { nodes: ns, routes: new Set(rs.map((r) => r.l.id)) }; };
  function applySpot() {
    const id = pinned || hover; const spot = id ? spotSet(id) : null;
    for (const [bid, blk] of blocks) {
      const ab = blk.b.status !== 'normal';
      blk.el.classList.toggle('dim', (spot && !spot.nodes.has(bid)) || (alertsOnly && !ab && !(spot && spot.nodes.has(bid))));
      blk.el.classList.toggle('hover', hover === bid); blk.el.classList.toggle('pin', pinned === bid);
      blk.el.classList.toggle('rel', !!spot && spot.nodes.has(bid) && bid !== id);
    }
    for (const r of routes.values()) {
      const on = spot && spot.routes.has(r.l.id);
      r.line.classList.toggle('hl', !!on); r.road.classList.toggle('hl', !!on);
      r.line.classList.toggle('dim', (spot && !on) || (alertsOnly && !on && r.l.status === 'normal')); r.road.classList.toggle('dim', (spot && !on) || (alertsOnly && !on && r.l.status === 'normal'));
    }
    for (const z of zones.values()) z.el.classList.toggle('dim', !!spot && ![...spot.nodes].some((n) => blocks.get(n)?.zone === z));
  }
  world.addEventListener('pointerover', (e) => {
    const blk = e.target.closest('.bm-blk'); const zone = e.target.closest('.bm-zone');
    for (const z of zones.values()) z.el.classList.toggle('hover', z.el === zone);
    const id = blk ? blk.dataset.id : null; if (id === hover) return;
    hover = id; applySpot();
    if (id && id !== pinned) { tip.innerHTML = tipHtml(blocks.get(id)); tip.hidden = false; place(tip, id, 12); } else tip.hidden = true;
  });
  world.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; for (const z of zones.values()) z.el.classList.remove('hover'); applySpot(); });
  world.addEventListener('click', (e) => { const blk = e.target.closest('.bm-blk'); pin(blk && blk.dataset.id !== pinned ? blk.dataset.id : null); });
  container.addEventListener('keydown', (e) => { if (e.key === 'Escape') pin(null); });
  function pin(id) {
    pinned = id; tip.hidden = true; applySpot();
    card.hidden = !id;
    if (id) { card.innerHTML = cardHtml(blocks.get(id)); card.querySelector('.bm-card-close').addEventListener('click', () => pin(null)); place(card, id, 16); }
    // 镜头：锁定时轻微推近并把该业务移向中心
    if (id) { const p = screenOf(id), r = stage.getBoundingClientRect(); fit.style.setProperty('--zx', `${(r.width / 2 - p.x) * 0.55}px`); fit.style.setProperty('--zy', `${(r.height / 2 - p.y) * 0.55}px`); fit.style.setProperty('--z', '1.12'); }
    else { fit.style.setProperty('--zx', '0px'); fit.style.setProperty('--zy', '0px'); fit.style.setProperty('--z', '1'); }
    onSelect?.(id ? blocks.get(id).b : null);
  }
  function screenOf(id) { const blk = blocks.get(id); const r = blk.el.querySelector('.b-top').getBoundingClientRect(), s = stage.getBoundingClientRect(); return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top, w: r.width, h: r.height }; }
  function place(elm, id, gap) {
    const p = screenOf(id), W = body.clientWidth, H = body.clientHeight, w = elm.offsetWidth, h = elm.offsetHeight;
    let x = p.x + p.w / 2 + gap, y = p.y - h / 2 - 6;
    if (x + w > W - 10) x = p.x - p.w / 2 - gap - w;
    y = Math.max(10, Math.min(H - h - 10, y));
    elm.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function tipHtml(blk) {
    const b = blk.b, rs = routesOf(b.id), on = rs.filter((r) => r.active).length;
    return `<div class="bm-tip-name"><i class="lv ${b.level}"></i>${esc(b.name)}<span class="bm-chip ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="bm-tip-meta">${esc(blk.zone.z.name)} · ${LEVEL_NAME[b.level]}业务 · ${rs.length} 条连接，${on} 条流转中</div>`;
  }
  function cardHtml(blk) {
    const b = blk.b, rs = routesOf(b.id);
    const rows = rs.slice(0, 6).map((r) => { const o = r.a.b.id === b.id ? r.b : r.a; const arrow = r.l.dir === 2 ? '⇄' : r.a.b.id === b.id ? '→' : '←'; return `<li><span class="arrow">${arrow}</span><i class="lv ${o.b.level}"></i>${esc(o.b.name)}<small>${esc(o.zone.z.name.replace('区', ''))}</small><em class="${r.active ? 'on' : ''}">${r.active ? '流转中' : r.l.status !== 'normal' ? STATUS_NAME[r.l.status] : '空闲'}</em></li>`; }).join('');
    return `<button type="button" class="bm-card-close" aria-label="关闭">×</button>
      <div class="bm-card-head"><span class="kind ${b.level}">${icon(b.kind)}</span><div><b>${esc(b.name)}</b><div class="bm-card-meta">${esc(blk.zone.z.name)} · ${LEVEL_NAME[b.level]}业务 · ${esc(b.dept)} · ${esc(b.owner)}</div></div><span class="bm-chip ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="bm-card-grid"><div><b>${b.metrics.avail}%</b><span>可用性</span></div><div><b>${b.metrics.latency}<small>ms</small></b><span>时延 P95</span></div><div><b>${fmt(b.metrics.rps)}</b><span>请求 / 秒</span></div><div><b>${fmt(b.terminals)}</b><span>在线终端</span></div></div>
      <div class="bm-card-sub">关联业务 ${rs.length} · 组件 ${b.components}</div><ul class="bm-card-rel">${rows}</ul>${rs.length > 6 ? `<div class="bm-card-more">还有 ${rs.length - 6} 个关联业务</div>` : ''}`;
  }

  // ---------- 工具栏 ----------
  const labelsBtn = $('[data-act="labels"]'), alertsBtn = $('[data-act="alerts"]');
  const setLabels = (on) => { world.classList.toggle('no-labels', !on); labelsBtn.classList.toggle('on', on); labelsBtn.setAttribute('aria-pressed', String(on)); };
  labelsBtn.addEventListener('click', () => setLabels(!labelsBtn.classList.contains('on')));
  alertsBtn.addEventListener('click', () => { alertsOnly = !alertsOnly; alertsBtn.classList.toggle('on', alertsOnly); alertsBtn.setAttribute('aria-pressed', String(alertsOnly)); applySpot(); });
  $('[data-act="reset"]').addEventListener('click', () => { pin(null); if (alertsOnly) alertsBtn.click(); setLabels(true); });
  setLabels(labels);

  // ---------- 状态条与区域异常数 ----------
  function refreshStats() {
    const flows = [...routes.values()].filter((r) => r.active).length;
    const warn = data.businesses.filter((b) => b.status === 'warning').length, crit = data.businesses.filter((b) => b.status === 'critical').length;
    const terms = data.businesses.reduce((s, b) => s + b.terminals, 0);
    stats.innerHTML = `<span class="bm-stat"><b>${data.zones.length}</b>业务区域</span><span class="bm-stat"><b>${data.businesses.length}</b>业务</span><span class="bm-stat"><b>${flows}</b>条流转中</span>
      <span class="bm-stat ${crit ? 'crit' : warn ? 'warn' : ''}"><b>${warn + crit}</b>${crit ? `异常 · ${crit} 故障` : '异常'}</span><span class="bm-stat"><b>${fmt(terms)}</b>在线终端</span>`;
    for (const z of zones.values()) { const bad = z.z.businesses.filter((id) => blocks.get(id).b.status !== 'normal').length; z.bad.textContent = bad ? `${bad} 个异常` : ''; z.el.classList.toggle('has-bad', bad > 0); z.el.classList.toggle('has-crit', z.z.businesses.some((id) => blocks.get(id).b.status === 'critical')); }
  }

  // ---------- 渲染循环 ----------
  let raf = 0, last = performance.now(), statT = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // 视差：只在指针移动引起变化时才改写 transform，静止时不重绘玻璃层（避免闪烁）
    const nx = px + (tx - px) * Math.min(1, dt * 3), ny = py + (ty - py) * Math.min(1, dt * 3);
    if (Math.abs(nx - px) > 0.0005 || Math.abs(ny - py) > 0.0005) { px = nx; py = ny; world.style.transform = `translate(-50%, -50%) rotateX(${(TILT + py * 1.4).toFixed(2)}deg) rotateZ(${(SPIN + px * 1.8).toFixed(2)}deg)`; }
    stepPackets(dt);
    if (!tip.hidden && hover) place(tip, hover, 12);
    if (!card.hidden && pinned) place(card, pinned, 16);
    if ((statT += dt) > 0.7) { statT = 0; refreshStats(); }
    raf = requestAnimationFrame(frame);
  };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  refreshStats();
  raf = requestAnimationFrame(frame);
  // 开场：平台升起 → 方块弹出 → 路线通电 → 数据包出发
  if (intro && !reduced) {
    for (const r of routes.values()) { r.line.style.strokeDasharray = `${r.len}`; r.line.style.strokeDashoffset = `${r.len}`; r.road.style.opacity = '0'; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      world.classList.remove('pre');
      for (const r of routes.values()) { r.line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1) .9s'; r.line.style.strokeDashoffset = '0'; r.road.style.transition = 'opacity .8s ease 1.2s'; r.road.style.opacity = ''; }
    }));
    setTimeout(() => { for (const r of routes.values()) { r.line.style.transition = ''; r.line.style.strokeDasharray = ''; r.line.style.strokeDashoffset = ''; r.road.style.transition = ''; } flowsOn = true; }, 2100);
  } else world.classList.remove('pre');

  // ---------- 对外接口 ----------
  const api = {
    data, zones, blocks, routes,
    touch: (linkId, dir = 1) => { const r = routes.get(linkId); if (r) spawnPacket(r, dir); },
    setLinkActive: (linkId, on) => { const r = routes.get(linkId); if (!r) return; r.active = on; r.line.classList.toggle('on', on); r.road.classList.toggle('on', on); },
    setBusinessStatus: (id, status) => { const blk = blocks.get(id); if (!blk) return; blk.el.classList.remove(blk.b.status); blk.b.status = status; blk.el.classList.add(status); blk.badge.textContent = status === 'critical' ? '故障' : status === 'warning' ? '告警' : ''; if (pinned === id) { card.innerHTML = cardHtml(blk); card.querySelector('.bm-card-close').addEventListener('click', () => pin(null)); } refreshStats(); applySpot(); },
    setLinkStatus: (linkId, status) => { const r = routes.get(linkId); if (!r) return; r.line.classList.remove(r.l.status); r.l.status = status; r.line.classList.add(status); },
    addTransientLink: (from, to, ttl = 9, dir = 1) => { const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`; const r = addRoute({ id, from, to, dir, status: 'normal', transient: true, ttl }); if (r) { api.setLinkActive(id, true); setTimeout(() => api.touch(id, 1), 500); } return id; },
    setTerminals: (id, count) => { const blk = blocks.get(id); if (blk) blk.b.terminals = count; },
    focus: (id) => pin(blocks.has(id) ? id : null), unfocus: () => pin(null),
    setLabels, setAlertsOnly: (on) => { if (on !== alertsOnly) alertsBtn.click(); },
    destroy: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); container.innerHTML = ''; container.classList.remove('bm'); },
  };
  return api;
}
