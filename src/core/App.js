import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { updateTweens } from './Tween.js';
import { LAYOUT, QUALITY } from '../config.js';

const PICK_LAYER = 1; // 拾取网格只在 layer 1：相机不渲染它们，射线只检测它们

// 场景基础：渲染、相机、轨道控制、后期（MSAA + 辉光 + 色调映射）、分层拾取、画质自适应、7×24 自愈
export class App {
  constructor(canvas, labelRoot) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    this.camera.position.set(...LAYOUT.camera.position);
    this.camera.layers.set(0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...LAYOUT.camera.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 220;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.3;
    this.autoRotateWanted = true;
    this.idleTimer = 0;
    // 相机自己在动（自动旋转 / 飞行 / 阻尼）时也要重新做一次命中检测
    this.controls.addEventListener('change', () => { this.pointerMoved = true; });

    // 后期：MSAA 渲染目标 → 轻辉光（半分辨率）→ 色调映射输出
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.4, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bloomWanted = true;

    this.labelRenderer = new CSS2DRenderer({ element: labelRoot });
    this.labelRenderer.sortObjects = false;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(PICK_LAYER);
    this.raycaster.params.Points = { threshold: 0.6 };
    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerPx = { x: 0, y: 0 };
    this.pointerMoved = false;
    this.pickables = new Map(); // object → { object, tier, enabled, onHover, onClick }
    this.hovered = null;
    this.lastFrame = performance.now();
    this.time = 0;
    this.updaters = new Set();
    this.onFrameHooks = new Set();

    // 画质档位与自适应
    this.quality = 'high'; this.autoQuality = true; this.frameMs = 16; this.slowFor = 0; this.fastFor = 0; this.onQuality = null;
    this.errorStreak = 0;

    this._bindEvents();
    this._bindResilience();
    this.resize();
  }

