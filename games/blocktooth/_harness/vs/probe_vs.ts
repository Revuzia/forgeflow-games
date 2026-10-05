// BLOCKTOOTH VS QA (lane B-QA) — the 4-bot VS pacing probe (ONLINE_PLAN gate VP) + VS determinism + solo-hash guard.
//
//   node _harness/vs/probe_vs.ts                      # the whole gate: 9 matches + determinism + TTK duels + solo guard
//   node _harness/vs/probe_vs.ts --jobs 6 --json out.json
//   node _harness/vs/probe_vs.ts --driver standin     # force the solo-bot stand-in (info only; see vsrun.ts)
//   node _harness/vs/probe_vs.ts --no-ttk --no-solo   # matches + determinism only
//   node _harness/vs/probe_vs.ts --ttk-only           # the equal-size 1v1 duels only
//   node _harness/vs/probe_vs.ts --solo-full          # ALSO the full solo GATE 2 re-run vs the frozen RESUME logs (~5 min)
//   node _harness/vs/probe_vs.ts --solo-only         # only the solo hash guard (4 frozen GATE 2 configs, ~1 min)
//   node _harness/vs/probe_vs.ts --wide               # 12 seeds x 3 cities for the leader / gap statistics (info only)
//
// Gate numbers are vs_design.md §14.3 / ONLINE_PLAN §6.3 (VP), verbatim, never widened:
//   * median match end 9:00-10:45 on the match clock, and NO match past 10:45
//   * median LV 14-19 at 4:00 and 28-35 at 7:00 (pooled over every titan of every match)
//   * city floors standing at 7:00 >= 35 % (every match)
//   * equal-size REGULAR 1v1 time-to-kill median 12-20 s (duels, vsrun.ts runDuel; gated on the geared duels)
//   * the 7:00 leader (highest level, ties: more XP) wins <= 50 % of matches
//   * 1st-4th rank gap at 7:00 of 2+ ranks in <= 25 % of matches
//   * determinism: the same seed run again (separate process) hashes identically at every 30 s checkpoint; a
//     perturbed run MUST differ (negative control)
//   * solo hash guard: the four GATE 2 --det hashes frozen in _harness/scratch/partb/RESUME/g2_*.txt are unchanged
// Exit: 0 every gate PASS · 1 at least one FAIL · 3 no FAIL but some gate NOT RUN (a lane has not landed) · 2 sim not loadable.
//
// Matches run in worker processes (this file with --worker), up to --jobs at once; the parent only aggregates.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BiomeId, TitanId } from '../../src/core/types.ts';
import type { BotLevel } from '../../src/vs/types.ts';
import { loadSim, median, fmtClock, runDuel, runMatch, TITANS4 } from './vsrun.ts';
import type { Driver, DuelCfg, DuelResult, MatchCfg, MatchResult } from './vsrun.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SELF = fileURLToPath(import.meta.url);
const BIOMES3: BiomeId[] = ['grideast', 'whitestacks', 'lockwater'];

// ─────────────────────────────── gate constants (vs_design.md §14.3) ───────────────────────────────
const GATE = {
  endMedianS: [540, 645] as const,          // 9:00-10:45
  hardEndS: 645,                            // never past 10:45 (one 30 Hz tick of slack for the >= test)
  lv4: [14, 19] as const,                   // median LV at 4:00
  lv7: [28, 35] as const,                   // median LV at 7:00
  floors7Min: 35,                           // % of floors standing at 7:00
  ttkS: [12, 20] as const,                  // equal-size 1v1 TTK median
  leaderMaxShare: 0.5,                      // the 7:00 leader wins <= 50 %
  gapMaxShare: 0.25,                        // 2+ rank gap 1st-4th at 7:00 in <= 25 % of matches
  tickSlackS: 1 / 30 + 1e-9,
};

/** Which lane's knob moves each gate (printed when it fails). */
const KNOBS: Record<string, string> = {
  'end-median': 'B-VS: VS.phase / VS.ring.steps (ring speed), VS.ko, bot RIVAL layer (engagement); B-VS+B-TITAN: VS.kitPct / VS.pvp (TTK decides how fast titans fall)',
  'end-hard': 'B-VS: hard end in vsEndTick (VS.phase.hardEndS, tie-break), LAST CALL mortar (VS.ring.lastCall*), ring step radii',
  'lv4': 'B-CORE VS block: VS.pacing.xpStretch / VS.catchUp; B-TITAN: xpToNext call sites + CARD RAIL cadence; B-WORLD: VS.director.budgetMulPerTitan (PvE pressure / food)',
  'lv7': 'B-CORE VS block: VS.pacing / VS.catchUp / VS.ko.levelsLost; B-WORLD: crews (VS.director.repairFromS) + director budget; B-VS: tender XP lumps',
  'floors7': 'B-WORLD: repair crews (VS.director.repairFromS, REBUILD_* in city/citysim.ts); B-VS: demolition crews outside the ring',
  'ttk': 'B-VS / B-TITAN: VS.kitPct.* and VS.pvp.* (powerCap, edgePerRank), armor / shield order in hurtTitan; B-VS bot RIVAL layer (bots.regular.engage*)',
  'leader': 'B-VS: VS.catchUp (perLevel, max), VS.crown.*, VS.ko.killXpFrac, tender placement near last place; bot anti-dogpile',
  'gap': 'B-VS: VS.catchUp, tender placement (§4.2), VS.ko.levelsLost; B-CORE VS block pacing',
  'det': 'whichever lane iterates a Map/Set, reads a clock / Math.random, or depends on array order (find the first divergent checkpoint seat/field); B-DET detban',
  'det-neg': 'hashWide in vsrun.ts does not see the perturbed field (B-QA)',
  'solo': 'whichever lane made a solo path depend on w.mode / w.players / w.view (CORE_CONTRACT §6); run probe_sim --det 2 by hand to see the first divergence',
  'integrity': 'the lane named in each message (event stamping = B-CORE conventions §5.2; placements / winner = B-VS vsEndTick)',
};

