// BLOCKTOOTH — city mesh kit (CONTRACT.md §6 table, §6.1, §6.2, §7.3). Owner: city-kit lane.
//
// `buildCityKit(biome)` builds, once per run, every piece of geometry the city view instances:
//   * per ARCHETYPE: `base` / `floor` / `roof` UNIT storeys (x,z ∈ [−0.5, 0.5], y ∈ [0, 1] = one
//     storey; roof caps and rooftop kit rise ABOVE y = 1). The view scales each instance by
//     (building.w, building.floorH, building.d) and stacks them:
//         storey 0 → base · storeys 1..n−2 → floor · storey n−1 → roof   (n ≥ 2)
//         n = 1 → base only (the base storey carries its own flat top / cornice)
//     `floor` pieces are OPEN TUBES (no top/bottom faces), so a stack has no hidden caps and the
//     ink hull never z-fights at the storey joints; every `base` is CLOSED on top, so a base shown
//     alone (n = 1, or mid-pancake) never exposes an open box.
//     Documented deviations from the strict unit box (all intentional, all verified by
//     _harness/scratch/city-kit/probe_kit.ts):
//       - decorative overhangs (awnings, lobby canopies, balconies, fire escapes, blade signs,
//         gantry bogies) reach at most 0.06 unit past ±0.5 — over the parcel setback;
//       - archetypes that can stand one storey tall (floors[0] = 1: shops, cafés, gatehouses,
//         sheds, shacks) carry their own roof kit ON THE BASE (AC unit, hatch, gable) up to
//         y < 2; with n ≥ 2 that kit sits inside the storey above and is never seen;
//       - wrapping shells rise above the base storey (podium terrace kit, dish plinth kit, the
//         cooling tower's lower flare up to y = 3) and the cooling tower's crown flare hangs
//         down to y = −3 below its roof storey (plus the gantry hook to y = −1): they enclose
//         the straight floor tubes they overlap, giving a hyperbolic silhouette from instanced
//         straight storeys.
//     The facade material expects kit geometry under an instance/model matrix whose scale IS
//     (w, floorH, d); it is not meant for pre-merged world-space geometry.
//   * per PROP KIND: a merged, faceted, vertex-coloured mesh authored in METRES, facing +Z, feet
//     at y = 0, sized to citygen's PROP_INFO footprint (len along +Z, wid along X).
//   * a unit RUBBLE heap (x,z ∈ [−0.5, 0.5], y ∈ [0, 1], top exactly at 1) the view scales to
//     (footprint w, pile height, footprint d); drawn with `kit.facade` (tint-aware).
//   * the shared FACADE material (buildings + rubble) and the prop material, and four GROUND
//     materials (road / sidewalk / plaza / lot) that draw their detail from WORLD position.
//
// ── Geometry conventions (read by the view) ──
//   * Non-indexed, one normal per face (faceted BY CONSTRUCTION; every triangle's winding is
//     forced to agree with its declared outward normal), painted linear vertex colours taken
//     from b.palette, `outlineNormal` pre-baked (render/materials.ts bakeOutlineNormals) so
//     `addOutline(mesh, 1.6)` costs nothing at mount.
//   * Custom attribute `aFac` (vec4) drives the facade shader:
//       x = kind + 16·tint   (kind: 0 plain · 1 punched windows · 2 shopfront · 3 clerestory strip ·
//                             4 glow (neon/sign/lamp) · 5 curtain wall · 6 corrugated · 7 container ·
//                             8 industrial multipane · 9 roof membrane (flat roof slabs; axis 2) ·
//                             10 paint (per-instance car/drum paint))
//       y = face centre (unit, along the face axis) — container kinds: slot id
//       z = face width (unit)            w = face axis: 0 → runs along X, 1 → along Z, 2 → none
//   * instanceColor is a multiplicative TINT around white (1,1,1 = the authored palette colour).
//     It only affects surfaces flagged `tint` (building bodies, rubble chunks, car paint,
//     containers) — trims, glass, signs and neon keep their true palette colours. Recommended
//     per-channel range 0.85–1.1.
//
// ── Facade shader (one program for every building + prop) ──
//   Windows are procedural and never stretch: the vertex stage reads the instance's real scale
//   from (modelMatrix · instanceMatrix) columns, so a window column is always ~3 m wide and one
//   row is drawn per storey (derived from the unit-space y and the instance's y scale = floorH).
//   Columns are corner-aligned per face. Per-window variation (blinds, tint, lit/unlit) hashes the
//   instance origin + storey index. Distant windows fade to the facade's average colour (fwidth
//   LOD) so Size-V zoom-outs never shimmer. LOCKWATER lights a subset of windows with glassLit
//   and makes neon/sign trims emissive at 3–8× the surface luminance (glare bar; no bloom).
//   Car paint / drum / container colours are picked per instance (gl_InstanceID for props,
//   instance origin for containers) from biome lists — no per-instance bookkeeping in the view.
//
// View code: THREE is allowed here. Nothing in this file touches sim state.

import * as THREE from 'three';
import type { BiomeDef, BiomePalette, BuildingArchetype, PropKind } from '../core/types.ts';
import { hashStr, mulberry32 } from '../core/rng.ts';
import { bakeOutlineNormals, makeToon } from '../render/materials.ts';

// ─────────────────────────────── public contract (CONTRACT §6) ───────────────────────────────
export interface ArchMeshes {
  base: THREE.BufferGeometry;
  floor: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface PropMesh {
  geo: THREE.BufferGeometry;
  material: THREE.Material;
  /** authored height of the prop (m) — top of its bounding box */
  height: number;
}

export interface CityKit {
  arch: Record<string, ArchMeshes>;
  props: Record<PropKind, PropMesh>;
  rubble: THREE.BufferGeometry;
  facade: THREE.Material;
  ground: Record<'road' | 'sidewalk' | 'plaza' | 'lot', THREE.Material>;
  dispose(): void;
}

// ─────────────────────────────── local types + colour helpers ───────────────────────────────
type V3 = [number, number, number];
type RGB = [number, number, number];

/** facade kinds (aFac.x); + TINT marks instanceColor-tintable surfaces */
const K = { PLAIN: 0, PUNCH: 1, SHOP: 2, STRIP: 3, GLOW: 4, CURTAIN: 5, CORR: 6, CONT: 7, MULTI: 8, ROOF: 9, PAINT: 10 } as const;
const TINT = 16;

const PROP_KINDS: readonly PropKind[] = [
  'car', 'taxi', 'van', 'bus', 'truck', 'kiosk', 'hydrant', 'lamp', 'tree', 'bench',
  'vending', 'signpost', 'barrier', 'drum', 'forklift', 'container', 'bollard', 'boat', 'pylon', 'snowbank',
];

const _c = new THREE.Color();
/** sRGB hex → linear working-space RGB (THREE.ColorManagement converts on setStyle). */
function lin(hex: string): RGB { _c.set(hex); return [_c.r, _c.g, _c.b]; }
function mix(a: RGB, b: RGB, t: number): RGB { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mul(a: RGB, k: number): RGB { return [a[0] * k, a[1] * k, a[2] * k]; }
const WHITE: RGB = [1, 1, 1];
/** near-white base for paint/container surfaces (the shader multiplies the picked colour in) */
const PAINT_BASE: RGB = [0.96, 0.96, 0.96];

// ─────────────────────────────── mesh builder ───────────────────────────────
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Accumulates faceted triangles. Every primitive declares its intended outward normal and the
 * builder fixes the winding to agree (doctrine §3: fix winding BY CONSTRUCTION). An optional
 * transform (matrix stack) lets parts be authored in metres and placed into unit space.
 */
class MB {
  private P: number[] = [];
  private N: number[] = [];
  private C: number[] = [];
  private F: number[] = [];
  /** aFac for subsequent primitives: [code, centre, width, axis] */
  fac: [number, number, number, number] = [0, 0, 1, 2];
  /** snow colour for up-facing faces (WHITE STACKS); null = no snow */
  snow: RGB | null = null;
  /** minimum TRUE-space normal.y for a face to take snow */
  snowNy = 0.72;
  /** unit → metre scale of this geometry (snow test in true metres; unit storeys are anisotropic) */
  ms: V3 = [1, 1, 1];
  /** per-primitive brightness jitter (hand-painted facets) */
  jit = 0.03;
  /** when set, box() draws its +Y face with this facade code (roof membrane on slabs) */
  topKind: number | null = null;
  rnd: () => number;
  private M: THREE.Matrix4 | null = null;
  private NM = new THREE.Matrix3();

  constructor(seed: number) { this.rnd = mulberry32(seed >>> 0); }

  get tris(): number { return this.P.length / 9; }

  plain(): void { this.fac = [0, 0, 1, 2]; }
  kind(code: number, axis = 2, centre = 0, width = 1): void { this.fac = [code, centre, width, axis]; }

  /** Run `fn` with `m` composed onto the current transform. */
  withM(m: THREE.Matrix4, fn: () => void): void {
    const prev = this.M;
    const prevNM = this.NM.clone();
    const next = prev ? prev.clone().multiply(m) : m.clone();
    this.M = next;
    this.NM.getNormalMatrix(next);
    fn();
    this.M = prev;
    this.NM.copy(prevNM);
  }

  private xf(p: V3): V3 {
    if (!this.M) return p;
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.M);
    return [_v.x, _v.y, _v.z];
  }

  shade(col: RGB, j = this.jit): RGB {
    const k = 1 + (this.rnd() * 2 - 1) * j;
    return [col[0] * k, col[1] * k, col[2] * k];
  }

  /** One triangle. `want` = intended outward normal (in the current local frame). */
  tri(a0: V3, b0: V3, c0: V3, col: RGB, want?: V3): void {
    const a = this.xf(a0);
    let b = this.xf(b0), c = this.xf(c0);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-14) return;
    nx /= l; ny /= l; nz /= l;
    if (want) {
      let wx = want[0], wy = want[1], wz = want[2];
      if (this.M) { _n.set(wx, wy, wz).applyMatrix3(this.NM); wx = _n.x; wy = _n.y; wz = _n.z; }
      if (nx * wx + ny * wy + nz * wz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    }
    let code = this.fac[0];
    let cc = col;
    if (this.snow && (code % 16) !== K.GLOW) {
      const tx = nx / this.ms[0], ty = ny / this.ms[1], tz = nz / this.ms[2];
      if (ty / Math.hypot(tx, ty, tz) > this.snowNy) { cc = this.snow; code = 0; }
    }
    this.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) {
      this.N.push(nx, ny, nz);
      this.C.push(cc[0], cc[1], cc[2]);
      this.F.push(code, this.fac[1], this.fac[2], this.fac[3]);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, col: RGB, want?: V3, jit = this.jit): void {
    const cc = this.shade(col, jit);
    this.tri(a, b, c, cc, want);
    this.tri(a, c, d, cc, want);
  }

  /** convex polygon (fan) */
  poly(pts: V3[], col: RGB, want?: V3): void {
    const cc = this.shade(col);
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0], pts[i], pts[i + 1], cc, want);
  }

  /**
   * Axis-aligned box. `skip` letters drop faces: x/X = −X/+X, y/Y = bottom/top, z/Z = −Z/+Z.
   * `top` colours the +Y face (defaults to `side`).
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: RGB, top?: RGB, skip = ''): void {
    if (!skip.includes('Z')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side, [0, 0, 1]);
    if (!skip.includes('z')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side, [0, 0, -1]);
    if (!skip.includes('X')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side, [1, 0, 0]);
    if (!skip.includes('x')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side, [-1, 0, 0]);
    if (!skip.includes('Y')) {
      const f = this.fac;
      if (this.topKind !== null) this.fac = [this.topKind, 0, 1, 2];
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top ?? side, [0, 1, 0]);
      this.fac = f;
    }
    if (!skip.includes('y')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], mul(side, 0.8), [0, -1, 0]);
  }

  /** centred box helper: centre (cx,cy0..cy1,cz), half sizes hx,hz */
  cbox(cx: number, y0: number, cz: number, hx: number, y1: number, hz: number, side: RGB, top?: RGB, skip = 'y'): void {
    this.box(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, side, top, skip);
  }

  /** Vertical n-gon frustum around (cx,cz): radius r0 at y0 → r1 at y1. */
  prism(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides: number, col: RGB,
    top: RGB | null = col, bottom = false, rot = 0, inward = false): void {
    const s = inward ? -1 : 1;
    for (let i = 0; i < sides; i++) {
      const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p0: V3 = [cx + Math.sin(a0) * r0, y0, cz + Math.cos(a0) * r0];
      const p1: V3 = [cx + Math.sin(a1) * r0, y0, cz + Math.cos(a1) * r0];
      const q1: V3 = [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1];
      const q0: V3 = [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1];
      const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
      this.quad(p0, p1, q1, q0, col, [Math.sin(am) * s, slope * s, Math.cos(am) * s]);
    }
    if (top && r1 > 1e-6) {
      const pts: V3[] = [];
      for (let i = 0; i < sides; i++) { const a = rot + (i / sides) * Math.PI * 2; pts.push([cx + Math.sin(a) * r1, y1, cz + Math.cos(a) * r1]); }
      this.poly(pts, top, [0, inward ? -1 : 1, 0]);
    }
    if (bottom && r0 > 1e-6) {
      const pts: V3[] = [];
      for (let i = 0; i < sides; i++) { const a = rot + (i / sides) * Math.PI * 2; pts.push([cx + Math.sin(a) * r0, y0, cz + Math.cos(a) * r0]); }
      this.poly(pts, mul(col, 0.8), [0, -1, 0]);
    }
  }

  /** Surface of revolution around local +Y. prof = [radius, y][]; facing +1 = outward. */
  lathe(prof: [number, number][], sides: number, col: RGB | ((seg: number) => RGB), facing: 1 | -1 = 1, rot = 0): void {
    for (let k = 0; k + 1 < prof.length; k++) {
      const [ra, ya] = prof[k], [rb, yb] = prof[k + 1];
      const nr = (yb - ya) * facing, ny = -(rb - ra) * facing;
      const cc = typeof col === 'function' ? col(k) : col;
      for (let i = 0; i < sides; i++) {
        const a0 = rot + (i / sides) * Math.PI * 2, a1 = rot + ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
        const want: V3 = [Math.sin(am) * nr, ny, Math.cos(am) * nr];
        this.quad(
          [Math.sin(a0) * ra, ya, Math.cos(a0) * ra], [Math.sin(a1) * ra, ya, Math.cos(a1) * ra],
          [Math.sin(a1) * rb, yb, Math.cos(a1) * rb], [Math.sin(a0) * rb, yb, Math.cos(a0) * rb], cc, want);
      }
    }
  }

  /** Low-poly lump (jittered icosahedron). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, cols: RGB[], rough = 0.18, flatBottom = false): void {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const vs: V3[] = raw.map((p) => {
      const l = Math.hypot(p[0], p[1], p[2]);
      const k = 1 + (this.rnd() * 2 - 1) * rough;
      let y = (p[1] / l) * ry * k;
      if (flatBottom && y < 0) y *= 0.15;
      return [cx + (p[0] / l) * rx * k, cy + y, cz + (p[2] / l) * rz * k];
    });
    for (const f of F) {
      const a = vs[f[0]], b = vs[f[1]], c = vs[f[2]];
      const mx = (a[0] + b[0] + c[0]) / 3 - cx, my = (a[1] + b[1] + c[1]) / 3 - cy, mz = (a[2] + b[2] + c[2]) / 3 - cz;
      const col = cols[Math.floor(this.rnd() * cols.length)];
      this.tri(a, b, c, this.shade(col, 0.05), [mx, my, mz]);
    }
  }

  /** Cylinder whose axis runs along X (wheels). */
  cylX(cx: number, cy: number, cz: number, r: number, hw: number, sides: number, col: RGB, cap: RGB): void {
    const ring = (x: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < sides; i++) { const a = ((i + 0.5) / sides) * Math.PI * 2; out.push([x, cy + Math.sin(a) * r, cz + Math.cos(a) * r]); }
      return out;
    };
    const L = ring(cx - hw), R = ring(cx + hw);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const am = ((i + 1) / sides) * Math.PI * 2;
      this.quad(L[i], L[j], R[j], R[i], col, [0, Math.sin(am), Math.cos(am)]);
    }
    this.poly(R, cap, [1, 0, 0]);
    this.poly(L, cap, [-1, 0, 0]);
  }

  /** Extrude a convex (z,y) profile along X between x0..x1. edge i = prof[i]→prof[i+1]. */
  extrudeX(prof: [number, number][], x0: number, x1: number, side: RGB, edges: RGB | RGB[]): void {
    const n = prof.length;
    let cz = 0, cy = 0;
    for (const p of prof) { cz += p[0] / n; cy += p[1] / n; }
    for (let i = 0; i < n; i++) {
      const [za, ya] = prof[i], [zb, yb] = prof[(i + 1) % n];
      const mz = (za + zb) / 2 - cz, my = (ya + yb) / 2 - cy;
      // outward normal of the edge in (z,y): perpendicular pointing away from the centroid
      let nz = yb - ya, ny = -(zb - za);
      if (nz * mz + ny * my < 0) { nz = -nz; ny = -ny; }
      const col = Array.isArray(edges[0]) ? (edges as RGB[])[i % (edges as RGB[]).length] : (edges as RGB);
      this.quad([x0, ya, za], [x0, yb, zb], [x1, yb, zb], [x1, ya, za], col, [0, ny, nz]);
    }
    this.poly(prof.map(([z, y]) => [x1, y, z] as V3), side, [1, 0, 0]);
    this.poly(prof.map(([z, y]) => [x0, y, z] as V3), side, [-1, 0, 0]);
  }

  /** Extrude a convex (x,y) profile along Z between z0..z1. */
  extrudeZ(prof: [number, number][], z0: number, z1: number, side: RGB, edges: RGB | RGB[]): void {
    const n = prof.length;
    let cx = 0, cy = 0;
    for (const p of prof) { cx += p[0] / n; cy += p[1] / n; }
    for (let i = 0; i < n; i++) {
      const [xa, ya] = prof[i], [xb, yb] = prof[(i + 1) % n];
      const mx = (xa + xb) / 2 - cx, my = (ya + yb) / 2 - cy;
      let nx = yb - ya, ny = -(xb - xa);
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      const col = Array.isArray(edges[0]) ? (edges as RGB[])[i % (edges as RGB[]).length] : (edges as RGB);
      this.quad([xa, ya, z0], [xb, yb, z0], [xb, yb, z1], [xa, ya, z1], col, [nx, ny, 0]);
    }
    this.poly(prof.map(([x, y]) => [x, y, z1] as V3), side, [0, 0, 1]);
    this.poly(prof.map(([x, y]) => [x, y, z0] as V3), side, [0, 0, -1]);
  }

  /** Square-section beam between two points (current frame). w = cross-section size. */
  beam(a: V3, b: V3, w: number, col: RGB, ends = false): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-9) return;
    const d: V3 = [dx / L, dy / L, dz / L];
    let up: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const s = norm(cross(d, up));
    up = norm(cross(s, d));
    const h = w / 2;
    const corner = (p: V3, i: number, j: number): V3 => [p[0] + s[0] * h * i + up[0] * h * j, p[1] + s[1] * h * i + up[1] * h * j, p[2] + s[2] * h * i + up[2] * h * j];
    const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
    const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
    const dirs: V3[] = [[-up[0], -up[1], -up[2]], s, up, [-s[0], -s[1], -s[2]]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(A[i], A[j], B[j], B[i], col, dirs[i]);
    }
    if (ends) {
      this.quad(A[0], A[1], A[2], A[3], col, [-d[0], -d[1], -d[2]]);
      this.quad(B[0], B[1], B[2], B[3], col, d);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(this.F, 4));
    bakeOutlineNormals(g);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a: V3): V3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
function trs(tx: number, ty: number, tz: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeTranslation(tx, ty, tz);
  m.multiply(_m1.makeScale(sx, sy, sz));
  if (ry) m.multiply(_m2.makeRotationY(ry));
  if (rx) m.multiply(_m2.makeRotationX(rx));
  if (rz) m.multiply(_m2.makeRotationZ(rz));
  return m;
}

// ─────────────────────────────── biome style ───────────────────────────────
interface Style {
  id: string;
  snow: boolean;      // snow caps on every up-facing ledge (WHITE STACKS)
  night: boolean;     // lit windows + emissive neon (LOCKWATER)
  neon: boolean;      // neon trims on buildings
  day: boolean;       // bright day styling (GRID-EAST blossom, striped awnings)
  snowC: RGB;
  ink: RGB;
  paint: string[];    // 8 per-instance paint colours (cars, vans, drums, boats)
  cont: string[];     // 6 container colours
  lit: number;        // fraction of windows lit
  winGlow: number;    // lit-window emissive scale
  glow: number;       // neon/sign/lamp emissive scale
}

