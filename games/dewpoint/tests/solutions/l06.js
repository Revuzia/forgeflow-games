// Scripted solutions for l06 "Greenware". Coordinates are local to each area (the level is written the
// same way); `o` holds where each area starts in world x.

import level from '../../src/levels/l06.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const door = (s, id) => s.level.doors.find((d) => d.id === id);

/** Walk into a doorway of embers as a drop: they are out for good the moment water touches them. */
function douse(r, id, from, into) {
  r.walkTo(from, 0)
    .expect((s) => !ember(s, id).doused, `${id}: the doorway is stuffed with embers`)
    .walkTo(into, 0, { timeout: 3 })
    .expect((s) => ember(s, id).doused, `${id}: doused by touch`);
}

/** Water a bud (stand beside it) and hop up its leaves. */
function climb(r, id, x, z, hops, top) {
  r.walkTo(x - 0.5, z)
    .waitUntil((s) => sprout(s, id).state === 2, { timeout: 3, label: `${id} grown` })
    .walkTo(x, z, { tol: 0.1 });
  for (let i = 0; i < hops; i++) r.jumpTo(x, z, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - top) < 1e-6, `on the top leaf of ${id}`);
}

/** Area 1: run into the embers as a drop, water the bud, hop up its leaves. */
function clayStore(r, { nook = false } = {}) {
  r.walkTo(A1 + 2.4, -0.9);
  douse(r, 'doorEmbers', A1 + 20.6, A1 + 23.4);
  if (nook) {
    r.walkTo(A1 + 29, -2.6).walkTo(A1 + 29, -6, { tol: 0.25 }).expectShards(2)
      .expect((s) => ember(s, 'nookEmbers').doused, 'nook embers doused')
      .walkTo(A1 + 29, -2.6);
  }
  climb(r, 'bud1', A1 + 33, 0, 3, 3);
}

/** Area 2: the bud by the sacks, up to the mezzanine, the embers in the cross wall, a second bud and doorway, down the ramp. */
function slipHouse(r) {
  r.walkTo(A2 + 2.2, -0.9)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
  climb(r, 'budB', A2 + 8.0, 0, 3, 6.6);
  r.walkTo(A2 + 12, 0, { y: 6.6 });
  douse(r, 'houseEmbers', A2 + 14.0, A2 + 16.8);
  climb(r, 'budC', A2 + 21.8, 0, 3, 9.6);
  r.walkTo(A2 + 26, 0, { y: 9.6 });
  douse(r, 'atticEmbers', A2 + 28.2, A2 + 30.8);
  r.walkTo(A2 + 36, 0).walkTo(A2 + 47.6, 0, { slow: false })
    .waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 3) < 0.05, 'down the ramp');
}

/** Steam up beside an ember on a pillar, float over it, condense: the rain puts it out. */
function rainOn(r, id, over, y, stand) {
  r.waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.y > y && Math.hypot(p.x - over[0], p.z - over[1]) < 0.4, { toward: over, timeout: 6, label: `hovering above ${id}` })
    .form('liquid')
    .waitUntil((s) => ember(s, id).doused, { timeout: 3, label: `rain put ${id} out` })
    .waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - stand) < 1e-6, `standing on the pillar of ${id}`);
}

/** Area 3: three pillars, three rains from three heights; the gate opens. */
function rainGallery(r) {
  r.walkTo(A3 + 2.2, -0.9).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .expect((s) => !door(s, 'gate').open, 'the gate is shut')
    .walkTo(A3 + 8, 0);
  rainOn(r, 'pillarA', [A3 + 11, -2], 5.7, 5.2);
  r.expectSignal('pa', true).expectSignal('pb', false)
    .walkTo(A3 + 12.6, -2.2).waitUntil(landed, { timeout: 3, label: 'down off the pillar' })
    .walkTo(A3 + 13.2, 2.2).jumpTo(A3 + 15.0, 2.2).expect((s, p) => Math.abs(p.y - 4.2) < 1e-6, 'on the stone step');
  rainOn(r, 'pillarB', [A3 + 17, 2], 6.7, 6.2);
  r.expectSignal('pb', true).expectSignal('pc', false)
    .walkTo(A3 + 19.0, 0.6).waitUntil(landed, { timeout: 3, label: 'down off the pillar' });
  climb(r, 'budD', A3 + 21.4, -2.0, 3, 6.2);
  rainOn(r, 'pillarC', [A3 + 26, -2], 8.5, 8.0);
  r.expectSignal('pc', true).expectSignal('pd', false);
  rainOn(r, 'pillarD', [A3 + 29.6, 2], 10.7, 10.2);
  r.expectSignal('pd', true)
    .walkTo(A3 + 31.0, 0.6).waitUntil(landed, { timeout: 3, label: 'down off the pillar' })
    .walkTo(A3 + 31.4, 0)
    .waitUntil((s) => door(s, 'gate').open >= 1, { toward: [A3 + 31.4, 0], timeout: 3, label: 'gate open' })
    .walkTo(A3 + 39, 0);
}

