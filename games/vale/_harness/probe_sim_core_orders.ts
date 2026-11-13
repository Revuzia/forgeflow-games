// probe (lane SIM): move and attack-move orders end where the player meant and never leave the hero
// wandering (owner report 2026-11-12: "it starts to run around on its own"; ruling 33).
//   fixture map: a click into a wall / the border snaps to an open point near the click and the order ENDS
//   (no slide-in-place livelock, the hero fights back afterwards); a crowd on the clicked spot ends the move
//   near it; a plain move never chases after arrival; an attack-move with a picked enemy walks past nearer
//   in-range minions to it, and falls back to a plain attack-move once it dies; determinism (two runs equal).
//   real RIFT catalog (content build): clicks into a pillar, a jungle wall, an allied tower's footprint and
//   200 random clicks around lanes and jungle all finish with 0 drift and 0 heading flips afterwards.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section } from './fixtures/sim_fixture.ts';
import { issueMove } from '../src/sim/movement.ts';
import { killEntity } from '../src/sim/combat.ts';
import { ORDER_ATTACK_MOVE, ORDER_MOVE, ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_slinger', { base: { ad: 1, attackSpeed: 1, moveSpeed: 3.35 }, attack: { range: 5.6, windup: 0.2, projectileSpeed: 20 } }),
    fighter('fx_foe', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 3.35 }, attack: { range: 1.5, windup: 0.3 } }),
  ],
});

interface Walk { len: number; flips: number; net: number }
/** path length, heading reversals (> 90°) and net displacement of a run of positions */
function walk(pts: { x: number; y: number }[]): Walk {
  let len = 0, flips = 0, last: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, d = Math.hypot(dx, dy);
    len += d;
    if (d > 1e-4) {
      const h = Math.atan2(dy, dx);
      if (last !== null) { let a = Math.abs(h - last); if (a > Math.PI) a = 2 * Math.PI - a; if (a > Math.PI / 2) flips++; }
      last = h;
    }
  }
  const net = pts.length > 1 ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) : 0;
  return { len, flips, net };
}
function trace(w: World, e: Entity, ticks: number, each?: (k: number) => void): { x: number; y: number; order: number }[] {
  const out: { x: number; y: number; order: number }[] = [];
  for (let k = 0; k < ticks; k++) { each?.(k); w.step(); out.push({ x: e.x, y: e.y, order: e.order }); }
  return out;
}
const f2 = (n: number): string => n.toFixed(2);
/** reference: shortest walk (m) for a body of radius r0 round standing discs (0.1 m grid, 16-neighbourhood Dijkstra; the
 *  start and goal may touch a body); Infinity when no lane exists */
function refPath(x0: number, y0: number, x1: number, y1: number, discs: { x: number; y: number; r: number }[], r0: number, walk: (x: number, y: number) => boolean): number {
  const h = 0.1, pad = 4;
  const minX = Math.min(x0, x1) - pad, minY = Math.min(y0, y1) - pad;
  const W = Math.ceil((Math.abs(x1 - x0) + 2 * pad) / h), H = Math.ceil((Math.abs(y1 - y0) + 2 * pad) / h);
  const blocked = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = minX + (i + 0.5) * h, y = minY + (j + 0.5) * h;
    if (!walk(x, y)) { blocked[j * W + i] = 1; continue; }
    for (const d of discs) { const rr = d.r + r0; if ((x - d.x) ** 2 + (y - d.y) ** 2 < rr * rr) { blocked[j * W + i] = 1; break; } }
  }
  const si = Math.floor((x0 - minX) / h), sj = Math.floor((y0 - minY) / h), gi = Math.floor((x1 - minX) / h), gj = Math.floor((y1 - minY) / h);
  // start/goal cells may be inside discs (touching): clear a small radius
  for (const [ci, cj] of [[si, sj], [gi, gj]]) for (let dj = -7; dj <= 7; dj++) for (let di = -7; di <= 7; di++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < W && j < H) blocked[j * W + i] = 0; }
  const dist = new Float64Array(W * H).fill(Infinity);
  const N: [number, number][] = [];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if ((di || dj) && (Math.abs(di) !== 2 || Math.abs(dj) !== 2) && !(Math.abs(di) === 2 && dj === 0) && !(Math.abs(dj) === 2 && di === 0)) N.push([di, dj]);
  // simple binary heap
  const heap: [number, number][] = [];
  const push = (d: number, k: number) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0]; const l = heap.pop()!; if (heap.length) { heap[0] = l; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[i][0] <= heap[c][0]) break; [heap[i], heap[c]] = [heap[c], heap[i]]; i = c; } } return t; };
  const s = sj * W + si, g = gj * W + gi;
  dist[s] = 0; push(0, s);
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    if (k === g) return d * h;
    const i = k % W, j = (k / W) | 0;
    for (const [di, dj] of N) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const m = nj * W + ni;
      if (blocked[m]) continue;
      if (Math.abs(di) + Math.abs(dj) > 1) { // check the intermediate cells
        if (blocked[j * W + i + Math.sign(di)] && blocked[(j + Math.sign(dj)) * W + i]) continue;
      }
      const nd = d + Math.hypot(di, dj);
      if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
    }
  }
  return Infinity;
}

// ── fixture map: the wall slab is x 28..32, y 0..45 (clearance 0.25), map 60 × 60 ──
section('click into a wall: the goal snaps to the near side and the order ends', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 20 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 30, 20, false);
  check('the order point is open ground', w.nav.walkable(h.orderX, h.orderY), [h.orderX, h.orderY]);
  check('…on the hero\'s side of the wall, next to the click', h.orderX < 28 && Math.hypot(h.orderX - 30, h.orderY - 20) < 3, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends (no slide-in-place livelock)', end >= 0 && end < 120, end);
  const after = walk(tr.slice(end));
  check('0 drift and 0 heading flips after it ends', after.len < 1e-6 && after.flips === 0, after);
});

section('click deep into the map border: walks toward the click and stops at the edge', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 50 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, -20, 50, false);
  check('the goal is open, at the west edge on the click line', w.nav.walkable(h.orderX, h.orderY) && h.orderX < 1.5 && Math.abs(h.orderY - 50) < 1, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  check('the move ends', h.order === ORDER_NONE);
  check('no flips while walking there', walk(tr).flips === 0, walk(tr));
});

section('a click into the middle of a thick wall stops on the hero\'s side (no detour round the wall)', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 10 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 30.6, 10, false);   // inside the slab, a little past its middle
  check('the order point is open ground on the hero\'s side', w.nav.walkable(h.orderX, h.orderY) && h.orderX < 28, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends', end >= 0, end);
  check('0 drift after it ends', walk(tr.slice(end)).len < 1e-6, walk(tr.slice(end)));
});
section('a click just inside the far face of a long wall stops on the hero\'s side (the way round is 4× the line; ruling 36)', () => {
  // ruling 36 supersedes the round-2 "far face when clearly nearer": a goal must not need a route longer than
  // 1.3 × straight + 0.5 m; the slab's far face is ~70 m round its end for an 12 m line
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 10 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 31.9, 10, false);
  check('the order point is open ground on the hero\'s side, on the click line', w.nav.walkable(h.orderX, h.orderY) && h.orderX < 28 && Math.abs(h.orderY - 10) < 0.6, [f2(h.orderX), f2(h.orderY)]);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends with no heading flips', end >= 0 && walk(tr).flips === 0, { end, wk: walk(tr) });
  check('0 drift after it ends', end >= 0 && walk(tr.slice(end)).len < 1e-6);
});
section('a click just round the END of a wall, reachable within 1.3 × the line, goes there (ruling 36)', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 26, y: 43 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  issueMove(w, h, 30.5, 44.8, false);   // inside the slab's north end, 0.45 m from its open top edge
  check('the goal is open, beside the click (past the corner)', w.nav.walkable(h.orderX, h.orderY) && Math.hypot(h.orderX - 30.5, h.orderY - 44.8) < 1.2, [f2(h.orderX), f2(h.orderY)]);
  const x0 = h.x, y0 = h.y;
  const tr = trace(w, h, 150);
  const wk = walk(tr);
  const straight = Math.hypot(h.orderX - x0, h.orderY - y0);
  check('…and walks there within 1.3 × straight + 0.5 m', tr[tr.length - 1].order === ORDER_NONE && wk.len <= straight * 1.3 + 0.5, { len: f2(wk.len), straight: f2(straight) });
});

