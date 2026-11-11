// PERF (task 3) — no terrain streaming at rest: with the camera still, the patch selection converges and then builds
// nothing more, also while the fields keep arriving (a new water / heights version refreshes the bounds every few
// frames, as a running sim does) — a patch built every frame at rest was the 'still streaming after 40 frames' of
// PERF.md (263 buffers / 9 MB a frame on the busy town).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frustum, Group, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { ChunkLOD, PATCH_RES } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

test('a still camera stops building terrain patches, fields arriving or not', () => {
  const grid = getGrid(48);
  const n = grid.count, R = 3000;
  const surface = new Float32Array(n);
  for (let c = 0; c < n; c++) surface[c] = 40 * Math.sin(grid.pos[c * 3] * 9) * Math.cos(grid.pos[c * 3 + 2] * 7);
  const fields = { surface, grad: null, waterLevel: new Float32Array(n).fill(-1000), waterDepth: new Float32Array(n), geomVersion: 0 };
  const mat = new MeshBasicMaterial();
  const lod = new ChunkLOD(grid, new Noise3(3), R, new Group(), { terrain: () => mat, water: () => mat }, fields);
  // the camera 230 m over the ground, looking 25° down toward the horizon
  const up = new Vector3(0.3, 0.8, 0.52).normalize();
  const camBody = up.clone().multiplyScalar(R + 60 + 230);
  const cam = new PerspectiveCamera(50, 888 / 500, 0.5, 1e6);
  cam.position.set(0, 0, 0);
  cam.up.copy(up);
  const east = new Vector3(0, 1, 0).cross(up).normalize();
  const look = east.clone().multiplyScalar(Math.cos(0.44)).addScaledVector(up, -Math.sin(0.44));
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const bodyToWorld = new Matrix4().makeTranslation(-camBody.x, -camBody.y, -camBody.z);
  const K = Math.max(3, 500 / (2 * Math.tan((50 * Math.PI) / 360) * 6 * PATCH_RES));
  const built: number[] = [];
  for (let f = 0; f < 400; f++) {
    // fields arrive every 7 frames: a little water moves somewhere, the bounds refresh
    if (f % 7 === 0) { fields.waterDepth[(f * 131) % n] = (f % 3) * 0.01; fields.geomVersion++; }
    lod.select({ camBody, frustum, bodyToWorld, K, frame: f, buildBudget: 16, buildMs: undefined } as never);
    built.push(lod.stats.builtTotal);
  }
  const atRest = built[399] - built[199];
  if (process.env.CHUNK_LOG) console.log(`built by frame 20/50/100/199/399: ${built[20]} ${built[50]} ${built[100]} ${built[199]} ${built[399]}; selected ${lod.stats.patches}`);
  assert.ok(built[199] > 50, `the view needs patches (${built[199]})`);
  assert.equal(atRest, 0, `${atRest} patches built over the last 200 still frames (selection ${lod.stats.patches})`);
});

test('a patch built on reused scratch arrays equals one built fresh', async () => {
  const { Patch } = await import('../src/render/planet/chunks.ts');
  const grid = getGrid(48);
  const n = grid.count;
  const surface = new Float32Array(n);
  for (let c = 0; c < n; c++) surface[c] = 40 * Math.sin(grid.pos[c * 3] * 9);
  const mk = () => new ChunkLOD(grid, new Noise3(3), 3000, new Group(), { terrain: () => new MeshBasicMaterial(), water: () => new MeshBasicMaterial() },
    { surface, grad: null, waterLevel: new Float32Array(n).fill(-1000), waterDepth: new Float32Array(n), geomVersion: 0 });
  const st = grid.n / 2 ** 7;
  const patch = (f: number, k: number, lv: number) => new Patch(f, lv, [k * st, 0], [k * st + st, 0], [k * st, st]);
  const snap = (lod: ChunkLOD, p: unknown) => {
    const g = (lod as unknown as { buildGeometry(p: unknown): { attributes: Record<string, { array: Float32Array }> } }).buildGeometry(p);
    return Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, Float32Array.from(a.array)]));
  };
  const fresh = snap(mk(), patch(3, 2, 7));
  const used = mk();
  for (let k = 0; k < 5; k++) snap(used, patch(k * 4, k, 5 + (k % 3)));
  const again = snap(used, patch(3, 2, 7));
  for (const k of Object.keys(fresh)) assert.deepEqual(again[k], fresh[k], `attribute ${k} differs`);
});
