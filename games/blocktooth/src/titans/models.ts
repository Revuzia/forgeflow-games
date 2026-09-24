// BLOCKTOOTH — titan hero models (lane titan-view; CONTRACT §6, §6.1, §8, §1).
//
// Four ORIGINAL monsters, each built from custom faceted low-poly geometry:
//   * tapered polygonal sweeps along spline spines (bodies, necks, tails, legs, horns),
//   * lathes (eyes, dome shell, pods), bevelled slabs (fin plates, ears, membranes, petals),
//   * non-indexed triangles with per-face normals + flat painted vertex colours,
//   * winding fixed BY CONSTRUCTION: every triangle is flipped to agree with its declared
//     outward normal (doctrine §3), so no face is ever culled by accident.
// Every titan is ONE skinned body mesh + one eye mesh + glow mesh(es) sharing one skeleton
// (named joints = THREE.Bone). That keeps a titan at ~8 draw calls incl. ink hulls and shadows,
// and lets tails / spines bend smoothly (the animator drives bones; see anim.ts).
// Authored facing +Z, feet on y = 0, normalised so the tallest point is exactly y = 1.0.

import * as THREE from 'three';
import type { TitanId } from '../core/types.ts';
import { addOutline, makeToon } from '../render/materials.ts';

// ─────────────────────────────── public types ───────────────────────────────
export interface LegDef {
  /** 'legFL' | 'legFR' | 'legBL' | 'legBR' */
  name: string;
  /** joint names: upper (shoulder / hip), lower (elbow / knee), foot (wrist / ankle) */
  up: string; low: string; foot: string;
  /** joint the leg hangs from ('chest' or 'hips') */
  parent: string;
  /** bend-direction hint (model-aligned axes) for the 2-bone IK: where the elbow/knee points */
  pole: [number, number, number];
  front: boolean;
  /** +1 = the titan's left (+X), −1 = right */
  side: 1 | -1;
}

export interface TitanModel {
  root: THREE.Group;
  joints: Record<string, THREE.Object3D>;
  glow: THREE.Material[];
  dispose(): void;
  // ── lane extras (read by anim.ts / titanview.ts / portraits.ts) ──
  id: TitanId;
  /** model-space rest position of every joint (height-1 units, before the view scales root) */
  rest: Record<string, THREE.Vector3>;
  legs: LegDef[];
  /** tail joints, base → tip */
  tail: string[];
  meshes: THREE.SkinnedMesh[];
  /** body material (per model instance) — the animator drives its emissive for the hurt flash */
  skin: THREE.MeshToonMaterial;
  /** base (level 1) colour of each glow material, same order as `glow` */
  glowColors: THREE.Color[];
  /** footprint extents in height-1 units (x = width, z = nose-to-tail length, zMin/zMax) */
  size: { width: number; length: number; zMin: number; zMax: number };
  /** stepped fresnel rim + self fill on the body material (uniform objects — change them, never
   *  recompile). strength / fill 0 = off (day biomes); set with `setTitanRim` / `setTitanFill`. */
  rim: { color: THREE.Color; strength: { value: number }; band: { value: THREE.Vector2 }; fill: { value: number } };
}

export interface BuildOpts {
  /** ink outline width for the body (CSS px). Titans are 3.0 (CONTRACT §6.1); portraits pass more. */
  outlinePx?: number;
}

/** Canonical titan colours (CONTRACT §8 — identical to data/titans.ts `colors`). */
export const TITAN_COLORS: Record<TitanId, { primary: string; secondary: string; belly: string; accent: string; glow: string; eye: string; extra?: string }> = {
  molo: { primary: '#3fae7f', secondary: '#1f6f55', belly: '#cfe8b8', accent: '#f1e4c8', glow: '#9dffcf', eye: '#ffd166' },
  voltkite: { primary: '#3b3f9e', secondary: '#23255e', belly: '#8f94d9', accent: '#6ff3ff', glow: '#6ff3ff', eye: '#fff27a' },
  hearthback: { primary: '#2a2433', secondary: '#4a3f52', belly: '#7a5c4f', accent: '#ff7a2e', glow: '#ffb13b', eye: '#ffd166' },
  briarwick: { primary: '#5e8f3a', secondary: '#6b4a2f', belly: '#c9d98f', accent: '#ff9ec7', glow: '#d8ff7a', eye: '#fff3b0', extra: '#e8dcc0' },
};

/**
 * Set a glow material's brightness. level 0 = dim ember (0.3×), 1 = full palette colour,
 * up to ~1.35 for short spikes (vent / detonate) — the glare bar (CONTRACT §6.1) keeps glows
 * at a few × the body luminance, never blown out.
 */
export function applyGlow(model: TitanModel, level: number, index = -1): void {
  const k = 0.3 + 0.7 * Math.max(0, Math.min(1.35, level));
  for (let i = 0; i < model.glow.length; i++) {
    if (index >= 0 && i !== index) continue;
    const m = model.glow[i] as THREE.MeshBasicMaterial;
    m.color.copy(model.glowColors[i]).multiplyScalar(k);
  }
}

/**
 * Set the body's stepped fresnel rim: a comic edge-light band on the facets that turn away from
 * the camera. Night biomes use it (tinted palette.rim) so a dark titan separates from a dark street
 * without bloom; portraits use it for their hero light. `lo`/`hi` = the fresnel band edges
 * (1 − |n·v|): lower = a wider band. Strength is additive light (× colour, linear), kept small so the
 * rim sits at a few × the body's own luminance (glare bar, CONTRACT §6.1).
 */
export function setTitanRim(model: TitanModel, color: THREE.ColorRepresentation, strength: number, lo = 0.58, hi = 0.66): void {
  model.rim.color.set(color);
  model.rim.strength.value = Math.max(0, strength);
  model.rim.band.value.set(lo, Math.max(lo + 0.01, hi));
}

/**
 * Self fill: adds `fill` × the painted albedo to the body (a titan-only character light — the
 * diffuse term, NOT an emissive trim). Night biomes lift a dark hide with it so the body's VALUE
 * reads against a navy street while the toon bands keep their steps.
 */
export function setTitanFill(model: TitanModel, fill: number): void {
  model.rim.fill.value = Math.max(0, fill);
}

/** Shared source for the rim injection — ONE program key for every titan (warmup compiles it once;
 *  uniforms are per material, so switching biome / strength never recompiles). */
const RIM_FRAG = `{
    vec3 rimV = normalize( -vViewPosition );
    float rimF = 1.0 - clamp( abs( dot( rimV, normal ) ), 0.0, 1.0 );
    gl_FragColor.rgb += diffuseColor.rgb * uRimFill
      + uRimColor * ( smoothstep( uRimBand.x, uRimBand.y, rimF ) * uRimStrength );
  }
  #include <tonemapping_fragment>`;

const RIM_DECL = `uniform vec3 uRimColor;
uniform float uRimStrength;
uniform vec2 uRimBand;
uniform float uRimFill;
`;

function installRim(mat: THREE.MeshToonMaterial, rim: TitanModel['rim']): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: rim.color };
    sh.uniforms.uRimStrength = rim.strength;
    sh.uniforms.uRimBand = rim.band;
    sh.uniforms.uRimFill = rim.fill;
    sh.fragmentShader = RIM_DECL + sh.fragmentShader.replace('#include <tonemapping_fragment>', RIM_FRAG);
  };
  mat.customProgramCacheKey = () => 'titanSkinRim2';
}

// ─────────────────────────────── vector helpers (build time only) ───────────────────────────────
type V3 = [number, number, number];
const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mirX = (a: V3): V3 => [-a[0], a[1], a[2]];
/** Rodrigues rotation of v about unit axis k by angle a */
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
/** Catmull-Rom through control points → n evenly-parameterised samples */
function spline(ctrl: V3[], n: number): V3[] {
  const out: V3[] = [];
  const m = ctrl.length - 1;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * m;
    const k = Math.min(m - 1, Math.floor(u));
    const t = u - k;
    const p0 = ctrl[Math.max(0, k - 1)], p1 = ctrl[k], p2 = ctrl[k + 1], p3 = ctrl[Math.min(m, k + 2)];
    const t2 = t * t, t3 = t2 * t;
    const f = (a: number, b: number, c: number, d: number) =>
      0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
  }
  return out;
}
const sstep = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ─────────────────────────────── colour helpers ───────────────────────────────
const C = (hex: string) => new THREE.Color(hex);
/** shade a colour (linear space) by k (<1 darker, >1 lighter toward white) */
function shade(c: THREE.Color, k: number): THREE.Color {
  const o = c.clone();
  if (k <= 1) return o.multiplyScalar(k);
  return o.lerp(new THREE.Color(1, 1, 1), Math.min(1, k - 1));
}
function mix(a: THREE.Color, b: THREE.Color, t: number): THREE.Color { return a.clone().lerp(b, t); }

// ─────────────────────────────── geometry builder ───────────────────────────────
/** Skin binding: weight w on bone b, (1 − w) on bone a. */
interface Skin { a: number; b: number; w: number }
/** What a paint callback knows about the face it colours. */
interface Face {
  c: V3;        // centroid (model space)
  n: V3;        // declared outward normal
  t: number;    // 0..1 along the primitive (sweep length / lathe profile / slab local v)
  a: number;    // angle around the primitive (sweeps/lathes), radians; 0 = side (+X side for horizontal spines), π/2 = up
  l: [number, number];   // slab: local (u, v) of the face centroid
}
type Paint = THREE.Color | ((f: Face) => THREE.Color);

class Geo {
  pos: number[] = []; nor: number[] = []; col: number[] = []; si: number[] = []; sw: number[] = [];
  /** default rigid bone for primitives that are not given explicit skins */
  bone = 0;
  /** per-face brightness jitter (hand-painted facets); 0 disables */
  jitter = 0.05;
  private faces = 0;

  private skin(s: Skin | undefined): Skin { return s ?? { a: this.bone, b: this.bone, w: 0 }; }

  /** One triangle, flipped if needed so its face normal agrees with the declared normal `dn`. */
  tri(p0: V3, p1: V3, p2: V3, color: THREE.Color, dn: V3 | null, s0?: Skin, s1?: Skin, s2?: Skin): void {
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    let bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) return;                           // degenerate
    nx /= nl; ny /= nl; nz /= nl;
    let q1 = p1, q2 = p2, k1 = s1, k2 = s2;
    if (dn && nx * dn[0] + ny * dn[1] + nz * dn[2] < 0) {
      q1 = p2; q2 = p1; k1 = s2; k2 = s1; nx = -nx; ny = -ny; nz = -nz;
    }
    void ax; void bx;
    const f = this.faces++;
    const h = Math.sin(f * 12.9898 + 78.233) * 43758.5453;
    const j = 1 + (h - Math.floor(h) - 0.5) * 2 * this.jitter;
    const r = color.r * j, g = color.g * j, b = color.b * j;
    const pts = [p0, q1, q2];
    const sks = [this.skin(s0), this.skin(k1), this.skin(k2)];
    for (let i = 0; i < 3; i++) {
      const p = pts[i], s = sks[i];
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(r, g, b);
      this.si.push(s.a, s.b, 0, 0);
      this.sw.push(1 - s.w, s.w, 0, 0);
    }
  }

  quad(p00: V3, p01: V3, p11: V3, p10: V3, color: THREE.Color, dn: V3 | null, s00?: Skin, s01?: Skin, s11?: Skin, s10?: Skin): void {
    this.tri(p00, p01, p11, color, dn, s00, s01, s11);
    this.tri(p00, p11, p10, color, dn, s00, s11, s10);
  }

  get vertexCount(): number { return this.pos.length / 3; }

  scale(k: number): void { for (let i = 0; i < this.pos.length; i++) this.pos[i] *= k; }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function paintOf(p: Paint, f: Face): THREE.Color { return typeof p === 'function' ? p(f) : p; }