function styleOf(b: BiomeDef): Style {
  const p = b.palette;
  const snow = b.weather === 'snow';
  const night = b.time === 'night';
  const day = b.time === 'day';
  const paint = night
    ? [p.bodyA, p.bodyB, p.bodyC, '#2e7d6b', '#8a93a3', '#6a2f5a', '#3a4658', '#a7aebb']
    : snow
      ? ['#b33a2c', '#3f5c7a', '#e9ecef', '#5b636b', '#6b7a4f', '#d98a2b', '#2f3a44', '#7d3a30']
      : ['#ff6f5e', '#4f8fb0', '#f4efe4', '#6fbf9e', '#3d5a80', '#e6ab4a', '#c95d63', '#9f94d4'];
  const cont = night
    ? [p.bodyA, p.bodyB, p.bodyC, '#2e7d6b', '#7a3524', '#4a5566']
    : snow
      ? ['#8e4a3a', '#3f5c7a', '#6b7a4f', '#9aa4ad', '#d98a2b', '#5b636b']
      : ['#ff6f5e', '#4f8fb0', '#e6ab4a', '#6f8f8c', '#c95d63', '#3d5a80'];
  return {
    id: b.id, snow, night, neon: night, day,
    snowC: lin(snow ? p.ground : '#eef2f6'),
    ink: lin('#1b1426'),
    paint, cont,
    lit: night ? 0.36 : snow ? 0.14 : 0,
    winGlow: night ? 0.95 : snow ? 0.4 : 0,
    glow: night ? 1.55 : snow ? 0.5 : 0.08,
  };
}

// ─────────────────────────────── facade / prop material ───────────────────────────────
const FAC_VERT_PARS = /* glsl */ `
attribute vec4 aFac;
uniform vec3 uBkPaint[ 8 ];
uniform vec3 uBkCont[ 6 ];
varying vec4 vBkA;
varying vec4 vBkB;
float bkHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
`;

const FAC_VERT_MAIN = /* glsl */ `
	vColor = vec4( 1.0 );
	vColor.rgb *= color;
	mat4 bkM = modelMatrix;
	#ifdef USE_INSTANCING
		bkM = bkM * instanceMatrix;
	#endif
	vec3 bkS = vec3( length( bkM[ 0 ].xyz ), length( bkM[ 1 ].xyz ), length( bkM[ 2 ].xyz ) );
	vec3 bkO = bkM[ 3 ].xyz;
	float bkTint = step( 15.5, aFac.x );
	float bkKind = floor( aFac.x - 16.0 * bkTint + 0.5 );
	float bkFl = floor( bkO.y / max( bkS.y, 0.05 ) + 0.5 );
	float bkSeed = bkHash( bkO.xz * 0.173 + vec2( bkFl * 1.37, bkFl * 0.61 ) );
	#ifdef USE_INSTANCING
		float bkPick = bkHash( vec2( float( gl_InstanceID ) * 0.618 + 0.21, 7.31 ) );
	#else
		float bkPick = bkHash( bkO.xz * 0.311 + vec2( 0.5, 2.5 ) );
	#endif
	if ( bkKind == 10.0 ) {
		vColor.rgb *= uBkPaint[ int( min( bkPick * 8.0, 7.0 ) ) ];
	} else if ( bkKind == 7.0 ) {
		float bkCp = bkHash( vec2( bkSeed * 61.7 + aFac.y * 3.3, aFac.y * 1.9 + bkSeed * 5.1 ) );
		vColor.rgb *= uBkCont[ int( min( bkCp * 6.0, 5.0 ) ) ];
	}
	#ifdef USE_INSTANCING_COLOR
		vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, bkTint );
	#endif
	float bkAx = aFac.w;
	float bkAlong = bkAx < 0.5 ? position.x : position.z;
	float bkSA = bkAx < 0.5 ? bkS.x : bkS.z;
	float bkCen = bkKind == 7.0 ? 0.0 : aFac.y;
	vBkA = vec4( bkKind, ( bkAlong - bkCen ) * bkSA, max( aFac.z * bkSA, 0.05 ), position.y * bkS.y );
	if ( bkKind == 9.0 ) vBkA = vec4( 9.0, position.x * bkS.x, 1.0, position.z * bkS.z );
	vBkB = vec4( bkS.y, bkSeed, bkAx, bkPick );
`;

const FAC_FRAG_PARS = /* glsl */ `
uniform vec3 uBkGlass;
uniform vec3 uBkGlassLit;
uniform vec3 uBkFrame;
uniform vec3 uBkSill;
uniform vec3 uBkSky;
uniform float uBkLit;
uniform float uBkWinGlow;
uniform float uBkGlow;
uniform float uBkBrick;
varying vec4 vBkA;
varying vec4 vBkB;
float bkHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float bkBand( float x, float a, float b, float w ) { return smoothstep( a - w, a + w, x ) - smoothstep( b - w, b + w, x ); }
float bkIn( float d, float r, float w ) { return 1.0 - smoothstep( r - w, r + w, d ); }
vec3 bkGlassC( float h, float vv, float xx ) {
	vec3 g = uBkGlass * ( 0.78 + 0.34 * h );
	float glint = smoothstep( 0.2, 0.0, abs( vv - 0.5 - xx * 0.32 ) );
	return mix( g, uBkSky, clamp( 0.1 + 0.28 * vv + 0.34 * glint, 0.0, 0.8 ) );
}
`;

const FAC_FRAG_MAIN = /* glsl */ `
	vec3 bkEmit = vec3( 0.0 );
	{
		float kind = vBkA.x;
		if ( kind == 4.0 ) {
			bkEmit = diffuseColor.rgb * uBkGlow;
		} else if ( kind > 0.5 && kind < 9.5 && ( vBkB.z < 1.5 || kind == 9.0 ) ) {
			vec3 wallC = diffuseColor.rgb;
			float along = vBkA.y;
			float fw = vBkA.z;
			float fh = max( vBkB.x, 0.5 );
			float vm = vBkA.w;
			float seed = vBkB.y;
			float pxm = max( max( fwidth( along ), fwidth( vm ) ), 1e-4 );
			float aa = pxm * 0.75;
			vec3 c = wallC;
			vec3 e = vec3( 0.0 );
			if ( kind == 9.0 ) {
				// flat roof: rolled membrane strips (direction per building), seams and a few
				// repair patches; fades to the flat colour when a strip is under a few pixels
				float dirSel = step( 0.5, fract( seed * 5.7 ) );
				float ra = mix( along, vm, dirSel );
				float per = 1.9;
				float ph = fract( ra / per ) * per; ph = min( ph, per - ph );
				float seam = bkIn( ph, 0.03, aa );
				float strip = bkHash( vec2( floor( ra / per ) + seed * 13.0, seed * 3.0 ) );
				vec3 detail = wallC * ( 0.955 + 0.075 * strip ) * ( 1.0 - 0.1 * seam );
				vec2 rq = vec2( along, vm );
				vec2 cell = floor( rq / 4.5 );
				vec2 lq = rq - cell * 4.5 - 2.25;
				float hp = bkHash( cell + vec2( seed * 17.0, seed * 5.0 ) );
				detail *= 1.0 - 0.08 * step( 0.8, hp ) * bkIn( max( abs( lq.x ) * 0.8, abs( lq.y ) ), 1.2, aa );
				float lod = smoothstep( 0.1, 0.4, pxm );
				c = mix( detail, wallC * 0.985, lod );
			} else if ( kind == 1.0 || kind == 8.0 ) {
				bool ind = kind == 8.0;
				float n = max( 1.0, floor( fw / ( ind ? 3.6 : 3.0 ) + 0.5 ) );
				float cw = fw / n;
				float u = along / cw + n * 0.5;
				float col = floor( u );
				float x = ( u - col - 0.5 ) * cw;
				float ax = abs( x );
				float hw = ind ? min( 1.15, cw * 0.34 ) : min( 0.8, cw * 0.27 );
				float y0 = fh * ( ind ? 0.17 : 0.3 );
				float y1 = fh * ( ind ? 0.9 : 0.8 );
				float h = bkHash( vec2( col * 0.731 + seed * 17.0, seed * 3.1 - col * 0.117 ) );
				float win = bkIn( ax, hw, aa ) * bkBand( vm, y0, y1, aa );
				float pane = bkIn( ax, hw - 0.1, aa ) * bkBand( vm, y0 + 0.1, y1 - 0.1, aa );
				float vv = clamp( ( vm - y0 ) / ( y1 - y0 ), 0.0, 1.0 );
				float bars;
				if ( ind ) {
					float pw = hw * 2.0 / 3.0;
					float gx = fract( ( x + hw ) / pw ) * pw; gx = min( gx, pw - gx );
					float gy = fract( ( vm - y0 ) / 0.62 ) * 0.62; gy = min( gy, 0.62 - gy );
					bars = bkIn( min( gx, gy ), 0.04, aa );
				} else {
					float mt = y0 + ( y1 - y0 ) * 0.68;
					bars = bkIn( min( ax, abs( vm - mt ) ), 0.045, aa );
				}
				float sill = bkIn( ax, hw + 0.12, aa ) * bkBand( vm, y0 - 0.15, y0, aa );
				vec3 glass = bkGlassC( h, vv, x / hw );
				if ( ind ) glass = mix( glass, vec3( 0.2, 0.26, 0.25 ) * ( 0.6 + 0.8 * h ), 0.3 );
				float by = y0 + ( y1 - y0 ) * ( 0.5 + 0.3 * fract( h * 7.0 ) );
				float blind = step( h, 0.3 ) * smoothstep( by - aa, by + aa, vm );
				glass = mix( glass, mix( uBkSill, wallC, 0.35 ), blind * 0.85 );
				float lit = step( 1.0 - uBkLit, fract( h * 13.7 + seed * 3.3 ) );
				vec3 paneC = mix( glass, uBkGlassLit * ( 0.72 + 0.3 * h ), lit );
				float brick = uBkBrick * ( 1.0 - smoothstep( 0.03, 0.08, pxm ) );
				float cy = fract( vm / 0.3 ) * 0.3; cy = min( cy, 0.3 - cy );
				vec3 detail = wallC * ( 1.0 - 0.13 * brick * bkIn( cy, 0.02, aa ) );
				detail = mix( detail, uBkSill, sill );
				detail = mix( detail, uBkFrame, win );
				detail = mix( detail, paneC, pane * ( 1.0 - bars ) );
				float cov = ( 2.0 * hw / cw ) * ( ( y1 - y0 ) / fh );
				vec3 gAvg = mix( uBkGlass * 0.95, uBkGlassLit * 0.8, uBkLit );
				vec3 avg = mix( wallC, mix( uBkFrame, gAvg, 0.75 ), cov );
				float lod = smoothstep( cw * 0.1, cw * 0.26, pxm );
				c = mix( detail, avg, lod );
				e = uBkGlassLit * uBkWinGlow * mix( lit * pane * ( 1.0 - bars ) * ( 0.75 + 0.35 * h ), uBkLit * cov * 0.7, lod );
			} else if ( kind == 2.0 ) {
				float n = max( 1.0, floor( fw / 1.9 + 0.5 ) );
				float cw = fw / n;
				float u = along / cw + n * 0.5;
				float col = floor( u );
				float x = ( u - col - 0.5 ) * cw;
				float ax = abs( x );
				float y0 = 0.42;
				float y1 = fh * 0.64;
				float isDoor = step( abs( col - floor( n * 0.5 ) ), 0.1 ) * step( 2.5, n );
				float gy0 = mix( y0, 0.05, isDoor );
				float glassM = bkIn( ax, cw * 0.5 - 0.08, aa ) * bkBand( vm, gy0, y1, aa );
				float frameM = bkBand( vm, -1.0, y1 + 0.24, aa );
				float h = bkHash( vec2( col * 1.37 + seed * 11.0, seed * 5.3 ) );
				float vv = clamp( ( vm - y0 ) / ( y1 - y0 ), 0.0, 1.0 );
				vec3 glass = bkGlassC( h, vv, x / ( cw * 0.5 ) );
				float goods = ( 1.0 - isDoor ) * ( 1.0 - smoothstep( y0 + 0.9 - aa, y0 + 0.9 + aa, vm ) );
				glass = mix( glass, mix( uBkGlassLit, wallC, 0.5 ) * ( 0.45 + 0.3 * h ), 0.35 * goods );
				float litF = min( 1.0, uBkLit * 2.0 );
				float lit = step( 1.0 - litF, fract( h * 7.7 + seed ) );
				vec3 detail = mix( wallC, uBkFrame, frameM );
				detail = mix( detail, mix( glass, uBkGlassLit * 0.9, lit ), glassM );
				float cov = ( y1 - y0 ) / fh * 0.85;
				vec3 avg = mix( mix( wallC, uBkFrame, 0.4 ), mix( uBkGlass, uBkGlassLit, litF ), cov );
				float lod = smoothstep( cw * 0.12, cw * 0.3, pxm );
				c = mix( detail, avg, lod );
				e = uBkGlassLit * uBkWinGlow * mix( lit * glassM, litF * cov, lod );
			} else if ( kind == 5.0 ) {
				float n = max( 1.0, floor( fw / 1.6 + 0.5 ) );
				float cw = fw / n;
				float u = along / cw + n * 0.5;
				float col = floor( u );
				float x = ( u - col - 0.5 ) * cw;
				float ax = abs( x );
				float y0 = fh * 0.22;
				float y1 = fh * 0.96;
				float inP = bkIn( ax, cw * 0.5 - 0.07, aa );
				float glassM = inP * bkBand( vm, y0, y1, aa );
				float h = bkHash( vec2( col * 0.53 + seed * 19.0, seed * 2.7 ) );
				float hb = bkHash( vec2( floor( col / 3.0 ) + seed * 7.0, seed ) );
				vec3 glass = bkGlassC( 0.5 * h + 0.5 * hb, clamp( ( vm - y0 ) / ( y1 - y0 ), 0.0, 1.0 ), x / ( cw * 0.5 ) );
				float floorLit = step( 1.0 - uBkLit * 1.15, fract( seed * 7.31 ) );
				float lit = floorLit * step( 0.22, h ) + ( 1.0 - floorLit ) * step( 1.0 - uBkLit * 0.4, h );
				vec3 detail = uBkFrame;
				detail = mix( detail, wallC, inP * bkBand( vm, 0.05, y0 - 0.05, aa ) );
				detail = mix( detail, mix( glass, uBkGlassLit * ( 0.68 + 0.3 * h ), lit ), glassM );
				float cov = ( y1 - y0 ) / fh * 0.9;
				vec3 avg = mix( mix( uBkFrame, wallC, 0.6 ), mix( uBkGlass * 1.05, uBkGlassLit * 0.85, uBkLit ), cov );
				float lod = smoothstep( cw * 0.14, cw * 0.36, pxm );
				c = mix( detail, avg, lod );
				e = uBkGlassLit * uBkWinGlow * mix( lit * glassM, uBkLit * cov * 0.8, lod );
			} else {
				// corrugated family: 3 clerestory strip, 6 corrugated, 7 container
				bool doorFace = kind == 7.0 && vBkB.z < 0.5;
				float period = doorFace ? 0.62 : ( kind == 7.0 ? 0.3 : 0.26 );
				float ph = fract( along / period ) * period; ph = min( ph, period - ph );
				float fadeR = 1.0 - smoothstep( period * 0.2, period * 0.55, pxm );
				float rib = doorFace ? bkIn( ph, 0.04, aa ) : 0.5 + 0.5 * cos( ph / period * 6.2831853 );
				float ribAmt = doorFace ? 0.22 : 0.12;
				vec3 detail = wallC * ( 1.0 - ribAmt * mix( doorFace ? 0.15 : 0.5, rib, fadeR ) );
				if ( kind == 3.0 ) {
					float y0 = fh * 0.64;
					float y1 = fh * 0.86;
					float band = bkBand( vm, y0, y1, aa );
					float pn = max( 1.0, floor( fw / 1.3 + 0.5 ) );
					float pcw = fw / pn;
					float pu = along / pcw + pn * 0.5;
					float pc = floor( pu );
					float px = ( pu - pc - 0.5 ) * pcw;
					float pane = bkIn( abs( px ), pcw * 0.5 - 0.07, aa ) * bkBand( vm, y0 + 0.08, y1 - 0.08, aa );
					float hh = bkHash( vec2( pc * 0.91 + seed * 9.0, seed * 4.1 ) );
					float lit = step( 1.0 - min( 1.0, uBkLit * 1.6 ), hh );
					detail = mix( detail, uBkFrame, band );
					detail = mix( detail, mix( bkGlassC( hh, 0.5, px / pcw ), uBkGlassLit * 0.8, lit ), pane );
					float lod = smoothstep( pcw * 0.15, pcw * 0.4, pxm );
					float cov = ( y1 - y0 ) / fh;
					vec3 avg = mix( wallC * 0.95, mix( uBkFrame, uBkGlass, 0.6 ), cov );
					detail = mix( detail, avg, lod );
					e = uBkGlassLit * uBkWinGlow * mix( lit * pane, min( 1.0, uBkLit * 1.6 ) * cov * 0.6, lod );
				}
				c = detail;
			}
			diffuseColor.rgb = c;
			bkEmit = e;
		}
	}
`;

interface FacadeUniforms {
  uBkPaint: { value: THREE.Color[] };
  uBkCont: { value: THREE.Color[] };
  uBkGlass: { value: THREE.Color };
  uBkGlassLit: { value: THREE.Color };
  uBkFrame: { value: THREE.Color };
  uBkSill: { value: THREE.Color };
  uBkSky: { value: THREE.Color };
  uBkLit: { value: number };
  uBkWinGlow: { value: number };
  uBkGlow: { value: number };
  uBkBrick: { value: number };
}

function facadeUniforms(b: BiomeDef, st: Style): FacadeUniforms {
  const p = b.palette;
  const frame = st.snow ? p.trimA : st.night ? p.trimA : p.trimB;
  const sill = st.snow ? p.ground : st.night ? '#434a58' : '#fbf5e8';
  const sky = st.night ? p.skyHorizon : st.snow ? p.skyHorizon : '#bfe6f5';
  return {
    uBkPaint: { value: st.paint.map((h) => new THREE.Color(h)) },
    uBkCont: { value: st.cont.map((h) => new THREE.Color(h)) },
    uBkGlass: { value: new THREE.Color(p.glass) },
    uBkGlassLit: { value: new THREE.Color(p.glassLit) },
    uBkFrame: { value: new THREE.Color(frame) },
    uBkSill: { value: new THREE.Color(sill) },
    uBkSky: { value: new THREE.Color(sky) },
    uBkLit: { value: st.lit },
    uBkWinGlow: { value: st.winGlow },
    uBkGlow: { value: st.glow },
    uBkBrick: { value: st.snow ? 1 : 0 },
  };
}

function makeKitMaterial(U: FacadeUniforms, name: string): THREE.MeshToonMaterial {
  const m = makeToon({ vertexColors: true });
  m.name = name;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FAC_VERT_PARS)
      .replace('#include <color_vertex>', FAC_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FAC_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FAC_FRAG_MAIN)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += bkEmit;');
  };
  m.customProgramCacheKey = () => 'blocktooth-citykit-facade-v2';
  return m;
}

