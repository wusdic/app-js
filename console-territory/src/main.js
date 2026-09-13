// 演示页入口：在极简的浅色管理前台页框里挂载主视觉模块，并启动实时模拟
import './page.css';
import { createTerritoryModule } from './territory/index.js';
import { generateData, startSimulation } from './territory/data.js';

const data = generateData();
const mod = createTerritoryModule(document.getElementById('territory'), { data, intro: !location.search.includes('nointro') });
const stop = startSimulation(mod, data);
window.Territory = Object.assign(mod, { stopSimulation: stop });
