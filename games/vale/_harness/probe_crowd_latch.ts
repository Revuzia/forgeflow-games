// VALE probe — the triangle governor's second step (src/render/crowd.ts CrowdHardLatch). A governed frame's count is low
// because the step is on, so the frame it releases into must be judged, not the governed one: the integration pass's seed
// 23 drew 551k and 400k on alternating frames with 59 crowd units on screen. A simulated frame: a fixed scene plus each
// crowd unit, the unit and the shadow-only tree cells costing less while the step runs.
import { CROWD_HARD_TRIS_HIGH, CrowdHardLatch } from '../src/render/crowd.ts';

let fails = 0;
const expect = (ok: boolean, m: string): void => { if (!ok) { fails++; console.log(`FAIL ${m}`); } };
const BUDGET = 500000;

interface Run { peak: number; flips: number; end: boolean }
function run(frames: number, scene: (f: number) => number, crowd: (f: number) => number): Run {
  const l = new CrowdHardLatch();
  let tris = 0, peak = 0, flips = 0, was = false;
  for (let f = 0; f < frames; f++) {
    const n = crowd(f);
    const on = l.update(tris, n);
    if (on !== was) { flips++; was = on; }
    tris = scene(f) + n * (on ? 900 : 3400) + (on ? 0 : 35000);
    peak = Math.max(peak, tris);
  }
  return { peak, flips, end: was };
}
const show = (label: string, r: Run): void => console.log(`${label.padEnd(44)} peak ${(r.peak / 1000).toFixed(0)}k  ${r.flips} flips  ends ${r.end ? 'governed' : 'free'}`);

// 1. seed 23's push: the crowd climbs to 60 over 10 s, stays 40 s, then clears
{
  const crowd = (f: number): number => Math.min(60, Math.min(f / 10, Math.max(0, (3600 - f) / 10)));
  const r = run(4200, () => 300000, crowd);
  show('a late push climbs, holds, clears', r);
  expect(r.peak <= BUDGET, `the frame must stay inside the budget (peak ${r.peak})`);
  expect(r.flips <= 2, `one engage and one release, never a flip-flop (${r.flips} flips)`);
  expect(!r.end, 'the step must let go once the crowd has cleared');
}
// 2. a scene sitting on the mark with no crowd to scale by: a slow flip at most, never per frame
{
  const r = run(1200, (f) => 420000 + (f % 2 ? 15000 : 0), () => 8);
  show('hovering on the mark, small crowd', r);
  expect(r.peak <= BUDGET, `hovering must stay inside the budget (peak ${r.peak})`);
  expect(r.flips <= 1200 / 120, `at most a flip per hold (${r.flips} flips in 1200 frames)`);
}
// 3. an ordinary frame never engages it
{
  const r = run(600, () => 300000, () => 20);
  show('a lane wave', r);
  expect(r.flips === 0 && r.peak < CROWD_HARD_TRIS_HIGH, 'an ordinary frame must not engage the step');
}

console.log(fails ? `probe_crowd_latch: ${fails} FAILURE(S)` : 'probe_crowd_latch: PASS');
process.exit(fails ? 1 : 0);
