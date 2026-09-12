import { LEVEL_NAME, STATUS_NAME } from '../config.js';

// 半透明悬浮信息框：跟随鼠标，靠近边缘自动翻转
const tag = (cls, text) => `<span class="tag ${cls}">${text}</span>`;
const row = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
const stCls = (s) => (s === 'normal' ? 'ok' : s);

export class Tooltip {
  constructor(el) { this.el = el; }

  show(html, px) {
    const el = this.el;
    el.innerHTML = html;
    el.classList.remove('hidden');
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = px.x + 18, y = px.y + 18;
    if (x + w > window.innerWidth - 12) x = px.x - w - 18;
    if (y + h > window.innerHeight - 12) y = px.y - h - 18;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  hide() { this.el.classList.add('hidden'); }

  business(b, px, ctx) {
    if (!b) return this.hide();
    const rel = ctx.links.linksOf(b.id);
    const active = rel.filter((l) => l.active).length;
    this.show(`
      <div class="tt-head"><span class="tt-name">${b.name}</span>${tag(b.level, LEVEL_NAME[b.level])}${tag(b.status, STATUS_NAME[b.status])}</div>
      <div class="tt-grid">
        ${row('主管部门', `${b.dept} · ${b.owner}`)}
        ${row('可用性', `${b.metrics.availability}%`, b.status === 'critical' ? 'critical' : 'ok')}
        ${row('响应时延', `${b.status === 'warning' ? b.metrics.latency * 6 : b.metrics.latency} ms`, b.status === 'warning' ? 'warning' : '')}
        ${row('请求量', `${b.metrics.qps.toLocaleString()} /s`)}
        ${row('在线终端', `本地 ${b.terminals.local.toLocaleString()} · 远端 ${b.terminals.remote.toLocaleString()}`)}
        ${row('关联业务', `${rel.length} 条连接 · ${active} 条活跃`)}
        ${row('组件', `${b.components.length} 个`)}
      </div>
      ${b.statusMessage ? `<div class="tt-foot" style="color:var(--${b.status})">⚠ ${b.statusMessage}</div>` : '<div class="tt-foot">点击查看局部关系</div>'}`, px);
  }

  link(rec, px, ctx) {
    if (!rec) return this.hide();
    const A = ctx.nodes.get(rec.from)?.data, B = ctx.nodes.get(rec.to)?.data;
    const idle = Math.max(0, ctx.links.time - rec.lastActive);
    this.show(`
      <div class="tt-head"><span class="tt-name">${A?.name} ${rec.bidirectional ? '⇄' : '→'} ${B?.name}</span>${tag(rec.status, STATUS_NAME[rec.status])}</div>
      <div class="tt-grid">
        ${row('连接类型', `${rec.type}${rec.transient ? ' · 临时连接' : ''}`)}
        ${row('近 1 分钟', `${ctx.links.ratePerMin(rec)} 次数据往来`)}
        ${row('当前状态', rec.active ? `正在流转 · 持续 ${Math.round(ctx.links.time - rec.activeSince)} 秒` : '无数据', rec.active ? 'ok' : '')}
        ${row('最近活动', rec.lastActive < 0 ? '暂无' : idle < 1 ? '刚刚' : `${Math.round(idle)} 秒前`)}
        ${row('累计', `${rec.count.toLocaleString()} 次`)}
      </div>
      ${rec.statusMessage ? `<div class="tt-foot" style="color:var(--${rec.status})">⚠ ${rec.statusMessage}</div>` : ''}`, px);
  }

  component(c, px, b) {
    if (!c) return this.hide();
    this.show(`
      <div class="tt-head"><span class="tt-name">${c.name}</span>${tag(c.status, STATUS_NAME[c.status])}</div>
      <div class="tt-grid">
        ${row('所属业务', b.name)}
        ${row('实例数', `${c.instances}`)}
        ${row('CPU', `${c.cpu}%`, c.cpu > 85 ? 'warning' : '')}
        ${row('内存', `${c.mem}%`)}
      </div>`, px);
  }

  terminal(t, px, b) {
    if (!t) return this.hide();
    this.show(`
      <div class="tt-head"><span class="tt-name">终端 ${t.id}</span>${tag('normal', t.type)}</div>
      <div class="tt-grid">
        ${row('地址', t.ip)}
        ${row('接入组件', `${b.name} · ${t.comp.data.name}`)}
        ${row('会话', '本地接入 · 临时')}
      </div>`, px);
  }

  portal(p, px, b, ctx) {
    if (!p) return this.hide();
    const o = p.other.data, rec = p.rec;
    const dir = rec.bidirectional ? '⇄' : rec.from === b.id ? '→' : '←';
    this.show(`
      <div class="tt-head"><span class="tt-name">${b.name} ${dir} ${o.name}</span>${tag(o.level, LEVEL_NAME[o.level])}${tag(rec.status, STATUS_NAME[rec.status])}</div>
      <div class="tt-grid">
        ${row('连接类型', `${rec.type}${rec.transient ? ' · 临时连接' : ''}`)}
        ${row('近 1 分钟', `${ctx.links.ratePerMin(rec)} 次数据往来`)}
        ${row('对端状态', STATUS_NAME[o.status], stCls(o.status))}
      </div>
      <div class="tt-foot">远端业务不在本视角展开 · 点击跳转</div>`, px);
  }

  remoteTerminals(b, px) {
    if (!b) return this.hide();
    this.show(`
      <div class="tt-head"><span class="tt-name">远端终端</span>${tag('normal', '示意')}</div>
      <div class="tt-grid">
        ${row('在线数量', b.terminals.remote.toLocaleString())}
        ${row('接入方式', '经其他业务区 / 汇聚接入')}
      </div>
      <div class="tt-foot">来自其他业务区的终端，仅以出口示意</div>`, px);
  }
}
