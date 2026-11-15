// Convergence map generator: N winding roads from the perimeter to the central
// Bastion plaza. Pure module — no DOM, no three.js.
import { makeRng } from './rng.js';

export const GRID_W = 23;
export const GRID_H = 15;
export const CELL = 2;
export const CX = (GRID_W - 1) / 2;   // 11
export const CY = (GRID_H - 1) / 2;   // 7

export function cellToWorld(cx, cy) {
  return { x: (cx - CX) * CELL, z: (cy - CY) * CELL };
}
export function worldToCell(x, z) {
  return { cx: Math.round(x / CELL + CX), cy: Math.round(z / CELL + CY) };
}

export function isPlaza(cx, cy) {
  return Math.abs(cx - CX) <= 1 && Math.abs(cy - CY) <= 1;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 8 compass entry slots around the perimeter (well-separated spawn gates).
const SLOTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function slotCell(slot, rng) {
  const jx = rng.int(-2, 2), jy = rng.int(-1, 1);
  switch (slot) {
    case 'N':  return [Math.max(1, Math.min(GRID_W - 2, Math.round(CX) + jx)), 0];
    case 'S':  return [Math.max(1, Math.min(GRID_W - 2, Math.round(CX) + jx)), GRID_H - 1];
    case 'W':  return [0, Math.max(1, Math.min(GRID_H - 2, Math.round(CY) + jy))];
    case 'E':  return [GRID_W - 1, Math.max(1, Math.min(GRID_H - 2, Math.round(CY) + jy))];
    case 'NE': return [GRID_W - 1 - rng.int(1, 4), 0];
    case 'NW': return [rng.int(1, 4), 0];
    case 'SE': return [GRID_W - 1 - rng.int(1, 4), GRID_H - 1];
    case 'SW': return [rng.int(1, 4), GRID_H - 1];
  }
}

// pick N entry slots with good angular spread (deterministic)
function pickSlots(n, rng) {
  const startIdx = rng.int(0, 7);
  const step = Math.floor(8 / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const wobble = n < 4 ? rng.int(0, step - 1) : 0;
    out.push(SLOTS[(startIdx + i * step + wobble) % 8]);
  }
  return out;
}

// A road cell may 4-touch only its predecessor; never other roads; never the
// plaza until it terminates by touching the plaza ring.
function cleanAdjacency(occupied, nx, ny, prev) {
  for (const [dx, dy] of DIRS) {
    const ax = nx + dx, ay = ny + dy;
    if (ax === prev[0] && ay === prev[1]) continue;
    if (occupied.has(ax + ',' + ay)) return false;
  }
  return true;
}

// Chebyshev distance to the map center — plaza is <=1, the "ring" is ==2.
function ringDist(cx, cy) {
  return Math.max(Math.abs(cx - CX), Math.abs(cy - CY));
}

function walkRoad(rng, entry, occupied, minLen) {
  const path = [entry.slice()];
  const mine = new Set([entry[0] + ',' + entry[1]]);
  let cur = entry.slice();
  let curDir = [Math.sign(CX - cur[0]) || 0, Math.sign(CY - cur[1]) || 0];
  if (curDir[0] && curDir[1]) curDir = rng.chance(0.5) ? [curDir[0], 0] : [0, curDir[1]];
  let guard = 900;

  while (guard-- > 0) {
    // HARD RULE: the moment a road reaches the plaza ring it TERMINATES there.
    // Roads lead INTO the center — they can never pass beside or across it.
    if (ringDist(cur[0], cur[1]) === 2) {
      if (path.length >= minLen) return { cells: path, mine };
      return null; // arrived too early — reject, retry with next seed
    }
    const toC = [Math.sign(CX - cur[0]), Math.sign(CY - cur[1])];
    const cands = [];
    for (const d of DIRS) {
      if (d[0] === -curDir[0] && d[1] === -curDir[1]) continue;
      const nx = cur[0] + d[0], ny = cur[1] + d[1];
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      const rd = ringDist(nx, ny);
      if (rd <= 1) continue;                              // never step ONTO the plaza
      if (rd === 2 && path.length < minLen - 1) continue; // no early arrivals at the ring
      if (mine.has(nx + ',' + ny) || occupied.has(nx + ',' + ny)) continue;
      if (!cleanAdjacency(new Set([...mine, ...occupied]), nx, ny, cur)) continue;
      let w = 1;
      if (d[0] === curDir[0] && d[1] === curDir[1]) w += 1.6;
      if (d[0] === toC[0] && d[0] !== 0) w += 1.1 * Math.min(1.4, path.length / minLen);
      if (d[1] === toC[1] && d[1] !== 0) w += 1.1 * Math.min(1.4, path.length / minLen);
      if (path.length < minLen * 0.6) w += rng.next() * 2.4;   // wander early
      // strongly prefer finishing the approach once long enough
      if (rd === 2 && path.length >= minLen) w += 6;
      cands.push({ d, w });
    }
    if (!cands.length) return null;
    let total = 0; for (const c of cands) total += c.w;
    let r = rng.next() * total, chosen = cands[0];
    for (const c of cands) { r -= c.w; if (r <= 0) { chosen = c; break; } }
    curDir = chosen.d;
    cur = [cur[0] + curDir[0], cur[1] + curDir[1]];
    path.push(cur.slice());
    mine.add(cur[0] + ',' + cur[1]);
  }
  return null;
}

function tryGenerate(seed, nRoads, minLen) {
  const rng = makeRng(seed);
  const slots = pickSlots(nRoads, rng);
  const occupied = new Set();
  const roads = [];
  for (const slot of slots) {
    const entry = slotCell(slot, rng);
    if (occupied.has(entry[0] + ',' + entry[1])) return null;
    const road = walkRoad(rng, entry, occupied, minLen);
    if (!road) return null;
    for (const k of road.mine) occupied.add(k);
    roads.push(road.cells);
  }
  return roads;
}

// Chaikin smoothing + cumulative lengths; extend entry off-map and the exit
// INTO the bastion center (the breach walk).
function buildRoute(cells) {
  const pts = cells.map(([cx, cy]) => { const w = cellToWorld(cx, cy); return [w.x, w.z]; });
  const first = pts[0], second = pts[1] || [first[0] + CELL, first[1]];
  const dIn = [first[0] - second[0], first[1] - second[1]];
  const nIn = Math.hypot(dIn[0], dIn[1]) || 1;
  pts.unshift([first[0] + (dIn[0] / nIn) * CELL * 1.8, first[1] + (dIn[1] / nIn) * CELL * 1.8]);
  pts.push([0, 0]); // breach: walk into the bastion heart

  const sm = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    sm.push([a[0] * 0.72 + b[0] * 0.28, a[1] * 0.72 + b[1] * 0.28]);
    sm.push([a[0] * 0.28 + b[0] * 0.72, a[1] * 0.28 + b[1] * 0.72]);
  }
  sm.push(pts[pts.length - 1]);
  const cum = [0];
  for (let i = 1; i < sm.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
  }
  return { points: sm, cum, total: cum[cum.length - 1] };
}

