// DYEFIELD — bot navigation graph (CONTRACT §10.2). THREE-free, DOM-free, deterministic, Node-safe.
//
// buildNav samples walkable floor points on a ~1 m grid over the map bounds, with multi-level
// support, and links them with the moves a runner can really make:
//
//   * FLOORS come from the collision triangles themselves (not from physics rays: Rapier flips a
//     ray's normal toward the ray origin, so a ray cannot tell a floor from the underside of a
//     slab). Every collision triangle is binned by its XZ footprint; a column query returns every
//     surface crossing the vertical line (x, z) with its TRUE (winding) normal. A floor is an
//     up-facing surface with ny ≥ 0.7 and ≥ 1.25 m of free headroom (a sphere sweep), that is not
//     inside a solid (the first surface above it must face down, or be absent), has footing under
//     the capsule and no wall inside the capsule radius (nodes near a wall are nudged off it).
//   * WALK edges (kind 0) join grid neighbours when the ground between them is continuous (every
//     0.25 m sample is a walkable floor, no rise above the step height between samples) and two
//     sphere sweeps at knee and chest height find no wall.
//   * DROP edges (kind 1) go one way off a lip, down 0.35–3.5 m, when the air over the lip is clear.
//   * JUMP edges (kind 2) go up 0.35–1.0 m onto a ledge, or over a low obstacle (≤ 1.1 m) to the
//     same level, when the up-and-over sweep is clear (MOVE.jump apex ≈ 1.28 m).
//   * CLIMB edges (kind 3) go up a PAINTABLE wall 1.05–3.0 m tall to the floor on top (wall-slick).
//     Each carries a climb record (contact point, face normal, base and top height) so a bot knows
//     which wall to dye before it slicks up it; bots only take one after painting the wall.
//
// A* uses a binary heap ordered by (f, h, node id) — an f-tie goes to the node nearer the goal, which is
// rotation-invariant (both crews get mirrored path shapes); the id breaks only exact ties — and an
// admissible horizontal-distance heuristic (every edge costs ≥ its horizontal length).
// nearest() walks a 2 m XZ bucket grid and prefers nodes on the query's own level.
//
// CHANGED(MAPSIM) (CONTRACT_P6_11 §19), all additive; a map without the phase 7–8 features (Pier 18) builds the
// exact graph it did before:
//   * floors a node may stand on: paint_*, the spawn pads, and the walkable unpaintable floors col_* (stair
//     wedges), grate_* (catwalks) and conveyor_* belt tops. Physics queries see grates (runners collide).
//   * STAIRS: on a col_ surface the footing ring tolerances follow the surface slope and walk links may climb
//     up to MOVE.maxSlopeDeg (a stair wedge is ≈ 31–36°), so multi-floor staircases link up.
//   * CONVEYORS: a walk edge over a belt costs length × walk / (walk + belt·dir) (with the belt cheaper, against
//     it dearer); the A* heuristic is scaled by the smallest such factor, so it stays admissible.
//   * SPRINGS: no node and no walk footing within a pad's disc + 0.55 m (a walk never launches by accident;
//     ground() answers NaN there too, so the bots' safe-step test keeps them off the pads). A SPRING edge (kind 4,
//     EDGE_SPRING) goes from an approach node 1.6–3.65 m from the pad, whose straight line to the landing node
//     crosses the pad centre (≤ 0.45 m off it), to the node nearest the landing point of the arc simulated from
//     the pad centre (runner ballistics: MOVE.gravity, trapezoid steps of TICK). A bot drives it like any
//     non-walk edge: it steers straight at the landing node — it walks onto the pad, the runner launches itself,
//     flies ballistic and lands next to the target node.
//   * OOB: no node and no walk footing inside an oob_ volume (± 5 cm).
//   * pad radius: maps.json spawnpad brushes, else (layout maps) spawns.<side>.padRadius, else 2.2 m.
//   * drops / jumps need landing room (the floor goes on 0.7 m past the target, not into oob_, not onto a spring
//     pad); a jump over a tall block needs a wider landing column; a climb needs no overhang above the wall.
//   * islands (node groups linked to no spawn by any edge, either way) are dropped at the end (stats.pruned).

import type { MapDef } from '../data.ts';
import type { MapFeatures, MapGeometry, MapOob } from '../mapgeo.ts';
import { conveyorAt, featuresOf } from '../mapgeo.ts';
import type { PhysicsWorld } from '../physics.ts';
import { MOVE, TICK } from '../config.ts';

export const EDGE_WALK = 0;
export const EDGE_DROP = 1;
export const EDGE_JUMP = 2;
export const EDGE_CLIMB = 3;
/** CHANGED(MAPSIM): approach node → landing node across a tide-spring pad (walk onto the pad; the runner launches itself) */
export const EDGE_SPRING = 4;

export interface NavClimb {
  /** wall contact point (on the face, at the base node's height + 0.5) */
  cx: number; cz: number;
  /** horizontal unit normal of the wall face (pointing back toward the base node) */
  nx: number; nz: number;
  /** base floor y and top floor y */
  y0: number; y1: number;
}

export interface NavGraph {
  nodes: number;
  x: Float32Array; y: Float32Array; z: Float32Array;   // node positions (walkable floor points, ~1 m grid, multi-level)
  edgeStart: Int32Array; edgeTo: Int32Array; edgeCost: Float32Array; edgeKind: Uint8Array; // CSR; kind 0 walk, 1 drop, 2 jump, 3 wall-slick climb, 4 spring
  nearest(x: number, y: number, z: number): number;          // node id or -1
  path(from: number, to: number, out: number[], extraCost?: (edge: number) => number): boolean;     // A*, deterministic tie-breaks
  // ── CHANGED(BOTS): additive extras (see CONTRACT §10.2 note) ──
  /** edge → index into climbs (kind 3 only), else −1 */
  edgeClimb: Int32Array;
  climbs: NavClimb[];
  /** highest walkable floor at (x, z) with y in [yLo, yHi], or NaN (true-normal column query) */
  ground(x: number, z: number, yLo: number, yHi: number): number;
  /** can a runner walk the straight line a → b (continuous footing + no wall at knee/chest)? */
  walkable(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  /** build statistics */
  stats: { buildMs: number; columns: number; nudged: number; edgesByKind: [number, number, number, number, number]; nodeMs: number; open: number; pruned?: number };
}

// ─────────────────────────────── tuning ───────────────────────────────
const GRID = 1.0;              // node spacing (m)
const FLOOR_NY = 0.7;          // walkable surface
const HEADROOM = 1.25;         // free height a node needs above the floor
const CAP_R = 0.3;             // clearance radius used by the sweeps (MOVE.radius 0.32 − a little skin)
const KNEE_Y = MOVE.stepHeight + CAP_R + 0.02;   // centre of the lower sweep sphere (bottom above step height)
const CHEST_R = 0.2;
const CHEST_Y = 1.15 - CHEST_R;                   // centre of the upper sweep sphere (top at the capsule top)
const STEP = MOVE.stepHeight;                     // 0.35
const DROP_MAX = 3.5;
const JUMP_UP_MAX = 1.0;
const JUMP_OVER_MAX = 1.1;
const CLIMB_MIN = 1.05;
const CLIMB_MAX = 3.0;
const NUDGE = 0.4;
/** CHANGED(MAPSIM): clearance of a jump's landing column (the capsule radius + 0.14 m) */
const LAND_R = MOVE.radius + 0.14;
/** CHANGED(MAPSIM): a drop / jump lands with speed: the floor must go on this far past the target node (m) */
const LAND_ROOM = 0.7;
/** CHANGED(MAPSIM): a drop / jump target stays this far outside a spring disc (m): an overshoot must not launch */
const SPRING_LAND = 1.4;
/** a node's own clearance: the real capsule (MOVE.radius) + the KCC skin + a hair */
const NODE_R = MOVE.radius + MOVE.skin + 0.01;
const NODE_KNEE = STEP + NODE_R + 0.02;

const EPS = 1e-6;
const RING_IN = new Float64Array(8), RING_OUT = new Float64Array(16);
for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; RING_IN[k * 2] = Math.cos(a) * 0.2; RING_IN[k * 2 + 1] = Math.sin(a) * 0.2; }
for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; RING_OUT[k * 2] = Math.cos(a) * 0.45; RING_OUT[k * 2 + 1] = Math.sin(a) * 0.45; }

/** physics queries of the nav see grates (runner collision) */
const GR = { grates: true } as const;
/** no node / walk footing within a spring disc + this margin (m) */
const SPRING_KEEP = 0.55;

// ─────────────────────────────── exclusion zones (CHANGED(MAPSIM)) ───────────────────────────────
interface Excl { n: number; x: Float64Array; y: Float64Array; z: Float64Array; r2: Float64Array; oob: MapOob[] }

function exclusionOf(f: MapFeatures): Excl | null {
  if (!f.springs.length && !f.oob.length) return null;
  const n = f.springs.length;
  const ex: Excl = { n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), r2: new Float64Array(n), oob: f.oob };
  for (let i = 0; i < n; i++) {
    const s = f.springs[i];
    ex.x[i] = s.x; ex.y[i] = s.y; ex.z[i] = s.z; ex.r2[i] = (s.r + SPRING_KEEP) ** 2;
  }
  return ex;
}

