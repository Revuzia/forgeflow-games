// Keyboard solution for f11 "Slow Match": W/A/S/D, Space, 1-4 (ember, blaze, smoke, spark) and human timing only
// (tests/lib/keyboard.js). Camera never turns (camYaw -90: W is +x, D is +z).
// Fuses are timers: the script lights one, goes where it has to be, and waits for the flame, as a person does.
import { O } from '../../src/levels/f11.js';
import { by, leap, go, touch, hop, form, section, sitOn } from './fire-moves.js';

const door = (s, id) => by(s.level.doors, id);
const gas = (s, id) => by(s.level.gases, id);
const fuse = (s, id) => by(s.level.fuses, id);
const H = (x) => O.shutter + x, Y = (x) => O.sync + x, C = (x) => O.count + x, M = (x) => O.mouth + x;
const spark = (k) => form(k, 'spark');
const ember = (k) => form(k, 'ember');
const blaze = (k) => form(k, 'blaze');
/** Walk onto a lump of coal at (x, z) and look whether it was taken; step closer if not. */
function grab(k, x, z, tol = 0.45) {
  const taken = (s) => { const c = s.level.coals.find((q) => Math.hypot(q.pos[0] - x, q.pos[2] - z) < 0.3); return !c || c.taken || k.p.gauge >= 9.9; };
  return touch(k, x, z, taken, { tol, tries: 4, label: `the coal at ${x}` });
}
const ground = (k, label, timeout = 8) => k.until((s, p) => p.grounded && p.y > -0.5, { timeout, label }).settle();

/** Get a spark onto the post of a wire (the ride begins) and wait for the ride to end. */
function rideFrom(k, x, z, label) {
  sitOn(k, x, z, (s, p) => p.ride || p.x > x + 2.5, { label: `${label}: onto the wire` });          // (a short ride may be over by the time it is looked at)
  return k.until((s, p) => !p.ride, { timeout: 10, label: `${label}: arrives` });
}