// ── sweep: tapered polygonal tube along a spine (bodies, necks, tails, limbs, horns) ──
interface Ring { p: V3; rx: number; ry: number; skin?: Skin }
interface SweepOpt {
  sides: number;
  /** reference "up" used to build the first frame (parallel transport after that) */
  up?: V3;
  /** start / end caps: > 0 = pointed cap of that length, 0 = flat, < 0 = open */
  cap0?: number; cap1?: number;
  paint: Paint;
  /** angle of the first ring vertex (rad) */
  phase?: number;
  /** unit cross-section: angle → (side, up) multipliers (default circle) */
  shape?: (a: number, t: number) => [number, number];
}
function sweep(g: Geo, rings: Ring[], o: SweepOpt): void {
  const n = rings.length;
  if (n < 2) return;
  const sides = o.sides;
  const up0 = o.up ?? v3(0, 1, 0);
  const T: V3[] = [], S: V3[] = [], U: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = rings[Math.max(0, i - 1)].p, b = rings[Math.min(n - 1, i + 1)].p;
    T.push(norm(sub(b, a)));
  }
  let side = cross(up0, T[0]);
  if (len(side) < 1e-6) side = cross(v3(0, 0, 1), T[0]);
  if (len(side) < 1e-6) side = cross(v3(1, 0, 0), T[0]);
  side = norm(side);
  S.push(side); U.push(norm(cross(T[0], side)));
  for (let i = 1; i < n; i++) {
    let s = S[i - 1], u = U[i - 1];
    const ax = cross(T[i - 1], T[i]);
    const al = len(ax);
    if (al > 1e-9) {
      const ang = Math.atan2(al, dot(T[i - 1], T[i]));
      const k = mul(ax, 1 / al);
      s = rot(s, k, ang); u = rot(u, k, ang);
    }
    S.push(norm(s)); U.push(norm(u));
  }
  const ph = o.phase ?? 0;
  const V: V3[][] = [];
  const A: number[] = [];
  for (let j = 0; j < sides; j++) A.push(ph + (j / sides) * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const r = rings[i], t = i / (n - 1);
    const row: V3[] = [];
    for (let j = 0; j < sides; j++) {
      const [cx, cy] = o.shape ? o.shape(A[j], t) : [Math.cos(A[j]), Math.sin(A[j])];
      row.push(add(r.p, add(mul(S[i], cx * r.rx), mul(U[i], cy * r.ry))));
    }
    V.push(row);
  }
  const face: Face = { c: [0, 0, 0], n: [0, 1, 0], t: 0, a: 0, l: [0, 0] };
  for (let i = 0; i < n - 1; i++) {
    const axis = lerp3(rings[i].p, rings[i + 1].p, 0.5);
    const si0 = rings[i].skin, si1 = rings[i + 1].skin;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      const p00 = V[i][j], p01 = V[i][j1], p10 = V[i + 1][j], p11 = V[i + 1][j1];
      const c = mul(add(add(p00, p01), add(p10, p11)), 0.25);
      let dn = sub(c, axis);
      if (len(dn) < 1e-9) dn = add(mul(S[i], Math.cos(A[j])), mul(U[i], Math.sin(A[j])));
      face.c = c; face.n = norm(dn); face.t = (i + 0.5) / (n - 1); face.a = ph + ((j + 0.5) / sides) * Math.PI * 2;
      const col = paintOf(o.paint, face);
      g.quad(p00, p10, p11, p01, col, face.n, si0, si1, si1, si0);
    }
  }
  const cap = (i: number, lenCap: number | undefined, dir: number) => {
    if (lenCap === undefined || lenCap < 0) return;
    const ring = rings[i];
    const Td = mul(T[i], dir);
    const rMean = (ring.rx + ring.ry) * 0.5;
    const tip = lenCap > 0 ? add(ring.p, mul(Td, lenCap)) : ring.p;
    const inside = sub(ring.p, mul(Td, rMean * 0.5));
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      const a = V[i][j], b = V[i][j1];
      const c = mul(add(add(a, b), tip), 1 / 3);
      const dn = lenCap > 0 ? norm(sub(c, inside)) : Td;
      face.c = c; face.n = dn; face.t = i === 0 ? 0 : 1; face.a = ph + ((j + 0.5) / sides) * Math.PI * 2;
      g.tri(a, b, tip, paintOf(o.paint, face), dn, ring.skin, ring.skin, ring.skin);
    }
  };
  cap(0, o.cap0, -1);
  cap(n - 1, o.cap1, 1);
}

// ── lathe: revolve an (r, y) profile around a frame's y axis (eyes, domes, pods, pads) ──
interface Frame { o: V3; x: V3; y: V3; z: V3 }
/** orthonormal-ish frame whose y axis is `axis`; x built from `hint` (scaled axes allowed by callers) */
function frameAxis(o: V3, axis: V3, hint: V3 = [0, 1, 0]): Frame {
  const y = norm(axis);
  let x = cross(hint, y);
  if (len(x) < 1e-6) x = cross([0, 0, 1], y);
  if (len(x) < 1e-6) x = cross([1, 0, 0], y);
  x = norm(x);
  const z = norm(cross(x, y));
  return { o, x, y, z };
}
function lathe(g: Geo, prof: [number, number][], sides: number, fr: Frame, paint: Paint,
  skin?: (y: number, p: V3) => Skin, phase = 0, sx = 1, sz = 1): void {
  const m = prof.length;
  const P: V3[][] = [];
  const pt = (r: number, y: number, a: number): V3 =>
    add(fr.o, add(mul(fr.x, r * Math.cos(a) * sx), add(mul(fr.y, y), mul(fr.z, r * Math.sin(a) * sz))));
  for (let k = 0; k < m; k++) {
    const row: V3[] = [];
    for (let j = 0; j < sides; j++) row.push(pt(prof[k][0], prof[k][1], phase + (j / sides) * Math.PI * 2));
    P.push(row);
  }
  const face: Face = { c: [0, 0, 0], n: [0, 1, 0], t: 0, a: 0, l: [0, 0] };
  const y0 = prof[0][1], y1 = prof[m - 1][1];
  for (let k = 0; k < m - 1; k++) {
    const dr = prof[k + 1][0] - prof[k][0], dy = prof[k + 1][1] - prof[k][1];
    const n2l = Math.hypot(dy, dr) || 1;
    const nr = dy / n2l, ny = -dr / n2l;       // outward normal for a bottom→top outer profile
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      const am = phase + ((j + 0.5) / sides) * Math.PI * 2;
      const dn = norm(add(mul(fr.x, nr * Math.cos(am) / sx), add(mul(fr.y, ny), mul(fr.z, nr * Math.sin(am) / sz))));
      const a = P[k][j], b = P[k][j1], c = P[k + 1][j1], d = P[k + 1][j];
      const cen = mul(add(add(a, b), add(c, d)), 0.25);
      face.c = cen; face.n = dn; face.a = am;
      face.t = y1 !== y0 ? ((prof[k][1] + prof[k + 1][1]) * 0.5 - y0) / (y1 - y0) : 0;
      const col = paintOf(paint, face);
      const s0 = skin ? skin(prof[k][1], a) : undefined, s1 = skin ? skin(prof[k + 1][1], c) : undefined;
      g.quad(a, b, c, d, col, dn, s0, s0, s1, s1);
    }
  }
}

// ── slab: bevelled plate from a convex 2D polygon (fins, ears, membranes, petals, leaves) ──
interface SlabFrame { o: V3; u: V3; v: V3; w: V3 }
function slab(g: Geo, poly: [number, number][], thick: number, bevel: number, fr: SlabFrame, paint: Paint,
  skinAt?: (p: V3, lv: number) => Skin): void {
  const m = poly.length;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= m; cy /= m;
  let vmin = Infinity, vmax = -Infinity;
  for (const p of poly) { vmin = Math.min(vmin, p[1]); vmax = Math.max(vmax, p[1]); }
  const at = (u: number, v: number, w: number): V3 => add(fr.o, add(mul(fr.u, u), add(mul(fr.v, v), mul(fr.w, w))));
  const inset = poly.map(([u, v]) => {
    const dx = cx - u, dy = cy - v, d = Math.hypot(dx, dy) || 1;
    const k = Math.min(bevel, d * 0.6) / d;
    return [u + dx * k, v + dy * k] as [number, number];
  });
  const h = thick / 2;
  const face: Face = { c: [0, 0, 0], n: [0, 1, 0], t: 0, a: 0, l: [0, 0] };
  const tv = (v: number) => (vmax > vmin ? (v - vmin) / (vmax - vmin) : 0);
  const sk = (u: number, v: number, w: number) => (skinAt ? skinAt(at(u, v, w), tv(v)) : undefined);
  for (const sgn of [1, -1]) {
    const ctr = at(cx, cy, h * sgn);
    const dn = mul(fr.w, sgn);
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const a = at(inset[k][0], inset[k][1], h * sgn), b = at(inset[k1][0], inset[k1][1], h * sgn);
      const lu = (cx + inset[k][0] + inset[k1][0]) / 3, lv = (cy + inset[k][1] + inset[k1][1]) / 3;
      face.c = mul(add(add(a, b), ctr), 1 / 3); face.n = dn; face.l = [lu, lv]; face.t = tv(lv);
      g.tri(ctr, a, b, paintOf(paint, face), dn, sk(cx, cy, h * sgn), sk(inset[k][0], inset[k][1], h * sgn), sk(inset[k1][0], inset[k1][1], h * sgn));
    }
    // chamfer ring: mid outline → inset face
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      const ex = poly[k1][0] - poly[k][0], ey = poly[k1][1] - poly[k][1];
      let ox = ey, oy = -ex;                                  // edge normal (either way)
      const mx = (poly[k][0] + poly[k1][0]) / 2 - cx, my = (poly[k][1] + poly[k1][1]) / 2 - cy;
      if (ox * mx + oy * my < 0) { ox = -ox; oy = -oy; }       // point away from the centroid
      const ol = Math.hypot(ox, oy) || 1;
      const out = norm(add(add(mul(fr.u, ox / ol), mul(fr.v, oy / ol)), mul(fr.w, 0.8 * sgn)));
      const a = at(poly[k][0], poly[k][1], 0), b = at(poly[k1][0], poly[k1][1], 0);
      const c = at(inset[k1][0], inset[k1][1], h * sgn), d = at(inset[k][0], inset[k][1], h * sgn);
      const lu = (poly[k][0] + poly[k1][0]) / 2, lv = (poly[k][1] + poly[k1][1]) / 2;
      face.c = mul(add(add(a, b), add(c, d)), 0.25); face.n = out; face.l = [lu, lv]; face.t = tv(lv);
      g.quad(a, b, c, d, shade(paintOf(paint, face), 0.92), out,
        sk(poly[k][0], poly[k][1], 0), sk(poly[k1][0], poly[k1][1], 0), sk(inset[k1][0], inset[k1][1], h * sgn), sk(inset[k][0], inset[k][1], h * sgn));
    }
  }
}
function slabFrame(o: V3, u: V3, v: V3): SlabFrame {
  const uu = norm(u);
  const w = norm(cross(uu, v));
  const vv = norm(cross(w, uu));
  return { o, u: uu, v: vv, w };
}

/** clip a convex polygon against the horizontal line v = cut, keeping the part below (or above) */
function clipV(poly: [number, number][], cut: number, below: boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = below ? a[1] <= cut : a[1] >= cut, ib = below ? b[1] <= cut : b[1] >= cut;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (cut - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, cut]); }
  }
  return out;
}
/** two-tone bevelled plate: the part of `poly` below local v = cut painted `low`, above it `high`
 *  (a crisp painted band with a small crease, e.g. cream fin tips) */
function slab2(g: Geo, poly: [number, number][], cut: number, thick: number, bevel: number, fr: SlabFrame,
  low: Paint, high: Paint, skinAt?: (p: V3, lv: number) => Skin): void {
  const a = clipV(poly, cut, true), b = clipV(poly, cut, false);
  if (a.length >= 3) slab(g, a, thick, bevel, fr, low, skinAt);
  if (b.length >= 3) slab(g, b, thick * 0.96, bevel, fr, high, skinAt);
}

