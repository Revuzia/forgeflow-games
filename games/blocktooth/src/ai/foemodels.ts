// BLOCKTOOTH — foe models (foes-view lane, CONTRACT §6, §6.1, §9, §1).
//
// Faceted, vertex-coloured, multi-part low-poly models for the eight HALVARD CIVIL DEFENSE
// enemy kinds, plus the geometry toolkit + material patch the boss view reuses.
//
//   * Models face +Z, Y up, metres at true size (CONTRACT §9 heights / radii).
//   * Facets BY CONSTRUCTION: non-indexed triangles, every triangle's winding is checked
//     against an outward reference (doctrine §3 "fix winding by construction"), then
//     `computeVertexNormals()` gives per-face normals; `bakeOutlineNormals` adds the smooth
//     hull normals for the ink outline.
//   * Every geometry carries `position`, `normal`, `color` (linear), `glow` (0..1 emissive mask)
//     and `outlineNormal`.
//   * Each model is a list of animatable PARTS. A part may have several pivots (4 rotors,
//     6 wheels, 3 stilts) — the enemy view draws one InstancedMesh per part with
//     `enemies × pivots` instances, so a whole kind costs parts×2 draw calls.
//
// Toy municipal-military palette: off-white + safety orange + navy (reads on teal asphalt,
// on snow and on night water — orange carries the silhouette where off-white would vanish).

import * as THREE from 'three';
import type { EnemyKind } from '../core/types.ts';
import { bakeOutlineNormals, makeToon } from '../render/materials.ts';

// ─────────────────────────────── palette ───────────────────────────────
export const FOE_PAL = {
  off: '#efe9dc', offS: '#d6cdb9', org: '#ff7a1c', orgD: '#d9560f',
  navy: '#26375c', navyD: '#18223d', navyL: '#3d5484',
  steel: '#98a1ad', steelD: '#5c6470', tire: '#27262d', rubber: '#34323b',
  visor: '#142033', lamp: '#8ff6ff', amber: '#ffc63d', red: '#ff4a3a', glass: '#2b4863',
} as const;

// ─────────────────────────────── colour + hash helpers ───────────────────────────────
type RGB = [number, number, number];
const colCache = new Map<string, RGB>();
/** sRGB hex → linear working-space triple (vertex colours are not colour-managed). */
export function linColor(hex: string): RGB {
  let c = colCache.get(hex);
  if (!c) { const t = new THREE.Color(hex); c = [t.r, t.g, t.b]; colCache.set(hex, c); }
  return c;
}
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

// ─────────────────────────────── ring helpers ───────────────────────────────
/** Chamfered rectangle (x,z pairs, consistent loop order). ch = corner cut (m). */
export function rect(w: number, d: number, ch = 0, ox = 0, oz = 0): number[] {
  const hw = w / 2, hd = d / 2;
  if (ch <= 0) return [ox - hw, oz - hd, ox + hw, oz - hd, ox + hw, oz + hd, ox - hw, oz + hd];
  const c = Math.min(ch, hw * 0.95, hd * 0.95);
  return [
    ox - hw + c, oz - hd, ox + hw - c, oz - hd, ox + hw, oz - hd + c, ox + hw, oz + hd - c,
    ox + hw - c, oz + hd, ox - hw + c, oz + hd, ox - hw, oz + hd - c, ox - hw, oz - hd + c,
  ];
}
/** Regular n-gon with independent X/Z radii (x,z pairs). */
export function ngon(n: number, rx: number, rz = rx, rot = 0, ox = 0, oz = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push(ox + Math.sin(a) * rx, oz + Math.cos(a) * rz);
  }
  return out;
}

/** Transform helper (build time only): translate · R(YXZ euler) · scale. */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

export interface Ring { y: number; pts: number[] }
export interface LoftOpts {
  /** band colours (band i spans ring i → i+1); a shorter list repeats its last entry */
  side?: string | readonly string[];
  /** cap on the last ring (undefined → last band colour, null → open) */
  top?: string | null;
  /** cap on the first ring (undefined → first band colour, null → open) */
  bottom?: string | null;
  /** emissive mask 0..1 for the whole primitive */
  glow?: number;
  /** per-face colour override (band, segment) */
  face?: (band: number, seg: number) => string | undefined;
}
export interface BoxOpts {
  ch?: number;            // chamfer (m) of the XZ outline
  tw?: number; td?: number; // top width/depth scale (taper)
  sx?: number; sz?: number; // top ring shift (shear)
  top?: string | null; bottom?: string | null; side?: string | readonly string[];
  glow?: number;
}
export interface BeamOpts {
  seg?: number;           // 4 = square (default), 6/8 = rounder
  ch?: number;
  taper?: number;         // end size scale
  cap?: boolean;          // close the ends (default true)
  glow?: number;
  side?: string | readonly string[];
}

// scratch for the builder (build-time only, but no need to churn)
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3();
const _E1 = new THREE.Vector3(), _E2 = new THREE.Vector3(), _N = new THREE.Vector3(), _R = new THREE.Vector3();

/**
 * Faceted geometry builder. Primitives are convex (or star-shaped per band), so every
 * triangle's winding is decided against an interior reference point BY CONSTRUCTION.
 */
export class Facet {
  private P: number[] = [];
  private C: number[] = [];
  private G: number[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  /** per-face value jitter — the "painted" look (±) */
  jitter = 0.035;

  push(m: THREE.Matrix4): this {
    const top = this.stack[this.stack.length - 1];
    this.stack.push(new THREE.Matrix4().multiplyMatrices(top, m));
    return this;
  }
  pop(): this { if (this.stack.length > 1) this.stack.pop(); return this; }
  group(m: THREE.Matrix4, fn: () => void): this { this.push(m); fn(); return this.pop(); }
  /** Runs fn twice: as authored (+1) and mirrored across X (−1). Winding is fixed automatically. */
  mirrorX(fn: (side: number) => void): this {
    fn(1);
    this.push(new THREE.Matrix4().makeScale(-1, 1, 1));
    fn(-1);
    return this.pop();
  }
  get triCount(): number { return this.P.length / 9; }

  private mat(m?: THREE.Matrix4): THREE.Matrix4 {
    const top = this.stack[this.stack.length - 1];
    return m ? new THREE.Matrix4().multiplyMatrices(top, m) : top;
  }

  /** One triangle in primitive-local space, wound so its normal agrees with `ref`. */
  private tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ref: THREE.Vector3,
    rgb: RGB, glow: number, Mx: THREE.Matrix4, flip: boolean): void {
    _E1.subVectors(b, a); _E2.subVectors(c, a); _N.crossVectors(_E1, _E2);
    if (_N.lengthSq() < 1e-12) return;                       // degenerate (apex / collapsed slat)
    let swap = _N.dot(ref) < 0;
    if (flip) swap = !swap;
    _A.copy(a).applyMatrix4(Mx);
    if (swap) { _B.copy(c).applyMatrix4(Mx); _C.copy(b).applyMatrix4(Mx); }
    else { _B.copy(b).applyMatrix4(Mx); _C.copy(c).applyMatrix4(Mx); }
    const k = 1 + this.jitter * (hash3((_A.x + _B.x + _C.x) * 3.1, (_A.y + _B.y + _C.y) * 2.7, (_A.z + _B.z + _C.z) * 3.3) - 0.5) * 2;
    this.P.push(_A.x, _A.y, _A.z, _B.x, _B.y, _B.z, _C.x, _C.y, _C.z);
    const r = rgb[0] * k, g = rgb[1] * k, bl = rgb[2] * k;
    this.C.push(r, g, bl, r, g, bl, r, g, bl);
    this.G.push(glow, glow, glow);
  }

