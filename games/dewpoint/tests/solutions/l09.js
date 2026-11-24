// Scripted solutions for l09 "Heat Haze". Each area is a function so the level tests can replay a prefix.

export const landed = (s, p) => p.grounded;
export const full = (s, p) => p.gauge >= 3.99;
const crate = (s, i) => s.level.crates[i].body;
const s09x = (r) => r.sim.level.crates[1].body.x;

/** 1. The Flue Foot: the small vent lifts you onto the step, the big one over the cliff. */
export function flueFoot(r, shard = true) {
  r.walkTo(3, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(5.4, 0).walkTo(7.2, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the first vent boiled Mote')
    .waitUntil((s, p) => p.y > 2.5, { toward: [7.2, 0], timeout: 5, label: 'rising past the step' })
    .waitUntil((s, p) => p.x > 9.2, { mx: 1, timeout: 3, label: 'over the step' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 2) < 1e-6, 'on the step');
  if (shard) r.walkTo(10.9, 2.4).expectShards(1);
  r.walkTo(12.4, 0).walkTo(14.5, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the cliff vent boiled Mote')
    .waitUntil((s, p) => p.y > 6.5, { toward: [14.5, 0], timeout: 8, label: 'rising up the cliff' })
    .waitUntil((s, p) => p.x > 17, { mx: 1, timeout: 3, label: 'over the cliff edge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 6) < 1e-6 && p.x > 16.3, 'on the Damper Room floor');
}

/** The shard on the cap: boil in the vent, leave by the west side, climb round the cap and settle on top. */
export function capShard(r) {
  r.walkTo(46, 2.0).walkTo(49.0, 2.0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'boiled in the cap vent')
    .waitUntil((s, p) => p.x < 47.9, { mx: -1, timeout: 3, label: 'out of the haze, west' })
    .waitUntil((s, p) => p.y > 9.7, { mx: -0.2, timeout: 3, label: 'above the cap' })
    .waitUntil((s) => s.shardsTaken.length >= 2, { toward: [50, 2.0], timeout: 4, label: 'shard on the cap' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 9.5) < 1e-6, 'on the cap')
    .walkTo(47.0, 2.0, { stuck: 0 }).waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 6) < 1e-6, 'back on the floor');
}

/** 2. The Damper Room: ice shoves crate 1 east along z = -1.9, then north onto the plate that sits in the haze. */
export function damperRoom(r) {
  r.walkTo(19.6, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(19.8, -1.9, { tol: 0.25 }).stop().form('ice')
    .waitUntil((s) => crate(s, 0).x >= 49.9, { toward: [60, -1.9], timeout: 14, label: 'crate pushed east along the lane' })
    .stop()
    .walkTo(48.6, -3.1, { tol: 0.25 }).stop()
    .walkTo(50, -3.1, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('p1'), { toward: [50, 6], timeout: 10, label: 'crate pushed north onto the plate in the haze' })
    .stop()
    .expect((s, p) => p.form === 'ice', 'still ice, still outside the vent')
    .expect((s) => s.level.plates[0].by === 'crate', 'the crate holds the plate')
    .form('liquid')
    .path([[52.6, -0.3], [60.6, 0]], { stuck: 0 })
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'door A is open' });
}

/** 3. The Cold Walk: film under the wall closes the posts, ice shoves crate 2 onto the light plate (cooling the corridor), ice slides on to the heavy plate. */
export function coldWalk(r) {
  r.walkTo(64.6, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(66.4, 0).form('film').walkTo(69.6, 0).walkTo(70.9, 0)
    .expectSignal('arcC', true)
    .walkTo(72.0, 0).form('liquid')
    .walkTo(72.6, 0).waitUntil((s) => s.level.doors[1].open >= 1, { timeout: 2, label: 'door C is open' })
    .walkTo(74.8, 0, { tol: 0.25 }).stop().form('ice')
    .waitUntil((s) => s.level.crates[1].body.x >= 82.2, { toward: [90, 0], timeout: 8, label: 'crate pushed east to the plate' })
    .stop()
    .walkTo(81.4, -1.8, { tol: 0.25 }).stop()
    .walkTo(s09x(r), -1.0, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('cool'), { toward: [s09x(r), 9], timeout: 6, label: 'crate pushed north onto the light plate' })
    .stop()
    .expect((s) => s.level.plates[1].by === 'crate', 'the crate holds the light plate')
    .expect((s) => !s.level.zones[3].active, 'the vents in the corridor are off')
    .path([[81.0, -1.4], [84.5, -1.4], [89, 0]], { tol: 0.3 })
    .expect((s, p) => p.form === 'ice', 'still ice in the cooled corridor')
    .walkTo(91, 0, { tol: 0.3 }).stop()
    .expectSignal('hh', true)
    .expectSignal('flue', true)
    .form('liquid')
    .walkTo(94.6, 0).waitUntil((s) => s.level.doors[2].open >= 1, { timeout: 2, label: 'door B is open' })
    .walkTo(99, 0);
}

/** 4. The Boiler Hall: up the launch vent above the cold band, across to the tall vent, down onto the pier; crate and bridge. */
export function boilerHall(r, shard) {
  r.walkTo(100, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(102.6, 0).walkTo(104.7, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the launch vent boiled Mote')
    .waitUntil((s, p) => p.y > 16.9, { toward: [104.7, 0], timeout: 12, label: 'above the cold band' })
    .waitUntil((s, p) => p.x > 117.0, { toward: [117.8, 0], timeout: 6, label: 'across to the tall vent' })
    .expect((s, p) => p.gauge > 3.9, 'the tall vent refilled the gauge');
  if (shard) {
    r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [117.8, 3.7], timeout: 4, label: 'the shard beside the tall vent' })
      .waitUntil((s, p) => p.gauge > 3.9 && Math.abs(p.z) < 1.2, { toward: [117.8, 0], timeout: 4, label: 'back in the haze' });
  }
  r.waitUntil((s, p) => p.x > 121.8, { toward: [126, 0], timeout: 4, label: 'out over the pier' })
    .form('liquid').waitUntil(landed, { timeout: 4 })
    .expect((s, p) => Math.abs(p.y - 9) < 1e-6 && p.x > 121.6, 'on the pier');
  // the pier: crate east along z = -1.9, then north onto the heavy plate; the bridge slides out and stays
  r.walkTo(123.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === 123.4, 'pier checkpoint lit')
    .walkTo(124.6, -1.9, { tol: 0.25 }).stop().form('ice')
    .waitUntil((s) => crate(s, 2).x >= 132.7, { toward: [140, -1.9], timeout: 9, label: 'crate pushed east' })
    .stop()
    .walkTo(131.5, -3.0, { tol: 0.25 }).stop()
    .walkTo(132.8, -3.0, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('bridge'), { toward: [132.8, 6], timeout: 8, label: 'crate on the heavy plate' })
    .stop()
    .form('liquid')
    .walkTo(134.6, 0, { stuck: 0 })
    .waitUntil((s) => s.level.movers[0].t >= 1, { timeout: 8, label: 'the bridge is all the way out' })
    .walkTo(154, 0, { stuck: 0 });
}

/** 5. The Great Draught: douse the embers, rise through the grate lid, land on the crown, ride the ferry over the kiln mouth. */
export function greatDraught(r) {
  r.walkTo(155, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === 155, 'checkpoint lit')
    .waitUntil((s) => s.level.embers[0].doused, { toward: [162.2, 0], timeout: 6, label: 'the ember doorway is out' })
    .walkTo(169.4, 0).walkTo(173.6, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the draught boiled Mote')
    .waitUntil((s, p) => p.y > 28.8, { toward: [173.6, 0], timeout: 20, label: 'up through the grate lid' })
    .waitUntil((s, p) => p.x > 176.6, { mx: 1, timeout: 4, label: 'out over the crown' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 28) < 1e-6, 'on the crown')
    .walkTo(178, 0).expect((s) => s.checkpoint.pos[0] === 178, 'crown checkpoint lit')
    .walkTo(179.2, 0)
    .walkTo(181.4, 0)
    .waitUntil((s) => s.level.movers[1].t >= 1, { timeout: 12, label: 'ferried across' })
    .walkTo(197, 0)
    .walkTo(203.6, 0).expectExit();
}

export function solve(r) {
  flueFoot(r, false);
  damperRoom(r);
  coldWalk(r);
  boilerHall(r, false);
  greatDraught(r);
}

export function solveAll(r) {
  flueFoot(r, true);
  r.walkTo(17.6, 0);
  r.walkTo(46, -1.9);
  capShard(r);
  r.walkTo(19.6, 0);
  damperRoom(r);
  coldWalk(r);
  boilerHall(r, true);
  greatDraught(r);
}
