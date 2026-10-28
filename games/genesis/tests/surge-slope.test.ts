// The ocean's surge foam (a tsunami's face) reads the water level's slope per CELL from FieldTextures' W texture
// (render/planet/fieldtex.ts fillSurge): a calm sea has no excess slope, a bulge of the level has a positive excess on
// its flanks with the gradient pointing up the face, and the value is a per-cell field (continuous once interpolated),
// not the per-sim-triangle screen slope that painted whole triangles white.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { WorldView } from '../src/client/worldview.ts';
import { FieldTextures } from '../src/render/planet/fieldtex.ts';

test('W: no surge on a calm sea; a bulge of the level gives a positive excess pointing up its face', () => {
  const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n: 32 } });
  const p = sim.u.planets[0];
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  const pv = view.planet(p.id)!;
  const g = pv.grid;
  const R = pv.params.radius;
  const ft = new FieldTextures(pv);
  ft.update();
  const W = ft.tex.W.image.data as Float32Array;
  const water = pv.fields.get('water')!;
  const surface = pv.fields.get('surface')!;
  assert.ok(water && surface, 'the test world has water and surface fields');

  // deep open sea: every neighbour deep too
  const deep = (c: number): boolean => {
    if (water[c] < 20) return false;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (water[g.nbr[e]] < 20) return false;
    return true;
  };
  let centre = -1, nDeep = 0;
  for (let c = 0; c < g.count; c++) {
    if (!deep(c)) continue;
    nDeep++;
    // a calm sea's level is flat: its excess over the bed is never positive
    assert.ok(W[c * 4] < 0.01, `calm sea cell ${c} has excess ${W[c * 4]}`);
    if (centre < 0 && deep(c)) centre = c;
  }
  assert.ok(nDeep > 50 && centre >= 0, 'the test world has open sea');

  // raise a bulge of the level (a tsunami's hump) around the centre cell: 30 m high, ~300 m wide
  const cx = g.pos[centre * 3], cy = g.pos[centre * 3 + 1], cz = g.pos[centre * 3 + 2];
  const sigma = 300;
  for (let c = 0; c < g.count; c++) {
    if (water[c] <= 0.02) continue;
    const d = Math.hypot(g.pos[c * 3] - cx, g.pos[c * 3 + 1] - cy, g.pos[c * 3 + 2] - cz) * R;
    water[c] += 30 * Math.exp(-(d * d) / (2 * sigma * sigma));
  }
  pv.fieldVersion.set('water', (pv.fieldVersion.get('water') ?? 0) + 1);
  ft.update();

  let faces = 0, maxEx = 0;
  for (let c = 0; c < g.count; c++) {
    if (!deep(c)) continue;
    const px = g.pos[c * 3], py = g.pos[c * 3 + 1], pz = g.pos[c * 3 + 2];
    const d = Math.hypot(px - cx, py - cy, pz - cz) * R;
    if (d < 0.6 * sigma || d > 1.6 * sigma) continue;
    const ex = W[c * 4];
    maxEx = Math.max(maxEx, ex);
    if (ex > 0.03) {
      faces++;
      // the gradient points up the face, toward the crest (in the tangent plane: no radial part)
      const gx = W[c * 4 + 1], gy = W[c * 4 + 2], gz = W[c * 4 + 3];
      assert.ok(gx * (cx - px) + gy * (cy - py) + gz * (cz - pz) > 0, `face cell ${c}: gradient points away from the crest`);
      const radial = Math.abs(gx * px + gy * py + gz * pz);
      assert.ok(radial < 1e-6 + 0.01 * Math.hypot(gx, gy, gz), `face cell ${c}: gradient is not tangent`);
    }
  }
  assert.ok(faces >= 4, `the bulge's flanks read as surge faces (${faces} cells, max excess ${maxEx.toFixed(3)})`);
  // the analytic slope peaks at 30/300 * e^-0.5 ~ 0.061: the least-squares slope must be of that order
  assert.ok(maxEx > 0.035 && maxEx < 0.12, `max excess ${maxEx}`);

  // a sheet of even depth leans with its bed (a river running down its valley): no surge however steep the bed
  let maxBed = 0;
  for (let c = 0; c < g.count; c++) if (water[c] > 0.02) water[c] = 3;
  pv.fieldVersion.set('water', (pv.fieldVersion.get('water') ?? 0) + 1);
  ft.update();
  for (let c = 0; c < g.count; c++) {
    if (water[c] <= 0.02) continue;
    let all = true;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (water[g.nbr[e]] <= 0.02) all = false;
    if (!all) continue;
    const gl = Math.hypot(W[c * 4 + 1], W[c * 4 + 2], W[c * 4 + 3]);
    maxBed = Math.max(maxBed, gl);
    assert.ok(W[c * 4] < 1e-3, `even sheet cell ${c}: excess ${W[c * 4]} on a level sloping ${gl}`);
  }
  assert.ok(maxBed > 0.02, `the even sheet lies on sloping beds somewhere (max level slope ${maxBed})`);
});
