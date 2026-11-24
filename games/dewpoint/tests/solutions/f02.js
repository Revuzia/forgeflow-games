// Scripted solutions for f02 "Mind the Drip" (Fire). Five wet rooms, each opened by a brazier.
// solve() is the plain route; solveAll() also takes the three glow-stones (a side stone in the
// pond, an islet under a drip, a dead-end spray tunnel).
// src/levels/f02.js writes the later rooms in their own numbers and slides them along: the stepping
// stones by 10 m (P), the gallery, the sluice room and the boiler house by 22 m (Q).

const by = (list, id) => list.find((q) => q.id === id);
const drip = (s, id) => by(s.level.drips, id);
const spray = (s, id) => by(s.level.sprinklers, id);
const P = (x) => x + 10;
const Q = (x) => x + 22;

/** Wait until the drop of drip `id` has just landed, so the column is clear for most of a period. */
function afterDrop(r, id) {
  return r.waitUntil((s) => drip(s, id).live, { timeout: 6, label: `${id} lets go a drop` })
    .waitUntil((s) => !drip(s, id).live, { timeout: 6, label: `${id} drop lands` });
}

/** Wait for a pulsing spray to be off with at least `need` seconds of dry time left. */
function sprayOff(r, id, need) {
  return r.waitUntil((s) => { const q = spray(s, id); return !q.wet && q.period - q.clock >= need; }, { timeout: 8, label: `${id} is off` });
}

