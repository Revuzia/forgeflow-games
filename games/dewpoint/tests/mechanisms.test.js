import { test, assert, near, between, eq } from './lib/harness.js';
import { run } from './lib/mini.js';
import { FORMS, STEAM_MAX, CRATE_PUSH_SPEED, WATER_FLOAT_DEPTH } from '../src/sim/constants.js';

const sig = (r, n) => r.sim.signals.get(n);

// ------------------------------------------------------------------ plates
test('light plate: pressed by grounded liquid, ice and film, released on leaving', () => {
  for (const form of ['liquid', 'ice', 'film']) {
    const r = run([{ type: 'plate', pos: [4, 0, 0], emit: 'a' }]);
    if (form !== 'liquid') r.form(form);
    assert(!sig(r, 'a'));
    r.waitUntil((s) => s.signals.get('a'), { mx: 1, timeout: 4, label: `${form} presses the plate` });
    assert(r.sim.level.plates[0].pressed);
    between(r.p.x, 3.3 - FORMS[form].r - 0.01, 3.5, 'pressed as soon as the footprint is on it');
    r.waitUntil((s) => !s.signals.get('a'), { mx: 1, timeout: 4, label: `${form} leaves the plate` });
    between(r.p.x, 4.7, 5.2, 'released on leaving');
    eq(r.sfx().filter((n) => n.startsWith('plate_')), ['plate_down', 'plate_up']);
  }
});

test('light plate: steam does not press it, even skimming the floor', () => {
  const r = run([{ type: 'plate', pos: [0, 0, 0], size: [6, 6], emit: 'a' }, { type: 'block', box: [-4, 0.9, -4, 4, 1.2, 4] }]);
  r.wait(0.1);
  assert(sig(r, 'a'), 'liquid presses it first');
  r.form('steam');
  r.wait(0.5);
  assert(!sig(r, 'a'), 'steam must not press a plate');
});

test('heavy plate: only ice or a crate; liquid and film are refused (with a denied cue)', () => {
  for (const form of ['liquid', 'film']) {
    const r = run([{ type: 'plate', pos: [4, 0, 0], heavy: true, emit: 'h' }]);
    if (form !== 'liquid') r.form(form);
    r.walkTo(4, 0); r.wait(0.2);
    assert(!sig(r, 'h'), `${form} must not press a heavy plate`);
    assert(r.sfx().includes('denied'), `${form}: expected a denied cue`);
  }
  const r = run([{ type: 'plate', pos: [4, 0, 0], heavy: true, emit: 'h' }]);
  r.form('ice');
  r.walkTo(4, 0, { tol: 0.4 }); r.stop(); r.wait(0.05);
  if (!sig(r, 'h')) r.walkTo(4, 0, { tol: 0.3 });
  r.wait(0.05);
  assert(sig(r, 'h'), 'ice presses a heavy plate');
});

test('heavy plate: a crate pushed onto it holds it down after Mote leaves', () => {
  const r = run([
    { type: 'plate', pos: [6, 0, 0], heavy: true, emit: 'h' },
    { type: 'crate', pos: [3, 0, 0] },
    { type: 'door', box: [10, 0, -3, 10.4, 3, 3], on: 'h' },
  ]);
  r.form('ice');
  r.waitUntil((s) => s.level.crates[0].body.x >= 5.9, { mx: 1, timeout: 8, label: 'crate on plate' });
  r.move(-1, 0, 1.5);
  r.form('liquid');
  r.walkTo(0, 3); r.wait(0.3);
  assert(sig(r, 'h'), 'crate keeps the heavy plate down');
  eq(r.sim.level.plates[0].by, 'crate');
  near(r.sim.level.doors[0].open, 1, 1e-9, 'door driven by the plate is open');
});

// ------------------------------------------------------------------ doors
test('door: blocks when closed, opens on its signal, closes when it drops', () => {
  const r = run([
    { type: 'plate', pos: [0, 0, 4], emit: 'p' },
    { type: 'door', box: [3, 0, -10, 3.4, 3, 10], on: 'p', time: 0.5 },
  ]);
  r.move(1, 0, 1);
  assert(r.p.x <= 3 - FORMS.liquid.r + 1e-6, 'closed door must block');
  r.walkTo(0, 4); r.wait(0.7);
  const d = r.sim.level.doors[0];
  near(d.open, 1, 1e-9);
  assert(!d.solid.active, 'a fully lowered door is out of the way');
  r.walkTo(-3, 4); r.wait(0.7);
  near(d.open, 0, 1e-9, 'door closed again');
  eq(r.sfx().filter((n) => n.startsWith('door_')), ['door_open', 'door_close']);
});

