// Scripted solutions for l10 "Quench". Each area is a function so the level tests can replay a prefix.
// Coordinates are the area's own (see X in src/levels/l10.js) plus the area's start.

import { X } from '../../src/levels/l10.js';

export const landed = (s, p) => p.grounded;
export const full = (s, p) => p.gauge >= 3.99;
const crate = (s) => s.level.crates[0].body;
const ferry = (s) => s.level.movers[0];

/** 1. The Icehouse: the frost freezes Mote, ice presses the heavy plate, the door opens, the ferry, the slide smashes the glass. */
export function icehouse(r, shard) {
  r.walkTo(7.6, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit');
  if (shard) r.walkTo(9.2, 1.0).walkTo(11.2, 1.0, { tol: 0.3 }).expectShards(1);
  r.walkTo(12.6, 0)
    .walkTo(22.4, 0, { tol: 0.3, stuck: 0 })
    .expect((s, p) => p.form === 'ice', 'frozen by the frost at the edge of the hall')
    .form('liquid', { expect: false })
    .expect((s, p) => p.form === 'ice', 'frost refuses every other form')
    .stop()
    .expectSignal('h0', true)
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'door opens' })
    .walkTo(33.4, 0, { tol: 0.3 }).stop()
    .expect((s) => s.checkpoint.pos[0] === 33.4, 'ferry checkpoint lit')
    .walkTo(37.4, 0, { tol: 0.3 }).stop()
    .waitUntil((s) => ferry(s).t >= 1, { timeout: 12, label: 'the ferry is across' })
    .waitUntil((s, p) => p.x > 47.6, { mx: 1, timeout: 4, label: 'off the ferry' })
    .waitUntil((s) => s.level.panes[0].broken, { mx: 1, timeout: 8, label: 'the slide smashes the pane' })
    .stop({ timeout: 15 })
    .expect((s, p) => p.x > X.store && p.form === 'ice', 'in the cold store');
}

/** 2a. Two crates, two plates: crate A north to its gap, east through it, then south onto plate A; crate B straight east onto plate B. */
export function crateOntoThePlate(r) {
  const x = X.store;
  const A = () => r.sim.level.crates[0].body, B = () => r.sim.level.crates[1].body;
  r.walkTo(x + 3.4, -4.1).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(x + 8, -3.9, { tol: 0.25 }).stop()
    .waitUntil(() => A().z >= 1.4, { toward: [x + 8, 9], timeout: 8, label: 'crate A pushed north to the gap in the wall' })
    .stop()
    .walkTo(x + 6.9, 0.6, { tol: 0.25 }).stop()
    .walkTo(x + 6.9, A().z, { tol: 0.2 }).stop()
    .waitUntil(() => A().x >= x + 23.4, { toward: [x + 40, 1.5], timeout: 14, label: 'crate A pushed east through the gap' })
    .stop()
    .walkTo(A().x - 0.5, 2.8, { tol: 0.25 }).stop()
    .walkTo(A().x, 2.4, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('thawA'), { toward: [A().x, -6], timeout: 14, label: 'crate A pushed south onto plate A' })
    .stop()
    .expect((s) => s.level.plates[1].by === 'crate', 'crate A holds plate A')
    .expectSignal('thaw', false)
    .path([[x + 23, 2.4], [x + 14, 2.4], [x + 7.5, 2.4], [x + 6.9, 3.2]], { tol: 0.3 }).stop()
    .waitUntil((s) => s.signals.get('thawB'), { toward: [x + 40, 3.2], timeout: 14, label: 'crate B pushed east onto plate B' })
    .stop()
    .expect((s) => s.level.plates[2].by === 'crate', 'crate B holds plate B')
    .expectSignal('thaw', true)
    .expect((s) => !s.level.zones[1].active, 'the frost is off')
    .walkTo(x + 22.4, 1.4, { tol: 0.3 });
}

