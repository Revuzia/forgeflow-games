// Level tests for the hard tier (levels 9-12, chapter 3 "The Great Kiln"), after the v2 expansion pass.
//   - every level: its route time is inside its band, it is a journey of named areas, every area has a checkpoint
//     at its start and the reference route lights them in order, solveAll is deterministic
//   - every gate: "cannot be skipped" (clouds can fly round any wall that does not reach the level edge or a roof, so
//     every gate is tried with clouds from every side), every hazard really kills
// The solvability scripts live in tests/solutions/; the house rules for every level are in tests/levels.test.js.

import { test, assert, eq, near, between } from './lib/harness.js';
import { play } from './lib/play.js';
import l09 from '../src/levels/l09.js';
import l10, { X as X10 } from '../src/levels/l10.js';
import l11, { X as X11 } from '../src/levels/l11.js';
import l12, { X as X12, Y as Y12 } from '../src/levels/l12.js';
import * as s09 from './solutions/l09.js';
import * as s10 from './solutions/l10.js';
import * as s11 from './solutions/l11.js';
import * as s12 from './solutions/l12.js';
import { FORMS } from '../src/sim/constants.js';

const R = FORMS.liquid.r;

// ------------------------------------------------------------------------------------ helpers
/** Record everything done to a runner (ticks, teleports, raised signals, placed crates) so the same set-up can be replayed. */
function recorded(level) {
  const r = play(level);
  const log = [];
  r._level = level; r._log = log;
  // (the originals are called with the right `this`: a replay must act on ITS sim, never on this one; and only calls
  // made from outside a tick are logged, since the replay's own ticks make the others)
  let inTick = false;
  const tick0 = r.tick.bind(r);
  r.tick = (...a) => { log.push((q) => q.tick(...a)); inTick = true; try { return tick0(...a); } finally { inTick = false; } };
  const tp0 = Object.getPrototypeOf(r.sim).teleport;
  r.sim.teleport = (...a) => { if (!inTick) log.push((q) => tp0.call(q.sim, ...a)); return tp0.call(r.sim, ...a); };
  const sg = r.sim.signals, sgProto = Object.getPrototypeOf(sg);
  const em0 = sgProto.emit, ev0 = sgProto.evaluate;
  sg.emit = (...a) => { if (!inTick) log.push((q) => em0.call(q.sim.signals, ...a)); return em0.call(sg, ...a); };
  sg.evaluate = (...a) => { if (!inTick) log.push((q) => ev0.call(q.sim.signals, ...a)); return ev0.call(sg, ...a); };
  return r;
}

/** A runner that may die, dropped at (x, y, z) and settled. */
function at(level, x, y, z) {
  const r = recorded(level);
  r.allowDeath = true;
  r.sim.teleport(x, y, z);
  r.wait(0.3);
  return r;
}

/**
 * Steam from where Mote is, steered by `steer(p)` -> [mx, mz], until it condenses, dies or time is up. Returns the
 * extremes. Several plans are tried from the same set-up and the worst for the level is returned: boiling where you
 * stand, or jumping first and boiling at the top of the jump (about 7.3 m of climb on a full gauge, not 5.5); and each
 * of those either steering at once or first climbing straight up for 2.5 or 4.5 m (a full gauge drifts about 13 m
 * sideways, or climbs about 7 m, or something in between).
 */
function floatAway(r, steer, maxSeconds = 8) {
  const y0 = r.p.y;
  const variants = [steer, (p) => (p.y < y0 + 2.5 ? [0, 0] : steer(p)), (p) => (p.y < y0 + 4.5 ? [0, 0] : steer(p))];
  const run = (q, jump, st) => {
    if (jump && q.p.grounded) {
      let guard = 0;
      q.tick(0, 0, false);
      while (guard++ < 120 && !(q.p.vy < 0.3 && !q.p.grounded)) { const [mx, mz] = st(q.p); q.tick(mx, mz, true); }
    }
    q.form('steam', { expect: false });                       // refused (cold air, frost) is a safe answer: there is no cloud
    let maxX = q.p.x, maxY = q.p.y;
    const d0 = q.sim.deaths;
    for (let i = 0; i < maxSeconds * 120 && q.p.form === 'steam' && q.sim.deaths === d0; i++) {
      const [mx, mz] = st(q.p);
      q.tick(mx, mz, false);
      maxX = Math.max(maxX, q.p.x); maxY = Math.max(maxY, q.p.y);
    }
    return { maxX, maxY };
  };
  if (r._log && r.p.grounded && r.p.form !== 'steam') {
    const snap = r._log.slice();
    r._jumps = [];
    let maxX = -Infinity, maxY = -Infinity, plain = null, jumped = null;
    variants.forEach((st, vi) => {
      for (const jump of [true, false]) {
        if (vi === 0 && !jump) continue;                      // the plain, steer-at-once run is made on `r` itself, last
        const q = play(r._level);
        q.allowDeath = true;
        for (const f of snap) f(q);
        const o = run(q, jump, st);
        r._jumps.push(q);
        maxX = Math.max(maxX, o.maxX); maxY = Math.max(maxY, o.maxY);
        if (vi === 0) jumped = o;
      }
    });
    plain = run(r, false, variants[0]);
    return { maxX: Math.max(maxX, plain.maxX), maxY: Math.max(maxY, plain.maxY), plain, jumped };
  }
  return run(r, false, steer);
}

/** After a float, let Mote fall: where does it end up (grounded), or did it die? `any` holds every plan's answer. */
function settle(r, seconds = 5) {
  const one = (q) => {
    const d0 = q.sim.deaths;
    for (let i = 0; i < seconds * 120 && !q.p.grounded && q.sim.deaths === d0; i++) q.tick(0, 0, false);
    return { grounded: q.p.grounded, died: q.sim.deaths > d0, x: q.p.x, y: q.p.y };
  };
  const a = one(r);
  const any = [a];
  for (const q of r._jumps || []) any.push(one(q));
  return { ...a, any };
}

/** A runner with crate `i` set down at (x, z) on the floor `y`, and Mote standing on top of it (a gate must hold from there too). */
function onCrate(level, i, x, y, z) {
  const r = at(level, x, y, z + 3.2);
  placeCrate(r, i, x, y + 0.07, z);
  r.sim.teleport(x, y + 1.2, z); r.wait(0.4);
  return r;
}

/** Raise raw channels as if their triggers were held, so a test can start in the middle of a level. */
function raise(r, keys) {
  for (const k of keys) r.sim.signals.emit(k);
  r.sim.signals.evaluate(0); r.tick(); r.tick();
}

/** The same, in a given form from the first tick (so a bud beside the start does not see a drop for a moment). */
function atForm(level, form, x, y, z) {
  const r = recorded(level);
  r.allowDeath = true;
  r.sim.teleport(x, y, z);
  r.tick(0, 0, false, form);
  r.wait(0.3);
  return r;
}

/** Put crate `i` down at (x, y, z) as if it had been shoved there. */
function placeCrate(r, i, x, y, z) {
  const c = r.sim.level.crates[i], b = c.body;
  const fx = b.x, fy = b.y, fz = b.z;
  b.x = x; b.y = y; b.z = z; b.vy = 0; c.grounded = true; b.ground = null;
  r.sim._syncCrate(c, fx, fy, fz);
  if (r._log) r._log.push((q) => { const c2 = q.sim.level.crates[i], b2 = c2.body, ax = b2.x, ay = b2.y, az = b2.z; b2.x = x; b2.y = y; b2.z = z; b2.vy = 0; c2.grounded = true; b2.ground = null; q.sim._syncCrate(c2, ax, ay, az); });
  r.wait(0.2);
  return r;
}

const hold = (r, mx, mz, seconds, jump = false) => { for (let i = 0; i < Math.round(seconds * 120); i++) r.tick(mx, mz, jump); return r; };
const pieceById = (list, id) => list.find((q) => q.id === id);

// ------------------------------------------------------------------------------------ every level
const SUITE = [
  { id: 'l09', data: l09, sol: s09, band: [100, 112], target: 106, areas: [4, 5] },
  { id: 'l10', data: l10, sol: s10, band: [104, 114], target: 109, areas: [4, 5] },
  { id: 'l11', data: l11, sol: s11, band: [110, 120], target: 115, areas: [4, 5] },
  { id: 'l12', data: l12, sol: s12, band: [126, 150], target: 138, areas: [5, 6] },
];

