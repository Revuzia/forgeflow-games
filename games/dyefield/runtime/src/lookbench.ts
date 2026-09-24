// DYEFIELD — LOOK bench (http://localhost:5186/lookbench.html). LOOK lane.
//
// The lane's sky, water, stylized surfaces and dye in isolation, on a flat test pier built here
// (tile plate with court lines, a concrete wall, crates, a chevron wall, a hazard curb, a
// boardwalk deck + ramp, spawn pads, a planter, bollards, a lamp post). Every paintable face gets
// a generated `uv1` in a bench atlas (10 texels/m, S = 1024) and a fake PaintAtlas filled with
// organic blobs of both crews (puddles, droplets, wall drips, a direct crew-vs-crew border).
// A live brush keeps painting a figure-8 trail through PaintTexture.upload() so the incremental
// updateRanges path is exercised every frame.
//
// Query:  ?preset=noon|golden   ?tm= (or ?tonemap=) split|agx|neutral|aces (default split: AgX left, Neutral right)
//         ?cam=player|close|wide|wall|low|top   ?viewer=1|2|0   ?cb=0|1   ?live=1|0
//         ?freeze=1 (fixed clock, no live brush: deterministic shots)   ?ui=0   ?hero=1
// Keys:   1-6 camera · T viewer crew · C colour-blind · P preset · M tone mapping · L live brush · H hud
// Test:   window.__LOOK__ = { ready, frames, errors, info(), set(opts), shot(name) }

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mapById, type LightingPreset } from './core/data.ts';
import type { PaintAtlas } from './core/paint/atlas.ts';
import type { Painter } from './core/paint/painter.ts';
import { PaintTexture } from './view/paintlayer.ts';
import { applyDye, createDyeUniforms, materialFor, surfaceUniformsOf, type DyeUniforms } from './view/surfaces.ts';
import { createSky, type SkyRig } from './view/sky.ts';
import { createWater, type WaterRig } from './view/water.ts';

type V3 = THREE.Vector3;
type Team = 0 | 1 | 2;
type ToneMode = 'split' | 'agx' | 'neutral' | 'aces';
type CamName = 'player' | 'close' | 'wide' | 'wall' | 'low' | 'top';

const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const qs = (k: string, d: string): string => Q.get(k) ?? d;

// ════════════════════════════════════════════════════════════════════════════════════════════
// deterministic noise (bench only)
// ════════════════════════════════════════════════════════════════════════════════════════════
function hashU(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
const hash01 = (a: number, b = 0, c = 0): number => hashU(a, b, c) / 4294967296;
function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number, k: number) => hash01(xi + i, yi + j, zi + k);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// bench atlas: shelf-packed rects, CONTRACT §2 texel ↔ UV rule (no flips), 2-px mirrored gutter
// ════════════════════════════════════════════════════════════════════════════════════════════
const S = 1024;
const TPM = 10;
const MARGIN = 4;
const GUTTER = 2;

export interface Face { o: V3; u: V3; v: V3; w: number; h: number; n: V3 }
export interface Rect { x0: number; y0: number; tw: number; th: number; face: Face; firstId: number }

export class BenchAtlas {
  readonly size = S;
  readonly srcOf = new Int32Array(S * S).fill(-1);
  readonly rects: Rect[] = [];
  team = new Uint8Array(0);
  noise = new Uint8Array(0);
  px = new Float32Array(0); py = new Float32Array(0); pz = new Float32Array(0);
  nx = new Float32Array(0); ny = new Float32Array(0); nz = new Float32Array(0);
  count = 0;
  private sx = 0; private sy = 0; private sh = 0;

  alloc(face: Face): Rect {
    const tw = Math.max(1, Math.ceil(face.w * TPM));
    const th = Math.max(1, Math.ceil(face.h * TPM));
    if (this.sx + tw + 2 * MARGIN > S) { this.sx = 0; this.sy += this.sh; this.sh = 0; }
    if (this.sy + th + 2 * MARGIN > S) throw new Error('bench atlas full');
    const r: Rect = { x0: this.sx + MARGIN, y0: this.sy + MARGIN, tw, th, face, firstId: this.count };
    this.count += tw * th;
    this.sx += tw + 2 * MARGIN;
    this.sh = Math.max(this.sh, th + 2 * MARGIN);
    this.rects.push(r);
    return r;
  }

