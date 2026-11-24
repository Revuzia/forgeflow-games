// Regression proof that the element refactor did not change Water.
//
// tests/fixtures/water-golden.json was recorded from the pristine v1 water-only build
// (tests/tools/golden-trace.js, pointed at ../dewpoint-v1-water-snapshot). For every Water level
// this replays the unedited scripted solutions (solve and solveAll) in the working tree and
// requires the player's state trace to be BIT-identical: position, velocity, form and gauge at
// every sample, a hash that covers every single tick in between, and the finish tick.
//
// The level data and scripts replayed here are FROZEN copies of the v1 levels and solutions in
// tests/fixtures/v1-water/ (never edit them). The live campaign in src/levels/ is free to grow;
// this test pins the ENGINE: the same level data and inputs must still produce the same motion.
//
// If this fails, the engine changed how Water plays. Fix the engine; do not regenerate the fixture.

import { test, assert, eq } from './lib/harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { play } from './lib/play.js';
import { levels as liveLevels } from '../src/levels/index.js';
import { traceRun, diffTrace, SAMPLE_TICKS } from './lib/trace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const IDS = ['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10', 'l11', 'l12'];
const levels = [];
for (const id of IDS) levels.push((await import(pathToFileURL(path.join(here, 'fixtures', 'v1-water', 'levels', `${id}.js`)).href)).default);
const golden = JSON.parse(readFileSync(path.join(here, 'fixtures', 'water-golden.json'), 'utf8'));

test('golden: the fixture covers l01..l12 and was sampled the way this test samples', () => {
  eq(golden.sampleTicks, SAMPLE_TICKS);
  eq(Object.keys(golden.levels), IDS);
  eq(levels.map((l) => l.id), IDS, 'the frozen v1 fixture holds the twelve published levels');
  eq(liveLevels.map((l) => l.id), IDS, 'the live Water campaign is exactly the published twelve level ids, in order');
  for (const [id, g] of Object.entries(golden.levels)) {
    for (const route of ['solve', 'solveAll']) {
      assert(g[route].finish.completed && g[route].finish.deaths === 0 && g[route].samples.length > 20, `${id} ${route}: golden run is not a clean completion`);
    }
  }
});

for (const level of levels) {
  const g = golden.levels[level.id];
  if (!g) continue;
  for (const route of ['solve', 'solveAll']) {
    test(`golden: ${level.id} ${route}() replays bit-identically to the v1 water build (${g[route].finish.tick} ticks)`, async () => {
      const mod = await import(pathToFileURL(path.join(here, 'fixtures', 'v1-water', 'solutions', `${level.id}.js`)).href);
      const got = traceRun(play, level, mod[route]);
      const d = diffTrace(g[route], got);
      assert(d === '', `${level.id} ${route}: Water no longer plays as it did in v1.\n${d}`);
    });
  }
}
