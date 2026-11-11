// PERF (session 5) — incremental road rebuilds (src/render/life/roads.ts): a chain whose inputs (samples, wear, dense
// stretches near the camera, dead ends, tier / era, nearby footprints, the ground and water of its cells) did not
// change keeps its built ribbon; and each chain tests only the footprints near it. Checks, on a synthetic town:
//   - a fresh build with local footprints equals one where every chain tests every footprint (the old rule);
//   - the per-chain normals equal three's computeVertexNormals over the whole ribbon (the old code's normals);
//   - after a run of changes (ground under one street, a new house, the camera moving 130 m, wear), the kept-chains
//     ribbon equals a fresh build at the final state, byte for byte, lamps included, while rebuilding fewer chains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, BufferGeometry } from 'three';
import { Roads } from '../src/render/life/roads.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';

const R = 3000;
const grid = getGrid(96);
const n = grid.count;
const P = [0.31, 0.83, 0.46];
{ const l = Math.hypot(P[0], P[1], P[2]); P[0] /= l; P[1] /= l; P[2] /= l; }

function world() {
  const surface = new Float32Array(n), z = new Float32Array(n), road = new Float32Array(n), water = new Float32Array(n);
  // three streets through P: cells within ~9 m of three great circles through it, out to 450 m
  const axes = [[0, 0, 1], [1, 0, 0], [0.5, -0.6, 0.62]].map((a) => {
    const c = [P[1] * a[2] - P[2] * a[1], P[2] * a[0] - P[0] * a[2], P[0] * a[1] - P[1] * a[0]];
    const l = Math.hypot(c[0], c[1], c[2]); return c.map((x) => x / l);
  });
  for (let c = 0; c < n; c++) {
    const x = grid.pos[c * 3], y = grid.pos[c * 3 + 1], w = grid.pos[c * 3 + 2];
    surface[c] = 20 + 6 * Math.sin(x * 400) * Math.cos(w * 300);
    const d = Math.acos(Math.min(1, x * P[0] + y * P[1] + w * P[2])) * R;
    if (d > 450) continue;
    for (const a of axes) if (Math.abs(x * a[0] + y * a[1] + w * a[2]) * R < 9) road[c] = 0.75 + 0.2 * Math.sin(d * 0.05);
  }
  const ground = { grid, radius: R, noise: new Noise3(7), surface, soil: z, sand: new Float32Array(n), snow: z, grad: null };
  const fields = new Map<string, Float32Array>([['road', road], ['water', water]]);
  const fieldVersion = new Map<string, number>([['road', 1], ['surface', 1]]);
  const pv = { fields, fieldVersion, grid, ground, params: { radius: R }, maxSurface: 30, settlements: [{ pos: P, era: 'medieval' }] };
  const foot: [number, number, number, number][] = [];
  // houses along the streets, set back 7 m
  for (let k = 0; k < 40; k++) {
    const c = [...road.keys()].filter((i) => road[i] > 0)[k * 7 % 200] ?? 0;
    const u = [grid.pos[c * 3], grid.pos[c * 3 + 1], grid.pos[c * 3 + 2]];
    const off = 7 / R;
    const v = [u[0] + off * 0.6, u[1] - off * 0.5, u[2] + off * 0.62];
    const l = Math.hypot(v[0], v[1], v[2]);
    foot.push([v[0] / l * (R + 22), v[1] / l * (R + 22), v[2] / l * (R + 22), 3.5]);
  }
  const buildings = { layoutVersion: 1, footprints: () => foot };
  return { pv, buildings, foot, surface, road, water, fieldVersion };
}

