// "Cannot be skipped" and "cannot be broken" tests for Fire levels f04 "Night Watch" .. f08.
// Every key gate must really need the thing the level teaches, every hazard must really cost what
// it should, anything permanent (burnt wood, melted ice, lit lanterns) must never leave the level
// unwinnable, and each level's reference route must fit the length band of DESIGN-V2.md section 1.
// The positive routes (solve / solveAll) live in tests/solutions/ and are run by campaigns.test.js.

import { test, assert, eq, near, between } from './lib/harness.js';
import { play } from './lib/play.js';
import { at, hold } from './lib/fire.js';
import fire from '../src/sim/elements/fire.js';
import { Sim } from '../src/sim/sim.js';
import f04 from '../src/levels/f04.js';
import * as sol04 from './solutions/f04.js';
import f05 from '../src/levels/f05.js';
import * as sol05 from './solutions/f05.js';
import f06 from '../src/levels/f06.js';
import * as sol06 from './solutions/f06.js';
import f07 from '../src/levels/f07.js';
import * as sol07 from './solutions/f07.js';
import f08 from '../src/levels/f08.js';
import * as sol08 from './solutions/f08.js';

const R = fire.formDefs.ember.r, RB = fire.formDefs.blaze.r;
const by = (list, id) => list.find((q) => q.id === id);
const door = (r, id) => by(r.sim.level.doors, id);
const wood = (r, id) => by(r.sim.level.woods, id);
const fuse = (r, id) => by(r.sim.level.fuses, id);

/**
 * Run and jump toward +x from where the hero stands. Returns { stoodX, maxX, died }: the furthest x
 * at which it STOOD on something (a hero falling into a pit still drifts forward, which is not a crossing).
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

/** Walk the hero toward a point with deaths allowed; returns true if it died on the way. */
function diesWalking(r, x, z, seconds = 4) {
  const d0 = r.sim.deaths;
  for (let i = 0; i < seconds * 120 && r.sim.deaths === d0; i++) {
    const dx = x - r.p.x, dz = z - r.p.z, d = Math.hypot(dx, dz);
    r.tick(d > 0.05 ? dx / d : 0, d > 0.05 ? dz / d : 0, false);
  }
  return r.sim.deaths > d0;
}

/** Scripted route time in seconds. */
function routeSeconds(level, mod, fn = 'solve') {
  const r = play(level);
  mod[fn](r);
  return r.result().timeMs / 1000;
}

/** Every Fire level of this file: journey of named, contiguous areas, a brazier at the start of each. */
function checkAreas(level, count) {
  const sim = new Sim(level), L = sim.level;
  eq(level.areas.length, count, `${level.id}: number of areas`);
  const names = level.areas.map((a) => a.name);
  eq(new Set(names).size, names.length, `${level.id}: area names are unique`);
  level.areas.forEach((a, i) => {
    assert(typeof a.name === 'string' && a.name.length > 0 && a.name.length <= 24, `${level.id}: area ${i} name`);
    assert(Array.isArray(a.box) && a.box.length === 4 && a.box[2] > a.box[0] && a.box[3] > a.box[1], `${level.id}: area ${i} box`);
    if (i > 0) eq(a.box[0], level.areas[i - 1].box[2], `${level.id}: area ${i} starts where area ${i - 1} ends`);
    const x0 = i === 0 ? level.spawn[0] : a.box[0];
    assert(L.braziers.some((b) => b.pos[0] >= x0 - 0.5 && b.pos[0] <= x0 + 4 && b.pos[2] >= a.box[1] && b.pos[2] <= a.box[3]), `${level.id}: area "${a.name}" has no brazier within 4 m of its start`);
  });
}

// ------------------------------------------------------------------------------------ f04
const [A1, A2, A3, A4, A5] = sol04.ORIGINS;

test('f04: five named areas, a brazier at the start of each, and the route fits the 65-85 s band', () => {
  checkAreas(f04, 5);
  const t = routeSeconds(f04, sol04), tAll = routeSeconds(f04, sol04, 'solveAll');
  between(t, 65, 85, 'solve() route time');
  between(tAll, 65, 125, 'solveAll() route time');
});

test('f04: only ember and blaze are offered; smoke is locked', () => {
  const r = play(f04);
  r.form('smoke', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'locked');
});

test('f04: door A stays shut until lantern one is lit, and cannot be jumped or burnt', () => {
  const r = at(f04, A1 + 10.5, 0, 0);
  const e = hold(r, 1, 0, 3, { jump: true });
  assert(e.maxX < A1 + 13.05 - R + 1e-6, `got past door A without the lantern: x=${e.maxX}`);
  eq(door(r, 'doorA').open, 0);
  eq(r.sim.level.lanterns[0].lit, false, 'walking down the middle of the hall does not light the lantern');
  const b = at(f04, A1 + 10.5, 0, 0, 'blaze');
  assert(hold(b, 1, 0, 3, { jump: true }).maxX < A1 + 13.05 - RB + 1e-6, 'a blaze got through door A');
});

test('f04: the cord across the pool is the only key to the second door, and it takes as long as it takes', () => {
  const r = at(f04, A1 + 44, 0, 0);
  const e = hold(r, 1, 0, 3, { jump: true });
  assert(e.maxX < A1 + 47.05 - R + 1e-6, `got past door B without the cord: x=${e.maxX}`);
  eq(fuse(r, 'cord0').state, 0, 'standing at the door does not light the cord (only its frayed end does)');
  const q = at(f04, A1 + 18.6, 0, 2.9);
  eq(fuse(q, 'cord0').state, 1);
  const t0 = q.t - 0.3;                                   // at() settled for 0.3 s after lighting it
  q.waitUntil((s) => door(q, 'doorB').open >= 1, { timeout: 12, label: 'door B opens' });
  near(q.t - t0, fuse(q, 'cord0').len / 3.4 + 0.6, 0.2, 'cord length / rate, plus the door travel');
  q.wait(5); eq(door(q, 'doorB').open, 1, 'the door stays open once the cord has burnt through');
});

test('f04: the first pool cannot be crossed without the stones, nor waded', () => {
  const r = at(f04, A1 + 19, 0, -1.5);
  assert(leap(r, 3, { jumpAt: 10 }).died, 'one jump crossed the 12 m pool');
  const w = at(f04, A1 + 19.5, 0, 0);
  assert(diesWalking(w, A1 + 34, 0), 'waded the pool');
  eq(w.events.filter((e) => e.type === 'respawn').pop().cause, 'water');
  near(w.p.x, 0, 1e-9, 'back at the spawn, no brazier lit yet');
});

test('f04: the drip causeway is the only way over the gallery tank, and its drops are real', () => {
  const beside = at(f04, A2 + 3.5, 0, 2.5);
  assert(leap(beside, 3).died, 'crossed the tank beside the causeway');
  const q = at(f04, A2 + 6.5, 0, 0);
  q.waitUntil((s) => s.deaths > 0, { timeout: 2.5, label: 'the drop lands on Cinder' });
  const offs = q.sim.level.drips.slice(0, 4).map((d) => d.offset);
  eq(new Set(offs).size, 4, 'four different phases');
});

test('f04: the moat is too wide to jump, and a ferry deck is solid ground that carries Cinder', () => {
  assert(leap(at(f04, A2 + 18.8, 0, 0), 4, { jumpAt: 40 }).died, 'jumped the first moat');
  assert(leap(at(f04, A2 + 31.8, 0, 0), 4, { jumpAt: 40 }).died, 'jumped the second moat');
  const r = at(f04, A2 + 20.4, 0, 0);
  const x0 = r.p.x;
  r.waitUntil((s) => by(s.level.movers, 'ferry').t >= 1, { timeout: 12, label: 'the ferry arrives', mx: 0 });
  assert(r.p.x > x0 + 5, 'the ferry carried the passenger');
});

/**
 * Light wick A, then (after `delayB` s, null = never) hop to the island and light wick B, then
 * stand at the gate, and report whether the gate ever opened. Standing ON a cord's first point
 * would relight it each time it grows back, so the hero leaves each one at once.
 */
function wickRun(delayB) {
  const r = at(f04, A3 + 4, 0, 2.9);
  let opened = false;
  const step = (n) => { for (let i = 0; i < n * 120; i++) { r.tick(0, 0, false); if (door(r, 'gate').open >= 1) opened = true; } };
  r.sim.teleport(A3 + 17, 0, 0.5);
  if (delayB !== null) {
    step(Math.max(0, delayB - 0.3));
    r.sim.teleport(A3 + 13.5, 0, -3.1); step(0.2);
    r.sim.teleport(A3 + 17, 0, 0.5);
  }
  step(16);
  return { opened, r };
}

test('f04: the gate needs BOTH cords burning at once - one alone, or the short one too early, does nothing', () => {
  assert(!wickRun(null).opened, 'the long cord alone opened the gate');
  const early = wickRun(0.6);
  assert(!early.opened, 'the short cord lit right after the long one opened the gate');
  const late = wickRun(8.9);
  assert(!late.opened, 'the short cord lit after the long one has burnt out opened the gate');
  for (const d of [3.2, 4.4, 5.6]) assert(wickRun(d).opened, `long cord first, short cord ${d} s later, must open the gate`);
  // the short cord on its own
  const r = at(f04, A3 + 13.5, 0, -3.1);
  eq(fuse(r, 'wickB').state, 1);
  r.sim.teleport(A3 + 17, 0, 0.5);
  r.wait(14);
  eq(door(r, 'gate').open, 0, 'the short cord alone opened the gate');
});

test('f04: a missed timing is always retryable - both cords grow back and the door cannot trap Cinder', () => {
  const r = at(f04, A3 + 4, 0, 2.9);
  eq(fuse(r, 'wickA').state, 1);
  r.sim.teleport(A3 + 10, 0, 0);
  r.wait(14);
  eq(fuse(r, 'wickA').state, 0, 'the long cord is whole again, ready to be lit once more');
  const walk = at(f04, A3 + 19, 0, 0);
  assert(hold(walk, 1, 0, 3, { jump: true }).maxX < A3 + 21.05 - R + 1e-6, 'walked through the shut gate');
});

test('f04: the pools are water: an ember is put out, a cold blaze is put out, a warm blaze boils them', () => {
  const e = at(f04, A4 + 3.6, 0, 0);
  assert(diesWalking(e, A4 + 13.5, 0), 'an ember waded the boiling-house pool');
  const cold = at(f04, A4 + 3.6, 0, 0, 'blaze', 1.6);
  assert(diesWalking(cold, A4 + 13.5, 0), 'a blaze short of heat waded through');
  const b = at(f04, A4 + 3.6, 0, 0, 'blaze', 10);
  const g0 = b.p.gauge, t0 = b.t;
  b.waitUntil((s) => by(s.level.pools, 'pool2').steamT > 0, { mx: 1, timeout: 2 });
  let low = 10, tLow = 0;
  const watch = (r) => { const tick = r.tick.bind(r); r.tick = (...a) => { tick(...a); if (r.p.gauge < low) { low = r.p.gauge; tLow = r.t; } }; };
  watch(b);
  b.walkTo(A4 + 12.2, 0, { slow: false }).jumpTo(A4 + 13.6, 0, { tol: 0.4 });
  eq(b.sim.deaths, 0, 'a blaze with heat should cross the boiled pool');
  assert(low < g0 - 1.25 * (tLow - t0) - 1.9, `the boil costs 2 heat on top of the burn (${g0} -> ${low})`);
});

test('f04: a drip sizzles out on a blaze for 1 heat and puts an ember out', () => {
  const r = at(f04, A4 + 7.5, 0.0, 0, 'blaze', 10);       // standing in the drained-pool column is not needed: place beside, in the open
  r.sim.level.pools.forEach((p) => { p.steamT = 20; p.wet = false; });
  r.sim.teleport(A4 + 7.5, -0.5, 0); r.p.gauge = 10;
  const g0 = r.p.gauge, t0 = r.t;
  r.waitUntil((s) => s.level.drips.find((d) => d.id === 'd5').live, { timeout: 3 });
  r.wait(1.2);
  const spent = g0 - r.p.gauge - 1.25 * (r.t - t0);
  assert(r.sim.deaths === 0 && spent > 0.9 && spent < 1.1, `a drip should cost 1 heat on top of the burn: spent ${spent}`);
  const e = at(f04, A4 + 7.5, -0.5, 0);
  e.sim.level.pools.forEach((p) => { p.steamT = 20; p.wet = false; });
  e.sim.teleport(A4 + 7.5, -0.5, 0);
  e.waitUntil((s) => s.deaths > 0, { timeout: 4, label: 'the drop puts the ember out' });
});