/** 2b. The grate in the far wall: steam through it, condense on the bank. */
export function throughTheGrate(r) {
  const x = X.store;
  r.walkTo(x + 26.4, 0.4, { tol: 0.3, stuck: 0 }).stop().waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s, p) => p.x > x + 31.4, { toward: [x + 32.6, 0], timeout: 4, label: 'out through the grate' })
    .form('liquid').waitUntil(landed, { timeout: 4 })
    .expect((s, p) => p.x > x + 30.2 && Math.abs(p.y + 3) < 1e-6, 'on the bank');
}

/** 3. The Skate Hall: the chute carries Mote down, up the far side and over the gap; the glass breaks. */
export function skateHall(r) {
  const x = X.skate;
  r.walkTo(x + 2.6, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.6, 'checkpoint lit')
    .walkTo(x + 6.0, 0)
    .waitUntil((s, p) => p.form === 'ice', { mx: 1, timeout: 2, label: 'frozen at the top of the chute' })
    .waitUntil((s) => s.level.panes[1].broken, { mx: 1, timeout: 12, label: 'over the gap and through the glass' })
    .stop({ timeout: 15 })
    .expect((s, p) => p.x > X.cellar && p.form === 'ice' && Math.abs(p.y + 6.5) < 1e-6, 'in the Seed Cellar');
}

/** 4. The Seed Cellar: ice on the plate lifts the frost; film under two low walls, a drop at the bud, climb; the cold on the gallery. */
export function seedCellar(r) {
  const x = X.cellar;
  r.walkTo(x + 1.8, -2.6, { tol: 0.3 }).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 1.8, 'checkpoint lit')
    .walkTo(x + 5.0, 2.4, { tol: 0.3 }).stop()
    .expectSignal('pT', true)
    .expectSignal('thaw4', true)
    .form('liquid')
    .walkTo(x + 6.2, 0).form('film').walkTo(x + 9.8, 0).form('liquid')
    .walkTo(x + 12.2, 0).form('film').walkTo(x + 15.8, 0).form('liquid')
    .walkTo(x + 18.9, 0, { stuck: 0 })
    .waitUntil((s) => s.level.sprouts[0].state === 2, { timeout: 3, label: 'bud grown' })
    .expectSignal('thaw4', true)
    .walkTo(x + 19.4, 0, { tol: 0.1 });
  for (let i = 0; i < 6; i++) r.jumpTo(x + 19.4, 0, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - 0.1) < 1e-6, 'on the top leaf')
    .walkTo(x + 20.8, 0, { y: 0.1, stuck: 0 })
    .waitUntil((s, p) => p.form === 'ice', { mx: 1, timeout: 2, label: 'frozen again on the gallery' })
    .walkTo(x + 21.6, -2.8, { tol: 0.3 }).expect((s) => s.checkpoint.pos[0] === x + 21.6, 'gallery checkpoint lit')
    .walkTo(x + 22.8, 2.4, { tol: 0.3 }).stop()
    .expectSignal('pT2', true)
    .expectSignal('thaw5', true)
    .form('liquid')
    .walkTo(x + 26.4, 0, { stuck: 0 })
    .waitUntil((s) => s.level.sprouts[1].state === 2, { timeout: 3, label: 'second bud grown' })
    .expectSignal('thaw5', true)
    .walkTo(x + 27.1, 0, { tol: 0.1 });
  for (let i = 0; i < 5; i++) r.jumpTo(x + 27.1, 0, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - 6.1) < 1e-6, 'on the second top leaf')
    .walkTo(x + 29.6, 0, { y: 6.1, stuck: 0 })
    .waitUntil((s, p) => p.form === 'ice', { mx: 1, timeout: 2, label: 'frozen again on the top gallery' })
    .walkTo(x + 33.4, 0, { tol: 0.3 }).stop()
    .expectSignal('hg', true)
    .waitUntil((s) => s.level.doors[1].open >= 1, { timeout: 2, label: 'the gallery door opens' })
    .waitUntil((s, p) => p.x > x + 39.6, { mx: 1, timeout: 6, label: 'through the door' })
    .waitUntil((s, p) => p.form === 'ice' && p.x > x + 39.8, { mx: 1, timeout: 3, label: 'still ice, out of the frost' })
    .form('liquid')
    .walkTo(x + 54, 0).walkTo(X.tank + 2, 0);
}