// ── cone: spikes, teeth, claws, shards ──
function cone(g: Geo, base: V3, tip: V3, r: number, sides: number, paint: Paint, sb?: Skin, st?: Skin, phase = 0, flat = 1): void {
  const axis = sub(tip, base);
  const fr = frameAxis(base, axis, Math.abs(norm(axis)[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]);
  const pts: V3[] = [];
  for (let j = 0; j < sides; j++) {
    const a = phase + (j / sides) * Math.PI * 2;
    pts.push(add(base, add(mul(fr.x, Math.cos(a) * r), mul(fr.z, Math.sin(a) * r * flat))));
  }
  const face: Face = { c: [0, 0, 0], n: [0, 1, 0], t: 0.5, a: 0, l: [0, 0] };
  const inside = add(base, mul(axis, 0.25));
  for (let j = 0; j < sides; j++) {
    const a = pts[j], b = pts[(j + 1) % sides];
    const c = mul(add(add(a, b), tip), 1 / 3);
    face.c = c; face.n = norm(sub(c, inside)); face.a = phase + ((j + 0.5) / sides) * Math.PI * 2; face.t = 0.66;
    g.tri(a, b, tip, paintOf(paint, face), face.n, sb, sb, st ?? sb);
    face.c = mul(add(add(a, b), base), 1 / 3); face.n = mul(norm(axis), -1); face.t = 0;
    g.tri(a, b, base, paintOf(paint, face), face.n, sb, sb, sb);
  }
}

// ── ribbon: thin glowing strip lying on a surface (magma seams) ──
function ribbon(g: Geo, pts: V3[], nrm: V3[], width: number, lift: number, paint: Paint, skin?: Skin): void {
  const face: Face = { c: [0, 0, 0], n: [0, 1, 0], t: 0, a: 0, l: [0, 0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = add(pts[i], mul(nrm[i], lift)), b = add(pts[i + 1], mul(nrm[i + 1], lift));
    const tng = norm(sub(b, a));
    const la = mul(norm(cross(nrm[i], tng)), width / 2), lb = mul(norm(cross(nrm[i + 1], tng)), width / 2);
    const dn = norm(add(nrm[i], nrm[i + 1]));
    face.c = lerp3(a, b, 0.5); face.n = dn; face.t = i / Math.max(1, pts.length - 2);
    g.quad(sub(a, la), add(a, la), add(b, lb), sub(b, lb), paintOf(paint, face), dn, skin, skin, skin, skin);
  }
}

// ── low-poly ellipsoid blob (lathe of a sphere profile, arbitrary orientation) ──
function blob(g: Geo, c: V3, axis: V3, ry: number, rxz: number, sides: number, rings: number, paint: Paint,
  skin?: Skin, hint: V3 = [0, 1, 0], phase = 0, sz = 1, flatBottom = -1): void {
  const prof: [number, number][] = [];
  for (let k = 0; k <= rings; k++) {
    const ph = (k / rings) * Math.PI;
    let y = -Math.cos(ph) * ry;
    let r = Math.sin(ph) * rxz;
    if (flatBottom > -1 && y < flatBottom * ry) { y = flatBottom * ry; }
    if (k === 0 || k === rings) r = 0;
    prof.push([r, y]);
  }
  const fr = frameAxis(c, axis, hint);
  lathe(g, prof, sides, fr, paint, skin ? () => skin : undefined, phase, 1, sz);
}

// ─────────────────────────────── rig ───────────────────────────────
class Rig {
  bones: THREE.Bone[] = [];
  idx: Record<string, number> = {};
  rest: Record<string, V3> = {};
  add(name: string, parent: string | null, p: V3): number {
    const b = new THREE.Bone();
    b.name = name;
    const pp: V3 = parent ? this.rest[parent] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent) this.bones[this.idx[parent]].add(b);
    this.idx[name] = this.bones.length;
    this.rest[name] = [p[0], p[1], p[2]];
    this.bones.push(b);
    return this.idx[name];
  }
  /** rigid binding to one joint */
  s(name: string): Skin { const i = this.idx[name]; return { a: i, b: i, w: 0 }; }
  /** blend: (1 − w) on n0, w on n1 */
  mix(n0: string, n1: string, w: number): Skin { return { a: this.idx[n0], b: this.idx[n1], w: Math.max(0, Math.min(1, w)) }; }
  /** piecewise-linear blend along a joint chain by a scalar coordinate (e.g. z along the spine) */
  chain(names: string[], coords: number[], x: number): Skin {
    const n = names.length;
    const asc = coords[n - 1] >= coords[0];
    const inRange = (a: number, b: number) => (asc ? x >= a && x <= b : x <= a && x >= b);
    if (asc ? x <= coords[0] : x >= coords[0]) return this.s(names[0]);
    if (asc ? x >= coords[n - 1] : x <= coords[n - 1]) return this.s(names[n - 1]);
    for (let i = 0; i < n - 1; i++) {
      if (inRange(coords[i], coords[i + 1])) {
        const w = (x - coords[i]) / (coords[i + 1] - coords[i] || 1);
        return this.mix(names[i], names[i + 1], sstep(0, 1, w));
      }
    }
    return this.s(names[n - 1]);
  }
}

// ─────────────────────────────── shared anatomy ───────────────────────────────
/** A tube along Catmull-Rom control points with interpolated (rx, ry) radii. */
function tubeRings(ctrl: V3[], radii: [number, number][], n: number, skinAt?: (p: V3, t: number) => Skin): Ring[] {
  const pts = spline(ctrl, n);
  const rr = spline(radii.map(([a, b]) => [a, b, 0] as V3), n);
  return pts.map((p, i) => ({ p, rx: Math.max(0.002, rr[i][0]), ry: Math.max(0.002, rr[i][1]), skin: skinAt ? skinAt(p, i / (n - 1)) : undefined }));
}
/** linear interpolation over parallel arrays keyed by z (descending or ascending) */
function interpZ(zs: number[], vals: number[], z: number): number {
  const asc = zs[zs.length - 1] > zs[0];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i], b = zs[i + 1];
    if (asc ? z >= a && z <= b : z <= a && z >= b) return vals[i] + (vals[i + 1] - vals[i]) * ((z - a) / (b - a || 1));
  }
  return (asc ? z < zs[0] : z > zs[0]) ? vals[0] : vals[vals.length - 1];
}

interface EyeStyle {
  sclera: string; iris: string; pupil: string;
  /** fraction of the eye (from the front pole, local-y units 0..2) covered by iris / pupil */
  iris01?: number; pupil01?: number;
  slit?: boolean;
  /** vertical squash of the eyeball (1 = round) */
  squash?: number;
}
/** Eyeball lathed along `look`, painted sclera → iris → pupil with a glint facet. Bound to `bone`. */
function buildEye(ge: Geo, rig: Rig, bone: string, c: V3, look: V3, r: number, st: EyeStyle): void {
  const L = norm(look);
  const sides = 12, rings = 7;
  const prof: [number, number][] = [];
  for (let k = 0; k <= rings; k++) {
    const ph = (k / rings) * Math.PI;
    prof.push([k === 0 || k === rings ? 0 : Math.sin(ph) * r, -Math.cos(ph) * r]);
  }
  const fr = frameAxis(c, L, [0, 1, 0]);
  const worldUp = norm(sub([0, 1, 0], mul(L, dot([0, 1, 0], L))));
  const sideV = norm(cross(worldUp, L));
  const sc = C(st.sclera), ir = C(st.iris), pu = C(st.pupil), glint = C('#ffffff');
  const irisK = 1 - (st.iris01 ?? 0.75), pupK = 1 - (st.pupil01 ?? 0.3);
  const squash = st.squash ?? 1;
  const paint = (f: Face): THREE.Color => {
    const d = sub(f.c, c);
    const yy = dot(d, L) / r, up = dot(d, worldUp) / (r * squash), sd = dot(d, sideV) / r;
    if (yy > 0.35 && up > 0.3 && up < 0.72 && sd > -0.05 && sd < 0.42) return glint;
    if (st.slit) {
      if (yy > pupK - 0.25 && Math.abs(sd) < 0.2) return pu;
    } else if (yy > pupK) return pu;
    if (yy > irisK) return ir;
    return sc;
  };
  const g2 = new Geo(); g2.jitter = 0;
  lathe(g2, prof, sides, fr, paint, () => rig.s(bone));
  // squash along world-up (almond / sleepy eyes)
  for (let i = 0; i < g2.pos.length; i += 3) {
    const p: V3 = [g2.pos[i], g2.pos[i + 1], g2.pos[i + 2]];
    const u = dot(sub(p, c), worldUp);
    const q = add(p, mul(worldUp, u * (squash - 1)));
    g2.pos[i] = q[0]; g2.pos[i + 1] = q[1]; g2.pos[i + 2] = q[2];
  }
  for (let i = 0; i < g2.pos.length; i++) ge.pos.push(g2.pos[i]);
  for (let i = 0; i < g2.nor.length; i++) ge.nor.push(g2.nor[i]);
  for (let i = 0; i < g2.col.length; i++) ge.col.push(g2.col[i]);
  for (let i = 0; i < g2.si.length; i++) { ge.si.push(g2.si[i]); ge.sw.push(g2.sw[i]); }
}

interface LegSpec {
  name: 'legFL' | 'legFR' | 'legBL' | 'legBR';
  parent: string;
  /** left-side (+X) positions; the right side is mirrored */
  hip: V3; knee: V3; ankle: V3;
  /** radii at hip, upper-mid, knee, lower-mid, ankle */
  r: [number, number, number, number, number];
  paint: Paint;
  sides: number;
  foot: (g: Geo, rig: Rig, ankle: V3, side: 1 | -1, bone: string, front: boolean) => void;
  /** first ring, buried in the body so the shoulder never shows a gap when the leg swings */
  root?: V3;
}
function buildLeg(g: Geo, rig: Rig, spec: LegSpec): LegDef {
  const side: 1 | -1 = spec.name === 'legFL' || spec.name === 'legBL' ? 1 : -1;
  const m = (p: V3): V3 => (side > 0 ? p : mirX(p));
  const hip = m(spec.hip), knee = m(spec.knee), ankle = m(spec.ankle);
  const up = spec.name + 'Up', low = spec.name + 'Low', foot = spec.name + 'Foot';
  rig.add(up, spec.parent, hip);
  rig.add(low, up, knee);
  rig.add(foot, low, ankle);
  const rootP = spec.root ? m(spec.root) : lerp3(hip, [0, hip[1], hip[2]], 0.45);
  const [r0, r1, r2, r3, r4] = spec.r;
  const rings: Ring[] = [
    { p: rootP, rx: r0 * 0.95, ry: r0 * 0.95, skin: rig.mix(spec.parent, up, 0.2) },
    { p: hip, rx: r0, ry: r0, skin: rig.mix(spec.parent, up, 0.55) },
    { p: lerp3(hip, knee, 0.5), rx: r1, ry: r1, skin: rig.s(up) },
    { p: knee, rx: r2, ry: r2, skin: rig.mix(up, low, 0.5) },
    { p: lerp3(knee, ankle, 0.5), rx: r3, ry: r3, skin: rig.s(low) },
    { p: ankle, rx: r4, ry: r4, skin: rig.mix(low, foot, 0.6) },
  ];
  sweep(g, rings, { sides: spec.sides, up: [0, 0, 1], cap0: 0, cap1: 0, paint: spec.paint, phase: Math.PI / spec.sides });
  const front = spec.name === 'legFL' || spec.name === 'legFR';
  spec.foot(g, rig, ankle, side, foot, front);
  // bend direction at rest = where the knee sits off the hip→ankle line (the IK keeps that side)
  const ha = norm(sub(ankle, hip));
  const off = sub(knee, hip);
  let pole = sub(off, mul(ha, dot(off, ha)));
  if (len(pole) < 1e-4) pole = [0, 0, front ? -1 : 1];
  pole = norm(pole);
  return { name: spec.name, up, low, foot, parent: spec.parent, pole, front, side };
}

/** splayed lizard hand: flat pad + 4 fingers fanned forward/outward + cream claws */
function lizardFoot(pad: THREE.Color, toe: THREE.Color, claw: THREE.Color, size: number) {
  return (g: Geo, rig: Rig, ankle: V3, side: 1 | -1, bone: string, front: boolean): void => {
    const s = rig.s(bone);
    const base: V3 = [ankle[0] + side * 0.02 * size, 0, ankle[2] + 0.02 * size];
    blob(g, [base[0], 0.035 * size, base[2]], [0, 1, 0], 0.035 * size, 0.085 * size, 7, 3, pad, s, [0, 0, 1], 0.3, 1.15, -0.6);
    const fan = front ? [-0.35, 0.05, 0.45, 0.95] : [-0.25, 0.2, 0.62, 1.1];
    for (let i = 0; i < fan.length; i++) {
      const a = fan[i];
      const dir: V3 = norm([Math.sin(a) * side, 0, Math.cos(a)]);
      const l = (i === 1 || i === 2 ? 0.13 : 0.1) * size;
      const p0: V3 = [base[0] + dir[0] * 0.05 * size, 0.03 * size, base[2] + dir[2] * 0.05 * size];
      const p1: V3 = [base[0] + dir[0] * l, 0.028 * size, base[2] + dir[2] * l];
      sweep(g, [{ p: p0, rx: 0.028 * size, ry: 0.024 * size, skin: s }, { p: p1, rx: 0.021 * size, ry: 0.019 * size, skin: s }],
        { sides: 5, cap0: 0, cap1: 0, paint: toe, up: [0, 1, 0] });
      cone(g, p1, [p1[0] + dir[0] * 0.05 * size, 0.004, p1[2] + dir[2] * 0.05 * size], 0.018 * size, 4, claw, s);
    }
  };
}
/** rounded paw: pad + toe beans + claws (mammal feet) */
function pawFoot(pad: THREE.Color, claw: THREE.Color, size: number, toes = 3) {
  return (g: Geo, rig: Rig, ankle: V3, _side: 1 | -1, bone: string): void => {
    const s = rig.s(bone);
    const c: V3 = [ankle[0], 0.04 * size, ankle[2] + 0.025 * size];
    blob(g, c, [0, 1, 0], 0.045 * size, 0.07 * size, 7, 4, pad, s, [0, 0, 1], 0.2, 1.25, -0.85);
    for (let i = 0; i < toes; i++) {
      const u = toes === 1 ? 0 : i / (toes - 1) - 0.5;
      const tp: V3 = [c[0] + u * 0.085 * size, 0.03 * size, c[2] + 0.07 * size - Math.abs(u) * 0.02 * size];
      blob(g, tp, [0, 1, 0], 0.03 * size, 0.03 * size, 6, 3, pad, s, [0, 0, 1], 0, 1, -0.9);
      cone(g, [tp[0], 0.022 * size, tp[2] + 0.018 * size], [tp[0], 0.004, tp[2] + 0.055 * size], 0.014 * size, 4, claw, s);
    }
  };
}
/** elephantine column foot: flared drum + toenail plates */
function pillarFoot(skin: THREE.Color, nail: THREE.Color, size: number) {
  return (g: Geo, rig: Rig, ankle: V3, _side: 1 | -1, bone: string): void => {
    const s = rig.s(bone);
    const fr = frameAxis([ankle[0], 0, ankle[2] + 0.01], [0, 1, 0], [0, 0, 1]);
    lathe(g, [[0, 0], [0.15 * size, 0], [0.16 * size, 0.035 * size], [0.14 * size, 0.08 * size], [0.12 * size, 0.1 * size], [0, 0.1 * size]],
      9, fr, skin, () => s, 0.2);
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.55;
      const d: V3 = [Math.sin(a), 0, Math.cos(a)];
      const o: V3 = [ankle[0] + d[0] * 0.15 * size, 0.035 * size, ankle[2] + 0.01 + d[2] * 0.15 * size];
      slab(g, [[-0.035 * size, -0.03 * size], [0.035 * size, -0.03 * size], [0.03 * size, 0.03 * size], [-0.03 * size, 0.03 * size]], 0.02 * size, 0.008 * size,
        slabFrame(o, [d[2], 0, -d[0]], [0, 1, 0]), nail, () => s);
    }
  };
}
/** a row of teeth (cones) at points, pointing along `dir` */
function teeth(g: Geo, pts: V3[], dir: V3, lenT: number, r: number, color: THREE.Color, skin: Skin): void {
  for (const p of pts) cone(g, p, add(p, mul(dir, lenT)), r, 4, color, skin, skin, Math.PI / 4);
}