/** Area 4: in through the bars as a cloud, from bench to bench, rain beside the bud, up the ladder. */
function greenhouse(r) {
  r.walkTo(A4 + 2.2, -0.9).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(A4 + 8.0, 0).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.x > A4 + 11.5 && p.x < A4 + 14 && p.y > 3.6, { toward: [A4 + 12.8, 0], timeout: 5, label: 'in through the bars, over the first bench' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6 && p.x > A4 + 10.5 && p.x < A4 + 14.5, 'standing on the first bench')
    .walkTo(A4 + 14.0, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled on the bench' }).form('steam')
    .waitUntil((s, p) => p.x > A4 + 21 && p.x < A4 + 24, { toward: [A4 + 22.5, 0], timeout: 5, label: 'over the second bench' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6 && p.x > A4 + 20.5, 'standing on the second bench')
    .walkTo(A4 + 24.0, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled on the bench' }).form('steam')
    .waitUntil((s, p) => p.x > A4 + 31 && p.x < A4 + 34, { toward: [A4 + 32.5, 0], timeout: 5, label: 'over the third bench' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6 && p.x > A4 + 30.5, 'standing on the third bench');
  climb(r, 'budG', A4 + 34.4, 0, 8, 12.6);
}

/** Area 5: out onto the catwalk, down the ramp, cloud over the pit onto the ledge, climb the last bud, the last embers. */
function kilnGarden(r) {
  r.walkTo(A5 + 2, -0.9, { y: 12.6 }).expect((s) => s.checkpoint !== null, 'checkpoint lit on the catwalk')
    .walkTo(A5 + 8, 0).walkTo(A5 + 31.4, -0.9, { slow: false })
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 0.05 && s.checkpoint.pos[1] === 3, 'down in the garden')
    .walkTo(A5 + 36.2, 0).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.x > A5 + 42.4 && p.x < A5 + 47.4 && p.y > 3.2, { toward: [A5 + 44.5, 0], timeout: 6, label: 'over the island' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6 && p.x > A5 + 42, 'on the island')
    .walkTo(A5 + 47.4, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled on the island' }).form('steam')
    .waitUntil((s, p) => p.x > A5 + 53.6 && p.y > 5.8, { toward: [A5 + 55.5, 0], timeout: 6, label: 'over the pit and above the ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 5.6) < 1e-6, 'on the ledge');
  climb(r, 'bud2', A5 + 57.0, 0, 8, 14.8);
  douse(r, 'kilnEmbers', A5 + 64.6, A5 + 67.4);
  r.walkTo(A5 + 75.4, 0).expectExit();
}

export function solve(r) {
  clayStore(r);
  slipHouse(r);
  rainGallery(r);
  greenhouse(r);
  r.walkTo(A5 - 0.2, 0, { y: 12.6 });
  kilnGarden(r);
}

export function solveAll(r) {
  // shard 0 (easy): on the stack of moulds
  r.walkTo(A1 + 9.8, 3.2).jumpTo(A1 + 11.2, 3.2).expectShards(1)
    .walkTo(A1 + 9.6, 3.0).waitUntil(landed, { timeout: 2 });
  clayStore(r, { nook: true });                           // shard 1: the ember-stuffed nook
  slipHouse(r);
  rainGallery(r);
  greenhouse(r);
  // shard 2: from the top leaf, as a cloud up into the rafters and back
  r.waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [A4 + 34.4, 2.2], timeout: 5, label: 'shard in the rafters' })
    .waitUntil((s, p) => Math.hypot(p.x - (A4 + 34.4), p.z) < 0.4, { toward: [A4 + 34.4, 0], timeout: 4, label: 'back above the leaf' })
    .form('liquid').waitUntil(landed, { timeout: 4 })
    .expect((s, p) => Math.abs(p.y - 12.6) < 1e-6, 'back on the top leaf');
  r.walkTo(A5 - 0.2, 0, { y: 12.6 });
  kilnGarden(r);
}
