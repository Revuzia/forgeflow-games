import { test, assert, near, between, eq } from './lib/harness.js';
import { run } from './lib/mini.js';
import { DT, FORMS, STEAM_MAX, STEAM_REFILL, COYOTE_TIME, JUMP_BUFFER } from '../src/sim/constants.js';

function jumpApex(r, holdTicks = 9999, mx = 0) {
  r.tick(mx, 0, false);
  const y0 = r.p.y;
  let maxY = y0;
  for (let i = 0; i < 400; i++) {
    r.tick(mx, 0, i < holdTicks);
    maxY = Math.max(maxY, r.p.y);
    if (i > 5 && r.p.grounded) break;
  }
  return maxY - y0;
}

// ------------------------------------------------------------------ liquid
test('liquid: reaches run speed quickly and stops quickly', () => {
  const r = run();
  r.move(1, 0, 0.15);
  near(r.speed, FORMS.liquid.speed, 1e-6, 'top speed within 0.15 s');
  r.move(0, 0, 0.15);
  near(r.speed, 0, 1e-9, 'stopped within 0.15 s');
});

test('liquid: full jump height and distance are in the documented band', () => {
  const r = run();
  between(jumpApex(r), 1.48, 1.56, 'full jump apex');
  const q = run();
  q.move(1, 0, 0.4);
  const x0 = q.p.x;
  q.tick(1, 0, false); q.tick(1, 0, true);
  let n = 0;
  while (!q.p.grounded && n++ < 400) q.tick(1, 0, true);
  between(q.p.x - x0, 3.2, 3.5, 'running jump distance on the flat');
});

test('liquid: variable jump height - a tap is much lower than a held jump', () => {
  const tap = jumpApex(run(), 4);
  const full = jumpApex(run());
  assert(tap < full * 0.6, `tap ${tap} should be well under full ${full}`);
  assert(tap > 0.3, `tap ${tap} should still leave the ground`);
});

test('liquid: coyote time lets a jump fire just after walking off a ledge, but not long after', () => {
  const mk = () => {
    const r = run([{ type: 'block', box: [-10, 0, -3, 2, 3, 3] }], { spawn: [0, 3, 0] });
    r.move(1, 0, 0.3);
    r.waitUntil((s, p) => !p.grounded, { mx: 1, timeout: 2 });
    return r;
  };
  let r = mk();
  r.move(1, 0, COYOTE_TIME - 0.03);             // still inside the window
  r.tick(1, 0, true);
  assert(r.p.vy > 5, `coyote jump did not fire (vy=${r.p.vy})`);
  r = mk();
  r.move(1, 0, COYOTE_TIME + 0.05);             // too late
  r.tick(1, 0, true);
  assert(r.p.vy < 0, `jump fired after the coyote window (vy=${r.p.vy})`);
});

test('liquid: jump buffer - a press shortly before landing jumps on landing', () => {
  const air = (lead) => {
    const r = run();
    r.sim.teleport(0, 1.0, 0);
    // fall 1 m: find the landing tick first
    let n = 0; const probe = run(); probe.sim.teleport(0, 1.0, 0);
    while (!probe.p.grounded && n < 400) { probe.tick(); n++; }
    const pressAt = n - Math.round(lead / DT);
    for (let i = 0; i < pressAt; i++) r.tick();
    r.tick(0, 0, true);                         // press (still airborne)
    assert(!r.p.grounded, 'should still be airborne when pressing');
    let jumped = false;
    for (let i = 0; i < 40; i++) { r.tick(0, 0, true); if (r.p.vy > 5) jumped = true; }
    return jumped;
  };
  assert(air(JUMP_BUFFER - 0.04), 'buffered jump should fire');
  assert(!air(JUMP_BUFFER + 0.08), 'a press too early must not be remembered');
});

test('liquid: no double jump', () => {
  const r = run();
  r.tick(0, 0, false); r.tick(0, 0, true); r.move(0, 0, 0.1, true);
  const vy = r.p.vy;
  r.tick(0, 0, false); r.tick(0, 0, true);
  assert(r.p.vy < vy, 'second press in the air must not add upward speed');
});

