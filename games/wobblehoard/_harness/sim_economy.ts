// WOBBLEHOARD economy Monte-Carlo (v4: runs the REAL game logic).
//   50-species catalog, 6 rarity tiers, an explicit ACTIVE-PLAY model (touch-by-touch micro-sim -> minutes per capsule),
//   MERGE = MERGE_COST of the same species -> 1 random squishy, trading between players with different play styles.
// Plain node (type stripping):   node _harness/sim_economy.ts [--quick] [--n 5000] [--long 450]
//
// SINGLE SOURCE OF TRUTH. The game rules are IMPORTED, not copied:
//   * the roster (tiers, order, counts) is src/data/catalog.ts; the public odds and tier counts are src/core/rarity.ts;
//   * every touch of the micro-sim goes through src/core/meter.ts addInteraction (pay, freshness, medley, valve, daily cap; a tap pays nothing,
//     owner decision 2026-10-06 "short taps pay nothing"); the macro model reads the capsule ramp and the daily-cap numbers from the same module;
//   * capsule rolls and the Daily Restock are src/core/drops.ts rollCapsule / restockOffer, task limits from the same file;
//   * every merge is src/core/merge.ts mergeOddsCore + mergeDrawCore (the very functions previewMerge / rollMerge call), MERGE_COST included.
// What stays local is only what is NOT game logic: player behaviour, trading and the toy exploit ring. Hypothetical catalogs (section Q) and the
// merge-rule ablation ladder (section F) feed the same core with other rosters / rules.
//
// Everything about player BEHAVIOUR (how fast people touch, how long they play, churn, friends, willingness to trade, when
// they merge) is a guess. The ECONOMY rules (meter, odds, merge rule, caps, lock) are the proposals under test.
// Deterministic: same args => same output. No Math.random(), no Date.now(). Importable without side effects (main runs only when executed directly).
import { mulberry32 } from '../src/core/rng.ts';
import { CATALOG } from '../src/data/catalog.ts';
import { TIER_ODDS, TIER_SPECIES_COUNTS, TIER_NAMES as TIER_DISPLAY, TIERS, tierIndex } from '../src/core/rarity.ts';
import {
  addInteraction, createMeter, PAY as METER_PAY, FRESHNESS_TAU_SECONDS, FRESHNESS_FLOORS, VALVE_SP_PER_MINUTE, CAPSULE_RAMP, CAPSULE_COST,
  DAILY_FULL_RATE_CAPSULES, DAILY_REDUCED_RATE, DAILY_HARD_STOP_CAPSULES, MEDLEY_WINDOW_MS, MEDLEY_COOLDOWN_MS,
} from '../src/core/meter.ts';
import type { TouchKind } from '../src/core/meter.ts';
import { rollCapsule, restockOffer, TASKS_OFFERED_PER_DAY, TASKS_MAX_PER_WEEK, RESTOCK_MAX_TIER_INDEX, RESTOCK_OFFER_COUNT } from '../src/core/drops.ts';
import { MERGE_COST, MERGE_RULES, mergeOddsCore, mergeDrawCore, pityAfterCore } from '../src/core/merge.ts';
import type { MergeRules } from '../src/core/merge.ts';

/** The one merge constant lives in src/core/merge.ts (re-exported here for the old import path). */
export { MERGE_COST };

/* ───────────────────────────── catalog ───────────────────────────── */

const NT = TIERS.length;
const TIER_NAMES: string[] = TIERS.map((t) => TIER_DISPLAY[t]);
const PLAYER_TYPES = ['casual', 'regular', 'devoted'];
const ARCHE_NAMES = ['poker', 'squeezer', 'puller', 'mixed'];
const MAX_AFFINITY_TIER = 3; // tiers 0..3 can be tilted by playstyle; Legendary and Mythic ignore your hands

/**
 * `real` = built from src/data/catalog.ts (handles are catalog positions = idx). Otherwise a hypothetical roster for what-if sweeps.
 * Species sets (a player's needs and spares, the species of a tier) are BITSETS of `words` 32-bit words: species s is bit (s & 31) of
 * word (s >>> 5), so any roster size works (the catalog may grow to idx 255, DESIGN 5.2). See bitsetOf / bitsetHas / bitsetAndCount.
 */
export interface Catalog { n: number; words: number; tierOf: Uint8Array; groupOf: Uint8Array; byTier: number[][]; tierMask: Int32Array[]; real: boolean; }
/** Words needed for a bitset over n species. */
export const bitsetWords = (n: number): number => Math.max(1, (n + 31) >>> 5);
export const bitsetSet = (set: Int32Array, s: number): void => { set[s >>> 5] |= 1 << (s & 31); };
export const bitsetHas = (set: Int32Array, s: number): boolean => (set[s >>> 5] & (1 << (s & 31))) !== 0;
/** popcount(a & b & c) over all words (c omitted = all ones). */
export function bitsetAndCount(a: Int32Array, b: Int32Array, c?: Int32Array): number {
  let n = 0;
  for (let w = 0; w < a.length; w++) n += pop32(a[w] & b[w] & (c ? c[w] : -1));
  return n;
}
export function buildCatalog(counts: number[]): Catalog {
  const n = counts.reduce((a, b) => a + b, 0);
  const words = bitsetWords(n);
  const cat: Catalog = { n, words, tierOf: new Uint8Array(n), groupOf: new Uint8Array(n), byTier: [], tierMask: Array.from({ length: NT }, () => new Int32Array(words)), real: false };
  let idx = 0;
  for (let t = 0; t < NT; t++) {
    const list: number[] = [];
    for (let i = 0; i < counts[t]; i++, idx++) {
      cat.tierOf[idx] = t; cat.groupOf[idx] = t <= MAX_AFFINITY_TIER ? i % 3 : 3; list.push(idx);
      bitsetSet(cat.tierMask[t], idx);
    }
    cat.byTier.push(list);
  }
  return cat;
}
/** The real roster: handle = catalog position (= idx), tier lists in idx order. The affinity group (only used by the beta experiment) is the position inside the tier mod 3. */
function realCatalog(): Catalog {
  const cat = buildCatalog(TIER_SPECIES_COUNTS.slice());
  // rebuild the tier tables from the real catalog (idx order may interleave tiers in the future; today it is tier-sorted)
  cat.byTier = TIERS.map(() => [] as number[]);
  for (const m of cat.tierMask) m.fill(0);
  CATALOG.forEach((d, h) => {
    const t = tierIndex(d.tier);
    cat.tierOf[h] = t; cat.groupOf[h] = t <= MAX_AFFINITY_TIER ? cat.byTier[t].length % 3 : 3; cat.byTier[t].push(h);
    bitsetSet(cat.tierMask[t], h);
  });
  cat.real = true;
  return cat;
}
const REAL = realCatalog();
const REAL_POS = new Map<string, number>(CATALOG.map((d, h) => [d.id, h]));
const rollCapsule_real = rollCapsule;

/* ───────────────────────────── helpers ───────────────────────────── */

