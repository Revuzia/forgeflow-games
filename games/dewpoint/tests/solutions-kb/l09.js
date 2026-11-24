// Keyboard solution for l09 "Heat Haze". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Vents boil Mote and hold the gauge full; steam is flown with one or two keys and let go over the landing.

const full = (s, p) => p.gauge >= 3.99;
const crate = (s, i) => s.level.crates[i].body;

/**
 * Walk into a heat vent: it boils Mote (and will not let it be anything else while inside). One measured tap from the
 * lineup (the vent's near edge is at x = `edge`): in about half a metre, then let go - a reaction to "I boiled" would
 * carry a cloud on out of the vent and into the cold air.
 */
function intoVent(k, edge) {
  const T = Math.max(0.15, (edge + 0.5 - k.p.x) / 5.2 + 0.06);
  return k.tap('+x', T).until((s, p) => p.form === 'steam', { timeout: 3, label: 'boiled by the vent' });
}

const AREAS = [
  // 1. The Flue Foot: the small vent lifts you onto the step, the big one over the cliff
  (k) => {
    k.goTo(3, 0).goTo(5.0, 0);
    intoVent(k, 6.0)
      .until((s, p) => p.y > 2.5, { timeout: 6, label: 'rising past the step' })
      .hold('+x', { until: (s, p) => p.x > 9.2, timeout: 4, label: 'over the step' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 2) < 1e-6, 'on the step')
      .goTo(12.0, 0);
    intoVent(k, 13.4)
      .until((s, p) => p.y > 6.5, { timeout: 10, label: 'rising up the cliff' })
      .hold('+x', { until: (s, p) => p.x > 17, timeout: 4, label: 'over the cliff edge' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 6) < 1e-6 && p.x > 16.3, 'on the Damper Room floor');
  },
  // 2. The Damper Room: ice shoves crate 1 east along z = -1.9, then north onto the plate that sits in the haze
  (k) => {
    k.goTo(19.6, 0).goTo(19.8, -1.75, { tol: 0.42 }).form('ice')
      .hold('+x', { until: (s) => crate(s, 0).x >= 49.0, timeout: 16, label: 'crate pushed east along the lane' })
      .stopNow()
      .form('liquid')
      .goTo(46.5, -3.0, { order: 'zx' })
      .hold('-z', { for: 0.5 }).release().settle()                         // against the kerb: the rail
      .goTo(crate(k.sim, 0).x, -3.4, { tol: 0.6, order: 'xz' })
      .form('ice')
      .hold('+z', { until: (s) => s.signals.get('p1'), timeout: 10, label: 'crate pushed north onto the plate in the haze' })
      .stopNow()
      .expect((s) => crate(s, 0).z > 0.75 && crate(s, 0).z < 3.5, 'the crate is on the plate in the haze');
    k.form('liquid')
      .goTo(51.0, -1.6, { order: 'zx' })
      .goTo(60.6, 0)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'door A is open' });
  },
  // 3. The Cold Walk: film under the wall closes the posts; ice shoves crate 2 onto the light plate (cooling the corridor); ice slides on to the heavy plate
  (k) => {
    k.goTo(64.6, 0).goTo(66.4, 0).form('film')
      .goTo(69.6, 0).goTo(70.9, 0)
      .expectSignal('arcC', true)
      .goTo(72.0, 0).form('liquid')
      .goTo(72.6, 0)
      .until((s) => s.level.doors[1].open >= 1, { timeout: 4, label: 'door C is open' })
      .goTo(74.8, 0).form('ice')
      .hold('+x', { until: (s) => crate(s, 1).x >= 81.4, timeout: 10, label: 'crate pushed east to the plate' })
      .stopNow()
      .form('liquid')
      .goTo(79.6, -2.2, { order: 'zx' })
      .goTo(crate(k.sim, 1).x, -2.4, { tol: 0.6, order: 'xz' })
      .form('ice')
      .hold('+z', { until: (s) => s.signals.get('cool'), timeout: 8, label: 'crate pushed north onto the light plate' })
      .stopNow()
      .expect((s) => crate(s, 1).z > 1.2 && crate(s, 1).z < 3.8, 'the crate is on the light plate')
      .expect((s) => !s.level.zones[3].active, 'the vents in the corridor are off')
      .form('liquid')
      .goTo(81.0, -1.4, { order: 'zx' }).goTo(84.5, -1.4).goTo(86.4, 0).form('ice')
      .hold('+x', { until: (s) => s.signals.get('hh'), timeout: 8, label: 'over the heavy plate' })
      .stopNow()
      .expectSignal('flue', true)
      .form('liquid')
      .goTo(94.6, 0)
      .until((s) => s.level.doors[2].open >= 1, { timeout: 4, label: 'door B is open' })
      .goTo(99, 0);
  },
  // 4. The Boiler Hall: up the launch vent above the cold band, across to the tall vent, down onto the pier; crate and bridge
  (k) => {
    k.goTo(100, 0).goTo(102.2, 0);
    intoVent(k, 103.4)
      .until((s, p) => p.y > 16.9, { timeout: 14, label: 'above the cold band' })
      .hold('+x', { until: (s, p) => p.x > 117.0, timeout: 8, label: 'across to the tall vent' })
      .expect((s, p) => p.gauge > 3.9, 'the tall vent refilled the gauge')
      .hold('+x', { until: (s, p) => p.x > 121.8, timeout: 6, label: 'out over the pier' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 9) < 1e-6 && p.x > 121.6, 'on the pier')
      .goTo(123.4, 0)
      .goTo(124.4, -1.9).form('ice')
      .hold('+x', { until: (s) => crate(s, 2).x >= 132.0, timeout: 12, label: 'crate pushed east' })
      .stopNow()
      .form('liquid')
      .goTo(130.0, -3.0, { order: 'zx' })
      .hold('-z', { for: 0.5 }).release().settle()
      .goTo(crate(k.sim, 2).x, -3.4, { tol: 0.6, order: 'xz' })
      .form('ice')
      .hold('+z', { until: (s) => s.signals.get('bridge'), timeout: 10, label: 'crate on the heavy plate' })
      .stopNow()
      .form('liquid')
      .goTo(133.0, 0, { order: 'xz' })
      .until((s) => s.level.movers[0].t >= 1, { timeout: 12, label: 'the bridge is all the way out' })
      .goTo(134.6, 0).goTo(154, 0);
  },
  // 5. The Great Draught: douse the embers, rise through the grate lid, land on the crown, ride the ferry over the kiln mouth
  (k) => {
    k.goTo(155, 0)
      .hold('+x', { until: (s) => s.level.embers[0].doused, timeout: 8, label: 'the ember doorway is out' })
      .release().settle()
      .goTo(169.4, 0).goTo(171.0, 0);
    intoVent(k, 171.6)
      .until((s, p) => p.y > 28.8, { timeout: 22, label: 'up through the grate lid' })
      .hold('+x', { until: (s, p) => p.x > 176.6, timeout: 5, label: 'out over the crown' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 28) < 1e-6, 'on the crown')
      .goTo(178, 0).goTo(179.2, 0)
      .runTo('+x', 181.6, { label: 'onto the ferry deck and stand' })
      .until((s) => s.level.movers[1].t >= 1, { timeout: 14, label: 'ferried across' })
      .goTo(197, 0)
      .goTo(203.6, 0).expectExit();
  },
];

export const areas = AREAS;
export function solve(k) { for (const a of AREAS) a(k); }
