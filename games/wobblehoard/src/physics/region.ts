// CUT2 (TRUE CUT, _spec/CUT2.md sections 3.2, 4.1 steps 1-3, 5.6): the pure geometry under a piece. PHYS, task P1a. No three, no DOM, no Math.random, no Date.
//   * the SOURCE SOLID S: the whole squishy's rest mesh at icosphere detail 4 (2562 vertices), built by the same `restPoint` recipe path as the sim mesh and
//     shifted into the whole's rest frame W (origin = the detail-3 whole's tributary-area centroid, i.e. `new SoftBody(genome).restLocal`'s frame). It is
//     the only geometry any piece is cut from, however many cuts deep. Cached per (species, size), LRU of 8.
//   * the RAY STACK: sorted crossings of S along a ray (uniform 14^3 grid over S's box, Moller-Trumbore, same-sign duplicates on a shared edge merged
//     by alternation) -> inside intervals, clipped by a cell's half-spaces; `exitDist` = the first exit of the region from a point inside it.
//   * `clipMesh`: the EXACT clip of a closed mesh by a plane (volume, centroid, second moments, aspect), tetrahedra from a point on the plane.
//   * `measureRegion` (volume + centroid by a ray integral from any origin), `starShare` (phi: the share of the volume that straight rays from a centre
//     reach) and `CentreSearch` (the deterministic, resumable centre search of step 3).
// Conventions: a CELL is the intersection of half-spaces `n . x >= d` (n unit, in W). A shell literal +id (side A of RestPlane k: n_k . x >= d_k) is
// (n_k, d_k); -id (side B) is (-n_k, -d_k). Hot functions take their ray from the module scratch RAY and return numbers through typed scratch (a double
// returned from a call the optimiser did not inline is boxed: one heap allocation each), so a build allocates only at its start.
import type { Genome } from '../core/genome.ts';
import type { PieceRegion } from '../contracts.ts';
import { buildIcosphere } from './mesh.ts';
import type { IcoMesh } from './mesh.ts';
import { meshVolume, physicsGenome, restPoint, restRadiusOf } from './shape.ts';

/* ───────────────────────────── cells ───────────────────────────── */

/** One convex cell: `np` half-spaces, 4 numbers each [nx, ny, nz, d], kept side n . x >= d. np = 0 is the whole. */
export interface RegionCell { np: number; pl: Float64Array }
export const WHOLE_CELL: RegionCell = { np: 0, pl: new Float64Array(0) };

/** Compile cell `k` of a shell region into half-spaces. Throws on a literal whose plane is missing (a caller bug, not a player-reachable state). */
export function compileCell(region: PieceRegion | undefined, k = 0): RegionCell {
  if (!region || !region.cells || region.cells.length === 0) return WHOLE_CELL;
  const lits = region.cells[k];
  if (!lits || lits.length === 0) return WHOLE_CELL;
  const pl = new Float64Array(lits.length * 4);
  for (let i = 0; i < lits.length; i++) {
    const id = Math.abs(lits[i]), sgn = lits[i] > 0 ? 1 : -1;
    let found = -1;
    for (let j = 0; j < region.planes.length; j++) if (region.planes[j].id === id) { found = j; break; }
    if (found < 0) throw new Error('region.ts: literal ' + lits[i] + ' names no plane');
    const p = region.planes[found];
    pl[i * 4] = sgn * p.n.x; pl[i * 4 + 1] = sgn * p.n.y; pl[i * 4 + 2] = sgn * p.n.z; pl[i * 4 + 3] = sgn * p.d;
  }
  return { np: lits.length, pl };
}

/* ───────────────────────────── scratch ───────────────────────────── */

/** The ray the hot functions read: ox, oy, oz, ux, uy, uz (u need not be unit but every caller passes a unit vector). */
export const RAY = new Float64Array(6);
/** Result scratch: OUT[0] = exit distance, OUT[1] = 1 when the ray found no exit (a numerical miss), OUT[2] = which plane ended it (-1 = S's skin). */
export const OUT = new Float64Array(4);   // OUT[3] = the nearest ENTERING crossing seen by the last trace (Infinity when none)
const CT = new Float64Array(1024);      // crossing parameters
const CS = new Int8Array(1024);         // +1 entering S, -1 exiting S
const IV = new Float64Array(1024);      // inside intervals a0, b0, a1, b1, ...
const TL = new Float64Array(1);         // trace's parameter limit (a double passed to a call this large is boxed)
const SP = new Float64Array(2);         // a cell's span along the ray
const TM = new Float64Array(8);         // DDA scratch
const MT_EPS = 1e-10, T_EPS = 1e-13;

/* ───────────────────────────── Fibonacci directions ───────────────────────────── */

const FIB = new Map<number, Float64Array>();
/** n near-uniform unit directions (3 per direction), deterministic. */
export function fibDirs(n: number): Float64Array {
  let d = FIB.get(n);
  if (!d) {
    d = new Float64Array(n * 3);
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * i + 1) / n, r = Math.sqrt(Math.max(0, 1 - z * z)), a = i * ga;
      d[i * 3] = r * Math.cos(a); d[i * 3 + 1] = z; d[i * 3 + 2] = r * Math.sin(a);
    }
    FIB.set(n, d);
  }
  return d;
}

