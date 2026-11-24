// Level tests for the first three Fire levels, expanded to five-area journeys: f01 "First Light",
// f02 "Mind the Drip", f03 "Kindling". The positive routes (solve / solveAll) live in
// tests/solutions/ and are run by campaigns.test.js; this file proves
//   - the shape the level standard asks for (DESIGN-V2.md section 1): five named areas, a brazier
//     opening each, a route of 60-120 s, every checkpoint reached in order;
//   - that every gate really needs the thing the level teaches (cannot be skipped);
//   - that every water hazard really puts Cinder out;
//   - that the level cannot be made unwinnable (dying at every brazier changes nothing; the only
//     wood the player must not burn cannot be burnt).

import { test, assert, eq, near } from './lib/harness.js';
import { play } from './lib/play.js';
import { at, hold } from './lib/fire.js';
import fire from '../src/sim/elements/fire.js';
import f01 from '../src/levels/f01.js';
import f02 from '../src/levels/f02.js';
import f03 from '../src/levels/f03.js';
import * as sol01 from './solutions/f01.js';
import * as sol02 from './solutions/f02.js';
import * as sol03 from './solutions/f03.js';

const R = fire.formDefs.ember.r;
const RB = fire.formDefs.blaze.r;
const by = (list, id) => list.find((q) => q.id === id);
const door = (r, id) => by(r.sim.level.doors, id);
const drip = (r, id) => by(r.sim.level.drips, id);
const spray = (r, id) => by(r.sim.level.sprinklers, id);
const woods = (r, prefix) => r.sim.level.woods.filter((w) => w.id && w.id.startsWith(prefix));
const lit = (r, ids) => { for (const q of r.sim.level.lanterns) if (ids.includes(q.id)) q.lit = true; };

/**
 * Run and jump toward +x from where the hero stands. Returns { stoodX, died }: the furthest x at
 * which it STOOD on something (a hero falling into a pit still drifts forward, which is not a crossing).
 */
function leap(r, seconds = 3, opts = {}) {
  let stoodX = -Infinity;
  const d0 = r.sim.deaths, n = Math.round(seconds * 120);
  for (let i = 0; i < n && r.sim.deaths === d0; i++) {
    r.tick(1, 0, i >= (opts.jumpAt || 20) && i < (opts.jumpAt || 20) + 60, opts.special && i === opts.special ? r.p.form : null);
    if (r.p.grounded && r.sim.deaths === d0) stoodX = Math.max(stoodX, r.p.x);
  }
  return { stoodX, maxX: stoodX, died: r.sim.deaths > d0 };
}

/** Wait (up to `seconds`) for Cinder to be put out; returns the cause or null. */
function dies(r, seconds, mx = 0, mz = 0) {
  const n = Math.round(seconds * 120);
  for (let i = 0; i < n && r.sim.deaths === 0; i++) r.tick(mx, mz, false);   // (at() settles for 0.3 s, which may be enough)
  if (r.sim.deaths === 0) return null;
  return r.events.filter((e) => e.type === 'respawn').pop().cause;
}

const JOURNEYS = [
  { id: 'f01', data: f01, sol: sol01 },
  { id: 'f02', data: f02, sol: sol02 },
  { id: 'f03', data: f03, sol: sol03 },
];

