// VALE probe — dynamic resolution steps down only for GPU-bound frames (r12 B4, src/render/quality.ts).
// A smaller buffer cannot shorten a frame the CPU is late on: CPU-late seconds must hold the scale (and give
// resolution back while the GPU has headroom); GPU-late seconds step it down; untimed drivers fall back to the
// renderer's own CPU time.
import { DynamicResolution } from '../src/render/quality.ts';

let fails = 0;
const run = (label: string, frames: number, iv: number, cpu: number, gpu: number | null, lowered = false): number => {
  const d = new DynamicResolution();
  d.configure(1, 0);
  if (lowered) for (let i = 0; i < 400; i++) d.sample(25, 2, 22);
  const s0 = d.scale;
  for (let i = 0; i < frames; i++) d.sample(iv, cpu, gpu);
  console.log(`${label.padEnd(48)} scale ${s0.toFixed(2)} -> ${d.scale.toFixed(2)}  bound '${d.bound}'`);
  return d.scale;
};
const expect = (ok: boolean, m: string): void => { if (!ok) { fails++; console.log(`FAIL ${m}`); } };

expect(run('CPU-late, GPU 8 ms (timed)', 240, 25, 20, 8) === 1, 'a CPU-bound second must hold the scale');
expect(run('GPU-late, GPU 22 ms (timed)', 240, 25, 4, 22) < 1, 'a GPU-bound second must step the scale down');
expect(run('untimed, renderer CPU 4 ms of a 25 ms frame', 240, 25, 4, null) < 1, 'untimed + light renderer CPU reads as GPU-bound');
expect(run('untimed, renderer CPU 18 ms of a 25 ms frame', 240, 25, 18, null) === 1, 'untimed + heavy renderer CPU must hold');
expect(run('lowered, then CPU-late with GPU headroom', 400, 25, 20, 6, true) > 0.8 + 1e-6, 'a lowered scale recovers while CPU-bound with GPU headroom');
expect(run('lowered, still GPU-late', 400, 25, 4, 22, true) <= 0.8 + 1e-6, 'a lowered scale stays down while GPU-bound');
expect(run('on target (16.6 ms)', 240, 16.6, 6, 8) === 1, 'on target holds');
expect(run('headroom (10 ms, 13 s) from a lowered scale', 1300, 10, 4, 5, true) === 1, 'headroom climbs back to the base');

console.log(fails ? `probe_render_dynres: ${fails} FAILURE(S)` : 'probe_render_dynres: PASS');
process.exit(fails ? 1 : 0);
