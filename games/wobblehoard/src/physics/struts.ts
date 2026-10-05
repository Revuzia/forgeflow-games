// Interior chords ("struts") through the thin floppy parts of a rest shape. Pure TypeScript, run once at construction.
//
// WHY. The soft body is a closed SKIN: particles on the surface only, nothing inside. For the round dome that is fine (the enclosed-volume
// constraint stands in for the jelly inside), but a thin feature such as the swirl-peak has almost no volume of its own, so nothing holds
// its two walls apart: a fingertip wider than the feature drags the near wall over the far one, the cone's walls collapse onto each other
// and the skin folds (adjacent triangles at 130-180 degrees, the 'hard side shove' row of the probe). A real jelly peak is SOLID; these
// chords are its interior. Each one joins two surface vertices of the same thin part straight through the inside and is one-sided
// (softbody.ts strutPass: it only resists being shortened below params.strutMin of its rest length), so it stores no energy at rest,
// never stiffens a stretch, a bend or a flop, and only acts when a wall is being pushed onto the opposite one.
import type { IcoMesh } from './mesh.ts';

export interface Struts {
  count: number;
  /** strut endpoints (a, b per strut), vertex indices pre-multiplied by 3 */
  ends3: Int32Array;
  /** rest lengths */
  rest: Float64Array;
}

/**
 * The struts of a rest shape `Q` (rest-local positions, 3 per vertex): for every vertex whose floppy weight is >= `tau`, up to
 * `perVertex` chords to other such vertices that are not its mesh neighbours, are at most `maxLen` long, leave BOTH ends into the body
 * (the chord direction is at least `cosIn` below each end's tangent plane, measured against the area-weighted vertex normal) and cross
 * no triangle of the rest surface (so they run through the inside, not across a concavity). Preference goes to the chord that leaves the
 * vertex most nearly along its inward normal (the opposite wall). The result is deterministic (fixed scan order, stable sort).
 */
