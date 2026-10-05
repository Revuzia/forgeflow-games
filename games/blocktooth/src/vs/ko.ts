// BLOCKTOOTH VS — KO processing: EVICTED (respawn, -2 levels), eliminated (FINAL NOTICE), KO credit and assists, respawn,
// the winner and the placements (vs_design.md §6.2 rules 5-8, §9, §11). Lane B-VS.
// THREE-free, deterministic: every loop is in slot order, every sort has a total-order tie-break, no rng, no clocks.
//
// When a titan drops to 0 HP (hurtTitan sets alive = false) nothing happens until vsEndTick runs `processKos` at the end
// of that tick; so every system of the tick sees the same world, and several KOs of one tick are resolved together
// (their order is the tie-break order, never the order the systems happened to run in).

import { VS, cumXpAtFor, xpToNextFor } from '../core/config.ts';
import { hypot } from '../core/detmath.ts';
import type { TitanId, World } from '../core/types.ts';
import { emitAs, withPlayer } from '../core/players.ts';
import { gainGrowth, loseLevels } from '../titans/titansim.ts';
import { initKit } from '../titans/kits/index.ts';
import { vsSpawnPoints } from './state.ts';
import { assistXp, betterFirst, koXp } from './formula.ts';
import type { Contender } from './formula.ts';
import { koEliminatesIn, matchClock } from './clock.ts';
import { hpFracOf, refreshScores } from './score.ts';
import { VSX } from './tune.ts';

/** Who gets credit for a KO of `victim`: the rival with the most damage in the credit window (>= VSX.killMinFrac of the
 *  victim's max HP; else nobody: a PvE / ring death), and every other rival with >= VS.ko.assistMinFrac. */
export interface KoCredit { killer: number; assists: number[] }

export function koCredit(w: World, victim: number): KoCredit {
  const V = w.players[victim];
  const cut = w.t - VS.ko.creditWindowS - 1e-9;
  const n = w.players.length;
  const dealt: number[] = [];
  for (let i = 0; i < n; i++) dealt.push(0);
  for (let k = 0; k < V.vs.hits.length; k++) {
    const h = V.vs.hits[k];
    if (h.t < cut || h.from < 0 || h.from >= n || h.from === victim) continue;
    dealt[h.from] += h.pct;
  }
  let killer = -1, best = 0;
  for (let i = 0; i < n; i++) if (dealt[i] > best + 1e-12) { best = dealt[i]; killer = i; }   // ties: the lower slot (strict >)
  if (killer >= 0 && best < VSX.killMinFrac) killer = -1;
  const assists: number[] = [];
  if (killer >= 0) for (let i = 0; i < n; i++) if (i !== killer && dealt[i] >= VS.ko.assistMinFrac) assists.push(i);
  return { killer, assists };
}

/** Give seat `slot` `xp` raw XP (no multipliers, no catch-up): by whole XP-bar chunks through gainGrowth, which levels /
 *  ranks / owes drafts exactly like any other growth. A KO'd (dead) seat gets nothing. */
export function grantRawXp(w: World, slot: number, xp: number): void {
  if (!(xp > 0) || !Number.isFinite(xp)) return;
  withPlayer(w, slot, () => {
    let left = xp;
    for (let guard = 0; guard < 16 && left > 1e-9; guard++) {
      const T = w.titan;
      if (!T.alive) return;
      const bar = T.xpToNext;
      if (!(bar > 0)) return;
      const room = bar - T.xp;
      if (left < room - 1e-9) { gainGrowth(w, left / bar); return; }
      gainGrowth(w, (room + 1e-6) / bar);        // a hair over: the level is crossed whatever the float rounding
      left -= room;
    }
  });
}

/** Where a KO'd seat comes back: the VS spawn point farthest from every other live titan (ties: the lower index). */
export function respawnPoint(w: World, slot: number): { x: number; z: number; heading: number } {
  const pts = vsSpawnPoints(w.city, w.players.length);
  let best = 0, bestD = -1;
  for (let k = 0; k < pts.length; k++) {
    let near = Infinity;
    for (let i = 0; i < w.players.length; i++) {
      if (i === slot) continue;
      const P = w.players[i];
      if (P.vs.eliminated || !P.titan.alive) continue;
      const d = hypot(P.titan.x - pts[k].x, P.titan.z - pts[k].z) - P.titan.radius;
      if (d < near) near = d;
    }
    if (near > bestD + 1e-9) { bestD = near; best = k; }
  }
  return pts[best];
}

