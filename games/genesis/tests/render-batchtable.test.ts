// PERF s7 — terrain patch batches upload their BatchedMesh draw -> instance table ONCE, not at every pass whose
// visibility changed (each shadow cascade + the scene: dozens of mid-pass texture uploads a frame on the owner's M5).
// The multi-draw lists still follow every visibility change; the instance matrices are all the identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, PerspectiveCamera, Matrix4 } from 'three';
import { ChunkLOD, Patch } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

test('terrain batch: table uploaded once, draw lists follow visibility, matrices identity', () => {
  const grid = getGrid(16);
  const n = grid.count;
  const mat = new MeshBasicMaterial();
  const lod = new ChunkLOD(grid, new Noise3(3), 3000, new Group(), { terrain: () => mat, water: () => mat }, {
    surface: new Float32Array(n), grad: null, waterLevel: new Float32Array(n).fill(-10), waterDepth: new Float32Array(n), geomVersion: 0,
  });
  const L = lod as unknown as { curFrame: number; ensureGeometry(p: Patch, b: boolean): boolean; tBatch: ({ show(s: number, on: boolean): void; meshOf(s: number): any } | null)[] };
  const slots: number[] = [];
  for (let k = 0; k < 6; k++) { const p = new Patch(k, 3, [k, 0], [k + 1, 0], [k, 1]); assert.ok(L.ensureGeometry(p, false)); slots.push((p as unknown as { tSlot: number }).tSlot); }
  const b = L.tBatch.find((x) => x)!;
  const m = b.meshOf(slots[0]);
  for (const s of slots) assert.equal(b.meshOf(s), m, 'six patches share one page');
  const cam = new PerspectiveCamera();
  const geo = m.geometry;
  const draw = () => { m.onBeforeRender(null, null, cam, geo, mat, null); return { v: m._indirectTexture.version, n: m._multiDrawCount }; };
  for (const s of slots) b.show(s, true);
  const first = draw();
  assert.ok(first.v > 0, 'uploaded once');
  assert.equal(first.n, 6);
  b.show(slots[0], false); b.show(slots[1], false);
  const second = draw();
  assert.equal(second.n, 4, 'the draw list follows visibility');
  assert.equal(second.v, first.v, 'no table re-upload');
  b.show(slots[0], true);
  assert.equal(draw().n, 5);
  assert.equal(m._indirectTexture.version, first.v);
  // every instance matrix is the identity, so the table's content does not matter
  const I = new Matrix4(), M = new Matrix4();
  for (let i = 0; i < 6; i++) { m.getMatrixAt(i, M); assert.ok(M.equals(I)); }
});
