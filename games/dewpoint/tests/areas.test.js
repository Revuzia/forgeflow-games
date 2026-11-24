// Named areas (src/render/areas.js): the optional `areas` field of a level, how the HUD decides
// when to announce one, and how the renderer cuts a level into the chunks it merges and culls.

import { test, assert, eq, near } from './lib/harness.js';
import { allLevels } from '../src/levels/index.js';
import { Sim } from '../src/sim/sim.js';
import { levelAreas, areaAt, chunkPlan, chunkOf, distToRect, AreaTracker, CHUNK_MAX_M, CHUNK_SLICE_M } from '../src/render/areas.js';

const L = { areas: [{ name: 'One', box: [0, -4, 40, 4] }, { name: ' Two ', box: [80, 4, 40, -4] }, { name: 'Three', box: [80, -4, 200, 4] }] };

test('areas: the field is read from raw data or a runtime level, cleaned up, and never throws', () => {
  const a = levelAreas(L);
  eq(a.map((x) => x.name), ['One', 'Two', 'Three'], 'names are trimmed');
  eq([a[1].x0, a[1].z0, a[1].x1, a[1].z1], [40, -4, 80, 4], 'corners may be given in either order');
  eq(a.map((x) => x.index), [0, 1, 2]);
  eq(levelAreas({ source: L }).length, 3, 'a runtime level keeps its data in .source');
  for (const bad of [null, undefined, 7, 'x', {}, { areas: 'no' }, { areas: [null, 3, {}, { name: '', box: [0, 0, 1, 1] }, { name: 'x', box: [0, 0, 1] }, { name: 'x', box: [0, 0, NaN, 1] }, { name: 5, box: [0, 0, 1, 1] }] }]) {
    eq(levelAreas(bad), [], `areas of ${JSON.stringify(bad)}`);
  }
  eq(levelAreas({ areas: [{ name: 'ok', box: [0, 0, 1, 1] }, { name: 'bad' }] }).length, 1, 'a bad entry is dropped, the rest kept');
});

test('areas: areaAt finds the containing area; the first listed wins on a shared edge', () => {
  const a = levelAreas(L);
  eq(areaAt(a, 10, 0), 0); eq(areaAt(a, 60, -3), 1); eq(areaAt(a, 199, 4), 2);
  eq(areaAt(a, 40, 0), 0, 'a shared edge belongs to the earlier area');
  eq(areaAt(a, 10, 9), -1); eq(areaAt(a, -1, 0), -1); eq(areaAt([], 0, 0), -1);
  near(distToRect(a[0], 43, 8), 5, 1e-9); eq(distToRect(a[0], 5, 0), 0);
});

test('areas: the tracker announces each area once, in whatever order it is reached, and keeps the last one current in a gap', () => {
  const t = new AreaTracker(L);
  eq(t.step(1, 0), 0, 'the area the hero starts in is announced');
  eq(t.step(2, 0), -1, 'not again while it stays');
  eq(t.step(50, 0), 1); eq(t.current, 1);
  eq(t.step(50, 30), -1, 'outside every box: nothing happens');
  eq(t.current, 1, '...and the last area stays current');
  eq(t.step(10, 0), -1, 'going back is not news'); eq(t.current, 0);
  eq(t.step(150, 0), 2);
  eq([...t.seen].sort(), [0, 1, 2]);
  const none = new AreaTracker({ id: 'x' });
  eq(none.areas.length, 0); eq(none.step(0, 0), -1);
});

test('areas: render chunks are the areas (long ones split), or slices of a level that names none', () => {
  const a = levelAreas(L), plan = chunkPlan({ x0: 0, z0: -4, x1: 200, z1: 4 }, a);
  assert(plan.length >= 4, 'the 120 m area is split');
  for (const c of plan) assert(Math.max(c.x1 - c.x0, c.z1 - c.z0) <= CHUNK_MAX_M + 1e-6, `chunk ${JSON.stringify(c)} is longer than ${CHUNK_MAX_M} m`);
  eq(plan.filter((c) => c.area === 2).length, 3);
  const bare = chunkPlan({ x0: -4, z0: -4, x1: 96, z1: 4 }, []);
  eq(bare.length, Math.ceil(100 / CHUNK_SLICE_M)); assert(bare.every((c) => c.area === -1));
  near(bare[0].x0, -4, 1e-9); near(bare[bare.length - 1].x1, 96, 1e-9);
  const tall = chunkPlan({ x0: -4, z0: 0, x1: 4, z1: 100 }, []);
  assert(tall.length > 1 && tall[0].z1 < 100, 'a level that runs along z is sliced along z');
  eq(chunkPlan(null, []).length, 1, 'no bounds at all: one chunk holds everything');
  eq(chunkOf(plan, 10, 0), 0); eq(chunkOf(plan, 500, 0), plan.length - 1, 'a point outside every chunk goes to the nearest');
});

test('areas: every registered level that names areas names them well, and its start and exit are inside one', () => {
  for (const data of allLevels) {
    if (data.areas === undefined) continue;
    const a = levelAreas(data);
    assert(Array.isArray(data.areas) && a.length === data.areas.length, `${data.id}: ${data.areas.length - a.length} of its areas are malformed (need { name, box: [x0, z0, x1, z1] })`);
    eq(new Set(a.map((x) => x.name)).size, a.length, `${data.id}: area names repeat`);
    for (const x of a) {
      assert(x.name.length <= 26, `${data.id}: area name "${x.name}" is over 26 characters (the banner on a 360 px phone)`);
      assert(x.x1 - x.x0 > 1 && x.z1 - x.z0 > 1, `${data.id}: area "${x.name}" has no size`);
    }
    const sim = new Sim(data);
    assert(areaAt(a, sim.level.spawn[0], sim.level.spawn[2]) >= 0, `${data.id}: the spawn is in no area`);
    for (const e of sim.level.exits) assert(areaAt(a, e.pos[0], e.pos[2]) >= 0, `${data.id}: the exit is in no area`);
  }
});
