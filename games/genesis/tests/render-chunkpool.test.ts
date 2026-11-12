// GENESIS — the terrain LOD patch pools stay bounded (fix-r2 item 4). Each LOD level's BatchedMesh slot pool doubled
// when it ran out and never shrank, so a camera tour through the LOD depths left every level's pool at its high-water
// mark: performance.memory grew 454 -> 1,478 MB over a 30-minute 100x session. Now an evicted level's pool is rebuilt
// smaller (or dropped when empty), keeping the total slot capacity within a small multiple of the live patch count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial } from 'three';
import { ChunkLOD, Patch } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

interface Internal {
  curFrame: number;
  ensureGeometry(p: Patch, budget: boolean): boolean;
  evict(frame: number): void;
  tBatch: ({ isShown(s: number): boolean; extract(s: number): { getAttribute(n: string): { array: Float32Array } }; meshOf(s: number): unknown } | null)[];
}

function makeLod(): ChunkLOD {
  const grid = getGrid(16);
  const n = grid.count;
  const mat = new MeshBasicMaterial();
  const waterLevel = new Float32Array(n).fill(-10);
  // a third of the cells wet, so water pools are exercised too
  const waterDepth = new Float32Array(n);
  for (let i = 0; i < n; i += 3) { waterLevel[i] = 50; waterDepth[i] = 50; }
  return new ChunkLOD(grid, new Noise3(3), 3000, new Group(), { terrain: () => mat, water: () => mat }, {
    surface: new Float32Array(n), grad: null, waterLevel, waterDepth, geomVersion: 0,
  });
}

test('a camera tour through the LOD depths leaves bounded patch pools (shrink after eviction)', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal;
  lod.maxCached = 120;
  const n = lod.grid.n;
  let frame = 0;
  const peak = { slots: 0 };
  // dive: at each level build 260 patches (more than the budget), then move on so they age out and get evicted
  for (let level = 2; level <= 9; level++) {
    L.curFrame = frame;
    for (let k = 0; k < 260; k++) {
      const s = (k % 16) / 16 * n * 0.5, t = Math.floor(k / 16) / 17 * n * 0.5;
      const step = n / 2 ** level;
      const p = new Patch(k % 20, level, [s, t], [s + step, t], [s, t + step]);
      assert.ok(L.ensureGeometry(p, false));
    }
    frame += 200;
    L.evict(frame);
    const c = lod.poolCapacity();
    peak.slots = Math.max(peak.slots, c.slots);
    const live = (lod as unknown as { live: Set<Patch> }).live.size;
    assert.ok(live <= lod.maxCached, `live ${live} within the cache budget at level ${level}`);
    // total capacity within ~3x the live count plus the small per-level minimum pools (32 terrain / 8 water), plus the
    // page pool's idle reserve (6 pages; PERF s15: with the water sheets on the terrain pages there is no water pool
    // whose allowance used to cover it)
    assert.ok(c.slots <= 2 * c.live + 40 * c.pools + 6 * 16, `level ${level}: ${c.slots} slots for ${c.live} live patches in ${c.pools} pools`);
  }
  // (unbounded: 8 levels x (512 terrain + water) slots would remain)
  assert.ok(peak.slots < 1200, `peak pool capacity ${peak.slots}`);
});

test('shrinking a pool keeps the surviving patches, their geometry and their visibility', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal;
  lod.maxCached = 40;
  const n = lod.grid.n;
  const level = 4, step = n / 16;
  const mk = (k: number): Patch => new Patch(k % 20, level, [k % 8, 0], [(k % 8) + step, 0], [k % 8, step]);
  L.curFrame = 0;
  const old: Patch[] = [];
  for (let k = 0; k < 200; k++) { const p = mk(k); L.ensureGeometry(p, false); old.push(p); }
  // the survivors: used recently, half of them shown
  const keep = old.slice(0, 30);
  const before = keep.map((p) => ({ slot: p.tSlot, cells: L.tBatch[level]!.extract(p.tSlot).getAttribute('aCells').array.slice() }));
  keep.forEach((p, i) => { p.lastUsed = 1000; if (i % 2 === 0) (L.tBatch[level] as unknown as { show(s: number, on: boolean): void }).show(p.tSlot, true); });
  // (in-use capacity: the page pool's idle reserve is counted apart)
  const idleSlots = () => (lod as unknown as { pagePool: { count: number } }).pagePool.count * 16;
  const capBefore = lod.poolCapacity().slots - idleSlots();
  L.evict(1000);
  // (PERF F23: patches are moved to give pages back only once the slack has lasted ~600 frames: not while streaming)
  L.curFrame = 1700;
  keep.forEach((p) => { p.lastUsed = 1700; });
  L.evict(1700);
  const c = lod.poolCapacity();
  assert.ok(c.slots - idleSlots() < capBefore / 2, `pool shrank: ${capBefore} -> ${c.slots - idleSlots()} (+ ${idleSlots()} idle)`);
  const tb = L.tBatch[level]!;
  keep.forEach((p, i) => {
    assert.ok(p.built && p.tSlot >= 0, 'survivor still built');
    assert.equal(p.mesh, tb.meshOf(p.tSlot), 'survivor points at the page holding it');
    assert.equal(tb.isShown(p.tSlot), i % 2 === 0, 'visibility carried over');
    assert.deepEqual(tb.extract(p.tSlot).getAttribute('aCells').array, before[i].cells, 'geometry carried over');
  });
  for (const p of old.slice(30)) assert.equal(p.built, false);
});

