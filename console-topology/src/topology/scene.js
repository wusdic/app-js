// 2.5D 画布渲染器：三层圆形平台 + 悬浮业务节点 + 弧线连接与数据流 + 终端微粒
// 纯 Canvas 2D，无第三方依赖；浅色主题，所有颜色集中在 COLORS 里
export const LEVELS = ['core', 'important', 'general'];
export const LEVEL_NAME = { core: '核心业务', important: '重要业务', general: '一般业务' };
export const COLORS = {
  ink: '#15213b', muted: '#6a7890',
  level: { core: '#2457f5', important: '#4f8ceb', general: '#93a7cb' },
  status: { warning: '#e8950a', critical: '#e5484d' },
  flow: '#2457f5',
  platformTop: ['#fbfcff', '#e4ebf8'], platformSide: '#d3ddf0', rim: '#bccbe6', guide: '#d5dff0',
  shadow: [28, 52, 110],
  terminal: '#9db0d3',
  link: [128, 152, 200], linkActive: [36, 87, 245],
};
export const LAYERS = {
  core: { y: 2.55, R: 3.9, rings: [2.85] },
  important: { y: 0, R: 5.5, rings: [2.55, 4.3] },
  general: { y: -2.55, R: 7.6, rings: [3.4, 6.05] },
};
const NODE_R = { core: 10, important: 8.2, general: 6.6 }; // 像素（s = 48 时）
const FLOAT = { core: 0.66, important: 0.54, general: 0.44 };
const TERM_N = { core: 8, important: 6, general: 4 };
const SAMPLES = 28;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; };

