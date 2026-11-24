// Fire's own pieces (src/sim/packs/fire.js and hazards.js): every one is driven by real inputs
// on a flat test level, positive and negative (the form that should do it does, the others do not).

import { test, assert, near, between, eq, throws } from './lib/harness.js';
import { Sim } from '../src/sim/sim.js';
import { frun, fmini, hold } from './lib/fire.js';
import { DT } from '../src/sim/constants.js';
import { FIRE } from '../src/sim/packs/fire.js';
import { DRIP_SPEED, DRIP_PERIOD, POOL_BOIL } from '../src/sim/packs/hazards.js';
import { HEAT_MAX } from '../src/sim/elements/fire.js';

const as = (form, pieces, extra) => { const r = frun(pieces, extra); if (form !== 'ember') r.form(form); return r; };
const L = (r) => r.sim.level;
const last = (r, type) => r.events.filter((e) => e.type === type).pop();
const bad = (pieces, pattern, extra) => throws(() => new Sim(fmini(pieces, extra)), pattern);

// ------------------------------------------------------------------ wood
test('wood: a blaze sets it alight by touch and is paid heat; an ember, smoke and a spark do nothing to it', () => {
  const wall = [{ type: 'wood', id: 'w', kind: 'plank', box: [3, 0, -4, 3.3, 9, 4], emit: 'gone' }];
  for (const f of ['ember', 'spark', 'smoke']) {
    const r = as(f, wall);
    hold(r, 1, 0, 2);
    eq(L(r).woods[0].state, 0, `${f} must not light wood`);
    assert(r.p.x < 3, `${f} got through the planks`);
  }
  const r = as('blaze', wall);
  r.waitUntil((s) => s.level.woods[0].state === 1, { mx: 1, timeout: 3, label: 'caught' });
  const t0 = r.t, g0 = r.p.gauge;
  assert(r.sfx().includes('wood_burn'));
  eq(last(r, 'fuel').amount, FIRE.FUEL.plank);
  assert(r.p.gauge > g0 - 0.02 && r.p.gauge <= HEAT_MAX, 'lighting wood returns heat');
  r.expectSignal('gone', false);
  assert(r.p.x < 3, 'still solid while it burns');
  r.waitUntil((s) => s.level.woods[0].state === 2, { timeout: 3, label: 'burnt away' });
  near(r.t - t0, FIRE.BURN.plank, 0.03, 'burn time of a plank');
  r.wait(0.05); r.expectSignal('gone', true);
  r.walkTo(5, 0);                                                 // and the way is open
});

test('wood: fuel is paid to the gauge (measured on a part-empty gauge), and burn time and fuel can be set', () => {
  const r = frun([{ type: 'wood', kind: 'block', box: [3, 0, -1, 4, 1, 1], burn: 0.5, fuel: 3 }], { startGauge: 4 });
  r.form('blaze');
  const g = () => r.p.gauge;
  r.waitUntil((s) => s.level.woods[0].state === 1, { mx: 1, timeout: 3 });
  assert(g() > 4 + 3 - 1.25 * r.t - 0.05 && g() > 5, `gauge after lighting: ${g()}`);
  const t0 = r.t;
  r.waitUntil((s) => s.level.woods[0].state === 2, { timeout: 3 });
  near(r.t - t0, 0.5, 0.03);
});

test('wood: fire spreads to wood that touches it, not across a gap, and not to wood marked spread:false', () => {
  const r = as('blaze', [
    { type: 'wood', id: 'a', box: [3, 0, -1, 4, 1, 1] }, { type: 'wood', id: 'b', box: [4, 0, -1, 5, 1, 1] },
    { type: 'wood', id: 'c', box: [5.2, 0, -1, 6.2, 1, 1] },                   // 0.2 m away: safe
    { type: 'wood', id: 'd', box: [3, 0, 1, 4, 1, 2], spread: false },         // touching, but will not catch
  ]);
  const st = (id) => L(r).woods.find((w) => w.id === id).state;
  r.waitUntil(() => st('a') === 1, { mx: 1, timeout: 3 });
  r.move(-1, 0, 0.4);                                                         // step away at once: only `a` was touched
  eq(st('b'), 0);
  r.waitUntil(() => st('b') === 1, { timeout: 2, label: 'b catches from a' });
  between(L(r).woods[0].t, FIRE.SPREAD_AT - 0.02, FIRE.SPREAD_AT + 0.05, 'spread at half burnt');
  r.wait(4);
  eq([st('a'), st('b'), st('c'), st('d')], [2, 2, 0, 0]);
  eq(r.events.filter((e) => e.type === 'fuel').length, 1, 'only the wood the hero lit pays fuel');
});

