// DEWPOINT test runner. Usage:
//   node tests/run.js              run everything (in parallel worker processes)
//   node tests/run.js level        only tests whose "file: name" contains "level"
//   node tests/run.js -v           also list passing tests
//   node tests/run.js -j4          use 4 workers (-j1: everything in this process, in order; default: one per core, at most 8 - past that the machine's cores are the limit, and more workers only slow each other)
//   node tests/run.js --slow       also list the ten slowest tests
//   node tests/run.js --update-times   rewrite tests/.timings.json (read by later runs to start the slowest tests first)
// No npm dependencies. Exit code 1 if anything fails.
//
// Every tests/*.test.js is picked up. A file that imports ./lib/harness.js registers
// individual tests; any other file is treated as a self-contained suite with its own
// exit code (e.g. tests/audio.test.js) and is run in a child process as one test.
//
// How it is parallel: every worker process imports every test file, which gives all of them the
// identical, ordered list of tests; the main process then hands out test numbers one at a time (slowest
// first, from tests/.timings.json) and each worker runs its tests one after another. A test never runs
// in two places, nothing is skipped, and the report is printed in the order of the list, so the output
// and the summary line are the same as a serial run's. The timings only decide the order of the work:
// a missing or stale file changes how long a run takes, never what it checks.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync, fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { registry, setFile, test } from './lib/harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.js')).sort();
const TIMINGS = path.join(here, '.timings.json');
const HEAVY_FILES = new Set(['layout', 'play']);      // test files whose tests each run a headless browser
const HEAVY_MAX = Math.max(1, Number(process.env.DEWPOINT_BROWSERS) || 3);   // (DEWPOINT_BROWSERS overrides)

/** Import every test file (registering its tests) in file-name order. Returns the files that would not load. */
async function loadAll() {
  const loadErrors = [];
  for (const f of files) {
    setFile(f.replace(/\.test\.js$/, ''));
    const full = path.join(here, f);
    if (!readFileSync(full, 'utf8').includes('lib/harness.js')) {
      test(`standalone suite (node tests/${f})`, () => {
        const r = spawnSync(process.execPath, [full], { encoding: 'utf8', timeout: 120000 });
        if (r.status !== 0) {
          const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n');
          const fails = out.filter((l) => /FAIL/.test(l)).slice(0, 12);
          throw new Error(`exit code ${r.status}${r.error ? ` (${r.error.message})` : ''}\n${(fails.length ? fails : out.slice(-12)).join('\n')}`);
        }
      });
      continue;
    }
    try { await import(pathToFileURL(full).href); }
    catch (e) { loadErrors.push({ f, e }); }
  }
  return loadErrors;
}

const signature = () => registry.map((t) => `${t.file}: ${t.name}`).join('\n');

// ------------------------------------------------------------------------------------------ worker process
if (process.argv.includes('--worker')) {
  await loadAll();
  process.send({ type: 'ready', sig: signature() });
  process.on('message', async (m) => {
    if (m.type === 'stop') { process.exit(0); }
    const t0 = performance.now();
    let error = null;
    try { await registry[m.i].fn(); }
    catch (e) { error = String((e && e.message) || e); }
    process.send({ type: 'done', i: m.i, error, ms: performance.now() - t0 });
  });
} else {
  await main();
}

