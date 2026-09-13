import * as THREE from 'three';
import { sparkTexture } from '../core/textures.js';
import { LINK_RULES } from '../config.js';

// 连接管线：底线常亮（亮度由所在层级 / 状态决定），有流量时一道辉光沿线飞过（世界单位：所有连线同速同长）
const MAX_HEADS = 3;
const vertexShader = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = `
  uniform vec3 uColor; uniform float uBase; uniform float uDim; uniform float uTime; uniform float uHover; uniform float uAlarm; uniform float uBeat; uniform float uEdgeFade;
  uniform vec2 uHeads[${MAX_HEADS}]; uniform float uTail; uniform float uGlow; uniform float uEndFade;
  varying vec2 vUv;
  void main(){
    float glow = 0.0;
    for (int i = 0; i < ${MAX_HEADS}; i++) {
      vec2 h = uHeads[i];
      if (h.x < -5.0) continue;
      float d = (h.x - vUv.x) * h.y;   // 头部之后为正
      if (d >= 0.0 && d < uTail) { float k = 1.0 - d / uTail; glow += k * k; }
    }
    glow *= uGlow;
    float base = uBase * (1.0 + uHover * 1.6);
    base *= mix(1.0, 0.7 + 0.3 * uBeat, uAlarm);   // 故障连线：慢速心跳，不频闪
    float alpha = base + glow * 0.85;
    if (uEdgeFade > 0.5) alpha *= smoothstep(1.0, 0.7, vUv.x);
    // 两端各淡出一小段，管线不压在底座环上
    alpha *= smoothstep(0.0, uEndFade, vUv.x) * smoothstep(1.0, 1.0 - uEndFade, vUv.x);
    vec3 col = uColor * (0.85 + 0.5 * glow + 0.4 * uHover);   // 辉光头部保留色相，不烧成纯白
    gl_FragColor = vec4(col * alpha * uDim, alpha * uDim);
  }`;

const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const arrowGeo = new THREE.ConeGeometry(0.26, 0.7, 10);
const UP = new THREE.Vector3(0, 1, 0);

