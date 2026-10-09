// CUT2 (TRUE CUT, _spec/CUT2.md section 4): how a piece's rest mesh is built. PHYS, task P1b. Pure: no three, no DOM, no Math.random, no Date, fixed
// iteration counts. A piece is the real part of the whole squishy inside a convex CELL (S cut by the half-spaces on its path in the cut tree); its rest mesh
// is the radial re-mesh of that part from its own centre on the UNCHANGED icosphere topology (642 particles, 162 under 0.35), so the solver needs nothing new:
//   centre -> soundness (phi, centre search) -> seed -> 4 relaxations -> rim snap -> cap and skin relaxation -> validity gate -> adaptive foot (room clamp and
//   lift cap) -> exact volume by a normal offset of the skin -> normalise -> weights -> post-conditions.
// `PieceJob` runs those as resumable STAGES (`run(budgetMs, maxStages)`: as many as fit in the budget but never more than maxStages, so the frame at which a
// build completes does not depend on wall-clock speed); every typed array a stage needs is allocated when the job is created, a stage allocates nothing.
// `CutJob` builds the two children of a cut with the retry ladder of 4.1 step 12 (shift the latched plane by at most 0.012 R0, or refuse with 'thin' / 'loose').
import type { Genome } from '../core/genome.ts';
import type { CutPlaneRest, PieceRegion } from '../contracts.ts';
import { evalShape } from '../data/shapes.ts';
import { buildRest, floppyFeature, floppyOf, floppySecond, meshVolume, physicsGenome, recipeOf, strutWeight } from './shape.ts';
import type { RestShape } from './shape.ts';
import type { IcoMesh } from './mesh.ts';
import {
  CLIP_ASPECT, CLIP_CX, CLIP_CY, CLIP_CZ, CLIP_VOL, CentreSearch, OUT, RAY, clipMesh, compileCell, exitDist, getSource, icoOf, measureRegion, regionCentroid, starShare, starVolume,
} from './region.ts';
import type { RegionCell, Source } from './region.ts';

/** Starting values the spec asks to be re-confirmed by the probe rows (P8 tunes them). */
export const PIECE_TUNING = {
  FOOT_LIFT_MAX: 0.08,        // R0: a foot that needs more lift than this is not added (4.1 step 8 b)
  DELTA_MAX: 0.05,            // R0: post-condition (v) of 4.1 step 12
  MASS_LO: 0.01, MASS_HI: 8,  // post-condition (ii)
  PHI_OK: 0.97, PHI_SOUND: 0.95,
  FRAC_MIN: 0.124,            // FRAC_MIN of the solver (5.6)
  SNAP_PASSES: 3,             // rim snap passes (fixed count)
  STAR_GUARD: 0.002,           // the rim snap keeps every triangle about a moved vertex above this fraction of the mean (c, tri) tetrahedron and mean area
  RELAX_REPEAT: 1,            // radial relaxation passes per relaxation stage (4 stages; the spec says K = 4 passes in all)
  CAP_PASSES: 12,             // in-plane Laplacian passes on the cap interior (4.1 step 7)
  GS_RELAX: 0,                // 1 = the radial relaxation updates in place (Gauss-Seidel, vertex order) instead of Jacobi
  RIM_SMOOTH: 0,              // passes of tangential rim re-spacing after the snap (tuning item T1, first cut). TRIED: 3 passes made the cap triangles worse (4 species: CAP triangle under 15 deg 14.8 -> 17.1 % of regions, median smallest angle 14.2 -> 12.5 deg), so it is off; P8 may try a proper arc-length re-spacing
};

/** The detail of a piece: under 0.35 of the whole it is built at icosphere detail 2 (162 particles), else 3 (642) (CUT.md 4.3, CUT2 3.2). */
export const pieceDetail = (frac: number): 2 | 3 => (frac < 0.35 ? 2 : 3);

export interface PieceBuilt {
  rest: RestShape;
  mesh: IcoMesh;
  detail: number;
  frac: number;                              // restVolume / V3
  /** W position of the piece's mass centroid: restLocal + offset = the same material point in W. */
  offset: { x: number; y: number; z: number };
  /** The centre the mesh was re-meshed from, in piece coordinates (centre - offset). */
  rayOrigin: { x: number; y: number; z: number };
  /** The bounding planes of the one cell, in W, normals pointing OUT of the piece (the render contract). */
  cells: CutPlaneRest[][];
  rimClean: boolean;
  phi: number;
  skinDelta: number;                         // |delta| of the exact-volume offset, in R0
  footAdded: boolean;
  capPlanes: number;
  minMass: number; maxMass: number;
}

/* ───────────────────────────── cache ───────────────────────────── */

const CACHE = new Map<string, PieceBuilt>();
export function clearPieceCache(): void { CACHE.clear(); }
const cacheGet = (k: string): PieceBuilt | undefined => { const v = CACHE.get(k); if (v) { CACHE.delete(k); CACHE.set(k, v); } return v; };
const cachePut = (k: string, v: PieceBuilt): void => { CACHE.set(k, v); if (CACHE.size > 64) CACHE.delete(CACHE.keys().next().value as string); };
export function pieceCacheSize(): number { return CACHE.size; }

/** Key of (species, size, the cell's half-spaces with their 17-digit floats, detail, frac). The half-spaces are sorted so the same cell always has the same key, and
 *  the plane IDS are NOT part of it: the shell numbers its planes (nextId) and the physics numbers the plane of its own CutJob, but the geometry is the floats, so a
 *  piece the shell asks for hits the entry `prepareCut` filled whatever either side called the plane (CUT2 P3). `frac` is quantised to 1e-13: the shell derives the
 *  children's shares from `plan.fa` in its own arithmetic (a difference of the last bit or two), the volume gate of the build is 1e-12 relative. */
export function pieceKey(S: Source, region: PieceRegion | undefined, detail: number, frac: number | undefined): string {
  const s = S.key + '#' + detail + '#' + (frac === undefined ? 'auto' : frac.toFixed(13));
  const cell = compileCell(region, 0), parts: string[] = [];
  for (let k = 0; k < cell.np; k++) parts.push(cell.pl[k * 4].toPrecision(17) + ',' + cell.pl[k * 4 + 1].toPrecision(17) + ',' + cell.pl[k * 4 + 2].toPrecision(17) + ',' + cell.pl[k * 4 + 3].toPrecision(17));
  parts.sort();
  return parts.length ? s + '|' + parts.join('|') : s;
}

/** The bounding planes of a region's one cell as the render contract wants them (CutPlaneRest: unit normal pointing OUT of the piece, in W, with the shell's own
 *  plane ids). Built from the REGION the caller passed, not from a cached build, so the ids are the caller's. A literal +id (side A, n . x >= d) bounds the piece
 *  by { -n, -d }; -id by { n, d }. */
export function cellPlanes(region: PieceRegion): CutPlaneRest[][] {
  const lits = region.cells[0], out: CutPlaneRest[] = [];
  for (const l of lits) {
    const p = region.planes.find((q) => q.id === Math.abs(l));
    if (!p) throw new Error('piece.ts: literal ' + l + ' names no plane');
    out.push(l > 0 ? { n: { x: -p.n.x, y: -p.n.y, z: -p.n.z }, d: -p.d, id: p.id } : { n: { x: p.n.x, y: p.n.y, z: p.n.z }, d: p.d, id: p.id });
  }
  return [out];
}

/** `PieceInfo.whole` (contracts.ts): the uncut squishy's DETAIL-3 rest mesh, the SAME array objects for every piece of one (species, size) so the render and the shell
 *  can group pieces by identity. The values are those of `new SoftBody(genome).restLocal` / `.indices`. LRU of 8 like the source solids. */
