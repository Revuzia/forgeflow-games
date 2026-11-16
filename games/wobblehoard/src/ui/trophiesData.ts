// The numbers and words behind the Trophies and Records screens (UI.md 6, B6b). PURE: no DOM, no storage, no clock; the screen (later-trophies.ts) draws what this returns, and
// _harness/probe_trophies.ts checks it against the real evaluator and a real Collection.
//
// ONLY numbers the game really tracks (checked in src, 2026-10-09):
//   * the nine lifetime counters of core/achievements.ts (`AchCounters`, key wobblehoard:v1:ach), counted from `since` (no backfill): squeezes, stretches, tosses, cuts, joins,
//     capsules, merges, tasks (species is the Hoard's own count below)
//   * the Hoard itself: Collection.stacks() (species owned, copies, the rarest tier owned, owned per tier)
//   NOT shown, because nothing records them: play time and the longest stretch (grep playTime|longest|maxStretch over src = 0).
import type { Stack } from '../collection/types.ts';
import { ACHIEVEMENTS, ACH_TIERS } from '../core/achievements.ts';
import type { AchCounters, AchTier, AchievementDef, Evaluator } from '../core/achievements.ts';
import { TIERS, TIER_NAMES, TIER_SPECIES_COUNTS, TOTAL_SPECIES } from '../core/rarity.ts';
import type { TierId } from '../core/rarity.ts';

export type TrophyState = 'earned' | 'locked' | 'hidden';
export interface TrophyRow {
  def: AchievementDef;
  /** epoch ms it was earned, or null */
  at: number | null;
  /** countable rows only: how far along (value <= target) */
  progress: { value: number; target: number } | null;
  /** earned | locked | hidden (a hidden row that is not earned yet: its name and condition stay "???") */
  state: TrophyState;
}
export type TierFilter = 'all' | AchTier;
export const FILTERS: readonly TierFilter[] = ['all', ...ACH_TIERS];
export const TIER_WORDS: Readonly<Record<AchTier, string>> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' };
/** how many rank pips a tier wears (the non-colour rank cue next to the word) */
export const TIER_RANK: Readonly<Record<AchTier, number>> = { bronze: 1, silver: 2, gold: 3, diamond: 4 };

export const HIDDEN_NAME = '???';
export const HIDDEN_LINE = 'Hidden for now. It shows itself when you find it.';

/** Every row in the data file's order (the tiers run bronze to diamond), with its state. */
export function trophyRowsOf(ev: Pick<Evaluator, 'earnedAt' | 'progress'>): TrophyRow[] {
  return ACHIEVEMENTS.map((def) => {
    const at = ev.earnedAt(def.slug);
    return { def, at, progress: ev.progress(def.slug), state: at !== null ? 'earned' : def.hidden ? 'hidden' : 'locked' };
  });
}

export const nameOf = (r: TrophyRow): string => (r.state === 'hidden' ? HIDDEN_NAME : r.def.name);
export const conditionOf = (r: TrophyRow): string => (r.state === 'hidden' ? HIDDEN_LINE : r.def.description);

export interface TierCount { earned: number; total: number; points: number; earnedPoints: number }
/** Earned and total per tier and for all (the medal rail's numbers). */
export function tierCounts(rows: readonly TrophyRow[]): Record<TierFilter, TierCount> {
  const out = {} as Record<TierFilter, TierCount>;
  for (const f of FILTERS) out[f] = { earned: 0, total: 0, points: 0, earnedPoints: 0 };
  for (const r of rows) {
    for (const k of ['all', r.def.tier] as const) {
      const c = out[k];
      c.total++; c.points += r.def.points;
      if (r.state === 'earned') { c.earned++; c.earnedPoints += r.def.points; }
    }
  }
  return out;
}
export const filterRows = (rows: readonly TrophyRow[], f: TierFilter): TrophyRow[] => (f === 'all' ? [...rows] : rows.filter((r) => r.def.tier === f));

