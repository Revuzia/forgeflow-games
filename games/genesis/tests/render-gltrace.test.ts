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
