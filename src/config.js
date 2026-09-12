// 主题与布局常量：改这里即可整体换色 / 调整层间距
export const THEME = {
  bg: 0x050914,
  level: { core: 0x8af2ff, important: 0x4fb3ff, general: 0x6f8fd0 },
  status: { warning: 0xffb547, critical: 0xff4d6a },
  link: { normal: 0x3aa6ff, transient: 0x8ed6ff, warning: 0xffb547, critical: 0xff4d6a },
  terminal: 0x9ad1ff,
  disc: { core: 0x63c9ff, important: 0x4b8fff, general: 0x4f6fc9 },
  stage: 0x4fd9c8,
};

export const LEVELS = ['core', 'important', 'general'];
export const LEVEL_NAME = { core: '核心业务', important: '重要业务', general: '一般业务' };
export const STATUS_NAME = { normal: '正常', warning: '告警', critical: '故障' };

export const LAYOUT = {
  layers: {
    core: { y: 18, radius: 20, rings: [9, 15.5], label: '核心业务层', en: 'CORE', view: { dist: 76, elev: 0.9 } },
    important: { y: 0, radius: 25, rings: [11, 20], label: '重要业务层', en: 'IMPORTANT', view: { dist: 94, elev: 0.62 } },
    general: { y: -18, radius: 35, rings: [13, 22.5, 31], label: '一般业务层', en: 'GENERAL', view: { dist: 120, elev: 0.58 } },
  },
  nodeRadius: { core: 1.6, important: 1.2, general: 0.95 },
  camera: { position: [0, 60, 98], target: [0, 0, 0] }, // 查看全部时的视角
  defaultLayer: 'core', // 默认查看的层级：core | important | general | all
  focus: { offset: [0, 30, 50] },
};

// 连接行为：底线常亮，有数据时辉光沿线飞过；一段时间无数据视为熄灭；临时连接随后消失
export const LINK_RULES = {
  idleAfter: 6, // 秒：超过此时间无数据 → 不再视为活跃（箭头隐藏）
  transientRemoveAfter: 12, // 秒：临时连接无数据后移除
  pulseGap: 2.2, // 秒：同一连接两道辉光的最小间隔（持续有数据 ≈ 每 2.2s 一道）
  pulseSpeed: 0.5, // 辉光每秒行进的曲线比例
  tail: 0.22, // 辉光尾巴长度（曲线比例）
  // 底线亮度：intra = 两端都在当前层；cross = 一端在当前层；other = 与当前层无关；all = 查看全部时
  base: { intra: 0.3, cross: 0.1, other: 0.012, all: 0.06 },
};

export const colorOf = {
  business: (b) => (b.status === 'critical' ? THEME.status.critical : b.status === 'warning' ? THEME.status.warning : THEME.level[b.level]),
  link: (l) => (l.status === 'critical' ? THEME.link.critical : l.status === 'warning' ? THEME.link.warning : l.transient ? THEME.link.transient : THEME.link.normal),
};
