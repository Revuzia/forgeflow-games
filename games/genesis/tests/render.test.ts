// GENESIS — render-side regressions that run without a GPU (Node imports three's geometry code only):
//   * terrain chunk geometry carries a `normal` attribute — three r186 compiles a MeshStandardMaterial as FLAT_SHADED
//     when it is missing (WebGLPrograms: flatShading when geometry.attributes.normal === undefined), which turned the
//     whole terrain into a triangle mosaic;
//   * the chunk vertex layout stays within WebGL2's guaranteed 16 vertex attributes;
//   * every procedural plant / ground-cover mesh carries the vegetation material's attribute layout;
//   * the `desert` point of interest frames sand, never a forest or a polar snowfield (bare and dry also matches ice caps);
//   * the near-camera ground cover survives live snapshots: a field-version bump with changes below its quantisation
//     rebuilds nothing, a real change rebuilds only the cells around it, and it never empties while it rebuilds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, type BufferGeometry } from 'three';
import { ChunkLOD, Patch } from '../src/render/planet/chunks.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import { Noise3 } from '../src/sim/grid/noise.ts';
import { TREE_KINDS, treeGeometry } from '../src/render/gen/treegen.ts';
import { grassTuft, stone } from '../src/render/gen/groundgen.ts';
import { findPoi } from '../src/client/poi.ts';
import type { PlanetView } from '../src/client/worldview.ts';
import { Sim } from '../src/sim/sim.ts';
import { WorldView } from '../src/client/worldview.ts';
import { GroundCover } from '../src/render/life/groundcover.ts';
import { makePlanetUniforms } from '../src/render/planet/terrainmat.ts';
import { Vector3 } from 'three';
import { buildingMesh, templeForm, type BuildingSpec } from '../src/render/gen/buildinggen.ts';
import { materials } from '../src/render/life/catalog.ts';
import { PART } from '../src/render/gen/meshkit.ts';

function chunkGeometry(): BufferGeometry {
  const grid = getGrid(16);
  const n = grid.count;
  const mat = new MeshBasicMaterial();
  const lod = new ChunkLOD(grid, new Noise3(3), 3000, new Group(), { terrain: () => mat, water: () => mat }, {
    surface: new Float32Array(n), grad: null, waterLevel: new Float32Array(n).fill(-10), waterDepth: new Float32Array(n), geomVersion: 0,
  });
  const p = new Patch(0, 2, [0, 0], [4, 0], [0, 4]);
  const internal = lod as unknown as { updateBounds(p: Patch): void; buildGeometry(p: Patch): BufferGeometry };
  internal.updateBounds(p);
  return internal.buildGeometry(p);
}

test('terrain chunks have smooth-shading normals (no FLAT_SHADED fallback) within the attribute budget', () => {
  const geo = chunkGeometry();
  const normal = geo.getAttribute('normal');
  assert.ok(normal, 'chunk geometry has a normal attribute');
  assert.equal(normal, geo.getAttribute('position'), 'the normal attribute shares the unit-direction position buffer');
  const names = Object.keys(geo.attributes);
  assert.ok(names.length <= 16, `${names.length} vertex attributes (${names.join(', ')})`);
  for (const a of ['aCells', 'aMisc', 'aGrad', 'aGradD', 'aGradDM', 'aN1', 'aN1m', 'aN2', 'aN2m']) assert.ok(geo.getAttribute(a), a);
});

test('procedural plants and ground cover carry the vegetation attribute layout', () => {
  const geos: [string, BufferGeometry][] = [];
  for (const k of TREE_KINDS) for (let l = 0; l < 3; l++) geos.push([`${k}/lod${l}`, treeGeometry(k, l, 0)]);
  geos.push(['grass', grassTuft(0)], ['stone', stone(1)]);
  for (const [name, g] of geos) {
    for (const a of ['position', 'normal', 'color', 'aWind', 'aLeafUv', 'aCard', 'aCrown']) assert.ok(g.getAttribute(a), `${name} has ${a}`);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count * 3; i++) assert.ok(Number.isFinite((pos.array as Float32Array)[i]), `${name} finite`);
  }
  // crown depth: a broadleaf crown has an inside (deep foliage < 0.5) and an outside (≈ 1)
  const tree = treeGeometry('broadleaf', 0, 0);
  const crown = tree.getAttribute('aCrown').array as Float32Array;
  const card = tree.getAttribute('aCard').array as Float32Array;
  let deep = 0, outer = 0;
  for (let i = 0; i < crown.length; i++) if (card[i] > 0.25) { if (crown[i] < 0.5) deep++; else if (crown[i] > 0.85) outer++; }
  assert.ok(deep > 0 && outer > 0, `crown depth spans the crown (${deep} deep, ${outer} outer leaf vertices)`);
});

