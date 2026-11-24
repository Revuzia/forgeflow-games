// Baked light/atmosphere mesh (src/render/fx.js): quads are stored in importance bands so a quality
// tier can draw fewer of them with a draw range, and a tube is built so its near wall can be drawn alone.

import { test, assert, eq } from './lib/harness.js';
import { FxBuilder, FX } from '../src/render/fx.js';
import { GeoBuilder } from '../src/render/geo.js';

const Y = [0, 1, 0];
const col = [1, 1, 1];

function sample() {
  const fx = new FxBuilder();
  // deliberately interleaved: pool, shaft, beacon, haze, pool, heat volume
  fx.quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], Y, col, FX.POOL, 0, 2);
  fx.tube([0, 0, 0], Y, 5, 1, 1, col, FX.SHAFT, 0, 0, 4);
  fx.tube([3, 0, 0], Y, 5, 0.3, 0.3, col, FX.BEACON, 0, 0, 4);
  fx.crossed(5, 0, 5, 2, 3, col, FX.HAZE, 0);
  fx.quad([4, 0, 0], [5, 0, 0], [5, 0, 1], [4, 0, 1], Y, col, FX.POOL, 0, 2);
  fx.volume([8, 0, 0, 10, 2, 2], col, FX.HEAT, 0);
  return fx;
}

test('fx: quads are ordered essential -> light pools -> atmosphere, with ranges a tier can draw', () => {
  const fx = sample();
  const total = fx.idx.length;
  const mesh = fx.build(0.02);
  const [essential, withPools, all] = mesh.userData.fxRanges;
  eq(all, total, 'the last range draws everything');
  assert(essential > 0 && essential < withPools && withPools < all, `ranges must grow: ${essential} < ${withPools} < ${all}`);
  const par = mesh.geometry.attributes.aParam, idx = mesh.geometry.index.array;
  const kindAt = (i) => par.getX(idx[i]);
  for (let i = 0; i < essential; i++) assert([FX.BEACON, FX.HEAT, FX.COLD, FX.WIND].includes(kindAt(i)), `index ${i} in the essential band has kind ${kindAt(i)}`);
  for (let i = essential; i < withPools; i++) eq(kindAt(i), FX.POOL, `index ${i} in the pool band`);
  for (let i = withPools; i < all; i++) assert([FX.SHAFT, FX.HAZE].includes(kindAt(i)), `index ${i} in the atmosphere band has kind ${kindAt(i)}`);
});

test('fx: reordering the bands keeps every triangle (6 indices per quad) whole', () => {
  const mesh = sample().build(0.02);
  const idx = mesh.geometry.index.array;
  eq(idx.length % 6, 0);
  for (let q = 0; q < idx.length; q += 6) {
    // both triangles of a quad point at the same 4 vertices
    const vs = new Set(idx.slice(q, q + 6));
    eq(vs.size, 4, `quad at ${q} must use exactly 4 vertices`);
  }
});

test('geo: GeoBuilder.append copies geometry under a transform (used to fold posed props into the merged mesh)', async () => {
  const THREE = await import('../vendor/three.module.min.js');
  const a = new GeoBuilder().box(0, 0, 0, 1, 1, 1, { uvSize: 1 });
  const b = new GeoBuilder();
  b.append(a, new THREE.Matrix4().makeTranslation(10, 0, 0));
  b.append(a, new THREE.Matrix4().makeRotationY(Math.PI / 2));
  eq(b.n, a.n * 2);
  eq(b.idx.length, a.idx.length * 2);
  assert(Math.min(...b.idx.slice(a.idx.length)) >= a.n, 'the second copy indexes its own vertices');
  assert(Math.abs(b.pos[0] - 10) < 1e-9 || Math.abs(b.pos[0] - (a.pos[0] + 10)) < 1e-9, 'first copy is moved by +10 in x');
  const g = b.build();
  g.computeBoundingBox();
  assert(g.boundingBox.max.x >= 11 - 1e-6, 'the translated box reaches x = 11');
});

test('geo: cylinder caps can be left off ("top" builds half as many cap triangles as true)', () => {
  const both = new GeoBuilder().cylinder(0, 0, 0, 1, 1, 1, 8, 0xffffff, { caps: true });
  const top = new GeoBuilder().cylinder(0, 0, 0, 1, 1, 1, 8, 0xffffff, { caps: 'top' });
  const none = new GeoBuilder().cylinder(0, 0, 0, 1, 1, 1, 8, 0xffffff, { caps: false });
  eq(both.idx.length / 3, 8 * 2 + 8 + 8);
  eq(top.idx.length / 3, 8 * 2 + 8);
  eq(none.idx.length / 3, 8 * 2);
});
