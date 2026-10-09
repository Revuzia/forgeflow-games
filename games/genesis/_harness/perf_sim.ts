// GENESIS — sim throughput harness (CONTRACT.md §6.1 budget: ≥ 1 000 ticks/s for the home world without agents).
//
//   node _harness/perf_sim.ts                          # sandbox, twoworlds, system: idle and planet-wide monsoon
//   node _harness/perf_sim.ts sandbox twoworlds        # some scenarios
//   node _harness/perf_sim.ts --ticks=2880 --reps=5    # ticks per measured rep, reps per phase (median reported)
//   node _harness/perf_sim.ts --profile                # + per-system time breakdown (ms per tick) for each phase
//   node _harness/perf_sim.ts --no-monsoon --warm=4320
//
// Each scenario: build (timed), warm up (`--warm` ticks, default 1440: V8 tiers up the hourly kernels slowly, and the
// first game hours are not representative), then IDLE: `--reps` runs of `--ticks` ticks each, reporting the median
// ticks/s by process CPU time (robust on a shared machine; wall time is printed too). Then MONSOON: planet-wide heavy
// rain on the home world (air first on an airless one), 600 ticks to let it reach the ground and run, and the same
// measurement. `--profile` then times every planet system over one more game day per phase by calling the systems on
// the cadences of sim.ts runPlanet (mirrored here; keep in sync), so a regression points at its cause.

import { Sim } from '../src/sim/sim.ts';
import type { Universe } from '../src/sim/world/universe.ts';
import type { Planet } from '../src/sim/world/planet.ts';
import { climateStep, CLIMATE_CADENCE } from '../src/sim/fields/climate.ts';
import { hydroStep, hydroSlowStep, HYDRO_CADENCE, HYDRO_SLOW_CADENCE } from '../src/sim/fields/hydrology.ts';
import { weatherStep, WEATHER_CADENCE } from '../src/sim/fields/weather.ts';
import { fireStep, FIRE_CADENCE } from '../src/sim/fields/fire.ts';
import { terrainStep, TERRAIN_CADENCE } from '../src/sim/fields/terrain.ts';
import { vegetationStep, VEG_CADENCE, VEG_OFFSET } from '../src/sim/fields/vegetation.ts';
import { biomeStep, BIOME_CADENCE } from '../src/sim/fields/biomes.ts';
import { chronicleCheck, CHRONICLE_CADENCE, CHRONICLE_OFFSET } from '../src/sim/chronicle.ts';

const argv = process.argv.slice(2);
const opt = (name: string, def: number): number => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);
const scenarios = argv.filter((a) => !a.startsWith('--'));
if (!scenarios.length) scenarios.push('sandbox', 'twoworlds', 'system');
const TICKS = opt('ticks', 1440);
const REPS = opt('reps', 3);
const WARM = opt('warm', 1440);
const PROFILE = flag('profile');
const MONSOON = !flag('no-monsoon');

// optional phase-2 systems (time them in the profile when present)
type Step = (u: Universe, p: Planet, t: number) => void;
let peopleStep: Step | null = null;
try {
  peopleStep = ((await import('../src/sim/people/people.ts')) as { peopleStep?: Step }).peopleStep ?? null;
} catch {
  peopleStep = null;
}

function cpuMs(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}

function median(x: number[]): number {
  const s = [...x].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** median ticks/s (CPU time) and wall ticks/s over `reps` runs of `ticks` */
function measure(sim: Sim): { cpu: number; wall: number; runs: number[] } {
  const runs: number[] = [];
  const walls: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const c0 = cpuMs(), w0 = performance.now();
    sim.step(TICKS);
    runs.push((TICKS / (cpuMs() - c0)) * 1000);
    walls.push((TICKS / (performance.now() - w0)) * 1000);
  }
  return { cpu: median(runs), wall: median(walls), runs };
}

function activeCells(sim: Sim): string {
  return sim.u.planets.map((p) => {
    let a = 0;
    for (let c = 0; c < p.count; c++) if (p.s.hAct[c]) a++;
    return `${p.name}:${a}`;
  }).join(' ');
}

/**
 * Per-system cost over `ticks` ticks: the systems of sim.ts runPlanet on their cadences (mirrored), each timed.
 * Advances the universe like Sim.step (without commands / keyframes).
 */
