import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { FlowTube } from './FlowTube.js';
import { createSystemModel } from './SystemModel.js';
import { haloTexture, softTexture, sparkTexture } from '../core/textures.js';
import { THEME, LEVEL_NAME, TERMINAL_TYPES, ALARM, heartbeat, colorOf, hashPhase } from '../config.js';
import { tween, Ease } from '../core/Tween.js';

// 局部聚焦视图：以业务为中心的“舞台”
//   中心 = 业务本体；内环 = 组件（按类型有不同剪影）；外环 = 本地终端；边缘“出口” = 远端业务 / 远端终端（只做示意，不在主视角展开）
const R_COMP = 9.5, R_TERM_MIN = 13.5, R_TERM_MAX = 18, R_PORTAL = 23, R_FLOOR = 26, R_CENTER = 2.6;
const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const sphereGeo = new THREE.SphereGeometry(1, 24, 18);
const gateGeo = new THREE.TorusGeometry(1.5, 0.05, 8, 48, Math.PI);
const chevronGeo = new THREE.ConeGeometry(0.32, 0.9, 4);
const selRingGeo = new THREE.RingGeometry(1.25, 1.42, 48);
const topGeo = new THREE.SphereGeometry(0.22, 16, 12);
const rnd = (a, b) => a + Math.random() * (b - a);

// 组件几何：按类型给出不同剪影（同一材质语言：暗填充 + 亮边线 + 顶部标记）
const compGeos = {};
function compGeometry(type) {
  if (compGeos[type]) return compGeos[type];
  let parts;
  switch (type) {
    case 'db': parts = [[new THREE.CylinderGeometry(0.7, 0.7, 0.18, 24), 0.09], [new THREE.CylinderGeometry(0.7, 0.7, 0.18, 24), 0.39]]; break;
    case 'cache': parts = [[new THREE.TorusGeometry(0.62, 0.13, 10, 32).rotateX(Math.PI / 2), 0.13]]; break;
    case 'mq': parts = [-0.42, 0, 0.42].map((x) => [new THREE.BoxGeometry(0.3, 0.26, 0.7).translate(x, 0, 0), 0.13]); break;
    case 'storage': parts = [[new THREE.BoxGeometry(1.1, 0.42, 1.1), 0.21]]; break;
    case 'gateway': parts = [[new THREE.CylinderGeometry(0.75, 0.75, 0.12, 6), 0.06], [new THREE.TorusGeometry(0.55, 0.06, 8, 24, Math.PI).rotateZ(0), 0.12]]; break;
    case 'sched': parts = [[new THREE.TorusGeometry(0.6, 0.07, 8, 32).rotateX(Math.PI / 2), 0.07], [new THREE.BoxGeometry(0.08, 0.12, 0.55).translate(0, 0, 0.3), 0.06]]; break;
    default: parts = [[new THREE.CylinderGeometry(0.85, 0.85, 0.22, 6), 0.11]];
  }
  compGeos[type] = parts.map(([geo, y]) => ({ geo, edges: new THREE.EdgesGeometry(geo, 20), y }));
  return compGeos[type];
}

export class FocusStage {
  constructor(app, node, ctx) {
    this.app = app; this.node = node; this.b = node.data; this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.position.copy(node.position);
    this.color = new THREE.Color(THEME.stage);
    this.reveal = 0;
    this.tubes = [];
    this.pickables = [];
    this.disposables = [];
    this.comps = [];
    this.portals = new Map(); // linkId → portal
    this.sparks = [];
    this.time = 0;
    this.remoteIdleAt = -1;
    this.selected = null;
    this.highlighted = null;
    this.build();
    app.scene.add(this.group);
    tween(this, { reveal: 1 }, { duration: 1.05, delay: 0.4, ease: Ease.outQuint });
    this.unsub = ctx.links.on((e) => this.onLinkEvent(e));
  }

