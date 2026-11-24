// DEWPOINT v2 expansion pass, levels 5-8 (the Drying Loft). Everything level-specific lives here:
//   * the shape of each level (four or five named areas, a checkpoint at the start of each, reached in order,
//     props in every area, a scripted route of 60-120 s), and
//   * the "cannot be skipped" proofs for every gate: each one must really need the form or mechanism it was
//     built around, a cloud must not be able to fly over or round it, and nothing may be made unwinnable.
// The positive routes (solve / solveAll) live in tests/solutions/ and are run by levels.test.js.
// Coordinates below are local to each area: `const [A1, A2, ...] = origins(level)` are the world x of each
// area's start, and `A2 + 14` means "14 m into the second area".
//
// A note on clouds: a full steam gauge climbs 5.5 m from a standstill, but a drop that JUMPS first and boils
// at the top of the jump climbs about 7.3 m (measured below). Every gate here is built against the larger
// number, and steamTrials tries both.

import { test, assert, eq } from './lib/harness.js';
import { play } from './lib/play.js';
import { FORMS } from '../src/sim/constants.js';
import l05 from '../src/levels/l05.js';
import l06 from '../src/levels/l06.js';
import l07 from '../src/levels/l07.js';
import l08 from '../src/levels/l08.js';
import * as s05 from './solutions/l05.js';
import * as s06 from './solutions/l06.js';
import * as s07 from './solutions/l07.js';
import * as s08 from './solutions/l08.js';

const LEVELS = [[l05, s05], [l06, s06], [l07, s07], [l08, s08]];
// levels get longer as they go: each level's reference route must sit in its own band (v1 l04 runs 74 s, l09 about 105 s)
const BANDS = { l05: [76, 84], l06: [82, 90], l07: [88, 96], l08: [94, 104] };
const solveTimes = {};

const origins = (level) => level.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const areaIndex = (level, x, z) => level.areas.findIndex((a) => x >= a.box[0] && x < a.box[2] && z >= a.box[1] && z < a.box[3]);
const near = (a, b, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

// ------------------------------------------------------------------------------------------ helpers

/** Place Mote at (x, y, z) in `form` (set before settling, so zones act on that form), let it settle. Deaths allowed. */
function at(level, x, y, z, form) {
  const r = play(level);
  r.allowDeath = true;
  r.sim.teleport(x, y + 0.08, z);
  if (form) { r.sim.forceForm(form); assert(r.p.form === form, `could not become ${form} at (${x}, ${y}, ${z})`); }
  r.wait(0.3);
  return r;
}

/** Light the checkpoint that starts an area (it is what wakes that area's movers), as walking past it would. */
function wake(r, signal) {
  const cp = r.sim.level.checkpoints.find((c) => c.emit === signal);
  assert(cp, `no checkpoint emits ${signal}`);
  cp.lit = true;
}

/** Park every mover where it is (so a test can stand a cloud or a drop beside a stationary lift). */
function park(r, atEnd = {}) {
  for (const m of r.sim.level.movers) {
    m.on = r.sim.signals.compile(false);
    if (atEnd[m.id] !== undefined) m.t = atEnd[m.id];
  }
}

/** Hold a stick direction for `seconds`, tracking the extremes Mote reaches. */
function hold(r, mx, mz, seconds, { jump = false } = {}) {
  const ext = { minX: Infinity, maxX: -Infinity, maxY: -Infinity, minY: Infinity, minZ: Infinity, maxZ: -Infinity };
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n; i++) {
    r.tick(mx, mz, jump && i % 70 < 30);
    const p = r.p;
    ext.minX = Math.min(ext.minX, p.x); ext.maxX = Math.max(ext.maxX, p.x);
    ext.minY = Math.min(ext.minY, p.y); ext.maxY = Math.max(ext.maxY, p.y);
    ext.minZ = Math.min(ext.minZ, p.z); ext.maxZ = Math.max(ext.maxZ, p.z);
  }
  return ext;
}

/**
 * Steam tries to get past something: many flight plans (rise first for 0 or 2.4 s, then drift one of five ways,
 * plus a climb-and-go), each on a fresh full gauge, each both from the spot and after a jump (boil at the top of
 * it, which climbs further), then up to 9 s to land. What matters is where Mote can END UP STANDING without
 * having died on the way: `stands` lists those spots; `maxY` is the highest point reached; `runs` the runners.
 */
const PLANS = [];
for (const [dx, dz] of [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1]]) for (const rise of [0, 2.4]) PLANS.push((t) => (t < rise ? [0, 0] : [dx, dz]));
PLANS.push((t) => (t < 1.5 ? [0.2, 1] : [1, 0]), (t) => (t < 1.5 ? [0.2, -1] : [1, 0]));
function steamTrials(level, x, y, z, setup) {
  const out = { stands: [], maxY: -Infinity, runs: [], skipped: 0 };
  for (const jumpFirst of [false, true]) {
    for (const plan of PLANS) {
      const r = at(level, x, y, z);
      if (setup) setup(r);
      r.wait(0.1);
      if (jumpFirst) {
        for (let i = 0; i < 80 && !(i > 3 && !r.p.grounded && r.p.vy < 0.4); i++) r.tick(0, 0, true);
      }
      if (!r.sim.forceForm('steam')) { out.skipped++; continue; }      // the start spot does not fit a cloud (a prop is in the way)
      r.sim.player.gauge = 4;
      const deaths0 = r.sim.deaths, n = Math.round(9 * 120);
      for (let i = 0; i < n; i++) {
        const [mx, mz] = plan(i / 120);
        r.tick(mx, mz);
        out.maxY = Math.max(out.maxY, r.p.y);
        if (r.sim.deaths !== deaths0) break;
        if (r.p.grounded && r.p.form !== 'steam') { out.stands.push([r.p.x, r.p.y, r.p.z]); break; }
      }
      out.runs.push(r);
    }
  }
  assert(out.runs.length >= PLANS.length, `steamTrials at (${x}, ${y}, ${z}): too few flights could start (${out.runs.length})`);
  return out;
}
const standsBeyond = (t, pred) => t.stands.filter(([x, y, z]) => pred(x, y, z));

/** Run a route with the area and checkpoint history recorded. */
function traced(level, route) {
  const r = play(level);
  const log = { cps: [], areas: [] };
  let lastCp = null, lastArea = -2;
  const tick = r.tick.bind(r);
  r.tick = (...a) => {
    tick(...a);
    const s = r.sim;
    if (s.checkpoint !== lastCp) { lastCp = s.checkpoint; log.cps.push({ t: s.time, x: lastCp.pos[0], y: lastCp.pos[1], z: lastCp.pos[2] }); }
    const ai = areaIndex(level, r.p.x, r.p.z);
    if (ai !== lastArea) { lastArea = ai; log.areas.push({ t: s.time, ai }); }
  };
  route(r);
  return { r, log };
}

/** Every mover that is triggered by a dock sensor stays parked until Mote comes near it, and leaves a moment after. */
function dockTests(level, docks) {
  const idle = play(level);
  idle.wait(25);
  for (const [id] of docks) assert(idle.sim.level.movers.find((m) => m.id === id).t === 0, `${level.id}: ${id} moved before anyone came near it`);
  for (const [id, x, y, z] of docks) {
    const r = at(level, x, y, z);
    r.wait(3.5);
    const m = r.sim.level.movers.find((q) => q.id === id);
    assert(m.t > 0 || m.dirSign < 0 || m.moving, `${level.id}: ${id} did not set off when Mote came to its dock`);
  }
}

const mover = (s, id) => s.level.movers.find((m) => m.id === id);
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const douse = (r, id) => { const e = ember(r.sim, id); e.doused = true; e.solid.active = false; };