/** The pips a tier wears, as a string for the accessible name ("Gold, rank 3 of 4"). */
export const rankLine = (t: AchTier): string => `${TIER_WORDS[t]}, rank ${TIER_RANK[t]} of ${ACH_TIERS.length}`;

/** The status words of a card (the icon beside them is decoration; the date is formatted by the caller). */
export function statusWord(r: TrophyRow): string { return r.state === 'earned' ? 'Earned' : r.state === 'hidden' ? 'Hidden' : 'Not yet'; }

/** "7 / 20" */
export const countLine = (earned: number, total: number): string => `${earned} / ${total}`;

/** What the hero says under the count (kind: no pressure, never "you have not"). */
export function heroNote(earned: number, total: number): string {
  if (earned >= total) return 'Every trophy found. Nicely done.';
  if (earned === 0) return 'Trophies arrive as you play, at your own pace.';
  return `${total - earned} still to find.`;
}

/** The screen reader's line when a filter changes. */
export function filterLine(f: TierFilter, c: TierCount): string {
  return f === 'all' ? `All trophies: ${c.earned} of ${c.total} earned.` : `${TIER_WORDS[f]} trophies: ${c.earned} of ${c.total} earned.`;
}

/* ───────────────────────────────────────────────── Records ───────────────────────────────────────────────── */

export interface RecordTile { id: Exclude<keyof AchCounters, 'species'>; label: string; value: number }
/** The counters worth showing, in the order a player thinks of them (one tile each). */
export const RECORD_TILES: ReadonlyArray<{ id: RecordTile['id']; label: string }> = [
  { id: 'squeezes', label: 'Squeezes' }, { id: 'stretches', label: 'Stretches' }, { id: 'tosses', label: 'Throws' }, { id: 'cuts', label: 'Cuts' },
  { id: 'joins', label: 'Reconnects' }, { id: 'capsules', label: 'Capsules opened' }, { id: 'merges', label: 'Merges' }, { id: 'tasks', label: 'Tasks finished' },
];
export const recordTiles = (c: AchCounters): RecordTile[] => RECORD_TILES.map((t) => ({ ...t, value: c[t.id] }));

export interface TierBar { tier: TierId; name: string; owned: number; total: number }
export interface HoardFacts {
  /** species owned / all species */
  species: number;
  total: number;
  /** squishies in the Hoard (every copy) */
  squishies: number;
  /** the rarest tier owned and who is in it, or null for an empty Hoard */
  rarest: { tier: TierId; name: string; names: string[] } | null;
  bars: TierBar[];
}

/** The Hoard's side of the Records screen, from Collection.stacks(). */
export function hoardFacts(stacks: readonly Stack[]): HoardFacts {
  const owned = stacks.filter((s) => s.copies > 0);
  const per = TIERS.map(() => 0);
  let top = -1;
  let squishies = 0;
  for (const s of owned) {
    per[s.tierIdx]++;
    squishies += s.copies;
    if (s.tierIdx > top) top = s.tierIdx;
  }
  const names = top < 0 ? [] : owned.filter((s) => s.tierIdx === top).map((s) => s.name);
  return {
    species: owned.length, total: Math.max(TOTAL_SPECIES, stacks.length), squishies,
    rarest: top < 0 ? null : { tier: TIERS[top], name: TIER_NAMES[TIERS[top]], names },
    bars: TIERS.map((t, i) => ({ tier: t, name: TIER_NAMES[t], owned: per[i], total: TIER_SPECIES_COUNTS[i] })),
  };
}

/** "Legendary: Dollop" / "Epic: 3 squishies" */
export function rarestLine(r: HoardFacts['rarest']): string {
  if (!r) return 'Nothing yet';
  return r.names.length === 1 ? `${r.name}: ${r.names[0]}` : `${r.name}: ${r.names.length} species`;
}

/** "Counting started 8 Oct 2026. Play before that is not counted." (the date is formatted by the caller) */
export const sinceLine = (date: string): string => `Counting started ${date}. Play before that is not counted.`;

