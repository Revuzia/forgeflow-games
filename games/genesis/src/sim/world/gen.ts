// GENESIS — world-generation helpers on the cell graph: priority-flood depression filling, steepest-descent drainage,
// flow accumulation, graph distance fields, impact craters and volcano cones.
//
// Pure functions of their inputs (no RNG streams are consumed here unless one is passed in), deterministic iteration
// order (cell order, CCW neighbour order, a binary heap with id tie-breaks).

import type { IcoGrid } from '../grid/icogrid.ts';
import type { Rng } from '../core/rng.ts';

/** binary min-heap of cell ids keyed by float; ties broken by id so pops are fully deterministic */
export class CellHeap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(Math.max(16, cap));
    this.keys = new Float64Array(Math.max(16, cap));
  }
  private less(ka: number, ia: number, kb: number, ib: number): boolean {
    return ka < kb || (ka === kb && ia < ib);
  }
  push(id: number, key: number): void {
    if (this.size >= this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2); ni.set(this.ids); this.ids = ni;
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(key, id, this.keys[p], this.ids[p])) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.less(this.keys[c + 1], this.ids[c + 1], this.keys[c], this.ids[c])) c++;
      if (!this.less(this.keys[c], this.ids[c], lastKey, lastId)) break;
      this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.ids[i] = lastId; this.keys[i] = lastKey;
    return top;
  }
}

/**
 * Priority-flood (Barnes 2014): the spill level of every cell (>= h). Seeds are cells below `sea`; with no such cell
 * the lowest cell seeds (a closed world drains to its deepest point). A tiny epsilon slope keeps flats draining.
 */
export function priorityFlood(g: IcoGrid, h: ArrayLike<number>, sea: number, eps = 1e-3): Float32Array {
  const N = g.count;
  const filled = new Float32Array(N);
  const done = new Uint8Array(N);
  const heap = new CellHeap(N);
  let seeded = 0;
  for (let c = 0; c < N; c++) {
    if (h[c] < sea) { filled[c] = h[c]; done[c] = 1; heap.push(c, h[c]); seeded++; }
  }
  if (!seeded) {
    let lo = 0;
    for (let c = 1; c < N; c++) if (h[c] < h[lo]) lo = c;
    filled[lo] = h[lo]; done[lo] = 1; heap.push(lo, h[lo]);
  }
  while (heap.size) {
    const c = heap.pop();
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (done[o]) continue;
      done[o] = 1;
      filled[o] = Math.max(h[o], filled[c] + eps);
      heap.push(o, filled[o]);
    }
  }
  return filled;
}

/** steepest-descent receiver on the filled surface (-1 = below sea / outlet) */
export function receivers(g: IcoGrid, filled: ArrayLike<number>, sea: number): Int32Array {
  const N = g.count;
  const rcv = new Int32Array(N).fill(-1);
  for (let c = 0; c < N; c++) {
    if (filled[c] < sea) continue;
    let best = -1, bestH = filled[c];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (filled[o] < bestH) { bestH = filled[o]; best = o; }
    }
    rcv[c] = best;
  }
  return rcv;
}

/** cells sorted from high to low filled height (ties by id) */
export function sortDescending(filled: ArrayLike<number>): Int32Array {
  const N = filled.length;
  const order = new Int32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => (filled[b] - filled[a]) || (a - b));
  return order;
}

/** flow accumulation (sum of `rain` weights, default 1 per cell) along receivers */
export function accumulate(order: Int32Array, rcv: Int32Array, rain?: ArrayLike<number>): Float32Array {
  const N = rcv.length;
  const acc = new Float32Array(N);
  for (let i = 0; i < N; i++) acc[i] = rain ? rain[i] : 1;
  for (let k = 0; k < N; k++) {
    const c = order[k];
    const r = rcv[c];
    if (r >= 0) acc[r] += acc[c];
  }
  return acc;
}

/** graph distance in cells to the nearest cell where src(c) holds (BFS), capped */
export function distanceFrom(g: IcoGrid, src: (c: number) => boolean, cap = 1e9): Float32Array {
  const N = g.count;
  const d = new Float32Array(N).fill(cap);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let c = 0; c < N; c++) if (src(c)) { d[c] = 0; q[qt++] = c; }
  while (qh < qt) {
    const c = q[qh++];
    const nd = d[c] + 1;
    if (nd >= cap) continue;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (d[o] > nd) { d[o] = nd; q[qt++] = o; }
    }
  }
  return d;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** value at quantile q (0..1) of an array (copy-sorted) */
