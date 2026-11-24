// Keyboard solution for l06 "Greenware". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Liquid walks into embers and waters buds; steam (key 3) is flown with W/A/S/D, let go over the spot, and condensed with key 1.

import level from '../../src/levels/l06.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const full = (s, p) => p.gauge >= 3.99;
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const door = (s, id) => s.level.doors.find((d) => d.id === id);

/** Walk into a doorway of embers as a drop: they are out for good the moment water touches them. */
function douse(k, id, from, into) {
  return k.goTo(from, 0)
    .hold('+x', { until: (s) => ember(s, id).doused, timeout: 4, label: `${id} doused by touch` })
    .release().settle();
}

/** Water a bud (stand beside it), then hop straight up its leaves. */
function climb(k, id, x, z, hops, top) {
  k.goTo(x - 0.3, z, { tol: 0.5 })
    .until((s) => sprout(s, id).state === 2, { timeout: 4, label: `${id} grown` })
  for (let i = 0; i < hops; i++) k.jump({ hold: 0.45 }).land().settle();
  return k.expect((s, p) => Math.abs(p.y - top) < 1e-6, `on the top leaf of ${id}`);
}

/**
 * Steam: line up with the ember, boil, fly at it with one key (or two for a diagonal) - pushing on past the pillar's
 * wall until clear of its top - let go when the drift will end over the ember, wait to be high enough, condense: the
 * rain puts the ember out and Mote lands on the pillar.
 */
function rainOn(k, id, over, y, stand, from, dir = '+x') {
  k.goTo(from[0], from[1], { tol: 0.6 });
  const diag = dir.length > 2;
  const ux = dir.includes('x') ? (diag ? Math.SQRT1_2 : 1) : 0, uz = dir.includes('z') ? (diag ? Math.SQRT1_2 : 1) : 0;
  const rem = (p) => (over[0] - p.x) * ux + (over[1] - p.z) * uz;
  // wait until the cloud is high enough that it will clear the pillar top by the time it gets there
  const toFace = Math.max(0, rem({ x: from[0], z: from[1] }) - (diag ? 1.4 : 1.0) - 0.38);
  const yStart = stand + 0.15 - 1.4 * (toFace / 3.4 + 0.35);
  k.until(full, { timeout: 4, label: 'gauge full' }).form('steam')
    .until((s, p) => p.y > yStart, { timeout: 4, label: 'rise' })
    .hold(dir, {
      until: (s, p) => {
        const moved = ((p.x - p.px) * ux + (p.z - p.pz) * uz) * 120;                  // how fast it is really going (a wall stops it)
        const v = Math.min(3.4, Math.max(0, moved) + 9 * 0.15);                        // about where it will be when the key is up
        return p.y > stand + 0.2 && rem(p) <= v * 0.15 + v * v / 10;
      },
      timeout: 5, label: `over ${id}`,
    })
    .stopNow()
    .until((s, p) => p.y > y, { timeout: 6, label: `above ${id}` })
    .form('liquid')
    .until((s) => ember(s, id).doused, { timeout: 3, label: `rain put ${id} out` })
    .until((s, p) => p.grounded && Math.abs(p.y - stand) < 1e-6, { timeout: 4, label: `standing on the pillar of ${id}` }).settle();
  return k;
}

