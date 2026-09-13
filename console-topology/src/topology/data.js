// 模拟数据：三级业务 + 1:1 / 1:N / N:N 连接 + 实时事件模拟器（与大屏版本互不依赖）
const CORE = ['统一身份认证', '核心交换总线', '主数据中心', '支付清算', '综合业务门户', '调度指挥平台', '统一消息平台', '核心数据库集群', '视频会议', '目录与域名服务'];
const IMPORTANT = ['人力资源', '财务管理', '资产管理', '办公自动化', '电子邮件', '工作流引擎', '文件存储', '培训平台', '移动办公', '客户服务', '采购管理', '合同管理'];
const GENERAL = ['车辆管理', '门禁考勤', '食堂管理', '宿舍管理', '图书馆', '停车管理', '报修系统', '访客预约', '会议室预订', '招聘系统', '档案查询', '问卷调查', '内部论坛', '失物招领', '班车查询', '活动报名'];
const DEPTS = ['信息中心', '运行保障部', '业务运营部', '安全保卫部', '综合办公室', '财务部'];
const OWNERS = ['王工', '李工', '张工', '刘工', '陈工', '赵工', '孙工', '周工'];

export const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function generateData() {
  const businesses = [];
  const mk = (level, names, prefix) => names.forEach((name, i) => businesses.push({
    id: `${prefix}${i + 1}`, name, level, status: 'normal',
    dept: DEPTS[(i + names.length) % DEPTS.length], owner: OWNERS[i % OWNERS.length],
    metrics: { avail: +(99.5 + Math.random() * 0.49).toFixed(2), latency: Math.round(level === 'core' ? rand(40, 120) : rand(80, 320)), rps: Math.round(level === 'core' ? rand(1500, 9000) : level === 'important' ? rand(200, 1500) : rand(20, 300)) },
    terminals: Math.round(level === 'core' ? rand(600, 2400) : level === 'important' ? rand(150, 700) : rand(20, 160)),
    components: Math.round(level === 'core' ? rand(5, 9) : rand(3, 6)),
  }));
  mk('core', CORE, 'c'); mk('important', IMPORTANT, 'i'); mk('general', GENERAL, 'g');
  const byLevel = (lv) => businesses.filter((b) => b.level === lv);
  const links = []; const seen = new Set(); let n = 0;
  const add = (a, b, dir = 1, extra = {}) => {
    if (a === b) return; const key = a < b ? `${a}|${b}` : `${b}|${a}`; if (seen.has(key)) return; seen.add(key);
    links.push({ id: `l${++n}`, from: a, to: b, dir, status: 'normal', duty: { on: rand(4, 9), off: rand(10, 24) }, ...extra });
  };
  const cores = byLevel('core'), imps = byLevel('important'), gens = byLevel('general');
  // 核心之间：1:1 与总线星型
  cores.forEach((c, i) => { add(c.id, cores[(i + 1) % cores.length].id, 2); if (i > 1) add(cores[1].id, c.id, 2); });
  add(cores[0].id, cores[2].id, 1); add(cores[3].id, cores[7].id, 2); add(cores[4].id, cores[0].id, 1);
  // 核心 → 重要：1:N
  imps.forEach((im, i) => { add(cores[i % 4].id, im.id, 1); if (i % 3 === 0) add(im.id, cores[7].id, 2); if (i % 4 === 1) add(cores[0].id, im.id, 1); });
  // 重要 ↔ 一般：N:N
  gens.forEach((g, i) => { add(imps[i % imps.length].id, g.id, 2); if (i % 2 === 0) add(imps[(i * 5 + 3) % imps.length].id, g.id, 1); if (i % 5 === 0) add(cores[0].id, g.id, 1); });
  return { businesses, links };
}

// 实时模拟：连接按占空比通断、放出数据流；随机业务异常与恢复；临时连接；终端波动
export function startSimulation(api, data) {
  const links = data.links, biz = data.businesses;
  const state = new Map(links.map((l) => [l.id, { on: Math.random() < 0.3, until: rand(1, 12), next: rand(0.3, 4) }]));
  for (const [id, s] of state) api.setLinkActive(id, s.on);
  const incidents = new Map(); // bizId → until
  let t = 0, last = performance.now(), nextIncident = 6, nextTransient = 9, nextDrift = 2;
  const timer = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.5, (now - last) / 1000); last = now; t += dt;
    for (const l of links) {
      const s = state.get(l.id); s.until -= dt;
      if (s.until <= 0) { s.on = !s.on; s.until = s.on ? l.duty.on : l.duty.off; if (l.status === 'critical') s.on = false; api.setLinkActive(l.id, s.on); }
      if (s.on) { s.next -= dt; if (s.next <= 0) { api.touch(l.id, l.dir === 2 ? (Math.random() < 0.5 ? 1 : -1) : 1); s.next = rand(3.5, 8); } }
    }
    for (const [id, until] of incidents) if (t > until) { incidents.delete(id); api.setBusinessStatus(id, 'normal'); const l = links.find((x) => x.status !== 'normal' && (x.from === id || x.to === id)); if (l) api.setLinkStatus(l.id, 'normal'); }
    if (t > nextIncident) {
      nextIncident = t + rand(10, 22);
      const b = pick(biz.filter((x) => !incidents.has(x.id)));
      if (b) { const critical = Math.random() < 0.3; api.setBusinessStatus(b.id, critical ? 'critical' : 'warning'); incidents.set(b.id, t + rand(18, 40)); if (critical) { const l = links.find((x) => x.from === b.id || x.to === b.id); if (l) api.setLinkStatus(l.id, 'critical'); } }
    }
    if (t > nextTransient) { nextTransient = t + rand(8, 16); const a = pick(biz), b = pick(biz); if (a !== b) api.addTransientLink(a.id, b.id, 10); }
    if (t > nextDrift) { nextDrift = t + 1.2; for (const b of biz) if (Math.random() < 0.25) api.setTerminals(b.id, Math.max(5, Math.round(b.terminals * rand(0.985, 1.015)))); }
  }, 120);
  return () => clearInterval(timer);
}
