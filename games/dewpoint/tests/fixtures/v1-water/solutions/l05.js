// Scripted solutions for l05 "Hung Out to Dry".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const mover = (s, id) => s.level.movers.find((m) => m.id === id);

/** Chasm 1: wait for the ferry to dock, ride it across, step off. */
function ferry(r) {
  r.walkTo(9.3, 0)
    .waitUntil((s) => mover(s, 'ferry').t < 0.01, { timeout: 8, label: 'ferry docks on our side' })
    .walkTo(11.5, 0)
    .waitUntil((s) => mover(s, 'ferry').t >= 0.999, { timeout: 5, label: 'carried across' })
    .expect((s, p) => p.x > 14 && p.grounded, 'standing on the ferry at the far dock')
    .walkTo(18.6, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

/** Hall B: ice shoves the crate onto the heavy plate (two legs); the bridge slides out and stays. */
function bridge(r) {
  r.expect((s) => mover(s, 'bridge').t === 0, 'bridge starts retracted')
    .walkTo(22.4, 0).form('ice')
    .walkTo(22.4, -3.2, { tol: 0.3 }).walkTo(24, -3.2, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.z >= 1.75, { mz: 1, timeout: 8, label: 'crate pushed south' })
    .stop()
    .walkTo(22.4, 0.7, { tol: 0.3 }).walkTo(22.4, 1.8, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.x >= 36.2, { mx: 1, timeout: 14, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('hp', true)
    .form('liquid')
    .walkTo(39.2, 0)
    .waitUntil((s) => mover(s, 'bridge').t >= 0.999, { toward: [39.2, 0], timeout: 6, label: 'bridge fully out' })
    .walkTo(46, 0).walkTo(49.8, 0)
    .expect((s) => s.checkpoint !== null && mover(s, 'bridge').t >= 0.999, 'across, bridge still out (the crate holds the plate)');
}

/** Hall C: the lift to its top, then steam up through the roof hatch to the gallery. */
function chimney(r) {
  r.walkTo(60.6, 0)
    .waitUntil((s) => mover(s, 'elevator').t < 0.01, { timeout: 12, label: 'lift docks at the bottom' })
    .walkTo(63.5, 0)
    .waitUntil((s) => mover(s, 'elevator').t >= 0.999, { timeout: 6, label: 'lift reaches the top' })
    .expect((s, p) => p.y > 4 && p.grounded, 'riding at the top of the shaft')
    .form('steam')
    .waitUntil((s, p) => p.y > 7.6, { timeout: 5, label: 'up through the hatch' })
    .waitUntil((s, p) => p.x > 66, { mx: 1, timeout: 3, label: 'over the gallery' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6, 'on the gallery')
    .walkTo(72.4, 0).expectExit();
}

export function solve(r) {
  ferry(r);
  bridge(r);
  chimney(r);
}

export function solveAll(r) {
  // shard 1 (easy): on the stack of boards near the start
  r.walkTo(5.2, 3.2).jumpTo(6.8, 3.2).expectShards(1)
    .walkTo(5.4, 3.0).waitUntil(landed, { timeout: 2 });
  ferry(r);
  // shard 2: ride the lift to the rack, then step off the front of it
  r.walkTo(30.7, 0)
    .waitUntil((s) => mover(s, 'lift').t < 0.01, { timeout: 10, label: 'rack lift docks' })
    .walkTo(30.7, -3)
    .waitUntil((s) => mover(s, 'lift').t >= 0.999, { timeout: 6, label: 'lift at the rack' })
    .walkTo(34, -3).expectShards(2)
    .walkTo(33, -1.4).waitUntil(landed, { timeout: 3, label: 'dropped off the rack' });
  // shard 3: as steam, in through the bars and out again
  r.walkTo(27.75, 2.4).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [27.75, 5.5], timeout: 4, label: 'shard in the cage' })
    .waitUntil((s, p) => p.z < 3.5, { toward: [27.75, 2.6], timeout: 4, label: 'back out through the bars' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y) < 1e-6 && p.z < 4, 'back in the hall');
  bridge(r);
  chimney(r);
}
