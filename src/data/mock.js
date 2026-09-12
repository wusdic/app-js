// 模拟数据：业务、组件、连接关系、终端与实时事件
// 真实接入时，只需用同样结构的数据调用 main.js 暴露的 window.NetView API 即可

const CORE = ['统一身份认证', '核心交换总线', '主数据中心', '支付清算', '调度指挥平台', '安全态势监测', '核心数据库集群', '统一消息平台', '容灾备份', '目录与域名服务', '视频会议', '综合业务门户'];
const IMPORTANT = ['电子邮件', '移动办公', '财务管理', '人力资源', '资产管理', '客户服务', '供应链管理', '合同管理', '知识库', '日志审计', '运维监控', '文件存储', '报表分析', '工作流引擎', '短信网关'];
const GENERAL = ['会议预约', '车辆管理', '访客系统', '食堂订餐', '图书管理', '培训平台', '问卷调查', '内部论坛', '停车管理', '打印服务', '门禁考勤', '设备报修', '招聘系统', '档案查询', '宿舍管理', '健康申报', '活动报名', '通知公告', '意见反馈', '电子期刊'];
const DEPTS = ['信息中心', '运营管理部', '财务部', '人力资源部', '安全保卫部', '综合办公室', '业务发展部'];
const OWNERS = ['王工', '李工', '张工', '刘工', '陈工', '赵工', '孙工', '周工'];

const COMP_TEMPLATES = {
  core: [['接入网关', 'gateway'], ['应用集群', 'app'], ['核心数据库', 'db'], ['缓存集群', 'cache'], ['消息队列', 'mq'], ['对象存储', 'storage'], ['调度服务', 'sched']],
  important: [['接入网关', 'gateway'], ['应用服务', 'app'], ['数据库', 'db'], ['缓存', 'cache'], ['文件存储', 'storage']],
  general: [['Web 服务', 'app'], ['数据库', 'db'], ['文件存储', 'storage'], ['定时任务', 'sched']],
};
const COMP_LINKS = [['gateway', 'app'], ['app', 'db'], ['app', 'cache'], ['app', 'mq'], ['app', 'storage'], ['sched', 'db'], ['mq', 'app']];
const LINK_TYPES = ['同步调用', '数据同步', '消息投递', '文件传输', '认证请求'];
const TERMINAL_TYPES = ['办公 PC', '移动终端', '自助终端', '物联设备', '专用终端'];

let seed = 20240912;
export function rand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function makeComponents(level, bid) {
  const list = COMP_TEMPLATES[level].filter((_, i) => level !== 'core' || i < 5 + ri(0, 2));
  return list.map(([name, type], i) => ({
    id: `${bid}-c${i}`, name, type, status: 'normal',
    instances: type === 'app' ? ri(4, 24) : type === 'db' ? ri(2, 6) : ri(2, 12),
    cpu: ri(12, 68), mem: ri(30, 75),
  }));
}

function makeBusiness(name, level, i) {
  const id = `${level}-${i}`;
  const terminalBase = level === 'core' ? ri(320, 1400) : level === 'important' ? ri(120, 520) : ri(30, 220);
  const comps = makeComponents(level, id);
  const clinks = [];
  for (const [a, b] of COMP_LINKS) {
    const ca = comps.find((c) => c.type === a), cb = comps.find((c) => c.type === b);
    if (ca && cb) clinks.push({ from: ca.id, to: cb.id });
  }
  return {
    id, name, level, dept: pick(DEPTS), owner: pick(OWNERS), status: 'normal',
    metrics: { availability: (99.9 + rand() * 0.09).toFixed(2), latency: ri(18, 120), qps: level === 'core' ? ri(800, 6000) : level === 'important' ? ri(200, 1500) : ri(20, 300) },
    components: comps, componentLinks: clinks,
    terminals: { local: terminalBase, remote: Math.round(terminalBase * (0.2 + rand() * 0.6)), types: TERMINAL_TYPES },
    since: `2023-${String(ri(1, 12)).padStart(2, '0')}`,
  };
}

export function generateData() {
  const businesses = [
    ...CORE.map((n, i) => makeBusiness(n, 'core', i)),
    ...IMPORTANT.map((n, i) => makeBusiness(n, 'important', i)),
    ...GENERAL.map((n, i) => makeBusiness(n, 'general', i)),
  ];
  const byLevel = (l) => businesses.filter((b) => b.level === l);
  const cores = byLevel('core'), imps = byLevel('important'), gens = byLevel('general');
  const auth = cores[0], bus = cores[1], data = cores[2], msg = cores[7];

  const links = [];
  const seen = new Set();
  const add = (a, b, type, rate) => {
    if (!a || !b || a === b) return;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ id: `l${links.length}`, from: a.id, to: b.id, type: type || pick(LINK_TYPES), status: 'normal',
      rate: rate ?? 0.15 + rand() * 0.8, bidirectional: rand() < 0.35 });
  };

  // N 对 1：绝大多数业务都依赖统一身份认证
  for (const b of businesses) if (b !== auth && rand() < 0.55) add(b, auth, '认证请求', 0.3 + rand() * 0.6);
  // 1 对 N：核心交换总线连接所有核心与部分重要业务
  for (const c of cores) if (c !== bus) add(bus, c, '数据同步', 0.4 + rand() * 0.8);
  for (const b of imps) if (rand() < 0.5) add(bus, b, '数据同步');
  // 主数据中心 ←→ 核心数据库、容灾（N 对 N）
  add(data, cores[6], '数据同步', 1.0); add(data, cores[8], '数据同步', 0.6); add(cores[6], cores[8], '数据同步', 0.5);
  // 统一消息平台 → 多个业务（1 对 N）
  for (const b of [...imps, ...gens]) if (rand() < 0.25) add(msg, b, '消息投递');
  // 核心之间的少量互联
  for (let i = 0; i < 8; i++) add(pick(cores), pick(cores));
  // 重要 ↔ 一般 / 重要 ↔ 重要
  for (const g of gens) { add(g, pick(imps)); if (rand() < 0.35) add(g, pick(imps)); }
  for (let i = 0; i < 6; i++) add(pick(imps), pick(imps));
  // 一般 ↔ 一般 少量 1 对 1
  for (let i = 0; i < 5; i++) add(pick(gens), pick(gens));
  // N 对 N 对 N：一条链  一般 → 重要 → 核心
  add(gens[3], imps[2], '同步调用', 0.7); add(imps[2], cores[3], '同步调用', 0.9); add(gens[9], imps[2], '同步调用', 0.6);

  return { businesses, links };
}

