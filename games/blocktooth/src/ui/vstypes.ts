// BLOCKTOOTH ONLINE VS — the app-side description of a match (lane B-VIEW). TYPE-ONLY + two tiny pure helpers.
//
// The sim knows seats by slot (PlayerState); the APP knows who they are: a display name, human or bot, the seat
// colour. Offline VS PRACTICE fills this from the select screen; the online session (B-NET START message) will fill
// the same shape from the lobby. Views and the VS HUD read it, the sim never does.

import type { BiomeId, TitanId } from '../core/types.ts';
import type { BotLevel } from '../vs/types.ts';

export interface VsSeatInfo {
  slot: number;
  titan: TitanId;
  /** short display name: "YOU", a guest / account name, or a bot call-sign ("UNIT 9 — LOOSE PERMIT") */
  name: string;
  /** the second line of a bot name (the call-sign), '' for a human */
  sign: string;
  bot: boolean;
  level: BotLevel | null;
  /** #rrggbb seat colour (VS.seatColors[slot]) */
  color: string;
}

export interface VsMatchInfo {
  seats: VsSeatInfo[];
  /** the local human's seat (World.view may differ while spectating) */
  local: number;
  biome: BiomeId;
  seed: number;
  /** cosmetic palette per seat (select screen; 0 = canonical) */
  palettes: number[];
}

/** what the VS HUD needs of one projected seat this frame (render/vsview.ts frame()) */
export interface VsAnchor {
  slot: number;
  /** CSS px of the head anchor (on screen) or of the clamped edge point (off screen) */
  x: number; y: number;
  onScreen: boolean;
  /** off screen: direction of the arrow (radians, 0 = right, +π/2 = down) */
  angle: number;
  /** ground distance from the followed titan, metres */
  distM: number;
  /** on-screen body height in CSS px (0 off screen): drives the "much smaller" pip */
  pxH: number;
  live: boolean;
}

export interface VsTenderAnchor {
  gate: string;
  state: string;
  x: number; y: number;
  onScreen: boolean;
  angle: number;
  distM: number;
}

export interface VsFrame {
  seats: VsAnchor[];
  tenders: VsTenderAnchor[];
}

/** the 4 seat colours as #rrggbb (also in core/config.ts VS.seatColors — this is the fallback for tests without it) */
export const SEAT_COLORS: readonly string[] = ['#ff5a6e', '#4dabff', '#ffc93c', '#b57bff'];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
