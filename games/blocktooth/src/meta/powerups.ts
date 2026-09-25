// BLOCKTOOTH v2 — map power-ups: CLEANUP CREW, DEMOLITION NOTICE, RED LIGHT, RUSH HOUR, BACK PAY
// (FEATURES_V2 §6). SIM: THREE-free, DOM-free, deterministic (drops and kinds from w.rng.meta).
//
// ── L0 SKELETON STUB ── exact exports of `ModPowerups`; lane L4 fills the bodies. Inert: nothing drops,
// RED LIGHT is never active. RED LIGHT is already honoured by the pre-wired hooks in ai/director.ts,
// ai/enemies.ts, combat/projectiles.ts and combat/telegraphs.ts (all read redLightActive).
// DEMOLITION kills bank through meta/ultimate.ts: set `w.ult.bankOpen = true` around the kill loop.

import type { PowerUp, PowerUpKind, World } from '../core/types.ts';

/** Tick order: right after stepObjectives (drops from ALL of this tick's kills/collapses, collect, timers). STUB: no-op. */
export function stepPowerups(_w: World): void { /* L4 */ }

/** Spawn a power-up token (null kind = weighted roll). STUB: null (nothing spawned). */
export function spawnPowerup(_w: World, _kind: PowerUpKind | null, _x: number, _z: number, _forced: boolean): PowerUp | null {
  return null;
}

/** RED LIGHT active (foes, their shots and their paint stop). STUB: false. */
export function redLightActive(_w: World): boolean {
  return false;
}
