// VALE sim — end.kind 'last_standing_or_score' (Fray, free-for-all).
//
// Every seat starts with end.lives lives (default 1) and score 0 (PlayerView.lives / score).
// A fighter death costs a life; the credited killer (a hostile seat) scores +1. Respawns happen
// while lives remain (units/fighters.ts). At 0 lives the seat is eliminated: it stops respawning
// and acting at once (its commands are dropped except pings), and at the end of that tick
// ('modes' phase) it is placed: placement = how many seats were still in when it fell (so the
// first one out places last), PlayerView.placement is set and 'eliminated' { player, placement } +
// announce 'eliminated' are emitted. Seats eliminated on the SAME tick (a double KO) share that
// block of places by score, then damage to fighters, then seat order — never by the incidental
// order the deaths were processed in.
// The match ends when
//   * one seat (or none) is left: it places 1st — reason 'last_standing';
//   * a seat reaches end.killScore — reason 'score';
//   * end.timeLimit runs out — reason 'time';
// in the last two cases the seats still in are ranked by score, then damage to fighters (then
// seat order) into the places above the eliminated ones. Kill credit, bounties and assists are the
// normal economy (each seat is its own team). winningTeam is −1; won = placement 1.

import type { PlayerId } from '../../contracts/sim.ts';
import type { Entity, Player } from '../entity.ts';
import { seatState } from '../units/fighters.ts';
import type { World } from '../world.ts';
import type { ModeRules } from './index.ts';
import { rankBy, type Outcome } from './match.ts';

export function lastStandingRules(): ModeRules {
  const placed = new Map<PlayerId, number>();
  /** eliminated this tick, placed together in check() */
  const pending: Player[] = [];
  const stillIn = (w: World): Player[] => w.players.filter((p) => p && !placed.has(p.player));
  const settle = (w: World): void => {
    if (pending.length === 0) return;
    const top = stillIn(w).length - pending.length + 1;   // best place this block can take
    const rank = rankBy(pending, [(p) => p.score ?? 0, (p) => p.damageToFighters], (p) => p.player);
    const order = pending.slice().sort((a, b) => rank.get(a)! - rank.get(b)! || a.player - b.player);
    // announce worst-first, like eliminations one tick apart
    for (let i = order.length - 1; i >= 0; i--) {
      const vp = order[i], placement = top + i;
      placed.set(vp.player, placement);
      vp.placement = placement;
      w.emit({ e: 'eliminated', t: w.time, player: vp.player, placement });
      w.emit({ e: 'announce', t: w.time, key: 'eliminated', player: vp.player, team: vp.team, params: { placement } });
    }
    pending.length = 0;
  };
  const finish = (w: World, reason: Outcome['reason']): Outcome => {
    const rest = stillIn(w);
    const rank = rankBy(rest, [(p) => p.score ?? 0, (p) => p.damageToFighters], (p) => p.player);
    // ties share nothing here: seat order breaks them so every placement is distinct
    const order = rest.slice().sort((a, b) => rank.get(a)! - rank.get(b)! || a.player - b.player);
    order.forEach((p, i) => placed.set(p.player, i + 1));
    return { reason, winningTeam: -1, placement: (p) => placed.get(p.player) ?? w.players.length };
  };
  return {
    kind: 'last_standing_or_score',
    init(w: World): void {
      const lives = Math.max(1, w.rules.end.lives ?? 1);
      for (const p of w.players) if (p) { p.lives = lives; p.score = 0; }
    },
    onDeath(w: World, victim: Entity, killer: Entity | null): void {
      if (victim.kind !== 'fighter' || !victim.player) return;
      const vp = victim.player;
      const credit = w.creditFighter(killer);
      if (credit && credit.player && credit.team !== victim.team) credit.player.score = (credit.player.score ?? 0) + 1;
      vp.lives = Math.max(0, (vp.lives ?? 1) - 1);
      if (vp.lives > 0 || placed.has(vp.player) || pending.includes(vp)) return;
      pending.push(vp);
      const s = seatState(w, vp.player);
      if (s) { s.eliminated = true; s.respawnAt = -1; }
      vp.respawnIn = 0;
    },
    check(w: World): Outcome | null {
      settle(w);
      const rest = stillIn(w);
      if (rest.length <= 1) return finish(w, 'last_standing');
      const ks = w.rules.end.killScore;
      if (ks !== undefined && rest.some((p) => (p.score ?? 0) >= ks)) return finish(w, 'score');
      const limit = w.rules.end.timeLimit;
      if (limit !== undefined && w.time + 1e-9 >= limit) return finish(w, 'time');
      return null;
    },
  };
}
