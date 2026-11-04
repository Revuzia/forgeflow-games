// GENESIS — shader warm-up holders (macfix/smooth.md F11-F13): what Renderer.warmUp's compile sees at load must have
// the same program key as what is drawn later, or the real program links in the frame an effect first shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchedMesh, Group, InstancedMesh, type Object3D } from 'three';
import { BldBatch } from '../src/render/life/bldbatch.ts';
import { BodyBuckets } from '../src/render/life/bodies.ts';
import { whiteColors } from '../src/render/life/vegetation.ts';
import { PASS_MATERIALS, passMaterial } from '../src/render/post/fsquad.ts';
import { PLAN } from '../src/render/gen/bodygen.ts';

const hidden = (o: Object3D) => { let p: Object3D | null = o; while (p) { if (!p.visible) return true; p = p.parent; } return false; };

test('a building batch carries a never-drawn twin with geometry and per-instance colours (the drawn batch key)', () => {
  const b = new BldBatch('t', {}, false, true);
  assert.equal(b.warm.children.length, 2);
  for (const w of b.warm.children as BatchedMesh[]) {
    assert.ok(w instanceof BatchedMesh);
    assert.ok(hidden(w));
    assert.ok((w as unknown as { _colorsTexture: unknown })._colorsTexture, 'batchingColor');
    for (const a of ['position', 'normal', 'color', 'uv', 'aKit']) assert.ok(w.geometry.getAttribute(a), a);
  }
  assert.deepEqual(b.warm.children.map((w) => (w as BatchedMesh).material), [b.material, b.depth]);
  b.dispose();
});

test('body buckets hold one hidden mesh per plan for the colour and the shadow pass', () => {
  const bb = new BodyBuckets({}, 'bodies');
  const warm = bb.group.children.find((c) => c.name === 'bodies-warm') as Group;
  assert.ok(warm && !warm.visible);
  assert.equal(warm.children.length, Object.keys(PLAN).length * 2);
  for (const m of warm.children as InstancedMesh[]) assert.equal(m.count, 0);
});

test('instance colours made up front are white (three\'s own default, a no-op tint)', () => {
  const m = new InstancedMesh(undefined, undefined, 5);
  whiteColors(m, 5);
  assert.equal(m.instanceColor!.count, 5);
  assert.ok([...(m.instanceColor!.array as Float32Array)].every((v) => v === 1));
});

test('pass materials are registered for the warm-up and leave the registry on dispose', () => {
  const m = passMaterial('void main(){ gl_FragColor = vec4(1.0); }', {});
  assert.ok(PASS_MATERIALS.has(m));
  m.dispose();
  assert.ok(!PASS_MATERIALS.has(m));
});
