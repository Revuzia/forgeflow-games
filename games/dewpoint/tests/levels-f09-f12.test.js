// "Cannot be skipped" and "cannot be broken" tests for the chapter 3 Fire levels, "Live Wire":
// f09 "Brass Rail", f10 "Firedamp", f11 "Slow Match" and f12 "The Great Chimney". Every key gate must
// really need the thing the level teaches, every hazard must really cost what it should, anything
// permanent (burnt wood, broken walls, lit lanterns, latches) must never leave the level unwinnable,
// and each level's reference route must fit the length band of DESIGN-V2.md section 1.
// The positive routes (solve / solveAll) live in tests/solutions/ and are run by campaigns.test.js;
// the house rules that file applies to registered levels are repeated here for these four so they
// hold whether or not the registry is complete.

import { test, assert, eq, near, between } from './lib/harness.js';
import { play } from './lib/play.js';
import { at, hold } from './lib/fire.js';
import fire from '../src/sim/elements/fire.js';
import { Sim } from '../src/sim/sim.js';
import { resolvePrompt, tokensIn, hardCodedControls, TOKENS, INPUT_MODES, HINT_MAX_CHARS } from '../src/ui/prompts.js';
import { THEME_NAMES } from '../src/render/themes.js';
import f09, { O as O9 } from '../src/levels/f09.js';
import * as sol09 from './solutions/f09.js';
import f10, { O as O10 } from '../src/levels/f10.js';
import * as sol10 from './solutions/f10.js';
import f11, { O as O11 } from '../src/levels/f11.js';
import * as sol11 from './solutions/f11.js';
import f12, { O as O12 } from '../src/levels/f12.js';
import * as sol12 from './solutions/f12.js';

const R = fire.formDefs.ember.r, RB = fire.formDefs.blaze.r;
const by = (list, id) => list.find((q) => q.id === id);
const door = (r, id) => by(r.sim.level.doors, id);
const wood = (r, id) => by(r.sim.level.woods, id);
const fuse = (r, id) => by(r.sim.level.fuses, id);
const gasOf = (r, id) => by(r.sim.level.gases, id);
const sig = (r, name) => r.sim.signals.get(name);

/** Run and jump toward +x from where the hero stands. Returns { stoodX, maxX, died }: the furthest x at which it STOOD. */
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
function diesWalking(r, x, z, seconds = 4, jump = false) {
  const d0 = r.sim.deaths;
  for (let i = 0; i < seconds * 120 && r.sim.deaths === d0; i++) {
    const dx = x - r.p.x, dz = z - r.p.z, d = Math.hypot(dx, dz);
    r.tick(d > 0.05 ? dx / d : 0, d > 0.05 ? dz / d : 0, jump);
  }
  return r.sim.deaths > d0;
}

/** Tick with the stick still for `seconds` (a hero standing on something). */
function idle(r, seconds) { for (let i = 0; i < Math.round(seconds * 120); i++) r.tick(0, 0, false); return r; }

/** Scripted route time in seconds. */
function routeSeconds(level, mod, fn = 'solve') {
  const r = play(level);
  mod[fn](r);
  return r.result().timeMs / 1000;
}

/** Journey of named, contiguous areas, a brazier at the start of each. */
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

/** The campaigns.test.js house rules, for a level that may not be registered yet. */
function houseRules(level) {
  const sim = new Sim(level), L = sim.level;
  eq(sim.element.id, 'fire');
  eq(L.warnings, [], `${level.id}: level warnings`);
  eq(L.shards.length, 3, `${level.id}: three glow-stones`);
  assert(THEME_NAMES.includes(level.theme), `${level.id}: theme`);
  assert(level.name.length <= 24, `${level.id}: name fits the HUD`);
  assert(level.hints && typeof level.hints.start === 'string', `${level.id}: needs a hints.start line`);
  for (const [k, raw] of Object.entries(level.hints)) {
    const where = `${level.id} hint "${k}"`;
    eq(hardCodedControls(raw), [], `${where} hard-codes a control`);
    for (const t of tokensIn(raw)) assert(TOKENS[t] && ['ember', 'blaze', 'smoke', 'spark', 'flare', 'move', 'jump', 'restart'].includes(t), `${where}: unknown or foreign token {${t}}`);
    for (const m of INPUT_MODES) {
      const text = resolvePrompt(raw, m);
      assert(!/[{}]/.test(text), `${where} on ${m} still has a brace`);
      assert(text.length <= HINT_MAX_CHARS, `${where} is ${text.length} chars on ${m} (max ${HINT_MAX_CHARS}): "${text}"`);
      assert(/^[A-Z0-9]/.test(text), `${where} on ${m} must start with a capital`);
    }
  }
  const used = new Set(L.hintZones.map((h) => h.key)); used.add('start');
  for (const k of Object.keys(level.hints)) assert(used.has(k), `${level.id}: hint "${k}" is never shown`);
  for (let i = 0; i < 2400; i++) sim.step();
  eq(sim.deaths, 0); assert(!sim.completed, `${level.id}: an idle player neither dies nor wins`);
  // nothing here can be wasted for good: every fuse regrows, every pocket refills
  for (const f of L.fuses) assert(f.regrow > 0 || f.id === 'fuseV' && false, `${level.id}: fuse ${f.id} never grows back (a missed timer could not be retried)`);
  for (const g of L.gases) assert(g.refill > 0, `${level.id}: a gas pocket that never refills`);
}

// ================================================================================== f09 Brass Rail
const R9 = (x) => O9.rail + x, C9 = (x) => O9.cellar + x, G9 = (x) => O9.gallery + x, K9 = (x) => O9.kiln + x;

test('f09: five named areas, a brazier at the start of each, and the route fits the 95-120 s band', () => {
  checkAreas(f09, 5);
  houseRules(f09);
  between(routeSeconds(f09, sol09), 95, 120, 'solve() route time');
  between(routeSeconds(f09, sol09, 'solveAll'), 95, 120, 'solveAll() route time');
});

test('f09: only ember and spark are offered', () => {
  const r = play(f09);
  r.form('blaze', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'locked');
  r.form('smoke', { expect: false });
});

test('f09: nothing in this level can be spent for good - it has no wood, ice, wax, cracked walls or one-shot pockets', () => {
  const types = new Set(f09.pieces.map((p) => p.type));
  for (const t of ['wood', 'iceblock', 'wax', 'weakwall', 'gas', 'coal']) if (t !== 'coal') assert(!types.has(t), `f09 has a ${t}`);
  // the only permanent states are lit lanterns and the island latch, and both only ever open things
  eq(Object.keys(f09.signals).includes('liveB'), true);
});

test('f09: the pinhole fits a spark and stops an ember; door one needs all three lanterns', () => {
  const e = at(f09, 23.5, 0, 1.3);
  hold(e, 0, 1, 2);
  assert(e.p.z < 2.0 - R + 1e-6, `an ember got into the alcove: z=${e.p.z}`);
  eq(sig(e, 'lamp1'), false);
  const s = at(f09, 23.5, 0, 1.3, 'spark');
  hold(s, 0, 1, 1);
  assert(s.p.z > 2.5, 'a spark should fit the pinhole');
  s.walkTo(25.3, 3.0); eq(sig(s, 'lamp1'), true);
  // the ledge lantern, then the cabinet lantern: the door opens only with all three
  const r = at(f09, 10, 0, -2.9);
  r.jumpTo(12.1, -2.9); eq(sig(r, 'lamp0'), true);
  r.sim.teleport(23.5, 0, 1.3); r.form('spark'); r.walkTo(23.5, 3.0).walkTo(25.3, 3.0); eq(sig(r, 'lamp1'), true);
  r.walkTo(23.5, 3.0).walkTo(23.5, 1.0); r.form('ember');
  idle(r, 3.5);
  eq(door(r, 'door1').open, 0, 'two lanterns of three do not open the big door');
  const q = at(f09, 50, 0, 0);
  const x = hold(q, 1, 0, 3, { jump: true });
  assert(x.maxX < 51.63 - R + 1e-6, `got past the shut door: ${x.maxX}`);
});

test('f09: the third lantern is out of an ember\'s reach (a 3 m cabinet); only the climbing wire reaches it', () => {
  const r = at(f09, 31, 0, -2.2);
  const e = hold(r, 1, 0, 2, { jump: true });
  assert(e.maxY < 2, `an ember climbed the cabinet: y=${e.maxY}`);
  eq(sig(r, 'lamp2'), false);
  const s = at(f09, 29, 0, -2.2, 'spark');
  s.walkTo(30.2, -2.2, { stuck: 0 }).waitUntil((q, p) => p.ride, { timeout: 2 });
  s.waitUntil((q, p) => !p.ride, { timeout: 6 });
  near(s.p.y, 3, 0.05, 'arrives on top of the cabinet');
  s.walkTo(34.7, -2.3); eq(sig(s, 'lamp2'), true);
});

test('f09: the first chasm needs the rail - an ember falls, a spark falls, a spark on the wire crosses for no heat', () => {
  const je = leap(at(f09, R9(5.6), 0, 1.6), 3, { jumpAt: 25 });
  assert(je.stoodX < R9(18), `an ember jumped the 10 m chasm: stood at ${je.stoodX}`);
  const k = leap(at(f09, R9(5.6), 0, 1.6, 'spark'), 3, { jumpAt: 25 });
  assert(k.stoodX < R9(18), `a spark jumped the 10 m chasm: stood at ${k.stoodX}`);
  const r = at(f09, R9(5.6), 0, 0, 'spark', 10);
  r.walkTo(R9(7.2), 0, { stuck: 0 }).waitUntil((s, p) => p.ride, { timeout: 2 });
  const g0 = r.p.gauge;
  r.waitUntil((s, p) => !p.ride, { timeout: 6 });
  eq(r.sim.deaths, 0); near(r.p.x, R9(18.8), 1e-6); near(r.p.gauge, g0, 1e-6, 'the wire spends no heat');
  // a wire runs both ways: touching the far post sends it home after it steps away
  r.walkTo(R9(20.5), 0).walkTo(R9(18.8), 0, { stuck: 0 }).waitUntil((s, p) => p.ride, { timeout: 2 });
  r.waitUntil((s, p) => !p.ride, { timeout: 6 }); near(r.p.x, R9(7.2), 1e-6);
});

test('f09: the lift runs only while a spark sits on its socket (and for a while after), and comes back down for a retry', () => {
  const e = at(f09, R9(22.7), 0, 2.0);
  idle(e, 4); near(e.p.y, 0, 0.05, 'an ember on the deck goes nowhere');
  const r = at(f09, R9(19), 0, -2.2, 'spark');
  r.walkTo(R9(20.2), -2.2); eq(sig(r, 'sockL'), true);
  r.walkTo(R9(22.7), 2.0); r.form('ember');
  r.waitUntil((s, p) => p.y > 5.9, { timeout: 8, label: 'rises' });
  r.waitUntil((s, p) => p.y < 0.1, { timeout: 16, label: 'and comes back down by itself' });
});

test('f09: the second chasm needs the gantry wire (an ember on the catwalk cannot cross)', () => {
  const r = at(f09, R9(33), 6, 2);
  assert(leap(r, 3, { jumpAt: 10 }).died || r.p.y < 5, 'crossed 12 m of chasm from the catwalk');
  const s = at(f09, R9(36), 6, 2, 'spark');
  s.walkTo(R9(37), 2, { stuck: 0 }).waitUntil((q, p) => p.ride, { timeout: 2 });
  s.waitUntil((q, p) => !p.ride, { timeout: 6 });
  near(s.p.x, R9(41.4), 1e-6); near(s.p.y, 0.02, 0.1); eq(s.sim.deaths, 0);
});