export interface WholeMesh { readonly restLocal: Float32Array; readonly indices: Uint32Array; readonly radius: number }
const WHOLES: Array<{ key: string; w: WholeMesh }> = [];
export function wholeOf(genome: Genome): WholeMesh {
  const S = getSource(genome);
  for (let i = 0; i < WHOLES.length; i++) {
    if (WHOLES[i].key === S.key) { const e = WHOLES[i]; if (i > 0) { WHOLES.splice(i, 1); WHOLES.unshift(e); } return e.w; }
  }
  const m3 = icoOf(3), r = buildRest(genome, m3);
  const w: WholeMesh = { restLocal: Float32Array.from(r.restLocal), indices: m3.tris, radius: r.restRadius };
  WHOLES.unshift({ key: S.key, w });
  if (WHOLES.length > 8) WHOLES.length = 8;
  return w;
}

/* ───────────────────────────── per-detail topology ───────────────────────────── */

interface Topo { nbrStart: Int32Array; nbrIdx: Int32Array; vtStart: Int32Array; vtList: Int32Array }
const TOPO = new Map<number, Topo>();
function topoOf(detail: number): Topo {
  let t = TOPO.get(detail);
  if (!t) {
    const m = icoOf(detail), n = m.vertexCount, deg = new Int32Array(n + 1);
    for (let e = 0; e < m.edges.length; e += 2) { deg[m.edges[e] + 1]++; deg[m.edges[e + 1] + 1]++; }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const idx = new Int32Array(deg[n]), fill = new Int32Array(n);
    for (let e = 0; e < m.edges.length; e += 2) {
      const a = m.edges[e], b = m.edges[e + 1];
      idx[deg[a] + fill[a]++] = b; idx[deg[b] + fill[b]++] = a;
    }
    const vts = new Int32Array(n + 1), tr = m.tris;
    for (let k = 0; k < tr.length; k++) vts[tr[k] + 1]++;
    for (let i = 0; i < n; i++) vts[i + 1] += vts[i];
    const vtl = new Int32Array(tr.length), vf = new Int32Array(n);
    for (let k = 0; k < tr.length; k++) { const v = tr[k]; vtl[vts[v] + vf[v]++] = (k / 3) | 0; }
    t = { nbrStart: deg, nbrIdx: idx, vtStart: vts, vtList: vtl };
    TOPO.set(detail, t);
  }
  return t;
}

const sstep = (a: number, b: number, x: number): number => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

/* ───────────────────────────── the resumable build ───────────────────────────── */

// stages (st): 0 centre, 1 phi, 2 search, 3 seed, 4-7 relax, 8 snap, 9 cap, 10-13 skin, 14 gate, 15 foot, 16 volume, 17 finish (checks, normalise), 18 weights and assembly
const ST_CENTRE = 0, ST_PHI = 1, ST_SEARCH = 2, ST_SEED = 3, ST_RELAX = 4, ST_SNAP = 8, ST_CAP = 9, ST_SKIN = 10, ST_GATE = 14, ST_FOOT = 15, ST_VOLUME = 16, ST_FINISH = 17, ST_WEIGHTS = 18;
const RELAX_PASSES = 4, RELAX_LAMBDA = 0.7, CAP_LAMBDA = 0.8, SKIN_PASSES = 4, SKIN_LAMBDA = 0.5;
const ON_PLANE = 1e-8;                   // R0: a vertex is "on plane p" within this
const SEARCH_EVALS_PER_STAGE = 3;
/** The rim snap moves a vertex at most 0.9 of its mean edge per pass (a local bound); a seed vertex can start up to ~2.4 edges from the silhouette (the cap is a gnomonic
 *  stretch), so the snap runs 3 passes (fixed count: deterministic); a vertex already on the silhouette has t = 0 and stays. */

export type JobStatus = 'run' | 'ok' | 'unsound' | 'fail';

export class PieceJob {
  readonly S: Source;
  readonly cell: RegionCell;
  readonly region: PieceRegion | undefined;
  readonly detail: number;
  readonly mesh: IcoMesh;
  readonly n: number;
  readonly key: string;
  /** Target share of the whole (restVolume = frac V3); 0 until known when none was given (then the cell's own share of S). */
  frac: number;
  status: JobStatus = 'run';
  why = '';
  built: PieceBuilt | null = null;
  stagesRun = 0;
  st = ST_CENTRE;
  private readonly topo: Topo;
  private readonly hint: Float64Array | null;
  private readonly c = new Float64Array(3);
  private readonly tmp = new Float64Array(8);
  private Vcell = 0;
  private phi = 0;
  private search: CentreSearch | null = null;
  private X: Float64Array; private XT: Float64Array; private X5: Float64Array;
  private readonly mask: Uint8Array;
  private readonly bnd: Uint8Array;
  private readonly e: Float64Array;       // mean edge length per vertex
  private readonly lim: Float64Array;     // 2n: max positive / negative normal offset per skin vertex
  private readonly nrm: Float64Array;     // area-weighted vertex normals
  private rimClean = true;
  private snapped = false;
  private footAdded = false;
  private delta = 0;
  private pass = 0;
  private readonly lows = new Float64Array(8);

  constructor(genome: Genome, region: PieceRegion | undefined, detail: number, frac?: number, centre?: { x: number; y: number; z: number }) {
    this.S = getSource(genome);
    this.region = region;
    this.cell = compileCell(region, 0);
    this.detail = detail;
    this.mesh = icoOf(detail);
    this.n = this.mesh.vertexCount;
    this.topo = topoOf(detail);
    this.frac = frac === undefined ? 0 : frac;
    this.key = pieceKey(this.S, region, detail, frac);
    this.hint = centre ? new Float64Array([centre.x, centre.y, centre.z]) : null;
    const n = this.n;
    this.X = new Float64Array(n * 3); this.XT = new Float64Array(n * 3); this.X5 = new Float64Array(n * 3);
    this.mask = new Uint8Array(n); this.bnd = new Uint8Array(n);
    this.e = new Float64Array(n); this.lim = new Float64Array(n * 2); this.nrm = new Float64Array(n * 3);
    if (this.cell.np > 8) { this.status = 'fail'; this.why = 'planes'; }
  }

  /** Run stages until finished, until `maxStages` have run in THIS call, or until `budgetMs` has elapsed (checked after each stage; at least one stage runs).
   *  Returns true when the job is finished (status !== 'run'). budgetMs = Infinity and a fixed maxStages make the stage at which it finishes deterministic. */
  run(budgetMs: number, maxStages = Infinity): boolean {
    const t0 = budgetMs === Infinity ? 0 : performance.now();
    let k = 0, s0 = t0;
    while (this.status === 'run' && k < maxStages) {
      this.stage(); k++;
      if (budgetMs !== Infinity) {
        // stop when the budget is spent OR the next stage, at the cost of the one just run, would spend it (a slice stays inside its budget; at least one stage runs)
        const now = performance.now();
        if (now - t0 + (now - s0) > budgetMs) break;
        s0 = now;
      }
    }
    return this.status !== 'run';
  }

  private stage(): void {
    this.stagesRun++;
    const st = this.st;
    if (st === ST_CENTRE) this.sCentre();
    else if (st === ST_PHI) this.sPhi();
    else if (st === ST_SEARCH) this.sSearch();
    else if (st === ST_SEED) this.sSeed();
    else if (st >= ST_RELAX && st < ST_SNAP) this.sRelax();
    else if (st === ST_SNAP) this.sSnap();
    else if (st === ST_CAP) this.sCap();
    else if (st >= ST_SKIN && st < ST_GATE) this.sSkin();
    else if (st === ST_GATE) this.sGate();
    else if (st === ST_FOOT) this.sFoot();
    else if (st === ST_VOLUME) this.sVolume();
    else if (st === ST_FINISH) this.sFinish();
    else if (st === ST_WEIGHTS) this.sWeights();
  }

  private fail(why: string, status: JobStatus = 'fail'): void { this.status = status; this.why = why; }

