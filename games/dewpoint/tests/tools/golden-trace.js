// Records the golden state traces for the Water campaign from a PRISTINE copy of the project.
//
//   node tests/tools/golden-trace.js ../dewpoint-v1-water-snapshot
//
// It imports the Runner, the levels and the scripted solutions FROM THAT COPY (never from this
// working tree), plays every level's solve() and solveAll(), and writes
// tests/fixtures/water-golden.json. tests/golden-water.test.js then replays the same scripts in
// the working tree and requires bit-identical traces.
//
// Do not point this at the working tree to "fix" a failing golden test: a difference means the
// engine changed Water. Fix the engine.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { traceRun, SAMPLE_TICKS } from '../lib/trace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) { console.error('usage: node tests/tools/golden-trace.js <path to pristine project copy>'); process.exit(2); }
const root = path.resolve(process.cwd(), src);
const mine = path.resolve(here, '..', '..');
if (root === mine && !process.argv.includes('--self')) {
  console.error('refusing to record golden data from the working tree (see the header of this file)');
  process.exit(2);
}
if (!existsSync(path.join(root, 'src', 'levels', 'index.js'))) { console.error(`no project at ${root}`); process.exit(2); }

const imp = (...p) => import(pathToFileURL(path.join(root, ...p)).href);
const { play } = await imp('tests', 'lib', 'play.js');
const { levels } = await imp('src', 'levels', 'index.js');

const out = { note: 'Golden Water traces recorded from the v1 water-only snapshot. Never regenerate from refactored code.', sampleTicks: SAMPLE_TICKS, source: path.basename(root), levels: {} };
for (const level of levels) {
  const mod = await imp('tests', 'solutions', `${level.id}.js`);
  out.levels[level.id] = { solve: traceRun(play, level, mod.solve), solveAll: traceRun(play, level, mod.solveAll) };
  const a = out.levels[level.id];
  console.log(`${level.id}  solve: ${a.solve.finish.tick} ticks, ${a.solve.samples.length} samples   solveAll: ${a.solveAll.finish.tick} ticks, ${a.solveAll.samples.length} samples`);
}
const dir = path.join(mine, 'tests', 'fixtures');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'water-golden.json');
// one sample per line keeps the file diffable
const text = JSON.stringify(out).replace(/\],\[/g, '],\n[');
writeFileSync(file, text + '\n');
console.log(`wrote ${file} (${(text.length / 1024).toFixed(0)} KB)`);