test('wood crate: weighs a plate, falls when its support burns, and releases the plate when it burns', () => {
  const r = as('blaze', [
    { type: 'plate', pos: [6, 0, 0], emit: 'p' },
    { type: 'wood', id: 'shelf', kind: 'plank', box: [5, 1.1, -1, 7, 1.3, 1], spread: false },
    { type: 'wood', id: 'box', kind: 'crate', pos: [6, 1.3, 0], size: 0.8, spread: false, emit: 'boxGone' },
  ]);
  const box = L(r).crates[0];
  r.wait(0.3);
  near(box.body.y, 1.3, 1e-6, 'crate rests on the shelf'); r.expectSignal('p', false);
  // burn the shelf from below: the crate drops onto the plate
  r.waitUntil((s) => s.level.woods[0].state === 1, { toward: [4.6, 0], timeout: 3, label: 'shelf alight' });
  r.walkTo(3.8, 0);
  r.waitUntil((s) => s.level.woods[0].state === 2, { timeout: 3 });
  r.waitUntil(() => box.grounded && box.body.y < 0.1, { timeout: 2, label: 'crate lands on the plate' });
  r.wait(0.1); r.expectSignal('p', true);
  eq(L(r).woods[1].state, 0, 'the crate itself has not caught');
  // now burn the crate: the plate is released
  r.waitUntil((s) => s.level.woods[1].state === 1, { toward: [6, 0], timeout: 3, label: 'crate alight' });
  r.waitUntil((s) => s.level.woods[1].state === 2, { timeout: 3 });
  r.walkTo(3.5, 0); r.wait(0.2);
  r.expectSignal('p', false); r.expectSignal('boxGone', true);
  assert(box.gone && !box.solid.active);
  r.walkTo(6, 0, { timeout: 3 }); r.wait(0.1);                                // nothing left in the way
  r.restart(); assert(box.gone, 'a burnt crate does not come back on restart');
});

test('wood rope: not solid, burnt through by a blaze near it, and it emits once it parts', () => {
  const rope = [{ type: 'wood', kind: 'rope', from: [4, 0.1, 1], to: [4, 3, 1], emit: 'cut' }];
  const e = frun(rope);
  e.walkTo(4, 1); e.wait(0.5); eq(L(e).woods[0].state, 0, 'an ember passes through a rope without lighting it');
  const r = as('blaze', rope);
  r.waitUntil((s) => s.level.woods[0].state === 1, { toward: [4, 0.6], timeout: 3 });
  r.expectSignal('cut', false);
  r.waitUntil((s) => s.signals.get('cut'), { timeout: 2 });
  eq(last(r, 'fuel').amount, FIRE.FUEL.rope);
});

test('wood: can be lit by a signal (a fuse, say) without anyone near', () => {
  const r = frun([{ type: 'plate', pos: [2, 0, 0], emit: 'p' }, { type: 'wood', box: [8, 0, -1, 9, 1, 1], on: 'p', emit: 'gone' }]);
  r.walkTo(2, 0);
  r.waitUntil((s) => s.signals.get('gone'), { timeout: 4 });
  eq(r.events.filter((e) => e.type === 'fuel').length, 0, 'no fuel for wood the hero did not light');
});

// ------------------------------------------------------------------ fuse
test('fuse: lit by touch at its first point only, burns along at its rate, emits at the end and stays spent', () => {
  const fuse = [{ type: 'fuse', path: [[3, 0.05, 0], [6, 0.05, 0], [6, 0.05, 3]], rate: 2, emit: 'f' }];
  const s = as('smoke', [{ type: 'fuse', path: [[3, 0.6, 0], [6, 0.6, 0]], emit: 'f' }, { type: 'block', box: [-2, 0.9, -2, 8, 1.2, 2] }]);
  s.move(1, 0, 1.2); near(s.p.x, 3, 0.8, 'smoke drifts right over the fuse end');
  eq(L(s).fuses[0].state, 0, 'smoke cannot light a fuse');
  const mid = frun(fuse);
  mid.walkTo(3, 2.5).walkTo(6, 1.5, { stuck: 0, timeout: 3 }).walkTo(6, 3, { stuck: 0, timeout: 3 }); mid.wait(0.3);
  eq(L(mid).fuses[0].state, 0, 'touching the middle or the far end does not light it');
  const r = frun(fuse);
  r.walkTo(2.4, 0);
  const f = L(r).fuses[0];
  eq(f.state, 1); const t0 = r.t;
  assert(r.sfx().includes('ignite') && r.sfx().includes('fuse_burn'));
  near(f.len, 6, 1e-9);
  r.wait(1); near(f.d, 2 * (r.t - t0), 0.02, 'burns at 2 m/s');
  r.expectSignal('f', false);
  r.waitUntil((q) => q.signals.get('f'), { timeout: 4 });
  near(r.t - t0, 6 / 2, 0.03, 'length / rate');
  r.wait(5); r.expectSignal('f', true); eq(f.state, 2, 'spent for good without regrow');
});

test('fuse: with regrow it emits for that long, then is ready to light again; default rate', () => {
  const r = frun([{ type: 'fuse', path: [[1, 0.05, 0], [1 + FIRE.FUSE_RATE, 0.05, 0]], regrow: 1.5, emit: 'f' }]);
  r.walkTo(0.4, 0);
  const f = L(r).fuses[0];
  r.walkTo(-1.5, 0);
  r.waitUntil((q) => q.signals.get('f'), { timeout: 3 });
  const t0 = r.t;
  near(t0, 1 + 0.1 + 0.0, 0.25, 'one second at the default rate');
  r.waitUntil((q) => !q.signals.get('f'), { timeout: 3 });
  near(r.t - t0, 1.5, 0.03, 'emits for the regrow time');
  eq(f.state, 0);
  r.walkTo(0.4, 0); eq(f.state, 1, 'and can be lit again');
});

