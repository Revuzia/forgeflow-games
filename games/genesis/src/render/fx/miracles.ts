// GENESIS — miracles, seen (CONTRACT.md §11.1, §15.7): every 'miracle' event of the sim (data.kind) becomes a moment:
//   water      a dark cloud gathering over the place and a column of rain falling from it, ripples where it lands
//   food       loaves and fruit falling from the sky with soft streaks, bouncing, then a heap left in the square (about
//              as many as the sim gave), with golden sparkle; drawn big enough to read from the god's height
//   heal       a warm column of light, golden motes rising and spiralling through the people (sized to read from afar),
//              a ring of warm light spreading on the ground
//   forest     a green wave rolling out over the land, leaves and pollen swirling up (the trees are the sim's)
//   storm      black clouds boiling together and the first bolts (the thunderstorm itself is the sim's weather)
//   fire       a tongue of fire falling from the sky and bursting where it lands
//   shield     the ward: nearly invisible while it holds (a rim, a shimmer, a pulse of light running round its ground
//              ring); its lattice flares only where something strikes it; nothing of it from inside
//   lightning  a bolt (the 'lightning' event; GodFx strikes it) and scorched ground
//   fertility  green-gold motes and a swelling ring
//   calm       pale blue ripples spreading, soft motes, a gentle light
//   teach      threads of light from the sky into the heads of the people there, sparkling where they enter
//   wood       logs tumbling down into a stack
// The hand casts: GodFx turns the hand to its cast pose when a miracle lands near it.

import {
  BufferAttribute, BufferGeometry, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, ShaderMaterial, Vector3,
  type IUniform, type MeshStandardMaterial,
} from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { makePropMaterial } from './propmat.ts';
import type { SimEvent } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { DECAL, decal } from './decals.ts';
import { SYS } from './vfx.ts';
import { Dome } from './meshfx.ts';
import { frameAt, type FxCtx } from './disasters.ts';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER, clamp01, smooth } from './fxcommon.ts';

interface Shield { id: number; p: Vector3; r: number; until: number; dome: Dome; fade: number; hit: number; hitT: number; hitDir: Vector3 }
interface Moment { t0: number; dur: number; step(age: number, k: number, ctx: FxCtx): void; end?(): void }

