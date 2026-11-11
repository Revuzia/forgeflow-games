// PERF F16 — on ANGLE-Metal every update range of an attribute is one whole-buffer copy: ranges are kept as one span.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, InstancedBufferAttribute } from 'three';
import { installSpanUploads, uploadPrefix } from '../src/render/upload.ts';

test('span uploads: off = three ranges; on = one covering span (any order), prefix uploads unchanged', () => {
  const a = new BufferAttribute(new Float32Array(1000), 4);
  a.addUpdateRange(100, 8); a.addUpdateRange(400, 8);
  assert.equal(a.updateRanges.length, 2);
  assert.equal(installSpanUploads(false), false);
  assert.equal(installSpanUploads(true), true);
  const b = new BufferAttribute(new Float32Array(1000), 4);
  b.addUpdateRange(400, 8); b.addUpdateRange(100, 8); b.addUpdateRange(600, 40);
  assert.deepEqual(b.updateRanges, [{ start: 100, count: 540 }]);
  const c = new InstancedBufferAttribute(new Float32Array(64), 16);
  uploadPrefix(c, 2);
  assert.deepEqual(c.updateRanges, [{ start: 0, count: 32 }]);
  c.addUpdateRange(48, 16);
  assert.deepEqual(c.updateRanges, [{ start: 0, count: 64 }]);
  c.clearUpdateRanges();
  assert.equal(c.updateRanges.length, 0);
});