// ------------------------------------------------------------------ lantern & brazier
test('lantern: lit by an ember brushing it, stays lit, emits; smoke cannot light it', () => {
  const lamp = [{ type: 'lantern', pos: [3, 0.95, 0], emit: 'lamp' }];
  // smoke held down by a low ceiling drifts right through the lantern and still does not light it
  const s = as('smoke', [...lamp, { type: 'block', box: [-2, 1.35, -2, 8, 1.7, 2] }]);
  let nearest = 9;
  for (let i = 0; i < 240; i++) { s.tick(1, 0); nearest = Math.min(nearest, Math.hypot(s.p.x - 3, s.p.y + s.p.h / 2 - 0.95, s.p.z)); }
  assert(nearest < 0.3, `the smoke should pass through the lantern (came within ${nearest.toFixed(2)} m)`);
  eq(L(s).lanterns[0].lit, false, 'smoke cannot light a lantern');
  const r = frun(lamp);
  r.walkTo(1.8, 0); eq(L(r).lanterns[0].lit, false, 'not from 1.2 m away');
  r.walkTo(2.6, 0); eq(L(r).lanterns[0].lit, true);
  eq(r.sfx().filter((n) => n === 'ignite').length, 1);
  r.walkTo(-3, 0); r.wait(1); r.expectSignal('lamp', true);
  const pre = frun([{ type: 'lantern', pos: [9, 1, 0], lit: true, emit: 'lamp' }]);
  pre.wait(0.1); pre.expectSignal('lamp', true);
});

test('brazier: an ember lights it; it becomes the checkpoint, refuels, and a respawn there has a full gauge', () => {
  const r = frun([{ type: 'brazier', id: 'b', pos: [4, 0, 0], emit: 'b' }, { type: 'pool', box: [8, -0.2, -3, 10, 0.4, 3] }], { startGauge: 2 });
  const b = L(r).braziers[0];
  eq(r.sim.checkpoint, null);
  r.walkTo(4, 0);
  assert(b.lit && r.sim.checkpoint === b && b.current);
  assert(r.sfx().includes('ignite') && r.sfx().includes('checkpoint'));
  eq(last(r, 'checkpoint').index, b.index);
  r.wait(0.5); eq(r.p.gauge, HEAT_MAX, 'refuelled'); r.expectSignal('b', true);
  r.form('blaze'); r.walkTo(6.5, 0); r.wait(1);
  assert(r.p.gauge < HEAT_MAX - 1);
  r.form('ember');
  r.dying((q) => q.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3, label: 'into the pool' }));
  near(r.p.x, 4, 1e-9, 'respawned at the brazier'); eq(r.p.gauge, HEAT_MAX, 'with a full gauge');
});

test('brazier: smoke cannot light one, but a lit one refuels any form', () => {
  const s = as('smoke', [{ type: 'brazier', pos: [3, 0, 0] }, { type: 'block', box: [-2, 0.9, -2, 8, 1.2, 2] }]);
  s.move(1, 0, 1.1); near(s.p.x, 3, 0.8, 'smoke hangs over the brazier');
  eq(L(s).braziers[0].lit, false); eq(s.sim.checkpoint, null);
  const r = as('blaze', [{ type: 'brazier', pos: [3, 0, 0], lit: true }], { startGauge: 5 });
  r.walkTo(3, 0); r.wait(0.5);
  eq(r.p.gauge, HEAT_MAX); eq(r.p.form, 'blaze');
});

// ------------------------------------------------------------------ ice & wax
test('iceblock: a blaze melts it in its melt time of touch (progress keeps when it steps away); an ember cannot', () => {
  const ice = [{ type: 'iceblock', box: [3, 0, -4, 4, 2, 4], emit: 'melted' }];
  const e = frun(ice);
  hold(e, 1, 0, 3); eq(L(e).iceblocks[0].t, 0); assert(e.p.x < 3);
  const r = as('blaze', ice);
  const q = L(r).iceblocks[0];
  r.waitUntil(() => q.t > 0, { mx: 1, timeout: 3 });
  assert(r.sfx().includes('ice_melt'));
  r.move(1, 0, 0.5);
  between(q.t, 0.3, 0.4, 'a third melted after half a second');
  r.walkTo(1, 0);
  const half = q.t;
  r.wait(0.5); eq(q.t, half, 'no touch, no melting, no refreezing');
  r.waitUntil(() => q.t > half, { mx: 1, timeout: 4, label: 'touching again' });
  const t0 = r.t;
  r.waitUntil(() => q.gone, { mx: 1, timeout: 4 });
  near((r.t - t0) + half * FIRE.ICE_MELT, FIRE.ICE_MELT, 0.03, 'total touch time = melt time');
  r.wait(0.05); r.expectSignal('melted', true);
  r.walkTo(6, 0);
});