// ─────────────────────────────── finalize: normalise, bind, outline ───────────────────────────────
interface Parts {
  id: TitanId;
  rig: Rig;
  body: Geo;
  eyes: Geo;
  glow: Geo[];
  /** outline width for each glow mesh as a fraction of the body ink (0 = none) */
  glowInk: number[];
  legs: LegDef[];
  tail: string[];
}

type InkMesh = THREE.SkinnedMesh & { __ink?: number };

function finalize(P: Parts, opts: BuildOpts): TitanModel {
  const geos = [P.body, P.eyes, ...P.glow];
  let maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const g of geos) {
    for (let i = 0; i < g.pos.length; i += 3) {
      maxY = Math.max(maxY, g.pos[i + 1]);
      minX = Math.min(minX, g.pos[i]); maxX = Math.max(maxX, g.pos[i]);
      minZ = Math.min(minZ, g.pos[i + 2]); maxZ = Math.max(maxZ, g.pos[i + 2]);
    }
  }
  const k = 1 / maxY;
  for (const g of geos) g.scale(k);
  for (const name in P.rig.rest) P.rig.rest[name] = mul(P.rig.rest[name], k);
  for (const b of P.rig.bones) b.position.multiplyScalar(k);

  const root = new THREE.Group();
  root.name = 'titan:' + P.id;
  const skinMat = makeToon({ vertexColors: true });
  skinMat.name = 'titanSkin:' + P.id;
  const rim: TitanModel['rim'] = { color: new THREE.Color(1, 1, 1), strength: { value: 0 }, band: { value: new THREE.Vector2(0.58, 0.66) }, fill: { value: 0 } };
  installRim(skinMat, rim);
  const eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  eyeMat.name = 'titanEyes:' + P.id;
  const glowMats = P.glow.map((_, i) => {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    m.name = 'titanGlow:' + P.id + ':' + i;
    return m;
  });

  const body = new THREE.SkinnedMesh(P.body.toGeometry(), skinMat) as InkMesh;
  body.name = 'titanBody:' + P.id;
  body.add(P.rig.bones[0]);
  root.add(body);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(P.rig.bones);
  body.bind(skeleton);
  body.__ink = opts.outlinePx ?? 3.0;
  const meshes: THREE.SkinnedMesh[] = [body];
  const extra: { geo: Geo; mat: THREE.Material; ink: number; name: string }[] = [
    { geo: P.eyes, mat: eyeMat, ink: 0.67, name: 'titanEyes:' + P.id },
    ...P.glow.map((geo, i) => ({ geo, mat: glowMats[i] as THREE.Material, ink: P.glowInk[i] ?? 0, name: 'titanGlow:' + P.id + ':' + i })),
  ];
  for (const e of extra) {
    if (e.geo.vertexCount === 0) continue;
    const m = new THREE.SkinnedMesh(e.geo.toGeometry(), e.mat) as InkMesh;
    m.name = e.name;
    root.add(m);
    m.updateMatrixWorld(true);
    m.bind(skeleton, body.bindMatrix);
    m.__ink = e.ink * (opts.outlinePx ?? 3.0);
    meshes.push(m);
  }
  for (const m of meshes as InkMesh[]) {
    m.frustumCulled = false;             // doctrine §3: bind-pose bounds lie on skinned meshes
    m.castShadow = m.material !== eyeMat;
    m.receiveShadow = m === body;
    if ((m.__ink ?? 0) > 0) addOutline(m, m.__ink);
  }

  const joints: Record<string, THREE.Object3D> = {};
  const rest: Record<string, THREE.Vector3> = {};
  for (const b of P.rig.bones) {
    joints[b.name] = b;
    const r = P.rig.rest[b.name];
    rest[b.name] = new THREE.Vector3(r[0], r[1], r[2]);
  }
  const glowColors = glowMats.map(() => new THREE.Color(1, 1, 1));
  const model: TitanModel = {
    root, joints, glow: glowMats, id: P.id, rest, legs: P.legs, tail: P.tail, meshes,
    skin: skinMat, glowColors, rim,
    size: { width: (maxX - minX) * k, length: (maxZ - minZ) * k, zMin: minZ * k, zMax: maxZ * k },
    dispose(): void {
      for (const m of meshes) m.geometry.dispose();
      skinMat.dispose(); eyeMat.dispose();
      for (const g of glowMats) g.dispose();
      skeleton.dispose();
      root.removeFromParent();
    },
  };
  applyGlow(model, 0.5);
  return model;
}

// ─────────────────────────────── MOLO — squat jade monitor, sawtooth back-fin ───────────────────────────────
function buildMolo(): Parts {
  const K = TITAN_COLORS.molo;
  const P = C(K.primary), S2 = C(K.secondary), B = C(K.belly), A = C(K.accent), G = C(K.glow);
  const mouth = C('#7c3048'), tongue = C('#d4587a'), tooth = C('#fff6e2'), lipC = mix(B, P, 0.25);
  const rig = new Rig();
  const body = new Geo(), eyes = new Geo(), glow = new Geo();

  rig.add('base', null, [0, 0, 0]);
  rig.add('body', 'base', [0, 0.38, -0.02]);
  rig.add('chest', 'body', [0, 0.39, 0.3]);
  rig.add('hips', 'body', [0, 0.37, -0.32]);
  rig.add('neck', 'chest', [0, 0.41, 0.56]);
  rig.add('head', 'neck', [0, 0.45, 0.7]);
  rig.add('jaw', 'head', [0, 0.41, 0.64]);
  rig.add('eyeL', 'head', [0.2, 0.585, 0.8]);
  rig.add('eyeR', 'head', [-0.2, 0.585, 0.8]);
  const tail = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
  const tailZ = [-0.6, -0.92, -1.22, -1.48, -1.72], tailY = [0.36, 0.31, 0.25, 0.18, 0.13];
  let par = 'hips';
  for (let i = 0; i < tail.length; i++) { rig.add(tail[i], par, [0, tailY[i], tailZ[i]]); par = tail[i]; }

  const spineN = ['tail2', 'tail1', 'hips', 'body', 'chest', 'neck', 'head'];
  const spineZ = [-0.92, -0.6, -0.32, -0.02, 0.3, 0.56, 0.7];
  const spineSkin = (p: V3) => rig.chain(spineN, spineZ, p[2]);
  const tailN = ['hips', ...tail], tailZs = [-0.32, ...tailZ];
  const tailSkin = (p: V3) => rig.chain(tailN, tailZs, p[2]);

  // banded jade hide, pale belly
  const hide = (f: Face): THREE.Color => {
    if (f.n[1] < -0.5) return B;
    if (f.n[1] < -0.15) return mix(P, B, 0.5);
    const band = Math.floor((f.c[2] + 3) / 0.21) % 2 === 0;
    if (f.n[1] > 0.45 && band) return S2;
    if (f.n[1] > 0.2 && band) return mix(P, S2, 0.5);
    return P;
  };
  const chunky = (a: number): [number, number] => {
    const c = Math.cos(a), s = Math.sin(a);
    const cx = Math.sign(c) * Math.pow(Math.abs(c), 0.8);
    let cy = Math.sign(s) * Math.pow(Math.abs(s), 0.9);
    if (cy < 0) cy *= 0.78;
    return [cx, cy];
  };

  // torso + neck (one sweep, bends along the spine chain)
  const tz = [-0.66, -0.4, -0.1, 0.2, 0.46, 0.66];
  const ty = [0.36, 0.37, 0.38, 0.39, 0.41, 0.44];
  const trx = [0.19, 0.29, 0.34, 0.34, 0.28, 0.22];
  const tryy = [0.16, 0.2, 0.21, 0.21, 0.18, 0.15];
  sweep(body, tubeRings(tz.map((z, i) => [0, ty[i], z] as V3), trx.map((r, i) => [r, tryy[i]] as [number, number]), 14, (p) => spineSkin(p)),
    { sides: 12, cap0: -1, cap1: 0, paint: hide, shape: chunky, phase: Math.PI / 12 });

  // tail: heavy, laterally compressed, drooping to the ground
  const tailCtrl: V3[] = [[0, 0.36, -0.55], [0, 0.33, -0.85], [0, 0.27, -1.15], [0, 0.2, -1.45], [0, 0.14, -1.72]];
  sweep(body, tubeRings(tailCtrl, [[0.2, 0.17], [0.15, 0.14], [0.1, 0.1], [0.06, 0.066], [0.025, 0.03]], 14, (p) => tailSkin(p)),
    { sides: 10, cap0: -1, cap1: 0.07, paint: hide, shape: chunky, phase: Math.PI / 10 });

  // head: wide flat skull (the palate is its flat underside), blunt snout
  const hz = [0.58, 0.68, 0.8, 0.92, 1.0];
  const hy = [0.46, 0.475, 0.47, 0.455, 0.44];
  const hrx = [0.23, 0.29, 0.28, 0.22, 0.15];
  const hry = [0.13, 0.145, 0.125, 0.095, 0.07];
  const skull = (a: number): [number, number] => {
    const c = Math.cos(a), s = Math.sin(a);
    return [Math.sign(c) * Math.pow(Math.abs(c), 0.75), s < 0 ? s * 0.4 : s];
  };
  const headPaint = (f: Face): THREE.Color => {
    if (f.n[1] < -0.6) return mouth;
    if (f.n[1] < 0.05 && f.c[1] < 0.455) return lipC;
    if (f.c[2] > 0.95 && f.n[1] > 0.2 && Math.abs(f.c[0]) > 0.03 && Math.abs(f.c[0]) < 0.09) return shade(S2, 0.6);
    if (f.n[1] > 0.6 && f.c[2] < 0.78 && f.c[2] > 0.62) return S2;
    return P;
  };
  sweep(body, tubeRings(hz.map((z, i) => [0, hy[i], z] as V3), hrx.map((r, i) => [r, hry[i]] as [number, number]), 9,
    (p) => (p[2] < 0.62 ? rig.mix('neck', 'head', 0.6) : rig.s('head'))),
    { sides: 12, cap0: -1, cap1: 0.035, paint: headPaint, shape: skull, phase: Math.PI / 12 });

  // jaw: flat-topped lower mandible hinged at the back of the mouth
  const jz = [0.6, 0.7, 0.84, 0.95, 1.0];
  const jy = [0.385, 0.39, 0.39, 0.395, 0.4];
  const jrx = [0.2, 0.26, 0.25, 0.18, 0.12];
  const jry = [0.07, 0.075, 0.065, 0.05, 0.035];
  const mandible = (a: number): [number, number] => {
    const c = Math.cos(a), s = Math.sin(a);
    return [Math.sign(c) * Math.pow(Math.abs(c), 0.75), s > 0 ? s * 0.35 : s];
  };
  const jawPaint = (f: Face): THREE.Color => {
    if (f.n[1] > 0.6) return mouth;
    if (f.n[1] < -0.35) return B;
    return lipC;
  };
  sweep(body, tubeRings(jz.map((z, i) => [0, jy[i], z] as V3), jrx.map((r, i) => [r, jry[i]] as [number, number]), 8, () => rig.s('jaw')),
    { sides: 12, cap0: 0, cap1: 0.03, paint: jawPaint, shape: mandible, phase: Math.PI / 12 });
  // tongue
  blob(body, [0, 0.415, 0.8], [0, 0, 1], 0.14, 0.1, 8, 4, tongue, rig.s('jaw'), [0, 1, 0], 0, 0.25);
  // teeth: upper row + two fangs that overhang the lower lip, small lower row
  const up: V3[] = [], lo: V3[] = [];
  for (let i = 0; i < 5; i++) {
    const z = 0.74 + i * 0.055;
    const rx = interpZ(hz, hrx, z) * 0.8, y = interpZ(hz, hy, z) - interpZ(hz, hry, z) * 0.4 + 0.004;
    up.push([rx, y, z], [-rx, y, z]);
    const jrxz = interpZ(jz, jrx, z) * 0.78, jyz = interpZ(jz, jy, z) + interpZ(jz, jry, z) * 0.35 - 0.004;
    if (i % 2 === 0) lo.push([jrxz, jyz, z + 0.02], [-jrxz, jyz, z + 0.02]);
  }
  teeth(body, up, [0, -1, 0], 0.04, 0.017, tooth, rig.s('head'));
  teeth(body, [[0.105, 0.418, 0.955], [-0.105, 0.418, 0.955]], [0, -1, 0.12], 0.075, 0.022, tooth, rig.s('head'));
  teeth(body, lo, [0, 1, 0], 0.03, 0.014, tooth, rig.s('jaw'));
  // brow ridges (cute-menacing) + nostrils
  for (const sd of [1, -1]) {
    sweep(body, tubeRings([[0.1 * sd, 0.6, 0.845], [0.205 * sd, 0.672, 0.805], [0.3 * sd, 0.625, 0.735]], [[0.03, 0.03], [0.036, 0.03], [0.026, 0.024]], 6, () => rig.s('head')),
      { sides: 6, cap0: 0.02, cap1: 0.02, paint: S2, up: [0, 1, 0] });
    blob(body, [0.055 * sd, 0.485, 0.995], [0, 0.4, 1], 0.012, 0.018, 5, 3, shade(S2, 0.45), rig.s('head'));
  }
  // eyes: big, friendly, sit high on the skull
  const eyeStyle: EyeStyle = { sclera: '#fffaf0', iris: K.eye, pupil: '#1b1426', iris01: 0.95, pupil01: 0.52 };
  buildEye(eyes, rig, 'eyeL', rig.rest.eyeL, [0.55, 0.3, 0.8], 0.09, eyeStyle);
  buildEye(eyes, rig, 'eyeR', rig.rest.eyeR, [-0.55, 0.3, 0.8], 0.09, eyeStyle);

  // sawtooth back-fin: alternating tall/short plates, dark jade with cream tips, spine → tail
  const topAt = (z: number): number => {
    if (z > -0.6) return interpZ(tz, ty, z) + interpZ(tz, tryy, z) * 0.97;
    const tzs = tailCtrl.map((p) => p[2]), tys = tailCtrl.map((p) => p[1]);
    return interpZ(tzs, tys, z) + interpZ(tzs, [0.17, 0.14, 0.1, 0.066, 0.03], z) * 0.95;
  };
  const hAt = (z: number) => interpZ([0.52, 0.3, 0.0, -0.3, -0.6, -0.95, -1.25, -1.6], [0.19, 0.3, 0.37, 0.35, 0.27, 0.18, 0.11, 0.05], z);
  let i = 0;
  for (let z = 0.5; z > -1.62; z -= 0.132, i++) {
    const tall = i % 2 === 0;
    const h = hAt(z) * (tall ? 1 : 0.64);
    const wb = 0.07 + h * 0.36;
    const roll = (tall ? 1 : -1) * 0.14;
    const o: V3 = [(tall ? 1 : -1) * 0.012, topAt(z) - 0.02, z];
    const fr = slabFrame(o, [0, 0, -1], [Math.sin(roll), Math.cos(roll), 0]);
    // two-tone plate: dark jade root, crisp cream tip band (the top ~40 % of the plate)
    slab2(body, [[-wb / 2, -0.06], [wb / 2, -0.06], [wb * 0.42, h * 0.5], [wb * 0.1, h]], h * 0.56, 0.045, 0.014, fr,
      S2, A, (p) => spineSkin(p));
  }

  // sprawling legs: elbows out, clawed splayed hands
  const limb = (f: Face): THREE.Color => (f.n[1] < -0.55 ? B : f.t > 0.75 ? mix(P, S2, 0.55) : P);
  const legs: LegDef[] = [];
  const fore = { hip: [0.25, 0.39, 0.33] as V3, knee: [0.5, 0.405, 0.37] as V3, ankle: [0.65, 0.075, 0.45] as V3, root: [0.08, 0.38, 0.33] as V3 };
  const hind = { hip: [0.24, 0.37, -0.34] as V3, knee: [0.51, 0.395, -0.4] as V3, ankle: [0.66, 0.075, -0.5] as V3, root: [0.08, 0.37, -0.34] as V3 };
  const foot = lizardFoot(S2, P, A, 1.0);
  legs.push(buildLeg(body, rig, { name: 'legFL', parent: 'chest', ...fore, r: [0.12, 0.11, 0.1, 0.085, 0.07], paint: limb, sides: 8, foot }));
  legs.push(buildLeg(body, rig, { name: 'legFR', parent: 'chest', ...fore, r: [0.12, 0.11, 0.1, 0.085, 0.07], paint: limb, sides: 8, foot }));
  legs.push(buildLeg(body, rig, { name: 'legBL', parent: 'hips', ...hind, r: [0.14, 0.125, 0.105, 0.09, 0.075], paint: limb, sides: 8, foot }));
  legs.push(buildLeg(body, rig, { name: 'legBR', parent: 'hips', ...hind, r: [0.14, 0.125, 0.105, 0.09, 0.075], paint: limb, sides: 8, foot }));

  // glow: throat furnace at the back of the mouth + gill slits along the neck (vacuum / pulse)
  const gPaint = (f: Face): THREE.Color => mix(G, C('#ffffff'), f.t > 0.6 ? 0.35 : 0);
  blob(glow, [0, 0.415, 0.67], [0, 0, 1], 0.07, 0.12, 8, 4, gPaint, rig.s('head'), [0, 1, 0], 0, 0.45);
  for (const sd of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const z = 0.44 + k * 0.07;
      const x = (interpZ(tz, trx, z) - 0.006) * sd;
      const y = interpZ(tz, ty, z) + 0.02;
      const fr2: SlabFrame = { o: [x, y, z], u: norm([0, 1, 0.15]), v: norm([0, -0.15, 1]), w: [sd, 0, 0] };
      slab(glow, [[-0.05, -0.008], [0.05, -0.008], [0.045, 0.008], [-0.045, 0.008]], 0.03, 0.006, fr2, G, () => spineSkin([x, y, z]));
    }
  }

  return { id: 'molo', rig, body, eyes, glow: [glow], glowInk: [0], legs, tail };
}