// ------------------------------------------------------------------------------------ the journey
for (const { id, data, sol } of JOURNEYS) {
  test(`${id}: a journey of five named areas, each opened by a brazier`, () => {
    const a = data.areas;
    assert(Array.isArray(a) && a.length >= 4 && a.length <= 5, `${id} needs 4-5 areas, has ${a && a.length}`);
    eq(new Set(a.map((q) => q.name)).size, a.length, 'area names are unique');
    const exit = data.pieces.find((p) => p.type === 'exit');
    a.forEach((q, i) => {
      assert(typeof q.name === 'string' && q.name.length > 2 && q.name.length <= 28, `area ${i} name`);
      assert(Array.isArray(q.box) && q.box.length === 4 && q.box[2] > q.box[0] && q.box[3] > q.box[1], `area ${q.name}: box is [x0, z0, x1, z1]`);
      if (i) eq(q.box[0], a[i - 1].box[2], `area ${q.name} starts where ${a[i - 1].name} ends`);
      const bz = data.pieces.filter((p) => p.type === 'brazier' && p.pos[0] >= q.box[0] && p.pos[0] <= q.box[0] + 12 && p.pos[2] >= q.box[1] && p.pos[2] <= q.box[3]);
      assert(bz.length >= 1, `area ${q.name} has no brazier in its first 12 m`);
    });
    assert(a[0].box[0] <= data.spawn[0], 'the first area holds the spawn');
    assert(a[a.length - 1].box[2] >= exit.pos[0], 'the last area holds the exit');
  });

  test(`${id}: every area's checkpoint is reached, in order, on the reference route`, () => {
    const r = play(data); sol.solve(r);
    const order = [];
    for (const e of r.events.filter((q) => q.type === 'checkpoint')) {
      const area = data.areas.findIndex((q) => e.x >= q.box[0] && e.x < q.box[2]);
      assert(area >= 0, `checkpoint at x=${e.x} is in no area`);
      order.push(area);
    }
    for (let i = 0; i < data.areas.length; i++) assert(order.includes(i), `no checkpoint lit in area ${i} (${data.areas[i].name})`);
    for (let i = 1; i < order.length; i++) assert(order[i] >= order[i - 1], `area order broke: ${order.join(',')}`);
    // and each one holds the respawn when the area is entered: the first brazier of an area comes before the next area's
    const firsts = data.areas.map((q, i) => order.indexOf(i));
    for (let i = 1; i < firsts.length; i++) assert(firsts[i] > firsts[i - 1], `area ${i} was entered before area ${i - 1}'s brazier`);
  });

  test(`${id}: the reference route takes 60-120 s (solveAll too)`, () => {
    const a = play(data); sol.solve(a);
    const ta = a.result().timeMs / 1000;
    assert(ta >= 60 && ta <= 120, `solve() takes ${ta.toFixed(1)} s`);
    const b = play(data); sol.solveAll(b);
    const tb = b.result().timeMs / 1000;
    assert(tb >= ta && tb <= 120, `solveAll() takes ${tb.toFixed(1)} s`);
    assert(a.sim.deaths === 0 && b.sim.deaths === 0, 'no deaths on the route');
  });

  test(`${id}: the level cannot be made unwinnable: dying at every brazier changes nothing`, () => {
    // Whatever is permanent (lit lanterns, burnt wood, spent fuses) stays as the player left it, and
    // Cinder wakes at the brazier it just lit with a full gauge. Fall off the world at every brazier
    // the reference route reaches, then carry on: the route must still complete.
    for (const fn of ['solve', 'solveAll']) {
      const r = play(data);
      const orig = r.expect.bind(r);
      let falls = 0;
      r.expect = (pred, label = '') => {
        orig(pred, label);
        if (/brazier|waystation/i.test(label)) {
          falls++;
          r.dying((q) => { q.sim.teleport(q.p.x, -60, q.p.z); q.wait(1.2); });
          orig((s) => s.checkpoint !== null && s.player.respawnT <= 0, 'woke up');
          // the fall was on purpose: take it off the books so the script's own "no deaths" checks stay meaningful
          r.sim.deaths -= 1; r._deaths = r.sim.deaths;
        }
        return r;
      };
      sol[fn](r);
      assert(r.sim.completed, `${fn} did not complete after dying at every brazier`);
      assert(falls >= data.areas.length, `only ${falls} brazier checks in ${fn}`);
      eq(r.events.filter((e) => e.type === 'respawn' && e.cause === 'fall').length, falls, 'every fall was a real respawn');
      eq(r.sim.deaths, 0, 'and nothing else killed Cinder');
    }
  });
}

// ------------------------------------------------------------------------------------ f01
test('f01: only the ember form is offered', () => {
  const r = play(f01);
  r.form('blaze', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'locked');
});

test('f01 area 1: no lantern lights from a walk down the middle, and door A is a 3 m wall until they all burn', () => {
  const r = at(f01, 5, 0, 0);
  r.walkTo(33.4, 0);
  for (const q of r.sim.level.lanterns.filter((l) => l.id.startsWith('lampA'))) assert(!q.lit, `${q.id} lit without being touched`);
  eq(door(r, 'doorA').open, 0);
  const e = hold(at(f01, 32.4, 0, 0), 1, 0, 3, { jump: true });
  assert(e.maxX < 34.05 - R + 1e-6, `got past door A without the lanterns: x=${e.maxX}`);
});

test('f01 area 1: the plinth and pedestal lanterns cannot be lit from the floor; each of the four lanterns is needed', () => {
  const r = at(f01, 24, 0, 0.9);
  hold(r, 0, 0, 2, { jump: true });
  assert(!by(r.sim.level.lanterns, 'lampA3').lit, 'the plinth lantern lit from the floor');
  const q = at(f01, 30, 0, -0.9);
  hold(q, 0, 0, 2, { jump: true });
  assert(!by(q.sim.level.lanterns, 'lampA4').lit, 'the pedestal lantern lit from the floor');
  for (const skip of ['lampA1', 'lampA2', 'lampA3', 'lampA4']) {
    const s = at(f01, 32, 0, 0);
    lit(s, ['lampA1', 'lampA2', 'lampA3', 'lampA4'].filter((x) => x !== skip));
    s.wait(3);
    eq(door(s, 'doorA').open, 0, `door A opened with ${skip} still cold`);
    lit(s, [skip]);
    s.waitUntil((x) => door(s, 'doorA').open >= 1, { timeout: 4, label: 'door A opens' });
  }
});

test('f01 area 2: the first gap needs a jump, and the rail platform is the only way over the wide one', () => {
  const r = at(f01, 50.6, 1.4, 0);
  assert(leap(r, 3, { jumpAt: 9999 }).died, 'walking off the shelf edge into the 3 m gap should fall');
  const m = at(f01, 62.5, 1.0, -3.0);
  by(m.sim.level.movers, 'ferry').speed = 1e-9;                         // the platform never leaves
  const j = leap(m, 3, { jumpAt: 15 });
  assert(j.died && j.maxX < 80.8 - R, `crossed the 13 m gap without the rail platform: x=${j.maxX}`);
  // ridden for real, it carries Cinder across and comes home when it is empty
  const p = at(f01, 62.5, 1.0, -3.0);
  p.waitUntil((s, q) => q.grounded && q.x > 64.3 && Math.abs(q.y - 1) < 0.1, { toward: [65.6, -3.0], jump: true, timeout: 3 });
  p.waitUntil((s) => by(s.level.movers, 'ferry').t > 0.99, { timeout: 10 });
  assert(p.p.x > 77, 'the platform carried Cinder across');
  p.jumpTo(81.4, -2.6, { tol: 0.4 });
  p.waitUntil((s) => by(s.level.movers, 'ferry').t < 0.01, { timeout: 12, label: 'the platform comes home' });
});

