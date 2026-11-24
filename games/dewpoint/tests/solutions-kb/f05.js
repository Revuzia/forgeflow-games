// Keyboard solution for f05 "Tinderbox": W/A/S/D, Space, 1-2 (ember, blaze) and human timing only (tests/lib/keyboard.js).
// Camera never turns (camYaw -90: W is +x, D is +z).
import f05 from '../../src/levels/f05.js';
import { by, leap, go, touch, hop, hopFrom, attempt, afterDrop, form, section } from './fire-moves.js';

const [O1, O2, O3, O4, O5] = f05.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const wood = (s, id) => by(s.level.woods, id);
const door = (s, id) => by(s.level.doors, id);
const stack = (s) => s.level.woods.filter((w) => /^crate\d/.test(w.id));
const stack2 = (s) => s.level.woods.filter((w) => /^sack/.test(w.id));
const onTop = (x0, x1, z0, z1, top) => (s, p) => p.grounded && p.x >= x0 - 0.3 && p.x <= x1 + 0.3 && p.z >= z0 - 0.3 && p.z <= z1 + 0.3 && Math.abs(p.y - top) < 0.1;

function woodStore(k) {
  const o = O1;
  go(k, o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  touch(k, o + 4.2, 3.0, (s) => by(s.level.fuses, 'cord0').state >= 1, { label: 'the cord down the hall is burning' });
  k.expect((s) => wood(s, 'wall0').state === 0, 'the plank wall is not alight yet');
  go(k, o + 11, 0, 1.0, { order: 'zx' }).expect((s) => s.checkpoint.id === 'b1b', 'brazier before the crates');
  go(k, o + 12.4, 0, 1.0);
  form(k, 'blaze');
  // walk into the stack until one crate has caught, then stand clear of it: a falling crate can throw a flame off the floor
  k.hold('W', { until: (s) => stack(s).some((w) => w.state > 0), timeout: 6, label: 'a crate catches' });
  k.release().until((s) => stack(s).every((w) => w.state === 2), { timeout: 14, label: 'the stack is gone' });
  k.hold('W', { until: (s, p) => p.x > o + 17, timeout: 4 }).release().settle();
  form(k, 'ember');
  // three wooden rafts of crates stand in the pool as stepping stones: hop them as an ember (the coal first)
  section(k, 'the crates in the pool', () => {
  go(k, o + 18, -2.6, 1.0);                                                // the coal
  hopFrom(k, { at: [o + 19, -0.9], keys: 'W', run: 0.15, hold: 0.35 }, onTop(o + 23.05, o + 25.65, -2.25, 0.75, 0.7), 'on the first raft');
  hopFrom(k, { chain: true, at: [o + 23.9, -0.1], keys: 'W', run: 0.15, hold: 0.35 }, onTop(o + 26.7, o + 29.3, -0.75, 2.25, 0.7), 'on the second raft');
  hopFrom(k, { chain: true, at: [o + 27.4, 0], keys: 'W', run: 0.15, hold: 0.35 }, onTop(o + 30.35, o + 32.95, -2.25, 0.75, 0.7), 'on the third raft');
  hopFrom(k, { chain: true, at: [o + 31.1, -0.5], keys: 'W', run: 0.15, hold: 0.35 }, (s, p) => p.grounded && p.x > o + 34 && Math.abs(p.y) < 0.1, 'across the pool on the rafts');
  });
  k.until((s) => wood(s, 'wall0').state === 2, { timeout: 12, label: 'the far wall has burnt' });
  go(k, o + 42.5, 0, 1.0, { order: 'zx' });
}

function plankWalk(k) {
  const o = O2;
  form(k, 'ember');
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'brazier at the bridge');
  go(k, o + 6.4, 0, 1.0, { order: 'zx' });
  afterDrop(k, 'dw1'); go(k, o + 11.2, 0, 1.0, { fine: 0 });
  afterDrop(k, 'dw2'); go(k, o + 15.3, 0, 1.0, { fine: 0 });
  afterDrop(k, 'dw3'); go(k, o + 19.9, 0, 1.0, { fine: 0 });
  k.expect((s) => s.deaths === (k.retries || 0) && wood(s, 'deck5').state === 0, 'across, and the bridge is untouched');
  form(k, 'blaze');
  // lean on the wall and keep leaning: the walkway beyond is alight as soon as the wall is, so no time is spent waiting to start
  k.hold('W', { until: (s, p) => p.x > o + 30.6, timeout: 12, label: 'across the walkway ahead of the fire' });
  if (k.p.y < -0.3) k.jump({ hold: 0.3 });                                   // dropped into the boiled pit: hop out at the far bank
  k.hold('W', { until: (s, p) => p.x > o + 31.9 && p.y > -0.1, timeout: 4, label: 'out of the pit' }).release().settle();
  k.expect((s, p) => s.deaths === (k.retries || 0) && p.y === 0, 'across the walkway ahead of the fire');
  go(k, o + 34, 0).expect((s) => s.checkpoint.id === 'b3', 'brazier past the wall');
}

function flueMouth(k) {
  const o = O3;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b4', 'brazier at the flue mouth');
  go(k, o + 5.5, 0, 1.0);
  form(k, 'blaze');
  k.hold('W', { until: (s) => wood(s, 'chain0').state > 0, timeout: 8, label: 'the first board catches' }).release();
  form(k, 'ember');
  k.hold('W', { until: (s, p) => p.x > o + 22.8 && p.grounded, timeout: 10, label: 'follows the fire into the tunnel' });
  k.until((s) => door(s, 'flueGate').open >= 1, { timeout: 16, label: 'the fire reaches the sensor and the gate lifts' });
  k.hold('W', { until: (s, p) => p.x > o + 27, timeout: 6 }).release().settle();
  go(k, o + 28, 0).expect((s) => s.checkpoint.id === 'b5', 'brazier past the flue');
}