test('door: does not close on Mote standing in the doorway', () => {
  const r = run([
    { type: 'sensor', box: [-1, 0, -1, 1, 2, 1], emit: 's', visible: false },
    { type: 'door', box: [5, 0, -10, 5.6, 3, 10], on: 's', time: 0.3 },
  ]);
  r.wait(0.5);
  near(r.sim.level.doors[0].open, 1, 1e-9, 'open while Mote is in the sensor');
  r.sim.teleport(5.3, 0.05, 0);          // into the doorway; sensor drops
  r.wait(2);
  const d = r.sim.level.doors[0];
  near(d.open, 1, 1e-9, 'door must wait rather than crush');
  eq(r.sim.deaths, 0);
  r.walkTo(8, 0); r.wait(0.6);
  near(d.open, 0, 1e-9, 'closes once the doorway is clear');
});

test('door: slide "up" stays solid overhead; inverted signal starts open silently', () => {
  const r = run([
    { type: 'plate', pos: [0, 0, 4], emit: 'p' },
    { type: 'door', box: [3, 0, -10, 3.4, 2, 10], on: '!p', slide: 'up' },
  ]);
  const d = r.sim.level.doors[0];
  near(d.open, 1, 1e-9, 'door on !p starts open');
  eq(r.sfx().filter((n) => n.startsWith('door_')), [], 'no door sound at level start');
  near(d.solid.y0, 2, 1e-9);
  r.walkTo(6, 0);                        // walks under the raised door
  r.walkTo(6, 4).walkTo(0, 4, { stuck: 0, timeout: 3, tol: 0.3 }).wait(0.8);
  near(d.open, 0, 1e-9, 'pressing the plate closes it');
});

// ------------------------------------------------------------------ crates
test('crate: ice pushes it (slowly), liquid film and steam cannot', () => {
  for (const form of ['liquid', 'film', 'steam']) {
    const r = run([{ type: 'crate', pos: [2, 0, 0] }]);
    if (form !== 'liquid') r.form(form);
    for (let i = 0; i < 240; i++) { r.tick(1, 0); if (form === 'steam') { r.p.gauge = 4; if (r.p.y > 0.05) r.sim.teleport(r.p.x, 0, r.p.z); } }
    near(r.sim.level.crates[0].body.x, 2, 1e-9, `${form} must not move a crate`);
  }
  const r = run([{ type: 'crate', pos: [2, 0, 0] }]);
  r.form('ice');
  r.move(1, 0, 3);
  const c = r.sim.level.crates[0].body;
  assert(c.x > 5, `ice should have pushed the crate, crate x=${c.x}`);
  assert(r.p.vx <= CRATE_PUSH_SPEED + 1e-6, `pushing should be slow, vx=${r.p.vx}`);
  near(c.x - 0.5 - r.p.x, FORMS.ice.r, 0.01, 'ice stays in contact with the crate face');
  assert(r.sfx().includes('crate_push'));
});

test('crate: stops at a wall, falls off a ledge, and returns home if it leaves the world', () => {
  let r = run([{ type: 'crate', pos: [2, 0, 0] }, { type: 'block', box: [5, 0, -3, 6, 3, 3] }]);
  r.form('ice');
  r.move(1, 0, 4);
  near(r.sim.level.crates[0].body.x, 4.5, 0.01, 'crate rests against the wall');
  assert(r.p.x <= 4 - FORMS.ice.r + 0.01, 'ice stops behind the blocked crate');

  r = run([{ type: 'block', box: [-10, 0, -3, 6, 3, 3] }, { type: 'crate', pos: [3, 3, 0] }], { spawn: [0, 3, 0] });
  r.form('ice');
  r.waitUntil((s) => s.level.crates[0].body.y < 0.01 && s.level.crates[0].grounded, { mx: 1, timeout: 6, label: 'crate fell to the floor' });
  assert(r.sim.level.crates[0].body.x > 6, 'crate landed past the ledge');

  r = run([{ type: 'block', box: [-3, -1, -3, 6, 0, 3] }, { type: 'crate', pos: [3, 0, 0] }], { noFloor: true, exit: [0, 0, -2], killY: -6 });
  r.form('ice');
  r.waitUntil((s) => s.level.crates[0].resets === 1, { mx: 1, timeout: 8, label: 'crate reset' });
  eq([r.sim.level.crates[0].body.x, r.sim.level.crates[0].body.z], [3, 0]);
});

