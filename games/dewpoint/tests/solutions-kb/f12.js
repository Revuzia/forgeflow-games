// Keyboard solution for f12 "The Great Chimney": W/A/S/D, Space, 1-4 (ember, blaze, smoke, spark) and human timing only
// (tests/lib/keyboard.js). Camera never turns (camYaw -90: W is +x, D is +z). Every form of the campaign is needed.
import { O } from '../../src/levels/f12.js';
import { by, leap, go, touch, hop, form, section, sitOn, afterDrop } from './fire-moves.js';

const door = (s, id) => by(s.level.doors, id);
const gas = (s, id) => by(s.level.gases, id);
const wood = (s, id) => by(s.level.woods, id);
const ice = (s, id) => by(s.level.iceblocks, id);
const W = (x) => O.wire + x, F = (x) => O.flue + x, C = (x) => O.cold + x, G = (x) => O.gas + x, K = (x) => O.chim + x;
const spark = (k) => form(k, 'spark');
const ember = (k) => form(k, 'ember');
const blaze = (k) => form(k, 'blaze');
const smoke = (k) => form(k, 'smoke');

/** Walk into wood as a blaze until it catches, stand still until it is gone. */
function burn(k, id, label) {
  k.hold('W', { until: (s) => wood(s, id).state > 0, timeout: 6, label: `${label} catches` }).release();
  return k.until((s) => wood(s, id).state === 2, { timeout: 6, label: `${label} is gone` });
}
/** The same for ice. */
function melt(k, id, label) {
  k.hold('W', { until: (s) => ice(s, id).t > 0 || ice(s, id).gone, timeout: 6, label: `touches ${label}` }).release();
  return k.until((s) => ice(s, id).gone, { timeout: 10, label: `${label} is gone` });
}

