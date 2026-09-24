// BLOCKTOOTH — combat broadphase (CONTRACT §5.3, combat lane).
// A uniform hash grid over ALIVE enemies, rebuilt twice per tick by world.ts
// (after stepCity and again after enemies/boss moved). THREE-free, DOM-free,
// deterministic: iteration order depends only on the enemies array order + positions.
//
// Queries never allocate result arrays: callers pass `out`, internal candidate
// buffers are module-level and reused (with a small depth stack so a query made
// from inside another query's filter callback cannot corrupt the outer one).
//
// Distance convention: every query is an OVERLAP test against the enemy's body
// circle (centre + e.radius). "Nearest" ranks by SURFACE distance
// max(0, |p − e| − e.radius), ties broken by the lower enemy id.

import type { Enemy, Shape, World } from '../core/types.ts';
import { circleInShape, shapeBounds } from '../core/math.ts';

const TABLE_BITS = 12;
const TABLE = 1 << TABLE_BITS;          // 4096 hash buckets
const MASK = TABLE - 1;
const MIN_CELL = 8;                      // m — CONTRACT: cell ≈ max(8, titan.height)

interface EnemyGrid {
  cell: number;
  inv: number;
  heads: Int32Array;     // bucket → first item index (−1 = empty)
  next: Int32Array;      // item → next item index in the same bucket
  mark: Int32Array;      // item → last query stamp that visited it (dedupe across hash collisions)
  items: Enemy[];        // alive enemies at rebuild time, in world.enemies order
  count: number;
  maxR: number;          // largest enemy radius (broadphase padding)
  stamp: number;
}

const grids = new WeakMap<World, EnemyGrid>();

function makeGrid(cap: number): EnemyGrid {
  const heads = new Int32Array(TABLE); heads.fill(-1);
  return {
    cell: MIN_CELL, inv: 1 / MIN_CELL, heads,
    next: new Int32Array(cap), mark: new Int32Array(cap), items: [],
    count: 0, maxR: 0, stamp: 0,
  };
}

function gridOf(w: World): EnemyGrid {
  let g = grids.get(w);
  if (!g) { g = makeGrid(256); grids.set(w, g); rebuildInto(w, g); }
  return g;
}

const hashCell = (cx: number, cz: number): number =>
  ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0) & MASK;

function rebuildInto(w: World, g: EnemyGrid): void {
  const cell = Math.max(MIN_CELL, w.titan ? w.titan.height : MIN_CELL);
  g.cell = cell; g.inv = 1 / cell;
  g.stamp = 0;   // every live mark is reset below, so query stamps can restart (no Int32 wrap in long runs)
  g.heads.fill(-1);
  const es = w.enemies;
  let n = 0;
  for (let i = 0; i < es.length; i++) if (es[i].alive) n++;
  if (n > g.next.length) {
    let cap = g.next.length;
    while (cap < n) cap *= 2;
    g.next = new Int32Array(cap);
    g.mark = new Int32Array(cap);
    g.stamp = 0;
  }
  const items = g.items;
  items.length = n;
  let k = 0, maxR = 0;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e.alive) continue;
    items[k] = e;
    const h = hashCell(Math.floor(e.x * g.inv), Math.floor(e.z * g.inv));
    g.next[k] = g.heads[h];
    g.heads[h] = k;
    g.mark[k] = 0;
    if (e.radius > maxR) maxR = e.radius;
    k++;
  }
  g.count = n;
  g.maxR = maxR;
}

/** Rebuild the broadphase over the currently alive enemies (world.ts calls this twice per tick). */
export function rebuildEnemyGrid(w: World): void {
  let g = grids.get(w);
  if (!g) { g = makeGrid(256); grids.set(w, g); }
  rebuildInto(w, g);
}

// ── candidate gathering (reused buffers, depth-stacked for re-entrancy) ──
const candBufs: number[][] = [[], [], [], [], [], [], [], []];
let depth = 0;

/** Fill candBufs[depth] with item indices whose cell overlaps the rect; returns the count. */
function gather(g: EnemyGrid, minX: number, minZ: number, maxX: number, maxZ: number, buf: number[]): number {
  let n = 0;
  if (g.count === 0) { buf.length = 0; return 0; }
  const finite = Number.isFinite(minX) && Number.isFinite(minZ) && Number.isFinite(maxX) && Number.isFinite(maxZ);
  let cx0 = 0, cx1 = 0, cz0 = 0, cz1 = 0, cells = Infinity;
  if (finite) {
    cx0 = Math.floor(minX * g.inv); cx1 = Math.floor(maxX * g.inv);
    cz0 = Math.floor(minZ * g.inv); cz1 = Math.floor(maxZ * g.inv);
    cells = (cx1 - cx0 + 1) * (cz1 - cz0 + 1);
  }
  if (!finite || cells > g.count || cells > TABLE) {
    // huge query: a linear pass over the items is cheaper than walking empty cells
    for (let i = 0; i < g.count; i++) buf[n++] = i;
    buf.length = n;
    return n;
  }
  const stamp = ++g.stamp;
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      let i = g.heads[hashCell(cx, cz)];
      while (i >= 0) {
        if (g.mark[i] !== stamp) { g.mark[i] = stamp; buf[n++] = i; }
        i = g.next[i];
      }
    }
  }
  // Restore insertion (world.enemies) order so results never depend on hash-bucket layout.
  // Zero-allocation: in-place insertion sort for small sets, else a stamp scan in index order.
  if (n > SMALL_SORT) {
    n = 0;
    for (let i = 0; i < g.count; i++) if (g.mark[i] === stamp) buf[n++] = i;
  } else {
    for (let a = 1; a < n; a++) {
      const v = buf[a];
      let b = a - 1;
      while (b >= 0 && buf[b] > v) { buf[b + 1] = buf[b]; b--; }
      buf[b + 1] = v;
    }
  }
  buf.length = n;
  return n;
}
/** Candidate sets up to this size are insertion-sorted; larger ones are re-read in index order. */
const SMALL_SORT = 24;

