// JellyView: the FINE render mesh that rides the coarse simulation mesh.
//
//  * Build time: every fine vertex (a geodesic sphere of 2.5k..10k vertices, frequency picked by quality tier) is mapped to
//    ONE sim triangle plus barycentric weights by casting its direction from the rest centroid against the REST mesh.
//  * Every frame (zero allocation): area-weighted sim vertex normals, then each fine vertex is placed by
//    Phong-tessellation-style smoothing: the barycentric point on the deformed sim triangle is blended (alpha ~0.7)
//    toward its projections onto the three corner tangent planes, and gets the interpolated sim normal. The silhouette
//    stays round and the shading smooth even under a deep dent, with a 642-vertex sim mesh.
//  * Per-vertex attributes: strain (barycentric blend of body.strain, drives the pressure blush) and the REST direction
//    (drives patterns, so they ride the body instead of swimming over it).
import * as THREE from 'three';
import type { SoftBodyLike } from '../contracts.ts';
import { buildGeodesic } from './geodesic.ts';

export interface SurfaceHit { tri: number; u: number; v: number; w: number }

/** Casts rest directions against the rest mesh to find the sim triangle + barycentric weights that own them. */
export class RestMapper {
  private readonly n: number;
  private readonly idx: Uint32Array;
  private readonly rest: Float32Array;
  private readonly dirs: Float32Array;
  private readonly cx: number; private readonly cy: number; private readonly cz: number;
  private readonly vtStart: Uint32Array;
  private readonly vtList: Uint32Array;
  private readonly seen: Int32Array;
  private stamp = 0;
  private readonly cand: Int32Array;

  constructor(body: SoftBodyLike) {
    this.n = body.vertexCount;
    this.idx = body.indices;
    this.rest = body.restLocal;
    const n = this.n, T = this.idx.length / 3;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) { sx += this.rest[i * 3]; sy += this.rest[i * 3 + 1]; sz += this.rest[i * 3 + 2]; }
    this.cx = sx / n; this.cy = sy / n; this.cz = sz / n;
    this.dirs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = this.rest[i * 3] - this.cx, y = this.rest[i * 3 + 1] - this.cy, z = this.rest[i * 3 + 2] - this.cz;
      const l = Math.hypot(x, y, z) || 1;
      this.dirs[i * 3] = x / l; this.dirs[i * 3 + 1] = y / l; this.dirs[i * 3 + 2] = z / l;
    }
    // vertex -> incident triangles (CSR)
    this.vtStart = new Uint32Array(n + 1);
    for (let k = 0; k < T * 3; k++) this.vtStart[this.idx[k] + 1]++;
    for (let i = 0; i < n; i++) this.vtStart[i + 1] += this.vtStart[i];
    this.vtList = new Uint32Array(T * 3);
    const fill = new Uint32Array(n);
    for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) { const v = this.idx[t * 3 + k]; this.vtList[this.vtStart[v] + fill[v]++] = t; }
    this.seen = new Int32Array(T);
    this.cand = new Int32Array(Math.min(T, 256));
  }

  /** Find the rest-mesh triangle hit by the ray from the rest centroid along (dx, dy, dz). Writes into `out`. */
  locate(dx: number, dy: number, dz: number, out: SurfaceHit): SurfaceHit {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const dirs = this.dirs, n = this.n;
    let best = 0, bd = -2;
    for (let i = 0; i < n; i++) {
      const d = dirs[i * 3] * dx + dirs[i * 3 + 1] * dy + dirs[i * 3 + 2] * dz;
      if (d > bd) { bd = d; best = i; }
    }
    // candidate triangles: 2-ring around the nearest vertex
    const stamp = ++this.stamp, seen = this.seen, cand = this.cand, vtS = this.vtStart, vtL = this.vtList, idx = this.idx;
    let nc = 0;
    for (let a = vtS[best]; a < vtS[best + 1]; a++) {
      const t = vtL[a];
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        for (let b = vtS[v]; b < vtS[v + 1]; b++) {
          const t2 = vtL[b];
          if (seen[t2] !== stamp && nc < cand.length) { seen[t2] = stamp; cand[nc++] = t2; }
        }
      }
    }
    const rest = this.rest, ox = this.cx, oy = this.cy, oz = this.cz;
    let bestT = -1, bestViol = 1e9, bu = 0, bv = 0;
    for (let c = 0; c < nc; c++) {
      const t = cand[c];
      const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
      const p0x = rest[i0], p0y = rest[i0 + 1], p0z = rest[i0 + 2];
      const e1x = rest[i1] - p0x, e1y = rest[i1 + 1] - p0y, e1z = rest[i1 + 2] - p0z;
      const e2x = rest[i2] - p0x, e2y = rest[i2 + 1] - p0y, e2z = rest[i2 + 2] - p0z;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det;
      const tx = ox - p0x, ty = oy - p0y, tz = oz - p0z;
      const u = (tx * px + ty * py + tz * pz) * inv;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt <= 0) continue;
      const w0 = 1 - u - v;
      const viol = Math.max(0, -w0, -u, -v);
      if (viol < bestViol) { bestViol = viol; bestT = t; bu = u; bv = v; if (viol <= 1e-6) break; }
    }
    if (bestT < 0) { // degenerate: fall back to a triangle at the nearest vertex
      bestT = vtL[vtS[best]]; bu = 1 / 3; bv = 1 / 3;
    }
    let w0 = Math.max(0, 1 - bu - bv), w1 = Math.max(0, bu), w2 = Math.max(0, bv);
    const s = w0 + w1 + w2 || 1;
    out.tri = bestT; out.u = w0 / s; out.v = w1 / s; out.w = w2 / s;
    return out;
  }
}

