// BLOCKTOOTH v2 — goals, unlocks and the profile ledger (FEATURES_V2 §8). APP-PURE: DOM-free and
// storage-free (the app loads/saves through core/save.ts).
//
// ── L0 SKELETON STUB ── exact exports of `ModGoals`; lane L5 fills the bodies. Inert: no goal has
// progress, nothing is ever met or unlocked, the run meta is EMPTY_RUN_META (with the chosen perk and
// palette recorded as data only — the stub perks.ts applies neither).

import type { BiomeId, GoalDef, PerkId, Profile, RunCtx, RunMeta, RunTally, TitanId, UnlockRef, World } from '../core/types.ts';

export function goalProgress(_g: GoalDef, _p: Profile, _t: RunTally | null, _ctx: RunCtx | null): number {
  return 0;
}

/** run-scope goals newly met (live). STUB: none. */
export function evalGoals(_p: Profile, _t: RunTally, _ctx: RunCtx): string[] {
  return [];
}

/** run end. STUB: the profile unchanged, nothing newly met. */
export function applyRunToProfile(p: Profile, _w: World, _result: 'clear' | 'dead'): { profile: Profile; newly: string[] } {
  return { profile: p, newly: [] };
}

/** sorted card ids this profile has unlocked. STUB: none. */
export function unlockedIds(_p: Profile): string[] {
  return [];
}

export function runMetaFor(p: Profile, _titan: TitanId, perk: PerkId | null, palette: number): RunMeta {
  return { unlocked: unlockedIds(p), perk, palette: Number.isFinite(palette) ? Math.max(0, Math.min(2, Math.floor(palette))) : 0, reviveUsed: false };
}

/** the goal closest to done for this titan/city. STUB: null (the panel shows nothing). */
export function nextUnlock(_p: Profile, _titan: TitanId, _biome: BiomeId | null): { goal: GoalDef; value: number } | null {
  return null;
}

export function unlockLabel(u: UnlockRef): string {
  if (u.kind === 'card') return u.id;
  if (u.kind === 'perk') return u.id;
  return u.titan + ' palette ' + u.index;
}

/** removes `ids` from p.newUnlocks (returns a new Profile; the caller saves). STUB: returns its input. */
export function markSeen(p: Profile, _ids: readonly string[]): Profile {
  return p;
}