function profile(sim: Sim, ticks: number): { perTick: Map<string, number>; total: number } {
  const u = sim.u;
  const acc = new Map<string, number>();
  const time = (k: string, f: () => void): void => {
    const t0 = performance.now();
    f();
    acc.set(k, (acc.get(k) ?? 0) + performance.now() - t0);
  };
  for (let i = 0; i < ticks; i++) {
    const t = u.tick;
    for (const p of u.planets) {
      if (!p.alive) continue;
      const ts = t + p.id * 13;
      const n = `${p.name}.`;
      if (ts % CLIMATE_CADENCE === 0) time(n + 'climate', () => climateStep(u, p));
      if (ts % WEATHER_CADENCE === 0) time(n + 'weather', () => weatherStep(u, p));
      if (t % HYDRO_CADENCE === 0) {
        time(n + 'hydro', () => {
          hydroStep(u, p);
          if (p.springs.length) {
            let expired = false;
            for (const s of p.springs) if (s.life > 0) { s.life = Math.max(0, s.life - HYDRO_CADENCE); if (s.life === 0) expired = true; }
            if (expired) p.springs = p.springs.filter((s) => s.life !== 0);
          }
        });
      }
      if (t % FIRE_CADENCE === 0) time(n + 'fire', () => fireStep(u, p));
      if ((ts + 5) % TERRAIN_CADENCE === 0) time(n + 'terrain', () => terrainStep(u, p));
      if (ts % VEG_CADENCE === VEG_OFFSET) time(n + 'vegetation', () => vegetationStep(u, p));
      if (ts % CHRONICLE_CADENCE === CHRONICLE_OFFSET) time(n + 'chronicle', () => chronicleCheck(u, p));
      if (ts % HYDRO_SLOW_CADENCE === 120) time(n + 'hydroSlow', () => hydroSlowStep(u, p));
      if (ts % BIOME_CADENCE === 360) time(n + 'biomes', () => biomeStep(u, p));
      if (peopleStep) { const ps = peopleStep; time(n + 'people', () => ps(u, p, t)); }
    }
    u.tick = t + 1;
  }
  let total = 0;
  const perTick = new Map<string, number>();
  for (const [k, v] of acc) { perTick.set(k, v / ticks); total += v / ticks; }
  return { perTick, total };
}

function printProfile(label: string, pr: { perTick: Map<string, number>; total: number }): void {
  console.log(`    ${label}: systems ${pr.total.toFixed(3)} ms/tick`);
  const rows = [...pr.perTick.entries()].sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= pr.total * 0.01);
  for (const [k, v] of rows) console.log(`      ${k.padEnd(22)} ${v.toFixed(4)} ms/tick  ${((100 * v) / pr.total).toFixed(1).padStart(5)}%`);
}

console.log(`perf_sim: ${TICKS} ticks x ${REPS} reps per phase (median by CPU time), warm-up ${WARM} ticks${PROFILE ? ', with profile' : ''}`);
const table: string[] = [];
for (const scenario of scenarios) {
  const t0 = performance.now();
  const sim = new Sim({ seed: 1234, scenario });
  const build = performance.now() - t0;
  const home = sim.u.planets[0];
  sim.step(WARM);
  const idle = measure(sim);
  console.log(`${scenario.padEnd(9)} build ${build.toFixed(0)} ms | idle ${idle.cpu.toFixed(0)} ticks/s (wall ${idle.wall.toFixed(0)}) [${idle.runs.map((x) => x.toFixed(0)).join(' ')}] | awake water cells ${activeCells(sim)}`);
  if (PROFILE) printProfile('idle profile (1 game day)', profile(sim, 1440));
  let rainLine = '-';
  if (MONSOON) {
    if (!home.airy) sim.applyNow({ k: 'planet.add-air', planet: home.id, amount: 1 });
    const r = sim.applyNow({ k: 'weather.global', planet: home.id, kind: 'monsoon' });
    if (!r.ok) throw new Error(r.msg);
    sim.step(600); // let the rain reach the ground and start running
    const rain = measure(sim);
    rainLine = rain.cpu.toFixed(0);
    console.log(`${''.padEnd(9)} monsoon ${rain.cpu.toFixed(0)} ticks/s (wall ${rain.wall.toFixed(0)}) [${rain.runs.map((x) => x.toFixed(0)).join(' ')}] | awake water cells ${activeCells(sim)}`);
    if (PROFILE) printProfile('monsoon profile (1 game day)', profile(sim, 1440));
  }
  table.push(`| ${scenario} | ${idle.cpu.toFixed(0)} | ${rainLine} |`);
}
console.log('\n| scenario | idle ticks/s | home-world monsoon ticks/s |\n|---|---|---|');
for (const l of table) console.log(l);
console.log('budget: >= 1000 ticks/s on the terran home world without agents (CONTRACT §6.1); 1000x = 10 000 ticks/s');
