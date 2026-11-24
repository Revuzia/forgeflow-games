// Scripted solutions for l05 "Hung Out to Dry". Coordinates are local to each area (the level is
// written the same way); `o` holds where each area starts in world x.

import level from '../../src/levels/l05.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const mover = (s, id) => s.level.movers.find((m) => m.id === id);
const crate = (s) => s.level.crates[0].body;
const crate2 = (s) => s.level.crates[1].body;
/** A mover that has docked at its start and will sit there a moment longer. */
const dockedA = (id, margin = 0.5) => (s) => mover(s, id).t < 0.01 && mover(s, id).wait > margin;
const atB = (id) => (s) => mover(s, id).t >= 0.999;

/** Stand at the edge, wait for the platform to dock, step on, ride it across, step off at `offX`. */
function crossOn(r, id, edgeX, deckX, offX, opts = {}) {
  r.walkTo(edgeX, 0)
    .waitUntil(dockedA(id, opts.margin), { timeout: 12, label: `${id} docks on our side` })
    .walkTo(deckX, 0)
    .waitUntil(atB(id), { timeout: 8, label: `${id} carries us across` })
    .walkTo(offX, 0);
}

/** Area 1: the tram over the slip trough, then the ferry over the kiln pit. */
function dryingRacks(r) {
  r.walkTo(A1 + 2.4, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit at the start');
  crossOn(r, 'tram', A1 + 9.4, A1 + 11.5, A1 + 19);
  crossOn(r, 'ferry', A1 + 27.4, A1 + 29.5, A1 + 37.2);
  r.expect((s, p) => p.x > A2 && p.grounded && Math.abs(p.y) < 1e-6, 'across the pit');
}

/** Area 2: the hoist up to the terrace, wake the shuttle with the plate, cross the gap, walk down the ramp. */
function hoistGallery(r, { toRack = false } = {}) {
  r.walkTo(A2 + 2.2, -0.9)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(A2 + 8.2, 0)
    .waitUntil(dockedA('hoist'), { timeout: 12, label: 'hoist docks at the bottom' })
    .walkTo(A2 + 10.5, 0)
    .waitUntil(atB('hoist'), { timeout: 8, label: 'hoist reaches the terrace' })
    .walkTo(A2 + 14.2, -0.9, { y: 6 })
    .expect((s, p) => Math.abs(p.y - 6) < 1e-6, 'on the terrace')
    .walkTo(A2 + 19.4, -1.6)
    .expectSignal('wake', true)
    .walkTo(A2 + 21.2, 0)
    .waitUntil(dockedA('shuttle'), { timeout: 12, label: 'shuttle docks on the terrace' })
    .walkTo(A2 + 23.5, 0)
    .waitUntil(atB('shuttle'), { timeout: 8, label: 'shuttle carries us over the gap' })
    .walkTo(A2 + 30.5, 0)
    .expect((s, p) => Math.abs(p.y - 6) < 1e-6 && p.x > A2 + 29, 'on the far terrace');
  if (toRack) {
    r.walkTo(A2 + 33.5, 0.2)
      .waitUntil(dockedA('rackLift'), { timeout: 12, label: 'rack lift docks' })
      .walkTo(A2 + 33.5, -2.6)
      .waitUntil(atB('rackLift'), { timeout: 8, label: 'rack lift at the top' })
      .walkTo(A2 + 38.2, -2.3).expectShards(2)
      .walkTo(A2 + 36.4, -2.3)
      .waitUntil((s) => mover(s, 'rackLift').t >= 0.999 && mover(s, 'rackLift').wait > 0.7, { timeout: 10, label: 'lift parked at the top' })
      .walkTo(A2 + 33.5, -2.6)
      .waitUntil((s) => mover(s, 'rackLift').t <= 0.001, { timeout: 10, label: 'lift back down' })
      .walkTo(A2 + 33.5, 0.2);
  }
  r.walkTo(A2 + 42, 0).walkTo(A2 + 53.4, 0, { slow: false })
    .waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y) < 0.05, 'down the ramp');
}

