// GENESIS — keeps the client's copy of the ground's per-cell gradients (surface.ts surfaceGradients) current as new
// surface arrays arrive, recomputing only the cells whose least-squares stencil saw a change (macfix 2026-11: the full
// pass ran on every surface arrival, ~12 a second per planet at 100x, 2-25 ms each on the main thread; a typical
// arrival changes a few hundred of 40962 cells). The per-cell arithmetic is surfaceGradients' own, in the same order,
// so the result is bit-identical to a full recompute (tests/ui-groundgrad.test.ts holds it to that).
import type { IcoGrid } from '../sim/grid/icogrid.ts';
import { MAX_GRAD } from '../sim/grid/surface.ts';

/** surfaceGradients' body for one cell (keep in step with src/sim/grid/surface.ts) */
function cellGradient(grid: IcoGrid, radius: number, surface: ArrayLike<number>, g: Float32Array, c: number): void {
  const P = grid.pos;
  const ns = grid.nbrStart, nb = grid.nbr;
  const px = P[c * 3], py = P[c * 3 + 1], pz = P[c * 3 + 2];
  let ex = pz, ez = -px;
  let el = Math.sqrt(ex * ex + ez * ez);
  let ey = 0;
  if (el < 1e-9) { ex = 1; ey = 0; ez = 0; el = 1; }
  ex /= el; ez /= el;
  const nx = py * ez - pz * ey, ny = pz * ex - px * ez, nz = px * ey - py * ex;
  const h0 = surface[c];
  let suu = 0, suv = 0, svv = 0, sud = 0, svd = 0;
  for (let e = ns[c]; e < ns[c + 1]; e++) {
    const k = nb[e];
    const dx = (P[k * 3] - px) * radius, dy = (P[k * 3 + 1] - py) * radius, dz = (P[k * 3 + 2] - pz) * radius;
    const u = dx * ex + dy * ey + dz * ez;
    const v = dx * nx + dy * ny + dz * nz;
    const dh = surface[k] - h0;
    suu += u * u; suv += u * v; svv += v * v; sud += u * dh; svd += v * dh;
  }
  const det = suu * svv - suv * suv;
  let gu = 0, gv = 0;
  if (det > 1e-12) {
    gu = (sud * svv - svd * suv) / det;
    gv = (svd * suu - sud * suv) / det;
  }
  const m = Math.sqrt(gu * gu + gv * gv);
  if (m > MAX_GRAD) { gu *= MAX_GRAD / m; gv *= MAX_GRAD / m; }
  const gx = gu * ex + gv * nx, gy = gu * ey + gv * ny, gz = gu * ez + gv * nz;
  g[c * 4] = gx;
  g[c * 4 + 1] = gy;
  g[c * 4 + 2] = gz;
  g[c * 4 + 3] = -(gx * px + gy * py + gz * pz);
}

/**
 * Per-planet gradient state. `update()` commits a surface at once; `offer()` + `step(budgetMs)` work a new surface off
 * in time slices (a surface arrival is cold code at 1x, every few seconds, 7-40 ms unsliced) and commit the heights,
 * gradients and bounds together, so whoever reads `surface` with `grad` always sees one consistent pair.
 */
export class GroundGradients {
  /** committed gradients (one buffer for the planet's life, rewritten only at a commit) */
  grad: Float32Array | null = null;
  /** committed heights the gradients were taken from (the arriving array itself, never written) */
  surface: ArrayLike<number> | null = null;
  maxGrad = 0;
  minSurface = 0;
  maxSurface = 0;
  /** cells recomputed for the last commit (n = full pass) — for tests and probes */
  lastCells = 0;
  private readonly grid: IcoGrid;
  private radius = NaN;
  private mark: Uint8Array;
  private list: Int32Array;
  private scratch: Float32Array;
  // the surface being worked off, and the newest one waiting behind it
  private job: { surface: ArrayLike<number>; radius: number; stage: 0 | 1 | 2; cursor: number; m: number; full: boolean; lo: number; hi: number; gm: number } | null = null;
  private next: { surface: ArrayLike<number>; radius: number } | null = null;