  track(o) { this.disposables.push(o); return o; }
  addPick(object, entry) { const p = this.app.addPickable({ object, ...entry }); this.pickables.push(object); return p; }
  mat(color, opacity, extra = {}) { return this.track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, ...extra })); }

  build() {
    const g = this.group;
    // 地面：六边形网格（与全局的圆形刻度盘区分）
    this.floorMat = this.track(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uRadius: { value: R_FLOOR }, uOpacity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uRadius; uniform float uOpacity; uniform float uTime; varying vec2 vP;
        float hexDist(vec2 p){ p = abs(p); return max(p.x * 0.5 + p.y * 0.866025, p.x); }
        void main(){
          float r = length(vP) / uRadius; if (r > 1.0) discard;
          vec2 p = vP / 2.2; const vec2 s = vec2(1.0, 1.7320508);
          vec2 a = mod(p, s) - s * 0.5; vec2 b = mod(p - s * 0.5, s) - s * 0.5;
          vec2 gv = dot(a, a) < dot(b, b) ? a : b;
          float d = hexDist(gv);
          float edge = smoothstep(0.45, 0.5, d) * 0.2;
          float cell = (1.0 - smoothstep(0.0, 0.5, d)) * 0.03;
          float rim = (1.0 - smoothstep(0.0, 0.4, (1.0 - r) * uRadius)) * 0.9;
          float ring1 = 1.0 - smoothstep(0.0, 0.12, abs(length(vP) - ${R_COMP.toFixed(1)}));
          float ring2 = 1.0 - smoothstep(0.0, 0.12, abs(length(vP) - ${R_PORTAL.toFixed(1)}));
          float wave = pow(1.0 - abs(fract(r - uTime * 0.05) - 0.5) * 2.0, 24.0) * 0.15;
          float fade = 1.0 - smoothstep(0.55, 1.0, r) * 0.7;
          float al = (edge + cell + rim + (ring1 + ring2) * 0.35 + wave) * fade * uOpacity;
          gl_FragColor = vec4(uColor * al, al);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const floor = new THREE.Mesh(this.track(new THREE.CircleGeometry(R_FLOOR, 96)), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.8; floor.renderOrder = -5;
    g.add(floor);

    // 中心业务体：与全局同一套系统模型，放大呈现
    this.center = createSystemModel(this.b.level, colorOf.business(this.b), 1.1, hashPhase(this.b.id));
    this.center.group.scale.setScalar(2.2);
    this.center.group.position.y = -0.7;
    g.add(this.center.group);
    const centerPick = new THREE.Mesh(sphereGeo, pickMat); centerPick.scale.setScalar(3.2); centerPick.position.y = 1.2;
    g.add(centerPick);
    this.addPick(centerPick, { tier: 0, onHover: (hit, px) => this.ctx.tooltip.business(hit ? this.b : null, px, this.ctx) });
    const titleEl = document.createElement('div'); titleEl.className = 'lbl stage-title'; titleEl.innerHTML = '<span class="in"></span>'; titleEl.firstChild.textContent = this.b.name;
    this.titleEl = titleEl; const titleObj = new CSS2DObject(titleEl); titleObj.position.y = 4.2; g.add(titleObj);

    // 组件环
    const comps = this.b.components || [];
    const compPos = new Map();
    comps.forEach((c, i) => {
      const ang = (i / comps.length) * Math.PI * 2 - Math.PI / 2;
      const pos = new THREE.Vector3(Math.cos(ang) * R_COMP, 0, Math.sin(ang) * R_COMP);
      compPos.set(c.id, pos);
      const col = this.compColor(c);
      const holder = new THREE.Group(); holder.position.copy(pos);
      const fillMat = this.mat(new THREE.Color(col).multiplyScalar(0.22), 0.9);
      const edgeMat = this.track(new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
      const topMat = this.mat(col, 1);
      const haloMat = this.track(new THREE.SpriteMaterial({ map: haloTexture(), color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ringMat = this.mat(col, 0, { side: THREE.DoubleSide });
      const shape = new THREE.Group();
      let topY = 0.4;
      for (const part of compGeometry(c.type)) {
        const m = new THREE.Mesh(part.geo, fillMat); m.position.y = part.y;
        const e = new THREE.LineSegments(part.edges, edgeMat); e.position.y = part.y;
        shape.add(m, e); topY = Math.max(topY, part.y + 0.35);
      }
      const top = new THREE.Mesh(topGeo, topMat); top.position.y = topY + 0.2;
      const halo = new THREE.Sprite(haloMat); halo.position.y = topY + 0.2; halo.scale.setScalar(2.2);
      const pick = new THREE.Mesh(sphereGeo, pickMat); pick.scale.setScalar(1.7); pick.position.y = 0.4;
      const ring = new THREE.Mesh(selRingGeo, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.1;
      holder.add(shape, top, halo, pick, ring);
      const el = document.createElement('div'); el.className = `lbl comp ${c.status}`; el.innerHTML = '<span class="in"></span>'; el.firstChild.textContent = c.name;
      el.onclick = (e) => { e.stopPropagation(); this.ctx.onSelectComponent(c.id); };
      el.onpointerenter = (e) => this.ctx.tooltip.component(c, { x: e.clientX, y: e.clientY }, this.b);
      el.onpointerleave = () => this.ctx.tooltip.hide();
      holder.add(new CSS2DObject(el));
      g.add(holder);
      this.addPick(pick, { tier: 0, onHover: (hit, px) => this.ctx.tooltip.component(hit ? c : null, px, this.b), onClick: () => this.ctx.onSelectComponent(c.id) });
      // 辐条：中心 ↔ 组件，常亮；有数据时辉光飞过
      const dir = pos.clone().normalize();
      const spoke = new FlowTube(new THREE.LineCurve3(dir.clone().multiplyScalar(R_CENTER).setY(0.2), pos.clone().sub(dir.clone().multiplyScalar(0.95))), { color: col, radius: 0.06, segments: 12, baseAlpha: 0.16, pickRadius: 0.3, speedUnits: 9, tailUnits: 2.4, arrowScale: 0.45, arrowInset: 0.5, endFade: 0.3 });
      g.add(spoke.group); this.tubes.push(spoke);
      const flow = { on: Math.random() < 0.6, until: rnd(2, 8), dir: Math.random() < 0.6 ? 1 : -1, next: 0 };
      spoke.setActive(flow.on, flow.dir);
      this.comps.push({ data: c, holder, shape, pos, spoke, el, ring, top, halo, flow, mats: { fill: fillMat, edge: edgeMat, top: topMat, halo: haloMat, ring: ringMat }, phase: hashPhase(c.id) });
    });
    // 组件间调用关系
    this.compLinks = [];
    for (const cl of this.b.componentLinks || []) {
      const a = compPos.get(cl.from), b2 = compPos.get(cl.to);
      if (!a || !b2) continue;
      const d = b2.clone().sub(a).normalize();
      const A = a.clone().add(d.clone().multiplyScalar(0.9)), B = b2.clone().sub(d.clone().multiplyScalar(0.9));
      const mid = A.clone().add(B).multiplyScalar(0.5); mid.y += 1.2;
      const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
      const t = new FlowTube(curve, { color: THEME.stage, radius: 0.045, segments: 24, baseAlpha: 0.12, pickRadius: 0.25, speedUnits: 9, tailUnits: 2.4, arrowScale: 0.35, arrowInset: 0.4, endFade: 0.2 });
      t.isCompLink = true; g.add(t.group); this.tubes.push(t);
      this.compLinks.push({ tube: t, from: cl.from, to: cl.to, flow: { on: Math.random() < 0.4, until: rnd(2, 8), next: 0 } });
      t.setActive(this.compLinks.at(-1).flow.on, 1);
    }

    this.buildTerminals();
    this.buildPortals();
  }

  compColor(c) { return c.status === 'critical' ? THEME.status.critical : c.status === 'warning' ? THEME.status.warning : THEME.stage; }

  // ---- 本地终端 ----
  buildTerminals() {
    const b = this.b;
    const n = Math.max(24, Math.min(170, Math.round(b.terminals.local / 7)));
    this.termN = n;
    const attach = this.comps.filter((c) => c.data.type === 'gateway' || c.data.type === 'app');
    const targets = attach.length ? attach : this.comps.length ? this.comps : [{ pos: new THREE.Vector3(0, 0, 0), data: { id: '__center', name: this.b.name } }]; // 无组件明细时终端直接接到中心
    const pos = new Float32Array(n * 3), alpha = new Float32Array(n), linePos = new Float32Array(n * 6), lineAlpha = new Float32Array(n * 2);
    this.terms = [];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, r = R_TERM_MIN + Math.random() * (R_TERM_MAX - R_TERM_MIN);
      const p = new THREE.Vector3(Math.cos(ang) * r, (Math.random() - 0.5) * 0.8, Math.sin(ang) * r);
      const comp = targets[Math.floor(Math.random() * targets.length)];
      pos.set([p.x, p.y, p.z], i * 3);
      linePos.set([p.x, p.y, p.z, comp.pos.x, comp.pos.y + 0.45, comp.pos.z], i * 6);
      this.terms.push({ p, comp, birth: -Math.random() * 20, dur: 8 + Math.random() * 45, hitAt: -100, id: `T-${Math.floor(1000 + Math.random() * 9000)}`, type: TERMINAL_TYPES[Math.floor(Math.random() * TERMINAL_TYPES.length)], ip: `10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` });
    }
    const pg = this.track(new THREE.BufferGeometry());
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.termMat = this.track(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(THEME.terminal) }, uDim: { value: 0 }, uPixelRatio: this.app.prUniform || { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `attribute float aAlpha; uniform float uPixelRatio; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; vA = aAlpha; gl_PointSize = 3.2 * uPixelRatio * (60.0 / -mv.z); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uDim; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.12, r) * vA * uDim; if (a < 0.003) discard; gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.termPoints = new THREE.Points(pg, this.termMat); this.termPoints.frustumCulled = false; this.termPoints.renderOrder = 3;
    const lg = this.track(new THREE.BufferGeometry());
    lg.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lg.setAttribute('aAlpha', new THREE.BufferAttribute(lineAlpha, 1));
    this.lineMat = this.track(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(THEME.terminal) }, uDim: { value: 0 } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); vA = aAlpha; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uDim; varying float vA; void main(){ float a = vA * 0.35 * uDim; gl_FragColor = vec4(uColor * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.termLines = new THREE.LineSegments(lg, this.lineMat); this.termLines.frustumCulled = false;
    this.group.add(this.termPoints, this.termLines);
    this.addPick(this.termPoints, { tier: 2, renderable: true, onHover: (hit, px) => { const t = hit && this.termAlpha(this.terms[hit.index]) > 0.1 ? this.terms[hit.index] : null; this.ctx.tooltip.terminal(t, px, this.b); } });
    this.sparkMat = this.track(new THREE.SpriteMaterial({ map: sparkTexture(), color: THEME.terminal, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
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
    const portal = this.makePortal({ kind: 'business', color: colorOf.link(rec), want: Math.atan2(dir.z, dir.x), rec, other });
    if (rec.active) portal.tube.setActive(true, this.outwardDir(rec, rec.dir));
    if (rec.status !== 'normal') portal.tube.setColor(colorOf.link(rec), THEME.hdrGain);
    if (rec.status === 'critical') portal.tube.setAlarm(true);
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
    if (rec && rec.status !== 'normal') col.multiplyScalar(THEME.hdrGain);
    const gate = new THREE.Mesh(gateGeo, this.mat(col, 0));
    const chevron = new THREE.Mesh(chevronGeo, this.mat(col, 0));
    chevron.rotation.z = -Math.PI / 2; chevron.rotation.y = Math.PI / 4; chevron.position.set(2.4, 0, 0);
    const beam = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: softTexture(), color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
    beam.scale.set(1.1, 4, 1); beam.position.y = 1.3;
    const pick = new THREE.Mesh(sphereGeo, pickMat); pick.scale.setScalar(2.2);
    holder.add(gate, chevron, beam, pick);
    const el = document.createElement('div');
    el.className = `lbl portal ${kind === 'terminals' ? 'terminals' : rec.status}`;
    const navigate = () => { if (kind !== 'terminals') this.ctx.onNavigate(other.data.id); };
    el.onclick = (e) => { e.stopPropagation(); navigate(); };
    holder.add(new CSS2DObject(el));
    this.group.add(holder);
    const tube = new FlowTube(new THREE.LineCurve3(new THREE.Vector3(R_CENTER, 0.2, 0), new THREE.Vector3(R_PORTAL, 0, 0)), { color: col.getHex(), radius: 0.07, segments: 24, baseAlpha: 0.14, edgeFade: true, pickRadius: 0.4, speedUnits: 12, tailUnits: 4, arrowScale: 0.6, arrowInset: 0.6, bidirectional: !!rec?.bidirectional, endFade: 0.3 });
    this.group.add(tube.group); this.tubes.push(tube);
    const portal = { kind, rec, other, holder, gate, chevron, beam, el, tube, pick, want, angle: want, mats: [gate.material, chevron.material, beam.material], hover: 0, flash: 0 };
    const hoverFn = (hit, px) => {
      portal.hover = hit ? 1 : 0;
      if (kind === 'terminals') this.ctx.tooltip.remoteTerminals(hit ? this.b : null, px);
      else { this.ctx.tooltip.portal(hit ? portal : null, px, this.b, this.ctx); this.ctx.onPortalHover?.(hit ? rec.id : null); }
      this.refreshPortalLabel(portal);
    };
    this.addPick(pick, { tier: 0, onHover: hoverFn, onClick: kind === 'terminals' ? undefined : navigate });
    this.addPick(tube.pickMesh, { tier: 1, onHover: (hit, px) => { tube.setHover(!!hit || this.highlighted === rec?.id); hoverFn(hit, px); }, onClick: kind === 'terminals' ? undefined : navigate });
    el.onpointerenter = (e) => hoverFn(true, { x: e.clientX, y: e.clientY });
    el.onpointerleave = () => hoverFn(null);
    this.refreshPortalLabel(portal);
    return portal;
  }

  refreshPortalLabel(p) {
    if (p.kind === 'terminals') { p.el.innerHTML = `<span class="in">远端终端 · ${this.b.terminals.remote.toLocaleString()} 在线<small>REMOTE TERMINALS</small></span>`; return; }
    const rate = this.ctx.links.ratePerMin(p.rec);
    const showSub = p.rec.active || p.hover || this.highlighted === p.rec.id || p.rec.status !== 'normal';
    p.el.className = `lbl portal ${p.rec.status}${p.rec.active ? ' active' : ''}${showSub ? ' sub' : ''}`;
    const sub = `${LEVEL_NAME[p.other.data.level]} · ${p.rec.type}${p.rec.transient ? ' · 临时' : ''} · ${p.rec.active ? `流转中 ${rate}/min` : '无数据'}`;
    if (p.el.dataset.sub !== sub || !p.el.firstChild) {
      p.el.dataset.sub = sub;
      p.el.innerHTML = '<span class="in"><span class="nm"></span><small></small></span>';
      p.el.querySelector('.nm').textContent = p.other.data.name; p.el.querySelector('small').textContent = sub;
    }
  }

  // 出口沿边缘按真实方位排布，角度过近时相互推开；远端终端出口放在最空的位置
  layoutPortals() {
    const list = [...this.portals.values()].filter((p) => p.kind !== 'terminals').sort((a, b) => a.want - b.want);
    const minGap = Math.min(0.3, (Math.PI * 2) / Math.max(1, list.length + 1));
    list.forEach((p) => (p.angle = p.want));
    for (let iter = 0; iter < 60; iter++) {
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
    if (!(rec.from === this.b.id || rec.to === this.b.id)) return;
    const p = this.portals.get(rec.id);
    if (e.type === 'add') this.addPortal(rec);
    else if (e.type === 'remove') this.removePortal(rec.id);
    else if (e.type === 'active' && p) { p.tube.setActive(true, this.outwardDir(rec, e.dir)); this.refreshPortalLabel(p); }
    else if (e.type === 'idle' && p) { p.tube.setActive(false); this.refreshPortalLabel(p); }
    else if (e.type === 'pulse' && p) { p.tube.pulse(this.outwardDir(rec, e.dir)); this.refreshPortalLabel(p); return; }
    else if (e.type === 'status' && p) { const c = new THREE.Color(colorOf.link(rec)); if (rec.status !== 'normal') c.multiplyScalar(THEME.hdrGain); p.tube.setColor(colorOf.link(rec), rec.status === 'normal' ? 1 : THEME.hdrGain); p.tube.setAlarm(rec.status === 'critical'); for (const m of p.mats) m.color.copy(c); this.refreshPortalLabel(p); }
    if (['add', 'remove', 'active', 'idle', 'status'].includes(e.type)) this.ctx.onRelationsChanged?.();
  }

  removePortal(id) {
    const p = this.portals.get(id);
    if (!p) return;
    this.portals.delete(id);
    for (const o of [p.pick, p.tube.pickMesh]) { this.app.removePickable(o); this.pickables = this.pickables.filter((x) => x !== o); }
    p.tube.dispose(); this.tubes = this.tubes.filter((t) => t !== p.tube);
    p.holder.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
    p.holder.removeFromParent(); this.layoutPortals();
  }

  // 从关系列表 / 告警进入：高亮某条出口（管线提亮 + 门闪一下）
  highlightPortal(linkId) {
    this.highlighted = linkId;
    for (const p of this.portals.values()) { if (p.kind === 'terminals') continue; const on = p.rec.id === linkId; p.tube.setHover(on); if (on) p.flash = 2; this.refreshPortalLabel(p); }
  }

  // 外部事件：本地终端有数据 → 一颗火花从终端飞向组件；远端终端 → 远端终端出口点亮 6 秒
  terminalEvent(kind) {
    if (kind === 'remote') { const t = this.portals.get('__remote_terminals')?.tube; if (t) { t.setActive(true, -1); t.pulse(-1); } this.remoteIdleAt = this.time + 6; return; }
    this.spawnSpark();
  }

  spawnSpark() {
    const alive = this.terms.filter((t) => this.termAlpha(t) > 0.5);
    if (!alive.length) return;
    const t = alive[Math.floor(Math.random() * alive.length)];
    const s = new THREE.Sprite(this.sparkMat.clone()); s.scale.setScalar(0.65); s.renderOrder = 6;
    this.group.add(s);
    t.hitAt = this.time;
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

  // 选中组件：地面出现选中环，其余组件略退后，其终端连线点亮
  selectComponent(cid) { this.selected = cid || null; }

  // 组件状态变化：重新着色（填充、边线、顶点、辐条、标签）
  refreshComponent(cid) {
    const c = this.comps.find((x) => x.data.id === cid);
    if (!c) return;
    const st = c.data.status;
    const col = new THREE.Color(this.compColor(c.data));
    if (st !== 'normal') col.multiplyScalar(THEME.hdrGain);
    c.mats.fill.color.copy(col).multiplyScalar(0.22);
    for (const k of ['edge', 'top', 'halo', 'ring']) c.mats[k].color.copy(col);
    c.spoke.setColor(this.compColor(c.data), st === 'normal' ? 1 : THEME.hdrGain); c.spoke.setAlarm(st === 'critical');
    c.el.className = `lbl comp ${st}`;
  }

  // 组件卡需要的关联信息：上下游组件、接入终端估算
  componentInfo(cid) {
    const byId = new Map(this.b.components.map((c) => [c.id, c]));
    const cls = this.b.componentLinks || [];
    const upstream = cls.filter((l) => l.to === cid).map((l) => byId.get(l.from)).filter(Boolean);
    const downstream = cls.filter((l) => l.from === cid).map((l) => byId.get(l.to)).filter(Boolean);
    const attached = this.terms.filter((t) => t.comp.data.id === cid).length;
    const terminals = attached ? Math.round((attached / this.termN) * this.b.terminals.local) : 0;
    return { upstream, downstream, terminals };
  }

  update(dt, time) {
    this.time = time;
    const r = this.reveal, b = this.b;
    this.floorMat.uniforms.uTime.value = time; this.floorMat.uniforms.uOpacity.value = Math.min(1, r * 2);
    this.center.setColor(colorOf.business(b), b.status === 'normal' ? 1 : THEME.hdrGain);
    this.center.update(dt, time, r, b.status, 0);
    this.titleEl.style.opacity = r;
    const sel = this.selected;
    // 组件依次展开；辐条 / 组件间连接按各自节奏在“流转 / 空闲”间切换
    this.comps.forEach((c, i) => {
      const k = Math.max(0, Math.min(1, (r * 1.5 - i * 0.06) / 0.7));
      const isSel = sel === c.data.id;
      c.holder.scale.setScalar(Math.max(0.001, (0.6 + 0.4 * k) * (isSel ? 1.12 : 1)));
      c.holder.position.copy(c.pos).multiplyScalar(0.8 + 0.2 * k);
      const st = c.data.status;
      const beat = st === 'critical' ? 0.7 + 0.3 * heartbeat(time, ALARM.critical) : st === 'warning' ? 0.8 + 0.2 * heartbeat(time, ALARM.warning) : 1;
      const back = sel && !isSel ? 0.6 : 1;
      c.mats.fill.opacity = 0.9 * k * back; c.mats.edge.opacity = 0.9 * k * beat * back; c.mats.top.opacity = k * back; c.mats.halo.opacity = 0.5 * k * beat * back;
      c.mats.ring.opacity += ((isSel ? 0.9 : 0) - c.mats.ring.opacity) * Math.min(1, dt * 6);
      c.el.style.opacity = k * (sel && !isSel ? 0.55 : 1);
      c.spoke.setDim(k);
      c.spoke.setHover(isSel);
      if (time > c.flow.until) { c.flow.on = Math.random() < 0.65; c.flow.until = time + (c.flow.on ? rnd(5, 14) : rnd(3, 8)); c.flow.dir = Math.random() < 0.6 ? 1 : -1; c.spoke.setActive(c.flow.on, c.flow.dir); }
      if (c.flow.on && time > c.flow.next && r > 0.8) { c.flow.next = time + rnd(2, 3.5); c.spoke.pulse(c.flow.dir); }
    });
    for (const cl of this.compLinks) {
      if (time > cl.flow.until) { cl.flow.on = Math.random() < 0.5; cl.flow.until = time + (cl.flow.on ? rnd(4, 12) : rnd(3, 9)); cl.tube.setActive(cl.flow.on, 1); }
      if (cl.flow.on && time > cl.flow.next && r > 0.8) { cl.flow.next = time + rnd(2.5, 4.5); cl.tube.pulse(1); }
      cl.tube.setHover(!!sel && (cl.from === sel || cl.to === sel));
    }
    // 终端上线 / 下线；连线只给近期有过火花的终端（选中组件时其终端整体点亮）
    const tr = Math.max(0, (r - 0.35) / 0.65);
    this.termMat.uniforms.uDim.value = tr; this.lineMat.uniforms.uDim.value = tr;
    const pa = this.termPoints.geometry.attributes.aAlpha, la = this.termLines.geometry.attributes.aAlpha;
    for (let i = 0; i < this.termN; i++) {
      const t = this.terms[i];
      const a = this.termAlpha(t);
      const mine = sel && t.comp.data.id === sel;
      const hit = Math.max(0, 1 - (time - t.hitAt) / 4);
      pa.array[i] = a * (sel ? (mine ? 1.4 : 0.35) : 1);
      const line = a * (mine ? 0.9 : hit * 0.8);
      la.array[i * 2] = line; la.array[i * 2 + 1] = line * 0.35;
    }
    pa.needsUpdate = true; la.needsUpdate = true;
    // 出口
    if (this.remoteIdleAt > 0 && time > this.remoteIdleAt) { this.remoteIdleAt = -1; this.portals.get('__remote_terminals')?.tube.setActive(false); }
    const k = Math.max(0, (r - 0.45) / 0.55);
    for (const p of this.portals.values()) {
      const rad = R_PORTAL + (1 - k) * 7;
      p.gate.position.x = rad; p.chevron.position.x = rad + 2.4; p.beam.position.x = rad;
      p.holder.children[3].position.x = rad; p.holder.children[4].position.x = rad;
      const hi = this.highlighted && p.rec?.id === this.highlighted ? 1 : 0;
      p.flash = Math.max(0, p.flash - dt);
      const act = 0.45 + 0.55 * Math.max(p.tube.active, hi, p.hover);
      const flashK = 1 + Math.sin(p.flash * Math.PI * 2) * 0.25 * Math.min(1, p.flash);
      p.gate.scale.setScalar(flashK);
      p.mats[0].opacity = 0.9 * k * act; p.mats[1].opacity = 0.8 * k * act; p.mats[2].opacity = 0.16 * k * act;
      p.el.style.opacity = k * (0.55 + 0.45 * Math.max(p.tube.active, hi, p.hover));
      p.tube.setDim(k);
      p.chevron.position.x += Math.sin(time * 2.2) * 0.25 * p.tube.active;
    }
    const beat = 0.5 + 0.5 * heartbeat(time, ALARM.critical);
    for (const t of this.tubes) { t.update(dt, time, beat); if (t.isCompLink) t.setDim(tr); }
    // 本地终端偶发火花（真实接入时由 terminalEvent 驱动，这里保持很低的环境频率）
    this.sparkAcc += dt;
    const period = b.level === 'core' ? 1.2 : b.level === 'important' ? 1.8 : 2.6;
    if (this.sparkAcc > period && r > 0.8) { this.sparkAcc = 0; this.spawnSpark(); }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i]; sp.t += dt / sp.dur;
      if (sp.t >= 1) { sp.s.removeFromParent(); sp.s.material.dispose(); this.sparks.splice(i, 1); continue; }
      sp.s.position.lerpVectors(sp.from, sp.to, Ease.inOutCubic(sp.t));
      sp.s.material.opacity = Math.sin(sp.t * Math.PI);
    }
  }

  close(onDone) {
    this.unsub();
    this.ctx.onPortalHover?.(null);
    tween(this, { reveal: 0 }, { duration: 0.4, ease: Ease.inOutCubic, onComplete: () => { this.dispose(); onDone?.(); } });
  }

  dispose() {
    for (const o of this.pickables) this.app.removePickable(o);
    for (const t of this.tubes) t.dispose();
    for (const sp of this.sparks) { sp.s.removeFromParent(); sp.s.material.dispose(); }
    this.center.dispose();
    for (const d of this.disposables) d.dispose?.();
    this.group.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
    this.group.removeFromParent();
  }
}
