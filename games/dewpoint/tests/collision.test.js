import { test, assert, near, between } from './lib/harness.js';
import { run } from './lib/mini.js';
import { DT, FORMS, TERMINAL, FORM_NAMES } from '../src/sim/constants.js';

test('rests on the floor without jitter or drift', () => {
  const r = run();
  for (let i = 0; i < 600; i++) {
    r.tick();
    assert(r.p.grounded, `ungrounded at tick ${i}`);
    assert(Math.abs(r.p.y) < 1e-9, `y drifted to ${r.p.y}`);
  }
  near(r.p.x, 0, 1e-12); near(r.p.z, 0, 1e-12);
});

for (const form of FORM_NAMES) {
  test(`no tunnelling: ${form} at terminal velocity lands on a 0.1 m thick slab`, () => {
    // slab top at y=20, 0.1 thick, nothing else underneath but the floor 20 m below
    const r = run([{ type: 'block', box: [-2, 19.9, -2, 2, 20, 2] }]);
    r.sim.teleport(0, 60, 0);
    r.sim.forceForm(form);
    if (form === 'steam') {
      // steam does not fall; drive it down with a strong fan instead
      r.sim.level.fans.push({ type: 'fan', box: [-3, 0, -3, 3, 80, 3], dir: [0, -1, 0], strength: 24, active: true, on: null });
    } else r.p.vy = -TERMINAL;
    let minY = Infinity;
    for (let i = 0; i < 480; i++) { r.tick(); minY = Math.min(minY, r.p.y); if (form === 'steam') r.p.gauge = 4; }
    assert(minY >= 20 - 1e-6, `${form} got below the slab top: min y ${minY}`);
    near(r.p.y, 20, 1e-3);
  });

  test(`no tunnelling: ${form} cannot be driven through a 0.1 m wall`, () => {
    const r = run([{ type: 'block', box: [3, 0, -4, 3.1, 4, 4] }]);
    r.sim.forceForm(form);
    for (let i = 0; i < 360; i++) {
      r.p.vx = 15;                       // re-apply every tick: faster than any form can go by itself
      r.tick(1, 0);
      if (form === 'steam') { r.p.gauge = 4; if (r.p.y > 2) r.sim.teleport(r.p.x, 1, r.p.z); }
      assert(r.p.x <= 3 - FORMS[form].r + 1e-6, `${form} passed the wall plane: x=${r.p.x}`);
    }
  });

  test(`no tunnelling: ${form} at an absurd 80 m/s (0.67 m per tick) still stops at a 0.1 m wall`, () => {
    // far beyond anything gameplay produces: this is what the collision substeps are for
    const r = run([{ type: 'block', box: [3, 0, -4, 3.1, 4, 4] }]);
    r.sim.forceForm(form);
    for (let i = 0; i < 120; i++) {
      r.p.vx = 80;
      r.tick(1, 0);
      if (form === 'steam') { r.p.gauge = 4; if (r.p.y > 2) r.sim.teleport(r.p.x, 1, r.p.z); }
      assert(r.p.x <= 3 - FORMS[form].r + 1e-6, `${form} tunnelled: x=${r.p.x}`);
      if (r.p.x < -5) r.sim.teleport(0, r.p.y, 0);
    }
  });
}

test('floor seams: running across 80 flush tiles never changes speed or height', () => {
  const tiles = [];
  for (let i = 0; i < 80; i++) tiles.push({ type: 'block', box: [-10 + i * 0.5, -1, -3, -10 + (i + 1) * 0.5, 0, 3] });
  const r = run(tiles, { noFloor: true });
  r.sim.teleport(-9, 0, 0); r.wait(0.1);
  r.move(1, 0, 0.5);
  for (let i = 0; i < 600; i++) {
    r.tick(1, 0);
    assert(r.p.grounded, `left the ground on a seam at x=${r.p.x}`);
    near(r.p.y, 0, 1e-9, 'height on seam');
    near(r.p.vx, FORMS.liquid.speed, 1e-9, `speed on seam at x=${r.p.x}`);
    near(r.p.z, 0, 1e-9, 'sideways shove on seam');
  }
});

