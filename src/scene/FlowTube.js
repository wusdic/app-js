import * as THREE from 'three';
import { sparkTexture } from '../core/textures.js';

// 带“流光”效果的管线：一条管子 + 最多 4 个同时行进的光斑（彗星尾在着色器里计算）
const MAX_HEADS = 4;
const vertexShader = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = `
  uniform vec3 uColor; uniform float uBase; uniform float uDim; uniform float uTime; uniform float uHover;
  uniform vec2 uHeads[${MAX_HEADS}]; uniform float uTail; uniform float uEdgeFade; uniform float uFlicker;
  varying vec2 vUv;
  void main(){
    float glow = 0.0;
    for (int i = 0; i < ${MAX_HEADS}; i++) {
      vec2 h = uHeads[i];
      if (h.x < -5.0) continue;
      float d = (h.x - vUv.x) * h.y;   // 头部之后为正
      if (d >= 0.0 && d < uTail) { float k = 1.0 - d / uTail; glow += k * k * k; }
    }
    float base = uBase * (1.0 + uHover * 2.5);
    if (uFlicker > 0.5) base *= 0.55 + 0.45 * sin(uTime * 9.0);
    float alpha = base + glow * 1.3;
    if (uEdgeFade > 0.5) alpha *= smoothstep(1.0, 0.68, vUv.x);
    vec3 col = uColor * (0.75 + 1.6 * glow);
    gl_FragColor = vec4(col * alpha * uDim, alpha * uDim);
  }`;

const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export class FlowTube {
  constructor(curve, { color = 0x3aa6ff, radius = 0.09, segments = 48, baseAlpha = 0.14, edgeFade = false, pickRadius = 0.5, speed = 0.42, tail = 0.16 } = {}) {
    this.curve = curve;
    this.speed = speed;
    this.heads = [];
    this.geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) }, uBase: { value: baseAlpha }, uDim: { value: 1 }, uTime: { value: 0 }, uHover: { value: 0 },
        uHeads: { value: Array.from({ length: MAX_HEADS }, () => new THREE.Vector2(-10, 1)) }, uTail: { value: tail },
        uEdgeFade: { value: edgeFade ? 1 : 0 }, uFlicker: { value: 0 },
      },
      vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
    this.pickMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, segments / 2), pickRadius, 4, false), pickMat);
    this.pickMesh.renderOrder = -100;
    this.sprites = [];
    this.spriteMat = new THREE.SpriteMaterial({ map: sparkTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95 });
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.pickMesh);
    this.spriteScale = radius * 9;
  }

  setColor(hex) { this.material.uniforms.uColor.value.set(hex); this.spriteMat.color.set(hex); }
  setBase(a) { this.material.uniforms.uBase.value = a; }
  get base() { return this.material.uniforms.uBase.value; }
  setDim(d) { this.material.uniforms.uDim.value = d; this.spriteMat.opacity = 0.95 * d; }
  setHover(h) { this.material.uniforms.uHover.value = h ? 1 : 0; }
  setFlicker(on) { this.material.uniforms.uFlicker.value = on ? 1 : 0; }

  // dir = 1 从起点流向终点，-1 反向
  pulse(dir = 1, speedMul = 1) {
    if (this.heads.length >= MAX_HEADS) return;
    this.heads.push({ t: dir > 0 ? 0 : 1, dir, speed: this.speed * speedMul });
  }

  update(dt, time) {
    const u = this.material.uniforms;
    u.uTime.value = time;
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
        if (!s) { s = new THREE.Sprite(this.spriteMat); s.scale.setScalar(this.spriteScale); s.renderOrder = 3; this.group.add(s); this.sprites[i] = s; }
        s.visible = true;
        this.curve.getPointAt(h.t, s.position);
        const shrink = u.uEdgeFade.value > 0.5 ? 1 - (Math.max(0, h.t - 0.7) / 0.3) * 0.9 : 1; // 出口渐隐：光斑接近边缘时缩小
        s.scale.setScalar(this.spriteScale * shrink);
      } else if (s) s.visible = false;
    }
  }

  dispose() {
    this.geometry.dispose(); this.material.dispose(); this.pickMesh.geometry.dispose(); this.spriteMat.dispose();
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
