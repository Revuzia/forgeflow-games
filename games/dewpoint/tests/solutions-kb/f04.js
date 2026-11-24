// Keyboard solution for f04 "Night Watch": W/A/S/D, Space, 1-2 (ember, blaze; again in the air: flare) and human timing
// only (tests/lib/keyboard.js). Camera never turns (camYaw -90: W is +x, D is +z).
import f04 from '../../src/levels/f04.js';
import { by, leap, go, touch, hop, hopTap, hopFrom, attempt, afterDrop, form, section } from './fire-moves.js';

const [O1, O2, O3, O4, O5] = f04.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const drip = (s, id) => by(s.level.drips, id);
const wood = (s, id) => by(s.level.woods, id);
const door = (s, id) => by(s.level.doors, id);
const fuse = (s, id) => by(s.level.fuses, id);
const ferry = (s) => by(s.level.movers, 'ferry');
const ferry2 = (s) => by(s.level.movers, 'ferry2');
const lamp = (s, id) => by(s.level.lanterns, id);
const onTop = (x0, x1, z0, z1, top) => (s, p) => p.grounded && p.x >= x0 - 0.3 && p.x <= x1 + 0.3 && p.z >= z0 - 0.3 && p.z <= z1 + 0.3 && Math.abs(p.y - top) < 0.1;

/** Walk into wood (or ice) as a blaze with W held until `gone`, then on to x. */
function burnThrough(k, x, gone, label) {
  k.hold('W', { until: gone, timeout: 12, label: `${label} burnt` });
  return k.hold('W', { until: (s, p) => p.x > x, timeout: 4, label: `through ${label}` });
}

function watchHall(k) {
  const o = O1;
  go(k, o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  k.expect((s) => door(s, 'doorA').open === 0, 'the first door starts shut');
  touch(k, o + 9, 2.6, (s) => lamp(s, 'lamp1').lit, { label: 'lantern one' });
  k.until((s) => door(s, 'doorA').open >= 1, { timeout: 5, label: 'door opens' });
  go(k, o + 14, 0, 1.0, { order: 'zx' });
  touch(k, o + 18.6, 3.3, (s) => fuse(s, 'cord0').state >= 1, { label: 'the cord across the water is burning' });
  // three stones in the pool, 2.4 m long and 3 m wide, 1.7 m apart: line up halfway between the middles of two stones and hop straight
  const hopAt = (x, z) => ({ at: [o + x, z], run: 0.15, hold: 0.35, tol: 0.5, fine: 0 });
  section(k, 'the three stones', () => {
    hopFrom(k, { ...hopAt(17.5, -0.35), tol: 0.6 }, onTop(o + 21.7, o + 24.1, -2.25, 0.75, 0), 'on the first stone');
    hopFrom(k, hopAt(22.5, -0.05), onTop(o + 25.8, o + 28.2, -0.75, 2.25, 0), 'on the second stone');
    hopFrom(k, hopAt(26.6, -0.35), onTop(o + 29.9, o + 32.3, -2.25, 0.75, 0), 'on the third stone');
    hopFrom(k, hopAt(30.7, -0.35), (s, p) => p.grounded && p.x > o + 34, 'across the pool');
  });
  go(k, o + 45.6, 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'doorB').open >= 1, { timeout: 12, label: 'the cord reaches its door' });
  go(k, o + 50, 0, 1.0);
}

function gallery(k) {
  const o = O2;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  go(k, o + 4.2, 0, 1.0, { order: 'zx' });
  afterDrop(k, 'd1'); go(k, o + 7.75, 0, 1.0, { fine: 0 });
  afterDrop(k, 'd2'); go(k, o + 10.25, 0, 1.0, { fine: 0 });
  afterDrop(k, 'd3'); go(k, o + 12.75, 0, 1.0, { fine: 0 });
  afterDrop(k, 'd4'); go(k, o + 17.5, 0, 1.0, { fine: 0 });
  k.expect((s) => s.checkpoint.id === 'b3' && s.deaths === (k.retries || 0), 'island brazier, dry');
  // the ferry: wait for it at this bank, ride across, step off at the far one
  go(k, o + 18.3, 0, 1.0);
  k.until((s) => ferry(s).t < 0.01 && ferry(s).wait > 0.9, { timeout: 14, label: 'ferry waits at this bank' });
  k.tap('W', 0.45);                                                       // one step aboard: the ferry is 3 m long
  k.until((s, p) => p.grounded && p.x > o + 19.4, { timeout: 2, label: 'steps aboard' }).settle();
  k.until((s) => ferry(s).t >= 1, { timeout: 10, label: 'ferry reaches the far bank' });
  go(k, o + 30.5, 0, 0.8).expect((s) => s.checkpoint.id === 'b3b', 'second island brazier');
  go(k, o + 31.3, 0, 1.0);
  k.until((s) => ferry2(s).t < 0.01 && ferry2(s).wait > 0.9, { timeout: 16, label: 'second ferry waits at this bank' });
  k.tap('W', 0.45);
  k.until((s, p) => p.grounded && p.x > o + 32.4, { timeout: 2, label: 'steps aboard' }).settle();
  k.until((s) => ferry2(s).t >= 1, { timeout: 10, label: 'second ferry reaches the far bank' });
  k.hold('W', { until: (s, p) => p.x > o + 42.6, timeout: 3, label: 'steps off' }).release().settle();
  go(k, o + 43.4, 0, 1.0);
}

