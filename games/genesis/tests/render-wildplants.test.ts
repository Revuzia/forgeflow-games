// The wild grass-layer species the sim grows (grassSpecies) — what a band forages — draw with their own looks, not
// as plain meadow grass: wild grains as their crop form standing wild, mushrooms, herbs, tussocks, moss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_PACK } from '../src/data/index.ts';
import { WILD_HERB, WILD_MOSS, WILD_MUSHROOM, WILD_NONE, WILD_TUSSOCK, wildLookAt, wildLookOf } from '../src/render/life/groundcover.ts';
import { CROP_TYPES } from '../src/render/gen/groundgen.ts';

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
