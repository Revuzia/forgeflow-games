// PERF s7 — the perf report's GL call trace (perfreport.ts GlTrace): calls charged to the current slot, upload bytes,
// uploads issued after a draw into the same framebuffer counted 'inside a pass', and the context restored after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GlTrace } from '../src/render/perfreport.ts';

test('GlTrace: per-slot calls, bytes, inside-pass uploads; uninstall restores the context', () => {
  const calls: string[] = [];
  class Ctx {
    bufferSubData(..._a: unknown[]) { calls.push('bsd'); }
    drawElements(..._a: unknown[]) { calls.push('draw'); }
    bindFramebuffer(..._a: unknown[]) { calls.push('fb'); }
    texSubImage2D(..._a: unknown[]) { calls.push('tex'); }
    getExtension() { return null; }
  }
  const gl = new Ctx() as unknown as WebGL2RenderingContext & Record<string, unknown>;
  const proto = Ctx.prototype.bufferSubData;
  const tr = new GlTrace();
  tr.install(gl);
  assert.notEqual(gl.bufferSubData, proto);
  tr.slot = 'shadows';
  gl.bindFramebuffer(0x8d40, null);
  gl.bufferSubData(0x8892, 0, new Float32Array(100)); // before any draw: not inside a pass
  gl.drawElements(4, 3, 0x1403, 0);
  gl.bufferSubData(0x8892, 0, new Float32Array(16)); // after a draw: inside the pass
  gl.texSubImage2D(0x0de1, 0, 0, 0, 8, 4, 0x1908, 0x1401, new Uint8Array(128));
  tr.slot = 'post';
  gl.bindFramebuffer(0x8d40, null);
  gl.bufferSubData(0x8892, 0, new Float32Array(4));
  assert.deepEqual(calls, ['fb', 'bsd', 'draw', 'bsd', 'tex', 'fb', 'bsd']);
  const s = tr.stats.get('shadows|bufferSubData')!;
  assert.equal(s.n, 2); assert.equal(s.bytes, 400 + 64); assert.equal(s.inPass, 1);
  assert.equal(tr.stats.get('shadows|texSubImage2D')!.bytes, 128);
  assert.equal(tr.stats.get('post|bufferSubData')!.inPass, 0);
  assert.equal(tr.inPassUploads, 2);
  assert.equal(tr.passSwitches, 2);
  assert.ok(tr.lines(1)[0].includes('uploads inside a pass 2'));
  tr.uninstall();
  assert.equal(gl.bufferSubData, proto);
  assert.ok(!Object.prototype.hasOwnProperty.call(gl, 'bufferSubData'));
});

test('GlTrace: ANGLE-Metal allocation estimate (bufferData = its size, bufferSubData = the whole bound buffer)', () => {
  class Ctx {
    bindBuffer(..._a: unknown[]) { /* bound */ }
    bufferData(..._a: unknown[]) { /* new */ }
    bufferSubData(..._a: unknown[]) { /* sub */ }
    getExtension() { return null; }
  }
  const gl = new Ctx() as unknown as WebGL2RenderingContext;
  const tr = new GlTrace();
  tr.install(gl);
  tr.slot = 'shadows';
  const A = {} as WebGLBuffer, B = {} as WebGLBuffer;
  gl.bindBuffer(0x8892, A);
  gl.bufferData(0x8892, new Float32Array(1000), 0x88e8); // 4000 B new
  gl.bindBuffer(0x8892, B);
  gl.bufferData(0x8892, new Float32Array(250000), 0x88e8); // 1 MB new
  gl.bufferSubData(0x8892, 0, new Float32Array(10)); // into B: a whole-size copy (1 MB)
  gl.bindBuffer(0x8892, A);
  gl.bufferSubData(0x8892, 16, new Float32Array(4)); // into A: 4000 B
  const m = tr.metal.get('shadows')!;
  assert.equal(m.n, 4);
  assert.equal(m.bytes, 4000 + 1e6 + 1e6 + 4000);
  assert.ok(tr.lines(1).some((l) => l.startsWith('metal buffer allocs')));
  tr.uninstall();
  assert.ok(!Object.prototype.hasOwnProperty.call(gl, 'bindBuffer'));
});