for (const { id, data, sol, band, areas: nAreas } of SUITE) {
  test(`${id}: the reference route takes ${band[0]}-${band[1]} s (owner's length standard)`, () => {
    const r = play(data);
    sol.solve(r);
    const s = r.result().timeMs / 1000;
    between(s, band[0], band[1], `${id} solve() takes ${s.toFixed(1)} s`);
  });

  test(`${id}: a journey of ${nAreas[0]}-${nAreas[1]} named areas along the level`, () => {
    const A = data.areas;
    assert(Array.isArray(A), 'the level declares its areas');
    between(A.length, nAreas[0], nAreas[1], `${id} has ${A.length} areas`);
    const names = new Set();
    for (const a of A) {
      assert(typeof a.name === 'string' && a.name.length >= 3 && a.name.length <= 28, `area name "${a.name}"`);
      names.add(a.name);
      assert(Array.isArray(a.box) && a.box.length === 4 && a.box.every(Number.isFinite), `${a.name}: box is [x0, z0, x1, z1]`);
      assert(a.box[0] < a.box[2] && a.box[1] < a.box[3], `${a.name}: box has a size`);
    }
    eq(names.size, A.length, 'area names are unique');
    for (let i = 1; i < A.length; i++) assert(A[i].box[0] >= A[i - 1].box[0] - 1e-9, `${A[i].name} comes after ${A[i - 1].name}`);
    // the spawn is in the first area, the exit in the last
    const [sx, , sz] = data.spawn;
    assert(sx >= A[0].box[0] && sx <= A[0].box[2] && sz >= A[0].box[1] && sz <= A[0].box[3], 'the spawn is inside the first area');
    const ex = data.pieces.find((p) => p.type === 'exit').pos;
    const last = A[A.length - 1].box;
    assert(ex[0] >= last[0] && ex[0] <= last[2], 'the exit is inside the last area');
  });

  test(`${id}: every area has a checkpoint at its start, and the reference route lights them in order`, () => {
    const A = data.areas;
    const cps = data.pieces.filter((p) => p.type === 'checkpoint');
    A.forEach((a, i) => {
      const inside = cps.filter((c) => c.pos[0] >= a.box[0] && c.pos[0] <= a.box[2]);
      assert(inside.length >= 1, `${a.name}: no checkpoint inside the area`);
      const first = Math.min(...inside.map((c) => c.pos[0]));
      if (i > 0) assert(first - a.box[0] <= 10, `${a.name}: its first checkpoint is ${(first - a.box[0]).toFixed(1)} m in, not at the start`);
    });
    const r = play(data);
    sol.solveAll(r);
    const areaOf = (x) => A.findIndex((a) => x >= a.box[0] && x <= a.box[2]);
    const seen = [];
    for (const e of r.events) if (e.type === 'checkpoint') seen.push(areaOf(e.x));
    for (let i = 1; i < seen.length; i++) assert(seen[i] >= seen[i - 1], `checkpoints lit out of order: ${seen.join(',')}`);
    for (let i = 0; i < A.length; i++) assert(seen.includes(i), `the route never lit a checkpoint in "${A[i].name}"`);
    // and the player is never more than ~60 m from the last lit checkpoint... of the next risky thing: no two lit checkpoints are further apart than 70 m
    const xs = r.events.filter((e) => e.type === 'checkpoint').map((e) => e.x);
    for (let i = 1; i < xs.length; i++) assert(Math.abs(xs[i] - xs[i - 1]) <= 70, `checkpoints ${xs[i - 1]} -> ${xs[i]} are too far apart`);
  });

  test(`${id}: solveAll is deterministic`, () => {
    const a = play(data); sol.solveAll(a);
    const b = play(data); sol.solveAll(b);
    eq(a.sim.fingerprint(), b.sim.fingerprint());
    eq(a.result().timeMs, b.result().timeMs);
    eq(a.result().shards, [0, 1, 2]);
  });

  test(`${id}: pressing R puts every crate back where it started, so a shoved crate can never make the level unwinnable`, () => {
    const r = play(data);
    r.allowDeath = true;
    const crates = r.sim.level.crates;
    assert(crates.length >= 1, 'the level has a crate');
    const homes = crates.map((c) => c.home.slice());
    // knock every crate somewhere else (even into the fire), play a little, press R
    crates.forEach((c, i) => placeCrate(r, i, c.home[0] + 1.3, c.home[1] + 0.4, c.home[2] + 0.9));
    r.wait(0.5);
    r.restart();
    r.wait(0.3);
    crates.forEach((c, i) => {
      near(c.body.x, homes[i][0], 0.05, `${id} crate ${i} x`);
      near(c.body.z, homes[i][2], 0.05, `${id} crate ${i} z`);
    });
    eq(r.sim.deaths, 0, 'a restart is not a death');
  });
}

// ------------------------------------------------------------------------------------ the jump-then-boil audit
// A drop that jumps first and boils at the top of the jump climbs 7.05 m on a full gauge (boiling where it stands, 5.52 m),
// and a full gauge drifts about 13 m sideways. Every door's wall must stand taller than that above the sill, with a
// metre to spare for a crate that has been shoved up against it; every wall is also tried with clouds in the tests below.
test('the jump-then-boil numbers are what the walls were built against: 7.05 m climb, 5.52 m boil-only', () => {
  const q = at(l11, 5, 0, 0);
  const boil = floatAway(q, () => [0, 0]);
  near(boil.plain.maxY, 5.52, 0.15, 'boil-only climb');
  near(boil.jumped.maxY, 7.05, 0.15, 'jump-then-boil climb');
  assert(boil.maxY < 7.3, `no plan climbs more than 7.3 m: ${boil.maxY}`);
});

for (const { id, data } of SUITE) {
  test(`${id}: every door's wall is taller than a jump-then-boil climb from the top of a crate (7.05 + 1 m, and a margin)`, () => {
    const doors = data.pieces.filter((p) => p.type === 'door');
    assert(doors.length >= 2, `${id} has doors`);
    for (const d of doors) {
      const walls = data.pieces.filter((p) => p.type === 'block' && p.box[0] <= d.box[0] + 0.01 && p.box[3] >= d.box[3] - 0.01
        && p.box[3] - p.box[0] <= 1.6 && p.box[4] > d.box[4] && (p.box[2] < -1.2 || p.box[5] > 1.2));
      assert(walls.length >= 2, `${id} ${d.id}: its wall`);
      const top = Math.min(...walls.map((w) => w.box[4]));
      assert(top - d.box[1] >= 8.4, `${id} ${d.id}: the wall is only ${(top - d.box[1]).toFixed(2)} m above the sill`);
    }
  });
}

// ------------------------------------------------------------------------------------ l09 Heat Haze
test('l09: a drop that steps into the haze boils and cannot press the plate; ice melts into the vent as steam', () => {
  const r = at(l09, 46.5, 6, 2.0);
  r.walkTo(50, 2.0, { stuck: 0, timeout: 3 });
  assert(!r.sim.signals.get('p1'), 'the plate in the haze was pressed by Mote');
  eq(r.p.form, 'steam');
  const q = at(l09, 46.5, 6, 2.0);
  q.form('ice'); q.walkTo(50, 1.9, { stuck: 0, timeout: 3 });
  assert(!q.sim.signals.get('p1'), 'ice got the plate down');
  assert(q.p.form === 'steam' || q.p.y > 6.1, 'the vent forced steam');
});

test('l09: heat vents hold the steam gauge full while you are inside, and it drains the moment you leave', () => {
  const r = at(l09, 11, 2, 0);
  r.walkTo(14.5, 0, { stuck: 0 });
  eq(r.p.form, 'steam');
  for (let i = 0; i < 360; i++) r.tick(0, 0, false);
  assert(r.p.gauge > 3.99, `the gauge drained inside the vent: ${r.p.gauge}`);
  r.waitUntil((s, p) => p.y > 6.6, { toward: [14.5, 0], timeout: 6 });
  hold(r, 1, 0, 2.4);
  assert(r.p.gauge < 3.0, `the gauge should be draining outside the vent: ${r.p.gauge}`);
});