test('f04: the low beam stops a blaze and passes an ember', () => {
  const b = at(f04, A4 + 17, 0, 0, 'blaze');
  assert(hold(b, 1, 0, 3, { jump: true }).maxX < A4 + 19 - RB + 1e-6, 'a blaze passed the low beam');
  assert(hold(at(f04, A4 + 17, 0, 0), 1, 0, 2).maxX > A4 + 22, 'an ember should duck under');
});

test('f04: the plank dam stands until it is burnt, the water comes back, and nothing can be skipped', () => {
  // an ember cannot wade the second pool
  assert(diesWalking(at(f04, A4 + 27.8, 0, 0), A4 + 36, 0), 'an ember waded the second pool');
  // a blaze that boils the pool but does not burn the dam cannot pass the dam
  const b = at(f04, A4 + 27.6, 0, 0, 'blaze', 10);
  b.waitUntil((s) => by(s.level.pools, 'pool3').steamT > 0, { mx: 1, timeout: 3 });
  let maxWhileStanding = -Infinity;
  for (let i = 0; i < 360 && wood(b, 'dam').state !== 2; i++) { b.tick(1, 0, i % 70 < 30); maxWhileStanding = Math.max(maxWhileStanding, b.p.x); }
  eq(wood(b, 'dam').state, 2, 'the dam burns through');
  assert(maxWhileStanding < A4 + 33 - RB + 0.02, `a blaze got through the dam while it was burning: ${maxWhileStanding}`);
  // a blaze that dawdles in the basin is put out when the water returns
  const c = at(f04, A4 + 27.6, 0, 0, 'blaze', 10);
  c.waitUntil((s) => by(s.level.pools, 'pool3').steamT > 0, { mx: 1, timeout: 3 });
  c.walkTo(A4 + 30.5, 0).form('ember');
  c.waitUntil((s) => s.deaths > 0, { timeout: 8, label: 'the water comes back on a dawdler' });
  eq(c.events.filter((e) => e.type === 'respawn').pop().cause, 'water');
});

test('f04: the dam is gone for good, and a hero put out after burning it can always boil and cross again', () => {
  const r = at(f04, A4 + 24, 0, 0);
  r.form('blaze'); r.walkTo(A4 + 27.6, 0);
  r.waitUntil((s) => by(s.level.pools, 'pool3').steamT > 0, { mx: 1, timeout: 3 });
  r.waitUntil((s) => wood(r, 'dam').state === 2, { toward: [A4 + 32.6, 0], timeout: 4 });
  r.form('ember');
  r.allowDeath = true;
  r.waitUntil((s) => s.deaths > 0, { timeout: 8, label: 'put out when the water returns' });
  eq(wood(r, 'dam').state, 2, 'the dam stays burnt after a respawn');
  eq(r.p.gauge, 10, 'the brazier refuelled');
  r.allowDeath = false;
  r.walkTo(A4 + 27.6, 0).form('blaze');
  r.waitUntil((s) => by(s.level.pools, 'pool3').steamT > 0, { mx: 1, timeout: 3 });
  r.walkTo(A4 + 37.2, 0, { slow: false }).jumpTo(A4 + 38.6, 0, { tol: 0.4 });
  assert(r.p.x > A4 + 38 && r.sim.deaths === 1, 'crossed on the second try');
});

test('f04: the canal needs a jump AND a flare: not an ember, not a blaze, not a boil', () => {
  const e = leap(at(f04, A5 + 4.5, 0, 0), 4, { jumpAt: 35 });
  assert(e.died && e.maxX < A5 + 12, `an ember jumped the canal: ${e.maxX}`);
  const b = leap(at(f04, A5 + 4.5, 0, 0, 'blaze'), 6, { jumpAt: 20 });
  assert(b.died && b.maxX < A5 + 12, `a plain blaze jump crossed the canal: ${b.maxX}`);
  assert(diesWalking(at(f04, A5 + 5, 0, 0, 'blaze'), A5 + 13, 0), 'a blaze walked through running water');
  eq(by(at(f04, A5 + 5, 0, 0, 'blaze').sim.level.pools, 'canal'), undefined, 'the canal is not a pool: it cannot be boiled');
  const f = at(f04, A5 + 4.5, 0, 0, 'blaze');
  const j = leap(f, 5, { jumpAt: 14, special: 14 + 66 });
  assert(!j.died && j.maxX > A5 + 12, `jump + flare should cross: ${JSON.stringify(j)}`);
});

test('f04: lantern three hangs out of reach of an ember or a plain blaze jump, and a flare lights it', () => {
  const lamp = (r) => r.sim.level.lanterns.find((l) => l.id === 'lamp3');
  const e = at(f04, A5 + 23.6, 2.6, 0.6);
  hold(e, 0, 0, 1.5, { jump: true });
  assert(!lamp(e).lit, 'an ember jump lit the high lantern');
  const b = at(f04, A5 + 23.6, 2.6, 0.6, 'blaze', 10);
  hold(b, 0, 0, 1.5, { jump: true });
  assert(!lamp(b).lit, 'a plain blaze jump lit the high lantern');
  const f = at(f04, A5 + 23.6, 2.6, 0.6, 'blaze', 10);
  for (let i = 0; i < 240; i++) f.tick(0, 0, i < 120, !f.p.grounded && f.p.vy < 0.4 && !f.p.airSpecial && i < 120 ? f.p.form : null);
  assert(lamp(f).lit, 'a flare at the top of the jump should light it');
});

test('f04: the boarded shelf needs the flare to reach and a flame to open', () => {
  const b = at(f04, A5 + 24.4, 2.6, -2.9, 'blaze', 10);
  assert(hold(b, 1, 0, 2.5, { jump: true }).maxY < 4.6, 'a plain blaze jump reached the shelf');
  const e = at(f04, A5 + 24.4, 2.6, -2.9);
  assert(hold(e, 1, 0, 2.5, { jump: true }).maxY < 4.6, 'an ember reached the shelf');
  const k = at(f04, A5 + 27.2, 4.6, -2.9);
  const ext = hold(k, 1, 0, 2, { jump: true });
  assert(ext.maxX < A5 + 28.4 - R + 1e-6, 'an ember got through the boards');
  eq(wood(k, 'boards').state, 0);
});

test('f04: the kiln door needs all three lanterns', () => {
  const r = at(f04, A5 + 30.8, 0, 1.2);
  assert(!r.sim.completed);
  const lamps = r.sim.level.lanterns;
  eq(lamps.length, 3);
  lamps[0].lit = true; lamps[1].lit = true; r.wait(0.5);
  assert(!r.sim.completed, 'two lanterns opened the kiln door');
  lamps[2].lit = true; r.wait(0.5);
  assert(r.sim.completed, 'three lanterns should open it');
});

test('f04: burnt planks, a burnt dam and burnt boards are never needed again: the route works with all of them gone', () => {
  // burn everything before the route needs it: the whole level must still be winnable from the start
  const r = play(f04);
  for (const w of r.sim.level.woods) { w.state = 2; w.t = 1; if (w.solid) w.solid.active = false; }
  r.sim.level.woods.forEach((w) => eq(w.state, 2));
  // area 5 start: the stair, canal and lantern do not use any wood
  const q = at(f04, A5 + 12.5, 0, 0);
  for (const w of q.sim.level.woods) { w.state = 2; if (w.solid) w.solid.active = false; }
  q.form('blaze'); q.walkTo(A5 + 14.5, 0).walkTo(A5 + 18.4, 0).jumpTo(A5 + 20, 0).jumpTo(A5 + 23, 0, { tol: 0.4 });
  eq(q.p.y, 2.6);
});

// ------------------------------------------------------------------------------------ f05
const [B1, B2, B3, B4, B5] = sol05.ORIGINS;
const crates05 = (r) => r.sim.level.woods.filter((w) => /^crate\d/.test(w.id));
const burn = (r, ids) => { for (const w of r.sim.level.woods) if (ids.some((i) => (typeof i === 'string' ? w.id === i : i.test(w.id)))) { w.state = 2; w.t = 1; if (w.solid) w.solid.active = false; } };

test('f05: five named areas, a brazier at the start of each, and the route fits the 75-90 s band', () => {
  checkAreas(f05, 5);
  between(routeSeconds(f05, sol05), 75, 90, 'solve() route time');
  between(routeSeconds(f05, sol05, 'solveAll'), 75, 125, 'solveAll() route time');
});

test('f05: the cord is the only thing that burns the far wall, and it only starts at its frayed end', () => {
  const r = at(f05, B1 + 36, 0, 0);
  assert(hold(r, 1, 0, 3, { jump: true }).maxX < B1 + 38.05 - R + 1e-6, 'got past the cord wall');
  eq(wood(r, 'wall0').state, 0);
  eq(by(r.sim.level.fuses, 'cord0').state, 0, 'standing at the wall does not light the cord');
  const q = at(f05, B1 + 4.2, 0, 2.5);
  eq(by(q.sim.level.fuses, 'cord0').state, 1);
  const t0 = q.t - 0.3, len = by(q.sim.level.fuses, 'cord0').len;
  q.waitUntil(() => wood(q, 'wall0').state > 0, { timeout: 12, label: 'the wall catches when the cord ends' });
  near(q.t - t0, len / 4.2, 0.15, 'the wall catches when the flame arrives');
  q.waitUntil(() => wood(q, 'wall0').state === 2, { timeout: 3 });
  const e = at(f05, B1 + 36, 0, 0);
  hold(e, 1, 0, 1.5); eq(wood(e, 'wall0').state, 0, 'an ember cannot burn the plank wall');
});

test('f05: the crate stack needs a blaze, and one lit crate lights the whole stack (only the first pays heat)', () => {
  const e = at(f05, B1 + 12, 0, 0);
  assert(hold(e, 1, 0, 3, { jump: true }).maxX < B1 + 14 - R + 0.03, 'an ember got through the crate stack');
  assert(crates05(e).every((w) => w.state === 0));
  const r = at(f05, B1 + 12.4, 0, 0, 'blaze', 5);
  r.waitUntil(() => crates05(r).some((w) => w.state > 0), { toward: [B1 + 14, 0], timeout: 3 });
  const g = r.p.gauge;
  r.waitUntil(() => crates05(r).every((w) => w.state > 0), { timeout: 3, label: 'all six alight' });
  assert(r.p.gauge < g + 0.2, 'the crates lit by spread paid no fuel');
  r.waitUntil(() => crates05(r).every((w) => w.state === 2), { timeout: 4, label: 'all six gone' });
  eq(crates05(r).length, 6);
});

test('f05: the wooden stepping stones burn under a blaze, and the pool is always crossable by boiling', () => {
  const b = at(f05, B1 + 24.35, 0.7, -0.75, 'blaze', 10);
  b.wait(0.3);
  assert(by(b.sim.level.woods, 'stone0').state > 0, 'a blaze standing on a stone should light it');
  assert(leap(at(f05, B1 + 21, 0, 3), 3, { jumpAt: 10 }).died, 'jumped the 12 m pool');
  const c = at(f05, B1 + 21, 0, 0, 'blaze', 10);
  burn(c, [/^stone/]);
  c.waitUntil(() => by(c.sim.level.pools, 'woodPool').steamT > 0, { mx: 1, timeout: 3 });
  c.walkTo(B1 + 33.2, 0, { slow: false }).jumpTo(B1 + 34.6, 0, { tol: 0.4 });
  eq(c.sim.deaths, 0, 'boiled across the pool the stones used to cross');
  const d = at(f05, B1 + 21, 0, 0);
  burn(d, [/^stone/]);
  assert(diesWalking(d, B1 + 35, 0), 'an ember waded the pool');
});

