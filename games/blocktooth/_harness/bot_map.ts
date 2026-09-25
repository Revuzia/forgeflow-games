// BLOCKTOOTH v2 — gate-bot detours to map objectives and power-ups (FEATURES_V2 §5 / §6; lane L4).
//
// ── L0 SKELETON STUB ── null = no detour (bot.ts keeps its own heading). Lane L4 fills `out` with a
// world point worth walking to (an OVERLOAD SITE, a RELIEF DEPOT when hurt, a power-up) and returns it.

import type { World } from '../src/core/types.ts';

export function botDetour(_w: World, _out: { x: number; z: number }): { x: number; z: number } | null {
  return null;
}