test('l09: door A stays shut until the crate holds the plate in the haze; no cloud gets over or round its wall', () => {
  const r = at(l09, 60, 6, 0);
  hold(r, 1, 0, 2);
  assert(r.p.x <= 62.03 - R + 1e-6, `got through the closed door: x=${r.p.x}`);
  const starts = [[18, 0], [26, 3.5], [47, -3.5], [47, 2], [55, 0], [58, 3.5]];
  for (const [x, z] of starts) for (const sz of [-1, 0, 1]) {
    const q = at(l09, x, 6, z);
    const { maxX } = floatAway(q, () => [1, sz]);
    assert(maxX < 62.4, `a cloud from (${x}, ${z}) steering z=${sz} got over door A: x=${maxX}`);
  }
  // from inside the cap vent, leaving by the west side and climbing as high as the gauge allows
  const c = at(l09, 50, 6, 2.0);
  c.form('steam');
  for (let i = 0; i < 2000 && c.p.form === 'steam' && c.sim.deaths === 0; i++) c.tick(c.p.y < 12 ? (c.p.x > 47.4 ? -1 : 0) : 1, 0, false);
  assert(c.p.x < 62.4, `a cloud from the cap vent got over door A: x=${c.p.x}`);
});

test('l09: neither vent in the first hall lifts a cloud over the cliff and on past door A', () => {
  const r = at(l09, 11, 2, 0);
  r.walkTo(14.5, 0, { stuck: 0 });
  r.waitUntil((s, p) => p.y > 8.8, { toward: [14.5, 0], timeout: 9 });
  const { maxX } = floatAway(r, () => [1, 0]);
  assert(maxX < 62, `a cloud from the cliff vent reached door A: x=${maxX}`);
});

test('l09: the film gap and the posts: a drop cannot pass the low wall, and door C stays shut without them', () => {
  const r = at(l09, 66.4, 6, 0);
  hold(r, 1, 0, 2);
  assert(r.p.x <= 67.6 - R + 1e-6, `a drop got under the low wall: x=${r.p.x}`);
  const q = at(l09, 72, 6, 0);
  hold(q, 1, 0, 2);
  assert(q.p.x <= 73.63 - R + 1e-6, `got through the closed crate-room door: x=${q.p.x}`);
  for (const [x, z] of [[65, 0], [64.4, 3.5], [70.8, -2.2], [72, 2]]) for (const sz of [-1, 0, 1]) {
    const c = at(l09, x, 6, z);
    const { maxX } = floatAway(c, () => [1, sz]);
    assert(maxX < 74, `a cloud from (${x}, ${z}) got over the crate-room wall: x=${maxX}`);
  }
  // film does pass and closes the posts
  const f = at(l09, 66.4, 6, 0);
  f.form('film'); f.walkTo(70.9, 0, { stuck: 0 });
  f.expectSignal('arcC', true);
});

test('l09: the corridor is all haze until the light plate is held: ice cannot press the heavy plate, and the door behind it stays shut', () => {
  const r = at(l09, 83, 6, 0);
  r.form('ice');
  r.walkTo(91, 0, { stuck: 0, timeout: 4 });
  assert(!r.sim.signals.get('hh'), 'ice pressed the heavy plate inside the haze');
  eq(r.p.form, 'steam');
  // held down by Mote himself, the vents are off for as long as he stays there
  const q = at(l09, 82.4, 6, 2.4);
  assert(q.sim.signals.get('cool'), 'standing on the light plate switches the corridor off');
  assert(!q.sim.level.zones[3].active, 'the vents are off while the plate is down');
  q.walkTo(80, 0, { stuck: 0 }); q.wait(0.2);
  assert(q.sim.level.zones[3].active, 'and on again when it is released');
  // no cloud from the hot corridor gets over door B
  for (const [x, z] of [[85.5, 0], [92, 3.5], [90, -3.5]]) for (const sz of [-1, 0, 1]) {
    const c = at(l09, x, 6, z);
    c.walkTo(x + 0.6, z, { stuck: 0, timeout: 2 });
    const { maxX } = floatAway(c, () => [1, sz]);
    assert(maxX < 97.4, `a cloud from the hot corridor got over door B: x=${maxX}`);
  }
  const d = at(l09, 95, 6, 0);
  hold(d, 1, 0, 2);
  assert(d.p.x <= 97.03 - R + 1e-6, `got through the closed door B: x=${d.p.x}`);
});

test('l09: a cloud that leaves the launch vent low runs into the cold band, condenses and falls into the fire', () => {
  const r = at(l09, 100, 6, 0);
  r.walkTo(104.7, 0, { stuck: 0, timeout: 2 });
  r.waitUntil((s, p) => p.y > 8.5, { toward: [104.7, 0], timeout: 4 });
  floatAway(r, () => [1, 0]);
  r.waitUntil((s) => s.deaths > 0, { timeout: 6, label: 'falls into the fire' });
  const q = at(l09, 100, 6, 0);
  q.form('steam');
  floatAway(q, () => [1, 0]);
  q.waitUntil((s) => s.deaths > 0, { timeout: 6 });
});

test('l09: the vent beside the first cold band gives no way across without rising above it: a drop dies in the fire', () => {
  const r = at(l09, 110, 7, 0);
  r.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'the fire bed kills' });
});

test('l09: nothing but the bridge crosses the long gap: a cloud from the pier does not reach the far hall', () => {
  for (const [x, z] of [[136, 0], [133.5, 3], [130, -3]]) {
    const r = at(l09, x, 9, z);
    const { maxX } = floatAway(r, () => [1, 0]);
    assert(maxX < 152, `a cloud from the pier reached the far hall: x=${maxX} (the gap is 15 m)`);
    const e = settle(r);
    assert(!e.any.some((a) => a.grounded && a.x > 152), 'landed on the far side');
  }
});

test('l09: the bridge slides out only while the heavy plate is held, and slides back when it is let go', () => {
  const r = at(l09, 126, 9, 0);
  r.wait(3);
  eq(r.sim.level.movers[0].t, 0);
  r.form('ice'); r.walkTo(132.8, 1.9, { stuck: 0, timeout: 4 }); r.stop();
  r.wait(2);
  assert(r.sim.level.movers[0].t > 0.2, 'the bridge did not move with the plate held');
  r.walkTo(128, -2, { stuck: 0, timeout: 4 }); r.wait(8);
  assert(r.sim.level.movers[0].t < 0.2, 'the bridge did not slide back');
});

test('l09: the doorway of embers stops everything but a drop; clouds cannot get over its wall; the draught is cold until the damper plate has been pressed', () => {
  const r = at(l09, 158, 9, 0);
  r.form('film'); hold(r, 1, 0, 6);
  assert(r.p.x < 162, `film got through the embers: x=${r.p.x}`);
  assert(!r.sim.level.embers[0].doused, 'film put out the embers');
  const q = at(l09, 158, 9, 0);
  q.form('ice'); hold(q, 1, 0, 3);
  assert(q.p.x < 162, 'ice got through the embers');
  for (const sz of [-1, 0, 1]) {
    const c = at(l09, 158, 9, sz * 3);
    const { maxX } = floatAway(c, () => [1, sz]);
    assert(maxX < 162.4, `a cloud got over the ember wall: x=${maxX}`);
  }
  // beyond the embers, with the damper plate never pressed, the great vent does not boil anyone
  const d = at(l09, 165, 9, 0);
  d.walkTo(173.6, 0, { stuck: 0, timeout: 4 });
  eq(d.p.form, 'liquid', 'the cold draught boiled Mote');
  const e = at(l09, 165, 9, 0);
  const { maxY } = floatAway(e, () => [1, 0]);
  assert(maxY < 20, `a cloud from the far hall reached the crown without the draught: y=${maxY}`);
  raise(d, ['hh']);
  d.walkTo(173.6, 0, { stuck: 0, timeout: 4 });
  eq(d.p.form, 'steam', 'once the damper plate has been pressed the draught boils Mote');
});

test('l09: the ferry is too far for a cloud: nothing but the ferry takes Mote from the crown to the exit hall', () => {
  for (const z of [-3, 0, 3]) {
    const r = at(l09, 179.4, 28, z);
    const { maxX } = floatAway(r, () => [1, 0]);
    assert(maxX < 195, `a cloud crossed the kiln mouth: x=${maxX}`);
  }
  const f = at(l09, 186, 30, 0);
  f.waitUntil((s) => s.deaths > 0, { timeout: 5, label: 'fell into the kiln mouth' });
});