section('a shallow click just inside a wall face slides along the face to beside the click (no sticky walls)', () => {
  // verifier r2: B (the first open point on the click→hero line) was the hero's own cell for a diagonal click into
  // the face it stands at, so the order ended where the hero stood
  for (const [inX, ahead, minMove] of [[0.3, 3, 2.4], [0.4, 1.2, 0.9], [1.5, 2, 1.5], [0.6, 4, 3.4]] as const) {
    const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 27.4, y: 20 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
    const h = fighterEnt(w, 0);
    const x0 = h.x, y0 = h.y;
    issueMove(w, h, 28 + inX, 20 + ahead, false);
    check(`click ${inX} m in, ${ahead} m ahead: the goal is beside the click on the face`, h.orderX < 28 && Math.abs(h.orderY - (20 + ahead)) < 0.6, [f2(h.orderX), f2(h.orderY)]);
    const tr = trace(w, h, 120);
    const moved = Math.hypot(h.x - x0, h.y - y0);
    check(`click ${inX} m in, ${ahead} m ahead: the hero moves ≥ ${minMove} m along the face and the order ends`, moved >= minMove && tr[tr.length - 1].order === ORDER_NONE, f2(moved));
  }
});
section('hold-steer with the cursor kept just inside a wall face: the hero keeps sliding along it', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 27.4, y: 10 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  const y0 = h.y;
  // re-issue every ~140 ms (4 ticks) to a point 1.2–2 m ahead and 0.3–0.8 m inside the face, like a held right button
  trace(w, h, 90, (k) => { if (k % 4 === 0) issueMove(w, h, 28.3 + (k % 3) * 0.25, h.y + 1.2 + (k % 5) * 0.2, false); });
  check('3 s of hold-steer slides ≥ 8 m along the face', h.y - y0 >= 8, f2(h.y - y0));
});

section('wall click while an enemy is adjacent: the hero fights back after arriving', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 22, y: 20 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
  const h = fighterEnt(w, 0);
  h.autoAttack = true;
  const m = addUnit(w, 'fx_dummy', 1, 25, 23);
  issueMove(w, h, 30, 20, false);
  let attacks = 0;
  for (let k = 0; k < 150; k++) for (const ev of w.step()) if (ev.e === 'attack' && ev.src === h.id && ev.dst === m.id) attacks++;
  check('it auto-attacks the adjacent minion once the move ended', h.order === ORDER_NONE && attacks >= 2, { order: h.order, attacks });
});

section('a crowd standing on the clicked spot: the move ends near it within a second', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 55 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
  const h = fighterEnt(w, 0);
  const crowd: Entity[] = [];
  for (let i = 0; i < 6; i++) crowd.push(addUnit(w, 'fx_dummy', 0, 14 + (i % 3) * 0.9, 54.5 + Math.floor(i / 3)));
  issueMove(w, h, 15, 55, false);
  const tr = trace(w, h, 150);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('the move ends within 3 s', end >= 0 && end < 90, end);
  check('…near the click', Math.hypot(h.x - 15, h.y - 55) < h.radius + 1.6, f2(Math.hypot(h.x - 15, h.y - 55)));
  check('0 drift after it ends', walk(tr.slice(end + 1)).len < 0.05, walk(tr.slice(end + 1)));
});