test('steam: a full gauge climbs 5.5 m from a standstill, and about 7.3 m for a drop that jumps first and boils at the top', () => {
  const flat = { id: 'flat', name: 'Flat', spawn: [0, 0, 0], pieces: [{ type: 'block', box: [-10, -1, -10, 10, 0, 10] }, { type: 'exit', pos: [8, 0, 8] }] };
  const a = play(flat); a.sim.forceForm('steam'); a.wait(0.2);
  assert(hold(a, 0, 0, 6).maxY < 5.7, 'steam from a standstill should climb about 5.5 m');
  const b = play(flat); b.wait(0.3);
  for (let i = 0; i < 80 && !(i > 3 && !b.p.grounded && b.p.vy < 0.4); i++) b.tick(0, 0, true);
  b.sim.forceForm('steam');
  const e = hold(b, 0, 0, 6);
  assert(e.maxY > 6.5 && e.maxY < 7.6, `jump-then-boil climbed ${e.maxY.toFixed(2)} m, expected about 7.3: the gates below assume it`);
});

// ------------------------------------------------------------------------------------------ steam gauge slack
// A medium-tier level must not hang on a near-perfect cloud. Wherever the reference route turns a cloud back
// into something else (the end of every climb or crossing), the gauge must still hold MIN_SLACK seconds: a clean
// attempt has that much to spare, and a slower one still lands. (The gauge is 4 s; it refills only on the ground.)
const MIN_SLACK = 1.5;
const STEAM_TRIPS = { l05: [1, 3], l06: [9, 10], l07: [1, 1], l08: [2, 4] };   // [solve, solveAll] climbs the route must make

/** Every steam session of a route: where it started, where it ended, and the gauge left at the end. */
function steamSlack(level, route) {
  const r = play(level);
  const trips = [];
  const tick = r.tick.bind(r);
  r.tick = (...a) => {
    const f = r.p.form, g = r.p.gauge, x = r.p.x, y = r.p.y;
    tick(...a);
    if (f !== 'steam' && r.p.form === 'steam') trips.push({ from: [x, y], gauge: null });
    if (f === 'steam' && r.p.form !== 'steam' && trips.length) Object.assign(trips[trips.length - 1], { to: [r.p.x, r.p.y], gauge: g });
  };
  route(r);
  return trips;
}

for (const [level, sol] of LEVELS) {
  test(`${level.id}: every steam climb and crossing on the reference route ends with at least ${MIN_SLACK} s of gauge to spare`, () => {
    [sol.solve, sol.solveAll].forEach((route, k) => {
      const trips = steamSlack(level, route);
      assert(trips.length >= STEAM_TRIPS[level.id][k], `${level.id}: only ${trips.length} steam trips measured, expected at least ${STEAM_TRIPS[level.id][k]}`);
      for (const t of trips) {
        assert(t.gauge !== null, `${level.id}: a steam trip from (${t.from.map((v) => v.toFixed(1))}) never ended`);
        assert(t.gauge >= MIN_SLACK, `${level.id}: the climb from (${t.from.map((v) => v.toFixed(1))}) to (${t.to.map((v) => v.toFixed(1))}) ends with only ${t.gauge.toFixed(2)} s of gauge (need ${MIN_SLACK})`);
      }
    });
  });
}

// ------------------------------------------------------------------------------------------ shape of every level
for (const [level, sol] of LEVELS) {
  const id = level.id;

  test(`${id}: four or five named areas, in order, side by side, each dressed with props`, () => {
    const A = level.areas;
    assert(Array.isArray(A) && A.length >= 4 && A.length <= 5, `${id}: needs 4-5 areas, has ${A && A.length}`);
    eq(new Set(A.map((a) => a.name)).size, A.length, 'area names must be distinct');
    for (const a of A) {
      assert(typeof a.name === 'string' && a.name.length > 0 && a.name.length <= 24, `bad area name ${JSON.stringify(a.name)}`);
      assert(a.box.length === 4 && a.box[0] < a.box[2] && a.box[1] < a.box[3], `${a.name}: bad box ${a.box}`);
    }
    for (let i = 1; i < A.length; i++) assert(A[i].box[0] >= A[i - 1].box[2] - 1e-9, `${A[i].name} overlaps ${A[i - 1].name}`);
    const props = level.pieces.filter((p) => p.type === 'prop');
    for (const a of A) {
      const n = props.filter((p) => p.pos[0] >= a.box[0] && p.pos[0] < a.box[2]).length;
      assert(n >= 4, `${a.name} has only ${n} props: every area is a place of its own`);
    }
    assert(areaIndex(level, level.spawn[0], level.spawn[2]) === 0, 'the spawn is not in the first area');
    const ex = level.pieces.find((p) => p.type === 'exit');
    eq(areaIndex(level, ex.pos[0], ex.pos[2]), A.length - 1, 'the exit is not in the last area');
  });

  test(`${id}: the reference route takes 60-120 s, deaths-free, deterministic; solveAll gets all three shards`, () => {
    const a = play(level); sol.solve(a);
    const t = a.result().timeMs / 1000;
    solveTimes[id] = t;
    assert(t >= 60 && t <= 120, `${id} solve() takes ${t.toFixed(1)} s, outside the 60-120 s band`);
    const [lo, hi] = BANDS[id];
    assert(t >= lo && t <= hi, `${id} solve() takes ${t.toFixed(1)} s, outside its own band ${lo}-${hi} s`);
    eq(a.sim.deaths, 0);
    const b = play(level); sol.solve(b);
    eq(a.sim.fingerprint(), b.sim.fingerprint());
    const c = play(level); sol.solveAll(c);
    eq(c.result().shards, [0, 1, 2]);
    eq(c.sim.deaths, 0);
    assert(c.result().timeMs / 1000 <= 150, `${id} solveAll() takes ${(c.result().timeMs / 1000).toFixed(1)} s`);
  });

  test(`${id}: every area has a checkpoint at its start, and the route reaches the areas and their checkpoints in order`, () => {
    const { log } = traced(level, (r) => sol.solve(r));
    const n = level.areas.length;
    const seq = log.areas.filter((e) => e.ai >= 0).map((e) => e.ai);
    eq(seq, Array.from({ length: n }, (_, i) => i), `${id}: the route visits the areas in this order`);
    const o = origins(level);
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const cp = log.cps.find((c) => areaIndex(level, c.x, c.z) === i);
      assert(cp, `${level.areas[i].name}: no checkpoint lit inside the area on the route`);
      assert(cp.x - o[i] <= 10, `${level.areas[i].name}: its first checkpoint is ${(cp.x - o[i]).toFixed(1)} m from the start of the area`);
      assert(cp.t > prev, `${level.areas[i].name}: checkpoint reached out of order`);
      prev = cp.t;
    }
    assert(log.cps[0].t < 8, 'the first checkpoint should be lit within a few seconds of the spawn');
  });

  test(`${id}: falling from any checkpoint puts Mote back on that checkpoint, on its feet, as a drop`, () => {
    for (const cp of play(level).sim.level.checkpoints) {
      const r = play(level);
      r.allowDeath = true;
      const c = r.sim.level.checkpoints.find((q) => q.pos.join() === cp.pos.join());
      r.sim.checkpoint = c;
      r.sim.teleport(c.pos[0], r.sim.level.killY - 2, c.pos[2]);
      r.wait(1.2);
      eq(r.sim.deaths, 1, `${id}: checkpoint at ${c.pos}`);
      assert(r.p.grounded && r.p.form === 'liquid' && Math.abs(r.p.y - c.pos[1]) < 0.2, `${id}: respawn at ${c.pos} ended at ${r.state()}`);
    }
  });
}

test('l05-l08: the routes get longer as the levels go, and l08 (the chapter exam) is the longest by a clear margin', () => {
  const t = LEVELS.map(([level, sol]) => { const r = play(level); sol.solve(r); return r.result().timeMs / 1000; });
  for (let i = 1; i < t.length; i++) assert(t[i] > t[i - 1] + 3, `${LEVELS[i][0].id} (${t[i].toFixed(1)} s) is not clearly longer than ${LEVELS[i - 1][0].id} (${t[i - 1].toFixed(1)} s)`);
  assert(t[3] - t[2] >= 5, 'the exam should be clearly the biggest of the four');
  assert(t[0] > 74.5, `l05 (${t[0].toFixed(1)} s) should outrun l04 (74.0 s)`);
});

