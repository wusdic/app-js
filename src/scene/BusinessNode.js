import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createSystemModel } from './SystemModel.js';
import { LAYOUT, colorOf } from '../config.js';
import { tween, Ease } from '../core/Tween.js';

const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// 业务节点：系统模型 + HTML 标签 + 异常扩散警示环
export class BusinessNode {
  constructor(business, position) {
    this.data = business;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.radius = LAYOUT.nodeRadius[business.level];
    this.model = createSystemModel(business.level, colorOf.business(business), this.radius);
    this.group.add(this.model.group);

    this.pick = new THREE.Mesh(sphereGeo, pickMat);
    this.pick.scale.setScalar(this.radius * 2.1);
    this.pick.position.y = this.radius * 0.55;
    this.pick.userData.node = this;
    this.group.add(this.pick);

    // 警示扩散环（仅异常时显示）
    this.alertMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.alertRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), this.alertMat);
    this.alertRing.rotation.x = -Math.PI / 2;
    this.alertRing.position.y = 0.02;
    this.alertRing.visible = false;
    this.group.add(this.alertRing);

    this.el = document.createElement('div');
    this.el.className = `lbl biz ${business.level}${business.labelAbove ? ' above' : ''}`;
    this.el.innerHTML = `<span class="dot"></span><span class="txt">${business.name}</span>`;
    this.el.onclick = (e) => { e.stopPropagation(); this.onClick?.(); };
    this.el.onpointerenter = () => this.onHoverLabel?.(true);
    this.el.onpointerleave = () => this.onHoverLabel?.(false);
    this.label = new CSS2DObject(this.el);
    this.label.position.set(0, business.labelAbove ? this.radius * 1.5 : 0, business.labelAbove ? 0 : this.radius * 1.05);
    this.group.add(this.label);

    this.hover = 0; this.dim = 1; this.phase = Math.random() * Math.PI * 2;
    this.applyStatus();
  }

  get position() { return this.group.position; }

  applyStatus() {
    const st = this.data.status;
    const c = colorOf.business(this.data);
    this.model.setColor(c);
    this.alertMat.color.set(c);
    this.alertRing.visible = st !== 'normal';
    this.el.classList.toggle('warning', st === 'warning');
    this.el.classList.toggle('critical', st === 'critical');
  }

  setStatus(status) { this.data.status = status; this.applyStatus(); }
  setHover(on) { tween(this, { hover: on ? 1 : 0 }, { duration: 0.3 }); }
  setDim(d) { tween(this, { dim: d }, { duration: 0.6, ease: Ease.inOutCubic }); this.el.classList.toggle('dim', d < 0.5); }
  setHidden(hidden) { this.group.visible = !hidden; this.el.classList.toggle('hidden-lbl', hidden); }
  // 虚化：非当前层的业务，标签隐藏
  setGhost(on) { this.el.classList.toggle('ghost', on); }

  update(dt, t) {
    const st = this.data.status;
    // 透明度在线性空间混合，按 gamma 映射后压暗才符合视觉预期
    const vis = Math.pow(this.dim, 2.2);
    this.model.update(dt, t, vis, st, this.hover);
    if (this.alertRing.visible) {
      const period = st === 'critical' ? 1.4 : 2.4;
      const p = ((t + this.phase) % period) / period;
      this.alertRing.scale.setScalar(this.radius * (1.6 + p * 3.2));
      this.alertMat.opacity = (1 - p) * 0.7 * vis;
    }
  }
}