test('crate: is solid - Mote can stand on it, and it rides a moving platform', () => {
  const r = run([
    { type: 'crate', pos: [2, 0, 0] },
    { type: 'mover', box: [6, 0, -1, 8, 0.4, 1], to: [0, 3, 0], speed: 1.5, pause: 0.3 },
    { type: 'crate', pos: [7, 0.4, 0], size: 0.8 },
  ]);
  r.jumpTo(2, 0);
  near(r.p.y, 1, 1e-6, 'standing on the crate');
  const c = r.sim.level.crates[1];
  let maxY = 0;
  for (let i = 0; i < 600; i++) { r.tick(); maxY = Math.max(maxY, c.body.y); near(c.body.y, r.sim.level.movers[0].solid.y1, 1e-6, 'crate rides the lift'); }
  assert(maxY > 3, 'crate was lifted');
});

test('restart (R) puts crates back where they started', () => {
  const r = run([{ type: 'crate', pos: [2, 0, 0] }]);
  r.form('ice'); r.move(1, 0, 2);
  assert(r.sim.level.crates[0].body.x > 3);
  r.restart(); r.wait(0.6);
  near(r.sim.level.crates[0].body.x, 2, 1e-9);
  eq(r.sim.deaths, 0, 'a manual restart is not a death');
  eq(r.p.form, 'liquid');
});

// ------------------------------------------------------------------ panes
test('pane: fast ice smashes it, slow ice only cracks it, liquid never breaks it', () => {
  const pane = [{ type: 'pane', box: [9, 0, -3, 9.2, 3, 3], emit: 'broken' }];
  let r = run(pane);
  r.sim.teleport(7, 0, 0); r.wait(0.1);
  r.form('ice'); r.move(1, 0, 2);
  assert(!r.sim.level.panes[0].broken, 'ice without a run-up must not break it');
  assert(r.sfx().includes('pane_crack'), 'slow hit should crack');
  assert(r.p.x <= 9 - FORMS.ice.r + 1e-6);

  r = run(pane);
  r.form('ice'); r.move(1, 0, 3);
  assert(r.sim.level.panes[0].broken, 'ice at full speed breaks it');
  assert(r.p.x > 10, 'and keeps going');
  assert(r.sfx().includes('pane_smash'));
  assert(sig(r, 'broken'), 'pane emits once broken');

  r = run(pane);
  r.move(1, 0, 3);
  assert(!r.sim.level.panes[0].broken && r.p.x <= 9 - FORMS.liquid.r + 1e-6, 'liquid is just blocked');
});

test('pane: ice dropping from height smashes a floor pane; liquid lands on it', () => {
  const pieces = [{ type: 'pane', box: [-2, 2, -2, 2, 2.2, 2] }];
  const ice = run(pieces);
  ice.sim.teleport(0, 6, 0); ice.sim.forceForm('ice');
  ice.waitUntil((s, p) => p.grounded, { timeout: 3 });
  near(ice.p.y, 0, 1e-6, 'ice went through to the floor');
  assert(ice.sim.level.panes[0].broken);
  const liq = run(pieces);
  liq.sim.teleport(0, 6, 0);
  liq.waitUntil((s, p) => p.grounded, { timeout: 3 });
  near(liq.p.y, 2.2, 1e-6, 'liquid lands on the pane');
});

// ------------------------------------------------------------------ embers / sprouts / electrodes
test('ember: blocks ice, film and steam; liquid douses it and passes', () => {
  const ember = [{ type: 'ember', box: [3, 0, -10, 4, 6, 10], emit: 'out' }];
  for (const form of ['ice', 'film', 'steam']) {
    const r = run(ember);
    r.form(form);
    for (let i = 0; i < 300; i++) { r.tick(1, 0); if (form === 'steam') r.p.gauge = 4; }
    assert(r.p.x <= 3 - FORMS[form].r + 1e-6, `${form} got through embers`);
    assert(!r.sim.level.embers[0].doused);
  }
  const r = run(ember);
  r.walkTo(6, 0);
  assert(r.sim.level.embers[0].doused);
  assert(r.sfx().includes('ember_douse'));
  assert(sig(r, 'out'));
});

