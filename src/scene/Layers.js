import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LAYOUT, THEME, LEVELS } from '../config.js';
import { tweenValue, Ease } from '../core/Tween.js';

// 分层圆盘：3 圈刻度环 + 外半段 12 条辐条 + 外缘边 + 只在当前层运转的雷达扫描；虚化层只保留轮廓与浅底
const discShader = {
  vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uRadius; uniform float uDim; uniform float uTime; uniform float uGhost; uniform float uScan; uniform float uReveal;
    varying vec3 vPos;
    float lineAt(float d, float w){ return 1.0 - smoothstep(0.0, w, d); }
    void main(){
      float len = length(vPos.xy);
      float r = len / uRadius;
      if (r > 1.0) discard;
      float ang = atan(vPos.y, vPos.x);
      // 线宽随屏幕像素自适应：拉远时仍保持约 1.5~2 像素，轮廓不消失
      float px = fwidth(len);
      float wThin = max(0.07, px * 1.2), wRim = max(0.22, px * 2.2);
      float fr = fract(r * 3.0);
      float rings = lineAt(min(fr, 1.0 - fr) / 3.0 * uRadius, wThin) * 0.5;
      float fa = fract(ang / 6.2831853 * 12.0);
      float spokes = lineAt(min(fa, 1.0 - fa) * (6.2831853 * len / 12.0), wThin) * 0.3 * smoothstep(0.5, 0.68, r);
      float rim = lineAt((1.0 - r) * uRadius, wRim) * 1.0 + lineAt((1.0 - r) * uRadius, max(2.4, px * 10.0)) * 0.14;
      float fill = 0.13 * (1.0 - r * 0.7);
      float sweep = pow(fract(ang / 6.2831853 - uTime * 0.0167), 12.0) * 0.26 * smoothstep(0.1, 0.5, r) * uScan;
      float detail = (rings + spokes + sweep) * (1.0 - uGhost);
      float a = (fill * mix(1.0, 0.55, uGhost) + detail + rim * mix(1.0, 0.6, uGhost)) * uDim;
      // 开场：从中心向外画出，带一圈亮边
      float mask = mix(1.0 - smoothstep(uReveal - 0.12, uReveal, r), 1.0, step(0.999, uReveal)); // 画完后不再遮罩，外缘亮边完整保留
      float front = lineAt(abs(r - uReveal) * uRadius, 0.9) * 0.9 * step(0.001, uReveal) * step(uReveal, 0.999);
      a = a * mask + front * uDim;
      gl_FragColor = vec4(uColor * a, a);
    }`,
};

export function createLayers() {
  const group = new THREE.Group();
  const layers = {};
  for (const level of LEVELS) {
    const cfg = LAYOUT.layers[level];
    const geo = new THREE.CircleGeometry(cfg.radius, 128);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(THEME.disc[level]) }, uRadius: { value: cfg.radius }, uDim: { value: 1 }, uTime: { value: 0 }, uGhost: { value: 0 }, uScan: { value: 1 }, uReveal: { value: 1 } },
      ...discShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = cfg.y;
    disc.renderOrder = -10;
    group.add(disc);

    const el = document.createElement('div');
    el.className = 'lbl layer';
    el.innerHTML = `<span class="in"><span class="ln">${cfg.label}</span><small>${cfg.en}</small><b class="n"></b></span>`;
    const label = new CSS2DObject(el);
    group.add(label);
    layers[level] = { disc, mat, label, el, cfg, dimTarget: 1, ghostTarget: 0, dim: 1, ghost: 0 };
  }
  let globalDim = 1;
  // 分层查看：当前层完整，其它层虚化（补间过渡）
  group.setLayerDims = (level, ghostDim = 0.32) => { for (const [lv, l] of Object.entries(layers)) { const on = level === 'all' || lv === level; l.dimTarget = on ? 1 : ghostDim; l.ghostTarget = on ? 0 : 1; l.mat.uniforms.uScan.value = level === 'all' || on ? 1 : 0; } };
  // 开场生成：0 = 未画出，1 = 完整；reveal(level, duration, delay) 播放径向画出
  group.setReveal = (v) => { for (const l of Object.values(layers)) l.mat.uniforms.uReveal.value = v; };
  group.reveal = (level, duration = 1, delay = 0) => { const u = layers[level].mat.uniforms.uReveal; u.value = 0; tweenValue(0, 1.0, { duration, delay, ease: Ease.outCubic }, (v) => { u.value = v; }); };
  group.setDim = (d) => { globalDim = d; };
  // 层标签上的异常数
  group.setLayerNote = (level, text, cls) => { const b = layers[level].el.querySelector('.n'); b.textContent = text; b.className = `n ${cls || ''}`; };
  group.update = (dt, t, camera) => {
    const az = camera ? Math.atan2(camera.position.x, camera.position.z) : 0;
    const k = Math.min(1, dt * 3);
    for (const l of Object.values(layers)) {
      l.dim += (l.dimTarget - l.dim) * k; l.ghost += (l.ghostTarget - l.ghost) * k;
      l.mat.uniforms.uTime.value = t; l.mat.uniforms.uDim.value = l.dim * globalDim; l.mat.uniforms.uGhost.value = l.ghost;
      l.el.classList.toggle('dim', l.ghostTarget > 0.5 || globalDim < 0.5);
      l.el.classList.toggle('hidden-lbl', l.mat.uniforms.uReveal.value < 0.99);
      // 标签始终放在面向相机的前左侧边缘
      const a = az + 0.55;
      l.label.position.set(Math.sin(a) * (l.cfg.radius + 5), l.cfg.y + 0.5, Math.cos(a) * (l.cfg.radius + 5));
    }
  };
  group.layerMap = layers;
  return group;
}

// 业务在各层内按同心环排布：环容量与周长成正比，同一部门尽量相邻
export function layoutPositions(businesses) {
  const positions = new Map();
  for (const level of LEVELS) {
    const cfg = LAYOUT.layers[level];
    const list = businesses.filter((b) => b.level === level).slice().sort((a, b) => a.dept.localeCompare(b.dept, 'zh'));
    const radii = cfg.rings;
    const totalR = radii.reduce((s, r) => s + r, 0);
    let counts = radii.map((r) => Math.round((list.length * r) / totalR));
    let diff = list.length - counts.reduce((s, c) => s + c, 0);
    counts[counts.length - 1] += diff;
    let idx = 0;
    radii.forEach((r, ri) => {
      const n = counts[ri];
      for (let i = 0; i < n; i++) {
        const b = list[idx++];
        if (!b) break;
        const ang = (i / n) * Math.PI * 2 + ri * 0.35 - Math.PI / 2;
        positions.set(b.id, new THREE.Vector3(Math.cos(ang) * r, cfg.y, Math.sin(ang) * r));
        b.labelAbove = radii.length > 1 && i % 2 === 1; // 相邻节点标签上下交错，减少遮挡
      }
    });
  }
  return positions;
}