  finish(): void {
    const n = this.count;
    this.team = new Uint8Array(n);
    this.noise = new Uint8Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.nx = new Float32Array(n); this.ny = new Float32Array(n); this.nz = new Float32Array(n);
    for (const r of this.rects) {
      const f = r.face;
      for (let j = 0; j < r.th; j++) {
        for (let i = 0; i < r.tw; i++) {
          const id = r.firstId + j * r.tw + i;
          const s = (i + 0.5) / r.tw * f.w, t = (j + 0.5) / r.th * f.h;
          this.px[id] = f.o.x + f.u.x * s + f.v.x * t;
          this.py[id] = f.o.y + f.u.y * s + f.v.y * t;
          this.pz[id] = f.o.z + f.u.z * s + f.v.z * t;
          this.nx[id] = f.n.x; this.ny[id] = f.n.y; this.nz[id] = f.n.z;
          this.noise[id] = hashU(id, 0x5eed) & 255;
          this.srcOf[(r.y0 + j) * S + r.x0 + i] = id;
        }
      }
      // gutter: mirror the nearest surface texel
      for (let y = r.y0 - GUTTER; y < r.y0 + r.th + GUTTER; y++) {
        for (let x = r.x0 - GUTTER; x < r.x0 + r.tw + GUTTER; x++) {
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          const lin = y * S + x;
          if (this.srcOf[lin] >= 0) continue;
          const ci = Math.min(r.tw - 1, Math.max(0, x - r.x0));
          const cj = Math.min(r.th - 1, Math.max(0, y - r.y0));
          this.srcOf[lin] = r.firstId + cj * r.tw + ci;
        }
      }
    }
  }

