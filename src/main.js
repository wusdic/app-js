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
import { generateData, startSimulation, deriveMetrics } from './data/mock.js';
import { LAYOUT, LEVEL_NAME, LEVELS, LINK_RULES, HEALTH_WEIGHTS } from './config.js';

// ---------- 场景基础 ----------
const app = new App(document.getElementById('gl'), document.getElementById('labels'));
const tooltip = new Tooltip(document.getElementById('tooltip'));
const scene = app.scene;
const starfield = createStarfield();
const layers = createLayers();
scene.add(starfield, layers);

let data = { businesses: [], links: [] };
const nodes = new Map();
const links = new LinkSystem(scene, nodes);
const terminals = new TerminalCloud(nodes);
scene.add(terminals.points);

const state = {
  layer: LAYOUT.defaultLayer, focused: null, stage: null, selectedComp: null, transition: 'idle',
  alerts: new Map(), spot: null, pinned: null, hoverTimer: 0, camTweens: [], events: [], scoreHistory: [], termHistory: [], hubs: new Set(),
  patrol: { enabled: true, current: null, until: 0, phase: 'idle' }, wheelOut: 0, dirty: new Set(), searchSpot: false,
};
const now = () => Date.now();
const nowClock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const metricsOf = (b) => b.metricsNow || deriveMetrics(b);
const ctx = { nodes, links, tooltip, metricsOf, onNavigate: (id) => focus(id), onRelationsChanged: () => schedule('focus'), onSelectComponent: (cid) => selectComponent(cid), onPortalHover: (id) => panels.setRelHighlight(id) };

// ---------- 刷新调度：多个数据事件在同一帧合并成一次面板更新 ----------
let flushQueued = false;
function schedule(kind) { state.dirty.add(kind); if (flushQueued) return; flushQueued = true; requestAnimationFrame(() => { flushQueued = false; flush(); }); }
function flush() {
  const d = state.dirty; state.dirty = new Set();
  if (d.has('visibility')) applyVisibility();
  if (d.has('kpis')) refreshKPIs();
  if (d.has('alerts')) refreshAlerts();
  if (d.has('tabs')) refreshLayerTabs();
  if (d.has('flows')) refreshFlows();
  if (d.has('hubs')) refreshHubs();
  if (d.has('focus')) refreshFocusPanel();
}

// ---------- 可见性规则（分层查看 × 聚光 叠加）----------
const levelOf = (id) => nodes.get(id)?.data.level;
function linkRelation(rec) {
  if (state.layer === 'all') return 'all';
  const a = levelOf(rec.from) === state.layer, b = levelOf(rec.to) === state.layer;
  return a && b ? 'intra' : a || b ? 'cross' : 'other';
}
function applyVisibility(immediate = false) {
  if (state.focused) return;
  const L = state.layer, spot = state.spot, strong = !!state.pinned || state.searchSpot; // 固定 / 搜索聚光用强对比，路过悬停用弱对比
  for (const n of nodes.values()) {
    const inLayer = L === 'all' || n.data.level === L;
    const inSpot = !!spot && spot.nodes.has(n.data.id);
    let dim = inLayer ? 1 : 0.22;
    if (spot) dim = inSpot ? 1 : dim * (strong ? 0.35 : 0.55);
    n.setDim(dim);
    n.setGhost(!inLayer && !inSpot);
    n.setHover(inSpot ? (spot.anchor === n.data.id || !spot.anchor ? 1 : 0.35) : 0);
    n.pickEntry.enabled = inLayer || inSpot;
  }
  for (const l of links.links.values()) {
    const rel = linkRelation(l);
    const inSpot = !!spot && spot.links.has(l.id);
    let base = inSpot ? LINK_RULES.base.spot : LINK_RULES.base[rel];
    if (l.transient) base *= rel === 'other' && !inSpot ? 0 : 0.85;
    if (l.status !== 'normal') base = Math.max(base, rel === 'other' ? 0.1 : 0.3); // 异常连接始终看得见
    l.tube.setBase(base, immediate);
    l.tube.setDim(spot ? (inSpot ? 1 : strong ? 0.15 : 0.3) : 1, immediate);
    l.tube.setHover(inSpot);
    l.glowEnabled = rel !== 'other' || inSpot;
    l.tube.setGlow(inSpot ? 1 : rel === 'other' ? 0 : rel === 'cross' ? 0.7 : 1);
    if (l.pickEntry) l.pickEntry.enabled = rel !== 'other' || l.status !== 'normal' || inSpot;
  }
  layers.setLayerDims(L);
  terminals.setLayer(L);
}

