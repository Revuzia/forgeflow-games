// Scripted solutions for l08 "Bone Dry". Coordinates are local to each area (the level is written the
// same way); `o` holds where each area starts in world x.

import level from '../../src/levels/l08.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const mover = (s, id) => s.level.movers.find((m) => m.id === id);
const crate = (s) => s.level.crates[0].body;
const crate2 = (s) => s.level.crates[1].body;
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const dockedA = (id, margin = 0.5) => (s) => mover(s, id).t < 0.01 && mover(s, id).wait > margin;
const atB = (id) => (s) => mover(s, id).t >= 0.999;

/** Area 1: put out two doorways of embers as a drop, water the bud, climb its leaves onto deck one. */
function planterHall(r) {
  r.walkTo(A1 + 2.4, -0.9)
    .walkTo(A1 + 15.0, 0)
    .expect((s) => !ember(s, 'embersA').doused, 'the first doorway is stuffed with embers')
    .walkTo(A1 + 17.6, 0, { timeout: 3 })
    .expect((s) => ember(s, 'embersA').doused, 'doused by touch')
    .walkTo(A1 + 29.0, 0)
    .expect((s) => !ember(s, 'embersB').doused, 'the second doorway is stuffed with embers')
    .walkTo(A1 + 31.6, 0, { timeout: 3 })
    .expect((s) => ember(s, 'embersB').doused, 'doused by touch')
    .walkTo(A1 + 42.4, 0)
    .waitUntil((s) => sprout(s, 'seedA').state === 2, { timeout: 2, label: 'the bud has grown' })
    .walkTo(A1 + 43.0, 0, { tol: 0.1 })
    .jumpTo(A1 + 43.0, 0, { tol: 0.15 }).expect((s, p) => Math.abs(p.y - 1.2) < 1e-6, 'on leaf 1')
    .jumpTo(A1 + 43.0, 0, { tol: 0.15 }).expect((s, p) => Math.abs(p.y - 2.4) < 1e-6, 'on leaf 2')
    .jumpTo(A1 + 43.0, 0, { tol: 0.15 }).expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'on the top leaf')
    .walkTo(A1 + 45.2, 0);
}

/** Area 2: film closes the first posts, crawls under the wall to the second pair, and the tall door opens. */
function electrodeDeck(r, { shard = false } = {}) {
  r.walkTo(A2 + 2.0, -0.9)
    .walkTo(A2 + 6.4, -0.3).form('film')
    .walkTo(A2 + 8.1, -0.8).walkTo(A2 + 8.1, -3.0)
    .expectSignal('arc1', true)
    .walkTo(A2 + 8.1, -0.3);
  if (shard) {
    // the second bud beside the shelf: its leaves lead up onto the shelf, where a shard waits
    r.form('liquid')
      .waitUntil((s) => sprout(s, 'seedB').state === 2, { timeout: 2, label: 'second bud grown' })
      .jumpTo(A2 + 8.6, -0.3, { hold: 0.2 }).expect((s, p) => Math.abs(p.y - 4.35) < 1e-6, 'on the low leaf')
      .jumpTo(A2 + 8.2, -0.5).expect((s, p) => Math.abs(p.y - 5.1) < 1e-6, 'on the high leaf')
      .walkTo(A2 + 9.4, -2.2).walkTo(A2 + 9.4, -2.8).expectShards(2)
      .walkTo(A2 + 8.2, 1.0, { stuck: 0, timeout: 4 }).waitUntil(landed, { timeout: 3 })
      .form('film');
  }
  r.walkTo(A2 + 16.6, 0, { timeout: 8 })
    .expect((s, p) => p.x > A2 + 14.6, 'under the wall')
    .walkTo(A2 + 28.1, 1.0).walkTo(A2 + 28.1, 2.7)
    .expectSignal('arc2', true)
    .walkTo(A2 + 28.1, 0.2).form('liquid')
    .expect((s) => s.signals.get('doorA'), 'both circuits latched: the door is open')
    .walkTo(A2 + 39.0, 0)
    .waitUntil((s) => s.level.doors[0].open >= 1, { toward: [A2 + 39.0, 0], timeout: 3, label: 'door open' })
    .walkTo(A2 + 42.4, 0.9)
    .expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] > A2 + 36, 'checkpoint beyond the door');
}

/** Area 3: as film, which the crosswind does not move, ride the two ferries over the pit. */
function ferryGallery(r) {
  r.walkTo(A3 + 2.0, -0.9)
    .walkTo(A3 + 7.6, 0).form('film')
    .walkTo(A3 + 9.4, 0)
    .waitUntil(dockedA('ferryA'), { timeout: 14, label: 'first ferry docks on our side' })
    .walkTo(A3 + 11.5, 0)
    .waitUntil(atB('ferryA'), { timeout: 8, label: 'carried across the first pit' })
    .walkTo(A3 + 18.8, -0.9)
    // film cannot break the glass across the island: ice, with the run of the island
    .form('ice')
    .waitUntil((s) => pane(s, 'islandPane').broken, { mx: 1, timeout: 8, label: 'glass across the island smashed' })
    .stop()
    .walkTo(A3 + 26.6, 0, { tol: 0.4 })
    .waitUntil(dockedA('ferryB'), { timeout: 14, label: 'second ferry docks at the island' })
    .walkTo(A3 + 27.5, 0).stop()
    .waitUntil(atB('ferryB'), { timeout: 8, label: 'carried across the second pit' })
    .walkTo(A3 + 36, 0).form('liquid')
    .walkTo(A3 + 43.4, 0);
}