const BEAM_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
uniform vec3 uCamB;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform float uK;
uniform vec3 uCol;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 1.0);
  float x = abs(vSide);
  float core = exp(-x * x * 30.0), halo = exp(-x * x * 3.0);
  // light pours down the thread: pulses travelling to the head
  float pulse = 0.6 + 0.4 * sin(vT * 40.0 + uFxTime * 9.0);
  float k = (core * 3.0 + halo * 0.6) * pulse * uK * vis * smoothstep(0.0, 0.08, vT) * (0.5 + 0.5 * vT);
  gl_FragColor = vec4(uCol * k * 4.0 * fxDisplay(0.7), 0.0);
}
`;

/** thin camera-facing threads of light from the sky down to points (teaching) */
class Beams {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();
  private pos: Float32Array;
  readonly u = { uK: { value: 0 }, uCol: { value: new Vector3(1, 0.85, 0.5) }, uCamB: { value: new Vector3() } };
  constructor(fx: Record<string, IUniform>, n: number) {
    const S = 24;
    this.pos = new Float32Array(n * (S + 1) * 2 * 3);
    const t = new Float32Array(n * (S + 1) * 2), side = new Float32Array(n * (S + 1) * 2);
    const idx: number[] = [];
    for (let b = 0; b < n; b++) for (let i = 0; i <= S; i++) {
      const k = (b * (S + 1) + i) * 2;
      t[k] = t[k + 1] = i / S; side[k] = 1; side[k + 1] = -1;
      if (i < S) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aT', new BufferAttribute(t, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    this.mesh = new Mesh(this.geo, new ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: { ...this.u, ...fx }, transparent: true, depthTest: false, depthWrite: false, ...ADD_LIGHT, side: DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER);
  }
  /** threads from tops to heads (body m), width w */
  set(tops: Vector3[], heads: Vector3[], cam: Vector3, w: number): void {
    const S = 24;
    const n = Math.min(tops.length, this.pos.length / ((S + 1) * 6));
    for (let b = 0; b < n; b++) {
      const a = tops[b], h = heads[b];
      for (let i = 0; i <= S; i++) {
        const t = i / S;
        // a gentle curve: the thread bows a little
        const p = _p.copy(a).lerp(h, t).addScaledVector(_q.copy(a).normalize(), Math.sin(t * Math.PI) * a.distanceTo(h) * 0.04);
        const dir = _d.copy(h).sub(a).normalize();
        const side = _s.crossVectors(dir, _v.copy(cam).sub(p)).normalize().multiplyScalar(w * (0.6 + 0.4 * t));
        const k = (b * (S + 1) + i) * 6;
        this.pos[k] = p.x + side.x; this.pos[k + 1] = p.y + side.y; this.pos[k + 2] = p.z + side.z;
        this.pos[k + 3] = p.x - side.x; this.pos[k + 4] = p.y - side.y; this.pos[k + 5] = p.z - side.z;
      }
    }
    this.geo.setDrawRange(0, n * S * 6);
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

const _p = new Vector3(), _q = new Vector3(), _d = new Vector3(), _s = new Vector3(), _v = new Vector3();
const _inv = new Matrix4();

/** an orthonormal pair round unit `up` */
function frameE(up: Vector3, e1: Vector3, e2: Vector3): void {
  e1.set(0, 1, 0).cross(up);
  if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).cross(up);
  e1.normalize();
  e2.crossVectors(up, e1);
}

const COLUMN_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
uniform vec3 uBase;
uniform vec3 uUp;
uniform float uHgt;
uniform float uW;
uniform vec3 uCamB;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec3 p = uBase + uUp * (aT * uHgt);
  vec3 view = normalize(uCamB - p);
  vec3 side = cross(uUp, view);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = max(uW * mix(1.0, 0.65, aT), length(uCamB - p) * 0.003);
  p += side * aSide * w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const COLUMN_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
uniform float uK;
uniform vec3 uCol;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 2.0);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  float body = exp(-x * x * 3.0) * (1.0 - smoothstep(0.85, 1.0, x));
  float core = exp(-x * x * 14.0);
  // light welling up the column
  float rise = 0.65 + 0.35 * snoise(vec3(vSide * 2.5, vT * 5.0 - uFxTime * 0.9, 2.0));
  float k = (core * 0.8 + body * 0.4) * rise * smoothstep(0.0, 0.06, vT) * (1.0 - smoothstep(0.45, 1.0, vT)) * uK * vis;
  gl_FragColor = vec4(uCol * k * fxDisplay(0.65), 0.0);
}
`;