// 聚光：只看某个业务 / 某条连接的关系
function spotlightFor(kind, id) {
  if (kind === 'node') {
    const ls = links.linksOf(id);
    const ns = new Set([id]); for (const l of ls) { ns.add(l.from); ns.add(l.to); }
    return { links: new Set(ls.map((l) => l.id)), nodes: ns, anchor: id, key: `n:${id}` };
  }
  const l = links.links.get(id); if (!l) return null;
  return { links: new Set([id]), nodes: new Set([l.from, l.to]), anchor: null, key: `l:${id}` };
}
function setSpot(sel) { if (sel?.key && sel.key === state.spot?.key) return; state.spot = sel; applyVisibility(); }
function pinnedSpot() { return state.pinned ? spotlightFor(state.pinned.kind, state.pinned.id) : null; }
function hoverSpot(sel) { if (state.focused) return; clearTimeout(state.hoverTimer); if (sel) state.hoverTimer = setTimeout(() => setSpot(sel), 150); else setSpot(pinnedSpot()); }
function pin(kind, id) {
  state.pinned = state.pinned && state.pinned.kind === kind && state.pinned.id === id ? null : { kind, id };
  clearTimeout(state.hoverTimer); setSpot(pinnedSpot());
  updateSpotChip(); schedule('flows');
}
function clearPin() { if (!state.pinned) return; state.pinned = null; setSpot(null); updateSpotChip(); schedule('flows'); }
function updateSpotChip() {
  if (!state.pinned) return panels.setSpotChip(null);
  if (state.pinned.kind === 'node') return panels.setSpotChip(nodes.get(state.pinned.id)?.data.name);
  const l = links.links.get(state.pinned.id); panels.setSpotChip(l ? `${nodes.get(l.from)?.data.name} ${l.bidirectional ? '⇄' : '→'} ${nodes.get(l.to)?.data.name}` : null);
}

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
  if (state.transition !== 'idle') { state.queued = () => setLayer(L, { fly }); return; }
  if (state.focused) unfocus({ fly: false });
  state.layer = L;
  state.pinned = null; state.spot = null; updateSpotChip();
  applyVisibility();
  refreshLayerTabs(); refreshFlows(); refreshKPIs();
  if (fly) frameLayer(L);
}

// ---------- 场景构建 / 重载 ----------
function registerLink(rec) {
  rec.pickEntry = app.addPickable({
    object: rec.tube.pickMesh, tier: 1, enabled: !state.focused,
    onHover: (hit, px) => { hoverSpot(hit ? spotlightFor('link', rec.id) : null); tooltip.link(hit ? rec : null, px, ctx); },
    onClick: () => pin('link', rec.id),
  });
}
function addNode(b) {
  const node = new BusinessNode(b, positionsFor(b));
  nodes.set(b.id, node);
  scene.add(node.group);
  node.onClick = (e) => { if (e?.shiftKey) pin('node', b.id); else focus(b.id); };
  node.onHoverLabel = (on, px) => { hoverSpot(on ? spotlightFor('node', b.id) : null); if (on) tooltip.business(b, px, ctx); else tooltip.hide(); };
  node.pickEntry = app.addPickable({
    object: node.pick, tier: 0,
    onHover: (hit, px) => { hoverSpot(hit ? spotlightFor('node', b.id) : null); tooltip.business(hit ? b : null, px, ctx); },
    onClick: (hit, e) => { if (e?.shiftKey) pin('node', b.id); else focus(b.id); },
  });
  return node;
}
let positions = new Map();
function positionsFor(b) { return positions.get(b.id) || new THREE.Vector3(0, LAYOUT.layers[b.level].y, 0); }
function buildScene(snapshot) {
  data = snapshot;
  positions = layoutPositions(data.businesses);
  for (const b of data.businesses) addNode(b);
  for (const l of data.links) { const rec = links.add(l); if (rec) registerLink(rec); }
  // 快照里已带异常的业务 / 组件 / 连接同样进入告警列表
  for (const b of data.businesses) { for (const c of b.components) if (c.status !== 'normal') api.setComponentStatus(b.id, c.id, c.status, c.message || '异常'); if (b.status !== 'normal' && !b.rootCause) api.setBusinessStatus(b.id, b.status, b.statusMessage || '异常'); }
  for (const l of data.links) if (l.status !== 'normal') api.setLinkStatus(l.id, l.status, l.statusMessage || '异常');
  computeHubs();
  applyVisibility(true);
  refreshLayerTabs(); refreshKPIs(); refreshAlerts(); refreshFlows(); refreshHubs();
}
function clearScene() {
  if (state.focused) unfocus({ fly: false });
  clearPin(); state.spot = null;
  links.clear(); terminals.clear();
  for (const n of nodes.values()) { app.removePickable(n.pick); n.dispose(); }
  nodes.clear(); state.alerts.clear(); state.hubs.clear();
}
links.on((e) => {
  if (e.type === 'add') {
    registerLink(e.link);
    if (state.focused) e.link.tube.setDim(e.link.from === state.focused || e.link.to === state.focused ? 0 : 0.06, true);
    else applyVisibility(true);
    schedule('hubs');
  }
  if (e.type === 'remove') { app.removePickable(e.link.tube.pickMesh); if (state.pinned?.kind === 'link' && state.pinned.id === e.link.id) clearPin(); schedule('hubs'); }
  if (e.type === 'active' || e.type === 'idle') { schedule('flows'); schedule('hubs'); }
});