test('f01 area 3: the ledge lanterns cannot be lit from the floor; the lift waits for them and never strands Cinder', () => {
  const g2 = at(f01, 103.5, 0, -0.8); hold(g2, 0, 0, 2, { jump: true });
  assert(!by(g2.sim.level.lanterns, 'lampG2').lit, 'the ledge lantern lit from the floor');
  const g3 = at(f01, 108, 0, 0.8); hold(g3, 0, 0, 2, { jump: true });
  assert(!by(g3.sim.level.lanterns, 'lampG3').lit, 'the hung lantern lit from the floor');
  // a cold gallery: the lift does not move for Cinder
  const r = at(f01, 112.5, 0, 0); r.wait(2);
  assert(r.p.y < 0.05, 'the lift rose without the lanterns');
  const trench = at(f01, 93.4, 0, 0.4);
  assert(leap(trench, 3, { jumpAt: 9999 }).died, 'the trench is walked across');
  // all lit: it rises while Cinder stands on it, there is no stepping back off the top, and it comes home when empty
  const s = at(f01, 112.5, 0, 0);
  lit(s, ['lampG1', 'lampG2', 'lampG3']);
  s.waitUntil((x, p) => p.y > 2.95, { timeout: 6, label: 'the lift rises' });
  hold(s, -1, 0, 2, { jump: true });
  assert(s.p.x > 111, `Cinder stepped back off the top of the lift: x=${s.p.x}`);
  hold(s, 1, 0, 1.2);
  s.waitUntil((x) => by(x.level.movers, 'lift').t < 0.01, { timeout: 8, label: 'the lift sits down again' });
  // stepping off at the bottom mid-ride does not strand anyone either
  const u = at(f01, 112.5, 0, 0);
  lit(u, ['lampG1', 'lampG2', 'lampG3']);
  u.waitUntil((x, p) => p.y > 0.8, { timeout: 4 });
  hold(u, -1, 0, 1.0);
  u.waitUntil((x) => by(x.level.movers, 'lift').t < 0.01, { timeout: 8, label: 'lift comes back for a second try' });
});

test('f01 area 4: the wick gate opens when the flame arrives, and not before', () => {
  const r = at(f01, 146.4, 3, -0.5);
  const e = hold(r, 1, 0, 3, { jump: true });
  assert(e.maxX < 148.05 - R + 1e-6, `got past the wick gate: x=${e.maxX}`);
  eq(by(r.sim.level.fuses, 'fuseC').state, 0, 'standing at the gate does not light the fuse (only its frayed end does)');
  const q = at(f01, 121, 3, -3.2);
  const f = by(q.sim.level.fuses, 'fuseC');
  eq(f.state, 1, 'the frayed end is lit by touch');
  const t0 = q.t - f.d / f.rate;
  eq(door(q, 'doorC').open, 0);
  q.waitUntil((s) => door(q, 'doorC').open >= 1, { timeout: 14 });
  near(q.t - t0, f.len / f.rate + 0.6, 0.25, 'fuse length / rate, plus the door travel');
});

test('f01 area 4: the dash door shuts again, the fuse re-arms, and the door never shuts Cinder in', () => {
  const r = at(f01, 151, 3, 2.9);
  eq(by(r.sim.level.fuses, 'fuseG').state, 1, 'short fuse lit');
  r.waitUntil((s) => door(r, 'doorG').open >= 1, { timeout: 4 });
  r.wait(2.6);
  eq(door(r, 'doorG').open, 0, 'shut again for a dawdler');
  const e = hold(at(f01, 157.6, 3, 3.1), 1, 0, 2, { jump: true });
  assert(e.maxX < 159.05 - R + 1e-6, 'walked through the shut dash door');
  r.walkTo(149.6, 0.4);                                           // away from the frayed end (standing on it relights it)
  r.waitUntil((s) => by(s.level.fuses, 'fuseG').state === 0, { timeout: 5, label: 'fuse grows back' });
  r.wait(1); eq(by(r.sim.level.fuses, 'fuseG').state, 0, 'and stays ready until it is touched again');
  const q = at(f01, 161.4, 3, 3.4);
  q.wait(1.5);
  assert(door(q, 'doorG').open >= 1, 'the alcove door must stay down while Cinder is inside');
  q.walkTo(157.6, 3.1);
});