export class FlowTube {
  constructor(curve, { color = 0x3aa6ff, radius = 0.1, segments = 48, baseAlpha = 0.05, edgeFade = false, pickRadius = 0.5, speedUnits = LINK_RULES.pulseSpeedUnits, tailUnits = LINK_RULES.tailUnits, arrowScale = 1, arrowInset = LINK_RULES.arrowInset, bidirectional = false, endFade = 0.6 } = {}) {
    this.curve = curve;
    this.edgeFade = edgeFade;
    this.bidirectional = bidirectional;
    this.length = Math.max(0.5, curve.getLength());
    this.speed = speedUnits / this.length; // 曲线比例 / 秒
    this.heads = [];
    this.geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) }, uBase: { value: baseAlpha }, uDim: { value: 1 }, uTime: { value: 0 }, uHover: { value: 0 }, uAlarm: { value: 0 }, uBeat: { value: 1 },
        uEdgeFade: { value: edgeFade ? 1 : 0 }, uHeads: { value: Array.from({ length: MAX_HEADS }, () => new THREE.Vector2(-10, 1)) },
        uTail: { value: THREE.MathUtils.clamp(tailUnits / this.length, 0.06, 0.5) }, uGlow: { value: 1 }, uEndFade: { value: THREE.MathUtils.clamp(endFade / this.length, 0.0, 0.2) },
      },
      vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
    this.pickMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(10, Math.round(segments / 3)), pickRadius, 3, false), pickMat);
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.pickMesh);
    this.spriteMat = new THREE.SpriteMaterial({ map: sparkTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95 });
    this.sprites = [];
    this.spriteScale = radius * 9;
    // 方向箭头：按世界单位距端点 arrowInset 处放置，有流量期间显示
    this.arrowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const inset = THREE.MathUtils.clamp(arrowInset / this.length, 0.03, 0.4);
    this.arrowEnd = this._arrow(1 - inset, 1, arrowScale);
    this.arrowStart = this._arrow(inset, -1, arrowScale);
    this.group.add(this.arrowEnd, this.arrowStart);
    this.targetBase = baseAlpha; this.base = baseAlpha;
    this.targetDim = 1; this.dim = 1;
    this.targetActive = 0; this.active = 0; this.dir = 1; this.hover = 0; this.glow = 1;
  }

  _arrow(t, sign, scale) {
    const m = new THREE.Mesh(arrowGeo, this.arrowMat);
    this.curve.getPointAt(t, m.position);
    const tan = this.curve.getTangentAt(t).multiplyScalar(sign);
    m.quaternion.setFromUnitVectors(UP, tan.normalize());
    m.scale.setScalar(scale);
    m.renderOrder = 3;
    return m;
  }

  setColor(hex, gain = 1) { const c = new THREE.Color(hex).multiplyScalar(gain); this.material.uniforms.uColor.value.copy(c); this.arrowMat.color.copy(c); this.spriteMat.color.copy(c); }
  setBase(a, immediate = false) { this.targetBase = a; if (immediate) { this.base = a; this.material.uniforms.uBase.value = a; } }
  setDim(d, immediate = false) { this.targetDim = d; if (immediate) { this.dim = d; this.material.uniforms.uDim.value = d; } }
  setHover(h) { this.hover = h ? 1 : 0; this.material.uniforms.uHover.value = this.hover; }
  setAlarm(on) { this.material.uniforms.uAlarm.value = on ? 1 : 0; }
  setGlow(g) { this.glow = g; this.material.uniforms.uGlow.value = g; }
  setDir(dir) { this.dir = dir; }
  setActive(on, dir) { this.targetActive = on ? 1 : 0; if (dir !== undefined) this.setDir(dir); }
  get isActive() { return this.targetActive > 0; }

  // 一道辉光沿线飞过；dir = 1 起点→终点，-1 反向
  pulse(dir = this.dir, speedMul = 1) {
    if (this.glow <= 0 || this.heads.length >= MAX_HEADS) return;
    this.heads.push({ t: dir > 0 ? 0 : 1, dir, speed: this.speed * speedMul });
  }

  update(dt, time, beat = 1) {
    const u = this.material.uniforms;
    u.uTime.value = time; u.uBeat.value = beat;
    const k = Math.min(1, dt * 2.2);
    this.base += (this.targetBase - this.base) * k; u.uBase.value = this.base;
    this.dim += (this.targetDim - this.dim) * k; u.uDim.value = this.dim;
    this.active += (this.targetActive - this.active) * Math.min(1, dt * 3.5);
    const tail = u.uTail.value;
    for (let i = this.heads.length - 1; i >= 0; i--) {
      const h = this.heads[i];
      h.t += h.dir * h.speed * dt;
      if ((h.dir > 0 && h.t > 1 + tail) || (h.dir < 0 && h.t < -tail)) this.heads.splice(i, 1);
    }
    for (let i = 0; i < MAX_HEADS; i++) {
      const h = this.heads[i];
      if (h) u.uHeads.value[i].set(h.t, h.dir); else u.uHeads.value[i].set(-10, 1);
      let s = this.sprites[i];
      if (h && h.t >= 0 && h.t <= 1) {
        if (!s) { s = new THREE.Sprite(this.spriteMat); s.renderOrder = 4; this.group.add(s); this.sprites[i] = s; }
        s.visible = true;
        this.curve.getPointAt(h.t, s.position);
        const shrink = this.edgeFade ? 1 - (Math.max(0, h.t - 0.7) / 0.3) * 0.9 : 1;
        const ramp = Math.min(1, (h.dir > 0 ? h.t : 1 - h.t) / 0.06); // 头部从节点处渐显，不在节点上突然爆亮
        s.scale.setScalar(this.spriteScale * shrink * (0.6 + 0.4 * this.glow) * (0.3 + 0.7 * ramp));
      } else if (s) s.visible = false;
    }
    this.spriteMat.opacity = 0.95 * this.dim * this.glow;
    const op = Math.min(1, this.active * this.dim * 0.8 * (1 + this.hover * 0.3) * (this.glow > 0 ? 1 : 0));
    this.arrowMat.opacity = op;
    const show = op > 0.02;
    this.arrowEnd.visible = show && !this.edgeFade && (this.dir > 0 || this.bidirectional);
    this.arrowStart.visible = show && (this.dir < 0 || this.bidirectional);
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose(); this.pickMesh.geometry.dispose(); this.arrowMat.dispose(); this.spriteMat.dispose();
    this.group.removeFromParent();
  }
}

// 两点间的弧线：端点沿水平弦方向外推到底座边缘并略抬高（连线“插进”六边形边缘）；同层拱起，跨层向外弯
export function makeArc(a, b, { lift = 0.16, bow = 0.10, maxLift = 7, startOffset = 0, endOffset = 0 } = {}) {
  const chord = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  const horiz = chord.length();
  if (horiz > 1e-3) chord.divideScalar(horiz);
  const A = a.clone().add(chord.clone().multiplyScalar(Math.min(startOffset, horiz * 0.3))); A.y += 0.06;
  const B = b.clone().sub(chord.clone().multiplyScalar(Math.min(endOffset, horiz * 0.3))); B.y += 0.06;
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const dist = A.distanceTo(B);
  const outward = new THREE.Vector3(mid.x, 0, mid.z);
  if (outward.lengthSq() < 1e-3) outward.set(1, 0, 0); else outward.normalize();
  if (Math.abs(A.y - B.y) < 0.5) { mid.y += Math.min(dist * lift, maxLift); mid.add(outward.multiplyScalar(dist * bow * 0.5)); }
  else mid.add(outward.multiplyScalar(dist * bow));
  return new THREE.QuadraticBezierCurve3(A, mid, B);
}
