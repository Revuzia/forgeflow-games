// Keyboard solution for f10 "Firedamp": W/A/S/D, Space, 1-4 (ember, blaze, smoke, spark; the blaze key again in the air:
// flare) and human timing only (tests/lib/keyboard.js). Camera never turns (camYaw -90: W is +x, D is +z).
// The launches throw Cinder in a fixed arc: the keys hardly matter in the air, so a person stands (or runs) into the
// pocket, lets go, and watches where it lands.
import { O } from '../../src/levels/f10.js';
import { by, leap, go, touch, hop, form, section, sitOn } from './fire-moves.js';

const door = (s, id) => by(s.level.doors, id);
const gas = (s, id) => by(s.level.gases, id);
const wood = (s, id) => by(s.level.woods, id);
const P = (x) => O.pad + x, T = (x) => O.tank + x, V = (x) => O.valve + x, S = (x) => O.pipe + x;
const spark = (k) => form(k, 'spark');
const ember = (k) => form(k, 'ember');
const blaze = (k) => form(k, 'blaze');

/** Run a spark (W held) into a pocket and let go once it has gone off; then ride the arc to the ground. */
function sparkInto(k, id, x0) {
  const n = gas(k.sim, id).blasts;
  go(k, x0 - 3.4, 0, 0.8, { fine: 0 });                                    // a few metres short of the pocket: it goes off the moment a spark touches it
  k.hold('W', { until: (s) => gas(s, id).blasts > n, timeout: 4, label: `${id} goes off` }).release();
  return k.wait(0.2);                                                       // the blast has thrown it (or, for the wall pocket, shaken it)
}
/** Stand on a plate in a pocket and wait for the (delayed) blast: ride the arc to the ground. */
function padThrow(k, id, x, z = 0) {
  const n = gas(k.sim, id).blasts;
  go(k, x, z, 0.75, { fine: 0 });                                          // the plate is 1.6 m: standing on it is enough, and no more taps
  return k.until((s) => gas(s, id).blasts > n, { timeout: 5, label: `${id} goes off` });
}
const ground = (k, label, timeout = 8) => k.until((s, p) => p.grounded && p.y > -0.5, { timeout, label }).settle();
/** A throw that is not far enough on its own: leave the ground, hold W through the flight, let go on landing. */
function flyOn(k, label, timeout = 8) {
  k.until((s, p) => !p.grounded, { timeout: 3, label: 'thrown' });
  k.hold('W', { until: (s, p) => p.grounded && p.y > -0.5, timeout, label });
  return k.release().settle();
}