test('f01 area 5: the kiln is shut until the flame has burnt the kindling, and the flame needs both lanterns', () => {
  const r = at(f01, 177.5, 3, 2.6);
  r.expectSignal('lampK1', true); r.expectSignal('kilnLit', false);
  r.wait(3);
  eq(by(r.sim.level.fuses, 'wickK').state, 0, 'one lantern does not light the wick');
  eq(by(r.sim.level.woods, 'pyre').state, 0, 'and the kindling stays whole');
  assert(!r.sim.level.exits[0].open, 'the kiln door is shut');
  // an ember cannot burn it, climb over it or go round it
  const e = hold(at(f01, 186, 3, 0), 1, 0, 4, { jump: true });
  assert(e.maxX < 189.2 - R + 1e-6, `an ember got past the kindling: x=${e.maxX}`);
  eq(by(r.sim.level.woods, 'pyre').state, 0);
  const t = at(f01, 193, 3, 0); t.wait(0.5);
  assert(!t.sim.completed, 'the shut kiln door completed the level');
  // both lanterns: the wick runs, the kindling burns, the kiln opens
  const q = at(f01, 176, 3, 0);
  lit(q, ['lampK1', 'lampK2']);
  const t0 = q.t;
  q.waitUntil((s) => by(s.level.fuses, 'wickK').state === 1, { timeout: 1, label: 'the wick catches' });
  q.waitUntil((s) => by(s.level.woods, 'pyre').state > 0, { timeout: 8, label: 'the kindling catches' });
  q.waitUntil((s) => s.level.exits[0].open, { timeout: 8, label: 'the kiln opens' });
  assert(q.t - t0 > 3, 'the payoff takes a few seconds to build');
});

test('f01 area 5: the trench is a jump, and the high lantern needs the ledges', () => {
  const r = at(f01, 171, 3, 0.4);
  assert(leap(r, 3, { jumpAt: 9999 }).died, 'walked across the trench');
  const k = at(f01, 185.3, 3, -0.9); hold(k, 0, 0, 2, { jump: true });
  assert(!by(k.sim.level.lanterns, 'lampK2').lit, 'the top lantern lit from the floor');
});

test('f01: the side walls keep Cinder in the level: no standing place is within a jump of a wall top', () => {
  // the very first screen: running sideways off the spawn platform cannot leave the floor
  for (const mz of [-1, 1]) {
    const e = hold(at(f01, 0, 0, 0), 0, mz, 3, { jump: true });
    assert(e.minY > -0.5, `stepped off the spawn platform (minY ${e.minY})`);
    assert(e.minZ > -5.4 && e.maxZ < 5.4, `left the spawn screen sideways (z ${e.minZ}..${e.maxZ})`);
  }
  // every side wall (a brick block along z = +-5..5.5) is taller than any floor, step, slab or ledge it stands beside, by more than the
  // highest an ember can jump (1.85 m): from the top of the lantern ledges nothing can be stepped onto and walked off along
  const isWall = (p) => p.type === 'block' && Math.abs(p.box[5] - p.box[2]) <= 0.55 && Math.min(Math.abs(p.box[2]), Math.abs(p.box[5])) >= 5 - 1e-9 && p.box[4] - p.box[1] >= 3;
  const walls = f01.pieces.filter(isWall);
  assert(walls.length >= 10, 'the side walls are there');
  for (const w of walls) {
    const stands = f01.pieces.filter((p) => p.type === 'block' && !isWall(p) && p.box[3] > w.box[0] + 0.01 && p.box[0] < w.box[3] - 0.01 && (p.box[2] <= -4.4 || p.box[5] >= 4.4) && Math.abs(p.box[2]) <= 5 && Math.abs(p.box[5]) <= 5 && p.box[4] < w.box[4]);
    for (const b of stands) assert(w.box[4] - b.box[4] > 1.85 + 0.2, `the wall at x ${w.box[0]}..${w.box[3]} (top ${w.box[4]}) is within a jump of a standing place at y ${b.box[4]} (x ${b.box[0]}..${b.box[3]})`);
  }
  // and played out: on the top of the highest ledge in the kiln hall, running at either wall and jumping never gets Cinder onto it
  for (const mz of [-1, 1]) {
    const r = at(f01, 185.2, 6.9, mz * 3.3);
    let onWall = false;
    for (let i = 0; i < 360; i++) { r.tick(0, mz, i % 70 < 30); if (r.p.grounded && Math.abs(r.p.z) > 4.9) onWall = true; }
    assert(!onWall, 'stood on a side wall of the kiln hall');
  }
});

test('f01: the only wood is the kiln kindling and it can only be lit by the wick (no form here can burn)', () => {
  const w = f01.pieces.filter((p) => p.type === 'wood');
  eq(w.length, 1);
  assert(w[0].on === 'wickEnd', 'the kindling is lit by a signal');
  assert(f01.forms.length === 1 && f01.forms[0] === 'ember');
});

// ------------------------------------------------------------------------------------ f02
test('f02: only the ember form is offered; no heat is ever needed', () => {
  const r = play(f02);
  r.form('blaze', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'locked');
});

test('f02: every pool, pond, tank and flood really puts Cinder out', () => {
  const pools = play(f02).sim.level.pools;
  assert(pools.length >= 12, `only ${pools.length} pools`);
  for (const q of pools) {
    const b = q.box;
    let cause = null;
    for (const z of [b[2] + 0.5, (b[2] + b[5]) / 2, b[5] - 0.5, -4.3, 4.3]) {
      if (z < b[2] || z > b[5]) continue;
      const r = at(f02, (b[0] + b[3]) / 2, 0.3, z);
      cause = dies(r, 1.2);
      if (cause) break;
    }
    eq(cause, 'water', `walking into ${q.id} must put Cinder out`);
  }
});

