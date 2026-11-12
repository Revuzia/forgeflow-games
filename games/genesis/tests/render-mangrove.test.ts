// PERF s13 (owner: 'water over the hills east of the town, trunks as ghosts'): the sea shallows south-east of Rubolhin
// carry the sim's mangrove stand (species 'mangrove', habitat shore, water 0-2 m). The scatter refused every point in
// water, so the stand never stood: only dark shapes under the sheet. Shore trees now stand in water up to their depth;
// other trees (and every shrub) still never stand in water. (The sea bed there is sand, 0.6: the beach rule refused them too.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import { GroundGradients } from '../src/client/groundgrad.ts';
import { Vegetation } from '../src/render/life/vegetation.ts';
import { BASE_PACK } from '../src/data/index.ts';

const SHARED = { uTime: { value: 0 }, uWindDir: { value: null }, uCamBody: { value: null }, uBodyToView: { value: null }, uSunDirBody: { value: null } } as never;
type V = { cellPlants(pv: unknown, c: number): Float32Array };

function world(species: number, depth: number) {
  const grid = getGrid(24), n = grid.count, R = 3000;
  const f = (v: number) => new Float32Array(n).fill(v);
  const fields = new Map<string, Float32Array>();
  fields.set('tree', f(0.9)); fields.set('shrub', f(0)); fields.set('burnt', f(0)); fields.set('water', f(depth));
  fields.set('temperature', f(27)); fields.set('moisture', f(0.9)); fields.set('snow', f(0)); fields.set('crop', f(0));
  fields.set('road', f(0)); fields.set('sand', f(0.6)); fields.set('soil', f(0.4)); fields.set('treeSpecies', f(species)); fields.set('shrubSpecies', f(-1));
  const surface = f(-depth);
  fields.set('surface', surface);
  const gg = new GroundGradients(grid);
  gg.update(surface, R);
  const noise = new Noise3(5);
  return { grid, noise, params: { radius: R }, fields, fieldVersion: new Map([['surface', 1]]), groundRev: gg,
    ground: { grid, radius: R, noise, surface, soil: fields.get('soil')!, sand: fields.get('sand')!, snow: fields.get('snow')!, grad: gg.grad } };
}
const plants = (BASE_PACK.plants ?? []) as { id: string }[];
const idx = (id: string) => plants.findIndex((p) => p.id === id);
const count = (sp: number, depth: number) => { const pv = world(sp, depth); const v = new Vegetation(SHARED) as unknown as V; let k = 0; for (let c = 0; c < 200; c++) k += v.cellPlants(pv, c * 7).length / 10; return k; };

test('a mangrove stand stands in its shallow water; a broadleaf wood never stands in water', () => {
  const mg = idx('mangrove'), oak = plants.findIndex((p) => (p as { type?: string; habitat?: string }).type === 'tree' && (p as { habitat?: string }).habitat === 'land');
  assert.ok(mg >= 0 && oak >= 0);
  assert.ok(count(mg, 1.2) > 200, `mangroves in 1.2 m: ${count(mg, 1.2)}`);
  assert.equal(count(oak, 1.2), 0, 'no land tree in 1.2 m of water');
  // deeper than the mangrove's water band: none
  assert.equal(count(mg, 3.5), 0);
});
