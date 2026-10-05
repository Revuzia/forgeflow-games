// DYEFIELD online relay — wire constants, mirrored from games/dyefield/_spec/CONTRACT_ONLINE.md §O3 / §O8 / §O16.
// The DO reads only byte 0 (kind), byte 1 (slot) and the length of a binary frame, plus the u32 tick at bytes 2..5 of
// SNAP and HANDOFF frames (§O2.3, §O3.1). Everything else in a binary frame is opaque to the relay.

export const PROTO = 1;
export const WORKER_VERSION = 'dyefield-net/1.0.0';

// ---- binary kinds (§O3.2) ----
export const K_INTENTS = 0x01; // client -> host
export const K_SNAP = 0x02; // host -> all
export const K_KEYFRAME = 0x03; // host -> one (byte 1 = target slot)
export const K_HANDOFF = 0x04; // host -> all, then the Room migrates (§O6.2)
export const SLOT_ALL = 0xff;

// ---- size caps (§O3.2, §O8) ----
export const CAP_INTENTS = 512;
export const CAP_SNAP = 64 * 1024;
export const CAP_KEYFRAME = 2 * 1024 * 1024;
export const CAP_HANDOFF = 64 * 1024;
export const CAP_TEXT_CLIENT = 2 * 1024;
export const CAP_TEXT_HOST = 64 * 1024;
export const CAP_END_CACHE = 64 * 1024;

// ---- rates (§O8, §O16) ----
export const RATE_CLIENT = 60; // frames/s, burst 60
export const RATE_HOST = 150; // frames/s, burst 150
export const RATE_LOBBY = 5; // text frames/s, burst 5
export const ABUSE_DROPS = 200; // drops in ABUSE_WINDOW_MS -> close 4029
export const ABUSE_WINDOW_MS = 10_000;
export const KEYFRAME_MIN_GAP_MS = 1_000; // relay-side floor per target (the host's own rule is 10 s, §O5.3)

// ---- timing (§O16; every one can be overridden by a Worker var of the same name for tests) ----
export const DEFAULTS = {
  HOST_STALL_MS: 1500,
  HOST_PROMOTE_GRACE_MS: 1500, // extra time a freshly promoted host gets before the stall rule applies to it
  MAX_MIGRATIONS: 3,
  LATE_JOIN_MIN_LEFT_S: 45,
  PREMATCH_PING_IDLE_S: 120,
  ROOM_IDLE_CLOSE_MIN: 15,
  ROOM_RECLAIM_MIN: 30,
  RECONNECT_GRACE_S: 60, // a disconnected member's seat outside a match; a closed room's revive window
  QM_FILL_WAIT_S: 10,
  QM_MAX_WAIT_S: 20,
  QM_SOLO_WAIT_S: 45,
  QM_AUTOSTART_S: 8,
  REMATCH_WINDOW_S: 20,
  COUNTDOWN_S: 3,
  MATCH_S: 180,
  STATUS_CACHE_MS: 30_000, // Lobby + /room/new meter status cache
  HEALTH_CACHE_MS: 2_000, // /health per-isolate cache (blunts a /health flood; 0 in .dev.vars)
  LIVE_FLUSH_MS: 60_000, // Room -> Meter.add cadence while live (piggy-backed on traffic)
} as const;
export type TimingKey = keyof typeof DEFAULTS;

export const MAX_HUMANS = 8;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 4;
export const MAPS = ['pier18', 'lockwell', 'cinder'] as const;
export const SKILLS = ['breeze', 'swell', 'storm'] as const;
export const MODES = ['teams', 'ffa'] as const;
export const RULES = ['turf', 'washout'] as const;
export type Mode = (typeof MODES)[number];
export type Rule = (typeof RULES)[number];
export type Skill = (typeof SKILLS)[number];