type Rng = () => number;
const gauss = (r: Rng): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const pickIdx = (w: ArrayLike<number>, tot: number, r: Rng): number => { let x = r() * tot; for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; } return w.length - 1; };
const sortedCopy = (a: number[]): number[] => [...a].sort((x, y) => x - y);
const median = (a: number[]): number => { if (!a.length) return NaN; const s = sortedCopy(a); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a: number[], q: number): number => { if (!a.length) return NaN; const s = sortedCopy(a); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sum = (a: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-');
const pc = (x: number): string => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '-');
const pc0 = (x: number): string => (Number.isFinite(x) ? Math.round(x * 100) + '%' : '-');
const pad = (s: string | number, n: number): string => String(s).padStart(n);
const lpad = (s: string | number, n: number): string => String(s).padEnd(n);
const pop32 = (v: number): number => { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24; };

/* ───────────────────────────── ACTIVE-PLAY MICRO-SIM: touches -> squish points ───────────────────────────── */
// Every simulated touch is fed to the REAL meter (src/core/meter.ts addInteraction). The rules it applies (DESIGN 5.4): pay per squeeze / pull (a
// poke, a TAP, pays 0 since the owner decision of 2026-10-06), soft pop, MEDLEY bonus (a squeeze and a pull within 12 s), FRESHNESS (anti-mash),
// the per-minute VALVE and the daily cap. Nothing is copied here.
const KIND_NAMES: readonly TouchKind[] = ['poke', 'squeeze', 'pull'];
const TAU = FRESHNESS_TAU_SECONDS;
const VALVE_PER_MIN = VALVE_SP_PER_MINUTE;
const PAY = { poke: METER_PAY.poke, squeezeBase: METER_PAY.squeezeBase, squeezePerSec: METER_PAY.squeezePerSecond, squeezeHoldCap: METER_PAY.squeezeHoldCapSeconds, softPop: METER_PAY.softPop, pullBase: METER_PAY.pullBase, pullPerSec: METER_PAY.pullPerSecond, pullHoldCap: METER_PAY.pullHoldCapSeconds, pullFail: METER_PAY.pullFail, medley: METER_PAY.medley, medleyCooldown: MEDLEY_COOLDOWN_MS / 1000, medleyWindow: MEDLEY_WINDOW_MS / 1000 };

/**
 * A touch style. The four BEHAV archetypes are the macro population (their SP/min drives every later section). Optional fields describe
 * the owner's 2026-10-06 styles (FUN.md 2), measured in section A only (they are not in the population mix):
 *   pokeGap  [lo, hi] s between pokes (default 0.7 to 1.5 s); pauseP the chance of a 1-4 s look-around after a touch (default 0.3);
 *   pullHold [lo, hi] s a pull is held, grab to release (default 0.8 to 2.4 s).
 * BEHAVIOUR vs PAY: since the owner decision of 2026-10-06 ("short taps pay nothing") a poke pays 0, so a 'poker' or a 'tapper' (a style that
 * is mostly taps) earns only through its few holds and stretches. The archetypes still describe how people TOUCH; they were not redefined, so the
 * table shows the plain consequence of the rule (section A prints it). Nobody here adapts their play to the rule: if real tappers start
 * holding, the population pace moves toward the paying archetypes' pace.
 */
export interface Behaviour { name: string; kindP: number[]; stick: number; pokeGap?: [number, number]; pauseP?: number; pullHold?: [number, number]; }
export const BEHAV: Behaviour[] = [
  { name: 'poker', kindP: [0.74, 0.16, 0.10], stick: 0.50 },
  { name: 'squeezer', kindP: [0.14, 0.72, 0.14], stick: 0.50 },
  { name: 'puller', kindP: [0.14, 0.16, 0.70], stick: 0.45 },
  { name: 'mixed', kindP: [0.40, 0.30, 0.30], stick: 0.0 },
];
/** Section A extra styles (not in the population): a fast tapper (bursts of 2 to 3 taps a second) and a stretch-and-hold player. */
export const BEHAV_EXTRA: Behaviour[] = [
  { name: 'tapper', kindP: [0.90, 0.05, 0.05], stick: 0.90, pokeGap: [1 / 3, 0.5], pauseP: 0.08 },
  { name: 'holder', kindP: [0.14, 0.16, 0.70], stick: 0.45, pullHold: [2.0, 4.0] },
];

export interface Stream { sp: number; byKind: number[]; n: number[]; seconds: number; }
export type Bot = '' | 'mash' | 'cycle' | 'tap4' | 'holdbot' | 'sqmash' | 'sqbot' | 'pullmash';
/**
 * Plays `seconds` of touching (or until `stopAtSp` SP). Pays through the real meter. Bots: 'mash' = 8 taps/s; 'tap4' = a tap every 250 ms
 * (the old fastest paid rate; taps pay 0 now); 'cycle' = tap, squeeze, pull at the physical limit; 'holdbot' = a full stretch held 3 s,
 * let go, grabbed again 0.3 s later; 'sqmash' = a squeeze held 0.45 s every 0.5 s (machine-speed squeezing); 'sqbot' = the squeeze that
 * best beats the freshness curve, held 1.8 s (the soft pop) every 2.4 s (one tau); 'pullmash' = a stretch held 0.3 s every 0.5 s (machine-speed
 * pulling). A pull's hold (grab to release) is the snap's heldFor: the human pull of the 0.8-2.4 s hold takes 1.0 s more to reach for and grab.
 */
export function playStream(beh: Behaviour, rng: Rng, seconds: number, bot: Bot, stopAtSp = Infinity, pace = 1): Stream {
  const out: Stream = { sp: 0, byKind: [0, 0, 0], n: [0, 0, 0], seconds: 0 };
  let meter = createMeter();
  let t = 0, last = -1, cyc = 0;
  const pg = beh.pokeGap ?? [0.7, 1.5], ph = beh.pullHold ?? [0.8, 2.4], pauseP = beh.pauseP ?? 0.3;
  while (t < seconds && out.sp < stopAtSp) {
    let kind: number, dur: number, hold = 0, success = true;
    if (bot === 'mash') { kind = 0; dur = 0.125; }
    else if (bot === 'tap4') { kind = 0; dur = 0.25; }
    else if (bot === 'sqmash') { kind = 1; hold = 0.45; dur = 0.5; }
    else if (bot === 'sqbot') { kind = 1; hold = 1.8; dur = 2.4; }
    else if (bot === 'pullmash') { kind = 2; hold = 0.3; dur = 0.5; }
    else if (bot === 'holdbot') { kind = 2; hold = 3; dur = 3.3; }
    else if (bot === 'cycle') { kind = cyc++ % 3; dur = kind === 0 ? 0.25 : kind === 1 ? 0.7 : 1.3; hold = kind === 1 ? 0.45 : kind === 2 ? 1.0 : 0; }
    else {
      kind = last >= 0 && rng() < beh.stick ? last : pickIdx(beh.kindP, 1, rng);
      if (kind === 0) dur = pg[0] + (pg[1] - pg[0]) * rng();
      else if (kind === 1) { hold = 0.5 + 2.1 * rng(); dur = hold + 0.9; }
      else { hold = ph[0] + (ph[1] - ph[0]) * rng(); dur = hold + 1.0; success = rng() < 0.85; }
      if (rng() < pauseP) dur += 1 + 3 * rng(); // looking around, orbiting the camera
      dur /= pace;
    }
    t += dur; last = kind;
    const r = addInteraction(meter, { kind: KIND_NAMES[kind], amount: kind === 0 ? 0 : kind === 1 ? hold : success ? 0.8 : 0.1, heldS: kind === 2 ? hold : undefined, tMs: Math.round(t * 1000), dayKey: 0 });
    meter = r.state;
    out.sp += r.spGained; out.byKind[kind] += r.spGained; out.n[kind]++;
  }
  out.seconds = t;
  return out;
}

export interface MicroRow { spPerMin: number; share: number[]; perMin: number[]; spreadP: number[]; }
/** 400 five-minute streams of one style through the real meter (seeded by `seedIdx`, as the population archetypes always were). */
export function measureStyle(b: Behaviour, seedIdx: number): MicroRow {
  const rng = mulberry32(0x1234 + seedIdx * 77);
  const per: number[] = [];
  const tot = { sp: 0, byKind: [0, 0, 0], n: [0, 0, 0], seconds: 0 };
  for (let k = 0; k < 400; k++) { const s = playStream(b, rng, 300, '', Infinity); per.push(s.sp / (s.seconds / 60)); tot.sp += s.sp; tot.seconds += s.seconds; for (let q = 0; q < 3; q++) { tot.byKind[q] += s.byKind[q]; tot.n[q] += s.n[q]; } }
  return { spPerMin: tot.sp / (tot.seconds / 60), share: tot.byKind.map((x) => x / tot.sp), perMin: tot.n.map((x) => x / (tot.seconds / 60)), spreadP: [quantile(per, 0.1), quantile(per, 0.5), quantile(per, 0.9)] };
}
export interface Micro { spPerMin: number[]; share: number[][]; perMin: number[][]; botMash: number; botCycle: number; botTap4: number; botHold: number; botSqMash: number; botSq: number; botPullMash: number; firstSec: number[]; spreadP: number[][]; extra: MicroRow[]; }
export function runMicro(): Micro {
  const m: Micro = { spPerMin: [], share: [], perMin: [], botMash: 0, botCycle: 0, botTap4: 0, botHold: 0, botSqMash: 0, botSq: 0, botPullMash: 0, firstSec: [], spreadP: [], extra: [] };
  BEHAV.forEach((b, i) => {
    const r = measureStyle(b, i);
    m.spPerMin.push(r.spPerMin); m.share.push(r.share); m.perMin.push(r.perMin); m.spreadP.push(r.spreadP);
  });
  const rb = mulberry32(99);
  m.botMash = playStream(BEHAV[0], rb, 600, 'mash').sp / 10;
  m.botCycle = playStream(BEHAV[0], rb, 600, 'cycle').sp / 10;
  m.botTap4 = playStream(BEHAV[0], rb, 600, 'tap4').sp / 10;
  m.botHold = playStream(BEHAV[0], rb, 600, 'holdbot').sp / 10;
  m.botSqMash = playStream(BEHAV[0], rb, 600, 'sqmash').sp / 10;
  m.botSq = playStream(BEHAV[0], rb, 600, 'sqbot').sp / 10;
  m.botPullMash = playStream(BEHAV[0], rb, 600, 'pullmash').sp / 10;
  m.extra = BEHAV_EXTRA.map((b, i) => measureStyle(b, BEHAV.length + i));
  return m;
}

/* ───────────────────────────── parameters ───────────────────────────── */

interface Params {
  nPlayers: number; days: number; seed: number;
  tierCount: number[]; tierOdds: number[];
  // Squish meter (macro)
  spPerMin: number[]; spShare: number[][]; speedScale: number; capsuleCost: number; onboardRamp: number[]; dailyCapsCap: number; overRate: number; hardExtraCaps: number;
  // affinity (tilts WHICH species inside a tier; never the tier odds)
  beta: number; lambda: number; balance: boolean;
  // restock + tasks
  restock: boolean; restockOffered: number; restockMaxTier: number; tasksOffered: number; taskWeeklyMax: number;
  // merge
  merge: boolean; mergeInputs: number; pUp: number[]; unownedW: number; pityUp: number; rowDoneBoost: number; rowDoneCap: number; mergeLockDays: number; keepOneShare: number; playfulShare: number; bulkMerge: boolean; maxMergesPerDay: number; bulkMax: number;
  // trade
  trade: boolean; tryProb: number; favorProb: number; lockDays: number; dailyTradeCap: number; maxSwapsPerTrade: number; boardSample: number; acceptProb: number;
  // population (BEHAVIOUR ASSUMPTIONS)
  archeShare: number[]; tierShare: number[]; pActive: number[]; churn: number[]; traderProb: number[]; boardProb: number; friendHomophily: number; adaptiveShare: number; mergeLoveMix: number[];
  snapshotDays: number[];
}

const DEFAULTS: Params = {
  nPlayers: 5000, days: 60, seed: 0x5eed1234,
  tierCount: TIER_SPECIES_COUNTS.slice(),
  tierOdds: TIER_ODDS.slice(),
  spPerMin: [22, 22, 22, 22], spShare: [[0.5, 0.3, 0.2], [0.2, 0.55, 0.25], [0.2, 0.25, 0.55], [0.33, 0.33, 0.34]], speedScale: 1,
  capsuleCost: CAPSULE_COST, onboardRamp: CAPSULE_RAMP.map((x) => x / CAPSULE_COST), dailyCapsCap: DAILY_FULL_RATE_CAPSULES, overRate: DAILY_REDUCED_RATE, hardExtraCaps: DAILY_HARD_STOP_CAPSULES - DAILY_FULL_RATE_CAPSULES,
  beta: 0, lambda: 0.12, balance: true,
  restock: true, restockOffered: RESTOCK_OFFER_COUNT, restockMaxTier: RESTOCK_MAX_TIER_INDEX, tasksOffered: TASKS_OFFERED_PER_DAY, taskWeeklyMax: TASKS_MAX_PER_WEEK,
  merge: true, mergeInputs: MERGE_COST, pUp: MERGE_RULES.tierUp.slice(), unownedW: MERGE_RULES.unownedWeight, pityUp: MERGE_RULES.pityAfter, rowDoneBoost: MERGE_RULES.rowDoneBoost, rowDoneCap: MERGE_RULES.rowDoneCap, mergeLockDays: 1, keepOneShare: 0.8, playfulShare: 0.3, bulkMerge: false, maxMergesPerDay: 3, bulkMax: 10,
  trade: false, tryProb: 0.7, favorProb: 0.5, lockDays: 1, dailyTradeCap: 3, maxSwapsPerTrade: 3, boardSample: 40, acceptProb: 0.85,
  archeShare: [0.38, 0.27, 0.15, 0.20], tierShare: [0.40, 0.40, 0.20], pActive: [0.40, 0.70, 0.90],
  churn: [0.015, 0.007, 0.003], traderProb: [0.30, 0.55, 0.75], boardProb: 0.7, friendHomophily: 0.5, adaptiveShare: 0, mergeLoveMix: [0.2, 0.5, 0.3],
  snapshotDays: [7, 14, 30, 60],
};

/** Minutes of real touching on one active day. casual 1-2 sessions x 3-5 min; regular ~2 x 10-15; devoted 2-3 x 12-22. */
function sampleMinutes(tier: number, rng: Rng): number {
  if (tier === 0) { const n = rng() < 0.55 ? 1 : 2; let m = 0; for (let i = 0; i < n; i++) m += 3 + 2 * rng(); return m; }
  if (tier === 1) { const n = rng() < 0.25 ? 1 : 2; let m = 0; for (let i = 0; i < n; i++) m += 10 + 5 * rng(); return m; }
  const n = rng() < 0.5 ? 2 : 3; let m = 0; for (let i = 0; i < n; i++) m += 12 + 10 * rng(); return m;
}

/* ───────────────────────────── population ───────────────────────────── */

interface Pop { n: number; arche: Uint8Array; tier: Uint8Array; trader: Uint8Array; usesBoard: Uint8Array; adaptive: Uint8Array; playful: Uint8Array; pace: Float32Array; mergeLove: Float32Array; keepOne: Uint8Array; friends: number[][]; }
function makePop(P: Params): Pop {
  const r = mulberry32(P.seed ^ 0x9e3779b9);
  const n = P.nPlayers;
  const pop: Pop = { n, arche: new Uint8Array(n), tier: new Uint8Array(n), trader: new Uint8Array(n), usesBoard: new Uint8Array(n), adaptive: new Uint8Array(n), playful: new Uint8Array(n),
    pace: new Float32Array(n), mergeLove: new Float32Array(n), keepOne: new Uint8Array(n), friends: Array.from({ length: n }, () => []) };
  const byArche: number[][] = [[], [], [], []];
  const loves = [0, 0.15, 0.5];
  for (let i = 0; i < n; i++) {
    pop.arche[i] = pickIdx(P.archeShare, 1, r); pop.tier[i] = pickIdx(P.tierShare, 1, r);
    pop.trader[i] = r() < P.traderProb[pop.tier[i]] ? 1 : 0;
    pop.usesBoard[i] = pop.trader[i] && r() < P.boardProb ? 1 : 0;
    pop.adaptive[i] = r() < P.adaptiveShare ? 1 : 0;
    pop.playful[i] = r() < P.playfulShare ? 1 : 0;
    pop.pace[i] = Math.exp(0.2 * gauss(r));
    pop.mergeLove[i] = loves[pickIdx(P.mergeLoveMix, 1, r)];
    pop.keepOne[i] = r() < P.keepOneShare ? 1 : 0;
    byArche[pop.arche[i]].push(i);
  }
  for (let i = 0; i < n; i++) {
    const u = r();
    const f = u < 0.35 ? 0 : u < 0.65 ? 1 + Math.floor(r() * 2) : u < 0.9 ? 3 + Math.floor(r() * 3) : 6 + Math.floor(r() * 5);
    for (let k = 0; k < f; k++) {
      let j: number;
      if (r() < P.friendHomophily) { const pool = byArche[pop.arche[i]]; j = pool[Math.floor(r() * pool.length)]; } else j = Math.floor(r() * n);
      if (j === i || pop.friends[i].includes(j)) continue;
      pop.friends[i].push(j); pop.friends[j].push(i);
    }
  }
  return pop;
}

/** Supply balancing: scale group weights so every style group gets about the same GLOBAL supply despite a skewed player mix. */
function balanceCorrection(P: Params): number[] {
  const c = [1, 1, 1];
  if (!P.balance || P.beta === 0) return c;
  for (let it = 0; it < 60; it++) {
    const S = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      let z = 0; const e = [0, 0, 0];
      for (let g = 0; g < 3; g++) { e[g] = Math.exp(P.beta * P.spShare[k][g]) * c[g]; z += e[g]; }
      for (let g = 0; g < 3; g++) S[g] += P.archeShare[k] * (e[g] / z);
    }
    const tot = S[0] + S[1] + S[2];
    for (let g = 0; g < 3; g++) c[g] *= (tot / 3) / S[g];
  }
  return c;
}

/* ───────────────────────────── players ───────────────────────────── */

