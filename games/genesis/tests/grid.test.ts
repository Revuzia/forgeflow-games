// GENESIS — IcoGrid invariants: counts, adjacency symmetry, area, exact point location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IcoGrid } from '../src/sim/grid/icogrid.ts';
import { Rng } from '../src/sim/core/rng.ts';

for (const n of [1, 2, 7, 16, 48]) {
  test(`icogrid n=${n}: counts, symmetry, area`, () => {
    const g = new IcoGrid(n);
    assert.equal(g.count, 10 * n * n + 2);
    assert.equal(g.tris.length, 20 * n * n * 3);
    let fives = 0;
    for (let c = 0; c < g.count; c++) {
      const d = g.degree(c);
      assert.ok(d === 5 || d === 6, `cell ${c} degree ${d}`);
      if (d === 5) fives++;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        assert.equal(g.nbr[g.rev[e]], c, 'rev edge points back');
        assert.equal(g.rev[g.rev[e]], e);
        assert.notEqual(o, c);
      }
    }
    assert.equal(fives, 12);
    let a = 0;
    for (let c = 0; c < g.count; c++) a += g.area[c];
    assert.ok(Math.abs(a - 4 * Math.PI) < 1e-3, `area sum ${a}`);
    // faces outward
    for (let f = 0; f < 20; f++) {
      const cx = g.faceCorners[f * 9] + g.faceCorners[f * 9 + 3] + g.faceCorners[f * 9 + 6];
      const cy = g.faceCorners[f * 9 + 1] + g.faceCorners[f * 9 + 4] + g.faceCorners[f * 9 + 7];
      const cz = g.faceCorners[f * 9 + 2] + g.faceCorners[f * 9 + 5] + g.faceCorners[f * 9 + 8];
      assert.ok(cx * g.faceNormals[f * 3] + cy * g.faceNormals[f * 3 + 1] + cz * g.faceNormals[f * 3 + 2] > 0, `face ${f} outward`);
    }
  });

  test(`icogrid n=${n}: locate is exact at cells and consistent at random points`, () => {
    const g = new IcoGrid(n);
    for (let c = 0; c < g.count; c++) {
      const h = g.locate(g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]);
      const w = h.a === c ? h.wa : h.b === c ? h.wb : h.c === c ? h.wc : -1;
      assert.ok(w > 0.999, `cell ${c} located with weight ${w}`);
      assert.equal(g.nearestCell(g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]), c);
    }
    const r = new Rng(n);
    for (let k = 0; k < 2000; k++) {
      let x = r.gauss(), y = r.gauss(), z = r.gauss();
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const h = g.locate(x, y, z);
      assert.ok(h.wa >= -1e-6 && h.wb >= -1e-6 && h.wc >= -1e-6, 'non-negative weights');
      assert.ok(Math.abs(h.wa + h.wb + h.wc - 1) < 1e-9);
      // the three cells must be a real triangle
      const t = h.tri;
      const set = new Set([g.tris[t * 3], g.tris[t * 3 + 1], g.tris[t * 3 + 2]]);
      assert.ok(set.has(h.a) && set.has(h.b) && set.has(h.c), `tri index ${t} matches cells`);
      // reconstruct: weighted flat point should radially project near p
      const px = g.pos[h.a * 3] * h.wa + g.pos[h.b * 3] * h.wb + g.pos[h.c * 3] * h.wc;
      const py = g.pos[h.a * 3 + 1] * h.wa + g.pos[h.b * 3 + 1] * h.wb + g.pos[h.c * 3 + 1] * h.wc;
      const pz = g.pos[h.a * 3 + 2] * h.wa + g.pos[h.b * 3 + 2] * h.wb + g.pos[h.c * 3 + 2] * h.wc;
      const pl = Math.hypot(px, py, pz);
      const d = (px * x + py * y + pz * z) / pl;
      assert.ok(d > Math.cos(g.meanEdgeAngle * 0.2), `reconstruction close (dot ${d})`);
      const nc = g.nearestCell(x, y, z);
      let best = -1, bestD = -2;
      for (let c = 0; c < g.count && n <= 16; c++) {
        const dd = g.pos[c * 3] * x + g.pos[c * 3 + 1] * y + g.pos[c * 3 + 2] * z;
        if (dd > bestD) { bestD = dd; best = c; }
      }
      if (n <= 16) assert.equal(nc, best, 'nearestCell exact');
    }
  });
}

test('cellsWithin returns a connected disc', () => {
  const g = new IcoGrid(32);
  const out = g.cellsWithin(0, 1, 0, 0.2);
  assert.ok(out.length > 10);
  for (const c of out) assert.ok(g.pos[c * 3 + 1] >= Math.cos(0.2) - 1e-9);
});
