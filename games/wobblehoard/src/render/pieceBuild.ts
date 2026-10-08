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

/** n of the n x n subdivision (8.2): about N_tier * frac^(2/3) fine vertices for a piece, never fewer than 2 per sim edge. `simTris` = 1280 (detail 3) or 320 (detail 2). */
export function pieceFineN(fineFreq: number, frac: number, simTris: number): number {
  const nTier = 10 * fineFreq * fineFreq + 2;
  const f = Math.max(0.02, Math.min(1, Number.isFinite(frac) ? frac : 0.5));
  return Math.max(2, Math.min(8, Math.floor(Math.sqrt((2 * nTier * Math.pow(f, 2 / 3)) / Math.max(1, simTris)) + 0.35)));
}

/** A piece draws through this path only when its cell has at least one plane; `cells = [[]]` or no piece is a whole (today's code path). */
export function isCutPiece(p: PieceInfo | undefined | null): p is PieceInfo {
  return !!p && Array.isArray(p.cells) && p.cells.length > 0 && Array.isArray(p.cells[0]) && p.cells[0].length > 0;
}

const ctz = (m: number): number => { let k = 0; while (!(m & 1)) { m >>= 1; k++; } return k; };

export function buildPieceMesh(rest: ArrayLike<number>, simIdx: ArrayLike<number>, piece: PieceInfo, n: number): PieceBuild {
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

  // rim distance per cap sim vertex (1 on the face's edge, 0 about 0.09 R0 inside), and the thickness grid per cap
  const rimV: Float32Array[] = [], capD: { u0: number; v0: number; du: number; dv: number; e1: number[]; e2: number[]; g: Float32Array }[] = [];
  const RIM_W = 0.09 * R;
  for (let k = 0; k < K; k++) {
    const tris = lists[k], rv = new Float32Array(V);
    if (tris.length) {
      const key = new Set<number>(), bound: number[] = [], inCap = new Uint8Array(V);
      const cnt = new Map<number, number>();
      const ek = (a: number, b: number): number => (a < b ? a * V + b : b * V + a);
      for (let i = 0; i < tris.length; i++) for (let q = 0; q < 3; q++) {
        const a = simIdx[tris[i] * 3 + q], b = simIdx[tris[i] * 3 + ((q + 1) % 3)];
        inCap[a] = 1; inCap[b] = 1;
        const e = ek(a, b); cnt.set(e, (cnt.get(e) ?? 0) + 1);
      }
      for (const [e, c] of cnt) if (c === 1) { key.add(Math.floor(e / V)); key.add(e % V); }
      for (const v of key) bound.push(v);
      for (let v = 0; v < V; v++) if (inCap[v]) {
        let dmin = Infinity;
        for (const b of bound) { const dx = W[v * 3] - W[b * 3], dy = W[v * 3 + 1] - W[b * 3 + 1], dz = W[v * 3 + 2] - W[b * 3 + 2]; const d2 = dx * dx + dy * dy + dz * dz; if (d2 < dmin) dmin = d2; }
        const d = Math.sqrt(dmin) / RIM_W, s = d >= 1 ? 1 : d * d * (3 - 2 * d);
        rv[v] = 1 - s;
      }
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
    rimV.push(rv);
  }
  const depthAt = (k: number, x: number, y: number, z: number): number => {
    const c = capD[k], G = 8;
    const fu = Math.max(0, Math.min(G - 1, (x * c.e1[0] + y * c.e1[1] + z * c.e1[2] - c.u0) / c.du - 0.5));
    const fv = Math.max(0, Math.min(G - 1, (x * c.e2[0] + y * c.e2[1] + z * c.e2[2] - c.v0) / c.dv - 0.5));
    const i0 = Math.floor(fu), j0 = Math.floor(fv), i1 = Math.min(G - 1, i0 + 1), j1 = Math.min(G - 1, j0 + 1), a = fu - i0, b = fv - j0;
    return (c.g[j0 * G + i0] * (1 - a) + c.g[j0 * G + i1] * a) * (1 - b) + (c.g[j1 * G + i0] * (1 - a) + c.g[j1 * G + i1] * a) * b;
  };

  // m_W: the vertex mean of the WHOLE mesh (what the old pattern coordinate was cast from)
  let mx = 0, my = 0, mz = 0;
  { const wr = piece.whole.restLocal, wn = (wr.length / 3) | 0;
    for (let i = 0; i < wn; i++) { mx += wr[i * 3]; my += wr[i * 3 + 1]; mz += wr[i * 3 + 2]; }
    mx /= wn || 1; my /= wn || 1; mz /= wn || 1; }

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
          const rx = px - mx, ry = py - my, rz = pz - mz, rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
          aRest[id * 3] = rx / rl; aRest[id * 3 + 1] = ry / rl; aRest[id * 3 + 2] = rz / rl;
          if (!isSkin) {
            aCap[id * 2] = c + 1;
            aCap[id * 2 + 1] = u * rimV[c][s0] + v * rimV[c][s1] + w * rimV[c][s2];
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
  const capTris: Uint32Array[] = []; for (let k = 0; k < K; k++) capTris.push(lists[k]);
  return {
    n, count: nv, vA: vA.slice(0, nv), vB: vB.slice(0, nv), vC: vC.slice(0, nv), bw: bw.slice(0, nv * 3), indices: indices.slice(0, ni),
    aCap: aCap.slice(0, nv * 2), aCapP: aCapP.slice(0, nv * 3), aCapD: aCapD.slice(0, nv), aRest: aRest.slice(0, nv * 3), twin: twin.slice(0, nv),
    classStart, planes, capTris, skinTris: lists[K], vSrc, simCls, rimClean: unclean === 0, degraded, unclean,
  };
}
