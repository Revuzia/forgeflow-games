// DYEFIELD — bot kit tactics (CONTRACT_P6_11 §18.1 "Bots use their kit"; lane BOTKITS). THREE-free, DOM-free,
// deterministic: pure numbers + math the director (bots/director.ts) uses to play each kit.
//
//   stream  MIST-RASP: unchanged (the director's phase-5 brain; its engage range is the skill's).
//   roll    SHEET-DRUM: paints by rolling (fire held while moving over un-owned floor, drum up over own dye so
//           it can slick), rolls through foes that are close (or looking away / weak) to flatten them, and
//           flicks (a tap: press + release) at FLICK_MIN..FLICK_MAX.
//   charge  NEEDLE-GLINT: takes goals with long sightlines over un-owned floor (and height), line-paints far
//           floor while idle, charges on a visible enemy and releases when the charge washes it (always a
//           full charge beyond FULL_BEYOND), and backs off from an enemy closer than RETREAT.
//   burst   POP-WELL: holds a BURST_MIN..BURST_MAX band, leads its target with the burst's flight time, aims
//           low (a miss still bursts at the feet), and airbursts round the corner a target just ducked behind.
// Everyone: JELLY CHARGE at enemy clusters, behind the cover a target just left sight at, or into enemy dye
// gaps, with a tank ≥ SUB_TANK; the special when ready and ≥ 2 enemies are inside its area at the target, or
// a large enemy-dyed area waits to be reclaimed (CLOUDBURST thrown there, WELLSPRING slammed where it stands).

import type { KitFire } from '../combat/kits.ts';
import type { BotSkill } from '../match/roster.ts';

export type KitKind = 'stream' | 'roll' | 'charge' | 'burst';

// ── SHEET-DRUM ──
export const ROLL_CLOSE = 3.2;        // m: roll straight through a foe closer than this
export const ROLL_AMBUSH = 5.5;       // m: …or closer than this when it looks away / is weak / is slicking
export const FLICK_MIN = 3.0, FLICK_MAX = 7.2;   // m: flick band (reach 7.5)
export const FLICK_TAP_TICKS = 3;     // fire held this many ticks, then released: a tap (≤ KITS.tapSeconds)
// ── NEEDLE-GLINT ──
export const RETREAT = 6.0;           // m: back off from a closer enemy
export const FULL_BEYOND = 12.0;      // m: a target this far gets a full charge
export const LINE_MIN = 5, LINE_MAX = 26;       // m: line-paint targets (and sightline zones)
export const LINE_TANK = 40;          // tank kept for fights: below it the charger travels (and slick-refills) instead
/** s the aim must stay on a runner before a charged release (lining the shot up), by skill */
export const CHARGE_SETTLE: Record<BotSkill, number> = { chill: 0.3, fresh: 0.2, fierce: 0.1 };
// ── POP-WELL ──
export const BURST_MIN = 5.0, BURST_MAX = 9.0;  // m: held band
// ── sub / special ──
export const SUB_TANK = 90;           // tank needed before a bot considers a jelly
export const SUB_REACH = 9.0;         // m: horizontal reach used for jelly targets (v 13, g 18: ≈ 10 m on level floor)
export const CLUSTER = 2;             // enemies that make a cluster

/** Per-kit numbers the director reads (engage = open fire within this many metres). */
export interface KitTactic {
  kind: KitKind;
  engage: number;
  /** tank one useful shot needs (MIST: tankPerShot, exactly the phase-5 value) */
  ink: number;
}

const CHARGE_ENGAGE: Record<BotSkill, number> = { chill: 22, fresh: 25, fierce: 28 };

export function kitTactic(f: KitFire, skill: BotSkill, skillEngage: number): KitTactic {
  switch (f.type) {
    case 'roll': return { kind: 'roll', engage: FLICK_MAX + 0.8, ink: f.flickTankCost };
    case 'charge': return { kind: 'charge', engage: Math.min(f.maxRange - 2, CHARGE_ENGAGE[skill] ?? 25), ink: f.tankMin + 2 };
    case 'burst': return { kind: 'burst', engage: Math.min(f.maxRange + 2, skillEngage + 0.5), ink: f.tankPerShot };
    default: return { kind: 'stream', engage: skillEngage, ink: f.tankPerShot };
  }
}

/** Charge (0..1) a NEEDLE-GLINT release needs: a full charge beyond FULL_BEYOND, else enough to wash `hp`, and
 *  always enough range for `d` (range = lerp(minRange, maxRange, c)). */
export function chargeNeed(d: number, hp: number, minRange: number, maxRange: number, damageMin: number, damageFull: number): number {
  const reach = (d + 0.5 - minRange) / Math.max(1e-6, maxRange - minRange);
  if (d > FULL_BEYOND) return 1;
  const wash = (hp + 1 - damageMin) / Math.max(1e-6, damageFull - damageMin);
  return Math.min(1, Math.max(0.15, wash, reach));
}

/** Charge the tank can pay for (combat/kits.ts stepCharge caps the charge the same way). */
export function chargeCap(tank: number, tankMin: number, tankFull: number): number {
  const span = tankFull - tankMin;
  return span > 1e-9 ? Math.min(1, Math.max(0, (tank - tankMin) / span)) : 1;
}

/** Charge a line-paint release to a floor point `d` m away needs (enough range, never below the 15 % floor). */
export function lineNeed(d: number, minRange: number, maxRange: number): number {
  return Math.min(1, Math.max(0.15, (d + 0.4 - minRange) / Math.max(1e-6, maxRange - minRange)));
}