  /** Loft through rings (same point count), with band colours and optional caps. */
  loft(rings: readonly Ring[], o: LoftOpts = {}, m?: THREE.Matrix4): this {
    const Mx = this.mat(m);
    const flip = Mx.determinant() < 0;
    const n = rings[0].pts.length / 2;
    const glow = o.glow ?? 0;
    const sides = o.side === undefined ? ['#ff00ff'] : (typeof o.side === 'string' ? [o.side] : o.side);
    const bandCol = (i: number) => sides[Math.min(i, sides.length - 1)];
    const cen = rings.map((r) => {
      let x = 0, z = 0;
      for (let j = 0; j < n; j++) { x += r.pts[j * 2]; z += r.pts[j * 2 + 1]; }
      return new THREE.Vector3(x / n, r.y, z / n);
    });
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3();
    const axis = new THREE.Vector3(), ref = new THREE.Vector3();
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i], r1 = rings[i + 1];
      axis.addVectors(cen[i], cen[i + 1]).multiplyScalar(0.5);
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        pa.set(r0.pts[j * 2], r0.y, r0.pts[j * 2 + 1]);
        pb.set(r1.pts[j * 2], r1.y, r1.pts[j * 2 + 1]);
        pc.set(r1.pts[j1 * 2], r1.y, r1.pts[j1 * 2 + 1]);
        pd.set(r0.pts[j1 * 2], r0.y, r0.pts[j1 * 2 + 1]);
        const rgb = linColor(o.face?.(i, j) ?? bandCol(i));
        ref.set((pa.x + pb.x + pc.x) / 3, (pa.y + pb.y + pc.y) / 3, (pa.z + pb.z + pc.z) / 3).sub(axis);
        this.tri(pa, pb, pc, ref, rgb, glow, Mx, flip);
        ref.set((pa.x + pc.x + pd.x) / 3, (pa.y + pc.y + pd.y) / 3, (pa.z + pc.z + pd.z) / 3).sub(axis);
        this.tri(pa, pc, pd, ref, rgb, glow, Mx, flip);
      }
    }
    const cap = (ri: number, nbr: number, col: string | null | undefined) => {
      if (col === null) return;
      const r = rings[ri];
      const rgb = linColor(col ?? bandCol(ri === 0 ? 0 : rings.length - 2));
      const c = cen[ri];
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        pa.set(r.pts[j * 2], r.y, r.pts[j * 2 + 1]);
        pb.set(r.pts[j1 * 2], r.y, r.pts[j1 * 2 + 1]);
        ref.set((c.x + pa.x + pb.x) / 3, (c.y + pa.y + pb.y) / 3, (c.z + pa.z + pb.z) / 3).sub(cen[nbr]);
        if (ref.lengthSq() < 1e-12) ref.subVectors(c, cen[nbr]);
        this.tri(c, pa, pb, ref, rgb, glow, Mx, flip);
      }
    };
    cap(0, 1, o.bottom);
    cap(rings.length - 1, rings.length - 2, o.top);
    return this;
  }

  /** Box centred on the origin (y ∈ [−h/2, h/2]) with optional chamfer/taper/shear. */
  box(w: number, h: number, d: number, col: string, m?: THREE.Matrix4, o: BoxOpts = {}): this {
    const ch = o.ch ?? 0, tw = o.tw ?? 1, td = o.td ?? 1;
    return this.loft([
      { y: -h / 2, pts: rect(w, d, ch) },
      { y: h / 2, pts: rect(w * tw, d * td, ch * Math.min(tw, td), o.sx ?? 0, o.sz ?? 0) },
    ], { side: o.side ?? col, top: o.top === undefined ? col : o.top, bottom: o.bottom === undefined ? col : o.bottom, glow: o.glow }, m);
  }

  /** Cylinder / frustum along Y centred on the origin. */
  cyl(r0: number, r1: number, h: number, seg: number, col: string, m?: THREE.Matrix4,
    o: { top?: string | null; bottom?: string | null; glow?: number; rot?: number } = {}): this {
    const rot = o.rot ?? Math.PI / seg;
    return this.loft([
      { y: -h / 2, pts: ngon(seg, r0, r0, rot) },
      { y: h / 2, pts: ngon(seg, r1, r1, rot) },
    ], { side: col, top: o.top === undefined ? col : o.top, bottom: o.bottom === undefined ? col : o.bottom, glow: o.glow }, m);
  }

  /** Straight member from A to B with a w×d cross-section (w ≈ lateral, d ≈ the other axis). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    w: number, d: number, col: string, o: BeamOpts = {}): this {
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
    const L = dir.length();
    if (L < 1e-6) return this;
    dir.divideScalar(L);
    const refUp = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const xA = new THREE.Vector3().crossVectors(refUp, dir).normalize();
    const zA = new THREE.Vector3().crossVectors(xA, dir).normalize();
    const basis = new THREE.Matrix4().makeBasis(xA, dir, zA).setPosition(ax, ay, az);
    const seg = o.seg ?? 4, t = o.taper ?? 1;
    const ring = (s: number) => seg === 4 ? rect(w * s, d * s, (o.ch ?? 0) * s) : ngon(seg, w / 2 * s, d / 2 * s, Math.PI / seg);
    const cap = o.cap === false ? null : undefined;
    return this.loft([{ y: 0, pts: ring(1) }, { y: L, pts: ring(t) }],
      { side: o.side ?? col, top: cap, bottom: cap, glow: o.glow }, basis);
  }

  /** Extrude a convex YZ profile (y,z pairs) along X from x0 to x1 (tracks, blades, ramps). */
  prismX(profile: readonly number[], x0: number, x1: number, col: string, m?: THREE.Matrix4,
    o: { top?: string | null; bottom?: string | null; glow?: number; face?: (band: number, seg: number) => string | undefined } = {}): this {
    // loft along local Y (= world X after Rz(−π/2)); ring pts (x, z) = (−profileY, profileZ)
    const pts: number[] = [];
    for (let i = 0; i < profile.length; i += 2) pts.push(-profile[i], profile[i + 1]);
    const rot = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
    const mm = m ? new THREE.Matrix4().multiplyMatrices(m, rot) : rot;
    return this.loft([{ y: x0, pts }, { y: x1, pts }],
      { side: col, top: o.top === undefined ? col : o.top, bottom: o.bottom === undefined ? col : o.bottom, glow: o.glow, face: o.face }, mm);
  }

  /**
   * Diagonal hazard stripes: a band in the local XY plane (x0..x1, y0..y1), thickness t toward
   * +Z, made of sheared slats (true parallelogram prisms, trimmed at the band ends — no z-fight
   * because the band sits proud of the surface it decorates).
   */
  hazard(x0: number, x1: number, y0: number, y1: number, t: number, n: number, colA: string, colB: string, m?: THREE.Matrix4): this {
    const sw = (x1 - x0) / n;
    const s = (y1 - y0) * 0.7;
    const i0 = -Math.ceil(s / sw) - 1;
    for (let i = i0; i <= n; i++) {
      const bl = x0 + i * sw, br = bl + sw, tl = bl + s, tr = br + s;
      const cbl = Math.min(Math.max(bl, x0), x1), cbr = Math.min(Math.max(br, x0), x1);
      const ctl = Math.min(Math.max(tl, x0), x1), ctr = Math.min(Math.max(tr, x0), x1);
      if (cbr - cbl < 1e-4 && ctr - ctl < 1e-4) continue;
      this.loft([
        { y: y0, pts: [cbl, 0, cbr, 0, cbr, t, cbl, t] },
        { y: y1, pts: [ctl, 0, ctr, 0, ctr, t, ctl, t] },
      ], { side: (i & 1) === 0 ? colA : colB }, m);
    }
    return this;
  }

  /** Recolour faces added since `from` whose normal faces up (frost caking / snow). */
  frost(from: number, col: string, minNy: number, chance: number, seed = 0): this {
    const rgb = linColor(col);
    for (let t = from; t < this.P.length / 9; t++) {
      const o = t * 9;
      _A.set(this.P[o], this.P[o + 1], this.P[o + 2]);
      _B.set(this.P[o + 3], this.P[o + 4], this.P[o + 5]);
      _C.set(this.P[o + 6], this.P[o + 7], this.P[o + 8]);
      _E1.subVectors(_B, _A); _E2.subVectors(_C, _A); _N.crossVectors(_E1, _E2).normalize();
      if (_N.y < minNy) continue;
      const cx = (_A.x + _B.x + _C.x) / 3, cy = (_A.y + _B.y + _C.y) / 3, cz = (_A.z + _B.z + _C.z) / 3;
      // blotchy: low-frequency hash so neighbouring facets clump
      const h = hash3(Math.floor(cx / 3.5) + seed, Math.floor(cy / 3.5), Math.floor(cz / 3.5));
      if (h > chance) continue;
      const k = 0.97 + 0.06 * hash3(cx, cy, cz);
      for (let v = 0; v < 3; v++) { this.C[o + v * 3] = rgb[0] * k; this.C[o + v * 3 + 1] = rgb[1] * k; this.C[o + v * 3 + 2] = rgb[2] * k; }
    }
    return this;
  }
  /** Index for `frost(from…)`. */
  mark(): number { return this.P.length / 9; }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    geo.setAttribute('glow', new THREE.Float32BufferAttribute(this.G, 1));
    geo.computeVertexNormals();          // non-indexed → exact per-face normals (facets)
    const out = bakeOutlineNormals(geo);
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

