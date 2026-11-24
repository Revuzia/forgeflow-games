// Scripted solutions for f10 "Firedamp" (Fire, chapter 3). Gas: launches, blasts and chains.

import { O } from '../../src/levels/f10.js';

const by = (list, id) => list.find((q) => q.id === id);
const door = (s, id) => by(s.level.doors, id);
const gas = (s, id) => by(s.level.gases, id);
const wood = (s, id) => by(s.level.woods, id);
const form = (r, f) => { if (r.p.form !== f) r.form(f); return r; };
const P = (x) => O.pad + x, T = (x) => O.tank + x, V = (x) => O.valve + x, S = (x) => O.pipe + x;

/** Hold the stick toward (x, z) through the whole flight: wait to leave the ground, then to land. */
function flyTo(r, x, z, label, timeout = 5) {
  return r.waitUntil((s, p) => !p.grounded, { toward: [x, z], timeout: 2, label: `${label}: thrown` })
    .waitUntil((s, p) => p.grounded, { toward: [x, z], timeout, label });
}
/** As flyTo, but press the special (flare) at the top of the arc. */
function flareTo(r, x, z, label, timeout = 6) {
  return r.waitUntil((s, p) => !p.grounded, { toward: [x, z], timeout: 3, label: `${label}: thrown` })
    .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { toward: [x, z], timeout: 4, label: `${label}: top of the arc` })
    .special({ mx: 1 })
    .waitUntil((s, p) => p.grounded, { toward: [x, z], timeout, label });
}

/** Wait for pocket `id` to have gone off more than `n` times. */
function bang(r, id, timeout = 3, n = 0) {
  return r.waitUntil((s) => gas(s, id).blasts > n, { timeout, label: `${id} goes off` });
}

// ------------------------------------------------------------------ 1. the Gas Main
export function gasMain(r, all) {
  r.walkTo(3, 0).expect((s) => s.checkpoint.id === 'b1', 'first brazier');
  if (all) r.walkTo(6.4, -2.6).expectShards(1);
  r.walkTo(7.2, 0);
  form(r, 'spark').walkTo(10.2, 0, { stuck: 0 });
  bang(r, 'gasA');
  r.waitUntil((s, p) => p.grounded && p.y > 2, { timeout: 3, label: 'onto the shelf' })
    .expect((s, p) => Math.abs(p.y - 2.5) < 0.05 && p.x > 12.8, 'standing on the shelf')
    .walkTo(18, 0).expectSignal('lampA', true);
  form(r, 'ember').walkTo(27, 0)
    .waitUntil((s) => door(s, 'door1').open >= 1, { toward: [29.4, 0], timeout: 4, label: 'the first door is open' })
    .walkTo(32.4, -2.3).expect((s) => s.checkpoint.id === 'b1b', 'a brazier before the cracked wall');
  form(r, 'spark').walkTo(36.6, 0, { stuck: 0 });
  bang(r, 'gasB');
  r.wait(0.3).expect((s) => by(s.level.weakwalls, 'wall1').broken, 'the cracked wall is gone')
    .waitUntil((s, p) => p.grounded, { timeout: 2 })
    .walkTo(43, 0).walkTo(46.7, 0, { stuck: 0 });
  bang(r, 'gasC');
  r.wait(0.4).expect((s) => by(s.level.weakwalls, 'wall2').broken && gas(s, 'gasD').blasts === 1, 'the chain broke the far wall')
    .waitUntil((s, p) => p.grounded, { timeout: 2 });
  // the double throw: onto the low shelf (and its coal), then from the pocket on it up to the high shelf and its lantern
  form(r, 'ember').walkTo(56.4, -2.3).expect((s) => s.checkpoint.id === 'b1c', 'a brazier before the double throw');
  form(r, 'spark').walkTo(60.4, 0, { stuck: 0 });
  bang(r, 'gasE1');
  flyTo(r, 70, 0, 'onto the low shelf', 4)
    .expect((s, p) => Math.abs(p.y - 2.5) < 0.05 && p.x > 62.8, 'on the low shelf')
    .walkTo(70, 1.7).walkTo(76.9, 0, { stuck: 0 });
  bang(r, 'gasE2', 3);
  flyTo(r, 96, 0, 'onto the high shelf', 5)
    .expect((s, p) => Math.abs(p.y - 6.3) < 0.05, 'on the high shelf')
    .walkTo(96.8, 0).expectSignal('lampX', true).walkTo(90, 0).expect((s) => s.checkpoint.id === 'b1d', 'brazier on the high shelf');
  form(r, 'ember').walkTo(106, 0, { stuck: 0 })
    .waitUntil((s, p) => p.grounded && p.y < 0.1, { toward: [106, 0], timeout: 3, label: 'down from the high shelf' })
    .waitUntil((s) => door(s, 'doorX').open >= 1, { toward: [107.6, 0], timeout: 5, label: 'the high door is open' })
    .walkTo(O.pad + 0.5, 0);
}

