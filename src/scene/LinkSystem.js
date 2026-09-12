import * as THREE from 'three';
import { FlowTube, makeArc } from './FlowTube.js';
import { LINK_RULES, colorOf } from '../config.js';
import { tween } from '../core/Tween.js';

// 业务间连接管理：持久连接（有数据时亮、无数据时暗）与临时连接（无数据一段时间后自动消失）
export class LinkSystem {
  constructor(scene, nodes) {
    this.scene = scene;
    this.nodes = nodes; // Map id → BusinessNode
    this.links = new Map(); // id → link record
    this.group = new THREE.Group();
    scene.add(this.group);
    this.listeners = new Set();
    this.time = 0;
    this.dim = 1;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { for (const fn of this.listeners) fn(evt); }

  keyOf(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  findBetween(a, b) { const k = this.keyOf(a, b); for (const l of this.links.values()) if (this.keyOf(l.from, l.to) === k) return l; return null; }

  add(link) {
    if (this.links.has(link.id)) return this.links.get(link.id);
    const A = this.nodes.get(link.from), B = this.nodes.get(link.to);
    if (!A || !B) return null;
    const curve = makeArc(A.position, B.position);
    const tube = new FlowTube(curve, { color: colorOf.link(link), baseAlpha: link.transient ? 0 : 0.13, speed: LINK_RULES.pulseSpeed });
    const rec = { ...link, tube, lastActive: link.transient ? this.time : -100, lastPulse: -100, active: false, hover: 0, count: 0, recent: [], removing: false, transient: !!link.transient };
    this.group.add(tube.group);
    this.links.set(link.id, rec);
    tube.mesh.userData.link = rec; tube.pickMesh.userData.link = rec;
    this.emit({ type: 'add', link: rec });
    return rec;
  }

  remove(id) {
    const rec = this.links.get(id);
    if (!rec) return;
    rec.tube.dispose();
    this.links.delete(id);
    this.emit({ type: 'remove', link: rec });
  }

  addTransient(fromId, toId, type) {
    if (fromId === toId || this.findBetween(fromId, toId)) return null;
    const id = `t-${fromId}-${toId}-${Math.floor(this.time * 1000)}`;
    const rec = this.add({ id, from: fromId, to: toId, type, status: 'normal', transient: true, rate: 1 });
    if (!rec) return null;
    rec.fadeIn = true;
    return id;
  }

  // 数据事件：刷新活跃时间，按最小间隔触发一次流光
  touch(id, dir = 1) {
    const rec = this.links.get(id);
    if (!rec || rec.removing) return;
    rec.lastActive = this.time;
    rec.count++;
    rec.recent.push(this.time);
    if (!rec.active) { rec.active = true; this._setBase(rec, rec.transient ? 0.16 : 0.13); }
    const gap = rec.status === 'critical' ? LINK_RULES.minPulseGap * 0.6 : LINK_RULES.minPulseGap;
    if (this.time - rec.lastPulse >= gap) {
      rec.lastPulse = this.time;
      rec.tube.pulse(dir, rec.status === 'critical' ? 1.5 : 1);
      this.emit({ type: 'pulse', link: rec, dir });
    }
  }

  setStatus(id, status) {
    const rec = this.links.get(id);
    if (!rec) return;
    rec.status = status;
    rec.tube.setColor(colorOf.link(rec));
    rec.tube.setFlicker(status === 'critical');
    if (status !== 'normal') this._setBase(rec, 0.3);
    else this._setBase(rec, rec.active ? 0.13 : 0.04);
    this.emit({ type: 'status', link: rec });
  }

  _setBase(rec, v) {
    rec.baseTween?.cancel();
    const holder = { v: rec.tube.base };
    rec.baseTween = tween(holder, { v }, { duration: 0.8, onUpdate: () => rec.tube.setBase(holder.v) });
  }

  setDim(d) { this.dim = d; for (const rec of this.links.values()) rec.tube.setDim(d); }
  setDimExcept(d, keepFn) { for (const rec of this.links.values()) rec.tube.setDim(keepFn(rec) ? 1 : d); }

  linksOf(businessId) { return [...this.links.values()].filter((l) => l.from === businessId || l.to === businessId); }
  ratePerMin(rec) { const cutoff = this.time - 60; rec.recent = rec.recent.filter((t) => t > cutoff); return rec.recent.length; }

  update(dt, time) {
    this.time = time;
    for (const rec of this.links.values()) {
      rec.tube.update(dt, time);
      const idle = time - rec.lastActive;
      if (rec.active && idle > LINK_RULES.idleAfter) {
        rec.active = false;
        if (rec.status === 'normal') this._setBase(rec, rec.transient ? 0 : 0.035);
        this.emit({ type: 'idle', link: rec });
      }
      if (rec.transient && !rec.removing && idle > LINK_RULES.transientRemoveAfter) {
        rec.removing = true;
        this._setBase(rec, 0);
        setTimeout(() => this.remove(rec.id), 1000);
      }
    }
  }
}