// ---------- 实时事件模拟 ----------
// api 由 main.js 提供：touchLink / addTransientLink / setBusinessStatus / setLinkStatus / setTerminals / terminalEvent
export function startSimulation(data, api) {
  const { businesses, links } = data;
  const linkState = new Map(links.map((l) => [l.id, { on: true, until: 0 }]));
  const transient = [];
  const anomalies = [];
  let t = 0;
  let nextTransient = 4, nextAnomaly = 6;

  const ANOMALY_TEMPLATES = {
    business: [
      ['warning', '响应时延升高，P95 > 800ms'], ['warning', '可用性下降至 99.5%'], ['critical', '服务不可用，健康检查失败'],
      ['warning', 'CPU 使用率持续 > 90%'], ['critical', '数据库主节点失联'],
    ],
    link: [['warning', '链路丢包率 3.2%'], ['critical', '链路中断，重试失败'], ['warning', '调用超时率上升']],
  };

  function raiseAnomaly() {
    const isLink = rand() < 0.35;
    if (isLink) {
      const l = pick(links);
      if (l.status !== 'normal') return;
      const [status, msg] = pick(ANOMALY_TEMPLATES.link);
      api.setLinkStatus(l.id, status, msg);
      anomalies.push({ kind: 'link', id: l.id, until: t + 30 + rand() * 60 });
    } else {
      const b = pick(businesses);
      if (b.status !== 'normal') return;
      const [status, msg] = pick(ANOMALY_TEMPLATES.business);
      api.setBusinessStatus(b.id, status, msg);
      anomalies.push({ kind: 'business', id: b.id, until: t + 35 + rand() * 70 });
    }
  }

  // 初始：一个核心业务告警 + 一条重要链路故障，便于演示
  api.setBusinessStatus(businesses[4].id, 'warning', '响应时延升高，P95 > 800ms');
  anomalies.push({ kind: 'business', id: businesses[4].id, until: 60 + rand() * 40 });
  const l0 = links.find((l) => l.from === 'important-3' || l.to === 'important-3') || links[5];
  api.setLinkStatus(l0.id, 'critical', '链路中断，重试失败');
  anomalies.push({ kind: 'link', id: l0.id, until: 75 + rand() * 40 });

  const STEP = 0.25;
  const timer = setInterval(() => {
    t += STEP;
    // 1) 常规连接：按各自频率触发数据事件；偶尔整体静默一段时间 → 流光消失
    for (const l of links) {
      const s = linkState.get(l.id);
      if (t > s.until) { s.on = rand() < 0.82; s.until = t + 6 + rand() * 20; }
      if (s.on && rand() < l.rate * STEP) api.touchLink(l.id, l.bidirectional && rand() < 0.4 ? -1 : 1);
    }
    // 2) 临时连接：随机在两个未连接的业务间建立，短暂活跃后自动消失
    if (t > nextTransient) {
      nextTransient = t + 5 + rand() * 9;
      const a = pick(businesses), b = pick(businesses);
      if (a !== b) {
        const id = api.addTransientLink(a.id, b.id, pick(LINK_TYPES));
        if (id) transient.push({ id, until: t + 8 + rand() * 20, rate: 0.6 + rand() });
      }
    }
    for (let i = transient.length - 1; i >= 0; i--) {
      const tr = transient[i];
      if (t > tr.until) { transient.splice(i, 1); continue; }
      if (rand() < tr.rate * STEP) api.touchLink(tr.id, 1);
    }
    // 3) 终端：数量缓慢波动，并产生远端终端接入事件
    if (Math.floor(t / STEP) % 4 === 0) {
      for (const b of businesses) {
        const drift = 1 + (rand() - 0.5) * 0.06;
        b.terminals.local = Math.max(10, Math.round(b.terminals.local * drift));
        b.terminals.remote = Math.max(5, Math.round(b.terminals.remote * (1 + (rand() - 0.5) * 0.08)));
      }
      api.setTerminals();
    }
    if (rand() < 0.5) api.terminalEvent(pick(businesses).id, rand() < 0.6 ? 'local' : 'remote');
    // 4) 异常：随机产生与恢复
    if (t > nextAnomaly) { nextAnomaly = t + 20 + rand() * 30; raiseAnomaly(); }
    for (let i = anomalies.length - 1; i >= 0; i--) {
      const a = anomalies[i];
      if (t > a.until) {
        anomalies.splice(i, 1);
        if (a.kind === 'link') api.setLinkStatus(a.id, 'normal'); else api.setBusinessStatus(a.id, 'normal');
      }
    }
  }, STEP * 1000);

  return () => clearInterval(timer);
}

export const TERMINAL_TYPES_LIST = TERMINAL_TYPES;
