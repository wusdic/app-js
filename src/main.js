import * as THREE from 'three';
import { App } from './core/App.js';
import { tween, Ease } from './core/Tween.js';
import { createStarfield } from './scene/Starfield.js';
import { createLayers, layoutPositions } from './scene/Layers.js';
import { BusinessNode } from './scene/BusinessNode.js';
import { LinkSystem } from './scene/LinkSystem.js';
import { TerminalCloud } from './scene/TerminalCloud.js';
import { FocusStage } from './scene/FocusStage.js';
import { Tooltip } from './ui/Tooltip.js';
import { initPanels } from './ui/Panels.js';
import { generateData, startSimulation } from './data/mock.js';
import { LAYOUT, LEVEL_NAME, LEVELS } from './config.js';

// ---------- 场景搭建 ----------
const app = new App(document.getElementById('gl'), document.getElementById('labels'));
const tooltip = new Tooltip(document.getElementById('tooltip'));
const scene = app.scene;

const starfield = createStarfield();
const layers = createLayers();
scene.add(starfield, layers);

const data = generateData();
const positions = layoutPositions(data.businesses);
const nodes = new Map();
const links = new LinkSystem(scene, nodes);
const terminals = new TerminalCloud(nodes);
scene.add(terminals.points);

const state = { focused: null, stage: null, alerts: new Map(), spot: null, pinned: null };
const ctx = { nodes, links, tooltip, onNavigate: (id) => focus(id), onRelationsChanged: () => refreshFocusPanel() };

// ---------- 聚光：只看某个业务 / 某条连接的关系，其余压暗 ----------
function spotlightFor(kind, id) {
  if (kind === 'node') {
    const ls = links.linksOf(id);
    const ns = new Set([id]); for (const l of ls) { ns.add(l.from); ns.add(l.to); }
    return { links: new Set(ls.map((l) => l.id)), nodes: ns, anchor: id };
  }
  const l = links.links.get(id); if (!l) return null;
  return { links: new Set([id]), nodes: new Set([l.from, l.to]), anchor: null };
}
function applySpot(sel) {
  if (state.focused) return;
  state.spot = sel;
  for (const n of nodes.values()) {
    const inSet = !sel || sel.nodes.has(n.data.id);
    n.setDim(inSet ? 1 : 0.3);
    n.setHover(!!sel && inSet);
  }
  for (const l of links.links.values()) {
    const inSet = !sel || sel.links.has(l.id);
    l.tube.setDim(inSet ? 1 : 0.12);
    l.tube.setHover(!!sel && inSet);
  }
}
function hoverSpot(sel) { applySpot(sel || (state.pinned ? spotlightFor('link', state.pinned) : null)); }
function pinLink(id) { state.pinned = state.pinned === id ? null : id; hoverSpot(null); refreshFlows(); }

for (const b of data.businesses) {
  const node = new BusinessNode(b, positions.get(b.id));
  nodes.set(b.id, node);
  scene.add(node.group);
  node.pickEntry = app.addPickable({
    object: node.pick,
    onHover: (hit, px) => { hoverSpot(hit ? spotlightFor('node', b.id) : null); tooltip.business(hit ? b : null, px, ctx); },
    onClick: () => focus(b.id),
  });
}
function registerLink(rec) {
  rec.pickEntry = app.addPickable({
    object: rec.tube.pickMesh, enabled: !state.focused,
    onHover: (hit, px) => { hoverSpot(hit ? spotlightFor('link', rec.id) : null); tooltip.link(hit ? rec : null, px, ctx); },
    onClick: () => pinLink(rec.id),
  });
}
for (const l of data.links) { const rec = links.add(l); if (rec) registerLink(rec); }
links.on((e) => {
  if (e.type === 'add') { registerLink(e.link); if (state.focused) e.link.tube.setDim(e.link.from === state.focused || e.link.to === state.focused ? 0 : 0.06); else if (state.spot) e.link.tube.setDim(0.12); }
  if (e.type === 'remove') { app.removePickable(e.link.tube.pickMesh); if (state.pinned === e.link.id) { state.pinned = null; hoverSpot(null); } }
  if (e.type === 'active' || e.type === 'idle') refreshFlows();
});

