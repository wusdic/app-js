// 模拟数据：按业务区域组织的业务、区域内外的连接（含 1:1 与 N:N），以及实时事件模拟器
// 区域（zone）是管理前台的分组单位：核心平台、门户与指挥、综合办公、人财物、园区安防、公共服务
export const LEVELS = ['core', 'important', 'general'];
export const LEVEL_NAME = { core: '核心', important: '重要', general: '一般' };
export const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };

const ZONES = [
  { id: 'core', name: '核心平台区', en: 'CORE PLATFORM', accent: 'cobalt', biz: [
    ['统一身份认证', 'core', 'gateway'], ['核心交换总线', 'core', 'bus'], ['主数据中心', 'core', 'db'], ['统一消息平台', 'core', 'msg'], ['核心数据库集群', 'core', 'db'], ['目录与域名服务', 'core', 'dns'],
  ] },
  { id: 'portal', name: '门户与指挥区', en: 'PORTAL & COMMAND', accent: 'sky', biz: [
    ['综合业务门户', 'core', 'portal'], ['调度指挥平台', 'core', 'command'], ['视频会议', 'core', 'video'], ['支付清算', 'core', 'pay'], ['安全态势监测', 'important', 'shield'],
  ] },
  { id: 'office', name: '综合办公区', en: 'OFFICE', accent: 'mint', biz: [
    ['办公自动化', 'important', 'doc'], ['电子邮件', 'important', 'mail'], ['工作流引擎', 'important', 'flow'], ['文件存储', 'important', 'storage'], ['移动办公', 'important', 'mobile'], ['会议室预订', 'general', 'calendar'], ['内部论坛', 'general', 'chat'], ['问卷调查', 'general', 'doc'],
  ] },
  { id: 'hr', name: '人财物管理区', en: 'HR · FINANCE · ASSETS', accent: 'lilac', biz: [
    ['人力资源', 'important', 'people'], ['财务管理', 'important', 'finance'], ['资产管理', 'important', 'asset'], ['采购管理', 'important', 'cart'], ['合同管理', 'important', 'doc'], ['招聘系统', 'general', 'people'], ['培训平台', 'general', 'video'], ['档案查询', 'general', 'storage'],
  ] },
  { id: 'campus', name: '园区与安防区', en: 'CAMPUS & SECURITY', accent: 'amber', biz: [
    ['门禁考勤', 'important', 'shield'], ['车辆管理', 'general', 'car'], ['停车管理', 'general', 'car'], ['访客预约', 'general', 'calendar'], ['报修系统', 'general', 'tool'], ['能耗监测', 'general', 'bolt'],
  ] },
  { id: 'service', name: '公共服务区', en: 'PUBLIC SERVICE', accent: 'peach', biz: [
    ['客户服务', 'important', 'chat'], ['食堂管理', 'general', 'food'], ['宿舍管理', 'general', 'home'], ['图书馆', 'general', 'book'], ['班车查询', 'general', 'bus'], ['活动报名', 'general', 'calendar'], ['失物招领', 'general', 'search'],
  ] },
];
const DEPTS = ['信息中心', '运行保障部', '业务运营部', '安全保卫部', '综合办公室', '财务部', '后勤服务部'];
const OWNERS = ['王工', '李工', '张工', '刘工', '陈工', '赵工', '孙工', '周工'];
export const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 区域数与每区业务数可按实际情况给定（演示：?zones=4&max=5）；布局由模块按数据动态计算
export function generateData({ zones: zoneCount = ZONES.length, maxPerZone = Infinity } = {}) {
  const zones = [], businesses = [];
  ZONES.slice(0, Math.max(1, zoneCount)).forEach((z, zi) => {
    const zone = { id: z.id, name: z.name, en: z.en, businesses: [] };
    z.biz.slice(0, Math.max(1, maxPerZone)).forEach(([name, level, kind], i) => {
      const b = { id: `${z.id}-${i + 1}`, name, level, kind, zone: z.id, status: 'normal', dept: DEPTS[(zi + i) % DEPTS.length], owner: OWNERS[(zi * 3 + i) % OWNERS.length],
        metrics: { avail: +(99.5 + Math.random() * 0.49).toFixed(2), latency: Math.round(level === 'core' ? rand(40, 120) : rand(80, 320)), rps: Math.round(level === 'core' ? rand(1500, 9000) : level === 'important' ? rand(200, 1500) : rand(20, 300)) },
        terminals: Math.round(level === 'core' ? rand(600, 2400) : level === 'important' ? rand(150, 700) : rand(20, 160)), components: Math.round(level === 'core' ? rand(5, 9) : rand(3, 6)) };
      zone.businesses.push(b.id); businesses.push(b);
    });
    zones.push(zone);
  });
  const byName = (n) => businesses.find((b) => b.name === n)?.id;
  const links = []; const seen = new Set(); let n = 0;
  const add = (a, b, dir = 1) => { if (!a || !b || a === b) return; const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (seen.has(k)) return; seen.add(k); links.push({ id: `l${++n}`, from: a, to: b, dir, status: 'normal', duty: { on: rand(6, 16), off: rand(4, 12) } }); };
  const auth = byName('统一身份认证'), bus = byName('核心交换总线'), mdm = byName('主数据中心'), msg = byName('统一消息平台'), dbc = byName('核心数据库集群'), dns = byName('目录与域名服务');
  // 核心平台内部：总线星型 + 认证 / 目录 / 数据库
  for (const x of [auth, mdm, msg, dbc, dns]) add(bus, x, 2);
  add(auth, dns, 1); add(mdm, dbc, 2); add(msg, dbc, 1);
  // 门户与指挥 ↔ 核心
  add(byName('综合业务门户'), auth, 1); add(byName('综合业务门户'), bus, 2); add(byName('调度指挥平台'), bus, 2); add(byName('调度指挥平台'), msg, 1);
  add(byName('视频会议'), byName('调度指挥平台'), 2); add(byName('支付清算'), dbc, 2); add(byName('支付清算'), bus, 1); add(byName('安全态势监测'), auth, 1);
  // 综合办公：认证 / 消息 / 存储
  const office = ['办公自动化', '电子邮件', '工作流引擎', '文件存储', '移动办公', '会议室预订', '内部论坛', '问卷调查'].map(byName);
  office.forEach((id, i) => { if (i < 5) add(auth, id, 1); if (i % 2 === 0) add(id, msg, 2); });
  add(office[0], office[2], 2); add(office[2], office[3], 1); add(office[4], office[1], 2); add(office[5], office[0], 1); add(office[6], office[1], 1); add(office[7], office[2], 1);
  // 人财物：主数据 / 总线 / 工作流
  const hr = ['人力资源', '财务管理', '资产管理', '采购管理', '合同管理', '招聘系统', '培训平台', '档案查询'].map(byName);
  hr.forEach((id, i) => { if (i < 4) add(mdm, id, 2); if (i === 1) add(id, byName('支付清算'), 2); if (i > 4) add(hr[0], id, 1); });
  add(hr[3], hr[1], 1); add(hr[4], hr[3], 1); add(hr[2], hr[1], 1); add(hr[1], office[2], 1); add(hr[7], byName('文件存储'), 2);
  // 园区安防：认证 / 消息 / 指挥
  const campus = ['门禁考勤', '车辆管理', '停车管理', '访客预约', '报修系统', '能耗监测'].map(byName);
  add(campus[0], auth, 2); add(campus[0], hr[0], 1); add(campus[1], campus[2], 2); add(campus[3], campus[0], 1); add(campus[3], msg, 1); add(campus[4], msg, 1); add(campus[5], byName('调度指挥平台'), 1); add(campus[0], byName('安全态势监测'), 1);
  // 公共服务：认证 / 消息 / 支付
  const svc = ['客户服务', '食堂管理', '宿舍管理', '图书馆', '班车查询', '活动报名', '失物招领'].map(byName);
  add(svc[0], msg, 2); add(svc[0], byName('综合业务门户'), 1); add(svc[1], byName('支付清算'), 2); add(svc[2], campus[0], 1); add(svc[3], auth, 1); add(svc[4], msg, 1); add(svc[5], svc[0], 1); add(svc[6], svc[0], 1); add(svc[2], hr[0], 1);
  return { zones, businesses, links };
}

