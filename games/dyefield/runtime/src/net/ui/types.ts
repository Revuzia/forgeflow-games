// DYEFIELD — the online API the LOBBY-UI screens are written against (CONTRACT_ONLINE §O11.1, verbatim).
//
// SYNC implements `OnlineApi` in runtime/src/net/api.ts. Until that lands, the screens build and test against
// ./mock.ts. These are structural types: SYNC's object satisfies them as long as both follow §O11.1, so at
// integration this file can become `export type * from '../api.ts'` (or stay as is) without touching the screens.
// Nothing here is a runtime value: importing it costs no bytes.

export type OnlineMode = 'teams' | 'ffa';
export type OnlineRule = 'turf' | 'washout';
export type OnlineSkill = 'breeze' | 'swell' | 'storm';
export interface OnlineProfile { name: string; kit: string; crew: 0 | 1 | 2; ffaColor: number }
export interface RoomMember {
  slot: number; name: string; kit: string; crew: number; color: number;
  device: 'kbm' | 'touch'; conn: boolean; owner: boolean; host: boolean; rttMs: number | null;
}
export interface RoomView {
  code: string; quick: boolean; mode: OnlineMode; rule: OnlineRule;
  map: string /* id | 'random' */; preset: string; skill: OnlineSkill;
  phase: 'room' | 'loading' | 'live' | 'post'; matchNo: number; members: RoomMember[];
  mySlot: number; ownerSlot: number; hostSlot: number;
}
export type NetErrorCode = 'room_full' | 'not_found' | 'busy' | 'build' | 'proto' | 'quota' | 'rate' | 'origin'
  | 'bad' | 'network' | 'unsupported' | 'kicked';
export type NetStatus =
  | { kind: 'idle' } | { kind: 'connecting' }
  | { kind: 'queue'; waiting: number; waitedS: number } | { kind: 'solo' }
  | { kind: 'room'; room: RoomView }
  | { kind: 'error'; code: NetErrorCode; msg: string } | { kind: 'closed'; why: string };
export interface OnlineHudState {
  rttMs: number | null; quality: 'good' | 'ok' | 'bad'; host: boolean;
  hostName: string; migrating: boolean;
  players: Array<{ runner: number; name: string; human: boolean; conn: boolean; rttMs: number | null }>;
}
export type OnlineEvent =
  | { t: 'joined'; name: string } | { t: 'left'; name: string } | { t: 'botTakeover'; runner: number }
  | { t: 'migrating' } | { t: 'migrated'; hostName: string } | { t: 'kicked'; why: string }
  | { t: 'resynced' } | { t: 'voided'; why: string };
export interface OnlineApi {
  quickMatch(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void;
  createRoom(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void;
  joinRoom(code: string, p: OnlineProfile): void;
  setProfile(p: Partial<OnlineProfile>): void;
  configure(c: Partial<{ mode: OnlineMode; rule: OnlineRule; map: string; preset: string;
    skill: OnlineSkill }>): void;          // owner only
  start(): void; kick(slot: number): void; rematch(): void;  // owner / post
  keepWaiting(): void; playBotsInstead(): void; leave(): void;
  status(): NetStatus; onStatus(cb: (s: NetStatus) => void): () => void;
  hud(): OnlineHudState | null; onEvent(cb: (e: OnlineEvent) => void): () => void;
  inviteUrl(): string | null;
}

// ───────────────────────────── UI-side constants (CONTRACT_ONLINE §O16 / §O4) ─────────────────────────────
/** §O16 CODE_ALPHABET: no I, O, 0 or 1 (nothing ambiguous on a phone keyboard or read aloud) */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
/** §O16 MAX_HUMANS */
export const MAX_HUMANS = 8;
/** §O16 QM_SOLO_WAIT_S / REMATCH_WINDOW_S / QM_AUTOSTART_S (the UI only shows them) */
export const QM_SOLO_WAIT_S = 45;
export const REMATCH_WINDOW_S = 20;
export const QM_AUTOSTART_S = 8;
/** §O9.5 latency table: > 250 ms shows a HIGH PING badge */
export const HIGH_PING_MS = 250;

/** upper-case, keep only alphabet characters, at most CODE_LENGTH (the JOIN ROOM field and ?room= deep links) */
export function cleanCode(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.toUpperCase() : '';
  let out = '';
  for (const ch of s) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length >= CODE_LENGTH) break;
  }
  return out;
}

/** the SETTINGS the online UI follows (SettingsStore satisfies it): REDUCE MOTION; COLORBLIND is read from html.df-cb */
export interface UiSettingsLike {
  get(): Readonly<{ reduceMotion?: boolean }>;
  on?(fn: () => void): () => void;
}

/** REDUCE MOTION: the SETTINGS toggle when given, else the OS preference */
export function reduceMotionOn(s?: UiSettingsLike | null): boolean {
  const v = s?.get().reduceMotion;
  if (typeof v === 'boolean') return v;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** COLORBLIND MARKS (ui/hud.ts applyTeamCssVars sets html.df-cb): the crew chips take the colorblind pair */
export function colorblindOn(): boolean {
  try { return document.documentElement.classList.contains('df-cb'); } catch { return false; }
}

/** §O4.1: online needs WebSocket + CompressionStream (the keyframe's deflate-raw) */
export function onlineSupported(): boolean {
  try {
    return typeof WebSocket === 'function' && typeof (globalThis as { CompressionStream?: unknown }).CompressionStream === 'function';
  } catch { return false; }
}
