// BLOCKTOOTH v2 — goals, unlocks and the profile ledger (FEATURES_V2 §8). APP-PURE: DOM-free and
// storage-free (the app loads/saves through core/save.ts). Lane L5 (META/ENDLESS-SIM).
//
// Model (§8.1): a goal is RUN-scope (met inside one run, from the live RunTally + RunCtx) or LIFE-scope
// (lifetime profile counters, updated at run end by applyRunToProfile). Unlocks take effect NEXT run
// (runMetaFor builds the RunMeta from p.done).
//
// App flow (game.ts, L0 pre-wire):
//   * 1 Hz in play: ids = evalGoals(profile, w.tally, ctx) → the app stamps profile.done[id] and toasts.
//     evalGoals itself queues each newly met goal's card unlocks in profile.newUnlocks (the NEW ribbon) —
//     the only write it makes, and idempotent — because the app stamps `done` itself and nothing else
//     would ever queue the ribbon for a goal met live.
//   * run end (beginEnding, once per result): {profile, newly} = applyRunToProfile(profile, w, result).
//     EXTENDED COVERAGE files the same World twice (the clear, then the death after KEEP GOING): a
//     module-level WeakMap remembers what each World has already filed, so the run is counted once, the
//     clear once, and only the banish / evolution / boss-kill deltas since the last filing are added.
//     Applying the same World again is a no-op on every counter (idempotent: f(f(p)) = f(p)).
//
// Progress values (goalProgress): the number shown as x in "x / y" — for tier4CollapseFrac it is the
// FRACTION (goalParts gives the §8.2 display `x / ceil(0.6 × tier4Total)` when a tally is at hand); for
// lowerIsBetter (fastClearS) it is the best clear time in seconds, 0 = none on file.

import type { BiomeId, GoalDef, PerkId, Profile, RunCtx, RunMeta, RunTally, TitanId, UnlockRef, World } from '../core/types.ts';
import { GOALS } from '../data/goals.ts';
import { PERKS_DEF } from '../data/perks.ts';
import { TITAN_PALETTES } from '../data/palettes.ts';
import { TITANS } from '../data/titans.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { cloneProfile } from './profile.ts';
import { tallyV2 } from './tally.ts';

// ─────────────────────────────── metrics ───────────────────────────────
function sumRec(r: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const k in r) { const v = r[k]; if (Number.isFinite(v)) n += v; }
  return n;
}

/** does this run (ctx) count for a run-scope goal's titan / biome filter? */
function runMatches(g: GoalDef, ctx: RunCtx): boolean {
  if (g.titan && g.titan !== ctx.titan) return false;
  if (g.biome && g.biome !== ctx.biome) return false;
  return true;
}

/** LIFE-scope value from the profile alone. */
function lifeValue(g: GoalDef, p: Profile): number {
  const L = p.life;
  switch (g.metric) {
    case 'runsFinished': return L.runs;
    case 'clears': return L.clears;
    case 'biomesCleared': {
      const s = new Set<BiomeId>();
      for (const t in L.clearedBy) for (const b of L.clearedBy[t as TitanId]) s.add(b);
      return s.size;
    }
    case 'banishesLife': return L.banishes;
    case 'evolutionsLife': return L.evolutions;
    case 'titanClears':
    case 'titanBiomesCleared': return g.titan ? L.clearedBy[g.titan].length : 0;
    case 'bossKillsLife': return g.boss ? (L.bossKills[g.boss] ?? 0) : sumRec(L.bossKills as Record<string, number>);
    default: return 0;
  }
}

