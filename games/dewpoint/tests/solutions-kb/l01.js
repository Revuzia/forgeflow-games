// Keyboard solution for l01 "First Drip". Headings: +x = W, -z = A, +z = D, -x = S (camYaw -90).
// A person's way through: run to a mark and stop, line up (taps), then hop or jump from standing.

export function solve(k) {
  // 1. The Drip Tray: lane z=-3.2 past the kilns, lane z=-1 past the last kiln, two hurdles, the slabs, the gap
  k.runTo('-z', -3.2)
    .runTo('+x', -2)
    .goTo(2.5, -1, { tol: 0.5 })
    .goTo(7.5, -1).hopTo('+x', { tap: 0.45 })           // hurdle 1
    .goTo(13.3, -1).hopTo('+x', { tap: 0.45 })          // hurdle 2
    .goTo(17.2, -1)
    .climb('+x', 1.35, { tap: 0.2 })                         // the slabs
    .expect((s, p) => Math.abs(p.y - 1.35) < 1e-6, 'on the top slab')
    .goTo(24.1, -1, { tol: 0.42 })
    .hopTo('+x', { tap: 0.45 })                          // the gap over the fire: line up at the edge, hop from standing (no timing)
    .expect((s, p) => p.x > 27.4 && Math.abs(p.y) < 1e-6, 'across the gap')
    .goTo(37, 0)
    // 2. The Plate Gallery
    .goTo(42.2, -1)
    .runTo('-z', -4.4)
    .goTo(42.9, -4.4)
    .climb('+x', 2.4, { tap: 0.2 })                          // the two big steps
    .expect((s, p) => Math.abs(p.y - 2.4) < 1e-6, 'on the gallery')
    .goTo(53.3, -4.4, { tol: 0.42 })
    .hopTo('+x', { tap: 0.45 })                          // gallery gap 1
    .goTo(60.0, -4.4)
    .climb('+x', 3.6, { tap: 0.2 })
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'up on the plate level')
    .goTo(63.1, -4.4, { tol: 0.42 })
    .hopTo('+x', { tap: 0.45 })                          // gallery gap 2
    .goTo(68.6, -4.5)
    .expectSignal('p1', true)
    .runTo('+x', 71.5)
    .hold('+x', { until: (s, p) => p.grounded && p.y < 0.01, label: 'off the end, down to the floor' })
    .goTo(76, 0)
    .until((s) => s.level.doors[0].open >= 1, { label: 'door A open' })
    .hold('+x', { until: (s, p) => p.x > 80.4 })
    // 3. The Squeeze
    .goTo(82, -0.8)
    .goTo(86.6, 0)
    .form('film')
    .runTo('+x', 94.6)
    .form('liquid')
    .goTo(103, -0.4)
    .form('film')
    .runTo('-z', -5.0)
    .expectSignal('p3', true)
    .runTo('+z', -1.0)
    .form('liquid')
    .goTo(110, 0)
    .until((s) => s.level.doors.find((d) => d.id === 'doorC').open >= 1, { label: 'door C open' })
    .goTo(114.4, 0)
    .climb('+x', 2.4, { tap: 0.2 })
    .expect((s, p) => Math.abs(p.y - 2.4) < 1e-6, 'up the second step')
    .goTo(123, 0)
    .hold('+x', { until: (s, p) => p.grounded && p.y < 0.01, label: 'down again' })
    // 4. The Quick Door
    .goTo(127, -0.8)
    .goTo(131.6, -3.2)
    .expectSignal('p2', true)
    .goTo(133.3, 0, { tol: 0.42 }).hopTo('+x', { tap: 0.45 })
    .goTo(138.0, 0, { tol: 0.42 }).hopTo('+x', { tap: 0.45 })
    .goTo(142.85, 0, { tol: 0.42 }).hopTo('+x', { tap: 0.45 })
    .goTo(147.55, 0, { tol: 0.42 }).hopTo('+x', { tap: 0.45 })
    .goTo(152, 0)
    .form('film')
    .runTo('+x', 157.6)
    .form('liquid')
    .expect((s) => s.signals.get('doorB') === true, 'door B still held open')
    .hold('+x', { until: (s, p) => p.x > 163 })
    // 5. The Kiln Steps
    .goTo(171.4, 0)
    .climb('+x', 3.6, { tap: 0.45 })
    .expect((s, p) => Math.abs(p.y - 3.6) < 1e-6, 'on the top step')
    .goTo(188.6, 0)
    .expectSignal('pe', true)
    .goTo(202.3, 0, { tol: 0.42 })
    .hopTo('+x', { tap: 0.45 })
    .expect((s, p) => p.x > 204.5 && Math.abs(p.y - 3.6) < 1e-6, 'over the last gap')
    .hold('+x', { until: (s, p) => p.x > 214 })
    .expectExit();
}