// ─────────────────────────────── the foe material ───────────────────────────────
export interface FoeUniforms { uFlash: { value: number }; uGlowMul: { value: number } }
export type FoeMaterial = THREE.MeshToonMaterial & { userData: { bt: FoeUniforms } };

/**
 * Toon material (render-core `makeToon`, vertex colours) patched for:
 *   * `glow` vertex attribute → emissive = painted colour × glow × uGlowMul (lamps/visors,
 *     ~3–6× the surrounding surface — CONTRACT §6.1 glare bar, no bloom);
 *   * hit flash → diffuse lerps to white (+ a little emissive) by `uFlash` (per material) or,
 *     for instanced foes, by the per-instance `instFlash` attribute.
 * Patched with a stable `customProgramCacheKey`, so every boss flash-group material and
 * every enemy batch share ONE program each.
 */
export function makeFoeMaterial(instanced: boolean): FoeMaterial {
  const mat = makeToon({ color: '#ffffff', vertexColors: true }) as FoeMaterial;
  const u: FoeUniforms = { uFlash: { value: 0 }, uGlowMul: { value: 1 } };
  mat.userData.bt = u;
  if (instanced) mat.defines = { ...(mat.defines ?? {}), BT_INST_FLASH: '' };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uFlash = u.uFlash;
    shader.uniforms.uGlowMul = u.uGlowMul;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', [
        'attribute float glow;', 'varying float vBtGlow;',
        '#ifdef BT_INST_FLASH', 'attribute float instFlash;', 'varying float vBtFlash;', '#endif',
        'void main() {',
      ].join('\n'))
      .replace('#include <color_vertex>', [
        '#include <color_vertex>', 'vBtGlow = glow;',
        '#ifdef BT_INST_FLASH', 'vBtFlash = instFlash;', '#endif',
      ].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', [
        'varying float vBtGlow;', 'uniform float uFlash;', 'uniform float uGlowMul;',
        '#ifdef BT_INST_FLASH', 'varying float vBtFlash;', '#endif',
        'void main() {',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        '{',
        '  float btF = uFlash;',
        '  #ifdef BT_INST_FLASH', '  btF = max(btF, vBtFlash);', '  #endif',
        '  totalEmissiveRadiance += diffuseColor.rgb * vBtGlow * uGlowMul;',
        '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), btF);',
        '  totalEmissiveRadiance += vec3(0.55 * btF);',
        '}',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'btfoe-' + (instanced ? 'i-' : 's-') + prevKey;
  return mat;
}

// ─────────────────────────────── enemy model types ───────────────────────────────
/** What drives a part's per-frame transform (see EnemyView). */
export type FoeAnim =
  | 'body'       // bob / sway / suspension (pivot = model body centre)
  | 'leg'        // biped hip swing (a = side ±1)
  | 'arm'        // free arm counter-swing (a = side ±1)
  | 'gunArm'     // carbine arm: aim raise + recoil kick
  | 'shieldArm'  // riot shield arm: braced forward
  | 'rotor'      // spin about Y (a = spin direction ±1)
  | 'wheel'      // roll about X (b = 1 → steers)
  | 'turret'     // yaw toward the aim point
  | 'barrel'     // elevation + recoil slide (child of a turret)
  | 'hatch'      // rear ramp opens when a squad deploys
  | 'thigh'      // tripod stilt: lift phase (a = leg index)
  | 'shin'       // tripod stilt lower leg (counter-bend)
  | 'mortar'     // mortar rack: yaw toward titan + recoil
  | 'blade'      // dozer blade: raise during a charge
  | 'beacon';    // rotating warning beacon

export const PIV_STRIDE = 6;   // x, y, z, restYaw, a, b

export interface FoePart {
  name: string;
  anim: FoeAnim;
  geo: THREE.BufferGeometry;
  /** index of the parent part (−1 = model root). Parents precede children. */
  parent: number;
  /** pivots in PARENT space, stride PIV_STRIDE: x, y, z, restYaw, a, b. One instance each. */
  piv: Float32Array;
  count: number;
  shadow: boolean;
}

export type FoeGait = 'biped' | 'hover' | 'wheeled' | 'tracked' | 'tripod';

export interface FoeModel {
  kind: EnemyKind;
  /** authored height (m) — equals CONTRACT §9 h; the view scales by enemy.height / height */
  height: number;
  radius: number;
  parts: FoePart[];
  gait: FoeGait;
  /** metres travelled per full gait cycle (biped / tripod) */
  stride: number;
  /** max hip swing (rad) for bipeds */
  swing: number;
  /** hip height (m) — keeps the planted foot on the ground while the leg swings */
  legLen: number;
  /** wheel / road-wheel radius (m) for rolling */
  wheelR: number;
  /** turret slew rate (rad/s) */
  turretRate: number;
}

interface PartSpec { name: string; anim: FoeAnim; parent: number; piv: number[][]; build: (f: Facet) => void; shadow?: boolean }

function mkParts(specs: PartSpec[]): FoePart[] {
  return specs.map((s) => {
    const f = new Facet();
    s.build(f);
    const piv = new Float32Array(s.piv.length * PIV_STRIDE);
    s.piv.forEach((p, i) => { for (let k = 0; k < PIV_STRIDE; k++) piv[i * PIV_STRIDE + k] = p[k] ?? 0; });
    return { name: s.name, anim: s.anim, geo: f.build(), parent: s.parent, piv, count: s.piv.length, shadow: s.shadow ?? true };
  });
}

const P = FOE_PAL;
const PI = Math.PI;

// ─────────────────────────────── shared humanoid bits ───────────────────────────────
/** Biped leg hanging from the hip (origin), sole at y = −len. */
function bipedLeg(f: Facet, len: number, thighCol: string, shinCol: string, kneeCol: string, bootCol: string): void {
  const k = len / 0.88;
  f.loft([
    { y: 0.02 * k, pts: rect(0.14, 0.15, 0.035) },
    { y: -0.2 * k, pts: rect(0.135, 0.145, 0.035) },
    { y: -0.4 * k, pts: rect(0.11, 0.12, 0.03) },
  ], { side: thighCol });
  f.box(0.13, 0.1 * k, 0.12, kneeCol, M(0, -0.43 * k, 0.02), { ch: 0.03, td: 0.8 });
  f.loft([
    { y: -0.46 * k, pts: rect(0.11, 0.12, 0.03) },
    { y: -0.62 * k, pts: rect(0.125, 0.14, 0.035, 0, 0.005) },
    { y: -0.79 * k, pts: rect(0.11, 0.12, 0.03) },
  ], { side: shinCol });
  // boot: toe forward
  f.box(0.14, 0.1 * k, 0.25, bootCol, M(0, -len + 0.05 * k, 0.045), { ch: 0.035, tw: 0.9, td: 0.85, sz: -0.01 });
}

/** Free arm hanging from the shoulder (origin). */
function freeArm(f: Facet, upper: string, fore: string, cuff: string, hand: string): void {
  f.cyl(0.065, 0.065, 0.1, 6, upper, M(0, -0.02, 0));
  f.loft([
    { y: -0.02, pts: rect(0.1, 0.11, 0.03) },
    { y: -0.28, pts: rect(0.085, 0.095, 0.025) },
  ], { side: upper });
  f.loft([
    { y: -0.29, pts: rect(0.09, 0.1, 0.025) },
    { y: -0.44, pts: rect(0.095, 0.105, 0.025) },
    { y: -0.5, pts: rect(0.1, 0.11, 0.025) },
    { y: -0.55, pts: rect(0.1, 0.11, 0.025) },
  ], { side: [fore, cuff, cuff] });
  f.box(0.08, 0.09, 0.09, hand, M(0, -0.6, 0.01), { ch: 0.02, tw: 0.8 });
}

/**
 * Bent carbine arm from the (right) shoulder: upper arm down, forearm forward, weapon along +Z
 * held across the chest (it points inward toward the body centre line).
 */
