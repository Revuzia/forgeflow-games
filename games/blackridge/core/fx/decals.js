// core/fx/decals.js [A7] — pooled bullet holes / scorch marks.
// Ring buffer of 256 instanced quads (architecture §3.14), ~20 s lifetime
// (14 s full + 6 s fade — VT §5 "decal ring buffer, ~20 s fade"; permanence
// is D6 hard-cap insurance). One InstancedMesh, one ShaderMaterial, one
// draw call. Fade is GPU-side (aBirth attribute vs uTime uniform) — zero
// per-frame CPU after spawn. Internal to fx.js.

import * as THREE from "three";

const FULL_S = 14; // opaque window
const OUT_S = 6;   // fade-out window (total ≈ 20 s)
const N = 256;

// 2-frame atlas: left = bullet hole, right = scorch.
function atlasTexture() {
  const cv = document.createElement("canvas");
  cv.width = 128; cv.height = 64;
  const g = cv.getContext("2d");

  // bullet hole: dark ragged core + faint fracture ring
  let gr = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  gr.addColorStop(0.0, "rgba(8,8,8,0.95)");
  gr.addColorStop(0.28, "rgba(14,13,12,0.85)");
  gr.addColorStop(0.5, "rgba(30,28,26,0.45)");
  gr.addColorStop(0.75, "rgba(52,50,47,0.16)");
  gr.addColorStop(1.0, "rgba(60,58,55,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  // chipped rim flecks (deterministic spiral, no rng needed)
  g.fillStyle = "rgba(10,10,10,0.5)";
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996; // golden angle — irregular, repeatable
    const r = 7 + (i % 3) * 4;
    g.fillRect(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 2, 2);
  }

  // scorch: soft irregular black blot (three offset radial layers)
  const blot = (x, y, r, a) => {
    const s = g.createRadialGradient(x, y, 1, x, y, r);
    s.addColorStop(0, `rgba(6,6,6,${a})`);
    s.addColorStop(0.6, `rgba(10,9,8,${a * 0.55})`);
    s.addColorStop(1, "rgba(12,11,10,0)");
    g.fillStyle = s;
    g.fillRect(64, 0, 64, 64);
  };
  blot(96, 32, 30, 0.85);
  blot(88, 26, 18, 0.6);
  blot(104, 38, 16, 0.55);

  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aKind;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = vec2((uv.x + aKind) * 0.5, uv.y);
  float age = uTime - aBirth;
  vFade = (age < 0.0) ? 0.0
        : clamp(1.0 - (age - ${FULL_S.toFixed(1)}) / ${OUT_S.toFixed(1)}, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vFade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb, a);
}`;

const _q = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);
const _ZAXIS = new THREE.Vector3(0, 0, 1);

export function makeDecals(env) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const birth = new Float32Array(N).fill(-1e9);
  const kind = new Float32Array(N);
  const birthAttr = new THREE.InstancedBufferAttribute(birth, 1);
  const kindAttr = new THREE.InstancedBufferAttribute(kind, 1);
  birthAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aBirth", birthAttr);
  geo.setAttribute("aKind", kindAttr);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: atlasTexture() }, uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = "fx.decals";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // park every instance at zero scale so nothing flickers pre-spawn
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, _m);
  env.root.add(mesh);

  let cursor = 0;
  let spawned = 0;
  const rnd = env.rng;

  return {
    // kind: 0 = bullet hole, 1 = scorch. size = quad edge in metres.
    spawn(pos, normal, kindId, size) {
      const i = cursor;
      cursor = (cursor + 1) % N;
      _n.set(normal[0], normal[1], normal[2]);
      if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
      _n.normalize();
      _q.setFromUnitVectors(_Z, _n);
      _qRoll.setFromAxisAngle(_ZAXIS, rnd() * Math.PI * 2);
      _q.multiply(_qRoll);
      // normal-offset with a per-decal jitter so stacked decals never z-fight
      const off = 0.006 + rnd() * 0.006;
      _p.set(pos[0] + _n.x * off, pos[1] + _n.y * off, pos[2] + _n.z * off);
      _s.set(size, size, 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      birth[i] = env.now();
      kind[i] = kindId;
      mesh.instanceMatrix.needsUpdate = true;
      birthAttr.needsUpdate = true;
      kindAttr.needsUpdate = true;
      spawned++;
      return i;
    },
    update() { mat.uniforms.uTime.value = env.now(); },
    clear() {
      birth.fill(-1e9);
      birthAttr.needsUpdate = true;
    },
    prewarmables() { return [mesh]; },
    spawnedCount: () => spawned,
  };
}