// ─────────────────────────────── ground materials ───────────────────────────────
const GND_VERT_PARS = /* glsl */ `
varying vec3 vBgW;
varying vec3 vBgN;
`;
const GND_VERT_MAIN = /* glsl */ `
	#include <worldpos_vertex>
	{
		vec4 bgW = vec4( transformed, 1.0 );
		vec3 bgN = objectNormal;
		#ifdef USE_INSTANCING
			bgW = instanceMatrix * bgW;
			bgN = mat3( instanceMatrix ) * bgN;
		#endif
		bgW = modelMatrix * bgW;
		vBgW = bgW.xyz;
		vBgN = normalize( mat3( modelMatrix ) * bgN );
	}
`;
const GND_FRAG_PARS = /* glsl */ `
uniform float uBgType;
uniform vec3 uBgA;
uniform vec3 uBgB;
uniform vec3 uBgCurb;
uniform vec3 uBgLine;
uniform float uBgLineAmt;
uniform vec3 uBgSnow;
uniform float uBgSnowAmt;
uniform float uBgWet;
uniform vec3 uBgSheen;
varying vec3 vBgW;
varying vec3 vBgN;
float bgHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float bgNoise( vec2 p ) {
	vec2 i = floor( p ); vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	float a = bgHash( i ), b = bgHash( i + vec2( 1.0, 0.0 ) ), c = bgHash( i + vec2( 0.0, 1.0 ) ), d = bgHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float bgIn( float d, float r, float w ) { return 1.0 - smoothstep( r - w, r + w, d ); }
`;
const GND_FRAG_MAIN = /* glsl */ `
	float bgWet = 0.0;
	{
		vec2 q = vBgW.xz;
		float pxm = max( length( fwidth( q ) ), 1e-4 );
		float aa = pxm * 0.7;
		float det = 1.0 - smoothstep( 0.06, 0.3, pxm );
		float n1 = bgNoise( q * 0.09 );
		float n2 = bgNoise( q * 0.8 + 17.0 );
		float n3 = bgNoise( q * 0.23 + 41.0 );
		vec3 c = uBgA;
		float wetM = 0.0;
		bool curb = abs( vBgN.y ) < 0.6;
		if ( curb ) {
			c = uBgCurb * ( 0.9 + 0.12 * n2 );
			wetM = 0.4;
		} else if ( uBgType < 0.5 ) {
			// road: two-scale asphalt grain + patched repairs + worn wheel paths
			c *= 0.93 + 0.1 * n1 + 0.07 * ( n2 - 0.5 ) * det;
			vec2 cell = floor( q / 11.0 );
			vec2 lq = q - cell * 11.0;
			float hp = bgHash( cell + 3.7 );
			vec2 p0 = vec2( 1.5 + 3.0 * bgHash( cell + 1.3 ), 1.0 + 3.0 * bgHash( cell + 2.9 ) );
			vec2 p1 = p0 + vec2( 3.0 + 4.0 * bgHash( cell + 5.1 ), 2.5 + 4.0 * bgHash( cell + 6.3 ) );
			float patchM = step( 0.78, hp ) * bgIn( max( abs( lq.x - ( p0.x + p1.x ) * 0.5 ) - ( p1.x - p0.x ) * 0.5, abs( lq.y - ( p0.y + p1.y ) * 0.5 ) - ( p1.y - p0.y ) * 0.5 ), 0.0, aa );
			c *= 1.0 - 0.075 * patchM;
			wetM = smoothstep( 0.5, 0.72, bgNoise( q * 0.06 + 3.0 ) * 0.7 + n2 * 0.3 );
		} else if ( uBgType < 1.5 ) {
			// sidewalk: 1.5 m slabs, per-slab shade, joints
			vec2 t = fract( q / 1.5 ) * 1.5; vec2 td = min( t, 1.5 - t );
			float joint = bgIn( min( td.x, td.y ), 0.035, aa ) * det;
			float th = bgHash( floor( q / 1.5 ) );
			c *= ( 0.95 + 0.08 * th ) * ( 1.0 - 0.13 * joint ) * ( 0.97 + 0.05 * n1 );
			wetM = 0.4 * smoothstep( 0.5, 0.75, n3 );
		} else if ( uBgType < 2.5 ) {
			// plaza: 2.4 m two-tone pavers with a border every 4 tiles
			vec2 t = fract( q / 2.4 ) * 2.4; vec2 td = min( t, 2.4 - t );
			vec2 ci = floor( q / 2.4 );
			float chk = mod( ci.x + ci.y, 2.0 );
			float border = step( 3.5, mod( ci.x, 4.0 ) ) + step( 3.5, mod( ci.y, 4.0 ) );
			float th = bgHash( ci + 9.0 );
			c = mix( uBgA, uBgB, clamp( chk * 0.45 + min( border, 1.0 ) * 0.8, 0.0, 1.0 ) );
			c *= ( 0.96 + 0.06 * th ) * ( 1.0 - 0.12 * bgIn( min( td.x, td.y ), 0.04, aa ) * det ) * ( 0.97 + 0.05 * n1 );
			wetM = 0.5 * smoothstep( 0.45, 0.75, n3 );
		} else {
			// lot / yard / dock apron: slab joints, bay lines, oil stains
			c *= 0.94 + 0.08 * n1 + 0.05 * ( n2 - 0.5 ) * det;
			vec2 t = fract( q / 6.0 ) * 6.0; vec2 td = min( t, 6.0 - t );
			c *= 1.0 - 0.08 * bgIn( min( td.x, td.y ), 0.04, aa ) * det;
			float rz = mod( q.y, 12.0 );
			float tx = fract( q.x / 2.7 ) * 2.7; tx = min( tx, 2.7 - tx );
			float tick = step( rz, 5.4 ) * bgIn( tx, 0.07, aa );
			float endL = bgIn( abs( rz - 5.4 ), 0.07, aa );
			float det2 = 1.0 - smoothstep( 0.1, 0.35, pxm );
			c = mix( c, uBgLine, max( tick, endL ) * uBgLineAmt * det2 * 0.85 );
			c *= 1.0 - 0.2 * smoothstep( 0.74, 0.92, bgNoise( q * 0.33 + 9.0 ) );
			wetM = smoothstep( 0.45, 0.7, n3 );
		}
		// snow drifts (WHITE STACKS): patchy on roads, heavier off the carriageway
		float snowK = uBgType < 0.5
			? uBgSnowAmt * ( 0.1 + 0.26 * smoothstep( 0.52, 0.8, n2 * 0.45 + n3 * 0.55 ) * det )
			: uBgSnowAmt * 0.85 * smoothstep( 0.42, 0.72, n1 * 0.6 + n3 * 0.4 );
		if ( !curb ) c = mix( c, uBgSnow, snowK );
		// wet (LOCKWATER): darker, slightly blue puddles
		bgWet = uBgWet * max( wetM, 0.2 );
		c = mix( c, c * vec3( 0.62, 0.68, 0.8 ), bgWet * 0.6 );
		diffuseColor.rgb = c;
	}
`;
const GND_FRAG_EMIT = /* glsl */ `
	#include <emissivemap_fragment>
	{
		vec3 bgV = normalize( vViewPosition );
		float bgF = pow( 1.0 - clamp( dot( normal, bgV ), 0.0, 1.0 ), 2.0 );
		totalEmissiveRadiance += uBgSheen * bgWet * ( 0.06 + 0.5 * bgF );
	}
`;

type GroundKind = 'road' | 'sidewalk' | 'plaza' | 'lot';

function makeGround(b: BiomeDef, st: Style, kind: GroundKind): THREE.MeshToonMaterial {
  const p = b.palette;
  const type = kind === 'road' ? 0 : kind === 'sidewalk' ? 1 : kind === 'plaza' ? 2 : 3;
  let A = p.road, B = p.road;
  if (kind === 'sidewalk') { A = p.sidewalk; B = p.sidewalk; }
  if (kind === 'plaza') {
    if (st.snow) { A = p.ground; B = p.sidewalk; }
    else if (st.night) { A = p.sidewalk; B = '#343a47'; }
    else { A = '#eadccb'; B = '#e3b9a8'; }
  }
  if (kind === 'lot') {
    if (st.snow) { A = '#c9d0d8'; B = A; }
    else if (st.night) { A = '#252b36'; B = A; }
    else { A = '#8c9a96'; B = A; }
  }
  const U = {
    uBgType: { value: type },
    uBgA: { value: new THREE.Color(A) },
    uBgB: { value: new THREE.Color(B) },
    uBgCurb: { value: new THREE.Color(p.curb) },
    uBgLine: { value: new THREE.Color(st.night ? '#c9a93a' : p.roadLine) },
    uBgLineAmt: { value: st.snow ? 0.25 : st.night ? 0.7 : 1 },
    uBgSnow: { value: new THREE.Color(p.ground) },
    uBgSnowAmt: { value: st.snow ? 1 : 0 },
    uBgWet: { value: st.night ? 1 : 0 },
    uBgSheen: { value: new THREE.Color(p.waterGlow) },
  };
  const m = makeToon({ color: '#ffffff' });
  m.name = 'cityGround:' + kind;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GND_VERT_PARS)
      .replace('#include <worldpos_vertex>', GND_VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GND_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GND_FRAG_MAIN)
      .replace('#include <emissivemap_fragment>', GND_FRAG_EMIT);
  };
  m.customProgramCacheKey = () => 'blocktooth-citykit-ground-v2';
  return m;
}

// ─────────────────────────────── archetype context ───────────────────────────────
interface AC {
  a: BuildingArchetype;
  b: BiomeDef;
  st: Style;
  pal: BiomePalette;
  /** typical footprint side (m) and storey height (m) — the unit↔metre conversion for kit parts */
  fmid: number;
  fh: number;
  /** unit per metre, horizontal / vertical */
  mx: number;
  my: number;
  /** wall inset (unit) so cornices/awnings stay inside ±0.5 */
  ins: number;
  body: RGB; trim: RGB; roof: RGB;
  glass: RGB; glassD: RGB; sign: RGB; signB: RGB; lit: RGB;
  dark: RGB; concrete: RGB; metal: RGB;
}

function archCtx(a: BuildingArchetype, b: BiomeDef, st: Style): AC {
  const p = b.palette;
  const fmid = Math.max(4, (a.footprint[0] + a.footprint[1]) / 2);
  const fh = Math.max(1, a.floorH);
  const mx = 1 / fmid, my = 1 / fh;
  const glass = lin(p.glass);
  return {
    a, b, st, pal: p, fmid, fh, mx, my,
    ins: Math.min(0.06, 0.45 * mx),
    body: lin(p[a.body]), trim: lin(p[a.trim]), roof: lin(p[a.roof]),
    glass, glassD: mix(glass, st.ink, 0.45), sign: lin(p.sign), signB: lin(p.signB), lit: lin(p.glassLit),
    dark: mix(lin(p.trimA), st.ink, 0.55),
    concrete: st.night ? lin('#4a505c') : st.snow ? lin('#aab3bb') : lin('#cfc6b4'),
    metal: st.night ? lin('#56606e') : lin('#8d969e'),
  };
}

function newMB(c: AC, tag: string): MB {
  const mb = new MB(hashStr(c.b.id + ':' + c.a.id + ':' + tag));
  mb.ms = [c.fmid, c.fh, c.fmid];
  mb.snow = c.st.snow ? c.st.snowC : null;
  mb.jit = 0.025;
  return mb;
}

/** Author a part in METRES at unit position (tx,ty,tz), rotated by ry about Y. */
function mpart(mb: MB, c: AC, tx: number, ty: number, tz: number, ry: number, fn: () => void): void {
  mb.withM(trs(tx, ty, tz, c.mx, c.my, c.mx, ry), fn);
}

type Face = 'Z' | 'X' | 'z' | 'x';
const FACE_ROT: Record<Face, number> = { Z: 0, X: Math.PI / 2, z: Math.PI, x: -Math.PI / 2 };

/** Run fn in a frame where the given face is the +Z face (x along the face, +z outward). */
function onFace(mb: MB, face: Face, fn: () => void): void {
  mb.withM(new THREE.Matrix4().makeRotationY(FACE_ROT[face]), fn);
}
const faceAxis = (face: Face): number => (face === 'Z' || face === 'z' ? 0 : 1);

/** Four storey walls with facade kinds per side (unit space, no transform). */
function walls(mb: MB, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, col: RGB,
  k: { x: number; X: number; z: number; Z: number }, tint = true, skip = ''): void {
  const T = tint ? TINT : 0;
  const cx = (x0 + x1) / 2, wx = x1 - x0, cz = (z0 + z1) / 2, wz = z1 - z0;
  const j = 0.02;
  if (!skip.includes('Z')) { mb.kind(k.Z + T, 0, cx, wx); mb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, [0, 0, 1], j); }
  if (!skip.includes('z')) { mb.kind(k.z + T, 0, cx, wx); mb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, [0, 0, -1], j); }
  if (!skip.includes('X')) { mb.kind(k.X + T, 1, cz, wz); mb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, [1, 0, 0], j); }
  if (!skip.includes('x')) { mb.kind(k.x + T, 1, cz, wz); mb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, [-1, 0, 0], j); }
  mb.plain();
}
const allK = (k: number) => ({ x: k, X: k, z: k, Z: k });

// ─────────────────────────────── shared building dressing (metre parts) ───────────────────────────────
/** Cornice band at the top of a storey (unit y0..y1) projecting `proj` m past the wall; top = roof colour. */
function cornice(mb: MB, c: AC, e: number, y0: number, y1: number, proj: number, side: RGB, top: RGB): void {
  const o = Math.min(0.5, e + proj * c.mx);
  mb.topKind = K.ROOF + TINT;
  mb.box(-o, y0, -o, o, y1, o, side, top, 'y');
  mb.topKind = null;
}

/** Parapet ring on a roof slab at unit y, h metres tall, t metres thick, outer half-extent o. */
function parapet(mb: MB, c: AC, o: number, y: number, h: number, t: number, col: RGB): void {
  const yt = y + h * c.my, tt = t * c.mx;
  mb.box(-o, y, o - tt, o, yt, o, col, col, 'y');
  mb.box(-o, y, -o, o, yt, -o + tt, col, col, 'y');
  mb.box(o - tt, y, -o + tt, o, yt, o - tt, col, col, 'yzZ');
  mb.box(-o, y, -o + tt, -o + tt, yt, o - tt, col, col, 'yzZ');
}

/** Rooftop AC unit (metres, origin at its base centre). */
function acUnit(mb: MB, c: AC, x: number, y: number, z: number, ry = 0): void {
  mpart(mb, c, x, y, z, ry, () => {
    const body = c.st.night ? lin('#6d7684') : lin('#d9dcd6');
    mb.cbox(0, 0, 0, 0.8, 1.0, 0.55, body, mul(body, 1.05));
    mb.prism(0.35, 0, 1.0, 1.06, 0.34, 0.34, 8, c.dark, mul(c.dark, 0.8));
    mb.cbox(-0.35, 1.0, 0, 0.28, 1.12, 0.3, c.metal, c.metal);
    mb.cbox(0, 0.2, 0.56, 0.6, 0.8, 0.02, mul(body, 0.8), undefined, 'yY');
  });
}

/** Classic timber rooftop water tank on legs (GRID-EAST walk-ups). */
function waterTank(mb: MB, c: AC, x: number, y: number, z: number): void {
  mpart(mb, c, x, y, z, 0, () => {
    const wood = c.st.snow ? lin('#6b5344') : lin('#9a6a4c');
    const legs = c.dark;
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) mb.cbox(lx, 0, lz, 0.1, 1.6, 0.1, legs, legs);
    mb.cbox(0, 1.5, 0, 1.25, 1.62, 1.25, legs, legs);
    mb.prism(0, 0, 1.62, 3.9, 1.2, 1.2, 8, wood, null);
    mb.prism(0, 0, 2.2, 2.3, 1.24, 1.24, 8, c.dark, null);
    mb.prism(0, 0, 3.2, 3.3, 1.24, 1.24, 8, c.dark, null);
    mb.prism(0, 0, 3.9, 4.9, 1.34, 0.08, 8, mul(wood, 0.85), null);
  });
}

/** Stair / lift bulkhead with a door (metres). */
function bulkhead(mb: MB, c: AC, x: number, y: number, z: number, w: number, d: number, h: number): void {
  mpart(mb, c, x, y, z, 0, () => {
    mb.cbox(0, 0, 0, w / 2, h, d / 2, mix(c.body, c.concrete, 0.5), c.roof);
    mb.cbox(w * 0.15, 0, d / 2, 0.5, 2.1, 0.04, c.dark, undefined, 'y');
  });
}

/** Thin mast with cross bars and a glowing tip (metres). */
function antenna(mb: MB, c: AC, x: number, y: number, z: number, h: number): void {
  mpart(mb, c, x, y, z, 0.4, () => {
    mb.prism(0, 0, 0, h, 0.12, 0.05, 5, c.metal, null);
    mb.cbox(0, h * 0.62, 0, 0.9, h * 0.62 + 0.08, 0.04, c.metal, c.metal, '');
    mb.cbox(0, h * 0.8, 0, 0.6, h * 0.8 + 0.08, 0.04, c.metal, c.metal, '');
    mb.kind(K.GLOW);
    mb.cbox(0, h, 0, 0.12, h + 0.24, 0.12, lin('#ff5a4a'), lin('#ff5a4a'), '');
    mb.plain();
  });
}

/** Striped sloping awning on the current face frame (+Z outward), metres; x centre cx, width w. */
function awning(mb: MB, c: AC, cx: number, w: number, y: number, depth: number, drop: number, colA: RGB, colB: RGB, stripes: number, glowEdge: RGB | null): void {
  const n = Math.max(2, stripes);
  for (let i = 0; i < n; i++) {
    const xa = cx - w / 2 + (w * i) / n, xb = cx - w / 2 + (w * (i + 1)) / n;
    const col = i % 2 === 0 ? colA : colB;
    // sloped top
    mb.quad([xa, y, 0], [xb, y, 0], [xb, y - drop, depth], [xa, y - drop, depth], col, [0, depth, drop], 0.01);
    // valance
    mb.quad([xa, y - drop, depth], [xb, y - drop, depth], [xb, y - drop - 0.28, depth], [xa, y - drop - 0.28, depth], mul(col, 0.92), [0, 0, 1], 0.01);
  }
  // side cheeks
  mb.tri([cx - w / 2, y, 0], [cx - w / 2, y - drop, depth], [cx - w / 2, y - drop - 0.28, depth], colA, [-1, 0, 0]);
  mb.tri([cx + w / 2, y, 0], [cx + w / 2, y - drop, depth], [cx + w / 2, y - drop - 0.28, depth], colA, [1, 0, 0]);
  if (glowEdge) {
    mb.kind(K.GLOW);
    mb.box(cx - w / 2, y - drop - 0.36, depth, cx + w / 2, y - drop - 0.28, depth + 0.06, glowEdge, glowEdge, 'y');
    mb.plain();
  }
}

/** Sign board with raised glyph blocks on the current face frame (+Z outward), metres. */
function signBoard(mb: MB, c: AC, cx: number, w: number, y0: number, y1: number, col: RGB, glyph: RGB, glow: boolean, seed: number): void {
  mb.box(cx - w / 2, y0, 0, cx + w / 2, y1, 0.22, col, mul(col, 0.9), 'y');
  const r = mulberry32(seed);
  const h = y1 - y0;
  let x = cx - w / 2 + 0.35;
  const end = cx + w / 2 - 0.35;
  if (glow) mb.kind(K.GLOW);
  while (x < end - 0.3) {
    const gw = Math.min(end - x, 0.28 + r() * 0.42);
    const gh = h * (0.45 + r() * 0.2);
    mb.box(x, y0 + (h - gh) / 2, 0.22, x + gw, y0 + (h + gh) / 2, 0.3, glyph, glyph, 'yz');
    x += gw + 0.16 + (r() < 0.2 ? 0.35 : 0);
  }
  mb.plain();
}

/** Roll-up shutter on the current face (metres, x centre, width, height). */
function shutter(mb: MB, c: AC, face: Face, cx: number, w: number, h: number, col: RGB): void {
  mb.kind(K.CORR + TINT, faceAxis(face));
  mb.box(cx - w / 2, 0, 0, cx + w / 2, h, 0.08, col, col, 'y');
  mb.plain();
  mb.box(cx - w / 2 - 0.14, 0, 0, cx - w / 2, h + 0.3, 0.14, c.dark, c.dark, 'y');
  mb.box(cx + w / 2, 0, 0, cx + w / 2 + 0.14, h + 0.3, 0.14, c.dark, c.dark, 'y');
  mb.box(cx - w / 2 - 0.14, h, 0, cx + w / 2 + 0.14, h + 0.36, 0.18, mul(col, 0.85), mul(col, 0.9), 'y');
}

/** Pink-blossom / pine / palm tree (metres, origin at the base). Shared by props + podium terraces. */
function treeParts(mb: MB, st: Style, pal: BiomePalette, scale: number, lite = false): void {
  const s = scale;
  if (st.snow) {
    const trunk = lin('#5a4336');
    const g = lin(pal.foliage), g2 = lin(pal.foliageB), snow = st.snowC;
    const sn = mb.snow; mb.snow = null;
    mb.prism(0, 0, 0, 0.9 * s, 0.16 * s, 0.13 * s, 6, trunk, null);
    const tiers: [number, number, number][] = lite ? [[0.7, 2.6, 1.2], [2.2, 4.3, 0.85]] : [[0.7, 2.3, 1.25], [1.9, 3.4, 0.98], [3.0, 4.5, 0.7]];
    for (const [y0, y1, r] of tiers) {
      const ym = y0 + (y1 - y0) * 0.45;
      const rm = r * 0.55;
      mb.prism(0, 0, y0 * s, ym * s, r * s, rm * s, 8, mb.shade(g2, 0.05), g2, true, 0.2);
      mb.prism(0, 0, ym * s, (y1 - 0.05) * s, rm * s, 0.08 * s, 8, snow, null, false, 0.2);
      mb.prism(0, 0, (ym - 0.12) * s, (ym + 0.02) * s, (rm + 0.14) * s, (rm + 0.02) * s, 8, snow, snow, false, 0.2);
    }
    mb.snow = sn;
    void g;
  } else if (st.night) {
    // dock palm: leaning ringed trunk + drooping fronds
    const trunk = lin('#5b4a3c'), trunkB = lin('#46382d');
    const fr = lin(pal.foliage), frB = lin(pal.foliageB);
    const segs = 6;
    let px = 0, pz = 0;
    for (let i = 0; i < segs; i++) {
      const y0 = (i / segs) * 4.6 * s, y1 = ((i + 1) / segs) * 4.6 * s;
      const lean = 0.08 * s * (i + 1) * (i + 1) * 0.12;
      mb.withM(trs(px, 0, pz), () => mb.prism(0, 0, y0, y1, (0.2 - i * 0.015) * s, (0.18 - i * 0.015) * s, 6, i % 2 ? trunk : trunkB, null));
      px = lean; pz = lean * 0.4;
    }
    const top: V3 = [px, 4.6 * s, pz];
    const nF = lite ? 5 : 7;
    for (let i = 0; i < nF; i++) {
      const a = (i / nF) * Math.PI * 2 + 0.3;
      const dx = Math.sin(a), dz = Math.cos(a);
      const L = (1.9 + (i % 3) * 0.25) * s;
      const mid: V3 = [top[0] + dx * L * 0.55, top[1] + 0.35 * s, top[2] + dz * L * 0.55];
      const tip: V3 = [top[0] + dx * L, top[1] - 0.7 * s, top[2] + dz * L];
      const sx = -dz * 0.38 * s, sz = dx * 0.38 * s;
      const col = i % 2 ? fr : frB;
      mb.quad(top, [mid[0] + sx, mid[1], mid[2] + sz], mid, top, col, [0, 1, 0]);
      mb.tri(top, [mid[0] + sx, mid[1], mid[2] + sz], mid, col, [0, 1, 0]);
      mb.tri(top, mid, [mid[0] - sx, mid[1], mid[2] - sz], col, [0, 1, 0]);
      mb.tri([mid[0] + sx, mid[1], mid[2] + sz], tip, mid, col, [0, 1, 0]);
      mb.tri(mid, tip, [mid[0] - sx, mid[1], mid[2] - sz], col, [0, 1, 0]);
      // underside so fronds read from any angle
      mb.tri(top, mid, [mid[0] + sx, mid[1] - 0.05, mid[2] + sz], mul(col, 0.7), [0, -1, 0]);
      mb.tri(mid, [mid[0] - sx, mid[1] - 0.05, mid[2] - sz], tip, mul(col, 0.7), [0, -1, 0]);
    }
    mb.blob(top[0], top[1] - 0.15 * s, top[2], 0.3 * s, 0.25 * s, 0.3 * s, [lin('#6b5a3a')], 0.2);
  } else {
    // blossom: forked trunk + clustered canopy lumps
    const bark = lin('#7a5a4a');
    const pinkA = lin(pal.foliage), pinkB = lin(pal.foliageB), pinkC = mix(lin(pal.foliage), WHITE, 0.35);
    mb.prism(0, 0, 0, 1.5 * s, 0.17 * s, 0.13 * s, 6, bark, null);
    mb.beam([0, 1.3 * s, 0], [0.55 * s, 2.4 * s, 0.2 * s], 0.16 * s, bark);
    mb.beam([0, 1.3 * s, 0], [-0.45 * s, 2.3 * s, -0.25 * s], 0.15 * s, bark);
    const lumps: [number, number, number, number][] = lite
      ? [[0, 2.75, 0, 1.2], [0.7, 2.45, 0.3, 0.8], [-0.4, 3.1, -0.2, 0.75]]
      : [[0, 2.75, 0, 1.15], [0.75, 2.45, 0.35, 0.8], [-0.7, 2.4, -0.3, 0.78], [0.2, 3.3, -0.35, 0.72], [-0.3, 2.9, 0.6, 0.7]];
    for (const [x, y, z, r] of lumps) mb.blob(x * s, y * s, z * s, r * s, r * 0.82 * s, r * s, [pinkA, pinkB, pinkC], 0.2);
  }
}