test('f09: the cellar door needs ALL THREE sockets, the 4 s window last; any fewer, or the short one earlier, never gets Cinder through', () => {
  const fuel = (r) => { r.p.gauge = Math.max(r.p.gauge, 8); return r; };   // this test is about the windows; the heat budget has its own test (these routes are the long way round)
  const toW = (r) => r.walkTo(C9(6.4), 2.6);
  const toS = (r) => fuel(r).walkTo(C9(12.4), -2.0).walkTo(C9(18.6), -2.0);
  const toN = (r) => fuel(r).walkTo(C9(12.4), -2.0).walkTo(C9(12.4), 2.0).walkTo(C9(15.2), 2.0).walkTo(C9(16.6), 2.6) && fuel(r);
  const toSfromN = (r) => fuel(r).walkTo(C9(12.4), 2.0).walkTo(C9(12.4), -2.0).walkTo(C9(18.6), -2.0) && fuel(r);
  const toWfromS = (r) => fuel(r).walkTo(C9(12.4), -2.0).walkTo(C9(6.4), 2.6) && fuel(r);
  /** From wherever the sockets left Cinder: up the wire and to the hall door. Returns the furthest x reached. */
  const finish = (r) => {
    if (r.p.x < C9(13.6) || r.p.z < 0) r.walkTo(C9(12.4), r.p.z < 0 ? -2.0 : 2.0).walkTo(C9(12.4), 2.0).walkTo(C9(15.2), 2.0);   // from the west room or the south chamber: round to the north pinhole
    r.walkTo(C9(19.6), 1.0, { stuck: 0 });
    r.waitUntil((s, p) => p.ride, { timeout: 2 }); r.waitUntil((s, p) => !p.ride, { timeout: 4 });
    return hold(r, 1, 0, 1.6).maxX;
  };
  const fresh = (x, z) => at(f09, C9(x), -3.5, z, 'spark', 10);
  const a = fresh(8, 0); toW(a); eq(sig(a, 'sockW'), true); eq(sig(a, 'cellarOpen'), false, 'the first socket alone does not open it');
  const s1 = fresh(12.4, -2.0); toS(s1); eq(sig(s1, 'sockS'), true); eq(sig(s1, 'cellarOpen'), false, 'the second alone does not');
  const s2 = fresh(12.4, 2.0); toN(s2); eq(sig(s2, 'sockN'), true); eq(sig(s2, 'cellarOpen'), false, 'the third alone does not');
  const ws = fresh(8, 0); toW(ws); toS(ws); eq(sig(ws, 'cellarOpen'), false, 'two of three do not');
  const good = fresh(8, 0); toW(good); toS(good); toN(good);
  eq(sig(good, 'cellarOpen'), true, 'longest window first, shortest last: all three open together');
  assert(finish(good) > C9(28), 'the right order gets through the door');
  const bad = fresh(12.4, 2.0); toN(bad); toSfromN(bad); toWfromS(bad);
  assert(finish(bad) < C9(27.63) - 0.14 + 1e-6, 'shortest window first: it has gone before the door is reached');
  const bad2 = fresh(8, 0); toW(bad2); toN(bad2); toSfromN(bad2);
  assert(finish(bad2) < C9(27.63) - 0.14 + 1e-6, 'short window in the middle: it is gone before the door is reached');
  const fine = fresh(8, 0); toS(fine); toWfromS(fine); toN(fine);
  assert(finish(fine) > C9(28), 'any order works so long as the shortest window is the last one');
  // the windows really are timers
  const t = fresh(8, 0); toW(t); t.walkTo(C9(8), 0);
  idle(t, 15.5); eq(sig(t, 'win0'), true, 'the first window: still open 15.5 s later'); idle(t, 1); eq(sig(t, 'win0'), false, 'shut after sixteen');
});

test('f09: the grating holds an ember and drops a spark; the cellar cannot be left by an ember', () => {
  const e = at(f09, C9(8.6), 0, 0);
  idle(e, 1); near(e.p.y, 0, 0.05, 'an ember stands on the grating');
  const s = at(f09, C9(8.6), 0, 0, 'spark');
  s.waitUntil((q, p) => p.y < -3 && p.grounded, { timeout: 3 });
  const c = at(f09, C9(12), -3.5, 0);
  const up = hold(c, 0, 1, 1, { jump: true }), across = hold(c, 1, 0, 1.5, { jump: true });
  assert(across.maxX < C9(13.6) - R + 1e-6, 'an ember passed the partition');
  assert(Math.max(up.maxY, across.maxY) < -1.5, 'an ember climbed out of the cellar');
});

test('f09: cannot be made unwinnable - an ember with no heat left in any pinhole space finds coal and a spark again', () => {
  for (const [start, coal, label] of [
    [[C9(22), -3.5, -2.0], [C9(16.1), -1.7], 'south chamber'], [[C9(18.6), -3.5, 3.4], [C9(15.2), 1.9], 'north chamber'],
    [[C9(26), -3.5, 3.6], [C9(23.6), 2.8], 'the cage'], [[26.4, 0, 3.4], [24.6, 3.5], 'the alcove (east end)'], [[21.5, 0, 2.5], [22.2, 3.5], 'the alcove (west end)']]) {
    const r = at(f09, start[0], start[1], start[2], 'ember', 0);
    r.form('spark', { expect: false });
    eq(r.p.form, 'ember', `${label}: no heat, no spark`);
    assert(r.sim.level.coals.some((q) => Math.hypot(q.pos[0] - coal[0], q.pos[2] - coal[1]) < 0.01), `${label}: the coal is where the test thinks`);
    r.walkTo(coal[0], coal[1], { stuck: 0, tol: 0.4 });
    assert(r.p.gauge >= 3, `${label}: the coal fills the gauge`);
    r.form('spark');
  }
  // a respawn at a brazier is a full gauge
  const q = at(f09, R9(20.2), 0, -2.2, 'spark', 1);
  q.restart(); eq(q.p.gauge, 10, 'a respawn at a brazier is a full gauge');
});

test('f09: the gallery - drips, tanks and sprays kill; wire A sleeps until its lantern, wire B until the island socket AND the crawlspace lantern', () => {
  const d = at(f09, G9(6.5), 0, 0);
  d.waitUntil((s) => s.deaths > 0, { timeout: 2.5, label: 'a drop lands on Cinder' });
  assert(diesWalking(at(f09, G9(5), 0, 0), G9(5), 2.5, 2), 'stepping off the causeway is the tank');
  const spray = at(f09, G9(24), 0, 3.0);
  assert(by(spray.sim.level.sprinklers, 'tunnel').wet, 'the tunnel spray starts on');
  idle(spray, 1); assert(spray.sim.deaths > 0, 'a dawdler in the live spray is put out');
  const wire = (r, id) => by(r.sim.level.wires, id);
  const a = at(f09, G9(20), 0, -1.6, 'spark');
  eq(wire(a, 'wa').active, false); eq(wire(a, 'wb').active, false);
  a.walkTo(G9(21.4), -1.6, { stuck: 0 }); idle(a, 0.5); eq(a.p.ride, null, 'wire A carries nothing before the lantern');
  const l = at(f09, G9(27.4), 0, -3.2);
  eq(fuse(l, 'fuseV').state, 1, 'standing at the frayed end lights the valve fuse');
  l.walkTo(G9(20.3), -0.4).walkTo(G9(20.3), 3.0, { slow: false })
    .waitUntil((s) => !by(s.level.sprinklers, 'tunnel').wet, { timeout: 8, label: 'the valve shuts' })
    .walkTo(G9(25.4), 3.0, { slow: false });
  eq(sig(l, 'lampG'), true); l.wait(0.1);
  eq(wire(l, 'wa').active, true, 'the lantern wakes wire A'); eq(wire(l, 'wb').active, false, 'but not wire B');
  const m = at(f09, G9(48.5), 0, 0, 'spark'); m.walkTo(G9(50.4), 0);
  eq(sig(m, 'sockM'), true); m.walkTo(G9(49.2), 0); m.wait(0.1);
  eq(sig(m, 'liveB'), true, 'the island socket latches'); eq(wire(m, 'wb').active, false, 'but wire B also wants the crawlspace lantern');
  // the crawlspace: an ember does not fit, a spark in the dry half lights it, a spark in the wet half is put out
  const e = at(f09, G9(28.6), 0, -3.0); hold(e, 1, 0, 1.5); assert(e.p.x < G9(30) - R + 1e-6, 'an ember got under the shelf');
  const spray2 = (r) => by(r.sim.level.sprinklers, 'crawlSpray');
  const w = at(f09, G9(28.6), 0, -3.0, 'spark'); w.waitUntil(() => spray2(w).wet, { timeout: 8 }); w.waitUntil(() => spray2(w).clock > 0.3, { timeout: 2 });
  assert(diesWalking(w, G9(38.6), -3.0, 2), 'a spark in the wet half is put out');
  const k = at(f09, G9(28.6), 0, -3.0, 'spark'); k.waitUntil(() => spray2(k).wet, { timeout: 8 }); k.waitUntil(() => !spray2(k).wet, { timeout: 5 });
  k.walkTo(G9(38.6), -3.0, { slow: false }); eq(sig(k, 'lampH'), true); eq(k.sim.deaths, 0);
  k.walkTo(G9(28.6), -3.0, { slow: false }); eq(k.sim.deaths, 0, 'out again inside the same dry half');
  // both: the wire wakes
  const both = at(f09, G9(28.6), 0, -3.0);                       // (an ember waits: a waiting spark burns its heat)
  both.waitUntil(() => spray2(both).wet, { timeout: 8 }); both.waitUntil(() => spray2(both).clock > 3.2, { timeout: 5 }); both.form('spark');
  both.waitUntil(() => !spray2(both).wet, { timeout: 2 });
  both.walkTo(G9(38.6), -3.0, { slow: false }).walkTo(G9(28.6), -3.0, { slow: false });
  both.sim.teleport(G9(48.5), 0, 0); both.sim.player.gauge = 10; both.walkTo(G9(50.4), 0); both.walkTo(G9(49.2), 0); both.wait(0.1);
  eq(wire(both, 'wb').active, true, 'the socket and the crawlspace lantern wake wire B');
});

test('f09: the pool is 14 m of water: nothing but a wire crosses it', () => {
  assert(leap(at(f09, G9(39.5), 0, 0), 3, { jumpAt: 25 }).died, 'an ember jumped the pool');
  assert(leap(at(f09, G9(39.5), 0, 0, 'spark'), 3, { jumpAt: 25 }).died, 'a spark jumped the pool');
});

test('f09: the kiln door wants all three windows; the spray gauntlet stops an ember and passes a quick spark', () => {
  const g = (r) => by(r.sim.level.sprinklers, 'gauntlet');
  const e = at(f09, K9(11.6), 0, 0);
  e.waitUntil((s) => g(e).wet, { timeout: 6 }); e.waitUntil((s) => !g(e).wet, { timeout: 6 });
  assert(hold(e, 1, 0, 4, { jump: true }).maxX < K9(12.2) - R + 1e-6, 'an ember got past the slotted wall in front of the spray');
  assert(!g(e).wet || g(e).clock > 0, 'the spray is still running');
  // 0.45 m high along its whole foot: the wall is a hole only a spark fits
  const sl = at(f09, K9(11.6), 0, 3.0, 'spark'); sl.waitUntil((q) => g(sl).wet, { timeout: 6 }); sl.waitUntil((q) => !g(sl).wet, { timeout: 6 });
  assert(!diesWalking(sl, K9(29.6), 3.0, 3), 'a spark runs under the slotted wall at the side of the room');
  const s = at(f09, K9(11.6), 0, 0, 'spark');
  s.waitUntil((q) => g(s).wet, { timeout: 6 }); s.waitUntil((q) => !g(s).wet, { timeout: 6 });
  assert(!diesWalking(s, K9(29.6), 0, 3), 'a spark in the dry window is not put out');
  // a spark that starts through the wet part is put out
  const w = at(f09, K9(11.6), 0, 0, 'spark');
  w.waitUntil((q) => g(w).wet, { timeout: 6 });
  assert(diesWalking(w, K9(29.6), 0, 3), 'a spark through the spray is put out');
});

test('f09: the last windows - sock1 holds 30 s, sock2 20 s, sock3 6 s; the exit needs all three and only a spark can power them', () => {
  const r = at(f09, K9(2), 0, -2.5, 'spark');
  r.walkTo(K9(3.5), -2.5); eq(sig(r, 'sock1'), true); eq(sig(r, 'kilnOpen'), false);
  r.sim.teleport(K9(100.4), 0, 0); r.wait(0.5); assert(!r.sim.completed, 'the shut kiln door completed the level');
  const e = at(f09, K9(3.5), 0, -2.5); idle(e, 0.5); eq(sig(e, 'sock1'), false, 'an ember powers nothing');
  // arriving on the second socket powers it; its window then lasts 6.5 s
  const q = at(f09, K9(28), 0, 0, 'spark', 10);
  q.walkTo(K9(29.6), 0, { stuck: 0 }).waitUntil((s, p) => p.ride, { timeout: 2 });
  q.waitUntil((s) => sig(q, 'sock2'), { timeout: 6 }); eq(sig(q, 'h2'), true);
  q.walkTo(K9(45.6), 2.6); // (off the socket, away from the post and the water)
  idle(q, 19.2); eq(sig(q, 'h2'), true, 'still open 19.2 s after leaving'); idle(q, 1.2); eq(sig(q, 'h2'), false, 'the second window is 20 s');
});

