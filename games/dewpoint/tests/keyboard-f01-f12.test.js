// Can the FIRE campaign be finished with a keyboard? Every level f01..f12 is played by the keyboard model
// (tests/lib/keyboard.js: W/A/S/D relative to the camera, Space, keys 1-4, R; one input change per 0.15 s at most; every
// reaction 0.15 s late, plus or minus a shift) from tests/solutions-kb/fNN.js, a script written the way a first-time
// player walks: stop, line up, act. The analogue scripts in tests/solutions/ steer at any angle with perfect timing and
// prove nothing about a keyboard.
//
// What is asserted, per level:
//   - it reaches the exit with zero deaths under each of the seven input settings (all inputs 150 ms early / on time /
//     150 ms late, and four seeded random jitters of up to 150 ms on every reaction);
//   - its route time is within 1.0-2.6 x the analogue route time (the ratio is printed by KB_REPORT=1, see the end);
//   - the heat gauge keeps 1.0 spare outside the moments where running dry is the lesson (DRY_LESSON in the solution file);
//   - it survives 24 seeded jitters (seeds 1001-1024) with at most two failing, and every constant shift of the whole input
//     from -300 ms to +300 ms in steps of 100 ms (a slow or a quick player).
// A step that a keyboard cannot do reliably is NOT hand-tuned until it passes: the test that fails because of it is
// marked [expected fail: ...] below (KNOWN) with the level, the place, what it demands and the measured success rate, and the
// suggested level change. An expected-fail test passes while the step fails and also when it is fixed; run with -v to see
// which are marked. To see what a fix does, delete its entry from KNOWN: the test then asserts the real thing.
//
// Run `KB_REPORT=1 node tests/keyboard-f01-f12.test.js` for the table of numbers (the report is printed at import time).

import { test, assert } from './lib/harness.js';
import { runKeyboard, JITTERS } from './lib/keyboard.js';
import { play } from './lib/play.js';

const IDS = ['f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10', 'f11', 'f12'];
const LV = {}, KB = {}, AN = {};
for (const id of IDS) {
  LV[id] = (await import(`../src/levels/${id}.js`)).default;
  KB[id] = await import(`./solutions-kb/${id}.js`);
  AN[id] = await import(`./solutions/${id}.js`);
}

// 24 more seeded jitters (the seven in JITTERS are asserted separately) and the constant shifts of a slow or a quick player
const EXTRA = Array.from({ length: 24 }, (_, i) => ({ label: `seed ${1001 + i}`, seed: 1001 + i, amp: 0.15 }));
const SWEEP = [-300, -200, -100, 100, 200, 300].map((ms) => ({ label: `shift ${ms} ms`, shift: ms / 1000 }));

/**
 * Expected failures: key -> reason. Keys: `${id}|${jitter label}` (reaches the exit with zero deaths under that input
 * setting), `${id}|heat`, `${id}|extra` (the twelve extra jitters), `${id}|time`. Each reason names the step.
 */
const KNOWN = {};
const know = (id, labels, reason) => { for (const l of labels) KNOWN[`${id}|${l}`] = reason; };
const ALL = JITTERS.map((j) => j.label), SEEDS = ['seed 1', 'seed 2', 'seed 3', 'seed 4'];

// The Fire levels were changed (see LEVELS.md section 10) until their keyboard solutions finish under every one of the 7 official
// settings, 22+ of 24 seeded jitters and every constant shift of -300..+300 ms, with the heat spare required (levels whose lesson is
// to run the gauge dry say so with DRY_LESSON in their solution file: f06, f08). Nothing is marked as an expected failure.

/** Run the keyboard solution of a level under one jitter. Never throws. minHeat: the lowest gauge while in a form that spends heat. */
function run(id, jitter, opts = {}) {
  let minHeat = Infinity;
  const res = runKeyboard(LV[id], (k) => {
    k.retryBudget = opts.retries || 1;
    const tick = k.r.tick.bind(k.r);
    const home = k.sim.element.defaultForm;
    k.r.tick = (...a) => { tick(...a); if (k.p.form !== home) minHeat = Math.min(minHeat, k.p.gauge); };
    KB[id].solve(k);
  }, jitter);
  return { ...res, minHeat, deaths: res.k.sim.deaths, retries: res.k.retries || 0 };
}