// ------------------------------------------------------------------------------------------ l05
{
  const [A1, A2, A3, A4, A5] = origins(l05);

  test('l05: no gap (trough, pit, shuttle gap, barge pit, bridge pit, gantry gaps) can be jumped, and no cloud floats across one', () => {
    // [near edge x, far edge x, floor y on the near side, name]
    const gaps = [[A1 + 10, A1 + 18, 0, 'trough'], [A1 + 28, A1 + 36, 0, 'pit'], [A2 + 22, A2 + 29, 6, 'shuttle gap'],
      [A3 + 14, A3 + 22, 0, 'barge pit'], [A3 + 36, A3 + 44, 0, 'bridge pit'], [A5 + 4, A5 + 12, 8.4, 'first gantry gap'], [A5 + 18, A5 + 27, 8.4, 'second gantry gap']];
    for (const [x0, x1, y, name] of gaps) {
      const r = at(l05, x0 - 3, y, 0);
      park(r);
      let maxX = 0;
      for (let i = 0; i < 360; i++) { r.tick(1, 0, i > 25 && i < 75); maxX = Math.max(maxX, r.p.x); }
      r.wait(1);
      assert(maxX <= x1 - FORMS.liquid.r + 0.01 && (r.sim.deaths > 0 || r.p.y < y - 1), `a drop crossed the ${name}: maxX=${maxX}, deaths=${r.sim.deaths}`);
      const t = steamTrials(l05, x0 - 0.6, y, 0, park);
      eq(standsBeyond(t, (x, yy) => x > x1 + 0.2 && yy > y - 0.5), [], `a cloud floated across the ${name}`);
    }
  });

  test('l05: the trough is no way under the floor either - a drop that falls in can only walk back out on the near side', () => {
    const r = at(l05, A1 + 14, -2.2, 0);
    const e = hold(r, 1, 0, 6, { jump: true });
    r.wait(1);
    assert(e.maxX < A1 + 18 - FORMS.liquid.r + 0.01 && r.p.y < -2, `a drop got out of the trough on the far side: x=${e.maxX}, y=${r.p.y}`);
    const q = at(l05, A1 + 17, -2.2, 3.2);
    const f = hold(q, -1, 0, 4);
    assert(f.minX < A1 + 12 && q.p.y > -0.5, `the recovery ramp should lead back to the hall: ${q.state()}`);
  });

  test('l05: every platform waits docked until Mote comes near it, and leaves a moment after (nobody waits for a cycle)', () => {
    dockTests(l05, [['tram', A1 + 9, 0, 0], ['ferry', A1 + 27, 0, 0], ['hoist', A2 + 9, 0, 0], ['rackLift', A2 + 33.5, 6, -2.6],
      ['barge', A3 + 13, 0, 0], ['elevator', A4 + 11, 0, 0], ['gantry1', A5 + 2, 8.4, 0], ['gantry2', A5 + 16, 8.4, 0]]);
  });

  test('l05: the second crate crosses the bridge to the second plate, which opens the door to the chimney - and nothing else does', () => {
    const door = (q) => q.sim.level.doors[0];
    const r = at(l05, A3 + 46, 0, 0);
    r.wait(0.5); assert(door(r).open < 0.01, 'the door opened with nothing on the second plate');
    const e = hold(r, 1, 0, 3, { jump: true });
    assert(e.maxX < A3 + 52.03 - FORMS.liquid.r + 1e-6, 'a drop walked through the shut door');
    // a drop on the second plate does not press it; ice does, a crate does, and then the door opens
    const q = at(l05, A3 + 47.6, 0, 0);
    q.wait(0.5); q.expectSignal('hp2', false);
    const c = at(l05, A3 + 46, 0, 0);
    const cb = c.sim.level.crates[1].body;
    cb.x = A3 + 47.6; cb.z = 0; cb.y = 0.06; c.wait(1.5);
    c.expectSignal('hp2', true);
    assert(door(c).open >= 1, 'the door stays shut with the crate on the second plate');
    // a cloud cannot go over or round the door wall (10 m tall, 24 m wide)
    const t = steamTrials(l05, A3 + 49, 0, 0);
    eq(standsBeyond(t, (x) => x > A3 + 52.8), [], 'a cloud got past the second door');
    // the second crate cannot reach the plate while the bridge is retracted: it falls into the pit, and R puts both crates back
    const f = at(l05, A3 + 30, 0, 0, 'ice');
    const cr = f.sim.level.crates[1];
    f.wait(0.2);
    hold(f, 1, 0, 4);
    assert(cr.body.y < -3 || cr.body.x < A3 + 36.2, `the crate should have stopped or fallen: x=${cr.body.x} y=${cr.body.y}`);
    f.restart(); f.wait(0.3);
    near(cr.body.x, cr.home[0]); near(cr.body.y, cr.home[1]);
  });

  test('l05: the shuttle sleeps until the plate is trodden, and then it runs for good', () => {
    const r = play(l05);
    const sh = (s) => mover(s, 'shuttle');
    r.sim.teleport(A2 + 14, 6, 0); r.wait(4);
    eq(sh(r.sim).t, 0, 'the shuttle moved before the plate was pressed');
    r.sim.teleport(A2 + 19.4, 6.1, -1.6); r.wait(0.4);
    r.expectSignal('wake', true);
    r.sim.teleport(A2 + 14, 6, 0); r.wait(6);
    assert(sh(r.sim).t > 0 || sh(r.sim).dirSign < 0, 'the shuttle did not start once the plate was pressed');
    r.expectSignal('shuttleOn', true);                  // latched: stepping off the plate does not stop it
  });

  test('l05: a drop on the heavy plate does not extend the bridge; ice does, but only while it stays', () => {
    const r = at(l05, A3 + 27.5, 0, 0);
    r.wait(1);
    r.expectSignal('hp', false);
    eq(mover(r.sim, 'bridge').t, 0);
    const q = at(l05, A3 + 27.5, 0, 0, 'ice');
    q.wait(0.5); q.expectSignal('hp', true);
    q.waitUntil((s) => mover(s, 'bridge').t > 0.5, { timeout: 4, label: 'bridge is coming out' });
    q.walkTo(A3 + 24, 0, { stuck: 0 }); q.wait(0.3); q.form('liquid');
    q.waitUntil((s) => mover(s, 'bridge').t < 0.01, { timeout: 6, label: 'bridge folds back' });
  });

  test('l05: a crate pushed off the edge while the barge is away falls into the pit; R puts it back and the level is still winnable', () => {
    const r = at(l05, A3 + 11, 0, 0, 'ice');
    park(r, { barge: 1 });
    const c = r.sim.level.crates[0];
    c.body.x = A3 + 12.8; c.body.z = 0; c.body.y = 0;
    r.wait(0.2);
    hold(r, 1, 0, 3);
    assert(c.body.y < -3, `the crate should have fallen into the pit: y=${c.body.y}`);
    r.restart(); r.wait(0.3);
    near(c.body.x, c.home[0]); near(c.body.z, c.home[2]); near(c.body.y, c.home[1]);
    const t = play(l05); s05.solve(t);
    assert(t.sim.completed, 'the reference route no longer wins');
  });

  test('l05: the gallery is 8.4 m up - no cloud reaches it from the hall floor; from the lift top it gets out only through the grate', () => {
    const f = steamTrials(l05, A4 + 10, 0, 0);
    eq(standsBeyond(f, (x, y) => y > 7), [], 'a cloud from the hall floor reached the gallery');
    eq(standsBeyond(f, (x) => x > A4 + 15.2), [], 'a cloud from the hall floor got past the chimney breast');
    const g = steamTrials(l05, A4 + 13.5, 6.8, 0, (q) => park(q, { elevator: 1 }));
    assert(g.stands.every(([x, y]) => (y > 8 && x > A4 + 15.2) || (x > A4 + 12 && x < A4 + 15 && y > 4.5)), `from the lift top a cloud ended up somewhere unexpected: ${JSON.stringify(g.stands.slice(0, 3))}`);
    // a drop on the lift cannot jump out through the roof, and the header keeps the shaft shut on the west
    const r = at(l05, A4 + 13.5, 6.8, 0);
    park(r, { elevator: 1 }); r.sim.teleport(A4 + 13.5, 6.9, 0); r.wait(0.3);
    const e = hold(r, 0, 0, 3, { jump: true });
    assert(e.maxY < 7.4, `a drop jumped ${e.maxY.toFixed(2)} m up the shaft`);
    const w = hold(r, -1, 0, 2, { jump: true });
    assert(w.minX > A4 + 12.3, 'a drop got out through the west side of the shaft');
  });

  test('l05: the cage window is bars: a drop cannot get in', () => {
    const r = at(l05, A4 + 5, 0, 2.5);
    const e = hold(r, 0, 1, 2, { jump: true });
    assert(r.p.z < 4.05 - FORMS.liquid.r + 0.01 && e.maxY < 3, 'a drop got through the bars');
  });

  test('l05: the hoist, the rack lift and the elevator really carry a rider to where the platform goes', () => {
    for (const [id, x, z, y0, y1] of [['hoist', A2 + 10.5, 0, 0, 6], ['rackLift', A2 + 33.5, -2.6, 6, 9.4], ['elevator', A4 + 13.5, 0, 0, 6.8]]) {
      const r = at(l05, x, y0, z);
      r.waitUntil((s) => mover(s, id).t >= 0.999, { timeout: 25, label: `${id} reaches the top` });
      assert(Math.abs(r.p.y - y1) < 0.1 && r.p.grounded, `${id}: the rider is at y=${r.p.y.toFixed(2)}, expected ${y1}`);
    }
  });
}