test('liquid: air control can reverse direction mid-jump', () => {
  const r = run();
  r.move(1, 0, 0.3);
  r.tick(1, 0, false); r.tick(1, 0, true);
  for (let i = 0; i < 60; i++) r.tick(-1, 0, true);
  assert(r.p.vx < -1, `expected to be moving back, vx=${r.p.vx}`);
});

// ------------------------------------------------------------------ ice
test('ice: slow to start, keeps sliding when the stick is released (low friction)', () => {
  const r = run();
  r.form('ice');
  r.move(1, 0, 0.15);
  assert(r.speed < 2, `ice accelerated too fast: ${r.speed}`);
  r.move(1, 0, 1.5);
  near(r.speed, FORMS.ice.speed, 0.05, 'ice top speed from input');
  const x0 = r.p.x;
  r.move(0, 0, 1);
  assert(r.speed > 3, `ice lost its momentum: ${r.speed} m/s after 1 s`);
  assert(r.p.x - x0 > 4.5, 'ice should have slid several metres');
  const liquid = run();
  liquid.move(1, 0, 1); liquid.move(0, 0, 0.2);
  near(liquid.speed, 0, 1e-9, 'liquid stops; contrast with ice');
});

test('ice: small jump', () => {
  const r = run();
  r.form('ice');
  between(jumpApex(r), 0.5, 0.6, 'ice jump apex');
});

test('ice: gains speed down a ramp beyond its own top speed', () => {
  const r = run([
    { type: 'block', box: [-10, 0, -3, 0.5, 4, 3] },
    { type: 'ramp', box: [0.5, 0, -3, 8.5, 4, 3], up: '-x' },
  ], { spawn: [0, 4, 0] });
  r.form('ice');
  r.move(1, 0, 0.6);
  r.waitUntil((s, p) => p.x > 9.5, { timeout: 6 });
  assert(r.p.grounded, 'should be on the floor after the ramp');
  near(r.p.y, 0, 1e-6);
  assert(r.speed > 8, `expected well over ${FORMS.ice.speed} m/s after a 4 m drop, got ${r.speed}`);
});

test('ice: launches off the crest of a ramp; liquid sticks to it', () => {
  const pieces = [{ type: 'ramp', box: [6, 0, -3, 9, 1.2, 3], up: '+x' }];
  const ice = run(pieces);
  ice.sim.teleport(-8, 0, 0); ice.wait(0.1);
  ice.form('ice');
  let maxY = 0, airborneAfterCrest = false;
  for (let i = 0; i < 480; i++) {
    ice.tick(1, 0);
    maxY = Math.max(maxY, ice.p.y);
    if (ice.p.x > 9.2 && !ice.p.grounded && ice.p.y > 1.22) airborneAfterCrest = true;
  }
  assert(airborneAfterCrest, 'ice should fly off the crest');
  assert(maxY > 1.28, `ice apex after the crest should exceed the ramp top, got ${maxY}`);
  const liq = run(pieces);
  liq.sim.teleport(3, 0, 0); liq.wait(0.1);
  let liqMax = 0;
  for (let i = 0; i < 200; i++) { liq.tick(1, 0); liqMax = Math.max(liqMax, liq.p.y); }
  near(liqMax, 1.2, 1e-6, 'liquid never rises above the ramp top');
});

test('ice: not pushed by a fan that stops liquid', () => {
  const fan = [{ type: 'fan', box: [3, 0, -3, 12, 3, 3], dir: '-x', strength: 9 }];
  const liq = run(fan);
  liq.move(1, 0, 3);
  assert(liq.p.x < 4, `liquid should be held back by the fan, x=${liq.p.x}`);
  const ice = run(fan);
  ice.form('ice');
  ice.move(1, 0, 3);
  assert(ice.p.x > 12, `ice should plough through the fan, x=${ice.p.x}`);
});