const analogCache = {};
function analogTime(id) {
  if (analogCache[id] === undefined) {
    const r = play(LV[id]);
    AN[id].solve(r);
    analogCache[id] = r.result().timeMs / 1000;
  }
  return analogCache[id];
}

/** A test that is expected to fail while the level has the problem `reason`: it passes either way (a fix makes the real assertion hold). */
function check(key, name, fn) {
  const reason = KNOWN[key];
  if (!reason) { test(name, fn); return; }
  test(`${name} [expected fail: ${reason}]`, () => { try { fn(); } catch (e) { /* still failing, as recorded */ } });
}

for (const id of IDS) {
  for (const j of JITTERS) {
    check(`${id}|${j.label}`, `keyboard ${id}: exit, no deaths, input ${j.label}`, () => {
      const r = run(id, j);
      assert(r.ok && r.deaths === 0, () => `${id} under ${j.label}: ${r.error || `${r.deaths} death(s)`}`);
    });
  }

  check(`${id}|time`, `keyboard ${id}: route time is 1.0-2.6 x the analogue route`, () => {
    const r = run(id, { shift: 0 });
    assert(r.ok, () => `${id} did not finish: ${r.error}`);
    const ratio = r.time / analogTime(id);
    assert(ratio >= 1.0 && ratio <= 2.6, () => `${id}: keyboard ${r.time.toFixed(1)} s vs analogue ${analogTime(id).toFixed(1)} s = ${ratio.toFixed(2)} x`);
  });

  check(`${id}|heat`, `keyboard ${id}: heat gauge keeps 1.0 spare except where running dry is the lesson`, () => {
    const dry = KB[id].DRY_LESSON === true;
    let lowest = Infinity;
    for (const j of [{ shift: -0.15 }, { shift: 0 }, { shift: 0.15 }]) {
      const r = run(id, j);
      if (r.ok) lowest = Math.min(lowest, r.minHeat);
    }
    assert(dry || lowest >= 1.0, () => `${id}: the gauge dropped to ${lowest.toFixed(2)} on the keyboard route (needs 1.0 spare)`);
  });

  check(`${id}|extra`, `keyboard ${id}: 24 more seeded jitters, at most two failures`, () => {
    let failed = 0, first = '';
    for (const j of EXTRA) { const r = run(id, j); if (!(r.ok && r.deaths === 0)) { failed++; first = first || `${j.label}: ${r.error || r.deaths + ' death(s)'}`; } }
    assert(failed <= 2, () => `${id}: ${failed} of 24 jittered runs failed (first: ${first})`);
  });

  check(`${id}|sweep`, `keyboard ${id}: every constant shift from -300 to +300 ms finishes without a death`, () => {
    let first = '';
    for (const j of SWEEP) { const r = run(id, j); if (!(r.ok && r.deaths === 0)) first = first || `${j.label}: ${r.error || r.deaths + ' death(s)'}`; }
    assert(!first, () => `${id}: ${first}`);
  });

}

// ------------------------------------------------------------------------------------------------ the report
if (process.env.KB_REPORT) {
  const rows = [];
  for (const id of IDS) {
    const a = analogTime(id);
    const base = run(id, { shift: 0 });
    const res = JITTERS.map((j) => { const r = run(id, j); return `${j.label}:${r.ok && r.deaths === 0 ? 'ok' : 'FAIL'}`; });
    let extraOk = 0;
    for (const j of EXTRA) { const r = run(id, j); if (r.ok && r.deaths === 0) extraOk++; }
    let sweepOk = 0;
    for (const j of SWEEP) { const r = run(id, j); if (r.ok && r.deaths === 0) sweepOk++; }
    let lowest = Infinity;
    for (const j of [{ shift: -0.15 }, { shift: 0 }, { shift: 0.15 }]) { const r = run(id, j); if (r.ok) lowest = Math.min(lowest, r.minHeat); }
    rows.push(`${id}  analogue ${a.toFixed(1)} s  keyboard ${base.ok ? base.time.toFixed(1) : '-'} s  x${base.ok ? (base.time / a).toFixed(2) : '-'}  orbits ${base.orbits}  min heat ${Number.isFinite(lowest) ? lowest.toFixed(2) : '-'}  extra jitters ${extraOk}/24  sweep ${sweepOk}/${SWEEP.length}  ${res.join(' ')}`);
  }
  console.log(rows.join('\n'));
}
