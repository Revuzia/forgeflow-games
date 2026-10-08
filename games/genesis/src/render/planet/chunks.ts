// GENESIS — chunked terrain LOD over the 20 icosahedron faces (CONTRACT.md §4.2, §15.4).
//
// Each base face is a level-0 triangular patch; a patch splits into 4 children by edge midpoints (the middle child is
// the inverted one). Every patch is a PATCH_RES × PATCH_RES triangular lattice in FLAT face coordinates (units of the
// sim grid), so a render vertex belongs to sim triangle grid.locateFaceCoords(face, fi, fj) — the same rule as the CPU.
//
// Geometry is static per patch (fields are textures): per vertex
//   position = dir (unit), aCells = (cellA, cellB, cellC, wB), aMisc = (wC, detail, skirt, 0), aGrad = ∇detail,
// plus a GEOMORPH TARGET: odd lattice vertices collapse onto the midpoint of the two even neighbours along the coarse
// edge they split ((i±1, j), (i, j±1) or (i−1, j+1)/(i+1, j−1)), whose own cells / weights / dirs / coarse-filtered
// detail are stored too (aN1*, aN2*). The midpoint rule is symmetric, so two patches sharing an edge morph it
// identically, and at morph = 1 a patch is exactly its parent's mesh: LOD transitions never pop.
//
// Selection is screen-space error with hysteresis: a level-L patch with vertex spacing s splits when the camera is
// closer than K·size_L (K from viewport height, FOV and the quality's pixel error); vertices morph over the last ~28 %
// of their parent's range, which by construction ends where the coarser neighbour begins. Skirts hide the remaining
// transient cracks (e.g. while children are still being built under the per-frame budget).
//
// Detail relief: detailNoise (src/sim/grid/noise.ts) with Noise3(planet seed) — the function the CPU ground uses —
// baked per vertex, band-limited per level so coarse patches do not alias, at full strength from ~1 m spacing down.

import {
  BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Sphere, Vector3, Frustum, Mesh, type Group, type Material,
  type Matrix4,
} from 'three';
import type { IcoGrid } from '../../sim/grid/icogrid.ts';
import { newHit } from '../../sim/grid/icogrid.ts';
import { detailNoise, type Noise3 } from '../../sim/grid/noise.ts';

export const PATCH_RES = 32;
/** angle subtended by an icosahedron edge */
const ICO_EDGE = 1.1071487177940904;

// ───────────────────────────── shared topology ─────────────────────────────

const R = PATCH_RES;
const NPTS = ((R + 1) * (R + 2)) / 2;
const NSKIRT = 3 * R;
const NVERT = NPTS + NSKIRT;
const ptIndex = (i: number, j: number): number => j * (R + 1) - (j * (j - 1)) / 2 + i;

/** boundary lattice points in CCW order (A→B, B→C, C→A), 3R of them */
const BOUNDARY: [number, number][] = [];
for (let i = 0; i < R; i++) BOUNDARY.push([i, 0]);
for (let j = 0; j < R; j++) BOUNDARY.push([R - j, j]);
for (let j = R; j > 0; j--) BOUNDARY.push([0, j]);

let sharedIndex: Uint16BufferAttribute | null = null;
function indexBuffer(): Uint16BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const idx: number[] = [];
  for (let j = 0; j < R; j++) {
    for (let i = 0; i + j < R; i++) {
      idx.push(ptIndex(i, j), ptIndex(i + 1, j), ptIndex(i, j + 1));
      if (i + j < R - 1) idx.push(ptIndex(i + 1, j), ptIndex(i + 1, j + 1), ptIndex(i, j + 1));
    }
  }
  for (let k = 0; k < NSKIRT; k++) {
    const k1 = (k + 1) % NSKIRT;
    const p0 = ptIndex(BOUNDARY[k][0], BOUNDARY[k][1]);
    const p1 = ptIndex(BOUNDARY[k1][0], BOUNDARY[k1][1]);
    const s0 = NPTS + k, s1 = NPTS + k1;
    idx.push(p0, s0, p1, p1, s0, s1);
  }
  sharedIndex = new Uint16BufferAttribute(idx, 1);
  return sharedIndex;
}

