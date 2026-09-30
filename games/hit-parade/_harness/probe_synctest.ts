// HIT PARADE - _harness/probe_synctest.ts (lane NET; CONTRACT §10, §13 G2, §19.6).
// GGPO SyncTest extended to depth W: after EVERY frame roll back k = 1..8 frames (cycling), re-simulate
// with the same inputs and compare the checksum of every re-simulated state with the first pass.
// Sim under test: the REAL core/sim/match.ts (+ core/data.ts) when they exist - every ordered fighter
// pair x seeds - else the toy sim in core/net/toysim.ts (a stand-in, reported as such).
// Negative control: a deliberately leaky toy sim (hidden JS state) MUST produce mismatches, proving the
// harness can fail.
//
// Usage: node _harness/probe_synctest.ts [--toy] [--frames N] [--seeds K] [--depth 8] [--verbose]
// Exit 0 = PASS, 1 = FAIL; prints one summary line; details -> _harness/_reports/probe_synctest.json

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runSyncTest, type SyncTestResult } from '../runtime/src/core/net/sync.ts';
import { ToySim } from '../runtime/src/core/net/toysim.ts';
import type { SimPort } from '../runtime/src/core/net/rollback.ts';
import { IN, inputStream } from '../runtime/src/core/net/testinputs.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n: string): boolean => args.includes(n);
const opt = (n: string, d: number): number => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const VERBOSE = flag('--verbose');
const FORCE_TOY = flag('--toy');
const DEPTH = opt('--depth', 8);

// ---- sims -------------------------------------------------------------------------------------------
interface Maker { kind: 'real' | 'toy'; fighters: string[]; make(p1: string, p2: string, seed: number): SimPort; note: string }

function firstStage(stages: unknown): string {
  if (Array.isArray(stages)) { const s = stages[0] as { id?: string } | string; return typeof s === 'string' ? s : String(s?.id ?? 'rust_theater'); }
  if (stages && typeof stages === 'object') {
    const o = stages as Record<string, unknown>;
    if (Array.isArray(o.stages)) return firstStage(o.stages);
    const k = Object.keys(o).filter((x) => x !== 'version' && x !== '$schema').sort();
    if (k.length) return k[0];
  }
  return 'rust_theater';
}