section('a move to open ground past a dense minion clump walks round it (no grinding through the blob)', () => {
  // verifier r2: a right-click past ~20 stacked minions took 9–12 s and often never arrived (body-blocked, crawling);
  // ruling 35: a walking fighter steers round units standing on its line
  for (const [n, team] of [[20, 1], [20, 0], [12, 1]] as const) {
    const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 40 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
    const h = fighterEnt(w, 0);
    for (let i = 0; i < n; i++) addUnit(w, 'fx_dummy', team, 15 + (i % 5) * 0.75, 38.5 + Math.floor(i / 5) * 0.75);
    issueMove(w, h, 21.5, 40, false);
    const tr = trace(w, h, 300);
    const end = tr.findIndex((p) => p.order === ORDER_NONE);
    const wk = walk(tr.slice(0, end < 0 ? tr.length : end));
    check(`${n} ${team ? 'enemy' : 'allied'} minions in the way: arrives inside 5 s (11.5 m straight), no back-and-forth`, end >= 0 && end < 150 && wk.flips === 0 && Math.hypot(h.x - 21.5, h.y - 40) < 0.2, { end, len: f2(wk.len), flips: wk.flips });
  }
});
section('ruling 36: a plain move through a standing wave with a clear lane detours ≤ 15 %', () => {
  // two clumps of enemy minions leave a lane just off the straight line (verifier r3: 25–55 % detours through waves)
  for (const team of [1, 0]) {
    const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 6, y: 52 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
    const h = fighterEnt(w, 0);
    for (let i = 0; i < 6; i++) addUnit(w, 'fx_dummy', team, 12 + (i % 3) * 0.95, 49.0 + Math.floor(i / 3) * 0.95);
    for (let i = 0; i < 6; i++) addUnit(w, 'fx_dummy', team, 12.4 + (i % 3) * 0.95, 52.85 + Math.floor(i / 3) * 0.95);
    issueMove(w, h, 20, 52, false);
    const tr = trace(w, h, 200);
    const end = tr.findIndex((p) => p.order === ORDER_NONE);
    const wk = walk([{ x: 6, y: 52 }, ...tr.slice(0, end < 0 ? tr.length : end + 1)]);
    check(`${team ? 'enemy' : 'allied'} wave with a lane: arrives, walked ≤ 1.15 × the 14 m line`, end >= 0 && Math.hypot(h.x - 20, h.y - 52) < 0.2 && wk.len <= 14 * 1.15, { end, len: f2(wk.len), flips: wk.flips });
  }
});
section('ruling 36: an ally walking the same way ahead is not steered round', () => {
  // verifier r3: a hero ordered to the same point as an ally 1.5 m ahead sidestepped 1.9 m and held the offset 3.5 s
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 52 }, { fighter: 'fx_slinger', team: 0, x: 11.5, y: 52 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
  const h = fighterEnt(w, 0), a = fighterEnt(w, 1);
  issueMove(w, a, 22, 52, false); issueMove(w, h, 22, 52, false);
  let off = 0;
  const tr = trace(w, h, 150, () => { off = Math.max(off, Math.abs(h.y - 52)); });
  check('the hero follows in line (lateral offset ≤ 0.3 m all the way)', off <= 0.3, f2(off));
  check('…and its move ends near the point (the ally stands on it)', tr[tr.length - 1].order === ORDER_NONE && Math.hypot(h.x - 22, h.y - 52) < h.radius + a.radius + 1.2, [f2(h.x), f2(h.y)]);
});
section('ruling 36: boxed in by bodies with no way through, the hero re-plans within ~1 s and stops cleanly (no steering in place)', () => {
  // a solid wall of standing minions (two staggered rows) from the slab to the east map edge: no route exists for a
  // walker. (Ruling 37: a single row 0.85 m apart is not "no way through": soft separation lets a fighter that presses
  // straight into it squeeze through in ~1.5 s, which the round-3 steering never did only because it spent that time
  // swaying 1.5 m side to side in front of the row.)
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 45, y: 20 }, { fighter: 'fx_foe', team: 1, x: 10, y: 55 }]);
  const h = fighterEnt(w, 0);
  for (let x = 32.6; x < 60; x += 0.85) { addUnit(w, 'fx_dummy', 0, x, 24); addUnit(w, 'fx_dummy', 0, x + 0.425, 24.75); }
  issueMove(w, h, 45, 30, false);
  let replanAt = -1, blockedAt = -1;
  const tr = trace(w, h, 240, (k) => {
    if (blockedAt < 0 && h.y > 24 - 0.45 - h.radius - 0.15) blockedAt = k;   // reached the line of bodies
    if (replanAt < 0 && h.watchStage >= 1) replanAt = k;
  });
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('a no-progress window re-plans within ~1.3 s of meeting the line', blockedAt >= 0 && replanAt >= blockedAt && replanAt - blockedAt <= 40, { blockedAt, replanAt });
  check('…and the move ends within ~2.5 s of it', end >= 0 && end - blockedAt <= 75, { blockedAt, end });
  // (it ends pressed into the wall, overlapping it: the soft separation eases it back out by a few cm, nothing more)
  check('0 drift after it ends (settling out of the overlap ≤ 0.1 m)', end >= 0 && walk(tr.slice(end)).len < 0.1, end >= 0 ? walk(tr.slice(end)) : null);
  // ruling 38: pressing into the wall, never swaying along it (r3 swung 1.6 m side to side while it waited)
  let sway = 0;
  for (let k = Math.max(0, blockedAt); k < (end >= 0 ? end : tr.length); k++) sway = Math.max(sway, Math.abs(tr[k].x - 45));
  check('…pressing straight into it (lateral sway ≤ 0.2 m)', sway <= 0.2, f2(sway));
});
section('ruling 38: standing bodies flanking the line: one lane, one side, no side flips and no heading reversals', () => {
  // verifier r4: steerRound flipped sides every 3 ticks between standing allies (the hero vibrated ~0.1 m in place for
  // a 1 s watchdog window, then again); a lane round them is planned once and walked
  for (const [label, units] of [
    ['a symmetric pair astride the line', [[14, 51.3], [14, 52.7]]],
    ['a gap narrower than the hero between two pairs', [[13.5, 51.2], [13.5, 52.8], [14.4, 51.5], [14.4, 52.5]]],
    ['a staggered clump', [[13, 52], [13.8, 51.2], [13.8, 52.8], [14.6, 52.1], [15.4, 51.4], [15.4, 52.9]]],
  ] as const) {
    for (const team of [0, 1]) {
      const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 8, y: 52 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
      const h = fighterEnt(w, 0);
      for (const [x, y] of units) addUnit(w, 'fx_dummy', team, x, y);
      issueMove(w, h, 20, 52, false);
      let flips = 0, last = 0;
      const tr = trace(w, h, 200, () => { if (h.steerSide !== 0 && last !== 0 && h.steerSide !== last) flips++; if (h.steerSide !== 0) last = h.steerSide; });
      const end = tr.findIndex((p) => p.order === ORDER_NONE);
      const wk = walk([{ x: 8, y: 52 }, ...tr.slice(0, end < 0 ? tr.length : end + 1)]);
      check(`${label} (${team ? 'enemy' : 'allied'}): arrives, 0 side flips, 0 heading reversals, walked ≤ 1.15 × the 12 m line`,
        end >= 0 && Math.hypot(h.x - 20, h.y - 52) < 0.2 && flips === 0 && wk.flips === 0 && wk.len <= 12 * 1.15, { end, flips, wk: { len: f2(wk.len), flips: wk.flips } });
    }
  }
});
section('ruling 38: a column of bodies marching through the hero never carries it the wrong way', () => {
  // verifier-style live wave: an allied wave walked through a hero ordered the other way; it planned round where the
  // bodies stood, walked with them and was carried 13 m off. Lanes now pass beside where moving bodies are going.
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 30, y: 52 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
  const h = fighterEnt(w, 0);
  const col: Entity[] = [];
  for (let i = 0; i < 12; i++) col.push(addUnit(w, 'fx_minion', 0, 22 + (i % 4) * 1.0, 51 + Math.floor(i / 4) * 1.0));
  for (const m of col) issueMove(w, m, m.x + 30, m.y, false);
  issueMove(w, h, 20, 52, false);
  let away = 0;
  const tr = trace(w, h, 240, () => { away = Math.max(away, h.x - 30); });
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('it never ends up more than 0.5 m further from its point than it started, and gets there', away <= 0.5 && end >= 0 && Math.hypot(h.x - 20, h.y - 52) < 0.3, { away: f2(away), end, at: [f2(h.x), f2(h.y)] });
});
section('ruling 38: the same move re-sent while it is walked changes nothing (a held button, a hold-steer over a still cursor)', () => {
  const run = (resend: boolean): { x: number; y: number }[] => {
    const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 20, y: 30 }, { fighter: 'fx_foe', team: 1, x: 55, y: 55 }]);
    const h = fighterEnt(w, 0);
    for (let i = 0; i < 6; i++) addUnit(w, 'fx_dummy', 1, 23 + (i % 2) * 0.9, 29.2 + Math.floor(i / 2) * 0.8);
    issueMove(w, h, 29.6, 36.5, false);   // into the slab's face, past the clump
    return trace(w, h, 150, (k) => { if (resend && k % 4 === 0) issueMove(w, h, 29.6, 36.5, false); });
  };
  const a = run(false), b = run(true);
  let diff = 0; for (let k = 0; k < a.length; k++) diff = Math.max(diff, Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y));
  check('re-sending the point every 4 ticks walks exactly the single click\'s path', diff < 1e-9, f2(diff));
});

section('a plain move never chases after arrival', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 10, y: 55 }, { fighter: 'fx_foe', team: 1, x: 55, y: 20 }]);
  const h = fighterEnt(w, 0);
  h.autoAttack = true;
  addUnit(w, 'fx_dummy', 1, 24, 56); addUnit(w, 'fx_dummy', 1, 24.8, 54);
  issueMove(w, h, 16, 55, false);
  const tr = trace(w, h, 240);
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('arrives', end >= 0);
  check('stays put afterwards (attacks in place only)', walk(tr.slice(end)).len < 1e-6, walk(tr.slice(end)));
});