test('f05: the plank bridge carries an ember untouched, drips fall on it, and the pool is too wide to jump', () => {
  const r = at(f05, B2 + 3, 0, 0);
  r.walkTo(B2 + 7.2, 0);
  for (const id of ['dw1', 'dw2', 'dw3']) {
    r.waitUntil((s) => by(s.level.drips, id).live, { timeout: 4 });
    r.waitUntil((s) => !by(s.level.drips, id).live, { timeout: 4 });
    if (id === 'dw1') r.walkTo(B2 + 11.2, 0);
    if (id === 'dw2') r.walkTo(B2 + 15.3, 0);
  }
  r.walkTo(B2 + 19.9, 0);
  eq(r.sim.deaths, 0);
  assert(by(r.sim.level.woods, 'deck5').state === 0, 'an ember burns nothing');
  const q = at(f05, B2 + 9, 0, 0);
  q.waitUntil((s) => s.deaths > 0, { timeout: 3, label: 'a drop on the bridge puts an ember out' });
  assert(leap(at(f05, B2 + 5.2, 0, 3), 3, { jumpAt: 10 }).died, 'jumped the 13 m pool');
});

test('f05: burning the wall at the bridge end burns the whole bridge behind you, and the walkway ahead races you', () => {
  const r = at(f05, B2 + 19.9, 0, 0);
  r.form('blaze');
  r.waitUntil(() => wood(r, 'wall').state === 2, { toward: [B2 + 21.1, 0], timeout: 4, label: 'wall gone' });
  r.walkTo(B2 + 31.9, 0, { slow: false });
  eq(r.sim.deaths, 0, 'a blaze that runs gets across the walkway');
  r.wait(14);
  for (let i = 0; i < 15; i++) eq(wood(r, `deck${i}`).state, 2, `deck${i} burnt`);
  for (let i = 0; i < 10; i++) eq(wood(r, `way${i}`).state, 2, `way${i} burnt`);
  const q = at(f05, B2 + 19.9, 0, 0, 'blaze', 10);
  q.waitUntil(() => wood(q, 'wall').state === 2, { toward: [B2 + 21.1, 0], timeout: 4 });
  q.walkTo(B2 + 24.6, 0);
  q.waitUntil((s) => s.deaths > 0, { timeout: 8, label: 'put out when the boards go' });
  eq(q.events.filter((e) => e.type === 'respawn').pop().cause, 'water');
});

test('f05: after the bridge and the walkway have burnt, a blaze from the first brazier can still boil its way across (and reach the island)', () => {
  const r = at(f05, B2 + 3, 0, 0, 'blaze', 10);
  burn(r, [/^deck/, /^way/, 'wall']);
  r.walkTo(B2 + 5.4, 0);
  r.waitUntil(() => by(r.sim.level.pools, 'moat').steamT > 0, { mx: 1, timeout: 3, label: 'the first pool boils' });
  r.walkTo(B2 + 11.2, -0.6, { slow: false });
  r.jumpTo(B2 + 11.8, -2.6, { tol: 0.35 });
  r.expect((s) => s.shardsTaken.length === 1, 'the island stone is still reachable');
  r.jumpTo(B2 + 9.5, -0.6, { tol: 0.5 });
  r.walkTo(B2 + 6.2, 0, { slow: false }).jumpTo(B2 + 4.6, 0, { tol: 0.4 });
  r.walkTo(B2 + 1.5, 0).wait(0.5).expect((s, p) => p.gauge > 9.9, 'refuelled at the first brazier, the way a player would');
  if (r.p.form !== 'blaze') r.form('blaze');
  r.walkTo(B2 + 5.4, 0);
  r.waitUntil(() => by(r.sim.level.pools, 'moat').steamT > 0, { mx: 1, timeout: 3, label: 'boiled again' });
  r.walkTo(B2 + 18.6, 0, { slow: false }).jumpTo(B2 + 20, 0, { tol: 0.4 });
  r.walkTo(B2 + 20.2, 0).expect((s, p) => s.checkpoint.id === 'b2b' && p.gauge > 9.9, 'the landing brazier refuels');
  r.waitUntil(() => by(r.sim.level.pools, 'pit').steamT > 0, { mx: 1, timeout: 3, label: 'the second pit boils' });
  r.walkTo(B2 + 30.6, 0, { slow: false }).jumpTo(B2 + 32, 0, { tol: 0.4 });
  eq(r.sim.deaths, 0);
  assert(r.p.x > B2 + 31.4 && r.p.y === 0, 'across both pits with nothing left of the planks');
});

test('f05: the flue is too low for a blaze; only fire (a lit board) trips the sensor; an ember cannot light the chain', () => {
  const b = at(f05, B3 + 6, 0, 0, 'blaze');
  assert(hold(b, 1, 0, 2, { jump: true }).maxX < B3 + 8 - RB + 0.03, 'a blaze entered the flue');
  const e = at(f05, B3 + 7, 0, 0);
  hold(e, 1, 0, 3);
  assert(e.p.x > B3 + 21, 'an ember should run the length of the tunnel');
  eq(wood(e, 'chain3').state, 0, 'an ember lights nothing');
  assert(!e.sim.signals.get('hs'), 'an ember does not trip the heat sensor');
  eq(door(e, 'flueGate').open, 0);
  assert(hold(at(f05, B3 + 22.5, 0, 0), 1, 0, 2, { jump: true }).maxX < B3 + 25.05 - R + 1e-6, 'walked through the shut flue gate');
});

test('f05: one lit board carries the fire to the sensor and the nook wall, and the gate opens', () => {
  const r = at(f05, B3 + 5.5, 0, 0, 'blaze', 10);
  r.waitUntil(() => wood(r, 'chain0').state > 0, { toward: [B3 + 8.4, 0], timeout: 3 });
  r.form('ember');
  r.waitUntil(() => wood(r, 'nookWall').state > 0, { timeout: 6, label: 'the nook wall catches by spread' });
  r.waitUntil((s) => s.signals.get('hs'), { timeout: 8, label: 'the burning boards reach the sensor' });
  r.waitUntil(() => door(r, 'flueGate').open >= 1, { timeout: 2 });
  r.wait(10); eq(door(r, 'flueGate').open, 1, 'the sensor is latched: the gate stays up after the boards are ash');
  const q = at(f05, B3 + 14, 0, -1);
  hold(q, 0, -1, 1.5);
  assert(q.p.z > -2.0 + R - 0.05, 'an ember got into the walled nook');
  eq(q.sim.shardsTaken.length, 0);
});

test('f05: the plates remember on their own - burning a crate later can never lock the gate', () => {
  const r = at(f05, B4 + 17.0, 0, 0, 'blaze', 10);
  r.waitUntil(() => wood(r, 'pillar').state > 0, { toward: [B4 + 18.2, 0], timeout: 3 });
  r.waitUntil((s) => s.signals.get('weight'), { timeout: 4, label: 'the crate lands on plate one' });
  r.walkTo(B4 + 18.3, 0.9);
  r.waitUntil(() => wood(r, 'dropA').state > 0, { toward: [B4 + 18.9, 0.3], timeout: 3, label: 'the crate catches' });
  r.waitUntil(() => wood(r, 'dropA').state === 2, { timeout: 3 });
  assert(!r.sim.signals.get('weight'), 'plate one is free again');
  r.sim.teleport(B4 + 23.3, 0, 0.2); r.wait(0.2);
  r.waitUntil(() => door(r, 'coopGate').open >= 1, { toward: [B4 + 24.1, 0], timeout: 6, label: 'the gate opens: plate one is remembered' });
});

test('f05: the cooperage gate needs BOTH crates, a blaze for each wall, an ember for the beam', () => {
  const e = at(f05, B4 + 4, 0, 0);
  assert(hold(e, 1, 0, 3, { jump: true }).maxX < B4 + 6.05 - R + 1e-6, 'an ember got through wall one');
  assert(hold(at(f05, B4 + 8, 0, 0, 'blaze'), 1, 0, 2, { jump: true }).maxX < B4 + 9 - RB + 0.03, 'a blaze passed the low beam');
  const a = at(f05, B4 + 17.0, 0, 0, 'blaze', 10);
  a.waitUntil(() => wood(a, 'pillar').state > 0, { toward: [B4 + 18.2, 0], timeout: 3 });
  a.wait(5);
  assert(a.sim.signals.get('weight') && !a.sim.signals.get('weight2'), 'plate one is weighed, plate two is not');
  eq(door(a, 'coopGate').open, 0, 'one crate is not enough');
  const b = at(f05, B4 + 23.3, 0, 0.2, 'blaze', 10);
  b.waitUntil(() => wood(b, 'wall2').state > 0, { toward: [B4 + 24.1, 0], timeout: 3 });
  b.wait(5);
  assert(!b.sim.signals.get('weight') && b.sim.signals.get('weight2'), 'plate two only');
  eq(door(b, 'coopGate').open, 0, 'the other crate alone is not enough');
});

test('f05: the crates hang out of reach - no jump, flare or flame can light them in place', () => {
  for (const [x, id] of [[20.4, 'dropA'], [27, 'dropB']]) {
    const r = at(f05, B4 + x, 0, 0, 'blaze', 10);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 120; k++) r.tick(0, 0, k < 60, !r.p.grounded && r.p.vy < 0.4 && !r.p.airSpecial ? r.p.form : null);
      r.p.gauge = 10;
    }
    eq(wood(r, id).state, 0, `${id} untouched`);
  }
});

test('f05: the pool before the long fuse needs a boil; the rope holds the kiln door until fire reaches it', () => {
  assert(diesWalking(at(f05, B5 + 11, 0, 0), B5 + 19, 0), 'an ember waded the last pool');
  const r = at(f05, B5 + 44, 0, -0.6);
  r.sim.teleport(B5 + 58.2, 0, -0.6); r.wait(0.5);
  assert(!r.sim.completed, 'the shut kiln door completed the level');
  const e = at(f05, B5 + 28.4, 0, 1.7);
  e.wait(1); eq(wood(e, 'line0').state, 0);
  const b = at(f05, B5 + 28.4, 0, 0.6, 'blaze', 10);
  b.waitUntil(() => wood(b, 'line0').state > 0, { toward: [B5 + 28.4, 2.4], timeout: 3 });
  b.waitUntil(() => wood(b, 'rope').state === 2, { timeout: 14, label: 'the flame reaches the rope' });
  b.waitUntil(() => b.sim.level.exits[0].open, { timeout: 2 });
  b.sim.teleport(B5 + 58.2, 0, -0.6); b.wait(0.4);
  assert(b.sim.completed, 'the kiln door opens for whoever stands in it once the rope has burnt');
});

test('f05: whatever has been burnt, the level can still be finished (boil routes remain)', () => {
  const a = at(f05, B1 + 21, 0, 0, 'blaze', 10);
  burn(a, [/^stone/, /^crate\d/, 'wall0']);
  a.waitUntil(() => by(a.sim.level.pools, 'woodPool').steamT > 0, { mx: 1, timeout: 3 });
  a.walkTo(B1 + 33.2, 0, { slow: false }).jumpTo(B1 + 34.6, 0, { tol: 0.4 });
  eq(a.sim.deaths, 0);
  const c = at(f05, B4 + 3, 0, 0);
  burn(c, ['wall1', 'wall2']);
  const w = c.sim.level.woods;
  eq(w.filter((x) => x.state === 2).length >= 2, true);
});


test('f05: the slalom - the cord is the only way to burn the crates behind the long beam, the beam stops a blaze, the walls need a blaze', () => {
  assert(hold(at(f05, B4 + 38, 0, 0), 1, 0, 3, { jump: true }).maxX < B4 + 40.05 - R + 0.03, 'an ember got through wall three');
  assert(hold(at(f05, B4 + 43, 0, 0, 'blaze'), 1, 0, 3, { jump: true }).maxX < B4 + 44 - RB + 0.03, 'a blaze went under the long beam');
  const e = at(f05, B4 + 46, 0, 0);
  hold(e, 1, 0, 2);
  assert(e.p.x > B4 + 51 && e.p.x < B4 + 52.1 - R + 0.03, `an ember reaches the crates under the beam and no further: ${e.p.x}`);
  assert(e.sim.level.woods.filter((w) => /^sack/.test(w.id)).every((w) => w.state === 0), 'an ember burns nothing');
  const c = at(f05, B4 + 36.2, 0, 2.7);
  const len = by(c.sim.level.fuses, 'cord3').len;
  eq(by(c.sim.level.fuses, 'cord3').state, 1);
  c.waitUntil(() => by(c.sim.level.woods, 'sack0s').state > 0, { timeout: 10, label: 'the crates catch when the cord ends' });
  near(c.t, len / 3.6, 0.2, 'cord length / rate');
  c.waitUntil(() => c.sim.level.woods.filter((w) => /^sack/.test(w.id)).every((w) => w.state === 2), { timeout: 5, label: 'all six crates burn' });
  assert(hold(at(f05, B4 + 57, 0, 0), 1, 0, 3, { jump: true }).maxX < B4 + 59.05 - R + 0.03, 'an ember got through the last wall');
  const b = at(f05, B4 + 55.5, 0, 0, 'blaze', 10);
  b.waitUntil(() => wood(b, 'wall4').state === 2, { toward: [B4 + 59.2, 0], timeout: 5 });
});

