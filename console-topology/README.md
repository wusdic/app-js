# 全网业务版图 · 管理前台主视觉模块

管理前台「全局展示」页面中处于视觉中心的一个模块区域，浅色界面、等轴 3D。**与上级目录的深色大屏版本完全独立**：不共享代码、样式、数据与依赖，可单独安装、构建与嵌入。

## 设计

- **业务版图**：全网业务按业务域划分为六块带圆角与厚度的平台（核心支撑 / 经营管理 / 办公协同 / 安全保障 / 民生服务 / 数据与门户），核心支撑域居中靠前。每个域有自己的色相，平台前缘贴有域名与业务数，底边一圈域色描边。
- **业务 = 立方体**：域内每项业务是一个圆角立方体，高度即业务规模（请求量级），颜色随域；软阴影落在平台与地面上，读出体积与层次。异常时立方体变为告警橙 / 故障红并缓慢呼吸，顶部浮出状态角标，平台上周期扩散涟漪。
- **数据流转**：默认只显现正在流转的连接——蓝色弧线从一个业务顶部跨到另一个业务顶部，流光头部带尾迹沿弧线飞行；停止流转后弧线淡出。悬停或锁定业务时，其全部连接以灰色显现，其余压暗。故障连接红色慢速呼吸；临时连接淡入淡出。
- **终端**：每项业务周围有环绕的微粒，数量随在线终端数变化，缓慢巡行。
- **交互**：拖动旋转（限定角度范围，松手回弹阻尼）、滚轮缩放；空闲时镜头轻微摇摆保持立体感。悬停业务显示信息浮层并高亮其关系；点击业务锁定，镜头推近居中，弹出玻璃质感详情卡（可用性 / 时延 / 请求量 / 终端、上下游关系）；点击平台或头部域芯片聚焦该域，其它域退为灰白，弹出域概览卡（健康度条、流转中 / 跨域数、终端、需关注业务）。Esc、点空白或「重置视角」返回。
- **开场**：平台自地面升起、业务立方体依次长出、连线通电，约 2.4 秒；系统开启「减少动态效果」时跳过并停用摇摆。
- **头部与底部**：头部为标题、域芯片（可点击聚焦）、状态图例、「名称」开关（显示全部业务名称）、「重置视角」；底部为流转中连接数、异常数（含故障与涉及域数）、在线终端总数。

## 运行

```bash
cd console-topology
npm install
npm run dev       # 开发：http://localhost:5173
npm run build     # 产物在 dist/
```

`?nointro` 跳过开场动画。演示页 `index.html` 只提供一个极简的浅色页框与占位区块，模块本身在 `src/map/`。

## 嵌入到管理前台

```js
import { createBusinessMap } from './map/index.js';        // 自带样式（类名均以 bm- 前缀）
import { generateData, startSimulation } from './map/data.js';

const data = generateData();                                // 或替换为真实数据：{ domains, businesses, links }
const mod = createBusinessMap(document.getElementById('business-map'), { data, intro: true, sway: true, onSelect: (b) => {} });
const stop = startSimulation(mod, data);                    // 演示用模拟器；接入真实事件时不需要
```

容器只需一个空元素，高度默认 `clamp(500px, 60vw, 700px)`，可用 CSS 覆盖 `.bm-module { height: ... }`。

数据结构：

```js
domain:   { id, name, short, color, desc }
business: { id, name, domain, scale: 1..5 /* 高度 */, status: 'normal'|'warning'|'critical', dept, owner,
            metrics: { avail, latency, rps }, terminals, components }
link:     { id, from, to, dir: 1 | 2 /* 单向 / 双向 */, status }
```

接口（`mod.*`）：

| 方法 | 说明 |
| --- | --- |
| `touch(linkId, dir = 1)` | 该连接有数据往来：放出一道流光（dir = -1 为反向） |
| `setLinkActive(linkId, on)` | 连接是否处于持续流转状态（弧线显现 + 流光） |
| `setBusinessStatus(id, status)` | 业务状态变化：颜色平滑过渡、角标、涟漪 |
| `setLinkStatus(linkId, status)` | 连接状态变化 |
| `addTransientLink(from, to, ttl = 9, dir = 1)` | 临时连接，ttl 秒后自动消失 |
| `setTerminals(id, count)` | 更新在线终端数（微粒数量随之变化） |
| `focus(id)` / `unfocus()` | 锁定 / 解除某业务 |
| `focusDomain(id \| null)` | 聚焦 / 退出某业务域 |
| `setShowNames(on)` / `setSway(on)` / `resetView()` | 名称开关 / 空闲摇摆 / 重置视角 |
| `destroy()` | 卸载模块，释放渲染器与监听 |

## 结构

```
console-topology/
  index.html           演示页（浅色页框）
  src/main.js          演示页入口：挂载模块 + 启动模拟器
  src/page.css         演示页框样式
  src/map/index.js     模块：DOM 构建、交互、悬浮卡 / 详情卡 / 域概览卡、状态条、对外接口
  src/map/scene.js     three.js 场景：等轴正交相机、平台 / 立方体 / 弧线流光 / 涟漪 / 终端微粒、软阴影、开场
  src/map/data.js      业务域与业务模拟数据、实时事件模拟器
  src/map/style.css    模块样式（bm- 前缀）
```

运行时依赖 three.js（本目录独立安装），构建依赖 Vite。
