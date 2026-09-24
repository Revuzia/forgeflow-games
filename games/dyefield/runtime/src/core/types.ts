// DYEFIELD — shared core types (CONTRACT §2). THREE-free: imported by the sim, the view and Node probes.
// erasableSyntaxOnly is on: no enums / namespaces / parameter properties anywhere in the project.

/** Paint-atlas team byte. 0 = neutral (undyed), 1 = SUNCREW (side A), 2 = GULF CREW (side B). */
export type TeamId = 0 | 1 | 2;
export const TEAM_NONE = 0 as const;
export const TEAM_SUN = 1 as const;
export const TEAM_GULF = 2 as const;

export type Side = 'A' | 'B';

export interface Vec3 { x: number; y: number; z: number }

/** Yaw convention (everywhere): radians, 0 faces +Z, +π/2 faces +X. forward = (sin yaw, 0, cos yaw). */
export function forwardFromYaw(yaw: number): Vec3 {
  return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
}

export const DEG = Math.PI / 180;

/** Movement state machine (DESIGN §4). Phase 1–2 use WALK / AIR only; the rest land in phase 3. */
export type MoveState = 'walk' | 'slog' | 'slick' | 'wallslick' | 'air';

/** One tick of player intent, produced by input (human) or a bot. Axes are camera-relative. */
export interface PlayerIntent {
  /** strafe −1..1 (+1 = right) */
  moveX: number;
  /** forward −1..1 (+1 = away from camera) */
  moveZ: number;
  /** camera yaw (radians, CONTRACT yaw convention) — movement is rotated by this */
  yaw: number;
  /** camera pitch (radians, + = look up) */
  pitch: number;
  jump: boolean;
  /** primary (phase 2: the dev brush — dyes under the feet; phase 4+: the kit) */
  fire: boolean;
  /** SHIFT — slick / drink (phase 3) */
  slick: boolean;
  sub: boolean;
  special: boolean;
}

export function emptyIntent(): PlayerIntent {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, fire: false, slick: false, sub: false, special: false };
}

/** Coverage fractions of the weighted paintable total (sum = 1). */
export interface Coverage { sun: number; gulf: number; neutral: number }
