// PERF F21 — building batches keep their geometry in FIXED-SIZE pages: panning through towns (per-building geometries
// added and dropped all the time) never re-creates a GPU buffer at a new size, compacts pages in place, and every live
// geometry's vertices / indices in its page stay exactly the source's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchedMesh, BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, Matrix4 } from 'three';
import { BldBatch } from '../src/render/life/bldbatch.ts';

/** a building-like geometry (the attributes meshkit makes) of about `n` boxes */
function geo(n: number, seed: number): BufferGeometry {
  const b = new BoxGeometry(1 + (seed % 7), 2 + (seed % 3), 1 + (seed % 5), n, 1, 1);
  const nv = b.getAttribute('position').count;
  const col = new Float32Array(nv * 3).map((_, i) => ((i * 31 + seed) % 97) / 97);
  const kit = new Float32Array(nv * 4).map((_, i) => ((i * 17 + seed) % 89) / 89);
  b.setAttribute('color', new Float32BufferAttribute(col, 3));
  b.setAttribute('aKit', new Float32BufferAttribute(kit, 4));
  return b;
}

type BM = BatchedMesh & { _geometryInfo: { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number; active: boolean }[] };

/** the page holds `g` exactly where its geometry info says */
function holds(m: BM, id: number, g: BufferGeometry): void {
  const gi = m._geometryInfo[id];
  assert.ok(gi.active);
  for (const key of ['position', 'normal', 'color', 'uv', 'aKit']) {
    const src = g.getAttribute(key).array as Float32Array, dst = m.geometry.getAttribute(key);
    const it = dst.itemSize;
    for (let i = 0; i < src.length; i++) if (dst.array[gi.vertexStart * it + i] !== src[i]) assert.fail(`${key}[${i}] differs`);
  }
  const si = g.index!.array, di = m.geometry.index!.array;
  for (let i = 0; i < si.length; i++) if (di[gi.indexStart + i] !== si[i] + gi.vertexStart) assert.fail(`index ${i} differs`);
}

test('F21: per-building geometries churned through fixed pages: no resize, in-place compaction, exact contents', () => {
  const b = new BldBatch('t', {}, false, true, 64, 1 << 16);
  const sizeOf = (m: BatchedMesh) => Object.values(m.geometry.attributes).map((a) => a.array.length).join(',') + '|' + m.geometry.index!.array.length;
  let pageSize = '';
  const arrays = new Map<BatchedMesh, unknown>();
  const live: BufferGeometry[] = [];
  let seed = 1, maxPages = 1;
  const M = new Matrix4(), C = new Color(1, 1, 1);
  for (let round = 0; round < 60; round++) {
    // a camera move: ~30 new per-building geometries, ~30 old ones dropped (a town left behind)
    for (let i = 0; i < 30; i++) { const g = geo(1 + (seed % 9), seed++); live.push(g); b.geom(g); }
    while (live.length > 120) { const g = live.splice((seed * 7) % live.length, 1)[0]; b.dropGeom(g); seed++; }
    b.begin();
    for (const g of live) b.add(b.geom(g), M, C, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    b.end();
    maxPages = Math.max(maxPages, b.pages.length);
    for (const p of b.pages) {
      const a = p.mesh.geometry.getAttribute('position').array;
      if (arrays.has(p.mesh)) assert.equal(arrays.get(p.mesh), a, 'a page never re-creates its arrays');
      arrays.set(p.mesh, a);
      if (!pageSize) pageSize = sizeOf(p.mesh);
      assert.equal(sizeOf(p.mesh), pageSize, 'every page the same buffer sizes');
    }
  }
  // 120 live geometries of <= ~10 boxes (<= 240 verts each) fit in a few 16 k-vertex pages: the batch does not leak pages
  assert.ok(maxPages <= 4, `pages ${maxPages}`);
  // every live geometry is held exactly, and every instance draws its own geometry
  for (const g of live) {
    const gid = b.geom(g);
    const p = b.pages[Math.floor(gid / (1 << 20))];
    holds(p.mesh as BM, gid % (1 << 20), g);
  }
  b.dispose();
});

test('F21: dropping a page\'s last geometry keeps its instances hidden, then frees it when the page takes another', () => {
  const b = new BldBatch('t', {}, false, true, 16, 1 << 15);
  const g1 = geo(2, 3), g2 = geo(3, 4);
  b.begin();
  const s = b.add(b.geom(g1), new Matrix4(), new Color(), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  b.end();
  const p = b.pages[0], m = p.mesh as BM & { _instanceInfo: { visible: boolean; active: boolean }[] };
  b.dropGeom(g1);
  assert.equal(m._instanceInfo[s].active, true, 'the slot survives');
  assert.equal(m._instanceInfo[s].visible, false, 'hidden until the next rewrite');
  const id2 = b.geom(g2);
  assert.equal(m._geometryInfo.filter((x) => x.active).length, 1, 'the dropped geometry is gone once another arrived');
  b.begin();
  b.add(id2, new Matrix4(), new Color(), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  b.end();
  assert.equal(m._instanceInfo[s].visible, true);
  holds(m as unknown as BM, id2 % (1 << 20), g2);
  b.dispose();
});
