// Scripted solutions for l11 "Furnace Row".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const crate = (s, i) => s.level.crates[i].body;

/** Hall 1: ice shoves the crate into the hot patch; it holds the heavy plate there; door A opens. */
function crateOntoTheHotPlate(r) {
  r.walkTo(4.6, 0).stop().form('ice')
    .waitUntil((s) => s.signals.get('p1'), { toward: [12, 0], timeout: 12, label: 'crate pressing the plate on the hot tiles' })
    .stop()
    .expect((s, p) => p.form === 'ice' && p.x < 8.7, 'ice stopped short of the hot tiles')
    .expect((s) => s.level.plates[0].by === 'crate', 'the crate holds the plate')
    .form('liquid')
    .path([[8.0, 1.6], [14.2, 1.4], [16.8, 0]], { stuck: 0 })
    .expect((s) => s.level.doors[0].open >= 1, 'door A is held open by the crate')
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

/**
 * Hall 2: freeze, step on the heavy plate, run. `how`:
 *   'plain'   straight through the flames
 *   'both'    detour into the notch for its shard, then rise as steam onto the catwalk
 */
function furnaceDash(r, how) {
  r.walkTo(17.4, 0).form('ice').walkTo(18.5, 0, { tol: 0.25 }).stop()
    .expectSignal('hp2', true)
    .expectSignal('dash', true)
    .expect((s) => !s.level.fires[0].active, 'the flames are out while the plate is down');
  if (how === 'plain') {
    r.waitUntil((s, p) => p.form === 'liquid', { toward: [24, 0], timeout: 3, label: 'melted on the hot strip' })
      .waitUntil((s, p) => p.x > 34.6, { toward: [36, 0], timeout: 5, label: 'across the flames' });
    return;
  }
  r.waitUntil((s, p) => p.form === 'liquid', { toward: [23, 3.5], timeout: 3, label: 'melted on the hot strip' })
    .walkTo(28.5, 3.4, { tol: 0.25 })
    .expectShards(2)
    .form('steam')
    .waitUntil((s, p) => p.y > 4.62, { toward: [28.5, 3.4], timeout: 4, label: 'rising above the flames' })
    .waitUntil((s) => s.shardsTaken.length === 3, { toward: [32, 0], timeout: 3, label: 'shard on the catwalk' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 4.5) < 1e-6, 'on the catwalk')
    .walkTo(35.2, 0, { stuck: 0 }).waitUntil(landed, { timeout: 3 });
}

/** Hall 3: crate onto the light plate, cross the hot strip, freeze, stand on the heavy plate. */
function theRelay(r) {
  r.walkTo(36.4, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(38.4, -2.2, { tol: 0.25 }).stop().form('ice')
    .waitUntil((s) => s.signals.get('pL'), { toward: [50, -2.2], timeout: 12, label: 'crate onto the light plate' })
    .stop()
    .expect((s) => s.level.plates[2].by === 'crate', 'the crate holds the near plate')
    .form('liquid')
    .path([[46.6, 1.0], [51.6, 0]], { stuck: 0 })
    .form('ice').walkTo(52.4, 0, { tol: 0.25 }).stop()
    .expectSignal('pH', true)
    .expectSignal('gateOpen', true)
    .expect((s) => !s.level.fires[3].active, 'the gate flames are out')
    .form('liquid')
    .expect((s) => s.signals.get('gateOpen'), 'the gate stays open after you step off (latched)')
    .walkTo(63, 0).expectExit();
}

export function solve(r) {
  crateOntoTheHotPlate(r);
  furnaceDash(r, 'plain');
  theRelay(r);
}

export function solveAll(r) {
  r.walkTo(4.2, 2.4).expectShards(1);
  crateOntoTheHotPlate(r);
  furnaceDash(r, 'both');
  theRelay(r);
}