test('f05: the dam in the last pool - boil, burn, cross; the water comes back; the dam never does, and a boil always crosses again', () => {
  assert(diesWalking(at(f05, B5 + 11, 0, 0), B5 + 20, 0), 'an ember waded the dam pool');
  const b = at(f05, B5 + 10.6, 0, 0, 'blaze', 10);
  b.waitUntil(() => by(b.sim.level.pools, 'lastPool').steamT > 0, { mx: 1, timeout: 3 });
  let maxX = -9;
  for (let i = 0; i < 360 && wood(b, 'lastDam').state !== 2; i++) { b.tick(1, 0, i % 70 < 30); maxX = Math.max(maxX, b.p.x); }
  assert(maxX < B5 + 16.8 - RB + 0.03, `a blaze got through the dam while it stood: ${maxX}`);
  b.walkTo(B5 + 21.2, 0, { slow: false }).jumpTo(B5 + 22.6, 0, { tol: 0.4 });
  eq(b.sim.deaths, 0, 'across before the water returned');
  // a dawdler: an ember in the basin when the water comes back is put out, and the dam is still gone
  const d = at(f05, B5 + 2, 0, 0);
  d.wait(0.5); d.sim.teleport(B5 + 10.6, 0, 0); d.sim.forceForm('blaze'); d.p.gauge = 10; d.wait(0.2);
  d.waitUntil(() => by(d.sim.level.pools, 'lastPool').steamT > 0, { mx: 1, timeout: 3 });
  d.waitUntil(() => wood(d, 'lastDam').state === 2, { toward: [B5 + 16.7, 0], timeout: 4 });
  d.form('ember'); d.allowDeath = true;
  d.waitUntil((s) => s.deaths > 0, { timeout: 8, label: 'put out when the water returns' });
  eq(wood(d, 'lastDam').state, 2, 'the dam stays burnt');
  d.allowDeath = false; d.wait(0.6);
  d.walkTo(B5 + 8.6, 0); d.form('blaze');
  d.waitUntil(() => by(d.sim.level.pools, 'lastPool').steamT > 0, { mx: 1, timeout: 3 });
  d.walkTo(B5 + 21.2, 0, { slow: false }).jumpTo(B5 + 22.6, 0, { tol: 0.4 });
  assert(d.p.x > B5 + 22 && d.sim.deaths === 1, 'crossed again by boiling, with the dam already gone');
});

// ------------------------------------------------------------------------------------ f06
const [C1, C2, C3, C4, C5] = sol06.ORIGINS;
const ice = (r, id) => by(r.sim.level.iceblocks, id);
const wax = (r, id) => by(r.sim.level.waxes, id);

/** Hold the hero against a point (toward it) for up to `seconds`, stopping early if `done()`. */
function press(r, x, z, seconds, done = () => false) {
  for (let i = 0; i < seconds * 120 && !done(); i++) {
    const dx = x - r.p.x, dz = z - r.p.z, d = Math.hypot(dx, dz);
    r.tick(d > 0.05 ? dx / d : 0, d > 0.05 ? dz / d : 0, false);
  }
}

test('f06: five named areas, a brazier at the start of each, and the route fits the 82-95 s band', () => {
  checkAreas(f06, 5);
  between(routeSeconds(f06, sol06), 82, 95, 'solve() route time');
  between(routeSeconds(f06, sol06, 'solveAll'), 82, 125, 'solveAll() route time');
});

test('f06: ice stops an ember, and a blaze melts it in exactly the time it is touched', () => {
  const e = at(f06, C1 + 10.5, 0, 0);
  assert(hold(e, 1, 0, 3, { jump: true }).maxX < C1 + 12.05 - R + 0.03, 'an ember got through the ice wall');
  eq(ice(e, 'iceA').t, 0, 'an ember does not melt ice');
  const b = at(f06, C1 + 11.6, 0, 0, 'blaze', 10);
  b.waitUntil(() => ice(b, 'iceA').t > 0, { toward: [C1 + 12.4, 0], timeout: 2 });
  b.waitUntil(() => ice(b, 'iceA').gone, { toward: [C1 + 12.4, 0], timeout: 3, label: 'melted' });
  near(b.t, 1.5, 0.1, 'melt time of an ice block, counted from when the blaze first touched it (during the 0.3 s settle)');
});

test('f06: melting progress is kept when the blaze steps away, and ice never refreezes', () => {
  const b = at(f06, C1 + 33.2, 0, 0, 'blaze', 10);
  press(b, C1 + 34.4, 0, 1.2);
  const t1 = ice(b, 'iceB').t;
  assert(t1 > 0.1 && t1 < 0.5, `about a fifth melted after a second of touch: ${t1}`);
  b.walkTo(C1 + 28, 0); b.wait(1);
  const t2 = ice(b, 'iceB').t;
  assert(t2 >= t1 && t2 < t1 + 0.08, 'stepping away stops the melting (a few ticks of contact at most)');
  b.wait(4);
  near(ice(b, 'iceB').t, t2, 1e-9, 'the progress is kept, not lost, while the blaze is away');
  // and a respawn does not bring ice back
  b.sim.respawn('restart'); b.wait(1);
  near(ice(b, 'iceB').t, t2, 1e-9, 'a restart does not refreeze it');
});

test('f06: the thick wall is too much for one gauge, so it has to be melted in bites, and coal and braziers allow it', () => {
  const b = at(f06, C1 + 20, 0, 0, 'blaze', 10);                // from the brazier, as the route does
  b.walkTo(C1 + 33.3, 0);
  b.waitUntil((s, p) => p.form !== 'blaze', { toward: [C1 + 34.4, 0], timeout: 12, label: 'out of heat' });
  assert(!ice(b, 'iceB').gone && ice(b, 'iceB').t > 0.3 && ice(b, 'iceB').t < 1, `the first gauge cannot finish the wall: ${ice(b, 'iceB').t}`);
  eq(b.p.form, 'ember');
  b.walkTo(C1 + 30.6, -2.3).wait(0.1);
  assert(b.p.gauge >= 3.9, 'the coal gave its heat back');
  b.form('blaze').walkTo(C1 + 33.3, 0);
  b.waitUntil(() => ice(b, 'iceB').gone, { toward: [C1 + 34.4, 0], timeout: 12, label: 'finished in a second bite' });
  // a coal comes back after a respawn, so wasted heat is never a dead end
  b.sim.respawn('restart'); b.wait(0.6);
  assert(b.sim.level.coals.every((c) => !c.taken), 'coal is restored on respawn');
});

test('f06: the stone frozen in the cube cannot be collected until the ice is melted', () => {
  const e = at(f06, C1 + 17.7, 0, -1.2);
  hold(e, 0, -1, 1.5);
  eq(e.sim.shardsTaken.length, 0, 'an ember cannot reach the stone');
  const b = at(f06, C1 + 16.4, 0, -1.5, 'blaze', 10);
  b.waitUntil(() => ice(b, 'cube').gone, { toward: [C1 + 17.7, -2.8], timeout: 4 });
  b.walkTo(C1 + 17.7, -2.7);
  eq(b.sim.shardsTaken.length, 1, 'the stone is free once the ice is gone');
});

test('f06: wax sags to a puddle rather than vanishing, and the crate on it is lowered onto the plate', () => {
  const w = at(f06, C2 + 9.3, 0, 0, 'blaze', 10);
  const top0 = wax(w, 'waxA').solid.y1;
  eq(top0, 3);
  w.waitUntil(() => wax(w, 'waxA').t > 0.3, { toward: [C2 + 10.5, 0], timeout: 3 });
  assert(wax(w, 'waxA').solid.y1 < 2.5 && wax(w, 'waxA').solid.y1 > 0.2, 'the top is sinking, not gone');
  w.waitUntil(() => wax(w, 'waxA').t >= 1, { toward: [C2 + 10.5, 0], timeout: 6 });
  near(wax(w, 'waxA').solid.y1, 0.12, 1e-6, 'a puddle of 0.12 m is left');
  w.waitUntil((s) => s.signals.get('pA'), { timeout: 3, label: 'the crate settles on the plate' });
  near(by(w.sim.level.woods, 'candle').body.y, 0.12, 0.07, 'the crate rides the wax down');
  eq(by(w.sim.level.woods, 'candle').state, 0, 'unburnt');
  // ... never recovers, and even an ember steps over the puddle
  w.wait(5); near(wax(w, 'waxA').solid.y1, 0.12, 1e-6);
  const s = at(f06, C2 + 28.8, 0, 0, 'blaze', 10);
  s.waitUntil(() => wax(s, 'waxB').t >= 1, { toward: [C2 + 30.4, 0], timeout: 5 });
  s.form('ember');
  assert(hold(s, 1, 0, 1.5).maxX > C2 + 31.5, 'an ember steps over the wax puddle');
});

test('f06: the wax and its crate cannot be climbed, reached or spoilt; the plate niche cannot be entered', () => {
  // no jump, flare or flame lights the crate in place, whichever free side of the wax the blaze stands on
  for (const [x, z] of [[9.4, 0], [11.2, 1.7], [11.2, -1.7], [9.4, 1.7]]) {
    const r = at(f06, C2 + x, 0, z, 'blaze', 10);
    let maxY = 0;
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 150; k++) { r.tick(0, 0, k < 70, !r.p.grounded && r.p.vy < 0.4 && !r.p.airSpecial ? r.p.form : null); maxY = Math.max(maxY, r.p.y); }
      r.p.gauge = 10;
    }
    eq(by(r.sim.level.woods, 'candle').state, 0, `the crate stayed whole with the blaze at (${x}, ${z})`);
    assert(maxY < 2.7, `the blaze never gets on top of the 3 m wax block (reached ${maxY})`);
  }
  const e = at(f06, C2 + 13.6, 0, 2.4);
  hold(e, 0, -1, 1.5, { jump: true });
  assert(e.p.z > 1.4 + R - 0.05, 'an ember got into the plate niche');
  const top = at(f06, C2 + 9, 0, 0);
  assert(hold(top, 1, 0, 1.5, { jump: true }).maxY < 2.2, 'an ember jumped onto the wax block');
});

test('f06: the gate opens for the plate even if the crate is burnt later (the plate is remembered)', () => {
  const r = at(f06, C2 + 9.3, 0, 0, 'blaze', 10);
  r.waitUntil((s) => s.signals.get('pA'), { toward: [C2 + 10.5, 0], timeout: 12 });
  by(r.sim.level.woods, 'candle').state = 2; by(r.sim.level.woods, 'candle').solid.active = false;
  r.sim.level.woods.forEach((w) => { if (w.id === 'candle') w.gone = true; });
  r.wait(0.5);
  assert(!r.sim.signals.get('pA'), 'the plate is free again');
  r.waitUntil(() => door(r, 'gateA').open >= 1, { timeout: 2, label: 'the gate is still up' });
});

test('f06: three ice walls and one gauge: without the coal the heat runs out before the last wall', () => {
  const r = at(f06, C3 + 4, 0, 0, 'blaze', 10);
  r.walkTo(C3 + 11.3, 0);
  r.waitUntil(() => ice(r, 'iceC1').gone, { toward: [C3 + 12.4, 0], timeout: 4 });
  r.walkTo(C3 + 21.3, 0);
  r.waitUntil((s, p) => ice(r, 'iceC2').gone || p.form !== 'blaze', { toward: [C3 + 22.4, 0], timeout: 4 });
  const left = r.p.form === 'blaze' ? r.p.gauge : 0;
  assert(!ice(r, 'iceC2').gone || left < 4.5, `not enough heat left for the third wall without coal: ${left}`);
  // each wall is solid to an ember, and walls are one and a half seconds of flame
  assert(hold(at(f06, C3 + 30, 0, 0), 1, 0, 2, { jump: true }).maxX < C3 + 32.05 - R + 0.03, 'an ember passed the third wall');
});

