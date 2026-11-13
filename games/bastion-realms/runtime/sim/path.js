// Grid + seeded winding-path generator. Pure module — no DOM, no three.js.
// Grid is GRID_W x GRID_H cells; world cell size = CELL (view maps through these).
import { makeRng } from './rng.js';

export const GRID_W = 20;
export const GRID_H = 13;
export const CELL = 2; // world units per cell

export function cellToWorld(cx, cy) {
  return { x: (cx - (GRID_W - 1) / 2) * CELL, z: (cy - (GRID_H - 1) / 2) * CELL };
}
export function worldToCell(x, z) {
  return {
    cx: Math.round(x / CELL + (GRID_W - 1) / 2),
    cy: Math.round(z / CELL + (GRID_H - 1) / 2),
  };
}

const DIRS = [ [1, 0], [-1, 0], [0, 1], [0, -1] ];

// Edge specs: entry/exit sides per level for variety.
export const EDGE_MODES = ['LR', 'RL', 'TB', 'BT', 'LB', 'TR', 'LT', 'BR'];

function edgeCells(side, rng) {
  // Returns {cell, dirIntoGrid} on the given side at a seeded offset (away from corners).
  if (side === 'L') return { c: [0, rng.int(2, GRID_H - 3)], d: [1, 0] };
  if (side === 'R') return { c: [GRID_W - 1, rng.int(2, GRID_H - 3)], d: [-1, 0] };
  if (side === 'T') return { c: [rng.int(2, GRID_W - 3), 0], d: [0, 1] };
  return { c: [rng.int(2, GRID_W - 3), GRID_H - 1], d: [0, -1] };
}

function sidesFor(mode) {
  const m = { LR: ['L', 'R'], RL: ['R', 'L'], TB: ['T', 'B'], BT: ['B', 'T'],
              LB: ['L', 'B'], TR: ['T', 'R'], LT: ['L', 'T'], BR: ['B', 'R'] };
  return m[mode] || m.LR;
}

// A path cell may only 4-neighbor the previous path cell — keeps lanes clean, no blobs.
function cleanAdjacency(path, onPath, nx, ny, prev) {
  for (const [dx, dy] of DIRS) {
    const ax = nx + dx, ay = ny + dy;
    if (ax === prev[0] && ay === prev[1]) continue;
    if (onPath.has(ax + ',' + ay)) return false;
  }
  return true;
}

function tryGenerate(seed, mode, minLen, minTurns) {
  const rng = makeRng(seed);
  const [sideA, sideB] = sidesFor(mode);
  const start = edgeCells(sideA, rng);
  const goal = edgeCells(sideB, rng);
  const path = [start.c.slice()];
  const onPath = new Set([start.c[0] + ',' + start.c[1]]);
  let cur = start.c.slice();
  let curDir = start.d.slice();
  let guard = 4000;

  while (guard-- > 0) {
    const [gx, gy] = goal.c;
    if (cur[0] === gx && cur[1] === gy) break;

    // Candidate dirs: prefer momentum, sometimes wander, biased toward goal when far along.
    const toGoal = [Math.sign(gx - cur[0]), Math.sign(gy - cur[1])];
    const cands = [];
    for (const d of DIRS) {
      if (d[0] === -curDir[0] && d[1] === -curDir[1]) continue; // no reverse
      const nx = cur[0] + d[0], ny = cur[1] + d[1];
      if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
      if (onPath.has(nx + ',' + ny)) continue;
      if (!cleanAdjacency(path, onPath, nx, ny, cur)) {
        // allow stepping onto the goal even if adjacency complains about goal-side edge
        if (!(nx === gx && ny === gy)) continue;
      }
      let w = 1;
      if (d[0] === curDir[0] && d[1] === curDir[1]) w += 1.7;           // momentum
      if (d[0] === toGoal[0] && d[0] !== 0) w += 0.9 * (path.length / minLen);
      if (d[1] === toGoal[1] && d[1] !== 0) w += 0.9 * (path.length / minLen);
      if (path.length < minLen * 0.7) w += rng.next() * 2.2;           // wander early
      cands.push({ d, w });
    }
    if (!cands.length) return null; // dead end — retry with next seed
    let total = 0; for (const c of cands) total += c.w;
    let r = rng.next() * total, chosen = cands[0];
    for (const c of cands) { r -= c.w; if (r <= 0) { chosen = c; break; } }
    curDir = chosen.d;
    cur = [cur[0] + curDir[0], cur[1] + curDir[1]];
    path.push(cur.slice());
    onPath.add(cur[0] + ',' + cur[1]);
  }
  if (guard <= 0) return null;

  // Count turns
  let turns = 0;
  for (let i = 2; i < path.length; i++) {
    const d1 = [path[i - 1][0] - path[i - 2][0], path[i - 1][1] - path[i - 2][1]];
    const d2 = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]];
    if (d1[0] !== d2[0] || d1[1] !== d2[1]) turns++;
  }
  if (path.length < minLen || turns < minTurns) return null;
  return { cells: path, turns };
}

// Deterministic: walks seeds upward until one generates. Same result every run.
export function generatePath(seed, mode, minLen = 34, minTurns = 6) {
  for (let s = seed; s < seed + 500; s++) {
    const r = tryGenerate(s, mode, minLen, minTurns);
    if (r) return { ...r, usedSeed: s };
  }
  // Extremely defensive fallback: relax constraints rather than fail.
  for (let s = seed; s < seed + 800; s++) {
    const r = tryGenerate(s, mode, 26, 4);
    if (r) return { ...r, usedSeed: s, relaxed: true };
  }
  throw new Error('path generation failed for seed ' + seed + ' mode ' + mode);
}

// Smoothed polyline (corner cutting) + cumulative lengths for dist->pos mapping.
export function buildRoute(cells) {
  const pts = cells.map(([cx, cy]) => { const w = cellToWorld(cx, cy); return [w.x, w.z]; });
  // extend entry/exit slightly off-map so enemies walk in/out cleanly
  const first = pts[0], second = pts[1] || [first[0] + CELL, first[1]];
  const dIn = [first[0] - second[0], first[1] - second[1]];
  const nIn = Math.hypot(dIn[0], dIn[1]) || 1;
  pts.unshift([first[0] + (dIn[0] / nIn) * CELL * 1.6, first[1] + (dIn[1] / nIn) * CELL * 1.6]);
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const dOut = [last[0] - prev[0], last[1] - prev[1]];
  const nOut = Math.hypot(dOut[0], dOut[1]) || 1;
  pts.push([last[0] + (dOut[0] / nOut) * CELL * 1.6, last[1] + (dOut[1] / nOut) * CELL * 1.6]);

  // one round of Chaikin corner cutting (keep endpoints)
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
  // binary search
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

// Blocked decor cells: seeded picks that are NOT on/adjacent to the path.
export function pickBlockedCells(seed, cells, count) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const onPath = new Set(cells.map(([x, y]) => x + ',' + y));
  const near = new Set();
  for (const [x, y] of cells) for (const [dx, dy] of DIRS) near.add((x + dx) + ',' + (y + dy));
  const out = [];
  let guard = 400;
  while (out.length < count && guard-- > 0) {
    const cx = rng.int(1, GRID_W - 2), cy = rng.int(1, GRID_H - 2);
    const k = cx + ',' + cy;
    if (onPath.has(k) || near.has(k) || out.some(([a, b]) => a === cx && b === cy)) continue;
    out.push([cx, cy]);
  }
  return out;
}
