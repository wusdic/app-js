// 「全网业务版图」主视觉模块：正向俯视的玻璃园区
//   一块柔和渐变的地面向后倾斜；业务区域是一排排正向排列的磨砂玻璃平台（数量、大小随数据动态生成与排布），
//   每块平台承载所属业务的磨砂玻璃方块（名称印在正面）；区域内外用正交路线相连，有数据往来时数据包沿路线飞行；
//   异常业务玻璃变色、浮出角标与涟漪。整个场景是单一倾斜平面（无多层 3D 深度排序），画面稳定不闪烁。
import { LEVEL_NAME, STATUS_NAME } from './data.js';
import { icon } from './icons.js';
import './scene.css';

const TILT = 56;                                        // 地面俯角
const E = Math.tan((TILT * Math.PI) / 180);             // 垂直高度 → 平面内向后偏移的系数
const SY = 1 / Math.cos((TILT * Math.PI) / 180);        // 平面内纵向拉伸，使平铺文字看起来正对屏幕
const T = 14;                                           // 平台厚度
const BW = 84, BD = 40;                                 // 方块宽 / 深
const CX = 98, CY = 92;                                 // 方块网格步距
const BH = { core: 28, important: 22, general: 16 };    // 方块高度（级别）
const TPADX = 24, THEAD = 88, TPADB = 18;               // 平台内边距（含区域名牌区）
const GAPX = 44, GAPY = 44, MARGIN = 44;                // 平台间距与地面边距
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };
const svgNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const px = (v) => `${Math.round(v * 100) / 100}px`;