interface Player {
  id: number; rng: Rng; arche: number; tier: number; alive: boolean; trader: boolean; usesBoard: boolean; adaptive: boolean; playful: boolean; pace: number; mergeLove: number; keepOne: boolean;
  aff: number[]; meter: number; capsEarned: number; minutes: number; firstCapMin: number; pairMin: number; tripMin: number; pairCaps: number; tripCaps: number;
  count: Uint16Array; lockedCopies: Uint16Array; lockUntil: Int16Array; firstDay: Int16Array; via: Uint8Array;
  tierOwned: Uint8Array; rowDay: Int16Array; firstTier: Int16Array; owned: number; fullDay: number; fullMin: number;
  noUp: Uint8Array; bad: Uint8Array; maxBad: number;
  merges: number; mergeUps: number; mergeRepeats: number; mergeBad: number; mergeAnyBad: number; liveMerges: number; liveRepeat: number; liveBad: number; liveNew: number; outByTier: Uint16Array; inByTier: Uint16Array;
  capsules: number; dupCapsules: number; capsByTier: Uint16Array;
  trades: number; tradesToday: number; tradeDay: number; activeDays: number; taskWeek: number; taskDone: number;
  /** Bitsets (Catalog.words words): species the player has none of, and species with a tradeable spare. Rebuilt by setMasks. */
  need: Int32Array; spare: Int32Array;
}
function makePlayers(P: Params, pop: Pop, cat: Catalog): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < pop.n; i++) {
    out.push({
      id: i, rng: mulberry32((P.seed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0), arche: pop.arche[i], tier: pop.tier[i], alive: true, trader: pop.trader[i] === 1, usesBoard: pop.usesBoard[i] === 1,
      adaptive: pop.adaptive[i] === 1, playful: pop.playful[i] === 1, pace: pop.pace[i], mergeLove: pop.mergeLove[i], keepOne: pop.keepOne[i] === 1,
      aff: [1 / 3, 1 / 3, 1 / 3], meter: 0, capsEarned: 0, minutes: 0, firstCapMin: -1, pairMin: -1, tripMin: -1, pairCaps: -1, tripCaps: -1,
      count: new Uint16Array(cat.n), lockedCopies: new Uint16Array(cat.n), lockUntil: new Int16Array(cat.n), firstDay: new Int16Array(cat.n).fill(-1), via: new Uint8Array(cat.n),
      tierOwned: new Uint8Array(NT), rowDay: new Int16Array(NT).fill(-1), firstTier: new Int16Array(NT).fill(-1), owned: 0, fullDay: -1, fullMin: -1,
      noUp: new Uint8Array(NT), bad: new Uint8Array(NT), maxBad: 0,
      merges: 0, mergeUps: 0, mergeRepeats: 0, mergeBad: 0, mergeAnyBad: 0, liveMerges: 0, liveRepeat: 0, liveBad: 0, liveNew: 0, outByTier: new Uint16Array(NT), inByTier: new Uint16Array(NT),
      capsules: 0, dupCapsules: 0, capsByTier: new Uint16Array(NT),
      trades: 0, tradesToday: 0, tradeDay: -1, activeDays: 0, taskWeek: -1, taskDone: 0, need: new Int32Array(cat.words), spare: new Int32Array(cat.words),
    });
  }
  return out;
}
const lockedNow = (p: Player, s: number, day: number): number => (day < p.lockUntil[s] ? p.lockedCopies[s] : 0);
const spareOf = (p: Player, s: number, day: number): number => Math.max(0, p.count[s] - lockedNow(p, s, day) - 1);
function addLock(p: Player, s: number, day: number, L: number): void { if (L <= 0) return; if (day >= p.lockUntil[s]) p.lockedCopies[s] = 0; p.lockedCopies[s]++; p.lockUntil[s] = Math.max(p.lockUntil[s], day + L); }
/** Rebuild a player's need / spare bitsets for `day` (spares exclude copies still under the trade lock and the copy the player keeps). */
export function setMasks(cat: Catalog, p: Pick<Player, 'count' | 'lockUntil' | 'lockedCopies' | 'need' | 'spare'>, day: number): void {
  p.need.fill(0); p.spare.fill(0);
  for (let s = 0; s < cat.n; s++) {
    if (p.count[s] === 0) bitsetSet(p.need, s);
    else if (spareOf(p as Player, s, day) > 0) bitsetSet(p.spare, s);
  }
}
/**
 * Units A could receive from B in one trade, at most `cap`, best tiers first: per tier, min(B's spares that A needs, what A can give).
 * A gives B's needs from its spares (`mutual` units); with `favour` A may also give any same-tier spare. Pure (reads the bitsets only).
 */
export function swapCountCore(cat: Catalog, A: Pick<Player, 'need' | 'spare'>, B: Pick<Player, 'need' | 'spare'>, cap: number, favour: boolean): { total: number; mutual: number } {
  let tot = 0, mut = 0;
  for (let t = NT - 1; t >= 0 && tot < cap; t--) {
    const m = cat.tierMask[t];
    const y = bitsetAndCount(B.spare, A.need, m);
    if (y === 0) continue;
    const x = bitsetAndCount(A.spare, B.need, m);
    const give = favour ? bitsetAndCount(A.spare, m) : x;
    const k = Math.min(y, give, cap - tot);
    if (k <= 0) continue;
    mut += Math.min(k, x); tot += k;
  }
  return { total: tot, mutual: mut };
}

/* ───────────────────────────── merge rule (shared by players and the farmer): the REAL core ───────────────────────────── */

interface MergeOut { out: number; up: boolean; repeat: boolean; }
const rulesCache = new WeakMap<object, MergeRules>();
/** The merge rules of a parameter set, as the real module's MergeRules (the ablation ladder overrides fields; the default IS MERGE_RULES). */
function rulesOf(P: Params): MergeRules {
  let r = rulesCache.get(P);
  if (!r) { r = { tierUp: P.pUp, unownedWeight: P.unownedW, pityAfter: P.pityUp, rowDoneBoost: P.rowDoneBoost, rowDoneCap: P.rowDoneCap }; rulesCache.set(P, r); }
  return r;
}
/**
 * Rolls the result of one merge of species handle sIn through src/core/merge.ts (mergeOddsCore + mergeDrawCore, the functions previewMerge and
 * rollMerge use). Mutates the pity counters (`noUp` = merges in a row without a tier-up, per tier) and the feel-bad streak `bad`; does not touch counts.
 * `count` is ownership BEFORE the inputs are consumed (only species other than sIn matter). Two uniform draws, like the real roll's first two.
 */
function mergeRoll(P: Params, cat: Catalog, rng: Rng, sIn: number, count: Uint16Array, noUp: Uint8Array, bad: Uint8Array, alwaysUnowned: number): MergeOut {
  const t = cat.tierOf[sIn];
  const odds = mergeOddsCore({ tier: t, self: sIn, roster: cat.byTier, copies: (h) => (h === alwaysUnowned ? 0 : count[h]), pity: noUp[t], rules: rulesOf(P) });
  const r = mergeDrawCore(odds, rng(), rng());
  const repeat = !(count[r.out] === 0 || r.out === alwaysUnowned);
  noUp[t] = pityAfterCore(noUp[t], r.tierUp);
  if (!r.tierUp && repeat) { if (bad[t] < 255) bad[t]++; } else bad[t] = 0;
  return { out: r.out, up: r.tierUp, repeat };
}

/* ───────────────────────────── scenario ───────────────────────────── */

interface Weekly { capRP: number[]; dupRP: number[]; capsules: number[]; dupCapsules: number[]; restock: number[]; merges: number[]; mergeIn: number[]; trades: number[]; alive: number[]; hoard: number[]; owned: number[]; capTier: number[][]; capGroup: number[][]; }
const mkWeekly = (weeks: number): Weekly => { const z = (): number[] => new Array(weeks).fill(0); return { capRP: z(), dupRP: z(), capsules: z(), dupCapsules: z(), restock: z(), merges: z(), mergeIn: z(), trades: z(), alive: z(), hoard: z(), owned: z(), capTier: Array.from({ length: NT }, z), capGroup: Array.from({ length: 4 }, z) }; };
interface Snap { day: number; pairs: Record<string, [number, number]>; ge2: number[]; ge3: number[]; ge4: number[]; n: number; }
interface Result { P: Params; cat: Catalog; players: Player[]; wk: Weekly; snaps: Snap[]; label: string; }