// attack-move with a picked enemy (prefer): ranged hero, minion wave in front, the enemy fighter behind it
function wave(hx: number): { w: World; h: Entity; f: Entity; m: Entity[] } {
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: hx, y: 50 }, { fighter: 'fx_foe', team: 1, x: 19, y: 52 }], { seed: 7 });
  const h = fighterEnt(w, 0), f = fighterEnt(w, 1);
  f.hp = f.maxHp = 1e6;
  const m = [addUnit(w, 'fx_dummy', 1, 14, 50), addUnit(w, 'fx_dummy', 1, 15, 53), addUnit(w, 'fx_dummy', 1, 17, 48)];
  w.hashDirty = true; w.vision.update(w.entities, w.tick);
  return { w, h, f, m };
}
function attacks(w: World, h: Entity, ticks: number, each?: (k: number) => void): number[] {
  const seq: number[] = [];
  for (let k = 0; k < ticks; k++) { each?.(k); for (const ev of w.step()) if (ev.e === 'attack' && ev.src === h.id) seq.push(ev.dst); }
  return seq;
}
section('attack-move with a picked enemy walks past in-range minions to it', () => {
  const { w, h, f, m } = wave(10);
  issueMove(w, h, f.x, f.y, true, f.id);
  const seq = attacks(w, h, 180);
  check('the picked fighter is the first and only target', seq.length > 0 && seq.every((id) => id === f.id), seq.map((id) => (id === f.id ? 'F' : `M${m.findIndex((x) => x.id === id) + 1}`)));
  check('the order is still a committed attack-move', h.order === ORDER_ATTACK_MOVE && h.orderTarget === f.id);
});
section('the picked enemy dies: the order falls back to a plain attack-move to its point', () => {
  const { w, h, f, m } = wave(10);
  issueMove(w, h, 21, 50, true, f.id);
  const seq = attacks(w, h, 120, (k) => { if (k === 40) killEntity(w, f, h); });
  check('it attacked the picked fighter first', seq[0] === f.id, seq);
  check('then the nearest minion in range (plain attack-move)', seq.slice(1).some((id) => m.some((x) => x.id === id)) && h.orderTarget === -1, { seq, orderTarget: h.orderTarget });
});
section('attack-move without a pick: walks and attacks the first enemy in range', () => {
  const { w, h, m } = wave(3);
  issueMove(w, h, 18, 51, true);
  const seq = attacks(w, h, 150);
  check('first target is the minion that came into range first', seq[0] === m[0].id, seq);
  check('stopped walking to attack (never chases)', h.order === ORDER_ATTACK_MOVE && h.x < 9, f2(h.x));
});
section('orders are deterministic (two runs, identical positions and orders)', () => {
  const run = (): string => {
    const { w, h, f } = wave(10);
    issueMove(w, h, f.x, f.y, true, f.id);
    const tr = trace(w, h, 90, (k) => { if (k === 30) issueMove(w, h, 30, 20, false); });
    return tr.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.order}`).join(';');
  };
  check('identical', run() === run());
});

// ── real RIFT catalog ──
async function rift(): Promise<void> {
  const { buildContent, defaultOptions } = await import('../tools/build_content.ts');
  const { createSim } = await import('../src/sim/sim.ts');
  const { pickLoadout } = await import('../src/sim/bots/index.ts');
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.log('SKIP RIFT section: content build failed'); return; }
  const rc = r.catalog;
  const mode = rc.modes.find((m) => m.id === 'rift');
  const queue = rc.queues.find((q) => q.mode === 'rift');
  if (!mode || !queue) { console.log('SKIP RIFT section: no rift mode'); return; }
  const fs = rc.fighters.map((f) => f.id).sort();
  const hero = fs.includes('lisvel') ? 'lisvel' : fs[0];
  const fresh = (first: string = hero) => {
    const seats = Array.from({ length: 10 }, (_, i) => {
      const fighter = i === 0 ? first : fs[(i * 3) % fs.length];
      return { player: i, team: i < 5 ? 0 : 1, name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)?.id ?? '', controller: 'human' as const,
        loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i };
    });
    const sim = createSim(rc, { matchId: 'probe_orders', seed: 1, queue: queue.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version } as never, { pregameSeconds: 0 });
    sim.step();
    return { sim, me: sim.world.players[0].ent! };
  };
  const place = (w: World, e: Entity, x: number, y: number): void => {
    e.x = x; e.y = y; e.path.length = 0; e.pathGoalX = NaN; w.hashDirty = true;
    if (!w.nav.walkable(x, y)) { const o = { x: 0, y: 0 }; if (w.nav.nearestWalkable(x, y, o)) { e.x = o.x; e.y = o.y; } }
  };
  const runTo = (sim: ReturnType<typeof fresh>['sim'], me: Entity, gx: number, gy: number, ticks: number) => {
    const tr: { x: number; y: number; order: number }[] = [];
    for (let k = 0; k < ticks; k++) { if (k === 0) sim.command(0, { type: 'move', x: gx, y: gy }); sim.step(); tr.push({ x: me.x, y: me.y, order: me.order }); }
    return tr;
  };
  for (const [name, gx, gy, sx, sy] of [['pillar centre', 85, 66.6, 85, 58], ['pillar far side', 85, 66.6, 85, 76], ['jungle wall', 70, 64.5, 70, 58], ['map border', 1, 30, 12, 45]] as const) {
    const { sim, me } = fresh(); place(sim.world, me, sx, sy);
    const tr = runTo(sim, me, gx, gy, 300);
    const end = tr.findIndex((p) => p.order === ORDER_NONE);
    const after = walk(tr.slice(Math.max(0, end)));
    check(`RIFT ${name}: the move ends with 0 drift and 0 flips afterwards`, end >= 0 && after.len < 0.05 && after.flips === 0, { end, after, at: [f2(me.x), f2(me.y)] });
  }
  {
    const { sim, me } = fresh();
    const w = sim.world;
    const tower = w.entities.filter((e) => e.kind === 'structure' && e.team === 0 && e.alive && e.radius > 0.5).sort((a, b) => a.id - b.id)[0];
    if (tower) {
      place(w, me, tower.x - 6, tower.y + 2);
      const tr = runTo(sim, me, tower.x + 0.2, tower.y + 0.3, 300);
      const end = tr.findIndex((p) => p.order === ORDER_NONE);
      check('RIFT allied tower footprint click: the move ends beside it, no drift', end >= 0 && walk(tr.slice(end)).len < 0.05, { end, after: walk(tr.slice(Math.max(0, end))) });
    }
  }
  {
    let s = 12345;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const spots: [number, number][] = [[70, 55], [72, 40], [95, 75], [75, 12], [22, 55]];
    let n = 0, stuck = 0, open = 0;
    const bad: string[] = [];
    for (const [hx, hy] of spots) {
      const { sim } = fresh();
      for (let i = 0; i < 40; i++) {
        const me = sim.world.players[0].ent!;
        place(sim.world, me, hx, hy);
        const a = rnd() * Math.PI * 2, d = 2 + rnd() * 12;
        const gx = hx + Math.cos(a) * d, gy = hy + Math.sin(a) * d;
        const tr = runTo(sim, me, gx, gy, 300);
        sim.command(0, { type: 'stop' }); sim.step();
        n++;
        if (me.order === ORDER_NONE || tr[tr.length - 1].order === ORDER_NONE) open++;
        const tail = walk(tr.slice(-60));
        if (tr[tr.length - 1].order === ORDER_MOVE || tail.flips > 0) { stuck++; if (bad.length < 4) bad.push(`(${f2(hx)},${f2(hy)})→(${f2(gx)},${f2(gy)}) ${JSON.stringify(tail)}`); }
      }
    }
    check(`RIFT 200 random clicks 2–14 m away: every move ends inside 10 s, no flips at the end (${n - stuck}/${n})`, stuck === 0, bad);
    void open;
  }
  {
    // verifier r2 (bots): the sim snaps a blocked move point, so a bot that de-duplicates its moves against the snapped
    // orderX/Y re-sent a move to the same thicket point every tick (each one resetting the path and the windup)
    const { createBots } = await import('../src/sim/bots/index.ts');
    const seats = Array.from({ length: 10 }, (_, i) => {
      const fighter = fs[(i * 3 + 1) % fs.length];
      return { player: i, team: i < 5 ? 0 : 1, name: `b${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)?.id ?? '', controller: 'bot' as const,
        loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i, difficulty: 'adept' };
    });
    const setup = { matchId: 'probe_orders_bots', seed: 21, queue: queue.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version } as never;
    const real = createBots(rc, setup);
    let moves = 0, redundant = 0, longest = 0;
    const runs = new Map<number, { x: number; y: number; n: number }>();
    let simRef: ReturnType<typeof createSim> | null = null;
    const bots = (seat: never, host: never) => {
      const c = real(seat, host);
      if (!c) return c;
      const pl = (seat as { player: number }).player;
      return { think: (w: World, p: never) => {
        const out = c.think(w as never, p);
        for (const cmd of out as { type: string; x?: number; y?: number }[]) {
          if (cmd.type !== 'move') continue;
          moves++;
          const blocked = !w.nav.walkable(cmd.x!, cmd.y!);
          const r = runs.get(pl);
          if (blocked && r && Math.abs(r.x - cmd.x!) + Math.abs(r.y - cmd.y!) < 0.6) { redundant++; r.n++; longest = Math.max(longest, r.n); }
          else runs.set(pl, { x: cmd.x!, y: cmd.y!, n: 0 });
        }
        return out;
      } };
    };
    simRef = createSim(rc, setup, { bots: bots as never, pregameSeconds: 0 });
    for (let k = 0; k < 30 * 240; k++) simRef.step();
    check(`RIFT 10 bots, 240 s: no bot re-sends a move to the same blocked point tick after tick (${redundant} repeats / ${moves} moves, longest run ${longest})`,
      longest < 10 && redundant < moves * 0.02, { moves, redundant, longest, faults: simRef.faults.slice(0, 2) });
  }

  // ── ruling 36 (verifier r3 repros) ──
  const quiet = (sim: ReturnType<typeof fresh>['sim'], me: Entity): void => {
    // the hero alone and unhurt: other fighters idle at base, towers cannot kill it mid-measurement
    for (const e of sim.world.entities) if (e.kind === 'structure' && e.team !== me.team) e.stats.ad = 0;
  };
  const walkOrder = (sim: ReturnType<typeof fresh>['sim'], me: Entity, gx: number, gy: number, ticks: number, each?: (k: number) => void) => {
    const tr: { x: number; y: number; order: number }[] = [{ x: me.x, y: me.y, order: me.order }];
    for (let k = 0; k < ticks; k++) {
      if (k === 0) sim.command(0, { type: 'move', x: gx, y: gy });
      each?.(k); me.hp = me.maxHp; sim.step();
      tr.push({ x: me.x, y: me.y, order: me.order });
      if (k > 2 && me.order === ORDER_NONE && !each) break;
    }
    return tr;
  };
  for (const [name, who, hx, hy, cx, cy] of [
    ['dunsom deep wall click (r3: 9.45 m walked for 2.27 m)', 'dunsom', 105.69, 100.49, 106.35, 107.8],
    ['shallow wall click (r3: 8.97 m walked for 2.13 m)', hero, 65.88, 50.64, 64, 49.96],
    ['shallow wall click (r3: 6.48 m walked for 3.57 m)', hero, 23.21, 44.17, 27.2, 42.86],
    ['top-lane wall click along the wall (r3 LIVE BLOCKER: 9 m the wrong way)', hero, 62.69, 8.33, 56.15, 8.22],
  ] as const) {
    if (!fs.includes(who)) continue;
    const { sim, me } = fresh(who); quiet(sim, me); place(sim.world, me, hx, hy); sim.step();
    const x0 = me.x, y0 = me.y;
    const tr = walkOrder(sim, me, cx, cy, 300);
    const wk = walk(tr);
    let away = 0; for (const p of tr) away = Math.max(away, Math.hypot(p.x - cx, p.y - cy) - Math.hypot(x0 - cx, y0 - cy));
    check(`RIFT ${name}: ends, walked ≤ 1.6 × net + 1 m, never > 1 m further from the click`, me.order === ORDER_NONE && wk.len <= 1.6 * wk.net + 1 && away <= 1,
      { goal: [f2(me.orderX), f2(me.orderY)], end: [f2(me.x), f2(me.y)], walked: f2(wk.len), net: f2(wk.net), away: f2(away) });
  }
  {
    // r3: hero (60.78, 60) at a wall face (x ≈ 61), the held cursor 0.8 m ahead inside it: snapped behind and backed 0.55 m
    const { sim, me } = fresh(hero); quiet(sim, me); place(sim.world, me, 60.78, 60); sim.step();
    const c = { x: 61.58, y: 60 };
    const d0 = Math.hypot(me.x - c.x, me.y - c.y);
    let back = 0;
    for (let k = 0; k < 60; k++) {
      if (k % 4 === 0) sim.command(0, { type: 'move', x: Math.max(c.x, me.x + 0.8), y: c.y });
      me.hp = me.maxHp; sim.step();
      back = Math.max(back, Math.hypot(me.x - c.x, me.y - c.y) - d0);
    }
    check('RIFT hold-steer into a wall face ahead never steps the hero backwards', back <= 0.02, { back: f2(back), at: [f2(me.x), f2(me.y)] });
  }
  {
    // r3: 300 shallow wall clicks (17 sent the hero > 1 m away, 18 paths > 1.6 × net + 1 m); half along the hero's facing
    // ray (a click just past the face it walks at), half anywhere within 7 m (diagonal / along-face clicks)
    const { sim, me } = fresh(hero); quiet(sim, me);
    const w = sim.world, nav = w.nav;
    const [W, H] = w.mapDef.size;
    const main = nav.componentAt(85, 58);
    let s = 777;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const t = { x: 0, y: 0 }, route: number[] = [];
    let n = 0, far = 0, long = 0, away1 = 0, open = 0, worst = 0;
    const bad: string[] = [];
    while (n < 300) {
      const hx = 3 + rnd() * (W - 6), hy = 3 + rnd() * (H - 6);
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
      let cx: number, cy: number;
      const a = rnd() * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
      if (n % 2 === 0) {
        let hit = -1;
        for (let d = 0.1; d < 6; d += 0.05) if (!nav.walkable(hx + ux * d, hy + uy * d)) { hit = d; break; }
        if (hit < 0) continue;
        const depth = 0.15 + rnd() * 1.2, lat = (rnd() - 0.5);
        cx = hx + ux * (hit + depth) - uy * lat; cy = hy + uy * (hit + depth) + ux * lat;
      } else { const d = 1 + rnd() * 6; cx = hx + ux * d; cy = hy + uy * d; }
      if (cx < 0 || cy < 0 || cx >= W || cy >= H || nav.walkable(cx, cy) || nav.wallFree(cx, cy)) continue;
      if (!nav.nearestWalkable(cx, cy, t, 4) || Math.hypot(t.x - cx, t.y - cy) > (n % 2 === 0 ? 1.5 : 1)) continue;   // shallow
      // walls only: no minion, monster or other fighter near enough to steer round (the wave tests below cover units)
      if (w.entities.some((e) => e !== me && e.alive && !e.static && e.kind !== 'projectile' && e.kind !== 'zone' && (Math.hypot(e.x - hx, e.y - hy) < 10 || Math.hypot(e.x - cx, e.y - cy) < 10))) continue;
      place(w, me, hx, hy); me.order = ORDER_NONE; sim.step();
      const x0 = me.x, y0 = me.y, d0 = Math.hypot(x0 - cx, y0 - cy);
      const tr = walkOrder(sim, me, cx, cy, 300);
      n++;
      const wk = walk(tr);
      // the best end the rule allows, found independently: open cells nearest the click first, the first one the
      // walker's own planner reaches within 1.3 × straight + 0.5 m (else the straight walk's stop at the obstacle)
      nav.raycast(x0, y0, cx, cy, t);
      let ref = Math.hypot(t.x - cx, t.y - cy);
      const c = nav.cell;
      const cells: [number, number, number][] = [];
      for (let gy = Math.floor((cy - 4) / c); gy <= Math.floor((cy + 4) / c); gy++) for (let gx = Math.floor((cx - 4) / c); gx <= Math.floor((cx + 4) / c); gx++) {
        const px = (gx + 0.5) * c, py = (gy + 0.5) * c, d = Math.hypot(px - cx, py - cy);
        if (d < ref && nav.walkable(px, py) && nav.componentAt(px, py) === main) cells.push([d, px, py]);
      }
      cells.sort((p, q) => p[0] - q[0]);
      for (const [d, px, py] of cells.slice(0, 12)) {
        if (!nav.findPath(x0, y0, px, py, route, me.radius)) continue;
        let l = 0, qx = x0, qy = y0; for (let i = 0; i < route.length; i += 2) { l += Math.hypot(route[i] - qx, route[i + 1] - qy); qx = route[i]; qy = route[i + 1]; }
        if (Math.hypot(qx - px, qy - py) < 1e-3 && l <= Math.hypot(px - x0, py - y0) * 1.3 + 0.5) { ref = d; break; }
      }
      const exc = Math.hypot(me.x - cx, me.y - cy) - ref;
      let away = 0; for (const p of tr) away = Math.max(away, Math.hypot(p.x - cx, p.y - cy) - d0);
      worst = Math.max(worst, exc);
      const tags: string[] = [];
      if (exc > 1) { far++; tags.push('far'); }
      if (wk.len > 1.6 * wk.net + 1) { long++; tags.push('long'); }
      if (away > 1) { away1++; tags.push('away'); }
      if (me.order !== ORDER_NONE) { open++; tags.push('open'); }
      if (tags.length && bad.length < 6) bad.push(`${tags.join('+')} (${f2(x0)},${f2(y0)})→(${f2(cx)},${f2(cy)}) goal (${f2(me.orderX)},${f2(me.orderY)}) walked ${f2(wk.len)} net ${f2(wk.net)}`);
    }
    check(`RIFT 300 shallow wall clicks: 0 end > 1 m past the best reachable point (${far}), 0 paths > 1.6 × net + 1 m (${long}), 0 walk > 1 m away from the click (${away1}), all end (${open} open)`,
      far === 0 && long === 0 && away1 === 0 && open === 0, { worstExcess: f2(worst), bad });
  }
  {
    // r3: plain moves through a wave detoured 25–55 %. Real RIFT waves where they first meet: the hero 4 m behind the
    // clash on its own side, a move 7.8–12 m across it at lateral offsets. Where a lane exists (the shortest way for
    // its body round the standing bodies, a fine-grid search, is ≤ 10 % over the line) the walk is ≤ 15 % over it.
    let lane = 0, worst = 0, worstRef = 0;
    const over: string[] = [];
    for (const dist of [7.8, 10]) for (const lat of [-1, -0.5, 0, 0.5, 1]) {
      const { sim, me } = fresh(hero); quiet(sim, me);
      const w = sim.world;
      let pair: { a: Entity; b: Entity; d: number } | null = null;
      for (let k = 0; k < 30 * 120; k++) {
        me.hp = me.maxHp; sim.step();
        if (k % 5) continue;
        pair = null;
        const ms = w.entities.filter((e) => e.kind === 'minion' && e.alive);
        for (const a of ms) if (a.team === me.team) for (const b of ms) if (b.team !== me.team) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (!pair || d < pair.d) pair = { a, b, d }; }
        if (pair && pair.d < 6) break;
      }
      if (!pair) { check('RIFT waves meet within 120 s', false); break; }
      for (let k = 0; k < 30; k++) { me.hp = me.maxHp; sim.step(); }
      const mx = (pair.a.x + pair.b.x) / 2, my = (pair.a.y + pair.b.y) / 2;
      let ux = pair.b.x - pair.a.x, uy = pair.b.y - pair.a.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      place(w, me, mx - ux * 4 + uy * lat, my - uy * 4 - ux * lat); sim.step();
      const x0 = me.x, y0 = me.y, gx = x0 + ux * dist, gy = y0 + uy * dist;
      const discs = w.entities.filter((e) => e !== me && e.alive && (e.kind === 'minion' || e.kind === 'fighter') && Math.hypot(e.x - x0, e.y - y0) < 16).map((e) => ({ x: e.x, y: e.y, r: e.radius }));
      const ref = refPath(x0, y0, gx, gy, discs, me.radius, (x, y) => w.nav.walkable(x, y)) / dist - 1;
      const tr = walkOrder(sim, me, gx, gy, 240);
      const wk = walk(tr);
      const det = wk.len / Math.max(1e-6, wk.net) - 1;
      if (ref <= 0.10) {
        lane++; worst = Math.max(worst, det); worstRef = Math.max(worstRef, ref);
        if (det > 0.15 || Math.hypot(me.x - gx, me.y - gy) > 1.2) over.push(`${dist}/${lat}: ${f2(det)} (ref ${f2(ref)}) end ${f2(Math.hypot(me.x - gx, me.y - gy))}`);
      }
    }
    check(`RIFT moves across a lane fight with a clear lane: walked ≤ 1.15 × the line (${lane} lane cases, worst ${f2(worst)})`, lane >= 5 && over.length === 0, { worstRef: f2(worstRef), over });
  }
}