// ─────────────────────────────── VOLT-KITE — lean indigo jackal-drake, static mane ───────────────────────────────
function buildVoltkite(): Parts {
  const K = TITAN_COLORS.voltkite;
  const P = C(K.primary), S2 = C(K.secondary), B = C(K.belly), G = C(K.glow);
  const nose = C('#14152e'), mouth = C('#4a2352'), tooth = C('#f4f2ff'), claw = C('#dfe3ff'), innerEar = C('#c9b8f2');
  const tipC = mix(G, C('#ffffff'), 0.6);
  const rig = new Rig();
  const body = new Geo(), eyes = new Geo(), mane = new Geo(), kite = new Geo();

  rig.add('base', null, [0, 0, 0]);
  rig.add('body', 'base', [0, 0.6, -0.04]);
  rig.add('chest', 'body', [0, 0.62, 0.19]);
  rig.add('hips', 'body', [0, 0.6, -0.3]);
  rig.add('neck', 'chest', [0, 0.68, 0.33]);
  rig.add('head', 'neck', [0, 0.82, 0.46]);
  rig.add('jaw', 'head', [0, 0.775, 0.5]);
  rig.add('eyeL', 'head', [0.064, 0.855, 0.575]);
  rig.add('eyeR', 'head', [-0.064, 0.855, 0.575]);
  rig.add('earL', 'head', [0.058, 0.885, 0.46]);
  rig.add('earR', 'head', [-0.058, 0.885, 0.46]);
  rig.add('maneN', 'neck', [0, 0.73, 0.36]);
  rig.add('maneS', 'chest', [0, 0.72, 0.16]);
  rig.add('wingL', 'chest', [0.095, 0.7, 0.08]);
  rig.add('wingR', 'chest', [-0.095, 0.7, 0.08]);
  const tail = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'];
  const tailP: V3[] = [[0, 0.64, -0.46], [0, 0.71, -0.64], [0, 0.75, -0.84], [0, 0.74, -1.04], [0, 0.69, -1.22]];
  let par = 'hips';
  for (let i = 0; i < tail.length; i++) { rig.add(tail[i], par, tailP[i]); par = tail[i]; }

  const spineN = ['tail1', 'hips', 'body', 'chest', 'neck'];
  const spineZ = [-0.46, -0.3, -0.04, 0.19, 0.33];
  const spineSkin = (p: V3) => rig.chain(spineN, spineZ, p[2]);

  // indigo hide: thin dark "bolt" chevrons over the back only, lavender belly + chest blaze
  const hide = (f: Face): THREE.Color => {
    if (f.n[1] < -0.35) return B;
    if (f.n[2] > 0.5 && f.c[2] > 0.2 && f.c[1] < 0.7) return mix(B, P, 0.2);
    if (f.n[1] > 0.55) {
      const u = (f.c[2] + 3 + Math.abs(f.c[0]) * 1.4) / 0.11;
      return u - Math.floor(u) < 0.34 ? S2 : P;
    }
    return f.n[1] < 0.0 ? mix(P, B, 0.5) : P;
  };

  // lean but solid torso: deep chest, tucked waist
  const tz = [-0.47, -0.36, -0.15, 0.04, 0.2, 0.34];
  const top = [0.68, 0.705, 0.705, 0.725, 0.745, 0.735];
  const bot = [0.56, 0.515, 0.565, 0.51, 0.485, 0.55];
  const trx = [0.075, 0.118, 0.098, 0.12, 0.128, 0.09];
  sweep(body, tubeRings(tz.map((z, i) => [0, (top[i] + bot[i]) / 2, z] as V3), trx.map((r, i) => [r, (top[i] - bot[i]) / 2] as [number, number]), 14, (p) => spineSkin(p)),
    { sides: 10, cap0: 0.03, cap1: -1, paint: hide, phase: Math.PI / 10 });
  // neck rising to the head
  const neckSkin = (p: V3): Skin => (p[2] < 0.27 ? rig.mix('chest', 'neck', 0.35) : rig.chain(['chest', 'neck', 'head'], [0.26, 0.36, 0.47], p[2]));
  sweep(body, tubeRings([[0, 0.65, 0.25], [0, 0.72, 0.35], [0, 0.785, 0.43], [0, 0.82, 0.47]], [[0.09, 0.1], [0.074, 0.08], [0.064, 0.07], [0.062, 0.066]], 8, neckSkin),
    { sides: 9, cap0: -1, cap1: -1, paint: hide, phase: Math.PI / 9 });

  // narrow snout on a broad skull: long wedge head
  const hz = [0.41, 0.49, 0.59, 0.69, 0.79];
  const hy = [0.835, 0.845, 0.83, 0.805, 0.788];
  const hrx = [0.066, 0.084, 0.07, 0.046, 0.026];
  const hry = [0.068, 0.076, 0.057, 0.04, 0.026];
  const skull = (a: number): [number, number] => { const c = Math.cos(a), s = Math.sin(a); return [c, s < 0 ? s * 0.55 : s]; };
  const headPaint = (f: Face): THREE.Color => {
    if (f.n[1] < -0.6) return mouth;
    if (f.n[1] < 0.0 && f.c[1] < 0.825) return mix(B, P, 0.15);
    if (f.n[1] > 0.55 && f.c[2] > 0.6) return S2;
    return P;
  };
  sweep(body, tubeRings(hz.map((z, i) => [0, hy[i], z] as V3), hrx.map((r, i) => [r, hry[i]] as [number, number]), 8,
    (p) => (p[2] < 0.45 ? rig.mix('neck', 'head', 0.7) : rig.s('head'))),
    { sides: 10, cap0: -1, cap1: 0.02, paint: headPaint, shape: skull, phase: Math.PI / 10 });
  blob(body, [0, 0.806, 0.806], [0, 0.3, 1], 0.021, 0.026, 6, 3, nose, rig.s('head'));
  // jaw
  const jz = [0.5, 0.59, 0.68, 0.77];
  sweep(body, tubeRings(jz.map((z, i) => [0, [0.776, 0.772, 0.769, 0.767][i], z] as V3), [[0.052, 0.026], [0.05, 0.024], [0.038, 0.019], [0.022, 0.013]], 6, () => rig.s('jaw')),
    { sides: 8, cap0: 0, cap1: 0.014, paint: (f) => (f.n[1] > 0.5 ? mouth : f.n[1] < -0.3 ? B : mix(B, P, 0.3)), phase: Math.PI / 8 });
  teeth(body, [[0.034, 0.79, 0.68], [-0.034, 0.79, 0.68]], [0, -1, 0.1], 0.03, 0.01, tooth, rig.s('head'));
  // keen brows
  for (const sd of [1, -1]) {
    sweep(body, tubeRings([[0.026 * sd, 0.886, 0.615], [0.07 * sd, 0.9, 0.588], [0.098 * sd, 0.884, 0.545]], [[0.013, 0.013], [0.017, 0.013], [0.011, 0.011]], 5, () => rig.s('head')),
      { sides: 5, cap0: 0.01, cap1: 0.01, paint: S2, up: [0, 1, 0] });
  }
  const eyeStyle: EyeStyle = { sclera: '#f6f7ff', iris: K.eye, pupil: '#1b1426', iris01: 0.92, pupil01: 0.5 };
  buildEye(eyes, rig, 'eyeL', rig.rest.eyeL, [0.62, 0.26, 0.74], 0.046, eyeStyle);
  buildEye(eyes, rig, 'eyeR', rig.rest.eyeR, [-0.62, 0.26, 0.74], 0.046, eyeStyle);

  // tall ears / fins (pale inner ear, dark tips)
  for (const sd of [1, -1] as const) {
    const bn = sd > 0 ? 'earL' : 'earR';
    const o = rig.rest[bn];
    const fr = slabFrame(o, [sd, 0, 0.35], [0.36 * sd, 1, -0.3]);
    slab(body, [[-0.05, -0.01], [0.05, -0.01], [0.04, 0.1], [0.01, 0.24], [-0.015, 0.225], [-0.04, 0.09]], 0.026, 0.008, fr,
      (f) => (f.n[2] > 0.2 && f.l[1] < 0.17 && Math.abs(f.l[0]) < 0.03 ? innerEar : f.l[1] > 0.17 ? S2 : P), () => rig.s(bn));
  }

  // small swept shoulder membranes (pale webbing between dark struts)
  for (const sd of [1, -1] as const) {
    const bn = sd > 0 ? 'wingL' : 'wingR';
    const o = rig.rest[bn];
    const fr = slabFrame(o, [0, 0.12, -1], [0.78 * sd, 0.62, 0]);
    slab(body, [[0.035, 0], [-0.035, 0.01], [-0.25, 0.12], [-0.27, 0.2], [-0.13, 0.17], [0.0, 0.09]], 0.016, 0.006, fr,
      (f) => (f.l[1] > 0.15 || f.l[0] > 0.02 ? S2 : mix(B, P, 0.35)), () => rig.s(bn));
  }

  // whip tail + kite fin
  const tailN = ['hips', ...tail], tailZs = [-0.3, ...tailP.map((p) => p[2])];
  const tailCtrl: V3[] = [[0, 0.65, -0.4], ...tailP, [0, 0.66, -1.32]];
  sweep(body, tubeRings(tailCtrl, [[0.064, 0.064], [0.052, 0.052], [0.04, 0.04], [0.03, 0.03], [0.023, 0.023], [0.018, 0.018], [0.015, 0.015]], 16,
    (p) => rig.chain(tailN, tailZs, p[2])),
    { sides: 7, cap0: -1, cap1: 0, paint: (f) => (Math.floor(f.t * 9) % 2 === 1 && f.t > 0.3 ? S2 : f.n[1] < -0.3 ? mix(P, B, 0.5) : P), phase: Math.PI / 7 });
  {
    const o: V3 = [0, 0.66, -1.32];
    const fr = slabFrame(o, norm([0.72, 0.7, 0]), [0, -0.1, -1]);
    const kitePoly: [number, number][] = [[0, -0.04], [0.14, 0.1], [0, 0.34], [-0.14, 0.1]];
    slab(body, kitePoly, 0.024, 0.009, fr, S2, () => rig.s('tail5'));
    slab(kite, kitePoly.map(([u, v]) => [u * 0.58, 0.07 + (v - 0.07) * 0.58] as [number, number]), 0.034, 0.007, fr,
      (f) => (f.l[1] > 0.14 ? tipC : G), () => rig.s('tail5'));
  }

  // static mane: cyan shards along the neck crest (maneN) and flaring off the shoulders (maneS)
  const shard = (bone: string, base: V3, dir: V3, L: number, r: number) => {
    const d = norm(dir);
    const mid = add(base, mul(d, L * 0.42));
    sweep(mane, [{ p: sub(base, mul(d, 0.03)), rx: r, ry: r * 0.5, skin: rig.s(bone) }, { p: mid, rx: r * 0.82, ry: r * 0.45, skin: rig.s(bone) }],
      { sides: 4, cap0: 0, cap1: L * 0.58, paint: (f) => (f.t >= 1 ? tipC : G), up: [0, 1, 0] });
  };
  const crest = spline([[0, 0.74, 0.14], [0, 0.765, 0.26], [0, 0.81, 0.36], [0, 0.87, 0.43]], 9);
  const nS = [[0, 0.16, 0.034], [1, 0.2, 0.038], [2, 0.23, 0.04], [3, 0.24, 0.04], [4, 0.22, 0.038], [5, 0.2, 0.036], [6, 0.17, 0.032], [7, 0.13, 0.028]];
  for (let i = 0; i < nS.length; i++) {
    const [k, L, r] = nS[i];
    const b = crest[k];
    shard(b[2] < 0.27 ? 'maneS' : 'maneN', b, [Math.sin(i * 2.4) * 0.12, 0.8, -0.62], L, r);
    if (i % 2 === 1) for (const sd of [1, -1]) shard(b[2] < 0.27 ? 'maneS' : 'maneN', add(b, [0.045 * sd, -0.03, 0.0]), [0.6 * sd, 0.7, -0.5], L * 0.72, r * 0.85);
  }
  for (const sd of [1, -1]) {
    shard('maneS', [0.085 * sd, 0.72, 0.2], [0.72 * sd, 0.6, -0.2], 0.18, 0.034);
    shard('maneS', [0.1 * sd, 0.7, 0.12], [0.85 * sd, 0.45, -0.45], 0.16, 0.032);
    shard('maneS', [0.075 * sd, 0.735, 0.06], [0.5 * sd, 0.72, -0.55], 0.15, 0.03);
    shard('maneS', [0.11 * sd, 0.66, 0.2], [0.95 * sd, 0.15, -0.2], 0.12, 0.028);
  }

  // long legs: straight forelegs, digitigrade hocks
  const limb = (f: Face): THREE.Color => (f.t > 0.66 ? S2 : f.n[1] < -0.5 || (f.n[2] > 0.6 && f.t > 0.3) ? mix(P, B, 0.45) : P);
  const paw = pawFoot(S2, claw, 0.78, 3);
  const hindFoot = (g: Geo, rg: Rig, ankle: V3, side: 1 | -1, bone: string): void => {
    const s = rg.s(bone);
    const toe: V3 = [ankle[0], 0.05, ankle[2] + 0.06];
    sweep(g, [{ p: ankle, rx: 0.036, ry: 0.036, skin: s }, { p: lerp3(ankle, toe, 0.5), rx: 0.03, ry: 0.03, skin: s }, { p: toe, rx: 0.033, ry: 0.033, skin: s }],
      { sides: 6, cap0: 0, cap1: 0, paint: S2, up: [0, 0, 1] });
    paw(g, rg, [toe[0], 0, toe[2] - 0.02], side, bone);
  };
  const legs: LegDef[] = [];
  const fore = { hip: [0.095, 0.63, 0.22] as V3, knee: [0.115, 0.37, 0.1] as V3, ankle: [0.115, 0.08, 0.23] as V3, root: [0.03, 0.64, 0.22] as V3 };
  const hind = { hip: [0.09, 0.61, -0.33] as V3, knee: [0.12, 0.38, -0.2] as V3, ankle: [0.12, 0.18, -0.39] as V3, root: [0.03, 0.62, -0.33] as V3 };
  for (const nm of ['legFL', 'legFR'] as const) legs.push(buildLeg(body, rig, { name: nm, parent: 'chest', ...fore, r: [0.08, 0.064, 0.046, 0.04, 0.036], paint: limb, sides: 7, foot: paw }));
  for (const nm of ['legBL', 'legBR'] as const) legs.push(buildLeg(body, rig, { name: nm, parent: 'hips', ...hind, r: [0.1, 0.084, 0.052, 0.042, 0.037], paint: limb, sides: 7, foot: hindFoot }));

  return { id: 'voltkite', rig, body, eyes, glow: [mane, kite], glowInk: [0.55, 0], legs, tail };
}

