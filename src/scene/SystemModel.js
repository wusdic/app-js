import * as THREE from 'three';
import { haloTexture, sparkTexture } from '../core/textures.js';
import { ALARM, heartbeat } from '../config.js';

// 业务系统的三维模型：与圆形平台同一套“圆”的语言
//   圆形底座（细环 + 浅底 + 旋转刻度弧）上悬浮一颗柔光能量球，球外套细线轨道环缓慢进动，环上一点光标巡行
//   核心：两道轨道环；重要：一道；一般：只有能量球（大小与环数即级别）
const orbShader = {
  vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){
      float nv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
      float rim = pow(1.0 - nv, 2.2);            // 边缘辉光
      float core = pow(nv, 2.2);                 // 正对相机的中心更实
      float band = 0.5 + 0.5 * sin(vP.y * 7.0 - uTime * 1.1);  // 球内缓慢流动的光带
      float a = (0.28 * core + 0.62 * rim + 0.14 * band * core) * uOpacity;
      vec3 c = mix(uColor, vec3(1.0), core * 0.35);
      gl_FragColor = vec4(c * a * 1.25, a);
    }`,
};
const cache = {};
function ringPoints(n = 96) { const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); } return pts; }
function geos() {
  if (cache.g) return cache.g;
  cache.g = {
    orb: new THREE.SphereGeometry(1, 40, 28),
    kernel: new THREE.SphereGeometry(1, 16, 12),
    baseFill: new THREE.CircleGeometry(1, 64),
    baseRing: new THREE.RingGeometry(0.96, 1.0, 96),
    hubRing: new THREE.RingGeometry(1.24, 1.28, 96),
    arc: new THREE.RingGeometry(1.08, 1.13, 48, 1, 0, Math.PI * 0.5),
    orbit: new THREE.BufferGeometry().setFromPoints(ringPoints()),
    glow: new THREE.PlaneGeometry(1, 1),
  };
  return cache.g;
}

export function createSystemModel(level, colorHex, r = 1, phase = 0) {
  const g = geos();
  const group = new THREE.Group();
  const color = new THREE.Color(colorHex);
  const mats = [];
  const mk = (opacity, extra = {}) => { const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, ...extra }); m.userData.base = opacity; mats.push(m); return m; };
  const orbR = r * (level === 'core' ? 0.56 : level === 'important' ? 0.5 : 0.44);
  const orbY = r * 0.85;

  // 底座：贴地柔光 + 浅底 + 细环 + 两段旋转刻度弧
  const glow = new THREE.Mesh(g.glow, mk(0.22, { map: haloTexture(), blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; glow.scale.setScalar(r * 3.0); glow.renderOrder = 1;
  const baseFill = new THREE.Mesh(g.baseFill, mk(0.08));
  baseFill.rotation.x = -Math.PI / 2; baseFill.position.y = 0.03; baseFill.scale.setScalar(r); baseFill.renderOrder = 2;
  const baseRing = new THREE.Mesh(g.baseRing, mk(0.6));
  baseRing.rotation.x = -Math.PI / 2; baseRing.position.y = 0.04; baseRing.scale.setScalar(r); baseRing.renderOrder = 3;
  const arcs = new THREE.Group();
  { const m = mk(level === 'general' ? 0.28 : 0.42); for (let i = 0; i < 2; i++) { const a = new THREE.Mesh(g.arc, m); a.rotation.z = i * Math.PI; arcs.add(a); } }
  arcs.rotation.x = -Math.PI / 2; arcs.position.y = 0.05; arcs.scale.setScalar(r); arcs.renderOrder = 3;

  // 能量球：柔光外壳 + 明亮内核 + 光晕
  const orbMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: color }, uOpacity: { value: 1 }, uTime: { value: 0 } }, ...orbShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  orbMat.userData.base = 1; mats.push(orbMat);
  const orb = new THREE.Mesh(g.orb, orbMat); orb.renderOrder = 5;
  const kernelColor = new THREE.Color();
  const kernelMat = new THREE.MeshBasicMaterial({ color: kernelColor, transparent: true, opacity: 0.95, depthWrite: true }); kernelMat.userData.base = 0.95; mats.push(kernelMat);
  const kernel = new THREE.Mesh(g.kernel, kernelMat); kernel.renderOrder = 4;
  const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }); haloMat.userData.base = 0.42; mats.push(haloMat);
  const halo = new THREE.Sprite(haloMat); halo.renderOrder = 4;
  const orbGroup = new THREE.Group(); orbGroup.add(halo, kernel, orb); orbGroup.position.y = orbY;

  // 轨道环：固定倾角，整体绕竖轴进动；环上一点光标巡行
  const orbits = [];
  const nOrbit = level === 'core' ? 2 : level === 'important' ? 1 : 0;
  const orbitMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }); orbitMat.userData.base = 0.6; mats.push(orbitMat);
  const sparkMat = new THREE.SpriteMaterial({ map: sparkTexture(), color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }); sparkMat.userData.base = 0.9; mats.push(sparkMat);
  for (let i = 0; i < nOrbit; i++) {
    const holder = new THREE.Group(); // 进动
    const tilt = new THREE.Group(); tilt.rotation.z = i === 0 ? 1.05 : -0.8; tilt.rotation.x = i === 0 ? 0 : 0.5;
    const R = orbR * (i === 0 ? 1.55 : 1.95);
    const line = new THREE.LineLoop(g.orbit, orbitMat); line.scale.setScalar(R); line.renderOrder = 6;
    const spark = new THREE.Sprite(sparkMat); spark.scale.setScalar(r * 0.2); spark.renderOrder = 7;
    tilt.add(line, spark); holder.add(tilt); holder.rotation.y = phase + i * 2.1;
    orbGroup.add(holder);
    orbits.push({ holder, spark, R, speed: (i === 0 ? 0.35 : -0.22), ang: phase * 3 + i * 1.7, angSpeed: i === 0 ? 1.1 : -0.8 });
  }

  group.add(glow, baseFill, baseRing, arcs, orbGroup);
  let hubRing = null;

  const setColorInternal = () => { for (const m of mats) if (m.color && m !== kernelMat) m.color.copy(color); kernelColor.copy(color).lerp(new THREE.Color(1, 1, 1), 0.4); kernelMat.color.copy(kernelColor); };
  setColorInternal();

  return {
    group, mats, orb, glow, arcs,
    setColor(hex, gain = 1) { color.set(hex).multiplyScalar(gain); setColorInternal(); },
    // 关键依赖（枢纽）：底座外再加一圈细环
    setHub(on) {
      if (on && !hubRing) { hubRing = new THREE.Mesh(g.hubRing, mk(0.3)); hubRing.rotation.x = -Math.PI / 2; hubRing.position.y = 0.04; hubRing.scale.setScalar(r); hubRing.renderOrder = 3; group.add(hubRing); }
      if (hubRing) hubRing.visible = on;
    },
    // vis: 0~1 可见度（已做 gamma 映射）；status 用于心跳；hover 0~1 放大能量球
    update(dt, t, vis = 1, status = 'normal', hover = 0) {
      arcs.rotation.z += dt * 0.2;
      const bob = Math.sin(t * 0.8 + phase) * 0.03 * r;
      orbGroup.position.y = orbY + bob;
      const s = orbR * (1 + hover * 0.25);
      orb.scale.setScalar(s); kernel.scale.setScalar(s * 0.4); halo.scale.setScalar(s * 3.0);
      orb.rotation.y = t * 0.15 + phase;
      orbMat.uniforms.uTime.value = t + phase;
      for (const o of orbits) { o.holder.rotation.y += dt * o.speed; o.ang += dt * o.angSpeed; o.spark.position.set(Math.cos(o.ang) * o.R, 0, Math.sin(o.ang) * o.R); }
      const beat = status === 'critical' ? 0.6 + 0.4 * heartbeat(t, ALARM.critical) : status === 'warning' ? 0.75 + 0.25 * heartbeat(t, ALARM.warning) : 1;
      for (const m of mats) {
        const v = m.userData.base * vis * (m === baseRing.material || m === orbitMat || m === haloMat ? beat : 1) * (m === glow.material || m === haloMat ? 1 + hover * 0.5 : 1);
        if (m === orbMat) m.uniforms.uOpacity.value = v; else m.opacity = v;
      }
    },
    dispose() { for (const m of mats) m.dispose(); },
  };
}