/* ───────────────────────────── the source solid ───────────────────────────── */

const GRID = 14;
export interface Source {
  key: string;
  species: string;
  R0: number;
  nv: number; pos: Float64Array;         // S's vertices in W
  nt: number; tris: Uint32Array;
  tv: Float64Array;                      // per triangle: v0 (3), e1 (3), e2 (3)
  vol: number;                           // enclosed volume of S
  v3: number;                            // the detail-3 whole's rest volume = V3 (a piece's frac is its restVolume / V3)
  org: Float64Array;                     // the recipe's origin in W (= minus the detail-3 raw centroid): directions of the recipe are taken from here
  box: Float64Array;                     // min xyz, max xyz
  cs: Float64Array;                      // cell size xyz
  cellStart: Int32Array; cellTri: Int32Array;
  stamp: Int32Array; stampNo: Int32Array;
}

/** Raw (uncentred) rest points of the recipe on `mesh`, the tributary-area centroid and the volume: the first half of shape.ts buildRest. */
function rawRest(genome: Genome, mesh: IcoMesh): { p: Float64Array; c: Float64Array; vol: number } {
  const pg = physicsGenome(genome), R0 = restRadiusOf(pg), n = mesh.vertexCount, p = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) restPoint(pg.species, mesh.dirs[i * 3], mesh.dirs[i * 3 + 1], mesh.dirs[i * 3 + 2], R0, p, i * 3);
  const mass = new Float64Array(n), tris = mesh.tris;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
    mass[a] += area; mass[b] += area; mass[c] += area;
  }
  let msum = 0;
  for (let i = 0; i < n; i++) msum += mass[i];
  const c = new Float64Array(3);
  for (let i = 0; i < n; i++) { const m = (mass[i] * n) / msum; c[0] += m * p[i * 3]; c[1] += m * p[i * 3 + 1]; c[2] += m * p[i * 3 + 2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  return { p, c, vol: meshVolume(p, tris) };
}

const ICO = new Map<number, IcoMesh>();
/** Cached icosphere topology (shared; never mutate). */
export function icoOf(detail: number): IcoMesh {
  let m = ICO.get(detail);
  if (!m) { m = buildIcosphere(detail); ICO.set(detail, m); }
  return m;
}

const SOURCES: Source[] = [];
export function clearSources(): void { SOURCES.length = 0; }

/** The source solid of a genome's species and size (cached; LRU of 8). Allocates on a miss only. */
export function getSource(genome: Genome): Source {
  const pg = physicsGenome(genome), R0 = restRadiusOf(pg), key = pg.species + '|' + R0.toFixed(12);
  for (let i = 0; i < SOURCES.length; i++) {
    if (SOURCES[i].key === key) { const s = SOURCES[i]; if (i > 0) { SOURCES.splice(i, 1); SOURCES.unshift(s); } return s; }
  }
  const m3 = rawRest(genome, icoOf(3)), m4 = rawRest(genome, icoOf(4)), ico4 = icoOf(4);
  const nv = ico4.vertexCount, pos = m4.p;
  for (let i = 0; i < nv; i++) { pos[i * 3] -= m3.c[0]; pos[i * 3 + 1] -= m3.c[1]; pos[i * 3 + 2] -= m3.c[2]; }
  const tris = ico4.tris, nt = tris.length / 3, tv = new Float64Array(nt * 9);
  const box = new Float64Array(6);
  for (let k = 0; k < 3; k++) { box[k] = Infinity; box[3 + k] = -Infinity; }
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < box[k]) box[k] = v; if (v > box[3 + k]) box[3 + k] = v; }
  const pad = 1e-6 * R0;
  for (let k = 0; k < 3; k++) { box[k] -= pad; box[3 + k] += pad; }
  const cs = new Float64Array(3);
  for (let k = 0; k < 3; k++) cs[k] = (box[3 + k] - box[k]) / GRID;
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) {
      tv[t * 9 + k] = pos[a + k];
      tv[t * 9 + 3 + k] = pos[b + k] - pos[a + k];
      tv[t * 9 + 6 + k] = pos[c + k] - pos[a + k];
    }
  }
  // grid: triangle -> every cell its bounding box touches (counting pass, then fill)
  const G3 = GRID * GRID * GRID, cellStart = new Int32Array(G3 + 1);
  const lo = new Int32Array(3), hi = new Int32Array(3);
  const span = (t: number): void => {
    for (let k = 0; k < 3; k++) {
      const a = pos[tris[t * 3] * 3 + k], b = pos[tris[t * 3 + 1] * 3 + k], c = pos[tris[t * 3 + 2] * 3 + k];
      const mn = Math.min(a, b, c), mx = Math.max(a, b, c);
      lo[k] = Math.max(0, Math.min(GRID - 1, Math.floor((mn - box[k]) / cs[k])));
      hi[k] = Math.max(0, Math.min(GRID - 1, Math.floor((mx - box[k]) / cs[k])));
    }
  };
  for (let t = 0; t < nt; t++) {
    span(t);
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) cellStart[(z * GRID + y) * GRID + x + 1]++;
  }
  for (let i = 0; i < G3; i++) cellStart[i + 1] += cellStart[i];
  const cellTri = new Int32Array(cellStart[G3]), fill = new Int32Array(G3);
  for (let t = 0; t < nt; t++) {
    span(t);
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
      const c = (z * GRID + y) * GRID + x;
      cellTri[cellStart[c] + fill[c]++] = t;
    }
  }
  const org = new Float64Array([-m3.c[0], -m3.c[1], -m3.c[2]]);
  const s: Source = {
    key, species: pg.species, R0, nv, pos, nt, tris, tv, vol: m4.vol, v3: m3.vol, org, box, cs, cellStart, cellTri,
    stamp: new Int32Array(nt), stampNo: new Int32Array(1),
  };
  SOURCES.unshift(s);
  if (SOURCES.length > 8) SOURCES.length = 8;
  return s;
}

