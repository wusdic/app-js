// 模拟数据：六个业务区域及各自的业务、业务之间的连接；实时事件模拟器（与其它版本互不依赖）
export const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const OWNERS = ['王工', '李工', '张工', '刘工', '陈工', '赵工', '孙工', '周工'];

const ZONES = [
  { id: 'hub', name: '核心枢纽区', desc: '身份、交换、门户与消息：全网业务共用的公共基座', color: '#3b6cf6', x: -8.4, z: -3.9, cols: 3, dept: '信息中心' },
  { id: 'data', name: '数据服务区', desc: '主数据、数据库、存储与数据交换', color: '#2ba4e8', x: 0, z: -3.9, cols: 3, dept: '数据管理部' },
  { id: 'ops', name: '经营管理区', desc: '财务、支付、资产、采购与合同', color: '#8257f0', x: 8.4, z: -3.9, cols: 3, dept: '经营管理部' },
  { id: 'office', name: '办公协同区', desc: 'OA、邮件、会议、流程与移动办公', color: '#0ea5a4', x: -8.4, z: 3.9, cols: 4, dept: '综合办公室' },
  { id: 'sec', name: '安全保障区', desc: '态势监测、门禁、访客、监控与审计', color: '#2fa66a', x: 0, z: 3.9, cols: 3, dept: '安全保卫部' },
  { id: 'campus', name: '园区服务区', desc: '车辆、餐饮、住宿、报修与预订', color: '#d9569c', x: 8.4, z: 3.9, cols: 4, dept: '后勤服务部' },
];
const BIZ = {
  hub: [['统一身份认证', 'core'], ['核心交换总线', 'core'], ['综合业务门户', 'core'], ['统一消息平台', 'core'], ['调度指挥平台', 'core'], ['目录与域名服务', 'important']],
  data: [['主数据中心', 'core'], ['核心数据库集群', 'core'], ['数据交换平台', 'important'], ['文件存储', 'important'], ['数据报表', 'general'], ['档案查询', 'general']],
  ops: [['支付清算', 'core'], ['财务管理', 'important'], ['资产管理', 'important'], ['采购管理', 'important'], ['人力资源', 'important'], ['合同管理', 'general']],
  office: [['视频会议', 'core'], ['办公自动化', 'important'], ['电子邮件', 'important'], ['工作流引擎', 'important'], ['移动办公', 'important'], ['培训平台', 'general'], ['内部论坛', 'general'], ['会议室预订', 'general']],
  sec: [['安全态势监测', 'core'], ['门禁考勤', 'important'], ['视频监控', 'important'], ['应急指挥', 'important'], ['访客预约', 'general'], ['审计日志', 'general']],
  campus: [['车辆管理', 'general'], ['食堂管理', 'general'], ['宿舍管理', 'general'], ['停车管理', 'general'], ['报修系统', 'general'], ['班车查询', 'general'], ['活动报名', 'general'], ['图书馆', 'general']],
};
// 连接：[起点, 终点, 方向 1 单向 / 2 双向]，按名称书写便于阅读
const LINKS = [
  ['核心交换总线', '统一身份认证', 2], ['核心交换总线', '综合业务门户', 2], ['核心交换总线', '统一消息平台', 1], ['调度指挥平台', '核心交换总线', 2], ['目录与域名服务', '核心交换总线', 1],
  ['统一身份认证', '办公自动化', 1], ['统一身份认证', '财务管理', 1], ['统一身份认证', '门禁考勤', 1], ['统一身份认证', '移动办公', 1], ['统一身份认证', '车辆管理', 1], ['统一身份认证', '主数据中心', 1],
  ['核心交换总线', '主数据中心', 2], ['核心交换总线', '数据交换平台', 2], ['核心交换总线', '支付清算', 2], ['核心交换总线', '安全态势监测', 1], ['核心交换总线', '工作流引擎', 2],
  ['综合业务门户', '办公自动化', 1], ['综合业务门户', '数据报表', 1], ['综合业务门户', '会议室预订', 1], ['综合业务门户', '报修系统', 1],
  ['统一消息平台', '电子邮件', 1], ['统一消息平台', '移动办公', 1], ['统一消息平台', '应急指挥', 1], ['统一消息平台', '班车查询', 1],
  ['调度指挥平台', '应急指挥', 2], ['调度指挥平台', '视频监控', 1], ['调度指挥平台', '视频会议', 1],
  ['主数据中心', '核心数据库集群', 2], ['主数据中心', '财务管理', 2], ['主数据中心', '人力资源', 2], ['主数据中心', '资产管理', 1], ['数据交换平台', '文件存储', 2], ['核心数据库集群', '支付清算', 2], ['核心数据库集群', '审计日志', 1], ['文件存储', '档案查询', 1], ['数据报表', '数据交换平台', 1],
  ['财务管理', '支付清算', 2], ['采购管理', '合同管理', 2], ['采购管理', '财务管理', 1], ['资产管理', '车辆管理', 1], ['人力资源', '门禁考勤', 2], ['人力资源', '培训平台', 1], ['合同管理', '工作流引擎', 2],
  ['办公自动化', '电子邮件', 2], ['办公自动化', '工作流引擎', 2], ['视频会议', '移动办公', 2], ['移动办公', '会议室预订', 1], ['内部论坛', '电子邮件', 1], ['工作流引擎', '财务管理', 1],
  ['安全态势监测', '审计日志', 1], ['安全态势监测', '视频监控', 2], ['门禁考勤', '访客预约', 2], ['视频监控', '停车管理', 1], ['门禁考勤', '宿舍管理', 1], ['应急指挥', '视频会议', 1],
  ['食堂管理', '宿舍管理', 1], ['停车管理', '车辆管理', 2], ['活动报名', '会议室预订', 1], ['图书馆', '统一身份认证', 1], ['报修系统', '资产管理', 1],
];