// ─────────────────────────────── archetype builders ───────────────────────────────
interface Pieces { base: MB; floor: MB; roof: MB; }

type BoxType = 'shop' | 'cafe' | 'walkup' | 'apartment' | 'office' | 'hotel' | 'factory' | 'gatehouse' | 'neon';

function boxType(c: AC): BoxType {
  const id = c.a.id.toLowerCase();
  const keys: [string, BoxType][] = [['cafe', 'cafe'], ['gate', 'gatehouse'], ['factory', 'factory'], ['neon', 'neon'],
    ['hotel', 'hotel'], ['office', 'office'], ['walkup', 'walkup'], ['apart', 'apartment'], ['shop', 'shop']];
  for (const [k, t] of keys) if (id.includes(k)) {
    if (c.st.night && (t === 'office' || t === 'hotel')) return 'neon';
    if (c.st.snow && (t === 'office' || t === 'hotel' || t === 'walkup' || t === 'apartment')) return 'factory';
    return t;
  }
  if (c.st.snow) return c.a.tier <= 1 ? 'gatehouse' : 'factory';
  if (c.st.night) return c.a.tier <= 1 ? 'shop' : 'neon';
  if (c.a.tier <= 1) return 'shop';
  if (c.a.tier === 2) return c.a.body === 'bodyB' ? 'walkup' : 'apartment';
  return c.a.body === 'bodyC' ? 'office' : 'hotel';
}

function archBox(c: AC): Pieces {
  const t = boxType(c);
  const e = 0.5 - c.ins;
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const upK = t === 'office' ? K.CURTAIN : t === 'factory' ? K.MULTI : K.PUNCH;
  const hw = e * c.fmid;           // face half-width in metres (typical)
  const plinth = mix(c.trim, c.st.ink, 0.25);

  // ── base storey ──
  if (t === 'shop' || t === 'cafe' || t === 'gatehouse') {
    walls(base, -e, e, -e, e, 0, 1, c.body, { x: K.PUNCH, X: t === 'gatehouse' ? K.PUNCH : K.SHOP, z: K.PUNCH, Z: K.SHOP });
  } else if (t === 'factory') {
    walls(base, -e, e, -e, e, 0, 1, c.body, { x: K.MULTI, X: K.MULTI, z: K.MULTI, Z: K.CORR });
  } else if (t === 'walkup' || t === 'apartment') {
    walls(base, -e, e, -e, e, 0, 1, c.body, { x: K.PUNCH, X: t === 'walkup' ? K.SHOP : K.PUNCH, z: K.PUNCH, Z: K.PUNCH });
  } else {
    walls(base, -e, e, -e, e, 0, 1, c.body, allK(K.SHOP));
  }
  // plinth band
  base.box(-e - 0.08 * c.mx, 0, -e - 0.08 * c.mx, e + 0.08 * c.mx, 0.32 * c.my, e + 0.08 * c.mx, plinth, plinth, 'y');
  // string course / flat-roof cornice at the top of the base storey
  cornice(base, c, e, 1 - 0.34 * c.my, 1, 0.3, c.trim, c.roof);

  const faceW = 2 * hw;
  if (t === 'shop' || t === 'cafe') {
    const stripeA = c.st.night ? mix(c.sign, c.st.ink, 0.35) : c.st.snow ? lin('#f0f2f4') : WHITE;
    const stripeB = t === 'cafe' ? (c.st.day ? lin(c.pal.foliageB) : c.signB) : c.sign;
    const glowEdge = c.st.neon ? c.signB : null;
    const aY = c.fh * 0.66;
    onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
      if (!c.st.snow) awning(base, c, 0, faceW * 0.86, aY + 0.35, 1.1, 0.5, stripeA, stripeB, Math.round(faceW * 0.86 / 0.9), glowEdge);
      else base.box(-faceW * 0.43, aY, 0, faceW * 0.43, aY + 0.18, 1.1, c.trim, c.trim, '');
      if (c.a.signage) signBoard(base, c, 0, faceW * 0.62, aY + 0.5, Math.min(c.fh - 0.4, aY + 1.2), c.sign, c.st.night ? c.signB : lin('#fbf5e8'), c.st.night, hashStr(c.a.id));
    }));
    onFace(base, 'X', () => mpart(base, c, 0, 0, e, 0, () => {
      if (t === 'cafe' && !c.st.snow) awning(base, c, 0, faceW * 0.8, aY + 0.35, 1.05, 0.45, stripeA, stripeB, Math.round(faceW * 0.8 / 0.9), glowEdge);
      else shutter(base, c, 'X', faceW * 0.18, Math.min(3.2, faceW * 0.3), aY * 0.72, mix(c.metal, WHITE, 0.25));
    }));
  } else if (t === 'gatehouse') {
    onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
      base.box(-1.2, 0, 0, 1.2, 2.3, 0.06, c.dark, c.dark, 'y');
      base.box(-faceW * 0.45, c.fh * 0.7, 0, faceW * 0.45, c.fh * 0.7 + 0.18, 0.85, c.trim, c.trim, '');
      if (c.a.signage) signBoard(base, c, 0, faceW * 0.6, c.fh * 0.72 + 0.2, Math.min(c.fh - 0.3, c.fh * 0.72 + 0.95), c.sign, lin('#2b2f36'), false, hashStr(c.a.id));
    }));
    onFace(base, 'X', () => mpart(base, c, 0, 0, e, 0, () => shutter(base, c, 'X', 0, Math.min(3.6, faceW * 0.5), c.fh * 0.62, mix(c.metal, WHITE, 0.2))));
  } else if (t === 'factory') {
    onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
      const dw = Math.min(4.2, faceW * 0.3);
      shutter(base, c, 'Z', -faceW * 0.22, dw, Math.min(c.fh * 0.78, 4.2), mix(c.metal, WHITE, 0.15));
      shutter(base, c, 'Z', faceW * 0.22, dw, Math.min(c.fh * 0.78, 4.2), mix(c.metal, WHITE, 0.15));
      for (const bx of [-faceW * 0.22 - dw * 0.4, -faceW * 0.22 + dw * 0.4, faceW * 0.22 - dw * 0.4, faceW * 0.22 + dw * 0.4]) base.box(bx - 0.15, 0.6, 0, bx + 0.15, 1.1, 0.35, c.st.ink, c.st.ink, 'y');
      if (c.a.signage) signBoard(base, c, 0, faceW * 0.5, c.fh * 0.86, c.fh * 0.86 + 0.01 + Math.min(0.9, c.fh * 0.12), c.sign, lin('#2b2f36'), false, hashStr(c.a.id));
    }));
  } else if (t === 'walkup' || t === 'apartment') {
    onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
      base.box(-0.9, 0, 0, 0.9, 2.5, 0.08, c.dark, c.dark, 'y');                 // door
      base.box(-1.4, 2.7, 0, 1.4, 2.88, 1.2, c.trim, c.trim, '');                // canopy
      base.box(-1.2, 0, 0, 1.2, 0.18, 0.9, c.concrete, c.concrete, 'y');         // stoop
      base.box(-1.2, 0, 0.9, 1.2, 0.09, 1.3, c.concrete, c.concrete, 'y');
    }));
    if (t === 'walkup') onFace(base, 'X', () => mpart(base, c, 0, 0, e, 0, () => {
      awning(base, c, 0, faceW * 0.7, c.fh * 0.7, 1.0, 0.45, WHITE, c.sign, Math.round(faceW * 0.7 / 0.9), null);
    }));
  } else {
    // office / hotel / neon lobby: canopy + corner piers
    onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
      base.box(-faceW * 0.25, c.fh * 0.72, 0, faceW * 0.25, c.fh * 0.72 + 0.25, 1.4, c.trim, c.trim, '');
      if (c.st.neon) { base.kind(K.GLOW); base.box(-faceW * 0.25, c.fh * 0.72 - 0.08, 1.4, faceW * 0.25, c.fh * 0.72, 1.46, c.sign, c.sign, 'y'); base.plain(); }
      if (c.a.signage && t === 'hotel') signBoard(base, c, 0, faceW * 0.4, c.fh * 0.72 + 0.3, c.fh * 0.72 + 0.95, c.signB, lin('#3a2a2a'), false, hashStr(c.a.id));
    }));
  }

  // a one-storey shop is its own roof: rooftop kit on the base slab (it sits inside the storey
  // above, unseen, whenever there is one)
  if (t === 'shop' || t === 'cafe' || t === 'gatehouse') {
    acUnit(base, c, -e * 0.35, 1, -e * 0.3, 0);
    mpart(base, c, e * 0.3, 1, -e * 0.35, 0, () => base.cbox(0, 0, 0, 0.6, 0.35, 0.6, c.metal, mix(c.metal, WHITE, 0.2)));
  }

  // ── storey walls for floor + roof ──
  for (const mb of [floor, roof]) walls(mb, -e, e, -e, e, 0, 1, c.body, allK(upK));

  // per-type storey dressing (floor AND roof so vertical features run continuously)
  const pier = t === 'office' ? mix(c.trim, WHITE, 0.15) : t === 'factory' ? mul(c.body, 0.82) : c.trim;
  for (const mb of [base, floor, roof]) {
    const isBase = mb === base;
    if (t === 'office' || t === 'neon' || t === 'factory') {
      const pw = (t === 'factory' ? 0.7 : 0.55) * c.mx;
      const pr = 0.18 * c.mx;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        mb.box(sx > 0 ? e - pw : -e - pr, 0, sz > 0 ? e - pw : -e - pr, sx > 0 ? e + pr : -e + pw, 1, sz > 0 ? e + pr : -e + pw, pier, pier, 'yY');
      }
    }
    if (t === 'neon' && !isBase) {
      mb.kind(K.GLOW);
      const g = 0.12 * c.mx, o = e + 0.2 * c.mx;
      mb.box(o - g, 0, o - g, o + g * 0.2, 1, o + g * 0.2, c.sign, c.sign, 'yY');
      mb.box(o - g, 0, -o - g * 0.2, o + g * 0.2, 1, -o + g, c.signB, c.signB, 'yY');
      mb.box(-o - g * 0.2, 0, o - g, -o + g, 1, o + g * 0.2, c.signB, c.signB, 'yY');
      mb.plain();
    }
    if (t === 'factory' && !isBase) {
      // brick pilasters between window bays on the visible faces
      for (const f of ['Z', 'X'] as Face[]) onFace(mb, f, () => mpart(mb, c, 0, 0, e, 0, () => {
        const n = Math.max(1, Math.round(faceW / 3.6));
        for (let i = 1; i < n; i++) { const x = -faceW / 2 + (faceW * i) / n; mb.box(x - 0.22, 0, 0, x + 0.22, c.fh, 0.2, mul(c.body, 0.86), mul(c.body, 0.86), 'yY'); }
      }));
    }
    if (t === 'hotel' && c.a.signage && !isBase) {
      // vertical blade sign on the +X face near the +Z corner
      onFace(mb, 'X', () => mpart(mb, c, 0, 0, e, 0, () => {
        const x = faceW / 2 - 2.2;
        mb.box(x - 0.14, 0, 0, x + 0.14, c.fh, 1.35, c.sign, c.sign, 'yY');
        mb.kind(c.st.day ? K.PLAIN : K.GLOW);
        mb.box(x - 0.2, c.fh * 0.22, 0.25, x + 0.2, c.fh * 0.78, 1.45, c.signB, c.signB, 'yY');
        mb.plain();
      }));
    }
    if (t === 'walkup' && !isBase) {
      // fire escape stack on the +X face (platform + railing + stair per storey)
      onFace(mb, 'X', () => mpart(mb, c, 0, 0, e, 0, () => {
        const iron = c.st.snow ? lin('#3a3f46') : mix(c.trim, c.st.ink, 0.45);
        const x0 = -faceW * 0.3, x1 = faceW * 0.12;
        mb.box(x0, 0.05, 0, x1, 0.16, 0.95, mix(iron, WHITE, 0.12), mix(iron, WHITE, 0.2), '');
        mb.box(x0, 1.0, 0.89, x1, 1.07, 0.96, iron, iron, '');
        for (const px of [x0, (x0 + x1) / 2, x1]) mb.box(px - 0.04, 0.16, 0.89, px + 0.04, 1.0, 0.96, iron, iron, 'yY');
        mb.beam([x0 + 0.5, 0.22, 0.48], [x1 - 0.5, c.fh - 0.08, 0.48], 0.1, iron, true);
      }));
    }
    if (t === 'apartment' && !isBase) {
      onFace(mb, 'Z', () => mpart(mb, c, 0, 0, e, 0, () => {
        const rail = c.st.day ? mix(c.trim, WHITE, 0.3) : c.trim;
        for (const bx of [-faceW * 0.26, faceW * 0.26]) {
          mb.box(bx - 1.6, 0, 0, bx + 1.6, 0.18, 1.0, c.concrete, c.concrete, '');
          mb.box(bx - 1.6, 0.18, 1.1, bx + 1.6, 1.05, 1.2, rail, rail, 'y');
          mb.box(bx - 1.6, 0.18, 0, bx - 1.5, 1.05, 1.1, rail, rail, 'yZ');
          mb.box(bx + 1.5, 0.18, 0, bx + 1.6, 1.05, 1.1, rail, rail, 'yZ');
        }
      }));
    }
  }

  // ── roof cap + rooftop kit ──
  const capH = t === 'walkup' || t === 'apartment' ? 0.75 : 0.45;
  const capProj = t === 'walkup' || t === 'apartment' ? 0.55 : 0.28;
  cornice(roof, c, e, 1, 1 + capH * c.my, capProj, t === 'office' ? mix(c.trim, WHITE, 0.15) : c.trim, c.roof);
  const yTop = 1 + capH * c.my;
  const o = Math.min(0.5, e + capProj * c.mx);
  parapet(roof, c, o, yTop, t === 'office' || t === 'neon' ? 1.1 : 0.6, 0.35, t === 'factory' ? mul(c.body, 0.9) : c.trim);
  if (t === 'neon') {
    roof.kind(K.GLOW);
    const g = 0.1 * c.my;
    roof.box(-o, yTop + 1.1 * c.my, o - 0.12 * c.mx, o, yTop + 1.1 * c.my + g, o + 0.001, c.sign, c.sign, 'y');
    roof.box(o - 0.12 * c.mx, yTop + 1.1 * c.my, -o, o + 0.001, yTop + 1.1 * c.my + g, o, c.signB, c.signB, 'y');
    roof.plain();
  }
  const r = mulberry32(hashStr(c.a.id + c.b.id + 'kit'));
  const u = (m: number) => m * c.mx;
  switch (t) {
    case 'shop': case 'cafe': case 'gatehouse':
      acUnit(roof, c, -e * 0.35, yTop, -e * 0.3, 0);
      if (c.fmid > 11) acUnit(roof, c, e * 0.35, yTop, -e * 0.45, Math.PI / 2);
      break;
    case 'walkup':
      waterTank(roof, c, -e * 0.4, yTop, -e * 0.35);
      bulkhead(roof, c, e * 0.35, yTop, -e * 0.4, 3.2, 2.6, 2.8);
      antenna(roof, c, e * 0.4, yTop, e * 0.35, 3.2);
      break;
    case 'apartment':
      bulkhead(roof, c, -e * 0.3, yTop, -e * 0.35, 4, 3, 3);
      acUnit(roof, c, e * 0.35, yTop, -e * 0.2, 0);
      acUnit(roof, c, e * 0.35, yTop, e * 0.25, 0);
      if (c.st.day) waterTank(roof, c, -e * 0.45, yTop, e * 0.3);
      break;
    case 'office': case 'hotel': case 'neon': {
      // setback penthouse with a glazed band
      const px = e * 0.55, pz = e * 0.5, ph = 3.4 * c.my;
      roof.box(-px - u(1), yTop, -pz - u(1), px - u(1), yTop + ph, pz - u(1), mix(c.body, c.trim, 0.2), c.roof, 'y');
      roof.box(-px - u(1) - 0.001, yTop + ph * 0.35, -pz - u(1) - 0.001, px - u(1) + 0.001, yTop + ph * 0.8, pz - u(1) + 0.001, c.glassD, c.glassD, 'yY');
      if (c.st.night) {
        roof.kind(K.GLOW);
        roof.box(-px - u(1) - 0.002, yTop + ph * 0.45, pz - u(1), px - u(1) + 0.002, yTop + ph * 0.7, pz - u(1) + 0.004, mul(c.lit, 0.6), mul(c.lit, 0.6), 'yY');
        roof.plain();
      }
      acUnit(roof, c, e * 0.6, yTop, -e * 0.55, 0);
      acUnit(roof, c, -e * 0.6, yTop, e * 0.55, Math.PI / 2);
      antenna(roof, c, -u(1), yTop + ph, -u(1), t === 'office' ? 9 : 6);
      if (c.a.signage && t !== 'office') {
        // rooftop billboard on a frame, facing the +X+Z camera side
        mpart(roof, c, e * 0.2, yTop, e * 0.55, Math.PI / 4, () => {
          const bw = Math.min(12, c.fmid * 0.55), bh = 3.2;
          for (const lx of [-bw * 0.35, bw * 0.35]) roof.box(lx - 0.12, 0, -0.12, lx + 0.12, 2.2, 0.12, c.metal, c.metal, 'y');
          roof.box(-bw / 2, 2.2, -0.2, bw / 2, 2.2 + bh, 0.1, c.trim, c.trim, 'y');
          roof.kind(c.st.night ? K.GLOW : K.PLAIN);
          roof.box(-bw / 2 + 0.3, 2.5, 0.1, bw / 2 - 0.3, 2.2 + bh - 0.3, 0.16, t === 'neon' ? c.sign : c.signB, c.signB, 'y');
          roof.plain();
          signBoard(roof, c, 0, bw * 0.7, 3.0, 2.2 + bh - 0.7, t === 'neon' ? c.sign : c.signB, c.st.night ? c.signB : lin('#3a2a2a'), c.st.night, hashStr(c.a.id + 'bb'));
        });
      }
      break;
    }
    case 'factory': {
      // raised monitor skylight + vent stacks
      const mw = e * 0.7, md = e * 0.18, mh = 1.6 * c.my;
      roof.box(-mw, yTop, -md, mw, yTop + mh, md, mul(c.body, 0.9), c.roof, 'y');
      roof.box(-mw - 0.001, yTop + mh * 0.25, -md - 0.001, mw + 0.001, yTop + mh * 0.8, md + 0.001, c.glassD, c.glassD, 'yY');
      for (const [vx, vz] of [[e * 0.5, e * 0.55], [-e * 0.55, e * 0.5], [e * 0.6, -e * 0.55]]) {
        mpart(roof, c, vx, yTop, vz, 0, () => roof.prism(0, 0, 0, 3 + r() * 2, 0.45, 0.4, 8, c.metal, c.dark));
      }
      break;
    }
  }
  return { base, floor, roof };
}