/** 5. The Quench Tank: ice off the bank, shove the crate along the floor beneath the flames onto the sluice plate, melt beyond it. */
export function quenchTank(r, grabShard) {
  const x = X.tank;
  r.walkTo(x + 2, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2, 'checkpoint lit')
    .walkTo(x + 6.6, 0).form('ice')
    .waitUntil((s, p) => p.x > x + 8.6 && p.y < -7.7, { toward: [x + 10.2, 0], timeout: 5, label: 'sunk to the tank bottom' })
    .walkTo(x + 10.2, 0, { tol: 0.25 }).stop()
    .expect((s) => Math.abs(s.level.crates[2].body.z) < 0.1, 'the crate waits on the tank floor');
  if (grabShard) {
    // the shard in the corner first: ice walks the bed under the curtains and back
    r.walkTo(x + 10.2, -2.0, { tol: 0.3 }).stop()
      .waitUntil((s) => s.shardsTaken.length === 3, { toward: [x + 24.6, -4.6], timeout: 14, label: 'shard on the tank floor' })
      .walkTo(x + 10.2, -2.0, { tol: 0.3 }).stop().walkTo(x + 10.2, 0, { tol: 0.3 }).stop();
  }
  r.waitUntil((s) => s.signals.get('sluice'), { toward: [x + 58, 0], timeout: 30, label: 'crate shoved along the floor onto the sluice plate' })
    .stop()
    .expect((s) => s.level.plates.find((q) => q.id === 'pBed').by === 'crate', 'the crate holds the sluice plate')
    .waitUntil((s) => s.level.doors[2].open >= 1, { timeout: 2, label: 'the sluice opens' })
    .path([[x + 50.0, 1.3], [x + 54.0, 1.3], [x + 55.0, 0.2]], { tol: 0.3 })
    .waitUntil((s, p) => p.x > x + 56.8, { toward: [x + 58, 0], timeout: 4, label: 'through the sluice' })
    .form('liquid')
    .waitUntil((s, p) => p.floating, { timeout: 3, label: 'floated up' })
    .waitUntil((s, p) => p.x > x + 59.4, { toward: [x + 60.6, 0], timeout: 8, label: 'swimming to the bank' })
    .waitUntil((s, p) => p.floating, { toward: [x + 60.6, 0], timeout: 2 })
    .jumpTo(x + 61.6, 0)
    .expect((s, p) => Math.abs(p.y + 6.5) < 1e-6, 'out of the water')
    .walkTo(x + 67.8, 0).expectExit();
}

export function solve(r) {
  icehouse(r, false);
  crateOntoThePlate(r);
  throughTheGrate(r);
  skateHall(r);
  seedCellar(r);
  quenchTank(r, false);
}

export function solveAll(r) {
  const x = X.store;
  icehouse(r, true);
  crateOntoThePlate(r);
  // shard 2: once the frost is off, steam up beside the ledge in the wall and drift onto it
  r.walkTo(x + 25.8, 4.4, { tol: 0.3, stuck: 0 }).stop().waitUntil(full, { timeout: 3 })
    .expect((s) => s.level.plates[1].pressed, 'the crate still holds the plate')
    .form('steam')
    .waitUntil((s, p) => p.y > 1.15, { toward: [x + 26.4, 4.4], timeout: 4.5, label: 'above the ledge' })
    .waitUntil((s) => s.shardsTaken.length === 2, { toward: [x + 27.8, 4.3], timeout: 3, label: 'shard on the ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 1.0) < 1e-6, 'on the ledge')
    .walkTo(x + 25.6, 4.4, { stuck: 0 }).waitUntil(landed, { timeout: 3 });
  throughTheGrate(r);
  skateHall(r);
  seedCellar(r);
  quenchTank(r, true);
}