// ─────────────────────────────── HEARTHBACK — walking caldera, obsidian dome shell ───────────────────────────────
function buildHearthback(): Parts {
  const K = TITAN_COLORS.hearthback;
  const P = C(K.primary), S2 = C(K.secondary), B = C(K.belly), A = C(K.accent), G = C(K.glow);
  const nail = C('#cdbfa8'), tusk = C('#f1e4c8'), mouth = C('#3a1a1c'), hot = C('#fff0c2');
  const rig = new Rig();
  const body = new Geo(), eyes = new Geo(), seams = new Geo(), crater = new Geo();

  rig.add('base', null, [0, 0, 0]);
  rig.add('body', 'base', [0, 0.3, -0.04]);
  rig.add('chest', 'body', [0, 0.3, 0.24]);
  rig.add('hips', 'body', [0, 0.3, -0.3]);
  rig.add('shell', 'body', [0, 0.34, -0.04]);
  rig.add('crater', 'shell', [0, 0.93, -0.04]);
  rig.add('neck', 'chest', [0, 0.27, 0.44]);
  rig.add('head', 'neck', [0, 0.27, 0.6]);
  rig.add('jaw', 'head', [0, 0.215, 0.6]);
  rig.add('eyeL', 'head', [0.085, 0.305, 0.69]);
  rig.add('eyeR', 'head', [-0.085, 0.305, 0.69]);
  const tail = ['tail1', 'tail2'];
  rig.add('tail1', 'hips', [0, 0.24, -0.5]);
  rig.add('tail2', 'tail1', [0, 0.17, -0.64]);

  const spineSkin = (p: V3) => rig.chain(['hips', 'body', 'chest'], [-0.3, -0.04, 0.24], p[2]);
  // basalt torso tucked under the shell (wrinkle bands), leathery belly
  const hide = (f: Face): THREE.Color => {
    if (f.n[1] < -0.5) return B;
    const band = Math.floor((f.c[1] + 2) / 0.045) % 2 === 0;
    return band ? S2 : mix(S2, P, 0.35);
  };
  const flatBottom = (a: number): [number, number] => { const c = Math.cos(a), s = Math.sin(a); return [c, s < 0 ? s * 0.72 : s]; };
  sweep(body, tubeRings([[0, 0.29, -0.56], [0, 0.3, -0.4], [0, 0.31, -0.08], [0, 0.31, 0.22], [0, 0.29, 0.42]],
    [[0.16, 0.12], [0.33, 0.19], [0.4, 0.21], [0.37, 0.2], [0.2, 0.14]], 10, (p) => spineSkin(p)),
    { sides: 12, cap0: 0.03, cap1: 0, paint: hide, shape: flatBottom, phase: Math.PI / 12 });

  // ── the caldera shell: a broad volcanic cone of irregular bulged obsidian plates ──
  // Rings rise from the overhanging rim (k = 0) to the crater lip (k = 8). Grid points are jittered
  // (deterministic hash) so plates are irregular slabs, not a gridded dome; the magma seams (glow 0)
  // run along exactly the same jittered borders.
  const R = [0.655, 0.675, 0.65, 0.6, 0.53, 0.45, 0.37, 0.31, 0.27];
  const Y = [0.33, 0.39, 0.48, 0.575, 0.665, 0.745, 0.815, 0.875, 0.915];
  const zc = -0.04;
  const N = 12;
  const hsh = (a: number, b: number, c: number) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h) - 0.5; };
  const dome = (k: number, jj: number): V3 => {
    const j = ((jj % N) + N) % N;
    const edge = k === 0 || k === R.length - 1;
    const a = ((j + (edge ? 0 : hsh(k, j, 1) * 0.55)) / N) * Math.PI * 2;
    const r = R[k] * (1 + (edge ? 0 : hsh(k, j, 2) * 0.05));
    const y = Y[k] + (edge ? 0 : hsh(k, j, 3) * 0.05);
    return [Math.sin(a) * r, y, zc + Math.cos(a) * r * 1.04];
  };
  const domeN = (k: number, jj: number): V3 => {
    const j = ((jj % N) + N) % N;
    const k0 = Math.max(0, k - 1), k1 = Math.min(R.length - 1, k + 1);
    const dr = R[k1] - R[k0], dy = Y[k1] - Y[k0];
    const a = (j / N) * Math.PI * 2;
    return norm([Math.sin(a) * dy, -dr, Math.cos(a) * dy / 1.04]);
  };
  const shellS = rig.s('shell');
  // [k0, k1, sides per plate, offset] — spans alternate so borders stagger like cooled lava crust
  const bands: [number, number, number, number][] = [[0, 2, 2, 0], [2, 4, 3, 1], [4, 6, 2, 1], [6, 8, 3, 0]];
  let plateNo = 0;
  for (const [k0, k1, span, off] of bands) {
    for (let j0 = off; j0 < N + off; j0 += span) {
      const perim: V3[] = [];
      for (let j = j0; j < j0 + span; j++) perim.push(dome(k0, j));
      for (let k = k0; k < k1; k++) perim.push(dome(k, j0 + span));
      for (let j = j0 + span; j > j0; j--) perim.push(dome(k1, j));
      for (let k = k1; k > k0; k--) perim.push(dome(k, j0));
      let cx = 0, cy = 0, cz = 0;
      for (const q of perim) { cx += q[0]; cy += q[1]; cz += q[2]; }
      const cen: V3 = [cx / perim.length, cy / perim.length, cz / perim.length];
      const nrm = domeN((k0 + k1) / 2 | 0, j0 + span / 2);
      const tip = add(cen, mul(nrm, 0.03 + 0.012 * (span - 2)));
      const rnd = hsh(plateNo, 7, 9) + 0.5;
      plateNo++;
      const base = rnd < 0.3 ? mix(P, S2, 0.6) : shade(P, 0.92 + rnd * 0.3);
      for (let i = 0; i < perim.length; i++) {
        const a = perim[i], b = perim[(i + 1) % perim.length];
        const fc = mul(add(add(a, b), tip), 1 / 3);
        let fn = norm(cross(sub(b, a), sub(tip, a)));
        if (dot(fn, sub(fc, [0, 0.34, zc])) < 0) fn = mul(fn, -1);
        // glossy obsidian: the facets that face the sky catch a pale sheen
        const col = fn[1] > 0.72 ? mix(base, C('#6a5a86'), 0.22) : fn[1] > 0.45 ? shade(base, 1.1) : base;
        body.tri(a, b, tip, col, fn, shellS, shellS, shellS);
      }
    }
  }
  // rim underside (a thick lip) + inner skirt so the shell never looks hollow from below
  lathe(body, [[0.3, 0.36], [0.5, 0.315], [0.655, 0.33]], N, { o: [0, 0, zc], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1.04] }, mix(P, S2, 0.4), () => shellS, 0, 1, 1);
  // crater: jagged raised lip (body), glowing inner wall + lava pool (glow 1)
  const craterS = rig.s('crater');
  const CN = 12;
  for (let j = 0; j < CN; j++) {
    const a0 = (j / CN) * Math.PI * 2, a1 = ((j + 1) / CN) * Math.PI * 2;
    const lip = (a: number, jj: number, r: number, y: number, jag: number): V3 => [Math.sin(a) * r, y + (jj % 2 === 0 ? jag : 0), zc + Math.cos(a) * r * 1.04];
    const o0 = lip(a0, j, 0.27, 0.915, 0), o1 = lip(a1, j + 1, 0.27, 0.915, 0);
    const t0 = lip(a0, j, 0.24, 0.962, 0.022), t1 = lip(a1, j + 1, 0.24, 0.962, 0.022);
    const i0 = lip(a0, j, 0.2, 0.952, 0.012), i1 = lip(a1, j + 1, 0.2, 0.952, 0.012);
    const w0: V3 = [Math.sin(a0) * 0.17, 0.9, zc + Math.cos(a0) * 0.17 * 1.04], w1: V3 = [Math.sin(a1) * 0.17, 0.9, zc + Math.cos(a1) * 0.17 * 1.04];
    const am = (a0 + a1) / 2;
    const outN: V3 = norm([Math.sin(am), 0.9, Math.cos(am)]), upN: V3 = [0, 1, 0], inN: V3 = norm([-Math.sin(am), 0.6, -Math.cos(am)]);
    body.quad(o0, t0, t1, o1, shade(P, 1.1), outN, craterS, craterS, craterS, craterS);
    body.quad(t0, i0, i1, t1, mix(P, C('#6a5a86'), 0.2), upN, craterS, craterS, craterS, craterS);
    crater.quad(i0, w0, w1, i1, mix(A, G, 0.35), inN, craterS, craterS, craterS, craterS);
  }
  // lava pool: a slightly domed disc, hottest in the middle
  lathe(crater, [[0.175, 0.898], [0.11, 0.91], [0.0, 0.918]], CN, { o: [0, 0, zc], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1.04] },
    (f) => (f.t > 0.5 ? hot : mix(G, hot, 0.35)), () => craterS, 0.26);
  // magma seams along every plate border (latitude seams per band edge + staggered meridians)
  const seamPaint = (f: Face): THREE.Color => mix(A, G, 0.25 + 0.55 * Math.max(0, f.n[1]));
  const SW = 0.02, lift = 0.008;
  for (const [k0, k1, span, off] of bands) {
    for (let j0 = off; j0 < N + off; j0 += span) {
      const pts: V3[] = [], ns: V3[] = [];
      for (let k = k0; k <= k1; k++) { pts.push(dome(k, j0)); ns.push(domeN(k, j0)); }
      ribbon(seams, pts, ns, SW, lift, seamPaint, shellS);
    }
    if (k0 > 0) {
      const pts: V3[] = [], ns: V3[] = [];
      for (let j = 0; j <= N; j++) { pts.push(dome(k0, j)); ns.push(domeN(k0, j)); }
      ribbon(seams, pts, ns, SW, lift, seamPaint, shellS);
    }
  }
  // lava tongues spilling over the crater lip, glow 1 (flare with the crater)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.55;
    const pts: V3[] = [], ns: V3[] = [];
    for (let s = 0; s <= 3; s++) {
      const rr = 0.25 + s * 0.035, yy = 0.955 - s * 0.03;
      pts.push([Math.sin(a) * rr, yy, zc + Math.cos(a) * rr * 1.04]);
      ns.push(norm([Math.sin(a) * 0.5, 0.85, Math.cos(a) * 0.5]));
    }
    ribbon(crater, pts, ns, 0.036 - 0.004 * i, 0.012, (f) => mix(G, A, f.t), craterS);
  }
  // basalt knuckles along the rim
  for (let i = 0; i < 6; i++) {
    const j = i * 2 + 1;
    const p = dome(1, j);
    const n = domeN(1, j);
    cone(body, add(p, mul(n, -0.01)), add(p, mul(norm(add(n, [0, 0.5, 0])), 0.075)), 0.04, 5, shade(S2, 0.9), shellS);
  }

  // small stubborn head poking out under the rim
  const hz = [0.44, 0.53, 0.63, 0.72, 0.77];
  const hy = [0.27, 0.278, 0.274, 0.26, 0.25];
  const hrx = [0.11, 0.135, 0.13, 0.1, 0.064];
  const hry = [0.08, 0.09, 0.08, 0.064, 0.046];
  const skull = (a: number): [number, number] => { const c = Math.cos(a), s = Math.sin(a); return [Math.sign(c) * Math.pow(Math.abs(c), 0.7), s < 0 ? s * 0.5 : s * 0.85]; };
  sweep(body, tubeRings(hz.map((z, i) => [0, hy[i], z] as V3), hrx.map((r, i) => [r, hry[i]] as [number, number]), 8,
    (p) => (p[2] < 0.47 ? rig.mix('neck', 'head', 0.6) : rig.s('head'))),
    { sides: 12, cap0: -1, cap1: 0.022, paint: (f) => (f.n[1] < -0.55 ? mouth : f.n[1] < 0 ? mix(S2, B, 0.45) : f.c[2] > 0.7 ? mix(P, S2, 0.5) : S2), shape: skull, phase: Math.PI / 12 });
  // neck: thick and short
  sweep(body, tubeRings([[0, 0.28, 0.3], [0, 0.275, 0.42], [0, 0.272, 0.5]], [[0.16, 0.13], [0.12, 0.1], [0.1, 0.08]], 5,
    (p) => (p[2] < 0.36 ? rig.mix('chest', 'neck', 0.4) : rig.mix('neck', 'head', 0.3))),
    { sides: 10, cap0: -1, cap1: -1, paint: hide, phase: Math.PI / 10 });
  // underbite jaw with two stubborn tusks
  sweep(body, tubeRings([[0, 0.215, 0.52], [0, 0.21, 0.63], [0, 0.216, 0.73], [0, 0.226, 0.78]], [[0.095, 0.038], [0.112, 0.042], [0.095, 0.036], [0.056, 0.025]], 6, () => rig.s('jaw')),
    { sides: 10, cap0: 0, cap1: 0.012, paint: (f) => (f.n[1] > 0.55 ? mouth : f.n[1] < -0.3 ? B : mix(S2, B, 0.35)), phase: Math.PI / 10 });
  teeth(body, [[0.062, 0.238, 0.745], [-0.062, 0.238, 0.745]], [0, 1, 0.15], 0.058, 0.019, tusk, rig.s('jaw'));
  // heavy brow shelf (obsidian, like a little piece of the shell)
  sweep(body, tubeRings([[0.13, 0.318, 0.62], [0.075, 0.346, 0.69], [0, 0.35, 0.705], [-0.075, 0.346, 0.69], [-0.13, 0.318, 0.62]], [[0.02, 0.018], [0.03, 0.022], [0.032, 0.024], [0.03, 0.022], [0.02, 0.018]], 9, () => rig.s('head')),
    { sides: 6, cap0: 0.01, cap1: 0.01, paint: P, up: [0, 1, 0] });
  // nostril ember vents
  for (const sd of [1, -1]) blob(seams, [0.034 * sd, 0.29, 0.775], [0, 0.3, 1], 0.01, 0.014, 5, 3, A, rig.s('head'));
  const eyeStyle: EyeStyle = { sclera: '#ffd27a', iris: '#ff9a3c', pupil: '#2a1208', iris01: 0.8, pupil01: 0.44, squash: 0.85 };
  buildEye(eyes, rig, 'eyeL', rig.rest.eyeL, [0.55, 0.22, 0.8], 0.044, eyeStyle);
  buildEye(eyes, rig, 'eyeR', rig.rest.eyeR, [-0.55, 0.22, 0.8], 0.044, eyeStyle);

  // stubby tail
  sweep(body, tubeRings([[0, 0.27, -0.44], [0, 0.24, -0.52], [0, 0.19, -0.62], [0, 0.15, -0.68]], [[0.09, 0.08], [0.075, 0.065], [0.05, 0.045], [0.03, 0.028]], 6,
    (p) => rig.chain(['hips', 'tail1', 'tail2'], [-0.4, -0.5, -0.64], p[2])),
    { sides: 8, cap0: -1, cap1: 0.04, paint: hide, phase: Math.PI / 8 });

  // short elephantine legs (wrinkle rings), toenailed column feet
  const limb = (f: Face): THREE.Color => (Math.floor(f.t * 7) % 2 === 1 ? shade(S2, 0.85) : S2);
  const foot = pillarFoot(mix(S2, P, 0.3), nail, 0.85);
  const legs: LegDef[] = [];
  const fore = { hip: [0.27, 0.36, 0.25] as V3, knee: [0.36, 0.2, 0.3] as V3, ankle: [0.33, 0.085, 0.28] as V3, root: [0.12, 0.34, 0.25] as V3 };
  const hind = { hip: [0.27, 0.36, -0.32] as V3, knee: [0.36, 0.21, -0.37] as V3, ankle: [0.33, 0.085, -0.34] as V3, root: [0.12, 0.34, -0.32] as V3 };
  for (const nm of ['legFL', 'legFR'] as const) legs.push(buildLeg(body, rig, { name: nm, parent: 'chest', ...fore, r: [0.13, 0.125, 0.115, 0.11, 0.105], paint: limb, sides: 9, foot }));
  for (const nm of ['legBL', 'legBR'] as const) legs.push(buildLeg(body, rig, { name: nm, parent: 'hips', ...hind, r: [0.14, 0.13, 0.12, 0.11, 0.105], paint: limb, sides: 9, foot }));

  return { id: 'hearthback', rig, body, eyes, glow: [seams, crater], glowInk: [0, 0], legs, tail };
}

