// VALE bots — public entry (CONTRACT §5.7, lane BOTS).
//
//   createBots(catalog, setup) → (seat, host) => BotController | null
//     plug into createSim(catalog, setup, { bots: createBots(catalog, setup) }). Returns a controller
//     for every seat whose controller is 'bot' (null for humans, and in practice queues, where the
//     only opponents are the sim's training dummies). One factory serves one match; when the sim
//     rebuilds its world (practice resetMatch asks for the seats again) the factory starts a fresh
//     coordinator, so team brains and memories never leak across worlds.
//
//   createDraftBrain / pickLoadout / pickSkin — see draft.ts.
//
// Architecture (r09 §5): BotMatch (shared per tick: events, fog-honest perception, 2 Hz team
// brains) → Bot (5 Hz utility mode selection with hysteresis → mode executors → 30 Hz combat
// micro) → Commands identical to a human's. Difficulty (novice / adept / veteran) changes
// perception and execution only. Determinism: every draw comes from the seat's seeded stream
// (BotHost.rng = the sim's 'bots:<seat>' stream); no clocks, no Math.random.

import type { CatalogT } from '../../contracts/catalog.ts';
import type { MatchSetup, PlayerId, SeatSetup } from '../../contracts/sim.ts';
import type { BotController, BotHost } from '../sim.ts';
import { Bot } from './bot.ts';
import { difficultyOf } from './difficulty.ts';
import { buildKnowledge, buildPlan } from './knowledge.ts';
import { BotMatch } from './match.ts';
import { assignLanes, type LaneAssign } from './team.ts';

export { createDraftBrain, pickLoadout, pickSkin } from './draft.ts';
export { DIFFICULTIES, difficultyOf, type DifficultyId, type DifficultyProfile } from './difficulty.ts';
export type { GameKind } from './knowledge.ts';

export type BotFactory = (seat: SeatSetup, host: BotHost) => BotController | null;

export function createBots(catalog: CatalogT, setup: MatchSetup): BotFactory {
  const k = buildKnowledge(catalog, setup);
  const lanes = new Map<number, Map<PlayerId, LaneAssign>>();
  let match = new BotMatch(k);
  let made = new Set<PlayerId>();
  return (seat: SeatSetup, host: BotHost): BotController | null => {
    if (seat.controller !== 'bot' || k.kind === 'practice') return null;
    const prof = k.profiles.get(seat.fighter);
    if (!prof) return null;
    // asked for a seat twice: the sim built a new world (practice reset) — start over
    if (made.has(seat.player)) { match = new BotMatch(k); made = new Set(); }
    made.add(seat.player);
    let la = lanes.get(seat.team);
    if (!la) { la = assignLanes(k, seat.team); lanes.set(seat.team, la); }
    const a = la.get(seat.player);
    const plan = buildPlan(k.idx, k.rules, prof, !!a?.jungle);
    return new Bot(match, seat, difficultyOf(seat.botDifficulty), host.rng, prof, plan, !!a?.support || prof.style === 'warden');
  };
}
