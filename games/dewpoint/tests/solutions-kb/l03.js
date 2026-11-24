// Keyboard solution for l03 "Head of Steam". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Steam is flown with W held (and nothing else) and turned back into a drop with key 1 over the landing.

const full = (s, p) => p.gauge >= 3.99;
const door = (id) => (s) => s.level.doors.find((d) => d.id === id);
const fan = (id) => (s) => s.level.fans.find((f) => f.id === id);

/** Wait for a full gauge, boil, fly east holding W until `over`, condense, land and stand still. */
function fly(k, over, label, y) {
  k.until(full, { timeout: 4, label: 'gauge full' })
    .form('steam')
    .hold('+x', { until: over, timeout: 6, label })
    .form('liquid', { release: true }).land().settle();
  if (y !== undefined) k.expect((s, p) => Math.abs(p.y - y) < 1e-6, `landed at y=${y}`);
  return k;
}

export function solve(k) {
  // 1. The Boiler Floor: steam up ledge 1, wait for the gauge, steam up ledge 2
  k.goTo(-21, -0.8).goTo(8.9, 0);
  fly(k, (s, p) => p.x > 10.3 && p.y > 2.2, 'over the edge of ledge 1', 2.2);
  k.goTo(17, 0);
  fly(k, (s, p) => p.x > 18.4 && p.y > 5.0, 'over the edge of ledge 2', 5);
  // 2. The Grille Wall: low window, ledge, high window
  k.goTo(31.5, -0.8).goTo(38.2, 0);
  fly(k, (s, p) => p.x > 41.2, 'through the low window');
  k.goTo(44.6, 0);
  fly(k, (s, p) => p.x > 46.4 && p.y > 7.4, 'over the edge of the ledge', 7.4);
  k.goTo(54.8, 0);
  fly(k, (s, p) => p.x > 57.2, 'through the high window', 7.4);
  // 3. The Great Fan: two gaps, then ride the big fan; the cold air brings you down on the far platform
  k.goTo(65.5, -0.8).goTo(73.2, 0);
  fly(k, (s, p) => p.x > 84.2, 'across the first gap');
  k.expect((s, p) => Math.abs(p.y - 7.4) < 1e-6 && p.x > 83, 'on the islet').goTo(88.2, 0);
  fly(k, (s, p) => p.x > 99.2, 'across the second gap');
  k.expect((s, p) => Math.abs(p.y - 7.4) < 1e-6 && p.x > 98, 'on the near platform').goTo(107.2, 0)
    .until(full, { timeout: 4, label: 'gauge full' })
    .form('steam')
    .hold('+x', { until: (s, p) => p.form === 'liquid', timeout: 6, label: 'blown across and condensed by the cold' })
    .expect((s, p) => p.x > 126 && p.gauge > 0.5, 'condensed by the cold zone')
    .land().release().settle()
    .expect((s, p) => Math.abs(p.y - 7.4) < 1e-6 && p.x > 126, 'on the far platform');
  // 4. The Condenser: film onto plate 1, shaft 1 up, plate 2, shaft 2 up
  k.goTo(132, -0.8)
    .goTo(136.5, -1.2).form('film').runTo('-z', -4.7)
    .expectSignal('p3', true)
    .runTo('+z', -1.6).form('liquid')
    .goTo(140.7, 0)
    .until(full, { timeout: 4, label: 'gauge full' })
    .expect(fan('shaft') && ((s) => fan('shaft')(s).active), 'shaft 1 latched on')
    .form('steam')
    .hold('', { until: (s, p) => p.y > 19.2, timeout: 5, label: 'up the shaft, above the ledge' })
    .hold('+x', { until: (s, p) => p.form === 'liquid', timeout: 4, label: 'condensed by the cold above the ledge' })
    .land().release().settle()
    .expect((s, p) => Math.abs(p.y - 18.4) < 1e-6, 'on the ledge')
    .goTo(147.5, -2.6)
    .expectSignal('p5', true)
    .goTo(151.7, 0)
    .until(full, { timeout: 4, label: 'gauge full' })
    .expect((s) => fan('shaft2')(s).active, 'shaft 2 latched on')
    .form('steam')
    .hold('', { until: (s, p) => p.y > 28.2, timeout: 5, label: 'up the second shaft' })
    .hold('+x', { until: (s, p) => p.form === 'liquid', timeout: 4, label: 'condensed by the cold ceiling' })
    .land().release().settle()
    .expect((s, p) => Math.abs(p.y - 27.6) < 1e-6, 'on the gallery');
  // 5. The Flue Top
  k.goTo(158.6, -0.8).goTo(159.6, 0);
  k.until(full, { timeout: 4, label: 'gauge full' })
    .form('steam')
    .hold('+x', { until: (s, p) => p.x > 162.4, timeout: 6, label: 'into the cage' })
    .release().until((s, p) => Math.hypot(p.vx, p.vz) < 0.3, { label: 'drift to a stop over the plate' })
    .form('liquid').land().settle();
  k.expectSignal('p4', true).expectSignal('galeOn', true)
    .until(full, { timeout: 4, label: 'gauge refilled in the cage' })
    .form('steam')
    .hold('-x', { until: (s, p) => p.x < 160.2, timeout: 5, label: 'out of the cage' })
    .form('liquid', { release: true }).land().settle()
    .goTo(160, 4.8).goTo(169.6, 4.8).goTo(177.4, 0, { order: 'zx' })
    .until(full, { timeout: 4, label: 'gauge full' })
    .form('steam')
    .hold('+x', { until: (s, p) => p.form === 'liquid', timeout: 8, label: 'carried across and condensed by the cold' })
    .land().release().settle()
    .expect((s, p) => Math.abs(p.y - 27.6) < 1e-6 && p.x > 212, 'on the kiln platform')
    .goTo(225, 0)
    .expectExit();
}
