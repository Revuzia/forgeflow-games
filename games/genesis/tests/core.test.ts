// GENESIS — core utilities: the time wheel (deterministic event scheduling), the GNSS save container, stable hashing
// and id allocation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeWheel } from '../src/sim/core/timewheel.ts';
import { SaveWriter, readSave } from '../src/sim/core/serialize.ts';
import { Hasher, hashJson, hashTyped, stableStringify } from '../src/sim/core/hash.ts';
import { IdAllocator } from '../src/sim/core/ids.ts';
import { Rng } from '../src/sim/core/rng.ts';

test('time wheel: due ids drain in (tick, id) order, reschedule / cancel / far future / save-load', () => {
  const w = new TimeWheel(16);
  w.schedule(5, 3); w.schedule(2, 3); w.schedule(9, 1); w.schedule(7, 100); w.schedule(1, 40);
  w.schedule(3, 3); w.cancel(3);
  w.schedule(4, 2); w.schedule(4, 6); // rescheduled: only the latest counts
  assert.deepEqual(w.drain(0), []);
  assert.deepEqual(w.drain(3), [9, 2, 5]);
  assert.deepEqual(w.drain(6), [4]);
  const saved = JSON.parse(JSON.stringify(w.save()));
  const w2 = TimeWheel.load(saved);
  assert.deepEqual(w.drain(39), []);
  assert.deepEqual(w.drain(40), [1]);
  assert.deepEqual(w2.drain(40), [1]);
  assert.deepEqual(w.drain(200), [7]);
  assert.deepEqual(w2.drain(200), [7]);
  assert.equal(w.count, 0);
  // order never depends on scheduling order
  const a = new TimeWheel(8), b = new TimeWheel(8);
  const ids = [11, 3, 7, 1, 9, 4];
  ids.forEach((id) => a.schedule(id, 10));
  [...ids].reverse().forEach((id) => b.schedule(id, 10));
  assert.deepEqual(a.drain(10), b.drain(10));
  // randomized against a reference
  const r = new Rng(5);
  const tw = new TimeWheel(32);
  const ref = new Map<number, number>();
  for (let i = 0; i < 400; i++) { const id = r.int(1, 120); const t = r.int(0, 300); tw.schedule(id, t); ref.set(id, t); }
  const got: [number, number][] = [];
  for (let t = 0; t <= 300; t++) for (const id of tw.drain(t)) got.push([id, t]);
  const want = [...ref.entries()].sort((x, y) => x[1] - y[1] || x[0] - y[0]);
  assert.deepEqual(got, want);
});

test('GNSS container round-trips JSON + typed arrays with alignment', () => {
  const w = new SaveWriter();
  const f32 = new Float32Array([1.5, -2.25, Math.PI]);
  const f64 = new Float64Array([1e-300, -0, 12345.678]);
  const u8 = new Uint8Array([1, 2, 3, 4, 5]);
  const i16 = new Int16Array([-7, 8, 9]);
  w.blob('a', f32).blob('b', u8).blob('c', f64).blob('d', i16);
  const bytes = w.finish({ hello: 'world', n: 3, nested: { x: [1, 2] } });
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'GNSS');
  const s = readSave(bytes);
  assert.equal(s.major, 1);
  assert.deepEqual(s.header, { hello: 'world', n: 3, nested: { x: [1, 2] } });
  assert.deepEqual(Array.from(s.blobs.get('a')!), Array.from(f32));
  assert.deepEqual(Array.from(s.blobs.get('b')!), Array.from(u8));
  assert.ok(Object.is(s.blobs.get('c')![1], -0));
  assert.deepEqual(Array.from(s.blobs.get('d')!), [-7, 8, 9]);
  assert.ok(s.blobs.get('c') instanceof Float64Array);
  assert.throws(() => readSave(bytes.subarray(0, bytes.length - 5)), /truncated/);
  assert.throws(() => new SaveWriter().blob('x', u8).blob('x', u8), /duplicate/);
});

test('stable hashing: key order and storage views never matter, values and bits do', () => {
  assert.equal(hashJson({ a: 1, b: [1, 2, { c: 3, d: 'x' }] }), hashJson({ b: [1, 2, { d: 'x', c: 3 }], a: 1 }));
  assert.notEqual(hashJson({ a: 1 }), hashJson({ a: 2 }));
  assert.equal(stableStringify({ z: 1, a: undefined, m: [NaN, 2] }), '{"m":[null,2],"z":1}');
  const big = new Float32Array(1001).map((_, i) => Math.sin(i));
  const copy = new Float32Array(big);
  assert.equal(hashTyped(big), hashTyped(copy));
  copy[500] = Math.fround(copy[500] + 1e-6);
  assert.notEqual(hashTyped(big), hashTyped(copy));
  // an unaligned view hashes like an aligned copy of the same bytes
  const buf = new Uint8Array(13);
  buf.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const view = new Uint8Array(buf.buffer, 1, 9);
  assert.equal(hashTyped(view), hashTyped(new Uint8Array(view)));
  assert.equal(new Hasher().str('ab').str('c').hex() === new Hasher().str('a').str('bc').hex(), false, 'length-prefixed strings');
  assert.match(new Hasher().num(1).hex(), /^[0-9a-f]{16}$/);
});

test('ids are monotonic per kind and survive save/load', () => {
  const ids = new IdAllocator();
  assert.equal(ids.alloc('weather'), 1);
  assert.equal(ids.alloc('weather'), 2);
  assert.equal(ids.alloc('agent'), 1);
  ids.reserve('agent', 50);
  const back = IdAllocator.load(JSON.parse(JSON.stringify(ids.save())));
  assert.equal(back.alloc('agent'), 51);
  assert.equal(back.alloc('weather'), 3);
  assert.equal(back.peek('ship'), 0);
});
