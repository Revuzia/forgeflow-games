// GENESIS — signed-distance modelling for organic hero meshes (CONTRACT.md §15.6: the god hand and the creatures).
//
// Blender is not in the build container, so the hand (gen/handgen.ts) and the creatures (gen/creaturegen.ts) are
// modelled as implicit surfaces: round cones, ellipsoids and capsules blended with smooth unions (webbing between the
// fingers, a belly flowing into the haunches, knuckles, pads, a tortoise's shell rim), then polygonised once with
// naive SURFACE NETS on a regular grid. Each vertex is projected onto the surface with Newton steps and takes its
// normal from the field's gradient, so the mesh is smooth and seamless (no tube joints, no T-junctions) at any pose.
// Skinning weights come from distances to bone segments (inverse distance to a high power: rigid along a bone, a
// blend of about one bone radius across a joint, negligible between neighbouring fingers).
//
// Speed: the field is evaluated on a coarse grid first; only coarse cells the surface can pass through (|d| under the
// cell's diagonal on some corner, the field being ~1-Lipschitz) are refined, so a 100+ cell-wide hand costs a few
// hundred thousand field evaluations, not millions.

export type V3 = [number, number, number];

/** a scalar field: negative inside */
export type Sdf = (x: number, y: number, z: number) => number;

export interface SdfMesh {
  /** xyz per vertex */
  pos: Float32Array;
  /** unit normal per vertex (field gradient) */
  nrm: Float32Array;
  index: Uint32Array;
  vertexCount: number;
}

// ───────────────────────────── primitives ─────────────────────────────

/** polynomial smooth minimum (k = blend radius) */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** smooth maximum (smooth subtraction: smax(a, -b, k)) */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** exact round-cone distance: a sphere of radius ra at a swept to rb at b (iq) */
export function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, ra: number, rb: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-12) { const dx = px - a[0], dy = py - a[1], dz = pz - a[2]; return Math.sqrt(dx * dx + dy * dy + dz * dz) - Math.max(ra, rb); }
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
}

/** capsule distance */
export function sdCapsule(px: number, py: number, pz: number, a: V3, b: V3, r: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const l2 = bax * bax + bay * bay + baz * baz || 1e-12;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / l2));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** an oriented frame (unit axes) for ellipsoids and boxes */
export interface Frame { c: V3; u: V3; v: V3; w: V3 }

export function frame(c: V3, w: V3, upHint: V3 = [0, 1, 0]): Frame {
  const wl = Math.hypot(w[0], w[1], w[2]) || 1;
  const W: V3 = [w[0] / wl, w[1] / wl, w[2] / wl];
  let ux = upHint[1] * W[2] - upHint[2] * W[1], uy = upHint[2] * W[0] - upHint[0] * W[2], uz = upHint[0] * W[1] - upHint[1] * W[0];
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; ul = 1; }
  const U: V3 = [ux / ul, uy / ul, uz / ul];
  const V: V3 = [W[1] * U[2] - W[2] * U[1], W[2] * U[0] - W[0] * U[2], W[0] * U[1] - W[1] * U[0]];
  return { c, u: U, v: V, w: W };
}

/**
 * Ellipsoid distance (iq's bound, good near the surface) in a frame: radii along u, v, w.
 * With no frame the axes are x, y, z.
 */
export function sdEllipsoid(px: number, py: number, pz: number, c: V3, r: V3, f?: Frame): number {
  let x = px - c[0], y = py - c[1], z = pz - c[2];
  if (f) {
    const lx = x * f.u[0] + y * f.u[1] + z * f.u[2];
    const ly = x * f.v[0] + y * f.v[1] + z * f.v[2];
    const lz = x * f.w[0] + y * f.w[1] + z * f.w[2];
    x = lx; y = ly; z = lz;
  }
  const ax = x / r[0], ay = y / r[1], az = z / r[2];
  const bx = ax / r[0], by = ay / r[1], bz = az / r[2];
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
  return (k0 * (k0 - 1)) / k1;
}

/** rounded box in a frame: half extents e (along u, v, w), corner radius rr */
export function sdRoundBox(px: number, py: number, pz: number, f: Frame, e: V3, rr: number): number {
  const x = px - f.c[0], y = py - f.c[1], z = pz - f.c[2];
  const lx = Math.abs(x * f.u[0] + y * f.u[1] + z * f.u[2]) - e[0] + rr;
  const ly = Math.abs(x * f.v[0] + y * f.v[1] + z * f.v[2]) - e[1] + rr;
  const lz = Math.abs(x * f.w[0] + y * f.w[1] + z * f.w[2]) - e[2] + rr;
  const ox = Math.max(lx, 0), oy = Math.max(ly, 0), oz = Math.max(lz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(lx, ly, lz), 0) - rr;
}

/** distance from p to the segment ab, and the parameter along it (0 at a, 1 at b; unclamped in `t`) */
export function segDist(px: number, py: number, pz: number, a: V3, b: V3, out?: { t: number }): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const l2 = bax * bax + bay * bay + baz * baz || 1e-12;
  const t = (pax * bax + pay * bay + paz * baz) / l2;
  if (out) out.t = t;
  const h = Math.min(1, Math.max(0, t));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ───────────────────────────── surface nets ─────────────────────────────