/** inside a spring keep-out disc (±1 m of the pad top) or an oob_ volume (±5 cm) */
function excluded(ex: Excl, x: number, y: number, z: number): boolean {
  for (let i = 0; i < ex.n; i++) {
    const dx = x - ex.x[i], dz = z - ex.z[i];
    if (dx * dx + dz * dz <= ex.r2[i] && Math.abs(y - ex.y[i]) < 1.0) return true;
  }
  const O = ex.oob;
  for (let i = 0; i < O.length; i++) {
    const o = O[i];
    if (x >= o.min[0] && x <= o.max[0] && z >= o.min[2] && z <= o.max[2] && y >= o.min[1] - 0.05 && y <= o.max[1] + 0.05) return true;
  }
  return false;
}

type Soup = { positions: Float32Array; indices: Uint32Array };
function mergeSoups(list: Soup[]): Soup {
  let nv = 0, ni = 0;
  for (const s of list) { nv += s.positions.length; ni += s.indices.length; }
  const positions = new Float32Array(nv), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const s of list) {
    positions.set(s.positions, vo);
    for (let k = 0; k < s.indices.length; k++) indices[io + k] = s.indices[k] + vo / 3;
    vo += s.positions.length; io += s.indices.length;
  }
  return { positions, indices };
}
/** a flat 9-floats-per-triangle list as a soup */
function trisSoup(t: Float32Array): Soup {
  const indices = new Uint32Array(t.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions: t, indices };
}

// ─────────────────────────────── triangle column index ───────────────────────────────
interface TriIndex {
  // per triangle: plane y = (d − nx·x − nz·z)/ny, true unit normal, XZ vertices
  nx: Float32Array; ny: Float32Array; nz: Float32Array; d: Float64Array;
  ax: Float32Array; az: Float32Array; bx: Float32Array; bz: Float32Array; cx: Float32Array; cz: Float32Array;
  ox: number; oz: number; cell: number; w: number; h: number;
  start: Int32Array; items: Int32Array;
}

function buildTriIndex(pos: Float32Array, idx: Uint32Array, cell: number): TriIndex {
  const T = (idx.length / 3) | 0;
  const nx = new Float32Array(T), ny = new Float32Array(T), nz = new Float32Array(T);
  const d = new Float64Array(T);
  const ax = new Float32Array(T), az = new Float32Array(T), bx = new Float32Array(T), bz = new Float32Array(T);
  const cx = new Float32Array(T), cz = new Float32Array(T);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < minX) minX = pos[i]; if (pos[i] > maxX) maxX = pos[i];
    if (pos[i + 2] < minZ) minZ = pos[i + 2]; if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
  }
  const ox = Math.floor(minX) - 1, oz = Math.floor(minZ) - 1;
  const w = Math.max(1, Math.ceil((maxX - ox) / cell) + 1), h = Math.max(1, Math.ceil((maxZ - oz) / cell) + 1);
  const counts = new Int32Array(w * h + 1);
  const keep = new Uint8Array(T);
  for (let t = 0; t < T; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-9) continue;
    gx /= l; gy /= l; gz /= l;
    nx[t] = gx; ny[t] = gy; nz[t] = gz;
    d[t] = gx * pos[a] + gy * pos[a + 1] + gz * pos[a + 2];
    ax[t] = pos[a]; az[t] = pos[a + 2]; bx[t] = pos[b]; bz[t] = pos[b + 2]; cx[t] = pos[c]; cz[t] = pos[c + 2];
    if (Math.abs(gy) < 1e-3) continue;          // vertical: no XZ footprint
    keep[t] = 1;
    const x0 = Math.floor((Math.min(pos[a], pos[b], pos[c]) - ox) / cell), x1 = Math.floor((Math.max(pos[a], pos[b], pos[c]) - ox) / cell);
    const z0 = Math.floor((Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - oz) / cell), z1 = Math.floor((Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) - oz) / cell);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) counts[iz * w + ix + 1]++;
  }
  for (let i = 1; i <= w * h; i++) counts[i] += counts[i - 1];
  const start = counts.slice();
  const fill = counts.slice(0, w * h);
  const items = new Int32Array(start[w * h]);
  for (let t = 0; t < T; t++) {
    if (!keep[t]) continue;
    const x0 = Math.floor((Math.min(ax[t], bx[t], cx[t]) - ox) / cell), x1 = Math.floor((Math.max(ax[t], bx[t], cx[t]) - ox) / cell);
    const z0 = Math.floor((Math.min(az[t], bz[t], cz[t]) - oz) / cell), z1 = Math.floor((Math.max(az[t], bz[t], cz[t]) - oz) / cell);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) items[fill[iz * w + ix]++] = t;
  }
  return { nx, ny, nz, d, ax, az, bx, bz, cx, cz, ox, oz, cell, w, h, start, items };
}

/** Surfaces crossing the vertical line (x, z): ys[k], nys[k] (true normal y), sorted by y descending. Returns count. */
function column(ti: TriIndex, x: number, z: number, ys: Float64Array, nys: Float64Array): number {
  const ix = Math.floor((x - ti.ox) / ti.cell), iz = Math.floor((z - ti.oz) / ti.cell);
  if (ix < 0 || iz < 0 || ix >= ti.w || iz >= ti.h) return 0;
  const c = iz * ti.w + ix;
  let n = 0;
  for (let k = ti.start[c], e = ti.start[c + 1]; k < e; k++) {
    const t = ti.items[k];
    // XZ point-in-triangle (inclusive, orientation-independent)
    const x0 = ti.ax[t], z0 = ti.az[t], x1 = ti.bx[t], z1 = ti.bz[t], x2 = ti.cx[t], z2 = ti.cz[t];
    const d0 = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
    const d1 = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
    const d2 = (x0 - x2) * (z - z2) - (z0 - z2) * (x - x2);
    const neg = d0 < -EPS || d1 < -EPS || d2 < -EPS;
    const pos = d0 > EPS || d1 > EPS || d2 > EPS;
    if (neg && pos) continue;
    const ny = ti.ny[t];
    const y = (ti.d[t] - ti.nx[t] * x - ti.nz[t] * z) / ny;
    // dedupe (shared edges report the same surface twice)
    let dup = false;
    for (let j = 0; j < n; j++) if (Math.abs(ys[j] - y) < 1e-3 && (nys[j] > 0) === (ny > 0)) { dup = true; break; }
    if (dup || n >= ys.length) continue;
    // insertion sort, descending y
    let j = n++;
    while (j > 0 && ys[j - 1] < y) { ys[j] = ys[j - 1]; nys[j] = nys[j - 1]; j--; }
    ys[j] = y; nys[j] = ny;
  }
  return n;
}

// ─────────────────────────────── paint-wall index (for climb edges) ───────────────────────────────
interface PaintWalls { tris: Float32Array; count: number; ox: number; oy: number; oz: number; nxC: number; nyC: number; nzC: number; start: Int32Array; items: Int32Array }

function buildPaintWalls(geo: MapGeometry, floorMinNy: number): PaintWalls {
  const P = geo.paint.positions, I = geo.paint.indices;
  const T = (I.length / 3) | 0;
  const sel: number[] = [];
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-9) continue;
    if (Math.abs(gy / l) < floorMinNy) sel.push(t);
  }
  const tris = new Float32Array(sel.length * 9);
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let k = 0; k < sel.length; k++) {
    const t = sel[k];
    for (let v = 0; v < 3; v++) {
      const o = I[t * 3 + v] * 3;
      tris[k * 9 + v * 3] = P[o]; tris[k * 9 + v * 3 + 1] = P[o + 1]; tris[k * 9 + v * 3 + 2] = P[o + 2];
      mnx = Math.min(mnx, P[o]); mny = Math.min(mny, P[o + 1]); mnz = Math.min(mnz, P[o + 2]);
      mxx = Math.max(mxx, P[o]); mxy = Math.max(mxy, P[o + 1]); mxz = Math.max(mxz, P[o + 2]);
    }
  }
  if (!sel.length) { mnx = mny = mnz = 0; mxx = mxy = mxz = 1; }
  const ox = Math.floor(mnx) - 1, oy = Math.floor(mny) - 1, oz = Math.floor(mnz) - 1;
  const nxC = Math.ceil(mxx - ox) + 2, nyC = Math.ceil(mxy - oy) + 2, nzC = Math.ceil(mxz - oz) + 2;
  const cells = nxC * nyC * nzC;
  const counts = new Int32Array(cells + 1);
  const range = (k: number, fn: (c: number) => void): void => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const px = tris[k * 9 + v * 3], py = tris[k * 9 + v * 3 + 1], pz = tris[k * 9 + v * 3 + 2];
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); y1 = Math.max(y1, py); z1 = Math.max(z1, pz);
    }
    for (let iz = Math.floor(z0 - oz); iz <= Math.floor(z1 - oz); iz++)
      for (let iy = Math.floor(y0 - oy); iy <= Math.floor(y1 - oy); iy++)
        for (let ix = Math.floor(x0 - ox); ix <= Math.floor(x1 - ox); ix++) fn((iz * nyC + iy) * nxC + ix);
  };
  for (let k = 0; k < sel.length; k++) range(k, (c) => { counts[c + 1]++; });
  for (let i = 1; i <= cells; i++) counts[i] += counts[i - 1];
  const start = counts.slice();
  const fill = counts.slice(0, cells);
  const items = new Int32Array(start[cells]);
  for (let k = 0; k < sel.length; k++) range(k, (c) => { items[fill[c]++] = k; });
  return { tris, count: sel.length, ox, oy, oz, nxC, nyC, nzC, start, items };
}

/** squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5) */
function pointTri2(px: number, py: number, pz: number, t: Float32Array, o: number): number {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
            } else {
              const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
              qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

function onPaintWall(pw: PaintWalls, x: number, y: number, z: number, tol: number): boolean {
  // every cell the tolerance sphere touches: a wall lying exactly on a cell boundary is binned on one
  // side only, and a query point 1 cm in front of it may sit in the other cell
  const ix0 = Math.max(0, Math.floor(x - tol - pw.ox)), ix1 = Math.min(pw.nxC - 1, Math.floor(x + tol - pw.ox));
  const iy0 = Math.max(0, Math.floor(y - tol - pw.oy)), iy1 = Math.min(pw.nyC - 1, Math.floor(y + tol - pw.oy));
  const iz0 = Math.max(0, Math.floor(z - tol - pw.oz)), iz1 = Math.min(pw.nzC - 1, Math.floor(z + tol - pw.oz));
  const t2 = tol * tol;
  for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
    const c = (iz * pw.nyC + iy) * pw.nxC + ix;
    for (let k = pw.start[c], e = pw.start[c + 1]; k < e; k++) if (pointTri2(x, y, z, pw.tris, pw.items[k] * 9) <= t2) return true;
  }
  return false;
}

// ─────────────────────────────── the graph ───────────────────────────────
class Nav implements NavGraph {
  nodes = 0;
  x: Float32Array; y: Float32Array; z: Float32Array;
  edgeStart: Int32Array; edgeTo: Int32Array; edgeCost: Float32Array; edgeKind: Uint8Array;
  edgeClimb: Int32Array;
  climbs: NavClimb[];
  stats: NavGraph['stats'];

  private readonly ti: TriIndex;
  private readonly physics: PhysicsWorld;
  /** CHANGED(MAPSIM): spring keep-out discs + oob volumes (null: none), and the A* heuristic scale (conveyors) */
  private readonly ex: Excl | null;
  private readonly hScale: number;
  private readonly colY = new Float64Array(64);
  private readonly colN = new Float64Array(64);
  // nearest() buckets
  private readonly bOx: number; private readonly bOz: number; private readonly bW: number; private readonly bH: number;
  private readonly bStart: Int32Array; private readonly bItems: Int32Array;
  // A* scratch
  private readonly g: Float64Array; private readonly came: Int32Array; private readonly seen: Uint32Array; private readonly closed: Uint32Array;
  private epoch = 0;
  private heapF: Float64Array; private heapH: Float64Array; private heapN: Int32Array; private heapLen = 0;

  constructor(ti: TriIndex, physics: PhysicsWorld, x: Float32Array, y: Float32Array, z: Float32Array,
    edgeStart: Int32Array, edgeTo: Int32Array, edgeCost: Float32Array, edgeKind: Uint8Array, edgeClimb: Int32Array, climbs: NavClimb[],
    stats: NavGraph['stats'], ex: Excl | null, hScale: number) {
    this.ti = ti; this.physics = physics;
    this.ex = ex; this.hScale = hScale;
    this.nodes = x.length; this.x = x; this.y = y; this.z = z;
    this.edgeStart = edgeStart; this.edgeTo = edgeTo; this.edgeCost = edgeCost; this.edgeKind = edgeKind;
    this.edgeClimb = edgeClimb; this.climbs = climbs; this.stats = stats;
    // buckets (2 m XZ)
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    for (let i = 0; i < this.nodes; i++) { mnx = Math.min(mnx, x[i]); mxx = Math.max(mxx, x[i]); mnz = Math.min(mnz, z[i]); mxz = Math.max(mxz, z[i]); }
    if (!this.nodes) { mnx = mnz = 0; mxx = mxz = 1; }
    this.bOx = Math.floor(mnx) - 2; this.bOz = Math.floor(mnz) - 2;
    this.bW = Math.ceil((mxx - this.bOx) / 2) + 2; this.bH = Math.ceil((mxz - this.bOz) / 2) + 2;
    const cnt = new Int32Array(this.bW * this.bH + 1);
    for (let i = 0; i < this.nodes; i++) cnt[this.bucket(x[i], z[i]) + 1]++;
    for (let i = 1; i < cnt.length; i++) cnt[i] += cnt[i - 1];
    this.bStart = cnt.slice();
    const fill = cnt.slice(0, this.bW * this.bH);
    this.bItems = new Int32Array(this.nodes);
    for (let i = 0; i < this.nodes; i++) this.bItems[fill[this.bucket(x[i], z[i])]++] = i;
    const n = this.nodes;
    this.g = new Float64Array(n); this.came = new Int32Array(n); this.seen = new Uint32Array(n); this.closed = new Uint32Array(n);
    this.heapF = new Float64Array(Math.max(16, edgeTo.length + 1)); this.heapH = new Float64Array(Math.max(16, edgeTo.length + 1));
    this.heapN = new Int32Array(Math.max(16, edgeTo.length + 1));
  }

  private bucket(x: number, z: number): number {
    let bx = Math.floor((x - this.bOx) / 2), bz = Math.floor((z - this.bOz) / 2);
    if (bx < 0) bx = 0; else if (bx >= this.bW) bx = this.bW - 1;
    if (bz < 0) bz = 0; else if (bz >= this.bH) bz = this.bH - 1;
    return bz * this.bW + bx;
  }

