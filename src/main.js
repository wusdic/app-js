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
import { LAYOUT, LEVEL_NAME, LEVELS, LINK_RULES } from './config.js';

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

const state = { layer: LAYOUT.defaultLayer, focused: null, stage: null, selectedComp: null, alerts: new Map(), spot: null, pinned: null };
const ctx = { nodes, links, tooltip, onNavigate: (id) => focus(id), onRelationsChanged: () => refreshFocusPanel(), onSelectComponent: (cid) => selectComponent(cid) };

// ---------- 可见性规则（分层查看 + 聚光 叠加）----------
const levelOf = (id) => nodes.get(id)?.data.level;
function linkRelation(rec) {
  if (state.layer === 'all') return 'all';
  const a = levelOf(rec.from) === state.layer, b = levelOf(rec.to) === state.layer;
  return a && b ? 'intra' : a || b ? 'cross' : 'other';
}
function applyVisibility(immediate = false) {
  if (state.focused) return;
  const L = state.layer, spot = state.spot;
  for (const n of nodes.values()) {
    const inLayer = L === 'all' || n.data.level === L;
    const inSpot = !!spot && spot.nodes.has(n.data.id);
    let dim = inLayer ? 1 : 0.22;
    if (spot) dim = inSpot ? 1 : dim * 0.35;
    n.setDim(dim);
    n.setGhost(!inLayer && !inSpot);
    n.setHover(inSpot);
  }
  for (const l of links.links.values()) {
    const rel = linkRelation(l);
    let base = LINK_RULES.base[rel];
    if (l.transient) base *= rel === 'other' ? 0 : 0.85;
    if (l.status !== 'normal') base = Math.max(base, rel === 'other' ? 0.1 : 0.3); // 异常连接始终看得见
    const inSpot = !!spot && spot.links.has(l.id);
    l.tube.setBase(base, immediate);
    l.tube.setDim(spot ? (inSpot ? 1 : 0.15) : 1, immediate);
    l.tube.setHover(inSpot);
    l.glowEnabled = rel !== 'other';
    l.tube.setGlow(rel === 'other' ? 0 : rel === 'cross' ? 0.7 : 1);
  }
  layers.setLayerDims(L);
  terminals.setLayer(L);
}

// 聚光：只看某个业务 / 某条连接的关系
function spotlightFor(kind, id) {
  if (kind === 'node') {
    const ls = links.linksOf(id);
    const ns = new Set([id]); for (const l of ls) { ns.add(l.from); ns.add(l.to); }
    return { links: new Set(ls.map((l) => l.id)), nodes: ns, anchor: id };
  }
  const l = links.links.get(id); if (!l) return null;
  return { links: new Set([id]), nodes: new Set([l.from, l.to]), anchor: null };
}
function setSpot(sel) { state.spot = sel; applyVisibility(); }
function hoverSpot(sel) { if (!state.focused) setSpot(sel || (state.pinned ? spotlightFor('link', state.pinned) : null)); }
function pinLink(id) { state.pinned = state.pinned === id ? null : id; hoverSpot(null); refreshFlows(); }

// ---------- 分层查看 ----------
function frameLayer(L, duration = 1.3) {
  const target = L === 'all' ? new THREE.Vector3(...LAYOUT.camera.target) : new THREE.Vector3(0, LAYOUT.layers[L].y, 0);
  const dir = app.camera.position.clone().sub(app.controls.target); dir.y = 0;
  if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1); else dir.normalize();
  let pos;
  if (L === 'all') { const d = Math.hypot(LAYOUT.camera.position[0], LAYOUT.camera.position[2]); pos = dir.multiplyScalar(d).add(new THREE.Vector3(0, LAYOUT.camera.position[1], 0)); }
  else { const { dist, elev } = LAYOUT.layers[L].view; pos = target.clone().add(dir.multiplyScalar(dist * Math.cos(elev))).add(new THREE.Vector3(0, dist * Math.sin(elev), 0)); }
  flyTo(pos, target, duration);
}
function setLayer(L, { fly = true } = {}) {
  if (!LEVELS.includes(L) && L !== 'all') return;
  state.layer = L;
  if (state.focused) unfocus({ fly: false });
  state.pinned = null; state.spot = null;
  applyVisibility();
  refreshLayerTabs(); refreshFlows();
  if (fly) frameLayer(L);
}

