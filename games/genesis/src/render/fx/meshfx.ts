// GENESIS — mesh FX of the god layer (CONTRACT.md §15.7): the shapes particles cannot make.
//   Funnel    a tornado: a roped, twisting condensation funnel from the cloud base to a debris-wrapped foot
//   Dome      a shield miracle: a hemisphere of light with a hexagonal lattice, a fresnel rim and ripples
//   Shell     a shockwave's condensation shell, racing out from an impact
//   Fireball  an expanding ball of fire: turbulent, white-gold at its heart, cooling to red and smoke at its skin
//   Bolide    a falling body: an incandescent head in a plasma sheath stretched behind it, and its trail
//   Comet     a coma and a two-part tail (dust curving, ion straight) pointing away from the star
//   Debris    instanced rocks thrown on ballistic arcs (or lifted, for a gravity slip), tumbling, lit like the ground
// Each is drawn over the composited image (FX layer) and soft-tested against the scene's depth, except the debris,
// which are opaque, lit and shadowed in the scene itself. Every one fades in and out by a `k` uniform.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SphereGeometry, Vector3, type IUniform, type MeshStandardMaterial,
} from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { FX_DEPTH_GLSL, FX_LAYER } from './fxcommon.ts';
import { makePropMaterial } from './propmat.ts';
import { boulderGeo } from '../hand.ts';

