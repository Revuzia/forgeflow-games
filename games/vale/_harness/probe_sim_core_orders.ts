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
  // a solid line of standing minions from the slab to the east map edge: no route exists for a walker
  const w = makeWorld(cat, [{ fighter: 'fx_slinger', team: 0, x: 45, y: 20 }, { fighter: 'fx_foe', team: 1, x: 10, y: 55 }]);
  const h = fighterEnt(w, 0);
  for (let x = 32.6; x < 60; x += 0.85) addUnit(w, 'fx_dummy', 0, x, 24);
  issueMove(w, h, 45, 30, false);
  let replanAt = -1, blockedAt = -1;
  const tr = trace(w, h, 240, (k) => {
    if (blockedAt < 0 && h.y > 24 - 0.45 - h.radius - 0.15) blockedAt = k;   // reached the line of bodies
    if (replanAt < 0 && h.watchStage >= 1) replanAt = k;
  });
  const end = tr.findIndex((p) => p.order === ORDER_NONE);
  check('a no-progress window re-plans within ~1.3 s of meeting the line', blockedAt >= 0 && replanAt >= blockedAt && replanAt - blockedAt <= 40, { blockedAt, replanAt });
  check('…and the move ends within ~2.5 s of it', end >= 0 && end - blockedAt <= 75, { blockedAt, end });
  check('0 drift after it ends', end >= 0 && walk(tr.slice(end)).len < 0.05, end >= 0 ? walk(tr.slice(end)) : null);
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
finish('probe_sim_core_orders');
