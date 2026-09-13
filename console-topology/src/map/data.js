// 模拟数据：六个业务域，每个域有其所属业务；域内 / 跨域连接；实时事件模拟器
export const DOMAINS = [
  { id: 'core', name: '核心支撑域', short: '核心支撑', color: '#2f5fe8', desc: '身份、交换、主数据与消息等基础能力' },
  { id: 'mgmt', name: '经营管理域', short: '经营管理', color: '#149c9a', desc: '人、财、物与采购合同' },
  { id: 'collab', name: '办公协同域', short: '办公协同', color: '#7a5af5', desc: '办公、邮件、会议与流程' },
  { id: 'security', name: '安全保障域', short: '安全保障', color: '#d64b8d', desc: '安全监测、门禁与应急指挥' },
  { id: 'service', name: '民生服务域', short: '民生服务', color: '#31a35a', desc: '后勤、出行与生活服务' },
  { id: 'data', name: '数据与门户域', short: '数据门户', color: '#5b6b8f', desc: '门户、报表、分析与档案' },
];
const BIZ = {
  core: [['统一身份认证', 5], ['核心交换总线', 5], ['主数据中心', 4], ['核心数据库集群', 4], ['统一消息平台', 3], ['目录与域名服务', 2], ['支付清算', 4]],
  mgmt: [['财务管理', 4], ['人力资源', 3], ['资产管理', 2], ['采购管理', 2], ['合同管理', 2], ['预算管理', 3]],
  collab: [['办公自动化', 4], ['电子邮件', 3], ['工作流引擎', 4], ['视频会议', 3], ['文件存储', 3], ['移动办公', 5], ['即时通讯', 4]],
  security: [['安全态势监测', 4], ['门禁考勤', 3], ['访客预约', 1], ['视频监控', 4], ['调度指挥平台', 3], ['应急广播', 1]],
  service: [['食堂管理', 2], ['宿舍管理', 1], ['车辆管理', 2], ['停车管理', 2], ['报修系统', 1], ['班车查询', 1], ['活动报名', 1], ['图书馆', 1]],
  data: [['综合业务门户', 5], ['数据分析平台', 4], ['报表中心', 3], ['档案查询', 2], ['培训平台', 2], ['客户服务', 3]],
};
const DEPTS = ['信息中心', '运行保障部', '业务运营部', '安全保卫部', '综合办公室', '财务部'];
const OWNERS = ['王工', '李工', '张工', '刘工', '陈工', '赵工', '孙工', '周工'];
export const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function generateData() {
  const businesses = [];
  let k = 0;
  for (const d of DOMAINS) BIZ[d.id].forEach(([name, scale], i) => businesses.push({
    id: `${d.id}-${i + 1}`, name, domain: d.id, scale, status: 'normal',
    dept: DEPTS[(k++) % DEPTS.length], owner: OWNERS[k % OWNERS.length],
    metrics: { avail: +(99.5 + Math.random() * 0.49).toFixed(2), latency: Math.round(rand(40, 90) + (5 - scale) * 40), rps: Math.round(scale * scale * rand(120, 380)) },
    terminals: Math.round(scale * scale * rand(45, 110)), components: Math.round(rand(3, 4 + scale)),
  }));
  const byDomain = (id) => businesses.filter((b) => b.domain === id);
  const links = [], seen = new Set(); let n = 0;
  const add = (a, b, dir = 1) => { if (a === b) return; const key = a < b ? `${a}|${b}` : `${b}|${a}`; if (seen.has(key)) return; seen.add(key); links.push({ id: `l${++n}`, from: a, to: b, dir, status: 'normal', duty: { on: rand(3, 9), off: rand(7, 18) } }); };
  const core = byDomain('core');
  // 域内：链式 + 少量随机
  for (const d of DOMAINS) { const list = byDomain(d.id); list.forEach((b, i) => { add(b.id, list[(i + 1) % list.length].id, 2); if (i % 3 === 0) add(b.id, pick(list).id, 1); }); }
  // 跨域：核心域 → 各域（1:N）、各域 → 核心（N:1）、非核心域之间少量
  for (const d of DOMAINS) { if (d.id === 'core') continue; byDomain(d.id).forEach((b, i) => { add(core[i % core.length].id, b.id, 1); if (i % 2 === 0) add(b.id, core[0].id, 2); if (i % 3 === 1) add(b.id, core[1].id, 1); }); }
  add('mgmt-1', 'data-2', 1); add('collab-1', 'mgmt-2', 2); add('security-1', 'data-1', 1); add('service-3', 'security-2', 2); add('collab-6', 'data-1', 1); add('mgmt-6', 'data-3', 1); add('security-5', 'collab-4', 2);
  return { domains: DOMAINS, businesses, links };
}

// 实时模拟：连接按占空比通断并放出流光；随机业务异常与恢复；临时连接；终端波动
export function startSimulation(api, data) {
  const links = data.links, biz = data.businesses;
  const st = new Map(links.map((l) => [l.id, { on: Math.random() < 0.22, until: rand(1, 8), next: rand(0.3, 1.5) }]));
  for (const [id, s] of st) api.setLinkActive(id, s.on);
  const incidents = new Map();
  let t = 0, last = performance.now(), nextIncident = 5, nextTransient = 12, nextDrift = 2;
  const timer = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.5, (now - last) / 1000); last = now; t += dt;
    for (const l of links) {
      const s = st.get(l.id); s.until -= dt;
      if (s.until <= 0) { s.on = !s.on && l.status !== 'critical'; s.until = s.on ? l.duty.on : l.duty.off; api.setLinkActive(l.id, s.on); }
      if (s.on) { s.next -= dt; if (s.next <= 0) { api.touch(l.id, l.dir === 2 && Math.random() < 0.5 ? -1 : 1); s.next = rand(1.4, 3.2); } }
    }
    for (const [id, until] of incidents) if (t > until) { incidents.delete(id); api.setBusinessStatus(id, 'normal'); for (const l of links) if (l.status !== 'normal' && (l.from === id || l.to === id)) api.setLinkStatus(l.id, 'normal'); }
    if (t > nextIncident) {
      nextIncident = t + rand(9, 20);
      const b = pick(biz.filter((x) => !incidents.has(x.id)));
      if (b) { const critical = Math.random() < 0.3; api.setBusinessStatus(b.id, critical ? 'critical' : 'warning'); incidents.set(b.id, t + rand(16, 36)); if (critical) { const l = links.find((x) => x.from === b.id || x.to === b.id); if (l) api.setLinkStatus(l.id, 'critical'); } }
    }
    if (t > nextTransient) { nextTransient = t + rand(9, 18); const a = pick(biz), b = pick(biz); if (a !== b) api.addTransientLink(a.id, b.id, 9); }
    if (t > nextDrift) { nextDrift = t + 1.5; for (const b of biz) if (Math.random() < 0.3) api.setTerminals(b.id, Math.max(5, Math.round(b.terminals * rand(0.985, 1.015)))); }
  }, 120);
  return () => clearInterval(timer);
}
