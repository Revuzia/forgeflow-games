// GENESIS — water (CONTRACT.md §7.2, §19): flows downhill and pools in a basin; the sea-level slider moves the
// shoreline; volume is conserved without sources/sinks; a tsunami crosses a quarter of the world at the stylised speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import { conservedVolume, computeOcean } from '../src/sim/fields/hydrology.ts';

/** a dry, airless world with every water sink switched off (pipes alone move the water) */
function closedWorld(n = 24): { sim: Sim; p: Planet } {
  const sim = new Sim({ seed: 99, scenario: 'barren', overrides: { n } });
  const p = sim.u.planets[0];
  p.cfg.evaporation = 0;
  p.cfg.infiltration = 0;
  p.cfg.oceanRelax = false;
  p.st.seaLevel = -1e4;
  p.hydro.seaNow = -1e4;
  computeOcean(p, -1e4);
  return { sim, p };
}

/** replace the ground with a smooth bowl centred on +Y (north pole): h = 400 (1 - cos θ) */
function bowl(p: Planet): void {
  const f = p.f, P = p.grid.pos;
  for (let c = 0; c < p.count; c++) {
    f.rock[c] = 400 * (1 - P[c * 3 + 1]);
    f.soil[c] = 0; f.sand[c] = 0; f.ash[c] = 0; f.snow[c] = 0; f.ice[c] = 0;
    p.updSurface(c);
  }
  p.s.flux.fill(0);
  p.s.hAct.fill(0);
}

/** water-weighted mean angular distance (rad) from the north pole */
function meanAngle(p: Planet): number {
  let s = 0, w = 0;
  const P = p.grid.pos;
  for (let c = 0; c < p.count; c++) {
    const v = p.f.water[c] * p.cellArea[c];
    if (v <= 0) continue;
    s += v * Math.acos(Math.min(1, P[c * 3 + 1]));
    w += v;
  }
  return w > 0 ? s / w : 0;
}

test('water flows downhill and pools in a basin', () => {
  const { sim, p } = closedWorld();
  bowl(p);
  // pour on the bowl's flank, 0.35 rad (~1 km) from the bottom
  const r = sim.applyNow({ k: 'water.add', lat: 90 - (0.35 * 180) / Math.PI, lon: 30, radius: 250, volume: 2e5 });
  assert.ok(r.ok, r.msg);
  const a0 = meanAngle(p);
  assert.ok(a0 > 0.3, `poured on the flank (${a0})`);
  sim.step(300);
  const a1 = meanAngle(p);
  assert.ok(a1 < a0 - 0.1, `water moved downhill within 300 ticks (${a0.toFixed(3)} -> ${a1.toFixed(3)} rad)`);
  sim.step(1500);
  const a2 = meanAngle(p);
  assert.ok(a2 < 0.12, `water collected in the basin (${a2.toFixed(3)} rad from the bottom)`);
  // the deepest water sits at the bottom of the bowl
  let deep = 0;
  for (let c = 1; c < p.count; c++) if (p.f.water[c] > p.f.water[deep]) deep = c;
  assert.ok(p.grid.pos[deep * 3 + 1] > Math.cos(0.12), 'deepest water at the bottom');
  // and it is a pool: the surface of the water there is flat (neighbours within a few cm)
  const H = (c: number) => p.f.surface[c] + p.f.water[c];
  for (let e = p.grid.nbrStart[deep]; e < p.grid.nbrStart[deep + 1]; e++) {
    const o = p.grid.nbr[e];
    if (p.f.water[o] > 0.01) assert.ok(Math.abs(H(o) - H(deep)) < 0.05, 'level pool surface');
  }
});

test('water volume is conserved without sources or sinks (within 1e-3 relative)', () => {
  const { sim, p } = closedWorld();
  // the real cratered terrain: pour in several places, then a flood and a tsunami impulse (sources, then none)
  sim.applyNow({ k: 'water.add', lat: 10, lon: 20, radius: 400, depth: 4 });
  sim.applyNow({ k: 'water.add', lat: -35, lon: 140, radius: 300, depth: 6 });
  sim.applyNow({ k: 'water.flood', lat: 50, lon: -70, radius: 300, height: 5 });
  sim.applyNow({ k: 'water.tsunami', lat: -5, lon: -100, radius: 300, height: 8 });
  const v0 = p.waterVolume();
  const c0 = conservedVolume(p);
  assert.ok(v0 > 1e5);
  sim.step(2500);
  const v1 = p.waterVolume();
  assert.ok(Math.abs(v1 - v0) / v0 < 1e-3, `volume drift ${((v1 - v0) / v0).toExponential(2)}`);
  // bookkeeping: volume minus every explicit source/sink stays constant even with sinks on
  p.cfg.evaporation = 1;
  sim.step(600);
  const c1 = conservedVolume(p);
  assert.ok(Math.abs(c1 - c0) / v0 < 1e-3, `accounted volume drift ${((c1 - c0) / v0).toExponential(2)}`);
  assert.ok(p.waterVolume() < v1, 'with no air, standing water boils or sublimates away');
});

