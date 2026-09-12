import * as THREE from 'three';

// 连接管线：活跃时整条点亮并显示缓慢定向流动的虚线段与箭头；空闲时只剩极淡的底线
const vertexShader = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = `
  uniform vec3 uColor; uniform float uBase; uniform float uActive; uniform float uDir; uniform float uTime; uniform float uDim; uniform float uHover;
  uniform float uDashes; uniform float uSpeed; uniform float uEdgeFade; uniform float uFlicker; uniform float uPhase;
  varying vec2 vUv;
  void main(){
    // 定向流动的虚线段：亮段沿 uDir 方向缓慢移动
    float ph = fract(vUv.x * uDashes - uTime * uSpeed * uDir + uPhase);
    float dash = smoothstep(0.0, 0.16, ph) * (1.0 - smoothstep(0.30, 0.52, ph));
    float breathe = 0.88 + 0.12 * sin(uTime * 1.2 + uPhase * 6.2831);
    float lit = uActive * (0.30 + 0.95 * dash) * breathe;
    float base = uBase;
    if (uFlicker > 0.5) base *= 0.5 + 0.5 * sin(uTime * 8.0);
    float alpha = (base + lit) * (1.0 + uHover * 1.2);
    if (uEdgeFade > 0.5) alpha *= smoothstep(1.0, 0.7, vUv.x);
    vec3 col = uColor * (0.85 + 0.7 * dash * uActive + 0.5 * uHover);
    gl_FragColor = vec4(col * alpha * uDim, alpha * uDim);
  }`;

const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const arrowGeo = new THREE.ConeGeometry(0.3, 0.85, 10);
const UP = new THREE.Vector3(0, 1, 0);

export class FlowTube {
  constructor(curve, { color = 0x3aa6ff, radius = 0.11, segments = 48, baseAlpha = 0.03, edgeFade = false, pickRadius = 0.5, dashSpacing = 2.6, speed = 1.3, arrowScale = 1, bidirectional = false } = {}) {
    this.curve = curve;
    this.edgeFade = edgeFade;
    this.bidirectional = bidirectional;
    const length = curve.getLength();
    this.geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) }, uBase: { value: baseAlpha }, uActive: { value: 0 }, uDir: { value: 1 }, uTime: { value: 0 }, uDim: { value: 1 }, uHover: { value: 0 },
        uDashes: { value: Math.max(2, Math.round(length / dashSpacing)) }, uSpeed: { value: speed }, uEdgeFade: { value: edgeFade ? 1 : 0 }, uFlicker: { value: 0 }, uPhase: { value: Math.random() },
      },
      vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
    this.pickMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, segments / 2), pickRadius, 4, false), pickMat);
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.pickMesh);
    // 方向箭头：终点侧用于正向，起点侧用于反向（双向连接两端都有）
    this.arrowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    this.arrowEnd = this._arrow(0.93, 1, arrowScale);
    this.arrowStart = this._arrow(0.07, -1, arrowScale);
    this.group.add(this.arrowEnd, this.arrowStart);
    this.targetActive = 0; this.active = 0; this.dir = 1; this.dim = 1; this.hover = 0;
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

  setColor(hex) { this.material.uniforms.uColor.value.set(hex); this.arrowMat.color.set(hex); }
  setBase(a) { this.material.uniforms.uBase.value = a; }
  get base() { return this.material.uniforms.uBase.value; }
  setDim(d) { this.dim = d; this.material.uniforms.uDim.value = d; }
  setHover(h) { this.hover = h ? 1 : 0; this.material.uniforms.uHover.value = this.hover; }
  setFlicker(on) { this.material.uniforms.uFlicker.value = on ? 1 : 0; }
  setDir(dir) { this.dir = dir; this.material.uniforms.uDir.value = dir; }
  // 活跃 = 当前有数据流转；dir: 1 起点→终点，-1 反向
  setActive(on, dir) { this.targetActive = on ? 1 : 0; if (dir !== undefined) this.setDir(dir); }
  get isActive() { return this.targetActive > 0; }

  update(dt, time) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    this.active += (this.targetActive - this.active) * Math.min(1, dt * 3.5);
    if (Math.abs(this.active - this.targetActive) < 0.002) this.active = this.targetActive;
    u.uActive.value = this.active;
    const op = Math.min(1, this.active * this.dim * 0.95 * (1 + this.hover * 0.3));
    this.arrowMat.opacity = op;
    const show = op > 0.02;
    this.arrowEnd.visible = show && !this.edgeFade && (this.dir > 0 || this.bidirectional);
    this.arrowStart.visible = show && (this.dir < 0 || this.bidirectional);
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose(); this.pickMesh.geometry.dispose(); this.arrowMat.dispose();
    this.group.removeFromParent();
  }
}

// 两点间的弧线：同层拱起，跨层向外弯，避免穿过其他层
export function makeArc(a, b, { lift = 0.16, bow = 0.10, maxLift = 7 } = {}) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dist = a.distanceTo(b);
  const outward = new THREE.Vector3(mid.x, 0, mid.z);
  if (outward.lengthSq() < 1e-3) outward.set(1, 0, 0); else outward.normalize();
  if (Math.abs(a.y - b.y) < 0.5) { mid.y += Math.min(dist * lift, maxLift); mid.add(outward.multiplyScalar(dist * bow * 0.5)); }
  else mid.add(outward.multiplyScalar(dist * bow));
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}
