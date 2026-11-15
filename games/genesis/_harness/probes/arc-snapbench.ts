// Lane C task 2: what one snapshot costs at ~1500 agents with an arc history on the books, and what the epithet part of it
// is, cached (epithetOf) against uncached (epithetUncached). Seeded, node, no browser.
//   node _harness/probes/arc-snapbench.ts [agents=1500] [arcEvents=300]
// The world is the sandbox n=64 (vegetation grown) with villages of 60; arcEvents / ages / covenants are written into the
// god state to stand for a long game (the epithet scan is linear in them), so this is the worst case for the scan.
import { Sim } from '../../src/sim/sim.ts';
import { epithetOf, epithetUncached } from '../../src/sim/god/story.ts';

const want = Number(process.argv[2] ?? 1500), nEv = Number(process.argv[3] ?? 300);
const sim = new Sim({ seed: 20260, scenario: 'sandbox', overrides: { vegetation: 1 } });
sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 } as never);
let made = 0;
for (let lat = -36; lat <= 36 && made < want; lat += 18) for (let lon = -170; lon < 180 && made < want; lon += 30) {
  const n = Math.min(60, want - made);
  if (sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: n, lat, lon, era: 'clay', settled: true } as never).ok) made += n;
}
sim.step(600);
const p = sim.u.planets[0];
const R = (sim.u.god.rel ??= {} as never) as NonNullable<typeof sim.u.god.rel>;
const kinds = ['strike', 'warn', 'let', 'confuse', 'defiance', 'answer', 'great', 'kept'] as const;
R.arcEvents = [];
for (let i = 0; i < nEv; i++) R.arcEvents.push({ id: i + 1, planet: p.id, tick: i * 100, kind: kinds[i % kinds.length], name: 'x', towns: [], god: 'wrath', dead: 0 });
const agents = p.people!.agents.count;

const med = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
function time(f: () => void, n: number): number[] { const o: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); o.push(performance.now() - t); } return o; }
sim.snapshot({ full: true });
const N = 200;
// a snapshot on each of N ticks (as the app takes one after each rendered frame): the cache is cold once per tick
const perTick: number[] = [];
for (let i = 0; i < 40; i++) { sim.step(1); const t = performance.now(); sim.snapshot({ include: () => false }); perTick.push(performance.now() - t); }
const repeat = time(() => sim.snapshot({ include: () => false }), N);
const epiCached = time(() => epithetOf(sim.u, p.id), N);
const epiRaw = time(() => epithetUncached(sim.u, p.id), N);
const same = epithetOf(sim.u, p.id) === epithetUncached(sim.u, p.id);
const r = (x: number) => Math.round(x * 1000) / 1000;
console.log('RESULT ' + JSON.stringify({ agents, arcEvents: nEv, snapshotMsPerTick_p50: r(med(perTick)), snapshotMsSameTick_p50: r(med(repeat)),
  epithetCachedMs_p50: r(med(epiCached)), epithetUncachedMs_p50: r(med(epiRaw)), same }));
