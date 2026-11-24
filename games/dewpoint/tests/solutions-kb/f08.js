// Keyboard solution for f08 "The Great Flue": W/A/S/D, Space, 1-3 (ember, blaze, smoke; the blaze key again in the air:
// flare) and human timing only (tests/lib/keyboard.js). Camera never turns (camYaw -90: W is +x, D is +z).
import f08 from '../../src/levels/f08.js';
import { by, leap, go, touch, hop, attempt, form } from './fire-moves.js';

const [O1, O2, O3, O4, O5] = f08.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const wood = (s, id) => by(s.level.woods, id);
const wax = (s, id) => by(s.level.waxes, id);
const door = (s, id) => by(s.level.doors, id);
const ice = (s, id) => by(s.level.iceblocks, id);

/** Walk into ice as a blaze until it is touching, then stand still until it is gone (fetching coal if the heat runs out). */
function melt(k, id, bite) {
  k.hold('W', { until: (s) => ice(s, id).t > 0 || ice(s, id).gone, timeout: 6, label: `touches ice ${id}` }).release();
  k.until((s, p) => ice(s, id).gone || p.form !== 'blaze', { timeout: 14, label: `ice ${id}: first bite` });
  if (!ice(k.sim, id).gone && bite) {
    bite();
    form(k, 'blaze');
    k.hold('W', { until: (s) => ice(s, id).t > 0 || ice(s, id).gone, timeout: 6 }).release();
    k.until((s) => ice(s, id).gone, { timeout: 14, label: `ice ${id}: finished` });
  }
  return k;
}
/** The same for wax: walk into it as a blaze until it has begun to sag, then stand still until `done`. */
function sag(k, id, done, label) {
  k.hold('W', { until: (s) => wax(s, id).t > 0, timeout: 6, label: `touches ${id}` }).release();
  return k.until(done, { timeout: 14, label });
}
/** Smoke along the roof: (rise with no key to `rise` first, if given), then W until x. Back to a coal on the far side. */
function slide(k, x, rise, timeout = 14) {
  form(k, 'smoke');
  if (rise) k.release().until((s, p) => p.y >= rise, { timeout: 6, label: 'rise to the roof' });
  k.hold('W', { until: (s, p) => p.x >= x, timeout, label: `slide to x=${x.toFixed(1)}` });
  k.release();
  form(k, 'ember');
  return k.until((s, p) => p.grounded, { timeout: 4, label: 'drops down' }).settle();
}

function draughtHall(k) {
  const o = O1;
  go(k, o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  go(k, o + 7.2, 3.2, 0.6);                                                // line up outside the wind, beside the cord, then lean into it
  k.hold('W', { until: (s) => by(s.level.fuses, 'cord1').state >= 1, timeout: 8, label: 'the cord in the wind is burning' });
  // the cord is lit: back out of the wind (it helps), line up on the gap in the wall outside it, then lean in on the planks
  k.hold('S', { until: (s, p) => p.x < o + 7.4, timeout: 4, label: 'back out of the wind' }).release().settle();
  go(k, o + 6.6, 0, 0.6, { order: 'zx' });
  // the head wind blows a coal back the moment it stops pushing: keep W held and lean on the planks
  k.hold('W', { until: (s) => wood(s, 'draughtWall').state > 0, timeout: 16, label: 'leans on the planks until the cord reaches them' });
  k.hold('W', { until: (s, p) => wood(s, 'draughtWall').state === 2 && p.x > o + 26.4, timeout: 14, label: 'through the head wind' }).release().settle();
  go(k, o + 28, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier past the wind');
}

function chandlery(k) {
  const o = O2;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'brazier at the chandlery');
  go(k, o + 7, 0, 1.0);
  form(k, 'blaze');
  k.hold('W', { until: (s, p) => p.x > o + 15.4, timeout: 8, label: 'through the curtain of spray' }).release().settle();
  k.expect((s) => s.deaths === (k.retries || 0), 'across the spray with heat to spare');
  go(k, o + 16.5, 0).expect((s) => s.checkpoint.id === 'b2b', 'brazier past the curtain');
  k.wait(0.4);
  go(k, o + 20.4, 0, 1.0);
  form(k, 'blaze');
  sag(k, 'waxD', (s) => wax(s, 'waxD').t >= 1, 'the wax has sagged');
  k.until((s) => s.signals.get('pE'), { timeout: 4, label: 'the crate settles on the plate' });
  form(k, 'ember');
  go(k, o + 21.4, 2.8, 1.0, { order: 'zx' });
  go(k, o + 29.4, 2.8, 1.0, { order: 'xz' });
  go(k, o + 30.2, 0.4, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'gateE').open >= 1, { timeout: 4, label: 'the gate lifts' });
  go(k, o + 35, 0).expect((s) => s.checkpoint.id === 'b2c', 'brazier past the gate');
  k.wait(0.4);
  go(k, o + 42.6, 0, 1.0);
  form(k, 'blaze');
  melt(k, 'iceI', () => { form(k, 'ember'); go(k, o + 41.5, -2.4, 1.0); go(k, o + 42.6, 0, 1.0, { order: 'zx' }); });
  k.hold('W', { until: (s, p) => p.x > o + 47, timeout: 6 }).release().settle();
}

