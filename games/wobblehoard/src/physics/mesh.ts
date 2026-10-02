// Icosphere topology for the soft body: welded vertices, outward (counter-clockwise seen from outside) winding.
// Pure TypeScript. Detail d gives 10 * 4^d + 2 vertices: 3 -> 642, 4 -> 2562 (and 2 -> 162, used only by cheap tests).
// The vertex order is the creation order (12 icosahedron corners first, then edge midpoints level by level) and is
// deterministic, so the Gauss-Seidel edge order and every hash derived from it are reproducible.

export interface IcoMesh {
  vertexCount: number;
  /** Unit directions, xyz * vertexCount (Float64 for exactness; the rest shape is a pure function of these). */
  dirs: Float64Array;
  /** Triangles, outward winding. */
  tris: Uint32Array;
  /** Unique undirected edges as (a, b) pairs with a < b. */
  edges: Uint32Array;
}

const T = (1 + Math.sqrt(5)) / 2;

// Classic icosahedron corners / faces (faces are CCW seen from outside; verified below and flipped if not).
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

export function buildIcosphere(detail: number): IcoMesh {
  const level = Math.max(0, Math.min(6, Math.floor(Number.isFinite(detail) ? detail : 3)));
  const verts: number[] = [];
  const pushVert = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    verts.push(x / l, y / l, z / l);
    return verts.length / 3 - 1;
  };
  for (const v of BASE_V) pushVert(v[0], v[1], v[2]);

  let faces: number[] = [];
  for (const f of BASE_F) {
    // Orientation check: the triangle normal must point away from the origin.
    const a = f[0] * 3, b = f[1] * 3, c = f[2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = nx * (verts[a] + verts[b] + verts[c]) + ny * (verts[a + 1] + verts[b + 1] + verts[c + 1]) + nz * (verts[a + 2] + verts[b + 2] + verts[c + 2]);
    if (out >= 0) faces.push(f[0], f[1], f[2]); else faces.push(f[0], f[2], f[1]);
  }

  for (let l = 0; l < level; l++) {
    const cache = new Map<number, number>();
    const mid = (i: number, j: number): number => {
      const lo = i < j ? i : j, hi = i < j ? j : i;
      const key = lo * 1048576 + hi;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const k = pushVert(verts[i * 3] + verts[j * 3], verts[i * 3 + 1] + verts[j * 3 + 1], verts[i * 3 + 2] + verts[j * 3 + 2]);
      cache.set(key, k);
      return k;
    };
    const next: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f], b = faces[f + 1], c = faces[f + 2];
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }

  const vertexCount = verts.length / 3;
  const tris = Uint32Array.from(faces);

  const seen = new Set<number>();
  const edgeList: number[] = [];
  for (let f = 0; f < tris.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tris[f + k], b = tris[f + ((k + 1) % 3)];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = lo * 1048576 + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      edgeList.push(lo, hi);
    }
  }
  return { vertexCount, dirs: Float64Array.from(verts), tris, edges: Uint32Array.from(edgeList) };
}