// ------------------------------------------------------------------------------------ l10 Quench
test('l10: frost refuses every other form; a cloud cannot be made in it, nor carried past the door', () => {
  const r = at(l10, 20, 0, 0);
  r.form('steam', { expect: false });
  eq(r.p.form, 'ice');
  r.form('liquid', { expect: false });
  eq(r.p.form, 'ice');
  for (const sz of [-1, 0, 1]) {
    const q = at(l10, 8, 0, 0);
    const { maxX } = floatAway(q, () => [1, sz]);
    assert(maxX < 31.4, `a cloud from the hall got past the frost door: x=${maxX}`);
  }
});

test('l10: the first door stays shut until ice is on the heavy plate, and then stays open', () => {
  const r = at(l10, 27, 0, 0);
  hold(r, 1, 0, 2);
  assert(r.p.x <= 31.03 - R + 1e-6, `got through the closed door: x=${r.p.x}`);
  const q = at(l10, 20, 0, 0);
  q.walkTo(22.4, 0, { tol: 0.3, stuck: 0 }); q.stop(); q.wait(0.2);
  q.expectSignal('h0', true);
  q.walkTo(18, 0, { stuck: 0 }); q.wait(1);
  assert(q.sim.level.doors[0].open >= 1, 'the door closed again after the plate was released');
});

test('l10: the pit is too wide for ice and the fire bed kills; the glass at the foot of the slide needs the slide', () => {
  const r = at(l10, 40, 0.5, 0);
  r.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'a fall into the pit is fatal' });
  const q = at(l10, 60.8, -3, 0);
  q.form('ice', { expect: false });
  hold(q, 1, 0, 3);
  assert(!q.sim.level.panes[0].broken, 'the pane broke without the slide run');
});

test('l10: in the cold store frost refuses a cloud; standing on the plate yourself does not buy a way out; the wall cannot be passed', () => {
  const x = X10.store;
  const r = at(l10, x + 20, -3, 2.5);
  r.form('steam', { expect: false });
  eq(r.p.form, 'ice');
  r.sim.teleport(x + 24.4, -3, -2.2); r.wait(0.3);
  r.expectSignal('thawA', true);
  assert(!r.sim.signals.get('thaw'), 'one plate alone must not switch the frost off');
  r.form('steam', { expect: false });
  r.wait(1.2);
  assert(r.p.form !== 'steam', 'stepping on the plate yourself must not buy a way out as a cloud');
  r.sim.teleport(x + 24.4, -3, 3.2); r.wait(0.3);
  assert(r.sim.signals.get('thawA') || r.sim.signals.get('thawB'), 'a plate is pressed');
  assert(!r.sim.signals.get('thaw'), 'standing on the second plate yourself is no better: the first is empty again');
  const q = at(l10, x + 26, -3, 0);
  hold(q, 1, 0, 3);
  assert(q.p.x <= x + 29.65 - R + 1e-6, `got through the grate as ice: x=${q.p.x}`);
});

test('l10: with the crate on the plate the frost is off, and a cloud can leave through the grate', () => {
  const r = play(l10);
  s10.icehouse(r, false);
  s10.crateOntoThePlate(r);
  assert(!pieceById(r.sim.level.zones, 'cold').active, 'the frost should be off with the crate on the plate');
  s10.throughTheGrate(r);
  eq(r.sim.deaths, 0);
});

test('l10: from a standstill in the bowl the kicker does not throw you across the gap; the glass wants the chute\'s speed', () => {
  const x = X10.skate;
  const r = at(l10, x + 27.6, -8, 0);
  hold(r, 1, 0, 9);
  assert(r.sim.deaths >= 1, 'a slow ice made the jump over the fire gap');
  const q = at(l10, x + 46, -6.5, 0);
  hold(q, 1, 0, 3);
  assert(!q.sim.level.panes[1].broken, 'the pane broke from a flat run-up');
  const f = at(l10, x + 42, -5, 0);
  f.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'the fire in the gap kills' });
});

test('l10: in the cellar the frost refuses a drop, thaws for twenty seconds after the plate, then returns', () => {
  const x = X10.cellar;
  const r = at(l10, x + 5.0, -6.5, 2.4);
  eq(r.p.form, 'ice');
  r.form('liquid', { expect: false });
  r.expectSignal('pT', true);
  r.walkTo(x + 3.0, 0, { stuck: 0 });
  r.form('liquid');
  r.wait(19);
  assert(!pieceById(r.sim.level.zones, 'cold4').active, 'the frost is still off 19 s after the plate');
  r.wait(2);
  assert(pieceById(r.sim.level.zones, 'cold4').active, 'the frost never came back');
  eq(r.p.form, 'ice');
});

test('l10: the bud cannot be watered by ice, the film-high walls stop a drop, and a cloud cannot reach the gallery', () => {
  const x = X10.cellar;
  const r = at(l10, x + 18.9, -6.5, 0);
  r.wait(1.5);
  eq(r.sim.level.sprouts[0].state, 0);
  // thawed: a drop is stopped by the first wall, film passes
  const q = at(l10, x + 5.0, -6.5, 2.4);
  q.walkTo(x + 6.0, 0, { stuck: 0 }); q.form('liquid');
  hold(q, 1, 0, 2);
  assert(q.p.x <= x + 7.4 - R + 1e-6, `a drop got under the film-high wall: x=${q.p.x}`);
  q.form('film'); hold(q, 1, 0, 3);
  assert(q.p.x > x + 8.6, 'film should crawl under the wall');
  // steam from the floor, with the frost off, tops out well below the gallery
  const c = at(l10, x + 5.0, -6.5, 2.4);
  c.sim.teleport(x + 16, -6.5, 0); c.wait(0.3); c.form('liquid'); c.wait(2.2);
  const { maxY } = floatAway(c, () => [0.2, 0]);
  assert(maxY < 0.1 - 0.7, `a cloud reached the gallery: y=${maxY}`);
});

test('l10: the gallery door stays shut until ice is on the heavy plate; its frost refuses every other form', () => {
  const x = X10.cellar;
  const r = at(l10, x + 30.4, 6.1, -3.0);
  r.form('liquid', { expect: false });
  eq(r.p.form, 'ice');
  hold(r, 1, 0, 3.5);
  assert(r.p.x <= x + 38.03 - R + 1e-6, `got through the closed door: x=${r.p.x}`);
  r.walkTo(x + 33.4, 0, { tol: 0.3, stuck: 0 }); r.stop(); r.wait(0.3);
  r.expectSignal('hg', true);
});

test('l10: liquid cannot float through the quench tank, a cloud cannot cross it, and the flames do not touch ice on the floor', () => {
  const x = X10.tank;
  const r = at(l10, x + 9, -6.5, 0);
  for (let i = 0; i < 960 && r.sim.deaths === 0; i++) r.tick(0.4, 0, false);
  assert(r.sim.deaths >= 1, 'a floating drop crossed the flames');
  const c = at(l10, x + 6, -6.5, 0);
  const { maxX } = floatAway(c, () => [1, 0]);
  c.wait(1);
  assert(c.sim.deaths >= 1 || maxX < x + 15.5, `a cloud crossed the tank: x=${maxX}`);
  const q = at(l10, x + 8.6, -6.5, 0);
  q.form('ice');
  q.waitUntil((s, p) => p.y < -7.7, { toward: [x + 11, 0], timeout: 5 });
  q.waitUntil((s, p) => p.x > x + 46, { toward: [x + 48, 0], timeout: 22 });
  eq(q.sim.deaths, 0);
});

test('l10: the sluice is shut unless something heavy rests on the plate, and Mote cannot hold it and walk away', () => {
  const x = X10.tank;
  const r = at(l10, x + 49, -7.9, 0);
  r.form('ice');
  r.walkTo(x + 52.4, 0, { tol: 0.3, stuck: 0, timeout: 6 }); r.stop(); r.wait(1);
  assert(r.sim.level.doors[2].open >= 1, 'the sluice should open for the plate');
  r.walkTo(x + 54.4, 0, { stuck: 0, timeout: 4 });
  r.wait(1.5);
  assert(r.sim.level.doors[2].open < 0.5, 'the sluice must close when the plate is released');
  hold(r, 1, 0, 2.5);
  assert(r.p.x <= x + 55.63 - R + 1e-6, `got through the closed sluice: x=${r.p.x}`);
});