function gunArm(f: Facet, upper: string, fore: string, cuff: string, hand: string,
  gunBody: string, gunTrim: string, gunDark: string, gunLen: number): void {
  f.cyl(0.065, 0.065, 0.1, 6, upper, M(0, -0.02, 0));
  f.beam(0, -0.01, 0, 0.02, -0.27, 0.06, 0.1, 0.1, upper, { ch: 0.025, taper: 0.88 });
  f.beam(0.02, -0.27, 0.05, 0.08, -0.3, 0.3, 0.09, 0.09, fore, { ch: 0.02 });
  f.beam(0.07, -0.3, 0.24, 0.09, -0.305, 0.32, 0.1, 0.1, cuff, { ch: 0.02 });
  f.box(0.08, 0.08, 0.08, hand, M(0.1, -0.3, 0.35), { ch: 0.02 });
  // carbine (stock at the hand, muzzle forward): body, magazine, sight, muzzle ring
  const gx = 0.13, gy = -0.27;
  f.box(0.07, 0.1, gunLen, gunBody, M(gx, gy, 0.3 + gunLen / 2 - 0.12), { ch: 0.02 });
  f.box(0.06, 0.07, 0.16, gunDark, M(gx, gy - 0.02, 0.18), { ch: 0.015 });            // stock
  f.box(0.05, 0.12, 0.07, gunDark, M(gx, gy - 0.1, 0.36), { ch: 0.015, sz: 0.02 });   // magazine
  f.box(0.03, 0.04, 0.1, gunDark, M(gx, gy + 0.07, 0.38));                             // sight
  f.cyl(0.035, 0.035, 0.08, 6, gunTrim, M(gx, gy + 0.005, 0.3 + gunLen - 0.1, PI / 2));   // muzzle band
  f.cyl(0.022, 0.022, 0.1, 6, gunDark, M(gx, gy + 0.005, 0.3 + gunLen - 0.02, PI / 2), { top: gunDark });
}

// ─────────────────────────────── CROSSING WARDEN ───────────────────────────────
function android(): FoeModel {
  const hip = 0.9;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, hip, 0]],
      build: (f) => {
        f.box(0.3, 0.16, 0.2, P.navy, M(0, 0.0, 0), { ch: 0.04 });                  // pelvis
        f.mirrorX(() => f.box(0.08, 0.1, 0.07, P.navyD, M(0.15, 0.02, 0.08), { ch: 0.02 }));
        f.loft([
          { y: 0.06, pts: rect(0.28, 0.18, 0.05) },
          { y: 0.17, pts: rect(0.32, 0.2, 0.05) },
          { y: 0.23, pts: rect(0.36, 0.215, 0.055) },
          { y: 0.28, pts: rect(0.39, 0.23, 0.06) },
          { y: 0.47, pts: rect(0.47, 0.27, 0.07) },
          { y: 0.57, pts: rect(0.38, 0.23, 0.07) },
        ], { side: [P.navy, P.org, P.navy, P.off, P.off], top: P.off });
        // HALVARD chest chevron + status lamp
        f.box(0.14, 0.05, 0.03, P.navy, M(0.06, 0.4, 0.135, 0, 0, 0.5), { ch: 0.01 });
        f.box(0.14, 0.05, 0.03, P.navy, M(-0.06, 0.4, 0.135, 0, 0, -0.5), { ch: 0.01 });
        f.box(0.05, 0.035, 0.02, P.lamp, M(-0.12, 0.47, 0.13), { glow: 1 });
        f.mirrorX(() => f.box(0.17, 0.08, 0.21, P.org, M(0.27, 0.56, 0), { ch: 0.035, tw: 0.8, td: 0.85 }));  // shoulder pads
        f.cyl(0.055, 0.06, 0.1, 6, P.navyD, M(0, 0.62, 0));                          // neck
        // helmet head
        f.loft([
          { y: 0.64, pts: ngon(8, 0.11, 0.12) },
          { y: 0.7, pts: ngon(8, 0.145, 0.155) },
          { y: 0.82, pts: ngon(8, 0.145, 0.155) },
          { y: 0.9, pts: ngon(8, 0.085, 0.095) },
        ], { side: [P.navy, P.off, P.off], top: P.off });
        f.box(0.24, 0.07, 0.07, P.visor, M(0, 0.765, 0.125), { ch: 0.02 });           // visor
        f.box(0.18, 0.02, 0.02, P.lamp, M(0, 0.77, 0.162), { glow: 1 });              // eye slit
        f.box(0.05, 0.05, 0.25, P.org, M(0, 0.905, -0.005), { ch: 0.015 });          // crest
        f.mirrorX(() => f.box(0.03, 0.08, 0.08, P.navy, M(0.15, 0.76, -0.01), { ch: 0.01 }));  // ear pods
        // backpack + radio mast
        f.box(0.3, 0.26, 0.12, P.navy, M(0, 0.37, -0.17), { ch: 0.03 });
        f.box(0.28, 0.05, 0.1, P.org, M(0, 0.52, -0.17), { ch: 0.02 });
        f.beam(0.1, 0.5, -0.2, 0.1, 0.86, -0.22, 0.02, 0.02, P.navyD);
        f.box(0.035, 0.035, 0.035, P.amber, M(0.1, 0.87, -0.22), { glow: 1 });
      },
    },
    { name: 'leg', anim: 'leg', parent: 0, piv: [[0.1, -0.02, 0, 0, 1], [-0.1, -0.02, 0, 0, -1]],
      build: (f) => bipedLeg(f, hip - 0.02, P.navy, P.off, P.org, P.navyD) },
    { name: 'arm', anim: 'arm', parent: 0, piv: [[0.27, 0.52, 0, 0, 1]],
      build: (f) => freeArm(f, P.navy, P.off, P.org, P.navyD) },
    { name: 'gunArm', anim: 'gunArm', parent: 0, piv: [[-0.27, 0.52, 0, 0, -1]],
      build: (f) => gunArm(f, P.navy, P.off, P.org, P.navyD, P.off, P.org, P.navyD, 0.62) },
  ]);
  return { kind: 'android', height: 1.8, radius: 0.45, parts, gait: 'biped', stride: 1.5, swing: 0.55, legLen: hip - 0.02, wheelR: 0, turretRate: 0 };
}

// ─────────────────────────────── PICKET SQUAD trooper ───────────────────────────────
function squad(): FoeModel {
  const hip = 0.9;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, hip, 0]],
      build: (f) => {
        f.box(0.3, 0.16, 0.2, P.navyD, M(0, 0.0, 0), { ch: 0.04 });
        f.loft([                                                                    // riot vest
          { y: 0.06, pts: rect(0.29, 0.19, 0.05) },
          { y: 0.2, pts: rect(0.36, 0.23, 0.055) },
          { y: 0.25, pts: rect(0.4, 0.25, 0.06) },
          { y: 0.29, pts: rect(0.43, 0.26, 0.065) },
          { y: 0.48, pts: rect(0.5, 0.29, 0.075) },
          { y: 0.58, pts: rect(0.4, 0.24, 0.07) },
        ], { side: [P.navy, P.off, P.org, P.navy, P.navy], top: P.navyL });
        f.box(0.3, 0.16, 0.05, P.navyL, M(0, 0.4, 0.13), { ch: 0.02 });             // chest plate
        f.box(0.2, 0.03, 0.02, P.org, M(0, 0.44, 0.158));                            // reflective strip
        f.mirrorX(() => f.box(0.19, 0.09, 0.22, P.navyL, M(0.28, 0.56, 0), { ch: 0.04, tw: 0.75, td: 0.85, top: P.org }));
        f.cyl(0.055, 0.06, 0.1, 6, P.navyD, M(0, 0.62, 0));
        // riot helmet dome with a raised face shield
        f.loft([
          { y: 0.63, pts: ngon(10, 0.13, 0.14) },
          { y: 0.7, pts: ngon(10, 0.165, 0.175) },
          { y: 0.8, pts: ngon(10, 0.16, 0.17) },
          { y: 0.87, pts: ngon(10, 0.12, 0.13) },
          { y: 0.91, pts: ngon(10, 0.06, 0.065) },
        ], { side: [P.navyD, P.navy, P.navy, P.navy], top: P.navy });
        f.loft([{ y: 0.795, pts: ngon(10, 0.17, 0.18) }, { y: 0.815, pts: ngon(10, 0.17, 0.18) }], { side: P.org, top: P.org, bottom: P.org }); // helmet band
        f.box(0.22, 0.06, 0.05, P.visor, M(0, 0.74, 0.15), { ch: 0.015 });
        f.box(0.16, 0.018, 0.02, P.lamp, M(0, 0.745, 0.176), { glow: 1 });
        f.box(0.3, 0.12, 0.025, P.glass, M(0, 0.86, 0.15, -0.9), { ch: 0.02 });    // raised visor
        f.box(0.26, 0.2, 0.1, P.navyD, M(0, 0.36, -0.17), { ch: 0.03 });            // pack
      },
    },
    { name: 'leg', anim: 'leg', parent: 0, piv: [[0.1, -0.02, 0, 0, 1], [-0.1, -0.02, 0, 0, -1]],
      build: (f) => bipedLeg(f, hip - 0.02, P.navyD, P.navy, P.off, P.navyD) },
    {
      name: 'shieldArm', anim: 'shieldArm', parent: 0, piv: [[0.27, 0.52, 0, 0, 1]],
      build: (f) => {
        f.cyl(0.065, 0.065, 0.1, 6, P.navy, M(0, -0.02, 0));
        f.beam(0, -0.01, 0, 0.0, -0.27, 0.08, 0.1, 0.1, P.navy, { ch: 0.025 });
        f.beam(0.0, -0.27, 0.07, -0.02, -0.24, 0.3, 0.095, 0.095, P.navyD, { ch: 0.02 });
        // riot shield: three faceted panels, orange rim, navy band, viewport slit
        const sy = -0.28, sz = 0.36;
        f.group(M(-0.06, sy, sz, 0, -0.12), () => {
          const W = 0.6, H = 1.02;
          for (let i = -1; i <= 1; i++) {
            const ang = i * 0.28;
            f.box(W / 3 + 0.004, H, 0.035, P.off, M(i * W / 3 * 0.97, 0, -Math.abs(i) * 0.03, 0, -ang), { top: P.org, bottom: P.org });
          }
          f.box(W + 0.02, 0.05, 0.05, P.org, M(0, H / 2, -0.01), { ch: 0.01 });
          f.box(W + 0.02, 0.05, 0.05, P.org, M(0, -H / 2, -0.01), { ch: 0.01 });
          f.box(W * 0.98, 0.12, 0.05, P.navy, M(0, -0.12, 0.012));
          f.box(0.3, 0.05, 0.05, P.visor, M(0, 0.28, 0.012));
        });
      },
    },
    { name: 'gunArm', anim: 'gunArm', parent: 0, piv: [[-0.27, 0.52, 0, 0, -1]],
      build: (f) => gunArm(f, P.navy, P.navyD, P.org, P.navyD, P.navyL, P.org, P.navyD, 0.46) },
  ]);
  return { kind: 'squad', height: 1.8, radius: 0.45, parts, gait: 'biped', stride: 1.45, swing: 0.5, legLen: hip - 0.02, wheelR: 0, turretRate: 0 };
}

