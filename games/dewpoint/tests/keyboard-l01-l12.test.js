// Can the WATER campaign (l01-l12) be finished with a keyboard? tests/lib/keyboard.js is the player model: W/A/S/D (8
// directions relative to the camera), Space, the digit keys and R, one input change per rendered frame, no change sooner
// than 150 ms after the previous one, a 150 ms reaction on everything that answers something on screen, and the camera
// yaw fixed at the level's camYaw unless the script orbits it (at 120 deg/s, counted). tests/solutions-kb/lNN.js plays
// each level that way, like a first-time person: walk roughly, stop, line up, act.
//
// Per level (every run uses the game's real camera rig, tests/lib/camera-check.js rigFor, as src/main.js does):
//   - the solution completes with zero deaths when EVERY reaction is 150 ms early, on time and 150 ms late, under four
//     seeded random jitters (each reaction shifted by a uniform +-150 ms, timed holds by +-50 ms), under the constant
//     shifts -100, -50, +50, +100 and +200, +250, +300 ms (a script that is only lucky at 0 passes none of these), and
//     at least 29 of 30 further seeds (11..40) pass;
//   - the route takes a person 1.0-2.2x the analogue reference route, needs no camera orbit, and the real camera's yaw
//     never wanders more than 2 degrees from the level's camYaw while the keys are used.
// The scripts may look at where the hero is and correct (a seeing player does); they may not rely on frame-perfect
// open-loop timing. A level step that only works inside a window narrower than the reaction spread is a level problem,
// and it is fixed in the level (src/levels), not hidden here.

import { test, assert } from './lib/harness.js';
import { play } from './lib/play.js';
import { runKeyboard, JITTERS } from './lib/keyboard.js';
import { rigFor } from './lib/camera-check.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import l01 from '../src/levels/l01.js';
import l02 from '../src/levels/l02.js';
import l03 from '../src/levels/l03.js';
import l04 from '../src/levels/l04.js';
import l05 from '../src/levels/l05.js';
import l06 from '../src/levels/l06.js';
import l07 from '../src/levels/l07.js';
import l08 from '../src/levels/l08.js';
import l09 from '../src/levels/l09.js';
import l10 from '../src/levels/l10.js';
import l11 from '../src/levels/l11.js';
import l12 from '../src/levels/l12.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEVELS = { l01, l02, l03, l04, l05, l06, l07, l08, l09, l10, l11, l12 };
const kb = {}, analogue = {};
for (const id of Object.keys(LEVELS)) {
  kb[id] = await import(pathToFileURL(path.join(here, 'solutions-kb', `${id}.js`)).href);
  analogue[id] = await import(pathToFileURL(path.join(here, 'solutions', `${id}.js`)).href);
}

const RIG = { rig: (sim) => rigFor(sim) };
const SHIFTS = [-0.15, 0, 0.15, -0.1, -0.05, 0.05, 0.1, 0.2, 0.25, 0.3].map((shift) => ({ label: `${shift > 0 ? '+' : ''}${Math.round(shift * 1000)}ms`, shift }));
const SEEDS = JITTERS.filter((j) => j.seed !== undefined);

function timeOf(id) {
  const a = play(LEVELS[id]);
  analogue[id].solve(a);
  return a.result().timeMs / 1000;
}

for (const id of Object.keys(LEVELS)) {
  const level = LEVELS[id], sol = kb[id];
  const runs = (list) => {
    const bad = [];
    for (const j of list) {
      const r = runKeyboard(level, sol.solve, j, RIG);
      if (!r.ok) bad.push(`${j.label}: ${r.error.split('\n').join(' | ')}`);
    }
    assert(bad.length === 0, () => [`${id} keyboard solution failed under ${bad.length} jitter(s):`, ...bad].join('\n  '));
  };

  test(`${id} keyboard: zero deaths at -150, 0 and +150 ms, and -100, -50, +50, +100, +200, +250, +300 ms`, () => runs(SHIFTS));
  test(`${id} keyboard: zero deaths under 4 seeded random jitters`, () => runs(SEEDS));

  test(`${id} keyboard: at least 29 of 30 unseen seeded jitters (11..40) finish with zero deaths`, () => {
    let pass = 0; const bad = [];
    for (let seed = 11; seed <= 40; seed++) {
      const r = runKeyboard(level, sol.solve, { seed, amp: 0.15 }, RIG);
      if (r.ok) pass++; else bad.push(`seed ${seed}: ${r.error.split('\n')[0]}`);
    }
    assert(pass >= 29, () => [`${id}: only ${pass}/30 unseen seeds finished:`, ...bad].join('\n  '));
  });

  test(`${id} keyboard: route time 1.0-2.2x the analogue route, no camera orbit, the real camera stays within 2 degrees`, () => {
    const r = runKeyboard(level, sol.solve, { shift: 0 }, RIG);
    assert(r.ok, `${id} fails at 0 ms: ${r.error}`);
    const at = timeOf(id), ratio = r.time / at;
    assert(r.orbits === 0, `${id} needs ${r.orbits} camera orbit(s) (${r.orbitDeg.toFixed(0)} deg)`);
    assert(r.k.maxDrift <= 2, `${id}: the camera rig's control yaw wandered ${r.k.maxDrift.toFixed(1)} degrees from camYaw`);
    assert(ratio >= 1.0 && ratio <= 2.2, `${id} keyboard route ${r.time.toFixed(1)} s vs analogue ${at.toFixed(1)} s = x${ratio.toFixed(2)}`);
    if (process.env.KB_REPORT) console.log(`  ${id}: keyboard ${r.time.toFixed(1)} s, analogue ${at.toFixed(1)} s, x${ratio.toFixed(2)}, orbits ${r.orbits}, camera drift ${r.k.maxDrift.toFixed(2)} deg`);
  });
}