export function posAlong(route, dist) {
  const { points, cum, total } = route;
  const d = Math.max(0, Math.min(dist, total));
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  const p0 = points[lo], p1 = points[hi];
  return {
    x: p0[0] + (p1[0] - p0[0]) * t,
    z: p0[1] + (p1[1] - p0[1]) * t,
    dx: (p1[0] - p0[0]) / seg,
    dz: (p1[1] - p0[1]) / seg,
  };
}

// Deterministic full map: roads, routes, blocked decor cells.
export function generateMap(seed, nRoads, minLen = 17) {
  let roads = null;
  for (let s = seed; s < seed + 900 && !roads; s++) roads = tryGenerate(s, nRoads, minLen);
  if (!roads) {
    for (let s = seed; s < seed + 1400 && !roads; s++) roads = tryGenerate(s, nRoads, Math.max(12, minLen - 4));
  }
  if (!roads) throw new Error('map generation failed seed=' + seed + ' roads=' + nRoads);

  const roadSet = new Set();
  for (const r of roads) for (const [x, y] of r) roadSet.add(x + ',' + y);
  const routes = roads.map(buildRoute);

  // blocked decor cells: not road, not plaza, not adjacent to either
  const rng = makeRng(seed ^ 0x51f15e);
  const near = new Set();
  for (const k of roadSet) {
    const [x, y] = k.split(',').map(Number);
    for (const [dx, dy] of DIRS) near.add((x + dx) + ',' + (y + dy));
  }
  const blocked = [];
  let guard = 500;
  const wantBlocked = 5 + rng.int(0, 3);
  while (blocked.length < wantBlocked && guard-- > 0) {
    const cx = rng.int(1, GRID_W - 2), cy = rng.int(1, GRID_H - 2);
    const k = cx + ',' + cy;
    if (roadSet.has(k) || near.has(k)) continue;
    if (Math.abs(cx - CX) <= 2 && Math.abs(cy - CY) <= 2) continue;
    if (blocked.some(([a, b]) => Math.abs(a - cx) <= 1 && Math.abs(b - cy) <= 1)) continue;
    blocked.push([cx, cy]);
  }

  return { roads, roadSet, routes, blocked, nRoads };
}