/**
 * Phong-tessellation point + interpolated normal for sim triangle (a3, b3, c3 = vertex index * 3) at barycentric (u, v, w).
 * Writes position into pos[po..], normal (unit) into nrm[no..]. `alpha` blends the barycentric point toward the tangent planes.
 */
export function evalSurface(
  P: ArrayLike<number>, N: ArrayLike<number>, a3: number, b3: number, c3: number,
  u: number, v: number, w: number, alpha: number,
  pos: { [i: number]: number }, po: number, nrm: { [i: number]: number }, no: number,
): void {
  const pax = P[a3], pay = P[a3 + 1], paz = P[a3 + 2];
  const pbx = P[b3], pby = P[b3 + 1], pbz = P[b3 + 2];
  const pcx = P[c3], pcy = P[c3 + 1], pcz = P[c3 + 2];
  const nax = N[a3], nay = N[a3 + 1], naz = N[a3 + 2];
  const nbx = N[b3], nby = N[b3 + 1], nbz = N[b3 + 2];
  const ncx = N[c3], ncy = N[c3 + 1], ncz = N[c3 + 2];
  const px = u * pax + v * pbx + w * pcx;
  const py = u * pay + v * pby + w * pcy;
  const pz = u * paz + v * pbz + w * pcz;
  // distance of P above each corner tangent plane; Phong point = P - sum(w_i d_i N_i)
  const da = (px - pax) * nax + (py - pay) * nay + (pz - paz) * naz;
  const db = (px - pbx) * nbx + (py - pby) * nby + (pz - pbz) * nbz;
  const dc = (px - pcx) * ncx + (py - pcy) * ncy + (pz - pcz) * ncz;
  const ua = u * da, vb = v * db, wc = w * dc;
  pos[po] = px - alpha * (ua * nax + vb * nbx + wc * ncx);
  pos[po + 1] = py - alpha * (ua * nay + vb * nby + wc * ncy);
  pos[po + 2] = pz - alpha * (ua * naz + vb * nbz + wc * ncz);
  let nx = u * nax + v * nbx + w * ncx, ny = u * nay + v * nby + w * ncy, nz = u * naz + v * nbz + w * ncz;
  const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
  nrm[no] = nx * il; nrm[no + 1] = ny * il; nrm[no + 2] = nz * il;
}

/** Area-weighted vertex normals of the sim mesh. Allocation free. */
export function simNormals(P: Float32Array, idx: Uint32Array, out: Float32Array): void {
  out.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; // |n| = 2 * area
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]);
    if (l > 1e-20) { const il = 1 / l; out[i] *= il; out[i + 1] *= il; out[i + 2] *= il; } else { out[i] = 0; out[i + 1] = 1; out[i + 2] = 0; }
  }
}

export const PHONG_ALPHA = 0.7;

export class JellyView {
  readonly mesh: THREE.Mesh;
  readonly mapper: RestMapper;
  /** Sim vertex normals, refreshed by update(). Shared with the face / glitter code. */
  readonly simN: Float32Array;
  /** Per sim vertex (inward, outward) displacement from where the rigid frame wants it, in 0..1 units of 0.45 x restRadius. */
  readonly simD: Float32Array;
  /** Deepest dent 0..1 and biggest outward bulge/pull 0..1 this frame (local deformation the global metrics can miss). */
  press = 0; pull = 0;
  // body extents refreshed by update()
  minX = 0; maxX = 0; minY = 0; maxY = 0; minZ = 0; maxZ = 0;
  fineCount = 0;
  freq = 0;
  private readonly body: SoftBodyLike;
  private geo: THREE.BufferGeometry;
  private vA = new Uint32Array(0); private vB = new Uint32Array(0); private vC = new Uint32Array(0);
  private bw = new Float32Array(0);
  private pos = new Float32Array(0); private nrm = new Float32Array(0); private strain = new Float32Array(0); private disp = new Float32Array(0);
  private posAttr!: THREE.BufferAttribute; private nrmAttr!: THREE.BufferAttribute; private strAttr!: THREE.BufferAttribute; private dispAttr!: THREE.BufferAttribute;

