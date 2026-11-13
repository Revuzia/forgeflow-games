// VALE sim — body lanes (ruling 37): the local plan a walking fighter follows round the units in its way.
//
// The nav grid knows walls and structures only; units are soft bodies that push each other apart. A fighter whose
// line ahead is blocked by bodies that will not clear it by themselves (standing, or coming at it) plans a lane round
// them once, on a fine local grid where every such body is a disc (its radius + the walker's), and walks that lane
// like a short path: one side, committed, the least detour. It re-plans only when a body steps into the lane ahead
// (checked a few times a second), never per tick, so it cannot dither between sides. Pure and deterministic: typed
// scratch arrays allocated once, ties broken by cell index.

import type { Entity } from './entity.ts';
import { segPointDist2 } from './math.ts';
import type { World } from './world.ts';

/** lane grid cell (m) */
export const LANE_CELL = 0.25;
/** margin (m) kept between the walker's body and a body it passes */
const LANE_MARGIN = 0.05;
/** the planning box: the walker and the lane's end, padded this much (m) on every side (room to go round a wave) */
const LANE_PAD = 4;
/** cells per side at most (the box is shrunk round the walker and the end when the pad would exceed it) */
const LANE_N = 112;
const SQRT2 = Math.SQRT2;
const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];

/** a body that may block a lane: centre, and the radius the walker's centre must stay out of */
export interface Disc { x: number; y: number; r: number }

const blocked = new Uint8Array(LANE_N * LANE_N);
const gCost = new Float32Array(LANE_N * LANE_N);
const parent = new Int32Array(LANE_N * LANE_N);
const openGen = new Uint32Array(LANE_N * LANE_N);
const closedGen = new Uint32Array(LANE_N * LANE_N);
const heapN = new Int32Array(LANE_N * LANE_N * 4);
const heapF = new Float32Array(LANE_N * LANE_N * 4);
let gen = 0, heapSize = 0;
const cells: number[] = [];
const pts: number[] = [];
const near: Entity[] = [];
export const laneDiscs: Disc[] = [];
const discPool: Disc[] = [];

/**
 * Is body `o` in the way of walker `e` heading along unit (ux, uy)? Standing, slow, or coming at it (rulings 36, 37):
 * a body walking away along the line, or across it at speed, clears the line by itself and is never walked round.
 * `all`: every body counts (the progress watchdog's re-plan: allies walking with it have not cleared the way).
 */
export function inTheWay(e: Entity, o: Entity, ux: number, uy: number, all: boolean): boolean {
  if (o === e || !o.alive || o.dash || o.static || o.kind === 'ward' || o.kind === 'pickup' || o.kind === 'projectile' || o.kind === 'zone') return false;
  if (o.id === e.orderTarget || o.id === e.atkTarget) return false;
  if (all) return true;
  const spd = e.stats.moveSpeed;
  const v2 = o.vx * o.vx + o.vy * o.vy;
  if (v2 < (0.3 * spd) * (0.3 * spd)) return true;           // standing (or barely moving)
  return o.vx * ux + o.vy * uy < -0.3 * spd;                   // oncoming
}

/**
 * Collect the discs round the box (minX, minY)–(maxX, maxY) that block walker `e` heading (ux, uy); bodies crowding the
 * order's own point (within their radius + the walker's + `goalNear` of (gx, gy)) are left out (the arrival watchdog
 * ends a move into a crowd on its point). A body the walker already overlaps shrinks to just short of it (it may move
 * along or away, never into it). Fills laneDiscs.
 */
export function collectDiscs(w: World, e: Entity, minX: number, minY: number, maxX: number, maxY: number,
  ux: number, uy: number, gx: number, gy: number, goalNear: number, all: boolean): void {
  for (const d of laneDiscs) discPool.push(d);
  laneDiscs.length = 0;
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
  const n = w.hash.query(cx, cy, Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY)) * 0.5 + 1.5, near);
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (!inTheWay(e, o, ux, uy, all)) continue;
    const R0 = o.radius + e.radius;
    if (o.x < minX - R0 || o.x > maxX + R0 || o.y < minY - R0 || o.y > maxY + R0) continue;
    const gr = R0 + goalNear;
    if ((o.x - gx) * (o.x - gx) + (o.y - gy) * (o.y - gy) < gr * gr) continue;
    let R = R0 + LANE_MARGIN;
    const d = Math.sqrt((o.x - e.x) * (o.x - e.x) + (o.y - e.y) * (o.y - e.y));
    if (d < R) R = Math.max(0, d - 0.02);
    const disc = discPool.pop() ?? { x: 0, y: 0, r: 0 };
    disc.x = o.x; disc.y = o.y; disc.r = R;
    laneDiscs.push(disc);
  }
}

