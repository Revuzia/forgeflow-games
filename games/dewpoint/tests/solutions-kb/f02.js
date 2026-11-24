// Keyboard solution for f02 "Mind the Drip": W/A/S/D, Space and human timing only (tests/lib/keyboard.js).
// Camera never turns (camYaw -90: W is +x, D is +z). Each drip is read the way a person reads it: wait for a drop to land, go.
import { by, leap, go, touch, hop, attempt, afterDrop, hopFrom, section } from './fire-moves.js';

const drip = (s, id) => by(s.level.drips, id);
const spray = (s, id) => by(s.level.sprinklers, id);
const P = (x) => x + 10;
const Q = (x) => x + 22;

function cellar(k) {
  go(k, 4, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  go(k, 15.2, 0);
  afterDrop(k, 'fdrip');
  go(k, 19.4, 0, 0.8, { fine: 0 });                                         // straight under the pipe, right after a drop
  k.expect((s) => s.deaths === (k.retries || 0), 'past the pipe');
  go(k, P(11), 3.4, 1.0, { order: 'zx' });                                 // round the first puddle by the north strip
  go(k, P(15.6), 3.4, 1.0, { order: 'xz' });
  go(k, P(16.4), -3.4, 1.0, { order: 'zx' });                              // the second, by the south
  go(k, P(23.6), -3.4, 1.0, { order: 'xz' });
  go(k, P(25), 3.4, 1.0, { order: 'zx' });                                 // the third, by the north again
  go(k, P(31.6), 3.4, 1.0, { order: 'xz' });
  go(k, P(33), 0, 1.0, { order: 'zx' }).expect((s) => s.checkpoint.id === 'b1b', 'the brazier before the big puddle');
  go(k, P(34.5), 0, 1.0);
  leap(k, 'W', { run: 0.2, hold: 0.45, release: 1.0 }).land();             // the pool that cannot be walked round
  k.settle();
  k.expect((s, p) => s.deaths === (k.retries || 0) && p.x > P(39), 'over the pool');
  go(k, P(41.5), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
}

// Each hop is one a person would make: stand near the back of the stone, stand where both stones reach (halfway between their middles: a stone is wider than the step to the next), run
// and jump straight at it. The stones are 2.6 m long and 3 m wide, 2.0 m apart, and each is at most 0.8 m to the side of the one before.
const onTop = (x0, x1, top) => (s, p) => p.grounded && p.x >= x0 - 0.3 && p.x <= x1 + 0.3 && Math.abs(p.y - top) < 0.1;
const hopAt = (x, z) => ({ at: [P(x), z], run: 0.15, hold: 0.35, tol: 0.9, fine: 0 });
const POND1 = [
  [hopAt(49.6, 0), onTop(P(54), P(56.6), 0), 'on the first stone'],
  [hopAt(54.6, -0.4), onTop(P(58.6), P(61.2), 0.4), 'on the second stone'],
  [hopAt(59.2, 0), onTop(P(63.2), P(65.8), 0.8), 'on the third stone'],
  [hopAt(63.8, 0), onTop(P(67.8), P(70.4), 0.8), 'on the fourth stone'],
  [hopAt(68.4, 0), onTop(P(72.4), P(75.0), 0.4), 'on the fifth stone'],
  [hopAt(73.0, 0.4), onTop(P(77), P(79.6), 0), 'on the sixth stone'],
  [hopAt(77.6, 0), onTop(P(81.6), P(84), 0), 'across the pond'],
];
const POND2 = [
  [hopAt(82.4, 0), onTop(P(85.8), P(88.0), 0.5), 'on the first pillar'],
  [hopAt(86.2, -0.25), onTop(P(89.6), P(91.8), 1.0), 'on the second pillar'],
  [hopAt(90.0, 0), onTop(P(93.4), P(95.6), 1.5), 'on the third pillar'],
  [hopAt(93.8, 0), onTop(P(96), P(110), 0), 'off the last pillar'],
];

function stones(k) {
  section(k, 'the long pond', () => { for (const [h, check, label] of POND1) hopFrom(k, h, check, label); });
  go(k, P(82.8), 0).expect((s) => s.checkpoint.id === 'b2b', 'the waystation');
  section(k, 'the pillars', () => { for (const [h, check, label] of POND2) hopFrom(k, h, check, label); });
}

function gallery(k) {
  go(k, Q(90.5), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  go(k, Q(97.2), 0, 1.0, { order: 'zx' });
  afterDrop(k, 'd1a');
  go(k, Q(99.75), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd2a');
  go(k, Q(102.25), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd3a');
  go(k, Q(106), 0, 1.0, { fine: 0 });
  go(k, Q(109.5), 0).expect((s) => s.checkpoint.id === 'b3b' && s.deaths === (k.retries || 0), 'the landing brazier, dry');
  go(k, Q(114.5), 0, 1.0, { order: 'zx' });
  afterDrop(k, 'e1a');
  go(k, Q(119.5), 0, 1.0, { fine: 0 });
  afterDrop(k, 'e2a');
  go(k, Q(127), 0, 1.0, { fine: 0 });
  go(k, Q(132), 0).expect((s) => s.checkpoint.id === 'b4' && s.deaths === (k.retries || 0), 'fourth brazier, dry');
}

function sprays(k) {
  go(k, Q(138), 0);
  k.until((s) => { const q = spray(s, 'pulsed'); return !q.wet && q.period - q.clock >= 1.2; }, { timeout: 8, label: 'pulsed is off' });
  k.hold('W', { until: (s, p) => p.x > Q(143.6), label: 'through the pulsing spray' });
  k.release().settle();
  k.expect((s) => s.deaths === (k.retries || 0), 'through the pulsing spray');
  go(k, Q(146.5), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier between the sprays');
}

function valve(k) {
  k.until((s) => by(s.level.fuses, 'fuseV').state === 0, { timeout: 6, label: 'fuse ready' });
  go(k, Q(150.1), -2.6, 1.0);
  k.until((s) => by(s.level.fuses, 'fuseV').state >= 1, { timeout: 2, label: 'fuse lit' });
  k.expect((s) => spray(s, 'curtain').wet, 'the curtain is spraying');
  go(k, Q(155.4), -0.5, 1.0);
  k.until((s) => !spray(s, 'curtain').wet, { timeout: 6, label: 'valve shut' });
  k.hold('W', { until: (s, p) => p.x > Q(159) });
  k.release().settle();
  k.expect((s, p) => p.x > Q(157.7) && s.deaths === (k.retries || 0), 'through the curtain, dry');
}

function boiler(k) {
  go(k, Q(176), 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  hopFrom(k, { at: [Q(185.5), -0.5], run: 0.25, hold: 0.3 }, onTop(Q(190.4), Q(192.8), 0), 'on the first stone');
  // the second stone is under a double pipe: let a drop fall, then hop on and straight across while it is clear
  go(k, Q(191.25), -0.25, 0.7);
  afterDrop(k, 'dAa');
  leap(k, 'W', { run: 0.15, hold: 0.45, release: 0.75 }).land();
  k.expect(onTop(Q(195.6), Q(198), 0), 'on the small stone');
  leap(k, 'W', { run: 0.25, hold: 0.3, release: 0.7 }).land().settle();
  k.expect(onTop(Q(200.8), Q(203.6), 0), 'on the dock');
  // the raft: board as the spray stops, ride through the rain, hop off onto the island
  go(k, Q(202.4), 0, 0.7);                                               // wait at the dock's edge, not on the way
  k.until((s) => spray(s, 'pulsedB').wet, { timeout: 8, label: 'the spray comes on' })
    .until((s) => !spray(s, 'pulsedB').wet, { timeout: 8, label: 'the spray has just stopped' });
  k.tap('W', 0.45);                                                       // one step aboard (the raft is 3 m long and sets off at once)
  k.until((s, p) => p.grounded && p.x > Q(204.4), { timeout: 2, label: 'steps aboard' }).settle();
  k.until((s) => by(s.level.movers, 'raft').t > 0.99, { timeout: 12, label: 'the raft reaches the island' });
  k.expect((s) => s.deaths === (k.retries || 0), 'rode through the rain dry');
  k.hold('W', { until: (s, p) => p.grounded && p.x > Q(220.4), timeout: 3, label: 'off onto the island' }).release().settle();   // the island is 6 m long
  touch(k, Q(221.8), 1.7, (s) => by(s.level.lanterns, 'boiler').lit, { label: 'the boiler is lit' });
  k.until((s) => !by(s.level.pools, 'flood').wet, { timeout: 3, label: 'the basin boils away' });
  go(k, Q(226.4), 1.8, 1.0, { order: 'xz' });                              // round the kiln on the island, by the lantern side
  k.hold('W', { until: (s, p) => p.x > Q(235.2), timeout: 4, label: 'across the dry basin' });
  k.jump({ hold: 0.3 });
  k.hold('W', { until: (s, p) => p.x > Q(238) && p.grounded && p.y > -0.05, timeout: 3, label: 'up out of the basin' });
  go(k, Q(245.5), 0, 1.0, { fine: 0 });
  k.expectExit();
}

export function solve(k) {
  cellar(k);
  stones(k);
  gallery(k);
  sprays(k);
  valve(k);
  boiler(k);
}