  nearest(x: number, y: number, z: number): number {
    if (!this.nodes) return -1;
    let bx = Math.floor((x - this.bOx) / 2), bz = Math.floor((z - this.bOz) / 2);
    let best = -1, bestD = Infinity;
    // prefer the query's own level: a node above the feet costs 9·dy², below 2.25·dy²
    const score = (i: number): number => {
      const dx = this.x[i] - x, dz = this.z[i] - z, dy = this.y[i] - y;
      return dx * dx + dz * dz + (dy > 0 ? 9 : 2.25) * dy * dy;
    };
    for (let ring = 0; ring <= 12; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = bx + dx, cz = bz + dz;
          if (cx < 0 || cz < 0 || cx >= this.bW || cz >= this.bH) continue;
          const c = cz * this.bW + cx;
          for (let k = this.bStart[c], e = this.bStart[c + 1]; k < e; k++) {
            const i = this.bItems[k];
            const s = score(i);
            if (s < bestD || (s === bestD && i < best)) { bestD = s; best = i; }
          }
        }
      }
      // every node in ring r+1 is at least (2r) m away horizontally
      const minNext = 2 * ring;
      if (best >= 0 && bestD <= minNext * minNext) break;
    }
    return best;
  }

  path(from: number, to: number, out: number[], extraCost?: (edge: number) => number): boolean {
    out.length = 0;
    const n = this.nodes;
    if (from < 0 || to < 0 || from >= n || to >= n) return false;
    if (from === to) { out.push(from); return true; }
    this.epoch = (this.epoch + 1) >>> 0;
    if (this.epoch === 0) { this.seen.fill(0); this.closed.fill(0); this.epoch = 1; }
    const ep = this.epoch;
    const X = this.x, Z = this.z;
    const tx = X[to], tz = Z[to];
    const hs = this.hScale;
    const h = hs === 1 ? (i: number): number => Math.hypot(X[i] - tx, Z[i] - tz) : (i: number): number => Math.hypot(X[i] - tx, Z[i] - tz) * hs;
    this.heapLen = 0;
    this.g[from] = 0; this.came[from] = -1; this.seen[from] = ep;
    this.push(h(from), h(from), from);
    while (this.heapLen > 0) {
      const cur = this.pop();
      if (this.closed[cur] === ep) continue;
      this.closed[cur] = ep;
      if (cur === to) {
        for (let i = to; i >= 0; i = this.came[i]) out.push(i);
        out.reverse();
        return true;
      }
      const gc = this.g[cur];
      for (let e = this.edgeStart[cur], end = this.edgeStart[cur + 1]; e < end; e++) {
        const nb = this.edgeTo[e];
        if (this.closed[nb] === ep) continue;
        let c = this.edgeCost[e];
        if (extraCost) { const x = extraCost(e); if (!(x < Infinity)) continue; c += x; }
        const ng = gc + c;
        if (this.seen[nb] !== ep || ng < this.g[nb]) {
          this.seen[nb] = ep; this.g[nb] = ng; this.came[nb] = cur;
          const hn = h(nb);
          this.push(ng + hn, hn, nb);
        }
      }
    }
    return false;
  }

  // binary min-heap on (f, h, id): an f-tie goes to the node nearer the goal (rotation-invariant, so both
  // crews get the same path shapes on a rot180 map); the node id only breaks exact (f, h) ties
  private less(i: number, j: number): boolean {
    const a = this.heapF[i], b = this.heapF[j];
    if (a !== b) return a < b;
    const ha = this.heapH[i], hb = this.heapH[j];
    if (ha !== hb) return ha < hb;
    return this.heapN[i] < this.heapN[j];
  }
  private push(f: number, hh: number, id: number): void {
    if (this.heapLen >= this.heapF.length) {
      const nf = new Float64Array(this.heapF.length * 2); nf.set(this.heapF); this.heapF = nf;
      const nh = new Float64Array(this.heapH.length * 2); nh.set(this.heapH); this.heapH = nh;
      const nn = new Int32Array(this.heapN.length * 2); nn.set(this.heapN); this.heapN = nn;
    }
    let i = this.heapLen++;
    this.heapF[i] = f; this.heapH[i] = hh; this.heapN[i] = id;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  private pop(): number {
    const top = this.heapN[0];
    const last = --this.heapLen;
    if (last > 0) {
      this.heapF[0] = this.heapF[last]; this.heapH[0] = this.heapH[last]; this.heapN[0] = this.heapN[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < last && this.less(l, m)) m = l;
        if (r < last && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(i: number, j: number): void {
    const f = this.heapF[i]; this.heapF[i] = this.heapF[j]; this.heapF[j] = f;
    const hh = this.heapH[i]; this.heapH[i] = this.heapH[j]; this.heapH[j] = hh;
    const n = this.heapN[i]; this.heapN[i] = this.heapN[j]; this.heapN[j] = n;
  }

  ground(x: number, z: number, yLo: number, yHi: number): number {
    const n = column(this.ti, x, z, this.colY, this.colN);
    for (let k = 0; k < n; k++) {
      const y = this.colY[k];
      if (y > yHi) continue;
      if (y < yLo) break;
      if (this.colN[k] >= FLOOR_NY) return this.ex && excluded(this.ex, x, y, z) ? NaN : y;
      if (this.colN[k] < 0) continue;       // underside of something: keep looking below
      return NaN;                            // a steep up-facing face is the top surface here
    }
    return NaN;
  }

  walkable(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    return walkLine(this.ti, this.physics, this.colY, this.colN, ax, ay, az, bx, by, bz, this.ex);
  }
}

/** continuous footing a → b: every 0.25 m sample is walkable floor, no rise above the step height between samples */
function footing(ti: TriIndex, colY: Float64Array, colN: Float64Array,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, ex: Excl | null = null): boolean {
  const hd = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(hd / 0.25));
  let prev = ay;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
    const expect = ay + (by - ay) * t;
    const g = groundNear(ti, colY, colN, px, pz, prev + STEP + 0.02, prev - STEP - 0.02);
    if (!(g === g)) return false;
    if (Math.abs(g - expect) > 0.45) return false;
    if (ex && excluded(ex, px, g, pz)) return false;
    prev = g;
  }
  if (ex && excluded(ex, bx, by, bz)) return false;
  return Math.abs(by - prev) <= STEP + 0.02;
}

/** knee + chest sweeps a → b find no wall */
function sweepClear(physics: PhysicsWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const l = Math.hypot(bx - ax, by - ay, bz - az);
  if (l < 1e-4) return true;
  if (physics.sphereCast(ax, ay + KNEE_Y, az, bx - ax, by - ay, bz - az, CAP_R, l, GR)) return false;
  if (physics.sphereCast(ax, ay + CHEST_Y, az, bx - ax, by - ay, bz - az, CHEST_R, l, GR)) return false;
  return true;
}

/** continuous footing a → b (samples every 0.25 m) + knee/chest sweeps clear */
function walkLine(ti: TriIndex, physics: PhysicsWorld, colY: Float64Array, colN: Float64Array,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, ex: Excl | null = null): boolean {
  return footing(ti, colY, colN, ax, ay, az, bx, by, bz, ex) && sweepClear(physics, ax, ay, az, bx, by, bz);
}

// ─────────────────────────────── clutter index (every collision triangle's AABB, XZ-binned) ───────────────────────────────
interface Clutter { box: Float32Array; ox: number; oz: number; w: number; h: number; start: Int32Array; items: Int32Array }

function buildClutter(pos: Float32Array, idx: Uint32Array): Clutter {
  const T = (idx.length / 3) | 0;
  const box = new Float32Array(T * 6);
  let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
  for (let t = 0; t < T; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const o = idx[t * 3 + v] * 3;
      x0 = Math.min(x0, pos[o]); x1 = Math.max(x1, pos[o]); y0 = Math.min(y0, pos[o + 1]); y1 = Math.max(y1, pos[o + 1]);
      z0 = Math.min(z0, pos[o + 2]); z1 = Math.max(z1, pos[o + 2]);
    }
    box.set([x0, y0, z0, x1, y1, z1], t * 6);
    mnx = Math.min(mnx, x0); mnz = Math.min(mnz, z0); mxx = Math.max(mxx, x1); mxz = Math.max(mxz, z1);
  }
  if (!T) { mnx = mnz = 0; mxx = mxz = 1; }
  const ox = Math.floor(mnx) - 1, oz = Math.floor(mnz) - 1;
  const w = Math.ceil(mxx - ox) + 2, h = Math.ceil(mxz - oz) + 2;
  const counts = new Int32Array(w * h + 1);
  const each = (t: number, fn: (c: number) => void): void => {
    const x0 = Math.floor(box[t * 6] - ox), x1 = Math.floor(box[t * 6 + 3] - ox);
    const z0 = Math.floor(box[t * 6 + 2] - oz), z1 = Math.floor(box[t * 6 + 5] - oz);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) fn(iz * w + ix);
  };
  for (let t = 0; t < T; t++) each(t, (c) => { counts[c + 1]++; });
  for (let i = 1; i <= w * h; i++) counts[i] += counts[i - 1];
  const start = counts.slice();
  const fill = counts.slice(0, w * h);
  const items = new Int32Array(start[w * h]);
  for (let t = 0; t < T; t++) each(t, (c) => { items[fill[c]++] = t; });
  return { box, ox, oz, w, h, start, items };
}

/** true when no collision triangle's AABB touches the box [x±r] × [y0, y1] × [z±r] */
function openAround(cl: Clutter, x: number, y0: number, y1: number, z: number, r: number): boolean {
  const ix0 = Math.max(0, Math.floor(x - r - cl.ox)), ix1 = Math.min(cl.w - 1, Math.floor(x + r - cl.ox));
  const iz0 = Math.max(0, Math.floor(z - r - cl.oz)), iz1 = Math.min(cl.h - 1, Math.floor(z + r - cl.oz));
  const B = cl.box;
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
    const c = iz * cl.w + ix;
    for (let k = cl.start[c], e = cl.start[c + 1]; k < e; k++) {
      const o = cl.items[k] * 6;
      if (B[o + 4] < y0 || B[o + 1] > y1) continue;
      if (B[o + 3] < x - r || B[o] > x + r || B[o + 5] < z - r || B[o + 2] > z + r) continue;
      return false;
    }
  }
  return true;
}

/**
 * The walkable floor at (x, z) in the band [lo, hi]: the highest up-facing surface in the band
 * (undersides are ignored) if it is a floor (ny ≥ 0.7), else NaN. No sorting, no allocation.
 */
function groundNear(ti: TriIndex, _colY: Float64Array, _colN: Float64Array, x: number, z: number, hi: number, lo: number): number {
  const ix = Math.floor((x - ti.ox) / ti.cell), iz = Math.floor((z - ti.oz) / ti.cell);
  if (ix < 0 || iz < 0 || ix >= ti.w || iz >= ti.h) return NaN;
  const c = iz * ti.w + ix;
  let bestY = -Infinity, bestFloor = false;
  for (let k = ti.start[c], e = ti.start[c + 1]; k < e; k++) {
    const t = ti.items[k];
    const ny = ti.ny[t];
    if (ny < 0) continue;
    const y = (ti.d[t] - ti.nx[t] * x - ti.nz[t] * z) / ny;
    if (y > hi || y < lo || y < bestY - 1e-3) continue;
    const x0 = ti.ax[t], z0 = ti.az[t], x1 = ti.bx[t], z1 = ti.bz[t], x2 = ti.cx[t], z2 = ti.cz[t];
    const d0 = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
    const d1 = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
    const d2 = (x0 - x2) * (z - z2) - (z0 - z2) * (x - x2);
    if ((d0 < -EPS || d1 < -EPS || d2 < -EPS) && (d0 > EPS || d1 > EPS || d2 > EPS)) continue;
    const fl = ny >= FLOOR_NY;
    if (y > bestY + 1e-3) { bestY = y; bestFloor = fl; }
    else if (fl) bestFloor = true;            // same height (a shared edge): a floor wins
  }
  return bestY > -Infinity && bestFloor ? bestY : NaN;
}

/** true normal-y of the first surface strictly above y at (x, z) (0 when there is none) — one pass */
function firstAboveNy(ti: TriIndex, x: number, z: number, y: number): number {
  const ix = Math.floor((x - ti.ox) / ti.cell), iz = Math.floor((z - ti.oz) / ti.cell);
  if (ix < 0 || iz < 0 || ix >= ti.w || iz >= ti.h) return 0;
  const c = iz * ti.w + ix;
  let bestY = Infinity, bestNy = 0;
  for (let k = ti.start[c], e = ti.start[c + 1]; k < e; k++) {
    const t = ti.items[k];
    const ny = ti.ny[t];
    const yy = (ti.d[t] - ti.nx[t] * x - ti.nz[t] * z) / ny;
    if (yy <= y || yy > bestY + 1e-3) continue;
    const x0 = ti.ax[t], z0 = ti.az[t], x1 = ti.bx[t], z1 = ti.bz[t], x2 = ti.cx[t], z2 = ti.cz[t];
    const d0 = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
    const d1 = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
    const d2 = (x0 - x2) * (z - z2) - (z0 - z2) * (x - x2);
    if ((d0 < -EPS || d1 < -EPS || d2 < -EPS) && (d0 > EPS || d1 > EPS || d2 > EPS)) continue;
    if (yy < bestY - 1e-3) { bestY = yy; bestNy = ny; }
    else if (ny < 0) bestNy = ny;          // same height (shared edge): a down-facing face wins (not inside)
  }
  return bestNy;
}

