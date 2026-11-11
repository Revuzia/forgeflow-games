// GENESIS — terrain patch vertex data (chunks.ts), as a pure function of (grid, noise, radius, patch corners).
//
// PERF (session 5): this is the costliest main-thread job of a camera move or cut (~0.3-1 ms a patch, up to 16 a
// frame), so it runs in a helper module worker (patchbuild.worker.ts) when there is one; the main thread only copies
// the finished arrays into its level's batch. The same code runs on the main thread for the first coarse levels, in
// node tests and where there is no worker, so the bytes are identical either way (tests/render-patchworker.test.ts:
// a fixed hash of the arrays, the hash of the code before it moved here). No three.js in here (the worker stays small).

import type { IcoGrid } from '../../sim/grid/icogrid.ts';
import { newHit } from '../../sim/grid/icogrid.ts';
import { detailNoise, duneNoise, DUNE_WAVELENGTH, type Noise3 } from '../../sim/grid/noise.ts';

export const PATCH_RES = 32;
/** angle subtended by an icosahedron edge */
export const ICO_EDGE = 1.1071487177940904;

const R = PATCH_RES;
export const NPTS = ((R + 1) * (R + 2)) / 2;
export const NSKIRT = 3 * R;
export const NVERT = NPTS + NSKIRT;
/** indices per patch: R² lattice triangles + two per skirt quad */
export const NINDEX = (R * R + 6 * R) * 3;
export const ptIndex = (i: number, j: number): number => j * (R + 1) - (j * (j - 1)) / 2 + i;

/** boundary lattice points in CCW order (A→B, B→C, C→A), 3R of them */
export const BOUNDARY: [number, number][] = [];
for (let i = 0; i < R; i++) BOUNDARY.push([i, 0]);
for (let j = 0; j < R; j++) BOUNDARY.push([R - j, j]);
for (let j = R; j > 0; j--) BOUNDARY.push([0, j]);

/** the vertex attributes of a patch, in a fixed order, with their item sizes ('position' doubles as 'normal') */
export const PATCH_ATTRS: readonly (readonly [name: AttrName, itemSize: number])[] = [
  ['position', 3], ['aCells', 4], ['aMisc', 4], ['aGrad', 3], ['aN1', 4], ['aN1m', 4], ['aN1d', 3],
  ['aN2', 4], ['aN2m', 4], ['aN2d', 3], ['aGradM', 3], ['aGradD', 3], ['aGradDM', 3],
];
export type AttrName = 'position' | 'aCells' | 'aMisc' | 'aGrad' | 'aN1' | 'aN1m' | 'aN1d' | 'aN2' | 'aN2m' | 'aN2d' | 'aGradM' | 'aGradD' | 'aGradDM';

/** a built patch: one array per PATCH_ATTRS entry (NVERT · itemSize floats) and the cells its vertices interpolate */
export interface PatchArrays {
  attrs: Float32Array[];
  vcells: Int32Array;
}

