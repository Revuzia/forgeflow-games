// GENESIS — paths on the cell graph (CONTRACT.md §8.3): A* with slope / water / road / danger costs, and per-settlement
// flow fields (Dijkstra trees toward the settlement centre over its territory).
//
// Agents moving inside their territory follow the settlement's flow field: home is the root, any cell's next hop leads
// toward it, and a trip between two cells walks both chains to where they meet (the lowest common ancestor) — no search
// per trip. Journeys beyond the territory (exploring, migrating, distant hunts) run a bounded A*. Edge cost =
// edge length (m) × stepFactor (slope, wading / swimming, snow, sand, fire, roads). Ties break on the cell index, so
// results are deterministic. Scratch arrays are transient and reused; nothing here allocates per step.

import type { Planet } from '../world/planet.ts';
import { stepFactor } from '../people/world.ts';

export interface PathOpts {
  /** × walking speed in water (0 = cannot swim) */
  swim: number;
  fly: boolean;
  /** node expansions before giving up (A*) */
  maxExpand?: number;
  /** extra cost multiplier per cell (danger, foreign territory); 1 = none */
  extra?: (c: number) => number;
}

export interface FlowFieldData {
  cells: number[];
  next: number[];
  cost: number[];
}

// ───────────────────────────── scratch ─────────────────────────────

interface Scratch {
  n: number;
  g: Float64Array;
  from: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  gen: number;
  heapC: Int32Array;
  heapF: Float64Array;
}

const scratches = new Map<number, Scratch>();

function scratchFor(n: number): Scratch {
  let s = scratches.get(n);
  if (!s) {
    s = { n, g: new Float64Array(n), from: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), gen: 0, heapC: new Int32Array(1024), heapF: new Float64Array(1024) };
    scratches.set(n, s);
  }
  s.gen = (s.gen + 1) >>> 0;
  if (s.gen === 0) { s.stamp.fill(0); s.closed.fill(0); s.gen = 1; }
  return s;
}

// a binary min-heap on (f, cell) — cell index breaks ties so pops are deterministic
let heapN = 0;
function hpush(s: Scratch, c: number, f: number): void {
  if (heapN >= s.heapC.length) {
    const nc = new Int32Array(s.heapC.length * 2); nc.set(s.heapC); s.heapC = nc;
    const nf = new Float64Array(s.heapF.length * 2); nf.set(s.heapF); s.heapF = nf;
  }
  let i = heapN++;
  const C = s.heapC, F = s.heapF;
  while (i > 0) {
    const pi = (i - 1) >> 1;
    if (F[pi] < f || (F[pi] === f && C[pi] < c)) break;
    C[i] = C[pi]; F[i] = F[pi];
    i = pi;
  }
  C[i] = c; F[i] = f;
}
function hpop(s: Scratch): number {
  const C = s.heapC, F = s.heapF;
  const top = C[0];
  const lc = C[--heapN], lf = F[heapN];
  let i = 0;
  for (;;) {
    let m = i * 2 + 1;
    if (m >= heapN) break;
    if (m + 1 < heapN && (F[m + 1] < F[m] || (F[m + 1] === F[m] && C[m + 1] < C[m]))) m++;
    if (F[m] > lf || (F[m] === lf && C[m] > lc)) break;
    C[i] = C[m]; F[i] = F[m];
    i = m;
  }
  C[i] = lc; F[i] = lf;
  return top;
}

// ───────────────────────────── A* ─────────────────────────────

/**
 * A* from cell `from` to cell `to`. On success writes the cells AFTER `from` up to and including `to` into `out` and
 * returns true; false when unreachable within the expansion budget (out then holds the best partial path toward it).
 */
export function findPath(p: Planet, from: number, to: number, opts: PathOpts, out: number[]): boolean {
  out.length = 0;
  if (from === to) return true;
  const g = p.grid, geo = p.geo;
  const N = p.count;
  const s = scratchFor(N);
  const P = g.pos;
  const R = p.st.radius;
  const tx = P[to * 3], ty = P[to * 3 + 1], tz = P[to * 3 + 2];
  // admissible heuristic: the cheapest possible step is a fully worn road on flat ground (factor 1 / 1.9)
  const h = (c: number) => {
    const d = P[c * 3] * tx + P[c * 3 + 1] * ty + P[c * 3 + 2] * tz;
    return (Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * R) / 1.9;
  };
  const maxExpand = opts.maxExpand ?? 4000;
  heapN = 0;
  s.stamp[from] = s.gen;
  s.g[from] = 0;
  s.from[from] = -1;
  hpush(s, from, h(from));
  let expanded = 0;
  let best = from, bestH = h(from);
  while (heapN > 0) {
    const c = hpop(s);
    if (s.closed[c] === s.gen) continue;
    s.closed[c] = s.gen;
    if (c === to) { best = to; break; }
    const hc = h(c);
    if (hc < bestH) { bestH = hc; best = c; }
    if (++expanded > maxExpand) break;
    const gc = s.g[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (s.closed[o] === s.gen) continue;
      let k = stepFactor(p, c, o, opts.swim, opts.fly);
      if (k === Infinity) continue;
      if (opts.extra) k *= opts.extra(o);
      const ng = gc + geo.len[e] * R * k;
      if (s.stamp[o] !== s.gen || ng < s.g[o]) {
        s.stamp[o] = s.gen;
        s.g[o] = ng;
        s.from[o] = c;
        hpush(s, o, ng + h(o));
      }
    }
  }
  // walk back from the goal (or the closest reached cell)
  const rev: number[] = [];
  for (let c = best; c !== from && c >= 0; c = s.from[c]) {
    rev.push(c);
    if (rev.length > N) break;
  }
  for (let i = rev.length - 1; i >= 0; i--) out.push(rev[i]);
  return best === to;
}

