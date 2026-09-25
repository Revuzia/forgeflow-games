// BLOCKTOOTH v2 — UPROAR view: the roar, the shockwave + dust wall, and each titan's blast look
// (FEATURES_V2 §3.7, lane L6). VIEW: reads `ultFire` / `ultPulse` / `ultEnd` and `w.ult`, never writes
// gameplay state.
//
// Shared (every titan):
//   * RING batch   — one instanced flat annulus (fragment-drawn band, screen-constant ink #1b1426 edges,
//                    optional dashes): the dashed REACH ring during the roar, the shockwave that races
//                    out to R when the blast starts, one flash per damage pulse (band r0..r1).
//   * SPRITE batch — one instanced camera-facing billboard: the DUST WALL riding the shock front
//                    (count × quality), plus BRIARWICK's blossom confetti (petal mode, same batch).
// Per titan:
//   * MOLO STREET SWALLOW   — a sinkhole mouth (an inverted cone whose normals shade the pit; it lies on
//                             the street, sinking 0.3 H in shading) + debris streaks dragged to the mouth.
//   * VOLT-KITE GRIDLOCK SURGE — lightning ribbons (fx.ts style camera-facing strips) to the 40 nearest
//                             foes, topped up with the nearest streetlights, per pulse.
//   * HEARTHBACK CALDERA BLOWOUT — three lava rings (#ff7a2e / #ffb13b, glare bar: flat toon colour, no
//                             bloom) expanding through their bands + pumice chunks (toon + ink).
//   * BRIARWICK GREENBELT DECREE — the thorn front ring + three rings of bramble thorns rising as the
//                             wave passes (toon + ink) + blossom confetti (#ff9ec7).
// Budget (§3.7 / §4.7): ≤ 12 draw calls while active (ring 1 + sprites 1 + sinkhole 1 + streaks 1 +
// ribbons 1 + pumice 2 + thorns 2 = 9 max, only the running titan's are visible), no per-frame
// allocation (every pool is fixed at mount), everything hidden when idle.
//
// The other L6 views (objectiveview / powerupview) reuse RingBatch, SpriteBatch and RibbonBatch.

import * as THREE from 'three';
import type { SimEvent, TitanId, World } from '../core/types.ts';
import { BIOMES } from '../data/biomes.ts';
import { TITANS } from '../data/titans.ts';
import { ULTS } from '../data/ultimates.ts';
import { SIM_DT } from '../core/config.ts';
import { addOutline, facet, INK, makeToon, OUTLINE_PX } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

// ─────────────────────────────── shared helpers (exported for the other L6 views) ───────────────────────────────

/** 2·tan(fov/2) for the 30° camera: vertical view extent (m) at distance D = D · K_VIEW */
export const K_VIEW = 2 * Math.tan((30 * Math.PI) / 360);

