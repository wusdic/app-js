# 全网业务运行态势 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的一个模块区域，浅色界面。**与上级目录的深色大屏版本完全独立**：不共享代码、样式、数据与依赖，可单独安装、构建与嵌入。

## 看什么

- **三层平台**：核心 / 重要 / 一般三层圆形平台上下叠放，业务按部门相邻排在平台的同心环上；平台有厚度与投影，层右缘标注数量与异常数。
- **业务节点**：白底色环的悬浮圆点（支柱落在平台上），颜色即级别；异常时色环与角标变为告警橙 / 故障红，平台上周期扩散涟漪。核心业务常驻名称，其它层在选中该层、悬停或异常时显示。
- **连接与数据流转**：有连接即有一条极淡的底线；正在流转的连接整条点亮，颜色从发送端渐变到接收端，虚线沿数据方向流动（双向连接两股反向交错），接收端有实心箭头“进入”业务，发送端有一枚空心出口环。每一次数据往来，发送端泛出一圈、按线长延时后接收端亮起，看得清谁发、谁收。故障连接红色慢速呼吸；临时连接为虚线，淡入淡出。也可切换为彗星光点模式（`flowStyle: 'comet'` 或 `setFlowStyle('comet')`）。
- **终端**：每个业务周围有环绕的微粒，数量随在线终端数变化，缓慢巡行、明暗起伏。
- **交互**：拖动旋转（松手有惯性，空闲 2.5 秒后缓慢自转）；悬停业务显示信息浮层并高亮其关系，其余压暗；点击锁定，镜头轻推近并居中，弹出玻璃质感的详情卡（可用性 / 时延 / 请求量 / 终端、上下游关系）；Esc、再次点击或点空白处解除。
- **层级切换**：头部分段控件「全部 / 核心 / 重要 / 一般」，非当前层虚化但仍可见，异常业务保持清晰。
- **开场**：平台自下而上生成、节点弹入、连线通电，约 2 秒；系统开启「减少动态效果」时跳过并停用自转。
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
const mod = createTopologyModule(document.getElementById('topology'), { data, layer: 'all', autoRotate: true, intro: true, flowStyle: 'dash', onSelect: (b) => {} });
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
| `setFlowStyle('dash' \| 'comet')` | 流转表现：流向虚线（默认）/ 彗星光点 |
| `destroy()` | 卸载模块，释放监听与渲染循环 |

## 结构

```
console-topology/
  index.html              演示页（浅色页框）
  src/main.js             演示页入口：挂载模块 + 启动模拟器
  src/page.css            演示页框样式
  src/topology/index.js   模块：DOM 构建、交互、悬浮卡、状态条、对外接口
  src/topology/scene.js   2.5D 画布渲染：投影、平台、节点、弧线、流光、涟漪、终端微粒、开场
  src/topology/data.js    模拟数据与实时事件模拟器
  src/topology/style.css  模块样式（ct- 前缀）
```

渲染为纯 Canvas 2D，无第三方运行时依赖；开发 / 构建仅依赖 Vite。