/** a soft vertical column of light standing on the ground (the healing miracle's) */
class Column {
  readonly mesh: Mesh;
  readonly u = { uK: { value: 0 }, uCol: { value: new Vector3(1, 0.8, 0.45) }, uBase: { value: new Vector3() }, uUp: { value: new Vector3(0, 1, 0) }, uHgt: { value: 100 }, uW: { value: 10 }, uCamB: { value: new Vector3() } };
  constructor(fx: Record<string, IUniform>) {
    const N = 24;
    const g = new BufferGeometry();
    const t = new Float32Array(N * 2), side = new Float32Array(N * 2), idx: number[] = [];
    for (let i = 0; i < N; i++) { t[i * 2] = t[i * 2 + 1] = i / (N - 1); side[i * 2] = 1; side[i * 2 + 1] = -1; if (i < N - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); }
    g.setAttribute('position', new BufferAttribute(new Float32Array(N * 6), 3));
    g.setAttribute('aT', new BufferAttribute(t, 1));
    g.setAttribute('aSide', new BufferAttribute(side, 1));
    g.setIndex(idx);
    this.mesh = new Mesh(g, new ShaderMaterial({ vertexShader: COLUMN_VERT, fragmentShader: COLUMN_FRAG, uniforms: { ...this.u, ...fx }, transparent: true, depthTest: false, depthWrite: false, ...ADD_LIGHT, side: DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER); this.mesh.renderOrder = 7;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

const BOUNTY_PARS = /* glsl */ `
attribute vec4 iS;      // three seeds, kind (0 a loaf, 1 a fruit)
uniform float uFxTime;
uniform float uT0;
uniform vec3 uC;
uniform vec3 uUp;
uniform vec3 uE1;
uniform vec3 uE2;
uniform float uH;
uniform float uPileR;
uniform float uScale;
uniform float uFade;
mat3 rotAxisB(vec3 a, float t) {
  float c = cos(t), s = sin(t), ic = 1.0 - c;
  return mat3(c + a.x * a.x * ic, a.y * a.x * ic + a.z * s, a.z * a.x * ic - a.y * s,
              a.x * a.y * ic - a.z * s, c + a.y * a.y * ic, a.z * a.y * ic + a.x * s,
              a.x * a.z * ic + a.y * s, a.y * a.z * ic - a.x * s, c + a.z * a.z * ic);
}
`;
const BOUNTY_NORMAL = /* glsl */ `
  float ba = iS.x, bb = iS.y, bc = iS.z;
  // each falls in its turn (over ~2 s), drops from the sky, bounces and comes to rest on the heap
  float bt = uFxTime - uT0 - ba * 1.8;
  float Tf = sqrt(2.0 * uH / 9.8);
  float ang = bb * 6.2831853, rr = sqrt(bc) * uPileR;
  float q = rr / max(uPileR, 1e-3);
  float hRest = uScale * 0.12 + (1.0 - q * q) * uPileR * 0.45 * (0.35 + 0.65 * fract(ba * 7.31));
  vec3 lat = (uE1 * cos(ang) + uE2 * sin(ang)) * rr;
  float hh = 0.0, spin = 1.0;
  if (bt < Tf) hh = hRest + uH - 4.9 * max(bt, 0.0) * max(bt, 0.0);
  else { float tb = bt - Tf; hh = hRest + uScale * 1.4 * exp(-tb * 3.5) * abs(sin(tb * 8.0)); spin = exp(-tb * 2.5); }
  vec3 at = uC + lat * (bt < Tf ? 1.25 : 1.0) + uUp * hh;
  float sz = (bt < 0.0 ? 0.0 : 1.0) * uScale * uFade;
  mat3 R = rotAxisB(normalize(vec3(ba - 0.5, bb - 0.5, bc - 0.5) + 1e-3), min(bt, Tf + 1.0) * 5.0 * spin + ba * 20.0);
  vec3 objectNormal = R * normal;
`;
const BOUNTY_BEGIN = /* glsl */ `
  vec3 transformed = R * position * sz + at;
`;

/** a heap of loaves and fruit falling from the sky (the food miracle): instanced props, placed in the vertex shader */
class Bounty {
  readonly group = new Group();
  readonly u = {
    uT0: { value: 0 }, uC: { value: new Vector3() }, uUp: { value: new Vector3(0, 1, 0) }, uE1: { value: new Vector3(1, 0, 0) }, uE2: { value: new Vector3(0, 0, 1) },
    uH: { value: 70 }, uPileR: { value: 3 }, uScale: { value: 1 }, uFade: { value: 1 },
  };
  private meshes: InstancedMesh[] = [];
  private mat: MeshStandardMaterial;
  constructor(shared: Record<string, IUniform>, fx: Record<string, IUniform>, loaves: number, fruit: number) {
    this.group.matrixAutoUpdate = false;
    this.mat = makePropMaterial(shared, {
      key: 'bounty', roughness: 0.75, vertexPars: BOUNTY_PARS, vertexNormal: BOUNTY_NORMAL, vertexBegin: BOUNTY_BEGIN,
      extraUniforms: { ...this.u, uFxTime: fx.uFxTime },
    });
    let h = 0x9e3779b9 ^ (loaves * 977 + fruit);
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    for (const [geo, n, kind] of [[loafGeo(), loaves, 0], [fruitGeo(), fruit, 1]] as [BufferGeometry, number, number][]) {
      if (n <= 0) { geo.dispose(); continue; }
      const iS = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { iS[i * 4] = rnd(); iS[i * 4 + 1] = rnd(); iS[i * 4 + 2] = rnd(); iS[i * 4 + 3] = kind; }
      geo.setAttribute('iS', new InstancedBufferAttribute(iS, 4));
      const m = new InstancedMesh(geo, this.mat, n);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, _ident);
      m.frustumCulled = false; m.matrixAutoUpdate = false; m.layers.enable(1);
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  dispose(): void { for (const m of this.meshes) m.geometry.dispose(); this.mat.dispose(); }
}

const _ident = new Matrix4();

/** a loaf (~0.34 m): a long rounded body, golden brown, a paler score along its top */
function loafGeo(): BufferGeometry {
  const g = ico(2);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const yy = y > 0 ? y * (1 - 0.18 * Math.exp(-z * z * 30)) : y * 0.6;
    p.setXYZ(i, x * 0.17, yy * 0.1 + 0.03, z * 0.1);
    const crust = y > 0.15 ? 1 : 0.8;
    const score = y > 0.6 && Math.abs(z) < 0.12 ? 1.45 : 1;
    col[i * 3] = 0.55 * crust * score; col[i * 3 + 1] = 0.33 * crust * score; col[i * 3 + 2] = 0.13 * crust * score;
  }
  g.computeVertexNormals();
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

/** a fruit (~0.12 m): an apple or a pear by its seed (red or green-gold in the vertex colours) */
function fruitGeo(): BufferGeometry {
  const g = ico(2);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x * 0.06, y * 0.055 + 0.055, z * 0.06);
    const blush = 0.5 + 0.5 * Math.sin(x * 9 + z * 7);
    col[i * 3] = 0.45 + 0.15 * blush; col[i * 3 + 1] = 0.08 + 0.18 * (1 - blush); col[i * 3 + 2] = 0.04;
  }
  g.computeVertexNormals();
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

function ico(sub: number): BufferGeometry {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((q) => { const l = Math.hypot(q[0], q[1], q[2]); return [q[0] / l, q[1] / l, q[2] / l]; });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s2 = 0; s2 < sub; s2++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) { const q = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]; const l = Math.hypot(q[0], q[1], q[2]); v.push([q[0] / l, q[1] / l, q[2] / l]); i = v.length - 1; mid.set(key, i); }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v.flat()), 3));
  g.setIndex(f.flat());
  return g;
}