  constructor(grid: IcoGrid) {
    this.grid = grid;
    this.mark = new Uint8Array(grid.count);
    this.list = new Int32Array(grid.count);
    this.scratch = new Float32Array(grid.count * 4);
  }

  /** commit `surface` now (finishing any queued work first, so the newest surface wins) */
  update(surface: ArrayLike<number>, radius: number): void {
    this.offer(surface, radius);
    while (this.pending()) this.step(Infinity);
  }

  /** queue a new surface (it starts once the one in hand commits: no surface is starved by newer ones) */
  offer(surface: ArrayLike<number>, radius: number): void {
    if (this.job) { this.next = { surface, radius }; return; }
    this.start(surface, radius);
  }

  pending(): boolean { return this.job !== null; }

  private start(surface: ArrayLike<number>, radius: number): void {
    const full = !this.grad || !this.surface || radius !== this.radius;
    this.job = { surface, radius, stage: 0, cursor: 0, m: 0, full, lo: Infinity, hi: -Infinity, gm: 0 };
  }

  /** advance the work for up to `budgetMs`; true when a surface was committed by this call */
  step(budgetMs: number): boolean {
    const j = this.job;
    if (!j) return false;
    const grid = this.grid, n = grid.count, s = j.surface, g = this.scratch, mark = this.mark, list = this.list;
    const deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
    const ns = grid.nbrStart, nb = grid.nbr;
    const SLICE = 1024;
    // stage 0: bounds + which cells changed (a cell's gradient reads its own height and its neighbours', adjacency
    // is symmetric, so a changed height dirties the cell and every neighbour; past an eighth of the planet the full
    // pass is as cheap)
    while (j.stage === 0) {
      const prev = this.surface, cap = n >> 3;
      const end = Math.min(n, j.cursor + SLICE);
      let lo = j.lo, hi = j.hi, m = j.m;
      for (let c = j.cursor; c < end; c++) {
        const v = s[c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (j.full || v === prev![c]) continue;
        if (!mark[c]) { mark[c] = 1; list[m++] = c; }
        for (let e = ns[c]; e < ns[c + 1]; e++) { const k = nb[e]; if (!mark[k]) { mark[k] = 1; list[m++] = k; } }
        if (m > cap) { j.full = true; for (let i = 0; i < m; i++) mark[list[i]] = 0; m = 0; }
      }
      j.lo = lo; j.hi = hi; j.m = m; j.cursor = end;
      if (end === n) { j.stage = 1; j.cursor = 0; if (!j.full) g.set(this.grad!); }
      if (performance.now() > deadline) return false;
    }
    // stage 1: the gradients of the dirty cells (or of every cell), into the scratch buffer
    while (j.stage === 1) {
      const total = j.full ? n : j.m;
      const end = Math.min(total, j.cursor + SLICE);
      if (j.full) for (let c = j.cursor; c < end; c++) cellGradient(grid, j.radius, s, g, c);
      else for (let i = j.cursor; i < end; i++) { const c = list[i]; cellGradient(grid, j.radius, s, g, c); mark[c] = 0; }
      j.cursor = end;
      if (end === total) { j.stage = 2; j.cursor = 0; }
      if (performance.now() > deadline) return false;
    }
    // stage 2: the largest gradient
    while (j.stage === 2) {
      const end = Math.min(n, j.cursor + SLICE * 4);
      let gm = j.gm;
      for (let c = j.cursor; c < end; c++) { const i = c * 4; const q = g[i] * g[i] + g[i + 1] * g[i + 1] + g[i + 2] * g[i + 2]; if (q > gm) gm = q; }
      j.gm = gm; j.cursor = end;
      if (end === n) break;
      if (performance.now() > deadline) return false;
    }
    // commit
    if (!this.grad) this.grad = new Float32Array(n * 4);
    this.grad.set(g);
    this.surface = s;
    this.radius = j.radius;
    this.minSurface = j.lo;
    this.maxSurface = j.hi;
    this.maxGrad = Math.sqrt(j.gm);
    this.lastCells = j.full ? n : j.m;
    this.job = null;
    const nx = this.next;
    this.next = null;
    if (nx) this.start(nx.surface, nx.radius);
    return true;
  }
}
