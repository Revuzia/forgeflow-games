// GENESIS — SIM perf: cells of a spherical cap, into typed arrays.
//
// The same set, in the same order, as IcoGrid.cellsWithin (BFS from the nearest cell, expanding only through cells
// whose centre lies inside the cap; the start cell is always included) — but with a typed queue and visit stamps kept
// per grid, and the result written to an Int32Array. The weather overlay asks for several caps of thousands of cells
// every few ticks; the number[]-based BFS was a third of its cost.

import type { IcoGrid } from '../grid/icogrid.ts';

interface CapScratch {
  mark: Uint32Array;
  stamp: number;
  queue: Int32Array;
}

const scratchByGrid = new WeakMap<IcoGrid, CapScratch>();

function scratchOf(g: IcoGrid): CapScratch {
  let s = scratchByGrid.get(g);
  if (!s) {
    s = { mark: new Uint32Array(g.count), stamp: 0, queue: new Int32Array(g.count) };
    scratchByGrid.set(g, s);
  }
  return s;
}

/**
 * Cells whose centre lies within `angle` radians of unit vector (px, py, pz), written to `out` (length ≥ grid count);
 * returns how many. Equal to `g.cellsWithin(px, py, pz, angle)` element for element.
 */
export function capCells(g: IcoGrid, px: number, py: number, pz: number, angle: number, out: Int32Array): number {
  const s = scratchOf(g);
  const cosA = Math.cos(angle);
  const start = g.nearestCell(px, py, pz);
  s.stamp = (s.stamp + 1) >>> 0;
  if (s.stamp === 0) { s.mark.fill(0); s.stamp = 1; }
  const stamp = s.stamp;
  const mark = s.mark, queue = s.queue, pos = g.pos, nbrStart = g.nbrStart, nbr = g.nbr;
  let qh = 0, qt = 0, n = 0;
  queue[qt++] = start;
  mark[start] = stamp;
  while (qh < qt) {
    const c = queue[qh++];
    const d = px * pos[c * 3] + py * pos[c * 3 + 1] + pz * pos[c * 3 + 2];
    if (d < cosA && c !== start) continue;
    out[n++] = c;
    const e1 = nbrStart[c + 1];
    for (let e = nbrStart[c]; e < e1; e++) {
      const o = nbr[e];
      if (mark[o] === stamp) continue;
      mark[o] = stamp;
      queue[qt++] = o;
    }
  }
  return n;
}
