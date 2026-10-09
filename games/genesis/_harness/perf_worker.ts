// GENESIS — the sim worker at speed with a populated world (CONTRACT.md §5, §6.1, §14), without a renderer.
//
//   node _harness/perf_worker.ts                     # sandbox n = 64 (vegetation grown), ~1 500 plains folk, 100x and 1000x, 20 s each
//   node _harness/perf_worker.ts 1500 20 100,1000
//
// Hosts the real src/sim/worker.ts on a Node worker thread (the same pacing, slicing and snapshot code the browser
// runs), sets ~N people down through `life.spawn-people` (clay-age villages of 60 over a lat/lon lattice, as
// _harness/perf.mjs --people does in the browser), then runs at each requested multiplier while a client asks for a
// snapshot 30 times a second (as the app does after each rendered frame). Reports the worker's achieved speed, ticks
// per second, and the main thread's snapshot latency. SwiftShader is not involved, so these are the sim's own rates on
// this machine (shared with other jobs: see the load average printed alongside).

import { Worker } from 'node:worker_threads';
import { loadavg } from 'node:os';
import type { FromWorker, Snapshot, ToWorker } from '../src/sim/types.ts';

const args = process.argv.slice(2);
const want = Number(args[0] ?? 1500);
const secs = Number(args[1] ?? 20);
const speeds = String(args[2] ?? '100,1000').split(',').map(Number);

const w = new Worker(new URL('../tests/helpers/workerboot.ts', import.meta.url));
const waiting: { pred: (m: FromWorker) => boolean; ok: (m: FromWorker) => void }[] = [];
w.on('message', (m: FromWorker) => {
  if (m.type === 'error') { console.error('worker error', m.msg, m.stack); process.exit(1); }
  for (let i = 0; i < waiting.length; i++) if (waiting[i].pred(m)) { waiting[i].ok(m); waiting.splice(i, 1); return; }
});
const next = <T extends FromWorker>(pred: (m: FromWorker) => boolean): Promise<T> => new Promise((ok) => waiting.push({ pred, ok: (m) => ok(m as T) }));
const send = (m: ToWorker): void => w.postMessage(m);
let id = 1;
async function call<T extends FromWorker>(m: ToWorker & { id: number }): Promise<T> {
  const p = next<T>((x) => 'id' in x && (x as { id: number }).id === m.id);
  send(m);
  return p;
}
async function snapshot(): Promise<Snapshot> {
  const p = next<{ type: 'snapshot'; snap: Snapshot }>((x) => x.type === 'snapshot');
  send({ type: 'snapshot' });
  return (await p).snap;
}

await next((m) => (m as { type: string }).type === '__booted');
const ready = next((m) => m.type === 'ready');
// the sandbox with its vegetation grown (as _harness/perf_people.ts and the tests use it): people need food
send({ type: 'init', scenario: 'sandbox', seed: 20260, options: { speed: 0, grad: true, overrides: { vegetation: 1 } } });
await ready;
// natural disasters off unless NATURAL=1 (perf push 2 round 2): a natural quake wakes the whole sea for ~1.5 game days at a
// third of the usual rate, so a 20 s window across one measures luck, not the sim
if (process.env.NATURAL !== '1') await call({ type: 'cmd', id: id++, cmd: { k: 'set', path: 'disasters.natural', value: 0 } });
let made = 0, villages = 0;
for (let lat = -36; lat <= 36 && made < want; lat += 18) {
  for (let lon = -170; lon < 180 && made < want; lon += 30) {
    const n = Math.min(60, want - made);
    const r = await call<{ type: 'result'; id: number; result: { ok: boolean } }>({ type: 'cmd', id: id++, cmd: { k: 'life.spawn-people', species: 'plains-folk', count: n, lat, lon, era: 'clay', settled: true } });
    if (r.result.ok) { made += n; villages++; }
  }
}
await call({ type: 'step', id: id++, ticks: 600 });
const s0 = await snapshot();
const pl = s0.planets[0];
console.log(`sandbox n=${pl.gridN}: ${made} people set down in ${villages} villages; ${pl.agents?.count ?? 0} agents, ${pl.buildings?.count ?? 0} buildings, ${pl.settlements?.length ?? 0} settlements, ${pl.animals?.count ?? 0} animals drawn`);

for (const sp of speeds) {
  send({ type: 'speed', speed: sp });
  // let the worker's measuring window fill
  await new Promise((ok) => setTimeout(ok, 3500));
  const a = await snapshot();
  const t0 = performance.now();
  const lat: number[] = [];
  const achieved: number[] = [];
  let last = a;
  while (performance.now() - t0 < secs * 1000) {
    const q = performance.now();
    last = await snapshot();
    lat.push(performance.now() - q);
    achieved.push(last.achievedSpeed);
    await new Promise((ok) => setTimeout(ok, 33));
  }
  const wall = (performance.now() - t0) / 1000;
  lat.sort((x, y) => x - y);
  const mean = achieved.reduce((x, y) => x + y, 0) / Math.max(1, achieved.length);
  console.log(`${String(sp).padStart(5)}x requested: ${((last.tick - a.tick) / wall).toFixed(0)} ticks/s over ${wall.toFixed(1)} s (achieved ×${mean.toFixed(1)}), ` +
    `sim ${last.msPerTick.toFixed(3)} ms/tick, snapshot round trip p50 ${lat[Math.floor(lat.length / 2)].toFixed(1)} ms / p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(1)} ms, ` +
    `${last.planets[0].agents?.count ?? 0} agents; load average ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
}
send({ type: 'speed', speed: 0 });
await w.terminate();