test('floor seams: ice and film cross them too', () => {
  for (const form of ['ice', 'film']) {
    const tiles = [];
    for (let i = 0; i < 80; i++) tiles.push({ type: 'block', box: [-10 + i * 0.5, -1, -3, -10 + (i + 1) * 0.5, 0, 3] });
    const r = run(tiles, { noFloor: true });
    r.form(form);
    r.move(1, 0, 3);
    const x0 = r.p.x;
    for (let i = 0; i < 240; i++) { r.tick(1, 0); assert(r.p.grounded && Math.abs(r.p.y) < 1e-9, `${form} snagged at x=${r.p.x}`); }
    near(r.p.x - x0, FORMS[form].speed * 2, 0.02, `${form} distance over seams`);
  }
});

test('wall seams: sliding diagonally along a wall built from many boxes does not snag', () => {
  const wall = [];
  for (let i = 0; i < 40; i++) wall.push({ type: 'block', box: [-5 + i * 0.5, 0, 1, -5 + (i + 1) * 0.5, 3, 2] });
  const r = run(wall);
  r.move(0, 1, 0.5);                                  // press into the wall
  near(r.p.z, 1 - FORMS.liquid.r, 1e-6);
  const x0 = r.p.x;
  const k = Math.SQRT1_2;
  r.move(k, k, 0.3);                                  // get up to speed
  const x1 = r.p.x;
  r.move(k, k, 2);
  near(r.p.z, 1 - FORMS.liquid.r, 1e-6, 'pushed off the wall');
  // along-wall speed is the along-wall component of the stick: 5.2 * cos45
  near(r.p.x - x1, FORMS.liquid.speed * k * 2, 0.02, 'slide distance along seamed wall');
  assert(x1 > x0);
  // and back the other way: the box ahead is now the one listed FIRST, so resolving contacts in
  // list order instead of deepest-first would catch its corner on every seam
  r.move(-k, k, 1.0);   // long enough to finish turning round while pressed into the wall
  const x2 = r.p.x;
  for (let i = 0; i < 240; i++) {
    r.tick(-k, k);
    near(r.p.z, 1 - FORMS.liquid.r, 1e-6, 'pushed off the wall going back');
    near(r.p.vx, -FORMS.liquid.speed * k, 1e-3, `snagged on a wall seam at x=${r.p.x}`);
  }
  near(x2 - r.p.x, FORMS.liquid.speed * k * 2, 0.02, 'slide distance back along the seamed wall');
});

test('outside corner: a diagonal push slides around a box corner instead of sticking', () => {
  const r = run([{ type: 'block', box: [1, 0, -0.3, 2, 2, 5] }]);
  // walk in +x; the box corner at (1,-0.3) clips the lower half of Mote's footprint
  r.sim.teleport(0, 0, -0.45); r.wait(0.1);
  r.move(1, 0, 1.5);
  assert(r.p.x > 2.5, `stuck on the corner at x=${r.p.x}, z=${r.p.z}`);
  assert(r.p.z < -0.3 - FORMS.liquid.r + 0.02, 'should have been deflected around the corner');
});

test('step-up: each form climbs ledges up to its step height and no higher', () => {
  const cases = [['liquid', 0.3, 0.5, 0.9], ['ice', 0.12, 0.3, 1.1], ['film', 0.1, 0.2, 2]];
  for (const [form, ok, tooHigh, secs] of cases) {
    let r = run([{ type: 'block', box: [2, 0, -3, 9, ok, 3] }]);
    r.form(form);
    r.move(1, 0, secs);
    near(r.p.y, ok, 1e-6, `${form} should step up ${ok}`);
    assert(r.p.x > 2.2, `${form} did not advance onto the ${ok} ledge`);
    r = run([{ type: 'block', box: [2, 0, -3, 9, tooHigh, 3] }]);
    r.form(form);
    r.move(1, 0, secs);
    near(r.p.y, 0, 1e-6, `${form} must not step up ${tooHigh}`);
    assert(r.p.x <= 2 - FORMS[form].r + 1e-6, `${form} passed a ${tooHigh} ledge`);
  }
});