  /* 4.1 step 2: the centre and the region's volume */
  private sCentre(): void {
    const S = this.S, tmp = this.tmp, c = this.c;
    if (this.hint) {
      // the centre is given (planCut's exact centroid): V and phi from one pass of 360 rays
      c.set(this.hint); starVolume(S, this.cell, c[0], c[1], c[2], 360, tmp);
      this.Vcell = tmp[0]; this.phi = tmp[1];
      if (!(this.Vcell > 1e-9 * S.vol)) { this.fail('empty'); return; }
      if (this.frac === 0) this.frac = this.cell.np === 0 ? 1 : this.Vcell / S.vol;
      this.afterPhi();
      return;
    }
    regionCentroid(S, this.cell, 600, tmp); c[0] = tmp[1]; c[1] = tmp[2]; c[2] = tmp[3];
    this.Vcell = tmp[0];
    if (!(this.Vcell > 1e-9 * S.vol)) { this.fail('empty'); return; }
    if (this.frac === 0) this.frac = this.cell.np === 0 ? 1 : this.Vcell / S.vol;
    this.st = ST_PHI;
  }

  /* step 3: soundness */
  private sPhi(): void {
    const c = this.c;
    this.phi = starShare(this.S, this.cell, c[0], c[1], c[2], this.Vcell, 360);
    this.afterPhi();
  }
  private afterPhi(): void {
    if (this.phi >= PIECE_TUNING.PHI_OK) { this.st = ST_SEED; return; }
    this.search = new CentreSearch(this.S, this.cell, this.Vcell, this.c, this.phi);
    this.st = ST_SEARCH;
  }
  private sSearch(): void {
    const s = this.search!;
    if (!s.run(SEARCH_EVALS_PER_STAGE)) return;
    this.phi = s.phi;
    if (!s.sound) { this.fail('unsound', 'unsound'); return; }
    this.c.set(s.best);
    this.st = ST_SEED;
  }

  /** Exit of the region along RAY (origin RAY[0..2], unit direction RAY[3..5], set by the caller: six doubles passed to a call this large would be boxed, one heap
   *  allocation each), with a tiny deterministic nudge of the direction when a ray finds nothing (it grazed an edge or a vertex). Leaves the (possibly nudged, unit)
   *  direction in RAY[3..5] and the distance in OUT[0]. */
  private exitRay(verify: boolean): void {
    exitDist(this.S, this.cell, verify);
    if (OUT[1] !== 1) return;
    const ux = RAY[3], uy = RAY[4], uz = RAY[5];
    for (let tries = 1; tries <= 4; tries++) {
      const j = 1e-7 * tries;
      let vx = ux + j * 0.7, vy = uy - j * 0.3, vz = uz + j * 0.9;
      const il = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
      vx *= il; vy *= il; vz *= il;
      RAY[3] = vx; RAY[4] = vy; RAY[5] = vz;
      exitDist(this.S, this.cell, verify);
      if (OUT[1] !== 1) return;
    }
  }

