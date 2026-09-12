import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LAYOUT, THEME, LEVELS } from '../config.js';

// 分层圆盘：环形刻度网格 + 外圈亮边 + 极慢的雷达扫描，作为三个业务层的“地面”
const discShader = {
  vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uRadius; uniform float uOpacity; uniform float uTime; uniform float uDim;
    varying vec3 vPos;
    float lineAt(float d, float w){ return 1.0 - smoothstep(0.0, w, d); }
    void main(){
      float len = length(vPos.xy);
      float r = len / uRadius;
      if (r > 1.0) discard;
      float ang = atan(vPos.y, vPos.x);
      // 5 圈同心环
      float fr = fract(r * 5.0);
      float ringD = min(fr, 1.0 - fr) / 5.0 * uRadius;
      float rings = lineAt(ringD, 0.09) * 0.55;
      // 24 条径向线
      float fa = fract(ang / 6.2831853 * 24.0);
      float spokeD = min(fa, 1.0 - fa) * (6.2831853 * len / 24.0);
      float spokes = lineAt(spokeD, 0.07) * 0.3 * smoothstep(0.05, 0.25, r);
      // 外缘亮边
      float rim = lineAt((1.0 - r) * uRadius, 0.22) * 1.4 + lineAt((1.0 - r) * uRadius, 1.6) * 0.25;
      // 基础填充：中心略亮
      float fill = 0.10 * (1.0 - r * 0.7);
      // 雷达扫描：极慢、极淡
      float sweep = pow(fract(ang / 6.2831853 - uTime * 0.03), 12.0) * 0.28 * smoothstep(0.1, 0.5, r);
      float a = (fill + rings + spokes + rim + sweep) * uOpacity * uDim;
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
      uniforms: { uColor: { value: new THREE.Color(THEME.disc[level]) }, uRadius: { value: cfg.radius }, uOpacity: { value: 1 }, uTime: { value: 0 }, uDim: { value: 1 } },
      ...discShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = cfg.y;
    disc.renderOrder = -10;
    group.add(disc);

    const el = document.createElement('div');
    el.className = 'lbl layer';
    el.innerHTML = `${cfg.label}<small>${cfg.en}</small>`;
    const label = new CSS2DObject(el);
    const a = -Math.PI * 0.72;
    label.position.set(Math.cos(a) * (cfg.radius + 5), cfg.y + 0.5, Math.sin(a) * (cfg.radius + 5));
    group.add(label);
    layers[level] = { disc, mat, label, el };
  }
  group.update = (dt, t) => { for (const l of Object.values(layers)) l.mat.uniforms.uTime.value = t; };
  group.setDim = (d) => { for (const l of Object.values(layers)) { l.mat.uniforms.uDim.value = d; l.el.classList.toggle('dim', d < 0.5); } };
  // 分层查看：当前层圆盘完整显示，其它层虚化
  group.setLayerDims = (level) => { for (const [lv, l] of Object.entries(layers)) { const on = level === 'all' || lv === level; l.mat.uniforms.uDim.value = on ? 1 : 0.16; l.el.classList.toggle('dim', !on); } };
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
