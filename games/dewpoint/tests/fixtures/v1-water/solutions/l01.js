// Scripted solutions for l01 "First Drip". See LEVELS.md ("Proving a level solvable").
// solve(r): shortest honest route to the exit.  solveAll(r): the same plus all three shards.

function toDoorA(r, shards) {
  r.walkTo(8.2, 0).jumpTo(13.6, 0, { run: 1.5 });          // the first gap
  if (shards) {
    r.walkTo(14.8, -2.5).jumpTo(16.25, -2.5).expectShards(1);   // shard on the step
    r.walkTo(18.2, -2.5);
  } else {
    r.walkTo(14.8, 0).jumpTo(16.25, 0).walkTo(18.2, 0);
  }
  r.walkTo(20, 2.2)                                         // plate -> latched door
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 3, label: 'door A open' })
    .walkTo(21.8, 0).walkTo(24.8, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

function underFirstWall(r) {
  r.walkTo(28.3, 0).form('film').walkTo(31.9, 0);
}

function timedDoor(r) {
  r.walkTo(32.5, -2.2)                                      // timed plate (film presses light plates)
    .expectSignal('doorB', true)
    .form('liquid')
    .walkTo(34.45, -1).form('film').walkTo(37.2, -0.5).form('liquid')
    .walkTo(39.2, 0).walkTo(41.6, 0)
    .expect((s, p) => p.x > 40.5, 'through door B before it closed');
}

export function solve(r) {
  toDoorA(r, false);
  underFirstWall(r);
  timedDoor(r);
  r.walkTo(48.6, 0).expectExit();
}

export function solveAll(r) {
  toDoorA(r, true);
  underFirstWall(r);
  r.walkTo(32.5, 2.3).walkTo(32.5, 3.3).expectShards(2)     // under the shelf, as film
    .walkTo(32.5, 2.0);
  timedDoor(r);
  r.walkTo(43.75, -1.9).jumpTo(43.75, -3.2)                 // two big steps
    .jumpTo(45.25, -3.25).expectShards(3)
    .walkTo(46.6, -3.2).walkTo(48.6, 0).expectExit();
}