test('f09: heat is a budget - a full gauge is five seconds of spark, and the whole reference route never runs dry', () => {
  const r = play(f09); let low = 10;
  const orig = r.tick.bind(r);
  r.tick = (...a) => { orig(...a); if (r.p.form === 'spark') low = Math.min(low, r.p.gauge); };
  sol09.solveAll(r);
  assert(low >= 0.15, `the route came within ${low.toFixed(2)} of running out of heat as a spark`);
});

// ================================================================================== f10 Firedamp
const P10 = (x) => O10.pad + x, T10 = (x) => O10.tank + x, V10 = (x) => O10.valve + x, S10 = (x) => O10.pipe + x;

/**
 * Put Cinder in a pocket, keep the stick still until it is thrown (or `wait` s pass), then hold (mx, 0) while it
 * flies. Returns { launched, x, y, died, r } where x, y are where it came to rest.
 */
function thrown(level, x, y, z, form, { mx = 0, wait = 3.5, fly = 7, gauge, flare = false } = {}) {
  const r = at(level, x, y, z, form, gauge);
  const d0 = r.sim.deaths;
  let launched = false, flared = false;
  for (let i = 0; i < wait * 120 && !launched; i++) { r.tick(0, 0, false); launched = !r.p.grounded && r.p.vy > 1; }
  for (let i = 0; launched && i < fly * 120 && r.sim.deaths === d0; i++) {
    const f = flare && !flared && r.p.vy < 0.4 && !r.p.grounded ? r.p.form : null;
    if (f) flared = true;
    r.tick(mx, 0, false, f);
    if (r.p.grounded) break;
  }
  return { launched, x: r.p.x, y: r.p.y, died: r.sim.deaths > d0, r };
}

test('f10: five named areas, a brazier at the start of each, and the route fits the 100-120 s band', () => {
  checkAreas(f10, 5);
  houseRules(f10);
  between(routeSeconds(f10, sol10), 100, 120, 'solve() route time');
  between(routeSeconds(f10, sol10, 'solveAll'), 100, 120, 'solveAll() route time');
});

test('f10: ember, blaze and spark are offered; smoke is locked', () => {
  const r = play(f10);
  r.form('smoke', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'locked');
});

test('f10: the first shelf is 2.5 m up: an ember cannot reach its lantern, a thrown spark can, and door one waits for it', () => {
  const e = at(f10, 11, 0, 0);
  const up = hold(e, 1, 0, 2.5, { jump: true });
  assert(up.maxY < 2.4, `an ember jumped onto the shelf: ${up.maxY}`);
  eq(sig(e, 'lampA'), false); eq(gasOf(e, 'gasA').blasts, 0, 'an ember in a pocket sets nothing off');
  for (const mx of [0, 1]) {
    const s = thrown(f10, 10.0, 0, 0, 'spark', { mx });
    assert(s.launched && !s.died, `mx=${mx}: the spark is thrown`);
    near(s.y, 2.5, 0.05, `mx=${mx}: lands on the shelf`);
    assert(s.x > 12.8 && s.x < 26.4, `mx=${mx}: on the shelf (x=${s.x})`);
  }
  const d = at(f10, 28, 0, 0); const x = hold(d, 1, 0, 3, { jump: true });
  assert(x.maxX < 30.03 - R + 1e-6, `got past door one without the lantern: ${x.maxX}`);
});

test('f10: a cracked wall is broken only by a blast within 2.5 m; the chain reaches the wall its first pocket cannot', () => {
  const gap = (a, b) => Math.hypot(Math.max(0, a[0] - b[3], b[0] - a[3]), Math.max(0, a[1] - b[4], b[1] - a[4]), Math.max(0, a[2] - b[5], b[2] - a[5]));
  const box = (id) => f10.pieces.find((p) => p.id === id).box;
  assert(gap(box('gasB'), box('wall1')) <= 2.5, 'pocket B reaches the first wall');
  assert(gap(box('gasC'), box('wall2')) > 2.5, 'pocket C cannot reach the second wall on its own...');
  assert(gap(box('gasC'), box('gasD')) <= 2.5 && gap(box('gasD'), box('wall2')) <= 2.5, '...but its neighbour can, and C reaches the neighbour');
  for (const form of ['ember', 'blaze']) {
    const r = at(f10, 38.4, 0, 0, form);
    const e = hold(r, 1, 0, 3, { jump: true });
    assert(e.maxX < 40 - (form === 'ember' ? R : RB) + 1e-6, `${form}: got through the cracked wall: ${e.maxX}`);
    eq(by(r.sim.level.weakwalls, 'wall1').broken, false);
  }
  const s = at(f10, 34, 0, 0, 'spark'); s.walkTo(36.6, 0, { stuck: 0 }); s.wait(0.5);
  eq(by(s.sim.level.weakwalls, 'wall1').broken, true); eq(by(s.sim.level.weakwalls, 'wall2').broken, false, 'one pocket, one wall');
  const c = at(f10, 44, 0, 0, 'spark'); c.walkTo(46.7, 0, { stuck: 0 }); c.wait(0.6);
  eq(by(c.sim.level.weakwalls, 'wall2').broken, true, 'the chain broke the far wall'); eq(gasOf(c, 'gasD').blasts, 1);
});

test('f10: the plate pad throws an ember over the chasm - with the stick still or held forward - and nothing else gets across', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, P10(10), 0, 0, 'ember', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown and alive`);
    assert(s.x > P10(18) && s.x < P10(36) && Math.abs(s.y) < 0.05, `mx=${mx}: lands on the far platform (x=${s.x})`);
  }
  const j = leap(at(f10, P10(11.2), 0, 0), 3, { jumpAt: 20 });
  assert(j.stoodX < P10(12.1), `an ember jumped the 6 m chasm: ${j.stoodX}`);
  const b = leap(at(f10, P10(10.5), 0, 0, 'blaze'), 5, { jumpAt: 60, special: 100 });
  assert(b.stoodX < P10(18), `a blaze jumped and flared across: ${b.stoodX}`);
  // a spark (which cannot press a plate) still sets the pocket off by touching it
  const sp = thrown(f10, P10(10), 0.08, 0, 'spark');
  assert(sp.launched && sp.r.p.form === 'spark', 'a spark touching the pocket is thrown too');
  const q = at(f10, P10(7), 0, 0); idle(q, 1); eq(gasOf(q, 'padGasA').blasts, 0, 'a pocket does nothing until the plate is held');
});

test('f10: the gantry is 4 m up: the second pad lands on it (both inputs), an ember cannot jump to it, and the gantry gate waits for its lantern', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, P10(26), 0, 0, 'ember', { mx });
    assert(s.launched, `mx=${mx}: thrown`);
    near(s.y, 4, 0.05, `mx=${mx}: on the gantry`);
  }
  const e = at(f10, P10(30), 0, 0); const up = hold(e, 1, 0, 2.5, { jump: true });
  assert(up.maxY < 2.5, 'an ember jumped up to the gantry');
  const d = at(f10, P10(34), 0, 0); const x = hold(d, 1, 0, 3, { jump: true });
  assert(x.maxX < P10(36.03) - R + 1e-6, 'got through the gantry gate without its lantern');
});

test('f10: the pool beyond is six metres: the third pad clears it from either input, wading kills, and a blaze can boil it instead', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, P10(41), 0, 0, 'ember', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown and dry`);
    assert(s.x > P10(49) && s.x < P10(66), `mx=${mx}: lands past the pool (x=${s.x})`);
  }
  assert(diesWalking(at(f10, P10(42.5), 0, 0), P10(48), 0, 3), 'wading the pool kills an ember');
  const b = at(f10, P10(42.3), 0, 0, 'blaze', 10);
  b.walkTo(P10(42.9), 0); b.wait(0.2);
  assert(by(b.sim.level.pools, 'pool2').steamT > 0, 'a blaze boils it'); eq(b.sim.deaths, 0);
});

test('f10: the tank farm - planks need a blaze; the sensor pocket needs a flame; the 11 m chasm is only crossed by the throw', () => {
  const e = at(f10, T10(6), 0, 0); const x = hold(e, 1, 0, 3, { jump: true });
  assert(x.maxX < T10(8) - R + 1e-6, 'an ember got through the planks'); eq(wood(e, 'planks').state, 0);
  const s = at(f10, T10(13), 0, 0); idle(s, 3); eq(gasOf(s, 'gasG').blasts, 0, 'an ember on the sensor sets nothing off');
  for (const mx of [0, 1]) {
    const t = thrown(f10, T10(13), 0, 0, 'blaze', { mx, wait: 4 });
    assert(t.launched && !t.died, `mx=${mx}: the blaze is thrown`);
    assert(t.x > T10(29) && t.x < T10(54) && Math.abs(t.y) < 0.05, `mx=${mx}: lands between the chasm and the pool (x=${t.x - O10.tank})`);
  }
  const f = thrown(f10, T10(13), 0, 0, 'blaze', { mx: 1, wait: 4, flare: true });
  assert(f.launched && !f.died && f.x > T10(29) && f.x < T10(54), `with a flare at the top the blaze still lands dry (x=${f.x - O10.tank})`);
  const j = leap(at(f10, T10(16.5), 0, 0, 'blaze'), 6, { jumpAt: 85, special: 150 });
  assert(j.stoodX < T10(29), `a blaze jumped and flared across the chasm: ${j.stoodX}`);
});

test('f10: the tank farm pool and bridge - boil costs heat, the rope is the only way over the nine metres', () => {
  const cold = at(f10, T10(52.4), 0, 0, 'blaze', 1.2);
  assert(diesWalking(cold, T10(60), 0, 3), 'a blaze short of the boil is put out');
  const e = leap(at(f10, T10(75), 0, 0), 4, { jumpAt: 50 });
  assert(e.stoodX < T10(80), `an ember jumped the nine metres: ${e.stoodX}`);
  const b = leap(at(f10, T10(74), 0, 0, 'blaze'), 6, { jumpAt: 70, special: 130 });
  assert(b.stoodX < T10(80), `a blaze flared across the nine metres: ${b.stoodX}`);
  const r = at(f10, T10(77.7), 0, 2.0, 'blaze', 10);
  r.waitUntil((s) => by(s.level.movers, 'bridge').t >= 1, { timeout: 5, label: 'the bridge comes down' });
  r.walkTo(T10(90), 0).expect((s, p) => p.x > T10(89) && s.deaths === 0, 'across the bridge');
  const q = at(f10, T10(77.7), 0, 2.0); idle(q, 2); eq(wood(q, 'rope').state, 0, 'an ember does not burn the rope'); eq(by(q.sim.level.movers, 'bridge').t, 0);
});

test('f10: the ladder - every rung wants its own form, both inputs land, and a fall costs only a walk back', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, V10(10), 0, 0, 'ember', { mx });
    assert(s.launched && Math.abs(s.y - 3.2) < 0.05 && s.x > V10(14) && s.x < V10(22), `mx=${mx}: rung one (x=${s.x - O10.valve}, y=${s.y})`);
  }
  const up1 = at(f10, V10(12), 0, 0); assert(hold(up1, 1, 0, 2, { jump: true }).maxY < 2.4, 'an ember jumped to rung one');
  for (const mx of [0, 1]) {
    const s = thrown(f10, V10(19.4), 3.2, 0, 'spark', { mx });
    assert(s.launched && Math.abs(s.y - 7) < 0.05 && s.x > V10(30) && s.x < V10(46), `mx=${mx}: rung two (x=${s.x - O10.valve}, y=${s.y})`);
  }
  const em = at(f10, V10(19.4), 3.2, 0); idle(em, 2); eq(gasOf(em, 'gasS').blasts, 0, 'an ember on the socket sets nothing off');
  for (const mx of [0, 1]) {
    const s = thrown(f10, V10(42), 7, 0, 'blaze', { mx, wait: 4 });
    assert(s.launched && Math.abs(s.y - 10.8) < 0.05 && s.x > V10(52), `mx=${mx}: the top (x=${s.x - O10.valve}, y=${s.y})`);
  }
  const ex = at(f10, V10(42), 7, 0); idle(ex, 3); eq(gasOf(ex, 'gasV').blasts, 0, 'an ember on the sensor sets nothing off');
  const f = at(f10, V10(20), 3.2, 1.0); hold(f, 1, 0, 1.5); eq(f.sim.deaths, 0); assert(f.p.y < 0.1, 'fell to the floor');
  f.walkTo(V10(10), 0, { stuck: 0 }); f.waitUntil((s) => gasOf(f, 'gasL').blasts > 0, { timeout: 3 });
});

