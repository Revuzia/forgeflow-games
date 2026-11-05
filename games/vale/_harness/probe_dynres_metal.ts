// VALE probe — perf PERF-C1: dynamic resolution on a GPU timer that does not measure frames (ANGLE Metal: Chrome on
// a Mac). The closing review measured its readings at 90 % over the frame interval at a steady 60 fps and 100 % over
// it in a GPU-bound frame (p50 114 ms at Ultra 1080p, 33 fps), and the old drop rule then never saw a GPU-bound
// window. src/render/quality.ts now distrusts such a timer and classifies by the renderer's CPU time.
//   node _harness/probe_dynres_metal.ts
// A simulated GPU: a frame costs fixed + k · scale² ms of GPU time, vsync at 60 Hz rounds the interval up to a
// whole number of 16.67 ms frames, the Metal timer reads 3× the frame interval (always past it).
import { DynamicResolution } from '../src/render/quality.ts';

let fails = 0;
const expect = (ok: boolean, m: string): void => { if (!ok) { fails++; console.log(`FAIL ${m}`); } };
const VS = 1000 / 60;

interface Run { leftAt: number | null; end: number; tailFps: number; trusted: boolean; scales: number[] }
/** `sec` seconds of frames; `cost(scale)` GPU ms; `reading(cost, iv)` the timer (null = none); cpu the renderer's ms */
function sim(sec: number, cost: (s: number) => number, reading: (c: number, iv: number) => number | null, cpu: number, base = 1): Run {
  const d = new DynamicResolution();
  d.configure(base, 0);
  let t = 0, leftAt: number | null = null, sec1 = 0;
  const fpsBySec: number[] = [];
  let frames = 0;
  const scales: number[] = [];
  while (t < sec * 1000) {
    const c = cost(d.scale);
    const iv = Math.max(1, Math.ceil(Math.max(c, cpu) / VS - 1e-6)) * VS;
    t += iv; frames++;
    d.sample(iv, cpu, reading(c, iv));
    if (leftAt === null && d.scale < base - 1e-6) leftAt = t / 1000;
    if (t >= (sec1 + 1) * 1000) { fpsBySec.push(frames); frames = 0; sec1++; scales.push(d.scale); }
  }
  const tail = fpsBySec.slice(-8);
  return { leftAt, end: d.scale, tailFps: tail.reduce((s, x) => s + x, 0) / Math.max(1, tail.length), trusted: d.timerTrusted, scales };
}
const metal = (_c: number, iv: number): number => iv * 3;
const show = (label: string, r: Run): void => console.log(`${label.padEnd(58)} left 1.0 at ${r.leftAt === null ? '-' : `${r.leftAt.toFixed(1)} s`}  end ${r.end.toFixed(2)}  last 8 s ${r.tailFps.toFixed(1)} fps  timer ${r.trusted ? 'trusted' : 'untrusted'}  (${r.scales.filter((_, i) => i % 5 === 4).map((x) => x.toFixed(2)).join(' ')})`);

