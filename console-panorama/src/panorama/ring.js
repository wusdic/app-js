// 「全景环」画布渲染：同心三层业务环（弧段即业务）+ 穿过中心的束状流转弦 + 外圈终端活动刻度 + 异常涟漪
// 纯 Canvas 2D；浅色；平面正视，无旋转，所有文字保持可读
export const LEVELS = ['core', 'important', 'general'];
export const LEVEL_NAME = { core: '核心业务', important: '重要业务', general: '一般业务' };
export const COLORS = {
  ink: '#1b2436', muted: '#75809a',
  level: { core: '#3b4fd8', important: '#1d9a8c', general: '#8e9db8' },
  status: { warning: '#e0891a', critical: '#e0433f', ok: '#1f9d6a' },
  ring: { core: '#eef0fc', important: '#e8f6f4', general: '#f0f3f8' },
  guide: '#dfe4ee',
};
const BANDS = { core: [0.44, 0.60], important: [0.66, 0.79], general: [0.84, 0.94] };
const TICKS = [0.965, 1.08];
const DISC = 0.30;
const GAP = { core: 2.6, important: 2.2, general: 1.8 }; // 度
const SAMPLES = 26;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (rgb, a) => `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; };
const RGB = { level: Object.fromEntries(Object.entries(COLORS.level).map(([k, v]) => [k, hexRgb(v)])), status: Object.fromEntries(Object.entries(COLORS.status).map(([k, v]) => [k, hexRgb(v)])) };

export class Ring {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1; this.cx = 0; this.cy = 0; this.base = 200;
    this.segs = []; this.segById = new Map(); this.links = []; this.linkById = new Map();
    this.hover = null; this.pinned = null; this.spot = null; this.onlyActive = false;
    this.time = 0; this.intro = -1; this.sweep = 0; this.ripples = []; this.bursts = [];
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.font = '500 11.5px Sora, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    this.fontTiny = '600 10px Sora, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    this.score = 100; this.scoreShown = 0;
    this.discK = 1; // 锁定业务时中心盘放大
  }

  // ---------- 数据与角度布局 ----------
  setData(data) {
    this.data = data; this.segs = []; this.segById.clear(); this.links = []; this.linkById.clear();
    for (const lv of LEVELS) {
      const list = data.businesses.filter((b) => b.level === lv).slice().sort((a, b) => a.dept.localeCompare(b.dept, 'zh'));
      const gap = (GAP[lv] * Math.PI) / 180, span = (TAU - list.length * gap) / list.length;
      list.forEach((b, i) => {
        const a0 = -Math.PI / 2 + i * (span + gap) + gap / 2 + (lv === 'important' ? span * 0.35 : lv === 'general' ? span * 0.6 : 0);
        const s = { id: b.id, b, level: lv, a0, a1: a0 + span, mid: a0 + span / 2, hoverK: 0, alpha: 1, col: RGB.level[lv].slice(), colT: RGB.level[lv], reveal: 1, nextRipple: 0, tx: 0, rx: 0, ticks: [] };
        this.retarget(s); this.setTerminalCount(s, b.terminals);
        this.segs.push(s); this.segById.set(b.id, s);
      });
    }
    for (const l of data.links) this.addLink(l);
    this.layoutChords();
  }
  retarget(s) { s.colT = s.b.status === 'critical' ? RGB.status.critical : s.b.status === 'warning' ? RGB.status.warning : RGB.level[s.level]; }
  setTerminalCount(s, count) {
    s.b.terminals = count;
    const want = clamp(Math.round(3 + Math.log10(1 + count) * 3.4), 3, 15);
    const span = s.a1 - s.a0, m = span * 0.14;
    while (s.ticks.length < want) s.ticks.push({ u: 0, h: 0.5 + Math.random() * 0.5, ph: Math.random() * TAU, life: 0, blink: Math.random() < 0.18 });
    while (s.ticks.length > want) s.ticks.pop();
    s.ticks.forEach((t, i) => { t.u = s.a0 + m + ((i + 0.5) / s.ticks.length) * (span - 2 * m); });
    s.termH = 0.22 + 0.78 * clamp(Math.log10(1 + count) / 3.4, 0, 1);
  }
  addLink(l) {
    const a = this.segById.get(l.from), b = this.segById.get(l.to); if (!a || !b) return null;
    const rec = { id: l.id, l, a, b, pts: Array.from({ length: SAMPLES }, () => ({ x: 0, y: 0 })), active: false, activeK: 0, alpha: 0, comets: [], len: 1 };
    this.links.push(rec); this.linkById.set(l.id, rec);
    if (this.base) this.layoutChord(rec);
    return rec;
  }
  layoutChords() { for (const l of this.links) this.layoutChord(l); }
  layoutChord(l) {
    const P = (s) => { const r = BANDS[s.level][0] * this.base - 3; return [this.cx + Math.cos(s.mid) * r, this.cy + Math.sin(s.mid) * r]; };
    const A = P(l.a), B = P(l.b);
    // 控制点拉向中心：跨层的弦穿过内区，同层的弦贴着内缘绕行
    const same = l.a.level === l.b.level;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const k = same ? 0.55 : 0.28;
    const C = [this.cx + (mx - this.cx) * k, this.cy + (my - this.cy) * k];
    let len = 0, px = A[0], py = A[1];
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1), u = 1 - t, p = l.pts[i];
      p.x = u * u * A[0] + 2 * u * t * C[0] + t * t * B[0]; p.y = u * u * A[1] + 2 * u * t * C[1] + t * t * B[1];
      len += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y;
    }
    l.len = Math.max(1, len);
  }
  linksOf(id) { return this.links.filter((l) => l.a.id === id || l.b.id === id); }
  spotlightFor(id) { const ls = this.linksOf(id); const ns = new Set([id]); for (const l of ls) { ns.add(l.a.id); ns.add(l.b.id); } return { anchor: id, nodes: ns, links: new Set(ls.map((l) => l.id)) }; }
  touch(id, dir = 1) {
    const l = this.linkById.get(id); if (!l) return;
    (dir > 0 ? l.a : l.b).tx = 1;
    if (l.comets.length >= 3) return;
    l.comets.push({ t: dir > 0 ? 0 : 1, dir, spd: 150 / l.len });
  }
  setActive(id, on) { const l = this.linkById.get(id); if (l) l.active = on; }
  removeLink(id) { const l = this.linkById.get(id); if (!l) return; this.linkById.delete(id); this.links.splice(this.links.indexOf(l), 1); }
  startIntro() { if (this.reduced) { this.scoreShown = this.score; return; } this.intro = 0; for (const s of this.segs) s.reveal = 0; }

  // ---------- 几何 ----------
  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.base = Math.min(H * 0.455, W * 0.30);
    this.cx = W / 2; this.cy = H / 2;
    this.layoutChords();
  }
  discR() { return DISC * this.base * this.discK; }
  hitTest(px, py) {
    const dx = px - this.cx, dy = py - this.cy, r = Math.hypot(dx, dy) / this.base;
    let ang = Math.atan2(dy, dx);
    for (const lv of LEVELS) {
      const [r0, r1] = BANDS[lv]; if (r < r0 - 0.015 || r > r1 + 0.015) continue;
      for (const s of this.segs) { if (s.level !== lv) continue; let d = ang - s.a0; d = ((d % TAU) + TAU) % TAU; if (d <= s.a1 - s.a0) return s; }
    }
    return null;
  }
  pointAt(l, t, out) { t = clamp(t, 0, 1); const f = t * (SAMPLES - 1), i = Math.min(SAMPLES - 2, Math.floor(f)), u = f - i; const a = l.pts[i], b = l.pts[i + 1]; out = out || {}; out.x = a.x + (b.x - a.x) * u; out.y = a.y + (b.y - a.y) * u; return out; }

  // ---------- 更新 ----------
  update(dt) {
    this.time += dt;
    if (this.intro >= 0) {
      this.intro += dt;
      const starts = { core: 0.05, important: 0.35, general: 0.65 };
      for (const s of this.segs) { const k = clamp((this.intro - starts[s.level]) / 0.9, 0, 1); const u = (s.mid + Math.PI / 2 + TAU) % TAU / TAU; s.reveal = clamp((easeOutCubic(k) - u) / 0.18 + 1, 0, 1); }
      if (this.intro > 2.4) { this.intro = -1; for (const s of this.segs) s.reveal = 1; }
    }
    this.scoreShown = this.intro >= 0 && this.intro < 1.2 ? this.score * easeOutCubic(clamp(this.intro / 1.2, 0, 1)) : lerp(this.scoreShown, this.score, 1 - Math.exp(-dt * 3));
    if (!this.reduced) this.sweep = (this.sweep + dt * (TAU / 14)) % TAU;
    this.discK = lerp(this.discK, this.pinned ? 1.6 : 1, 1 - Math.exp(-dt * 6));
    const spot = this.spot;
    for (const s of this.segs) {
      let target = 1;
      if (spot) target = spot.nodes.has(s.id) ? 1 : 0.32;
      s.alpha = lerp(s.alpha, target, 1 - Math.exp(-dt * 7));
      s.hoverK = lerp(s.hoverK, this.hover === s.id || this.pinned === s.id ? 1 : 0, 1 - Math.exp(-dt * 9));
      for (let i = 0; i < 3; i++) s.col[i] = lerp(s.col[i], s.colT[i], 1 - Math.exp(-dt * 5));
      s.tx = Math.max(0, s.tx - dt * 1.6); s.rx = Math.max(0, s.rx - dt * 1.6);
      for (const t of s.ticks) t.life = Math.min(1, t.life + dt * 0.7);
      if (s.b.status !== 'normal' && !this.reduced) { s.nextRipple -= dt; if (s.nextRipple <= 0) { this.ripples.push({ s, born: this.time, dur: 2.0 }); s.nextRipple = s.b.status === 'critical' ? 2.6 : 3.6; } }
    }
    this.ripples = this.ripples.filter((r) => this.time - r.born < r.dur);
    this.bursts = this.bursts.filter((b) => this.time - b.born < 0.7);
    for (const l of this.links) {
      l.activeK = lerp(l.activeK, l.active ? 1 : 0, 1 - Math.exp(-dt * 3));
      let target = 1;
      if (spot) target = spot.links.has(l.id) ? 1 : 0.12;
      else if (this.onlyActive) target = l.active || l.l.status !== 'normal' ? 1 : 0.06;
      if (this.intro >= 0) target *= clamp((this.intro - 1.1) / 0.8, 0, 1);
      l.alpha = lerp(l.alpha, target, 1 - Math.exp(-dt * 6));
      for (let i = l.comets.length - 1; i >= 0; i--) {
        const c = l.comets[i]; const before = c.t; c.t += c.dir * c.spd * dt;
        if ((c.dir > 0 && before < 1 && c.t >= 1) || (c.dir < 0 && before > 0 && c.t <= 0)) { const recv = c.dir > 0 ? l.b : l.a; recv.rx = 1; const p = this.pointAt(l, c.dir > 0 ? 1 : 0); this.bursts.push({ x: p.x, y: p.y, born: this.time, rgb: this.linkRgb(l) }); }
        if (c.t > 1.25 || c.t < -0.25) l.comets.splice(i, 1);
      }
    }
  }
  linkRgb(l) { const st = l.l.status; return st === 'critical' ? RGB.status.critical : st === 'warning' ? RGB.status.warning : RGB.level[l.a.level === 'general' && l.b.level !== 'general' ? l.b.level : l.a.level]; }

  // ---------- 绘制 ----------
  draw() {
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    this.drawSweep();
    this.drawGuides();
    for (const s of this.segs) this.drawTicks(s);
    for (const r of this.ripples) this.drawRipple(r);
    for (const s of this.segs) this.drawSegment(s);
    for (const l of this.links) this.drawChord(l);
    for (const l of this.links) this.drawComets(l);
    for (const b of this.bursts) this.drawBurst(b);
    this.drawDisc();
    for (const s of this.segs) if (s.reveal > 0.6) this.drawLabel(s);
  }
  sector(r0, r1, a0, a1) { const c = this.ctx; c.beginPath(); c.arc(this.cx, this.cy, r1, a0, a1); c.arc(this.cx, this.cy, r0, a1, a0, true); c.closePath(); }
  drawSweep() {
    const ctx = this.ctx; if (this.reduced || !ctx.createConicGradient) return;
    const g = ctx.createConicGradient(this.sweep, this.cx, this.cy);
    g.addColorStop(0, 'rgba(59,79,216,0.075)'); g.addColorStop(0.12, 'rgba(59,79,216,0)'); g.addColorStop(1, 'rgba(59,79,216,0)');
    ctx.fillStyle = g; this.sector(this.discR() + 4, TICKS[1] * this.base, 0, TAU); ctx.fill();
  }
  drawGuides() {
    const ctx = this.ctx; ctx.strokeStyle = COLORS.guide; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
    for (const lv of LEVELS) { const [r0, r1] = BANDS[lv]; ctx.beginPath(); ctx.arc(this.cx, this.cy, ((r0 + r1) / 2) * this.base, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(this.cx, this.cy, TICKS[0] * this.base - 4, 0, TAU); ctx.strokeStyle = 'rgba(223,228,238,0.9)'; ctx.stroke();
  }
  drawSegment(s) {
    const ctx = this.ctx, [r0, r1] = BANDS[s.level], b = this.base, abnormal = s.b.status !== 'normal';
    const k = s.reveal; if (k <= 0) return;
    const a1 = s.a0 + (s.a1 - s.a0) * k;
    const grow = s.hoverK * 0.012 * b;
    ctx.globalAlpha = s.alpha;
    const fillA = abnormal ? 0.24 + 0.1 * s.hoverK : 0.14 + 0.16 * s.hoverK + (s.level === 'core' ? 0.04 : 0);
    this.sector(r0 * b - grow, r1 * b + grow, s.a0, a1);
    ctx.fillStyle = rgba(s.col, fillA); ctx.fill();
    ctx.strokeStyle = rgba(s.col, abnormal ? 0.95 : 0.55 + 0.4 * s.hoverK); ctx.lineWidth = abnormal ? 1.6 : 1; ctx.stroke();
    // 收发反馈：发送 → 内缘亮一道；接收 → 外缘亮一道
    if (s.tx > 0.01) { ctx.strokeStyle = rgba(s.col, s.tx * 0.9); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(this.cx, this.cy, r0 * b - grow, s.a0, a1); ctx.stroke(); }
    if (s.rx > 0.01) { ctx.strokeStyle = rgba(s.col, s.rx * 0.9); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(this.cx, this.cy, r1 * b + grow, s.a0, a1); ctx.stroke(); }
    // 异常角标：外缘中点一个小圆点
    if (abnormal) { const r = r1 * b + grow + 5, x = this.cx + Math.cos(s.mid) * r, y = this.cy + Math.sin(s.mid) * r; ctx.fillStyle = rgba(s.col, 1); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  drawTicks(s) {
    const ctx = this.ctx, b = this.base, rgb = s.col;
    const [t0, t1] = TICKS; const maxH = (t1 - t0) * b;
    ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (const t of s.ticks) {
      const wob = 0.86 + 0.14 * Math.sin(this.time * 1.5 + t.ph);
      const h = maxH * s.termH * t.h * wob * t.life * s.reveal;
      const blink = t.blink ? 0.45 + 0.55 * Math.max(0, Math.sin(this.time * 2.2 + t.ph)) : 1;
      ctx.strokeStyle = rgba(rgb, 0.42 * blink * s.alpha);
      const c = Math.cos(t.u), sn = Math.sin(t.u);
      ctx.beginPath(); ctx.moveTo(this.cx + c * t0 * b, this.cy + sn * t0 * b); ctx.lineTo(this.cx + c * (t0 * b + h), this.cy + sn * (t0 * b + h)); ctx.stroke();
    }
  }
  drawRipple(r) {
    const ctx = this.ctx, s = r.s, p = (this.time - r.born) / r.dur, b = this.base;
    const rr = BANDS[s.level][1] * b + 4 + easeOutCubic(p) * 0.09 * b;
    ctx.strokeStyle = rgba(s.col, Math.pow(1 - p, 1.5) * 0.7 * s.alpha); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, rr, s.a0, s.a1); ctx.stroke();
  }
  drawChord(l) {
    const ctx = this.ctx; if (l.alpha < 0.02) return;
    const st = l.l.status, rgb = this.linkRgb(l);
    const spotOn = this.spot && this.spot.links.has(l.id);
    let a = (st !== 'normal' ? 0.75 : 0.1 + 0.32 * l.activeK) * l.alpha; if (spotOn) a = Math.max(a, 0.7 * l.alpha);
    if (st === 'critical') a *= 0.7 + 0.3 * Math.sin(this.time * 2);
    ctx.strokeStyle = rgba(rgb, a); ctx.lineWidth = (st !== 'normal' ? 1.6 : 1 + 0.5 * l.activeK) + (spotOn ? 0.5 : 0);
    ctx.beginPath(); ctx.moveTo(l.pts[0].x, l.pts[0].y); for (let i = 1; i < SAMPLES; i++) ctx.lineTo(l.pts[i].x, l.pts[i].y); ctx.stroke();
  }
  drawComets(l) {
    if (!l.comets.length || l.alpha < 0.05) return;
    const ctx = this.ctx, rgb = this.linkRgb(l), tail = clamp(46 / l.len, 0.08, 0.4), a = l.alpha;
    for (const c of l.comets) {
      const N = 8; let prev = this.pointAt(l, c.t - c.dir * tail);
      for (let k = 1; k <= N; k++) { const q = this.pointAt(l, c.t - c.dir * tail * (1 - k / N)); const f = k / N; ctx.strokeStyle = rgba(rgb, a * Math.pow(f, 1.5) * 0.9); ctx.lineWidth = 0.8 + 2.4 * f; ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke(); prev = q; }
      if (c.t >= 0 && c.t <= 1) { const h = this.pointAt(l, c.t); ctx.fillStyle = rgba(rgb, a * 0.16); ctx.beginPath(); ctx.arc(h.x, h.y, 7, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; ctx.strokeStyle = rgba(rgb, a); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(h.x, h.y, 2.8, 0, TAU); ctx.fill(); ctx.stroke(); }
    }
  }
  drawBurst(b) { const ctx = this.ctx, p = (this.time - b.born) / 0.7; ctx.strokeStyle = rgba(b.rgb, (1 - p) * 0.7); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.x, b.y, 3 + p * 14, 0, TAU); ctx.stroke(); }
  drawDisc() {
    const ctx = this.ctx, r = this.discR();
    const sh = ctx.createRadialGradient(this.cx, this.cy + 6, r * 0.6, this.cx, this.cy + 6, r * 1.35);
    sh.addColorStop(0, 'rgba(27,36,54,0.12)'); sh.addColorStop(1, 'rgba(27,36,54,0)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(this.cx, this.cy + 6, r * 1.35, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(this.cx, this.cy, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e6eaf2'; ctx.lineWidth = 1; ctx.stroke();
    // 健康度弧：绕中心盘一圈，按分数着色
    const sc = this.scoreShown, col = sc >= 90 ? RGB.status.ok : sc >= 75 ? RGB.status.warning : RGB.status.critical;
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(27,36,54,0.06)'; ctx.beginPath(); ctx.arc(this.cx, this.cy, r - 6, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(col, 0.9); ctx.beginPath(); ctx.arc(this.cx, this.cy, r - 6, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(sc / 100, 0, 1)); ctx.stroke();
  }
  // 沿弧排布的文字：上半环顺时针、下半环逆时针，字符始终正立可读
  drawLabel(s) {
    const ctx = this.ctx, [r0, r1] = BANDS[s.level], r = ((r0 + r1) / 2 + (s.level === 'core' ? 0.025 : 0)) * this.base, abnormal = s.b.status !== 'normal';
    const text = s.b.name; const chars = [...text];
    ctx.font = s.level === 'core' ? this.font.replace('11.5px', '11px') : this.font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = s.alpha * clamp((s.reveal - 0.6) / 0.4, 0, 1);
    ctx.fillStyle = abnormal ? rgba(s.col, 1) : s.level === 'general' ? '#4d5a75' : COLORS.ink;
    let gapPx = 1.2;
    const widths = chars.map((c) => ctx.measureText(c).width), room = (s.a1 - s.a0) * r * 0.97;
    if (widths.reduce((a, w) => a + w, 0) + (chars.length - 1) * gapPx > room) { // 放不下：缩小字号、收紧字距
      ctx.font = this.fontTiny; const w2 = chars.map((c) => ctx.measureText(c).width); widths.splice(0, widths.length, ...w2); gapPx = 0.4;
    }
    const tot = widths.reduce((a, w) => a + w, 0) + (chars.length - 1) * gapPx;
    const bottom = Math.sin(s.mid) > 0.12;
    let ang = bottom ? s.mid + tot / (2 * r) : s.mid - tot / (2 * r);
    for (let i = 0; i < chars.length; i++) {
      const w = widths[i]; const a = bottom ? ang - w / (2 * r) : ang + w / (2 * r);
      ctx.save(); ctx.translate(this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r); ctx.rotate(bottom ? a - Math.PI / 2 : a + Math.PI / 2); ctx.fillText(chars[i], 0, 0); ctx.restore();
      ang = bottom ? ang - (w + gapPx) / r : ang + (w + gapPx) / r;
    }
    ctx.globalAlpha = 1;
  }
}
