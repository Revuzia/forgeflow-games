// VALE probe — dynamic resolution on a vsync display (perf PERF-M2, src/render/quality.ts).
// A 60 Hz display never delivers a frame faster than 16.7 ms, so a lowered scale must come back by probing (a step
// up kept only while the next windows stay on target), GPU timer readings longer than their frame interval are
// contention and must never step the scale down, and a scene that really is GPU-bound must settle without
// flapping. (The renderer-level half, no samples from the menu or its idle cap and a reset per match, is the live
// `dynres` step of _harness/perf_1080.mjs --prod.)
import { DynamicResolution } from '../src/render/quality.ts';

let fails = 0;
const expect = (ok: boolean, m: string): void => { if (!ok) { fails++; console.log(`FAIL ${m}`); } };
// a deterministic jitter (no Math.random: the same run every time)
let seed = 7;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const vsync = (): number => 16.67 + (rnd() - 0.5) * 0.4;

/** the 0.8 floor a menu's 30 fps idle cap used to push the scale to (the bug's starting point) */
function lowered(): DynamicResolution {
  const d = new DynamicResolution();
  d.configure(1, 0);
  for (let i = 0; i < 400; i++) d.sample(25, 2, 22);
  return d;
}
/** feed `sec` seconds of frames; returns the scale over time (one entry per second) */
function run(d: DynamicResolution, sec: number, frame: (scale: number) => { iv: number; cpu: number; gpu: number | null }): number[] {
  const out: number[] = [];
  let t = 0, next = 1000;
  while (t < sec * 1000) {
    const f = frame(d.scale);
    d.sample(f.iv, f.cpu, f.gpu);
    t += f.iv;
    if (t >= next) { out.push(d.scale); next += 1000; }
  }
  return out;
}
const fmt = (xs: number[]): string => xs.filter((_, i) => i % 5 === 4).map((x) => x.toFixed(2)).join(' ');

// 1. a lowered scale on an idle 60 Hz display climbs back to base, whatever the GPU timer reads (or if it is absent)
for (const gpu of [null, 3, 8, 12.9]) {
  const d = lowered();
  const s0 = d.scale;
  const tl = run(d, 40, () => ({ iv: vsync(), cpu: 3, gpu }));
  console.log(`60 Hz idle from ${s0.toFixed(2)}, gpu ${String(gpu).padEnd(4)} → ${d.scale.toFixed(2)}  (every 5 s: ${fmt(tl)})`);
  expect(s0 <= 0.8 + 1e-6, 'the lowered start is at the floor');
  expect(d.scale === 1, `60 Hz, gpu ${gpu}: back to base within 40 s`);
  const at = tl.findIndex((x) => x === 1);
  expect(at >= 0 && at < 20, `60 Hz, gpu ${gpu}: base reached within 20 s (at ${at + 1} s)`);
}

// 2. contention: steady 60 fps with GPU readings of 29–31 ms (longer than the frame) and a 2-frame hitch every 2 s
{
  const d = new DynamicResolution();
  d.configure(1, 0);
  let n = 0;
  const tl = run(d, 90, () => { n++; const hitch = n % 120 < 2; return { iv: hitch ? 33.3 : vsync(), cpu: 3, gpu: 29 + rnd() * 2 }; });
  console.log(`contention: gpu 29-31 ms at 60 fps, hitches → ${d.scale.toFixed(2)}  min ${Math.min(...tl).toFixed(2)}`);
  expect(Math.min(...tl) === 1, 'GPU readings longer than the frame interval never step the scale down');
}

// 3. a load that is GPU-bound at 1.0 (GPU ms ∝ pixels: 20 ms at 1.0, on target at 0.9) settles at 0.9 without flapping
{
  const d = new DynamicResolution();
  d.configure(1, 0);
  const frame = (s: number): { iv: number; cpu: number; gpu: number } => { const gpu = 20 * s * s; return { iv: Math.max(vsync(), gpu + 1), cpu: 3, gpu }; };
  const tl = run(d, 180, frame);
  const last = tl.slice(-120);
  let changes = 0;
  for (let i = 1; i < last.length; i++) if (last[i] !== last[i - 1]) changes++;
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  const at09 = last.filter((x) => Math.abs(x - 0.9) < 1e-6).length / last.length;
  console.log(`GPU-bound at 1.0 (20 ms), on target at 0.9 → settles: mean ${mean.toFixed(3)}, ${(at09 * 100).toFixed(0)} % at 0.90, ${changes} changes in the last 120 s  (${fmt(tl)})`);
  expect(at09 >= 0.85, 'a GPU-bound load spends ≥ 85 % of the time at the highest on-target scale');
  expect(changes <= 10, 'failed probes back off (≤ 10 scale changes in 120 s)');
}

// 4. a real GPU-bound scene still steps down (the B4 behaviour stays)
{
  const d = new DynamicResolution();
  d.configure(1, 0);
  run(d, 12, () => ({ iv: 25, cpu: 4, gpu: 22 }));
  console.log(`GPU-late 25 ms, gpu 22 ms → ${d.scale.toFixed(2)}`);
  expect(d.scale < 1, 'a GPU-bound load steps the scale down');
}

// 5. a 120 Hz display (8.3 ms) from the floor climbs as before
{
  const d = lowered();
  run(d, 20, () => ({ iv: 8.33, cpu: 3, gpu: 4 }));
  console.log(`120 Hz from the floor → ${d.scale.toFixed(2)}`);
  expect(d.scale === 1, '120 Hz climbs back to base');
}

// 6. configure (a new match) starts at base; reset drops a window in progress
{
  const d = lowered();
  d.configure(1, 0);
  expect(d.scale === 1, 'configure resets to the base scale');
  const e = new DynamicResolution();
  e.configure(1, 0);
  for (let i = 0; i < 20; i++) e.sample(33.3, 2, null);   // 0.67 s of a 30 fps idle cap …
  e.reset();                                            // … dropped (the renderer resets while it does not sample)
  for (let i = 0; i < 70; i++) e.sample(16.67, 2, null);  // without the reset this window would average 24.8 ms
  expect(e.scale === 1 && e.bound === '', 'a dropped capped window never counts as slow');
}

console.log(fails ? `probe_render_dynres_vsync: ${fails} FAILURE(S)` : 'probe_render_dynres_vsync: PASS');
process.exit(fails ? 1 : 0);
