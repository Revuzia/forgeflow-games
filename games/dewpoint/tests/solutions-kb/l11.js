// Keyboard solution for l11 "Furnace Row". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Ice (key 2) shoves the crates and presses the heavy plates; liquid walks and lines up; steam crosses the beds of flame.

import { X } from '../../src/levels/l11.js';

const full = (s, p) => p.gauge >= 3.99;
const crate = (s, i) => s.level.crates[i].body;
const plate = (s, id) => s.level.plates.find((q) => q.id === id);
const fire = (s, id) => s.level.fires.find((q) => q.id === id);

const AREAS = [
  // 1. The Stoke Hall: ice weaves the crate north, east through the first gap, south, east through the second onto the hot-tile plate
  (k) => {
    const c = () => crate(k.sim, 0);
    k.goTo(2.6, 0).goTo(5.6, -1.0, { tol: 0.45 })
      .hold('-z', { for: 0.5 }).release().settle()                       // against the north wall: the rail
      .goTo(7.0, -3.6, { tol: 0.5 }).form('ice')
      .hold('+z', { until: (s) => crate(s, 0).z >= 1.3, timeout: 10, label: 'crate pushed north to the first gap' })
      .stopNow();
    for (let i = 0; i < 6 && c().z < 1.5; i++) k.tap('+z', 0.15).settle();
    k.goTo(5.4, 1.4, { order: 'xz', tol: 0.55 }).goTo(5.4, c().z, { tol: 0.55 })
      .hold('+x', { until: (s) => crate(s, 0).x >= 17.2, timeout: 14, label: 'crate pushed east through the first gap' })
      .stopNow()
      .goTo(c().x - 1.4, 1.0, { order: 'zx', tol: 0.45 }).goTo(c().x - 1.4, c().z + 1.25, { tol: 0.4 }).goTo(c().x, c().z + 1.25, { tol: 0.4 })
      .hold('-z', { until: (s) => crate(s, 0).z <= -1.8, timeout: 10, label: 'crate pushed south to the second gap' })
      .stopNow()
      .goTo(c().x - 2.0, 0.4, { order: 'xz', tol: 0.45 }).goTo(c().x - 2.0, c().z, { tol: 0.55 }).goTo(c().x - 1.4, c().z, { tol: 0.55 })
      .hold('+x', { until: (s) => s.signals.get('p1'), timeout: 16, label: 'crate pressing the plate on the hot tiles' })
      .stopNow()
      .expect((s) => Math.abs(crate(s, 0).x - 27.8) < 1.4, 'the crate is on the plate')
      .form('liquid')
      .goTo(25.6, 0.4, { order: 'zx' }).goTo(30, 0.4).goTo(34.6, 0.4).goTo(37.2, 0)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 3, label: 'door A is held open by the crate' });
  },
  // 2. The Furnace Dash: freeze, step on the heavy plate, run; again from the middle platform, then wait in the pen
  (k) => {
    const x = X.dash;
    k.goTo(x + 2.4, 0).goTo(x + 3.6, 0).form('ice').goTo(x + 5.4, 0, { tol: 0.45 })
      .expectSignal('hp2', true)
      .expectSignal('dash1', true)
      .expect((s) => !fire(s, 'flames1').active, 'the flames are out while the plate is down')
      .hold('+x', { until: (s, p) => p.x > x + 25.6, timeout: 8, label: 'across the flames (melted on the hot strip on the way)' })
      .release().settle()
      .goTo(x + 26.4, 0.4)
      .expect((s) => s.checkpoint.pos[0] === x + 26.2, 'middle checkpoint lit')
      .goTo(x + 26.4, 0).form('ice').goTo(x + 28.4, 0, { tol: 0.45 })
      .expectSignal('hp3', true)
      .expectSignal('dash2', true)
      .expect((s) => !fire(s, 'flames2a').active && fire(s, 'flames2d').active, 'the first field is out and the second burns while the timer runs')
      .hold('+x', { until: (s, p) => p.x > x + 47.6, timeout: 9, label: 'into the pen' })
      .release().settle()
      .goTo(x + 49, 0)
      .expect((s) => s.checkpoint.pos[0] === x + 49, 'pen checkpoint lit')
      .until((s) => !fire(s, 'flames2d').active, { timeout: 12, label: 'the second field dies when the timer runs out' })
      .expect((s) => fire(s, 'flames2a').active, 'and the first relights behind')
      .goTo(x + 64.6, 0).goTo(x + 67, 0);
  },
  // 3. The Lift Hall: ice shoves crate 2 onto the pedal, the lift shuttles; ride it up, float over the beds of flame
  (k) => {
    const x = X.lift;
    k.goTo(x + 2.4, 0).goTo(x + 4.8, -2.2, { tol: 0.5 }).form('ice')
      .hold('+x', { until: (s) => s.signals.get('pump'), timeout: 12, label: 'crate pushed onto the pedal' })
      .stopNow()
      .expect((s) => Math.abs(crate(s, 1).x - (x + 16.4)) < 1.4, 'the crate is on the pedal')
      .form('liquid')
      .goTo(x + 18.4, 0.6, { order: 'zx' })
      .goTo(x + 23.5, 0, { tol: 0.45 })
      .until((s, p) => p.y > 8.9, { timeout: 18, label: 'carried up to the catwalk' })
      .goTo(x + 26.4, 0)
      .goTo(x + 29.8, 0)
      .until(full, { timeout: 4 })
      .form('steam')
      .hold('+x', { until: (s, p) => p.x > x + 41.9, timeout: 6, label: 'over the first bed of flame' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 9) < 1e-6 && p.x > x + 41, 'on the resting gallery')
      .goTo(x + 43, 0).goTo(x + 46.0, 0)
      .until(full, { timeout: 5, label: 'the gauge refills on solid ground' })
      .form('steam')
      .hold('+x', { until: (s, p) => p.x > x + 57.9, timeout: 6, label: 'over the second bed of flame' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 9) < 1e-6 && p.x > x + 57, 'on the far gallery')
      .goTo(x + 74, 0);
  },
  // 4. The Control Room: film closes the posts, ice shoves crate 3 onto the near plate and crate 3b onto the middle one, ice presses the far plate
  (k) => {
    const x = X.control;
    const c3 = () => crate(k.sim, 2), c3b = () => crate(k.sim, 3);
    k.goTo(x + 2.4, 0).goTo(x + 4.2, 0).form('film')
      .goTo(x + 7.6, 0).goTo(x + 9.1, 0)
      .expectSignal('arcC', true)
      .goTo(x + 10.4, 0).form('liquid')
      .goTo(x + 11.4, 0)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'the shutter is open' })
      .goTo(x + 15.0, -2.2, { tol: 0.45 }).form('ice')
      .hold('+x', { until: (s) => crate(s, 2).x >= x + 24.0, timeout: 12, label: 'crate pushed east along the lane' })
      .stopNow();
    // the crate is north of the kerb rail: line up behind it (against the kerb again) and push it north onto the near plate
    k.form('liquid')
      .goTo(c3().x - 1.6, -2.2, { order: 'xz', tol: 0.45 })
      .hold('-z', { for: 0.5 }).release().settle()
      .goTo(c3().x, -3.3, { tol: 0.5 }).form('ice')
      .hold('+z', { until: (s) => s.signals.get('pL'), timeout: 10, label: 'crate pushed north onto the near plate' })
      .stopNow()
      .expect((s) => Math.abs(crate(s, 2).x - (x + 25)) < 1.6 && crate(s, 2).z > 1.2, 'the crate is on the near plate')
      .form('liquid')
      .goTo(x + 20.0, 0.9, { order: 'zx' }).goTo(x + 14.8, 0.9, { tol: 0.45 }).goTo(x + 14.8, c3b().z, { tol: 0.45 }).form('ice')
      .hold('+x', { until: (s) => s.signals.get('pM'), timeout: 8, label: 'second crate pushed onto the middle plate' })
      .stopNow()
      .form('liquid')
      .goTo(x + 20.4, 0.6, { order: 'zx' }).goTo(x + 24, 0).goTo(x + 32.4, 0).form('ice')
      .goTo(x + 35.6, 0, { tol: 0.45 })
      .expectSignal('pH', true)
      .until((s) => s.signals.get('gateOpen'), { timeout: 6, label: 'both plates down together for three seconds' })
      .wait(0.1).expect((s) => !fire(s, 'gate').active, 'the gate flames are out')
      .form('liquid')
      .goTo(x + 43.6, 0).goTo(X.last + 1.2, 0);
  },
  // 5. The Last Furnace: crate onto its plate first, ice on the first plate, melt on the strip, ice on the second, then the dash while both timers run
  (k) => {
    const x = X.last;
    const c4 = () => crate(k.sim, 4);
    k.goTo(x + 2.4, 0).goTo(x + 4.6, -2.8, { tol: 0.45 }).form('ice')
      .hold('+z', { until: () => c4().z >= 1.8, timeout: 10, label: 'crate pushed north' })
      .stopNow()
      .form('liquid')
      .goTo(x + 3.0, 0.6, { order: 'xz', tol: 0.45 }).goTo(x + 3.0, c4().z, { tol: 0.45 }).form('ice')
      .hold('+x', { until: (s) => s.signals.get('pC'), timeout: 8, label: 'crate pushed onto its plate' })
      .stopNow()
      .expect(() => Math.abs(c4().x - (x + 8.2)) < 1.4, 'the crate is on its plate: set first')
      .form('liquid')
      .goTo(x + 5.0, 0.8, { order: 'zx' }).goTo(x + 6.6, -1.6, { tol: 0.45 }).form('ice')
      .goTo(x + 6.6, -1.6, { tol: 0.45 })
      .expectSignal('hA', true)
      .hold('+x', { until: (s, p) => p.form === 'liquid' && p.x > x + 12.6, timeout: 6, label: 'melted on the hot strip' })
      .goTo(x + 21.4, 1.6).form('ice').goTo(x + 25, 1.6, { tol: 0.45 })
      .expectSignal('hB', true)
      .expectSignal('dashF', true)
      .expect((s) => !fire(s, 'last').active, 'the last flames are out while both timers run')
      .form('liquid')
      .hold('+x', { until: (s, p) => p.x > x + 50 })
      .goTo(x + 55.6, 0).expectExit();
  },
];

export const areas = AREAS;
export function solve(k) { for (const a of AREAS) a(k); }