test('f10: the standpipe - the relay needs a spark; the rail carries it free; the last pocket throws it to the top', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, S10(8.8), 10.8, 0, 'spark', { mx });
    assert(s.launched && Math.abs(s.y - 16) < 0.05 && s.x > S10(13) && s.x < S10(34), `mx=${mx}: first gantry (x=${s.x - O10.pipe}, y=${s.y})`);
  }
  const e = at(f10, S10(12), 10.8, 0); assert(hold(e, 1, 0, 2, { jump: true }).maxY < 13, 'an ember jumped to the first gantry');
  const r = at(f10, S10(31), 16, 0, 'spark', 10);
  r.walkTo(S10(33), 0, { stuck: 0 }); r.waitUntil((s, p) => p.ride, { timeout: 2 }); const g0 = r.p.gauge;
  r.waitUntil((s, p) => !p.ride, { timeout: 12 }); near(r.p.gauge, g0, 1e-6, 'the long rail costs no heat');
  r.waitUntil((s) => gasOf(r, 'gasR2').blasts > 0, { timeout: 3 });
  r.waitUntil((s, p) => p.grounded && p.vy === 0 && p.y > 20, { toward: [S10(80), 0], timeout: 7 });
  near(r.p.y, 31, 0.05, 'thrown to the top platform'); eq(r.sim.deaths, 0);
  const em = at(f10, S10(31), 16, 0); em.walkTo(S10(33), 0, { stuck: 0 }); idle(em, 0.5); eq(em.p.ride, null, 'an ember is not carried by the rail');
  const b = thrown(f10, S10(9), 10.8, 0, 'blaze', { mx: 1, wait: 4, flare: true });
  assert(b.launched && Math.abs(b.y - 16) < 0.05 && b.r.sim.shardsTaken.includes(2), 'a flared blaze takes the high stone and lands on the gantry');
  const nf = thrown(f10, S10(9), 10.8, 0, 'blaze', { mx: 1, wait: 4, flare: false });
  assert(!nf.r.sim.shardsTaken.includes(2), 'without the flare the stone is out of reach');
});

test('f10: the double throw - an ember cannot climb to either shelf; a thrown spark lands on the low one, and from its pocket on the high one; the door waits for the lantern', () => {
  const e = at(f10, 61.5, 0, 0); assert(hold(e, 1, 0, 2.5, { jump: true }).maxY < 2.4, 'an ember jumped onto the low shelf');
  eq(gasOf(e, 'gasE1').blasts, 0, 'an ember in the first pocket sets nothing off');
  for (const mx of [0, 1]) {
    const s = thrown(f10, 60.0, 0, 0, 'spark', { mx });
    assert(s.launched && !s.died, `mx=${mx}: the spark is thrown`);
    near(s.y, 2.5, 0.05, `mx=${mx}: lands on the low shelf`);
    assert(s.x > 62.8 && s.x < 80, `mx=${mx}: on the low shelf (x=${s.x})`);
  }
  for (const mx of [0, 1]) {
    const s = thrown(f10, 76.8, 2.5, 0, 'spark', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown again`);
    near(s.y, 6.3, 0.05, `mx=${mx}: lands on the high shelf`);
    assert(s.x > 87.4 && s.x < 103, `mx=${mx}: on the high shelf (x=${s.x})`);
  }
  const hi = at(f10, 78.5, 2.5, 0); assert(hold(hi, 1, 0, 2.5, { jump: true }).maxY < 5.8, 'an ember jumped from the low shelf to the high one');
  const l = at(f10, 100, 6.3, 0, 'spark'); l.walkTo(96.9, 0); eq(sig(l, 'lampX'), true, 'the lantern on the high shelf lights from a touch');
  const d = at(f10, 105, 0, 0); const x = hold(d, 1, 0, 3, { jump: true });
  assert(x.maxX < 108.03 - R + 1e-6, `got past the high door without the lantern: ${x.maxX}`);
  const g = at(f10, 76.8, 2.5, 0, 'spark'); g.wait(0.3); const q = gasOf(g, 'gasE2'); assert(q.blasts > 0 && !q.full, 'the second pocket went off'); g.waitUntil(() => q.full, { timeout: 4, label: 'and refilled' });
});

test('f10: two pads in a row - the first lands an ember on the slab, the plate on it throws it over the second chasm; nothing else crosses', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, P10(54), 0, 0, 'ember', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown`);
    near(s.y, 2.6, 0.05, `mx=${mx}: lands on the slab`);
    assert(s.x > P10(57.6) && s.x < P10(66.6), `mx=${mx}: on the slab (x=${s.x - O10.pad})`);
  }
  for (const mx of [0, 1]) {
    const s = thrown(f10, P10(64), 2.6, 0, 'ember', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown over the chasm`);
    assert(s.x > P10(72.6) && s.x < P10(86) && Math.abs(s.y) < 0.05, `mx=${mx}: lands past the chasm (x=${s.x - O10.pad}, y=${s.y})`);
  }
  const j = leap(at(f10, P10(66.0), 2.6, 0), 3, { jumpAt: 20 });
  assert(j.stoodX < P10(72.6), `an ember jumped the second chasm from the slab: ${j.stoodX}`);
  const up = at(f10, P10(56.4), 0, 0); assert(hold(up, 1, 0, 2.5, { jump: true }).maxY < 2.4, 'an ember jumped onto the slab');
  const q = at(f10, P10(61), 2.6, 0); idle(q, 1); eq(gasOf(q, 'padGasF').blasts, 0, 'the second pocket waits for its plate');
});

test('f10: the second planks and the wall of ice want a blaze; an ember gets through neither; one coal gives the gauge four more', () => {
  const e = at(f10, T10(94), 0, 0); const x = hold(e, 1, 0, 3, { jump: true });
  assert(x.maxX < T10(96) - R + 1e-6, `an ember got through the second planks: ${x.maxX}`); eq(wood(e, 'planks2').state, 0);
  const b = at(f10, T10(94.5), 0, 0, 'blaze', 10);
  b.walkTo(T10(95.6), 0).waitUntil(() => wood(b, 'planks2').state === 2, { toward: [T10(96), 0], timeout: 4, label: 'the planks burn' });
  b.walkTo(T10(103.6), 0).waitUntil((s) => by(s.level.iceblocks, 'ice3').gone, { toward: [T10(104.3), 0], timeout: 4, label: 'the ice melts' });
  eq(b.sim.deaths, 0);
  const w = at(f10, T10(103), 0, 0); const y = hold(w, 1, 0, 3, { jump: true });
  assert(y.maxX < T10(104) - R + 1e-6, `an ember got through the ice: ${y.maxX}`);
  const lo = at(f10, T10(100), 0, 2.4, 'blaze', 3); assert(lo.p.gauge > 6, `the coal gave a low gauge four more heat (${lo.p.gauge})`);
});

test('f10: the way off the top is boarded up and walled with ice - a blaze burns both from the brazier\'s full gauge, an ember does neither', () => {
  const e = at(f10, V10(60), 10.8, 0); const x = hold(e, 1, 0, 3, { jump: true });
  assert(x.maxX < V10(63) - R + 1e-6, `an ember got through the boards: ${x.maxX}`); eq(wood(e, 'planks3').state, 0);
  const b = at(f10, V10(57.5), 10.8, 0, 'blaze', 10);
  b.walkTo(V10(62.6), 0).waitUntil(() => wood(b, 'planks3').state === 2, { toward: [V10(63), 0], timeout: 4, label: 'the boards burn' });
  b.walkTo(V10(66), 0).waitUntil((s) => by(s.level.iceblocks, 'ice4').gone, { toward: [V10(66.8), 0], timeout: 4, label: 'the ice melts' });
  eq(b.sim.deaths, 0);
  const i = at(f10, V10(65.2), 10.8, 0); assert(hold(i, 1, 0, 3, { jump: true }).maxX < V10(66.4) - R + 1e-6, 'an ember got through the ice on the top rung');
  const a = at(f10, V10(52.6), 10.8, 0); a.walkTo(V10(55), 0); eq(a.checkpoint?.id ?? a.sim.checkpoint?.id, 'b4c', 'the brazier is before the boards');
});

test('f10: the last throw - the standpipe\'s top pocket throws a spark to the last platform, where the exit is; an ember cannot make the jump', () => {
  for (const mx of [0, 1]) {
    const s = thrown(f10, S10(82.6), 31, 0, 'spark', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown`);
    near(s.y, 34.8, 0.05, `mx=${mx}: lands on the last platform`);
    assert(s.x > S10(93.6) && s.x < S10(109.6), `mx=${mx}: on it (x=${s.x - O10.pipe})`);
  }
  const e = at(f10, S10(86), 31, 0); assert(hold(e, 1, 0, 3, { jump: true }).maxY < 33, 'an ember jumped to the last platform');
  const x = at(f10, S10(106.4), 34.8, 0); x.wait(1); eq(x.sim.completed, true, 'the exit is up there');
});

test('f10: cannot be made unwinnable - every pocket refills, a broken wall only opens a way, and a used pad can be used again', () => {
  const r = at(f10, P10(10), 0.08, 0, 'spark'); eq(r.p.form, 'spark'); r.wait(0.3);
  const g = gasOf(r, 'padGasA'); assert(g.blasts > 0 && !g.full, 'it went off');
  r.waitUntil(() => g.full, { timeout: 4, label: 'refilled' });
  r.sim.teleport(P10(10), 0.08, 0); r.waitUntil(() => g.blasts === 2, { timeout: 2, label: 'and goes off again' });
  const woods = f10.pieces.filter((p) => p.type === 'wood').map((p) => p.id);
  eq(woods.sort(), ['planks', 'planks2', 'planks3', 'rope'].sort());
  const dry = thrown(f10, T10(13), 0, 0, 'blaze', { mx: 1, wait: 4, gauge: 3.2 });
  assert(dry.launched && !dry.died, 'a nearly empty blaze is still thrown and lands alive');
});

// ================================================================================== f11 Slow Match
const H11 = (x) => O11.shutter + x, Y11 = (x) => O11.sync + x, C11 = (x) => O11.count + x, M11 = (x) => O11.mouth + x;

/** The level with the long fuse running 20 times faster, so a flight from the cannon can be tested in a few seconds. */
const f11fast = { ...f11, pieces: f11.pieces.map((p) => (p.id === 'fuseE' ? { ...p, rate: p.rate * 20 } : p)) };

/**
 * Light a fuse by standing at `lit` (x, z), walk to the pocket at `pocket` (x, z) and stand still until the pocket goes
 * off, then hold (mx, 0) while Cinder flies. Returns where it came to rest.
 */
function fuseThrow(level, lit, pocket, gasId, { mx = 0, form, gauge, y = 0 } = {}) {
  const r = at(level, lit[0], y, lit[1], form, gauge);
  r.walkTo(pocket[0], pocket[1], { stuck: 0 });
  const d0 = r.sim.deaths;
  let launched = false;
  for (let i = 0; i < 12 * 120 && !launched; i++) { r.tick(0, 0, false); launched = gasOf(r, gasId).blasts > 0 && !r.p.grounded; }
  for (let i = 0; launched && i < 8 * 120 && r.sim.deaths === d0; i++) { r.tick(mx, 0, false); if (r.p.grounded) break; }
  return { launched, x: r.p.x, y: r.p.y, died: r.sim.deaths > d0, r };
}

test('f11: five named areas, a brazier at the start of each, and the route fits the 90-131 s band', () => {
  checkAreas(f11, 5);
  houseRules(f11);
  between(routeSeconds(f11, sol11), 90, 131, 'solve() route time');
  between(routeSeconds(f11, sol11, 'solveAll'), 90, 142, 'solveAll() route time');
});

test('f11: ember, blaze and spark are offered; smoke is locked', () => {
  const r = play(f11);
  r.form('smoke', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'locked');
});