const sameCounts = (a: number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const realOdds = (P: Params): boolean => P.tierOdds.length === TIER_ODDS.length && P.tierOdds.every((x, i) => x === TIER_ODDS[i]);
function runScenario(P: Params, pop: Pop, label: string, cat: Catalog = sameCounts(P.tierCount, TIER_SPECIES_COUNTS) ? REAL : buildCatalog(P.tierCount)): Result {
  const players = makePlayers(P, pop, cat);
  const weeks = Math.ceil(P.days / 7);
  const wk = mkWeekly(weeks);
  const snaps: Snap[] = [];
  const sys = mulberry32(P.seed ^ 0xabcdef01);
  const corr = balanceCorrection(P);
  const stamp = new Int32Array(pop.n).fill(-1);
  const wts = new Float64Array(64);
  const M = P.mergeInputs;

  const onNew = (p: Player, s: number, day: number, via: number): void => {
    const t = cat.tierOf[s];
    p.owned++; p.tierOwned[t]++;
    if (p.firstDay[s] < 0) { p.firstDay[s] = day; p.via[s] = via; }
    if (p.firstTier[t] < 0) p.firstTier[t] = day + 1;
    if (p.tierOwned[t] === P.tierCount[t] && p.rowDay[t] < 0) p.rowDay[t] = day + 1;
    if (p.owned === cat.n && p.fullDay < 0) { p.fullDay = day + 1; p.fullMin = p.minutes; }
  };
  const addCopy = (p: Player, s: number, day: number, via: number, minuteStamp: number): boolean => {
    const dup = p.count[s] > 0; p.count[s]++;
    if (!dup) onNew(p, s, day, via);
    const c = p.count[s];
    if (c >= 2 && p.pairMin < 0) { p.pairMin = minuteStamp; p.pairCaps = p.capsules; }
    if (c >= 3 && p.tripMin < 0) { p.tripMin = minuteStamp; p.tripCaps = p.capsules; }
    return dup;
  };
  const openCap = (p: Player, s: number, day: number, stampMin: number, w: number): void => {
    const dup = addCopy(p, s, day, 1, stampMin);
    if (dup) { wk.dupCapsules[w]++; p.dupCapsules++; }
    if (cat.tierOf[s] >= 2) { wk.capRP[w]++; if (dup) wk.dupRP[w]++; }
  };
  const rollCapsule = (p: Player, a: number[], w: number): number => {
    // the real roll (src/core/drops.ts rollCapsule: tier by the public odds, species uniform inside the tier, genome seed) whenever the roster is the real one
    // and affinity is off, which is the shipped design; the affinity experiment (beta > 0) and what-if catalogs use the local tilted version below
    if (cat.real && P.beta === 0 && realOdds(P)) {
      const c = rollCapsule_real(p.rng);
      const s2 = REAL_POS.get(c.species) as number;
      wk.capsules[w]++; wk.capTier[c.tierIndex][w]++; wk.capGroup[cat.groupOf[s2]][w]++; p.capsules++; p.capsByTier[c.tierIndex]++;
      return s2;
    }
    let x = p.rng(), t = 0;
    for (; t < NT - 1; t++) { x -= P.tierOdds[t]; if (x < 0) break; }
    const list = cat.byTier[t];
    let s: number;
    if (P.beta === 0 || t > MAX_AFFINITY_TIER) s = list[Math.floor(p.rng() * list.length)];
    else {
      const f = [Math.exp(P.beta * a[0]) * corr[0], Math.exp(P.beta * a[1]) * corr[1], Math.exp(P.beta * a[2]) * corr[2]];
      let tot = 0;
      for (let i = 0; i < list.length; i++) { wts[i] = f[cat.groupOf[list[i]]]; tot += wts[i]; }
      let y = p.rng() * tot, k = 0;
      for (; k < list.length - 1; k++) { y -= wts[k]; if (y < 0) break; }
      s = list[k];
    }
    wk.capsules[w]++; wk.capTier[t][w]++; wk.capGroup[cat.groupOf[s]][w]++; p.capsules++; p.capsByTier[t]++;
    return s;
  };
  const tryMerge = (p: Player, day: number, w: number): boolean => {
    let best = -1, bestAvail = -1;
    const need = p.keepOne ? M + 1 : M;
    for (let s = 0; s < cat.n; s++) {
      const t = cat.tierOf[s];
      if (t >= NT - 1) continue;
      const avail = p.count[s] - lockedNow(p, s, day);
      if (avail < need) continue;
      if (p.trader && t >= 2 && avail < M + 3) continue; // traders keep Rare+ spares as trade stock
      const useful = p.tierOwned[t] < P.tierCount[t] || p.tierOwned[t + 1] < P.tierCount[t + 1];
      if (!useful && !p.playful) continue; // a sensible player stops merging rows that are complete
      if (avail > bestAvail || (avail === bestAvail && t < cat.tierOf[best])) { best = s; bestAvail = avail; }
    }
    if (best < 0) return false;
    const t = cat.tierOf[best];
    const live = p.tierOwned[t] < P.tierCount[t] || p.tierOwned[t + 1] < P.tierCount[t + 1];
    const m = mergeRoll(P, cat, p.rng, best, p.count, p.noUp, p.bad, -1);
    p.count[best] -= M;
    if (p.count[best] === 0) { p.owned--; p.tierOwned[t]--; }
    addCopy(p, m.out, day, 3, p.minutes);
    addLock(p, m.out, day, P.mergeLockDays);
    const ot = cat.tierOf[m.out];
    p.merges++; p.inByTier[t]++; p.outByTier[ot]++;
    if (m.up) p.mergeUps++;
    if (m.repeat) p.mergeRepeats++;
    if (!m.up && m.repeat) p.mergeBad++;
    if (m.repeat || !m.up) p.mergeAnyBad++;
    if (live) { p.liveMerges++; if (m.repeat) p.liveRepeat++; if (!m.up && m.repeat) p.liveBad++; if (!m.repeat) p.liveNew++; }
    if (p.bad[t] > p.maxBad) p.maxBad = p.bad[t];
    wk.merges[w]++; wk.mergeIn[w] += M;
    return true;
  };
  const masks = (p: Player, day: number): void => setMasks(cat, p, day);
  let lastMutual = 0;
  /** Units A could receive from B today. Same-tier 1:1. 'mutual' units = A gives something B still needs; with favour swaps (P.favorProb > 0) A may also give ANY same-tier spare (B just gains a spare). */
  const swapCount = (A: Player, B: Player, cap: number): number => {
    const r = swapCountCore(cat, A, B, cap, P.favorProb > 0);
    lastMutual = r.mutual;
    return r.total;
  };

  for (let day = 0; day < P.days; day++) {
    const w = Math.min(weeks - 1, Math.floor(day / 7));
    const active: Player[] = [];
    // ── pass 1: play, earn, open ──
    for (const p of players) {
      if (!p.alive) continue;
      if (day > 0 && p.rng() < P.churn[p.tier]) { p.alive = false; continue; }
      if (day > 0 && p.rng() >= P.pActive[p.tier]) continue;
      active.push(p); p.activeDays++; stamp[p.id] = day;
      const rng = p.rng;
      if (day === 0) { p.count[0]++; onNew(p, 0, 0, 5); }
      const wkIdx = Math.floor(day / 7);
      if (p.taskWeek !== wkIdx) { p.taskWeek = wkIdx; p.taskDone = 0; }
      const minutesToday = sampleMinutes(p.tier, rng);
      const m0 = p.minutes;
      // daily style of play = the archetype's SP share by kind, with day-to-day wobble
      const base = P.spShare[p.arche];
      const mix = [0, 0, 0]; let ms = 0;
      for (let g = 0; g < 3; g++) { mix[g] = base[g] * Math.exp(0.35 * gauss(rng)); ms += mix[g]; }
      for (let g = 0; g < 3; g++) mix[g] /= ms;
      if (p.adaptive && p.owned >= 8 && rng() < 0.7) {
        let worst = 0, worstCov = 99;
        for (let g = 0; g < 3; g++) { let c = 0; for (let s = 0; s < cat.n; s++) if (cat.groupOf[s] === g && p.count[s] > 0) c++; c += rng() * 0.1; if (c < worstCov) { worstCov = c; worst = g; } }
        for (let g = 0; g < 3; g++) mix[g] = g === worst ? 0.8 : 0.1;
      }
      for (let g = 0; g < 3; g++) p.aff[g] = (1 - P.lambda) * p.aff[g] + P.lambda * mix[g];
      // the Squish meter: SP = minutes x SP/min (archetype, personal pace, speed scale, daily wobble), soft-capped per day
      const spPerMin = P.spPerMin[p.arche] * p.pace * P.speedScale * Math.exp(0.15 * gauss(rng));
      const raw = minutesToday * spPerMin;
      const capSp = P.dailyCapsCap * P.capsuleCost;
      const spToday = Math.min(raw, capSp) + Math.min(Math.max(0, raw - capSp) * P.overRate, P.hardExtraCaps * P.capsuleCost);
      // restock first (claimed when you open the game)
      if (P.restock) {
        let offered: number[] = [];
        if (cat.real && P.restockOffered === RESTOCK_OFFER_COUNT && P.restockMaxTier === RESTOCK_MAX_TIER_INDEX) offered = restockOffer(rng).map((id) => REAL_POS.get(id) as number); // the real Daily Restock
        else {
          const pool: number[] = [];
          for (let t = 0; t <= P.restockMaxTier; t++) for (const s of cat.byTier[t]) pool.push(s);
          for (let k = 0; k < P.restockOffered && pool.length; k++) offered.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
        }
        const fresh = offered.filter((s) => p.count[s] === 0).sort((a, b) => cat.tierOf[b] - cat.tierOf[a]);
        addCopy(p, fresh.length ? fresh[0] : offered[Math.floor(rng() * offered.length)], day, 2, m0);
        wk.restock[w]++;
      }
      // capsules as the meter crosses each (ramped) threshold
      let have = p.meter, used = 0;
      const aff = p.aff;
      for (;;) {
        const cost = P.capsuleCost * (p.capsEarned < P.onboardRamp.length ? P.onboardRamp[p.capsEarned] : 1);
        const need = cost - have;
        if (used + need > spToday + 1e-9) { p.meter = have + (spToday - used); break; }
        used += need; have = 0; p.capsEarned++;
        const stampMin = m0 + minutesToday * Math.min(1, raw > 0 ? used / raw : 1);
        if (p.firstCapMin < 0) p.firstCapMin = stampMin;
        openCap(p, rollCapsule(p, day === 0 ? [1 / 3, 1 / 3, 1 / 3] : aff, w), day, stampMin, w);
        if (used >= spToday - 1e-9) { p.meter = 0; break; }
      }
      const taskP = [0.4, 0.6, 0.8][p.tier];
      for (let k = 0; k < P.tasksOffered; k++) {
        if (p.taskDone >= P.taskWeeklyMax) break;
        if (rng() < taskP) { p.taskDone++; openCap(p, rollCapsule(p, aff, w), day, m0 + minutesToday * rng(), w); }
      }
      p.minutes += minutesToday;
    }
    // ── snapshots (before trading) ──
    if (P.snapshotDays.includes(day + 1)) {
      const pairs: Record<string, [number, number]> = {};
      const bump = (k: string, ok: boolean): void => { const e = (pairs[k] ??= [0, 0]); e[1]++; if (ok) e[0]++; };
      const live = players.filter((p) => p.alive && p.activeDays >= 3);
      for (const p of live) masks(p, day + 1000);
      for (let i = 0; i < 20000 && live.length > 2; i++) {
        const A = live[Math.floor(sys() * live.length)], B = live[Math.floor(sys() * live.length)];
        if (A === B) continue;
        const ok = swapCount(A, B, 1) > 0;
        const pure = A.arche < 3 && B.arche < 3;
        bump('all pairs', ok);
        if (pure && A.arche === B.arche) bump('same style', ok); else if (pure) bump('different style', ok); else bump('involves mixed', ok);
      }
      const g2 = new Array(NT).fill(0), g3 = new Array(NT).fill(0), g4 = new Array(NT).fill(0);
      for (const p of live) {
        const h2 = new Uint8Array(NT), h3 = new Uint8Array(NT), h4 = new Uint8Array(NT);
        for (let s = 0; s < cat.n; s++) { const t = cat.tierOf[s]; if (p.count[s] >= 2) h2[t] = 1; if (p.count[s] >= 3) h3[t] = 1; if (p.count[s] >= 4) h4[t] = 1; }
        for (let t = 0; t < NT; t++) { g2[t] += h2[t]; g3[t] += h3[t]; g4[t] += h4[t]; }
      }
      const nl = Math.max(1, live.length);
      snaps.push({ day: day + 1, pairs, ge2: g2.map((x) => x / nl), ge3: g3.map((x) => x / nl), ge4: g4.map((x) => x / nl), n: live.length });
    }
    // ── pass 2: trading ──
    if (P.trade) {
      const traders = active.filter((p) => p.trader);
      for (const p of traders) masks(p, day);
      const board = traders.filter((p) => p.usesBoard);
      // the public board is SEARCHABLE BY SPECIES (a grid of species icons, never free text): offers[s] = board users holding a spare of s
      const offers: Player[][] = Array.from({ length: cat.n }, () => []);
      for (const b of board) for (let s = 0; s < cat.n; s++) if (bitsetHas(b.spare, s)) offers[s].push(b);
      const order = traders.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(sys() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      for (const A of order) {
        if (A.tradeDay !== day) { A.tradeDay = day; A.tradesToday = 0; }
        if (A.tradesToday >= P.dailyTradeCap || A.owned >= cat.n) continue;
        if (A.rng() > P.tryProb) continue;
        let bestB: Player | null = null, bestN = 0, bestMut = -1;
        const consider = (B: Player): void => {
          if (B === A || !B.trader) return;
          if (B.tradeDay !== day) { B.tradeDay = day; B.tradesToday = 0; }
          if (B.tradesToday >= P.dailyTradeCap) return;
          const n = swapCount(A, B, P.maxSwapsPerTrade);
          if (n > bestN || (n === bestN && n > 0 && lastMutual > bestMut)) { bestN = n; bestMut = lastMutual; bestB = B; }
        };
        for (const fid of pop.friends[A.id]) if (stamp[fid] === day && players[fid].trader) consider(players[fid]);
        if (A.usesBoard && board.length > 1) {
          let looked = 0;
          for (let t = NT - 1; t >= 0 && looked < P.boardSample; t--) for (const s of cat.byTier[t]) {
            if (A.count[s] !== 0) continue;
            const list = offers[s];
            for (let k = 0; k < Math.min(6, list.length) && looked < P.boardSample; k++, looked++) consider(list[Math.floor(sys() * list.length)]);
          }
        }
        if (!bestB) continue;
        const B: Player = bestB;
        const nFinal = swapCount(A, B, P.maxSwapsPerTrade);
        const fullyMutual = lastMutual === nFinal;
        if (A.rng() > (fullyMutual ? P.acceptProb : P.favorProb * P.acceptProb)) continue;
        let left = P.maxSwapsPerTrade;
        for (let t = NT - 1; t >= 0 && left > 0; t--) {
          const ys: number[] = [], xm: number[] = [], xo: number[] = [];
          for (const s of cat.byTier[t]) {
            if (spareOf(B, s, day) > 0 && A.count[s] === 0) ys.push(s);
            if (spareOf(A, s, day) > 0) { if (B.count[s] === 0) xm.push(s); else xo.push(s); }
          }
          ys.sort((a, b) => B.count[b] - B.count[a]); xm.sort((a, b) => A.count[b] - A.count[a]); xo.sort((a, b) => A.count[b] - A.count[a]);
          const gives = P.favorProb > 0 ? xm.concat(xo) : xm;
          const k = Math.min(ys.length, gives.length, left);
          for (let i = 0; i < k; i++) {
            const x = gives[i], y = ys[i];
            A.count[x]--; B.count[x]++; addLock(B, x, day, P.lockDays); if (B.count[x] === 1) onNew(B, x, day, 4);
            B.count[y]--; A.count[y]++; addLock(A, y, day, P.lockDays); onNew(A, y, day, 4);
          }
          left -= k;
        }
        A.trades++; B.trades++; A.tradesToday++; B.tradesToday++; wk.trades[w]++;
        masks(A, day); masks(B, day);
      }
    }
    // ── pass 3: merge on purpose ──
    if (P.merge) for (const p of active) {
      if (P.bulkMerge) { if (p.mergeLove > 0 && p.rng() < p.mergeLove * 2) for (let k = 0; k < P.bulkMax; k++) if (!tryMerge(p, day, w)) break; }
      else for (let k = 0; k < P.maxMergesPerDay && p.rng() < p.mergeLove; k++) if (!tryMerge(p, day, w)) break;
    }
    if ((day + 1) % 7 === 0 || day === P.days - 1) for (const p of players) if (p.alive) { wk.alive[w]++; wk.hoard[w] += sum(p.count); wk.owned[w] += p.owned; }
  }
  return { P, cat, players, wk, snaps, label };
}

/* ───────────────────────────── merge-only farmer (exact-need cost) ───────────────────────────── */

interface FarmOut { capsulesMed: number; capsulesMean: number; mergesMed: number; finished: number; }
/** One collector who wants ONE specific species and may only get it as the OUTPUT of a merge (drops of it do not count). Feeds merges from the target's tier and the one below. */
function farmer(P: Params, cat: Catalog, targetTier: number, trials: number, cap: number): FarmOut {
  const X = cat.byTier[targetTier][cat.byTier[targetTier].length - 1];
  const caps: number[] = [], mrg: number[] = [];
  for (let tr = 0; tr < trials; tr++) {
    const rng = mulberry32(0xfa12 + tr * 7919 + targetTier * 104729);
    const count = new Uint16Array(cat.n), noUp = new Uint8Array(NT), bad = new Uint8Array(NT);
    let c = 0, m = 0, hit = false;
    const lo = Math.max(0, targetTier - 1);
    while (!hit && c < cap) {
      c++;
      let s: number;
      if (cat.real && realOdds(P)) s = REAL_POS.get(rollCapsule_real(rng).species) as number;
      else {
        let x = rng(), t = 0;
        for (; t < NT - 1; t++) { x -= P.tierOdds[t]; if (x < 0) break; }
        const list = cat.byTier[t];
        s = list[Math.floor(rng() * list.length)];
      }
      if (s !== X) count[s]++;
      for (let again = true; again && !hit;) {
        again = false;
        for (let q = Math.min(targetTier, NT - 2); q >= lo && !again; q--) for (const sp of cat.byTier[q]) {
          if (sp === X || count[sp] < P.mergeInputs) continue;
          count[sp] -= P.mergeInputs; m++;
          const r = mergeRoll(P, cat, rng, sp, count, noUp, bad, X);
          if (r.out === X) { hit = true; break; }
          count[r.out]++; again = true; break;
        }
      }
    }
    if (hit) { caps.push(c); mrg.push(m); }
  }
  return { capsulesMed: median(caps), capsulesMean: mean(caps), mergesMed: median(mrg), finished: caps.length / trials };
}

/* ───────────────────────────── exploit ring (merge-then-trade laundering) ───────────────────────────── */

interface Policy { name: string; lockH: number; capPerDay: number; pairPerDay: number; }
interface RingOut { copies: number; launder: number; innocents: number; maxHop: number; }
/** Hourly toy model of a hostile ring: 6 bot mules trade tainted items among themselves, cash 25% of hops out to random innocents, and MERGE any M unlocked copies of one species into a fresh-looking item.
 *  'dupe' = hypothetical server bug where the GIVER KEEPS the item and the receiver also gets a copy (starts with 1 item); 'steal' = no bug, the ring moves 20 stolen items (5 species x 4). Detection at hour D. */
function ring(P: Params, policy: Policy, bug: 'dupe' | 'steal', detectH: number): RingOut {
  const r = mulberry32(0xbad0 + policy.lockH * 7 + (policy.capPerDay % 1000) * 13 + (policy.pairPerDay % 1000) * 31 + (bug === 'dupe' ? 1 : 2));
  const R = 6, HONEST = 4000, BOT = 30, CASHOUT = 0.25, ONWARD = 0.01, MERGES_PER_H = 10, ITEM_CAP = 300000;
  interface It { holder: number; unlock: number; hop: number; sp: number; gen: number; }
  let items: It[] = [];
  if (bug === 'dupe') items.push({ holder: 0, unlock: 0, hop: 0, sp: 0, gen: 0 });
  else for (let i = 0; i < 20; i++) items.push({ holder: i % R, unlock: 0, hop: 0, sp: Math.floor(i / 4), gen: 0 });
  const start = items.length;
  const dayTrades = new Map<string, number>();
  let launder = 0;
  for (let h = 0; h < detectH && items.length < ITEM_CAP; h++) {
    const d = Math.floor(h / 24);
    for (let mule = 0; mule < R; mule++) {
      let budget = MERGES_PER_H;
      const bySp = new Map<number, number[]>();
      for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.holder === mule && it.unlock <= h && it.gen === 0) { let a = bySp.get(it.sp); if (!a) { a = []; bySp.set(it.sp, a); } a.push(i); } }
      const dead = new Set<number>();
      for (const [, idxs] of bySp) while (idxs.length >= P.mergeInputs && budget > 0) {
        for (const u of idxs.splice(0, P.mergeInputs)) dead.add(u);
        items.push({ holder: mule, unlock: h + policy.lockH, hop: 0, sp: 1000 + Math.floor(r() * 50), gen: 1 });
        launder++; budget--;
      }
      if (dead.size) items = items.filter((_, i) => !dead.has(i));
    }
    const budgets = new Array(R).fill(BOT);
    const n0 = items.length;
    for (let idx = 0; idx < n0; idx++) {
      const it = items[idx];
      if (!it || it.unlock > h) continue;
      if (it.holder >= R) { if (r() < ONWARD) { it.holder = R + Math.floor(r() * HONEST); it.unlock = h + policy.lockH; it.hop++; } continue; }
      while (budgets[it.holder] > 0 && items.length < ITEM_CAP) {
        budgets[it.holder]--;
        const toInnocent = r() < CASHOUT;
        const to = toInnocent ? R + Math.floor(r() * HONEST) : (it.holder + 1 + Math.floor(r() * (R - 1))) % R;
        const gk = d + ':a' + it.holder;
        if ((dayTrades.get(gk) ?? 0) >= policy.capPerDay) { budgets[it.holder] = 0; break; }
        const pk = d + ':p' + Math.min(it.holder, to) + '-' + Math.max(it.holder, to);
        if (!toInnocent && (dayTrades.get(pk) ?? 0) >= policy.pairPerDay) continue;
        dayTrades.set(gk, (dayTrades.get(gk) ?? 0) + 1);
        if (!toInnocent) dayTrades.set(pk, (dayTrades.get(pk) ?? 0) + 1);
        if (bug === 'dupe') items.push({ holder: to, unlock: h + policy.lockH, hop: it.hop + 1, sp: it.sp, gen: it.gen });
        else { it.holder = to; it.unlock = h + policy.lockH; it.hop++; break; }
      }
    }
  }
  const inn = new Set<number>(); let maxHop = 0;
  for (const it of items) { if (it.holder >= R) inn.add(it.holder); if (it.hop > maxHop) maxHop = it.hop; }
  return { copies: Math.max(0, items.length - start + launder * P.mergeInputs), launder, innocents: inn.size, maxHop };
}

