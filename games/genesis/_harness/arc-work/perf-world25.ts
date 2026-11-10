// PERF lane: build a lived-in world for the play probe — sandbox, vegetation sown, ~900 plains folk in 15 clay-age
// villages, then N game years (sandbox: 12-day years, 1 tick = 1 game minute). Writes the GNSS save.
//   node _harness/arc-work/perf-world25.ts 25 _harness/scratch/arc/perf/world25.gnss
import { writeFileSync } from 'node:fs';
import { Sim } from '../../src/sim/sim.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
import { bestSiteOnPlanet, spawnPeople } from '../../src/sim/people/spawn.ts';

const years = Number(process.argv[2] ?? 25);
const out = process.argv[3] ?? '_harness/scratch/arc/perf/world25.gnss';
const sim = new Sim({ seed: 1234, scenario: 'sandbox', overrides: { vegetation: 1 } });
sim.step(600);
const p = sim.u.planets[0];
let made = 0, k = 0;
while (made < 900 && k < 400) {
  const cell = bestSiteOnPlanet(makeCtx(sim.u, p), 0, 1000 + k++);
  if (spawnPeople(sim.u, p, { species: 'plains-folk', count: 60, cell, era: 'clay', settled: true })) made += 60;
}
const perYear = 12 * 1440;
const t0 = Date.now();
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 12; d++) sim.step(1440);
  console.log(`year ${y}: ${p.people.agents.count} alive, ${p.people.settlements.filter((s) => s.fallen < 0).length} settlements, ${p.people.buildings.length} buildings, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (y % 5 === 0 || y === years) writeFileSync(out, sim.save());
}
console.log('saved', out, perYear * years, 'ticks');