const COMMON_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vV;
varying float vZ;
varying vec3 vWorldN;
`;

function fxMaterial(vert: string, frag: string, uniforms: Record<string, IUniform>, additive: boolean, fx: Record<string, IUniform>, shared?: Record<string, IUniform>): ShaderMaterial {
  const u: Record<string, IUniform> = { ...uniforms };
  for (const k of Object.keys(fx)) u[k] = fx[k];
  if (shared) for (const k of Object.keys(shared)) if (!(k in u)) u[k] = shared[k];
  return new ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, uniforms: u, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    blending: additive ? AdditiveBlending : CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
  });
}

// ───────────────────────────── tornado ─────────────────────────────

const FUNNEL_VERT = /* glsl */ `
${COMMON_VERT}
uniform float uFxTime;
uniform float uH;
uniform float uRBase;
uniform float uRTop;
uniform float uSeed;
uniform float uLayer;
varying float vY;
varying float vAng;
void main() {
  float y = position.y;              // 0 foot .. 1 cloud base
  float ang = atan(position.z, position.x);
  // the rope: thin over most of its height, flaring into the wall cloud at the top, a wider foot
  float r = mix(uRBase, uRTop, pow(y, 3.2)) * (1.0 + 0.6 * exp(-y * 14.0));
  r *= 1.0 + 0.12 * sin(y * 23.0 - uFxTime * 6.0 + uSeed) + 0.08 * uLayer;
  // it snakes: a slow bend that grows with height, swaying in time
  vec2 bend = vec2(sin(y * 2.6 + uFxTime * 0.35 + uSeed), cos(y * 2.1 + uFxTime * 0.28 + uSeed * 1.7)) * uH * 0.06 * y * y;
  vec3 p = vec3(cos(ang) * r + bend.x, y * uH, sin(ang) * r + bend.y);
  vLocal = vec3(ang, y, r);
  vY = y; vAng = ang;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(vec3(cos(ang), 0.15, sin(ang)));
  vN = normalize(normalMatrix * n);
  vWorldN = n;
  vV = -mv.xyz;
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const FUNNEL_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON_VERT}
uniform float uK;
uniform float uLayer;
uniform float uSeed;
uniform vec3 uLight;
uniform vec3 uDust;
varying float vY;
varying float vAng;
void main() {
  float vis = fxSoft(vZ, 4.0);
  if (vis <= 0.0) discard;
  // the spinning bands of condensation and dust: noise in (angle − spin, height) scrolling upward
  float spin = uFxTime * (2.4 + uLayer * 0.8);
  vec3 q = vec3(cos(vAng - spin) * 2.0, vY * 14.0 - uFxTime * 1.8, sin(vAng - spin) * 2.0 + uSeed);
  float n = fbm3(q) * 0.6 + 0.5 * snoise(q * 2.7 + 3.0) * 0.4;
  float bands = 0.5 + 0.5 * sin(vY * 70.0 + (vAng - spin) * 3.0 + n * 4.0);
  float dens = smoothstep(-0.2, 0.6, n + 0.25 * bands);
  // the sheath is thin at the silhouette's edge-on parts, opaque where seen through its depth
  float nv = abs(dot(normalize(vN), normalize(vV)));
  float edge = mix(1.0, 0.35, pow(nv, 2.0));
  float a = dens * edge * uK * vis * mix(0.85, 0.45, uLayer);
  // fade at the very top into the cloud, and at the foot into the dust skirt
  a *= smoothstep(1.0, 0.86, vY) * mix(0.6, 1.0, smoothstep(0.0, 0.08, vY));
  // colour: dust brown at the foot, grey condensation above, darker in the core
  vec3 c = mix(uDust, vec3(0.52, 0.54, 0.56), smoothstep(0.05, 0.4, vY));
  c *= 0.55 + 0.45 * n + 0.2 * (1.0 - nv);
  vec3 col = c * uLight;
  gl_FragColor = vec4(col * a, a);
}
`;

export class Funnel {
  readonly group = new Group();
  readonly u = {
    uH: { value: 600 }, uRBase: { value: 20 }, uRTop: { value: 120 }, uSeed: { value: 0 }, uK: { value: 0 },
    uLight: { value: new Vector3(1, 1, 1) }, uDust: { value: new Vector3(0.35, 0.27, 0.19) },
  };
  private meshes: Mesh[] = [];
  constructor(fx: Record<string, IUniform>) {
    this.group.matrixAutoUpdate = false;
    const geo = tube(28, 64);
    for (let l = 0; l < 2; l++) {
      const m = new Mesh(geo, fxMaterial(FUNNEL_VERT, FUNNEL_FRAG, { ...this.u, uLayer: { value: l } }, false, fx));
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.layers.set(FX_LAYER);
      m.renderOrder = 4 + l;
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  /** stand at body-frame point p (m) */
  place(p: Vector3, matrix: Matrix4): void { for (const m of this.meshes) { m.matrix.copy(matrix); m.matrixWorldNeedsUpdate = true; } void p; }
  dispose(): void { for (const m of this.meshes) (m.material as ShaderMaterial).dispose(); this.meshes[0]?.geometry.dispose(); }
}

/** an open tube: unit radius at x,z, y from 0 to 1 */
function tube(seg: number, rings: number): BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(a), j / rings, Math.sin(a));
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

// ───────────────────────────── shield dome / shockwave shell / fireball ─────────────────────────────

const SPHERE_VERT = /* glsl */ `
${COMMON_VERT}
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vWorldN = normal;
  vV = -mv.xyz;
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const DOME_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON_VERT}
uniform float uK;
uniform vec3 uCol;
uniform float uHit;
void main() {
  if (vLocal.y < -0.02) discard;
  float vis = fxSoft(vZ, 3.0);
  float nv = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - nv, 3.0);
  // a hexagonal lattice over the dome
  vec2 uv = vec2(atan(vLocal.z, vLocal.x) * 7.0, vLocal.y * 9.0);
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float hex = smoothstep(0.42, 0.5, max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y)));
  // ripples running up from the ground and from hits
  float rip = 0.5 + 0.5 * sin(vLocal.y * 30.0 - uFxTime * 3.0);
  float shimmer = 0.6 + 0.4 * snoise(vec3(uv * 0.5, uFxTime * 0.4));
  float k = (rim * 1.2 + hex * 0.35 * shimmer + 0.06 + rip * 0.06 + uHit * 0.6 * (1.0 - nv)) * uK * vis;
  // brighter at the base where it meets the ground
  k *= 1.0 + 1.5 * smoothstep(0.12, 0.0, vLocal.y);
  gl_FragColor = vec4(uCol * k * fxDisplay(0.7), 0.0);
}
`;

const SHELL_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON_VERT}
uniform float uK;
uniform vec3 uLight;
void main() {
  if (vLocal.y < -0.05) discard;
  float vis = fxSoft(vZ, 4.0);
  float nv = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - nv, 4.0);
  float a = rim * uK * vis * 0.85;
  gl_FragColor = vec4(uLight * 1.2 * a, a);
}
`;