function archPodium(c: AC): Pieces {
  const e = 0.5 - c.ins;
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  // tower footprint, offset toward −X−Z so the terrace faces the camera side
  const tx0 = -0.42, tx1 = 0.18, tz0 = -0.42, tz1 = 0.18;
  const faceW = 2 * e * c.fmid;
  const fin = mix(c.trim, WHITE, 0.2);

  // ── podium storey ──
  walls(base, -e, e, -e, e, 0, 1, c.body, allK(K.SHOP));
  base.box(-e - 0.08 * c.mx, 0, -e - 0.08 * c.mx, e + 0.08 * c.mx, 0.32 * c.my, e + 0.08 * c.mx, mix(c.trim, c.st.ink, 0.25), undefined, 'y');
  cornice(base, c, e, 1 - 0.4 * c.my, 1, 0.35, c.trim, c.st.day ? lin('#e3d6c2') : c.roof);
  const o = Math.min(0.5, e + 0.35 * c.mx);
  parapet(base, c, o, 1, 1.0, 0.3, c.st.day ? mix(c.trim, WHITE, 0.3) : c.trim);
  onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
    base.box(-faceW * 0.3, c.fh * 0.7, 0, faceW * 0.3, c.fh * 0.7 + 0.3, 1.8, c.trim, c.trim, '');
    if (c.st.neon) { base.kind(K.GLOW); base.box(-faceW * 0.3, c.fh * 0.7 - 0.08, 1.8, faceW * 0.3, c.fh * 0.7, 1.88, c.signB, c.signB, 'y'); base.plain(); }
    if (c.a.signage) signBoard(base, c, faceW * 0.1, faceW * 0.34, c.fh * 0.7 + 0.35, c.fh * 0.7 + 1.1, c.st.night ? c.sign : c.sign, c.st.night ? c.signB : lin('#fbf5e8'), c.st.night, hashStr(c.a.id + 'p'));
  }));
  // terrace dressing on the podium roof (the +X+Z L around the tower)
  const yT = 1;
  if (c.st.day) {
    const planter = mix(c.trim, WHITE, 0.2);
    const spots: [number, number][] = [[0.33, 0.33], [0.33, -0.2]];
    for (const [x, z] of spots) {
      mpart(base, c, x, yT, z, 0, () => {
        base.box(-1.3, 0, -1.3, 1.3, 0.7, 1.3, planter, lin('#6d8f4e'), 'y');
        base.withM(trs(0, 0.7, 0), () => treeParts(base, c.st, c.pal, 0.95, true));
      });
    }
    mpart(base, c, 0.3, yT, 0.05, 0, () => { base.box(-1.1, 0, -0.35, 1.1, 0.45, 0.35, lin('#b5835a'), lin('#c79468'), 'y'); });
  } else if (c.st.night) {
    base.kind(K.GLOW);
    base.box(-o, yT + 1.0 * c.my, o - 0.1 * c.mx, o, yT + 1.12 * c.my, o + 0.001, c.sign, c.sign, 'y');
    base.box(o - 0.1 * c.mx, yT + 1.0 * c.my, -o, o + 0.001, yT + 1.12 * c.my, o, c.sign, c.sign, 'y');
    base.plain();
    acUnit(base, c, 0.33, yT, 0.33, 0);
  } else {
    acUnit(base, c, 0.33, yT, 0.3, 0);
    acUnit(base, c, 0.3, yT, -0.25, Math.PI / 2);
  }

  // ── tower storeys ──
  const finW = 0.5 * c.mx, finP = 0.35 * c.mx;
  for (const mb of [floor, roof]) {
    walls(mb, tx0, tx1, tz0, tz1, 0, 1, c.body, allK(K.CURTAIN));
    for (const [x, z] of [[tx1, tz1], [tx1, tz0], [tx0, tz1]]) {
      mb.box(x - finW, 0, z - finW, x + finP, 1, z + finP, fin, fin, 'yY');
    }
    if (c.st.neon) {
      mb.kind(K.GLOW);
      mb.box(tx1 + finP, 0, tz1 - finW * 0.4, tx1 + finP + 0.08 * c.mx, 1, tz1 + finW * 0.4, c.signB, c.signB, 'yY');
      mb.plain();
    }
  }
  // crown: stepped setbacks + spire + aviation light
  const cx = (tx0 + tx1) / 2, cz = (tz0 + tz1) / 2;
  const hx = (tx1 - tx0) / 2, hz = (tz1 - tz0) / 2;
  const s1 = 3.2 * c.my, s2 = 2.8 * c.my;
  const crownC = c.st.day ? mix(c.trim, c.signB, 0.25) : c.trim;
  roof.box(cx - hx - finP, 1, cz - hz - finP, cx + hx + finP, 1 + 0.5 * c.my, cz + hz + finP, crownC, c.roof, 'y');
  roof.box(cx - hx * 0.82, 1 + 0.5 * c.my, cz - hz * 0.82, cx + hx * 0.82, 1 + 0.5 * c.my + s1, cz + hz * 0.82, mix(c.body, c.trim, 0.3), c.roof, 'y');
  roof.box(cx - hx * 0.82 - 0.001, 1 + 0.5 * c.my + s1 * 0.3, cz - hz * 0.82 - 0.001, cx + hx * 0.82 + 0.001, 1 + 0.5 * c.my + s1 * 0.8, cz + hz * 0.82 + 0.001, c.glassD, c.glassD, 'yY');
  const y2 = 1 + 0.5 * c.my + s1;
  roof.box(cx - hx * 0.55, y2, cz - hz * 0.55, cx + hx * 0.55, y2 + s2, cz + hz * 0.55, crownC, c.roof, 'y');
  if (c.st.neon) {
    roof.kind(K.GLOW);
    roof.box(cx - hx * 0.82 - 0.004, y2 - 0.35 * c.my, cz - hz * 0.82 - 0.004, cx + hx * 0.82 + 0.004, y2 - 0.12 * c.my, cz + hz * 0.82 + 0.004, c.sign, c.sign, 'yY');
    roof.plain();
  }
  const y3 = y2 + s2;
  mpart(roof, c, cx, y3, cz, 0, () => {
    roof.prism(0, 0, 0, 16, 0.55, 0.08, 6, c.metal, null);
    roof.cbox(0, 5, 0, 1.3, 5.25, 0.1, c.metal, c.metal, '');
    roof.kind(K.GLOW);
    roof.cbox(0, 16, 0, 0.16, 16.35, 0.16, lin('#ff5a4a'), lin('#ff5a4a'), '');
    roof.plain();
  });
  acUnit(roof, c, cx + hx * 0.75, 1 + 0.5 * c.my, cz - hz * 0.65, 0);
  return { base, floor, roof };
}

function archCylinder(c: AC): Pieces {
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const cooling = c.a.tier >= 4 || c.fmid >= 20;
  const sides = cooling ? 16 : 14;
  const R = 0.5 - c.ins * 0.6;
  const band = mix(c.trim, c.st.ink, 0.1);
  const inner = mix(c.st.ink, c.body, 0.18);
  if (!cooling) {
    // storage tank: plinth, ring bands, ladder, snowy cone roof
    base.prism(0, 0, 0, 0.45 * c.my, R + 0.35 * c.mx, R + 0.3 * c.mx, sides, c.concrete, c.concrete);
    base.kind(K.PLAIN);
    base.prism(0, 0, 0.45 * c.my, 1, R, R, sides, c.body, null);
    onFace(base, 'Z', () => mpart(base, c, 0, 0.45 * c.my, R - 0.1 * c.mx, 0, () => {
      base.box(-0.7, 0, 0, 0.7, 2.1, 0.22, c.dark, c.dark, 'y');
      base.box(-0.9, 2.1, 0, 0.9, 2.3, 0.4, band, band, 'y');
    }));
    for (const mb of [base, floor, roof]) {
      if (mb !== base) mb.prism(0, 0, 0, 1, R, R, sides, c.body, null);
      mb.prism(0, 0, mb === base ? 1 - 0.22 * c.my : 0, mb === base ? 1 : 0.22 * c.my, R + 0.12 * c.mx, R + 0.12 * c.mx, sides, band, band);
      // ladder toward the camera side
      const ang = Math.PI / 4;
      mpart(mb, c, Math.sin(ang) * (R + 0.02), 0, Math.cos(ang) * (R + 0.02), ang, () => {
        const top = mb === roof ? c.fh + 0.8 : c.fh;
        mb.box(-0.32, 0, 0.18, -0.26, top, 0.26, c.metal, c.metal, 'yY');
        mb.box(0.26, 0, 0.18, 0.32, top, 0.26, c.metal, c.metal, 'yY');
        for (let y = 0.4; y < top; y += 1.0) mb.box(-0.26, y, 0.19, 0.26, y + 0.07, 0.25, c.metal, c.metal, '');
        if (mb === roof) mb.box(-0.5, c.fh - 0.5, 0.15, 0.5, c.fh + 1.0, 0.95, c.metal, null as unknown as RGB, 'yYz');
      });
    }
    // cone roof + railing + vent
    const coneH = Math.max(0.6, R * c.fmid * 0.34) * c.my;
    roof.prism(0, 0, 1, 1 + coneH, R + 0.18 * c.mx, 0.05 * c.mx, sides, c.roof, null);
    roof.prism(0, 0, 1, 1 + 0.9 * c.my, R + 0.2 * c.mx, R + 0.2 * c.mx, sides, band, null, false, 0, false);
    mpart(roof, c, 0, 1 + coneH, 0, 0, () => { roof.prism(0, 0, -0.2, 0.9, 0.5, 0.5, 8, c.metal, c.dark); });
  } else {
    // cooling tower (hyperbolic, piecewise): V-column skirt → a base shell that flares from the
    // footprint in to the waist over the first ~3 storeys (it rises ABOVE the base storey and
    // hides the floor tubes it wraps) → straight waist storeys → a roof shell that flares back
    // out over the top ~3 storeys (it hangs BELOW the roof storey over the floors under it) →
    // rolled lip, dark throat, aviation beacons. Silhouette reads as a cooling tower at any height.
    const skirt = 0.55;
    const Rb = R, Rw = 0.35, d = 0.012, FB = 3.0, FT = 3.0;
    const shell = c.body, shellHi = mix(c.body, WHITE, 0.08);
    const nV = 7;
    for (let i = 0; i < nV; i++) {
      const a0 = (i / nV) * Math.PI * 2, a1 = ((i + 0.5) / nV) * Math.PI * 2;
      mpart(base, c, 0, 0, 0, 0, () => {
        const rr = Rb * c.fmid - 0.4;
        base.beam([Math.sin(a0) * rr, 0.3, Math.cos(a0) * rr], [Math.sin(a1) * rr, skirt * c.fh, Math.cos(a1) * rr], 0.6, c.concrete, false);
        base.beam([Math.sin(a1 + Math.PI / nV) * rr, 0.3, Math.cos(a1 + Math.PI / nV) * rr], [Math.sin(a1) * rr, skirt * c.fh, Math.cos(a1) * rr], 0.6, c.concrete, false);
      });
    }
    // plinth: concrete ring outside the columns, dark basin floor inside the skirt
    const yP = 0.18 * c.my, rP = Rb + 0.3 * c.mx, rI = Rb * 0.94;
    base.prism(0, 0, 0, yP, rP, rP, sides, c.concrete, null);
    {
      const pts: V3[] = [];
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        base.quad([Math.sin(a0) * rI, yP, Math.cos(a0) * rI], [Math.sin(a1) * rI, yP, Math.cos(a1) * rI],
          [Math.sin(a1) * rP, yP, Math.cos(a1) * rP], [Math.sin(a0) * rP, yP, Math.cos(a0) * rP], c.concrete, [0, 1, 0]);
        pts.push([Math.sin(a0) * rI, yP, Math.cos(a0) * rI]);
      }
      base.poly(pts, mul(inner, 0.85), [0, 1, 0]);
    }
    base.prism(0, 0, yP, skirt, rI, rI, sides, inner, null, false, 0, true);
    // (the flare's first ring doubles as the skirt band)
    const baseProf: [number, number][] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      baseProf.push([Rw + d + (Rb - Rw - d) * (1 - t) * (1 - t), skirt + (FB - skirt) * t]);
    }
    base.lathe(baseProf, sides, (k) => (k % 2 ? shell : shellHi));
    base.prism(0, 0, FB - 0.08, FB, Rw + d + 0.012, Rw + d + 0.012, sides, band, band);
    // waist storeys
    floor.prism(0, 0, 0, 0.08, Rw, Rw, sides, mul(c.body, 0.93), null);
    floor.prism(0, 0, 0.08, 1, Rw, Rw, sides, c.body, null);
    // crown: flare from the waist (FT storeys below) out to the lip
    const lipH = 1.2 * c.my;
    const top = 1 + lipH;
    const rTop = Math.min(0.49, Rw + 0.1);
    const rAt = (y: number) => { const t = (y + FT) / (top + FT); return Rw + d + (rTop - Rw - d) * t * t; };
    const crownProf: [number, number][] = [];
    for (let i = 0; i <= 5; i++) { const y = -FT + ((top + FT) * i) / 5; crownProf.push([rAt(y), y]); }
    roof.prism(0, 0, -FT, -FT + 0.08, Rw + d + 0.012, Rw + d + 0.012, sides, band, band);
    roof.lathe(crownProf, sides, (k) => (k % 2 ? shell : shellHi));
    // rim (annulus) + inner throat (follows the shell one storey down) + dark floor
    const wall = 0.025;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const ri = rTop - wall;
      roof.quad([Math.sin(a0) * ri, top, Math.cos(a0) * ri], [Math.sin(a1) * ri, top, Math.cos(a1) * ri],
        [Math.sin(a1) * rTop, top, Math.cos(a1) * rTop], [Math.sin(a0) * rTop, top, Math.cos(a0) * rTop], mix(c.body, WHITE, 0.15), [0, 1, 0]);
    }
    const throat: [number, number][] = [];
    for (let i = 0; i <= 2; i++) { const y = top - (top * i) / 2; throat.push([rAt(y) - wall, y]); }
    roof.lathe(throat.reverse(), sides, inner, -1);
    roof.prism(0, 0, 0, 0.0001, rAt(0) - wall, rAt(0) - wall, sides, mul(inner, 0.8), mul(inner, 0.8));
    roof.kind(K.GLOW);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
      mpart(roof, c, Math.sin(a) * (rTop - wall / 2), top, Math.cos(a) * (rTop - wall / 2), 0, () => roof.cbox(0, 0, 0, 0.35, 0.5, 0.35, lin('#ff5a4a'), lin('#ff5a4a'), 'y'));
    }
    roof.plain();
  }
  return { base, floor, roof };
}

function archDish(c: AC): Pieces {
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const e = 0.5 - c.ins;
  const he = e * 0.86;
  walls(base, -he, he, -he, he, 0, 1, c.concrete, allK(K.PUNCH));
  base.box(-he - 0.06 * c.mx, 0, -he - 0.06 * c.mx, he + 0.06 * c.mx, 0.3 * c.my, he + 0.06 * c.mx, mix(c.trim, c.st.ink, 0.2), undefined, 'y');
  cornice(base, c, he, 1 - 0.3 * c.my, 1, 0.3, c.trim, c.roof);
  onFace(base, 'Z', () => mpart(base, c, 0, 0, he, 0, () => { base.box(-0.9, 0, 0, 0.9, 2.3, 0.08, c.dark, c.dark, 'y'); }));
  acUnit(base, c, he * 0.62, 1, he * 0.55, 0);
  const pr = 0.2;
  for (const mb of [floor, roof]) {
    mb.prism(0, 0, 0, 1, pr, pr * 0.96, 8, c.body, null, false, Math.PI / 8);
    mb.prism(0, 0, 0, 0.12 * c.my + 0.02, pr + 0.04, pr + 0.04, 8, c.trim, c.trim, false, Math.PI / 8);
    mpart(mb, c, Math.sin(Math.PI / 4) * pr, 0, Math.cos(Math.PI / 4) * pr, Math.PI / 4, () => {
      mb.box(-0.3, 0, 0.1, -0.24, c.fh, 0.18, c.metal, c.metal, 'yY');
      mb.box(0.24, 0, 0.1, 0.3, c.fh, 0.18, c.metal, c.metal, 'yY');
      for (let y = 0.3; y < c.fh; y += 0.9) mb.box(-0.24, y, 0.11, 0.24, y + 0.06, 0.17, c.metal, c.metal, '');
    });
  }
  // turntable + yoke + tilted bowl + feed
  const Rb = Math.min(0.47 * c.fmid, 7.5);
  mpart(roof, c, 0, 1, 0, 0, () => {
    const inside = c.st.snow ? lin('#f3f5f7') : mix(c.roof, WHITE, 0.4);
    const back = mix(c.trim, WHITE, 0.2);
    roof.prism(0, 0, 0, 0.9, pr * c.fmid + 0.6, pr * c.fmid + 0.4, 10, c.trim, c.metal);
    roof.cbox(0, 0.9, 0, 1.6, 1.6, 1.2, mix(c.trim, WHITE, 0.1), c.metal);
    for (const s of [-1, 1]) roof.beam([s * 1.2, 1.4, 0], [s * 1.2, 2.9, 0.3], 0.4, c.metal, true);
    roof.withM(trs(0, 3.0, 0, 1, 1, 1, Math.PI / 4, 0.72), () => {
      const k = 0.3 / Rb;
      const prof: [number, number][] = [];
      for (let i = 0; i <= 4; i++) { const rr = (i / 4) * Rb; prof.push([rr, k * rr * rr]); }
      roof.lathe(prof, 12, inside, -1);
      const back2: [number, number][] = prof.map(([rr, y]) => [rr, y - 0.22] as [number, number]);
      roof.lathe(back2, 12, back, 1);
      // rim ring
      roof.lathe([[Rb, k * Rb * Rb - 0.22], [Rb + 0.15, k * Rb * Rb + 0.05]], 12, back, 1);
      // feed struts + horn
      const fy = Rb * 0.95;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        roof.beam([Math.sin(a) * Rb * 0.8, k * Rb * Rb * 0.64, Math.cos(a) * Rb * 0.8], [0, fy, 0], 0.12, c.metal);
      }
      roof.prism(0, 0, fy - 0.2, fy + 0.7, 0.35, 0.22, 6, c.metal, c.dark);
      roof.cbox(0, -1.2, -0.9, 0.7, -0.2, 0.5, c.metal, c.metal, '');
    });
  });
  return { base, floor, roof };
}

function archChimney(c: AC): Pieces {
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const e = 0.5 - c.ins;
  const R = 0.34;
  const brick = c.body;
  const stone = mix(c.concrete, c.trim, 0.3);
  walls(base, -e, e, -e, e, 0, 1, mul(brick, 0.92), allK(K.PLAIN));
  base.box(-e - 0.1 * c.mx, 0, -e - 0.1 * c.mx, e + 0.1 * c.mx, 0.35 * c.my, e + 0.1 * c.mx, stone, undefined, 'y');
  cornice(base, c, e, 1 - 0.3 * c.my, 1, 0.3, stone, stone);
  onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
    base.box(-0.55, 0, 0, 0.55, 1.6, 0.12, c.dark, c.dark, 'y');
    base.prism(0, 0.12, 1.6, 1.61, 0.55, 0.55, 6, c.dark, c.dark);
  }));
  base.prism(0, 0, 1, 1.0001, R, R, 8, brick, mul(brick, 0.8), false, Math.PI / 8);
  const bandC = mix(c.trim, c.st.ink, 0.1);
  floor.prism(0, 0, 0, 1, R, R, 8, brick, null, false, Math.PI / 8);
  floor.prism(0, 0, 0, 0.15 * c.my, R + 0.1 * c.mx, R + 0.1 * c.mx, 8, bandC, bandC, false, Math.PI / 8);
  // roof: stripes near the top, flared cap, dark flue, ladder, aviation lamp
  const red = c.signB, white = lin(c.pal.roofA);
  const segs: [number, number, RGB][] = [[0, 0.25, brick], [0.25, 0.5, red], [0.5, 0.75, white], [0.75, 1, red]];
  for (const [y0, y1, col] of segs) roof.prism(0, 0, y0, y1, R, R, 8, col, null, false, Math.PI / 8);
  const lip = 0.35 * c.my;
  roof.prism(0, 0, 1, 1 + lip, R + 0.12 * c.mx, R + 0.16 * c.mx, 8, bandC, null, false, Math.PI / 8);
  const rOut = R + 0.16 * c.mx, rIn = R * 0.72;
  for (let i = 0; i < 8; i++) {
    const a0 = Math.PI / 8 + (i / 8) * Math.PI * 2, a1 = Math.PI / 8 + ((i + 1) / 8) * Math.PI * 2, y = 1 + lip;
    roof.quad([Math.sin(a0) * rIn, y, Math.cos(a0) * rIn], [Math.sin(a1) * rIn, y, Math.cos(a1) * rIn],
      [Math.sin(a1) * rOut, y, Math.cos(a1) * rOut], [Math.sin(a0) * rOut, y, Math.cos(a0) * rOut], bandC, [0, 1, 0]);
  }
  roof.prism(0, 0, 0.4, 1 + lip, rIn, rIn, 8, c.st.ink, null, false, Math.PI / 8, true);
  roof.prism(0, 0, 0.4, 0.4, rIn, rIn, 8, c.st.ink, c.st.ink, false, Math.PI / 8);
  roof.kind(K.GLOW);
  mpart(roof, c, Math.sin(Math.PI / 4) * rOut, 1 + lip, Math.cos(Math.PI / 4) * rOut, 0, () => roof.cbox(0, 0, 0, 0.22, 0.4, 0.22, lin('#ff5a4a'), lin('#ff5a4a'), 'y'));
  roof.plain();
  for (const mb of [floor, roof]) {
    mpart(mb, c, Math.sin(Math.PI / 4) * R, 0, Math.cos(Math.PI / 4) * R, Math.PI / 4, () => {
      mb.box(-0.28, 0, 0.12, -0.22, c.fh, 0.2, c.metal, c.metal, 'yY');
      mb.box(0.22, 0, 0.12, 0.28, c.fh, 0.2, c.metal, c.metal, 'yY');
      for (let y = 0.3; y < c.fh; y += 0.9) mb.box(-0.22, y, 0.13, 0.22, y + 0.06, 0.19, c.metal, c.metal, '');
    });
  }
  return { base, floor, roof };
}