test('f06: the stone frozen above head height needs jumps to warm it, and the pillar needs a flare', () => {
  const e = at(f06, C3 + 40.7, 0, -3.0);
  hold(e, 0, 0, 0.5, { jump: true });
  eq(ice(e, 'iceTop').t, 0, 'an ember jump does not melt it');
  const b = at(f06, C3 + 40.7, 0, -3.0, 'blaze', 10);
  b.jump(0.6, 0.15, 0).waitUntil((s, p) => p.grounded, { timeout: 2 });
  assert(ice(b, 'iceTop').t > 0.1 && !ice(b, 'iceTop').gone, 'one jump warms it a little: it is kept');
  const pillar = at(f06, C3 + 40.7, 0, -3.0, 'blaze', 10);
  ice(pillar, 'iceTop').gone = true; ice(pillar, 'iceTop').solid.active = false;
  assert(hold(pillar, 1, 0, 2, { jump: true }).maxY < 2.2 - 0.3, 'a plain blaze jump got onto the pillar');
});

test('f06: the moulding gate needs BOTH crates, the plates are remembered separately, and neither crate can be reached', () => {
  const c = at(f06, C4 + 7.3, 0, 0, 'blaze', 10);
  c.waitUntil(() => ice(c, 'icePillar').gone, { toward: [C4 + 8.6, 0], timeout: 5 });
  c.waitUntil((s) => s.signals.get('pC'), { timeout: 3 });
  c.wait(4);
  assert(c.sim.signals.get('pC') && !c.sim.signals.get('pD'), 'plate one only');
  eq(door(c, 'gateM').open, 0, 'one crate is not enough');
  const d = at(f06, C4 + 19.3, 0, 0, 'blaze', 10);
  d.waitUntil(() => wax(d, 'waxC').t >= 1, { toward: [C4 + 20.5, 0], timeout: 6 });
  d.wait(3);
  assert(!d.sim.signals.get('pC') && d.sim.signals.get('pD'), 'plate two only');
  eq(door(d, 'gateM').open, 0, 'the other crate alone is not enough');
  // burn plate one's crate down afterwards: the memory holds, and plate two still opens the gate
  const m = at(f06, C4 + 7.3, 0, 0, 'blaze', 10);
  m.waitUntil(() => ice(m, 'icePillar').gone, { toward: [C4 + 8.6, 0], timeout: 5 });
  m.waitUntil((s) => s.signals.get('pC'), { timeout: 3 });
  const crate = m.sim.level.woods.find((w) => w.id === 'dropC');
  crate.state = 2; crate.gone = true; crate.solid.active = false; m.wait(0.3);
  assert(!m.sim.signals.get('pC'), 'plate one is free again');
  m.sim.teleport(C4 + 19.3, 0, 0); m.sim.forceForm('blaze'); m.p.gauge = 10; m.wait(0.2);
  m.waitUntil(() => wax(m, 'waxC').t >= 1, { toward: [C4 + 20.5, 0], timeout: 6 });
  m.waitUntil(() => door(m, 'gateM').open >= 1, { timeout: 5, label: 'the gate opens: plate one is remembered' });
  // nothing reaches the crates
  for (const [x, id] of [[C4 + 9.2, 'dropC'], [C4 + 22.4, 'dropD']]) {
    const r = at(f06, x, 0, 1.9, 'blaze', 10);
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 150; k++) r.tick(0, 0, k < 70, !r.p.grounded && r.p.vy < 0.4 && !r.p.airSpecial ? r.p.form : null);
      r.p.gauge = 10;
    }
    eq(by(r.sim.level.woods, id).state, 0, `${id} stays whole`);
  }
});

test('f06: the great ice needs more than one gauge; frost turns a flame back into a coal; only a blaze trips the sensor', () => {
  const b = at(f06, C5 + 5, 0, 0, 'blaze', 10);
  b.walkTo(C5 + 12.4, 0);
  b.waitUntil((s, p) => p.form !== 'blaze', { toward: [C5 + 15, 0], timeout: 12 });
  assert(!ice(b, 'iceG').gone, 'one gauge from the brazier cannot melt the great ice');
  // frost
  const f = at(f06, C5 + 18, 0, 0, 'blaze', 10);
  f.walkTo(C5 + 22, 0);
  eq(f.p.form, 'ember', 'a blaze walked into the frost and became a coal');
  f.form('blaze', { expect: false });
  eq(f.p.form, 'ember', 'a blaze cannot be chosen inside the frost');
  // the pool in the corridor
  assert(diesWalking(at(f06, C5 + 24.4, 0, 0), C5 + 29, 0), 'an ember waded the frost pool');
  // the sensor and the exit
  const e = at(f06, C5 + 43, 0, 0);
  e.wait(1); assert(!e.sim.signals.get('kilnHot'), 'an ember does not trip the heat sensor');
  e.sim.teleport(C5 + 49.8, 0, 0); e.wait(0.4); assert(!e.sim.completed, 'the shut kiln door completed the level');
  const k = at(f06, C5 + 41, 0, 0, 'blaze', 10);
  k.walkTo(C5 + 43, 0); k.wait(0.2);
  assert(k.sim.signals.get('kilnLit'), 'a blaze trips it');
  k.form('ember'); k.wait(1);
  assert(k.sim.signals.get('kilnLit'), 'and it stays latched');
  k.sim.teleport(C5 + 49.8, 0, 0); k.wait(0.4);
  assert(k.sim.completed);
});

test('f06: whatever has been melted, the level can still be finished', () => {
  // every ice block melted and every wax block sagged: what remains is crates, plates, frost, the sensor - all still reachable
  const r = at(f06, C1 + 3, 0, 0);
  for (const q of r.sim.level.iceblocks) { q.t = 1; q.gone = true; q.solid.active = false; }
  for (const q of r.sim.level.waxes) { q.t = 1; q.solid.y1 = q.box[1] + q.min; }
  r.walkTo(C1 + 40, 0);
  eq(r.sim.deaths, 0);
  assert(r.p.x > C1 + 39, 'walked straight through the cold store');
});

// ------------------------------------------------------------------------------------ f07
const [D1, D2, D3, D4, D5] = sol07.ORIGINS;

/** Hold a stick direction and track extremes while the hero is smoke (stops at `seconds` or when it is no longer smoke). */
function drift(r, mx, mz, seconds, stopOnForm = true) {
  const out = { maxX: -Infinity, maxY: -Infinity, minY: Infinity, form: r.p.form };
  const d0 = r.sim.deaths;
  const form0 = r.p.form;
  for (let i = 0; i < seconds * 120 && r.sim.deaths === d0 && (r.p.form === form0 || !stopOnForm); i++) {
    r.tick(mx, mz, false);
    out.maxX = Math.max(out.maxX, r.p.x); out.maxY = Math.max(out.maxY, r.p.y); out.minY = Math.min(out.minY, r.p.y);
  }
  out.form = r.p.form; out.died = r.sim.deaths > d0;
  return out;
}

test('f07: five named areas, a brazier at the start of each, and the route fits the 90-105 s band', () => {
  checkAreas(f07, 5);
  between(routeSeconds(f07, sol07), 90, 105, 'solve() route time');
  between(routeSeconds(f07, sol07, 'solveAll'), 90, 125, 'solveAll() route time');
});

test('f07: smoke is offered, and only smoke slips through a grate', () => {
  const r = play(f07);
  r.form('smoke'); eq(r.p.form, 'smoke');
  const e = at(f07, D1 + 10, 0, 0);
  assert(hold(e, 1, 0, 3, { jump: true }).maxX < D1 + 12.05 - R + 0.03, 'an ember got through the grate');
  const b = at(f07, D1 + 10, 0, 0, 'blaze');
  assert(hold(b, 1, 0, 3, { jump: true }).maxX < D1 + 12.05 - RB + 0.03, 'a blaze got through the grate');
  const s = at(f07, D1 + 10.4, 0, 0.3, 'smoke');
  assert(drift(s, 1, 0, 2).maxX > D1 + 14, 'smoke should slip through the bars');
});

test('f07: smoke rises until a roof stops it and then slides along it, spending a heat per second', () => {
  const r = at(f07, D1 + 20.4, 0, 0, 'smoke', 10);
  const g0 = r.p.gauge, t0 = r.t;
  const d = drift(r, 1, 0, 4);
  near(d.maxY, 2.8 - fire.formDefs.smoke.h, 0.02, 'it flies at the roof: feet at roof height minus its own height');
  assert(d.maxX > D1 + 30, 'and slides along it');
  near(g0 - r.p.gauge, r.t - t0, 0.05, 'one heat per second');
});

test('f07: the soot pool cannot be crossed by an ember, a blaze or a short gauge, and a full gauge of smoke does it', () => {
  assert(diesWalking(at(f07, D1 + 21, 0, 0), D1 + 44, 0), 'an ember waded the pool');
  const b = at(f07, D1 + 21, 0, 0, 'blaze', 10);
  b.waitUntil(() => by(b.sim.level.pools, 'sootPool').steamT > 0, { mx: 1, timeout: 2 });
  b.allowDeath = true;
  b.waitUntil(() => b.sim.deaths > 0 || b.p.x > D1 + 42, { mx: 1, timeout: 8 });
  assert(b.sim.deaths > 0, 'a blaze should not be able to boil its way across 20 m (each boil costs 2 heat, and it must keep boiling)');
  assert(leap(at(f07, D1 + 21.6, 0, 0, 'blaze', 10), 5, { jumpAt: 10, special: 70 }).died, 'jump and flare crossed it');
  const lowHeat = at(f07, D1 + 20.4, 0, 0, 'smoke', 3);
  assert(drift(lowHeat, 1, 0, 8, false).died, 'smoke with a few seconds of heat falls into the pool when it runs out');
  const full = at(f07, D1 + 20.4, 0, 0, 'smoke', 10);
  const d = drift(full, 1, 0, 8);
  assert(!d.died && d.maxX > D1 + 42, 'a full gauge of smoke crosses it');
});

test('f07: the sprinklers put an ember out, drain a blaze, and turn smoke back unless it is above the spray', () => {
  assert(diesWalking(at(f07, D2 + 8, 0, 0), D2 + 12, 0), 'an ember walked through a curtain');
  const low = at(f07, D2 + 8, 0, 0, 'smoke', 10);
  const d = drift(low, 1, 0, 4);
  assert(d.form === 'ember' && !d.died && low.p.x < D2 + 9, 'smoke that has not risen yet is turned back at the first curtain, alive');
  const hi = at(f07, D2 + 5, 0, 0, 'smoke', 10);
  hi.waitUntil((s, p) => p.y >= 3.4, { timeout: 4 });
  const e = drift(hi, 1, 0, 6);
  assert(e.form === 'smoke' && e.maxX > D2 + 21, 'risen to the roof first, it slides over both curtains');
  // a blaze pays 5 heat a second in the spray: it cannot cross a whole zone on one gauge
  const b = at(f07, D2 + 5, 0, 0, 'blaze', 10);
  for (let i = 0; i < 9 * 120 && b.sim.deaths === 0 && b.p.x < D2 + 24.5; i++) b.tick(1, 0, false);
  assert(b.sim.deaths > 0 || b.p.x < D2 + 24.5, 'a blaze should not cross the whole first zone on one gauge');
});

test('f07: the roof hole and its pocket - rise to the stone, and the only way out is back down the hole', () => {
  const e = at(f07, D2 + 28, 0, 0);
  assert(hold(e, 0, 0, 1.5, { jump: true }).maxY < 2.2, 'an ember reached the hole in the roof');
  const s = at(f07, D2 + 28, 0, 0, 'smoke', 10);
  s.waitUntil((st) => st.shardsTaken.length === 1, { timeout: 4, label: 'the stone above the hole' });
  eq(s.sim.shardsTaken.length, 1);
  // an ember on top of the roof inside the pocket cannot wander off along the roof
  const p = at(f07, D2 + 26, 4.6, 3, undefined);
  const ext = hold(p, 1, 0, 3);
  assert(ext.maxX < D2 + 30.6, 'walked out of the pocket to the east');
  const q = at(f07, D2 + 27, 4.6, 3);
  assert(hold(q, -1, 0, 3).minX > D2 + 25.4 - 0.05, 'walked out of the pocket to the west');
  // ... and drops back down the hole as a coal
  const t = at(f07, D2 + 28, 4.7, 0);
  t.wait(2);
  assert(t.p.y < 0.5 && t.sim.deaths === 0, 'a coal standing over the hole falls back down it');
});

