import * as THREE from 'three';
import { FlowTube, makeArc } from './FlowTube.js';
import { LINK_RULES, colorOf } from '../config.js';

// 业务间连接管理：有数据往来 → 活跃（整条点亮 + 定向流动）；一段时间无数据 → 熄灭；临时连接熄灭后自动移除
export class LinkSystem {
  constructor(scene, nodes) {
    this.scene = scene;
    this.nodes = nodes; // Map id → BusinessNode
    this.links = new Map(); // id → link record
    this.group = new THREE.Group();
    scene.add(this.group);
    this.listeners = new Set();
    this.time = 0;
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
    const tube = new FlowTube(curve, {
      color: colorOf.link(link), baseAlpha: link.transient ? 0 : LINK_RULES.idleAlpha, bidirectional: !!link.bidirectional,
      dashSpacing: LINK_RULES.dashSpacing, speed: LINK_RULES.flowSpeed,
    });
    const rec = { ...link, tube, lastActive: -100, activeSince: -100, active: false, dir: 1, count: 0, recent: [], removing: false, transient: !!link.transient };
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
    const rec = this.add({ id, from: fromId, to: toId, type, status: 'normal', transient: true });
    return rec ? id : null;
  }

  // 数据事件：刷新活跃时间；首次到达时点亮连接（方向取本轮首个事件的方向）
  touch(id, dir = 1) {
    const rec = this.links.get(id);
    if (!rec || rec.removing) return;
    rec.lastActive = this.time;
    rec.count++;
    rec.recent.push(this.time);
    if (!rec.active) {
      rec.active = true; rec.activeSince = this.time; rec.dir = dir;
      rec.tube.setActive(true, dir);
      this.emit({ type: 'active', link: rec, dir });
    }
  }

  setStatus(id, status) {
    const rec = this.links.get(id);
    if (!rec) return;
    rec.status = status;
    rec.tube.setColor(colorOf.link(rec));
    rec.tube.setFlicker(status === 'critical');
    // 异常连接即便没有数据也要看得见
    rec.tube.setBase(status !== 'normal' ? 0.28 : rec.transient ? 0 : LINK_RULES.idleAlpha);
    this.emit({ type: 'status', link: rec });
  }

  setDim(d) { for (const rec of this.links.values()) rec.tube.setDim(d); }
  setDimExcept(d, keepFn) { for (const rec of this.links.values()) rec.tube.setDim(keepFn(rec) ? 1 : d); }

  linksOf(businessId) { return [...this.links.values()].filter((l) => l.from === businessId || l.to === businessId); }
  ratePerMin(rec) { const cutoff = this.time - 60; while (rec.recent.length && rec.recent[0] < cutoff) rec.recent.shift(); return rec.recent.length; }
  activeLinks() { return [...this.links.values()].filter((l) => l.active && !l.removing).sort((a, b) => this.ratePerMin(b) - this.ratePerMin(a)); }

  update(dt, time) {
    this.time = time;
    for (const rec of this.links.values()) {
      rec.tube.update(dt, time);
      const idle = time - rec.lastActive;
      if (rec.active && idle > LINK_RULES.idleAfter) {
        rec.active = false;
        rec.tube.setActive(false);
        this.emit({ type: 'idle', link: rec });
      }
      if (rec.transient && !rec.removing && idle > LINK_RULES.transientRemoveAfter) {
        rec.removing = true;
        setTimeout(() => this.remove(rec.id), 600);
      }
    }
  }
}
