// VALE sim — end.kind 'score': a time-limited kill race.
//
// Team kills (TeamView.kills, counted by core) are the score; PlayerView.score shows each seat's
// own kills. The first team to end.killScore wins (reason 'score'); at end.timeLimit the teams are
// ranked by kills, then damage to fighters — a tie at the top is a draw (no winner, every seat
// placed 1), reason 'time'. Works for FFA too (each seat its own team).

import type { Entity } from '../entity.ts';
import type { World } from '../world.ts';
import type { ModeRules } from './index.ts';
import { rankBy, teamDamage, teamOutcome, type Outcome } from './match.ts';

export function scoreRules(): ModeRules {
  return {
    kind: 'score',
    init(w: World): void { for (const p of w.players) if (p) p.score = 0; },
    onDeath(w: World, victim: Entity, killer: Entity | null): void {
      if (victim.kind !== 'fighter') return;
      const credit = w.creditFighter(killer);
      if (credit && credit.player && credit.team !== victim.team) credit.player.score = (credit.player.score ?? 0) + 1;
    },
    check(w: World): Outcome | null {
      const teams = w.teams.map((t) => t.team);
      const ks = w.rules.end.killScore;
      if (ks !== undefined) {
        const top = teams.filter((t) => w.teams[t].kills >= ks);
        if (top.length > 0) {
          const place = rankBy(teams, [(t) => w.teams[t].kills, (t) => teamDamage(w, t)], (t) => t);
          return teamOutcome(w, 'score', place);
        }
      }
      const limit = w.rules.end.timeLimit;
      if (limit !== undefined && w.time + 1e-9 >= limit) {
        const place = rankBy(teams, [(t) => w.teams[t].kills, (t) => teamDamage(w, t)], (t) => t);
        return teamOutcome(w, 'time', place);
      }
      return null;
    },
  };
}