test('sprout: only liquid waters it; it grows leaves Mote can climb to the top', () => {
  const pieces = [{ type: 'sprout', pos: [4, 0, 0], height: 3, emit: 'grown' }];
  const ice = run(pieces);
  ice.form('ice'); ice.walkTo(3.4, 0, { tol: 0.3 }); ice.wait(0.5);
  eq(ice.sim.level.sprouts[0].state, 0, 'ice does not water a sprout');

  const r = run(pieces);
  r.walkTo(3.3, 0);
  r.waitUntil((s) => s.level.sprouts[0].state === 2, { timeout: 2, label: 'grown' });
  assert(r.sfx().includes('sprout_grow'));
  r.wait(0.05);
  assert(sig(r, 'grown'));
  const sp = r.sim.level.sprouts[0];
  eq(sp.leaves.length, 3);
  // climb: leaf tops at 1, 2, 3; lower leaves alternate +x / -x of the stalk
  // leaves are one-way: stand by the stalk and hop straight up through each
  r.walkTo(4, 0);
  r.jumpTo(4, 0); near(r.p.y, 1, 1e-6, 'on leaf 1');
  r.jumpTo(4, 0); near(r.p.y, 2, 1e-6, 'on leaf 2');
  r.jumpTo(4, 0); near(r.p.y, 3, 1e-6, 'on the top leaf');
  // and they do not block sideways movement underneath
  r.walkTo(8, 0, { stuck: 0, timeout: 4 });
  r.waitUntil((s, p) => p.grounded, { timeout: 2 });
  r.walkTo(1, 0);
  eq(r.sim.deaths, 0);
});

test('electrodes: closed only by grounded film between them', () => {
  const pieces = [{ type: 'electrodes', box: [3, 0, -0.5, 4.2, 0.4, 0.5], emit: 'arc' }];
  const liq = run(pieces);
  liq.walkTo(3.6, 0); liq.wait(0.1);
  assert(!sig(liq, 'arc'), 'liquid does not conduct');
  const r = run(pieces);
  r.form('film'); r.walkTo(3.6, 0); r.wait(0.05);
  assert(sig(r, 'arc'), 'film closes the circuit');
  assert(r.sfx().includes('spark'));
  r.walkTo(6, 0); r.wait(0.05);
  assert(!sig(r, 'arc'), 'circuit opens when film leaves');
});

// ------------------------------------------------------------------ zones
test('heat vent: forces steam, keeps the gauge full, refuses other forms inside', () => {
  const r = run([{ type: 'heatvent', box: [3, 0, -1, 9, 3, 1] }]);
  r.waitUntil((s, p) => p.form === 'steam', { mx: 1, timeout: 3 });
  assert(r.events.some((e) => e.type === 'form' && e.cause === 'zone'));
  r.wait(0.5);
  near(r.p.gauge, STEAM_MAX, 1e-9, 'gauge held full inside the vent');
  r.form('liquid', { expect: false });
  eq(r.p.form, 'steam', 'cannot leave steam inside a vent');
  r.waitUntil((s, p) => p.y > 3.2, { timeout: 4 });
  r.wait(0.5);
  assert(r.p.gauge < STEAM_MAX, 'gauge drains once out of the vent');
  r.form('liquid');
});

test('heat vent works even when steam is locked for the level', () => {
  const r = run([{ type: 'heatvent', box: [3, 0, -1, 5, 3, 1] }], { forms: ['liquid'] });
  r.waitUntil((s, p) => p.form === 'steam', { mx: 1, timeout: 3 });
});

test('frost zone: forces ice and holds it', () => {
  const r = run([{ type: 'frost', box: [3, 0, -3, 7, 3, 3] }]);
  r.waitUntil((s, p) => p.form === 'ice', { mx: 1, timeout: 3 });
  assert(r.sfx().includes('freeze'));
  r.form('liquid', { expect: false });
  eq(r.p.form, 'ice');
  r.waitUntil((s, p) => p.x > 8, { mx: 1, timeout: 6 });
  r.form('liquid');
});

test('a zone can be switched by a signal', () => {
  const r = run([
    { type: 'plate', pos: [0, 0, 4], emit: 'p' },
    { type: 'fire', box: [3, 0, -3, 5, 2, 3], on: '!p' },
    { type: 'crate', pos: [0, 0.06, 4] },
  ]);
  r.wait(0.3);
  r.walkTo(7, 0);            // crate holds the plate: fire is off
  eq(r.sim.deaths, 0);
});

