// PERF F9 — vegetation keeps the cached plants of the cells a new ground did not touch (src/render/life/vegetation.ts
// groundChanged): after random changes to the heights and to the other fields the plants read, every cell still in
// the cache must hold exactly what a fresh scatter of the current world makes (a stale cell = trees in a new lake).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import { GroundGradients } from '../src/client/groundgrad.ts';
import { Vegetation } from '../src/render/life/vegetation.ts';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const SHARED = { uTime: { value: 0 }, uWindDir: { value: null }, uCamBody: { value: null }, uBodyToView: { value: null }, uSunDirBody: { value: null } } as never;
type V = { cellPlants(pv: unknown, c: number): Float32Array; groundChanged(pv: unknown): void; cache: Map<number, Float32Array> };

test('cells kept across a ground change equal a fresh scatter', () => {
  const grid = getGrid(24), n = grid.count, R = 3000, r = rng(3);
  const f = (gen: (c: number) => number) => Float32Array.from({ length: n }, (_, c) => gen(c));
  const fields = new Map<string, Float32Array>();
  fields.set('tree', f(() => r())); fields.set('shrub', f(() => r() * 0.6)); fields.set('burnt', f(() => 0));
  fields.set('water', f(() => (r() < 0.1 ? 3 : 0))); fields.set('temperature', f(() => 12)); fields.set('moisture', f(() => 0.6));
  fields.set('snow', f(() => 0)); fields.set('crop', f(() => (r() < 0.1 ? 0.8 : 0))); fields.set('road', f(() => 0));
  fields.set('sand', f(() => 0)); fields.set('soil', f(() => 0.5)); fields.set('treeSpecies', f(() => -1)); fields.set('shrubSpecies', f(() => -1));
  let surface = f((c) => 50 + 30 * Math.sin(grid.pos[c * 3] * 11));
  fields.set('surface', surface);
  const gg = new GroundGradients(grid);
  gg.update(surface, R);
  const noise = new Noise3(5);
  const pv = {
    grid, noise, params: { radius: R }, fields, fieldVersion: new Map([['surface', 1]]), groundRev: gg,
    ground: { grid, radius: R, noise, surface, soil: fields.get('soil')!, sand: fields.get('sand')!, snow: fields.get('snow')!, grad: gg.grad },
  };
  const veg = new Vegetation(SHARED) as unknown as V;
  veg.groundChanged(pv);
  const cells = Array.from({ length: 300 }, (_, i) => (i * 37) % n);
  for (const c of cells) veg.cellPlants(pv, c);
  veg.groundChanged(pv); // a check with nothing changed keeps everything (the young cells go once)
  for (const c of cells) veg.cellPlants(pv, c);
  for (let round = 0; round < 4; round++) {
    surface = Float32Array.from(surface);
    for (let k = 0; k < 5; k++) surface[Math.floor(r() * n)] += 8;
    gg.update(surface, R);
    fields.set('surface', surface); pv.ground.surface = surface; pv.ground.grad = gg.grad;
    const w = Float32Array.from(fields.get('water')!);
    for (let k = 0; k < 5; k++) w[Math.floor(r() * n)] = 4;
    fields.set('water', w);
    veg.groundChanged(pv);
    const kept = [...veg.cache.keys()];
    assert.ok(kept.length > 100 && kept.length < cells.length, `round ${round}: kept ${kept.length} of ${cells.length}`);
    const fresh = new Vegetation(SHARED) as unknown as V;
    for (const c of kept) assert.deepEqual(veg.cache.get(c), fresh.cellPlants(pv, c), `round ${round}: cell ${c} is stale`);
    for (const c of cells) veg.cellPlants(pv, c);
    veg.groundChanged(pv);
  }
});