/** the walker's body sweeping a → b meets no disc (each by `slack` m of tolerance) */
export function discsClear(ax: number, ay: number, bx: number, by: number, slack: number): boolean {
  for (let i = 0; i < laneDiscs.length; i++) {
    const d = laneDiscs[i];
    const R = d.r - slack;
    if (R <= 0) continue;
    if (segPointDist2(ax, ay, bx, by, d.x, d.y) < R * R) {
      // a disc the walker starts inside (shrunk to its distance) only blocks moving into it
      const sx = ax - d.x, sy = ay - d.y;
      if (sx * sx + sy * sy < (d.r + 1e-3) * (d.r + 1e-3) && (bx - ax) * sx + (by - ay) * sy >= 0) continue;
      return false;
    }
  }
  return true;
}

function heapPush(n: number, f: number): void {
  let i = heapSize++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] < f || (heapF[p] === f && heapN[p] < n)) break;
    heapN[i] = heapN[p]; heapF[i] = heapF[p]; i = p;
  }
  heapN[i] = n; heapF[i] = f;
}
function heapPop(): number {
  const top = heapN[0];
  const n = heapN[--heapSize], f = heapF[heapSize];
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= heapSize) break;
    if (c + 1 < heapSize && (heapF[c + 1] < heapF[c] || (heapF[c + 1] === heapF[c] && heapN[c + 1] < heapN[c]))) c++;
    if (f < heapF[c] || (f === heapF[c] && n <= heapN[c])) break;
    heapN[i] = heapN[c]; heapF[i] = heapF[c]; i = c;
  }
  heapN[i] = n; heapF[i] = f;
  return top;
}

/**
 * Plan a lane for walker `e` from where it stands to (tx, ty) round the discs collectDiscs left in laneDiscs and the
 * nav grid's walls (body radius `r`, the radius stepToward's line-of-walk uses). Writes the waypoints (excluding the
 * start, ending at the target) into `out` and returns true; false when no lane reaches the target inside the box.
 */