  private classify(): void {
    const n = this.n, X = this.X, pl = this.cell.pl, np = this.cell.np, tol = ON_PLANE * this.S.R0, mask = this.mask;
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let p = 0; p < np; p++) { const q = p * 4, s = pl[q] * X[i * 3] + pl[q + 1] * X[i * 3 + 1] + pl[q + 2] * X[i * 3 + 2] - pl[q + 3]; if (s < tol && s > -tol) m |= 1 << p; }
      mask[i] = m;
    }
  }

  /* step 4 */
  private sSeed(): void {
    const n = this.n, X = this.X, dirs = this.mesh.dirs, c = this.c;
    for (let i = 0; i < n; i++) {
      RAY[0] = c[0]; RAY[1] = c[1]; RAY[2] = c[2]; RAY[3] = dirs[i * 3]; RAY[4] = dirs[i * 3 + 1]; RAY[5] = dirs[i * 3 + 2];
      this.exitRay(false);
      const d = OUT[0];
      if (OUT[1] === 1) { this.fail('ray'); return; }
      X[i * 3] = c[0] + d * RAY[3]; X[i * 3 + 1] = c[1] + d * RAY[4]; X[i * 3 + 2] = c[2] + d * RAY[5];
    }
    this.classify();
    this.pass = 0;
    this.st = ST_RELAX;
  }

  /* step 5: K passes of radial relaxation (Jacobi) */
  private sRelax(): void {
    for (let rep = 0; rep < PIECE_TUNING.RELAX_REPEAT; rep++) this.relaxOnce();
    this.pass++;
    if (this.pass >= RELAX_PASSES) { this.X5.set(this.X); this.classify(); this.pass = 0; this.st = ST_SNAP; }
    else this.st++;
  }
  private relaxOnce(): void {
    const n = this.n, X = this.X, XT = PIECE_TUNING.GS_RELAX ? this.X : this.XT, c = this.c, st = this.topo.nbrStart, nb = this.topo.nbrIdx;
    for (let i = 0; i < n; i++) {
      let mx = 0, my = 0, mz = 0;
      for (let j = st[i], je = st[i + 1]; j < je; j++) { const k = nb[j] * 3; mx += X[k]; my += X[k + 1]; mz += X[k + 2]; }
      const inv = 1 / (st[i + 1] - st[i]), x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
      let ux = x + RELAX_LAMBDA * (mx * inv - x) - c[0], uy = y + RELAX_LAMBDA * (my * inv - y) - c[1], uz = z + RELAX_LAMBDA * (mz * inv - z) - c[2];
      const il = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux *= il; uy *= il; uz *= il;
      RAY[0] = c[0]; RAY[1] = c[1]; RAY[2] = c[2]; RAY[3] = ux; RAY[4] = uy; RAY[5] = uz;
      this.exitRay(false);
      const d = OUT[0];
      if (OUT[1] === 1) { XT[i * 3] = x; XT[i * 3 + 1] = y; XT[i * 3 + 2] = z; continue; }
      XT[i * 3] = c[0] + d * RAY[3]; XT[i * 3 + 1] = c[1] + d * RAY[4]; XT[i * 3 + 2] = c[2] + d * RAY[5];
    }
    if (XT !== X) { this.X = XT; this.XT = X; }
  }

  private popcount(m: number): number { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }

  private readonly rn = new Int32Array(2);
  /** The rim neighbours of boundary vertex i of plane p: the neighbours j (also boundary vertices of p) whose edge (i, j) has exactly one cap triangle beside it. Fills rn; returns the count. */
  private rimNeighbours(i: number, p: number): number {
    const st = this.topo.nbrStart, nb = this.topo.nbrIdx, vs = this.topo.vtStart, vl = this.topo.vtList, tris = this.mesh.tris, mask = this.mask, bnd = this.bnd;
    let found = 0;
    for (let a = st[i], ae = st[i + 1]; a < ae; a++) {
      const j = nb[a];
      if (!((bnd[j] >> p) & 1)) continue;
      let caps = 0;
      for (let k = vs[i], ke = vs[i + 1]; k < ke; k++) {
        const t = vl[k] * 3, x = tris[t], y = tris[t + 1], z = tris[t + 2];
        if ((x === j || y === j || z === j) && ((mask[x] & mask[y] & mask[z]) >> p) & 1) caps++;
      }
      if (caps === 1) { if (found < 2) this.rn[found] = j; found++; }
    }
    return found;
  }
  private readonly tm = new Float64Array(2);   // triMetrics result: det, area (scratch: doubles passed or returned by calls are boxed)
  private readonly gv = new Float64Array(2);   // the snap's guard limits: minDet, minArea
  private readonly fin = new Float64Array(9);   // sFinish -> sWeights hand-over
  private finP: Float64Array | null = null; private finMass: Float64Array | null = null;
  private wF: Float64Array | null = null; private wFe: Int16Array | null = null; private wS: Float64Array | null = null;
  private readonly vd = new Float64Array(2);   // volumeAt: argument delta, result volume
  /** det = 6 x the signed volume of (centre, triangle t) and the triangle's area at the current positions, left in mDet / mArea. */
  private triMetrics(t: number): number {
    const X = this.X, tris = this.mesh.tris, c = this.c, a = tris[t] * 3, b = tris[t + 1] * 3, d = tris[t + 2] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[d] - X[a], vy = X[d + 1] - X[a + 1], vz = X[d + 2] - X[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    this.tm[0] = nx * (X[a] - c[0]) + ny * (X[a + 1] - c[1]) + nz * (X[a + 2] - c[2]);
    this.tm[1] = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    return 0;
  }
  /** Every triangle about vertex i still has (c, tri) above minDet and area above minArea. */
  private starOk(i: number): boolean {
    const vs = this.topo.vtStart, vl = this.topo.vtList;
    for (let j = vs[i], je = vs[i + 1]; j < je; j++) { this.triMetrics(vl[j] * 3); if (this.tm[0] < this.gv[0] || this.tm[1] < this.gv[1]) return false; }
    return true;
  }

  /* step 6: the rim snap (and the boundary flags the cap relaxation uses) */
  /** The snap's preparation (first pass only): the star-guard limits, the mean edge per vertex, the boundary flags per plane. */
  private snapPrep(): void {
    const n = this.n, X = this.X, np = this.cell.np, mask = this.mask, bnd = this.bnd, tris = this.mesh.tris;
    const st = this.topo.nbrStart, nb = this.topo.nbrIdx, e = this.e;
    bnd.fill(0);
    // the local orientation limits: a triangle about vertex i must keep (c, tri) at STAR_GUARD of the mean tetrahedron and of the mean area
    let sumDet = 0, sumArea = 0;
    for (let t = 0; t < tris.length; t += 3) { this.triMetrics(t); sumDet += this.tm[0]; sumArea += this.tm[1]; }
    this.gv[0] = PIECE_TUNING.STAR_GUARD * sumDet / (tris.length / 3); this.gv[1] = PIECE_TUNING.STAR_GUARD * sumArea / (tris.length / 3);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = st[i], je = st[i + 1]; j < je; j++) { const k = nb[j]; const dx = X[i * 3] - X[k * 3], dy = X[i * 3 + 1] - X[k * 3 + 1], dz = X[i * 3 + 2] - X[k * 3 + 2]; s += Math.sqrt(dx * dx + dy * dy + dz * dz); }
      e[i] = s / (st[i + 1] - st[i]);
    }
    // boundary vertices per plane: bit p of bnd[i]
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2], tm = mask[a] & mask[b] & mask[c];
      for (let p = 0; p < np; p++) {
        if ((tm >> p) & 1) continue;
        if ((mask[a] >> p) & 1) bnd[a] |= 1 << p;
        if ((mask[b] >> p) & 1) bnd[b] |= 1 << p;
        if ((mask[c] >> p) & 1) bnd[c] |= 1 << p;
      }
    }
  }

  private sSnap(): void {
    const n = this.n, X = this.X, np = this.cell.np, pl = this.cell.pl, mask = this.mask, bnd = this.bnd, tris = this.mesh.tris, R0 = this.S.R0;
    const st = this.topo.nbrStart, nb = this.topo.nbrIdx, e = this.e;
    if (np === 0) { bnd.fill(0); this.st = ST_CAP; return; }
    if (this.pass === 0) this.snapPrep();   // (one snap pass per stage call: a long rim on a big cap would otherwise be one 4 ms stage)
    for (let p = 0; p < np; p++) {
      const q = p * 4, nx = pl[q], ny = pl[q + 1], nz = pl[q + 2];
      let gx = 0, gy = 0, gz = 0, cnt = 0;
      for (let i = 0; i < n; i++) if ((bnd[i] >> p) & 1) { gx += X[i * 3]; gy += X[i * 3 + 1]; gz += X[i * 3 + 2]; cnt++; }
      if (cnt === 0) continue;
      gx /= cnt; gy /= cnt; gz /= cnt;
      for (let i = 0; i < n; i++) {
        if (!((bnd[i] >> p) & 1) || this.popcount(mask[i]) >= 2) continue;   // a corner (on two or more cap planes) is fixed
        let wx = X[i * 3] - gx, wy = X[i * 3 + 1] - gy, wz = X[i * 3 + 2] - gz;
        const dn = wx * nx + wy * ny + wz * nz;
        wx -= dn * nx; wy -= dn * ny; wz -= dn * nz;
        const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (wl < 1e-12) continue;
        wx /= wl; wy /= wl; wz /= wl;
        const hair = 1e-7 * R0;
        RAY[0] = X[i * 3] + hair * nx; RAY[1] = X[i * 3 + 1] + hair * ny; RAY[2] = X[i * 3 + 2] + hair * nz; RAY[3] = wx; RAY[4] = wy; RAY[5] = wz;
        this.exitRay(true);
        if (OUT[1] === 1) continue;
        let move = OUT[0];
        if (RAY[3] !== wx || RAY[4] !== wy || RAY[5] !== wz) {   // the ray was nudged: keep the move IN the plane (re-project, renormalise)
          wx = RAY[3]; wy = RAY[4]; wz = RAY[5];
          const dn2 = wx * nx + wy * ny + wz * nz;
          wx -= dn2 * nx; wy -= dn2 * ny; wz -= dn2 * nz;
          const il = 1 / Math.sqrt(wx * wx + wy * wy + wz * wz);
          wx *= il; wy *= il; wz *= il;
        }
        const cap = 0.9 * e[i];
        if (move > cap) move = cap;
        // stop 0.3 of the mean edge short of every OTHER cap plane it is moving toward
        for (let o = 0; o < np; o++) {
          if (o === p) continue;
          const r = o * 4, den = pl[r] * wx + pl[r + 1] * wy + pl[r + 2] * wz;
          if (den < -1e-12) {
            const so = pl[r] * X[i * 3] + pl[r + 1] * X[i * 3 + 1] + pl[r + 2] * X[i * 3 + 2] - pl[r + 3];
            const tq = so / -den - 0.3 * e[i];
            if (tq < move) move = tq > 0 ? tq : 0;
          }
        }
        // move as far as keeps every incident triangle well-oriented about the centre: 1, 0.6, 0.3, 0.1 of the move (a long snap on a small cap seen at a grazing angle would
        // otherwise fold the band of triangles across the rim)
        const ox = X[i * 3], oy = X[i * 3 + 1], oz = X[i * 3 + 2];
        for (let tr = 0; tr < 4; tr++) {
          const fm = tr === 0 ? 1 : tr === 1 ? 0.6 : tr === 2 ? 0.3 : 0.1;
          X[i * 3] = ox + wx * move * fm; X[i * 3 + 1] = oy + wy * move * fm; X[i * 3 + 2] = oz + wz * move * fm;
          if (this.starOk(i)) break;
          if (tr === 3) { X[i * 3] = ox; X[i * 3 + 1] = oy; X[i * 3 + 2] = oz; }
        }
      }
    }
    this.pass++;
    if (this.pass < PIECE_TUNING.SNAP_PASSES) return;
    this.pass = 0;
    // rim re-spacing (T1, first cut): each boundary vertex slides to the midpoint of its two rim neighbours and is re-projected onto the rim (the exit of the section from
    // the cap centroid), so the rim vertices are evenly spaced along the rim and the cap triangles about the rim stay well shaped. Same backtracking guard as the snap.
    for (let pass = 0; pass < PIECE_TUNING.RIM_SMOOTH; pass++) for (let p = 0; p < np; p++) {
      const q = p * 4, nx = pl[q], ny = pl[q + 1], nz = pl[q + 2];
      let gx = 0, gy = 0, gz = 0, cnt = 0;
      for (let i = 0; i < n; i++) if ((mask[i] >> p) & 1) { gx += X[i * 3]; gy += X[i * 3 + 1]; gz += X[i * 3 + 2]; cnt++; }
      if (cnt === 0) continue;
      gx /= cnt; gy /= cnt; gz /= cnt;
      for (let i = 0; i < n; i++) {
        if (!((bnd[i] >> p) & 1) || this.popcount(mask[i]) >= 2) continue;
        if (this.rimNeighbours(i, p) !== 2) continue;
        const a = this.rn[0] * 3, b = this.rn[1] * 3;
        let wx = 0.5 * (X[a] + X[b]) - gx, wy = 0.5 * (X[a + 1] + X[b + 1]) - gy, wz = 0.5 * (X[a + 2] + X[b + 2]) - gz;
        const dn = wx * nx + wy * ny + wz * nz;
        wx -= dn * nx; wy -= dn * ny; wz -= dn * nz;
        const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (wl < 1e-12) continue;
        wx /= wl; wy /= wl; wz /= wl;
        const hair = 1e-7 * R0;
        RAY[0] = gx + hair * nx; RAY[1] = gy + hair * ny; RAY[2] = gz + hair * nz; RAY[3] = wx; RAY[4] = wy; RAY[5] = wz;
        this.exitRay(true);
        if (OUT[1] === 1 || OUT[0] <= 0) continue;
        const tt = OUT[0];
        wx = RAY[3]; wy = RAY[4]; wz = RAY[5];
        const dn2 = wx * nx + wy * ny + wz * nz;
        wx -= dn2 * nx; wy -= dn2 * ny; wz -= dn2 * nz;
        const il = 1 / Math.sqrt(wx * wx + wy * wy + wz * wz);
        const tx = gx + wx * il * tt, ty = gy + wy * il * tt, tz = gz + wz * il * tt;
        const ox = X[i * 3], oy = X[i * 3 + 1], oz = X[i * 3 + 2];
        const dist = Math.sqrt((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy) + (tz - oz) * (tz - oz));
        if (dist > 0.6 * e[i]) continue;   // a jump to another part of the rim (a concave section): leave it
        for (let tr = 0; tr < 2; tr++) {
          const fm = tr === 0 ? 1 : 0.5;
          X[i * 3] = ox + (tx - ox) * fm; X[i * 3 + 1] = oy + (ty - oy) * fm; X[i * 3 + 2] = oz + (tz - oz) * fm;
          if (this.starOk(i)) break;
          if (tr === 1) { X[i * 3] = ox; X[i * 3 + 1] = oy; X[i * 3 + 2] = oz; }
        }
      }
    }
    this.snapped = true;
    this.st = ST_CAP;
  }

  /* step 7a: cap interior, 12 in-plane Laplacian passes on on-plane vertices that are neither boundary nor corner */
  private sCap(): void {
    const n = this.n, np = this.cell.np;
    if (np === 0) { this.pass = 0; this.st = ST_SKIN; return; }
    const st = this.topo.nbrStart, nb = this.topo.nbrIdx, mask = this.mask, bnd = this.bnd;
    let X = this.X, XT = this.XT;
    for (let it = 0; it < PIECE_TUNING.CAP_PASSES; it++) {
      XT.set(X);
      for (let i = 0; i < n; i++) {
        const m = mask[i];
        if (m === 0 || bnd[i] !== 0 || (m & (m - 1)) !== 0) continue;
        let mx = 0, my = 0, mz = 0;
        for (let j = st[i], je = st[i + 1]; j < je; j++) { const k = nb[j] * 3; mx += X[k]; my += X[k + 1]; mz += X[k + 2]; }
        const inv = 1 / (st[i + 1] - st[i]);
        XT[i * 3] = X[i * 3] + CAP_LAMBDA * (mx * inv - X[i * 3]); XT[i * 3 + 1] = X[i * 3 + 1] + CAP_LAMBDA * (my * inv - X[i * 3 + 1]); XT[i * 3 + 2] = X[i * 3 + 2] + CAP_LAMBDA * (mz * inv - X[i * 3 + 2]);
      }
      const t = X; X = XT; XT = t;
    }
    this.X = X; this.XT = XT;
    this.pass = 0; this.st = ST_SKIN;
  }

  /* step 7b: 4 radial passes on vertices on no plane */
  private sSkin(): void {
    const n = this.n, X = this.X, XT = this.XT, c = this.c, st = this.topo.nbrStart, nb = this.topo.nbrIdx, mask = this.mask;
    const np = this.cell.np, pl = this.cell.pl, tol = ON_PLANE * this.S.R0;
    XT.set(X);
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 0) continue;
      let mx = 0, my = 0, mz = 0;
      for (let j = st[i], je = st[i + 1]; j < je; j++) { const k = nb[j] * 3; mx += X[k]; my += X[k + 1]; mz += X[k + 2]; }
      const inv = 1 / (st[i + 1] - st[i]), x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2];
      let ux = x + SKIN_LAMBDA * (mx * inv - x) - c[0], uy = y + SKIN_LAMBDA * (my * inv - y) - c[1], uz = z + SKIN_LAMBDA * (mz * inv - z) - c[2];
      const il = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux *= il; uy *= il; uz *= il;
      RAY[0] = c[0]; RAY[1] = c[1]; RAY[2] = c[2]; RAY[3] = ux; RAY[4] = uy; RAY[5] = uz;
      this.exitRay(false);
      if (OUT[1] === 1) continue;
      const d = OUT[0], nx = c[0] + d * RAY[3], ny = c[1] + d * RAY[4], nz = c[2] + d * RAY[5];
      let onPlane = false;
      for (let p = 0; p < np; p++) { const q = p * 4, s = pl[q] * nx + pl[q + 1] * ny + pl[q + 2] * nz - pl[q + 3]; if (s < tol && s > -tol) { onPlane = true; break; } }
      if (onPlane) continue;   // a skin vertex whose new direction would end on a cap plane stays: classes never change
      XT[i * 3] = nx; XT[i * 3 + 1] = ny; XT[i * 3 + 2] = nz;
    }
    this.X = XT; this.XT = X;
    this.pass++;
    if (this.pass >= SKIN_PASSES) this.st = ST_GATE; else this.st++;
  }

  /** The mesh gate: no inverted tetrahedron (centre, tri) and every triangle area above 1e-4 of the mean. Returns the number of bad triangles. */
  private badTriangles(X: Float64Array): number {
    const tris = this.mesh.tris, c = this.c;
    let sum = 0;
    const nt = tris.length / 3;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, d = tris[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[d] - X[a], vy = X[d + 1] - X[a + 1], vz = X[d + 2] - X[a + 2];
      sum += 0.5 * Math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2);
    }
    const mean = sum / nt;
    let bad = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, d = tris[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[d] - X[a], vy = X[d + 1] - X[a + 1], vz = X[d + 2] - X[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
      const det = nx * (X[a] - c[0]) + ny * (X[a + 1] - c[1]) + nz * (X[a + 2] - c[2]);   // (a - c) . ((b - a) x (d - a)) = 6 x the signed volume of (c, a, b, d)
      if (det <= 0 || area <= 1e-4 * mean) bad++;
    }
    return bad;
  }

  /* step 7c: the validity gate; a bad snap is undone to the step-5 mesh */
  private sGate(): void {
    this.rimClean = true;
    if (this.cell.np > 0 && this.badTriangles(this.X) > 0) {
      this.X.set(this.X5); this.classify(); this.rimClean = false; this.snapped = false;
    }
    this.st = ST_FOOT;
  }

  /* step 8: the adaptive foot, with the room clamp and the lift cap */
  private sFoot(): void {
    const n = this.n, X = this.X, R0 = this.S.R0, mask = this.mask, np = this.cell.np, pl = this.cell.pl, lows = this.lows;
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) { const y = X[i * 3 + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    let near = 0;
    for (let i = 0; i < n; i++) if (X[i * 3 + 1] - ymin < 0.004 * R0) near++;
    this.footAdded = false;
    if (near < 7) {
      // the 8th-lowest vertex height (insertion into an 8-slot scratch)
      for (let k = 0; k < 8; k++) lows[k] = Infinity;
      for (let i = 0; i < n; i++) {
        const y = X[i * 3 + 1];
        if (y >= lows[7]) continue;
        let k = 7;
        while (k > 0 && lows[k - 1] > y) { lows[k] = lows[k - 1]; k--; }
        lows[k] = y;
      }
      const f = Math.max(ymin + 0.025 * (ymax - ymin), lows[7]);
      if (f - ymin <= PIECE_TUNING.FOOT_LIFT_MAX * R0) {
        const k = 0.035 * R0;
        for (let i = 0; i < n; i++) {
          if (mask[i] !== 0) continue;   // the foot never moves a vertex that lies on a cap plane
          const y = X[i * 3 + 1], t = y - f;
          let ny = t <= 0 ? f : t < k ? f + (t * t) / (2 * k) : y - k / 2;
          let dy = ny - y;
          for (let p = 0; p < np && dy !== 0; p++) {
            const q = p * 4, nyp = pl[q + 1], comp = dy * nyp;
            if (comp < 0) {
              const sd = pl[q] * X[i * 3] + pl[q + 1] * y + pl[q + 2] * X[i * 3 + 2] - pl[q + 3];
              const room = Math.max(0, sd - Math.min(sd, 0.005 * R0));
              if (-comp > room) dy = (dy > 0 ? 1 : -1) * (room / Math.abs(nyp));
            }
          }
          ny = y + dy;
          X[i * 3 + 1] = ny;
        }
        this.footAdded = true;
      }
    }
    this.st = ST_VOLUME;
  }

  /** Volume of the mesh with every skin vertex moved by clamp(delta) along its normal; writes the moved positions into XT. */
  private volumeAt(delta: number): number {
    this.vd[0] = delta;
    this.volumeAtV();
    return this.vd[1];
  }
  private volumeAtV(): void {
    const delta = this.vd[0], n = this.n, X = this.X, Y = this.XT, mask = this.mask, nrm = this.nrm, lim = this.lim;
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 0) { Y[i * 3] = X[i * 3]; Y[i * 3 + 1] = X[i * 3 + 1]; Y[i * 3 + 2] = X[i * 3 + 2]; continue; }
      let d = delta;
      if (d > lim[i * 2]) d = lim[i * 2]; else if (-d > lim[i * 2 + 1]) d = -lim[i * 2 + 1];
      Y[i * 3] = X[i * 3] + d * nrm[i * 3]; Y[i * 3 + 1] = X[i * 3 + 1] + d * nrm[i * 3 + 1]; Y[i * 3 + 2] = X[i * 3 + 2] + d * nrm[i * 3 + 2];
    }
    this.vd[1] = meshVolume(Y, this.mesh.tris);
  }

  /* step 9: exact volume without a scale: a common normal offset of the skin vertices, limited by the half-spaces, solved by secant steps */
  private sVolume(): void {
    const n = this.n, X = this.X, tris = this.mesh.tris, nrm = this.nrm, mask = this.mask, lim = this.lim, np = this.cell.np, pl = this.cell.pl, R0 = this.S.R0;
    nrm.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], d = tris[t + 2];
      const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[d * 3] - X[a * 3], vy = X[d * 3 + 1] - X[a * 3 + 1], vz = X[d * 3 + 2] - X[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) { const v = tris[t + k] * 3; nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.sqrt(nrm[i * 3] ** 2 + nrm[i * 3 + 1] ** 2 + nrm[i * 3 + 2] ** 2);
      if (l > 1e-300) { nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l; } else { nrm[i * 3] = 0; nrm[i * 3 + 1] = 0; nrm[i * 3 + 2] = 0; }
      let lp = Infinity, ln = Infinity;
      if (mask[i] === 0) {
        for (let p = 0; p < np; p++) {
          const q = p * 4, s = pl[q] * X[i * 3] + pl[q + 1] * X[i * 3 + 1] + pl[q + 2] * X[i * 3 + 2] - pl[q + 3];
          const room = Math.max(0, s - Math.min(s, 0.005 * R0)), a = pl[q] * nrm[i * 3] + pl[q + 1] * nrm[i * 3 + 1] + pl[q + 2] * nrm[i * 3 + 2];
          if (a < -1e-12) lp = Math.min(lp, room / -a); else if (a > 1e-12) ln = Math.min(ln, room / a);
        }
      }
      lim[i * 2] = lp; lim[i * 2 + 1] = ln;
    }
    const target = this.frac * this.S.v3;
    const V0 = this.volumeAt(0);
    let lo = 0, hi = 0, flo = V0 - target, fhi = flo, d0 = 0, f0 = flo, d1 = 0, f1 = flo;
    if (Math.abs(flo) <= 1e-13 * target) { this.delta = 0; this.volumeAt(0); this.afterVolume(); return; }
    // total area for the first-order step
    let area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, d = tris[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[d] - X[a], vy = X[d + 1] - X[a + 1], vz = X[d + 2] - X[a + 2];
      area += 0.5 * Math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2);
    }
    d1 = -flo / Math.max(area, 1e-9); f1 = this.volumeAt(d1) - target;
    d0 = 0; f0 = flo;
    // keep a bracket when one appears; secant otherwise, bisection if a step leaves the bracket
    let haveBracket = false;
    lo = d0; hi = d1; flo = f0; fhi = f1;
    if ((f0 < 0) !== (f1 < 0)) haveBracket = true;
    let bestD = Math.abs(f1) < Math.abs(f0) ? d1 : d0, bestF = Math.min(Math.abs(f0), Math.abs(f1));
    for (let it = 0; it < 24 && bestF > 1e-12 * target; it++) {
      let dn: number;
      if (f1 !== f0) dn = d1 - f1 * (d1 - d0) / (f1 - f0); else dn = d1 + (f1 < 0 ? 1 : -1) * 0.001 * R0;
      if (haveBracket) { const a = Math.min(lo, hi), b = Math.max(lo, hi); if (!(dn > a && dn < b)) dn = 0.5 * (lo + hi); }
      const fn = this.volumeAt(dn) - target;
      d0 = d1; f0 = f1; d1 = dn; f1 = fn;
      if (Math.abs(fn) < bestF) { bestF = Math.abs(fn); bestD = dn; }
      if (haveBracket) { if ((fn < 0) === (flo < 0)) { lo = dn; flo = fn; } else { hi = dn; fhi = fn; } }
      else if ((fn < 0) !== (f0 < 0)) { haveBracket = true; lo = d0; flo = f0; hi = d1; fhi = f1; }
    }
    void fhi;
    this.volumeAt(bestD);
    this.delta = bestD;
    if (bestF > 1e-12 * target) { this.fail('volume'); return; }
    this.afterVolume();
  }
  private afterVolume(): void {
    // the moved skin is in XT: swap it in
    const t = this.X; this.X = this.XT; this.XT = t;
    this.st = ST_FINISH;
  }

  /* steps 10-12: normalise, weights, post-conditions */
  private sFinish(): void {
    const n = this.n, X = this.X, tris = this.mesh.tris, S = this.S, R0 = S.R0, np = this.cell.np, pl = this.cell.pl;
    // (i) every vertex on the kept side of every cap plane to 1e-12 R0
    for (let i = 0; i < n; i++) for (let p = 0; p < np; p++) {
      const q = p * 4, s = pl[q] * X[i * 3] + pl[q + 1] * X[i * 3 + 1] + pl[q + 2] * X[i * 3 + 2] - pl[q + 3];
      if (s < -1e-12 * R0) { this.fail('across'); return; }
    }
    // tributary masses, mean 1
    const mass = new Float64Array(n);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2];
      const vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
      const area = 0.5 * Math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2) / 3;
      mass[a] += area; mass[b] += area; mass[c] += area;
    }
    let msum = 0;
    for (let i = 0; i < n; i++) msum += mass[i];
    let minM = Infinity, maxM = 0;
    for (let i = 0; i < n; i++) { mass[i] = (mass[i] * n) / msum; if (mass[i] < minM) minM = mass[i]; if (mass[i] > maxM) maxM = mass[i]; }
    // (ii) the mass gate
    if (minM < PIECE_TUNING.MASS_LO || maxM > PIECE_TUNING.MASS_HI) { this.fail('mass'); return; }
    // (iii) no inverted tetrahedron (c, tri), no triangle under 1e-4 of the mean area
    if (this.badTriangles(X) > 0) { this.fail('mesh'); return; }
    // (iv) the exact volume
    const vol = meshVolume(X, tris), target = this.frac * S.v3;
    if (Math.abs(vol - target) > 1e-12 * target * 1.01) { this.fail('volume'); return; }
    // (v) the skin offset
    if (Math.abs(this.delta) > PIECE_TUNING.DELTA_MAX * R0) { this.fail('offset'); return; }
    // normalise: offset = mass centroid, restLocal = x - offset, re-centred once more so sum m restLocal = 0
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += mass[i] * X[i * 3]; cy += mass[i] * X[i * 3 + 1]; cz += mass[i] * X[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const p = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = X[i * 3] - cx; p[i * 3 + 1] = X[i * 3 + 1] - cy; p[i * 3 + 2] = X[i * 3 + 2] - cz; }
    let rx = 0, ry = 0, rz = 0;
    for (let i = 0; i < n; i++) { rx += mass[i] * p[i * 3]; ry += mass[i] * p[i * 3 + 1]; rz += mass[i] * p[i * 3 + 2]; }
    rx /= n; ry /= n; rz /= n;
    for (let i = 0; i < n; i++) { p[i * 3] -= rx; p[i * 3 + 1] -= ry; p[i * 3 + 2] -= rz; }
    cx += rx; cy += ry; cz += rz;
    let minY = Infinity, maxY = -Infinity, peak = 0;
    for (let i = 0; i < n; i++) { const y = p[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) { maxY = y; peak = i; } }
    // hand the normalised mesh to the last stage (weights and the assembly)
    this.fin[0] = cx; this.fin[1] = cy; this.fin[2] = cz; this.fin[3] = minY; this.fin[4] = maxY; this.fin[5] = peak; this.fin[6] = vol; this.fin[7] = minM; this.fin[8] = maxM;
    this.finP = p; this.finMass = mass;
    this.pass = 0;
    this.st = ST_WEIGHTS;
  }

  /* step 11 and the assembly: weights from the recipe, the RestShape, the cache */
  private sWeights(): void {
    const n = this.n, X = this.X, S = this.S, R0 = S.R0, np = this.cell.np, pl = this.cell.pl, p = this.finP!, mass = this.finMass!;
    const cx = this.fin[0], cy = this.fin[1], cz = this.fin[2], minY = this.fin[3], maxY = this.fin[4], peak = this.fin[5], vol = this.fin[6], minM = this.fin[7], maxM = this.fin[8];
    // weights from the recipe at each vertex's direction from the recipe origin, faded for a vertex deep inside (a cap vertex is not a thin tip)
    // (two halves of the vertex range, one per stage call: the per-vertex recipe evaluation is the longest stage of a species with many features)
    if (this.pass === 0) { this.wF = new Float64Array(n); this.wFe = new Int16Array(n); this.wS = new Float64Array(n); }
    const rec = recipeOf(S.species), floppy = this.wF!, feature = this.wFe!, strutW = this.wS!, org = S.org;
    const i0 = this.pass === 0 ? 0 : n >> 1, i1 = this.pass === 0 ? n >> 1 : n;
    for (let i = i0; i < i1; i++) {
      const dx = X[i * 3] - org[0], dy = X[i * 3 + 1] - org[1], dz = X[i * 3 + 2] - org[2], rho = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (rho < 1e-12) { feature[i] = -1; continue; }
      const ux = dx / rho, uy = dy / rho, uz = dz / rho;
      const fl = floppyOf(rec, ux, uy, uz), ft = floppyFeature, second = floppySecond;
      feature[i] = ft;
      if (fl <= 1e-6) continue;
      const fade = sstep(0.55, 0.9, rho / (evalShape(rec, ux, uy, uz) * R0));
      floppy[i] = fl * fade; strutW[i] = strutWeight(fl, second) * fade;
    }
    if (this.pass === 0) { this.pass = 1; return; }
    this.pass = 0;
    const rest: RestShape = {
      restLocal: p, floppy, feature, strutW, mass, restRadius: R0 * Math.cbrt(this.frac), restCenterY: -minY, peakVertex: peak, restVolume: vol, height: maxY - minY,
    };
    const cells: CutPlaneRest[][] = [[]];
    const lits = this.region && this.region.cells && this.region.cells[0] ? this.region.cells[0] : [];
    for (let k = 0; k < np; k++) cells[0].push({ n: { x: -pl[k * 4], y: -pl[k * 4 + 1], z: -pl[k * 4 + 2] }, d: -pl[k * 4 + 3], id: Math.abs(lits[k]) });
    this.built = {
      rest, mesh: this.mesh, detail: this.detail, frac: this.frac, offset: { x: cx, y: cy, z: cz }, rayOrigin: { x: this.c[0] - cx, y: this.c[1] - cy, z: this.c[2] - cz }, cells,
      rimClean: this.rimClean, phi: this.phi, skinDelta: Math.abs(this.delta) / R0, footAdded: this.footAdded, capPlanes: np, minMass: minM, maxMass: maxM,
    };
    cachePut(this.key, this.built);
    this.status = 'ok';
  }
}

