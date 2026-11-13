/**
 * CHROMA HIDE — runtime/sim/nav.js
 * PURE grid navigation (no three, no DOM). Multi-room maps have interior walls
 * with doorway gaps, so a bot's simple move-toward gets stuck against a wall.
 * We rasterize the obstacles into a coarse walkability grid and BFS a path that
 * threads doorways. Node-testable; used by match_sim for bot movement.
 */
import { clamp } from "./util.js";

/** Build a walkability grid. Cells within `radius` of any obstacle AABB (or out
 *  of bounds) are blocked. cell ~= half a body width for smooth paths. */
export function buildNavGrid(bounds, obstacles, cell = 1.0, radius = 0.55) {
  const w = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const h = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
  const grid = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = bounds.minX + (i + 0.5) * cell;
      const z = bounds.minZ + (j + 0.5) * cell;
      let ok = 1;
      for (const o of obstacles) {
        if (Math.abs(x - o.x) < o.hw + radius && Math.abs(z - o.z) < o.hd + radius) { ok = 0; break; }
      }
      grid[j * w + i] = ok;
    }
  }
  return { grid, w, h, cell, minX: bounds.minX, minZ: bounds.minZ, bounds };
}

function idx(nav, i, j) { return j * nav.w + i; }
export function cellOf(nav, x, z) {
  return [clamp(Math.floor((x - nav.minX) / nav.cell), 0, nav.w - 1), clamp(Math.floor((z - nav.minZ) / nav.cell), 0, nav.h - 1)];
}
function center(nav, i, j) { return { x: nav.minX + (i + 0.5) * nav.cell, z: nav.minZ + (j + 0.5) * nav.cell }; }
function walkable(nav, i, j) { return i >= 0 && j >= 0 && i < nav.w && j < nav.h && nav.grid[idx(nav, i, j)] === 1; }

/** Nearest walkable cell to (x,z) — actors sometimes stand inside a blocked cell. */
function nearestWalkable(nav, x, z) {
  let [ci, cj] = cellOf(nav, x, z);
  if (walkable(nav, ci, cj)) return [ci, cj];
  for (let r = 1; r < Math.max(nav.w, nav.h); r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (walkable(nav, ci + di, cj + dj)) return [ci + di, cj + dj];
    }
  }
  return [ci, cj];
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** True if (tx,tz)'s cell is reachable from (sx,sz)'s cell across walkable cells. */
export function isReachable(nav, sx, sz, tx, tz) {
  const [si, sj] = nearestWalkable(nav, sx, sz);
  const [ti, tj] = nearestWalkable(nav, tx, tz);
  if (si === ti && sj === tj) return true;
  const seen = new Uint8Array(nav.w * nav.h);
  const q = [[si, sj]]; seen[sj * nav.w + si] = 1;
  let head = 0;
  while (head < q.length) {
    const [ci, cj] = q[head++];
    if (ci === ti && cj === tj) return true;
    for (const [di, dj] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (!walkable(nav, ni, nj) || seen[nj * nav.w + ni]) continue;
      if (di && dj && (!walkable(nav, ci + di, cj) || !walkable(nav, ci, cj + dj))) continue;
      seen[nj * nav.w + ni] = 1; q.push([ni, nj]);
    }
  }
  return false;
}

/** BFS path from (sx,sz) to (tx,tz). Returns simplified waypoints [{x,z}] incl. the
 *  final target, or a single-point [{target}] if already there / unreachable. */
export function findPath(nav, sx, sz, tx, tz) {
  const [si, sj] = nearestWalkable(nav, sx, sz);
  const [ti, tj] = nearestWalkable(nav, tx, tz);
  if (si === ti && sj === tj) return [{ x: tx, z: tz }];
  const n = nav.w * nav.h;
  const prev = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const q = [idx(nav, si, sj)]; seen[q[0]] = 1;
  let head = 0, found = false; const goal = idx(nav, ti, tj);
  while (head < q.length) {
    const cur = q[head++];
    if (cur === goal) { found = true; break; }
    const ci = cur % nav.w, cj = (cur / nav.w) | 0;
    for (const [di, dj] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (!walkable(nav, ni, nj)) continue;
      // block diagonal cutting through a wall corner
      if (di !== 0 && dj !== 0 && (!walkable(nav, ci + di, cj) || !walkable(nav, ci, cj + dj))) continue;
      const id = idx(nav, ni, nj);
      if (seen[id]) continue;
      seen[id] = 1; prev[id] = cur; q.push(id);
    }
  }
  if (!found) return [{ x: tx, z: tz }];
  // reconstruct
  const cells = [];
  for (let c = goal; c !== -1; c = prev[c]) cells.push(c);
  cells.reverse();
  // to world waypoints; drop collinear points for a smoother path
  const pts = cells.map((c) => center(nav, c % nav.w, (c / nav.w) | 0));
  const wp = [];
  for (let k = 0; k < pts.length; k++) {
    if (k === 0 || k === pts.length - 1) { wp.push(pts[k]); continue; }
    const a = pts[k - 1], b = pts[k], c = pts[k + 1];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 1e-3) wp.push(b); // keep only turns
  }
  wp.push({ x: tx, z: tz }); // exact final target
  return wp;
}