function valveGallery(k) {
  const o = O3;
  form(k, 'ember');
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b3', 'brazier at the valve gallery');
  k.wait(0.4);
  touch(k, o + 8, 2.5, (s) => by(s.level.fuses, 'valve').state >= 1, { label: 'the valve cord is burning' });
  slide(k, o + 28.4, 0, 16);
  k.expect((s, p) => s.deaths === (k.retries || 0) && p.x > o + 28, 'across the first flume');
  go(k, o + 31, 0).expect((s) => s.checkpoint.id === 'b4', 'island brazier');
  k.wait(0.4);
  touch(k, o + 33.4, 2.5, (s) => s.signals.get('calm2'), { label: 'the lantern keeps the second wind off' });
  go(k, o + 35, 0, 1.0, { order: 'zx' });
  slide(k, o + 56.4, 0, 16);
  k.expect((s, p) => s.deaths === (k.retries || 0) && p.x > o + 56, 'across the second flume');
  go(k, o + 60, 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier past the flumes');
}

function frostGallery(k) {
  const o = O4;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b5', 'brazier at the frost');
  go(k, o + 4.6, 0, 1.0);
  form(k, 'blaze');
  go(k, o + 7.2, 0, 1.0);
  k.hold('W', { until: (s) => wood(s, 'row0').state > 0, timeout: 6, label: 'the first board catches' }).release();
  form(k, 'ember');
  touch(k, o + 17.2, 2.8, (s) => by(s.level.fuses, 'valveF').state >= 1, { label: 'the valve cord inside the frost is burning' });
  k.until((s) => !by(s.level.sprinklers, 'frostSpray').wet, { timeout: 6, label: 'the valve shuts the spray' });
  k.hold('W A', { until: (s, p) => p.z < 0.9, timeout: 4, label: 'slant toward the middle of the hall (a pot stands by the north wall)' });
  k.hold('W', { until: (s, p) => p.x > o + 25, timeout: 4, label: 'through the curtain while the valve is shut' }).release().settle();
  k.expect((s) => s.deaths === (k.retries || 0), 'through the curtain');
  go(k, o + 33, 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'gateF').open >= 1, { timeout: 14, label: 'the fire reaches the sensor and the gate lifts' });
  go(k, o + 40, 0).expect((s) => s.checkpoint.id === 'b6', 'brazier past the frost');
}

function kilnGallery(k) {
  const o = O5;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b7', 'brazier at the kiln gallery');
  go(k, o + 9.4, -2.4, 1.0);                                                // the coal
  go(k, o + 10.8, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  k.hold('W', { until: (s) => wax(s, 'waxG').t > 0, timeout: 6, label: 'touches the great wax' }).release();
  k.until((s, p) => wax(s, 'waxG').t >= 1 || p.form !== 'blaze', { timeout: 14, label: 'bite one at the great wax' });
  if (wax(k.sim, 'waxG').t < 1) {
    form(k, 'ember');
    go(k, o + 9.4, -2.4, 1.0);
    go(k, o + 10.8, 0, 1.0, { order: 'zx' });
    form(k, 'blaze');
    k.hold('W', { until: (s) => wax(s, 'waxG').t > 0, timeout: 6 }).release();
    k.until((s) => wax(s, 'waxG').t >= 1, { timeout: 14, label: 'the great wax sags' });
  }
  go(k, o + 16, 0).expect((s) => s.checkpoint.id === 'b7b', 'brazier past the great wax');
  k.wait(0.4);
  form(k, 'blaze');
  attempt(k, () => {
    go(k, o + 23.7, 0, 0.5);
    k.jump({ hold: 0.45 });                                                // jump, flare at the top: the hanging lantern
    k.special({ after: 0.1 });
    k.land().settle();
    if (k.p.form !== 'blaze') form(k, 'blaze');                            // the flare may have cost the flame: light it again
  }, (s) => s.signals.get('hiLamp'), { tries: 3, label: 'the hanging lantern is lit' });
  k.expectSignal('hiLamp', true);
  go(k, o + 28, 0).expect((s) => s.checkpoint.id === 'b7c', 'brazier before the sensor');
  k.wait(0.4);
  go(k, o + 35.5, 0, 1.0);
  k.until((s) => s.signals.get('hsK'), { timeout: 4, label: 'the sensor sees a flame' });
  go(k, o + 39, 0).expect((s) => s.checkpoint.id === 'b7d', 'brazier before the third lock');
  k.wait(0.4);
  go(k, o + 40.1, 0, 1.0);
  form(k, 'blaze');
  sag(k, 'waxK', (s) => wax(s, 'waxK').t >= 1, 'the wax has sagged');
  k.until((s) => s.signals.get('pK'), { timeout: 4, label: 'the crate settles on the plate' });
  form(k, 'ember');
  go(k, o + 43, 2.8, 1.0, { order: 'zx' });
  go(k, o + 47.5, 2.0, 1.0, { order: 'xz' });
  go(k, o + 48.5, 0, 1.0, { order: 'zx' });
  k.hold('W', { until: (s, p) => s.completed || p.x > o + 63.8, timeout: 20, label: 'through the last head wind, straight at the kiln door' });
  k.expectExit();
}

export const DRY_LESSON = true;      // the chandlery ice and the great wax are meant to be taken in bites: the gauge runs dry, a coal is fetched
export function solve(k) {
  draughtHall(k);
  chandlery(k);
  valveGallery(k);
  frostGallery(k);
  kilnGallery(k);
}