/** One layer of two shipping containers running along Z (unit space, y0..y1). */
function containerLayer(mb: MB, c: AC, y0: number, y1: number): void {
  const g = 0.1 * c.mx;
  const post = mix(c.st.ink, c.trim, 0.4);
  const pw = 0.16 * c.mx;
  for (let s = 0; s < 2; s++) {
    const x0 = s === 0 ? -0.5 + g : g, x1 = s === 0 ? -g : 0.5 - g;
    const z0 = -0.5 + g, z1 = 0.5 - g;
    // corrugated sides (axis Z), door ends (axis X), roof (no axis)
    mb.kind(K.CONT + TINT, 1, s);
    mb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], PAINT_BASE, [1, 0, 0], 0.02);
    mb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], PAINT_BASE, [-1, 0, 0], 0.02);
    mb.kind(K.CONT + TINT, 0, s);
    mb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], mul(PAINT_BASE, 0.97), [0, 0, 1], 0.02);
    mb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], mul(PAINT_BASE, 0.97), [0, 0, -1], 0.02);
    mb.kind(K.CONT + TINT, 1, s);
    const yr = y1 - 0.002;
    mb.quad([x0, yr, z1], [x1, yr, z1], [x1, yr, z0], [x0, yr, z0], mul(PAINT_BASE, 1.02), [0, 1, 0], 0.02);
    mb.plain();
    // corner posts (visible corners only) + top rail on the door end
    for (const [px, pz] of [[x1, z1], [x1, z0], [x0, z1]]) {
      mb.box(px - pw * 0.5, y0, pz - pw * 0.5, px + pw * 0.5, y1, pz + pw * 0.5, post, post, 'yY');
    }
    mb.box(x0, y1 - 0.12 * c.my, z1 - 0.02 * c.mx, x1, y1 - 0.001, z1 + 0.05 * c.mx, post, post, 'yz');
    mb.box(x0, y0, z1 - 0.02 * c.mx, x1, y0 + 0.12 * c.my, z1 + 0.05 * c.mx, post, post, 'yYz');
  }
}

function archContainers(c: AC): Pieces {
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const pad = 0.08;
  base.box(-0.5, 0, -0.5, 0.5, pad, 0.5, c.concrete, c.concrete, 'y');
  containerLayer(base, c, pad, 1);
  containerLayer(floor, c, 0, 1);
  containerLayer(roof, c, 0, 1);
  // lashing beacon on a corner of the top layer
  roof.kind(K.GLOW);
  mpart(roof, c, 0.5 - 0.3 * c.mx, 1, 0.5 - 0.3 * c.mx, 0, () => roof.cbox(0, 0, 0, 0.16, 0.34, 0.16, c.st.night ? lin('#ffb13b') : lin('#ff8a3a'), undefined, 'y'));
  roof.plain();
  return { base, floor, roof };
}

function archGantry(c: AC): Pieces {
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const L = 1.5 * c.mx;
  const xl = 0.5 - c.ins - L / 2, zl = 0.5 - c.ins - L / 2;
  const steel = c.body;
  const dark = mix(c.trim, c.st.ink, 0.3);
  const legs = (mb: MB, y0: number, y1: number) => {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) mb.box(sx * xl - L / 2, y0, sz * zl - L / 2, sx * xl + L / 2, y1, sz * zl + L / 2, steel, steel, 'yY');
  };
  // base: bogies on rails, sill beams
  legs(base, 1.4 * c.my, 1);
  for (const sx of [-1, 1]) {
    base.box(sx * xl - 0.08 * c.mx, 0, -0.5 + c.ins * 0.2, sx * xl + 0.08 * c.mx, 0.02, 0.5 - c.ins * 0.2, dark, dark, 'y');
    for (const sz of [-1, 1]) {
      base.box(sx * xl - L * 0.7, 0.25 * c.my, sz * zl - L * 0.9, sx * xl + L * 0.7, 1.4 * c.my, sz * zl + L * 0.9, dark, steel, 'y');
      for (const wz of [-0.8, 0.8]) mpart(base, c, sx * xl, 0, sz * zl, 0, () => base.cylX(0, 0.35, wz * 1.1, 0.35, 0.6, 8, c.st.ink, c.metal));
    }
    base.box(sx * xl - L * 0.4, 1.4 * c.my, -zl, sx * xl + L * 0.4, 2.4 * c.my, zl, steel, steel, 'y');
  }
  // floor: bare box-section legs (a real portal frame is open) with a bolted splice collar at
  // every storey joint and a caged ladder up the camera-side (+X+Z) leg
  legs(floor, 0, 1);
  const collar = mix(steel, c.st.ink, 0.25);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    floor.box(sx * xl - L * 0.62, 0, sz * zl - L * 0.62, sx * xl + L * 0.62, 0.35 * c.my, sz * zl + L * 0.62, collar, collar, 'y');
  }
  mpart(floor, c, xl + L / 2, 0, zl, Math.PI / 2, () => {
    floor.box(-0.32, 0, 0, -0.26, c.fh, 0.1, c.metal, c.metal, 'yY');
    floor.box(0.26, 0, 0, 0.32, c.fh, 0.1, c.metal, c.metal, 'yY');
    for (let y = 0.4; y < c.fh; y += 1.0) floor.box(-0.26, y, 0.01, 0.26, y + 0.07, 0.09, c.metal, c.metal, '');
  });
  // roof: portal girders, machinery house, trolley + hook, hazard stripes, beacons
  legs(roof, 0, 0.5);
  const gy0 = 0.5, gy1 = 0.5 + 1.8 * c.my;
  for (const sz of [-1, 1]) roof.box(-0.5 + c.ins * 0.3, gy0, sz * zl - L * 0.6, 0.5 - c.ins * 0.3, gy1, sz * zl + L * 0.6, steel, steel, 'y');
  for (const sx of [-1, 1]) roof.box(sx * xl - L * 0.55, gy0, -zl, sx * xl + L * 0.55, gy1 - 0.3 * c.my, zl, steel, steel, 'y');
  // portal knee braces (leg → girder) on every corner, both frame directions
  mpart(roof, c, 0, 0, 0, 0, () => {
    const X = xl * c.fmid, Z = zl * c.fmid, k = Math.min(4.5, zl * c.fmid * 0.45);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      roof.beam([sx * X, 0.12 * c.fh, sz * Z], [sx * X, gy0 * c.fh, sz * (Z - k)], 0.5, steel);
      roof.beam([sx * X, 0.12 * c.fh, sz * Z], [sx * (X - k), gy0 * c.fh, sz * Z], 0.5, steel);
    }
  });
  // hazard stripes on the visible girder faces
  mpart(roof, c, 0.5 - c.ins * 0.3, gy0, zl + L * 0.6, 0, () => {
    const black = c.st.ink, yel = lin('#f2c230');
    for (let i = 0; i < 6; i++) {
      const x0 = -i * 0.8 - 0.8, x1 = -i * 0.8;
      roof.quad([x0, 0.1, 0.02], [x1, 0.1, 0.02], [x1, 1.7, 0.02], [x0, 1.7, 0.02], i % 2 ? black : yel, [0, 0, 1], 0.01);
    }
  });
  const house = mix(c.trim, WHITE, c.st.night ? 0.1 : 0.55);
  roof.box(-0.28, gy1, -0.22, 0.12, gy1 + 3.2 * c.my, 0.22, house, c.roof, 'y');
  roof.box(-0.28 - 0.001, gy1 + 1.2 * c.my, -0.22 - 0.001, 0.12 + 0.001, gy1 + 2.4 * c.my, 0.22 + 0.001, c.st.night ? mul(c.lit, 0.7) : c.glassD, c.glassD, 'yY');
  // trolley + cable + hook block hanging through the frame
  mpart(roof, c, 0.3, gy1, 0, 0, () => {
    roof.cbox(0, 0, 0, 1.4, 1.2, zl * c.fmid + 0.6, dark, steel, 'y');
    roof.beam([0, 0, 0], [0, -c.fh * 1.6, 0], 0.12, c.st.ink);
    roof.cbox(0, -c.fh * 1.6 - 1.4, 0, 0.8, -c.fh * 1.6, 0.6, lin('#f2c230'), lin('#f2c230'), '');
  });
  roof.kind(K.GLOW);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1]]) mpart(roof, c, sx * xl, gy1, sz * zl, 0, () => roof.cbox(0, 0, 0, 0.25, 0.45, 0.25, lin('#ff5a4a'), undefined, 'y'));
  roof.plain();
  return { base, floor, roof };
}

function archShed(c: AC): Pieces {
  const base = newMB(c, 'base'), floor = newMB(c, 'floor'), roof = newMB(c, 'roof');
  const e = 0.5 - c.ins;
  const faceW = 2 * e * c.fmid;
  const wallC = c.body;
  walls(base, -e, e, -e, e, 0, 1, wallC, { x: K.CORR, X: K.STRIP, z: K.CORR, Z: K.CORR });
  base.box(-e - 0.06 * c.mx, 0, -e - 0.06 * c.mx, e + 0.06 * c.mx, 0.45 * c.my, e + 0.06 * c.mx, c.concrete, c.concrete, 'y');
  const doorC = mix(c.metal, WHITE, c.st.night ? 0.05 : 0.3);
  onFace(base, 'Z', () => mpart(base, c, 0, 0, e, 0, () => {
    const dh = Math.min(c.fh * 0.78, 4.4);
    if (c.a.tier <= 1) {
      shutter(base, c, 'Z', -faceW * 0.15, Math.min(3.4, faceW * 0.36), dh * 0.85, doorC);
      base.box(faceW * 0.22 - 0.5, 0, 0, faceW * 0.22 + 0.5, 2.1, 0.08, c.dark, c.dark, 'y');
    } else {
      const n = faceW > 18 ? 3 : 2;
      for (let i = 0; i < n; i++) shutter(base, c, 'Z', -faceW / 2 + (faceW * (i + 0.5)) / n, Math.min(4.2, faceW / n - 1.6), dh, doorC);
      for (let i = 0; i < n; i++) { const x = -faceW / 2 + (faceW * (i + 0.5)) / n; base.box(x - 1.6, 0, 0, x + 1.6, 1.1, 1.0, c.concrete, c.concrete, 'y'); }
    }
    if (c.a.signage) signBoard(base, c, 0, faceW * 0.55, Math.min(c.fh - 1.0, dh + 0.3), Math.min(c.fh - 0.2, dh + 1.1), c.st.night ? c.sign : c.sign, c.st.night ? c.signB : lin('#2b2f36'), c.st.night, hashStr(c.a.id + 's'));
  }));
  onFace(base, 'X', () => mpart(base, c, 0, 0, e, 0, () => {
    base.box(-faceW * 0.3 - 0.5, 0, 0, -faceW * 0.3 + 0.5, 2.1, 0.08, c.dark, c.dark, 'y');
    base.box(-faceW * 0.3 - 0.8, 2.3, 0, -faceW * 0.3 + 0.8, 2.45, 0.7, c.trim, c.trim, '');
  }));
  for (const mb of [floor, roof]) walls(mb, -e, e, -e, e, 0, 1, wallC, allK(K.STRIP));
  const eave = mix(c.trim, c.st.ink, 0.1);
  shedTop(roof, c, e, eave, wallC);
  // a one-storey shed is its own roof: tier-1 bases carry the same pitched top (it sits inside
  // the storey above when there is one); taller sheds close their base with a flat slab so a
  // base shown alone (n = 1, or mid-pancake) is never an open box
  if (c.a.tier <= 1) shedTop(base, c, e, eave, wallC);
  else cornice(base, c, e, 1 - 0.3 * c.my, 1, 0.2, eave, c.roof);
  return { base, floor, roof };
}

/** Shed top above a storey (unit y = 1): eave band (+ neon), then a gable (tier ≤ 1) or a sawtooth. */
function shedTop(mb: MB, c: AC, e: number, eave: RGB, wallC: RGB): void {
  // eave band
  mb.box(-e - 0.2 * c.mx, 1 - 0.3 * c.my, -e - 0.2 * c.mx, e + 0.2 * c.mx, 1, e + 0.2 * c.mx, eave, eave, 'y');
  if (c.st.neon) {
    mb.kind(K.GLOW);
    mb.box(-e - 0.2 * c.mx, 1 - 0.42 * c.my, e + 0.2 * c.mx, e + 0.2 * c.mx, 1 - 0.3 * c.my, e + 0.26 * c.mx, c.signB, c.signB, 'y');
    mb.box(e + 0.2 * c.mx, 1 - 0.42 * c.my, -e - 0.2 * c.mx, e + 0.26 * c.mx, 1 - 0.3 * c.my, e + 0.2 * c.mx, c.sign, c.sign, 'y');
    mb.plain();
  }
  const o = e + 0.25 * c.mx;
  if (c.a.tier <= 1) {
    // pitched gable roof, ridge along X
    const rh = Math.min(3, c.fmid * 0.22) * c.my;
    const ridge = 1 + rh;
    mb.kind(K.CORR + TINT, 0, 0, 2 * o);
    mb.quad([-o, 1, o], [o, 1, o], [o, ridge, 0], [-o, ridge, 0], c.roof, [0, 1, 1]);
    mb.quad([o, 1, -o], [-o, 1, -o], [-o, ridge, 0], [o, ridge, 0], mul(c.roof, 0.96), [0, 1, -1]);
    mb.plain();
    mb.tri([e, 1, -e], [e, 1, e], [e, ridge, 0], wallC, [1, 0, 0]);
    mb.tri([-e, 1, e], [-e, 1, -e], [-e, ridge, 0], wallC, [-1, 0, 0]);
    mb.box(-o, ridge - 0.05 * c.my, -0.12 * c.mx, o, ridge + 0.2 * c.my, 0.12 * c.mx, eave, eave, 'y');
    if (c.st.night && c.a.signage) {
      mpart(mb, c, 0, 1, o * 0.5, 0, () => signBoard(mb, c, 0, c.fmid * 0.45, rh * c.fh * 0.35, rh * c.fh * 0.35 + 0.9, c.sign, c.signB, true, hashStr(c.a.id + 'r')));
    }
  } else {
    // sawtooth: teeth ridges run along Z, glazed steep faces look toward +X
    const nT = Math.max(2, Math.min(5, Math.round(c.fmid / 7)));
    const th = 2.4 * c.my;
    const glazing = c.st.night ? mul(c.lit, 0.55) : c.glassD;
    for (let i = 0; i < nT; i++) {
      const xa = -o + (2 * o * i) / nT, xb = -o + (2 * o * (i + 1)) / nT;
      mb.kind(K.CORR + TINT, 1, 0, 2 * o);
      mb.quad([xa, 1, o], [xb, 1 + th, o], [xb, 1 + th, -o], [xa, 1, -o], c.roof, [-th, xb - xa, 0]);
      mb.plain();
      if (c.st.night) mb.kind(K.GLOW);
      mb.quad([xb, 1, -o], [xb, 1 + th, -o], [xb, 1 + th, o], [xb, 1, o], glazing, [1, 0, 0]);
      mb.plain();
      mb.tri([xa, 1, o], [xb, 1, o], [xb, 1 + th, o], wallC, [0, 0, 1]);
      mb.tri([xb, 1, -o], [xa, 1, -o], [xb, 1 + th, -o], wallC, [0, 0, -1]);
    }
    mb.quad([-o, 1, -o], [-o, 1, o], [-o, 1 + 0.001, o], [-o, 1 + 0.001, -o], wallC, [-1, 0, 0]);
    mpart(mb, c, -o * 0.4, 1 + th * 0.5, o * 0.6, 0, () => mb.prism(0, 0, 0, 1.4, 0.4, 0.4, 6, c.metal, c.dark));
  }
}

function buildArch(a: BuildingArchetype, b: BiomeDef, st: Style): { base: THREE.BufferGeometry; floor: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  const c = archCtx(a, b, st);
  let p: Pieces;
  switch (a.shape) {
    case 'box': p = archBox(c); break;
    case 'podium': p = archPodium(c); break;
    case 'cylinder': p = archCylinder(c); break;
    case 'dish': p = archDish(c); break;
    case 'chimney': p = archChimney(c); break;
    case 'containers': p = archContainers(c); break;
    case 'gantry': p = archGantry(c); break;
    case 'shed': p = archShed(c); break;
    default: p = archBox(c); break;
  }
  return { base: p.base.build(), floor: p.floor.build(), roof: p.roof.build() };
}

// ─────────────────────────────── props (metres, facing +Z) ───────────────────────────────
interface PC {
  st: Style; pal: BiomePalette;
  tyre: RGB; rim: RGB; glassD: RGB; head: RGB; tail: RGB; bumper: RGB; dark: RGB;
  pole: RGB; wood: RGB; metal: RGB; concrete: RGB; sign: RGB; signB: RGB; lit: RGB; cream: RGB;
}

function propCtx(b: BiomeDef, st: Style): PC {
  const p = b.palette;
  return {
    st, pal: p,
    tyre: lin('#26232b'), rim: lin('#9aa0a6'),
    glassD: mix(lin(p.glass), st.ink, st.night ? 0.2 : 0.4),
    head: lin('#fff1c4'), tail: lin('#ff3b3b'),
    bumper: st.night ? lin('#4a5160') : lin('#a9aeb4'),
    dark: mix(lin(p.trimA), st.ink, 0.5),
    pole: st.snow ? lin('#3f454c') : st.night ? lin('#2c3440') : lin('#4d6f6b'),
    wood: st.snow ? lin('#7a5a44') : st.night ? lin('#5d5048') : lin('#b5835a'),
    metal: st.night ? lin('#5a6472') : lin('#8d969e'),
    concrete: st.night ? lin('#4a505c') : st.snow ? lin('#aab3bb') : lin('#cfc6b4'),
    sign: lin(p.sign), signB: lin(p.signB), lit: lin(p.glassLit),
    cream: lin('#f6efdf'),
  };
}

function newPropMB(pc: PC, kind: string): MB {
  const mb = new MB(hashStr('prop:' + kind + ':' + pc.st.id));
  mb.ms = [1, 1, 1];
  mb.snow = pc.st.snow ? pc.st.snowC : null;
  mb.jit = 0.03;
  return mb;
}

function wheels(mb: MB, pc: PC, x: number, zs: number[], r: number, w: number): void {
  for (const z of zs) for (const s of [-1, 1]) {
    mb.cylX(s * x, r, z, r, w / 2, 8, pc.tyre, pc.tyre);
    mb.cylX(s * (x + w / 2 + 0.005), r, z, r * 0.5, 0.01, 6, pc.rim, pc.rim);
  }
}

function lights(mb: MB, pc: PC, len: number, hw: number, yh: number, yt: number): void {
  mb.kind(K.GLOW);
  for (const s of [-1, 1]) {
    mb.box(s * hw - 0.2 * s - 0.14, yh, len / 2 - 0.02, s * hw - 0.2 * s + 0.14, yh + 0.14, len / 2 + 0.04, pc.head, pc.head, 'y');
    mb.box(s * hw - 0.2 * s - 0.14, yt, -len / 2 - 0.04, s * hw - 0.2 * s + 0.14, yt + 0.14, -len / 2 + 0.02, pc.tail, pc.tail, 'y');
  }
  mb.plain();
}

