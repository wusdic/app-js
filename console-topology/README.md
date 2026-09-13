# 全网业务版图 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的一个模块区域，浅色界面。**与上级目录的深色大屏版本完全独立**：不共享代码、样式、数据与依赖，可单独安装、构建与嵌入。

## 设计

- **正向俯视的立体园区**：六块**磨砂玻璃**平台按 3 × 2 正向排列在柔和渐变的地面上（轻微透视，能看到平台与方块的侧面）。玻璃是真实的背景模糊，地面的彩色光斑在玻璃下缓慢流动；平台本身不带任何颜色，只有玻璃色。每块平台是一个**业务区域**：核心平台区、门户与指挥区、综合办公区、人财物管理区、园区与安防区、公共服务区，各自承载所属的业务；区域名牌平印在平台前缘，显示区域名、业务数与异常数。
- **业务方块**：每个业务是一个带厚度与投影的磨砂玻璃盒，顶面印有业务类型图标（网关 / 总线 / 数据库 / 消息 / 门户 / 视频 / 支付 / 人事 / 财务 …），方块高度与图标颜色表示级别（核心最高、钴蓝；重要、天蓝；一般、灰蓝），顶面角落有运行指示灯（常亮不闪），方块上方悬浮名称铭牌。
- **路线与数据流**：区域内外的连接是贴在平台上的正交路线（白色路基 + 蓝色中线）；有数据往来时蓝色数据包沿路线飞行（两端淡入淡出），持续流转的路线中线更亮；故障连接红色慢速滚动虚线；临时连接虚线淡入淡出。
- **异常**：告警 / 故障业务的玻璃盒整体染成琥珀 / 红色，名称铭牌变为同色并带「告警 ·」「故障 ·」前缀，方块下方的投影缓慢呼吸，所属区域的玻璃边缘泛出同色光晕，区域名牌显示异常数。全程没有闪烁类动画。
- **交互**：鼠标移动带轻微视差（静止时不重绘）；悬停区域时玻璃提亮；悬停业务显示信息浮层并高亮其所有连接与对端，其余压暗；点击锁定，镜头轻推近并弹出玻璃详情卡（可用性 / 时延 / 请求量 / 终端、关联业务及其流转状态）；Esc 或再次点击解除。
- **开场**：平台自下而上升起、方块弹出、路线通电、数据包出发，约 2 秒；系统开启「减少动态效果」时跳过。
- **头部与状态**：名称显示开关、只看异常、重置；底部状态片：区域数、业务数、流转中连接数、异常数（含故障数）、在线终端。

## 运行

```bash
cd console-topology
npm install
npm run dev       # 开发：http://localhost:5173
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/zonemap/`。

## 嵌入到管理前台

```js
import { createBusinessMap } from './zonemap/index.js';   // 自带样式（类名均以 bm- 前缀）
import { generateData, startSimulation } from './zonemap/data.js';

const data = generateData();                      // 或替换为真实数据：{ zones, businesses, links }
const map = createBusinessMap(document.getElementById('business-map'), { data, intro: true, labels: true, onSelect: (b) => {} });
const stop = startSimulation(map, data);          // 演示用模拟器；接入真实事件时不需要
```

容器只需一个空元素，模块高度默认 `clamp(480px, 56vw, 660px)`，可用 CSS 覆盖 `.bm { height: ... }`。

数据结构：

```js
zone:     { id, name, en, accent: 'cobalt'|'sky'|'mint'|'lilac'|'amber'|'peach', businesses: [id...] }
business: { id, name, level: 'core'|'important'|'general', kind /* 图标类型，见 icons.js */, zone, status: 'normal'|'warning'|'critical',
            dept, owner, metrics: { avail, latency, rps }, terminals, components }
link:     { id, from, to, dir: 1 | 2 /* 单向 / 双向 */, status }
```

区域在地面上的位置由 `ZONE_SLOTS`（3 列 × 2 行，正向排列）指定，未指定的区域按顺序排列。

接口（`map.*`）：

| 方法 | 说明 |
| --- | --- |
| `touch(linkId, dir = 1)` | 该连接有数据往来：放出一个数据包（dir = -1 为反向） |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转状态（中线提亮） |
| `setBusinessStatus(id, status)` | 业务状态变化：方块变色、角标 / 涟漪、区域光晕、状态片 |
| `setLinkStatus(linkId, status)` | 连接状态变化 |
| `addTransientLink(from, to, ttl = 9, dir = 1)` | 临时连接，ttl 秒后自动消失 |
| `setTerminals(id, count)` | 更新在线终端数 |
| `focus(id)` / `unfocus()` | 锁定 / 解除某业务 |
| `setLabels(on)` / `setAlertsOnly(on)` | 名称显示 / 只看异常 |
| `destroy()` | 卸载模块，释放监听与渲染循环 |

## 结构

```
console-topology/
  index.html              演示页（浅色页框）
  src/main.js             演示页入口：挂载模块 + 启动模拟器
  src/page.css            演示页框样式
  src/zonemap/index.js    模块：DOM 与 3D 布局、路线、数据包、交互、浮层、对外接口
  src/zonemap/scene.css   模块样式：磨砂玻璃平台、3D 方块、铭牌、角标、路线、浮层
  src/zonemap/data.js     按区域组织的模拟数据与实时事件模拟器
  src/zonemap/icons.js    业务类型图标
```

实现为 CSS 3D（`transform-style: preserve-3d` + `backdrop-filter`）+ SVG 路线 + 少量 JS，无第三方运行时依赖；开发 / 构建仅依赖 Vite。需要支持 `backdrop-filter`、`color-mix()` 与 `@property` 的现代浏览器（Chrome / Edge 111+、Safari 16.4+、Firefox 128+）。