// ---------- 面板 ----------
const panels = initPanels({
  onBack: () => unfocus(),
  onReset: () => { clearPin(); if (state.focused) unfocus({ fly: false }); applyVisibility(); frameLayer(state.layer); },
  onToggle: (key, on) => {
    if (key === 'rotate') app.setAutoRotate(on);
    if (key === 'terminals') terminals.setEnabled(on);
    if (key === 'bloom') app.setBloom(on);
    if (key === 'patrol') { state.patrol.enabled = on; if (!on) stopPatrol(); }
  },
  onQuality: (q) => { if (q === 'auto') { app.autoQuality = true; app.setQuality('high', { auto: true }); panels.setQuality(app.quality, true); } else app.setQuality(q); },
  onAlertClick: (alertId) => { const a = state.alerts.get(alertId); if (!a || a.recoveredAt) return; if (a.kind === 'link') focus(a.focusId, null, a.targetId); else focus(a.targetId, a.cid || null); },
  onAlertHover: (alertId) => { const a = alertId && state.alerts.get(alertId); if (!a) return hoverSpot(null); hoverSpot(spotlightFor(a.kind === 'link' ? 'link' : 'node', a.targetId)); },
  onNavigate: (id) => focus(id),
  onFlowHover: (id) => hoverSpot(id ? spotlightFor('link', id) : null),
  onFlowClick: (id) => pin('link', id),
  onLayer: (L) => setLayer(L),
  onKpiLayer: (L) => setLayer(L),
  onCloseComponent: () => selectComponent(null),
  onHubHover: (id) => hoverSpot(id ? spotlightFor('node', id) : null),
  onHubClick: (id) => focus(id),
  onRelHover: (linkId) => { state.stage?.highlightPortal(linkId || null); panels.setRelHighlight(linkId); },
  onRelClick: (otherId) => focus(otherId),
  onCrumb: (i, n) => { if (i === n - 1) return; if (i === 0) { unfocus(); } else unfocus(); },
  onSpotClear: () => clearPin(),
  onBannerLocate: (evt) => locate(evt.targetId),
  onSearch: (q) => search(q),
  onSearchHover: (id) => hoverSpot(id ? spotlightFor('node', id) : null),
  onSearchPick: (id, shift) => { panels.clearSearch(); state.searchSpot = false; if (shift) pin('node', id); else { setSpot(null); focus(id); } },
});
panels.setCrumb(['全网总览']);
app.onQuality = (q, auto) => panels.setQuality(q, auto);
panels.setQuality(app.quality, true);

// 搜索：名称 / 部门 / 负责人模糊匹配；匹配集作为临时聚光
function search(q) {
  if (!q) { state.searchSpot = false; setSpot(pinnedSpot()); return []; }
  const matches = data.businesses.filter((b) => [b.name, b.dept, b.owner].some((s) => s.includes(q))).slice(0, 8);
  state.searchSpot = true;
  setSpot({ nodes: new Set(matches.map((b) => b.id)), links: new Set(), anchor: null, key: `s:${q}` });
  return matches.map((b) => ({ id: b.id, name: b.name, level: b.level, dept: b.dept, status: b.status }));
}

// ---------- 相机 ----------
function flyTo(pos, target, duration = 1.4, done) {
  for (const t of state.camTweens) t.cancel();
  app.controls.enabled = false;
  const wasAuto = app.controls.autoRotate; app.controls.autoRotate = false;
  const a = tween(app.camera.position, { x: pos.x, y: pos.y, z: pos.z }, { duration, ease: Ease.inOutCubic });
  const b = tween(app.controls.target, { x: target.x, y: target.y, z: target.z }, { duration, ease: Ease.inOutCubic, onComplete: () => { if (state.camTweens[1] !== b) return; app.controls.enabled = true; app.controls.autoRotate = wasAuto && app.autoRotateWanted && !state.focused; done?.(); } });
  state.camTweens = [a, b];
}
function tweenFov(fov) { tween(app.camera, { fov }, { duration: 1.2, ease: Ease.inOutCubic, onUpdate: () => app.camera.updateProjectionMatrix() }); }
// 定位（不进入局部）：聚光 + 把视线中心移到该业务
function locate(id) {
  const node = nodes.get(id); if (!node) return;
  if (state.focused) unfocus({ fly: false });
  if (state.layer !== 'all' && state.layer !== node.data.level) { state.layer = node.data.level; refreshLayerTabs(); applyVisibility(); }
  pin('node', id);
  const off = app.camera.position.clone().sub(app.controls.target);
  flyTo(node.position.clone().add(off), node.position.clone(), 1.4);
}

