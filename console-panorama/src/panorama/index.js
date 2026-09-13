// 模块入口：容器内构建 DOM（头部、左右信息栏、画布、中心盘、悬浮提示），接管交互与渲染循环，暴露数据接口
import { Ring, LEVELS, LEVEL_NAME, COLORS } from './ring.js';
import './style.css';

const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };
const WEIGHT = { core: { critical: 9, warning: 3 }, important: { critical: 5, warning: 2 }, general: { critical: 2, warning: 1 } };
const fmt = (n) => Number(n).toLocaleString('zh-CN');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createPanoramaModule(container, { data, intro = true, onSelect } = {}) {
  container.classList.add('pr-module');
  container.innerHTML = `
    <div class="pr-head">
      <div class="pr-title"><h2>全网业务全景</h2><span class="pr-live"><i></i>实时</span><span class="pr-clock"></span></div>
      <div class="pr-tools">
        <div class="pr-legend">${LEVELS.map((lv) => `<span><i style="--c:${COLORS.level[lv]}"></i>${LEVEL_NAME[lv]}</span>`).join('')}<span><i style="--c:${COLORS.status.warning}"></i>告警</span><span><i style="--c:${COLORS.status.critical}"></i>故障</span></div>
        <label class="pr-switch"><input type="checkbox" id="pr-only-active" /><span></span>只看流转中</label>
      </div>
    </div>
    <div class="pr-body">
      <aside class="pr-side pr-left"><div class="pr-side-title">层级健康</div><div class="pr-levels"></div><div class="pr-side-title">最近事件</div><ul class="pr-events"></ul></aside>
      <div class="pr-stage">
        <canvas class="pr-canvas" aria-label="全网业务全景环"></canvas>
        <div class="pr-center"></div>
        <div class="pr-tip" hidden></div>
        <div class="pr-hint">悬停查看关系 · 点击锁定 · Esc 返回</div>
      </div>
      <aside class="pr-side pr-right"><div class="pr-side-title">实时流转 <b class="pr-flow-n"></b></div><ul class="pr-flows"></ul><div class="pr-side-title">在线终端</div><div class="pr-terms"></div></aside>
    </div>`;
  const $ = (sel) => container.querySelector(sel);
  const canvas = $('.pr-canvas'), stage = $('.pr-stage'), center = $('.pr-center'), tip = $('.pr-tip');
  const ring = new Ring(canvas);
  ring.setData(data);
  const history = []; // 健康度历史（每 10 秒）
  const events = []; // 最近事件
  refreshScore();
  if (intro) ring.startIntro();

  // ---- 尺寸 ----
  const fit = () => { const r = stage.getBoundingClientRect(); if (r.width && r.height) { ring.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1)); const d = ring.discR() * 2; center.style.width = center.style.height = `${d}px`; center.style.left = `${ring.cx}px`; center.style.top = `${ring.cy}px`; } };
  const ro = new ResizeObserver(fit); ro.observe(stage); fit();

  // ---- 交互 ----
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setHover = (s) => {
    const id = s ? s.id : null; if (id === ring.hover) return;
    ring.hover = id; canvas.style.cursor = id ? 'pointer' : 'default';
    if (!ring.pinned) ring.spot = id ? ring.spotlightFor(id) : null;
    if (id && id !== ring.pinned) { tip.innerHTML = tipHtml(s); tip.hidden = false; } else tip.hidden = true;
  };
  canvas.addEventListener('pointermove', (e) => { const p = pos(e); setHover(ring.hitTest(p.x, p.y)); if (!tip.hidden) placeTip(p); });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('click', (e) => { const p = pos(e); const s = ring.hitTest(p.x, p.y); pin(s && s.id !== ring.pinned ? s.id : null); });
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') pin(null); });
  function placeTip(p) { const w = tip.offsetWidth, h = tip.offsetHeight; let x = p.x + 16, y = p.y - h / 2; if (x + w > ring.W - 8) x = p.x - 16 - w; y = Math.max(8, Math.min(ring.H - h - 8, y)); tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; }
  function pin(id) {
    ring.pinned = id; ring.spot = id ? ring.spotlightFor(id) : ring.hover ? ring.spotlightFor(ring.hover) : null;
    tip.hidden = true; renderCenter();
    onSelect?.(id ? ring.segById.get(id).b : null);
  }
  function tipHtml(s) {
    const b = s.b, ls = ring.linksOf(s.id), active = ls.filter((l) => l.active).length;
    return `<div class="pr-tip-name"><i style="--c:${COLORS.level[s.level]}"></i>${esc(b.name)}<span class="pr-chip ${b.status}">${STATUS_NAME[b.status]}</span></div>
      <div class="pr-tip-meta">${LEVEL_NAME[s.level]} · ${esc(b.dept)} · ${ls.length} 条连接，${active} 条流转中 · 终端 ${fmt(b.terminals)}</div>`;
  }

  // ---- 中心盘：默认全网健康度，锁定后为该业务 ----
  function renderCenter() {
    const id = ring.pinned;
    if (!id) {
      const prev = history.length > 1 ? history[0] : ring.score; const d = Math.round(ring.score - prev);
      const abn = data.businesses.filter((b) => b.status !== 'normal').length;
      center.innerHTML = `<div class="pr-score"><b class="pr-score-n">${Math.round(ring.scoreShown)}</b><span>全网健康度</span></div>
        <div class="pr-score-sub">${abn ? `<em class="${data.businesses.some((b) => b.status === 'critical') ? 'crit' : 'warn'}">${abn} 个业务异常</em>` : '<em class="ok">全部正常</em>'}${history.length > 1 ? ` · 较 10 分钟前 ${d > 0 ? '▲' : d < 0 ? '▼' : '—'} ${Math.abs(d)}` : ''}</div>`;
      center.classList.remove('biz'); return;
    }
    const s = ring.segById.get(id), b = s.b, ls = ring.linksOf(id);
    const up = ls.filter((l) => l.b.id === id || l.l.dir === 2).length, down = ls.filter((l) => l.a.id === id || l.l.dir === 2).length;
    center.classList.add('biz');
    center.innerHTML = `<button type="button" class="pr-close" aria-label="返回全网">×</button>
      <div class="pr-biz-name"><i style="--c:${COLORS.level[s.level]}"></i>${esc(b.name)}</div>
      <div class="pr-biz-meta"><span class="pr-chip ${b.status}">${STATUS_NAME[b.status]}</span>${LEVEL_NAME[s.level]} · ${esc(b.dept)}</div>
      <div class="pr-biz-grid"><div><b>${b.metrics.avail}%</b><span>可用性</span></div><div><b>${b.metrics.latency}<small>ms</small></b><span>时延</span></div><div><b>${fmt(b.metrics.rps)}</b><span>请求/秒</span></div></div>
      <div class="pr-biz-rel">上游 ${up} · 下游 ${down} · 终端 ${fmt(b.terminals)}</div>`;
    center.querySelector('.pr-close').addEventListener('click', () => pin(null));
  }

  // ---- 左右信息栏 ----
  const levelsEl = $('.pr-levels'), eventsEl = $('.pr-events'), flowsEl = $('.pr-flows'), flowN = $('.pr-flow-n'), termsEl = $('.pr-terms');
  function refreshSides() {
    levelsEl.innerHTML = LEVELS.map((lv) => {
      const list = data.businesses.filter((b) => b.level === lv), n = list.length, w = list.filter((b) => b.status === 'warning').length, c = list.filter((b) => b.status === 'critical').length, ok = n - w - c;
      const flows = ring.links.filter((l) => l.active && (l.a.level === lv || l.b.level === lv)).length;
      return `<div class="pr-level"><div class="pr-level-row"><i style="--c:${COLORS.level[lv]}"></i><span>${LEVEL_NAME[lv]}</span><b>${ok}<small>/${n}</small></b></div>
        <div class="pr-bar"><i style="width:${(ok / n) * 100}%;background:${COLORS.level[lv]}"></i><i style="width:${(w / n) * 100}%;background:${COLORS.status.warning}"></i><i style="width:${(c / n) * 100}%;background:${COLORS.status.critical}"></i></div>
        <div class="pr-level-sub">${flows} 条流转中${w + c ? ` · <em>${w + c} 个异常</em>` : ''}</div></div>`;
    }).join('');
    const act = ring.links.filter((l) => l.active).sort((a, b) => b.l.rate - a.l.rate);
    flowN.textContent = act.length;
    flowsEl.innerHTML = act.slice(0, 7).map((l) => `<li data-link="${l.id}"><i style="--c:${COLORS.level[l.a.level]}"></i><span class="pr-flow-a">${esc(l.a.b.name)}</span><span class="pr-flow-dir">${l.l.dir === 2 ? '⇄' : '→'}</span><span class="pr-flow-b">${esc(l.b.b.name)}</span><em>${l.l.rate}/min</em></li>`).join('') + (act.length > 7 ? `<li class="pr-more">还有 ${act.length - 7} 条</li>` : '');
    const total = data.businesses.reduce((s, b) => s + b.terminals, 0);
    const top = data.businesses.slice().sort((a, b) => b.terminals - a.terminals).slice(0, 4);
    termsEl.innerHTML = `<div class="pr-terms-total"><b>${fmt(total)}</b><span>在线</span></div>` + top.map((b) => `<div class="pr-term-row"><span>${esc(b.name)}</span><i><u style="width:${(b.terminals / top[0].terminals) * 100}%;background:${COLORS.level[b.level]}"></u></i><b>${fmt(b.terminals)}</b></div>`).join('');
    eventsEl.innerHTML = events.slice(0, 4).map((e) => `<li class="${e.status}"><i></i><span>${esc(e.text)}</span><em>${e.at}</em></li>`).join('') || '<li class="pr-empty">暂无事件</li>';
  }
  flowsEl.addEventListener('pointerover', (e) => { const li = e.target.closest('li[data-link]'); if (!li) return; const l = ring.linkById.get(li.dataset.link); if (l && !ring.pinned) ring.spot = { anchor: null, nodes: new Set([l.a.id, l.b.id]), links: new Set([l.id]) }; });
  flowsEl.addEventListener('pointerleave', () => { if (!ring.pinned) ring.spot = ring.hover ? ring.spotlightFor(ring.hover) : null; });

  function refreshScore() {
    let score = 100; for (const b of data.businesses) if (b.status !== 'normal') score -= WEIGHT[b.level][b.status];
    ring.score = Math.max(0, score);
  }
  const clockEl = $('.pr-clock');
  const tick = () => { const d = new Date(); clockEl.textContent = d.toLocaleTimeString('zh-CN', { hour12: false }); };
  tick();

  // ---- 渲染循环 ----
  let raf = 0, last = performance.now(), acc = 0, hist = 0, alive = true, lastD = 0;
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ring.update(dt); ring.draw();
    { const d = ring.discR() * 2; if (Math.abs(d - lastD) > 0.5) { lastD = d; center.style.width = center.style.height = `${d}px`; } }
    if (!ring.pinned) { const n = center.querySelector('.pr-score-n'); if (n) n.textContent = Math.round(ring.scoreShown); }
    if ((acc += dt) > 0.7) { acc = 0; refreshSides(); tick(); }
    if ((hist += dt) > 10) { hist = 0; history.unshift(ring.score); if (history.length > 60) history.pop(); if (!ring.pinned) renderCenter(); }
    raf = requestAnimationFrame(frame);
  };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  renderCenter(); refreshSides();
  raf = requestAnimationFrame(frame);
  $('#pr-only-active').addEventListener('change', (e) => { ring.onlyActive = e.target.checked; });

  // ---- 对外接口 ----
  const api = {
    ring, data,
    focus: (id) => pin(ring.segById.has(id) ? id : null),
    unfocus: () => pin(null),
    touch: (linkId, dir = 1) => ring.touch(linkId, dir),
    setLinkActive: (linkId, on) => ring.setActive(linkId, on),
    setBusinessStatus: (id, status, message) => {
      const s = ring.segById.get(id); if (!s) return; const prev = s.b.status; s.b.status = status; ring.retarget(s); refreshScore();
      if (prev !== status) { const at = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }); events.unshift({ status, text: status === 'normal' ? `${s.b.name} 已恢复` : `${s.b.name} ${STATUS_NAME[status]}${message ? `：${message}` : ''}`, at }); if (events.length > 12) events.pop(); }
      if (ring.pinned === id || !ring.pinned) renderCenter(); refreshSides();
    },
    setLinkStatus: (linkId, status) => { const l = ring.linkById.get(linkId); if (l) l.l.status = status; },
    setTerminals: (id, count) => { const s = ring.segById.get(id); if (s) ring.setTerminalCount(s, count); },
    setOnlyActive: (on) => { ring.onlyActive = !!on; $('#pr-only-active').checked = !!on; },
    destroy: () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); container.innerHTML = ''; container.classList.remove('pr-module'); },
  };
  return api;
}
