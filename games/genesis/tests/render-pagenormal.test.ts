// GENESIS — PERF s15 cut #3: a terrain / water patch page holds ONE copy of the positions ('normal' is the same
// attribute, so one CPU array and one GL buffer), and the vertex data survives landing, slot reuse and compaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, type BufferGeometry } from 'three';
import { ChunkLOD, Patch } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

type Batch = { meshes(): { geometry: BufferGeometry }[]; extract(s: number): BufferGeometry } | null;
interface Internal { curFrame: number; ensureGeometry(p: Patch, budget: boolean): boolean; evict(frame: number): void; tBatch: Batch[]; wBatch: Batch[] }

function makeLod(): ChunkLOD {
  const grid = getGrid(16);
  const n = grid.count;
  const mat = new MeshBasicMaterial();
  const waterLevel = new Float32Array(n).fill(-10);
  const waterDepth = new Float32Array(n);
  for (let i = 0; i < n; i += 3) { waterLevel[i] = 50; waterDepth[i] = 50; }
  return new ChunkLOD(grid, new Noise3(3), 3000, new Group(), { terrain: () => mat, water: () => mat }, {
    surface: new Float32Array(n), grad: null, waterLevel, waterDepth, geomVersion: 0,
  });
}

test('PERF s15 #3: every patch page binds its positions as the normal (one array, one buffer)', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal;
  lod.maxCached = 60;
  const n = lod.grid.n;
  const level = 4, step = n / 16;
  const mk = (k: number, f: number): Patch => new Patch(k % 20, level, [k % 8, f], [(k % 8) + step, f], [k % 8, f + step]);
  let pages = 0;
  const check = (): void => {
    for (const b of [...L.tBatch, ...L.wBatch]) for (const m of b?.meshes() ?? []) {
      pages++;
      assert.equal(m.geometry.getAttribute('normal'), m.geometry.getAttribute('position'), 'page normal is its position');
    }
  };
  const all: Patch[] = [];
  for (let f = 0; f < 6; f++) {
    L.curFrame = f * 400;
    for (let k = 0; k < 50; k++) { const p = mk(k, f); L.ensureGeometry(p, false); all.push(p); }
    check();
    // the extracted copy of a slot: the positions, as the normal too
    for (const p of all) if (p.built) {
      const g = L.tBatch[level]!.extract(p.tSlot);
      assert.equal(g.getAttribute('normal'), g.getAttribute('position'));
      const a = g.getAttribute('position').array as Float32Array;
      let len = 0;
      for (let i = 0; i < 3; i++) len += a[i] * a[i];
      assert.ok(Math.abs(Math.sqrt(len) - 1) < 1e-4, 'positions are unit directions (data intact)');
    }
    L.evict(f * 400 + 399);
  }
  assert.ok(pages > 0);
});

test('PERF s15 #9: a wet patch\'s water sheet draws its terrain page\'s own geometry (no copy), shown / hidden per slot', () => {
  const lod = makeLod();
  const L = lod as unknown as Internal & { showPatch(p: Patch, on: boolean, water: boolean): void; tBatch: ({ meshes(): { geometry: BufferGeometry; parent: unknown }[]; waterVisible: boolean } | null)[]; pagePool: { dispose(): void } };
  lod.maxCached = 60;
  const n = lod.grid.n;
  const level = 4, step = n / 16;
  L.curFrame = 0;
  const ps: Patch[] = [];
  for (let k = 0; k < 40; k++) { const p = new Patch(k % 20, level, [k % 8, 0], [(k % 8) + step, 0], [k % 8, step]); L.ensureGeometry(p, false); ps.push(p); }
  const wet = ps.filter((p) => p.hasWater);
  assert.ok(wet.length > 0, 'some patches are wet');
  for (const p of ps) { assert.equal(p.wSlot, -1, 'no water slot: no copy'); L.showPatch(p, true, p.hasWater); }
  assert.ok(L.wBatch.every((b) => !b), 'no water batch');
  const tb = L.tBatch[level] as unknown as { pages: ({ mesh: { geometry: BufferGeometry }; water: { geometry: BufferGeometry; visible: boolean; parent: unknown; layers: { mask: number } } | null; wVisibleN: number } | null)[]; waterVisible: boolean };
  assert.ok(tb.waterVisible);
  let sheets = 0;
  for (const pg of tb.pages) if (pg?.water) {
    sheets++;
    assert.equal(pg.water.geometry, pg.mesh.geometry, 'the sheet draws the page geometry');
    assert.equal(pg.water.layers.mask, 1 << 2, 'on the water layer');
    assert.ok(pg.water.parent, 'in the scene');
  }
  assert.ok(sheets > 0);
  const shown = tb.pages.reduce((s, pg) => s + (pg?.wVisibleN ?? 0), 0);
  assert.equal(shown, wet.length, 'one water slot shown per wet patch');
  for (const p of ps) L.showPatch(p, false, false);
  assert.equal(tb.waterVisible, false);
  // eviction and disposal: the page geometry outlives its sheet's dispose
  lod.dispose();
});