// ─────────────────────────────── BRIARWICK — horned garden-beast, seed ruff ───────────────────────────────
function buildBriarwick(): Parts {
  const K = TITAN_COLORS.briarwick;
  const P = C(K.primary), S2 = C(K.secondary), B = C(K.belly), A = C(K.accent), G = C(K.glow), HORN = C(K.extra ?? '#e8dcc0');
  const mossL = C('#7fae4a'), leafC = C('#9ccf5a'), pod = C('#b4c25e'), podDark = C('#7d8a3a'), nose = C('#3a2618'), claw = C('#efe4c8');
  const bloomC = C('#ffd166');
  const rig = new Rig();
  const body = new Geo(), eyes = new Geo(), spores = new Geo();

  rig.add('base', null, [0, 0, 0]);
  rig.add('body', 'base', [0, 0.47, -0.06]);
  rig.add('chest', 'body', [0, 0.49, 0.24]);
  rig.add('hips', 'body', [0, 0.47, -0.36]);
  rig.add('ruff', 'chest', [0, 0.55, 0.42]);
  rig.add('neck', 'chest', [0, 0.53, 0.44]);
  rig.add('head', 'neck', [0, 0.57, 0.57]);
  rig.add('jaw', 'head', [0, 0.5, 0.62]);
  rig.add('eyeL', 'head', [0.085, 0.615, 0.7]);
  rig.add('eyeR', 'head', [-0.085, 0.615, 0.7]);
  const tail = ['tail1', 'tail2'];
  rig.add('tail1', 'hips', [0, 0.5, -0.64]);
  rig.add('tail2', 'tail1', [0, 0.49, -0.74]);

  const spineSkin = (p: V3) => rig.chain(['tail1', 'hips', 'body', 'chest', 'neck'], [-0.64, -0.36, -0.06, 0.24, 0.44], p[2]);
  // moss on top (patchy lighter moss), bark striations on the flanks, pale lichen belly
  const hide = (f: Face): THREE.Color => {
    if (f.n[1] < -0.5) return B;
    if (f.n[1] < -0.12) {
      const stripe = Math.floor((f.c[2] + 3) / 0.05 + Math.sin(f.c[1] * 40) * 0.8) % 2 === 0;
      return stripe ? shade(S2, 1.1) : S2;
    }
    if (f.n[1] < 0.1) return mix(S2, P, 0.62);
    const hh = Math.sin(f.c[0] * 127.1 + f.c[1] * 74.7 + f.c[2] * 311.7) * 43758.5453;
    const r = hh - Math.floor(hh);
    return r < 0.2 ? mix(P, mossL, 0.6) : r > 0.88 ? shade(P, 0.9) : P;
  };
  // stocky barrel with a shoulder hump
  const tz = [-0.66, -0.54, -0.3, 0.0, 0.22, 0.38, 0.48];
  const ty = [0.47, 0.475, 0.48, 0.49, 0.505, 0.51, 0.52];
  const trx = [0.14, 0.24, 0.285, 0.285, 0.27, 0.23, 0.16];
  const tryy = [0.12, 0.2, 0.24, 0.245, 0.26, 0.22, 0.14];
  sweep(body, tubeRings(tz.map((z, i) => [0, ty[i], z] as V3), trx.map((r, i) => [r, tryy[i]] as [number, number]), 18, (p) => spineSkin(p)),
    { sides: 16, cap0: 0.04, cap1: -1, paint: hide, phase: Math.PI / 16 });
  const backAt = (z: number, a: number): { p: V3; n: V3 } => {
    const rx = interpZ(tz, trx, z), ry = interpZ(tz, tryy, z), y = interpZ(tz, ty, z);
    return { p: [Math.cos(a) * rx, y + Math.sin(a) * ry, z], n: norm([Math.cos(a) / rx, Math.sin(a) / ry, 0]) };
  };

  // bear/ram head: broad brow, blunt pale muzzle, dark nose
  const hz = [0.44, 0.52, 0.62, 0.72, 0.8];
  const hy = [0.57, 0.585, 0.575, 0.545, 0.525];
  const hrx = [0.12, 0.14, 0.125, 0.09, 0.065];
  const hry = [0.115, 0.125, 0.105, 0.078, 0.058];
  sweep(body, tubeRings(hz.map((z, i) => [0, hy[i], z] as V3), hrx.map((r, i) => [r, hry[i]] as [number, number]), 8,
    (p) => (p[2] < 0.48 ? rig.mix('neck', 'head', 0.6) : rig.s('head'))),
    { sides: 12, cap0: -1, cap1: 0.02, paint: (f) => (f.c[2] > 0.68 && f.n[1] < 0.75 ? B : f.n[1] < -0.4 ? mix(B, S2, 0.3) : f.n[1] > 0.45 ? P : mix(P, S2, 0.35)), phase: Math.PI / 12 });
  blob(body, [0, 0.555, 0.8], [0, 0.35, 1], 0.03, 0.04, 7, 3, nose, rig.s('head'));
  sweep(body, tubeRings([[0, 0.5, 0.55], [0, 0.49, 0.65], [0, 0.492, 0.74]], [[0.085, 0.04], [0.075, 0.035], [0.05, 0.025]], 5, () => rig.s('jaw')),
    { sides: 10, cap0: 0, cap1: 0.01, paint: (f) => (f.n[1] > 0.5 ? C('#5b2d2a') : B), phase: Math.PI / 10 });
  // cheek fluff (moss tufts) + little leaf ears
  for (const sd of [1, -1]) {
    blob(body, [0.11 * sd, 0.54, 0.56], [0.4 * sd, 0.2, 1], 0.06, 0.05, 7, 4, mossL, rig.s('head'));
    const fr = slabFrame([0.12 * sd, 0.66, 0.53], [sd, 0, 0.4], [0.8 * sd, 0.7, -0.3]);
    slab(body, [[-0.035, 0], [0.035, 0], [0.03, 0.07], [0, 0.11], [-0.03, 0.07]], 0.016, 0.006, fr, (f) => (f.l[1] > 0.06 ? leafC : P), () => rig.s('head'));
  }
  const eyeStyle: EyeStyle = { sclera: '#fffbe8', iris: '#5a3a1e', pupil: '#1b1426', iris01: 0.86, pupil01: 0.5 };
  buildEye(eyes, rig, 'eyeL', rig.rest.eyeL, [0.55, 0.3, 0.78], 0.043, eyeStyle);
  buildEye(eyes, rig, 'eyeR', rig.rest.eyeR, [-0.55, 0.3, 0.78], 0.043, eyeStyle);
  // brow ridges
  for (const sd of [1, -1]) {
    sweep(body, tubeRings([[0.035 * sd, 0.665, 0.715], [0.09 * sd, 0.675, 0.69], [0.135 * sd, 0.652, 0.64]], [[0.02, 0.018], [0.025, 0.02], [0.018, 0.016]], 5, () => rig.s('head')),
      { sides: 6, cap0: 0.01, cap1: 0.01, paint: S2, up: [0, 1, 0] });
  }

  // big curling ram horns (ridged bands, darker tips)
  for (const sd of [1, -1]) {
    const m = (p: V3): V3 => [p[0] * sd, p[1], p[2]];
    const ctrl: V3[] = [[0.075, 0.66, 0.57], [0.13, 0.78, 0.53], [0.21, 0.86, 0.42], [0.3, 0.8, 0.33], [0.34, 0.66, 0.38], [0.31, 0.56, 0.48], [0.26, 0.54, 0.56], [0.24, 0.6, 0.62]].map((q) => m(q as V3));
    const radii: [number, number][] = [[0.055, 0.055], [0.058, 0.058], [0.054, 0.054], [0.048, 0.048], [0.04, 0.04], [0.031, 0.031], [0.022, 0.022], [0.012, 0.012]];
    sweep(body, tubeRings(ctrl, radii, 26, () => rig.s('head')),
      { sides: 7, cap0: -1, cap1: 0.018, paint: (f) => (f.t > 0.88 ? mix(HORN, S2, 0.45) : Math.floor(f.t * 22) % 2 === 0 ? HORN : shade(HORN, 0.86)), up: [0, 0, 1] });
  }

  // seed ruff: a collar of pods around the neck, spore-lit tips (glow)
  const ruffS = rig.s('ruff');
  const rc: V3 = [0, 0.55, 0.42];
  const ax = norm([0, 0.25, 1]);
  const ux: V3 = [1, 0, 0], uy = norm(cross(ax, ux));
  const NP = 13;
  for (let i = 0; i < NP; i++) {
    const th = -0.55 + (i / (NP - 1)) * (Math.PI + 1.1);   // from lower-right, over the top, to lower-left
    const rd = norm(add(mul(ux, Math.cos(th)), mul(uy, Math.sin(th))));
    const b = add(rc, mul(rd, 0.215));
    const dir = norm(add(mul(rd, 1), mul(ax, -0.55)));
    const L = 0.13 + 0.025 * Math.sin(i * 2.3);
    const tipP = add(b, mul(dir, L));
    // poppy-like seed head: dark calyx cup, plump ribbed pod, spore-lit crown (glow)
    lathe(body, [[0, -0.01], [0.03, 0.005], [0.05, 0.03], [0.062, 0.06], [0.058, L * 0.72], [0.04, L * 0.9], [0, L]], 7, frameAxis(b, dir, ax),
      (f) => (f.t < 0.2 ? podDark : Math.floor(f.a / (Math.PI / 3.5)) % 2 === 0 ? pod : shade(pod, 0.88)), () => ruffS, i * 0.4);
    blob(spores, tipP, dir, 0.028, 0.028, 6, 3, (f) => (f.n[1] > 0.3 ? mix(G, C('#ffffff'), 0.4) : G), ruffS);
  }

  // blossoms + leaves + moss tufts scattered over the back
  const flower = (at: { p: V3; n: V3 }, size: number, bone: Skin, spin: number) => {
    const n = at.n;
    const t1 = norm(cross(n, Math.abs(n[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]));
    const t2 = norm(cross(n, t1));
    for (let k = 0; k < 5; k++) {
      const a = spin + (k / 5) * Math.PI * 2;
      const rdir = norm(add(mul(t1, Math.cos(a)), mul(t2, Math.sin(a))));
      const cup = norm(add(rdir, mul(n, 0.45)));
      const fr = slabFrame(add(add(at.p, mul(n, 0.012)), mul(rdir, size * 0.1)), cross(n, rdir), cup);
      slab(body, [[-0.3 * size, 0], [0.3 * size, 0], [0.42 * size, 0.55 * size], [0, 0.95 * size], [-0.42 * size, 0.55 * size]], 0.012, 0.004, fr,
        (f) => (f.l[1] > 0.55 * size ? mix(A, C('#ffffff'), 0.18) : f.l[1] < 0.2 * size ? mix(A, C('#e0508f'), 0.35) : A), () => bone);
    }
    blob(body, add(at.p, mul(n, 0.02)), n, 0.018, 0.026, 6, 3, bloomC, bone);
  };
  const leaf = (at: { p: V3; n: V3 }, size: number, bone: Skin, yaw: number) => {
    const n = at.n;
    const t1 = norm(cross(n, [0, 1, 0.001]));
    const t2 = norm(cross(n, t1));
    const d = norm(add(mul(t1, Math.cos(yaw)), mul(t2, Math.sin(yaw))));
    const fr = slabFrame(add(at.p, mul(n, 0.008)), cross(n, d), norm(add(d, mul(n, 0.5))));
    slab(body, [[-0.2 * size, 0], [0.2 * size, 0], [0.32 * size, 0.45 * size], [0, size], [-0.32 * size, 0.45 * size]], 0.012, 0.004, fr,
      (f) => (Math.abs(f.l[0]) < 0.05 * size ? shade(leafC, 0.8) : leafC), () => bone);
  };
  const deco: [number, number, 'f' | 'l' | 'm', number][] = [
    [0.3, 1.25, 'f', 0.1], [0.1, 1.72, 'f', 0.11], [-0.12, 1.3, 'f', 0.095], [-0.34, 1.9, 'f', 0.1], [-0.5, 1.4, 'f', 0.085], [0.14, 0.95, 'f', 0.085],
    [0.34, 1.85, 'f', 0.09], [-0.2, 1.05, 'f', 0.08], [-0.02, 2.2, 'f', 0.08],
    [0.2, 1.6, 'l', 0.1], [0.0, 1.2, 'l', 0.12], [-0.2, 1.85, 'l', 0.1], [-0.42, 1.2, 'l', 0.1], [0.3, 2.0, 'l', 0.09], [-0.05, 2.1, 'l', 0.11],
    [0.22, 1.9, 'm', 0.05], [-0.28, 1.55, 'm', 0.055], [0.05, 1.45, 'm', 0.045], [-0.55, 1.75, 'm', 0.045],
  ];
  for (let i = 0; i < deco.length; i++) {
    const [z, a, kind, sz] = deco[i];
    const at = backAt(z, a);
    const bone = spineSkin(at.p);
    if (kind === 'f') flower(at, sz, bone, i * 0.7);
    else if (kind === 'l') leaf(at, sz, bone, i * 1.9);
    else blob(body, add(at.p, mul(at.n, 0.01)), at.n, sz * 0.55, sz, 6, 3, mossL, bone);
  }
  // a few floating spore specks over the back (glow)
  for (const [z, a] of [[0.05, 1.4], [-0.25, 1.75], [-0.45, 1.5]] as [number, number][]) {
    const at = backAt(z, a);
    blob(spores, add(at.p, mul(at.n, 0.03)), at.n, 0.012, 0.012, 5, 3, G, spineSkin(at.p));
  }

  // stubby tail with a leaf tuft
  sweep(body, tubeRings([[0, 0.5, -0.58], [0, 0.505, -0.66], [0, 0.49, -0.74], [0, 0.46, -0.79]], [[0.075, 0.07], [0.065, 0.06], [0.045, 0.04], [0.02, 0.02]], 6,
    (p) => rig.chain(['hips', 'tail1', 'tail2'], [-0.5, -0.64, -0.74], p[2])),
    { sides: 8, cap0: -1, cap1: 0.02, paint: hide, phase: Math.PI / 8 });
  for (let k = 0; k < 3; k++) leaf({ p: [0, 0.47, -0.78], n: norm([Math.sin(k * 2.1) * 0.6, 0.6, -0.6]) }, 0.09, rig.s('tail2'), k * 2.1);

  // thick bark legs with moss cuffs and paws
  const limb = (f: Face): THREE.Color => (f.t < 0.22 ? mix(P, S2, 0.3) : f.t < 0.3 ? mossL : Math.floor(f.a * 3) % 2 === 0 ? shade(S2, 1.08) : shade(S2, 0.74));
  const paw = pawFoot(shade(S2, 0.78), claw, 1.05, 3);
  const legs: LegDef[] = [];
  const fore = { hip: [0.17, 0.47, 0.28] as V3, knee: [0.2, 0.285, 0.2] as V3, ankle: [0.2, 0.075, 0.31] as V3, root: [0.06, 0.48, 0.28] as V3 };
  const hind = { hip: [0.17, 0.46, -0.38] as V3, knee: [0.2, 0.29, -0.27] as V3, ankle: [0.2, 0.075, -0.4] as V3, root: [0.06, 0.47, -0.38] as V3 };
  for (const nm of ['legFL', 'legFR'] as const) legs.push(buildLeg(body, rig, { name: nm, parent: 'chest', ...fore, r: [0.12, 0.11, 0.09, 0.085, 0.08], paint: limb, sides: 8, foot: paw }));
  for (const nm of ['legBL', 'legBR'] as const) legs.push(buildLeg(body, rig, { name: nm, parent: 'hips', ...hind, r: [0.13, 0.12, 0.095, 0.085, 0.08], paint: limb, sides: 8, foot: paw }));

  return { id: 'briarwick', rig, body, eyes, glow: [spores], glowInk: [0], legs, tail };
}

// ─────────────────────────────── public entry ───────────────────────────────
const BUILDERS: Record<TitanId, () => Parts> = { molo: buildMolo, voltkite: buildVoltkite, hearthback: buildHearthback, briarwick: buildBriarwick };

/** Build a fresh, independent titan model (own geometry, materials and skeleton). */
export function buildTitanModel(id: TitanId, opts: BuildOpts = {}): TitanModel {
  const parts = BUILDERS[id]();
  return finalize(parts, opts);
}