/** Build a piece synchronously through the cache. Returns the piece, or the reason it was refused ('unsound' = it would not be one body; anything else is a
 *  build-gate failure that the retry ladder of CutJob may repair). */
export function buildPiece(genome: Genome, region: PieceRegion | undefined, detail: number, frac?: number, centre?: { x: number; y: number; z: number }): PieceBuilt | { fail: string } {
  const S = getSource(genome);
  const key = pieceKey(S, region, detail, frac);
  const hit = cacheGet(key);
  if (hit) return hit;
  const job = new PieceJob(genome, region, detail, frac, centre);
  job.run(Infinity);
  return job.built ?? { fail: job.why };
}

/* ───────────────────────────── a cut: the plan of the two children and the retry ladder ───────────────────────────── */

export interface CutPlanParts {
  fa: number;                // share of the parent on side A (exact clip of the parent's REST mesh)
  fracA: number; fracB: number;
  cA: { x: number; y: number; z: number }; cB: { x: number; y: number; z: number };   // clipped centroids in W
  aspectA: number; aspectB: number;
}
const CP = new Float64Array(16), CQ = new Float64Array(16), PL4 = new Float64Array(4), PL4B = new Float64Array(4);
/** Pure plan of a cut of a parent whose rest mesh in W is (pos, tris): the exact clip by the plane n . x = d (side A: n . x >= d). */
export function planChildren(pos: ArrayLike<number>, tris: Uint32Array, parentFrac: number, n: { x: number; y: number; z: number }, d: number, out: CutPlanParts): boolean {
  PL5[0] = n.x; PL5[1] = n.y; PL5[2] = n.z; PL5[3] = d; PL5[4] = parentFrac;
  return planSplit(pos, tris, PL5, out);
}
const PL5 = new Float64Array(5);
/** planChildren with the plane and the parent's share passed in a typed array [nx, ny, nz, d, parentFrac]: a caller that must not allocate (SoftBody.planCut) passes
 *  no double across the call (a double passed to a call that is not inlined is boxed: one heap number each). */