test('wax: sags under a blaze to a low stub, carrying down what stands on it', () => {
  const r = as('blaze', [
    { type: 'wax', id: 'wx', box: [3, 0, -1, 5, 1.5, 1], melt: 2, emit: 'soft' },
    { type: 'wood', kind: 'crate', pos: [4, 1.5, 0], size: 0.8, spread: false },
  ]);
  const w = L(r).waxes[0], c = L(r).crates[0];
  r.wait(0.3); near(c.body.y, 1.5, 1e-6);
  r.waitUntil(() => w.t > 0, { toward: [2.5, 0], timeout: 3 });
  assert(r.sfx().includes('wax_melt'));
  r.waitUntil(() => w.t >= 1, { toward: [2.6, 0], timeout: 4, label: 'fully sagged' });
  near(w.solid.y1, FIRE.WAX_MIN, 1e-9, 'down to the stub');
  r.wait(0.3);
  near(c.body.y, FIRE.WAX_MIN, 0.02, 'the crate came down with it');
  r.expectSignal('soft', true);
  eq(L(r).woods[0].state, 0);
  // an ember never softens it
  const e = frun([{ type: 'wax', box: [3, 0, -4, 5, 1.5, 4] }]);
  hold(e, 1, 0, 2); eq(L(e).waxes[0].t, 0);
});

test('wax: a blaze standing on it rides it down', () => {
  const r = frun([{ type: 'wax', box: [-1, 0, -1, 1, 1.2, 1], melt: 1.5 }], { spawn: [0, 1.2, 0] });
  near(r.p.y, 1.2, 1e-6);
  r.form('blaze');
  r.waitUntil((s) => s.level.waxes[0].t >= 1, { timeout: 3 });
  r.wait(0.1);
  near(r.p.y, FIRE.WAX_MIN, 1e-6); assert(r.p.grounded); eq(r.sim.deaths, 0);
});

// ------------------------------------------------------------------ water hazards
test('pool: puts out an ember, a spark and smoke that touch it', () => {
  const pool = [{ type: 'block', box: [3, -1, -4, 6, -0.6, 4] }, { type: 'pool', box: [3, -0.6, -4, 6, 0.3, 4] }];
  for (const f of ['ember', 'spark']) {
    const r = as(f, pool); r.allowDeath = true;
    r.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3, label: `${f} put out` });
    eq(last(r, 'respawn').cause, 'water'); assert(r.sfx().includes('extinguish'));
    eq(r.p.form, 'ember');
  }
});

test('pool: a blaze boils it for 2 heat; it is passable for its boil time, then the water is back', () => {
  const r = as('blaze', [{ type: 'pool', id: 'p', box: [3, 0, -4, 6, 0.5, 4], boil: 2 }]);
  const q = L(r).pools[0];
  const g0 = r.p.gauge;
  r.waitUntil(() => !q.wet, { mx: 1, timeout: 3, label: 'boiled' });
  const t0 = r.t;
  between(g0 - r.p.gauge, 2.6, 3.0, 'two heat for the boil, plus 0.7 s of being a blaze on the way');
  assert(r.p.x < 3 - 0.34 + 0.01, 'boiled from the rim, before touching the water');
  r.walkTo(7.5, 0, { slow: false });
  eq(r.sim.deaths, 0);
  r.waitUntil(() => q.wet, { timeout: 3 });
  near(r.t - t0, 2, 0.03, 'boil time');
  // an ember that follows a moment too late is put out
  const e = as('blaze', [{ type: 'pool', box: [3, 0, -4, 6, 0.5, 4], boil: 1 }]); e.allowDeath = true;
  e.waitUntil((s) => !s.level.pools[0].wet, { mx: 1, timeout: 3 });
  e.form('ember'); e.walkTo(4.5, 0, { slow: false }); e.wait(1.2);
  eq(e.sim.deaths, 1, 'the water came back on the ember');
  eq(POOL_BOIL, 3);
});

test('pool: a blaze without the heat to boil it is put out like anything else', () => {
  const r = as('blaze', [{ type: 'pool', box: [3, 0, -4, 6, 0.5, 4] }], { startGauge: 2.3 }); r.allowDeath = true;
  r.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3 });
  eq(L(r).pools[0].steamT, 0, 'never boiled');
});

test('drip: drops fall on a fixed rhythm (deterministic), land, and only matter while falling', () => {
  const r = frun([{ type: 'drip', id: 'd', pos: [5, 3, 0] }]);
  const d = L(r).drips[0];
  near(d.drop, 3, 1e-9, 'falls to the floor below'); eq(d.period, DRIP_PERIOD); eq(d.speed, DRIP_SPEED);
  const starts = [];
  let was = d.live;                                              // the first drop left at t = 0
  for (let i = 0; i < 120 * 5; i++) { r.tick(); if (d.live && !was) starts.push(r.sim.tick); was = d.live; }
  eq(starts.length, 3);
  eq(starts[1] - starts[0], Math.round(DRIP_PERIOD * 120)); eq(starts[2] - starts[1], Math.round(DRIP_PERIOD * 120));
  // fall time = drop / speed
  r.waitUntil(() => !d.live, { timeout: 3 }).waitUntil(() => d.live, { timeout: 3 }); const t0 = r.t;
  r.waitUntil(() => !d.live, { timeout: 3 });
  near(r.t - t0, 3 / DRIP_SPEED, 0.02);
  assert(r.events.some((e) => e.type === 'burst' && e.kind === 'drip'));
  eq(r.sim.deaths, 0);
});