// ─────────────────────────────── GNAT drone ───────────────────────────────
function drone(): FoeModel {
  const arm = 0.42;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, 0.22, 0]],
      build: (f) => {
        f.loft([
          { y: -0.15, pts: ngon(8, 0.12, 0.15, PI / 8) },
          { y: -0.07, pts: ngon(8, 0.23, 0.28, PI / 8) },
          { y: -0.01, pts: ngon(8, 0.26, 0.31, PI / 8) },
          { y: 0.05, pts: ngon(8, 0.26, 0.31, PI / 8) },
          { y: 0.12, pts: ngon(8, 0.15, 0.19, PI / 8) },
        ], { side: [P.navy, P.org, P.off, P.off], top: P.navy, bottom: P.navyD });
        // eye lamp in a navy hood
        f.box(0.18, 0.08, 0.08, P.navyD, M(0, 0.0, 0.29), { ch: 0.02 });
        f.box(0.12, 0.05, 0.04, P.red, M(0, 0.0, 0.33), { glow: 1 });
        // four arms + motor pods + skids
        for (const sx of [1, -1]) for (const sz of [1, -1]) {
          f.beam(sx * 0.12, 0.02, sz * 0.12, sx * arm, 0.06, sz * arm, 0.06, 0.05, P.navy);
          f.cyl(0.065, 0.06, 0.12, 6, P.org, M(sx * arm, 0.07, sz * arm), { top: P.navyD });
          f.box(0.03, 0.03, 0.03, sz > 0 ? P.lamp : P.red, M(sx * arm, 0.02, sz * arm + sz * 0.06), { glow: 1 });
        }
        f.mirrorX(() => {
          f.beam(0.12, -0.12, 0.1, 0.16, -0.2, 0.12, 0.025, 0.025, P.navyD);
          f.beam(0.12, -0.12, -0.1, 0.16, -0.2, -0.12, 0.025, 0.025, P.navyD);
          f.box(0.035, 0.035, 0.4, P.navyD, M(0.16, -0.2, 0));
        });
      },
    },
    {
      name: 'rotor', anim: 'rotor', parent: 0, shadow: false,
      piv: [[arm, 0.14, arm, 0, 1], [-arm, 0.14, arm, 0, -1], [arm, 0.14, -arm, 0, -1], [-arm, 0.14, -arm, 0, 1]],
      build: (f) => {
        f.cyl(0.03, 0.025, 0.05, 6, P.navyD, M(0, 0, 0));
        f.box(0.4, 0.012, 0.055, P.off, M(0, 0.015, 0, 0, 0, 0.12), { ch: 0.01, top: P.off });
        f.box(0.055, 0.012, 0.4, P.org, M(0, 0.02, 0, -0.12, 0, 0), { ch: 0.01 });
      },
    },
  ]);
  return { kind: 'drone', height: 0.5, radius: 0.6, parts, gait: 'hover', stride: 1, swing: 0, legLen: 0, wheelR: 0, turretRate: 0 };
}

// ─────────────────────────────── wheels ───────────────────────────────
/** Symmetric wheel (hub on both faces) rolling about X. */
function wheel(f: Facet, r: number, w: number, hubCol: string, seg = 10): void {
  const rot = M(0, 0, 0, 0, 0, PI / 2);
  f.group(rot, () => {
    f.loft([
      { y: -w / 2, pts: ngon(seg, r * 0.86) },
      { y: -w / 2 + w * 0.12, pts: ngon(seg, r) },
      { y: w / 2 - w * 0.12, pts: ngon(seg, r) },
      { y: w / 2, pts: ngon(seg, r * 0.86) },
    ], { side: P.tire, top: P.rubber, bottom: P.rubber });
    // hubs (proud of both faces) with a contrasting spoke bar so rolling reads
    f.cyl(r * 0.5, r * 0.44, w + 0.04, 6, hubCol, M(0, 0, 0), {});
    f.box(r * 0.95, w + 0.08, r * 0.16, P.navyD, M(0, 0, 0));
    f.cyl(r * 0.16, r * 0.16, w + 0.1, 6, P.org, M(0, 0, 0));
  });
}