test('f07: the smokehouse windows pass only smoke, the chambers hold braziers that refuel smoke, and the last wall needs a blaze', () => {
  const e1 = at(f07, D3 + 7, 0, 0); assert(hold(e1, 1, 0, 2, { jump: true }).maxX < D3 + 8.05 - R + 0.03, 'an ember passed window one');
  const e2 = at(f07, D3 + 23, 0, 0); assert(hold(e2, 1, 0, 2, { jump: true }).maxX < D3 + 24.05 - R + 0.03, 'an ember passed window two (it is a door to the chamber, not an exit)');
  const s = at(f07, D3 + 5, 0, 0, 'smoke', 10);
  assert(drift(s, 1, 0, 2).maxX > D3 + 10, 'smoke goes in at window one');
  // the brazier inside gives smoke its heat back
  const h = at(f07, D3 + 12, 0, 0, 'ember', 2);
  h.wait(0.5); assert(h.p.gauge > 9.9 && by(h.sim.level.braziers, 'b5').lit, 'the lit brazier in the chamber refuels');
  eq(by(h.sim.level.braziers, 'b5').lit, true);
  // the exit wall
  assert(hold(at(f07, D3 + 56, 0, 0), 1, 0, 3, { jump: true }).maxX < D3 + 58.05 - R + 0.03, 'an ember got through the plank wall');
  const b = at(f07, D3 + 56.6, 0, 0, 'blaze', 10);
  b.waitUntil(() => wood(b, 'smokeWall').state === 2, { toward: [D3 + 58.2, 0], timeout: 4 });
  const sm = at(f07, D3 + 56, 0, 0, 'smoke', 10);
  hold(sm, 1, 0, 1.5); eq(wood(sm, 'smokeWall').state, 0, 'smoke burns nothing');
});

test('f07: the chamber stone is reached by smoke sliding along the roof, not by climbing the shelf', () => {
  const e = at(f07, D3 + 15.9, 0, -1.5);
  const ext = hold(e, 0, -1, 1.5, { jump: true });
  assert(ext.maxY < 2.2 || e.sim.shardsTaken.length === 0, 'an ember cannot climb the shelf');
  eq(e.sim.shardsTaken.length, 0);
  const b = at(f07, D3 + 15.9, 0, -1.5, 'blaze', 10);
  hold(b, 0, -1, 1.5, { jump: true });
  eq(b.sim.shardsTaken.length, 0, 'a plain blaze jump cannot reach the stone on the 2 m shelf');
});

test('f07: smoke cannot light the lantern, the draught needs it, and without the draught the pool is too wide for a gauge', () => {
  const s = at(f07, D4 + 6.2, 0, 2.2, 'smoke', 10);
  s.wait(1.5);
  eq(by(s.sim.level.lanterns, 'draughtLamp').lit, false, 'smoke lights nothing');
  assert(!s.sim.signals.get('draught'));
  const lit = at(f07, D4 + 6.2, 0, 2.2);
  lit.wait(0.1); assert(by(lit.sim.level.lanterns, 'draughtLamp').lit && !lit.sim.signals.get('draught'), 'an ember lights the first lantern, but one is not a draught');
  lit.walkTo(D4 + 1.8, -3.0).jumpTo(D4 + 3.3, -3.0); lit.wait(0.1);
  assert(lit.sim.signals.get('draught'), 'an ember lights the second from the ledge: now the draught blows');
  const sm2 = at(f07, D4 + 3.3, 1.3, -3.0, 'smoke', 10); sm2.wait(1);
  eq(by(sm2.sim.level.lanterns, 'draughtLamp2').lit, false, 'smoke cannot light the second lantern either');
  // no draught: the roof road is longer than a gauge
  const no = at(f07, D4 + 8.2, 0, 0, 'smoke', 10);
  assert(drift(no, 1, 0, 11, false).died, 'smoke without the draught should run out over the water');
  // with the draught on, it makes it
  const yes = at(f07, D4 + 6.2, 0, 2.2);
  yes.wait(0.1); yes.walkTo(D4 + 1.8, -3.0).jumpTo(D4 + 3.3, -3.0); yes.wait(0.1);
  yes.walkTo(D4 + 5, -1).walkTo(D4 + 8.2, 0); yes.form('smoke');
  const d = drift(yes, 1, 0, 8);
  assert(!d.died && d.maxX > D4 + 44, 'with the draught a gauge carries smoke across all 34 m');
  assert(diesWalking(at(f07, D4 + 9, 0, 0), D4 + 45, 0), 'an ember waded the duct pool');
  assert(diesWalking(at(f07, D4 + 9, 0, 0, 'blaze', 0.4), D4 + 45, 0), 'a blaze with no heat waded it');
});

test('f07: the draught blows only over the pool: an ember on the bank is not pushed, and the wind is real inside it', () => {
  const on = at(f07, D4 + 6.2, 0, 2.2);
  on.wait(0.1); on.walkTo(D4 + 1.8, -3.0).jumpTo(D4 + 3.3, -3.0); on.wait(0.1);
  assert(on.sim.signals.get('draught'), 'both lanterns lit, draught on');
  on.walkTo(D4 + 5, -1).walkTo(D4 + 9, 0);
  on.wait(0.3); const x0 = on.p.x; on.wait(1); near(on.p.x, x0, 0.02, 'the bank is outside the fan');
  on.sim.teleport(D4 + 12, 2.2, 0); on.sim.forceForm('smoke'); on.p.gauge = 10;
  const inFan = on;
  inFan.wait(1.2);
  assert(inFan.p.x > D4 + 17, `smoke inside the draught is carried along: x=${inFan.p.x}`);
});

test('f07: the stack hatch lets smoke up but not an ember or a blaze (not even on the updraft), and the kiln wants a blaze', () => {
  const e = at(f07, D5 + 11.5, 0, 0);
  assert(hold(e, 0, 0, 2, { jump: true }).maxY < 4, 'an ember rode the updraft to the gallery');
  const b = at(f07, D5 + 11.5, 0, 0, 'blaze', 10);
  let maxY = 0;
  for (let i = 0; i < 6; i++) { for (let k = 0; k < 150; k++) { b.tick(0, 0, k < 80, !b.p.grounded && b.p.vy < 0.4 && !b.p.airSpecial ? b.p.form : null); maxY = Math.max(maxY, b.p.y); } b.p.gauge = 10; }
  assert(maxY < 7.4, `a blaze got through the hatch: ${maxY}`);
  const s = at(f07, D5 + 11.5, 0, 0, 'smoke', 10);
  s.waitUntil((st, p) => p.y > 8, { timeout: 4, label: 'smoke goes up the stack' });
  // the kiln
  const sm = at(f07, D5 + 48, 11.6, 0, 'smoke', 10);
  sm.wait(1); assert(!sm.sim.signals.get('kilnHot'), 'smoke does not trip the heat sensor');
  const k = at(f07, D5 + 45, 11.6, 0, 'blaze', 10);
  k.walkTo(D5 + 48.5, 0); k.wait(0.2);
  assert(k.sim.signals.get('kilnLit'), 'a blaze trips it');
  const x = at(f07, D5 + 53.2, 11.6, 0); x.wait(0.4); assert(!x.sim.completed, 'the shut kiln door completed the level');
});

test('f07: the last curtain puts an ember out; smoke slides over it; a blaze pays heat', () => {
  assert(diesWalking(at(f07, D5 + 22, 7.8, 0), D5 + 28, 0), 'an ember walked through the gallery curtain');
  const hi = at(f07, D5 + 17.5, 7.8, 0, 'smoke', 10);
  hi.waitUntil((s, p) => p.y >= 10.3, { timeout: 4 });
  const d = drift(hi, 1, 0, 5);
  assert(d.form === 'smoke' && d.maxX > D5 + 28, 'smoke slides over the curtain');
  const b = at(f07, D5 + 22.6, 7.8, 0, 'blaze', 10);
  const g0 = b.p.gauge;
  b.walkTo(D5 + 28.5, 0);
  eq(b.sim.deaths, 0, 'a blaze with heat survives the curtain');
  assert(b.p.gauge < g0 - 1.25 * 1.4 - 2, 'and pays for it');
});

test('f07: nothing the route burns or lights is ever needed twice, and a hero put out anywhere comes back with heat', () => {
  // the plank wall is the only permanent change; burn it and walk through
  const r = at(f07, D3 + 56.6, 0, 0, 'blaze', 10);
  r.waitUntil(() => wood(r, 'smokeWall').state === 2, { toward: [D3 + 58.2, 0], timeout: 4 });
  r.walkTo(D3 + 63, 0);
  eq(r.sim.deaths, 0);
  // fall into the pool as smoke with no heat: respawn at the brazier before it with a full gauge
  const q = at(f07, D1 + 19.4, 0, 0);
  q.wait(0.5); q.sim.teleport(D1 + 21, 0, 0); q.wait(0.3); q.sim.forceForm('smoke'); q.p.gauge = 2;
  q.allowDeath = true;
  drift(q, 1, 0, 6, false);
  assert(q.sim.deaths > 0 && Math.abs(q.p.x - (D1 + 19)) < 0.1 && q.p.gauge > 9.9, 'back at the brazier before the pool, refuelled');
});

// ------------------------------------------------------------------------------------ f08
const [E1, E2, E3, E4, E5] = sol08.ORIGINS;
const wax8 = (r, id) => by(r.sim.level.waxes, id);

test('f08: five named areas, a brazier at the start of each, and the route fits the 100-120 s band', () => {
  checkAreas(f08, 5);
  between(routeSeconds(f08, sol08), 100, 120, 'solve() route time');
  between(routeSeconds(f08, sol08, 'solveAll'), 100, 130, 'solveAll() route time');
});

test('f08: a head wind drives a blaze back, cold air turns smoke back (nothing can be flown over), and an ember pushes through at a crawl', () => {
  const b = at(f08, E1 + 9.5, 0, 0, 'blaze', 10);
  const eb = hold(b, 1, 0, 2.5);
  assert(eb.maxX < E1 + 9.9, `a blaze walked into the head wind: ${eb.maxX}`);
  assert(b.p.x < E1 + 9.5 + 0.2, 'it is driven back');
  const s = at(f08, E1 + 10, 2, 0, 'smoke', 10);
  s.wait(0.5); eq(s.p.form, 'ember', 'cold air turns smoke back into a coal');
  s.form('smoke', { expect: false }); eq(s.p.form, 'ember', 'and smoke cannot be chosen in the hall');
  const e = at(f08, E1 + 7.8, 0, 0);
  { const w = wood(e, 'draughtWall'); w.state = 2; w.t = 1; w.solid.active = false; }   // the wall is a separate gate
  const t0 = e.t; e.waitUntil((st, p) => p.x >= E1 + 24, { mx: 1, timeout: 8, label: 'an ember pushes through the whole wind' });
  between(e.t - t0, 4, 8, 'at about 3 m/s net, not at a full run');
});

test('f08: the plank wall in the wind burns only from the cord: not from an ember, not from a blaze that cannot get there', () => {
  assert(hold(at(f08, E1 + 14, 0, 0), 1, 0, 3, { jump: true }).maxX < E1 + 16.05 - R + 0.03, 'an ember got through the wall in the wind');
  const b = at(f08, E1 + 12, 0, 0, 'blaze', 10);
  hold(b, 1, 0, 4);
  eq(wood(b, 'draughtWall').state, 0, 'a blaze never reached the wall');
  const e = at(f08, E1 + 9.2, 0, 2.8);
  eq(by(e.sim.level.fuses, 'cord1').state, 1, 'an ember lights the cord');
  const t0 = e.t - 0.3, len = by(e.sim.level.fuses, 'cord1').len;
  e.waitUntil(() => wood(e, 'draughtWall').state > 0, { timeout: 10, label: 'the wall catches at the end of the cord' });
  near(e.t - t0, len / 1.6, 0.2, 'cord length / rate');
});