/* ───────────────────────────── reporting ───────────────────────────── */

const argv = process.argv.slice(2);
const argNum = (name: string, dflt: number): number => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
// set by init() when the sim is executed directly (importing this file from a probe runs nothing)
let QUICK = false, ONLY = '', MICRO!: Micro, BASE!: Params, LONG = 450;
const want = (k: string): boolean => !ONLY || ONLY.split(',').includes(k);
function init(): void {
  QUICK = argv.includes('--quick');
  ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
  MICRO = runMicro();
  BASE = { ...DEFAULTS, nPlayers: argNum('--n', QUICK ? 1500 : DEFAULTS.nPlayers), days: argNum('--days', DEFAULTS.days), spPerMin: MICRO.spPerMin, spShare: MICRO.share, capsuleCost: argNum('--cost', DEFAULTS.capsuleCost), mergeInputs: argNum('--M', MERGE_COST) };
  LONG = argNum('--long', QUICK ? 300 : 450);
}
const header = (t: string): void => { console.log('\n' + '='.repeat(124) + '\n' + t + '\n' + '='.repeat(124)); };
const dupRate = (r: Result): number => sum(r.wk.dupCapsules) / sum(r.wk.capsules);
const doneBy = (sel: Player[], day: number, key: (p: Player) => number): number => (sel.length ? sel.filter((p) => key(p) > 0 && key(p) <= day).length / sel.length : NaN);
const dayQ = (sel: Player[], key: (p: Player) => number, q: number, horizon: number): string => { const v = quantile(sel.map((p) => (key(p) > 0 ? key(p) : 1e9)), q); return v >= 1e9 ? '>' + horizon : String(Math.round(v)); };
const dayQn = (sel: Player[], key: (p: Player) => number, q: number): number => quantile(sel.map((p) => (key(p) > 0 ? key(p) : 1e9)), q);
const medDay = (sel: Player[], key: (p: Player) => number, horizon: number): string => dayQ(sel, key, 0.5, horizon);
const epicPlus = (p: Player): number => p.tierOwned[3] + p.tierOwned[4] + p.tierOwned[5];

function secMicro(): void {
  header('A. ACTIVE PLAY: what touching pays (micro-sim of human touch streams; every archetype, 400 x 5-minute streams)');
  console.log(`Meter rule: TAPS PAY ${PAY.poke} SP (a poke, or a squeeze released under 0.4 s; owner decision 2026-10-06) | squeeze+release ${PAY.squeezeBase} +${PAY.squeezePerSec}/s held (hold counted up to ${PAY.squeezeHoldCap} s), soft-pop +${PAY.softPop} if held >= 1.8 s | stretch-and-hold, let go: ${PAY.pullBase} +${PAY.pullPerSec}/s held (up to ${PAY.pullHoldCap} s; ${PAY.pullFail} flat if it never stretched) | MEDLEY +${PAY.medley} (a squeeze and a pull within ${PAY.medleyWindow} s, cooldown ${PAY.medleyCooldown} s) | anti-mash freshness for squeezes and pulls (tau ${TAU.slice(1).join('/')} s, squared, floor ${FRESHNESS_FLOORS.slice(1).join('/')}) | valve ${VALVE_PER_MIN} SP/min`);
  console.log(lpad('archetype', 10) + '| touches/min: poke squeeze pull | SP/min  (p10 / p50 / p90 of 5-min streams) | SP share poke/squeeze/pull | min per capsule @ cost ' + BASE.capsuleCost);
  const row = (name: string, r: MicroRow): void => console.log(`${lpad(name, 10)}| ${pad(f1(r.perMin[0]), 21)} ${pad(f1(r.perMin[1]), 6)} ${pad(f1(r.perMin[2]), 4)} | ${pad(f1(r.spPerMin), 6)}  (${f1(r.spreadP[0])} / ${f1(r.spreadP[1])} / ${f1(r.spreadP[2])}) | ${r.share.map((x) => pc0(x)).join(' / ')} | ${f1(BASE.capsuleCost / r.spPerMin)}`);
  BEHAV.forEach((b, i) => row(b.name, { spPerMin: MICRO.spPerMin[i], share: MICRO.share[i], perMin: MICRO.perMin[i], spreadP: MICRO.spreadP[i] }));
  console.log('extra styles (section A only, not in the population mix): tapper = bursts of 2-3 taps a second; holder = every stretch held 2-4 s');
  BEHAV_EXTRA.forEach((b, i) => row(b.name, MICRO.extra[i]));
  // the PAYING archetypes are the ones that hold and stretch: squeezer, puller, mixed (the poker and the tapper are mostly taps, which pay nothing)
  const payers = [1, 2, 3].map((i) => MICRO.spPerMin[i]);
  const avg = mean(payers);
  console.log(`paying styles (squeezer / puller / mixed) need ${payers.map((x) => f1(BASE.capsuleCost / x)).join(' / ')} active min per capsule (band 3.0 to 3.8; fastest/slowest x${f2(Math.max(...payers) / Math.min(...payers))}); the mostly-tapping styles (poker / tapper) earn ${f1(MICRO.spPerMin[0])} / ${f1(MICRO.extra[0].spPerMin)} SP/min = ${f1(BASE.capsuleCost / MICRO.spPerMin[0])} / ${f1(BASE.capsuleCost / MICRO.extra[0].spPerMin)} min per capsule: their only income is the few holds and stretches they also do`);
  console.log(`bots: 8 taps/s mash earns ${f1(MICRO.botMash)} SP/min and a tap every 250 ms ${f1(MICRO.botTap4)} (taps pay nothing at any speed); machine-speed squeezing (held 0.45 s every 0.5 s) ${f1(MICRO.botSqMash)} and stretching (held 0.3 s every 0.5 s) ${f1(MICRO.botPullMash)} SP/min (freshness floor); the best squeeze against the freshness curve (held 1.8 s every 2.4 s) ${f1(MICRO.botSq)}, full stretches held 3 s back to back ${f1(MICRO.botHold)}, a tap-squeeze-pull cycler at the physical limit ${f1(MICRO.botCycle)} SP/min (valve ${VALVE_PER_MIN}); paying humans ${f1(avg)} SP/min. Daily cap: ${BASE.dailyCapsCap} capsules at full rate, then ${BASE.overRate * 100}% rate up to ${BASE.dailyCapsCap + BASE.hardExtraCaps} total per day => a bot running 24 h gets at most ${BASE.dailyCapsCap + BASE.hardExtraCaps} capsules/day from play (a devoted human averages ~9 incl. tasks).`);
  console.log(`onboarding ramp: capsule 1/2/3 cost ${BASE.onboardRamp.map((x) => Math.round(x * BASE.capsuleCost)).join('/')} SP (then ${BASE.capsuleCost}); session model: casual 1-2 x 3-5 min, regular ~2 x 10-15, devoted 2-3 x 12-22`);
}

function secCatalog(cat: Catalog): void {
  header('B. THE CATALOG AND CAPSULE ODDS UNDER TEST');
  console.log(lpad('tier', 10) + '| species | odds/capsule | odds per species | capsules to 1st of a SPECIFIC species | capsules to 1st of ANY of tier | merge tier-up');
  for (let t = 0; t < NT; t++) {
    const n = BASE.tierCount[t], o = BASE.tierOdds[t], per = o / n;
    console.log(`${lpad(TIER_NAMES[t], 10)}| ${pad(n, 7)} | ${pad(pc(o), 12)} | ${pad(pc(per), 16)} | ${pad(f1(1 / per), 37)} | ${pad(f1(1 / o), 30)} | ${t < NT - 1 ? pc0(BASE.pUp[t]) : 'top: cannot merge'}`);
  }
  console.log(`total species ${cat.n};  MERGE_COST ${BASE.mergeInputs};  tier-up ${BASE.pUp.slice(0, 5).map(pc0).join('/')}, unowned weight x${BASE.unownedW}, tier-up pity ${BASE.pityUp} (per tier), completed-row rule: tier-up chance x${BASE.rowDoneBoost} capped at ${pc0(BASE.rowDoneCap)}, merge output locked ${BASE.mergeLockDays} d`);
  console.log(`affinity beta ${BASE.beta} (0 = OFF: tested in section J and rejected for species odds);  trade: same-tier 1:1, <= ${BASE.maxSwapsPerTrade}/trade, <= ${BASE.dailyTradeCap} trades/day, receive-lock ${BASE.lockDays} d`);
}

function secFirstHour(r: Result): void {
  header(`C. FIRST MINUTES (onboarding and first mergeable set), cohort of ${r.players.length}, M = ${r.P.mergeInputs}`);
  const grp = (f: (p: Player) => boolean): Player[] => r.players.filter(f);
  console.log(lpad('group', 16) + '| 1st capsule (s) | 1st pair: min  capsules | 1st triple: min  capsules | pair by 12 min / 25 min | triple by 12 / 25 / 60 min');
  const row = (name: string, sel: Player[]): void => {
    const sec = median(sel.map((p) => p.firstCapMin * 60));
    const pm = median(sel.filter((p) => p.pairMin >= 0).map((p) => p.pairMin)), pcps = median(sel.filter((p) => p.pairMin >= 0).map((p) => p.pairCaps));
    const tm = median(sel.filter((p) => p.tripMin >= 0).map((p) => p.tripMin)), tcps = median(sel.filter((p) => p.tripMin >= 0).map((p) => p.tripCaps));
    const by = (k: 'pairMin' | 'tripMin', m: number): string => pc0(sel.filter((p) => p[k] >= 0 && p[k] <= m).length / sel.length);
    console.log(`${lpad(name, 16)}| ${pad(f1(sec), 15)} | ${pad(f1(pm), 17)} ${pad(f1(pcps), 8)} | ${pad(f1(tm), 19)} ${pad(f1(tcps), 8)} | ${pad(by('pairMin', 12), 10)} / ${pad(by('pairMin', 25), 5)} | ${by('tripMin', 12)} / ${by('tripMin', 25)} / ${by('tripMin', 60)}`);
  };
  for (let t = 0; t < 3; t++) row(PLAYER_TYPES[t], grp((p) => p.tier === t));
  for (let a = 0; a < 4; a++) row('regular ' + ARCHE_NAMES[a], grp((p) => p.tier === 1 && p.arche === a));
  const per = r.P.capsuleCost;
  console.log(`steady-state ACTIVE minutes per capsule at ${per} SP:  ` + ARCHE_NAMES.map((n, a) => `${n} ${f1(per / (r.P.spPerMin[a] * r.P.speedScale))}`).join('   ') + `   (the player-pace spread: p10/p90 of per-player pace = x${f2(Math.exp(-0.2 * 1.28))}/x${f2(Math.exp(0.2 * 1.28))})`);
  const reg = r.players.filter((p) => p.tier === 1);
  const mpc = reg.map((p) => (p.capsules > 0 ? p.minutes / p.capsules : NaN)).filter((x) => Number.isFinite(x));
  console.log(`measured over the whole run for regular players: active minutes per capsule median ${f1(median(mpc))} (p10 ${f1(quantile(mpc, 0.1))}, p90 ${f1(quantile(mpc, 0.9))});  capsules per active day: casual ${f2(mean(r.players.filter((p) => p.tier === 0).map((p) => p.capsules / Math.max(1, p.activeDays))))}  regular ${f2(mean(reg.map((p) => p.capsules / Math.max(1, p.activeDays))))}  devoted ${f2(mean(r.players.filter((p) => p.tier === 2).map((p) => p.capsules / Math.max(1, p.activeDays))))}`);
}