// ------------------------------------------------------------------------------------ l11 Furnace Row
test('l11: the heavy plate on the hot tiles is out of Mote\'s reach', () => {
  const r = at(l11, 24, 0, -2.2);
  r.walkTo(27.8, -2.2, { stuck: 0, timeout: 3 });
  assert(!r.sim.signals.get('p1'), 'Mote pressed the plate on the hot tiles as a drop');
  const q = at(l11, 24, 0, -2.2);
  q.form('ice'); q.walkTo(27.8, -2.2, { stuck: 0, timeout: 3 });
  assert(!q.sim.signals.get('p1') && q.p.form === 'liquid', 'ice must melt before it can press the heavy plate on hot tiles');
  q.form('ice', { expect: false });
  eq(q.p.form, 'liquid');
});

test('l11: door A stays shut until the crate holds the plate, and no cloud gets over or round its wall', () => {
  const r = at(l11, 33, 0, 0);
  hold(r, 1, 0, 2);
  assert(r.p.x <= 36.03 - R + 1e-6, `got through the closed door: x=${r.p.x}`);
  for (const [x, z] of [[20, 0], [24, 3.5], [30, -3.5], [34, 2]]) for (const sz of [-1, 0, 1]) {
    const c = at(l11, x, 0, z);
    const { maxX } = floatAway(c, () => [1, sz]);
    assert(maxX < 36.4, `a cloud from (${x}, ${z}) got over door A: x=${maxX}`);
  }
});

test('l11: the first walls only let a crate through their gaps (a crate goes round the end of each, never through)', () => {
  const r = at(l11, 15.2, 0, -2.2);
  hold(r, 1, 0, 1);
  assert(r.p.x <= 15 - R + 1e-6, 'walked through the first wall');
  const q = at(l11, 21.2, 0, 2.2);
  hold(q, 1, 0, 1);
  assert(q.p.x <= 21 - R + 1e-6, 'walked through the second wall');
});

test('l11: the flames in the dash corridor kill a runner, and they come back when the eight seconds are up', () => {
  const x = X11.dash;
  const r = at(l11, x + 10.5, 0, 0);
  r.dying((q) => q.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3, label: 'burned' }));
  const p = at(l11, x + 5.4, 0, 0);
  p.form('ice'); p.walkTo(x + 5.4, 0, { tol: 0.3 }); p.stop();
  p.expectSignal('dash1', true);
  p.wait(0.2);
  assert(!pieceById(p.sim.level.fires, 'flames1').active, 'the flames should be out while the plate is down');
  p.form('liquid');
  p.walkTo(x + 3.2, 3.5, { stuck: 0 });             // step off the plate and wait it out beside the corridor
  p.wait(8.6);
  assert(p.sim.signals.get('dash1') === false, 'the dash timer never ran out');
  assert(pieceById(p.sim.level.fires, 'flames1').active, 'the flames did not come back');
});

test('l11: the pen is safe: the second field burns only while the timer runs and the first only after it', () => {
  const x = X11.dash;
  const r = at(l11, x + 28.4, 0, 0);
  r.form('ice'); r.walkTo(x + 28.4, 0, { tol: 0.3 }); r.stop();
  r.expectSignal('dash2', true);
  r.wait(0.2);
  assert(!pieceById(r.sim.level.fires, 'flames2a').active && pieceById(r.sim.level.fires, 'flames2d').active, 'timer running: first field out, second burning');
  r.sim.teleport(x + 49, 0, 0); r.wait(10);
  eq(r.sim.deaths, 0, 'Mote in the pen must not burn when the fields swap');
  assert(pieceById(r.sim.level.fires, 'flames2a').active && !pieceById(r.sim.level.fires, 'flames2d').active, 'timer over: first field relit, second out');
  const q = at(l11, x + 51, 0, 0);
  raise(q, ['hp3']);
  q.dying((c) => c.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3, label: 'the second field burns while the timer runs' }));
});

test('l11: a cloud cannot float across a field of flame, with or without the timer', () => {
  const x = X11.dash;
  for (const [sx, sz] of [[1, 0], [1, 1], [1, -1]]) {
    const r = at(l11, x + 0.8, 0, 0);
    const { maxX } = floatAway(r, () => [sx, sz]);
    r.wait(1);
    assert(r.sim.deaths >= 1 || maxX < x + 25.5, `a cloud crossed the first field: x=${maxX}`);
  }
  const q = at(l11, x + 26, 0, 0);
  const { maxX } = floatAway(q, () => [1, 0]);
  q.wait(1);
  assert(q.sim.deaths >= 1 || maxX < x + 50, `a cloud crossed the second field: x=${maxX}`);
});

test('l11: the lift runs only while the pedal is held; a cloud from the floor cannot reach the catwalk; the bed of flame kills', () => {
  const x = X11.lift;
  const r = at(l11, x + 23.5, 0, 0);
  r.wait(20);
  assert(r.p.y < 0.5 && r.sim.level.movers[0].t === 0, 'the lift moved without the pedal');
  for (const [sx, sz] of [[1, 0], [0.3, 0], [0, 0], [1, 0.5]]) for (const x0 of [17, 20, 21.4]) {
    const q = at(l11, x + x0, 0, 0);
    floatAway(q, (p) => [p.y < 5 ? sx * 0.4 : sx, sz]);
    const e = settle(q, 6);
    assert(!e.any.some((a) => a.grounded && a.y > 6 && !a.died), `a cloud from the floor landed on the catwalk (start ${x0}, steer ${sx}): y=${e.y}`);
  }
  // from the top of the crate on the pedal's side, or anywhere else a crate could be shoved to: still short of the catwalk
  for (const x0 of [10, 16.4, 19.6]) for (const sx of [0, 1]) {
    const q = onCrate(l11, 1, x + x0, 0, 0);
    const { maxY } = floatAway(q, () => [sx, 0]);
    assert(maxY < 9 - 0.3, `a cloud from a crate at ${x0} climbed to the catwalk: y=${maxY}`);
    const e = settle(q, 6);
    assert(!e.any.some((a) => a.grounded && a.y > 6 && !a.died), 'a cloud from a crate landed on the catwalk');
  }
  // pedal held, nobody aboard: the lift stays; pedal held and someone aboard: it rises
  const w = at(l11, x + 12, 0, 0);
  placeCrate(w, 1, x + 16.4, 0.07, -2.2);
  w.expectSignal('pump', true);
  w.wait(14);
  assert(w.sim.level.movers[0].t === 0, 'the lift moved with nobody aboard');
  w.sim.teleport(x + 23.7, 0.05, 0); w.wait(5);
  assert(w.p.y > 3, `the lift should rise with the pedal held and someone aboard: y=${w.p.y}`);
  const f = at(l11, x + 36, 6.5, 0);
  f.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'the bed of flame kills' });
  const f2 = at(l11, x + 52, 6.5, 0);
  f2.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'the second bed of flame kills' });
  const d = at(l11, x + 30, 9, 0);
  d.walkTo(x + 30.6, 0, { stuck: 0, timeout: 1 });
});

test('l11: the shutter stays shut until film closes the posts; no cloud gets over its wall', () => {
  const x = X11.control;
  const r = at(l11, x + 3, 0, 0);
  hold(r, 1, 0, 2);
  assert(r.p.x <= x + 5.2 - R + 1e-6, `a drop got under the low wall: x=${r.p.x}`);
  const q = at(l11, x + 10.6, 0, 0);
  hold(q, 1, 0, 2);
  assert(q.p.x <= x + 12.03 - R + 1e-6, `got through the closed shutter: x=${q.p.x}`);
  for (const [x0, z] of [[3, 0], [9, 3.5], [10.6, -3.5]]) for (const sz of [-1, 0, 1]) {
    const c = at(l11, x + x0, 0, z);
    const { maxX } = floatAway(c, () => [1, sz]);
    assert(maxX < x + 12.4, `a cloud from (${x0}, ${z}) got over the shutter: x=${maxX - x}`);
  }
});

