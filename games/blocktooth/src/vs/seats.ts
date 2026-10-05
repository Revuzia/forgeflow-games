// BLOCKTOOTH VS — seat handover: a human leaves (a bot takes the seat) / a human takes over a bot seat (vs_design.md §10).
// Lane B-VS. THREE-free, deterministic. Called by the net layer / app between ticks (or inside the lockstep frame that
// carries the leave / takeover), never from inside a tick.

import { VS } from '../core/config.ts';
import type { World } from '../core/types.ts';
import { createBotMemory } from './state.ts';
import type { BotLevel } from './types.ts';
import { matchClock } from './clock.ts';

/**
 * A human left: a bot brain takes the seat on the next tick (the titan keeps its level and build). The seat's earlier bot
 * memory (parked by a takeover) resumes if there is one. The leaver's placement for rating is 4th: that is the net layer's
 * call, flagged here as `vs.data.left = 1`. No-op for a seat that is already a bot.
 */
export function vsLeaveSeat(w: World, slot: number, level: BotLevel = 'regular'): void {
  const P = w.players[slot];
  if (!P || w.mode !== 'vs' || P.bot !== null) return;
  const mem = P.vs.sleeper ?? createBotMemory(level);
  mem.level = level;
  mem.inited = false;                                  // the titan may have moved a lot: restart stuck / plan memory
  P.bot = mem;
  P.vs.sleeper = null;
  P.vs.data.left = 1;
}

/** A human may take over a bot seat only during OPEN HOUSE up to VS.takeoverUntilS (3:00). */
export function canTakeOverSeat(w: World, slot: number): boolean {
  const P = w.players[slot];
  if (!P || w.mode !== 'vs' || !w.vs || w.vs.phase === 'over') return false;
  if (P.bot === null || P.vs.eliminated) return false;
  const c = matchClock(w);
  return c <= VS.takeoverUntilS && (w.vs.phase === 'countdown' || w.vs.phase === 'open');
}

/** A human takes over bot seat `slot`: inherits its titan, level and build. Returns false when not allowed. */
export function vsTakeOverSeat(w: World, slot: number): boolean {
  if (!canTakeOverSeat(w, slot)) return false;
  const P = w.players[slot];
  P.vs.sleeper = P.bot;                                // parked: a later leave resumes the same brain memory
  P.bot = null;
  P.vs.data.tookOver = 1;
  return true;
}
