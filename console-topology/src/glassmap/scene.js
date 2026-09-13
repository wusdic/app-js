// WebGL 场景：磨砂玻璃底座与业务体、正向视角的动态区域网格、路线与数据包、镜头与聚光
//   技术选型：three.js（GPU 渲染），玻璃为物理材质 transmission + roughness（真实折射模糊），
//   数据包用 InstancedMesh（一次绘制），所有状态变化都在同一 rAF 循环里按帧插值，DOM 只承担标签与卡片。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { layoutZones, TITLE } from './layout.js';
import { iconTexture } from './icons.js';
import { tween, updateTweens, Ease, approach } from './tween.js';

export const COLORS = {
  level: { core: 0x1f5cff, important: 0x3d8bff, general: 0x7ea3d8 },
  status: { warning: 0xff9f1a, critical: 0xf0435a },
  route: 0x8fb0ff, routeOn: 0x2b64ff, packet: 0x2457f5,
};
const SLAB_H = 0.26, SLAB_Y = 0.16, SLAB_TOP = SLAB_Y + SLAB_H;
const BLK = 0.62, BLK_H = { core: 0.54, important: 0.44, general: 0.36 };
const MAX_PACKETS = 256;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0), _s = new THREE.Vector3(1, 1, 1);

// 柔和接触阴影贴图（径向渐变）
let _shadowTex;
function shadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64); g.addColorStop(0, 'rgba(30,60,140,0.55)'); g.addColorStop(0.55, 'rgba(30,60,140,0.18)'); g.addColorStop(1, 'rgba(30,60,140,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c); _shadowTex.colorSpace = THREE.SRGBColorSpace; return _shadowTex;
}

// 地面：淡蓝渐变 + 随距离淡出的细网格
const groundShader = {
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `varying vec3 vW;
    void main(){
      float d = length(vW.xz);
      vec3 base = mix(vec3(0.965, 0.978, 1.0), vec3(0.885, 0.925, 0.99), smoothstep(0.0, 26.0, d));
      vec2 g = abs(fract(vW.xz - 0.5) - 0.5) / fwidth(vW.xz);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float a = line * 0.22 * (1.0 - smoothstep(5.0, 18.0, d));
      gl_FragColor = vec4(mix(base, vec3(0.5, 0.64, 1.0), a), 1.0);
    }`,
};

