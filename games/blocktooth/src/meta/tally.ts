// BLOCKTOOTH v2 — the run tally the goals read (FEATURES_V2 §8). SIM: THREE-free, deterministic,
// event-derived only.
//
// ── L0 SKELETON STUB ── exact exports of `ModTally`; lane L5 fills stepTally. Inert: counters stay at
// their initial values.

import type { RunTally, World } from '../core/types.ts';

export function createTally(): RunTally {
  return {
    kills: 0, crushed: 0,
    killsBy: { android: 0, squad: 0, drone: 0, buggy: 0, apc: 0, tank: 0, walker: 0, elite: 0 },
    props: 0, propsBy: {}, floors: 0, collapses: 0, collapsesByTier: [0, 0, 0, 0, 0], tier4Total: -1,
    ults: 0, ultKillsBest: 0,
    objectives: { overloadSite: 0, reliefDepot: 0, recordsAnnex: 0 },
    powerups: { cleanup: 0, demolition: 0, redLight: 0, rushHour: 0, backPay: 0 },
    evolutions: 0, banishes: 0, locks: 0, rerolls: 0,
    hpLowFrac: 1, healed: 0,
    bossesDefeated: 0, bossDefeatedBy: {}, staggersThisFight: 0, staggersBestFightBy: {}, fightIsRematch: false,
    endlessS: 0,
    vacuumBest: 0, wiresBest: 0, ultWireUntilT: -1, hookKillsBest: 0, fullVents: 0, bloomsBest: 0,
    hookT: -1, hookPickups: 0, hookKills: 0,
  };
}

/** Tick order: after chargeUltimate, before peakRank / checkRunEnd. STUB: no-op. */
export function stepTally(_w: World): void { /* L5 */ }