test('f02: a pool puts Cinder out and wakes it at the last brazier', () => {
  const r = at(f02, 4, 0, 0);                                    // lights the first brazier
  r.sim.teleport(47.6, 0.3, 0); r.wait(0.5);
  eq(r.sim.deaths, 1);
  eq(r.events.filter((e) => e.type === 'respawn').pop().cause, 'water');
  near(r.p.x, 4, 1e-9, 'back at the first brazier');
});

test('f02 area 1: the leak is harmless to look at; the pipe over the hall drops in a column', () => {
  const r = at(f02, 17, 0, 0);
  assert(dies(r, 2.2) === 'water', 'standing under the free pipe is fatal within a period');
  const q = at(f02, 17, 0, 1.6);
  eq(dies(q, 6), null, 'but a metre and a half to the side is safe');
  const l = at(f02, 8, 0, -2.8);
  eq(dies(l, 4), null, 'the leak into the basin never touches the floor beside it');
});

test('f02 area 1: the big puddle cannot be walked round or across; the narrow ones can be hopped', () => {
  const r = at(f02, 40, 0, 0);
  const e = hold(r, 1, 0, 1.5);
  assert(r.sim.deaths > 0, 'walked across the 3.2 m pool');
  const j = leap(at(f02, 44.4, 0, 0), 3, { jumpAt: 20 });
  assert(!j.died && j.maxX > 49.2, `a run and jump should clear the 3.2 m pool (maxX=${j.maxX})`);
  for (const z of [-4.3, 0, 4.3]) {
    const q = at(f02, 44.4, 0, z);
    assert(leap(q, 2, { jumpAt: 9999 }).died, 'walking at the pool fell in');
  }
});

test('f02 area 2: the pond is far wider than a jump; every stone hop is short', () => {
  const r = at(f02, 61.4, 0, 0);
  const j = leap(r, 4, { jumpAt: 30 });
  assert(j.died && j.maxX < 91.6, `jumped the whole pond: maxX=${j.maxX}`);
  const second = leap(at(f02, 93.4, 0, 0), 4, { jumpAt: 30 });
  assert(second.died && second.maxX < 106, `jumped the whole second pond: maxX=${second.maxX}`);
  const pond = f02.pieces.find((p) => p.id === 'pool2').box;
  assert(pond[3] - pond[0] > 25, 'the first pond is wider than any jump');
  const stones = f02.pieces.filter((p) => p.type === 'block' && p.box[1] === -1.2 && p.box[0] > pond[0] && p.box[3] < pond[3]).sort((a, b) => a.box[0] - b.box[0]);
  for (let i = 1; i < stones.length; i++) {
    const gap = stones[i].box[0] - stones[i - 1].box[3];
    assert(gap < 3.6, `gap between stones ${i - 1} and ${i} is ${gap.toFixed(2)} m`);
  }
});

test('f02 area 3: each pipe over the causeway puts Cinder out in every lane, so it cannot be squeezed past', () => {
  const stations = [['d1a', 120.5], ['d2a', 123], ['d3a', 125.5], ['e1a', 137.5], ['e2a', 145.5]];
  for (const [id, x] of stations) {
    const per = drip(play(f02), id).period;
    for (const z of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const r = at(f02, x, 0, z);
      eq(dies(r, 2 * per + 1), 'water', `pipe ${id} at z=${z}`);
    }
  }
});

test('f02 area 3: the tanks are only crossable on the causeway, and the pad between the slow pipes is safe', () => {
  const r = at(f02, 117.6, 0, 3);
  assert(leap(r, 3, { jumpAt: 40 }).died, 'crossed the tank beside the causeway');
  const q = at(f02, 141.5, 0, 0);
  eq(dies(q, 12), null, 'a long wait on the pad between the pipes is safe');
  const offs = play(f02).sim.level.drips.filter((d) => /^d\d[ab]$/.test(d.id) && d.id.endsWith('a')).map((d) => d.offset);
  eq(new Set(offs).size, 3, 'the three pipes of the first causeway all have different phases');
});

test('f02 area 4: the pulsing spray puts Cinder out while it is on, cannot be jumped, and goes off again', () => {
  const r = at(f02, 160, 0, 0);
  r.waitUntil((s) => spray(r, 'pulsed').wet && spray(r, 'pulsed').clock < 0.2, { timeout: 5 });
  assert(leap(r, 2, { jumpAt: 5 }).died, 'ran through the live spray');
  const q = at(f02, 160, 0, 0);
  q.waitUntil((s) => !spray(q, 'pulsed').wet, { timeout: 5 });
  q.waitUntil((s) => spray(q, 'pulsed').wet, { timeout: 5 });
  q.waitUntil((s) => !spray(q, 'pulsed').wet, { timeout: 5 });
  const cyc = play(f02).sim.level.sprinklers.find((s) => s.id === 'pulsed');
  near(cyc.period * cyc.duty, 1.35, 1e-9, 'sprays 1.35 s of every 3');
});

