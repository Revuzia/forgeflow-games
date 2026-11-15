// BLOCKTOOTH VS — the numeric rules as PURE functions of numbers (no World, no mutation): the PvP damage formula
// (vs_design.md §6.1), KO XP (§6.2), the leader-relative catch-up (§6.2), VS SCORE (§9) and the tie-break order (§9).
// Every number comes from the VS block in core/config.ts. THREE-free, deterministic (detban scans src/vs).

import { VS } from '../core/config.ts';
import type { VsPhase } from './types.ts';
import { phaseMul } from './clock.ts';
import { VSX } from './tune.ts';

/** power(attacker) = min(powerCap, sqrt(attacker.stats.damage))  (builds matter, compressed). */
export function pvpPower(damageStat: number): number {
  const d = Number.isFinite(damageStat) && damageStat > 0 ? damageStat : 0;
  return Math.min(VS.pvp.powerCap, Math.sqrt(d));
}

/** sizeEdge(attacker, victim) = clamp(1 + 0.12 x (attacker.rank - victim.rank), 0.64, 1.36). Ranks are 0..4 (Size I..V). */
export function sizeEdge(attRank: number, vicRank: number): number {
  const e = 1 + VS.pvp.edgePerRank * (attRank - vicRank);
  return e < VS.pvp.edgeMin ? VS.pvp.edgeMin : e > VS.pvp.edgeMax ? VS.pvp.edgeMax : e;
}

/**
 * Level-gap governor (VS.pvp.lvGap): x (1 - perLevel x (gap - free)) down to `floor` for an attacker more than `free` levels above
 * its victim; x (1 + boostPerLevel x (-gap - free)) up to `boostMax` for one more than `free` levels below. 1 inside the free band.
 */
export function levelGapMul(attLevel: number, vicLevel: number): number {
  const G = VS.pvp.lvGap;
  const gap = attLevel - vicLevel;
  if (gap > G.free) return G.perLevel > 0 ? Math.max(G.floor, 1 - G.perLevel * (gap - G.free)) : 1;
  if (-gap > G.free) return G.boostPerLevel > 0 ? Math.min(G.boostMax, 1 + G.boostPerLevel * (-gap - G.free)) : 1;
  return 1;
}

export interface PvpDamageIn {
  victimMaxHp: number;
  /** the kit's % of the victim's max HP for this hit as a fraction (4 % = 0.04) — a number from VS.kitPct */
  kitPct: number;
  attackerDamageStat: number;
  attackerRank: number;
  victimRank: number;
  phase: VsPhase;
  /** true = skip power(): UPROAR is a flat 22 % x sizeEdge (vs_design.md §6.4) */
  noPower?: boolean;
  /** match clock (s): FINAL NOTICE's phaseMul ramps with it (absent = the phase's start value) */
  clock?: number;
  /** the two titans' levels for the level-gap governor (absent = 1) */
  attackerLevel?: number;
  victimLevel?: number;
}

/**
 * pvpDamage = victim.maxHp x kitPct x power(attacker) x sizeEdge(attacker, victim) x phaseMul x levelGapMul   (vs_design.md §6.1 + FIXHIGH).
 * This is the damage BEFORE the victim's armor / shield / i-frames / kit onHurt, which hurtTitan applies exactly as
 * it does for hostile damage today.
 */
export function pvpDamage(i: PvpDamageIn): number {
  const pm = phaseMul(i.phase, i.clock);
  if (!(pm > 0) || !(i.kitPct > 0) || !(i.victimMaxHp > 0)) return 0;
  const power = i.noPower ? 1 : pvpPower(i.attackerDamageStat);
  const lg = i.attackerLevel !== undefined && i.victimLevel !== undefined ? levelGapMul(i.attackerLevel, i.victimLevel) : 1;
  return i.victimMaxHp * i.kitPct * power * sizeEdge(i.attackerRank, i.victimRank) * pm * lg;
}

/**
 * KO XP the killer banks (vs_design.md §6.2 rule 5): 40 % of the XP the victim lost, x 0 if the victim is 2+ ranks
 * smaller than the killer ("NO STORY HERE"). Same-size or bigger victims pay full.
 */
export function koXp(xpLost: number, killerRank: number, victimRank: number, killerLevel = 0, victimLevel = 0): number {
  if (!(xpLost > 0)) return 0;
  if (killerRank - victimRank >= VS.ko.tinyVictimRankGap) return 0;
  let m = 1;
  // anti-snowball (B-VS extension of "bullying does not pay"): the reward fades to nothing as the killer's LEVEL lead over
  // the victim grows to VSX.koGapZeroLv (a leader farming much weaker titans earns nothing from it; a fair fight pays full)
  if (VSX.koGapZeroLv > 0 && killerLevel > victimLevel) m = Math.max(0, 1 - (killerLevel - victimLevel) / VSX.koGapZeroLv);
  return xpLost * VS.ko.killXpFrac * m;
}