test('ice: melts on hot floor and cannot be re-frozen there', () => {
  const r = run([{ type: 'hotfloor', box: [3, 0, -3, 6, 0.3, 3] }]);
  r.form('ice');
  r.waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 4, label: 'melted' });
  between(r.p.x, 3 - 0.4, 3.6, 'melts on entering the hot floor');
  assert(r.sfx().includes('melt'));
  r.form('ice', { expect: false });
  eq(r.p.form, 'liquid', 'refreeze on hot floor is refused');
  assert(r.events.some((e) => e.type === 'denied' && e.reason === 'hot'));
});

// ------------------------------------------------------------------ steam
test('steam: no gravity, rises steadily, steerable', () => {
  const r = run();
  r.form('steam');
  r.wait(0.5);
  const y0 = r.p.y, x0 = r.p.x;
  r.move(1, 0, 1);
  near(r.p.y - y0, FORMS.steam.rise, 0.02, 'rise in 1 s');
  between(r.p.x - x0, 2.4, 3.4, 'drift in 1 s');
  assert(!r.p.grounded);
});

test('steam: gauge lasts STEAM_MAX seconds, then condenses; refills on the ground only', () => {
  const r = run();
  r.form('steam');
  const t0 = r.t;
  r.waitUntil((s, p) => p.form !== 'steam', { timeout: 6 });
  near(r.t - t0, STEAM_MAX, 0.05, 'steam duration');
  eq(r.p.form, 'liquid');
  assert(r.sfx().includes('condense'));
  near(r.p.gauge, 0, 1e-9);
  // in the air: no refill, and steam is refused
  r.wait(0.2);
  near(r.p.gauge, 0, 1e-9, 'no refill while falling');
  r.form('steam', { expect: false });
  eq(r.p.form, 'liquid', 'cannot re-vaporise with an empty gauge');
  r.waitUntil((s, p) => p.grounded, { timeout: 4 });
  r.wait(1);
  near(r.p.gauge, STEAM_REFILL * 1, 0.05, 'refill rate on the ground');
  r.wait(2);
  near(r.p.gauge, STEAM_MAX, 1e-9, 'gauge full again');
});

test('steam: passes through a grate that stops liquid, ice and film', () => {
  const grate = [{ type: 'grate', box: [3, 0, -3, 3.2, 5, 3] }];
  const s = run(grate);
  s.form('steam');
  s.move(1, 0, 2.5);
  assert(s.p.x > 4, `steam should pass the grate, x=${s.p.x}`);
  for (const f of ['liquid', 'ice', 'film']) {
    const r = run(grate);
    if (f !== 'liquid') r.form(f);
    r.move(1, 0, 2.5);
    assert(r.p.x <= 3 - FORMS[f].r + 1e-6, `${f} must be stopped by the grate, x=${r.p.x}`);
  }
});

test('steam: rises through a ceiling grate', () => {
  const r = run([
    { type: 'block', box: [-10, 3, -10, -2, 3.4, 10] },
    { type: 'block', box: [2, 3, -10, 50, 3.4, 10] },
    { type: 'block', box: [-2, 3, -10, 2, 3.4, -2] },
    { type: 'block', box: [-2, 3, 2, 2, 3.4, 10] },
    { type: 'grate', box: [-2, 3, -2, 2, 3.4, 2] },
  ]);
  r.form('steam');
  r.waitUntil((s, p) => p.y > 3.6, { timeout: 4, label: 'above the grate' });
  r.form('liquid');
  r.waitUntil((s, p) => p.grounded, { timeout: 2 });
  near(r.p.y, 3.4, 1e-6, 'liquid lands ON the grate');
});