/* ───────────────────────────── the ray stack ───────────────────────────── */

/** Walk the grid along RAY from t = 0 (forward only) and collect S's crossings with t > T_EPS into CT / CS (unsorted). tLimit stops the walk. With
 *  `exitOnly`, stop as soon as the nearest exit-type crossing is certain (no later cell can hold a nearer one) and return it in OUT[0] (else Infinity). Returns the
 *  number of crossings collected. */
function trace(S: Source, exitOnly: boolean): number {
  const tLimit = TL[0];
  const ox = RAY[0], oy = RAY[1], oz = RAY[2], ux = RAY[3], uy = RAY[4], uz = RAY[5];
  const box = S.box, cs = S.cs;
  let t0 = 0, t1 = tLimit;
  for (let k = 0; k < 3; k++) {
    const o = RAY[k], u = RAY[3 + k], mn = box[k], mx = box[3 + k];
    if (u > -1e-300 && u < 1e-300) { if (o < mn || o > mx) { OUT[0] = Infinity; OUT[3] = Infinity; return 0; } continue; }
    let a = (mn - o) / u, b = (mx - o) / u;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
  }
  OUT[0] = Infinity; OUT[3] = Infinity;
  if (t0 > t1) return 0;
  // DDA setup (TM: 0..2 = next boundary parameter per axis, 3..5 = step parameter per axis)
  let ix = 0, iy = 0, iz = 0;
  const stepx = ux > 0 ? 1 : -1, stepy = uy > 0 ? 1 : -1, stepz = uz > 0 ? 1 : -1;
  {
    const px = ox + ux * t0, py = oy + uy * t0, pz = oz + uz * t0;
    ix = Math.max(0, Math.min(GRID - 1, Math.floor((px - box[0]) / cs[0])));
    iy = Math.max(0, Math.min(GRID - 1, Math.floor((py - box[1]) / cs[1])));
    iz = Math.max(0, Math.min(GRID - 1, Math.floor((pz - box[2]) / cs[2])));
    TM[0] = ux > 1e-300 || ux < -1e-300 ? t0 + ((box[0] + (ux > 0 ? ix + 1 : ix) * cs[0]) - px) / ux : Infinity;
    TM[1] = uy > 1e-300 || uy < -1e-300 ? t0 + ((box[1] + (uy > 0 ? iy + 1 : iy) * cs[1]) - py) / uy : Infinity;
    TM[2] = uz > 1e-300 || uz < -1e-300 ? t0 + ((box[2] + (uz > 0 ? iz + 1 : iz) * cs[2]) - pz) / uz : Infinity;
    TM[3] = ux > 1e-300 || ux < -1e-300 ? cs[0] / Math.abs(ux) : Infinity;
    TM[4] = uy > 1e-300 || uy < -1e-300 ? cs[1] / Math.abs(uy) : Infinity;
    TM[5] = uz > 1e-300 || uz < -1e-300 ? cs[2] / Math.abs(uz) : Infinity;
  }
  const tv = S.tv, cellStart = S.cellStart, cellTri = S.cellTri, stamp = S.stamp;
  const sn = ++S.stampNo[0];
  let nc = 0, bestExit = Infinity, bestEnter = Infinity;
  for (;;) {
    const c = (iz * GRID + iy) * GRID + ix;
    for (let j = cellStart[c], je = cellStart[c + 1]; j < je; j++) {
      const k = cellTri[j];
      if (stamp[k] === sn) continue;
      stamp[k] = sn;
      const b = k * 9;
      const e1x = tv[b + 3], e1y = tv[b + 4], e1z = tv[b + 5], e2x = tv[b + 6], e2y = tv[b + 7], e2z = tv[b + 8];
      const px = uy * e2z - uz * e2y, py = uz * e2x - ux * e2z, pz = ux * e2y - uy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-18 && det < 1e-18) continue;
      const inv = 1 / det, tx = ox - tv[b], ty = oy - tv[b + 1], tz = oz - tv[b + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < -MT_EPS || u > 1 + MT_EPS) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (ux * qx + uy * qy + uz * qz) * inv;
      if (v < -MT_EPS || u + v > 1 + MT_EPS) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t <= T_EPS || t > t1) continue;
      if (nc < 1023) { CT[nc] = t; CS[nc] = det > 0 ? 1 : -1; nc++; }
      if (det < 0) { if (t < bestExit) bestExit = t; } else if (t < bestEnter) bestEnter = t;
    }
    // advance to the next cell
    let ax = 0, tn = TM[0];
    if (TM[1] < tn) { ax = 1; tn = TM[1]; }
    if (TM[2] < tn) { ax = 2; tn = TM[2]; }
    if (exitOnly && bestExit <= tn + 1e-12) break;
    if (tn > t1) break;
    if (ax === 0) { ix += stepx; if (ix < 0 || ix >= GRID) break; TM[0] += TM[3]; }
    else if (ax === 1) { iy += stepy; if (iy < 0 || iy >= GRID) break; TM[1] += TM[4]; }
    else { iz += stepz; if (iz < 0 || iz >= GRID) break; TM[2] += TM[5]; }
  }
  OUT[0] = bestExit; OUT[3] = bestEnter;
  return nc;
}