test('f02 area 4: the valve curtain puts Cinder out unless the fuse has shut it for a moment, and it comes back on', () => {
  const r = at(f02, 176.2, 0, 0);
  assert(spray(r, 'curtain').wet);
  assert(leap(r, 2, { jumpAt: 5 }).died, 'ran through the live curtain');
  const q = at(f02, 172.1, 0, -2.6);
  eq(by(q.sim.level.fuses, 'fuseV').state, 1);
  q.waitUntil((s) => !spray(q, 'curtain').wet, { timeout: 8 });
  const t0 = q.t;
  q.waitUntil((s) => spray(q, 'curtain').wet, { timeout: 4 });
  near(q.t - t0, 2.4, 0.05, 'the valve stays shut for the regrow time');
  const k = at(f02, 172.1, 0, -2.6);
  k.waitUntil((s) => !spray(k, 'sprayT').wet, { toward: [172.9, 3.1], timeout: 8 });
  k.walkTo(177, 3.1, { slow: false });
  k.waitUntil((s) => s.deaths > 0, { timeout: 5, label: 'the spray comes back on the dawdler' });
});

test('f02 area 5: the flood cannot be crossed before the boiler, the raft needs the spray to be off, and the boiler opens everything', () => {
  // no jumping the last stretch from the island
  const isl = at(f02, 247.4, 0, 2.1);
  assert(leap(isl, 3, { jumpAt: 5 }).died, 'jumped from the island to the far shore');
  // no jumping from the dock to the island
  const dock = at(f02, 225.0, 0, 0);
  const d = leap(dock, 3, { jumpAt: 20 });
  assert(d.died, 'jumped from the dock to the island');
  // the exit is shut until the boiler burns
  const x = at(f02, 267.5, 0, 0); x.wait(0.6);
  assert(!x.sim.completed && !x.sim.level.exits[0].open, 'the kiln door was open with the boiler cold');
  // boarding the raft right as the spray starts carries Cinder into it
  const r = at(f02, 225.2, 0, 0);
  r.waitUntil((s) => { const q = spray(r, 'pulsedB'); return q.wet && q.clock < 0.2; }, { timeout: 8, label: 'spray starts' });
  r.waitUntil((s, p) => p.grounded && p.x > 226.3 && Math.abs(p.y) < 0.05, { toward: [227.4, 0], jump: true, timeout: 3 });
  assert(dies(r, 6) === 'water', 'rode into the live spray');
  // boiler lit: the flood is gone and the kiln opens
  const b = at(f02, 242.6, 0, -1.8);
  assert(by(b.sim.level.pools, 'flood').wet, 'the flood is there');
  b.walkTo(243.8, 1.3); b.wait(0.3);
  assert(!by(b.sim.level.pools, 'flood').wet && b.sim.level.exits[0].open, 'lighting the boiler drains the flood and opens the kiln');
  eq(b.sim.deaths, 0);
});

test('f02: the dead-end tunnel and the islet hold the glow-stones; nothing else here is permanent but lit lanterns', () => {
  const types = new Set(f02.pieces.map((p) => p.type));
  for (const t of ['wood', 'iceblock', 'wax', 'weakwall']) assert(!types.has(t), `${t} in f02`);
});

// ------------------------------------------------------------------------------------ f03
test('f03 area 1: an ember cannot burn the barricade, the stack or the nook boards; only a blaze does', () => {
  const r = at(f03, 14.4, 0, 0);
  const e = hold(r, 1, 0, 3, { jump: true });
  assert(e.maxX < 16.05 - R + 1e-6, `an ember got through the planks: ${e.maxX}`);
  eq(by(r.sim.level.woods, 'barricade').state, 0);
  const s = at(f03, 33, 0, 0);
  assert(hold(s, 1, 0, 3, { jump: true }).maxX < 36.1 - R + 1e-6, 'an ember got through the stack');
  eq(woods(s, 'pile').every((w) => w.state === 0), true);
  const q = at(f03, 6.5, 0, 1.6);
  hold(q, 0, 1, 2, { jump: true });
  eq(by(q.sim.level.woods, 'nook').state, 0);
  assert(q.p.z < 2.2, 'an ember got into the nook');
  eq(q.sim.shardsTaken.length, 0);
});

test('f03 area 1: a blaze lights one piece of the stack and the fire spreads through all nine', () => {
  const r = at(f03, 34.8, 0, -1.5, 'blaze');
  r.waitUntil((s) => woods(r, 'pile').some((w) => w.state > 0), { toward: [36, -1.5], timeout: 3, label: 'one piece catches' });
  const first = woods(r, 'pile').filter((w) => w.state > 0).length;
  assert(first <= 3, `a touch lit ${first} pieces at once`);
  r.waitUntil((s) => woods(r, 'pile').every((w) => w.state === 2), { timeout: 8, label: 'every piece burnt' });
  assert(r.sim.deaths === 0);
});

test('f03 area 1: burning pays back heat, and coal pays more', () => {
  const r = at(f03, 14.4, 0, 0, 'blaze', 5);
  r.waitUntil((s) => by(s.level.woods, 'barricade').state === 1, { toward: [16, 0], timeout: 2 });
  assert(r.p.gauge > 5 - 0.1, `lighting the planks paid back heat: ${r.p.gauge}`);
  const c = at(f03, 23, 0, -2.2, 'blaze', 3);
  c.walkTo(24, -2.2);
  near(c.p.gauge, 7, 0.9, 'a lump of coal is +4');
});

test('f03 area 2: a blaze does not fit under the beams or through the catwalk slots; an ember does', () => {
  for (const x of [55.5, 75.5, 92.5]) {
    const b = at(f03, x, 0, 0, 'blaze');
    const bx = [57, 77, 94][[55.5, 75.5, 92.5].indexOf(x)];
    assert(hold(b, 1, 0, 3, { jump: true }).maxX < bx - RB + 1e-6 + 0.01, `a blaze passed the low gap at x=${bx}`);
    const k = at(f03, x, 0, 0);
    assert(hold(k, 1, 0, 1.5).maxX > bx + 0.7, `an ember should duck under the gap at x=${bx}`);
  }
});

