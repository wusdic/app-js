# 全网业务运行态势 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的一个模块区域，浅色界面，视觉模式为**「业务版图」**：一块悬浮的玻璃版图，按部门划分街区，每个业务是一座楼，数据在楼顶之间以光带飞行。**与上级目录的深色大屏版本完全独立**：不共享代码、样式、数据与依赖，视觉语言也不同（大屏是三层圆盘金字塔，这里是等距 3D 版图），可单独安装、构建与嵌入。

## 看什么

- **版图与街区**：版图是一块带厚度与投影的悬浮玻璃板，顶面有细网格，每 11 秒一道斜向高光扫过；按部门划分为最多 6 个街区（略微抬起的圆角平台），街区前缘标注部门、业务数与异常数。
- **业务楼体**：每个业务是一座方块楼，高度即级别（核心高、重要中、一般低），顶面渐变、侧面按受光 / 背光自动分级，脚下有接触阴影；街区内核心楼在后排、一般楼在前排。异常时楼体整体变为告警橙 / 故障红，楼顶升起一枚起伏的菱形信标，脚下周期扩散涟漪。核心楼常驻名称，其它在选中该层、悬停或异常时显示。
- **连接与数据流转**：有连接即有一条极淡的底线，持续流转的连接是一条从发送端色渐变到接收端色的细线，接收端有一枚小箭头“进入”业务（连线从楼顶出发、落到楼顶）。每一次数据往来是一条**填充光带**：从发送端注满到接收端（时长随线长），到达时接收端一圈光收拢进楼体、楼顶亮起并轻弹一下，停留片刻后光带从发送端一侧排空、最后消失在接收端——整段光带始终可见，起点与终点一目了然；发送端脚下同时泛出一圈。光带中点会短暂标出「发送方 → 接收方」（全局约 1.6 秒最多一枚，悬停 / 锁定时相关连接都标）。故障连接红色慢速呼吸；临时连接为虚线，淡入淡出。也可切换为流向虚线模式（`flowStyle: 'dash'` 或 `setFlowStyle('dash')`）。
- **终端**：每座楼周围的街区地面上有游走的微粒，数量随在线终端数变化，明暗起伏。
- **交互**：拖动旋转版图（松手有惯性，空闲 2.5 秒后缓慢自转）；悬停业务楼体轻轻抬起、显示信息浮层并高亮其关系，其余压暗；点击锁定，镜头轻推近并居中，弹出玻璃质感的详情卡（可用性 / 时延 / 请求量 / 终端、上下游关系）；Esc、再次点击或点空白处解除。
- **层级切换**：头部分段控件「全部 / 核心 / 重要 / 一般」，非当前层虚化但仍可见，异常业务保持清晰。
- **开场**：版图浮现、街区依次抬起、楼体逐座拔起、连线通电，约 2.6 秒；系统开启「减少动态效果」时跳过并停用自转。
- **底部状态**：数据流转中的连接数、异常数（含故障数）、在线终端总数。

## 运行

```bash
cd console-topology
npm install
npm run dev       # 开发：http://localhost:5173
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/topology/`。

## 嵌入到管理前台

```js
import { createTopologyModule } from './topology/index.js';   // 自带样式（类名均以 ct- 前缀）
import { generateData, startSimulation } from './topology/data.js';

const data = generateData();                        // 或替换为真实数据：{ businesses: [...], links: [...] }
const mod = createTopologyModule(document.getElementById('topology'), { data, layer: 'all', autoRotate: true, intro: true, flowStyle: 'wave', onSelect: (b) => {} });
const stop = startSimulation(mod, data);            // 演示用模拟器；接入真实事件时不需要
```

容器只需一个空元素，高度由模块自适应（默认 `clamp(460px, 58vw, 640px)`，可用 CSS 覆盖 `.ct-module { height: ... }`）。

数据结构：

```js
business: { id, name, level: 'core'|'important'|'general', status: 'normal'|'warning'|'critical', dept, owner,
            metrics: { avail, latency, rps }, terminals, components }
link:     { id, from, to, dir: 1 | 2 /* 单向 / 双向 */, status }
```

接口（`mod.*`）：

| 方法 | 说明 |
| --- | --- |
| `touch(linkId, dir = 1)` | 该连接有数据往来：放出一道流光（dir = -1 为反向） |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转状态（常亮 + 箭头） |
| `setBusinessStatus(id, status)` | 业务状态变化，颜色平滑过渡并触发涟漪 |
| `setLinkStatus(linkId, status)` | 连接状态变化 |
| `addTransientLink(from, to, ttl = 10, dir = 1)` | 临时连接，ttl 秒后自动消失 |
| `setTerminals(id, count)` | 更新在线终端数（微粒数量随之变化） |
| `setLayer('all' \| 'core' \| 'important' \| 'general')` | 层级切换 |
| `focus(id)` / `unfocus()` | 锁定 / 解除某业务 |
| `setAutoRotate(on)` / `resetView()` | 自转开关 / 重置视角 |
| `setFlowStyle('wave' \| 'dash')` | 流转表现：填充光带（默认）/ 流向虚线 |
| `destroy()` | 卸载模块，释放监听与渲染循环 |

## 结构

```
console-topology/
  index.html              演示页（浅色页框）
  src/main.js             演示页入口：挂载模块 + 启动模拟器
  src/page.css            演示页框样式
  src/topology/index.js   模块：DOM 构建、交互、悬浮卡、状态条、对外接口
  src/topology/scene.js   等距 3D 画布渲染：投影、版图 / 街区 / 楼体（可见面判定与受光分级）、楼顶光弧与填充光带、信标、涟漪、终端微粒、开场
  src/topology/data.js    模拟数据与实时事件模拟器
  src/topology/style.css  模块样式（ct- 前缀）
```

渲染为纯 Canvas 2D，无第三方运行时依赖；开发 / 构建仅依赖 Vite。