test('l11: the gate needs BOTH plates down together for three seconds - neither alone opens it', () => {
  const x = X11.control;
  const near = at(l11, x + 25, 0, 2.4);
  near.wait(4);
  near.expectSignal('pL', true);
  assert(!near.sim.signals.get('gateOpen'), 'the near plate alone opened the gate');
  const far = at(l11, x + 34.4, 0, 0);
  far.form('ice'); far.walkTo(x + 35.6, 0, { tol: 0.3 }); far.stop(); far.wait(4);
  far.expectSignal('pH', true);
  assert(!far.sim.signals.get('gateOpen'), 'the far plate alone opened the gate');
  // the two crates alone, or one crate and the ice, are not enough
  const crates = at(l11, x + 20, 0, -3);
  placeCrate(crates, 2, x + 25, 0.07, 2.4); placeCrate(crates, 3, x + 21.6, 0.07, 2.4); crates.wait(5);
  assert(crates.sim.signals.get('pL') && crates.sim.signals.get('pM'), 'both crates are on their plates');
  assert(!crates.sim.signals.get('gateOpen'), 'the two crates alone opened the gate');
  const one = at(l11, x + 34.4, 0, 0);
  one.form('ice'); one.walkTo(x + 35.6, 0, { tol: 0.3 }); one.stop();
  placeCrate(one, 2, x + 25, 0.07, 2.4); one.wait(5);
  assert(!one.sim.signals.get('gateOpen'), 'one crate and the ice opened the gate');
  // all three, but only for a moment: not enough; then the gate opens and stays open
  const both = at(l11, x + 34.4, 0, 0);
  both.form('ice'); both.walkTo(x + 35.6, 0, { tol: 0.3 }); both.stop();
  placeCrate(both, 2, x + 25, 0.07, 2.4); placeCrate(both, 3, x + 21.6, 0.07, 2.4); both.wait(1.2);
  assert(!both.sim.signals.get('gateOpen'), 'the gate opened before the three seconds were up');
  both.wait(2.5);
  assert(both.sim.signals.get('gateOpen'), 'the gate should open after three seconds');
});

test('l11: ice cannot cross the hot strip to the far plate - it melts, so the crate cannot be sent there instead', () => {
  const x = X11.control;
  const r = at(l11, x + 26, 0, 0);
  r.form('ice');
  r.walkTo(x + 35.6, 0, { stuck: 0, timeout: 5 });
  assert(!r.sim.signals.get('pH'), 'ice reached the far plate across the hot strip');
});

test('l11: the gate flames kill, and a cloud cannot float over or round the curtain', () => {
  const x = X11.control;
  const r = at(l11, x + 38, 0, 0);
  r.dying((q) => q.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3, label: 'burned' }));
  for (const z of [-3, 0, 3]) {
    const c = at(l11, x + 38, 0, z);
    const { maxX } = floatAway(c, () => [1, 0]);
    c.wait(1);
    assert(c.sim.deaths >= 1 || maxX < x + 41, `a cloud crossed the gate curtain: x=${maxX}`);
  }
});

test('l11: the last flames need BOTH timers: one plate alone does not put them out, and they return when either runs out', () => {
  const x = X11.last;
  const fire = (r) => pieceById(r.sim.level.fires, 'last');
  const a = at(l11, x + 6.6, 0, -1.6);
  placeCrate(a, 4, x + 8.2, 0.07, 2.4);
  a.form('ice'); a.walkTo(x + 6.6, -1.6, { tol: 0.3 }); a.stop(); a.wait(0.3);
  a.expectSignal('hA', true);
  assert(fire(a).active, 'the first plate alone put the last flames out');
  const b = at(l11, x + 25, 0, 1.6);
  placeCrate(b, 4, x + 8.2, 0.07, 2.4);
  b.form('ice'); b.walkTo(x + 25, 1.6, { tol: 0.3 }); b.stop(); b.wait(0.3);
  b.expectSignal('hB', true);
  assert(fire(b).active, 'the second plate alone put the last flames out');
  // both plates but no crate on its plate: the flames stay
  const nc = at(l11, x + 6.6, 0, -1.6);
  raise(nc, ['hA']);
  nc.sim.teleport(x + 25, 0, 1.6); nc.wait(0.3); nc.form('ice'); nc.walkTo(x + 25, 1.6, { tol: 0.3 }); nc.stop(); nc.wait(0.3);
  nc.expectSignal('hB', true);
  assert(!nc.sim.signals.get('dashF') && fire(nc).active, 'both heavy plates without the crate on its plate put the flames out');
  // all three: crate set, hold hA, then hB: out; leave: hB's timer (12 s) ends first and the flames come back while hA still runs
  placeCrate(a, 4, x + 8.2, 0.07, 2.4);
  raise(a, ['hA']);
  a.sim.teleport(x + 25, 0, 1.6); a.wait(0.3); a.form('ice'); a.walkTo(x + 25, 1.6, { tol: 0.3 }); a.stop(); a.wait(0.3);
  a.expectSignal('dashF', true);
  assert(!fire(a).active, 'both plates down: the flames should be out');
  a.sim.teleport(x + 22, 0, 3.4); a.wait(1);
  assert(!fire(a).active, 'right after leaving, the flames stay out');
  a.wait(12.5);
  assert(fire(a).active, 'the flames should relight when the second timer runs out');
  const c = at(l11, x + 30, 0, 0);
  c.dying((q) => q.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3, label: 'burned' }));
  for (const x0 of [24, 28.6]) {
    const d = at(l11, x + x0, 0, 0);
    const { maxX } = floatAway(d, () => [1, 0]);
    d.wait(1);
    assert(d.sim.deaths >= 1 || maxX < x + 45, `a cloud from ${x0} crossed the last flames: x=${maxX}`);
  }
});

// ------------------------------------------------------------------------------------ l12 The Great Kiln
const LIT = ['arc', 'arc2', 'inPool', 'plateC'];
const XC = X12.culvert + 22;      // where the far bank of the culvert begins: burner B, the shaft, the lid and the bud

test('l12: the crate cannot cross the pit without the ferry (a cloud can, but a cloud cannot press the plate); the door closes behind a plate you step off', () => {
  const r = at(l12, 4.6, 0, -2.0);
  const { maxX } = floatAway(r, () => [1, 0]);
  settle(r);
  assert(maxX > 12 && r.p.x > 16, 'a cloud should be able to cross the pit');
  assert(r.sim.level.crates[0].body.x < 8, 'the crate is still on the near side');
  assert(r.sim.level.doors[0].open === 0, 'the first door is shut');
  const q = at(l12, 20, 0, 0);
  q.form('ice'); q.walkTo(23, 0, { tol: 0.3, stuck: 0 }); q.stop(); q.wait(1);
  assert(q.sim.level.doors[0].open >= 1, 'the plate should open the door while Mote is on it');
  q.walkTo(19, 0, { stuck: 0 }); q.wait(1);
  assert(q.sim.level.doors[0].open < 0.5, 'the door must close once the plate is released');
  hold(q, 1, 0, 2);
  assert(q.p.x <= 27.03 - R + 1e-6, `got through the closed door: x=${q.p.x}`);
  // no cloud gets over the door's wall, from the floor or from the top of the crate on the plate
  for (const z of [-3, 0, 3]) {
    const c = at(l12, 24.5, 0, z);
    const { maxX } = floatAway(c, () => [1, 0]);
    assert(maxX < 27.4, `a cloud from the plate hall got over the door wall: x=${maxX}`);
  }
  const k = onCrate(l12, 0, 24, 0, 0);
  const top = floatAway(k, () => [1, 0]);
  assert(top.maxX < 27.4 && top.maxY < 9 - 0.3, `a cloud from the crate got over the door wall: x=${top.maxX}, y=${top.maxY}`);
});

test('l12: the pit kills', () => {
  const r = at(l12, 12, 0.6, 0);
  r.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'a fall into the pit is fatal' });
});

test('l12: the ember bar and the film gap really are two different jobs; clouds cannot get round the stokehole walls', () => {
  const r = at(l12, 33, 0, 0);
  hold(r, 1, 0, 3);
  assert(r.p.x <= 36.0 && r.sim.level.embers[0].doused, 'liquid douses the bar but cannot squeeze through the gap');
  const q = at(l12, 33, 0, 0);
  q.form('film'); hold(q, 1, 0, 3);
  assert(q.p.x < 35.4 && !q.sim.level.embers[0].doused, 'film must not douse the ember (and cannot pass it until it is out)');
  for (const z of [-3, 0, 3]) for (const sz of [-1, 0, 1]) {
    const c = at(l12, 33, 0, z);
    const { maxX } = floatAway(c, () => [1, sz]);
    assert(maxX < 36.4, `a cloud got over the ember wall: x=${maxX}`);
  }
});

