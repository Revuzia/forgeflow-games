// probe (lane SIM): whole-sim tick cost through the facade — the 140 m three-lane map, 10 bot
// fighters (fixture bots pushing every lane), full minion waves on 3 lanes, 4 camps, 30
// structures, economy/vision/modes all on — for 6 game minutes. Reports ms/tick and ticks/s.
// Budget (30 Hz needs < 33 ms): average < 2 ms, p99 < 8 ms. Timing on a shared machine is noisy
// (GC, other processes): the budget takes the best of up to 3 identical deterministic runs.
import { matchCatalog, riftSetup } from './fixtures/match_fixture.ts';
import { fixtureBots } from './fixtures/fixture_bot.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import { createSim } from '../src/sim/sim.ts';

const cat = matchCatalog();
const SECONDS = 360;

interface Run { avg: number; p50: number; p99: number; max: number; tps: number; peakMinions: number; peakEntities: number; deaths: number; ended: boolean; first: number }
function measure(): Run {
  const tBuild = performance.now();
  const sim = createSim(cat, riftSetup({ seed: 2026 }), { bots: fixtureBots(() => 'push', { lane: (s) => s.player % 3 }) });
  const build = performance.now() - tBuild;
  const times: number[] = [];
  let peakMinions = 0, peakEntities = 0, deaths = 0;
  const N = (SECONDS + 5) * 30;
  const t0 = performance.now();
  for (let i = 0; i < N && sim.view.phase !== 'ended'; i++) {
    const a = performance.now();
    const ev = sim.step();
    times.push(performance.now() - a);
    for (const e of ev) if (e.e === 'death') deaths++;
    if (i % 30 === 0) {
      let m = 0;
      for (const e of sim.view.entities) if (e.kind === 'minion' && e.alive) m++;
      peakMinions = Math.max(peakMinions, m);
      peakEntities = Math.max(peakEntities, sim.view.entities.length);
    }
  }
  const wall = performance.now() - t0;
  const first = times[0] + build;
  const s = times.slice(30).sort((x, y) => x - y); // the first second includes lazy nav setup (reported separately)
  return {
    avg: s.reduce((x, y) => x + y, 0) / s.length, p50: s[Math.floor(s.length * 0.5)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1],
    tps: (times.length / wall) * 1000, peakMinions, peakEntities, deaths, ended: sim.view.phase === 'ended', first,
  };
}

section(`three-lane 5v5, ${SECONDS} s`, () => {
  const runs: Run[] = [];
  for (let k = 0; k < 3; k++) {
    const r = measure();
    runs.push(r);
    console.log(`  info: run ${k + 1}: avg ${r.avg.toFixed(3)} ms/tick, p50 ${r.p50.toFixed(3)}, p99 ${r.p99.toFixed(3)}, max ${r.max.toFixed(2)}; ` +
      `${Math.round(r.tps)} ticks/s (${(r.tps / 30).toFixed(0)}× real time); peak ${r.peakMinions} minions / ${r.peakEntities} entities; ` +
      `${r.deaths} deaths; createSim + first tick ${r.first.toFixed(1)} ms`);
    if (r.avg < 2 && r.p99 < 8) break;
  }
  const r = runs[0];
  check('full waves were up (≥ 60 minions alive at the peak)', r.peakMinions >= 60, r.peakMinions);
  check('units died throughout', r.deaths > 200, r.deaths);
  const avg = Math.min(...runs.map((x) => x.avg)), p99 = Math.min(...runs.map((x) => x.p99));
  check('average tick < 2 ms (best of runs)', avg < 2, avg.toFixed(3));
  check('p99 tick < 8 ms (best of runs)', p99 < 8, p99.toFixed(3));
});

finish('probe_sim_perf');