/** The cell's span along RAY for t >= 0: SP[0] = lo, SP[1] = hi. False when empty. */
function cellSpan(cell: RegionCell): boolean {
  const ox = RAY[0], oy = RAY[1], oz = RAY[2], ux = RAY[3], uy = RAY[4], uz = RAY[5], pl = cell.pl;
  let lo = 0, hi = Infinity;
  for (let p = 0; p < cell.np; p++) {
    const q = p * 4, s0 = pl[q] * ox + pl[q + 1] * oy + pl[q + 2] * oz - pl[q + 3], den = pl[q] * ux + pl[q + 1] * uy + pl[q + 2] * uz;
    if (den > 1e-14) { const t = -s0 / den; if (t > lo) lo = t; }
    else if (den < -1e-14) { const t = s0 / -den; if (t < hi) hi = t; }
    else if (s0 < 0) return false;
  }
  SP[0] = lo; SP[1] = hi;
  return lo < hi;
}

/** Which plane of the cell ends the ray at parameter t (the one whose crossing is nearest t), -1 when none is within 1e-9 R0 of it. */
function planeAt(cell: RegionCell): number {
  const t = OUT[0];
  const ox = RAY[0], oy = RAY[1], oz = RAY[2], ux = RAY[3], uy = RAY[4], uz = RAY[5], pl = cell.pl;
  let best = -1, bd = 1e-9;
  for (let p = 0; p < cell.np; p++) {
    const q = p * 4, s = pl[q] * (ox + ux * t) + pl[q + 1] * (oy + uy * t) + pl[q + 2] * (oz + uz * t) - pl[q + 3], a = s < 0 ? -s : s;
    if (a < bd) { bd = a; best = p; }
  }
  return best;
}

/** First exit of (S cut by the cell) along RAY from a point inside it (0 when the point is outside S). Result in OUT[0]; OUT[1] = 1 when nothing was found (OUT[0] = 0); OUT[2] = the cell
 *  plane that ended the ray, or -1 when S's skin did. `verify`: the origin may be outside S (a vertex on the skin); a ray that finds no crossing before the cell's plane
 *  is then checked against S's parity. Allocation-free. */
export function exitDist(S: Source, cell: RegionCell, verify = false): void {
  OUT[1] = 0; OUT[2] = -1;
  if (!cellSpan(cell)) { OUT[0] = 0; return; }
  const hi = SP[1];
  TL[0] = hi;
  trace(S, true);
  const be = OUT[0];
  if (OUT[3] < be) { OUT[0] = 0; return; }   // the nearest crossing is an ENTRY: the origin is outside S (on or a hair beyond its skin): nothing to leave
  if (be < hi) { OUT[0] = be; OUT[2] = -1; return; }
  if (hi < Infinity) {
    // no crossing of S before the cell's plane: the ray is inside S up to the plane ... or entirely outside S. A caller whose origin is not known to be inside S asks to `verify`:
    // the nearest crossing anywhere along the ray must then be an exit.
    if (verify) {
      TL[0] = Infinity;
      const nc = trace(S, false);
      let first = Infinity, fs = 0;
      for (let i = 0; i < nc; i++) if (CT[i] < first || (CT[i] === first && CS[i] < fs)) { first = CT[i]; fs = CS[i]; }
      if (nc === 0 || fs > 0) { OUT[0] = 0; OUT[1] = 0; OUT[2] = -1; return; }
    }
    OUT[0] = hi; OUT[2] = planeAt(cell); return;
  }
  OUT[0] = 0; OUT[1] = 1;
}

/** Sort the first nc crossings by t (insertion; ties: entering first). */
function sortCrossings(nc: number): void {
  for (let i = 1; i < nc; i++) {
    const t = CT[i], s = CS[i];
    let j = i - 1;
    while (j >= 0 && (CT[j] > t || (CT[j] === t && CS[j] < s))) { CT[j + 1] = CT[j]; CS[j + 1] = CS[j]; j--; }
    CT[j + 1] = t; CS[j + 1] = s;
  }
}