export function buildStruts(Q: Float64Array, mesh: IcoMesh, floppy: ArrayLike<number>, tau: number, maxLen: number, perVertex: number, cosIn: number): Struts {
  const n = mesh.vertexCount, tris = mesh.tris, nt = tris.length / 3;
  const cand: number[] = [];
  for (let i = 0; i < n; i++) if (floppy[i] >= tau) cand.push(i);
  if (cand.length < 2 || !(maxLen > 0) || !(perVertex >= 1)) return { count: 0, ends3: new Int32Array(0), rest: new Float64Array(0) };
  // area-weighted vertex normals of the rest surface
  const vn = new Float64Array(n * 3);
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], wx = Q[c] - Q[a], wy = Q[c + 1] - Q[a + 1], wz = Q[c + 2] - Q[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    vn[a] += nx; vn[a + 1] += ny; vn[a + 2] += nz; vn[b] += nx; vn[b + 1] += ny; vn[b + 2] += nz; vn[c] += nx; vn[c + 1] += ny; vn[c + 2] += nz;
  }
  const len3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);   // (Math.hypot is ~20x slower in V8)
  for (let i = 0; i < n; i++) {
    const l = len3(vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]) || 1;
    vn[i * 3] /= l; vn[i * 3 + 1] /= l; vn[i * 3 + 2] /= l;
  }
  const adjacent = new Set<number>();
  for (let e = 0; e < mesh.edges.length; e += 2) { const a = mesh.edges[e], b = mesh.edges[e + 1]; adjacent.add(a * n + b); adjacent.add(b * n + a); }
  // triangle bounding spheres (centroid + radius) for the crossing test
  const ts = new Float64Array(nt * 4);
  for (let t = 0; t < nt; t++) {
    const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
    const cx = (Q[a] + Q[b] + Q[c]) / 3, cy = (Q[a + 1] + Q[b + 1] + Q[c + 1]) / 3, cz = (Q[a + 2] + Q[b + 2] + Q[c + 2]) / 3;
    ts[t * 4] = cx; ts[t * 4 + 1] = cy; ts[t * 4 + 2] = cz;
    ts[t * 4 + 3] = Math.max(len3(Q[a] - cx, Q[a + 1] - cy, Q[a + 2] - cz), len3(Q[b] - cx, Q[b + 1] - cy, Q[b + 2] - cz), len3(Q[c] - cx, Q[c + 1] - cy, Q[c + 2] - cz));
  }
  // the triangles a chord can cross: near the candidates (a box test once, then a ball test per vertex: a chord from i stays within maxLen of i)
  const nearAll: number[] = [], near: number[] = [];
  {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const i of cand) {
      const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    for (let t = 0; t < nt; t++) {
      const m = maxLen + ts[t * 4 + 3], x = ts[t * 4], y = ts[t * 4 + 1], z = ts[t * 4 + 2];
      if (x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m && z >= z0 - m && z <= z1 + m) nearAll.push(t);
    }
  }
  /** Does the open segment i -> j pass through a triangle (of `near`) that does not touch i or j? (Moller-Trumbore, both faces) */
  const crosses = (i: number, j: number): boolean => {
    const ox = Q[i * 3], oy = Q[i * 3 + 1], oz = Q[i * 3 + 2], dx = Q[j * 3] - ox, dy = Q[j * 3 + 1] - oy, dz = Q[j * 3 + 2] - oz;
    for (const t of near) {
      const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
      if (a === i || b === i || c === i || a === j || b === j || c === j) continue;
      const a3 = a * 3, b3 = b * 3, c3 = c * 3;
      const e1x = Q[b3] - Q[a3], e1y = Q[b3 + 1] - Q[a3 + 1], e1z = Q[b3 + 2] - Q[a3 + 2], e2x = Q[c3] - Q[a3], e2y = Q[c3 + 1] - Q[a3 + 1], e2z = Q[c3 + 2] - Q[a3 + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det, tx = ox - Q[a3], ty = oy - Q[a3 + 1], tz = oz - Q[a3 + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (s > 1e-9 && s < 1 - 1e-9) return true;
    }
    return false;
  };
  const pairs = new Map<number, number>();
  const ranked: Array<[number, number]> = [];
  for (const i of cand) {
    const i3 = i * 3;
    ranked.length = 0;
    for (const j of cand) {
      if (j === i || adjacent.has(i * n + j)) continue;
      const dx = Q[j * 3] - Q[i3], dy = Q[j * 3 + 1] - Q[i3 + 1], dz = Q[j * 3 + 2] - Q[i3 + 2];
      const L = len3(dx, dy, dz);
      if (!(L <= maxLen) || L < 1e-12) continue;
      const si = -(vn[i3] * dx + vn[i3 + 1] * dy + vn[i3 + 2] * dz) / L;         // how steeply it leaves i into the body
      const sj = (vn[j * 3] * dx + vn[j * 3 + 1] * dy + vn[j * 3 + 2] * dz) / L;  // ... and j
      if (si < cosIn || sj < cosIn) continue;
      ranked.push([si, j]);
    }
    if (ranked.length === 0) continue;
    ranked.sort((x, y) => y[0] - x[0]);
    near.length = 0;
    for (const t of nearAll) {
      const dx = ts[t * 4] - Q[i3], dy = ts[t * 4 + 1] - Q[i3 + 1], dz = ts[t * 4 + 2] - Q[i3 + 2], m = maxLen + ts[t * 4 + 3];
      if (dx * dx + dy * dy + dz * dz <= m * m) near.push(t);
    }
    let k = 0;
    for (const [, j] of ranked) {
      if (k >= perVertex) break;
      if (crosses(i, j)) continue;
      const key = i < j ? i * n + j : j * n + i;
      if (!pairs.has(key)) pairs.set(key, len3(Q[i3] - Q[j * 3], Q[i3 + 1] - Q[j * 3 + 1], Q[i3 + 2] - Q[j * 3 + 2]));
      k++;
    }
  }
  const keys = [...pairs.keys()].sort((x, y) => x - y);
  const count = keys.length, ends3 = new Int32Array(count * 2), rest = new Float64Array(count);
  for (let k = 0; k < count; k++) { const key = keys[k]; ends3[k * 2] = Math.floor(key / n) * 3; ends3[k * 2 + 1] = (key % n) * 3; rest[k] = pairs.get(key)!; }
  return { count, ends3, rest };
}