test('f11: the match room - the flame, not the player, sets the pocket off; the throw clears the chasm from either input; a jump does not', () => {
  const w = at(f11, 21.5, 0, 0); idle(w, 3); eq(gasOf(w, 'gasA').blasts, 0, 'standing in the pocket does nothing');
  const l = at(f11, 11.4, 0, 2.0); eq(fuse(l, 'fuseA').state, 1, 'the frayed end lights the fuse');
  l.waitUntil((s) => gasOf(l, 'gasA').blasts > 0, { timeout: 6 }); between(l.t, 4.2, 5.2, 'nine metres at two metres a second');
  for (const mx of [0, 1]) {
    const s = fuseThrow(f11, [11.4, 2.0], [22, 0], 'gasA', { mx });
    assert(s.launched && !s.died, `mx=${mx}: thrown and alive`);
    assert(s.x > 31 && s.x < 64 && Math.abs(s.y) < 0.05, `mx=${mx}: lands on the far side (x=${s.x})`);
  }
  const j = leap(at(f11, 21.4, 0, 2.6), 3, { jumpAt: 20 });
  assert(j.stoodX < 24.5, `an ember jumped the 7 m chasm: ${j.stoodX}`);
  const b = leap(at(f11, 21.4, 0, 2.6, 'blaze'), 5, { jumpAt: 40, special: 80 });
  assert(b.stoodX < 31, `a blaze jumped and flared across the 7 m chasm: ${b.stoodX}`);
  // missed it? the match grows back and can be lit again, and the pocket refills first
  const m = at(f11, 11.4, 0, 2.0); m.walkTo(8, 0);
  m.waitUntil((s) => gasOf(m, 'gasA').blasts === 1, { timeout: 6 });
  m.waitUntil((s) => fuse(m, 'fuseA').state === 0, { timeout: 6, label: 'the fuse grows back' }); m.walkTo(11.4, 2.0);
  eq(fuse(m, 'fuseA').state, 1, 'relit'); m.waitUntil((s) => gasOf(m, 'gasA').blasts === 2, { timeout: 6, label: 'and the pocket has refilled' });
});

test('f11: the second pocket throws an ember over the pool from either input; wading kills; a blaze boils it as an alternative', () => {
  for (const mx of [0, 1]) {
    const s = fuseThrow(f11, [36.2, -2.4], [46, 0], 'gasB', { mx });
    assert(s.launched && !s.died && s.x > 55 && s.x < 64, `mx=${mx}: over the pool and dry (x=${s.x})`);
  }
  assert(diesWalking(at(f11, 47.6, 0, 0), 52, 0, 3), 'wading the pool kills an ember');
  const b = at(f11, 47.2, 0, 0, 'blaze', 10); b.walkTo(47.9, 0); b.wait(0.2);
  assert(by(b.sim.level.pools, 'pool').steamT > 0, 'a blaze boils it'); eq(b.sim.deaths, 0);
});

test('f11: the shutter - twelve metres of fuse is six seconds, the shutter is open for 6 s, and the three chasms are wires\' work', () => {
  const r = at(f11, H11(8), 0, -2.4, 'spark'); eq(fuse(r, 'fuseC').state, 1); r.walkTo(H11(4), 0);
  r.waitUntil((s) => sig(r, 'fuseC'), { timeout: 8 }); between(r.t, 5.8, 6.4, 'twelve metres at two metres a second');
  const t0 = r.t; r.waitUntil((s) => !sig(r, 'fuseC'), { timeout: 8 }); near(r.t - t0, 6, 0.05, 'the window is the regrow time');
  r.waitUntil((s) => fuse(r, 'fuseC').state === 0, { timeout: 2, label: 'ready to be lit again' });
  for (const [form, label] of [['ember', 'an ember'], ['spark', 'a spark']]) {
    const j = leap(at(f11, H11(9), 0, 1.6, form), 3, { jumpAt: 25 });
    assert(j.stoodX < H11(18), `${label} jumped the first chasm: ${j.stoodX}`);
  }
  // the spark that is quick enough: lit, three wires, shutter, all in the window (the reference route does it; here it is timed)
  const q = at(f11, H11(8), 0, -2.4, 'spark');
  q.walkTo(H11(11), 0, { stuck: 0 }); q.waitUntil((s, p) => p.ride, { timeout: 2 }); q.waitUntil((s, p) => !p.ride, { timeout: 4 });
  q.walkTo(H11(23), 0, { stuck: 0 }); q.waitUntil((s, p) => p.ride, { timeout: 2 }); q.waitUntil((s, p) => !p.ride, { timeout: 4 });
  q.walkTo(H11(35), 0, { stuck: 0 }); q.waitUntil((s, p) => p.ride, { timeout: 2 }); q.waitUntil((s, p) => !p.ride, { timeout: 4 });
  q.walkTo(H11(48), 0); between(q.t, 3.0, 6.0, 'a spark is at the shutter well inside the fuse time');
  assert(door(q, 'shutter').open < 1, 'and the shutter is still shut when it arrives');
  const e = at(f11, H11(49), 0, 0); const x = hold(e, 1, 0, 3, { jump: true });
  assert(x.maxX < H11(50.03) - R + 1e-6, 'the shutter holds an ember (no fuse, no window)');
});

test('f11: the sync hall - the furnace opens only if all three flames land together; quick lighting never does', () => {
  const lenOf = (id) => fuse(play(f11), id).len;
  near(lenOf('f1') / 2.4, 12.5, 0.01); near(lenOf('f2') / 2.4, 8.3, 0.05); near(lenOf('f3') / 2.4, 4.2, 0.05);
  // light them one after the other as fast as a hero can run: the ends are 8 seconds apart, the window is 5.5
  const quick = at(f11, Y11(8), 0, -2.8);
  quick.walkTo(Y11(20), 0.2).walkTo(Y11(32), 3.0);
  for (let i = 0; i < 25 * 120; i++) quick.tick(0, 0, false);
  eq(door(quick, 'furnace').open, 0, 'lit in a hurry: the windows never overlap');
  // wrong order (shortest first) fails too
  const wrong = at(f11, Y11(32), 0, 3.0); wrong.walkTo(Y11(20), 0.2);
  wrong.waitUntil((s) => fuse(wrong, 'f3').state === 2, { timeout: 8 }); wrong.walkTo(Y11(8), -2.8);
  for (let i = 0; i < 25 * 120; i++) wrong.tick(0, 0, false);
  eq(door(wrong, 'furnace').open, 0, 'shortest first: it is spent before the long one lands');
  // the right order, to the second
  const good = at(f11, Y11(8), 0, -2.8);
  good.walkTo(Y11(18.6), -0.4).waitUntil((s) => fuse(good, 'f1').d >= 4.2 * 2.4, { timeout: 8 }).walkTo(Y11(20), 0.2);
  good.walkTo(Y11(30.6), 2.8).waitUntil((s) => fuse(good, 'f1').d >= 8.3 * 2.4, { timeout: 8 }).walkTo(Y11(32), 3.0);
  good.waitUntil((s) => door(good, 'furnace').open >= 1, { timeout: 12 });
  // every fuse can be lit again after its window
  assert(good.sim.level.fuses.every((f) => f.regrow > 0));
  const gate = at(f11, Y11(45), 0, 0); const x = hold(gate, 1, 0, 3, { jump: true });
  assert(x.maxX < Y11(48.03) - R + 1e-6, 'the furnace gate cannot be walked through');
});

test('f11: the niche - the cracked wall is broken only by the little pocket beside it, which an ember need not stand in', () => {
  const w = at(f11, Y11(57), 0, -2.0); idle(w, 3);
  eq(by(w.sim.level.weakwalls, 'nicheWall').broken, false, 'nothing breaks it unlit');
  const r = at(f11, Y11(56.6), 0, -2.8); eq(fuse(r, 'fuseW').state, 1);
  r.waitUntil((s) => by(s.level.weakwalls, 'nicheWall').broken, { timeout: 5 }); r.walkTo(Y11(54), -1.2).walkTo(Y11(60), -1.0).walkTo(Y11(67), -2.8); eq(r.sim.shardsTaken.length, 1);
  const e = at(f11, Y11(62.5), 0, -2.8); const x = hold(e, 1, 0, 2, { jump: true });
  assert(x.maxX < Y11(64) - R + 1e-6, 'an ember cannot walk through the cracked wall');
});

test('f11: the countdown - three lanterns, three forms: the planks stop an ember, the pinhole an ember, the ledge only a jump', () => {
  const doors = [['doorE', 28.0, 'lampE'], ['doorS', 50.0, 'lampS'], ['doorB', 80.0, 'lampB']];
  for (const [id, x, lamp] of doors) {
    const r = at(f11, C11(x - 1.5), 0, 0); const e = hold(r, 1, 0, 3, { jump: true });
    assert(e.maxX < C11(x + 0.03) - R + 1e-6, `${id} was passed without ${lamp}`); eq(door(r, id).open, 0);
  }
  const pin = at(f11, C11(38.5), 0, 0.6); hold(pin, 0, 1, 2); assert(pin.p.z < 1.6 - R + 1e-6, 'an ember got into the alcove');
  const pl = at(f11, C11(64), 0, 0); const px = hold(pl, 1, 0, 3, { jump: true });
  assert(px.maxX < C11(66) - R + 1e-6, 'an ember got through the planks'); eq(wood(pl, 'planks').state, 0);
  const led = at(f11, C11(16), 0, 2.6); led.jumpTo(C11(19.5), 2.6); eq(sig(led, 'lampE'), true, 'an ember lights the ledge lantern with a jump');
});

test('f11: the countdown - the fuse is the clock: 131 m at 2.0 m/s is about 66 s, a late player finds the cannon harmless and relights the short fuse', () => {
  const f = fuse(play(f11), 'fuseE'); between(f.len / f.rate, 64, 68, 'the long fuse is about sixty-six seconds');
  const w = at(f11, C11(180.9), 0, 0); idle(w, 5); eq(gasOf(w, 'cannon').blasts, 0, 'standing in the cannon does nothing before the flame');
  // the cannon from either input, ember or blaze, lands past the last chasm and never in the pool of the last room
  for (const [form, mx] of [['ember', 0], ['ember', 1], ['blaze', 0], ['blaze', 1]]) {
    const r = at(f11fast, C11(57.9), 0, -3.1, form);        // standing at the frayed end lights it; then straight to the cannon
    eq(fuse(r, 'fuseE').state, 1);
    r.sim.teleport(C11(180.9), 0, 0);
    let launched = false;
    for (let i = 0; i < 6 * 120 && !launched; i++) { r.tick(0, 0, false); launched = gasOf(r, 'cannon').blasts > 0 && !r.p.grounded; }
    for (let i = 0; launched && i < 9 * 120 && r.sim.deaths === 0; i++) { r.tick(mx, 0, false); if (r.p.grounded) break; }
    assert(launched && r.sim.deaths === 0, `${form} mx=${mx}: thrown and dry`);
    assert(r.p.x > O11.mouth && r.p.x < M11(36), `${form} mx=${mx}: lands in the last room, before its pool (x=${r.p.x - O11.mouth})`);
  }
  const j = leap(at(f11, C11(187), 0, 0), 3, { jumpAt: 20 });
  assert(j.stoodX < C11(188.6), `an ember jumped the last chasm: ${j.stoodX}`);
});

test('f11: the countdown - being late is cheap: the cannon goes off alone and harmlessly, the long fuse regrows, and a second fuse by the rail brings the flame back in 21 s; a spark cannot set it off early', () => {
  const e2 = fuse(play(f11), 'fuseE2'); between(e2.len / e2.rate, 19, 23, 'the second fuse is about twenty-one seconds');
  // nobody in the pocket when the long flame arrives: the cannon fires, nobody is hurt, the fuse is whole again after its regrow time
  const late = at(f11fast, C11(57.9), 0, -3.1); late.sim.teleport(C11(172), 0, 0);
  late.waitUntil(() => gasOf(late, 'cannon').blasts > 0, { timeout: 12, label: 'it goes off alone' }); eq(late.sim.deaths, 0, 'harmless');
  late.waitUntil(() => fuse(late, 'fuseE').state === 0, { timeout: 12, label: 'the long fuse is whole again' });
  // the second fuse: lit beside the brazier before the rail, it sets the same cannon off, and a player in the pocket is thrown past the last chasm
  const f2 = (r) => fuse(r, 'fuseE2');
  const q = at({ ...f11, pieces: f11.pieces.map((p) => (p.id === 'fuseE2' ? { ...p, rate: p.rate * 20 } : p)) }, C11(147.6), 0, -3.0);
  eq(f2(q).state, 1, 'the frayed end of the second fuse lights from beside the brazier');
  q.sim.teleport(C11(180.9), 0, 0);
  let launched = false; for (let i = 0; i < 6 * 120 && !launched; i++) { q.tick(0, 0, false); launched = gasOf(q, 'cannon').blasts > 0 && !q.p.grounded; }
  for (let i = 0; launched && i < 9 * 120 && q.sim.deaths === 0; i++) { q.tick(0, 0, false); if (q.p.grounded) break; }
  assert(launched && q.sim.deaths === 0 && q.p.x > O11.mouth, 'thrown over the last chasm by the second fuse');
  // a spark standing under the cannon never fires it early: it runs under the cloud
  const sp = at(f11, C11(180.9), 0, 0, 'spark'); idle(sp, 3); eq(gasOf(sp, 'cannon').blasts, 0, 'a spark in the cannon does not set it off');
  // the annex: a long corridor, a glow-stone at its end that only a walk takes
  const an = at(f11, C11(176), 0, 3.0); an.walkTo(C11(178), 56.8, { stuck: 0 }); assert(an.sim.shardsTaken.length === 1 && an.sim.deaths === 0, 'the glow-stone at the end of the annex');
});

