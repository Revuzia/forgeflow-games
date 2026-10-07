// probe (lane SIM): walkability grid, line of walk, raycast, nearest walkable, A* + string pulling
// around walls, search-state reuse, unit movement along paths, soft separation, hard structures.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, near, section, stepSec } from './fixtures/sim_fixture.ts';
import { NavGrid } from '../src/sim/nav.ts';
import { Rng } from '../src/sim/rng.ts';
import { issueAttack, issueMove } from '../src/sim/movement.ts';
import { applyStatus } from '../src/sim/status.ts';
import { killEntity } from '../src/sim/combat.ts';

const cat = buildCatalog({ fighters: [fighter('fx_fighter_a', { base: { moveSpeed: 4 } }), fighter('fx_fighter_b')] });
const map = cat.maps[0];

section('grid', () => {
  const nav = NavGrid.fromMap(map);
  check('grid size = map / navCell', nav.w === 120 && nav.h === 120);
  check('inside the wall is blocked', !nav.walkable(30, 20));
  check('clearance band next to the wall is blocked', !nav.walkable(27.8, 20) && nav.walkable(27.2, 20));
  check('the gap above the wall is open', nav.walkable(30, 50));
  check('outside the map is blocked', !nav.walkable(-1, 5) && !nav.walkable(5, 61));
  check('lineOfWalk: blocked through the wall', !nav.lineOfWalk(20, 20, 40, 20));
  check('lineOfWalk: open across the gap', nav.lineOfWalk(20, 50, 40, 50, 0.5));
  check('lineOfWalk with radius catches a grazing wall', nav.lineOfWalk(20, 46.4, 40, 46.4, 0) && !nav.lineOfWalk(20, 46.4, 40, 46.4, 1.2));
  const out = { x: 0, y: 0 };
  check('raycast stops before the wall', !nav.raycast(20, 20, 40, 20, out) && out.x < 28 && out.x > 27 && near(out.y, 20));
  check('raycast reaching its end', nav.raycast(20, 20, 25, 22, out) && near(out.x, 25) && near(out.y, 22));
  check('nearestWalkable from inside a wall', nav.nearestWalkable(30, 20, out) && nav.walkable(out.x, out.y) && Math.abs(out.x - 30) < 3);
});

for (const mode of ['corner graph', 'grid A*'] as const) section(`paths: ${mode}`, () => {
  const nav = NavGrid.fromMap(map);
  nav.useGraph = mode === 'corner graph';
  const path: number[] = [];
  check(`${mode}: path found around the wall`, nav.findPath(20, 20, 40, 20, path, 0.5));
  const pts: [number, number][] = [[20, 20]];
  for (let i = 0; i < path.length; i += 2) pts.push([path[i], path[i + 1]]);
  check(`${mode}: path ends at the goal`, near(pts[pts.length - 1][0], 40) && near(pts[pts.length - 1][1], 20));
  check(`${mode}: path goes through the gap (y > 45)`, pts.some((p) => p[1] > 45 && p[0] > 26 && p[0] < 34), pts);
  let segsOk = true, len = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!nav.lineOfWalk(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])) segsOk = false;
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  check(`${mode}: every segment is walkable`, segsOk);
  check(`${mode}: few waypoints`, pts.length <= 5, pts);
  const ideal = Math.hypot(28 - 20, 45.5 - 20) + 4 + Math.hypot(40 - 32, 45.5 - 20);
  check(`${mode}: length close to the taut path`, len < ideal * 1.08, { len, ideal });
  check(`${mode}: direct line when visible`, nav.findPath(5, 5, 20, 10, path) && path.length === 2 && near(path[0], 20));
  check(`${mode}: goal inside a wall → nearest walkable`, nav.findPath(20, 20, 30, 20, path) && nav.walkable(path[path.length - 2], path[path.length - 1]));
  const t0 = performance.now();
  const n = 300;
  for (let i = 0; i < n; i++) nav.findPath(5 + (i % 10), 5 + (i % 7), 50 + (i % 5), 10 + (i % 9), path, 0.5);
  const ms = (performance.now() - t0) / n;
  check(`${mode}: cross-wall search cost`, ms < (mode === 'grid A*' ? 3 : 0.3), `${ms.toFixed(3)} ms/search`);
  console.log(`  info: ${mode}: ${ms.toFixed(3)} ms per cross-wall search; grid searches ${nav.gridSearches}, ${(nav.expanded / Math.max(1, nav.gridSearches)).toFixed(0)} expansions avg`);
  if (mode === 'corner graph') {
    check('corner graph: convex wall corners inside the map become nodes', nav.graphNodeCount() === 2, nav.graphNodeCount());
    check('corner graph answered without grid searches', nav.gridSearches === 0);
    // a dynamic obstacle on a graph leg gets patched by a grid search
    nav.addObstacle(30, 47, 1.2);
    check('corner graph: leg blocked by a structure is patched', nav.findPath(20, 20, 40, 20, path, 0.5) && nav.gridSearches > 0);
    let ok = true;
    let px = 20, py = 20;
    for (let i = 0; i < path.length; i += 2) { if (!nav.lineOfWalk(px, py, path[i], path[i + 1])) ok = false; px = path[i]; py = path[i + 1]; }
    check('corner graph: patched path is walkable', ok && near(px, 40) && near(py, 20));
  }
});