export function planLane(w: World, e: Entity, tx: number, ty: number, r: number, out: number[]): boolean {
  out.length = 0;
  const nav = w.nav, C = LANE_CELL;
  const sx = e.x, sy = e.y;
  // the box: start and end padded, capped at LANE_N cells a side (the pad shrinks first)
  const spanX = Math.abs(tx - sx), spanY = Math.abs(ty - sy);
  const padX = Math.max(0.5, Math.min(LANE_PAD, (LANE_N * C - spanX) * 0.5 - C));
  const padY = Math.max(0.5, Math.min(LANE_PAD, (LANE_N * C - spanY) * 0.5 - C));
  const minX = Math.min(sx, tx) - padX, minY = Math.min(sy, ty) - padY;
  const W = Math.min(LANE_N, Math.ceil((spanX + 2 * padX) / C)), H = Math.min(LANE_N, Math.ceil((spanY + 2 * padY) / C));
  const si = Math.floor((sx - minX) / C), sj = Math.floor((sy - minY) / C);
  const ti = Math.floor((tx - minX) / C), tj = Math.floor((ty - minY) / C);
  if (si < 0 || sj < 0 || si >= W || sj >= H || ti < 0 || tj < 0 || ti >= W || tj >= H) return false;
  // rasterise: wall cells (centre-walkable, as the nav grid constrains unit centres), then the discs
  for (let j = 0; j < H; j++) {
    const y = minY + (j + 0.5) * C;
    for (let i = 0; i < W; i++) blocked[j * W + i] = nav.walkable(minX + (i + 0.5) * C, y) ? 0 : 1;
  }
  for (let k = 0; k < laneDiscs.length; k++) {
    const d = laneDiscs[k];
    if (d.r <= 0) continue;
    const i0 = Math.max(0, Math.floor((d.x - d.r - minX) / C)), i1 = Math.min(W - 1, Math.floor((d.x + d.r - minX) / C));
    const j0 = Math.max(0, Math.floor((d.y - d.r - minY) / C)), j1 = Math.min(H - 1, Math.floor((d.y + d.r - minY) / C));
    const r2 = d.r * d.r;
    for (let j = j0; j <= j1; j++) {
      const y = minY + (j + 0.5) * C - d.y;
      for (let i = i0; i <= i1; i++) {
        const x = minX + (i + 0.5) * C - d.x;
        if (x * x + y * y < r2) blocked[j * W + i] = 1;
      }
    }
  }
  const start = sj * W + si, goal = tj * W + ti;
  blocked[start] = 0;
  if (blocked[goal]) return false;
  if (++gen >= 0xfffffff0) { gen = 1; openGen.fill(0); closedGen.fill(0); }
  heapSize = 0;
  const K = SQRT2 - 2, HW = 1 + 1 / 1024;
  const h0x = Math.abs(si - ti), h0y = Math.abs(sj - tj);
  gCost[start] = 0; parent[start] = -1; openGen[start] = gen;
  heapPush(start, (h0x + h0y + K * Math.min(h0x, h0y)) * HW);
  let reached = false;
  while (heapSize > 0) {
    const n = heapPop();
    if (closedGen[n] === gen) continue;
    closedGen[n] = gen;
    if (n === goal) { reached = true; break; }
    const nx = n % W, ny = (n / W) | 0, gn = gCost[n];
    for (let k = 0; k < 8; k++) {
      const mx = nx + NDX[k], my = ny + NDY[k];
      if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
      const m = my * W + mx;
      if (blocked[m] || closedGen[m] === gen) continue;
      let cost = 1;
      if (NDX[k] !== 0 && NDY[k] !== 0) { if (blocked[ny * W + mx] || blocked[my * W + nx]) continue; cost = SQRT2; }
      const ng = gn + cost;
      if (openGen[m] !== gen || ng < gCost[m]) {
        gCost[m] = ng; parent[m] = n; openGen[m] = gen;
        const hx = Math.abs(mx - ti), hy = Math.abs(my - tj);
        heapPush(m, ng + (hx + hy + K * Math.min(hx, hy)) * HW);
      }
    }
  }
  if (!reached) return false;
  // turning points, then string pulling against the walls (body radius) and the discs
  cells.length = 0;
  for (let n = goal; n !== -1; n = parent[n]) cells.push(n);
  cells.reverse();
  pts.length = 0;
  pts.push(sx, sy);
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], b = cells[i], d = cells[i + 1];
    if ((b % W) - (a % W) !== (d % W) - (b % W) || ((b / W) | 0) - ((a / W) | 0) !== ((d / W) | 0) - ((b / W) | 0)) {
      pts.push(minX + ((b % W) + 0.5) * C, minY + (((b / W) | 0) + 0.5) * C);
    }
  }
  pts.push(tx, ty);
  const count = pts.length >> 1;
  let i = 0, ax = sx, ay = sy;
  while (i < count - 1) {
    let j = i + 1;
    while (j + 1 < count) {
      const bx = pts[2 * (j + 1)], by = pts[2 * (j + 1) + 1];
      if (!discsClear(ax, ay, bx, by, 0.02) || !nav.lineOfWalk(ax, ay, bx, by, r)) break;
      j++;
    }
    ax = pts[2 * j]; ay = pts[2 * j + 1];
    out.push(ax, ay);
    i = j;
  }
  return true;
}

/** length of the polyline from (x, y) through out[from…] */
export function laneLen(x: number, y: number, pts: readonly number[], from: number): number {
  let l = 0;
  for (let i = from; i + 1 < pts.length; i += 2) { l += Math.sqrt((pts[i] - x) * (pts[i] - x) + (pts[i + 1] - y) * (pts[i + 1] - y)); x = pts[i]; y = pts[i + 1]; }
  return l;
}