/**
 * Polygonise the zero set of `f` inside [bmin, bmax] with cell size h. Returns smooth, indexed triangles (CCW seen
 * from outside), each vertex projected onto the surface.
 */
export function meshSdf(f: Sdf, bmin: V3, bmax: V3, h: number, project = 2): SdfMesh {
  const nx = Math.max(2, Math.ceil((bmax[0] - bmin[0]) / h) + 1);
  const ny = Math.max(2, Math.ceil((bmax[1] - bmin[1]) / h) + 1);
  const nz = Math.max(2, Math.ceil((bmax[2] - bmin[2]) / h) + 1);
  const ox = bmin[0], oy = bmin[1], oz = bmin[2];
  const sxy = nx * ny;
  const val = new Float32Array(nx * ny * nz);
  // coarse pass (stride S), then refine near the surface
  const S = 4;
  const cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) {
    const z = oz + Math.min(nz - 1, k * S) * h;
    for (let j = 0; j < cy; j++) {
      const y = oy + Math.min(ny - 1, j * S) * h;
      for (let i = 0; i < cx; i++) coarse[i + cx * (j + cy * k)] = f(ox + Math.min(nx - 1, i * S) * h, y, z);
    }
  }
  const diag = S * h * 1.8;
  const done = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < cz - 1; k++) for (let j = 0; j < cy - 1; j++) for (let i = 0; i < cx - 1; i++) {
    const i0 = i * S, j0 = j * S, k0 = k * S;
    const i1 = Math.min(nx - 1, i0 + S), j1 = Math.min(ny - 1, j0 + S), k1 = Math.min(nz - 1, k0 + S);
    const c000 = coarse[i + cx * (j + cy * k)], c100 = coarse[i + 1 + cx * (j + cy * k)];
    const c010 = coarse[i + cx * (j + 1 + cy * k)], c110 = coarse[i + 1 + cx * (j + 1 + cy * k)];
    const c001 = coarse[i + cx * (j + cy * (k + 1))], c101 = coarse[i + 1 + cx * (j + cy * (k + 1))];
    const c011 = coarse[i + cx * (j + 1 + cy * (k + 1))], c111 = coarse[i + 1 + cx * (j + 1 + cy * (k + 1))];
    const mn = Math.min(Math.abs(c000), Math.abs(c100), Math.abs(c010), Math.abs(c110), Math.abs(c001), Math.abs(c101), Math.abs(c011), Math.abs(c111));
    const allPos = c000 > 0 && c100 > 0 && c010 > 0 && c110 > 0 && c001 > 0 && c101 > 0 && c011 > 0 && c111 > 0;
    const allNeg = c000 < 0 && c100 < 0 && c010 < 0 && c110 < 0 && c001 < 0 && c101 < 0 && c011 < 0 && c111 < 0;
    const exact = !(mn > diag && (allPos || allNeg));
    const di = Math.max(1, i1 - i0), dj = Math.max(1, j1 - j0), dk = Math.max(1, k1 - k0);
    for (let kk = k0; kk <= k1; kk++) {
      const tz = (kk - k0) / dk;
      for (let jj = j0; jj <= j1; jj++) {
        const ty = (jj - j0) / dj;
        for (let ii = i0; ii <= i1; ii++) {
          const id = ii + nx * jj + sxy * kk;
          if (done[id] === 2 || (done[id] === 1 && !exact)) continue;
          if (exact) {
            val[id] = f(ox + ii * h, oy + jj * h, oz + kk * h);
            done[id] = 2;
          } else {
            const tx = (ii - i0) / di;
            const a = c000 + (c100 - c000) * tx, b = c010 + (c110 - c010) * tx;
            const c = c001 + (c101 - c001) * tx, d = c011 + (c111 - c011) * tx;
            const e = a + (b - a) * ty, g = c + (d - c) * ty;
            val[id] = e + (g - e) * tz;
            done[id] = 1;
          }
        }
      }
    }
  }
  // vertices: one per cell the surface crosses, at the mean of its edge crossings
  const mx = nx - 1, my = ny - 1;
  const cellV = new Int32Array(mx * my * (nz - 1)).fill(-1);
  const P: number[] = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = val[i + CO[c][0] + nx * (j + CO[c][1]) + sxy * (k + CO[c][2])];
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t;
      sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t;
      sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t;
      n++;
    }
    cellV[i + mx * (j + my * k)] = P.length / 3;
    P.push(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
  }
  // faces: a quad around every grid edge with a sign change, from the four cells that share it
  const I: number[] = [];
  return finish(f, P, I, nx, ny, nz, mx, my, val, cellV, ox, oy, oz, h, project);
}

