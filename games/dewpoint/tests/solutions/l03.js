// Scripted solutions for l03 "Head of Steam".

const full = (s, p) => p.gauge >= 3.99;
const landed = (s, p) => p.grounded;

/** 1. The Boiler Floor: steam up ledge 1, wait for the gauge, steam up ledge 2. */
function boilerFloor(r, shard) {
  r.walkTo(-21, -0.8).walkTo(8.9, 0).form('steam')
    .waitUntil((s, p) => p.x > 10.3 && p.y > 2.2, { mx: 1, timeout: 4.2, label: 'over the edge of ledge 1' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 2.2) < 1e-6, 'on ledge 1');
  if (shard) r.walkTo(13.5, -4.5).expectShards(1);
  r.walkTo(17, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled on ledge 1' })
    .form('steam')
    .waitUntil((s, p) => p.x > 18.4 && p.y > 5.0, { mx: 1, timeout: 4.2, label: 'over the edge of ledge 2' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 5) < 1e-6, 'on ledge 2');
}

/** 2. The Grille Wall: through the low window, up the ledge, through the high window. */
function grilleWall(r) {
  r.walkTo(31.5, -0.8).walkTo(38.2, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 41.2, { mx: 1, timeout: 4, label: 'through the low window' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .walkTo(44.6, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 46.4 && p.y > 7.4, { mx: 1, timeout: 4.2, label: 'over the edge of the ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6, 'on the ledge')
    .walkTo(54.8, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 57.2, { mx: 1, timeout: 4, label: 'through the high window' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6, 'beyond the second gate');
}

/** 3. The Great Fan: drift across two gaps (refilling on the islet), then ride the big fan; cold air brings you down on the far platform. */
function greatFan(r) {
  r.walkTo(65.5, -0.8).walkTo(73.2, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 84.2, { mx: 1, timeout: 4, label: 'across the first gap' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6 && p.x > 83, 'on the islet')
    .walkTo(86, -0.8).walkTo(88.2, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 99.2, { mx: 1, timeout: 4, label: 'across the second gap' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6 && p.x > 98, 'on the near platform')
    .walkTo(100, -0.8).walkTo(107.2, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 5, label: 'blown across and condensed by the cold' })
    .expect((s, p) => p.x > 126 && p.gauge > 0.5, 'condensed by the cold zone, not by an empty gauge')
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6 && p.x > 126, 'on the far platform');
}

/** 4. The Condenser: (the film nook), plate 1, shaft 1 to the ledge, plate 2, shaft 2 to the gallery. */
function condenser(r, shards) {
  r.walkTo(132, -0.8);
  if (shards) r.walkTo(136.5, 1.9).form('film').walkTo(136.5, 3.3).expectShards(2).walkTo(136.5, 1.9).form('liquid');
  r.expect((s) => !s.level.fans.find((f) => f.id === 'shaft').active, 'shaft 1 starts off')
    .walkTo(136.5, -1.2).form('film').walkTo(136.5, -4.7).expectSignal('p3', true)
    .walkTo(136.5, -1.6).form('liquid')
    .walkTo(140.7, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .expect((s) => s.level.fans.find((f) => f.id === 'shaft').active, 'shaft 1 latched on')
    .form('steam')
    .waitUntil((s, p) => p.y > 19.2, { toward: [140.7, 0], timeout: 4, label: 'above the ledge' })
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 3, label: 'condensed by the cold above the ledge' })
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 18.4) < 1e-6, 'on the ledge')
    .walkTo(147.5, -2.6).expectSignal('p5', true)
    .walkTo(shards ? 151.2 : 151.7, shards ? -3.3 : 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .expect((s) => s.level.fans.find((f) => f.id === 'shaft2').active, 'shaft 2 latched on')
    .form('steam');
  // the shard hangs beside the updraft: rise slowly beside the shaft to it, then step into the column
  if (shards) r.waitUntil((s) => s.shardsTaken.length === 3, { mx: 0, mz: 0, timeout: 3.5, label: 'shard beside the updraft' });
  r.waitUntil((s, p) => p.y > 28.2, { toward: [151.7, 0], timeout: 4, label: 'above the gallery wall' })
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 3, label: 'condensed by the cold ceiling' })
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 27.6) < 1e-6, 'on the gallery');
}

/** 5. The Flue Top: into the cage as steam, rain onto the plate, out again, ride the gale to the kiln door. */
function flueTop(r) {
  r.walkTo(158.6, -0.8).walkTo(159.6, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 163.6, { mx: 1, timeout: 4, label: 'into the cage' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expectSignal('p4', true)
    .expectSignal('galeOn', true)
    .waitUntil(full, { timeout: 3, label: 'gauge refilled in the cage' })
    .form('steam')
    .waitUntil((s, p) => p.x < 160.2, { toward: [158.6, 0], timeout: 4, label: 'out of the cage' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .walkTo(160, 4.8).walkTo(169, 4.8).walkTo(177.4, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 6, label: 'carried across and condensed by the cold' })
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 27.6) < 1e-6 && p.x > 212, 'on the kiln platform')
    .walkTo(225, 0).expectExit();
}

export function solve(r) {
  boilerFloor(r, false);
  grilleWall(r);
  greatFan(r);
  condenser(r, false);
  flueTop(r);
}

export function solveAll(r) {
  boilerFloor(r, true);
  grilleWall(r);
  greatFan(r);
  condenser(r, true);
  flueTop(r);
}