// ------------------------------------------------------------------ 1. the Gas Main
function gasMain(k) {
  go(k, 3, 0).expect((s) => s.checkpoint.id === 'b1', 'first brazier');
  spark(k);
  sparkInto(k, 'gasA', 9.2);
  ground(k, 'onto the shelf');
  k.expect((s, p) => Math.abs(p.y - 2.5) < 0.1 && p.x > 12.8, 'standing on the shelf');
  ember(k);                                                               // a spark burns heat: be a coal for the walking
  go(k, 18, 0, 0.8);
  k.expectSignal('lampA', true);
  go(k, 27, 0, 1.0);
  k.hold('W', { until: (s, p) => p.grounded && p.y < 0.1 && p.x > 26.6, timeout: 4, label: 'off the shelf' }).release().settle();
  k.until((s) => door(s, 'door1').open >= 1, { timeout: 6, label: 'the first door is open' });
  go(k, 32.4, -2.4, 1.0).expect((s) => s.checkpoint.id === 'b1b', 'a brazier before the cracked wall');
  spark(k);
  sparkInto(k, 'gasB', 36);
  k.wait(0.3).expect((s) => by(s.level.weakwalls, 'wall1').broken, 'the cracked wall is gone');
  k.until((s, p) => p.grounded, { timeout: 3 }).settle();
  go(k, 43, 0, 1.0);
  sparkInto(k, 'gasC', 46);
  k.wait(0.4).expect((s) => by(s.level.weakwalls, 'wall2').broken && gas(s, 'gasD').blasts === 1, 'the chain broke the far wall');
  k.until((s, p) => p.grounded, { timeout: 3 }).settle();
  // the double throw: onto the low shelf, then from the pocket on it up to the high shelf and its lantern
  ember(k);
  go(k, 56.4, -2.4, 1.0).expect((s) => s.checkpoint.id === 'b1c', 'a brazier before the double throw');
  spark(k);
  sparkInto(k, 'gasE1', 59.2);
  ground(k, 'onto the low shelf');
  k.expect((s, p) => Math.abs(p.y - 2.5) < 0.1 && p.x > 62.8, 'on the low shelf');
  ember(k);
  go(k, 70, 1.7, 0.8);                                                    // the coal
  spark(k);
  sparkInto(k, 'gasE2', 76);
  ground(k, 'onto the high shelf');
  k.expect((s, p) => Math.abs(p.y - 6.3) < 0.1, 'on the high shelf');
  ember(k);
  go(k, 96.8, 0, 0.8);
  k.expectSignal('lampX', true);
  go(k, 90, 0, 1.0).expect((s) => s.checkpoint.id === 'b1d', 'brazier on the high shelf');
  ember(k);
  go(k, 100, 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > 106 && p.grounded && p.y < 0.1, timeout: 6, label: 'down from the high shelf' }).release().settle();
  k.until((s) => door(s, 'doorX').open >= 1, { timeout: 8, label: 'the high door is open' });
  go(k, O.pad + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 2. the Pressure Pad
function pressurePad(k) {
  go(k, P(3), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  padThrow(k, 'padGasA', P(10));
  ground(k, 'across the chasm');
  k.expect((s, p) => p.x > P(18) && s.deaths === (k.retries || 0), 'over the chasm');
  go(k, P(21), 0).expect((s) => s.checkpoint.id === 'b2b', 'brazier on the landing');
  padThrow(k, 'padGasB', P(26));
  ground(k, 'onto the gantry');
  k.expect((s, p) => Math.abs(p.y - 4) < 0.1, 'standing on the gantry');
  go(k, P(32), 0, 0.8);
  k.expectSignal('lampB', true);
  k.until((s) => door(s, 'door2').open >= 1, { timeout: 6, label: 'the gantry gate is open' });
  go(k, P(37.2), 0, 0.6, { fine: 0 });                                     // off the end of the gantry and down, stopping short of the pad beyond the gate
  k.until((s, p) => p.grounded && p.y < 0.1, { timeout: 3, label: 'down from the gantry' }).settle();
  go(k, P(39), 0, 0.8).expect((s) => s.checkpoint.id === 'b2c', 'brazier past the gate');
  padThrow(k, 'padGasC', P(41));
  ground(k, 'across the pool');
  k.expect((s, p) => p.x > P(49) && s.deaths === (k.retries || 0), 'over the pool');
  // two pads in a row: onto the raised slab, then over the chasm
  padThrow(k, 'padGasE', P(54));
  ground(k, 'onto the raised slab');
  k.expect((s, p) => Math.abs(p.y - 2.6) < 0.1, 'standing on the slab');
  padThrow(k, 'padGasF', P(64));
  ground(k, 'over the second chasm');
  k.expect((s, p) => p.x > P(72.6) && Math.abs(p.y) < 0.1 && s.deaths === (k.retries || 0), 'across the second chasm');
  go(k, P(75.6), 0).expect((s) => s.checkpoint.id === 'b2d', 'brazier on the far side');
  go(k, O.tank + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 3. the Tank Farm
function tankFarm(k) {
  go(k, T(3), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  go(k, T(6.8), 0, 0.8);
  blaze(k);
  k.hold('W', { until: (s) => wood(s, 'planks').state > 0, timeout: 6, label: 'the planks catch' }).release();
  k.until((s) => wood(s, 'planks').state === 2, { timeout: 5, label: 'the planks are gone' });
  // the flame stands in the sensor, which sets the pocket off after a moment: thrown across the chasm
  const n = gas(k.sim, 'gasG').blasts;
  sitOn(k, T(13), 0, (s) => gas(s, 'gasG').blasts > n || s.signals.get('hotG'), { label: 'the flame is in the sensor' });
  k.until((s) => gas(s, 'gasG').blasts > n, { timeout: 5, label: 'gasG goes off' });
  ground(k, 'over the chasm', 10);
  k.expect((s, p) => p.x > T(29) && s.deaths === (k.retries || 0), 'over the chasm');
  go(k, T(32), 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier on the far side');
  ember(k);                                                               // walk to the water as a coal: the blaze is for the pool
  go(k, T(52.4), 0, 0.8);
  blaze(k);
  k.hold('W', { until: (s) => by(s.level.pools, 'pool').steamT > 0, timeout: 4, label: 'the pool boils' });
  k.hold('W', { until: (s, p) => p.x > T(61.0), timeout: 6, label: 'wades across the boiled pool' });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > T(63) && p.grounded, timeout: 3, label: 'out of the basin' }).release().settle();
  k.expect((s, p) => p.x > T(62) && s.deaths === (k.retries || 0), 'across the boiled pool');
  go(k, T(65), 0).expect((s) => s.checkpoint.id === 'b3c', 'brazier before the bridge');
  go(k, T(76.4), 2.3, 0.8);
  blaze(k);
  touch(k, T(78.0), 2.3, (s) => wood(s, 'rope').state > 0, { label: 'the rope is alight', tries: 5 });
  k.until((s) => by(s.level.movers, 'bridge').t >= 1, { timeout: 8, label: 'the bridge is down' });
  ember(k);
  go(k, T(79), 0, 0.8, { order: 'zx' });
  k.hold('W', { until: (s, p) => p.x > T(90.4), timeout: 6, label: 'over the bridge' }).release().settle();
  go(k, T(92), 0).expect((s) => s.checkpoint.id === 'b3d', 'brazier past the bridge');
  // two more blaze tasks with one coal between: planks, then ice
  blaze(k);
  go(k, T(94.8), 0, 0.8);
  k.hold('W', { until: (s) => wood(s, 'planks2').state > 0, timeout: 6, label: 'the second planks catch' }).release();
  k.until((s) => wood(s, 'planks2').state === 2, { timeout: 5, label: 'the second planks are gone' });
  go(k, T(100), 2.6, 0.8);                                                // the coal
  go(k, T(102.8), 0, 0.8, { order: 'zx' });
  k.hold('W', { until: (s) => by(s.level.iceblocks, 'ice3').t > 0 || by(s.level.iceblocks, 'ice3').gone, timeout: 6, label: 'touches the ice' }).release();
  k.until((s) => by(s.level.iceblocks, 'ice3').gone, { timeout: 8, label: 'the ice is gone' });
  ember(k);
  go(k, T(108), 0).expect((s) => s.checkpoint.id === 'b3e', 'brazier past the ice');
  go(k, O.valve + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 4. the Relief Valve
function reliefValve(k) {
  go(k, V(3), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier');
  padThrow(k, 'gasL', V(10));
  ground(k, 'onto the first rung');
  k.expect((s, p) => Math.abs(p.y - 3.2) < 0.1, 'standing on rung one');
  go(k, V(16), 0).expect((s) => s.checkpoint.id === 'b4a', 'brazier on rung one');
  spark(k);
  const n = gas(k.sim, 'gasS').blasts;
  go(k, V(17.4), 0, 0.8);
  sitOn(k, V(19.4), 0, (s) => s.signals.get('s1') || gas(s, 'gasS').blasts > n, { label: 'the spark sits on the socket' });
  k.until((s) => gas(s, 'gasS').blasts > n, { timeout: 5, label: 'gasS goes off' });
  ground(k, 'onto the second rung', 10);
  k.expect((s, p) => Math.abs(p.y - 7) < 0.1, 'standing on rung two');
  go(k, V(32), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier on rung two');
  blaze(k);
  const m = gas(k.sim, 'gasV').blasts;
  go(k, V(42), 0, 0.8);
  k.until((s) => gas(s, 'gasV').blasts > m, { timeout: 5, label: 'gasV goes off' });
  ground(k, 'onto the top rung', 12);
  k.expect((s, p) => Math.abs(p.y - 10.8) < 0.1, 'standing on the top rung');
  go(k, V(55), 0).expect((s) => s.checkpoint.id === 'b4c', 'brazier on top');
  // boarded up and walled with ice: the brazier fills the gauge, then burn the boards and melt the wall
  blaze(k);
  go(k, V(62.0), 0, 0.8);
  k.hold('W', { until: (s) => wood(s, 'planks3').state > 0, timeout: 6, label: 'the boards catch' }).release();
  k.until((s) => wood(s, 'planks3').state === 2, { timeout: 5, label: 'the boards are gone' });
  go(k, V(65.4), 0, 0.8);
  k.hold('W', { until: (s) => by(s.level.iceblocks, 'ice4').t > 0 || by(s.level.iceblocks, 'ice4').gone, timeout: 6, label: 'touches the ice' }).release();
  k.until((s) => by(s.level.iceblocks, 'ice4').gone, { timeout: 8, label: 'the ice is gone' });
  ember(k);
  go(k, O.pipe + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 5. the Standpipe
function standpipe(k) {
  go(k, S(3), 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  spark(k);
  sparkInto(k, 'gasR1', S(8));
  ground(k, 'onto the first gantry', 12);
  k.expect((s, p) => Math.abs(p.y - 16) < 0.1, 'standing on the first gantry');
  ember(k);
  go(k, S(30), 0).expect((s) => s.checkpoint.id === 'b5b', 'brazier on the first gantry');
  spark(k);
  go(k, S(31.0), 0, 0.8);
  sitOn(k, S(33), 0, (s, p) => p.ride, { label: 'onto the coaster wire' });
  k.until((s, p) => !p.ride, { timeout: 14, label: 'the long ride' });
  k.until((s) => gas(s, 'gasR2').blasts > 0, { timeout: 4, label: 'gasR2 goes off' });
  flyOn(k, 'onto the top platform', 12);
  k.expect((s, p) => Math.abs(p.y - 31) < 0.1, 'on the top platform');
  ember(k);
  go(k, S(70), 0).expect((s) => s.checkpoint.id === 'b5d', 'brazier on top');
  spark(k);
  sparkInto(k, 'gasR3', S(82));
  flyOn(k, 'onto the last platform', 12);
  k.expect((s, p) => Math.abs(p.y - 34.8) < 0.1, 'on the last platform');
  if (!k.sim.completed) {                                                 // the last throw can carry a spark right onto the door
    ember(k);
    if (!k.sim.completed) {
      go(k, S(96), 0).expect((s) => s.checkpoint.id === 'b5e', 'brazier on the last platform');
      go(k, S(106.4), 0, 0.8, { fine: 0 });
    }
  }
  k.expectExit();
}

export function solve(k) {
  gasMain(k);
  pressurePad(k);
  tankFarm(k);
  reliefValve(k);
  standpipe(k);
}
