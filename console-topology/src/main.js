// 演示页入口：在一个极简的浅色管理前台页框里挂载主视觉模块，并启动实时模拟
import './page.css';
import { createTopologyModule } from './topology/index.js';
import { generateData, startSimulation } from './topology/data.js';

const data = generateData();
const mod = createTopologyModule(document.getElementById('topology'), { data, intro: !location.search.includes('nointro') });
const stop = startSimulation(mod, data);
window.Topology = Object.assign(mod, { stopSimulation: stop });
