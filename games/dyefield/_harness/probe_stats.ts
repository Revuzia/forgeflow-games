// DYEFIELD — STATS gate G-S1 (_spec/CONTRACT_STATS.md §S12): the stats layer in node, headless, no network.
//
//   node _harness/probe_stats.ts                       # the gate (G-S1.1–.9), exit 0 pass · 1 a gate failed · 2 setup failure
//   node _harness/probe_stats.ts --baselines           # regenerate the §S4 table in memory and compare it with the committed
//                                                      # runtime/src/stats/baselines.ts (within 15 % per cell; INFO when the sim
//                                                      # changed on purpose) — 3 worker processes, one per map
//   node _harness/probe_stats.ts --baselines --write   # … and write runtime/src/stats/baselines.ts
//   node _harness/probe_stats.ts --quick               # the gate without the 12 + 4 bot matches (fixtures, lifecycle, merge,
//                                                      # online seam, queue only — a smoke run, NOT the gate)
//
// G-S1 sections (each prints PASS / FAIL lines):
//   1 hash invariance — TEAMS TURF / FFA TURF / TEAMS WASHOUT / FFA WASHOUT on pier18 seed 1: world.hash() at the horn
//     with a recorder fed every batch equals the hash of the same match without one
//   2 detectors on real matches — 12 bot matches (3 maps × 2 modes × 2 rules, seed 1, the human slot a SWELL bot, the
//     human kit rotating over the four kits, the shipping mixed lineup), events in frame-sized batches of 1–5 ticks:
//     every record eligible, its fields = the world's, each detector = an independent recomputation, liveS exact at the
//     horn and within 5 ticks at the limit
//   3 detectors on fixtures — one record per achievement that must fire and one near miss that must not
//   4 lifecycle — abandon / double begin / idle / short / statsdev
//   5 score — base medians per (mode, rule) in 900–1100 on the matches of section 2, integers, 0 when ineligible, the
//     FFA bonus ladder, the ceiling, per-tier caps, strictly rising tier ceilings, online uses TIER[skill]
//   6 merge properties (500 randomised cases) + interleaved saves + storage-less sessions + pending before readOk
//   7 (the --baselines mode)
//   8 online seam fixtures
//   9 the paced achievement queue (fake clock): ≥ 3,000 ms apart, each slug once per session, survives a reload
//
// The human slot (id 0) is a SWELL bot (roster[0].bot = true) as in probe_bots.ts. Every tick:
// director.think(intents) → world.step(intents); events are drained every 1–5 ticks (a seeded frame-size draw).

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById, WEAPONS, type MapDef } from '../runtime/src/core/data.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { MatchWorld, WASHOUT } from '../runtime/src/core/match/world.ts';
import { defaultRoster, type BotSkill } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { buildNav, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { BotDirector } from '../runtime/src/core/bots/director.ts';
import { emptyIntent, type MatchMode, type MatchRule, type PlayerIntent } from '../runtime/src/core/types.ts';
import { TICK } from '../runtime/src/core/config.ts';
import { mulberry32 } from '../runtime/src/core/rng.ts';
import { baseScore, CAP, TIER_MAX, TIER_MIN, BONUS_WIN, scoreRecord, resultBonus, tierCeiling, tierFactor, perfs, SCORE_CEILING } from '../runtime/src/stats/score.ts';
import { BASELINE, TIER, BASELINE_META } from '../runtime/src/stats/baselines.ts';
import { MatchRecorder, resultFor } from '../runtime/src/stats/recorder.ts';
import { ACHIEVEMENTS, DETECTORS, detect, detectorCoverage } from '../runtime/src/stats/achievements.ts';
import {
  addSlot, applyOutcome, emptySlot, foldSlots, maxMergeSlot, mergePreservingKeys, normSlot, thinPayload, emptyCounters,
  type KV,
} from '../runtime/src/stats/career.ts';
import { StatsCore, ACH_GAP_MS } from '../runtime/src/stats/core.ts';
import type { StatsEnv } from '../runtime/src/stats/portal.ts';
import type {
  BeginInfo, CareerCounters, CloudRecord, MatchRecord, OnlineFinal, Outcome, Slot, StatsWorldView,
} from '../runtime/src/stats/types.ts';
import type { MatchResult } from '../runtime/src/core/match/world.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINES_TS = resolve(ROOT, 'runtime', 'src', 'stats', 'baselines.ts');

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const BASELINES = argv.includes('--baselines');
const WRITE = argv.includes('--write');
const WORKER = argv.includes('--baselines-worker');
const QUICK = argv.includes('--quick');

export const MAP_IDS = ['pier18', 'lockwell', 'cinder'] as const;
export const MODES: readonly MatchMode[] = ['teams', 'ffa'];
export const RULES: readonly MatchRule[] = ['turf', 'washout'];
export const KIT_IDS: readonly string[] = WEAPONS.kits.map((k) => k.id);
const E_SEEDS = [1, 2, 3, 4, 5];
const TIER_SEEDS = [1, 2, 3];
const TIER_KIT = 'mist-rasp';

// ───────────────────────────── helpers ─────────────────────────────

interface Check { name: string; pass: boolean; detail: string; info?: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
function info(name: string, detail: string): void {
  checks.push({ name, pass: true, detail, info: true });
  console.log(`INFO  ${name}  —  ${detail}`);
}
export const median = (a: number[]): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** the shipping bot kits (a copy of view/players.ts mixedBotKits — that module imports THREE): the human's 3 crewmates
 *  carry the 3 kits the human does not, the rival crew all 4 (FFA: the same 7 kits on the 7 bots) */
export function mixedBotKits(humanKit: string): string[] {
  const all = KIT_IDS.slice();
  const mates = all.filter((k) => k !== humanKit);
  while (mates.length < 3) mates.push(all[mates.length % all.length] ?? humanKit);
  const rivals = [...all];
  while (rivals.length < 4) rivals.push(all[rivals.length % all.length] ?? humanKit);
  return [...mates.slice(0, 3), ...rivals.slice(0, 4)];
}

// ───────────────────────────── the sim ─────────────────────────────

type Rapier = Awaited<ReturnType<typeof loadRapier>>;
interface Arena { def: MapDef; geo: MapGeometry; nav: NavGraph }
let RAPIER: Rapier | null = null;
const ARENAS = new Map<string, Arena>();

async function arena(map: string): Promise<Arena> {
  if (!RAPIER) RAPIER = await loadRapier();
  const hit = ARENAS.get(map);
  if (hit) return hit;
  const def = mapById(map);
  const geo = await loadMapGeometry(def);
  const nav = buildNav(geo, new PhysicsWorld(RAPIER, geo), def);
  const a = { def, geo, nav };
  ARENAS.set(map, a);
  return a;
}

export interface RunOpts {
  map: string; mode: MatchMode; rule: MatchRule; seed: number;
  /** one tier for every bot, or one per runner id */
  skill: BotSkill | BotSkill[];
  humanKit: string;
  /** frame-size draw: events are drained every 1..maxBatch ticks (1 = every tick) */
  maxBatch?: number;
  /** called after every drain (the events of the batch, the world) */
  observe?: (events: readonly SimEvent[], w: MatchWorld) => void;
  /** called once the world exists (before the first step) */
  onWorld?: (w: MatchWorld) => void;
  /** keep stepping the rest of a batch after the horn, as the Game's frame loop does (the drain that carries 'ended' can
   *  then be up to maxBatch − 1 ticks late — the §S2.1 clock case). Default: stop at the horn. */
  fullBatch?: boolean;
}
export interface RunOut { world: MatchWorld; hash: string; liveS: number; wallMs: number; endTick: number }

export async function runMatch(o: RunOpts): Promise<RunOut> {
  const A = await arena(o.map);
  const R = RAPIER!;
  const physics = new PhysicsWorld(R, A.geo);
  const sc = A.def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(A.geo.paint, A.geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const scalarSkill: BotSkill = Array.isArray(o.skill) ? 'swell' : o.skill;
  const roster = defaultRoster({ humanKit: o.humanKit, seed: o.seed, skill: scalarSkill, botKits: mixedBotKits(o.humanKit), mode: o.mode });
  roster[0].bot = true;                                     // the human slot is a bot too (probe_bots.ts §10.3)
  const world = new MatchWorld({
    def: A.def, geo: A.geo, physics, painter, roster, seed: o.seed,
    ...(o.mode === 'ffa' ? { mode: 'ffa' as const } : {}),
    ...(o.rule === 'washout' ? { rule: 'washout' as const } : {}),
  });
  o.onWorld?.(world);
  const director = new BotDirector(world, A.nav, o.seed, o.skill);
  const intents: PlayerIntent[] = roster.map(() => emptyIntent());
  const ev: SimEvent[] = [];
  const batchRnd = mulberry32((o.seed * 7919) ^ 0x51a75);
  const maxB = Math.max(1, o.maxBatch ?? 1);
  const t0 = performance.now();
  let guard = 0;
  let endTick = -1;
  const ended = (): boolean => world.phase === 'ended';
  const limit = (world.durationS + world.countdownS + 10) / TICK;
  while (!ended() && guard < limit) {
    const n = maxB === 1 ? 1 : 1 + Math.floor(batchRnd() * maxB);
    for (let k = 0; k < n && (o.fullBatch || !ended()); k++) {
      director.think(intents);
      world.step(intents);
      guard++;
      if (endTick < 0 && ended()) endTick = world.tick;
    }
    ev.length = 0;
    world.drainEvents(ev);
    o.observe?.(ev, world);
  }
  const liveTick = Math.round(world.countdownS / TICK);
  const liveS = world.endedBy === 'horn' ? world.durationS : (endTick - liveTick) * TICK;
  return { world, hash: world.hash(), liveS, wallMs: performance.now() - t0, endTick };
}

// ───────────────────────────── §S4 baselines (section 7) ─────────────────────────────

interface RawRun {
  map: string; mode: MatchMode; rule: MatchRule; seed: number; tier: BotSkill; liveS: number; endedBy: string; hash: string;
  wallMs: number; runners: Array<{ id: number; kit: string; painted: number; washes: number }>;
}

async function baselineWorker(map: string, out: string): Promise<number> {
  const runs: RawRun[] = [];
  const push = (o: RunOpts, tier: BotSkill, r: RunOut): void => {
    runs.push({
      map, mode: o.mode, rule: o.rule, seed: o.seed, tier, liveS: r.liveS, endedBy: r.world.endedBy ?? 'horn', hash: r.hash, wallMs: r.wallMs,
      runners: r.world.runners.map((x) => ({ id: x.id, kit: x.kit, painted: x.painted, washes: x.washes })),
    });
    console.log(`  ${map} ${o.mode} ${o.rule} seed ${o.seed} ${tier}: ${(r.wallMs / 1000).toFixed(1)} s · live ${r.liveS.toFixed(1)} s · ${r.world.endedBy} · ${r.hash}`);
  };
  for (const mode of MODES) for (const rule of RULES) {
    for (const seed of E_SEEDS) {
      const o: RunOpts = { map, mode, rule, seed, skill: 'swell', humanKit: TIER_KIT };
      push(o, 'swell', await runMatch(o));
    }
    for (const tier of ['breeze', 'storm'] as BotSkill[]) for (const seed of TIER_SEEDS) {
      const skills: BotSkill[] = Array.from({ length: 8 }, (_, i) => (i === 0 ? 'swell' : tier));
      const o: RunOpts = { map, mode, rule, seed, skill: skills, humanKit: TIER_KIT };
      push(o, tier, await runMatch(o));
    }
  }
  writeFileSync(out, JSON.stringify(runs));
  return 0;
}

interface Table { cells: Record<string, Record<string, Record<string, Record<string, { paint: number; wash: number }>>>>; tier: Record<BotSkill, number> }

function computeTable(runs: RawRun[]): { table: Table; detail: string[]; ok: boolean; ratios: Record<string, number> } {
  const detail: string[] = [];
  const cells: Table['cells'] = {};
  for (const map of MAP_IDS) for (const mode of MODES) for (const rule of RULES) {
    const es = runs.filter((r) => r.map === map && r.mode === mode && r.rule === rule && r.tier === 'swell');
    for (const kit of KIT_IDS) {
      const p: number[] = [], w: number[] = [];
      for (const r of es) {
        const t = Math.max(r.liveS, 30) / 60;
        for (const x of r.runners) if (x.kit === kit) { p.push(x.painted / t); w.push(x.washes / t); }
      }
      if (!p.length) continue;
      ((cells[map] ??= {})[mode] ??= {})[rule] ??= {};
      cells[map][mode][rule][kit] = { paint: Math.round(median(p) * 10) / 10, wash: Math.round(median(w) * 1000) / 1000 };
    }
  }
  // TIER: slot 0 (SWELL, the TIER_KIT) against SWELL bots / against the tier, UNCAPPED bases, E from this generation
  const cellOf = (map: string, mode: string, rule: string, kit: string): { paint: number; wash: number } => cells[map]?.[mode]?.[rule]?.[kit] ?? { paint: 100, wash: 1 };
  const base0 = (r: RawRun): number => {
    const x = r.runners[0];
    const t = Math.max(r.liveS, 30) / 60;
    const c = cellOf(r.map, r.mode, r.rule, x.kit);
    const pPerf = (x.painted / t) / Math.max(c.paint, 100);
    const wPerf = (x.washes / t) / Math.max(c.wash, 1);
    const [wp, ww] = r.rule === 'turf' ? [0.7, 0.3] : [0.3, 0.7];
    return 1000 * (wp * pPerf + ww * wPerf);
  };
  const bases: Record<BotSkill, number[]> = { breeze: [], swell: [], storm: [] };
  for (const r of runs) {
    if (r.tier === 'swell' && !TIER_SEEDS.includes(r.seed)) continue;
    bases[r.tier].push(base0(r));
  }
  const mSwell = median(bases.swell);
  const ratios: Record<string, number> = {};
  const tier: Record<BotSkill, number> = { breeze: 1, swell: 1, storm: 1 };
  for (const t of ['breeze', 'storm'] as BotSkill[]) {
    const m = median(bases[t]);
    ratios[t] = mSwell / m;
    tier[t] = Math.round(Math.min(TIER_MAX, Math.max(TIER_MIN, mSwell / m)) * 1000) / 1000;
    detail.push(`slot-0 base median vs ${t}: ${m.toFixed(1)} (n ${bases[t].length}); vs swell ${mSwell.toFixed(1)} (n ${bases.swell.length}) → raw ${(mSwell / m).toFixed(3)} → TIER.${t} ${tier[t]}`);
  }
  const ceil = (t: BotSkill): number => (1000 * CAP[t] + BONUS_WIN) * tier[t];
  let ok = true;
  if (!(tier.breeze < 1)) { ok = false; detail.push(`FAIL: TIER.breeze ${tier.breeze} ≥ 1`); }
  if (!(tier.storm > 1)) { ok = false; detail.push(`FAIL: TIER.storm ${tier.storm} ≤ 1`); }
  if (!(ceil('breeze') < ceil('swell') && ceil('swell') < ceil('storm'))) {
    ok = false; detail.push(`FAIL: ceilings not strictly increasing: breeze ${ceil('breeze').toFixed(0)} · swell ${ceil('swell').toFixed(0)} · storm ${ceil('storm').toFixed(0)}`);
  } else detail.push(`ceilings: breeze ${ceil('breeze').toFixed(0)} < swell ${ceil('swell').toFixed(0)} < storm ${ceil('storm').toFixed(0)}`);
  return { table: { cells, tier }, detail, ok, ratios };
}

function renderBaselines(t: Table, runs: RawRun[], wallS: number): string {
  const date = new Date().toISOString();
  const hashes = runs.filter((r) => r.seed === 1 && r.tier === 'swell').map((r) => `${r.map}/${r.mode}/${r.rule}/seed1 ${r.hash}`);
  const L: string[] = [];
  L.push('// DYEFIELD — STATS score baselines (_spec/CONTRACT_STATS.md §S4). GENERATED — never hand-tune.');
  L.push('//');
  L.push('//   command : node _harness/probe_stats.ts --baselines --write');
  L.push(`//   date    : ${date}`);
  L.push(`//   E cells : bot-only SWELL matches, the shipping mixed lineup (human slot = a SWELL bot with ${TIER_KIT}), 3:00, the real`);
  L.push(`//             WASHOUT limits; ${MAP_IDS.join(' / ')} × TEAMS / FFA × TURF / WASHOUT, seeds ${E_SEEDS.join(',')} (${runs.filter((r) => r.tier === 'swell').length} matches);`);
  L.push('//             each cell = the median over every runner of that kit of painted / t and washes / t, t = max(liveS, 30) / 60');
  L.push(`//   TIER    : slot 0 SWELL (${TIER_KIT}) vs every other runner at the tier, 12 combos × seeds ${TIER_SEEDS.join(',')}; TIER[t] =`);
  L.push(`//             clamp(median UNCAPPED base of slot 0 vs SWELL / vs t, ${TIER_MIN}, ${TIER_MAX}); TIER.swell = 1`);
  L.push(`//   wall    : ${wallS.toFixed(0)} s (3 worker processes)`);
  L.push('//   sim hashes at generation (MatchWorld.hash() at the horn of each seed-1 SWELL match — a balance change moves these;');
  L.push('//   a cell moving > 15 % means: regenerate):');
  for (const h of hashes) L.push(`//     ${h}`);
  L.push('');
  L.push('export interface BaselineCell { paint: number; wash: number }');
  L.push('');
  L.push('export const BASELINE_META = {');
  L.push('  generated: true,');
  L.push("  command: 'node _harness/probe_stats.ts --baselines --write',");
  L.push(`  seeds: [${E_SEEDS.join(', ')}] as number[],`);
  L.push(`  date: '${date}',`);
  L.push('  probeHashes: [');
  for (const h of hashes) L.push(`    '${h}',`);
  L.push('  ] as string[],');
  L.push('};');
  L.push('');
  L.push('/** per-minute medians: BASELINE[map][mode][rule][kit] = { paint: weighted m² / min, wash: credited washes / min } */');
  L.push('export const BASELINE: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, BaselineCell>>>>>>>> = {');
  for (const map of Object.keys(t.cells)) {
    L.push(`  ${map}: {`);
    for (const mode of Object.keys(t.cells[map])) {
      L.push(`    ${mode}: {`);
      for (const rule of Object.keys(t.cells[map][mode])) {
        const cells = t.cells[map][mode][rule];
        const parts = Object.keys(cells).map((k) => `'${k}': { paint: ${cells[k].paint}, wash: ${cells[k].wash} }`);
        L.push(`      ${rule}: { ${parts.join(', ')} },`);
      }
      L.push('    },');
    }
    L.push('  },');
  }
  L.push('};');
  L.push('');
  L.push('/** bot-tier score factor (SWELL = 1) */');
  L.push(`export const TIER: Readonly<Record<'breeze' | 'swell' | 'storm', number>> = { breeze: ${t.tier.breeze}, swell: 1, storm: ${t.tier.storm} };`);
  L.push('');
  return L.join('\n');
}

async function baselinesMain(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'df-baselines-'));
  const t0 = performance.now();
  console.log(`baselines: ${MAP_IDS.length} workers (one per map) · E seeds ${E_SEEDS.join(',')} · TIER seeds ${TIER_SEEDS.join(',')} · scratch ${dir}`);
  const codes = await Promise.all(MAP_IDS.map((map) => new Promise<number>((ok) => {
    const out = join(dir, `${map}.json`);
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--baselines-worker', '--map', map, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (b: Buffer) => process.stdout.write(b));
    p.stderr.on('data', (b: Buffer) => { const s = b.toString(); if (!/ExperimentalWarning|--trace-warnings/.test(s)) process.stderr.write(s); });
    p.on('close', (c) => ok(c ?? 1));
  })));
  if (codes.some((c) => c !== 0)) { console.log(`SETUP FAILED: worker exit codes ${codes.join(',')}`); rmSync(dir, { recursive: true, force: true }); return 2; }
  const runs: RawRun[] = MAP_IDS.flatMap((map) => JSON.parse(readFileSync(join(dir, `${map}.json`), 'utf8')) as RawRun[]);
  rmSync(dir, { recursive: true, force: true });
  const wallS = (performance.now() - t0) / 1000;
  const { table, detail, ok } = computeTable(runs);
  for (const d of detail) console.log('  ' + d);
  check('baselines generator: TIER.breeze < 1 < TIER.storm and tier ceilings strictly increasing', ok, detail.filter((d) => d.startsWith('FAIL')).join(' · ') || 'ok');
  // compare with the committed table (15 % per cell)
  let worst = 0, worstKey = '', missing = 0;
  for (const map of Object.keys(table.cells)) for (const mode of Object.keys(table.cells[map])) for (const rule of Object.keys(table.cells[map][mode])) {
    for (const kit of Object.keys(table.cells[map][mode][rule])) {
      const n = table.cells[map][mode][rule][kit];
      const c = BASELINE[map]?.[mode]?.[rule]?.[kit];
      if (!c) { missing++; continue; }
      for (const f of ['paint', 'wash'] as const) {
        const floor = f === 'paint' ? 100 : 1;
        const d = Math.abs(Math.max(n[f], floor) - Math.max(c[f], floor)) / Math.max(c[f], floor);
        if (d > worst) { worst = d; worstKey = `${map}/${mode}/${rule}/${kit}.${f} ${c[f]} → ${n[f]}`; }
      }
    }
  }
  const tierD = Math.max(Math.abs(table.tier.breeze - TIER.breeze), Math.abs(table.tier.storm - TIER.storm));
  const msg = `committed table (${BASELINE_META.generated ? BASELINE_META.date : 'PLACEHOLDER'}): ${missing} cells missing · worst cell Δ ${(worst * 100).toFixed(1)} % (${worstKey || '—'}) · TIER Δ ${tierD.toFixed(3)} (now breeze ${table.tier.breeze} / storm ${table.tier.storm})`;
  if (WRITE) {
    writeFileSync(BASELINES_TS, renderBaselines(table, runs, wallS), 'utf8');
    info('baselines written', `${BASELINES_TS} · ${runs.length} matches · ${wallS.toFixed(0)} s · ${msg}`);
  } else {
    if (missing === 0 && worst <= 0.15) check('committed baselines within 15 % per cell of a fresh generation', true, msg);
    else info('committed baselines differ from a fresh generation (regenerate with --write if the sim changed on purpose)', msg);
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: baselines (${runs.length} matches, ${wallS.toFixed(0)} s)`);
  return failed.length ? 1 : 0;
}

// ───────────────────────────── G-S1 gates ─────────────────────────────

const r1 = (v: number): number => Math.round(v * 10) / 10;
/** a key-sorted JSON (deep equality that ignores key order) */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** an independent tally of the local runner's event-derived numbers (written apart from recorder.ts on purpose) */
class Tally {
  specials = 0; subs = 0; splash = 0; streak = 0; best = 0;
  private hits = new Map<number, [number, number]>();
  private me: number;
  constructor(me: number) { this.me = me; }
  feed(ev: readonly SimEvent[], w: MatchWorld): void {
    const myTeam = w.runners[this.me].team;
    const window = Math.round(WASHOUT.seaCreditS / TICK);
    for (const e of ev) {
      if (e.t === 'hit') { if (e.by >= 0) this.hits.set(e.victim, [e.by, w.tick]); }
      else if (e.t === 'special') { if (e.pid === this.me && e.phase === 'start') this.specials++; }
      else if (e.t === 'sub') { if (e.pid === this.me && e.phase === 'throw') this.subs++; }
      else if (e.t === 'washed') {
        if (e.victim === this.me) { this.streak = 0; continue; }
        const foe = w.runners[e.victim].team !== myTeam;
        if (e.by === this.me) {
          this.streak++;
          if (this.streak > this.best) this.best = this.streak;
          if (e.cause === 'sea' && foe) this.splash++;
        } else if (e.by === null && e.cause === 'sea' && foe) {
          const h = this.hits.get(e.victim);
          if (h && h[0] === this.me && w.tick - h[1] <= window) this.splash++;
        }
      }
    }
  }
}

/** the detectors' verdicts recomputed from the WORLD (result, runner counters) + the tally, for a fresh career */
function expectedSlugs(w: MatchWorld, t: Tally, me: number): Set<string> {
  const res = w.result!;
  const my = w.runners[me];
  const myTeam = my.team;
  const win = res.winner === myTeam;
  const painted = Math.round(my.painted);
  const rank = res.standings?.find((s) => s.crew === myTeam)?.rank ?? 99;
  const share = res.shares?.[myTeam] ?? 0;
  const ffa = w.mode === 'ffa', teams = !ffa, turf = w.rule === 'turf', wash = !turf;
  const out = new Set<string>();
  const add = (slug: string, cond: boolean): void => { if (cond) out.add(slug); };
  add('first_match', true);
  add('first_win', win);
  add('teams_turf_win', teams && turf && win);
  add('teams_washout_win', teams && wash && win);
  add('ffa_turf_win', ffa && turf && win);
  add('ffa_washout_win', ffa && wash && win);
  add('ffa_podium', ffa && rank <= 3);
  add('washout_limit', wash && win && w.endedBy === 'limit');
  add('kit_mist_rasp', win && my.kit === 'mist-rasp');
  add('kit_sheet_drum', win && my.kit === 'sheet-drum');
  add('kit_needle_glint', win && my.kit === 'needle-glint');
  add('kit_pop_well', win && my.kit === 'pop-well');
  add('map_pier18', win && w.def.id === 'pier18');
  add('map_lockwell', win && w.def.id === 'lockwell');
  add('map_cinder', win && w.def.id === 'cinder');
  add('turf_50', teams && turf && r1(share * 100) >= 50);
  add('paint_1500', painted >= 1500);
  add('washes_10', my.washes >= 10);
  add('streak_5', t.best >= 5);
  add('splashdown', t.splash >= 1);
  add('flawless', win && my.washedCount === 0 && painted >= 600);
  return out;                                               // all_kits / all_maps / storm / counts / online: never, here
}

interface GateMatch { label: string; mode: MatchMode; rule: MatchRule; map: string; out: RunOut; rec: MatchRecord | null }

async function sectionMatches(): Promise<GateMatch[]> {
  console.log('\n── G-S1.1 hash invariance + G-S1.2 detectors on 12 real matches (frame batches of 1–5 ticks) ──');
  const res: GateMatch[] = [];
  let idx = 0;
  const invariance: string[] = [];
  let invOk = true;
  for (const map of MAP_IDS) for (const mode of MODES) for (const rule of RULES) {
    const kit = KIT_IDS[idx % KIT_IDS.length];
    const label = `${map} ${mode} ${rule} (${kit})`;
    const outs: Outcome[] = [];
    const at = 1_700_000_000_000 + idx;
    const rec = new MatchRecorder({ statsDev: false, sink: (o) => outs.push(o), now: () => at });
    const tally = new Tally(0);
    const opts: RunOpts = {
      map, mode, rule, seed: 1, skill: 'swell', humanKit: kit, maxBatch: 5, fullBatch: true,
      onWorld: (w) => rec.begin(w, { kit: w.runners[0].kit, skill: 'swell', online: null, localPid: 0 }),
      observe: (ev, w) => { rec.events(ev, w); tally.feed(ev, w); },
    };
    const out = await runMatch(opts);
    const w = out.world;
    const bad: string[] = [];
    const r = outs.length === 1 && outs[0].k === 'record' ? outs[0].rec : null;
    if (!r) bad.push(`outcomes ${JSON.stringify(outs.map((o) => o.k))}`);
    if (r) {
      const me = w.runners[0];
      const want = resultFor(w.result!, me.team, w.mode, w.rule);
      if (!r.eligible) bad.push('not eligible');
      if (r.washes !== me.washes) bad.push(`washes ${r.washes} vs ${me.washes}`);
      if (r.washed !== me.washedCount) bad.push(`washed ${r.washed} vs ${me.washedCount}`);
      if (r.paintedM2 !== Math.round(me.painted)) bad.push(`painted ${r.paintedM2} vs ${Math.round(me.painted)}`);
      const res0 = w.result!;
      const indep: 'win' | 'loss' | 'draw' = res0.winner === me.team ? 'win'
        : res0.winner === 0 && (w.mode === 'teams' || (res0.tied ?? []).includes(me.team)) ? 'draw' : 'loss';
      if (r.result !== indep) bad.push(`result ${r.result} vs ${indep}`);
      if (r.place !== want.place) bad.push(`place ${r.place} vs ${want.place}`);
      if (r.turfPct !== r1((res0.shares?.[me.team] ?? 0) * 100)) bad.push(`turfPct ${r.turfPct} vs shares ${res0.shares?.[me.team]}`);
      if (w.rule === 'washout' && r.crewScore !== (res0.scores[me.team] ?? 0)) bad.push(`crewScore ${r.crewScore}`);
      if (r.specials !== tally.specials || r.subs !== tally.subs || r.splashdowns !== tally.splash || r.bestStreak !== tally.best) {
        bad.push(`tally sp ${r.specials}/${tally.specials} sub ${r.subs}/${tally.subs} splash ${r.splashdowns}/${tally.splash} streak ${r.bestStreak}/${tally.best}`);
      }
      const liveTick = Math.round(w.countdownS / TICK);
      const trueLive = (out.endTick - liveTick) * TICK;
      let clock = '';
      if (w.endedBy === 'horn') { if (r.liveS !== r1(w.durationS)) bad.push(`liveS ${r.liveS} vs durationS ${w.durationS}`); }
      else {
        // within 5 ticks of the sim clock, plus the record's own 0.1 s rounding (§S2.2 stores liveS to 1 decimal)
        if (Math.abs(r.liveS - trueLive) > 5 * TICK + 0.05 + 1e-9) bad.push(`liveS ${r.liveS} vs sim ${trueLive.toFixed(3)} (limit)`);
        clock = ` (sim ${trueLive.toFixed(3)} s, Δ ${(r.liveS - trueLive).toFixed(3)} s)`;
      }
      const C = emptySlot(0);
      applyOutcome(C, { k: 'record', rec: r });
      const got = new Set(detect(r, C.c));
      const exp = expectedSlugs(w, tally, 0);
      const miss = [...exp].filter((s) => !got.has(s)), extra = [...got].filter((s) => !exp.has(s));
      if (miss.length || extra.length) bad.push(`detectors missing [${miss.join(',')}] extra [${extra.join(',')}]`);
      check(`G-S1.2 ${label}`, bad.length === 0,
        bad.length ? bad.join(' · ') : `${r.result} place ${r.place}/${r.crews} · ${r.paintedM2} m² · ${r.washes} washes / ${r.washed} washed · streak ${r.bestStreak} · splash ${r.splashdowns} · sp ${r.specials} · subs ${r.subs} · live ${r.liveS} s (${w.endedBy})${clock} · score ${r.score} · unlocks [${[...got].join(',')}] · ${(out.wallMs / 1000).toFixed(1)} s`);
    } else check(`G-S1.2 ${label}`, false, bad.join(' · '));
    res.push({ label, mode, rule, map, out, rec: r });
    if (map === 'pier18') {
      const plain = await runMatch({ map, mode, rule, seed: 1, skill: 'swell', humanKit: kit, maxBatch: 5, fullBatch: true });
      const same = plain.hash === out.hash;
      if (!same) invOk = false;
      invariance.push(`${mode} ${rule}: ${out.hash}${same ? ' =' : ' ≠ ' + plain.hash}`);
    }
    idx++;
  }
  check('G-S1.1 hash invariance (pier18 seed 1, recorder fed every batch vs none)', invOk, invariance.join(' · '));
  return res;
}

// ── fixtures ──

let FX_N = 0;
function fx(o: Partial<MatchRecord> = {}): MatchRecord {
  FX_N++;
  return {
    id: `fx${FX_N}`, at: 1_700_000_000_000 + FX_N, v: 1, mode: 'teams', rule: 'turf', map: 'lockwell', kit: 'sheet-drum', skill: 'swell',
    online: false, humans: 1, result: 'loss', place: 2, crews: 2, turfPct: 30, crewScore: 0, washes: 2, washed: 3, paintedM2: 500,
    specials: 0, subs: 0, splashdowns: 0, bestStreak: 1, liveS: 180, endedBy: 'horn', score: 0, scoreV: 1, eligible: true, ...o,
  };
}
function careerWith(r: MatchRecord, pre?: (c: CareerCounters) => void): CareerCounters {
  const s = emptySlot(0);
  pre?.(s.c);
  applyOutcome(s, { k: 'record', rec: r });
  return s.c;
}
const WIN = { result: 'win' as const, place: 1 };
const DRAW = { result: 'draw' as const, place: 1 };

function sectionFixtures(): void {
  console.log('\n── G-S1.3 detectors on fixtures (one must-fire + one near miss per achievement) ──');
  const cov = detectorCoverage();
  check('achievements.json ↔ detectors: one detector per row, no orphan', !cov.missingDetector.length && !cov.orphanDetector.length,
    `rows ${ACHIEVEMENTS.length} · missing [${cov.missingDetector.join(',')}] · orphan [${cov.orphanDetector.join(',')}]`);
  const xp = ACHIEVEMENTS.reduce((s, a) => s + a.points, 0);
  const tiers = ACHIEVEMENTS.reduce<Record<string, number>>((m, a) => { m[a.tier] = (m[a.tier] ?? 0) + 1; return m; }, {});
  const pts: Record<string, number> = { bronze: 5, silver: 15, gold: 30 };
  check('the set: 29 rows, 340 XP, 14 bronze / 12 silver / 3 gold, points by tier, unique slugs, limits',
    ACHIEVEMENTS.length === 29 && xp === 340 && tiers.bronze === 14 && tiers.silver === 12 && tiers.gold === 3
      && ACHIEVEMENTS.every((a) => a.points === pts[a.tier] && a.secret === false && a.slug.length <= 64 && a.name.length <= 80 && a.description.length <= 240)
      && new Set(ACHIEVEMENTS.map((a) => a.slug)).size === 29,
    `${ACHIEVEMENTS.length} rows · ${xp} XP · ${JSON.stringify(tiers)}`);
  const ffaWin = { mode: 'ffa' as const, crews: 8, ...WIN };
  const ffaDraw = { mode: 'ffa' as const, crews: 8, ...DRAW };
  type Case = [MatchRecord, CareerCounters];
  const one = (o: Partial<MatchRecord>, pre?: (c: CareerCounters) => void): Case => { const r = fx(o); return [r, careerWith(r, pre)]; };
  const winsOn = (field: 'byKit' | 'byMap', ids: string[]) => (c: CareerCounters): void => { for (const k of ids) c[field][k] = { m: 1, w: 1, l: 0, d: 0 }; };
  const cases: Record<string, { fire: Case; miss: Case }> = {
    first_match: { fire: one({}), miss: one({ eligible: false, paintedM2: 0, washes: 0 }) },
    first_win: { fire: one(WIN), miss: one(DRAW) },
    teams_turf_win: { fire: one({ ...WIN }), miss: one({ ...DRAW }) },
    teams_washout_win: { fire: one({ rule: 'washout', ...WIN }), miss: one({ rule: 'washout', ...DRAW }) },
    ffa_turf_win: { fire: one({ ...ffaWin }), miss: one({ ...ffaDraw }) },
    ffa_washout_win: { fire: one({ ...ffaWin, rule: 'washout' }), miss: one({ ...ffaDraw, rule: 'washout' }) },
    ffa_podium: { fire: one({ mode: 'ffa', crews: 8, place: 3 }), miss: one({ mode: 'ffa', crews: 8, place: 4 }) },
    washout_limit: { fire: one({ rule: 'washout', endedBy: 'limit', ...WIN }), miss: one({ rule: 'washout', endedBy: 'horn', ...WIN }) },
    kit_mist_rasp: { fire: one({ kit: 'mist-rasp', ...WIN }), miss: one({ kit: 'mist-rasp', ...DRAW }) },
    kit_sheet_drum: { fire: one({ kit: 'sheet-drum', ...WIN }), miss: one({ kit: 'sheet-drum', ...DRAW }) },
    kit_needle_glint: { fire: one({ kit: 'needle-glint', ...WIN }), miss: one({ kit: 'needle-glint', ...DRAW }) },
    kit_pop_well: { fire: one({ kit: 'pop-well', ...WIN }), miss: one({ kit: 'pop-well', ...DRAW }) },
    all_kits: {
      fire: one({ kit: 'pop-well', ...WIN }, winsOn('byKit', ['mist-rasp', 'sheet-drum', 'needle-glint'])),
      miss: one({ kit: 'pop-well', ...DRAW }, winsOn('byKit', ['mist-rasp', 'sheet-drum', 'needle-glint'])),
    },
    map_pier18: { fire: one({ map: 'pier18', ...WIN }), miss: one({ map: 'pier18', ...DRAW }) },
    map_lockwell: { fire: one({ map: 'lockwell', ...WIN }), miss: one({ map: 'lockwell', ...DRAW }) },
    map_cinder: { fire: one({ map: 'cinder', ...WIN }), miss: one({ map: 'cinder', ...DRAW }) },
    all_maps: {
      fire: one({ map: 'cinder', ...WIN }, winsOn('byMap', ['pier18', 'lockwell'])),
      miss: one({ map: 'cinder', ...DRAW }, winsOn('byMap', ['pier18', 'lockwell'])),
    },
    turf_50: { fire: one({ turfPct: 50 }), miss: one({ turfPct: 49.9 }) },
    paint_1500: { fire: one({ paintedM2: 1500 }), miss: one({ paintedM2: 1499 }) },
    washes_10: { fire: one({ washes: 10 }), miss: one({ washes: 9 }) },
    streak_5: { fire: one({ bestStreak: 5 }), miss: one({ bestStreak: 4 }) },
    splashdown: { fire: one({ splashdowns: 1 }), miss: one({ splashdowns: 0 }) },
    flawless: { fire: one({ ...WIN, washed: 0, paintedM2: 600 }), miss: one({ ...WIN, washed: 0, paintedM2: 599 }) },
    storm_win: { fire: one({ skill: 'storm', ...WIN }), miss: one({ skill: 'storm', ...DRAW }) },
    matches_25: { fire: one({}, (c) => { c.matches = 24; }), miss: one({}, (c) => { c.matches = 23; }) },
    matches_100: { fire: one({}, (c) => { c.matches = 99; }), miss: one({}, (c) => { c.matches = 98; }) },
    online_first: { fire: one({ online: true, humans: 2 }), miss: one({ online: false, humans: 1 }) },
    online_win: { fire: one({ online: true, humans: 2, ...WIN }), miss: one({ online: true, humans: 2, ...DRAW }) },
    online_wins_10: {
      fire: one({ online: true, humans: 2, ...WIN }, (c) => { c.online.w = 9; c.online.m = 9; }),
      miss: one({ online: true, humans: 2, ...DRAW }, (c) => { c.online.w = 9; c.online.m = 9; }),
    },
  };
  const bad: string[] = [];
  for (const a of ACHIEVEMENTS) {
    const c = cases[a.slug];
    if (!c) { bad.push(`${a.slug}: no fixture`); continue; }
    if (!detect(c.fire[0], c.fire[1]).includes(a.slug)) bad.push(`${a.slug}: did not fire`);
    if (detect(c.miss[0], c.miss[1]).includes(a.slug)) bad.push(`${a.slug}: fired on the near miss`);
  }
  // extra near misses: storm_win never online; an ineligible record never unlocks anything
  if (detect(fx({ skill: 'storm', online: true, humans: 2, ...WIN }), emptyCounters()).includes('storm_win')) bad.push('storm_win fired online');
  if (detect(fx({ ...WIN, eligible: false, paintedM2: 5000, washes: 30 }), emptyCounters()).length) bad.push('an ineligible record unlocked something');
  check(`G-S1.3 fixtures: ${ACHIEVEMENTS.length} must-fire + ${ACHIEVEMENTS.length} near misses (draws for every win rule, 1499 m², 599 m², …)`, bad.length === 0, bad.join(' · ') || 'all exact');
  void DETECTORS;
}

// ── lifecycle (G-S1.4) + online seam (G-S1.8) on a fake view ──

class FakeView implements StatsWorldView {
  mode: 'teams' | 'ffa' = 'teams';
  rule: 'turf' | 'washout' = 'turf';
  def = { id: 'pier18' };
  phase: 'countdown' | 'live' | 'ended' = 'countdown';
  tick = 0;
  limit = 0;
  endedBy: 'horn' | 'limit' | null = null;
  result: MatchResult | null = null;
  countdownS = 3;
  durationS = 180;
  runners = Array.from({ length: 8 }, (_, i) => ({ id: i, team: i < 4 ? 1 : 2, kit: 'mist-rasp', bot: i !== 0, washes: 0, washedCount: 0, painted: 0 }));
}

function fakeResult(winner: number, o: { mode?: 'teams' | 'ffa'; rule?: 'turf' | 'washout'; share?: number; endedBy?: 'horn' | 'limit' } = {}): MatchResult {
  const shares = new Array<number>(9).fill(0);
  const share = o.share ?? 0.4;
  shares[1] = share; shares[2] = winner === 2 ? share + 0.05 : Math.max(0, share - 0.05); shares[0] = Math.max(0, 1 - shares[1] - shares[2]);
  const mode = o.mode ?? 'teams';
  return {
    sun: shares[1], gulf: shares[2], neutral: shares[0], winner, mode, shares,
    standings: [1, 2].map((k) => ({ crew: k, share: shares[k], rank: winner === 0 ? 1 : k === winner ? 1 : 2, pid: k === 1 ? 0 : 4, name: `C${k}`, washes: 0, washed: 0, score: 0 })),
    tied: winner === 0 ? [1, 2] : [], rule: o.rule ?? 'turf', scores: new Array<number>(9).fill(0), limit: 0, endedBy: o.endedBy ?? 'horn',
  };
}

interface Feed { begin(v: StatsWorldView, i: BeginInfo): void; events(ev: readonly SimEvent[], v: StatsWorldView): void }
interface FakeOpts {
  painted?: number; washes?: number; washed?: number; winner?: number; durationS?: number; skill?: BotSkill; kit?: string; map?: string;
  extra?: SimEvent[]; sendEnded?: boolean; mode?: 'teams' | 'ffa'; rule?: 'turf' | 'washout'; share?: number;
}

/** drive a recorder (or a core) through one offline fake match */
function fakeMatch(feed: Feed, o: FakeOpts = {}): FakeView {
  const v = new FakeView();
  if (o.mode) v.mode = o.mode;
  if (o.rule) v.rule = o.rule;
  if (o.map) v.def = { id: o.map };
  v.durationS = o.durationS ?? 180;
  const kit = o.kit ?? 'mist-rasp';
  v.runners[0].kit = kit;
  feed.begin(v, { kit, skill: o.skill ?? 'swell', online: null, localPid: 0 });
  v.tick = 180; v.phase = 'live';
  feed.events([{ t: 'phase', phase: 'live' }, { t: 'horn', kind: 'start' }], v);
  v.tick = 180 + Math.round(v.durationS / TICK);
  if (o.extra) feed.events(o.extra, v);
  v.runners[0].painted = o.painted ?? 800;
  v.runners[0].washes = o.washes ?? 2;
  v.runners[0].washedCount = o.washed ?? 1;
  v.result = fakeResult(o.winner ?? 1, { mode: v.mode, rule: v.rule, share: o.share });
  v.endedBy = 'horn';
  v.phase = 'ended';
  if (o.sendEnded !== false) feed.events([{ t: 'horn', kind: 'end' }, { t: 'phase', phase: 'ended' }], v);
  return v;
}

function sectionLifecycle(): void {
  console.log('\n── G-S1.4 lifecycle ──');
  const mk = (statsDev = false): { r: MatchRecorder; outs: Outcome[] } => {
    const outs: Outcome[] = [];
    return { r: new MatchRecorder({ statsDev, sink: (o) => outs.push(o), now: () => 1_700_000_000_000 }), outs };
  };
  const recOf = (outs: Outcome[]): MatchRecord | null => (outs[0]?.k === 'record' ? outs[0].rec : null);
  const bad: string[] = [];
  // begin → abandon
  {
    const { r, outs } = mk();
    const v = new FakeView();
    r.begin(v, { kit: 'mist-rasp', skill: 'swell', online: null, localPid: 0 });
    v.phase = 'live';
    r.events([{ t: 'phase', phase: 'live' }], v);
    r.abandon(v, 'dispose');
    const s = emptySlot(0);
    for (const o of outs) applyOutcome(s, o);
    if (!(outs.length === 1 && outs[0].k === 'abandoned' && s.c.abandoned === 1 && s.c.matches === 0 && s.c.idle === 0)) bad.push(`begin→abandon: ${JSON.stringify(outs.map((x) => x.k))}`);
  }
  // begin → begin: the first is abandoned, the second stays open
  {
    const { r, outs } = mk();
    r.begin(new FakeView(), { kit: 'mist-rasp', skill: 'swell', online: null, localPid: 0 });
    r.begin(new FakeView(), { kit: 'mist-rasp', skill: 'swell', online: null, localPid: 0 });
    if (!(outs.length === 1 && outs[0].k === 'abandoned' && r.openId !== null)) bad.push(`begin→begin: ${JSON.stringify(outs.map((x) => x.k))} open ${r.openId}`);
  }
  // idle (0 paint, 0 washes) → idle only, score 0
  {
    const { r, outs } = mk();
    fakeMatch(r, { painted: 0, washes: 0 });
    const rec = recOf(outs);
    const s = emptySlot(0);
    for (const o of outs) applyOutcome(s, o);
    if (!(rec && !rec.eligible && rec.score === 0 && s.c.idle === 1 && s.c.matches === 0 && !detect(rec, s.c).length)) bad.push(`idle: ${JSON.stringify(rec)}`);
  }
  // liveS < 60 → idle; statsdev waives the 60 s (keeps participation)
  {
    const a = mk(), b = mk(true), c = mk(true);
    fakeMatch(a.r, { durationS: 45, painted: 900 });
    fakeMatch(b.r, { durationS: 45, painted: 900 });
    fakeMatch(c.r, { durationS: 45, painted: 40, washes: 0 });
    const ra = recOf(a.outs), rb = recOf(b.outs), rc = recOf(c.outs);
    if (!(ra && !ra.eligible && ra.liveS === 45)) bad.push(`45 s match eligible without statsdev: ${JSON.stringify(ra)}`);
    if (!(rb && rb.eligible && rb.dev === true && rb.score > 0)) bad.push(`statsdev 45 s match not eligible: ${JSON.stringify(rb)}`);
    if (!(rc && !rc.eligible)) bad.push('statsdev waived participation');
  }
  // belt and braces: an ended view whose 'ended' event never came is finalized at the next events() call
  {
    const { r, outs } = mk();
    const v = fakeMatch(r, { sendEnded: false });
    if (outs.length) bad.push('finalized before seeing the end');
    r.events([], v);
    if (!(outs.length === 1 && outs[0].k === 'record')) bad.push(`ended view not finalized by events(): ${JSON.stringify(outs.map((x) => x.k))}`);
  }
  // a begin over an ended-but-unfinalized view finalizes it (never an abandon)
  {
    const { r, outs } = mk();
    fakeMatch(r, { sendEnded: false });
    r.begin(new FakeView(), { kit: 'mist-rasp', skill: 'swell', online: null, localPid: 0 });
    if (!(outs.length === 1 && outs[0].k === 'record')) bad.push(`begin over an ended view: ${JSON.stringify(outs.map((x) => x.k))}`);
  }
  check('G-S1.4 lifecycle: abandon / double begin / idle / < 60 s / statsdev / ended-without-event', bad.length === 0, bad.join(' · ') || 'all exact');
}

function sectionOnline(): void {
  console.log('\n── G-S1.8 online seam (fixtures) ──');
  const bad: string[] = [];
  const mk = (): { r: MatchRecorder; outs: Outcome[] } => {
    const outs: Outcome[] = [];
    return { r: new MatchRecorder({ statsDev: false, sink: (o) => outs.push(o), now: () => 1_700_000_000_000 }), outs };
  };
  const recOf = (outs: Outcome[]): MatchRecord | null => (outs[0]?.k === 'record' ? outs[0].rec : null);
  const onlineView = (): FakeView => {
    const v = new FakeView();
    for (const x of v.runners) { x.bot = true; x.washes = 77; x.washedCount = 66; x.painted = 9999; }   // lifetime counters: never read
    v.runners[3].kit = 'pop-well';
    return v;
  };
  const info = (matchId: string, skill: BotSkill = 'swell'): BeginInfo => ({ kit: 'pop-well', skill, localPid: 3, online: { matchId, localPid: 3, role: 'client', skill } });
  const fin = (o: { humans?: number; seatedS?: number; noSeat?: boolean } = {}): OnlineFinal => ({
    result: fakeResult(1), humans: o.humans ?? 3,
    me: o.noSeat ? null : { seatedLiveTicks: Math.round((o.seatedS ?? 170) / TICK), painted: 640.4, washes: 4, washedCount: 2 },
  });
  // (a) begin twice with one matchId → one record, nothing abandoned
  {
    const { r, outs } = mk();
    const v1 = onlineView(), v2 = onlineView();
    r.begin(v1, info('m1'));
    v1.phase = 'live';
    r.events([{ t: 'phase', phase: 'live' }, { t: 'washed', victim: 5, by: 3, cause: 'dye' }], v1);
    r.begin(v2, info('m1'));                                    // host migration: continuation
    r.events([{ t: 'washed', victim: 6, by: 3, cause: 'dye' }], v2);
    r.onlineEnd('complete', fin());
    const rec = recOf(outs);
    if (!(outs.length === 1 && rec && rec.bestStreak === 2)) bad.push(`(a) continuation: ${JSON.stringify(outs.map((x) => x.k))} streak ${rec?.bestStreak}`);
  }
  // (b) an online record is NOT finalized by 'phase' 'ended' — only by onlineEnd
  {
    const { r, outs } = mk();
    const v = onlineView();
    r.begin(v, info('m2'));
    v.phase = 'ended'; v.result = fakeResult(1); v.endedBy = 'horn';
    r.events([{ t: 'phase', phase: 'ended' }], v);
    const before = outs.length;
    r.onlineEnd('complete', fin());
    if (!(before === 0 && outs.length === 1 && outs[0].k === 'record')) bad.push(`(b) finalized by the ended event (${before} before onlineEnd)`);
  }
  // (c) late join: 50 s seated → idle; the runner's lifetime counters are never read
  {
    const { r, outs } = mk();
    r.begin(onlineView(), info('m3'));
    r.onlineEnd('complete', fin({ seatedS: 50 }));
    const rec = recOf(outs);
    if (!(rec && !rec.eligible && rec.liveS === 50 && rec.washes === 4 && rec.washed === 2 && rec.paintedM2 === 640)) bad.push(`(c) late join: ${JSON.stringify(rec)}`);
  }
  // (d) humans 2 → online although every runner is bot: true; humans 1 → offline-style bot match
  {
    const a = mk(), b = mk();
    a.r.begin(onlineView(), info('m4')); a.r.onlineEnd('complete', fin({ humans: 2 }));
    b.r.begin(onlineView(), info('m5', 'storm')); b.r.onlineEnd('complete', fin({ humans: 1 }));
    const ra = recOf(a.outs), rb = recOf(b.outs);
    if (!(ra && ra.online && ra.humans === 2 && ra.eligible)) bad.push(`(d) humans 2: ${JSON.stringify(ra)}`);
    if (!(rb && !rb.online && rb.humans === 1 && rb.skill === 'storm')) bad.push(`(d) humans 1: ${JSON.stringify(rb)}`);
    if (rb && detect(rb, emptyCounters()).some((s) => s.startsWith('online_'))) bad.push('(d) humans 1 unlocked an online achievement');
  }
  // (e) void → only online.void; dropped → abandoned; complete without a seat → abandoned
  {
    const a = mk(), b = mk(), c = mk();
    a.r.begin(onlineView(), info('m6')); a.r.onlineEnd('void');
    b.r.begin(onlineView(), info('m7')); b.r.onlineEnd('dropped');
    c.r.begin(onlineView(), info('m8')); c.r.onlineEnd('complete', fin({ noSeat: true }));
    const s = emptySlot(0);
    for (const o of [...a.outs, ...b.outs, ...c.outs]) applyOutcome(s, o);
    if (!(a.outs[0]?.k === 'void' && s.c.online.void === 1 && s.c.matches === 0 && s.c.online.m === 0)) bad.push(`(e) void: ${JSON.stringify(a.outs)}`);
    if (!(b.outs[0]?.k === 'abandoned' && c.outs[0]?.k === 'abandoned' && s.c.abandoned === 2)) bad.push(`(e) dropped / no seat: ${JSON.stringify([...b.outs, ...c.outs])}`);
  }
  check('G-S1.8 online seam: continuation · no finalize on ended · late join idle · humans ≥ 2 · void / dropped', bad.length === 0, bad.join(' · ') || 'all exact');
}

// ── score (G-S1.5) ──

function sectionScore(matches: GateMatch[]): void {
  console.log('\n── G-S1.5 score ──');
  check('baselines.ts is generated (not the placeholder)', BASELINE_META.generated, BASELINE_META.generated ? `${BASELINE_META.date} · TIER breeze ${TIER.breeze} / storm ${TIER.storm}` : 'PLACEHOLDER — run node _harness/probe_stats.ts --baselines --write');
  // bot base medians per (mode, rule): every runner of the 12 matches, its own kit cell
  const byMR: Record<string, number[]> = {};
  const byKit: Record<string, number[]> = {};
  for (const m of matches) {
    const w = m.out.world;
    for (const x of w.runners) {
      const inp = { map: m.map, mode: m.mode, rule: m.rule, kit: x.kit, skill: 'swell' as const, liveS: m.out.liveS, paintedM2: Math.round(x.painted), washes: x.washes };
      (byMR[`${m.mode}/${m.rule}`] ??= []).push(baseScore(inp));
      const rr = resultFor(w.result!, x.team, m.mode, m.rule);
      (byKit[x.kit] ??= []).push(scoreRecord({ ...inp, result: rr.result, place: rr.place, crews: rr.crews, eligible: true }));
    }
  }
  if (matches.length) {
    const parts: string[] = [];
    let ok = true;
    for (const k of Object.keys(byMR)) {
      const med = median(byMR[k]);
      if (!(med >= 900 && med <= 1100)) ok = false;
      parts.push(`${k} ${med.toFixed(0)} (n ${byMR[k].length})`);
    }
    check('bot base medians per (mode, rule) within 900–1100 (1000 = an average SWELL runner, by construction; the result bonus is on top)', ok, parts.join(' · '));
    info('per-kit median scores (base + result bonus, SWELL)', Object.keys(byKit).map((k) => `${k} ${median(byKit[k]).toFixed(0)}`).join(' · '));
  }
  const recs = matches.map((m) => m.rec).filter((r): r is MatchRecord => !!r);
  check('scores are integers ≥ 0 and ≤ the ceiling', recs.every((r) => Number.isInteger(r.score) && r.score >= 0 && r.score <= SCORE_CEILING),
    recs.map((r) => r.score).join(', ') || '(no matches: --quick)');
  check('0 for an ineligible record', scoreRecord(fx({ ...WIN, eligible: false, paintedM2: 3000, washes: 20 })) === 0, `${scoreRecord(fx({ ...WIN, eligible: false }))}`);
  const ladder = [1, 2, 3, 4, 5, 6, 7, 8].map((p) => resultBonus('ffa', 'loss', p, 8));
  check('FFA bonus 250 → 0 over places (ties share a rank)', ladder[0] === 250 && ladder[7] === 0 && ladder.every((v, i) => i === 0 || v < ladder[i - 1]),
    ladder.join(' · '));
  check('TEAMS bonus win 250 / draw 100 / loss 0', resultBonus('teams', 'win', 1, 2) === 250 && resultBonus('teams', 'draw', 1, 2) === 100 && resultBonus('teams', 'loss', 2, 2) === 0, 'ok');
  // per-tier caps: a BREEZE fixture with both perfs at 2.9 → (1500 + bonus) × TIER.breeze
  const cell = perfs({ map: 'pier18', mode: 'teams', rule: 'turf', kit: 'mist-rasp', skill: 'breeze', liveS: 60, paintedM2: 0, washes: 0 }).cell;
  const p29 = Math.ceil(2.9 * Math.max(cell.paint, 100)), w29 = Math.ceil(2.9 * Math.max(cell.wash, 1));
  const breezeRec = fx({ map: 'pier18', kit: 'mist-rasp', skill: 'breeze', liveS: 60, paintedM2: p29, washes: w29, ...WIN });
  const wantBreeze = Math.round((1500 + 250) * tierFactor('breeze'));
  check('per-tier cap: BREEZE with both perfs at 2.9 scores (1500 + bonus) × TIER.breeze', scoreRecord(breezeRec) === wantBreeze,
    `${scoreRecord(breezeRec)} vs ${wantBreeze} (TIER.breeze ${TIER.breeze}; ${p29} m² / ${w29} washes in 1 min)`);
  const stormMax = fx({ map: 'pier18', kit: 'mist-rasp', skill: 'storm', liveS: 60, paintedM2: 100000, washes: 1000, ...WIN });
  check('the ceiling: (3000 + 250) × TIER.storm ≤ 5200', scoreRecord(stormMax) === Math.round(3250 * tierFactor('storm')) && scoreRecord(stormMax) <= SCORE_CEILING,
    `${scoreRecord(stormMax)}`);
  const cb = tierCeiling('breeze'), cs = tierCeiling('swell'), ct = tierCeiling('storm');
  check('tier ceilings strictly increasing breeze < swell < storm', cb < cs && cs < ct, `${cb.toFixed(0)} < ${cs.toFixed(0)} < ${ct.toFixed(0)}`);
  // an online record uses TIER[online.skill]
  const outs: Outcome[] = [];
  const rec = new MatchRecorder({ statsDev: false, sink: (o) => outs.push(o), now: () => 1 });
  rec.begin(new FakeView(), { kit: 'mist-rasp', skill: 'breeze', localPid: 0, online: { matchId: 'x', localPid: 0, role: 'host', skill: 'breeze' } });
  rec.onlineEnd('complete', { result: fakeResult(1), humans: 2, me: { seatedLiveTicks: Math.round(170 / TICK), painted: 900, washes: 3, washedCount: 1 } });
  const orec = outs[0]?.k === 'record' ? outs[0].rec : null;
  const wantOnline = orec ? Math.round((baseScore(orec) + 250) * tierFactor('breeze')) : -1;
  check('an online record with skill breeze uses TIER.breeze', !!orec && orec.online && orec.score === wantOnline, `${orec?.score} vs ${wantOnline}`);
}

// ── the fake page: clock, storage, portal (G-S1.6 / G-S1.9) ──

interface Timer { id: number; at: number; fn: () => void }
class FakeClock {
  t = 1_800_000_000_000;
  private seq = 0;
  private q: Timer[] = [];
  setTimeout(fn: () => void, ms: number): number { const id = ++this.seq; this.q.push({ id, at: this.t + Math.max(0, ms), fn }); return id; }
  clearTimeout(h: unknown): void { this.q = this.q.filter((x) => x.id !== h); }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let best: Timer | null = null;
      for (const x of this.q) if (x.at <= end && (!best || x.at < best.at || (x.at === best.at && x.id < best.id))) best = x;
      if (!best) break;
      const b = best;
      this.q = this.q.filter((x) => x !== b);
      this.t = Math.max(this.t, b.at);
      b.fn();
    }
    this.t = end;
  }
}
class FakeKV implements KV {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}
interface Post { t: number; dev: string; msg: Record<string, unknown> }
interface Page { env: StatsEnv; kill(): void; hide(): void }
class FakePortal {
  record: unknown = null;
  answer = true;
  origin = 'https://forgeflowgames.com';
  replyMs = 50;
  holdSaves = false;
  held: Array<{ snap: unknown; data: unknown }> = [];
  posts: Post[] = [];
  readonly clock: FakeClock;
  constructor(clock: FakeClock) { this.clock = clock; }
  /** one page: its env (kill() = the page is gone: no more posts, no more timers) */
  page(kv: KV | null, name: string, seed: number): Page {
    let handler: ((d: unknown, o: string, p: boolean) => void) | null = null;
    let hide: (() => void) | null = null;
    let dead = false;
    const clock = this.clock;
    const env: StatsEnv = {
      now: () => clock.t,
      setTimeout: (fn, ms) => clock.setTimeout(() => { if (!dead) fn(); }, ms),
      clearTimeout: (h) => clock.clearTimeout(h),
      random: mulberry32(seed),
      kv,
      framed: true,
      post: (msg) => {
        if (dead) return;
        this.posts.push({ t: clock.t, dev: name, msg: clone(msg) });
        if (msg.type === 'forgeflow:load' && this.answer) {
          const reply = { type: 'forgeflow:save_loaded', data: this.record === null ? null : clone(this.record), _reqId: msg._reqId };
          const origin = this.origin;
          clock.setTimeout(() => { if (!dead) handler?.(reply, origin, true); }, this.replyMs);
        } else if (msg.type === 'forgeflow:save') {
          if (this.holdSaves) this.held.push({ snap: clone(this.record), data: clone(msg.data) });
          else this.record = mergePreservingKeys(this.record, clone(msg.data));
        }
      },
      onMessage: (fn) => { handler = fn; },
      onHide: (fn) => { hide = fn; },
    };
    return { env, kill: () => { dead = true; }, hide: () => hide?.() };
  }
  /** the held read-modify-writes land in order, each on the snapshot it read (the portal's lock-free race) */
  flushHeld(): void { for (const h of this.held) this.record = mergePreservingKeys(h.snap, h.data); this.held = []; }
  of(type: string, dev?: string): Post[] { return this.posts.filter((p) => p.msg.type === type && (!dev || p.dev === dev)); }
}

function newCore(page: Page, statsDev = false): StatsCore {
  const c = new StatsCore({ env: page.env, enabled: true, statsDev });
  c.start();
  return c;
}
const cloudMatches = (rec: unknown, key: string): number => {
  const s = (rec as CloudRecord | null)?.slots?.[key];
  return s ? normSlot(s).c.matches : -1;
};
const coreFeed = (core: StatsCore): Feed => ({ begin: (v, i) => core.matchBegin(v, i), events: (e, v) => core.events(e, v) });

function randomRecord(rnd: () => number, i: number): MatchRecord {
  const maps = MAP_IDS as readonly string[];
  const res = rnd() < 0.45 ? 'win' : rnd() < 0.8 ? 'loss' : 'draw';
  return fx({
    id: `r${i}-${Math.floor(rnd() * 1e9).toString(36)}`, at: 1_700_000_000_000 + Math.floor(rnd() * 1e9),
    mode: rnd() < 0.5 ? 'teams' : 'ffa', rule: rnd() < 0.5 ? 'turf' : 'washout', kit: KIT_IDS[Math.floor(rnd() * 4)], map: maps[Math.floor(rnd() * 3)],
    skill: (['breeze', 'swell', 'storm'] as const)[Math.floor(rnd() * 3)], online: rnd() < 0.2, result: res, place: 1 + Math.floor(rnd() * 8), crews: 8,
    turfPct: Math.round(rnd() * 600) / 10, washes: Math.floor(rnd() * 15), washed: Math.floor(rnd() * 12), paintedM2: Math.floor(rnd() * 2000),
    specials: Math.floor(rnd() * 5), subs: Math.floor(rnd() * 6), splashdowns: Math.floor(rnd() * 2), bestStreak: Math.floor(rnd() * 6),
    liveS: 60 + Math.floor(rnd() * 1200) / 10, endedBy: rnd() < 0.2 ? 'limit' : 'horn', score: Math.floor(rnd() * 3000), eligible: rnd() < 0.9,
  });
}
function randomSlot(rnd: () => number, base?: Slot): Slot {
  const s = base ? normSlot(base) : emptySlot(0);
  const n = 1 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const x = rnd();
    if (x < 0.1) applyOutcome(s, { k: 'abandoned', at: 1 });
    else if (x < 0.15) applyOutcome(s, { k: 'void', at: 1 });
    else applyOutcome(s, { k: 'record', rec: randomRecord(rnd, i) });
  }
  if (rnd() < 0.6) s.ach[ACHIEVEMENTS[Math.floor(rnd() * ACHIEVEMENTS.length)].slug] = 1_700_000_000_000 + Math.floor(rnd() * 1e6);
  return s;
}

function sectionMerge(): void {
  console.log('\n── G-S1.6 merge properties (500 randomised cases) + StatsCore on a fake page ──');
  const rnd = mulberry32(0x5eed);
  let orderBad = 0, twiceBad = 0, lowerBad = 0, floorBad = 0;
  for (let i = 0; i < 500; i++) {
    const a = randomSlot(rnd), b = randomSlot(rnd), c = randomSlot(rnd);
    const f1 = foldSlots([a, b, c]), f2 = foldSlots([c, a, b]);
    if (stable({ c: f1.c, b: f1.best, a: f1.ach, r: f1.recent.map((r) => r.id) }) !== stable({ c: f2.c, b: f2.best, a: f2.ach, r: f2.recent.map((r) => r.id) })) orderBad++;
    // a thin push of A's newer slot into a cloud record holding A's older slot and B's slot
    const aNew = randomSlot(rnd, a);
    const cloud = { v: 1, game: 'dyefield', tags: { T: 1 }, slots: { 'devA-T': clone(a), 'devB-T': clone(b) } };
    const push = thinPayload('T', 1, 'devA-T', aNew);
    const m1 = mergePreservingKeys(clone(cloud), clone(push)) as CloudRecord;
    const m2 = mergePreservingKeys(clone(m1), clone(push)) as CloudRecord;
    if (stable(m1) !== stable(m2)) twiceBad++;
    const d1 = foldSlots(Object.values(m1.slots).map(normSlot)), d2 = foldSlots(Object.values(m2.slots).map(normSlot));
    if (stable(d1.c) !== stable(d2.c)) twiceBad++;
    if (stable(m1.slots['devB-T']) !== stable(cloud.slots['devB-T'])) lowerBad++;
    if (stable(normSlot(m1.slots['devA-T']).c) !== stable(normSlot(aNew).c)) lowerBad++;
    // my slot vs. its older cloud copy: the floor never lowers
    const mine = normSlot(aNew);
    maxMergeSlot(mine, normSlot(a));
    if (stable(mine.c) !== stable(normSlot(aNew).c) || stable(mine.best) !== stable(normSlot(aNew).best)) floorBad++;
    // guest-claim arithmetic: addSlot adds counters once
    const g = randomSlot(rnd), acc = normSlot(a);
    addSlot(acc, g);
    if (acc.c.matches !== a.c.matches + g.c.matches || acc.c.washes !== a.c.washes + g.c.washes) floorBad++;
  }
  check('fold is order-independent (500 cases)', orderBad === 0, `${orderBad} differ`);
  check('a thin push merged twice = once (the cloud record and the display)', twiceBad === 0, `${twiceBad} differ`);
  check('a thin push never touches / lowers another device’s slot, and lands mine exactly', lowerBad === 0, `${lowerBad} differ`);
  check('the cloud copy of my slot as a floor never lowers my newer bucket; a claim adds exactly once', floorBad === 0, `${floorBad} differ`);

  const clock = new FakeClock();
  // guest claim adds exactly once (S-c in node): signed-out boot → guest, 2 matches, then the portal answers
  {
    const portal = new FakePortal(clock);
    portal.answer = false;
    const kv = new FakeKV();
    const pg = portal.page(kv, 'A', 11);
    const core = newCore(pg);
    clock.advance(70_000);
    const st0 = core.portal;
    fakeMatch(coreFeed(core), { winner: 1 }); fakeMatch(coreFeed(core), { winner: 2 });
    const guestM = core.store.guest.c.matches;
    const postsBefore = portal.posts.filter((p) => p.msg.type !== 'forgeflow:load').length;
    const outboxBefore = core.store.outbox.length;
    portal.answer = true;
    core.careerOpened();                                        // the re-probe
    clock.advance(60_000);
    const acctM = core.account?.c.matches ?? -1;
    const achPosts = portal.of('forgeflow:achievement').map((p) => String(p.msg.achievementSlug));
    pg.kill();
    const pg2 = portal.page(kv, 'A', 12);
    const core2 = newCore(pg2);
    clock.advance(10_000);
    const disp2 = core2.display().c.matches;
    const ok = st0 === 'guest' && guestM === 2 && postsBefore === 0 && outboxBefore > 0 && acctM === 2 && core.store.guest.c.matches === 0
      && disp2 === 2 && new Set(achPosts).size === achPosts.length && portal.of('forgeflow:score').length >= 1 && core2.store.guest.c.matches === 0;
    check('guest claim: signed-out play lands in guest, nothing posted, outbox kept; sign-in claims it ONCE, drains the outbox',
      ok, `state ${st0} · guest ${guestM} · posts before ${postsBefore} · outbox ${outboxBefore} → acct ${acctM} · after reload ${disp2} · ach posts ${achPosts.length} (unique ${new Set(achPosts).size}) · scores ${portal.of('forgeflow:score').length}`);
    pg2.kill();
  }
  // an unreadable record → never a save
  {
    const portal = new FakePortal(clock);
    portal.record = { v: 2, slots: 'x' };
    const pg = portal.page(new FakeKV(), 'U', 21);
    const core = newCore(pg);
    clock.advance(1000);
    fakeMatch(coreFeed(core), { winner: 1 });
    clock.advance(30_000);
    pg.hide();
    check('an unreadable cloud record → no forgeflow:save all session (read-only)', portal.of('forgeflow:save').length === 0 && !core.readOk && core.link.unreadable,
      `saves ${portal.of('forgeflow:save').length} · readOk ${core.readOk} · unreadable ${core.link.unreadable} · bucket ${core.bucketKind()}`);
    pg.kill();
  }
  // (c) signed-in without readOk → pending, applied once at the first readOk
  {
    const portal = new FakePortal(clock);
    const kv = new FakeKV();
    const pg = portal.page(kv, 'P', 31);
    const core = newCore(pg);
    clock.advance(100);                                           // the first null arrives
    portal.answer = false;                                         // the confirming probe gets no answer
    clock.advance(12_000);
    const s0 = { portal: core.portal, readOk: core.readOk, bucket: core.bucketKind() };
    fakeMatch(coreFeed(core), { winner: 1 });
    const pend = core.store.pending.length;
    const scoreLive = portal.of('forgeflow:score').length;
    portal.answer = true;
    core.careerOpened();
    clock.advance(20_000);
    const acct = core.account?.c.matches ?? -1;
    pg.kill();
    const pg2 = portal.page(kv, 'P', 32);
    const core2 = newCore(pg2);
    clock.advance(5000);
    const ok = s0.portal === 'signed-in' && !s0.readOk && s0.bucket === 'pending' && pend === 1 && scoreLive === 1 && acct === 1
      && core.store.pending.length === 0 && core2.display().c.matches === 1;
    check('(c) signed-in without readOk → pending; the score still posts; applied ONCE at the first readOk (and after a reload)', ok,
      `${JSON.stringify(s0)} · pending ${pend} · score posts ${scoreLive} · acct ${acct} · after reload ${core2.display().c.matches}`);
    pg2.kill();
  }
  // (a) interleaved saves: both devices read, then both write — the earlier writer's newest slot is lost, then repaired
  {
    const portal = new FakePortal(clock);
    const kvA = new FakeKV(), kvB = new FakeKV();
    let pA = portal.page(kvA, 'A', 41);
    const pB = portal.page(kvB, 'B', 42);
    let A = newCore(pA);
    clock.advance(5000);                                          // empty account confirmed: A makes the tag
    fakeMatch(coreFeed(A), { winner: 1 }); clock.advance(10_000);
    const B = newCore(pB);
    clock.advance(1000);
    fakeMatch(coreFeed(B), { winner: 2 }); clock.advance(10_000);
    const keyA = A.slotKey!, keyB = B.slotKey!;
    const sameTag = A.tag === B.tag;
    portal.holdSaves = true;
    fakeMatch(coreFeed(A), { winner: 1 }); fakeMatch(coreFeed(B), { winner: 1 });
    clock.advance(10_000);
    const held = portal.held.length;
    portal.flushHeld();
    portal.holdSaves = false;
    const lost = cloudMatches(portal.record, keyA), bNow = cloudMatches(portal.record, keyB);
    const localA = A.account?.c.matches ?? -1;
    const bSlot = stable((portal.record as CloudRecord).slots[keyB]);
    pA.kill();
    pA = portal.page(kvA, 'A', 43);
    A = newCore(pA);                                              // A's next session: readOk + the repair push
    clock.advance(10_000);
    const repaired = cloudMatches(portal.record, keyA);
    const bSame = stable((portal.record as CloudRecord).slots[keyB]) === bSlot;
    const ok = sameTag && held === 2 && lost === 1 && localA === 2 && bNow === 2 && repaired === 2 && bSame && A.display().c.matches === 4;
    check('(a) interleaved saves: A’s newest slot is lost by the race, and A’s next readOk + repair push restores it exactly', ok,
      `same tag ${sameTag} · held ${held} · cloud A ${lost} (local ${localA}) · cloud B ${bNow} → after A's readOk: cloud A ${repaired}, B untouched ${bSame}, display ${A.display().c.matches}`);
    pA.kill(); pB.kill();
  }
  // (b) storage-less sessions: 3 sequential sessions sum in the one nostore-<tag> slot and add no other slot
  {
    const portal = new FakePortal(clock);
    for (let i = 0; i < 3; i++) {
      const pg = portal.page(null, `N${i}`, 51 + i);
      const core = newCore(pg);
      clock.advance(5000);
      fakeMatch(coreFeed(core), { winner: 1 });
      clock.advance(10_000);
      pg.kill();
    }
    const slots = Object.keys((portal.record as CloudRecord | null)?.slots ?? {});
    const ok = slots.length === 1 && slots[0].startsWith('nostore-') && cloudMatches(portal.record, slots[0]) === 3;
    check('(b) storage-less: 3 sequential sessions → one nostore-<tag> slot holding all 3 matches', ok, `slots [${slots.join(', ')}] · matches ${slots[0] ? cloudMatches(portal.record, slots[0]) : '—'}`);
  }
}

function sectionQueue(): void {
  console.log('\n── G-S1.9 the paced achievement queue (fake clock) ──');
  const clock = new FakeClock();
  const portal = new FakePortal(clock);
  const kv = new FakeKV();
  // a browser that already knows this account (tag T, self-heal due) and holds a non-empty guest slot (3 achievements)
  const T = 'acct000001';
  const dev = 'device000001';
  const acct = { ...emptySlot(0), since: clock.t - 1e9, achSyncAt: 0 };
  acct.ach = { ffa_podium: clock.t - 5e8, map_cinder: clock.t - 5e8 };
  acct.c.matches = 3;
  const guest = emptySlot(0);
  guest.c.matches = 1;
  guest.ach = { first_match: clock.t - 1e8, first_win: clock.t - 1e8, teams_turf_win: clock.t - 1e8 };
  kv.setItem('dyefield.career.v1', JSON.stringify({ v: 1, dev, guest, accts: { [T]: acct }, pending: [], pendingX: { abandoned: 0, void: 0 }, outbox: [], lastTag: T }));
  portal.record = thinPayload(T, acct.since, `${dev}-${T}`, acct);
  const pg = portal.page(kv, 'Q', 61);
  const core = newCore(pg);
  clock.advance(200);
  const tMatch = clock.t;
  // one finalize that unlocks ≥ 8: a STORM TEAMS·TURF win on pier18, 1,500 m², 10 washes, never washed, 5+ in a row, a sea wash
  const extra: SimEvent[] = [];
  for (const v of [4, 5, 6, 7, 4]) extra.push({ t: 'washed', victim: v, by: 0, cause: 'dye' });
  extra.push({ t: 'washed', victim: 5, by: 0, cause: 'sea' });
  fakeMatch(coreFeed(core), { winner: 1, painted: 1500, washes: 10, washed: 0, skill: 'storm', map: 'pier18', kit: 'mist-rasp', share: 0.52, extra });
  const rec = core.lastRecord;
  const fresh = rec ? detect(rec, emptyCounters()).filter((s) => !['first_match', 'first_win', 'teams_turf_win'].includes(s)).length : 0;
  // run until part of the queue is out, then "reload" the page
  clock.advance(12_000);
  const s1 = portal.of('forgeflow:achievement', 'Q');
  const outboxLeft = core.store.outbox.filter((it) => it.k === 'ach').length;
  pg.kill();
  const pg2 = portal.page(kv, 'Q2', 62);
  const core2 = newCore(pg2);
  clock.advance(90_000);
  const s2 = portal.of('forgeflow:achievement', 'Q2');
  const slugs = [...s1, ...s2].map((p) => String(p.msg.achievementSlug));
  const gaps = (xs: Post[]): number[] => xs.slice(1).map((p, i) => p.t - xs[i].t);
  const allGaps = [...gaps(s1), ...gaps(s2)];
  const minGap = allGaps.length ? Math.min(...allGaps) : Infinity;
  const expect = new Set(Object.keys(core2.display().ach));
  const missing = [...expect].filter((s) => !slugs.includes(s));
  const score = portal.of('forgeflow:score', 'Q');
  const save = portal.of('forgeflow:save', 'Q');
  const scoreAt = score.length ? score[0].t - tMatch : NaN;
  const saveAt = save.length ? save[0].t - tMatch : NaN;
  const ok = !!rec && fresh >= 8 && minGap >= ACH_GAP_MS && new Set(slugs).size === slugs.length && missing.length === 0 && outboxLeft > 0
    && s2.length > 0 && score.length === 1 && scoreAt === 0 && saveAt <= 4000 && core2.store.outbox.length === 0;
  check('G-S1.9 paced queue: ≥ 8 unlocks + a 3-slug guest claim + a due self-heal → one post per slug, ≥ 3,000 ms apart, the rest survives a reload; score + save not delayed',
    ok, `new unlocks at the finalize ${fresh} · session 1 posted ${s1.length} (left ${outboxLeft}) · after reload ${s2.length} · min gap ${minGap} ms · unique ${new Set(slugs).size}/${slugs.length} · missing [${missing.join(',')}] · score at +${scoreAt} ms · first save at +${saveAt} ms · gap across the reload ${s2.length && s1.length ? s2[0].t - s1[s1.length - 1].t : '—'} ms (info)`);
  pg2.kill();
}

async function gates(): Promise<number> {
  const t0 = performance.now();
  console.log(`G-S1 probe_stats · baselines ${BASELINE_META.generated ? BASELINE_META.date : 'PLACEHOLDER'} · TIER breeze ${TIER.breeze} / storm ${TIER.storm}${QUICK ? ' · --quick (no bot matches: NOT the gate)' : ''}`);
  const matches = QUICK ? [] : await sectionMatches();
  sectionFixtures();
  sectionLifecycle();
  sectionScore(matches);
  sectionMerge();
  sectionOnline();
  sectionQueue();
  const wall = (performance.now() - t0) / 1000;
  const failed = checks.filter((c) => !c.pass);
  info('wall', `${wall.toFixed(0)} s (target < 240 s; ${QUICK ? 'quick' : '16 bot matches'})`);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'}: G-S1 — ${checks.filter((c) => c.pass && !c.info).length} passed, ${failed.length} failed${QUICK ? ' (--quick: not the gate)' : ''}`);
  for (const f of failed) console.log(`  FAIL ${f.name} — ${f.detail}`);
  return failed.length ? 1 : 0;
}

// ───────────────────────────── main ─────────────────────────────

async function main(): Promise<number> {
  try {
    if (WORKER) return await baselineWorker(arg('--map', 'pier18'), arg('--out', join(tmpdir(), 'df-baselines.json')));
    if (BASELINES) return await baselinesMain();
    return await gates();
  } catch (e) {
    console.log('SETUP FAILED:', (e as Error).stack ?? e);
    return 2;
  }
}

main().then((c) => process.exit(c));
