// Cinder's four forms (src/sim/elements/fire.js): how each moves, what each spends, and how each
// meets the shared pieces (plates, fans, grates, slots, zones, kiln fire, running water).
// The numbers asserted here are the ones LEVELS.md section 10 gives level designers.

import { test, assert, near, between, eq } from './lib/harness.js';
import { frun, hold } from './lib/fire.js';
import { DT } from '../src/sim/constants.js';
import fire, { HEAT_MAX, FLARE_COST, FLARE_UP } from '../src/sim/elements/fire.js';

const F = fire.formDefs;

function jumpApex(r, holdTicks = 9999) {
  r.tick(0, 0, false);
  const y0 = r.p.y;
  let maxY = y0;
  for (let i = 0; i < 600; i++) { r.tick(0, 0, i < holdTicks); maxY = Math.max(maxY, r.p.y); if (i > 5 && r.p.grounded) break; }
  return maxY - y0;
}
function jumpLength(r) {
  r.move(1, 0, 0.8);
  const x0 = r.p.x;
  r.tick(1, 0, false); r.tick(1, 0, true);
  let n = 0;
  while (!r.p.grounded && n++ < 900) r.tick(1, 0, true);
  return { dist: r.p.x - x0, time: n * DT };
}
const as = (form, pieces, extra) => { const r = frun(pieces, extra); if (form !== 'ember') r.form(form); return r; };

// ------------------------------------------------------------------ ember
test('ember: quicker than a drop, stops at once, and spends no heat', () => {
  const r = frun();
  r.move(1, 0, 0.15);
  near(r.speed, 6.2, 1e-6, 'top speed within 0.15 s');
  r.move(0, 0, 0.15);
  near(r.speed, 0, 1e-9, 'stopped within 0.15 s');
  r.move(1, 0, 5);
  eq(r.p.gauge, HEAT_MAX, 'an ember never spends heat');
});

test('ember: the best jumper - 1.7 m up, 4.2 m along, variable height', () => {
  between(jumpApex(frun()), 1.68, 1.78, 'full jump apex');
  const j = jumpLength(frun());
  between(j.dist, 4.0, 4.3, 'running jump on the flat');
  const tap = jumpApex(frun(), 4);
  assert(tap < 0.9 && tap > 0.3, `a tap is a hop: ${tap}`);
});

// ------------------------------------------------------------------ blaze
test('blaze: slower and taller, and it drains heat at 1.25 a second until it falls back to an ember', () => {
  const r = as('blaze');
  eq(r.sfx().includes('flare'), true, 'entering blaze plays "flare"');
  near(r.p.h, 1.05, 1e-12); near(r.p.r, 0.34, 1e-12);
  r.move(1, 0, 0.4);
  near(r.speed, 4.2, 1e-6, 'top speed');
  const g0 = r.p.gauge, t0 = r.t;
  r.wait(2);
  near(g0 - r.p.gauge, 1.25 * 2, 0.02, 'drain per second');
  r.waitUntil((s, p) => p.form !== 'blaze', { timeout: 10 });
  eq(r.p.form, 'ember'); eq(r.p.gauge, 0);
  near(r.t - t0 + (HEAT_MAX - g0) / 1.25, HEAT_MAX / 1.25, 0.05, 'a full gauge is 8 s of blaze');
  eq(r.events.filter((e) => e.type === 'form').pop().cause, 'gauge');
  r.form('blaze', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'gauge', 'no heat, no blaze');
  eq(r.sfx().includes('smoke_puff'), true, 'guttering out plays "smoke_puff"');
});

test('blaze: a long gentle jump on its own updraft - lower than an ember but further, and a slow fall', () => {
  const apex = jumpApex(as('blaze'));
  between(apex, 1.44, 1.54, 'blaze apex');
  assert(apex < jumpApex(frun()) - 0.15, 'lower than an ember');
  const b = jumpLength(as('blaze')), e = jumpLength(frun());
  between(b.dist, 4.7, 5.05, 'blaze running jump');
  assert(b.dist > e.dist + 0.4, `further than an ember (${b.dist} vs ${e.dist})`);
  assert(b.time > e.time * 1.5, 'and much longer in the air');
  // falling: capped at 7 m/s
  const r = as('blaze', [{ type: 'block', box: [-3, 0, -3, 3, 12, 3] }], { spawn: [0, 12, 0] });
  let fastest = 0;
  for (let i = 0; i < 900 && !(r.p.grounded && r.p.y < 1); i++) { r.tick(1, 0, false); fastest = Math.max(fastest, -r.p.vy); }
  between(fastest, 6.9, 7.0001, 'terminal fall speed of a blaze');
});

