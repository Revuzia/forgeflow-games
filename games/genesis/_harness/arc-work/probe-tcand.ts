// T2 tuning data: unattended sandbox (same setup as _harness/probes/arc.ts unattended) with the tower trigger OFF
// (TOWER.towerChance = 0, so the world is never changed by a tower); on each yearly check day prints every town's raw
// §2.2 inputs (tower.ts towerCandidates) plus the year's roll hashFloat(planet, year, 0x70e1), as one JSON line `C`.
// Offline: _harness/arc-work/tcand-eval.mjs computes the first-attempt year per seed for any (chance, leaderPride,
// leaderPop) combination. Usage: node _harness/arc-work/probe-tcand.ts <seed> [years=60]
import { Sim } from '../../src/sim/sim.ts';
import { TOWER, towerCandidates } from '../../src/sim/god/tower.ts';
import { hash32, hashFloat } from '../../src/sim/core/rng.ts';
TOWER.towerChance = 0;
const seed = Number(process.argv[2] ?? 1), years = Number(process.argv[3] ?? 60);
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
const r = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
if (!r.ok) throw new Error(r.msg);
const p = sim.u.planets[0];
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
// the sim's own day/year (as tower.ts sees them through makeCtx)
const { makeCtx } = await import('../../src/sim/people/ctx.ts');
const x0 = makeCtx(sim.u, p);
const yd = Math.max(1, Math.round(x0.year / x0.day));
const checkDay = hash32(p.id) % Math.min(12, yd);
const end = sim.u.tick + Math.round(years * year);
while (sim.u.tick < end) {
  sim.step(x0.day); sim.drainEvents();
  const dayIdx = Math.floor(sim.u.tick / x0.day);
  if (dayIdx % yd !== checkDay) continue;
  const y = Math.floor(sim.u.tick / x0.year);
  console.log('C ' + JSON.stringify({ seed, y, roll: hashFloat(p.id, y, 0x70e1), towns: towerCandidates(sim.u, p) }));
}
console.log('DONE ' + seed);
