// Scripted solutions for l03 "Head of Steam".

const full = (s, p) => p.gauge >= 3.99;
const landed = (s, p) => p.grounded;

function upTheCliff(r) {
  r.walkTo(6.9, 0).form('steam')
    .waitUntil((s, p) => p.x > 9.2 && p.y > 3.6, { mx: 1, timeout: 4.2, label: 'over the cliff edge' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'on the cliff top');
}

function throughTheGrate(r) {
  r.walkTo(15.2, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled' })
    .form('steam')
    .waitUntil((s, p) => p.x > 17.1, { mx: 1, timeout: 4, label: 'through the grate' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .walkTo(18.2, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

function acrossTheChasm(r) {
  r.waitUntil(full, { timeout: 3, label: 'gauge refilled' })
    .walkTo(19.5, 0).form('steam')
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 4, label: 'blown across and condensed by the cold' })
    .expect((s, p) => p.x > 38.5 && p.gauge > 0.5, 'condensed by the cold zone, not by an empty gauge')
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6 && p.x > 38, 'on the far platform');
}

function startTheShaft(r) {
  r.walkTo(45, -2.6).expectSignal('p3', true)
    .walkTo(48.7, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled' })
    .expect((s) => s.level.fans[1].active, 'shaft fan latched on');
}

function upTheShaft(r) {
  r.waitUntil((s, p) => p.y > 14.3, { toward: [48.7, 0], timeout: 4, label: 'above the tower top' })
    .waitUntil((s, p) => p.x > 51.2, { mx: 1, timeout: 3, label: 'over the tower' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 14) < 1e-6, 'on the tower')
    .walkTo(54.4, 0).expectExit();
}

export function solve(r) {
  upTheCliff(r);
  throughTheGrate(r);
  acrossTheChasm(r);
  startTheShaft(r);
  r.form('steam');
  upTheShaft(r);
}

export function solveAll(r) {
  upTheCliff(r);
  // shard 1 hangs high above the cliff top: float up to it
  r.walkTo(11, -2).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s) => s.shardsTaken.length === 1, { timeout: 3.5, label: 'shard 1' })
    .form('liquid').waitUntil(landed, { timeout: 3 });
  throughTheGrate(r);
  acrossTheChasm(r);
  // shard 2 is under the shelf: film
  r.walkTo(44.5, 1.9).form('film').walkTo(44.5, 3.3).expectShards(2).walkTo(44.5, 1.9).form('liquid');
  startTheShaft(r);
  // shard 3 floats beside the updraft: leave the column part-way up, grab it, come back
  r.form('steam')
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [48.7, -3.3], timeout: 3, label: 'shard 3' });
  upTheShaft(r);
}
