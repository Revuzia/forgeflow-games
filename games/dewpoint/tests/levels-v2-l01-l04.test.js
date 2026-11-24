// Chapter 1, the EASY tier (l01 "First Drip", l02 "Cold Shoulder", l03 "Head of Steam", l04 "Slip Casting"),
// expanded to the DESIGN-V2.md level standard. Everything level-specific about these four lives here:
//   - the standard itself: the scripted route takes 60-120 s, the level is a journey of 4-5 named areas with a
//     checkpoint at the start of each, and the checkpoints are met in order along the reference route;
//   - "cannot be skipped": every gate needs the form or mechanism the level teaches (a drop cannot jump it, ice cannot
//     squeeze under it, and steam cannot fly over or round it - the gates are enclosed and the tests prove it);
//   - nothing can be made unwinnable (R puts every crate back).
// The positive routes (solve / solveAll, zero deaths, deterministic) are in tests/solutions/ and run by levels.test.js.

import { test, assert, eq, near } from './lib/harness.js';
import { play } from './lib/play.js';
import { FORMS } from '../src/sim/constants.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import l01 from '../src/levels/l01.js';
import l02 from '../src/levels/l02.js';
import l03 from '../src/levels/l03.js';
import l04 from '../src/levels/l04.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEVELS = { l01, l02, l03, l04 };
const R = FORMS.liquid.r;       // body radius of every form (0.38)
const EPS = 1e-6;

const solutions = {};
for (const id of Object.keys(LEVELS)) solutions[id] = await import(pathToFileURL(path.join(here, 'solutions', `${id}.js`)).href);

/** Place Mote at (x, y, z) in `form` (set before settling, so zones act on that form), let it settle. */
function at(level, x, y, z, form) {
  const r = play(level);
  r.allowDeath = true;
  r.sim.teleport(x, y, z);
  if (form) r.sim.forceForm(form);
  r.wait(0.3);
  return r;
}

