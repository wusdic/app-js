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

let _halo, _spark, _soft, _beam;
// 光柱：底部亮、向上渐隐，水平方向柔和衰减
export function beamTexture() {
  if (_beam) return _beam;
  const w = 64, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5) / w * 2 - 1, v = 1 - (y + 0.5) / h; // v: 0 顶 → 1 底
    const horiz = Math.max(0, 1 - dx * dx * 1.6) ** 2, vert = Math.pow(1 - v, 0.6) * (1 - Math.pow(1 - v, 6));
    const a = Math.max(0, Math.min(1, horiz * (0.15 + 0.85 * (1 - v)) * (0.25 + 0.75 * vert) * 1.2));
    const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  _beam = new THREE.CanvasTexture(c); _beam.colorSpace = THREE.SRGBColorSpace; return _beam;
}
export const haloTexture = () => (_halo ||= radialCanvas(128, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.45, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]));
export const sparkTexture = () => (_spark ||= radialCanvas(64, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.8)'], [0.6, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]));
export const softTexture = () => (_soft ||= radialCanvas(64, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]));