// ------------------------------------------------------------------ 1. the Stokehole
function stokehole(k) {
  go(k, 3, 0).expect((s) => s.checkpoint.id === 'b1', 'first brazier');
  go(k, 11.0, 0, 0.8);
  blaze(k);
  burn(k, 'planks', 'the planks');
  go(k, 17, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier before the beam');
  ember(k);
  go(k, 22, 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > 27.5, timeout: 5, label: 'under the beam' }).release().settle();
  go(k, 32, 0).expect((s) => s.checkpoint.id === 'b1c', 'brazier before the ice');
  blaze(k);
  go(k, 39.0, 0, 0.8);
  melt(k, 'ice', 'the ice');
  go(k, 46, 0, 0.8).expect((s) => s.checkpoint.id === 'b1d', 'brazier before the pool');
  go(k, 52.6, 0, 0.8);
  k.hold('W', { until: (s) => by(s.level.pools, 'pool').steamT > 0, timeout: 4, label: 'the pool boils' });
  k.hold('W', { until: (s, p) => p.x > 61.0, timeout: 6 });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > 63 && p.grounded, timeout: 3, label: 'out of the basin' }).release().settle();
  k.expect((s, p) => p.x > 62 && s.deaths === (k.retries || 0), 'across the boiled pool');
  ember(k);
  go(k, 66, 0).expect((s) => s.checkpoint.id === 'b1e', 'brazier past the pool');
  go(k, 72, 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > 77.2, timeout: 5, label: 'under the second beam' }).release().settle();
  go(k, 80, 0).expect((s) => s.checkpoint.id === 'b1f', 'brazier before the second ice');
  blaze(k);
  go(k, 85.0, 0, 0.8);
  melt(k, 'ice2', 'the second ice');
  go(k, 92, 0).expect((s) => s.checkpoint.id === 'b1g', 'brazier before the lantern');
  ember(k);
  go(k, 99.6, 0, 0.8);
  k.expectSignal('lampA', true);
  k.until((s) => door(s, 'doorA').open >= 1, { timeout: 8, label: 'the first burner is lit and the door opens' });
  go(k, O.wire + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 2. the Wire Gallery
function wireGallery(k) {
  go(k, W(2), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  touch(k, W(3.3), -0.9, (s) => by(s.level.fuses, 'fuseW').state >= 1, { label: 'the boiler fuse is lit' });
  go(k, W(5.5), 0, 1.0, { order: 'zx' });
  afterDrop(k, 'd1'); go(k, W(7.75), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd2'); go(k, W(10.25), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd3'); go(k, W(12.75), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd4'); go(k, W(15.25), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd5'); go(k, W(20.6), 0, 1.0, { fine: 0 });
  k.expect((s) => s.deaths === (k.retries || 0), 'across the causeway, dry');
  go(k, W(22), -1.6, 1.0).expect((s) => s.checkpoint.id === 'b2b', 'brazier on the landing');
  // the valve: light the fuse far from the tunnel, walk to its mouth, go in when the spray stops
  touch(k, W(30), -3.0, (s) => by(s.level.fuses, 'fuseV').state >= 1, { label: 'the valve fuse is lit' });
  go(k, W(19.9), -0.4, 0.5, { order: 'zx' });
  go(k, W(19.9), 3.1, 0.5, { order: 'zx', fine: 0 });                      // beside the tunnel mouth (the wall over it starts at x 21)
  k.until((s) => !by(s.level.sprinklers, 'tunnel').wet, { timeout: 10, label: 'the spray stops' });
  k.hold('W', { until: (s) => s.signals.get('lampG'), timeout: 3, label: 'in to the lantern' }).release();
  go(k, W(19.9), 3.1, 0.5, { order: 'xz' });                               // out of the tunnel, and not off the end of the landing
  k.hold('A', { until: (s, p) => p.z < 1.4, timeout: 3 }).release();
  k.expect((s) => s.deaths === (k.retries || 0), 'out of the tunnel before the spray came back');
  touch(k, W(32), -2.8, (s) => by(s.level.fuses, 'fuseS').state >= 1, { label: 'the shutter fuse is lit' });
  go(k, W(31.0), 0, 0.8, { fine: 0 });
  spark(k);                                                               // a spark only for the wires: it burns heat while it waits
  sitOn(k, W(33), 0, (s, p) => p.ride || p.x > W(36), { label: 'first wire' });
  k.until((s, p) => !p.ride, { timeout: 10 });
  ember(k);
  go(k, W(43.0), 0, 0.8, { fine: 0 });
  spark(k);
  sitOn(k, W(45), 0, (s, p) => p.ride || p.x > W(48), { label: 'second wire' });
  k.until((s, p) => !p.ride, { timeout: 10 });
  ember(k);
  go(k, W(55), 0, 0.8, { fine: 0 });
  k.until((s) => door(s, 'shutter').open >= 1, { timeout: 8, label: 'the shutter opens' });
  go(k, W(59), 2.0, 0.8, { fine: 0 });
  spark(k);
  go(k, W(61), 0, 0.8, { fine: 0 });
  sitOn(k, W(63), 0, (s) => s.signals.get('sockB'), { label: 'the socket' });
  k.wait(0.3).expectSignal('burnB', true);
  ember(k);
  k.until((s) => door(s, 'doorB').open >= 1, { timeout: 8, label: 'the second door' });
  go(k, O.flue + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 3. the Flue
function flue(k) {
  go(k, F(3), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  go(k, F(12.6), 0, 1.0);
  smoke(k);
  k.hold('W', { until: (s, p) => p.x > F(15.4), timeout: 4, label: 'in through the foot grate' }).release();
  k.until((s, p) => p.y > 8.6, { timeout: 8, label: 'up the flue' });
  k.hold('W', { until: (s, p) => p.x > F(20.6), timeout: 5, label: 'through the top grate' }).release();
  ember(k);
  k.until((s, p) => p.grounded, { timeout: 5, label: 'down on the loft floor' }).settle();
  go(k, F(24), 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier in the loft');
  touch(k, F(22.8), -2.9, (s) => by(s.level.fuses, 'fuseL').state >= 1, { label: 'the loft fuse is lit' });
  go(k, F(28.4), 0, 1.0, { order: 'zx' });
  k.until((s) => !by(s.level.sprinklers, 'curtain').wet, { timeout: 10, label: 'the valve shuts' });
  k.hold('W', { until: (s) => s.signals.get('lampC'), timeout: 4, label: 'through the curtain' }).release();
  k.until((s) => door(s, 'doorC').open >= 1, { timeout: 6, label: 'the loft door' });
  go(k, O.cold + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 4. the Cold Store
function coldStretch(k) {
  const across = (from, to, steam, label) => {
    go(k, C(from - 0.8), 0, 0.8);
    blaze(k);
    k.hold('W', { until: (s) => by(s.level.pools, steam).steamT > 0, timeout: 4, label: `${label} boils` });
    ember(k);
    k.hold('W', { until: (s, p) => p.x > C(to - 1), timeout: 6 });
    k.jump({ hold: 0.3 });
    k.hold('W', { until: (s, p) => p.x > C(to + 0.2) && p.grounded, timeout: 3, label: `across ${label}` }).release().settle();
    k.expect((s, p) => p.x > C(to + 0.2) && s.deaths === (k.retries || 0), `across ${label}`);
  };
  const meltAt = (x, id, label) => {
    go(k, C(x - 0.8), 0, 0.8);
    blaze(k);
    melt(k, id, label);
    ember(k);
  };
  across(39.6, 46.4, 'poolC1', 'the first pool');
  meltAt(52, 'iceC2', 'the second wall of ice');
  go(k, C(55.4), 2.3, 1.0);                                              // the coal
  across(57.6, 64.4, 'poolC2', 'the second pool');
  go(k, C(65.8), 2.3, 0.8);                                              // the second coal
  meltAt(68, 'iceC3', 'the last wall of ice');
}
function coldStore(k) {
  go(k, C(2), 0).expect((s) => s.checkpoint.id === 'bC', 'the cold store brazier');
  go(k, C(29), 0, 1.0).expect((s) => s.signals.get('warm'), 'the boiler fuse has burned out: the room has thawed');
  blaze(k);
  go(k, C(30.2), 0, 0.8);
  melt(k, 'iceC1', 'the first wall of ice');
  ember(k);
  go(k, C(35), 0).expect((s) => s.checkpoint.id === 'bC2', 'brazier past the frozen room');
  coldStretch(k);
  go(k, C(71), 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > C(74.2), timeout: 4, label: 'under the low beam' }).release().settle();
  go(k, O.gas + 0.5, 0, 1.0);
}

// ------------------------------------------------------------------ 5. the Gas Gallery
function padRung(k, id, x, form_) {
  const n = gas(k.sim, id).blasts;
  go(k, x, 0, 0.75, { fine: 0 });
  return k.until((s) => gas(s, id).blasts > n, { timeout: 6, label: `${id} goes off` });
}
function gasGallery(k) {
  go(k, G(3), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier');
  padRung(k, 'gasL', G(10));
  k.until((s, p) => p.grounded && p.y > 10, { timeout: 8, label: 'onto rung one' }).settle();
  k.expect((s, p) => Math.abs(p.y - 12.2) < 0.1, 'standing on rung one');
  go(k, G(16), 0).expect((s) => s.checkpoint.id === 'b4a', 'brazier on rung one');
  spark(k);
  const n = gas(k.sim, 'gasS').blasts;
  go(k, G(17.4), 0, 0.8);
  sitOn(k, G(19.4), 0, (s) => s.signals.get('s1') || gas(s, 'gasS').blasts > n, { label: 'the spark sits on the socket' });
  k.until((s) => gas(s, 'gasS').blasts > n, { timeout: 6 });
  k.until((s, p) => p.grounded && p.y > 14, { timeout: 8, label: 'onto rung two' }).settle();
  k.expect((s, p) => Math.abs(p.y - 16) < 0.1, 'standing on rung two');
  go(k, G(32), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier on rung two');
  blaze(k);
  const m = gas(k.sim, 'gasV').blasts;
  go(k, G(42), 0, 0.8);
  k.until((s) => gas(s, 'gasV').blasts > m, { timeout: 6, label: 'gasV goes off' });
  k.until((s, p) => p.grounded && p.y > 18, { timeout: 12, label: 'onto the top rung' }).settle();
  k.expect((s, p) => Math.abs(p.y - 19.8) < 0.1, 'standing on the top rung');
  go(k, G(55), 0).expect((s) => s.checkpoint.id === 'b4c', 'brazier on the top rung');
  ember(k);
  go(k, G(58.6), -2.4, 1.0);
  k.until((s) => s.signals.get('liftPlate'), { timeout: 3, label: 'the lift plate' });
  // the lift starts 1.2 s after the plate is pressed: straight for it, slanting toward the middle of the lift, and stand still on it
  k.hold('W D', { until: (s, p) => p.z > -0.4 || p.x > G(60.4), timeout: 3, label: 'toward the lift' });
  k.release();
  go(k, G(63.5), 0, 0.6, { fine: 0 });                                     // onto the middle of the lift, and stand still
  k.until((s, p) => p.y > 30.8, { timeout: 16, label: 'the lift reaches the top' });
  go(k, O.chim + 0.6, 0, 1.0);
}

// ------------------------------------------------------------------ 6. the Chimney
function chimney(k) {
  go(k, K(2.4), 3.0, 1.0).expect((s) => s.checkpoint.id === 'b5', 'the base brazier');
  go(k, K(4.6), 0, 0.8, { order: 'zx' });
  blaze(k);
  // walk onto the sensor; the moment the chimney lights the draught takes the flame: lean into the open (south) half and rise
  k.hold('W', { until: (s) => s.signals.get('lit'), timeout: 6, label: 'the chimney lights' }).release();
  k.hold('D', { until: (s, p) => p.z > 1.2 || p.y > 56, timeout: 6, label: 'into the open half of the throat' }).release();
  k.until((s, p) => p.y > 57.5, { timeout: 20, label: 'up to the ledge' });
  k.hold('A', { until: (s, p) => p.z < -1.8, timeout: 8, label: 'over the ledge' }).release();
  // the ledge brazier stands beside the second sensor: landing on the ledge refuels the blaze and lights the upper draught, which takes it on up at once
  k.until((s, p) => s.signals.get('burnD') || (p.grounded && p.y > 59), { timeout: 14, label: 'on the ledge' });
  if (!k.sim.signals.get('burnD')) go(k, K(11.6), -2.6, 0.8);                // landed on the far end of the ledge: walk to the sensor and the brazier by it
  k.until((s) => s.signals.get('burnD'), { timeout: 6, label: 'the second sensor trips' });
  k.until((s, p) => p.y > 92, { timeout: 30, label: 'carried up the throat' });
  k.hold('W', { until: (s, p) => p.x > K(15), timeout: 6, label: 'out onto the rim' }).release().settle();
  go(k, K(24.4), 0, 0.8, { fine: 0 });
  k.expectExit();
}

export const DRY_LESSON = false;
export function solve(k) {
  stokehole(k);
  wireGallery(k);
  flue(k);
  coldStore(k);
  gasGallery(k);
  chimney(k);
}
