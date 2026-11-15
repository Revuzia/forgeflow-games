// GENESIS — Lane B (world sim): buildings sit on dry land.
// The owner's test world (scenario babel, seed 307987276, the town 'Rubolhin by the Lake') had 35 of its 168 finished
// buildings standing in 0.3-4 m of lake water at year 0: placement asked only the building's own cell, and between
// cell centres the ground runs down under the lake's flat level. world.ts dryAt now asks the point and the footprint;
// buildings.ts floodSweep ruins, once a day, a finished building the water has reached (old saves are put right by it).
//   1. placement: on that seed and two more, no finished non-dock building stands in more than STANDING_WATER_MAX at
//      year 0, and none stands in it for more than a day over the first DRYLAND_YEARS (default 0.25) years;
//   2. the sweep, on a save: a house moved into the lake (as an old save has them) is a ruin a day after the load, by
//      the ordinary 'collapsed' event; a dock in the same water is left.
// The long form (3 seeds, 3 years, counts of buildings lost) is _harness/arc-work/probe-dryland.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import type { PCtx } from '../src/sim/people/ctx.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import type { Building } from '../src/sim/people/state.ts';
import { BuildingFlag } from '../src/sim/types.ts';
import { waterside } from '../src/sim/people/buildings.ts';
import { aboveWater, dryAt, dryCell, isLand, standingWater, waterDepthAt, SITE_FREEBOARD, SITE_WET_MAX, STANDING_WATER_MAX } from '../src/sim/people/world.ts';

const YEARS = Number(process.env.DRYLAND_YEARS ?? 0.25);

/** the finished buildings not made for the water (and not the Tower, which god/tower.ts keeps) standing in too much */
function wetOnes(x: PCtx, p: Planet): Building[] {
  const out: Building[] = [];
  for (const b of p.people!.buildings) {
    if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
    const def = x.c.buildings.list[b.type];
    if (waterside(def) || def.function === 'wonder') continue;
    if (standingWater(p, b.pos, def.footprint) > STANDING_WATER_MAX) out.push(b);
  }
  return out;
}

const show = (x: PCtx, p: Planet, l: Building[]) => l.map((b) => `${x.c.buildings.list[b.type].id}#${b.id} ${standingWater(p, b.pos, x.c.buildings.list[b.type].footprint).toFixed(2)} m`).join(', ');

/** year 0 dry; then day by day: whatever stands in water at one day's end is a ruin by the next */
function staysDry(sim: Sim, label: string): void {
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const first = wetOnes(x, p);
  assert.equal(first.length, 0, `${label}, year 0: ${show(x, p, first)}`);
  const finished = p.people!.buildings.filter((b) => b.progress >= 1).length;
  assert.ok(finished >= 120, `${label}: the towns still found room to build (${finished} finished buildings)`);
  const end = Math.round(YEARS * x.year);
  let wet: Building[] = [];
  for (let stop = false; !stop;) {
    stop = sim.u.tick >= end && wet.length === 0;
    if (stop) break;
    sim.step(x.day);
    const still = wet.filter((b) => !(b.flags & BuildingFlag.ruined) && wetOnes(x, p).includes(b));
    assert.equal(still.length, 0, `${label}, day ${Math.round(sim.u.tick / x.day)}: in the water a second day: ${show(x, p, still)}`);
    wet = wetOnes(x, p);
    if (sim.u.tick >= end + 2 * x.day) { assert.equal(wet.length, 0, `${label}: ${show(x, p, wet)}`); break; }
  }
}