function cellar(r) {
  r.walkTo(4, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier')
    .walkTo(15.2, 0);
  afterDrop(r, 'fdrip').walkTo(19.2, 0)                                     // straight under the pipe, right after a drop
    .expect((s) => s.deaths === 0, 'past the pipe');
  r.walkTo(P(11), 3.4).walkTo(P(15.4), 3.4)                                 // round the first puddle by the north strip
    .walkTo(P(19), -3.4).walkTo(P(23.2), -3.4)                              // the second, by the south
    .walkTo(P(27), 3.4).walkTo(P(31.4), 3.4)                                // the third, by the north again
    .walkTo(P(33), 0).expect((s) => s.checkpoint.id === 'b1b', 'the brazier before the big puddle')
    .walkTo(P(34.4), 0).jumpTo(P(40.6), 0, { run: 0.8 })                    // the pool that cannot be walked round
    .expect((s) => s.deaths === 0, 'over the pool')
    .walkTo(P(41.5), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
}

function stones(r, stone) {
  // each hop starts from the near edge of a stone, as a player would (stones: centres x 55.3, 59.9, 64.5, 69.1, 73.7, 78.3, +10)
  r.walkTo(P(50.4), 0).jumpTo(P(55.3), 0, { run: 0.8 })                     // onto the first stone
    .walkTo(P(56.0), -0.2).jumpTo(P(59.9), -0.8)
    .walkTo(P(60.6), -0.5).jumpTo(P(64.5), 0.8)
    .walkTo(P(65.1), 1.0);
  if (stone) r.jumpTo(P(66.8), 3.6, { tol: 0.3 }).expectShards(1).jumpTo(P(64.8), 1.8, { tol: 0.4 }).walkTo(P(65.1), 1.0);
  r.jumpTo(P(69.1), -0.8)
    .walkTo(P(69.8), -0.5).jumpTo(P(73.7), 0.8)
    .walkTo(P(74.4), 1.0).jumpTo(P(78.3), 0)
    .walkTo(P(79.0), 0).jumpTo(P(83), 0, { tol: 0.5 })
    .expect((s, p) => s.deaths === 0 && p.x > P(81.6), 'across the pond')
    // the second pond: pillars that climb like steps
    .walkTo(P(82.8), 0).expect((s) => s.checkpoint.id === 'b2b', 'the waystation')
    .walkTo(P(83.4), 0).jumpTo(P(86.9), 0, { tol: 0.4 })
    .walkTo(P(87.5), -0.2).jumpTo(P(90.7), -0.5, { tol: 0.4 })
    .walkTo(P(91.3), -0.3).jumpTo(P(94.5), 0.5, { tol: 0.4 })
    .walkTo(P(95.1), 0.5).jumpTo(P(97.5), 0, { tol: 0.5 })
    .expect((s, p) => s.deaths === 0 && p.x > P(96), 'across the second pond');
}

function gallery(r, stone) {
  r.walkTo(Q(90.5), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier')
    .walkTo(Q(97.5), 0);
  afterDrop(r, 'd1a').walkTo(Q(99.75), 0);
  afterDrop(r, 'd2a').walkTo(Q(102.25), 0);
  if (stone) {
    r.walkTo(Q(102.45), -0.3);
    afterDrop(r, 'd4').jumpTo(Q(102.45), -2.55, { tol: 0.25 }).expectShards(2)    // out to the islet and straight back
      .jumpTo(Q(102.45), -0.2, { tol: 0.3 }).walkTo(Q(102.25), 0);
  }
  afterDrop(r, 'd3a').walkTo(Q(106), 0).walkTo(Q(109.5), 0).expect((s) => s.checkpoint.id === 'b3b' && s.deaths === 0, 'the landing brazier, dry');
  r.walkTo(Q(114.5), 0);
  afterDrop(r, 'e1a').walkTo(Q(119.5), 0);
  afterDrop(r, 'e2a').walkTo(Q(127), 0).walkTo(Q(132), 0)
    .expect((s) => s.checkpoint.id === 'b4' && s.deaths === 0, 'fourth brazier, dry');
}

function sprays(r) {
  r.walkTo(Q(138), 0);
  sprayOff(r, 'pulsed', 1.2).walkTo(Q(143.6), 0, { slow: false });
  r.expect((s) => s.deaths === 0, 'through the pulsing spray')
    .walkTo(Q(146.5), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier between the sprays');
}

function lightFuse(r) {
  return r.waitUntil((s) => by(s.level.fuses, 'fuseV').state === 0, { timeout: 6, label: 'fuse ready' })
    .walkTo(Q(150.1), -2.6)
    .waitUntil((s) => by(s.level.fuses, 'fuseV').state === 1, { timeout: 2, label: 'fuse lit' });
}

function valve(r) {
  lightFuse(r);
  r.expect((s) => spray(s, 'curtain').wet, 'the curtain is spraying')
    .walkTo(Q(155.4), -0.5)
    .waitUntil((s) => !spray(s, 'curtain').wet, { timeout: 6, label: 'valve shut' })
    .walkTo(Q(159), -0.5, { slow: false })
    .expect((s, p) => p.x > Q(157.7) && s.deaths === 0, 'through the curtain, dry');
}

function boiler(r) {
  r.walkTo(Q(176), 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier')
    .walkTo(Q(187.6), 0).jumpTo(Q(191.6), 0, { run: 0.8 });                 // first stone
  // the second stone is under a double pipe: let a drop fall, then hop on, and hop across while it is clear
  r.walkTo(Q(192.4), 0)
    .waitUntil((s) => drip(s, 'dAa').live, { timeout: 6, label: 'dA lets go a drop' })
    .waitUntil((s) => !drip(s, 'dAa').live, { timeout: 6, label: 'dA drop lands' })
    .jumpTo(Q(195.9), 0, { tol: 0.4 }).walkTo(Q(197.6), 0, { slow: false })
    .jumpTo(Q(202.2), 0, { tol: 0.5 })                                      // the dock
    .walkTo(Q(203.2), 0);
  // the raft: board as the spray stops, ride 12.6 m through the rain, hop off onto the island
  // (it is on for 1.8 s of every 6; the raft reaches the rain 1.2 s after boarding and leaves it 2.8 s after)
  r.waitUntil((s) => { const q = spray(s, 'pulsedB'); return q.clock >= 0.9 && q.clock <= 3.0; }, { timeout: 8, label: 'the spray is stopping' })
    .waitUntil((s, p) => p.grounded && p.x > Q(204.3) && Math.abs(p.y) < 0.05, { toward: [Q(205.4), 0], jump: true, timeout: 3, label: 'boards the raft' })
    .waitUntil((s) => by(s.level.movers, 'raft').t > 0.99, { timeout: 12, label: 'the raft reaches the island' })
    .expect((s) => s.deaths === 0, 'rode through the rain dry')
    .jumpTo(Q(221.6), 0.4, { tol: 0.5 })
    .walkTo(Q(221.8), 1.2)
    .expectSignal('boiler', true)
    .waitUntil((s) => !by(s.level.pools, 'flood').wet, { timeout: 2, label: 'the basin boils away' })
    .walkTo(Q(224.6), 2.1).walkTo(Q(227.4), 1.6).walkTo(Q(235), 0, { slow: false }).jumpTo(Q(238), 0, { tol: 0.6 })
    .walkTo(Q(245.5), 0).expectExit();
}

export function solve(r) {
  cellar(r);
  stones(r, false);
  gallery(r, false);
  sprays(r);
  valve(r);
  boiler(r);
}

export function solveAll(r) {
  cellar(r);
  stones(r, true);
  gallery(r, true);
  sprays(r);
  // glow-stone 3: into the dead-end spray tunnel and out again while the valve is shut
  lightFuse(r);
  r.walkTo(Q(150.9), 3.1)
    .waitUntil((s) => !spray(s, 'sprayT').wet, { timeout: 6, label: 'tunnel spray off' })
    .walkTo(Q(155), 3.1, { slow: false }).expectShards(3)
    .walkTo(Q(150.9), 3.1, { slow: false })
    .expect((s) => s.deaths === 0 && !spray(s, 'sprayT').wet, 'out before the spray came back');
  valve(r);
  boiler(r);
}
