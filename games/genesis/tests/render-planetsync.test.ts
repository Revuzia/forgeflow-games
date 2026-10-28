// GENESIS — a save loaded in place gets a fresh planet visual (render/planet/planetsync.ts).
//
// Title → Continue and Saves → Load replace the world under the same planet id. WorldView then builds a NEW PlanetView
// for that id (seed / grid differ); the renderer must not keep re-syncing the old visual, whose field textures held
// the old view and kept drawing the old world's terrain under the new world's air (the "Gaia drawn as Cinder" bug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { WorldView, type PlanetView } from '../src/client/worldview.ts';
import { FieldTextures } from '../src/render/planet/fieldtex.ts';
import { syncPlanetVisuals, type SyncedVisual } from '../src/render/planet/planetsync.ts';

class FakeVisual implements SyncedVisual<PlanetView> {
  pv: PlanetView;
  readonly fields: FieldTextures;
  disposed = false;
  syncs = 0;
  constructor(pv: PlanetView) { this.pv = pv; this.fields = new FieldTextures(pv); this.sync(pv); }
  sync(pv: PlanetView): void { this.pv = pv; this.fields.update(); this.syncs++; }
  dispose(): void { this.disposed = true; this.fields.dispose(); }
}

/** the surface heights the visual's texture A holds, against the view's own field */
function surfaceMismatch(vis: FakeVisual, pv: PlanetView): number {
  const d = vis.fields.tex.A.image.data as Float32Array;
  const s = pv.fields.get('surface') as Float32Array;
  let bad = 0;
  for (let c = 0; c < s.length; c++) if (Math.abs(d[c * 4] - s[c]) > 1e-3) bad++;
  return bad;
}

test('a save with another seed loaded under the same planet id draws the new world, not the old one', () => {
  const view = new WorldView();
  view.apply(new Sim({ seed: 1, scenario: 'barren' }).snapshot({ full: true }), 0);
  const visuals = new Map<number, FakeVisual>();
  const added: FakeVisual[] = [], removed: FakeVisual[] = [];
  const hooks = { make: (pv: PlanetView) => new FakeVisual(pv), added: (v: FakeVisual) => { added.push(v); }, removed: (v: FakeVisual) => { removed.push(v); } };
  assert.deepEqual(syncPlanetVisuals(visuals, view.planets, hooks), [], 'first build is not a rebuild');
  const pvA = view.planets[0];
  const visA = visuals.get(pvA.id)!;
  assert.equal(surfaceMismatch(visA, pvA), 0);
  // an ordinary snapshot of the same world: the same visual, re-synced
  assert.deepEqual(syncPlanetVisuals(visuals, view.planets, hooks), []);
  assert.equal(visuals.get(pvA.id), visA);

  // the load: another seed, same scenario, so the same planet id with a different world
  view.apply(new Sim({ seed: 2, scenario: 'barren' }).snapshot({ full: true }), 0);
  const pvB = view.planets.find((p) => p.id === pvA.id)!;
  assert.ok(pvB && pvB !== pvA && pvB.seed !== pvA.seed, 'WorldView replaced the view under the same id');
  // the stale visual reads the old world: its texture disagrees with the new view's surface
  visA.sync(pvB);
  assert.ok(surfaceMismatch(visA, pvB) > pvB.grid.count / 4, 'an in-place re-sync keeps the old world (the bug this guards)');
  visA.pv = pvA;

  const rebuilt = syncPlanetVisuals(visuals, view.planets, hooks);
  assert.deepEqual(rebuilt, [pvA.id], 'the replaced world is reported as rebuilt');
  const visB = visuals.get(pvA.id)!;
  assert.notEqual(visB, visA);
  assert.ok(visA.disposed && removed.includes(visA), 'the old visual left the scene and was disposed');
  assert.ok(added.includes(visB));
  assert.equal(visB.pv, pvB);
  assert.equal(surfaceMismatch(visB, pvB), 0, 'the new visual\'s field textures hold the loaded world');
});