test('steam: condensing inside a grate pops Mote out instead of leaving it embedded', () => {
  const r = run([{ type: 'grate', box: [-3, 1.0, -3, 3, 1.3, 3] }]);
  r.form('steam');
  r.waitUntil((s, p) => p.y > 0.6 && p.y < 1.1, { timeout: 3, label: 'overlapping the grate' });
  r.p.gauge = 0.001;                       // run out right now
  r.wait(0.5);
  eq(r.p.form, 'liquid');
  eq(r.sim.deaths, 0);
  assert(r.p.y >= 1.3 - 1e-6 || r.p.y + FORMS.liquid.h <= 1.0 + 1e-6, `still inside the grate at y=${r.p.y}`);
});

test('steam: a fan pushes it hard; an updraft lifts it fast', () => {
  const side = run([{ type: 'fan', box: [-2, 0, -3, 14, 6, 3], dir: '+x', strength: 8 }]);
  side.form('steam');
  side.move(0, 0, 1);
  assert(side.p.x > 5, `steam should be blown along, x=${side.p.x}`);
  near(side.p.vx, 8, 0.2, 'steam reaches wind speed');
  const up = run([{ type: 'fan', box: [-2, 0, -2, 2, 12, 2], dir: '+y', strength: 6 }]);
  up.form('steam');
  up.move(0, 0, 1);
  assert(up.p.y > 4.5, `steam should be lifted, y=${up.p.y}`);
});

test('steam: a cold zone condenses it and refuses vaporising inside', () => {
  const r = run([{ type: 'cold', box: [3, 0, -3, 7, 6, 3] }]);
  r.form('steam');
  r.waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 3, label: 'condensed' });
  between(r.p.x, 2.7, 3.5);
  assert(r.p.gauge > 1, 'condensed by the zone, not by the gauge');
  r.waitUntil((s, p) => p.grounded, { mx: 1, timeout: 3 });
  r.form('steam', { expect: false });
  eq(r.p.form, 'liquid');
});

// ------------------------------------------------------------------ film
test('film: slow crawl, cannot jump', () => {
  const r = run();
  r.form('film');
  r.move(1, 0, 0.3);
  near(r.speed, FORMS.film.speed, 1e-6);
  r.tick(1, 0, false);
  for (let i = 0; i < 30; i++) { r.tick(1, 0, true); assert(r.p.grounded && r.p.y === 0, 'film left the ground'); }
});

test('film: slips under a 0.25 m gap; liquid, ice and steam cannot', () => {
  const gap = [{ type: 'block', box: [3, 0.25, -5, 5, 4, 5] }];
  const f = run(gap);
  f.form('film');
  f.move(1, 0, 4);
  assert(f.p.x > 5.5, `film should be through, x=${f.p.x}`);
  for (const form of ['liquid', 'ice', 'steam']) {
    const r = run(gap);
    if (form !== 'liquid') r.form(form);
    for (let i = 0; i < 360; i++) { r.tick(1, 0); if (form === 'steam') { r.p.gauge = 4; if (r.p.y > 0.05) r.sim.teleport(r.p.x, 0, r.p.z); } }
    assert(r.p.x <= 3 - FORMS[form].r + 1e-6, `${form} got under the gap, x=${r.p.x}`);
  }
});

test('film: cannot unflatten under a low ceiling (denied), can once clear', () => {
  const r = run([{ type: 'block', box: [3, 0.25, -5, 5, 4, 5] }]);
  r.form('film');
  r.walkTo(4, 0);
  r.form('liquid', { expect: false });
  eq(r.p.form, 'film');
  assert(r.events.some((e) => e.type === 'denied' && e.reason === 'space'), 'expected a "space" denial');
  assert(r.sfx().includes('denied'));
  r.walkTo(6, 0);
  r.form('liquid');
  eq(r.sim.deaths, 0);
});

test('film: a request made while still under the wall is remembered and fires once clear', () => {
  const r = run([{ type: 'block', box: [3, 0.25, -5, 5, 4, 5] }]);
  r.form('film');
  r.walkTo(4.9, 0, { tol: 0.05 });
  r.tick(1, 0, false, 'liquid');             // one press, still under
  eq(r.p.form, 'film');
  let at = null;
  for (let i = 0; i < 60 && at === null; i++) { r.tick(1, 0); if (r.p.form === 'liquid') at = r.p.x; }
  assert(at !== null, 'buffered request never fired');
  between(at, 5 + FORMS.liquid.r - 0.01, 5 + FORMS.liquid.r + 0.05, 'fires as soon as Mote fits');
  assert(!r.events.some((e) => e.type === 'denied'), 'no denial when the request succeeds in time');
});