// ------------------------------------------------------------------------------------------ l06
{
  const [A1, A2, A3, A4, A5] = origins(l06);

  test('l06: a cloud cannot get past any doorway of embers, nor over or round the walls beside them', () => {
    // (area origin, local x of the wall, floor y, side to start a cloud from, embers)
    const doors = [[A1, 22, 0, 'doorEmbers'], [A2, 15, 6.6, 'houseEmbers'], [A2, 29, 9.6, 'atticEmbers'], [A5, 66, 14.8, 'kilnEmbers']];
    for (const [A, wx, y, id] of doors) {
      for (const z of [0, 3.5, -3.5]) {
        const t = steamTrials(l06, A + wx - 3, y, z);
        eq(standsBeyond(t, (x) => x > A + wx + 0.7), [], `${id}: a cloud from z=${z} got past the doorway`);
      }
    }
  });

  test('l06: a drop is stopped by the embers until it touches them - and then they are out for good', () => {
    for (const [A, wx, y, id] of [[A1, 22, 0, 'doorEmbers'], [A2, 15, 6.6, 'houseEmbers'], [A2, 29, 9.6, 'atticEmbers'], [A5, 66, 14.8, 'kilnEmbers']]) {
      const r = at(l06, A + wx - 2, y, 0);
      assert(!ember(r.sim, id).doused, `${id} should start unspent`);
      hold(r, 1, 0, 2.5);
      assert(ember(r.sim, id).doused && r.p.x > A + wx + 0.7, `${id}: a drop that touches the embers should put them out and walk on (x=${r.p.x})`);
    }
  });

  test('l06: the Rain Gallery gate stays shut until ALL FOUR pillars are out, and a cloud cannot skip it from any place it can stand', () => {
    for (const out of [[], ['pillarA'], ['pillarA', 'pillarB'], ['pillarA', 'pillarC'], ['pillarB', 'pillarC'], ['pillarA', 'pillarB', 'pillarC'], ['pillarB', 'pillarC', 'pillarD']]) {
      const r = at(l06, A3 + 30, 3, 0);
      for (const id of out) douse(r, id);
      r.wait(0.3);
      assert(r.sim.level.doors[0].open < 0.01, `the gate opened with only ${out.join('+') || 'nothing'} out`);
      const e = hold(r, 1, 0, 2, { jump: true });
      assert(e.maxX < A3 + 32.05 - FORMS.liquid.r + 1e-6, `a drop passed the shut gate (${out.join('+') || 'nothing'} out): ${e.maxX}`);
    }
    // from the floor, from the step, from the top of bud D, and from the top of each (doused) pillar
    const spots = [[A3 + 30, 3, 0, []], [A3 + 15.0, 4.2, 2.2, []], [A3 + 21.4, 6.2, -2, ['grow']], [A3 + 11, 5.2, -2, ['pillarA']],
      [A3 + 17, 6.2, 2, ['pillarB']], [A3 + 26, 8, -2, ['pillarC']], [A3 + 29.6, 10.2, 2, ['pillarD']]];
    for (const [x, y, z, prep] of spots) {
      const t = steamTrials(l06, x, y, z, (q) => {
        for (const id of prep) {
          if (id === 'grow') { const sp = q.sim.level.sprouts.find((p) => p.id === 'budD'); sp.state = 2; sp.growth = 1; for (const l of sp.leaves) l.solid.active = true; } else douse(q, id);
        }
      });
      eq(standsBeyond(t, (xx) => xx > A3 + 32.6), [], `steam from (${(x - A3).toFixed(1)}, ${y}, ${z}) stood beyond the shut gate`);
      assert(t.maxY < 14.7, `a cloud climbed through the roof of the gallery: ${t.maxY}`);
    }
  });

  test('l06: the greenhouse - a drop cannot get in through the bars, and a cloud from the hall or any bench cannot get out of it or onto the catwalk', () => {
    const r = at(l06, A4 + 9, 3, 0);
    const e = hold(r, 1, 0, 3, { jump: true });
    assert(e.maxX < A4 + 10.05 - FORMS.liquid.r + 1e-6, `a drop passed the window bars: ${e.maxX}`);
    for (const [x, y, z] of [[A4 + 8, 3, 0], [A4 + 12, 3, 0], [A4 + 22, 3, 0], [A4 + 32, 3, 0], [A4 + 33.4, 3, 2], [A4 + 5, 3, 3.6]]) {
      const t = steamTrials(l06, x, y, z);
      eq(standsBeyond(t, (xx, yy) => yy > 11 || xx > A5 + 0.2), [], `a cloud from (${(x - A4).toFixed(1)}, ${z}) reached the catwalk`);
    }
  });

  test('l06: the greenhouse floor is a bed of fire: a drop that falls between the benches is put back at the greenhouse checkpoint', () => {
    const r = at(l06, A4 + 8, 3, 0);
    r.sim.checkpoint = r.sim.level.checkpoints.find((c) => c.pos[0] > A4 && c.pos[0] < A4 + 5);
    r.sim.teleport(A4 + 16, 3.1, 0); r.sim.forceForm('liquid'); r.wait(2);
    assert(r.sim.deaths >= 1, 'falling between the benches should respawn');
    assert(r.p.x < A4 + 5, `respawned at x=${r.p.x}, expected the greenhouse checkpoint`);
  });

  test('l06: from the first bench a cloud cannot reach the last bench in one gauge, so the benches are needed to refill', () => {
    // from the window to the third bench is more than 13 m of drift: no single plan gets there
    const t = steamTrials(l06, A4 + 9, 3, 0);
    eq(standsBeyond(t, (x, y) => x > A4 + 30.5 && y > 2.9 && y < 3.1 && x < A4 + 36), [], 'one cloud from the hall made it all the way to the third bench');
  });

  test('l06: the garden - a drop cannot cross the pit, one cloud cannot cross all of it (the island refills the gauge), the ledge needs the island, the last doorway holds steam', () => {
    const r = at(l06, A5 + 34, 3, 0);
    let maxX = 0;
    for (let i = 0; i < 360; i++) { r.tick(1, 0, i > 20 && i < 80); maxX = Math.max(maxX, r.p.x); }
    assert(maxX < A5 + 42 && r.sim.deaths > 0, `a drop crossed to the island: maxX=${maxX}, deaths=${r.sim.deaths}`);
    const t = steamTrials(l06, A5 + 35.5, 3, 0);
    assert(t.stands.some(([x, y]) => x > A5 + 41.5 && x < A5 + 48.5 && Math.abs(y - 3) < 0.1), 'a cloud from the yard should be able to land on the island');
    eq(standsBeyond(t, (x, y) => x > A5 + 52 && y > 5), [], 'one cloud made it from the yard all the way to the ledge');
    eq(standsBeyond(t, (x, y) => y > 12.5), [], 'a cloud from the yard stood on the kiln platform');
    const i = steamTrials(l06, A5 + 47.2, 3, 0);
    assert(i.stands.some(([x, y]) => x > A5 + 53 && y > 5 && y < 6.2), 'a cloud from the island should be able to reach the ledge');
    const u = steamTrials(l06, A5 + 55.5, 5.6, 0, (q) => { const sp = q.sim.level.sprouts.find((p) => p.id === 'bud2'); sp.state = 0; });
    eq(standsBeyond(u, (x, y) => y > 14), [], 'a cloud from the ledge reached the kiln platform');
    const k = steamTrials(l06, A5 + 62, 14.8, 0);
    eq(standsBeyond(k, (x) => x > A5 + 66.7), [], 'steam stood beyond the last doorway');
  });

  test('l06: nothing here can be made unwinnable - buds and embers only ever change in the helpful direction', () => {
    const r = play(l06);
    s06.solve(r);
    assert(r.sim.completed);
    eq(r.sim.level.sprouts.filter((p) => p.state === 2).length, 6, 'every bud on the route grew');
    assert(r.sim.level.embers.filter((e) => e.doused).length >= 5, 'the embers on the route are out');
    // the doors and walls need nothing that a respawn would undo
    const q = at(l06, A3 + 30, 3, 0);
    for (const id of ['pillarA', 'pillarB', 'pillarC', 'pillarD']) douse(q, id);
    q.wait(1.5);
    assert(q.sim.level.doors[0].open >= 1, 'the gate opens once all three are out, wherever Mote is');
  });
}

