// PERF F19 — building batches draw instance i at draw i (an identity draw -> instance table uploaded once); a hidden or
// frustum-culled instance gets an empty draw. The set of instances drawn per pass equals three's own compaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchedMesh, BoxGeometry, Color, Matrix4, PerspectiveCamera, OrthographicCamera } from 'three';
import { BldBatch } from '../src/render/life/bldbatch.ts';

type M = BatchedMesh & { _indirectTexture: { version: number; image: { data: Uint32Array } }; _multiDrawCount: number; _multiDrawCounts: Int32Array; _multiDrawStarts: Int32Array };

/** the instances three's own onBeforeRender would draw for this camera (its compaction, read back through its table) */
function threeSet(b: BldBatch, cam: PerspectiveCamera | OrthographicCamera): Set<number> {
  const m = b.mesh as M;
  const saved = { data: m._indirectTexture.image.data.slice(), v: m._indirectTexture.version };
  BatchedMesh.prototype.onBeforeRender.call(m, null as never, null as never, cam, m.geometry, b.material, null as never);
  const out = new Set<number>();
  for (let i = 0; i < m._multiDrawCount; i++) out.add(m._indirectTexture.image.data[i]);
  m._indirectTexture.image.data.set(saved.data);
  m._indirectTexture.version = saved.v;
  return out;
}
function oursSet(b: BldBatch, cam: PerspectiveCamera | OrthographicCamera): Set<number> {
  const m = b.mesh as M;
  m.onBeforeRender(null as never, null as never, cam, m.geometry, b.material, null as never);
  const out = new Set<number>();
  for (let i = 0; i < m._multiDrawCount; i++) {
    assert.equal(m._indirectTexture.image.data[i], i, 'identity table');
    if (m._multiDrawCounts[i] > 0) out.add(i);
  }
  return out;
}

test('buildings: identity table uploaded once; drawn set = three per pass (visibility, frustum, shadow cull)', () => {
  const b = new BldBatch('t', {}, false, true);
  const box = new BoxGeometry(4, 6, 4);
  const gid = b.geom(box), gid2 = b.geom(new BoxGeometry(2, 2, 9));
  b.begin();
  const M4 = new Matrix4(), col = new Color(1, 1, 1);
  for (let i = 0; i < 60; i++) {
    M4.makeTranslation((i % 10) * 15 - 70, 0, -Math.floor(i / 10) * 25 - 10);
    b.add(i % 3 ? gid : gid2, M4, col, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
  b.end();
  b.mesh.updateMatrixWorld(true);
  const cam = new PerspectiveCamera(50, 1.6, 0.5, 2000);
  cam.position.set(0, 20, 30); cam.lookAt(0, 0, -60); cam.updateMatrixWorld(true);
  const m = b.mesh as M;
  const a1 = oursSet(b, cam);
  const v1 = m._indirectTexture.version;
  assert.deepEqual([...a1].sort((x, y) => x - y), [...threeSet(b, cam)].sort((x, y) => x - y));
  assert.ok(a1.size > 5 && a1.size < 60, `some culled: ${a1.size}`);
  // a narrower view, a shadow-cascade cull (hide every 4th), an orthographic light box: same sets, no table upload
  const cam2 = new PerspectiveCamera(20, 1, 0.5, 300);
  cam2.position.set(-40, 10, 0); cam2.lookAt(-40, 0, -100); cam2.updateMatrixWorld(true);
  assert.deepEqual([...oursSet(b, cam2)].sort((x, y) => x - y), [...threeSet(b, cam2)].sort((x, y) => x - y));
  b.cullShadow((x) => Math.round(x) % 4 !== 0);
  const light = new OrthographicCamera(-60, 60, 60, -60, 0.5, 500);
  light.position.set(30, 200, -60); light.lookAt(30, 0, -60); light.updateMatrixWorld(true);
  const s3 = oursSet(b, light);
  assert.deepEqual([...s3].sort((x, y) => x - y), [...threeSet(b, light)].sort((x, y) => x - y));
  b.uncull();
  assert.equal(m._indirectTexture.version, v1, 'the table is not re-uploaded per pass');
  // multi-draw starts point at each instance's geometry (the first view again)
  assert.deepEqual([...oursSet(b, cam)].sort((x, y) => x - y), [...a1].sort((x, y) => x - y));
  const bpe = m.geometry.getIndex()!.array.BYTES_PER_ELEMENT;
  for (const i of a1) assert.ok(m._multiDrawStarts[i] % bpe === 0 && m._multiDrawCounts[i] > 0);
});