  _bindEvents() {
    const c = this.canvas;
    let downPos = null;
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.pointerPx.x = e.clientX - r.left; this.pointerPx.y = e.clientY - r.top;
      this.pointer.x = (this.pointerPx.x / r.width) * 2 - 1;
      this.pointer.y = -(this.pointerPx.y / r.height) * 2 + 1;
      this.pointerMoved = true;
    });
    c.addEventListener('pointerleave', () => { this.pointer.set(-10, -10); this.pointerMoved = true; });
    c.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; this._userActive(); });
    c.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5;
      downPos = null;
      if (!moved && e.button === 0) this._click(e);
    });
    c.addEventListener('wheel', (e) => { this._userActive(); this.onWheel?.(e); }, { passive: true });
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => this.resize(), 150); });
  }

  // 7×24 大屏自愈：WebGL 上下文丢失 → 提示并在恢复后重载；渲染循环停滞 → 重载；页面隐藏时不累计时间
  _bindResilience() {
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.onContextLost?.(); });
    this.canvas.addEventListener('webglcontextrestored', () => { this.onBeforeReload?.(); location.reload(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.lastFrame = performance.now(); });
    setInterval(() => {
      if (document.visibilityState !== 'visible' || this.contextLost) return;
      if (performance.now() - this.lastFrame > 10000) { this.onBeforeReload?.(); location.reload(); }
    }, 5000);
  }

  _userActive() { this.controls.autoRotate = false; this.idleTimer = 0; this.onUserActive?.(); }

  _click(e) {
    const hit = this._pick();
    if (hit) hit.entry.onClick?.(hit.intersection, e);
    else this.onBackgroundClick?.(e);
  }

  // 分层拾取：业务节点 / 组件 / 出口（tier 0）优先于连线（1）优先于终端点（2）；不可见或被禁用的对象不参与
  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const byTier = [[], [], []];
    for (const p of this.pickables.values()) if (p.enabled !== false && isShown(p.object)) byTier[p.tier || 0].push(p.object);
    for (const objs of byTier) {
      if (!objs.length) continue;
      const hits = this.raycaster.intersectObjects(objs, false);
      if (hits.length) return { entry: this.pickables.get(hits[0].object), intersection: hits[0] };
    }
    return null;
  }

  // renderable = true 表示该对象同时要显示（如终端点云），否则只做拾取、不渲染
  addPickable(entry) {
    if (entry.renderable) entry.object.layers.enable(PICK_LAYER); else entry.object.layers.set(PICK_LAYER);
    this.pickables.set(entry.object, entry);
    return entry;
  }
  removePickable(object) {
    if (this.hovered?.object === object) { this.hovered.onHover?.(null); this.hovered = null; }
    this.pickables.delete(object);
  }
  clearHover() { if (this.hovered) { this.hovered.onHover?.(null); this.hovered = null; } }

  get renderPixelRatio() {
    const cap = Math.min(window.devicePixelRatio || 1, QUALITY.maxRenderWidth / Math.max(1, window.innerWidth), 2);
    return this.quality === 'high' ? cap : this.quality === 'balanced' ? cap * 0.75 : Math.min(cap, 0.7);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.renderPixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderPixelRatio);
    this.composer.setSize(w, h);
    const pr = this.renderPixelRatio;
    this.bloom.setSize(Math.round(w * pr * 0.5), Math.round(h * pr * 0.5)); // 辉光本身是模糊，半分辨率无损
    this.labelRenderer.setSize(w, h);
  }

  setBloom(on) { this.bloomWanted = on; this.bloom.enabled = on && this.quality !== 'low'; }
  setAutoRotate(on) { this.autoRotateWanted = on; this.controls.autoRotate = on; }

  // 画质档位：high（满分辨率，上限 2560 宽）/ balanced（0.75×）/ low（0.7× 且关闭辉光）
  setQuality(q, { auto = false } = {}) {
    if (!['high', 'balanced', 'low'].includes(q) || q === this.quality) return;
    this.quality = q;
    if (!auto) this.autoQuality = false;
    this.resize();
    this.setBloom(this.bloomWanted);
    this.onQuality?.(q, auto);
  }

  _adapt(ms) {
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (!this.autoQuality) return;
    if (this.frameMs > QUALITY.degradeMs) { this.slowFor += ms; this.fastFor = 0; } else if (this.frameMs < QUALITY.recoverMs) { this.fastFor += ms; this.slowFor = 0; } else { this.slowFor = 0; this.fastFor = 0; }
    const order = ['high', 'balanced', 'low'];
    const i = order.indexOf(this.quality);
    if (this.slowFor > 3000 && i < 2) { this.slowFor = 0; this.setQuality(order[i + 1], { auto: true }); }
    if (this.fastFor > 15000 && i > 0) { this.fastFor = 0; this.setQuality(order[i - 1], { auto: true }); }
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const ms = now - this.lastFrame;
      const dt = Math.min(ms / 1000, 0.05);
      this.lastFrame = now;
      this.time += dt;
      try {
        updateTweens(dt);
        if (this.pointerMoved) {
          this.pointerMoved = false;
          const hit = this._pick();
          const entry = hit?.entry || null;
          if (this.hovered !== entry) { this.hovered?.onHover?.(null); this.hovered = entry; }
          entry?.onHover?.(hit.intersection, this.pointerPx);
          this.canvas.style.cursor = entry?.onClick ? 'pointer' : 'default';
        }
        for (const u of this.updaters) u(dt, this.time);
        if (this.autoRotateWanted && !this.controls.autoRotate && !this.focusLocked) { this.idleTimer += dt; if (this.idleTimer > 20) this.controls.autoRotate = true; }
        this.controls.update();
        this.composer.render();
        this.labelRenderer.render(this.scene, this.camera);
        for (const h of this.onFrameHooks) h(dt);
        this.errorStreak = 0;
      } catch (err) {
        console.error(err);
        if (++this.errorStreak >= 3) { this.onBeforeReload?.(); location.reload(); }
      }
      if (ms < 500) this._adapt(ms);
    };
    loop();
  }
}

function isShown(o) { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; }