for (const b of data.businesses) {
  const node = new BusinessNode(b, positions.get(b.id));
  nodes.set(b.id, node);
  scene.add(node.group);
  node.onClick = () => focus(b.id);
  node.onHoverLabel = (on) => hoverSpot(on ? spotlightFor('node', b.id) : null);
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
  if (e.type === 'add') {
    registerLink(e.link);
    if (state.focused) e.link.tube.setDim(e.link.from === state.focused || e.link.to === state.focused ? 0 : 0.06, true);
    else applyVisibility(true);
  }
  if (e.type === 'remove') { app.removePickable(e.link.tube.pickMesh); if (state.pinned === e.link.id) { state.pinned = null; hoverSpot(null); } }
  if (e.type === 'active' || e.type === 'idle') refreshFlows();
});

// ---------- 面板 ----------
const panels = initPanels({
  onBack: () => unfocus(),
  onReset: () => { state.pinned = null; if (state.focused) unfocus({ fly: false }); applyVisibility(); frameLayer(state.layer); },
  onToggle: (key, on) => {
    if (key === 'rotate') app.setAutoRotate(on);
    if (key === 'terminals') terminals.setEnabled(on);
    if (key === 'bloom') app.setBloom(on);
  },
  onAlertClick: (alertId) => { const a = state.alerts.get(alertId); if (!a) return; focus(a.kind === 'link' ? a.focusId : a.targetId, a.kind === 'component' ? a.cid : null); },
  onNavigate: (id) => focus(id),
  onFlowHover: (id) => hoverSpot(id ? spotlightFor('link', id) : null),
  onFlowClick: (id) => pinLink(id),
  onLayer: (L) => setLayer(L),
  onKpiLayer: (L) => setLayer(L),
  onCloseComponent: () => selectComponent(null),
});
panels.setCrumb(['全网总览']);

// ---------- 聚焦 / 返回 ----------
function flyTo(pos, target, duration = 1.4, done) {
  app.controls.enabled = false;
  tween(app.camera.position, { x: pos.x, y: pos.y, z: pos.z }, { duration, ease: Ease.inOutCubic });
  tween(app.controls.target, { x: target.x, y: target.y, z: target.z }, { duration, ease: Ease.inOutCubic, onComplete: () => { app.controls.enabled = true; done?.(); } });
}

function focus(id, compId = null) {
  const node = nodes.get(id);
  if (!node) return;
  if (state.focused === id) { if (compId) selectComponent(compId); return; }
  const open = () => {
    state.pinned = null; state.spot = null;
    state.focused = id;
    app.focusLocked = true; app.controls.autoRotate = false;
    tooltip.hide();
    for (const n of nodes.values()) { n.setDim(n === node ? 1 : 0.12); n.setGhost(false); n.setHover(false); }
    setLinkPicking(false);
    node.setHidden(true);
    for (const l of links.links.values()) { l.tube.setDim(l.from === id || l.to === id ? 0 : 0.06); l.tube.setHover(false); }
    layers.setDim(0.18);
    terminals.setDim(0.05);
    state.stage = new FocusStage(app, node, ctx);
    document.getElementById('layers-panel').classList.add('hidden');
    // 相机：保持当前方位角，靠近并抬高视角
    const dir = app.camera.position.clone().sub(node.position); dir.y = 0;
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1); else dir.normalize();
    const [ox, oy, oz] = LAYOUT.focus.offset;
    const camPos = node.position.clone().add(dir.multiplyScalar(oz)).add(new THREE.Vector3(ox, oy, 0));
    app.controls.minDistance = 10; app.controls.maxDistance = 90;
    flyTo(camPos, node.position.clone(), 1.4);
    panels.setCrumb(['全网总览', LEVEL_NAME[node.data.level] + '层', node.data.name]);
    refreshFocusPanel();
    if (compId) selectComponent(compId);
  };
  if (state.stage) closeStage(open); else open();
}

