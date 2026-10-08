// GENESIS — per-grid geometry for the field solvers: edge lengths, dual-cell edge widths and tangent directions.
//
// The finite-volume solvers (water pipes, lava, talus, sand, fire spread) exchange quantities across the edges of the
// cell graph. Each directed edge e = (c -> nbr[e]) gets:
//   len[e]   great-circle angle between the two cell centres (× radius = metres)
//   width[e] length of the shared dual-cell boundary (the segment joining the centroids of the two triangles that
//            share the edge), as an angle (× radius = metres). Flux across an edge scales with this width.
//   tx/ty/tz unit tangent at c pointing toward the neighbour (for wind alignment and the flow-velocity field)
// Plus a per-cell tangent basis (east, north). Pure function of n, cached like the grid itself.

import { getGrid, type IcoGrid } from './icogrid.ts';

export interface GridGeo {
  grid: IcoGrid;
  len: Float32Array;
  width: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  tz: Float32Array;
  /** 3 per cell: local east unit vector */
  east: Float32Array;
  /** 3 per cell: local north unit vector */
  north: Float32Array;
}

function build(g: IcoGrid): GridGeo {
  const E = g.nbr.length;
  const P = g.pos;
  const len = new Float32Array(E);
  const width = new Float32Array(E);
  const tx = new Float32Array(E);
  const ty = new Float32Array(E);
  const tz = new Float32Array(E);
  const east = new Float32Array(g.count * 3);
  const north = new Float32Array(g.count * 3);
  const cen = (a: number, b: number, c: number, out: number[]) => {
    let x = P[a * 3] + P[b * 3] + P[c * 3];
    let y = P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1];
    let z = P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2];
    const l = Math.hypot(x, y, z);
    x /= l; y /= l; z /= l;
    out[0] = x; out[1] = y; out[2] = z;
  };
  const c1 = [0, 0, 0];
  const c2 = [0, 0, 0];
  for (let c = 0; c < g.count; c++) {
    const px = P[c * 3], py = P[c * 3 + 1], pz = P[c * 3 + 2];
    // tangent basis: east = Y x p (normalised), north = p x east; poles fall back to +X
    let ex = pz, ey = 0, ez = -px;
    let el = Math.hypot(ex, ez);
    if (el < 1e-9) { ex = 1; ey = 0; ez = 0; el = 1; }
    ex /= el; ey /= el; ez /= el;
    east[c * 3] = ex; east[c * 3 + 1] = ey; east[c * 3 + 2] = ez;
    north[c * 3] = py * ez - pz * ey;
    north[c * 3 + 1] = pz * ex - px * ez;
    north[c * 3 + 2] = px * ey - py * ex;
    const s = g.nbrStart[c], t = g.nbrStart[c + 1];
    const deg = t - s;
    for (let k = 0; k < deg; k++) {
      const e = s + k;
      const o = g.nbr[e];
      const d = px * P[o * 3] + py * P[o * 3 + 1] + pz * P[o * 3 + 2];
      len[e] = Math.acos(Math.max(-1, Math.min(1, d)));
      let dx = P[o * 3] - px * d, dy = P[o * 3 + 1] - py * d, dz = P[o * 3 + 2] - pz * d;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      tx[e] = dx; ty[e] = dy; tz[e] = dz;
      const prev = g.nbr[s + ((k + deg - 1) % deg)];
      const next = g.nbr[s + ((k + 1) % deg)];
      cen(c, prev, o, c1);
      cen(c, o, next, c2);
      const cd = c1[0] * c2[0] + c1[1] * c2[1] + c1[2] * c2[2];
      width[e] = Math.acos(Math.max(-1, Math.min(1, cd)));
    }
  }
  return { grid: g, len, width, tx, ty, tz, east, north };
}

const cache = new Map<number, GridGeo>();

export function getGeo(n: number): GridGeo {
  let g = cache.get(n);
  if (!g) {
    g = build(getGrid(n));
    cache.set(n, g);
  }
  return g;
}

/** the outgoing edge of cell c best aligned with tangent vector (vx, vy, vz); -1 if the vector is ~zero */
export function edgeToward(geo: GridGeo, c: number, vx: number, vy: number, vz: number): number {
  const g = geo.grid;
  let best = -1;
  let bestD = 1e-9;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
    const d = geo.tx[e] * vx + geo.ty[e] * vy + geo.tz[e] * vz;
    if (d > bestD) { bestD = d; best = e; }
  }
  return best;
}
