# 全网业务版图 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的一个模块区域，浅色界面。**与上级目录的深色大屏版本完全独立**：不共享代码、样式、数据与依赖，可单独安装、构建与嵌入。

## 设计

- **正向排列的玻璃园区**：相机从正前上方俯视（带透视，左右两侧的物体能看到侧面）。地面是柔和的浅色渐变与几团缓慢流动的柔光；业务区域是一块块**通透 / 磨砂玻璃底座**（无色，只有玻璃的白与淡蓝反光），按行正向排列、前沿对齐、每行居中。
- **动态生成**：区域数量与每个区域的业务数量都来自数据。区域尺寸按业务数计算（尽量两行、横向铺开），再按「货架」方式逐行排布，一行放不下自动换行；`setData()` 可整体重载。演示页用 `?zones=4&max=5` 可看不同规模下的布局。
- **业务玻璃体**：每个业务是一个带厚度、投影与高光边的 3D 玻璃方块，顶面印有业务类型图标（网关 / 总线 / 数据库 / 消息 / 门户 / 视频 / 支付 / 人事 / 财务 …），玻璃底部透出与级别对应的一点色光（核心钴蓝、重要天蓝、一般灰蓝），方块高度也表示级别；顶面角落有运行指示灯（常亮不闪），前方台面上有名称铭牌。
- **路线与数据流**：区域内外的连接是贴在台面上的正交路线（白色路基 + 蓝色中线），支持 1 对 1、1 对 N、N 对 N；有数据往来时蓝色数据包沿路线飞行（两端渐显渐隐），持续流转的路线中线更亮；故障连接红色滚动虚线；临时连接虚线淡入淡出。
- **异常**：告警 / 故障业务的玻璃整体透出琥珀 / 红色光，顶部浮出角标（缓慢扩散的光环），台面上扩散涟漪，所属区域的玻璃边缘泛出同色光晕，区域名牌显示异常数。
- **不闪烁**：场景内不使用 backdrop-filter、不做逐帧相机运动，所有 3D 面互不相交（路线与铭牌放在台面与玻璃体之间 2.5px 的缝里），指示灯常亮——避免浏览器 3D 合成时的闪烁。
- **交互**：悬停区域时玻璃提亮；悬停业务显示信息浮层并高亮其所有连接与对端，其余压暗；点击锁定，镜头轻推近并弹出玻璃详情卡（可用性 / 时延 / 请求量 / 终端、关联业务及其流转状态）；Esc 或再次点击解除。头部：名称显示开关、只看异常、重置；底部状态片：区域数、业务数、流转中连接数、异常数（含故障数）、在线终端。
- **开场**：平台自下而上升起、方块弹出、路线通电、数据包出发，约 2 秒；系统开启「减少动态效果」时跳过。

## 运行

```bash
cd console-topology
npm install
npm run dev       # 开发：http://localhost:5173
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画；`?zones=N&max=M` 模拟不同的区域数与每区业务数。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/zonemap/`。

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
zone:     { id, name, businesses: [id...] }          // 数量不限，布局按业务数动态计算
business: { id, name, level: 'core'|'important'|'general', kind /* 图标类型，见 icons.js */, zone, status: 'normal'|'warning'|'critical',
            dept, owner, metrics: { avail, latency, rps }, terminals, components }
link:     { id, from, to, dir: 1 | 2 /* 单向 / 双向 */, status }   // 任意两业务之间，1:1 / 1:N / N:N 均可
```

接口（`map.*`）：

| 方法 | 说明 |
| --- | --- |
| `setData(data)` | 整体重载：区域 / 业务 / 连接数量变化时重新布局并播放开场 |
| `touch(linkId, dir = 1)` | 该连接有数据往来：放出一个数据包（dir = -1 为反向） |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转状态（中线提亮） |
| `setBusinessStatus(id, status)` | 业务状态变化：玻璃透光、角标 / 涟漪、区域光晕、状态片 |
| `setLinkStatus(linkId, status)` | 连接状态变化 |
| `addTransientLink(from, to, ttl = 9, dir = 1)` | 临时连接，ttl 秒后自动消失 |
| `setTerminals(id, count)` | 更新在线终端数 |
| `focus(id)` / `unfocus()` | 锁定 / 解除某业务 |
| `setLabels(on)` / `setAlertsOnly(on)` | 名称显示 / 只看异常 |
| `layout()` | 当前地面尺寸 `{ GW, GH }` |
| `destroy()` | 卸载模块，释放监听与渲染循环 |

布局参数（`index.js` 顶部常量）：`CELL / CELL_Y`（业务网格间距）、`ZPAD / GAP / ROWGAP`（区域内边距、区域间距、行间距）、`MAXW`（一行区域的最大总宽）、`BLK_H`（各级别玻璃体高度）、`TILT`（相机俯角）。

## 结构

```
console-topology/
  index.html              演示页（浅色页框）
  src/main.js             演示页入口：挂载模块 + 启动模拟器
  src/page.css            演示页框样式
  src/zonemap/index.js    模块：动态布局、DOM 与 3D 构建、路线、数据包、交互、浮层、对外接口
  src/zonemap/scene.css   模块样式：玻璃底座、玻璃业务体、铭牌、角标、路线、浮层
  src/zonemap/data.js     按区域组织的模拟数据（可指定区域数 / 每区业务数）与实时事件模拟器
  src/zonemap/icons.js    业务类型图标
```

实现为 CSS 3D（`transform-style: preserve-3d`）+ SVG 路线 + 少量 JS，无第三方运行时依赖；开发 / 构建仅依赖 Vite。需要支持 `color-mix()` 的现代浏览器（Chrome / Edge 111+、Safari 16.2+、Firefox 113+）。
