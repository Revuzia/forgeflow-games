// PERF s10 item 7: 1000x then the '1' key (speed 1): does the worker come back to 1x (speed, lapse level, tick rate)?
//   node _harness/arc-work/perf-speed1.ts [save]
import { readFileSync } from 'node:fs';
const out: any[] = [];
const g = globalThis as any;
g.postMessage = (m: any) => out.push(m);
await import('../../src/sim/worker.ts');
const send = (data: unknown) => g.onmessage({ data });
send({ type: 'init', scenario: 'sandbox', seed: 1234, options: { speed: 0 } });
if (process.argv[2]) { const buf = readFileSync(process.argv[2]); send({ type: 'load', id: 1, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }); }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const look = (tag: string) => {
  out.length = 0; send({ type: 'snapshot', full: true });
  const s = out.find((m) => m.type === 'snapshot' || m.type === 'same');
  const v = s?.snap ?? s;
  console.log(tag, 'tick', v?.tick, 'speed', v?.speed, 'achieved', v?.achievedSpeed?.toFixed?.(1), 'lapse', v?.lapseLevel, 'errors', out.filter((m) => m.type === 'error').map((m) => m.msg));
};
send({ type: 'speed', speed: 1000 });
for (let i = 0; i < 4; i++) { await wait(1500); look(`1000x t=${(i + 1) * 1.5}s`); }
const t = performance.now(); send({ type: 'speed', speed: 1 }); console.log('setSpeed(1) handled in', (performance.now() - t).toFixed(0), 'ms');
for (let i = 0; i < 4; i++) { await wait(1500); look(`1x t=${(i + 1) * 1.5}s`); }
process.exit(0);