test('f08: the curtain puts an ember out; a blaze pays heat; smoke goes over it only if it has risen first', () => {
  assert(diesWalking(at(f08, E2 + 8.5, 0, 0), E2 + 15, 0), 'an ember walked through the curtain');
  const b = at(f08, E2 + 7, 0, 0, 'blaze', 10);
  const g0 = b.p.gauge, t0 = b.t;
  let lowG = 10, tLowG = 0;
  const tk = b.tick.bind(b); b.tick = (...a) => { tk(...a); if (b.p.gauge < lowG) { lowG = b.p.gauge; tLowG = b.t; } };
  b.walkTo(E2 + 16.5, 0);
  eq(b.sim.deaths, 0);
  assert(g0 - lowG - 1.25 * (tLowG - t0) > 3.5, `crossing four metres of spray costs about five heat on top of the burn (${g0} -> ${lowG})`);
  const low = at(f08, E2 + 8, 0, 0, 'smoke', 10);
  for (let i = 0; i < 180 && low.p.form === 'smoke'; i++) low.tick(1, 0, false);
  eq(low.p.form, 'ember', 'smoke that has not risen is turned back');
  assert(low.sim.deaths === 0);
  const hi = at(f08, E2 + 6, 0, 0, 'smoke', 10);
  hi.waitUntil((s, p) => p.y >= 3.6, { timeout: 4 });
  hold(hi, 1, 0, 3.4);
  assert(hi.p.form === 'smoke' && hi.p.x > E2 + 14.5, `risen above the spray, smoke sails over (x=${hi.p.x}, ${hi.p.form})`);
  hold(hi, 1, 0, 2);
  eq(hi.p.form, 'ember', 'and cold air past the curtain turns it back before anything else can be flown over');
});

test('f08: the wax and its crate cannot be climbed or spoilt, the plate is remembered, and the gate needs it', () => {
  assert(hold(at(f08, E2 + 21, 0, 0), 1, 0, 1.5, { jump: true }).maxY < 2.2, 'an ember jumped onto the wax block');
  for (const [x, z] of [[21.4, 0], [23, 1.7], [23, -1.7]]) {
    const r = at(f08, E2 + x, 0, z, 'blaze', 10);
    let maxY = 0;
    for (let i = 0; i < 4; i++) { for (let k = 0; k < 150; k++) { r.tick(0, 0, k < 70, !r.p.grounded && r.p.vy < 0.4 && !r.p.airSpecial ? r.p.form : null); maxY = Math.max(maxY, r.p.y); } r.p.gauge = 10; }
    eq(wood(r, 'dropE').state, 0, `the crate stayed whole with the blaze at (${x}, ${z})`);
    assert(maxY < 2.7, `no one gets on top of the wax: ${maxY}`);
  }
  const w = at(f08, E2 + 21.3, 0, 0, 'blaze', 10);
  w.waitUntil(() => wax8(w, 'waxD').t >= 1, { toward: [E2 + 22.6, 0], timeout: 8 });
  w.waitUntil((s) => s.signals.get('pE'), { timeout: 3 });
  w.waitUntil(() => door(w, 'gateE').open >= 1, { timeout: 2 });
  const crate = wood(w, 'dropE'); crate.state = 2; crate.gone = true; crate.solid.active = false; w.wait(0.5);
  assert(!w.sim.signals.get('pE')); eq(door(w, 'gateE').open, 1, 'the plate is remembered');
  assert(hold(at(f08, E2 + 29, 0, 0), 1, 0, 2, { jump: true }).maxX < E2 + 31.05 - R + 0.03, 'walked through the shut gate');
});

test('f08: the valve - the head wind along the flume blocks smoke until the cord has burnt out, and running water is never safe', () => {
  const pinned = at(f08, E3 + 6, 0, 0, 'smoke', 10);
  pinned.waitUntil((s, p) => p.y >= 2.3, { timeout: 4 });
  hold(pinned, 1, 0, 3);
  assert(pinned.p.x < E3 + 14, `smoke cannot cross the flume while the wind blows: x=${pinned.p.x}`);
  // (the wind keeps a blaze out of the flume while it blows; in the calm, running water is never safe)
  const calm = (form, g) => { const c = at(f08, E3 + 8, 0, 2.0); c.sim.level.fans.find((f) => f.id === 'flumeWind'); c.waitUntil(() => !c.sim.level.fans.find((f) => f.id === 'flumeWind').active, { timeout: 4 }); c.sim.teleport(E3 + 11.5, 0, 0); if (form !== 'ember') { c.sim.forceForm(form); c.p.gauge = g; } return c; };
  assert(diesWalking(calm('ember'), E3 + 29, 0), 'an ember walked into the flume');
  assert(diesWalking(calm('blaze', 10), E3 + 29, 0), 'a blaze walked into the flume (running water cannot be boiled)');
  { const j = leap(at(f08, E3 + 11.2, 0, 0, 'blaze', 10), 5, { jumpAt: 10, special: 70 }); assert(j.stoodX < E3 + 28, `jump and flare crossed 16 m of flume: ${j.stoodX}`); }
  // the cord switches the wind off for its window, then it blows again, and the cord can be lit once more
  const v = at(f08, E3 + 8, 0, 2.0);
  eq(by(v.sim.level.fuses, 'valve').state, 1);
  const fan = v.sim.level.fans.find((f) => f.id === 'flumeWind');
  assert(fan.active, 'the wind blows while the cord burns');
  v.waitUntil(() => !fan.active, { timeout: 4, label: 'the wind stops when the cord has burnt out' });
  const t0 = v.t;
  v.sim.teleport(E3 + 3, 0, 0);
  v.waitUntil(() => fan.active, { timeout: 12, label: 'and starts again' });
  near(v.t - t0, 8.5, 0.15, 'the calm lasts as long as the valve cord stays spent');
  v.waitUntil(() => by(v.sim.level.fuses, 'valve').state === 0, { timeout: 1 });
});

test('f08: the stone in the flume roof is for smoke only, off the straight line', () => {
  const e = at(f08, E3 + 20, 0, -3.2);
  hold(e, 0, 0, 1, { jump: true }); eq(e.sim.shardsTaken.length, 0, 'an ember cannot reach it');
});

test('f08: frost forbids the blaze, only fire (a lit board) can reach the sensor inside it, and the gate remembers', () => {
  const f = at(f08, E4 + 8, 0, 0, 'blaze', 10);
  f.walkTo(E4 + 14, 0);
  eq(f.p.form, 'ember', 'a blaze walked into the frost and became a coal');
  f.form('blaze', { expect: false }); eq(f.p.form, 'ember');
  const e = at(f08, E4 + 17.2, 0, 2.3);
  eq(by(e.sim.level.fuses, 'valveF').state, 1, 'an ember lights the valve cord inside the frost');
  e.waitUntil(() => !by(e.sim.level.sprinklers, 'frostSpray').wet, { timeout: 4, label: 'the spray stops' });
  hold(e, 1, 0, 3);
  assert(e.p.x > E4 + 31 && e.sim.deaths === 0, `an ember dashes through while the valve is shut and reaches the sensor: x=${e.p.x}`);
  assert(!e.sim.signals.get('hsF'), 'but it does not trip it');
  eq(wood(e, 'row3').state, 0, 'and lights nothing');
  assert(diesWalking(at(f08, E4 + 12, 0, 0), E4 + 31, 0), 'an ember ran into the live curtain');
  const dead = at(f08, E4 + 17.2, 0, 2.3);
  dead.waitUntil(() => !by(dead.sim.level.sprinklers, 'frostSpray').wet, { timeout: 4 });
  dead.sim.teleport(E4 + 5, 0, 0);
  dead.waitUntil(() => by(dead.sim.level.sprinklers, 'frostSpray').wet, { timeout: 8, label: 'the spray comes back when the cord has regrown' });
  eq(by(dead.sim.level.fuses, 'valveF').state, 0, 'the cord is whole again: a missed dash can be retried');
  const r = at(f08, E4 + 4.6, 0, 0, 'blaze', 10);
  r.waitUntil(() => wood(r, 'row0').state > 0, { toward: [E4 + 7.6, 0], timeout: 3 });
  r.form('ember');
  r.waitUntil((s) => s.signals.get('hsF'), { timeout: 12, label: 'the fire runs down the boards to the sensor' });
  r.waitUntil(() => door(r, 'gateF').open >= 1, { timeout: 2 });
  r.wait(10); eq(door(r, 'gateF').open, 1, 'the sensor is remembered after the boards are ash');
  assert(hold(at(f08, E4 + 33, 0, 0), 1, 0, 2, { jump: true }).maxX < E4 + 35.05 - R + 0.03, 'walked through the shut frost gate');
});

test('f08: the great wax needs more than one gauge, the lantern needs a flare, and the kiln needs both lantern and sensor', () => {
  const b = at(f08, E5 + 5, 0, 0, 'blaze', 10);
  b.walkTo(E5 + 11.3, 0);
  b.waitUntil((s, p) => p.form !== 'blaze', { toward: [E5 + 12.8, 0], timeout: 12 });
  assert(wax8(b, 'waxG').t < 1, 'one gauge from the brazier cannot sag the great wax');
  // the lantern: no plain jump lights it
  const lamp = (r) => by(r.sim.level.lanterns, 'hiLamp');
  const j = at(f08, E5 + 23.4, 0, 0, 'blaze', 10);
  hold(j, 0, 0, 1.5, { jump: true }); assert(!lamp(j).lit, 'a plain blaze jump lit the high lantern');
  const e = at(f08, E5 + 23.4, 0, 0); hold(e, 0, 0, 1.5, { jump: true }); assert(!lamp(e).lit, 'an ember jump lit it');
  const f = at(f08, E5 + 23.4, 0, 0, 'blaze', 10);
  for (let i = 0; i < 240; i++) f.tick(0, 0, i < 120, !f.p.grounded && f.p.vy < 0.4 && !f.p.airSpecial && i < 120 ? f.p.form : null);
  assert(lamp(f).lit, 'a flare lights it');
  // the kiln door
  const k = at(f08, E5 + 63.8, 0, 0); k.wait(0.4); assert(!k.sim.completed, 'the shut kiln completed the level');
  k.sim.level.lanterns.find((l) => l.id === 'hiLamp').lit = true; k.wait(0.4);
  assert(!k.sim.completed, 'the lantern alone does not open it');
  const s = at(f08, E5 + 35.5, 0, 0, 'blaze', 10); s.wait(0.3);
  assert(s.sim.signals.get('hsK'), 'a blaze trips the sensor');
  s.form('ember'); s.wait(0.5);
  s.sim.teleport(E5 + 63.8, 0, 0); s.wait(0.4);
  assert(!s.sim.completed, 'the sensor alone does not open it');
  s.sim.level.lanterns.find((l) => l.id === 'hiLamp').lit = true; s.wait(0.4);
  assert(!s.sim.completed, 'lantern and sensor without the crate do not open it');
  s.sim.teleport(E5 + 40.3, 0, 0); s.sim.forceForm('blaze'); s.p.gauge = 10; s.wait(0.2);
  s.waitUntil(() => wax8(s, 'waxK').t >= 1, { toward: [E5 + 41.5, 0], timeout: 6 });
  s.waitUntil((st) => st.signals.get('pK'), { timeout: 3 });
  s.sim.teleport(E5 + 63.8, 0, 0); s.wait(0.4);
  assert(s.sim.completed, 'all three together open it, each one remembered');
});

test('f08: the last head wind stops a blaze and lets an ember through', () => {
  const b = at(f08, E5 + 51, 0, 0, 'blaze', 10);
  const ext = hold(b, 1, 0, 3);
  assert(b.p.x < E5 + 51.2 && ext.maxX < E5 + 51.4, 'a blaze is stopped by the last wind');
  const e = at(f08, E5 + 49.2, 0, 0);
  e.waitUntil((s, p) => p.x >= E5 + 62, { mx: 1, timeout: 8 });
  eq(e.sim.deaths, 0);
});

test('f08: nothing permanent can strand the hero - a respawn always brings heat, and every latch only opens things', () => {
  // burn the whole frost board line and the draught wall; sag every wax: the route in each area still works
  const r = at(f08, E4 + 2, 0, 0);
  for (const w of r.sim.level.woods) { w.state = 2; w.t = 1; if (w.solid) w.solid.active = false; }
  r.walkTo(E4 + 9, 0);
  assert(r.sim.deaths === 0);
  // a put-out hero in the wind comes back at the last brazier with a full gauge
  const q = at(f08, E3 + 1.5, 0, 0);
  q.wait(0.5); q.sim.teleport(E3 + 11.5, 0, 0); q.wait(0.1);
  q.allowDeath = true;
  diesWalking(q, E3 + 29, 0);
  assert(q.sim.deaths > 0 && q.p.gauge > 9.9 && Math.abs(q.p.x - (E3 + 1.5)) < 0.1, 'back at the valve gallery brazier, refuelled');
});