// 聚焦时禁用全局连线拾取（业务节点保持可点击，便于直接切换到其它业务）
function setLinkPicking(on) { for (const l of links.links.values()) if (l.pickEntry) l.pickEntry.enabled = on; }

function closeStage(done) {
  const st = state.stage; state.stage = null;
  const prev = state.focused; state.focused = null;
  state.selectedComp = null; panels.hideComponent();
  nodes.get(prev)?.setHidden(false);
  st.close(done);
}

function unfocus({ fly = true } = {}) {
  if (!state.focused) return;
  closeStage();
  setLinkPicking(true);
  layers.setDim(1);
  terminals.setDim(1);
  applyVisibility();
  app.focusLocked = false; app.idleTimer = 0;
  app.controls.minDistance = 12; app.controls.maxDistance = 220;
  if (fly) frameLayer(state.layer);
  panels.hideFocus();
  document.getElementById('layers-panel').classList.remove('hidden');
  panels.setCrumb(['全网总览']);
}

// 组件选中：舞台高亮 + 左侧状态卡
function selectComponent(cid) {
  if (!state.stage) return;
  state.selectedComp = cid;
  state.stage.selectComponent(cid);
  document.getElementById('focus-panel').classList.toggle('compact', !!cid);
  if (!cid) { panels.hideComponent(); return; }
  const b = nodes.get(state.focused).data;
  const c = b.components.find((x) => x.id === cid);
  if (c) panels.showComponent(c, b, state.stage.componentInfo(cid));
}

function relationsOf(id) {
  return links.linksOf(id).map((l) => {
    const otherId = l.from === id ? l.to : l.from;
    return { other: nodes.get(otherId).data, dir: l.bidirectional ? '⇄' : l.from === id ? '→' : '←', status: l.status, rate: links.ratePerMin(l), link: l };
  }).sort((a, b) => (b.link.active - a.link.active) || LEVELS.indexOf(a.other.level) - LEVELS.indexOf(b.other.level) || b.rate - a.rate);
}
function refreshFocusPanel() { if (!state.focused) return; const b = nodes.get(state.focused).data; panels.showFocus(b, relationsOf(b.id)); }

app.onBackgroundClick = () => {
  if (state.focused) { if (state.selectedComp) selectComponent(null); return; }
  if (state.pinned) { state.pinned = null; hoverSpot(null); refreshFlows(); }
};
window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'Escape') {
    if (state.selectedComp) selectComponent(null);
    else if (state.focused) unfocus();
    else if (state.pinned) { state.pinned = null; hoverSpot(null); refreshFlows(); }
  }
  if (e.key === '1') setLayer('core'); if (e.key === '2') setLayer('important'); if (e.key === '3') setLayer('general'); if (e.key === '0') setLayer('all');
});

// ---------- 对外 API（真实数据接入点）----------
function alertName(kind, targetId) {
  if (kind !== 'link') return nodes.get(targetId)?.data.name;
  const l = links.links.get(targetId); if (!l) return '';
  return `${nodes.get(l.from)?.data.name} ⇄ ${nodes.get(l.to)?.data.name}`;
}
const worst = (a, b) => (a === 'critical' || b === 'critical' ? 'critical' : a === 'warning' || b === 'warning' ? 'warning' : 'normal');
function nowClock() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