function propCar(pc: PC, taxi: boolean): MB {
  const mb = newPropMB(pc, taxi ? 'taxi' : 'car');
  const L = taxi ? 4.4 : 4.2, hw = 0.9;
  const paint = taxi ? lin('#ffc93c') : PAINT_BASE;
  mb.kind(taxi ? K.PLAIN : K.PAINT + TINT);
  mb.extrudeX([[-L / 2, 0.32], [L / 2, 0.32], [L / 2, 0.72], [L / 2 - 0.25, 0.86], [-L / 2 + 0.2, 0.9], [-L / 2, 0.74]], -hw, hw, paint, paint);
  // cabin: glass sides, painted roof
  const cz0 = -1.45, cz1 = taxi ? 0.95 : 1.0;
  mb.plain();
  mb.extrudeX([[cz0, 0.88], [cz1, 0.88], [cz1 - 0.55, 1.42], [cz0 + 0.4, 1.42]], -hw + 0.1, hw - 0.1, pc.glassD, [pc.glassD, pc.glassD, pc.glassD, pc.glassD]);
  mb.kind(taxi ? K.PLAIN : K.PAINT + TINT);
  mb.box(-hw + 0.08, 1.42, cz0 + 0.38, hw - 0.08, 1.49, cz1 - 0.53, paint, paint, 'y');
  for (const s of [-1, 1]) mb.box(s * (hw - 0.1) - 0.04, 0.88, -0.3, s * (hw - 0.1) + 0.04, 1.42, -0.12, paint, paint, 'yY');
  mb.plain();
  // bumpers, grille
  mb.box(-hw + 0.05, 0.3, L / 2, hw - 0.05, 0.52, L / 2 + 0.1, pc.bumper, pc.bumper, 'y');
  mb.box(-hw + 0.05, 0.3, -L / 2 - 0.1, hw - 0.05, 0.52, -L / 2, pc.bumper, pc.bumper, 'y');
  mb.box(-0.45, 0.56, L / 2 - 0.01, 0.45, 0.7, L / 2 + 0.02, pc.dark, pc.dark, 'y');
  lights(mb, pc, L, hw, 0.58, 0.6);
  wheels(mb, pc, hw - 0.12, [-L / 2 + 0.8, L / 2 - 0.8], 0.34, 0.24);
  if (taxi) {
    // checker band + roof lamp
    for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
      const z0 = -1.6 + i * 0.4, z1 = z0 + 0.2;
      mb.quad([s * (hw + 0.005), 0.66, z0], [s * (hw + 0.005), 0.66, z1], [s * (hw + 0.005), 0.78, z1], [s * (hw + 0.005), 0.78, z0], pc.st.ink, [s, 0, 0], 0.01);
    }
    mb.kind(pc.st.day ? K.PLAIN : K.GLOW);
    mb.box(-0.32, 1.49, -0.45, 0.32, 1.72, -0.05, pc.cream, pc.cream, 'y');
    mb.plain();
    mb.box(-0.34, 1.62, -0.47, 0.34, 1.66, -0.03, pc.st.ink, undefined, 'yY');
  }
  return mb;
}

function propVan(pc: PC): MB {
  const mb = newPropMB(pc, 'van');
  const L = 5.0, hw = 1.0;
  mb.kind(K.PAINT + TINT);
  mb.extrudeX([[-L / 2, 0.36], [L / 2, 0.36], [L / 2, 0.92], [L / 2 - 0.55, 1.22], [L / 2 - 1.05, 2.1], [-L / 2, 2.16]], -hw, hw, PAINT_BASE, PAINT_BASE);
  mb.plain();
  // windshield + cab side windows
  mb.quad([-hw + 0.1, 1.26, L / 2 - 0.58], [hw - 0.1, 1.26, L / 2 - 0.58], [hw - 0.1, 2.0, L / 2 - 1.03], [-hw + 0.1, 2.0, L / 2 - 1.03], pc.glassD, [0, 0.9, 0.5]);
  for (const s of [-1, 1]) {
    mb.quad([s * (hw + 0.005), 1.3, L / 2 - 1.9], [s * (hw + 0.005), 1.3, L / 2 - 0.75], [s * (hw + 0.005), 1.95, L / 2 - 1.1], [s * (hw + 0.005), 1.95, L / 2 - 1.9], pc.glassD, [s, 0, 0], 0.01);
    mb.quad([s * (hw + 0.006), 0.95, -L / 2 + 0.3], [s * (hw + 0.006), 0.95, L / 2 - 0.4], [s * (hw + 0.006), 1.08, L / 2 - 0.4], [s * (hw + 0.006), 1.08, -L / 2 + 0.3], pc.sign, [s, 0, 0], 0.01);
    mb.quad([s * (hw + 0.007), 0.45, -0.35], [s * (hw + 0.007), 0.45, -0.3], [s * (hw + 0.007), 1.95, -0.3], [s * (hw + 0.007), 1.95, -0.35], pc.dark, [s, 0, 0], 0.01);
  }
  mb.box(-hw + 0.05, 0.34, L / 2, hw - 0.05, 0.58, L / 2 + 0.1, pc.bumper, pc.bumper, 'y');
  mb.box(-hw + 0.05, 0.34, -L / 2 - 0.1, hw - 0.05, 0.58, -L / 2, pc.bumper, pc.bumper, 'y');
  mb.box(-0.02, 0.5, -L / 2 - 0.012, 0.02, 2.0, -L / 2, pc.dark, pc.dark, 'yY');
  lights(mb, pc, L, hw, 0.68, 0.75);
  wheels(mb, pc, hw - 0.14, [-L / 2 + 0.9, L / 2 - 0.9], 0.37, 0.26);
  return mb;
}

function propBus(pc: PC): MB {
  const mb = newPropMB(pc, 'bus');
  const L = 11, hw = 1.3;
  const body = pc.st.night ? lin(pc.pal.bodyB) : pc.st.snow ? lin('#d98a2b') : pc.cream;
  const stripe = pc.st.night ? pc.sign : pc.st.snow ? pc.st.ink : pc.sign;
  mb.extrudeX([[-L / 2, 0.42], [L / 2, 0.42], [L / 2, 2.75], [L / 2 - 0.3, 3.05], [-L / 2 + 0.15, 3.05], [-L / 2, 2.9]], -hw, hw, body, body);
  // window band with pillars, windshield, livery stripe
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.005);
    mb.quad([x, 1.4, -L / 2 + 0.5], [x, 1.4, L / 2 - 0.4], [x, 2.5, L / 2 - 0.4], [x, 2.5, -L / 2 + 0.5], pc.glassD, [s, 0, 0], 0.01);
    for (let i = 0; i < 7; i++) { const z = -L / 2 + 0.5 + (i + 1) * ((L - 0.9) / 8); mb.box(x - 0.02, 1.4, z - 0.09, x + 0.02 * s, 2.5, z + 0.09, body, body, 'yY'); }
    mb.quad([s * (hw + 0.008), 0.72, -L / 2 + 0.2], [s * (hw + 0.008), 0.72, L / 2 - 0.2], [s * (hw + 0.008), 1.05, L / 2 - 0.2], [s * (hw + 0.008), 1.05, -L / 2 + 0.2], stripe, [s, 0, 0], 0.01);
  }
  mb.quad([-hw + 0.12, 1.1, L / 2 + 0.005], [hw - 0.12, 1.1, L / 2 + 0.005], [hw - 0.12, 2.6, L / 2 + 0.005], [-hw + 0.12, 2.6, L / 2 + 0.005], pc.glassD, [0, 0, 1], 0.01);
  mb.kind(K.GLOW);
  mb.box(-hw + 0.3, 2.66, L / 2 - 0.05, hw - 0.3, 2.9, L / 2 + 0.02, pc.st.night ? pc.signB : lin('#ffcf5a'), undefined, 'y');
  mb.plain();
  mb.box(-hw * 0.6, 3.05, -L * 0.2, hw * 0.6, 3.35, L * 0.12, pc.metal, mix(pc.metal, WHITE, 0.2), 'y');
  mb.box(-hw + 0.05, 0.38, L / 2, hw - 0.05, 0.7, L / 2 + 0.12, pc.dark, pc.dark, 'y');
  mb.box(-hw + 0.05, 0.38, -L / 2 - 0.12, hw - 0.05, 0.7, -L / 2, pc.dark, pc.dark, 'y');
  lights(mb, pc, L, hw, 0.8, 0.9);
  wheels(mb, pc, hw - 0.18, [-L / 2 + 2.3, L / 2 - 2.2], 0.5, 0.34);
  return mb;
}

function propTruck(pc: PC): MB {
  const mb = newPropMB(pc, 'truck');
  const L = 8, hw = 1.25;
  // cab (front 2.3 m)
  const cz0 = L / 2 - 2.3;
  mb.kind(K.PAINT + TINT);
  mb.extrudeX([[cz0, 0.55], [L / 2, 0.55], [L / 2, 1.5], [L / 2 - 0.35, 2.85], [cz0, 2.95]], -hw, hw, PAINT_BASE, PAINT_BASE);
  mb.plain();
  mb.quad([-hw + 0.12, 1.65, L / 2 - 0.03], [hw - 0.12, 1.65, L / 2 - 0.03], [hw - 0.12, 2.7, L / 2 - 0.32], [-hw + 0.12, 2.7, L / 2 - 0.32], pc.glassD, [0, 0.3, 1]);
  for (const s of [-1, 1]) mb.quad([s * (hw + 0.005), 1.7, cz0 + 0.35], [s * (hw + 0.005), 1.7, L / 2 - 0.5], [s * (hw + 0.005), 2.6, L / 2 - 0.55], [s * (hw + 0.005), 2.6, cz0 + 0.35], pc.glassD, [s, 0, 0], 0.01);
  mb.box(-0.8, 0.7, L / 2 - 0.01, 0.8, 1.35, L / 2 + 0.03, pc.dark, pc.dark, 'y');
  mb.box(-hw, 0.45, L / 2, hw, 0.75, L / 2 + 0.14, pc.bumper, pc.bumper, 'y');
  // chassis + cargo box
  mb.box(-hw * 0.7, 0.5, -L / 2, hw * 0.7, 0.85, cz0, pc.dark, pc.dark, 'y');
  const boxC = pc.st.night ? lin('#7f8896') : lin('#f2f0ea');
  mb.box(-hw, 0.9, -L / 2, hw, 3.4, cz0 - 0.15, boxC, boxC, 'y');
  for (const s of [-1, 1]) {
    mb.quad([s * (hw + 0.005), 2.5, -L / 2 + 0.3], [s * (hw + 0.005), 2.5, cz0 - 0.45], [s * (hw + 0.005), 2.95, cz0 - 0.45], [s * (hw + 0.005), 2.95, -L / 2 + 0.3], pc.sign, [s, 0, 0], 0.01);
  }
  mb.box(-0.03, 1.0, -L / 2 - 0.012, 0.03, 3.3, -L / 2, pc.dark, pc.dark, 'yY');
  lights(mb, pc, L, hw, 0.95, 1.0);
  wheels(mb, pc, hw - 0.18, [L / 2 - 1.2, -L / 2 + 1.0, -L / 2 + 2.15], 0.5, 0.36);
  return mb;
}

function propKiosk(pc: PC): MB {
  const mb = newPropMB(pc, 'kiosk');
  const hx = 0.98, hz = 0.64;
  const body = pc.st.night ? lin('#3b2a44') : pc.st.snow ? lin('#d98a2b') : lin('#2f7f86');
  mb.box(-hx, 0, -hz, hx, 2.2, hz, body, body, 'y');
  // counter window + ledge (+Z)
  mb.box(-hx + 0.2, 1.0, hz - 0.02, hx - 0.2, 1.95, hz + 0.01, pc.st.night ? mul(pc.lit, 0.9) : pc.glassD, undefined, 'y');
  mb.box(-hx + 0.1, 0.95, hz, hx - 0.1, 1.02, hz + 0.16, pc.cream, pc.cream, 'y');
  // magazine racks (+X)
  const mags = [pc.sign, pc.signB, lin(pc.pal.foliage), pc.cream, lin('#5f9fb3')];
  let k = 0;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
    const z0 = -hz + 0.1 + i * 0.29, y0 = 0.35 + row * 0.5;
    mb.box(hx, y0, z0, hx + 0.1, y0 + 0.38, z0 + 0.24, mags[k++ % mags.length], undefined, 'yz');
  }
  // roof slab + sign
  mb.box(-hx - 0.12, 2.2, -hz - 0.12, hx + 0.12, 2.34, hz + 0.16, pc.st.night ? lin('#2a2f3a') : pc.cream, undefined, 'y');
  mb.kind(pc.st.day ? K.PLAIN : K.GLOW);
  mb.box(-hx + 0.1, 2.34, -0.12, hx - 0.1, 2.78, 0.12, pc.sign, pc.sign, 'y');
  mb.plain();
  for (let i = 0; i < 4; i++) { const x = -0.7 + i * 0.4; mb.box(x, 2.44, 0.12, x + 0.26, 2.68, 0.16, pc.st.day ? pc.cream : pc.signB, undefined, 'yz'); }
  return mb;
}

function propHydrant(pc: PC): MB {
  const mb = newPropMB(pc, 'hydrant');
  const col = pc.st.night ? lin('#d9453a') : pc.st.snow ? lin('#f2c230') : pc.sign;
  mb.prism(0, 0, 0, 0.08, 0.2, 0.2, 8, pc.metal, pc.metal);
  mb.prism(0, 0, 0.08, 0.6, 0.15, 0.14, 8, col, null);
  mb.prism(0, 0, 0.6, 0.68, 0.18, 0.18, 8, col, col);
  mb.prism(0, 0, 0.68, 0.8, 0.14, 0.05, 8, col, null);
  mb.prism(0, 0, 0.8, 0.86, 0.04, 0.04, 5, pc.metal, pc.metal);
  mb.cylX(0.2, 0.45, 0, 0.06, 0.06, 6, col, pc.metal);
  mb.cylX(-0.2, 0.45, 0, 0.06, 0.06, 6, col, pc.metal);
  mb.box(-0.07, 0.38, 0.13, 0.07, 0.52, 0.24, col, col, 'y');
  return mb;
}

function propLamp(pc: PC): MB {
  const mb = newPropMB(pc, 'lamp');
  mb.prism(0, 0, 0, 0.5, 0.18, 0.14, 8, pc.pole, pc.pole);
  mb.prism(0, 0, 0.5, 5.7, 0.075, 0.055, 6, pc.pole, null);
  mb.beam([0, 5.55, 0], [0, 5.95, 0.6], 0.09, pc.pole);
  mb.beam([0, 5.95, 0.6], [0, 5.95, 1.25], 0.09, pc.pole);
  mb.box(-0.26, 5.82, 0.95, 0.26, 6.02, 1.55, pc.pole, mul(pc.pole, 1.1), 'y');
  mb.kind(K.GLOW);
  mb.box(-0.2, 5.78, 1.0, 0.2, 5.83, 1.5, pc.lit, pc.lit, 'Y');
  mb.plain();
  if (pc.st.day) {
    // hanging banner in the blossom palette
    mb.box(0.06, 3.2, -0.02, 0.1, 4.6, 0.02, pc.pole, pc.pole, 'yY');
    mb.box(0.1, 3.3, -0.01, 0.62, 4.5, 0.01, lin(pc.pal.foliageB), undefined, 'yY');
  }
  return mb;
}

function propTree(pc: PC): MB {
  const mb = newPropMB(pc, 'tree');
  // grate / pit
  mb.box(-0.8, 0, -0.8, 0.8, 0.04, 0.8, pc.st.snow ? pc.st.snowC : pc.dark, undefined, 'y');
  treeParts(mb, pc.st, pc.pal, pc.st.snow ? 1.05 : 1.0);
  return mb;
}

function propBench(pc: PC): MB {
  const mb = newPropMB(pc, 'bench');
  const iron = pc.st.night ? lin('#3a4250') : pc.dark;
  for (const s of [-0.8, 0.8]) {
    mb.box(s - 0.05, 0, -0.3, s + 0.05, 0.45, 0.25, iron, iron, 'y');
    mb.box(s - 0.05, 0.45, -0.32, s + 0.05, 0.9, -0.22, iron, iron, 'y');
    mb.box(s - 0.06, 0.62, -0.28, s + 0.06, 0.68, 0.22, iron, iron, '');
  }
  for (let i = 0; i < 3; i++) { const z = -0.22 + i * 0.16; mb.box(-0.92, 0.42, z, 0.92, 0.47, z + 0.13, pc.wood, pc.wood, ''); }
  for (let i = 0; i < 2; i++) { const y = 0.58 + i * 0.16; mb.box(-0.92, y, -0.3, 0.92, y + 0.12, -0.25, pc.wood, pc.wood, ''); }
  return mb;
}

function propVending(pc: PC): MB {
  const mb = newPropMB(pc, 'vending');
  const hx = 0.5, hz = 0.4;
  const body = pc.st.night ? lin('#c23a7a') : pc.st.snow ? lin('#3f5c7a') : lin('#e0544a');
  mb.box(-hx, 0, -hz, hx, 1.9, hz, body, mul(body, 1.05), 'y');
  mb.kind(K.GLOW);
  mb.box(-hx + 0.08, 0.75, hz, hx - 0.28, 1.78, hz + 0.02, mix(pc.lit, WHITE, 0.4), undefined, 'y');
  mb.plain();
  const goods = [pc.sign, pc.signB, lin('#5f9fb3'), lin('#7fc8a9')];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) {
    const x = -hx + 0.14 + i * 0.2, y = 0.85 + r * 0.32;
    mb.box(x, y, hz + 0.02, x + 0.12, y + 0.2, hz + 0.05, goods[(r + i) % 4], undefined, 'yz');
  }
  mb.box(hx - 0.24, 0.9, hz, hx - 0.08, 1.5, hz + 0.03, pc.metal, undefined, 'yz');
  mb.box(-hx + 0.1, 0.2, hz, hx - 0.1, 0.45, hz + 0.05, pc.st.ink, undefined, 'yz');
  return mb;
}

function propSignpost(pc: PC): MB {
  const mb = newPropMB(pc, 'signpost');
  const blade = pc.st.night ? lin('#1f5f6a') : pc.st.snow ? lin('#2f5a8a') : lin('#2f7f86');
  mb.prism(0, 0, 0, 3.1, 0.055, 0.05, 6, pc.pole, pc.pole);
  mb.kind(pc.st.night ? K.GLOW : K.PLAIN);
  mb.box(-0.02, 2.62, -0.55, 0.02, 2.84, 0.55, blade, blade, 'y');
  mb.box(-0.55, 2.88, -0.02, 0.55, 3.08, 0.02, blade, blade, 'y');
  mb.plain();
  for (let i = 0; i < 3; i++) mb.box(-0.4 + i * 0.28, 2.93, 0.02, -0.26 + i * 0.28, 3.03, 0.03, pc.cream, undefined, 'yz');
  // one-way plate + arrow
  mb.box(-0.36, 2.0, 0.05, 0.36, 2.26, 0.08, pc.st.ink, pc.st.ink, 'y');
  mb.box(-0.28, 2.09, 0.08, 0.2, 2.17, 0.09, pc.cream, undefined, 'yz');
  mb.tri([0.2, 2.03, 0.09], [0.32, 2.13, 0.09], [0.2, 2.23, 0.09], pc.cream, [0, 0, 1]);
  return mb;
}

function propBarrier(pc: PC): MB {
  const mb = newPropMB(pc, 'barrier');
  const orange = lin('#ff7a2e'), white = lin('#f4f1ea');
  for (const s of [-0.85, 0.85]) {
    mb.beam([s, 0, -0.24], [s, 0.95, 0], 0.08, pc.st.night ? pc.metal : white);
    mb.beam([s, 0, 0.24], [s, 0.95, 0], 0.08, pc.st.night ? pc.metal : white);
  }
  for (const y of [0.45, 0.78]) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = -1 + (2 * i) / n, x1 = -1 + (2 * (i + 1)) / n;
      mb.box(x0, y, -0.03, x1, y + 0.2, 0.03, i % 2 ? white : orange, i % 2 ? white : orange, 'y');
    }
  }
  mb.kind(K.GLOW);
  mb.prism(0.85, 0, 0.98, 1.1, 0.07, 0.07, 6, lin('#ffb13b'), lin('#ffb13b'));
  mb.plain();
  return mb;
}

function propDrum(pc: PC): MB {
  const mb = newPropMB(pc, 'drum');
  mb.kind(K.PAINT + TINT);
  mb.prism(0, 0, 0, 0.88, 0.3, 0.3, 10, PAINT_BASE, null);
  mb.plain();
  for (const y of [0.28, 0.58]) mb.prism(0, 0, y, y + 0.04, 0.315, 0.315, 10, pc.dark, pc.dark);
  mb.prism(0, 0, 0.88, 0.9, 0.29, 0.29, 10, pc.metal, pc.metal);
  mb.prism(0.12, 0.08, 0.9, 0.94, 0.04, 0.04, 6, pc.dark, pc.dark);
  return mb;
}