/** the obstacle top at (x, z): the highest surface if it is above hi, else the highest up-facing one in [lo, hi] (−Infinity if none) */
function topAt(ti: TriIndex, x: number, z: number, lo: number, hi: number): number {
  const ix = Math.floor((x - ti.ox) / ti.cell), iz = Math.floor((z - ti.oz) / ti.cell);
  if (ix < 0 || iz < 0 || ix >= ti.w || iz >= ti.h) return -Infinity;
  const c = iz * ti.w + ix;
  let maxAll = -Infinity, bandUp = -Infinity;
  for (let k = ti.start[c], e = ti.start[c + 1]; k < e; k++) {
    const t = ti.items[k];
    const ny = ti.ny[t];
    const yy = (ti.d[t] - ti.nx[t] * x - ti.nz[t] * z) / ny;
    if (yy <= maxAll && (ny <= 0 || yy <= bandUp || yy < lo || yy > hi)) continue;
    const x0 = ti.ax[t], z0 = ti.az[t], x1 = ti.bx[t], z1 = ti.bz[t], x2 = ti.cx[t], z2 = ti.cz[t];
    const d0 = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
    const d1 = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
    const d2 = (x0 - x2) * (z - z2) - (z0 - z2) * (x - x2);
    if ((d0 < -EPS || d1 < -EPS || d2 < -EPS) && (d0 > EPS || d1 > EPS || d2 > EPS)) continue;
    if (yy > maxAll) maxAll = yy;
    if (ny > 0 && yy >= lo && yy <= hi && yy > bandUp) bandUp = yy;
  }
  return maxAll > hi ? maxAll : bandUp;
}

/**
 * CHANGED(MAPSIM): where a runner launched from (x, y, z) at (vx, vy, vz) lands — the runner's own ballistics
 * (MOVE.gravity, trapezoid steps of TICK, no drag). Landing = the first walkable floor the feet cross while
 * falling; a steep hit (the capsule's chest sphere against a wall) or a fall below killY → null.
 */
function springArc(ti: TriIndex, colY: Float64Array, colN: Float64Array, physics: PhysicsWorld,
  x: number, y: number, z: number, vx: number, vy: number, vz: number, killY: number): { x: number; y: number; z: number; t: number } | null {
  y += MOVE.skin;
  for (let i = 1; i <= 900; i++) {
    const v0 = vy;
    vy = Math.max(-MOVE.maxFall, vy - MOVE.gravity * TICK);
    const dy = 0.5 * (v0 + vy) * TICK;
    const nx = x + vx * TICK, ny = y + dy, nz = z + vz * TICK;
    const hit = physics.sphereCast(x, y + CHEST_Y, z, nx - x, dy, nz - z, CHEST_R, Math.hypot(nx - x, dy, nz - z), GR);
    if (hit && Math.abs(hit.ny) < FLOOR_NY) return null;
    if (vy < 0) {
      const g = groundNear(ti, colY, colN, nx, nz, y + 0.02, ny - 0.02);
      if (g === g) return { x: nx, y: g, z: nz, t: i * TICK };
    }
    x = nx; y = ny; z = nz;
    if (y < killY) return null;
  }
  return null;
}

