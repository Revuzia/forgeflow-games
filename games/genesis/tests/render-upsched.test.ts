// ROADMAP-60FPS step 4 (PERF s17): buffer updates go up in the renderer's uploads slot (uploadsched.ts) — the same
// bytes three would send, on COPY_WRITE_BUFFER, three's version untouched; after the flush, the old way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, DataTexture } from 'three';
import { earlyAttr, flushUploads, scheduleUpload, setUploadGL, texUpload, uploadFrameBegin, uploadSchedReset, UPSCHED } from '../src/render/uploadsched.ts';

function fakeGL() {
  const calls: unknown[][] = [];
  let bound: object | null = null;
  const gl = {
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, COPY_WRITE_BUFFER: 0x8f37, NO_ERROR: 0,
    ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
    getParameter: () => bound,
    getError: () => 0,
    bindBuffer: (t: number, b: object | null) => { calls.push(['bind', t, b]); },
    bufferSubData: (t: number, off: number, arr: Float32Array, s: number, n: number) => { calls.push(['sub', t, off, Array.from(arr.subarray(s, s + n))]); },
    setBound(b: object | null) { bound = b; },
    calls,
  };
  return gl;
}

test('upsched: a registered attribute uploads its ranges in the slot, three\'s version untouched', () => {
  assert.equal(UPSCHED, true);
  uploadSchedReset();
  const gl = fakeGL();
  const inited: unknown[] = [];
  const r = { getContext: () => gl, initTexture: (t: unknown) => inited.push(t) } as never;
  setUploadGL(gl as never);
  const a = new BufferAttribute(new Float32Array(16).map((_, i) => i), 4);
  let cb = 0;
  a.onUploadCallback = () => { cb++; };
  earlyAttr(a);
  // before the first flush: the old way
  a.needsUpdate = true;
  assert.equal(a.version, 1);
  // three's first upload (its buffer bound) makes the GL buffer known
  const buf = { id: 'B' };
  gl.setBound(buf);
  (a as unknown as { onUploadCallback: () => void }).onUploadCallback();
  assert.equal(cb, 1);
  flushUploads(r); // scheduling is live from here; this frame is flushed
  uploadFrameBegin();
  // a change: two ranges
  a.array[5] = 50; a.array[13] = 130;
  a.addUpdateRange(4, 4); a.addUpdateRange(12, 2);
  a.needsUpdate = true;
  assert.equal(a.version, 1, 'version untouched: three finds the buffer current');
  assert.equal(a.updateRanges.length, 0);
  // an owner's own upload and a texture wait for the slot too
  let ran = 0;
  scheduleUpload(() => { ran++; });
  const tex = new DataTexture(new Uint8Array(4), 1, 1);
  texUpload(tex);
  assert.equal(ran, 0);
  gl.calls.length = 0;
  flushUploads(r);
  assert.equal(ran, 1);
  assert.deepEqual(inited, [tex]);
  const subs = gl.calls.filter((c) => c[0] === 'sub');
  assert.deepEqual(subs, [['sub', gl.COPY_WRITE_BUFFER, 16, [4, 50, 6, 7]], ['sub', gl.COPY_WRITE_BUFFER, 48, [12, 130]]]);
  assert.ok(gl.calls.some((c) => c[0] === 'bind' && c[1] === gl.COPY_WRITE_BUFFER && c[2] === buf));
  assert.ok(!gl.calls.some((c) => c[0] === 'bind' && (c[1] === gl.ARRAY_BUFFER || c[1] === gl.ELEMENT_ARRAY_BUFFER)), 'no vertex-array state touched');
  assert.equal(cb, 2, 'the owner\'s onUploadCallback ran after the upload');
  // after the flush in the same frame: the old way (three uploads at the draw)
  a.addUpdateRange(0, 4);
  a.needsUpdate = true;
  assert.equal(a.version, 2);
  uploadSchedReset();
});
