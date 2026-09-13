// 演示页入口：在一个极简的浅色管理前台页框里挂载「全网业务版图」主视觉模块，并启动实时模拟
//   ?zones=N&max=M 可模拟不同的区域数与每区业务数（布局动态生成）；?nointro 跳过开场
import './page.css';
import { createBusinessMap } from './zonemap/index.js';
import { generateData, startSimulation } from './zonemap/data.js';

const q = new URLSearchParams(location.search);
const data = generateData({ zones: +q.get('zones') || undefined, maxPerZone: +q.get('max') || undefined });
const map = createBusinessMap(document.getElementById('business-map'), { data, intro: !q.has('nointro') });
const stop = startSimulation(map, data);
window.BusinessMap = Object.assign(map, { stopSimulation: stop });
