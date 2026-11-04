// GENESIS — the frame monitor (render/perfmon.ts): off costs nothing and records nothing; on, it keeps per-subsystem ms,
// frame intervals with percentiles and spikes, snapshot-apply costs and newly linked GPU programs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfMonitor, PERF_SLOTS } from '../src/render/perfmon.ts';

const busy = (ms: number) => { const t = performance.now(); while (performance.now() - t < ms) { /* spin */ } };

test('off: nothing is recorded', () => {
  const m = new PerfMonitor();
  m.frameStart(0); m.begin('scene'); m.end('scene'); m.frameEnd(); m.message(3);
  const s = m.summary();
  assert.equal(s.frames, 0);
  assert.equal(s.msgs, 0);
});

test('on: intervals, spikes, slots and programs', () => {
  const m = new PerfMonitor();
  m.on = true;
  m.programs = 40;
  let t = 1000;
  for (let i = 0; i < 60; i++) {
    t += i === 30 ? 70 : i === 40 ? 30 : 1000 / 60;
    m.frameStart(t);
    m.begin('scene'); busy(0.3); m.end('scene');
    if (i === 50) m.programs = 43;
    m.frameEnd();
  }
  m.message(2); m.message(4);
  const s = m.summary();
  assert.equal(s.frames, 60);
  assert.equal(s.spikes50, 1);
  assert.equal(s.spikes25, 2);
  assert.equal(s.interval.max, 70);
  assert.ok(Math.abs(s.interval.p50 - 16.67) < 0.02);
  assert.ok(s.slots.scene >= 0.25, `scene ${s.slots.scene}`);
  assert.ok(s.work.mean >= s.slots.scene);
  for (const k of PERF_SLOTS) assert.ok(k in s.slots);
  assert.equal(s.applyMs, 3);
  assert.equal(s.applyMax, 4);
  assert.equal(s.programs, 43);
  assert.equal(s.newPrograms, 3);
});

test('a skipped (hidden) frame does not count as a spike', () => {
  const m = new PerfMonitor();
  m.on = true;
  m.frameStart(0); m.frameEnd();
  m.skip();
  m.frameStart(5000); m.frameEnd();
  assert.equal(m.summary().spikes50, 0);
});