test('drip: a drop puts out an ember under it; standing clear, or walking through between drops, is safe', () => {
  const drip = [{ type: 'drip', id: 'd', pos: [5, 3, 0], period: 1.6 }];
  const r = frun(drip); r.allowDeath = true;
  r.walkTo(5, 0);
  r.waitUntil((s) => s.deaths === 1, { timeout: 3, label: 'hit by the next drop' });
  eq(last(r, 'respawn').cause, 'water');
  const side = frun(drip); side.walkTo(5, 0.8); side.wait(4); eq(side.sim.deaths, 0, '0.8 m to the side is clear');
  const q = frun(drip);
  q.walkTo(3.5, 0);
  q.waitUntil((s) => s.level.drips[0].live, { timeout: 3 }).waitUntil((s) => !s.level.drips[0].live, { timeout: 3 });
  q.walkTo(6.5, 0); eq(q.sim.deaths, 0);
});

test('drip: a blaze turns the drop to steam for 1 heat; smoke is knocked down to an ember; a spark is put out', () => {
  const drip = [{ type: 'drip', pos: [0, 3, 0], period: 1.2 }];
  const b = as('blaze', drip);
  const g0 = b.p.gauge;
  b.wait(1.19);
  eq(b.sim.deaths, 0); eq(b.p.form, 'blaze');
  near(g0 - b.p.gauge, 1 + 1.25 * 1.19, 0.05, 'one heat for the drop');
  const s = as('smoke', [{ type: 'drip', pos: [0, 6, 0], period: 2 }, { type: 'block', box: [-2, 2, -2, -0.6, 2.4, 2] }]);
  s.waitUntil((q, p) => p.form === 'ember', { timeout: 4, label: 'knocked down' });
  eq(s.sim.deaths, 0); eq(last(s, 'form').cause, 'water');
  const k = as('spark', drip); k.allowDeath = true;
  k.waitUntil((q) => q.deaths === 1, { timeout: 3 });
});

test('sprinkler: puts out an ember; a blaze pushes through at a heavy cost; smoke is turned back as an ember, alive', () => {
  const spray = [{ type: 'sprinkler', id: 's', box: [3, 0, -4, 5, 4, 4] }];
  const e = frun(spray); e.allowDeath = true;
  e.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 3 });
  assert(e.sfx().includes('extinguish'));
  const b = as('blaze', spray);
  const g0 = b.p.gauge;
  b.walkTo(6.5, 0, { slow: false });
  eq(b.sim.deaths, 0); eq(b.p.form, 'blaze');
  between(g0 - b.p.gauge, 3.5, 6.5, 'a 2 m curtain costs about 5 heat');
  const s = as('smoke', spray);
  s.waitUntil((q, p) => p.form === 'ember', { mx: 1, timeout: 4 });
  eq(s.sim.deaths, 0);
  assert(s.p.x < 3 - 0.3, `dropped outside the spray: x=${s.p.x}`);
  s.wait(1); eq(s.sim.deaths, 0, 'and it lands dry');
});

test('sprinkler: a long spray drains a blaze dry and then puts it out', () => {
  const r = as('blaze', [{ type: 'sprinkler', box: [3, 0, -4, 20, 4, 4] }]); r.allowDeath = true;
  r.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 6 });
  assert(r.events.some((e) => e.type === 'form' && e.cause === 'gauge'), 'it guttered to an ember first');
});

test('sprinkler: follows its signal, and can pulse (period and duty)', () => {
  const r = frun([{ type: 'plate', pos: [1.5, 0, 0], emit: 'p' }, { type: 'sprinkler', box: [4, 0, -4, 6, 4, 4], on: '!p' },
    { type: 'sprinkler', id: 'pulse', box: [20, 0, -4, 22, 4, 4], period: 2, duty: 0.25 }]);
  const [a, b] = L(r).sprinklers;
  assert(a.wet);
  r.walkTo(1.5, 0); r.wait(0.1); assert(!a.wet, 'shut off by the plate');
  let wet = 0;
  for (let i = 0; i < 480; i++) { r.tick(); if (b.wet) wet++; }
  near(wet / 480, 0.25, 0.01, 'wet a quarter of the time');
});

