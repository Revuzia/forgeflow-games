// PERF (session 5) — terrain patches built off the main thread (src/render/planet/patchbuild.ts + patchbuild.worker.ts).
// (1) The builder's bytes equal the code before it moved out of chunks.ts (a fixed hash of the old output).
// (2) A ChunkLOD fed by a worker port (in-process here, every message through structuredClone with its transfer list,
//     replies a frame or more later, as a real worker answers) converges to the same selection, and every selected
//     patch's batch contents are byte-identical to the patches the main thread builds — while the main thread itself
//     builds only the first two levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frustum, Group, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { ChunkLOD, Patch, PATCH_RES, type PatchPort } from '../src/render/planet/chunks.ts';
import { PatchBuilder, handlePatchMessage, type PatchReply, type PatchRequest, type PatchState } from '../src/render/planet/patchbuild.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

const PATCHES: [number, number, number][] = [[0, 0, 0], [3, 1, 0], [7, 2, 1], [11, 4, 3], [19, 6, 5], [5, 9, 17], [13, 12, 200], [2, 14, 1000]];

test('the patch builder writes the bytes of the pre-worker chunks.ts build (hash)', () => {
  const grid = getGrid(48);
  const b = new PatchBuilder(grid, new Noise3(1234), 3000);
  let h = 0x811c9dc5 >>> 0;
  const mix = (u: Uint8Array) => { for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } };
  const names = ['aCells', 'aGrad', 'aGradD', 'aGradDM', 'aGradM', 'aMisc', 'aN1', 'aN1d', 'aN1m', 'aN2', 'aN2d', 'aN2m', 'normal', 'position'];
  const order = ['position', 'aCells', 'aMisc', 'aGrad', 'aN1', 'aN1m', 'aN1d', 'aN2', 'aN2m', 'aN2d', 'aGradM', 'aGradD', 'aGradDM'];
  for (const [f, lv, k] of PATCHES) {
    const st = grid.n / 2 ** lv, kk = k % 2 ** lv;
    const r = b.build(f, lv, [kk * st, 0], [kk * st + st, 0], [kk * st, st]);
    // (the old hash ran over the geometry's attributes sorted by name; 'normal' is the 'position' array)
    for (const nm of names) {
      const a = r.attrs[order.indexOf(nm === 'normal' ? 'position' : nm)];
      mix(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
    mix(new Uint8Array(r.vcells.buffer));
  }
  // _harness/arc-work/perf-golden.ts on the chunks.ts of 2026-11-11 03:00Z (before the move) printed 8181fda4
  assert.equal(h.toString(16), '8181fda4');
});

/** an in-process worker: requests and replies cloned (buffers transferred), replies delivered on pump() */
function fakePort(): PatchPort & { pump(max?: number): number; sent: number } {
  const state: PatchState = { builders: new Map(), free: [], makeGrid: getGrid, makeNoise: (s) => new Noise3(s) };
  const queue: PatchRequest[] = [];
  const subs = new Map<number, (r: PatchReply) => void>();
  const port = {
    sent: 0,
    send(m: PatchRequest, transfer?: Transferable[]) { port.sent++; queue.push(structuredClone(m, { transfer: (transfer ?? []) as Transferable[] })); },
    listen(id: number, reply: (r: PatchReply) => void) { subs.set(id, reply); },
    unlisten(id: number) { subs.delete(id); },
    pump(max = 12) {
      let n = 0;
      while (queue.length > 0 && n < max) {
        const m = queue.shift()!;
        const r = handlePatchMessage(state, m);
        if (r) { n++; subs.get(r.reply.id)?.(structuredClone(r.reply, { transfer: r.transfer })); }
      }
      return n;
    },
  };
  return port;
}

test('a ChunkLOD with a patch worker converges to the same patches, byte for byte', () => {
  const grid = getGrid(48);
  const n = grid.count, R = 3000;
  const surface = new Float32Array(n);
  for (let c = 0; c < n; c++) surface[c] = 40 * Math.sin(grid.pos[c * 3] * 9) * Math.cos(grid.pos[c * 3 + 2] * 7);
  const waterLevel = new Float32Array(n).fill(-1000), waterDepth = new Float32Array(n);
  for (let c = 0; c < n; c += 5) { waterLevel[c] = surface[c] + 2; waterDepth[c] = 2; }
  const mk = (port: PatchPort | null) => new ChunkLOD(grid, new Noise3(3), R, new Group(), { terrain: () => new MeshBasicMaterial(), water: () => new MeshBasicMaterial() },
    { surface, grad: null, waterLevel, waterDepth, geomVersion: 0 }, { seed: 3, port });
  const up = new Vector3(0.3, 0.8, 0.52).normalize();
  const camBody = up.clone().multiplyScalar(R + 60 + 230);
  const cam = new PerspectiveCamera(50, 888 / 500, 0.5, 1e6);
  cam.up.copy(up);
  const east = new Vector3(0, 1, 0).cross(up).normalize();
  cam.lookAt(east.clone().multiplyScalar(Math.cos(0.44)).addScaledVector(up, -Math.sin(0.44)));
  cam.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const bodyToWorld = new Matrix4().makeTranslation(-camBody.x, -camBody.y, -camBody.z);
  const K = Math.max(3, 500 / (2 * Math.tan((50 * Math.PI) / 360) * 6 * PATCH_RES));
  const ctx = (f: number) => ({ camBody, frustum, bodyToWorld, K, frame: f, buildBudget: 16, buildMs: 6 }) as never;

  const sync = mk(null);
  for (let f = 0; f < 300; f++) sync.select(ctx(f));
  const port = fakePort();
  const async = mk(port);
  let mainBuilt = 0;
  for (let f = 0; f < 300; f++) {
    const before = async.stats.builtTotal - async.landedTotal;
    async.select(ctx(f));
    mainBuilt += async.stats.builtTotal - async.landedTotal - before;
    port.pump();
  }
  assert.ok(async.landedTotal > 100, `the worker built the view (${async.landedTotal})`);
  // the main thread built only levels 0-1 (20 + 80 patches at most, the always-drawn base)
  assert.ok(mainBuilt <= 100, `main-thread builds ${mainBuilt}`);
  const key = (p: Patch) => `${p.face}/${p.level}/${p.a}/${p.b}/${p.c}`;
  const sa = sync.selected.map(key).sort(), sb = async.selected.map(key).sort();
  assert.ok(sa.length > 100, `selection ${sa.length}`);
  assert.deepEqual(sb, sa, 'the same patches are drawn');
  type B = { extract(s: number): { attributes: Record<string, { array: Float32Array }> } };
  const batches = (l: ChunkLOD) => l as unknown as { tBatch: (B | null)[]; wBatch: (B | null)[] };
  const byKey = new Map(async.selected.map((p) => [key(p), p]));
  let wet = 0;
  for (const p of sync.selected) {
    const q = byKey.get(key(p))!;
    assert.equal(q.hasWater, p.hasWater);
    const A = batches(sync).tBatch[p.level]!.extract(p.tSlot), Bq = batches(async).tBatch[q.level]!.extract(q.tSlot);
    for (const nm of Object.keys(A.attributes)) assert.deepEqual(Bq.attributes[nm].array, A.attributes[nm].array, `${key(p)} ${nm}`);
    if (p.wSlot >= 0) {
      wet++;
      const W1 = batches(sync).wBatch[p.level]!.extract(p.wSlot), W2 = batches(async).wBatch[q.level]!.extract(q.wSlot);
      assert.deepEqual(W2.attributes.aCells.array, W1.attributes.aCells.array);
    }
  }
  assert.ok(wet > 0, 'water patches compared too');
  async.dispose();
});