test('dry land: the owner world (babel 307987276, Rubolhin by the Lake) — no finished house in the lake; a save with one loses it to the sweep, its dock stays', () => {
  const sim = new Sim({ seed: 307987276, scenario: 'babel' });
  const p0 = sim.u.planets[0];
  assert.ok(p0.people!.settlements.some((s) => s.name === 'Rubolhin by the Lake'), 'the owner\'s town');
  staysDry(sim, 'babel 307987276');

  // ── an old save: two finished houses stand out in the lake (one of them, for the test, a dock) ──
  const x0 = makeCtx(sim.u, p0);
  const g = p0.grid, P = g.pos, f = p0.f;
  const dockT = x0.c.buildings.idx('dock');
  assert.ok(dockT >= 0);
  const town = p0.people!.settlements.find((s) => s.name === 'Rubolhin by the Lake')!;
  const houses = p0.people!.of(town.id).filter((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x0.c.buildings.list[b.type].function === 'shelter');
  assert.ok(houses.length >= 2);
  // a dry cell beside deep water, near the town, and how far toward the water cell's centre (still the dry cell's own
  // ground: under half way) a house stands well in the lake
  const mix = (dry: number, lake: number, t: number): [number, number, number] => {
    const v = [0, 1, 2].map((k) => P[dry * 3 + k] * (1 - t) + P[lake * 3 + k] * t);
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  let dry = -1, lake = -1, tt = 0;
  for (const c of p0.cellsNear(town.pos, 800).slice().sort((a, b) => a - b)) {
    if (dry >= 0) break;
    if (!dryCell(p0, c) || f.water[c] > 0.01) continue;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1] && dry < 0; e++) {
      const o = g.nbr[e];
      if (f.water[o] < 1.5) continue;
      for (const t of [0.3, 0.35, 0.4, 0.45]) {
        const q = mix(c, o, t);
        if (p0.cellAt(q) === c && waterDepthAt(p0, q) > 0.6 && waterDepthAt(p0, mix(c, o, t - 0.05)) > 0.6) { dry = c; lake = o; tt = t; break; }
      }
    }
  }
  assert.ok(dry >= 0, 'a lake shore by the town');
  const at = (t: number) => mix(dry, lake, t);
  const [house, dock] = houses;
  house.pos = at(tt); house.cell = dry;
  dock.pos = at(tt - 0.05); dock.cell = dry; dock.type = dockT;
  // the very thing the old rule passed: the house's own cell is dry ground, and it stands in the lake
  assert.equal(p0.cellAt(house.pos), dry);
  assert.ok(isLand(p0, dry) && f.water[dry] <= SITE_WET_MAX, 'its cell is dry (the old test)');
  assert.ok(waterDepthAt(p0, house.pos) > STANDING_WATER_MAX, `and it stands in ${waterDepthAt(p0, house.pos).toFixed(2)} m`);
  assert.equal(dryAt(p0, house.pos, 4, dry), false, 'dryAt refuses the spot');
  assert.equal(dryAt(p0, house.pos, 0, dry), false, 'the point alone is enough');
  assert.ok(SITE_FREEBOARD >= 0.25 && SITE_WET_MAX < STANDING_WATER_MAX, 'a building is begun well short of the depth that takes it');

  const loaded = Sim.load(sim.save());
  const p = loaded.u.planets[0];
  const x = makeCtx(loaded.u, p);
  const h = p.people!.building(house.id)!, d = p.people!.building(dock.id)!;
  assert.ok(h && !(h.flags & BuildingFlag.ruined), 'the save loads with its house in the water');
  loaded.drainEvents();
  loaded.step(x.day + 60);
  assert.ok(h.flags & BuildingFlag.ruined, 'a day later the house is a ruin');
  const ev = (loaded.drainEvents() as unknown as { t: string; text?: string; ref?: { id: number } }[]).filter((e) => e.t === 'collapsed' && e.ref?.id === h.id);
  assert.equal(ev.length, 1, 'told once, as any building that falls');
  assert.equal(ev[0].text, 'flood');
  assert.ok(!(d.flags & BuildingFlag.ruined), 'the dock stands at the water and stays');
  assert.equal(wetOnes(x, p).length, 0);
});

for (const seed of [7, 20261008]) {
  test(`dry land: babel seed ${seed} — no finished non-dock building in standing water`, () => {
    staysDry(new Sim({ seed, scenario: 'babel', overrides: { n: 32 } }), `babel ${seed}`);
  });
}

test('dry land: a cell level with the lake beside it is no building ground (aboveWater)', () => {
  const sim = new Sim({ seed: 7, scenario: 'babel', overrides: { n: 20 } });
  const p = sim.u.planets[0], g = p.grid, f = p.f;
  // any dry land cell and one neighbour: raise water in the neighbour to the cell's own ground level
  let c = -1, o = -1;
  for (let i = 0; i < g.count && c < 0; i++) {
    if (!dryCell(p, i) || f.water[i] > 0) continue;
    let ok = true;
    for (let e = g.nbrStart[i]; e < g.nbrStart[i + 1]; e++) if (f.water[g.nbr[e]] > 0 || p.s.ocean[g.nbr[e]]) ok = false;
    if (ok) { c = i; o = g.nbr[g.nbrStart[i]]; }
  }
  assert.ok(c >= 0);
  const pos = [g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]];
  assert.equal(aboveWater(p, c), true);
  assert.equal(dryAt(p, pos, 4, c), true);
  const lower = f.surface[o] < f.surface[c] - 1;
  f.water[o] = Math.max(0.5, f.surface[c] - f.surface[o]); // its level at (or above) this cell's ground
  assert.equal(aboveWater(p, c), false, 'the lake has only to move');
  assert.equal(dryAt(p, pos, 0, c), false);
  if (lower) { f.water[o] = 0.4; assert.equal(aboveWater(p, c), true, 'a pond well below the cell is no threat to it'); }
});