try { await rift(); } catch (err) { check(`RIFT section threw: ${(err as Error).stack ?? err}`, false); }

// ── ruling 38 (verifier r4 repros), real RIFT and BRIDGE catalogs ──
async function live38(): Promise<void> {
  const { buildContent, defaultOptions } = await import('../tools/build_content.ts');
  const { createSim } = await import('../src/sim/sim.ts');
  const { pickLoadout } = await import('../src/sim/bots/index.ts');
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.log('SKIP ruling 38 section: content build failed'); return; }
  const rc = r.catalog;
  const fs = rc.fighters.map((f) => f.id).sort();
  const fresh = (modeId: string, first: string, seed: number) => {
    const mode = rc.modes.find((m) => m.id === modeId)!, queue = rc.queues.find((q) => q.mode === modeId)!;
    const seats = Array.from({ length: 10 }, (_, i) => {
      const fighter = i === 0 ? first : fs[(i * 3) % fs.length];
      return { player: i, team: i < 5 ? 0 : 1, name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)?.id ?? '', controller: 'human' as const,
        loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i };
    });
    const sim = createSim(rc, { matchId: 'probe_orders_38', seed, queue: queue.id, mode: modeId, map: mode.map, seats, catalogVersion: rc.version } as never, { pregameSeconds: 0 });
    sim.step();
    for (const e of sim.world.entities) if (e.kind === 'structure') e.stats.ad = 0;
    return { sim, me: sim.world.players[0].ent! };
  };
  type Sim = ReturnType<typeof fresh>['sim'];
  const place = (w: World, e: Entity, x: number, y: number): void => { e.x = x; e.y = y; e.path.length = 0; e.pathGoalX = NaN; e.order = ORDER_NONE; w.hashDirty = true; };
  const bodies = (w: World, me: Entity, x: number, y: number, R: number) => w.entities
    .filter((o) => o !== me && o.alive && !o.static && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'monster') && Math.hypot(o.x - x, o.y - y) < R)
    .map((o) => ({ x: o.x, y: o.y, r: o.radius }));
  const crowdAt = (w: World, me: Entity, x: number, y: number) => w.entities
    .filter((o) => o !== me && o.alive && !o.static && (o.kind === 'minion' || o.kind === 'fighter' || o.kind === 'monster') && Math.hypot(o.x - x, o.y - y) < o.radius + me.radius + 0.6).length;
  const fines = (w: World): ((x: number, y: number) => boolean) => (x, y) => w.nav.walkable(x, y);
  const has = (id: string): boolean => fs.includes(id);

  // 1. live lane waves (the verifier's sampler): moves 7–13 m across fighting waves, the hero 3–5 m before a minion
  //    clump. r4 on the round-3 code: 6 % of moves had ≥ 5 steer side flips inside 1 s (up to one a tick), 12 / 768
  //    ended 3–10 m short with a lane open, detours up to 2.4 × the lane.
  for (const modeId of ['rift', 'bridge']) {
    let n = 0, dither = 0, ditherMax = 0, shortLane = 0, reversals = 0, revMax = 0, clear = 0, over15 = 0, worstClear = 0;
    const bad: string[] = [], overs: string[] = [];
    for (const who of fs) {
      const { sim, me } = fresh(modeId, who, 7);
      const w = sim.world, nav = w.nav;
      const main = nav.componentAt(me.x, me.y);
      let s = 2024 + 7919 * fs.indexOf(who);   // each fighter its own draws (the same draws gave every fighter the same 8 moves)
      const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      let k = 0;
      for (let t = 0; t < 30 * 200 && k < 8; t++) {
        me.hp = me.maxHp; sim.step();
        if (t < 30 * 40 || t % 45) continue;
        const ms = w.entities.filter((e) => e.kind === 'minion' && e.alive);
        if (ms.length < 6) continue;
        const m = ms[Math.floor(rnd() * ms.length)];
        if (ms.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 4).length < 4) continue;
        const a = rnd() * Math.PI * 2;
        const hx = m.x - Math.cos(a) * (3 + rnd() * 2), hy = m.y - Math.sin(a) * (3 + rnd() * 2);
        const d = 7 + rnd() * 6, gx = hx + Math.cos(a) * d, gy = hy + Math.sin(a) * d;
        if (!nav.walkable(hx, hy) || !nav.walkable(gx, gy) || nav.componentAt(gx, gy) !== main || nav.componentAt(hx, hy) !== main || !nav.lineOfWalk(hx, hy, gx, gy, 0.225)) continue;
        place(w, me, hx, hy); sim.step();
        const x0 = me.x, y0 = me.y, straight = Math.hypot(gx - x0, gy - y0);
        const lane = refPath(x0, y0, gx, gy, bodies(w, me, x0, y0, 16), me.radius, fines(w));
        const tr = [{ x: x0, y: y0 }];
        let last = 0;
        const flipAt: number[] = [];
        for (let q = 0; q < 300; q++) {
          if (q === 0) sim.command(0, { type: 'move', x: gx, y: gy });
          me.hp = me.maxHp; sim.step(); tr.push({ x: me.x, y: me.y });
          if (me.steerSide !== 0 && last !== 0 && me.steerSide !== last) flipAt.push(q);
          if (me.steerSide !== 0) last = me.steerSide;
          if (q > 1 && me.order === ORDER_NONE) break;
        }
        k++; n++;
        let dith = 0; for (let i = 0; i < flipAt.length; i++) { let c = 0; for (let j = i; j < flipAt.length && flipAt[j] - flipAt[i] <= 30; j++) c++; dith = Math.max(dith, c); }
        if (dith >= 5) dither++;
        ditherMax = Math.max(ditherMax, dith);
        const wk = walk(tr), dEnd = Math.hypot(me.x - gx, me.y - gy);
        reversals += wk.flips; revMax = Math.max(revMax, wk.flips);
        const tags: string[] = [];
        if (dEnd > 0.5 && crowdAt(w, me, gx, gy) === 0 && lane <= straight * 1.3) { shortLane++; tags.push(`short ${f2(dEnd)} (lane ${f2(lane / straight)}×)`); }
        if (dEnd < 0.1 && lane <= straight * 1.05) {
          clear++; worstClear = Math.max(worstClear, wk.len / straight);
          if (wk.len > straight * 1.15) { over15++; overs.push(`${who} t${t} ${f2(wk.len / straight)}× (lane ${f2(lane / straight)}×)`); }
        }
        if (dith >= 5) tags.push(`dither ${dith}`);
        if (tags.length && bad.length < 6) bad.push(`${who} t${t} (${f2(x0)},${f2(y0)})→(${f2(gx)},${f2(gy)}) ${tags.join(' ')}`);
      }
    }
    const M = modeId.toUpperCase();
    check(`${M} ${n} moves through live waves: 0 with ≥ 5 steer side flips inside 1 s (${dither}, max ${ditherMax})`, n >= 40 && dither === 0, bad);
    check(`${M} …0 ending > 0.5 m short of an open point where a lane ≤ 1.3 × the line existed (${shortLane})`, shortLane === 0, bad);
    check(`${M} …heading reversals ≤ 4 in any move (${revMax}; ${reversals} in all)`, revMax <= 4, { reversals });
    check(`${M} …moves with a clear lane (the shortest way round ≤ 1.05 × the line, ${clear}): ≤ 10 % walk over 1.15 × the line (${over15}), none over 1.6 × (worst ${f2(worstClear)})`,
      clear >= 30 && over15 <= clear * 0.1 && worstClear <= 1.6, overs);
  }

  // 2. packed lane fights after 3:55 (verifier r4 live probe: ~20 allied minions between the hero and an enemy wave; a
  //    plain move or a held right-click gave up after ~2 s 4–10 m short). A held button re-sends its point every 500 ms
  //    (input/controller.ts HOLD_RETRY_MS): modelled as the same move every 15 ticks.
  for (const modeId of ['rift', 'bridge']) {
    let n = 0, heldShort = 0, clickShortLane = 0;
    const bad: string[] = [];
    for (const who of ['ulkro', 'tunlan', 'lisvel'].filter(has)) {
      for (const hold of [false, true]) {
        const { sim, me } = fresh(modeId, who, 11);
        const w = sim.world, nav = w.nav;
        const main = nav.componentAt(me.x, me.y);
        let k = 0;
        for (let t = 0; t < 30 * 330 && k < 3; t++) {
          me.hp = me.maxHp; sim.step();
          if (t < 30 * 235 || t % 60 || w.phase !== 'live') continue;
          const mine = w.entities.filter((e) => e.kind === 'minion' && e.alive && e.team === me.team);
          const foes = w.entities.filter((e) => e.kind === 'minion' && e.alive && e.team !== me.team);
          let best: { n: number; cx: number; cy: number; fx: number; fy: number } | null = null;
          for (const m of mine) {
            const c = mine.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 5);
            if (c.length < 10) continue;
            const cx = c.reduce((a, o) => a + o.x, 0) / c.length, cy = c.reduce((a, o) => a + o.y, 0) / c.length;
            const f = foes.filter((o) => Math.hypot(o.x - cx, o.y - cy) < 8);
            if (f.length < 4) continue;
            if (!best || c.length > best.n) best = { n: c.length, cx, cy, fx: f.reduce((a, o) => a + o.x, 0) / f.length, fy: f.reduce((a, o) => a + o.y, 0) / f.length };
          }
          if (!best) continue;
          let ux = best.fx - best.cx, uy = best.fy - best.cy; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
          const hx = best.cx - ux * 4, hy = best.cy - uy * 4, gx = best.fx + ux * 3, gy = best.fy + uy * 3;
          if (!nav.walkable(hx, hy) || !nav.walkable(gx, gy) || nav.componentAt(hx, hy) !== main || nav.componentAt(gx, gy) !== main || !nav.lineOfWalk(hx, hy, gx, gy, 0.225)) continue;
          place(w, me, hx, hy); sim.step();
          const x0 = me.x, y0 = me.y, straight = Math.hypot(gx - x0, gy - y0);
          const lane = refPath(x0, y0, gx, gy, bodies(w, me, x0, y0, 20), me.radius, fines(w));
          for (let q = 0; q < 300; q++) {
            if (q === 0 || (hold && q % 15 === 0 && q < 240)) sim.command(0, { type: 'move', x: gx, y: gy });
            me.hp = me.maxHp; sim.step();
            if (q > 1 && me.order === ORDER_NONE && (!hold || q >= 240)) break;
          }
          k++; n++;
          const dEnd = Math.hypot(me.x - gx, me.y - gy), crowd = crowdAt(w, me, gx, gy);
          if (hold && dEnd > 2 && crowd === 0) { heldShort++; bad.push(`held ${who} t${t} ${f2(dEnd)} m short`); }
          if (!hold && dEnd > 2 && crowd === 0 && lane <= straight * 1.3) { clickShortLane++; bad.push(`click ${who} t${t} ${f2(dEnd)} m short, lane ${f2(lane / straight)}×`); }
        }
      }
    }
    check(`${modeId.toUpperCase()} ${n} moves through packed lane fights: a held button never ends > 2 m short of an uncrowded point (${heldShort}), a click never where a lane ≤ 1.3 × existed (${clickShortLane})`,
      n >= 6 && heldShort === 0 && clickShortLane === 0, bad);
  }

  // 3. deep wall clicks (verifier r4: more than SNAP_REACH 4 m from any open cell, the hero stopped 0.1–0.5 m on its
  //    own side while an open point 1–2.5 m nearer the click was reachable at ≤ 1.15 ×)
  if (has('tunlan')) {
    const { sim, me } = fresh('bridge', 'tunlan', 1);
    place(sim.world, me, 22.57, 15.87); sim.step();
    for (let q = 0; q < 240; q++) { if (q === 0) sim.command(0, { type: 'move', x: 19.52, y: 8.46 }); sim.step(); if (q > 2 && me.order === ORDER_NONE) break; }
    check('BRIDGE tunlan deep wall click (r4: stopped 7.62 m from the click; 3.90 m reachable at 1.11 ×): ends ≤ 4.9 m from it',
      me.order === ORDER_NONE && Math.hypot(me.x - 19.52, me.y - 8.46) <= 4.9, [f2(me.x), f2(me.y), f2(Math.hypot(me.x - 19.52, me.y - 8.46))]);
  }
  {
    // 120 deep clicks a map: the end is within 1 m of the best open point the walker's own planner reaches at ≤ 1.3 ×
    // straight + 0.5 m without walking away from the click, nothing longer than 1.6 × net + 1 m, nothing walking away
    for (const modeId of ['rift', 'bridge']) {
      const { sim, me } = fresh(modeId, has('lisvel') ? 'lisvel' : fs[0], 1);
      const w = sim.world, nav = w.nav;
      const [W, H] = w.mapDef.size;
      const main = nav.componentAt(me.x, me.y);
      let s = 4242;
      const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const t = { x: 0, y: 0 }, route: number[] = [];
      let n = 0, far = 0, long = 0, away1 = 0, tries = 0;
      const bad: string[] = [];
      while (n < 120 && tries++ < 200000) {
        const hx = 3 + rnd() * (W - 6), hy = 3 + rnd() * (H - 6);
        if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
        const a = rnd() * Math.PI * 2, d = 3 + rnd() * 9, cx = hx + Math.cos(a) * d, cy = hy + Math.sin(a) * d;
        if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || nav.walkable(cx, cy)) continue;
        if (nav.nearestWalkable(cx, cy, t, 16) && Math.hypot(t.x - cx, t.y - cy) < 2) continue;   // deep: ≥ 2 m inside
        if (w.entities.some((e) => e !== me && e.alive && !e.static && e.kind !== 'projectile' && e.kind !== 'zone' && Math.hypot(e.x - hx, e.y - hy) < 14)) continue;
        place(w, me, hx, hy); sim.step();
        const x0 = me.x, y0 = me.y, d0 = Math.hypot(x0 - cx, y0 - cy);
        const tr = [{ x: x0, y: y0 }];
        for (let q = 0; q < 300; q++) { if (q === 0) sim.command(0, { type: 'move', x: cx, y: cy }); me.hp = me.maxHp; sim.step(); tr.push({ x: me.x, y: me.y }); if (q > 2 && me.order === ORDER_NONE) break; }
        n++;
        const wk = walk(tr);
        nav.raycast(x0, y0, cx, cy, t);
        let ref = Math.hypot(t.x - cx, t.y - cy);
        const c = nav.cell, R = Math.min(ref, 16);
        const cells: [number, number, number][] = [];
        for (let gy = Math.floor((cy - R) / c); gy <= Math.floor((cy + R) / c); gy++) for (let gx = Math.floor((cx - R) / c); gx <= Math.floor((cx + R) / c); gx++) {
          const px = (gx + 0.5) * c, py = (gy + 0.5) * c, dd = Math.hypot(px - cx, py - cy);
          if (dd < ref && nav.walkable(px, py) && nav.componentAt(px, py) === main) cells.push([dd, px, py]);
        }
        cells.sort((p, q) => p[0] - q[0]);
        let tried = 0;
        for (const [dd, px, py] of cells) {
          if (tried++ > 40) continue;
          if (!nav.findPath(x0, y0, px, py, route, me.radius)) continue;
          let l = 0, qx = x0, qy = y0, aw = 0;
          for (let i = 0; i < route.length; i += 2) {
            for (const f of [0.5, 1]) { const ix = qx + (route[i] - qx) * f, iy = qy + (route[i + 1] - qy) * f; aw = Math.max(aw, Math.hypot(ix - cx, iy - cy) - d0); }
            l += Math.hypot(route[i] - qx, route[i + 1] - qy); qx = route[i]; qy = route[i + 1];
          }
          if (Math.hypot(qx - px, qy - py) < 1e-3 && l <= Math.hypot(px - x0, py - y0) * 1.3 + 0.5 && aw <= 0.5) { ref = dd; break; }
        }
        const exc = Math.hypot(me.x - cx, me.y - cy) - ref;
        let away = 0; for (const p of tr) away = Math.max(away, Math.hypot(p.x - cx, p.y - cy) - d0);
        const tags: string[] = [];
        if (exc > 1) { far++; tags.push(`far +${f2(exc)}`); }
        if (wk.len > 1.6 * wk.net + 1) { long++; tags.push('long'); }
        if (away > 1) { away1++; tags.push('away'); }
        if (tags.length && bad.length < 6) bad.push(`${tags.join('+')} (${f2(x0)},${f2(y0)})→(${f2(cx)},${f2(cy)}) end (${f2(me.x)},${f2(me.y)}) walked ${f2(wk.len)} net ${f2(wk.net)}`);
      }
      check(`${modeId.toUpperCase()} ${n} deep wall clicks (≥ 2 m inside): 0 end > 1 m past the best reachable point (${far}), 0 paths > 1.6 × net + 1 m (${long}), 0 walk > 1 m away from the click (${away1})`,
        n >= 100 && far === 0 && long === 0 && away1 === 0, bad);
    }
  }

  // 4. hold-steer to a fixed cursor re-sent every 4 ticks (verifier r4: BRIDGE ulkro re-planned to a corner node behind
  //    it, stepped back 0.18 m with 6 heading flips; 2 / 512 held snaps ended 0.3–0.4 m further than one click)
  if (has('ulkro')) {
    const end = (resend: boolean) => {
      const { sim, me } = fresh('bridge', 'ulkro', 1);
      place(sim.world, me, 136.31, 26.99); sim.step();
      const d0 = Math.hypot(me.x - 133.53, me.y - 26.34);
      let back = 0, minD = d0;
      const tr = [{ x: me.x, y: me.y }];
      for (let q = 0; q < 120; q++) {
        if (q === 0 || (resend && q % 4 === 0)) sim.command(0, { type: 'move', x: 133.53, y: 26.34 });
        me.hp = me.maxHp; sim.step(); tr.push({ x: me.x, y: me.y });
        const dd = Math.hypot(me.x - 133.53, me.y - 26.34);
        back = Math.max(back, dd - minD); minD = Math.min(minD, dd);
      }
      return { x: me.x, y: me.y, back, flips: walk(tr).flips };
    };
    const one = end(false), held = end(true);
    check('BRIDGE ulkro hold-steer to a fixed point re-sent every 4 ticks: ends where one click does, no step back over 0.1 m, no heading flips',
      Math.hypot(one.x - held.x, one.y - held.y) < 1e-6 && held.back <= 0.1 && held.flips === 0, { one, held });
  }

  // 5. hold-steer along a long wall face with the cursor pressing into it and sliding back past the hero (verifier r4:
  //    ulkro "behind" stepped 0.50 m back off the face and left it by 1.02 m)
  {
    const { sim, me } = fresh('rift', has('ulkro') ? 'ulkro' : fs[0], 1);
    const w = sim.world, nav = w.nav;
    const [W, H] = w.mapDef.size;
    const main = nav.componentAt(me.x, me.y);
    let s = 99;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    let n = 0, worstLeave = 0, tries = 0;
    const bad: string[] = [];
    while (n < 40 && tries++ < 400000) {
      const hx = 3 + rnd() * (W - 6), hy = 3 + rnd() * (H - 6);
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
      const k = Math.floor(rnd() * 4), nx = [1, -1, 0, 0][k], ny = [0, 0, 1, -1][k];   // the face's normal (into the wall)
      let hit = -1; for (let d = 0.05; d < 1.2; d += 0.05) if (!nav.walkable(hx + nx * d, hy + ny * d)) { hit = d; break; }
      if (hit < 0) continue;
      // a straight face 6 m each way: open 0.3 m off it, blocked 0.6 m into it
      const tx = -ny, ty = nx;
      let ok = true;
      for (let u = -6; u <= 6 && ok; u += 0.25) {
        if (!nav.walkable(hx + tx * u + nx * (hit - 0.3), hy + ty * u + ny * (hit - 0.3)) || nav.walkable(hx + tx * u + nx * (hit + 0.6), hy + ty * u + ny * (hit + 0.6))) ok = false;
      }
      if (!ok || w.entities.some((e) => e !== me && e.alive && !e.static && e.kind !== 'projectile' && e.kind !== 'zone' && Math.hypot(e.x - hx, e.y - hy) < 12)) continue;
      const px = hx + nx * (hit - 0.3), py = hy + ny * (hit - 0.3);
      place(w, me, px, py); sim.step();
      const off0 = (me.x - px) * nx + (me.y - py) * ny;
      let leave = 0;
      for (let q = 0; q < 75; q++) {
        // the cursor 0.6 m inside the face, starting 1 m ahead along it and sliding back past the hero at ~3.4 m/s
        const along = 1 - q * 0.11;
        if (q % 4 === 0) sim.command(0, { type: 'move', x: px + tx * along + nx * 0.9, y: py + ty * along + ny * 0.9 });
        me.hp = me.maxHp; sim.step();
        leave = Math.max(leave, off0 - ((me.x - px) * nx + (me.y - py) * ny));
      }
      n++;
      worstLeave = Math.max(worstLeave, leave);
      if (leave > 0.3 && bad.length < 5) bad.push(`(${f2(px)},${f2(py)}) normal (${nx},${ny}) left the face by ${f2(leave)} m`);
    }
    check(`RIFT ${n} hold-steers along a wall face, the cursor pressing into it and sliding back past the hero: never off the face by > 0.3 m (worst ${f2(worstLeave)})`,
      n >= 30 && worstLeave <= 0.3, bad);
  }
}
try { await live38(); } catch (err) { check(`ruling 38 section threw: ${(err as Error).stack ?? err}`, false); }

finish('probe_sim_core_orders');