// ------------------------------------------------------------------ wires
test('wire: a spark touching a terminal rides to the other end at wire speed, over water, spending no heat', () => {
  const pieces = [
    { type: 'terminal', id: 'a', pos: [3, 0, 0] }, { type: 'terminal', id: 'b', pos: [17, 0, 0], emit: 'b' },
    { type: 'wire', from: 'a', to: 'b', via: [[3, 3, 0], [17, 3, 0]] },
    { type: 'pool', box: [6, 0, -4, 14, 4, 4] }, { type: 'sprinkler', box: [14.2, 0, -4, 15, 5, 4] },
  ];
  for (const f of ['ember', 'blaze']) { const q = as(f, pieces); q.walkTo(3, 0, { stuck: 0, timeout: 2, tol: 0.5 }); q.wait(0.3); eq(q.p.ride, null, `${f} does not ride`); }
  const r = as('spark', pieces);
  r.waitUntil((s, p) => p.ride, { mx: 1, timeout: 2, label: 'on the wire' });
  assert(r.sfx().includes('wire_ride'));
  const t0 = r.t, g0 = r.p.gauge, w = L(r).wires[0];
  near(w.len, 2.7 + 14 + 2.7, 1e-9);
  let top = 0;
  r.waitUntil((s, p) => { top = Math.max(top, p.y); return !p.ride; }, { mx: -1, jump: true, timeout: 4, label: 'arrives (input is ignored on the wire)' });
  near(r.t - t0, w.len / FIRE.WIRE_SPEED, 0.03, 'length / speed');
  assert(top > 2.5, 'it went up and over');
  eq(r.sim.deaths, 0); eq(r.p.gauge, g0, 'no heat spent on the wire');
  near(r.p.x, 17, 1e-9); near(r.p.z, 0, 1e-9);
  // sitting on the far terminal powers it, and there is no return trip until it steps off
  r.wait(0.3); eq(r.p.ride, null); assert(r.p.grounded); r.expectSignal('b', true);
  r.walkTo(19, 0); r.wait(0.1); r.expectSignal('b', false);
  r.waitUntil((s, p) => p.ride, { toward: [17, 0], timeout: 2, label: 'rides back' });
  r.waitUntil((s, p) => !p.ride, { timeout: 4 });
  near(r.p.x, 3, 1e-9);
});

test('terminal: a spark lights a post from 0.6 m off its body (0.74 m from its centre), not from 1.1 m', () => {
  eq(FIRE.TERMINAL_R, 0.6, 'the post reach');
  for (const [dx, want] of [[0.7, true], [1.1, false]]) {
    const r = as('spark', [{ type: 'terminal', id: 's', pos: [4, 0, 0], emit: 's' }], { startGauge: 10 });
    r.walkTo(4 - dx, 0, { tol: 0.05, stuck: 0, timeout: 3 }); r.wait(0.2);
    eq(r.sim.signals.get('s') === true, want, `a spark standing ${dx} m from the post`);
  }
  // an ember never powers a post, whatever the reach
  const e = frun([{ type: 'terminal', id: 's', pos: [4, 0, 0], emit: 's' }]);
  e.walkTo(4, 0); e.wait(0.2); eq(e.sim.signals.get('s') === true, false, 'an ember on a post');
});

test('wire: a dead wire carries nothing until its signal is on; a lone terminal is a socket only a spark powers', () => {
  const r = as('spark', [
    { type: 'plate', pos: [-3, 0, 0], emit: 'p' },
    { type: 'terminal', id: 'a', pos: [3, 0, 0], emit: 'a' }, { type: 'terminal', id: 'b', pos: [9, 0, 0] }, { type: 'wire', from: 'a', to: 'b', on: { latch: 'p' } },
    { type: 'terminal', id: 'solo', pos: [0, 0, 3], emit: 'solo' },
  ], { startGauge: 10 });
  r.walkTo(3, 0); r.wait(0.2);
  eq(r.p.ride, null); r.expectSignal('a', true);
  r.walkTo(0, 3); r.wait(0.1); r.expectSignal('solo', true); r.expectSignal('a', false);
  assert(r.sfx().includes('spark'));
  const e = frun([{ type: 'terminal', id: 'solo', pos: [2, 0, 0], emit: 'solo' }]);
  e.walkTo(2, 0); e.wait(0.2); e.expectSignal('solo', false);
});

// ------------------------------------------------------------------ gas
test('gas: only a spark sets it off; the blast throws it, breaks weak walls and panes in reach, and the pocket refills', () => {
  const pieces = [
    { type: 'gas', id: 'g', box: [3, 0, -1, 5, 1.5, 1], refill: 2 },
    { type: 'weakwall', id: 'near', box: [6, 0, -3, 6.4, 3, 3], emit: 'open' },
    { type: 'weakwall', id: 'far', box: [9, 0, -3, 9.4, 3, 3] },
    { type: 'pane', box: [1.2, 0, -3, 1.4, 3, -1.5] },
  ];
  for (const f of ['ember', 'blaze', 'smoke']) { const q = as(f, pieces); hold(q, 1, 0, 1.2); assert(L(q).gases[0].full, `${f} must not set off gas`); }
  const r = as('spark', pieces);
  const g = L(r).gases[0];
  r.waitUntil(() => !g.full, { mx: 1, timeout: 2, label: 'bang' });
  assert(r.sfx().includes('gas_blast'));
  const t0 = r.t;
  assert(L(r).weakwalls[0].broken && !L(r).weakwalls[0].solid.active, 'the near weak wall is gone');
  assert(!L(r).weakwalls[1].broken, 'the far one is out of reach');
  assert(L(r).panes[0].broken, 'glass in reach shatters too');
  near(r.p.vy, FIRE.GAS_LAUNCH[1] * 1.25, 0.5, 'a spark is thrown hardest');
  let top = 0;
  r.waitUntil((s, p) => { top = Math.max(top, p.y); return p.grounded; }, { timeout: 4 });
  between(top, 4.2, 6.2, 'launch height of a spark');
  r.wait(0.05); r.expectSignal('open', true);
  r.waitUntil(() => g.full, { timeout: 3 });
  near(r.t - t0, 2, 0.4, 'refilled');
});