export class Scene {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.tilt = 0.46; this.yaw = -0.42; this.yawVel = 0;
    this.W = 0; this.H = 0; this.dpr = 1; this.s = 48; this.cx = 0; this.cy = 0;
    this.view = { zoom: 1, ox: 0, oy: 0, tz: 1, tx: 0, ty: 0 };
    this.nodes = []; this.nodeById = new Map(); this.links = []; this.linkById = new Map();
    this.layer = 'all'; this.hover = null; this.pinned = null; this.spot = null;
    this.time = 0; this.idle = 99; this.dragging = false; this.autoRotate = true;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.intro = -1; this.platRev = { core: 1, important: 1, general: 1 };
    this.ripples = []; this.flowsOn = true;
    this.font = '500 12px Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    this.fontSmall = '600 10.5px Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  }

  // ---------- 数据与布局 ----------
  setData(data) {
    this.data = data; this.nodes = []; this.nodeById.clear(); this.links = []; this.linkById.clear(); this.ripples = [];
    for (const lv of LEVELS) {
      const cfg = LAYERS[lv];
      const list = data.businesses.filter((b) => b.level === lv).slice().sort((a, b) => a.dept.localeCompare(b.dept, 'zh'));
      const total = cfg.rings.reduce((s, r) => s + r, 0);
      const counts = cfg.rings.map((r) => Math.round((list.length * r) / total));
      counts[counts.length - 1] += list.length - counts.reduce((s, c) => s + c, 0);
      let idx = 0;
      cfg.rings.forEach((r, ri) => {
        for (let i = 0; i < counts[ri]; i++) {
          const b = list[idx++]; if (!b) break;
          const ang = (i / counts[ri]) * Math.PI * 2 + ri * 0.45 - Math.PI / 2;
          const node = this.addNode(b, Math.cos(ang) * r, Math.sin(ang) * r);
          node.labelBelow = counts[ri] > 6 && i % 2 === 1; // 相邻标签上下交错，减少重叠
        }
      });
    }
    for (const l of data.links) this.addLink(l);
  }
  addNode(b, x, z) {
    const lv = b.level, ph = hash(b.id) * Math.PI * 2;
    const rgb = hexRgb(COLORS.level[lv]);
    const n = { id: b.id, b, level: lv, x, z, y: LAYERS[lv].y, fl: FLOAT[lv], r: NODE_R[lv], phase: ph, reveal: 1, hoverK: 0, layerA: 1, col: rgb.slice(), colT: rgb, top: { sx: 0, sy: 0, d: 0 }, base: { sx: 0, sy: 0, d: 0 }, terminals: [], nextRipple: 0, labelOn: lv === 'core' };
    this.retarget(n);
    n.termN = 0; this.setTerminalCount(n, b.terminals);
    this.nodes.push(n); this.nodeById.set(b.id, n);
    return n;
  }
  setTerminalCount(n, count) {
    const want = clamp(Math.round(TERM_N[n.level] * (0.6 + Math.log10(1 + count) * 0.22)), 3, 12);
    while (n.terminals.length < want) n.terminals.push({ ang: Math.random() * Math.PI * 2, rad: (0.62 + Math.random() * 0.75) * (n.level === 'core' ? 1.15 : 1), spd: (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.25), size: 1.3 + Math.random() * 1.1, ph: Math.random() * 6.28, life: 0 });
    while (n.terminals.length > want) n.terminals.pop();
    n.termN = count;
  }
  retarget(n) { n.colT = hexRgb(n.b.status === 'critical' ? COLORS.status.critical : n.b.status === 'warning' ? COLORS.status.warning : COLORS.level[n.level]); }
  addLink(l) {
    const a = this.nodeById.get(l.from), b = this.nodeById.get(l.to); if (!a || !b) return null;
    const A = [a.x, a.y + a.fl, a.z], B = [b.x, b.y + b.fl, b.z];
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const dist = Math.hypot(dx, dy, dz);
    const cross = a.level !== b.level;
    const lift = (cross ? 0.3 : 0.3) + dist * (cross ? 0.06 : 0.09);
    const M = [(A[0] + B[0]) / 2, Math.max(A[1], B[1]) + lift, (A[2] + B[2]) / 2];
    const pts3 = [];
    for (let i = 0; i < SAMPLES; i++) { const t = i / (SAMPLES - 1), u = 1 - t; pts3.push([u * u * A[0] + 2 * u * t * M[0] + t * t * B[0], u * u * A[1] + 2 * u * t * M[1] + t * t * B[1], u * u * A[2] + 2 * u * t * M[2] + t * t * B[2]]); }
    const rec = { id: l.id, l, a, b, cross, pts3, pts2: pts3.map(() => ({ sx: 0, sy: 0, d: 0 })), len3: dist * 1.12, lenPx: 1, active: false, activeK: 0, pulses: [], alpha: 0, transient: !!l.transient, born: this.time, dieAt: l.transient ? this.time + (l.ttl || 10) : Infinity, dying: false };
    this.links.push(rec); this.linkById.set(l.id, rec);
    return rec;
  }
  removeLink(id) { const rec = this.linkById.get(id); if (!rec) return; this.linkById.delete(id); this.links.splice(this.links.indexOf(rec), 1); }
  linksOf(id) { return this.links.filter((l) => l.a.id === id || l.b.id === id); }
  pulse(id, dir = 1) {
    const rec = this.linkById.get(id); if (!rec || !this.flowsOn) return;
    if (rec.pulses.length >= 3) return;
    rec.pulses.push({ t: dir > 0 ? 0 : 1, dir, spd: 4.6 / rec.len3 });
  }
  setActive(id, on) { const rec = this.linkById.get(id); if (rec) rec.active = on; }
  spotlightFor(nodeId) {
    const ls = this.linksOf(nodeId); const ns = new Set([nodeId]); for (const l of ls) { ns.add(l.a.id); ns.add(l.b.id); }
    return { anchor: nodeId, nodes: ns, links: new Set(ls.map((l) => l.id)) };
  }

  // ---------- 相机 ----------
  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    const g = LAYERS.general, c = LAYERS.core, tilt = this.tilt;
    const top = -(c.R * tilt) - c.y - 1.35, bottom = g.R * tilt - g.y + 0.45;
    this.s = Math.min((W * 0.86) / (2 * g.R), (H * 0.9) / (bottom - top));
    this.cx = W / 2; this.cy = H / 2 - ((top + bottom) / 2) * this.s;
  }
  project(x, y, z, out) {
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw), v = this.view, k = this.s * v.zoom;
    const px = x * cs - z * sn, d = x * sn + z * cs;
    out = out || { sx: 0, sy: 0, d: 0 };
    out.sx = this.cx + v.ox + px * k; out.sy = this.cy + v.oy + (d * this.tilt - y) * k; out.d = d;
    return out;
  }
  screenOf(nodeId) { const n = this.nodeById.get(nodeId); return n ? { x: n.top.sx, y: n.top.sy, r: this.nodeR(n) } : null; }
  nodeR(n) { return n.r * (this.s / 48) * Math.pow(this.view.zoom, 0.55) * (1 + n.hoverK * 0.22) * clamp(n.reveal, 0, 1.2); }
  startIntro() { if (this.reduced) return; this.intro = 0; for (const lv of LEVELS) this.platRev[lv] = 0; for (const n of this.nodes) n.reveal = 0; }
  resetView() { this.pinned = null; this.view.tz = 1; this.view.tx = 0; this.view.ty = 0; this.yawVel = (-0.42 - this.yaw) * 2; }

  hitTest(px, py) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.drawOrder ? this.drawOrder[i] : this.nodes[i];
      const r = this.nodeR(n) * 1.25 + 4;
      if ((px - n.top.sx) ** 2 + (py - n.top.sy) ** 2 <= r * r) return n;
    }
    return null;
  }

  // ---------- 每帧更新 ----------
  update(dt) {
    this.time += dt; this.idle += dt;
    const v = this.view;
    if (this.intro >= 0) {
      this.intro += dt;
      const starts = { general: 0, important: 0.22, core: 0.44 };
      for (const lv of LEVELS) this.platRev[lv] = easeOutCubic(clamp((this.intro - starts[lv]) / 0.75, 0, 1));
      let i = 0;
      for (const n of this.nodes) { const st = starts[n.level] + 0.3 + (i++ % 16) * 0.035; n.reveal = easeOutBack(clamp((this.intro - st) / 0.6, 0, 1)); }
      if (this.intro > 2.2) { this.intro = -1; for (const n of this.nodes) n.reveal = 1; }
    }
    // 旋转：拖动惯性 / 空闲自转
    if (!this.dragging) {
      if (Math.abs(this.yawVel) > 1e-4) { this.yaw += this.yawVel * dt; this.yawVel *= Math.exp(-dt * 3.2); }
      else if (this.autoRotate && !this.reduced && this.idle > 2.5 && !this.pinned && !this.hover) this.yaw += 0.055 * dt;
    }
    // 镜头：锁定业务时轻推近并居中
    const kz = 1 - Math.exp(-dt * 4);
    v.zoom = lerp(v.zoom, v.tz, kz);
    if (this.pinned) {
      const n = this.nodeById.get(this.pinned);
      if (n) { const p = this.project(n.x, n.y + n.fl, n.z); v.tx = v.ox + (this.W * 0.5 - p.sx); v.ty = v.oy + (this.H * 0.52 - p.sy); }
    }
    v.ox = lerp(v.ox, v.tx, kz); v.oy = lerp(v.oy, v.ty, kz);

    const spot = this.spot;
    for (const n of this.nodes) {
      const inLayer = this.layer === 'all' || n.level === this.layer;
      const abnormal = n.b.status !== 'normal';
      let target = inLayer ? 1 : abnormal ? 0.85 : 0.32;
      if (spot) target *= spot.nodes.has(n.id) ? 1 : 0.28;
      n.layerA = lerp(n.layerA, target, 1 - Math.exp(-dt * 6));
      const hv = (this.hover === n.id || this.pinned === n.id) ? 1 : spot && spot.nodes.has(n.id) ? 0.35 : 0;
      n.hoverK = lerp(n.hoverK, hv, 1 - Math.exp(-dt * 9));
      for (let i = 0; i < 3; i++) n.col[i] = lerp(n.col[i], n.colT[i], 1 - Math.exp(-dt * 5));
      const bob = Math.sin(this.time * 0.9 + n.phase) * 0.05;
      this.project(n.x, n.y + n.fl + bob, n.z, n.top); this.project(n.x, n.y, n.z, n.base);
      for (const t of n.terminals) { t.ang += t.spd * dt; t.life = Math.min(1, t.life + dt * 0.8); }
      if (abnormal && !this.reduced) { n.nextRipple -= dt; if (n.nextRipple <= 0) { this.ripples.push({ n, born: this.time, dur: 1.9 }); n.nextRipple = n.b.status === 'critical' ? 2.4 : 3.4; } }
      n.labelOn = n.level === 'core' || this.layer === n.level || abnormal || (spot && spot.nodes.has(n.id)) || this.hover === n.id || this.pinned === n.id;
    }
    this.ripples = this.ripples.filter((r) => this.time - r.born < r.dur);
    for (const l of this.links) {
      for (let i = 0; i < SAMPLES; i++) { const p = l.pts3[i]; this.project(p[0], p[1], p[2], l.pts2[i]); }
      let len = 0; for (let i = 1; i < SAMPLES; i++) len += Math.hypot(l.pts2[i].sx - l.pts2[i - 1].sx, l.pts2[i].sy - l.pts2[i - 1].sy); l.lenPx = Math.max(1, len);
      l.activeK = lerp(l.activeK, l.active ? 1 : 0, 1 - Math.exp(-dt * 3));
      for (let i = l.pulses.length - 1; i >= 0; i--) { const p = l.pulses[i]; p.t += p.dir * p.spd * dt; if (p.t > 1.35 || p.t < -0.35) l.pulses.splice(i, 1); }
      const inA = this.layer === 'all' || l.a.level === this.layer, inB = this.layer === 'all' || l.b.level === this.layer;
      let target = inA && inB ? 1 : inA || inB ? 0.55 : 0.2;
      if (spot) target *= spot.links.has(l.id) ? 1 : 0.18;
      if (l.transient) { const age = this.time - l.born, left = l.dieAt - this.time; target *= clamp(age / 0.6, 0, 1) * clamp(left / 0.8, 0, 1); if (left <= 0) l.dying = true; }
      if (this.intro >= 0) target *= clamp((this.intro - 1.0) / 0.7, 0, 1);
      l.alpha = lerp(l.alpha, target, 1 - Math.exp(-dt * 6));
    }
    for (const l of this.links.filter((x) => x.dying)) this.removeLink(l.id);
    // 绘制顺序：底层 → 顶层；层内按深度（远 → 近）
    const order = [];
    for (const lv of ['general', 'important', 'core']) order.push(...this.nodes.filter((n) => n.level === lv).sort((a, b) => a.top.d - b.top.d));
    this.drawOrder = order;
  }

  // ---------- 绘制 ----------
  draw() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const byLevel = { general: [], important: [], core: [] };
    for (const n of this.drawOrder || this.nodes) byLevel[n.level].push(n);
    for (const lv of ['general', 'important', 'core']) {
      this.drawPlatform(lv);
      for (const n of byLevel[lv]) this.drawTerminals(n);
      for (const r of this.ripples) if (r.n.level === lv) this.drawRipple(r);
      for (const l of this.links) if (!l.cross && l.a.level === lv) this.drawLink(l);
      for (const n of byLevel[lv]) this.drawNode(n);
    }
    for (const l of this.links) if (l.cross) this.drawLink(l);
    for (const l of this.links) this.drawPulses(l);
    for (const n of this.drawOrder || this.nodes) if (n.labelOn && n.layerA > 0.3 && n.reveal > 0.85) this.drawLabel(n);
  }

  ellipse(x, y, rx, ry) { const c = this.ctx; c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2); }

  drawPlatform(lv) {
    const ctx = this.ctx, cfg = LAYERS[lv], k = this.platRev[lv]; if (k <= 0.001) return;
    const c = this.project(0, cfg.y, 0);
    const zoom = this.s * this.view.zoom;
    const rx = cfg.R * zoom * (0.55 + 0.45 * k), ry = rx * this.tilt;
    const inLayer = this.layer === 'all' || lv === this.layer;
    const a = k * (inLayer ? 1 : 0.55);
    ctx.save(); ctx.globalAlpha = a;
    // 投影阴影（径向渐变）
    const sh = ctx.createRadialGradient(c.sx, c.sy + 10, rx * 0.2, c.sx, c.sy + 10, rx * 1.12);
    sh.addColorStop(0, rgba(COLORS.shadow, 0.16)); sh.addColorStop(0.75, rgba(COLORS.shadow, 0.07)); sh.addColorStop(1, rgba(COLORS.shadow, 0));
    ctx.fillStyle = sh; this.ellipse(c.sx, c.sy + 10, rx * 1.12, ry * 1.18); ctx.fill();
    // 厚度
    ctx.fillStyle = COLORS.platformSide; this.ellipse(c.sx, c.sy + 6, rx, ry); ctx.fill();
    // 顶面
    const g = ctx.createLinearGradient(0, c.sy - ry, 0, c.sy + ry); g.addColorStop(0, COLORS.platformTop[0]); g.addColorStop(1, COLORS.platformTop[1]);
    ctx.fillStyle = g; this.ellipse(c.sx, c.sy, rx, ry); ctx.fill();
    ctx.strokeStyle = COLORS.rim; ctx.lineWidth = 1; ctx.stroke();
    // 刻度：同心环 + 辐条（只在当前层或全部时清晰）
    ctx.globalAlpha = a * (inLayer ? 1 : 0.5);
    ctx.strokeStyle = COLORS.guide; ctx.setLineDash([3, 5]);
    for (const r of cfg.rings) { const q = (r / cfg.R) * rx; this.ellipse(c.sx, c.sy, q, q * this.tilt); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.globalAlpha = a * 0.55;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) { const an = (i / 12) * Math.PI * 2 + this.yaw; const c0 = Math.cos(an), s0 = Math.sin(an); ctx.moveTo(c.sx + c0 * rx * 0.62, c.sy + s0 * ry * 0.62); ctx.lineTo(c.sx + c0 * rx * 0.985, c.sy + s0 * ry * 0.985); }
    ctx.stroke();
    // 层标签：固定在右缘
    ctx.globalAlpha = a; ctx.font = this.fontSmall; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const count = this.nodes.filter((n) => n.level === lv).length, bad = this.nodes.filter((n) => n.level === lv && n.b.status !== 'normal').length;
    ctx.fillStyle = COLORS.muted; ctx.fillText(`${LEVEL_NAME[lv]} · ${count}`, c.sx + rx + 12, c.sy - 7);
    if (bad) { ctx.fillStyle = COLORS.status.warning; ctx.fillText(`${bad} 个异常`, c.sx + rx + 12, c.sy + 8); }
    ctx.restore();
  }

  drawTerminals(n) {
    const ctx = this.ctx, a = n.layerA * clamp(n.reveal, 0, 1) * 0.9; if (a < 0.02) return;
    const k = this.s * this.view.zoom / 48; const p = { sx: 0, sy: 0, d: 0 };
    const rgb = hexRgb(COLORS.terminal);
    for (const t of n.terminals) {
      this.project(n.x + Math.cos(t.ang) * t.rad, n.y, n.z + Math.sin(t.ang) * t.rad, p);
      const tw = 0.55 + 0.45 * Math.sin(this.time * 1.4 + t.ph);
      ctx.fillStyle = rgba(rgb, a * t.life * (0.35 + 0.55 * tw));
      ctx.beginPath(); ctx.arc(p.sx, p.sy, t.size * k, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawRipple(r) {
    const ctx = this.ctx, n = r.n, p = (this.time - r.born) / r.dur, k = this.nodeR(n);
    const rgb = hexRgb(n.b.status === 'critical' ? COLORS.status.critical : COLORS.status.warning);
    const rx = k * (1.3 + 3.0 * easeOutCubic(p));
    ctx.strokeStyle = rgba(rgb, Math.pow(1 - p, 1.6) * 0.6 * n.layerA); ctx.lineWidth = 1.5;
    this.ellipse(n.base.sx, n.base.sy, rx, rx * this.tilt); ctx.stroke();
  }

  pointAt(l, t, out) {
    t = clamp(t, 0, 1); const f = t * (SAMPLES - 1), i = Math.min(SAMPLES - 2, Math.floor(f)), u = f - i;
    const a = l.pts2[i], b = l.pts2[i + 1]; out = out || {}; out.sx = a.sx + (b.sx - a.sx) * u; out.sy = a.sy + (b.sy - a.sy) * u; return out;
  }

  drawLink(l) {
    const ctx = this.ctx; if (l.alpha < 0.02) return;
    const st = l.l.status;
    const rgb = st === 'critical' ? hexRgb(COLORS.status.critical) : st === 'warning' ? hexRgb(COLORS.status.warning) : l.activeK > 0.02 ? COLORS.linkActive : COLORS.link;
    const spotOn = this.spot && this.spot.links.has(l.id);
    let a = (st !== 'normal' ? 0.8 : 0.22 + 0.24 * l.activeK) * l.alpha;
    if (st === 'critical') a *= 0.7 + 0.3 * Math.sin(this.time * 2.0);
    if (spotOn) a = Math.max(a, 0.75 * l.alpha);
    const w = (st !== 'normal' ? 1.6 : 1 + 0.35 * l.activeK) + (spotOn ? 0.4 : 0);
    const inset = clamp((this.nodeR(l.a) + 3) / l.lenPx, 0, 0.3), insetB = clamp((this.nodeR(l.b) + 3) / l.lenPx, 0, 0.3);
    ctx.strokeStyle = rgba(rgb, a); ctx.lineWidth = w;
    if (l.transient) ctx.setLineDash([5, 5]);
    ctx.beginPath();
    const p0 = this.pointAt(l, inset); ctx.moveTo(p0.sx, p0.sy);
    for (let i = 1; i < SAMPLES - 1; i++) { const t = i / (SAMPLES - 1); if (t <= inset || t >= 1 - insetB) continue; ctx.lineTo(l.pts2[i].sx, l.pts2[i].sy); }
    const p1 = this.pointAt(l, 1 - insetB); ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke(); ctx.setLineDash([]);
    // 方向箭头：有流量时显示
    if (l.activeK > 0.05) {
      const dirs = l.l.dir === 2 ? [1, -1] : [1];
      for (const d of dirs) {
        const t = d > 0 ? 1 - insetB - 0.04 : inset + 0.04;
        const p = this.pointAt(l, t), q = this.pointAt(l, t + 0.03 * d);
        const an = Math.atan2(q.sy - p.sy, q.sx - p.sx), sz = 4.5;
        ctx.fillStyle = rgba(rgb, a * l.activeK * 1.2);
        ctx.beginPath(); ctx.moveTo(p.sx + Math.cos(an) * sz, p.sy + Math.sin(an) * sz);
        ctx.lineTo(p.sx + Math.cos(an + 2.5) * sz, p.sy + Math.sin(an + 2.5) * sz); ctx.lineTo(p.sx + Math.cos(an - 2.5) * sz, p.sy + Math.sin(an - 2.5) * sz); ctx.closePath(); ctx.fill();
      }
    }
  }

  drawPulses(l) {
    if (!l.pulses.length || l.alpha < 0.05) return;
    const ctx = this.ctx, rgb = COLORS.linkActive, tail = clamp(1.7 / l.len3, 0.08, 0.42);
    const a = l.alpha * (this.spot && !this.spot.links.has(l.id) ? 0.5 : 1);
    for (const p of l.pulses) {
      const N = 9; let prev = this.pointAt(l, p.t - p.dir * tail);
      for (let k = 1; k <= N; k++) {
        const t = p.t - p.dir * tail * (1 - k / N); const q = this.pointAt(l, t);
        const f = k / N;
        ctx.strokeStyle = rgba(rgb, a * Math.pow(f, 1.6) * 0.85); ctx.lineWidth = 0.8 + 2.6 * f;
        ctx.beginPath(); ctx.moveTo(prev.sx, prev.sy); ctx.lineTo(q.sx, q.sy); ctx.stroke(); prev = q;
      }
      if (p.t >= 0 && p.t <= 1) {
        const h = this.pointAt(l, p.t);
        ctx.fillStyle = rgba(rgb, a * 0.18); ctx.beginPath(); ctx.arc(h.sx, h.sy, 7.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(rgb, a); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(h.sx, h.sy, 3.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  drawNode(n) {
    const ctx = this.ctx, a = n.layerA * clamp(n.reveal, 0, 1); if (a < 0.02 || n.reveal <= 0) return;
    const r = this.nodeR(n), col = n.col, abnormal = n.b.status !== 'normal';
    const depthA = 0.86 + 0.14 * clamp((n.top.d + LAYERS.general.R) / (2 * LAYERS.general.R), 0, 1);
    ctx.globalAlpha = a * depthA;
    // 接触阴影 + 悬浮支柱
    ctx.fillStyle = rgba(COLORS.shadow, 0.14); this.ellipse(n.base.sx, n.base.sy, r * 1.05, r * 1.05 * this.tilt); ctx.fill();
    ctx.strokeStyle = rgba(hexRgb(COLORS.rim), 0.95); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(n.base.sx, n.base.sy); ctx.lineTo(n.top.sx, n.top.sy + r * 0.9); ctx.stroke();
    // 外环（核心层常驻，其它层悬停时）
    const halo = n.level === 'core' ? 0.2 : 0; const hk = halo + n.hoverK * 0.35;
    if (hk > 0.01) { ctx.strokeStyle = rgba(col, hk); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(n.top.sx, n.top.sy, r * 1.65, 0, Math.PI * 2); ctx.stroke(); }
    // 本体：白底 + 色环 + 内点
    ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = n.level === 'core' ? 2.6 : 2.2;
    ctx.beginPath(); ctx.arc(n.top.sx, n.top.sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = rgba(col, 1); ctx.beginPath(); ctx.arc(n.top.sx, n.top.sy, r * 0.42, 0, Math.PI * 2); ctx.fill();
    if (abnormal) { // 状态角标
      ctx.fillStyle = rgba(col, 1); ctx.beginPath(); ctx.arc(n.top.sx + r * 0.75, n.top.sy - r * 0.75, r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawLabel(n) {
    const ctx = this.ctx, r = this.nodeR(n), abnormal = n.b.status !== 'normal';
    const text = abnormal ? `${n.b.status === 'critical' ? '故障' : '告警'} · ${n.b.name}` : n.b.name;
    ctx.globalAlpha = n.layerA;
    ctx.font = abnormal ? this.font.replace('500', '600') : this.font; ctx.textAlign = 'center';
    const below = n.labelBelow && !abnormal; ctx.textBaseline = below ? 'top' : 'bottom';
    const y = below ? n.top.sy + r + 5 : n.top.sy - r - 5;
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.strokeText(text, n.top.sx, y);
    ctx.fillStyle = abnormal ? (n.b.status === 'critical' ? COLORS.status.critical : COLORS.status.warning) : COLORS.ink; ctx.fillText(text, n.top.sx, y);
    ctx.globalAlpha = 1;
  }
}