/** RUN-scope value of THIS run (0 when the run does not match the goal's filters). */
function runValue(g: GoalDef, t: RunTally, ctx: RunCtx): number {
  if (!runMatches(g, ctx)) return 0;
  const x = tallyV2(t);
  switch (g.metric) {
    case 'peakRank': return x.peakRank;
    case 'kills': return x.kills;
    case 'cleanClear': return ctx.result === 'clear' && x.hpLowFrac >= 0.25 ? 1 : 0;
    case 'ults': return x.ults;
    case 'blocks': return x.blocks;
    case 'endlessS': return x.endlessS;
    case 'bossesInRun': return x.bossesDefeated;
    case 'powerups': return sumRec(x.powerups);
    case 'objectives': return sumRec(x.objectives);
    case 'vacuumBest': return x.vacuumBest;
    case 'crushed': return x.crushed;
    case 'wiresBest': return x.wiresBest;
    case 'hookKillsBest': return x.hookKillsBest;
    case 'fullVents': return x.fullVents;
    case 'bloomsBest': return x.bloomsBest;
    case 'healed': return x.healed;
    case 'props': return x.props;
    case 'overloadSites': return x.objectives.overloadSite ?? 0;
    case 'tier4CollapseFrac': return x.tier4Total > 0 ? x.collapsesByTier[4] / x.tier4Total : 0;
    case 'staggersBestFight': return g.boss ? (x.staggersBestFightBy[g.boss] ?? 0) : 0;
    case 'boats': return x.propsBy.boat ?? 0;
    case 'fastClearS': return ctx.result === 'clear' && ctx.endT > 0 ? ctx.endT : 0;
    default: return 0;
  }
}

/** is `value` a completion of `g`? (lowerIsBetter: a recorded value strictly under the target) */
export function goalMet(g: GoalDef, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (g.lowerIsBetter) return value > 0 && value < g.target;
  return value >= g.target - 1e-9;
}

/** 0..1 progress fraction (lowerIsBetter: target / best, 0 with no record). */
export function goalFrac(g: GoalDef, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (g.lowerIsBetter) return value < g.target ? 1 : Math.min(1, g.target / value);
  return g.target > 0 ? Math.min(1, value / g.target) : 1;
}

/** better of two progress values for a goal (0 = no value). */
function better(g: GoalDef, a: number, b: number): number {
  if (!(a > 0)) return b > 0 ? b : 0;
  if (!(b > 0)) return a;
  return g.lowerIsBetter ? Math.min(a, b) : Math.max(a, b);
}

/**
 * The progress value shown for a goal: life goals read the profile; run goals the best on file
 * (p.best), improved by this run when a tally + ctx are given. A goal on file as done reports at
 * least its target (lower-is-better: at most).
 */
export function goalProgress(g: GoalDef, p: Profile, t: RunTally | null, ctx: RunCtx | null): number {
  let v: number;
  if (g.scope === 'life') v = lifeValue(g, p);
  else {
    v = p.best[g.id] ?? 0;
    if (t && ctx) v = better(g, v, runValue(g, t, ctx));
  }
  if (p.done[g.id] !== undefined && !goalMet(g, v)) v = g.lowerIsBetter ? (v > 0 ? Math.min(v, g.target) : g.target) : Math.max(v, g.target);
  return v;
}

/**
 * Display parts for "x / y" (§8.2): tier4CollapseFrac → {x: tier-4 collapses, y: ceil(0.6 × tier4Total)}
 * when a WHITE STACKS tally is at hand, otherwise a percentage; every other metric → {x: value, y: target}.
 */
export function goalParts(g: GoalDef, p: Profile, t: RunTally | null, ctx: RunCtx | null): { x: number; y: number } {
  const v = goalProgress(g, p, t, ctx);
  if (g.metric === 'tier4CollapseFrac') {
    if (t && ctx && runMatches(g, ctx) && t.tier4Total > 0) return { x: t.collapsesByTier[4], y: Math.ceil(g.target * t.tier4Total) };
    return { x: Math.round(100 * v), y: Math.round(100 * g.target) };
  }
  // peakRank is a 0-based rank index (0 = SIZE I): shown as the Size number, so "Reach SIZE III" at
  // SIZE II reads 2 / 3, not 1 / 2 (F4 critic fix)
  if (g.metric === 'peakRank') return { x: Math.floor(v) + 1, y: g.target + 1 };
  return { x: g.lowerIsBetter ? v : Math.floor(v), y: g.target };
}

