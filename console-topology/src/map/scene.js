// 业务版图：浅色等轴 3D 场景（three.js）
// 六个业务域是带圆角与厚度的平台，域内业务是圆角立方体（高度 = 业务规模），跨域数据以弧线流光呈现，
// 终端是平台上环绕业务的微粒；软阴影 + 柔和材质，强调立体感与秩序感
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const STATUS_COLOR = { warning: '#f0a020', critical: '#e5484d' };
export const ACCENT = '#2f5fe8';
const CELL = 1.18, FOOT = 0.8, PLATE_H = 0.3, PAD = 0.32, GAP = 1.35, STRIP = 0.95; // STRIP：平台前缘预留给域名文字的条带
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return ((h >>> 0) % 1000) / 1000; };

let _dot;
function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.9)'); r.addColorStop(0.7, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c); _dot.colorSpace = THREE.SRGBColorSpace; return _dot;
}
// 平台表面的域名文字（贴在平台上的纹理平面）
function surfaceLabel(text, sub, color) {
  const w = 512, h = 160, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.font = '800 64px Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'; g.textBaseline = 'top';
  g.fillStyle = color; g.globalAlpha = 0.78; g.fillText(text, 8, 10);
  g.font = '600 32px Manrope, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'; g.globalAlpha = 0.6; g.fillText(sub, 12, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export class MapScene {
  constructor(canvas, labelRoot) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0); this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.labels = new CSS2DRenderer({ element: labelRoot });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    this.baseAz = Math.PI / 4 + 0.18; this.baseEl = 0.62;
    this.setCamera(this.baseAz, this.baseEl);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.09, rotateSpeed: 0.55, zoomSpeed: 0.6, minZoom: 0.85, maxZoom: 2.4, minPolarAngle: 0.5, maxPolarAngle: 1.15, minAzimuthAngle: this.baseAz - 1.0, maxAzimuthAngle: this.baseAz + 1.0 });
    this.controls.target.set(0, 0.3, 0);
    // 光照：天光 + 带软阴影的主光 + 逆光补光
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9e2f2, 1.05));
    const sun = new THREE.DirectionalLight(0xffffff, 1.55); sun.position.set(6, 12, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
    this.scene.add(sun); this.sun = sun;
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35); fill.position.set(-8, 6, -6); this.scene.add(fill);
    // 地面：只接收阴影
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ color: 0x1c2b4d, opacity: 0.13 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.001; ground.receiveShadow = true; this.scene.add(ground);

    this.raycaster = new THREE.Raycaster();
    this.domains = new Map(); this.blocks = new Map(); this.links = new Map(); this.pickables = [];
    this.hover = null; this.pinned = null; this.focusDomain = null; this.spot = null;
    this.time = 0; this.idle = 99; this.intro = -1; this.showNames = false; this.sway = true; this.flowsOn = true;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.target = new THREE.Vector3(0, 0.3, 0); this.zoomT = 1;
    this.ripples = [];
    this.controls.addEventListener('start', () => { this.idle = 0; this.userMoved = true; });
    this.controls.addEventListener('change', () => { this.idle = 0; });
    this.controls.addEventListener('end', () => { this.userMoved = false; });
  }
  setCamera(az, el, dist = 40) {
    this.camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist).add(this.target || new THREE.Vector3(0, 0.3, 0));
    this.camera.lookAt(this.target || new THREE.Vector3(0, 0.3, 0));
  }

  // ---------- 数据 → 场景 ----------
  setData(data) {
    this.data = data;
    // 平台布局：后排 经营管理 | 数据门户 | 办公协同，前排 安全保障 | 核心支撑 | 民生服务（核心居中靠前）
    const order = [['mgmt', 'data', 'collab'], ['security', 'core', 'service']];
    const size = {};
    for (const d of data.domains) {
      const n = data.businesses.filter((b) => b.domain === d.id).length;
      const cols = Math.ceil(Math.sqrt(n * 1.5)), rows = Math.ceil(n / cols);
      size[d.id] = { cols, rows, w: cols * CELL + PAD * 2, d: rows * CELL + PAD * 2 + STRIP };
    }
    const rowDepth = order.map((row) => Math.max(...row.map((id) => size[id].d)));
    const zRow = [-(rowDepth[0] / 2 + GAP / 2), rowDepth[1] / 2 + GAP / 2];
    order.forEach((row, ri) => {
      const total = row.reduce((s, id) => s + size[id].w, 0) + GAP * (row.length - 1);
      let x = -total / 2;
      for (const id of row) { const s = size[id]; s.x = x + s.w / 2; s.z = zRow[ri]; x += s.w + GAP; }
    });
    for (const d of data.domains) this.addDomain(d, size[d.id]);
    for (const b of data.businesses) this.addBlock(b);
    for (const l of data.links) this.addLink(l);
    this.buildTerminals();
    this.bounds = new THREE.Box3(); for (const dm of this.domains.values()) this.bounds.expandByObject(dm.plate);
    this.bounds.max.y = 2.6;
    this.fit();
  }
  addDomain(d, s) {
    const color = new THREE.Color(d.color);
    const tint = color.clone().lerp(new THREE.Color('#ffffff'), 0.86);
    const geo = new RoundedBoxGeometry(s.w, PLATE_H, s.d, 4, 0.16);
    const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: 0, transparent: true, opacity: 1 });
    const plate = new THREE.Mesh(geo, mat); plate.position.set(s.x, PLATE_H / 2, s.z); plate.castShadow = true; plate.receiveShadow = true;
    plate.userData = { kind: 'domain', id: d.id };
    // 侧壁色带：平台前缘一条域色描边
    const edge = new THREE.Mesh(new RoundedBoxGeometry(s.w + 0.02, 0.05, s.d + 0.02, 2, 0.16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    edge.position.set(s.x, 0.03, s.z); this.scene.add(edge);
    const lh = STRIP * 0.82, lw = lh * 512 / 160; // 域名文字贴在平台前缘条带上
    const label = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), new THREE.MeshBasicMaterial({ map: surfaceLabel(d.name, `${this.data.businesses.filter((b) => b.domain === d.id).length} 项业务`, d.color), transparent: true, depthWrite: false }));
    label.rotation.x = -Math.PI / 2; label.position.set(s.x - s.w / 2 + PAD + lw / 2, PLATE_H + 0.006, s.z + s.d / 2 - PAD * 0.6 - lh / 2); label.renderOrder = 2;
    this.scene.add(plate, label);
    this.pickables.push(plate);
    const rec = { d, s, plate, edge, label, mat, tint, color, rev: 1, dimK: 0, blocks: [] };
    this.domains.set(d.id, rec);
  }
  addBlock(b) {
    const dm = this.domains.get(b.domain); const i = dm.blocks.length;
    const col = i % dm.s.cols, row = Math.floor(i / dm.s.cols);
    const x = dm.s.x - dm.s.w / 2 + PAD + CELL / 2 + col * CELL, z = dm.s.z - dm.s.d / 2 + PAD + CELL / 2 + row * CELL;
    const h = 0.42 + b.scale * 0.34;
    const color = dm.color.clone().lerp(new THREE.Color('#ffffff'), 0.08);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, emissive: new THREE.Color(0x000000) });
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(FOOT, h, FOOT, 3, 0.11), mat);
    mesh.position.set(x, PLATE_H + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { kind: 'block', id: b.id };
    // 顶面高光片：让立方体顶面更“亮”，读出体积
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(FOOT - 0.16, FOOT - 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    cap.rotation.x = -Math.PI / 2; cap.position.y = h / 2 + 0.002; mesh.add(cap);
    this.scene.add(mesh); this.pickables.push(mesh);
    const nameEl = document.createElement('div'); nameEl.className = 'bm-name'; nameEl.textContent = b.name;
    const nameObj = new CSS2DObject(nameEl); nameObj.position.set(0, h / 2 + 0.22, 0); mesh.add(nameObj);
    const badgeEl = document.createElement('div'); badgeEl.className = 'bm-badge'; badgeEl.hidden = true;
    const badgeObj = new CSS2DObject(badgeEl); badgeObj.position.set(0, h / 2 + 0.66, 0); mesh.add(badgeObj);
    const rec = { b, dm, mesh, mat, cap, h, x, z, baseColor: color, colT: color.clone(), lift: 0, liftT: 0, scaleY: 1, nameEl, nameObj, badgeEl, badgeObj, phase: hash(b.id) * 6.28, nextRipple: 0, dimK: 0 };
    dm.blocks.push(rec); this.blocks.set(b.id, rec);
    this.retarget(rec);
    return rec;
  }
  retarget(rec) {
    const st = rec.b.status;
    rec.colT = st === 'normal' ? rec.baseColor.clone() : new THREE.Color(STATUS_COLOR[st]);
    rec.badgeEl.hidden = st === 'normal'; rec.badgeEl.textContent = st === 'critical' ? '故障' : '告警'; rec.badgeEl.className = `bm-badge ${st}`;
    rec.nameEl.classList.toggle('abnormal', st !== 'normal');
  }
  topOf(rec) { return new THREE.Vector3(rec.x, PLATE_H + rec.h + 0.06, rec.z); }
  addLink(l) {
    const a = this.blocks.get(l.from), b = this.blocks.get(l.to); if (!a || !b) return null;
    const A = this.topOf(a), B = this.topOf(b), dist = A.distanceTo(B);
    const cross = a.dm !== b.dm;
    const M = A.clone().add(B).multiplyScalar(0.5); M.y = Math.max(A.y, B.y) + (cross ? 0.55 + dist * 0.11 : 0.45 + dist * 0.16);
    const curve = new THREE.QuadraticBezierCurve3(A, M, B);
    const geo = new THREE.TubeGeometry(curve, cross ? 40 : 20, 0.02, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false });
    const tube = new THREE.Mesh(geo, mat); tube.visible = false; tube.renderOrder = 3; this.scene.add(tube);
    const spriteMat = new THREE.SpriteMaterial({ map: dotTexture(), color: ACCENT, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    const rec = { id: l.id, l, a, b, cross, curve, len: dist * 1.15, tube, mat, spriteMat, sprites: [], pulses: [], active: false, activeK: 0, opacity: 0, transient: !!l.transient, born: this.time, dieAt: l.transient ? this.time + (l.ttl || 9) : Infinity };
    this.links.set(l.id, rec);
    return rec;
  }
  removeLink(id) { const r = this.links.get(id); if (!r) return; this.scene.remove(r.tube); for (const s of r.sprites) this.scene.remove(s); r.tube.geometry.dispose(); r.mat.dispose(); r.spriteMat.dispose(); this.links.delete(id); }
  linksOf(id) { return [...this.links.values()].filter((l) => l.a.b.id === id || l.b.b.id === id); }
  pulse(id, dir = 1) { const r = this.links.get(id); if (!r || !this.flowsOn || r.pulses.length >= 2) return; r.pulses.push({ t: dir > 0 ? 0 : 1, dir, spd: 3.6 / r.len }); }
  setActive(id, on) { const r = this.links.get(id); if (r) r.active = on; }
  spotlightFor(id) { const ls = this.linksOf(id); const ns = new Set([id]); for (const l of ls) { ns.add(l.a.b.id); ns.add(l.b.b.id); } return { anchor: id, nodes: ns, links: new Set(ls.map((l) => l.id)) }; }

  buildTerminals() {
    this.term = [];
    for (const rec of this.blocks.values()) this.syncTerminals(rec);
    this.termGeo = new THREE.BufferGeometry();
    this.termPos = new Float32Array(1200 * 3); this.termGeo.setAttribute('position', new THREE.BufferAttribute(this.termPos, 3));
    this.termGeo.setDrawRange(0, 0);
    this.termPoints = new THREE.Points(this.termGeo, new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, map: dotTexture(), color: 0x7f93b8, transparent: true, opacity: 0.75, depthWrite: false }));
    this.termPoints.frustumCulled = false; this.scene.add(this.termPoints);
  }
  syncTerminals(rec) {
    const want = clamp(Math.round(2 + Math.log10(1 + rec.b.terminals) * 2.2), 3, 10);
    rec.terms = rec.terms || [];
    while (rec.terms.length < want) rec.terms.push({ ang: Math.random() * 6.28, rad: 0.62 + Math.random() * 0.34, spd: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.3), life: 0 });
    while (rec.terms.length > want) rec.terms.pop();
  }

  // ---------- 相机 ----------
  fit() {
    if (!this.bounds) return;
    const W = this.W || 800, H = this.H || 500;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const az = this.baseAz, el = this.baseEl;
    cam.position.set(Math.sin(az) * Math.cos(el) * 40, Math.sin(el) * 40, Math.cos(az) * Math.cos(el) * 40).add(new THREE.Vector3(0, 0.3, 0)); cam.lookAt(0, 0.3, 0); cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse; let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const b = this.bounds;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new THREE.Vector3(x, y, z).applyMatrix4(inv); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
    const vw = (maxX - minX) * 1.08, vh = (maxY - minY) * 1.16, aspect = W / H;
    let hw, hh; if (vw / vh > aspect) { hw = vw / 2; hh = hw / aspect; } else { hh = vh / 2; hw = hh * aspect; }
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh }); this.camera.updateProjectionMatrix();
    this.pxPerUnit = W / (2 * hw);
  }
  resize(W, H, dpr) {
    this.W = W; this.H = H; this.renderer.setPixelRatio(dpr); this.renderer.setSize(W, H, false); this.labels.setSize(W, H); this.fit();
  }
  screenOf(id) {
    const rec = this.blocks.get(id); if (!rec) return null;
    const v = new THREE.Vector3(rec.x, PLATE_H + rec.h + rec.lift, rec.z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H, r: FOOT * 0.5 * this.pxPerUnit * this.camera.zoom };
  }
  screenOfDomain(id) {
    const dm = this.domains.get(id); if (!dm) return null;
    const v = new THREE.Vector3(dm.s.x, PLATE_H + 1.2, dm.s.z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H, r: Math.max(dm.s.w, dm.s.d) * 0.5 * this.pxPerUnit * this.camera.zoom };
  }
  pick(px, py) {
    const ndc = new THREE.Vector2((px / this.W) * 2 - 1, -(py / this.H) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    return hits.length ? hits[0].object.userData : null;
  }
  startIntro() { if (this.reduced) return; this.intro = 0; for (const dm of this.domains.values()) dm.rev = 0; for (const b of this.blocks.values()) b.scaleY = 0; }
  resetView() { this.pinned = null; this.focusDomain = null; this.zoomT = 1; this.target.set(0, 0.3, 0); this.returnAz = true; }

  // ---------- 每帧 ----------
  update(dt) {
    this.time += dt; this.idle += dt;
    const c = this.controls;
    // 镜头目标 / 缩放平滑；空闲时轻微摇摆，保持立体感
    const k = 1 - Math.exp(-dt * 4);
    const delta = new THREE.Vector3().subVectors(this.target, c.target).multiplyScalar(k);
    c.target.add(delta); this.camera.position.add(delta);
    this.camera.zoom = lerp(this.camera.zoom, this.zoomT, k); this.camera.updateProjectionMatrix();
    if (!this.userMoved && this.idle > 3 && !this.reduced && (this.sway || this.returnAz)) {
      const off = new THREE.Vector3().subVectors(this.camera.position, c.target); const sp = new THREE.Spherical().setFromVector3(off);
      const wantTheta = this.baseAz + (this.sway ? Math.sin(this.time * 0.22) * 0.06 : 0), wantPhi = Math.PI / 2 - this.baseEl + (this.sway ? Math.cos(this.time * 0.17) * 0.025 : 0);
      sp.theta = lerp(sp.theta, wantTheta, 1 - Math.exp(-dt * (this.returnAz ? 2.5 : 0.6))); sp.phi = lerp(sp.phi, wantPhi, 1 - Math.exp(-dt * (this.returnAz ? 2.5 : 0.6)));
      if (Math.abs(sp.theta - wantTheta) < 0.002 && Math.abs(sp.phi - wantPhi) < 0.002) this.returnAz = false;
      this.camera.position.copy(c.target).add(off.setFromSpherical(sp));
    }
    c.update();
    // 开场
    if (this.intro >= 0) {
      this.intro += dt;
      const order = ['core', 'security', 'service', 'mgmt', 'data', 'collab'];
      order.forEach((id, i) => { const dm = this.domains.get(id); if (!dm) return; dm.rev = easeOutCubic(clamp((this.intro - i * 0.1) / 0.7, 0, 1)); dm.blocks.forEach((b, j) => { b.scaleY = easeOutBack(clamp((this.intro - i * 0.1 - 0.35 - j * 0.045) / 0.55, 0, 1)); }); });
      if (this.intro > 2.4) { this.intro = -1; for (const dm of this.domains.values()) dm.rev = 1; for (const b of this.blocks.values()) b.scaleY = 1; }
    }
    // 域：出现、聚焦压暗
    for (const dm of this.domains.values()) {
      const dimT = this.focusDomain && this.focusDomain !== dm.d.id ? 1 : 0; dm.dimK = lerp(dm.dimK, dimT, k);
      dm.plate.position.y = lerp(-1.4, PLATE_H / 2, dm.rev); dm.mat.opacity = dm.rev; dm.edge.material.opacity = 0.55 * dm.rev * (1 - dm.dimK * 0.6); dm.edge.position.y = dm.plate.position.y - PLATE_H / 2 + 0.03;
      dm.label.position.y = dm.plate.position.y + PLATE_H / 2 + 0.006; dm.label.material.opacity = dm.rev * (1 - dm.dimK * 0.5);
      dm.mat.color.copy(dm.tint).lerp(new THREE.Color('#eef1f7'), dm.dimK * 0.7);
      dm.plate.visible = dm.rev > 0.01;
    }
    const spot = this.spot;
    for (const rec of this.blocks.values()) {
      const dm = rec.dm;
      const hv = this.hover === rec.b.id || this.pinned === rec.b.id; rec.liftT = hv ? 0.18 : 0;
      rec.lift = lerp(rec.lift, rec.liftT, 1 - Math.exp(-dt * 9));
      const sy = Math.max(0.001, rec.scaleY);
      rec.mesh.scale.set(1, sy, 1); rec.mesh.position.y = dm.plate.position.y + PLATE_H / 2 + rec.h * sy / 2 + rec.lift; rec.mesh.visible = rec.scaleY > 0.01;
      let dimT = dm.dimK; if (spot && !spot.nodes.has(rec.b.id)) dimT = Math.max(dimT, 0.75);
      rec.dimK = lerp(rec.dimK, dimT, k);
      rec.mat.color.copy(rec.colT).lerp(new THREE.Color('#dfe5f0'), rec.dimK * 0.8);
      rec.mat.color.lerp(new THREE.Color('#ffffff'), Math.pow(rec.dimK, 0.5) * 0.0); // 占位：保持接口一致
      const glow = rec.b.status !== 'normal' ? 0.18 + 0.14 * Math.sin(this.time * 2.2 + rec.phase) : hv ? 0.14 : 0;
      rec.mat.emissive.copy(rec.mat.color).multiplyScalar(glow);
      // 名称：悬停 / 锁定 / 异常 / 全局开关 / 放大到一定程度时显示
      const inFocus = !this.focusDomain || rec.dm.d.id === this.focusDomain;
      const showName = (hv || rec.b.status !== 'normal' || (spot && spot.nodes.has(rec.b.id)) || ((this.showNames || this.camera.zoom > 1.45) && inFocus)) && rec.scaleY > 0.9;
      rec.nameEl.classList.toggle('on', showName); rec.nameEl.classList.toggle('dim', rec.dimK > 0.5); rec.badgeEl.classList.toggle('dim', rec.dimK > 0.5);
      for (const t of rec.terms) { t.ang += t.spd * dt; t.life = Math.min(1, t.life + dt); }
      if (rec.b.status !== 'normal' && !this.reduced && rec.scaleY > 0.9) { rec.nextRipple -= dt; if (rec.nextRipple <= 0) { this.spawnRipple(rec); rec.nextRipple = rec.b.status === 'critical' ? 2.2 : 3.2; } }
    }
    // 终端微粒
    let n = 0; const P = this.termPos;
    for (const rec of this.blocks.values()) {
      if (rec.scaleY < 0.9) continue;
      const a = 1 - rec.dimK * 0.85; if (a < 0.2) continue;
      const y = rec.dm.plate.position.y + PLATE_H / 2 + 0.03;
      for (const t of rec.terms) { if (n >= 1200) break; P[n * 3] = rec.x + Math.cos(t.ang) * t.rad; P[n * 3 + 1] = y + 0.02 * Math.sin(this.time * 2 + t.ang * 3); P[n * 3 + 2] = rec.z + Math.sin(t.ang) * t.rad; n++; }
    }
    this.termGeo.setDrawRange(0, n); this.termGeo.attributes.position.needsUpdate = true;
    // 涟漪
    for (const r of this.ripples) { const p = (this.time - r.born) / 1.8; if (p >= 1) { this.scene.remove(r.mesh); r.dead = true; continue; } const s = 1 + easeOutCubic(p) * 2.6; r.mesh.scale.set(s, s, 1); r.mesh.material.opacity = Math.pow(1 - p, 1.5) * 0.55; }
    this.ripples = this.ripples.filter((r) => !r.dead);
    // 连接：只有流转中的才显现；悬停 / 锁定时相关连接以灰色显现
    for (const l of this.links.values()) {
      const rel = spot && spot.links.has(l.id);
      const dimBySpot = spot && !rel;
      const st = l.l.status;
      let target = l.active ? 0.55 : rel ? 0.4 : st !== 'normal' ? 0.6 : 0;
      if (dimBySpot) target *= 0.2;
      if (this.focusDomain && l.a.dm.d.id !== this.focusDomain && l.b.dm.d.id !== this.focusDomain) target *= 0.15;
      if (l.transient) { const age = this.time - l.born, left = l.dieAt - this.time; target *= clamp(age / 0.6, 0, 1) * clamp(left / 0.8, 0, 1); if (left <= 0) l.dead = true; }
      if (this.intro >= 0) target *= clamp((this.intro - 1.3) / 0.6, 0, 1);
      l.opacity = lerp(l.opacity, target, 1 - Math.exp(-dt * 5));
      l.activeK = lerp(l.activeK, l.active ? 1 : 0, 1 - Math.exp(-dt * 4));
      const col = st === 'critical' ? new THREE.Color(STATUS_COLOR.critical) : st === 'warning' ? new THREE.Color(STATUS_COLOR.warning) : new THREE.Color('#9aa9c6').lerp(new THREE.Color(ACCENT), l.activeK);
      l.mat.color.copy(col); l.mat.opacity = l.opacity * (st === 'critical' ? 0.7 + 0.3 * Math.sin(this.time * 2.4) : 1);
      l.tube.visible = l.opacity > 0.02;
      for (let i = l.pulses.length - 1; i >= 0; i--) { const p = l.pulses[i]; p.t += p.dir * p.spd * dt; if (p.t > 1.02 || p.t < -0.02) l.pulses.splice(i, 1); }
      // 流光：头部 + 4 段尾迹
      const need = l.pulses.length * 5;
      while (l.sprites.length < need) { const s = new THREE.Sprite(l.spriteMat); s.renderOrder = 5; this.scene.add(s); l.sprites.push(s); }
      let si = 0;
      for (const p of l.pulses) for (let j = 0; j < 5; j++) {
        const s = l.sprites[si++]; const t = clamp(p.t - p.dir * j * 0.028, 0, 1);
        l.curve.getPointAt(t, s.position); const f = 1 - j / 5;
        s.scale.setScalar((j === 0 ? 0.26 : 0.2 * f) * (1 / this.camera.zoom) ** 0.35); s.visible = l.opacity > 0.05; s.material.opacity = 0.95 * f;
      }
      for (; si < l.sprites.length; si++) l.sprites[si].visible = false;
    }
    for (const l of [...this.links.values()].filter((x) => x.dead)) this.removeLink(l.id);
  }
  spawnRipple(rec) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), new THREE.MeshBasicMaterial({ color: STATUS_COLOR[rec.b.status] || ACCENT, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(rec.x, rec.dm.plate.position.y + PLATE_H / 2 + 0.012, rec.z); mesh.renderOrder = 2;
    this.scene.add(mesh); this.ripples.push({ mesh, born: this.time });
  }
  render() { this.renderer.render(this.scene, this.camera); this.labels.render(this.scene, this.camera); }
  dispose() { this.controls.dispose(); this.renderer.dispose(); }
}