function secIncome(r: Result): void {
  header('D. CAPSULE INCOME AND DUPLICATES  (60 days, churn on, trade on)');
  console.log('capsules by tier (share of all capsules opened):  ' + TIER_NAMES.map((n, t) => `${n} ${pc(sum(r.wk.capTier[t]) / sum(r.wk.capsules))}`).join('   '));
  const g = [0, 1, 2, 3].map((k) => sum(r.wk.capGroup[k])), g3 = g[0] + g[1] + g[2];
  console.log(`global capsule supply by style group (Common..Epic):  bounce ${pc(g[0] / g3)}  plush ${pc(g[1] / g3)}  stretch ${pc(g[2] / g3)}`);
  console.log(lpad('week', 5) + '| capsule dup rate | dup rate of Rare+ capsules | mean species owned (of 50) | capsules per alive player per week');
  for (let w = 0; w < r.wk.capsules.length; w++) console.log(`${lpad(w + 1, 5)}| ${pad(pc(r.wk.dupCapsules[w] / r.wk.capsules[w]), 16)} | ${pad(pc(r.wk.dupRP[w] / r.wk.capRP[w]), 26)} | ${pad(f1(r.wk.owned[w] / r.wk.alive[w]), 26)} | ${pad(f1(r.wk.capsules[w] / r.wk.alive[w]), 12)}`);
  console.log(`whole 60 days: capsule dup rate ${pc(dupRate(r))}  ("dup" = the capsule gave a species the player already held; capsules have NO dupe protection)`);
}

function secTriples(nm: Result): void {
  header(`E. HOW OFTEN DOES A PLAYER OWN 2 / 3 / 4 OF THE SAME SPECIES?  (control run, merging OFF so copies accumulate; alive players with >= 3 active days)`);
  console.log(lpad('tier', 10) + '| ' + nm.snaps.map((s) => `day ${pad(s.day, 2)}: >=2 >=3 >=4`).join(' | '));
  for (let t = 0; t < NT; t++) console.log(`${lpad(TIER_NAMES[t], 10)}| ${nm.snaps.map((s) => `${pad(pc0(s.ge2[t]), 11)} ${pad(pc0(s.ge3[t]), 3)} ${pad(pc0(s.ge4[t]), 3)}`).join(' | ')}`);
  console.log('(>=M+1 copies = M spares while keeping one on the shelf, what a careful player needs to merge; >=M is a reckless merge that gives up the last copy.)');
}

function secMerge(r: Result, ladder: Array<[string, Result]>): void {
  header(`F. MERGE (${r.P.mergeInputs} same -> 1 random): volume, outcome mix, feel-bad`);
  const all = r.players, mt = sum(all.map((p) => p.merges));
  console.log(`60-day run: merges per player mean ${f1(mean(all.map((p) => p.merges)))} median ${f1(median(all.map((p) => p.merges)))} p90 ${f1(quantile(all.map((p) => p.merges), 0.9))};  share who ever merge ${pc0(all.filter((p) => p.merges > 0).length / all.length)};  by type: ` + PLAYER_TYPES.map((n, t) => `${n} ${f1(mean(all.filter((p) => p.tier === t).map((p) => p.merges)))}`).join(' '));
  const mi = new Array(NT).fill(0), mo = new Array(NT).fill(0);
  for (const p of all) for (let t = 0; t < NT; t++) { mi[t] += p.inByTier[t]; mo[t] += p.outByTier[t]; }
  console.log(lpad('tier', 10) + '| merges fed with this tier | outcomes landing in this tier');
  for (let t = 0; t < NT; t++) console.log(`${lpad(TIER_NAMES[t], 10)}| ${pad(pc(mi[t] / mt), 25)} | ${pad(pc(mo[t] / mt), 20)}`);
  console.log('');
  console.log('Mitigation ladder (120 days, no churn, trade on; every row adds one rule to the row above). LIVE merge = something new was still reachable in the output tier or the one above.');
  console.log(lpad('merge rules', 62) + '| merges/pl | live share | LIVE: new species | LIVE: tier-up | LIVE feel-bad (repeat & no up) | ALL: repeat | longest dud streak p95 / max');
  for (const [name, v] of ladder) {
    const a = v.players, m = sum(a.map((p) => p.merges)), lm = sum(a.map((p) => p.liveMerges)), mergers = a.filter((p) => p.merges > 0);
    const ups = sum(a.map((p) => p.mergeUps));
    console.log(`${lpad(name, 62)}| ${pad(f1(m / a.length), 9)} | ${pad(pc0(lm / m), 10)} | ${pad(pc0(sum(a.map((p) => p.liveNew)) / lm), 17)} | ${pad(pc0(ups / m), 12)} | ${pad(pc0(sum(a.map((p) => p.liveBad)) / lm), 29)} | ${pad(pc0(sum(a.map((p) => p.mergeRepeats)) / m), 11)} | ${pad(quantile(mergers.map((p) => p.maxBad), 0.95), 3)} / ${Math.max(...a.map((p) => p.maxBad))}`);
  }
}

function secSupply(main: Result, nm: Result, bulk: Result): void {
  header('G. NET ITEM SUPPLY  (per alive player; 60 days, churn on). sources = capsules + restock; sink = merges (each destroys M, makes 1)');
  const M = main.P.mergeInputs;
  console.log(lpad('week', 5) + '| sources/pl | merge sink/pl (net) | sink/sources | mean items held: MERGE ON | merging OFF');
  for (let w = 0; w < main.wk.capsules.length; w++) {
    const al = main.wk.alive[w] || 1, an = nm.wk.alive[w] || 1;
    const src = (main.wk.capsules[w] + main.wk.restock[w]) / al, sink = (main.wk.mergeIn[w] - main.wk.merges[w]) / al;
    console.log(`${lpad(w + 1, 5)}| ${pad(f1(src), 10)} | ${pad(f1(sink), 19)} | ${pad(pc0(sink / src), 12)} | ${pad(f1(main.wk.hoard[w] / al), 24)} | ${f1(nm.wk.hoard[w] / an)}`);
  }
  console.log(`(net sink per merge = ${M - 1}; cohort includes players who left)`);
  console.log(`With a BULK / tidy-up merge button (merge-lovers merge up to ${main.P.bulkMax} spare pairs in one go; the daily merge cap is ${main.P.bulkMax}):`);
  console.log(lpad('week', 5) + '| merge sink/pl (net) | sink/sources | mean items held');
  for (let w = 0; w < bulk.wk.capsules.length; w++) { const al = bulk.wk.alive[w] || 1; const src = (bulk.wk.capsules[w] + bulk.wk.restock[w]) / al, sink = (bulk.wk.mergeIn[w] - bulk.wk.merges[w]) / al; console.log(`${lpad(w + 1, 5)}| ${pad(f1(sink), 19)} | ${pad(pc0(sink / src), 12)} | ${f1(bulk.wk.hoard[w] / al)}`); }
}

function secTrade(trade: Result, solo: Result): void {
  header('H. TRADING BEHAVIOUR  (60 days, churn on, receive-lock 1 day)');
  const all = trade.players, everT = all.filter((p) => p.trades > 0), a14 = all.filter((p) => p.activeDays >= 14);
  console.log(`players who completed >= 1 trade: ${pc0(everT.length / all.length)} of all, ${pc0(a14.filter((p) => p.trades > 0).length / a14.length)} of those with >= 14 active days (willing-to-trade flag: ${pc0(all.filter((p) => p.trader).length / all.length)} of all)`);
  console.log(`trades per trader: mean ${f1(mean(everT.map((p) => p.trades)))} median ${f1(median(everT.map((p) => p.trades)))};  completed trades per 1000 players per day: ${f1(sum(trade.wk.trades) / trade.P.days / (all.length / 1000))}`);
  const wt = (r: Result): Player[] => r.players.filter((p) => p.trader && p.alive);
  console.log(`willing traders still playing at day 60: species owned solo ${f1(mean(wt(solo).map((p) => p.owned)))} -> with trade ${f1(mean(wt(trade).map((p) => p.owned)))};  Epic+ held (of ${sum(trade.P.tierCount.slice(3))}): ${f1(mean(wt(solo).map(epicPlus)))} -> ${f1(mean(wt(trade).map(epicPlus)))}`);
  console.log('trades by week: ' + trade.wk.trades.join(' '));
}

function secLock(rows: Array<[string, Result]>): void {
  header('I. WHAT A RECEIVE-LOCK COSTS HONEST PLAYERS  (60 days, churn on, trade on; "1 day" = a received copy cannot be re-traded or merged until the next day)');
  console.log(lpad('lock', 18) + '| trades/1000pl/day | players who trade | species owned (willing traders alive d60) | Epic+ held');
  for (const [name, r] of rows) {
    const s = r.players.filter((p) => p.alive && p.trader);
    console.log(`${lpad(name, 18)}| ${pad(f1(sum(r.wk.trades) / r.P.days / (r.players.length / 1000)), 17)} | ${pad(pc0(r.players.filter((p) => p.trades > 0).length / r.players.length), 17)} | ${pad(f2(mean(s.map((p) => p.owned))), 41)} | ${f2(mean(s.map(epicPlus)))}`);
  }
}

function secAffinity(onS: Result, offS: Result, longs: Array<[string, Result, Result]>): void {
  header('J. AFFINITY A/B: tilting WHICH species drop inside a tier by how you play. Does it help trading, and is it fair?');
  console.log('J1. P(two random players have a feasible same-tier 1:1 swap), solo inventories (locks and willingness ignored)');
  console.log(lpad('pair class', 18) + '| ' + onS.snaps.map((s) => `day ${pad(s.day, 2)}: ON  OFF`).join(' | '));
  for (const k of ['all pairs', 'same style', 'different style', 'involves mixed']) {
    console.log(`${lpad(k, 18)}| ${onS.snaps.map((s, i) => { const a = s.pairs[k], b = offS.snaps[i].pairs[k]; return `${pad(pc0(a ? a[0] / a[1] : NaN), 9)} ${pad(pc0(b ? b[0] / b[1] : NaN), 4)}`; }).join(' | ')}`);
  }
  console.log('J2. outcomes, no churn, willing traders only (the players for whom trading is an option)');
  console.log(lpad('beta', 8) + '| ALL-50 by day ' + LONG + ': solo -> trade | Epic row: solo -> trade | slowest/fastest archetype, Epic row (trade world) | slowest/fastest, all-50 | trade speed-up (p50 day, solo/trade)');
  for (const [name, s, t] of longs) {
    const ws = s.players.filter((p) => p.trader), wt = t.players.filter((p) => p.trader);
    const spread = (r: Player[], key: (p: Player) => number): string => { const v = [0, 1, 2, 3].map((a) => quantile(r.filter((p) => p.arche === a).map((p) => (key(p) > 0 ? key(p) : 1e6)), 0.5)); return v.every((x) => x < 1e6) ? f2(Math.max(...v) / Math.min(...v)) + 'x' : 'n/a'; };
    const q = (r: Player[], k: (p: Player) => number): number => dayQn(r, k, 0.5);
    const ratio = q(ws, (p) => p.fullDay) >= 1e9 ? '>' + f2(q(ws, (p) => p.fullDay) / q(wt, (p) => p.fullDay)) : f2(q(ws, (p) => p.fullDay) / q(wt, (p) => p.fullDay));
    console.log(`${lpad(name, 8)}| ${pad(pc0(doneBy(ws, LONG, (p) => p.fullDay)), 19)} -> ${pad(pc0(doneBy(wt, LONG, (p) => p.fullDay)), 4)} | ${pad(pc0(doneBy(ws, LONG, (p) => p.rowDay[3])), 12)} -> ${pad(pc0(doneBy(wt, LONG, (p) => p.rowDay[3])), 4)} | ${pad(spread(wt, (p) => p.rowDay[3]), 48)} | ${pad(spread(wt, (p) => p.fullDay), 22)} | ${ratio}`);
  }
}

