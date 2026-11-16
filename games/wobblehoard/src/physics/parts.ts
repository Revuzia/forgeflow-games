// CUT3 leg 3 (PHYS, _spec/CUT3.md 2 item 3): the CONNECTED PARTS of a cut. A plane through a lobed body (two tips of a star, both ears of munchip or selenuff, a tip and a horn) can leave
// ONE side made of several separate parts. CUT2 4.4 refused those as 'loose'; now each part is its own body. This module finds them on the parent's REST MESH: the exact clip of the closed
// mesh by the plane (the same Sutherland-Hodgman with tetrahedra from a point on the plane as region.ts clipMesh, whose arithmetic it repeats), but every kept fragment is binned by the
// connected part it belongs to, so each part has its own exact volume, centroid and aspect, and every particle on that side has a part label (for the velocities).
//   * Connectivity: the mesh vertices on the kept side (n . x - d >= 0), joined along mesh edges with both ends kept, are the skin groups. A fragment of a triangle with only some corners kept
//     hangs on those corners, so groups of kept vertices ARE the connected pieces of the clipped skin.
//   * The cap closes groups the skin does not join: a plane through a dimple leaves the dimple's floor and the outer belt as two skin groups that the flat cut face (an annulus) joins into ONE
//     solid. The loops where the plane meets the mesh are chained, nested by parity (a loop inside an odd number of loops is a hole of the polygon that holds it), and the groups of a hole's
//     loop and of its parent's loop are merged. This runs only when a side has two or more skin groups (the common cut has one: no loops, no allocation).
//   * A part is a body: its rank is the lowest mesh vertex index it holds (stable when the retry ladder shifts the plane by a hair). Slivers of 1e-9 of the side's volume (a plane through a
//     vertex exactly) are not parts.
// Pure: no three, no DOM, no Math.random, no Date. The common path allocates nothing (typed scratch grown once); the loop analysis allocates small arrays and runs only for 2+ groups.

export const MAX_PARTS = 16;

export interface PartSide {
  /** Number of parts on this side; 0 = the plane leaves nothing of the mesh on it; -1 = more than MAX_PARTS (refused). */
  n: number;
  /** Per part: exact volume of the clipped mesh, centroid (W), sqrt(smallest / largest covariance eigenvalue). */
  readonly vol: Float64Array; readonly cx: Float64Array; readonly cy: Float64Array; readonly cz: Float64Array; readonly aspect: Float64Array;
  /** Sum of vol. */
  total: number;
  /** Per mesh vertex: the part it belongs to, -1 when it is not on this side. */
  lab: Int16Array;
}
export const newPartSide = (nv: number): PartSide => ({ n: 0, vol: new Float64Array(MAX_PARTS), cx: new Float64Array(MAX_PARTS), cy: new Float64Array(MAX_PARTS), cz: new Float64Array(MAX_PARTS), aspect: new Float64Array(MAX_PARTS), total: 0, lab: new Int16Array(nv) });

/* ───────────── scratch ───────────── */
let SV = new Float64Array(0), PAR = new Int32Array(0), INS = new Uint8Array(0), COMP = new Int32Array(0);
const BIN = new Float64Array(10 * (MAX_PARTS + 1));   // per part: vol, sum vol*centroid (3), second moments about the origin (6)
function ensure(nv: number): void {
  if (SV.length >= nv) return;
  SV = new Float64Array(nv); PAR = new Int32Array(nv); INS = new Uint8Array(nv); COMP = new Int32Array(nv);
}
function find(x: number): number { while (PAR[x] !== x) { PAR[x] = PAR[PAR[x]]; x = PAR[x]; } return x; }
function union(a: number, b: number): void { const ra = find(a), rb = find(b); if (ra !== rb) { if (ra < rb) PAR[rb] = ra; else PAR[ra] = rb; } }   // (the lower index is the root: the group's lowest vertex)

