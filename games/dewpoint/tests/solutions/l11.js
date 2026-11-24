// Scripted solutions for l11 "Furnace Row". Each area is a function so the level tests can replay a prefix.
// Coordinates are the area's own (see X in src/levels/l11.js) plus the area's start.

import { X } from '../../src/levels/l11.js';

export const landed = (s, p) => p.grounded;
export const full = (s, p) => p.gauge >= 3.99;
const crate = (s, i) => s.level.crates[i].body;
const plate = (s, id) => s.level.plates.find((q) => q.id === id);
const fire = (s, id) => s.level.fires.find((q) => q.id === id);

/** 1. The Stoke Hall: ice weaves the crate north, east through the first gap, south, east through the second; it holds the heavy plate on the hot tiles. */
export function stokeHall(r, shard) {
  const c = () => crate(r.sim, 0);
  r.walkTo(2.6, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit');
  if (shard) r.walkTo(9.6, 3.0, { tol: 0.3 }).expectShards(1);
  r.walkTo(7.0, -3.05, { tol: 0.25 }).form('ice').stop()
    .waitUntil((s) => crate(s, 0).z >= 2.5, { toward: [7, 9], timeout: 8, label: 'crate pushed north to the first gap' })
    .stop()
    .walkTo(5.4, 1.4, { tol: 0.25 }).stop()
    .walkTo(5.9, c().z, { tol: 0.2 }).stop()
    .waitUntil((s) => crate(s, 0).x >= 17.6, { toward: [30, c().z], timeout: 12, label: 'crate pushed east through the first gap' })
    .stop()
    .walkTo(c().x - 0.6, 3.5, { tol: 0.25 }).stop()
    .walkTo(c().x, 3.5, { tol: 0.2 }).stop()
    .waitUntil((s) => crate(s, 0).z <= -2.1, { toward: [c().x, -9], timeout: 8, label: 'crate pushed south to the second gap' })
    .stop()
    .walkTo(c().x - 1.4, 0.4, { tol: 0.25 }).stop()
    .walkTo(c().x - 0.9, c().z, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('p1'), { toward: [36, c().z], timeout: 14, label: 'crate pressing the plate on the hot tiles' })
    .stop()
    .expect((s, p) => p.form === 'ice' && p.x < 26.9, 'ice stopped short of the hot tiles')
    .expect((s) => plate(s, 'p1').by === 'crate', 'the crate holds the plate')
    .form('liquid')
    .path([[25.6, 0.4], [30, 0.4], [34.6, 0.4], [37.2, 0]], { stuck: 0 })
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'door A is held open by the crate' });
}

/** 2. The Furnace Dash: freeze, step on the heavy plate, run; again from the middle platform, then wait in the pen. `how`: 'plain' or 'shard' (detour into the notch). */
export function furnaceDash(r, how) {
  const x = X.dash;
  r.walkTo(x + 2.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.4, 'checkpoint lit')
    .walkTo(x + 3.6, 0).form('ice').walkTo(x + 5.4, 0, { tol: 0.25 }).stop()
    .expectSignal('hp2', true)
    .expectSignal('dash1', true)
    .expect((s) => !fire(s, 'flames1').active, 'the flames are out while the plate is down')
    .waitUntil((s, p) => p.form === 'liquid', { toward: [x + 12, 0], timeout: 3, label: 'melted on the hot strip' })
    .waitUntil((s, p) => p.x > x + 25.6, { toward: [x + 27, 0], timeout: 5, label: 'across the flames' })
    .walkTo(x + 26.4, 0.4).expect((s) => s.checkpoint.pos[0] === x + 26.2, 'middle checkpoint lit')
    .walkTo(x + 26.4, 0).form('ice').walkTo(x + 28.4, 0, { tol: 0.25 }).stop()
    .expectSignal('hp3', true)
    .expectSignal('dash2', true)
    .expect((s) => !fire(s, 'flames2a').active && fire(s, 'flames2d').active, 'the first field is out and the second burns while the timer runs');
  if (how === 'shard') {
    r.waitUntil((s, p) => p.form === 'liquid', { toward: [x + 36.4, 3.3], timeout: 3, label: 'melted on the hot strip' })
      .walkTo(x + 41.7, 3.3, { tol: 0.3 })
      .expectShards(2)
      .waitUntil((s, p) => p.x > x + 47.6, { toward: [x + 49, 0], timeout: 4, label: 'into the pen' });
  } else {
    r.waitUntil((s, p) => p.form === 'liquid', { toward: [x + 37, 0], timeout: 3, label: 'melted on the hot strip' })
      .waitUntil((s, p) => p.x > x + 47.6, { toward: [x + 49, 0], timeout: 6, label: 'into the pen' });
  }
  r.walkTo(x + 49, 0).expect((s) => s.checkpoint.pos[0] === x + 49, 'pen checkpoint lit')
    .waitUntil((s) => !fire(s, 'flames2d').active, { timeout: 10, label: 'the second field dies when the timer runs out' })
    .expect((s) => fire(s, 'flames2a').active, 'and the first relights behind')
    .walkTo(x + 64.6, 0).walkTo(x + 67, 0);
}