export class GlassScene {
  constructor(canvas, labelLayer, { reduced = false } = {}) {
    this.reduced = reduced;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.transmissionResolutionScale = 0.6;
    this.labels = new CSS2DRenderer({ element: labelLayer });
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xeef3fc, 16, 42);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
    this.camera.position.set(0, 9, 12);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, minPolarAngle: 0.62, maxPolarAngle: 1.18, minAzimuthAngle: -0.42, maxAzimuthAngle: 0.42, minDistance: 3, maxDistance: 40, rotateSpeed: 0.55, zoomSpeed: 0.7 });
    this.controls.target.set(0, 0.4, 0);
    // 环境光照：柔和天光 + 主光（玻璃高光）+ 室内环境贴图（玻璃反射）
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd6e3ff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(6, 12, 8); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.6); fill.position.set(-8, 6, -4); this.scene.add(fill);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.75; pmrem.dispose();
    // 地面
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShaderMaterial({ ...groundShader, fog: false }));
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground);
    // 材质：底座与业务体都是同一种玻璃（无色、带极淡蓝的厚度衰减）
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f8ff, transmission: 1, roughness: 0.36, thickness: 1.2, ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.1, attenuationColor: new THREE.Color(0xcddfff), attenuationDistance: 1.4, envMapIntensity: 1.5, specularIntensity: 1 });
    this.blockGlassMat = this.glassMat.clone(); this.blockGlassMat.roughness = 0.3; this.blockGlassMat.thickness = 0.55; this.blockGlassMat.attenuationDistance = 1.0;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
    this.geo = { slabShadow: new THREE.PlaneGeometry(1, 1), core: new THREE.SphereGeometry(0.17, 18, 14), icon: new THREE.PlaneGeometry(0.4, 0.4), ring: new THREE.RingGeometry(0.44, 0.49, 48), hit: {}, block: {} };
    for (const lv of Object.keys(BLK_H)) { const g = new RoundedBoxGeometry(BLK, BLK_H[lv], BLK, 3, 0.075); g.translate(0, BLK_H[lv] / 2, 0); this.geo.block[lv] = g; const h = new THREE.BoxGeometry(BLK * 1.25, BLK_H[lv] + 0.25, BLK * 1.25); h.translate(0, BLK_H[lv] / 2 + 0.05, 0); this.geo.hit[lv] = h; }
    // 数据包：一次实例化绘制（本体 + 光晕）
    const capsule = new THREE.CapsuleGeometry(0.032, 0.1, 3, 8); capsule.rotateZ(Math.PI / 2);
    this.packetMesh = new THREE.InstancedMesh(capsule, new THREE.MeshBasicMaterial({ color: COLORS.packet }), MAX_PACKETS);
    this.packetGlow = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.065, 0.12, 3, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.packet, transparent: true, opacity: 0.22, depthWrite: false }), MAX_PACKETS);
    this.packetMesh.count = 0; this.packetGlow.count = 0; this.packetMesh.frustumCulled = this.packetGlow.frustumCulled = false;
    this.scene.add(this.packetMesh, this.packetGlow);
    this.raycaster = new THREE.Raycaster(); this.raycaster.far = 80;
    this.zones = new Map(); this.blocks = new Map(); this.routes = new Map(); this.hits = [];
    this.time = 0; this.hover = null; this.pinned = null; this.spot = null; this.alertsOnly = false; this.flying = false; this.flowsOn = true;
    this.overview = { target: new THREE.Vector3(0, 0.4, 0), dist: 12 };
    this.onChange = null;
  }

  // ---------- 构建 ----------
  setData(data) {
    this.clear(); this.data = data;
    const byId = new Map(data.businesses.map((b) => [b.id, b]));
    const L = layoutZones(data.zones);
    L.tiles.forEach((t, zi) => {
      const g = new THREE.Group(); g.position.set(t.x, 0, t.z);
      const slab = new THREE.Mesh(new RoundedBoxGeometry(t.w, SLAB_H, t.d, 4, 0.1), this.glassMat); slab.position.y = SLAB_Y + SLAB_H / 2; slab.userData = { zone: t.zone.id }; g.add(slab);
      const sh = new THREE.Mesh(this.geo.slabShadow, this.shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.004; sh.scale.set(t.w + 1.4, t.d + 1.4, 1); g.add(sh);
      const el = document.createElement('div'); el.className = 'gm-zone-label'; el.innerHTML = '<span class="in"><b></b><small></small><span class="cnt"></span><span class="bad"></span></span>';
      el.querySelector('b').textContent = t.zone.name; el.querySelector('small').textContent = t.zone.en || ''; el.querySelector('.cnt').textContent = `${t.zone.businesses.length} 个业务`;
      const label = new CSS2DObject(el); label.position.set(0, SLAB_TOP + 0.02, -t.d / 2 + TITLE * 0.55); g.add(label);
      this.scene.add(g); this.hits.push(slab);
      const zone = { id: t.zone.id, z: t.zone, tile: t, group: g, slab, label, el, order: zi, hoverK: 0 };
      this.zones.set(t.zone.id, zone);
      let bi = 0;
      for (const [bid, p] of t.blocks) { const b = byId.get(bid); if (b) this.addBlock(b, p.x, p.z, zone, zi * 10 + bi++, p.col); }
    });
    for (const l of data.links) this.addRoute(l);
    this.frameOverview(L);
  }
  addBlock(b, x, z, zone, order, col = 0) {
    const h = BLK_H[b.level] || BLK_H.general, lv = BLK_H[b.level] ? b.level : 'general';
    const g = new THREE.Group(); g.position.set(x, SLAB_TOP, z);
    const glass = new THREE.Mesh(this.geo.block[lv], this.blockGlassMat); g.add(glass);
    const coreMat = new THREE.MeshBasicMaterial({ color: COLORS.level[lv], transparent: true, opacity: 1 });
    const core = new THREE.Mesh(this.geo.core, coreMat); core.position.y = h * 0.5; g.add(core);
    const iconMat = new THREE.MeshBasicMaterial({ map: iconTexture(b.kind), color: COLORS.level[lv], transparent: true, depthWrite: false });
    const icon = new THREE.Mesh(this.geo.icon, iconMat); icon.rotation.x = -Math.PI / 2; icon.position.y = h + 0.012; g.add(icon);
    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.status.warning, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.geo.ring, ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.006; g.add(ring);
    const sh = new THREE.Mesh(this.geo.slabShadow, this.shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.003; sh.scale.set(BLK * 1.7, BLK * 1.7, 1); g.add(sh);
    const hit = new THREE.Mesh(this.geo.hit[lv], new THREE.MeshBasicMaterial({ visible: false })); hit.userData = { block: b.id }; g.add(hit); this.hits.push(hit);
    const el = document.createElement('div'); el.className = `gm-blk-label ${b.level}`; el.innerHTML = '<span class="in"><i></i><span class="t"></span></span>';
    el.querySelector('.t').textContent = b.name;
    const label = new CSS2DObject(el); label.position.set(0, 0.02, BLK * 0.66 + (col % 2 ? 0.34 : 0)); g.add(label); // 相邻列铭牌前后错开，避免重叠
    this.scene.add(g);
    const rec = { id: b.id, b, zone, group: g, glass, core, coreMat, icon, iconMat, ring, ringMat, label, el, h, order, hoverK: 0, vis: 1, visT: 1, color: new THREE.Color(COLORS.level[lv]), colorT: new THREE.Color(COLORS.level[lv]), reveal: 1 };
    this.blocks.set(b.id, rec); this.applyStatus(rec);
    return rec;
  }
  // 正交路线：沿较长轴出发，圆角转向，端点缩进到方块外
  routeCurve(a, b) {
    const y = SLAB_TOP + 0.035, r = 0.28, inset = BLK * 0.62;
    const A = new THREE.Vector3(a.group.position.x, y, a.group.position.z), B = new THREE.Vector3(b.group.position.x, y, b.group.position.z);
    const dx = B.x - A.x, dz = B.z - A.z, path = new THREE.CurvePath();
    const seg = (p, q) => path.add(new THREE.LineCurve3(p, q));
    if (Math.abs(dx) < 1e-3 || Math.abs(dz) < 1e-3) { const dir = B.clone().sub(A).normalize(); seg(A.clone().addScaledVector(dir, inset), B.clone().addScaledVector(dir, -inset)); return path; }
    const sx = Math.sign(dx), sz = Math.sign(dz);
    if (Math.abs(dx) >= Math.abs(dz)) {
      const c = new THREE.Vector3(B.x, y, A.z), rr = Math.min(r, Math.abs(dx) / 2 - inset, Math.abs(dz) / 2 - inset * 0.5);
      const p1 = new THREE.Vector3(A.x + sx * inset, y, A.z), p2 = new THREE.Vector3(c.x - sx * rr, y, A.z), p3 = new THREE.Vector3(c.x, y, c.z + sz * rr), p4 = new THREE.Vector3(B.x, y, B.z - sz * inset);
      seg(p1, p2); path.add(new THREE.QuadraticBezierCurve3(p2, c, p3)); seg(p3, p4);
    } else {
      const c = new THREE.Vector3(A.x, y, B.z), rr = Math.min(r, Math.abs(dz) / 2 - inset, Math.abs(dx) / 2 - inset * 0.5);
      const p1 = new THREE.Vector3(A.x, y, A.z + sz * inset), p2 = new THREE.Vector3(A.x, y, c.z - sz * rr), p3 = new THREE.Vector3(c.x + sx * rr, y, c.z), p4 = new THREE.Vector3(B.x - sx * inset, y, B.z);
      seg(p1, p2); path.add(new THREE.QuadraticBezierCurve3(p2, c, p3)); seg(p3, p4);
    }
    return path;
  }
  addRoute(l) {
    const a = this.blocks.get(l.from), b = this.blocks.get(l.to); if (!a || !b) return null;
    const curve = this.routeCurve(a, b), len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.max(12, Math.round(len * 10)), 0.024, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.route, transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 1; this.scene.add(mesh);
    const rec = { id: l.id, l, a, b, curve, len, mesh, mat, packets: [], active: false, activeK: 0, op: 0.55, opT: 0.55, color: new THREE.Color(COLORS.route), colorT: new THREE.Color(COLORS.route), transient: !!l.transient, bornAt: this.time, dieAt: l.transient ? this.time + (l.ttl || 9) : Infinity, drawK: 1 };
    if (l.transient) { rec.drawK = 0; geo.setDrawRange(0, 0); }
    this.routes.set(l.id, rec); return rec;
  }
  removeRoute(id) { const r = this.routes.get(id); if (!r) return; this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose(); this.routes.delete(id); }
  routesOf(id) { const out = []; for (const r of this.routes.values()) if (r.a.id === id || r.b.id === id) out.push(r); return out; }
  clear() {
    for (const r of [...this.routes.keys()]) this.removeRoute(r);
    for (const b of this.blocks.values()) { this.scene.remove(b.group); b.coreMat.dispose(); b.iconMat.dispose(); b.ringMat.dispose(); b.el.remove(); }
    for (const z of this.zones.values()) { this.scene.remove(z.group); z.slab.geometry.dispose(); z.el.remove(); }
    this.blocks.clear(); this.zones.clear(); this.hits = []; this.hover = null; this.pinned = null; this.spot = null;
  }

  // ---------- 镜头 ----------
  frameOverview(L) {
    const W = L.width + 1.2, D = L.depth + 1.2;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const elev = 0.66; // 约 38°
    const dW = (W / 2) / Math.tan(hfov / 2) + D * 0.35, dD = (D * Math.sin(elev) + 1.6) / (2 * Math.tan(vfov / 2)) + D * 0.5;
    this.overview.dist = Math.max(dW, dD) * 1.04; this.overview.target.set(0, 0.35, 0.15); this.overview.elev = elev;
    this.layout = L;
  }
  camPose(target, dist, azimuth = 0, elev = this.overview.elev) {
    return { tx: target.x, ty: target.y, tz: target.z, px: target.x + Math.sin(azimuth) * Math.cos(elev) * dist, py: target.y + Math.sin(elev) * dist, pz: target.z + Math.cos(azimuth) * Math.cos(elev) * dist };
  }
  currentAngles() { const o = this.camera.position.clone().sub(this.controls.target); return { azimuth: Math.atan2(o.x, o.z), elev: Math.atan2(o.y, Math.hypot(o.x, o.z)) }; }
  flyTo(pose, duration = 0.8) {
    this._fly?.cancel(); this.flying = true; this.controls.enabled = false;
    const cur = { px: this.camera.position.x, py: this.camera.position.y, pz: this.camera.position.z, tx: this.controls.target.x, ty: this.controls.target.y, tz: this.controls.target.z };
    this._fly = tween(cur, pose, { duration, ease: Ease.inOutCubic, onUpdate: () => { this.camera.position.set(cur.px, cur.py, cur.pz); this.controls.target.set(cur.tx, cur.ty, cur.tz); }, onComplete: () => { this.flying = false; this.controls.enabled = true; } });
  }
  goOverview(duration = 0.9) { const { azimuth } = this.currentAngles(); this.flyTo(this.camPose(this.overview.target, this.overview.dist, THREE.MathUtils.clamp(azimuth, -0.3, 0.3)), duration); }
  goBlock(id, duration = 0.75) {
    const b = this.blocks.get(id); if (!b) return;
    const { azimuth, elev } = this.currentAngles();
    const t = b.group.position.clone(); t.y += b.h * 0.5; t.x += 0.9; // 业务略偏左，给右侧详情卡留位
    this.flyTo(this.camPose(t, Math.max(3.6, this.overview.dist * 0.36), azimuth * 0.5, THREE.MathUtils.clamp(elev, 0.5, 0.8)), duration);
  }
  jumpOverview() { const p = this.camPose(this.overview.target, this.overview.dist); this.camera.position.set(p.px, p.py, p.pz); this.controls.target.set(p.tx, p.ty, p.tz); this.controls.update(); }
  resize(w, h, dpr) { this.renderer.setPixelRatio(Math.min(dpr, 2)); this.renderer.setSize(w, h, false); this.labels.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); if (this.layout) this.frameOverview(this.layout); }

  // ---------- 拾取与聚光 ----------
  pick(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hit = this.raycaster.intersectObjects(this.hits, false)[0];
    if (!hit) return null;
    return hit.object.userData.block ? { type: 'block', id: hit.object.userData.block } : { type: 'zone', id: hit.object.userData.zone };
  }
  spotlightFor(id) { const rs = this.routesOf(id); const ns = new Set([id]); for (const r of rs) { ns.add(r.a.id); ns.add(r.b.id); } return { anchor: id, nodes: ns, routes: new Set(rs.map((r) => r.id)) }; }
  refreshSpot() {
    const id = this.pinned || this.hover; this.spot = id ? this.spotlightFor(id) : null;
    for (const b of this.blocks.values()) {
      const abnormal = b.b.status !== 'normal';
      let v = 1; if (this.spot && !this.spot.nodes.has(b.id)) v = 0.22; if (this.alertsOnly && !abnormal && !(this.spot && this.spot.nodes.has(b.id))) v = Math.min(v, 0.2);
      b.visT = v; b.el.classList.toggle('dim', v < 0.5); b.el.classList.toggle('rel', !!this.spot && this.spot.nodes.has(b.id) && b.id !== id); b.el.classList.toggle('on', b.id === id);
    }
    for (const r of this.routes.values()) {
      const on = this.spot && this.spot.routes.has(r.id);
      const st = r.l.status;
      if (on) { r.opT = 1; r.colorT.set(st === 'critical' ? COLORS.status.critical : st === 'warning' ? COLORS.status.warning : COLORS.routeOn); }
      else if (this.spot || (this.alertsOnly && st === 'normal')) { r.opT = 0.12; r.colorT.set(COLORS.route); }
      else { r.opT = st !== 'normal' ? 0.95 : 0.42 + 0.5 * (r.active ? 1 : 0); r.colorT.set(st === 'critical' ? COLORS.status.critical : st === 'warning' ? COLORS.status.warning : r.active ? COLORS.routeOn : COLORS.route); }
    }
    for (const z of this.zones.values()) z.el.classList.toggle('dim', !!this.spot && ![...this.spot.nodes].some((n) => this.blocks.get(n)?.zone === z));
  }
  setHover(id) { if (id === this.hover) return; this.hover = id; this.refreshSpot(); }
  setPinned(id) { this.pinned = id; this.refreshSpot(); if (id) this.goBlock(id); else this.goOverview(); }

  // ---------- 状态 ----------
  applyStatus(b) {
    const st = b.b.status; b.colorT.set(st === 'critical' ? COLORS.status.critical : st === 'warning' ? COLORS.status.warning : COLORS.level[BLK_H[b.b.level] ? b.b.level : 'general']);
    b.ringMat.color.set(st === 'critical' ? COLORS.status.critical : COLORS.status.warning);
    b.el.classList.toggle('warning', st === 'warning'); b.el.classList.toggle('critical', st === 'critical');
    b.el.querySelector('.t').textContent = st === 'critical' ? `故障 · ${b.b.name}` : st === 'warning' ? `告警 · ${b.b.name}` : b.b.name;
    const bad = b.zone.z.businesses.filter((id) => this.blocks.get(id)?.b.status !== 'normal').length;
    b.zone.el.querySelector('.bad').textContent = bad ? `${bad} 个异常` : ''; b.zone.el.classList.toggle('has-bad', bad > 0);
    b.zone.el.classList.toggle('has-crit', b.zone.z.businesses.some((id) => this.blocks.get(id)?.b.status === 'critical'));
  }
  setBusinessStatus(id, status) { const b = this.blocks.get(id); if (!b) return; b.b.status = status; this.applyStatus(b); this.refreshSpot(); }
  setLinkStatus(id, status) { const r = this.routes.get(id); if (!r) return; r.l.status = status; this.refreshSpot(); }
  setLinkActive(id, on) { const r = this.routes.get(id); if (!r) return; r.active = on; this.refreshSpot(); }
  pulse(id, dir = 1) { const r = this.routes.get(id); if (!r || !this.flowsOn || r.packets.length >= 3) return; r.packets.push({ t: dir > 0 ? 0 : 1, dir, spd: 2.4 / r.len }); }
  addTransient(l) { const r = this.addRoute(l); if (r) { r.active = true; tween(r, { drawK: 1 }, { duration: 0.6 }); this.refreshSpot(); } return r; }
  setLabels(on) { for (const b of this.blocks.values()) b.el.classList.toggle('hide', !on); }
  setAlertsOnly(on) { this.alertsOnly = on; this.refreshSpot(); }

  // ---------- 开场 ----------
  startIntro() {
    if (this.reduced) return;
    this.flowsOn = false;
    let zi = 0;
    for (const z of this.zones.values()) {
      z.group.position.y = -1.6; z.group.scale.setScalar(0.92); z.el.classList.add('pre');
      tween(z.group.position, { y: 0 }, { duration: 0.9, delay: 0.1 + zi * 0.09, ease: Ease.outQuint });
      tween(z.group.scale, { x: 1, y: 1, z: 1 }, { duration: 0.9, delay: 0.1 + zi * 0.09, ease: Ease.outQuint, onComplete: () => z.el.classList.remove('pre') });
      zi++;
    }
    for (const b of this.blocks.values()) { b.reveal = 0; b.group.scale.setScalar(0.001); b.el.classList.add('pre'); tween(b, { reveal: 1 }, { duration: 0.55, delay: 0.55 + b.order * 0.012, ease: Ease.outBack, onUpdate: () => b.group.scale.setScalar(Math.max(0.001, b.reveal)), onComplete: () => b.el.classList.remove('pre') }); }
    for (const r of this.routes.values()) { r.drawK = 0; r.mesh.geometry.setDrawRange(0, 0); tween(r, { drawK: 1 }, { duration: 0.9, delay: 1.15 + Math.random() * 0.3, ease: Ease.inOutCubic }); }
    const p = this.camPose(this.overview.target, this.overview.dist * 1.35, 0, this.overview.elev + 0.12);
    this.camera.position.set(p.px, p.py, p.pz); this.controls.target.copy(this.overview.target); this.controls.update();
    this.goOverview(1.9);
    setTimeout(() => { this.flowsOn = true; }, 1900);
  }

  // ---------- 每帧 ----------
  update(dt) {
    this.time += dt; updateTweens(dt);
    if (this.controls.enabled) this.controls.update();
    const t = this.time;
    for (const b of this.blocks.values()) {
      const hv = (this.hover === b.id || this.pinned === b.id) ? 1 : 0;
      b.hoverK = approach(b.hoverK, hv, 10, dt);
      b.vis = approach(b.vis, b.visT, 8, dt);
      b.color.lerp(b.colorT, 1 - Math.exp(-dt * 6));
      const st = b.b.status, abnormal = st !== 'normal';
      const breathe = abnormal ? 0.75 + 0.25 * Math.sin(t * (st === 'critical' ? 2.6 : 1.8)) : 1;
      b.coreMat.color.copy(b.color).multiplyScalar((1.15 + 0.5 * b.hoverK) * breathe);
      b.iconMat.color.copy(b.color); b.coreMat.opacity = b.iconMat.opacity = b.vis;
      const s = (1 + 0.06 * b.hoverK) * Math.max(0.001, b.reveal);
      b.group.scale.setScalar(s); b.group.position.y = SLAB_TOP + 0.05 * b.hoverK;
      b.ringMat.opacity = abnormal ? (0.22 + 0.2 * Math.sin(t * 2.2)) * b.vis : 0;
      b.ring.scale.setScalar(abnormal ? 1.12 + 0.08 * Math.sin(t * 2.2) : 1);
    }
    let n = 0;
    for (const r of [...this.routes.values()]) {
      if (t > r.dieAt) { r.opT = 0; if (t > r.dieAt + 0.8) { this.removeRoute(r.id); continue; } }
      r.op = approach(r.op, r.opT, 8, dt); r.color.lerp(r.colorT, 1 - Math.exp(-dt * 7));
      r.mat.opacity = r.op * Math.min(1, r.drawK * 1.5); r.mat.color.copy(r.color);
      if (r.drawK < 1) { const idx = r.mesh.geometry.index.count; r.mesh.geometry.setDrawRange(0, Math.floor(idx * r.drawK / 6) * 6); } else if (r.mesh.geometry.drawRange.count !== Infinity) r.mesh.geometry.setDrawRange(0, Infinity);
      for (let i = r.packets.length - 1; i >= 0; i--) {
        const p = r.packets[i]; p.t += p.dir * p.spd * dt;
        if (p.t > 1 || p.t < 0) { r.packets.splice(i, 1); continue; }
        if (n >= MAX_PACKETS) continue;
        r.curve.getPointAt(p.t, _v); const tan = r.curve.getTangentAt(p.t).multiplyScalar(p.dir).normalize();
        _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan); _m.compose(_v, _q, _s);
        this.packetMesh.setMatrixAt(n, _m); this.packetGlow.setMatrixAt(n, _m); n++;
      }
    }
    const far = this.camera.position.distanceTo(this.controls.target) > this.overview.dist * 0.72;
    if (far !== this._far) { this._far = far; for (const b of this.blocks.values()) b.el.classList.toggle('far', far); }
    this.packetMesh.count = n; this.packetGlow.count = n; this.packetMesh.instanceMatrix.needsUpdate = true; this.packetGlow.instanceMatrix.needsUpdate = true;
    this.packetMesh.material.color.set(COLORS.packet);
  }
  render() { this.renderer.render(this.scene, this.camera); this.labels.render(this.scene, this.camera); }
  dispose() { this.clear(); this.controls.dispose(); this.renderer.dispose(); }
}
