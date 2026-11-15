// DYEFIELD — the paint atlas: THE paint state of the game (CONTRACT §4.5, DESIGN §4).
// THREE-free, DOM-free, Node-safe. Typed arrays only: no per-texel objects anywhere.
//
// buildAtlas rasterises every paintable triangle of a map into its UV2 (TEXCOORD_1) footprint
// in one square S×S atlas and gives each covered texel ("surface texel", id 0..count−1):
//   * its world position (barycentric interpolation at the texel centre) and unit normal (the
//     triangle's geometric normal, oriented to agree with the authored vertex normals);
//   * the exact world area it stands for: triangle world area ÷ triangle UV area in texel²,
//     so Σ area over a triangle's texels ≈ its world area regardless of UV density;
//   * floor flag (ny ≥ floorMinNy) and scoring weight (floor 1, wall `wallWeight`);
//   * a stable noise byte (hash of the texel coordinates) for GPU edge detail;
//   * its team byte (0 at build).
//
// Raster rule (§4.5): texel (x, row) has centre (x+0.5, row+0.5) in texel space, where
// texel-space = (u·S, v·S) with no flips (§2). A texel belongs to a triangle when its centre lies
// inside the triangle's UV footprint. Every triangle is first normalised to positive UV area;
// a centre exactly on an edge is inside only if the edge is a "top-left" edge, defined as
// (dy > 0) || (dy == 0 && dx < 0) for the directed edge. The rule is antisymmetric, so a centre on
// an edge shared by two adjacent triangles belongs to exactly one of them. The first claim (lowest
// triangle index) wins; a texel claimed again is counted once in `overlaps`.
//
// Ids are assigned in linear (row-major) order, so id order is atlas order: dirty rows stay
// coherent and "lowest id" is "lowest linear index" (used by the gutter tie-break).
//
// Gutter: every non-surface texel within `gutter` px (Chebyshev) of a surface texel mirrors the
// NEAREST surface texel (Euclidean in texel space; ties → lowest id). srcOf holds the id each
// atlas texel shows; mirrorStart/mirrorItems (CSR, by source id, ascending linear index) list the
// gutter texels that must be re-uploaded when that id flips. Bilinear sampling therefore never
// bleeds unrelated colour across island borders.
//
// Grid: a uniform 3D grid (cell = cellSize m, default 1) over the soup AABB, CSR form:
// items[start[c] .. start[c+1]) are the ids (ascending) whose texel centre falls in cell
// c = (iz·ny + iy)·nx + ix. Splats and surface queries visit only the cells they touch.

import type { TeamId } from '../types.ts';
import { hash32 } from '../rng.ts';
import type { TriSoup } from '../mapgeo.ts';

export interface AtlasOptions { wallWeight: number; floorMinNy: number; cellSize?: number /*1.0*/; gutter?: number /*2*/ }

export interface PaintAtlas {
  size: number;               // S (square)
  count: number;              // surface texels
  idOf: Int32Array;           // S*S linear → id | -1
  lin: Int32Array;            // id → linear (row*S + x)
  srcOf: Int32Array;          // S*S linear → id whose color this texel shows (surface: itself; gutter: nearest surface id) | -1
  mirrorStart: Int32Array;    // CSR id → gutter linear indices mirroring it
  mirrorItems: Int32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;   // id → world position of texel centre
  nx: Float32Array; ny: Float32Array; nz: Float32Array;   // id → unit normal
  area: Float32Array;         // id → m² this texel represents (triangle world area / UV texel area)
  weight: Float32Array;       // id → 1 (floor/ramp: ny ≥ floorMinNy) | wallWeight
  floor: Uint8Array;          // id → 1 if ny ≥ floorMinNy
  team: Uint8Array;           // id → TeamId — THE paint state of the game
  noise: Uint8Array;          // id → stable 0..255 hash (edge noise; GPU B channel)
  grid: { cell: number; ox: number; oy: number; oz: number; nx: number; ny: number; nz: number; start: Int32Array; items: Int32Array };
  totalArea: number; totalWeighted: number;
  overlaps: number;           // texels claimed by >1 triangle (UV2 overlap; should be ~0)
}

/** Seed word of the per-texel noise byte (kept here so tools can reproduce it). */
export const TEXEL_NOISE_SEED = 0x5f3759df;

/** Largest grid we allow before growing the cell (memory guard for far-flung soups). */
const MAX_GRID_CELLS = 8_000_000;