// ---------- 聚焦 / 返回 ----------
function focus(id, compId = null, linkId = null) {
  const node = nodes.get(id);
  if (!node) return;
  if (state.transition !== 'idle') { state.queued = () => focus(id, compId, linkId); return; }
  if (state.focused === id) { if (compId) selectComponent(compId); if (linkId) { state.stage?.highlightPortal(linkId); panels.setRelHighlight(linkId); } return; }
  const open = () => {
    state.transition = 'opening';
    clearTimeout(state.hoverTimer); state.pinned = null; state.spot = null; updateSpotChip(); stopPatrol();
    state.focused = id;
    if (state.layer !== 'all' && state.layer !== node.data.level) { state.layer = node.data.level; refreshLayerTabs(); }
    app.focusLocked = true; app.controls.autoRotate = false;
    tooltip.hide(); app.clearHover();
    for (const n of nodes.values()) { n.setDim(n === node ? 1 : 0.12); n.setGhost(false); n.setHover(0); n.pickEntry.enabled = false; }
    for (const l of links.links.values()) { l.tube.setDim(l.from === id || l.to === id ? 0 : 0.06); l.tube.setHover(false); if (l.pickEntry) l.pickEntry.enabled = false; }
    node.setHidden(true);
    document.getElementById('labels').classList.add('focus-mode');
    layers.setDim(0.18);
    terminals.setDim(0.05);
    state.stage = new FocusStage(app, node, ctx);
    // 相机：保持当前方位角，靠近并抬高视角；先放宽距离限制再飞，落地后收紧
    const dir = app.camera.position.clone().sub(node.position); dir.y = 0;
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1); else dir.normalize();
    const [ox, oy, oz] = LAYOUT.focus.offset;
    const camPos = node.position.clone().add(dir.multiplyScalar(oz)).add(new THREE.Vector3(ox, oy, 0));
    app.controls.minDistance = 10; app.controls.maxDistance = Math.max(90, app.camera.position.distanceTo(app.controls.target) + 5);
    flyTo(camPos, node.position.clone(), 1.4, () => { app.controls.maxDistance = 90; });
    tweenFov(LAYOUT.focus.fov);
    panels.setCrumb(['全网总览', LEVEL_NAME[node.data.level] + '层', node.data.name]);
    refreshFocusPanel();
    selectComponent(compId || node.data.rootCause || null);
    setTimeout(() => { state.transition = 'idle'; if (linkId) { state.stage?.highlightPortal(linkId); panels.setRelHighlight(linkId); } runQueued(); }, 700);
  };
  if (state.stage) closeStage(open); else open();
}
function runQueued() { const q = state.queued; state.queued = null; q?.(); }
function closeStage(done) {
  const st = state.stage; state.stage = null;
  const prev = state.focused; state.focused = null;
  state.transition = 'closing';
  state.selectedComp = null; panels.hideComponent(); document.getElementById('focus-panel').classList.remove('compact');
  nodes.get(prev)?.setHidden(false);
  st.close(() => { state.transition = 'idle'; done?.(); runQueued(); });
}
function unfocus({ fly = true } = {}) {
  if (!state.focused) return;
  if (state.transition !== 'idle' && state.transition !== 'opening') return;
  closeStage();
  document.getElementById('labels').classList.remove('focus-mode');
  for (const l of links.links.values()) if (l.pickEntry) l.pickEntry.enabled = true;
  layers.setDim(1);
  terminals.setDim(1);
  applyVisibility();
  app.focusLocked = false; app.idleTimer = 0;
  app.controls.minDistance = 12; app.controls.maxDistance = 220;
  if (fly) frameLayer(state.layer);
  tweenFov(42);
  panels.hideFocus();
  panels.setCrumb(['全网总览']);
  refreshLayerTabs(); refreshFlows();
}

// 组件选中：舞台高亮 + 左侧状态卡；再点同一组件取消
function selectComponent(cid) {
  if (!state.stage) return;
  if (cid && cid === state.selectedComp) cid = null;
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
  }).sort((a, b) => (b.other.status !== 'normal') - (a.other.status !== 'normal') || (b.link.active - a.link.active) || LEVELS.indexOf(a.other.level) - LEVELS.indexOf(b.other.level) || b.rate - a.rate);
}
let focusRefreshAt = 0;
function refreshFocusPanel() {
  if (!state.focused) return;
  const t = now(); if (t - focusRefreshAt < 250) { clearTimeout(state.focusTimer); state.focusTimer = setTimeout(refreshFocusPanel, 260); return; } focusRefreshAt = t;
  const b = nodes.get(state.focused).data;
  const rels = relationsOf(b.id);
  const m = metricsOf(b);
  const badUp = rels.find((r) => r.dir === '←' && r.other.status !== 'normal') || rels.find((r) => r.dir === '⇄' && r.other.status !== 'normal');
  const upstreamHint = b.status !== 'normal' && badUp ? `可能受 ${badUp.other.name}（${badUp.other.status === 'critical' ? '故障' : '告警'}）影响` : '';
  panels.showFocus(b, rels, { ...m, upstreamHint });
}

