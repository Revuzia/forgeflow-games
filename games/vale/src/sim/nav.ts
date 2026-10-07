// VALE sim — navigation (CONTRACT §5.4).
//
// Walkability is rasterised from MapDef.walls at map.navCell. A cell is blocked when its centre is
// inside a wall polygon or a wall edge passes within half a cell + WALL_CLEARANCE of it; the small
// clearance keeps unit bodies (circles, ~0.5 m) from visibly sinking into wall meshes, while unit
// CENTRES are what the grid constrains. The map border is implicitly blocked. Structures add
// reference-counted dynamic obstacles (addObstacle/removeObstacle) on top of the wall layer.
//
// Path queries (findPath), cheapest first:
//   1. straight line when line-of-walk holds;
//   2. corner graph: shortest path over the convex corners of the wall polygons (offset into open
//      space), built lazily once per map against the wall layer — optimal taut paths whose cost
//      does not grow with the area a grid search would flood. Each leg is re-checked against
//      dynamic obstacles; a blocked leg is patched with a grid search;
//   3. grid A* (octile, no corner cutting) + turning points + string pulling — the fallback for
//      unreachable goals, pockets the corner graph cannot see out of, and patching legs.
// All A* state lives in typed arrays allocated once per map; a generation stamp marks the entries
// that belong to the current search ("closed-set reuse"): no per-search clearing or allocation.

import type { MapDefT } from '../contracts/catalog.ts';
import { pointInPolygon, polygonAabb, polygonEdgeDist2, type Poly, type V2 } from './math.ts';