/** Bring a KO'd seat back: full HP, fresh dash / kit state, 3 s of spawn protection. */
export function respawnSeat(w: World, slot: number): void {
  const P = w.players[slot];
  const T = P.titan;
  const at = respawnPoint(w, slot);
  T.alive = true;
  T.x = T.px = at.x; T.z = T.pz = at.z;
  T.heading = T.pheading = at.heading;
  T.vx = 0; T.vz = 0; T.speed = 0; T.moving = false;
  T.hp = T.maxHp;
  T.dashT = 0; T.dashRecharge = 0;
  T.dashCharges = Math.max(0, Math.round(T.stats.dashCharges));
  T.iframeT = 0; T.slowT = 0; T.slowMul = 1; T.leash = null;
  T.abilityCd = 0; T.autoCd = 0;
  const K = T.kit;
  K.sim_vx = 0; K.sim_vz = 0; K.sim_kbx = 0; K.sim_kbz = 0; K.sim_rootT = 0; K.sim_dashIfrT = 0; K.sim_dashLeft = 0;
  K.sim_sinceHurt = 99;
  const fresh = initKit(P.titanId as TitanId);       // kit-private state (stored shell, wires, pods ...) starts over
  for (const k in fresh) K[k] = fresh[k];
  P.upgrades.shield = 0;
  P.ult.invulnT = Math.max(P.ult.invulnT, 2 * w.dt);
  P.vs.respawnT = -1;
  P.vs.spawnProtT = VS.ko.spawnProtS;
  P.vs.clearedT = 0;
  delete P.vs.data.ccLeft; delete P.vs.data.ccGapT;
  P.vs.hits.length = 0;
  emitAs(w, slot, { type: 'respawn', slot, x: at.x, z: at.z });
}

/** EVICTED: respawn timer, -2 levels (never a Size), KO XP to the killer, assist XP, the crown's HEADLINE STOLEN bounty. */
function evictSeat(w: World, victim: number, credit: KoCredit): void {
  const vs = w.vs as NonNullable<World['vs']>;
  const V = w.players[victim];
  const T = V.titan;
  const lvBefore = T.level;
  const victimRank = T.rank;
  const hadCrown = vs.crown === victim;
  const xpLost = loseLevels(w, victim, hadCrown ? VS.crown.levelsLost : VS.ko.levelsLost);
  const levelsLost = lvBefore - T.level;
  V.vs.koCount++;
  V.vs.lastKillerSlot = credit.killer;
  V.vs.respawnT = w.t + VS.ko.respawnS;
  V.vs.spawnProtT = 0;
  if (credit.killer >= 0) {
    const K = w.players[credit.killer];
    K.vs.evictions++;
    const bountyXp = hadCrown ? xpToNextFor('vs', K.titan.level) * VS.crown.bountyLevels : 0;   // bars of the killer's level AT THE KILL (before the KO XP levels it)
    const kxp = koXp(xpLost, K.titan.rank, victimRank, K.titan.level, lvBefore);
    if (kxp > 0) grantRawXp(w, credit.killer, kxp);
    for (let a = 0; a < credit.assists.length; a++) {
      const A = w.players[credit.assists[a]];
      A.vs.assists++;
      if (kxp > 0) grantRawXp(w, credit.assists[a], assistXp(kxp));
    }
    if (hadCrown) grantRawXp(w, credit.killer, bountyXp);   // HEADLINE STOLEN
  }
  emitAs(w, victim, { type: 'evicted', victim, killer: credit.killer, assists: credit.assists.slice(), levelsLost, x: T.x, z: T.z });
}

/** Eliminate a seat for good at `place`. */
function eliminateSeat(w: World, victim: number, credit: KoCredit, place: number): void {
  const vs = w.vs as NonNullable<World['vs']>;
  const V = w.players[victim];
  V.vs.eliminated = true;
  V.vs.elimT = w.t;
  V.vs.place = place;
  V.vs.lastKillerSlot = credit.killer;
  V.vs.respawnT = -1;
  vs.order.push(victim);
  if (credit.killer >= 0) {
    w.players[credit.killer].vs.evictions++;
    for (let a = 0; a < credit.assists.length; a++) w.players[credit.assists[a]].vs.assists++;
  }
  emitAs(w, victim, { type: 'eliminated', victim, killer: credit.killer, place });
}

/** Seats that are still contending: not eliminated. */
function contenders(w: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.players.length; i++) if (!w.players[i].vs.eliminated) out.push(i);
  return out;
}

