# 全网业务运行态势 · 3D 可视化

面向领导层的全网业务态势总览页面：分层星空风格，Three.js 实现，无外部网络依赖（贴图程序生成、系统字体）。

## 看什么

- **健康度优先**：顶部第一块是「全网健康度」评分（100 − 各层异常加权扣分）及较 10 分钟前的变化，第二块是异常关注（故障 / 告警数），三个层级块显示「正常 / 总数」与三色状态条，点击即只看该层。
- **全景优先**：打开即是整座三层金字塔的全景，核心业务层为实，其它两层虚化（正常业务淡化但仍可辨、标签隐藏、圆盘保留轮廓与三成网格）；虚化层里的异常业务保持清晰并带标签和警示环。虚化程度见 `LAYOUT.ghost`。左侧「重点层级」、键盘 1 / 2 / 3 / 0 或点击层级 KPI 只切换谁实谁虚，不改变全景；点当前层旁的「对准」才推近到该层，「全景」或重置视角回到全景。当前层内部的连线常亮，跨层连线较淡，无关连线极淡；其它层若有故障，层选择器下方会提示并可一键切过去。
- **开场**：页面打开时逐步生成——三层圆盘自上而下画出、节点按层生成、连线通电并在核心层扫过一波辉光、终端尘埃浮现，同时相机从远处轻微推进，最后周边面板依次淡入（约 4 秒）。URL 加 `?nointro` 或系统开启「减少动态效果」时跳过。
- **业务系统模型**：与圆形平台同一套「圆」的语言——圆形底座（细环 + 浅底 + 旋转刻度弧 + 贴地柔光）上悬浮一颗柔光能量球（菲涅尔边缘光 + 明亮内核 + 球内缓慢流动的光带），球外套细线轨道环缓慢进动、环上一点光标巡行；核心：两道轨道环，重要：一道，一般：只有能量球（大小与环数即级别）。关键依赖（被依赖最多的 5 个业务）底座外多一圈细环。三层平台外缘为清晰细线，侧壁与能量环极淡；中轴一道贯穿三层的光轴，背景为星云天幕 + 星点，四周暗角收拢视线。
- **连接与数据流转**：连线常亮表示「有连接」；有数据往来时一道辉光沿线飞过（世界单位：所有连线同速同长，持续有数据约每 2 秒一道），流量期间显示方向箭头（双向两端都有）；临时连接无数据一段时间后自动消失；故障连接即便无数据也保持可见并以慢速心跳提示。
- **聚光**：悬停业务或连接，只保留相关的连接与对端，其余压暗（路过悬停为弱对比，点击连线 / Shift+点击业务可固定，为强对比，底部出现聚光芯片，Esc 或 × 取消）。右侧「实时数据流转」列出当前层正在流转的连接（谁 → 谁 · 频次），悬停行即在 3D 中高亮。
- **异常关注**：告警卡片带级别、根因组件、影响面（关联业务数 / 核心依赖数 / 终端数）、「新」标记与持续时长；悬停在 3D 中定位，点击进入局部并直接落到根因组件；恢复后保留 60 秒「已恢复」。新故障出现时顶部横幅提示，可一键定位。底部有事件流水（发生 / 升级 / 恢复）。
- **局部视图**：点击任一业务（节点或名称标签），相机推近并展开以该业务为中心的「舞台」：内环为组件（按类型不同剪影：网关 / 应用 / 数据库 / 缓存 / 消息队列 / 存储 / 调度，含组件间调用关系），外环为本地终端，边缘「出口」示意与其他业务 / 远端终端的连接（远端业务不在本视角展开，点击出口或关联列表可跳转）。点击组件弹出「组件状态」卡：实例健康数、时延 / 请求量 / 错误率、CPU / 内存、上下游组件、接入终端数、最近事件。滚轮拉远、Esc 或 Backspace 返回。
- **值守巡视**：无人操作 60 秒且存在故障时，自动轮流定位最严重的故障（可在 ⚙ 中关闭）。
- **警示节律**：故障 / 告警元素只有一种慢速「呼吸」（故障 4.5 秒、告警 7 秒一次，短起慢落不突跳），核心层圆盘每 14 秒一圈淡入的能量环；⚙ 中「警示脉动」可整体关闭，关闭后警示元素保持恒定亮度。
- **搜索**：顶部搜索框（快捷键 /）按名称 / 部门 / 负责人匹配，匹配项在 3D 中高亮，Enter 进入局部，Shift+Enter 固定聚光。

## 运行

```bash
npm install
npm run dev      # 开发：http://localhost:5173
npm run build    # 构建到 dist/（纯静态文件，可部署到任意内网静态服务器或 Nginx 子目录）
npm run preview  # 本地预览构建产物
```

大屏适配：字号随屏幕宽度缩放（1080p 约 13px 基准，4K 封顶 26px）；渲染分辨率上限 2560 宽，辉光按半分辨率计算；帧率持续偏低时自动降级画质（⚙ 中可手动固定档位）。WebGL 上下文丢失或渲染循环停滞时自动重载并恢复到原层级。

## 目录结构