/** An assist pays 25 % of the KO XP (vs_design.md §6.2 rule 8). */
export function assistXp(koXpValue: number): number { return koXpValue * VS.ko.assistXpFrac; }

/**
 * Leader-relative catch-up multiplier on growth XP (vs_design.md §6.2 rule 2): min(1.5, 1 + 0.08 x (leader level -
 * my level)). The leader (and anyone ahead) gets x 1.
 */
export function catchUpMul(myLevel: number, leaderLevel: number, secondLevel = 0): number {
  const gap = leaderLevel - myLevel;
  if (!(gap > 0)) {
    // the LEADER's governor (GATE knob; off at aheadPerLevel 0): fewer growth XP per level of lead over 2nd place
    const lead = myLevel - secondLevel;
    if (VS.catchUp.aheadPerLevel > 0 && lead > 0 && secondLevel > 0) return Math.max(VS.catchUp.aheadMin, 1 - VS.catchUp.aheadPerLevel * lead);
    return 1;
  }
  return Math.min(VS.catchUp.max, 1 + VS.catchUp.perLevel * gap);
}

/** The crown's damage-to-UPROAR multiplier (x 1.5 when the victim wears the FRONT PAGE crown). */
export function uproarChargeMul(victimWearsCrown: boolean): number { return victimWearsCrown ? VS.crown.uproarMul : 1; }

export interface ScoreIn {
  /** tonnage leveled (tons; the score counts kilo-tons) */
  tonnage: number;
  /** PvP damage dealt as the SUM of (% of the victim's max HP), e.g. a 4 % bite = 4 */
  pvpDealtPct: number;
  evictions: number;
  assists: number;
  /** sum over the tenders of this seat's damage share (0..1 each) */
  tenderShares: number;
  /** peak Size rank as a numeral: Size I = 1 ... Size V = 5 */
  peakSize: number;
}

/** VS SCORE (vs_design.md §9): tonnage (k-tons) + 2 x PvP damage (% of a maxHp, summed) + 150 x evictions + 50 x assists
 *  + 300 x bid share per tender + 100 x peak Size rank. Never decides the winner (tie-breaks + stats only). */
export function vsScoreOf(s: ScoreIn): number {
  const S = VS.score;
  return (s.tonnage / 1000) * S.perKTon + s.pvpDealtPct * S.perPvpPct + s.evictions * S.perEviction
    + s.assists * S.perAssist + s.tenderShares * S.perTenderShare + s.peakSize * S.perPeakRank;
}

/** One contender in a tie-break (vs_design.md §9: "higher HP fraction, then higher VS SCORE, then lower seat index"). */
export interface Contender { slot: number; hpFrac: number; score: number }

/** Sort comparator, BEST first: higher HP fraction, then higher VS SCORE, then lower seat index (total order). */
export function betterFirst(a: Contender, b: Contender): number {
  if (a.hpFrac !== b.hpFrac) return b.hpFrac - a.hpFrac;
  if (a.score !== b.score) return b.score - a.score;
  return a.slot - b.slot;
}

/** The CONDEMNATION ring's size at a match clock (pure): lerps from the radius at the step's start to its target over
 *  VS.ring.shrinkS. `r0` = the 100 % radius. Before the first step the ring is the full r0. */
export function ringRadiusAt(clock: number, r0: number): number {
  const steps = VS.ring.steps;
  let r = r0;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (clock < s.atS) break;
    const to = r0 * s.frac;
    const u = clock >= s.atS + VS.ring.shrinkS ? 1 : (clock - s.atS) / VS.ring.shrinkS;
    r = r + (to - r) * u;
    if (u < 1) break;
  }
  return r;
}

/** Fractional mortar damage of one shell: 4 % maxHp, +1 % per ring step reached, +2 % per 5 s of LAST CALL. */
export function mortarFrac(clock: number): number {
  const R = VS.ring;
  let stepsReached = 0;
  for (let i = 0; i < R.steps.length; i++) if (clock >= R.steps[i].atS) stepsReached = i;   // step index (0 for the first)
  let f = R.mortarMaxHpFrac + R.mortarPerStepAdd * stepsReached;
  const lastCall = clock - VS.phase.finalEndS;
  if (lastCall > 0) f += R.lastCallAddFrac * Math.floor(lastCall / R.lastCallEveryS);
  return f;
}