export function solve(k) {
  // 1. The Clay Store
  k.goTo(A1 + 2.4, -0.9);
  douse(k, 'doorEmbers', A1 + 20.6, A1 + 23.4);
  climb(k, 'bud1', A1 + 33, 0, 3, 3);
  // 2. The Slip House
  k.goTo(A2 + 2.2, -0.9);
  climb(k, 'budB', A2 + 8.0, 0, 3, 6.6);
  k.goTo(A2 + 12, 0);
  douse(k, 'houseEmbers', A2 + 14.0, A2 + 16.8);
  climb(k, 'budC', A2 + 21.8, 0, 3, 9.6);
  k.goTo(A2 + 26, 0);
  douse(k, 'atticEmbers', A2 + 28.2, A2 + 30.8);
  k.goTo(A2 + 36, 0).hold('+x', { until: (s, p) => p.x > A2 + 47.6 && p.grounded, label: 'down the ramp' }).release().settle();
  // 3. The Rain Gallery: four embers on pillars, four rains from four heights; the gate opens
  k.goTo(A3 + 2.2, -0.9).expect((s) => !door(s, 'gate').open, 'the gate is shut').goTo(A3 + 8, 0);
  rainOn(k, 'pillarA', [A3 + 11, -2], 5.7, 5.2, [A3 + 8.4, -2]);
  k.expectSignal('pa', true).expectSignal('pb', false)
    .goTo(A3 + 12.8, -2.2).land().settle()
    .goTo(A3 + 13.0, 2.2).hopTo('+x', { tap: 0.2 })
    .expect((s, p) => Math.abs(p.y - 4.2) < 1e-6, 'on the stone step');
  rainOn(k, 'pillarB', [A3 + 17, 2], 6.7, 6.2, [A3 + 15, 2.2]);
  k.expectSignal('pb', true).expectSignal('pc', false)
    .goTo(A3 + 19.4, 0.6).land().settle();
  climb(k, 'budD', A3 + 21.4, -2.0, 3, 6.2);
  rainOn(k, 'pillarC', [A3 + 26, -2], 8.5, 8.0, [A3 + 21.4, -2.0]);
  k.expectSignal('pc', true).expectSignal('pd', false);
  rainOn(k, 'pillarD', [A3 + 29.6, 2], 10.7, 10.2, [A3 + 26.4, -1.6], '+x+z');
  k.expectSignal('pd', true)
    .goTo(A3 + 31.2, 0.6).land().settle()
    .goTo(A3 + 31.4, 0)
    .until((s) => door(s, 'gate').open >= 1, { timeout: 4, label: 'gate open' })
    .goTo(A3 + 39, 0);
  // 4. The Greenhouse: in through the bars as a cloud, bench to bench, rain beside the bud, up the ladder
  const hopBench = (over, y, minX, maxX) => k.until(full, { timeout: 4, label: 'gauge full' }).form('steam')
    .hold('+x', { until: over, timeout: 6, label: 'across' })
    .form('liquid', { release: true }).land().settle()
    .expect((s, p) => Math.abs(p.y - y) < 1e-6 && p.x > minX && p.x < maxX, `on the bench at y=${y}`);
  k.goTo(A4 + 2.2, -0.9).goTo(A4 + 8.0, 0);
  hopBench((s, p) => p.x > A4 + 11.5 && p.y > 3.6, 3, A4 + 10.5, A4 + 14.5);
  k.goTo(A4 + 14.0, 0);
  hopBench((s, p) => p.x > A4 + 21, 3, A4 + 20.5, A4 + 24.5);
  k.goTo(A4 + 24.0, 0);
  hopBench((s, p) => p.x > A4 + 31, 3, A4 + 30.5, A4 + 36);
  climb(k, 'budG', A4 + 34.4, 0, 8, 12.6);
  // 5. The Kiln Garden: out onto the catwalk, down the ramp, cloud over the pit, the last bud, the last embers
  k.goTo(A5 + 2, -0.9).goTo(A5 + 8, 0)
    .hold('+x', { until: (s, p) => p.x > A5 + 31.4 && p.grounded, label: 'down the ramp' })
    .release().settle()
    .expect((s, p) => Math.abs(p.y - 3) < 0.05, 'down in the garden')
    .goTo(A5 + 36.2, 0);
  hopBench((s, p) => p.x > A5 + 42.4 && p.y > 3.2, 3, A5 + 42, A5 + 48);
  k.goTo(A5 + 47.4, 0);
  hopBench((s, p) => p.x > A5 + 53.6 && p.y > 5.8, 5.6, A5 + 52, A5 + 60);
  climb(k, 'bud2', A5 + 57.0, 0, 8, 14.8);
  douse(k, 'kilnEmbers', A5 + 64.6, A5 + 67.4);
  k.goTo(A5 + 75.4, 0).expectExit();
}
