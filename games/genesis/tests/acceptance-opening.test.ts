// GENESIS — CONTRACT §21.1 / §16.1 on the path players actually take (sim-fix-r1, release owner-r1 verdict 1): the UI
// opening (src/ui/opening.ts) on scenario `barren` — breathe, a storm and a sea, sow where the sun stands, set 30 plains
// folk down at the ring the opening picks (client/poi.ts homesteadCell on the lit face), teach fire — and then the world
// is left running at the opening's hand-over speed with no further act of the god. On the old tree the band starved to
// extinction by about Year 2 (no tree, shrub or soil within reach of the ring, no game on the planet: no sticks, no
// spears, no firewood, no berries). The band must live, and find something nobody gave it.
//
// Grid n = 32 to keep the gate short; the full n = 64, 8 seeds x 10 years run is _harness/scratch/sim-fix-r1/run8.sh
// (opening-probe.ts), recorded in _harness/scratch/ledgers/sim-fix-r1.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import { homesteadCell } from '../src/client/poi.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { landingCell, lastingWater } from '../src/sim/people/spawn.ts';

function opening(seed: number, n: number | undefined = 32): { sim: Sim; sid: number; lib0: number } {
  const sim = new Sim({ seed, scenario: 'barren', overrides: n ? { n } : {} });
  const u = sim.u, p = u.planets[0];
  const day = p.st.dayHours * 60;
  const must = (c: Command) => { const r = sim.applyNow(c); assert.ok(r.ok, `${c.k}: ${r.msg}`); return r; };
  const posOf = (c: number) => [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];
  must({ k: 'planet.add-air', amount: 1 } as Command);
  sim.step(Math.round(day * 0.3));
  must({ k: 'weather.global', kind: 'storm' } as Command);
  must({ k: 'water.sea-level', value: -40 } as Command);
  sim.step(day);
  const s0 = u.sun(p, u.tick).dir; const here = [s0[0], s0[1], s0[2]];
  must({ k: 'weather.global', kind: 'none' } as Command);
  must({ k: 'life.plant', species: 'meadow-grass', pos: here, radius: 12000, density: 0.8 } as Command);
  must({ k: 'life.plant', species: 'berry-bush', pos: here, radius: 1800, density: 0.5 } as Command);
  must({ k: 'life.forest', pos: here, radius: 1400 } as Command);
  sim.step(Math.round(day * 0.5));
  // the ring: homesteadCell over the lit morning face (opening.ts focusGround + poi.ts)
  const fields = new Map<string, Float32Array>();
  for (const [k, v] of Object.entries(p.f)) if (v instanceof Float32Array) fields.set(k, v); else if (v instanceof Float64Array) fields.set(k, Float32Array.from(v));
  const sun = u.sun(p, u.tick).dir, P = p.grid.pos, t0 = fields.get('temperature')!, tm = new Float32Array(t0.length);
  for (let c = 0; c < tm.length; c++) {
    const el = P[c * 3] * sun[0] + P[c * 3 + 1] * sun[1] + P[c * 3 + 2] * sun[2], east = P[c * 3] * sun[2] - P[c * 3 + 2] * sun[0];
    tm[c] = el > 0.25 && east < 0.15 ? t0[c] : -99;
  }
  fields.set('temperature', tm);
  const pv = { grid: p.grid, params: { radius: p.st.radius }, fields, settlements: [] } as never;
  let h = homesteadCell(pv);
  if (h.cell < 0) { fields.set('temperature', t0); h = homesteadCell(pv); }
  const r = must({ k: 'life.spawn-people', species: 'plains-folk', count: 30, ...(h.cell >= 0 ? { pos: posOf(h.cell) } : {}) } as Command);
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id as number;
  must({ k: 'idea.teach', knowledge: 'fire-keeping', settlement: sid } as Command);
  must({ k: 'idea.teach', knowledge: 'fire-making', settlement: sid } as Command);
  const lib0 = p.people.settlements.find((s) => s.id === sid)!.library.length;
  return { sim, sid, lib0 };
}