/** 3. The Lift Hall: ice shoves crate 2 onto the pedal, the lift shuttles; ride it up, float over the bed of flame. */
export function liftHall(r, shard) {
  const x = X.lift;
  r.walkTo(x + 2.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.4, 'checkpoint lit')
    .walkTo(x + 5.4, -2.2, { tol: 0.25 }).stop().form('ice')
    .waitUntil((s) => s.signals.get('pump'), { toward: [x + 30, -2.2], timeout: 10, label: 'crate pushed onto the pedal' })
    .stop()
    .expect((s) => plate(s, 'pPump').by === 'crate', 'the crate holds the pedal')
    .form('liquid')
    .walkTo(x + 18.4, 0.6)
    .walkTo(x + 23.5, 0, { tol: 0.3 })
    .waitUntil((s, p) => p.y > 8.9, { timeout: 14, label: 'carried up to the catwalk' })
    .walkTo(x + 26.4, 0, { y: 9, stuck: 0 });
  if (shard) {
    r.walkTo(x + 27.6, 2.4, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
      .form('steam')
      .waitUntil((s) => s.shardsTaken.length === 3, { toward: [x + 27.6, 2.4], timeout: 5, label: 'shard on the perch' })
      .form('liquid').waitUntil(landed, { timeout: 5 })
      .expect((s, p) => Math.abs(p.y - 9) < 1e-6, 'back on the catwalk');
  }
  r.walkTo(x + 29.8, 0, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s, p) => p.x > x + 41.9, { toward: [x + 44, 0], timeout: 5, label: 'over the first bed of flame' })
    .form('liquid').waitUntil(landed, { timeout: 5 })
    .expect((s, p) => Math.abs(p.y - 9) < 1e-6 && p.x > x + 41, 'on the resting gallery')
    .walkTo(x + 43, 0).expect((s) => s.checkpoint.pos[0] === x + 43, 'rest checkpoint lit')
    .walkTo(x + 46.4, 0, { tol: 0.3 }).stop().waitUntil(full, { timeout: 4, label: 'the gauge refills on solid ground' })
    .form('steam')
    .waitUntil((s, p) => p.x > x + 57.9, { toward: [x + 60, 0], timeout: 5, label: 'over the second bed of flame' })
    .form('liquid').waitUntil(landed, { timeout: 5 })
    .expect((s, p) => Math.abs(p.y - 9) < 1e-6 && p.x > x + 57, 'on the far gallery')
    .walkTo(x + 74, 0, { stuck: 0 });
}

