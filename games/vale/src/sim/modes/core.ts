// VALE sim — end.kind 'core' (Rift, Bridge): the team whose rules.end.coreStructure falls loses
// (a structure unit id — every placement of it counts — or one map placement id; see isCoreStructure).
//
// With more than two teams the last team with a standing core wins. Surrender (match.ts) ends it
// for the surrendering team. With end.timeLimit, time runs out on a ranking by structures
// destroyed, then kills, then gold earned (a tie on all three is a draw), reason 'time'.

import type { Entity } from '../entity.ts';
import type { World } from '../world.ts';
import { isCoreStructure } from '../units/structures.ts';
import type { ModeRules } from './index.ts';
import { rankBy, surrenderSystem, teamOutcome, type Outcome } from './match.ts';

export function coreRules(): ModeRules {
  const lost = new Set<number>();
  return {
    kind: 'core',
    init(): void { /* nothing per seat */ },
    onDeath(w: World, victim: Entity): void {
      if (victim.team >= 0 && isCoreStructure(w, victim)) lost.add(victim.team);
    },
    check(w: World): Outcome | null {
      const teams = w.teams.map((t) => t.team);
      if (lost.size > 0) {
        const standing = teams.filter((t) => !lost.has(t));
        if (standing.length <= 1) {
          const winner = standing.length === 1 ? standing[0] : -1;
          return { reason: 'core', winningTeam: winner, draw: winner < 0, placement: (p) => winner < 0 ? 1 : p.team === winner ? 1 : 2 };
        }
      }
      const gaveUp = surrenderSystem(w);
      if (gaveUp >= 0) {
        const others = teams.filter((t) => t !== gaveUp);
        const winner = others.length === 1 ? others[0] : -1;
        return { reason: 'surrender', winningTeam: winner, placement: (p) => p.team === gaveUp ? 2 : 1, draw: winner < 0 && others.length === 0 };
      }
      const limit = w.rules.end.timeLimit;
      if (limit !== undefined && w.time + 1e-9 >= limit) {
        const gold = (t: number): number => w.players.reduce((s, p) => s + (p && p.team === t ? p.goldEarned : 0), 0);
        const place = rankBy(teams, [(t) => w.teams[t].structuresDestroyed, (t) => w.teams[t].kills, gold], (t) => t);
        return teamOutcome(w, 'time', place);
      }
      return null;
    },
  };
}
