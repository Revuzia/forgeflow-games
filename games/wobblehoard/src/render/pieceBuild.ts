// PieceBuild (CUT2.md 8.2): the FINE render mesh of a TRUE piece of a cut squishy. Pure (no three, no DOM, no Math.random): typed arrays in, typed arrays out,
// so the node checks run it on PHYS's real builds.
//
// A piece's sim mesh (642 particles, 162 under 0.35 of the whole) is the radial re-mesh of the part of the squishy inside its convex cell. Some of its triangles lie
// ON a cut plane (a CAP: all three vertices within 1e-6 R0 of the plane, I2) and the rest are the skin. The fine mesh is NOT a geodesic cast onto this mesh (that
// stretches the fine vertices toward a flat face's rim): every sim triangle is subdivided n x n by barycentric lattice, and the vertices are welded PER CLASS (skin,
// cap 1, cap 2 ...), so a rim vertex exists once per class at the same place and the index buffer is open exactly along the crease: a crisp edge, no threshold.
//
// Classes are laid out cap planes first (slot order), skin last: the per-frame loop evaluates the caps with the face normals, then the skin, and a skin vertex that has
// a cap twin (a rim vertex) takes the twin's POSITION (the rim lies in the plane exactly; Phong tessellation with the skin normals would lift it out by ~1e-3 R0 and open a
// hairline crack) and keeps its own skin NORMAL.
import type { CutPlaneRest, PieceInfo } from '../contracts.ts';
import { relaxNormals, relaxNormalsList, simNormals, simNormalsList } from './normals.ts';

export interface PieceBuild {
  /** Subdivision of every sim triangle (n x n). */
  readonly n: number;
  /** Fine vertex count. */
  readonly count: number;
  /** Sim vertex index * 3 of the owning sim triangle's corners, per fine vertex, and the barycentric weights (u, v, w) of the point in it. */
  readonly vA: Uint32Array; readonly vB: Uint32Array; readonly vC: Uint32Array;
  readonly bw: Float32Array;
  /** Fine triangles (outward winding, the sim triangle's). */
  readonly indices: Uint32Array;
  /** Per fine vertex: (k, rim): k = 0 skin, 1.. = cap plane slot + 1; rim 1 on the face's edge falling to 0 about 0.09 R0 inside it (cap vertices only). */
  readonly aCap: Float32Array;
  /** The point in W / whole radius: the cut face's noise coordinate, the SAME on both faces of a cut. */
  readonly aCapP: Float32Array;
  /** Depth of the piece behind a cap vertex / whole radius (a thickness map from an 8 x 8 grid); 0 on the skin. */
  readonly aCapD: Float32Array;
  /** normalize(P_W - m_W), m_W = vertex mean of the whole mesh: the pattern coordinate, continuous across the cut. */
  readonly aRest: Float32Array;
  /** Per sim vertex (3 floats, W frame): what to ADD to the live skin normal so that at rest it equals the whole's smooth normal at the same surface point. A rim vertex's skin normal comes from
   *  skin triangles only, so it leans away from the cut (the one-sided fan); two flush halves would show a seam line where the whole is smooth. Zero for cap-only vertices. */
  readonly normDelta: Float32Array;
  /** Skin vertex -> the cap vertex at the same place (a rim vertex), or -1. */
  readonly twin: Int32Array;
  /** Fine vertex ranges: class c (0 .. K-1 = cap slot c, K = skin) owns [classStart[c], classStart[c + 1]). */
  readonly classStart: Uint32Array;
  /** The planes (the piece's cell, W frame, normals OUT of the piece) in slot order, and for each slot the sim triangles of its cap. */
  readonly planes: ReadonlyArray<CutPlaneRest>;
  readonly capTris: ReadonlyArray<Uint32Array>;
  readonly skinTris: Uint32Array;
  /** Per sim vertex: 0 = it is in a skin triangle (read the skin normal), k + 1 = only in cap k's triangles. */
  readonly vSrc: Uint8Array;
  /** Per sim triangle: 0 skin, k + 1 = cap slot k. */
  readonly simCls: Uint8Array;
  /** I2 holds: every cap is a union of whole triangles with a simple edge loop, no stray on-plane vertex or edge. false = `degraded` (the majority-class fallback was used). */
  readonly rimClean: boolean;
  readonly degraded: boolean;
  /** How many things were wrong with the sim mesh (stray on-plane vertices / edges, non-manifold cap boundary vertices). */
  readonly unclean: number;
}

