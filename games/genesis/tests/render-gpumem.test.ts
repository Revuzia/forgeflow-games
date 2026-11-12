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
    renderbufferStorageMultisample: noop, deleteBuffer: noop, deleteTexture: noop, deleteRenderbuffer: noop } as unknown as WebGL2RenderingContext & typeof C;
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