/** 4. The Control Room: film closes the posts, ice shoves crate 3 onto the near plate, ice presses the far one behind the hot strip. */
export function controlRoom(r) {
  const x = X.control;
  r.walkTo(x + 2.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.4, 'checkpoint lit')
    .walkTo(x + 4.2, 0).form('film').walkTo(x + 7.6, 0).walkTo(x + 9.1, 0)
    .expectSignal('arcC', true)
    .walkTo(x + 10.4, 0).form('liquid')
    .walkTo(x + 11.4, 0).waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'the shutter is open' })
    .walkTo(x + 15.4, -2.2, { tol: 0.25 }).stop().form('ice')
    .waitUntil((s) => crate(s, 2).x >= x + 24.7, { toward: [x + 40, -2.2], timeout: 10, label: 'crate pushed east along the lane' })
    .stop()
    .walkTo(crate(r.sim, 2).x, -3.08, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('pL'), { toward: [crate(r.sim, 2).x, 9], timeout: 8, label: 'crate pushed north onto the near plate' })
    .stop()
    .expect((s) => plate(s, 'pL').by === 'crate', 'the crate holds the near plate')
    .path([[x + 20.0, 0.9], [x + 16.0, 2.4]], { tol: 0.3 }).stop()
    .waitUntil((s) => s.signals.get('pM'), { toward: [x + 40, 2.4], timeout: 6, label: 'second crate pushed onto the middle plate' })
    .stop()
    .expect((s) => plate(s, 'pM').by === 'crate', 'the second crate holds the middle plate')
    .form('liquid')
    .path([[x + 20.4, 0.6], [x + 24, 0], [x + 32.4, 0]], { stuck: 0 })
    .form('ice').walkTo(x + 35.6, 0, { tol: 0.25 }).stop()
    .expectSignal('pH', true)
    .expectSignal('gateOpen', false)
    .waitUntil((s) => s.signals.get('gateOpen'), { timeout: 5, label: 'both plates down together for three seconds' }).wait(0.1)
    .expect((s) => !fire(s, 'gate').active, 'the gate flames are out')
    .form('liquid')
    .expect((s) => s.signals.get('gateOpen'), 'the gate stays open after you step off (latched)')
    .walkTo(x + 43.6, 0).walkTo(X.last + 1.2, 0);
}

/** 5. The Last Furnace: ice on the first plate, melt on the strips, ice on the second, then the dash while both timers run. */
export function lastFurnace(r) {
  const x = X.last;
  const c4 = () => r.sim.level.crates[4].body;
  r.walkTo(x + 2.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.4, 'checkpoint lit')
    .walkTo(x + 4.6, -2.8, { tol: 0.25 }).form('ice').stop()
    .waitUntil(() => c4().z >= 2.3, { toward: [x + 4.6, 9], timeout: 8, label: 'crate pushed north' })
    .stop()
    .walkTo(x + 3.4, 0.6, { tol: 0.25 }).stop()
    .walkTo(x + 3.7, c4().z, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('pC'), { toward: [x + 20, c4().z], timeout: 6, label: 'crate pushed onto its plate' })
    .stop()
    .expect((s) => plate(s, 'pC').by === 'crate', 'the crate holds its plate: set first')
    .walkTo(x + 5.2, 0.8, { tol: 0.3 }).walkTo(x + 6.6, -1.6, { tol: 0.25 }).stop()
    .expectSignal('hA', true)
    .waitUntil((s, p) => p.form === 'liquid', { toward: [x + 15, 0], timeout: 3, label: 'melted on the hot strip' })
    .walkTo(x + 21.4, 1.6, { slow: false }).form('ice').walkTo(x + 25, 1.6, { tol: 0.25 }).stop()
    .expectSignal('hB', true)
    .expectSignal('dashF', true)
    .expect((s) => !fire(s, 'last').active, 'the last flames are out while both timers run')
    .form('liquid')
    .walkTo(x + 55.6, 0, { slow: false }).expectExit();
}

export function solve(r) {
  stokeHall(r, false);
  furnaceDash(r, 'plain');
  liftHall(r, false);
  controlRoom(r);
  lastFurnace(r);
}

export function solveAll(r) {
  stokeHall(r, true);
  furnaceDash(r, 'shard');
  liftHall(r, true);
  controlRoom(r);
  lastFurnace(r);
}