test('l12: the first burner\'s door stays shut until the electrodes are closed by film', () => {
  const r = at(l12, 49.4, 0, 0);
  hold(r, 1, 0, 2);
  assert(r.p.x <= 51.03 - R + 1e-6, `liquid got through the closed door: x=${r.p.x}`);
  for (const z of [-3, 0, 3]) {
    const c = at(l12, 46, 0, z);
    const { maxX } = floatAway(c, () => [1, 0]);
    assert(maxX < 51.4, `a cloud got over the door wall: x=${maxX}`);
  }
  // the second wall of embers: liquid douses the bar but is stopped by the wall; no cloud gets over it
  const w = at(l12, 41.5, 0, 0);
  hold(w, 1, 0, 3);
  assert(w.p.x <= 44.0 + 1e-6, `liquid got through the second wall: x=${w.p.x}`);
  for (const z of [-3, 0, 3]) {
    const c = at(l12, 41.5, 0, z);
    const { maxX } = floatAway(c, () => [1, 0]);
    assert(maxX < 44.4, `a cloud got over the second wall: x=${maxX}`);
  }
  // once the bar is out, film crawls under the second wall
  w.form('film'); hold(w, 1, 0, 6);
  assert(w.p.x > 45, `film should crawl under the second wall once its bar is out: x=${w.p.x}`);
});

test('l12: only film gets through the grille: a drop and ice stand on it; nothing but the channel passes the wall; a cloud cannot get over it', () => {
  const x = X12.culvert;
  for (const form of ['liquid', 'ice']) {
    const r = at(l12, x + 10, 0, 0);
    if (form === 'ice') r.form('ice');
    r.walkTo(x + 18, 0, { stuck: 0, timeout: 5 });
    r.wait(0.5);
    near(r.p.y, 0, 1e-6, `${form} fell through the grille`);
  }
  const f = at(l12, x + 15, 0, 0);
  f.form('film'); f.wait(1);
  assert(f.p.y < -1, 'film should drop through into the channel');
  const q = at(l12, x + 22, 0, 0);
  hold(q, 1, 0, 3);
  assert(q.p.x <= x + 26.03 - R + 1e-6, `a drop got through the wall: x=${q.p.x}`);
  for (const z of [-4, 0, 4]) {
    const c = at(l12, x + 22, 0, z);
    const { maxX } = floatAway(c, () => [1, 0]);
    assert(maxX < x + 26.4, `a cloud got over the culvert wall: x=${maxX - x}`);
  }
});

test('l12: the shaft is dead until burner B is lit; lit, it lifts a cloud through the lid but no higher than the cliff', () => {
  const x = XC;
  const r = at(l12, x + 47.4, 0, 0);
  const { maxY } = floatAway(r, () => [0.3, 0]);
  assert(maxY < Y12.lid - 0.1, `a cloud climbed the cold shaft: y=${maxY}`);
  const r2 = at(l12, x + 51, 0, 0);
  const dark = floatAway(r2, () => [0, 0]);
  assert(dark.maxY < Y12.lid - 0.1, `a cloud climbed straight up the cold shaft: y=${dark.maxY}`);
  const q = at(l12, x + 51, 0, 0);
  raise(q, ['inPool']);
  const up = floatAway(q, () => [0, 0]);
  assert(up.maxY > Y12.lid, `the lit shaft should lift a cloud through the lid: y=${up.maxY}`);
  // from the lid and from the landing beside it, a full gauge (straight up, or sideways, or both) stays under the cliff
  for (const [sx, sy, sz] of [[51, Y12.lid, 0], [54, Y12.lid, -3], [55, Y12.lid, 3], [55.5, Y12.lid, 0]]) for (const dir of [[0, 0], [0.2, 0], [1, 0], [-1, 0]]) {
    const c = at(l12, x + sx, sy, sz);
    raise(c, ['inPool']);
    const top = floatAway(c, () => dir);
    assert(top.maxY < Y12.well - 0.3, `a cloud from the lid at ${sx} steering ${dir} reached the upper hall: y=${top.maxY}`);
  }
});

test('l12: the bud grows only for a drop, and its ladder is the way up to the upper hall', () => {
  const x = XC;
  const r = atForm(l12, 'ice', x + 54.2, Y12.lid, 0);
  r.wait(1.5);
  eq(r.sim.level.sprouts[0].state, 0);
  const q = at(l12, x + 54.2, Y12.lid, 0);
  q.wait(1.5);
  eq(q.sim.level.sprouts[0].state, 2);
});

test('l12: the ferry over the well runs only on burner A; the second pit kills', () => {
  const x = X12.well;
  const r = at(l12, x + 7.7, Y12.well + 0.05, 0);                 // aboard, but burner A is dark
  r.wait(6);
  eq(r.sim.level.movers[1].t, 0, 'the second ferry moved with burner A dark');
  raise(r, ['arc', 'arc2']);                                       // lit, and the ferry leaves because Mote is aboard
  r.wait(3);
  assert(r.sim.level.movers[1].t > 0, 'the second ferry should run once burner A is lit and Mote is aboard');
  const w = at(l12, x + 2.4, Y12.well, 0);                          // lit, but nobody aboard: it stays
  raise(w, ['arc', 'arc2']);
  w.wait(8);
  eq(w.sim.level.movers[1].t, 0, 'the second ferry left with nobody aboard');
  const f = at(l12, x + 12, Y12.well + 0.5, 0);
  f.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'fall into the pit' });
});

test('l12: the well freezes you, ice sinks onto the plate, and then the frost lifts for good', () => {
  const x = X12.well + 8, y = Y12.well;
  const r = at(l12, x + 35.8, y, 0);
  r.walkTo(x + 38.5, 0, { stuck: 0, timeout: 3 });
  assert(r.p.form === 'ice', 'the frost did not freeze Mote at the well');
  r.waitUntil((s, p) => p.grounded && p.y < y - 4, { toward: [x + 39.75, 0], timeout: 5 });
  r.waitUntil((s) => s.signals.get('plateC'), { toward: [x + 39.75, 0], timeout: 4 });
  r.wait(0.3);
  r.expectSignal('burnC', true);
  r.walkTo(x + 38, 0, { stuck: 0, timeout: 4 }); r.wait(0.2);
  assert(!r.sim.signals.get('plateC'), 'Mote stepped off the plate');
  r.expectSignal('burnC', true);                     // latched: stays lit when Mote steps off
  eq(pieceById(r.sim.level.zones, 'cold').active, false);
  // no way round: a cloud cannot get across the well while it is frosted
  const c = at(l12, x + 34, y, 0);
  c.form('steam', { expect: true });
  floatAway(c, () => [1, 0], 3);
  assert(c.p.x < x + 42.5 || c.p.form !== 'steam', 'a cloud floated across the frosted well');
  // ...nor by climbing first and floating over the frost: from the bank, from the top of the bank, from every side
  for (const x0 of [30, 33, 35.4]) for (const z of [-3, 0, 3]) for (const dir of [[1, 0], [1, 0.5], [1, -0.5]]) {
    const d = at(l12, x + x0, y, z);
    const { maxX } = floatAway(d, () => dir);
    const e = settle(d, 6);
    assert(maxX < x + 43.2 || !e.any.some((a) => a.grounded && a.x > x + 43.2 && !a.died), `a cloud from ${x0} crossed the frosted well: x=${maxX}`);
  }
});

test('l12: the frost landing: ice shoves both crates onto both plates, the door stays open only while both rest there, and no cloud gets over it', () => {
  const x = X12.well, y = Y12.well;
  const door = (r) => r.sim.level.doors.find((d) => d.id === 'doorV');
  const r = at(l12, x + 26, y, 0);
  eq(r.p.form, 'ice');
  r.form('steam', { expect: false });
  eq(r.p.form, 'ice');
  placeCrate(r, 1, x + 34, y + 0.07, -2.2);
  r.wait(1.5);
  assert(door(r).open < 0.5, 'the door opened for one crate on one plate');
  placeCrate(r, 2, x + 34, y + 0.07, 2.2);
  r.wait(1.5);
  assert(door(r).open >= 1, 'the door should open with both crates on both plates');
  placeCrate(r, 2, x + 30, y + 0.07, 2.2);
  r.wait(1.5);
  assert(door(r).open < 0.5, 'the door must close when a crate leaves its plate');
  // with the frost off, a cloud still cannot get over the door's wall (from the floor, or from the top of a crate)
  for (const z of [-3, 0, 3]) for (const dir of [[1, 0], [0, 0]]) {
    const c = at(l12, x + 33, y, z);
    raise(c, ['plateC']);
    const { maxX, maxY } = floatAway(c, () => dir);
    assert(maxX < x + 37.4 && maxY < y + 15, `a cloud got over the frost-landing door: x=${maxX}, y=${maxY - y}`);
  }
  const k = onCrate(l12, 1, x + 34, y, -2.2);
  raise(k, ['plateC']);
  const top = floatAway(k, () => [1, 0]);
  assert(top.maxX < x + 37.4, `a cloud from the crate got over the door: x=${top.maxX}`);
});

