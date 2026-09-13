// 演示页入口：极简浅色页框中挂载「全景环」模块，并启动实时模拟
import './page.css';
import { createPanoramaModule } from './panorama/index.js';
import { generateData, startSimulation } from './panorama/data.js';

const data = generateData();
const mod = createPanoramaModule(document.getElementById('panorama'), { data, intro: !location.search.includes('nointro') });
const stop = startSimulation(mod, data);
window.Panorama = Object.assign(mod, { stopSimulation: stop });