// ---------- 背景点击 / 键盘 / 滚轮 ----------
app.onBackgroundClick = () => {
  if (state.focused) { if (state.selectedComp) selectComponent(null); return; }
  clearPin();
};
app.onUserActive = () => stopPatrol();
app.onWheel = (e) => {
  if (!state.focused || e.deltaY <= 0) { state.wheelOut = 0; return; }
  if (app.camera.position.distanceTo(app.controls.target) >= app.controls.maxDistance - 0.5) { if (++state.wheelOut >= 3) { state.wheelOut = 0; unfocus(); } } else state.wheelOut = 0;
};
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.target && /INPUT|TEXTAREA/.test(e.target.tagName);
  if (typing) return;
  if (e.key === 'Escape') { if (state.selectedComp) selectComponent(null); else if (state.focused) unfocus(); else clearPin(); }
  else if (e.key === '1') setLayer('core'); else if (e.key === '2') setLayer('important'); else if (e.key === '3') setLayer('general'); else if (e.key === '0') setLayer('all');
  else if (e.key === 'r' || e.key === 'R') { clearPin(); if (state.focused) unfocus({ fly: false }); frameLayer(state.layer); }
  else if (e.key === 'Backspace' && state.focused) unfocus();
  else if (e.key === '/') { e.preventDefault(); panels.focusSearch(); }
});

// ---------- 标签碰撞剔除：屏幕空间贪心，异常 > 聚光 > 核心 > 重要 > 一般 ----------
const _v = new THREE.Vector3();
let lodAcc = 0;
function cullLabels(dt) {
  lodAcc += dt; if (lodAcc < 0.12) return; lodAcc = 0;
  if (state.focused) return;
  const fontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
  const W = window.innerWidth, H = window.innerHeight;
  const items = [];
  for (const n of nodes.values()) {
    if (n.ghost || n.hidden) continue;
    _v.copy(n.position).project(app.camera);
    if (_v.z > 1) { n.setCulled(true); continue; }
    const x = (_v.x + 1) / 2 * W, y = (1 - _v.y) / 2 * H + (n.data.labelAbove ? -1.05 : 1.05) * fontPx;
    const w = (n.el.textContent.length * 0.98 + 1.2) * fontPx * (n.data.level === 'core' ? 1.0 : 0.92), h = fontPx * 1.5;
    const pri = (n.data.status === 'critical' ? 400 : n.data.status === 'warning' ? 300 : 0) + (state.spot?.nodes.has(n.data.id) ? 200 : 0) + (n.data.level === 'core' ? 30 : n.data.level === 'important' ? 20 : 10) - _v.z;
    items.push({ n, box: [x - w / 2, y - h / 2, x + w / 2, y + h / 2], pri });
  }
  items.sort((a, b) => b.pri - a.pri);
  const placed = [];
  for (const it of items) {
    const hit = placed.some((p) => it.box[0] < p[2] && it.box[2] > p[0] && it.box[1] < p[3] && it.box[3] > p[1]);
    if (hit) { it.n.cullAt = it.n.cullAt || now(); if (now() - it.n.cullAt > 250) it.n.setCulled(true); }
    else { it.n.cullAt = 0; it.n.setCulled(false); placed.push(it.box); }
  }
}

// ---------- 值守巡视：无人操作 60 秒且存在故障时，轮流定位最严重的故障 ----------
function stopPatrol() { if (state.patrol.phase === 'idle') return; state.patrol.phase = 'idle'; state.patrol.current = null; clearPin(); }
function patrol(dt) {
  const p = state.patrol;
  if (!p.enabled || state.focused || app.idleTimer < 60) { if (p.phase !== 'idle' && app.idleTimer < 60) stopPatrol(); return; }
  const crit = [...state.alerts.values()].filter((a) => !a.recoveredAt && a.status === 'critical').sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || (b.impact?.businesses || 0) - (a.impact?.businesses || 0));
  if (!crit.length) { if (p.phase !== 'idle') stopPatrol(); return; }
  const t = app.time;
  if (p.phase === 'idle' || (p.phase === 'show' && t > p.until)) {
    if (p.phase === 'show') { p.phase = 'rest'; p.until = t + 12; clearPin(); return; }
    const next = crit[(crit.findIndex((a) => a.id === p.current) + 1) % crit.length];
    p.current = next.id; p.phase = 'show'; p.until = t + 12;
    const id = next.kind === 'link' ? next.focusId : next.targetId;
    const node = nodes.get(id); if (!node) return;
    if (state.layer !== 'all' && state.layer !== node.data.level) { state.layer = node.data.level; refreshLayerTabs(); applyVisibility(); }
    state.pinned = { kind: next.kind === 'link' ? 'link' : 'node', id: next.kind === 'link' ? next.targetId : id }; setSpot(pinnedSpot()); updateSpotChip();
    const off = app.camera.position.clone().sub(app.controls.target);
    flyTo(node.position.clone().add(off), node.position.clone(), 1.6);
  } else if (p.phase === 'rest' && t > p.until) { p.phase = 'idle'; }
}

