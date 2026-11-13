// DYEFIELD — match simulation events (CONTRACT §10.2 + CHANGED(KITSIM)). THREE-free, DOM-free.
// The sim pushes these into MatchWorld's queue; the view / HUD / audio / probes drain them. The view
// reads events and never writes gameplay (doctrine §4).

import type { TeamId } from '../types.ts';

export type MatchPhase = 'countdown' | 'live' | 'ended';

export type SimEvent =
  | { t: 'shot'; pid: number; kit: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { t: 'dry'; pid: number }
  | { t: 'splat'; x: number; y: number; z: number; r: number; team: TeamId; nx: number; ny: number; nz: number; flips: number }
  | { t: 'hit'; victim: number; by: number; dmg: number; x: number; y: number; z: number }
  | { t: 'washed'; victim: number; by: number | null; cause: 'dye' | 'sea' | 'sub' | 'special' }
  | { t: 'respawn'; pid: number }
  | { t: 'slick'; pid: number; on: boolean; wall: boolean }
  | { t: 'jump'; pid: number }
  | { t: 'land'; pid: number; hard: boolean }
  | { t: 'tankLow'; pid: number }
  /** CHANGED(CONTROLS) (CONTRACT_CONTROLS §C2): phase 'denied' = a SPECIAL press that will not start because the meter is
   *  not full and will not fill within KITS.specialBufferSeconds (x, y, z = the presser's feet; the meter is
   *  runners[pid].special). Pushed on the press tick when the meter is further from full than one wash + a little paint,
   *  else when the waiting press runs out still short. Never pushed for a full meter. */
  | { t: 'special'; pid: number; id: string; phase: 'ready' | 'start' | 'end' | 'denied'; x: number; y: number; z: number }
  | { t: 'sub'; pid: number; id: string; phase: 'throw' | 'land' | 'pop'; x: number; y: number; z: number }
  | { t: 'horn'; kind: 'start' | 'minute' | 'final10' | 'end' }
  | { t: 'phase'; phase: MatchPhase }
  // ── phase 6 (CHANGED(KITSIM), CONTRACT §10.2) ──
  /** NEEDLE-GLINT: every 0.1 s while charging (origin = muzzle, dir = aim); visible to enemies */
  | { t: 'glint'; pid: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; charge: number }
  /** NEEDLE-GLINT release: the hitscan beam from the muzzle to its end point */
  | { t: 'beam'; pid: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; charge: number }
  /** POP-WELL explosion (r = splashRadius; air = airburst at maxRange) */
  | { t: 'burst'; pid: number; x: number; y: number; z: number; r: number; air: boolean }
  /** SHEET-DRUM drum down (rolling) / up */
  | { t: 'roll'; pid: number; on: boolean }
  /** SHEET-DRUM flick windup starts */
  | { t: 'flick'; pid: number }
  /** WELLSPRING slam (r = ringRadius) */
  | { t: 'ring'; pid: number; x: number; y: number; z: number; r: number }
  // ── CHANGED(WASHOUT) (CONTRACT_WASHOUT §W2) ──
  /** WASHOUT only: a credited wash scored one point for `crew` (its new total `score`); `pid` = the credited runner.
   *  Pushed right after that wash's 'washed' event. Never pushed in TURF. */
  | { t: 'score'; crew: TeamId; score: number; pid: number }
  // ── CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S2) ──
  /** FFA only: runner `pid` spawned at site `site` (an index into MatchWorld.spawnSites; = Runner.spawnSite): its feet
   *  (x, y, z) and facing `yaw` (RADIANS) right after the spawn. One per runner at construction (the match-start sites,
   *  drained with the first tick's events), then one per respawn, pushed right after that respawn's 'respawn' event.
   *  Never pushed in teams. */
  | { t: 'spawn'; pid: number; site: number; x: number; y: number; z: number; yaw: number };

export type SimEventType = SimEvent['t'];