/** faces (a quad around every sign-changing grid edge, from the four cells sharing it), projection and normals */
function finish(f: Sdf, P: number[], I: number[], nx: number, ny: number, nz: number, mx: number, my: number, val: Float32Array, cellV: Int32Array, _ox: number, _oy: number, _oz: number, h: number, project: number): SdfMesh {
  const sxy = nx * ny;
  const mz = nz - 1;
  const cellAt = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= mx || j >= my || k >= mz ? -1 : cellV[i + mx * (j + my * k)]);
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { const t = b; b = d; d = t; }
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac <= dbd) I.push(a, b, c, a, c, d);
    else I.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = val[i + nx * j + sxy * k];
    const in0 = v0 < 0;
    if (i + 1 < nx && (val[i + 1 + nx * j + sxy * k] < 0) !== in0) quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k), !in0);
    if (j + 1 < ny && (val[i + nx * (j + 1) + sxy * k] < 0) !== in0) quad(cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), cellAt(i, j, k), cellAt(i, j, k - 1), !in0);
    if (k + 1 < nz && (val[i + nx * j + sxy * (k + 1)] < 0) !== in0) quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k), !in0);
  }
  // project onto the surface and take the normal from the gradient (tetrahedral differences: 4 samples)
  const n = P.length / 3;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const e = h * 0.35;
  for (let v = 0; v < n; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let gx = 0, gy = 0, gz = 1;
    for (let it = 0; it <= project; it++) {
      const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d4 = f(x + e, y + e, z + e);
      gx = a - b - c + d4; gy = -a - b + c + d4; gz = -a + b - c + d4;
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      if (it === project) break;
      // the field at the centre is the mean of the four samples (to second order)
      const d = (a + b + c + d4) * 0.25;
      // never move a vertex further than its cell (a thin feature's gradient can point anywhere)
      const step = Math.max(-h, Math.min(h, d));
      x -= gx * step; y -= gy * step; z -= gz * step;
    }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
  }
  return { pos, nrm, index: Uint32Array.from(I), vertexCount: n };
}

// ───────────────────────────── skinning ─────────────────────────────

export interface BoneSeg {
  /** segment the bone's flesh lies along (bind pose) */
  a: V3;
  b: V3;
  /** typical flesh radius around it (distances are measured in radii, so thick and thin bones compete fairly) */
  r: number;
  /** skinning group: a vertex blends only between bones of its nearest bone's group and that group's links */
  group?: number;
}

/**
 * Four skin indices and weights per vertex: w_i ∝ (r_i / d_i)^p over the bones, the strongest four kept. A high power
 * keeps bones rigid along their length and blends over about one radius across a joint; neighbouring fingers barely
 * pull on each other. `allow(i, j)` can forbid a bone j for a vertex whose nearest bone is i.
 */
export function skinWeights(pos: Float32Array, bones: BoneSeg[], power = 8, allow?: (nearest: number, other: number) => boolean): { index: Uint16Array; weight: Float32Array } {
  const n = pos.length / 3;
  const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
  const d = new Float64Array(bones.length);
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let best = 0, bd = Infinity;
    for (let b = 0; b < bones.length; b++) {
      const bo = bones[b];
      const dd = Math.max(1e-4, segDist(x, y, z, bo.a, bo.b)) / bo.r;
      d[b] = dd;
      if (dd < bd) { bd = dd; best = b; }
    }
    const top = [-1, -1, -1, -1], tw = [0, 0, 0, 0];
    for (let b = 0; b < bones.length; b++) {
      if (allow && b !== best && !allow(best, b)) continue;
      const w = Math.pow(bd / d[b], power);
      if (w < 1e-4) continue;
      // insert into the top four
      let slot = -1;
      for (let s = 0; s < 4; s++) if (top[s] < 0 || w > tw[s]) { slot = s; break; }
      if (slot < 0) continue;
      for (let s = 3; s > slot; s--) { top[s] = top[s - 1]; tw[s] = tw[s - 1]; }
      top[slot] = b; tw[slot] = w;
    }
    let sum = 0;
    for (let s = 0; s < 4; s++) if (top[s] >= 0) sum += tw[s];
    for (let s = 0; s < 4; s++) {
      idx[v * 4 + s] = top[s] >= 0 ? top[s] : 0;
      wt[v * 4 + s] = top[s] >= 0 ? tw[s] / sum : 0;
    }
  }
  return { index: idx, weight: wt };
}

/** Laplacian smoothing of a per-vertex attribute over the mesh edges (softens weight seams), `iters` passes */
export function smoothAttribute(index: Uint32Array, n: number, data: Float32Array, stride: number, iters: number, k = 0.5): void {
  const acc = new Float32Array(n * stride), cnt = new Float32Array(n);
  for (let it = 0; it < iters; it++) {
    acc.fill(0); cnt.fill(0);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        for (let s = 0; s < stride; s++) { acc[p * stride + s] += data[q * stride + s]; acc[q * stride + s] += data[p * stride + s]; }
        cnt[p]++; cnt[q]++;
      }
    }
    for (let v = 0; v < n; v++) {
      if (!cnt[v]) continue;
      for (let s = 0; s < stride; s++) data[v * stride + s] += (acc[v * stride + s] / cnt[v] - data[v * stride + s]) * k;
    }
  }
}