// 实时模拟：连接按占空比通断并放出数据包；随机业务异常与恢复；临时连接；终端波动
export function startSimulation(api, data) {
  const links = data.links, biz = data.businesses;
  const st = new Map(links.map((l) => [l.id, { on: Math.random() < 0.4, until: rand(1, 8), next: rand(0.3, 1.6) }]));
  for (const [id, s] of st) api.setLinkActive(id, s.on);
  const incidents = new Map();
  let t = 0, last = performance.now(), nextIncident = 5, nextTransient = 9, nextDrift = 2;
  const timer = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.5, (now - last) / 1000); last = now; t += dt;
    for (const l of links) {
      const s = st.get(l.id); s.until -= dt;
      if (s.until <= 0) { s.on = !s.on; s.until = s.on ? l.duty.on : l.duty.off; if (l.status === 'critical') s.on = false; api.setLinkActive(l.id, s.on); }
      if (s.on) { s.next -= dt; if (s.next <= 0) { api.touch(l.id, l.dir === 2 ? (Math.random() < 0.5 ? 1 : -1) : 1); s.next = rand(1.4, 3.2); } }
    }
    for (const [id, until] of incidents) if (t > until) { incidents.delete(id); api.setBusinessStatus(id, 'normal'); for (const l of links) if (l.status !== 'normal' && (l.from === id || l.to === id)) api.setLinkStatus(l.id, 'normal'); }
    if (t > nextIncident) {
      nextIncident = t + rand(10, 22);
      const b = pick(biz.filter((x) => !incidents.has(x.id)));
      if (b) { const critical = Math.random() < 0.3; api.setBusinessStatus(b.id, critical ? 'critical' : 'warning'); incidents.set(b.id, t + rand(20, 45)); if (critical) { const l = links.find((x) => x.from === b.id || x.to === b.id); if (l) api.setLinkStatus(l.id, 'critical'); } }
    }
    if (t > nextTransient) { nextTransient = t + rand(9, 18); const a = pick(biz), b = pick(biz); if (a !== b && a.zone !== b.zone) api.addTransientLink(a.id, b.id, 9); }
    if (t > nextDrift) { nextDrift = t + 1.5; for (const b of biz) if (Math.random() < 0.3) api.setTerminals(b.id, Math.max(5, Math.round(b.terminals * rand(0.985, 1.015)))); }
  }, 120);
  return () => clearInterval(timer);
}