/** Close the match: set the winner and every seat's place, push vsEnd, freeze the run (run.result 'vs', phase 'vsend'). */
export function endMatch(w: World, winner: number): void {
  const vs = w.vs as NonNullable<World['vs']>;
  if (vs.phase === 'over') return;
  refreshScores(w);
  const n = w.players.length;
  if (!vs.order.includes(winner)) vs.order.push(winner);
  // the seats still in besides the winner (hard end with several alive): rank them by the tie-break, best first
  const rest: Contender[] = [];
  for (let i = 0; i < n; i++) if (!w.players[i].vs.eliminated && i !== winner) rest.push({ slot: i, hpFrac: hpFracOf(w, i), score: w.players[i].vs.score });
  rest.sort(betterFirst);
  // order[] currently = eliminated (first out ..) + winner (pushed above, last). Insert `rest` just before the winner, worst first.
  const eliminated = vs.order.filter((s) => w.players[s].vs.eliminated);
  const final: number[] = eliminated.slice();
  for (let k = rest.length - 1; k >= 0; k--) final.push(rest[k].slot);
  final.push(winner);
  vs.order = final;
  for (let k = 0; k < n; k++) {
    const slot = final[final.length - 1 - k];
    w.players[slot].vs.place = k + 1;
  }
  vs.winner = winner;
  vs.endT = w.t;
  vs.phase = 'over';
  vs.phaseT = w.t;
  w.run.result = 'vs';
  w.run.phase = 'vsend';
  w.run.endT = w.t;
  const placements: number[] = [], scores: number[] = [];
  for (let i = 0; i < n; i++) { placements.push(w.players[i].vs.place); scores.push(Math.round(w.players[i].vs.score * 100) / 100); }
  emitAs(w, -1, { type: 'vsPhase', phase: 'over' });
  emitAs(w, -1, { type: 'vsEnd', winner, placements, scores });
}

/**
 * KO -> EVICTED / eliminated, run at the END of the tick (vsEndTick), then the "last titan standing" / hard-end check.
 * Several KOs in one tick: during FINAL NOTICE / LAST CALL they are eliminated worst first by the tie-break (HP fraction
 * is 0 for all of them, then VS SCORE, then the HIGHER seat index is worse), and if no seat would remain the best of
 * them wins (the "same-tick eliminations" tie-break of vs_design.md §9).
 */
export function processKos(w: World): void {
  const vs = w.vs as NonNullable<World['vs']>;
  if (vs.phase === 'over') return;
  const n = w.players.length;
  const dead: number[] = [];
  for (let i = 0; i < n; i++) {
    const P = w.players[i];
    if (!P.vs.eliminated && !P.titan.alive && P.vs.respawnT < 0) dead.push(i);
  }
  if (dead.length > 0) {
    refreshScores(w);
    const credits: KoCredit[] = [];
    for (let k = 0; k < dead.length; k++) credits.push(koCredit(w, dead[k]));
    if (!koEliminatesIn(vs.phase)) {
      for (let k = 0; k < dead.length; k++) evictSeat(w, dead[k], credits[k]);
    } else {
      const stillIn = contenders(w).filter((s) => !dead.includes(s));
      const group = dead.map((slot, k) => ({ slot, k, c: { slot, hpFrac: 0, score: w.players[slot].vs.score } as Contender }));
      group.sort((a, b) => betterFirst(b.c, a.c));                 // WORST first
      if (stillIn.length === 0) {
        // nobody left standing: the best of the same-tick group wins; the rest are eliminated worst first
        const winner = group[group.length - 1];
        let place = contenders(w).length;                           // the worst of the group takes the lowest place still open
        for (let g = 0; g < group.length - 1; g++) { eliminateSeat(w, group[g].slot, credits[group[g].k], place); place--; }
        endMatch(w, winner.slot);
        return;
      }
      let place = contenders(w).length;                           // seats still contending before this tick's eliminations
      for (let g = 0; g < group.length; g++) { eliminateSeat(w, group[g].slot, credits[group[g].k], place); place--; }
    }
  }
  const left = contenders(w);
  if (n >= 2 && left.length === 1) { endMatch(w, left[0]); return; }
  if (matchClock(w) >= VS.phase.hardEndS) {
    const cs: Contender[] = left.map((slot) => ({ slot, hpFrac: hpFracOf(w, slot), score: w.players[slot].vs.score }));
    refreshScores(w);
    for (const c of cs) c.score = w.players[c.slot].vs.score;
    cs.sort(betterFirst);
    endMatch(w, cs.length > 0 ? cs[0].slot : 0);
  }
}

/** Keep cumXpAtFor referenced for the probe-facing helpers below (the VS economy's cumulative XP). */
export function totalXpOf(w: World, slot: number): number {
  const T = w.players[slot].titan;
  return cumXpAtFor('vs', T.level) + T.xp;
}