test('l12: burner C wakes a gale: a drop and a cloud are blown back, ice and film are not', () => {
  const x = X12.gale, y = Y12.gale;
  const r = at(l12, x + 3, y, 2.5);
  raise(r, ['plateC']);
  hold(r, 1, 0, 5);
  assert(r.p.x < x + 8, `a drop walked into the gale: x=${r.p.x}`);
  const c = at(l12, x + 3, y, 2.5);
  raise(c, ['plateC']);
  const { maxX } = floatAway(c, () => [1, 0], 5);
  assert(maxX < x + 12, `a cloud flew into the gale: x=${maxX}`);
  const f = at(l12, x + 3, y, 2.5);
  raise(f, ['plateC']);
  f.form('film'); hold(f, 1, 0, 6);
  assert(f.p.x > x + 12, 'film should crawl through the gale');
});

test('l12: the nook shutter stays shut unless something rests on its plate; the glass takes a run-up', () => {
  const x = X12.gale, y = Y12.gale;
  const r = at(l12, x + 24, y, 0);
  raise(r, ['plateC']);
  hold(r, 1, 0, 2);
  assert(r.p.x <= x + 26.03 - R + 1e-6, `got through the closed nook shutter: x=${r.p.x}`);
  const q = at(l12, x + 36.4, y, 0);
  raise(q, ['plateC']);
  q.form('ice'); hold(q, 1, 0, 2);
  assert(!pieceById(q.sim.level.panes, 'paneG').broken, 'the glass broke from a two-metre run-up');
  for (const z of [-3, 0, 3]) {
    const c = at(l12, x + 24, y, z);
    raise(c, ['plateC']);
    const { maxX } = floatAway(c, () => [1, 0]);
    assert(maxX < x + 26.4, `a cloud got over the nook shutter wall: x=${maxX - x}`);
  }
});

test('l12: the chimney stays cold until all three burners are lit, and the kiln door stays shuttered', () => {
  const x = X12.throat, y = Y12.throat;
  const r = at(l12, x + 7, y, 0);
  r.walkTo(x + 10.4, 0, { stuck: 0, timeout: 3 });
  assert(r.p.form === 'liquid', 'the chimney drew before the kiln was lit');
  raise(r, ['arc', 'arc2', 'inPool']);
  r.walkTo(x + 7, 0, { stuck: 0 }); r.walkTo(x + 10.4, 0, { stuck: 0, timeout: 3 });
  assert(r.p.form === 'liquid', 'two burners are not enough');
  const q = at(l12, X12.crown + 86, Y12.crown - 14, 0);
  q.wait(1);
  assert(!q.sim.completed, 'the exit opened before the kiln was lit');
});

test('l12: the jets - a cloud on the wrong side is stopped under the tray, with the open lane right there; one that crosses into the flames burns', () => {
  const x = X12.throat, y = Y12.throat;
  const start = (zStart, yStart) => {
    const r = at(l12, x + 7, y, 0);
    raise(r, LIT);
    r.sim.teleport(x + 10.6, y + yStart, zStart); r.wait(0.4);
    return r;
  };
  const r = start(-2, 0);
  eq(r.p.form, 'steam', 'the lit chimney boils Mote');
  hold(r, 0, -0.2, 4);
  assert(r.p.y < y + 3.3 && r.sim.deaths === 0, `wrong side: y=${r.p.y - y}, deaths=${r.sim.deaths} (expected to be held under the tray)`);
  r.waitUntil((s, p) => p.z > 1, { mz: 1, timeout: 3, label: 'across to the open lane' });
  r.waitUntil((s, p) => p.y > y + 4.9, { toward: [x + 12.4, 1.4], timeout: 4, label: 'free to climb again' });
  assert(r.p.y > y + 4.9 && r.sim.deaths === 0, `open lane: y=${r.p.y - y}, deaths=${r.sim.deaths}`);
  // the second tray is on the other side
  const s2 = start(2, 5.2);
  hold(s2, 0, 0.2, 4);
  assert(s2.p.y < y + 7.4 && s2.sim.deaths === 0, `wrong side under jet 2: y=${s2.p.y - y}, deaths=${s2.sim.deaths}`);
  // a jet at flame height burns
  const q = start(0.9, 2.9);
  for (let i = 0; i < 360 && q.sim.deaths === 0; i++) q.tick(0, -1, false);
  assert(q.sim.deaths >= 1, 'crossing into the first jet at flame height did not burn');
  // every tray is at least a body above the previous jet, and the open lanes are at least 5 m wide
  const jets = l12.pieces.filter((p) => p.type === 'fire' && /^jet/.test(p.id));
  eq(jets.length, 5);
  for (const j of jets) assert(Math.min(Math.abs(j.box[2]), Math.abs(j.box[5])) >= 1.0, `${j.id} comes closer than 1 m to the centre line`);
});

test('l12: the pilot light wants every form, in order - and the shutter stays shut until it has them all', () => {
  const x = X12.crown, y = Y12.crown;
  // a drop at the doorway of embers
  const r = at(l12, x + 6, y, 0);
  r.form('film'); hold(r, 1, 0, 4);
  assert(r.p.x < x + 7.6 && !pieceById(r.sim.level.embers, 'pilotEmbers').doused, 'film got through the embers');
  const q = at(l12, x + 6, y, 0);
  q.form('ice'); hold(q, 1, 0, 3);
  assert(q.p.x < x + 7.6, 'ice got through the embers');
  // a drop cannot get under the low wall; film can
  const w = at(l12, x + 11, y, 0);
  hold(w, 1, 0, 2);
  assert(w.p.x <= x + 12 - R + 1e-6, `a drop got under the low wall: x=${w.p.x - x}`);
  // the sensor above the ledge trips for a cloud only
  const s = at(l12, x + 22, y + 4.9, -2.8);
  s.sim.teleport(x + 22, y + 4.9, -2.8); s.tick();
  assert(!s.sim.signals.get('steamP'), 'a drop tripped the cloud sensor');
  const c = at(l12, x + 18.8, y, -2.8);
  floatAway(c, () => [0.5, 0], 6);
  const cs = at(l12, x + 18.8, y, -2.8);
  cs.form('steam');
  cs.waitUntil((s2) => s2.signals.get('steamP'), { toward: [x + 22, -2.8], timeout: 6, label: 'a cloud trips the sensor' });
  // the shutter: one or two of the three are not enough
  const d = at(l12, x + 30, y, 0);
  raise(d, ['arcP']);
  assert(!d.sim.signals.get('ignite'), 'one of three lit the pilot light');
  raise(d, ['steamP']);
  assert(!d.sim.signals.get('ignite'), 'two of three lit the pilot light');
  hold(d, 1, 0, 2);
  assert(d.p.x <= x + 33.03 - R + 1e-6, `got through the closed shutter: x=${d.p.x - x}`);
  raise(d, ['hpP']);
  assert(d.sim.signals.get('ignite'), 'all three should light the pilot light');
  for (const z of [-3, 0, 3]) {
    const e = at(l12, x + 30, y, z);
    const { maxX } = floatAway(e, () => [1, 0]);
    assert(maxX < x + 33.4, `a cloud got over the shutter wall: x=${maxX - x}`);
  }
});

test('l12: nothing but the slide breaks the final glass', () => {
  const x = X12.crown;
  const r = at(l12, x + 64, Y12.crown - 14, 0);
  r.form('ice', { expect: false });
  hold(r, 1, 0, 2);
  assert(!pieceById(r.sim.level.panes, 'glass1').broken || r.p.x > x + 67.3, 'unexpected');
  const q = at(l12, x + 62, Y12.crown - 14, 0);
  hold(q, 1, 0, 3);
  assert(!pieceById(q.sim.level.panes, 'glass1').broken, 'liquid broke the glass');
});
