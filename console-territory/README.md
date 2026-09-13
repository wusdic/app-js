# 全网业务版图 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的模块区域，浅色界面。**与深色大屏版本（仓库根目录）和上一版浅色拓扑模块（`console-topology/`）完全独立**：不共享代码、样式、数据与依赖。

## 设计

一座等轴测的浅色立体沙盘（可拖动旋转）：

- **业务区域**：六个区域各是一块带厚度与投影的圆角基板，颜色即区域（核心枢纽 / 数据服务 / 经营管理 / 办公协同 / 安全保障 / 园区服务），基板前端悬着玻璃质感的区域浮标（名称 · 业务数或异常数）。
- **业务**：区域内每个业务是一块立方体，高度即实时请求量（负载变化时平滑升降、常态微微呼吸），顶面高光、侧面按受光着色。异常业务整块变为告警橙 / 故障红，方块上方悬浮「!」角标，基板上周期扩散涟漪。
- **数据流转**：区域之间是地面通道，有数据往来时一道彗星流沿通道飞向目标区域，到达时目标方块顶面点亮；同区业务之间以短弧跳转。通道活跃度越高越明显。
- **交互**：拖动旋转（带惯性，空闲后极缓慢摆动）；悬停业务显示信息浮层（请求量、时延、可用性、终端、连接数）；点击区域（基板、浮标或头部芯片）聚焦：基板抬升、镜头推近，其它区域淡出，业务名称全部显示，右侧玻璃面板列出该区域业务的级别、负载条与状态；点击画布后滚轮缩放；Esc 或 × 退出。
- **开场**：基板自下而上依次升起、方块弹出、通道画出，约 2.5 秒；系统开启「减少动态效果」时跳过并停用摆动与呼吸。
- **底部状态**：区域数、业务数、流转中连接数、异常数（含故障数）、在线终端总数。

纯 Canvas 2D 渲染，无第三方运行时依赖；字体 Sora + Noto Sans SC。

## 运行

```bash
cd console-territory
npm install
npm run dev       # http://localhost:5173
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/territory/`。

## 嵌入

```js
import { createTerritoryModule } from './territory/index.js';   // 自带样式（类名以 tt- 前缀）
import { generateData, startSimulation } from './territory/data.js';

const data = generateData();                                   // 或替换为真实数据
const mod = createTerritoryModule(document.getElementById('territory'), { data, intro: true, sway: true, onSelect: (zone, business) => {} });
const stop = startSimulation(mod, data);                       // 演示用模拟器；接入真实事件时不需要
```

容器只需一个空元素，默认高度 `clamp(480px, 56vw, 660px)`，可用 CSS 覆盖 `.tt-module { height: ... }`。

数据结构：

```js
zone:     { id, name, desc, color, x, z, cols }          // x / z 为沙盘上的位置（单位：格），cols 为区域内每行方块数
business: { id, name, zone, level: 'core'|'important'|'general', status: 'normal'|'warning'|'critical', dept, owner,
            metrics: { avail, latency, rps }, terminals }
link:     { id, from, to, dir: 1 | 2, status }
```

接口（`mod.*`）：

| 方法 | 说明 |
| --- | --- |
| `touch(linkId, dir = 1)` | 一次数据往来：跨区放出通道流，同区跳一道短弧，到达时目标方块点亮 |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转（计入「流转中」） |
| `setBusinessStatus(id, status)` | 业务状态变化：整块变色、角标与涟漪 |
| `setLinkStatus(linkId, status)` | 连接状态变化 |
| `setMetrics(id, { rps, ... })` | 负载变化：方块高度平滑跟随 |
| `setTerminals(id, count)` | 更新在线终端数 |
| `addLink(link)` / `removeLink(id)` | 动态增删连接 |
| `focusZone(id)` / `unfocus()` | 聚焦 / 退出某区域 |
| `resetView()` / `setSway(on)` | 重置视角 / 空闲摆动开关 |
| `destroy()` | 卸载模块 |

## 结构

```
console-territory/
  index.html               演示页（浅色页框）
  src/main.js              演示页入口：挂载模块 + 启动模拟器
  src/page.css             演示页框样式
  src/territory/index.js   模块：DOM、交互、区域浮标、信息浮层、聚焦面板、状态条、对外接口
  src/territory/scene.js   等轴测渲染：投影与旋转、基板挤出与投影、方块受光着色、通道与流、短弧、涟漪、开场
  src/territory/data.js    六个区域的模拟数据与实时事件模拟器
  src/territory/style.css  模块样式（tt- 前缀）
```
