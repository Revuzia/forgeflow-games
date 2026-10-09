// GENESIS — the road network from the sim's `road` (wear) field (CONTRACT.md §15.6 "Roads"). Three-free: the
// renderer's ribbon roads (render/life/roads.ts) and the lookdev fabricator (src/client/lookdevlife.ts) both use it,
// so fabricated streets and drawn roads are the same curves.
//
//   1. Road cells: cells whose wear reaches a threshold.
//   2. Edges between neighbouring road cells, weighted by the lesser wear. A worn BLOB (a busy square, a camp) would
//      give a dense triangular mesh of edges — spaghetti — so the network is a MAXIMUM spanning forest of those edges
//      (the most-worn way between any two road cells) plus the heavily worn edges that close loops without running
//      nearly parallel to a kept edge (ring roads, town grids).
//   3. Chains: maximal runs between junctions (degree ≠ 2) and dead ends; isolated loops are chains too.
//   4. Each chain is a centripetal Catmull-Rom curve through its cell centres on the sphere, sampled every ~2 m, with
//      the wear interpolated along it (width and paving follow it).

import type { IcoGrid } from '../../sim/grid/icogrid.ts';

export interface RoadChain {
  /** the cells it passes, in order */
  cells: number[];
  /** samples along the curve: unit vectors (x, y, z per sample) */
  pts: number[];
  /** wear (0..1) at each sample */
  wear: number[];
  /** a loop (first cell == last cell) */
  loop: boolean;
}

/** max-weight spanning forest + strong loop-closing edges over the road cells in `cells` */
export function roadEdges(grid: IcoGrid, road: ArrayLike<number>, cells: number[], threshold: number): [number, number, number][] {
  const inSet = new Set<number>();
  for (const c of cells) if (road[c] >= threshold) inSet.add(c);
  const edges: [number, number, number][] = [];
  for (const c of inSet) {
    for (let e = grid.nbrStart[c]; e < grid.nbrStart[c + 1]; e++) {
      const n = grid.nbr[e];
      if (n > c && inSet.has(n)) edges.push([c, n, Math.min(road[c], road[n])]);
    }
  }
  // strongest first; ties by cell ids so the result is deterministic
  edges.sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1]);
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.has(y) && parent.get(y) !== r) { const nx = parent.get(y)!; parent.set(y, r); y = nx; }
    return r;
  };
  for (const c of inSet) parent.set(c, c);
  const kept: [number, number, number][] = [];
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); };
  const P = grid.pos;
  // the angle between edge a→b and a→c at a (cos), in the tangent plane
  const cosAt = (a: number, b: number, c: number): number => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    let ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    let vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const du = ux * ax + uy * ay + uz * az, dv = vx * ax + vy * ay + vz * az;
    ux -= ax * du; uy -= ay * du; uz -= az * du;
    vx -= ax * dv; vy -= ay * dv; vz -= az * dv;
    return (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) || 1);
  };
  const extra: [number, number, number][] = [];
  for (const ed of edges) {
    const ra = find(ed[0]), rb = find(ed[1]);
    if (ra !== rb) { parent.set(ra, rb); kept.push(ed); link(ed[0], ed[1]); }
    else if (ed[2] >= Math.max(0.8, threshold + 0.15)) extra.push(ed);
  }
  for (const ed of extra) {
    const [a, b] = ed;
    let ok = true;
    for (const o of adj.get(a) ?? []) if (cosAt(a, b, o) > 0.6) { ok = false; break; }
    if (ok) for (const o of adj.get(b) ?? []) if (cosAt(b, a, o) > 0.6) { ok = false; break; }
    if (ok) { kept.push(ed); link(a, b); }
  }
  return kept;
}