// ───────────────────────────── flow fields ─────────────────────────────

/**
 * Dijkstra from `centre` over cells within `maxRings` graph rings: for each reached cell, the next hop toward the
 * centre and the travel cost. Cells are listed ascending (binary-searchable, canonical).
 */
export function buildFlowField(p: Planet, centre: number, maxRings: number, opts: PathOpts): FlowFieldData {
  const g = p.grid, geo = p.geo;
  const N = p.count;
  const s = scratchFor(N);
  const R = p.st.radius;
  // ring limit by BFS depth (stamp + from reused: from = depth here, first pass)
  const ring = new Map<number, number>();
  ring.set(centre, 0);
  let frontier = [centre];
  for (let d = 1; d <= maxRings; d++) {
    const nf: number[] = [];
    for (const c of frontier) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (!ring.has(o)) { ring.set(o, d); nf.push(o); }
    }
    frontier = nf;
  }
  heapN = 0;
  s.stamp[centre] = s.gen;
  s.g[centre] = 0;
  s.from[centre] = -1;
  hpush(s, centre, 0);
  const reached: number[] = [];
  while (heapN > 0) {
    const c = hpop(s);
    if (s.closed[c] === s.gen) continue;
    s.closed[c] = s.gen;
    reached.push(c);
    const gc = s.g[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (!ring.has(o) || s.closed[o] === s.gen) continue;
      // cost of walking o -> c (toward the centre)
      let k = stepFactor(p, o, c, opts.swim, opts.fly);
      if (k === Infinity) continue;
      if (opts.extra) k *= opts.extra(o);
      const ng = gc + geo.len[e] * R * k;
      if (s.stamp[o] !== s.gen || ng < s.g[o]) {
        s.stamp[o] = s.gen;
        s.g[o] = ng;
        s.from[o] = c;
        hpush(s, o, ng);
      }
    }
  }
  reached.sort((a, b) => a - b);
  return {
    cells: reached,
    next: reached.map((c) => s.from[c]),
    cost: reached.map((c) => Math.round(s.g[c] * 10) / 10),
  };
}

/** index of cell in a flow field (binary search), -1 if outside */
export function flowIndex(ff: FlowFieldData, cell: number): number {
  const a = ff.cells;
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const v = a[m];
    if (v === cell) return m;
    if (v < cell) lo = m + 1; else hi = m - 1;
  }
  return -1;
}

/**
 * A path from `from` to `to` through the flow tree (both must be in it): up from `from` to the common ancestor, then
 * down to `to`. Writes cells after `from` through `to`; returns false if either cell is outside the field.
 */
export function flowPath(ff: FlowFieldData, from: number, to: number, out: number[]): boolean {
  out.length = 0;
  if (from === to) return true;
  const ia = flowIndex(ff, from), ib = flowIndex(ff, to);
  if (ia < 0 || ib < 0) return false;
  const up: number[] = [];
  const seen = new Map<number, number>();
  let c = from;
  for (let k = 0; c >= 0 && k < 400; k++) {
    seen.set(c, up.length);
    up.push(c);
    const i = flowIndex(ff, c);
    if (i < 0) return false;
    c = ff.next[i];
  }
  const down: number[] = [];
  c = to;
  let meet = -1;
  for (let k = 0; c >= 0 && k < 400; k++) {
    const at = seen.get(c);
    if (at !== undefined) { meet = at; break; }
    down.push(c);
    const i = flowIndex(ff, c);
    if (i < 0) return false;
    c = ff.next[i];
  }
  if (meet < 0) return false;
  for (let k = 1; k <= meet; k++) out.push(up[k]);
  for (let k = down.length - 1; k >= 0; k--) out.push(down[k]);
  return true;
}