test('step-up is refused when there is no headroom above the ledge', () => {
  // 0.3 ledge with a ceiling 0.5 above it: liquid (0.7 tall) cannot fit on top
  const r = run([
    { type: 'block', box: [2, 0, -3, 6, 0.3, 3] },
    { type: 'block', box: [2, 0.8, -3, 6, 2, 3] },
  ]);
  r.move(1, 0, 1.5);
  near(r.p.y, 0, 1e-6);
  assert(r.p.x <= 2 - FORMS.liquid.r + 1e-6, `squeezed into a gap it does not fit: x=${r.p.x}`);
});

test('ramp: liquid walks up, stays glued to the surface, and arrives on the platform at full speed', () => {
  const r = run([
    { type: 'ramp', box: [2, 0, -2, 6, 2, 2], up: '+x' },
    { type: 'block', box: [6, 0, -2, 12, 2, 2] },
  ]);
  r.move(1, 0, 0.4);
  let maxStepY = 0, prevY = r.p.y;
  for (let i = 0; i < 240; i++) {
    r.tick(1, 0);
    assert(r.p.grounded, `left the ramp at x=${r.p.x}`);
    maxStepY = Math.max(maxStepY, Math.abs(r.p.y - prevY)); prevY = r.p.y;
    near(r.p.vx, FORMS.liquid.speed, 1e-6, `slowed on the ramp at x=${r.p.x}`);
  }
  near(r.p.y, 2, 1e-6, 'on the top platform');
  assert(maxStepY <= 0.5 * FORMS.liquid.speed * DT + 1e-6, `height popped by ${maxStepY} in one tick`);
});

test('ramp: walking down stays grounded every tick (no stair-stepping)', () => {
  const r = run([
    { type: 'ramp', box: [2, 0, -2, 6, 2, 2], up: '+x' },
    { type: 'block', box: [6, 0, -2, 12, 2, 2] },
  ]);
  r.sim.teleport(9, 2, 0); r.wait(0.1);
  for (let i = 0; i < 300; i++) {
    r.tick(-1, 0);
    assert(r.p.grounded, `airborne going down the ramp at x=${r.p.x}, y=${r.p.y}`);
  }
  near(r.p.y, 0, 1e-6);
});

test('ramps work in all four directions', () => {
  for (const [up, box, mv, axis] of [
    ['+x', [2, 0, -2, 6, 2, 2], [1, 0], 'x'], ['-x', [-6, 0, -2, -2, 2, 2], [-1, 0], 'x'],
    ['+z', [-2, 0, 2, 2, 2, 6], [0, 1], 'z'], ['-z', [-2, 0, -6, 2, 2, -2], [0, -1], 'z'],
  ]) {
    const r = run([{ type: 'ramp', box, up }]);
    r.move(mv[0], mv[1], 0.92);     // ~4.6 m: most of the way up
    between(r.p.y, 1.1, 1.95, `ramp ${up}`);
    assert(r.p.grounded, `ramp ${up}: not grounded`);
  }
});

test('ramp side faces are walls where the surface is high and steps where it is low', () => {
  const r = run([{ type: 'ramp', box: [2, 0, 1, 10, 4, 5], up: '+x' }]);
  r.sim.teleport(8, 0, 0); r.wait(0.1);      // beside the high part (surface 3 m up)
  r.move(0, 1, 1);
  assert(r.p.z <= 1 - FORMS.liquid.r + 1e-6, 'walked through the side of the ramp');
  near(r.p.y, 0, 1e-6);
});