section('cluttered map: corner graph vs grid A*', () => {
  // deterministic clutter: rectangles, triangles and L-shapes on a 150 m map
  const rng = new Rng(2026);
  const walls: [number, number][][] = [];
  for (let i = 0; i < 40; i++) {
    const x = rng.range(10, 140), y = rng.range(10, 140), s = rng.range(2, 9), k = rng.int(0, 2);
    if (k === 0) walls.push([[x, y], [x + s, y], [x + s, y + s * 0.6], [x, y + s * 0.6]]);
    else if (k === 1) walls.push([[x, y], [x + s, y + s * 0.3], [x + s * 0.2, y + s]]);
    else walls.push([[x, y], [x + s, y], [x + s, y + 1.5], [x + 1.5, y + 1.5], [x + 1.5, y + s], [x, y + s]]);
  }
  const g = new NavGrid(150, 150, 0.5, walls);
  const a = new NavGrid(150, 150, 0.5, walls);
  a.useGraph = false;
  const tb = performance.now();
  const nodes = g.graphNodeCount();
  const buildMs = performance.now() - tb;
  const len = (sx: number, sy: number, p: number[]): number => {
    let L = 0, px = sx, py = sy;
    for (let i = 0; i < p.length; i += 2) { L += Math.hypot(p[i] - px, p[i + 1] - py); px = p[i]; py = p[i + 1]; }
    return L;
  };
  const valid = (nav: NavGrid, sx: number, sy: number, p: number[]): boolean => {
    let px = sx, py = sy;
    for (let i = 0; i < p.length; i += 2) { if (!nav.lineOfWalk(px, py, p[i], p[i + 1])) return false; px = p[i]; py = p[i + 1]; }
    return true;
  };
  const pg: number[] = [], pa: number[] = [];
  let worse = 0, invalid = 0, n = 0, endMismatch = 0;
  const q = new Rng(7);
  const queries: number[][] = [];
  for (let i = 0; i < 200; i++) {
    const sx = q.range(1, 149), sy = q.range(1, 149), gx = q.range(1, 149), gy = q.range(1, 149);
    if (g.walkable(sx, sy) && g.walkable(gx, gy)) queries.push([sx, sy, gx, gy]);
  }
  n = queries.length;
  // one-time lazy work (connectivity labels) is not part of a query's cost
  g.componentAt(0, 0); a.componentAt(0, 0);
  for (const [sx, sy, gx, gy] of queries) {
    g.findPath(sx, sy, gx, gy, pg, 0.5);
    a.findPath(sx, sy, gx, gy, pa, 0.5);
    if (!valid(g, sx, sy, pg) || !valid(a, sx, sy, pa)) invalid++;
    if (Math.abs(pg[pg.length - 2] - pa[pa.length - 2]) + Math.abs(pg[pg.length - 1] - pa[pa.length - 1]) > 1e-6) endMismatch++;
    if (len(sx, sy, pg) > len(sx, sy, pa) * 1.1 + 0.5) worse++;
  }
  // timing: the same query set, best of 3 interleaved passes per mode (a GC pause or a scheduler
  // hiccup on a loaded machine lands in one pass, not in the comparison)
  let tg = Infinity, ta = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    let sg = 0, sa = 0;
    for (const [sx, sy, gx, gy] of queries) {
      let t = performance.now(); g.findPath(sx, sy, gx, gy, pg, 0.5); sg += performance.now() - t;
      t = performance.now(); a.findPath(sx, sy, gx, gy, pa, 0.5); sa += performance.now() - t;
    }
    tg = Math.min(tg, sg); ta = Math.min(ta, sa);
  }
  console.log(`  info: ${nodes} corner nodes built in ${buildMs.toFixed(1)} ms; ${n} queries: graph ${(tg / n).toFixed(3)} ms avg, grid ${(ta / n).toFixed(3)} ms avg`);
  check('cluttered: every path from both modes is walkable', invalid === 0, invalid);
  check('cluttered: both modes reach the same end point', endMismatch === 0, endMismatch);
  check('cluttered: corner-graph paths are never much longer than grid paths', worse === 0, worse);
  check('cluttered: corner graph is faster on average', tg < ta, { tg, ta });
});