function cooperage(k) {
  const o = O4;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b6', 'brazier at the cooperage');
  go(k, o + 3.5, 0, 1.0);
  form(k, 'blaze');
  k.hold('W', { until: (s) => wood(s, 'wall1').state > 0, timeout: 6, label: 'the wall catches' }).release();
  k.until((s) => wood(s, 'wall1').state === 2, { timeout: 6, label: 'the wall is gone' });
  form(k, 'ember');
  go(k, o + 8.2, 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > o + 13.6, timeout: 6, label: 'under the beam' }).release().settle();
  go(k, o + 15, 0).expect((s) => s.checkpoint.id === 'b7', 'brazier past the beam');
  go(k, o + 16.4, 0, 1.0);
  form(k, 'blaze');
  k.hold('W', { until: (s) => wood(s, 'pillar').state > 0, timeout: 6, label: 'the pillar catches' }).release();
  form(k, 'ember');                                                         // the pillar burns by itself: save the heat for the wall
  k.until((s, p) => s.signals.get('weight') || wood(s, 'pillar').state === 2, { timeout: 8, label: 'the crate falls on the first plate' });
  go(k, o + 19.6, 1.8, 1.0, { order: 'zx' });
  go(k, o + 22.2, 0.2, 1.0, { order: 'xz' });
  form(k, 'blaze');
  go(k, o + 23.3, 0.2, 1.0, { order: 'xz' });
  k.hold('W', { until: (s) => wood(s, 'wall2').state > 0, timeout: 6, label: 'the second wall catches' }).release();
  form(k, 'ember');
  k.until((s) => door(s, 'coopGate').open >= 1, { timeout: 8, label: 'both crates fall on their plates and the gate lifts' });
  go(k, o + 24.5, 0.3, 0.6, { order: 'xz' });                              // through the doorway before the fallen crate
  go(k, o + 25.2, 1.4, 1.0, { order: 'zx' });
  go(k, o + 28.6, 1.4, 1.0);
  go(k, o + 31.3, 0, 1.0, { order: 'zx' });
  go(k, o + 34, 0).expect((s) => s.checkpoint.id === 'b8', 'brazier past the gate');
  slalom(k);
}

/** Light the cord first, burn the wall (blaze), duck the long beam (ember): the cord burns the crates the beam keeps a blaze from. */
function slalom(k) {
  const o = O4;
  touch(k, o + 36.2, 3.0, (s) => by(s.level.fuses, 'cord3').state >= 1, { label: 'the slalom cord is burning' });
  go(k, o + 38.6, 0, 1.0, { order: 'zx' });
  form(k, 'blaze');
  k.hold('W', { until: (s) => wood(s, 'wall3').state > 0, timeout: 6, label: 'the wall catches' }).release();
  k.until((s) => wood(s, 'wall3').state === 2, { timeout: 6, label: 'the wall is gone' });
  form(k, 'ember');
  go(k, o + 43, 0, 1.0);
  k.hold('W', { until: (s, p) => p.x > o + 51.5, timeout: 8, label: 'under the long beam' }).release().settle();
  k.until((s) => stack2(s).every((w) => w.state === 2), { timeout: 14, label: 'the cord has burnt the crates' });
  go(k, o + 55, 0).expect((s) => s.checkpoint.id === 'b8b', 'brazier past the crates');
  k.wait(0.4);
  form(k, 'blaze');
  go(k, o + 58.0, 0, 1.0);
  k.hold('W', { until: (s) => wood(s, 'wall4').state > 0, timeout: 6, label: 'the last wall catches' }).release();
  k.until((s) => wood(s, 'wall4').state === 2, { timeout: 6, label: 'the last wall burns' });
  form(k, 'ember');
  go(k, o + 62, 0, 1.0);
}

function longFuse(k) {
  const o = O5;
  go(k, o + 1.5, 0).expect((s) => s.checkpoint.id === 'b9', 'last pool brazier');
  go(k, o + 11.3, 0, 1.0);
  form(k, 'blaze');
  // the pool boils as the flame comes near; burn the dam, wade on, climb out before the rain returns
  k.hold('W', { until: (s) => wood(s, 'lastDam').state > 0, timeout: 10, label: 'the dam catches' }).release();
  k.until((s) => wood(s, 'lastDam').state === 2, { timeout: 4, label: 'the dam is gone' });
  k.hold('W', { until: (s, p) => p.x > o + 21.0, timeout: 6, label: 'wades on' });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > o + 23 && p.grounded, timeout: 3, label: 'out of the basin' }).release().settle();
  k.expect((s, p) => p.x > o + 22 && s.deaths === (k.retries || 0), 'out of the basin before the water came back');
  go(k, o + 24, 0).expect((s) => s.checkpoint.id === 'b10', 'brazier by the long fuse');
  form(k, 'ember');
  go(k, o + 26.5, 2.5, 1.0, { order: 'zx' });
  form(k, 'blaze');
  touch(k, o + 28.4, 2.5, (s) => wood(s, 'line0').state > 0, { label: 'the first board catches' });
  form(k, 'ember');                                                         // the boards carry the fire from here: walk it as a coal
  go(k, o + 57.2, -0.6, 1.0, { order: 'xz', fine: 0 });
  k.until((s) => s.level.exits[0].open, { timeout: 12, label: 'the flame reaches the rope and the kiln door opens' });
  k.hold('W');                                                              // the door is open: walk into it
  k.expectExit();
}

export function solve(k) {
  woodStore(k);
  plankWalk(k);
  flueMouth(k);
  cooperage(k);
  longFuse(k);
}