/** Area 4: steam up through the hatch in the loft floor. */
function hatchDeck(r) {
  r.walkTo(A4 + 2.0, -0.9)
    .walkTo(A4 + 24.4, 0).waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s, p) => p.y > 7.9, { toward: [A4 + 24.4, 0], timeout: 4, label: 'through the hatch' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 7.8) < 1e-6, 'standing on the loft');
}

/** Area 5: ice shoves the crate south into the lane, then east along the loft and over the edge onto the heavy plate. */
function theLoft(r) {
  r.walkTo(A5 + 1.6, 0.9, { y: 7.8 })
    .expect((s) => s.checkpoint !== null && s.checkpoint.pos[1] === 7.8, 'checkpoint lit on the loft')
    .walkTo(A5 + 1.2, -3.2).form('ice')
    .walkTo(A5 + 4.2, -3.2, { tol: 0.25 }).stop()
    .waitUntil((s) => crate(s).z >= -0.15, { mz: 1, timeout: 8, label: 'crate pushed south into the lane' })
    .stop()
    .walkTo(A5 + 2.4, crate(r.sim).z, { tol: 0.3 }).stop()
    .waitUntil((s) => crate(s).y < 7.0, { mx: 1, timeout: 20, label: 'crate pushed off the edge' })
    .waitUntil((s) => s.level.plates[0].pressed, { timeout: 3, label: 'the crate lands on the heavy plate' })
    .expect((s) => s.level.plates[0].by === 'crate' || s.level.plates[0].by === 'player', 'plate is down');
  // ice may already be on its way over the edge; whatever lands, drop back to a drop and look at the plate
  r.waitUntil(landed, { timeout: 3, label: 'on the lower floor' })
    .stop({ coast: true })
    .form('liquid')
    .expect((s) => s.level.plates[0].by === 'crate', 'the first crate (not Mote) holds the first plate')
    // down off the edge into the yard, then back up to the loft as steam in the warm draught by the edge
    .walkTo(A5 + 45.4, -0.4, { y: 3.6 })
    .expect((s, p) => p.grounded && Math.abs(p.y - 3.6) < 1e-6, 'down in the yard')
    .walkTo(A5 + 43.5, -2.8, { tol: 0.3 }).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.y > 7.9, { toward: [A5 + 43.5, -2.8], timeout: 4, label: 'up the warm draught' })
    .waitUntil((s, p) => p.x < A5 + 41.5, { toward: [A5 + 39, -2.8], timeout: 4, label: 'over the loft edge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.8) < 1e-6, 'back on the loft')
    .walkTo(A5 + 28.4, 0.4).walkTo(A5 + 28.6, crate2(r.sim).z, { tol: 0.3 }).form('ice').stop()
    .waitUntil((s) => crate2(s).y < 7.0, { mx: 1, timeout: 14, label: 'second crate pushed off the edge' })
    .waitUntil((s) => s.level.plates[1].pressed, { timeout: 3, label: 'the second crate lands on the second plate' })
    .waitUntil(landed, { timeout: 3, label: 'on the lower floor again' })
    .stop({ coast: true })
    .form('liquid')
    .expect((s) => s.level.plates[1].by === 'crate', 'the second crate holds the second plate')
    .path([[A5 + 44.6, 0.8], [A5 + 48, 1.0], [A5 + 62, 0]]).walkTo(A5 + 67.4, 0).expectExit();
}

export function solve(r) {
  planterHall(r);
  electrodeDeck(r);
  ferryGallery(r);
  hatchDeck(r);
  theLoft(r);
}

export function solveAll(r) {
  planterHall(r);
  r.expectShards(1);                                    // shard 0 sits over the top leaf
  electrodeDeck(r, { shard: true });                    // shard 1: the second bud's leaves lead up onto the shelf
  ferryGallery(r);
  // shard 2: the caged one. In as a cloud, out as a cloud.
  r.walkTo(A4 + 2.0, -0.9)
    .walkTo(A4 + 14, 2.4).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [A4 + 14, 5.5], timeout: 5, label: 'shard in the cage' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => p.z > 4.5, 'inside the cage')
    .waitUntil(full, { timeout: 3, label: 'gauge refilled inside' })
    .form('steam')
    .waitUntil((s, p) => p.z < 3.5, { toward: [A4 + 14, 2.0], timeout: 4, label: 'out through the grate' })
    .form('liquid').waitUntil(landed, { timeout: 3 });
  hatchDeck(r);
  theLoft(r);
}
