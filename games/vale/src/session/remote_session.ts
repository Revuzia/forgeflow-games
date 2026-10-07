// VALE session — RemoteSession: the dedicated-server seam (CONTRACT §7). NOT AVAILABLE IN THIS BUILD:
// every method throws. It exists so the UI/render/audio code is written against `Session`, never
// against LocalSession, and so the server work has a precise list of what to replace.
//
// PROTOCOL SKETCH (what a live implementation does behind the same interface):
//   transport   one WebSocket (or WebTransport where available) per client to the session service;
//               JSON control messages + binary match frames; a version handshake (client build,
//               CLIENT_SCHEMAS, catalog version) lets the server refuse or upgrade stale clients.
//   identity    a LoginIdentityProvider (identity.ts) signs in; the socket authenticates with its
//               token; `identity` mirrors the account.
//   profile     a RemoteProfileStore: profile() is a cached copy of the server's profile; the
//               server pushes 'profile' after every grant/purchase/equip/settings change.
//   queue       queue()/acceptMatch()/declineMatch()/cancelQueue() send intents; the matchmaker
//               (tickets → match function → director, research r08 §4.4) answers with the same
//               'queue' events LocalSession emits (searching/found/accepted/declined + lockout).
//   draft       draft(action) sends the DraftAction; the server's DraftHost (the same draft.ts,
//               server-side) broadcasts per-seat DraftState views ('draft' events, hidden info kept
//               hidden on the server).
//   match       'loading' carries the MatchSetup; matchReady() reports assets loaded; the server
//               runs the Sim at 30 Hz. MatchClient.send() streams Commands; the server streams
//               snapshots (full keyframes every ~30 s + per-tick deltas) and SimEvent batches; the
//               client rebuilds a WorldView from snapshots and interpolates with `alpha`; pump() only
//               advances interpolation (returns 0 ticks); setTimeScale() is a no-op (server time);
//               leave() tells the server, which puts a bot in the seat and keeps the match running.
//               Reconnect = re-open the socket, receive the latest keyframe, apply later deltas.
//   post-game   grants, ratings, purchases and ownership are SERVER-AUTHORITATIVE: the client never
//               computes them; 'postgame' arrives with the server's GrantSummary; purchase() and
//               equipSkin() are requests answered by the server's ledger (economy.ts invariants run
//               there).

import type {
  DraftAction, Identity, MatchClient, OwnershipRecord, PartyMember, Profile, QueueRequest, Session, SessionEvent, Settings,
} from '../contracts/session.ts';
import type { LoadoutChoice } from '../contracts/sim.ts';

const NA = 'not available in this build';
function na(): never { throw new Error(`RemoteSession: ${NA}`); }

export class RemoteSession implements Session {
  readonly kind = 'remote' as const;
  /** the session service endpoint a live build would connect to */
  readonly endpoint: string;
  constructor(endpoint = '') { this.endpoint = endpoint; }

  get identity(): Identity { return na(); }
  profile(): Profile { return na(); }
  on(_cb: (e: SessionEvent) => void): () => void { return na(); }
  party(): PartyMember[] { return na(); }
  queue(_req: QueueRequest): void { na(); }
  acceptMatch(): void { na(); }
  declineMatch(): void { na(); }
  cancelQueue(): void { na(); }
  draft(_action: DraftAction): void { na(); }
  currentMatch(): MatchClient | null { return na(); }
  matchReady(): void { na(); }
  purchase(_sku: string): { ok: true; record: OwnershipRecord } | { ok: false; reason: 'unknown_sku' | 'owned' | 'funds' | 'unavailable' } { return na(); }
  equipSkin(_fighter: string, _skin: string): { ok: boolean; reason?: string } { return na(); }
  saveLoadout(_fighter: string, _loadout: LoadoutChoice): void { na(); }
  updateSettings(_patch: Partial<Settings>): void { na(); }
  rename(_name: string): void { na(); }
  resetProfile(): void { na(); }
  setPartyBots(_count: number): PartyMember[] { return na(); }
  playAgain(): void { na(); }
}