export function planSplit(pos: ArrayLike<number>, tris: Uint32Array, pl: Float64Array, out: CutPlanParts): boolean {
  const parentFrac = pl[4];
  PL4[0] = pl[0]; PL4[1] = pl[1]; PL4[2] = pl[2]; PL4[3] = pl[3];
  PL4B[0] = -pl[0]; PL4B[1] = -pl[1]; PL4B[2] = -pl[2]; PL4B[3] = -pl[3];
  clipMesh(pos, tris, PL4, CP); clipMesh(pos, tris, PL4B, CQ);
  const va = CP[CLIP_VOL], vb = CQ[CLIP_VOL], v = va + vb;
  if (!(v > 0) || !(va > 1e-9 * v) || !(vb > 1e-9 * v)) return false;
  out.fa = va / v; out.fracA = parentFrac * out.fa; out.fracB = parentFrac - out.fracA;
  out.cA.x = CP[CLIP_CX]; out.cA.y = CP[CLIP_CY]; out.cA.z = CP[CLIP_CZ];
  out.cB.x = CQ[CLIP_CX]; out.cB.y = CQ[CLIP_CY]; out.cB.z = CQ[CLIP_CZ];
  out.aspectA = CP[CLIP_ASPECT]; out.aspectB = CQ[CLIP_ASPECT];
  return true;
}
export const newCutPlanParts = (): CutPlanParts => ({ fa: 0, fracA: 0, fracB: 0, cA: { x: 0, y: 0, z: 0 }, cB: { x: 0, y: 0, z: 0 }, aspectA: 0, aspectB: 0 });