/** Area 3: ice shoves the crate south into the ferry's lane, onto the ferry, across, and onto the heavy plate. */
function pressingRoom(r) {
  r.walkTo(A3 + 2.2, -0.9)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(A3 + 3.4, -3.2).form('ice')
    .walkTo(A3 + 5.4, -3.2, { tol: 0.25 }).stop()
    .waitUntil((s) => crate(s).z >= -0.15, { mz: 1, timeout: 8, label: 'crate pushed south into the lane' })
    .stop()
    .walkTo(A3 + 3.6, -0.6, { tol: 0.3 }).walkTo(A3 + 4.0, crate(r.sim).z, { tol: 0.25 }).stop()
    .waitUntil((s) => crate(s).x >= A3 + 12.6, { mx: 1, timeout: 14, label: 'crate pushed to the edge of the pit' })
    .stop()
    .waitUntil(dockedA('barge', 1.2), { timeout: 12, label: 'barge docks on our side' })
    .waitUntil((s) => crate(s).x >= A3 + 15.4, { mx: 1, timeout: 5, label: 'crate pushed on board' })
    .stop()
    .waitUntil(atB('barge'), { timeout: 10, label: 'barge carries crate and ice across' })
    .expect((s, p) => p.x > A3 + 19 && crate(s).x > A3 + 19, 'both across')
    .waitUntil((s) => crate(s).x >= A3 + 27.2, { mx: 1, timeout: 14, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('hp', true)
    // the second crate: the bridge stands while the first holds its plate; shove the second across it
    .path([[A3 + 27, 2.7], [A3 + 30.2, 2.7], [A3 + 30.2, 0]]).stop()
    .waitUntil(atB('bridge'), { timeout: 6, label: 'bridge fully out' })
    .waitUntil((s) => crate2(s).x >= A3 + 47.3, { mx: 1, timeout: 14, label: 'second crate pushed across the bridge onto the second plate' })
    .stop()
    .expectSignal('hp2', true)
    .form('liquid')
    .path([[A3 + 46, 2.7], [A3 + 50, 2.7], [A3 + 53.5, 0]])
    .waitUntil((s) => s.level.doors[0].open >= 1, { toward: [A3 + 53.5, 0], timeout: 4, label: 'second door open' })
    .walkTo(A3 + 57, 0)
    .expect((s) => mover(s, 'bridge').t >= 0.999, 'across, and the first crate still holds the plate');
}

/** Area 4: the lift to the top of the sealed shaft, then steam up through the roof grate. */
function chimneyStack(r) {
  r.walkTo(A4 + 2.2, -0.9)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(A4 + 10.4, 0)
    .waitUntil(dockedA('elevator'), { timeout: 12, label: 'lift docks at the bottom' })
    .walkTo(A4 + 13.5, 0)
    .waitUntil(atB('elevator'), { timeout: 8, label: 'lift reaches the top' })
    .expect((s, p) => p.y > 4 && p.grounded, 'riding at the top of the shaft')
    .form('steam')
    .waitUntil((s, p) => p.y > 8.5, { timeout: 5, label: 'up through the roof grate' })
    .waitUntil((s, p) => p.x > A4 + 15.85, { mx: 1, timeout: 4, label: 'over the gallery' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 8.4) < 1e-6, 'on the gallery')
    .walkTo(A4 + 18.2, 0);
}

/** Area 5: two ferries out over the pit, the second climbing to the kiln door. */
function roofGantry(r) {
  r.walkTo(A5 + 1.4, -0.9)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit at the gallery end');
  crossOn(r, 'gantry1', A5 + 3.2, A5 + 5.5, A5 + 13.2);
  r.walkTo(A5 + 17.2, 0);
  r.waitUntil(dockedA('gantry2'), { timeout: 12, label: 'second ferry docks at the pier' })
    .walkTo(A5 + 19.5, 0)
    .waitUntil(atB('gantry2'), { timeout: 10, label: 'second ferry climbs to the tower' })
    .walkTo(A5 + 29, 0)
    .expect((s, p) => Math.abs(p.y - 11.5) < 1e-6, 'on the kiln tower')
    .walkTo(A5 + 36.6, 0).expectExit();
}

export function solve(r) {
  dryingRacks(r);
  hoistGallery(r);
  pressingRoom(r);
  chimneyStack(r);
  roofGantry(r);
}

export function solveAll(r) {
  // shard 0 (easy): the stack of boards near the start
  r.walkTo(A1 + 4.4, 3.2).jumpTo(A1 + 6.0, 3.2).expectShards(1)
    .walkTo(A1 + 4.6, 3.0).waitUntil(landed, { timeout: 2 });
  dryingRacks(r);
  // shard 1 (side route): the rack lift on the far terrace
  hoistGallery(r, { toRack: true });
  pressingRoom(r);
  // shard 2: the cage in the south wall - in as a cloud, out as a cloud
  r.walkTo(A4 + 2.2, -0.9)
    .walkTo(A4 + 5, 2.4).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [A4 + 5, 5.5], timeout: 5, label: 'shard in the cage' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .waitUntil(full, { timeout: 4, label: 'gauge refilled inside' })
    .form('steam')
    .waitUntil((s, p) => p.z < 3.5, { toward: [A4 + 5, 2.0], timeout: 4, label: 'back out through the bars' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y) < 1e-6 && p.z < 4, 'back in the hall');
  chimneyStack(r);
  roofGantry(r);
}
