// Keyboard solution for l05 "Hung Out to Dry". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Platforms: stand at the edge, watch for the platform to dock, walk on, ride, walk off when it stops at the other end.

import level from '../../src/levels/l05.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const mover = (s, id) => s.level.movers.find((m) => m.id === id);
const crate = (s) => s.level.crates[0].body;
const crate2 = (s) => s.level.crates[1].body;
/** A platform that has just docked at its start: it will sit there a moment longer. */
const docked = (id) => (s) => mover(s, id).t < 0.01 && mover(s, id).wait > 0.9;
const atB = (id) => (s) => mover(s, id).t >= 0.999;
const full = (s, p) => p.gauge >= 3.99;

/** Wait at the edge for the platform, walk on to the middle of the deck, ride, walk off at `offX`. */
function crossOn(k, id, edgeX, deckX, offX) {
  return k.goTo(edgeX, 0)
    .until(docked(id), { timeout: 16, label: `${id} docks on our side` })
    .runTo('+x', deckX)
    .until(atB(id), { timeout: 10, label: `${id} carries us across` })
    .runTo('+x', offX);
}

export function solve(k) {
  // 1. The Drying Racks: the tram over the slip trough, the ferry over the kiln pit
  k.goTo(A1 + 2.4, 0);
  crossOn(k, 'tram', A1 + 9.0, A1 + 11.5, A1 + 19);
  crossOn(k, 'ferry', A1 + 27.0, A1 + 29.5, A1 + 37.2);
  k.expect((s, p) => p.x > A2 && p.grounded && Math.abs(p.y) < 1e-6, 'across the pit');
  // 2. The Hoist Gallery: the hoist up to the terrace, the plate that wakes the shuttle, the shuttle over the gap, down the ramp
  k.goTo(A2 + 2.2, -0.9).goTo(A2 + 8.0, 0)
    .until(docked('hoist'), { timeout: 16, label: 'hoist docks at the bottom' })
    .runTo('+x', A2 + 10.5)
    .until(atB('hoist'), { timeout: 10, label: 'hoist reaches the terrace' })
    .goTo(A2 + 14.2, -0.9)
    .expect((s, p) => Math.abs(p.y - 6) < 1e-6, 'on the terrace')
    .goTo(A2 + 19.4, -1.6)
    .expectSignal('wake', true)
    .goTo(A2 + 21.0, 0);
  k.until(docked('shuttle'), { timeout: 16, label: 'shuttle docks on the terrace' })
    .runTo('+x', A2 + 23.5)
    .until(atB('shuttle'), { timeout: 10, label: 'shuttle carries us over the gap' })
    .runTo('+x', A2 + 30.5)
    .expect((s, p) => Math.abs(p.y - 6) < 1e-6 && p.x > A2 + 29, 'on the far terrace')
    .goTo(A2 + 42, 0)
    .hold('+x', { until: (s, p) => p.x > A2 + 53.4 && p.grounded, label: 'down the ramp' })
    .release().settle();
  // 3. The Pressing Room: ice shoves the crate south into the ferry's lane, onto the barge, across, onto the heavy plate;
  //    then the second crate across the bridge the first one holds out
  k.goTo(A3 + 2.2, -0.9).goTo(A3 + 3.4, -3.2, { order: 'zx' }).goTo(A3 + 5.4, -3.2, { tol: 0.6 }).form('ice')
    .hold('+z', { until: (s) => crate(s).z >= -0.9, timeout: 8, label: 'crate pushed south into the lane' })
    .stopNow().form('liquid')
    .goTo(A3 + 3.6, -0.6).goTo(A3 + 3.6, crate(k.sim).z, { tol: 0.5 }).form('ice')
    .hold('+x', { until: (s) => crate(s).x >= A3 + 12.0, timeout: 14, label: 'crate pushed to the edge of the pit' })
    .stopNow()
    .until(docked('barge'), { timeout: 16, label: 'barge docks on our side' });
  k.hold('+x', { until: (s) => crate(s).x >= A3 + 15.0, timeout: 6, label: 'crate pushed on board' })
    .stopNow()
    .until(atB('barge'), { timeout: 12, label: 'barge carries crate and ice across' })
    .expect((s, p) => p.x > A3 + 19 && crate(s).x > A3 + 19, 'both across')
    .hold('+x', { until: (s) => crate(s).x >= A3 + 26.7, timeout: 16, label: 'crate pushed onto the heavy plate' })
    .stopNow()
    .expectSignal('hp', true)
    .form('liquid')
    .goTo(A3 + 27, 2.7).goTo(A3 + 30.0, 2.7).goTo(A3 + 30.0, crate2(k.sim).z, { tol: 0.5 })
    .until(atB('bridge'), { timeout: 8, label: 'bridge fully out' })
    .form('ice')
    .hold('+x', { until: (s) => crate2(s).x >= A3 + 46.6, timeout: 18, label: 'second crate pushed across the bridge onto the second plate' })
    .stopNow()
    .expectSignal('hp2', true)
    .form('liquid')
    .goTo(A3 + 46, 2.7).goTo(A3 + 50, 2.7).goTo(A3 + 53.5, 0, { order: 'zx' })
    .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'second door open' })
    .goTo(A3 + 57, 0)
    .expect((s) => mover(s, 'bridge').t >= 0.999, 'across, and the first crate still holds the plate');
  // 4. The Chimney Stack: the lift to the top of the sealed shaft, then steam up through the roof grate
  k.goTo(A4 + 2.2, -0.9).goTo(A4 + 10.4, 0)
    .until(docked('elevator'), { timeout: 16, label: 'lift docks at the bottom' })
    .runTo('+x', A4 + 13.5)
    .until(atB('elevator'), { timeout: 10, label: 'lift reaches the top' })
    .expect((s, p) => p.y > 4 && p.grounded, 'riding at the top of the shaft')
    .form('steam')
    .until((s, p) => p.y > 8.5, { timeout: 5, label: 'up through the roof grate' })
    .hold('+x', { until: (s, p) => p.x > A4 + 15.85, timeout: 4, label: 'over the gallery' })
    .form('liquid', { release: true }).land().settle()
    .expect((s, p) => Math.abs(p.y - 8.4) < 1e-6, 'on the gallery')
    .goTo(A4 + 18.2, 0);
  // 5. The Roof Gantry: two ferries out over the pit, the second climbing to the kiln door
  k.goTo(A5 + 1.4, -0.9);
  crossOn(k, 'gantry1', A5 + 3.2, A5 + 5.5, A5 + 13.2);
  k.goTo(A5 + 17.0, 0)
    .until(docked('gantry2'), { timeout: 16, label: 'second ferry docks at the pier' })
    .runTo('+x', A5 + 19.5)
    .until(atB('gantry2'), { timeout: 12, label: 'second ferry climbs to the tower' })
    .runTo('+x', A5 + 29)
    .expect((s, p) => Math.abs(p.y - 11.5) < 1e-6, 'on the kiln tower')
    .goTo(A5 + 36.6, 0).expectExit();
}
