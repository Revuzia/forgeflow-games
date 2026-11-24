// Scripted solutions for l01 "First Drip". See LEVELS.md ("Proving a level solvable").
// solve(r): shortest honest route to the exit.  solveAll(r): the same plus all three shards.

/** 1. The Drip Tray: two hurdles, three slabs up to a ledge, the kiln-fire gap, (the plinth), out through the doorway. */
function dripTray(r, shards) {
  r.walkTo(-24.2, 1.4).expect((s) => s.checkpoint !== null, 'first checkpoint lit').walkTo(-20.6, 1.6).walkTo(-20.2, -1.4).walkTo(-16.8, -1.2)   // round the kilns
    .walkTo(-9.5, 0)
    .expect((s, p) => Math.abs(p.y - 0.9) < 1e-6, 'up the ramp onto the landing')
    .walkTo(-6.4, 0).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2, label: 'down off the landing' })
    .walkTo(-4.2, -1.4).walkTo(-1.6, -1.4)               // round the third kiln
    .walkTo(7.4, 0).jumpTo(10.8, 0)                          // hurdle 1
    .walkTo(14, 0).jumpTo(17.6, 0)                          // hurdle 2
    .waitUntil((s, p) => p.grounded, { timeout: 2 })
    .jumpTo(19.2, 0).jumpTo(20.8, 0).jumpTo(22.6, 0)        // up the slabs
    .expect((s, p) => Math.abs(p.y - 1.35) < 1e-6, 'on the top slab')
    .jumpTo(28.8, 0, { run: 2 });                         // the gap over the fire
  if (shards) r.walkTo(29.6, -4.4).jumpTo(31.8, -4.4).expectShards(1).walkTo(34, -3).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2 });
  r.walkTo(38.5, 0);
}

/** 2. The Plate Gallery: two big steps, the gallery with its gap, the plate, down and through door A. */
function plateGallery(r) {
  r.walkTo(41.8, -0.8).walkTo(43, -4.5).jumpTo(45, -4.5)
    .expect((s, p) => Math.abs(p.y - 1.2) < 1e-6, 'on the first step')
    .jumpTo(47.6, -4.5)
    .expect((s, p) => Math.abs(p.y - 2.4) < 1e-6, 'on the gallery')
    .walkTo(52.4, -4.5).jumpTo(58, -4.5, { run: 1 })
    .walkTo(60.2, -4.5).jumpTo(62.4, -4.5)
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'up on the plate level')
    .walkTo(63.2, -4.5).jumpTo(67.4, -4.5, { run: 0.6 })
    .walkTo(68.6, -4.5)
    .expectSignal('p1', true)
    .walkTo(72.5, -3)                                       // off the end of the gallery
    .waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2, label: 'down on the floor' })
    .walkTo(76, 0)
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 3, label: 'door A open' })
    .walkTo(80.4, 0);
}

/** 3. The Squeeze: film under the first low wall (and under the shelf), into the cell for its plate, through door C, up the step. */
function squeeze(r, shards) {
  r.walkTo(82, -0.8).walkTo(86.6, 0).form('film').walkTo(94.6, 0).form('liquid');
  if (shards) {
    r.walkTo(96.2, 1.9).form('film').walkTo(96.2, 4.3).expectShards(2).walkTo(96.2, 1.9).form('liquid');
  }
  r.expect((s) => !s.signals.get('doorC'), 'door C starts shut')
    .walkTo(103, -0.4).form('film').walkTo(103, -5.0)
    .expectSignal('p3', true)
    .walkTo(103, -1.0).form('liquid')
    .walkTo(110, 0)
    .waitUntil((s) => s.level.doors.find((d) => d.id === 'doorC').open >= 1, { timeout: 3, label: 'door C open' })
    .walkTo(114.6, 0).jumpTo(117.4, 0)
    .expect((s, p) => Math.abs(p.y - 1.2) < 1e-6, 'up the first step')
    .jumpTo(120.2, 0)
    .expect((s, p) => Math.abs(p.y - 2.4) < 1e-6, 'up the second step')
    .walkTo(123, 0).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2, label: 'down again' }).walkTo(126, 0);
}

/** 4. The Quick Door: the plate, four islands, flatten under the wall, through door B before it closes. */
function quickDoor(r) {
  r.walkTo(127, -0.8).walkTo(131.6, -3.2)
    .expectSignal('p2', true)
    .walkTo(133.4, 0).jumpTo(137.4, 0)
    .walkTo(138.2, 0).jumpTo(141.9, 0)
    .walkTo(142.9, 0).jumpTo(146.6, 0)
    .walkTo(147.3, 0).jumpTo(151.2, 0)
    .walkTo(151.8, 0).form('film').walkTo(157.6, 0).form('liquid')
    .walkTo(160, 0)
    .expect((s) => s.signals.get('doorB') === true, 'door B still held open')
    .walkTo(163, 0);
}

/** 5. The Kiln Steps: three big steps, (the pillar), the plate on the porch, the kiln door. */
function kilnSteps(r, shards) {
  r.walkTo(164.5, -0.8).walkTo(170.4, 0).jumpTo(174, 0).jumpTo(178, 0).jumpTo(182, 0)
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'on the top step');
  if (shards) r.walkTo(182.5, -2.4).jumpTo(182.5, -4.7).expectShards(3).walkTo(182.5, -2.4).waitUntil((s, p) => p.grounded && p.y < 3.7, { timeout: 2 });
  r.expect((s) => !s.level.exits[0].open, 'the kiln door starts shuttered')
    .walkTo(188.6, 0).expectSignal('pe', true)
    .walkTo(201.6, 0).jumpTo(207.8, 0, { run: 1.2 })
    .walkTo(216, 0).expectExit();
}

export function solve(r) {
  dripTray(r, false);
  plateGallery(r);
  squeeze(r, false);
  quickDoor(r);
  kilnSteps(r, false);
}

export function solveAll(r) {
  dripTray(r, true);
  plateGallery(r);
  squeeze(r, true);
  quickDoor(r);
  kilnSteps(r, true);
}
