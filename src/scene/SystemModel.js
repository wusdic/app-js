import * as THREE from 'three';
import { haloTexture } from '../core/textures.js';
import { ALARM, heartbeat } from '../config.js';

// 业务系统的三维模型：六边形底座 + 悬浮旋转的线框多面体 + 贴地柔光
//   核心：二十面体 + 实心内核 + 两段旋转的轨道弧环；重要：十二面体；一般：八面体（形状即级别）
function hexShape(r) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}
function hexRingGeo(rOut, rIn) { const s = hexShape(rOut); s.holes.push(hexShape(rIn)); return new THREE.ShapeGeometry(s); }

const cache = {};
function geos(level) {
  if (cache[level]) return cache[level];
  const polyR = 0.42;
  const poly = level === 'general' ? new THREE.OctahedronGeometry(polyR, 0) : level === 'important' ? new THREE.DodecahedronGeometry(polyR, 0) : new THREE.IcosahedronGeometry(polyR, 0);
  cache[level] = {
    plate: new THREE.ShapeGeometry(hexShape(1)),
    ring: hexRingGeo(1, 0.88),
    hubRing: new THREE.RingGeometry(1.26, 1.31, 64),
    polyEdges: new THREE.EdgesGeometry(poly),
    core: new THREE.IcosahedronGeometry(level === 'general' ? 0.13 : 0.18, 1),
    arc: new THREE.RingGeometry(1.14, 1.2, 48, 1, 0, Math.PI * 0.6),
    glow: new THREE.PlaneGeometry(1, 1),
  };
  return cache[level];
}

export function createSystemModel(level, colorHex, r = 1, phase = 0) {
  const g = geos(level);
  const group = new THREE.Group();
  const color = new THREE.Color(colorHex);
  const mats = [];
  const mk = (opacity, extra = {}) => { const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, ...extra }); m.userData.base = opacity; mats.push(m); return m; };

  const glow = new THREE.Mesh(g.glow, mk(0.22, { map: haloTexture(), blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; glow.scale.setScalar(r * 2.6); glow.renderOrder = 1;
  const plate = new THREE.Mesh(g.plate, mk(0.14));
  plate.rotation.x = -Math.PI / 2; plate.position.y = 0.03; plate.scale.setScalar(r); plate.renderOrder = 2;
  const ring = new THREE.Mesh(g.ring, mk(0.8));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.scale.setScalar(r); ring.renderOrder = 3;

  const polyMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }); polyMat.userData.base = 0.85; mats.push(polyMat);
  const poly = new THREE.LineSegments(g.polyEdges, polyMat);
  poly.scale.setScalar(r); poly.position.y = r * 0.78; poly.renderOrder = 4;
  const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: true }); coreMat.userData.base = 1; mats.push(coreMat);
  const core = new THREE.Mesh(g.core, coreMat);
  core.scale.setScalar(r); core.position.y = r * 0.78; core.renderOrder = 5;

  group.add(glow, plate, ring, poly, core);
  let arcs = null;
  if (level === 'core') {
    arcs = new THREE.Group();
    const m = mk(0.7);
    for (let i = 0; i < 2; i++) { const a = new THREE.Mesh(g.arc, m); a.rotation.z = i * Math.PI; arcs.add(a); }
    arcs.rotation.x = -Math.PI / 2; arcs.position.y = 0.05; arcs.scale.setScalar(r); arcs.renderOrder = 3;
    group.add(arcs);
  }
  let hubRing = null;

  return {
    group, mats, plate, ring, poly, core, glow, arcs,
    setColor(hex, gain = 1) { color.set(hex).multiplyScalar(gain); for (const m of mats) m.color.copy(color); },
    // 关键依赖（枢纽）：底座外再加一圈细环
    setHub(on) {
      if (on && !hubRing) { hubRing = new THREE.Mesh(g.hubRing, mk(0.35)); hubRing.rotation.x = -Math.PI / 2; hubRing.position.y = 0.04; hubRing.scale.setScalar(r); hubRing.renderOrder = 3; group.add(hubRing); }
      if (hubRing) hubRing.visible = on;
    },
    // vis: 0~1 可见度（已做 gamma 映射）；status 用于心跳；hover 0~1 放大内核
    update(dt, t, vis = 1, status = 'normal', hover = 0) {
      poly.rotation.y += dt * 0.25; poly.rotation.x = Math.sin(t * 0.3 + phase) * 0.08;
      core.rotation.y -= dt * 0.35;
      const bob = Math.sin(t * 0.9 + phase) * 0.03 * r;
      poly.position.y = core.position.y = r * 0.78 + bob;
      const s = 1 + hover * 0.25;
      poly.scale.setScalar(r * s); core.scale.setScalar(r * s);
      if (arcs) arcs.rotation.z += dt * 0.25;
      const beat = status === 'critical' ? 0.6 + 0.4 * heartbeat(t, ALARM.critical) : status === 'warning' ? 0.75 + 0.25 * heartbeat(t, ALARM.warning) : 1;
      for (const m of mats) m.opacity = m.userData.base * vis * (m === ring.material || m === polyMat ? beat : 1) * (m === glow.material ? 1 + hover * 0.6 : 1);
    },
    dispose() { for (const m of mats) m.dispose(); },
  };
}
