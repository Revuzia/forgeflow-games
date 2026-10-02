// Small allocation-free math helpers for the soft body (typed-array scratch in, typed-array scratch out).

/**
 * Rotation extraction for shape matching: Mueller, Bender, Chentanez, Macklin, "A Robust Method to Extract the
 * Rotational Part of Deformations" (MIG 2016). `A` is the 3x3 covariance sum m (p - c) q^T, row-major: A[i*3+j] =
 * sum m p_i q_j. `q` is the unit quaternion (x, y, z, w) of the rotation mapping REST -> CURRENT; it is used as the
 * warm start and updated in place (a couple of iterations per substep are enough because the body barely rotates
 * between substeps). Never returns NaN: a degenerate A leaves q unchanged.
 */
export function extractRotation(A: Float64Array, q: Float64Array, iters: number): void {
  const a00 = A[0], a01 = A[1], a02 = A[2], a10 = A[3], a11 = A[4], a12 = A[5], a20 = A[6], a21 = A[7], a22 = A[8];
  for (let it = 0; it < iters; it++) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz), r02 = 2 * (xz + wy);
    const r10 = 2 * (xy + wz), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wx);
    const r20 = 2 * (xz - wy), r21 = 2 * (yz + wx), r22 = 1 - 2 * (xx + yy);
    // sum over columns k of (R_k x A_k)
    const cx = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12);
    const cy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22);
    const cz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02);
    const dot = r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22;
    const inv = 1 / (Math.abs(dot) + 1e-9);
    const ox = cx * inv, oy = cy * inv, oz = cz * inv;
    const mag = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (!(mag > 1e-9)) break;
    const half = 0.5 * Math.min(mag, 3.0);
    const s = Math.sin(half) / mag;
    const dx = ox * s, dy = oy * s, dz = oz * s, dw = Math.cos(half);
    const nw = dw * w - dx * x - dy * y - dz * z;
    const nx = dw * x + dx * w + dy * z - dz * y;
    const ny = dw * y - dx * z + dy * w + dz * x;
    const nz = dw * z + dx * y - dy * x + dz * w;
    const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    if (!(il > 0) || !Number.isFinite(il)) break;
    q[0] = nx * il; q[1] = ny * il; q[2] = nz * il; q[3] = nw * il;
  }
}

/** Rotation matrix (row-major, 9) of a unit quaternion. */
export function quatToMat(q: ArrayLike<number>, m: Float64Array): void {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
}

/**
 * Nearest front-facing hit of a ray against an indexed triangle mesh (Moller-Trumbore). The ray is origin + dir * t,
 * t >= 0, in the units of `dir` (it need not be normalised). Writes [t, triangle, u, v] into `out` and returns true on a hit.
 * Back faces are culled (outward winding), so a ray that starts inside the mesh sees the far wall from inside as a miss.
 */
export function rayMesh(
  pos: ArrayLike<number>, tris: Uint32Array,
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  out: Float64Array,
): boolean {
  let bestT = Infinity, bestTri = -1, bestU = 0, bestV = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const v0x = pos[a], v0y = pos[a + 1], v0z = pos[a + 2];
    const e1x = pos[b] - v0x, e1y = pos[b + 1] - v0y, e1z = pos[b + 2] - v0z;
    const e2x = pos[c] - v0x, e2y = pos[c + 1] - v0y, e2z = pos[c + 2] - v0z;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det < 1e-14) continue; // back-facing or parallel
    const inv = 1 / det;
    const tx = ox - v0x, ty = oy - v0y, tz = oz - v0z;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (tt < 0 || tt >= bestT) continue;
    bestT = tt; bestTri = t / 3; bestU = u; bestV = v;
  }
  if (bestTri < 0) return false;
  out[0] = bestT; out[1] = bestTri; out[2] = bestU; out[3] = bestV;
  return true;
}
