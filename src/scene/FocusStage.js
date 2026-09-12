import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FlowTube } from './FlowTube.js';
import { createSystemModel } from './SystemModel.js';
import { haloTexture, softTexture, sparkTexture } from '../core/textures.js';
import { THEME, LEVEL_NAME, colorOf } from '../config.js';
import { tween, Ease } from '../core/Tween.js';
import { TERMINAL_TYPES_LIST } from '../data/mock.js';

// 局部聚焦视图：以业务为中心的“舞台”
//   中心 = 业务本体；内环 = 组件；外环 = 本地终端；边缘“出口” = 远端业务 / 远端终端（只做示意，不在主视角展开）
const R_COMP = 9.5, R_TERM_MIN = 13.5, R_TERM_MAX = 18, R_PORTAL = 23, R_FLOOR = 26;
const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const compGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.22, 6);
const compEdges = new THREE.EdgesGeometry(compGeo);
const compTopGeo = new THREE.SphereGeometry(0.26, 16, 12);
const gateGeo = new THREE.TorusGeometry(1.5, 0.05, 8, 48, Math.PI);
const chevronGeo = new THREE.ConeGeometry(0.32, 0.9, 4);
const sphereGeo = new THREE.SphereGeometry(1, 32, 24);

const floorShader = {
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uRadius; uniform float uOpacity; uniform float uTime; varying vec2 vP;
    float hexDist(vec2 p){ p = abs(p); return max(p.x * 0.5 + p.y * 0.866025, p.x); }
    void main(){
      float r = length(vP) / uRadius; if (r > 1.0) discard;
      vec2 p = vP / 2.2;
      const vec2 s = vec2(1.0, 1.7320508);
      vec2 a = mod(p, s) - s * 0.5; vec2 b = mod(p - s * 0.5, s) - s * 0.5;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      float d = hexDist(gv);
      float edge = smoothstep(0.45, 0.5, d) * 0.22;
      float cell = (1.0 - smoothstep(0.0, 0.5, d)) * 0.03;
      float rim = (1.0 - smoothstep(0.0, 0.4, (1.0 - r) * uRadius)) * 0.9;
      float ring1 = 1.0 - smoothstep(0.0, 0.12, abs(length(vP) - ${R_COMP.toFixed(1)}));
      float ring2 = 1.0 - smoothstep(0.0, 0.12, abs(length(vP) - ${R_PORTAL.toFixed(1)}));
      float wave = pow(1.0 - abs(fract(r * 1.0 - uTime * 0.08) - 0.5) * 2.0, 24.0) * 0.18;
      float fade = 1.0 - smoothstep(0.55, 1.0, r) * 0.7;
      float al = (edge + cell + rim + (ring1 + ring2) * 0.35 + wave) * fade * uOpacity;
      gl_FragColor = vec4(uColor * al, al);
    }`,
};

const rnd = (a, b) => a + Math.random() * (b - a);

export class FocusStage {
  constructor(app, node, ctx) {
    this.app = app; this.node = node; this.b = node.data; this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.position.copy(node.position);
    this.color = new THREE.Color(THEME.stage);
    this.reveal = 0;
    this.tubes = [];
    this.pickables = [];
    this.comps = [];
    this.portals = new Map(); // linkId → portal
    this.sparks = [];
    this.time = 0;
    this.remoteIdleAt = -1;
    this.build();
    app.scene.add(this.group);
    tween(this, { reveal: 1 }, { duration: 1.1, ease: Ease.outCubic });
    this.unsub = ctx.links.on((e) => this.onLinkEvent(e));
  }

  addPick(object, entry) { const p = this.app.addPickable({ object, ...entry }); this.pickables.push(object); return p; }

  build() {
    const g = this.group;
    // 地面：六边形网格（与全局的圆形刻度盘区分）
    this.floorMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: this.color }, uRadius: { value: R_FLOOR }, uOpacity: { value: 0 }, uTime: { value: 0 } }, ...floorShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R_FLOOR, 96), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.8; floor.renderOrder = -5;
    g.add(floor);

    // 中心业务体：与全局同一套系统模型，放大呈现
    this.center = createSystemModel(this.b.level, colorOf.business(this.b), 1.1);
    this.center.group.scale.setScalar(2.2);
    this.center.group.position.y = -0.7;
    g.add(this.center.group);
    const centerPick = new THREE.Mesh(sphereGeo, pickMat); centerPick.scale.setScalar(3.2); centerPick.position.y = 1.2;
    g.add(centerPick);
    this.addPick(centerPick, { onHover: (hit, px) => this.ctx.tooltip.business(hit ? this.b : null, px, this.ctx) });
    const titleEl = document.createElement('div'); titleEl.className = 'lbl stage-title'; titleEl.textContent = this.b.name;
    this.titleEl = titleEl; const titleObj = new CSS2DObject(titleEl); titleObj.position.y = 4.2; g.add(titleObj);

    // 组件环
    const comps = this.b.components;
    const compPos = new Map();
    comps.forEach((c, i) => {
      const ang = (i / comps.length) * Math.PI * 2 - Math.PI / 2;
      const pos = new THREE.Vector3(Math.cos(ang) * R_COMP, 0, Math.sin(ang) * R_COMP);
      compPos.set(c.id, pos);
      const col = c.status === 'critical' ? THEME.status.critical : c.status === 'warning' ? THEME.status.warning : THEME.stage;
      const holder = new THREE.Group(); holder.position.copy(pos);
      const body = new THREE.Mesh(compGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(0.22), transparent: true, opacity: 0.9 }));
      const edges = new THREE.LineSegments(compEdges, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
      const top = new THREE.Mesh(compTopGeo, new THREE.MeshBasicMaterial({ color: col })); top.position.y = 0.45;
      const topHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: col, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); topHalo.position.y = 0.45; topHalo.scale.setScalar(2.4);
      const pick = new THREE.Mesh(sphereGeo, pickMat); pick.scale.setScalar(1.4);
      holder.add(body, edges, top, topHalo, pick);
      const el = document.createElement('div'); el.className = `lbl comp ${c.status}`; el.textContent = c.name;
      holder.add(new CSS2DObject(el));
      g.add(holder);
      this.addPick(pick, { onHover: (hit, px) => this.ctx.tooltip.component(hit ? c : null, px, this.b) });
      // 辐条：中心 ↔ 组件，有数据时整条点亮并定向流动
      const spoke = new FlowTube(new THREE.LineCurve3(new THREE.Vector3(0, 0.3, 0), pos.clone()), { color: col, radius: 0.06, segments: 12, baseAlpha: 0.05, pickRadius: 0.3, dashSpacing: 1.3, speed: 1.5, arrowScale: 0.45 });
      g.add(spoke.group); this.tubes.push(spoke);
      const flow = { on: Math.random() < 0.6, until: this.time + rnd(2, 8) };
      spoke.setActive(flow.on, Math.random() < 0.5 ? 1 : -1);
      this.comps.push({ data: c, holder, pos, spoke, el, flow, mats: [body.material, edges.material, top.material, topHalo.material] });
    });
    // 组件间调用关系
    this.compLinks = [];
    for (const cl of this.b.componentLinks) {
      const a = compPos.get(cl.from), b2 = compPos.get(cl.to);
      if (!a || !b2) continue;
      const mid = a.clone().add(b2).multiplyScalar(0.5); mid.y += 1.2;
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b2.clone());
      const t = new FlowTube(curve, { color: THEME.stage, radius: 0.045, segments: 24, baseAlpha: 0.04, pickRadius: 0.25, dashSpacing: 1.2, speed: 1.5, arrowScale: 0.35 });
      t.isCompLink = true; g.add(t.group); this.tubes.push(t);
      this.compLinks.push({ tube: t, flow: { on: Math.random() < 0.4, until: this.time + rnd(2, 8) } });
      t.setActive(this.compLinks.at(-1).flow.on, 1);
    }

    this.buildTerminals();
    this.buildPortals();
  }

  // ---- 本地终端 ----
  buildTerminals() {
    const b = this.b;
    const n = Math.max(24, Math.min(170, Math.round(b.terminals.local / 7)));
    this.termN = n;
    const attach = this.comps.filter((c) => c.data.type === 'gateway' || c.data.type === 'app');
    const targets = attach.length ? attach : this.comps;
    const pos = new Float32Array(n * 3), alpha = new Float32Array(n), linePos = new Float32Array(n * 6), lineAlpha = new Float32Array(n * 2);
    this.terms = [];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, r = R_TERM_MIN + Math.random() * (R_TERM_MAX - R_TERM_MIN);
      const p = new THREE.Vector3(Math.cos(ang) * r, (Math.random() - 0.5) * 2.2, Math.sin(ang) * r);
      const comp = targets[Math.floor(Math.random() * targets.length)];
      pos.set([p.x, p.y, p.z], i * 3);
      linePos.set([p.x, p.y, p.z, comp.pos.x, comp.pos.y + 0.45, comp.pos.z], i * 6);
      this.terms.push({ p, comp, birth: -Math.random() * 20, dur: 8 + Math.random() * 45, id: `T-${Math.floor(1000 + Math.random() * 9000)}`, type: TERMINAL_TYPES_LIST[Math.floor(Math.random() * TERMINAL_TYPES_LIST.length)], ip: `10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` });
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.termMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(THEME.terminal) }, uDim: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `attribute float aAlpha; uniform float uPixelRatio; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; vA = aAlpha; gl_PointSize = 3.2 * uPixelRatio * (60.0 / -mv.z); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uDim; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, r) * vA * uDim; if (a < 0.003) discard; gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.termPoints = new THREE.Points(pg, this.termMat); this.termPoints.frustumCulled = false; this.termPoints.renderOrder = 3;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lg.setAttribute('aAlpha', new THREE.BufferAttribute(lineAlpha, 1));
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(THEME.terminal) }, uDim: { value: 0 } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uDim; varying float vA; void main(){ float a = vA * 0.22 * uDim; gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.termLines = new THREE.LineSegments(lg, this.lineMat); this.termLines.frustumCulled = false;
    this.group.add(this.termPoints, this.termLines);
    this.addPick(this.termPoints, { onHover: (hit, px) => this.ctx.tooltip.terminal(hit ? this.terms[hit.index] : null, px, this.b) });
    this.sparkMat = new THREE.SpriteMaterial({ map: sparkTexture(), color: THEME.terminal, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkAcc = 0;
  }

  // ---- 出口（远端业务 / 远端终端）----
  buildPortals() {
    for (const rec of this.ctx.links.linksOf(this.b.id)) this.addPortal(rec);
    this.addRemoteTerminalPortal();
    this.layoutPortals();
  }

  outwardDir(rec, dir) { return rec.from === this.b.id ? dir : -dir; }

  addPortal(rec) {
    if (this.portals.has(rec.id)) return;
    const otherId = rec.from === this.b.id ? rec.to : rec.from;
    const other = this.ctx.nodes.get(otherId);
    if (!other) return;
    const dir = other.position.clone().sub(this.node.position);
    const want = Math.atan2(dir.z, dir.x);
    const portal = this.makePortal({ kind: 'business', color: colorOf.link(rec), want, rec, other });
    if (rec.active) portal.tube.setActive(true, this.outwardDir(rec, rec.dir));
    this.portals.set(rec.id, portal);
    this.layoutPortals();
  }

  addRemoteTerminalPortal() {
    const portal = this.makePortal({ kind: 'terminals', color: THEME.terminal, want: Math.PI * 0.5 });
    this.portals.set('__remote_terminals', portal);
  }

  makePortal({ kind, color, want, rec, other }) {
    const holder = new THREE.Group();
    const col = new THREE.Color(color);
    const gate = new THREE.Mesh(gateGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0 }));
    const chevron = new THREE.Mesh(chevronGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0 }));
    chevron.rotation.z = -Math.PI / 2; chevron.rotation.y = Math.PI / 4; chevron.position.set(2.4, 0, 0);
    const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.scale.set(1.1, 4, 1); beam.position.y = 1.3;
    const pick = new THREE.Mesh(sphereGeo, pickMat); pick.scale.setScalar(2.2);
    holder.add(gate, chevron, beam, pick);
    const el = document.createElement('div');
    el.className = `lbl portal ${kind === 'terminals' ? 'terminals' : rec.status}`;
    holder.add(new CSS2DObject(el));
    this.group.add(holder);
    const tube = new FlowTube(new THREE.LineCurve3(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(R_PORTAL, 0, 0)), { color, radius: 0.07, segments: 24, baseAlpha: 0.05, edgeFade: true, pickRadius: 0.4, dashSpacing: 1.8, speed: 1.3, arrowScale: 0.6, bidirectional: !!rec?.bidirectional });
    this.group.add(tube.group); this.tubes.push(tube);
    const portal = { kind, rec, other, holder, gate, chevron, beam, el, tube, want, angle: want, mats: [gate.material, chevron.material, beam.material] };
    this.addPick(pick, {
      onHover: (hit, px) => (kind === 'terminals' ? this.ctx.tooltip.remoteTerminals(hit ? this.b : null, px) : this.ctx.tooltip.portal(hit ? portal : null, px, this.b, this.ctx)),
      onClick: kind === 'terminals' ? undefined : () => this.ctx.onNavigate(other.data.id),
    });
    this.addPick(tube.pickMesh, { onHover: (hit, px) => { tube.setHover(!!hit); if (kind === 'terminals') this.ctx.tooltip.remoteTerminals(hit ? this.b : null, px); else this.ctx.tooltip.link(hit ? rec : null, px, this.ctx); } });
    this.refreshPortalLabel(portal);
    return portal;
  }

  refreshPortalLabel(p) {
    if (p.kind === 'terminals') { p.el.innerHTML = `远端终端 · ${this.b.terminals.remote.toLocaleString()} 在线<small>REMOTE TERMINALS</small>`; return; }
    const rate = this.ctx.links.ratePerMin(p.rec);
    p.el.className = `lbl portal ${p.rec.status}${p.rec.active ? ' active' : ''}`;
    p.el.innerHTML = `${p.other.data.name}<small>${LEVEL_NAME[p.other.data.level]} · ${p.rec.type}${p.rec.transient ? ' · 临时' : ''} · ${p.rec.active ? `流转中 ${rate}/min` : '无数据'}</small>`;
  }

  // 出口沿边缘按真实方位排布，角度过近时相互推开；远端终端出口放在最空的位置
  layoutPortals() {
    const list = [...this.portals.values()].filter((p) => p.kind !== 'terminals').sort((a, b) => a.want - b.want);
    const minGap = 0.3;
    list.forEach((p) => (p.angle = p.want));
    for (let iter = 0; iter < 40; iter++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = list[(i + 1) % list.length];
        if (list.length < 2) break;
        let gap = b.angle - a.angle; if (i === list.length - 1) gap += Math.PI * 2;
        if (gap < minGap) { const push = (minGap - gap) / 2; a.angle -= push; b.angle += push; moved = true; }
      }
      if (!moved) break;
    }
    const rt = this.portals.get('__remote_terminals');
    if (rt) {
      if (!list.length) rt.angle = Math.PI * 0.5;
      else { const s = list.map((p) => p.angle).sort((x, y) => x - y); let best = 0, bestGap = -1; for (let i = 0; i < s.length; i++) { const nx = i === s.length - 1 ? s[0] + Math.PI * 2 : s[i + 1]; const gap = nx - s[i]; if (gap > bestGap) { bestGap = gap; best = s[i] + gap / 2; } } rt.angle = best; }
    }
    for (const p of this.portals.values()) { p.holder.rotation.y = -p.angle; p.tube.group.rotation.y = -p.angle; }
  }

  onLinkEvent(e) {
    const rec = e.link;
    const mine = rec.from === this.b.id || rec.to === this.b.id;
    if (!mine) return;
    const p = this.portals.get(rec.id);
    if (e.type === 'add') this.addPortal(rec);
    else if (e.type === 'remove') this.removePortal(rec.id);
    else if (e.type === 'active' && p) { p.tube.setActive(true, this.outwardDir(rec, e.dir)); this.refreshPortalLabel(p); }
    else if (e.type === 'idle' && p) { p.tube.setActive(false); this.refreshPortalLabel(p); }
    else if (e.type === 'status' && p) { const c = colorOf.link(rec); p.tube.setColor(c); p.tube.setFlicker(rec.status === 'critical'); for (const m of p.mats) m.color.set(c); this.refreshPortalLabel(p); }
    this.ctx.onRelationsChanged?.();
  }

  removePortal(id) {
    const p = this.portals.get(id);
    if (!p) return;
    this.portals.delete(id);
    p.tube.dispose(); this.tubes = this.tubes.filter((t) => t !== p.tube);
    p.holder.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
    p.holder.removeFromParent(); this.layoutPortals();
  }

  // 外部事件：本地终端有数据 → 一颗火花从终端飞向组件；远端终端 → 远端终端出口点亮 6 秒
  terminalEvent(kind) {
    if (kind === 'remote') { this.portals.get('__remote_terminals')?.tube.setActive(true, -1); this.remoteIdleAt = this.time + 6; return; }
    this.spawnSpark();
  }

  spawnSpark() {
    const alive = this.terms.filter((t) => this.termAlpha(t) > 0.5);
    if (!alive.length) return;
    const t = alive[Math.floor(Math.random() * alive.length)];
    const s = new THREE.Sprite(this.sparkMat); s.scale.setScalar(0.65); s.renderOrder = 6;
    this.group.add(s);
    const inbound = Math.random() < 0.7;
    const cp = t.comp.pos.clone().add(new THREE.Vector3(0, 0.45, 0));
    this.sparks.push({ s, from: inbound ? t.p : cp, to: inbound ? cp : t.p, t: 0, dur: 1.1 });
  }

  termAlpha(t) {
    const age = (this.time - t.birth) % (t.dur + 6); // 周期性上线 / 下线
    if (age < 0 || age > t.dur) return 0;
    return Math.min(1, age / 1.2) * Math.min(1, (t.dur - age) / 1.5);
  }

  setTerminals() { this.refreshPortalLabel(this.portals.get('__remote_terminals')); }

  update(dt, time) {
    this.time = time;
    const r = this.reveal, b = this.b;
    this.floorMat.uniforms.uTime.value = time; this.floorMat.uniforms.uOpacity.value = r;
    this.center.setColor(colorOf.business(b));
    this.center.update(dt, time, r, b.status, 0);
    this.titleEl.style.opacity = r;
    // 组件依次弹出；辐条 / 组件间连接按各自节奏在“流转 / 空闲”间切换
    this.comps.forEach((c, i) => {
      const k = Math.max(0, Math.min(1, (r * 1.6 - i * 0.07) / 0.7));
      const s = Ease.outBack(k) * 0.999 + 0.001;
      c.holder.scale.setScalar(Math.max(0.001, s));
      c.holder.position.copy(c.pos).multiplyScalar(0.7 + 0.3 * k);
      c.holder.children[0].material.opacity = 0.9 * k; c.holder.children[1].material.opacity = 0.9 * k; c.holder.children[3].material.opacity = 0.6 * k;
      c.el.style.opacity = k;
      c.spoke.setDim(k);
      if (time > c.flow.until) { c.flow.on = Math.random() < 0.65; c.flow.until = time + (c.flow.on ? rnd(5, 14) : rnd(3, 8)); c.spoke.setActive(c.flow.on, Math.random() < 0.6 ? 1 : -1); }
    });
    for (const cl of this.compLinks) if (time > cl.flow.until) { cl.flow.on = Math.random() < 0.5; cl.flow.until = time + (cl.flow.on ? rnd(4, 12) : rnd(3, 9)); cl.tube.setActive(cl.flow.on, 1); }
    // 终端上线 / 下线
    const tr = Math.max(0, (r - 0.35) / 0.65);
    this.termMat.uniforms.uDim.value = tr; this.lineMat.uniforms.uDim.value = tr;
    const pa = this.termPoints.geometry.attributes.aAlpha, la = this.termLines.geometry.attributes.aAlpha;
    for (let i = 0; i < this.termN; i++) { const a = this.termAlpha(this.terms[i]); pa.array[i] = a; la.array[i * 2] = a; la.array[i * 2 + 1] = a * 0.35; }
    pa.needsUpdate = true; la.needsUpdate = true;
    // 出口
    if (this.remoteIdleAt > 0 && time > this.remoteIdleAt) { this.remoteIdleAt = -1; this.portals.get('__remote_terminals')?.tube.setActive(false); }
    for (const p of this.portals.values()) {
      const k = Math.max(0, (r - 0.45) / 0.55);
      const rad = R_PORTAL + (1 - k) * 7;
      p.gate.position.x = rad; p.chevron.position.x = rad + 2.4; p.beam.position.x = rad;
      p.holder.children[3].position.x = rad; p.holder.children[4].position.x = rad;
      const act = 0.45 + 0.55 * p.tube.active; // 无数据的出口更淡
      p.mats[0].opacity = 0.9 * k * act; p.mats[1].opacity = 0.8 * k * act; p.mats[2].opacity = 0.16 * k * act;
      p.el.style.opacity = k * (0.55 + 0.45 * p.tube.active);
      p.tube.setDim(k);
      p.chevron.position.x += Math.sin(time * 2.2) * 0.25 * p.tube.active;
    }
    for (const t of this.tubes) { t.update(dt, time); if (t.isCompLink) t.setDim(tr); }
    // 本地终端偶发火花（频率与业务级别相关，保持克制）
    this.sparkAcc += dt;
    const period = b.level === 'core' ? 0.7 : b.level === 'important' ? 1.0 : 1.4;
    if (this.sparkAcc > period && r > 0.8) { this.sparkAcc = 0; this.spawnSpark(); }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i]; sp.t += dt / sp.dur;
      if (sp.t >= 1) { sp.s.removeFromParent(); this.sparks.splice(i, 1); continue; }
      sp.s.position.lerpVectors(sp.from, sp.to, Ease.inOutCubic(sp.t));
      sp.s.material.opacity = Math.sin(sp.t * Math.PI);
    }
  }

  close(onDone) {
    this.unsub();
    tween(this, { reveal: 0 }, { duration: 0.45, ease: Ease.inOutCubic, onComplete: () => { this.dispose(); onDone?.(); } });
  }

  dispose() {
    for (const o of this.pickables) this.app.removePickable(o);
    for (const t of this.tubes) t.dispose();
    for (const sp of this.sparks) sp.s.removeFromParent();
    this.group.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
    this.group.removeFromParent();
    this.termPoints.geometry.dispose(); this.termLines.geometry.dispose(); this.termMat.dispose(); this.lineMat.dispose(); this.floorMat.dispose();
  }
}