/** fresh (zeroed) output arrays for one patch */
export function newPatchAttrs(): Float32Array[] {
  return PATCH_ATTRS.map(([, s]) => new Float32Array(NVERT * s));
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

/** band-limit weight of the dunes at a vertex spacing (gone where the lattice cannot carry a 26 m ridge) */
function duneWeight(spacing: number): number {
  return Math.min(1, Math.max(0, (DUNE_WAVELENGTH / spacing - 2) / 1.5));
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

const _hit = newHit();

/** builds patches of one planet; keeps its working arrays (zeroed per build: no garbage per patch) */
export class PatchBuilder {
  readonly grid: IcoGrid;
  readonly noise: Noise3;
  readonly radius: number;
  /** metres per lattice step at level 0 */
  readonly spacing0: number;
  private scr = new Map<string, Float64Array | Float32Array | Uint8Array>();
  /** the main thread's output arrays (reused; the batch copies them) */
  private own: Float32Array[] | null = null;

  constructor(grid: IcoGrid, noise: Noise3, radius: number) {
    this.grid = grid; this.noise = noise; this.radius = radius;
    this.spacing0 = (ICO_EDGE * radius) / R;
  }

  private scratch<T extends Float64Array | Float32Array | Uint8Array>(name: string, Ctor: { new (n: number): T }, n: number): T {
    let a = this.scr.get(name) as T | undefined;
    if (!a || a.length !== n) { a = new Ctor(n); this.scr.set(name, a); } else a.fill(0);
    return a;
  }

  /** unit direction of flat face coordinates (exactly three's Vector3.normalize of the interpolated corner) */
  private flatDir(face: number, fi: number, fj: number, out: Float64Array, o3: number): void {
    const fc = this.grid.faceCorners;
    const n = this.grid.n;
    const u = fi / n, v = fj / n;
    const o = face * 9;
    const x = fc[o] + (fc[o + 3] - fc[o]) * u + (fc[o + 6] - fc[o]) * v;
    const y = fc[o + 1] + (fc[o + 4] - fc[o + 1]) * u + (fc[o + 7] - fc[o + 1]) * v;
    const z = fc[o + 2] + (fc[o + 5] - fc[o + 2]) * u + (fc[o + 8] - fc[o + 2]) * v;
    const s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    out[o3] = x * s; out[o3 + 1] = y * s; out[o3 + 2] = z * s;
  }

  /**
   * Build a patch's vertex data. `out`: arrays to write (zeroed here; a worker passes recycled ones); default the
   * builder's own reused arrays (valid until the next build on this builder).
   */
  build(face: number, level: number, a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], out?: Float32Array[]): PatchArrays {
    const g = this.grid;
    const noise = this.noise;
    const radius = this.radius;
    const sp = this.spacing0 / (1 << level);
    const [w1, w2] = detailWeights(sp);
    const [pw1, pw2] = level > 0 ? detailWeights(sp * 2) : [w1, w2];
    // extended lattice (2 rings beyond the patch) for central-difference gradients at both resolutions
    const E = 2;
    const W = R + 1 + 2 * E;
    const ext = (i: number, j: number) => (j + E) * W + (i + E);
    const dirs = this.scratch('dirs', Float64Array, W * W * 3);
    const dOwn = this.scratch('dOwn', Float64Array, W * W);
    const dPar = this.scratch('dPar', Float64Array, W * W);
    // dunes (surface.ts: × the cells' dune amplitude), band-limited per level like the detail
    const uOwn = this.scratch('uOwn', Float64Array, W * W);
    const uPar = this.scratch('uPar', Float64Array, W * W);
    const wd = duneWeight(sp), pwd = level > 0 ? duneWeight(sp * 2) : wd;
    const has = this.scratch('has', Uint8Array, W * W);
    const fiOf = (i: number, j: number) => a[0] + ((b[0] - a[0]) * i) / R + ((c[0] - a[0]) * j) / R;
    const fjOf = (i: number, j: number) => a[1] + ((b[1] - a[1]) * i) / R + ((c[1] - a[1]) * j) / R;
    for (let j = -E; j <= R + E; j++) {
      for (let i = -E; i <= R + E; i++) {
        if (i + j > R + E || i + j < -E) continue;
        const k = ext(i, j);
        this.flatDir(face, fiOf(i, j), fjOf(i, j), dirs, k * 3);
        const x = dirs[k * 3], y = dirs[k * 3 + 1], z = dirs[k * 3 + 2];
        dOwn[k] = filteredDetail(noise, x, y, z, radius, w1, w2);
        dPar[k] = (pw1 === w1 && pw2 === w2) ? dOwn[k] : filteredDetail(noise, x, y, z, radius, pw1, pw2);
        const du = wd > 0 || pwd > 0 ? duneNoise(noise, x, y, z, radius) : 0;
        uOwn[k] = du * wd;
        uPar[k] = du * pwd;
        has[k] = 1;
      }
    }
    // tangent gradient of the detail from lattice differences: solve g·u = Du, g·v = Dv with g in span(u, v)
    const grad = (i: number, j: number, step: number, d: Float64Array, o: number[]): void => {
      const kp = ext(i + step, j), km = ext(i - step, j), lp = ext(i, j + step), lm = ext(i, j - step);
      if (!has[kp] || !has[km] || !has[lp] || !has[lm]) { o[0] = o[1] = o[2] = 0; return; }
      const ux = (dirs[kp * 3] - dirs[km * 3]) * radius, uy = (dirs[kp * 3 + 1] - dirs[km * 3 + 1]) * radius, uz = (dirs[kp * 3 + 2] - dirs[km * 3 + 2]) * radius;
      const vx = (dirs[lp * 3] - dirs[lm * 3]) * radius, vy = (dirs[lp * 3 + 1] - dirs[lm * 3 + 1]) * radius, vz = (dirs[lp * 3 + 2] - dirs[lm * 3 + 2]) * radius;
      const Du = d[kp] - d[km], Dv = d[lp] - d[lm];
      const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const det = uu * vv - uv * uv || 1e-12;
      const ga = (Du * vv - Dv * uv) / det;
      const gb = (Dv * uu - Du * uv) / det;
      o[0] = ga * ux + gb * vx; o[1] = ga * uy + gb * vy; o[2] = ga * uz + gb * vz;
    };

    let attrs = out;
    if (!attrs) { attrs = this.own ??= newPatchAttrs(); }
    for (const arr of attrs) arr.fill(0);
    const [pos, aCells, aMisc, aGrad, aN1, aN1m, aN1d, aN2, aN2m, aN2d, aGradM, aGradD, aGradDM] = attrs;

    // per lattice point: cells / weights (own) — computed once, referenced by neighbours' morph targets
    const cellA = this.scratch('cellA', Float32Array, NPTS), cellB = this.scratch('cellB', Float32Array, NPTS), cellC = this.scratch('cellC', Float32Array, NPTS);
    const wB = this.scratch('wB', Float32Array, NPTS), wC = this.scratch('wC', Float32Array, NPTS);
    const gPar = this.scratch('gPar', Float32Array, NPTS * 3);
    const gParD = this.scratch('gParD', Float32Array, NPTS * 3);
    const tmp = [0, 0, 0];
    for (let j = 0; j <= R; j++) {
      for (let i = 0; i + j <= R; i++) {
        const v = ptIndex(i, j);
        g.locateFaceCoords(face, fiOf(i, j), fjOf(i, j), _hit);
        cellA[v] = _hit.a; cellB[v] = _hit.b; cellC[v] = _hit.c;
        // locateFaceCoords returns (a, b, c, wa, wb, wc); shaders use wA = 1 − wB − wC
        wB[v] = _hit.wb; wC[v] = _hit.wc;
        if (((i | j) & 1) === 0) {
          grad(i, j, 2, dPar, tmp);
          gPar[v * 3] = tmp[0]; gPar[v * 3 + 1] = tmp[1]; gPar[v * 3 + 2] = tmp[2];
          grad(i, j, 2, uPar, tmp);
          gParD[v * 3] = tmp[0]; gParD[v * 3 + 1] = tmp[1]; gParD[v * 3 + 2] = tmp[2];
        }
      }
    }
    const writeVertex = (dst: number, i: number, j: number, skirt: number): void => {
      const v = ptIndex(i, j);
      const k = ext(i, j);
      pos[dst * 3] = dirs[k * 3]; pos[dst * 3 + 1] = dirs[k * 3 + 1]; pos[dst * 3 + 2] = dirs[k * 3 + 2];
      aCells[dst * 4] = cellA[v]; aCells[dst * 4 + 1] = cellB[v]; aCells[dst * 4 + 2] = cellC[v]; aCells[dst * 4 + 3] = wB[v];
      aMisc[dst * 4] = wC[v]; aMisc[dst * 4 + 1] = dOwn[k]; aMisc[dst * 4 + 2] = skirt; aMisc[dst * 4 + 3] = uOwn[k];
      grad(i, j, 1, dOwn, tmp);
      aGrad[dst * 3] = tmp[0]; aGrad[dst * 3 + 1] = tmp[1]; aGrad[dst * 3 + 2] = tmp[2];
      grad(i, j, 1, uOwn, tmp);
      aGradD[dst * 3] = tmp[0]; aGradD[dst * 3 + 1] = tmp[1]; aGradD[dst * 3 + 2] = tmp[2];
      const [i1, j1, i2, j2] = morphNeighbours(i, j);
      const v1 = ptIndex(i1, j1), v2 = ptIndex(i2, j2);
      const k1 = ext(i1, j1), k2 = ext(i2, j2);
      aN1[dst * 4] = cellA[v1]; aN1[dst * 4 + 1] = cellB[v1]; aN1[dst * 4 + 2] = cellC[v1]; aN1[dst * 4 + 3] = wB[v1];
      aN1m[dst * 4] = wC[v1]; aN1m[dst * 4 + 1] = dPar[k1]; aN1m[dst * 4 + 2] = uPar[k1];
      aN1d[dst * 3] = dirs[k1 * 3]; aN1d[dst * 3 + 1] = dirs[k1 * 3 + 1]; aN1d[dst * 3 + 2] = dirs[k1 * 3 + 2];
      aN2[dst * 4] = cellA[v2]; aN2[dst * 4 + 1] = cellB[v2]; aN2[dst * 4 + 2] = cellC[v2]; aN2[dst * 4 + 3] = wB[v2];
      aN2m[dst * 4] = wC[v2]; aN2m[dst * 4 + 1] = dPar[k2]; aN2m[dst * 4 + 2] = uPar[k2];
      aN2d[dst * 3] = dirs[k2 * 3]; aN2d[dst * 3 + 1] = dirs[k2 * 3 + 1]; aN2d[dst * 3 + 2] = dirs[k2 * 3 + 2];
      aGradM[dst * 3] = 0.5 * (gPar[v1 * 3] + gPar[v2 * 3]);
      aGradM[dst * 3 + 1] = 0.5 * (gPar[v1 * 3 + 1] + gPar[v2 * 3 + 1]);
      aGradM[dst * 3 + 2] = 0.5 * (gPar[v1 * 3 + 2] + gPar[v2 * 3 + 2]);
      aGradDM[dst * 3] = 0.5 * (gParD[v1 * 3] + gParD[v2 * 3]);
      aGradDM[dst * 3 + 1] = 0.5 * (gParD[v1 * 3 + 1] + gParD[v2 * 3 + 1]);
      aGradDM[dst * 3 + 2] = 0.5 * (gParD[v1 * 3 + 2] + gParD[v2 * 3 + 2]);
    };
    for (let j = 0; j <= R; j++) for (let i = 0; i + j <= R; i++) writeVertex(ptIndex(i, j), i, j, 0);
    for (let k = 0; k < NSKIRT; k++) writeVertex(NPTS + k, BOUNDARY[k][0], BOUNDARY[k][1], 1);
    // the distinct cells the vertices interpolate (morph targets are lattice points of this patch too)
    const seen = new Set<number>();
    for (let v = 0; v < NPTS; v++) { seen.add(cellA[v]); seen.add(cellB[v]); seen.add(cellC[v]); }
    return { attrs, vcells: Int32Array.from(seen) };
  }
}

// ---- the worker protocol (patchbuild.worker.ts runs handlePatchMessage; tests run it in-process) ----

export type PatchRequest =
  | { k: 'init'; id: number; gridN: number; seed: number | string; radius: number }
  | { k: 'build'; id: number; seq: number; face: number; level: number; a: [number, number]; b: [number, number]; c: [number, number]; recycle: ArrayBuffer[] }
  | { k: 'drop'; id: number };
export interface PatchReply { id: number; seq: number; attrs: Float32Array[]; vcells: Int32Array }

/** a worker's builders (one per planet, keyed by id) and its free output buffers (handed back by the main thread) */
export interface PatchState { builders: Map<number, PatchBuilder>; free: ArrayBuffer[][]; makeGrid(n: number): IcoGrid; makeNoise(seed: number | string): Noise3 }

export function handlePatchMessage(state: PatchState, m: PatchRequest): { reply: PatchReply; transfer: ArrayBuffer[] } | null {
  if (m.k === 'init') { state.builders.set(m.id, new PatchBuilder(state.makeGrid(m.gridN), state.makeNoise(m.seed), m.radius)); return null; }
  if (m.k === 'drop') { state.builders.delete(m.id); return null; }
  if (m.recycle.length === PATCH_ATTRS.length) state.free.push(m.recycle);
  const b = state.builders.get(m.id);
  if (!b) return null;
  const bufs = state.free.pop();
  const out = bufs ? bufs.map((buf) => new Float32Array(buf)) : newPatchAttrs();
  const r = b.build(m.face, m.level, m.a, m.b, m.c, out);
  return { reply: { id: m.id, seq: m.seq, attrs: r.attrs, vcells: r.vcells }, transfer: [...r.attrs.map((x) => x.buffer as ArrayBuffer), r.vcells.buffer as ArrayBuffer] };
}
