// Keyboard solution for f01 "First Light": W/A/S/D, Space and human timing only (tests/lib/keyboard.js).
// Written the way a first-time player would walk it: walk roughly, stop, line up, act. The camera never turns
// (camYaw -90: W is +x, D is +z).
import { by, leap, go, touch, hop, attempt } from './fire-moves.js';

const door = (s, id) => by(s.level.doors, id);
const lamp = (s, id) => by(s.level.lanterns, id);
const ferry = (s) => by(s.level.movers, 'ferry');
const fuse = (s, id) => by(s.level.fuses, id);

function stoveRoom(k) {
  k.expect((s) => door(s, 'doorA').open === 0, 'door A starts shut');
  go(k, 4, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier lit and holding the checkpoint');
  touch(k, 11, 2.4, (s) => lamp(s, 'lampA1').lit, { label: 'lantern 1' });
  touch(k, 17.5, -2.4, (s) => lamp(s, 'lampA2').lit, { label: 'lantern 2' });
  attempt(k, () => { go(k, 21.6, 2.4, 1.0); hop(k, 'W', { run: 0.15, hold: 0.2 }); },          // a little hop up onto the plinth
    (s) => lamp(s, 'lampA3').lit, { label: 'lantern 3 (on the plinth)' });
  attempt(k, () => { go(k, 27.4, -2.4, 1.0, { order: 'zx' }); hop(k, 'W', { run: 0.15, hold: 0.45 }); },   // hold Space longer for the pedestal
    (s) => lamp(s, 'lampA4').lit, { label: 'lantern 4 (on the pedestal)' });
  go(k, 32.4, 0);
  k.until((s) => door(s, 'doorA').open >= 1, { timeout: 6, label: 'door A open' });
  go(k, 37.5, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
}

function shelves(k) {
  go(k, 41.2, 0, 1.0);
  hop(k, 'W', { run: 0.2, hold: 0.3 });                                 // up the first steps
  hop(k, 'W', { run: 0.15, hold: 0.45 });                               // and onto the top one (1.4 m)
  k.expect((s, p) => p.y > 1.3, 'on the top step');
  go(k, 49.8, 0, 1.0);
  leap(k, 'W', { run: 0.2, hold: 0.45, release: 1.0 }).land();          // the 3 m gap to the first slab
  k.settle();
  k.expect((s, p) => p.x > 54 && Math.abs(p.y - 1.4) < 0.05, 'on the first slab');
  go(k, 55.0, -0.9, 1.0, { order: 'xz' });                              // back to the west end of the slab for a long run-up
  leap(k, 'W', { run: 0.45, hold: 0.45, extra: 'A', extraFor: 0.3, release: 1.3 }).land();   // to the lower slab: A for the first 0.3 s of the flight
  k.settle();
  go(k, 61.4, -3.4, 1.0).expect((s) => s.checkpoint.id === 'b2b', 'the waystation');
  go(k, 62.6, -3.0, 0.8);
  // the rail platform (3.2 m long, it sets off once Cinder is on it): one short step aboard, then stand still while it carries Cinder
  k.tap('W', 0.3);
  k.until((s, p) => p.grounded && p.x > 64.3, { timeout: 2, label: 'steps aboard' }).settle();
  k.until((s) => ferry(s).t > 0.99, { timeout: 12, label: 'the platform reaches the far end' });
  k.hold('W', { until: (s, p) => p.x > 81.4, timeout: 3, label: 'off onto the far ledge' });
  k.release().settle();
  go(k, 84.5, 0).expect((s) => s.deaths === (k.retries || 0) && s.checkpoint.id === 'b3', 'third brazier, dry and level');
}

function gallery(k) {
  touch(k, 93, 2.6, (s) => lamp(s, 'lampG1').lit, { label: 'lantern G1' });
  go(k, 93.6, 0.4, 1.0);
  leap(k, 'W', { run: 0.2, hold: 0.45, release: 1.0 }).land();          // the 2.8 m trench
  k.settle();
  k.expect((s, p) => p.x > 97.8 && p.y < 0.05, 'across the trench');
  go(k, 100.4, 0, 1.0, { order: 'xz' });
  hop(k, 'A', { run: 0.15, hold: 0.45 });                               // up onto the first block from the side
  k.expect((s, p) => p.y > 1.2, 'on the first block');
  hop(k, 'W', { run: 0.15, hold: 0.45 });                               // and onto the second
  k.expect((s, p) => p.y > 2.5, 'on the second block');
  touch(k, 103.5, -3.1, (s) => lamp(s, 'lampG2').lit, { label: 'ledge lantern' });
  k.hold('D', { until: (s, p) => p.z > -0.5 && p.grounded, timeout: 3, label: 'steps off the block' }).release().settle();
  go(k, 105.2, 3.0, 1.0, { order: 'zx' });
  hop(k, 'W', { run: 0.15, hold: 0.45 });                               // onto the third block
  k.expect((s, p) => p.y > 1.2, 'on the third block');
  attempt(k, () => { go(k, 108, 3.0, 1.0); k.jump({ hold: 0.45 }).land().settle(); },            // straight up at the hanging lantern
    (s) => lamp(s, 'lampG3').lit, { tries: 4, label: 'the hung lantern is lit' });
  k.expectSignal('galleryLit', true);
  go(k, 110.2, 0, 1.0, { order: 'zx' });
  go(k, 112.2, 0, 1.0);                                                 // onto the lift (3 m: with an open far end)
  k.until((s, p) => p.y > 2.95, { timeout: 8, label: 'the lift carries Cinder up' });
  go(k, 117.5, 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier, up in the works');
}

function wickWalk(k) {
  go(k, 121, -3.4, 1.0).expect((s) => fuse(s, 'fuseC').state >= 1, 'the wick is burning');
  go(k, 123.4, -2.2, 1.0);
  hop(k, 'W', { run: 0.15, hold: 0.45 });                               // up the saggar stacks
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  k.expect((s, p) => p.y > 7.5, 'on the top of the stacks');
  k.hold('W', { until: (s, p) => p.x > 146.4 && p.grounded && p.y < 3.1, timeout: 6, label: 'down the far side' });
  k.release().settle();
  go(k, 146.8, -0.6, 1.0);
  k.until((s) => door(s, 'doorC').open >= 1, { timeout: 12, label: 'gate open' });
  go(k, 150, 0);
}

function kilnHall(k) {
  go(k, 168.5, 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  go(k, 170.7, 0.4, 1.0);
  leap(k, 'W', { run: 0.2, hold: 0.45, release: 1.0 }).land();          // the trench
  k.settle();
  k.expect((s, p) => p.x > 174.8 && p.y > 2.9, 'across the trench');
  touch(k, 177.5, 3.0, (s) => lamp(s, 'lampK1').lit, { label: 'lantern K1' });
  go(k, 177.2, -2.6, 1.0, { order: 'zx' });
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  hop(k, 'W', { run: 0.15, hold: 0.45 });
  touch(k, 185.3, -3.1, (s) => lamp(s, 'lampK2').lit, { label: 'ledge lantern' });
  k.hold('D', { until: (s, p) => p.z > -1.0 && p.grounded && p.y < 3.1, timeout: 4, label: 'steps off the stacks' }).release().settle();
  go(k, 188.3, -0.4, 1.0);
  k.until((s) => by(s.level.woods, 'pyre').state > 0, { timeout: 10, label: 'the flame reaches the kindling' })
    .until((s) => s.level.exits[0].open, { timeout: 8, label: 'the kiln opens' });
  go(k, 193, 0, 1.0).expectExit();
}

export function solve(k) {
  stoveRoom(k);
  shelves(k);
  gallery(k);
  wickWalk(k);
  kilnHall(k);
}