/** S's inside intervals along RAY for t >= 0, clipped by the cell, into IV (a0, b0, a1, b1, ...). Returns the interval count. The inside state at t = 0 is read from
 *  the sign of the first crossing (a closed surface: an exit first means the origin is inside), and entering-while-inside / exiting-while-outside crossings
 *  (the duplicate hit on a shared edge) are skipped, so the list always alternates. */
export function regionIntervals(S: Source, cell: RegionCell): number {
  if (!cellSpan(cell)) return 0;
  const lo = SP[0], hi = SP[1];
  TL[0] = Infinity;
  const nc = trace(S, false);   // (no limit at hi: the inside state at t = 0 is read from the nearest crossing, wherever it is)
  if (nc === 0) return 0;
  sortCrossings(nc);
  let inside = CS[0] < 0, start = 0, n = 0;
  for (let i = 0; i < nc; i++) {
    const s = CS[i];
    if (s > 0 && !inside) { inside = true; start = CT[i]; }
    else if (s < 0 && inside) {
      inside = false;
      const a = start > lo ? start : lo, b = CT[i] < hi ? CT[i] : hi;
      if (b - a > 1e-12 && n < 1020) { IV[n * 2] = a; IV[n * 2 + 1] = b; n++; }
    }
  }
  if (inside) { const a = start > lo ? start : lo; if (hi - a > 1e-12 && hi < Infinity && n < 1020) { IV[n * 2] = a; IV[n * 2 + 1] = hi; n++; } }
  return n;
}
export const intervalBuffer = IV;

const PD = new Float64Array([0.2672612419124244, 0.5345224838248488, 0.8017837257372732]);
/** True when the point is inside S (parity along a fixed oblique direction). Uses RAY. */
export function insideS(S: Source, x: number, y: number, z: number): boolean {
  RAY[0] = x; RAY[1] = y; RAY[2] = z; RAY[3] = PD[0]; RAY[4] = PD[1]; RAY[5] = PD[2];
  TL[0] = Infinity;
  const nc = trace(S, false);
  if (nc === 0) return false;
  let first = Infinity, fs = 0;
  for (let i = 0; i < nc; i++) if (CT[i] < first || (CT[i] === first && CS[i] < fs)) { first = CT[i]; fs = CS[i]; }
  return fs < 0;
}
/** True when the point satisfies every half-space of the cell to `tol`. */
export function insideCell(cell: RegionCell, x: number, y: number, z: number, tol = 0): boolean {
  const pl = cell.pl;
  for (let p = 0; p < cell.np; p++) { const q = p * 4; if (pl[q] * x + pl[q + 1] * y + pl[q + 2] * z - pl[q + 3] < -tol) return false; }
  return true;
}

/* ───────────────────────────── region measures ───────────────────────────── */

const MR = new Float64Array(8);
/** Volume and centroid of (S cut by the cell) by the ray integral from the origin (ox, oy, oz), valid for ANY origin and any shape (4.1 step 2):
 *  V = 1/3 int sum(b^3 - a^3) dOmega, c = o + (1/4 int sum(b^4 - a^4) u dOmega) / V. nDirs Fibonacci directions. out: [V, cx, cy, cz]. */
export function measureRegion(S: Source, cell: RegionCell, ox: number, oy: number, oz: number, nDirs: number, out: Float64Array): void {
  const dirs = fibDirs(nDirs), w = (4 * Math.PI) / nDirs;
  let v = 0, mx = 0, my = 0, mz = 0;
  for (let i = 0; i < nDirs; i++) {
    RAY[0] = ox; RAY[1] = oy; RAY[2] = oz; RAY[3] = dirs[i * 3]; RAY[4] = dirs[i * 3 + 1]; RAY[5] = dirs[i * 3 + 2];
    const m = regionIntervals(S, cell);
    let s3 = 0, s4 = 0;
    for (let k = 0; k < m; k++) { const a = IV[k * 2], b = IV[k * 2 + 1]; s3 += b * b * b - a * a * a; s4 += b * b * b * b - a * a * a * a; }
    v += s3; mx += s4 * dirs[i * 3]; my += s4 * dirs[i * 3 + 1]; mz += s4 * dirs[i * 3 + 2];
  }
  v *= w / 3;
  out[0] = v;
  if (v > 1e-12) { out[1] = ox + (mx * w) / 4 / v; out[2] = oy + (my * w) / 4 / v; out[3] = oz + (mz * w) / 4 / v; } else { out[1] = ox; out[2] = oy; out[3] = oz; }
}

/** The centroid of (S cut by the cell): two passes of `measureRegion` (the second from the first's centroid, where the rays cross fewer intervals). */
export function regionCentroid(S: Source, cell: RegionCell, nDirs: number, out: Float64Array): void {
  measureRegion(S, cell, 0, 0, 0, nDirs, MR);
  measureRegion(S, cell, MR[1], MR[2], MR[3], nDirs, out);
}