test('the cache budget holds at a few frames a minute (eviction does not wait 120 frames)', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal;
  lod.maxCached = 60;
  const n = lod.grid.n;
  // a slow renderer: every frame the camera has moved to a new place and needs 50 fresh patches
  for (let frame = 1; frame <= 8; frame++) {
    L.curFrame = frame;
    const used: Patch[] = [];
    for (let k = 0; k < 50; k++) {
      const p = new Patch(k % 20, 3 + (frame % 4), [k % 8, frame], [(k % 8) + 1, frame], [k % 8, frame + 1]);
      L.ensureGeometry(p, false);
      used.push(p);
    }
    L.evict(frame);
    const live = (lod as unknown as { live: Set<Patch> }).live.size;
    assert.ok(live <= lod.maxCached, `frame ${frame}: ${live} live patches over the ${lod.maxCached} budget`);
    for (const p of used) assert.ok(p.built, 'a patch in use this frame is never evicted');
  }
});

test('default budget: a long camera tour holds the terrain pools near the view, not at 1,400 patches a planet', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal & { selected: Patch[] };
  const n = lod.grid.n;
  let peak = 0;
  // ten views of ~300 patches each (a low-quality surface view draws ~300-450), each a different place and depth
  for (let frame = 1; frame <= 10; frame++) {
    L.curFrame = frame;
    const view: Patch[] = [];
    for (let k = 0; k < 300; k++) {
      const p = new Patch((k + frame) % 20, 3 + (frame % 6), [k % 16, frame], [(k % 16) + 1, frame], [k % 16, frame + 1]);
      L.ensureGeometry(p, false);
      view.push(p);
    }
    L.selected = view;
    L.evict(frame);
    peak = Math.max(peak, lod.poolCapacity().slots);
  }
  // (each slot ~140 kB CPU + its GPU mirror: 1,400 cached patches in doubling pools reached ~2,900 slots here)
  assert.ok(peak <= 1800, `peak pool capacity ${peak} slots`);
});

test('PERF F17: pools are pages of one fixed size (ANGLE-Metal recycles same-size buffers; nothing grows)', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal & { tBatch: ({ meshes(): { geometry: { attributes: Record<string, { array: { length: number } }>; index: { array: { length: number } } } }[] } | null)[]; wBatch: ({ meshes(): { geometry: { attributes: Record<string, { array: { length: number } }>; index: { array: { length: number } } } }[] } | null)[] };
  lod.maxCached = 200;
  const n = lod.grid.n;
  const sizes = new Set<string>();
  for (let frame = 1; frame <= 6; frame++) {
    L.curFrame = frame;
    for (let k = 0; k < 90; k++) {
      const level = 2 + ((k + frame) % 5), step = n / 2 ** level;
      const p = new Patch(k % 20, level, [k % 9, frame], [(k % 9) + step, frame], [k % 9, frame + step]);
      L.ensureGeometry(p, false);
    }
    L.evict(frame);
    for (const b of [...L.tBatch, ...L.wBatch]) for (const m of b?.meshes() ?? []) {
      const g = m.geometry;
      sizes.add(Object.entries(g.attributes).map(([k, a]) => `${k}:${a.array.length}`).sort().join(',') + `|i:${g.index.array.length}`);
    }
  }
  assert.equal(sizes.size, 1, `one page layout for every pool and level: ${[...sizes].join(' ; ')}`);
});

test('PERF F23: steady panning lands patches in kept pages: no new page (no new GL buffers) after warm-up', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal & { tBatch: ({ meshes(): object[] } | null)[]; wBatch: ({ meshes(): object[] } | null)[]; selected: Patch[] };
  lod.maxCached = 220;
  const n = lod.grid.n;
  const seen = new Set<object>();
  let fresh = 0;
  // the camera pans: every frame 30 patches of levels 5-6 enter the view at a new place, the oldest age out
  for (let frame = 1; frame <= 400; frame++) {
    L.curFrame = frame;
    const view: Patch[] = [];
    for (let k = 0; k < 30; k++) {
      const level = 5 + (k % 2), step = n / 2 ** level;
      const s = ((frame * 3 + k) % 61) / 61 * n * 0.5, t = (k % 7) / 7 * n * 0.5;
      const p = new Patch((frame + k) % 20, level, [s, t], [s + step, t], [s, t + step]);
      L.ensureGeometry(p, false);
      view.push(p);
    }
    L.selected = view;
    L.evict(frame);
    for (const b of [...L.tBatch, ...L.wBatch]) for (const m of b?.meshes() ?? []) if (!seen.has(m)) { seen.add(m); if (frame > 40) fresh++; }
  }
  assert.equal(fresh, 0, `pages made while panning after warm-up: ${fresh} (of ${seen.size})`);
});
