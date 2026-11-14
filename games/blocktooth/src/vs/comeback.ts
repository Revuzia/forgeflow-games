// BLOCKTOOTH VS — the FRONT PAGE crown and the comeback multipliers (vs_design.md §6.2 rules 2-3). Lane B-VS.
// THREE-free, deterministic. Pure functions of the world (slot order, total-order tie-breaks).

import { VS } from '../core/config.ts';
import type { World } from '../core/types.ts';
import { emitAs } from '../core/players.ts';
import { cumXpAtFor } from '../core/config.ts';
import { catchUpMul } from './formula.ts';
import { matchClock } from './clock.ts';
import { VSX } from './tune.ts';

/** Slot wearing the FRONT PAGE crown (-1 none; live from the start of HOSTILE TAKEOVER). */
export function vsCrownSlot(w: World): number { return w.vs ? w.vs.crown : -1; }

/** Highest level among the seats still in the match (KO'd, waiting seats included). 0 when nobody is. */
export function vsLeaderLevel(w: World): number {
  let lead = 0;
  for (let i = 0; i < w.players.length; i++) {
    const p = w.players[i];
    if (p.vs.eliminated) continue;
    if (p.titan.level > lead) lead = p.titan.level;
  }
  return lead;
}

/** Growth-XP multiplier for seat `slot` (vs_design.md §6.2 rule 2): min(1.5, 1 + 0.08 x (leader level - my level)). */
export function vsCatchUpMul(w: World, slot: number): number {
  if (w.mode !== 'vs') return 1;
  const my = w.players[slot].titan.level;
  // 2nd place = the highest level among the OTHER seats still in the match (the leader's lead is over them)
  let second = 0;
  for (let i = 0; i < w.players.length; i++) {
    if (i === slot || w.players[i].vs.eliminated) continue;
    if (w.players[i].titan.level > second) second = w.players[i].titan.level;
  }
  let m = catchUpMul(my, vsLeaderLevel(w), second);
  // the HOSTILE TAKEOVER city boom (GATE knob; 1 = off): every seat's growth XP x surgeMul from surgeFromS
  if (w.vs && w.t - w.vs.startT >= VS.pacing.surgeFromS) m *= VS.pacing.surgeMul;
  return m;
}

/** Per-titan Civil Defense budget multiplier (vs_design.md §8): 0.6 per titan, x1.3 on the crown holder. */
export function vsDirectorMul(w: World, slot: number): number {
  if (w.mode !== 'vs') return 1;
  return VS.director.budgetMulPerTitan * (w.vs !== null && w.vs.crown === slot ? VS.director.crownMul : 1);
}

/** Total XP a seat has banked (cumulative curve of the VS economy + the bar): the crown's tie-break. */
function totalXp(w: World, slot: number): number {
  const T = w.players[slot].titan;
  return cumXpAtFor('vs', T.level) + T.xp;
}

/**
 * Who should wear the crown right now: the highest level among the seats still in the match, ties to more total XP, then
 * the lower slot. -1 before HOSTILE TAKEOVER and once the match is over. An equal-level change of hands needs a real XP
 * lead (VSX.crownXpMargin of the holder's bar).
 */
export function crownHolder(w: World): number {
  const vs = w.vs;
  if (!vs || vs.phase === 'over' || vs.phase === 'countdown' || matchClock(w) < VS.crown.fromS) return -1;
  let best = -1, bestL = -1, bestX = -1;
  for (let i = 0; i < w.players.length; i++) {
    const p = w.players[i];
    if (p.vs.eliminated) continue;
    const L = p.titan.level, X = totalXp(w, i);
    if (L > bestL || (L === bestL && X > bestX)) { best = i; bestL = L; bestX = X; }
  }
  // hysteresis: at an EQUAL level the crown only changes hands when the challenger leads by VSX.crownXpMargin of the
  // holder's XP bar (a crown beam that flickers between two titans every few ticks reads as a bug)
  const cur = vs.crown;
  if (cur >= 0 && cur !== best && !w.players[cur].vs.eliminated && w.players[cur].titan.level === bestL) {
    if (bestX - totalXp(w, cur) < VSX.crownXpMargin * w.players[cur].titan.xpToNext) return cur;
  }
  return best;
}

/** Per-tick crown upkeep (vsStepWorld): hand the crown over (a `crown` event on change) and accrue crown seconds. */
export function stepCrown(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  const h = crownHolder(w);
  if (h !== vs.crown) {
    vs.crown = h;
    emitAs(w, -1, { type: 'crown', holder: h });
  }
  if (h >= 0) w.players[h].vs.crownS += w.dt;
}