/** Hold a stick direction for `seconds`, tracking the extremes Mote reaches. */
function hold(r, mx, mz, seconds, { jump = false } = {}) {
  const ext = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
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
 * Steam tries to get past something: several flight plans (straight on, up then over, round either side), each on a
 * fresh full gauge with no cheating, then up to 9 s to land. What matters is where Mote can END UP STANDING without
 * having died on the way: `stands` lists those spots.
 */
const PLANS = [
  () => [1, 0],
  (t) => (t < 2.2 ? [0, 0] : [1, 0]),
  (t) => (t < 1.5 ? [0.2, 1] : [1, 0]),
  (t) => (t < 1.5 ? [0.2, -1] : [1, 0]),
  (t) => (t < 1.2 ? [0, 0] : t < 2.2 ? [0, 1] : [1, 0]),
];
function steamTrials(level, x, y, z, setup) {
  const out = { stands: [], maxY: -Infinity };
  for (const plan of PLANS) {
    const r = at(level, x, y, z, 'steam');
    if (setup) setup(r);
    r.sim.player.gauge = 4;
    const deaths0 = r.sim.deaths, n = Math.round(9 * 120);
    for (let i = 0; i < n; i++) {
      const [mx, mz] = plan(i / 120);
      r.tick(mx, mz);
      out.maxY = Math.max(out.maxY, r.p.y);
      if (r.sim.deaths !== deaths0) break;
      if (r.p.grounded && r.p.form !== 'steam') { out.stands.push([r.p.x, r.p.y, r.p.z]); break; }
    }
  }
  return out;
}
/**
 * A drop that JUMPS and boils at the top of the jump climbs about 7.3 m on a full gauge (5.5 m for a cloud that boils on
 * the ground) and drifts about 13 m. Each plan: an optional run-up, a held jump, boil as the rise ends, steer one way for
 * `t` seconds, then another. Like steamTrials it reports where Mote can END UP STANDING.
 */
const BOIL_PLANS = [
  { run: 0, s0: [0, 0], t: 99, s1: [1, 0] },          // jump, boil, hover straight up
  { run: 0, s0: [0, 0], t: 3, s1: [1, 0] },           // ... climb 3 s, then over
  { run: 0, s0: [1, 0], t: 99, s1: [1, 0] },          // jump forward, boil, drift on
  { run: 0.6, s0: [1, 0], t: 99, s1: [1, 0] },        // run-up, jump, boil, drift on
  { run: 0.6, s0: [1, 0], t: 1.5, s1: [0, 0] },       // run-up, then climb
  { run: 0, s0: [0.3, 1], t: 1.5, s1: [1, 0] },       // round the north end
  { run: 0, s0: [0.3, -1], t: 1.5, s1: [1, 0] },      // round the south end
];
function boilTrials(level, x, y, z, setup) {
  const out = { stands: [], maxY: -Infinity };
  for (const plan of BOIL_PLANS) {
    const r = at(level, x, y, z);
    if (setup) setup(r);
    r.sim.player.gauge = 4;
    const deaths0 = r.sim.deaths;
    for (let i = 0; i < Math.round(plan.run * 120); i++) r.tick(1, 0, false);
    r.tick(plan.s0[0], plan.s0[1], false);
    let boiled = -1;
    for (let i = 0; i < 12 * 120 && boiled < 0; i++) {              // jump and hold, boil once the rise is over
      const up = !r.p.grounded && r.p.vy < 0.3 && i > 20;
      r.tick(plan.s0[0], plan.s0[1], true, up ? 'steam' : null);
      if (r.p.form === 'steam') boiled = i;
      if (i > 150 && r.p.grounded) break;
    }
    let t0 = boiled;
    for (let i = boiled < 0 ? 1e9 : 0; i < 9 * 120; i++) {
      const sw = i / 120 < plan.t;
      r.tick(sw ? plan.s0[0] : plan.s1[0], sw ? plan.s0[1] : plan.s1[1]);
      out.maxY = Math.max(out.maxY, r.p.y);
      if (r.sim.deaths !== deaths0) break;
      if (r.p.grounded && r.p.form !== 'steam') { out.stands.push([r.p.x, r.p.y, r.p.z]); break; }
    }
    out.maxY = Math.max(out.maxY, r.p.y);
    if (boiled < 0 && !out.noBoil) out.noBoil = true;
  }
  return out;
}
/** Steam by every means: boiling on the ground (steamTrials) and jump-then-boil (boilTrials). */
function everyFlight(level, x, y, z, setup) {
  const a = steamTrials(level, x, y, z, setup), b = boilTrials(level, x, y, z, setup);
  return { stands: [...a.stands, ...b.stands], maxY: Math.max(a.maxY, b.maxY) };
}
const standsBeyond = (t, pred) => t.stands.filter(([x, y, z]) => pred(x, y, z));
/** A copy of the level with every grate turned into a plain wall: whatever still gets through, got round or over. */
const sealed = (level) => ({ ...level, pieces: level.pieces.map((p) => (p.type === 'grate' ? { ...p, type: 'block' } : p)) });
const door = (r, id) => r.sim.level.doors.find((d) => d.id === id);

// ================================================================================== the standard, for all four
for (const [id, level] of Object.entries(LEVELS)) {
  test(`${id}: the scripted route takes 60-120 s (solve), and a full route with every shard stays inside the band too`, () => {
    for (const fn of ['solve', 'solveAll']) {
      const r = play(level);
      solutions[id][fn](r);
      const s = r.result().timeMs / 1000;
      assert(s >= 60 && s <= 120, `${id} ${fn}() takes ${s.toFixed(1)} s, outside the 60-120 s band`);
      eq(r.sim.deaths, 0, `${id} ${fn}() died`);
    }
  });

  test(`${id}: 4-5 named areas with sane boxes, a checkpoint at the start of each, every shard and the exit inside one`, () => {
    const A = level.areas;
    assert(Array.isArray(A) && A.length >= 4 && A.length <= 5, `${id} needs 4-5 areas, has ${A && A.length}`);
    const names = new Set();
    for (const a of A) {
      assert(typeof a.name === 'string' && a.name.length > 0 && a.name.length <= 24, `area name ${JSON.stringify(a.name)} must be 1-24 characters`);
      names.add(a.name);
      assert(Array.isArray(a.box) && a.box.length === 4 && a.box.every(Number.isFinite), `area "${a.name}": box must be [x0, z0, x1, z1]`);
      assert(a.box[0] < a.box[2] && a.box[1] < a.box[3], `area "${a.name}": box has no extent`);
    }
    eq(names.size, A.length, 'area names must be distinct');
    for (let i = 1; i < A.length; i++) assert(A[i].box[0] >= A[i - 1].box[0] + 10, `area "${A[i].name}" does not follow "${A[i - 1].name}" along +x`);
    const inside = (a, x, z) => x >= a.box[0] && x <= a.box[2] && z >= a.box[1] && z <= a.box[3];
    const r = play(level);
    const L = r.sim.level;
    A.forEach((a, i) => {
      const cps = L.checkpoints.filter((c) => inside(a, c.pos[0], c.pos[2]));
      assert(cps.length >= 1, `area "${a.name}" has no checkpoint`);
      assert(cps.some((c) => c.pos[0] - a.box[0] <= 14), `area "${a.name}": no checkpoint within 14 m of its start`);
    });
    for (const s of L.shards) assert(A.some((a) => inside(a, s.pos[0], s.pos[2])), `a shard at ${s.pos} is in no area`);
    assert(A.some((a) => inside(a, L.exits[0].pos[0], L.exits[0].pos[2])), 'the exit is in no area');
    assert(inside(A[A.length - 1], L.exits[0].pos[0], L.exits[0].pos[2]), 'the exit belongs to the last area');
    assert(inside(A[0], L.spawn[0], L.spawn[2]), 'the spawn belongs to the first area');
  });

  test(`${id}: the checkpoints are reached in order along the reference route, one or more per area, none skipped`, () => {
    const r = play(level);
    solutions[id].solve(r);
    const A = level.areas;
    const areaOf = (x, z) => A.findIndex((a) => x >= a.box[0] && x <= a.box[2] && z >= a.box[1] && z <= a.box[3]);
    const lit = r.events.filter((e) => e.type === 'checkpoint').map((e) => areaOf(e.x, e.z));
    assert(lit.every((a) => a >= 0), `a checkpoint outside every area: ${lit}`);
    for (let i = 1; i < lit.length; i++) assert(lit[i] >= lit[i - 1], `checkpoints lit out of order: areas ${lit}`);
    eq([...new Set(lit)], A.map((_, i) => i), 'every area\'s checkpoint is lit, in order');
  });
}

// ================================================================================== l01 / l02: steam is locked
for (const [id, level, top] of [['l01', l01, 3.6], ['l02', l02, 3.6]]) {
  test(`${id}: steam is locked by forms and nothing forces it: a drop cannot boil, not even at the top of a jump`, () => {
    assert(!level.forms.includes('steam'), `${id} must not offer steam`);
    eq(level.pieces.filter((p) => ['heatvent', 'fan', 'frost'].includes(p.type)), [], `${id} has a zone or fan that could change the form`);
    const r = at(level, level.spawn[0], level.spawn[1], level.spawn[2]);
    r.form('steam', { expect: false });
    eq(r.p.form, 'liquid');
    let maxY = -Infinity;
    for (let i = 0; i < 600; i++) {                                    // jump, ask for steam all the way up and down, drift on
      r.tick(1, 0, i % 90 < 40, i % 7 === 0 ? 'steam' : null);
      maxY = Math.max(maxY, r.p.y);
      assert(r.p.form !== 'steam', 'a drop boiled');
    }
    assert(maxY < 1.7, `a drop climbed ${maxY} m`);
  });
}

// ================================================================================== l01 "First Drip"
test('l01: door A stays shut until the gallery plate is pressed: neither a drop nor film gets through it', () => {
  for (const form of [null, 'film']) {
    const r = at(l01, 76, 0, 0, form);
    r.expectSignal('p1', false);
    const e = hold(r, 1, 0, 3, { jump: true });
    assert(e.maxX < 78.05 - R + EPS, `${form || 'liquid'} got through door A: x=${e.maxX}`);
  }
});

test('l01: the low walls need film - a drop cannot pass or jump them', () => {
  for (const [x, wall] of [[86.4, 88], [151.4, 153]]) {
    const e = hold(at(l01, x, 0, 0), 1, 0, 3, { jump: true });
    assert(e.maxX < wall - R + EPS, `a drop got past the low wall at x=${wall}: ${e.maxX}`);
  }
  const f = hold(at(l01, 86.4, 0, 0, 'film'), 1, 0, 6);
  assert(f.maxX > 92, `film should crawl under the first wall: ${f.maxX}`);
});

test('l01: the cell: a drop cannot get in, film presses its plate, door C lifts and stays up', () => {
  const r = at(l01, 103, 0, -0.4);
  const e = hold(r, 0, -1, 3, { jump: true });
  assert(e.minZ > -1.8 + R - EPS, `a drop got into the cell: z=${e.minZ}`);
  r.expectSignal('p3', false);
  const d = hold(at(l01, 110, 0, 0), 1, 0, 3, { jump: true });
  assert(d.maxX < 112.05 - R + EPS, `a drop got through door C while it was shut: x=${d.maxX}`);
  const f = at(l01, 103, 0, -0.4, 'film');
  hold(f, 0, -1, 3);
  f.expectSignal('p3', true);
  f.wait(1.2);
  assert(door(f, 'doorC').open >= 1, 'door C did not open for the film on the plate');
  f.sim.teleport(105, 0, 0); f.wait(0.5);
  f.expectSignal('doorC', true);
});

test('l01: the timed door really closes again, and stays shut for a dawdler', () => {
  const r = at(l01, 131.6, 0.1, -3.2);
  r.expectSignal('doorB', true);
  r.walkTo(133.6, 0).wait(16.6);
  r.expectSignal('doorB', false);
  near(door(r, 'doorB').open, 0, 0.2, 'door B closing');
  const q = at(l01, 160, 0, 0);
  assert(hold(q, 1, 0, 3).maxX < 161.05 - R + EPS, 'a drop walked through door B while it was shut');
});

test('l01: the kiln door stays shuttered until the porch plate is pressed (and stays open afterwards)', () => {
  const r = at(l01, 216, 3.6, 0);
  assert(!r.sim.completed, 'the shuttered kiln door completed the level');
  const q = at(l01, 188.6, 3.6, 0);
  q.expectSignal('pe', true).expectSignal('kilnOpen', true);
  q.sim.teleport(180, 3.6, 0); q.wait(0.3);
  q.expectSignal('pe', false).expectSignal('kilnOpen', true);
});

test('l01: the kiln-fire gaps are real falls that respawn at the last checkpoint (no lives, no penalty)', () => {
  const r = play(l01);
  r.sim.teleport(-27.5, 0, 1); r.wait(0.3);
  r.allowDeath = true;
  r.sim.teleport(25.5, 0.2, 0); r.wait(3);
  eq(r.sim.deaths, 1);
  assert(Math.abs(r.p.x - -27.5) < 0.1 && r.p.y > -0.1, `respawned at (${r.p.x}, ${r.p.y})`);
});

// ================================================================================== l02 "Cold Shoulder"
test('l02: a drop cannot hold the rink plate or pass its shutter; ice holds the plate and lifts it for good', () => {
  for (const form of [null, 'film']) {
    const r = at(l02, 18.5, 0, 0, form);
    r.expectSignal('p0', false);
    eq(door(r, 'doorR').open, 0);
  }
  const e = hold(at(l02, 22, 0, 0), 1, 0, 3, { jump: true });
  assert(e.maxX < 24.05 - R + EPS, `a drop got through the rink shutter: ${e.maxX}`);
  const i = at(l02, 18.5, 0.07, 0, 'ice');
  i.expectSignal('p0', true);
  i.wait(1);
  assert(door(i, 'doorR').open >= 1, 'the shutter did not lift for ice');
  i.sim.teleport(10, 0, 0); i.wait(0.3);
  i.expectSignal('doorR', true);
});

test('l02: the first pane gives way to ice at a run, not to a drop, film or a standing shove', () => {
  for (const form of [null, 'film']) {
    const r = at(l02, 28, 0, 0, form);
    const e = hold(r, 1, 0, 3, { jump: true });
    assert(!r.sim.level.panes[0].broken && e.maxX < 33.03 - R + EPS, `${form || 'liquid'} got through the first pane`);
  }
  const slow = at(l02, 32.3, 0, 0, 'ice');
  hold(slow, 1, 0, 2);
  assert(!slow.sim.level.panes[0].broken, 'ice shoved the pane from 0.7 m away');
  const run = at(l02, 27, 0, 0, 'ice');
  hold(run, 1, 0, 3);
  assert(run.sim.level.panes[0].broken, 'ice with a run-up should break the first pane');
});

test('l02: ice cannot dash through door A without the crate: the door shuts behind the weight', () => {
  const r = at(l02, 56, 0, 2.6);
  r.expectSignal('hp1', false);
  eq(door(r, 'doorA').open, 0);
  const i = at(l02, 56, 0.07, 2.6, 'ice');
  i.expectSignal('hp1', true);
  i.wait(0.8);
  assert(door(i, 'doorA').open >= 1, 'door A did not open for ice on the plate');
  const e = hold(i, 1, -0.32, 3);
  assert(e.maxX < 64.05 - R + EPS, `ice rushed through door A before it shut: x=${e.maxX}`);
});

test('l02: the chute pane needs the downhill run - flat ice and a drop fail; hot tiles melt ice and refuse to freeze it', () => {
  const flat = at(l02, 88.5, 0, 0, 'ice');
  hold(flat, 1, 0, 3);
  assert(!flat.sim.level.panes[1].broken, 'ice broke the chute pane from the flat');
  const drop = at(l02, 88.5, 0, 0);
  const e = hold(drop, 1, 0, 3, { jump: true });
  assert(!drop.sim.level.panes[1].broken && e.maxX < 92.03 - R + EPS, 'a drop got through the chute pane');
  const hot = at(l02, 97.5, 0, 0, 'ice');
  eq(hot.p.form, 'liquid', 'ice on the hot tiles');
  hot.form('ice', { expect: false });
  eq(hot.p.form, 'liquid', 'ice should be refused on the hot tiles');
});

test('l02: the double shutter needs BOTH crates; one crate or one weight is not enough, the stall fits only a crate, and its glass needs a run-up', () => {
  const crate = (r, id) => r.sim.level.crates.find((c) => c.id === id);
  // one crate on plate A only
  const a = at(l02, 99, 0, 0);
  const b = crate(a, 'crate2').body;
  b.x = 115; b.y = 0.06; b.z = -3.4; a.wait(0.5);
  a.expectSignal('hpA', true).expectSignal('hpB', false).expectSignal('bothWeights', false);
  a.sim.teleport(125, 0, 0); a.wait(0.2);
  assert(hold(a, 1, 0, 3, { jump: true }).maxX < 128.55 - R + EPS, 'a drop passed the double shutter with one crate down');
  // the second weight is ice itself: it opens the shutter, but it cannot also walk through before it shuts
  const c = at(l02, 99, 0, 0);
  const cb = crate(c, 'crate2').body;
  cb.x = 115; cb.y = 0.06; cb.z = -3.4; c.wait(0.5);
  c.sim.teleport(122, 0.07, 3.5); c.sim.forceForm('ice'); c.wait(0.6);
  c.expectSignal('bothWeights', true);
  const e = hold(c, 1, -0.5, 3);
  assert(e.maxX < 128.55 - R + EPS, `ice rushed through the double shutter: x=${e.maxX}`);
  // the stall: only a crate wide, so ice from the open end cannot get round the crate to the glass
  const s = at(l02, 116, 0, 3.5, 'ice');
  const f = hold(s, -1, 0, 3);
  assert(f.minX > 108.0, `ice got into the stall past the crate: x=${f.minX}`);
  // glass: not from a short run, not for a drop
  const g = at(l02, 105.8, 0, 3.5, 'ice');
  hold(g, 1, 0, 2);
  assert(!g.sim.level.panes.find((p) => p.id === 'pane3').broken, 'ice broke the stall glass from 1.2 m');
  const h = at(l02, 103, 0, 3.5);
  hold(h, 1, 0, 3, { jump: true });
  assert(!h.sim.level.panes.find((p) => p.id === 'pane3').broken, 'a drop broke the stall glass');
});

test('l02: the kiln door is locked; a drop and ice cannot pass the low wall or press the far plate', () => {
  const r = at(l02, 133.4, 0, -3.4);
  r.wait(0.4);
  assert(!r.sim.completed, 'the locked kiln door completed the level');
  for (const form of [null, 'ice']) {
    const e = hold(at(l02, 150, 0, 0, form), 1, 0, 3, { jump: true });
    assert(e.maxX < 152 - R + EPS, `${form || 'liquid'} got under the low wall: ${e.maxX}`);
  }
  const p = at(l02, 156.2, 0, 0);
  p.expectSignal('hp2', false);
  const q = at(l02, 156.2, 0, 0, 'film');
  q.expectSignal('hp2', false);
  const i = at(l02, 156.2, 0.07, 0, 'ice');
  i.expectSignal('hp2', true).expectSignal('exitOpen', true);
});

test('l02: R puts every crate back, so a crate shoved into a corner never makes the level unwinnable', () => {
  const r = play(l02);
  const L = r.sim.level;
  eq(L.crates.length, 3);
  L.crates.forEach((c, i) => { c.body.x += 2.5; c.body.z += 1; r.wait(0.4); });
  r.restart().wait(0.3);
  for (const c of L.crates) near(Math.hypot(c.body.x - c.home[0], c.body.z - c.home[2]), 0, 0.05, `crate ${c.id} is back at its start`);
});

// ================================================================================== l03 "Head of Steam"
test('l03: the jump-then-boil plans really do climb about 7 m (so the gate tests below are not vacuous)', () => {
  const t = boilTrials(l03, -20, 0, 2);
  assert(t.maxY > 6.8 && t.maxY < 8.2, `jump-then-boil reached y=${t.maxY}, expected about 7.3`);
  const g = steamTrials(l03, -20, 0, 2);
  assert(g.maxY > 5 && g.maxY < 6, `boiling on the ground reached y=${g.maxY}, expected about 5.5`);
});

test('l03: the two ledges of the boiler floor need steam - a drop, ice and film cannot climb them', () => {
  for (const form of [null, 'ice', 'film']) {
    const e = hold(at(l03, 7.5, 0, 0, form), 1, 0, 3, { jump: true });
    assert(e.maxY < 1.7 && e.maxX < 10 - R + 0.05, `${form || 'liquid'} climbed ledge 1: y=${e.maxY}`);
    const f = hold(at(l03, 16.5, 2.2, 0, form), 1, 0, 3, { jump: true });
    assert(f.maxY < 2.2 + 1.7 && f.maxX < 18 - R + 0.05, `${form || 'liquid'} climbed ledge 2: y=${f.maxY}`);
  }
});

test('l03: the iron gates pass a cloud through their grates only: nothing else gets through, and a cloud cannot fly over or round the walls', () => {
  for (const [x, y, wall] of [[38.5, 5, 40.05], [54.8, 7.4, 56.05]]) {
    for (const form of [null, 'ice', 'film']) {
      const e = hold(at(l03, x, y, 0, form), 1, 0, 3, { jump: true });
      assert(e.maxX < wall - R + EPS, `${form || 'liquid'} got through the gate at x=${wall}: ${e.maxX}`);
    }
    // the grate is the way for steam ...
    const open = steamTrials(l03, x, y, 0);
    assert(standsBeyond(open, (px) => px > wall + 0.6).length > 0, `steam should pass the grate at x=${wall}`);
    // ... and the only way: with the grate walled up, no flight plan (boiling on the ground, or jumping and then boiling)
    // ends standing beyond the wall - from the floor, and from the top of anything a cloud can stand on first
    const bases = wall < 50 ? [[x, y, 0], [24.5, 6.8, 4.2], [36.4, 5.55, -4]] : [[x, y, 0], [52, 9.2, -4.2], [60.5 - 8, 7.95, 4.1], [44, 5, 0]];
    for (const [bx, by, bz] of bases) {
      const shut = everyFlight(sealed(l03), bx, by, bz);
      eq(standsBeyond(shut, (px) => px > wall + 0.6), [], `steam got over or round the wall at x=${wall} from (${bx}, ${by}, ${bz})`);
    }
  }
});

test('l03: the gaps need steam - a drop cannot cross them, and steam alone cannot cross the chasm without the big fan', () => {
  const a = at(l03, 73.4, 7.4, 0);
  const e = hold(a, 1, 0, 3, { jump: true });
  assert(e.maxX < 83 && a.sim.deaths > 0, `a drop crossed gap A: x=${e.maxX}`);
  const b = at(l03, 88.4, 7.4, 0);
  const f = hold(b, 1, 0, 3, { jump: true });
  assert(f.maxX < 98 && b.sim.deaths > 0, `a drop crossed gap B: x=${f.maxX}`);
  const off = everyFlight(l03, 107.2, 7.4, 0, (r) => { r.sim.level.fans[0].on = r.sim.signals.compile(false); });
  eq(standsBeyond(off, (px) => px > 126), [], 'steam alone (even jumping first) crossed the chasm');
  const on = steamTrials(l03, 107.2, 7.4, 0);
  // ... and the fan's tail wind, with or without a jump first, brings a cloud down on the far platform, never on the ledge or gallery
  const flown = everyFlight(l03, 107.2, 7.4, 0);
  eq(standsBeyond(flown, (px, py) => py > 9), [], 'a cloud carried by the big fan ended up on the shaft ledge or higher');
  assert(standsBeyond(on, (px, py) => px > 126 && Math.abs(py - 7.4) < 0.01).length > 0, 'the big fan should carry steam across to the far platform');
});

test('l03: jumping into the big fan as a drop is a fall, as the hint warns', () => {
  const r = play(l03);
  r.sim.teleport(100, 7.4, 0); r.wait(0.3);
  assert(r.sim.checkpoint, 'the checkpoint by the fan is lit');
  r.dying((q) => { q.walkTo(107.4, 0, { stuck: 0 }); q.jump(0.5, 1, 0); q.waitUntil((s) => s.deaths > 0, { mx: 1, timeout: 6 }); });
  eq(r.sim.deaths, 1);
  near(r.p.x, 100, 1e-6, 'respawned at the checkpoint by the fan');
});

test('l03: the shafts need their plates and their height: steam cannot reach the ledge from the floor, or the gallery from the ledge', () => {
  const r = at(l03, 140.7, 7.4, 0);
  r.expectSignal('shaftOn', false);
  // a drop that jumps and boils climbs ~7.3 m, and may first stand on the nook wall (9.8), the kiln (9.2) or the shelf (8.8)
  const top = (x0, x1) => l03.pieces.find((q) => q.type === 'block' && q.box[0] === x0 && q.box[3] === x1).box[4];
  const ledgeTop = top(142, 153), galleryTop = top(153, 178);
  for (const [bx, by, bz] of [[138, 7.4, 0], [136.5, 9.8, -2.8], [131.4, 9.2, 4.2], [136.5, 8.8, 3.2], [133, 7.95, -4.4]]) {
    const up = everyFlight(l03, bx, by, bz);
    eq(standsBeyond(up, (x, y) => y > ledgeTop - 0.5), [], `steam climbed from (${bx}, ${by}) to the ledge without the shaft`);
    assert(up.maxY < ledgeTop, `steam rose to y=${up.maxY} from (${bx}, ${by}), level with the ledge`);
  }
  for (const [bx, by, bz] of [[150.9, 18.4, 0], [149.2, 18.95, 4.6], [144, 18.4, 0]]) {
    const up = everyFlight(l03, bx, by, bz);
    eq(standsBeyond(up, (x, y) => y > galleryTop - 0.5), [], `steam climbed from (${bx}, ${by}) to the gallery without the shaft`);
    assert(up.maxY < galleryTop, `steam rose to y=${up.maxY} from (${bx}, ${by}), level with the gallery`);
  }
  const p = at(l03, 136.5, 7.4, -4.7);
  p.expectSignal('p3', true).expectSignal('shaftOn', true);
  const q = at(l03, 136.5, 7.4, -4.7, 'ice');
  q.expectSignal('p3', true);
  // the nook round the first plate has only a film-high gap
  const e = hold(at(l03, 136.5, 7.4, -1.2), 0, -1, 3, { jump: true });
  assert(e.minZ > -2.4 + R - EPS, `a drop got into the nook: z=${e.minZ}`);
  const f = hold(at(l03, 136.5, 7.4, -1.2, 'film'), 0, -1, 3);
  assert(f.minZ < -3.2, `film should crawl into the nook: z=${f.minZ}`);
});

test('l03: the cage keeps a drop away from its plate; the gale stays off until the plate is pressed, and steam alone cannot cross the long chasm', () => {
  const e = hold(at(l03, 159, 27.6, 0), 1, 0, 3, { jump: true });
  assert(e.maxX < 161.05 - R + EPS, `a drop got into the cage: ${e.maxX}`);
  const r = at(l03, 177.4, 27.6, 0);
  r.expectSignal('galeOn', false);
  const off = everyFlight(l03, 177.4, 27.6, 0);
  eq(standsBeyond(off, (px) => px > 212), [], 'steam crossed the long chasm without the gale');
  const p = at(l03, 164.4, 27.8, 0);
  p.wait(0.6);
  p.expectSignal('p4', true).expectSignal('galeOn', true);
  const s = at(l03, 164.4, 28.1, 0, 'steam');
  s.wait(0.5);
  s.expectSignal('p4', false);
});

// ================================================================================== l04 "Slip Casting"
test('l04: the wall needs film - a drop and ice cannot cross it, and standing on the slats does not drop them', () => {
  const r = at(l04, 11.5, 0, 0);
  const e = hold(r, 1, 0, 3, { jump: true });
  assert(e.maxX < 13.4 - R + EPS, `liquid got past the wall: x=${e.maxX}`);
  eq(r.sim.deaths, 0);
  assert(r.p.y > -0.01, 'liquid fell through the slats');
  const q = at(l04, 11.5, 0, 0, 'ice');
  const f = hold(q, 1, 0, 3);
  assert(f.maxX < 13.4 - FORMS.ice.r + EPS, `ice got past the wall: x=${f.maxX}`);
  assert(q.p.y > -0.01, 'ice fell through the slats');
});

test('l04: film dropped through the slats comes out under the wall and up the ramp', () => {
  const r = at(l04, 11, 0, 0, 'film');
  r.waitUntil((s, p) => p.y < -1, { timeout: 2, label: 'fell through the slats' });
  const e = hold(r, 1, 0, 12);
  assert(e.maxX > 20 && r.sim.deaths === 0, `film did not make it under the wall: x=${e.maxX}`);
});

test('l04: neither a drop nor ice fits under any low wall (arches, hall B, the casting hall); the posts are not closed by a drop', () => {
  for (const [x, wallX] of [[-46, -44], [-35, -33], [-13, -11], [25, 27], [111, 113.4]]) {
    for (const form of [null, 'ice']) {
      const r = at(l04, x, 0, 0, form);
      const e = hold(r, 1, 0, 3, { jump: true });
      assert(e.maxX < wallX - R + EPS, `${form || 'liquid'} got under the low wall at x=${wallX}: ${e.maxX}`);
    }
  }
  const r = at(l04, 31.1, 0, 0);
  r.expectSignal('e1', false);
  eq(door(r, 'doorA').open, 0);
  const q = at(l04, 31.1, 0, 0, 'film');
  q.wait(0.1).expectSignal('e1', true);
});

test('l04: the first shutter needs the plate under the low shelf, and only film reaches that plate', () => {
  const r = at(l04, -24, 0, -0.6);
  hold(r, 0, -1, 3, { jump: true });
  r.wait(0.3);
  assert(r.p.y > 1.3 || r.p.z > -1.6 + R - EPS, `a drop got under the shelf: (${r.p.z}, ${r.p.y})`);   // it may hop ON the shelf (1.4 m), never under it
  r.expectSignal('pl0', false);
  const d = hold(at(l04, -20, 0, 0), 1, 0, 3, { jump: true });
  assert(d.maxX < -18.35 - R + EPS, `a drop walked through the shut shutter: ${d.maxX}`);
  const f = at(l04, -24, 0, -0.6, 'film');
  hold(f, 0, -1, 3);
  f.expectSignal('pl0', true);
  f.wait(1);
  assert(door(f, 'doorO').open >= 1, 'the shutter did not lift for the film on the plate');
});

test('l04: the nooks: a drop cannot enter, and the shutter needs BOTH circuits (and keeps them latched)', () => {
  for (const [x, z, dz] of [[42, -0.6, -1], [50, 0.6, 1]]) {
    const e = hold(at(l04, x, 0, z), 0, dz, 3, { jump: true });
    assert(dz < 0 ? e.minZ > -1.6 + R - EPS : e.maxZ < 1.6 - R + EPS, `a drop got into the nook at x=${x}`);
  }
  // one circuit only
  for (const [x, z, sig] of [[42, -3.5, 'e5'], [50, 3.5, 'e6']]) {
    const r = at(l04, x, 0, z, 'film');
    r.expectSignal(sig, true);
    r.sim.teleport(55, 0, 0); r.sim.forceForm('liquid'); r.wait(0.3);
    r.expectSignal('nooksDone', false);
    assert(hold(r, 1, 0, 3, { jump: true }).maxX < 58.05 - R + EPS, `a drop passed the shutter with only ${sig} closed`);
  }
  // both
  const b = at(l04, 42, 0, -3.5, 'film');
  b.sim.teleport(50, 0, 3.5); b.wait(0.3);
  b.sim.teleport(55, 0, 0); b.sim.forceForm('liquid'); b.wait(1);
  b.expectSignal('nooksDone', true);
  assert(door(b, 'doorN').open >= 1, 'the shutter should be up with both circuits closed');
});

test('l04: the tanks: slats hold a drop up, the walls cannot be passed or jumped, the middle shutter needs the posts, film closes them', () => {
  const r = at(l04, 66, 0, 0);
  assert(r.p.y > -0.01, 'a drop fell through the first slats');
  const e = hold(r, 1, 0, 3, { jump: true });
  assert(e.maxX < 70 - R + EPS && r.p.y > -0.01, `a drop got past the first wall: ${e.maxX}`);
  // in the middle tank: the shutter is shut until the posts are closed
  const m = at(l04, 78.6, -1.6, 0);
  m.expectSignal('e4', false);
  eq(door(m, 'doorT').open, 0);
  assert(hold(m, 1, 0, 3).maxX < 80.3 - R + EPS, 'a drop passed the tank shutter');
  const f = at(l04, 75.6, -1.6, 0, 'film');
  f.expectSignal('e4', true);
  f.wait(1);
  assert(door(f, 'doorT').open >= 1, 'the tank shutter did not lift for the film on the posts');
  f.sim.teleport(70, -1.6, 0); f.sim.forceForm('liquid'); f.wait(0.5);
  f.expectSignal('tankOpen', true);
});

test('l04: steam cannot fly over or round any wall, shutter or arch: every gate holds for a cloud', () => {
  const GATES = [
    [-46, 0, -42.3], [-35, 0, -29.3], [-13, 0, -9.3],                     // the three arches
    [-20, 0, -17.7],                                                       // the first shutter (shut)
    [11, 0, 14.7],                                                         // the very tall wall over the sieve floor
    [25, 0, 28.7],                                                         // hall B's low wall
    [34, 0, 35.7],                                                         // door A (shut)
    [56, 0, 58.7],                                                         // the shutter after the nooks (shut)
    [64, 0, 71.3],                                                         // the first wall of the tanks
    [121, 0, 123.7],                                                       // the kiln shutter (shut)
  ];
  // ... from the floor, and from the top of everything a cloud (or a drop that jumps and boils: ~7.3 m) can stand on first:
  // the mould stack (1.2), the nook walls (3.6), the shelf (1.2) and the crate (1.0)
  const BASES = [
    [-37.2, 1.2, -3.2, -29.3], [-24, 1.4, -3, -17.7], [42, 3.6, -2.3, 58.7], [50, 3.6, 2.3, 58.7], [42, 3.6, -2.3, 71.3], [50, 3.6, 2.3, 71.3],
    [105.1, 1.2, -3.3, 123.7], [99, 0, 0, 123.7],
  ];
  for (const [x, y, beyond] of GATES) {
    const t = everyFlight(l04, x, y, 0);
    eq(standsBeyond(t, (px) => px > beyond), [], `steam got past the gate at x=${beyond}`);
    assert(t.maxY < 12, `steam rose to y=${t.maxY} from (${x}, ${y}): over the walls`);
  }
  for (const [x, y, z, beyond] of BASES) {
    const t = everyFlight(l04, x, y, z);
    eq(standsBeyond(t, (px) => px > beyond), [], `steam from (${x}, ${y}, ${z}) got past the gate at x=${beyond}`);
    assert(t.maxY < 12, `steam rose to y=${t.maxY} from (${x}, ${y}): over the walls`);
  }
});

test('l04: the exit chamber is shut until the crate is on the heavy plate AND the last posts are closed', () => {
  const open = (r) => r.sim.signals.get('exitOpen');
  // film on the posts, nothing on the plate
  const a = at(l04, 117.5, 0, 0, 'film');
  a.wait(0.2).expectSignal('e2', true).expectSignal('hp', false);
  assert(!open(a), 'the shutter opened without the plate');
  // crate on the plate, posts never closed
  const b = at(l04, 99, 0, 0);
  const c = b.sim.level.crates[0].body;
  c.x = 107.9; c.y = 0.06; c.z = 2.0; b.wait(0.5);
  b.expectSignal('hp', true).expectSignal('e2', false);
  assert(!open(b), 'the shutter opened without the posts');
  // both: opens and stays open (latched posts) even after the film leaves
  b.sim.teleport(117.5, 0, 0); b.wait(0.2); b.form('film'); b.wait(0.2);
  assert(open(b), 'the shutter stays shut with both conditions met');
  b.form('liquid'); b.wait(0.2);
  assert(open(b), 'the shutter closed again after the film left (the posts latch)');
});

test('l04: the casting pen is sealed until its posts are closed from inside', () => {
  const r = at(l04, 3.6, 0, -2.0);
  assert(r.p.y > -0.01, 'a drop fell into the pen through the slats');
  // as if it had fallen in as film and stood up: the door must still be shut for a drop
  const q = at(l04, 3.6, -1.6, -2.5);
  const d = door(q, 'penDoor');
  const e = hold(q, 1, 0, 2);
  eq(d.open, 0, 'pen door opened for a drop');
  assert(e.maxX < 5.0 - R + EPS, 'a drop walked out of the closed pen');
});

test('l04: the kiln door sits up a flight of ledges only a cloud climbs; a drop cannot', () => {
  const a = hold(at(l04, 126.6, 0, 0), 1, 0, 3, { jump: true });
  assert(a.maxY < 2 && a.maxX < 128 + 0.2, `a drop climbed the first ledge: y=${a.maxY}`);
  const b = hold(at(l04, 131.6, 3, 0), 1, 0, 3, { jump: true });
  assert(b.maxY < 3 + 1.7 && b.maxX < 133 - R + 0.05, `a drop climbed the second ledge: y=${b.maxY}`);
  const c = hold(at(l04, 136.6, 6.4, 0), 1, 0, 3, { jump: true });
  assert(c.maxY < 6.4 + 1.7 && c.maxX < 138 - R + 0.05, `a drop climbed the third ledge: y=${c.maxY}`);
  const t = steamTrials(l04, 126.6, 0, 0);
  assert(t.maxY > 3, 'steam should rise the first ledge');
});

test('l04: R puts the crate back, so a crate shoved into a corner never makes the level unwinnable', () => {
  const r = play(l04);
  const c = r.sim.level.crates[0];
  c.body.x += 4; c.body.z -= 1.5; r.wait(0.4);
  r.restart().wait(0.3);
  near(Math.hypot(c.body.x - c.home[0], c.body.z - c.home[2]), 0, 0.05, 'the crate is back at its start');
});
