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
  tBatch: ({ isShown(s: number): boolean; mesh: { geometry: { getAttribute(n: string): { array: Float32Array } } } } | null)[];
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
    // total capacity within ~3x the live count plus the small per-level minimum pools (32 terrain / 8 water)
    assert.ok(c.slots <= 3 * c.live + 40 * c.pools, `level ${level}: ${c.slots} slots for ${c.live} live patches in ${c.pools} pools`);
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
  const before = keep.map((p) => {
    const a = L.tBatch[level]!.mesh.geometry.getAttribute('aCells').array;
    return { slot: p.tSlot, cells: a.slice(p.tSlot * 657 * 4, p.tSlot * 657 * 4 + 657 * 4) };
  });
  keep.forEach((p, i) => { p.lastUsed = 1000; if (i % 2 === 0) (L.tBatch[level] as unknown as { show(s: number, on: boolean): void }).show(p.tSlot, true); });
  const capBefore = lod.poolCapacity().slots;
  L.evict(1000);
  const c = lod.poolCapacity();
  assert.ok(c.slots < capBefore / 2, `pool shrank: ${capBefore} -> ${c.slots}`);
  const tb = L.tBatch[level]!;
  const cells = tb.mesh.geometry.getAttribute('aCells').array;
  keep.forEach((p, i) => {
    assert.ok(p.built && p.tSlot >= 0, 'survivor still built');
    assert.equal(p.mesh, tb.mesh, 'survivor points at the new pool');
    assert.equal(tb.isShown(p.tSlot), i % 2 === 0, 'visibility carried over');
    assert.deepEqual(cells.slice(p.tSlot * 657 * 4, p.tSlot * 657 * 4 + 657 * 4), before[i].cells, 'geometry carried over');
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