type G = { attributes: Record<string, { array: Float32Array; itemSize: number }>; index: { array: Uint32Array } | null; drawRange: { count: number } };
/** the drawn part of a ribbon (PERF F18: buffers are kept at a power-of-two capacity, the draw range bounds the draw) */
const trim = (g: G): G => {
  if (!g.index) return g;
  const I = g.index.array.slice(0, Math.min(g.index.array.length, g.drawRange.count));
  let nv = 0;
  for (let i = 0; i < I.length; i++) nv = Math.max(nv, I[i] + 1);
  const attributes: G['attributes'] = {};
  for (const [k, a] of Object.entries(g.attributes)) attributes[k] = { array: a.array.slice(0, nv * a.itemSize), itemSize: a.itemSize };
  return { attributes, index: { array: I }, drawRange: { count: I.length } };
};
const geoOf = (r: Roads) => {
  const x = r as unknown as { dirt: { geometry: G }; paved: { geometry: G }; lampsAll: unknown[] };
  return { dirt: trim(x.dirt.geometry), paved: trim(x.paved.geometry), lamps: JSON.stringify(x.lampsAll) };
};
/** typed arrays equal (a first differing index, not node's diff of 20 000 numbers: that runs out of memory) */
const eqArr = (x: ArrayLike<number> | null, y: ArrayLike<number> | null, what: string) => {
  if (x === null || y === null) { assert.equal(x === null, y === null, `${what}: one is missing`); return; }
  assert.equal(y.length, x.length, `${what}: length`);
  for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) assert.fail(`${what}: [${i}] ${y[i]} != ${x[i]}`);
};
const same = (a: ReturnType<typeof geoOf>, b: ReturnType<typeof geoOf>, what: string) => {
  for (const k of ['dirt', 'paved'] as const) {
    const ga = a[k], gb = b[k];
    assert.deepEqual(Object.keys(gb.attributes).sort(), Object.keys(ga.attributes).sort(), `${what} ${k} attributes`);
    for (const nm of Object.keys(ga.attributes)) eqArr(ga.attributes[nm].array, gb.attributes[nm].array, `${what} ${k}.${nm}`);
    eqArr(ga.index?.array ?? null, gb.index?.array ?? null, `${what} ${k} index`);
  }
  assert.ok(b.lamps === a.lamps, `${what} lamps differ (${a.lamps.length} vs ${b.lamps.length} chars)`);
};
const camAt = (t: number): [number, number, number] => {
  const q = [P[0] + t * 0.8, P[1] - t * 0.3, P[2] + t * 0.1];
  const l = Math.hypot(q[0], q[1], q[2]);
  return [q[0] / l * (R + 140), q[1] / l * (R + 140), q[2] / l * (R + 140)];
};

test('road ribbons: local footprints, per-chain normals, and kept chains build the same bytes', () => {
  const w = world();
  const fresh = (cam: [number, number, number]) => { const r = new Roads({}); r.update(w.pv as never, cam[0], cam[1], cam[2], w.buildings as never); return r; };
  // 1. local footprints = all footprints
  const c0 = camAt(0);
  const a = fresh(c0);
  Roads.localFootprints = false;
  const b = fresh(c0);
  Roads.localFootprints = true;
  same(geoOf(a), geoOf(b), 'local vs all footprints');
  assert.ok(a.stats.chains >= 3 && a.stats.verts > 500 && a.stats.lamps > 0, JSON.stringify(a.stats));
  // 2. normals = three over the whole ribbon
  for (const k of ['dirt', 'paved'] as const) {
    const g = geoOf(a)[k];
    if (!g.index) continue;
    const bg = new BufferGeometry();
    bg.setAttribute('position', new BufferAttribute(g.attributes.position.array, 3));
    bg.setIndex(new BufferAttribute(g.index.array, 1));
    bg.computeVertexNormals();
    eqArr(bg.getAttribute('normal').array as Float32Array, g.attributes.normal.array, `${k} normals`);
  }
  // 3. a run of changes on two Roads side by side: one keeps chains, one rebuilds every chain (the old rule; both
  //    carry the same wear hysteresis), compared after every update
  const inc = fresh(c0);
  Roads.keepChains = false;
  const ref = fresh(c0);
  Roads.keepChains = true;
  let kept = 0;
  const step = (cam: [number, number, number], f: () => void, what: string) => {
    f();
    w.fieldVersion.set('surface', (w.fieldVersion.get('surface') ?? 0) + 1);
    inc.update(w.pv as never, cam[0], cam[1], cam[2], w.buildings as never);
    Roads.keepChains = false;
    ref.update(w.pv as never, cam[0], cam[1], cam[2], w.buildings as never);
    Roads.keepChains = true;
    kept += inc.stats.chains - inc.stats.rebuiltChains;
    if (process.env.ROAD_LOG) console.log(what, inc.stats.chains, inc.stats.rebuiltChains);
    same(geoOf(ref), geoOf(inc), what);
  };
  // (the first rebuild after the first build re-reads every chain: the wear hysteresis lifts the drawn ways' wear)
  step(c0, () => {}, 'settle');
  // the ground rises under some street cells
  step(c0, () => { let k = 0; for (let c = 0; c < n; c++) if (w.road[c] > 0 && (k++ % 5) === 0) w.surface[c] += 1.5; }, 'ground');
  // a new house
  step(c0, () => { const f = w.foot[3]; w.foot.push([f[0] + 4, f[1] - 3, f[2] + 2, 3]); w.buildings.layoutVersion++; }, 'house');
  // the camera moves 130 m (the dense stretches move)
  const c1 = camAt(130 / R);
  step(c1, () => {}, 'camera');
  // a pond on a street cell; wear changes on another
  step(c1, () => { let k = 0; for (let c = 0; c < n; c++) if (w.road[c] > 0) { if (k === 0) w.water[c] = 0.6; if (k === 9) w.road[c] = 0.3; k++; } w.fieldVersion.set('road', 2); }, 'water + wear');
  // the camera back (the cache still holds the chains of the first view? no: only those drawn last time)
  step(c0, () => {}, 'camera back');
  assert.ok(kept > 0, `some chains were kept (${kept})`);
  if (process.env.ROAD_LOG) console.log('chains', inc.stats.chains, 'kept over the run', kept);
});
