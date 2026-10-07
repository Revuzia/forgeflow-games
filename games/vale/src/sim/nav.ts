// VALE sim — navigation grid (CONTRACT §5.4).
//
// Walkability is rasterised from MapDef.walls at map.navCell. A cell is blocked when its centre is
// inside a wall polygon or a wall edge passes within half a cell + WALL_CLEARANCE of it; the small
// clearance keeps unit bodies (which are circles, ~0.5 m) from visibly sinking into wall meshes,
// while unit CENTRES are what the grid constrains. The map border is implicitly blocked.
//
// A* is octile on the 8-connected grid without corner cutting. All search state lives in typed
// arrays allocated once per map; a generation stamp marks which entries belong to the current
// search ("closed-set reuse"), so a search never clears or allocates per-node memory. The raw cell
// path is reduced to turning points and then string-pulled with line-of-walk checks.

import type { MapDefT } from '../contracts/catalog.ts';
import { pointInPolygon, polygonAabb, polygonEdgeDist2, type V2 } from './math.ts';

/** extra metres around wall polygons that count as blocked for unit centres */
export const WALL_CLEARANCE = 0.25;
const SQRT2 = Math.SQRT2;

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly sizeX: number;
  readonly sizeY: number;
  /** 1 = blocked */
  readonly blocked: Uint8Array;

  // A* scratch (reused across searches)
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
  /** cap on node expansions per search; beyond it the path goes to the closest node found */
  maxExpand = 60000;
  /** counters for perf probes */
  searches = 0;
  expanded = 0;

  constructor(sizeX: number, sizeY: number, cell: number, walls: readonly (readonly (readonly [number, number])[])[], clearance = WALL_CLEARANCE) {
    this.cell = cell; this.sizeX = sizeX; this.sizeY = sizeY;
    this.w = Math.max(1, Math.ceil(sizeX / cell));
    this.h = Math.max(1, Math.ceil(sizeY / cell));
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.openGen = new Uint32Array(n);
    this.closedGen = new Uint32Array(n);
    this.heapN = new Int32Array(Math.max(64, n));
    this.heapF = new Float32Array(Math.max(64, n));
    for (const poly of walls) this.rasterize(poly, clearance);
  }

  static fromMap(map: MapDefT): NavGrid { return new NavGrid(map.size[0], map.size[1], map.navCell, map.walls); }

  private rasterize(poly: readonly (readonly [number, number])[], clearance: number): void {
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

  cellX(x: number): number { return Math.floor(x / this.cell); }
  cellY(y: number): number { return Math.floor(y / this.cell); }
  isBlockedCell(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return true;
    return this.blocked[cy * this.w + cx] === 1;
  }
  walkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.sizeX || y >= this.sizeY) return false;
    return this.blocked[Math.floor(y / this.cell) * this.w + Math.floor(x / this.cell)] === 0;
  }

  /**
   * Grid traversal (Amanatides–Woo, supercover at exact corners) from a to b. Returns the
   * parameter t ∈ [0, 1] at which the segment first enters a blocked cell, or 2 if it never does.
   */
  private march(ax: number, ay: number, bx: number, by: number): number {
    const c = this.cell;
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
      if (this.isBlockedCell(cx, cy)) return tCur;
      if (cx === tx && cy === ty) return 2;
      if (tMaxX < tMaxY) { tCur = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else if (tMaxY < tMaxX) { tCur = tMaxY; tMaxY += tDeltaY; cy += stepY; }
      else {
        // passing exactly through a corner: both side cells must be open (no squeezing diagonally)
        tCur = tMaxX;
        if (this.isBlockedCell(cx + stepX, cy) || this.isBlockedCell(cx, cy + stepY)) return tCur;
        tMaxX += tDeltaX; tMaxY += tDeltaY; cx += stepX; cy += stepY;
      }
      if (tCur > 1) return 2;
    }
    return 2;
  }

  /** true if a body of `radius` can walk straight from a to b (centre line + two side lines) */
  lineOfWalk(ax: number, ay: number, bx: number, by: number, radius = 0): boolean {
    if (this.march(ax, ay, bx, by) <= 1) return false;
    if (radius <= 0) return true;
    const dx = bx - ax, dy = by - ay;
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1e-6) return true;
    const ox = (-dy / l) * radius, oy = (dx / l) * radius;
    return this.march(ax + ox, ay + oy, bx + ox, by + oy) > 1 && this.march(ax - ox, ay - oy, bx - ox, by - oy) > 1;
  }

  /**
   * Walk from a toward b and stop at the last walkable point (dashes, knockbacks, blinks stop at
   * walls). Writes it into `out`; returns true when b itself was reached.
   */
  raycast(ax: number, ay: number, bx: number, by: number, out: V2): boolean {
    const t = this.march(ax, ay, bx, by);
    if (t > 1) { out.x = bx; out.y = by; return true; }
    const dx = bx - ax, dy = by - ay;
    const l = Math.sqrt(dx * dx + dy * dy);
    // back off a hair so the stop point is inside the last open cell
    const tt = l > 1e-9 ? Math.max(0, t - 0.01 / l) : 0;
    out.x = ax + dx * tt; out.y = ay + dy * tt;
    if (!this.walkable(out.x, out.y)) { out.x = ax; out.y = ay; }
    return false;
  }

  /** nearest walkable cell centre to (x, y) within maxRing cells; writes `out`, false if none */
  nearestWalkable(x: number, y: number, out: V2, maxRing = 64): boolean {
    if (this.walkable(x, y)) { out.x = x; out.y = y; return true; }
    const c = this.cell;
    const cx0 = Math.floor(x / c), cy0 = Math.floor(y / c);
    for (let r = 1; r <= maxRing; r++) {
      let best = -1, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        const ring = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += ring ? 1 : 2 * r) {
          const cx = cx0 + dx, cy = cy0 + dy;
          if (this.isBlockedCell(cx, cy)) continue;
          const px = (cx + 0.5) * c, py = (cy + 0.5) * c;
          const d = (px - x) * (px - x) + (py - y) * (py - y);
          if (d < bestD) { bestD = d; best = cy * this.w + cx; }
        }
      }
      if (best >= 0) {
        out.x = ((best % this.w) + 0.5) * c; out.y = (Math.floor(best / this.w) + 0.5) * c;
        return true;
      }
    }
    return false;
  }

  // ── A* ──────────────────────────────────────────────────────────────────────────────────────
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
   * Path from a to b for a body of `radius`. Writes smoothed waypoints into `out` as a flat
   * [x0, y0, x1, y1, …] list that excludes the start and ends at b (or at the closest reachable
   * point when b is unreachable). Returns false when no progress is possible.
   */
  findPath(ax: number, ay: number, bx: number, by: number, out: number[], radius = 0): boolean {
    out.length = 0;
    this.searches++;
    const c = this.cell, w = this.w;
    const tmp: V2 = { x: 0, y: 0 };
    let sx = ax, sy = ay;
    if (!this.walkable(sx, sy)) { if (!this.nearestWalkable(sx, sy, tmp)) return false; sx = tmp.x; sy = tmp.y; }
    let gx = bx, gy = by;
    let goalExact = true;
    if (!this.walkable(gx, gy)) { if (!this.nearestWalkable(gx, gy, tmp)) return false; gx = tmp.x; gy = tmp.y; goalExact = false; }
    const start = Math.floor(sy / c) * w + Math.floor(sx / c);
    const goal = Math.floor(gy / c) * w + Math.floor(gx / c);
    if (start === goal || this.lineOfWalk(sx, sy, gx, gy, radius)) {
      if (sx !== ax || sy !== ay) out.push(sx, sy);
      out.push(gx, gy);
      return true;
    }

    if (++this.gen >= 0xfffffff0) { this.gen = 1; this.openGen.fill(0); this.closedGen.fill(0); }
    const gen = this.gen;
    const gc = goal % w, gr = (goal / w) | 0;
    const H = (n: number): number => {
      const dx = Math.abs((n % w) - gc), dy = Math.abs(((n / w) | 0) - gr);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    this.heapSize = 0;
    const G = this.g, P = this.parent, OG = this.openGen, CG = this.closedGen, B = this.blocked;
    G[start] = 0; P[start] = -1; OG[start] = gen;
    this.heapPush(start, H(start));
    let best = start, bestH = H(start);
    let expanded = 0;
    let reached = false;
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
        if (mx < 0 || my < 0 || mx >= w || my >= this.h) continue;
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
          const h = H(m);
          this.heapPush(m, ng + h);
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
    if (reached && goalExact) pts.push(gx, gy);
    else if (reached) pts.push(gx, gy);
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
    return out.length > 0;
  }
}

const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];