test('the desert POI lands on bare sand (lookdev world: no true desert, so the barest sand; never the ice cap)', () => {
  const sim = new Sim({ seed: 1, scenario: 'lookdev' });
  sim.step(30);
  const p = sim.u.planets[0];
  const fields = new Map<string, Float32Array>();
  for (const k of ['surface', 'water', 'temperature', 'cloud', 'sand', 'snow', 'tree', 'shrub', 'grass', 'moisture']) {
    fields.set(k, Float32Array.from((p.f as unknown as Record<string, ArrayLike<number>>)[k]));
  }
  const pv = { grid: p.grid, fields, params: { radius: p.st.radius } } as unknown as PlanetView;
  const poi = findPoi(pv, 'desert');
  assert.ok(poi, 'a desert POI');
  const c = poi.cell;
  const veg = p.f.tree[c] + p.f.shrub[c] + p.f.grass[c];
  assert.ok(p.f.sand[c] >= 0.5, `sand ${p.f.sand[c].toFixed(2)} m`);
  assert.ok(p.f.snow[c] < 0.05, `snow ${p.f.snow[c].toFixed(2)} m`);
  assert.ok(veg < 0.3, `vegetation ${veg.toFixed(2)}`);
});

test('ground cover rebuilds only cells whose inputs changed, and keeps drawing meanwhile', () => {
  const sim = new Sim({ seed: 1, scenario: 'lookdev' });
  const view = new WorldView();
  view.apply(sim.snapshot({ full: true }), 0);
  const pv = view.planets[0];
  const gc = new GroundCover(makePlanetUniforms() as never);
  const inner = gc as unknown as { pending: boolean; stale: Set<number>; cache: Map<number, unknown> };
  const F = (n: string) => pv.fields.get(n as never) as Float32Array;
  const grass = F('grass'), water = F('water');
  let c = -1;
  for (let i = 0; i < grass.length && c < 0; i++) if (grass[i] > 0.8 && F('snow')[i] < 0.01 && F('tree')[i] < 0.2 && water[i] < 0.01) c = i;
  assert.ok(c >= 0, 'a meadow cell');
  const P = pv.grid.pos, R = pv.params.radius;
  const cam = new Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]).multiplyScalar(R + F('surface')[c] + 8);
  let frame = 1;
  gc.update(pv, cam, frame);
  const first = gc.stats.instances;
  assert.ok(inner.pending, 'the first update is spread over frames');
  while (inner.pending && frame < 60) gc.update(pv, cam, ++frame);
  const full = gc.stats.instances;
  assert.ok(full > 300 && full >= first, `${full} instances once built`);
  const bump = (k: string) => pv.fieldVersion.set(k as never, (pv.fieldVersion.get(k as never) ?? 0) + 1);
  // deep water rising and grass drifting by half a percent: nothing to rebuild
  for (let i = 0; i < water.length; i++) if (water[i] > 2) water[i] += 0.3;
  // (a drift that stays inside its quantum: a value a hair under a step boundary would cross it, which is a real change)
  for (let i = 0; i < grass.length; i++) grass[i] = Math.min(grass[i] * 1.005, (Math.floor(grass[i] / 0.04) + 1) * 0.04 - 1e-4);
  bump('water'); bump('grass');
  gc.update(pv, cam, ++frame);
  assert.equal(inner.stale.size, 0, 'sub-quantum changes rebuild nothing');
  assert.equal(gc.stats.instances, full);
  // a meadow cell next to the camera's cell goes bare: only cells that interpolate it are rebuilt, and the scatter
  // never drops below what the untouched cells hold while they are
  let o = -1;
  for (let e = pv.grid.nbrStart[c]; e < pv.grid.nbrStart[c + 1]; e++) if (o < 0 || grass[pv.grid.nbr[e]] > grass[o]) o = pv.grid.nbr[e];
  assert.ok(grass[o] > 0.3, 'a grassy neighbour');
  grass[o] = 0;
  bump('grass');
  const cached = inner.cache.size;
  gc.update(pv, cam, ++frame);
  let low = gc.stats.instances;
  while (inner.pending && frame < 120) { gc.update(pv, cam, ++frame); low = Math.min(low, gc.stats.instances); }
  assert.ok(inner.stale.size === 0, 'stale cells rebuilt');
  assert.ok(gc.stats.instances < full, 'fewer tufts once a neighbour is bare');
  assert.ok(low > full * 0.3, `still drawing while rebuilding (${low} of ${full})`);
  assert.equal(inner.cache.size, cached, 'no cell dropped');
  gc.dispose();
});