const FIREBALL_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON_VERT}
uniform float uK;
uniform float uHeat;
uniform float uSeed;
void main() {
  float vis = fxSoft(vZ, 2.0);
  float nv = abs(dot(normalize(vN), normalize(vV)));
  // boiling turbulence on the skin; hotter toward the middle of the disc as seen
  vec3 q = normalize(vLocal) * 2.2 + vec3(0.0, -uFxTime * 0.8, uSeed);
  float n = fbm3(q) * 0.7 + 0.3 * snoise(q * 3.1 + uFxTime * 0.5);
  float t = clamp(uHeat * (0.45 + 0.75 * nv) + n * 0.35, 0.0, 1.0);
  vec3 c = mix(vec3(0.5, 0.04, 0.0), vec3(1.0, 0.32, 0.03), smoothstep(0.1, 0.5, t));
  c = mix(c, vec3(1.0, 0.82, 0.45), smoothstep(0.55, 0.95, t));
  // as it cools the skin turns to black smoke (alpha cover, little light)
  float smoke = smoothstep(0.35, 0.05, t);
  float a = uK * vis * smoothstep(0.0, 0.25, nv + 0.15 * n);
  vec3 emit = c * mix(30.0, 0.0, smoke) * fxDisplay(0.3);
  gl_FragColor = vec4(emit * a + vec3(0.02) * smoke * a, a * mix(0.75, 0.95, smoke));
}
`;

export class Dome {
  readonly mesh: Mesh;
  readonly u = { uK: { value: 0 }, uCol: { value: new Vector3(1.0, 0.8, 0.45) }, uHit: { value: 0 } };
  constructor(fx: Record<string, IUniform>) {
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2 + 0.05), fxMaterial(SPHERE_VERT, DOME_FRAG, this.u, true, fx));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 6;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

export class Shell {
  readonly mesh: Mesh;
  readonly u = { uK: { value: 0 }, uLight: { value: new Vector3(1, 1, 1) } };
  constructor(fx: Record<string, IUniform>) {
    this.mesh = new Mesh(new SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2 + 0.1), fxMaterial(SPHERE_VERT, SHELL_FRAG, this.u, false, fx));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 7;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

export class Fireball {
  readonly mesh: Mesh;
  readonly u = { uK: { value: 0 }, uHeat: { value: 1 }, uSeed: { value: Math.random() * 10 } };
  constructor(fx: Record<string, IUniform>) {
    this.mesh = new Mesh(new SphereGeometry(1, 40, 24), fxMaterial(SPHERE_VERT, FIREBALL_FRAG, this.u, false, fx));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 8;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

// ───────────────────────────── a falling body ─────────────────────────────

const HEAD_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON_VERT}
uniform float uK;
uniform vec3 uCol;
void main() {
  float vis = fxSoft(vZ, 2.0);
  float nv = abs(dot(normalize(vN), normalize(vV)));
  float n = 0.75 + 0.25 * snoise(vLocal * 4.0 + uFxTime * 6.0);
  vec3 c = mix(uCol, vec3(1.0, 0.95, 0.85), pow(nv, 2.0)) * (20.0 + 40.0 * pow(nv, 3.0)) * n;
  gl_FragColor = vec4(c * uK * vis * fxDisplay(0.25), 0.0);
}
`;

/** a glowing stretched sheath and a ribbon trail: the trail is a camera-facing strip along -axis */
const TRAIL_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
uniform vec3 uHead;
uniform vec3 uAxis;
uniform float uLen;
uniform float uW;
uniform vec3 uCamB;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec3 p = uHead - uAxis * uLen * aT;
  vec3 view = normalize(uCamB - p);
  vec3 sideV = normalize(cross(uAxis, view));
  float w = uW * mix(1.0, 3.5, pow(aT, 0.7)) * (1.0 - smoothstep(0.7, 1.0, aT) * 0.5);
  p += sideV * aSide * w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const TRAIL_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