const api = {
  app, data, nodes, links, stage: () => state.stage, state,
  focus, unfocus, setLayer,
  touchLink: (id, dir = 1) => links.touch(id, dir),
  addTransientLink: (from, to, type) => links.addTransient(from, to, type),
  // 业务整体状态（不指定根因组件时使用）
  setBusinessStatus(id, status, message = '') {
    const node = nodes.get(id); if (!node) return;
    node.data.statusMessage = status === 'normal' ? '' : message;
    node.setStatus(status);
    const key = `b:${id}`;
    if (status === 'normal') state.alerts.delete(key);
    else state.alerts.set(key, { id: key, kind: 'business', targetId: id, name: node.data.name, level: node.data.level, status, message, since: Date.now() });
    refreshAlerts(); refreshLayerTabs(); if (state.focused === id) refreshFocusPanel();
  },
  // 组件状态：作为根因向上汇总到业务；告警列表显示“根因：组件名”
  setComponentStatus(bid, cid, status, message = '') {
    const node = nodes.get(bid); if (!node) return;
    const c = node.data.components.find((x) => x.id === cid); if (!c) return;
    const changed = c.status !== status;
    c.status = status; c.message = status === 'normal' ? '' : message;
    if (changed) c.events.unshift({ time: nowClock(), text: status === 'normal' ? '异常恢复，状态正常' : message, status: status === 'normal' ? '' : status });
    const key = `c:${cid}`;
    if (status === 'normal') state.alerts.delete(key);
    else state.alerts.set(key, { id: key, kind: 'component', targetId: bid, cid, name: node.data.name, level: node.data.level, status, message: `根因 ${c.name}：${message}`, since: state.alerts.get(key)?.since || Date.now() });
    // 业务状态 = 所有组件中最严重者
    const agg = node.data.components.reduce((s, x) => worst(s, x.status), 'normal');
    const rootCause = node.data.components.find((x) => x.status === agg && agg !== 'normal');
    node.data.statusMessage = agg === 'normal' ? '' : `根因 ${rootCause.name}：${rootCause.message}`;
    node.data.rootCause = rootCause?.id || null;
    node.setStatus(agg);
    refreshAlerts(); refreshLayerTabs();
    if (state.focused === bid) { state.stage?.refreshComponent(cid); refreshFocusPanel(); if (state.selectedComp === cid) selectComponent(cid); }
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
    applyVisibility();
    refreshAlerts();
  },
  setTerminals: () => state.stage?.setTerminals(),
  terminalEvent: (bid, kind) => { if (state.focused === bid) state.stage?.terminalEvent(kind); },
  spotlight: (kind, id) => { state.pinned = kind === 'link' ? id : null; setSpot(id ? spotlightFor(kind, id) : null); },
};
window.NetView = api;

function refreshAlerts() {
  const order = { critical: 0, warning: 1 };
  const list = [...state.alerts.values()].sort((a, b) => order[a.status] - order[b.status] || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.since - b.since);
  panels.setAlerts(list);
}

function byLevelStats() {
  const byLevel = {};
  for (const lv of LEVELS) byLevel[lv] = { count: 0, warning: 0, critical: 0 };
  for (const b of data.businesses) { const x = byLevel[b.level]; x.count++; if (b.status !== 'normal') x[b.status]++; }
  return byLevel;
}
function refreshLayerTabs() { panels.setLayerTabs(byLevelStats(), state.layer); }

function refreshFlows() {
  const active = links.activeLinks().filter((l) => linkRelation(l) !== 'other');
  const rows = active.slice(0, 10).map((l) => ({
    id: l.id, from: nodes.get(l.dir > 0 ? l.from : l.to)?.data.name, to: nodes.get(l.dir > 0 ? l.to : l.from)?.data.name,
    dir: l.bidirectional ? '⇄' : '→', type: l.type, rate: links.ratePerMin(l), status: l.status,
  }));
  panels.setFlows(rows, active.length, state.pinned);
}

function refreshKPIs() {
  let term = 0, remote = 0;
  for (const b of data.businesses) { term += b.terminals.local; remote += b.terminals.remote; }
  const all = [...links.links.values()];
  const alerts = [...state.alerts.values()];
  panels.setKPIs({ byLevel: byLevelStats(), layer: state.layer, links: { total: all.length, active: all.filter((l) => l.active).length, transient: all.filter((l) => l.transient && !l.removing).length }, terminals: term, remoteTerminals: remote, alerts: alerts.length, criticals: alerts.filter((a) => a.status === 'critical').length });
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

// 初始：默认层级视角
applyVisibility(true);
refreshLayerTabs(); refreshKPIs(); refreshAlerts(); refreshFlows();
frameLayer(state.layer, 0.01);

startSimulation(data, api);
app.start();