/** sqrt(smallest / largest eigenvalue) of the symmetric covariance (the arithmetic of clipMesh). */
function covAspect(cxx: number, cxy: number, cxz: number, cyy: number, cyz: number, czz: number): number {
  const q = (cxx + cyy + czz) / 3;
  const p1 = cxy * cxy + cxz * cxz + cyz * cyz;
  const p2 = (cxx - q) * (cxx - q) + (cyy - q) * (cyy - q) + (czz - q) * (czz - q) + 2 * p1, p = Math.sqrt(p2 / 6);
  let l1: number, l3: number;
  if (p < 1e-300) { l1 = q; l3 = q; }
  else {
    const bxx = (cxx - q) / p, byy = (cyy - q) / p, bzz = (czz - q) / p, bxy = cxy / p, bxz = cxz / p, byz = cyz / p;
    const det = bxx * (byy * bzz - byz * byz) - bxy * (bxy * bzz - byz * bxz) + bxz * (bxy * byz - byy * bxz);
    const r = Math.max(-1, Math.min(1, det / 2)), phi = Math.acos(r) / 3;
    l1 = q + 2 * p * Math.cos(phi);
    l3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  }
  return l1 > 1e-300 ? Math.sqrt(Math.max(0, l3) / l1) : 0;
}

function addTet(k: number, px: number, py: number, pz: number, ex: number, ey: number, ez: number, fx: number, fy: number, fz: number, gx: number, gy: number, gz: number): void {
  const u1x = ex - px, u1y = ey - py, u1z = ez - pz, u2x = fx - px, u2y = fy - py, u2z = fz - pz, u3x = gx - px, u3y = gy - py, u3z = gz - pz;
  const vol = (u1x * (u2y * u3z - u2z * u3y) + u1y * (u2z * u3x - u2x * u3z) + u1z * (u2x * u3y - u2y * u3x)) / 6;
  const sx = px + ex + fx + gx, sy = py + ey + fy + gy, sz = pz + ez + fz + gz;
  const o = k * 10, kk = vol / 20;
  BIN[o] += vol; BIN[o + 1] += vol * sx / 4; BIN[o + 2] += vol * sy / 4; BIN[o + 3] += vol * sz / 4;
  BIN[o + 4] += kk * (px * px + ex * ex + fx * fx + gx * gx + sx * sx);
  BIN[o + 5] += kk * (px * py + ex * ey + fx * fy + gx * gy + sx * sy);
  BIN[o + 6] += kk * (px * pz + ex * ez + fx * fz + gx * gz + sx * sz);
  BIN[o + 7] += kk * (py * py + ey * ey + fy * fy + gy * gy + sy * sy);
  BIN[o + 8] += kk * (py * pz + ey * ez + fy * fz + gy * gz + sy * sz);
  BIN[o + 9] += kk * (pz * pz + ez * ez + fz * fz + gz * gz + sz * sz);
}

/**
 * The parts of the closed mesh (pos, tris; nv vertices) on the side n . x >= d of the plane pl = [nx, ny, nz, d] (n unit); `sg` = +1 for side A, -1 for side B (the plane is negated).
 * Fills `out`. Returns out.n. A part under `minVol` (a crumb no body can be built for: a vertex poking a hair through the plane) is joined to the side's largest part (its volume and moments are
 * added: the sides still sum exactly); a zero-volume sliver of the plane through a vertex exactly is dropped.
 */
