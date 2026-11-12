// GENESIS — PERF s15 growth hunt: the terrain / water patch pools over thousands of frames. The camera flies the same
// loop again and again (round the planet, diving to 120 m and climbing to 4 km): whatever the pools hold — slots,
// pages in use, idle pages, the meshes in the scene, the pages lists — must come back to the same levels every lap.
// Anything that only climbs from lap to lap is a leak (the owner's M5: swap grew 3 GB in 45 minutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frustum, Group, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { ChunkLOD, PATCH_RES } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

test('PERF s15: a camera flying the same loop for thousands of frames leaves the patch pools at the same levels every lap', () => {
  const grid = getGrid(48);
  const n = grid.count, R = 3000;
  const surface = new Float32Array(n);
  for (let c = 0; c < n; c++) surface[c] = 40 * Math.sin(grid.pos[c * 3] * 9) * Math.cos(grid.pos[c * 3 + 2] * 7);
  // a third of the cells wet: water pools too
  const waterLevel = new Float32Array(n).fill(-1000), waterDepth = new Float32Array(n);
  for (let c = 0; c < n; c += 3) { waterLevel[c] = surface[c] + 5; waterDepth[c] = 5; }
  const fields = { surface, grad: null, waterLevel, waterDepth, geomVersion: 0 };
  const mat = new MeshBasicMaterial();
  const group = new Group();
  const lod = new ChunkLOD(grid, new Noise3(3), R, group, { terrain: () => mat, water: () => mat }, fields);
  const cam = new PerspectiveCamera(50, 888 / 500, 0.5, 1e6);
  const K = Math.max(3, 500 / (2 * Math.tan((50 * Math.PI) / 360) * 6 * PATCH_RES));
  const LAP = 500, LAPS = 6;
  type M = { slots: number; idle: number; children: number; pages: number; live: number };
  const laps: M[] = [];
  const L = lod as unknown as { pagePool: { count: number }; tBatch: ({ pageCount: number } | null)[]; wBatch: ({ pageCount: number } | null)[]; live: Set<unknown> };
  for (let f = 0; f < LAP * LAPS; f++) {
    const t = (f % LAP) / LAP;
    const a = t * Math.PI * 2;
    const up = new Vector3(Math.cos(a), 0.35 * Math.sin(a * 2), Math.sin(a)).normalize();
    // dive and climb twice a lap: 120 m .. 4 km
    const alt = 120 * Math.pow(4000 / 120, 0.5 - 0.5 * Math.cos(a * 2));
    const camBody = up.clone().multiplyScalar(R + 60 + alt);
    const east = new Vector3(0, 1, 0).cross(up).normalize();
    const look = east.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(up, -Math.sin(0.5));
    cam.up.copy(up);
    cam.position.set(0, 0, 0);
    cam.lookAt(look);
    cam.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const bodyToWorld = new Matrix4().makeTranslation(-camBody.x, -camBody.y, -camBody.z);
    if (f % 9 === 0) { fields.waterDepth[(f * 131) % n] = 5 + (f % 3) * 0.01; fields.geomVersion++; }
    lod.select({ camBody, frustum, bodyToWorld, K, frame: f, buildBudget: 24, buildMs: undefined } as never);
    const lap = Math.floor(f / LAP);
    const m: M = {
      slots: lod.poolCapacity().slots, idle: L.pagePool.count, children: group.children.length,
      pages: [...L.tBatch, ...L.wBatch].reduce((s, b) => s + (b?.pageCount ?? 0), 0), live: L.live.size,
    };
    const cur = laps[lap] ??= { slots: 0, idle: 0, children: 0, pages: 0, live: 0 };
    for (const k of Object.keys(m) as (keyof M)[]) cur[k] = Math.max(cur[k], m[k]);
  }
  if (process.env.CHUNK_LOG) console.log(laps.map((m, i) => `lap ${i}: ${JSON.stringify(m)}`).join('\n'));
  // lap 0 warms up; from lap 2 on every lap peaks at the level of lap 1 (+ one page of slack per pool kind)
  for (let i = 2; i < LAPS; i++) for (const k of Object.keys(laps[1]) as (keyof M)[]) {
    assert.ok(laps[i][k] <= laps[1][k] * 1.05 + 16, `lap ${i}: ${k} peaked at ${laps[i][k]} (lap 1: ${laps[1][k]}) — climbing`);
  }
  assert.ok(laps[1].live > 50, `the loop needs patches (${laps[1].live})`);
});
