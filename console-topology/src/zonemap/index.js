// 「全网业务版图」主视觉模块：正向排列的玻璃业务区域 + 3D 玻璃业务体
//   相机从正前上方俯视（带透视，侧面可见）；区域平台按业务数量动态定尺寸、动态排行；
//   区域内外用正交路线相连，有数据往来时数据包沿路线飞行；异常业务玻璃内透出琥珀 / 红色光并浮出角标。
//   实现：CSS 3D + SVG 路线 + 少量 JS。场景内不使用 backdrop-filter、不做逐帧相机运动、所有面互不相交，避免合成闪烁。
import { LEVEL_NAME, STATUS_NAME } from './data.js';
import { icon } from './icons.js';
import './scene.css';

const CELL = 84, CELL_Y = 128, BLK = 50; // 业务网格（横向 / 纵向间距，纵向留出铭牌不被前排遮挡）与玻璃体底面尺寸
const ZPAD = 26, GAP = 44, ROWGAP = 84;  // 区域内边距、区域间距、行间距（留出区域名牌）
const PAD = 30;                          // 地面边距
const MAXW = 1300;                       // 一行区域的最大总宽（超过则换行）
const SLAB = 16, LIFT = 2.5;             // 平台厚度；玻璃体离台面的悬空高度（路线与铭牌在这个缝里）
const BLK_H = { core: 32, important: 26, general: 20 };
const TILT = 52;                         // 相机俯角
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svgNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// 区域尺寸由业务数决定（偏宽的网格），再按“货架”方式逐行排布，每行居中、前沿对齐
export function layoutZones(zones) {
  const items = zones.map((z) => {
    const n = Math.max(1, z.businesses.length);
    const cols = n <= 3 ? n : Math.min(5, Math.ceil(n / 2)), rows = Math.ceil(n / cols); // 尽量两行，横向铺开
    return { z, n, cols, rows, w: 2 * ZPAD + cols * CELL, d: 2 * ZPAD + rows * CELL_Y };
  });
  const rowsArr = []; let cur = [], curW = 0;
  for (const it of items) {
    const add = (cur.length ? GAP : 0) + it.w;
    if (cur.length && curW + add > MAXW) { rowsArr.push(cur); cur = []; curW = 0; }
    cur.push(it); curW += (cur.length > 1 ? GAP : 0) + it.w;
  }
  if (cur.length) rowsArr.push(cur);
  const rowW = rowsArr.map((r) => r.reduce((s, it, i) => s + it.w + (i ? GAP : 0), 0));
  const GW = Math.max(...rowW) + 2 * PAD;
  let y = PAD + 8;
  rowsArr.forEach((r, ri) => {
    let x = (GW - rowW[ri]) / 2; const rowD = Math.max(...r.map((it) => it.d));
    for (const it of r) { it.x = x; it.y = y + (rowD - it.d); x += it.w + GAP; }
    y += rowD + ROWGAP;
  });
  return { items, GW, GH: y - ROWGAP + PAD };
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
      <div class="bm-stage"><div class="bm-fit"><div class="bm-world pre"></div></div></div>
      <div class="bm-stats"></div>
      <div class="bm-hint">悬停查看 · 点击锁定</div>
      <div class="bm-tip" hidden></div>
      <div class="bm-card" hidden></div>
    </div>`;
  const $ = (s) => container.querySelector(s);
  const body = $('.bm-body'), stage = $('.bm-stage'), fit = $('.bm-fit'), world = $('.bm-world'), tip = $('.bm-tip'), card = $('.bm-card'), stats = $('.bm-stats');

  // ---------- 场景构建（可重建：setData） ----------
  let zones = new Map(), blocks = new Map(), routes = new Map(), GW = 0, GH = 0;
  let svg, gRoads, gLines, gPk;
  function build() {
    world.innerHTML = '<div class="bm-ground"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i><i class="blob b4"></i><span class="grid"></span></div>';
    zones = new Map(); blocks = new Map(); routes = new Map();
    const L = layoutZones(data.zones); GW = L.GW; GH = L.GH;
    world.style.width = `${GW}px`; world.style.height = `${GH}px`;
    L.items.forEach((it, zi) => {
      const z = it.z, sideR = it.x + it.w / 2 < GW / 2; // 左半场看到右侧面，右半场看到左侧面
      const zone = el('div', `bm-zone ${sideR ? 'see-right' : 'see-left'}`);
      zone.style.left = `${it.x}px`; zone.style.top = `${it.y}px`; zone.style.width = `${it.w}px`; zone.style.height = `${it.d}px`; zone.style.setProperty('--i', zi);
      zone.style.setProperty('--w', `${it.w}px`); zone.style.setProperty('--d', `${it.d}px`);
      zone.innerHTML = `<i class="z-shadow"></i><i class="z-front"></i><i class="z-side"></i><div class="z-top"><i class="z-sheen"></i></div>
        <div class="z-sign"><b>${esc(z.name)}</b><span class="z-count">${z.businesses.length} 个业务</span><span class="z-bad"></span></div>`;
      zone.dataset.zone = z.id; world.appendChild(zone);
      const rec = { z, x: it.x, y: it.y, w: it.w, d: it.d, el: zone, bad: zone.querySelector('.z-bad') };
      zones.set(z.id, rec);
      const x0 = (it.w - it.cols * CELL) / 2 + (CELL - BLK) / 2, y0 = (it.d - it.rows * CELL_Y) / 2 + (CELL_Y - BLK) / 2 - 10;
      z.businesses.forEach((bid, i) => {
        const b = data.businesses.find((q) => q.id === bid); if (!b) return;
        const bx = x0 + (i % it.cols) * CELL, by = y0 + Math.floor(i / it.cols) * CELL_Y, h = BLK_H[b.level] || BLK_H.general;
        const cx = it.x + bx + BLK / 2;
        const blk = el('div', `bm-blk ${b.level} ${b.status} ${cx < GW / 2 ? 'see-right' : 'see-left'}`);
        blk.style.left = `${bx}px`; blk.style.top = `${by}px`; blk.style.setProperty('--h', `${h}px`); blk.style.setProperty('--i', zi * 10 + i);
        blk.innerHTML = `<i class="b-shadow"></i><i class="b-ripple"></i><i class="b-front"></i><i class="b-side"></i><div class="b-top">${icon(b.kind)}<i class="led"></i></div>
          <div class="b-label">${esc(b.name)}</div><div class="b-badge"><i class="ring"></i><span></span></div>`;
        blk.dataset.id = b.id; zone.appendChild(blk);
        blocks.set(b.id, { b, el: blk, zone: rec, cx, cy: it.y + by + BLK / 2, h, badge: blk.querySelector('.b-badge span') });
      });
    });
    svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'bm-routes'); svg.setAttribute('viewBox', `0 0 ${GW} ${GH}`); svg.setAttribute('width', GW); svg.setAttribute('height', GH);
    gRoads = document.createElementNS(svgNS, 'g'); gLines = document.createElementNS(svgNS, 'g'); gPk = document.createElementNS(svgNS, 'g');
    svg.append(gRoads, gLines, gPk); world.appendChild(svg);
    data.links.forEach(addRoute);
    fitStage();
  }

  // ---------- 路线 ----------
  function routePath(a, b) {
    const dx = b.cx - a.cx, dy = b.cy - a.cy, r = 14;
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
        const edge = Math.min(1, Math.min(p.t, 1 - p.t) / 0.08); // 两端渐显渐隐，不突然出现
        p.el.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
        p.el.setAttribute('opacity', edge.toFixed(2));
      }
    }
  }

  // ---------- 尺寸自适应 ----------
  function fitStage() {
    const r = stage.getBoundingClientRect(); if (!r.width || !GW) return;
    const cs = Math.cos(TILT * Math.PI / 180);
    const projW = GW * 1.06, projH = GH * cs * 1.24 + 60; // 前排因透视更大，多留一点下边距
    const k = Math.min((r.width - 28) / projW, (r.height - 40) / projH);
    fit.style.setProperty('--k', k.toFixed(4));
  }
  const ro = new ResizeObserver(fitStage); ro.observe(stage);

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
      const on = !!(spot && spot.routes.has(r.l.id));
      const dim = (spot && !on) || (alertsOnly && !on && r.l.status === 'normal');
      r.line.classList.toggle('hl', on); r.road.classList.toggle('hl', on); r.line.classList.toggle('dim', dim); r.road.classList.toggle('dim', dim);
    }
    for (const z of zones.values()) z.el.classList.toggle('dim', !!spot && ![...spot.nodes].some((n) => blocks.get(n)?.zone === z));
  }
  world.addEventListener('pointerover', (e) => {
    const blk = e.target.closest('.bm-blk'), zone = e.target.closest('.bm-zone');
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
    if (id) { const p = screenOf(id), r = stage.getBoundingClientRect(); fit.style.setProperty('--zx', `${(r.width / 2 - p.x) * 0.5}px`); fit.style.setProperty('--zy', `${(r.height / 2 - p.y) * 0.5}px`); fit.style.setProperty('--z', '1.1'); }
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

  // ---------- 状态条与区域异常数 ----------
  function refreshStats() {
    const flows = [...routes.values()].filter((r) => r.active).length;
    const warn = data.businesses.filter((b) => b.status === 'warning').length, crit = data.businesses.filter((b) => b.status === 'critical').length;
    const terms = data.businesses.reduce((s, b) => s + (b.terminals || 0), 0);
    stats.innerHTML = `<span class="bm-stat"><b>${data.zones.length}</b>业务区域</span><span class="bm-stat"><b>${data.businesses.length}</b>业务</span><span class="bm-stat"><b>${flows}</b>条流转中</span>
      <span class="bm-stat ${crit ? 'crit' : warn ? 'warn' : ''}"><b>${warn + crit}</b>${crit ? `异常 · ${crit} 故障` : '异常'}</span><span class="bm-stat"><b>${fmt(terms)}</b>在线终端</span>`;
    for (const z of zones.values()) { const list = z.z.businesses.map((id) => blocks.get(id)).filter(Boolean); const bad = list.filter((k) => k.b.status !== 'normal').length; z.bad.textContent = bad ? `${bad} 个异常` : ''; z.el.classList.toggle('has-bad', bad > 0); z.el.classList.toggle('has-crit', list.some((k) => k.b.status === 'critical')); }
  }

  // ---------- 开场 ----------
  function playIntro() {
    if (!intro || reduced) { world.classList.remove('pre'); flowsOn = true; return; }
    flowsOn = false;
    for (const r of routes.values()) { r.line.style.strokeDasharray = `${r.len}`; r.line.style.strokeDashoffset = `${r.len}`; r.road.style.opacity = '0'; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      world.classList.remove('pre');
      for (const r of routes.values()) { r.line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1) .9s'; r.line.style.strokeDashoffset = '0'; r.road.style.transition = 'opacity .8s ease 1.2s'; r.road.style.opacity = ''; }
    }));
    setTimeout(() => { for (const r of routes.values()) { r.line.style.transition = ''; r.line.style.strokeDasharray = ''; r.line.style.strokeDashoffset = ''; r.road.style.transition = ''; } flowsOn = true; }, 2200);
  }

  // ---------- 渲染循环（只推进数据包与浮层位置，相机静止） ----------
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

  build(); setLabels(labels); refreshStats(); playIntro();
  raf = requestAnimationFrame(frame);

  // ---------- 对外接口 ----------
  const api = {
    get data() { return data; }, get zones() { return zones; }, get blocks() { return blocks; }, get routes() { return routes; },
    layout: () => ({ GW, GH }),
    // 整体重载：区域 / 业务 / 连接数量变化时重新布局（区域尺寸与排行随之变化）
    setData: (next) => { data = next; pinned = null; hover = null; card.hidden = true; tip.hidden = true; world.classList.add('pre'); build(); refreshStats(); playIntro(); },
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