function secLong(solo: Result, trade: Result): void {
  header(`K. DAYS TO COMPLETE (no churn, ${LONG} days). "WILLING TRADERS" = players who would use trading; the same people are compared solo vs with trade`);
  const keys: Array<[string, (p: Player) => number]> = TIER_NAMES.map((n, t) => [`${n} row (${solo.P.tierCount[t]})`, (p: Player): number => p.rowDay[t]] as [string, (p: Player) => number]);
  keys.push([`ALL ${solo.cat.n}`, (p: Player): number => p.fullDay]);
  const nm = (t: number): string => (t < 0 ? 'ALL PLAYERS' : PLAYER_TYPES[t].toUpperCase());
  for (const [tier, tr] of [[1, true], [1, false], [0, true], [2, true], [-1, true]] as Array<[number, boolean]>) {
    const sel = (r: Result): Player[] => r.players.filter((p) => (tier < 0 || p.tier === tier) && p.trader === tr);
    if (tier === -1) { /* all players regardless of willingness */ }
    const get = (r: Result): Player[] => (tier === -1 ? r.players : sel(r));
    console.log(`-- ${nm(tier)} players, ${tier === -1 ? 'everyone' : tr ? 'willing to trade' : 'never trade'}${tier === 1 && tr ? '   <- the median player who trades' : ''}   (n=${get(solo).length})`);
    console.log(lpad('milestone', 20) + '| SOLO: p50 day  [p25 - p75]  done@D60 D120 D240 D' + LONG + ' | TRADE: p50 day  [p25 - p75]  done@D60 D120 D240 D' + LONG);
    for (const [name, key] of keys) {
      const c = (r: Result): string => { const s = get(r); return `${pad(medDay(s, key, LONG), 8)}  [${pad(dayQ(s, key, 0.25, LONG), 4)} - ${pad(dayQ(s, key, 0.75, LONG), 4)}]  ${pad(pc0(doneBy(s, 60, key)), 5)} ${pad(pc0(doneBy(s, 120, key)), 4)} ${pad(pc0(doneBy(s, 240, key)), 4)} ${pad(pc0(doneBy(s, LONG, key)), 4)}`; };
      console.log(`${lpad(name, 20)}| ${c(solo)} | ${c(trade)}`);
    }
  }
  console.log('first copy of ANY species of a tier, median day (all players), solo / trade: ' + TIER_NAMES.map((n, t) => `${n} ${f1(median(solo.players.filter((p) => p.firstTier[t] > 0).map((p) => p.firstTier[t])))}/${f1(median(trade.players.filter((p) => p.firstTier[t] > 0).map((p) => p.firstTier[t])))}`).join('   '));
  const reg = trade.players.filter((p) => p.tier === 1 && p.trader);
  const regS = solo.players.filter((p) => p.tier === 1 && p.trader);
  console.log('speed-up from trading, regular willing traders, all 50: ' + [0.25, 0.5, 0.75, 0.9].map((q) => { const a = dayQn(regS, (p) => p.fullDay, q), b = dayQn(reg, (p) => p.fullDay, q); return `p${q * 100}: ${a >= 1e9 ? '>' + LONG : Math.round(a)} -> ${Math.round(b)} days (x${f2(Math.min(a, LONG * 2) / b)})`; }).join('   '));
  const regMin = reg.filter((p) => p.fullDay > 0).map((p) => p.fullDay);
  console.log(`regular willing traders: median calendar day to all 50 with trade = ${medDay(reg, (p) => p.fullDay, LONG)} (solo ${medDay(regS, (p) => p.fullDay, LONG)}); active hours to get there ~ ${f1(median(reg.filter((p) => p.fullDay > 0).map((p) => p.fullMin / 60)))} with trade, ~ ${f1(median(regS.filter((p) => p.fullDay > 0).map((p) => p.fullMin / 60)))} solo  [finishers ${pc0(regMin.length / Math.max(1, reg.length))}]`);
}

function secRoutes(trade: Result, solo: Result): void {
  header('L. HOW DID EACH SPECIES FIRST ARRIVE?  Route of the FIRST copy, share by tier (no churn; willing traders; solo in brackets)');
  console.log(lpad('tier', 10) + '| capsule      restock      merge        trade        starter');
  const sh = (r: Result, t: number): number[] => { const c = [0, 0, 0, 0, 0, 0]; for (const p of r.players) if (p.trader) for (const s of r.cat.byTier[t]) if (p.firstDay[s] >= 0) c[p.via[s]]++; const z = sum(c) || 1; return c.map((x) => x / z); };
  for (let t = 0; t < NT; t++) { const a = sh(trade, t), b = sh(solo, t); console.log(`${lpad(TIER_NAMES[t], 10)}| ${[1, 2, 3, 4, 5].map((k) => pad(pc0(a[k]) + ' (' + pc0(b[k]) + ')', 12)).join(' ')}`); }
  const ep = (r: Result, via: number): number => { let c = 0, tt = 0; for (const p of r.players) if (p.trader) for (let s = 0; s < r.cat.n; s++) if (r.cat.tierOf[s] >= 3 && p.firstDay[s] >= 0) { tt++; if (p.via[s] === via) c++; } return c / Math.max(1, tt); };
  console.log(`Epic+ first copies, willing traders, with trading: via trade ${pc0(ep(trade, 4))}, via merge ${pc0(ep(trade, 3))}, via capsule ${pc0(ep(trade, 1))};  (solo world: via merge ${pc0(ep(solo, 3))}, via capsule ${pc0(ep(solo, 1))})`);
  const late = (r: Result): string => { let c = 0, tt = 0; for (const p of r.players) if (p.trader && p.fullDay > 0) for (let s = 0; s < r.cat.n; s++) if (r.cat.tierOf[s] >= 3 && p.firstDay[s] >= p.fullDay - 60) { tt++; if (p.via[s] === 4) c++; } return pc0(c / Math.max(1, tt)); };
  console.log(`...of the Epic+ species a finisher got in the last 60 days before finishing, share that came by trade: ${late(trade)}`);
  const last5 = (r: Result, tierMin: number): number[] => {
    const c = [0, 0, 0, 0, 0, 0]; let tt = 0;
    for (const p of r.players) if (p.trader && p.fullDay > 0) {
      const sp: Array<[number, number]> = [];
      for (let s = 0; s < r.cat.n; s++) if (r.cat.tierOf[s] >= tierMin && p.firstDay[s] >= 0) sp.push([p.firstDay[s], s]);
      sp.sort((a, b) => b[0] - a[0]);
      for (const [, s] of sp.slice(0, 5)) { c[p.via[s]]++; tt++; }
    }
    return c.map((x) => x / Math.max(1, tt));
  };
  for (const [nm, tm] of [['the LAST 5 species a finisher completed (any tier)', 0], ['the LAST 5 Epic+ species a finisher completed', 3]] as Array<[string, number]>) {
    const a = last5(trade, tm), b = last5(solo, tm);
    console.log(`${nm}: by capsule ${pc0(a[1])}, restock ${pc0(a[2])}, merge ${pc0(a[3])}, TRADE ${pc0(a[4])}   (solo world: capsule ${pc0(b[1])}, restock ${pc0(b[2])}, merge ${pc0(b[3])})`);
  }
}

function secExact(Ms: number[]): void {
  header('M. COST OF ONE SPECIFIC SPECIES: by drop, by merge only, by trade');
  const cat = REAL;
  const trials = QUICK ? 100 : 250;
  console.log(lpad('target tier', 12) + '| by DROP (capsules) | ' + Ms.map((m) => `MERGE-ONLY M=${m}: capsules med (mean)  merges med  x-drop`).join(' | '));
  for (let t = 0; t < NT; t++) {
    const per = BASE.tierOdds[t] / BASE.tierCount[t];
    const cap = t >= 4 ? 60000 : 25000;
    const tr = t >= 4 ? Math.round(trials / 2) : trials;
    const cells = Ms.map((m) => { const a = farmer({ ...BASE, mergeInputs: m }, cat, t, tr, cap); return `${pad(f1(a.capsulesMed) + ' (' + f1(a.capsulesMean) + ')', 22)}  ${pad(f1(a.mergesMed), 9)}  ${pad(f1(a.capsulesMean * per) + 'x', 7)}${a.finished < 0.9 ? ' [' + pc0(a.finished) + ' done]' : ''}`; });
    console.log(`${lpad(TIER_NAMES[t], 12)}| ${pad(f1(1 / per), 18)} | ${cells.join(' | ')}`);
  }
  console.log('by TRADE: one swap, paid with a spare of the same tier the player already holds (0 extra capsules) if a partner with the right spare exists (section L: how often that is how Epic+ species arrived).');
}

function secRing(): void {
  header(`N. MERGE-THEN-TRADE LAUNDERING TOY MODEL (M=${BASE.mergeInputs}): extra copies minted / merge outputs ("laundered") / innocent accounts holding tainted items at detection`);
  const pols: Policy[] = [
    { name: 'no limits', lockH: 0, capPerDay: 1e9, pairPerDay: 1e9 },
    { name: 'receive/merge lock 24h only', lockH: 24, capPerDay: 1e9, pairPerDay: 1e9 },
    { name: 'daily cap 5 + pair 1/day', lockH: 0, capPerDay: 5, pairPerDay: 1 },
    { name: 'lock 24h + cap 5 + pair 1', lockH: 24, capPerDay: 5, pairPerDay: 1 },
  ];
  console.log(lpad('policy', 30) + '| DUPE BUG, detected at 6h | DUPE BUG, at 24h        | STOLEN 20 items, at 6h   | STOLEN, at 24h');
  for (const pol of pols) {
    const c = (o: RingOut): string => `${o.copies >= 299990 ? '>300k' : o.copies}/${o.launder}/${o.innocents}`;
    console.log(`${lpad(pol.name, 30)}| ${pad(c(ring(BASE, pol, 'dupe', 6)), 24)} | ${pad(c(ring(BASE, pol, 'dupe', 24)), 23)} | ${pad(c(ring(BASE, pol, 'steal', 6)), 24)} | ${c(ring(BASE, pol, 'steal', 24))}`);
  }
}

/* ───────────────────────────── main ───────────────────────────── */

