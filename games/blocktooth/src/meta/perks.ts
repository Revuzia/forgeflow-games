// BLOCKTOOTH v2 — starting perks + run-meta sanitising (FEATURES_V2 §8.5). SIM: THREE-free, deterministic.
//
// ── L0 SKELETON STUB ── exact exports of `ModPerks`; lane L5 fills the bodies. Inert: every run gets a
// copy of EMPTY_RUN_META (no unlocks, no perk, palette 0), no perk is applied, nothing revives.
// Call sites: world.ts createWorld (sanitizeRunMeta, applyPerk after recomputeStats) and checkRunEnd
// (tryRevive before declaring death).

import type { RunMeta, World } from '../core/types.ts';
import { EMPTY_RUN_META } from '../core/types.ts';

/** STUB: a fresh copy of EMPTY_RUN_META whatever `v` holds. */
export function sanitizeRunMeta(_v: unknown): RunMeta {
  return { ...EMPTY_RUN_META, unlocked: [] };
}

/** createWorld, after recomputeStats and before hp = maxHp. STUB: no-op. */
export function applyPerk(_w: World): void { /* L5 */ }

/** checkRunEnd, before declaring death. STUB: false (no revive). */
export function tryRevive(_w: World): boolean {
  return false;
}
