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
  points.update = (dt, t) => { m.uniforms.uTime.value = t; points.rotation.y = t * 0.004; };
  return points;
}
