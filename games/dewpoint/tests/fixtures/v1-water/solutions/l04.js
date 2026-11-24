// Scripted solutions for l04 "Slip Casting".

const landed = (s, p) => p.grounded;

/** Hall A: film through the sieve, stand up in the basin, walk under the wall and up the ramp. */
function underTheWall(r) {
  r.walkTo(9, 0).form('film')
    .waitUntil((s, p) => p.grounded && p.y < -1, { timeout: 3, label: 'dropped through the slats into the basin' })
    .form('liquid')
    .walkTo(14, 0).walkTo(21.5, 0, { y: 0 })
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'up the ramp, back on the floor')
    .walkTo(22.4, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

/** Hall B: crawl under the low wall, lie across the posts, walk through the door they open. */
function theFirstPosts(r) {
  r.walkTo(26.2, 0).form('film').walkTo(31.1, 0)
    .expectSignal('e1', true)
    .form('liquid')
    .walkTo(34.4, 0)
    .expect((s) => s.level.doors.find((d) => d.id === 'doorA').open >= 0, 'door A responding')
    .waitUntil((s) => s.level.doors.find((d) => d.id === 'doorA').open >= 1, { toward: [34.4, 0], timeout: 2, label: 'door A open' })
    .walkTo(37.2, -0.4)
    .expect((s) => s.signals.get('e1') === false, 'the door stays open after the film leaves (latched)');
}

/** Room C: ice shoves the crate onto the heavy plate (two legs), then film closes the second circuit. */
function heavyAndThin(r) {
  r.expectSignal('exitOpen', false)
    .form('ice')
    .walkTo(40.5, -3.3, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.z >= 1.95, { mz: 1, timeout: 8, label: 'crate pushed south' })
    .stop()
    .walkTo(38.6, 0.7, { tol: 0.3 }).walkTo(38.6, 2.0, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.x >= 47.4, { mx: 1, timeout: 10, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('hp', true)
    .form('liquid')
    .walkTo(52.2, 0).form('film').walkTo(57.1, 0)
    .expectSignal('e2', true)
    .form('liquid')
    .expect((s) => s.level.exits[0].open, 'exit unsealed: crate on the plate and the posts closed once')
    .walkTo(61.6, 0).expectExit();
}

export function solve(r) {
  underTheWall(r);
  theFirstPosts(r);
  heavyAndThin(r);
}

export function solveAll(r) {
  // shard 1 (easy): up on the stack of moulds beside the wall
  r.walkTo(9.3, -3.25).jumpTo(10.75, -3.25).expectShards(1)
    .walkTo(9.2, -3.0).waitUntil(landed, { timeout: 2 });
  // shard 2 (the pen): drop into the casting pen, lie across its posts, collect, walk out through its door
  r.walkTo(3.6, -2.0).form('film')
    .waitUntil((s, p) => p.grounded && p.y < -1, { timeout: 3, label: 'dropped into the pen' })
    .expect((s) => !s.level.doors.find((d) => d.id === 'penDoor').open, 'pen is sealed')
    .waitUntil((s) => s.signals.get('e3'), { timeout: 1, label: 'posts live' })
    .walkTo(3.0, -3.35).expectShards(2)
    .walkTo(4.5, -2.5)
    .waitUntil((s) => s.level.doors.find((d) => d.id === 'penDoor').open >= 1, { timeout: 2, label: 'pen door open' })
    .form('liquid').walkTo(6.4, -2.5)
    .expect((s, p) => p.y < -1, 'out of the pen, still in the basin');
  // the rest of the level (the basin leads under the wall), picking up shard 3 under the shelf in room C
  r.walkTo(14, 0).walkTo(21.5, 0, { y: 0 }).walkTo(22.4, 0);
  theFirstPosts(r);
  r.walkTo(41.6, -1.0).walkTo(44.7, -1.9).form('film').walkTo(44.7, -3.3).expectShards(3)
    .walkTo(44.7, -1.9).form('liquid');
  heavyAndThin(r);
}
