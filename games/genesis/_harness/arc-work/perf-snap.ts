// PERF s7: what one renderer snapshot costs (sim side build + structured clone) on the busy save, and what changes
// between two snapshots with no tick in between.  node _harness/arc-work/perf-snap.ts _harness/scratch/arc/perf/world25.gnss
import { readFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { Sim } from '../../src/sim/sim.ts';
const sim = Sim.load(new Uint8Array(readFileSync(process.argv[2] ?? '_harness/scratch/arc/perf/world25.gnss')));
sim.snapshot({ full: true });
const N = 30;
let tb = 0, tc = 0, bytes = 0;
const parts: Record<string, number> = {};
let last: any = null;
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const s: any = sim.snapshot({ include: () => false });
  const t1 = performance.now();
  structuredClone(s);
  const t2 = performance.now();
  tb += t1 - t0; tc += t2 - t1;
  bytes = serialize(s).byteLength;
  if (i === N - 1) {
    for (const [k, v] of Object.entries(s)) parts[k] = serialize(v).byteLength;
    for (const [k, v] of Object.entries(s.planets[0])) parts['p0.' + k] = serialize(v).byteLength;
  }
  last = s;
}
console.log(`no-tick snapshot: build ${(tb / N).toFixed(2)} ms, clone ${(tc / N).toFixed(2)} ms, ${(bytes / 1024).toFixed(0)} kB`);
console.log(Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)}kB`).join('\n'));
const a = JSON.stringify(sim.snapshot({ include: () => false })), b = JSON.stringify(sim.snapshot({ include: () => false }));
console.log('two no-tick snapshots identical (JSON):', a === b);
