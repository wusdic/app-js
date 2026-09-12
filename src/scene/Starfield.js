import * as THREE from 'three';

// 星空背景：远处的静态星点 + 缓慢闪烁，营造氛围但不抢视线
export function createStarfield(count = 2600, prUniform = { value: Math.min(window.devicePixelRatio, 2) }) {
  const pos = new Float32Array(count * 3);
  const seedArr = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = 260 + Math.random() * 420;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.8;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    seedArr[i] = Math.random();
    size[i] = Math.random() < 0.06 ? 2.6 + Math.random() * 2 : 0.8 + Math.random() * 1.4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: prUniform },
    vertexShader: `
      attribute float aSeed; attribute float aSize; uniform float uTime; uniform float uPixelRatio;
      varying float vA; varying float vSeed;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed * 1.4) + aSeed * 40.0);
        vA = tw * (0.35 + aSeed * 0.45);
        vSeed = aSeed;
        gl_PointSize = aSize * uPixelRatio * 1.6;
      }`,
    fragmentShader: `
      varying float vA; varying float vSeed;
      void main(){
        vec2 d = gl_PointCoord - 0.5; float r = length(d);
        float a = smoothstep(0.5, 0.08, r) * vA;
        vec3 col = mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.92, 0.82), step(0.82, vSeed));
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  // 星云天幕：深蓝 / 紫的缓慢流动云气，铺在最远处
  const nebulaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vP;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.05 + 7.3; a *= 0.5; } return s; }
      void main(){
        vec3 p = vP * 3.0 + vec3(uTime * 0.008, 0.0, uTime * 0.005);
        float n = fbm(p); float n2 = fbm(p * 1.7 + 11.0);
        float cloud = smoothstep(0.42, 0.78, n) * 0.55 + smoothstep(0.5, 0.85, n2) * 0.35;
        vec3 col = mix(vec3(0.10, 0.22, 0.55), vec3(0.32, 0.16, 0.5), n2) * cloud;
        float band = smoothstep(-0.6, 0.15, vP.y) * smoothstep(0.9, 0.2, vP.y); // 地平线附近更浓
        float a = cloud * 0.16 * (0.5 + 0.5 * band);
        gl_FragColor = vec4(col * 0.8, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide,
  });
  const nebula = new THREE.Mesh(new THREE.SphereGeometry(720, 48, 32), nebulaMat);
  nebula.renderOrder = -100; nebula.frustumCulled = false;
  const group = new THREE.Group(); group.add(nebula, points);
  group.update = (dt, t) => { m.uniforms.uTime.value = t; nebulaMat.uniforms.uTime.value = t; points.rotation.y = t * 0.004; };
  return group;
}