test('gas: a signal (a fuse) sets it off and launches whoever stands in it along its launch vector, scaled per form', () => {
  const mk = (form) => {
    const r = as(form, [{ type: 'plate', pos: [-4, 0, 0], emit: 'p' }, { type: 'gas', box: [-1, 0, -1, 1, 1.5, 1], on: { delay: 'q', for: 0.2 }, launch: [6, 11, 0] },
      { type: 'sensor', box: [-1, 0, -1, 1, 2, 1], emit: 'q', visible: false }]);
    let top = 0;
    r.waitUntil((s) => !s.level.gases[0].full, { timeout: 2 });
    r.waitUntil((s, p) => { top = Math.max(top, p.y); return p.grounded || p.form === 'ember' && p.y < 0.01; }, { timeout: 8 });
    return { top, x: r.p.x, r };
  };
  const e = mk('ember'), b = mk('blaze'), k = mk('spark');
  between(e.top, 2.0, 2.5, 'ember: 11 m/s up'); between(e.x, 4.2, 5.0, 'ember: thrown forward at 6 m/s for its 0.77 s in the air');
  assert(k.top > e.top + 0.8, 'a spark flies higher');
  assert(b.x > e.x, 'a blaze is thrown less hard but floats further');
  eq(e.r.sim.deaths + b.r.sim.deaths + k.r.sim.deaths, 0);
});

test('gas: pockets in reach of a blast go off in a chain; refill 0 means once only', () => {
  const r = as('spark', [{ type: 'gas', box: [3, 0, -1, 4, 1, 1], refill: 0 }, { type: 'gas', box: [5, 0, -1, 6, 1, 1] }, { type: 'gas', box: [12, 0, -1, 13, 1, 1] }]);
  r.waitUntil((s) => !s.level.gases[0].full, { mx: 1, timeout: 2 });
  r.wait(0.3);
  eq(L(r).gases.map((g) => g.full), [false, false, true]);
  eq(r.sfx().filter((n) => n === 'gas_blast').length, 2);
  r.wait(8); eq(L(r).gases[0].full, false, 'refill 0 never comes back'); eq(L(r).gases[1].full, true);
});

// ------------------------------------------------------------------ heat sensor & coal
test('heat sensor: only a blaze (or burning wood beside it) trips it', () => {
  const hs = [{ type: 'heatsensor', box: [3, 0, -1, 5, 2, 1], emit: 'hot' }];
  for (const f of ['ember', 'spark']) { const q = as(f, hs); q.walkTo(4, 0); q.wait(0.1); q.expectSignal('hot', false); }
  const r = as('blaze', hs);
  r.walkTo(4, 0); r.wait(0.1); r.expectSignal('hot', true);
  r.walkTo(8, 0); r.wait(0.1); r.expectSignal('hot', false);
  const w = as('blaze', [{ type: 'heatsensor', box: [10, 0, -1, 12, 2, 1], emit: 'hot' }, { type: 'wood', box: [8, 0, -1, 10, 1, 1], burn: 3 }]);
  w.waitUntil((s) => s.level.woods[0].state === 1, { mx: 1, timeout: 4 });
  w.walkTo(4, 0); w.expectSignal('hot', true);
  w.wait(3.2); w.expectSignal('hot', false);
});

test('coal: adds heat (capped), is left alone when the gauge is full, and comes back after a respawn', () => {
  const r = frun([{ type: 'coal', pos: [3, 0.5, 0] }, { type: 'coal', pos: [6, 0.5, 0], heat: 20 }], { startGauge: 3 });
  r.walkTo(3, 0);
  near(r.p.gauge, 3 + FIRE.COAL_HEAT, 1e-9); assert(L(r).coals[0].taken && r.sfx().includes('coal'));
  r.walkTo(6, 0); eq(r.p.gauge, HEAT_MAX);
  r.restart(); r.wait(0.6);
  eq(L(r).coals.map((c) => c.taken), [false, false], 'coal is back'); eq(r.p.gauge, 3);
  const full = frun([{ type: 'coal', pos: [3, 0.5, 0] }]);
  full.walkTo(3, 0); eq(L(full).coals[0].taken, false, 'not wasted on a full gauge');
});