export class MiracleFx {
  readonly group = new Group();
  private shields = new Map<number, Shield>();
  private moments: Moment[] = [];
  private fx: Record<string, IUniform>;
  private shared: Record<string, IUniform>;

  constructor(fx: Record<string, IUniform>, shared: Record<string, IUniform> = {}) {
    this.fx = fx;
    this.shared = shared;
    this.group.name = 'miracles';
    this.group.matrixAutoUpdate = false;
  }

  onEvent(e: SimEvent, ctx: FxCtx): void {
    if (!e.pos) return;
    const pv = ctx.pv;
    const u = new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize();
    const g = u.clone().multiplyScalar(groundHeight(pv.ground, u.x, u.y, u.z));
    if (e.t === 'shield') {
      const id = Number((e.data as { id?: number } | undefined)?.id ?? Math.random() * 1e9);
      const dome = new Dome(this.fx);
      this.group.add(dome.mesh);
      this.shields.set(id, { id, p: g, r: Math.max(20, e.a ?? 200), until: e.b ?? 0, dome, fade: 0, hit: 0, hitT: -1e9, hitDir: new Vector3(0, 1, 0) });
      return;
    }
    if (e.t !== 'miracle') return;
    const kind = String((e.data as { kind?: string } | undefined)?.kind ?? e.text ?? '');
    const R = Math.max(20, e.a ?? 150);
    const now = ctx.now;
    const v = ctx.vfx;
    const em = (d: Parameters<typeof v.emit>[0]) => v.emit(d, now);
    switch (kind) {
      case 'water': {
        const H = Math.min(260, 80 + R * 0.5);
        em({ sys: SYS.cloud, x: g.x, y: g.y, z: g.z, size: R * 0.35, life: 16, count: 160, p0: R * 0.55, p1: H, duration: 12, r: 0.32, g: 0.34, b: 0.38 });
        em({ sys: SYS.rainCol, x: g.x, y: g.y, z: g.z, size: 0.05, life: 1.6, count: Math.round(1600 * ctx.q), p0: R * 0.5, p1: H, duration: 12, r: 0.7, g: 0.75, b: 0.82, t0: now + 1.2 });
        em({ sys: SYS.splash, x: g.x, y: g.y, z: g.z, size: 0.3, life: 0.4, count: 200, p0: 400, duration: 12, r: 0.75, g: 0.8, b: 0.85, t0: now + 2 });
        this.ring(g, R * 0.5, [0.45, 0.6, 0.75], 6, false, ctx);
        break;
      }
      case 'wood': {
        em({ sys: SYS.bounty, x: g.x, y: g.y, z: g.z, size: 0.45, life: 3.2, count: 90, p0: R * 0.3, p1: 70, p2: 1, duration: 3, r: 0.32, g: 0.2, b: 0.1 });
        em({ sys: SYS.sparkle, x: g.x, y: g.y, z: g.z, size: 0.4, life: 4, count: 140, p0: R * 0.35, p1: 40, r: 1, g: 0.85, b: 0.45, duration: 3 });
        break;
      }
      case 'food': {
        // loaves and fruit fall from the sky into a heap in the square (about as many as the sim gave: ~80 at full
        // strength), sized to read from the god's height, sparkling
        const pw = Math.max(0.3, Math.min(1.5, e.b ?? 1));
        const n = Math.round(Math.min(96, Math.max(24, 64 * pw)));
        const b = new Bounty(this.shared, this.fx, n, Math.round(n * 0.45));
        this.group.add(b.group);
        const up = u.clone();
        b.u.uC.value.copy(g); b.u.uUp.value.copy(up); frameE(up, b.u.uE1.value, b.u.uE2.value);
        b.u.uT0.value = now; b.u.uH.value = 70;
        this.moments.push({
          t0: now, dur: 30, step: (age, _k, c) => {
            const d = c.camBody.distanceTo(g);
            const sc = Math.max(1, d * 0.014);
            b.u.uScale.value += (sc - b.u.uScale.value) * Math.min(1, c.ease * 3 + (age < 0.05 ? 1 : 0));
            b.u.uPileR.value = 1.1 * b.u.uScale.value * Math.sqrt(n / 40);
            b.u.uFade.value = 1 - smooth(26, 30, age);
            b.group.visible = true;
          }, end: () => { this.group.remove(b.group); b.dispose(); },
        });
        em({ sys: SYS.sparkle, x: g.x, y: g.y, z: g.z, size: 0.5, life: 5, count: 160, p0: Math.max(3, R * 0.12), p1: 30, r: 1, g: 0.85, b: 0.45, duration: 4 });
        this.light(g, Math.max(60, R), [1, 0.82, 0.5], 1.5e3, 5);
        break;
      }
      case 'heal': {
        // a warm column of light over the place, golden motes rising through the people (never smaller than a few
        // pixels from where the god looks), a ring of light spreading on the ground
        const camD = ctx.camBody.distanceTo(g);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: Math.max(0.45, camD * 0.0035), life: 5, count: Math.round(500 * ctx.q), p0: R * 0.6, p1: 0, r: 1, g: 0.8, b: 0.4, duration: 5 });
        this.ring(g, R, [1, 0.78, 0.4], 6, true, ctx);
        this.light(g, R * 1.5, [1, 0.8, 0.5], 4e3 * R * R / 25600, 6);
        const col = new Column(this.fx);
        this.group.add(col.mesh);
        col.u.uBase.value.copy(g); col.u.uUp.value.copy(u); col.u.uHgt.value = Math.max(60, R * 1.4); col.u.uW.value = Math.max(6, R * 0.32);
        this.moments.push({
          t0: now, dur: 6, step: (age, k, c) => {
            col.u.uK.value = smooth(0, 0.6, age) * (1 - smooth(0.7, 1, k)) * 0.9;
            (col.u.uCamB.value as Vector3).copy(c.camBody);
          }, end: () => { this.group.remove(col.mesh); col.dispose(); },
        });
        break;
      }
      case 'forest': {
        this.ring(g, R * 1.1, [0.35, 0.85, 0.3], 6, true, ctx);
        em({ sys: SYS.leaves, x: g.x, y: g.y, z: g.z, size: 0.5, life: 6, count: 260, p0: R * 0.7, r: 0.2, g: 0.42, b: 0.08, duration: 5 });
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.4, life: 5, count: 260, p0: R * 0.8, r: 0.6, g: 1, b: 0.4, duration: 5 });
        break;
      }
      case 'fertility': {
        this.ring(g, R, [0.7, 0.95, 0.35], 6, true, ctx);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 6, count: 380, p0: R * 0.7, r: 0.75, g: 1, b: 0.45, duration: 5 });
        em({ sys: SYS.leaves, x: g.x, y: g.y, z: g.z, size: 0.35, life: 5, count: 140, p0: R * 0.5, r: 0.8, g: 0.75, b: 0.3, duration: 4 });
        break;
      }
      case 'calm': {
        for (let i = 0; i < 3; i++) this.ring(g, R, [0.55, 0.75, 1], 7, true, ctx, i * 1.4);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 7, count: 260, p0: R * 0.5, r: 0.6, g: 0.8, b: 1, duration: 5 });
        this.light(g, R, [0.6, 0.8, 1], 2e3 * R * R / 250000, 6);
        break;
      }
      case 'storm': {
        em({ sys: SYS.cloud, x: g.x, y: g.y, z: g.z, size: R * 0.3, life: 30, count: 320, p0: R * 0.8, p1: 230, duration: 18, r: 0.18, g: 0.19, b: 0.22 });
        for (let i = 0; i < 3; i++) {
          this.moments.push({ t0: now + 2 + i * 1.7, dur: 0.1, step: (_a, _k, c) => {
            const a = Math.random() * 6.283, r = Math.random() * R * 0.6;
            const pu = u.clone().multiplyScalar(pv.params.radius).add(_v.set(Math.cos(a) * r, 0, Math.sin(a) * r)).normalize();
            const gp = pu.clone().multiplyScalar(groundHeight(pv.ground, pu.x, pu.y, pu.z));
            c.bolts.strike(gp.clone().addScaledVector(pu, 240), gp, c.now, 1, 6);
            c.thunder(gp, 1);
          } });
        }
        break;
      }
      case 'fire': {
        // a tongue of fire falls from the sky; where it lands it bursts
        const top = g.clone().addScaledVector(u, 160);
        this.moments.push({
          t0: now, dur: 1.0, step: (age, _k, c) => {
            const at = top.clone().lerp(g, Math.min(1, age / 0.8));
            c.vfx.emit({ sys: SYS.embers, x: at.x, y: at.y, z: at.z, size: 1.2, life: 1.5, count: 24, p0: 2, p1: 3, burst: true }, c.now);
          }, end: () => this.burst(g, R * 0.5, ctx),
        });
        em({ sys: SYS.flash, x: top.x, y: top.y, z: top.z, size: 30, life: 1.0, count: 1, p1: 30, burst: true, r: 1, g: 0.6, b: 0.2 });
        break;
      }
      case 'teach': {
        // threads of light into the heads of the people there
        const A = pv.agents;
        const heads: Vector3[] = [];
        if (A) {
          for (let i = 0; i < A.count && heads.length < 8; i++) {
            const ax = A.pos[i * 3], ay = A.pos[i * 3 + 1], az = A.pos[i * 3 + 2];
            const d = Math.acos(Math.max(-1, Math.min(1, (ax * u.x + ay * u.y + az * u.z) / (Math.hypot(ax, ay, az) || 1)))) * pv.params.radius;
            if (d > R * 1.2) continue;
            const hu = new Vector3(ax, ay, az).normalize();
            heads.push(hu.clone().multiplyScalar(groundHeight(pv.ground, hu.x, hu.y, hu.z) + 1.75));
          }
        }
        if (!heads.length) heads.push(g.clone().addScaledVector(u, 1.8));
        const tops = heads.map((h) => h.clone().addScaledVector(u, 140).addScaledVector(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 25));
        const beams = new Beams(this.fx, 8);
        this.group.add(beams.mesh);
        this.moments.push({
          t0: now, dur: 5, step: (age, k, c) => {
            beams.set(tops, heads, c.camBody, Math.max(0.15, c.camBody.distanceTo(heads[0]) * 0.0025));
            beams.u.uK.value = smooth(0, 0.6, age) * (1 - smooth(0.7, 1, k));
            (beams.u.uCamB.value as Vector3).copy(c.camBody);
          }, end: () => { this.group.remove(beams.mesh); beams.dispose(); },
        });
        for (const h of heads) em({ sys: SYS.sparkle, x: h.x, y: h.y, z: h.z, size: 0.25, life: 3, count: 40, p0: 0.6, p1: 0.5, r: 1, g: 0.9, b: 0.6, duration: 4 });
        break;
      }
      case 'shield': case 'lightning': case 'meteor': case 'fireball':
        // drawn by their own effects (the ward's dome, the bolt from the deck, the falling star, the fireball): no
        // generic ring and motes on top (a fuzzy white ring inside the ward, motes like snowballs before the eye)
        break;
      default: {
        // any other miracle (an invented one): a ring of light and motes
        this.ring(g, R, [1, 0.9, 0.7], 5, true, ctx);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.4, life: 5, count: 240, p0: R * 0.6, r: 1, g: 0.9, b: 0.7, duration: 4 });
      }
    }
  }

  /** an expanding ring of light (or a soft one under it) over dur seconds */
  private ring(g: Vector3, R: number, col: [number, number, number], dur: number, light: boolean, _ctx: FxCtx, delay = 0): void {
    const t0 = (_ctx.now) + delay;
    this.moments.push({
      t0, dur, step: (age, k, c) => {
        const r = R * smooth(0, 1, Math.min(1, age / (dur * 0.7)));
        const d = decal(light ? DECAL.ripple : DECAL.ring, [g.x, g.y, g.z], r + R * 0.2);
        d.cr = col[0]; d.cg = col[1]; d.cb = col[2]; d.ca = 1 - k;
        d.p0 = r; d.p1 = Math.max(2, R * 0.06); d.p2 = (1 - k) * 1.1; d.q0 = Math.max(6, R * 0.25);
        c.decals.add(d);
      },
    });
  }

  private light(g: Vector3, reach: number, col: [number, number, number], I: number, dur: number): void {
    this.moments.push({
      t0: -1, dur, step: (age, k, c) => {
        const d = decal(DECAL.light, [g.x, g.y, g.z], reach);
        d.cr = col[0]; d.cg = col[1]; d.cb = col[2]; d.p0 = reach; d.p1 = I * Math.sin(Math.PI * Math.min(1, k)) * Math.min(1, age * 2); d.p2 = reach * 0.2; d.p3 = reach * 0.2;
        c.decals.add(d);
      },
    });
  }

  /** a burst of fire where a falling flame lands: fireball puffs cooling to smoke, embers, its light */
  private burst(g: Vector3, R: number, ctx: FxCtx): void {
    ctx.vfx.emit({ sys: SYS.fireball, x: g.x, y: g.y, z: g.z, size: R * 0.4, life: 5, count: Math.round(140 * ctx.q), p0: R * 0.8, p1: R * 0.1, burst: true, r: 0.1, g: 0.09, b: 0.08 }, ctx.now);
    ctx.vfx.emit({ sys: SYS.embers, x: g.x, y: g.y, z: g.z, size: 0.8, life: 5, count: 160, p0: R * 0.3, p1: 10, burst: true }, ctx.now);
    this.moments.push({
      t0: ctx.now, dur: 2.5, step: (age, k, c) => {
        const r = R * (0.3 + 0.7 * (1 - Math.exp(-age * 3)));
        const d = decal(DECAL.light, [g.x, g.y, g.z], R * 8);
        d.cr = 1; d.cg = 0.5; d.cb = 0.15; d.p0 = R * 8; d.p1 = 2e4 * (1 - k) * R * R / 1600; d.p2 = r; d.p3 = r;
        c.decals.add(d);
      },
    });
  }

  update(ctx: FxCtx): void {
    this.lastNow = ctx.now;
    const tick = ctx.pv.renderTick ?? ctx.pv.paramsTick;
    // shields: a dome while it holds, fading in and out
    for (const [id, s] of this.shields) {
      const live = s.until <= 0 || tick < s.until;
      s.fade += ((live ? 1 : 0) - s.fade) * Math.min(1, ctx.ease * 1.5);
      if (!live && s.fade < 0.02) { this.group.remove(s.dome.mesh); s.dome.dispose(); this.shields.delete(id); continue; }
      frameAt(s.p, _v.copy(s.p).normalize(), s.r, s.dome.mesh.matrix);
      s.dome.mesh.matrixWorldNeedsUpdate = true;
      s.dome.u.uK.value = s.fade;
      s.hit = Math.max(0, s.hit - ctx.ease * 1.2);
      s.dome.u.uHit.value = s.hit;
      s.dome.u.uHitAge.value = Math.max(0, ctx.now - s.hitT);
      s.dome.u.uHitDir.value.copy(s.hitDir);
      // from inside, the ward is not drawn at all (but where it is struck)
      const inside = ctx.camBody.distanceTo(s.p) < s.r * 0.99 ? 1 : 0;
      s.dome.u.uInside.value += (inside - s.dome.u.uInside.value) * Math.min(1, ctx.ease * 4 + 0.1);
      const ring = decal(DECAL.domeRing, [s.p.x, s.p.y, s.p.z], s.r * 1.1);
      ring.cr = 1; ring.cg = 0.8; ring.cb = 0.45; ring.p0 = s.r; ring.p1 = 0.9 * s.fade; ring.p2 = 1; ring.q0 = Math.max(6, s.r * 0.2);
      ctx.decals.add(ring);
    }
    // moments
    for (let i = this.moments.length - 1; i >= 0; i--) {
      const m = this.moments[i];
      if (m.t0 < 0) m.t0 = ctx.now;
      const age = ctx.now - m.t0;
      if (age < 0) continue;
      if (age > m.dur) { m.end?.(); this.moments.splice(i, 1); continue; }
      m.step(age, clamp01(age / m.dur), ctx);
    }
  }

  /** something struck a shield (an impact on or inside one): its lattice flares there and ripples out */
  hitShield(p: Vector3, now = this.lastNow): void {
    for (const s of this.shields.values()) {
      if (s.p.distanceTo(p) > s.r * 1.2) continue;
      s.hit = 1;
      s.hitT = now;
      // where on the dome, in its own frame (the dome mesh's matrix places a unit hemisphere)
      _inv.copy(s.dome.mesh.matrix).invert();
      const up = _v.copy(s.p).normalize();
      const at = _d.copy(p).addScaledVector(up, s.r * 0.9).applyMatrix4(_inv);
      if (at.lengthSq() > 1e-8) s.hitDir.copy(at.normalize());
    }
  }
  private lastNow = 0;

  /** the shield standing over ground point p (body m), if any: its centre and radius */
  shieldOver(p: Vector3): { c: Vector3; r: number } | null {
    let best: Shield | null = null;
    for (const s of this.shields.values()) if (s.fade > 0.05 && s.p.distanceTo(p) < s.r * 1.05 && (!best || s.r > best.r)) best = s;
    return best ? { c: best.p, r: best.r } : null;
  }

  dispose(): void { for (const s of this.shields.values()) s.dome.dispose(); this.shields.clear(); }
}
