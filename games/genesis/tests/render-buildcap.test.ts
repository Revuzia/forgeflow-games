// GENESIS — terrain patch builds have a time cap per frame (macfix/smooth.md F5). A camera sweep used to build up to the
// preset's patch count (16 on High) in ONE frame — tens of ms of main thread, a visible hitch on a laptop. Now, once a
// few patches are in, no more start after ChunkSelectContext.buildMs; a camera cut (buildMs unset) keeps the count alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial } from 'three';
import { ChunkLOD, Patch } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

interface Internal {
  curFrame: number;
  builtThisFrame: number;
  buildBudgetNow: number;
  buildMsNow: number;
  buildT0: number;
  ensureGeometry(p: Patch, budget: boolean): boolean;
}

function makeLod(): ChunkLOD {
  const grid = getGrid(16);
  const n = grid.count;
  const mat = new MeshBasicMaterial();
  return new ChunkLOD(grid, new Noise3(3), 3000, new Group(), { terrain: () => mat, water: () => mat }, {
    surface: new Float32Array(n), grad: null, waterLevel: new Float32Array(n).fill(-10), waterDepth: new Float32Array(n), geomVersion: 0,
  });
}

function patches(lod: ChunkLOD, count: number): Patch[] {
  const n = lod.grid.n, step = n / 2 ** 6;
  return Array.from({ length: count }, (_, k) => { const s = (k % 8) * step, t = Math.floor(k / 8) * step; return new Patch(k % 20, 6, [s, t], [s + step, t], [s, t + step]); });
}

function buildFrame(lod: ChunkLOD, list: Patch[], budget: number, ms: number, startedMsAgo: number): number {
  const L = lod as unknown as Internal;
  L.builtThisFrame = 0; L.buildBudgetNow = budget; L.buildMsNow = ms; L.buildT0 = performance.now() - startedMsAgo;
  let n = 0;
  for (const p of list) if (L.ensureGeometry(p, true)) n++;
  return n;
}

test('over the time cap a frame still builds its minimum, then stops', () => {
  const lod = makeLod();
  // the frame's build time is already spent: only the minimum goes in
  assert.equal(buildFrame(lod, patches(lod, 16), 16, 6, 100), 4);
});

test('under the time cap, or with no cap (a camera cut), the count budget alone decides', () => {
  const lod = makeLod();
  assert.equal(buildFrame(lod, patches(lod, 16), 16, 1e9, 0), 16);
  const lod2 = makeLod();
  assert.equal(buildFrame(lod2, patches(lod2, 24), 16, 0, 100), 16);
});