/** split the kept edges into chains between junctions */
export function roadChains(grid: IcoGrid, road: ArrayLike<number>, edges: [number, number, number][], radius: number, step = 2): RoadChain[] {
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  for (const l of adj.values()) l.sort((x, y) => x - y);
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const chains: RoadChain[] = [];
  const walk = (start: number, next: number): number[] => {
    const cells = [start];
    let prev = start, cur = next;
    used.add(key(prev, cur));
    for (;;) {
      cells.push(cur);
      const nb = adj.get(cur) ?? [];
      if (nb.length !== 2 || cur === start) break;
      const nx = nb[0] === prev ? nb[1] : nb[0];
      if (used.has(key(cur, nx))) break;
      used.add(key(cur, nx));
      prev = cur; cur = nx;
    }
    return cells;
  };
  const nodes = [...adj.keys()].sort((a, b) => a - b);
  for (const n of nodes) {
    const nb = adj.get(n)!;
    if (nb.length === 2) continue;
    for (const m of nb) if (!used.has(key(n, m))) chains.push(curve(grid, road, walk(n, m), radius, step));
  }
  // loops with no junction
  for (const n of nodes) {
    const nb = adj.get(n)!;
    for (const m of nb) if (!used.has(key(n, m))) chains.push(curve(grid, road, walk(n, m), radius, step));
  }
  return chains;
}

/** centripetal Catmull-Rom through the chain's cell centres, sampled every `step` metres */
function curve(grid: IcoGrid, road: ArrayLike<number>, cells: number[], radius: number, step: number): RoadChain {
  const P = grid.pos;
  const loop = cells.length > 2 && cells[0] === cells[cells.length - 1];
  const n = cells.length;
  const pt = (i: number): [number, number, number] => {
    let j = i;
    if (loop) j = ((i % (n - 1)) + (n - 1)) % (n - 1);
    else j = Math.max(0, Math.min(n - 1, i));
    const c = cells[j];
    if (!loop && (i < 0 || i > n - 1)) {
      // extrapolate the ends (mirror the neighbour) so the curve leaves a dead end straight
      const a = cells[i < 0 ? 0 : n - 1], b = cells[i < 0 ? Math.min(1, n - 1) : Math.max(0, n - 2)];
      return [2 * P[a * 3] - P[b * 3], 2 * P[a * 3 + 1] - P[b * 3 + 1], 2 * P[a * 3 + 2] - P[b * 3 + 2]];
    }
    return [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  };
  const pts: number[] = [];
  const wear: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) * radius;
    const k = Math.max(2, Math.ceil(segLen / step));
    const w1 = road[cells[i]], w2 = road[cells[Math.min(n - 1, i + 1)]];
    // centripetal parameterisation (α = 0.5): no cusps or overshoot at the uneven cell spacing
    const d01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), 0.5) || 1e-6;
    const d12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]), 0.5) || 1e-6;
    const d23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1], p3[2] - p2[2]), 0.5) || 1e-6;
    const t0 = 0, t1 = d01, t2 = t1 + d12, t3 = t2 + d23;
    for (let s = 0; s < k; s++) {
      const t = t1 + ((t2 - t1) * s) / k;
      const out: number[] = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const A1 = ((t1 - t) * p0[a] + (t - t0) * p1[a]) / (t1 - t0);
        const A2 = ((t2 - t) * p1[a] + (t - t1) * p2[a]) / (t2 - t1);
        const A3 = ((t3 - t) * p2[a] + (t - t2) * p3[a]) / (t3 - t2);
        const B1 = ((t2 - t) * A1 + (t - t0) * A2) / (t2 - t0);
        const B2 = ((t3 - t) * A2 + (t - t1) * A3) / (t3 - t1);
        out[a] = ((t2 - t) * B1 + (t - t1) * B2) / (t2 - t1);
      }
      const l = Math.hypot(out[0], out[1], out[2]) || 1;
      pts.push(out[0] / l, out[1] / l, out[2] / l);
      const f = s / k;
      wear.push(w1 + (w2 - w1) * f);
    }
  }
  const last = loop ? pt(0) : pt(n - 1);
  const l = Math.hypot(last[0], last[1], last[2]) || 1;
  pts.push(last[0] / l, last[1] / l, last[2] / l);
  wear.push(road[cells[n - 1]]);
  return { cells, pts, wear, loop };
}

/** the whole pipeline over the cells of interest */
export function extractRoads(grid: IcoGrid, road: ArrayLike<number>, cells: number[], radius: number, threshold = 0.6, step = 2): RoadChain[] {
  return roadChains(grid, road, roadEdges(grid, road, cells, threshold), radius, step);
}

/** road width (m) for a wear value: a footpath at the threshold, a broad street when fully worn */
export function roadWidth(wear: number): number {
  return 1.6 + Math.max(0, Math.min(1, (wear - 0.55) / 0.4)) * 4.4;
}
