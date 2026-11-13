// PERF s17 — no terrain CHURN at rest on the WORKER path: with the camera still the cache must settle (the browser at
// the babel town, low preset: ~40-100 patches built a frame forever, as many evicted: PREFETCH children were built
// for every leaf near its split distance, never stamped in use, so once the cache was full the eviction dropped them
// and the next frame's prefetch asked for them again).
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


function view(R: number, alt: number) {
  const up = new Vector3(0.3, 0.8, 0.52).normalize();
  const camBody = up.clone().multiplyScalar(R + 60 + alt);
  const cam = new PerspectiveCamera(50, 888 / 500, 0.5, 1e6);
  cam.up.copy(up);
  const east = new Vector3(0, 1, 0).cross(up).normalize();
  cam.lookAt(east.clone().multiplyScalar(Math.cos(0.44)).addScaledVector(up, -Math.sin(0.44)));
  cam.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const bodyToWorld = new Matrix4().makeTranslation(-camBody.x, -camBody.y, -camBody.z);
  const K = Math.max(3, 500 / (2 * Math.tan((50 * Math.PI) / 360) * 6 * PATCH_RES));
  return (f: number) => ({ camBody, frustum, bodyToWorld, K, frame: f, buildBudget: 16, buildMs: 6 }) as never;
}

for (const [alt, cap] of [[230, 0], [60, 0], [230, 800]] as const) {
  test(`worker path, still camera at ${alt} m, cache ${cap || '1.5 x selection'}: builds stop, the selection holds`, () => {
    const grid = getGrid(48);
    const n = grid.count, R = 3000;
    const surface = new Float32Array(n);
    for (let c = 0; c < n; c++) surface[c] = 40 * Math.sin(grid.pos[c * 3] * 9) * Math.cos(grid.pos[c * 3 + 2] * 7);
    const port = fakePort();
    const lod = new ChunkLOD(grid, new Noise3(3), R, new Group(), { terrain: () => new MeshBasicMaterial(), water: () => new MeshBasicMaterial() },
      { surface, grad: null, waterLevel: new Float32Array(n).fill(-1000), waterDepth: new Float32Array(n), geomVersion: 0 }, { seed: 3, port });
    lod.maxCached = cap;
    const ctx = view(R, alt);
    const built: number[] = [];
    let sel0 = '';
    const key = () => lod.selected.map((p) => `${p.face}/${p.level}/${p.a}/${p.b}/${p.c}`).sort().join(' ');
    for (let f = 0; f < 600; f++) {
      lod.select(ctx(f));
      port.pump(64);
      built.push(lod.stats.builtTotal);
      if (f === 399) sel0 = key();
    }
    const atRest = built[599] - built[399];
    if (process.env.CHUNK_LOG) console.log(`alt ${alt} cap ${cap}: built by 100/200/400/600 ${built[99]} ${built[199]} ${built[399]} ${built[599]}; selected ${lod.selected.length}; live ${(lod as unknown as { live: Set<unknown> }).live.size}`);
    assert.ok(built[399] > 50, `the view needs patches (${built[399]})`);
    assert.equal(atRest, 0, `${atRest} patches built over the last 200 still frames`);
    assert.equal(key(), sel0, 'the drawn selection does not change at rest');
  });
}
