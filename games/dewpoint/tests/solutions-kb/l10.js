// Keyboard solution for l10 "Quench". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Frost keeps Mote ice (steered with the same keys, braked with the opposite one); liquid walks where lining up matters.

import { X } from '../../src/levels/l10.js';

const full = (s, p) => p.gauge >= 3.99;
const ferry = (s) => s.level.movers[0];

const AREAS = [
  // 1. The Icehouse: the frost freezes Mote, ice presses the heavy plate, the door opens, the ferry, the slide smashes the glass
  (k) => {
    k.goTo(7.6, 0).goTo(12.6, 0)
      .hold('+x', { until: (s, p) => p.form === 'ice', timeout: 4, label: 'frozen by the frost at the edge of the hall' })
      .hold('+x', { until: (s) => s.signals.get('h0'), timeout: 6, label: 'over the heavy plate' })
      .stopNow()
      .until((s) => s.level.doors[0].open >= 1, { timeout: 3, label: 'door opens' })
      .goTo(33.4, 0)
      .expect((s) => s.checkpoint.pos[0] === 33.4, 'ferry checkpoint lit')
      .goTo(35.2, 0);
    // nudge onto the deck: the ferry leaves the moment Mote touches its sensor, so stop nudging then
    for (let i = 0; i < 8 && !k.sim.signals.get('deck') && ferry(k.sim).t < 0.01; i++) k.tap('+x', 0.15).settle();
    k.expect((s) => s.signals.get('deck') || ferry(s).t > 0, 'on the ferry deck')
      .until((s) => ferry(s).t >= 1, { timeout: 14, label: 'the ferry is across' })
      .hold('+x', { until: (s, p) => p.x > 47.6, timeout: 5, label: 'off the ferry' })
      .hold('+x', { until: (s) => s.level.panes[0].broken, timeout: 10, label: 'the slide smashes the pane' })
      .stopNow({ timeout: 15 })
      .expect((s, p) => p.x > X.store && p.form === 'ice', 'in the cold store');
  },
  // 2. The Cold Store: two crates onto two plates (they hold the frost off), then steam through the grate
  (k) => {
    const x = X.store;
    const A = (s) => s.level.crates[0].body, B = (s) => s.level.crates[1].body;
    k.goTo(x + 3.4, -4.1, { order: 'xz' }).goTo(x + 8, -4.2)
      .hold('+z', { until: (s) => A(s).z >= 1.0, timeout: 10, label: 'crate A pushed north to the gap in the wall' })
      .stopNow();
    for (let i = 0; i < 6 && A(k.sim).z < 1.5; i++) k.tap('+z', 0.15).settle();     // not past the end of the wall yet: nudge it on
    k.expect((s) => A(s).z >= 1.45, 'crate A is level with the gap in the wall')
      .goTo(x + 6.2, 0.6, { order: 'xz', tol: 0.35 }).goTo(x + 6.2, A(k.sim).z, { tol: 0.35 })
      .hold('+x', { until: (s) => A(s).x >= x + 23.4, timeout: 16, label: 'crate A pushed east through the gap' })
      .stopNow()
      .goTo(A(k.sim).x - 0.4, 3.6, { order: 'zx' }).goTo(A(k.sim).x, 3.8)
      .hold('-z', { until: (s) => s.signals.get('thawA'), timeout: 14, label: 'crate A pushed south onto plate A' })
      .stopNow()
      .expect((s) => s.level.plates[1].pressed, 'crate A holds plate A')
      .expectSignal('thaw', false)
      .goTo(x + 14, 1.6, { order: 'zx' }).goTo(x + 6.2, 1.6, { tol: 0.35 }).goTo(x + 6.2, 3.2, { tol: 0.35 })
      .hold('+x', { until: (s) => s.signals.get('thawB'), timeout: 16, label: 'crate B pushed east onto plate B' })
      .stopNow()
      .expectSignal('thaw', true)
      .expect((s) => !s.level.zones[1].active, 'the frost is off')
      .form('liquid')
      .goTo(x + 22.4, 1.4, { order: 'xz' })
      // the grate in the far wall: steam through it, condense on the bank
      .goTo(x + 26.4, 0.4)
      .until(full, { timeout: 4 })
      .form('steam')
      .hold('+x', { until: (s, p) => p.x > x + 31.4, timeout: 5, label: 'out through the grate' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => p.x > x + 30.2 && Math.abs(p.y + 3) < 1e-6, 'on the bank');
  },
  // 3. The Skate Hall: the chute carries Mote down, up the far side and over the gap; the glass breaks
  (k) => {
    const x = X.skate;
    k.goTo(x + 2.6, 0).goTo(x + 6.0, 0)
      .hold('+x', { until: (s, p) => p.form === 'ice', timeout: 4, label: 'frozen at the top of the chute' })
      .hold('+x', { until: (s) => s.level.panes[1].broken, timeout: 14, label: 'over the gap and through the glass' })
      .stopNow({ timeout: 15 })
      .expect((s, p) => p.x > X.cellar && p.form === 'ice' && Math.abs(p.y + 6.5) < 1e-6, 'in the Seed Cellar');
  },
  // 4. The Seed Cellar: ice on the plate lifts the frost; film under two low walls, a drop at the bud, climb; the cold on the gallery
  (k) => {
    const x = X.cellar;
    const bud = (s, i) => s.level.sprouts[i];
    const hops = (n) => { for (let i = 0; i < n; i++) k.jump({ hold: 0.45 }).land().settle(); };
    k.goTo(x + 1.8, -2.6).goTo(x + 5.0, 2.4)
      .expectSignal('pT', true)
      .expectSignal('thaw4', true)
      .form('liquid')
      .goTo(x + 6.2, 0).form('film').goTo(x + 9.8, 0).form('liquid')
      .goTo(x + 12.2, 0).form('film').goTo(x + 15.8, 0).form('liquid')
      .goTo(x + 18.9, 0)
      .until((s) => bud(s, 0).state === 2, { timeout: 4, label: 'bud grown' })
      .expectSignal('thaw4', true);
    hops(6);
    k.expect((s, p) => Math.abs(p.y - 0.1) < 1e-6, 'on the top leaf')
      .goTo(x + 20.8, 0)
      .hold('+x', { until: (s, p) => p.form === 'ice', timeout: 3, label: 'frozen again on the gallery' })
      .goTo(x + 21.6, -2.8)
      .expect((s) => s.checkpoint.pos[0] === x + 21.6, 'gallery checkpoint lit')
      .goTo(x + 22.8, 2.4)
      .expectSignal('pT2', true)
      .expectSignal('thaw5', true)
      .form('liquid')
      .goTo(x + 26.7, 0)
      .until((s) => bud(s, 1).state === 2, { timeout: 4, label: 'second bud grown' })
      .expectSignal('thaw5', true);
    hops(5);
    k.expect((s, p) => Math.abs(p.y - 6.1) < 1e-6, 'on the second top leaf')
      .goTo(x + 29.6, 0)
      .hold('+x', { until: (s, p) => p.form === 'ice', timeout: 3, label: 'frozen again on the top gallery' })
      .goTo(x + 33.4, 0)
      .expectSignal('hg', true)
      .until((s) => s.level.doors[1].open >= 1, { timeout: 4, label: 'the gallery door opens' })
      .hold('+x', { until: (s, p) => p.x > x + 39.6, timeout: 8, label: 'through the door' })
      .hold('+x', { until: (s, p) => p.form === 'ice' && p.x > x + 39.8, timeout: 4, label: 'still ice, out of the frost' })
      .form('liquid')
      .goTo(x + 54, 0).goTo(X.tank + 2, 0);
  },
  // 5. The Quench Tank: ice off the bank, shove the crate along the floor beneath the flames onto the sluice plate, melt beyond it
  (k) => {
    const x = X.tank;
    k.goTo(x + 2, 0).goTo(x + 6.0, 0).form('ice')
      .hold('+x', { until: (s, p) => p.x > x + 8.6 && p.y < -7.7, timeout: 6, label: 'sunk to the tank bottom' })
      .stopNow()
      .goTo(x + 10.2, 0, { tol: 0.4 })
      .expect((s) => Math.abs(s.level.crates[2].body.z) < 0.1, 'the crate waits on the tank floor')
      .hold('+x', { until: (s) => s.signals.get('sluice'), timeout: 40, label: 'crate shoved along the floor onto the sluice plate' })
      .stopNow()
      .expect((s) => Math.abs(s.level.crates[2].body.x - (x + 52.4)) < 1.5, 'the crate is on the sluice plate')
      .until((s) => s.level.doors[2].open >= 1, { timeout: 3, label: 'the sluice opens' })
      .goTo(x + 50.0, 2.2, { order: 'zx', tol: 0.5 }).goTo(x + 54.6, 2.2, { tol: 0.5 }).goTo(x + 54.6, 0.2, { tol: 0.5 })
      .hold('+x', { until: (s, p) => p.x > x + 56.8, timeout: 8, label: 'through the sluice' })
      .form('liquid', { release: true })
      .until((s, p) => p.floating, { timeout: 4, label: 'floated up' })
      .hold('+x', { until: (s, p) => p.x > x + 59.4, timeout: 10, label: 'swimming to the bank' })
      .hop('+x', { tap: 0.3 }).land().settle()
      .expect((s, p) => Math.abs(p.y + 6.5) < 1e-6, 'out of the water')
      .goTo(x + 67.8, 0).expectExit();
  },
];

export const areas = AREAS;
export function solve(k) { for (const a of AREAS) a(k); }