/** Tuning knobs (probes and the R3 per-piece resolution work): nExtra adds to every piece's n. */
export const PB_TUNING = { nExtra: 0 };

/** n of the n x n subdivision (8.2): about N_tier * frac^(2/3) fine vertices for a piece, never fewer than 2 per sim edge. `simTris` = 1280 (detail 3) or 320 (detail 2). */
export function pieceFineN(fineFreq: number, frac: number, simTris: number): number {
  const nTier = 10 * fineFreq * fineFreq + 2;
  const f = Math.max(0.02, Math.min(1, Number.isFinite(frac) ? frac : 0.5));
  return Math.max(2, Math.min(8, Math.floor(Math.sqrt((2 * nTier * Math.pow(f, 2 / 3)) / Math.max(1, simTris)) + 0.35) + PB_TUNING.nExtra));
}

/** A piece draws through this path only when its cell has at least one plane; `cells = [[]]` or no piece is a whole (today's code path). */
export function isCutPiece(p: PieceInfo | undefined | null): p is PieceInfo {
  return !!p && Array.isArray(p.cells) && p.cells.length > 0 && Array.isArray(p.cells[0]) && p.cells[0].length > 0;
}

const ctz = (m: number): number => { let k = 0; while (!(m & 1)) { m >>= 1; k++; } return k; };

/* ── the pattern coordinate of a SKIN point is the whole's own: a piece's skin sits up to ~0.02 R0 off the whole's surface (PHYS's re-mesh from a finer source solid), and a tangential
 *  part of that shows as a shifted pattern (a foam's grain moves half a cell). So aRest of a skin vertex is taken at the nearest point of the WHOLE's surface: the same material. ── */
interface WholeAccel { vtStart: Uint32Array; vtList: Uint32Array; wN: Float32Array }
const ACCEL = new WeakMap<object, WholeAccel>();
function accelOf(whole: PieceInfo['whole']): WholeAccel {
  let a = ACCEL.get(whole.restLocal);
  if (!a) {
    const wn = (whole.restLocal.length / 3) | 0, idx = whole.indices, vtStart = new Uint32Array(wn + 1);
    for (let k = 0; k < idx.length; k++) vtStart[idx[k] + 1]++;
    for (let i = 0; i < wn; i++) vtStart[i + 1] += vtStart[i];
    const vtList = new Uint32Array(idx.length), fill = new Uint32Array(wn);
    for (let t = 0; t < idx.length / 3; t++) for (let q = 0; q < 3; q++) { const v = idx[t * 3 + q]; vtList[vtStart[v] + fill[v]++] = t; }
    // the whole's vertex normals by the SAME pipeline the view runs every frame (area-weighted, two relax passes)
    const wN = new Float32Array(wn * 3), acc = new Float32Array(wn * 3), R32 = whole.restLocal instanceof Float32Array ? whole.restLocal : Float32Array.from(whole.restLocal), I32 = whole.indices instanceof Uint32Array ? whole.indices : Uint32Array.from(whole.indices);
    simNormals(R32, I32, wN); relaxNormals(wN, I32, acc, 0.7); relaxNormals(wN, I32, acc, 0.5);
    a = { vtStart, vtList, wN }; ACCEL.set(whole.restLocal, a);
  }
  return a;
}
/** Squared distance from (px, py, pz) to triangle (a, b, c) and the closest point, written to out[0..2] (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(r: ArrayLike<number>, a: number, b: number, c: number, px: number, py: number, pz: number, out: Float64Array): number {
  const ax = r[a], ay = r[a + 1], az = r[a + 2], abx = r[b] - ax, aby = r[b + 1] - ay, abz = r[b + 2] - az, acx = r[c] - ax, acy = r[c + 1] - ay, acz = r[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - r[b], bpy = py - r[b + 1], bpz = pz - r[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = r[b]; qy = r[b + 1]; qz = r[b + 2]; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
      else {
        const cpx = px - r[c], cpy = py - r[c + 1], cpz = pz - r[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = r[c]; qy = r[c + 1]; qz = r[c + 2]; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); qx = r[b] + w * (r[c] - r[b]); qy = r[b + 1] + w * (r[c + 1] - r[b + 1]); qz = r[b + 2] + w * (r[c + 2] - r[b + 2]); }
            else { const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  out[0] = qx; out[1] = qy; out[2] = qz;
  return (qx - px) * (qx - px) + (qy - py) * (qy - py) + (qz - pz) * (qz - pz);
}

/** Milliseconds the last buildPieceMesh spent per phase (classify + I2 check, caps (rim, depth), nearest whole point, subdivision): for the probes. */
export const lastBuildMs = { classify: 0, caps: 0, whole: 0, subdivide: 0 };