export function generateData() {
  const businesses = [];
  for (const z of ZONES) BIZ[z.id].forEach(([name, level], i) => businesses.push({
    id: `${z.id}-${i + 1}`, name, level, zone: z.id, status: 'normal', dept: z.dept, owner: OWNERS[(i + z.id.length) % OWNERS.length],
    metrics: { avail: +(99.5 + Math.random() * 0.49).toFixed(2), latency: Math.round(level === 'core' ? rand(40, 120) : rand(80, 320)), rps: Math.round(level === 'core' ? rand(1800, 9000) : level === 'important' ? rand(300, 1600) : rand(30, 320)) },
    terminals: Math.round(level === 'core' ? rand(600, 2400) : level === 'important' ? rand(150, 700) : rand(20, 180)),
  }));
  const byName = new Map(businesses.map((b) => [b.name, b]));
  const links = LINKS.map(([a, b, dir], i) => ({ id: `l${i + 1}`, from: byName.get(a).id, to: byName.get(b).id, dir, status: 'normal', duty: { on: rand(5, 14), off: rand(3, 10) } }));
  return { zones: ZONES, businesses, links };
}

// 实时模拟：连接按占空比通断并放出数据流；随机异常与恢复；负载与终端波动
export function startSimulation(api, data) {
  const links = data.links, biz = data.businesses;
  const st = new Map(links.map((l) => [l.id, { on: Math.random() < 0.45, until: rand(1, 8), next: rand(0.3, 2) }]));
  for (const [id, s] of st) api.setLinkActive(id, s.on);
  const incidents = new Map();
  let t = 0, last = performance.now(), nextIncident = 5, nextDrift = 2;
  const timer = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.5, (now - last) / 1000); last = now; t += dt;
    for (const l of links) {
      const s = st.get(l.id); s.until -= dt;
      if (s.until <= 0) { s.on = !s.on; if (l.status === 'critical') s.on = false; s.until = s.on ? l.duty.on : l.duty.off; api.setLinkActive(l.id, s.on); }
      if (s.on) { s.next -= dt; if (s.next <= 0) { api.touch(l.id, l.dir === 2 && Math.random() < 0.5 ? -1 : 1); s.next = rand(1.6, 3.4); } }
    }
    for (const [id, until] of incidents) if (t > until) { incidents.delete(id); api.setBusinessStatus(id, 'normal'); for (const l of links) if (l.status !== 'normal' && (l.from === id || l.to === id)) api.setLinkStatus(l.id, 'normal'); }
    if (t > nextIncident) {
      nextIncident = t + rand(9, 20);
      const b = pick(biz.filter((x) => !incidents.has(x.id)));
      if (b) { const critical = Math.random() < 0.3; api.setBusinessStatus(b.id, critical ? 'critical' : 'warning'); incidents.set(b.id, t + rand(16, 36)); if (critical) { const l = links.find((x) => x.from === b.id || x.to === b.id); if (l) api.setLinkStatus(l.id, 'critical'); } }
    }
    if (t > nextDrift) {
      nextDrift = t + 1.5;
      for (const b of biz) { if (Math.random() < 0.35) api.setMetrics(b.id, { rps: Math.max(10, Math.round(b.metrics.rps * rand(0.9, 1.1))) }); if (Math.random() < 0.25) api.setTerminals(b.id, Math.max(5, Math.round(b.terminals * rand(0.985, 1.015)))); }
    }
  }, 120);
  return () => clearInterval(timer);
}
