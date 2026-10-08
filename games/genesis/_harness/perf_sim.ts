// GENESIS — sim throughput harness (CONTRACT.md §6.1 budget: ≥ 1 000 ticks/s for the home world without agents).
//
//   node _harness/perf_sim.ts                 # barren + sandbox, idle and in heavy rain
//   node _harness/perf_sim.ts sandbox 3000    # one scenario, N ticks per phase
//
// Each scenario: build (timed), warm up 600 ticks (JIT + the first transients), then measure IDLE ticks/s, then paint
// planet-wide heavy rain (monsoon; on an airless world first give it air) and measure again. Prints per-system time
// shares from a sampling of the cadenced passes so regressions point at their cause.

import { Sim, runPlanet } from '../src/sim/sim.ts';

const args = process.argv.slice(2);
const scenarios = args[0] && !/^\d+$/.test(args[0]) ? [args[0]] : ['barren', 'sandbox'];
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 2000);

function now(): number {
  return performance.now();
}

function measure(sim: Sim, ticks: number): number {
  const t0 = now();
  sim.step(ticks);
  return (ticks / (now() - t0)) * 1000;
}

function activeCells(sim: Sim): string {
  return sim.u.planets.map((p) => {
    let a = 0;
    for (let c = 0; c < p.count; c++) if (p.s.hAct[c]) a++;
    return `${p.name}:${a}`;
  }).join(' ');
}

const results: string[] = [];
for (const scenario of scenarios) {
  const t0 = now();
  const sim = new Sim({ seed: 1234, scenario });
  const build = now() - t0;
  const home = sim.u.planets[0];
  sim.step(600);
  const idle = measure(sim, N);
  const idleActive = activeCells(sim);
  // heavy rain everywhere (air first on an airless world)
  if (!home.airy) sim.applyNow({ k: 'planet.add-air', planet: home.id, amount: 1 });
  const r = sim.applyNow({ k: 'weather.global', planet: home.id, kind: 'monsoon' });
  if (!r.ok) throw new Error(r.msg);
  sim.step(300); // let the rain reach the ground and start running
  const rain = measure(sim, N);
  const rainActive = activeCells(sim);
  // where does the time go? time each planet pass over one simulated day at the current state
  const u = sim.u;
  const share: Record<string, number> = {};
  const base = u.tick;
  const tSys = now();
  for (let t = base; t < base + 1440; t++) for (const p of u.planets) {
    const s0 = now();
    runPlanet(u, p, t);
    share[p.name] = (share[p.name] ?? 0) + (now() - s0);
  }
  void tSys;
  u.tick = base; // runPlanet does not advance the tick; restore for honesty (state moved on, not compared)
  const line = `${scenario.padEnd(8)} build ${build.toFixed(0)} ms | idle ${idle.toFixed(0)} ticks/s [${idleActive}] | heavy rain ${rain.toFixed(0)} ticks/s [${rainActive}] | ms per game day (rainy state) ${Object.entries(share).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`;
  console.log(line);
  results.push(line);
}
const target = 1000;
console.log(`target: >= ${target} ticks/s on the terran home world without agents (CONTRACT §6.1)`);
