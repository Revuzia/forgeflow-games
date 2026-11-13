// BLOCKTOOTH VS — VS SCORE, standings and per-match stats (vs_design.md §9, §13). Lane B-VS.
// THREE-free, deterministic. Reads the world; `refreshScores` writes PlayerVs.score only.

import type { World } from '../core/types.ts';
import { betterFirst, vsScoreOf } from './formula.ts';
import type { Contender } from './formula.ts';

/** VS SCORE of a seat right now (tonnage k-tons + 2 x PvP % dealt + 150 x evictions + 50 x assists + 300 x tender shares +
 *  100 x peak Size numeral). Never decides the winner. */
export function vsScore(w: World, slot: number): number {
  const P = w.players[slot];
  return vsScoreOf({
    tonnage: P.run.tonnage, pvpDealtPct: P.vs.pvpDealt, evictions: P.vs.evictions, assists: P.vs.assists,
    tenderShares: P.vs.data.tenderShare ?? 0, peakSize: Math.max(P.vs.peakRank, P.titan.rank) + 1,
  });
}

/** Store every seat's current VS SCORE in PlayerVs.score (the tie-breaks and the end card read it). */
export function refreshScores(w: World): void {
  for (let i = 0; i < w.players.length; i++) w.players[i].vs.score = vsScore(w, i);
}

/** HP fraction of a seat (0 while KO'd). */
export function hpFracOf(w: World, slot: number): number {
  const T = w.players[slot].titan;
  return T.alive && T.maxHp > 0 ? Math.max(0, Math.min(1, T.hp / T.maxHp)) : 0;
}

/** One seat's line on the standings board / end card. */
export interface Standing {
  slot: number;
  /** 1..n once decided (and for the eliminated); for a seat still in the match: its PROVISIONAL place right now */
  place: number;
  decided: boolean;
  score: number;
  hpFrac: number;
  evictions: number; assists: number; koCount: number;
  pvpDealt: number; pvpTaken: number;
  tenderBids: number; tenderTop: number; tenderShare: number;
  /** peak Size as a numeral (I = 1 ... V = 5) and the world time Size II..V were reached (-1 never) */
  peakSize: number; rankT: number[];
  /** match-clock seconds Size V was reached (-1 never): the stats doc's "time to Size V" */
  sizeVAtS: number;
  won: boolean;
  tonnage: number; crownS: number;
  eliminated: boolean;
  /** a human who left (their seat is a bot now): the net layer rates them 4th */
  left: boolean;
  bot: boolean;
  titan: string;
}

/**
 * The standings, best place first. Decided matches use the recorded places; a live match ranks the seats still in by the
 * tie-break order (higher HP fraction, higher VS SCORE, lower seat) above the eliminated, who keep the reverse
 * elimination order.
 */
export function vsStandings(w: World): Standing[] {
  const vs = w.vs;
  const n = w.players.length;
  refreshScores(w);
  const out: Standing[] = [];
  const vsStartT = vs ? vs.startT : 0;
  const mk = (slot: number, place: number, decided: boolean): Standing => {
    const P = w.players[slot];
    return {
      slot, place, decided, score: P.vs.score, hpFrac: hpFracOf(w, slot),
      evictions: P.vs.evictions, assists: P.vs.assists, koCount: P.vs.koCount,
      pvpDealt: P.vs.pvpDealt, pvpTaken: P.vs.pvpTaken,
      tenderBids: P.vs.tenderBids, tenderTop: P.vs.tenderTop, tenderShare: P.vs.data.tenderShare ?? 0,
      peakSize: Math.max(P.vs.peakRank, P.titan.rank) + 1, rankT: P.vs.rankT.slice(),
      sizeVAtS: P.vs.rankT[3] >= 0 ? P.vs.rankT[3] - vsStartT : -1, won: vs !== null && vs.winner === slot,
      tonnage: P.run.tonnage, crownS: P.vs.crownS, eliminated: P.vs.eliminated,
      left: P.vs.data.left === 1, bot: P.bot !== null, titan: P.titanId,
    };
  };
  if (!vs) { for (let i = 0; i < n; i++) out.push(mk(i, i + 1, false)); return out; }
  if (vs.phase === 'over') {
    for (let i = 0; i < n; i++) out.push(mk(i, w.players[i].vs.place || n, true));
    out.sort((a, b) => a.place - b.place || a.slot - b.slot);
    return out;
  }
  const alive: Contender[] = [];
  for (let i = 0; i < n; i++) if (!w.players[i].vs.eliminated) alive.push({ slot: i, hpFrac: hpFracOf(w, i), score: w.players[i].vs.score });
  alive.sort(betterFirst);
  let place = 1;
  for (const c of alive) out.push(mk(c.slot, place++, false));
  for (let k = vs.order.length - 1; k >= 0; k--) out.push(mk(vs.order[k], place++, true));   // last out ranks highest of the eliminated
  return out;
}
