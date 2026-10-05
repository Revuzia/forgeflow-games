// BLOCKTOOTH ONLINE VS — multi-titan helpers for the WORLD-scoped systems (lane B-WORLD).
// THREE-free, deterministic, TYPES + core/players only (no import cycles: every sim module may import this).
//
// Why this file exists (CORE_CONTRACT.md §3 rule 3): in a VS match the world-scoped steps (enemies, projectiles,
// telegraphs, hazards, pickups, bosses, objectives, power-ups) run UNBOUND (w.cur = -1) and the cursor fields fall back
// to slot 0, which is wrong for 3 of 4 seats. The B-WORLD systems therefore (a) KNOW which titan an entity belongs to
// and (b) BIND that titan (core/players.ts bindPlayer / withPlayer) before running the unchanged single-titan code, so
// hundreds of `w.titan` reads resolve to the right seat without being rewritten. SOLO NEVER TAKES ANY BRANCH HERE:
// every helper is only reached behind `w.mode === 'vs'`.
//
// OWNER FIELDS. core/types.ts is B-CORE's file, so the owner slots are added to the entity interfaces by TYPE
// AUGMENTATION below (types only: no runtime, no edit of types.ts; B-CORE may fold them into types.ts at any time):
//
//   Enemy.tslot      the titan this Civil Defense unit is ASSIGNED to / hunts (vs_design.md §8). Set at spawn from the
//                    bound seat (the per-seat director), re-picked (nearest live titan) when that titan is KO'd /
//                    eliminated. The view stripes the unit in this seat's colour. undefined in solo.
//   Projectile/Telegraph/Hazard.oslot
//                    the seat that fired it, for titan-owned ones (the step binds it before resolving, so kill
//                    credit / lifesteal / XP go to the right titan). undefined in solo and for hostile ones.
//   Pickup.pslot     the seat the pickup belongs to (rubble / scrap / heal: "rubble is private", vs_design.md §8);
//                    -1 / undefined = shared (the magnet goes to the NEAREST titan).
//   Objective.oslot  the seat whose private contract board this objective is on (OVERLOAD SITE / RELIEF DEPOT /
//                    RECORDS ANNEX are per seat in VS).

import type { PlayerState, World } from '../core/types.ts';

declare module '../core/types.ts' {
  interface Enemy { tslot?: number }
  interface Projectile { oslot?: number }
  interface Telegraph { oslot?: number }
  interface Hazard { oslot?: number }
  interface Pickup { pslot?: number }
  interface Objective { oslot?: number }
}

/** true in a VS world (the only way a B-WORLD multi-titan branch is entered). */
export function isVs(w: World): boolean { return w.mode === 'vs'; }

/** A seat still fighting the world: its titan is up (not KO'd awaiting respawn) and it is not eliminated. */
export function seatLive(p: PlayerState): boolean { return p.titan.alive && !p.vs.eliminated; }

/** A seat that can be hit by a rival / hostile: live and not under spawn protection. */
export function seatHittable(p: PlayerState): boolean { return p.titan.alive && !p.vs.eliminated && !(p.vs.spawnProtT > 0); }

/**
 * Nearest LIVE seat to (x, z) by centre distance (ties: lower slot). -1 when nobody is live. `skip` (default -1) is
 * excluded (rival lookups pass the attacker's own slot).
 */
export function nearestLiveSlot(w: World, x: number, z: number, skip = -1): number {
  const ps = w.players;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < ps.length; i++) {
    if (i === skip || !seatLive(ps[i])) continue;
    const T = ps[i].titan;
    const dx = T.x - x, dz = T.z - z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Nearest seat that is not eliminated, alive or not (deterministic fallback owner for an unowned thing). */
export function nearestSeat(w: World, x: number, z: number): number {
  const ps = w.players;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].vs.eliminated) continue;
    const T = ps[i].titan;
    const dx = T.x - x, dz = T.z - z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * The seat an enemy hunts this tick (VS). Its assigned `tslot` while that titan is live. A titan that is only KO'd
 * (EVICTED, respawning) keeps its units: they HOLD (-1) until it is back, so a KO never sends its Civil Defense after the
 * killer. Once the owner is ELIMINATED the unit is reassigned to the nearest live titan (sticky). -1 also when no titan is
 * live. A unit with no assignment yet (spawned unbound) is assigned to the nearest live titan.
 */
export function enemyTargetSlot(w: World, e: { x: number; z: number; tslot?: number }): number {
  const ps = w.players;
  const s = e.tslot;
  if (s !== undefined && s >= 0 && s < ps.length) {
    if (seatLive(ps[s])) return s;
    if (!ps[s].vs.eliminated) return -1;     // KO'd, coming back: hold
  }
  const n = nearestLiveSlot(w, e.x, e.z);
  if (n >= 0) e.tslot = n;
  return n;
}

/** The owner a thing spawned right now belongs to: the bound seat, else (unbound) the nearest seat to (x, z). */
export function ownerNow(w: World, x: number, z: number): number {
  return w.cur >= 0 ? w.cur : nearestSeat(w, x, z);
}

/** VS: is RED LIGHT running for seat `slot`? It is per collector (vs_design.md section 8): the timer lives in that seat's
 *  director bag (director.data.pu_red, seconds left; meta/powerups.ts owns it). Solo never calls this. */
export function redLightFor(w: World, slot: number): boolean {
  const p = w.players[slot];
  return p !== undefined && (p.director.data.pu_red ?? 0) > 0;
}

/** Rivals can be auto-targeted and hurt from HOSTILE TAKEOVER on (OPEN HOUSE rival hits only shove). */
export function rivalsHostile(w: World): boolean {
  const v = w.vs;
  return !!v && (v.phase === 'takeover' || v.phase === 'final' || v.phase === 'last');
}
