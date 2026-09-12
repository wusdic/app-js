// 主题与布局常量：改这里即可整体换色 / 调整层间距 / 调整连接与告警节律
export const THEME = {
  bg: 0x050914,
  level: { core: 0x8ae9ff, important: 0x4fb3ff, general: 0x6f8fd0 },
  status: { warning: 0xffb547, critical: 0xff4d6a },
  link: { normal: 0x3aa6ff, transient: 0x3aa6ff, warning: 0xffb547, critical: 0xff4d6a },
  terminal: 0x7fa9d6,
  disc: { core: 0x63c9ff, important: 0x4b8fff, general: 0x4f6fc9 },
  stage: 0x4fd9c8,
  hdrGain: 1.45, // 状态色与流转辉光在 HDR 缓冲里的增益：让“异常”和“正在流转”成为画面最亮的元素
};

export const LEVELS = ['core', 'important', 'general'];
export const LEVEL_NAME = { core: '核心业务', important: '重要业务', general: '一般业务' };
export const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };
export const TERMINAL_TYPES = ['办公 PC', '移动终端', '自助终端', '物联设备', '专用终端'];

export const LAYOUT = {
  layers: {
    core: { y: 18, radius: 20, rings: [9, 15.5], label: '核心业务层', en: 'CORE', view: { dist: 76, elev: 0.9 } },
    important: { y: 0, radius: 25, rings: [11, 20], label: '重要业务层', en: 'IMPORTANT', view: { dist: 94, elev: 0.62 } },
    general: { y: -18, radius: 35, rings: [13, 22.5, 31], label: '一般业务层', en: 'GENERAL', view: { dist: 120, elev: 0.58 } },
  },
  nodeRadius: { core: 1.6, important: 1.2, general: 0.95 },
  camera: { position: [0, 57, 94], target: [0, 0, 0] }, // 全景视角（默认）
  defaultLayer: 'core', // 页面打开时默认的重点层级：core | important | general | all（其它层虚化）
  ghost: { node: 0.4, abnormalNode: 0.78, disc: 0.55 }, // 虚化层的可见度
  intro: { enabled: true, camDistance: 1.45, camLift: 0.12 }, // 开场：逐步生成 + 轻微推进
  focus: { offset: [0, 30, 50], fov: 36 },
};

// 连接行为：底线常亮，有数据时辉光沿线飞过（世界单位：所有连线同速同长）；一段时间无数据视为熄灭；临时连接随后消失
export const LINK_RULES = {
  idleAfter: 6, // 秒（墙钟）：超过此时间无数据 → 不再视为活跃
  transientRemoveAfter: 12, // 秒：临时连接无数据后移除
  pulseGap: 2.2, // 秒：同一连接两道辉光的最小间隔
  pulseSpeedUnits: 14, // 辉光速度（世界单位 / 秒）
  tailUnits: 5, // 辉光尾巴长度（世界单位）
  arrowInset: 0.9, // 方向箭头距端点的距离（世界单位）
  // 底线亮度：intra = 两端都在当前层；cross = 一端在当前层；other = 与当前层无关；all = 查看全部；spot = 聚光中的连线
  base: { intra: 0.3, cross: 0.1, other: 0.035, all: 0.06, spot: 0.36 },
};

// 告警节律：全站只有一种慢速“心跳”（快起慢落），不做 1Hz 以上的频闪
export const ALARM = { critical: 3.0, warning: 4.5 };
export const heartbeat = (t, period) => { const f = (t % period) / period; return (1 - f) * (1 - f); };

// 健康度评分：100 − 各层异常的加权扣分（链路告警按两端较高层级取半权）
export const HEALTH_WEIGHTS = { core: { critical: 30, warning: 10 }, important: { critical: 10, warning: 4 }, general: { critical: 4, warning: 1 } };

// 画质：渲染分辨率上限（宽度像素）、自适应降级阈值
export const QUALITY = { maxRenderWidth: 2560, degradeMs: 22, recoverMs: 9 }; // 阈值针对每帧主线程工作时长（毫秒）

export const colorOf = {
  business: (b) => (b.status === 'critical' ? THEME.status.critical : b.status === 'warning' ? THEME.status.warning : THEME.level[b.level]),
  link: (l) => (l.status === 'critical' ? THEME.link.critical : l.status === 'warning' ? THEME.link.warning : l.transient ? THEME.link.transient : THEME.link.normal),
};

// 稳定的伪随机相位：同一个 id 每次刷新都一样
export function hashPhase(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000 * Math.PI * 2; }
