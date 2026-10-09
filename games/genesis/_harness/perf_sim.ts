// GENESIS — sim throughput harness (CONTRACT.md §6.1 budget: ≥ 1 000 ticks/s for the home world without agents).
//
//   node _harness/perf_sim.ts                          # sandbox, twoworlds, system: idle and planet-wide monsoon,
//                                                      # at 1x (level 0) and at the 1000x time-lapse level
//   node _harness/perf_sim.ts sandbox twoworlds        # some scenarios
//   node _harness/perf_sim.ts --scales=1,100,1000      # speed presets to measure (time.scale; 1 and 10 = level 0)
//   node _harness/perf_sim.ts --agents=1500 sandbox    # + that many plains folk on the home world (sown: vegetation 1)
//   node _harness/perf_sim.ts --ticks=2880 --reps=5    # ticks per measured rep, reps per phase (median reported)
//   node _harness/perf_sim.ts --profile                # + where the time goes (CPU profile, self time by system)
//   node _harness/perf_sim.ts --no-monsoon --warm=4320
//   node _harness/perf_sim.ts --natural               # keep the god layer's natural disasters on (default: law set to 0)
//
// Each scenario × speed: build (timed), `time.scale` (the logged speed level the worker issues for that preset), warm
// up (`--warm` ticks, default 1440: V8 tiers up the hourly kernels slowly, and the first game hours are not
// representative), then IDLE: `--reps` runs of `--ticks` ticks each, reporting the median ticks/s by process CPU time
// (robust on a shared machine; wall time is printed too). Then MONSOON: planet-wide heavy rain on the home world (air
// first on an airless one), 600 ticks to let it reach the ground and run, and the same measurement. `--profile` then
// samples one more game day per phase with the V8 CPU profiler and splits the self time by system (by source file),
// so a regression points at its cause without mirroring sim.ts's cadences here.
//
// The load average is printed: on a shared machine compare runs made side by side (interleave A/B), not across hours.
//
// Natural disasters (the god layer's `disasters.natural` law, 1 by default) are set to 0 unless --natural: a natural
// quake wakes the whole sea for ~1.5 game days at a third of the idle rate, so an 'idle' figure measured across one
// is luck (perf push 2 round 2). With --natural the figures include whatever the seed's disasters do.

import { Session } from 'node:inspector/promises';
import { loadavg } from 'node:os';
import { Sim } from '../src/sim/sim.ts';

const argv = process.argv.slice(2);
const opt = (name: string, def: number): number => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const optList = (name: string, def: number[]): number[] => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1].split(',').map(Number) : def;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);
const scenarios = argv.filter((a) => !a.startsWith('--'));
if (!scenarios.length) scenarios.push('sandbox', 'twoworlds', 'system');
const TICKS = opt('ticks', 1440);
const REPS = opt('reps', 3);
const WARM = opt('warm', 1440);
const AGENTS = opt('agents', 0);
const SCALES = optList('scales', [1, 1000]);
const PROFILE = flag('profile');
const MONSOON = !flag('no-monsoon');
const NATURAL = flag('natural');

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