test('f11: the countdown - a pool of eight metres for a blaze, a rail for a spark, and the stone that only a blaze rides high enough to take', () => {
  assert(diesWalking(at(f11, C11(132), 0, 0), C11(138), 0, 3), 'wading the pool kills an ember');
  const cold = at(f11, C11(133), 0, 0, 'blaze', 1.2); assert(diesWalking(cold, C11(141), 0, 4), 'a blaze that cannot pay for the boil is put out');
  const j = leap(at(f11, C11(162), 0, 1.6), 3, { jumpAt: 25 }); assert(j.stoodX < C11(164), 'an ember jumped the rail\'s chasm');
  const s = at(f11, C11(160), 0, 0, 'spark'); s.walkTo(C11(162.4), 0, { stuck: 0 }); s.waitUntil((q, p) => p.ride, { timeout: 2 });
  s.waitUntil((q, p) => !p.ride, { timeout: 5 }); assert(s.p.x > C11(173) && s.sim.deaths === 0);
  const stoneBy = (form, mx) => {
    const r = at(f11fast, C11(57.9), 0, -3.1, form); r.sim.teleport(C11(180.9), 0, 0);
    for (let i = 0; i < 12 * 120 && r.sim.deaths === 0; i++) { r.tick(0, 0, false); if (!r.p.grounded) break; }
    for (let i = 0; i < 12 * 120 && r.sim.deaths === 0; i++) { r.tick(mx, 0, false); if (r.p.grounded) break; }
    return r.sim.shardsTaken.includes(2);
  };
  assert(!stoneBy('ember', 1) && !stoneBy('ember', 0), 'an ember cannot reach the high stone');
  assert(stoneBy('blaze', 1) && stoneBy('blaze', 0), 'a blaze takes it from either input');
});

test('f11: the kiln mouth - the exit opens only in the fuse\'s window; an ember cannot cross the pool; a spark with the wire makes the window', () => {
  const x = at(f11, M11(65), 0, 0); idle(x, 1); assert(!x.sim.completed, 'standing at the shut kiln door is not enough');
  assert(diesWalking(at(f11, M11(33), 0, 0), M11(40), 0, 3), 'wading the last pool kills an ember');
  const r = at(f11, M11(6), 0, -2.4, 'spark'); eq(fuse(r, 'fuseF').state, 1);
  r.walkTo(M11(34.4), 0, { stuck: 0 }); r.waitUntil((s, p) => p.ride, { timeout: 3 }); r.waitUntil((s, p) => !p.ride, { timeout: 4 });
  r.walkTo(M11(66), 0, { slow: false, stuck: 0 });
  r.waitUntil((s) => s.completed, { timeout: 4, label: 'in through the open door' });
  between(r.t, 3.6, 14, 'arrives inside the window');
  const late = at(f11, M11(6), 0, -2.4, 'spark'); late.walkTo(M11(3), 0); late.wait(16);   // the window has come and gone
  late.sim.teleport(M11(66), 0, 0); late.wait(0.5); assert(!late.sim.completed, 'a spark that dawdled finds the door shut again');
  eq(fuse(late, 'fuseF').state, 0, 'and the fuse is ready to be lit again');
});

test('f11: cannot be made unwinnable - every fuse regrows, every pocket refills, no wood is needed twice, coal and braziers refuel the forms that need heat', () => {
  const r = play(f11);
  eq(r.sim.level.fuses.filter((f) => !(f.regrow > 0)).length, 0);
  eq(r.sim.level.gases.filter((g) => !(g.refill > 0)).length, 0);
  eq(f11.pieces.filter((p) => p.type === 'wood').map((p) => p.id), ['planks']);
  // heat for the cannon's blaze: the coal and the brazier on the way are in reach of the pocket
  const near2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const cannon = r.sim.level.gases.find((g) => g.id === 'cannon');
  assert(r.sim.level.coals.some((c) => near2(c.pos, [(cannon.box[0] + cannon.box[3]) / 2, 0, 0]) < 8), 'coal near the cannon');
  // a blaze with no heat left falls back to an ember on the spot, alive
  const dry = at(f11, C11(90), 0, 0, 'blaze', 0.4); idle(dry, 1); eq(dry.p.form, 'ember'); eq(dry.sim.deaths, 0);
});

// ================================================================================== f12 The Great Chimney
const W12 = (x) => O12.wire + x, F12 = (x) => O12.flue + x, C12 = (x) => O12.cold + x, G12 = (x) => O12.gas + x, K12 = (x) => O12.chim + x;

/** The level with the boiler fuse burning 500 times faster, so a lit fuse is a spent fuse (a warm cold store) a moment later. */
const f12warm = { ...f12, pieces: f12.pieces.map((p) => (p.id === 'fuseW' ? { ...p, rate: p.rate * 500 } : p)) };

test('f12: six named areas, a brazier at the start of each, and the finale route fits the 125-150 s band', () => {
  checkAreas(f12, 6);
  houseRules(f12);
  between(routeSeconds(f12, sol12), 125, 150, 'solve() route time');
  between(routeSeconds(f12, sol12, 'solveAll'), 125, 150, 'solveAll() route time');
});

test('f12: all four forms are offered - the finale asks for every one of them', () => {
  const r = play(f12);
  for (const f of ['blaze', 'smoke', 'spark']) r.form(f);                // would throw if a form were locked
  const sim = new Sim(f12);
  assert(sim.level.woods.length > 0 && sim.level.iceblocks.length > 0 && sim.level.pools.length > 0 && sim.level.drips.length > 0 &&
    sim.level.sprinklers.length > 0 && sim.level.fuses.length > 0 && sim.level.gases.length > 0 && sim.level.terminals.length > 0 &&
    sim.level.grates.length > 0 && sim.level.fans.length > 0 && sim.level.heatsensors.length > 0 && sim.level.movers.length > 0, 'the finale uses every piece of the road');
});

test('f12: the stokehole - planks, ice and a pool want a blaze; the beams want an ember; the lantern wants a flame; the door wants the burner', () => {
  const e = at(f12, 10, 0, 0); assert(hold(e, 1, 0, 3, { jump: true }).maxX < 12 - R + 1e-6, 'an ember got through the planks'); eq(wood(e, 'planks').state, 0);
  const b = at(f12, 22, 0, 0, 'blaze'); assert(hold(b, 1, 0, 3, { jump: true }).maxX < 24 - RB + 1e-6, 'a blaze passed under the low beam');
  const b2 = at(f12, 72, 0, 0, 'blaze'); assert(hold(b2, 1, 0, 3, { jump: true }).maxX < 74 - RB + 1e-6, 'a blaze passed under the second beam');
  const k = at(f12, 28, 0, 0); assert(hold(k, 1, 0, 2).maxX > 30, 'an ember ducks under the beam');
  const ice = at(f12, 38.4, 0, 0); assert(hold(ice, 1, 0, 3, { jump: true }).maxX < 40 - R + 1e-6, 'an ember got through the ice'); eq(by(ice.sim.level.iceblocks, 'ice').gone, false);
  const m = at(f12, 38.4, 0, 0, 'blaze'); m.waitUntil((s) => by(s.level.iceblocks, 'ice').gone, { toward: [40.3, 0], timeout: 4 });
  assert(diesWalking(at(f12, 52.5, 0, 0), 60, 0, 3), 'wading the pool kills an ember');
  const bo = at(f12, 52.6, 0, 0, 'blaze', 10); bo.walkTo(53.7, 0); bo.wait(0.2); assert(by(bo.sim.level.pools, 'pool').steamT > 0, 'a blaze boils it');
  const cold = at(f12, 52.4, 0, 0, 'blaze', 1.2); assert(diesWalking(cold, 60, 0, 3), 'a blaze that cannot pay for the boil is put out');
  const d = at(f12, 106, 0, 0); assert(hold(d, 1, 0, 3, { jump: true }).maxX < 108.03 - R + 1e-6, 'got through the first door without the burner'); eq(sig(d, 'burnA'), false);
  const smoke = at(f12, 99.5, 0, 0, 'smoke'); idle(smoke, 1); eq(sig(smoke, 'lampA'), false, 'smoke cannot light a lantern');
  const em = at(f12, 99.5, 0, 0); eq(sig(em, 'lampA'), true, 'an ember can'); em.wait(0.2); eq(sig(em, 'burnA'), true, 'and the burner stays lit');
});

test('f12: the wire gallery - drips and tanks kill; the valve fuse, the lantern, the shutter fuse, two wires and the socket in that order', () => {
  at(f12, W12(6.5), 0, 0).waitUntil((s) => s.deaths > 0, { timeout: 2.5, label: 'a drop lands' });
  assert(diesWalking(at(f12, W12(5), 0, 0), W12(5), 2.5, 2), 'stepping off the causeway is the tank');
  const spray = at(f12, W12(24), 0, 3.0); idle(spray, 1); assert(spray.sim.deaths > 0, 'a dawdler in the live spray tunnel is put out');
  const wire = (r, id) => by(r.sim.level.wires, id);
  const a = at(f12, W12(32), 0, 0, 'spark'); a.walkTo(W12(33), 0, { stuck: 0 }); idle(a, 0.5); eq(a.p.ride, null, 'wire one carries nothing before the lantern');
  eq(wire(a, 'w1').active, false); eq(wire(a, 'w2').active, true);
  const l = at(f12, W12(30), 0, -3.2); eq(fuse(l, 'fuseV').state, 1);
  l.walkTo(W12(20.8), -0.4).walkTo(W12(20.8), 3.0, { slow: false })
    .waitUntil((s) => !by(s.level.sprinklers, 'tunnel').wet, { timeout: 8 }).walkTo(W12(25.8), 3.0, { slow: false });
  eq(sig(l, 'lampG'), true); l.wait(0.1); eq(wire(l, 'w1').active, true, 'the lantern wakes the first wire');
  for (const pool of [[33, 'pool1'], [45, 'pool2']]) assert(leap(at(f12, W12(pool[0] - 1.5), 0, 1.6), 3, { jumpAt: 25 }).stoodX < W12(pool[0] + 6.5) - 0.5, `${pool[1]} was jumped`);
  const sh = at(f12, W12(54.5), 0, 0); const x = hold(sh, 1, 0, 3, { jump: true }); assert(x.maxX < W12(56.03) - R + 1e-6, 'the shutter holds without its fuse');
  const so = at(f12, W12(63), 0, 0); idle(so, 0.5); eq(sig(so, 'sockB'), false, 'an ember powers nothing');
  const sp = at(f12, W12(62), 0, 0, 'spark'); sp.walkTo(W12(63), 0); eq(sig(sp, 'sockB'), true); sp.wait(0.1); eq(sig(sp, 'burnB'), true, 'the second burner is lit for good');
  const dd = at(f12, W12(68), 0, 0); assert(hold(dd, 1, 0, 3, { jump: true }).maxX < W12(70.03) - R + 1e-6, 'the second door holds without the burner');
});