function main(): void {
init();
const t0 = process.hrtime.bigint();
console.log(`WOBBLEHOARD economy sim v4 (real game logic)  players=${BASE.nPlayers} short=${BASE.days}d long=${LONG}d seed=0x${BASE.seed.toString(16)} MERGE_COST=${BASE.mergeInputs}${QUICK ? '  (--quick)' : ''}`);
console.log(`population (ASSUMED): archetypes poker/squeezer/puller/mixed ${BASE.archeShare.join('/')}; player types casual/regular/devoted ${BASE.tierShare.join('/')}; active-day chance ${BASE.pActive.join('/')}; daily churn ${BASE.churn.join('/')};`);
console.log(`  willing traders ${BASE.traderProb.join('/')}; use public board ${BASE.boardProb}; friend homophily ${BASE.friendHomophily}; merge appetite 0/0.15/0.5 per day for ${BASE.mergeLoveMix.join('/')}; ${pc0(BASE.keepOneShare)} always keep one copy; ${pc0(BASE.playfulShare)} merge even complete rows`);
const cat0 = REAL;
secMicro();
secCatalog(cat0);
if (argv.includes('--micro')) process.exit(0);
const pop = makePop(BASE);
const S = (o: Partial<Params>, label: string, p: Pop = pop): Result => runScenario({ ...BASE, ...o }, p, label);

// 60-day cohort (churn on)
const mTrade = S({ trade: true }, 'm trade');
if (want('first')) secFirstHour(mTrade);
if (want('income')) secIncome(mTrade);
const mNoMerge = S({ trade: false, merge: false }, 'm nomerge');
if (want('income')) secTriples(mNoMerge);
const mSolo = S({ trade: false }, 'm solo');
const popL = makePop({ ...BASE, nPlayers: Math.min(BASE.nPlayers, 3000) });
const L = (o: Partial<Params>, label: string): Result => runScenario({ ...BASE, nPlayers: Math.min(BASE.nPlayers, 3000), days: 120, churn: [0, 0, 0], trade: true, snapshotDays: [], ...o }, popL, label);
if (want('merge')) {
  const rules = (name: string, o: Partial<Params>): [string, Result] => [name, L(o, name)];
  secMerge(mTrade, [
    rules('A. floor only (never below the inputs, no tier-up)', { pUp: [0, 0, 0, 0, 0, 0], unownedW: 1, pityUp: 0, rowDoneBoost: 1 }),
    rules('B. + tier-up chance 30/25/20/15/10', { unownedW: 1, pityUp: 0, rowDoneBoost: 1 }),
    rules('C. + unowned species weighted x1.5', { pityUp: 0, rowDoneBoost: 1 }),
    rules('D. + tier-up pity (after 4 dud merges in a row from a tier, the next tiers up)', { rowDoneBoost: 1 }),
    rules('E. + completed-row boost x2 on tier-up (capped at 60%)', { rowDoneBoost: 2, rowDoneCap: 0.6 }),
    rules('F. a COMPLETED row always tiers up  [CHOSEN = the real rules in src/core/merge.ts]', {}),
  ]);
}
if (want('supply')) secSupply(mTrade, mNoMerge, S({ trade: true, bulkMerge: true }, 'm bulk'));
if (want('trade')) secTrade(mTrade, mSolo);
if (want('lock')) secLock([['no lock (0 days)', S({ trade: true, lockDays: 0, mergeLockDays: 0 }, 'L0')], ['1 day (chosen)', mTrade], ['3 days', S({ trade: true, lockDays: 3, mergeLockDays: 3 }, 'L3')]]);

// long no-churn runs
const LS = (o: Partial<Params>, label: string, trade: boolean): Result => S({ trade, days: LONG, churn: [0, 0, 0], snapshotDays: [], ...o }, label);
const needLong = want('affinity') || want('long');
const lSolo = needLong ? LS({}, 'long solo', false) : (null as unknown as Result), lTrade = needLong ? LS({}, 'long trade', true) : (null as unknown as Result);
if (want('affinity')) {
  const longs: Array<[string, Result, Result]> = [];
  for (const b of [0, 2, 4]) { if (b === BASE.beta && longs.some((x) => x[0] === String(b))) continue; longs.push([String(b), b === BASE.beta ? lSolo : LS({ beta: b }, 'b' + b + ' solo', false), b === BASE.beta ? lTrade : LS({ beta: b }, 'b' + b + ' trade', true)]); }
  secAffinity(S({ trade: false, beta: 2 }, 'm solo b2'), mSolo, longs);
}
if (want('long')) { secLong(lSolo, lTrade); secRoutes(lTrade, lSolo); }
if (want('exact')) secExact([2, 3]);
if (want('ring')) secRing();

// the (meter, M) pair: side by side
if (want('pair')) {
  header(`O. THE PAIR (meter speed, merge cost): ${Math.min(BASE.nPlayers, 3000)} players, ${LONG} days, no churn. Metrics for the REGULAR player who is willing to trade unless noted`);
  const popP = makePop({ ...BASE, nPlayers: Math.min(BASE.nPlayers, 3000) });
  const combos: Array<[string, Partial<Params>]> = [];
  for (const cost of [BASE.capsuleCost, Math.round(BASE.capsuleCost * 0.4)]) for (const m of [2, 3]) combos.push([`cost ${cost} SP (~${f1(cost / mean(MICRO.spPerMin.slice(0, 3)))} min/capsule) M=${m}`, { capsuleCost: cost, mergeInputs: m }]);
  const rowsP: string[][] = [];
  const res = combos.map(([name, o]) => { const s = runScenario({ ...BASE, nPlayers: popP.n, days: LONG, churn: [0, 0, 0], snapshotDays: [], trade: false, ...o }, popP, name + ' solo'); const t = runScenario({ ...BASE, nPlayers: popP.n, days: LONG, churn: [0, 0, 0], snapshotDays: [], trade: true, ...o }, popP, name + ' trade'); return { name, o, s, t }; });
  const regT = (r: Result): Player[] => r.players.filter((p) => p.tier === 1 && p.trader);
  const regAll = (r: Result): Player[] => r.players.filter((p) => p.tier === 1);
  const metrics: Array<[string, (c: typeof res[number]) => string]> = [
    ['active min per capsule (regular, measured)', (c) => f1(median(regAll(c.t).map((p) => (p.capsules > 0 ? p.minutes / p.capsules : NaN)).filter((x) => Number.isFinite(x))))],
    ['1st capsule (s)', (c) => f1(median(regAll(c.t).map((p) => p.firstCapMin * 60)))],
    ['min to 1st MERGEABLE set (M of a kind), median', (c) => f1(median(regAll(c.t).filter((p) => (c.o.mergeInputs === 2 ? p.pairMin : p.tripMin) >= 0).map((p) => (c.o.mergeInputs === 2 ? p.pairMin : p.tripMin))))],
    ['  share with a mergeable set by 25 active min', (c) => pc0(regAll(c.t).filter((p) => { const x = c.o.mergeInputs === 2 ? p.pairMin : p.tripMin; return x >= 0 && x <= 25; }).length / regAll(c.t).length)],
    ['  share with it by 12 active min (1st session)', (c) => pc0(regAll(c.t).filter((p) => { const x = c.o.mergeInputs === 2 ? p.pairMin : p.tripMin; return x >= 0 && x <= 12; }).length / regAll(c.t).length)],
    ['all-50 p50 day: solo', (c) => medDay(regT(c.s), (p) => p.fullDay, LONG)],
    ['all-50 p50 day: with trade', (c) => medDay(regT(c.t), (p) => p.fullDay, LONG)],
    ['all-50 done by end: solo -> trade', (c) => `${pc0(doneBy(regT(c.s), LONG, (p) => p.fullDay))} -> ${pc0(doneBy(regT(c.t), LONG, (p) => p.fullDay))}`],
    ['Epic row p50 day: solo / trade', (c) => `${medDay(regT(c.s), (p) => p.rowDay[3], LONG)} / ${medDay(regT(c.t), (p) => p.rowDay[3], LONG)}`],
    ['solo/trade time ratio at p50 (Epic row)', (c) => { const a = dayQn(regT(c.s), (p) => p.rowDay[3], 0.5), b = dayQn(regT(c.t), (p) => p.rowDay[3], 0.5); return (a >= 1e9 ? '>' : '') + f2(Math.min(a, LONG * 3) / b) + 'x'; }],
    ['solo/trade time ratio at p50 (all 50)', (c) => { const a = dayQn(regT(c.s), (p) => p.fullDay, 0.5), b = dayQn(regT(c.t), (p) => p.fullDay, 0.5); return b >= 1e9 ? 'n/a' : (a >= 1e9 ? '>' : '') + f2(Math.min(a, LONG * 3) / b) + 'x'; }],
    ['Epic+ first copies that came by trade', (c) => { let n = 0, tt = 0; for (const p of c.t.players) if (p.trader) for (let s = 0; s < c.t.cat.n; s++) if (c.t.cat.tierOf[s] >= 3 && p.firstDay[s] >= 0) { tt++; if (p.via[s] === 4) n++; } return pc0(n / Math.max(1, tt)); }],
    ['Epic+ first copies that came by merge', (c) => { let n = 0, tt = 0; for (const p of c.t.players) if (p.trader) for (let s = 0; s < c.t.cat.n; s++) if (c.t.cat.tierOf[s] >= 3 && p.firstDay[s] >= 0) { tt++; if (p.via[s] === 3) n++; } return pc0(n / Math.max(1, tt)); }],
    ['merges per player per 100 days (regular)', (c) => f1(mean(regAll(c.t).map((p) => (p.merges / LONG) * 100)))],
    ['LIVE merges: returned a NEW species', (c) => pc0(sum(c.t.players.map((p) => p.liveNew)) / Math.max(1, sum(c.t.players.map((p) => p.liveMerges))))],
    ['LIVE merges: FEEL-BAD (repeat & no tier-up)', (c) => pc0(sum(c.t.players.map((p) => p.liveBad)) / Math.max(1, sum(c.t.players.map((p) => p.liveMerges))))],
    ['merges: tier-up share (all)', (c) => pc0(sum(c.t.players.map((p) => p.mergeUps)) / Math.max(1, sum(c.t.players.map((p) => p.merges))))],
    ['capsule dup rate (first 60d / whole run)', (c) => { const a = c.t.wk.dupCapsules.slice(0, 9), b = c.t.wk.capsules.slice(0, 9); return `${pc0(sum(a) / sum(b))} / ${pc0(dupRate(c.t))}`; }],
  ];
  console.log(lpad('metric', 52) + '| ' + res.map((c) => pad(c.name.replace(' SP', '').replace('~', ''), 34)).join(' | '));
  for (const [name, f] of metrics) console.log(`${lpad(name, 52)}| ${res.map((c) => pad(f(c), 34)).join(' | ')}`);
  void rowsP;
}

// sensitivity: speed 0.5x / 2x, behaviours, catalog
if (want('sens')) {
  header(`P. SENSITIVITY (${Math.min(BASE.nPlayers, 2000)} players, ${LONG} days, no churn; regular willing traders; M=${BASE.mergeInputs}, cost ${BASE.capsuleCost})`);
  const sensN = Math.min(BASE.nPlayers, 2000);
  const rows: Array<[string, Partial<Params>, Partial<Params> | undefined]> = [
    ['BASE', {}, undefined],
    ['players 2x SLOWER at earning (SP/min x0.5)', { speedScale: 0.5 }, undefined],
    ['players 2x FASTER at earning (SP/min x2)', { speedScale: 2 }, undefined],
    ['half the play time (pActive x0.5)', {}, { pActive: BASE.pActive.map((x) => x * 0.5) }],
    ['balanced styles 25/25/25/25', {}, { archeShare: [0.25, 0.25, 0.25, 0.25] }],
    ['25% of players rotate styles on purpose', {}, { adaptiveShare: 0.25 }],
    ['affinity off (beta 0)', { beta: 0 }, undefined],
    ['no daily restock', { restock: false }, undefined],
    ['half as many willing traders', {}, { traderProb: BASE.traderProb.map((x) => x / 2) }],
    ['no friends, public board only', {}, { friendHomophily: 0, boardProb: 1 }],
    ['ORACLE trade: everyone willing, no friction, cap 20', { tryProb: 1, acceptProb: 1, dailyTradeCap: 20, boardSample: 200 }, { traderProb: [1, 1, 1], boardProb: 1 }],
    ['favour swaps off (both sides must gain a new species)', { favorProb: 0 }, undefined],
    ['favour swaps always accepted', { favorProb: 1 }, undefined],
    ['merging switched off entirely', { merge: false }, undefined],
    ['BULK merge for merge-lovers (tidy-up, cap 10/day)', { bulkMerge: true }, undefined],
    ['BULK merge uncapped (40/day)', { bulkMerge: true, bulkMax: 40 }, undefined],
    ['merge: no unowned weight, no row boost, no pity', { unownedW: 1, rowDoneBoost: 1, pityUp: 0 }, undefined],
    ['merge cost 3 instead of 2', { mergeInputs: 3 }, undefined],
    ['merge tier-up x2', { pUp: BASE.pUp.map((x) => x * 2) }, undefined],
  ];
  console.log(lpad('variant', 46) + '| min/capsule | all-50 done solo -> trade | all-50 p50 day solo / trade | Epic row done solo -> trade | capsule dup | players who trade');
  for (const [name, o, popO] of rows) {
    const pp = makePop({ ...BASE, nPlayers: sensN, ...(popO ?? {}) });
    const common = { nPlayers: sensN, days: LONG, churn: [0, 0, 0], snapshotDays: [] as number[], ...(popO ?? {}), ...o };
    const s = runScenario({ ...BASE, ...common, trade: false }, pp, name), t = runScenario({ ...BASE, ...common, trade: true }, pp, name);
    const reg = (r: Result): Player[] => r.players.filter((p) => p.tier === 1 && p.trader);
    const mpc = median(t.players.filter((p) => p.tier === 1 && p.capsules > 0).map((p) => p.minutes / p.capsules));
    console.log(`${lpad(name, 46)}| ${pad(f1(mpc), 11)} | ${pad(pc0(doneBy(reg(s), LONG, (p) => p.fullDay)) + ' -> ' + pc0(doneBy(reg(t), LONG, (p) => p.fullDay)), 25)} | ${pad(medDay(reg(s), (p) => p.fullDay, LONG) + ' / ' + medDay(reg(t), (p) => p.fullDay, LONG), 27)} | ${pad(pc0(doneBy(reg(s), LONG, (p) => p.rowDay[3])) + ' -> ' + pc0(doneBy(reg(t), LONG, (p) => p.rowDay[3])), 27)} | ${pad(pc0(dupRate(t)), 11)} | ${pc0(t.players.filter((p) => p.trades > 0).length / t.players.length)}`);
  }
}

if (want('catalog')) {
  header(`Q. CATALOG SWEEP: how tier counts and odds shape time-to-complete (${Math.min(BASE.nPlayers, 2000)} players, ${LONG} days, no churn, regular willing traders)`);
  const sensN = Math.min(BASE.nPlayers, 2000);
  const pp = makePop({ ...BASE, nPlayers: sensN });
  const cands: Array<[string, number[], number[]]> = [
    ['CHOSEN 14/11/10/7/5/3 odds 76.3/13/6/2.8/1.4/.5', [14, 11, 10, 7, 5, 3], [0.763, 0.13, 0.06, 0.028, 0.014, 0.005]],
    ['16/12/10/6/4/2  odds 50/25/14/7/3/1 (first guess)', [16, 12, 10, 6, 4, 2], [0.50, 0.25, 0.14, 0.07, 0.03, 0.01]],
    ['14/11/10/7/5/3  odds 68/18/8/3.5/1.7/.8 (richer top)', [14, 11, 10, 7, 5, 3], [0.68, 0.18, 0.08, 0.035, 0.017, 0.008]],
    ['14/11/10/7/5/3  odds 80/11/5/2.4/1.2/.4 (poorer top)', [14, 11, 10, 7, 5, 3], [0.80, 0.11, 0.05, 0.024, 0.012, 0.004]],
    ['13/11/10/8/5/3  odds 78/12/5.5/2.5/1.4/.6', [13, 11, 10, 8, 5, 3], [0.78, 0.12, 0.055, 0.025, 0.014, 0.006]],
    ['12/10/10/8/6/4  odds 76/13/6/2.8/1.5/.7', [12, 10, 10, 8, 6, 4], [0.76, 0.13, 0.06, 0.028, 0.015, 0.007]],
  ];
  console.log(lpad('catalog', 54) + '| all-50 done solo -> trade | p50 day solo / trade | Epic row p50 solo / trade | Mythic row p50 solo/trade | 1st Rare/Epic/Leg/Mythic median day');
  for (const [name, counts, odds] of cands) {
    const common = { nPlayers: sensN, days: LONG, churn: [0, 0, 0], snapshotDays: [] as number[], tierCount: counts, tierOdds: odds };
    const s = runScenario({ ...BASE, ...common, trade: false }, pp, name), t = runScenario({ ...BASE, ...common, trade: true }, pp, name);
    const reg = (r: Result): Player[] => r.players.filter((p) => p.tier === 1 && p.trader);
    const two = (k: (p: Player) => number): string => `${medDay(reg(s), k, LONG)} / ${medDay(reg(t), k, LONG)}`;
    const ft = [2, 3, 4, 5].map((q) => f1(median(s.players.filter((p) => p.tier === 1 && p.firstTier[q] > 0).map((p) => p.firstTier[q])))).join('/');
    console.log(`${lpad(name, 54)}| ${pad(pc0(doneBy(reg(s), LONG, (p) => p.fullDay)) + ' -> ' + pc0(doneBy(reg(t), LONG, (p) => p.fullDay)), 25)} | ${pad(two((p) => p.fullDay), 20)} | ${pad(two((p) => p.rowDay[3]), 25)} | ${pad(two((p) => p.rowDay[5]), 25)} | ${ft}`);
  }
}

console.log(`\n(elapsed ${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1)} s)`);
}

if (import.meta.main) main();