/** extra metres around wall polygons that count as blocked for unit centres */
export const WALL_CLEARANCE = 0.25;
const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly sizeX: number;
  readonly sizeY: number;
  /** 1 = blocked (walls ∪ dynamic obstacles) */
  readonly blocked: Uint8Array;
  /** walls only */
  private wall: Uint8Array;
  /** dynamic obstacle reference counts (structures) */
  private dyn: Uint16Array;
  private walls: readonly Poly[];
  private clearance: number;
  /** connected-component label per cell (−1 blocked); rebuilt lazily when obstacles change */
  private comp: Int32Array;
  private compDirty = true;
  private queue: Int32Array;

  // grid A* scratch (reused across searches)
  private g: Float32Array;
  private parent: Int32Array;
  private openGen: Uint32Array;
  private closedGen: Uint32Array;
  private gen = 0;
  private heapN: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  private cells: number[] = [];
  private pts: number[] = [];
  private leg: number[] = [];

  // corner graph (lazy)
  private graphReady = false;
  private gx: Float64Array = new Float64Array(0);
  private gy: Float64Array = new Float64Array(0);
  private adjStart: Int32Array = new Int32Array(1);
  private adj: Int32Array = new Int32Array(0);
  private adjCost: Float32Array = new Float32Array(0);
  private gScore: Float64Array = new Float64Array(0);
  private gPrev: Int32Array = new Int32Array(0);
  private gDone: Uint8Array = new Uint8Array(0);
  private sCost: Float64Array = new Float64Array(0);
  private tCost: Float64Array = new Float64Array(0);
  private hCost: Float64Array = new Float64Array(0);
  private chain: number[] = [];

  /** cap on grid node expansions per search; beyond it the path goes to the closest node found */
  maxExpand = 60000;
  /** use the corner graph (probes switch it off to exercise grid A*) */
  useGraph = true;
  /** counters for perf probes */
  searches = 0;
  gridSearches = 0;
  expanded = 0;

  constructor(sizeX: number, sizeY: number, cell: number, walls: readonly Poly[], clearance = WALL_CLEARANCE) {
    this.cell = cell; this.sizeX = sizeX; this.sizeY = sizeY;
    this.walls = walls; this.clearance = clearance;
    this.w = Math.max(1, Math.ceil(sizeX / cell));
    this.h = Math.max(1, Math.ceil(sizeY / cell));
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.wall = new Uint8Array(n);
    this.dyn = new Uint16Array(n);
    this.comp = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.openGen = new Uint32Array(n);
    this.closedGen = new Uint32Array(n);
    this.heapN = new Int32Array(Math.max(64, n));
    this.heapF = new Float32Array(Math.max(64, n));
    for (const poly of walls) this.rasterize(poly, clearance);
    this.wall.set(this.blocked);
  }

  static fromMap(map: MapDefT): NavGrid { return new NavGrid(map.size[0], map.size[1], map.navCell, map.walls); }

  private rasterize(poly: Poly, clearance: number): void {
    const bb = polygonAabb(poly);
    const c = this.cell;
    const pad = c * 0.5 + clearance;
    const x0 = Math.max(0, Math.floor((bb.minX - pad) / c)), x1 = Math.min(this.w - 1, Math.floor((bb.maxX + pad) / c));
    const y0 = Math.max(0, Math.floor((bb.minY - pad) / c)), y1 = Math.min(this.h - 1, Math.floor((bb.maxY + pad) / c));
    const pad2 = pad * pad;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * this.w + cx;
        if (this.blocked[i]) continue;
        const px = (cx + 0.5) * c, py = (cy + 0.5) * c;
        if (pointInPolygon(px, py, poly) || polygonEdgeDist2(px, py, poly) < pad2) this.blocked[i] = 1;
      }
    }
  }

  // ── dynamic obstacles ─────────────────────────────────────────────────────────────────────
  /** cells whose centre lies within r of (x, y) */
  private disc(x: number, y: number, r: number, fn: (i: number) => void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.w - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.h - 1, Math.floor((y + r) / c));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + 0.5) * c - x, py = (cy + 0.5) * c - y;
      if (px * px + py * py <= r * r) fn(cy * this.w + cx);
    }
  }
  /** the discs currently placed (raycast needs their centres to tell "leaving" from "entering") */
  private obstacles: { x: number; y: number; r: number }[] = [];
  /** block a disc for unit centres (structures: radius + clearance); remove with the same numbers */
  addObstacle(x: number, y: number, r: number): void {
    this.disc(x, y, r, (i) => { this.dyn[i]++; this.blocked[i] = 1; });
    this.obstacles.push({ x, y, r });
    this.compDirty = true;
  }
  removeObstacle(x: number, y: number, r: number): void {
    this.disc(x, y, r, (i) => { if (this.dyn[i] > 0) this.dyn[i]--; this.blocked[i] = this.wall[i] || this.dyn[i] > 0 ? 1 : 0; });
    const k = this.obstacles.findIndex((o) => o.x === x && o.y === y && o.r === r);
    if (k >= 0) this.obstacles.splice(k, 1);
    this.compDirty = true;
  }

  // ── connectivity ──────────────────────────────────────────────────────────────────────────
  /** label 8-connected (no corner cutting) walkable regions; O(cells), only after obstacle changes */
  private labelComponents(): void {
    this.compDirty = false;
    const W = this.w, H = this.h, B = this.blocked, C = this.comp, Q = this.queue;
    C.fill(-1);
    let label = 0;
    for (let s0 = 0; s0 < C.length; s0++) {
      if (B[s0] || C[s0] !== -1) continue;
      let head = 0, tail = 0;
      Q[tail++] = s0; C[s0] = label;
      while (head < tail) {
        const n = Q[head++];
        const nx = n % W, ny = (n / W) | 0;
        for (let k = 0; k < 8; k++) {
          const mx = nx + NDX[k], my = ny + NDY[k];
          if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
          const m = my * W + mx;
          if (B[m] || C[m] !== -1) continue;
          if (NDX[k] !== 0 && NDY[k] !== 0 && (B[ny * W + mx] || B[my * W + nx])) continue;
          C[m] = label; Q[tail++] = m;
        }
      }
      label++;
    }
  }
  /** component label of the cell under (x, y) (−1: blocked / outside) */
  componentAt(x: number, y: number): number {
    if (this.compDirty) this.labelComponents();
    if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) return -1;
    return this.comp[Math.floor(y / this.cell) * this.w + Math.floor(x / this.cell)];
  }
  /** nearest cell centre to (x, y) inside component `label`; false if the component is empty */
  private nearestInComponent(x: number, y: number, label: number, out: V2): boolean {
    const c = this.cell, C = this.comp;
    const cx0 = Math.floor(x / c), cy0 = Math.floor(y / c);
    const maxRing = Math.max(this.w, this.h);
    for (let r = 0; r <= maxRing; r++) {
      let best = -1, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        const cy = cy0 + dy;
        if (cy < 0 || cy >= this.h) continue;
        const ring = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += ring ? 1 : Math.max(1, 2 * r)) {
          const cx = cx0 + dx;
          if (cx < 0 || cx >= this.w) continue;
          const i = cy * this.w + cx;
          if (C[i] !== label) continue;
          const px = (cx + 0.5) * c, py = (cy + 0.5) * c;
          const d = (px - x) * (px - x) + (py - y) * (py - y);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      if (best >= 0) { out.x = ((best % this.w) + 0.5) * c; out.y = (Math.floor(best / this.w) + 0.5) * c; return true; }
    }
    return false;
  }

  // ── queries ───────────────────────────────────────────────────────────────────────────────
  cellX(x: number): number { return Math.floor(x / this.cell); }
  cellY(y: number): number { return Math.floor(y / this.cell); }
  isBlockedCell(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return true;
    return this.blocked[cy * this.w + cx] === 1;
  }
  walkable(x: number, y: number): boolean { return this.walkableIn(this.blocked, x, y); }
  /** walkable as far as map walls are concerned (structures' clearance discs ignored) */
  wallFree(x: number, y: number): boolean { return this.walkableIn(this.wall, x, y); }
  private walkableIn(grid: Uint8Array, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) return false;
    return grid[Math.floor(y / this.cell) * this.w + Math.floor(x / this.cell)] === 0;
  }

  /**
   * Grid traversal (Amanatides–Woo, supercover at exact corners) from a to b over `grid`.
   * Returns the parameter t ∈ [0, 1] at which the segment first enters a blocked cell, or 2.
   * HOT: every line-of-walk test and corner-graph query runs this; keep the loop branch-lean
   * (a flag test per cell cost the corner graph ~40 %).
   */
  private march(grid: Uint8Array, ax: number, ay: number, bx: number, by: number): number {
    const c = this.cell, W = this.w, H = this.h;
    const x = ax / c, y = ay / c, ex = bx / c, ey = by / c;
    let cx = Math.floor(x), cy = Math.floor(y);
    const tx = Math.floor(ex), ty = Math.floor(ey);
    const dx = ex - x, dy = ey - y;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx > 0 ? (cx + 1 - x) * tDeltaX : dx < 0 ? (x - cx) * tDeltaX : Infinity;
    let tMaxY = dy > 0 ? (cy + 1 - y) * tDeltaY : dy < 0 ? (y - cy) * tDeltaY : Infinity;
    let tCur = 0;
    let guard = Math.abs(tx - cx) + Math.abs(ty - cy) + 4;
    while (guard-- > 0) {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H || grid[cy * W + cx] === 1) return tCur;
      if (cx === tx && cy === ty) return 2;
      if (tMaxX < tMaxY) { tCur = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else if (tMaxY < tMaxX) { tCur = tMaxY; tMaxY += tDeltaY; cy += stepY; }
      else {
        // passing exactly through a corner: both side cells must be open (no squeezing diagonally)
        tCur = tMaxX;
        const sx = cx + stepX, sy = cy + stepY;
        if (sx < 0 || sx >= W || sy < 0 || sy >= H || grid[cy * W + sx] === 1 || grid[sy * W + cx] === 1) return tCur;
        tMaxX += tDeltaX; tMaxY += tDeltaY; cx = sx; cy = sy;
      }
      if (tCur > 1) return 2;
    }
    return 2;
  }
  /** the dual of march (rare: leaving a blocked region): t at which a→b first enters an OPEN cell, or 2 */
  private marchOpen(grid: Uint8Array, ax: number, ay: number, bx: number, by: number): number {
    const c = this.cell, W = this.w, H = this.h;
    const x = ax / c, y = ay / c, ex = bx / c, ey = by / c;
    let cx = Math.floor(x), cy = Math.floor(y);
    const tx = Math.floor(ex), ty = Math.floor(ey);
    const dx = ex - x, dy = ey - y;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx > 0 ? (cx + 1 - x) * tDeltaX : dx < 0 ? (x - cx) * tDeltaX : Infinity;
    let tMaxY = dy > 0 ? (cy + 1 - y) * tDeltaY : dy < 0 ? (y - cy) * tDeltaY : Infinity;
    let tCur = 0;
    let guard = Math.abs(tx - cx) + Math.abs(ty - cy) + 4;
    while (guard-- > 0) {
      if (cx >= 0 && cy >= 0 && cx < W && cy < H && grid[cy * W + cx] === 0) return tCur;
      if (cx === tx && cy === ty) return 2;
      if (tMaxX < tMaxY) { tCur = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else if (tMaxY < tMaxX) { tCur = tMaxY; tMaxY += tDeltaY; cy += stepY; }
      else { tCur = tMaxX; tMaxX += tDeltaX; tMaxY += tDeltaY; cx += stepX; cy += stepY; }
      if (tCur > 1) return 2;
    }
    return 2;
  }

  private lineIn(grid: Uint8Array, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
    if (this.march(grid, ax, ay, bx, by) <= 1) return false;
    if (radius <= 0) return true;
    const dx = bx - ax, dy = by - ay;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-6) return true;
    const ox = (-dy / l) * radius, oy = (dx / l) * radius;
    return this.march(grid, ax + ox, ay + oy, bx + ox, by + oy) > 1 && this.march(grid, ax - ox, ay - oy, bx - ox, by - oy) > 1;
  }

  /** true if a body of `radius` can walk straight from a to b (centre line + two side lines) */
  lineOfWalk(ax: number, ay: number, bx: number, by: number, radius = 0): boolean { return this.lineIn(this.blocked, ax, ay, bx, by, radius); }

  /**
   * Walk from a toward b and stop at the last walkable point (dashes and knockbacks stop at walls
   * and structures). Writes it into `out`; returns true when b itself was reached.
   * A body may stand inside a structure's clearance disc (bodies collide with the structure's
   * radius, paths keep radius + clearance free), so a start in a blocked cell is not a wall: the
   * leading blocked run is skipped when the segment heads AWAY from every disc it starts in (never
   * through the structure) and crosses no wall cell. `wallsOnly` ignores structures entirely
   * (projectiles: their filters decide what structures stop).
   */
  raycast(ax: number, ay: number, bx: number, by: number, out: V2, wallsOnly = false): boolean {
    const grid = wallsOnly ? this.wall : this.blocked;
    const dx = bx - ax, dy = by - ay;
    const l = Math.sqrt(dx * dx + dy * dy);
    let sx = ax, sy = ay;
    if (!wallsOnly && l > 1e-9 && !this.walkableIn(grid, ax, ay) && this.mayLeave(ax, ay, dx, dy)) {
      const te = this.marchOpen(grid, ax, ay, bx, by);
      const tw = te <= 1 ? te : 1;
      if (this.march(this.wall, ax, ay, ax + dx * tw, ay + dy * tw) > 1) {
        if (te > 1) { out.x = bx; out.y = by; return true; }   // the whole move stays inside the disc's rim
        const t0 = Math.min(1, te + 1e-4 / l);   // just inside the first open cell
        sx = ax + dx * t0; sy = ay + dy * t0;
      }
    }
    const t = this.march(grid, sx, sy, bx, by);
    if (t > 1) { out.x = bx; out.y = by; return true; }
    const rx = bx - sx, ry = by - sy;
    const rl = Math.sqrt(rx * rx + ry * ry);
    // back off a hair so the stop point is inside the last open cell
    const tt = rl > 1e-9 ? Math.max(0, t - 0.01 / rl) : 0;
    out.x = sx + rx * tt; out.y = sy + ry * tt;
    if (!this.walkableIn(grid, out.x, out.y)) { out.x = sx; out.y = sy; }
    return false;
  }
  /** may a walker standing in a blocked cell at (x, y) move along (dx, dy)? (not into a wall or a structure) */
  private mayLeave(x: number, y: number, dx: number, dy: number): boolean {
    if (!this.walkableIn(this.wall, x, y)) return false;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      const ox = x - o.x, oy = y - o.y;
      const reach = o.r + this.cell; // blocked cells reach half a cell diagonal past r
      if (ox * ox + oy * oy > reach * reach) continue;
      if (ox * dx + oy * dy < 0) return false;   // heading into the structure
    }
    return true;
  }

  /**
   * Nearest walkable cell centre to (x, y) (Euclidean, within maxRing cells); writes `out`, false
   * if none. Equally near candidates go to the one nearest (preferX, preferY) — a blink into the
   * middle of a wall lands on the caster's side unless the far side is strictly closer.
   */
  nearestWalkable(x: number, y: number, out: V2, maxRing = 64, preferX = x, preferY = y): boolean {
    if (this.walkable(x, y)) { out.x = x; out.y = y; return true; }
    const c = this.cell;
    const cx0 = Math.floor(x / c), cy0 = Math.floor(y / c);
    let best = -1, bestD = Infinity, bestP = Infinity;
    let last = maxRing;
    for (let r = 1; r <= last; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const ring = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += ring ? 1 : 2 * r) {
          const cx = cx0 + dx, cy = cy0 + dy;
          if (this.isBlockedCell(cx, cy)) continue;
          const px = (cx + 0.5) * c, py = (cy + 0.5) * c;
          const d = (px - x) * (px - x) + (py - y) * (py - y);
          const p = (px - preferX) * (px - preferX) + (py - preferY) * (py - preferY);
          if (d < bestD - 1e-9 || (d <= bestD + 1e-9 && p < bestP)) { bestD = d; bestP = p; best = cy * this.w + cx; }
        }
      }
      // square rings are not distance shells: a later ring can still hold a closer cell, up to the
      // ring whose inner edge is beyond the best distance found
      if (best >= 0 && last === maxRing) last = Math.min(maxRing, Math.ceil((r + 0.5) * Math.SQRT2 + 0.5));
    }
    if (best < 0) return false;
    out.x = ((best % this.w) + 0.5) * c; out.y = (Math.floor(best / this.w) + 0.5) * c;
    return true;
  }

  // ── path entry point ──────────────────────────────────────────────────────────────────────
  /**
   * Path from a to b for a body of `radius` (clamped to 0.45 cells: waypoints hug blocked cells,
   * so wider side lines would reject every corner). Writes waypoints into `out` as a flat
   * [x0, y0, x1, y1, …] list that excludes the start and ends at b (or at the closest reachable
   * point when b is unreachable). Returns false when no progress is possible.
   */
  findPath(ax: number, ay: number, bx: number, by: number, out: number[], radius = 0): boolean {
    out.length = 0;
    this.searches++;
    radius = Math.min(radius, this.cell * 0.45);
    const tmp: V2 = { x: 0, y: 0 };
    let sx = ax, sy = ay;
    if (!this.walkable(sx, sy)) { if (!this.nearestWalkable(sx, sy, tmp)) return false; sx = tmp.x; sy = tmp.y; }
    let gx = bx, gy = by;
    if (!this.walkable(gx, gy)) { if (!this.nearestWalkable(gx, gy, tmp)) return false; gx = tmp.x; gy = tmp.y; }
    // unreachable goal (another component): aim for the closest reachable cell instead, so no
    // search ever floods a whole component looking for a way in
    const cs = this.componentAt(sx, sy);
    if (this.componentAt(gx, gy) !== cs) { if (!this.nearestInComponent(gx, gy, cs, tmp)) return false; gx = tmp.x; gy = tmp.y; }
    if (sx !== ax || sy !== ay) out.push(sx, sy);
    if (this.lineOfWalk(sx, sy, gx, gy, radius)) { out.push(gx, gy); return true; }
    const base = out.length;
    if (this.useGraph && this.graphPath(sx, sy, gx, gy, radius, out)) return true;
    out.length = base; // drop any partial legs from a failed graph attempt
    return this.gridPath(sx, sy, gx, gy, out, radius);
  }

  // ── corner graph ──────────────────────────────────────────────────────────────────────────
  /** number of corner nodes (builds the graph on first use) */
  graphNodeCount(): number { if (!this.graphReady) this.buildGraph(); return this.gx.length; }

  private buildGraph(): void {
    this.graphReady = true;
    const c = this.cell;
    const xs: number[] = [], ys: number[] = [];
    for (const poly of this.walls) {
      const n = poly.length;
      let area = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      const sign = area >= 0 ? 1 : -1; // +1: counter-clockwise
      for (let i = 0; i < n; i++) {
        const p = poly[(i + n - 1) % n], v = poly[i], q = poly[(i + 1) % n];
        const e1x = v[0] - p[0], e1y = v[1] - p[1], e2x = q[0] - v[0], e2y = q[1] - v[1];
        if ((e1x * e2y - e1y * e2x) * sign <= 0) continue; // concave or straight: never a turning point
        // outward normals of both edges (for CCW: (dy, −dx)), bisected
        const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
        let bx = (e1y / l1 + e2y / l2) * sign, by = (-e1x / l1 - e2x / l2) * sign;
        const bl = Math.hypot(bx, by);
        if (bl < 1e-9) continue;
        bx /= bl; by /= bl;
        // place the node far enough from BOTH edges that a body of 0.45 cells passes it on
        // cell-centre rounding: perpendicular distance `need`, so d = need / cos(half turn)
        const cosHalf = Math.max(0.2, bx * (e1y / l1) * sign + by * (-e1x / l1) * sign);
        const need = this.clearance + c * 1.5 + c * 0.45;
        for (const k of [1, 1.5, 2.2]) {
          const d = (need / cosHalf) * k;
          const x = v[0] + bx * d, y = v[1] + by * d;
          if (!this.walkableIn(this.wall, x, y)) continue;
          let dup = false;
          for (let m = 0; m < xs.length; m++) if (Math.abs(xs[m] - x) + Math.abs(ys[m] - y) < c) { dup = true; break; }
          if (!dup) { xs.push(x); ys.push(y); }
          break;
        }
      }
    }
    const V = xs.length;
    this.gx = Float64Array.from(xs); this.gy = Float64Array.from(ys);
    const r = this.cell * 0.45;
    const lists: number[][] = xs.map(() => []);
    const costs: number[][] = xs.map(() => []);
    for (let i = 0; i < V; i++) {
      for (let j = i + 1; j < V; j++) {
        if (!this.lineIn(this.wall, xs[i], ys[i], xs[j], ys[j], r)) continue;
        const d = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
        lists[i].push(j); costs[i].push(d);
        lists[j].push(i); costs[j].push(d);
      }
    }
    this.adjStart = new Int32Array(V + 1);
    let total = 0;
    for (let i = 0; i < V; i++) { this.adjStart[i] = total; total += lists[i].length; }
    this.adjStart[V] = total;
    this.adj = new Int32Array(total); this.adjCost = new Float32Array(total);
    for (let i = 0, k = 0; i < V; i++) for (let m = 0; m < lists[i].length; m++, k++) { this.adj[k] = lists[i][m]; this.adjCost[k] = costs[i][m]; }
    this.gScore = new Float64Array(V); this.gPrev = new Int32Array(V); this.gDone = new Uint8Array(V);
    this.sCost = new Float64Array(V); this.tCost = new Float64Array(V); this.hCost = new Float64Array(V);
  }

  /** shortest corner path; appends waypoints (legs patched around dynamic obstacles) */
  private graphPath(sx: number, sy: number, tx: number, ty: number, radius: number, out: number[]): boolean {
    if (!this.graphReady) this.buildGraph();
    const V = this.gx.length;
    if (V === 0) return false;
    const X = this.gx, Y = this.gy, S = this.sCost, T = this.tCost, G = this.gScore, P = this.gPrev, D = this.gDone, Hh = this.hCost;
    // start/goal visibility uses the centre line only (one march instead of three); legs are
    // re-validated with the body radius below and patched if a corner was clipped
    let anyS = false, anyT = false;
    const cs = this.componentAt(sx, sy);
    for (let i = 0; i < V; i++) {
      const xi = X[i], yi = Y[i];
      Hh[i] = Math.hypot(tx - xi, ty - yi);
      // nodes covered by a structure (or cut off by one) are unusable right now
      if (this.componentAt(xi, yi) !== cs) { S[i] = Infinity; T[i] = Infinity; G[i] = Infinity; P[i] = -1; D[i] = 1; continue; }
      S[i] = this.march(this.wall, sx, sy, xi, yi) > 1 ? Math.hypot(xi - sx, yi - sy) : Infinity;
      T[i] = this.march(this.wall, xi, yi, tx, ty) > 1 ? Hh[i] : Infinity;
      if (S[i] < Infinity) anyS = true;
      if (T[i] < Infinity) anyT = true;
      G[i] = S[i]; P[i] = -1; D[i] = 0;
    }
    if (!anyS || !anyT) return false;
    // A* over a small dense graph: a linear scan for the open minimum is cheaper than a heap here
    let bestTotal = Infinity, bestLast = -1;
    for (;;) {
      let u = -1, uf = Infinity;
      for (let i = 0; i < V; i++) {
        if (D[i]) continue;
        const f = G[i] + Hh[i];
        if (f < uf) { uf = f; u = i; }
      }
      if (u < 0 || uf >= bestTotal) break;
      D[u] = 1;
      if (T[u] < Infinity && G[u] + T[u] < bestTotal) { bestTotal = G[u] + T[u]; bestLast = u; }
      for (let k = this.adjStart[u]; k < this.adjStart[u + 1]; k++) {
        const v = this.adj[k];
        if (D[v]) continue;
        const ng = G[u] + this.adjCost[k];
        if (ng < G[v]) { G[v] = ng; P[v] = u; }
      }
    }
    if (bestLast < 0) return false;
    const chain = this.chain; chain.length = 0;
    for (let u = bestLast; u !== -1; u = P[u]) chain.push(u);
    chain.reverse();
    // emit legs; a leg crossing a dynamic obstacle is patched with a grid search
    let px = sx, py = sy;
    for (let k = 0; k <= chain.length; k++) {
      const qx = k < chain.length ? X[chain[k]] : tx, qy = k < chain.length ? Y[chain[k]] : ty;
      if (this.lineOfWalk(px, py, qx, qy, radius)) out.push(qx, qy);
      else {
        const leg = this.leg;
        leg.length = 0;
        if (!this.gridPath(px, py, qx, qy, leg, radius)) return false;
        for (let i = 0; i < leg.length; i++) out.push(leg[i]);
        const lx = leg[leg.length - 2], ly = leg[leg.length - 1];
        if (Math.abs(lx - qx) + Math.abs(ly - qy) > 1e-6) return true; // leg target unreachable: stop at the closest point
      }
      px = qx; py = qy;
    }
    return true;
  }

  // ── grid A* ───────────────────────────────────────────────────────────────────────────────
  private heapPush(n: number, f: number): void {
    if (this.heapSize >= this.heapN.length) {
      const nn = new Int32Array(this.heapN.length * 2); nn.set(this.heapN); this.heapN = nn;
      const nf = new Float32Array(this.heapF.length * 2); nf.set(this.heapF); this.heapF = nf;
    }
    let i = this.heapSize++;
    const hn = this.heapN, hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] < f || (hf[p] === f && hn[p] < n)) break;
      hn[i] = hn[p]; hf[i] = hf[p]; i = p;
    }
    hn[i] = n; hf[i] = f;
  }
  private heapPop(): number {
    const hn = this.heapN, hf = this.heapF;
    const top = hn[0];
    const n = hn[--this.heapSize], f = hf[this.heapSize];
    let i = 0;
    const size = this.heapSize;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && (hf[c + 1] < hf[c] || (hf[c + 1] === hf[c] && hn[c + 1] < hn[c]))) c++;
      if (f < hf[c] || (f === hf[c] && n <= hn[c])) break;
      hn[i] = hn[c]; hf[i] = hf[c]; i = c;
    }
    hn[i] = n; hf[i] = f;
    return top;
  }

  /**
   * Grid A* from a walkable start to a walkable goal; appends string-pulled waypoints (excluding
   * the start) to `out`. Unreachable goals end at the explored cell closest to the goal.
   */
  gridPath(sx: number, sy: number, gx: number, gy: number, out: number[], radius = 0): boolean {
    this.gridSearches++;
    const c = this.cell, w = this.w;
    const start = Math.floor(sy / c) * w + Math.floor(sx / c);
    const goal = Math.floor(gy / c) * w + Math.floor(gx / c);
    if (start === goal) { out.push(gx, gy); return true; }
    if (++this.gen >= 0xfffffff0) { this.gen = 1; this.openGen.fill(0); this.closedGen.fill(0); }
    const gen = this.gen;
    const gc = goal % w, gr = (goal / w) | 0;
    // octile heuristic, inflated by a hair: among equal-f nodes the one closer to the goal wins,
    // which collapses the plateau of ties open grids produce (paths stay within 0.1 % of optimal)
    const HW = 1 + 1 / 1024;
    const K = SQRT2 - 2;
    this.heapSize = 0;
    const G = this.g, P = this.parent, OG = this.openGen, CG = this.closedGen, B = this.blocked;
    const sdx = Math.abs((start % w) - gc), sdy = Math.abs(((start / w) | 0) - gr);
    let bestH = sdx + sdy + K * (sdx < sdy ? sdx : sdy);
    G[start] = 0; P[start] = -1; OG[start] = gen;
    this.heapPush(start, bestH * HW);
    let best = start;
    let expanded = 0;
    let reached = false;
    const hh = this.h;
    while (this.heapSize > 0) {
      const n = this.heapPop();
      if (CG[n] === gen) continue;
      CG[n] = gen;
      if (n === goal) { reached = true; break; }
      if (++expanded > this.maxExpand) break;
      const nx = n % w, ny = (n / w) | 0;
      const gn = G[n];
      for (let k = 0; k < 8; k++) {
        const ddx = NDX[k], ddy = NDY[k];
        const mx = nx + ddx, my = ny + ddy;
        if (mx < 0 || my < 0 || mx >= w || my >= hh) continue;
        const m = my * w + mx;
        if (B[m] || CG[m] === gen) continue;
        let cost = 1;
        if (ddx !== 0 && ddy !== 0) {
          // no corner cutting: both orthogonal neighbours must be open
          if (B[ny * w + mx] || B[my * w + nx]) continue;
          cost = SQRT2;
        }
        const ng = gn + cost;
        if (OG[m] !== gen || ng < G[m]) {
          G[m] = ng; P[m] = n; OG[m] = gen;
          const hx = mx > gc ? mx - gc : gc - mx, hy = my > gr ? my - gr : gr - my;
          const h = hx + hy + K * (hx < hy ? hx : hy);
          this.heapPush(m, ng + h * HW);
          if (h < bestH) { bestH = h; best = m; }
        }
      }
    }
    this.expanded += expanded;
    const endCell = reached ? goal : best;
    if (endCell === start) return false;

    // reconstruct (goal → start), then keep only turning points
    const cells = this.cells; cells.length = 0;
    for (let n = endCell; n !== -1; n = P[n]) cells.push(n);
    cells.reverse();
    const pts = this.pts; pts.length = 0;
    pts.push(sx, sy);
    for (let i = 1; i < cells.length - 1; i++) {
      const a = cells[i - 1], b = cells[i], d = cells[i + 1];
      const d1x = (b % w) - (a % w), d1y = ((b / w) | 0) - ((a / w) | 0);
      const d2x = (d % w) - (b % w), d2y = ((d / w) | 0) - ((b / w) | 0);
      if (d1x !== d2x || d1y !== d2y) pts.push(((b % w) + 0.5) * c, (((b / w) | 0) + 0.5) * c);
    }
    if (reached) pts.push(gx, gy);
    else pts.push(((endCell % w) + 0.5) * c, (((endCell / w) | 0) + 0.5) * c);

    // string pulling: from each anchor, advance while the next point stays in line of walk
    const count = pts.length >> 1;
    let i = 0;
    let axp = pts[0], ayp = pts[1];
    while (i < count - 1) {
      let j = i + 1;
      while (j + 1 < count && this.lineOfWalk(axp, ayp, pts[2 * (j + 1)], pts[2 * (j + 1) + 1], radius)) j++;
      axp = pts[2 * j]; ayp = pts[2 * j + 1];
      out.push(axp, ayp);
      i = j;
    }
    return true;
  }
}

const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];