// ─────────────────────────────── args ───────────────────────────────
interface Args {
  seeds: number[]; biomes: BiomeId[]; lineup: TitanId[] | null; jobs: number; driver: 'auto' | Driver; level: BotLevel;
  maxS: number; det: number; ttk: boolean; solo: boolean; soloFull: boolean; ttkOnly: boolean; wide: boolean; asserts: boolean;
  json: string | null; humanSeat: number | null; humanDriver: 'solo' | 'idle'; outDir: string; worker: boolean; selftest: boolean; job: string | null; out: string | null; quiet: boolean;
}
function parseArgs(argv: string[]): Args {
  const a: Args = {
    seeds: [1337, 7, 99], biomes: [...BIOMES3], lineup: null, jobs: 5, driver: 'auto', level: 'regular', maxS: 660, det: 3,
    ttk: true, solo: true, soloFull: false, ttkOnly: false, wide: false, asserts: true, json: null, humanSeat: null, humanDriver: 'solo',
    outDir: join(ROOT, '_harness/scratch/partb/B-QA/runs'), worker: false, selftest: false, job: null, out: null, quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = (): string => { const x = argv[++i]; if (x === undefined) { console.error(`missing value for ${k}`); process.exit(2); } return x; };
    if (k === '--seeds') a.seeds = v().split(',').map((s) => Number(s.trim()) >>> 0);
    else if (k === '--biomes') a.biomes = v().split(',').map((s) => s.trim()) as BiomeId[];
    else if (k === '--lineup') a.lineup = v().split(',').map((s) => s.trim()) as TitanId[];
    else if (k === '--jobs') a.jobs = Math.max(1, Number(v()) | 0);
    else if (k === '--driver') { const x = v(); if (x !== 'auto' && x !== 'native' && x !== 'standin') { console.error('--driver auto|native|standin'); process.exit(2); } a.driver = x; }
    else if (k === '--level') a.level = v() as BotLevel;
    else if (k === '--minutes') a.maxS = Number(v()) * 60;
    else if (k === '--det') a.det = Math.max(0, Number(v()) | 0);
    else if (k === '--no-det') a.det = 0;
    else if (k === '--no-ttk') a.ttk = false;
    else if (k === '--no-solo') a.solo = false;
    else if (k === '--solo-full') a.soloFull = true;
    else if (k === '--ttk-only') { a.ttkOnly = true; a.det = 0; a.solo = false; }
    else if (k === '--solo-only') { a.ttkOnly = true; a.ttk = false; a.det = 0; a.solo = true; }
    else if (k === '--wide') a.wide = true;
    else if (k === '--no-asserts') a.asserts = false;
    else if (k === '--json') a.json = v();
    else if (k === '--human') a.humanSeat = Number(v()) | 0;
    else if (k === '--human-driver') a.humanDriver = v() === 'idle' ? 'idle' : 'solo';
    else if (k === '--out-dir') a.outDir = resolve(v());
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--worker') a.worker = true;
    else if (k === '--selftest') a.selftest = true;
    else if (k === '--job') a.job = v();
    else if (k === '--out') a.out = v();
    else if (k === '--help' || k === '-h') {
      console.log('usage: node _harness/vs/probe_vs.ts [--seeds 1337,7,99] [--biomes a,b,c] [--lineup t,t,t,t] [--jobs 5] [--driver auto|native|standin]\n'
        + '       [--minutes 11] [--det 3|--no-det] [--no-ttk] [--no-solo] [--solo-full] [--ttk-only] [--wide] [--no-asserts] [--json path] [--out-dir dir]');
      process.exit(0);
    } else { console.error(`unknown arg ${k}`); process.exit(2); }
  }
  if (a.wide) a.seeds = [1337, 7, 99, 21, 42, 5, 11, 303, 808, 2024, 77, 4096];
  return a;
}

// ─────────────────────────────── worker ───────────────────────────────
interface Job { kind: 'match' | 'duels'; cfg?: MatchCfg; duels?: DuelCfg[] }
async function workerMain(a: Args): Promise<number> {
  const err = await loadSim();
  if (err) { console.error('SIM LOAD FAILED\n' + err); return 2; }
  const job = JSON.parse(readFileSync(a.job!, 'utf8')) as Job;
  let out: unknown;
  if (job.kind === 'match') out = runMatch(job.cfg!);
  else out = job.duels!.map((d) => runDuel(d));
  writeFileSync(a.out!, JSON.stringify(out, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x)), 'utf8');
  return 0;
}

// ─────────────────────────────── job runner ───────────────────────────────
const LOAD_RETRIES = 8, LOAD_RETRY_MS = 20_000;
interface Spawned { name: string; code: number | null; log: string; outFile: string; ms: number }
function runJobs(jobs: { name: string; job: Job }[], dir: string, concurrency: number, timeoutMs: number, quiet: boolean): Promise<Spawned[]> {
  return new Promise((done) => {
    const results: Spawned[] = new Array(jobs.length);
    let next = 0, running = 0, finished = 0;
    const attempts: number[] = new Array(jobs.length).fill(0);
    const launch = (): void => {
      while (running < concurrency && next < jobs.length) start(next++);
    };
    // other lanes edit src/ while this probe runs: a worker whose import fails ("SIM LOAD FAILED") is retried
    const start = (idx: number): void => {
      const { name, job } = jobs[idx];
      const jf = join(dir, `${name}.job.json`), of = join(dir, `${name}.out.json`), lf = join(dir, `${name}.log`);
      writeFileSync(jf, JSON.stringify(job), 'utf8');
      const t0 = Date.now();
      attempts[idx]++;
      const ch = spawn(process.execPath, [SELF, '--worker', '--job', jf, '--out', of], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let log = '';
      ch.stdout.on('data', (d) => { log += String(d); });
      ch.stderr.on('data', (d) => { log += String(d); });
      const timer = setTimeout(() => { log += '\n[probe_vs] TIMEOUT after ' + timeoutMs / 1000 + 's - killed\n'; ch.kill(); }, timeoutMs);
      running++;
      ch.on('exit', (code) => {
        clearTimeout(timer);
        running--;
        if (code === 2 && log.includes('SIM LOAD FAILED') && attempts[idx] < LOAD_RETRIES) {
          if (!quiet) console.log(`  ${name}: sim failed to load (a lane is mid-edit), retry ${attempts[idx]}/${LOAD_RETRIES - 1} in ${LOAD_RETRY_MS / 1000} s`);
          running++;                                  // hold the slot while waiting
          setTimeout(() => { running--; start(idx); }, LOAD_RETRY_MS);
          return;
        }
        writeFileSync(lf, log, 'utf8');
        results[idx] = { name, code, log, outFile: of, ms: Date.now() - t0 };
        finished++;
        if (!quiet) console.log(`  [${finished}/${jobs.length}] ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)} s (exit ${code})`);
        if (finished === jobs.length) done(results); else launch();
      });
    };
    if (jobs.length === 0) done([]); else launch();
  });
}
function readOut<T>(s: Spawned): T | null {
  try { return JSON.parse(readFileSync(s.outFile, 'utf8')) as T; } catch { return null; }
}

// ─────────────────────────────── gates ───────────────────────────────
type Status = 'PASS' | 'FAIL' | 'NOT RUN';
interface GateRow { id: string; label: string; status: Status; detail: string }
const gates: GateRow[] = [];
function gate(id: string, label: string, status: Status, detail: string): void { gates.push({ id, label, status, detail }); }
const inBand = (x: number, b: readonly [number, number]): boolean => x >= b[0] && x <= b[1];
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');
const pct = (x: number): string => (Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : '-');

/** The VS bot brain counts as landed when src/vs/bot/ holds real code (the B-CORE-era placeholder is a 3-line stub). */
function nativeBotLanded(): boolean {
  const d = join(ROOT, 'src/vs/bot');
  try {
    if (!existsSync(d)) return false;
    let lines = 0, placeholder = false;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.ts')) continue;
      const t = readFileSync(join(d, f), 'utf8');
      lines += t.split(/\r?\n/).length;
      if (/placeholder/i.test(t)) placeholder = true;
    }
    return lines >= 80 && !placeholder;
  } catch { return false; }
}