// ─────────────────────────────── unlocks ───────────────────────────────
function cardUnlocks(g: GoalDef): string[] {
  const out: string[] = [];
  for (const u of g.unlocks) if (u.kind === 'card') out.push(u.id);
  return out;
}

function queueNew(p: Profile, g: GoalDef): void {
  for (const id of cardUnlocks(g)) if (!p.newUnlocks.includes(id)) p.newUnlocks.push(id);
}

/**
 * Run-scope goals newly met (live), in GOALS order. Side effect (documented, idempotent): queues each
 * one's card unlocks in p.newUnlocks. The caller stamps p.done and saves.
 */
export function evalGoals(p: Profile, t: RunTally, ctx: RunCtx): string[] {
  const out: string[] = [];
  if (!t || !ctx) return out;
  for (const g of GOALS) {
    if (g.scope !== 'run' || p.done[g.id] !== undefined) continue;
    if (!goalMet(g, runValue(g, t, ctx))) continue;
    out.push(g.id);
    queueNew(p, g);
  }
  return out;
}

/** what one World has already filed into a profile (EXTENDED COVERAGE files a run twice) */
interface Filed { run: boolean; clear: boolean; banishes: number; evolutions: number; boss: Record<string, number> }
const FILED = new WeakMap<World, Filed>();

/**
 * Run end: life counters (runs, clears, clearedBy, banishes, evolutions, bossKills), run-goal bests, and
 * every goal (run or life) newly met → done + newUnlocks. Returns a NEW profile (the input is untouched)
 * and the ids newly met here (goals the app already stamped live are not repeated).
 */
export function applyRunToProfile(p: Profile, w: World, result: 'clear' | 'dead'): { profile: Profile; newly: string[] } {
  const q = cloneProfile(p);
  const t = w.tally;
  let f = FILED.get(w);
  if (!f) { f = { run: false, clear: false, banishes: 0, evolutions: 0, boss: {} }; FILED.set(w, f); }

  if (!f.run) { q.life.runs++; f.run = true; }
  if (result === 'clear' && !f.clear) {
    q.life.clears++;
    f.clear = true;
    const list = q.life.clearedBy[w.titanId];
    if (!list.includes(w.biomeId)) { list.push(w.biomeId); list.sort(); }
  }
  const db = Math.max(0, t.banishes - f.banishes);
  q.life.banishes += db; f.banishes += db;
  const de = Math.max(0, t.evolutions - f.evolutions);
  q.life.evolutions += de; f.evolutions += de;
  for (const id in t.bossDefeatedBy) {
    const n = t.bossDefeatedBy[id as keyof typeof t.bossDefeatedBy] ?? 0;
    const d = Math.max(0, n - (f.boss[id] ?? 0));
    if (d > 0) {
      const k = id as keyof typeof q.life.bossKills;
      q.life.bossKills[k] = (q.life.bossKills[k] ?? 0) + d;
      f.boss[id] = n;
    }
  }

  const ctx: RunCtx = { titan: w.titanId, biome: w.biomeId, result, endT: w.run.endT };
  const now = Date.now();
  const newly: string[] = [];
  for (const g of GOALS) {
    if (g.scope === 'run') {
      const v = runValue(g, t, ctx);
      const b = better(g, q.best[g.id] ?? 0, v);
      if (b > 0) q.best[g.id] = b;
    }
    if (q.done[g.id] !== undefined) continue;
    const v = g.scope === 'life' ? lifeValue(g, q) : (q.best[g.id] ?? 0);
    if (!goalMet(g, v)) continue;
    q.done[g.id] = now;
    queueNew(q, g);
    newly.push(g.id);
  }
  return { profile: q, newly };
}

