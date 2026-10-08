// GENESIS — the planet grid: a geodesic icosphere graph with O(1) point location.
//
// Every planet's simulated fields live on the VERTICES of an icosphere of frequency n (each of the 20 icosahedron faces
// is cut into n*n triangles; vertices are radially projected onto the unit sphere). Vertices are the sim "cells":
//
//   cells      = 10 n^2 + 2      (12 have 5 neighbours, the rest 6)
//   triangles  = 20 n^2
//
// Point location is exact and O(1)-ish: radially projecting a unit vector onto the flat icosahedron face that contains
// it lands on the flat (pre-normalisation) subdivision grid, so the sub-triangle and its PLANAR barycentric weights
// fall out of two divisions. The render mesh uses the same rule (render vertices are points of a finer flat grid on the
// same faces), so terrain shaders and CPU-side `sample()` agree on which three cells, with which weights, define any
// point. See CONTRACT.md §4.
//
// Frame: unit vectors in the planet BODY frame, +Y = north pole.
//
// All arrays are typed and built deterministically from n alone, so the sim worker and the main thread build
// identical grids without transferring them.

import type { V3 } from '../core/vec3.ts';

const PHI = (1 + Math.sqrt(5)) / 2;

/** Base icosahedron (unit vectors) — 12 corners, 20 CCW faces (outward normals). */
function baseIcosahedron(): { verts: number[][]; faces: number[][] } {
  const raw = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ];
  const verts = raw.map((v) => {
    const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { verts, faces };
}

/** Result of locating a point: the three cells of its sim triangle and planar barycentric weights (sum to 1). */
export interface GridHit {
  face: number;
  tri: number;
  a: number;
  b: number;
  c: number;
  wa: number;
  wb: number;
  wc: number;
}

export function newHit(): GridHit {
  return { face: 0, tri: 0, a: 0, b: 0, c: 0, wa: 1, wb: 0, wc: 0 };
}

export class IcoGrid {
  readonly n: number;
  readonly count: number;
  readonly triCount: number;
  /** unit vectors, 3 per cell (body frame) */
  readonly pos: Float64Array;
  /** CSR adjacency: neighbours of cell c are nbr[nbrStart[c] .. nbrStart[c+1]-1], sorted CCW around the cell normal */
  readonly nbrStart: Int32Array;
  readonly nbr: Int32Array;
  /** for directed edge e = (c -> nbr[e]), rev[e] is the directed edge (nbr[e] -> c) */
  readonly rev: Int32Array;
  /** triangles: 3 cell ids each (CCW, outward) */
  readonly tris: Int32Array;
  /** dual (barycentric) area of each cell on the UNIT sphere (sum = 4 pi) */
  readonly area: Float32Array;
  /** latitude (radians) per cell */
  readonly lat: Float32Array;
  /** mean great-circle angle between neighbouring cells (radians on the unit sphere) */
  readonly meanEdgeAngle: number;
  /** base-face corner unit vectors, 9 numbers per face (A, B, C) */
  readonly faceCorners: Float64Array;
  /** base-face (unnormalised) plane normals, 3 per face */
  readonly faceNormals: Float64Array;
  /** cell index of flat-grid point (face, i, j): faceGrid[face * gridStride + j * (n + 1) + i] */
  readonly faceGrid: Int32Array;
  readonly gridStride: number;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > 256) throw new Error(`IcoGrid: bad frequency ${n}`);
    this.n = n;
    const { verts, faces } = baseIcosahedron();
    const count = 10 * n * n + 2;
    this.count = count;
    this.triCount = 20 * n * n;
    const pos = new Float64Array(count * 3);
    let next = 0;
    const put = (x: number, y: number, z: number): number => {
      const l = Math.sqrt(x * x + y * y + z * z);
      pos[next * 3] = x / l;
      pos[next * 3 + 1] = y / l;
      pos[next * 3 + 2] = z / l;
      return next++;
    };
    // corners
    for (let i = 0; i < 12; i++) put(verts[i][0], verts[i][1], verts[i][2]);
    // edges: canonical (lo, hi) with n-1 interior points ordered lo -> hi
    const edgeMap = new Map<number, number>(); // key lo*12+hi -> first index
    const edgeKey = (u: number, v: number) => (u < v ? u * 12 + v : v * 12 + u);
    for (const f of faces) {
      for (let e = 0; e < 3; e++) {
        const u = f[e];
        const v = f[(e + 1) % 3];
        const k = edgeKey(u, v);
        if (edgeMap.has(k)) continue;
        const lo = Math.min(u, v);
        const hi = Math.max(u, v);
        edgeMap.set(k, next);
        for (let t = 1; t < n; t++) {
          const s = t / n;
          put(
            verts[lo][0] * (1 - s) + verts[hi][0] * s,
            verts[lo][1] * (1 - s) + verts[hi][1] * s,
            verts[lo][2] * (1 - s) + verts[hi][2] * s,
          );
        }
      }
    }
    const edgePoint = (u: number, v: number, t: number): number => {
      // t in 1..n-1 counted from u
      const base = edgeMap.get(edgeKey(u, v))!;
      return u < v ? base + (t - 1) : base + (n - t - 1);
    };
    // face grids
    const stride = (n + 1) * (n + 1);
    this.gridStride = stride;
    const faceGrid = new Int32Array(20 * stride).fill(-1);
    const faceCorners = new Float64Array(20 * 9);
    const faceNormals = new Float64Array(20 * 3);
    for (let fi = 0; fi < 20; fi++) {
      const [A, B, C] = faces[fi];
      const a = verts[A];
      const b = verts[B];
      const c = verts[C];
      for (let k = 0; k < 3; k++) {
        faceCorners[fi * 9 + k] = a[k];
        faceCorners[fi * 9 + 3 + k] = b[k];
        faceCorners[fi * 9 + 6 + k] = c[k];
      }
      // normal = (b-a) x (c-a)
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      faceNormals[fi * 3] = e1[1] * e2[2] - e1[2] * e2[1];
      faceNormals[fi * 3 + 1] = e1[2] * e2[0] - e1[0] * e2[2];
      faceNormals[fi * 3 + 2] = e1[0] * e2[1] - e1[1] * e2[0];
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i + j <= n; i++) {
          const k = n - i - j;
          let id: number;
          if (i === 0 && j === 0) id = A;
          else if (i === n) id = B;
          else if (j === n) id = C;
          else if (j === 0) id = edgePoint(A, B, i);
          else if (i === 0) id = edgePoint(A, C, j);
          else if (k === 0) id = edgePoint(B, C, j);
          else {
            id = put(
              (a[0] * k + b[0] * i + c[0] * j) / n,
              (a[1] * k + b[1] * i + c[1] * j) / n,
              (a[2] * k + b[2] * i + c[2] * j) / n,
            );
          }
          faceGrid[fi * stride + j * (n + 1) + i] = id;
        }
      }
    }
    if (next !== count) throw new Error(`IcoGrid: built ${next} cells, expected ${count}`);
    this.pos = pos;
    this.faceGrid = faceGrid;
    this.faceCorners = faceCorners;
    this.faceNormals = faceNormals;

    // triangles
    const tris = new Int32Array(this.triCount * 3);
    let t = 0;
    const g = (fi: number, i: number, j: number) => faceGrid[fi * stride + j * (n + 1) + i];
    for (let fi = 0; fi < 20; fi++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i + j < n; i++) {
          tris[t++] = g(fi, i, j);
          tris[t++] = g(fi, i + 1, j);
          tris[t++] = g(fi, i, j + 1);
          if (i + j < n - 1) {
            tris[t++] = g(fi, i + 1, j);
            tris[t++] = g(fi, i + 1, j + 1);
            tris[t++] = g(fi, i, j + 1);
          }
        }
      }
    }
    this.tris = tris;

    // adjacency from triangles
    const sets: number[][] = new Array(count);
    for (let c = 0; c < count; c++) sets[c] = [];
    const area = new Float32Array(count);
    for (let k = 0; k < this.triCount; k++) {
      const a = tris[k * 3];
      const b = tris[k * 3 + 1];
      const c = tris[k * 3 + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a], [b, a], [c, b], [a, c]]) {
        if (!sets[u].includes(v)) sets[u].push(v);
      }
      const ta = sphTriArea(pos, a, b, c);
      area[a] += ta / 3;
      area[b] += ta / 3;
      area[c] += ta / 3;
    }
    this.area = area;
    // sort neighbours CCW around the cell normal
    const nbrStart = new Int32Array(count + 1);
    let total = 0;
    for (let c = 0; c < count; c++) {
      nbrStart[c] = total;
      total += sets[c].length;
    }
    nbrStart[count] = total;
    const nbr = new Int32Array(total);
    let edgeAngleSum = 0;
    for (let c = 0; c < count; c++) {
      const px = pos[c * 3], py = pos[c * 3 + 1], pz = pos[c * 3 + 2];
      // tangent basis
      let ex = pz, ez = -px;
      let el = Math.sqrt(ex * ex + ez * ez);
      let ey = 0;
      if (el < 1e-9) { ex = 1; ey = 0; ez = 0; el = 1; }
      ex /= el; ey /= el; ez /= el;
      const nx = py * ez - pz * ey;
      const ny = pz * ex - px * ez;
      const nz = px * ey - py * ex;
      const list = sets[c].map((o) => {
        const dx = pos[o * 3] - px, dy = pos[o * 3 + 1] - py, dz = pos[o * 3 + 2] - pz;
        return { o, ang: Math.atan2(dx * nx + dy * ny + dz * nz, dx * ex + dy * ey + dz * ez) };
      });
      list.sort((u, v) => u.ang - v.ang || u.o - v.o);
      for (let k = 0; k < list.length; k++) {
        const o = list[k].o;
        nbr[nbrStart[c] + k] = o;
        const d = px * pos[o * 3] + py * pos[o * 3 + 1] + pz * pos[o * 3 + 2];
        edgeAngleSum += Math.acos(Math.max(-1, Math.min(1, d)));
      }
    }
    this.nbrStart = nbrStart;
    this.nbr = nbr;
    this.meanEdgeAngle = edgeAngleSum / total;
    const rev = new Int32Array(total);
    for (let c = 0; c < count; c++) {
      for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
        const o = nbr[e];
        let r = -1;
        for (let f = nbrStart[o]; f < nbrStart[o + 1]; f++) if (nbr[f] === c) { r = f; break; }
        rev[e] = r;
      }
    }
    this.rev = rev;
    const lat = new Float32Array(count);
    for (let c = 0; c < count; c++) lat[c] = Math.asin(Math.max(-1, Math.min(1, pos[c * 3 + 1])));
    this.lat = lat;
  }

  /** number of neighbours of cell c (5 or 6) */
  degree(c: number): number {
    return this.nbrStart[c + 1] - this.nbrStart[c];
  }

  /** copy cell c's unit vector into out */
  cellPos(out: V3, c: number): V3 {
    out[0] = this.pos[c * 3];
    out[1] = this.pos[c * 3 + 1];
    out[2] = this.pos[c * 3 + 2];
    return out;
  }

  /** which base face contains unit vector p (by radial projection) */
  faceOf(px: number, py: number, pz: number): number {
    let best = 0;
    let bestScore = -Infinity;
    const fc = this.faceCorners;
    for (let f = 0; f < 20; f++) {
      // centroid direction score: the containing face maximises the minimum barycentric; cheap proxy = dot with centroid
      const cx = fc[f * 9] + fc[f * 9 + 3] + fc[f * 9 + 6];
      const cy = fc[f * 9 + 1] + fc[f * 9 + 4] + fc[f * 9 + 7];
      const cz = fc[f * 9 + 2] + fc[f * 9 + 5] + fc[f * 9 + 8];
      const s = px * cx + py * cy + pz * cz;
      if (s > bestScore) {
        bestScore = s;
        best = f;
      }
    }
    // verify (the centroid proxy can pick a neighbour face near edges); fall back to an exact barycentric test
    if (this.faceBary(best, px, py, pz, _bary) && _bary[0] >= -1e-9 && _bary[1] >= -1e-9 && _bary[2] >= -1e-9) return best;
    let bestF = best;
    let bestMin = -Infinity;
    for (let f = 0; f < 20; f++) {
      if (!this.faceBary(f, px, py, pz, _bary)) continue;
      const m = Math.min(_bary[0], _bary[1], _bary[2]);
      if (m > bestMin) {
        bestMin = m;
        bestF = f;
      }
    }
    return bestF;
  }

  /** planar barycentrics (wA, wB, wC) of p radially projected onto face f's plane; false if p faces away */
  faceBary(f: number, px: number, py: number, pz: number, out: Float64Array | number[]): boolean {
    const fc = this.faceCorners;
    const nx = this.faceNormals[f * 3], ny = this.faceNormals[f * 3 + 1], nz = this.faceNormals[f * 3 + 2];
    const ax = fc[f * 9], ay = fc[f * 9 + 1], az = fc[f * 9 + 2];
    const den = px * nx + py * ny + pz * nz;
    if (den <= 1e-12) return false;
    const s = (ax * nx + ay * ny + az * nz) / den;
    const qx = px * s, qy = py * s, qz = pz * s;
    const bx = fc[f * 9 + 3], by = fc[f * 9 + 4], bz = fc[f * 9 + 5];
    const cx = fc[f * 9 + 6], cy = fc[f * 9 + 7], cz = fc[f * 9 + 8];
    // barycentric via areas relative to the normal
    const nn = nx * nx + ny * ny + nz * nz;
    // wB = ((C-A) x (Q-A)) . N / nn ... use standard formula
    const v0x = bx - ax, v0y = by - ay, v0z = bz - az;
    const v1x = cx - ax, v1y = cy - ay, v1z = cz - az;
    const v2x = qx - ax, v2y = qy - ay, v2z = qz - az;
    // wB = ((Q-A) x (C-A)) . N / (B-A)x(C-A).N  ; wC = ((B-A) x (Q-A)) . N / nn
    const wb = ((v2y * v1z - v2z * v1y) * nx + (v2z * v1x - v2x * v1z) * ny + (v2x * v1y - v2y * v1x) * nz) / nn;
    const wc = ((v0y * v2z - v0z * v2y) * nx + (v0z * v2x - v0x * v2z) * ny + (v0x * v2y - v0y * v2x) * nz) / nn;
    out[0] = 1 - wb - wc;
    out[1] = wb;
    out[2] = wc;
    return true;
  }

  /**
   * Locate the sim triangle containing unit vector p, with planar barycentric weights.
   * Allocation-free when `out` is reused.
   */
  locate(px: number, py: number, pz: number, out: GridHit = newHit()): GridHit {
    const f = this.faceOf(px, py, pz);
    this.faceBary(f, px, py, pz, _bary);
    return this.locateFaceCoords(f, _bary[1] * this.n, _bary[2] * this.n, out);
  }

  /**
   * Locate by flat face coordinates: (fi, fj) in [0, n] with fi + fj <= n on face f (fi along A->B, fj along A->C).
   * The renderer calls this for every render vertex of a finer grid on the same face (CONTRACT.md §4.2).
   */
  locateFaceCoords(f: number, fi: number, fj: number, out: GridHit = newHit()): GridHit {
    const n = this.n;
    if (fi < 0) fi = 0;
    if (fj < 0) fj = 0;
    if (fi + fj > n) {
      const s = n / (fi + fj);
      fi *= s;
      fj *= s;
    }
    let i0 = Math.floor(fi);
    let j0 = Math.floor(fj);
    if (i0 >= n) i0 = n - 1;
    if (j0 >= n) j0 = n - 1;
    if (i0 + j0 > n - 1) {
      // on the far edge: step back into the last lower triangle
      if (i0 > 0 && fi - i0 < fj - j0) i0 = n - 1 - j0;
      else j0 = n - 1 - i0;
      if (i0 < 0) i0 = 0;
      if (j0 < 0) j0 = 0;
    }
    const u = fi - i0;
    const v = fj - j0;
    const st = this.gridStride;
    const g = this.faceGrid;
    const row = n + 1;
    const base = f * st;
    // triangle index within face: lower/upper triangles enumerated as in the constructor
    if (u + v <= 1 || i0 + j0 >= n - 1) {
      out.a = g[base + j0 * row + i0];
      out.b = g[base + j0 * row + i0 + 1];
      out.c = g[base + (j0 + 1) * row + i0];
      let wa = 1 - u - v, wb = u, wc = v;
      if (wa < 0) { // clamp (only possible on the outer edge after the step-back above)
        const s = wb + wc;
        wb /= s; wc /= s; wa = 0;
      }
      out.wa = wa; out.wb = wb; out.wc = wc;
      out.tri = f * n * n + triIndexInFace(n, i0, j0, false);
    } else {
      out.a = g[base + (j0 + 1) * row + i0 + 1];
      out.b = g[base + (j0 + 1) * row + i0];
      out.c = g[base + j0 * row + i0 + 1];
      out.wa = u + v - 1;
      out.wb = 1 - u;
      out.wc = 1 - v;
      out.tri = f * n * n + triIndexInFace(n, i0, j0, true);
    }
    out.face = f;
    return out;
  }

  /** the cell nearest to unit vector p (exact: locate, then hill-climb on dot product) */
  nearestCell(px: number, py: number, pz: number): number {
    const h = this.locate(px, py, pz, _hit);
    let c = h.wa >= h.wb && h.wa >= h.wc ? h.a : h.wb >= h.wc ? h.b : h.c;
    const pos = this.pos;
    for (let iter = 0; iter < 8; iter++) {
      let best = c;
      let bestD = px * pos[c * 3] + py * pos[c * 3 + 1] + pz * pos[c * 3 + 2];
      for (let e = this.nbrStart[c]; e < this.nbrStart[c + 1]; e++) {
        const o = this.nbr[e];
        const d = px * pos[o * 3] + py * pos[o * 3 + 1] + pz * pos[o * 3 + 2];
        if (d > bestD) { bestD = d; best = o; }
      }
      if (best === c) break;
      c = best;
    }
    return c;
  }

  /** barycentric interpolation of a per-cell field at unit vector p */
  sample(field: ArrayLike<number>, px: number, py: number, pz: number): number {
    const h = this.locate(px, py, pz, _hit);
    return field[h.a] * h.wa + field[h.b] * h.wb + field[h.c] * h.wc;
  }

  /**
   * Cells whose centre lies within `angle` radians of unit vector p (BFS from the nearest cell).
   * Appends to `out` (cleared first) and returns it. Deterministic order (BFS by neighbour order).
   */
  cellsWithin(px: number, py: number, pz: number, angle: number, out: number[] = []): number[] {
    out.length = 0;
    const cosA = Math.cos(angle);
    const start = this.nearestCell(px, py, pz);
    const stamp = ++this._stamp;
    if (this._mark.length !== this.count) this._mark = new Uint32Array(this.count);
    const mark = this._mark;
    const pos = this.pos;
    const queue = this._queue;
    queue.length = 0;
    queue.push(start);
    mark[start] = stamp;
    let qi = 0;
    while (qi < queue.length) {
      const c = queue[qi++];
      const d = px * pos[c * 3] + py * pos[c * 3 + 1] + pz * pos[c * 3 + 2];
      if (d < cosA && c !== start) continue;
      out.push(c);
      for (let e = this.nbrStart[c]; e < this.nbrStart[c + 1]; e++) {
        const o = this.nbr[e];
        if (mark[o] === stamp) continue;
        mark[o] = stamp;
        queue.push(o);
      }
    }
    return out;
  }

  private _stamp = 0;
  private _mark = new Uint32Array(0);
  private _queue: number[] = [];
}

