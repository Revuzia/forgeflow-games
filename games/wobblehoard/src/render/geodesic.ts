// Geodesic sphere of arbitrary frequency n (10 n^2 + 2 vertices): n = 8 -> 642, 16 -> 2562, 24 -> 5762, 32 -> 10242.
// Used for the FINE render mesh (frequency picked per quality tier) and, in the dev stub body, for the sim mesh.
// Pure TypeScript, deterministic. Triangles are wound counter-clockwise seen from outside.

export interface GeoMesh {
  vertexCount: number;
  /** Unit directions, xyz * vertexCount. */
  dirs: Float32Array;
  /** Triangles, outward winding. Uint16Array while vertexCount < 65536, else Uint32Array. */
  indices: Uint16Array | Uint32Array;
}

const T = (1 + Math.sqrt(5)) / 2;
const BASE_V: number[][] = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
];
const BASE_F: number[][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

export function buildGeodesic(freq: number): GeoMesh {
  const n = Math.max(1, Math.min(48, Math.floor(freq)));
  const verts: number[] = [];
  const keyToIndex = new Map<number, number>();
  const q = 20000; // quantisation for welding shared edge vertices
  const keyOf = (x: number, y: number, z: number): number => {
    const a = Math.round(x * q) + q, b = Math.round(y * q) + q, c = Math.round(z * q) + q;
    return (a * 40001 + b) * 40001 + c; // < 2^53 for q = 20000
  };
  const vertexAt = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    x /= l; y /= l; z /= l;
    const key = keyOf(x, y, z);
    const hit = keyToIndex.get(key);
    if (hit !== undefined) return hit;
    const idx = verts.length / 3;
    verts.push(x, y, z);
    keyToIndex.set(key, idx);
    return idx;
  };

  const tris: number[] = [];
  const grid = new Int32Array((n + 1) * (n + 1));
  for (const f of BASE_F) {
    let A = BASE_V[f[0]], B = BASE_V[f[1]], C = BASE_V[f[2]];
    // orientation: face normal must point away from the origin
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * (A[0] + B[0] + C[0]) + ny * (A[1] + B[1] + C[1]) + nz * (A[2] + B[2] + C[2]) < 0) { const t = B; B = C; C = t; }
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const k = n - i - j;
        grid[i * (n + 1) + j] = vertexAt(
          (A[0] * k + B[0] * i + C[0] * j) / n,
          (A[1] * k + B[1] * i + C[1] * j) / n,
          (A[2] * k + B[2] * i + C[2] * j) / n,
        );
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; i + j < n; j++) {
        const p00 = grid[i * (n + 1) + j], p10 = grid[(i + 1) * (n + 1) + j], p01 = grid[i * (n + 1) + j + 1];
        tris.push(p00, p10, p01);
        if (i + j < n - 1) {
          const p11 = grid[(i + 1) * (n + 1) + j + 1];
          tris.push(p10, p11, p01);
        }
      }
    }
  }
  const vertexCount = verts.length / 3;
  const indices = vertexCount < 65536 ? Uint16Array.from(tris) : Uint32Array.from(tris);
  return { vertexCount, dirs: Float32Array.from(verts), indices };
}