// ---------- 动态布局：区域尺寸由业务数决定，行数按舞台宽高比择优 ----------
function tileSize(n) {
  const cols = Math.max(1, Math.min(n, Math.min(6, Math.ceil(Math.sqrt(n * 1.7)))));
  const rows = Math.ceil(n / cols);
  return { cols, rows, w: 2 * TPADX + cols * CX - (CX - BW), h: THEAD + (rows - 1) * CY + BD + TPADB };
}
export function layoutZones(zones, stageAspect = 2) {
  const tiles = zones.map((z) => ({ z, ...tileSize(z.businesses.length) }));
  // 核心区域排在中间一行的首位，其余按原顺序
  let best = null;
  for (let R = 1; R <= tiles.length; R++) {
    const per = Math.ceil(tiles.length / R);
    const rows = []; for (let i = 0; i < tiles.length; i += per) rows.push(tiles.slice(i, i + per));
    const rowW = rows.map((r) => r.reduce((s, t) => s + t.w, 0) + (r.length - 1) * GAPX);
    const GW = Math.max(...rowW) + 2 * MARGIN;
    const GH = rows.reduce((s, r) => s + Math.max(...r.map((t) => t.h)), 0) + (rows.length - 1) * GAPY + MARGIN + 64 + T * E;
    const k = Math.min(1 / (GW * 1.08), 1 / (stageAspect * GH * 0.7)); // 以舞台宽为单位的缩放：投影高 ≈ GH·cos(俯角)·透视放大
    if (!best || k > best.k) best = { k, rows, rowW, GW, GH };
  }
  const { rows, rowW, GW, GH } = best;
  let y = 64 + T * E;
  rows.forEach((r, ri) => {
    const rh = Math.max(...r.map((t) => t.h));
    let x = (GW - rowW[ri]) / 2;
    for (const t of r) { t.x = x; t.y = y + (rh - t.h); x += t.w + GAPX; }
    y += rh + GAPY;
  });
  return { tiles, GW, GH };
}

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
      <div class="bm-hint">悬停查看 · 点击锁定</div>
      <div class="bm-tip" hidden></div>
      <div class="bm-card" hidden></div>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const body = $('.bm-body'), stage = $('.bm-stage'), fit = $('.bm-fit'), world = $('.bm-world'), tip = $('.bm-tip'), card = $('.bm-card'), stats = $('.bm-stats');

  // ---------- 布局 ----------
  const zonesOrdered = data.zones.slice();
  { const ci = zonesOrdered.findIndex((z) => z.id === 'core' || /核心/.test(z.name)); if (ci > 0) { const [c] = zonesOrdered.splice(ci, 1); zonesOrdered.splice(Math.floor(zonesOrdered.length / 2), 0, c); } }
  const r0 = stage.getBoundingClientRect();
  const { tiles, GW, GH } = layoutZones(zonesOrdered, (r0.width || 1200) / (r0.height || 600));
  world.style.width = px(GW); world.style.height = px(GH);
  const TE = T * E;
  const zones = new Map(), blocks = new Map();
  const blockList = [];
  tiles.forEach((t, zi) => {
    const z = t.z;
    const zone = el('div', 'bm-zone');
    zone.style.setProperty('--i', zi);
    zone.innerHTML = `<i class="z-shadow"></i><i class="z-front"></i><div class="z-top"></div><div class="z-head"><b>${esc(z.name)}</b><small>${esc(z.en || '')}</small><span class="z-count">${z.businesses.length} 个业务</span><span class="z-bad"></span></div>`;
    const sh = zone.querySelector('.z-shadow'), fr = zone.querySelector('.z-front'), top = zone.querySelector('.z-top'), head = zone.querySelector('.z-head');
    sh.style.cssText = `left:${px(t.x + 6)};top:${px(t.y + 10)};width:${px(t.w)};height:${px(t.h)}`;
    fr.style.cssText = `left:${px(t.x)};top:${px(t.y + t.h - TE)};width:${px(t.w)};height:${px(TE)}`;
    top.style.cssText = `left:${px(t.x)};top:${px(t.y - TE)};width:${px(t.w)};height:${px(t.h)}`;
    head.style.cssText = `left:${px(t.x + TPADX)};top:${px(t.y - TE + 14)}`;
    zone.dataset.zone = z.id;
    world.appendChild(zone);
    const rec = { z, t, el: zone, bad: zone.querySelector('.z-bad') };
    zones.set(z.id, rec);
    z.businesses.forEach((bid, i) => {
      const b = data.businesses.find((q) => q.id === bid); if (!b) return;
      const bx = t.x + TPADX + (i % t.cols) * CX, by = t.y - TE + THEAD + Math.floor(i / t.cols) * CY, h = BH[b.level] || BH.general;
      blockList.push({ b, zone: rec, x: bx, y: by, h, cx: bx + BW / 2, cy: by + BD / 2 });
    });
  });

  // ---------- 路线（SVG，在平台之上、方块之下） ----------
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'bm-routes'); svg.setAttribute('viewBox', `0 0 ${GW} ${GH}`); svg.setAttribute('width', GW); svg.setAttribute('height', GH);
  const gRoads = document.createElementNS(svgNS, 'g'), gLines = document.createElementNS(svgNS, 'g'), gPk = document.createElementNS(svgNS, 'g');
  svg.append(gRoads, gLines, gPk); world.appendChild(svg);

  // ---------- 方块（按前后深度排序后加入，保证遮挡顺序） ----------
  blockList.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const blk of blockList) {
    const b = blk.b, hE = blk.h * E;
    const e = el('div', `bm-blk ${b.level} ${b.status}`);
    e.style.cssText = `left:${px(blk.x)};top:${px(blk.y)};width:${px(BW)};height:${px(BD)};--he:${px(hE)}`;
    e.style.setProperty('--i', blockList.indexOf(blk));
    e.innerHTML = `<i class="b-shadow"></i><div class="b-front"><span class="b-name">${esc(b.name)}</span></div><div class="b-top">${icon(b.kind)}<i class="led"></i></div><div class="b-badge"><i class="ring"></i><span></span></div>`;
    e.dataset.id = b.id;
    world.appendChild(e);
    blk.el = e; blk.badge = e.querySelector('.b-badge span');
    blocks.set(b.id, blk);
  }

  const routes = new Map();
  function routePath(l, a, b) {
    // 正交路线：竖直出发、水平到达，转角圆滑；同一链路的车道有小幅错位，减少重叠
    const lane = ((hash(l.id) % 5) - 2) * 6;
    const dx = b.cx - a.cx, dy = b.cy - a.cy, r = 14;
    if (Math.abs(dy) < BD * 0.6) return `M${a.cx} ${a.cy + lane * 0.5}L${b.cx} ${b.cy + lane * 0.5}`;
    if (Math.abs(dx) < BW * 0.6) return `M${a.cx + lane} ${a.cy}L${b.cx + lane} ${b.cy}`;
    const sx = Math.sign(dx), sy = Math.sign(dy), ax = a.cx + lane, ky = b.cy + lane * 0.5;
    return `M${ax} ${a.cy}V${ky - sy * r}Q${ax} ${ky} ${ax + sx * r} ${ky}H${b.cx}`;
  }
  function addRoute(l) {
    const a = blocks.get(l.from), b = blocks.get(l.to); if (!a || !b) return null;
    const d = routePath(l, a, b);
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
    r.packets.push({ el: g, t: dir > 0 ? 0 : 1, dir, spd: 170 / r.len });
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
        const edge = Math.min(p.t, 1 - p.t); // 两端淡入淡出，不在方块处突然出现
        p.el.setAttribute('opacity', Math.min(1, edge / 0.1).toFixed(2));
        p.el.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
      }
    }
  }

  // ---------- 尺寸自适应 ----------
  function fitStage() {
    const r = stage.getBoundingClientRect(); if (!r.width) return;
    const k = Math.min((r.width - 32) / (GW * 1.08), (r.height - 28) / (GH * 0.7));
    fit.style.setProperty('--k', k.toFixed(4));
  }
  const ro = new ResizeObserver(fitStage); ro.observe(stage); fitStage();

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
      const dim = (spot && !on) || (alertsOnly && !on && r.l.status === 'normal');
      r.line.classList.toggle('hl', !!on); r.road.classList.toggle('hl', !!on); r.line.classList.toggle('dim', dim); r.road.classList.toggle('dim', dim);
    }
    for (const z of zones.values()) z.el.classList.toggle('dim', !!spot && ![...spot.nodes].some((n) => blocks.get(n)?.zone === z));
  }
  world.addEventListener('pointerover', (e) => {
    const blk = e.target.closest('.bm-blk'); const zoneEl = e.target.closest('.bm-zone');
    for (const z of zones.values()) z.el.classList.toggle('hover', z.el === zoneEl || (blk && blocks.get(blk.dataset.id)?.zone === z));
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
    if (id) { const p = screenOf(id), r = stage.getBoundingClientRect(); fit.style.setProperty('--zx', px((r.width / 2 - p.x) * 0.5)); fit.style.setProperty('--zy', px((r.height / 2 - p.y) * 0.5)); fit.style.setProperty('--z', '1.1'); }
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
    const rows = rs.slice(0, 6).map((r) => { const o = r.a.b.id === b.id ? r.b : r.a; const arrow = r.l.dir === 2 ? '⇄' : r.a.b.id === b.id ? '→' : '←'; return `<li><span class="arrow">${arrow}</span><i class="lv ${o.b.level}"></i>${esc(o.b.name)}<small>${esc(o.zone.z.name.replace(/区$/, ''))}</small><em class="${r.active ? 'on' : ''}">${r.active ? '流转中' : r.l.status !== 'normal' ? STATUS_NAME[r.l.status] : '空闲'}</em></li>`; }).join('');
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
    for (const z of zones.values()) { const bad = z.z.businesses.filter((id) => blocks.get(id)?.b.status !== 'normal').length; z.bad.textContent = bad ? `${bad} 个异常` : ''; z.el.classList.toggle('has-bad', bad > 0); z.el.classList.toggle('has-crit', z.z.businesses.some((id) => blocks.get(id)?.b.status === 'critical')); }
  }

  // ---------- 渲染循环（只推进数据包与浮层位置） ----------
  let raf = 0, last = performance.now(), statT = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
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
  // 开场：平台升起 → 方块浮现 → 路线通电 → 数据包出发
  if (intro && !reduced) {
    for (const r of routes.values()) { r.line.style.strokeDasharray = `${r.len}`; r.line.style.strokeDashoffset = `${r.len}`; r.road.style.opacity = '0'; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      world.classList.remove('pre');
      for (const r of routes.values()) { r.line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1) .9s'; r.line.style.strokeDashoffset = '0'; r.road.style.transition = 'opacity .8s ease 1.2s'; r.road.style.opacity = ''; }
    }));
    setTimeout(() => { for (const r of routes.values()) { r.line.style.transition = ''; r.line.style.strokeDasharray = ''; r.line.style.strokeDashoffset = ''; r.road.style.transition = ''; } flowsOn = true; world.classList.add('ready'); }, 2100);
  } else { world.classList.remove('pre'); world.classList.add('ready'); }

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
