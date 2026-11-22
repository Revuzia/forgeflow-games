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
// A player who drops is driven by a bot on the server (its commands broadcast like a human's) until they
// reconnect and send 'resume' (room + token from 'loading'): the server replays the ticks they missed and
// hands the seat back.

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

// FRIEND ROOMS (additive, protocol 1). A private room with a short code: 'froom_create' makes one (you are its host),
// 'froom_join' enters one by code, the host sets the queue and whether friends play on one team ('froom_set'), and
// 'froom_start' asks every member for a ticket ('froom_go' → 'froom_ticket', the same request + profile as 'queue'). The
// server then opens an ordinary Room with every member already accepted; empty seats are filled as in matchmaking.
// The room outlives its matches: after the post-game everyone is still in it, and can start again.
/** queue kinds a friend room may play (never ranked: the ladder is for strangers) */
export const FRIEND_ROOM_KINDS = ['standard', 'coop'] as const;
export const FRIEND_CODE_LEN = 5;
/** no 0/O, 1/I/L: a code read out loud or copied by hand still lands */
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export interface FriendRoomState {
  code: string;
  queue: string;
  /** friends share one team (true) or are spread over the sides (false); FFA and co-op queues ignore it */
  together: boolean;
  /** humans the room can seat for this queue + side */
  max: number;
  you: string;
  host: string;
  members: { id: string; name: string; busy: boolean }[];
  /** a start is collecting tickets */
  starting: boolean;
}
/** why a friend-room request failed (strings: froom.error.<reason>) */
export type FriendRoomError = 'no_room' | 'full' | 'busy' | 'not_host' | 'bad_queue' | 'in_room';

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
  /** back after a dropped connection: resume your seat; the server replays ticks n >= from */
  | { t: 'resume'; room: string; token: string; from: number }
  | { t: 'leave' }
  | { t: 'froom_create'; queue: string; together: boolean }
  | { t: 'froom_join'; code: string }
  | { t: 'froom_set'; queue?: string; together?: boolean }
  | { t: 'froom_start' }
  | { t: 'froom_ticket'; req: QueueRequest; profile: NetProfile }
  | { t: 'froom_leave' };

export type QueueSessionEvent = Extract<SessionEvent, { type: 'queue' }>;

export type ServerMsg =
  | { t: 'welcome'; id: string; online: number }
  | { t: 'stats'; online: number; searching: Record<string, number> }
  | { t: 'queue'; e: QueueSessionEvent }
  | { t: 'draft'; s: DraftState }
  /** room + token let you resume your seat after a dropped connection */
  | { t: 'loading'; setup: MatchSetup; you: PlayerId; room: string; token: string }
  | { t: 'start'; tick: number }
  /** tick n: apply these human commands, then step */
  | { t: 'tick'; n: number; c?: [PlayerId, Command][] }
  /** after a resume: the ticks you missed, in order */
  | { t: 'replay'; ticks: { n: number; c?: [PlayerId, Command][] }[] }
  | { t: 'end'; result: MatchResult }
  | { t: 'desync'; n: number }
  | { t: 'error'; m: string }
  /** your friend room as it is now; null = you are in none */
  | { t: 'froom'; room: FriendRoomState | null }
  /** the host started: answer with 'froom_ticket' for this queue */
  | { t: 'froom_go'; queue: string }
  | { t: 'froom_error'; reason: FriendRoomError };
