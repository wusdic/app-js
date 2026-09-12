# 全网业务运行态势 · 3D 可视化

面向领导层的全网业务态势总览页面：分层星空风格，Three.js 实现。

- **宏观视角**：核心 / 重要 / 一般三层业务圆盘自上而下堆叠。业务系统建模为「六边形底座 + 悬浮旋转的线框多面体」（核心：二十面体 + 轨道弧环；重要：二十面体；一般：八面体），接入终端以环绕底座的"尘埃"密度表示在线数量。
- **连接与数据流转**：有数据往来的连接整条点亮，线上是缓慢定向流动的虚线段，终点有箭头指向（双向连接两端都有）；一段时间无数据即熄灭、只剩极淡底线，临时连接随后自动消失；故障连接即便无数据也保持可见并闪烁。悬停任一业务或连接会"聚光"：只保留相关的连接与对端，其余压暗；右侧"实时数据流转"列表按频次列出当前正在流转的连接（谁 → 谁 · 频次），悬停行即在 3D 中高亮，点击可固定。
- **局部视角**：点击任一业务，相机推近并展开以该业务为中心的"舞台"：内环为组件（含组件间调用关系），外环为本地终端，边缘"出口"示意与其他业务 / 远端终端的连接（远端业务不在本视角展开，点击出口可跳转）。
- **异常警示**：业务或连接异常时以琥珀色（告警）/ 红色（故障）区分，节点出现扩散警示环，连线闪烁；右侧"异常关注"列表按严重程度与业务级别排序，点击可定位。
- **悬浮信息**：鼠标移到业务、连接、组件、终端、出口上，显示半透明信息框。
- **交互**：拖拽旋转、滚轮缩放、右键平移；空闲 20 秒后恢复缓慢自动旋转；`Esc` 返回全网。

## 运行

```bash
npm install
npm run dev      # 开发：http://localhost:5173
npm run build    # 构建到 dist/（纯静态文件，可部署到任意内网静态服务器或 Nginx 子目录）
npm run preview  # 本地预览构建产物
```

无外部网络依赖：所有贴图为程序生成，字体使用系统字体（PingFang / 微软雅黑 / Noto Sans CJK）。

## 目录结构

```
src/
  main.js              入口：搭建场景、聚焦 / 返回逻辑、对外 API
  config.js            主题色、层布局、连接规则（流光间隔、空闲阈值）
  core/App.js          渲染器、相机、轨道控制、辉光后期、拾取与主循环
  core/Tween.js        极简补间
  core/textures.js     程序化光晕贴图
  scene/Starfield.js   星空背景
  scene/Layers.js      三层圆盘（雷达刻度网格）与环形排布算法
  scene/SystemModel.js 业务系统模型（六边形底座 + 线框多面体），全局节点与局部舞台中心共用
  scene/BusinessNode.js 业务节点（系统模型 + 标签 + 警示环）
  scene/FlowTube.js    连接管线（着色器实现定向流动虚线 + 方向箭头）
  scene/LinkSystem.js  连接管理：活跃 / 空闲 / 临时连接生命周期
  scene/TerminalCloud.js 全局终端粒子云（GPU 计算轨道）
  scene/FocusStage.js  局部舞台：组件环、本地终端、出口
  ui/Tooltip.js        悬浮信息框
  ui/Panels.js         顶部 KPI、聚焦面板、告警列表、控制条
  data/mock.js         模拟数据与实时事件模拟器
```

## 接入真实数据

页面把所有运行时入口挂在 `window.NetView` 上，`src/data/mock.js` 中的 `startSimulation` 就是通过这套 API 驱动画面的。接真实系统时，用 WebSocket / 轮询拿到事件后调用同样的方法即可：

```js
const v = window.NetView;

// 连接上产生一次数据往来（dir: 1 = from→to，-1 = 反向）。首次调用点亮连接并开始定向流动；停止调用 6 秒后自动熄灭
v.touchLink('l12', 1);

// 建立临时连接（两业务之间原本没有连接）；无数据 14 秒后自动消失。返回连接 id
const id = v.addTransientLink('general-3', 'core-0', '文件传输');

// 业务 / 连接状态：'normal' | 'warning' | 'critical'，message 会显示在告警列表与信息框
v.setBusinessStatus('core-4', 'warning', '响应时延升高，P95 > 800ms');
v.setLinkStatus('l12', 'critical', '链路中断');

// 终端数量：直接修改业务对象的 terminals.local / terminals.remote，然后调用
v.data.businesses[0].terminals.local = 1280;
v.setTerminals();

// 终端接入事件（仅在该业务处于局部视角时产生动效）
v.terminalEvent('core-1', 'local');   // 'local' | 'remote'

// 定位 / 返回 / 聚光
v.focus('core-1');
v.unfocus();
v.spotlight('node', 'core-1');   // 只看某业务的关系；v.spotlight('link', 'l12') 只看某条连接；v.spotlight(null) 取消
```

静态数据结构（业务、组件、连接）见 `src/data/mock.js` 的 `generateData`，替换为后端返回的同构数据即可。业务 `level` 取值 `core | important | general`，每层的位置由 `scene/Layers.js` 自动按环形排布。

## 主要可调参数（`src/config.js`）

| 参数 | 说明 |
| --- | --- |
| `THEME.level / status / link` | 各级别、状态、连接的颜色 |
| `LAYOUT.layers.*.y / radius / rings` | 各层高度、圆盘半径、节点环半径 |
| `LAYOUT.camera / focus` | 默认视角、聚焦时相机相对偏移 |
| `LINK_RULES.idleAfter` | 无数据多久后连接熄灭（秒） |
| `LINK_RULES.transientRemoveAfter` | 临时连接无数据多久后移除（秒） |
| `LINK_RULES.idleAlpha` | 无数据时底线的亮度（0 为完全隐藏） |
| `LINK_RULES.dashSpacing / flowSpeed` | 流动虚线段的间距与速度 |

底部控制条可关闭辉光（低配机器）、终端显示与自动旋转。