function propForklift(pc: PC): MB {
  const mb = newPropMB(pc, 'forklift');
  const body = pc.st.night ? lin(pc.pal.bodyC) : pc.st.snow ? lin('#ffb347') : lin('#ffd166');
  const hw = 0.55;
  // counterweight body (rear, −Z) + deck
  mb.extrudeX([[-1.3, 0.25], [0.5, 0.25], [0.5, 0.8], [-0.9, 0.95], [-1.3, 1.2]], -hw, hw, body, body);
  mb.box(-hw + 0.1, 0.8, -0.6, hw - 0.1, 1.2, -0.2, pc.st.ink, pc.st.ink, 'y');     // seat
  // overhead guard
  for (const [x, z] of [[-hw + 0.05, 0.35], [hw - 0.05, 0.35], [-hw + 0.05, -0.85], [hw - 0.05, -0.85]]) mb.box(x - 0.04, 0.8, z - 0.04, x + 0.04, 2.1, z + 0.04, pc.st.ink, pc.st.ink, 'y');
  for (let i = 0; i < 4; i++) { const z = -0.85 + i * 0.4; mb.box(-hw + 0.02, 2.08, z - 0.03, hw - 0.02, 2.14, z + 0.03, pc.st.ink, pc.st.ink, ''); }
  mb.box(-hw + 0.02, 2.08, -0.85, -hw + 0.08, 2.14, 0.35, pc.st.ink, pc.st.ink, '');
  mb.box(hw - 0.08, 2.08, -0.85, hw - 0.02, 2.14, 0.35, pc.st.ink, pc.st.ink, '');
  // mast + carriage + forks (front, +Z)
  for (const s of [-1, 1]) mb.box(s * 0.35 - 0.05, 0.1, 0.55, s * 0.35 + 0.05, 2.2, 0.65, pc.dark, pc.dark, 'y');
  mb.box(-0.42, 0.25, 0.66, 0.42, 0.75, 0.72, pc.dark, pc.dark, 'y');
  for (const s of [-1, 1]) mb.box(s * 0.25 - 0.06, 0.18, 0.72, s * 0.25 + 0.06, 0.24, 1.3, pc.metal, pc.metal, 'y');
  mb.kind(K.GLOW);
  mb.cbox(0, 2.14, -0.3, 0.08, 2.26, 0.08, lin('#ffb13b'), undefined, 'y');
  mb.plain();
  mb.cylX(hw - 0.08, 0.3, 0.3, 0.3, 0.1, 8, pc.tyre, pc.tyre);
  mb.cylX(-hw + 0.08, 0.3, 0.3, 0.3, 0.1, 8, pc.tyre, pc.tyre);
  mb.cylX(hw - 0.1, 0.24, -0.95, 0.24, 0.09, 8, pc.tyre, pc.tyre);
  mb.cylX(-hw + 0.1, 0.24, -0.95, 0.24, 0.09, 8, pc.tyre, pc.tyre);
  return mb;
}

function propContainer(pc: PC): MB {
  const mb = newPropMB(pc, 'container');
  const hx = 1.22, hz = 3.05, h = 2.6;
  const post = mix(pc.st.ink, pc.dark, 0.4);
  mb.kind(K.CONT + TINT, 1, 0);
  mb.quad([hx, 0, hz], [hx, 0, -hz], [hx, h, -hz], [hx, h, hz], PAINT_BASE, [1, 0, 0], 0.02);
  mb.quad([-hx, 0, -hz], [-hx, 0, hz], [-hx, h, hz], [-hx, h, -hz], PAINT_BASE, [-1, 0, 0], 0.02);
  mb.kind(K.CONT + TINT, 0, 0);
  mb.quad([-hx, 0, hz], [hx, 0, hz], [hx, h, hz], [-hx, h, hz], mul(PAINT_BASE, 0.97), [0, 0, 1], 0.02);
  mb.quad([hx, 0, -hz], [-hx, 0, -hz], [-hx, h, -hz], [hx, h, -hz], mul(PAINT_BASE, 0.97), [0, 0, -1], 0.02);
  mb.kind(K.CONT + TINT, 1, 0);
  mb.quad([-hx, h, hz], [hx, h, hz], [hx, h, -hz], [-hx, h, -hz], mul(PAINT_BASE, 1.02), [0, 1, 0], 0.02);
  mb.plain();
  for (const [x, z] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]]) mb.box(x - 0.09, 0, z - 0.09, x + 0.09, h + 0.02, z + 0.09, post, post, 'y');
  mb.box(-hx, h - 0.14, hz - 0.02, hx, h + 0.02, hz + 0.06, post, post, 'yz');
  for (const x of [-0.7, -0.35, 0.35, 0.7]) mb.box(x - 0.025, 0.15, hz, x + 0.025, h - 0.2, hz + 0.05, pc.metal, pc.metal, 'yz');
  return mb;
}

function propBollard(pc: PC): MB {
  const mb = newPropMB(pc, 'bollard');
  if (pc.st.night) {
    // mooring bollard: squat iron mushroom
    const iron = lin('#2f3540');
    mb.prism(0, 0, 0, 0.1, 0.16, 0.16, 8, iron, iron);
    mb.prism(0, 0, 0.1, 0.5, 0.1, 0.11, 8, iron, null);
    mb.prism(0, 0, 0.5, 0.62, 0.17, 0.15, 8, iron, iron);
    mb.kind(K.GLOW);
    mb.prism(0, 0, 0.3, 0.36, 0.115, 0.115, 8, lin(pc.pal.signB), null);
    mb.plain();
  } else {
    const post = pc.st.snow ? lin('#f2c230') : pc.dark;
    mb.prism(0, 0, 0, 0.92, 0.11, 0.1, 8, post, null);
    mb.prism(0, 0, 0.92, 1.0, 0.1, 0.05, 8, post, null);
    mb.prism(0, 0, 0.7, 0.8, 0.112, 0.108, 8, pc.st.snow ? pc.st.ink : lin('#f4f1ea'), null);
  }
  return mb;
}

function propBoat(pc: PC): MB {
  const mb = newPropMB(pc, 'boat');
  const hw = 1.1, L = 6.0;
  // hull: deck ring (y 0.9) → waterline ring (y 0.15, inset) → keel
  const deck: [number, number][] = [[-hw, -L / 2], [hw, -L / 2], [hw, L * 0.18], [hw * 0.55, L * 0.4], [0, L / 2], [-hw * 0.55, L * 0.4], [-hw, L * 0.18]];
  const wl = deck.map(([x, z]) => [x * 0.78, z * 0.92] as [number, number]);
  mb.kind(K.PAINT + TINT);
  for (let i = 0; i < deck.length; i++) {
    const j = (i + 1) % deck.length;
    const [ax, az] = deck[i], [bx, bz] = deck[j], [cx, cz] = wl[j], [dx, dz] = wl[i];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    mb.quad([ax, 0.9, az], [bx, 0.9, bz], [cx, 0.15, cz], [dx, 0.15, dz], PAINT_BASE, [mx, -0.2, mz]);
  }
  mb.plain();
  const keel = pc.st.night ? lin('#6a2f2f') : lin('#b8483a');
  mb.poly(wl.map(([x, z]) => [x, 0.15, z] as V3), keel, [0, -1, 0]);
  const deckC = pc.st.night ? lin('#5d6470') : lin('#d8d2c4');
  mb.poly(deck.map(([x, z]) => [x, 0.9, z] as V3), deckC, [0, 1, 0]);
  // gunwale rail
  for (let i = 0; i < deck.length; i++) {
    const j = (i + 1) % deck.length;
    mb.beam([deck[i][0], 0.98, deck[i][1]], [deck[j][0], 0.98, deck[j][1]], 0.09, pc.cream);
  }
  // cabin + windows + mast light
  const cab = pc.st.night ? lin('#c9ced6') : pc.cream;
  mb.box(-0.75, 0.9, -1.9, 0.75, 2.1, 0.2, cab, mix(cab, pc.dark, 0.2), 'y');
  mb.box(-0.76, 1.45, -1.7, 0.76, 1.85, 0.21, pc.st.night ? mul(pc.lit, 0.8) : pc.glassD, undefined, 'yY');
  mb.box(-0.85, 2.1, -2.05, 0.85, 2.2, 0.35, pc.dark, pc.dark, '');
  mb.prism(0, -1.2, 2.2, 3.6, 0.05, 0.04, 5, pc.metal, null);
  mb.kind(K.GLOW);
  mb.cbox(0, 3.6, -1.2, 0.09, 3.78, 0.09, pc.st.night ? lin('#7dffb0') : lin('#ffe28a'), undefined, 'y');
  mb.plain();
  // tyre fenders
  for (const s of [-1, 1]) for (const z of [-1.5, 0, 1.2]) mb.cylX(s * (hw + 0.03), 0.6, z, 0.18, 0.06, 6, pc.tyre, pc.tyre);
  return mb;
}

function propPylon(pc: PC): MB {
  const mb = newPropMB(pc, 'pylon');
  const steel = pc.st.night ? lin('#56606e') : pc.st.snow ? lin('#7a838c') : lin('#9aa3aa');
  const H = 9, b = 0.45, t = 0.14;
  const leg = (sx: number, sz: number, y: number): V3 => { const k = y / H; const r = b + (t - b) * k; return [sx * r, y, sz * r]; };
  const corners: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  // chunky members so the lattice reads as steel, not as an ink scribble, at game distances
  for (const [sx, sz] of corners) mb.beam(leg(sx, sz, 0), leg(sx, sz, H), 0.12, steel);
  const lv = [0.2, 2.8, 5.2, 7.2];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
    for (let i = 0; i + 1 < lv.length; i++) {
      // Warren zig-zag: one diagonal per panel, alternating direction panel to panel
      if (i % 2 === 0) mb.beam(leg(ax, az, lv[i]), leg(bx, bz, lv[i + 1]), 0.06, steel);
      else mb.beam(leg(bx, bz, lv[i]), leg(ax, az, lv[i + 1]), 0.06, steel);
    }
    for (const y of [2.8, 5.2]) mb.beam(leg(ax, az, y), leg(bx, bz, y), 0.06, steel);
  }
  // cross arms + insulator strings
  for (const [y, w] of [[7.4, 1.6], [8.4, 1.15]] as [number, number][]) {
    mb.beam([-w, y, 0], [w, y, 0], 0.13, steel, true);
    for (const s of [-1, 1]) mb.prism(s * (w - 0.12), 0, y - 0.55, y, 0.07, 0.07, 5, pc.st.night ? lin('#6a7a8a') : lin('#7a5a44'), null);
  }
  mb.prism(0, 0, H - 0.15, H + 0.35, 0.05, 0.03, 5, steel, null);
  mb.kind(K.GLOW);
  mb.cbox(0, H + 0.35, 0, 0.11, H + 0.57, 0.11, lin('#ff5a4a'), undefined, 'y');
  mb.plain();
  return mb;
}

function propSnowbank(pc: PC): MB {
  const mb = newPropMB(pc, 'snowbank');
  mb.snow = null;
  const s1 = pc.st.snowC, s2 = mix(pc.st.snowC, lin('#9fb3c8'), 0.25), s3 = mix(pc.st.snowC, lin('#c9d3dc'), 0.5);
  mb.blob(0, 0.2, 0, 1.45, 0.6, 0.72, [s1, s1, s3], 0.16, true);
  mb.blob(-0.8, 0.15, 0.12, 0.8, 0.45, 0.55, [s1, s2], 0.2, true);
  mb.blob(0.85, 0.1, -0.1, 0.7, 0.38, 0.5, [s1, s3], 0.2, true);
  // a buried traffic cone poking out
  mb.prism(0.3, 0.35, 0.45, 0.95, 0.14, 0.03, 6, lin('#ff7a2e'), null);
  mb.prism(0.3, 0.35, 0.62, 0.7, 0.105, 0.09, 6, lin('#f4f1ea'), null);
  return mb;
}

function buildProp(kind: PropKind, pc: PC): MB {
  switch (kind) {
    case 'car': return propCar(pc, false);
    case 'taxi': return propCar(pc, true);
    case 'van': return propVan(pc);
    case 'bus': return propBus(pc);
    case 'truck': return propTruck(pc);
    case 'kiosk': return propKiosk(pc);
    case 'hydrant': return propHydrant(pc);
    case 'lamp': return propLamp(pc);
    case 'tree': return propTree(pc);
    case 'bench': return propBench(pc);
    case 'vending': return propVending(pc);
    case 'signpost': return propSignpost(pc);
    case 'barrier': return propBarrier(pc);
    case 'drum': return propDrum(pc);
    case 'forklift': return propForklift(pc);
    case 'container': return propContainer(pc);
    case 'bollard': return propBollard(pc);
    case 'boat': return propBoat(pc);
    case 'pylon': return propPylon(pc);
    case 'snowbank': return propSnowbank(pc);
  }
}

// ─────────────────────────────── rubble (unit heap) ───────────────────────────────
function buildRubble(b: BiomeDef, st: Style): MB {
  const p = b.palette;
  const mb = new MB(hashStr('rubble:' + b.id));
  mb.ms = [20, 8, 20];
  mb.snow = st.snow ? st.snowC : null;
  mb.snowNy = 0.9;
  mb.jit = 0.06;
  const dust = st.night ? lin('#4d5360') : st.snow ? lin('#a9b0b7') : lin('#c8bda9');
  const dustD = mul(dust, 0.84);
  const concrete = mix(dust, WHITE, st.night ? 0.06 : 0.16);
  const bodies = [lin(p.bodyA), lin(p.bodyB), lin(p.bodyC)];
  const trim = lin(p.trimA), glass = lin(p.glass);
  const rebar = lin('#6a4432');
  const r = mb.rnd;
  // ── craggy heap: a jittered height field made of three overlapping mounds, zero at the rim ──
  const N = 6;
  const mounds: [number, number, number, number][] = [[0, 0, 0.42, 1], [0.16, -0.12, 0.26, 0.8], [-0.17, 0.14, 0.24, 0.72]];
  const hAt = (x: number, z: number): number => {
    let h = 0;
    for (const [mx0, mz0, rr, hh] of mounds) {
      const d = Math.hypot(x - mx0, z - mz0) / rr;
      h = Math.max(h, hh * Math.max(0, 1 - d * d));
    }
    const edge = Math.min(1, (0.5 - Math.max(Math.abs(x), Math.abs(z))) * 7);
    return Math.max(0, h * Math.max(0, edge));
  };
  const V: V3[][] = [];
  for (let i = 0; i <= N; i++) {
    V.push([]);
    for (let j = 0; j <= N; j++) {
      const rim = i === 0 || j === 0 || i === N || j === N;
      let x = i / N - 0.5, z = j / N - 0.5;
      if (!rim) { x += (r() - 0.5) * 0.45 / N; z += (r() - 0.5) * 0.45 / N; }
      const h = rim ? 0 : hAt(x, z) * (0.62 + 0.3 * r());
      V[i].push([x, h * 0.78, z]);
    }
  }
  mb.kind(TINT);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = V[i][j], bb = V[i + 1][j], c = V[i + 1][j + 1], d = V[i][j + 1];
    const pick = r();
    const col = pick < 0.55 ? dust : pick < 0.8 ? dustD : pick < 0.92 ? concrete : mix(dust, bodies[Math.floor(r() * 3)], 0.3);
    if ((i + j) % 2 === 0) { mb.tri(a, c, bb, mb.shade(col), [0, 1, 0]); mb.tri(a, d, c, mb.shade(col), [0, 1, 0]); }
    else { mb.tri(a, d, bb, mb.shade(col), [0, 1, 0]); mb.tri(bb, d, c, mb.shade(col), [0, 1, 0]); }
  }
  mb.plain();
  const heightAt = (x: number, z: number): number => {
    const fi = Math.min(N - 1e-6, Math.max(0, (x + 0.5) * N)), fj = Math.min(N - 1e-6, Math.max(0, (z + 0.5) * N));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    return (V[i][j][1] * (1 - u) + V[i + 1][j][1] * u) * (1 - v) + (V[i][j + 1][1] * (1 - u) + V[i + 1][j + 1][1] * u) * v;
  };
  // ── broken floor plates (wide + thin) and facade chunks (thick, painted in the building colours
  //    with a dark window hole), tossed at angles so the silhouette is jagged ──
  for (let k = 0; k < 17; k++) {
    const plate = k % 3 !== 2;
    const x = (r() - 0.5) * 0.62, z = (r() - 0.5) * 0.62;
    const sx = plate ? 0.12 + r() * 0.16 : 0.08 + r() * 0.1;
    const sy = plate ? 0.035 + r() * 0.03 : 0.07 + r() * 0.08;
    const sz = plate ? 0.08 + r() * 0.12 : 0.03 + r() * 0.03;
    const ry = r() * Math.PI, rx = (r() - 0.5) * (plate ? 1.1 : 0.5), rz = (r() - 0.5) * (plate ? 0.9 : 0.6);
    // lowest corner of the tilted chunk stays above the ground plane
    const drop = 0.5 * (Math.hypot(sx, sz) * Math.max(Math.abs(Math.sin(rx)), Math.abs(Math.sin(rz))) + sy);
    const y = Math.max(drop + 0.005, Math.min(0.8, heightAt(x, z) * 0.9));
    const col = plate ? (k % 2 ? concrete : mix(concrete, dust, 0.5)) : bodies[k % 3];
    mb.kind(plate ? 0 : TINT);
    mb.withM(trs(x, y, z, 1, 1, 1, ry, rx, rz), () => {
      mb.box(-sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2, col, mix(col, WHITE, 0.1), 'y');
      if (!plate) {
        mb.plain();
        mb.box(-sx * 0.22, -sy * 0.2, sz / 2, sx * 0.22, sy * 0.3, sz / 2 + 0.004, mix(glass, st.ink, 0.35), undefined, 'yz');
        mb.box(-sx * 0.3, -sy * 0.34, sz / 2, sx * 0.3, -sy * 0.2, sz / 2 + 0.006, trim, undefined, 'yz');
      }
    });
  }
  mb.plain();
  // column stubs standing out of the heap
  for (let k = 0; k < 3; k++) {
    const x = (r() - 0.5) * 0.5, z = (r() - 0.5) * 0.5;
    const y0 = Math.max(0.04, heightAt(x, z) * 0.7);
    mb.withM(trs(x, y0, z, 1, 1, 1, r() * 3, (r() - 0.5) * 0.5, (r() - 0.5) * 0.5), () =>
      mb.box(-0.025, 0, -0.025, 0.025, 0.12 + r() * 0.12, 0.025, concrete, mix(concrete, WHITE, 0.1), 'y'));
  }
  // rebar sticking out in bent pairs
  for (let k = 0; k < 5; k++) {
    const x = (r() - 0.5) * 0.56, z = (r() - 0.5) * 0.56;
    const y = Math.max(0.03, heightAt(x, z) * 0.8);
    const a = r() * Math.PI * 2, tilt = 0.25 + r() * 0.6, len = 0.14 + r() * 0.16;
    const mid: V3 = [x + Math.sin(a) * Math.sin(tilt) * len * 0.6, y + Math.cos(tilt) * len * 0.8, z + Math.cos(a) * Math.sin(tilt) * len * 0.6];
    const tip: V3 = [mid[0] + Math.sin(a + 0.9) * len * 0.45, Math.min(0.97, mid[1] + len * 0.25), mid[2] + Math.cos(a + 0.9) * len * 0.45];
    const cl = (v: number) => Math.max(-0.48, Math.min(0.48, v));
    mb.beam([x, y, z], [cl(mid[0]), Math.min(0.97, mid[1]), cl(mid[2])], 0.012, rebar);
    mb.beam([cl(mid[0]), Math.min(0.97, mid[1]), cl(mid[2])], [cl(tip[0]), tip[1], cl(tip[2])], 0.012, rebar);
  }
  return mb;
}

/** Stretch a geometry vertically so its top sits exactly at y = 1 (the view scales the unit
 *  heap by the pile height). Normals follow the inverse-transpose; hull normals are re-baked. */
function fitUnitHeight(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  let top = 0;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  if (top < 1e-6 || Math.abs(top - 1) < 1e-4) return g;
  const k = 1 / top;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * k);
    _n.set(nrm.getX(i), nrm.getY(i) / k, nrm.getZ(i)).normalize();
    nrm.setXYZ(i, _n.x, _n.y, _n.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  g.deleteAttribute('outlineNormal');
  bakeOutlineNormals(g);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ─────────────────────────────── the kit ───────────────────────────────
/** Build every city mesh + material for a biome (once per run; cheap: ~100k tris total). */
export function buildCityKit(b: BiomeDef): CityKit {
  const st = styleOf(b);
  const U = facadeUniforms(b, st);
  const facade = makeKitMaterial(U, 'cityFacade:' + b.id);
  const propMat = makeKitMaterial(U, 'cityProps:' + b.id);
  const geos: THREE.BufferGeometry[] = [];

  const arch: Record<string, ArchMeshes> = {};
  for (const a of b.archetypes) {
    const g = buildArch(a, b, st);
    g.base.name = a.id + ':base'; g.floor.name = a.id + ':floor'; g.roof.name = a.id + ':roof';
    geos.push(g.base, g.floor, g.roof);
    arch[a.id] = { base: g.base, floor: g.floor, roof: g.roof, material: facade };
  }

  const pc = propCtx(b, st);
  const props = {} as Record<PropKind, PropMesh>;
  for (const kind of PROP_KINDS) {
    const geo = buildProp(kind, pc).build();
    geo.name = 'prop:' + kind;
    geos.push(geo);
    props[kind] = { geo, material: propMat, height: geo.boundingBox ? geo.boundingBox.max.y : 1 };
  }

  const rubble = fitUnitHeight(buildRubble(b, st).build());
  rubble.name = 'rubble';
  geos.push(rubble);

  const ground = {
    road: makeGround(b, st, 'road'),
    sidewalk: makeGround(b, st, 'sidewalk'),
    plaza: makeGround(b, st, 'plaza'),
    lot: makeGround(b, st, 'lot'),
  };

  let disposed = false;
  return {
    arch, props, rubble, facade, ground,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const g of geos) g.dispose();
      facade.dispose();
      propMat.dispose();
      ground.road.dispose(); ground.sidewalk.dispose(); ground.plaza.dispose(); ground.lot.dispose();
      // the toon ramp texture is shared game-wide (render/materials.ts) — never disposed here
    },
  };
}
