import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createSystemModel } from './SystemModel.js';
import { LAYOUT, ALARM, THEME, colorOf, hashPhase } from '../config.js';
import { tween, Ease } from '../core/Tween.js';

const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const alertGeo = new THREE.RingGeometry(0.93, 1, 64);

// 业务节点：系统模型 + HTML 标签（可点击）+ 异常扩散警示环（慢速心跳）
export class BusinessNode {
  constructor(business, position) {
    this.data = business;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.radius = LAYOUT.nodeRadius[business.level];
    this.phase = hashPhase(business.id);
    this.model = createSystemModel(business.level, colorOf.business(business), this.radius, this.phase);
    this.group.add(this.model.group);

    this.pick = new THREE.Mesh(sphereGeo, pickMat);
    this.pick.scale.setScalar(this.radius * 2.1);
    this.pick.position.y = this.radius * 0.55;
    this.pick.userData.node = this;
    this.group.add(this.pick);

    this.alertMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.alertRing = new THREE.Mesh(alertGeo, this.alertMat);
    this.alertRing.rotation.x = -Math.PI / 2;
    this.alertRing.position.y = 0.02;
    this.alertRing.visible = false;
    this.group.add(this.alertRing);

    this.el = document.createElement('div');
    this.el.className = `lbl biz ${business.level}${business.labelAbove ? ' above' : ''}`;
    this.el.innerHTML = `<span class="dot"></span><span class="txt">${business.name}</span>`;
    this.el.onclick = (e) => { e.stopPropagation(); this.onClick?.(e); };
    this.el.onpointerenter = (e) => this.onHoverLabel?.(true, { x: e.clientX, y: e.clientY });
    this.el.onpointermove = (e) => this.onHoverLabel?.(true, { x: e.clientX, y: e.clientY });
    this.el.onpointerleave = () => this.onHoverLabel?.(false);
    this.label = new CSS2DObject(this.el);
    this.label.position.set(0, business.labelAbove ? this.radius * 1.5 : 0, business.labelAbove ? 0 : this.radius * 1.05);
    this.group.add(this.label);

    this.hover = 0; this.dim = 1; this.dimTarget = 1; this.hoverTarget = 0; this.culled = false; this.ghost = false;
    this.applyStatus();
  }

  get position() { return this.group.position; }

  applyStatus() {
    const st = this.data.status;
    const c = colorOf.business(this.data);
    this.model.setColor(c, st === 'normal' ? 1 : THEME.hdrGain);
    this.alertMat.color.set(c);
    this.alertRing.visible = st !== 'normal';
    this.el.classList.toggle('warning', st === 'warning');
    this.el.classList.toggle('critical', st === 'critical');
    this.el.querySelector('.txt').textContent = st === 'critical' ? `故障 · ${this.data.name}` : st === 'warning' ? `告警 · ${this.data.name}` : this.data.name;
  }

  setStatus(status) { this.data.status = status; this.applyStatus(); }
  setHub(on) { this.model.setHub(on); }
  // hover: 0~1（锚点 1，对端 0.35）；同一目标不重复建补间
  setHover(v) { v = typeof v === 'number' ? v : v ? 1 : 0; if (v === this.hoverTarget) return; this.hoverTarget = v; this._hoverTw?.cancel(); this._hoverTw = tween(this, { hover: v }, { duration: 0.3 }); }
  setDim(d) { if (d === this.dimTarget) return; this.dimTarget = d; this._dimTw?.cancel(); this._dimTw = tween(this, { dim: d }, { duration: 0.45, ease: Ease.inOutCubic }); this.el.classList.toggle('dim', d < 0.5); this._syncLabel(); }
  setHidden(hidden) { this.group.visible = !hidden; this.hidden = hidden; this._syncLabel(); }
  // 虚化：非当前层的业务，标签不再定位与显示（省主线程）
  setGhost(on) { if (on === this.ghost) return; this.ghost = on; this._syncLabel(); }
  // 标签碰撞剔除
  setCulled(on) { if (on === this.culled) return; this.culled = on; this._syncLabel(); }
  _syncLabel() { this.label.visible = !this.hidden && !this.ghost && !this.culled; }

  update(dt, t) {
    const st = this.data.status;
    const vis = Math.pow(this.dim, 2.2); // 透明度在线性空间混合，按 gamma 映射后压暗才符合视觉预期
    this.model.update(dt, t, vis, st, this.hover);
    if (this.alertRing.visible) {
      const period = st === 'critical' ? ALARM.critical : ALARM.warning;
      const p = ((t + this.phase) % period) / period;
      this.alertRing.scale.setScalar(this.radius * (1.4 + p * 1.8));
      this.alertMat.opacity = (1 - p) * (1 - p) * 0.6 * vis;
    }
  }

  dispose() {
    this._hoverTw?.cancel(); this._dimTw?.cancel();
    this.model.dispose(); this.alertMat.dispose(); this.el.remove();
    this.group.removeFromParent();
  }
}