export function clipParts(pos: ArrayLike<number>, tris: Uint32Array, nv: number, pl: ArrayLike<number>, sg: number, out: PartSide, minVol = 0): number {
  ensure(nv);
  const nx = sg * pl[0], ny = sg * pl[1], nz = sg * pl[2], d = sg * pl[3];
  const lab = out.lab;
  for (let i = 0; i < nv; i++) {
    const s = nx * pos[i * 3] + ny * pos[i * 3 + 1] + nz * pos[i * 3 + 2] - d;
    SV[i] = s; INS[i] = s >= 0 ? 1 : 0; PAR[i] = i; lab[i] = -1;
  }
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (INS[a] && INS[b]) union(a, b);
    if (INS[b] && INS[c]) union(b, c);
    if (INS[c] && INS[a]) union(c, a);
  }
  // skin groups, ranked by their lowest vertex (the root is the lowest vertex of its group)
  let ng = 0;
  for (let i = 0; i < nv; i++) COMP[i] = -1;
  for (let i = 0; i < nv; i++) if (INS[i] && find(i) === i) COMP[i] = ng++;
  if (ng === 0) { out.n = 0; out.total = 0; return 0; }
  if (ng > 1) mergeByCaps(pos, tris, nv, nx, ny, nz, ng);
  // components = merged roots, ranked by their lowest vertex
  let nc = 0;
  for (let i = 0; i < nv; i++) COMP[i] = -1;
  for (let i = 0; i < nv; i++) if (INS[i] && find(i) === i) { if (nc < MAX_PARTS) COMP[i] = nc; nc++; }
  if (nc > MAX_PARTS) { out.n = -1; out.total = 0; return -1; }
  for (let i = 0; i < nv; i++) if (INS[i]) lab[i] = COMP[find(i)];
  // exact volumes: every kept fragment, tetrahedra from a point on the plane (the cap lies in the plane and adds nothing)
  BIN.fill(0, 0, 10 * nc);
  const px = nx * d, py = ny * d, pz = nz * d;
  for (let t = 0; t < tris.length; t += 3) {
    const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];
    const k = INS[ia] ? lab[ia] : INS[ib] ? lab[ib] : INS[ic] ? lab[ic] : -1;
    if (k < 0) continue;
    const a = ia * 3, b = ib * 3, c = ic * 3;
    let ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx0 = pos[c], cy0 = pos[c + 1], cz0 = pos[c + 2];
    const sa = SV[ia], sb = SV[ib], sc = SV[ic];
    const pa = INS[ia], pb = INS[ib], pc = INS[ic], np = pa + pb + pc;
    let sA = sa, sB = sb, sC = sc;
    if (np === 1) {
      if (pb) { let tx = ax, ty = ay, tz = az; ax = bx; ay = by; az = bz; bx = cx0; by = cy0; bz = cz0; cx0 = tx; cy0 = ty; cz0 = tz; sA = sb; sB = sc; sC = sa; }
      else if (pc) { let tx = ax, ty = ay, tz = az; ax = cx0; ay = cy0; az = cz0; cx0 = bx; cy0 = by; cz0 = bz; bx = tx; by = ty; bz = tz; sA = sc; sB = sa; sC = sb; }
    } else if (np === 2) {
      if (!pa) { let tx = ax, ty = ay, tz = az; ax = bx; ay = by; az = bz; bx = cx0; by = cy0; bz = cz0; cx0 = tx; cy0 = ty; cz0 = tz; sA = sb; sB = sc; sC = sa; }
      else if (!pb) { let tx = ax, ty = ay, tz = az; ax = cx0; ay = cy0; az = cz0; cx0 = bx; cy0 = by; cz0 = bz; bx = tx; by = ty; bz = tz; sA = sc; sB = sa; sC = sb; }
    }
    if (np === 3) addTet(k, px, py, pz, ax, ay, az, bx, by, bz, cx0, cy0, cz0);
    else if (np === 1) {
      const kb = sA / (sA - sB), kc = sA / (sA - sC);
      addTet(k, px, py, pz, ax, ay, az, ax + (bx - ax) * kb, ay + (by - ay) * kb, az + (bz - az) * kb, ax + (cx0 - ax) * kc, ay + (cy0 - ay) * kc, az + (cz0 - az) * kc);
    } else {
      const kb = sB / (sB - sC), ka = sA / (sA - sC);
      const bpx = bx + (cx0 - bx) * kb, bpy = by + (cy0 - by) * kb, bpz = bz + (cz0 - bz) * kb;
      const apx = ax + (cx0 - ax) * ka, apy = ay + (cy0 - ay) * ka, apz = az + (cz0 - az) * ka;
      addTet(k, px, py, pz, ax, ay, az, bx, by, bz, bpx, bpy, bpz);
      addTet(k, px, py, pz, ax, ay, az, bpx, bpy, bpz, apx, apy, apz);
    }
  }
  // finish: drop slivers (a plane through a vertex exactly leaves a zero-volume group), keep the order of the ranks
  let total = 0;
  for (let k = 0; k < nc; k++) total += BIN[k * 10];
  let m = 0, big = 0;
  const remap = RMAP;
  for (let k = 0; k < nc; k++) remap[k] = 0;
  for (let k = 1; k < nc; k++) if (BIN[k * 10] > BIN[big * 10]) big = k;
  if (minVol > 0) for (let k = 0; k < nc; k++) {
    const V = BIN[k * 10];
    if (k !== big && V > 1e-9 * total && V < minVol) { for (let q = 0; q < 10; q++) BIN[big * 10 + q] += BIN[k * 10 + q]; for (let q = 0; q < 10; q++) BIN[k * 10 + q] = 0; remap[k] = -2 - big; }
  }
  for (let k = 0; k < nc; k++) {
    const o = k * 10, V = BIN[o];
    if (remap[k] <= -2) continue;
    if (!(V > 1e-9 * total)) { remap[k] = -1; continue; }
    remap[k] = m;
    const mx = BIN[o + 1] / V, my = BIN[o + 2] / V, mz = BIN[o + 3] / V;
    out.vol[m] = V; out.cx[m] = mx; out.cy[m] = my; out.cz[m] = mz;
    out.aspect[m] = covAspect(BIN[o + 4] / V - mx * mx, BIN[o + 5] / V - mx * my, BIN[o + 6] / V - mx * mz, BIN[o + 7] / V - my * my, BIN[o + 8] / V - my * mz, BIN[o + 9] / V - mz * mz);
    m++;
  }
  let tot2 = 0;
  for (let k = 0; k < m; k++) tot2 += out.vol[k];
  for (let k = 0; k < nc; k++) if (remap[k] <= -2) remap[k] = remap[-2 - remap[k]];   // (a joined crumb takes the label of the part it joined)
  if (m !== nc) for (let i = 0; i < nv; i++) if (lab[i] >= 0) lab[i] = remap[lab[i]];
  out.n = m; out.total = tot2;
  return m;
}
const RMAP = new Int32Array(MAX_PARTS + 1);

