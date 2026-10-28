// H12: plants invented in play (or brought by a mod) draw with their own form, not a stand-in. The 'content' query
// hands the render the plants beyond the base pack with their sim index; setPlantRegistry rebuilds the vegetation's
// species looks and the ground cover's crop table, and bumps the cache version so built tiles re-place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_PACK } from '../src/data/index.ts';
import { PLANT_PROBE, plantLookOf, setPlantRegistry } from '../src/render/life/vegetation.ts';
import { cropTypeOf } from '../src/render/life/groundcover.ts';
import { CROP_TYPES } from '../src/render/gen/groundgen.ts';

test('an invented crop and tree draw with their own forms; an unchanged list is a no-op', () => {
  const n = (BASE_PACK.plants ?? []).length;
  assert.equal(plantLookOf(n), null, 'nothing past the base pack before the registry is set');
  assert.equal(cropTypeOf(n), 0);
  const v0 = PLANT_PROBE.version;
  const added = [
    { index: n, id: 'sunroot', name: 'Sunroot', type: 'crop', form: 'leafy', colors: { leaf: '#4a7a2a' }, height: [0.3, 0.6] },
    { index: n + 1, id: 'skypalm', name: 'Sky palm', type: 'tree', form: 'palm', colors: { leaf: '#3f6e2c' }, height: [9, 14] },
  ];
  setPlantRegistry(added);
  assert.equal(PLANT_PROBE.version, v0 + 1, 'the caches are told to rebuild');
  assert.equal(cropTypeOf(n), CROP_TYPES.indexOf('potato'), 'a leafy crop draws as a root crop, not wheat');
  const palm = plantLookOf(n + 1);
  assert.ok(palm, 'the invented tree has a look');
  assert.equal(palm.layer, 'tree');
  const basePalm = (BASE_PACK.plants ?? []).findIndex((p) => p.form === 'palm' && p.id !== 'date-palm');
  assert.ok(basePalm >= 0);
  assert.equal(palm.kind, plantLookOf(basePalm)?.kind, 'a palm-form tree draws as a palm');
  assert.ok(palm.hMin >= 8.9 && palm.hMax <= 14.1, 'its own height');
  setPlantRegistry(added.map((p) => ({ ...p })));
  assert.equal(PLANT_PROBE.version, v0 + 1, 'the same list again does not rebuild');
  setPlantRegistry([]);
  assert.equal(plantLookOf(n), null, 'a cleared list drops the added plants');
  assert.equal(PLANT_PROBE.version, v0 + 2);
});