/** the two even lattice neighbours an odd vertex morphs toward (both = self for even vertices) */
function morphNeighbours(i: number, j: number): [number, number, number, number] {
  const io = i & 1, jo = j & 1;
  if (!io && !jo) return [i, j, i, j];
  if (io && !jo) return [i - 1, j, i + 1, j];
  if (!io && jo) return [i, j - 1, i, j + 1];
  return [i - 1, j + 1, i + 1, j - 1];
}

/** band-limit weights for the two detail octaves (≈12 m and ≈3.2 m features) at a vertex spacing */
function detailWeights(spacing: number): [number, number] {
  const w = (feature: number) => Math.min(1, Math.max(0, (feature / spacing - 1.5) / 1.5));
  return [w(12), w(3.2)];
}

function filteredDetail(noise: Noise3, x: number, y: number, z: number, radius: number, w1: number, w2: number): number {
  if (w1 >= 1 && w2 >= 1) return detailNoise(noise, x, y, z, radius);
  if (w1 <= 0 && w2 <= 0) return 0;
  // the same two octaves as detailNoise, faded (identical to detailNoise when both weights are 1)
  const f1 = radius / 12;
  const f2 = radius / 3.2;
  let v = 0;
  if (w1 > 0) v += noise.noise(x * f1, y * f1, z * f1) * 1.6 * w1;
  if (w2 > 0) v += noise.noise(x * f2 + 31.7, y * f2, z * f2) * 0.35 * w2;
  return v;
}

// ───────────────────────────── patches ─────────────────────────────

export class Patch {
  readonly face: number;
  readonly level: number;
  /** flat face coordinates of the corners (units of the sim grid) */
  readonly a: [number, number];
  readonly b: [number, number];
  readonly c: [number, number];
  children: Patch[] | null = null;
  split = false;
  readonly centerDir = new Vector3();
  angRadius = 0;
  hMin = 0;
  hMax = 0;
  hasWater = false;
  boundsVersion = -1;
  cells: Int32Array | null = null;
  geometry: BufferGeometry | null = null;
  mesh: Mesh | null = null;
  waterMesh: Mesh | null = null;
  lastUsed = 0;
  readonly sphere = new Sphere();

  constructor(face: number, level: number, a: [number, number], b: [number, number], c: [number, number]) {
    this.face = face; this.level = level; this.a = a; this.b = b; this.c = c;
  }

  makeChildren(): Patch[] {
    if (this.children) return this.children;
    const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const ab = mid(this.a, this.b), bc = mid(this.b, this.c), ca = mid(this.c, this.a);
    const L = this.level + 1;
    this.children = [
      new Patch(this.face, L, this.a, ab, ca),
      new Patch(this.face, L, ab, this.b, bc),
      new Patch(this.face, L, ca, bc, this.c),
      new Patch(this.face, L, bc, ca, ab),
    ];
    return this.children;
  }
}

export interface ChunkMaterials {
  terrain(level: number): Material;
  water(level: number): Material;
}

export interface ChunkSelectContext {
  /** camera position in the planet BODY frame (m) */
  camBody: Vector3;
  /** camera frustum in world (camera-relative) space */
  frustum: Frustum;
  /** body → world (camera-relative) transform of the planet group */
  bodyToWorld: Matrix4;
  /** split distance factor: a level-L patch splits when closer than K · size_L */
  K: number;
  frame: number;
  /** max patches built this frame */
  buildBudget: number;
}

const _v = new Vector3();
const _hit = newHit();

/** Water and ground arrays the chunk system reads for bounds (kept by FieldTextures). */
export interface ChunkFieldSource {
  surface: ArrayLike<number> | null;
  waterLevel: Float32Array;
  waterDepth: Float32Array;
  geomVersion: number;
}

export class ChunkLOD {
  readonly grid: IcoGrid;
  readonly noise: Noise3;
  readonly radius: number;
  readonly roots: Patch[] = [];
  readonly maxLevel: number;
  /** metres per lattice step at level 0 */
  readonly spacing0: number;
  selected: Patch[] = [];
  /** meshes become children of this group (the planet's body-frame group) */
  private group: Group;
  private mats: ChunkMaterials;
  private fields: ChunkFieldSource;
  private live = new Set<Patch>();
  private built = 0;
  private builtThisFrame = 0;
  maxCached = 1400;
  terrainLayerMask = 0;
  castShadows = false;
  waterEnabled = true;
  stats = { patches: 0, waterPatches: 0, builtTotal: 0 };

