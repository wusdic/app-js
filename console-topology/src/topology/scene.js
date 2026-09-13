// 「业务版图」：等距 3D 画布渲染器（纯 Canvas 2D，无依赖，浅色）
// 一块悬浮的玻璃版图，按部门划分街区，每个业务是一座可拔起的方块楼：核心高、重要中、一般低；
// 数据在楼顶之间以光弧飞行；异常业务楼体变色并升起信标；终端是街区地面上游走的微粒。
export const LEVELS = ['core', 'important', 'general'];
export const LEVEL_NAME = { core: '核心业务', important: '重要业务', general: '一般业务' };
export const COLORS = {
  ink: '#15213b', muted: '#6a7890',
  level: { core: '#3563f0', important: '#7ea6ff', general: '#b7c4dc' },
  status: { warning: '#e8950a', critical: '#e5484d' },
  shadow: [28, 52, 110],
  board: { top: ['#ffffff', '#eef3fb'], side: '#d6dfef', edge: 'rgba(60, 84, 140, 0.22)' },
  plate: { top: '#f6f8fd', side: '#dde5f3', edge: 'rgba(60, 84, 140, 0.16)' },
  terminal: [122, 143, 182],
  link: [122, 146, 196], linkActive: [40, 92, 245],
};
// 楼体配色：顶面两端渐变 + 侧面基色（受光 / 背光由法线自动分级）
const TILE = {
  core: { top: ['#6b93ff', '#2f5ff2'], side: '#2953d8', edge: 'rgba(18, 40, 120, 0.45)', label: true },
  important: { top: ['#cfe0ff', '#96baff'], side: '#7fa3ee', edge: 'rgba(40, 70, 150, 0.35)' },
  general: { top: ['#ffffff', '#e9eff9'], side: '#cbd6ea', edge: 'rgba(60, 84, 140, 0.32)' },
  warning: { top: ['#ffd89a', '#f4a52a'], side: '#dd8f1a', edge: 'rgba(150, 90, 0, 0.45)' },
  critical: { top: ['#ffa5a8', '#ef4f56'], side: '#d33d44', edge: 'rgba(140, 20, 30, 0.45)' },
};
export const BOARD = { w: 21, d: 13.5, thick: 0.38, radius: 1.2 };
const PLATE_H = 0.12, FOOT = 1.04, PITCH = 1.6;
const HEIGHT = { core: 2.2, important: 1.25, general: 0.6 };
const TERM_N = { core: 7, important: 5, general: 3 };
const SAMPLES = 26;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
const scaleRgb = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];
const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; };
function roundRectXZ(cx, cz, w, d, r, n = 6) {
  // 世界坐标里的圆角矩形轮廓（顺时针），用于版图与街区
  const pts = []; const hw = w / 2 - r, hd = d / 2 - r;
  const corners = [[hw, -hd, -Math.PI / 2], [hw, hd, 0], [-hw, hd, Math.PI / 2], [-hw, -hd, Math.PI]];
  for (const [ox, oz, a0] of corners) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push([cx + ox + Math.cos(a) * r, cz + oz + Math.sin(a) * r]); }
  return pts;
}
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.sy > py) !== (b.sy > py) && px < ((b.sx - a.sx) * (py - a.sy)) / (b.sy - a.sy) + a.sx) inside = !inside;
  }
  return inside;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.tilt = 0.5; this.yaw = -0.62; this.yawVel = 0;
    this.W = 0; this.H = 0; this.dpr = 1; this.s = 32; this.cx = 0; this.cy = 0;
    this.view = { zoom: 1, ox: 0, oy: 0, tz: 1, tx: 0, ty: 0 };
    this.nodes = []; this.nodeById = new Map(); this.links = []; this.linkById = new Map(); this.districts = [];
    this.layer = 'all'; this.hover = null; this.pinned = null; this.spot = null;
    this.time = 0; this.idle = 99; this.dragging = false; this.autoRotate = true;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.intro = -1; this.boardRev = 1; this.flowsOn = true; this.ripples = []; this.drawOrder = [];
    this.flowStyle = 'wave'; // 'wave'：填充光带（默认）——每次往来光带从发送端注满到接收端再排空，两端有出口 / 入口反馈；'dash'：流向虚线
    this.chips = []; this.lastChipAt = -9; // “谁 → 谁”标签
    this.font = '500 12px Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    this.fontSmall = '600 10.5px Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    this.boardOutline = roundRectXZ(0, 0, BOARD.w, BOARD.d, BOARD.radius, 8);
    this._p = { sx: 0, sy: 0, d: 0 };
  }

  // ---------- 数据与版图布局 ----------
  setData(data) {
    this.data = data; this.nodes = []; this.nodeById.clear(); this.links = []; this.linkById.clear(); this.districts = []; this.ripples = [];
    // 街区：按部门分组，3 × 2 排布；街区内核心楼在后排、一般楼在前排
    const groups = new Map();
    for (const b of data.businesses) { if (!groups.has(b.dept)) groups.set(b.dept, []); groups.get(b.dept).push(b); }
    const order = { core: 0, important: 1, general: 2 };
    const depts = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const cols = 3, rows = Math.ceil(depts.length / cols);
    const cellW = (BOARD.w - 1.4) / cols, cellD = (BOARD.d - 1.2) / rows;
    depts.forEach(([dept, list], di) => {
      list.sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name, 'zh'));
      const ci = di % cols, ri = Math.floor(di / cols);
      const cx = -BOARD.w / 2 + 0.7 + cellW * (ci + 0.5), cz = -BOARD.d / 2 + 0.6 + cellD * (ri + 0.5);
      const perRow = Math.min(4, Math.ceil(Math.sqrt(list.length * 1.3)));
      const nRows = Math.ceil(list.length / perRow);
      const w = perRow * PITCH + 0.9, d = nRows * PITCH + 1.3;
      const district = { dept, cx, cz, w, d, outline: roundRectXZ(cx, cz, w, d, 0.55, 5), list: [], reveal: 1 };
      list.forEach((b, i) => {
        const r = Math.floor(i / perRow), c = i % perRow, inRow = Math.min(perRow, list.length - r * perRow);
        const x = cx + (c - (inRow - 1) / 2) * PITCH, z = cz - d / 2 + 0.95 + r * PITCH;
        const n = this.addNode(b, x, z); n.district = district; district.list.push(n);
      });
      this.districts.push(district);
    });
    for (const l of data.links) this.addLink(l);
  }
  addNode(b, x, z) {
    const lv = b.level;
    const n = { id: b.id, b, level: lv, x, z, h: HEIGHT[lv], phase: hash(b.id) * 6.28, reveal: 1, hoverK: 0, layerA: 1, lift: 0, cols: null, colT: null, top: { sx: 0, sy: 0, d: 0 }, base: { sx: 0, sy: 0, d: 0 }, poly: null, terminals: [], nextRipple: 0, labelOn: lv === 'core', d: 0, tx: 0, rx: 0, col: null, colR: null };
    this.retarget(n); n.cols = { t0: n.colT.t0.slice(), t1: n.colT.t1.slice(), s: n.colT.s.slice() }; n.col = n.colR.slice();
    this.setTerminalCount(n, b.terminals);
    this.nodes.push(n); this.nodeById.set(b.id, n);
    return n;
  }
  retarget(n) {
    const st = n.b.status, p = st === 'critical' ? TILE.critical : st === 'warning' ? TILE.warning : TILE[n.level];
    n.colT = { t0: hexRgb(p.top[0]), t1: hexRgb(p.top[1]), s: hexRgb(p.side), edge: p.edge };
    n.colR = hexRgb(st === 'critical' ? COLORS.status.critical : st === 'warning' ? COLORS.status.warning : COLORS.level[n.level]); // 连线与反馈用的代表色
  }
  setTerminalCount(n, count) {
    const want = clamp(Math.round(TERM_N[n.level] * (0.6 + Math.log10(1 + count) * 0.2)), 2, 10);
    while (n.terminals.length < want) n.terminals.push({ x: (Math.random() - 0.5) * 1.35, z: (Math.random() - 0.5) * 1.35, vx: 0, vz: 0, ph: Math.random() * 6.28, life: 0, size: 1.2 + Math.random() * 0.9 });
    while (n.terminals.length > want) n.terminals.pop();
    n.b.terminals = count;
  }
  addLink(l) {
    const a = this.nodeById.get(l.from), b = this.nodeById.get(l.to); if (!a || !b) return null;
    const A = [a.x, PLATE_H + a.h, a.z], B = [b.x, PLATE_H + b.h, b.z];
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const lift = 0.9 + dist * 0.16;
    const M = [(A[0] + B[0]) / 2, Math.max(A[1], B[1]) + lift, (A[2] + B[2]) / 2];
    const pts3 = [];
    for (let i = 0; i < SAMPLES; i++) { const t = i / (SAMPLES - 1), u = 1 - t; pts3.push([u * u * A[0] + 2 * u * t * M[0] + t * t * B[0], u * u * A[1] + 2 * u * t * M[1] + t * t * B[1], u * u * A[2] + 2 * u * t * M[2] + t * t * B[2]]); }
    const rec = { id: l.id, l, a, b, pts3, pts2: pts3.map(() => ({ sx: 0, sy: 0, d: 0 })), len3: dist * 1.15, lenPx: 1, active: false, activeK: 0, waves: [], alpha: 0, transient: !!l.transient, born: this.time, dieAt: l.transient ? this.time + (l.ttl || 10) : Infinity, dying: false };
    this.links.push(rec); this.linkById.set(l.id, rec);
    return rec;
  }
  removeLink(id) { const rec = this.linkById.get(id); if (!rec) return; this.linkById.delete(id); this.links.splice(this.links.indexOf(rec), 1); }
  linksOf(id) { return this.links.filter((l) => l.a.id === id || l.b.id === id); }
  // 一次数据往来：发送端泛出一圈；光带从发送端注满到接收端（时长随线长），到达时接收端亮起并轻弹，停留后从发送端一侧排空
  touch(id, dir = 1) {
    const rec = this.linkById.get(id); if (!rec || !this.flowsOn) return;
    (dir > 0 ? rec.a : rec.b).tx = 1;
    if (rec.waves.length >= 2) return;
    const fill = clamp(rec.len3 / 7, 0.5, 1.4);
    rec.waves.push({ t0: this.time, dir, fill, hold: 0.5, drain: fill * 0.9, arrived: false });
    const inSpot = this.spot && this.spot.links.has(id);
    if ((this.time - this.lastChipAt > 1.6 || inSpot) && this.chips.length < 5) { this.chips.push({ l: rec, dir, t0: this.time, dur: 2.4 }); this.lastChipAt = this.time; }
  }
  pulse(id, dir = 1) { this.touch(id, dir); }
  setActive(id, on) { const rec = this.linkById.get(id); if (rec) rec.active = on; }
  spotlightFor(nodeId) { const ls = this.linksOf(nodeId); const ns = new Set([nodeId]); for (const l of ls) { ns.add(l.a.id); ns.add(l.b.id); } return { anchor: nodeId, nodes: ns, links: new Set(ls.map((l) => l.id)) }; }

  // ---------- 相机 ----------
  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    const R = 10.4, RW = 12.2; // 版图在屏幕上的半深 / 半宽（按常见视角估算）
    const top = -(R * this.tilt) - HEIGHT.core - 0.9, bottom = R * this.tilt + BOARD.thick + 0.4;
    this.s = Math.min((W * 0.94) / (2 * RW), (H * 0.94) / (bottom - top));
    this.cx = W / 2; this.cy = H / 2 - ((top + bottom) / 2) * this.s;
  }
  project(x, y, z, out) {
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw), v = this.view, k = this.s * v.zoom;
    const px = x * cs - z * sn, d = x * sn + z * cs;
    out = out || { sx: 0, sy: 0, d: 0 };
    out.sx = this.cx + v.ox + px * k; out.sy = this.cy + v.oy + (d * this.tilt - y) * k; out.d = d;
    return out;
  }
  screenOf(nodeId) { const n = this.nodeById.get(nodeId); return n ? { x: n.top.sx, y: (n.top.sy + n.base.sy) / 2, r: this.nodeR(n) } : null; }
  nodeR(n) { return FOOT * this.s * this.view.zoom * 0.75; }
  startIntro() { if (this.reduced) return; this.intro = 0; this.boardRev = 0; for (const d of this.districts) d.reveal = 0; for (const n of this.nodes) n.reveal = 0; }
  resetView() { this.pinned = null; this.view.tz = 1; this.view.tx = 0; this.view.ty = 0; this.yawVel = (-0.62 - this.yaw) * 2; }
  hitTest(px, py) {
    for (let i = this.drawOrder.length - 1; i >= 0; i--) { const n = this.drawOrder[i]; if (!n.poly) continue; if (pointInPoly(px, py, n.poly.top) || n.poly.sides.some((s) => pointInPoly(px, py, s))) return n; }
    return null;
  }

  // ---------- 每帧更新 ----------
  update(dt) {
    this.time += dt; this.idle += dt;
    const v = this.view;
    if (this.intro >= 0) {
      this.intro += dt;
      this.boardRev = easeOutCubic(clamp(this.intro / 0.8, 0, 1));
      this.districts.forEach((d, i) => { d.reveal = easeOutCubic(clamp((this.intro - 0.35 - i * 0.08) / 0.5, 0, 1)); });
      for (const n of this.nodes) { const di = this.districts.indexOf(n.district), ii = n.district.list.indexOf(n); n.reveal = easeOutBack(clamp((this.intro - 0.6 - di * 0.08 - ii * 0.05) / 0.55, 0, 1)); }
      if (this.intro > 2.6) { this.intro = -1; this.boardRev = 1; for (const d of this.districts) d.reveal = 1; for (const n of this.nodes) n.reveal = 1; }
    }
    if (!this.dragging) {
      if (Math.abs(this.yawVel) > 1e-4) { this.yaw += this.yawVel * dt; this.yawVel *= Math.exp(-dt * 3.2); }
      else if (this.autoRotate && !this.reduced && this.idle > 2.5 && !this.pinned && !this.hover) this.yaw += 0.045 * dt;
    }
    const kz = 1 - Math.exp(-dt * 4);
    v.zoom = lerp(v.zoom, v.tz, kz);
    if (this.pinned) { const n = this.nodeById.get(this.pinned); if (n) { const p = this.project(n.x, PLATE_H + n.h * 0.5, n.z); v.tx = v.ox + (this.W * 0.5 - p.sx); v.ty = v.oy + (this.H * 0.55 - p.sy); } }
    v.ox = lerp(v.ox, v.tx, kz); v.oy = lerp(v.oy, v.ty, kz);

    const spot = this.spot, cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    for (const n of this.nodes) {
      const inLayer = this.layer === 'all' || n.level === this.layer, abnormal = n.b.status !== 'normal';
      let target = inLayer ? 1 : abnormal ? 0.85 : 0.3;
      if (spot) target *= spot.nodes.has(n.id) ? 1 : 0.3;
      n.layerA = lerp(n.layerA, target, 1 - Math.exp(-dt * 6));
      const hv = this.hover === n.id || this.pinned === n.id ? 1 : spot && spot.nodes.has(n.id) ? 0.3 : 0;
      n.hoverK = lerp(n.hoverK, hv, 1 - Math.exp(-dt * 9));
      for (const key of ['t0', 't1', 's']) for (let i = 0; i < 3; i++) n.cols[key][i] = lerp(n.cols[key][i], n.colT[key][i], 1 - Math.exp(-dt * 5));
      for (let i = 0; i < 3; i++) n.col[i] = lerp(n.col[i], n.colR[i], 1 - Math.exp(-dt * 5));
      n.tx = Math.max(0, n.tx - dt / 0.9); n.rx = Math.max(0, n.rx - dt / 1.1);
      n.d = n.x * sn + n.z * cs;
      // 终端微粒：在楼体周围的街区地面上缓慢游走
      for (const t of n.terminals) {
        t.life = Math.min(1, t.life + dt * 0.8);
        t.vx += (Math.random() - 0.5) * dt * 0.8; t.vz += (Math.random() - 0.5) * dt * 0.8;
        t.vx *= 0.94; t.vz *= 0.94; t.x += t.vx * dt; t.z += t.vz * dt;
        const r = Math.hypot(t.x, t.z); if (r > 0.95) { t.x *= 0.95 / r; t.z *= 0.95 / r; t.vx *= -0.5; t.vz *= -0.5; }
        if (r < 0.62) { const k = 0.62 / Math.max(0.01, r); t.x *= k; t.z *= k; }
      }
      if (abnormal && !this.reduced) { n.nextRipple -= dt; if (n.nextRipple <= 0) { this.ripples.push({ n, born: this.time, dur: 2.0 }); n.nextRipple = n.b.status === 'critical' ? 2.6 : 3.6; } }
      n.labelOn = (this.layer === 'all' ? n.level === 'core' : n.level === this.layer) || abnormal || (spot && spot.nodes.has(n.id)) || this.hover === n.id || this.pinned === n.id;
      this.projectNode(n);
    }
    this.ripples = this.ripples.filter((r) => this.time - r.born < r.dur);
    for (const l of this.links) {
      for (let i = 0; i < SAMPLES; i++) { const p = l.pts3[i]; this.project(p[0], p[1], p[2], l.pts2[i]); }
      let len = 0; for (let i = 1; i < SAMPLES; i++) len += Math.hypot(l.pts2[i].sx - l.pts2[i - 1].sx, l.pts2[i].sy - l.pts2[i - 1].sy); l.lenPx = Math.max(1, len);
      l.activeK = lerp(l.activeK, l.active ? 1 : 0, 1 - Math.exp(-dt * 3));
      for (let i = l.waves.length - 1; i >= 0; i--) {
        const w = l.waves[i], tau = this.time - w.t0;
        if (!w.arrived && tau >= w.fill) { w.arrived = true; (w.dir > 0 ? l.b : l.a).rx = 1; }
        if (tau > w.fill + w.hold + w.drain) l.waves.splice(i, 1);
      }
      const inA = this.layer === 'all' || l.a.level === this.layer, inB = this.layer === 'all' || l.b.level === this.layer;
      let target = inA && inB ? 1 : inA || inB ? 0.5 : 0.15;
      if (spot) target *= spot.links.has(l.id) ? 1 : 0.15;
      if (l.transient) { const age = this.time - l.born, left = l.dieAt - this.time; target *= clamp(age / 0.6, 0, 1) * clamp(left / 0.8, 0, 1); if (left <= 0) l.dying = true; }
      if (this.intro >= 0) target *= clamp((this.intro - 1.5) / 0.8, 0, 1);
      l.alpha = lerp(l.alpha, target, 1 - Math.exp(-dt * 6));
    }
    for (const l of this.links.filter((x) => x.dying)) this.removeLink(l.id);
    this.drawOrder = this.nodes.slice().sort((a, b) => a.d - b.d);
  }
  // 楼体八个角点投影 + 可见面判定（顶面 + 朝向观察者的两个侧面）
  projectNode(n) {
    const rv = clamp(n.reveal, 0, 1.15), h = n.h * rv, lift = n.hoverK * 0.28 + (1 - Math.min(1, rv)) * 0.6 + Math.sin(Math.min(1, 1 - n.rx) * Math.PI) * 0.1 * (n.rx > 0 ? 1 : 0);
    const y0 = PLATE_H + lift, y1 = y0 + h, hw = FOOT / 2;
    const cxz = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
    const T = cxz.map(([ox, oz]) => this.project(n.x + ox, y1, n.z + oz));
    const Bt = cxz.map(([ox, oz]) => this.project(n.x + ox, y0, n.z + oz));
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    // 四个侧面：法线 (-z) (+x) (+z) (-x)；可见 = 法线朝向观察者；受光按法线在屏幕上的朝向分级
    const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const sides = [];
    normals.forEach(([nx, nz], i) => {
      const facing = nx * sn + nz * cs; if (facing <= 0) return;
      const j = (i + 1) % 4; const screenNx = nx * cs - nz * sn;
      sides.push({ poly: [T[i], T[j], Bt[j], Bt[i]], shade: 0.68 + 0.32 * (0.5 - 0.5 * screenNx), facing });
    });
    this.project(n.x, y1, n.z, n.top); this.project(n.x, PLATE_H, n.z, n.base);
    n.poly = { top: T, bottom: Bt, sides: sides.map((s) => s.poly), sideInfo: sides, y0, y1, lift };
  }

  // ---------- 绘制 ----------
  draw() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (this.boardRev <= 0.001) return;
    this.drawBoard();
    for (const d of this.districts) this.drawDistrict(d);
    for (const n of this.nodes) this.drawTerminals(n);
    for (const r of this.ripples) this.drawRipple(r);
    for (const n of this.drawOrder) this.drawFeedback(n);
    for (const n of this.drawOrder) this.drawShadow(n);
    for (const n of this.drawOrder) this.drawTile(n);
    for (const l of this.links) this.drawLink(l);
    for (const n of this.drawOrder) if (n.b.status !== 'normal' && n.reveal > 0.9) this.drawBeacon(n);
    for (const d of this.districts) this.drawDistrictLabel(d);
    for (const n of this.drawOrder) if (n.labelOn && n.layerA > 0.3 && n.reveal > 0.9) this.drawLabel(n);
    this.drawChips();
  }
  path(pts) { const c = this.ctx; c.beginPath(); c.moveTo(pts[0].sx, pts[0].sy); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].sx, pts[i].sy); c.closePath(); }
  outline(xz, y) { return xz.map(([x, z]) => this.project(x, y, z)); }

  drawBoard() {
    const ctx = this.ctx, k = this.boardRev;
    const top = this.outline(this.boardOutline, 0), bot = this.outline(this.boardOutline, -BOARD.thick);
    let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9; for (const p of top) { minY = Math.min(minY, p.sy); maxY = Math.max(maxY, p.sy); minX = Math.min(minX, p.sx); maxX = Math.max(maxX, p.sx); }
    ctx.save(); ctx.globalAlpha = k;
    // 大投影：让版图悬浮起来
    const c = this.project(0, -BOARD.thick, 0);
    const sh = ctx.createRadialGradient(c.sx, c.sy + 26, 10, c.sx, c.sy + 26, (maxX - minX) * 0.62);
    sh.addColorStop(0, rgba(COLORS.shadow, 0.18)); sh.addColorStop(0.6, rgba(COLORS.shadow, 0.07)); sh.addColorStop(1, rgba(COLORS.shadow, 0));
    ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(c.sx, c.sy + 26, (maxX - minX) * 0.62, (maxY - minY) * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    // 厚度（下轮廓）+ 顶面
    this.path(bot); ctx.fillStyle = COLORS.board.side; ctx.fill();
    const g = ctx.createLinearGradient(minX, minY, maxX, maxY); g.addColorStop(0, COLORS.board.top[0]); g.addColorStop(1, COLORS.board.top[1]);
    this.path(top); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = COLORS.board.edge; ctx.lineWidth = 1; ctx.stroke();
    // 顶面细网格
    ctx.save(); this.path(top); ctx.clip();
    ctx.strokeStyle = 'rgba(80, 110, 170, 0.09)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = -BOARD.w / 2; x <= BOARD.w / 2 + 0.01; x += 1.5) { const a = this.project(x, 0, -BOARD.d / 2), b = this.project(x, 0, BOARD.d / 2); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
    for (let z = -BOARD.d / 2; z <= BOARD.d / 2 + 0.01; z += 1.5) { const a = this.project(-BOARD.w / 2, 0, z), b = this.project(BOARD.w / 2, 0, z); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
    ctx.stroke();
    // 玻璃高光：每 11 秒一道斜向光带扫过
    if (!this.reduced) {
      const ph = (this.time % 11) / 11; if (ph < 0.32) {
        const x = minX - 200 + (maxX - minX + 400) * (ph / 0.32);
        const lg = ctx.createLinearGradient(x - 90, 0, x + 90, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.55)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg; ctx.save(); ctx.transform(1, 0, -0.55, 1, 0, 0); ctx.fillRect(x - 90 + minY * 0.55, minY - 10, 180, maxY - minY + 20); ctx.restore();
      }
    }
    ctx.restore();
    // 顶面近缘的一线高光
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2; this.path(top); ctx.stroke();
    ctx.restore();
  }

  drawDistrict(d) {
    const ctx = this.ctx, k = d.reveal * this.boardRev; if (k <= 0.01) return;
    const top = this.outline(d.outline, PLATE_H * k), bot = this.outline(d.outline, 0);
    ctx.save(); ctx.globalAlpha = k;
    this.path(bot); ctx.fillStyle = COLORS.plate.side; ctx.fill();
    this.path(top); ctx.fillStyle = COLORS.plate.top; ctx.fill(); ctx.strokeStyle = COLORS.plate.edge; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  drawDistrictLabel(d) {
    const ctx = this.ctx, k = d.reveal; if (k < 0.6) return;
    const pts = this.outline(d.outline, PLATE_H); let maxY = -1e9, sx = 0; for (const p of pts) { maxY = Math.max(maxY, p.sy); sx += p.sx; } sx /= pts.length;
    const bad = d.list.filter((n) => n.b.status !== 'normal').length;
    ctx.globalAlpha = k * 0.95; ctx.font = this.fontSmall; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const text = `${d.dept} · ${d.list.length}${bad ? ` · ${bad} 异常` : ''}`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(text, sx, maxY + 4);
    ctx.fillStyle = bad ? COLORS.status.warning : COLORS.muted; ctx.fillText(text, sx, maxY + 4);
    ctx.globalAlpha = 1;
  }

  drawTerminals(n) {
    const ctx = this.ctx, a = n.layerA * clamp(n.reveal, 0, 1) * 0.85; if (a < 0.02) return;
    const k = this.s * this.view.zoom / 32, p = this._p;
    for (const t of n.terminals) {
      this.project(n.x + t.x, PLATE_H, n.z + t.z, p);
      const tw = 0.6 + 0.4 * Math.sin(this.time * 1.3 + t.ph);
      ctx.fillStyle = rgba(COLORS.terminal, a * t.life * (0.4 + 0.5 * tw));
      ctx.beginPath(); ctx.arc(p.sx, p.sy, t.size * k, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawRipple(r) {
    const ctx = this.ctx, n = r.n, p = (this.time - r.born) / r.dur, k = this.s * this.view.zoom;
    const rgb = hexRgb(n.b.status === 'critical' ? COLORS.status.critical : COLORS.status.warning);
    const rad = FOOT * 0.7 + 1.6 * easeOutCubic(p);
    const pts = this.outline(roundRectXZ(n.x, n.z, rad * 2, rad * 2, rad * 0.7, 4), PLATE_H + 0.01);
    ctx.strokeStyle = rgba(rgb, Math.pow(1 - p, 1.6) * 0.55 * n.layerA); ctx.lineWidth = 1.5 * Math.max(0.6, k / 32);
    this.path(pts); ctx.stroke();
  }

  drawShadow(n) {
    const ctx = this.ctx, a = n.layerA * clamp(n.reveal, 0, 1); if (a < 0.02) return;
    const P = n.poly, lift = P.lift;
    // 楼体在街区上的接触阴影：随悬浮升高而变淡变大
    ctx.globalAlpha = a * (0.16 - lift * 0.12);
    const off = 3 + lift * 10, base = this.outline([[n.x - FOOT / 2 - 0.08, n.z - FOOT / 2 - 0.08], [n.x + FOOT / 2 + 0.08, n.z - FOOT / 2 - 0.08], [n.x + FOOT / 2 + 0.08, n.z + FOOT / 2 + 0.08], [n.x - FOOT / 2 - 0.08, n.z + FOOT / 2 + 0.08]], PLATE_H);
    ctx.fillStyle = rgba(COLORS.shadow, 1);
    ctx.beginPath(); ctx.moveTo(base[0].sx + off * 0.6, base[0].sy + off); for (let i = 1; i < 4; i++) ctx.lineTo(base[i].sx + off * 0.6, base[i].sy + off); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawTile(n) {
    const ctx = this.ctx, a = n.layerA * clamp(n.reveal, 0, 1); if (a < 0.02 || n.reveal <= 0) return;
    const P = n.poly, C = n.cols;
    ctx.globalAlpha = a;
    for (const s of P.sideInfo) {
      this.path(s.poly); ctx.fillStyle = rgba(scaleRgb(C.s, s.shade), 1); ctx.fill();
      ctx.strokeStyle = n.colT.edge; ctx.lineWidth = 0.8; ctx.stroke();
    }
    // 顶面：远角亮、近角深的渐变 + 玻璃高光边
    const T = P.top; let minY = 1e9, maxY = -1e9; for (const p of T) { minY = Math.min(minY, p.sy); maxY = Math.max(maxY, p.sy); }
    const g = ctx.createLinearGradient(0, minY, 0, maxY); g.addColorStop(0, rgba(C.t0, 1)); g.addColorStop(1, rgba(C.t1, 1));
    this.path(T); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.stroke();
    // 接收：顶面亮起一层白光（随后淡去）
    if (n.rx > 0.01) { ctx.fillStyle = rgba([255, 255, 255], 0.55 * n.rx); this.path(T); ctx.fill(); }
    // 悬停 / 锁定：顶面外一圈发光描边
    if (n.hoverK > 0.02) { ctx.strokeStyle = rgba(COLORS.linkActive, 0.7 * n.hoverK); ctx.lineWidth = 2.5; this.path(T); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // 发送：楼体脚下一圈光泛出；接收：一圈光收拢进楼体
  drawFeedback(n) {
    if (n.tx < 0.01 && n.rx < 0.01) return;
    const ctx = this.ctx, k = this.s * this.view.zoom;
    const ring = (rad, a, w = 1.5) => { const pts = this.outline(roundRectXZ(n.x, n.z, rad * 2, rad * 2, rad * 0.6, 4), PLATE_H + 0.015); ctx.strokeStyle = rgba(n.col, a * n.layerA); ctx.lineWidth = w * Math.max(0.6, k / 32); this.path(pts); ctx.stroke(); };
    if (n.tx > 0.01) ring(FOOT * 0.65 + 1.1 * easeOutCubic(1 - n.tx), n.tx * 0.6);
    if (n.rx > 0.01) ring(FOOT * 0.65 + 1.0 * (1 - easeOutCubic(1 - n.rx)), n.rx * 0.6, 2);
  }

  // 异常信标：楼顶升起的菱形标记，缓慢起伏
  drawBeacon(n) {
    const ctx = this.ctx, rgb = hexRgb(n.b.status === 'critical' ? COLORS.status.critical : COLORS.status.warning);
    const k = this.s * this.view.zoom, bob = Math.sin(this.time * 2 + n.phase) * 0.08;
    const top = n.top, p = this.project(n.x, n.poly.y1 + 0.75 + bob, n.z), sz = 0.19 * k;
    ctx.globalAlpha = n.layerA;
    ctx.strokeStyle = rgba(rgb, 0.7); ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(p.sx, p.sy + sz); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(rgb, 0.18); ctx.beginPath(); ctx.arc(p.sx, p.sy, sz * 2.1 * (1 + 0.15 * Math.sin(this.time * 3)), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(rgb, 1); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.sx, p.sy - sz); ctx.lineTo(p.sx + sz * 0.8, p.sy); ctx.lineTo(p.sx, p.sy + sz); ctx.lineTo(p.sx - sz * 0.8, p.sy); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  pointAt(l, t, out) {
    t = clamp(t, 0, 1); const f = t * (SAMPLES - 1), i = Math.min(SAMPLES - 2, Math.floor(f)), u = f - i;
    const a = l.pts2[i], b = l.pts2[i + 1]; out = out || {}; out.sx = a.sx + (b.sx - a.sx) * u; out.sy = a.sy + (b.sy - a.sy) * u; return out;
  }
  drawLink(l) {
    const ctx = this.ctx; if (l.alpha < 0.02) return;
    const st = l.l.status, wave = this.flowStyle !== 'dash';
    const spotOn = this.spot && this.spot.links.has(l.id);
    const inset = 0.015, p0 = l.pts2[0], p1 = l.pts2[SAMPLES - 1];
    const path = () => { ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); for (let i = 1; i < SAMPLES; i++) ctx.lineTo(l.pts2[i].sx, l.pts2[i].sy); };
    const abnormalRgb = st === 'critical' ? hexRgb(COLORS.status.critical) : st === 'warning' ? hexRgb(COLORS.status.warning) : null;
    const k = l.activeK;
    // 底线：有连接即有一条极淡的实线；持续流转的连接是一条从发送端色到接收端色的细渐变线；异常连接用状态色并慢速呼吸
    let baseA = (abnormalRgb ? 0.75 : wave ? 0.09 + 0.2 * k : 0.14 + 0.1 * k) * l.alpha;
    if (st === 'critical') baseA *= 0.7 + 0.3 * Math.sin(this.time * 2.0);
    if (spotOn) baseA = Math.max(baseA, 0.6 * l.alpha);
    ctx.lineWidth = abnormalRgb ? 1.6 : 1 + (spotOn ? 0.4 : 0);
    if (wave && !abnormalRgb && k > 0.02) {
      const g = ctx.createLinearGradient(p0.sx, p0.sy, p1.sx, p1.sy); g.addColorStop(0, rgba(l.a.col, baseA)); g.addColorStop(1, rgba(l.b.col, baseA));
      ctx.strokeStyle = g; ctx.lineWidth = 1 + 0.5 * k + (spotOn ? 0.4 : 0);
    } else ctx.strokeStyle = rgba(abnormalRgb || COLORS.link, baseA);
    if (l.transient) ctx.setLineDash([5, 5]);
    path(); ctx.stroke(); ctx.setLineDash([]);
    // 落在楼顶的端点
    for (const [p, n] of [[p0, l.a], [p1, l.b]]) { ctx.fillStyle = rgba(n.col, Math.min(1, baseA * 1.6)); ctx.beginPath(); ctx.arc(p.sx, p.sy, 2, 0, Math.PI * 2); ctx.fill(); }
    if (abnormalRgb) return;
    if (wave) {
      // 入口：持续流转时接收端一枚小箭头“进入”业务（双向两端都有）；每次往来的光带见 drawWave
      if (k > 0.04) { const aa = l.alpha * k * (spotOn ? 1 : this.spot ? 0.5 : 0.7); this.arrowAt(l, 1 - inset, 1, l.b.col, aa, 4.6); if (l.l.dir === 2) this.arrowAt(l, inset, -1, l.a.col, aa, 4.6); }
      for (const w of l.waves) this.drawWave(l, w, inset, 1 - inset, spotOn);
      return;
    }
    if (k < 0.04) return;
    // 流向虚线模式：整条线从发送端颜色渐变到接收端颜色，虚线沿数据方向流动，端点有明确的“出口”与“入口”
    const a = l.alpha * k * (spotOn ? 1 : this.spot ? 0.5 : 0.78);
    const grad = ctx.createLinearGradient(p0.sx, p0.sy, p1.sx, p1.sy);
    grad.addColorStop(0, rgba(l.a.col, a)); grad.addColorStop(1, rgba(l.b.col, a));
    ctx.lineWidth = 1.9 + (spotOn ? 0.5 : 0);
    ctx.strokeStyle = grad; ctx.globalAlpha = 0.28; path(); ctx.stroke(); ctx.globalAlpha = 1;
    const speed = 42 * this.view.zoom, both = l.l.dir === 2;
    const strokeDash = (dir, phase) => { ctx.setLineDash(both ? [7, 15] : [9, 11]); ctx.lineDashOffset = -dir * this.time * speed + phase; path(); ctx.stroke(); };
    ctx.strokeStyle = grad;
    if (both) { strokeDash(1, 0); strokeDash(-1, 11); } else strokeDash(1, 0);
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    this.arrowAt(l, 1 - inset, 1, l.b.col, a, 5.5);
    if (both) this.arrowAt(l, inset, -1, l.a.col, a, 5.5);
    else { ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(l.a.col, a); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p0.sx, p0.sy, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }

  // 填充光带：注满（发送端 → 接收端）→ 停留 → 排空（从发送端一侧收起，最后消失在接收端）。光带整段可见，起点与终点一目了然
  drawWave(l, w, lo, hi, spotOn) {
    const ctx = this.ctx, tau = this.time - w.t0;
    let s0 = 0, e0 = 0;
    if (tau < w.fill) e0 = easeOutCubic(tau / w.fill);
    else if (tau < w.fill + w.hold) e0 = 1;
    else { e0 = 1; s0 = easeInCubic(clamp((tau - w.fill - w.hold) / w.drain, 0, 1)); }
    if (e0 - s0 <= 0.003) return;
    const map = (u) => (w.dir > 0 ? lo + (hi - lo) * u : hi - (hi - lo) * u);
    const t1 = map(s0), t2 = map(e0);
    const from = w.dir > 0 ? l.a : l.b, to = w.dir > 0 ? l.b : l.a;
    const a = l.alpha * (spotOn ? 1 : this.spot ? 0.4 : 0.9);
    const N = 16, pts = [];
    for (let i = 0; i <= N; i++) pts.push(this.pointAt(l, t1 + ((t2 - t1) * i) / N, {}));
    const trace = (m = 0) => { ctx.beginPath(); ctx.moveTo(pts[m].sx, pts[m].sy); for (let i = m + 1; i <= N; i++) ctx.lineTo(pts[i].sx, pts[i].sy); };
    const g = ctx.createLinearGradient(pts[0].sx, pts[0].sy, pts[N].sx, pts[N].sy);
    g.addColorStop(0, rgba(from.col, a)); g.addColorStop(1, rgba(to.col, a));
    ctx.strokeStyle = g;
    ctx.globalAlpha = 0.14; ctx.lineWidth = 10; trace(); ctx.stroke(); // 柔光
    ctx.globalAlpha = 1; ctx.lineWidth = 2.6; trace(); ctx.stroke();  // 光带
    if (tau < w.fill) { ctx.strokeStyle = rgba([255, 255, 255], a * 0.75); ctx.lineWidth = 1.1; trace(N - 3); ctx.stroke(); } // 注满前沿的白芯
  }

  // “谁 → 谁”标签：每次往来在光带中点短暂标出收发双方（全局约 1.6 秒最多一枚，聚光时相关连接都标）
  drawChips() {
    const ctx = this.ctx;
    this.chips = this.chips.filter((c) => this.time - c.t0 < c.dur && this.linkById.has(c.l.id));
    if (!this.chips.length) return;
    ctx.font = this.fontSmall; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const c of this.chips) {
      const tau = this.time - c.t0, k = Math.min(1, tau / 0.25) * Math.min(1, (c.dur - tau) / 0.5);
      const a = k * c.l.alpha; if (a < 0.03) continue;
      const from = c.dir > 0 ? c.l.a : c.l.b, to = c.dir > 0 ? c.l.b : c.l.a;
      const text = `${from.b.name} → ${to.b.name}`;
      const p = this.pointAt(c.l, 0.5, {}), w = ctx.measureText(text).width + 18, h = 20;
      const x = p.sx - w / 2, y = p.sy - 14 - h + 4 * (1 - k);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = 'rgba(188, 203, 230, 0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = COLORS.ink; ctx.fillText(text, p.sx, y + h / 2 + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  arrowAt(l, t, dir, rgb, a, sz) {
    const ctx = this.ctx, p = this.pointAt(l, t), q = this.pointAt(l, t - 0.03 * dir);
    const an = Math.atan2(p.sy - q.sy, p.sx - q.sx);
    ctx.fillStyle = rgba(rgb, a);
    ctx.beginPath(); ctx.moveTo(p.sx + Math.cos(an) * sz * 0.4, p.sy + Math.sin(an) * sz * 0.4);
    ctx.lineTo(p.sx + Math.cos(an + 2.55) * sz, p.sy + Math.sin(an + 2.55) * sz); ctx.lineTo(p.sx + Math.cos(an - 2.55) * sz, p.sy + Math.sin(an - 2.55) * sz); ctx.closePath(); ctx.fill();
  }

  drawLabel(n) {
    const ctx = this.ctx, abnormal = n.b.status !== 'normal';
    const text = abnormal ? `${n.b.status === 'critical' ? '故障' : '告警'} · ${n.b.name}` : n.b.name;
    const y = abnormal ? this.project(n.x, n.poly.y1 + 1.15, n.z).sy - 6 : n.top.sy - 7;
    ctx.globalAlpha = n.layerA; ctx.font = abnormal ? this.font.replace('500', '600') : this.font; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, n.top.sx, y);
    ctx.fillStyle = abnormal ? (n.b.status === 'critical' ? COLORS.status.critical : COLORS.status.warning) : COLORS.ink; ctx.fillText(text, n.top.sx, y);
    ctx.globalAlpha = 1;
  }
}
