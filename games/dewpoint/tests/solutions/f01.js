// Scripted solutions for f01 "First Light" (Fire). See LEVELS.md ("Proving a level solvable").
// Five areas, each opened by its own brazier: solve() is the plain route, solveAll() also takes
// the three glow-stones (the shelf corner, the dash alcove, the slab by the kiln).
// Area origins (x) as in src/levels/f01.js: 1 -4, 2 34.5, 3 82, 4 114 (floor y 3), 5 166.

const by = (list, id) => list.find((q) => q.id === id);
const door = (s, id) => by(s.level.doors, id);
const lamp = (s, id) => by(s.level.lanterns, id);
const ferry = (s) => by(s.level.movers, 'ferry');

function stoveRoom(r) {
  r.expect((s) => door(s, 'doorA').open === 0, 'door A starts shut')
    .walkTo(4, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier lit and holding the checkpoint')
    .walkTo(11, 2.0).expectSignal('lampA1', true)
    .walkTo(17.5, -2.0).expectSignal('lampA2', true)
    .walkTo(21.8, 2.4).jumpTo(24, 2.4, { tol: 0.3 })                    // up on the plinth
    .expectSignal('lampA3', true)
    .walkTo(27.6, -2.4).jumpTo(30, -2.4, { tol: 0.3 })                  // and up on the pedestal
    .expectSignal('lampA4', true)
    .walkTo(32.6, 0)
    .waitUntil((s) => door(s, 'doorA').open >= 1, { toward: [33, 0], timeout: 3, label: 'door A open' })
    .walkTo(37.5, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
}

function shelves(r, stone) {
  r.walkTo(41.4, 0).jumpTo(44.2, 0).jumpTo(46.8, 0).jumpTo(49.5, 0);
  if (stone) r.walkTo(49.2, -3.5).expectShards(1).walkTo(50.2, -0.5);
  r.walkTo(50.4, 0.2).jumpTo(55.6, 0, { run: 0.8 })                       // the 3 m gap to the first slab
    .walkTo(56.6, -0.8).jumpTo(61.8, -2.8, { run: 0.6 })                  // to the slab by the south wall
    .expect((s) => s.checkpoint.id === 'b2b', 'the waystation')
    .walkTo(62.8, -3.0)
    // the rail platform: hop on, ride 13.5 m while standing on it, hop off
    .waitUntil((s, p) => p.grounded && p.x > 64.3 && Math.abs(p.y - 1) < 0.1, { toward: [65.6, -3.0], jump: true, timeout: 3, label: 'hops aboard' })
    .waitUntil((s) => ferry(s).t > 0.99, { timeout: 8, label: 'the platform reaches the far end' })
    .jumpTo(81.4, -2.6, { tol: 0.4 })
    .walkTo(84.5, 0).expect((s) => s.deaths === 0 && s.checkpoint.id === 'b3', 'third brazier, dry and level');
}

function gallery(r) {
  r.walkTo(93, 2.2).expectSignal('lampG1', true)
    .walkTo(93.4, 0.4).jumpTo(99.4, 0, { run: 0.6, tol: 0.5 })                // the trench
    .walkTo(98.4, -3.0).jumpTo(100.4, -3.0).jumpTo(103.4, -3.0).expect((s) => lamp(s, 'lampG2').lit, 'ledge lantern lit')
    .walkTo(105.5, -2.0).waitUntil((s, p) => p.grounded && p.y < 0.05, { toward: [105.6, 0.4], timeout: 3, label: 'down on the floor' })
    .walkTo(105.4, 1.0).jumpTo(107.8, 2.8).walkTo(108, 3.0)
    .jump(0.6, 0, 0)
    .waitUntil((s, p) => p.grounded, { timeout: 2, label: 'lands' })
    .expect((s) => lamp(s, 'lampG3').lit, 'the hung lantern is lit')
    .expectSignal('galleryLit', true)
    .walkTo(109.4, 0.5).walkTo(112.5, 0)
    .waitUntil((s, p) => p.y > 2.95, { toward: [112.5, 0], timeout: 6, label: 'the lift carries Cinder up' })
    .walkTo(116, 0).walkTo(117.5, 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier, up in the works');
}

function wickWalk(r) {
  r.walkTo(121, -3.2).expect((s) => by(s.level.fuses, 'fuseC').state === 1, 'the wick is burning')
    .walkTo(123.6, -2.2).jumpTo(126.4, -2.2).jumpTo(129.4, -2.2).jumpTo(132.4, -2.2).jumpTo(135.4, -2.2) // up the saggar stacks
    .walkTo(137, -2.2).walkTo(146.8, -2.4)                                                // and down the far side
    .waitUntil((s, p) => p.grounded && Math.abs(p.y - 3) < 0.05, { toward: [146.8, -2.6], timeout: 4, label: 'down on the floor' })
    .walkTo(146.4, -3.0).walkTo(146.8, -0.6)
    .waitUntil((s) => door(s, 'doorC').open >= 1, { toward: [146.8, -0.6], timeout: 12, label: 'gate open' })
    .walkTo(150, 0);
}

function hallsEnd(r) {
  r.walkTo(166, 0).walkTo(168.5, 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
}

function kilnHall(r, stone) {
  r.walkTo(171, 0.4).jumpTo(176.4, 0.4, { run: 0.6, tol: 0.5 })                     // the trench
    .walkTo(177.5, 2.6).expectSignal('lampK1', true)
    .walkTo(177.6, -2.6).jumpTo(180.2, -2.8).jumpTo(182.8, -3.0).jumpTo(185.3, -3.0).expect((s) => lamp(s, 'lampK2').lit, 'ledge lantern lit');
  if (stone) {
    r.walkTo(186.0, -3.4)
      .jumpTo(190.6, -4.25, { run: 0.2, tol: 0.4 }).expectShards(3)
      .walkTo(191.2, -4.25);
  }
}

function pyre(r) {
  r.waitUntil((s, p) => p.grounded && Math.abs(p.y - 3) < 0.05, { toward: [188.3, -0.4], timeout: 8, label: 'on the hall floor' })
    .walkTo(188.3, -0.4)
    .waitUntil((s) => by(s.level.woods, 'pyre').state > 0, { timeout: 8, label: 'the flame reaches the kindling' })
    .waitUntil((s) => s.level.exits[0].open, { timeout: 8, label: 'the kiln opens' })
    .walkTo(193, 0).expectExit();
}

export function solve(r) {
  stoveRoom(r);
  shelves(r, false);
  gallery(r);
  wickWalk(r);
  hallsEnd(r);
  kilnHall(r, false);
  pyre(r);
}

export function solveAll(r) {
  stoveRoom(r);
  shelves(r, true);
  gallery(r);
  wickWalk(r);
  // glow-stone 2: the dash. Light the short fuse, hop the kerb, be at the far door while it is down.
  r.walkTo(151, 2.9)
    .expect((s) => by(s.level.fuses, 'fuseG').state === 1, 'short fuse lit')
    .walkTo(155, 2.9, { slow: false }).jumpTo(157.4, 3.0)
    .walkTo(158.4, 3.2)
    .waitUntil((s) => door(s, 'doorG').open >= 1, { timeout: 3, label: 'far door down' })
    .walkTo(161.4, 3.4).expectShards(2)
    .expect((s) => door(s, 'doorG').open >= 1, 'the door waits while Cinder is inside')
    .walkTo(158.4, 3.2).walkTo(157.4, 0.8);
  hallsEnd(r);
  kilnHall(r, true);
  pyre(r);
}
