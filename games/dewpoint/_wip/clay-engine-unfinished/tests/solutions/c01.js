// Scripted solutions for c01 "Hessian Hands" (Clay). Five rooms, each opened by a lamp post.
// solve() is the plain route; solveAll() also takes the three maker's marks (the bench in the cellar,
// the rough pillar on the stair, the pillar in the yard reached by jumping off a rough wall).
// Climbing uses the helpers in tests/lib/clay.js: climb() pushes into a rough wall until Dab is on
// top, jumpHang() jumps up into a rough ceiling, hangTo() crosses under it and lets go.

import { climb, jumpHang, hangTo } from '../lib/clay.js';

const cp = (i) => (s) => s.checkpoint && s.checkpoint === s.level.checkpoints[i];
const at = (y) => (s, p) => p.grounded && Math.abs(p.y - y) < 1e-6;

function cellar(r, mark) {
  r.walkTo(2.5, 0).expect(cp(0), 'checkpoint: the damp cellar');
  if (mark) {
    // the easy mark: up onto the bench
    r.walkTo(7.2, 2.2).jumpTo(7.2, 3.9).expectShards(1).walkTo(7.2, 2.4);
  }
  r.walkTo(12.4, 0);
  climb(r, 1, 0).expect(at(2.0), 'on top of the first wall');
  r.walkTo(16, 0).walkTo(20.4, 0);
  climb(r, 1, 0).expect(at(2.6), 'on top of the tall wall');
  r.walkTo(24, 2.2).walkTo(26.4, 3.2);
  climb(r, 1, 0).expect(at(2.2), 'over the third wall, by its rough patch off to the side');
  r.walkTo(30, 3.2);
}

function stair(r, mark) {
  r.walkTo(34, 0).expect(cp(1), 'checkpoint: the stair');
  r.walkTo(39.4, 0);
  climb(r, 1, 0).expect(at(1.8), 'up the first terrace');
  if (mark) {
    // off the path: the rough pillar
    r.walkTo(44, 1.8);
    climb(r, 0, 1).expect(at(4.4), 'on the pillar').walkTo(44, 3).expectShards(2)
      .walkTo(44, 1.2).waitUntil(at(1.8), { timeout: 3, label: 'back down' });
  }
  // the capped wall: up, then along it to the open end, and over
  r.walkTo(47.4, 1.0);
  climb(r, 0.7, 0.7).expect((s, p) => at(3.6)(s, p) && p.z > 2.4, 'over the capped wall at its open end');
  // the smooth wall: up the rough post beside it, and across from its top
  r.walkTo(55.4, -1.0);
  climb(r, 1, 0).expect(at(6.2), 'on top of the post');
  r.walkTo(56.9, -1.0).jumpTo(58.5, -1.0).expect(at(6.0), 'across onto the smooth wall');
  r.walkTo(61, -1.0).waitUntil(at(3.6), { timeout: 3, label: 'down the far side' });
}

function racks(r) {
  r.walkTo(68, 1).expect(cp(2), 'checkpoint: the racks');
  r.walkTo(73.8, 0);
  jumpHang(r);
  hangTo(r, 77.5, 0).waitUntil((s, p) => p.grounded, { timeout: 3, label: 'dropped onto the far ledge' })
    .expect((s, p) => at(3.6)(s, p) && p.x > 77.2, 'across the first drop');
  r.walkTo(78.6, 0).jumpTo(84.2, 0, { run: 2.0 }).expect(at(3.6), 'over the gap');
  r.walkTo(87.8, 0);
  jumpHang(r);
  hangTo(r, 91.5, 0).waitUntil((s, p) => p.grounded, { timeout: 3, label: 'dropped onto the far ledge' })
    .expect((s, p) => at(3.6)(s, p) && p.x > 91.2, 'across the second drop');
  r.walkTo(97, 0).waitUntil(at(2.4), { timeout: 3, label: 'down the step' });
}

function hall(r) {
  r.walkTo(103.5, 0).expect(cp(3), 'checkpoint: the kneading hall');
  r.walkTo(112.3, -1.4).jumpTo(112.3, 0.6).expect(at(3.4), 'on the step');
  climb(r, 0, 1).walkTo(112.3, 3.2).expectSignal('gateA', true);
  r.walkTo(112.3, 0.6).walkTo(112.3, -1.4).waitUntil(at(2.4), { timeout: 3, label: 'down off the plinth' })
    .waitUntil((s) => s.level.doors[0].open > 0.99, { timeout: 2, label: 'the shutter is open' });
  r.walkTo(124.4, 0);
  climb(r, 1, 0).expect(at(4.4), 'up the terrace');
  r.walkTo(128.0, 0);
  jumpHang(r);
  hangTo(r, 131.5, 0).waitUntil((s, p) => p.grounded, { timeout: 3, label: 'dropped onto the far ledge' })
    .expect((s, p) => at(4.4)(s, p) && p.x > 131.2, 'across the hall drop');
}

function yard(r, mark) {
  r.walkTo(139.5, 0).expect(cp(4), 'checkpoint: the yard');
  if (mark) {
    // the clever mark: climb the rough panel on the wall, then jump off it onto the pillar
    r.walkTo(144.8, -4.0);
    climb(r, 0, -1, { until: (s, p) => p.y > 6.05 });
    r.waitUntil((s, p) => p.grounded, { jump: true, timeout: 3, label: 'jumped off the wall onto the pillar' })
      .expect(at(6.4), 'standing on the pillar')
      .walkTo(144.8, -2.9).expectShards(3)
      .walkTo(144.8, -1.6).waitUntil(at(4.4), { timeout: 3, label: 'back down' });
  }
  r.walkTo(146.8, 0);
  jumpHang(r);
  hangTo(r, 150.5, 0).waitUntil((s, p) => p.grounded, { timeout: 3, label: 'dropped onto the far ledge' })
    .expect((s, p) => at(4.4)(s, p) && p.x > 150.2, 'across the drain');
  r.walkTo(153.4, 0);
  climb(r, 1, 0).expect(at(6.8), 'up the first yard terrace');
  r.walkTo(159.4, 0);
  climb(r, 1, 0).expect(at(9.2), 'up to the kiln terrace');
  r.walkTo(171.6, 0).expectExit();
}

export function solve(r) {
  cellar(r, false);
  stair(r, false);
  racks(r);
  hall(r);
  yard(r, false);
}

export function solveAll(r) {
  cellar(r, true);
  stair(r, true);
  racks(r);
  hall(r);
  yard(r, true);
}