// (seed 2 at the full grid: the young world goes on cooling under the band — its lakeshore's year fell from 25 to -13 °C
// in two years — and the town froze at its hearth and on the midwinter walk away, alive 7 of 34 at Y2 on the old tree;
// it must leave while the walk is survivable: settlement.ts abandonCheck 'foresee')
for (const [seed, grid] of [[1, 32], [8, 32], [2, 0]] as const) {
  test(`the barren opening, left running with no further act: the band set down at the ring lives (seed ${seed}${grid ? "" : ", full grid"})`, () => {
    const { sim, lib0 } = opening(seed, grid || undefined);
    const p = sim.u.planets[0];
    const year = Math.round(p.st.orbit.period);
    const alive = () => p.people.settlements.filter((s) => s.fallen < 0).reduce((a, s) => a + (p.people.members.get(s.id)?.length ?? 0), 0);
    let low = 30;
    for (let q = 0; q < 12; q++) { sim.step(Math.round(year / 4)); low = Math.min(low, alive()); assert.ok(alive() > 0, `extinct at Y${(q + 1) / 4}`); }
    const n = alive();
    assert.ok(n >= 20, `the band holds on through three years (alive ${n}, low ${low})`);
    // (sim-fix-r2 #2: and it takes root — the village it founds still stands, not fallen and set up again elsewhere;
    // the 10-year, 8-seed full-grid measure is in _harness/scratch/ledgers/sim-fix-r2.md: 0 moves in years 0-5)
    const fell = p.people.settlements.filter((s) => !s.band && s.fallen >= 0).map((s) => s.name);
    assert.deepEqual(fell, [], `no village of the opening band fell or was left in three years (fell: ${fell.join(', ')})`);
    const lib = Math.max(...p.people.settlements.filter((s) => s.fallen < 0).map((s) => s.library.length));
    assert.ok(lib > lib0 + 2, `it found things nobody gave it (library ${lib0} -> ${lib})`);
  });
}

// sim-fix-r3 (items 4 / 8, release owner-r3 runA): on the path the UI takes, the ring is any green cell with fresh water
// (> 4 cm) within two rings (client/poi.ts homesteadCell) — after the god's storm, mostly puddles and storm-wet ground.
// The old landing site (the best siteScore within 5 rings) sat by water that lasts the year for 92 of the 193 such drops on
// the default seed (_harness/scratch/sim-fix-r3/wprobe.ts), and the owner's first village 'dried out' in Year 1. A
// hand-set band now walks to water that lasts (spawn.ts landingCell / lastingWater) when there is any within ~1.7 km.
test('the barren opening: wherever the UI ring can stand, the band settles by water that lasts (default seed 20260)', () => {
  const sim = new Sim({ seed: 20260, scenario: 'barren' });
  const u = sim.u, p = u.planets[0], f = p.f, g = p.grid;
  const day = p.st.dayHours * 60;
  const must = (c: Command) => { const r = sim.applyNow(c); assert.ok(r.ok, `${c.k}: ${r.msg}`); return r; };
  must({ k: 'planet.add-air', amount: 1 } as Command);
  sim.step(Math.round(day * 0.3));
  must({ k: 'weather.global', kind: 'storm' } as Command);
  must({ k: 'water.sea-level', value: -40 } as Command);
  sim.step(day);
  const s0 = u.sun(p, u.tick).dir; const here = [s0[0], s0[1], s0[2]];
  must({ k: 'weather.global', kind: 'none' } as Command);
  must({ k: 'life.plant', species: 'meadow-grass', pos: here, radius: 12000, density: 0.8 } as Command);
  must({ k: 'life.plant', species: 'berry-bush', pos: here, radius: 1800, density: 0.5 } as Command);
  must({ k: 'life.forest', pos: here, radius: 1400 } as Command);
  sim.step(Math.round(day * 0.5));
  const x = makeCtx(u, p), sp = x.c.species.idx('plains-folk');
  const sun = u.sun(p, u.tick).dir, P = g.pos;
  const wetW = (o: number) => f.water[o] > 0.04 && f.water[o] < 4;
  const lastingBy = (c: number) => { if (lastingWater(x, c)) return true; for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (lastingWater(x, g.nbr[e])) return true; return false; };
  let drops = 0, good = 0;
  for (let c = 0; c < p.count; c += 2) {
    const el = P[c * 3] * sun[0] + P[c * 3 + 1] * sun[1] + P[c * 3 + 2] * sun[2];
    if (!(el > 0.4 && f.grass[c] > 0.05 && !p.s.ocean[c] && f.water[c] <= 0.03 && f.temperature[c] >= 8 && f.temperature[c] <= 30)) continue;
    let wet = false;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1] && !wet; e++) { const o = g.nbr[e]; if (wetW(o)) wet = true; for (let e2 = g.nbrStart[o]; e2 < g.nbrStart[o + 1]; e2++) if (wetW(g.nbr[e2])) wet = true; }
    if (!wet) continue;
    drops++;
    if (lastingBy(landingCell(x, sp, c, 5, 30))) good++;
  }
  assert.ok(drops >= 50, `drops ${drops}`);
  assert.ok(good >= drops * 0.9, `a band set down at the ring settles by water that lasts (${good} of ${drops} drops; 92 of 193 on the old site choice)`);
});