uniform float uK;
uniform vec3 uCol;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 6.0);
  float across = 1.0 - abs(vSide);
  float n = 0.6 + 0.4 * snoise(vec3(vT * 18.0 - uFxTime * 9.0, vSide * 3.0, 1.0));
  float core = pow(across, 3.0) * exp(-vT * 4.0);
  float halo = pow(across, 1.4) * exp(-vT * 1.6) * n;
  vec3 c = mix(uCol, vec3(1.0, 0.95, 0.85), core) * (core * 60.0 + halo * 8.0);
  gl_FragColor = vec4(c * uK * vis * fxDisplay(0.3), 0.0);
}
`;

export class Bolide {
  readonly group = new Group();
  readonly head: Mesh;
  readonly sheath: Mesh;
  readonly trail: Mesh;
  readonly u = {
    uK: { value: 0 }, uCol: { value: new Vector3(1.0, 0.55, 0.22) }, uHead: { value: new Vector3() }, uAxis: { value: new Vector3(0, -1, 0) },
    uLen: { value: 800 }, uW: { value: 6 }, uCamB: { value: new Vector3() },
  };
  constructor(fx: Record<string, IUniform>) {
    this.group.matrixAutoUpdate = false;
    this.head = new Mesh(new SphereGeometry(1, 24, 16), fxMaterial(SPHERE_VERT, HEAD_FRAG, this.u, true, fx));
    this.sheath = new Mesh(new SphereGeometry(1, 24, 16), fxMaterial(SPHERE_VERT, HEAD_FRAG, { ...this.u, uK: this.u.uK }, true, fx));
    const n = 48;
    const pos = new Float32Array(n * 2 * 3), t = new Float32Array(n * 2), side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const a = i / (n - 1); t[i * 2] = a; t[i * 2 + 1] = a; side[i * 2] = 1; side[i * 2 + 1] = -1; }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aT', new BufferAttribute(t, 1));
    g.setAttribute('aSide', new BufferAttribute(side, 1));
    g.setIndex(idx);
    this.trail = new Mesh(g, fxMaterial(TRAIL_VERT, TRAIL_FRAG, this.u, true, fx));
    for (const m of [this.head, this.sheath, this.trail]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.layers.set(FX_LAYER); m.renderOrder = 9; this.group.add(m); }
  }
  /** head at p (body frame), flying along unit `axis`, radius r */
  place(p: Vector3, axis: Vector3, r: number, camB: Vector3): void {
    this.head.matrix.makeScale(r, r, r).setPosition(p);
    // the sheath stretched back along the flight
    const back = _v1.copy(axis).multiplyScalar(-r * 1.6).add(p);
    const z = _v2.copy(axis);
    const x = _v3.set(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0).cross(z);
    x.normalize();
    const y = _v4.crossVectors(z, x);
    this.sheath.matrix.makeBasis(x.multiplyScalar(r * 2.2), y.multiplyScalar(r * 2.2), z.multiplyScalar(r * 4.5)).setPosition(back);
    (this.u.uHead.value as Vector3).copy(p);
    (this.u.uAxis.value as Vector3).copy(axis);
    (this.u.uCamB.value as Vector3).copy(camB);
    for (const m of [this.head, this.sheath, this.trail]) m.matrixWorldNeedsUpdate = true;
  }
  dispose(): void { for (const m of [this.head, this.sheath, this.trail]) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); } }
}

const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();

// ───────────────────────────── comet ─────────────────────────────

const COMET_VERT = /* glsl */ `
attribute vec2 corner;
uniform vec3 uHead;
uniform vec3 uAway;
uniform float uLen;
uniform float uW;
uniform vec3 uCamB;
uniform float uPart;
varying vec2 vC;
varying float vZ;
void main() {
  vC = corner;
  // u along the tail (0 coma → 1 end), v across
  float u = corner.y * 0.5 + 0.5;
  vec3 dir = uAway;
  // the dust tail curves away (lagging the orbit), the ion tail runs straight from the star
  vec3 view = normalize(uCamB - uHead);
  vec3 side = normalize(cross(dir, view));
  vec3 p = uHead + dir * uLen * u + side * (uPart > 0.5 ? u * u * uLen * 0.18 : 0.0);
  p += side * corner.x * uW * (0.2 + u * (uPart > 0.5 ? 2.5 : 0.8));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const COMET_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
uniform float uK;
uniform float uPart;
varying vec2 vC;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 50.0);
  float u = vC.y * 0.5 + 0.5;
  float across = 1.0 - abs(vC.x);
  float streaks = 0.7 + 0.3 * snoise(vec3(vC.x * 6.0, u * 3.0 - uFxTime * 0.2, uPart * 7.0));
  float k = pow(across, 1.5) * pow(1.0 - u, 1.6) * streaks;
  vec3 c = uPart > 0.5 ? vec3(1.0, 0.92, 0.75) : vec3(0.45, 0.7, 1.0);
  // the coma: a bright bead at the head
  k += exp(-u * 30.0) * pow(across, 2.0) * 3.0;
  gl_FragColor = vec4(c * k * uK * vis * 6.0 * fxDisplay(0.6), 0.0);
}
`;

export class Comet {
  readonly group = new Group();
  readonly u = { uK: { value: 0 }, uHead: { value: new Vector3() }, uAway: { value: new Vector3(0, 1, 0) }, uLen: { value: 20000 }, uW: { value: 1500 }, uCamB: { value: new Vector3() } };
  private meshes: Mesh[] = [];
  constructor(fx: Record<string, IUniform>) {
    this.group.matrixAutoUpdate = false;
    const g = new BufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (let part = 0; part < 2; part++) {
      const m = new Mesh(g, fxMaterial(COMET_VERT, COMET_FRAG, { ...this.u, uPart: { value: part } }, true, fx));
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.layers.set(FX_LAYER); m.renderOrder = 3;
      this.meshes.push(m); this.group.add(m);
    }
  }
  dispose(): void { for (const m of this.meshes) (m.material as ShaderMaterial).dispose(); this.meshes[0]?.geometry.dispose(); }
}

// ───────────────────────────── debris ─────────────────────────────

const DEBRIS_PARS = /* glsl */ `
attribute vec4 iO;     // origin (body m), birth time
attribute vec4 iV;     // velocity (m/s), size (m)
attribute vec4 iS;     // spin axis, mode (0 ballistic, 1 lift)
uniform float uFxTime;
uniform float uG;
mat3 rotAxis(vec3 a, float t) {
  float c = cos(t), s = sin(t), ic = 1.0 - c;
  return mat3(c + a.x * a.x * ic, a.y * a.x * ic + a.z * s, a.z * a.x * ic - a.y * s,
              a.x * a.y * ic - a.z * s, c + a.y * a.y * ic, a.z * a.y * ic + a.x * s,
              a.x * a.z * ic + a.y * s, a.y * a.z * ic - a.x * s, c + a.z * a.z * ic);
}
`;
const DEBRIS_NORMAL = /* glsl */ `
  float tD = max(0.0, uFxTime - iO.w);
  vec3 up0 = normalize(iO.xyz);
  vec3 pos0 = iO.xyz;
  vec3 at;
  float spinK = 1.0;
  if (iS.w < 0.5) {
    // ballistic: flight until the ground (the launch height), then it rests
    float vu = dot(iV.xyz, up0);
    float tLand = max(0.01, (2.0 * vu) / max(uG, 0.1));
    float tt = min(tD, tLand);
    at = pos0 + iV.xyz * tt - up0 * 0.5 * uG * tt * tt;
    spinK = tD < tLand ? 1.0 : 0.0;
    tD = tt;
  } else {
    // lifted (a gravity slip): rising slowly, tumbling
    at = pos0 + up0 * (tD * 1.2 + sin(tD * 0.7 + iO.w) * 0.6) + iV.xyz * 0.05 * tD;
  }
  float sz = iV.w * (iS.w < 0.5 ? 1.0 : smoothstep(0.0, 1.0, tD));
  mat3 R = rotAxis(normalize(iS.xyz + 1e-4), tD * 4.0 * spinK + iO.w * 7.0);
  vec3 objectNormal = R * normal;