section('units walking', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 20, y: 20 }, { fighter: 'fx_fighter_b', team: 1, x: 55, y: 55 }]);
  const a = fighterEnt(w, 0);
  issueMove(w, a, 40, 20, false);
  let tArrive = -1;
  let maxBlocked = 0;
  for (let i = 0; i < 30 * 30; i++) {
    w.step();
    if (!w.nav.walkable(a.x, a.y)) maxBlocked++;
    if (a.order === 0 && Math.hypot(a.x - 40, a.y - 20) < 0.1) { tArrive = w.time; break; }
  }
  check('walks around the wall to the goal', tArrive > 0, [a.x, a.y]);
  check('never stands in a blocked cell', maxBlocked === 0);
  const pathLen = Math.hypot(28 - 20, 45.5 - 20) + 4 + Math.hypot(40 - 32, 45.5 - 20);
  check('arrival time ≈ path length / speed', tArrive < (pathLen / 4) * 1.15 + 0.5, { tArrive, expect: pathLen / 4 });
  check('state back to idle on arrival', (w.step(), a.state === 'idle'));
  // chasing a moving target across the wall recomputes the path
  const b = fighterEnt(w, 1);
  b.x = 45; b.y = 10;
  a.x = 20; a.y = 30;
  applyStatus(w, a, b, 'reveal', 10); // keep the target visible across the map
  const s0 = w.nav.searches;
  issueAttack(w, a, b);
  b.x = 45; b.y = 10;
  stepSec(w, 2);
  check('chasing uses A* when the line is blocked', w.nav.searches > s0);
});

section('separation + structures', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 55, y: 55 }]);
  const ms = [0, 1, 2, 3, 4, 5].map((i) => addUnit(w, 'fx_minion', 0, 5 + i * 0.3, 5));
  for (const m of ms) issueMove(w, m, 15, 15, false);
  stepSec(w, 6);
  let minD = Infinity;
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) minD = Math.min(minD, Math.hypot(ms[i].x - ms[j].x, ms[i].y - ms[j].y));
  check('soft separation keeps a crowd from stacking', minD > 0.5, minD.toFixed(3));
  const t = addUnit(w, 'fx_tower', 1, 20, 25);
  const a = fighterEnt(w, 0);
  a.x = 20; a.y = 20;
  issueMove(w, a, 20, 30, false);
  let worst = 0;
  for (let i = 0; i < 120; i++) {
    w.step();
    const pen = a.radius + t.radius - Math.hypot(a.x - t.x, a.y - t.y);
    if (pen > worst) worst = pen;
  }
  check('structures are hard: no meaningful overlap while walking past', worst < 0.15, worst.toFixed(3));
  check('…and the unit gets past it (structures block nav cells)', a.y > 26 && !w.nav.walkable(20, 25), a.y);
  killEntity(w, t, null);
  check('a destroyed structure frees its cells', w.nav.walkable(20, 25));
});

finish('probe_sim_core_nav');
