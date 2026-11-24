// Scripted solutions for l08 "Bone Dry".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const ferry = (s) => s.level.movers[0];
const crate = (s) => s.level.crates[0].body;

function climbTheSprout(r) {
  r.walkTo(6.2, 0)
    .waitUntil((s) => s.level.sprouts[0].state === 2, { timeout: 2, label: 'the bud has grown' })
    .jumpTo(6.2, 0).expect((s, p) => Math.abs(p.y - 1.2) < 1e-6, 'on leaf 1')
    .jumpTo(6.2, 0).expect((s, p) => Math.abs(p.y - 2.4) < 1e-6, 'on leaf 2')
    .jumpTo(6.2, 0).expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'on the top leaf')
    .jumpTo(9.2, 0, { run: 0.8 }).expect((s, p) => Math.abs(p.y - 3.6) < 1e-6 && p.x > 8.4, 'on deck 1');
}

function filmUnderTheShelf(r) {
  r.walkTo(10.4, -0.3).form('film')
    .walkTo(12.1, -0.8).walkTo(12.1, -3.0)
    .expectSignal('arc', true)
    .walkTo(12.1, -0.3).form('liquid')
    .expect((s) => s.signals.get('doorA'), 'the door latched open');
}

function throughTheDoorAndAcross(r) {
  r.walkTo(17.2, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .waitUntil((s) => ferry(s).t <= 0 && ferry(s).wait > 0.6, { timeout: 8, label: 'the ferry is waiting at the ledge' })
    .walkTo(20.6, 0)
    .waitUntil((s) => ferry(s).t >= 0.999, { timeout: 6, label: 'carried across' })
    .walkTo(28.4, 0)
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6 && p.x > 27, 'on deck 2');
}

function upThroughTheHatch(r) {
  r.walkTo(30.4, 0).waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s, p) => p.y > 7.9, { toward: [30.4, 0], timeout: 4, label: 'through the hatch' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 7.8) < 1e-6, 'standing on the loft');
}

function shoveTheCrateOffTheEdge(r) {
  r.form('ice')
    .waitUntil((s) => crate(s).y < 7.0, { mx: 1, timeout: 14, label: 'crate pushed off the edge' })
    .waitUntil((s) => s.level.plates[0].pressed, { timeout: 3, label: 'the crate lands on the heavy plate' })
    .expect((s) => s.level.plates[0].by === 'crate' || s.level.plates[0].by === 'player', 'plate is down');
}

function leaveTheLoftAndExit(r) {
  // ice may already be on its way over the edge; whatever lands, drop back to a drop and look at the plate
  r.waitUntil(landed, { timeout: 3, label: 'on the lower floor' })
    .stop({ coast: true })
    .form('liquid')
    .expect((s) => s.level.plates[0].by === 'crate', 'the crate (not Mote) holds the plate')
    .walkTo(44, 0).walkTo(45, 0).expectExit();
}

export function solve(r) {
  climbTheSprout(r);
  filmUnderTheShelf(r);
  throughTheDoorAndAcross(r);
  upThroughTheHatch(r);
  shoveTheCrateOffTheEdge(r);
  leaveTheLoftAndExit(r);
}

export function solveAll(r) {
  climbTheSprout(r);                                   // shard 0 sits over the top leaf
  r.expectShards(1);
  r.walkTo(10.4, -0.3).form('film')
    .walkTo(12.1, -0.8).walkTo(12.1, -3.0).expectSignal('arc', true)
    .walkTo(12.1, -0.3).form('liquid');
  // shard 1: the second bud grows leaves up onto the shelf
  r.waitUntil((s) => s.level.sprouts[1].state === 2, { timeout: 2, label: 'second bud grown' })
    .jumpTo(12.6, -0.3, { hold: 0.2 }).expect((s, p) => Math.abs(p.y - 4.35) < 1e-6, 'on the low leaf')
    .jumpTo(12.2, -0.5).expect((s, p) => Math.abs(p.y - 5.1) < 1e-6, 'on the high leaf')
    .walkTo(13.4, -2.2).walkTo(13.4, -2.8).expectShards(2)
    .walkTo(12.2, 1.0, { stuck: 0, timeout: 4 }).waitUntil(landed, { timeout: 3 });
  throughTheDoorAndAcross(r);
  // shard 2: the caged one. In as a cloud, out as a cloud.
  r.walkTo(35, -0.4).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [35, -2.8], timeout: 3.5, label: 'shard in the cage' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => p.z < -1.5, 'inside the cage')
    .waitUntil(full, { timeout: 3, label: 'gauge refilled inside' })
    .form('steam')
    .waitUntil((s, p) => p.z > -0.6, { toward: [35, 0.5], timeout: 3, label: 'out through the grate' })
    .form('liquid').waitUntil(landed, { timeout: 3 });
  upThroughTheHatch(r);
  shoveTheCrateOffTheEdge(r);
  leaveTheLoftAndExit(r);
}
