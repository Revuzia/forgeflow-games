// BLOCKTOOTH ONLINE VS — the PvP HIT QUEUE: where titan-side damage meets another titan (lane B-WORLD).
// THREE-free, deterministic, TYPES only. This is the HOOK the VS lane (B-VS, src/vs/*) resolves.
//
// B-WORLD does NOT decide how much a rival hit hurts (the pvpDamage % rule, size edge, phases, CC rules, KO credit are
// vs_design.md §6 and B-VS's). It only makes sure that EVERY titan-side shape / single-target hit that overlaps a
// rival titan is reported, once, with who did it:
//
//   * combat/damage.ts damageArea     — every titan-side area (auto cones, telegraph blasts, hazard ticks, projectile
//                                       explosions, ult pulses, thorns excluded) tests the other seats' circles;
//   * combat/targeting.ts hitTarget   — a single-target hit on a Target {kind:'titan'};
//   * combat/hazards.ts applySlow     — a titan-owned slowing hazard over a rival (dmg 0, slow = fraction).
//
// Each report is a PvpHit pushed into a per-World queue. The VS lane drains it with takePvp(w) (the contract §4.1 says
// vsAfterTitans: "PvP resolution queued by the titan steps"; hits queued after that call in the same tick — projectiles,
// telegraphs, hazards run later — are simply taken by the NEXT tick's drain, deterministically). Every hit is made
// while the ATTACKER is bound (w.cur === from), so the resolver may run hurtTitan under withPlayer(w, to, ...).
// The queue is capped (QUEUE_CAP): if nobody drains it the oldest hits are dropped, never an unbounded leak.
//
// Hits are only queued for a LIVE, non-eliminated, non-spawn-protected rival (seatHittable) and never for the
// attacker itself. OPEN HOUSE is NOT filtered here: the resolver decides (knockback / NO CONTEST spark only).

import type { DamageKind, World } from '../core/types.ts';

export interface PvpHit {
  /** attacker slot (the bound seat when the damage was dealt) */
  from: number;
  /** victim slot */
  to: number;
  /** the damage kind of the attack (maps to the kit % in VS.kitPct: 'bite' | 'arc' | 'magma' | 'vine' | 'wire' ...) */
  kind: DamageKind;
  /** the attacker's FINAL titan-side damage for this hit (titanDamage + crit applied) — the resolver normally ignores
   *  its magnitude (the rule is % of the victim's max HP) but may use it to tell chip hits from big ones */
  dmg: number;
  crit: boolean;
  /** hazard / active-telegraph damage-over-time tick (a wire shock, a magma pool) */
  dot: boolean;
  /** source point of the hit (shape anchor): the knockback direction is away from it */
  x: number; z: number;
  /** knockback impulse (m/s) the attack carries (0 = none) */
  knock: number;
  /** slowing hazard: fraction of speed removed (0 = not a slow); dmg is 0 for a pure slow */
  slow: number;
  /** DamageOpts.fromUpgrade of the attack ('' = a kit attack) — thorns / lifesteal / procs are 50 % in VS */
  upg: string;
  /** w.tick it was queued */
  tick: number;
}

const QUEUE_CAP = 512;
const QUEUES = new WeakMap<World, PvpHit[]>();

/** Queue one hit (called by damage.ts / targeting.ts / hazards.ts while the attacker is bound). */
export function queuePvp(w: World, h: PvpHit): void {
  let q = QUEUES.get(w);
  if (!q) { q = []; QUEUES.set(w, q); }
  if (q.length >= QUEUE_CAP) q.shift();
  q.push(h);
}

/** The queued hits, oldest first, WITHOUT draining (probes / debug). */
export function peekPvp(w: World): readonly PvpHit[] {
  return QUEUES.get(w) ?? NONE;
}
const NONE: readonly PvpHit[] = [];

/** Take and clear the queue (the VS lane calls it from vsAfterTitans, and may call it again from vsEndTick). */
export function takePvp(w: World): PvpHit[] {
  const q = QUEUES.get(w);
  if (!q || q.length === 0) return [];
  QUEUES.set(w, []);
  return q;
}

/** Drop everything queued (a respawn / phase change may want a clean slate). */
export function clearPvp(w: World): void { QUEUES.delete(w); }