export function buildAtlas(soup: TriSoup, size: number, opts: AtlasOptions): PaintAtlas {
  const S = size | 0;
  if (S < 4 || S > 8192 || S !== size) throw new Error(`[atlas] bad atlas size ${size}`);
  const N = S * S;
  const gutter = Math.max(0, Math.floor(opts.gutter ?? 2));
  let cell = opts.cellSize ?? 1.0;
  if (!(cell > 0)) throw new Error(`[atlas] bad cellSize ${opts.cellSize}`);
  const wallWeight = opts.wallWeight;
  const floorMinNy = opts.floorMinNy;

  const P = soup.positions, VN = soup.normals, UV = soup.uv1, IDX = soup.indices;
  const T = Math.floor(IDX.length / 3);

  // ── per-triangle prep + raster ─────────────────────────────────────────────────────────────
  const triV = new Int32Array(T * 3);        // vertex indices, permuted so UV area is positive
  const triA2 = new Float64Array(T);         // 2 × UV area in texel² (0 = skipped)
  const triTexelArea = new Float64Array(T);  // world m² per texel
  const triN = new Float32Array(T * 3);      // geometric unit normal
  const triOf = new Int32Array(N).fill(-1);
  const overlapFlag = new Uint8Array(N);
  let overlaps = 0;

  for (let t = 0; t < T; t++) {
    let ia = IDX[t * 3], ib = IDX[t * 3 + 1], ic = IDX[t * 3 + 2];
    const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2];
    const e1x = P[ib * 3] - ax, e1y = P[ib * 3 + 1] - ay, e1z = P[ib * 3 + 2] - az;
    const e2x = P[ic * 3] - ax, e2y = P[ic * 3 + 1] - ay, e2z = P[ic * 3 + 2] - az;
    let cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    const clen = Math.hypot(cx, cy, cz);
    if (!(clen > 1e-12)) continue; // zero world area
    cx /= clen; cy /= clen; cz /= clen;
    const sx = VN[ia * 3] + VN[ib * 3] + VN[ic * 3];
    const sy = VN[ia * 3 + 1] + VN[ib * 3 + 1] + VN[ic * 3 + 1];
    const sz = VN[ia * 3 + 2] + VN[ib * 3 + 2] + VN[ic * 3 + 2];
    if (cx * sx + cy * sy + cz * sz < 0) { cx = -cx; cy = -cy; cz = -cz; }

    let ua = UV[ia * 2] * S, va = UV[ia * 2 + 1] * S;
    let ub = UV[ib * 2] * S, vb = UV[ib * 2 + 1] * S;
    let uc = UV[ic * 2] * S, vc = UV[ic * 2 + 1] * S;
    let a2 = (ub - ua) * (vc - va) - (vb - va) * (uc - ua);
    if (!(Math.abs(a2) > 1e-9)) continue; // zero UV area: nothing to rasterise
    if (a2 < 0) {
      let tmp = ib; ib = ic; ic = tmp;
      tmp = ub; ub = uc; uc = tmp;
      tmp = vb; vb = vc; vc = tmp;
      a2 = -a2;
    }
    triV[t * 3] = ia; triV[t * 3 + 1] = ib; triV[t * 3 + 2] = ic;
    triA2[t] = a2;
    triTexelArea[t] = (0.5 * clen) / (0.5 * a2);
    triN[t * 3] = cx; triN[t * 3 + 1] = cy; triN[t * 3 + 2] = cz;

    // bounding box of texel centres inside [min, max]
    const minU = Math.min(ua, ub, uc), maxU = Math.max(ua, ub, uc);
    const minV = Math.min(va, vb, vc), maxV = Math.max(va, vb, vc);
    const x0 = Math.max(0, Math.ceil(minU - 0.5)), x1 = Math.min(S - 1, Math.floor(maxU - 0.5));
    const y0 = Math.max(0, Math.ceil(minV - 0.5)), y1 = Math.min(S - 1, Math.floor(maxV - 0.5));
    if (x0 > x1 || y0 > y1) continue;

    // directed edges: E0 = b→c (weight of a), E1 = c→a (weight of b), E2 = a→b (weight of c)
    const d0x = uc - ub, d0y = vc - vb;
    const d1x = ua - uc, d1y = va - vc;
    const d2x = ub - ua, d2y = vb - va;
    const tl0 = d0y > 0 || (d0y === 0 && d0x < 0);
    const tl1 = d1y > 0 || (d1y === 0 && d1x < 0);
    const tl2 = d2y > 0 || (d2y === 0 && d2x < 0);

    for (let row = y0; row <= y1; row++) {
      const pyc = row + 0.5;
      const k0 = d0x * (pyc - vb), k1 = d1x * (pyc - vc), k2 = d2x * (pyc - va);
      const rowBase = row * S;
      for (let x = x0; x <= x1; x++) {
        const pxc = x + 0.5;
        const w0 = k0 - d0y * (pxc - ub);
        if (w0 < 0 || (w0 === 0 && !tl0)) continue;
        const w1 = k1 - d1y * (pxc - uc);
        if (w1 < 0 || (w1 === 0 && !tl1)) continue;
        const w2 = k2 - d2y * (pxc - ua);
        if (w2 < 0 || (w2 === 0 && !tl2)) continue;
        const l = rowBase + x;
        if (triOf[l] < 0) triOf[l] = t;
        else if (overlapFlag[l] === 0) { overlapFlag[l] = 1; overlaps++; }
      }
    }
  }

  // ── ids in linear order ─────────────────────────────────────────────────────────────────────
  let count = 0;
  for (let l = 0; l < N; l++) if (triOf[l] >= 0) count++;
  const idOf = new Int32Array(N).fill(-1);
  const lin = new Int32Array(count);
  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  const nx = new Float32Array(count), ny = new Float32Array(count), nz = new Float32Array(count);
  const area = new Float32Array(count);
  const weight = new Float32Array(count);
  const floor = new Uint8Array(count);
  const noise = new Uint8Array(count);
  const team = new Uint8Array(count);
  let totalArea = 0, totalWeighted = 0;

  let id = 0;
  for (let l = 0; l < N; l++) {
    const t = triOf[l];
    if (t < 0) continue;
    idOf[l] = id;
    lin[id] = l;
    const row = (l / S) | 0;
    const x = l - row * S;
    const pxc = x + 0.5, pyc = row + 0.5;
    const ia = triV[t * 3], ib = triV[t * 3 + 1], ic = triV[t * 3 + 2];
    const ua = UV[ia * 2] * S, va = UV[ia * 2 + 1] * S;
    const ub = UV[ib * 2] * S, vb = UV[ib * 2 + 1] * S;
    const uc = UV[ic * 2] * S, vc = UV[ic * 2 + 1] * S;
    const inv = 1 / triA2[t];
    const la = ((uc - ub) * (pyc - vb) - (vc - vb) * (pxc - ub)) * inv;
    const lb = ((ua - uc) * (pyc - vc) - (va - vc) * (pxc - uc)) * inv;
    const lc = 1 - la - lb;
    px[id] = la * P[ia * 3] + lb * P[ib * 3] + lc * P[ic * 3];
    py[id] = la * P[ia * 3 + 1] + lb * P[ib * 3 + 1] + lc * P[ic * 3 + 1];
    pz[id] = la * P[ia * 3 + 2] + lb * P[ib * 3 + 2] + lc * P[ic * 3 + 2];
    const fny = triN[t * 3 + 1];
    nx[id] = triN[t * 3]; ny[id] = fny; nz[id] = triN[t * 3 + 2];
    const a = triTexelArea[t];
    area[id] = a;
    const isFloor = fny >= floorMinNy;
    floor[id] = isFloor ? 1 : 0;
    const w = isFloor ? 1 : wallWeight;
    weight[id] = w;
    noise[id] = hash32(x, row, TEXEL_NOISE_SEED) & 255;
    // totals from the stored Float32 values so a recount over the arrays matches exactly
    totalArea += area[id];
    totalWeighted += area[id] * weight[id];
    id++;
  }

  // ── gutter mirrors ─────────────────────────────────────────────────────────────────────────
  const srcOf = new Int32Array(N).fill(-1);
  for (let i = 0; i < count; i++) srcOf[lin[i]] = i;
  const offs: Array<[number, number, number]> = [];
  for (let dy = -gutter; dy <= gutter; dy++) {
    for (let dx = -gutter; dx <= gutter; dx++) {
      if (dx !== 0 || dy !== 0) offs.push([dx * dx + dy * dy, dy, dx]);
    }
  }
  // nearest first; equal distance → lowest linear index (= lowest id, ids are in linear order)
  offs.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]) || (p[2] - q[2]));
  const offDx = Int32Array.from(offs, (o) => o[2]);
  const offDy = Int32Array.from(offs, (o) => o[1]);
  const offCount = offs.length;
  // per-row surface x-extent, widened over ±gutter rows, lets empty atlas space skip the search
  const rowMin = new Int32Array(S).fill(S), rowMax = new Int32Array(S).fill(-1);
  for (let i = 0; i < count; i++) {
    const l = lin[i], r = (l / S) | 0, x = l - r * S;
    if (x < rowMin[r]) rowMin[r] = x;
    if (x > rowMax[r]) rowMax[r] = x;
  }
  let gutterCount = 0;
  if (gutter > 0 && count > 0) {
    for (let row = 0; row < S; row++) {
      let bMin = S, bMax = -1;
      for (let r = Math.max(0, row - gutter); r <= Math.min(S - 1, row + gutter); r++) {
        if (rowMin[r] < bMin) bMin = rowMin[r];
        if (rowMax[r] > bMax) bMax = rowMax[r];
      }
      if (bMax < 0) continue;
      const xs = Math.max(0, bMin - gutter), xe = Math.min(S - 1, bMax + gutter);
      const rowBase = row * S;
      for (let x = xs; x <= xe; x++) {
        const l = rowBase + x;
        if (idOf[l] >= 0) continue;
        for (let k = 0; k < offCount; k++) {
          const qx = x + offDx[k], qy = row + offDy[k];
          if (qx < 0 || qx >= S || qy < 0 || qy >= S) continue;
          const j = idOf[qy * S + qx];
          if (j >= 0) { srcOf[l] = j; gutterCount++; break; }
        }
      }
    }
  }
  const mirrorStart = new Int32Array(count + 1);
  if (gutterCount > 0) {
    for (let l = 0; l < N; l++) {
      if (idOf[l] < 0 && srcOf[l] >= 0) mirrorStart[srcOf[l] + 1]++;
    }
  }
  for (let i = 0; i < count; i++) mirrorStart[i + 1] += mirrorStart[i];
  const mirrorItems = new Int32Array(gutterCount);
  if (gutterCount > 0) {
    const cursor = mirrorStart.slice(0, count);
    for (let l = 0; l < N; l++) {
      if (idOf[l] < 0 && srcOf[l] >= 0) mirrorItems[cursor[srcOf[l]]++] = l;
    }
  }

  // ── spatial grid (CSR) over the soup AABB ──────────────────────────────────────────────────
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < IDX.length; k++) {
    const v = IDX[k] * 3;
    const x = P[v], y = P[v + 1], z = P[v + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!(minX <= maxX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
  const ox = minX - 1e-3, oy = minY - 1e-3, oz = minZ - 1e-3;
  let gnx = 1, gny = 1, gnz = 1;
  for (;;) {
    gnx = Math.max(1, Math.floor((maxX + 1e-3 - ox) / cell) + 1);
    gny = Math.max(1, Math.floor((maxY + 1e-3 - oy) / cell) + 1);
    gnz = Math.max(1, Math.floor((maxZ + 1e-3 - oz) / cell) + 1);
    if (gnx * gny * gnz <= MAX_GRID_CELLS) break;
    cell *= 2;
  }
  const ncells = gnx * gny * gnz;
  const start = new Int32Array(ncells + 1);
  const cellOf = new Int32Array(count);
  const invCell = 1 / cell;
  for (let i = 0; i < count; i++) {
    let ix = Math.floor((px[i] - ox) * invCell), iy = Math.floor((py[i] - oy) * invCell), iz = Math.floor((pz[i] - oz) * invCell);
    if (ix < 0) ix = 0; else if (ix >= gnx) ix = gnx - 1;
    if (iy < 0) iy = 0; else if (iy >= gny) iy = gny - 1;
    if (iz < 0) iz = 0; else if (iz >= gnz) iz = gnz - 1;
    const c = (iz * gny + iy) * gnx + ix;
    cellOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < ncells; c++) start[c + 1] += start[c];
  const items = new Int32Array(count);
  {
    const cursor = start.slice(0, ncells);
    for (let i = 0; i < count; i++) items[cursor[cellOf[i]]++] = i;
  }

  return {
    size: S, count, idOf, lin, srcOf, mirrorStart, mirrorItems,
    px, py, pz, nx, ny, nz, area, weight, floor, team, noise,
    grid: { cell, ox, oy, oz, nx: gnx, ny: gny, nz: gnz, start, items },
    totalArea, totalWeighted, overlaps,
  };
}

/** Full recount of Σ area·weight per team straight from the arrays (verification / resync). */
export function recountWeighted(atlas: PaintAtlas): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const { team, area, weight, count } = atlas;
  for (let i = 0; i < count; i++) out[team[i] as TeamId] += area[i] * weight[i];
  return out;
}