test('blaze special (flare): an upward push for 2 heat, once per time in the air, refused without the heat', () => {
  const r = as('blaze');
  r.tick(0, 0, false); r.tick(0, 0, true);
  r.waitUntil((s, p) => p.vy < 0.3, { jump: true, timeout: 2 });
  const y = r.p.y, g = r.p.gauge;
  r.special({ jump: true });
  near(r.p.vy, FLARE_UP - 26 * 0.385 * DT * 0, 0.2, 'flare sets the upward speed');
  near(g - r.p.gauge, FLARE_COST, 0.02);
  eq(r.sfx().filter((n) => n === 'flare').length, 2, 'entering blaze and the flare itself');
  let top = y;
  r.special({ expect: false });                                 // second flare in the same airtime
  while (!r.p.grounded) { r.tick(0, 0, false); top = Math.max(top, r.p.y); }
  between(top, 2.3, 2.55, 'jump + flare apex');
  r.special();                                                  // landed: it is back (from the ground it is a small hop)
  r.waitUntil((s, p) => p.grounded, { timeout: 3 });
  r.p.gauge = FLARE_COST - 0.1;
  r.special({ expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'special');
});

test('blaze + flare: clears 7 m, which neither an ember nor a plain blaze jump can', () => {
  const r = as('blaze');
  r.move(1, 0, 0.8);
  const x0 = r.p.x;
  r.tick(1, 0, false); r.tick(1, 0, true);
  r.waitUntil((s, p) => p.vy < 0.3, { mx: 1, jump: true, timeout: 2 });
  r.special({ mx: 1, jump: true });
  r.waitUntil((s, p) => p.grounded, { mx: 1, timeout: 4 });
  between(r.p.x - x0, 7.0, 7.6, 'jump + flare distance');
});

test('blaze: too tall for a 0.8 m beam that an ember ducks under; the change waits for room', () => {
  const beam = [{ type: 'block', box: [3, 0.8, -3, 5, 3, 3] }];
  const b = as('blaze', beam);
  hold(b, 1, 0, 2, { jump: true });
  assert(b.p.x <= 3 - F.blaze.r + 1e-6, `a blaze got under the beam: x=${b.p.x}`);
  const e = frun(beam);
  e.walkTo(4, 0);
  e.form('blaze', { expect: false });
  eq(e.p.form, 'ember', 'no room to flare up under the beam');
  eq(e.events.filter((x) => x.type === 'denied').pop().reason, 'space');
  e.walkTo(6.5, 0);
  e.form('blaze');
});

// ------------------------------------------------------------------ smoke
test('smoke: no gravity, rises at 1.9 m/s, drifts at 3 m/s, drains 1 heat a second', () => {
  const r = as('smoke');
  eq(r.sfx().includes('smoke_puff'), true);
  const g0 = r.p.gauge;
  r.wait(1.5);
  near(r.p.vy, 1.9, 1e-6, 'rise speed'); assert(!r.p.grounded);
  r.move(1, 0, 1.5);
  near(r.p.vx, 3.0, 1e-6, 'drift speed');
  near(g0 - r.p.gauge, F.smoke.drain * 3, 0.02, 'drain'); eq(F.smoke.drain, 1);
  r.waitUntil((s, p) => p.form === 'ember', { timeout: 20 });
  eq(r.sfx().includes('ignite'), true, 're-kindling as a coal plays "ignite"');
});

test('smoke: rises until it meets a ceiling, then slides along it; passes a grate that stops the others', () => {
  const r = as('smoke', [{ type: 'block', box: [-4, 3, -4, 12, 3.4, 4] }]);
  r.move(1, 0, 3);
  near(r.p.y, 3 - F.smoke.h, 1e-6, 'pressed against the ceiling');
  assert(r.p.x > 6, `sliding along it: x=${r.p.x}`);
  for (const f of ['ember', 'blaze', 'spark']) {
    const q = as(f, [{ type: 'grate', box: [3, 0, -4, 3.3, 3, 4] }]);
    hold(q, 1, 0, 2, { jump: f !== 'spark' });
    assert(q.p.x <= 3 - F[f].r + 1e-6, `${f} must be stopped by the grate, x=${q.p.x}`);
  }
  const s = as('smoke', [{ type: 'grate', box: [3, 0, -4, 3.3, 3, 4] }]);
  s.move(1, 0, 2.5);
  assert(s.p.x > 4, `smoke should pass the grate, x=${s.p.x}`);
});

test('smoke: a fan carries it; presses no plate', () => {
  const r = as('smoke', [{ type: 'fan', box: [1, 0, -3, 16, 5, 3], dir: '+x', strength: 8 }, { type: 'plate', pos: [0, 0, 0], emit: 'p' }]);
  r.wait(0.2); r.expectSignal('p', false);
  r.move(1, 0, 1);
  r.waitUntil((s, p) => p.x > 3, { mx: 1, timeout: 4 });
  r.wait(0.6);
  near(r.p.vx, 8, 0.05, 'dragged to wind speed');
});

// ------------------------------------------------------------------ spark
test('spark: tiny and very fast with a short hop; drains heat fastest', () => {
  const r = as('spark');
  eq(r.sfx().includes('spark_zip'), true);
  near(r.p.r, 0.14, 1e-12); near(r.p.h, 0.26, 1e-12);
  r.move(1, 0, 0.3);
  near(r.speed, 9.5, 1e-6, 'top speed within 0.3 s (acceleration 45 m/s^2)');
  const g0 = r.p.gauge;
  r.wait(1);
  near(g0 - r.p.gauge, 2, 0.02, 'drain per second');
  between(jumpApex(as('spark')), 0.45, 0.56, 'a short hop');
  assert(F.spark.drain > F.blaze.drain && F.blaze.drain > F.smoke.drain && !F.ember.drain, 'spark > blaze > smoke > ember (none)');
});

test('spark: a key tap is a small step, a held key is the full dash (the keyboard can line a spark up)', () => {
  // a tap of 0.15 s (the quickest a person can press and release, and the smallest step of tests/lib/keyboard.js)
  const tap = (secs) => { const r = as('spark'); const x0 = r.p.x; r.move(1, 0, secs); r.move(0, 0, 0.6); return r.p.x - x0; };
  between(tap(0.15), 0.6, 0.9, 'a 0.15 s tap moves a spark about three quarters of a metre (it was 1.55 m)');
  between(tap(0.3), 1.8, 2.8, 'a 0.3 s press moves it about 2.3 m');
  assert(tap(0.15) < tap(0.3) && tap(0.3) < tap(0.6), 'longer press, further step');
  const r = as('spark');
  r.move(1, 0, 0.1); assert(r.speed < 9.5 - 3, `a short press does not reach the dash: ${r.speed}`);
  r.move(1, 0, 0.2); near(r.speed, 9.5, 1e-6, 'a held key reaches 9.5 m/s within 0.3 s');
  const stop = (() => { const q = as('spark'); q.move(1, 0, 1); const x0 = q.p.x; q.move(0, 0, 0.6); return q.p.x - x0; })();
  between(stop, 0.4, 0.55, 'at full speed it still stops in about half a metre');
});

test('spark: fits a pinhole and a low gap the ember cannot; drops through a floor slot', () => {
  // a wall with a 0.45 x 0.45 m hole at floor level
  const hole = [
    { type: 'block', box: [3, 0, -4, 3.5, 3, -0.225] }, { type: 'block', box: [3, 0, 0.225, 3.5, 3, 4] }, { type: 'block', box: [3, 0.45, -0.225, 3.5, 3, 0.225] },
  ];
  const e = frun(hole);
  hold(e, 1, 0, 2, { jump: true });
  assert(e.p.x <= 3 - F.ember.r + 1e-6, `an ember got through the pinhole: ${e.p.x}`);
  const s = as('spark', hole);
  s.move(1, 0, 1);
  assert(s.p.x > 4, `a spark should fit the pinhole: ${s.p.x}`);
  // slot floor over a drop
  const slot = [{ type: 'slot', box: [2, -0.3, -2, 5, 0, 2] }, { type: 'block', box: [-10, -3, -10, 50, -2, 10] }];
  const noFloor = { noFloor: true };
  const base = [{ type: 'block', box: [-10, -1, -10, 2, 0, 10] }, { type: 'block', box: [5, -1, -10, 50, 0, 10] }, ...slot];
  const k = frun(base, noFloor);
  k.walkTo(3.5, 0); k.wait(0.3);
  near(k.p.y, 0, 1e-6, 'an ember stands on the slats');
  k.form('spark'); k.wait(0.6);
  near(k.p.y, -2, 1e-6, 'a spark drops between them');
});

test('spark out of heat inside a pinhole stays a spark until it has room to be an ember', () => {
  const tunnel = [{ type: 'block', box: [3, 0.45, -4, 9, 3, 4] }];      // a 0.45 m crawl space, 6 m long
  const r = as('spark', tunnel);
  r.walkTo(5, 0);
  r.p.gauge = 0.05;
  r.wait(0.5);
  eq(r.p.form, 'spark', 'no room for an ember here'); eq(r.p.gauge, 0);
  eq(r.sim.deaths, 0);
  r.waitUntil((s, p) => p.form === 'ember', { mx: 1, timeout: 3, label: 'crawled out and settled' });
  assert(r.p.x > 9, `changed back only once clear of the roof: x=${r.p.x}`);
});

// ------------------------------------------------------------------ shared pieces, per flag
test('plates: ember and blaze press a light plate; a spark is refused with a cue; nobody presses a heavy one', () => {
  const pieces = [{ type: 'plate', pos: [3, 0, 0], emit: 'p' }, { type: 'plate', pos: [7, 0, 0], heavy: true, emit: 'h' }];
  for (const f of ['ember', 'blaze']) {
    const r = as(f, pieces);
    r.walkTo(3, 0); r.wait(0.1); r.expectSignal('p', true);
    r.walkTo(7, 0); r.wait(0.1); r.expectSignal('h', false);
  }
  const s = as('spark', pieces);
  s.walkTo(3, 0); s.wait(0.1); s.expectSignal('p', false);
  assert(s.sfx().includes('denied'), 'a spark on a plate gets the "denied" cue');
});

test('fans: an ember is carried at half the wind, a blaze at 1.3 x, a spark not at all', () => {
  const fan = (s) => [{ type: 'fan', box: [-9.5, 0, -3, 30, 3, 3], dir: '-x', strength: s }];
  const net = (form, s) => { const r = as(form, fan(s)); r.move(1, 0, 2); const x0 = r.p.x; r.move(1, 0, 1); return r.p.x - x0; };
  near(net('ember', 4), 6.2 - 0.5 * 4, 0.02, 'ember against strength 4');
  near(net('blaze', 2), 4.2 - 1.3 * 2, 0.02, 'blaze against strength 2');
  assert(net('blaze', 4) < 0, 'a strength-4 fan drives a blaze back');
  near(net('spark', 8), 9.5, 0.02, 'a spark ignores the wind');
});

test('frost: a blaze is forced back to an ember and cannot flare up inside; an ember walks through', () => {
  const frost = [{ type: 'frost', box: [3, 0, -3, 6, 3, 3] }];
  const r = as('blaze', frost);
  r.walkTo(4.5, 0, { stuck: 0, timeout: 3 });
  eq(r.p.form, 'ember');
  eq(r.events.filter((e) => e.type === 'form').pop().cause, 'zone');
  r.form('blaze', { expect: false });
  eq(r.events.filter((e) => e.type === 'denied').pop().reason, 'frost');
  r.walkTo(8, 0);
  r.form('blaze');
});

test('cold: smoke drops out as an ember; heat vent: no form spends heat inside', () => {
  const r = as('smoke', [{ type: 'cold', box: [3, 0, -3, 6, 6, 3] }]);
  r.waitUntil((s, p) => p.form === 'ember', { mx: 1, timeout: 4 });
  between(r.p.x, 2.4, 3.6, 'at the edge of the cold');
  r.form('smoke', { expect: false });
  const v = as('blaze', [{ type: 'heatvent', box: [-2, 0, -3, 3, 3, 3] }]);
  const g = v.p.gauge;
  v.wait(2);
  eq(v.p.form, 'blaze', 'a heat vent does not force a form on fire'); eq(v.p.gauge, g, 'and no heat is spent inside');
  v.walkTo(6, 0);
  assert(v.p.gauge < g, 'outside it drains again');
});

test('what kills water feeds fire: the kiln fire piece refuels 3 heat a second and never harms', () => {
  const r = frun([{ type: 'fire', box: [3, 0, -3, 7, 1, 3] }], { startGauge: 2 });
  r.walkTo(5, 0);
  const g = r.p.gauge;
  r.wait(1);
  near(r.p.gauge - g, 3, 0.05);
  eq(r.sim.deaths, 0);
  r.wait(4); eq(r.p.gauge, HEAT_MAX, 'capped at the top');
});

test('running water (a current) puts out every form that touches it; respawn is as an ember', () => {
  for (const f of ['ember', 'blaze', 'spark']) {
    const r = as(f, [{ type: 'block', box: [3, -1.5, -3, 7, -0.6, 3] }, { type: 'current', box: [3, -0.6, -3, 7, 0.5, 3], flow: [0, 1] }]);
    r.allowDeath = true;
    r.waitUntil((s) => s.deaths > 0, { mx: 1, timeout: 4, label: `${f} reaches the water` });
    eq(r.events.filter((e) => e.type === 'respawn').pop().cause, 'water');
    eq(r.p.form, 'ember');
    near(r.p.x, 0, 1e-9, 'back at the spawn');
  }
  // smoke that sinks into it is put out as well (a cold zone drops it as an ember straight into the water)
  const s = as('smoke', [{ type: 'block', box: [3, -1.5, -3, 7, -0.6, 3] }, { type: 'current', box: [3, -0.6, -3, 7, 0.5, 3], flow: [0, 1] }, { type: 'block', box: [-4, 0.75, -3, 12, 1.1, 3] }]);
  s.allowDeath = true;
  s.waitUntil((q) => q.deaths > 0, { mx: 1, timeout: 4, label: 'smoke under a low ceiling is dragged through the water' });
});

test('panes are not broken by any form on its own; wooden things are never pushed', () => {
  for (const f of ['ember', 'blaze', 'spark']) {
    const r = as(f, [{ type: 'pane', box: [4, 0, -3, 4.2, 3, 3], speed: 1 }]);
    hold(r, 1, 0, 1.5);
    assert(!r.sim.level.panes[0].broken && r.p.x < 4, `${f} broke or passed the pane`);
  }
  const r = frun([{ type: 'wood', kind: 'crate', pos: [4, 0, 0] }]);
  hold(r, 1, 0, 1.5);
  near(r.sim.level.crates[0].body.x, 4, 1e-9, 'an ember does not push a crate');
});

test('determinism: the same inputs give bit-identical state for a fire level', () => {
  const pieces = [{ type: 'wood', kind: 'plank', box: [6, 0, -2, 6.3, 2, 2] }, { type: 'pool', box: [10, -0.4, -3, 12, 0.3, 3] }, { type: 'drip', pos: [3, 3, 0] }, { type: 'gas', box: [14, 0, -1, 16, 1.5, 1] }];
  const go = () => {
    const r = frun(pieces); r.allowDeath = true;
    for (let i = 0; i < 1400; i++) r.tick(Math.sin(i * 0.013) * 0.4 + 0.6, Math.cos(i * 0.021) * 0.3, i % 80 < 30, i % 211 === 0 ? ['blaze', 'ember', 'spark', 'smoke'][(i / 211) % 4] : null);
    return r.sim.fingerprint();
  };
  eq(go(), go());
});