// 1. the closing review's case: Ultra 1080p GPU-bound (21 ms at 1.0: 30 fps on vsync), renderer CPU 1.3 ms, Metal
{
  const r = sim(40, (s) => 3 + 18 * s * s, metal, 1.3);
  show('Metal, GPU-bound 21 ms at 1.0, cpu 1.3', r);
  expect(!r.trusted, 'a timer reading 3x the frame must be untrusted');
  expect(r.leftAt !== null && r.leftAt <= 10, `the scale must leave 1.0 within 10 s (left at ${r.leftAt})`);
  expect(r.tailFps >= 58, `fps must recover to >= 58 (last 8 s ${r.tailFps.toFixed(1)})`);
}
// 2. the gate's forced case: High at render scale 2 (4x the pixels)
{
  const r = sim(60, (s) => 4 + 11 * s * s, metal, 1.6, 2);
  show('Metal, High at render scale 2 (base 2)', r);
  expect(r.leftAt !== null && r.leftAt <= 10, `x2: the scale must leave 2 within 10 s (left at ${r.leftAt})`);
  expect(r.tailFps >= 58, `x2: fps must recover to >= 58 (last 8 s ${r.tailFps.toFixed(1)})`);
}
// 3. steady 60 with Metal readings 30 ms (the reviewer's High 1080p): never moves
{
  const r = sim(30, () => 10, (_c, _iv) => 29 + Math.random() * 2, 2);
  show('Metal, steady 60 fps, readings 29-31 ms', r);
  expect(r.end === 1 && r.leftAt === null, 'a steady 60 must hold 1.0');
}
// 4. CPU-bound on Metal (renderer CPU 22 ms): a smaller buffer cannot help, hold
{
  const r = sim(30, () => 8, metal, 22);
  show('Metal, CPU-bound (renderer 22 ms)', r);
  expect(r.end === 1, 'a CPU-bound late frame must hold the scale');
}
// 5. a trusted timer (readings = the cost) keeps the measured rule: GPU-bound steps, CPU-bound with GPU 8 ms holds
{
  const a = sim(30, (s) => 3 + 18 * s * s, (c) => c, 1.3);
  show('trusted timer, GPU-bound 21 ms at 1.0', a);
  // (its tail includes an up-probe second: the vsync probe of perf PERF-M2, unchanged here)
  expect(a.trusted && a.leftAt !== null && a.end < 1 && a.tailFps >= 55, 'a trusted timer still steps a GPU-bound frame down');
  const b = sim(30, () => 8, (c) => c, 22);
  show('trusted timer, CPU-bound (GPU 8 ms)', b);
  expect(b.trusted && b.end === 1, 'a trusted timer holds a CPU-bound frame');
}
// 7. the idle miss (fw_integ_idle_perf1 gpubound): frame costs that wander around the vsync budget miss a vsync now and
// then, so a window averages 54-57 fps at the scale that run held (1.45: a typical frame fits, the heavier one frame in
// eight does not). Each window is under 12 % late, and the controller must not take that for on target.
{
  let seed = 11;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const r = sim(45, (s) => (1 + 6 * s * s) * (0.95 + 0.1 * rnd()) * (rnd() < 0.12 ? 1.35 : 1), metal, 3.5, 2);
  show('Metal, x2, costs wandering around the vsync budget', r);
  expect(r.leftAt !== null && r.leftAt <= 10, `wander: the scale must leave 2 within 10 s (left at ${r.leftAt})`);
  expect(r.tailFps >= 58, `wander: fps must settle at >= 58 (last 8 s ${r.tailFps.toFixed(1)})`);
}
// 8. a steady 60 with a one-second hitch every few seconds (a window at 55 fps, the next two at 60) is not a GPU limit
{
  const d = new DynamicResolution();
  d.configure(1, 0);
  let moved = false;
  for (let sec = 0; sec < 60; sec++) {
    const iv = sec % 4 === 0 ? 1000 / 55 : VS;
    for (let t = 0; t < 1000; t += iv) d.sample(iv, 3, iv * 3);
    moved ||= d.scale !== 1;
  }
  console.log(`one slow window in four: scale ${moved ? 'moved' : 'held 1.00'}`);
  expect(!moved, 'isolated slow windows must hold the scale');
}
// 6. distrust survives configure() (a driver property): a second match starts untrusted
{
  const d = new DynamicResolution();
  d.configure(1, 0);
  for (let i = 0; i < 300; i++) d.sample(VS, 2, 30);
  d.configure(1, 0);
  expect(!d.timerTrusted, 'the timer standing must survive configure()');
  console.log(`timer standing after configure(): ${d.timerTrusted ? 'trusted' : 'untrusted'}`);
}

console.log(fails ? `probe_dynres_metal: ${fails} FAILURE(S)` : 'probe_dynres_metal: PASS');
process.exit(fails ? 1 : 0);
