// Keyboard solution for f06 "Wax Resist": W/A/S/D, Space, 1-2 (ember, blaze) and human timing only (tests/lib/keyboard.js).
// Camera never turns (camYaw -90: W is +x, D is +z). Heat is spent as a blaze only where a blaze is needed: walk as an ember.
import f06 from '../../src/levels/f06.js';
import { by, leap, go, touch, hop, hopFrom, attempt, form } from './fire-moves.js';

const [O1, O2, O3, O4, O5] = f06.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const ice = (s, id) => by(s.level.iceblocks, id);
const wax = (s, id) => by(s.level.waxes, id);
const door = (s, id) => by(s.level.doors, id);

/**
 * Walk into ice as a blaze until it is touching (it starts to melt), then stand still against it until it is gone: a
 * person stops pushing once the flame has caught, so nothing carries Cinder on into what the ice was holding back.
 * If the heat runs out first, `bite` fetches coal and comes back.
 */
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

function coldStore(k) {
  const o = O1;
  go(k, o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  go(k, o + 9.4, 0, 1.0);
  form(k, 'blaze');
  melt(k, 'iceA');
  form(k, 'ember');
  go(k, o + 20, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier before the great wall');
  k.wait(0.4);
  go(k, o + 32.6, 0, 1.0);
  form(k, 'blaze');
  melt(k, 'iceB', () => { form(k, 'ember'); go(k, o + 30.6, -2.4, 1.0); go(k, o + 32.4, 0, 1.0); });
  form(k, 'ember');
  go(k, o + 38, 0, 1.0);
}

function candleWalk(k) {
  const o = O2;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  go(k, o + 7.4, 0, 1.0);
  form(k, 'blaze');
  go(k, o + 9.3, 0, 1.0);
  sag(k, 'waxA', (s) => wax(s, 'waxA').t >= 1, 'the wax has sagged');
  k.expect((s) => by(s.level.woods, 'candle').state === 0, 'the crate was kept out of the flame');
  k.until((s) => s.signals.get('pA'), { timeout: 4, label: 'the crate settles on the plate' });
  go(k, o + 11, -2.7, 1.0, { order: 'zx' });                            // round the niche by the south (the north has the wax cube)
  go(k, o + 17.4, -2.7, 1.0, { order: 'xz' });
  go(k, o + 18.4, 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'gateA').open >= 1, { timeout: 4, label: 'the gate lifts' });
  go(k, o + 22, 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  k.wait(0.3);
  go(k, o + 29.2, 0, 1.0);
  form(k, 'blaze');
  sag(k, 'waxB', (s) => wax(s, 'waxB').t >= 1, 'the wax wall sags to a puddle');
  k.hold('W', { until: (s, p) => p.x > o + 33, timeout: 4 }).release().settle();
}

function chillGallery(k) {
  const o = O3;
  form(k, 'ember');
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier');
  go(k, o + 11.0, 0, 1.0);
  form(k, 'blaze');
  melt(k, 'iceC1');
  form(k, 'ember');
  go(k, o + 16.4, 2.4, 1.0);                                              // the coal
  go(k, o + 21, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  melt(k, 'iceC2');
  form(k, 'ember');
  go(k, o + 26.4, -2.4, 1.0);
  go(k, o + 31, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  melt(k, 'iceC3');
  form(k, 'ember');
  go(k, o + 38, 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  go(k, o + 44.5, 0, 1.0);
}

function mouldingHall(k) {
  const o = O4;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b6', 'sixth brazier');
  go(k, o + 6.6, 0, 1.0);
  form(k, 'blaze');
  melt(k, 'icePillar');
  k.until((s) => s.signals.get('pC'), { timeout: 4, label: 'the crate falls on plate one' });
  form(k, 'ember');
  go(k, o + 7.5, -2.4, 1.0, { order: 'zx' });                             // round the niche by the south, over the coal
  go(k, o + 18.6, -2.4, 1.0, { order: 'xz' });
  go(k, o + 18.8, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  sag(k, 'waxC', (s) => wax(s, 'waxC').t >= 1, 'the wax sags');
  k.until((s) => s.signals.get('pD'), { timeout: 4, label: 'the crate settles on plate two' });
  form(k, 'ember');
  go(k, o + 19.4, -2.4, 1.0, { order: 'zx' });
  go(k, o + 28.4, -2.4, 1.0, { order: 'xz' });
  go(k, o + 28.4, 0.6, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'gateM').open >= 1, { timeout: 4, label: 'both crates are down: the gate lifts' });
  go(k, o + 33, 0).expect((s) => s.checkpoint.id === 'b7', 'seventh brazier');
}

function kilnCellar(k) {
  const o = O5;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b8', 'eighth brazier');
  go(k, o + 11.8, -2.4, 1.0);                                             // the coal
  go(k, o + 13, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  melt(k, 'iceG', () => { form(k, 'ember'); go(k, o + 11.8, -2.4, 1.0); go(k, o + 13, 0, 1.0); });
  form(k, 'ember');
  go(k, o + 22, 0, 1.0).expect((s, p) => p.form === 'ember', 'the frost keeps Cinder a coal');
  go(k, o + 23.4, 0, 1.0);
  hopFrom(k, { at: [o + 23.4, 0], keys: 'W', run: 0.25, hold: 0.45 }, (s, p) => p.grounded && p.x > o + 28.4 - 0.3, 'across the frost pool');
  go(k, o + 39, 0).expect((s) => s.checkpoint.id === 'b9', 'brazier past the frost');
  form(k, 'blaze');
  go(k, o + 43, 0, 1.0);
  k.until((s) => s.signals.get('kilnLit'), { timeout: 4, label: 'the sensor sees a flame' });
  go(k, o + 49.8, 0, 1.0, { fine: 0 });
  k.expectExit();
}

export const DRY_LESSON = true;      // the great ice (7 s of melt) is meant to be taken in two bites: the gauge runs dry once, with a coal to fetch
export function solve(k) {
  coldStore(k);
  candleWalk(k);
  chillGallery(k);
  mouldingHall(k);
  kilnCellar(k);
}