export function hash01(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const easeOutCubic = (t: number): number => { const u = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - (1 - u) * (1 - u) * (1 - u); };
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

const RING_VERT = /* glsl */ `
attribute vec4 aFx;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vFx;
void main() {
  vUv = uv;
  vFx = aFx;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const RING_FRAG = /* glsl */ `
uniform vec3 uInk;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vFx;   // alpha, inner (fraction of the outer radius), dashes (0 = solid), fill alpha inside
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float fw = max(fwidth(r), 1e-4);
  if (r > 1.0 + fw) discard;
  float inner = vFx.y;
  float outerIn = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  float innerOut = inner > 0.001 ? smoothstep(inner - fw, inner, r) : 1.0;
  float band = outerIn * innerOut;
  if (vFx.z > 0.5) {
    float d = fract(atan(p.y, p.x) / 6.2831853 * vFx.z);
    band *= smoothstep(0.0, 0.04, d) * (1.0 - smoothstep(0.5, 0.54, d));
  }
  float ink = 2.2 * fw;
  float inkO = smoothstep(1.0 - ink - fw, 1.0 - ink, r);
  float inkI = inner > 0.001 ? 1.0 - smoothstep(inner + ink, inner + ink + fw, r) : 0.0;
  float inkMask = max(inkO, inkI);
  float g = inner < 0.999 ? clamp((r - inner) / max(1.0 - inner, 1e-3), 0.0, 1.0) : 1.0;
  vec3 bandCol = mix(vCol * (0.86 + 0.24 * g), uInk, inkMask);
  float fillMask = (1.0 - innerOut) * vFx.w;
  vec3 col = mix(vCol * 0.9, bandCol, band);
  float a = max(band, fillMask) * vFx.x;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * One instanced flat annulus batch lying on the ground (a plane whose fragment shader draws the band
 * with screen-constant ink edges). `add` per frame between `begin` and `end`; nothing is allocated.
 */
export class RingBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly fx: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly cap: number;
  private n = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly col = new THREE.Color();

  constructor(cap: number, name: string, renderOrder = 2) {
    this.cap = cap;
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.geo.rotateX(-Math.PI / 2);
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.fx.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aFx', this.fx);
    this.mat = new THREE.ShaderMaterial({
      name: name + 'Ring', vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: { uInk: { value: new THREE.Color(INK) } },
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.col.setRGB(1, 1, 1));
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
  }

  begin(): void { this.n = 0; }

  /** ring centred at (x, y, z), outer radius r (m), inner = fraction of r, dashes (0 = solid), fill alpha */
  add(x: number, y: number, z: number, r: number, inner: number, alpha: number, color: THREE.ColorRepresentation | THREE.Color, dashes = 0, fill = 0): void {
    if (this.n >= this.cap || !(r > 0) || !(alpha > 0.004)) return;
    const i = this.n++;
    this.m4.makeScale(r, 1, r);
    this.m4.setPosition(x, y, z);
    this.mesh.setMatrixAt(i, this.m4);
    if ((color as THREE.Color).isColor) this.col.copy(color as THREE.Color); else this.col.set(color as THREE.ColorRepresentation);
    this.mesh.setColorAt(i, this.col);
    const a = this.fx.array as Float32Array;
    a[i * 4] = alpha; a[i * 4 + 1] = clamp01(inner); a[i * 4 + 2] = dashes; a[i * 4 + 3] = fill;
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.fx.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const SPRITE_VERT = /* glsl */ `
attribute vec4 aSp;      // alpha, mode (0 puff · 1 petal · 2 spark), rotation, unused
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vSp;
void main() {
  vUv = uv;
  vSp = aSp;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float cr = cos(aSp.z), sr = sin(aSp.z);
  vec2 q = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * s;
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
}`;
const SPRITE_FRAG = /* glsl */ `
uniform vec3 uInk;
varying vec2 vUv;
varying vec3 vCol;
varying vec4 vSp;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float a;
  vec3 col;
  if (vSp.y < 0.5) {
    // toon dust puff: a lumpy disc, 2-band shading lit from the upper left, ink rim
    float ang = atan(p.y, p.x);
    float r = length(p) / (0.86 + 0.08 * sin(ang * 5.0 + vSp.z * 3.0) + 0.05 * sin(ang * 9.0));
    float fw = max(fwidth(r), 1e-4);
    if (r > 1.0 + fw) discard;
    float lit = step(0.0, dot(p, vec2(-0.6, 0.8)) + 0.25);
    col = vCol * mix(0.72, 1.0, lit);
    float ink = smoothstep(1.0 - 2.0 * fw - fw, 1.0 - 2.0 * fw, r);
    col = mix(col, uInk, ink * 0.85);
    a = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  } else if (vSp.y < 1.5) {
    // petal: a pointed ellipse with a pale midrib
    float r = length(vec2(p.x * 1.9, p.y));
    float fw = max(fwidth(r), 1e-4);
    if (r > 1.0 + fw) discard;
    col = mix(vCol, vec3(1.0), 0.35 * (1.0 - smoothstep(0.0, 0.12, abs(p.x))));
    a = 1.0 - smoothstep(1.0 - fw, 1.0, r);
  } else {
    // spark: a bright four-point star
    float d = min(abs(p.x) * 6.0 + abs(p.y), abs(p.y) * 6.0 + abs(p.x));
    a = 1.0 - smoothstep(0.55, 1.0, d);
    if (a < 0.01) discard;
    col = mix(vCol, vec3(1.0), 0.5 * a);
  }
  a *= vSp.x;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Instanced camera-facing billboards (depth-tested): toon dust puffs, petals, sparks. */
export class SpriteBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly sp: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.PlaneGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly cap: number;
  private n = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly col = new THREE.Color();

  constructor(cap: number, name: string, renderOrder = 3) {
    this.cap = cap;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.sp = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.sp.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aSp', this.sp);
    this.mat = new THREE.ShaderMaterial({
      name: name + 'Sprite', vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG,
      uniforms: { uInk: { value: new THREE.Color(INK) } },
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.col.setRGB(1, 1, 1));
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
  }

  begin(): void { this.n = 0; }

  /** mode 0 = dust puff, 1 = petal, 2 = spark; size = full width (m) */
  add(x: number, y: number, z: number, size: number, rot: number, alpha: number, color: THREE.Color, mode: number): void {
    if (this.n >= this.cap || !(size > 0) || !(alpha > 0.01)) return;
    const i = this.n++;
    this.m4.makeScale(size, size, size);
    this.m4.setPosition(x, y, z);
    this.mesh.setMatrixAt(i, this.m4);
    this.mesh.setColorAt(i, color);
    const a = this.sp.array as Float32Array;
    a[i * 4] = alpha; a[i * 4 + 1] = mode; a[i * 4 + 2] = rot; a[i * 4 + 3] = 0;
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.sp.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}

const RIBBON_VERT = /* glsl */ `
attribute vec3 color;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
  vCol = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RIBBON_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float d = abs(vUv.y - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.18, 0.34, d);
  float glow = (1.0 - d) * (1.0 - d) * 0.55;
  float a = max(core, glow) * vUv.x;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.8) * a, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Camera-facing lightning / arc strips (the fx.ts ribbon pattern): one dynamic buffer, additive,
 * `line()` appends a polyline between `begin` and `end`. uv.x carries the alpha, uv.y the width axis.
 */
export class RibbonBatch {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly uv: Float32Array;
  private readonly colA: Float32Array;
  private readonly quads: number;
  private q = 0;
  private cx = 0; private cy = 0; private cz = 0;

  constructor(quads: number, name: string) {
    this.quads = quads;
    this.pos = new Float32Array(quads * 4 * 3);
    this.uv = new Float32Array(quads * 4 * 2);
    this.colA = new Float32Array(quads * 4 * 3);
    const idx = new Uint32Array(quads * 6);
    for (let i = 0; i < quads; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3;
    }
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    const ua = new THREE.BufferAttribute(this.uv, 2); ua.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.colA, 3); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('uv', ua);
    this.geo.setAttribute('color', ca);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // one degenerate quad (all zeros) so the shader warm-up links the program; hidden until `end()` draws
    this.geo.setDrawRange(0, 6);
    this.mat = new THREE.ShaderMaterial({
      name: name + 'Ribbon', vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  /** camera position (for the facing) */
  begin(cam: THREE.Camera): void {
    this.q = 0;
    this.cx = cam.position.x; this.cy = cam.position.y; this.cz = cam.position.z;
  }

  /** a polyline of `n` points from `pts` (x,y,z triples starting at `off`), width (m), alpha, colour */
  line(pts: Float32Array, off: number, n: number, width: number, alpha: number, r: number, g: number, b: number): void {
    for (let i = 0; i + 1 < n; i++) {
      if (this.q >= this.quads) return;
      const a0 = off + i * 3, a1 = a0 + 3;
      const x0 = pts[a0], y0 = pts[a0 + 1], z0 = pts[a0 + 2];
      const x1 = pts[a1], y1 = pts[a1 + 1], z1 = pts[a1 + 2];
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const vx = (x0 + x1) * 0.5 - this.cx, vy = (y0 + y1) * 0.5 - this.cy, vz = (z0 + z1) * 0.5 - this.cz;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-9) continue;
      const k = (width * 0.5) / sl;
      sx *= k; sy *= k; sz *= k;
      const v = this.q * 4;
      const P = this.pos, U = this.uv, C = this.colA;
      P[v * 3] = x0 - sx; P[v * 3 + 1] = y0 - sy; P[v * 3 + 2] = z0 - sz;
      P[v * 3 + 3] = x0 + sx; P[v * 3 + 4] = y0 + sy; P[v * 3 + 5] = z0 + sz;
      P[v * 3 + 6] = x1 - sx; P[v * 3 + 7] = y1 - sy; P[v * 3 + 8] = z1 - sz;
      P[v * 3 + 9] = x1 + sx; P[v * 3 + 10] = y1 + sy; P[v * 3 + 11] = z1 + sz;
      for (let j = 0; j < 4; j++) {
        U[(v + j) * 2] = alpha; U[(v + j) * 2 + 1] = j & 1;
        C[(v + j) * 3] = r; C[(v + j) * 3 + 1] = g; C[(v + j) * 3 + 2] = b;
      }
      this.q++;
    }
  }

  end(): void {
    const q = this.q;
    this.geo.setDrawRange(0, q * 6);
    this.mesh.visible = q > 0;
    if (q > 0) {
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** paint every triangle of a non-indexed geometry with fn(triangle centre) → rgb */
export function paintTris(g: THREE.BufferGeometry, fn: (t: number, cx: number, cy: number, cz: number) => [number, number, number]): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let t = 0; t < n / 3; t++) {
    const a = t * 3;
    const cx = (pos.getX(a) + pos.getX(a + 1) + pos.getX(a + 2)) / 3;
    const cy = (pos.getY(a) + pos.getY(a + 1) + pos.getY(a + 2)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(a + 1) + pos.getZ(a + 2)) / 3;
    const [r, gg, b] = fn(t, cx, cy, cz);
    for (let k = 0; k < 3; k++) { col[(a + k) * 3] = r; col[(a + k) * 3 + 1] = gg; col[(a + k) * 3 + 2] = b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** merge non-indexed position+color geometries (each already painted), disposing the inputs */
export function mergePainted(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position') as THREE.BufferAttribute, ca = p.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++, o++) {
      pos[o * 3] = pa.getX(i); pos[o * 3 + 1] = pa.getY(i); pos[o * 3 + 2] = pa.getZ(i);
      col[o * 3] = ca.getX(i); col[o * 3 + 1] = ca.getY(i); col[o * 3 + 2] = ca.getZ(i);
    }
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** a primitive made non-indexed, uv/normal dropped, transformed, then painted with one colour */
export function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  if (g.getAttribute('normal')) g.deleteAttribute('normal');
  if (m) g.applyMatrix4(m);
  const c = new THREE.Color(color);
  paintTris(g, () => [c.r, c.g, c.b]);
  return g;
}

// ─────────────────────────────── UPROAR view ───────────────────────────────

const Q_MUL = [0.55, 0.8, 1] as const;
const DUST_CAP = 120;
const PETAL_CAP = 110;
const STREAK_CAP = 90;
const PUMICE_CAP = 96;
const THORN_CAP = 108;
const ARC_N = 40;             // arcs per VOLT-KITE pulse (§3.7: the 40 nearest)
const ARC_SEG = 8;            // segments per arc
const ARC_LIFE = 0.22;        // s per pulse's arcs
/** shock front: races out to R over this (s) from the blast start */
const SHOCK_S = 0.45;
/** everything is gone this long after the blast ends */
const TAIL_S = 1.6;

interface Puff { a: number; j: number; s: number; d: number; life: number; rise: number; rot: number; tone: number }
interface Chunk { x: number; y: number; z: number; vx: number; vy: number; vz: number; s: number; t: number; live: boolean; rx: number; ry: number; tone: number }
interface Streak { a: number; r0: number; s: number; d: number; tone: number }
interface Thorn { a: number; fr: number; s: number; lean: number }
interface Flash { r0: number; r1: number; t: number; n: number; on: boolean }

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();

export class UltView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private rings: RingBatch | null = null;
  private sprites: SpriteBatch | null = null;
  private ribbons: RibbonBatch | null = null;
  private sink: THREE.Mesh | null = null;
  private streaks: THREE.InstancedMesh | null = null;
  private pumice: THREE.InstancedMesh | null = null;
  private thorns: THREE.InstancedMesh | null = null;
  private disposables: { dispose(): void }[] = [];
  // run state (all reset on mount / fire)
  private titan: TitanId = 'molo';
  private active = false;
  private hidden = false;      // hideAll already ran since the last drawn frame
  private t = 0;               // real s since ultFire
  private blastT = -1;         // real s since the sim entered 'blast' (-1 = not yet)
  private endT = -1;           // real s since the blast ended (ultEnd or phase back to idle)
  private lastPhase: string = 'idle';
  private cx = 0; private cz = 0; private R = 10; private H = 1;
  private roarS = 0.5; private blastS = 0.8;
  private readonly puffs: Puff[] = [];
  private nPuff = 0;
  private readonly petals: Puff[] = [];
  private nPetal = 0;
  private readonly chunks: Chunk[] = [];
  private readonly streakArr: Streak[] = [];
  private nStreak = 0;
  private readonly thornArr: Thorn[] = [];
  private nThorn = 0;
  private readonly flashes: Flash[] = [];
  // VOLT-KITE arcs: ARC_N targets per pulse (x, y, z), re-jittered at ~24 Hz
  private readonly arcTgt = new Float32Array(ARC_N * 3);
  private nArc = 0;
  private arcT = -1;
  private arcJit = 0;
  private lastPulseN = 0;
  private readonly arcPts = new Float32Array(ARC_N * (ARC_SEG + 1) * 3);
  private readonly bestD = new Float32Array(ARC_N);
  // colours
  private readonly accent = new THREE.Color();
  private readonly glowCol = new THREE.Color();
  private readonly dustCol = new THREE.Color();
  private readonly dustDark = new THREE.Color();
  private readonly tmp = new THREE.Color();
  private readonly cream = new THREE.Color('#f4ecd8');
  private readonly lavaA = new THREE.Color('#ff7a2e');
  private readonly lavaB = new THREE.Color('#ffb13b');
  private readonly blossom = new THREE.Color('#ff9ec7');
  private readonly blossomB = new THREE.Color('#ffd1e3');
  private readonly bramble = new THREE.Color('#8fcf4a');

  constructor(ctx: ViewCtx) { this.ctx = ctx; this.root.name = 'uproar'; }

  mount(w: World): void {
    this.unmountParts();
    const pal = BIOMES[w.biomeId].palette;
    this.dustCol.set(pal.sidewalk).lerp(this.cream, 0.45);
    this.dustDark.copy(this.dustCol).multiplyScalar(0.72);
    this.rings = new RingBatch(16, 'ult:rings', 2);
    this.sprites = new SpriteBatch(DUST_CAP + PETAL_CAP, 'ult:sprites', 3);
    this.ribbons = new RibbonBatch(ARC_N * ARC_SEG + 8, 'ult:arcs');
    this.root.add(this.rings.mesh, this.sprites.mesh, this.ribbons.mesh);

    // MOLO sinkhole: a lathe crater; normals from the real 1-unit-deep pit, then flattened onto the street
    // (the road is opaque, so a mesh below y = 0 would never show): the toon ramp shades the pit walls.
    const prof = [new THREE.Vector2(0, -1), new THREE.Vector2(0.28, -0.9), new THREE.Vector2(0.6, -0.55),
      new THREE.Vector2(0.86, -0.18), new THREE.Vector2(1.0, 0.0), new THREE.Vector2(1.12, 0.04)];
    let sg: THREE.BufferGeometry = new THREE.LatheGeometry(prof, 28);
    sg = facet(sg);
    const sp = sg.getAttribute('position') as THREE.BufferAttribute;
    paintTris(sg, (t, cx, cy, cz) => {
      const rr = Math.hypot(cx, cz);
      if (rr > 1.0) { const v = 0.55 + 0.25 * hash01(t, 3); return [v, v * 0.97, v * 0.92]; }   // broken asphalt lip
      const k = clamp01(-cy);
      return [0.16 - 0.12 * k, 0.12 - 0.09 * k, 0.1 - 0.07 * k];
    });
    for (let i = 0; i < sp.count; i++) sp.setY(i, 0.02 + (sp.getY(i) + 1) * 0.03);
    sp.needsUpdate = true;
    sg.computeBoundingSphere();
    const sinkMat = makeToon({ vertexColors: true });
    sinkMat.polygonOffset = true; sinkMat.polygonOffsetFactor = -2; sinkMat.polygonOffsetUnits = -2;
    sinkMat.side = THREE.DoubleSide;   // seen from above we look INTO the bowl: its inner (back) faces
    this.sink = new THREE.Mesh(sg, sinkMat);
    this.sink.name = 'ult:sinkhole';
    this.sink.visible = false;
    this.sink.receiveShadow = true;
    this.sink.frustumCulled = false;
    this.root.add(this.sink);
    this.disposables.push(sg, sinkMat);

    // MOLO debris streaks: stretched asphalt shards
    const stG = part(new THREE.OctahedronGeometry(0.5, 0), '#ffffff');
    const stM = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.streaks = this.inst(stG, stM, STREAK_CAP, 'ult:streaks', 0);
    this.streaks.setColorAt(0, this.tmp.setRGB(1, 1, 1));

    // HEARTHBACK pumice: faceted lumpy rocks, toon + ink
    let pg: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, 0);
    pg = part(pg, '#ffffff');
    const pp = pg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const k = 0.8 + 0.35 * hash01(Math.round((pp.getX(i) + 2) * 97 + (pp.getY(i) + 2) * 13 + pp.getZ(i) * 7), 5);
      pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k * 0.8, pp.getZ(i) * k);
    }
    pg = facet(pg);
    paintTris(pg, (t, _x, y) => { const v = y > 0.1 ? 1 : 0.8 + 0.1 * hash01(t, 4); return [v, v, v]; });
    const pM = makeToon({ vertexColors: true, emissive: '#ff5a1e', emissiveIntensity: 0.18 });
    this.pumice = this.inst(pg, pM, PUMICE_CAP, 'ult:pumice', OUTLINE_PX.prop);
    this.pumice.setColorAt(0, this.tmp.setRGB(1, 1, 1));

    // BRIARWICK thorn: a curved bramble spike (base at y = 0, tip at y = 1), bark → blossom-pink tip
    const thornParts: THREE.BufferGeometry[] = [];
    const seg = 4;
    for (let i = 0; i < seg; i++) {
      const y0 = i / seg, y1 = (i + 1) / seg;
      const r0 = 0.22 * (1 - y0), r1 = 0.22 * (1 - y1) + 0.004;
      const c = new THREE.CylinderGeometry(r1, r0, y1 - y0, 6, 1, false);
      const m = new THREE.Matrix4().makeTranslation(0.18 * y0 * y0, (y0 + y1) / 2, 0);
      m.multiply(new THREE.Matrix4().makeRotationZ(-0.35 * (y0 + y1)));
      thornParts.push(part(c, i === seg - 1 ? '#ff9ec7' : i === 0 ? '#5a4128' : '#4f7a2a', m));
    }
    // two side barbs
    for (const [yy, sgn] of [[0.35, 1], [0.6, -1]] as const) {
      const b = new THREE.ConeGeometry(0.07, 0.3, 5);
      const m = new THREE.Matrix4().makeTranslation(0.05 * sgn + 0.02, yy, 0).multiply(new THREE.Matrix4().makeRotationZ(-sgn * 1.1));
      thornParts.push(part(b, '#6f9a3a', m));
    }
    const tg = facet(mergePainted(thornParts));
    const tM = makeToon({ vertexColors: true });
    this.thorns = this.inst(tg, tM, THORN_CAP, 'ult:thorns', OUTLINE_PX.prop);

    this.ctx.scene.add(this.root);
    this.resetRun(w);
  }

  update(w: World, f: FrameInfo): void {
    if (!this.rings || !this.sprites || !this.ribbons) return;
    const ev = f.events;
    for (let i = 0; i < ev.length; i++) this.onEvent(w, ev[i]);
    const U = w.ult;
    if (!this.active && U && U.phase !== 'idle' && U.r > 0) this.start(w, U.x, U.z, U.r);   // missed the event (cheat / frame skip)
    if (!this.active) { this.hideAll(); return; }
    // Clock: while the ultimate runs, the view time IS the sim's (w.ult.t, interpolated like every pose), so
    // the look stays locked to the pulses through the hit-stop and under __BT__.freeze + step; after the
    // blast the tail runs on real time.
    const ph = U ? U.phase : 'idle';
    const lag = (1 - f.alpha) * SIM_DT;
    let vt: number;
    if (U && ph === 'roar') vt = Math.max(0, U.t - lag);
    else if (U && ph === 'blast') vt = this.roarS + Math.max(0, U.t - lag);
    else vt = this.t + (f.frozen ? 0 : Math.min(0.1, f.dt));
    if (vt < this.t) vt = this.t;
    const dt = Math.min(0.1, vt - this.t);
    this.t = vt;
    if (ph === 'blast' && this.blastT < 0) this.blastStart(w);
    if (ph === 'idle' && this.lastPhase !== 'idle' && this.endT < 0) this.endT = 0;
    this.lastPhase = ph;
    if (this.blastT >= 0) this.blastT = Math.max(0, this.t - this.roarS);
    if (this.endT >= 0) this.endT += dt;
    // a stall-proof end: never outlive roar + blast + tail
    if ((this.endT > TAIL_S) || this.t > this.roarS + this.blastS + TAIL_S + 2) { this.active = false; this.hideAll(); return; }

    this.hidden = false;
    this.rings.begin();
    this.sprites.begin();
    this.ribbons.begin(this.ctx.camera);
    this.drawRings(w, dt);
    this.drawDust();
    if (this.titan === 'molo') this.drawMolo(w); else { if (this.sink) this.sink.visible = false; if (this.streaks) this.streaks.visible = false; }
    if (this.titan === 'voltkite') this.drawArcs(w, f, dt);
    if (this.titan === 'hearthback') this.drawPumice(dt); else if (this.pumice) this.pumice.visible = false;
    if (this.titan === 'briarwick') this.drawBriar(); else if (this.thorns) this.thorns.visible = false;
    this.rings.end();
    this.sprites.end();
    this.ribbons.end();
  }

  unmount(): void {
    this.unmountParts();
    this.root.removeFromParent();
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, outline: number): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.name = name;
    im.count = 0;
    im.visible = false;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = false; im.receiveShadow = false;
    if (outline > 0) addOutline(im, outline);
    this.root.add(im);
    this.disposables.push(geo, mat);
    return im;
  }

  private unmountParts(): void {
    this.rings?.dispose(); this.sprites?.dispose(); this.ribbons?.dispose();
    this.rings = null; this.sprites = null; this.ribbons = null;
    for (const im of [this.streaks, this.pumice, this.thorns]) if (im) { im.removeFromParent(); im.dispose(); }
    this.sink?.removeFromParent();
    this.streaks = this.pumice = this.thorns = null;
    this.sink = null;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.active = false;
  }

  private resetRun(w: World): void {
    this.titan = w.titanId;
    this.active = false;
    this.t = 0; this.blastT = -1; this.endT = -1; this.lastPhase = 'idle';
    const T = TITANS[w.titanId];
    this.accent.set(T.colors.accent);
    this.glowCol.set(T.colors.glow);
    this.nPuff = this.nPetal = this.nStreak = this.nThorn = 0;
    this.nArc = 0; this.arcT = -1;
    for (const c of this.chunks) c.live = false;
    for (const fl of this.flashes) fl.on = false;
    this.hidden = false;
    this.hideAll();
  }

  /** idle: everything off (called every idle frame, so no array literal / allocation here) */
  private hideAll(): void {
    if (this.hidden) return;
    this.hidden = true;
    if (this.rings) { this.rings.mesh.visible = false; this.rings.mesh.count = 0; }
    if (this.sprites) { this.sprites.mesh.visible = false; this.sprites.mesh.count = 0; }
    if (this.ribbons) this.ribbons.mesh.visible = false;
    if (this.sink) this.sink.visible = false;
    if (this.streaks) { this.streaks.visible = false; this.streaks.count = 0; }
    if (this.pumice) { this.pumice.visible = false; this.pumice.count = 0; }
    if (this.thorns) { this.thorns.visible = false; this.thorns.count = 0; }
  }

  private onEvent(w: World, e: SimEvent): void {
    switch (e.type) {
      case 'ultFire': this.start(w, e.x, e.z, e.r); this.titan = e.titan; break;
      case 'ultPulse': this.pulse(w, e.r0, e.r1, e.n); break;
      case 'ultEnd': if (this.active && this.endT < 0) this.endT = 0; break;
      default: break;
    }
  }

  private start(w: World, x: number, z: number, r: number): void {
    this.titan = w.titanId;
    const def = ULTS[this.titan];
    this.active = true;
    this.t = 0; this.blastT = -1; this.endT = -1;
    this.lastPhase = w.ult ? w.ult.phase : 'roar';
    this.cx = x; this.cz = z;
    this.R = Math.max(1, r);
    this.H = Math.max(0.2, w.titan.height);
    this.roarS = def.roarS; this.blastS = def.blastS;
    this.nPuff = this.nPetal = this.nStreak = this.nThorn = 0;
    this.nArc = 0; this.arcT = -1;
    for (const c of this.chunks) c.live = false;
    for (const fl of this.flashes) fl.on = false;
  }

  /** the sim entered BLAST: spawn the dust wall + the titan's pools (all pure maths, fixed pools) */
  private blastStart(w: World): void {
    this.blastT = 0;
    const q = Q_MUL[this.ctx.quality.level];
    const R = this.R, H = this.H;
    const seed = (w.ult ? w.ult.fired : 1) * 131 + 7;
    // dust wall riding the shock front
    this.nPuff = Math.min(DUST_CAP, Math.round(DUST_CAP * q));
    for (let i = 0; i < this.nPuff; i++) {
      const p = this.puffs[i] ?? (this.puffs[i] = { a: 0, j: 0, s: 0, d: 0, life: 0, rise: 0, rot: 0, tone: 0 });
      p.a = (i / this.nPuff) * Math.PI * 2 + (hash01(i, seed) - 0.5) * 0.08;
      p.j = 0.9 + 0.14 * hash01(i, seed + 1);
      p.s = Math.max(0.55 * H, 0.05 * R) * (0.75 + 0.6 * hash01(i, seed + 2));
      p.d = 0.06 * hash01(i, seed + 3);
      p.life = 1.0 + 0.5 * hash01(i, seed + 4);
      p.rise = (0.25 + 0.4 * hash01(i, seed + 5));
      p.rot = hash01(i, seed + 6) * 6.283;
      p.tone = hash01(i, seed + 7);
    }
    if (this.titan === 'molo') {
      this.nStreak = Math.min(STREAK_CAP, Math.round(STREAK_CAP * q));
      for (let i = 0; i < this.nStreak; i++) {
        const s = this.streakArr[i] ?? (this.streakArr[i] = { a: 0, r0: 0, s: 0, d: 0, tone: 0 });
        s.a = hash01(i, seed + 11) * Math.PI * 2;
        s.r0 = (0.25 + 0.7 * hash01(i, seed + 12)) * R;
        s.s = Math.max(0.12 * H, 0.012 * R) * (0.7 + 0.8 * hash01(i, seed + 13));
        s.d = 0.25 * hash01(i, seed + 14);
        s.tone = hash01(i, seed + 15);
      }
    } else if (this.titan === 'briarwick') {
      this.nThorn = 0;
      const rings = [0.3, 0.62, 0.95];
      const per = [Math.round(18 * q), Math.round(30 * q), Math.round(44 * q)];
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < per[k] && this.nThorn < THORN_CAP; i++) {
          const th = this.thornArr[this.nThorn] ?? (this.thornArr[this.nThorn] = { a: 0, fr: 0, s: 0, lean: 0 });
          th.a = ((i + 0.5 * (k & 1)) / per[k]) * Math.PI * 2 + (hash01(this.nThorn, seed + 21) - 0.5) * 0.12;
          th.fr = rings[k] * (0.94 + 0.1 * hash01(this.nThorn, seed + 22));
          th.s = Math.max(0.9 * H, 0.06 * R) * (0.7 + 0.6 * hash01(this.nThorn, seed + 23));
          th.lean = (hash01(this.nThorn, seed + 24) - 0.5) * 0.5;
          this.nThorn++;
        }
      }
      this.nPetal = Math.min(PETAL_CAP, Math.round(PETAL_CAP * q));
      for (let i = 0; i < this.nPetal; i++) {
        const p = this.petals[i] ?? (this.petals[i] = { a: 0, j: 0, s: 0, d: 0, life: 0, rise: 0, rot: 0, tone: 0 });
        p.a = hash01(i, seed + 31) * Math.PI * 2;
        p.j = Math.sqrt(hash01(i, seed + 32)) * R;               // uniform over the disc
        p.s = Math.max(0.1 * H, 0.012 * R) * (0.7 + 0.6 * hash01(i, seed + 33));
        p.d = 0.2 + 0.5 * hash01(i, seed + 34);
        p.life = 1.4 + 0.8 * hash01(i, seed + 35);
        p.rise = (0.8 + 1.4 * hash01(i, seed + 36)) * Math.max(H, 0.08 * R);   // start height
        p.rot = hash01(i, seed + 37) * 6.283;
        p.tone = hash01(i, seed + 38);
      }
    }
  }

  private pulse(w: World, r0: number, r1: number, n: number): void {
    if (!this.active) return;
    let fl: Flash | null = null;
    for (const x of this.flashes) if (!x.on) { fl = x; break; }
    if (!fl) { if (this.flashes.length < 8) { fl = { r0: 0, r1: 0, t: 0, n: 0, on: false }; this.flashes.push(fl); } else fl = this.flashes[0]; }
    // pulses land at their data time into the blast (sim clock), so the flash age is blastT - that
    const pd = ULTS[this.titan].pulses[n];
    fl.r0 = r0; fl.r1 = r1; fl.t = pd ? pd.t : Math.max(0, this.blastT); fl.n = n; fl.on = true;
    this.lastPulseN = n;
    if (this.titan === 'voltkite') this.pickArcTargets(w);
    if (this.titan === 'hearthback') this.spawnPumice(r0, r1, n);
  }

  // ── shared rings ──
  private drawRings(w: World, dt: number): void {
    const rb = this.rings!;
    const R = this.R, cx = this.cx, cz = this.cz;
    const y = 0.03 + 0.002 * R;
    const calm = this.ctx.quality.reduceFlashing;
    // ROAR: the dashed reach ring (what the blast will cover) breathing in
    if (this.blastT < 0) {
      const k = clamp01(this.t / Math.max(0.1, this.roarS));
      rb.add(cx, y, cz, R, 0.975, 0.55 + 0.4 * k, this.titan === 'molo' ? this.glowCol : this.accent, 48);
      rb.add(cx, y, cz, R * (1 - 0.85 * k), 0.93, 0.35 * k, this.cream, 0);   // the inhale: a ring sucked inward
    } else {
      // BLAST: the shockwave races out to R, then thins and fades
      const bt = this.blastT;
      const k = easeOutCubic(bt / SHOCK_S);
      const r = Math.max(0.5, R * k);
      const fade = bt < SHOCK_S ? 1 : clamp01(1 - (bt - SHOCK_S) / 0.55);
      const band = Math.min(0.2, 0.05 + 0.15 * (1 - k));
      if (fade > 0) {
        rb.add(cx, y, cz, r, 1 - band, 0.95 * fade, this.cream);
        rb.add(cx, y + 0.01, cz, r * (1 - band * 0.5), 1 - band * 0.35, 0.8 * fade, this.titan === 'hearthback' ? this.lavaB : this.glowCol);
      }
    }
    // damage pulses: the band [r0, r1] flashes (HEARTHBACK: the lava ring grows through its band)
    for (const fl of this.flashes) {
      if (!fl.on) continue;
      const age = Math.max(0, this.blastT - fl.t);
      const life = this.titan === 'hearthback' ? 0.6 : 0.45;
      if (age > life) { fl.on = false; continue; }
      const u = age / life;
      // the pulse's band sweeps outward through [r0, r1] as a ring whose width is a share of the band
      // (a full-disc pulse must not wash the whole view in one flat colour)
      const span = Math.max(0.01, fl.r1 - fl.r0);
      const hearth = this.titan === 'hearthback';
      const g = easeOutCubic(age / (hearth ? 0.28 : 0.22));
      const r1 = fl.r0 + span * g;
      const r0 = Math.max(fl.r0, r1 - span * (hearth ? 0.45 : 0.14));
      let col: THREE.Color = this.glowCol;
      let a = (1 - u) * (calm ? 0.45 : 0.75);
      if (hearth) {
        col = fl.n % 2 ? this.lavaB : this.lavaA;
        a = (u < 0.4 ? 0.82 : 0.82 * (1 - (u - 0.4) / 0.6)) * (calm ? 0.8 : 1);
      } else if (this.titan === 'molo') col = this.accent;
      // VOLT-KITE: a faint surge wash inside the ring (the whole block is live for a beat)
      if (r1 > 0.1) rb.add(cx, y + 0.02, cz, r1, r0 / r1, a, col, 0, this.titan === 'voltkite' ? 0.06 * (1 - u) : 0);
    }
    // BRIARWICK: the thorn front
    if (this.titan === 'briarwick' && this.blastT >= 0 && this.blastT < 1.2) {
      const k = clamp01(this.blastT / 0.6);
      const fade = this.blastT < 0.6 ? 1 : 1 - (this.blastT - 0.6) / 0.6;
      rb.add(cx, y + 0.015, cz, Math.max(0.5, R * k), 0.9, 0.9 * fade, this.bramble);
    }
    // MOLO: the ink lip of the sinkhole
    if (this.titan === 'molo' && this.sink && this.sink.visible) {
      const s = this.sink.scale.x;
      rb.add(cx, y + 0.03, cz, s * 1.1, 0.9, 0.9 * clamp01(this.sink.scale.x / Math.max(1e-3, this.sinkR())), this.dustDark);
    }
    void w;
  }

  private sinkR(): number { return Math.min(0.3 * this.R, Math.max(1.4 * this.H, 0.12 * this.R)); }

  // ── dust wall ──
  private drawDust(): void {
    if (this.blastT < 0) return;
    const sb = this.sprites!;
    const R = this.R, bt = this.blastT;
    for (let i = 0; i < this.nPuff; i++) {
      const p = this.puffs[i];
      const tt = bt - p.d;
      if (tt < 0 || tt > p.life) continue;
      const u = tt / p.life;
      const r = R * p.j * easeOutCubic(tt / SHOCK_S);
      const x = this.cx + Math.sin(p.a) * r, z = this.cz + Math.cos(p.a) * r;
      const s = p.s * (0.6 + 0.9 * easeOutCubic(u * 1.6));
      const yy = s * 0.35 + p.rise * s * u * 2;
      const alpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      this.tmp.copy(this.dustCol).lerp(this.dustDark, p.tone * 0.6);
      sb.add(x, yy, z, s, p.rot + u * 0.8, alpha, this.tmp, 0);
    }
    // BRIARWICK blossom confetti (same batch, petal mode)
    for (let i = 0; i < this.nPetal; i++) {
      const p = this.petals[i];
      const tt = bt - p.d;
      if (tt < 0 || tt > p.life) continue;
      const u = tt / p.life;
      const x = this.cx + Math.sin(p.a) * p.j + Math.sin(tt * 3.1 + p.rot) * p.s * 2;
      const z = this.cz + Math.cos(p.a) * p.j + Math.cos(tt * 2.3 + p.rot) * p.s * 2;
      const yy = Math.max(p.s * 0.3, p.rise * (1 - u));
      const alpha = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      this.tmp.copy(this.blossom).lerp(this.blossomB, p.tone);
      sb.add(x, yy, z, p.s * 2.2, p.rot + tt * 5, alpha, this.tmp, 1);
    }
  }

  // ── MOLO: the sinkhole + debris streaks ──
  private drawMolo(w: World): void {
    const sink = this.sink!, st = this.streaks!;
    const R = this.R;
    const sr = this.sinkR();
    // opens through the roar, holds wide through the PULL, snaps shut after the SNAP (blast 0.9 s)
    let k: number;
    if (this.blastT < 0) k = 0.35 * easeOutCubic(this.t / Math.max(0.1, this.roarS));
    else if (this.blastT < 0.9) k = 0.35 + 0.65 * easeOutCubic(this.blastT / 0.3);
    else k = Math.max(0, 1 - (this.blastT - 0.9) / 0.5);
    k *= this.endT > 0 ? clamp01(1 - this.endT / 0.6) : 1;
    sink.visible = k > 0.01;
    if (sink.visible) {
      const s = sr * k;
      sink.position.set(this.cx, 0, this.cz);
      sink.scale.set(s, 1, s);   // flat on the street: the pit is in the baked shading (0.3 H deep in look)
      sink.rotation.y = this.t * 0.4;
    }
    // streaks: dragged from where they were to the mouth over the PULL (0 → 0.9 s of blast)
    let n = 0;
    if (this.blastT >= 0 && this.blastT < 1.0) {
      for (let i = 0; i < this.nStreak; i++) {
        const s = this.streakArr[i];
        const tt = this.blastT - s.d;
        if (tt < 0) continue;
        const u = clamp01(tt / Math.max(0.1, 0.9 - s.d));
        const r = s.r0 + (sr * 0.6 - s.r0) * u * u;
        if (u >= 1) continue;
        const x = this.cx + Math.sin(s.a) * r, z = this.cz + Math.cos(s.a) * r;
        const len = s.s * (2.5 + 5 * u);
        _dir.set(-Math.sin(s.a), 0, -Math.cos(s.a));
        _q.setFromUnitVectors(_up, _dir);
        _p.set(x, s.s * 0.6 + Math.sin(u * Math.PI) * s.s * 2, z);
        _s.set(s.s, len, s.s);
        _m4.compose(_p, _q, _s);
        st.setMatrixAt(n, _m4);
        this.tmp.copy(s.tone > 0.7 ? this.cream : this.dustDark).multiplyScalar(s.tone > 0.7 ? 1 : 0.6 + 0.4 * s.tone);
        st.setColorAt(n, this.tmp);
        n++;
      }
    }
    st.count = n;
    st.visible = n > 0;
    if (n > 0) { st.instanceMatrix.needsUpdate = true; if (st.instanceColor) st.instanceColor.needsUpdate = true; }
    void R; void w;
  }

  // ── VOLT-KITE: arcs to the 40 nearest foes (+ streetlights) per pulse ──
  private pickArcTargets(w: World): void {
    const T = w.titan;
    const R2 = this.R * this.R;
    this.nArc = 0;
    const best = this.bestD;
    for (let i = 0; i < ARC_N; i++) best[i] = Infinity;
    let cnt = 0;
    const es = w.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive) continue;
      const dx = e.x - T.x, dz = e.z - T.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      // insertion into the fixed best list (sorted by distance)
      let j = Math.min(cnt, ARC_N - 1);
      if (cnt >= ARC_N && d2 >= best[ARC_N - 1]) continue;
      while (j > 0 && best[j - 1] > d2) {
        best[j] = best[j - 1];
        this.arcTgt[j * 3] = this.arcTgt[(j - 1) * 3]; this.arcTgt[j * 3 + 1] = this.arcTgt[(j - 1) * 3 + 1]; this.arcTgt[j * 3 + 2] = this.arcTgt[(j - 1) * 3 + 2];
        j--;
      }
      best[j] = d2;
      this.arcTgt[j * 3] = e.x; this.arcTgt[j * 3 + 1] = Math.max(0.3, e.radius) ; this.arcTgt[j * 3 + 2] = e.z;
      if (cnt < ARC_N) cnt++;
    }
    // top up with the streetlights the mane grounds into (nearest live lamps inside R)
    if (cnt < ARC_N) {
      const props = w.city.props;
      const need = ARC_N - cnt;
      let got = 0;
      const step = Math.max(1, Math.floor(props.length / 600));
      for (let i = 0; i < props.length && got < need; i += step) {
        const p = props[i];
        if (!p.alive || p.kind !== 'lamp') continue;
        const dx = p.x - T.x, dz = p.z - T.z;
        if (dx * dx + dz * dz > R2 * 0.8) continue;
        const k = cnt + got;
        this.arcTgt[k * 3] = p.x; this.arcTgt[k * 3 + 1] = 5.5; this.arcTgt[k * 3 + 2] = p.z;
        got++;
      }
      cnt += got;
    }
    this.nArc = cnt;
    const pd = ULTS[this.titan].pulses[this.lastPulseN];
    this.arcT = pd ? pd.t : Math.max(0, this.blastT);   // arc birth, on the blast clock
    this.arcJit = 1;   // force a fresh polyline
  }

  private drawArcs(w: World, f: FrameInfo, dt: number): void {
    if (this.arcT < 0 || this.nArc === 0) return;
    const age = Math.max(0, this.blastT - this.arcT);
    if (age > ARC_LIFE) { this.arcT = -1; return; }
    const T = w.titan;
    const H = Math.max(0.2, T.height);
    const hx = T.px + (T.x - T.px) * f.alpha, hz = T.pz + (T.z - T.pz) * f.alpha, hy = 0.8 * H;
    this.arcJit += dt;
    const rejit = this.arcJit > 0.042;
    if (rejit) this.arcJit = 0;
    const pts = this.arcPts;
    const a = (1 - age / ARC_LIFE) * (this.ctx.quality.reduceFlashing ? 0.6 : 1);
    // screen-ish width: a few px at the current camera distance
    const mpp = (Math.max(1, f.camDist) * K_VIEW) / 720;
    for (let k = 0; k < this.nArc; k++) {
      const tx = this.arcTgt[k * 3], ty = this.arcTgt[k * 3 + 1], tz = this.arcTgt[k * 3 + 2];
      const off = k * (ARC_SEG + 1) * 3;
      const dx = tx - hx, dz = tz - hz;
      const len = Math.hypot(dx, dz);
      if (rejit || pts[off + 3 * ARC_SEG] !== tx) {
        const nx = len > 1e-6 ? -dz / len : 1, nz = len > 1e-6 ? dx / len : 0;
        for (let s = 0; s <= ARC_SEG; s++) {
          const u = s / ARC_SEG;
          const jit = s === 0 || s === ARC_SEG ? 0 : (Math.random() - 0.5) * 0.16 * len;
          pts[off + s * 3] = hx + dx * u + nx * jit;
          pts[off + s * 3 + 1] = hy + (ty - hy) * u + Math.sin(u * Math.PI) * 0.12 * len + (Math.random() - 0.5) * 0.05 * len * (s > 0 && s < ARC_SEG ? 1 : 0);
          pts[off + s * 3 + 2] = hz + dz * u + nz * jit;
        }
      }
      const wpx = k < 12 ? 7 : 5;
      this.ribbons!.line(pts, off, ARC_SEG + 1, wpx * mpp, a, 0.44, 0.95, 1.0);
    }
  }

  // ── HEARTHBACK: pumice flung out of each ring ──
  private spawnPumice(r0: number, r1: number, n: number): void {
    const q = Q_MUL[this.ctx.quality.level];
    const count = Math.round(28 * q);
    const H = this.H, R = this.R;
    let made = 0;
    for (let i = 0; i < PUMICE_CAP && made < count; i++) {
      let c = this.chunks[i];
      if (!c) { c = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, t: 0, live: false, rx: 0, ry: 0, tone: 0 }; this.chunks[i] = c; }
      if (c.live) continue;
      const a = Math.random() * Math.PI * 2;
      const r = r0 + (r1 - r0) * Math.random();
      c.x = this.cx + Math.sin(a) * r; c.z = this.cz + Math.cos(a) * r;
      c.y = 0.1;
      const sp = Math.max(1.2 * H, 0.06 * R);
      c.vx = Math.sin(a) * sp * 0.4 * Math.random(); c.vz = Math.cos(a) * sp * 0.4 * Math.random();
      c.vy = sp * (1.4 + 1.2 * Math.random());
      c.s = Math.max(0.14 * H, 0.014 * R) * (0.6 + 0.9 * Math.random());
      c.t = 0; c.live = true; c.rx = Math.random() * 6; c.ry = Math.random() * 6;
      c.tone = (n + Math.random()) % 1;
      made++;
    }
  }

  private drawPumice(dt: number): void {
    const im = this.pumice!;
    const g = 4 * Math.max(1.2 * this.H, 0.06 * this.R);
    let n = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (!c.live) continue;
      c.t += dt;
      c.vy -= g * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y < -c.s || c.t > 3) { c.live = false; continue; }
      _e.set(c.rx + c.t * 5, c.ry + c.t * 3, 0);
      _q.setFromEuler(_e);
      _p.set(c.x, Math.max(c.s * 0.3, c.y), c.z);
      _s.set(c.s, c.s, c.s);
      _m4.compose(_p, _q, _s);
      im.setMatrixAt(n, _m4);
      // hot pumice cools from lava orange to basalt as it flies
      this.tmp.copy(c.tone > 0.5 ? this.lavaB : this.lavaA).lerp(this.dustDark, clamp01(c.t / 1.4) * 0.85);
      im.setColorAt(n, this.tmp);
      n++;
    }
    im.count = n;
    im.visible = n > 0;
    if (n > 0) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  // ── BRIARWICK: bramble thorns rise as the wave front passes ──
  private drawBriar(): void {
    const im = this.thorns!;
    let n = 0;
    if (this.blastT >= 0) {
      const front = this.blastT / 0.6;                                   // front radius in R units
      const hold = this.blastS + 1.1;
      for (let i = 0; i < this.nThorn; i++) {
        const th = this.thornArr[i];
        const t0 = th.fr * 0.6;                                          // when the front reaches it
        const tt = this.blastT - t0;
        if (front < th.fr || tt < 0) continue;
        let k = easeOutCubic(tt / 0.18);
        if (this.blastT > hold) k *= clamp01(1 - (this.blastT - hold) / 0.35);
        if (this.endT > TAIL_S - 0.4) k *= clamp01((TAIL_S - this.endT) / 0.4);
        if (k <= 0.01) continue;
        const x = this.cx + Math.sin(th.a) * th.fr * this.R, z = this.cz + Math.cos(th.a) * th.fr * this.R;
        _e.set(th.lean, th.a + Math.PI / 2, -0.25 + th.lean * 0.4, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(x, 0, z);
        _s.set(th.s * 0.9, th.s * k, th.s * 0.9);
        _m4.compose(_p, _q, _s);
        im.setMatrixAt(n++, _m4);
      }
    }
    im.count = n;
    im.visible = n > 0;
    if (n > 0) im.instanceMatrix.needsUpdate = true;
  }
}