`;
const DEBRIS_BEGIN = /* glsl */ `
  vec3 transformed = R * position * sz + at;
`;

/** a pool of tumbling rocks (ring buffer of instances); each `throw` adds some */
export class Debris {
  readonly mesh: InstancedMesh;
  private o: Float32Array;
  private v: Float32Array;
  private s: Float32Array;
  private head = 0;
  private readonly n: number;
  readonly gU: IUniform<number> = { value: 9.8 };

  constructor(shared: Record<string, IUniform>, fx: Record<string, IUniform>, n = 600) {
    this.n = n;
    const geo = boulderGeo(3);
    this.o = new Float32Array(n * 4).fill(0);
    this.v = new Float32Array(n * 4);
    this.s = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.o[i * 4 + 3] = -1e9;
    geo.setAttribute('iO', new InstancedBufferAttribute(this.o, 4));
    geo.setAttribute('iV', new InstancedBufferAttribute(this.v, 4));
    geo.setAttribute('iS', new InstancedBufferAttribute(this.s, 4));
    const mat: MeshStandardMaterial = makePropMaterial(shared, {
      key: 'debris', roughness: 0.92, vertexPars: DEBRIS_PARS, vertexNormal: DEBRIS_NORMAL, vertexBegin: DEBRIS_BEGIN,
      extraUniforms: { uFxTime: fx.uFxTime, uG: this.gU },
      // a fresh rock from an impact glows for a moment
      surface: '',
    });
    this.mesh = new InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _ident);
    this.mesh.layers.enable(1);
  }

  /** k rocks from p (body m), thrown outward from it with speed up to v (m/s), sizes up to sz (m), at FX time t */
  burst(p: Vector3, k: number, v: number, sz: number, t: number, mode = 0, spread = 1): void {
    const up = _u.copy(p).normalize();
    const e1 = _e1.set(0, 1, 0).cross(up);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).cross(up);
    e1.normalize();
    const e2 = _e2.crossVectors(up, e1);
    for (let j = 0; j < k; j++) {
      const i = this.head; this.head = (this.head + 1) % this.n;
      const a = Math.random() * Math.PI * 2, el = (0.35 + 0.55 * Math.random()) * spread;
      const sp = v * (0.3 + 0.7 * Math.random());
      const dx = Math.cos(a) * Math.cos(el), dz = Math.sin(a) * Math.cos(el), dy = Math.sin(el);
      const off = mode === 1 ? sz * 20 * Math.sqrt(Math.random()) : 0;
      this.o[i * 4] = p.x + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * off;
      this.o[i * 4 + 1] = p.y + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * off;
      this.o[i * 4 + 2] = p.z + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * off;
      this.o[i * 4 + 3] = t + (mode === 1 ? Math.random() * 3 : Math.random() * 0.08);
      this.v[i * 4] = (e1.x * dx + e2.x * dz + up.x * dy) * sp;
      this.v[i * 4 + 1] = (e1.y * dx + e2.y * dz + up.y * dy) * sp;
      this.v[i * 4 + 2] = (e1.z * dx + e2.z * dz + up.z * dy) * sp;
      this.v[i * 4 + 3] = sz * (0.25 + 0.75 * Math.random() ** 2);
      this.s[i * 4] = Math.random() - 0.5; this.s[i * 4 + 1] = Math.random() - 0.5; this.s[i * 4 + 2] = Math.random() - 0.5; this.s[i * 4 + 3] = mode;
    }
    for (const name of ['iO', 'iV', 'iS']) (this.mesh.geometry.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as MeshStandardMaterial).dispose(); }
}

const _ident = new Matrix4();
const _u = new Vector3(), _e1 = new Vector3(), _e2 = new Vector3();
// (sky/ATMO helpers are imported for materials that light their smoke; kept referenced for tree-shaking clarity)
void ATMO_PARS; void SKY_LOOKUP;
