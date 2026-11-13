// GENESIS — PERF s16: no ANGLE-Metal whole-buffer copies. A bufferSubData into a buffer drawn in the last ~3 frames
// makes ANGLE copy the whole buffer; per-frame instance data now rotates through a ring of 3 buffers (bufring.ts),
// terrain patches land in pages not drawn recently (chunks.ts FRESH_LAND), and gpumem counts a buffer as in use
// through the vertex arrays that CURRENTLY point at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import type { BatchedMesh } from 'three';
import { addRange, ringify, ringOf, ringTick, ringFrame, RING_N } from '../src/render/bufring.ts';
import { uploadPrefix } from '../src/render/upload.ts';
import { GpuMemAudit } from '../src/render/gpumem.ts';
import { ChunkLOD, PATCH_RES } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

test('addRange keeps sorted disjoint ranges, merging overlaps', () => {
  const d: number[] = [];
  addRange(d, 10, 20); addRange(d, 30, 40); addRange(d, 0, 5);
  assert.deepEqual(d, [0, 5, 10, 20, 30, 40]);
  addRange(d, 18, 31);
  assert.deepEqual(d, [0, 5, 10, 40]);
  addRange(d, 5, 10);
  assert.deepEqual(d, [0, 40]);
  const e: number[] = [];
  for (let i = 0; i < 100; i++) addRange(e, i * 10, i * 10 + 1);
  assert.ok(e.length <= 48, 'bounded');
  for (let i = 0; i < 100; i++) assert.ok(e.some((_, k) => k % 2 === 0 && e[k] <= i * 10 && e[k + 1] >= i * 10 + 1), 'every write covered');
});

test('a ringed instance attribute rotates one member a frame, each sent everything written since its own upload', () => {
  const geo = new BoxGeometry();
  const extra = new InstancedBufferAttribute(new Float32Array(64 * 4), 4);
  geo.setAttribute('iExtra', extra);
  const mesh = new InstancedMesh(geo, new MeshBasicMaterial(), 64);
  ringify(mesh, ['instanceMatrix', 'iExtra']);
  const r = ringOf(extra)!;
  assert.equal(r.members.length, RING_N);
  const seen: object[] = [];
  const upload = () => { const m = geo.getAttribute('iExtra') as InstancedBufferAttribute; const rg = m.updateRanges.map((x) => [x.start, x.start + x.count]); m.onUploadCallback(); m.clearUpdateRanges(); return { m, rg }; };
  // frame 1: items 0..10
  ringTick(); (extra.array as Float32Array)[0] = 1; uploadPrefix(extra, 10);
  let u = upload(); seen.push(u.m); assert.deepEqual(u.rg, [[0, 40]]);
  // frame 2: items 0..20
  ringTick(); uploadPrefix(geo.getAttribute('iExtra') as InstancedBufferAttribute, 20);
  u = upload(); seen.push(u.m); assert.deepEqual(u.rg, [[0, 80]]);
  // frame 3: items 30..31 only (a sub-range) — this member never uploaded: it takes every range so far
  ringTick(); (ringOf(extra)!.members[0] as unknown as { onUploadCallback(): void });
  const a3 = geo.getAttribute('iExtra') as InstancedBufferAttribute;
  uploadPrefix(a3, 20);
  u = upload(); seen.push(u.m);
  assert.equal(new Set(seen).size, 3, 'three different buffers on three frames');
  // frame 4: back to the first member, which saw frames 2 and 3's writes since its upload
  ringTick(); uploadPrefix(extra, 5);
  u = upload();
  assert.equal(u.m, seen[0]);
  assert.deepEqual(u.rg, [[0, 80]]);
  // the same CPU array everywhere (the owner's writes reach every member)
  for (const m of r.members) assert.equal((m as InstancedBufferAttribute).array, extra.array);
  // two uploads in one frame stay on one member
  ringTick(); uploadPrefix(extra, 3); const m1 = geo.getAttribute('iExtra'); uploadPrefix(extra, 6);
  assert.equal(geo.getAttribute('iExtra'), m1);
  // the instance matrix is swapped on the mesh
  const im0 = mesh.instanceMatrix; ringTick(); uploadPrefix(mesh.instanceMatrix, 4);
  assert.notEqual(mesh.instanceMatrix, im0);
  assert.equal(mesh.instanceMatrix.array, im0.array);
});

test('gpumem: a buffer a vertex array no longer points at is not in use 3 frames after its last draw', () => {
  const C = { ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, UNIFORM_BUFFER: 0x8a11, TEXTURE0: 0x84c0, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a };
  const noop = () => {};
  const names = ['activeTexture', 'bindTexture', 'bindBuffer', 'bindBufferBase', 'bindRenderbuffer', 'bufferData', 'texImage2D', 'texStorage2D', 'texImage3D', 'texStorage3D', 'generateMipmap', 'renderbufferStorage', 'renderbufferStorageMultisample', 'deleteBuffer', 'deleteTexture', 'deleteRenderbuffer', 'bufferSubData', 'texSubImage2D', 'texSubImage3D', 'bindVertexArray', 'vertexAttribPointer', 'vertexAttribIPointer', 'deleteVertexArray', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  const gl = { ...C, ...Object.fromEntries(names.map((n) => [n, noop])) } as unknown as WebGL2RenderingContext;
  const a = new GpuMemAudit();
  a.install(gl);
  const vao = {}, b0 = {}, b1 = {};
  for (const b of [b0, b1]) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(1000), 0x88e8); }
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b0); gl.vertexAttribPointer(3, 4, 0x1406, false, 0, 0);
  gl.drawArrays(4, 0, 3);
  // re-point slot 3 to b1 (a ring flip) and draw for 3 frames
  for (let f = 0; f < 3; f++) { a.tick(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.vertexAttribPointer(3, 4, 0x1406, false, 0, 0); gl.drawArrays(4, 0, 3); }
  a.tick();
  const copies = () => (a as unknown as { cur: { copyN: number } }).cur.copyN;
  gl.bindBuffer(gl.ARRAY_BUFFER, b0); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(10));
  assert.equal(copies(), 0, 'b0 was last drawn 4 frames ago');
  gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(10));
  assert.equal(copies(), 1, 'b1 is drawn every frame');
});

