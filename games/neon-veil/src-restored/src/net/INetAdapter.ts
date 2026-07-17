// net/INetAdapter.ts — network transport abstraction for Neon Veil.
//
// Type-only module, elided from the shipped bundle and reconstructed from its
// single implementer, LocalBotAdapter (net/LocalBotAdapter.ts), which declares
// `implements INetAdapter`. Every member below matches a public member of that
// class; the concrete offline adapter simulates bots + pilot counts locally so
// the same surface can later be backed by a real online transport.

import type { KillEvent, PlayerState } from '../core/types';

export interface INetAdapter {
  /** Id of the local player in the player map (LocalBotAdapter uses 'local'). */
  readonly localId: string;

  /** Join / initialise a session for the given callsign. */
  connect(callsign: string): Promise<void>;

  /** Tear the session down and drop all players. */
  disconnect(): void;

  /** (Re)spawn `count` bots; team mode assigns alternating team ids. */
  spawnBots(count: number, teamMode: boolean): void;

  /** All players (local + bots). */
  getPlayers(): PlayerState[];

  /** The local player's state. */
  getLocal(): PlayerState;

  /** Look up a player by id (undefined if absent). */
  getPlayer(id: string): PlayerState | undefined;

  /** Patch the local player's state. */
  pushLocal(partial: Partial<PlayerState>): void;

  /** Patch an arbitrary player's state. */
  updatePlayer(id: string, partial: Partial<PlayerState>): void;

  /** Apply a kill event (increments killer score, marks victim dead). */
  onKill(ev: KillEvent): void;

  /** Displayed "pilots flying" count (simulated lobby size + live players). */
  getPilotCount(): number;

  /** Per-frame update (e.g. simulated ping jitter). */
  tick(dt: number): void;
}