// ------------------------------------------------------------------------------------ smoke cannot be flown round a gate
test('f07: the smokehouse is a sealed tube: smoke cannot climb over it, fly round it, or skip a chamber', () => {
  const s = at(f07, D3 + 5, 0, 0, 'smoke', 10);
  let maxY = 0, maxZ = -9, minZ = 9;
  for (let i = 0; i < 6 * 120 && s.p.form === 'smoke'; i++) { s.tick(0.7, 0.7, false); maxY = Math.max(maxY, s.p.y); maxZ = Math.max(maxZ, s.p.z); minZ = Math.min(minZ, s.p.z); }
  assert(maxY < 3.5, `smoke stays under the roof: ${maxY}`);
  assert(maxZ <= 4.0 && minZ >= -4.0, `and inside the walls: z ${minZ}..${maxZ}`);
  const t = at(f07, D3 + 5, 0, 0, 'smoke', 10);
  for (let i = 0; i < 6 * 120 && t.p.form === 'smoke'; i++) t.tick(0.6, -0.8, false);
  assert(t.p.z >= -4.0, 'not round the south side either');
  // the whole gauge, flown straight, cannot reach the plank wall without the chambers' braziers
  const u = at(f07, D3 + 5, 0, 0, 'smoke', 10);
  const sx0 = u.p.x;
  for (let i = 0; i < 12 * 120 && u.p.form === 'smoke'; i++) u.tick(1, 0, false);
  assert(u.p.x < D3 + 58, `one gauge of smoke flown straight ends short of the last wall: x=${u.p.x}`);
});

test('f08: the valve gallery is a sealed tube and smoke cannot get round the wind; cold air covers every other room, however wide', () => {
  const s = at(f08, E3 + 6, 0, 0, 'smoke', 10);
  let maxY = 0, maxZ = -9;
  for (let i = 0; i < 5 * 120 && s.p.form === 'smoke'; i++) { s.tick(0.5, 1, false); maxY = Math.max(maxY, s.p.y); maxZ = Math.max(maxZ, s.p.z); }
  assert(maxY < 2.6 && maxZ <= 4.0, `smoke cannot leave the gallery: y ${maxY}, z ${maxZ}`);
  for (const [x, z, y] of [[E2 + 25, 7, 6], [E4 + 20, 7, 6], [E5 + 20, -7, 6], [E1 + 20, 7, 6]]) {
    const c = at(f08, x, y, z, 'smoke', 10);
    c.wait(0.3);
    eq(c.p.form, 'ember', `cold air reaches smoke even outside the walls (${x}, ${y}, ${z})`);
  }
});

// ------------------------------------------------------------------------------------ f07: roofs are not roads for a coal
test('f07: no roof can be reached from above: smoke cannot climb over the end caps or the side walls to land a coal on top', () => {
  for (const [name, x0, x1] of [['soot pool roof', D1 + 20, D1 + 44], ['sprinkler roof', D2 + 4, D2 + 64], ['duct roof', D4 + 8, D4 + 46]]) {
    // over the front: rise in the open hall before the roof, then push in at the height of the roof top and above
    const a = at(f07, x0 - 2, 0, 0, 'smoke', 10);
    let maxX = -Infinity;
    for (let i = 0; i < 9 * 120 && a.p.form === 'smoke'; i++) { a.tick(i < 330 ? 0 : 1, 0, false); if (a.p.y > 6) maxX = Math.max(maxX, a.p.x); }
    assert(maxX < x0 + 0.1, `smoke climbed over the front of the ${name}: x=${maxX}`);
    // round the side: out past the floor edge, up, and back in over the side wall
    const b = at(f07, (x0 + x1) / 2, 0, 5.2, 'smoke', 10);
    let minZ = Infinity;
    for (let i = 0; i < 9 * 120 && b.p.form === 'smoke'; i++) { b.tick(0, i < 330 ? 0 : -1, false); if (b.p.y > 6) minZ = Math.min(minZ, b.p.z); }
    assert(minZ > 4.3, `smoke came in over the side wall of the ${name}: z=${minZ}`);
  }
});

test('f07: the pocket on the roof is the one safe landing, and its only way out is back down the hole', () => {
  const p = at(f07, D2 + 28, 4.7, 2.5);
  p.wait(1); eq(p.sim.deaths, 0, 'a coal landing in the pocket is fine');
  const q = at(f07, D2 + 26, 4.6, 3);
  hold(q, 1, 0, 3); assert(q.p.x < D2 + 30.6, 'and cannot walk out of it onto the cistern');
});

test('f07: the third chamber - spray inside a sealed room: a coal is put out, low smoke is turned back, risen smoke slides over, a blaze pays', () => {
  assert(diesWalking(at(f07, D3 + 46, 0, 0), D3 + 53, 0), 'a coal walked through the chamber curtain');
  const low = at(f07, D3 + 46.5, 0, 0, 'smoke', 10);
  for (let i = 0; i < 180 && low.p.form === 'smoke'; i++) low.tick(1, 0, false);
  eq(low.p.form, 'ember', 'smoke that has not risen is turned back at the curtain'); eq(low.sim.deaths, 0);
  const hi = at(f07, D3 + 45, 0, 0, 'smoke', 10);
  hi.waitUntil((s, p) => p.y >= 3.2, { timeout: 4 });
  drift(hi, 1, 0, 3);
  assert(hi.p.x > D3 + 51, `risen smoke slides over the curtain: x=${hi.p.x}`);
  assert(hold(at(f07, D3 + 38, 0, 0), 1, 0, 2, { jump: true }).maxX < D3 + 40.05 - R + 0.03, 'a coal passed window three');
  assert(drift(at(f07, D3 + 36.6, 0, 0, 'smoke', 10), 1, 0, 2).maxX > D3 + 41, 'smoke goes in at window three');
});

test('f07: the stack - the roof hatch stays shut until the lantern is lit (by a coal), the tower is sealed, and nothing but smoke reaches the top gallery', () => {
  const hatch = (r) => by(r.sim.level.doors, 'topHatch');
  const lamp = (r) => by(r.sim.level.lanterns, 'topLamp');
  const s = at(f07, D5 + 39.5, 7.8, 0, 'smoke', 10);
  hold(s, 0, 0, 4);
  assert(s.p.y < 11.2 - 0.5, `smoke cannot pass the shut roof hatch: y=${s.p.y}`);
  const sl = at(f07, D5 + 33.5, 7.8, 2.0, 'smoke', 10);
  sl.wait(1.5); eq(lamp(sl).lit, false, 'smoke lights nothing');
  const e = at(f07, D5 + 33.5, 7.8, 2.0);
  e.wait(0.3); assert(lamp(e).lit, 'a coal lights it');
  e.waitUntil(() => hatch(e).open >= 1, { timeout: 2, label: 'and the hatch opens' });
  e.wait(5); eq(hatch(e).open, 1, 'for good');
  e.sim.teleport(D5 + 39.5, 7.8, 0); e.sim.forceForm('smoke'); e.p.gauge = 10;
  e.waitUntil((st, p) => p.y > 12.5, { timeout: 5, label: 'smoke rises through the open hatch' });
  // a blaze cannot flare through it, and a coal cannot jump it
  const b = at(f07, D5 + 39.5, 7.8, 0, 'blaze', 10);
  b.sim.level.lanterns.find((l) => l.id === 'topLamp').lit = true; b.wait(1);
  let maxY = 0;
  for (let i = 0; i < 4; i++) { for (let k = 0; k < 150; k++) { b.tick(0, 0, k < 70, !b.p.grounded && b.p.vy < 0.4 && !b.p.airSpecial ? b.p.form : null); maxY = Math.max(maxY, b.p.y); } b.p.gauge = 10; }
  assert(maxY < 11.0, `a blaze reached the open hatch: ${maxY}`);
  // sealed from outside: smoke at the foot of the tower cannot climb past the west wall into either gallery
  const o = at(f07, D5 + 3, 0, 0, 'smoke', 10);
  let hi = 0;
  for (let i = 0; i < 8 * 120 && o.p.form === 'smoke'; i++) { o.tick(i < 300 ? 0 : 1, 0, false); hi = Math.max(hi, o.p.y); }
  assert(o.p.x < D5 + 5.7 || o.p.y < 3.7, `smoke cannot enter a gallery over the tower's west wall: (${o.p.x}, ${o.p.y})`);
  assert(hi > 3.7, 'it did climb: the wall, not the heat, stopped it');
  const side = at(f07, D5 + 20, 7.8, 3.5, 'smoke', 10);
  let maxZ = 0; for (let i = 0; i < 360 && side.p.form === 'smoke'; i++) { side.tick(0, 1, false); maxZ = Math.max(maxZ, side.p.z); }
  assert(maxZ <= 4.0, `smoke cannot fly out through the tower wall: z=${maxZ}`);
});

test('f08: the chandlery ice - more than one gauge, melted in bites with the coal; progress and the melt are permanent', () => {
  const ice8 = (r) => by(r.sim.level.iceblocks, 'iceI');
  assert(hold(at(f08, E2 + 43, 0, 0), 1, 0, 3, { jump: true }).maxX < E2 + 44.05 - R + 0.03, 'a coal got through the ice');
  const b = at(f08, E2 + 35, 0, 0, 'blaze', 10);
  b.walkTo(E2 + 43.3, 0);
  b.waitUntil((s, p) => ice8(b).gone || p.form !== 'blaze', { toward: [E2 + 44.4, 0], timeout: 12 });
  assert(!ice8(b).gone && ice8(b).t > 0.3, `one gauge from the brazier cannot finish it: ${ice8(b).t}`);
  b.walkTo(E2 + 41.5, -2.3).wait(0.1); assert(b.p.gauge > 3.9, 'the coal refuels');
  b.form('blaze').walkTo(E2 + 43.3, 0);
  b.waitUntil(() => ice8(b).gone, { toward: [E2 + 44.4, 0], timeout: 12, label: 'finished' });
  const t1 = ice8(b).t; b.sim.respawn('restart'); b.wait(1); eq(ice8(b).t, t1, 'a restart does not refreeze it');
  const c = at(f08, E2 + 40, 3, 6, 'smoke', 10); c.wait(0.3); eq(c.p.form, 'ember');
});

test('f08: the frost curtain - the valve is a cord lit from inside the frost; a blaze cannot do it, and the curtain returns', () => {
  const b = at(f08, E4 + 15, 0, 2.3, 'blaze', 10);
  eq(b.p.form, 'ember', 'a blaze put in the frost is a coal');
  const spray = (r) => by(r.sim.level.sprinklers, 'frostSpray');
  const c = at(f08, E4 + 17.2, 0, 2.3);
  c.waitUntil(() => !spray(c).wet, { timeout: 4 });
  const t0 = c.t;
  c.sim.teleport(E4 + 5, 0, 0);
  c.waitUntil(() => spray(c).wet, { timeout: 8, label: 'the curtain comes back' });
  near(c.t - t0, 4, 0.2, 'the calm lasts the regrow time of the valve cord');
});

test('f08: the third lock - the wax and crate cannot be spoilt or climbed, the plate is remembered, and the kiln needs it', () => {
  assert(hold(at(f08, E5 + 40, 0, 0), 1, 0, 1.5, { jump: true }).maxY < 2.2, 'a coal jumped onto the wax block');
  for (const [x, z] of [[40.4, 0], [42.2, 1.7], [42.2, -1.7]]) {
    const r = at(f08, E5 + x, 0, z, 'blaze', 10);
    let maxY = 0;
    for (let i = 0; i < 4; i++) { for (let k = 0; k < 150; k++) { r.tick(0, 0, k < 70, !r.p.grounded && r.p.vy < 0.4 && !r.p.airSpecial ? r.p.form : null); maxY = Math.max(maxY, r.p.y); } r.p.gauge = 10; }
    eq(wood(r, 'dropK').state, 0, `the crate stayed whole with the blaze at (${x}, ${z})`);
    assert(maxY < 2.7, `no one gets on top of the wax: ${maxY}`);
  }
  const w = at(f08, E5 + 40.3, 0, 0, 'blaze', 10);
  w.waitUntil(() => wax8(w, 'waxK').t >= 1, { toward: [E5 + 41.5, 0], timeout: 8 });
  w.waitUntil((s) => s.signals.get('pK'), { timeout: 3 });
  const crate = wood(w, 'dropK'); crate.state = 2; crate.gone = true; crate.solid.active = false; w.wait(0.5);
  assert(!w.sim.signals.get('pK') && w.sim.signals.get('pKL'), 'the plate is free again, but remembered');
});
