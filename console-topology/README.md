# 全网业务版图 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的一个模块区域，浅色界面。**与上级目录的深色大屏版本完全独立**：不共享代码、样式、数据与依赖（本目录自带 three.js 依赖），可单独安装、构建与嵌入。

## 设计

- **玻璃园区，正向视角**：淡蓝科技底色的地面上，若干块磨砂玻璃底座正向排成若干行（不做斜向旋转），镜头从正前上方俯视，业务体以侧方位呈现立体感。底座与业务体都是同一种无色玻璃（物理材质：折射 + 粗糙度带来的磨砂模糊、清漆高光、极淡的蓝色厚度衰减），底座不带任何其它颜色。
- **业务区域动态生成**：区域个数与每个区域的业务个数来自数据。每个区域按业务数决定网格列数（≈√n）与底座尺寸，区域按行排列、行内居中，首个区域放在最前一行中央；区域或业务增减后调用 `load()` 重新布局。
- **业务体**：带圆角与厚度的磨砂玻璃方块，高度表示级别（核心最高），玻璃内部有一颗发光内核透出（颜色即级别），顶面印有业务类型图标，前方悬浮名称铭牌（相邻列前后错开；拉远时只保留核心、异常与聚光的铭牌，避免拥挤）。
- **连接与数据流**：区域内外的业务用贴在底座上的正交细管相连（支持 1:1 与 N:N），持续流转的连接颜色更深；有数据往来时蓝色数据包沿管线飞行（所有数据包一次实例化绘制）；故障连接红色，临时连接淡入后自动消失。
- **异常**：告警 / 故障业务的内核与图标变为琥珀 / 红色并缓慢呼吸（不闪烁），底座上一圈同色光环轻微起伏，铭牌与所属区域名牌同步提示。
- **交互与动效**：悬停业务显示信息浮层并高亮其所有连接与对端，其余压暗；点击锁定，镜头平滑飞近（0.75 秒，缓入缓出）并把业务放在偏左位置，右侧玻璃详情卡滑入（可用性 / 时延 / 请求量 / 终端、关联业务及其流转状态，点击关联业务可直接跳转）；再次点击、Esc 或「重置视角」飞回全景。拖动可在小范围内微调视角（带阻尼），滚轮缩放。
- **开场**：底座逐块升起、业务弹出、路线通电、数据包出发，镜头从远处推入，约 2 秒；系统开启「减少动态效果」时跳过。

## 动效底层逻辑与技术选型（为什么丝滑）

- **WebGL 渲染（three.js）**：整个场景由 GPU 绘制，玻璃、阴影、路线、数据包都不是 DOM，不会触发浏览器布局与重绘；不使用 CSS 3D + backdrop-filter 的方案（那类方案在视角变化时逐帧重新栅格化，是闪烁与卡顿的来源）。
- **单一时钟**：只有一个 `requestAnimationFrame` 循环，拾取、补间、状态插值、渲染、标签同步都在这一帧里按顺序完成；页面不可见时暂停。
- **按帧插值，不用 CSS 过渡驱动 3D**：悬停缩放、压暗透明度、颜色变化、路线亮度等都是帧率无关的指数趋近（`approach`），镜头飞行是缓入缓出补间；任何时刻切换目标都从当前值继续，不会跳变、不排队。
- **拾取节流**：指针事件只记录坐标，射线拾取每帧最多一次，命中体为简化包围盒。
- **绘制开销固定**：数据包用 `InstancedMesh` 一次绘制；接触阴影为贴图平面，不用实时阴影；磨砂玻璃走一次半分辨率的折射通道；无后期处理。
- **DOM 只做文字**：名称、区域名牌用 CSS2DRenderer 定位（只改 transform），详情卡停靠右侧、只用 transform / opacity 过渡，不引起布局。

## 运行

```bash
cd console-topology
npm install
npm run dev       # 开发：http://localhost:5173
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/glassmap/`。

## 嵌入到管理前台

```js
import { createBusinessMap } from './glassmap/index.js';   // 自带样式（类名均以 gm- 前缀）
import { generateData, startSimulation } from './glassmap/data.js';

const data = generateData();                      // 或替换为真实数据：{ zones, businesses, links }
const map = createBusinessMap(document.getElementById('business-map'), { data, intro: true, labels: true, onSelect: (b) => {} });
const stop = startSimulation(map, data);          // 演示用模拟器；接入真实事件时不需要
```

容器只需一个空元素，模块高度默认 `clamp(480px, 56vw, 680px)`，可用 CSS 覆盖 `.gm { height: ... }`。

数据结构：

```js
zone:     { id, name, en, businesses: [id...] }            // 区域个数任意
business: { id, name, level: 'core'|'important'|'general', kind /* 图标类型，见 icons.js */, zone, status: 'normal'|'warning'|'critical',
            dept, owner, metrics: { avail, latency, rps }, terminals, components }
link:     { id, from, to, dir: 1 | 2 /* 单向 / 双向 */, status }   // 任意业务之间，1:1 / 1:N / N:N 均可
```

接口（`map.*`）：

| 方法 | 说明 |
| --- | --- |
| `touch(linkId, dir = 1)` | 该连接有数据往来：放出一个数据包（dir = -1 为反向） |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转状态 |
| `setBusinessStatus(id, status)` | 业务状态变化：内核 / 图标颜色平滑过渡、光环、铭牌与区域名牌 |
| `setLinkStatus(linkId, status)` | 连接状态变化 |
| `addTransientLink(from, to, ttl = 9, dir = 1)` | 临时连接，ttl 秒后自动消失 |
| `setTerminals(id, count)` | 更新在线终端数 |
| `load({ zones, businesses, links })` | 整体重载并重新动态布局（区域 / 业务个数变化时） |
| `focus(id)` / `unfocus()` | 锁定 / 解除某业务（镜头飞近 / 飞回） |
| `setLabels(on)` / `setAlertsOnly(on)` / `resetView()` | 名称显示 / 只看异常 / 回到全景 |
| `destroy()` | 卸载模块，释放渲染器与监听 |

## 结构

```
console-topology/
  index.html              演示页（浅色页框）
  src/main.js             演示页入口：挂载模块 + 启动模拟器
  src/page.css            演示页框样式
  src/glassmap/index.js   模块：DOM、交互（拾取节流 / 锁定 / 详情卡）、渲染循环、对外接口
  src/glassmap/scene.js   WebGL 场景：玻璃材质、底座与业务体、路线与实例化数据包、镜头补间、聚光、开场
  src/glassmap/layout.js  动态布局：按数据生成区域网格与业务网格
  src/glassmap/tween.js   补间与帧率无关的平滑趋近
  src/glassmap/icons.js   业务类型图标（SVG → 贴图）
  src/glassmap/data.js    按区域组织的模拟数据与实时事件模拟器
  src/glassmap/style.css  模块样式（gm- 前缀）
```

运行时依赖 three.js；构建依赖 Vite。需要支持 WebGL 2 的现代浏览器。
