// BLOCKTOOTH v2 — EXTENDED COVERAGE, the endless mode after a clear (FEATURES_V2 §9). SIM: THREE-free,
// deterministic (rematch skew from w.rng.meta).
//
// ── L0 SKELETON STUB ── exact exports of `ModEndless`; lane L5 fills the bodies. Inert: KEEP GOING is
// refused (continueEndless → false, so game.ts falls back to RETRY), every multiplier is 1.
// Pre-wired call sites: director budgetRate × endlessBudgetMul, enemies spawn HP × endlessHpMul,
// titansim hurtTitan × endlessDmgMul, bosses bossHostile × endlessBossDmgMul, spawnBoss keeps 'endless'.

import type { BiomeId, BossId, World } from '../core/types.ts';
import { BIOMES } from '../data/biomes.ts';

/** Only when run.result === 'clear'. STUB: false (nothing changes). */
export function continueEndless(_w: World): boolean {
  return false;
}

/** Tick order: after stepDirector; no-op unless w.endless. STUB: no-op. */
export function stepEndless(_w: World): void { /* L5 */ }

export function endlessBudgetMul(_w: World): number { return 1; }
export function endlessHpMul(_w: World): number { return 1; }
/** titansim hurtTitan (all hostile damage). */
export function endlessDmgMul(_w: World): number { return 1; }
/** bosses/index.ts bossHostile × this (1 + ENDLESS.rematchDmgStep × rematches while a rematch is alive). */
export function endlessBossDmgMul(_w: World): number { return 1; }
export function endlessScore(_w: World): number { return 0; }

/** Rematch order for a city: its own boss first, then the others. STUB: the city's own boss only. */
export function rematchOrder(biome: BiomeId): BossId[] {
  return [BIOMES[biome].boss];
}