function pushBuf(): number[] {
  if (depth >= candBufs.length) candBufs.push([]);
  return candBufs[depth++];
}
function popBuf(): void { depth--; }

/** Enemies whose body circle overlaps the circle (x, z, r). Clears and fills `out`. */
export function enemiesInCircle(w: World, x: number, z: number, r: number, out: Enemy[]): Enemy[] {
  out.length = 0;
  const g = gridOf(w);
  const pad = r + g.maxR;
  const buf = pushBuf();
  try {
    const n = gather(g, x - pad, z - pad, x + pad, z + pad, buf);
    for (let k = 0; k < n; k++) {
      const e = g.items[buf[k]];
      if (!e.alive) continue;
      const dx = e.x - x, dz = e.z - z, rr = r + e.radius;
      if (dx * dx + dz * dz <= rr * rr) out.push(e);
    }
  } finally { popBuf(); }
  return out;
}

/** Enemies whose body circle overlaps the shape (shapeBounds broadphase + circleInShape). */
export function enemiesInShape(w: World, s: Shape, out: Enemy[]): Enemy[] {
  out.length = 0;
  const g = gridOf(w);
  if (g.count === 0) return out;
  const bb = shapeBounds(s);
  const pad = g.maxR;
  const buf = pushBuf();
  try {
    const n = gather(g, bb.minX - pad, bb.minZ - pad, bb.maxX + pad, bb.maxZ + pad, buf);
    for (let k = 0; k < n; k++) {
      const e = g.items[buf[k]];
      if (!e.alive) continue;
      if (circleInShape(s, e.x, e.z, e.radius)) out.push(e);
    }
  } finally { popBuf(); }
  return out;
}

/**
 * Nearest alive enemy whose body is within `r` metres of (x, z) (surface distance), or null.
 * Drones/airborne enemies are included (planar test). Ties → lower id.
 * `filter` must not itself mutate world.enemies.
 */
export function nearestEnemy(w: World, x: number, z: number, r: number, filter?: (e: Enemy) => boolean): Enemy | null {
  const g = gridOf(w);
  if (g.count === 0 || !(r >= 0)) return null;
  const pad = r + g.maxR;
  const buf = pushBuf();
  let best: Enemy | null = null, bestD = Infinity;
  try {
    const n = gather(g, x - pad, z - pad, x + pad, z + pad, buf);
    for (let k = 0; k < n; k++) {
      const e = g.items[buf[k]];
      if (!e.alive) continue;
      const d = Math.max(0, Math.hypot(e.x - x, e.z - z) - e.radius);
      if (d > r) continue;
      if (d < bestD || (d === bestD && best !== null && e.id < best.id)) {
        if (filter && !filter(e)) continue;
        best = e; bestD = d;
      }
    }
  } finally { popBuf(); }
  return best;
}

const nearD: number[] = [];

/**
 * Up to `n` nearest alive enemies within `r` (surface distance), sorted ascending
 * (ties → lower id). Clears and fills `out`.
 */
export function nearestEnemies(w: World, x: number, z: number, r: number, n: number, out: Enemy[]): Enemy[] {
  out.length = 0;
  const g = gridOf(w);
  if (g.count === 0 || n <= 0 || !(r >= 0)) return out;
  const pad = r + g.maxR;
  const buf = pushBuf();
  try {
    const m = gather(g, x - pad, z - pad, x + pad, z + pad, buf);
    let len = 0;
    for (let k = 0; k < m; k++) {
      const e = g.items[buf[k]];
      if (!e.alive) continue;
      const d = Math.max(0, Math.hypot(e.x - x, e.z - z) - e.radius);
      if (d > r) continue;
      // insertion into the sorted top-n window
      if (len === n) {
        const last = out[len - 1];
        if (d > nearD[len - 1] || (d === nearD[len - 1] && e.id > last.id)) continue;
        len--;
      }
      let j = len;
      while (j > 0 && (nearD[j - 1] > d || (nearD[j - 1] === d && out[j - 1].id > e.id))) {
        out[j] = out[j - 1]; nearD[j] = nearD[j - 1]; j--;
      }
      out[j] = e; nearD[j] = d; len++;
      out.length = len;
    }
    out.length = len;
  } finally { popBuf(); }
  return out;
}
