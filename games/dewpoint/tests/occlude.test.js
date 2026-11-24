// Occluder fading (src/render/occlude.js): which solids may fade when they hide Mote from the camera.

import { test, assert, eq } from './lib/harness.js';
import { levels } from '../src/levels/index.js';
import { Sim } from '../src/sim/sim.js';
import { isThinWall, segHitsBox, THIN_WALL_M } from '../src/render/occlude.js';

const box = (type, b, extra = {}) => ({ kind: 'box', owner: { type }, x0: b[0], y0: b[1], z0: b[2], x1: b[3], y1: b[4], z1: b[5], active: true, ...extra });

test('occlude: thin blocks, doors, platforms and slatted floors may fade; thick ones, grates, panes, crates and ramps may not', () => {
  assert(isThinWall(box('block', [0, 0, 0, 0.4, 3, 8])), 'a 0.4 m wall is thin');
  assert(isThinWall(box('block', [0, 0, 0, 20, 1, 8])), 'a 1 m floor slab is thin');
  assert(isThinWall(box('door', [0, 0, 0, 0.5, 3, 2.4])), 'a door is thin');
  assert(isThinWall(box('mover', [0, 0, 0, 3, 0.6, 3])), 'a platform is thin');
  assert(!isThinWall(box('block', [0, 0, 0, THIN_WALL_M + 0.3, THIN_WALL_M + 0.3, THIN_WALL_M + 0.3])), 'a solid cube is thick');
  assert(!isThinWall(box('block', [0, 0, 0, 4, 4, 4])), 'a big block is thick');
  assert(!isThinWall(box('block', [0, 0, 0, 0.2, 3, 3], { pass: 'steam' })), 'a grate is already see-through: it keeps its collision behaviour');
  assert(!isThinWall(box('block', [0, 0, 0, 0.2, 3, 3], { oneWay: true })), 'one-way leaves are not walls');
  assert(isThinWall(box('slot', [0, -0.4, 0, 18, 0, 8], { pass: 'film' })), 'a slatted floor fades (its bars would otherwise hide Mote)');
  for (const t of ['pane', 'crate', 'plate', 'prop']) assert(!isThinWall(box(t, [0, 0, 0, 0.4, 1, 1])), `${t} is not a fading wall`);
  assert(!isThinWall({ ...box('block', [0, 0, 0, 0.4, 3, 3]), kind: 'ramp' }), 'a ramp is never a fading wall');
});

test('occlude: segHitsBox finds the walls on a line of sight and ignores the rest', () => {
  const wall = box('block', [5, 0, -4, 5.4, 3, 4]);
  assert(segHitsBox(wall, 0, 1, 0, 10, 1, 0), 'straight through');
  assert(segHitsBox(wall, 0, 0.5, 0, 10, 2, 1), 'at an angle');
  assert(!segHitsBox(wall, 0, 1, 0, 4.9, 1, 0), 'stops short of the wall');
  assert(!segHitsBox(wall, 6, 1, 0, 12, 1, 0), 'starts beyond it');
  assert(!segHitsBox(wall, 0, 3.5, 0, 10, 3.5, 0), 'passes over the top');
  assert(!segHitsBox(wall, 0, 1, 4.5, 10, 1, 4.5), 'passes round the end');
  assert(segHitsBox(wall, 5.2, 1, 0, 9, 1, 0), 'a segment that starts inside the wall is blocked by it');
  assert(segHitsBox(wall, 5.2, 1, 0, 5.2, 1, 0.0001), 'degenerate segment inside');
});

test('occlude: every level has some thin walls, and none of them is a grate, ramp, crate, plate, pane or prop', () => {
  for (const data of levels) {
    const sim = new Sim(data);
    const thin = sim.solids.filter(isThinWall);
    assert(thin.length > 0, `${data.id}: no thin walls at all?`);
    for (const s of thin) assert(['block', 'door', 'mover', 'slot'].includes(s.owner.type) && !s.oneWay && s.kind === 'box', `${data.id}: ${s.owner.type} should not fade`);
  }
});

test('occlude: a tall wall 1.2 m thick between the default camera and the hero is cut away, so the camera need not stop in front of it', () => {
  // A fixture of its own (it used to read a wall out of l04, which pinned that wall in place for the level's designer):
  // a floor, a hero standing at the foot of a ramp beyond a tall wall, and the wall across the way at x 13.4 .. 14.6.
  const sim = new Sim({
    id: 'occ', name: 'Occlude', spawn: [15.2, 0, 0],
    pieces: [
      { type: 'block', box: [0, -1, -4, 30, 0, 4] },
      { type: 'block', box: [13.4, 0, -4, 14.6, 6, 4] },
      { type: 'exit', pos: [28, 0, 0] },
    ],
  });
  const wall = sim.solids.find((s) => s.owner.type === 'block' && Math.abs(s.x0 - 13.4) < 1e-6 && Math.abs(s.x1 - 14.6) < 1e-6);
  assert(wall && isThinWall(wall), 'the wall at x 13.4..14.6 must be a wall that is cut away');
  // the default camera: ~7.6 m behind the hero and ~3.7 m above its chest, looking along +x
  assert(segHitsBox(wall, 8.2, 4.3, 0, 15.2, 0.6, 0), 'the line from the camera to the hero crosses it');
  const floor = sim.solids.find((s) => s.owner.type === 'block' && s.y1 === 0);
  assert(floor && isThinWall(floor) && !segHitsBox(floor, 8.2, 4.3, 0, 15.2, 0.6, 0), 'the floor could be cut too, but nothing looks through it');
});