// ─────────────────────────────── builder ───────────────────────────────
export function buildNav(geo: MapGeometry, physics: PhysicsWorld, def: MapDef): NavGraph {
  const t0 = performance.now();
  const F = featuresOf(geo);
  // runner collision = the MAP_SOLID soup + grates (a map without grates uses the soup as is)
  const solid: Soup = F.grates.indices.length ? mergeSoups([geo.collision, F.grates]) : geo.collision;
  const ti = buildTriIndex(solid.positions, solid.indices, 0.5);
  const ex = exclusionOf(F);
  const colY = new Float64Array(64), colN = new Float64Array(64);
  const b = def.bounds ?? { min: [-30, -2, -45], max: [30, 12, 45] };
  const killY = def.killY ?? -1;
  const x0 = b.min[0] + GRID / 2, z0 = b.min[2] + GRID / 2;
  const nxCols = Math.max(1, Math.floor((b.max[0] - b.min[0]) / GRID));
  const nzCols = Math.max(1, Math.floor((b.max[2] - b.min[2]) / GRID));
  const yTop = b.max[1];

  // ── floor test at a point (returns true if a runner can stand at (x, yf, z)) ──
  const inside = (x: number, yf: number, z: number): boolean => firstAboveNy(ti, x, z, yf + 0.02) > 0.05;
  // floors a bot may stand on: paintable floors (paint_*) and the two spawn pads. Unpaintable set
  // dressing (planter soil around a palm trunk, bollard caps, lamp bases) is never a goal or a node.
  // CHANGED(MAPSIM): plus the walkable unpaintable floors — col_ stair wedges, grates, conveyor belt tops.
  const conveyorTops = F.conveyors.map((c) => trisSoup(c.top));
  const floorSoup: Soup = F.col.indices.length || F.grates.indices.length || conveyorTops.length
    ? mergeSoups([geo.paint, F.col, F.grates, ...conveyorTops]) : geo.paint;
  const paintTi = buildTriIndex(floorSoup.positions, floorSoup.indices, 0.5);
  // col_ surfaces (stair wedges): a node there gets slope-aware footing tolerances and steep walk links
  const colTi = F.col.indices.length ? buildTriIndex(F.col.positions, F.col.indices, 0.5) : null;
  const onColFloor = (x: number, yf: number, z: number): boolean => {
    if (!colTi) return false;
    const g = groundNear(colTi, colY, colN, x, z, yf + 0.03, yf - 0.03);
    return g === g;
  };
  let padR = 2.2, padBrush = false;
  for (const br of (def.brushes ?? []) as Array<Record<string, unknown>>) if (br.kind === 'spawnpad' && typeof br.radius === 'number') { padR = br.radius; padBrush = true; }
  const pads = [geo.spawns.A, geo.spawns.B];
  const padRs = [padR, padR];
  if (!padBrush) {
    // layout maps (no inline brushes): maps.json spawns.<side>.padRadius
    const sp = def.spawns as unknown as Record<string, { padRadius?: unknown }> | undefined;
    (['A', 'B'] as const).forEach((side, k) => { const r = sp?.[side]?.padRadius; if (typeof r === 'number' && r > 0) padRs[k] = r; });
  }
  const onPaintOrPad = (x: number, yf: number, z: number): boolean => {
    for (let k = 0; k < 2; k++) { const p = pads[k]; if ((x - p.x) ** 2 + (z - p.z) ** 2 <= padRs[k] * padRs[k] && Math.abs(yf - p.y) < 0.3) return true; }
    const g = groundNear(paintTi, colY, colN, x, z, yf + 0.06, yf - 0.06);
    return g === g;
  };
  const standable = (x: number, yf: number, z: number, ny = 1): boolean => {
    if (yf < killY + 0.5) return false;
    if (ex && excluded(ex, x, yf, z)) return false;
    if (!onPaintOrPad(x, yf, z)) return false;
    if (inside(x, yf, z)) return false;
    // the physics agrees: a ray straight down lands on this floor (not on a lip or an edge beside it)
    const down = physics.raycast(x, yf + 0.3, z, 0, -1, 0, 0.6, GR);
    if (!down || Math.abs(down.y - yf) > 0.04) return false;
    // headroom + capsule clearance: a sphere resting just above the step height, swept to 1.25 m
    if (physics.sphereCast(x, yf + NODE_KNEE, z, 0, 1, 0, NODE_R, Math.max(1e-3, HEADROOM - NODE_KNEE - NODE_R), GR)) return false;
    // footing under the capsule: the 4 inner ring points (0.2 m) on the same surface, and 6 of the 8
    // outer ring points (0.45 m) within ±0.3 m — a 0.6 m wall top or a chevron cap is not a place to stand
    // inner ring on the SAME surface (±0.12 m allows a 16° ramp): a node never sits on a lip or a box edge.
    // CHANGED(MAPSIM): on a col_ stair wedge (31–36°) the tolerances follow the slope.
    let tolIn = 0.12, tolOut = 0.3;
    if (ny < 0.999 && onColFloor(x, yf, z)) {
      const tanS = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(ny, 0.5);
      tolIn = Math.max(tolIn, 0.2 * tanS + 0.04); tolOut = Math.max(tolOut, 0.45 * tanS + 0.06);
    }
    for (let k = 0; k < 4; k++) {
      const g = groundNear(ti, colY, colN, x + RING_IN[k * 2], z + RING_IN[k * 2 + 1], yf + tolIn, yf - tolIn);
      if (!(g === g)) return false;
    }
    let ok = 0;
    for (let k = 0; k < 8; k++) {
      const g = groundNear(ti, colY, colN, x + RING_OUT[k * 2], z + RING_OUT[k * 2 + 1], yf + tolOut, yf - tolOut);
      if (g === g) ok++;
    }
    return ok >= 6;
  };

  // ── nodes ──
  const NX: number[] = [], NY: number[] = [], NZ: number[] = [];
  const colOf: number[] = [];                         // node → column index
  const colStart = new Int32Array(nxCols * nzCols + 1);
  let nudged = 0;
  const ys = new Float64Array(64), ns = new Float64Array(64);
  const offs: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) offs.push([Math.round(Math.sin(k * Math.PI / 4) * 1000) / 1000, Math.round(Math.cos(k * Math.PI / 4) * 1000) / 1000]);
  // Rotation-equivariant choices: on a rot180 map a column on the z > 0 half walks its directions in
  // the 180°-rotated order, and ties between candidates break by direction angle in that same frame.
  // So mirrored geometry gives mirrored nodes and edges exactly: neither crew gets extra shortcuts.
  const rot180 = def.symmetry === 'rot180';
  const flipAt = (z: number): boolean => rot180 && z > 0;
  const offsFlip: Array<[number, number]> = offs.map(([x, z]) => [-x, -z] as [number, number]);
  const offsFor = (flip: boolean): Array<[number, number]> => (flip ? offsFlip : offs);
  const sideAngle = (dx: number, dz: number, flip: boolean): number => {
    const a = flip ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
    return Math.round((a + Math.PI) * 1e5);
  };
  for (let iz = 0; iz < nzCols; iz++) {
    for (let ix = 0; ix < nxCols; ix++) {
      const ci = iz * nxCols + ix;
      colStart[ci] = NX.length;
      const cx = x0 + ix * GRID, cz = z0 + iz * GRID;
      const n = column(ti, cx, cz, ys, ns);
      let lastY = Infinity;
      for (let k = 0; k < n; k++) {
        const yf = ys[k];
        if (yf > yTop) continue;
        if (ns[k] < FLOOR_NY) continue;
        if (lastY - yf < HEADROOM) { /* stacked too close to a floor we already took */ }
        let px = cx, pz = cz, py = yf, ok = standable(cx, yf, cz, ns[k]);
        if (!ok) {
          // nudge off a nearby wall / lip (deterministic, rotation-equivariant order)
          for (let r = 1; r <= 2 && !ok; r++) {
            for (const [ox, oz] of offsFor(flipAt(cz))) {
              const qx = cx + ox * NUDGE * r, qz = cz + oz * NUDGE * r;
              const qy = groundNear(ti, colY, colN, qx, qz, yf + 0.1, yf - 0.1);
              if (!(qy === qy)) continue;
              if (standable(qx, qy, qz, ns[k])) { px = qx; pz = qz; py = qy; ok = true; nudged++; break; }
            }
          }
        }
        if (!ok) continue;
        // no duplicate level in this column
        let dup = false;
        for (let j = colStart[ci]; j < NX.length; j++) if (Math.abs(NY[j] - py) < 0.3) { dup = true; break; }
        if (dup) continue;
        NX.push(px); NY.push(py); NZ.push(pz); colOf.push(ci);
        lastY = yf;
      }
    }
  }
  colStart[nxCols * nzCols] = NX.length;
  const N = NX.length;
  const tNodes = performance.now();

  // ── per-node "open": no collision triangle within 1.8 m in the capsule band (walk sweeps can be skipped) ──
  const clutter = buildClutter(solid.positions, solid.indices);
  const open = new Uint8Array(N);
  for (let i = 0; i < N; i++) open[i] = openAround(clutter, NX[i], NY[i] + 0.3, NY[i] + 1.9, NZ[i], 1.8) ? 1 : 0;
  // CHANGED(MAPSIM): nodes on a col_ stair wedge may link to neighbours up to the KCC's max slope
  const steep = new Uint8Array(N);
  if (colTi) for (let i = 0; i < N; i++) steep[i] = onColFloor(NX[i], NY[i], NZ[i]) ? 1 : 0;
  const STEEP_K = Math.tan(MOVE.maxSlopeDeg * Math.PI / 180);
  const riseK = (a: number, bn: number): number => (steep[a] || steep[bn] ? STEEP_K : 0.5);
  // CHANGED(MAPSIM): walk edges over a conveyor: cost × walk / (walk + belt·dir); the heuristic scale keeps A* admissible
  let hScale = 1;
  for (const c of F.conveyors) hScale = Math.min(hScale, MOVE.walk / (MOVE.walk + Math.hypot(c.vel[0], c.vel[2])));
  const beltFactor = (a: number, bn: number): number => {
    if (!F.conveyors.length) return 1;
    const mx = (NX[a] + NX[bn]) / 2, my = (NY[a] + NY[bn]) / 2, mz = (NZ[a] + NZ[bn]) / 2;
    const ci = conveyorAt(F, mx, my, mz, 0.3);
    if (ci < 0) return 1;
    const v = F.conveyors[ci].vel;
    const dx = NX[bn] - NX[a], dz = NZ[bn] - NZ[a], l = Math.hypot(dx, dz) || 1;
    return MOVE.walk / Math.max(1, MOVE.walk + (v[0] * dx + v[2] * dz) / l);
  };

  // ── edges ──
  const eFrom: number[] = [], eTo: number[] = [], eCost: number[] = [], eKind: number[] = [], eClimb: number[] = [];
  const climbs: NavClimb[] = [];
  const climbCand: Array<{ a: number; b: number; rec: NavClimb }> = [];
  const walkKnown = new Map<number, boolean>();       // key a*N+b (a<b) → walkable (symmetric)
  const walkPair = (a: number, bb: number): boolean => {
    const lo = Math.min(a, bb), hi = Math.max(a, bb);
    const key = lo * N + hi;
    const v = walkKnown.get(key);
    if (v !== undefined) return v;
    let w = footing(ti, colY, colN, NX[lo], NY[lo], NZ[lo], NX[hi], NY[hi], NZ[hi], ex);
    // sweeps only where something could be in the way (open = no triangle near the capsule band)
    if (w && !(open[lo] && open[hi] && Math.abs(NY[hi] - NY[lo]) <= 0.3)) w = sweepClear(physics, NX[lo], NY[lo], NZ[lo], NX[hi], NY[hi], NZ[hi]);
    walkKnown.set(key, w);
    return w;
  };
  const clear = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): boolean => {
    const l = Math.hypot(bx - ax, by - ay, bz - az);
    if (l < 1e-4) return !physics.sphereCast(ax, ay, az, 0, 1, 0, r, 1e-3, GR);
    return !physics.sphereCast(ax, ay, az, bx - ax, by - ay, bz - az, r, l, GR);
  };
  /** max top height of anything between a and b (column samples), relative band [lo, hi] */
  const obstacleTop = (ax: number, az: number, bx: number, bz: number, lo: number, hi: number): number => {
    const hd = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(hd / 0.2));
    let top = -Infinity;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const v = topAt(ti, ax + (bx - ax) * t, az + (bz - az) * t, lo, hi);
      if (v > top) top = v;
    }
    return top;
  };
  const pw = buildPaintWalls(geo, def.scoring?.floorMinNy ?? 0.45);
  // CHANGED(MAPSIM): landing room for drops / jumps — a runner arriving over a lip still carries speed, so the floor
  // at b's level (±0.3 m) must go on 0.35 and 0.7 m past b (not into an oob_ channel), and b stays clear of spring pads
  const landingRoom = (ax: number, az: number, bx: number, by: number, bz: number): boolean => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l > 1e-6) {
      for (const f of [0.5, 1]) {
        const qx = bx + dx / l * LAND_ROOM * f, qz = bz + dz / l * LAND_ROOM * f;
        const g = groundNear(ti, colY, colN, qx, qz, by + 0.3, by - 0.3);
        if (!(g === g)) return false;
        if (ex && excluded(ex, qx, g, qz)) return false;
      }
    }
    for (const sp of F.springs) if ((bx - sp.x) ** 2 + (bz - sp.z) ** 2 < (sp.r + SPRING_LAND) ** 2 && Math.abs(by - sp.y) < 1.5) return false;
    return true;
  };

  // pass 1: walk links of every node (special edges below skip pairs a two-step walk already joins)
  const walkAdj: number[][] = new Array(N);
  for (let a = 0; a < N; a++) {
    const ca = colOf[a];
    const aix = ca % nxCols, aiz = (ca / nxCols) | 0;
    const list: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const bxI = aix + dx, bzI = aiz + dz;
      if (bxI < 0 || bzI < 0 || bxI >= nxCols || bzI >= nzCols) continue;
      const cb = bzI * nxCols + bxI;
      for (let bn = colStart[cb]; bn < colStart[cb + 1]; bn++) {
        const dy = NY[bn] - NY[a], hd = Math.hypot(NX[bn] - NX[a], NZ[bn] - NZ[a]);
        if (Math.abs(dy) <= Math.max(STEP, hd * riseK(a, bn)) + 0.02 && walkPair(a, bn)) list.push(bn);
      }
    }
    walkAdj[a] = list;
  }
  const twoStep = (a: number, b: number): boolean => {
    const la = walkAdj[a];
    for (let i = 0; i < la.length; i++) if (walkAdj[la[i]].indexOf(b) >= 0) return true;
    return false;
  };

  // pass 2: emit walk edges + drop / jump / climb edges, node by node (CSR order)
  for (let a = 0; a < N; a++) {
    const ca = colOf[a];
    const aix = ca % nxCols, aiz = (ca / nxCols) | 0;
    const ax = NX[a], ay = NY[a], az = NZ[a];
    const walkTo: number[] = [];
    // candidates in rings 1..2
    const dropC: Array<[number, number]> = [], jumpC: Array<[number, number]> = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dz === 0) continue;
        const bxI = aix + dx, bzI = aiz + dz;
        if (bxI < 0 || bzI < 0 || bxI >= nxCols || bzI >= nzCols) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        const cb = bzI * nxCols + bxI;
        for (let bn = colStart[cb]; bn < colStart[cb + 1]; bn++) {
          const bx = NX[bn], by = NY[bn], bz = NZ[bn];
          const dy = by - ay;
          const hd = Math.hypot(bx - ax, bz - az);
          if (ring === 1 && Math.abs(dy) <= Math.max(STEP, hd * riseK(a, bn)) + 0.02) {
            if (walkPair(a, bn)) {
              walkTo.push(bn);
              eFrom.push(a); eTo.push(bn); eCost.push(Math.hypot(bx - ax, dy, bz - az) * beltFactor(a, bn)); eKind.push(EDGE_WALK); eClimb.push(-1);
              continue;
            }
          }
          if (dy < -STEP && dy >= -DROP_MAX) dropC.push([bn, hd]);
          else if (dy > STEP && dy <= JUMP_UP_MAX) { if (!twoStep(a, bn)) jumpC.push([bn, hd]); }
          // over an obstacle to the same level: something must stand between (it would sit within 1.42 m of
          // a or b), and no two-step walk may already join them (A* would never pick the jump)
          else if (Math.abs(dy) <= STEP && ring === 2 && !(open[a] && open[bn]) && !twoStep(a, bn)) jumpC.push([bn, hd]);
        }
      }
    }
    // DROP: off a lip, over clear air, down onto b
    const flipA = flipAt(z0 + aiz * GRID);
    const candKey = (bn: number): number => sideAngle(NX[bn] - ax, NZ[bn] - az, flipA);
    const byHd = (p: [number, number], q: [number, number]): number =>
      (Math.round(p[1] * 1e4) - Math.round(q[1] * 1e4)) || (candKey(p[0]) - candKey(q[0])) || (NY[p[0]] - NY[q[0]]);
    dropC.sort(byHd);
    let drops = 0;
    for (const [bn, hd] of dropC) {
      if (drops >= 3) break;
      const bx = NX[bn], by = NY[bn], bz = NZ[bn];
      // the lip must be real: the footing between a and b is not continuous
      if (footing(ti, colY, colN, ax, ay, az, bx, by, bz, ex)) continue;
      // horizontal run at a's height over the lip, then the fall onto b
      if (!clear(ax, ay + KNEE_Y, az, bx, ay + KNEE_Y, bz, CAP_R)) continue;
      if (!clear(ax, ay + CHEST_Y, az, bx, ay + CHEST_Y, bz, CHEST_R)) continue;
      if (!clear(bx, ay + KNEE_Y, bz, bx, by + KNEE_Y, bz, CAP_R)) continue;
      // don't "drop" through a floor that is in between (landing must be b's level)
      const g = groundNear(ti, colY, colN, bx, bz, ay - 0.1, by + 0.2);
      if (g === g && g > by + 0.25) continue;
      if (!landingRoom(ax, az, bx, by, bz)) continue;
      eFrom.push(a); eTo.push(bn); eCost.push(hd + 0.6 + (ay - by) * 0.25); eKind.push(EDGE_DROP); eClimb.push(-1);
      drops++;
    }
    // JUMP: up onto a ledge, or over a low obstacle to the same level
    jumpC.sort(byHd);
    let jumps = 0;
    for (const [bn, hd] of jumpC) {
      if (jumps >= 3) break;
      if (walkTo.indexOf(bn) >= 0) continue;
      const bx = NX[bn], by = NY[bn], bz = NZ[bn];
      const top = obstacleTop(ax, az, bx, bz, Math.min(ay, by) - 0.5, ay + 3);
      // same level: only worth a jump when something taller than a step stands in between
      if (Math.abs(by - ay) <= STEP && !(top > Math.max(ay, by) + STEP)) continue;
      if (footing(ti, colY, colN, ax, ay, az, bx, by, bz, ex) && sweepClear(physics, ax, ay, az, bx, by, bz)) continue;   // plain walk
      const H = Math.max(by, top === -Infinity ? ay : top) + 0.14;            // feet height to clear
      if (H - ay > JUMP_OVER_MAX + 0.14) continue;
      if (by - ay > JUMP_UP_MAX) continue;
      // up from a, across at H, down onto b
      if (!clear(ax, ay + KNEE_Y, az, ax, H + KNEE_Y, az, CAP_R)) continue;
      if (!clear(ax, H + CHEST_Y, az, ax, H + CHEST_Y, az, CHEST_R)) continue;
      if (!clear(ax, H + KNEE_Y, az, bx, H + KNEE_Y, bz, CAP_R)) continue;
      if (!clear(ax, H + CHEST_Y, az, bx, H + CHEST_Y, bz, CHEST_R)) continue;
      if (!clear(bx, H + KNEE_Y, bz, bx, by + KNEE_Y, bz, CAP_R)) continue;
      // CHANGED(MAPSIM): over a TALL obstacle (< 0.28 m under the jump apex) the landing column must clear the
      // real capsule + a margin: a runner coming down the flat arc next to a 1.1 m crate hangs on its top edge
      // (measured: 6 of 56 such jumps on Lockwell, 6 of 1642 on Pier 18)
      if (Math.abs(by - ay) <= STEP && H - Math.max(ay, by) > 1.0 && !clear(bx, H + KNEE_Y, bz, bx, by + KNEE_Y, bz, LAND_R)) continue;
      if (!landingRoom(ax, az, bx, by, bz)) continue;
      // a jump that can't clear: apex 1.28 m (v²/2g) must top H with margin while moving hd
      eFrom.push(a); eTo.push(bn); eCost.push(hd + 1.6 + (H - ay)); eKind.push(EDGE_JUMP); eClimb.push(-1);
      jumps++;
    }
    // CLIMB: wall-slick up a paintable wall 1.05–3.0 m to a flat floor on top (candidates; filtered below)
    let climbsHere = 0;
    const cOffs = offsFor(flipA);
    for (let k = 0; k < 8 && climbsHere < 2; k++) {
      const [dxu, dzu] = cOffs[k];
      const hit = physics.raycast(ax, ay + 0.5, az, dxu, 0, dzu, 1.3, GR);
      if (!hit || Math.abs(hit.ny) > 0.3) continue;
      // face normal pointing back at us (horizontal)
      let fnx = hit.nx, fnz = hit.nz;
      const fl = Math.hypot(fnx, fnz);
      if (fl < 1e-6) continue;
      fnx /= fl; fnz /= fl;
      if (fnx * dxu + fnz * dzu > -0.7) continue;          // glancing: not a wall we face
      const cxp = hit.x, czp = hit.z;
      // climb straight into the face
      const inx = -fnx, inz = -fnz;
      // not a corner: the same face continues 0.4 m to either side of the contact
      let flat = true;
      for (const sgn of [-1, 1]) {
        const ox = cxp - inx * 0.5 + (-inz) * 0.4 * sgn, oz = czp - inz * 0.5 + inx * 0.4 * sgn;
        const side = physics.raycast(ox, ay + 0.5, oz, inx, 0, inz, 0.8, GR);
        if (!side || Math.abs(side.toi - 0.5) > 0.08 || side.nx * fnx + side.nz * fnz < 0.95) { flat = false; break; }
      }
      if (!flat) continue;
      // find the wall top: horizontal probes up the face until one misses
      let wallTop = NaN;
      for (let hgt = 0.75; hgt <= CLIMB_MAX + 0.3; hgt += 0.25) {
        const probe = physics.raycast(cxp - inx * 0.6, ay + hgt, czp - inz * 0.6, inx, 0, inz, 0.9, GR);
        if (!probe) { wallTop = ay + hgt; break; }
      }
      if (!(wallTop === wallTop)) continue;
      const topY = groundNear(ti, colY, colN, cxp + inx * 0.45, czp + inz * 0.45, wallTop + 0.05, wallTop - 0.4);
      if (!(topY === topY)) continue;
      const rise = topY - ay;
      if (rise < CLIMB_MIN || rise > CLIMB_MAX) continue;
      // CHANGED(MAPSIM): nothing overhangs the climb (an eave / roof lip stops a wall-slicker under it): a sphere
      // 0.42 m off the face sweeps from chest height at the base to 1.2 m over the top
      if (!clear(cxp - inx * 0.42, ay + 0.9, czp - inz * 0.42, cxp - inx * 0.42, topY + 1.2, czp - inz * 0.42, 0.26)) continue;
      // a flat top (not the side of a ramp): the floor stays at topY 0.45–1.2 m in, and 0.4 m to each side
      let level = true;
      for (const [fi, ft] of [[0.8, 0], [1.2, 0], [0.8, -0.4], [0.8, 0.4]]) {
        const qx = cxp + inx * fi + (-inz) * ft, qz = czp + inz * fi + inx * ft;
        const g = groundNear(ti, colY, colN, qx, qz, topY + 0.06, topY - 0.06);
        if (!(g === g)) { level = false; break; }
      }
      if (!level) continue;
      // paintable face along the climb (bottom, middle, top)
      let paintable = true;
      for (const f of [0.3, 0.5, 0.85]) {
        const yy = ay + 0.1 + (rise - 0.1) * f;
        if (!onPaintWall(pw, cxp + inx * 0.01, yy, czp + inz * 0.01, 0.08)) { paintable = false; break; }
      }
      if (!paintable) continue;
      // the node on top nearest the lip
      const lx = cxp + inx * 0.9, lz = czp + inz * 0.9;
      let best = -1, bestD = Math.round(1.6 * 1.6 * 1e4);
      const lcx = Math.floor((lx - b.min[0]) / GRID), lcz = Math.floor((lz - b.min[2]) / GRID);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const qx = lcx + dx, qz = lcz + dz;
        if (qx < 0 || qz < 0 || qx >= nxCols || qz >= nzCols) continue;
        const cq = qz * nxCols + qx;
        for (let bn = colStart[cq]; bn < colStart[cq + 1]; bn++) {
          if (Math.abs(NY[bn] - topY) > 0.25) continue;
          const d2 = Math.round(((NX[bn] - lx) ** 2 + (NZ[bn] - lz) ** 2) * 1e4);
          if (d2 < bestD || (d2 === bestD && best >= 0 && sideAngle(NX[bn] - lx, NZ[bn] - lz, flipA) < sideAngle(NX[best] - lx, NZ[best] - lz, flipA))) { bestD = d2; best = bn; }
        }
      }
      if (best < 0) continue;
      let dupe = false;
      for (const cc of climbCand) if (cc.a === a && cc.b === best) { dupe = true; break; }
      if (dupe) continue;
      climbCand.push({ a, b: best, rec: { cx: cxp, cz: czp, nx: fnx, nz: fnz, y0: ay, y1: topY } });
      climbsHere++;
    }
  }

  // climbs only onto roomy tops (≥ 4 walk links on the top node: decks, the buoy block — not a crate lid)
  const walkDeg = new Int32Array(N);
  for (let e = 0; e < eFrom.length; e++) if (eKind[e] === EDGE_WALK) walkDeg[eFrom[e]]++;
  const extraFrom: number[] = [], extraTo: number[] = [], extraCost: number[] = [], extraClimb: number[] = [];
  for (const cc of climbCand) {
    if (walkDeg[cc.b] < 4) continue;
    climbs.push(cc.rec);
    const hd = Math.hypot(NX[cc.b] - NX[cc.a], NZ[cc.b] - NZ[cc.a]);
    extraFrom.push(cc.a); extraTo.push(cc.b); extraCost.push(hd + (cc.rec.y1 - cc.rec.y0) + 3.0); extraClimb.push(climbs.length - 1);
  }
  for (let i = 0; i < extraFrom.length; i++) {
    eFrom.push(extraFrom[i]); eTo.push(extraTo[i]); eCost.push(extraCost[i]); eKind.push(EDGE_CLIMB); eClimb.push(extraClimb[i]);
  }

  // ── CHANGED(MAPSIM): SPRING edges (kind 4): approach node → landing node across a tide-spring pad ──
  for (const s of F.springs) {
    const land = springArc(ti, colY, colN, physics, s.x, s.y, s.z, s.launch[0], s.launch[1], s.launch[2], killY);
    if (!land) continue;
    // landing node: the roomy node (≥ 3 walk links) nearest the landing point, within 1.6 m and ±0.6 m
    let L = -1, bestL = Math.round(1.6 * 1.6 * 1e4);
    for (let n = 0; n < N; n++) {
      if (Math.abs(NY[n] - land.y) > 0.6 || walkDeg[n] < 3) continue;
      const d2 = Math.round(((NX[n] - land.x) ** 2 + (NZ[n] - land.z) ** 2) * 1e4);
      if (d2 < bestL) { bestL = d2; L = n; }
    }
    if (L < 0) continue;
    const R0 = s.r + SPRING_KEEP, R1 = s.r + 2.6;
    for (let n = 0; n < N; n++) {
      const cx = s.x - NX[n], cz = s.z - NZ[n];
      const hd = Math.hypot(cx, cz);
      if (hd <= R0 || hd > R1 || Math.abs(NY[n] - s.y) > 0.5) continue;
      // the straight line n → L crosses the pad: the centre lies ahead, ≤ 0.45 m off the line
      const lx = NX[L] - NX[n], lz = NZ[L] - NZ[n], ll = Math.hypot(lx, lz);
      if (ll < 1e-6) continue;
      const ux = lx / ll, uz = lz / ll;
      const along = cx * ux + cz * uz, perp = Math.abs(cx * uz - cz * ux);
      if (along <= 0 || along >= ll || perp > 0.45) continue;
      // footing from the node over the rim onto the pad centre, and nothing in the way at knee / chest height
      if (!footing(ti, colY, colN, NX[n], NY[n], NZ[n], s.x, s.y, s.z)) continue;
      if (!sweepClear(physics, NX[n], NY[n], NZ[n], s.x, s.y, s.z)) continue;
      eFrom.push(n); eTo.push(L); eCost.push(ll + 1.0); eKind.push(EDGE_SPRING); eClimb.push(-1);
    }
  }

  // ── CHANGED(MAPSIM): drop the ISLANDS — groups of nodes linked to no spawn by any edge in either direction (a
  // sliver of steep bank, a lone node at a channel lip). Nothing can ever path to or from them; the survivors
  // keep their relative order. (One-way perches with a drop edge down stay: they touch the main graph.) ──
  const keepNode = new Uint8Array(N);
  {
    const adj = new Int32Array(N + 1);
    for (let e = 0; e < eFrom.length; e++) { adj[eFrom[e] + 1]++; adj[eTo[e] + 1]++; }
    for (let i = 1; i <= N; i++) adj[i] += adj[i - 1];
    const lst = new Int32Array(eFrom.length * 2), fl = adj.slice(0, N);
    for (let e = 0; e < eFrom.length; e++) { lst[fl[eFrom[e]]++] = eTo[e]; lst[fl[eTo[e]]++] = eFrom[e]; }
    const q: number[] = [];
    for (let k = 0; k < 2; k++) {
      const sp = pads[k];
      let best = -1, bd = Infinity;
      for (let n = 0; n < N; n++) {
        if (Math.abs(NY[n] - sp.y) > 0.6) continue;
        const d = (NX[n] - sp.x) ** 2 + (NZ[n] - sp.z) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
      if (best >= 0 && !keepNode[best]) { keepNode[best] = 1; q.push(best); }
    }
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (let k = adj[u]; k < adj[u + 1]; k++) { const v = lst[k]; if (!keepNode[v]) { keepNode[v] = 1; q.push(v); } }
    }
    if (!q.length) keepNode.fill(1);
  }
  const newId = new Int32Array(N).fill(-1);
  const KX: number[] = [], KY: number[] = [], KZ: number[] = [];
  for (let n = 0; n < N; n++) if (keepNode[n]) { newId[n] = KX.length; KX.push(NX[n]); KY.push(NY[n]); KZ.push(NZ[n]); }
  const pruned = N - KX.length;
  const M = KX.length;

  // ── CSR (stable by source: edges keep their emission order within a node) ──
  const edgeStart = new Int32Array(M + 1);
  let E = 0;
  for (let e = 0; e < eFrom.length; e++) if (newId[eFrom[e]] >= 0 && newId[eTo[e]] >= 0) { edgeStart[newId[eFrom[e]] + 1]++; E++; }
  for (let i = 1; i <= M; i++) edgeStart[i] += edgeStart[i - 1];
  const edgeTo = new Int32Array(E), edgeCost = new Float32Array(E), edgeKind = new Uint8Array(E), edgeClimb = new Int32Array(E);
  const fill = edgeStart.slice(0, M);
  const byKind: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (let e = 0; e < eFrom.length; e++) {
    const a = newId[eFrom[e]], b = newId[eTo[e]];
    if (a < 0 || b < 0) continue;
    const k = fill[a]++;
    edgeTo[k] = b; edgeCost[k] = eCost[e]; edgeKind[k] = eKind[e]; edgeClimb[k] = eClimb[e];
    byKind[eKind[e]]++;
  }
  let openKept = 0;
  for (let n = 0; n < N; n++) if (keepNode[n]) openKept += open[n];
  const stats = { buildMs: 0, columns: nxCols * nzCols, nudged, edgesByKind: byKind, nodeMs: tNodes - t0, open: openKept, pruned };
  const nav = new Nav(ti, physics, Float32Array.from(KX), Float32Array.from(KY), Float32Array.from(KZ),
    edgeStart, edgeTo, edgeCost, edgeKind, edgeClimb, climbs, stats, ex, hScale);
  stats.buildMs = performance.now() - t0;
  return nav;
}