// ---------- 对外 API（真实数据接入点）----------
const worst = (a, b) => (a === 'critical' || b === 'critical' ? 'critical' : a === 'warning' || b === 'warning' ? 'warning' : 'normal');
function impactOf(bid) { const b = nodes.get(bid)?.data; if (!b) return null; const ls = links.linksOf(bid); return { businesses: ls.length, coreDeps: ls.filter((l) => levelOf(l.from === bid ? l.to : l.from) === 'core').length, terminals: b.terminals.local + b.terminals.remote }; }
function pushEvent(cls, text) { state.events.unshift({ time: nowClock(), cls, text }); state.events.length = Math.min(state.events.length, 50); panels.setTicker(state.events); }
function upsertAlert(key, rec) {
  const prev = state.alerts.get(key);
  if (prev && !prev.recoveredAt) { Object.assign(prev, rec, { since: prev.since }); if (prev.status !== rec.status) pushEvent(rec.status, `${rec.name} ${prev.status === 'warning' ? '告警升级为故障' : '状态变更'}`); }
  else {
    state.alerts.set(key, { ...rec, since: now() });
    pushEvent(rec.status, `${rec.name} ${rec.status === 'critical' ? '故障' : '告警'}：${rec.message.replace(/^根因 /, '')}`);
    if (rec.status === 'critical' && (rec.kind !== 'link' || rec.level !== 'general')) panels.showBanner(rec);
  }
  schedule('alerts'); schedule('kpis'); schedule('tabs'); schedule('hubs');
}
function recoverAlert(key) {
  const a = state.alerts.get(key); if (!a || a.recoveredAt) return;
  a.recoveredAt = now();
  pushEvent('recovered', `${a.name} 已恢复（持续 ${Math.round((a.recoveredAt - a.since) / 1000)} 秒）`);
  setTimeout(() => { if (state.alerts.get(key)?.recoveredAt) state.alerts.delete(key); schedule('alerts'); }, 60000);
  schedule('alerts'); schedule('kpis'); schedule('tabs'); schedule('hubs');
}