// ------------------------------------------------------------------ 1. the Match Room
function matchRoom(k) {
  go(k, 3, 0).expect((s) => s.checkpoint.id === 'b1', 'first brazier');
  touch(k, 11.5, 2.4, (s) => fuse(s, 'fuseA').state >= 1, { label: 'the match is lit' });
  sitOn(k, 22, 0, (s, p) => gas(s, 'gasA').blasts > 0 || (p.x > 21.2 && p.x < 22.8 && Math.abs(p.z) < 0.7), { tries: 5, label: 'in the pocket' });
  k.until((s) => gas(s, 'gasA').blasts > 0, { timeout: 8, label: 'the flame arrives' });
  ground(k, 'across the chasm', 8);
  k.expect((s, p) => p.x > 31 && s.deaths === (k.retries || 0), 'over the chasm');
  go(k, 34, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier on the far side');
  touch(k, 36.2, -2.6, (s) => fuse(s, 'fuseB').state >= 1, { label: 'the second match is lit' });
  sitOn(k, 46, 0, (s, p) => gas(s, 'gasB').blasts > 0 || (p.x > 45.2 && p.x < 46.8 && Math.abs(p.z) < 0.7), { tries: 5, label: 'in the second pocket' });
  k.until((s) => gas(s, 'gasB').blasts > 0, { timeout: 8, label: 'the second flame arrives' });
  ground(k, 'across the pool', 8);
  k.expect((s, p) => p.x > 55 && s.deaths === (k.retries || 0), 'over the pool');
  go(k, O.shutter + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 2. the Shutter Run
function shutterRun(k) {
  go(k, H(3), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  touch(k, H(8), -2.6, (s) => fuse(s, 'fuseC').state >= 1, { label: 'the shutter fuse is lit' });     // an ember lights it: keep the spark for the wires
  go(k, H(9.4), 0, 0.8, { order: 'zx', fine: 0 });
  spark(k);
  rideFrom(k, H(11), 0, 'first wire');
  go(k, H(21.6), 0, 0.8, { fine: 0 });
  rideFrom(k, H(23), 0, 'second wire');
  go(k, H(33.6), 0, 0.8, { fine: 0 });
  rideFrom(k, H(35), 0, 'third wire');
  go(k, H(48), 0, 0.8, { fine: 0 });
  k.until((s) => door(s, 'shutter').open >= 1, { timeout: 8, label: 'the shutter opens' });
  go(k, H(52), 0, 0.8, { fine: 0 });
  k.expect((s) => s.deaths === (k.retries || 0), 'through the shutter');
  ember(k);
  go(k, O.sync + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 3. the Sync Hall
function syncHall(k) {
  go(k, Y(3), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  touch(k, Y(8), -2.8, (s) => fuse(s, 'f1').state >= 1, { label: 'the long fuse is lit' });
  // the middle fuse goes in when the long one has 4.2 s on it, the short one when it has 8.3 s
  go(k, Y(18.6), -0.4, 1.0, { order: 'xz' });
  k.until((s) => fuse(s, 'f1').d >= 4.2 * 2.4, { timeout: 10, label: 'long fuse: 4.2 s' });
  touch(k, Y(20), 0.2, (s) => fuse(s, 'f2').state >= 1, { label: 'the middle fuse is lit' });
  go(k, Y(30.6), 2.8, 1.0, { order: 'zx' });
  k.until((s) => fuse(s, 'f1').d >= 8.3 * 2.4, { timeout: 10, label: 'long fuse: 8.3 s' });
  touch(k, Y(32), 3.0, (s) => fuse(s, 'f3').state >= 1, { label: 'the short fuse is lit' });
  go(k, Y(45), 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'furnace').open >= 1, { timeout: 14, label: 'the furnace opens' });
  go(k, Y(52), 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier past the furnace');
  go(k, O.count + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 4. the Countdown
const B = (x) => C(x + 38);                                     // the stretch after the sensor door is shifted 38 m
function countdown(k) {
  go(k, C(3), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier');
  // lantern one: a hop onto the ledge
  go(k, C(15.6), 2.6, 1.0, { order: 'zx' });
  hop(k, 'W', { run: 0.15, hold: 0.3 });
  k.expectSignal('lampE', true);
  go(k, C(24), 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'doorE').open >= 1, { timeout: 4, label: 'door one' });
  go(k, C(33), 0).expect((s) => s.checkpoint.id === 'b4a', 'brazier before the alcove');
  // lantern two: a spark through the pinhole (0.45 m wide)
  spark(k);
  go(k, C(37.3), 0.7, 0.5, { fine: 0 });
  k.hold('D', { until: (s, p) => p.z > 1.2, timeout: 3, label: 'up to the partition' });
  k.hold('W D', { until: (s, p) => p.x > C(38.4), timeout: 3, label: 'along the partition to the stop' });
  k.hold('D', { until: (s, p) => p.z > 2.2, timeout: 3, label: 'through the pinhole' }).release();
  k.expect((s, p) => p.z > 2.0, 'through the pinhole');
  k.hold('D', { until: (s, p) => p.z > 3.3, timeout: 3, label: 'along the far wall of the alcove' });
  k.hold('W', { until: (s, p) => s.signals.get('lampS') || p.x > C(40.6), timeout: 3, label: 'along the wall to the lantern' });
  k.expectSignal('lampS', true);
  k.hold('A', { until: (s, p) => p.z < 2.2, timeout: 3, label: 'up to the partition' });
  k.hold('S', { until: (s, p) => p.x < C(38.6), timeout: 3, label: 'along the inside of the partition to the stop' });
  k.hold('A', { until: (s, p) => p.z < 0.7, timeout: 3, label: 'back out through the pinhole' }).release();
  ember(k);
  go(k, C(49.4), 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'doorS').open >= 1, { timeout: 4, label: 'door two' });
  go(k, C(56), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier before the planks');
  touch(k, C(57.9), -3.1, (s) => fuse(s, 'fuseE').state >= 1, { label: 'the long match is lit' });
  // lantern three: a blaze burns the planks
  go(k, C(64.4), 0, 0.8);
  blaze(k);
  k.hold('W', { until: (s) => by(s.level.woods, 'planks').state > 0, timeout: 6, label: 'the planks catch' }).release();
  k.until((s) => by(s.level.woods, 'planks').state === 2, { timeout: 5, label: 'planks gone' });
  ember(k);                                                               // an ember lights a lantern as well as a blaze: save the flame
  touch(k, C(71.6), 1.0, (s) => s.signals.get('lampB'), { label: 'lantern three' });
  go(k, C(79.4), 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'doorB').open >= 1, { timeout: 4, label: 'door three' });
  go(k, C(86), 0).expect((s) => s.checkpoint.id === 'b4c', 'brazier before the crawlspace');
  // lantern four: a spark crawls under the long shelf
  spark(k);
  grab(k, C(91.6), 1.0);                                                  // a lump of coal on the way
  go(k, C(92.6), 1.0, 0.8, { fine: 0 });
  go(k, C(94.6), 3.0, 0.8, { fine: 0, order: 'zx' });
  k.hold('W', { until: (s) => s.signals.get('lampT') || false, timeout: 4, label: 'under the shelf to the lantern' }).release();
  k.expectSignal('lampT', true);
  k.hold('S', { until: (s, p) => p.x < C(94), timeout: 4, label: 'back out from under the shelf' }).release();
  for (let i = 0; i < 4 && k.p.form === 'spark'; i++) {                  // an ember needs room (a lamp stands by the shelf): step away from it and look again
    try { ember(k); } catch (e) { if (i === 3 || k.sim.deaths) throw e; k.tap('A', 0.15); k.wait(0.1); }
  }
  go(k, C(111.4), 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'doorT').open >= 1, { timeout: 4, label: 'door four' });
  go(k, C(114), -2.4, 0.6, { order: 'xz' }).expect((s) => s.checkpoint.id === 'b4e', 'brazier before the sensor');
  // the sensor door: a flame on the plate, for good
  blaze(k);
  go(k, C(118.5), 0, 0.8, { order: 'zx' });
  k.until((s) => s.signals.get('openD'), { timeout: 4, label: 'the sensor latches' });
  ember(k);                                                               // the sensor keeps its answer: save the flame for the pool
  go(k, C(123.4), 0, 0.8, { fine: 0 });
  k.until((s) => door(s, 'doorD').open >= 1, { timeout: 4, label: 'door five' });
  go(k, C(130), 0, 1.0);
  // the pool: a blaze boils it, wades across and climbs out
  go(k, B(93.2), 0, 0.8);
  blaze(k);
  k.hold('W', { until: (s) => by(s.level.pools, 'poolB').steamT > 0, timeout: 4, label: 'the pool boils' });
  k.hold('W', { until: (s, p) => p.x > B(103), timeout: 6 });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > B(105) && p.grounded, timeout: 3, label: 'out of the basin' }).release().settle();
  k.expect((s, p) => p.x > B(104) && s.deaths === (k.retries || 0), 'across the boiled pool');
  ember(k);
  go(k, B(108), 0).expect((s) => s.checkpoint.id === 'b4d', 'brazier before the rail');
  // the rail: a spark rides over the chasm
  spark(k);
  go(k, B(121.4), 0, 0.8, { fine: 0 });
  rideFrom(k, B(124.4), 0, 'the long rail');
  k.expect((s, p) => p.x > B(135) && s.deaths === (k.retries || 0), 'across the chasm');
  ember(k);
  go(k, B(142.0), 0, 0.8, { order: 'zx' });
  k.until((s) => gas(s, 'cannon').blasts > 0, { timeout: 80, label: 'the flame reaches the cannon' });
  k.until((s, p) => !p.grounded || s.completed, { timeout: 2, label: 'thrown' });
  ground(k, 'over the last chasm', 10);
  k.expect((s, p) => p.x > O.mouth && s.deaths === (k.retries || 0), 'across the chasm');
  go(k, O.mouth + 0.6, 0, 1.0);
}

// ------------------------------------------------------------------ 5. the Kiln Mouth
function kilnMouth(k) {
  go(k, M(3), 0).expect((s) => s.checkpoint.id === 'b5', 'the last brazier');
  touch(k, M(6), -2.6, (s) => fuse(s, 'fuseF').state >= 1, { label: 'the kiln fuse is lit' });     // an ember lights it as well as a spark
  spark(k);
  go(k, M(24), 0.4, 0.8, { fine: 0, order: 'zx' });                       // a lump of coal on the way
  go(k, M(31.4), 0, 0.8, { fine: 0 });
  rideFrom(k, M(34.4), 0, 'over the pool');
  k.hold('W', { until: (s) => s.completed, timeout: 6, label: 'in through the kiln door' });
  k.expectExit();
}

export const DRY_LESSON = false;
export function solve(k) {
  matchRoom(k);
  shutterRun(k);
  syncHall(k);
  countdown(k);
  kilnMouth(k);
}
