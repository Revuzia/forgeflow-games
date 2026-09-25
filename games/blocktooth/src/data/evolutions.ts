// BLOCKTOOTH v2 — evolution recipes (FEATURES_V2 §7.3): a mirror of the `evo` fields of the evolution
// cards in catalogue order, plus base id → evo id. THREE-free data. Lane L2.
//
// Derived from data/upgrades_v2.ts (the single source of the recipes), so the two can never disagree.
// upgrades_v2.ts imports nothing from data/, so importing it here creates no cycle with upgrades.ts
// (upgrades/draft.ts imports both).

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