test('f03 area 2: the plank walls need a blaze', () => {
  for (const [id, x, wx] of [['planks2', 66.4, 68.05], ['planks3', 86.4, 88.05]]) {
    const r = at(f03, x, 0, 0);
    assert(hold(r, 1, 0, 3, { jump: true }).maxX < wx - R + 1e-6, `an ember got through ${id}`);
    eq(by(r.sim.level.woods, id).state, 0);
    const b = at(f03, x, 0, 0, 'blaze');
    b.waitUntil((s) => by(s.level.woods, id).state === 2, { toward: [wx, 0], timeout: 5, label: `${id} burnt` });
  }
});

test('f03 area 2: the catwalk planks can never be burnt: a blaze cannot reach them from anywhere, so the only way across is never lost', () => {
  const planks = ['walk1', 'walk2', 'walk3', 'walk4'];
  const burnt = (r) => planks.filter((id) => by(r.sim.level.woods, id).state !== 0);
  // A blaze loose on either side of the gatehouse, trying everything: pushing at the slots and the walls at
  // every height, jumping, flaring, from a grid of starting points.
  const tries = [];
  for (let x = 80; x <= 93.4; x += 2.7) for (const z of [-4.4, -2.2, -1.1, 0, 1.1, 2.2, 4.4]) tries.push({ x, z, mx: 1 });
  for (let x = 105.2; x <= 116; x += 2.7) for (const z of [-4.4, -2.2, -1.1, 0, 1.1, 2.2, 4.4]) tries.push({ x, z, mx: -1 });
  for (const t of tries) {
    const r = at(f03, t.x, 0, t.z, 'blaze', 10);
    for (let i = 0; i < 360; i++) {
      r.tick(t.mx, -t.z * 0.2, i % 60 < 30, (i % 90 === 45 && r.p.form === 'blaze') ? 'blaze' : null);
      if (r.sim.deaths) break;
    }
    eq(burnt(r), [], `a blaze from (${t.x}, ${t.z}) set the catwalk alight`);
  }
  // the walls around it are too tall for a flare, and the slot is below a blaze's height
  const slot = f03.pieces.find((p) => p.type === 'block' && p.box[0] === 94 && p.box[1] === 0.8);
  assert(slot.box[1] < fire.formDefs.blaze.h, 'the slot is lower than a blaze');
  assert(slot.box[4] > 3.1, 'the wall over the slot is too tall to flare over');
  // and it is the ONLY wood the route walks on: every other wood piece is a barrier
  const support = f03.pieces.filter((p) => p.type === 'wood' && /^walk/.test(p.id)).map((p) => p.id);
  eq(support, planks);
  for (const p of f03.pieces.filter((q) => q.type === 'wood' && !/^walk/.test(q.id))) {
    assert(p.kind !== 'plank' || p.box[4] - p.box[1] >= 2.9 || p.id === 'walk', `${p.id}: a floor plank outside the catwalk`);
  }
});

test('f03 area 3: each gap is 9 m: not an ember jump, not a blaze jump, not a flare; the bridge hangs until its rope has burnt', () => {
  for (const [gx, mx, bridge] of [[117.6, 117, 'bridge1'], [132.6, 132, 'bridge2']]) {
    const e = leap(at(f03, gx, 0, 0), 4, { jumpAt: 35 });
    assert(e.died, `an ember jumped the gap at ${gx}`);
    const b = leap(at(f03, gx - 0.6, 0, 0, 'blaze'), 6, { jumpAt: 80 });
    assert(b.died, `a blaze jumped the gap at ${gx}`);
    const f = leap(at(f03, gx - 0.6, 0, 0, 'blaze'), 6, { jumpAt: 80, special: 145 });
    assert(f.died, `a flare carried a blaze over the gap at ${gx}`);
    const r = at(f03, gx, 0, 0);
    r.wait(1);
    eq(by(r.sim.level.movers, bridge).t, 0, `the bridge at ${gx} came down on its own`);
  }
  const r = at(f03, 116.4, 0, 1.8);
  r.wait(1);
  eq(by(r.sim.level.woods, 'rope1').state, 0, 'an ember by the rope does nothing');
  const q = at(f03, 116.4, 0, 1.8, 'blaze');
  q.waitUntil((s) => by(s.level.movers, 'bridge1').t >= 1, { timeout: 4, label: 'burning the rope lowers the bridge' });
  const l = at(f03, 131.1, 1.3, -2.6, 'blaze');
  l.waitUntil((s) => by(s.level.movers, 'bridge2').t >= 1, { timeout: 4, label: 'the second rope burns from the ledge' });
});