test('ceiling: jumping under a low ceiling stops at it and falls back', () => {
  const r = run([{ type: 'block', box: [-2, 1.2, -2, 2, 2, 2] }]);
  let maxY = 0;
  r.tick(0, 0, false);
  for (let i = 0; i < 120; i++) { r.tick(0, 0, true); maxY = Math.max(maxY, r.p.y); }
  near(maxY, 1.2 - FORMS.liquid.h, 1e-6, 'head stops at the ceiling');
  near(r.p.y, 0, 1e-6, 'back on the floor');
});

test('moving platform carries its rider horizontally and vertically', () => {
  const r = run([
    { type: 'mover', id: 'h', box: [-1, 0, -1, 1, 0.4, 1], to: [6, 0, 0], speed: 3, pause: 0.5 },
    { type: 'mover', id: 'v', box: [-1, 0, 4, 1, 0.4, 6], to: [0, 5, 0], speed: 2, pause: 0.5 },
  ]);
  near(r.p.y, 0.4, 1e-6, 'standing on the horizontal mover');
  const h = r.sim.level.movers[0];
  const off = r.p.x - h.solid.x0;
  let travelled = 0;
  for (let i = 0; i < 480; i++) {
    r.tick();
    assert(r.p.grounded, 'fell off the mover');
    near(r.p.x - h.solid.x0, off, 1e-9, 'x locked to mover');
    travelled += Math.abs(h.solid.dx);
  }
  assert(travelled > 8, `mover should have moved (travelled ${travelled})`);
  const v = r.sim.level.movers[1];
  r.sim.teleport(0, v.solid.y1 + 0.05, 5);
  r.wait(0.2);
  let sawUp = false, sawDown = false;
  for (let i = 0; i < 1200; i++) {
    r.tick();
    assert(r.p.grounded, `left the elevator at y=${r.p.y} (mover top ${v.solid.y1})`);
    near(r.p.y, v.solid.y1, 1e-6, 'feet on elevator');
    if (v.solid.dy > 0) sawUp = true; if (v.solid.dy < 0) sawDown = true;
  }
  assert(sawUp && sawDown, 'elevator should have travelled both ways');
});

test('jumping off a moving platform keeps its momentum', () => {
  const r = run([{ type: 'mover', box: [-1, 0, -1, 1, 0.4, 1], to: [20, 0, 0], speed: 4, pause: 0 }]);
  r.wait(0.3);
  r.tick(0, 0, false); r.tick(0, 0, true);
  near(r.p.vx, 4, 0.05, 'inherited platform velocity');
});

test('a mover pushing sideways shoves Mote instead of passing through', () => {
  const r = run([{ type: 'mover', box: [-4, 0, -1, -2, 2, 1], to: [8, 0, 0], speed: 2, pause: 0 }]);
  r.wait(3);
  const m = r.sim.level.movers[0];
  assert(r.p.x >= m.solid.x1 + FORMS.liquid.r - 0.03, `mover overlapped Mote: mover x1=${m.solid.x1}, Mote x=${r.p.x}`);
  assert(r.sim.deaths === 0);
});

test('crushed between a mover and a wall respawns instead of tunnelling', () => {
  const r = run([
    { type: 'mover', box: [-6, 0, -1, -4, 2, 1], to: [5.6, 0, 0], speed: 2, pause: 5 },
    { type: 'block', box: [0.6, 0, -1, 1, 2, 1] },
  ]);
  // gap left when the mover arrives: 1.6 - 0 ... wall at 0.6, mover front ends at 1.6 -> overlaps wall? no: ends at x1 = -4+5.6 = 1.6
  r.allowDeath = true;
  for (let i = 0; i < 480 && r.sim.deaths === 0; i++) {
    r.tick();
    assert(r.p.x < 0.6 || r.sim.deaths > 0, `Mote was pushed through the wall to x=${r.p.x}`);
  }
  assert(r.sim.deaths === 1, 'expected a crush respawn');
  assert(r.events.some((e) => e.type === 'respawn' && e.cause === 'crush'), 'respawn cause should be crush');
});