function wicks(k) {
  const o = O3;
  go(k, o + 1.6, 0).expect((s) => s.checkpoint.id === 'b4' && s.deaths === (k.retries || 0), 'fourth brazier');
  touch(k, o + 4, 3.2, (s) => fuse(s, 'wickA').state >= 1, { label: 'the long cord is burning' });
  // out to the island in the bay to light the short cord, while the long flame is well on its way
  go(k, o + 13.5, 0, 1.0, { order: 'zx' });
  k.until((s) => fuse(s, 'wickA').d >= 5.0, { timeout: 12, label: 'let the long flame get ahead' });
  go(k, o + 13.5, 0.2, 1.0);
  hopTap(k, 'A', { tap: 0.3, hold: 0.45 });
  k.expect(onTop(o + 12.5, o + 14.5, -3.9, -2.6, 0), 'on the island');
  touch(k, o + 13.5, -3.2, (s) => fuse(s, 'wickB').state >= 1, { label: 'the short cord is lit while the long one still burns' });
  hopTap(k, 'D', { tap: 0.3, hold: 0.45 });
  go(k, o + 19.2, 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'gate').open >= 1, { timeout: 12, label: 'the flames meet and the gate lifts' });
  go(k, o + 23.8, 2.8, 1.0);
  k.expect((s) => lamp(s, 'lamp2').lit, 'lantern two');
}

function boilingHouse(k) {
  const o = O4;
  go(k, o + 1, -0.5).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  go(k, o + 3.4, -0.5, 1.0);
  form(k, 'blaze');
  k.hold('W', { until: (s, p) => p.x > o + 12.2 }).jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > o + 14 && p.grounded, timeout: 3, label: 'out of the basin' }).release().settle();
  k.expect((s, p) => p.x > o + 13 && s.deaths === (k.retries || 0), 'across the boiled pool');
  go(k, o + 15, 0).expect((s) => s.checkpoint.id === 'b6', 'sixth brazier');
  form(k, 'ember');
  go(k, o + 17.4, 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > o + 21.8, timeout: 4, label: 'under the beam' }).release().settle();
  go(k, o + 24, 0).expect((s) => s.checkpoint.id === 'b7', 'seventh brazier');
  go(k, o + 27.2, 0, 1.0);
  form(k, 'blaze');
  k.hold('W', { until: (s, p) => wood(s, 'dam').state === 2 || p.x > o + 32.6, timeout: 6, label: 'wades up to the dam' });
  k.hold('W', { until: (s, p) => p.x > o + 37.0, timeout: 8, label: 'burns the dam and wades on' }).jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > o + 39 && p.grounded, timeout: 3, label: 'out of the basin' }).release().settle();
  k.expect((s, p) => p.x > o + 38 && s.deaths === (k.retries || 0), 'out of the basin before the water came back');
}

function canalSide(k) {
  const o = O5;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b8', 'brazier by the canal');
  go(k, o + 3.2, 2.8, 1.0);                                                // the coal
  go(k, o + 3.6, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  k.hold('W');
  k.jump({ after: 0.6, hold: 0.45 });
  k.special({ after: 0.1 });
  k.land();
  k.release().settle();
  k.expect((s, p) => p.x > o + 12 && s.deaths === (k.retries || 0), 'across the canal on a flare');
  go(k, o + 14.5, 0).expect((s) => s.checkpoint.id === 'b9', 'brazier on the far bank');
  form(k, 'ember');                                                        // the ledges are climbed as a coal: a blaze only for the last jump
  go(k, o + 18.2, 0, 1.0);
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  k.expect((s, p) => Math.abs(p.y - 2.6) < 0.05, 'top of the stair');
  go(k, o + 23.6, 0.2, 1.0);
  form(k, 'blaze');
  k.jump({ hold: 0.45 });                                                  // straight up under the hanging lantern, then flare
  k.special({ after: 0.1 });
  k.land().settle();
  k.expect((s) => lamp(s, 'lamp3').lit, 'the hung lantern');
  form(k, 'ember');
  go(k, o + 30.8, 1.2, 1.0, { fine: 0 });
  k.expectExit();
}

export function solve(k) {
  watchHall(k);
  gallery(k);
  wicks(k);
  boilingHouse(k);
  canalSide(k);
}