test('f03 area 4: both pools are too wide for an ember; a blaze that cannot pay for the boil is put out; the water comes back', () => {
  for (const [x0, x1] of [[162, 168], [178, 189]]) {
    const e = leap(at(f03, x0 - 1, 0, 0), 3, { jumpAt: 30 });
    assert(e.died && e.maxX < x1, `an ember crossed the pool ${x0}-${x1}: ${e.maxX}`);
    const cold = at(f03, x0 - 0.6, 0, 0, 'blaze', 1.6);
    assert(dies(cold, 3, 1, 0) === 'water', 'a blaze short of heat waded through');
  }
  eq(by(play(f03).sim.level.pools, 'pool1').steamT, 0);
  const dawdle = at(f03, 177.4, 0, 0, 'blaze', 3);
  dawdle.waitUntil((s) => !by(s.level.pools, 'pool2').wet, { mx: 1, timeout: 2, label: 'boiled' });
  dawdle.walkTo(183, 0);
  assert(dies(dawdle, 6) === 'water', 'standing in the wide pool until the water came back should put Cinder out');
});

test('f03 area 4: the glow-stone under the pier needs the pool boiled AND an ember: a blaze does not fit', () => {
  const r = at(f03, 161.6, 0, 0, 'blaze');
  r.waitUntil((s) => !by(s.level.pools, 'pool1').wet, { mx: 1, timeout: 2 });
  r.walkTo(165.25, 1.5, { slow: false });
  hold(r, 0, 1, 1.2);
  assert(r.p.z < 2.2 - RB + 1e-6, `a blaze got under the pier: z=${r.p.z}`);
  eq(r.sim.shardsTaken.length, 0);
});

test('f03 area 5: the flare gap and the high ledge: an ember falls, a plain blaze falls short, jump + flare lands', () => {
  const e = leap(at(f03, 204, 0, 0), 4, { jumpAt: 35 });
  assert(e.died && e.maxX < 211.8, `an ember jumped the flare gap: ${e.maxX}`);
  const b = leap(at(f03, 203, 0, 0, 'blaze'), 6, { jumpAt: 78 });
  assert(b.died && b.maxX < 211.8, `a plain blaze jump crossed the flare gap: ${b.maxX}`);
  const j = leap(at(f03, 203, 0, 0, 'blaze'), 5, { jumpAt: 78, special: 78 + 66 });
  assert(!j.died && j.maxX > 212.2, `jump + flare should cross: maxX=${j.maxX}`);
  const pb = at(f03, 215.9, 0, -2.9, 'blaze');
  assert(hold(pb, 1, 0, 3, { jump: true }).maxY < 2.1 - 0.3, 'a plain blaze jump reached the ledge');
  const pe = at(f03, 215.9, 0, -2.9);
  assert(hold(pe, 1, 0, 3, { jump: true }).maxY < 2.1 - 0.2, 'an ember reached the ledge');
});

test('f03 area 5: the kiln stays shut until a flame burns the kindling; an ember cannot', () => {
  const r = at(f03, 236, 0, 0);
  assert(hold(r, 1, 0, 3, { jump: true }).maxX < 238.1 - R + 1e-6, 'an ember got past the kindling');
  assert(!r.sim.level.exits[0].open, 'the kiln door opened for an ember');
  const t = at(f03, 242.6, 0, 0); t.wait(0.6);
  assert(!t.sim.completed, 'the shut kiln door completed the level');
  const b = at(f03, 236.4, 0, 0, 'blaze');
  b.waitUntil((s) => s.level.exits[0].open, { toward: [238, 0], timeout: 6, label: 'burning kindling trips the sensor' });
  b.form('ember'); b.wait(0.5);
  assert(b.sim.level.exits[0].open, 'and it stays open (latched)');
  b.waitUntil((s) => woods(b, 'pyre').every((w) => w.state === 2), { timeout: 8 });
  b.walkTo(242.6, 0); b.expectExit();
});

test('f03: heat is finite - a blaze that never refuels gutters out in 8 s, and a brazier puts it back', () => {
  const r = at(f03, 20, 0, -3, 'blaze');
  eq(r.p.form, 'blaze');
  r.waitUntil((s, p) => p.form === 'ember', { timeout: 9 });
  eq(r.sim.deaths, 0);
  eq(r.p.gauge, 0);
  r.form('blaze', { expect: false });
  r.sim.teleport(50, 0, 0); r.wait(0.6);
  eq(r.p.gauge, 10, 'the brazier refuels');
  r.form('blaze');
});

test('f03: every wood piece is a barrier to burn, except the unreachable catwalk; and the burning of all of them leaves the exit reachable', () => {
  const kinds = {};
  for (const p of f03.pieces.filter((q) => q.type === 'wood')) kinds[p.id] = p.kind;
  const barriers = Object.keys(kinds).filter((id) => !/^walk/.test(id));
  assert(barriers.length >= 20, 'planks, the stack, the nook, two ropes, the kindling');
  // burn every barrier at once: the route (as an ember where it can be) still reaches the kiln
  const r = at(f03, 3, 0, 0);
  for (const w of r.sim.level.woods) {
    if (/^walk/.test(w.id)) continue;
    w.state = 2; w.t = 1; if (w.solid) w.solid.active = false;
  }
  r.waitUntil((s) => by(s.level.movers, 'bridge1').t >= 1 && by(s.level.movers, 'bridge2').t >= 1, { timeout: 4, label: 'with the ropes gone the bridges are down' });
  r.walkTo(105.2, 0, { timeout: 40 }).walkTo(147, 0).walkTo(150, 0);
  eq(r.sim.deaths, 0);
  assert(r.p.x > 149, 'an ember walked from the start to the boil basin once all the wood was gone');
});
