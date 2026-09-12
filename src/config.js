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
    core: { y: 18, radius: 20, rings: [9, 15.5], label: '核心业务层', en: 'CORE' },
    important: { y: 0, radius: 25, rings: [11, 20], label: '重要业务层', en: 'IMPORTANT' },
    general: { y: -18, radius: 35, rings: [13, 22.5, 31], label: '一般业务层', en: 'GENERAL' },
  },
  nodeRadius: { core: 1.6, important: 1.2, general: 0.95 },
  camera: { position: [0, 60, 98], target: [0, 0, 0] },
  focus: { offset: [0, 30, 50] },
};

// 连接行为：有数据 → 整条点亮并定向流动；多久没有数据就熄灭；临时连接多久消失
export const LINK_RULES = {
  idleAfter: 6, // 秒：超过此时间无数据 → 熄灭，只剩底线
  transientRemoveAfter: 12, // 秒：临时连接无数据后移除
  idleAlpha: 0.035, // 无数据时底线的亮度（0 = 完全隐藏）
  dashSpacing: 2.6, // 流动虚线段的间距（世界单位）
  flowSpeed: 1.2, // 每秒移动的段数
};

export const colorOf = {
  business: (b) => (b.status === 'critical' ? THEME.status.critical : b.status === 'warning' ? THEME.status.warning : THEME.level[b.level]),
  link: (l) => (l.status === 'critical' ? THEME.link.critical : l.status === 'warning' ? THEME.link.warning : l.transient ? THEME.link.transient : THEME.link.normal),
};
