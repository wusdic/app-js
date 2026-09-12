import * as THREE from 'three';
import { FlowTube, makeArc } from './FlowTube.js';
import { LINK_RULES, THEME, ALARM, heartbeat, colorOf } from '../config.js';

// 业务间连接管理：底线亮度由 main.js 的可见性规则设置；有数据 → 标记活跃并（按最小间隔）放出一道辉光；一段时间无数据 → 熄灭
// 活跃 / 空闲判断用墙钟（performance.now），动画时间只用于渲染
export class LinkSystem {
  constructor(scene, nodes) {
    this.scene = scene;
    this.nodes = nodes; // Map id → BusinessNode
    this.links = new Map(); // id → link record
    this.adj = new Map(); // business id → Set(rec)
    this.group = new THREE.Group();
    scene.add(this.group);
    this.listeners = new Set();
    this.time = 0; // 动画时间
    this.now = performance.now() / 1000; // 墙钟秒
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { for (const fn of this.listeners) fn(evt); }

  _adjAdd(id, rec) { (this.adj.get(id) || this.adj.set(id, new Set()).get(id)).add(rec); }
  _adjDel(id, rec) { this.adj.get(id)?.delete(rec); }
  linksOf(businessId) { return [...(this.adj.get(businessId) || [])]; }
  findBetween(a, b) { for (const l of this.adj.get(a) || []) if (l.from === b || l.to === b) return l; return null; }

  add(link) {
    if (this.links.has(link.id)) return this.links.get(link.id);
    const A = this.nodes.get(link.from), B = this.nodes.get(link.to);
    if (!A || !B) return null;
    const curve = makeArc(A.position, B.position, { startOffset: A.radius * 1.05, endOffset: B.radius * 1.05 });
    const tube = new FlowTube(curve, { color: colorOf.link(link), baseAlpha: 0, bidirectional: !!link.bidirectional, radius: LINK_RULES.radius });
    if (!link.status) link.status = 'normal';
    const rec = { ...link, src: link, tube, lastActive: -1e9, activeSince: -1e9, lastPulse: -1e9, active: false, dir: 1, count: 0, recent: [], removing: false, removeAt: 0, transient: !!link.transient, glowEnabled: true };
    this.group.add(tube.group);
    this.links.set(link.id, rec);
    this._adjAdd(rec.from, rec); this._adjAdd(rec.to, rec);
    tube.mesh.userData.link = rec; tube.pickMesh.userData.link = rec;
    if (rec.status !== 'normal') this.setStatus(rec.id, rec.status, true);
    this.emit({ type: 'add', link: rec });
    return rec;
  }

  remove(id) {
    const rec = this.links.get(id);
    if (!rec) return;
    rec.tube.dispose();
    this.links.delete(id);
    this._adjDel(rec.from, rec); this._adjDel(rec.to, rec);
    this.emit({ type: 'remove', link: rec });
  }

  clear() { for (const id of [...this.links.keys()]) this.remove(id); }

  addTransient(fromId, toId, type) {
    if (fromId === toId || this.findBetween(fromId, toId)) return null;
    const id = `t-${fromId}-${toId}-${Math.floor(this.now * 1000)}`;
    const rec = this.add({ id, from: fromId, to: toId, type, status: 'normal', transient: true });
    return rec ? id : null;
  }

  // 数据事件：touch(id, dir) 或 touch(id, { dir, count, at })；标记活跃，距上一道辉光超过最小间隔时再放出一道
  touch(id, arg = 1) {
    const rec = this.links.get(id);
    if (!rec || rec.removing) return;
    const opts = typeof arg === 'object' && arg !== null ? arg : { dir: arg };
    const dir = opts.dir ?? 1, count = Math.max(1, opts.count ?? 1);
    // 外部时间戳只用于频次统计；“当前活跃”按收到事件的时刻判断，避免过期时间戳造成活跃 / 熄灭抖动
    const at = opts.at ? Math.min(this.now, opts.at / 1000 - (Date.now() / 1000 - this.now)) : this.now;
    rec.lastActive = this.now;
    rec.count += count;
    rec.recent.push({ t: at, n: count });
    if (rec.recent.length > 600) rec.recent.splice(0, rec.recent.length - 300);
    if (!rec.active) {
      rec.active = true; rec.activeSince = this.now; rec.dir = dir;
      rec.tube.setActive(true, dir);
      this.emit({ type: 'active', link: rec, dir });
    }
    const gap = rec.status === 'critical' ? LINK_RULES.pulseGap * 0.6 : LINK_RULES.pulseGap;
    if (rec.glowEnabled && this.now - rec.lastPulse >= gap) {
      rec.lastPulse = this.now;
      rec.tube.pulse(dir, rec.status === 'critical' ? 1.3 : 1);
      this.emit({ type: 'pulse', link: rec, dir });
    }
  }

  setStatus(id, status, silent = false) {
    const rec = this.links.get(id);
    if (!rec) return;
    rec.status = status;
    if (rec.src) rec.src.status = status; // 回写原始数据对象，保持 NetView.data 与画面一致
    rec.tube.setColor(colorOf.link(rec), status === 'normal' ? 1 : THEME.hdrGain);
    rec.tube.setAlarm(status === 'critical');
    if (!silent) this.emit({ type: 'status', link: rec });
  }

  ratePerMin(rec) { const cutoff = this.now - 60; while (rec.recent.length && rec.recent[0].t < cutoff) rec.recent.shift(); let n = 0; for (const r of rec.recent) n += r.n; return n; }
  activeLinks() { const list = [...this.links.values()].filter((l) => l.active && !l.removing); const r = new Map(list.map((l) => [l.id, this.ratePerMin(l)])); return list.sort((a, b) => r.get(b.id) - r.get(a.id)); }

  update(dt, time) {
    this.time = time;
    this.now = performance.now() / 1000;
    const beat = 0.5 + 0.5 * heartbeat(time, ALARM.critical);
    for (const rec of this.links.values()) {
      rec.tube.update(dt, time, beat);
      const idle = this.now - rec.lastActive;
      if (rec.active && idle > LINK_RULES.idleAfter) {
        rec.active = false;
        rec.tube.setActive(false);
        this.emit({ type: 'idle', link: rec });
      }
      if (rec.transient && !rec.removing && idle > LINK_RULES.transientRemoveAfter) { rec.removing = true; rec.removeAt = this.now + 0.7; rec.tube.setBase(0); this.emit({ type: 'removing', link: rec }); }
      if (rec.removing && this.now > rec.removeAt) this.remove(rec.id);
    }
  }
}
