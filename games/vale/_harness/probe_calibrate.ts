// VALE probe — perf PERF-C1: the first-run calibration's verdict (src/render/calibration.ts), pure, at any load.
//   node _harness/probe_calibrate.ts
// Frame intervals are synthesized the way the idle gate runs read them: a machine that holds 60 Hz sits on 16.7 ms with a
// vsync-jitter tail whose p95 wandered 17.4-18.2 ms and flipped its verdict at 18 ms. Such a player must get High every
// time, at 1080p and on 4K; a buffer of 9x the pixels never gets High; machines that really miss 60 still step down.
// The live half (the real GPU, three calls at 1080p): node _harness/perf_1080.mjs --prod --calibrate-only.
import { CALIB_HIGH_MAX_PIXELS, calibAgain, calibVerdict, calibWindow, holds60, type CalibWindow } from '../src/render/calibration.ts';

let fails = 0;
const expect = (ok: boolean, m: string): void => { if (ok) console.log(`ok   ${m}`); else { fails++; console.log(`FAIL ${m}`); } };
const P1080 = 1920 * 1080, P4K = 3840 * 2160, P9X = 5760 * 3240;

/** deterministic noise (the probe needs no entropy): n intervals on `base` ms, `tail` of them at `tailMs`, the rest within ±0.1 ms */
function frames(n: number, base: number, tail = 0, tailMs = base): number[] {
  const out: number[] = [];
  let x = 12345;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out.push(base + ((x % 21) - 10) / 100); }
  // the tail spreads evenly; each jitter frame is answered by a short one, as vsync does: the mean stays on the display rate
  for (let k = 0; k < tail; k++) { const i = Math.floor((k * n) / tail); out[i] = tailMs; out[(i + 1) % n] = base - (tailMs - base); }
  return out;
}
/** the calibration's loop over a machine that produces these windows in turn */
function run(windows: number[][], pixels: number): { preset: string; taken: number; capped: boolean } {
  const taken: CalibWindow[] = [];
  for (const w of windows) { taken.push(calibWindow(w)); if (!calibAgain(taken)) break; }
  const v = calibVerdict(taken, pixels);
  return { preset: v.preset, taken: taken.length, capped: v.capped };
}

// the case itself: every p95 the idle runs read at 1080p, all High
for (const tailMs of [17.4, 17.8, 18.1, 18.2, 19.5]) {
  const w = frames(181, 16.67, 12, tailMs);
  const r = run([w], P1080);
  expect(holds60(calibWindow(w)) && r.preset === 'high', `holds 60 at 1080p with p95 ${calibWindow(w).p95Ms.toFixed(1)} ms: ${r.preset}`);
}
// a window whose tail is real, once: a passing hitch (20 frames at 33 ms) samples again and the clean window decides
{
  const hitch = frames(181, 16.67, 12, 33.4), clean = frames(181, 16.67, 12, 18.1);
  const r = run([hitch, clean], P1080);
  expect(r.preset === 'high' && r.taken === 2, `one hitched window, then a clean one: ${r.preset} after ${r.taken} windows`);
  const r2 = run([hitch, hitch, clean], P1080);
  expect(r2.preset === 'high' && r2.taken === 3, `two hitched windows, then a clean one: ${r2.preset} after ${r2.taken} windows`);
}
// 120 Hz display: the median is far under, the tail still judged in ms
expect(run([frames(362, 8.33)], P1080).preset === 'high', '120 Hz: high');
// 4K is judged by its timing, not the cap
expect(run([frames(181, 16.67, 12, 18.1)], P4K).preset === 'high' && P4K <= CALIB_HIGH_MAX_PIXELS, '3840x2160 holding 60: high');
// 9x the pixels never gets High, even on the machine that holds vsync there
{
  const r = run([frames(181, 16.67, 12, 18.1)], P9X);
  expect(r.preset === 'medium' && r.capped, `5760x3240 holding vsync: ${r.preset} (capped ${r.capped})`);
}
// a machine that really misses 60 still steps down
{
  const dropper = (): number[] => { const w = frames(150, 16.67); for (let i = 0; i < 150; i += 8) w[i] = 33.4; return w; };   // 12.5 % doubled frames
  const r = run([dropper(), dropper(), dropper()], P1080);
  expect(r.preset === 'low' && r.taken === 3, `drops 1 frame in 8 at the median of vsync, every window: ${r.preset} after ${r.taken} windows`);
  const fps45 = frames(135, 22.2);
  const r2 = run([fps45], P1080);
  expect(r2.preset === 'medium' && r2.taken === 1, `45 fps: ${r2.preset} at once (${r2.taken} window, no wait)`);
  const fps30 = frames(90, 33.3);
  const r3 = run([fps30], P1080);
  expect(r3.preset === 'low' && r3.taken === 1, `30 fps: ${r3.preset} at once (${r3.taken} window, no wait)`);
  // over the narrow band's mean: 18.5 ms frames are not jitter
  const slow = frames(162, 18.5);
  expect(!holds60(calibWindow(slow)), '54 fps does not hold 60');
}
// a hidden page: nothing to judge, the default stays, and no re-sampling loop
{
  const r = run([[16, 17, 16]], P1080);
  expect(r.preset === 'high' && r.taken === 1, `a window of 3 frames: ${r.preset}, ${r.taken} window`);
}
console.log(fails ? `probe_calibrate: ${fails} FAILURE(S)` : 'probe_calibrate: PASS');
process.exit(fails ? 1 : 0);