test('the sea-level slider moves the shoreline', () => {
  const sim = new Sim({ seed: 5, scenario: 'sandbox', overrides: { n: 24 } });
  const p = sim.u.planets[0];
  const wet = () => { let n = 0; for (let c = 0; c < p.count; c++) if (p.f.water[c] > 0.25) n++; return n; };
  const ocean0 = p.hydro.oceanCells;
  const wet0 = wet();
  let r = sim.applyNow({ k: 'water.sea-level', delta: 25 });
  assert.ok(r.ok, r.msg);
  sim.step(400);
  const ocean1 = p.hydro.oceanCells;
  const wet1 = wet();
  assert.ok(ocean1 > ocean0 * 1.03, `the sea spreads over low land (${ocean0} -> ${ocean1} sea cells)`);
  assert.ok(wet1 > wet0 * 1.03, `more cells under water (${wet0} -> ${wet1})`);
  assert.ok(Math.abs(p.hydro.seaNow - 25) < 1e-6, 'the level reached its target');
  // a coastal cell that was dry land is now sea, at the new level
  let flooded = -1;
  for (let c = 0; c < p.count; c++) if (p.f.surface[c] > 5 && p.f.surface[c] < 20 && p.s.ocean[c]) { flooded = c; break; }
  assert.ok(flooded >= 0, 'low coastal land was flooded');
  assert.ok(Math.abs(p.f.surface[flooded] + p.f.water[flooded] - 25) < 0.5, 'flooded land sits under the new sea level');
  r = sim.applyNow({ k: 'water.sea-level', value: -20 });
  assert.ok(r.ok, r.msg);
  sim.step(600);
  assert.ok(p.hydro.oceanCells < ocean0, `the sea retreats below its old shore (${p.hydro.oceanCells} < ${ocean0})`);
  assert.ok(wet() < wet0, 'fewer cells under water');
});

test('a tsunami crosses a quarter of the world at the stylised speed, and the sea calms again', () => {
  const { sim, p } = closedWorld(32);
  // a global ocean 40 m deep
  for (let c = 0; c < p.count; c++) {
    p.f.rock[c] = -40; p.f.soil[c] = 0; p.f.sand[c] = 0; p.f.ash[c] = 0; p.f.snow[c] = 0; p.f.ice[c] = 0;
    p.updSurface(c);
    p.f.water[c] = 40;
  }
  p.s.hAct.fill(0);
  p.s.flux.fill(0);
  const r = sim.applyNow({ k: 'water.tsunami', lat: 90, lon: 0, radius: 300, height: 10 });
  assert.ok(r.ok, r.msg);
  const P = p.grid.pos;
  // watch the equator (a quarter circumference, ~4.7 km away)
  const ring: number[] = [];
  for (let c = 0; c < p.count; c++) if (Math.abs(P[c * 3 + 1]) < 0.02) ring.push(c);
  let arrival = -1;
  for (let t = 0; t < 900 && arrival < 0; t += 2) {
    sim.step(2);
    for (const c of ring) if (p.f.water[c] - 40 > 0.02) { arrival = sim.tick; break; }
  }
  assert.ok(arrival > 150 && arrival < 500, `wave reached the equator at tick ${arrival} (stylised target ~300)`);
  // stable: no blow-up, everything finite and the sea settles
  sim.step(4000);
  let maxDev = 0;
  for (let c = 0; c < p.count; c++) {
    assert.ok(Number.isFinite(p.f.water[c]));
    maxDev = Math.max(maxDev, Math.abs(p.f.water[c] - p.f.water[0]));
  }
  assert.ok(maxDev < 0.25, `the sea calmed (max level spread ${maxDev.toFixed(3)} m)`);
});
