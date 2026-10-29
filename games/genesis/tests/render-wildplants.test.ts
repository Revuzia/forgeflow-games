// The wild grass-layer species the sim grows (grassSpecies) — what a band forages — draw with their own looks, not
// as plain meadow grass: wild grains as their crop form standing wild, mushrooms, herbs, tussocks, moss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_PACK } from '../src/data/index.ts';
import { GroundCover, WILD_HERB, WILD_MOSS, WILD_MUSHROOM, WILD_NONE, WILD_TUSSOCK, wildLookAt, wildLookOf } from '../src/render/life/groundcover.ts';
import { CROP_TYPES } from '../src/render/gen/groundgen.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import type { PlanetView } from '../src/client/worldview.ts';

const plants = BASE_PACK.plants ?? [];
const idx = (id: string): number => plants.findIndex((p) => p.id === id);

test('every grass-layer species but plain grass and reeds has its own ground-cover look', () => {
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i] as { id?: string; type?: string; form?: string };
    if (p.type !== 'grass') { assert.equal(wildLookAt(i), WILD_NONE, `${p.id}: not a grass-layer species`); continue; }
    const plain = p.form === 'grass' || p.form === 'reed';
    if (plain) assert.equal(wildLookAt(i), WILD_NONE, `${p.id} is plain sward`);
    else assert.notEqual(wildLookAt(i), WILD_NONE, `${p.id} (${p.form}) draws as plain grass`);
  }
});

test('wild grains stand as the crop they are the wild form of', () => {
  const crop = (id: string) => CROP_TYPES[wildLookAt(idx(id))];
  if (idx('wild-grain') >= 0) assert.equal(crop('wild-grain'), 'wheat');
  if (idx('wild-rice') >= 0) assert.equal(crop('wild-rice'), 'rice');
  if (idx('teosinte') >= 0) assert.equal(crop('teosinte'), 'maize');
  if (idx('wild-barley') >= 0) assert.equal(crop('wild-barley'), 'barley');
  if (idx('wild-sorghum') >= 0) assert.equal(crop('wild-sorghum'), 'sorghum');
  if (idx('wild-lentil') >= 0) assert.equal(crop('wild-lentil'), 'lentil');
  if (idx('wild-potato') >= 0) assert.equal(crop('wild-potato'), 'potato');
  if (idx('mushrooms') >= 0) assert.equal(wildLookAt(idx('mushrooms')), WILD_MUSHROOM);
  if (idx('wild-herbs') >= 0) assert.equal(wildLookAt(idx('wild-herbs')), WILD_HERB);
  if (idx('savanna-grass') >= 0) assert.equal(wildLookAt(idx('savanna-grass')), WILD_TUSSOCK);
  if (idx('moss-lichen') >= 0) assert.equal(wildLookAt(idx('moss-lichen')), WILD_MOSS);
  // shrubs and trees keep their vegetation forms (wild cotton is a bush)
  assert.equal(wildLookOf({ type: 'shrub', form: 'bush', id: 'wild-cotton' }), WILD_NONE);
});

// A wild grain cell draws its own stands, by their own density (not as a share of the sward's tufts, which follow
// the grass field: at grass 0.25 a few percent became grain and a wild-rice cell read as any meadow), in patches.

test('a wild-rice cell at grass 0.25 stands in dense patches; a meadow of the same grass has none', () => {
  const grid = getGrid(16);
  const n = grid.count, R = 700; // ~50 m cells, as on the 3 km worlds
  const flat = (v: number) => new Float32Array(n).fill(v);
  const meadowIdx = plants.findIndex((p) => (p as { type?: string }).type === 'grass' && (p as { form?: string }).form === 'grass');
  const world = (species: number, tree = 0): PlanetView => {
    const fields = new Map<string, Float32Array>([
      ['surface', flat(10)], ['soil', flat(0.5)], ['sand', flat(0)], ['snow', flat(0)], ['water', flat(0)], ['road', flat(0)],
      ['moisture', flat(0.5)], ['temperature', flat(18)], ['tree', flat(tree)], ['crop', flat(0)], ['grass', flat(0.25)],
      ['grassSpecies', flat(species)],
    ]);
    const ground = { grid, radius: R, noise: new Noise3(3), surface: fields.get('surface')!, soil: fields.get('soil')!, sand: fields.get('sand')!, snow: fields.get('snow')!, grad: null };
    return { grid, fields, params: { radius: R, seaLevel: 0 }, ground } as unknown as PlanetView;
  };
  const items = (pv: PlanetView, c: number) => (GroundCover.prototype as unknown as { cellItems(pv: PlanetView, c: number): Float32Array }).cellItems(pv, c);
  const tally = (rec: Float32Array) => {
    const t = { stand: 0, tuft: 0, all: rec.length / 11, standH: 0, tuftH: 0 };
    for (let i = 0; i < rec.length; i += 11) {
      if (rec[i + 6] === 6 && rec[i + 9] > 0.5) { t.stand++; t.standH += rec[i + 5]; }
      else if (rec[i + 6] === 0) { t.tuft++; t.tuftH += rec[i + 5]; }
    }
    return t;
  };
  const c = 40;
  const meadow = tally(items(world(meadowIdx), c));
  assert.equal(meadow.stand, 0, 'plain meadow grass: no grain stands');
  assert.ok(meadow.tuft > 500, `the meadow has its sward (${meadow.tuft} tufts)`);
  for (const id of ['wild-rice', 'teosinte']) {
    if (idx(id) < 0) continue;
    const rec = items(world(idx(id)), c);
    const w = tally(rec);
    assert.ok(w.stand > meadow.tuft * 0.5, `${id}: ${w.stand} stands vs ${meadow.tuft} meadow tufts`);
    // knee-high or taller (a sward tuft is ~0.45 m: its scale x the tuft mesh's ~0.78 m blades)
    assert.ok(w.standH / w.stand > 0.6, `${id}: stands ${(w.standH / w.stand).toFixed(2)} m tall`);
    // in patches: the 5 m bins of the cell's lattice are uneven (dense stands, thin scatter between)
    const bins = new Map<string, number>();
    const P = grid.pos;
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    let ex = cz, ez = -cx;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = cy * ez, ny = cz * ex - cx * ez, nz = -cy * ex;
    for (let i = 0; i < rec.length; i += 11) {
      if (!(rec[i + 6] === 6 && rec[i + 9] > 0.5)) continue;
      const u = (rec[i] * ex + rec[i + 2] * ez) * R, v = (rec[i] * nx + rec[i + 1] * ny + rec[i + 2] * nz) * R;
      const key = `${Math.floor(u / 5)},${Math.floor(v / 5)}`;
      bins.set(key, (bins.get(key) ?? 0) + 1);
    }
    const counts = [...bins.values()].sort((a, b) => b - a);
    const top = counts.slice(0, Math.ceil(counts.length * 0.3)).reduce((a, b) => a + b, 0);
    assert.ok(top > w.stand * 0.5, `${id}: patches (the densest 30 % of 5 m bins hold ${(top / w.stand * 100).toFixed(0)} %)`);
  }
  // never under a closed canopy
  assert.equal(tally(items(world(idx('wild-rice'), 0.7), c)).stand, 0, 'no stands under a closed canopy');
});