const api = {
  app, nodes, links, state, get data() { return data; }, stage: () => state.stage,
  focus, unfocus, setLayer, locate,
  touchLink: (id, arg) => links.touch(id, arg),
  addTransientLink: (from, to, type) => links.addTransient(from, to, type),
  // 业务整体状态（不指定根因组件时使用）
  setBusinessStatus(id, status, message = '') {
    const node = nodes.get(id); if (!node) return;
    node.data.statusMessage = status === 'normal' ? '' : message;
    node.setStatus(status);
    const key = `b:${id}`;
    if (status === 'normal') recoverAlert(key);
    else upsertAlert(key, { id: key, kind: 'business', targetId: id, name: node.data.name, level: node.data.level, status, message, impact: impactOf(id) });
    if (state.focused === id) schedule('focus');
  },
  // 组件状态：作为根因向上汇总到业务；告警列表显示“根因：组件名”
  setComponentStatus(bid, cid, status, message = '') {
    const node = nodes.get(bid); if (!node) return;
    const c = node.data.components.find((x) => x.id === cid); if (!c) return;
    const changed = c.status !== status;
    c.status = status; c.message = status === 'normal' ? '' : message;
    if (changed) { c.events.unshift({ time: nowClock().slice(0, 5), text: status === 'normal' ? '异常恢复，状态正常' : message, status: status === 'normal' ? '' : status }); c.events.length = Math.min(c.events.length, 30); }
    c.metrics.errorRateNow = status === 'critical' ? (12 + (cid.length % 7) * 3).toFixed(1) : status === 'warning' ? (1.5 + (cid.length % 5) * 0.4).toFixed(2) : undefined;
    const key = `c:${cid}`;
    if (status === 'normal') recoverAlert(key);
    else upsertAlert(key, { id: key, kind: 'component', targetId: bid, cid, name: node.data.name, level: node.data.level, status, message: `根因 ${c.name}：${message}`, impact: impactOf(bid) });
    const agg = node.data.components.reduce((s, x) => worst(s, x.status), 'normal');
    const rootCause = node.data.components.find((x) => x.status === agg && agg !== 'normal');
    node.data.statusMessage = agg === 'normal' ? '' : `根因 ${rootCause.name}：${rootCause.message}`;
    node.data.rootCause = rootCause?.id || null;
    node.setStatus(agg);
    if (state.focused === bid) { state.stage?.refreshComponent(cid); schedule('focus'); if (state.selectedComp === cid) { state.selectedComp = null; selectComponent(cid); } }
  },
  setLinkStatus(id, status, message = '') {
    const rec = links.links.get(id); if (!rec) return;
    rec.statusMessage = status === 'normal' ? '' : message;
    links.setStatus(id, status);
    const key = `l:${id}`;
    if (status === 'normal') recoverAlert(key);
    else {
      const A = nodes.get(rec.from).data, B = nodes.get(rec.to).data;
      const hi = LEVELS.indexOf(A.level) <= LEVELS.indexOf(B.level) ? A : B;
      upsertAlert(key, { id: key, kind: 'link', targetId: id, focusId: hi.id, name: `${A.name} → ${B.name} 链路`, level: hi.level, status, message: `${message}${hi.level === 'core' ? ` · 涉及核心 ${hi.name}` : ''}`, impact: impactOf(hi.id) });
    }
    schedule('visibility');
  },
  // 指标：{ availability, latency, qps }
  setMetrics(id, m) { const b = nodes.get(id)?.data; if (!b) return; b.metricsNow = { ...metricsOf(b), ...m }; if (state.focused === id) schedule('focus'); },
  setTerminals: () => { state.stage?.setTerminals(); schedule('kpis'); },
  terminalEvent: (bid, kind) => { if (state.focused === bid) state.stage?.terminalEvent(kind); },
  spotlight: (kind, id) => { if (!id) return clearPin(); state.pinned = { kind, id }; setSpot(pinnedSpot()); updateSpotChip(); },
  search,
  setQuality: (q) => (q === 'auto' ? (app.autoQuality = true) : app.setQuality(q)),
  // 批量事件：[{ type: 'touch'|'business'|'component'|'link'|'metrics'|'terminals', ... }]
  applyEvents(list) { for (const e of list) { if (e.type === 'touch') links.touch(e.id, e); else if (e.type === 'business') api.setBusinessStatus(e.id, e.status, e.message); else if (e.type === 'component') api.setComponentStatus(e.bid, e.cid, e.status, e.message); else if (e.type === 'link') api.setLinkStatus(e.id, e.status, e.message); else if (e.type === 'metrics') api.setMetrics(e.id, e.metrics); else if (e.type === 'terminals') { const b = nodes.get(e.id)?.data; if (b) Object.assign(b.terminals, e.terminals); api.setTerminals(); } } },
  // 整体重载：{ businesses, links }
  load(snapshot) { clearScene(); buildScene(snapshot); },
  addBusiness(b) { data.businesses.push(b); positions = layoutPositions(data.businesses); for (const n of nodes.values()) { const p = positions.get(n.data.id); if (p) tween(n.group.position, { x: p.x, y: p.y, z: p.z }, { duration: 1 }); } addNode(b); computeHubs(); applyVisibility(true); schedule('kpis'); schedule('tabs'); },
  removeBusiness(id) { const n = nodes.get(id); if (!n) return; if (state.focused === id) unfocus({ fly: false }); for (const l of links.linksOf(id)) links.remove(l.id); app.removePickable(n.pick); n.dispose(); nodes.delete(id); data.businesses = data.businesses.filter((b) => b.id !== id); for (const k of [`b:${id}`, ...n.data.components.map((c) => `c:${c.id}`)]) state.alerts.delete(k); computeHubs(); schedule('kpis'); schedule('tabs'); schedule('alerts'); },
  removeLink(id) { links.remove(id); state.alerts.delete(`l:${id}`); schedule('alerts'); },
};
window.NetView = api;