// ─────────────────────────────── HOPPER buggy ───────────────────────────────
function buggy(): FoeModel {
  const pv = 0.8;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, pv, 0]],
      build: (f) => f.group(M(0, -pv, 0), () => {
        // tub
        f.loft([
          { y: 0.42, pts: rect(1.3, 2.8, 0.3) },
          { y: 0.62, pts: rect(1.62, 3.2, 0.4) },
          { y: 0.78, pts: rect(1.66, 3.24, 0.42) },
          { y: 0.98, pts: rect(1.5, 3.0, 0.36) },
        ], { side: [P.navyD, P.org, P.off], top: P.off, bottom: P.navyD });
        // sloped hood + racing stripe
        f.box(1.36, 0.28, 0.95, P.off, M(0, 1.1, 0.98), { ch: 0.2, tw: 0.9, td: 0.55, sz: -0.18, top: P.off });
        f.box(0.34, 0.3, 0.96, P.org, M(0, 1.12, 0.99), { tw: 0.9, td: 0.55, sz: -0.18 });
        // rear deck + fuel cells
        f.box(1.4, 0.26, 1.0, P.navy, M(0, 1.1, -1.05), { ch: 0.15 });
        f.mirrorX(() => f.cyl(0.14, 0.14, 0.9, 6, P.org, M(0.52, 1.3, -1.35, 0, 0, PI / 2)));
        // fenders
        for (const sx of [1, -1]) for (const sz of [1.05, -1.05]) {
          f.box(0.46, 0.1, 0.95, P.org, M(sx * 0.93, 0.98, sz), { ch: 0.08, td: 0.85, top: P.org, side: P.orgD });
        }
        // seat + driver (tiny warden in a helmet)
        f.box(0.5, 0.35, 0.45, P.navyD, M(0, 1.12, -0.2), { ch: 0.05 });
        f.box(0.36, 0.34, 0.26, P.off, M(0, 1.36, -0.12), { ch: 0.06 });
        f.box(0.1, 0.06, 0.04, P.org, M(0, 1.42, 0.02));
        f.loft([
          { y: 1.52, pts: ngon(8, 0.12, 0.13) },
          { y: 1.6, pts: ngon(8, 0.14, 0.15) },
          { y: 1.7, pts: ngon(8, 0.09, 0.1) },
        ], { side: [P.off, P.off], top: P.org, bottom: P.navy });
        f.box(0.18, 0.05, 0.05, P.lamp, M(0, 1.6, 0.11), { glow: 1 });
        // roll cage
        const cg = P.navy, t = 0.075;
        f.mirrorX(() => {
          f.beam(0.62, 0.96, 0.45, 0.52, 1.78, 0.12, t, t, cg);
          f.beam(0.52, 1.78, 0.12, 0.52, 1.78, -0.62, t, t, cg);
          f.beam(0.52, 1.78, -0.62, 0.62, 0.96, -0.95, t, t, cg);
          f.beam(0.62, 0.96, 0.45, 0.52, 1.78, -0.62, t * 0.8, t * 0.8, cg);
          // bull bar
          f.beam(0.55, 0.6, 1.62, 0.5, 1.0, 1.52, t, t, cg);
        });
        f.beam(-0.52, 1.78, 0.12, 0.52, 1.78, 0.12, t, t, cg);
        f.beam(-0.52, 1.78, -0.62, 0.52, 1.78, -0.62, t, t, cg);
        f.beam(-0.6, 0.62, 1.64, 0.6, 0.62, 1.64, t * 1.2, t * 1.2, cg);
        // light bar on the cage + headlights
        f.box(0.7, 0.08, 0.12, P.navyD, M(0, 1.84, 0.12));
        f.mirrorX(() => f.box(0.2, 0.07, 0.1, P.amber, M(0.2, 1.85, 0.16), { glow: 1 }));
        f.mirrorX(() => f.box(0.22, 0.14, 0.08, P.amber, M(0.5, 0.86, 1.62), { glow: 1 }));
      }),
    },
    {
      name: 'wheel', anim: 'wheel', parent: -1,
      piv: [[0.93, 0.42, 1.05, 0, 0, 1], [-0.93, 0.42, 1.05, 0, 0, 1], [0.93, 0.42, -1.05, 0, 0, 0], [-0.93, 0.42, -1.05, 0, 0, 0]],
      build: (f) => wheel(f, 0.42, 0.36, P.off, 10),
    },
    {
      name: 'pod', anim: 'turret', parent: 0, piv: [[0, 0.46, -1.02]],
      build: (f) => {
        f.cyl(0.26, 0.3, 0.14, 8, P.navyD, M(0, 0.02, 0));
        f.group(M(0, 0.3, 0.02, -0.28), () => {
          f.box(0.74, 0.44, 0.7, P.off, M(0, 0, 0), { ch: 0.06, top: P.org });
          f.box(0.76, 0.46, 0.06, P.org, M(0, 0, 0.36), { ch: 0.05 });
          for (const sx of [-0.17, 0.17]) for (const sy of [-0.1, 0.1]) {
            f.cyl(0.075, 0.075, 0.12, 6, P.navyD, M(sx, sy, 0.4, PI / 2), { top: P.tire });
          }
        });
      },
    },
  ]);
  return { kind: 'buggy', height: 1.8, radius: 1.6, parts, gait: 'wheeled', stride: 1, swing: 0, legLen: 0, wheelR: 0.42, turretRate: 5 };
}

// ─────────────────────────────── BULWARK APC ───────────────────────────────
function apc(): FoeModel {
  const pv = 1.0;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, pv, 0]],
      build: (f) => f.group(M(0, -pv, 0), () => {
        f.loft([
          { y: 0.5, pts: rect(2.2, 4.4, 0.35) },
          { y: 0.98, pts: rect(2.66, 5.0, 0.4) },
          { y: 1.2, pts: rect(2.7, 5.04, 0.42) },
          { y: 1.9, pts: rect(2.5, 4.3, 0.42, 0, -0.25) },
          { y: 2.02, pts: rect(2.2, 3.9, 0.36, 0, -0.3) },
        ], { side: [P.navyD, P.org, P.off, P.off], top: P.off, bottom: P.navyD });
        f.box(1.3, 0.05, 2.2, P.org, M(0, 2.04, -0.5));                                // roof panel
        f.box(1.5, 0.05, 0.25, P.navy, M(0, 2.045, 0.9));
        // armoured skirts over the wheels
        f.mirrorX(() => f.box(0.1, 0.42, 4.4, P.navy, M(1.36, 0.95, 0), { ch: 0.04 }));
        // vision blocks + headlights
        f.box(1.4, 0.2, 0.1, P.visor, M(0, 1.72, 2.12, -0.55), { ch: 0.04 });
        f.mirrorX(() => f.box(0.34, 0.06, 0.05, P.lamp, M(0.35, 1.73, 2.17, -0.55), { glow: 1 }));
        f.mirrorX(() => f.box(0.28, 0.16, 0.08, P.amber, M(0.95, 1.05, 2.5), { glow: 1 }));
        f.box(2.3, 0.22, 0.2, P.navyD, M(0, 0.72, 2.46), { ch: 0.05 });                // bumper
        // side doors + grab rails + antenna
        f.mirrorX(() => {
          f.box(0.05, 0.62, 0.9, P.offS, M(1.36, 1.5, 0.6), { ch: 0.03 });
          f.beam(1.28, 1.9, -1.5, 1.28, 1.9, -0.4, 0.05, 0.05, P.navyD);
        });
        f.beam(-0.9, 2.0, -1.6, -0.9, 3.0, -1.7, 0.035, 0.035, P.navyD);
        f.box(0.07, 0.07, 0.07, P.red, M(-0.9, 3.02, -1.7), { glow: 1 });
        // rear frame around the hatch
        f.box(2.3, 0.2, 0.12, P.navy, M(0, 1.88, -2.47));
      }),
    },
    {
      name: 'wheel', anim: 'wheel', parent: -1,
      piv: [[1.3, 0.55, 1.65, 0, 0, 1], [-1.3, 0.55, 1.65, 0, 0, 1], [1.3, 0.55, 0, 0, 0, 0], [-1.3, 0.55, 0, 0, 0, 0],
        [1.3, 0.55, -1.65, 0, 0, 0], [-1.3, 0.55, -1.65, 0, 0, 0]],
      build: (f) => wheel(f, 0.55, 0.44, P.off, 10),
    },
    {
      name: 'turret', anim: 'turret', parent: 0, piv: [[0, 1.02, 0.55]],
      build: (f) => {
        f.cyl(0.6, 0.5, 0.32, 8, P.navy, M(0, 0.16, 0), { top: P.navyL });
        f.box(0.9, 0.34, 0.1, P.org, M(0, 0.36, 0.52, 0.2), { ch: 0.05 });             // gun shield
        f.mirrorX(() => {
          f.beam(0.12, 0.33, 0.3, 0.12, 0.35, 1.25, 0.08, 0.08, P.navyD, { seg: 6 });
          f.box(0.11, 0.11, 0.12, P.org, M(0.12, 0.35, 1.2));
        });
        f.box(0.3, 0.2, 0.3, P.navyD, M(0, 0.44, -0.1), { ch: 0.05 });
        f.box(0.12, 0.05, 0.06, P.lamp, M(0, 0.47, 0.06), { glow: 1 });
      },
    },
    {
      name: 'hatch', anim: 'hatch', parent: 0, piv: [[0, -0.28, -2.44]],
      build: (f) => {
        f.box(1.7, 1.18, 0.12, P.off, M(0, 0.62, 0), { ch: 0.06 });
        f.box(1.5, 0.12, 0.13, P.org, M(0, 0.95, -0.005));
        f.box(0.5, 0.1, 0.14, P.navyD, M(0, 0.45, -0.005));
      },
    },
  ]);
  return { kind: 'apc', height: 2.6, radius: 2.4, parts, gait: 'wheeled', stride: 1, swing: 0, legLen: 0, wheelR: 0.55, turretRate: 3 };
}