test('temples are built in their people\'s tradition and dressed by their mood', () => {
  const mat = materials().find((m) => m.id === 'stone')!;
  const spec = (family: 'earth' | 'timber' | 'stone', era: number, mood: number, style = 2, lod = 0): BuildingSpec =>
    ({ kind: 'temple', mat, style, era, mood, w: 14, d: 20, lod, family });
  // the form follows the tradition, never the style index alone: no pagoda among masons, no ziggurat among timber folk
  for (let style = 0; style < 8; style++) for (let era = 3; era <= 10; era++) {
    assert.notEqual(templeForm(spec('stone', era, 0, style)), 'pagoda');
    assert.notEqual(templeForm(spec('earth', era, 0, style)), 'pagoda');
    assert.notEqual(templeForm(spec('timber', era, 0, style)), 'ziggurat');
    assert.notEqual(templeForm(spec('stone', era, 0, style)), 'ziggurat');
  }
  assert.equal(templeForm(spec('earth', 4, 0)), 'ziggurat');
  assert.equal(templeForm(spec('timber', 4, 0)), 'hall');
  assert.equal(templeForm(spec('timber', 6, 0)), 'pagoda');
  assert.equal(templeForm(spec('stone', 4, 0)), 'columns');
  assert.equal(templeForm(spec('stone', 2, 0)), 'henge');
  const parts = (g: ReturnType<typeof buildingMesh>) => {
    const kit = g.geo.getAttribute('aKit'), pos = g.geo.getAttribute('position');
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), 'finite geometry');
    const n = new Map<number, number>();
    for (let i = 0; i < kit.count; i++) n.set(kit.getY(i), (n.get(kit.getY(i)) ?? 0) + 1);
    return n;
  };
  for (const fam of ['earth', 'timber', 'stone'] as const) for (const era of [3, 6]) {
    const plain = buildingMesh(spec(fam, era, 0)), fear = buildingMesh(spec(fam, era, -1)), kind = buildingMesh(spec(fam, era, 1));
    parts(plain);
    // fearful: a walled precinct (a wider footprint) with braziers on its gate
    assert.ok(fear.hx > plain.hx + 1, `${fam} ${era}: fearful precinct (${fear.hx} vs ${plain.hx})`);
    assert.ok(fear.emitters.length > plain.emitters.length, `${fam} ${era}: braziers at the gate`);
    // benevolent: lanterns that glow at night
    assert.ok((parts(kind).get(PART.lantern) ?? 0) > 0, `${fam} ${era}: lanterns`);
    assert.ok((parts(fear).get(PART.lantern) ?? 0) === 0, `${fam} ${era}: no lanterns where the people fear`);
    // the far LOD keeps the silhouette (same height) with less geometry
    const far = buildingMesh(spec(fam, era, 0, 2, 1));
    assert.ok(Math.abs(far.height - plain.height) < 0.5, `${fam} ${era}: LOD height ${far.height} vs ${plain.height}`);
    assert.ok(far.geo.getAttribute('position').count < plain.geo.getAttribute('position').count, `${fam} ${era}: LOD 1 lighter`);
  }
});