// ---------- 汇总：KPI / 告警 / 层级 / 流转 / 关键依赖 ----------
function byLevelStats() {
  const byLevel = {};
  for (const lv of LEVELS) byLevel[lv] = { count: 0, warning: 0, critical: 0 };
  for (const b of data.businesses) { const x = byLevel[b.level]; x.count++; if (b.status !== 'normal') x[b.status]++; }
  return byLevel;
}
function healthScore() {
  let s = 100;
  for (const a of state.alerts.values()) { if (a.recoveredAt) continue; const w = HEALTH_WEIGHTS[a.level][a.status] * (a.kind === 'link' ? 0.5 : 1); s -= a.kind === 'component' && a.status === 'warning' ? w * 0.6 : w; }
  return Math.max(0, Math.round(s));
}
function refreshKPIs() {
  let term = 0, remote = 0;
  for (const b of data.businesses) { term += b.terminals.local; remote += b.terminals.remote; }
  const live = [...state.alerts.values()].filter((a) => !a.recoveredAt);
  const score = healthScore();
  const t = now();
  if (!state.scoreHistory.length || t - state.scoreHistory.at(-1).t > 10000) { state.scoreHistory.push({ t, score }); state.termHistory.push({ t, term }); if (state.scoreHistory.length > 120) { state.scoreHistory.shift(); state.termHistory.shift(); } }
  const old = state.scoreHistory.find((h) => t - h.t <= 600000);
  const oldT = state.termHistory.find((h) => t - h.t <= 300000);
  panels.setKPIs({
    score, scoreDelta: old && t - old.t > 30000 ? score - old.score : null, byLevel: byLevelStats(), layer: state.layer,
    criticals: live.filter((a) => a.status === 'critical').length, warnings: live.filter((a) => a.status === 'warning').length,
    terminals: term, remoteTerminals: remote, terminalDelta: oldT && t - oldT.t > 30000 ? term - oldT.term : null,
  });
}
function refreshAlerts() {
  const order = { critical: 0, warning: 1 };
  const list = [...state.alerts.values()].sort((a, b) => (!!a.recoveredAt - !!b.recoveredAt) || (a.level === state.layer ? -1 : 0) - (b.level === state.layer ? -1 : 0) || order[a.status] - order[b.status] || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.since - b.since);
  panels.setAlerts(list);
  for (const lv of LEVELS) { const x = byLevelStats()[lv]; layers.setLayerNote(lv, x.critical ? `${x.critical} 故障${x.warning ? ` · ${x.warning} 告警` : ''}` : x.warning ? `${x.warning} 告警` : '', x.critical ? 'critical' : x.warning ? 'warning' : ''); }
}
function refreshLayerTabs() {
  const byLevel = byLevelStats();
  let hint = null;
  if (state.layer !== 'all' && byLevel[state.layer].critical === 0) { const other = LEVELS.find((lv) => lv !== state.layer && byLevel[lv].critical > 0); if (other) hint = { layer: other, text: `${LEVEL_NAME[other]}层有 ${byLevel[other].critical} 项故障 →` }; }
  panels.setLayerTabs(byLevel, state.layer, hint);
}
function refreshFlows() {
  const active = links.activeLinks().filter((l) => linkRelation(l) !== 'other');
  const pinnedId = state.pinned?.kind === 'link' ? state.pinned.id : null;
  const rows = active.slice(0, 10).map((l) => ({ id: l.id, from: nodes.get(l.dir > 0 ? l.from : l.to)?.data.name, to: nodes.get(l.dir > 0 ? l.to : l.from)?.data.name, dir: l.bidirectional ? '⇄' : '→', type: l.type, rate: links.ratePerMin(l), status: l.status }));
  panels.setFlows(rows, active.length, pinnedId);
}
// 关键依赖：按被依赖权重（对端核心 ×3、重要 ×2、一般 ×1）取前 5
function computeHubs() {
  const scored = data.businesses.map((b) => { const ls = links.linksOf(b.id).filter((l) => !l.transient); const w = ls.reduce((s, l) => s + ({ core: 3, important: 2, general: 1 }[levelOf(l.from === b.id ? l.to : l.from)] || 1), 0); return { b, w, dependents: ls.length }; }).sort((a, b) => b.w - a.w).slice(0, 5);
  state.hubs = new Set(scored.map((x) => x.b.id));
  for (const n of nodes.values()) n.setHub(state.hubs.has(n.data.id));
  state.hubList = scored;
}
function refreshHubs() {
  panels.setHubs((state.hubList || []).map(({ b, dependents }) => ({ id: b.id, name: b.name, level: b.level, status: b.status, dependents, active: links.linksOf(b.id).filter((l) => l.active).length })));
}

// ---------- 自愈 ----------
app.onContextLost = () => document.getElementById('gl-lost').classList.remove('hidden');
app.onBeforeReload = () => { try { sessionStorage.setItem('netview.state', JSON.stringify({ layer: state.layer, focused: state.focused })); } catch {} };

// ---------- 主循环 ----------
app.updaters.add((dt, t) => {
  starfield.update(dt, t); layers.update(dt, t, app.camera);
  for (const n of nodes.values()) n.update(dt, t);
  links.update(dt, t); terminals.update(dt, t);
  state.stage?.update(dt, t);
  cullLabels(dt); patrol(dt);
});
setInterval(() => { refreshKPIs(); refreshAlerts(); refreshFlows(); refreshHubs(); if (state.focused) refreshFocusPanel(); }, 1000);

// ---------- 启动 ----------
buildScene(generateData());
try { const saved = JSON.parse(sessionStorage.getItem('netview.state') || 'null'); if (saved?.layer) state.layer = saved.layer; sessionStorage.removeItem('netview.state'); } catch {}
applyVisibility(true); refreshLayerTabs(); refreshKPIs();
frameLayer(state.layer, 0.01);
startSimulation(data, api);
app.start();