// ------------------------------------------------------------------------------------------ l07
{
  const [A1, A2, A3, A4, A5] = origins(l07);
  const floorY = -8.2;

  test('l07: a tail wind carries a drop over the first pit; without the wind it cannot be crossed, and ice and film cannot cross it at all', () => {
    const r = at(l07, A1 + 8.4, 0, 0);
    r.waitUntil((s, p) => p.x >= A1 + 11.8, { mx: 1, timeout: 3 });
    r.jump(0.5, 1, 0);
    r.waitUntil((s, p) => p.grounded && p.x > A1 + 17.6, { mx: 1, timeout: 3, label: 'carried across' });
    eq(r.sim.deaths, 0);
    const q = at(l07, A1 + 8.4, 0, 0);
    const tail = q.sim.level.fans.find((f) => f.id === 'tail');
    tail.active = false; tail.box = [0, 0, 0, 0.1, 0.1, 0.1];
    let maxX = 0;
    for (let i = 0; i < 400; i++) { q.tick(1, 0, i > 40 && i < 90); maxX = Math.max(maxX, q.p.x); }
    assert(maxX < A1 + 17 && q.sim.deaths > 0, `a drop crossed the 6 m pit without the wind: maxX=${maxX}`);
    for (const form of ['ice', 'film']) {
      const f = at(l07, A1 + 8.4, 0, 0, form);
      let mx = 0;
      for (let i = 0; i < 700; i++) { f.tick(1, 0, i > 40 && i < 90 && form === 'ice'); mx = Math.max(mx, f.p.x); }
      assert(mx < A1 + 17 && f.sim.deaths > 0, `${form} crossed the pit: ${mx}`);
    }
  });

  test('l07: neither a drop nor a cloud gets into either gale; ice and film go straight through the open one', () => {
    for (const [x0, gx, label] of [[A1 + 22, A1 + 26, 'first gale'], [A4 + 18.5, A4 + 18, 'second gale']]) {
      const r = at(l07, x0, 0, 0);
      const e = hold(r, 1, 0, 6, { jump: true });
      assert(e.maxX < gx + 3.5, `a drop got into the ${label}: x=${e.maxX}`);
      const t = steamTrials(l07, x0, 0, 0);
      eq(standsBeyond(t, (x) => x > gx + 5), [], `a cloud ended up standing beyond the ${label}`);
    }
    const i = at(l07, A1 + 22, 0, 0, 'ice');
    assert(hold(i, 1, 0, 6).maxX > A1 + 38, 'ice should slide through the gale');
    const f = at(l07, A1 + 22, 0, 0, 'film');
    assert(hold(f, 1, 0, 8).maxX > A1 + 36, 'film should crawl through the gale');
  });

  test('l07: the tunnel in the first gale and the beam in the second are film only: ice cannot enter, a drop cannot get past the wind', () => {
    const i = at(l07, A1 + 40, 0, 0, 'ice');
    assert(hold(i, 1, 0, 4).maxX < A1 + 42 - FORMS.ice.r + 1e-6, 'ice got into the low tunnel');
    const d = at(l07, A1 + 40, 0, 0);
    assert(hold(d, 1, 0, 6, { jump: true }).maxX < A1 + 45, 'a drop got through the tunnel gale');
    const f = at(l07, A1 + 40, 0, 0, 'film');
    assert(hold(f, 1, 0, 8).maxX > A1 + 46, 'film should crawl into the tunnel');
    for (const form of ['liquid', 'ice']) {
      const r = at(l07, A4 + 10.5, 0, 0, form === 'liquid' ? null : form);
      assert(hold(r, 1, 0, 4, { jump: true }).maxX < A4 + 12 - FORMS[form].r + 1e-6, `${form} got into the beam at the second gale`);
    }
    const g = at(l07, A4 + 10.5, 0, 0, 'film');
    assert(hold(g, 1, 0, 8).maxX > A4 + 15, 'film should crawl under the beam');
  });

  test('l07: the crosswind sweeps a drop or a cloud off the walkway; ice and film hold their line', () => {
    for (const form of ['liquid', 'steam']) {
      const r = at(l07, A2 + 8.2, 0, 0, form === 'liquid' ? null : form);
      let gone = false;
      for (let i = 0; i < 900 && !gone; i++) { r.tick(1, 0); gone = r.sim.deaths > 0 || r.p.z > 4; }
      assert(gone && r.p.x < A2 + 20, `${form} stayed on the walkway: x=${r.p.x} z=${r.p.z}`);
    }
    for (const form of ['ice', 'film']) {
      const r = at(l07, A2 + 8.2, 0, 0, form);
      const e = hold(r, 1, 0, form === 'ice' ? 2 : 4);
      eq(r.sim.deaths, 0, `${form} fell off the walkway`);
      assert(Math.abs(r.p.z) < 1.3 && e.maxX > A2 + 14, `${form} did not hold the walkway: z=${r.p.z} x=${e.maxX}`);
    }
  });

  test('l07: the glass on the pad needs ice at speed; film and a drop cannot break it, and ice from a standstill beside it cannot either', () => {
    const pn = (r) => pane(r.sim, 'louvrePane');
    for (const form of ['liquid', 'film']) {
      const r = at(l07, A2 + 22, 0, 0, form === 'liquid' ? null : form);
      hold(r, 1, 0, 8, { jump: true });
      assert(!pn(r).broken, `${form} broke the glass on the pad`);
    }
    const slow = at(l07, A2 + 26.6, 0, 0, 'ice');
    hold(slow, 1, 0, 3);
    assert(!pn(slow).broken, 'ice broke the glass from a 1.4 m standing start');
    const fast = at(l07, A2 + 20.4, 0, 0, 'ice');
    hold(fast, 1, 0, 5);
    assert(pn(fast).broken, 'ice with the run of the pad should break the glass');
  });

  test('l07: the tunnel beyond the glass is film only - ice cannot enter it, film crawls through it', () => {
    const r = at(l07, A2 + 29.5, 0, 0, 'ice');
    r.sim.level.panes.forEach((p) => { p.broken = true; p.solid.active = false; });
    assert(hold(r, 1, 0, 4).maxX < A2 + 33 - FORMS.ice.r + 1e-6, 'ice got into the tunnel');
    const f = at(l07, A2 + 29.5, 0, 0, 'film');
    assert(hold(f, 1, 0, 14).maxX > A2 + 50, 'film should crawl through the tunnel');
  });

  test('l07: the glass floor ignores a drop and a hop; only a hard fall breaks it; the dead-end room is sealed from steam', () => {
    for (const form of [null, 'ice']) {
      const r = at(l07, A3 + 18, 0, 0, form);
      hold(r, 0, 0, 3, { jump: true });
      assert(!pane(r.sim, 'floorGlass').broken, `${form || 'a drop'} broke the glass floor by hopping on it`);
    }
    // cold air over the hall and room: a cloud cannot be made there at all, and one that drifts in condenses
    for (const [x, z] of [[A3 + 12, 0], [A3 + 26, 0], [A3 + 29.4, 3.5], [A3 + 29.4, -3.5]]) {
      const t = steamTrials(l07, x, 0, z);
      eq(standsBeyond(t, (xx) => xx > A3 + 30.4), [], `a cloud from (${(x - A3).toFixed(1)}, ${z}) got past the wall at the end of the dead-end room`);
      assert(t.maxY < 3, `a cloud was made in the cold: it climbed ${t.maxY.toFixed(1)} m`);
    }
  });

  test('l07: in the cellar the updraft wants BOTH plates held by crates; a drop on a plate does nothing; ice and film are not lifted; a cloud cannot climb out alone', () => {
    const t = steamTrials(l07, A3 + 30, floorY, 0);
    eq(standsBeyond(t, (x, y) => y > -1), [], 'a cloud left the cellar with the shaft off');
    const r = at(l07, A3 + 26.4, floorY, 0);
    r.wait(0.5); r.expectSignal('shaftPlate', false);
    const q = at(l07, A3 + 26.4, floorY, 0, 'ice');
    q.wait(0.5); q.expectSignal('shaftPlate', true);
    const putCrate = (run, i, z) => { const b = run.sim.level.crates[i].body; b.x = A3 + 26.4; b.z = z; b.y = floorY + 0.06; };
    // one crate: not enough, and a cloud still cannot climb out
    const one = at(l07, A3 + 30, floorY, 0);
    putCrate(one, 0, 0); one.wait(0.5);
    one.expectSignal('shaftPlate', true); one.expectSignal('shaftB', false);
    const t1 = steamTrials(l07, A3 + 30, floorY, 0, (z) => { putCrate(z, 0, 0); });
    eq(standsBeyond(t1, (x, y) => y > -1), [], 'a cloud left the cellar with only one plate held');
    // both crates: the shaft breathes and a cloud rises through it
    const c = at(l07, A3 + 30, floorY, 0);
    putCrate(c, 0, 0); putCrate(c, 1, 2.9); c.wait(0.5);
    c.expectSignal('shaftPlate', true); c.expectSignal('shaftB', true);
    c.waitUntil((s, p) => p.gauge >= 3.99, { timeout: 3 }).form('steam');
    c.waitUntil((s, p) => p.y > 0.6, { toward: [A3 + 32.6, 0], timeout: 8, label: 'up the shaft' });
    for (const form of ['ice', 'film']) {
      const f = at(l07, A3 + 32.6, floorY, 0, form);
      putCrate(f, 0, 0); putCrate(f, 1, 2.9); f.wait(0.5);
      assert(hold(f, 0, 0, 3).maxY < floorY + 1, `${form} was lifted by the updraft`);
    }
  });

  test('l07: the way to the bud is stuffed with embers: ice stops at them, a cloud cannot be made there, a drop puts them out and walks on', () => {
    const i = at(l07, A4 + 28, 0, 0, 'ice');
    assert(hold(i, 1, 0, 4).maxX < A4 + 30.9 - FORMS.ice.r + 1e-6 && !ember(i.sim, 'bayEmbers').doused, 'ice got past the embers before the bud');
    const d = at(l07, A4 + 28.5, 0, 0);
    hold(d, 1, 0, 2.5);
    assert(ember(d.sim, 'bayEmbers').doused && d.p.x > A4 + 31.7, 'a drop should put the embers out and walk on');
  });

  test('l07: the kiln door sits behind a lintel only film fits under: ice and a drop stop at it, film crawls to the exit', () => {
    for (const form of [null, 'ice']) {
      const r = at(l07, A5 + 120, 0, 0, form);
      r.sim.level.panes.forEach((p) => { p.broken = true; p.solid.active = false; });
      assert(hold(r, 1, 0, 4, { jump: true }).maxX < A5 + 124 - FORMS[form || 'liquid'].r + 1e-6 && !r.sim.completed, `${form || 'a drop'} got under the lintel`);
    }
    const f = at(l07, A5 + 120, 0, 0, 'film');
    hold(f, 1, 0, 6);
    assert(f.sim.completed, 'film should crawl under the lintel to the kiln door');
  });

  test('l07: a crate shoved into a corner of the cellar is put back by R', () => {
    const r = at(l07, A3 + 17, floorY, 0);
    const c = r.sim.level.crates[0];
    c.body.x = A3 + 19.4; c.body.z = -3.4; c.body.y = floorY; r.wait(0.3);
    r.restart(); r.wait(0.3);
    assert(Math.abs(c.body.z - c.home[2]) < 1e-6 && Math.abs(c.body.x - c.home[0]) < 1e-6, 'R did not put the crate back');
  });

  test('l07: the glass at the end of the second gale needs film for the beam, then ice; film cannot break it, and a standing start does not either', () => {
    const pn = (r) => pane(r.sim, 'paneA');
    const f = at(l07, A4 + 19, 0, 0, 'film');
    hold(f, 1, 0, 8);
    assert(!pn(f).broken, 'film broke the glass');
    const q = at(l07, A4 + 20.6, 0, 0, 'ice');
    hold(q, 1, 0, 3);
    assert(!pn(q).broken, 'ice broke the glass from a 1.4 m standing start');
    const g = at(l07, A4 + 18.4, 0, 0, 'ice');
    hold(g, 1, 0, 5);
    assert(pn(g).broken, 'ice with the open stretch behind the beam should break it');
  });

  test('l07: the glass floor in hall C ignores a drop and a hop; a cloud cannot skip the cliff (cold air over it)', () => {
    const r = at(l07, A4 + 27.5, 0, 0);
    hold(r, 0, 0, 3, { jump: true });
    assert(!pane(r.sim, 'floorGlassB').broken, 'a drop broke the glass floor');
    const q = at(l07, A4 + 27.5, 0, 0, 'ice');
    hold(q, 0, 0, 3, { jump: true });
    assert(!pane(q.sim, 'floorGlassB').broken, 'an ice hop broke the glass floor');
    for (const [x, z] of [[A4 + 33.0, 0], [A4 + 28, 3.5], [A4 + 24, -3.5]]) {
      const t = steamTrials(l07, x, 0, z);
      eq(standsBeyond(t, (xx, y) => xx > A4 + 34.8 && y > 5.9), [], `steam skipped the cliff from (${(x - A4).toFixed(1)}, ${z})`);
    }
  });

  test('l07: the crest embers stop ice; the slide needs the downhill - a flat run breaks none of the panes', () => {
    const c = at(l07, A5 + 20, 12.6, 0, 'ice');
    const f = hold(c, 1, 0, 6);
    assert(f.maxX < A5 + 23.9 - FORMS.ice.r + 1e-6 && !ember(c.sim, 'crestEmbers').doused, 'ice got past the crest embers');
    for (const [id, x, y] of [['paneS1', A5 + 40.2, 8.6], ['paneS2', A5 + 64.2, 4.6], ['paneS3', A5 + 88.2, 0]]) {
      const r = at(l07, x, y, 0, 'ice');
      r.sim.level.panes.forEach((p) => { if (p.id !== id) { p.broken = true; p.solid.active = false; } });
      hold(r, 1, 0, 3);
      assert(!pane(r.sim, id).broken, `${id} broke from a flat run`);
    }
    const q = at(l07, A5 + 100, 0, 0, 'ice');
    hold(q, 1, 0, 4);
    assert(!pane(q.sim, 'paneB').broken, 'ice broke the last wall of glass from the flat');
    const d = at(l07, A5 + 100, 0, 0);
    hold(d, 1, 0, 3, { jump: true });
    assert(!pane(d.sim, 'paneB').broken, 'a drop broke the last glass');
  });

  test('l07: from either platform of the glass run no cloud can be made (cold air) or reach the high crest', () => {
    for (const [x, y] of [[A5 + 10, 6], [A5 + 22, 12.6], [A5 + 12.5, 12.6]]) {
      const t = steamTrials(l07, x, y, 0);
      assert(t.maxY < y + 2.2, `a cloud was made in the cold at (${(x - A5).toFixed(1)}, ${y}): climbed to ${t.maxY.toFixed(1)}`);
    }
  });
}