```
src/
  main.js              入口：场景构建 / 重载、可见性规则（分层 × 聚光 × 聚焦）、聚焦流程、KPI / 告警 / 关键依赖 / 巡视、对外 API
  config.js            主题色、层布局与相机、连接规则、告警节律、健康度权重、画质阈值
  core/App.js          渲染器、相机、轨道控制、后期（MSAA + 辉光 + 色调映射）、分层拾取、画质自适应、自愈
  core/Tween.js        极简补间
  core/textures.js     程序化光晕 / 火花 / 光轴贴图
  scene/Starfield.js   星云天幕 + 星空背景
  scene/Layers.js      三层平台（刻度网格 / 发光侧壁 / 能量环 / 中轴光轴 / 虚化 / 扫描）与环形排布算法
  scene/SystemModel.js 业务系统模型（圆形底座 + 柔光能量球 + 进动轨道环），全局节点与局部舞台中心共用
  scene/BusinessNode.js 业务节点（系统模型 + 可点击标签 + 警示环）
  scene/FlowTube.js    连接管线（常亮底线 + 世界单位辉光脉冲 + 方向箭头）
  scene/LinkSystem.js  连接管理：邻接索引、墙钟活跃判断、临时连接生命周期
  scene/TerminalCloud.js 全局终端粒子云（GPU 计算轨道，按层显示）
  scene/FocusStage.js  局部舞台：组件环（按类型建模）、本地终端、出口
  ui/Tooltip.js        悬浮信息框
  ui/Panels.js         顶部 KPI、层级切换、关键依赖、告警、流转、聚焦 / 组件卡、搜索、设置、事件流水
  data/mock.js         模拟数据与实时事件模拟器（组件根因异常、连接占空比、终端波动）
```

## 接入真实数据

页面把所有运行时入口挂在 `window.NetView` 上，`src/data/mock.js` 中的 `startSimulation` 就是通过这套 API 驱动画面的。接真实系统时，用 WebSocket / 轮询拿到事件后调用同样的方法即可：

```js
const v = window.NetView;

// 整体加载 / 重载快照（结构见 src/data/mock.js 的 generateData）；快照中已带异常的业务 / 组件 / 连接会自动进入告警列表
v.load({ businesses, links });
v.addBusiness(b); v.removeBusiness(id); v.removeLink(id);

// 连接上产生数据往来：首次点亮并放出辉光，停止调用 6 秒后自动熄灭
v.touchLink('l12', 1);                                   // dir: 1 = from→to，-1 = 反向
v.touchLink('l12', { dir: 1, count: 25, at: Date.now() }); // 批量：最近一段时间的次数与时间戳

// 建立临时连接（两业务之间原本没有连接）；无数据 12 秒后自动消失。返回连接 id
const id = v.addTransientLink('general-3', 'core-0', '文件传输');

// 组件状态（推荐）：'normal' | 'warning' | 'critical'，自动汇总为业务状态，告警显示"根因 组件名：message"
v.setComponentStatus('core-4', 'core-4-c1', 'warning', '响应时延升高，P95 > 800ms');
// 业务整体状态（无组件粒度时使用）、连接状态
v.setBusinessStatus('core-4', 'warning', '响应时延升高，P95 > 800ms');
v.setLinkStatus('l12', 'critical', '链路中断');

// 指标与终端数量
v.setMetrics('core-4', { availability: 99.72, latency: 320, qps: 1800 });
v.data.businesses[0].terminals.local = 1280; v.setTerminals();
v.terminalEvent('core-1', 'local');   // 终端接入事件（仅在该业务处于局部视角时产生动效）

// 批量事件（同一帧合并刷新）
v.applyEvents([{ type: 'touch', id: 'l12', dir: 1, count: 3 }, { type: 'component', bid: 'core-4', cid: 'core-4-c1', status: 'normal' }]);

// 视图控制
v.setLayer('important');            // 'core' | 'important' | 'general' | 'all'
v.focus('core-1');                  // 进入局部视图；v.focus('core-1', 'core-1-c1') 同时选中组件；第三参可传连接 id 高亮出口
v.unfocus(); v.locate('core-1');    // locate = 聚光并把视线移到该业务，不进入局部
v.spotlight('node', 'core-1');      // 固定聚光；v.spotlight('link', 'l12')；v.spotlight(null) 取消
v.setQuality('balanced');           // 'auto' | 'high' | 'balanced' | 'low'
v.setAlarmPulse(false);             // 关闭警示呼吸脉动（同 ⚙ 中「警示脉动」）
```

业务 `level` 取值 `core | important | general`，每层的位置由 `scene/Layers.js` 自动按环形排布；组件 `type` 取值 `gateway | app | db | cache | mq | storage | sched` 决定局部视图中的形状。

## 主要可调参数（`src/config.js`）

| 参数 | 说明 |
| --- | --- |
| `THEME.level / status / link / hdrGain` | 各级别、状态、连接的颜色；异常与流转在辉光缓冲中的增益 |
| `LAYOUT.layers.*.y / radius / rings / view` | 各层高度、圆盘半径、节点环半径、查看该层时的相机距离与仰角 |
| `LAYOUT.defaultLayer / camera / focus` | 默认重点层级、全景视角、聚焦时的相机偏移与视场角 |
| `LAYOUT.ghost / intro` | 虚化层的可见度；开场动画开关与推进幅度 |
| `LINK_RULES.idleAfter / transientRemoveAfter` | 无数据多久熄灭 / 临时连接多久移除（秒） |
| `LINK_RULES.pulseGap / pulseSpeedUnits / tailUnits` | 辉光最小间隔（秒）、速度（单位/秒）、尾巴长度（单位） |
| `LINK_RULES.base` | 底线亮度：本层内 / 跨层 / 无关 / 查看全部 / 聚光 |
| `ALARM` | 故障 / 告警的呼吸周期（秒）、起始段占比 `attack`、总开关 `pulse` |
| `HEALTH_WEIGHTS` | 健康度评分各层异常扣分 |
| `QUALITY` | 渲染分辨率上限与自适应降级阈值 |