// ─────────────────────────────── track unit ───────────────────────────────
function trackUnit(f: Facet, x0: number, x1: number, len: number, h: number, bottom: number): void {
  const hl = len / 2;
  f.prismX([
    bottom, -hl + h * 0.45, bottom, hl - h * 0.45, bottom + h * 0.5, hl, bottom + h, hl - h * 0.28,
    bottom + h, -hl + h * 0.28, bottom + h * 0.5, -hl,
  ], x0, x1, P.tire, undefined, { top: P.rubber, bottom: P.rubber });
}

// ─────────────────────────────── TORTOISE tank ───────────────────────────────
function tank(): FoeModel {
  const pv = 0.9;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, pv, 0]],
      build: (f) => f.group(M(0, -pv, 0), () => {
        f.mirrorX(() => {
          trackUnit(f, 0.95, 1.72, 6.2, 1.02, 0.02);
          f.box(0.92, 0.1, 6.3, P.off, M(1.36, 1.1, 0), { ch: 0.05, top: P.off });   // fender
          f.box(0.3, 0.11, 6.3, P.org, M(1.66, 1.11, 0));                              // fender stripe
          f.box(0.08, 0.34, 5.0, P.navy, M(1.8, 0.92, 0));                             // side skirt lip
        });
        f.loft([
          { y: 0.5, pts: rect(1.9, 5.2, 0.4) },
          { y: 1.08, pts: rect(2.8, 5.9, 0.55) },
          { y: 1.24, pts: rect(2.84, 5.94, 0.56) },
          { y: 1.62, pts: rect(2.6, 5.1, 0.5, 0, -0.15) },
        ], { side: [P.navyD, P.org, P.off], top: P.off, bottom: P.navyD });
        // glacis lights + tow hooks + engine deck grille
        f.mirrorX(() => f.box(0.26, 0.12, 0.08, P.amber, M(0.95, 1.26, 2.95), { glow: 1 }));
        f.mirrorX(() => f.box(0.14, 0.14, 0.2, P.navyD, M(0.7, 0.72, 2.85), { ch: 0.03 }));
        for (let i = 0; i < 5; i++) f.box(1.7, 0.05, 0.12, P.navyD, M(0, 1.64, -1.7 - i * 0.28));
        f.box(2.2, 0.28, 0.14, P.navy, M(0, 1.2, -3.02), { ch: 0.05 });
      }),
    },
    {
      name: 'wheel', anim: 'wheel', parent: 0,
      piv: [-2.1, -0.7, 0.7, 2.1].flatMap((z) => [[1.78, -0.42, z], [-1.78, -0.42, z]]),
      build: (f) => {
        f.group(M(0, 0, 0, 0, 0, PI / 2), () => {
          f.cyl(0.38, 0.38, 0.14, 8, P.off, M(0, 0, 0), { top: P.offS, bottom: P.offS });
          f.box(0.62, 0.18, 0.12, P.navyD, M(0, 0, 0));
          f.cyl(0.12, 0.12, 0.2, 6, P.org, M(0, 0, 0));
        });
      },
    },
    {
      name: 'turret', anim: 'turret', parent: 0, piv: [[0, 0.72, -0.35]],
      build: (f) => {
        f.loft([
          { y: 0.0, pts: rect(2.3, 2.9, 0.75) },
          { y: 0.3, pts: rect(2.36, 2.96, 0.77) },
          { y: 0.42, pts: rect(2.3, 2.9, 0.75) },
          { y: 0.74, pts: rect(1.85, 2.3, 0.6, 0, -0.1) },
        ], { side: [P.off, P.org, P.off], top: P.org, bottom: P.navyD });
        f.cyl(0.38, 0.34, 0.26, 8, P.navy, M(0.5, 0.86, -0.45), { top: P.navyL });   // cupola
        f.box(0.2, 0.08, 0.1, P.lamp, M(0.5, 0.92, -0.18), { glow: 1 });
        f.beam(-0.6, 0.74, -0.9, -0.62, 1.9, -1.0, 0.035, 0.035, P.navyD);           // antenna
        f.box(0.06, 0.06, 0.06, P.red, M(-0.62, 1.92, -1.0), { glow: 1 });
        f.box(1.1, 0.4, 0.5, P.navy, M(0, 0.3, -1.55), { ch: 0.08 });                // bustle rack
        f.mirrorX(() => f.box(0.14, 0.24, 0.5, P.navyD, M(1.1, 0.4, 0.3), { ch: 0.04 }));  // smoke launchers
      },
    },
    {
      name: 'barrel', anim: 'barrel', parent: 2, piv: [[0, 0.36, 1.25]],
      build: (f) => {
        f.box(0.95, 0.52, 0.44, P.navy, M(0, 0, 0.1), { ch: 0.1 });                   // mantlet
        f.cyl(0.14, 0.12, 3.4, 8, P.off, M(0, 0, 1.95, PI / 2));
        f.cyl(0.155, 0.155, 0.4, 8, P.org, M(0, 0, 2.9, PI / 2));
        f.box(0.36, 0.26, 0.42, P.navyD, M(0, 0, 3.72), { ch: 0.06 });               // muzzle brake
        f.cyl(0.09, 0.09, 0.06, 8, P.tire, M(0, 0, 3.94, PI / 2));
      },
    },
  ]);
  return { kind: 'tank', height: 2.8, radius: 2.8, parts, gait: 'tracked', stride: 1, swing: 0, legLen: 0, wheelR: 0.38, turretRate: 1.6 };
}

// ─────────────────────────────── STILT MORTAR walker ───────────────────────────────
function walker(): FoeModel {
  const pv = 9.4, hipR = 1.0, hipY = -0.8;
  const knee = [0, 1.4, 2.0];
  const legPiv = [0, 1, 2].map((i) => {
    const a = (i / 3) * PI * 2;
    return [Math.sin(a) * hipR, hipY, Math.cos(a) * hipR, a, i];
  });
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, pv, 0]],
      build: (f) => {
        const n = 16, rot = PI / 16;
        f.loft([
          { y: -1.15, pts: ngon(n, 0.7, 0.7, rot) },
          { y: -0.6, pts: ngon(n, 1.55, 1.6, rot) },
          { y: -0.05, pts: ngon(n, 1.95, 2.0, rot) },
          { y: 0.3, pts: ngon(n, 2.0, 2.05, rot) },
          { y: 1.1, pts: ngon(n, 1.7, 1.75, rot) },
          { y: 1.65, pts: ngon(n, 0.95, 1.0, rot) },
        ], {
          side: [P.navyD, P.navy, P.org, P.off, P.off], top: P.navy, bottom: P.navyD,
          face: (band, seg) => band === 2 ? ((seg & 1) === 0 ? P.org : P.navyD) : undefined,
        });
        // sensor cluster (three lenses) on the front
        f.box(1.2, 0.6, 0.5, P.navyD, M(0, 0.45, 1.75), { ch: 0.12 });
        f.box(0.26, 0.26, 0.1, P.lamp, M(0, 0.5, 2.02), { glow: 1 });
        f.mirrorX(() => f.box(0.16, 0.16, 0.1, P.lamp, M(0.36, 0.42, 1.99), { glow: 1 }));
        // hip housings
        for (const p of legPiv) f.cyl(0.42, 0.34, 0.5, 8, P.navy, M(p[0], hipY + 0.05, p[2]));
        // stabiliser fins + hazard light
        f.mirrorX(() => f.box(0.12, 0.5, 1.2, P.org, M(1.55, 1.3, -0.9), { ch: 0.05, td: 0.7 }));
        f.box(0.2, 0.2, 0.2, P.red, M(0, 1.78, 0.6), { glow: 1 });
      },
    },
    {
      name: 'thigh', anim: 'thigh', parent: 0, piv: legPiv,
      build: (f) => {
        f.beam(0, 0, 0, knee[0], knee[1], knee[2], 0.42, 0.42, P.navy, { ch: 0.08, taper: 0.85 });
        f.beam(0, 0.15, 0.05, knee[0], knee[1] + 0.25, knee[2] - 0.15, 0.14, 0.14, P.steelD, { seg: 6 });  // piston
        f.cyl(0.32, 0.32, 0.5, 8, P.org, M(knee[0], knee[1], knee[2], 0, 0, PI / 2));
        f.box(0.16, 0.12, 0.16, P.amber, M(knee[0], knee[1] + 0.34, knee[2]), { glow: 1 });
      },
    },
    {
      name: 'shin', anim: 'shin', parent: 1, piv: [[knee[0], knee[1], knee[2]], [knee[0], knee[1], knee[2]], [knee[0], knee[1], knee[2]]],
      build: (f) => {
        const fz = 0.6, fy = -9.72;
        f.beam(0, 0, 0, 0, fy, fz, 0.32, 0.32, P.off, { ch: 0.07, taper: 0.7 });
        for (const t of [0.12, 0.2, 0.62]) {
          f.beam(0, fy * t, fz * t, 0, fy * (t + 0.035), fz * (t + 0.035), 0.4 - t * 0.2, 0.4 - t * 0.2, t < 0.5 ? P.org : P.navy, { ch: 0.06 });
        }
        f.cyl(0.5, 0.36, 0.28, 8, P.navyD, M(0, fy - 0.14, fz), { top: P.navy });      // foot pad
      },
    },
    {
      name: 'mortar', anim: 'mortar', parent: 0, piv: [[0, 1.62, -0.35]],
      build: (f) => {
        f.cyl(0.8, 0.9, 0.3, 8, P.navyD, M(0, 0.05, 0));
        f.group(M(0, 0.55, 0, -0.85), () => {                     // rack tilted up toward +Z
          f.box(1.7, 0.5, 0.9, P.navy, M(0, -0.25, 0), { ch: 0.12 });
          for (const sx of [-0.52, 0, 0.52]) {
            f.cyl(0.24, 0.24, 1.9, 8, P.off, M(sx, 0.75, 0), { top: P.org });
            f.cyl(0.27, 0.27, 0.22, 8, P.org, M(sx, 1.55, 0));
            f.cyl(0.15, 0.15, 0.04, 8, P.tire, M(sx, 1.71, 0), { bottom: null });
          }
        });
      },
    },
  ]);
  return { kind: 'walker', height: 12, radius: 3, parts, gait: 'tripod', stride: 7, swing: 0, legLen: 0, wheelR: 0, turretRate: 0.9 };
}

