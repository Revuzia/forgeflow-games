// Scripted solutions for l10 "Quench".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const crate = (s) => s.level.crates[0].body;

/** Hall 1 to the cold store: the frost freezes Mote at the top and gravity does the rest. */
function downTheSlide(r, grabShard) {
  r.expect((s) => s.level.checkpoints.length === 3 || true)
    .walkTo(7.6, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit');
  if (grabShard) r.walkTo(9.2, 1.0).walkTo(11.2, 1.0, { tol: 0.3 }).expectShards(1);
  else r.walkTo(9.2, 0).walkTo(11.2, 0, { tol: 0.3 });
  r.expect((s, p) => p.form === 'ice', 'frozen by the frost at the top of the slide')
    .form('liquid', { expect: false })
    .expect((s, p) => p.form === 'ice', 'frost refuses every other form')
    .stop()
    .waitUntil((s) => s.level.panes[0].broken, { mx: 1, timeout: 8, label: 'the slide smashes the pane' })
    .stop({ timeout: 15 })
    .expect((s, p) => p.x > 20.3 && p.form === 'ice', 'in the cold store');
}

/** Shove the crate east along z=-2.5, go round it, shove it north onto the plate. */
function crateOntoThePlate(r) {
  r.walkTo(22.8, -2.5, { tol: 0.25 }).stop()
    .waitUntil((s) => crate(s).x >= 32.4, { toward: [40, -2.5], timeout: 14, label: 'crate pushed east' })
    .stop()
    .walkTo(31.6, -3.45, { tol: 0.25 }).stop()
    .walkTo(32.5, -3.45, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('thaw'), { toward: [32.5, 6], timeout: 14, label: 'crate pushed north onto the plate' })
    .stop()
    .expectSignal('thaw', true)
    .expect((s) => crate(s).z > 1.25 && crate(s).z < 3.75, 'the crate rests on the plate')
    .expect((s) => s.level.plates[0].by === 'crate', 'the crate holds the plate')
    .expect((s) => !s.level.zones[0].active, 'the frost is off');
}

function throughTheGrate(r) {
  r.walkTo(34.0, 0.4, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s, p) => p.x > 37.0, { toward: [38.4, 0], timeout: 4, label: 'out through the grate' })
    .form('liquid').waitUntil(landed, { timeout: 4 })
    .expect((s, p) => p.x > 36.5 && Math.abs(p.y + 3) < 1e-6, 'on the tank bank');
}

/** Ice off the bank, along the tank bottom, melt in the pool, swim to the far bank. */
function underTheFlames(r, grabShard) {
  r.walkTo(38.4, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(40.4, 0).form('ice')
    .waitUntil((s, p) => p.x > 42.6 && p.y < -4.3, { toward: [49, 0], timeout: 4, label: 'sunk to the tank bottom' });
  if (grabShard) r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [51, -4.6], timeout: 6, label: 'shard on the tank floor' });
  r.waitUntil((s, p) => p.x > 56.6, { toward: [59, 0], timeout: 9, label: 'beneath the curtains and out' })
    .form('liquid')
    .waitUntil((s, p) => p.floating, { timeout: 3, label: 'floated up' })
    .waitUntil((s, p) => p.x > 59.6, { toward: [61.5, 0], timeout: 4, label: 'swimming to the bank' })
    .waitUntil((s, p) => p.floating, { toward: [61.5, 0], timeout: 2 })
    .jumpTo(62.4, 0)
    .expect((s, p) => Math.abs(p.y + 3) < 1e-6, 'out of the water');
}

export function solve(r) {
  downTheSlide(r, false);
  crateOntoThePlate(r);
  throughTheGrate(r);
  underTheFlames(r, false);
  r.walkTo(66, 0).expectExit();
}

export function solveAll(r) {
  downTheSlide(r, true);
  crateOntoThePlate(r);
  // shard 1 (the ledge): once the frost is off, steam up beside the ledge and drift onto it
  r.path([[34.6, 1.2], [34.6, 4.4]], { tol: 0.3 }).walkTo(33.0, 4.4, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
    .expect((s) => s.level.plates[0].pressed, 'the crate still holds the plate')
    .form('steam')
    .waitUntil((s, p) => p.y > 1.15, { toward: [33.0, 4.4], timeout: 4.5, label: 'above the ledge' })
    .waitUntil((s) => s.shardsTaken.length === 2, { toward: [34.8, 4.3], timeout: 3, label: 'shard on the ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 1.0) < 1e-6, 'on the ledge')
    .walkTo(32.6, 4.4, { stuck: 0 }).waitUntil(landed, { timeout: 3 });
  throughTheGrate(r);
  underTheFlames(r, true);
  r.walkTo(66, 0).expectExit();
}