  constructor(grid: IcoGrid, noise: Noise3, radius: number, group: Group, mats: ChunkMaterials, fields: ChunkFieldSource) {
    this.grid = grid; this.noise = noise; this.radius = radius; this.group = group; this.mats = mats; this.fields = fields;
    const n = grid.n;
    for (let f = 0; f < 20; f++) this.roots.push(new Patch(f, 0, [0, 0], [n, 0], [0, n]));
    this.spacing0 = (ICO_EDGE * radius) / R;
    // deepest level: lattice spacing ≈ 0.8 m (the 3.2 m detail octave is then fully resolved)
    this.maxLevel = Math.max(0, Math.ceil(Math.log2(this.spacing0 / 0.8)));
  }

  /** metres per lattice step at a level */
  spacing(level: number): number { return this.spacing0 / (1 << level); }
  /** approximate patch edge length (m) */
  size(level: number): number { return this.spacing(level) * R; }

  // ── bounds ──

  private flatDir(face: number, fi: number, fj: number, out: Vector3): Vector3 {
    const fc = this.grid.faceCorners;
    const n = this.grid.n;
    const u = fi / n, v = fj / n;
    const o = face * 9;
    out.set(
      fc[o] + (fc[o + 3] - fc[o]) * u + (fc[o + 6] - fc[o]) * v,
      fc[o + 1] + (fc[o + 4] - fc[o + 1]) * u + (fc[o + 7] - fc[o + 1]) * v,
      fc[o + 2] + (fc[o + 5] - fc[o + 2]) * u + (fc[o + 8] - fc[o + 2]) * v,
    );
    return out.normalize();
  }

