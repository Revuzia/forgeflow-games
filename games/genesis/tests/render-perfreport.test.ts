// PERF s17 (ROADMAP-60FPS steps 1-2): the report's HEADLINE, probe frames left out, and the freeze's take-hold rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfRecorder } from '../src/render/perfreport.ts';
import { FREEZE, FREEZE_QUIET, FREEZE_STILL_S, freezeLandTick, freezeLine, freezeReset } from '../src/render/freeze.ts';

test('report v2: HEADLINE second, probe frames left out of the stats', () => {
  const rec = new PerfRecorder(['scene', 'other']);
  rec.start(1e9);
  const slots = new Float64Array(2);
  for (let i = 0; i < 12; i++) {
    rec.frameBegin();
    // frame 5 runs a probe: it and frame 6 (whose interval holds it) leave the stats
    if (i === 5) rec.probeDone({ tag: 'rec', t: 0, w: 4, h: 4, finishMs: 0, sets: [{ name: 'fresh-64', passes: 32, ms: 3.2 }], totalMs: 900 });
    rec.frameDone(i === 6 ? 1000 : 100, 10, slots, null);
  }
  rec.stop();
  const L = rec.report.split('\n');
  assert.match(L[0], /perf report v2 .* 9 frames \(\+2 probe frames left out\)/);
  assert.match(L[1], /^HEADLINE: fps 10 \| interval p50 100 p95 100 ms \| main 10 ms\/frame/);
  assert.ok(L.some((l) => l.startsWith('NOTE: on ANGLE-Metal')));
  assert.ok(L.some((l) => l.startsWith('machine (fill in')));
});

test('freeze: takes hold after FREEZE_QUIET quiet ticks of every manager, or the camera at rest FREEZE_STILL_S', () => {
  FREEZE.on = true; freezeReset();
  // two managers; the second is busy once late: not yet
  for (let i = 0; i < FREEZE_QUIET - 1; i++) { freezeLandTick(1, false, 0, 0, i); freezeLandTick(2, false, 5, 0, i); }
  freezeLandTick(2, true, 5, 0, 99);
  freezeLandTick(1, false, 0, 0, 99);
  assert.equal(FREEZE.active, false);
  assert.match(freezeLine(), /NOT frozen yet/);
  // (the camera moved every tick above: no rest fallback) now both quiet long enough
  for (let i = 0; i < FREEZE_QUIET; i++) { freezeLandTick(1, false, 0, 0, 200 + i); freezeLandTick(2, false, 5, 0, 200 + i); }
  assert.equal(FREEZE.active, true);
  assert.match(freezeLine(), /^freeze: ACTIVE .* by landing converged/);
  // a landing that never settles: the camera at rest freezes it (clock faked through performance.now)
  freezeReset();
  const real = performance.now.bind(performance);
  let t = 1000;
  (performance as { now: () => number }).now = () => t;
  try {
    for (let i = 0; i < 5; i++) { freezeLandTick(1, true, 0, 0, 0); t += (FREEZE_STILL_S * 1000) / 4; }
    assert.equal(FREEZE.active, true);
    assert.match(freezeLine(), /by camera at rest/);
  } finally { (performance as { now: () => number }).now = real; }
  FREEZE.on = false; freezeReset();
});