// ---- close codes (§O3.3) ----
export const CLOSE_LEAVE = 4000;
export const CLOSE_NOT_FOUND = 4004;
export const CLOSE_KICKED = 4008;
export const CLOSE_FULL = 4009;
export const CLOSE_BUILD = 4026;
export const CLOSE_RATE = 4029;
export const CLOSE_QUOTA = 4030;
export const CLOSE_CLOSED = 4031;
export const CLOSE_TRY_LATER = 1013; // err busy (every claim attempt collided) — standard "try again later"

export type ErrCode = 'room_full' | 'not_found' | 'busy' | 'build' | 'proto' | 'quota' | 'rate' | 'origin' | 'bad';

// ---- validation ----
// §O2.2 says ^[a-z0-9.:-]{1,40}$, but §O3's NET_BUILD is VERSION + "+p" + PROTO + "+" + BUILD_ID, and BUILD_ID is
// the Vite entry-chunk hash (base64url: A–Z a–z 0–9 _ -). The relay accepts that superset; a '+' that arrived
// un-encoded (decoded to ' ' by URLSearchParams) is mapped back to '+' by the Worker before this check.
export const BUILD_RE = /^[A-Za-z0-9._:+-]{1,40}$/;
export const TOKEN_RE = /^[0-9a-f]{32}$/;
export const KIT_RE = /^[a-z0-9-]{1,24}$/;
export const PRESET_RE = /^[a-z0-9_-]{1,16}$/;

export function isMode(v: unknown): v is Mode {
  return v === 'teams' || v === 'ffa';
}
export function isRule(v: unknown): v is Rule {
  return v === 'turf' || v === 'washout';
}
export function isSkill(v: unknown): v is Skill {
  return v === 'breeze' || v === 'swell' || v === 'storm';
}
/** Upper-cases and checks a room code; null when it is not 4 characters of the room alphabet. */
export function normCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const c = v.toUpperCase();
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

// Bidi controls and other invisible format characters (§O8): stripped from names.
const BIDI_RE = /[؜​-‏‪-‮⁠-⁩﻿]/g;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/** §O8 name rule: NFC, control and bidi characters stripped, trimmed, ≤ 16 code points, empty → GUEST-xxxx. */
export function sanitizeName(v: unknown, rnd: () => number = Math.random): string {
  let s = typeof v === 'string' ? v : '';
  try {
    s = s.normalize('NFC');
  } catch {
    s = '';
  }
  s = s.replace(CTRL_RE, '').replace(BIDI_RE, '').trim();
  const cps = Array.from(s);
  if (cps.length > 16) s = cps.slice(0, 16).join('').trim();
  if (!s) {
    let tag = '';
    for (let i = 0; i < 4; i++) tag += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
    s = 'GUEST-' + tag;
  }
  return s;
}

export function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// ---- budget estimate (§O9.2 second table) ----
export interface Usage {
  units: number;
  raw: number;
}
/**
 * The per-match estimate used for admission (§O2.5). Calibrated on §O9.2's review table:
 * frames = 20/s per human over (duration + countdown + ~3 s load) (186 s for 3:00); pings 0.5/s per socket over
 * ~(duration + 50) s awake (230 s for 3:00); connections + RPCs ≈ 5 + 2.5 per human.
 * 2 humans → raw 7,680 / units 394 · 4 → 15,355 / 782 · 8 → 30,705 / 1,559 (table: 7,700/394 · 15,400/782 · 30,700/1,559).
 */
export function estimateMatch(humans: number, durationS: number = DEFAULTS.MATCH_S): Usage {
  const n = Math.max(1, Math.min(MAX_HUMANS, Math.floor(humans)));
  const d = Math.max(1, durationS);
  const frames = 20 * n * (d + 6);
  const pings = 0.5 * n * (d + 50);
  const other = Math.ceil(5 + 2.5 * n);
  return { raw: Math.ceil(frames + pings + other), units: Math.ceil((frames + pings) / 20) + other };
}

export function utcDay(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}