// ---------- 面板 ----------
const panels = initPanels({
  onBack: () => unfocus(),
  onReset: () => { unfocus(); state.pinned = null; hoverSpot(null); flyTo(new THREE.Vector3(...LAYOUT.camera.position), new THREE.Vector3(...LAYOUT.camera.target)); },
  onToggle: (key, on) => {
    if (key === 'rotate') app.setAutoRotate(on);
    if (key === 'terminals') terminals.setEnabled(on);
    if (key === 'bloom') app.setBloom(on);
  },
  onAlertClick: (alertId) => { const a = state.alerts.get(alertId); if (a) focus(a.kind === 'business' ? a.targetId : a.focusId); },
  onNavigate: (id) => focus(id),
  onFlowHover: (id) => hoverSpot(id ? spotlightFor('link', id) : null),
  onFlowClick: (id) => pinLink(id),
});
panels.setCrumb(['全网总览']);

// ---------- 聚焦 / 返回 ----------
function flyTo(pos, target, duration = 1.4, done) {
  app.controls.enabled = false;
  tween(app.camera.position, { x: pos.x, y: pos.y, z: pos.z }, { duration, ease: Ease.inOutCubic });
  tween(app.controls.target, { x: target.x, y: target.y, z: target.z }, { duration, ease: Ease.inOutCubic, onComplete: () => { app.controls.enabled = true; done?.(); } });
}

function focus(id) {
  const node = nodes.get(id);
  if (!node || state.focused === id) return;
  const open = () => {
    state.pinned = null; applySpot(null);
    state.focused = id;
    app.focusLocked = true; app.controls.autoRotate = false;
    tooltip.hide();
    for (const n of nodes.values()) n.setDim(n === node ? 1 : 0.12);
    setGlobalPicking(false);
    node.setHidden(true);
    links.setDimExcept(0.06, () => false);
    for (const l of links.linksOf(id)) l.tube.setDim(0);
    layers.setDim(0.18);
    terminals.setDim(0.05);
    state.stage = new FocusStage(app, node, ctx);
    // 相机：保持当前方位角，靠近并抬高视角
    const dir = app.camera.position.clone().sub(node.position); dir.y = 0;
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1); else dir.normalize();
    const [ox, oy, oz] = LAYOUT.focus.offset;
    const camPos = node.position.clone().add(dir.multiplyScalar(oz)).add(new THREE.Vector3(ox, oy, 0));
    app.controls.minDistance = 10; app.controls.maxDistance = 90;
    flyTo(camPos, node.position.clone(), 1.4);
    panels.setCrumb(['全网总览', LEVEL_NAME[node.data.level], node.data.name]);
    refreshFocusPanel();
  };
  if (state.stage) closeStage(open); else open();
}

// 聚焦时禁用全局节点 / 连线的拾取，避免被压暗的对象抢占悬停
function setGlobalPicking(on) {
  for (const n of nodes.values()) n.pickEntry.enabled = on;
  for (const l of links.links.values()) if (l.pickEntry) l.pickEntry.enabled = on;
}

function closeStage(done) {
  const st = state.stage; state.stage = null;
  const prev = state.focused; state.focused = null;
  nodes.get(prev)?.setHidden(false);
  st.close(done);
}

function unfocus() {
  if (!state.focused) return;
  closeStage();
  for (const n of nodes.values()) n.setDim(1);
  setGlobalPicking(true);
  links.setDim(1);
  layers.setDim(1);
  terminals.setDim(1);
  app.focusLocked = false; app.idleTimer = 0;
  app.controls.minDistance = 12; app.controls.maxDistance = 220;
  const dir = app.camera.position.clone().sub(app.controls.target); dir.y = 0; dir.normalize();
  const [, cy] = LAYOUT.camera.position;
  const dist = Math.hypot(LAYOUT.camera.position[0], LAYOUT.camera.position[2]);
  flyTo(dir.multiplyScalar(dist).add(new THREE.Vector3(0, cy, 0)), new THREE.Vector3(...LAYOUT.camera.target), 1.3);
  panels.hideFocus();
  panels.setCrumb(['全网总览']);
}

function relationsOf(id) {
  return links.linksOf(id).map((l) => {
    const otherId = l.from === id ? l.to : l.from;
    return { other: nodes.get(otherId).data, dir: l.bidirectional ? '⇄' : l.from === id ? '→' : '←', status: l.status, rate: links.ratePerMin(l), link: l };
  }).sort((a, b) => (b.link.active - a.link.active) || LEVELS.indexOf(a.other.level) - LEVELS.indexOf(b.other.level) || b.rate - a.rate);
}
function refreshFocusPanel() { if (!state.focused) return; const b = nodes.get(state.focused).data; panels.showFocus(b, relationsOf(b.id)); }

