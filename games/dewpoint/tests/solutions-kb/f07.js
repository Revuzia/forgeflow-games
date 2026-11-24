// Keyboard solution for f07 "Chimney Sweep": W/A/S/D, Space, 1-3 (ember, blaze, smoke) and human timing only
// (tests/lib/keyboard.js). Camera never turns (camYaw -90: W is +x, D is +z). Smoke drifts and rises by itself; the keys
// only steer it: hold W to slide along the roof, let go and press the ember key to drop out.
import f07 from '../../src/levels/f07.js';
import { by, go, touch, form, hop, attempt } from './fire-moves.js';

const [O1, O2, O3, O4, O5] = f07.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const wood = (s, id) => by(s.level.woods, id);
const door = (s, id) => by(s.level.doors, id);
const lamp = (s, id) => by(s.level.lanterns, id);

/**
 * Become smoke and drift along +x until x reaches `x`, then let go and settle back to a coal (and fall to the floor).
 * opts.rise: first let the smoke rise to that height with no key held (so it is above a curtain of spray).
 * opts.early: start sliding at once (smoke rises 1.9 m/s while it drifts 3 m/s): only where the spray is 6+ m off.
 */
function glide(k, x, opts = {}) {
  form(k, 'smoke');
  if (opts.rise && !opts.early) k.release().until((s, p) => p.y >= opts.rise, { timeout: 6, label: 'rise to the roof first' });
  k.hold('W', { until: (s, p) => p.x >= x, timeout: opts.timeout || 12, label: `slide to x=${x.toFixed(1)}` });
  k.release();
  form(k, 'ember');
  return k.until((s, p) => p.grounded, { timeout: 4, label: 'drops down onto the floor' }).settle();
}