/** Groups of the skin that the flat cut face joins (a polygon with holes: a dimple's floor and the belt around it). Merges their roots in PAR. */
function mergeByCaps(pos: ArrayLike<number>, tris: Uint32Array, nv: number, nx: number, ny: number, nz: number, ng: number): void {
  void ng;
  // crossing edges = nodes; each mixed triangle joins its two crossing edges by one segment of the cut
  const nodeOf = new Map<number, number>();
  const ea: number[] = [], eb: number[] = [], adj0: number[] = [], adj1: number[] = [];
  const node = (u: number, w: number): number => {
    const a = INS[u] ? u : w, b = INS[u] ? w : u, key = a * nv + b;
    let id = nodeOf.get(key);
    if (id === undefined) { id = ea.length; nodeOf.set(key, id); ea.push(a); eb.push(b); adj0.push(-1); adj1.push(-1); }
    return id;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const sum = INS[a] + INS[b] + INS[c];
    if (sum === 0 || sum === 3) continue;
    const n0 = INS[a] !== INS[b] ? node(a, b) : -1, n1 = INS[b] !== INS[c] ? node(b, c) : -1, n2 = INS[c] !== INS[a] ? node(c, a) : -1;
    let p = -1, q = -1;
    if (n0 >= 0) { p = n0; if (n1 >= 0) q = n1; else q = n2; } else { p = n1; q = n2; }
    if (p < 0 || q < 0) continue;
    if (adj0[p] < 0) adj0[p] = q; else adj1[p] = q;
    if (adj0[q] < 0) adj0[q] = p; else adj1[q] = p;
  }
  const nn = ea.length;
  if (nn === 0) return;
  // basis of the plane
  let ux: number, uy: number, uz: number;
  if (Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz)) { ux = 0; uy = -nz; uz = ny; } else if (Math.abs(ny) <= Math.abs(nz)) { ux = nz; uy = 0; uz = -nx; } else { ux = -ny; uy = nx; uz = 0; }
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const X2 = new Float64Array(nn), Y2 = new Float64Array(nn);
  for (let i = 0; i < nn; i++) {
    const a = ea[i], b = eb[i], sa = SV[a], sb = SV[b], t = sa / (sa - sb);
    const x = pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t, y = pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t, z = pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t;
    X2[i] = x * ux + y * uy + z * uz; Y2[i] = x * vx + y * vy + z * vz;
  }
  // loops
  const seen = new Uint8Array(nn), loopOf = new Int32Array(nn).fill(-1), loops: number[][] = [];
  for (let s = 0; s < nn; s++) {
    if (seen[s]) continue;
    const chain: number[] = [];
    let prev = -1, cur = s;
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1; chain.push(cur); loopOf[cur] = loops.length;
      const nxt = adj0[cur] !== prev && adj0[cur] >= 0 ? adj0[cur] : adj1[cur];
      prev = cur; cur = nxt;
    }
    loops.push(chain);
  }
  const nl = loops.length;
  if (nl < 2) return;
  const area = new Float64Array(nl), grp = new Int32Array(nl);
  for (let l = 0; l < nl; l++) {
    const ch = loops[l]; let A = 0;
    for (let i = 0; i < ch.length; i++) { const p = ch[i], q = ch[(i + 1) % ch.length]; A += X2[p] * Y2[q] - X2[q] * Y2[p]; }
    area[l] = Math.abs(A) / 2; grp[l] = ea[ch[0]];
  }
  const inside = (px: number, py: number, l: number): boolean => {
    const ch = loops[l]; let c = false;
    for (let i = 0, j = ch.length - 1; i < ch.length; j = i++) {
      const xi = X2[ch[i]], yi = Y2[ch[i]], xj = X2[ch[j]], yj = Y2[ch[j]];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let j = 0; j < nl; j++) {
    const px = X2[loops[j][0]], py = Y2[loops[j][0]];
    let depth = 0, parent = -1, pa = Infinity;
    for (let i = 0; i < nl; i++) if (i !== j && area[i] > area[j] && inside(px, py, i)) { depth++; if (area[i] < pa) { pa = area[i]; parent = i; } }
    if ((depth & 1) === 1 && parent >= 0) union(grp[j], grp[parent]);
  }
}

/** The parts of both sides of a cut. */
export class CutParts {
  readonly A: PartSide; readonly B: PartSide;
  constructor(nv: number) { this.A = newPartSide(nv); this.B = newPartSide(nv); }
  /** Analyse the plane pl = [nx, ny, nz, d] (side A: n . x >= d) on the mesh; parts under `minVol` join the largest of their side. Returns the number of parts in all (A + B), or -1 when a side has more than MAX_PARTS. */
  run(pos: ArrayLike<number>, tris: Uint32Array, nv: number, pl: ArrayLike<number>, minVol = 0): number {
    const a = clipParts(pos, tris, nv, pl, 1, this.A, minVol);
    if (a < 0) return -1;
    const b = clipParts(pos, tris, nv, pl, -1, this.B, minVol);
    if (b < 0) return -1;
    return a + b;
  }
  /** Is a side made of several parts? */
  get multi(): boolean { return this.A.n > 1 || this.B.n > 1; }
}