  constructor(body: SoftBodyLike, material: THREE.Material, freq: number) {
    this.body = body;
    this.mapper = new RestMapper(body);
    this.simN = new Float32Array(body.vertexCount * 3);
    this.simD = new Float32Array(body.vertexCount * 2);
    this.geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.rebuild(freq);
  }

  /** (Re)build the fine mesh at a geodesic frequency. Used at construction and on a tier change. */
  rebuild(freq: number): void {
    const g = buildGeodesic(freq);
    const N = g.vertexCount;
    const hit: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
    const idx = this.body.indices;
    this.vA = new Uint32Array(N); this.vB = new Uint32Array(N); this.vC = new Uint32Array(N);
    this.bw = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      this.mapper.locate(g.dirs[k * 3], g.dirs[k * 3 + 1], g.dirs[k * 3 + 2], hit);
      this.vA[k] = idx[hit.tri * 3] * 3; this.vB[k] = idx[hit.tri * 3 + 1] * 3; this.vC[k] = idx[hit.tri * 3 + 2] * 3;
      this.bw[k * 3] = hit.u; this.bw[k * 3 + 1] = hit.v; this.bw[k * 3 + 2] = hit.w;
    }
    this.pos = new Float32Array(N * 3); this.nrm = new Float32Array(N * 3); this.strain = new Float32Array(N); this.disp = new Float32Array(N * 2);
    const old = this.geo;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage);
    this.strAttr = new THREE.BufferAttribute(this.strain, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    this.dispAttr = new THREE.BufferAttribute(this.disp, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aStrain', this.strAttr);
    geo.setAttribute('aDisp', this.dispAttr);
    geo.setAttribute('aRest', new THREE.BufferAttribute(g.dirs, 3));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // never culled, never recomputed
    this.geo = geo;
    this.mesh.geometry = geo;
    old.dispose();
    this.fineCount = N;
    this.freq = Math.floor(freq);
    this.update();
  }

  /** Recompute normals and place every fine vertex. Call once per frame after body.step(). */
  update(): void {
    const body = this.body, P = body.positions, S = body.strain, sn = this.simN;
    simNormals(P, body.indices, sn);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0, n = body.vertexCount * 3; i < n; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    this.minX = x0; this.maxX = x1; this.minY = y0; this.maxY = y1; this.minZ = z0; this.maxZ = z1;
    // displacement from the rigid goal (centre + frame x rest): inward = a dent, outward = a bulge or a pull
    {
      const q = body.frame, c = body.center, R = body.restLocal;
      const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qz * qw), r02 = 2 * (qx * qz + qy * qw);
      const r10 = 2 * (qx * qy + qz * qw), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qx * qw);
      const r20 = 2 * (qx * qz - qy * qw), r21 = 2 * (qy * qz + qx * qw), r22 = 1 - 2 * (qx * qx + qy * qy);
      const k = 1 / (0.45 * body.restRadius), sD = this.simD;
      let pm = 0, um = 0;
      for (let i = 0, n = body.vertexCount; i < n; i++) {
        const i3 = i * 3;
        const rx = R[i3], ry = R[i3 + 1], rz = R[i3 + 2];
        const dx = P[i3] - (c.x + r00 * rx + r01 * ry + r02 * rz);
        const dy = P[i3 + 1] - (c.y + r10 * rx + r11 * ry + r12 * rz);
        const dz = P[i3 + 2] - (c.z + r20 * rx + r21 * ry + r22 * rz);
        const along = (dx * sn[i3] + dy * sn[i3 + 1] + dz * sn[i3 + 2]) * k;
        const inw = along < 0 ? Math.min(1, -along) : 0, out = along > 0 ? Math.min(1, along) : 0;
        sD[i * 2] = inw; sD[i * 2 + 1] = out;
        if (inw > pm) pm = inw;
        if (out > um) um = out;
      }
      this.press = pm; this.pull = um;
    }
    const pos = this.pos, nrm = this.nrm, str = this.strain, dsp = this.disp, sDsp = this.simD, vA = this.vA, vB = this.vB, vC = this.vC, bw = this.bw;
    const alpha = PHONG_ALPHA;
    for (let k = 0, n = this.fineCount; k < n; k++) {
      const a = vA[k], b = vB[k], c = vC[k];
      const u = bw[k * 3], v = bw[k * 3 + 1], w = bw[k * 3 + 2];
      evalSurface(P, sn, a, b, c, u, v, w, alpha, pos, k * 3, nrm, k * 3);
      const ia = (a / 3) | 0, ib = (b / 3) | 0, ic = (c / 3) | 0;
      str[k] = u * S[ia] + v * S[ib] + w * S[ic];
      dsp[k * 2] = u * sDsp[ia * 2] + v * sDsp[ib * 2] + w * sDsp[ic * 2];
      dsp[k * 2 + 1] = u * sDsp[ia * 2 + 1] + v * sDsp[ib * 2 + 1] + w * sDsp[ic * 2 + 1];
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.strAttr.needsUpdate = true;
    this.dispAttr.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); }
}