export function quantile(a: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(a as ArrayLike<number>).sort();
  if (!s.length) return 0;
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i];
}

/**
 * Stamp one impact crater into height array h: parabolic bowl (flat-floored and terraced when large, with a central
 * peak), raised rim, ejecta blanket falling off with distance. The bowl is cut relative to the LOCAL pre-impact level
 * (mean height over the crater), not added on top: overlapping impacts re-shape the ground instead of digging an
 * ever-deeper pit, so heavily cratered terrain saturates the way real regolith does. `angle` = crater radius (rad).
 * Cells inside the rim are flagged in `mask` (crater geology for ores).
 */
export function stampCrater(
  g: IcoGrid, h: Float32Array, cx: number, cy: number, cz: number, angle: number, radius: number,
  mask: Uint8Array | null, depthScale = 0.2, out: number[] = [],
): void {
  const P = g.pos;
  const diameterM = 2 * angle * radius;
  // depth/diameter ~0.1 for small simple craters, shallower for big complex ones
  const dd = diameterM < 400 ? 0.1 : 0.1 * Math.pow(400 / diameterM, 0.45);
  const depth = diameterM * dd * (depthScale / 0.2);
  const rim = depth * 0.28;
  const big = diameterM > 520;
  g.cellsWithin(cx, cy, cz, angle * 2.6, out);
  let ref = 0, nref = 0;
  for (const c of out) {
    const d = Math.acos(Math.min(1, P[c * 3] * cx + P[c * 3 + 1] * cy + P[c * 3 + 2] * cz)) / angle;
    if (d < 1.2) { ref += h[c]; nref++; }
  }
  ref = nref ? ref / nref : 0;
  for (const c of out) {
    const d = Math.acos(Math.min(1, P[c * 3] * cx + P[c * 3 + 1] * cy + P[c * 3 + 2] * cz)) / angle;
    if (d < 1.15) {
      let prof: number;
      if (d < 1) {
        const bowl = big ? Math.min(1, (1 - d * d) * 1.6) : 1 - d * d;
        prof = -depth * bowl + rim * smoothstep(0.7, 1, d);
        if (big) prof += depth * 0.06 * Math.round(d * 4) / 4; // terraces
        if (big && d < 0.16) prof += depth * 0.45 * (1 - d / 0.16); // central peak
        if (mask) mask[c] = 1;
      } else prof = rim * (1 - (d - 1) / 0.15 * 0.3);
      // blend from replace (inside) to the surrounding ground (at the rim crest)
      const w = d < 0.85 ? 1 : 1 - smoothstep(0.85, 1.15, d) * 0.6;
      h[c] = h[c] * (1 - w) + (ref + prof) * w;
    } else {
      // ejecta blanket: falls off ~ (1/d)^3
      const t = d - 1;
      h[c] += rim * 0.7 * Math.exp(-t * t * 5) + rim * 0.2 * Math.pow(1 / d, 3);
    }
  }
}

/** Stamp a volcano cone with a summit caldera; returns the summit cell. */
export function stampVolcano(
  g: IcoGrid, h: Float32Array, cx: number, cy: number, cz: number, angle: number, height: number, out: number[] = [],
): number {
  const P = g.pos;
  g.cellsWithin(cx, cy, cz, angle, out);
  let summit = out.length ? out[0] : g.nearestCell(cx, cy, cz);
  for (const c of out) {
    const d = Math.acos(Math.min(1, P[c * 3] * cx + P[c * 3 + 1] * cy + P[c * 3 + 2] * cz)) / angle;
    let dh = height * Math.pow(Math.max(0, 1 - d), 1.6);
    if (d < 0.14) dh -= height * 0.22 * (1 - d / 0.14); // caldera
    h[c] += dh;
  }
  return summit;
}

/** random unit vector (uniform on the sphere) from a stream */
export function randomDir(rng: Rng, out: number[] = [0, 0, 0]): number[] {
  const u = rng.float() * 2 - 1;
  const th = rng.float() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  out[0] = s * Math.cos(th);
  out[1] = u;
  out[2] = s * Math.sin(th);
  return out;
}