/** the system a profiled function belongs to, by its source file */
function systemOf(url: string, fn: string): string {
  if (/fields\/hydrology|core\/activeset/.test(url)) return 'hydrology';
  if (/fields\/climate|grid\/noise/.test(url)) return 'climate';
  if (/fields\/weather|perf\/cap/.test(url)) return 'weather';
  if (/fields\/vegetation/.test(url)) return 'vegetation';
  if (/fields\/terrain/.test(url)) return 'terrain';
  if (/fields\/biomes/.test(url)) return 'biomes';
  if (/fields\/fire/.test(url)) return 'fire';
  if (/core\/kfcodec/.test(url) || (/sim\/sim\.ts/.test(url) && /keyframe|encode/i.test(fn))) return 'keyframes';
  if (/people\/|life\/|recipes\/|grid\/pathfind|core\/timewheel|grid\/spatial/.test(url)) return 'people';
  if (/god\//.test(url)) return 'god';
  if (/garbage collector/.test(fn)) return 'gc';
  if (/inspector/.test(url) || fn === '(program)' || fn === '(idle)') return '(profiler)';
  return 'other';
}

/** CPU-profile `ticks` ticks and split the self time by system */
async function profile(sim: Sim, ticks: number): Promise<{ rows: [string, number][]; msPerTick: number }> {
  const s = new Session();
  s.connect();
  await s.post('Profiler.enable');
  await s.post('Profiler.setSamplingInterval', { interval: 250 });
  await s.post('Profiler.start');
  const c0 = cpuMs();
  sim.step(ticks);
  const cpu = cpuMs() - c0;
  const { profile: prof } = await s.post('Profiler.stop');
  s.disconnect();
  const byId = new Map<number, { callFrame: { url: string; functionName: string } }>();
  for (const n of prof.nodes) byId.set(n.id, n);
  const acc = new Map<string, number>();
  let total = 0;
  const dt = prof.timeDeltas ?? [];
  for (let i = 0; i < (prof.samples ?? []).length; i++) {
    const n = byId.get(prof.samples![i])!;
    const k = systemOf(n.callFrame.url, n.callFrame.functionName);
    const t = dt[i] ?? 0;
    acc.set(k, (acc.get(k) ?? 0) + t);
    total += t;
  }
  const rows = [...acc.entries()].map(([k, v]) => [k, v / Math.max(1, total)] as [string, number]).sort((a, b) => b[1] - a[1]);
  return { rows, msPerTick: cpu / ticks };
}

function printProfile(label: string, pr: { rows: [string, number][]; msPerTick: number }): void {
  console.log(`    ${label}: ${pr.msPerTick.toFixed(3)} ms/tick CPU (profiler on)`);
  console.log('      ' + pr.rows.filter(([, f]) => f >= 0.01).map(([k, f]) => `${k} ${(100 * f).toFixed(1)}%`).join(' · '));
}

/** `n` plains folk in settled clay-age villages of 60 at the best sites of the home world (as _harness/perf_people.ts) */
async function populate(sim: Sim, n: number): Promise<number> {
  const { makeCtx } = await import('../src/sim/people/ctx.ts');
  const { bestSiteOnPlanet, spawnPeople } = await import('../src/sim/people/spawn.ts');
  const p = sim.u.planets[0];
  let made = 0, k = 0;
  while (made < n && k < 400) {
    const cell = bestSiteOnPlanet(makeCtx(sim.u, p), 0, 1000 + k++);
    const m = Math.min(60, n - made);
    if (spawnPeople(sim.u, p, { species: 'plains-folk', count: m, cell, era: 'clay', settled: true })) made += m;
  }
  return made;
}

console.log(`perf_sim: ${TICKS} ticks x ${REPS} reps per phase (median by CPU time), warm-up ${WARM} ticks, speeds ${SCALES.join(' / ')}x${AGENTS ? `, ${AGENTS} agents` : ''}${PROFILE ? ', with profile' : ''}, natural disasters ${NATURAL ? 'on' : 'off'}; load ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
const table: string[] = [];
for (const scenario of scenarios) {
  for (const scale of SCALES) {
    const t0 = performance.now();
    const sim = new Sim({ seed: 1234, scenario, overrides: AGENTS ? { vegetation: 1 } : undefined });
    const build = performance.now() - t0;
    if (!NATURAL) {
      const r = sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 });
      if (!r.ok) throw new Error(r.msg);
    }
    const made = AGENTS ? await populate(sim, AGENTS) : 0;
    if (scale > 1) {
      const r = sim.applyNow({ k: 'time.scale', scale });
      if (!r.ok) throw new Error(r.msg);
    }
    const home = sim.u.planets[0];
    sim.step(WARM);
    const idle = measure(sim);
    const who = `${scenario} @${scale}x`;
    const agents = AGENTS ? ` | agents ${home.people.agents.count} (of ${made})` : '';
    console.log(`${who.padEnd(16)} build ${build.toFixed(0)} ms | idle ${idle.cpu.toFixed(0)} ticks/s (wall ${idle.wall.toFixed(0)}) [${idle.runs.map((x) => x.toFixed(0)).join(' ')}] | awake water cells ${activeCells(sim)}${agents}`);
    if (PROFILE) printProfile('idle profile (1 game day)', await profile(sim, 1440));
    let rainLine = '-';
    if (MONSOON) {
      if (!home.airy) sim.applyNow({ k: 'planet.add-air', planet: home.id, amount: 1 });
      const r = sim.applyNow({ k: 'weather.global', planet: home.id, kind: 'monsoon' });
      if (!r.ok) throw new Error(r.msg);
      sim.step(600); // let the rain reach the ground and start running
      const rain = measure(sim);
      rainLine = rain.cpu.toFixed(0);
      console.log(`${''.padEnd(16)} monsoon ${rain.cpu.toFixed(0)} ticks/s (wall ${rain.wall.toFixed(0)}) [${rain.runs.map((x) => x.toFixed(0)).join(' ')}] | awake water cells ${activeCells(sim)}`);
      if (PROFILE) printProfile('monsoon profile (1 game day)', await profile(sim, 1440));
    }
    table.push(`| ${scenario} | ${scale}x | ${idle.cpu.toFixed(0)} | ${rainLine} |`);
  }
}
console.log(`\n| scenario | speed preset | idle ticks/s | home-world monsoon ticks/s |\n|---|---|---|---|`);
for (const l of table) console.log(l);
console.log('budget: >= 1000 ticks/s on the terran home world with 1 500 agents at 100x (CONTRACT §6.1); 1000x = 10 000 ticks/s');
