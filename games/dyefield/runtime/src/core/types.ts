// DYEFIELD — shared core types (CONTRACT §2). THREE-free: imported by the sim, the view and Node probes.
// erasableSyntaxOnly is on: no enums / namespaces / parameter properties anywhere in the project.

/**
 * Paint-atlas crew byte. 0 = neutral (undyed). TEAMS mode: 1 = SUNCREW (side A), 2 = GULF CREW (side B).
 * FFA mode (CHANGED(CORE), CONTRACT_FFA §F1/§F6): 1..8 = the eight crews of data/teams.json → ffa, one per runner.
 */
// A plain number (0..CREW_SLOTS-1), not a literal union: pre-FFA code indexes 3-tuples by TeamId (paint/atlas.ts
// recountWeighted, probe_paint) and stays valid.
export type TeamId = number;
export const TEAM_NONE = 0 as const;
export const TEAM_SUN = 1 as const;
export const TEAM_GULF = 2 as const;
/** CHANGED(CORE): FFA crews are 1..FFA_CREWS_MAX */
export const FFA_CREWS_MAX = 8;
/** CHANGED(CORE): length of a "by crew id" array (index 0 = neutral) */
export const CREW_SLOTS = 9;

export type Side = 'A' | 'B';

/** CHANGED(CORE): TEAMS · 4 v 4 (the default, the shipped game) or FREE-FOR-ALL (8 runners, each its own crew). */
export type MatchMode = 'teams' | 'ffa';
export const MATCH_MODES: readonly MatchMode[] = ['teams', 'ffa'];

/** A mode from a query param / CLI flag / saved setting (case-insensitive; 'free-for-all' / 'freeforall' → 'ffa');
 *  anything else → `fallback`. */
export function parseMatchMode(raw: string | null | undefined, fallback: MatchMode = 'teams'): MatchMode {
  const k = (raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (k === 'ffa' || k === 'free-for-all' || k === 'freeforall') return 'ffa';
  if (k === 'teams' || k === 'team' || k === '4v4' || k === '4-v-4') return 'teams';
  return fallback;
}

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
  /**
   * World-space point the shot should travel toward (the reticle's raycast hit for a human, the
   * target for a bot). When hasAim is false the sim aims along yaw/pitch.
   */
  hasAim: boolean;
  aimX: number;
  aimY: number;
  aimZ: number;
}

export function emptyIntent(): PlayerIntent {
  return {
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, fire: false, slick: false, sub: false, special: false,
    hasAim: false, aimX: 0, aimY: 0, aimZ: 0,
  };
}

/** Coverage fractions of the weighted paintable total (sum = 1). TEAMS view (FFA: Painter.coverageByTeam()). */
export interface Coverage { sun: number; gulf: number; neutral: number }
