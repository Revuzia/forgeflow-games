// DYEFIELD — phase-2 Player compatibility shim (CONTRACT §10.2 / §10.4). THREE-free, DOM-free.
//
// The runner sim now lives in core/runner.ts (Runner). This file keeps the phase-2 API alive until
// main.ts / game.ts drive a MatchWorld: `new Player(team, body, spawn, { killY })` is a standalone
// Runner with the DEV_BRUSH on (HOLD fire dyes the floor under the feet) and instant respawn below
// killY. Delete this file once nothing imports it.

import type { TeamId } from './types.ts';
import type { CharacterBody, PhysicsWorld } from './physics.ts';
import { Runner, type SpawnPoint } from './runner.ts';

export { angleDelta, wrapAngle, Runner, type SpawnPoint, type PadZone, type RunnerOptions } from './runner.ts';

export interface PlayerOptions {
  /** feet below this y → respawn (maps.json killY) */
  killY?: number;
  /** optional: enables wall-slick + head-clearance checks in the shim */
  physics?: PhysicsWorld | null;
}

export class Player extends Runner {
  constructor(team: TeamId, body: CharacterBody, spawn: SpawnPoint, opts: PlayerOptions = {}) {
    super({ id: 0, name: 'YOU', team, kit: 'mist-rasp', bot: false }, body, spawn,
      { killY: opts.killY, physics: opts.physics ?? null, devBrush: true, autoRespawn: true });
  }
}