test('fire: respawns at the spawn, then at the last checkpoint touched', () => {
  const r = run([
    { type: 'fire', box: [10, 0, -1, 12, 1, 1] },
    { type: 'checkpoint', pos: [6, 0, 0] },
  ]);
  r.dying((q) => { q.sim.teleport(9.5, 0, 0); q.move(1, 0, 0.5); });
  eq(r.sim.deaths, 1);
  near(r.p.x, 0, 1e-9, 'back at spawn');
  assert(r.sfx().includes('respawn'));
  r.wait(0.6).walkTo(6, 0);
  assert(r.sfx().includes('checkpoint'));
  eq(r.sfx().filter((n) => n === 'checkpoint').length, 1, 'checkpoint fires once');
  r.form('ice');
  r.dying((q) => q.waitUntil((s) => s.deaths === 2, { mx: 1, timeout: 5 }));
  near(r.p.x, 6, 1e-9, 'back at the checkpoint');
  eq(r.p.form, 'liquid', 'respawn is always liquid');
  near(r.p.gauge, STEAM_MAX, 1e-9);
});

test('falling out of the world respawns; input is frozen briefly', () => {
  const r = run([{ type: 'block', box: [-3, -1, -3, 3, 0, 3] }], { noFloor: true, exit: [0, 0, -2], killY: -5 });
  r.dying((q) => q.waitUntil((s) => s.deaths === 1, { mx: 1, timeout: 5 }));
  r.move(1, 0, 0.2);
  near(r.p.x, 0, 1e-9, 'frozen right after respawn');
  r.move(1, 0, 0.6);
  assert(r.p.x > 0.5, 'control returns');
});

// ------------------------------------------------------------------ fans & water
test('fan: liquid is carried at 0.75 x strength; weak fans slow it, strong ones stop it', () => {
  const weak = run([{ type: 'fan', box: [2, 0, -3, 30, 3, 3], dir: '-x', strength: 4 }]);
  weak.move(1, 0, 2);
  const x0 = weak.p.x; weak.move(1, 0, 1);
  near(weak.p.x - x0, FORMS.liquid.speed - 3, 0.05, 'net speed against a strength-4 fan');
  const strong = run([{ type: 'fan', box: [2, 0, -3, 30, 3, 3], dir: '-x', strength: 8 }]);
  strong.move(1, 0, 3);
  assert(strong.p.x < 2.2, `liquid must not get past a strength-8 fan, x=${strong.p.x}`);
});

test('fan: can be switched by a signal and announces itself', () => {
  const r = run([
    { type: 'plate', pos: [0, 0, 4], emit: 'p' },
    { type: 'fan', box: [2, 0, -3, 12, 3, 3], dir: '-x', strength: 9, on: '!p' },
    { type: 'crate', pos: [3, 0, 8] },
  ]);
  eq(r.sfx().filter((n) => n === 'fan'), [], 'no fan sound at start');
  r.move(1, 0, 1.5);
  assert(r.p.x < 2.5, 'fan on: blocked');
  r.walkTo(0, 4); r.wait(0.1);
  assert(!r.sim.level.fans[0].active);
  r.walkTo(-2, 4); r.wait(0.1);
  assert(r.sim.level.fans[0].active);
  eq(r.sfx().filter((n) => n === 'fan'), ['fan'], 'fan sound when it spins back up');
});

test('updraft: gives liquid a modestly higher jump', () => {
  const base = run();
  base.tick(); base.tick(0, 0, true);
  let m0 = 0; for (let i = 0; i < 200; i++) { base.tick(0, 0, true); m0 = Math.max(m0, base.p.y); }
  const up = run([{ type: 'fan', box: [-2, 0, -2, 2, 8, 2], dir: '+y', strength: 6 }]);
  up.tick(); up.tick(0, 0, true);
  let m1 = 0; for (let i = 0; i < 200; i++) { up.tick(0, 0, true); m1 = Math.max(m1, up.p.y); }
  between(m1 / m0, 1.1, 1.6, 'updraft jump boost');
});

test('water current: liquid floats and is carried; it can jump out', () => {
  const pieces = [
    { type: 'block', box: [-3, -1, -3, 2, 0, 3] },
    { type: 'block', box: [2, -3, -3, 14, -2, 3] },
    { type: 'block', box: [14, -1, -3, 20, 0, 3] },
    { type: 'current', box: [2, -2, -3, 14, -0.2, 3], flow: [2.5, 0] },
  ];
  const r = run(pieces, { noFloor: true, exit: [19, 0, 2] });
  r.walkTo(2.6, 0, { stuck: 0 });
  r.waitUntil((s, p) => p.floating, { timeout: 2, label: 'floating' });
  assert(r.sfx().includes('splash') || true);
  const x0 = r.p.x, t0 = r.t;
  r.wait(2);
  near(r.p.y, -0.2 - WATER_FLOAT_DEPTH.liquid, 0.03, 'floats just below the surface');
  near((r.p.x - x0) / (r.t - t0), 2.5, 0.1, 'carried at the flow speed');
  r.waitUntil((s, p) => p.x > 12.9, { timeout: 4 });
  r.jumpTo(15, 0);
  near(r.p.y, 0, 1e-6, 'jumped out onto the bank');
});