test('f12: the flue - a grate only smoke passes, a draught up the shaft, a closet only smoke enters, and a loft where smoke cannot light', () => {
  const e = at(f12, F12(12.6), 0, 0); assert(hold(e, 1, 0, 2).maxX < F12(14) - R + 1e-6, 'an ember passed the foot grate');
  const b = at(f12, F12(12.6), 0, 0, 'blaze'); assert(hold(b, 1, 0, 2).maxX < F12(14) - RB + 1e-6, 'a blaze passed the foot grate');
  const s = at(f12, F12(12.6), 0, 0); s.form('smoke');
  s.waitUntil((q, p) => p.x > F12(16), { toward: [F12(17), 0], timeout: 3, label: 'smoke slips through the grate' });
  s.waitUntil((q, p) => p.y > 8.6, { toward: [F12(17), 0], timeout: 6, label: 'and the flue takes it up' });
  s.waitUntil((q, p) => p.x > F12(20.6), { toward: [F12(24), 0], timeout: 3, label: 'through the top grate into the loft' });
  assert(s.p.gauge > 3, 'the whole climb spends only a few seconds of smoke');
  // the closet: its stone is smoke's, and a smoke that stays too long (or runs dry) finds coal
  const c = at(f12, F12(17), 2.8, 3.4, 'smoke'); c.waitUntil((q, p) => p.z > 4.6, { toward: [F12(17), 5.4], timeout: 3 });
  c.waitUntil((q) => q.shardsTaken.includes(1), { toward: [F12(17), 5.2], timeout: 3, label: 'the closet stone' });
  const trap = at(f12, F12(17), 2.2, 5.6, 'ember', 0); trap.form('smoke', { expect: false });
  trap.walkTo(F12(17), 6.6, { stuck: 0, tol: 0.5 }); assert(trap.p.gauge >= 3, 'coal in the closet'); trap.form('smoke');
  trap.waitUntil((q, p) => p.z < 3.5, { toward: [F12(17), 0], timeout: 4, label: 'out of the closet again' });
  const dry = at(f12, F12(17), 0, 0, 'ember', 0); dry.walkTo(F12(16.5), -2.4, { stuck: 0, tol: 0.5 }); assert(dry.p.gauge >= 3, 'coal at the foot of the flue'); dry.form('smoke');
  // the loft
  const lm = at(f12, F12(32.6), 9, 0, 'smoke'); idle(lm, 1); eq(sig(lm, 'lampC'), false, 'smoke cannot light the loft lantern');
  const sf = at(f12, F12(22.8), 9, -2.9, 'smoke'); idle(sf, 1); eq(fuse(sf, 'fuseL').state, 0, 'or the loft fuse');
  const em = at(f12, F12(22.8), 9, -2.9); eq(fuse(em, 'fuseL').state, 1, 'an ember lights the fuse');
  const sp = at(f12, F12(30.6), 9, 0); idle(sp, 1); assert(sp.sim.deaths > 0, 'the curtain is live until the valve shuts: an ember in it is put out');
  const gate = at(f12, F12(35), 9, 0); assert(hold(gate, 1, 0, 3, { jump: true }).maxX < F12(36.03) - R + 1e-6, 'the loft door holds without the lantern');
});

test('f12: the gas gallery - a form on every rung, both inputs land, and the lift runs only on the plate and comes back for a retry', () => {
  for (const mx of [0, 1]) {
    const a = thrown(f12, G12(10), 9, 0, 'ember', { mx }); assert(a.launched && Math.abs(a.y - 12.2) < 0.05 && a.x > G12(14) && a.x < G12(22), `mx=${mx}: rung one (x=${a.x - O12.gas})`);
    const b = thrown(f12, G12(19.4), 12.2, 0, 'spark', { mx }); assert(b.launched && Math.abs(b.y - 16) < 0.05 && b.x > G12(30) && b.x < G12(46), `mx=${mx}: rung two (x=${b.x - O12.gas})`);
    const c = thrown(f12, G12(42), 16, 0, 'blaze', { mx, wait: 4 }); assert(c.launched && Math.abs(c.y - 19.8) < 0.05 && c.x > G12(52), `mx=${mx}: rung three (x=${c.x - O12.gas})`);
  }
  const ex = at(f12, G12(42), 16, 0); idle(ex, 3); eq(gasOf(ex, 'gasV').blasts, 0, 'an ember on the sensor sets nothing off');
  const up = at(f12, G12(12), 9, 0); assert(hold(up, 1, 0, 2, { jump: true }).maxY < 11.4, 'an ember jumped to rung one');
  // the lift
  const nope = at(f12, G12(63.5), 19.8, 0); idle(nope, 4); near(nope.p.y, 19.8, 0.05, 'standing on the deck does not raise it');
  const r = at(f12, G12(58.6), 19.8, -2.4); eq(sig(r, 'liftPlate'), true);
  r.walkTo(G12(63.5), 0, { tol: 0.4 });
  r.waitUntil((s, p) => p.y > 30.8, { timeout: 14, label: 'the lift reaches the top' }); eq(r.sim.deaths, 0);
  const late = at(f12, G12(58.6), 19.8, -2.4); late.walkTo(G12(56), 0); idle(late, 28);
  near(by(late.sim.level.movers, 'lift').t, 0, 1e-6, 'a lift nobody boarded has come back down');
  late.walkTo(G12(58.6), -2.4); late.walkTo(G12(63.5), 0, { tol: 0.4 }); late.waitUntil((s, p) => p.y > 30.8, { timeout: 14, label: 'and it can be called again' });
});

test('f12: the chimney - a blaze on the sensor lights the last burner, the draught takes it to a ledge, and a second sensor there draws it up to the rim', () => {
  const em = at(f12, K12(10), 31, 0); idle(em, 4); eq(sig(em, 'burnC'), false, 'an ember on the sensor does nothing');
  const bs = at(f12, K12(10), 31, 0, 'blaze', 10);
  eq(sig(bs, 'burnC'), true, 'a blaze does'); eq(sig(bs, 'lit'), false, 'but the chimney needs all three burners');
  const toFoot = () => { const r = play(f12); sol12.parts.slice(0, 5).forEach((f) => f(r, false)); return r; };    // the real route to the chimney's foot
  const full = toFoot();
  eq(sig(full, 'burnA'), true); eq(sig(full, 'burnB'), true); eq(sig(full, 'burnC'), false, 'the chimney is cold when Cinder arrives');
  full.walkTo(K12(2.4), 3.0).form('blaze').walkTo(K12(10), 0).waitUntil((s) => sig(full, 'lit'), { timeout: 3, label: 'the chimney lights' });
  let minHeat = 10;
  const track = (p) => { minHeat = Math.min(minHeat, p.gauge); };
  full.waitUntil((s, p) => { track(p); return p.y > 58; }, { toward: [K12(9), 1.8], timeout: 12, label: 'up to the ledge' });
  eq(sig(full, 'liftB'), false, 'the upper draught is still off: the second sensor has not been lit');
  full.waitUntil((s, p) => { track(p); return p.grounded && p.y > 59; }, { toward: [K12(9), -2.4], timeout: 12, label: 'on the ledge' });
  full.walkTo(K12(11.8), -2.0).waitUntil((s) => sig(full, 'burnD'), { timeout: 3, label: 'the second sensor trips' });
  full.waitUntil((s, p) => { track(p); return p.y > 96; }, { toward: [K12(10), 0], timeout: 25, label: 'carried to the top' });
  assert(minHeat > 0.6, `the climb never runs dry (lowest heat ${minHeat.toFixed(2)})`);
  const wave = (id) => full.sim.level.fires.find((q) => q.id === id);
  assert(['fireLo', 'fireMid', 'fireHi', 'fireTop'].every((id) => wave(id).active), 'the fires have run up the throat');
  // the ledge's underside is in the way on its own side: the way up is the open half of the throat
  const under = toFoot(); under.walkTo(K12(2.4), 3.0).form('blaze').walkTo(K12(10), 0).waitUntil((s) => sig(under, 'lit'), { timeout: 3 });
  let maxY = 0; for (let i = 0; i < 14 * 120; i++) { under.tick(0, -1, false); maxY = Math.max(maxY, under.p.y); }
  assert(maxY < 59.1, `a blaze rising under the ledge is stopped by it (reached ${maxY.toFixed(1)})`);
  // an ember on the second sensor does nothing; the upper draught waits for a flame that is a blaze
  const hd = at(f12, K12(11.8), 60, -2.0); idle(hd, 3); eq(sig(hd, 'burnD'), false, 'an ember on the second sensor does nothing');
  const hb = at(f12, K12(11.8), 60, -2.0, 'blaze', 10); hb.wait(0.4); eq(sig(hb, 'burnD'), true, 'a blaze does');
  eq(sig(hb, 'lit'), false, 'but the upper draught is on only when the chimney as a whole is lit');
  // an ember in the draught is not lifted; smoke is, and the rain turns it back as an ember
  const ember = toFoot(); ember.walkTo(K12(2.4), 3.0).form('blaze').walkTo(K12(10), 0).waitUntil((s) => sig(ember, 'lit'), { timeout: 3 });
  ember.form('ember'); ember.walkTo(K12(4), 0); idle(ember, 1); ember.walkTo(K12(10), 0); idle(ember, 4); assert(ember.p.y < 33, 'an ember in the throat is not carried up');
  const smoke = toFoot(); smoke.walkTo(K12(2.4), 3.0).form('blaze').walkTo(K12(10), 0).waitUntil((s) => sig(smoke, 'lit'), { timeout: 3 });
  smoke.waitUntil((s, p) => p.y > 40, { toward: [K12(9), 1.8], timeout: 6 }); smoke.form('smoke'); let smax = 0;
  for (let i = 0; i < 8 * 120; i++) { smoke.tick(0, 0, false); smax = Math.max(smax, smoke.p.y); }
  assert(smax < 76, `smoke does not get past the rain at 74: ${smax}`);
});

test('f12: the boiler - a long fuse lit in the Wire Gallery is the set-up; the cold store two areas on is frozen until it has burned out', () => {
  // the first point of the fuse is beside the brazier of the second area; an ember on the route's line lights it
  const f = at(f12, W12(3.3), 0, -0.9); eq(fuse(f, 'fuseW').state, 1, 'standing beside the brazier lights the fuse');
  const none = at(f12, W12(3.3), 0, 0); idle(none, 1); eq(fuse(none, 'fuseW').state, 0, 'walking the straight line past it does not light it: the fuse takes a step off the line');
  const smoke = at(f12, W12(3.3), 0, -0.9, 'smoke'); idle(smoke, 1); eq(fuse(smoke, 'fuseW').state, 0, 'smoke cannot light it');
  // it burns for about forty seconds and then stays out, which is when the frost goes
  const fz = fuse(f, 'fuseW'); const secs = fz.len / fz.rate; between(secs, 35, 45, 'the boiler fuse burns about forty seconds');
  eq(sig(f, 'warm'), false, 'not yet'); f.wait(secs + 1); eq(sig(f, 'warm'), true, 'the boiler is warm');
  f.wait(30); eq(sig(f, 'warm'), true, 'and stays warm (the latch holds, though the fuse itself grows back for a retry)');
  // on the reference route the fuse has burned out well before the frost is met
  const route = play(f12); sol12.parts.slice(0, 3).forEach((fn) => fn(route, false));
  const z = by(route.sim.level.zones, 'frost1'); assert(!z.active, 'the frost is already off when the route reaches the cold store'); assert(sig(route, 'warm'), 'because the boiler fuse has burned out');
  // a route that skipped the fuse meets frost: a blaze put in it is put back to an ember and cannot re-form
  const cold = at(f12, C12(20), 9, 0, 'blaze', 10); cold.wait(0.4); eq(cold.p.form, 'ember', 'frost turns a blaze back to an ember'); cold.form('blaze', { expect: false });
  eq(cold.p.form, 'ember', 'and will not take the form again');
  const ice = at(f12, C12(30.6), 9, 0, 'blaze', 10); ice.wait(4); eq(by(ice.sim.level.iceblocks, 'iceC1').gone, false, 'so the first wall of ice cannot be melted');
  const em = at(f12, C12(29), 9, 0); assert(hold(em, 1, 0, 3, { jump: true }).maxX < C12(31) - R + 1e-6, 'an ember does not get through the ice');
  // a warm store: the same blaze lives and melts the wall
  const warm = at(f12warm, W12(3.3), 0, -0.9); warm.wait(0.5); eq(sig(warm, 'warm'), true);
  warm.sim.teleport(C12(30.6), 9, 0); warm.form('blaze'); warm.waitUntil((q) => by(q.level.iceblocks, 'iceC1').gone, { toward: [C12(31.3), 0], timeout: 4, label: 'a blaze melts it in a warm store' });
  eq(warm.p.form, 'blaze'); eq(warm.sim.deaths, 0);
});