function sootHall(k) {
  const o = O1;
  go(k, o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  go(k, o + 10.4, 0.3, 1.0);
  glide(k, o + 15);                                                       // through the grate in the doorway
  go(k, o + 19, 0).expect((s) => s.checkpoint.id === 'b1a', 'brazier before the pool');
  k.wait(0.4);
  go(k, o + 21.1, 0, 0.6);                                                // right at the water's edge: every metre of the pool is gauge
  k.expect((s, p) => p.gauge > 9.9, 'a full gauge for the crossing');
  glide(k, o + 42.9);                                                     // the long slide under the ceiling
  k.expect((s, p) => s.deaths === (k.retries || 0) && p.x > o + 42, 'across the pool on the roof');
  go(k, o + 46, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier on the far bank');
}

function sprinklerRun(k) {
  const o = O2;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'brazier at the sprinklers');
  go(k, o + 3, 0, 1.0);
  glide(k, o + 25, { early: true });                                        // rise to the roof first, then slide over the spray
  k.expect((s) => s.deaths === (k.retries || 0), 'over the first two curtains');
  go(k, o + 28, 0).expect((s) => s.checkpoint.id === 'b3', 'platform brazier');
  k.wait(0.4);
  go(k, o + 31.5, 0, 1.0);
  glide(k, o + 53, { early: true });
  k.expect((s) => s.deaths === (k.retries || 0), 'over the last two curtains');
  go(k, o + 55, 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier past the spray');
  go(k, o + 64, 0, 1.0);
}

function smokehouse(k) {
  const o = O3;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b4', 'brazier at the smokehouse');
  go(k, o + 5, 0, 1.0);
  glide(k, o + 10.5);                                                     // in at the window
  go(k, o + 12, 0).expect((s) => s.checkpoint.id === 'b5', 'brazier in the first chamber');
  k.wait(0.4);
  go(k, o + 20.5, 0, 1.0);
  glide(k, o + 26);
  go(k, o + 28, 0).expect((s) => s.checkpoint.id === 'b6', 'brazier in the second chamber');
  k.wait(0.4);
  go(k, o + 36.5, 0, 1.0);
  glide(k, o + 42);
  go(k, o + 44, 0).expect((s) => s.checkpoint.id === 'b6b', 'brazier in the third chamber');
  k.wait(0.4);
  go(k, o + 45, 0, 1.0);
  glide(k, o + 52.5, { rise: 3.2 });                                      // over the curtain inside the third chamber
  k.expect((s) => s.deaths === (k.retries || 0), 'over the curtain');
  go(k, o + 54, 0).expect((s) => s.checkpoint.id === 'b6c', 'brazier past the curtain');
  k.wait(0.4);
  form(k, 'blaze');
  go(k, o + 57, 0, 1.0);
  k.hold('W', { until: (s) => wood(s, 'smokeWall').state > 0, timeout: 6, label: 'the wall catches' }).release();
  k.until((s) => wood(s, 'smokeWall').state === 2, { timeout: 6, label: 'the wall is gone' });
  go(k, o + 63, 0, 1.0);
}

function lanternDuct(k) {
  const o = O4;
  form(k, 'ember');
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b7', 'brazier at the duct');
  k.expect((s) => !s.signals.get('draught'), 'the draught is off');
  touch(k, o + 6.6, 2.4, (s) => lamp(s, 'draughtLamp').lit, { order: 'zx', label: 'the first lantern is lit' });
  k.expect((s) => !s.signals.get('draught'), 'one lantern is not a draught');
  go(k, o + 1.8, -3.0, 1.0, { order: 'xz' });
  hop(k, 'W', { run: 0.15, hold: 0.3 });                                  // up on the ledge for the high lantern
  touch(k, o + 3.3, -3.0, (s) => s.signals.get('draught'), { tol: 0.5, label: 'the high lantern is lit' });  // not lit yet: step in under it
  k.expectSignal('draught', true);
  go(k, o + 5, -1, 1.0);
  go(k, o + 8.2, 0, 1.0, { order: 'zx' });
  glide(k, o + 45.4);                                                     // carried over the whole pool by the draught
  k.expect((s, p) => s.deaths === (k.retries || 0) && p.x > o + 44, 'carried over the whole pool by the draught');
  go(k, o + 48, 0).expect((s) => s.checkpoint.id === 'b7b', 'brazier past the duct');
  go(k, o + 64, 0, 1.0);
}

function kilnStack(k) {
  const o = O5;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b8', 'brazier at the stack');
  go(k, o + 11.5, 0, 1.0);
  form(k, 'smoke');
  k.release().until((s, p) => p.y >= 9.6, { timeout: 8, label: 'up the stack on the updraft' });
  k.hold('W', { until: (s, p) => p.x >= o + 15, timeout: 4 }).release();
  form(k, 'ember');
  k.until((s, p) => p.grounded, { timeout: 4, label: 'lands in the first gallery' }).settle();
  k.expect((s, p) => Math.abs(p.y - 7.8) < 0.1, 'standing in the first gallery');
  go(k, o + 16, 0).expect((s) => s.checkpoint.id === 'b9', 'gallery brazier');
  k.wait(0.4);
  go(k, o + 17.5, 0, 1.0);
  glide(k, o + 28.5, { rise: 10.4 });
  go(k, o + 30, 0).expect((s) => s.checkpoint.id === 'b9b', 'brazier past the curtain');
  k.wait(0.4);
  k.expect((s) => door(s, 'topHatch').open === 0, 'the roof hatch is shut');
  touch(k, o + 33.5, 2.5, (s) => s.signals.get('lampTop'), { label: 'the top lantern is lit' });
  k.until((s) => door(s, 'topHatch').open >= 1, { timeout: 4, label: 'the lantern opens the roof hatch' });
  go(k, o + 39.5, 0, 1.0);
  form(k, 'smoke');
  k.release().until((s, p) => p.y >= 14, { timeout: 8, label: 'up through the hatch to the top gallery' });
  k.hold('W', { until: (s, p) => p.x >= o + 43.5, timeout: 5 }).release();
  form(k, 'ember');
  k.until((s, p) => p.grounded, { timeout: 4, label: 'lands in the top gallery' }).settle();
  k.expect((s, p) => Math.abs(p.y - 11.6) < 0.1, 'standing in the top gallery');
  go(k, o + 45, 0).expect((s) => s.checkpoint.id === 'b10', 'top gallery brazier');
  k.wait(0.4);
  form(k, 'blaze');
  go(k, o + 48.5, 0, 1.0);
  k.until((s) => s.signals.get('kilnLit'), { timeout: 4, label: 'the sensor sees a flame' });
  go(k, o + 53.2, 0, 1.0, { fine: 0 });
  k.expectExit();
}

export function solve(k) {
  sootHall(k);
  sprinklerRun(k);
  smokehouse(k);
  lanternDuct(k);
  kilnStack(k);
}
