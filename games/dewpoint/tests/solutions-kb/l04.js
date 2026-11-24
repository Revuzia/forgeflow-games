// Keyboard solution for l04 "Slip Casting". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Film (key 4) under the walls and over the posts, ice (key 2) on the crate, steam (key 3) up the ledges.

const full = (s, p) => p.gauge >= 3.99;
const door = (id) => (s) => s.level.doors.find((d) => d.id === id);
const down = (s, p) => p.grounded && p.y < -1;

export function solve(k) {
  // 1. The Mould Shelf
  k.goTo(-52, -0.8).goTo(-45.2, 0).form('film').goTo(-41.5, 0).form('liquid')
    .goTo(-34.4, 0).form('film').goTo(-28.6, 0).form('liquid')
    .expect((s) => !door('doorO')(s).open, 'the first shutter starts shut')
    .goTo(-24, -0.8).form('film').runTo('-z', -3.0)
    .expectSignal('pl0', true)
    .runTo('+z', 0).form('liquid')
    .goTo(-20, 0)
    .until((s) => door('doorO')(s).open >= 1, { label: 'first shutter open' })
    .goTo(-16.6, 0).hopTo('+x', { tap: 0.45 })
    .goTo(-12.2, 0).form('film').goTo(-8.4, 0).form('liquid')
    .goTo(-5.5, 0);
  // 2. The Sieve Floor: film through the slats, stand up in the basin, under the wall and up the ramp
  k.goTo(-2, 0.8).goTo(9, 0).form('film')
    .until(down, { timeout: 3, label: 'dropped through the slats into the basin' })
    .form('liquid')
    .goTo(14, 0).goTo(21.5, 0)
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'up the ramp, back on the floor')
    .goTo(22.4, 0);
  // 3a. Hall B: crawl under the low wall, lie across the posts, walk through the door they open
  k.goTo(26.2, 0).form('film').goTo(31.1, 0)
    .expectSignal('e1', true)
    .form('liquid')
    .goTo(34.4, 0)
    .until((s) => door('doorA')(s).open >= 1, { label: 'door A open' })
    .goTo(37.2, -0.4)
    // 3b. The nooks: a pair of posts in each, both circuits close the shutter
    .goTo(42, -0.6).form('film').runTo('-z', -3.5)
    .expectSignal('e5', true)
    .runTo('+z', -0.8).form('liquid')
    .expect((s) => !door('doorN')(s).open, 'one circuit is not enough')
    .goTo(50, 0.6).form('film').runTo('+z', 3.5)
    .expectSignal('e6', true)
    .runTo('-z', 0.8).form('liquid')
    .goTo(55.4, 0)
    .until((s) => door('doorN')(s).open >= 1, { label: 'shutter open' })
    .goTo(60.6, 0);
  // 4. The Glaze Tanks: dive as film, under the first wall, close the posts in the middle tank, shutter, ramp
  k.goTo(66, 0).form('film')
    .until(down, { timeout: 3, label: 'dropped into the first tank' })
    .form('liquid')
    .goTo(72.6, 0)
    .expect((s, p) => p.y < -1 && p.x > 71.2, 'under the first wall')
    .goTo(75.6, 0).form('film').goTo(75.6, 0)
    .expectSignal('e4', true)
    .form('liquid')
    .goTo(79, 0)
    .until((s) => door('doorT')(s).open >= 1, { label: 'tank shutter open' })
    .goTo(84, 0).goTo(97, 0)
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'up the ramp, back on the floor');
  // 5a. The Casting Hall: ice shoves the crate south, then east onto the heavy plate; film closes the last posts
  const crate = (s) => s.level.crates[0].body;
  k.expectSignal('exitOpen', false)
    .goTo(99, 0.8)
    .goTo(100.9, -3.3, { tol: 0.42 }).form('ice')
    .hold('+z', { until: (s) => crate(s).z >= 1.2, timeout: 8, label: 'crate pushed south' })
    .stopNow()
    .form('liquid')
    .goTo(99, 0.7, { order: 'zx' }).goTo(99, crate(k.sim).z, { tol: 0.7 }).form('ice')   // level with where the crate ended up
    .hold('+x', { until: (s) => crate(s).x >= 107.0, timeout: 10, label: 'crate pushed onto the heavy plate' })
    .stopNow()
    .expectSignal('hp', true)
    .form('liquid')
    .goTo(112.6, 0, { order: 'zx' }).form('film').goTo(117.5, 0)
    .expectSignal('e2', true)
    .form('liquid')
    .expect((s) => s.signals.get('exitOpen'), 'shutter unsealed')
    .goTo(121.4, 0)
    .until((s) => door('doorK')(s).open >= 1, { label: 'kiln shutter open' })
    .goTo(125.4, 0.8);
  // 5b. The kiln chamber: three ledges of steam
  const up = (k, over, y) => k.until(full, { timeout: 4, label: 'gauge full' }).form('steam')
    .hold('+x', { until: over, timeout: 5 }).form('liquid', { release: true }).land().settle()
    .expect((s, p) => Math.abs(p.y - y) < 1e-6, `on the ledge at y=${y}`);
  k.goTo(126.6, 0);
  up(k, (s, p) => p.x > 128.4 && p.y > 3, 3);
  k.goTo(131.6, 0);
  up(k, (s, p) => p.x > 133.6 && p.y > 6.4, 6.4);
  k.goTo(136.2, 0);
  up(k, (s, p) => p.x > 138.6 && p.y > 9.8, 9.8);
  k.goTo(147.4, 0).expectExit();
}