test('film: flows through a floor slot that carries liquid and ice', () => {
  const pieces = [
    { type: 'block', box: [-4, 3, -4, 1, 3.3, 4] },
    { type: 'slot', box: [1, 3, -4, 3, 3.3, 4] },
    { type: 'block', box: [3, 3, -4, 8, 3.3, 4] },
  ];
  const f = run(pieces, { spawn: [0, 3.3, 0] });
  f.form('film');
  f.waitUntil((s, p) => p.y < 0.01 && p.grounded, { mx: 1, timeout: 4, label: 'fell through the slot' });
  between(f.p.x, 1.2, 3);
  for (const form of ['liquid', 'ice']) {
    const r = run(pieces, { spawn: [0, 3.3, 0] });
    if (form !== 'liquid') r.form(form);
    r.walkTo(6, 0, { timeout: 6 });
    near(r.p.y, 3.3, 1e-6, `${form} walks over the slot`);
  }
});

test('film: a fan does not move it', () => {
  const r = run([{ type: 'fan', box: [1, 0, -3, 12, 3, 3], dir: '-x', strength: 12 }]);
  r.form('film');
  r.move(1, 0, 2);
  near(r.p.x, FORMS.film.speed * 2, 0.1, 'film crawls upwind at full speed');
  r.stop();
  const x = r.p.x;
  r.wait(1);
  near(r.p.x, x, 1e-9, 'film resting in the airflow must not be blown');
});

// ------------------------------------------------------------------ switching
test('form change: sfx names follow the contract and events are emitted', () => {
  const r = run();
  r.form('ice').form('liquid').form('film').form('liquid').form('steam').form('liquid').form('film').form('steam').form('ice');
  const names = r.sfx().filter((n) => ['freeze', 'melt', 'flatten', 'unflatten', 'vaporize', 'condense'].includes(n));
  eq(names, ['freeze', 'melt', 'flatten', 'unflatten', 'vaporize', 'condense', 'flatten', 'vaporize', 'freeze']);
  eq(r.events.filter((e) => e.type === 'form').length, 9);
});

test('form change: a level can lock forms', () => {
  const r = run([], { forms: ['liquid', 'film'] });
  r.form('ice', { expect: false });
  eq(r.p.form, 'liquid');
  assert(r.events.some((e) => e.type === 'denied' && e.reason === 'locked'));
  r.form('film');
});

test('form change: switching to steam mid-fall arrests the fall', () => {
  const r = run();
  r.sim.teleport(0, 12, 0);
  r.wait(0.8);
  assert(r.p.vy < -10);
  r.form('steam');
  r.wait(0.5);
  assert(r.p.vy > 0, `steam should be rising again, vy=${r.p.vy}`);
});

test('determinism: the same inputs give bit-identical state', () => {
  const go = () => {
    const r = run([
      { type: 'ramp', box: [4, 0, -2, 8, 2, 2], up: '+x' },
      { type: 'crate', pos: [2, 0, 3] },
      { type: 'mover', box: [-6, 0, -6, -4, 0.4, -4], to: [0, 3, 0] },
    ]);
    r.allowDeath = true;
    const forms = ['ice', 'liquid', 'film', 'liquid', 'steam', 'liquid'];
    for (let i = 0; i < 2400; i++) {
      const a = i * 0.013;
      r.tick(Math.cos(a), Math.sin(a * 1.7), (i % 97) < 30, i % 211 === 0 ? forms[(i / 211) % forms.length | 0] : null);
    }
    return r.sim.fingerprint();
  };
  eq(go(), go());
});