// ------------------------------------------------------------------ loader
test('loader: fire pieces are validated with the piece index, like the shared ones', () => {
  bad([{ type: 'wood', kind: 'log', box: [0, 0, 0, 1, 1, 1] }], /wood kind must be/);
  bad([{ type: 'wood', box: [0, 0, 0, 1, 0.05, 1] }], /thinner than 0.1/);
  bad([{ type: 'wood', kind: 'rope', from: [0, 0, 0], to: [0, 0.1, 0] }], /at least 0.2 m apart/);
  bad([{ type: 'wood', kind: 'crate', pos: [0, 0, 0], size: 0.2 }], /at least 0.4/);
  bad([{ type: 'wood', box: [0, 0, 0, 1, 1, 1], burn: 0 }], /burn must be > 0/);
  bad([{ type: 'fuse', path: [[0, 0, 0]], emit: 'f' }], /at least 2 points/);
  bad([{ type: 'fuse', path: [[0, 0, 0], [1, 0, 0]] }], /needs "emit"/);
  bad([{ type: 'fuse', path: [[0, 0, 0], [1, 0, 0]], emit: 'f', rate: 0 }], /rate must be > 0/);
  bad([{ type: 'lantern', pos: [0, 1], emit: 'l' }], /"pos" must be/);
  bad([{ type: 'lantern', pos: [0, 1, 0], mount: 'floor' }], /mount must be/);
  bad([{ type: 'wax', box: [0, 0, 0, 1, 1, 1], min: 1.5 }], /min must be/);
  bad([{ type: 'iceblock', box: [0, 0, 0, 1, 1, 1], melt: -1 }], /melt must be > 0/);
  bad([{ type: 'terminal', pos: [0, 0, 0] }], /needs an "id"/);
  bad([{ type: 'terminal', id: 'a', pos: [0, 0, 0] }, { type: 'terminal', id: 'a', pos: [1, 0, 0] }], /used twice/);
  bad([{ type: 'terminal', id: 'a', pos: [0, 0, 0] }, { type: 'wire', from: 'a', to: 'zz' }], /no terminal with id "zz"/);
  bad([{ type: 'terminal', id: 'a', pos: [0, 0, 0] }, { type: 'terminal', id: 'b', pos: [1, 0, 0] }, { type: 'terminal', id: 'c', pos: [2, 0, 0] },
    { type: 'wire', from: 'a', to: 'b' }, { type: 'wire', from: 'b', to: 'c' }], /already has a wire/);
  bad([{ type: 'gas', box: [0, 0, 0, 1, 1, 1], launch: [0, 1] }], /"launch" must be/);
  bad([{ type: 'heatsensor', box: [0, 0, 0, 1, 1, 1] }], /needs "emit"/);
  bad([{ type: 'coal', pos: [0, 0, 0], heat: 0 }], /heat must be > 0/);
  bad([{ type: 'pool', box: [0, 0, 0, 1, 1, 1], boil: 0 }], /boil must be > 0/);
  bad([{ type: 'drip', pos: [0, 3, 0], period: 0.2 }], /one drop at a time/);
  bad([{ type: 'drip', pos: [80, 3, 0] }], /nothing below the nozzle/);
  bad([{ type: 'sprinkler', box: [0, 0, 0, 1, 1, 1], period: 2, duty: 0 }], /duty must be/);
  const e = bad([{ type: 'gas', id: 'pocket', box: [0, 0, 0, 1, 1] }], /"box" must be/);
  assert(/piece #2 "pocket" \(gas\)/.test(e.message), e.message);
});

test('loader: one of every fire piece loads, runs and stays finite', () => {
  const sim = new Sim(fmini([
    { type: 'wood', box: [2, 0, 4, 3, 1, 5] }, { type: 'wood', kind: 'plank', box: [4, 0, 4, 4.2, 2, 6] }, { type: 'wood', kind: 'crate', pos: [6, 0, 5] },
    { type: 'wood', kind: 'rope', from: [8, 0, 5], to: [8, 3, 5] }, { type: 'fuse', path: [[10, 0, 5], [12, 0, 5]], emit: 'f' },
    { type: 'lantern', pos: [14, 1, 5], emit: 'l' }, { type: 'brazier', pos: [16, 0, 5] }, { type: 'iceblock', box: [18, 0, 4, 19, 1, 5] },
    { type: 'wax', box: [20, 0, 4, 21, 1, 5] }, { type: 'terminal', id: 'a', pos: [22, 0, 5] }, { type: 'terminal', id: 'b', pos: [24, 0, 5] },
    { type: 'wire', from: 'a', to: 'b' }, { type: 'gas', box: [26, 0, 4, 27, 1, 5] }, { type: 'weakwall', box: [28, 0, 4, 28.4, 2, 6] },
    { type: 'heatsensor', box: [30, 0, 4, 31, 1, 5], emit: 'h' }, { type: 'coal', pos: [32, 0.5, 5] },
    { type: 'pool', box: [2, -0.5, -8, 6, 0.2, -5] }, { type: 'drip', pos: [10, 3, -6] }, { type: 'sprinkler', box: [14, 0, -8, 16, 3, -6] },
  ]));
  const types = new Set(sim.level.pieces.map((p) => p.type));
  for (const t of ['wood', 'fuse', 'lantern', 'brazier', 'iceblock', 'wax', 'terminal', 'wire', 'gas', 'weakwall', 'heatsensor', 'coal', 'pool', 'drip', 'sprinkler']) assert(types.has(t), t);
  eq(sim.level.warnings, []);
  for (let i = 0; i < 900; i++) sim.step({ mx: 1, mz: 0.3 * Math.sin(i * 0.01), jump: i % 60 < 20, form: i % 150 === 0 ? ['blaze', 'spark', 'smoke', 'ember'][(i / 150) % 4] : null });
  assert(Number.isFinite(sim.player.x + sim.player.y + sim.player.z + sim.player.gauge), 'state stays finite');
  assert(DT > 0);
});
