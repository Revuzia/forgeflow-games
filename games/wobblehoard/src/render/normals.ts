// Sim-mesh vertex normals (area-weighted, then relaxed over the triangle neighbours), whole-mesh and list-restricted versions. Allocation free. Shared by jelly.ts (every frame) and
// pieceBuild.ts (the rest-pose normals of a piece and of its whole, for the rim-normal correction).

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

/**
 * One relaxation pass of the sim vertex normals over their triangle neighbours: the physics mesh has creases where a finger
 * sphere pushes particles out (coarse straight edges), which the glossy low tier shows as a hard seam. `acc` is scratch.
 * Allocation free: no Math.hypot here (it boxes its arguments: ~266 KB per body per frame for two passes, VERIFY_RENDER_A R-A5).
 */
export function relaxNormals(N: Float32Array, idx: Uint32Array, acc: Float32Array, w: number): void {
  acc.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    acc[a] += N[b] + N[c]; acc[a + 1] += N[b + 1] + N[c + 1]; acc[a + 2] += N[b + 2] + N[c + 2];
    acc[b] += N[a] + N[c]; acc[b + 1] += N[a + 1] + N[c + 1]; acc[b + 2] += N[a + 2] + N[c + 2];
    acc[c] += N[a] + N[b]; acc[c + 1] += N[a + 1] + N[b + 1]; acc[c + 2] += N[a + 2] + N[b + 2];
  }
  for (let i = 0; i < N.length; i += 3) {
    const al = Math.sqrt(acc[i] * acc[i] + acc[i + 1] * acc[i + 1] + acc[i + 2] * acc[i + 2]) || 1;   // (Math.hypot boxes its arguments: ~133 KB of garbage per body per pass per frame)
    const x = N[i] * (1 - w) + (acc[i] / al) * w, y = N[i + 1] * (1 - w) + (acc[i + 1] / al) * w, z = N[i + 2] * (1 - w) + (acc[i + 2] / al) * w;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l;
  }
}

/** simNormals over a LIST of sim triangles only (a piece's skin triangles, or one cut face's): a rim vertex's skin normal then knows nothing of the face and the face normal nothing of the skin (CUT2 8.2). */
export function simNormalsList(P: Float32Array, idx: Uint32Array, tris: Uint32Array, out: Float32Array): void {
  out.fill(0);
  for (let q = 0; q < tris.length; q++) {
    const t = tris[q] * 3, a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]);
    if (l > 1e-20) { const il = 1 / l; out[i] *= il; out[i + 1] *= il; out[i + 2] *= il; } else { out[i] = 0; out[i + 1] = 1; out[i + 2] = 0; }
  }
}
/** relaxNormals over a list of sim triangles only (vertices outside the list keep their normal). */
export function relaxNormalsList(N: Float32Array, idx: Uint32Array, tris: Uint32Array, acc: Float32Array, w: number): void {
  acc.fill(0);
  for (let q = 0; q < tris.length; q++) {
    const t = tris[q] * 3, a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    acc[a] += N[b] + N[c]; acc[a + 1] += N[b + 1] + N[c + 1]; acc[a + 2] += N[b + 2] + N[c + 2];
    acc[b] += N[a] + N[c]; acc[b + 1] += N[a + 1] + N[c + 1]; acc[b + 2] += N[a + 2] + N[c + 2];
    acc[c] += N[a] + N[b]; acc[c + 1] += N[a + 1] + N[b + 1]; acc[c + 2] += N[a + 2] + N[b + 2];
  }
  for (let i = 0; i < N.length; i += 3) {
    const al = Math.sqrt(acc[i] * acc[i] + acc[i + 1] * acc[i + 1] + acc[i + 2] * acc[i + 2]);
    if (al < 1e-20) continue;
    const x = N[i] * (1 - w) + (acc[i] / al) * w, y = N[i + 1] * (1 - w) + (acc[i + 1] / al) * w, z = N[i + 2] * (1 - w) + (acc[i + 2] / al) * w;
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l;
  }
}