  private patchCells(p: Patch): Int32Array {
    if (p.cells) return p.cells;
    const g = this.grid;
    const n = g.n;
    const xs = [p.a[0], p.b[0], p.c[0]], ys = [p.a[1], p.b[1], p.c[1]];
    const i0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), i1 = Math.min(n, Math.ceil(Math.max(...xs)) + 1);
    const j0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), j1 = Math.min(n, Math.ceil(Math.max(...ys)) + 1);
    const out: number[] = [];
    const st = g.gridStride, row = n + 1, base = p.face * st;
    // barycentric inside test with a one-cell margin (so shore cells across the border count)
    const ax = p.a[0], ay = p.a[1];
    const e1x = p.b[0] - ax, e1y = p.b[1] - ay, e2x = p.c[0] - ax, e2y = p.c[1] - ay;
    const det = e1x * e2y - e1y * e2x;
    const size = Math.sqrt(Math.abs(det));
    const margin = 1.6 / Math.max(size, 1e-6);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1 && i + j <= n; i++) {
        const dx = i - ax, dy = j - ay;
        const u = (dx * e2y - dy * e2x) / det;
        const v = (e1x * dy - e1y * dx) / det;
        if (u < -margin || v < -margin || u + v > 1 + margin) continue;
        out.push(g.faceGrid[base + j * row + i]);
      }
    }
    // tiny patches may contain no lattice point: use the cells of the sim triangle under the centroid
    if (out.length === 0) {
      g.locateFaceCoords(p.face, (p.a[0] + p.b[0] + p.c[0]) / 3, (p.a[1] + p.b[1] + p.c[1]) / 3, _hit);
      out.push(_hit.a, _hit.b, _hit.c);
    }
    p.cells = Int32Array.from(out);
    return p.cells;
  }

  private updateBounds(p: Patch): void {
    if (p.boundsVersion === this.fields.geomVersion && p.boundsVersion >= 0) return;
    p.boundsVersion = this.fields.geomVersion;
    const da = this.flatDir(p.face, p.a[0], p.a[1], new Vector3());
    const db = this.flatDir(p.face, p.b[0], p.b[1], new Vector3());
    const dc = this.flatDir(p.face, p.c[0], p.c[1], new Vector3());
    p.centerDir.copy(da).add(db).add(dc).normalize();
    p.angRadius = Math.max(p.centerDir.angleTo(da), p.centerDir.angleTo(db), p.centerDir.angleTo(dc)) * 1.04 + 1e-5;
    const cells = this.patchCells(p);
    const s = this.fields.surface;
    const wl = this.fields.waterLevel, wd = this.fields.waterDepth;
    let lo = Infinity, hi = -Infinity, water = false;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const h = s ? s[c] : 0;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      if (wd[c] > 0.02 || wl[c] > h - 0.5) {
        water = true;
        if (wl[c] > hi) hi = wl[c];
      }
    }
    // detail relief (±~2 m) and the coarse lattice cutting inside a sim triangle's plane
    p.hMin = lo - 2.5;
    p.hMax = hi + 2.5;
    p.hasWater = water;
    const rMid = this.radius + 0.5 * (p.hMin + p.hMax);
    const chord = 2 * Math.sin(p.angRadius / 2) * (this.radius + p.hMax);
    p.sphere.center.copy(p.centerDir).multiplyScalar(rMid);
    p.sphere.radius = Math.hypot(chord, 0.5 * (p.hMax - p.hMin)) + this.skirtDepth(p.level);
    if (p.geometry) {
      if (!p.geometry.boundingSphere) p.geometry.boundingSphere = new Sphere();
      p.geometry.boundingSphere.copy(p.sphere);
    }
  }

  skirtDepth(level: number): number {
    return Math.max(1.5, this.spacing(level) * 1.5);
  }

  /** closest distance from the camera (body frame) to the patch's shell sector */
  private boundDistance(p: Patch, cam: Vector3, rc: number): number {
    const cosT = rc > 0 ? Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc)) : 1;
    const th = Math.max(0, Math.acos(cosT) - p.angRadius);
    const r0 = this.radius + p.hMin, r1 = this.radius + p.hMax;
    const rho = Math.min(r1, Math.max(r0, rc * Math.cos(th)));
    return Math.sqrt(Math.max(0, rc * rc + rho * rho - 2 * rc * rho * Math.cos(th)));
  }

  /** false if the planet itself hides the whole patch (two tangent cones to the occluding sphere) */
  private aboveHorizon(p: Patch, cam: Vector3, rc: number, rOcc: number): boolean {
    if (rc <= rOcc) return true;
    const cosT = Math.min(1, Math.max(-1, cam.dot(p.centerDir) / rc));
    const th = Math.max(0, Math.acos(cosT) - p.angRadius);
    const rTop = this.radius + p.hMax;
    if (rTop <= rOcc) return th < 1e-3;
    const aCam = Math.acos(rOcc / rc);
    const aPt = Math.acos(rOcc / rTop);
    return th < aCam + aPt;
  }

  // ── geometry ──

  private buildGeometry(p: Patch): BufferGeometry {
    const g = this.grid;
    const noise = this.noise;
    const radius = this.radius;
    const sp = this.spacing(p.level);
    const [w1, w2] = detailWeights(sp);
    const [pw1, pw2] = p.level > 0 ? detailWeights(sp * 2) : [w1, w2];
    // extended lattice (2 rings beyond the patch) for central-difference gradients at both resolutions
    const E = 2;
    const W = R + 1 + 2 * E;
    const ext = (i: number, j: number) => (j + E) * W + (i + E);
    const dirs = new Float64Array(W * W * 3);
    const dOwn = new Float64Array(W * W);
    const dPar = new Float64Array(W * W);
    const has = new Uint8Array(W * W);
    const fiOf = (i: number, j: number) => p.a[0] + ((p.b[0] - p.a[0]) * i) / R + ((p.c[0] - p.a[0]) * j) / R;
    const fjOf = (i: number, j: number) => p.a[1] + ((p.b[1] - p.a[1]) * i) / R + ((p.c[1] - p.a[1]) * j) / R;
    for (let j = -E; j <= R + E; j++) {
      for (let i = -E; i <= R + E; i++) {
        if (i + j > R + E || i + j < -E) continue;
        const k = ext(i, j);
        this.flatDir(p.face, fiOf(i, j), fjOf(i, j), _v);
        dirs[k * 3] = _v.x; dirs[k * 3 + 1] = _v.y; dirs[k * 3 + 2] = _v.z;
        dOwn[k] = filteredDetail(noise, _v.x, _v.y, _v.z, radius, w1, w2);
        dPar[k] = (pw1 === w1 && pw2 === w2) ? dOwn[k] : filteredDetail(noise, _v.x, _v.y, _v.z, radius, pw1, pw2);
        has[k] = 1;
      }
    }
    // tangent gradient of the detail from lattice differences: solve g·u = Du, g·v = Dv with g in span(u, v)
    const grad = (i: number, j: number, step: number, d: Float64Array, out: number[]): void => {
      const kp = ext(i + step, j), km = ext(i - step, j), lp = ext(i, j + step), lm = ext(i, j - step);
      if (!has[kp] || !has[km] || !has[lp] || !has[lm]) { out[0] = out[1] = out[2] = 0; return; }
      const ux = (dirs[kp * 3] - dirs[km * 3]) * radius, uy = (dirs[kp * 3 + 1] - dirs[km * 3 + 1]) * radius, uz = (dirs[kp * 3 + 2] - dirs[km * 3 + 2]) * radius;
      const vx = (dirs[lp * 3] - dirs[lm * 3]) * radius, vy = (dirs[lp * 3 + 1] - dirs[lm * 3 + 1]) * radius, vz = (dirs[lp * 3 + 2] - dirs[lm * 3 + 2]) * radius;
      const Du = d[kp] - d[km], Dv = d[lp] - d[lm];
      const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const det = uu * vv - uv * uv || 1e-12;
      const a = (Du * vv - Dv * uv) / det;
      const b = (Dv * uu - Du * uv) / det;
      out[0] = a * ux + b * vx; out[1] = a * uy + b * vy; out[2] = a * uz + b * vz;
    };

    const pos = new Float32Array(NVERT * 3);
    const aCells = new Float32Array(NVERT * 4);
    const aMisc = new Float32Array(NVERT * 4);
    const aGrad = new Float32Array(NVERT * 3);
    const aN1 = new Float32Array(NVERT * 4);
    const aN1m = new Float32Array(NVERT * 4);
    const aN1d = new Float32Array(NVERT * 3);
    const aN2 = new Float32Array(NVERT * 4);
    const aN2m = new Float32Array(NVERT * 4);
    const aN2d = new Float32Array(NVERT * 3);
    const aGradM = new Float32Array(NVERT * 3);

    // per lattice point: cells / weights (own) — computed once, referenced by neighbours' morph targets
    const cellA = new Float32Array(NPTS), cellB = new Float32Array(NPTS), cellC = new Float32Array(NPTS);
    const wB = new Float32Array(NPTS), wC = new Float32Array(NPTS);
    const gPar = new Float32Array(NPTS * 3);
    const tmp = [0, 0, 0];
    for (let j = 0; j <= R; j++) {
      for (let i = 0; i + j <= R; i++) {
        const v = ptIndex(i, j);
        g.locateFaceCoords(p.face, fiOf(i, j), fjOf(i, j), _hit);
        cellA[v] = _hit.a; cellB[v] = _hit.b; cellC[v] = _hit.c;
        // locateFaceCoords returns (a, b, c, wa, wb, wc); shaders use wA = 1 − wB − wC
        wB[v] = _hit.wb; wC[v] = _hit.wc;
        if (((i | j) & 1) === 0) {
          grad(i, j, 2, dPar, tmp);
          gPar[v * 3] = tmp[0]; gPar[v * 3 + 1] = tmp[1]; gPar[v * 3 + 2] = tmp[2];
        }
      }
    }
    const writeVertex = (dst: number, i: number, j: number, skirt: number): void => {
      const v = ptIndex(i, j);
      const k = ext(i, j);
      pos[dst * 3] = dirs[k * 3]; pos[dst * 3 + 1] = dirs[k * 3 + 1]; pos[dst * 3 + 2] = dirs[k * 3 + 2];
      aCells[dst * 4] = cellA[v]; aCells[dst * 4 + 1] = cellB[v]; aCells[dst * 4 + 2] = cellC[v]; aCells[dst * 4 + 3] = wB[v];
      aMisc[dst * 4] = wC[v]; aMisc[dst * 4 + 1] = dOwn[k]; aMisc[dst * 4 + 2] = skirt; aMisc[dst * 4 + 3] = 0;
      grad(i, j, 1, dOwn, tmp);
      aGrad[dst * 3] = tmp[0]; aGrad[dst * 3 + 1] = tmp[1]; aGrad[dst * 3 + 2] = tmp[2];
      const [i1, j1, i2, j2] = morphNeighbours(i, j);
      const v1 = ptIndex(i1, j1), v2 = ptIndex(i2, j2);
      const k1 = ext(i1, j1), k2 = ext(i2, j2);
      aN1[dst * 4] = cellA[v1]; aN1[dst * 4 + 1] = cellB[v1]; aN1[dst * 4 + 2] = cellC[v1]; aN1[dst * 4 + 3] = wB[v1];
      aN1m[dst * 4] = wC[v1]; aN1m[dst * 4 + 1] = dPar[k1];
      aN1d[dst * 3] = dirs[k1 * 3]; aN1d[dst * 3 + 1] = dirs[k1 * 3 + 1]; aN1d[dst * 3 + 2] = dirs[k1 * 3 + 2];
      aN2[dst * 4] = cellA[v2]; aN2[dst * 4 + 1] = cellB[v2]; aN2[dst * 4 + 2] = cellC[v2]; aN2[dst * 4 + 3] = wB[v2];
      aN2m[dst * 4] = wC[v2]; aN2m[dst * 4 + 1] = dPar[k2];
      aN2d[dst * 3] = dirs[k2 * 3]; aN2d[dst * 3 + 1] = dirs[k2 * 3 + 1]; aN2d[dst * 3 + 2] = dirs[k2 * 3 + 2];
      aGradM[dst * 3] = 0.5 * (gPar[v1 * 3] + gPar[v2 * 3]);
      aGradM[dst * 3 + 1] = 0.5 * (gPar[v1 * 3 + 1] + gPar[v2 * 3 + 1]);
      aGradM[dst * 3 + 2] = 0.5 * (gPar[v1 * 3 + 2] + gPar[v2 * 3 + 2]);
    };
    for (let j = 0; j <= R; j++) for (let i = 0; i + j <= R; i++) writeVertex(ptIndex(i, j), i, j, 0);
    for (let k = 0; k < NSKIRT; k++) writeVertex(NPTS + k, BOUNDARY[k][0], BOUNDARY[k][1], 1);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('aCells', new Float32BufferAttribute(aCells, 4));
    geo.setAttribute('aMisc', new Float32BufferAttribute(aMisc, 4));
    geo.setAttribute('aGrad', new Float32BufferAttribute(aGrad, 3));
    geo.setAttribute('aN1', new Float32BufferAttribute(aN1, 4));
    geo.setAttribute('aN1m', new Float32BufferAttribute(aN1m, 4));
    geo.setAttribute('aN1d', new Float32BufferAttribute(aN1d, 3));
    geo.setAttribute('aN2', new Float32BufferAttribute(aN2, 4));
    geo.setAttribute('aN2m', new Float32BufferAttribute(aN2m, 4));
    geo.setAttribute('aN2d', new Float32BufferAttribute(aN2d, 3));
    geo.setAttribute('aGradM', new Float32BufferAttribute(aGradM, 3));
    geo.setIndex(indexBuffer());
    geo.boundingSphere = p.sphere.clone();
    return geo;
  }

  private ensureGeometry(p: Patch, budget: boolean): boolean {
    if (p.geometry) return true;
    if (budget && this.builtThisFrame >= this.buildBudgetNow) return false;
    this.updateBounds(p);
    p.geometry = this.buildGeometry(p);
    this.builtThisFrame++;
    this.built++;
    this.stats.builtTotal++;
    const m = new Mesh(p.geometry, this.mats.terrain(p.level));
    m.matrixAutoUpdate = false;
    m.frustumCulled = true;
    m.castShadow = false;
    m.receiveShadow = false;
    m.visible = false;
    if (this.castShadows) m.layers.enable(1);
    m.userData.patchLevel = p.level;
    p.mesh = m;
    this.group.add(m);
    const w = new Mesh(p.geometry, this.mats.water(p.level));
    w.matrixAutoUpdate = false;
    w.frustumCulled = true;
    w.visible = false;
    w.layers.set(2); // drawn in the water pass only
    w.userData.patchLevel = p.level;
    p.waterMesh = w;
    this.group.add(w);
    this.live.add(p);
    return true;
  }

  private buildBudgetNow = 16;

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const p of this.live) {
      if (!p.mesh) continue;
      if (on) p.mesh.layers.enable(1); else p.mesh.layers.disable(1);
    }
  }

  // ── selection ──

  select(ctx: ChunkSelectContext): Patch[] {
    this.builtThisFrame = 0;
    this.buildBudgetNow = ctx.buildBudget;
    const out: Patch[] = [];
    const cam = ctx.camBody;
    const rc = cam.length();
    // occluder: the lowest ground anywhere (conservative)
    let rOcc = this.radius;
    for (const r of this.roots) { this.updateBounds(r); rOcc = Math.min(rOcc, this.radius + r.hMin); }
    rOcc -= 5;
    const visit = (p: Patch): void => {
      this.updateBounds(p);
      if (!this.aboveHorizon(p, cam, rc, rOcc)) { p.split = false; return; }
      _sphere.copy(p.sphere).applyMatrix4(ctx.bodyToWorld);
      if (!ctx.frustum.intersectsSphere(_sphere)) { p.split = false; return; }
      const d = this.boundDistance(p, cam, rc);
      const rSplit = ctx.K * this.size(p.level) * (p.split ? 1.12 : 1.0);
      let split = p.level < this.maxLevel && d < rSplit;
      if (split) {
        const kids = p.makeChildren();
        // split only when every child can be drawn this frame (never mix a parent with partial children)
        for (const k of kids) if (!this.ensureGeometry(k, true)) { split = false; break; }
      }
      if (split) {
        p.split = true;
        for (const k of p.children!) visit(k);
      } else {
        p.split = false;
        if (this.ensureGeometry(p, p.level > 1)) out.push(p);
        else if (p.level <= 1) out.push(p);
      }
    };
    for (const r of this.roots) visit(r);
    // visibility flags
    for (const p of this.selected) { if (p.mesh) p.mesh.visible = false; if (p.waterMesh) p.waterMesh.visible = false; }
    let water = 0;
    for (const p of out) {
      p.lastUsed = ctx.frame;
      if (p.mesh) p.mesh.visible = true;
      if (p.waterMesh) {
        p.waterMesh.visible = this.waterEnabled && p.hasWater;
        if (p.waterMesh.visible) water++;
      }
    }
    this.selected = out;
    this.stats.patches = out.length;
    this.stats.waterPatches = water;
    this.evict(ctx.frame);
    return out;
  }

  /** drop geometry of long-unused patches when over the cache budget */
  private evict(frame: number): void {
    if (this.live.size <= this.maxCached) return;
    const cands = [...this.live].filter((p) => frame - p.lastUsed > 120 && p.level > 1).sort((a, b) => a.lastUsed - b.lastUsed);
    const drop = this.live.size - this.maxCached + 64;
    for (let i = 0; i < Math.min(drop, cands.length); i++) {
      const p = cands[i];
      if (p.mesh) this.group.remove(p.mesh);
      if (p.waterMesh) this.group.remove(p.waterMesh);
      p.geometry?.dispose();
      p.geometry = null; p.mesh = null; p.waterMesh = null;
      this.live.delete(p);
    }
  }

  /** morph distances for a level: (full-morph distance, morph start) — infinity for level 0 */
  morphRange(level: number, K: number): [number, number] {
    if (level === 0) return [1e30, 1e30];
    const r = K * this.size(level - 1);
    return [r, r * 0.72];
  }

  dispose(): void {
    for (const p of this.live) {
      if (p.mesh) this.group.remove(p.mesh);
      if (p.waterMesh) this.group.remove(p.waterMesh);
      p.geometry?.dispose();
    }
    this.live.clear();
  }
}

const _sphere = new Sphere();
