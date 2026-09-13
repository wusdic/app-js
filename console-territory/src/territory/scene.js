// 业务版图：等轴测（可旋转）的浅色立体沙盘
// 六个业务区域是带厚度的圆角基板，区域内每个业务是一块立方体（高度 = 实时负载）；区域之间的地面通道上跑着数据流
// 纯 Canvas 2D，无第三方依赖
export const COLORS = {
  ink: '#101a33', muted: '#67718a',
  warning: '#f59e0b', critical: '#ef4444',
  road: [96, 114, 168], grid: [90, 110, 160], shadow: [24, 44, 96],
};
const T = 0.52;           // 竖向压缩比（2:1 附近的轴测）
const PITCH = 1.5;        // 区域内方块间距
const SLAB_T = 0.34;      // 基板厚度
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
const mix = (c, t, k) => [lerp(c[0], t[0], k), lerp(c[1], t[1], k), lerp(c[2], t[2], k)];
const WHITE = [255, 255, 255], BLACK = [12, 20, 48];
const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; };
const pointInPoly = (px, py, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.sy > py) !== (b.sy > py) && px < ((b.sx - a.sx) * (py - a.sy)) / (b.sy - a.sy) + a.sx) inside = !inside; } return inside; };

function roundedRect(cx, cz, w, d, r, n = 7) {
  const pts = []; const hw = w / 2 - r, hd = d / 2 - r;
  const corners = [[hw, hd, 0], [-hw, hd, Math.PI / 2], [-hw, -hd, Math.PI], [hw, -hd, -Math.PI / 2]];
  for (const [ox, oz, a0] of corners) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push([cx + ox + Math.cos(a) * r, cz + oz + Math.sin(a) * r]); }
  return pts;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.yaw = Math.PI / 4; this.yawVel = 0; this.yaw0 = Math.PI / 4;
    this.W = 0; this.H = 0; this.dpr = 1; this.s = 36; this.cx = 0; this.cy = 0;
    this.view = { zoom: 1, tz: 1, ox: 0, oy: 0, tx: 0, ty: 0 };
    this.zones = []; this.zoneById = new Map(); this.blocks = []; this.blockById = new Map(); this.routes = new Map(); this.links = []; this.linkById = new Map();
    this.hops = []; this.ripples = [];
    this.hover = null; this.hoverZone = null; this.focus = null; this.dragging = false; this.idle = 99; this.time = 0; this.sway = true;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.intro = -1;
    this.font = '500 11.5px Sora, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    this.rpsRange = [1, 1];
  }

  // ---------- 数据 ----------
  setData(data) {
    this.data = data; this.zones = []; this.zoneById.clear(); this.blocks = []; this.blockById.clear(); this.routes.clear(); this.links = []; this.linkById.clear();
    const rps = data.businesses.map((b) => Math.log(1 + b.metrics.rps));
    this.rpsRange = [Math.min(...rps), Math.max(...rps)];
    data.zones.forEach((z, zi) => {
      const list = data.businesses.filter((b) => b.zone === z.id);
      const cols = z.cols || Math.ceil(Math.sqrt(list.length * 1.6)), rows = Math.ceil(list.length / cols);
      const w = cols * PITCH + 0.7, d = rows * PITCH + 0.7;
      const zone = { id: z.id, z, rgb: hexRgb(z.color), x: z.x, zz: z.z, w, d, cols, rows, pts: roundedRect(z.x, z.z, w, d, 0.9), top: [], bottom: [], lift: 0, liftT: 0, alpha: 1, alphaT: 1, reveal: 1, hover: 0, blocks: [], order: zi, center: { sx: 0, sy: 0, d: 0 }, anchor: { sx: 0, sy: 0, d: 0 } };
      list.forEach((b, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = z.x + (col - (cols - 1) / 2) * PITCH, zz = z.z + (row - (rows - 1) / 2) * PITCH;
        const blk = { id: b.id, b, zone, x, zz, w: 0.98, h: this.heightFor(b), hK: 1, raise: 0, raiseT: 0, glint: 0, col: zone.rgb.slice(), colT: zone.rgb, phase: hash(b.id) * 6.28, top: [], center: { sx: 0, sy: 0, d: 0 }, nextRipple: 0, labelA: 0 };
        this.retarget(blk); zone.blocks.push(blk); this.blocks.push(blk); this.blockById.set(b.id, blk);
      });
      this.zones.push(zone); this.zoneById.set(z.id, zone);
    });
    for (const l of data.links) this.addLink(l);
  }
  heightFor(b) { const v = Math.log(1 + b.metrics.rps); const k = (v - this.rpsRange[0]) / Math.max(1e-6, this.rpsRange[1] - this.rpsRange[0]); return 0.4 + 1.75 * Math.pow(k, 0.9); }
  retarget(blk) { const st = blk.b.status; blk.colT = st === 'critical' ? hexRgb(COLORS.critical) : st === 'warning' ? hexRgb(COLORS.warning) : blk.zone.rgb; }
  addLink(l) {
    const a = this.blockById.get(l.from), b = this.blockById.get(l.to); if (!a || !b) return null;
    const rec = { id: l.id, l, a, b, active: false, route: null };
    if (a.zone !== b.zone) rec.route = this.routeFor(a.zone, b.zone);
    if (rec.route) rec.route.links.push(rec);
    this.links.push(rec); this.linkById.set(l.id, rec);
    return rec;
  }
  routeFor(A, B) {
    const key = A.order < B.order ? `${A.id}|${B.id}` : `${B.id}|${A.id}`;
    if (this.routes.has(key)) return this.routes.get(key);
    const [P, Q] = A.order < B.order ? [A, B] : [B, A];
    const edge = (Z, tx, tz) => { const dx = tx - Z.x, dz = tz - Z.zz; const t = Math.min((Z.w / 2 + 0.25) / Math.max(1e-6, Math.abs(dx)), (Z.d / 2 + 0.25) / Math.max(1e-6, Math.abs(dz))); return [Z.x + dx * t, Z.zz + dz * t]; };
    const p0 = edge(P, Q.x, Q.zz), p1 = edge(Q, P.x, P.zz);
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2, dx = p1[0] - p0[0], dz = p1[1] - p0[1], len = Math.hypot(dx, dz);
    const side = hash(key) < 0.5 ? 1 : -1, bow = Math.min(1.6, len * 0.16) * side;
    const c = [mx - (dz / len) * bow, mz + (dx / len) * bow];
    const N = 30, pts = [];
    for (let i = 0; i < N; i++) { const t = i / (N - 1), u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); }
    const route = { key, a: P, b: Q, pts, pts2: pts.map(() => ({ sx: 0, sy: 0, d: 0 })), len, links: [], flows: [], heat: 0, alpha: 1, reveal: 1 };
    this.routes.set(key, route);
    return route;
  }
  removeLink(id) { const rec = this.linkById.get(id); if (!rec) return; this.linkById.delete(id); this.links.splice(this.links.indexOf(rec), 1); if (rec.route) rec.route.links.splice(rec.route.links.indexOf(rec), 1); }
  // 一次数据往来：跨区 → 通道上放出一道流；同区 → 方块之间跳一道短弧
  touch(id, dir = 1) {
    const rec = this.linkById.get(id); if (!rec) return;
    const from = dir > 0 ? rec.a : rec.b, to = dir > 0 ? rec.b : rec.a;
    if (rec.route) { if (rec.route.flows.length < 5) rec.route.flows.push({ t: rec.route.a === from.zone ? 0 : 1, dir: rec.route.a === from.zone ? 1 : -1, spd: 5.2 / Math.max(3, rec.route.len * 1.15), rgb: from.zone.rgb, target: to, wide: rec.l.dir === 2 }); rec.route.heat = Math.min(1, rec.route.heat + 0.35); }
    else if (this.hops.length < 24) this.hops.push({ from, to, t: 0, spd: 1 / 0.9, rgb: from.zone.rgb });
    from.glint = Math.max(from.glint, 0.5);
  }
  setActive(id, on) { const rec = this.linkById.get(id); if (rec) rec.active = on; }
  linksOf(blockId) { return this.links.filter((l) => l.a.id === blockId || l.b.id === blockId); }
  zoneStats(zone) { const bs = zone.blocks; return { n: bs.length, bad: bs.filter((b) => b.b.status !== 'normal').length, crit: bs.filter((b) => b.b.status === 'critical').length, flows: this.links.filter((l) => l.active && (l.a.zone === zone || l.b.zone === zone)).length, terminals: bs.reduce((s, b) => s + b.b.terminals, 0) }; }

  // ---------- 相机 ----------
  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr; this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    let ex = 0, ez = 0; for (const z of this.zones) { ex = Math.max(ex, Math.abs(z.x) + z.w / 2); ez = Math.max(ez, Math.abs(z.zz) + z.d / 2); }
    const half = (ex + ez) * Math.SQRT1_2;
    this.s = Math.min((W * 0.94) / (2 * half + 0.5), (H * 0.9) / (2 * half * T + 3.6));
    this.cx = W / 2; this.cy = H / 2 + 1.35 * this.s;
  }
  project(x, h, z, out) {
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw), v = this.view, k = this.s * v.zoom;
    const px = x * cs - z * sn, pz = x * sn + z * cs;
    out = out || { sx: 0, sy: 0, d: 0 };
    out.sx = this.cx + v.ox + px * k; out.sy = this.cy + v.oy + pz * T * k - h * k; out.d = pz; return out;
  }
  startIntro() { if (this.reduced) return; this.intro = 0; for (const z of this.zones) z.reveal = 0; for (const b of this.blocks) b.hK = 0; for (const r of this.routes.values()) r.reveal = 0; }
  resetView() { this.yawVel = 0; this.yawTarget = this.yaw0; this.view.tz = 1; this.view.tx = 0; this.view.ty = 0; }
  hitTest(px, py) {
    for (let i = this.drawList.length - 1; i >= 0; i--) { const b = this.drawList[i]; if (b.alphaK < 0.05) continue; for (const poly of b.polys) if (pointInPoly(px, py, poly)) return { block: b }; }
    for (let i = this.zoneOrder.length - 1; i >= 0; i--) { const z = this.zoneOrder[i]; if (pointInPoly(px, py, z.top)) return { zone: z }; }
    return null;
  }

  // ---------- 更新 ----------
  update(dt) {
    this.time += dt; this.idle += dt;
    const v = this.view;
    if (this.intro >= 0) {
      this.intro += dt;
      this.zones.forEach((z, i) => { z.reveal = easeOutCubic(clamp((this.intro - i * 0.11) / 0.8, 0, 1)); z.blocks.forEach((b, j) => { b.hK = easeOutBack(clamp((this.intro - i * 0.11 - 0.45 - j * 0.05) / 0.6, 0, 1)); }); });
      for (const r of this.routes.values()) r.reveal = easeOutCubic(clamp((this.intro - 1.1) / 0.9, 0, 1));
      if (this.intro > 2.6) { this.intro = -1; for (const z of this.zones) z.reveal = 1; for (const b of this.blocks) b.hK = 1; for (const r of this.routes.values()) r.reveal = 1; }
    }
    // 旋转：拖动惯性 / 回正 / 空闲轻摆
    if (!this.dragging) {
      if (this.yawTarget != null) { this.yaw = lerp(this.yaw, this.yawTarget, 1 - Math.exp(-dt * 5)); if (Math.abs(this.yaw - this.yawTarget) < 0.002) { this.yaw = this.yawTarget; this.yawTarget = null; } }
      else if (Math.abs(this.yawVel) > 1e-4) { this.yaw += this.yawVel * dt; this.yawVel *= Math.exp(-dt * 3); }
      else if (this.sway && !this.reduced && this.idle > 3 && !this.focus) this.yaw += Math.cos(this.time * 0.11) * 0.0045 * dt;
    }
    const kz = 1 - Math.exp(-dt * 4.5);
    v.zoom = lerp(v.zoom, v.tz, kz);
    if (this.focus) { const z = this.focus; const p = this.project(z.x, 0.6, z.zz); v.tx = v.ox + (this.W * 0.42 - p.sx); v.ty = v.oy + (this.H * 0.55 - p.sy); }
    v.ox = lerp(v.ox, v.tx, kz); v.oy = lerp(v.oy, v.ty, kz);

    for (const z of this.zones) {
      z.liftT = (this.focus === z ? 0.55 : 0) + (this.hoverZone === z && !this.focus ? 0.12 : 0);
      z.lift = lerp(z.lift, z.liftT, 1 - Math.exp(-dt * 6));
      z.alphaT = this.focus && this.focus !== z ? 0.38 : 1;
      z.alpha = lerp(z.alpha, z.alphaT, 1 - Math.exp(-dt * 6));
      const hTop = SLAB_T + z.lift - (1 - z.reveal) * 1.6;
      z.hTop = hTop;
      z.top = z.pts.map((p) => this.project(p[0], hTop, p[1])); z.bottom = z.pts.map((p) => this.project(p[0], hTop - SLAB_T, p[1]));
      this.project(z.x, hTop, z.zz, z.center);
      { let f = z.top[0]; for (const p of z.top) if (p.sy > f.sy) f = p; z.anchor.sx = f.sx; z.anchor.sy = f.sy; } // 浮标锚在基板最前端
      for (const b of z.blocks) {
        if (b.hT != null) b.h = lerp(b.h, b.hT, 1 - Math.exp(-dt * 1.5)); // 负载变化：高度平滑跟随
        b.raiseT = (this.hover === b ? 0.28 : 0) + b.glint * 0.12;
        b.raise = lerp(b.raise, b.raiseT, 1 - Math.exp(-dt * 10));
        b.glint = Math.max(0, b.glint - dt * 1.4);
        for (let i = 0; i < 3; i++) b.col[i] = lerp(b.col[i], b.colT[i], 1 - Math.exp(-dt * 5));
        const breathe = this.reduced ? 1 : 1 + 0.025 * Math.sin(this.time * 1.2 + b.phase);
        b.hDraw = b.h * b.hK * breathe;
        b.base = hTop + b.raise;
        b.alphaK = z.alpha * clamp(z.reveal * 1.4, 0, 1);
        const abnormal = b.b.status !== 'normal';
        if (abnormal && !this.reduced) { b.nextRipple -= dt; if (b.nextRipple <= 0) { this.ripples.push({ b, born: this.time, dur: 2 }); b.nextRipple = b.b.status === 'critical' ? 2.2 : 3.2; } }
        const labelT = (this.focus === z || this.hover === b || abnormal || (this.hoverZone === z && !this.focus)) ? 1 : 0;
        b.labelA = lerp(b.labelA, labelT, 1 - Math.exp(-dt * 8));
        this.projectBlock(b);
      }
    }
    this.ripples = this.ripples.filter((r) => this.time - r.born < r.dur);
    for (const r of this.routes.values()) {
      for (let i = 0; i < r.pts.length; i++) this.project(r.pts[i][0], 0, r.pts[i][1], r.pts2[i]);
      r.heat = Math.max(0, r.heat - dt * 0.12);
      const related = this.focus ? (r.a === this.focus || r.b === this.focus) : this.hoverZone ? (r.a === this.hoverZone || r.b === this.hoverZone) : true;
      r.alpha = lerp(r.alpha, related ? 1 : 0.3, 1 - Math.exp(-dt * 6));
      for (let i = r.flows.length - 1; i >= 0; i--) { const f = r.flows[i]; f.t += f.dir * f.spd * dt; if (f.t > 1 || f.t < 0) { f.target.glint = 1; r.flows.splice(i, 1); } }
    }
    for (let i = this.hops.length - 1; i >= 0; i--) { const h = this.hops[i]; h.t += h.spd * dt; if (h.t >= 1) { h.to.glint = 1; this.hops.splice(i, 1); } }
    // 绘制顺序：区域按深度远 → 近，区域内方块同样
    this.zoneOrder = this.zones.slice().sort((a, b) => a.center.d - b.center.d);
    const list = []; for (const z of this.zoneOrder) list.push(...z.blocks.slice().sort((a, b) => a.center.d - b.center.d));
    this.drawList = list;
  }
  projectBlock(b) {
    const hw = b.w / 2, x0 = b.x - hw, x1 = b.x + hw, z0 = b.zz - hw, z1 = b.zz + hw, y0 = b.base, y1 = b.base + b.hDraw;
    const P = (x, h, z) => this.project(x, h, z);
    b.corners = { t00: P(x0, y1, z0), t10: P(x1, y1, z0), t11: P(x1, y1, z1), t01: P(x0, y1, z1), b00: P(x0, y0, z0), b10: P(x1, y0, z0), b11: P(x1, y0, z1), b01: P(x0, y0, z1) };
    const c = b.corners; b.top = [c.t00, c.t10, c.t11, c.t01];
    this.project(b.x, y1, b.zz, b.center);
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    // 四个侧面：外法线在旋转后朝向观众（pz 分量 > 0）的才可见；用于着色的“受光”由法线方向决定
    const faces = [
      { n: [1, 0], pts: [c.t10, c.t11, c.b11, c.b10] }, { n: [-1, 0], pts: [c.t01, c.t00, c.b00, c.b01] },
      { n: [0, 1], pts: [c.t11, c.t01, c.b01, c.b11] }, { n: [0, -1], pts: [c.t00, c.t10, c.b10, c.b00] },
    ];
    b.sides = [];
    for (const f of faces) { const nx = f.n[0] * cs - f.n[1] * sn, nz = f.n[0] * sn + f.n[1] * cs; if (nz > 0.02) b.sides.push({ pts: f.pts, lit: clamp(0.55 + 0.5 * (0.85 * nz - 0.35 * nx), 0.45, 1) }); }
    b.polys = [b.top, ...b.sides.map((s) => s.pts)];
  }

  // ---------- 绘制 ----------
  draw() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    this.drawGrid();
    for (const r of this.routes.values()) this.drawRoute(r);
    for (const r of this.routes.values()) this.drawFlows(r);
    for (const z of this.zoneOrder) {
      this.drawSlab(z);
      for (const rp of this.ripples) if (rp.b.zone === z) this.drawRipple(rp);
      for (const b of z.blocks.slice().sort((a, b2) => a.center.d - b2.center.d)) this.drawBlock(b);
    }
    for (const h of this.hops) this.drawHop(h);
    for (const b of this.drawList) if (b.labelA > 0.05 && b.alphaK > 0.3) this.drawLabel(b);
  }
  poly(pts) { const c = this.ctx; c.beginPath(); c.moveTo(pts[0].sx, pts[0].sy); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].sx, pts[i].sy); c.closePath(); }
  drawGrid() {
    const ctx = this.ctx, k = this.s * this.view.zoom; if (k < 8) return;
    ctx.strokeStyle = rgba(COLORS.grid, 0.07); ctx.lineWidth = 1; ctx.beginPath();
    const R = 14, a = { sx: 0, sy: 0, d: 0 }, b = { sx: 0, sy: 0, d: 0 };
    for (let i = -R; i <= R; i += 2) { this.project(i, 0, -R, a); this.project(i, 0, R, b); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); this.project(-R, 0, i, a); this.project(R, 0, i, b); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
    ctx.stroke();
  }
  drawRoute(r) {
    const ctx = this.ctx, a = r.alpha * r.reveal; if (a < 0.02) return;
    const n = Math.max(2, Math.round(r.pts2.length * r.reveal)), k = this.view.zoom;
    ctx.beginPath(); ctx.moveTo(r.pts2[0].sx, r.pts2[0].sy); for (let i = 1; i < n; i++) ctx.lineTo(r.pts2[i].sx, r.pts2[i].sy);
    ctx.strokeStyle = rgba(COLORS.road, (0.09 + 0.1 * r.heat) * a); ctx.lineWidth = 9 * k; ctx.stroke();
    ctx.strokeStyle = rgba(COLORS.road, (0.28 + 0.3 * r.heat) * a); ctx.lineWidth = 1; ctx.setLineDash([2, 7 * k]); ctx.stroke(); ctx.setLineDash([]);
  }
  pointAt(r, t, out) { t = clamp(t, 0, 1); const f = t * (r.pts2.length - 1), i = Math.min(r.pts2.length - 2, Math.floor(f)), u = f - i; const a = r.pts2[i], b = r.pts2[i + 1]; out = out || {}; out.sx = a.sx + (b.sx - a.sx) * u; out.sy = a.sy + (b.sy - a.sy) * u; return out; }
  drawFlows(r) {
    const ctx = this.ctx, a = r.alpha * r.reveal; if (!r.flows.length || a < 0.05) return;
    const tail = clamp(1.5 / Math.max(2, r.len), 0.08, 0.3), N = 9;
    for (const f of r.flows) {
      let prev = this.pointAt(r, f.t - f.dir * tail);
      for (let k = 1; k <= N; k++) { const q = this.pointAt(r, f.t - f.dir * tail * (1 - k / N)); const w = k / N; ctx.strokeStyle = rgba(f.rgb, a * Math.pow(w, 1.5) * 0.85); ctx.lineWidth = 1 + 2.6 * w; ctx.beginPath(); ctx.moveTo(prev.sx, prev.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); prev = q; }
      const h = this.pointAt(r, f.t);
      ctx.fillStyle = rgba(f.rgb, a * 0.2); ctx.beginPath(); ctx.arc(h.sx, h.sy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(f.rgb, a); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(h.sx, h.sy, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  drawSlab(z) {
    const ctx = this.ctx, a = z.alpha * clamp(z.reveal * 1.5, 0, 1); if (a < 0.02) return;
    const top = z.top, bot = z.bottom, n = top.length;
    // 投影阴影：底面轮廓向下偏移 + 模糊
    ctx.save(); ctx.globalAlpha = a;
    ctx.shadowColor = rgba(COLORS.shadow, 0.22); ctx.shadowBlur = 22 * this.view.zoom; ctx.shadowOffsetY = 1000 + 14 * this.view.zoom;
    ctx.translate(0, -1000); this.poly(bot); ctx.fillStyle = rgba(COLORS.shadow, 0.001); ctx.fill(); ctx.restore();
    // 侧面：取轮廓前半段（屏幕上靠下的一侧）与底面对应段合成多边形
    let L = 0, R = 0; for (let i = 1; i < n; i++) { if (top[i].sx < top[L].sx) L = i; if (top[i].sx > top[R].sx) R = i; }
    const chain = []; let i = L; while (true) { chain.push(i); if (i === R) break; i = (i + 1) % n; }
    let maxIdx = chain[0]; for (const j of chain) if (top[j].sy > top[maxIdx].sy) maxIdx = j;
    let front = chain; if (top[maxIdx].sy < top[L].sy && top[maxIdx].sy < top[R].sy) { front = []; i = R; while (true) { front.push(i); if (i === L) break; i = (i + 1) % n; } front.reverse(); }
    ctx.save(); ctx.globalAlpha = a;
    const side = mix(z.rgb, WHITE, 0.62), sideDark = mix(z.rgb, WHITE, 0.5);
    const g = ctx.createLinearGradient(top[front[0]].sx, 0, top[front[front.length - 1]].sx, 0); g.addColorStop(0, rgba(side, 1)); g.addColorStop(1, rgba(sideDark, 1));
    ctx.beginPath(); ctx.moveTo(top[front[0]].sx, top[front[0]].sy); for (const j of front) ctx.lineTo(top[j].sx, top[j].sy); for (let k2 = front.length - 1; k2 >= 0; k2--) ctx.lineTo(bot[front[k2]].sx, bot[front[k2]].sy); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    // 顶面：极浅的区域色，前缘略深；中心一圈更浅的高光
    const cy = z.center.sy, ry = (z.w + z.d) * 0.5 * this.s * this.view.zoom * T;
    const tg = ctx.createLinearGradient(0, cy - ry, 0, cy + ry); tg.addColorStop(0, rgba(mix(z.rgb, WHITE, 0.93), 1)); tg.addColorStop(1, rgba(mix(z.rgb, WHITE, 0.84), 1));
    this.poly(top); ctx.fillStyle = tg; ctx.fill();
    ctx.strokeStyle = rgba(mix(z.rgb, WHITE, 0.55), 0.9); ctx.lineWidth = 1; ctx.stroke();
    // 顶面细网格：方块位置的落位格
    ctx.strokeStyle = rgba(z.rgb, 0.1); ctx.setLineDash([2, 4]);
    const pt = { sx: 0, sy: 0, d: 0 }, hTop = z.hTop + 0.005;
    for (let c = 0; c < z.cols; c++) for (let rr = 0; rr < z.rows; rr++) {
      const x = z.x + (c - (z.cols - 1) / 2) * PITCH, zz = z.zz + (rr - (z.rows - 1) / 2) * PITCH, hw = 0.6;
      ctx.beginPath(); this.project(x - hw, hTop, zz - hw, pt); ctx.moveTo(pt.sx, pt.sy); this.project(x + hw, hTop, zz - hw, pt); ctx.lineTo(pt.sx, pt.sy); this.project(x + hw, hTop, zz + hw, pt); ctx.lineTo(pt.sx, pt.sy); this.project(x - hw, hTop, zz + hw, pt); ctx.lineTo(pt.sx, pt.sy); ctx.closePath(); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
  drawRipple(rp) {
    const ctx = this.ctx, b = rp.b, p = (this.time - rp.born) / rp.dur, k = this.s * this.view.zoom;
    const rgb = b.b.status === 'critical' ? hexRgb(COLORS.critical) : hexRgb(COLORS.warning);
    const rad = 0.6 + 1.5 * easeOutCubic(p), c = this.project(b.x, b.zone.hTop + 0.01, b.zz);
    ctx.strokeStyle = rgba(rgb, Math.pow(1 - p, 1.5) * 0.55 * b.alphaK); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(c.sx, c.sy, rad * k, rad * k * T, 0, 0, Math.PI * 2); ctx.stroke();
  }
  drawBlock(b) {
    const ctx = this.ctx, a = b.alphaK; if (a < 0.02 || b.hDraw <= 0.001) return;
    const c = b.corners, col = b.col, k = this.s * this.view.zoom;
    ctx.save(); ctx.globalAlpha = a;
    // 接触阴影（悬浮时更散）
    const sc = this.project(b.x, b.zone.hTop + 0.01, b.zz);
    ctx.fillStyle = rgba(COLORS.shadow, 0.13 - b.raise * 0.18); ctx.beginPath(); ctx.ellipse(sc.sx + 3, sc.sy + 3, 0.68 * k * (1 + b.raise), 0.68 * k * T * (1 + b.raise), 0, 0, Math.PI * 2); ctx.fill();
    // 侧面
    for (const s of b.sides) { const sh = mix(mix(col, BLACK, (1 - s.lit) * 0.42), WHITE, 0.2); this.poly(s.pts); ctx.fillStyle = rgba(sh, 1); ctx.fill(); }
    // 顶面：浅色 + 高光渐变；有流量到达时短暂点亮
    const tg = ctx.createLinearGradient(c.t00.sx, c.t00.sy, c.t11.sx, c.t11.sy);
    const lightTop = mix(col, WHITE, 0.55 + b.glint * 0.25), darkTop = mix(col, WHITE, 0.36 + b.glint * 0.25);
    tg.addColorStop(0, rgba(lightTop, 1)); tg.addColorStop(1, rgba(darkTop, 1));
    this.poly(b.top); ctx.fillStyle = tg; ctx.fill();
    ctx.strokeStyle = rgba(mix(col, WHITE, 0.6), 0.9); ctx.lineWidth = 1; ctx.stroke();
    // 高光边线
    ctx.strokeStyle = rgba(WHITE, 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c.t01.sx, c.t01.sy); ctx.lineTo(c.t00.sx, c.t00.sy); ctx.lineTo(c.t10.sx, c.t10.sy); ctx.stroke();
    if (b.glint > 0.02) { ctx.strokeStyle = rgba(WHITE, b.glint * 0.9); ctx.lineWidth = 2; this.poly(b.top); ctx.stroke(); }
    // 异常角标：方块上方悬浮的白底色点
    if (b.b.status !== 'normal') {
      const bob = Math.sin(this.time * 2.4 + b.phase) * 2;
      const bx = b.center.sx, by = b.center.sy - 0.42 * k - 8 + bob;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(col, 1); ctx.font = '800 10px Sora, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', bx, by + 0.5);
    }
    ctx.restore();
  }
  drawHop(h) {
    const ctx = this.ctx, A = h.from, B = h.to, a = A.alphaK; if (a < 0.05) return;
    const N = 12, pts = []; const y0 = A.base + A.hDraw, y1 = B.base + B.hDraw, lift = 0.9;
    for (let i = 0; i <= N; i++) { const t = i / N; pts.push(this.project(lerp(A.x, B.x, t), lerp(y0, y1, t) + Math.sin(t * Math.PI) * lift, lerp(A.zz, B.zz, t))); }
    ctx.strokeStyle = rgba(h.rgb, a * 0.28); ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(pts[0].sx, pts[0].sy); for (let i = 1; i <= N; i++) ctx.lineTo(pts[i].sx, pts[i].sy); ctx.stroke(); ctx.setLineDash([]);
    const f = h.t * N, i = Math.min(N - 1, Math.floor(f)), u = f - i, p = { sx: lerp(pts[i].sx, pts[i + 1].sx, u), sy: lerp(pts[i].sy, pts[i + 1].sy, u) };
    ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(h.rgb, a); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  drawLabel(b) {
    const ctx = this.ctx, k = this.s * this.view.zoom, st = b.b.status;
    const text = st === 'critical' ? `故障 · ${b.b.name}` : st === 'warning' ? `告警 · ${b.b.name}` : b.b.name;
    const y = b.center.sy - (st !== 'normal' ? 0.42 * k + 22 : 0.3 * k + 6);
    ctx.globalAlpha = b.labelA * b.alphaK; ctx.font = st !== 'normal' ? this.font.replace('500', '700') : this.font; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, b.center.sx, y);
    ctx.fillStyle = st === 'critical' ? COLORS.critical : st === 'warning' ? COLORS.warning : COLORS.ink; ctx.fillText(text, b.center.sx, y);
    ctx.globalAlpha = 1;
  }
}
