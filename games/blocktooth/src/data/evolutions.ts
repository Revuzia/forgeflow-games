// BLOCKTOOTH v2 — evolution recipes (FEATURES_V2 §7.3): a mirror of the `evo` fields of the evolution
// cards in catalogue order, plus base id → evo id. THREE-free data. Lane L2 (F1 readiness rework).
//
// Derived from data/upgrades_v2.ts (the single source of the recipes), so the two can never disagree.
// upgrades_v2.ts imports nothing from data/, so importing it here creates no cycle with upgrades.ts
// (upgrades/draft.ts imports both).
//
// F1 (critic HIGH, owner item 8 — evolutions basically never appeared: the base had to be MAXED out of a
// ~200-card pool). The recipe tuning lives here, next to the recipes:
//   * READY at a lower threshold: owned[base] ≥ min(EVO_READY_STACKS, base maxStacks) AND owned[with] ≥ 1
//     (upgrades/draft.ts evolutionsReady). The evolution still beats the MAXED base on every stat the
//     base touched (probe_evolutions), so evolving early is never a downgrade.
//   * DRAFT NUDGE: once one half of a live recipe is owned, the MISSING half (the companion once the base is
//     owned; the base, below its ready threshold, once the companion is owned) rolls with EVO_NUDGE × its
//     normal weight INSIDE its rarity — the 60/28/10/2 rarity split is untouched, and the rng.loot draw count
//     is unchanged (one per card). A base never nudges itself (measured: that fed mono-stacking).

import type { EvolutionRow } from '../core/types.ts';
import { UPGRADES_V2_RAW } from './upgrades_v2.ts';

/** Every evolution in catalogue order (the order a chest draft picks "the first ready evolution" in). */
export const EVOLUTIONS: readonly EvolutionRow[] = Object.freeze(
  UPGRADES_V2_RAW.filter((u) => !!u.evo).map((u) => Object.freeze({ id: u.id, base: u.evo!.base, with: u.evo!.with })),
);

/** base card id → its evolution id (a base has at most one evolution; probe_evolutions asserts it). */
export const EVO_OF_BASE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(EVOLUTIONS.map((r) => [r.base, r.id])),
);

/** recipe card id (base OR companion) → the recipes it is part of (catalogue order). */
export const EVO_ROWS_OF_PART: Readonly<Record<string, readonly EvolutionRow[]>> = (() => {
  const m: Record<string, EvolutionRow[]> = {};
  for (const r of EVOLUTIONS) for (const id of [r.base, r.with]) (m[id] ??= []).push(r);
  return Object.freeze(m);
})();

/** F1: base stacks a recipe needs (capped by the base's maxStacks). Measured: see upgrades/draft.ts header (F1 table). */
export const EVO_READY_STACKS = 3;
/** F1: roll-weight multiplier (within the card's rarity) for the missing half of a started recipe. */
export const EVO_NUDGE = 10;

/** Base stacks that make a recipe ready: min(EVO_READY_STACKS, base maxStacks). */
export function evoReadyStacks(baseMaxStacks: number): number {
  return Math.min(EVO_READY_STACKS, baseMaxStacks);
}