// ------------------------------------------------------------------------------------------ main process
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v');
  const slow = args.includes('--slow');
  const updateTimes = args.includes('--update-times');
  const jArg = args.find((a) => /^-j\d+$/.test(a));
  const jobs = jArg ? Math.max(1, Number(jArg.slice(2))) : Math.max(1, Math.min(8, (os.availableParallelism ? os.availableParallelism() : os.cpus().length)));
  const filter = args.filter((a) => !a.startsWith('-'))[0] || '';

  const loadErrors = await loadAll();
  const t0 = performance.now();
  const label = (t) => `${t.file}: ${t.name}`;
  const selected = [];
  let skipped = 0;
  registry.forEach((t, i) => { if (filter && !label(t).toLowerCase().includes(filter.toLowerCase())) skipped++; else selected.push(i); });

  const results = new Array(registry.length);         // { error, ms } per test number
  let printed = 0;                                     // position in `selected` up to which the report has been written
  const report = () => {
    while (printed < selected.length && results[selected[printed]]) {
      const i = selected[printed++], r = results[i];
      if (r.error) console.log(`  FAIL  ${label(registry[i])}\n        ${r.error.split('\n').join('\n        ')}`);
      else if (verbose) console.log(`  ok    ${label(registry[i])}`);
    }
  };

  const workers = Math.min(jobs, Math.ceil(selected.length / 8));
  if (workers <= 1) {
    for (const i of selected) {
      const s = performance.now();
      let error = null;
      try { await registry[i].fn(); } catch (e) { error = String((e && e.message) || e); }
      results[i] = { error, ms: performance.now() - s };
      report();
    }
  } else {
    await runParallel(workers);
  }

  async function runParallel(n) {
    let times = {};
    try { times = JSON.parse(readFileSync(TIMINGS, 'utf8')); } catch (e) { times = {}; }
    // slowest first; tests with no recorded time count as slow (a new test is started early, not last)
    const queue = [...selected].sort((a, b) => (times[label(registry[b])] ?? Infinity) - (times[label(registry[a])] ?? Infinity) || a - b);
    // Tests that drive a headless browser (tests/layout.test.js, tests/play.test.js) are heavy: more than a few at
    // once starve each other and every other test. At most HEAVY_MAX of them are in flight; meanwhile the other
    // workers take the next ordinary test instead of standing in line for a browser.
    const heavy = (i) => HEAVY_FILES.has(registry[i].file);
    let heavyLive = 0;
    const take = () => {
      let k = queue.findIndex((i) => !heavy(i) || heavyLive < HEAVY_MAX);
      if (k < 0) return -1;
      const i = queue.splice(k, 1)[0];
      if (heavy(i)) heavyLive++;
      return i;
    };
    const mySig = signature();
    const idle = [];                                   // workers waiting for a browser slot to free up
    await new Promise((resolve, reject) => {
      let live = 0, respawns = 0;
      const spawn = () => {
        const w = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
        let current = -1;
        live++;
        const next = () => {
          if (!queue.length) { current = -1; w.send({ type: 'stop' }); return; }
          const i = take();
          if (i < 0) { current = -1; idle.push(next); return; }    // only browser tests left and all slots busy: wait for one to finish
          current = i; w.send({ type: 'run', i });
        };
        w.on('message', (m) => {
          if (m.type === 'ready') {
            if (m.sig !== mySig) { reject(new Error('a worker registered a different list of tests than the main process')); return; }
            next();
          } else if (m.type === 'done') {
            results[m.i] = { error: m.error, ms: m.ms };
            if (heavy(m.i)) { heavyLive--; const waiting = idle.splice(0); for (const fn of waiting) fn(); }
            report();
            next();
          }
        });
        let closed = false;
        const close = (why) => {
          if (closed) return;
          closed = true;
          let replace = false;
          if (current >= 0 && !results[current]) {         // died in the middle of a test: that test fails, the rest carry on
            results[current] = { error: `the worker running this test died: ${why}`, ms: 0 };
            if (heavy(current)) { heavyLive--; const waiting = idle.splice(0); for (const fn of waiting) fn(); }
            report();
            replace = queue.length > 0 && respawns++ < 8;
          }
          live--;
          if (replace) spawn(); else if (live === 0) resolve();
        };
        w.on('error', (e) => close(String((e && e.message) || e)));
        w.on('exit', (code) => close(`exit code ${code}`));
      };
      for (let k = 0; k < n; k++) spawn();
    });
    if (selected.some((i) => !results[i])) throw new Error('the workers finished without running every test');
  }
  report();

  let passed = 0, failed = 0;
  for (const i of selected) { if (results[i].error) failed++; else passed++; }
  for (const { f, e } of loadErrors) {
    failed++;
    console.log(`  FAIL  ${f} could not be loaded\n        ${(e && e.stack) || e}`);
  }
  const ms = Math.round(performance.now() - t0);
  if (slow) {
    console.log('\nslowest tests:');
    for (const i of [...selected].sort((a, b) => results[b].ms - results[a].ms).slice(0, 10)) console.log(`  ${(results[i].ms / 1000).toFixed(1).padStart(6)} s  ${label(registry[i])}`);
  }
  if (updateTimes && !filter && loadErrors.length === 0 && failed === 0) {
    const out = {};
    for (const i of selected) out[label(registry[i])] = Math.round(results[i].ms);
    writeFileSync(TIMINGS, JSON.stringify(out, null, 1) + '\n');
    console.log(`\nwrote ${path.relative(process.cwd(), TIMINGS) || TIMINGS}`);
  }
  const line = `${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed${skipped ? `, ${skipped} filtered out` : ''} (${registry.length} tests in ${files.length} files, ${ms} ms)`;
  console.log('\n' + line);
  process.exit(failed === 0 ? 0 : 1);
}