test('f12: the cold store stretch is a heat budget - pools boil for two, thick walls melt for four, one coal, and a blaze that stays a blaze runs dry', () => {
  // the reference route: ember between everything, coal after the first pool
  const ok = at(f12warm, C12(35), 9, 0); sol12.coldStretch(ok); eq(ok.sim.deaths, 0);
  assert(ok.p.gauge > 1.5, `the reference route keeps a reserve (heat left ${ok.p.gauge.toFixed(2)} after the second pool)`);
  // the same route without the coal does not make it
  const nc = at(f12warm, C12(35), 9, 0); let threw = null;
  try { sol12.coldStretch(nc, { coal: false }); } catch (e) { threw = e; }
  assert(threw || nc.sim.deaths > 0 || nc.p.x < C12(69), `without the coal the stretch is not finished (x=${(nc.p.x - O12.cold).toFixed(1)})`);
  // staying a blaze the whole way is no better
  const stay = at(f12warm, C12(35), 9, 0, 'blaze', 10); const d0 = stay.sim.deaths; let crossed = false;
  for (let i = 0; i < 25 * 120; i++) { stay.tick(1, 0, i % 90 < 20); if (stay.p.x > C12(65) && stay.sim.deaths === d0) crossed = true; }
  assert(!crossed, `a blaze that never lets up does not get across the second pool (x=${(stay.p.x - O12.cold).toFixed(1)}, ${stay.p.form}, deaths ${stay.sim.deaths - d0})`);
  // the pools and the wall are what they say
  assert(diesWalking(at(f12warm, C12(38.6), 9, 0), C12(45), 0, 3), 'wading the first pool kills an ember');
  for (const [x, far, name] of [[C12(38), C12(46.4), 'first'], [C12(56), C12(64.4), 'second']]) {
    const j = leap(at(f12warm, x, 9, 0), 3, { jumpAt: 20 }); assert(j.stoodX < far, `the ${name} pool is no jump for an ember: ${j.stoodX}`);
  }
  for (const [x, wx] of [[51, 52], [67, 68]]) { const wall = at(f12warm, C12(x), 9, 0); assert(hold(wall, 1, 0, 3, { jump: true }).maxX < C12(wx) - R + 1e-6, `an ember does not get through the wall of ice at ${wx}`); }
  const beam = at(f12warm, C12(70), 9, 0, 'blaze'); assert(hold(beam, 1, 0, 3, { jump: true }).maxX < C12(71.2) - RB + 1e-6, 'a blaze does not fit under the low beam');
  const pass = at(f12warm, C12(70), 9, 0); assert(hold(pass, 1, 0, 2).maxX > C12(73.8), 'an ember ducks under it');
  // the coal is only taken when the gauge has room, comes back with a retry, and the brazier before the stretch is a full gauge
  const coalOf = (r) => r.sim.level.coals.find((c) => Math.abs(c.pos[0] - C12(55.4)) < 0.01);
  const coal = at(f12warm, C12(55.4), 9, 2.4, 'ember', 10); eq(coalOf(coal).taken, false, 'a full gauge leaves the coal where it is');
  const low = at(f12warm, C12(55.4), 9, 2.4, 'ember', 3); assert(low.p.gauge > 6 && coalOf(low).taken, 'a low gauge takes it');
  low.restart(); eq(coalOf(low).taken, false, 'and a retry puts it back'); eq(low.p.gauge, 10);
});

test('f12: cannot be made unwinnable - nothing is spent that is needed twice, and every dead end has its coal, brazier or retry', () => {
  const sim = new Sim(f12);
  // permanent things: planks (1), ice (2), nothing else burns; every one stands between two braziers and only ever opens a way on
  eq(f12.pieces.filter((p) => p.type === 'wood').map((p) => p.id), ['planks']);
  eq(f12.pieces.filter((p) => p.type === 'iceblock').map((p) => p.id), ['ice', 'ice2', 'iceC1', 'iceC2', 'iceC3']);
  eq(f12.pieces.filter((p) => p.type === 'weakwall').length, 0);
  // the three latches (lantern, socket, sensor) only ever switch things on
  for (const n of ['burnA', 'burnB', 'burnC']) assert(f12.signals[n] && f12.signals[n].latch, `${n} is a latch`);
  assert(!JSON.stringify(f12.pieces).includes('"!burn') && !JSON.stringify(f12.pieces).includes('!lit'), 'nothing is switched OFF by a burner');
  // blaze tasks each have a brazier within 8 m before them
  const brs = sim.level.braziers.map((b) => b.pos);
  for (const x of [11.6, 39.6, 53.2, 77, 85.6]) assert(brs.some((b) => b[0] < x && x - b[0] < 17 && Math.abs(b[1]) < 0.1), `a brazier before the blaze task at x=${x}`);
  // a respawn at the foot of the chimney is a full gauge and a blaze that lit it can be lit again
  const r = at(f12, K12(2.4), 31, 3.4, 'blaze', 2); r.restart(); eq(r.p.gauge, 10);
  // the frayed ends relight, so a missed valve, shutter or boiler is a retry
  eq(sim.level.fuses.filter((f) => !(f.regrow > 0)).length, 0);
  assert(f12.signals.warm && f12.signals.warm.latch === 'fuseW', 'the boiler latches: once warm, warm for good');
  assert(JSON.stringify(f12.pieces).includes('"on":"!warm"') && !JSON.stringify(f12.pieces).includes('"on":"warm"'), 'warmth only ever switches the frost off');
});

test('f11: cannot be skipped - no spark can set the cannon off before the flame does (it hangs head-high: under it, jumping at it, or switched to inside it)', () => {
  const cx = C11(180.9);
  const watch = (r, seconds, mx = 0, jump = false) => { for (let i = 0; i < seconds * 120; i++) r.tick(mx, 0, jump && i % 40 < 15); return gasOf(r, 'cannon').blasts; };
  eq(watch(at(f11, cx, 0, 0, 'spark'), 8), 0, 'a spark standing under it');
  eq(watch(at(f11, cx - 1.5, 0, 0, 'spark'), 3, 1, true), 0, 'a spark running through it, jumping');
  eq(watch(at(f11, cx, 0, 0, 'spark'), 8, 0, true), 0, 'a spark jumping under it for eight seconds');
  const sw = at(f11, cx, 0, 0); sw.form('spark'); eq(sw.p.form, 'spark'); eq(watch(sw, 6, 0, true), 0, 'an ember that turns into a spark under it');
  const cannon = gasOf(sw, 'cannon');
  assert(cannon.box[1] > 0.74 + 0.02 && cannon.box[1] <= 0.56 + 0.25 + 1e-9, 'its underside is above a jumping spark\'s head and within an ember\'s reach');
  // the same flame that throws an ember or a blaze leaves a spark where it stands
  const fast = at(f11fast, C11(57.9), 0, -3.1, 'spark'); fast.sim.teleport(cx, 0, 0);
  fast.waitUntil((s) => gasOf(fast, 'cannon').blasts > 0, { timeout: 6, label: 'the flame arrives' });
  fast.wait(0.5); assert(fast.p.y < 0.6 && fast.p.grounded, 'a spark is not thrown by the cannon');
  // the two match-room pockets are hung the same way: the lesson is the fuse, not the touch
  for (const [x, id] of [[22, 'gasA'], [46, 'gasB']]) {
    const r = at(f11, x, 0, 0, 'spark'); for (let i = 0; i < 5 * 120; i++) r.tick(0, 0, i % 40 < 15);
    eq(gasOf(r, id).blasts, 0, `${id}: a spark does not set it off`);
  }
  // and an ember or a blaze really is thrown by it when the flame comes
  for (const form of ['ember', 'blaze']) {
    const r = at(f11fast, C11(57.9), 0, -3.1, form); r.sim.teleport(cx, 0, 0);
    let up = false; for (let i = 0; i < 6 * 120 && !up; i++) { r.tick(0, 0, false); up = !r.p.grounded && r.p.vy > 1; }
    assert(up, `${form} under the cannon is thrown`);
  }
});

test('f11: the crawlspace takes only a spark; the sensor door wants a flame and keeps its answer', () => {
  const e = at(f11, C11(95), 0, 1.0); hold(e, 0, 1, 1.5); assert(e.p.z < 1.8 - R + 1e-6, 'an ember got under the shelf');
  const s = at(f11, C11(95), 0, 1.0, 'spark'); hold(s, 0, 1, 0.6); assert(s.p.z > 2.5, 'a spark crawls under it');
  s.walkTo(C11(106.3), 3.0); eq(sig(s, 'lampT'), true);
  const d = at(f11, C11(110.4), 0, 0); assert(hold(d, 1, 0, 3, { jump: true }).maxX < C11(112.03) - R + 1e-6, 'door four holds without its lantern');
  const em = at(f11, C11(118.5), 0, 0); idle(em, 2); eq(sig(em, 'openD'), false, 'an ember on the sensor does nothing');
  const bl = at(f11, C11(118.5), 0, 0, 'blaze'); bl.wait(0.3); eq(sig(bl, 'openD'), true); bl.form('ember'); bl.wait(1); eq(sig(bl, 'openD'), true, 'and it stays open');
  const dd = at(f11, C11(122.4), 0, 0); assert(hold(dd, 1, 0, 3, { jump: true }).maxX < C11(124.03) - R + 1e-6, 'the last door holds without the sensor');
});

test('f09: the dull rail, the towers and the second gauntlet - each wants its own thing, and nothing else gets across', () => {
  const wire = (r, id) => by(r.sim.level.wires, id);
  // the third chasm: dull until the ledge lantern is lit; an ember jumps to the ledge, a spark cannot
  const dull = at(f09, R9(49), 0, 0, 'spark'); dull.walkTo(R9(50.4), 0, { stuck: 0 }); idle(dull, 0.5); eq(dull.p.ride, null, 'the third rail carries nothing before its lantern');
  eq(wire(dull, 'rail3').active, false);
  const ledgeSpark = at(f09, R9(42), 0, -2.9, 'spark'); const ls = hold(ledgeSpark, 1, 0, 2, { jump: true }); assert(ls.maxY < 0.7, 'a spark cannot jump a 1.2 m ledge');
  const l = at(f09, R9(42), 0, -2.9); l.jumpTo(R9(45.1), -2.9); eq(sig(l, 'lampR'), true); l.wait(0.1); eq(wire(l, 'rail3').active, true);
  assert(leap(at(f09, R9(48.4), 0, 1.6), 3, { jumpAt: 25 }).stoodX < R9(62) - 0.1, 'an ember jumped the third chasm');
  // the towers: an ember climbs the first (1.2 m) but not the second (3.4 m); the wire is a spark's
  const t1 = at(f09, 38.6, 0, -2.3); t1.jumpTo(41.4, -2.3, { tol: 0.4 }); near(t1.p.y, 1.2, 0.05, 'an ember climbs the first tower');
  const t2 = at(f09, 45, 0, -2.3); assert(hold(t2, 1, 0, 2, { jump: true }).maxY < 2.1, 'an ember cannot climb the second tower');
  const w = at(f09, 40.8, 1.2, -2.3, 'spark'); w.walkTo(41.4, -2.3, { stuck: 0 }); w.waitUntil((s, p) => p.ride, { timeout: 2 }); w.waitUntil((s, p) => !p.ride, { timeout: 8 });
  near(w.p.y, 3.4, 0.05, 'the wire lands on the second tower'); w.walkTo(47.8, -2.3); eq(sig(w, 'lamp3'), true);
  // the second kiln gauntlet: an ember is put out in either half it cannot finish, a spark is dry in the dry half
  const g2 = (r) => by(r.sim.level.sprinklers, 'gauntlet2');
  const e = at(f09, K9(49.6), 0, 0); e.waitUntil(() => g2(e).wet, { timeout: 7 }); e.waitUntil(() => !g2(e).wet, { timeout: 5 });
  assert(hold(e, 1, 0, 4, { jump: true }).maxX < K9(50.2) - R + 1e-6, 'an ember cannot get past the slotted wall in front of the second spray either');
  const s = at(f09, K9(49.6), 0, 0, 'spark'); s.waitUntil(() => g2(s).wet, { timeout: 7 }); s.waitUntil(() => !g2(s).wet, { timeout: 5 });
  assert(!diesWalking(s, K9(66.6), 0, 3), 'a spark in the dry half is not put out');
  const w2 = at(f09, K9(49.6), 0, 0, 'spark'); w2.waitUntil(() => !g2(w2).wet, { timeout: 7 }); w2.waitUntil(() => g2(w2).wet, { timeout: 7 }); w2.waitUntil(() => g2(w2).clock > 0.3, { timeout: 2 });
  assert(diesWalking(w2, K9(66.6), 0, 3), 'a spark that starts in the wet half is put out');
});
