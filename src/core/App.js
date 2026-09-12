import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { updateTweens } from './Tween.js';
import { LAYOUT } from '../config.js';

// 场景基础：渲染、相机、轨道控制、辉光后期、拾取（hover / click）与主循环
export class App {
  constructor(canvas, labelRoot) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    this.camera.position.set(...LAYOUT.camera.position);

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
    this.controls.autoRotateSpeed = 0.35;
    this.autoRotateWanted = true;
    this.idleTimer = 0;

    // 后期：轻辉光，阈值较高 → 只有亮的节点与流光发光，背景网格保持克制
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bloomEnabled = true;

    this.labelRenderer = new CSS2DRenderer({ element: labelRoot });

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points = { threshold: 0.6 };
    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerPx = { x: 0, y: 0 };
    this.pointerMoved = false;
    this.pickables = []; // { object, onHover(hit|null), onClick(hit) }
    this.hovered = null;
    this.lastFrame = performance.now();
    this.time = 0;
    this.updaters = new Set();
    this.onFrameHooks = new Set();

    this._bindEvents();
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
      if (!moved && e.button === 0) this._click();
    });
    c.addEventListener('wheel', () => this._userActive(), { passive: true });
    window.addEventListener('resize', () => this.resize());
  }

  _userActive() { this.controls.autoRotate = false; this.idleTimer = 0; }

  _click() {
    const hit = this._pick();
    if (hit) hit.entry.onClick?.(hit.intersection);
    else this.onBackgroundClick?.();
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects = [];
    for (const p of this.pickables) if (p.object.visible !== false && p.enabled !== false) objects.push(p.object);
    const hits = this.raycaster.intersectObjects(objects, false);
    if (!hits.length) return null;
    const entry = this.pickables.find((p) => p.object === hits[0].object);
    return { entry, intersection: hits[0] };
  }

  addPickable(entry) { this.pickables.push(entry); return entry; }
  removePickable(object) { const i = this.pickables.findIndex((p) => p.object === object); if (i >= 0) this.pickables.splice(i, 1); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  setBloom(on) { this.bloomEnabled = on; }
  setAutoRotate(on) { this.autoRotateWanted = on; this.controls.autoRotate = on; }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.time += dt;
      updateTweens(dt);
      // hover 拾取（仅在指针移动后做一次射线检测）
      if (this.pointerMoved) {
        this.pointerMoved = false;
        const hit = this._pick();
        const entry = hit?.entry || null;
        if (this.hovered !== entry) { this.hovered?.onHover?.(null); this.hovered = entry; }
        entry?.onHover?.(hit.intersection, this.pointerPx);
        this.canvas.style.cursor = entry?.onClick ? 'pointer' : 'default';
      }
      for (const u of this.updaters) u(dt, this.time);
      // 空闲 20s 后恢复自动旋转
      if (this.autoRotateWanted && !this.controls.autoRotate && !this.focusLocked) { this.idleTimer += dt; if (this.idleTimer > 20) this.controls.autoRotate = true; }
      this.controls.update();
      if (this.bloomEnabled) this.composer.render(); else this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      for (const h of this.onFrameHooks) h();
    };
    loop();
  }
}
