import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { haloTexture } from '../core/textures.js';
import { LAYOUT, colorOf } from '../config.js';
import { tween, Ease } from '../core/Tween.js';

const sphereGeo = new THREE.SphereGeometry(1, 28, 20);
const ringGeo = new THREE.TorusGeometry(2.1, 0.035, 8, 96);
const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// 业务节点：发光球体 + 柔光光晕 + （核心）环 + HTML 标签；异常时变色并出现扩散警示环
export class BusinessNode {
  constructor(business, position) {
    this.data = business;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.radius = LAYOUT.nodeRadius[business.level];
    this.baseColor = new THREE.Color(colorOf.business(business));

    this.coreMat = new THREE.MeshBasicMaterial({ color: this.baseColor, transparent: true, opacity: 1 });
    this.core = new THREE.Mesh(sphereGeo, this.coreMat);
    this.core.scale.setScalar(this.radius);
    this.core.renderOrder = 5;

    this.haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: this.baseColor, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.halo = new THREE.Sprite(this.haloMat);
    this.haloBase = business.level === 'core' ? 6 : 7;
    this.halo.scale.setScalar(this.radius * this.haloBase);
    this.halo.renderOrder = 4;

    this.pick = new THREE.Mesh(sphereGeo, pickMat);
    this.pick.scale.setScalar(this.radius * 1.9);
    this.pick.userData.node = this;

    this.group.add(this.core, this.halo, this.pick);

    if (business.level === 'core') {
      this.ringMat = new THREE.MeshBasicMaterial({ color: this.baseColor, transparent: true, opacity: 0.55 });
      this.ring = new THREE.Mesh(ringGeo, this.ringMat);
      this.ring.scale.setScalar(this.radius);
      this.ring.rotation.x = Math.PI / 2 - 0.35;
      this.group.add(this.ring);
    }

    // 警示扩散环（仅异常时显示）
    this.alertMat = new THREE.MeshBasicMaterial({ color: this.baseColor, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.alertRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), this.alertMat);
    this.alertRing.rotation.x = -Math.PI / 2;
    this.alertRing.visible = false;
    this.group.add(this.alertRing);

    this.el = document.createElement('div');
    this.el.className = `lbl ${business.level}${business.labelAbove ? ' above' : ''}`;
    this.el.innerHTML = `<span class="dot"></span><span class="txt">${business.name}</span>`;
    this.label = new CSS2DObject(this.el);
    this.label.position.set(0, business.labelAbove ? this.radius * 1.2 : -this.radius * 1.2, 0);
    this.group.add(this.label);

    this.hover = 0; this.dim = 1; this.phase = Math.random() * Math.PI * 2;
    this.applyStatus();
  }

  get position() { return this.group.position; }

  applyStatus() {
    const st = this.data.status;
    this.baseColor.set(colorOf.business(this.data));
    this.coreMat.color.copy(this.baseColor);
    this.haloMat.color.copy(this.baseColor);
    this.ringMat?.color.copy(this.baseColor);
    this.alertMat.color.copy(this.baseColor);
    this.alertRing.visible = st !== 'normal';
    this.el.classList.toggle('warning', st === 'warning');
    this.el.classList.toggle('critical', st === 'critical');
  }

  setStatus(status) { this.data.status = status; this.applyStatus(); }

  setHover(on) { tween(this, { hover: on ? 1 : 0 }, { duration: 0.3 }); }

  setDim(d) {
    tween(this, { dim: d }, { duration: 0.6, ease: Ease.inOutCubic });
    this.el.classList.toggle('dim', d < 0.5);
  }

  setHidden(hidden) { this.group.visible = !hidden; this.el.classList.toggle('hidden-lbl', hidden); }

  update(dt, t) {
    const st = this.data.status;
    const breathe = 1 + 0.06 * Math.sin(t * 1.4 + this.phase);
    const pulse = st === 'critical' ? 1 + 0.25 * Math.max(0, Math.sin(t * 5)) : 1;
    this.halo.scale.setScalar(this.radius * this.haloBase * breathe * pulse * (1 + this.hover * 0.35) * (0.35 + 0.65 * this.dim));
    this.core.scale.setScalar(this.radius * (1 + this.hover * 0.18));
    // 透明度在线性空间混合，按 gamma 映射后压暗才符合视觉预期（否则 0.05 的透明度看起来仍有 20% 亮度）
    const vis = Math.pow(this.dim, 2.2);
    this.haloMat.opacity = (0.5 + this.hover * 0.35) * vis;
    this.coreMat.opacity = vis;
    if (this.ring) { this.ring.rotation.z = t * 0.35; this.ringMat.opacity = 0.5 * vis; }
    if (this.alertRing.visible) {
      const period = st === 'critical' ? 1.4 : 2.4;
      const p = ((t + this.phase) % period) / period;
      const s = this.radius * (2 + p * 4);
      this.alertRing.scale.setScalar(s);
      this.alertMat.opacity = (1 - p) * 0.7 * vis;
    }
  }
}
