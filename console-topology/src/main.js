// 演示页入口：在一个极简的浅色管理前台页框里挂载「全网业务版图」主视觉模块，并启动实时模拟
import './page.css';
import { createBusinessMap } from './map/index.js';
import { generateData, startSimulation } from './map/data.js';

const data = generateData();
const mod = createBusinessMap(document.getElementById('business-map'), { data, intro: !location.search.includes('nointro') });
const stop = startSimulation(mod, data);
window.BusinessMap = Object.assign(mod, { stopSimulation: stop });