function triIndexInFace(n: number, i: number, j: number, upper: boolean): number {
  // constructor order: for j, for i (i + j < n): lower, then upper if i + j < n - 1
  // count of triangles in rows before j: sum_{r<j} (2(n-r) - 1) = j(2n - j)
  let idx = j * (2 * n - j);
  idx += 2 * i; // each earlier i in this row contributed lower + upper (all i < current have i + j < n - 1 except maybe last)
  if (upper) idx += 1;
  return idx;
}

function sphTriArea(pos: Float64Array, a: number, b: number, c: number): number {
  // spherical excess via l'Huilier-free formula: tan(E/2) = |a.(b x c)| / (1 + a.b + b.c + c.a)
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const triple = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  const den = 1 + (ax * bx + ay * by + az * bz) + (bx * cx + by * cy + bz * cz) + (cx * ax + cy * ay + cz * az);
  return 2 * Math.atan2(Math.abs(triple), den);
}

const _bary = new Float64Array(3);
const _hit = newHit();

/** Grid cache: one IcoGrid per frequency (they are pure functions of n). */
const cache = new Map<number, IcoGrid>();
export function getGrid(n: number): IcoGrid {
  let g = cache.get(n);
  if (!g) {
    g = new IcoGrid(n);
    cache.set(n, g);
  }
  return g;
}