// ------------------------------------------------------------------ 2. the Pressure Pad
export function pressurePad(r, all) {
  r.walkTo(P(3), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier')
    .walkTo(P(10), 0, { stuck: 0 });
  bang(r, 'padGasA');
  r.waitUntil((s, p) => p.y > 0.5, { timeout: 1, label: 'thrown' });
  flyTo(r, P(26), 0, 'across the chasm', 6)
    .expect((s, p) => p.x > P(18) && s.deaths === 0, 'over the chasm');
  r.walkTo(P(21), 0).expect((s) => s.checkpoint.id === 'b2b', 'brazier on the landing')
    .walkTo(P(26), 0, { stuck: 0 });
  bang(r, 'padGasB');
  flyTo(r, P(32), 0, 'onto the gantry')
    .expect((s, p) => Math.abs(p.y - 4) < 0.05, 'standing on the gantry')
    .walkTo(P(32), 0).expectSignal('lampB', true)
    .walkTo(P(34.6), 0).walkTo(P(35.4), 0, { stuck: 0 })
    .waitUntil((s, p) => p.grounded && p.y < 0.05, { toward: [P(35.4), 0], timeout: 3, label: 'down from the gantry' })
    .waitUntil((s) => door(s, 'door2').open >= 1, { toward: [P(35), 0], timeout: 4, label: 'the gantry gate is open' })
    .walkTo(P(39), 0).expect((s) => s.checkpoint.id === 'b2c', 'brazier past the gate')
    .walkTo(P(41), 0, { stuck: 0 });
  bang(r, 'padGasC');
  flyTo(r, P(56), 0, 'across the pool', 6)
    .expect((s, p) => p.x > P(49) && s.deaths === 0, 'over the pool');
  // two pads in a row: onto the raised slab, then over the chasm
  r.walkTo(P(54), 0, { stuck: 0 });
  bang(r, 'padGasE');
  flyTo(r, P(62), 0, 'onto the raised slab', 4)
    .expect((s, p) => Math.abs(p.y - 2.6) < 0.05, 'standing on the slab')
    .walkTo(P(64), 0, { stuck: 0 });
  bang(r, 'padGasF');
  flyTo(r, P(79), 0, 'over the second chasm', 6)
    .expect((s, p) => p.x > P(72.6) && Math.abs(p.y) < 0.05 && s.deaths === 0, 'across the second chasm')
    .walkTo(P(75.6), 0).expect((s) => s.checkpoint.id === 'b2d', 'brazier on the far side')
    .walkTo(O.tank + 0.5, 0);
}

// ------------------------------------------------------------------ 3. the Tank Farm
export function tankFarm(r, all) {
  r.walkTo(T(3), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  form(r, 'blaze').walkTo(T(7.6), 0)
    .waitUntil((s) => by(s.level.woods, 'planks').state === 2, { toward: [T(8), 0], timeout: 4, label: 'the planks are gone' })
    .walkTo(T(13), 0, { stuck: 0 });
  bang(r, 'gasG', 4);
  r.waitUntil((s, p) => p.y > 0.5, { timeout: 1, label: 'thrown' });
  (all ? flareTo(r, T(38), 0, 'across the chasm', 8) : flyTo(r, T(38), 0, 'across the chasm', 8))
    .expect((s, p) => p.x > T(29) && s.deaths === 0, 'over the chasm');
  if (all) r.expectShards(2);
  r.walkTo(T(32), 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier on the far side');
  form(r, 'blaze').walkTo(T(53.4), 0)
    .waitUntil((s) => by(s.level.pools, 'pool').steamT > 0, { mx: 1, timeout: 2, label: 'the pool boils' })
    .walkTo(T(60.6), 0, { slow: false }).jumpTo(T(63), 0, { tol: 0.5 })
    .expect((s, p) => p.x > T(62) && s.deaths === 0, 'across the boiled pool');
  r.walkTo(T(65), 0).expect((s) => s.checkpoint.id === 'b3c', 'brazier before the bridge');
  form(r, 'blaze').walkTo(T(77.7), 2.0)
    .waitUntil((s) => wood(s, 'rope').state > 0, { toward: [T(78), 2.3], timeout: 3, label: 'the rope is alight' })
    .waitUntil((s) => by(s.level.movers, 'bridge').t >= 1, { timeout: 5, label: 'the bridge is down' });
  form(r, 'ember').walkTo(T(92), 0).expect((s) => s.checkpoint.id === 'b3d', 'brazier past the bridge');
  // two more blaze tasks with one coal between: planks, then ice
  form(r, 'blaze').walkTo(T(95.6), 0)
    .waitUntil((s) => wood(s, 'planks2').state === 2, { toward: [T(96), 0], timeout: 4, label: 'the second planks are gone' })
    .walkTo(T(100), 2.3).walkTo(T(103.6), 0)
    .waitUntil((s) => by(s.level.iceblocks, 'ice3').gone, { toward: [T(104.3), 0], timeout: 4, label: 'the ice is gone' });
  form(r, 'ember').walkTo(T(108), 0).expect((s) => s.checkpoint.id === 'b3e', 'brazier past the ice')
    .walkTo(O.valve + 0.5, 0);
}

// ------------------------------------------------------------------ 4. the Relief Valve
export function reliefValve(r, all) {
  r.walkTo(V(3), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier')
    .walkTo(V(10), 0, { stuck: 0 });
  bang(r, 'gasL');
  flyTo(r, V(18), 0, 'onto the first rung')
    .expect((s, p) => Math.abs(p.y - 3.2) < 0.05, 'standing on rung one')
    .walkTo(V(16), 0).expect((s) => s.checkpoint.id === 'b4a', 'brazier on rung one');
  form(r, 'spark').walkTo(V(19.4), 3.2 * 0, { stuck: 0 });
  bang(r, 'gasS', 3);
  flyTo(r, V(34), 0, 'onto the second rung', 6)
    .expect((s, p) => Math.abs(p.y - 7) < 0.05, 'standing on rung two')
    .walkTo(V(32), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier on rung two');
  form(r, 'blaze').walkTo(V(42), 0, { stuck: 0 });
  bang(r, 'gasV', 3);
  flyTo(r, V(58), 0, 'onto the top', 8)
    .expect((s, p) => Math.abs(p.y - 10.8) < 0.05, 'standing on the top rung')
    .walkTo(V(55), 0).expect((s) => s.checkpoint.id === 'b4c', 'brazier on top');
  // boarded up and walled with ice: stand at the brazier to fill the gauge, then burn the boards and melt the wall as a blaze
  form(r, 'blaze').walkTo(V(62.6), 0)
    .waitUntil((s) => wood(s, 'planks3').state === 2, { toward: [V(63), 0], timeout: 4, label: 'the boards are gone' })
    .walkTo(V(66), 0)
    .waitUntil((s) => by(s.level.iceblocks, 'ice4').gone, { toward: [V(66.8), 0], timeout: 4, label: 'the ice is gone' });
  form(r, 'ember').walkTo(O.pipe + 0.5, 0);
}

// ------------------------------------------------------------------ 5. the Standpipe
export function standpipe(r, all) {
  r.walkTo(S(3), 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  if (all) {
    // a blaze is thrown from the same pocket, floats high, flares at the top of the arc and takes the stone
    form(r, 'blaze').walkTo(S(9), 0, { stuck: 0 });
    bang(r, 'gasR1', 4);
    flareTo(r, S(26), 0, 'onto the first gantry', 6)
      .expectShards(3);
    r.walkTo(S(30), 0);
    form(r, 'spark');
  } else {
    form(r, 'spark').walkTo(S(8.8), 0, { stuck: 0 });
    bang(r, 'gasR1');
    flyTo(r, S(26), 0, 'onto the first gantry', 4);
  }
  r.expect((s, p) => Math.abs(p.y - 16) < 0.05, 'standing on the first gantry')
    .walkTo(S(30), 0).expect((s) => s.checkpoint.id === 'b5b', 'brazier on the first gantry')
    .walkTo(S(33), 0, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [S(33), 0], timeout: 3, label: 'onto the coaster wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 12, label: 'the long ride' });
  bang(r, 'gasR2', 3);
  flyTo(r, S(80), 0, 'onto the top', 6)
    .expect((s, p) => Math.abs(p.y - 31) < 0.05, 'on the top platform')
    .walkTo(S(70), 0).expect((s) => s.checkpoint.id === 'b5d', 'brazier on top')
    .walkTo(S(82.6), 0, { stuck: 0 });
  bang(r, 'gasR3', 3);
  flyTo(r, S(104), 0, 'onto the last platform', 6)
    .expect((s, p) => Math.abs(p.y - 34.8) < 0.05, 'on the last platform')
    .walkTo(S(96), 0).expect((s) => s.checkpoint.id === 'b5e', 'brazier on the last platform')
    .walkTo(S(106.4), 0).expectExit();
}

export const parts = [gasMain, pressurePad, tankFarm, reliefValve, standpipe];
export function solve(r) { for (const f of parts) f(r, false); }
export function solveAll(r) { for (const f of parts) f(r, true); }
