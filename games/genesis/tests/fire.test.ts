// GENESIS — fire (CONTRACT.md §7, §19): spreads in dry forest, runs faster downwind than upwind, is stopped by water
// and rain, and leaves a burnt scar and ash. (The kiln / cooking-heat contexts arrive with recipes in phase 2; the heat
// query they will use is checked here.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import type { Universe } from '../src/sim/world/universe.ts';
import { fireStep, heatAt, igniteCell, FIRE_CADENCE } from '../src/sim/fields/fire.ts';

interface Patch { sim: Sim; u: Universe; p: Planet; center: number; cells: number[]; east: [number, number, number] }

/** a dry pine forest disc on an airy world, still air except a steady wind (m/s) toward local east */
function forestPatch(wind: number): Patch {
  const sim = new Sim({ seed: 3, scenario: 'sandbox', overrides: { n: 32 } });
  const u = sim.u;
  const p = u.planets[0];
  const f = p.f, g = p.grid, P = g.pos;
  // centre on a land cell near the equator
  let center = -1;
  for (let c = 0; c < p.count; c++) if (!p.s.ocean[c] && Math.abs(P[c * 3 + 1]) < 0.3) { center = c; break; }
  assert.ok(center >= 0);
  const east: [number, number, number] = [p.geo.east[center * 3], p.geo.east[center * 3 + 1], p.geo.east[center * 3 + 2]];
  const cells = p.cellsNear([P[center * 3], P[center * 3 + 1], P[center * 3 + 2]], 2500).slice();
  const pine = u.content.plants.idx('pine');
  const grass = u.content.plants.idx('meadow-grass');
  for (const c of cells) {
    f.water[c] = 0; f.snow[c] = 0; f.precip[c] = 0; f.precipType[c] = 0;
    f.tree[c] = 0.8; f.treeSpecies[c] = pine;
    f.grass[c] = 0.5; f.grassSpecies[c] = grass;
    f.shrub[c] = 0; f.crop[c] = 0;
    f.moisture[c] = 0.05; f.wetness[c] = 0; f.humidity[c] = 0.25; f.temperature[c] = 25;
    f.windX[c] = east[0] * wind; f.windY[c] = east[1] * wind; f.windZ[c] = east[2] * wind;
    f.fire[c] = 0; f.burnt[c] = 0; f.ash[c] = 0;
  }
  return { sim, u, p, center, cells, east };
}

function burn(pt: Patch, steps: number): void {
  for (let i = 0; i < steps; i++) {
    fireStep(pt.u, pt.p);
    pt.u.tick += FIRE_CADENCE;
  }
}

/** signed distance (m) of a cell from the centre along local east */
function along(pt: Patch, c: number): number {
  const P = pt.p.grid.pos;
  const dx = P[c * 3] - P[pt.center * 3], dy = P[c * 3 + 1] - P[pt.center * 3 + 1], dz = P[c * 3 + 2] - P[pt.center * 3 + 2];
  return (dx * pt.east[0] + dy * pt.east[1] + dz * pt.east[2]) * pt.p.st.radius;
}

test('fire spreads through a dry forest and leaves burnt ground and ash', () => {
  const pt = forestPatch(0);
  const { u, p, center } = pt;
  assert.ok(igniteCell(u, p, center, 0.9, 'test'));
  const ev = u.events.find((e) => e.t === 'fire.start');
  assert.ok(ev, 'a fire.start event');
  burn(pt, 40);
  let burnt = 0, ash = 0, thinned = 0;
  for (const c of pt.cells) {
    if (p.f.burnt[c] > 0.5) burnt++;
    if (p.f.ash[c] > 0) ash++;
    if (p.f.tree[c] < 0.8) thinned++;
  }
  assert.ok(burnt > 25, `the fire spread (${burnt} burnt cells)`);
  assert.ok(ash >= burnt * 0.8, `ash where it burned (${ash})`);
  assert.ok(thinned >= burnt * 0.8, 'trees consumed');
  // a burning cell is hot enough for a kiln; the open air is not
  let hot = -1;
  for (const c of pt.cells) if (p.f.fire[c] > 0.5) { hot = c; break; }
  if (hot >= 0) assert.ok(heatAt(p, hot) > 500, 'heatAt reads the fire');
  let cool = -1;
  for (let c = 0; c < p.count; c++) if (p.f.fire[c] === 0 && p.f.lava[c] === 0 && p.f.temperature[c] < 60) { cool = c; break; }
  assert.ok(cool >= 0 && heatAt(p, cool) < 100, 'unburning ground is only as warm as the air');
});

test('fire runs faster downwind than upwind', () => {
  const pt = forestPatch(9);
  igniteCell(pt.u, pt.p, pt.center, 0.9, 'test');
  burn(pt, 30);
  let down = 0, up = 0;
  for (const c of pt.cells) {
    if (pt.p.f.burnt[c] <= 0.5) continue;
    const a = along(pt, c);
    if (a > down) down = a;
    if (-a > up) up = -a;
  }
  assert.ok(down > 2 * Math.max(up, pt.p.edgeM), `downwind ${down.toFixed(0)} m vs upwind ${up.toFixed(0)} m`);
});

test('standing water stops the fire front', () => {
  const pt = forestPatch(9);
  const { p } = pt;
  // a lake band across the wind, 600..1300 m downwind of the ignition
  for (const c of pt.cells) {
    const a = along(pt, c);
    if (a > 600 && a < 1300) p.f.water[c] = 0.6;
  }
  igniteCell(pt.u, p, pt.center, 0.9, 'test');
  burn(pt, 80);
  let beyond = 0, before = 0;
  for (const c of pt.cells) {
    if (p.f.burnt[c] <= 0.5) continue;
    const a = along(pt, c);
    if (a >= 1300) beyond++;
    if (a > 200 && a < 600) before++;
  }
  assert.ok(before > 3, 'the fire reached the shore');
  assert.equal(beyond, 0, 'nothing burned across the water');
});

test('rain puts the fire out', () => {
  const pt = forestPatch(4);
  const { p } = pt;
  igniteCell(pt.u, p, pt.center, 0.9, 'test');
  burn(pt, 15);
  let burning = 0;
  for (const c of pt.cells) if (p.f.fire[c] > 0) burning++;
  assert.ok(burning > 5, `burning before the rain (${burning})`);
  for (const c of pt.cells) { p.f.precip[c] = 14; p.f.precipType[c] = 1; p.f.moisture[c] = 0.6; p.f.wetness[c] = 0.9; }
  burn(pt, 12);
  burning = 0;
  for (const c of pt.cells) if (p.f.fire[c] > 0) burning++;
  assert.equal(burning, 0, 'every flame is out');
  assert.ok(pt.u.events.some((e) => e.t === 'fire.out'), 'a fire.out event');
});

test('the fire commands: ignite and extinguish through the registry', () => {
  const pt = forestPatch(0);
  const P = pt.p.grid.pos;
  const pos = [P[pt.center * 3], P[pt.center * 3 + 1], P[pt.center * 3 + 2]];
  const a = pt.sim.applyNow({ k: 'fire.ignite', pos, radius: 150 });
  assert.ok(a.ok, a.msg);
  const b = pt.sim.applyNow({ k: 'fire.extinguish', pos, radius: 400 });
  assert.ok(b.ok && /die/.test(b.msg ?? ''), b.msg);
  // no oxygen, no fire
  pt.sim.applyNow({ k: 'planet.atmosphere', o2: 0 });
  const c = pt.sim.applyNow({ k: 'fire.ignite', pos, radius: 150 });
  assert.equal(c.ok, false);
  assert.match(c.msg ?? '', /oxygen/);
});
