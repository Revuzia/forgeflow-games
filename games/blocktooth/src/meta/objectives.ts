// BLOCKTOOTH v2 — map objectives: OVERLOAD SITE, RELIEF DEPOT, RECORDS ANNEX (FEATURES_V2 §5). SIM:
// THREE-free, DOM-free, deterministic (placement draws only from w.rng.meta).
//
// ── L0 SKELETON STUB ── exact exports of `ModObjectives`; lane L4 fills the bodies. Inert: nothing is
// ever placed. world.ts calls stepObjectives AFTER processTriggers (§2.3).

import type { MapState, Objective, ObjectiveKind, World } from '../core/types.ts';

export function createMapState(): MapState {
  return {
    objectives: [], powerups: [],
    nextOverloadT: 0, nextReliefT: 0, annexDue: [], lastDropT: -1e9,
    redLightT: 0, rushHourT: 0,
    overloadsDone: 0, reliefsDone: 0, annexesDone: 0,
    overloadXp: 0, demolitionKills: 0,
  };
}

/** Event-matched completion + state sweep + scheduler. STUB: no-op. */
export function stepObjectives(_w: World): void { /* L4 */ }

/** Place one objective of `kind` now (scheduler + dev cheat). STUB: null (nothing placed). */
export function spawnObjective(_w: World, _kind: ObjectiveKind): Objective | null {
  return null;
}