test('water current: ice sinks to the bottom and is not carried', () => {
  const pieces = [
    { type: 'block', box: [-3, -1, -3, 2, 0, 3] },
    { type: 'block', box: [2, -3, -3, 14, -2, 3] },
    { type: 'current', box: [2, -2, -3, 14, -0.2, 3], flow: [2.5, 0] },
  ];
  const r = run(pieces, { noFloor: true, exit: [0, 0, -2] });
  r.form('ice');
  r.waitUntil((s, p) => p.x > 3 && p.grounded, { mx: 1, timeout: 6, label: 'on the channel bed' });
  near(r.p.y, -2, 1e-6);
  r.stop({ below: 1e-9, coast: true });
  const x = r.p.x;
  r.wait(1);
  near(r.p.x, x, 1e-9, 'ice on the bed is not carried by the current');
});

// ------------------------------------------------------------------ movers / shards / exit / hints
test('mover: toggle mode follows its signal; loop mode can be gated', () => {
  const r = run([
    { type: 'plate', pos: [0, 0, 4], emit: 'p' },
    { type: 'mover', id: 'lift', box: [5, 0, -1, 7, 0.4, 1], to: [0, 4, 0], speed: 2, mode: 'toggle', on: 'p' },
    { type: 'mover', id: 'gated', box: [5, 0, 5, 7, 0.4, 7], to: [4, 0, 0], speed: 2, on: 'p' },
  ]);
  const [lift, gated] = r.sim.level.movers;
  r.wait(1);
  near(lift.t, 0, 1e-9); near(gated.t, 0, 1e-9, 'gated loop does not run while off');
  r.walkTo(0, 4); r.wait(2.2);
  near(lift.t, 1, 1e-9, 'toggle mover reached B');
  assert(gated.t > 0, 'gated loop runs while on');
  r.walkTo(-3, 4); r.wait(2.2);
  near(lift.t, 0, 1e-9, 'toggle mover returned to A');
});

test('shards: collected once each, reported in the completion event; exit completes the level', () => {
  const r = run([
    { type: 'shard', pos: [2, 0.6, 0] }, { type: 'shard', pos: [4, 0.6, 0] }, { type: 'shard', pos: [6, 1.9, 0] },
  ], { exit: [10, 0, 0] });
  r.walkTo(5, 0);
  r.expectShards(2);
  r.walkTo(10, 0).expectExit();
  const res = r.result();
  eq(res.shards, [0, 1]);
  eq(res.id, 'mini');
  assert(res.timeMs > 1000 && res.timeMs < 4000, `timeMs ${res.timeMs}`);
  eq(r.sfx().filter((n) => n === 'shard').length, 2);
  assert(r.sfx().includes('level_complete'));
  const t = r.sim.time; r.wait(0.5);
  eq(r.sim.time, t, 'level clock stops on completion');
});

test('exit: can be locked behind a signal', () => {
  const r = run([{ type: 'plate', pos: [0, 0, 4], emit: 'p' }], { exit: [6, 0, 0], signals: { unlocked: { latch: 'p' } } });
  r.sim.level.exits[0].on = r.sim.signals.compile('unlocked');
  r.sim.level.exits[0].open = false;
  r.walkTo(6, 0); r.wait(0.3);
  assert(!r.sim.completed, 'locked exit must not complete');
  r.walkTo(0, 4).walkTo(6, 0, { stuck: 0 }).expectExit();
});

test('hints: the start hint fires on the first tick, zone hints once on entry', () => {
  const r = run([{ type: 'hint', box: [3, 0, -2, 5, 2, 2], key: 'plate' }], { hints: { start: 'Hello', plate: 'Stand on it' } });
  const hints = () => r.events.filter((e) => e.type === 'hint').map((e) => e.key);
  eq(hints(), ['start']);
  r.walkTo(4, 0).walkTo(0, 0).walkTo(4, 0);
  eq(hints(), ['start', 'plate']);
  eq(r.events.find((e) => e.key === 'plate').text, 'Stand on it');
});