app.onBackgroundClick = () => { if (state.pinned) { state.pinned = null; hoverSpot(null); refreshFlows(); } };
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (state.focused) unfocus(); else if (state.pinned) { state.pinned = null; hoverSpot(null); refreshFlows(); } } });

// ---------- 对外 API（真实数据接入点）----------
function alertName(kind, targetId) {
  if (kind === 'business') return nodes.get(targetId)?.data.name;
  const l = links.links.get(targetId); if (!l) return '';
  return `${nodes.get(l.from)?.data.name} ⇄ ${nodes.get(l.to)?.data.name}`;
}
const api = {
  app, data, nodes, links, stage: () => state.stage,
  focus, unfocus,
  touchLink: (id, dir = 1) => links.touch(id, dir),
  addTransientLink: (from, to, type) => links.addTransient(from, to, type),
  setBusinessStatus(id, status, message = '') {
    const node = nodes.get(id); if (!node) return;
    node.data.statusMessage = status === 'normal' ? '' : message;
    node.setStatus(status);
    const key = `b:${id}`;
    if (status === 'normal') state.alerts.delete(key);
    else state.alerts.set(key, { id: key, kind: 'business', targetId: id, name: node.data.name, level: node.data.level, status, message, since: Date.now() });
    refreshAlerts(); if (state.focused === id) refreshFocusPanel();
  },
  setLinkStatus(id, status, message = '') {
    const rec = links.links.get(id); if (!rec) return;
    rec.statusMessage = status === 'normal' ? '' : message;
    links.setStatus(id, status);
    const key = `l:${id}`;
    if (status === 'normal') state.alerts.delete(key);
    else {
      const A = nodes.get(rec.from).data, B = nodes.get(rec.to).data;
      const level = LEVELS.indexOf(A.level) <= LEVELS.indexOf(B.level) ? A.level : B.level;
      state.alerts.set(key, { id: key, kind: 'link', targetId: id, focusId: level === A.level ? A.id : B.id, name: alertName('link', id), level, status, message, since: Date.now() });
    }
    refreshAlerts();
  },
  setTerminals: () => state.stage?.setTerminals(),
  terminalEvent: (bid, kind) => { if (state.focused === bid) state.stage?.terminalEvent(kind); },
  spotlight: (kind, id) => { state.pinned = kind === 'link' ? id : null; applySpot(id ? spotlightFor(kind, id) : null); },
};
window.NetView = api;

function refreshAlerts() {
  const order = { critical: 0, warning: 1 };
  const list = [...state.alerts.values()].sort((a, b) => order[a.status] - order[b.status] || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.since - b.since);
  panels.setAlerts(list);
}

function refreshFlows() {
  const active = links.activeLinks();
  const rows = active.slice(0, 10).map((l) => ({
    id: l.id, from: nodes.get(l.dir > 0 ? l.from : l.to)?.data.name, to: nodes.get(l.dir > 0 ? l.to : l.from)?.data.name,
    dir: l.bidirectional ? '⇄' : '→', type: l.type, rate: links.ratePerMin(l), status: l.status,
  }));
  panels.setFlows(rows, active.length, state.pinned);
}

function refreshKPIs() {
  const byLevel = {};
  for (const lv of LEVELS) byLevel[lv] = { count: 0, warning: 0, critical: 0 };
  let term = 0, remote = 0;
  for (const b of data.businesses) { const x = byLevel[b.level]; x.count++; if (b.status !== 'normal') x[b.status]++; term += b.terminals.local; remote += b.terminals.remote; }
  const all = [...links.links.values()];
  const alerts = [...state.alerts.values()];
  panels.setKPIs({ byLevel, links: { total: all.length, active: all.filter((l) => l.active).length, transient: all.filter((l) => l.transient && !l.removing).length }, terminals: term, remoteTerminals: remote, alerts: alerts.length, criticals: alerts.filter((a) => a.status === 'critical').length });
}

// ---------- 主循环 ----------
app.updaters.add((dt, t) => {
  starfield.update(dt, t); layers.update(dt, t);
  for (const n of nodes.values()) n.update(dt, t);
  links.update(dt, t); terminals.update(dt, t);
  state.stage?.update(dt, t);
});
setInterval(() => { refreshKPIs(); refreshAlerts(); refreshFlows(); }, 1000);
setInterval(() => refreshFocusPanel(), 3000);
refreshKPIs(); refreshAlerts(); refreshFlows();

startSimulation(data, api);
app.start();
