// 演示页入口：在一个极简的浅色管理前台页框里挂载「全网业务版图」主视觉模块，并启动实时模拟
import './page.css';
import { createBusinessMap } from './glassmap/index.js';
import { generateData, startSimulation } from './glassmap/data.js';

const data = generateData();
const map = createBusinessMap(document.getElementById('business-map'), { data, intro: !location.search.includes('nointro') });
const stop = startSimulation(map, data);
window.BusinessMap = Object.assign(map, { stopSimulation: stop });
