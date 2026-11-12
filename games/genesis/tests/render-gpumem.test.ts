// PERF s14 — the live GPU memory audit (src/render/gpumem.ts): sizes from the allocation calls, freed on delete
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GpuMemAudit } from '../src/render/gpumem.ts';

function fakeGl() {
  const C = {
    TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, TEXTURE_3D: 0x806f, TEXTURE_2D_ARRAY: 0x8c1a, TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a, ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
    UNIFORM_BUFFER: 0x8a11, RENDERBUFFER: 0x8d41, RGBA8: 0x8058, RGBA16F: 0x881a, R8: 0x8229, DEPTH_COMPONENT32F: 0x8cac,
    RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FLOAT: 0x1406, HALF_FLOAT: 0x140b,
  };
  const noop = () => {};
  return { ...C, activeTexture: noop, bindTexture: noop, bindBuffer: noop, bindBufferBase: noop, bindRenderbuffer: noop, bufferData: noop,
    texImage2D: noop, texStorage2D: noop, texImage3D: noop, texStorage3D: noop, generateMipmap: noop, renderbufferStorage: noop,
    renderbufferStorageMultisample: noop, deleteBuffer: noop, deleteTexture: noop, deleteRenderbuffer: noop,
    bufferSubData: noop, texSubImage2D: noop, texSubImage3D: noop, bindVertexArray: noop, vertexAttribPointer: noop, vertexAttribIPointer: noop,
    deleteVertexArray: noop, drawArrays: noop, drawElements: noop, drawArraysInstanced: noop, drawElementsInstanced: noop, drawRangeElements: noop } as unknown as WebGL2RenderingContext & typeof C;
}

test('buffers, textures (2D, mips, cube, 3D) and MSAA renderbuffers are counted and freed', () => {
  const gl = fakeGl(), a = new GpuMemAudit();
  a.install(gl);
  const b = {}, t = {}, cube = {}, t3 = {}, rb = {};
  gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(1000), 0x88e4);
  assert.equal(a.total, 4000);
  gl.bufferData(gl.ARRAY_BUFFER, 2048, 0x88e4); // re-specified: replaces
  assert.equal(a.total, 2048);
  gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 128, 0, gl.RGBA, gl.HALF_FLOAT, null);
  assert.equal(a.total, 2048 + 256 * 128 * 8);
  gl.generateMipmap(gl.TEXTURE_2D);
  assert.equal(a.total, 2048 + 256 * 128 * 8 + Math.round(256 * 128 * 8 / 3));
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube); gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA8, 64, 64);
  gl.bindTexture(gl.TEXTURE_3D, t3); gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, 32, 32, 32);
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.DEPTH_COMPONENT32F, 100, 50);
  const before = a.total;
  assert.equal(before, 2048 + 256 * 128 * 8 + Math.round(256 * 128 * 8 / 3) + 6 * 64 * 64 * 4 + 32 * 32 * 32 + 100 * 50 * 4 * 4);
  gl.deleteTexture(t); gl.deleteRenderbuffer(rb); gl.deleteBuffer(b);
  assert.equal(a.total, 6 * 64 * 64 * 4 + 32 * 32 * 32);
  assert.ok(a.peak >= before);
  const L = a.lines();
  assert.match(L[0], /^gpu mem \(est\., live GL allocations\): total 0\.1 MB/);
  assert.match(L[1], /cube 64x64 rgba8 cube/);
});

test('PERF s15: ANGLE transients — a sub-update of a buffer drawn in the last 3 frames counts a whole-buffer copy, once a frame', () => {
  const gl = fakeGl(), a = new GpuMemAudit();
  a.install(gl);
  const b = {}, idle = {}, vao = {};
  gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(250000), 0x88e8); // 1 MB
  gl.bindBuffer(gl.ARRAY_BUFFER, idle); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(250000), 0x88e8);
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
  a.tick();
  // frame 1: drawn, then two sub-updates of the drawn buffer (one copy) and one of the never-drawn one (no copy)
  gl.bindVertexArray(vao); gl.drawArrays(4, 0, 3); gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(16)); gl.bufferSubData(gl.ARRAY_BUFFER, 64, new Float32Array(16));
  gl.bindBuffer(gl.ARRAY_BUFFER, idle); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(16));
  a.tick();
  let t = a.transients();
  assert.equal(t.frames, 2);
  assert.equal(t.copyN, 0.5);
  assert.equal(t.copyMB, 1e6 / 1048576 / 2);
  assert.equal(t.subN, 1.5);
  // three frames later the GPU is done with it: no copy
  a.tick(); a.tick(); a.tick();
  gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(16));
  a.tick();
  t = a.transients();
  assert.equal(t.copyN * t.frames, 1);
  // a deleted vertex array leaves no link behind (nothing in the bookkeeping only climbs)
  gl.deleteVertexArray(vao);
  assert.equal(a.trackSizes.vaoBufs, 0);
  assert.equal(a.trackSizes.vaoFrame, 0);
  gl.deleteBuffer(b); gl.deleteBuffer(idle);
  assert.equal(a.trackSizes.bufVaos, 0);
  assert.equal(a.trackSizes.live, 0);
  assert.match(a.lines().join('\n'), /angle transients \(est\./);
});

test('PERF s15: GPU bytes by owner — a buffer by its source array, a texture by the three object allocated for it', () => {
  const gl = fakeGl(), a = new GpuMemAudit();
  a.install(gl);
  const tex = { isTexture: true, name: 'gtao' }, data = new Float32Array(1000), unknown = new Float32Array(10);
  const props = { get: (o: object) => o };
  a.attach({ properties: props });
  a.ownerProbe = () => new Map<object, string>([[data.buffer, 'planet-0/vegetation']]);
  gl.bindBuffer(gl.ARRAY_BUFFER, {}); gl.bufferData(gl.ARRAY_BUFFER, data, 0x88e4);
  gl.bindBuffer(gl.ARRAY_BUFFER, {}); gl.bufferData(gl.ARRAY_BUFFER, unknown, 0x88e4);
  props.get(tex);
  gl.bindTexture(gl.TEXTURE_2D, {}); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 64, 64, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const own = a.byOwner();
  assert.equal(own.get('planet-0/vegetation')?.b, 4000);
  assert.equal(own.get('tex:gtao')?.b, 64 * 64 * 8);
  assert.equal(own.get('buffers (not in the scene)')?.b, 40);
});