export function buildPieceMesh(rest: ArrayLike<number>, simIdx: ArrayLike<number>, piece: PieceInfo, n: number): PieceBuild {
  const tA = performance.now();
  const V = (rest.length / 3) | 0, T = (simIdx.length / 3) | 0;
  const planes = (piece.cells[0] ?? []).slice(0, 8);
  const K = planes.length;
  const R = piece.whole.radius > 0 ? piece.whole.radius : 0.5;
  const tol = 1e-6 * R;
  const ox = piece.offset.x, oy = piece.offset.y, oz = piece.offset.z;
  // W-frame position of every sim vertex and the bit mask of the planes it lies on
  const W = new Float64Array(V * 3);
  const on = new Uint8Array(V);
  for (let v = 0; v < V; v++) {
    const x = rest[v * 3] + ox, y = rest[v * 3 + 1] + oy, z = rest[v * 3 + 2] + oz;
    W[v * 3] = x; W[v * 3 + 1] = y; W[v * 3 + 2] = z;
    for (let k = 0; k < K; k++) { const p = planes[k]; if (Math.abs(p.n.x * x + p.n.y * y + p.n.z * z - p.d) < tol) on[v] |= 1 << k; }
  }
  // sim triangle classes: cap k iff all three vertices are on plane k
  const simCls = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const m = on[simIdx[t * 3]] & on[simIdx[t * 3 + 1]] & on[simIdx[t * 3 + 2]];
    if (m) simCls[t] = 1 + ctz(m);
  }
  // I2 check: a cap is a union of whole triangles whose boundary is a simple loop, and nothing else lies on the plane
  let unclean = 0;
  {
    const capVert = new Uint8Array(V);                      // bit k: the vertex is in a cap-k triangle
    for (let t = 0; t < T; t++) { const c = simCls[t]; if (c) for (let q = 0; q < 3; q++) capVert[simIdx[t * 3 + q]] |= 1 << (c - 1); }
    for (let v = 0; v < V; v++) if (on[v] & ~capVert[v]) unclean++;                           // an on-plane vertex outside the cap
    const edgeTri = new Map<number, number>();                                              // edge -> first triangle; -2 - t once a second one is seen
    const e2 = new Map<number, number>();
    const ek = (a: number, b: number): number => (a < b ? a * V + b : b * V + a);
    for (let t = 0; t < T; t++) for (let q = 0; q < 3; q++) {
      const key = ek(simIdx[t * 3 + q], simIdx[t * 3 + ((q + 1) % 3)]);
      if (!edgeTri.has(key)) edgeTri.set(key, t); else e2.set(key, t);
    }
    const bnd = new Int32Array(V * 8);                                                      // boundary edges of cap k at vertex v
    for (let t = 0; t < T; t++) {
      const cls = simCls[t];
      for (let q = 0; q < 3; q++) {
        const a = simIdx[t * 3 + q], b = simIdx[t * 3 + ((q + 1) % 3)], key = ek(a, b);
        const t0 = edgeTri.get(key) as number, t1 = e2.get(key);
        const other = t0 === t ? t1 : t0;                                                   // the triangle across the edge (undefined: an open mesh)
        const m = on[a] & on[b];
        if (cls) {
          const k = cls - 1;
          if (other === undefined || simCls[other] !== cls) { bnd[a * 8 + k]++; bnd[b * 8 + k]++; }
        } else if (m) {
          // a skin triangle with an edge on plane k is legitimate only along the cap's boundary
          for (let k = 0; k < K; k++) if ((m >> k) & 1 && (other === undefined || simCls[other] !== k + 1)) unclean++;
        }
      }
    }
    for (let v = 0; v < V; v++) for (let k = 0; k < K; k++) { const c = bnd[v * 8 + k]; if (c !== 0 && c !== 2) unclean++; }
  }
  let degraded = false;
  if (unclean > 0) {
    // fallback (8.2): the same subdivision with a per-vertex MAJORITY class: a triangle with two cap vertices joins the cap (a chamfer of one sim triangle)
    degraded = true;
    for (let t = 0; t < T; t++) {
      const cv = [0, 0, 0];
      for (let q = 0; q < 3; q++) { const m = on[simIdx[t * 3 + q]]; cv[q] = m ? 1 + ctz(m) : 0; }
      let best = 0, bn = 1;
      for (let q = 0; q < 3; q++) { let c = 0; for (let r = 0; r < 3; r++) if (cv[r] === cv[q]) c++; if (c > bn) { bn = c; best = cv[q]; } }
      simCls[t] = bn >= 2 ? best : 0;
    }
  }
  // sim triangle lists per class, and the normal source of every sim vertex
  const nCls = K + 1;
  const counts = new Uint32Array(nCls);
  for (let t = 0; t < T; t++) counts[simCls[t] === 0 ? K : simCls[t] - 1]++;
  const lists: Uint32Array[] = []; for (let c = 0; c < nCls; c++) lists.push(new Uint32Array(counts[c]));
  const fill = new Uint32Array(nCls);
  for (let t = 0; t < T; t++) { const c = simCls[t] === 0 ? K : simCls[t] - 1; lists[c][fill[c]++] = t; }
  const vSrc = new Uint8Array(V).fill(255);
  for (let t = 0; t < T; t++) for (let q = 0; q < 3; q++) {
    const v = simIdx[t * 3 + q], c = simCls[t];
    if (c === 0) vSrc[v] = 0; else if (vSrc[v] === 255) vSrc[v] = c;
  }
  for (let v = 0; v < V; v++) if (vSrc[v] === 255) vSrc[v] = 0;

  const tB = performance.now();
  // per cap: the boundary segments of its triangles (the rim, W frame: the rim value of a fine vertex is its distance to them), and the thickness grid
  const bsegs: Float64Array[] = [], capD: { u0: number; v0: number; du: number; dv: number; e1: number[]; e2: number[]; g: Float32Array }[] = [];
  const RIM_W = 0.09 * R;
  for (let k = 0; k < K; k++) {
    const tris = lists[k];
    let segs = new Float64Array(0);
    if (tris.length) {
      const inCap = new Uint8Array(V);
      const cnt = new Map<number, number>();
      const ek = (a: number, b: number): number => (a < b ? a * V + b : b * V + a);
      for (let i = 0; i < tris.length; i++) for (let q = 0; q < 3; q++) {
        const a = simIdx[tris[i] * 3 + q], b = simIdx[tris[i] * 3 + ((q + 1) % 3)];
        inCap[a] = 1; inCap[b] = 1;
        const e = ek(a, b); cnt.set(e, (cnt.get(e) ?? 0) + 1);
      }
      { const sl: number[] = [];
        for (const [e, c] of cnt) if (c === 1) { const a = Math.floor(e / V), b = e % V; sl.push(W[a * 3], W[a * 3 + 1], W[a * 3 + 2], W[b * 3], W[b * 3 + 1], W[b * 3 + 2]); }
        segs = Float64Array.from(sl); }
      // thickness grid: in-plane basis, bounding box of the cap, max depth of the skin vertices per cell
      const p = planes[k];
      const up = Math.abs(p.n.y) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let e1x = p.n.y * up[2] - p.n.z * up[1], e1y = p.n.z * up[0] - p.n.x * up[2], e1z = p.n.x * up[1] - p.n.y * up[0];
      const l1 = Math.hypot(e1x, e1y, e1z) || 1; e1x /= l1; e1y /= l1; e1z /= l1;
      const e2x = p.n.y * e1z - p.n.z * e1y, e2y = p.n.z * e1x - p.n.x * e1z, e2z = p.n.x * e1y - p.n.y * e1x;
      let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
      for (let v = 0; v < V; v++) if (inCap[v]) {
        const u = W[v * 3] * e1x + W[v * 3 + 1] * e1y + W[v * 3 + 2] * e1z, w = W[v * 3] * e2x + W[v * 3 + 1] * e2y + W[v * 3 + 2] * e2z;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < w0) w0 = w; if (w > w1) w1 = w;
      }
      const G = 8, du = Math.max(1e-6, (u1 - u0) / G), dv = Math.max(1e-6, (w1 - w0) / G);
      const g = new Float32Array(G * G);
      for (let v = 0; v < V; v++) {
        if (on[v] & (1 << k)) continue;
        const depth = p.d - (p.n.x * W[v * 3] + p.n.y * W[v * 3 + 1] + p.n.z * W[v * 3 + 2]);
        if (!(depth > 0)) continue;
        const u = W[v * 3] * e1x + W[v * 3 + 1] * e1y + W[v * 3 + 2] * e1z, w = W[v * 3] * e2x + W[v * 3 + 1] * e2y + W[v * 3 + 2] * e2z;
        const ci = Math.max(0, Math.min(G - 1, Math.floor((u - u0) / du))), cj = Math.max(0, Math.min(G - 1, Math.floor((w - w0) / dv)));
        if (depth > g[cj * G + ci]) g[cj * G + ci] = depth;
      }
      // fill the empty cells from their neighbours (twice), then one 3 x 3 smoothing pass over the non-empty ones
      for (let pass = 0; pass < 2; pass++) {
        const src = g.slice();
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (src[j * G + i] === 0) {
          let s = 0, c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && ii < G && jj >= 0 && jj < G && src[jj * G + ii] > 0) { s += src[jj * G + ii]; c++; } }
          if (c) g[j * G + i] = s / c;
        }
      }
      { const src = g.slice();
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
          let s = 0, c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && ii < G && jj >= 0 && jj < G) { s += src[jj * G + ii]; c++; } }
          g[j * G + i] = s / c;
        } }
      capD.push({ u0, v0: w0, du, dv, e1: [e1x, e1y, e1z], e2: [e2x, e2y, e2z], g });
    } else capD.push({ u0: 0, v0: 0, du: 1, dv: 1, e1: [1, 0, 0], e2: [0, 0, 1], g: new Float32Array(64) });
    bsegs.push(segs);
  }
  /** 1 on the face's edge falling to 0 at RIM_W inside it: from the distance to the nearest boundary segment (no interpolation across the big sim triangles: that draws stars). */
  const segDist2 = (k: number, x: number, y: number, z: number): number => {
    const sg = bsegs[k];
    let best = Infinity;
    for (let i = 0; i < sg.length; i += 6) {
      const ax = sg[i], ay = sg[i + 1], az = sg[i + 2], bx = sg[i + 3] - ax, by = sg[i + 4] - ay, bz = sg[i + 5] - az;
      const px = x - ax, py = y - ay, pz = z - az, l2 = bx * bx + by * by + bz * bz;
      let t = l2 > 0 ? (px * bx + py * by + pz * bz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return best;
  };
  const rimAt = (k: number, x: number, y: number, z: number): number => { const d = Math.sqrt(segDist2(k, x, y, z)) / RIM_W; return d >= 1 ? 0 : 1 - d * d * (3 - 2 * d); };
  // a fine vertex is inside its sim triangle: when even the nearest corner is farther than RIM_W + the triangle's longest edge, the exact distance is not needed
  const dSim: Float32Array[] = [];
  for (let k = 0; k < K; k++) { const d = new Float32Array(V).fill(1e9); if (bsegs[k].length) for (let t = 0; t < lists[k].length; t++) for (let q = 0; q < 3; q++) { const v = simIdx[lists[k][t] * 3 + q]; if (d[v] === 1e9) d[v] = Math.sqrt(segDist2(k, W[v * 3], W[v * 3 + 1], W[v * 3 + 2])); } dSim.push(d); }
  const depthAt = (k: number, x: number, y: number, z: number): number => {
    const c = capD[k], G = 8;
    const fu = Math.max(0, Math.min(G - 1, (x * c.e1[0] + y * c.e1[1] + z * c.e1[2] - c.u0) / c.du - 0.5));
    const fv = Math.max(0, Math.min(G - 1, (x * c.e2[0] + y * c.e2[1] + z * c.e2[2] - c.v0) / c.dv - 0.5));
    const i0 = Math.floor(fu), j0 = Math.floor(fv), i1 = Math.min(G - 1, i0 + 1), j1 = Math.min(G - 1, j0 + 1), a = fu - i0, b = fv - j0;
    return (c.g[j0 * G + i0] * (1 - a) + c.g[j0 * G + i1] * a) * (1 - b) + (c.g[j1 * G + i0] * (1 - a) + c.g[j1 * G + i1] * a) * b;
  };

  const tC = performance.now();
  // m_W: the vertex mean of the WHOLE mesh (what the old pattern coordinate was cast from)
  let mx = 0, my = 0, mz = 0;
  { const wr = piece.whole.restLocal, wn = (wr.length / 3) | 0;
    for (let i = 0; i < wn; i++) { mx += wr[i * 3]; my += wr[i * 3 + 1]; mz += wr[i * 3 + 2]; }
    mx /= wn || 1; my /= wn || 1; mz /= wn || 1; }

  // displacement from each SKIN sim vertex to the nearest point of the whole's surface (nearest whole vertex, then the triangles around it): D_s = C_s - P_s
  const DS = new Float64Array(V * 3), NW = new Float32Array(V * 3);
  {
    const wr = piece.whole.restLocal, wi = piece.whole.indices, wn = (wr.length / 3) | 0, ac = accelOf(piece.whole), best = new Float64Array(3), cur = new Float64Array(3);
    // visit the piece's vertices in breadth-first order over its own edges: each one starts its search at its neighbour's nearest whole vertex and walks downhill on the whole's edges
    // (over the SKIN triangles only: an interior cap vertex has its own nearest vertex and would hand a bad start to the skin vertices behind it)
    const skinT = lists[K], nbS = new Uint32Array(V + 1);
    for (let q = 0; q < skinT.length; q++) for (let k = 0; k < 3; k++) nbS[simIdx[skinT[q] * 3 + k] + 1] += 2;
    for (let i = 0; i < V; i++) nbS[i + 1] += nbS[i];
    const nbL = new Uint32Array(nbS[V]), nbF = new Uint32Array(V);
    for (let q = 0; q < skinT.length; q++) { const t = skinT[q]; for (let k = 0; k < 3; k++) { const a = simIdx[t * 3 + k], b = simIdx[t * 3 + ((k + 1) % 3)]; nbL[nbS[a] + nbF[a]++] = b; nbL[nbS[b] + nbF[b]++] = a; } }
    // the order: breadth-first over the piece's edges, every vertex after its parent; a vertex starts at its parent's nearest whole vertex (a root, once per component, at a brute-force one)
    const parent = new Int32Array(V).fill(-2), order = new Uint32Array(V), near = new Int32Array(V).fill(-1);
    let qh = 0, qt = 0;
    for (let root = 0; root < V; root++) {
      if (parent[root] !== -2 || vSrc[root] !== 0) continue;
      parent[root] = -1; order[qt++] = root;
      while (qh < qt) {
        const v = order[qh++];
        for (let a = nbS[v]; a < nbS[v + 1]; a++) { const u = nbL[a]; if (parent[u] === -2) { parent[u] = v; order[qt++] = u; } }
      }
    }
    for (let oi = 0; oi < qt; oi++) {
      const v = order[oi];
      const px = W[v * 3], py = W[v * 3 + 1], pz = W[v * 3 + 2];
      let nb = 0, nd = Infinity;
      if (parent[v] < 0) { for (let i = 0; i < wn; i++) { const dx = wr[i * 3] - px, dy = wr[i * 3 + 1] - py, dz = wr[i * 3 + 2] - pz, d = dx * dx + dy * dy + dz * dz; if (d < nd) { nd = d; nb = i; } } }
      else { nb = near[parent[v]]; nd = (wr[nb * 3] - px) ** 2 + (wr[nb * 3 + 1] - py) ** 2 + (wr[nb * 3 + 2] - pz) ** 2; }
      for (let guard = 0; guard < 64; guard++) {   // downhill on the whole's edges to a local minimum of the vertex distance
        let nxt = nb;
        for (let a = ac.vtStart[nb]; a < ac.vtStart[nb + 1]; a++) {
          const t0 = ac.vtList[a];
          for (let q = 0; q < 3; q++) { const u = wi[t0 * 3 + q], d = (wr[u * 3] - px) ** 2 + (wr[u * 3 + 1] - py) ** 2 + (wr[u * 3 + 2] - pz) ** 2; if (d < nd) { nd = d; nxt = u; } }
        }
        if (nxt === nb) break;
        nb = nxt;
      }
      near[v] = nb;
      if (vSrc[v] !== 0) continue;
      let bd = Infinity, bt = -1;
      for (let a = ac.vtStart[nb]; a < ac.vtStart[nb + 1]; a++) {   // the triangles around the nearest vertex hold the nearest surface point (a point near a smooth surface projects into the fan of its nearest vertex)
        const t = ac.vtList[a];
        const d = closestOnTri(wr, wi[t * 3] * 3, wi[t * 3 + 1] * 3, wi[t * 3 + 2] * 3, px, py, pz, cur);
        if (d < bd) { bd = d; bt = t; best[0] = cur[0]; best[1] = cur[1]; best[2] = cur[2]; }
      }
      if (bd < Infinity) {
        DS[v * 3] = best[0] - px; DS[v * 3 + 1] = best[1] - py; DS[v * 3 + 2] = best[2] - pz;
        // the whole's smooth normal at that surface point: barycentric over the triangle's vertex normals
        const ia = wi[bt * 3] * 3, ib = wi[bt * 3 + 1] * 3, ic = wi[bt * 3 + 2] * 3;
        const v0x = wr[ib] - wr[ia], v0y = wr[ib + 1] - wr[ia + 1], v0z = wr[ib + 2] - wr[ia + 2], v1x = wr[ic] - wr[ia], v1y = wr[ic + 1] - wr[ia + 1], v1z = wr[ic + 2] - wr[ia + 2];
        const v2x = best[0] - wr[ia], v2y = best[1] - wr[ia + 1], v2z = best[2] - wr[ia + 2];
        const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z, d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z;
        const den = d00 * d11 - d01 * d01, wb = den > 1e-30 ? (d11 * d20 - d01 * d21) / den : 0, wc = den > 1e-30 ? (d00 * d21 - d01 * d20) / den : 0, wa = 1 - wb - wc, N = ac.wN;
        let nx = wa * N[ia] + wb * N[ib] + wc * N[ic], ny = wa * N[ia + 1] + wb * N[ib + 1] + wc * N[ic + 1], nz = wa * N[ia + 2] + wb * N[ib + 2] + wc * N[ic + 2];
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        NW[v * 3] = nx; NW[v * 3 + 1] = ny; NW[v * 3 + 2] = nz;
      }
    }
  }

  // the rim-normal correction: (the whole's smooth normal at the same surface point) - (this piece's own skin normal at rest, by the runtime pipeline)
  const normDelta = new Float32Array(V * 3);
  {
    const R32 = rest instanceof Float32Array ? rest : Float32Array.from(rest), I32 = simIdx instanceof Uint32Array ? simIdx : Uint32Array.from(simIdx);
    const pN = new Float32Array(V * 3), acc = new Float32Array(V * 3);
    simNormalsList(R32, I32, lists[K], pN); relaxNormalsList(pN, I32, lists[K], acc, 0.7); relaxNormalsList(pN, I32, lists[K], acc, 0.5);
    for (let v = 0; v < V; v++) {
      if (vSrc[v] !== 0 || (NW[v * 3] === 0 && NW[v * 3 + 1] === 0 && NW[v * 3 + 2] === 0)) continue;
      normDelta[v * 3] = NW[v * 3] - pN[v * 3]; normDelta[v * 3 + 1] = NW[v * 3 + 1] - pN[v * 3 + 1]; normDelta[v * 3 + 2] = NW[v * 3 + 2] - pN[v * 3 + 2];
    }
  }
  const tD = performance.now();
  // the subdivision, class by class
  const per = ((n + 1) * (n + 2)) / 2;
  const maxV = T * per, maxI = T * n * n * 3;
  const vA = new Uint32Array(maxV), vB = new Uint32Array(maxV), vC = new Uint32Array(maxV);
  const bw = new Float32Array(maxV * 3), aCap = new Float32Array(maxV * 2), aCapP = new Float32Array(maxV * 3), aCapD = new Float32Array(maxV), aRest = new Float32Array(maxV * 3);
  const twin = new Int32Array(maxV).fill(-1);
  const indices = new Uint32Array(maxI);
  const classStart = new Uint32Array(nCls + 1);
  const capMaps: Map<number, number>[] = [];
  const grid = new Int32Array((n + 1) * (n + 1));
  let nv = 0, ni = 0;
  const invR = 1 / R;
  for (let c = 0; c < nCls; c++) {
    classStart[c] = nv;
    const isSkin = c === K, tris = lists[c], map = new Map<number, number>();
    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti], s0 = simIdx[t * 3], s1 = simIdx[t * 3 + 1], s2 = simIdx[t * 3 + 2];
      const triEdge = isSkin ? 0 : Math.max(Math.hypot(W[s0 * 3] - W[s1 * 3], W[s0 * 3 + 1] - W[s1 * 3 + 1], W[s0 * 3 + 2] - W[s1 * 3 + 2]), Math.hypot(W[s1 * 3] - W[s2 * 3], W[s1 * 3 + 1] - W[s2 * 3 + 1], W[s1 * 3 + 2] - W[s2 * 3 + 2]), Math.hypot(W[s2 * 3] - W[s0 * 3], W[s2 * 3 + 1] - W[s0 * 3 + 1], W[s2 * 3 + 2] - W[s0 * 3 + 2]));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const a = n - i - j;
        let key = -1;
        if (a === n) key = s0; else if (i === n) key = s1; else if (j === n) key = s2;
        else if (j === 0 || a === 0 || i === 0) {
          // on a sim edge: keyed by the edge and the step count from its lower vertex (= the lattice weight of the HIGHER vertex)
          let p: number, q: number, wq: number;
          if (j === 0) { p = s0; q = s1; wq = i; } else if (a === 0) { p = s1; q = s2; wq = j; } else { p = s2; q = s0; wq = a; }
          // (p, q) with wq = the weight of q; the step count from min(p, q) is the weight of max(p, q)
          const lo = p < q ? p : q, hi = p < q ? q : p, steps = p < q ? wq : n - wq;
          key = V + (lo * V + hi) * (n + 1) + steps;
        }
        let id = key >= 0 ? map.get(key) : undefined;
        if (id === undefined) {
          id = nv++;
          if (key >= 0) map.set(key, id);
          const u = a / n, v = i / n, w = j / n;
          vA[id] = s0 * 3; vB[id] = s1 * 3; vC[id] = s2 * 3;
          bw[id * 3] = u; bw[id * 3 + 1] = v; bw[id * 3 + 2] = w;
          const px = u * W[s0 * 3] + v * W[s1 * 3] + w * W[s2 * 3], py = u * W[s0 * 3 + 1] + v * W[s1 * 3 + 1] + w * W[s2 * 3 + 1], pz = u * W[s0 * 3 + 2] + v * W[s1 * 3 + 2] + w * W[s2 * 3 + 2];
          aCapP[id * 3] = px * invR; aCapP[id * 3 + 1] = py * invR; aCapP[id * 3 + 2] = pz * invR;
          // (a cap point is inside the squishy: its own place; a skin point takes the whole's surface point nearest to it)
          const dxs = isSkin ? u * DS[s0 * 3] + v * DS[s1 * 3] + w * DS[s2 * 3] : 0, dys = isSkin ? u * DS[s0 * 3 + 1] + v * DS[s1 * 3 + 1] + w * DS[s2 * 3 + 1] : 0, dzs = isSkin ? u * DS[s0 * 3 + 2] + v * DS[s1 * 3 + 2] + w * DS[s2 * 3 + 2] : 0;
          const rx = px + dxs - mx, ry = py + dys - my, rz = pz + dzs - mz, rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
          aRest[id * 3] = rx / rl; aRest[id * 3 + 1] = ry / rl; aRest[id * 3 + 2] = rz / rl;
          if (!isSkin) {
            aCap[id * 2] = c + 1;
            { const ds = dSim[c], m = Math.min(ds[s0], ds[s1], ds[s2]); aCap[id * 2 + 1] = m - triEdge >= RIM_W ? 0 : rimAt(c, px, py, pz); }
            aCapD[id] = depthAt(c, px, py, pz) * invR;
          } else if (key >= 0) {
            for (let k = 0; k < K; k++) { const tw = capMaps[k]?.get(key); if (tw !== undefined) { twin[id] = tw; break; } }
          }
        }
        grid[i * (n + 1) + j] = id;
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
        indices[ni++] = grid[i * (n + 1) + j]; indices[ni++] = grid[(i + 1) * (n + 1) + j]; indices[ni++] = grid[i * (n + 1) + j + 1];
        if (j < n - i - 1) { indices[ni++] = grid[(i + 1) * (n + 1) + j]; indices[ni++] = grid[(i + 1) * (n + 1) + j + 1]; indices[ni++] = grid[i * (n + 1) + j + 1]; }
      }
    }
    if (!isSkin) capMaps.push(map);
  }
  classStart[nCls] = nv;
  { const tE = performance.now(); lastBuildMs.classify = tB - tA; lastBuildMs.caps = tC - tB; lastBuildMs.whole = tD - tC; lastBuildMs.subdivide = tE - tD; }
  const capTris: Uint32Array[] = []; for (let k = 0; k < K; k++) capTris.push(lists[k]);
  return {
    n, count: nv, vA: vA.slice(0, nv), vB: vB.slice(0, nv), vC: vC.slice(0, nv), bw: bw.slice(0, nv * 3), indices: indices.slice(0, ni),
    normDelta, aCap: aCap.slice(0, nv * 2), aCapP: aCapP.slice(0, nv * 3), aCapD: aCapD.slice(0, nv), aRest: aRest.slice(0, nv * 3), twin: twin.slice(0, nv),
    classStart, planes, capTris, skinTris: lists[K], vSrc, simCls, rimClean: unclean === 0, degraded, unclean,
  };
}