// ─────────────────────────────── RAMROD elite breach-dozer ───────────────────────────────
function elite(): FoeModel {
  const pv = 1.6;
  const parts = mkParts([
    {
      name: 'body', anim: 'body', parent: -1, piv: [[0, pv, 0]],
      build: (f) => f.group(M(0, -pv, 0), () => {
        f.mirrorX(() => {
          trackUnit(f, 1.95, 3.4, 8.6, 2.1, 0.02);
          f.box(1.6, 0.16, 8.4, P.off, M(2.68, 2.2, 0), { ch: 0.08 });
          f.hazard(-4.1, 4.1, -0.22, 0.22, 0.06, 18, P.org, P.navyD, M(3.42, 1.9, 0, 0, PI / 2));  // skirt stripes
          f.box(0.1, 0.5, 8.3, P.navy, M(3.38, 1.9, 0));
        });
        f.loft([
          { y: 1.0, pts: rect(3.6, 7.0, 0.5) },
          { y: 2.1, pts: rect(4.1, 7.6, 0.6) },
          { y: 2.35, pts: rect(4.14, 7.64, 0.6) },
          { y: 3.4, pts: rect(3.8, 6.6, 0.55, 0, -0.3) },
        ], { side: [P.navyD, P.org, P.off], top: P.off, bottom: P.navyD });
        // hazard panels: front + rear
        f.hazard(-1.7, 1.7, 2.45, 3.2, 0.07, 9, P.org, P.navyD, M(0, 0, 3.52, -0.2));
        f.hazard(-1.7, 1.7, 2.45, 3.2, 0.07, 9, P.org, P.navyD, M(0, 0, -3.6, 0, PI));
        // armoured cab
        f.loft([
          { y: 3.4, pts: rect(3.1, 3.0, 0.4, 0, -1.4) },
          { y: 4.1, pts: rect(3.12, 3.02, 0.4, 0, -1.4) },
          { y: 5.3, pts: rect(2.6, 2.5, 0.35, 0, -1.55) },
        ], { side: [P.off, P.off], top: P.navy });
        f.box(2.4, 0.46, 0.1, P.visor, M(0, 4.6, -0.07, -0.38), { ch: 0.05 });        // front glass slit
        f.box(2.0, 0.08, 0.06, P.lamp, M(0, 4.62, -0.02, -0.38), { glow: 0.8 });
        f.mirrorX(() => f.box(0.1, 0.4, 1.8, P.visor, M(1.44, 4.62, -1.45), { ch: 0.04 }));
        f.box(3.2, 0.18, 3.1, P.org, M(0, 5.36, -1.5), { ch: 0.35, tw: 0.9, td: 0.9 }); // roof armour
        // exhaust stacks + rear ripper
        f.mirrorX(() => {
          f.cyl(0.2, 0.2, 2.4, 8, P.tire, M(1.3, 4.9, -3.0), { top: P.navyD });
          f.box(0.5, 0.08, 0.5, P.navyD, M(1.3, 6.12, -3.0, 0.25));
        });
        f.beam(0, 1.6, -3.6, 0, 0.3, -4.6, 0.5, 0.35, P.navyD, { ch: 0.08 });
        f.beam(0, 0.5, -4.4, 0, 0.0, -4.4, 0.36, 0.3, P.steelD, { taper: 0.4 });
        // blade mounts + headlights
        f.mirrorX(() => f.box(0.5, 0.7, 0.7, P.navy, M(1.6, 1.6, 3.55), { ch: 0.12 }));
        f.mirrorX(() => f.box(0.34, 0.2, 0.1, P.amber, M(1.4, 3.1, 3.3), { glow: 1 }));
      }),
    },
    {
      name: 'blade', anim: 'blade', parent: 0, piv: [[0, 0.0, 3.7]],
      build: (f) => {
        // push arms + rams (from the mounts to the blade back)
        f.mirrorX(() => {
          f.beam(1.6, 0, 0, 1.9, 0.1, 1.5, 0.45, 0.4, P.navy, { ch: 0.08 });
          f.beam(1.2, 1.1, -0.4, 1.3, 1.6, 1.4, 0.2, 0.2, P.steel, { seg: 6 });
        });
        // blade: three convex strips (cutting edge, face, curl) extruded across X
        const W = 4.3;
        f.prismX([-1.35, 1.95, -1.35, 2.3, -0.4, 2.1, -0.4, 1.78], -W, W, P.steelD);                 // cutting edge
        f.prismX([-0.4, 1.78, -0.4, 2.1, 0.9, 2.0, 0.9, 1.66], -W, W, P.off);                        // face
        f.prismX([0.9, 1.66, 0.9, 2.0, 1.75, 2.3, 1.65, 1.86], -W, W, P.off, undefined, { top: P.org, bottom: P.org });  // curl
        f.hazard(-W + 0.25, W - 0.25, -0.25, 0.75, 0.06, 16, P.org, P.navyD, M(0, 0, 2.08, -0.04));
        f.mirrorX(() => f.box(0.26, 3.0, 0.7, P.navy, M(W - 0.02, 0.25, 1.95), { ch: 0.06 }));        // end plates
        f.box(8.4, 0.16, 0.2, P.org, M(0, 1.72, 2.26));
      },
    },
    {
      name: 'beacon', anim: 'beacon', parent: 0, shadow: false,
      piv: [[1.05, 5.45 - pv, -0.55], [-1.05, 5.45 - pv, -0.55, 0, 1]],
      build: (f) => {
        f.cyl(0.26, 0.26, 0.12, 8, P.navyD, M(0, 0.06, 0));
        f.loft([
          { y: 0.12, pts: ngon(8, 0.22) },
          { y: 0.4, pts: ngon(8, 0.2) },
          { y: 0.5, pts: ngon(8, 0.1) },
        ], { side: P.orgD, top: P.orgD });
        f.box(0.26, 0.24, 0.06, P.red, M(0, 0.27, 0.2), { glow: 1 });   // lit reflector — spins
        f.box(0.2, 0.2, 0.06, P.amber, M(0, 0.27, -0.2), { glow: 0.6 });
      },
    },
  ]);
  return { kind: 'elite', height: 6, radius: 5, parts, gait: 'tracked', stride: 1, swing: 0, legLen: 0, wheelR: 0.5, turretRate: 0 };
}

// ─────────────────────────────── registry ───────────────────────────────
const BUILDERS: Record<EnemyKind, () => FoeModel> = { android, squad, drone, buggy, apc, tank, walker, elite };

/** Build one kind's model (fresh geometries — the caller owns and disposes them). */
export function buildFoeModel(kind: EnemyKind): FoeModel { return BUILDERS[kind](); }

/** Dispose every geometry of a model. */
export function disposeFoeModel(m: FoeModel): void { for (const p of m.parts) p.geo.dispose(); }