/** The region's volume (ray quadrature from c) AND phi(c) from the SAME nDirs rays: out[0] = V, out[1] = the share of it that rays from c reach (the interval that
 *  starts at the origin). With one set of rays the quadrature error cancels in the ratio (a convex region gives phi = 1 exactly). Used by a build whose centre is
 *  given (the planCut centroid): one pass instead of a 600-ray measure plus a 360-ray phi. */
export function starVolume(S: Source, cell: RegionCell, cx: number, cy: number, cz: number, nDirs: number, out: Float64Array): void {
  const dirs = fibDirs(nDirs), w = (4 * Math.PI) / nDirs;
  let all = 0, reached = 0;
  for (let i = 0; i < nDirs; i++) {
    RAY[0] = cx; RAY[1] = cy; RAY[2] = cz; RAY[3] = dirs[i * 3]; RAY[4] = dirs[i * 3 + 1]; RAY[5] = dirs[i * 3 + 2];
    const m = regionIntervals(S, cell);
    for (let k = 0; k < m; k++) {
      const a = IV[k * 2], b = IV[k * 2 + 1], v = b * b * b - a * a * a;
      all += v;
      if (k === 0 && a <= 1e-12) reached += v;
    }
  }
  out[0] = (all * w) / 3; out[1] = all > 0 ? reached / all : 0;
}

/** phi(c) (4.1 step 3): the share of the region's volume V that straight rays from c reach, (1/V)(1/3) int exit(c, u)^3 dOmega over nDirs directions.
 *  0 when c is outside the region. */
export function starShare(S: Source, cell: RegionCell, cx: number, cy: number, cz: number, V: number, nDirs: number): number {
  if (!insideCell(cell, cx, cy, cz, 1e-12) || !insideS(S, cx, cy, cz)) return 0;
  const dirs = fibDirs(nDirs), w = (4 * Math.PI) / nDirs;
  let s = 0;
  for (let i = 0; i < nDirs; i++) {
    RAY[0] = cx; RAY[1] = cy; RAY[2] = cz; RAY[3] = dirs[i * 3]; RAY[4] = dirs[i * 3 + 1]; RAY[5] = dirs[i * 3 + 2];
    exitDist(S, cell);
    const e = OUT[0];
    s += e * e * e;
  }
  return V > 0 ? (s * w) / 3 / V : 0;
}

/** The deterministic, resumable centre search (4.1 step 3): a 160-point scan of S's box (the R3 low-discrepancy sequence), then a 5-round pattern search
 *  (six axis neighbours per round, the step halves each round), at most 190 evaluations of phi. `run(maxEvals)` does at most that many and returns true when
 *  finished. After it: `best` = [x, y, z], `phi`, and `sound = phi >= 0.95`. */
export class CentreSearch {
  readonly best = new Float64Array(3);
  phi = 0;
  evals = 0;
  private phase = 0;          // 0 scan, 1 pattern, 2 done
  private idx = 0;
  private round = 0;
  private step = 0;
  private roundBest = 0;
  private readonly cur = new Float64Array(3);
  private readonly cand = new Float64Array(3);
  private readonly roundPt = new Float64Array(3);
  private readonly S: Source;
  private readonly cell: RegionCell;
  private readonly V: number;
  constructor(S: Source, cell: RegionCell, V: number, start: Float64Array, startPhi: number) {
    this.S = S; this.cell = cell; this.V = V;
    this.best.set(start); this.phi = startPhi; this.step = 0.2 * S.R0;
  }
  get sound(): boolean { return this.phi >= 0.95; }
  get done(): boolean { return this.phase === 2; }
  private eval(x: number, y: number, z: number): number { this.evals++; return starShare(this.S, this.cell, x, y, z, this.V, 360); }
  run(maxEvals: number): boolean {
    const S = this.S, box = S.box;
    let budget = maxEvals;
    while (budget > 0 && this.phase < 2) {
      if (this.phase === 0) {
        const i = this.idx + 1;
        // R3 sequence: fractional parts of i * (1/g, 1/g^2, 1/g^3), g the plastic number
        const a1 = 0.8191725133961645, a2 = 0.6710436067037893, a3 = 0.5497004779019703;
        const x = box[0] + (box[3] - box[0]) * ((0.5 + a1 * i) % 1), y = box[1] + (box[4] - box[1]) * ((0.5 + a2 * i) % 1), z = box[2] + (box[5] - box[2]) * ((0.5 + a3 * i) % 1);
        this.idx++;
        if (insideCell(this.cell, x, y, z) && insideS(S, x, y, z)) {
          const p = this.eval(x, y, z); budget--;
          if (p > this.phi + 1e-12) { this.phi = p; this.best[0] = x; this.best[1] = y; this.best[2] = z; }
        }
        if (this.idx >= 160) { this.phase = 1; this.idx = 0; this.round = 0; this.cur.set(this.best); this.roundBest = this.phi; this.roundPt.set(this.best); }
      } else {
        // pattern search: the six axis neighbours of cur at `step`
        const k = this.idx, ax = k >> 1, sg = (k & 1) === 0 ? 1 : -1;
        this.cand.set(this.cur); this.cand[ax] += sg * this.step;
        const p = this.eval(this.cand[0], this.cand[1], this.cand[2]); budget--;
        if (p > this.roundBest + 1e-12) { this.roundBest = p; this.roundPt.set(this.cand); }
        this.idx++;
        if (this.idx >= 6) {
          this.idx = 0;
          if (this.roundBest > this.phi + 1e-12) { this.phi = this.roundBest; this.best.set(this.roundPt); this.cur.set(this.roundPt); }
          this.step *= 0.5; this.round++;
          if (this.round >= 5) this.phase = 2;
        }
      }
    }
    return this.phase === 2;
  }
}

