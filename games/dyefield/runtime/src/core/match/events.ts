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
  | { t: 'special'; pid: number; id: string; phase: 'ready' | 'start' | 'end'; x: number; y: number; z: number }
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
  | { t: 'ring'; pid: number; x: number; y: number; z: number; r: number };

export type SimEventType = SimEvent['t'];