/** sorted card ids (locked cards + locked evolutions) this profile has unlocked. */
export function unlockedIds(p: Profile): string[] {
  const set = new Set<string>();
  for (const g of GOALS) if (p.done[g.id] !== undefined) for (const id of cardUnlocks(g)) set.add(id);
  return [...set].sort();
}

/** is this perk unlocked by a filed goal? */
export function perkUnlocked(p: Profile, perk: PerkId): boolean {
  for (const g of GOALS) {
    if (p.done[g.id] === undefined) continue;
    for (const u of g.unlocks) if (u.kind === 'perk' && u.id === perk) return true;
  }
  return false;
}

/** is palette `index` (1..2) of this titan unlocked? (0, the canonical colours, always is) */
export function paletteUnlocked(p: Profile, titan: TitanId, index: number): boolean {
  if (index === 0) return true;
  for (const g of GOALS) {
    if (p.done[g.id] === undefined) continue;
    for (const u of g.unlocks) if (u.kind === 'palette' && u.titan === titan && u.index === index) return true;
  }
  return false;
}

/** The RunMeta for a run: unlocked cards; the perk and palette only when the profile has unlocked them. */
export function runMetaFor(p: Profile, titan: TitanId, perk: PerkId | null, palette: number): RunMeta {
  const pal = Number.isFinite(palette) ? Math.max(0, Math.min(2, Math.round(palette))) : 0;
  return {
    unlocked: unlockedIds(p),
    perk: perk && PERKS_DEF[perk] && perkUnlocked(p, perk) ? perk : null,
    palette: paletteUnlocked(p, titan, pal) ? pal : 0,
    reviveUsed: false,
  };
}

/** is a goal shown for this titan / city? (general goals always; others only for their titan / biome) */
function relevant(g: GoalDef, titan: TitanId, biome: BiomeId | null): boolean {
  if (g.titan) return g.titan === titan;
  if (g.biome) return biome !== null && g.biome === biome;
  return true;
}

/**
 * The goal closest to done (NEXT PERMIT PENDING, §8.4): incomplete goals that are general or match the
 * titan (and biome, when given), ranked by progress fraction, ties by list order. When every relevant
 * goal is filed, the closest of all remaining goals; null only when all 40 are filed.
 */
export function nextUnlock(p: Profile, titan: TitanId, biome: BiomeId | null): { goal: GoalDef; value: number } | null {
  let best: { goal: GoalDef; value: number } | null = null, bestF = -1;
  let any: { goal: GoalDef; value: number } | null = null, anyF = -1;
  for (const g of GOALS) {
    if (p.done[g.id] !== undefined) continue;
    const v = goalProgress(g, p, null, null);
    const f = goalFrac(g, v);
    if (f > anyF) { anyF = f; any = { goal: g, value: v }; }
    if (relevant(g, titan, biome) && f > bestF) { bestF = f; best = { goal: g, value: v }; }
  }
  return best ?? any;
}

/** Player-facing name of an unlock: the card / evolution name, the perk name, or "TIDEPOOL (MOLO palette)". */
export function unlockLabel(u: UnlockRef): string {
  if (u.kind === 'card') { const d = UPGRADE_BY_ID[u.id]; return d ? d.name : u.id; }
  if (u.kind === 'perk') { const d = PERKS_DEF[u.id]; return d ? d.name : u.id; }
  const pal = TITAN_PALETTES[u.titan] ? TITAN_PALETTES[u.titan][u.index - 1] : undefined;
  const tn = TITANS[u.titan] ? TITANS[u.titan].name : u.titan;
  return (pal ? pal.name : 'PALETTE ' + u.index) + ' (' + tn + ' palette)';
}

/** removes `ids` from p.newUnlocks (returns a new Profile; the caller saves). */
export function markSeen(p: Profile, ids: readonly string[]): Profile {
  const q = cloneProfile(p);
  if (ids.length) q.newUnlocks = q.newUnlocks.filter((id) => !ids.includes(id));
  return q;
}