/* ───────────────────────────── the exact clip of a mesh by a plane ───────────────────────────── */

/** Result slots of clipMesh. */
export const CLIP_VOL = 0, CLIP_CX = 1, CLIP_CY = 2, CLIP_CZ = 3, CLIP_XX = 4, CLIP_XY = 5, CLIP_XZ = 6, CLIP_YY = 7, CLIP_YZ = 8, CLIP_ZZ = 9, CLIP_ASPECT = 10, CLIP_N = 11;

/**
 * The part of a CLOSED triangle mesh (outward winding) with n . x >= d (n unit): out = [volume, centroid xyz, covariance about the centroid (xx xy xz yy yz zz),
 * aspect = sqrt(lambda_min / lambda_max)]. Each triangle is clipped against the plane (Sutherland-Hodgman, no arrays) and every kept piece makes a
 * tetrahedron with a point P on the plane; the cap face lies in the plane, so its tetrahedra are flat and add nothing. Exact for the polyhedron. Allocation-free.
 * (n, d) are passed as a 4-array [nx, ny, nz, d].
 */
export function clipMesh(pos: ArrayLike<number>, tris: Uint32Array, plane: ArrayLike<number>, out: Float64Array): void {
  const nx = plane[0], ny = plane[1], nz = plane[2], d = plane[3];
  const px = nx * d, py = ny * d, pz = nz * d;
  let V = 0, cx = 0, cy = 0, cz = 0, xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    let ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx0 = pos[c], cy0 = pos[c + 1], cz0 = pos[c + 2];
    const sa = nx * ax + ny * ay + nz * az - d, sb = nx * bx + ny * by + nz * bz - d, sc = nx * cx0 + ny * cy0 + nz * cz0 - d;
    const pa = sa >= 0 ? 1 : 0, pb = sb >= 0 ? 1 : 0, pc = sc >= 0 ? 1 : 0, np = pa + pb + pc;
    if (np === 0) continue;
    // rotate so that for np = 1 vertex A is the kept one, for np = 2 vertex C is the dropped one
    let sA = sa, sB = sb, sC = sc;
    if (np === 1) {
      if (pb) { let tx = ax, ty = ay, tz = az; ax = bx; ay = by; az = bz; bx = cx0; by = cy0; bz = cz0; cx0 = tx; cy0 = ty; cz0 = tz; sA = sb; sB = sc; sC = sa; }
      else if (pc) { let tx = ax, ty = ay, tz = az; ax = cx0; ay = cy0; az = cz0; cx0 = bx; cy0 = by; cz0 = bz; bx = tx; by = ty; bz = tz; sA = sc; sB = sa; sC = sb; }
    } else if (np === 2) {
      if (!pa) { let tx = ax, ty = ay, tz = az; ax = bx; ay = by; az = bz; bx = cx0; by = cy0; bz = cz0; cx0 = tx; cy0 = ty; cz0 = tz; sA = sb; sB = sc; sC = sa; }
      else if (!pb) { let tx = ax, ty = ay, tz = az; ax = cx0; ay = cy0; az = cz0; cx0 = bx; cy0 = by; cz0 = bz; bx = tx; by = ty; bz = tz; sA = sc; sB = sa; sC = sb; }
    }
    // kept triangles as up to two (A', B', C') triples written to the 6 locals below
    let n1 = 0;
    let t1ax = 0, t1ay = 0, t1az = 0, t1bx = 0, t1by = 0, t1bz = 0, t1cx = 0, t1cy = 0, t1cz = 0;
    let t2ax = 0, t2ay = 0, t2az = 0, t2bx = 0, t2by = 0, t2bz = 0, t2cx = 0, t2cy = 0, t2cz = 0;
    if (np === 3) {
      n1 = 1; t1ax = ax; t1ay = ay; t1az = az; t1bx = bx; t1by = by; t1bz = bz; t1cx = cx0; t1cy = cy0; t1cz = cz0;
    } else if (np === 1) {
      // A kept; the edges A-B and A-C are cut
      const kb = sA / (sA - sB), kc = sA / (sA - sC);
      n1 = 1; t1ax = ax; t1ay = ay; t1az = az;
      t1bx = ax + (bx - ax) * kb; t1by = ay + (by - ay) * kb; t1bz = az + (bz - az) * kb;
      t1cx = ax + (cx0 - ax) * kc; t1cy = ay + (cy0 - ay) * kc; t1cz = az + (cz0 - az) * kc;
    } else {
      // A, B kept; C dropped: edges B-C and C-A are cut. Quad A, B, B', A' -> triangles (A, B, B') and (A, B', A')
      const kb = sB / (sB - sC), ka = sA / (sA - sC);
      const bpx = bx + (cx0 - bx) * kb, bpy = by + (cy0 - by) * kb, bpz = bz + (cz0 - bz) * kb;
      const apx = ax + (cx0 - ax) * ka, apy = ay + (cy0 - ay) * ka, apz = az + (cz0 - az) * ka;
      n1 = 2;
      t1ax = ax; t1ay = ay; t1az = az; t1bx = bx; t1by = by; t1bz = bz; t1cx = bpx; t1cy = bpy; t1cz = bpz;
      t2ax = ax; t2ay = ay; t2az = az; t2bx = bpx; t2by = bpy; t2bz = bpz; t2cx = apx; t2cy = apy; t2cz = apz;
    }
    for (let q = 0; q < n1; q++) {
      const ex = q === 0 ? t1ax : t2ax, ey = q === 0 ? t1ay : t2ay, ez = q === 0 ? t1az : t2az;
      const fx = q === 0 ? t1bx : t2bx, fy = q === 0 ? t1by : t2by, fz = q === 0 ? t1bz : t2bz;
      const gx = q === 0 ? t1cx : t2cx, gy = q === 0 ? t1cy : t2cy, gz = q === 0 ? t1cz : t2cz;
      // tetrahedron (P, E, F, G), vectors from P
      const u1x = ex - px, u1y = ey - py, u1z = ez - pz, u2x = fx - px, u2y = fy - py, u2z = fz - pz, u3x = gx - px, u3y = gy - py, u3z = gz - pz;
      const vol = (u1x * (u2y * u3z - u2z * u3y) + u1y * (u2z * u3x - u2x * u3z) + u1z * (u2x * u3y - u2y * u3x)) / 6;
      const sx = px + ex + fx + gx, sy = py + ey + fy + gy, sz = pz + ez + fz + gz;   // sum of the 4 vertices
      V += vol; cx += vol * sx / 4; cy += vol * sy / 4; cz += vol * sz / 4;
      // second moment about the origin: vol / 20 (sum v v^T + (sum v)(sum v)^T)
      const k = vol / 20;
      xx += k * (px * px + ex * ex + fx * fx + gx * gx + sx * sx);
      xy += k * (px * py + ex * ey + fx * fy + gx * gy + sx * sy);
      xz += k * (px * pz + ex * ez + fx * fz + gx * gz + sx * sz);
      yy += k * (py * py + ey * ey + fy * fy + gy * gy + sy * sy);
      yz += k * (py * pz + ey * ez + fy * fz + gy * gz + sy * sz);
      zz += k * (pz * pz + ez * ez + fz * fz + gz * gz + sz * sz);
    }
  }
  out[CLIP_VOL] = V;
  if (!(V > 1e-300)) { out[CLIP_CX] = 0; out[CLIP_CY] = 0; out[CLIP_CZ] = 0; for (let i = 4; i <= 9; i++) out[i] = 0; out[CLIP_ASPECT] = 0; return; }
  const mx = cx / V, my = cy / V, mz = cz / V;
  out[CLIP_CX] = mx; out[CLIP_CY] = my; out[CLIP_CZ] = mz;
  const cxx = xx / V - mx * mx, cxy = xy / V - mx * my, cxz = xz / V - mx * mz, cyy = yy / V - my * my, cyz = yz / V - my * mz, czz = zz / V - mz * mz;
  out[CLIP_XX] = cxx; out[CLIP_XY] = cxy; out[CLIP_XZ] = cxz; out[CLIP_YY] = cyy; out[CLIP_YZ] = cyz; out[CLIP_ZZ] = czz;
  // eigenvalues of the symmetric 3x3 (closed form, trigonometric)
  const q = (cxx + cyy + czz) / 3;
  const p1 = cxy * cxy + cxz * cxz + cyz * cyz;
  const p2 = (cxx - q) * (cxx - q) + (cyy - q) * (cyy - q) + (czz - q) * (czz - q) + 2 * p1, p = Math.sqrt(p2 / 6);
  let l1: number, l3: number;
  if (p < 1e-300) { l1 = q; l3 = q; }
  else {
    const bxx = (cxx - q) / p, byy = (cyy - q) / p, bzz = (czz - q) / p, bxy = cxy / p, bxz = cxz / p, byz = cyz / p;
    const det = bxx * (byy * bzz - byz * byz) - bxy * (bxy * bzz - byz * bxz) + bxz * (bxy * byz - byy * bxz);
    const r = Math.max(-1, Math.min(1, det / 2)), phi = Math.acos(r) / 3;
    l1 = q + 2 * p * Math.cos(phi);               // largest
    l3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);   // smallest
  }
  out[CLIP_ASPECT] = l1 > 1e-300 ? Math.sqrt(Math.max(0, l3) / l1) : 0;
}
