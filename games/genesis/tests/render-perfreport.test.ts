// PERF s17 (ROADMAP-60FPS steps 1-2): the report's HEADLINE, probe frames left out, and the freeze's take-hold rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfRecorder } from '../src/render/perfreport.ts';
import { FREEZE, FREEZE_QUIET, freezeLandTick, freezeLine } from '../src/render/freeze.ts';

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

test('freeze: takes hold only after FREEZE_QUIET quiet ticks in a row', () => {
  FREEZE.on = true; FREEZE.active = false; FREEZE.quiet = 0;
  for (let i = 0; i < FREEZE_QUIET - 1; i++) freezeLandTick(false);
  freezeLandTick(true);
  assert.equal(FREEZE.active, false);
  assert.match(freezeLine(), /NOT frozen yet/);
  for (let i = 0; i < FREEZE_QUIET; i++) freezeLandTick(false);
  assert.equal(FREEZE.active, true);
  assert.match(freezeLine(), /^freeze: ACTIVE/);
  FREEZE.on = false; FREEZE.active = false; FREEZE.quiet = 0;
});
