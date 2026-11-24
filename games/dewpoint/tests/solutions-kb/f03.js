// Keyboard solution for f03 "Kindling": W/A/S/D, Space, 1-2 (form keys) and human timing only (tests/lib/keyboard.js).
// Camera never turns (camYaw -90: W is +x, D is +z). Key 1 is ember, key 2 is blaze (pressed again in the air: the flare).
import { by, leap, go, touch, hop, attempt, form } from './fire-moves.js';

const wood = (s, id) => by(s.level.woods, id);
const pileGone = (s, id) => s.level.woods.filter((w) => w.id.startsWith(id)).every((w) => w.state === 2);

/** Walk into a barrier of wood as a blaze, holding W against it until it has burnt and then on to x. */
function burnThrough(k, x, gone, label) {
  k.hold('W', { until: gone, timeout: 12, label: `${label} burnt` });
  return k.hold('W', { until: (s, p) => p.x > x, timeout: 4, label: `through ${label}` });
}

/** A blaze jump with the flare pressed `at` s after Space (the top of the jump), W held all the way. */
function flareJump(k, { run = 0.15, flareAt = 0.55 } = {}) {
  k.hold('W');
  k.jump({ after: run, hold: 0.45 });
  k.special({ after: flareAt - 0.45 });
  return k;
}

function tinderStore(k) {
  go(k, 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  go(k, 14, 0);
  form(k, 'blaze');
  burnThrough(k, 18.6, (s) => wood(s, 'barricade').state === 2, 'the planks');
  k.release().settle();
  form(k, 'ember');
  go(k, 24, -2.6, 1.0);                                                   // the coal
  go(k, 34, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  burnThrough(k, 38.5, (s) => pileGone(s, 'pile'), 'the stack');
  k.release().settle();
  k.expect((s) => s.deaths === (k.retries || 0), 'through the store');
}

function rafterHall(k) {
  form(k, 'ember');
  go(k, 50, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  go(k, 55.4, 0);
  k.hold('W', { until: (s, p) => p.x > 58.6, timeout: 4, label: 'under the first beam' });
  go(k, 66.4, 0, 1.0);
  form(k, 'blaze');
  burnThrough(k, 70.4, (s) => wood(s, 'planks2').state === 2, 'the second planks');
  k.release().settle();
  form(k, 'ember');
  go(k, 75.4, 0);
  k.hold('W', { until: (s, p) => p.x > 78.6, timeout: 4, label: 'under the second beam' });
  go(k, 86.4, 0, 1.0);
  form(k, 'blaze');
  burnThrough(k, 90.4, (s) => wood(s, 'planks3').state === 2, 'the third planks');
  k.release().settle();
  form(k, 'ember');
  go(k, 93, 0);
  k.hold('W', { until: (s, p) => p.x > 105.4, timeout: 6, label: 'over the catwalk' });
  k.release().settle();
  k.expect((s) => s.deaths === (k.retries || 0) && wood(s, 'walk1').state === 0, 'over the catwalk, unburnt');
}

function ropeBridge(k) {
  go(k, 107.5, 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  go(k, 114.4, 1.8, 1.0);
  form(k, 'blaze');
  touch(k, 116.7, 2.1, (s) => wood(s, 'rope1').state > 0, { label: 'rope alight' });
  k.until((s) => by(s.level.movers, 'bridge1').t >= 1, { timeout: 6, label: 'bridge down' });
  form(k, 'ember');
  go(k, 119, 0, 1.0, { order: 'zx' });
  go(k, 127.6, 0, 1.0);
  go(k, 129.5, 1.5, 1.0).expect((s) => s.checkpoint.id === 'b3b', 'landing brazier');
  go(k, 127.8, -2.6, 1.0, { order: 'xz' });
  hop(k, 'W', { run: 0.15, hold: 0.45 });                                 // up on the ledge
  form(k, 'blaze');
  touch(k, 131.1, -2.6, (s) => wood(s, 'rope2').state > 0, { label: 'second rope alight', tries: 5 });
  k.until((s) => by(s.level.movers, 'bridge2').t >= 1, { timeout: 6, label: 'second bridge down' });
  form(k, 'ember');
  go(k, 134, 0, 1.0, { order: 'zx' });
  go(k, 142.6, 0, 1.0);
  go(k, 145, 0, 1.0);
}

function boilBasin(k) {
  go(k, 150, 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier');
  go(k, 155, -2.2, 1.0);                                                  // the coal on the way
  go(k, 159.5, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  // the pool boils as the flame comes within a step of it; wade across and climb out before the rain returns
  k.hold('W', { until: (s, p) => p.x > 167.0, timeout: 5, label: 'wades across the boiled pool' });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > 169 && p.grounded, timeout: 3, label: 'out of the basin' });
  k.release().settle();
  form(k, 'ember');                                                       // out of the basin: a coal costs nothing
  k.expect((s, p) => p.x > 168 && s.deaths === (k.retries || 0) && Math.abs(p.y) < 1e-6, 'out of the basin before the water came back');
  go(k, 171, 0).expect((s) => s.checkpoint.id === 'b4b', 'fourth brazier, halfway');
  go(k, 174, -2.2, 1.0);                                                  // coal again
  go(k, 176.8, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  k.hold('W', { until: (s, p) => p.x > 188.0, timeout: 6, label: 'wades across the wide pool' });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > 190 && p.grounded, timeout: 3, label: 'out of the basin' });
  k.release().settle();
  form(k, 'ember');
  k.expect((s, p) => p.x > 189 && s.deaths === (k.retries || 0) && Math.abs(p.y) < 1e-6, 'across the wide pool');
}

function flareGap(k) {
  go(k, 198, 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  form(k, 'blaze');
  go(k, 203.6, 0, 1.0);
  flareJump(k, { run: 0.6 });
  k.land();
  k.release().settle();
  k.expect((s, p) => p.x > 211.8 && s.deaths === (k.retries || 0), 'across the gap on a flare');
  go(k, 214, 0).expect((s) => s.checkpoint.id === 'b5b', 'sixth brazier');
}

function kiln(k) {
  form(k, 'blaze');
  go(k, 234.6, 0, 1.0);
  burnThrough(k, 240, (s) => pileGone(s, 'pyre'), 'the kindling');
  k.until((s) => s.level.exits[0].open, { timeout: 10, label: 'the kiln knows a flame has come' });
  go(k, 242.6, 0, 1.0, { fine: 0 });
  k.expectExit();
}

export function solve(k) {
  tinderStore(k);
  rafterHall(k);
  ropeBridge(k);
  boilBasin(k);
  flareGap(k);
  kiln(k);
}
