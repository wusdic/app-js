import * as THREE from 'three';

// 程序化贴图：柔光光晕 / 光点，避免依赖外部图片
function radialCanvas(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _halo, _spark, _soft;
export const haloTexture = () => (_halo ||= radialCanvas(128, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.45, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]));
export const sparkTexture = () => (_spark ||= radialCanvas(64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.8)'], [0.6, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]));
export const softTexture = () => (_soft ||= radialCanvas(64, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