// ------------------------------------------------------------------------------------------ l08
{
  const [A1, A2, A3, A4, A5] = origins(l08);
  const R = FORMS.liquid.r;

  test('l08: a cloud cannot pass either doorway of embers, nor go over or round the walls beside them; a drop touches them and walks on', () => {
    for (const [wx, id] of [[16, 'embersA'], [30, 'embersB']]) {
      for (const z of [0, 3.5, -3.5]) {
        const t = steamTrials(l08, A1 + wx - 3, 0, z);
        eq(standsBeyond(t, (x) => x > A1 + wx + 0.7), [], `${id}: a cloud from z=${z} got past the doorway`);
      }
      const r = at(l08, A1 + wx - 2, 0, 0);
      hold(r, 1, 0, 2.5);
      assert(ember(r.sim, id).doused && r.p.x > A1 + wx + 0.7, `${id}: a drop that touches the embers should put them out and walk on`);
    }
  });

  test('l08: liquid does not conduct, so the door stays shut; film opens it only with BOTH pairs of posts, and the circuits latch', () => {
    const r = at(l08, A2 + 8.2, 3.6, -0.3);
    r.move(0, -1, 1.5);
    assert(r.p.z > -0.9 && !r.sim.signals.get('arc1'), 'a drop cannot get under the shelf onto the strip');
    for (const form of ['liquid', 'ice']) {
      const q = at(l08, A2 + 11, 3.6, 0, form === 'liquid' ? null : form);
      const e = hold(q, 1, 0, 3, { jump: true });
      assert(e.maxX < A2 + 14 - FORMS[form].r + 1e-6, `${form} got through the low wall: ${e.maxX}`);
    }
    const door = (q) => q.sim.level.doors[0];
    const none = at(l08, A2 + 36, 3.6, 0);
    none.wait(0.5); assert(door(none).open < 0.01, 'the door opened with no circuit closed');
    const one = at(l08, A2 + 8.1, 3.6, -3.0, 'film');
    one.wait(0.5); one.expectSignal('arc1', true);
    assert(door(one).open < 0.01, 'the door opened with only the first posts closed');
    const two = at(l08, A2 + 28.1, 3.6, 2.7, 'film');
    two.wait(0.5); two.expectSignal('arc2', true);
    assert(door(two).open < 0.01, 'the door opened with only the second posts closed');
    one.sim.teleport(A2 + 28.1, 3.7, 2.7); one.sim.forceForm('film'); one.wait(1);
    assert(door(one).open >= 1, 'the door stays shut with both circuits closed');
    one.sim.teleport(A2 + 20, 3.7, 0); one.sim.forceForm('liquid'); one.wait(1);
    assert(door(one).open >= 1, 'the door closed again after the film left (the circuits latch)');
    const e = hold(none, 1, 0, 3);
    assert(e.maxX <= A2 + 40.03 - R + 1e-6, 'a drop walked through the shut door');
  });

  test('l08: a cloud cannot float over or round the low wall or the door wall to stand on the far side', () => {
    for (const [x, z, bx] of [[A2 + 12.5, 0, A2 + 14.6], [A2 + 12.5, 3.2, A2 + 14.6], [A2 + 12.5, -3.2, A2 + 14.6], [A2 + 38.6, 0, A2 + 40.4], [A2 + 38.6, 3.2, A2 + 40.4], [A2 + 38.6, -3.2, A2 + 40.4]]) {
      const t = steamTrials(l08, x, 3.6, z);
      eq(standsBeyond(t, (xx, yy) => xx > bx + 0.1 && yy > 3), [], `steam from (${(x - A2).toFixed(1)}, ${z}) landed on the far side of the wall at ${(bx - A2).toFixed(1)}`);
    }
    const q = steamTrials(l08, A2 + 9.0, 5.1, -2.5);
    eq(standsBeyond(q, (x, y) => x > A2 + 14.7 && y > 3), [], 'steam from the shelf top got over the low wall');
    const b = steamTrials(l08, A2 + 27, 5.1, 2.8);
    eq(standsBeyond(b, (x, y) => x > A2 + 40.5 && y > 3), [], 'steam from the second bench got over the door wall');
  });

  test('l08: the ferries wait docked until Mote comes near them (nobody waits for a cycle)', () => {
    dockTests(l08, [['ferryA', A3 + 9, 3.6, 0], ['ferryB', A3 + 25, 3.6, 0]]);
  });

  test('l08: the glass across the island needs ice with a run: film and a drop cannot break it, so the second ferry needs ice', () => {
    const pn = (r) => pane(r.sim, 'islandPane');
    for (const form of [null, 'film']) {
      const r = at(l08, A3 + 18.4, 3.6, 0, form);
      hold(r, 1, 0, 6, { jump: true });
      assert(!pn(r).broken && r.p.x < A3 + 21.65, `${form || 'a drop'} got through the glass on the island`);
    }
    const s2 = at(l08, A3 + 20.2, 3.6, 0, 'ice');
    hold(s2, 1, 0, 2);
    assert(!pn(s2).broken, 'ice broke the glass from a 1.4 m standing start');
    const f = at(l08, A3 + 18.6, 3.6, 0, 'ice');
    hold(f, 1, 0, 4);
    assert(pn(f).broken, 'ice with the run of the island should break the glass');
    // a cloud cannot be made over the island and float over or round the wall
    const t = steamTrials(l08, A3 + 19, 3.6, 0);
    eq(standsBeyond(t, (x, y) => x > A3 + 22.2 && y > 3), [], 'a cloud got past the glass wall on the island');
  });

  test('l08: the ferries sit in a crosswind: a drop and a cloud are swept off, film and ice ride them across, and nothing jumps either pit', () => {
    for (const form of ['liquid', 'steam']) {
      const r = at(l08, A3 + 11.5, 3.6, 0, form === 'liquid' ? null : form);
      park(r);
      let gone = false;
      for (let i = 0; i < 700 && !gone; i++) { r.tick(0, 0); gone = r.sim.deaths > 0 || r.p.z > 6; }
      assert(gone, `${form} stayed on the deck in the crosswind: ${r.state()}`);
    }
    for (const form of ['film', 'ice']) {
      const r = play(l08);
      r.sim.teleport(A3 + 9.4, 3.6, 0);
      r.wait(0.3); r.form(form);
      r.waitUntil((s) => mover(s, 'ferryA').t < 0.01 && mover(s, 'ferryA').wait > 0.5, { timeout: 16, label: 'docks' });
      r.walkTo(A3 + 11.5, 0);
      if (form === 'ice') r.stop();
      r.waitUntil((s) => mover(s, 'ferryA').t >= 0.999, { timeout: 8, label: 'across' });
      eq(r.sim.deaths, 0, `${form} was blown off the ferry`);
    }
    for (const [x0, x1] of [[A3 + 10, A3 + 18], [A3 + 26, A3 + 34]]) {
      const r = at(l08, x0 - 2, x0 > A3 + 20 ? 3.6 : 3.6, 0);
      park(r);
      let maxX = 0;
      for (let i = 0; i < 360; i++) { r.tick(1, 0, i > 20 && i < 70); maxX = Math.max(maxX, r.p.x); }
      assert(maxX < x1 - 0.5 && r.sim.deaths > 0, `a drop crossed the pit from ${x0}: ${maxX}`);
    }
  });

  test('l08: the loft is out of reach without steam (no jump, no sprout reaches it); the hatch is the way up; the cage bars stop a drop', () => {
    const r = at(l08, A4 + 24.4, 3.6, 0);
    let top = 0;
    for (let i = 0; i < 400; i++) { r.tick(Math.sin(i * 0.03) * 0.4, Math.cos(i * 0.05) * 0.4, i % 90 < 45); if (r.p.grounded) top = Math.max(top, r.p.y); }
    assert(top < 4, `liquid stood on something high: y=${top}`);
    const t = steamTrials(l08, A4 + 24.4, 3.6, 0);
    assert(t.stands.some(([x, y]) => y > 7.7), 'steam from under the hatch should reach the loft');
    const c = at(l08, A4 + 14, 3.6, 2.5);
    hold(c, 0, 1, 2, { jump: true });
    assert(c.p.z < 4.05 - R + 0.02, `a drop got through the cage bars: z=${c.p.z}`);
  });

  test('l08: the way back up from the yard is a warm draught by the loft edge - a drop cannot ride it, a cloud gets up with gauge to spare, and a miss lands on the yard and refills', () => {
    const X = A5 + 43.5, Z = -2.8;
    // a drop (even jumping, even held in the air) is hardly lifted, and stays on the yard side of the edge
    const d = at(l08, X, 3.6, Z);
    const e = hold(d, 0, 0, 3, { jump: true });
    assert(e.maxY < 6.5, `a drop rode the draught ${e.maxY.toFixed(2)} m up`);
    // the climb, flown cleanly, leaves most of the gauge: measured from the full gauge to the first moment over the loft
    const c = at(l08, X, 3.6, Z);
    c.waitUntil((s, p) => p.gauge >= 3.99, { timeout: 3 }).form('steam');
    c.waitUntil((s, p) => p.y > 7.9, { toward: [X, Z], timeout: 4, label: 'up the draught' })
      .waitUntil((s, p) => p.x < A5 + 41.5, { toward: [A5 + 39, Z], timeout: 4, label: 'over the loft edge' });
    assert(c.p.gauge >= MIN_SLACK, `the climb from the yard leaves only ${c.p.gauge.toFixed(2)} s of gauge`);
    const left = c.p.gauge;
    c.form('liquid').waitUntil((s, p) => p.grounded, { timeout: 4, label: 'down on the loft' });
    assert(c.sim.deaths === 0 && Math.abs(c.p.y - 7.8) < 1e-6 && c.p.x < A5 + 42, `the climb did not end on the loft: ${c.state()}`);
    // a miss: give up halfway, land on the yard (not the pit, not the kiln), and the gauge fills while standing
    const m = at(l08, X, 3.6, Z);
    m.waitUntil((s, p) => p.gauge >= 3.99, { timeout: 3 }).form('steam');
    m.waitUntil((s, p) => p.y > 5, { toward: [X, Z], timeout: 4, label: 'half way up' });
    m.form('liquid').waitUntil((s, p) => p.grounded, { timeout: 3, label: 'back on the yard' });
    assert(m.sim.deaths === 0 && Math.abs(m.p.y - 3.6) < 0.05, `a miss ended at ${m.state()}`);
    m.wait(2.2);
    assert(m.p.gauge >= 3.99, `the gauge did not refill on the yard: ${m.p.gauge.toFixed(2)}`);
  });

  test('l08: the hatch draught lifts a cloud through the grate with gauge to spare, but a drop in it cannot get above the loft floor', () => {
    const X = A4 + 24.4;
    const d = at(l08, X, 3.6, 0);
    const e = hold(d, 0, 0, 3, { jump: true });
    assert(e.maxY < 6.5, `a drop rode the hatch draught ${e.maxY.toFixed(2)} m up`);
    const c = at(l08, X, 3.6, 0);
    c.waitUntil((s, p) => p.gauge >= 3.99, { timeout: 3 }).form('steam');
    c.waitUntil((s, p) => p.y > 7.9, { toward: [X, 0], timeout: 4, label: 'through the hatch' });
    assert(c.p.gauge >= MIN_SLACK, `the hatch climb leaves only ${c.p.gauge.toFixed(2)} s of gauge`);
  });

  test('l08: the exit stays shuttered unless something heavy holds BOTH plates - Mote cannot do it and walk away', () => {
    const r = at(l08, A5 + 49, 3.6, 0);
    r.walkTo(A5 + 66, 0, { stuck: 0 }); r.move(1, 0, 1);
    assert(!r.sim.completed, 'the exit opened with nothing on the plates');
    const q = at(l08, A5 + 48, 3.6, 0);
    q.form('ice'); q.walkTo(A5 + 42.4, 0, { tol: 0.3 }); q.stop(); q.wait(0.1);
    q.expectSignal('hp', true);
    q.form('liquid'); q.walkTo(A5 + 66, 0, { stuck: 0 }); q.wait(0.1);
    assert(!q.sim.completed, 'Mote left the plate and still got out');
    // one crate on one plate is still not enough
    const c = at(l08, A5 + 49, 3.6, 0);
    const b = c.sim.level.crates[0].body;
    b.x = A5 + 42.4; b.z = 0; b.y = 3.66; c.wait(1);
    c.expectSignal('hp', true); c.expectSignal('hp2', false);
    c.walkTo(A5 + 66, 0, { stuck: 0 }); c.move(1, 0, 1);
    assert(!c.sim.completed, 'the exit opened with only one plate held');
    // both crates: it opens
    const d = at(l08, A5 + 49, 3.6, 0);
    const b1 = d.sim.level.crates[0].body, b2 = d.sim.level.crates[1].body;
    b1.x = A5 + 42.4; b1.z = 0; b1.y = 3.66; b2.x = A5 + 42.4; b2.z = 3.1; b2.y = 3.66; d.wait(1);
    d.expectSignal('hp', true); d.expectSignal('hp2', true);
    d.walkTo(A5 + 66, 0, { stuck: 0 }); d.expectExit({ timeout: 3, toward: [A5 + 67.4, 0] });
  });

  test('l08: a crate that lies on the yard off the plate can still be shoved onto it, and R puts it back on the loft', () => {
    const r = play(l08);
    r.allowDeath = true;
    const c = r.sim.level.crates[0];
    c.body.x = A5 + 39; c.body.z = 2.4; c.body.y = 3.6;
    r.sim.teleport(A5 + 39, 3.7, 3.55); r.sim.forceForm('ice'); r.wait(0.3);
    r.waitUntil(() => c.body.z <= 0.15, { mz: -1, timeout: 6, label: 'crate pushed into the row of the plate' }).stop();
    r.walkTo(A5 + 37.6, c.body.z, { tol: 0.3 }).stop();
    r.waitUntil(() => c.body.x >= A5 + 42.2, { mx: 1, timeout: 8, label: 'crate pushed onto the plate' });
    r.expectSignal('hp', true);
    r.restart(); r.wait(0.3);
    near(c.body.x, c.home[0]); near(c.body.y, c.home[1]); near(c.body.z, c.home[2]);
    assert(c.home[1] > 7, 'the crate starts on the loft');
  });
}
