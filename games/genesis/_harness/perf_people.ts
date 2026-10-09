// GENESIS — peoples' throughput harness (CONTRACT.md §6.1: 1 500 agents on the n = 64 terran world, >= 1 000 ticks/s).
//
//   node _harness/perf_people.ts                 # 1 500 plains folk, 2 game days measured
//   node _harness/perf_people.ts 3000 3          # agents, days
//
// The n = 64 terran world (the sandbox, its vegetation grown) is measured twice in one process over the same game days:
// once without people, once populated by `agents` plains folk in settled clay-age villages of 60 at the best sites.
// The days are interleaved so machine noise hits both alike. Rates are reported by process CPU time (robust on a
// shared machine) and by wall time; the difference between the runs is the peoples' own cost per tick (decisions,
// movement, settlements, herds, and whatever the fields do differently because people live there).
// (_harness/perf_sim.ts measures the field systems of the scenarios without agents.)

import { Sim } from '../src/sim/sim.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { bestSiteOnPlanet, spawnPeople } from '../src/sim/people/spawn.ts';

const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const agents = Number(args[0] ?? 1500);
const days = Number(args[1] ?? 2);

const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const world = (): Sim => new Sim({ seed: 1234, scenario: 'sandbox', overrides: { vegetation: 1 } });

// the same world, empty
const empty = world();
empty.step(600);
// populated
const t0 = performance.now();
const sim = world();
const p = sim.u.planets[0];
let made = 0, k = 0;
while (made < agents && k < 400) {
  const cell = bestSiteOnPlanet(makeCtx(sim.u, p), 0, 1000 + k++);
  const n = Math.min(60, agents - made);
  if (spawnPeople(sim.u, p, { species: 'plains-folk', count: n, cell, era: 'clay', settled: true })) made += n;
}
const spawnMs = performance.now() - t0;
sim.step(600);

let wEmpty = 0, wFull = 0, cEmpty = 0, cFull = 0;
for (let d = 0; d < days; d++) {
  let w = performance.now(), c = cpu();
  empty.step(1440);
  wEmpty += performance.now() - w; cEmpty += cpu() - c;
  w = performance.now(); c = cpu();
  sim.step(1440);
  wFull += performance.now() - w; cFull += cpu() - c;
}
const ticks = days * 1440;
const alive = p.people.agents.count;
const standing = p.people.settlements.filter((st) => st.fallen < 0).length;
const rate = (ms: number) => ((ticks / ms) * 1000).toFixed(0);
console.log(`people: ${made} plains folk in ${p.people.settlements.length} villages (world + spawn ${spawnMs.toFixed(0)} ms); after ${days} game days ${alive} alive in ${standing} settlements, ${p.people.buildings.length} buildings, ${p.people.herds.length} herds`);
console.log(`  by CPU time:  world alone ${rate(cEmpty)} ticks/s (${(cEmpty / ticks).toFixed(3)} ms/tick) | with ${alive} agents ${rate(cFull)} ticks/s (${(cFull / ticks).toFixed(3)} ms/tick) | peoples ${((cFull - cEmpty) / ticks).toFixed(3)} ms/tick (${(((cFull - cEmpty) / ticks) * 1000 / Math.max(1, alive)).toFixed(2)} µs per agent per tick)`);
console.log(`  by wall time: world alone ${rate(wEmpty)} ticks/s | with agents ${rate(wFull)} ticks/s | peoples ${((wFull - wEmpty) / ticks).toFixed(3)} ms/tick`);
console.log('target: >= 1000 ticks/s with 1500 agents on the n=64 terran world (CONTRACT §6.1)');