/** The ladder's shifts of the latched plane's d, in R0 (4.1 step 12). */
export const LADDER = [0, 0.004, -0.004, 0.008, -0.008, 0.012, -0.012];

export type CutStatus = 'run' | 'ok' | 'thin' | 'loose';

/**
 * The two children of one cut of a parent piece, built (resumably) with the retry ladder. `parent` is the parent's region (cell literals and planes), its
 * frac and its rest mesh in W; `plane` is the new cut {n, d} in W (side A: n . x >= d) and gets `id`. Side A is the literal +id, side B -id. On success `a`, `b`
 * hold the built children and `d` is the plane actually built (the ladder may have shifted it by at most 0.012 R0); `plan` holds the shares and centroids of that
 * plane. Refusals: 'loose' when a child is not one body (star-shapedness), 'thin' when every rung of the ladder failed the build gates.
 */
export class CutJob {
  status: CutStatus = 'run';
  why = '';
  a: PieceBuilt | null = null;
  b: PieceBuilt | null = null;
  d: number;
  shiftIdx = 0;
  /** 0 / 1: the side (A / B) whose region was unsound when the status is 'loose'. */
  badSide = -1;
  readonly plan = newCutPlanParts();
  readonly regionA: PieceRegion; readonly regionB: PieceRegion;
  private job: PieceJob | null = null;
  private side = 0;
  private fa0 = 0;
  private readonly genome: Genome;
  private readonly parent: { region: PieceRegion | undefined; frac: number; pos: ArrayLike<number>; tris: Uint32Array };
  private readonly nrm: { x: number; y: number; z: number };
  private readonly d0: number;
  private readonly id: number;
  private readonly R0: number;
  private readonly cache: boolean;
  constructor(genome: Genome, parent: { region: PieceRegion | undefined; frac: number; pos: ArrayLike<number>; tris: Uint32Array }, plane: { id: number; n: { x: number; y: number; z: number }; d: number }) {
    this.genome = genome; this.parent = parent; this.nrm = plane.n; this.d0 = plane.d; this.d = plane.d; this.id = plane.id;
    this.R0 = getSource(genome).R0; this.cache = true;
    this.regionA = { planes: [], cells: [[]] }; this.regionB = { planes: [], cells: [[]] };
    this.setPlane(plane.d);
    if (!planChildren(parent.pos, parent.tris, parent.frac, plane.n, plane.d, this.plan)) { this.status = 'thin'; this.why = 'misses'; return; }
    this.fa0 = this.plan.fa;
  }
  /** (Re)write the two child regions for the plane at offset d. */
  private setPlane(d: number): void {
    const par = this.parent.region, base = par && par.cells && par.cells[0] ? par.cells[0] : [], planes = par ? par.planes.slice() : [];
    const np = { id: this.id, n: { x: this.nrm.x, y: this.nrm.y, z: this.nrm.z }, d };
    planes.push(np);
    (this.regionA as { planes: typeof planes }).planes = planes; (this.regionB as { planes: typeof planes }).planes = planes;
    (this.regionA as { cells: number[][] }).cells = [[...base, this.id]]; (this.regionB as { cells: number[][] }).cells = [[...base, -this.id]];
    this.d = d;
  }
  run(budgetMs: number, maxStages = Infinity): boolean {
    const t0 = budgetMs === Infinity ? 0 : performance.now();
    let k = 0, s0 = t0;
    while (this.status === 'run' && k < maxStages) {
      if (!this.job) {
        if (!this.startSide()) { if (this.status !== 'run') break; continue; }
      }
      const j = this.job!;
      const before = j.stagesRun;
      j.run(Infinity, 1);
      k += j.stagesRun - before;
      if (j.status !== 'run') this.finishSide(j);
      if (budgetMs !== Infinity) {
        const now = performance.now();
        if (now - t0 + (now - s0) > budgetMs) break;   // (as PieceJob.run: the next stage is predicted by the one just run)
        s0 = now;
      }
    }
    return this.status !== 'run';
  }
  /** Start the build of the current side at the current rung; false when it was a cache hit or the rung was skipped (the caller loops). */
  private startSide(): boolean {
    if (this.side === 0 && this.shiftIdx > 0) {
      // new rung: the plane shifted; skip it when a part would fall under 1/8 or a share moves by more than 0.01
      const d = this.d0 + LADDER[this.shiftIdx] * this.R0;
      const p = newCutPlanParts();
      if (!planChildren(this.parent.pos, this.parent.tris, this.parent.frac, this.nrm, d, p) || p.fracA < 0.125 - 1e-4 || p.fracB < 0.125 - 1e-4 || Math.abs(p.fa - this.fa0) > 0.01) {
        this.shiftIdx++;
        if (this.shiftIdx >= LADDER.length) { this.status = 'thin'; this.why = this.why || 'ladder'; }
        return false;
      }
      this.setPlane(d);
      Object.assign(this.plan, { fa: p.fa, fracA: p.fracA, fracB: p.fracB, aspectA: p.aspectA, aspectB: p.aspectB });
      this.plan.cA = p.cA; this.plan.cB = p.cB;
    }
    const region = this.side === 0 ? this.regionA : this.regionB, frac = this.side === 0 ? this.plan.fracA : this.plan.fracB, c = this.side === 0 ? this.plan.cA : this.plan.cB;
    const detail = pieceDetail(frac), S = getSource(this.genome), key = pieceKey(S, region, detail, frac), hit = this.cache ? cacheGet(key) : undefined;
    if (hit) { if (this.side === 0) { this.a = hit; this.side = 1; } else { this.b = hit; this.status = 'ok'; } return false; }
    this.job = new PieceJob(this.genome, region, detail, frac, c);
    return true;
  }
  private finishSide(j: PieceJob): void {
    this.job = null;
    if (j.status === 'unsound') { this.status = 'loose'; this.why = 'unsound'; this.badSide = this.side; return; }
    if (j.status === 'fail') {
      // this rung failed: next rung (side A again)
      this.why = j.why; this.a = null; this.b = null; this.side = 0; this.shiftIdx++;
      if (this.shiftIdx >= LADDER.length) this.status = 'thin';
      return;
    }
    if (this.side === 0) { this.a = j.built; this.side = 1; } else { this.b = j.built; this.status = 'ok'; }
  }
}
