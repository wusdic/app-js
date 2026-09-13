# 全网业务全景环 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的模块区域，浅色界面。**与上级目录的深色大屏版本、`console-topology/` 的 2.5D 平台版本均完全独立**：不共享代码、样式、数据与依赖，可单独安装、构建与嵌入。

## 设计

这一版不再用「空间里的平台」来讲层级，而是用**一张环**来讲「全局」：

- **中心**：全网健康度评分（100 − 各层异常加权扣分），绕盘一圈按分数着色的进度弧，下方一句「N 个业务异常 · 较 10 分钟前 ▲ / ▼」。锁定某个业务后，中心盘放大，改为显示该业务的状态、可用性 / 时延 / 请求量与上下游、终端数；× 或 Esc 返回全网。
- **三层同心环**：核心业务在最内环，重要业务居中，一般业务在外环；每段弧是一个业务，弧上沿弧排字（上半环顺时针、下半环逆时针，字始终正立）。同层内按部门相邻。异常业务的弧段变为告警橙 / 故障红并在外缘带角标，周期向外扩散涟漪。
- **流转弦**：连接是穿过内区的束状弦（跨层的弦拉向中心，同层的弦贴内缘绕行）。有连接的弦常在，有数据流转的弦更实；每次往来一道彗星沿弦飞过，发送端内缘亮一道、到达时接收端外缘亮一道并泛出一圈。「只看流转中」开关可以把空闲的弦几乎隐去。
- **终端活动环**：最外圈每个业务一组刻度，刻度数量与高度随在线终端数变化，缓慢起伏，部分刻度闪烁表示临时接入的终端。
- **扫描**：一道极淡的扇形扫描线每 14 秒转一圈，作为「实时」的暗示。
- **左右信息栏**：左侧是三层健康（正常 / 告警 / 故障的堆叠条 + 流转中连接数）与最近事件；右侧是实时流转列表（谁 → 谁 · 频次，悬停即在环上高亮该弦）与在线终端总数及前 4 个业务。窄屏（≤ 960px）只保留环。
- **交互**：悬停弧段显示浮层并高亮其关系（无关弧段与弦压暗）；点击锁定；Esc 返回。
- **开场**：三层环从顶部顺时针画出，核心层先、外层后；健康度数字滚动到位；弦随后淡入。系统开启「减少动态效果」时跳过并停用扫描与涟漪。

## 运行

```bash
cd console-panorama
npm install
npm run dev       # 开发
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/panorama/`。

## 嵌入

```js
import { createPanoramaModule } from './panorama/index.js';   // 自带样式（类名均以 pr- 前缀）
import { generateData, startSimulation } from './panorama/data.js';

const data = generateData();                                   // 或真实数据：{ businesses: [...], links: [...] }
const mod = createPanoramaModule(document.getElementById('panorama'), { data, intro: true, onSelect: (b) => {} });
const stop = startSimulation(mod, data);                       // 演示模拟器；接入真实事件时不需要
```

容器只需一个空元素；高度默认 `clamp(480px, 46vw, 620px)`，可用 CSS 覆盖 `.pr-module { height: ... }`。

数据结构：

```js
business: { id, name, level: 'core'|'important'|'general', status: 'normal'|'warning'|'critical', dept, owner,
            metrics: { avail, latency, rps }, terminals, components }
link:     { id, from, to, dir: 1 | 2 /* 单向 / 双向 */, status, rate /* 次/分钟，仅用于列表展示 */ }
```

接口（`mod.*`）：

| 方法 | 说明 |
| --- | --- |
| `touch(linkId, dir = 1)` | 该连接有一次数据往来：彗星沿弦飞过，两端有收发反馈（dir = -1 为反向） |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转状态（弦加实、进入实时流转列表） |
| `setBusinessStatus(id, status, message?)` | 业务状态变化：弧段变色、涟漪、健康度重算、写入最近事件 |
| `setLinkStatus(linkId, status)` | 连接状态变化（故障弦红色慢速呼吸） |
| `setTerminals(id, count)` | 更新在线终端数（外圈刻度随之变化） |
| `focus(id)` / `unfocus()` | 锁定 / 解除某业务（中心盘切换） |
| `setOnlyActive(on)` | 只看流转中 |
| `destroy()` | 卸载模块 |

## 结构

```
console-panorama/
  index.html               演示页（浅色页框）
  src/main.js              演示页入口：挂载模块 + 启动模拟器
  src/page.css             演示页框样式
  src/panorama/index.js    模块：DOM、交互、中心盘、左右信息栏、对外接口
  src/panorama/ring.js     画布渲染：环段布局、沿弧文字、束状弦、彗星与收发反馈、终端刻度、涟漪、扫描、开场
  src/panorama/data.js     模拟数据与实时事件模拟器
  src/panorama/style.css   模块样式（pr- 前缀）
```

纯 Canvas 2D + 少量 HTML 覆盖层，无第三方运行时依赖；开发 / 构建仅依赖 Vite。