async function realMaker(): Promise<Maker | { error: string } | null> {
  const matchPath = resolve(ROOT, 'runtime/src/core/sim/match.ts');
  const dataPath = resolve(ROOT, 'runtime/src/core/data.ts');
  if (!existsSync(matchPath) || !existsSync(dataPath)) return null;
  try {
    const Dm = await import(pathToFileURL(dataPath).href);
    const Pm = await import(pathToFileURL(resolve(ROOT, 'runtime/src/core/net/match_port.ts')).href);
    const Mm = await import(pathToFileURL(matchPath).href);
    // the shipped data/ first; while lane FIGHTERS is mid-authoring it can fail validation -> SIM's fixture kits
    let data;
    let src = 'data/';
    try { data = Dm.loadGameData(); }
    catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0].slice(0, 120);
      const Fx = await import(pathToFileURL(resolve(ROOT, '_harness/fixtures/simkit.ts')).href);
      data = Fx.fixtureData();
      src = `_harness/fixtures (data/ failed to load: ${why})`;
    }
    const fighters = Object.keys(data.fighters).sort();
    const stage = firstStage(data.stages);
    return {
      kind: 'real', fighters, note: `data=${src} stage=${stage}`,
      make(p1: string, p2: string, seed: number): SimPort {
        const m = Mm.createMatch({ mode: 'online', stage, seed, p: [
          { fighter: p1, color: 0, scheme: 0, cpu: -1 }, { fighter: p2, color: 1, scheme: 1, cpu: -1 }] }, data);
        return Pm.matchPort(m);
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
}

function toyMaker(leaky = false): Maker {
  return { kind: 'toy', fighters: ['toy'], note: leaky ? 'leaky' : 'toy', make: (_a, _b, seed) => new ToySim(seed, { leaky }) };
}

function runPair(mk: Maker, p1: string, p2: string, seed: number, frames: number): SyncTestResult & { ms: number } {
  const sim = mk.make(p1, p2, seed);
  const a = inputStream(seed * 7919 + 1, IN.R, frames);
  const b = inputStream(seed * 104729 + 2, IN.L, frames);
  const t0 = performance.now();
  const res = runSyncTest(sim, frames, (f, out) => { out[0] = a[f]; out[1] = b[f]; }, DEPTH);
  return { ...res, ms: performance.now() - t0 };
}

async function main(): Promise<number> {
  const report: Record<string, unknown> = { tool: '_harness/probe_synctest.ts', depth: DEPTH, started: new Date().toISOString() };
  let mk: Maker = toyMaker();
  let realErr = '';
  if (!FORCE_TOY) {
    const r = await realMaker();
    if (r && 'error' in r) realErr = r.error;
    else if (r) mk = r;
  }
  if (realErr) {
    report.error = realErr;
    write(report);
    console.log(`FAIL probe_synctest: core/sim/match.ts exists but failed to load: ${realErr.split('\n')[0]} (use --toy to test the toy sim)`);
    return 1;
  }
  const frames = opt('--frames', mk.kind === 'real' ? 600 : 3600);
  const seeds = opt('--seeds', mk.kind === 'real' ? 1 : 20);
  const rows: unknown[] = [];
  let checks = 0, mismatches = 0, steps = 0, pairs = 0, ms = 0;
  let first: unknown = null;
  for (const p1 of mk.fighters) {
    for (const p2 of mk.fighters) {
      for (let s = 1; s <= seeds; s++) {
        const r = runPair(mk, p1, p2, s, frames);
        pairs++;
        checks += r.checks; mismatches += r.mismatches; steps += r.steps; ms += r.ms;
        if (r.mismatches && !first) first = { p1, p2, seed: s, ...r.first };
        rows.push({ p1, p2, seed: s, frames, checks: r.checks, mismatches: r.mismatches, ms: Math.round(r.ms) });
        if (VERBOSE) console.log(`${p1} vs ${p2} seed ${s}: checks ${r.checks} mismatches ${r.mismatches} ${Math.round(r.ms)} ms`);
      }
    }
  }
  // negative control: hidden state must be caught
  const leak = runPair(toyMaker(true), 'toy', 'toy', 3, 1200);
  const controlOk = leak.mismatches > 0;
  Object.assign(report, { sim: mk.kind, note: mk.note, fighters: mk.fighters, frames, seeds, runs: pairs, checks, steps, mismatches, first,
    stepUsAvg: steps ? Math.round((ms * 1000 / steps) * 100) / 100 : 0, control: { leakyMismatches: leak.mismatches, first: leak.first }, rows });
  write(report);
  const pass = mismatches === 0 && checks > 0 && controlOk;
  const why = mismatches ? ` FIRST ${JSON.stringify(first)}` : !controlOk ? ' negative control (leaky sim) was NOT caught' : '';
  console.log(`${pass ? 'PASS' : 'FAIL'} probe_synctest sim=${mk.kind}${mk.kind === 'toy' ? ' (core/sim/match.ts absent)' : ' [' + mk.note + ']'} runs=${pairs} ` +
    `(${mk.fighters.length}x${mk.fighters.length} pairs x ${seeds} seeds x ${frames} f) rollback 1..${DEPTH} every frame: ` +
    `checks=${checks} mismatches=${mismatches}; leaky control mismatches=${leak.mismatches}${why}`);
  return pass ? 0 : 1;
}

function write(report: Record<string, unknown>): void {
  try {
    const dir = resolve(ROOT, '_harness/_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'probe_synctest.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch { /* report is best-effort */ }
}

main().then((c) => process.exit(c), (e) => { console.log('FAIL probe_synctest crashed: ' + (e instanceof Error ? e.message : String(e))); process.exit(1); });