  /** the atlas as the PaintTexture sees it (it reads size / srcOf / team / noise) */
  asPaintAtlas(): PaintAtlas {
    return this as unknown as PaintAtlas;
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// fake painter: a dirty-row set drained by takeDirty (x1 inclusive), like core/paint/painter.ts
// ════════════════════════════════════════════════════════════════════════════════════════════
export class BenchPainter {
  private readonly rowMin = new Int32Array(S).fill(S);
  private readonly rowMax = new Int32Array(S).fill(-1);
  private readonly rows: number[] = [];
  flips = 0;
  readonly atlas: BenchAtlas;
  constructor(atlas: BenchAtlas) { this.atlas = atlas; }

  markRect(r: Rect, i0: number, i1: number, j0: number, j1: number): void {
    // expand by the gutter so mirrored texels upload too
    const x0 = Math.max(0, r.x0 + i0 - GUTTER), x1 = Math.min(S - 1, r.x0 + i1 + GUTTER);
    for (let y = Math.max(0, r.y0 + j0 - GUTTER); y <= Math.min(S - 1, r.y0 + j1 + GUTTER); y++) {
      if (this.rowMax[y] < 0) this.rows.push(y);
      this.rowMin[y] = Math.min(this.rowMin[y], x0);
      this.rowMax[y] = Math.max(this.rowMax[y], x1);
    }
  }

  /** paint a disc (world XZ) on a floor rect; only the texels inside its bounding box are visited */
  brush(r: Rect, cx: number, cz: number, radius: number, team: Team): void {
    const f = r.face;
    const R = radius * 1.2;
    const dx0 = cx - f.o.x, dz0 = cz - f.o.z;
    const s = dx0 * f.u.x + dz0 * f.u.z, t = dx0 * f.v.x + dz0 * f.v.z;   // face coords (m)
    const ia = Math.max(0, Math.floor((s - R) / f.w * r.tw)), ib = Math.min(r.tw - 1, Math.ceil((s + R) / f.w * r.tw));
    const ja = Math.max(0, Math.floor((t - R) / f.h * r.th)), jb = Math.min(r.th - 1, Math.ceil((t + R) / f.h * r.th));
    let i0 = r.tw, i1 = -1, j0 = r.th, j1 = -1;
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const id = r.firstId + j * r.tw + i;
        const dx = this.atlas.px[id] - cx, dz = this.atlas.pz[id] - cz;
        const rr = radius * (0.82 + 0.36 * vnoise3(this.atlas.px[id] * 2.2, 0, this.atlas.pz[id] * 2.2));
        if (dx * dx + dz * dz > rr * rr || this.atlas.team[id] === team) continue;
        this.atlas.team[id] = team;
        this.flips++;
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
    if (i1 >= 0) this.markRect(r, i0, i1, j0, j1);
  }

  takeDirty(cb: (row: number, x0: number, x1: number) => void): void {
    const list = this.rows.splice(0).sort((a, b) => a - b);
    for (const row of list) {
      const a = this.rowMin[row], b = this.rowMax[row];
      this.rowMin[row] = S; this.rowMax[row] = -1;
      cb(row, a, b);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// geometry: quads with uv (metres) + uv1 (atlas); non-paint faces get uv1 = 0
// ════════════════════════════════════════════════════════════════════════════════════════════
const vec = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);

function face(o: V3, u: V3, v: V3, w: number, h: number): Face {
  const n = u.clone().cross(v).normalize();
  return { o, u: u.clone().normalize(), v: v.clone().normalize(), w, h, n };
}

export interface Part { name: string; paint: boolean; faces: Face[]; tris?: V3[][] }

/** axis-aligned (optionally yawed) box → faces (+x, −x, +y, +z, −z; never the bottom) */
function boxFaces(min: V3, max: V3, yawDeg = 0, pivot?: V3, which = 'all'): Face[] {
  const [x0, y0, z0] = [min.x, min.y, min.z];
  const [x1, y1, z1] = [max.x, max.y, max.z];
  const W = x1 - x0, H = y1 - y0, D = z1 - z0;
  const fs: Face[] = [];
  if (which === 'all' || which.includes('top')) fs.push(face(vec(x0, y1, z1), vec(1, 0, 0), vec(0, 0, -1), W, D));
  if (which === 'all' || which.includes('pz')) fs.push(face(vec(x0, y0, z1), vec(1, 0, 0), vec(0, 1, 0), W, H));
  if (which === 'all' || which.includes('nz')) fs.push(face(vec(x1, y0, z0), vec(-1, 0, 0), vec(0, 1, 0), W, H));
  if (which === 'all' || which.includes('px')) fs.push(face(vec(x1, y0, z1), vec(0, 0, -1), vec(0, 1, 0), D, H));
  if (which === 'all' || which.includes('nx')) fs.push(face(vec(x0, y0, z0), vec(0, 0, 1), vec(0, 1, 0), D, H));
  if (yawDeg !== 0) {
    const c = pivot ?? vec((x0 + x1) / 2, y0, (z0 + z1) / 2);
    const q = new THREE.Quaternion().setFromAxisAngle(vec(0, 1, 0), THREE.MathUtils.degToRad(yawDeg));
    for (const f of fs) {
      f.o.sub(c).applyQuaternion(q).add(c);
      f.u.applyQuaternion(q); f.v.applyQuaternion(q); f.n.applyQuaternion(q);
    }
  }
  return fs;
}

function buildGeometry(part: Part, atlas: BenchAtlas | null): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], uv1: number[] = [], idx: number[] = [];
  for (const f of part.faces) {
    const r = atlas ? atlas.alloc(f) : null;
    const base = pos.length / 3;
    const corners: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [s, t] of corners) {
      const p = f.o.clone().addScaledVector(f.u, s * f.w).addScaledVector(f.v, t * f.h);
      pos.push(p.x, p.y, p.z);
      nor.push(f.n.x, f.n.y, f.n.z);
      uv.push(s * f.w, t * f.h);
      if (r) uv1.push((r.x0 + s * r.tw) / S, (r.y0 + t * r.th) / S); else uv1.push(0, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const tri of part.tris ?? []) {
    const base = pos.length / 3;
    const n = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])).normalize();
    for (const p of tri) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(p.x, p.y); uv1.push(0, 0); }
    idx.push(base, base + 1, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// the test pier
// ════════════════════════════════════════════════════════════════════════════════════════════
const PLATE = { x0: -16, x1: 16, z0: -12, z1: 12 };

function benchParts(): Part[] {
  const parts: Part[] = [];
  // court plate (paintable top) + concrete skirt (not paintable)
  parts.push({ name: 'M_tile', paint: true, faces: boxFaces(vec(PLATE.x0, -1.8, PLATE.z0), vec(PLATE.x1, 0, PLATE.z1), 0, undefined, 'top') });
  parts.push({ name: 'M_concrete', paint: false, faces: boxFaces(vec(PLATE.x0, -1.8, PLATE.z0), vec(PLATE.x1, 0, PLATE.z1), 0, undefined, 'pz nz px nx') });
  // concrete wall (drips on its −z face)
  parts.push({ name: 'M_concrete', paint: true, faces: boxFaces(vec(4, 0, 3.7), vec(12, 1.2, 4.3)) });
  // crates
  parts.push({ name: 'M_crate', paint: true, faces: boxFaces(vec(-3.6, 0, 1.9), vec(-2.4, 1.2, 3.1), 15) });
  parts.push({ name: 'M_crate', paint: true, faces: boxFaces(vec(-3.8, 1.2, 1.9), vec(-2.8, 2.2, 2.9), -10) });
  parts.push({ name: 'M_crate', paint: true, faces: boxFaces(vec(4.9, 0, -3.1), vec(6.0, 1.1, -2.0), 22) });
  // chevron wall
  parts.push({ name: 'M_chevron', paint: true, faces: boxFaces(vec(-12, 0, -4.3), vec(-6, 1.1, -3.7)) });
  // hazard curb along the south edge
  parts.push({ name: 'M_hazard', paint: true, faces: boxFaces(vec(PLATE.x0, 0, PLATE.z0), vec(PLATE.x1, 0.35, PLATE.z0 + 0.4), 0, undefined, 'top pz') });
  // boardwalk deck + ramp (rises toward −z onto the deck)
  parts.push({ name: 'M_boardwalk', paint: true, faces: boxFaces(vec(10, 0, -11), vec(15.6, 1.0, -3)) });
  {
    const rampTop = face(vec(11, 0, 1), vec(1, 0, 0), vec(0, 1.0, -4), 4, Math.hypot(1.0, 4));
    parts.push({ name: 'M_boardwalk', paint: true, faces: [rampTop] });
    parts.push({ name: 'M_boardwalk', paint: false, faces: [], tris: [
      [vec(11, 0, 1), vec(11, 1.0, -3), vec(11, 0, -3)],
      [vec(15, 0, 1), vec(15, 0, -3), vec(15, 1.0, -3)],
    ] });
  }
  // planter (slatted sides + rim paintable) with soil
  {
    const c = vec(7, 0, -7), hw = 1.1, h = 0.7, rim = 0.16;
    parts.push({ name: 'M_planter', paint: true, faces: boxFaces(vec(c.x - hw, 0, c.z - hw), vec(c.x + hw, h, c.z + hw), 0, undefined, 'pz nz px nx') });
    parts.push({ name: 'M_planter', paint: true, faces: [
      face(vec(c.x - hw, h, c.z + hw), vec(1, 0, 0), vec(0, 0, -1), 2 * hw, rim),
      face(vec(c.x - hw, h, c.z - hw + rim), vec(1, 0, 0), vec(0, 0, -1), 2 * hw, rim),
      face(vec(c.x - hw, h, c.z + hw - rim), vec(1, 0, 0), vec(0, 0, -1), rim, 2 * hw - 2 * rim),
      face(vec(c.x + hw - rim, h, c.z + hw - rim), vec(1, 0, 0), vec(0, 0, -1), rim, 2 * hw - 2 * rim),
    ] });
    parts.push({ name: 'M_soil', paint: false, faces: [face(vec(c.x - hw + rim, h - 0.08, c.z + hw - rim), vec(1, 0, 0), vec(0, 0, -1), 2 * (hw - rim), 2 * (hw - rim))] });
    const ih = 0.08, iw = 2 * (hw - rim);
    parts.push({ name: 'M_planter', paint: false, faces: [
      face(vec(c.x - hw + rim, h - ih, c.z - hw + rim), vec(1, 0, 0), vec(0, 1, 0), iw, ih),
      face(vec(c.x + hw - rim, h - ih, c.z + hw - rim), vec(-1, 0, 0), vec(0, 1, 0), iw, ih),
      face(vec(c.x - hw + rim, h - ih, c.z + hw - rim), vec(0, 0, -1), vec(0, 1, 0), iw, ih),
      face(vec(c.x + hw - rim, h - ih, c.z - hw + rim), vec(0, 0, 1), vec(0, 1, 0), iw, ih),
    ] });
  }
  return parts;
}

// ── paint content: organic blobs, droplets and wall drips (world space) ─────────────────────
interface Splat { c: V3; r: number; team: Team; drip?: number; seed: number }

function splats(): Splat[] {
  const s: Splat[] = [];
  let seed = 1;
  const add = (x: number, y: number, z: number, r: number, team: Team, drip = 0) => s.push({ c: vec(x, y, z), r, team, drip, seed: seed++ });
  // GULF area beyond mid-court (painted first, so SUNCREW lobes bite into it → direct crew border)
  add(0.5, 0, 1.2, 2.6, 2); add(2.8, 0, 2.6, 1.8, 2); add(-1.5, 0, 3.2, 1.6, 2); add(3.6, 0, 0.2, 1.0, 2);
  // SUNCREW puddle under/ahead of the runner + lobes + a trail
  add(0.2, 0, -5.2, 2.2, 1); add(1.6, 0, -3.4, 1.3, 1); add(-1.5, 0, -6.5, 1.2, 1);
  add(-3.0, 0, -3.0, 0.9, 1); add(-4.2, 0, -1.8, 0.7, 1); add(-5.1, 0, -0.9, 0.45, 1);
  add(1.9, 0, -1.2, 1.1, 1); // bites into the GULF area
  // puddle across the centre-circle line
  add(-8.5, 0, 5.8, 1.5, 1); add(-6.9, 0, 7.1, 0.8, 2);
  // boardwalk + ramp
  add(12.5, 1.0, -6.0, 1.4, 2); add(13.0, 0.5, -1.5, 0.9, 1);
  // walls with drips
  add(7.0, 0.85, 3.7, 0.85, 1, 0.75); add(10.0, 0.6, 3.7, 0.6, 2, 0.5); add(8.4, 1.2, 4.0, 0.5, 1);
  add(-8.0, 0.55, -4.3, 0.7, 1, 0.5); add(-10.6, 0.8, -4.3, 0.45, 2, 0.4);
  // crates, curb, planter rim
  add(-3.3, 0.9, 2.0, 0.6, 2); add(5.4, 0.8, -3.0, 0.5, 1); add(-2.0, 0.2, -11.8, 0.8, 2); add(6.0, 0.7, -5.9, 0.5, 1);
  // droplets around the floor splats
  const floor = s.filter((q) => q.c.y === 0 && q.r > 0.7);
  for (const q of floor) {
    const nd = 5 + (hashU(q.seed, 7) % 5);
    for (let k = 0; k < nd; k++) {
      const a = hash01(q.seed, k, 1) * Math.PI * 2;
      const d = q.r * (1.08 + 0.5 * hash01(q.seed, k, 2));
      const r = 0.05 + 0.1 * hash01(q.seed, k, 3);
      s.push({ c: vec(q.c.x + Math.cos(a) * d, 0, q.c.z + Math.sin(a) * d), r, team: q.team, seed: seed++ });
    }
  }
  return s;
}

function paintAtlas(atlas: BenchAtlas): void {
  const list = splats();
  const e = 0.2;
  for (let id = 0; id < atlas.count; id++) {
    const x = atlas.px[id], y = atlas.py[id], z = atlas.pz[id];
    const wall = Math.abs(atlas.ny[id]) < 0.6;
    let team: Team = 0;
    for (const q of list) {
      const dx = x - q.c.x, dy = y - q.c.y, dz = z - q.c.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > q.r * 1.25 + (q.drip ? q.drip + q.r : 0)) continue;   // cannot reach: skip the noise
      const n = vnoise3(x * 1.7 / q.r + q.seed * 3.1, y * 1.7 / q.r, z * 1.7 / q.r) * 0.7 + hash01(id, q.seed) * 0.3;
      const reff = q.r * (1 - e + 2 * e * n);
      let hit = d <= reff;
      if (!hit && q.drip && wall && y < q.c.y) {
        // vertical drips below a wall splat: tapered streaks ending in a bead
        const tx = -atlas.nz[id], tz = atlas.nx[id];              // horizontal tangent of this wall
        const along = dx * tx + dz * tz;
        const depth = q.c.y - y;
        const off = Math.abs(dx * atlas.nx[id] + dz * atlas.nz[id]); // distance off the wall plane
        if (off < 0.05) {
          for (let k = 0; k < 4; k++) {
            const ox = (hash01(q.seed, k, 11) - 0.5) * 1.3 * q.r;
            const L = q.r * 0.4 + q.drip * (0.35 + 0.65 * hash01(q.seed, k, 12));
            const w = 0.045 + 0.04 * hash01(q.seed, k, 13);
            const width = w * (1 - 0.45 * Math.min(1, depth / L));
            if (depth < L && Math.abs(along - ox) < width) { hit = true; break; }
            const bead = Math.hypot(along - ox, depth - L);
            if (bead < w * 1.25) { hit = true; break; }
          }
        }
      }
      if (hit) team = q.team;
    }
    atlas.team[id] = team;
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// cameras
// ════════════════════════════════════════════════════════════════════════════════════════════
function camPose(name: CamName): { pos: V3; target: V3 } {
  switch (name) {
    case 'close': return { pos: vec(1.3, 1.25, -8.7), target: vec(0.4, 0, -6.2) };
    case 'wide': return { pos: vec(-17, 8.5, -19), target: vec(1, 0, 0) };
    case 'wall': return { pos: vec(7.4, 1.5, -0.4), target: vec(8.0, 0.7, 3.7) };
    case 'low': return { pos: vec(-3.0, 0.9, 1.6), target: vec(1.0, 0, -3.4) };
    case 'top': return { pos: vec(0, 34, -0.01), target: vec(0, 0, 0) };
    case 'player':
    default: {
      // DESIGN §2 follow cam: pivot 1.35 m, distance 4.3 m, shoulder 0.42 m right, rest pitch −14°;
      // the runner stands at (0, 0, −6.5) facing +Z inside the SUNCREW puddle
      const pitch = THREE.MathUtils.degToRad(14);
      const pivot = vec(-0.42, 1.35, -6.5);
      const pos = pivot.clone().add(vec(0, Math.sin(pitch) * 4.3, -Math.cos(pitch) * 4.3));
      return { pos, target: pos.clone().add(vec(0, -Math.sin(pitch), Math.cos(pitch)).multiplyScalar(10)) };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════════════════════
/** Pure bench content (atlas, painted texels, geometry) — importable under Node for probes. */
export function buildBenchContent(): { atlas: BenchAtlas; parts: Part[]; geos: THREE.BufferGeometry[]; painter: BenchPainter } {
  const atlas = new BenchAtlas();
  const parts = benchParts();
  const geos = parts.map((p) => buildGeometry(p, p.paint ? atlas : null));
  atlas.finish();
  paintAtlas(atlas);
  return { atlas, parts, geos, painter: new BenchPainter(atlas) };
}

function main(): void {
  const errors: string[] = [];
  const errBox = document.getElementById('err') as HTMLPreElement;
  function reportError(msg: string): void {
    errors.push(msg);
    console.error('[lookbench]', msg);
    errBox.style.display = 'block';
    errBox.textContent = errors.join('\n\n');
  }
  window.addEventListener('error', (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => reportError(`unhandled: ${String((e as PromiseRejectionEvent).reason)}`));

  const canvas = document.getElementById('bench') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLDivElement;
  const tmLeft = document.getElementById('tm-left') as HTMLDivElement;
  const tmRight = document.getElementById('tm-right') as HTMLDivElement;
  const splitLine = document.getElementById('split-line') as HTMLDivElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [
      `program: ${gl.getProgramInfoLog(program) ?? ''}`,
      `vertex: ${gl.getShaderInfoLog(vs) ?? ''}`,
      `fragment: ${gl.getShaderInfoLog(fs) ?? ''}`,
    ].join('\n');
    reportError(`SHADER ERROR\n${log}`);
  };

  const TONE: Record<Exclude<ToneMode, 'split'>, THREE.ToneMapping> = {
    agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping,
  };
  const state = {
    preset: qs('preset', 'noon'),
    tone: (['split', 'agx', 'neutral', 'aces'].includes(qs('tm', qs('tonemap', 'split'))) ? qs('tm', qs('tonemap', 'split')) : 'split') as ToneMode,
    cam: (['player', 'close', 'wide', 'wall', 'low', 'top'].includes(qs('cam', 'player')) ? qs('cam', 'player') : 'player') as CamName,
    viewer: ([0, 1, 2].includes(Number(qs('viewer', '1'))) ? Number(qs('viewer', '1')) : 1) as Team,
    cb: qs('cb', '0') === '1',
    live: qs('live', '1') !== '0' && qs('freeze', '0') !== '1',
    freeze: qs('freeze', '0') === '1',
    ui: qs('ui', '1') !== '0',
  };

  const def = mapById('pier18');
  const presets = def.lighting?.presets ?? {};
  const presetOf = (name: string): LightingPreset => presets[name] ?? presets.noon ?? Object.values(presets)[0];

  let scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 1800);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  // atlas + paint
  const { atlas, parts, geos, painter } = buildBenchContent();
  const paint = new PaintTexture(atlas.asPaintAtlas());
  const dye: DyeUniforms = createDyeUniforms(paint);
  const plateRect = atlas.rects[0];

  // materials: one per (name, paint) like mapview's caches. The fallbacks mimic what GLTFLoader
  // hands mapview for the MAP lane's exported M_* materials (art/blender/common.py MATERIALS).
  const EXPORTED: Record<string, [string, number, number, number]> = {   // sRGB, roughness, metalness, emissive
    M_tile: ['#E9E1CF', 0.62, 0, 0], M_concrete: ['#CFC8BC', 0.86, 0, 0], M_boardwalk: ['#B8844F', 0.72, 0, 0],
    M_crate: ['#C77A3A', 0.7, 0, 0], M_chevron: ['#1FA9A1', 0.55, 0, 0], M_hazard: ['#FFC21A', 0.55, 0, 0],
    M_planter: ['#C8633B', 0.78, 0, 0], M_soil: ['#5B3B25', 0.95, 0, 0], M_metal: ['#4F5B6E', 0.42, 0.55, 0],
    M_pad_A: ['#FF8A1F', 0.35, 0, 0], M_pad_B: ['#5B4BF0', 0.35, 0, 0], M_lamp: ['#FFF2CF', 0.3, 0, 1.5],
  };
  const exportedFallback = (name: string): THREE.MeshStandardMaterial | null => {
    const e = EXPORTED[name];
    if (!e) return null;
    const m = new THREE.MeshStandardMaterial({ name, color: new THREE.Color(e[0]), roughness: e[1], metalness: e[2] });
    if (e[3] > 0) { m.emissive.set(e[0]); m.emissiveIntensity = e[3]; }
    return m;
  };
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  const surfOpts = { mapId: 'pier18', courtLines: def.courtLines };
  function mat(name: string, paintable: boolean): THREE.MeshStandardMaterial {
    const key = `${name}|${paintable ? 'dye' : '-'}`;
    let m = matCache.get(key);
    if (!m) {
      m = materialFor(name, exportedFallback(name), surfOpts);
      if (paintable) applyDye(m, dye);
      matCache.set(key, m);
    }
    return m;
  }

  let sky: SkyRig | null = null;
  let water: WaterRig | null = null;
  const world = new THREE.Group();
  world.name = 'bench_world';

  function buildWorld(): void {
    parts.forEach((p, i) => {
      const mesh = new THREE.Mesh(geos[i], mat(p.name, p.paint));
      mesh.name = `${p.paint ? 'paint' : 'solid'}_${p.name}_${i}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      world.add(mesh);
    });
    // spawn pads (not paintable): cylinders, rings re-centred on the bench positions
    const padGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.14, 72, 1);
    for (const [side, x, z] of [['A', -11, -8.8], ['B', 6.5, 8.5]] as const) {
      const m = materialFor(`M_pad_${side}`, exportedFallback(`M_pad_${side}`), surfOpts);
      const u = surfaceUniformsOf(m);
      (u.uPadCenter.value as V3).set(x, 0.14, z);
      const pad = new THREE.Mesh(padGeo, m);
      pad.position.set(x, 0.07, z);
      pad.receiveShadow = true;
      pad.name = `solid_pad_${side}`;
      world.add(pad);
    }
    // bollards + lamp post (metal)
    const bollard = new THREE.CylinderGeometry(0.13, 0.16, 0.85, 24);
    for (const z of [-6, 0, 6]) {
      const b = new THREE.Mesh(bollard, mat('M_metal', false));
      b.position.set(-15.4, 0.425, z);
      b.castShadow = b.receiveShadow = true;
      world.add(b);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 20), mat('M_metal', false));
    post.position.set(15.3, 1.7, 7);
    post.castShadow = true;
    world.add(post);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), mat('M_lamp', false));
    head.position.set(15.3, 3.45, 7);
    head.castShadow = true;
    world.add(head);
  }
  buildWorld();

  let heroMixer: THREE.AnimationMixer | null = null;
  if (qs('hero', '0') === '1') {
    new GLTFLoader().load(new URL('../../art/gltf/tide_runner.glb', import.meta.url).href, (g) => {
      g.scene.position.set(0, 0, -6.5);
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
      world.add(g.scene);
      const idle = g.animations.find((a) => a.name === 'idle');
      if (idle) { heroMixer = new THREE.AnimationMixer(g.scene); heroMixer.clipAction(idle).play(); }
    }, undefined, (e) => reportError(`hero load failed: ${String(e)}`));
  }

  function applyPreset(name: string): void {
    sky?.dispose();
    if (water) { scene.remove(water.mesh); water.mesh.geometry.dispose(); (water.mesh.material as THREE.Material).dispose(); }
    scene = new THREE.Scene();
    scene.add(world);
    const p = presetOf(name);
    sky = createSky(scene, renderer, p);
    water = createWater(scene, p, def.waterY ?? -1.4, sky.sunDir, { foamRect: [PLATE.x0, PLATE.z0, PLATE.x1, PLATE.z1] });
    state.preset = presets[name] ? name : 'noon';
  }
  applyPreset(state.preset);

  function setCam(name: CamName): void {
    const c = camPose(name);
    camera.position.copy(c.pos);
    controls.target.copy(c.target);
    camera.lookAt(c.target);
    controls.update();
    state.cam = name;
  }
  setCam(state.cam);

  function resize(): void {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ── keys ──
  const CAMS: CamName[] = ['player', 'close', 'wide', 'wall', 'low', 'top'];
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const ci = '123456'.indexOf(k);
    if (ci >= 0) setCam(CAMS[ci]);
    else if (k === 't') state.viewer = (state.viewer === 1 ? 2 : state.viewer === 2 ? 0 : 1) as Team;
    else if (k === 'c') state.cb = !state.cb;
    else if (k === 'p') applyPreset(state.preset === 'noon' ? 'golden' : 'noon');
    else if (k === 'm') state.tone = (['split', 'agx', 'neutral', 'aces'] as ToneMode[])[(['split', 'agx', 'neutral', 'aces'].indexOf(state.tone) + 1) % 4];
    else if (k === 'l') state.live = !state.live;
    else if (k === 'h') state.ui = !state.ui;
  });

  // ── loop ──
  const clock = new THREE.Clock();
  let time = state.freeze ? 12 : 0;
  let frames = 0;
  let lastRows = 0;
  let liveTeam: Team = 1;
  const focus = vec(0, 0.6, -6.5);

  function renderOnce(): void {
    if (state.tone === 'split') {
      // setScissor takes CSS pixels (three applies the pixel ratio)
      const cw = Math.max(1, window.innerWidth), ch = Math.max(1, window.innerHeight);
      const half = Math.floor(cw / 2);
      renderer.setScissorTest(true);
      renderer.toneMapping = TONE.agx;
      renderer.setScissor(0, 0, half, ch);
      renderer.render(scene, camera);
      renderer.toneMapping = TONE.neutral;
      renderer.setScissor(half, 0, cw - half, ch);
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
    } else {
      renderer.toneMapping = TONE[state.tone];
      renderer.render(scene, camera);
    }
  }

  function frame(): void {
    const dt = Math.min(0.1, clock.getDelta());
    if (!state.freeze) time += dt;
    controls.update();

    if (state.live) {
      const t = time;
      const cx = -8 + 3.0 * Math.cos(t * 0.55);
      const cz = -4 + 2.0 * Math.sin(t * 1.1);
      if (Math.floor(t / 8) % 2 === 1) liveTeam = 2; else liveTeam = 1;
      painter.brush(plateRect, cx, cz, 0.55, liveTeam);
    }
    lastRows = paint.upload(painter as unknown as Painter);

    dye.uViewerTeam.value = state.viewer;
    dye.uColorblind.value = state.cb ? 1 : 0;
    dye.uTime.value = time;
    sky?.update(state.freeze ? 0 : dt, camera, focus);
    water?.update(time, camera);
    heroMixer?.update(state.freeze ? 0 : dt);

    renderer.info.reset();
    renderOnce();
    frames++;

    const split = state.tone === 'split';
    splitLine.hidden = !split || !state.ui;
    tmLeft.hidden = tmRight.hidden = !split || !state.ui;
    tmLeft.textContent = 'AgX (previous default)';
    tmRight.textContent = 'Neutral (renderer.ts default)';
    hud.style.display = state.ui ? 'block' : 'none';
    if (state.ui && frames % 10 === 1) {
      hud.innerHTML = `<b>DYEFIELD look bench</b>  preset <b>${state.preset}</b> · tone <b>${state.tone}</b> · cam <b>${state.cam}</b>\n`
        + `viewer crew <b>${state.viewer === 1 ? 'SUNCREW' : state.viewer === 2 ? 'GULF CREW' : 'spectator'}</b> · colour-blind <b>${state.cb ? 'on' : 'off'}</b> · live brush <b>${state.live ? 'on' : 'off'}</b>\n`
        + `atlas ${S}² · ${atlas.count.toLocaleString()} surface texels · rows uploaded this frame ${lastRows} · flips ${painter.flips}\n`
        + `programs ${renderer.info.programs?.length ?? 0} · calls ${renderer.info.render.calls} · tris ${renderer.info.render.triangles.toLocaleString()}\n`
        + `keys: 1-6 camera · T crew · C colour-blind · P preset · M tone · L brush · H hud · drag to orbit`;
    }
    if (frames === 3) {
      look.ready = true;
      document.body.dataset.ready = '1';
    }
    look.frames = frames;
    requestAnimationFrame(frame);
  }

  // ── test surface ──
  interface LookSurface {
    ready: boolean; frames: number; errors: string[];
    info(): Record<string, unknown>;
    set(o: { preset?: string; tone?: ToneMode; cam?: CamName; viewer?: Team; cb?: boolean; live?: boolean; ui?: boolean }): void;
    shot(name: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  }
  const look: LookSurface = {
    ready: false,
    frames: 0,
    errors,
    info: () => ({
      preset: state.preset, tone: state.tone, cam: state.cam, viewer: state.viewer, colorblind: state.cb, live: state.live,
      atlasSize: S, texels: atlas.count, flips: painter.flips, lastRows, programs: renderer.info.programs?.length ?? 0,
      calls: renderer.info.render.calls, errors: errors.length,
    }),
    set: (o) => {
      if (o.preset && o.preset !== state.preset) applyPreset(o.preset);
      if (o.tone) state.tone = o.tone;
      if (o.cam) setCam(o.cam);
      if (o.viewer !== undefined) state.viewer = o.viewer;
      if (o.cb !== undefined) state.cb = o.cb;
      if (o.live !== undefined) state.live = o.live;
      if (o.ui !== undefined) state.ui = o.ui;
    },
    shot: async (name: string) => {
      try {
        dye.uViewerTeam.value = state.viewer;
        dye.uColorblind.value = state.cb ? 1 : 0;
        renderer.info.reset();
        renderOnce();
        const url = canvas.toDataURL('image/png');
        const safe = name.replace(/[^A-Za-z0-9_.-]+/g, '_');
        const r = await fetch(`/__shot/lookbench_${safe}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: url });
        const j = await r.json() as { ok: boolean; path?: string; error?: string };
        return j;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
  (window as unknown as { __LOOK__: LookSurface }).__LOOK__ = look;

  requestAnimationFrame(frame);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') main();