test('PERF s16 FRESH_LAND: at steady flight terrain patches land in pages not drawn in the last 3 frames', () => {
  const grid = getGrid(48);
  const n = grid.count, R = 3000;
  const surface = new Float32Array(n);
  for (let c = 0; c < n; c++) surface[c] = 40 * Math.sin(grid.pos[c * 3] * 9) * Math.cos(grid.pos[c * 3 + 2] * 7);
  const waterLevel = new Float32Array(n).fill(-1000), waterDepth = new Float32Array(n);
  for (let c = 0; c < n; c += 3) { waterLevel[c] = surface[c] + 5; waterDepth[c] = 5; }
  const fields = { surface, grad: null, waterLevel, waterDepth, geomVersion: 0 };
  const mat = new MeshBasicMaterial();
  const group = new Group();
  const lod = new ChunkLOD(grid, new Noise3(3), R, group, { terrain: () => mat, water: () => mat }, fields);
  const cam = new PerspectiveCamera(50, 888 / 500, 0.5, 1e6);
  const K = Math.max(3, 500 / (2 * Math.tan((50 * Math.PI) / 360) * 6 * PATCH_RES));
  let writes = 0, hot = 0, pagesPeak = 0, livePeak = 0;
  const F = 900;
  for (let f = 0; f < F; f++) {
    ringTick();
    const t = f / 600;
    const a = t * Math.PI * 2;
    const up = new Vector3(Math.cos(a), 0.35 * Math.sin(a * 2), Math.sin(a)).normalize();
    const alt = 120 * Math.pow(4000 / 120, 0.5 - 0.5 * Math.cos(a * 2));
    const camBody = up.clone().multiplyScalar(R + 60 + alt);
    const east = new Vector3(0, 1, 0).cross(up).normalize();
    cam.up.copy(up); cam.position.set(0, 0, 0);
    cam.lookAt(east.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(up, -Math.sin(0.5)));
    cam.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const bodyToWorld = new Matrix4().makeTranslation(-camBody.x, -camBody.y, -camBody.z);
    // each page's buffer version and whether the GPU read it in the last 3 frames, before this frame's landings
    const pages = new Map<BatchedMesh, { v: number; hot: boolean }>();
    group.traverse((o) => { const m = o as BatchedMesh; if ((m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) pages.set(m, { v: (m.geometry.getAttribute('position') as { version?: number } | undefined)?.version ?? 0, hot: ringFrame() - ((m.userData.drawn as number | undefined) ?? -1e9) < RING_N }); });
    lod.select({ camBody, frustum, bodyToWorld, K, frame: f, buildBudget: 24, buildMs: undefined } as never);
    if (f > 200) for (const [m, s] of pages) { if (((m.geometry.getAttribute('position') as { version?: number } | undefined)?.version ?? 0) !== s.v) { writes++; if (s.hot) hot++; } }
    // the frame's draws (keepIndirectTable's onBeforeRender stamps each visible page and water sheet)
    let np = 0;
    group.traverse((o) => { const m = o as BatchedMesh; if ((m as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) { np++; if (m.visible && m.parent) m.userData.drawn = ringFrame(); } });
    pagesPeak = Math.max(pagesPeak, np);
    livePeak = Math.max(livePeak, (lod as unknown as { live: Set<unknown> }).live.size);
  }
  assert.ok(writes > 30, `the flight lands patches (${writes} page writes)`);
  assert.ok(hot <= writes * 0.08, `${hot} of ${writes} page writes went into a page drawn in the last 3 frames`);
  if (process.env.CHUNK_LOG) console.log({ writes, hot, pagesPeak, livePeak });
});

test('putGrowable rings a rebuilt geometry buffer (and its index): a new member each rebuild frame, the same array', async () => {
  const { BufferGeometry } = await import('three');
  const { putGrowable } = await import('../src/render/upload.ts');
  const geo = new BufferGeometry();
  ringTick();
  const a0 = putGrowable(geo, 'position', new Float32Array(30), 3);
  const i0 = putGrowable(geo, 'index', new Uint32Array(12), 1);
  ringTick();
  const a1 = putGrowable(geo, 'position', new Float32Array(33), 3);
  const i1 = putGrowable(geo, 'index', new Uint32Array(15), 1);
  assert.notEqual(a1, a0); assert.equal(a1.array, a0.array); assert.equal(geo.getAttribute('position'), a1);
  assert.notEqual(i1, i0); assert.equal(geo.index, i1);
  assert.deepEqual(a1.updateRanges.map((r) => [r.start, r.count]), [[0, 33]]);
  // a bigger rebuild makes a new attribute (its own ring)
  ringTick();
  const a2 = putGrowable(geo, 'position', new Float32Array(5000), 3);
  assert.ok(a2.array.length >= 5000 && ringOf(a2) && !ringOf(a2)!.members.includes(a0));
});
