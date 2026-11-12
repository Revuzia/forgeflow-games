// GENESIS — PERF s15 cut #8: the near trees' and the ground cover's instance pools start small and double, on demand,
// up to the same caps as before (the same instances drawn), keeping their contents; each tree bucket has its own
// geometry (its own iExtra; the cached tree geometry is not touched), and a grow frees the old instance buffers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial } from 'three';
import { Vegetation, LAZY_POOLS } from '../src/render/life/vegetation.ts';
import { gcRoom } from '../src/render/life/groundcover.ts';
import { treeGeometry } from '../src/render/gen/treegen.ts';

const SHARED = { uTime: { value: 0 }, uWindDir: { value: null }, uCamBody: { value: null }, uBodyToView: { value: null }, uSunDirBody: { value: null } } as never;
type B = { mesh: InstancedMesh; extra: InstancedBufferAttribute; dist: Float32Array; count: number; max: number; lod: number; kind: number; variant: number };
type V = { buckets: B[]; room(b: B): boolean; nearCapacity(): { cap: number; max: number }; nearGrows: number; dispose(): void };

test('PERF s15 #8: near tree pools start small, grow x2 to the old caps, keep contents, free old buffers', () => {
  assert.equal(LAZY_POOLS, true);
  const veg = new Vegetation(SHARED) as unknown as V;
  const c0 = veg.nearCapacity();
  assert.ok(c0.cap * 10 < c0.max, `starts small: ${c0.cap} of ${c0.max}`);
  for (const b of veg.buckets) {
    assert.equal(b.mesh.geometry.getAttribute('iExtra'), b.extra, 'own iExtra');
  }
  // no bucket shares its geometry (or its iExtra) with another
  assert.equal(new Set(veg.buckets.map((b) => b.mesh.geometry)).size, veg.buckets.length);
  const b = veg.buckets.find((x) => x.lod === 2)!;
  let n = 0;
  for (;;) {
    const before = b.mesh;
    if (!veg.room(b)) break;
    if (b.mesh !== before) {
      assert.equal(before.parent, null, 'old mesh left the scene');
      assert.ok(b.mesh.parent, 'new mesh in the scene');
      // (the old geometry kept only its own iExtra, then was disposed)
      assert.equal(before.geometry.getAttribute('position'), undefined);
      for (let i = 0; i < n; i++) {
        assert.equal((b.mesh.instanceMatrix.array as Float32Array)[i * 16 + 12], i, 'matrix kept');
        assert.equal((b.mesh.instanceColor!.array as Float32Array)[i * 3], Math.fround(i / 10000), 'colour kept');
        assert.equal((b.extra.array as Float32Array)[i * 4 + 3], i + 0.5, 'extra kept');
        assert.equal(b.dist[i], i * 2, 'distance kept');
      }
    }
    (b.mesh.instanceMatrix.array as Float32Array)[n * 16 + 12] = n;
    (b.mesh.instanceColor!.array as Float32Array)[n * 3] = n / 10000;
    (b.extra.array as Float32Array)[n * 4 + 3] = n + 0.5;
    b.dist[n] = n * 2;
    b.count = ++n;
  }
  assert.equal(n, b.max, 'fills to exactly the old cap');
  assert.equal(b.mesh.instanceMatrix.count, b.max);
  // the cached tree geometry got no iExtra of a bucket's
  const tg = treeGeometry('conifer' as never, 2, 0);
  assert.ok(!veg.buckets.some((x) => x.extra === tg.getAttribute('iExtra')));
  veg.dispose();
});

test('PERF s15 #8: ground cover pools grow x2 to their cap keeping their instances', () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('iExtra', new InstancedBufferAttribute(new Float32Array([0, 0, 0, 1]), 4, false, 1500));
  const m = new InstancedMesh(g, new MeshBasicMaterial(), 256);
  m.userData.max = 1500;
  m.instanceColor = new InstancedBufferAttribute(new Float32Array(256 * 3).fill(1), 3);
  let disposed = 0;
  m.addEventListener('dispose', () => { disposed++; });
  let n = 0;
  while (gcRoom(m, n)) { (m.instanceMatrix.array as Float32Array)[n * 16] = n; (m.instanceColor.array as Float32Array)[n * 3 + 1] = n; n++; }
  assert.equal(n, 1500);
  assert.equal(m.instanceMatrix.count, 1500);
  assert.ok(disposed >= 3, `old buffers freed on each grow (${disposed})`);
  for (let i = 0; i < n; i++) { assert.equal((m.instanceMatrix.array as Float32Array)[i * 16], i); assert.equal((m.instanceColor!.array as Float32Array)[i * 3 + 1], i); }
  // the geometry (and its single iExtra) is kept
  assert.equal(m.geometry, g);
});
