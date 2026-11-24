// Scripted solutions for l09 "Heat Haze".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const crate = (s) => s.level.crates[0].body;

/** Hall 1: walk into the vent and let it lift you over the cliff. */
function liftOverTheCliff(r, hold) {
  r.walkTo(5.2, 0).walkTo(7.5, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the vent boiled Mote')
    .waitUntil((s, p) => p.y > hold, { toward: [7.5, 0], timeout: 8, label: 'rising in the haze' })
    .waitUntil((s, p) => p.x > 9.7, { mx: 1, timeout: 3, label: 'over the cliff edge' })
    .form('liquid', { expect: true }).waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 4.8) < 1e-6 && p.x > 9, 'on hall 2');
}

/** Hall 2: ice shoves the crate into the haze, the plate goes down, the door opens. */
function crateOntoTheHotPlate(r) {
  r.walkTo(10.2, 0).stop().form('ice')
    .waitUntil((s) => s.signals.get('p1'), { toward: [20, 0], timeout: 12, label: 'crate pressing the plate in the haze' })
    .stop()
    .expect((s, p) => p.form === 'ice', 'still ice, still outside the vent')
    .expect((s) => s.level.plates[0].by === 'crate', 'the crate holds the plate')
    .form('liquid')
    .path([[13, 2.9], [18.6, 2.9], [24.2, 0]], { stuck: 0 })
    .expect((s) => s.level.doors[0].open >= 1, 'door open');
}

/** Hall 3: haze to haze across the chasm. `keep` = stay in the far column until its shard is taken. */
function acrossTheChasm(r, keep) {
  r.walkTo(27.6, 0).waitUntil(full, { timeout: 3 })
    .expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(29.4, 0)
    .walkTo(31, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'launch vent boiled Mote')
    .waitUntil((s, p) => p.x > 41.9, { toward: [43.2, 0.4], timeout: 5, label: 'into the middle vent' })
    .expect((s, p) => p.gauge > 3.99 || p.gauge > 3.5, 'gauge is topped up inside the vent');
  if (keep) r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [43.2, 1.0], timeout: 6, label: 'the shard high in the column' });
  r.waitUntil((s, p) => p.x > 53, { toward: [55, 0], timeout: 6, label: 'across' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 8.4) < 1e-6 && p.x > 52, 'on the far side');
}

export function solve(r) {
  liftOverTheCliff(r, 5.3);
  crateOntoTheHotPlate(r);
  acrossTheChasm(r, false);
  r.walkTo(63, 0).expectExit();
}

export function solveAll(r) {
  liftOverTheCliff(r, 5.3);
  r.walkTo(10.3, 0).expectShards(1);                   // shard on the landing
  // shard on the cap: boil in the vent, drift out the west side, climb round the cap and settle on top
  r.path([[10.3, 2.9], [14.6, 2.9]]).walkTo(14.6, 0.6, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'boiled in the cap vent')
    .waitUntil((s, p) => p.x < 13.0, { mx: -1, timeout: 3, label: 'out of the haze, west' })
    .waitUntil((s, p) => p.y > 7.7, { mx: -0.2, timeout: 3, label: 'above the cap' })
    .waitUntil((s) => s.shardsTaken.length === 2, { toward: [15.5, 0], timeout: 4, label: 'shard on the cap' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.5) < 1e-6, 'on the cap')
    .walkTo(13.8, 2.9, { stuck: 0 }).waitUntil(landed, { timeout: 3 });
  r.walkTo(10.2, 0);
  crateOntoTheHotPlate(r);
  acrossTheChasm(r, true);
  r.walkTo(63, 0).expectExit();
}