// ─────────────────────────────── solo hash guard (probe_sim --det 2 vs the frozen RESUME logs) ───────────────────────────────
interface SoloRun { name: string; meta: string; titan: string; biome: string; want: string; got: string | null; ok: boolean; ms: number }
const SOLO_BASELINES: { meta: 'fresh' | 'full'; titan: string; biome: string; hash: string; file: string }[] = [
  { meta: 'fresh', titan: 'molo', biome: 'grideast', hash: 'e9d2c850', file: 'g2_fresh.txt' },
  { meta: 'fresh', titan: 'briarwick', biome: 'lockwater', hash: 'c678febb', file: 'g2_fresh.txt' },
  { meta: 'full', titan: 'molo', biome: 'grideast', hash: '2b22b988', file: 'g2_full.txt' },
  { meta: 'full', titan: 'briarwick', biome: 'lockwater', hash: 'd5c43fb2', file: 'g2_full.txt' },
];
function checkBaselinesAgainstFiles(): string[] {
  // the hashes above are only trustworthy while they equal what the frozen RESUME logs say
  const bad: string[] = [];
  const dir = join(ROOT, '_harness/scratch/partb/RESUME');
  for (const b of SOLO_BASELINES) {
    try {
      const txt = readFileSync(join(dir, b.file), 'utf8');
      if (!txt.includes(`${b.titan}/${b.biome}: DETERMINISTIC`) || !txt.includes(`final ${b.hash})`)) bad.push(`${b.file}: no line "${b.titan}/${b.biome} ... final ${b.hash}"`);
    } catch (e) { bad.push(`${b.file}: unreadable (${String(e).slice(0, 80)})`); }
  }
  return bad;
}
function runSoloQuick(dir: string, quiet: boolean): Promise<SoloRun[]> {
  return new Promise((done) => {
    const out: SoloRun[] = [];
    let left = SOLO_BASELINES.length;
    for (const b of SOLO_BASELINES) {
      const jf = join(dir, `solo_${b.meta}_${b.titan}.json`);
      const t0 = Date.now();
      const ch = spawn(process.execPath, [join(ROOT, '_harness/probe_sim.ts'), '--titan', b.titan, '--biome', b.biome, '--seed', '1337', '--det', '0', '--meta', b.meta, '--quiet', '--json', jf],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      ch.stdout.on('data', () => { /* the probe prints its own report; only the json matters */ });
      ch.stderr.on('data', () => { /* ignored */ });
      ch.on('exit', () => {
        let got: string | null = null;
        try { const j = JSON.parse(readFileSync(jf, 'utf8')) as { results: { hash: string }[] }; got = j.results[0]?.hash ?? null; } catch { got = null; }
        out.push({ name: `${b.meta}/${b.titan}/${b.biome}`, meta: b.meta, titan: b.titan, biome: b.biome, want: b.hash, got, ok: got === b.hash, ms: Date.now() - t0 });
        if (!quiet) console.log(`  solo ${b.meta}/${b.titan}/${b.biome}: ${got} (want ${b.hash}) ${(Date.now() - t0) / 1000 | 0}s`);
        if (--left === 0) done(out);
      });
    }
  });
}
/** The full 12-run GATE 2 matrix (fresh + full) vs the frozen RESUME logs: normalised per-run lines + det hashes. */
function runSoloFull(dir: string): Promise<{ meta: string; diffs: string[] }[]> {
  const norm = (txt: string): string[] => txt.split(/\r?\n/)
    .filter((l) => /^\[\d+\/12 [^\]]+\] (clear|dead|timeout)/.test(l) || /DETERMINISTIC over|^clears \d+\/12/.test(l))
    .map((l) => l.replace(/\s*·\s*[\d.]+ s wall/g, '').replace(/\s+$/, ''));
  return Promise.all((['fresh', 'full'] as const).map((meta) => new Promise<{ meta: string; diffs: string[] }>((res) => {
    const ch = spawn(process.execPath, [join(ROOT, '_harness/probe_sim.ts'), '--det', '2', '--meta', meta, '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = '';
    ch.stdout.on('data', (d) => { log += String(d); });
    ch.stderr.on('data', (d) => { log += String(d); });
    ch.on('exit', () => {
      writeFileSync(join(dir, `solo_full_${meta}.log`), log, 'utf8');
      const want = norm(readFileSync(join(ROOT, `_harness/scratch/partb/RESUME/g2_${meta}.txt`), 'utf8'));
      const got = norm(log);
      const diffs: string[] = [];
      for (let i = 0; i < Math.max(want.length, got.length); i++) if (want[i] !== got[i]) diffs.push(`line ${i}: want "${want[i] ?? '(none)'}" got "${got[i] ?? '(none)'}"`);
      res({ meta, diffs });
    });
  })));
}

/** The VP match gates (vs_design.md §14.3) over a set of finished matches. Pure: pushes onto `gates`. Exported for --selftest. */
function evalMatchGates(ok: MatchResult[], fatalMatches: MatchResult[], maxS: number, wide: boolean, lanesNote: string, standin: boolean): void {
  const first = gates.length;
  const ends = ok.filter((m) => m.endS !== null).map((m) => m.endS as number);
  const never = ok.filter((m) => m.endS === null);
  const late = ok.filter((m) => m.endS !== null && (m.endS as number) > GATE.hardEndS + GATE.tickSlackS);
  const medEnd = median(ends);
  gate('end-median', `median match end ${fmtClock(GATE.endMedianS[0])}-${fmtClock(GATE.endMedianS[1])}`, ends.length === 0 ? 'FAIL' : inBand(medEnd, GATE.endMedianS) ? 'PASS' : 'FAIL',
    `median ${fmtClock(medEnd)} over ${ends.length}/${ok.length} ended matches (min ${fmtClock(Math.min(...ends))}, max ${fmtClock(Math.max(...ends))})${lanesNote}`);
  gate('end-hard', 'no match past 10:45', never.length === 0 && late.length === 0 ? 'PASS' : 'FAIL',
    never.length || late.length ? `${never.length} never ended by ${fmtClock(maxS)}, ${late.length} ended after 10:45 (${late.map((m) => `${m.cfg.biome}/${m.cfg.seed}@${fmtClock(m.endS)}`).join(', ')})` : `latest end ${fmtClock(Math.max(...ends))}`);
  const lvAt = (k: 'snap240' | 'snap420'): number[] => ok.flatMap((m) => (m[k] ? m[k]!.lv : []));
  const l4 = lvAt('snap240'), l7 = lvAt('snap420');
  gate('lv4', `median LV at 4:00 in ${GATE.lv4[0]}-${GATE.lv4[1]}`, l4.length === 0 ? 'NOT RUN' : inBand(median(l4), GATE.lv4) ? 'PASS' : 'FAIL',
    l4.length ? `median ${f1(median(l4))} (min ${Math.min(...l4)}, max ${Math.max(...l4)}, n ${l4.length})${lanesNote}` : 'no match reached 4:00');
  gate('lv7', `median LV at 7:00 in ${GATE.lv7[0]}-${GATE.lv7[1]}`, l7.length === 0 ? 'NOT RUN' : inBand(median(l7), GATE.lv7) ? 'PASS' : 'FAIL',
    l7.length ? `median ${f1(median(l7))} (min ${Math.min(...l7)}, max ${Math.max(...l7)}, n ${l7.length})${lanesNote}` : 'no match reached 7:00');
  const fl = ok.filter((m) => m.floors420 !== null).map((m) => ({ k: `${m.cfg.biome}/${m.cfg.seed}`, v: m.floors420 as number }));
  const flBad = fl.filter((x) => x.v < GATE.floors7Min);
  gate('floors7', `floors standing at 7:00 >= ${GATE.floors7Min}% (every match)`, fl.length === 0 ? 'NOT RUN' : flBad.length === 0 ? 'PASS' : 'FAIL',
    fl.length ? `median ${f1(median(fl.map((x) => x.v)))}%, min ${f1(Math.min(...fl.map((x) => x.v)))}%${flBad.length ? '; below the floor: ' + flBad.map((x) => `${x.k} ${x.v.toFixed(0)}%`).join(', ') : ''}${lanesNote}` : 'no match reached 7:00');
  const led = ok.filter((m) => m.leader420 >= 0 && m.endS !== null && m.winner >= 0);
  const ledWins = led.filter((m) => m.leader420 === m.winner).length;
  const share = led.length ? ledWins / led.length : NaN;
  gate('leader', `the 7:00 leader wins <= ${pct(GATE.leaderMaxShare)}`, led.length === 0 ? 'NOT RUN' : share <= GATE.leaderMaxShare ? 'PASS' : 'FAIL',
    led.length ? `${ledWins} of ${led.length} matches (${pct(share)})${wide ? '' : '; small sample, run --wide for 36 matches'}${lanesNote}` : 'no decided match with a 7:00 snapshot');
  const gaps = ok.filter((m) => m.gap420 >= 0);
  const gapBig = gaps.filter((m) => m.gap420 >= 2).length;
  gate('gap', `2+ rank gap 1st-4th at 7:00 in <= ${pct(GATE.gapMaxShare)} of matches`, gaps.length === 0 ? 'NOT RUN' : gapBig / gaps.length <= GATE.gapMaxShare ? 'PASS' : 'FAIL',
    gaps.length ? `${gapBig} of ${gaps.length} matches (${pct(gapBig / gaps.length)}); gaps ${gaps.map((m) => m.gap420).join(',')}${lanesNote}` : 'no match reached 7:00');
  if (standin) {
    // the numbers above were produced by the STAND-IN solo bot, not by REGULAR VS bots: they can fail the build but never certify it
    for (let i = first; i < gates.length; i++) {
      if (gates[i].status === 'PASS') { gates[i].status = 'NOT RUN'; gates[i].detail = `[stand-in driver, not REGULAR bots: cannot certify] ${gates[i].detail}`; }
      else if (gates[i].status === 'FAIL') gates[i].detail = `[stand-in driver] ${gates[i].detail}`;
    }
  }
  const integ = ok.flatMap((m) => m.integrity.map((s) => `${m.cfg.biome}/${m.cfg.seed}: ${s}`)).concat(fatalMatches.map((m) => `${m.cfg.biome}/${m.cfg.seed}: threw ${m.error}`));
  gate('integrity', 'integrity: no throw / NaN, events stamped, per-player tonnage, final places + winner', integ.length === 0 ? 'PASS' : 'FAIL', integ.length ? integ.slice(0, 8).join(' || ') : `${ok.length} matches clean`);
}

// ─────────────────────────────── --selftest: the gate evaluator is not vacuous ───────────────────────────────
function synthMatch(i: number, over: Partial<MatchResult> = {}): MatchResult {
  const lead = i % 4;
  const lv4 = [16, 15, 17, 14], lv7 = [31, 30, 32, 29];
  const mk = (lv: number[]) => ({ t: 0, phase: 'open', lv, rank: [2, 2, 3, 2], hpf: [1, 1, 1, 1], alive: [true, true, true, true], elim: [false, false, false, false], xp: [1, 2, 3, 4], floorsPct: 60, crown: -1, kos: [0, 0, 0, 0] });
  const base: MatchResult = {
    cfg: { seed: 1000 + i, biome: 'grideast', lineup: ['molo', 'voltkite', 'hearthback', 'briarwick'], level: 'regular', driver: 'native', maxS: 660, perturb: false, asserts: true },
    error: null, ticks: 1, result: 'vs', endS: 600, winner: i < 4 ? lead : (lead + 1) % 4, placements: [1, 2, 3, 4], scores: [1, 2, 3, 4],
    snap240: mk(lv4), snap420: mk(lv7), series: [], checkpoints: [], hash: '', leader420: lead, gap420: i < 2 ? 2 : 1, floors240: 80, floors420: 60, crown420: lead,
    events: {}, phaseAt: {}, firstHitS: 250, hits: 10, noContest: 3, evictions: [], eliminations: [], ringSteps: [], tenders: [], crownChanges: 0,
    railOffers: 1, railPicks: 1, standinDrafts: 0, travel60: [100, 100, 100, 100], badP: 0, unstamped: 0, seats: [], integrity: [],
    perf: { avgMs: 1, p99Ms: 1, maxMs: 1 },
  };
  return { ...base, ...over };
}
function selfTest(): number {
  const run = (ms: MatchResult[], standin = false): Record<string, Status> => {
    gates.length = 0;
    evalMatchGates(ms, ms.filter((m) => m.error), 660, false, '', standin);
    const o: Record<string, Status> = {};
    for (const g of gates) o[g.id] = g.status;
    return o;
  };
  const nine = (over: (i: number) => Partial<MatchResult> = () => ({})): MatchResult[] => Array.from({ length: 9 }, (_, i) => synthMatch(i, over(i)));
  let bad = 0, n = 0;
  const expect = (name: string, got: Record<string, Status>, want: Record<string, Status>): void => {
    for (const k of Object.keys(want)) { n++; if (got[k] !== want[k]) { bad++; console.log(`  FAIL ${name}: gate ${k} is ${got[k]}, wanted ${want[k]}`); } }
  };
  const sn = (lv: number[]) => ({ t: 0, phase: 'open', lv, rank: [2, 2, 3, 2], hpf: [1, 1, 1, 1], alive: [true, true, true, true], elim: [false, false, false, false], xp: [1, 2, 3, 4], floorsPct: 60, crown: -1, kos: [0, 0, 0, 0] });
  const ALL = { 'end-median': 'PASS', 'end-hard': 'PASS', lv4: 'PASS', lv7: 'PASS', floors7: 'PASS', leader: 'PASS', gap: 'PASS', integrity: 'PASS' } as Record<string, Status>;
  expect('in band', run(nine()), ALL);
  expect('end median too early (8:00)', run(nine(() => ({ endS: 480 }))), { ...ALL, 'end-median': 'FAIL' });
  expect('end median too late (10:50)', run(nine(() => ({ endS: 650 }))), { ...ALL, 'end-median': 'FAIL', 'end-hard': 'FAIL' });
  expect('one match past 10:45', run(nine((i) => (i === 0 ? { endS: 650 } : {}))), { ...ALL, 'end-hard': 'FAIL' });
  expect('one match never ends', run(nine((i) => (i === 3 ? { endS: null, result: null } : {}))), { ...ALL, 'end-hard': 'FAIL' });
  expect('LV@4:00 median 13', run(nine(() => ({ snap240: sn([13, 13, 13, 13]) }))), { ...ALL, lv4: 'FAIL' });
  expect('LV@4:00 median 20', run(nine(() => ({ snap240: sn([20, 20, 20, 20]) }))), { ...ALL, lv4: 'FAIL' });
  expect('LV@7:00 median 27', run(nine(() => ({ snap420: sn([27, 27, 27, 27]) }))), { ...ALL, lv7: 'FAIL' });
  expect('LV@7:00 median 36', run(nine(() => ({ snap420: sn([36, 36, 36, 36]) }))), { ...ALL, lv7: 'FAIL' });
  expect('one match 34% floors', run(nine((i) => (i === 5 ? { floors420: 34 } : {}))), { ...ALL, floors7: 'FAIL' });
  expect('5 of 9 leaders win (56%)', run(nine((i) => ({ winner: i < 5 ? i % 4 : (i % 4 + 1) % 4, leader420: i % 4 }))), { ...ALL, leader: 'FAIL' });
  expect('4 of 9 leaders win (44%)', run(nine((i) => ({ winner: i < 4 ? i % 4 : (i % 4 + 1) % 4, leader420: i % 4 }))), { ...ALL, leader: 'PASS' });
  expect('3 of 9 with a 2-rank gap (33%)', run(nine((i) => ({ gap420: i < 3 ? 2 : 1 }))), { ...ALL, gap: 'FAIL' });
  expect('2 of 9 with a 2-rank gap (22%)', run(nine((i) => ({ gap420: i < 2 ? 2 : 1 }))), { ...ALL, gap: 'PASS' });
  expect('an integrity issue', run(nine((i) => (i === 0 ? { integrity: ['x'] } : {}))), { ...ALL, integrity: 'FAIL' });
  expect('a match that threw', run(nine((i) => (i === 0 ? { error: 'boom' } : {}))), { integrity: 'FAIL' });
  const si = run(nine(), true);
  expect('stand-in cannot certify', si, { 'end-median': 'NOT RUN', 'end-hard': 'NOT RUN', lv4: 'NOT RUN', lv7: 'NOT RUN', floors7: 'NOT RUN', leader: 'NOT RUN', gap: 'NOT RUN', integrity: 'PASS' });
  expect('stand-in can still fail', run(nine(() => ({ endS: null, result: null })), true), { 'end-hard': 'FAIL' });
  console.log(`selftest: ${n - bad}/${n} expectations held${bad ? ' - ' + bad + ' FAILED' : ''}`);
  return bad ? 1 : 0;
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (a.worker) return workerMain(a);
  if (a.selftest) return selfTest();
  const t00 = Date.now();
  const err = await loadSim();
  if (err) { console.error('SIM LOAD FAILED (a lane module is broken or mid-edit):\n' + err.split('\n').slice(0, 12).join('\n')); return 2; }
  mkdirSync(a.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(a.outDir, stamp);
  mkdirSync(dir, { recursive: true });
  const landed = nativeBotLanded();
  const driver: Driver = a.driver === 'auto' ? (landed ? 'native' : 'standin') : a.driver;
  console.log(`BLOCKTOOTH VS probe — ${new Date().toISOString()}  (logs: ${dir})`);
  console.log(`  VS bot brain (src/vs/bot): ${landed ? 'present' : 'ABSENT'} · match driver: ${driver}${driver === 'standin' ? '  *** STAND-IN solo bot: PvE economy only, NOT the REGULAR-bot gate ***' : ''}`);

  // ───────────── matches ─────────────
  const matches: MatchResult[] = [];
  let det: { name: string; same: boolean; detail: string }[] = [];
  let negControl: { differs: boolean; detail: string } | null = null;
  const cells: MatchCfg[] = [];
  if (!a.ttkOnly) {
    a.seeds.forEach((seed, si) => {
      for (const biome of a.biomes) {
        const base = a.lineup ?? [...TITANS4];
        const rot = si % base.length;                                    // rotate seat <-> titan per seed (spawn bias cancels out)
        const lineup = base.map((_, i) => base[(i + rot) % base.length]);
        cells.push({ seed, biome, lineup, level: a.level, driver, maxS: a.maxS, perturb: false, asserts: a.asserts, ...(a.humanSeat !== null ? { humanSeat: a.humanSeat, humanDriver: a.humanDriver } : {}) });
      }
    });
    const jobs: { name: string; job: Job }[] = cells.map((c) => ({ name: `m_${c.biome}_${c.seed}`, job: { kind: 'match', cfg: c } }));
    const detCells = cells.filter((c) => c.seed === a.seeds[0]).slice(0, a.det);
    for (const c of detCells) jobs.push({ name: `d_${c.biome}_${c.seed}`, job: { kind: 'match', cfg: c } });
    const negCell = cells[0];
    if (a.det > 0 && negCell) jobs.push({ name: `n_${negCell.biome}_${negCell.seed}`, job: { kind: 'match', cfg: { ...negCell, perturb: true } } });
    console.log(`\n[matches] ${cells.length} match(es) + ${detCells.length} determinism re-run(s)${a.det > 0 ? ' + 1 perturbed control' : ''}, ${a.jobs} at a time`);
    const res = await runJobs(jobs, dir, a.jobs, 40 * 60_000, a.quiet);
    for (let i = 0; i < cells.length; i++) {
      const r = readOut<MatchResult>(res[i]);
      if (r) matches.push(r);
      else gate('integrity', `match ${jobs[i].name} produced no result`, 'FAIL', `exit ${res[i].code}; log tail: ${res[i].log.split('\n').slice(-6).join(' | ').slice(0, 400)}`);
    }
    det = detCells.map((c, k) => {
      const r2 = readOut<MatchResult>(res[cells.length + k]);
      const r1 = matches.find((m) => m.cfg.seed === c.seed && m.cfg.biome === c.biome);
      const name = `${c.biome}/${c.seed}`;
      if (!r1 || !r2) return { name, same: false, detail: 'a run produced no result' };
      let first = -1;
      for (let i = 0; i < Math.max(r1.checkpoints.length, r2.checkpoints.length); i++) if (r1.checkpoints[i] !== r2.checkpoints[i]) { first = i; break; }
      return first < 0 && r1.hash === r2.hash && r1.ticks === r2.ticks
        ? { name, same: true, detail: `${r1.checkpoints.length} checkpoints (every 30 s), final ${r1.hash}, ${r1.ticks} ticks` }
        : { name, same: false, detail: `first divergence at checkpoint ${first} (match clock ${first * 30}s); final ${r1.hash} vs ${r2.hash}; ticks ${r1.ticks} vs ${r2.ticks}` };
    });
    if (a.det > 0 && negCell) {
      const rn = readOut<MatchResult>(res[res.length - 1]);
      const r1 = matches.find((m) => m.cfg.seed === negCell.seed && m.cfg.biome === negCell.biome);
      if (rn && r1) negControl = { differs: rn.hash !== r1.hash, detail: `perturbed final ${rn.hash} vs clean ${r1.hash}` };
    }
  }

  // ───────────── duels (TTK) ─────────────
  let duelsGeared: DuelResult[] = [], duelsBare: DuelResult[] = [], duelsStandin: DuelResult[] = [];
  if (a.ttk) {
    const pairs: [TitanId, TitanId][] = [];
    for (let i = 0; i < 4; i++) for (let j = i; j < 4; j++) pairs.push([TITANS4[i], TITANS4[j]]);
    const mk = (geared: boolean, drv: Driver): DuelCfg[] => {
      const l: DuelCfg[] = [];
      for (const rank of [1, 2, 3, 4]) for (const [x, y] of pairs) for (const seed of [1337, 7, 99]) l.push({ a: x, b: y, seed, biome: 'grideast', rank, geared, driver: drv, capS: 120 });
      return l;
    };
    const chunk = <T,>(arr: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
    const jobs: { name: string; job: Job }[] = [];
    const addDuels = (tag: string, list: DuelCfg[]): void => { chunk(list, 15).forEach((c, i) => jobs.push({ name: `duel_${tag}_${i}`, job: { kind: 'duels', duels: c } })); };
    if (driver === 'native') { addDuels('geared_native', mk(true, 'native')); addDuels('bare_native', mk(false, 'native')); }
    addDuels('geared_standin', mk(true, 'standin'));
    console.log(`\n[duels] equal-size 1v1 time-to-kill: ${jobs.length} batches (4 sizes x 10 pairs x 3 seeds per variant)`);
    const res = await runJobs(jobs, dir, a.jobs, 30 * 60_000, a.quiet);
    const collect = (prefix: string): DuelResult[] => res.filter((s) => s.name.startsWith(prefix)).flatMap((s) => readOut<DuelResult[]>(s) ?? []);
    duelsGeared = collect('duel_geared_native'); duelsBare = collect('duel_bare_native'); duelsStandin = collect('duel_geared_standin');
  }

  // ───────────── solo guard ─────────────
  let solo: SoloRun[] = [];
  let soloFull: { meta: string; diffs: string[] }[] = [];
  let baseBad: string[] = [];
  if (a.solo) {
    baseBad = checkBaselinesAgainstFiles();
    console.log('\n[solo guard] probe_sim --det 0 for the four frozen GATE 2 configs (parallel)');
    solo = await runSoloQuick(dir, a.quiet);
  }
  if (a.soloFull) {
    console.log('\n[solo guard] FULL GATE 2 matrix (fresh + full), compared line by line to the frozen RESUME logs ...');
    soloFull = await runSoloFull(dir);
  }

  // ═════════════ report ═════════════
  const ok = matches.filter((m) => !m.error);
  const fatalMatches = matches.filter((m) => m.error);
  console.log('\n══════════════════ MATCHES ══════════════════');
  if (matches.length) {
    console.log('seed/city              titans (by seat)                        end    @4:00 LV   @7:00 LV      floors 4:00/7:00  lead→win  gap  hits  KO  elim  tender  rail  ms/tick(p99)');
    for (const m of matches) {
      const s4 = m.snap240, s7 = m.snap420;
      const winner = m.winner;
      const ln = (s: typeof s4): string => (s ? s.lv.map((x) => String(x).padStart(2)).join(' ') : '-');
      const tend = m.tenders.filter((t) => t.paidS !== null).length;
      console.log(`${String(m.cfg.seed).padStart(4)}/${m.cfg.biome.padEnd(11)}  ${m.cfg.lineup.map((t) => t.slice(0, 5)).join(',').padEnd(34)}  ${m.endS === null ? ' NONE' : fmtClock(m.endS).padStart(5)}  ${ln(s4).padEnd(12)}  ${ln(s7).padEnd(12)}  ${(m.floors240 === null ? '-' : m.floors240.toFixed(0)).padStart(3)}% /${(m.floors420 === null ? '-' : m.floors420.toFixed(0)).padStart(3)}%       ${m.leader420}→${winner}${m.leader420 >= 0 && m.leader420 === winner ? ' *' : '  '}   ${m.gap420 < 0 ? '-' : m.gap420}   ${String(m.hits).padStart(4)}  ${String(m.evictions.length).padStart(2)}  ${String(m.eliminations.length).padStart(3)}   ${tend}/${m.tenders.length}     ${String(m.railOffers).padStart(3)}   ${m.perf.avgMs.toFixed(1)}(${m.perf.p99Ms.toFixed(0)})${m.error ? '  ERROR ' + m.error.slice(0, 100) : ''}`);
    }
  }
  for (const m of fatalMatches) console.log(`  ! ${m.cfg.biome}/${m.cfg.seed} threw: ${m.error}`);

  // lane readiness (observed evidence, one line per lane feature)
  const ev = (k: string): number => matches.reduce((s, m) => s + (m.events[k] ?? 0), 0);
  const anyPhase = (p: string): boolean => matches.some((m) => m.phaseAt[p] !== undefined);
  const readiness: [string, string, boolean | null, string][] = [
    ['B-VS', 'phase machine leaves COUNTDOWN and reaches takeover/final', anyPhase('takeover') && anyPhase('final'), `phases seen: ${[...new Set(matches.flatMap((m) => Object.keys(m.phaseAt)))].join(',') || '-'}; vsPhase events ${ev('vsPhase')}`],
    ['B-VS', 'native bot brain drives seats', driver === 'native' ? matches.length > 0 && matches.every((m) => m.travel60.every((d) => d > 30)) : null, driver === 'native' ? `min first-minute travel ${f1(Math.min(...matches.flatMap((m) => m.travel60)))} m` : 'driver is standin'],
    ['B-WORLD', 'XP / pickups reach EVERY seat (all 4 titans above LV 3 at 4:00)', matches.some((m) => m.snap240 !== null) ? matches.filter((m) => m.snap240).every((m) => m.snap240!.lv.every((l) => l > 3)) : null,
      `LV at 4:00 by seat, first match: ${matches.find((m) => m.snap240)?.snap240?.lv.join('/') ?? '-'}`],
    ['B-TITAN', 'CARD RAIL offers (railOffer events)', ev('railOffer') > 0, `${ev('railOffer')} offers, ${ev('railPick')} picks`],
    ['B-VS', 'PvP damage (rivalHit, not noContest)', matches.some((m) => m.hits > 0), `${matches.reduce((s, m) => s + m.hits, 0)} hits, ${matches.reduce((s, m) => s + m.noContest, 0)} noContest shoves`],
    ['B-VS', 'EVICTED (KO + respawn)', ev('evicted') > 0, `${ev('evicted')} evictions`],
    ['B-VS', 'CONDEMNATION ring (ringStep)', ev('ringStep') > 0, `${ev('ringStep')} ring steps`],
    ['B-VS', 'eliminations in FINAL NOTICE', ev('eliminated') > 0, `${ev('eliminated')} eliminations`],
    ['B-VS/B-WORLD', 'PUBLIC TENDER (tenderSpawn / tenderPaid)', ev('tenderSpawn') > 0, `${ev('tenderSpawn')} spawned, ${ev('tenderPaid')} paid`],
    ['B-VS', 'FRONT PAGE crown events', ev('crown') > 0, `${ev('crown')} crown events`],
    ['B-VS', 'match decided (vsEnd, result vs)', matches.some((m) => m.result === 'vs'), `${matches.filter((m) => m.result === 'vs').length}/${matches.length} matches ended with result vs`],
  ];
  if (matches.length) {
    console.log('\n══════════════════ LANE READINESS (observed, this run) ══════════════════');
    for (const [lane, what, v, d] of readiness) console.log(`  ${v === null ? ' n/a ' : v ? ' YES ' : '  NO '}  ${lane.padEnd(12)} ${what}  — ${d}`);
  }

  // VP gates
  const notLanded = readiness.filter((r) => r[2] === false).map((r) => r[1]);
  const lanesNote = notLanded.length ? ` (lane features not landed: ${notLanded.length}, see LANE READINESS)` : '';
  if (!a.ttkOnly && ok.length > 0) {
    evalMatchGates(ok, fatalMatches, a.maxS, a.wide, lanesNote, driver === 'standin');
    // determinism
    if (a.det > 0) {
      const bad = det.filter((d) => !d.same);
      gate('det', 'VS determinism: the same seed run again hashes identically at every checkpoint', det.length === 0 ? 'NOT RUN' : bad.length === 0 ? 'PASS' : 'FAIL',
        det.map((d) => `${d.name}: ${d.same ? 'IDENTICAL' : 'DIVERGED'} (${d.detail})`).join(' || '));
      gate('det-neg', 'determinism negative control: a perturbed run must differ', negControl === null ? 'NOT RUN' : negControl.differs ? 'PASS' : 'FAIL', negControl ? negControl.detail : 'no control ran');
    }
  } else if (!a.ttkOnly) {
    gate('end-median', 'matches', 'FAIL', 'no match produced a result');
  }

  // TTK
  if (a.ttk) {
    const summarize = (ds: DuelResult[]): { n: number; med: number; killed: number; noEngage: number; errors: number; byRank: string; eng: number; hp50: number; open: DuelResult[] } => {
      const err = ds.filter((d) => d.error).length;
      const good = ds.filter((d) => !d.error);
      const t = good.filter((d) => d.ttkS !== null).map((d) => d.ttkS as number);
      const byRank = [1, 2, 3, 4].map((r) => { const x = good.filter((d) => d.cfg.rank === r && d.ttkS !== null).map((d) => d.ttkS as number); return `S${r + 1}:${f1(median(x))}s(${x.length}/${good.filter((d) => d.cfg.rank === r).length})`; }).join(' ');
      return { n: good.length, med: median(t), killed: t.length, noEngage: good.filter((d) => d.engageS === null).length, errors: err, byRank, eng: median(good.filter((d) => d.engageS !== null).map((d) => d.engageS as number)), hp50: median(good.filter((d) => d.hp50S !== null).map((d) => d.hp50S as number)), open: good.filter((d) => d.ttkS === null), };
    };
    console.log('\n══════════════════ EQUAL-SIZE 1v1 TIME-TO-KILL (duels; both seats same Size + level) ══════════════════');
    const rows: [string, DuelResult[]][] = [['geared  REGULAR (native)  [GATE]', duelsGeared], ['bare    REGULAR (native)  [info]', duelsBare], ['geared  stand-in autos  [info]', duelsStandin]];
    for (const [name, ds] of rows) {
      if (ds.length === 0) { console.log(`  ${name.padEnd(34)} not run`); continue; }
      const s = summarize(ds);
      console.log(`  ${name.padEnd(34)} median ${f1(s.med)} s over ${s.killed}/${s.n} KOs (never engaged ${s.noEngage}, errors ${s.errors}) · median time to first hit ${f1(s.eng)} s · median time to bring one titan to 50% HP ${f1(s.hp50)} s · by size ${s.byRank}${s.open.length ? ` · ${s.open.length} duels with no KO in ${s.open[0].cfg.capS} s: median lowest HP left ${pct(median(s.open.map((d) => d.minHpf)))}, median final distance ${f1(median(s.open.map((d) => d.endDist)))} m` : ''}`);
    }
    const g = summarize(duelsGeared);
    const lanesTtk = !duelsGeared.length ? (driver === 'native' ? 'native duels did not run' : 'the native VS bot brain (src/vs/bot) is not landed: the gate is about REGULAR bots, the stand-in line above is information') : '';
    if (duelsGeared.length === 0) gate('ttk', `equal-size REGULAR 1v1 TTK median ${GATE.ttkS[0]}-${GATE.ttkS[1]} s`, 'NOT RUN', lanesTtk);
    else if (g.killed === 0) gate('ttk', `equal-size REGULAR 1v1 TTK median ${GATE.ttkS[0]}-${GATE.ttkS[1]} s`, 'FAIL', `no duel ended in a KO (${g.noEngage}/${g.n} never engaged; ${g.errors} errors)`);
    else gate('ttk', `equal-size REGULAR 1v1 TTK median ${GATE.ttkS[0]}-${GATE.ttkS[1]} s`, inBand(g.med, GATE.ttkS) ? 'PASS' : 'FAIL', `median ${f1(g.med)} s over ${g.killed}/${g.n} duels; by size ${g.byRank}${g.noEngage ? `; ${g.noEngage} never engaged` : ''}`);
  }

  // solo
  if (a.solo) {
    const bad = solo.filter((s) => !s.ok);
    const d = baseBad.length ? ` [baseline self-check FAILED: ${baseBad.join('; ')}]` : '';
    gate('solo', 'solo GATE 2 hashes unchanged (4 frozen configs, probe_sim --det 0)', baseBad.length ? 'FAIL' : bad.length === 0 ? 'PASS' : 'FAIL',
      solo.map((s) => `${s.name}: ${s.got ?? 'NO RESULT'}${s.ok ? ' =' : ' != ' + s.want}`).join(' | ') + d);
  }
  if (a.soloFull) {
    const bad = soloFull.filter((s) => s.diffs.length > 0);
    gate('solo', 'solo GATE 2 full matrix == frozen RESUME logs (per-run lines + det hashes)', bad.length === 0 ? 'PASS' : 'FAIL',
      soloFull.map((s) => `${s.meta}: ${s.diffs.length === 0 ? 'identical' : s.diffs.length + ' diff line(s): ' + s.diffs.slice(0, 2).join(' / ')}`).join(' | '));
  }

  // ───────────── verdict ─────────────
  console.log('\n══════════════════ VP GATE ══════════════════');
  for (const g of gates) console.log(`  ${g.status === 'PASS' ? 'PASS   ' : g.status === 'FAIL' ? 'FAIL   ' : 'NOT RUN'}  ${g.label}\n           ${g.detail}`);
  const fails = gates.filter((g) => g.status === 'FAIL');
  const notRun = gates.filter((g) => g.status === 'NOT RUN');
  if (fails.length) {
    console.log('\nWHICH LANE\'S KNOB MOVES EACH FAILED GATE');
    for (const g of fails) console.log(`  ${g.id}: ${KNOBS[g.id] ?? '-'}`);
  }
  const verdict = fails.length ? 'FAIL' : notRun.length ? 'INCOMPLETE (nothing failed; some gates NOT RUN)' : 'PASS';
  console.log(`\nVERDICT: ${verdict}  (${gates.filter((g) => g.status === 'PASS').length} pass, ${fails.length} fail, ${notRun.length} not run)  wall ${((Date.now() - t00) / 1000).toFixed(0)} s`);
  if (a.json) {
    mkdirSync(dirname(resolve(a.json)), { recursive: true });
    writeFileSync(a.json, JSON.stringify({ when: new Date().toISOString(), driver, args: a, gates, readiness: readiness.map((r) => ({ lane: r[0], what: r[1], landed: r[2], detail: r[3] })), matches, det, negControl, duels: { geared: duelsGeared, bare: duelsBare, standin: duelsStandin }, solo, soloFull }, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x), 1), 'utf8');
    console.log(`report -> ${a.json}`);
  }
  return fails.length ? 1 : notRun.length ? 3 : 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
