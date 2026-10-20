// VALE contracts — the online protocol (CONTRACT §7.2). One WebSocket per client to the game server
// (server/). JSON messages, one per frame.
//
// LOCKSTEP. The sim is deterministic on every engine (src/sim/dmath.ts, probe_sim_dmath), so a match is
// the setup + the ordered stream of human commands: the server runs the authoritative sim (bots
// included) at 30 Hz and, every tick n, broadcasts the human commands it applied before stepping n; each
// client applies the same commands and steps its own sim, rendering locally with no state traffic.
// Clients send a state digest every DIGEST_EVERY ticks; a mismatch is reported ('desync').
//
// FLOW. hello → welcome. queue → searching … found (ready check) → accept/decline → draft (the server
// runs the DraftHost; each seat gets its own view) → loading (the MatchSetup + your seat) → ready (assets
// loaded) → start → tick … → end (the server's result). The client books grants and history from the
// result exactly as a local match (LocalSession.finishMatch). Practice and custom lobbies stay local.
// A player who drops is driven by a bot on the server (its commands broadcast like a human's).

import type { DraftAction, DraftState, QueueRequest, SessionEvent } from './session.ts';
import type { Command, LoadoutChoice, MatchResult, MatchSetup, PlayerId } from './sim.ts';

export const NET_PROTOCOL = 1;
/** clients digest their state every this many ticks (≈ 2 s) */
export const DIGEST_EVERY = 60;

/** what the server needs about a player to seat them: name, skins they may wear, saved loadouts */
export interface NetProfile {
  name: string;
  /** fighter → skins this player may wear (first = equipped) */
  skins: Record<string, string[]>;
  /** fighter → saved loadout */
  loadouts: Record<string, LoadoutChoice>;
  /** rating in this queue's ladder (ranked bot difficulty) */
  rating?: number;
}

export type ClientMsg =
  | { t: 'hello'; v: number; catalog: string; name: string }
  | { t: 'queue'; req: QueueRequest; profile: NetProfile }
  | { t: 'cancel' }
  | { t: 'accept' }
  | { t: 'decline' }
  | { t: 'draft'; a: DraftAction }
  | { t: 'ready' }
  | { t: 'cmd'; c: Command }
  | { t: 'digest'; n: number; h: string }
  | { t: 'leave' };

export type QueueSessionEvent = Extract<SessionEvent, { type: 'queue' }>;

export type ServerMsg =
  | { t: 'welcome'; id: string; online: number }
  | { t: 'stats'; online: number; searching: Record<string, number> }
  | { t: 'queue'; e: QueueSessionEvent }
  | { t: 'draft'; s: DraftState }
  | { t: 'loading'; setup: MatchSetup; you: PlayerId }
  | { t: 'start'; tick: number }
  /** tick n: apply these human commands, then step */
  | { t: 'tick'; n: number; c?: [PlayerId, Command][] }
  | { t: 'end'; result: MatchResult }
  | { t: 'desync'; n: number }
  | { t: 'error'; m: string };
