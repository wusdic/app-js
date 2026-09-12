import * as THREE from 'three';
import { THEME } from '../config.js';

// 全局视角的接入终端：围绕各业务缓慢环绕的“尘埃”，数量随在线终端数变化；位置在 GPU 上计算，CPU 只管生灭
const CAPACITY = 5000;

export class TerminalCloud {
  constructor(nodes) {
    this.nodes = nodes;
    this.center = new Float32Array(CAPACITY * 3);
    this.orbit = new Float32Array(CAPACITY * 3); // radius, angle0, speed
    this.life = new Float32Array(CAPACITY * 3); // birth, duration, yOffset
    this.seed = new Float32Array(CAPACITY);
    this.vis = new Float32Array(CAPACITY);
    this.layer = 'all';
    this.free = []; for (let i = CAPACITY - 1; i >= 0; i--) this.free.push(i);
    this.slots = new Map(); // business id → Set(slot)
    this.expire = new Array(CAPACITY).fill(0);
    this.slotOwner = new Array(CAPACITY).fill(null);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3));
    g.setAttribute('aCenter', new THREE.BufferAttribute(this.center, 3));
    g.setAttribute('aOrbit', new THREE.BufferAttribute(this.orbit, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    g.setAttribute('aVis', new THREE.BufferAttribute(this.vis, 1));
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDim: { value: 1 }, uColor: { value: new THREE.Color(THEME.terminal) }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: `
        attribute vec3 aCenter; attribute vec3 aOrbit; attribute vec3 aLife; attribute float aSeed; attribute float aVis;
        uniform float uTime; uniform float uPixelRatio; varying float vA;
        void main(){
          float age = uTime - aLife.x;
          float alive = step(0.0, age) * step(age, aLife.y);
          float env = smoothstep(0.0, 1.5, age) * smoothstep(0.0, 2.0, aLife.y - age);
          float ang = aOrbit.y + aOrbit.z * uTime;
          vec3 p = aCenter + vec3(cos(ang) * aOrbit.x, aLife.z + sin(uTime * 0.7 + aSeed * 10.0) * 0.25, sin(ang) * aOrbit.x);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = alive * env * (0.22 + 0.28 * aSeed) * aVis;
          gl_PointSize = (1.2 + aSeed * 0.8) * uPixelRatio * (60.0 / -mv.z) * alive;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uDim; varying float vA;
        void main(){
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, r) * vA * uDim;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.time = 0;
    this.enabled = true;
    this.dirty = false;
    this.acc = 0;
  }

  // 每个业务的目标粒子数：与在线终端数成对数关系，避免核心业务粒子淹没画面
  targetFor(b) { return Math.min(40, Math.round(3 + Math.log2(1 + b.terminals.local) * 4)); }

  spawn(node) {
    if (!this.free.length) return;
    const i = this.free.pop();
    const b = node.data;
    const set = this.slots.get(b.id) || this.slots.set(b.id, new Set()).get(b.id);
    set.add(i); this.slotOwner[i] = b.id;
    const r = node.radius * (1.5 + Math.random() * 1.8);
    this.center.set([node.position.x, node.position.y, node.position.z], i * 3);
    this.orbit.set([r, Math.random() * Math.PI * 2, (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.12)], i * 3);
    const dur = 10 + Math.random() * 40;
    this.life.set([this.time, dur, node.radius * (0.3 + Math.random() * 1.2)], i * 3);
    this.seed[i] = Math.random();
    this.vis[i] = this.layer === 'all' || b.level === this.layer ? 1 : 0;
    this.expire[i] = this.time + dur;
    this.dirty = true;
  }

  release(i) {
    const owner = this.slotOwner[i];
    this.slots.get(owner)?.delete(i);
    this.slotOwner[i] = null;
    this.life[i * 3 + 1] = 0;
    this.free.push(i);
    this.dirty = true;
  }

  setDim(d) { this.material.uniforms.uDim.value = d * (this.enabled ? 1 : 0); }
  // 分层查看：只显示当前层业务的终端
  setLayer(level) {
    if (level === this.layer) return;
    this.layer = level;
    for (let i = 0; i < CAPACITY; i++) { const owner = this.slotOwner[i]; if (owner) this.vis[i] = level === 'all' || this.nodes.get(owner)?.data.level === level ? 1 : 0; }
    this.geometry.attributes.aVis.needsUpdate = true;
  }
  // 数据重载时清空全部粒子
  clear() { for (let i = 0; i < CAPACITY; i++) if (this.slotOwner[i]) this.release(i); }
  setEnabled(on) { this.enabled = on; this.points.visible = on; }

  update(dt, time) {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    this.acc += dt;
    if (this.acc < 0.3) return; // 生灭调度每 0.3s 一次即可
    this.acc = 0;
    for (let i = 0; i < CAPACITY; i++) if (this.slotOwner[i] && time > this.expire[i]) this.release(i);
    for (const node of this.nodes.values()) {
      const have = this.slots.get(node.data.id)?.size || 0;
      const want = this.targetFor(node.data);
      const n = Math.min(4, want - have);
      for (let k = 0; k < n; k++) this.spawn(node);
      if (have > want + 6) { const set = this.slots.get(node.data.id); const it = set.values(); for (let k = 0; k < 3; k++) { const v = it.next(); if (v.done) break; this.expire[v.value] = Math.min(this.expire[v.value], time + 1.5); } }
    }
    if (this.dirty) {
      this.dirty = false;
      for (const name of ['aCenter', 'aOrbit', 'aLife', 'aSeed', 'aVis']) this.geometry.attributes[name].needsUpdate = true;
    }
  }
}
