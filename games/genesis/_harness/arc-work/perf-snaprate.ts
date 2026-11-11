// PERF s7: the real worker host in-process on the busy save at 1x, asked for a snapshot every 33 ms for N s:
// how many full snapshots vs 'same' answers, and the worker ms spent building them.
//   node _harness/arc-work/perf-snaprate.ts _harness/scratch/arc/perf/world25.gnss 10
import { readFileSync } from 'node:fs';
const out: any[] = [];
const g = globalThis as any;
g.postMessage = (m: any) => out.push(m);
await import('../../src/sim/worker.ts');
const send = (data: unknown) => g.onmessage({ data });
send({ type: 'init', scenario: 'sandbox', seed: 1234, options: { speed: 0 } });
const buf = readFileSync(process.argv[2] ?? '_harness/scratch/arc/perf/world25.gnss');
send({ type: 'load', id: 1, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
send({ type: 'snapshot', full: true });
send({ type: 'speed', speed: Number(process.argv[4] ?? 1) });
const secs = Number(process.argv[3] ?? 10);
let full = 0, same = 0, ms = 0;
const t0 = performance.now();
await new Promise<void>((done) => {
  const iv = setInterval(() => {
    out.length = 0;
    const a = performance.now();
    send({ type: 'snapshot', full: false });
    const b = performance.now();
    if (out.some((m) => m.type === 'same')) same++; else { full++; ms += b - a; }
    if (performance.now() - t0 > secs * 1000) { clearInterval(iv); done(); }
  }, 33);
});
console.log(`${secs} s at ${process.argv[4] ?? 1}x: ${full} full snapshots (${(ms / Math.max(1, full)).toFixed(1)} ms each, ${(ms / secs).toFixed(0)} ms/s), ${same} 'same'`);
process.exit(0);
