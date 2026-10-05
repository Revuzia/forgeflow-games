// DYEFIELD — STATS lane shared types (_spec/CONTRACT_STATS.md §S1/§S2/§S5/§S9). THREE-free, DOM-free.
// Imported by the node probe (_harness/probe_stats.ts) and by the browser facade (stats/index.ts).

import type { MatchResult } from '../core/match/world.ts';
import type { BotSkill } from '../core/match/roster.ts';

export type { BotSkill };

/** §S2.1: the read-only slice of a match the recorder needs. MatchWorld satisfies it structurally (no adapter offline).
 *  countdownS / durationS are optional extras (MatchWorld has both): they give the exact live clock of §S2.1. */
export interface StatsWorldView {
  readonly mode: 'teams' | 'ffa';
  readonly rule: 'turf' | 'washout';
  readonly def: { readonly id: string };
  readonly phase: 'countdown' | 'live' | 'ended';
  readonly tick: number;
  readonly limit: number;
  readonly endedBy: 'horn' | 'limit' | null;
  readonly result: MatchResult | null;
  readonly runners: ReadonlyArray<{
    readonly id: number; readonly team: number; readonly kit: string;
    readonly bot: boolean; readonly washes: number; readonly washedCount: number; readonly painted: number;
  }>;
  readonly countdownS?: number;
  readonly durationS?: number;
}

/** §S9.1: what the online layer hands to matchBegin for an online match */
export interface OnlineMatchInfo {
  /** the online layer's own per-match id (never shown, never stored in the record) */
  matchId: string;
  /** my runner id in this match */
  localPid: number;
  role: 'host' | 'client';
  /** the room's bot tier (quick match: 'swell') */
  skill: BotSkill;
}

/** §S9.1: built by SYNC from the host's `end` message */
export interface OnlineFinal {
  /** end.result (carries endedBy) */
  result: MatchResult;
  /** runners whose seat is human-driven at the horn */
  humans: number;
  /** my seat's own totals (human-driven time only); null if I hold no seat at the end */
  me: { seatedLiveTicks: number; painted: number; washes: number; washedCount: number } | null;
}

export type OnlineEndStatus = 'complete' | 'void' | 'dropped';

/** §S10.2: the second argument of Stats.matchBegin */
export interface BeginInfo {
  kit: string;
  skill: BotSkill;
  online: OnlineMatchInfo | null;
  localPid: number;
}

/** §S2.2: one finished match, as stored */
export interface MatchRecord {
  id: string;
  at: number;
  v: 1;
  mode: 'teams' | 'ffa';
  rule: 'turf' | 'washout';
  map: string;
  kit: string;
  skill: BotSkill;
  online: boolean;
  humans: number;
  result: 'win' | 'loss' | 'draw';
  place: number;
  crews: number;
  turfPct: number;
  crewScore: number;
  washes: number;
  washed: number;
  paintedM2: number;
  specials: number;
  subs: number;
  splashdowns: number;
  bestStreak: number;
  liveS: number;
  endedBy: 'horn' | 'limit';
  score: number;
  scoreV: 1;
  eligible: boolean;
  dev?: true;
}

/** what the recorder hands the store: a finalized record (eligible or idle), an abandon, or a voided online match */
export type Outcome =
  | { k: 'record'; rec: MatchRecord }
  | { k: 'abandoned'; at: number }
  | { k: 'void'; at: number };

/** §S5.1 */
export interface WLD { m: number; w: number; l: number; d: number }

export type ModeKey = 'teams_turf' | 'teams_washout' | 'ffa_turf' | 'ffa_washout';

export interface CareerCounters {
  matches: number; wins: number; losses: number; draws: number;
  idle: number; abandoned: number;
  byMode: Record<ModeKey, WLD>;
  /** by kit id (the four shipping kits are always present; an unknown kit gets its own key) */
  byKit: Record<string, WLD>;
  /** by map id (the three shipping maps are always present) */
  byMap: Record<string, WLD>;
  online: WLD & { void: number };
  /** offline matches started at STORM */
  storm: WLD;
  podiums: number;
  limitWins: number;
  washes: number; washed: number; paintedM2: number; specials: number; subs: number; splashdowns: number;
  liveS: number;
}

export interface Bests { score: number; turfPctTeams: number; turfPctFfa: number; washes: number; paintedM2: number; streak: number }

export interface Slot {
  c: CareerCounters;
  best: Bests;
  /** slug → first-unlock time (ms); never removed */
  ach: Record<string, number>;
  /** the slot's last 5 eligible records, newest first */
  recent: MatchRecord[];
  at: number;
}

/** a local account bucket: the slot + local-only bookkeeping (never pushed) */
export interface AcctSlot extends Slot { since: number; achSyncAt: number }

export type OutboxItem = { k: 'ach'; slug: string } | { k: 'score'; score: number; at: number };

/** §S5.2 (+ pendingX: abandons / voids that happened while the account was unresolved — they are not MatchRecords) */
export interface LocalStore {
  v: 1;
  /** device token: 12 random base36 chars, made once */
  dev: string;
  guest: Slot;
  accts: Record<string, AcctSlot>;
  pending: MatchRecord[];
  pendingX: { abandoned: number; void: number };
  outbox: OutboxItem[];
  lastTag: string | null;
}

/** §S5.3: game_saves slot 1 */
export interface CloudRecord {
  v: 1;
  game: 'dyefield';
  tags: Record<string, number>;
  slots: Record<string, Slot>;
  [extra: string]: unknown;
}

/** §S3.1 */
export type PortalState = 'standalone' | 'probing' | 'signed-in' | 'guest';

/** one entry of __DF_STATS__.state().sent */
export interface SentEntry { type: string; slug?: string; score?: number; at: number }

export type AchTier = 'bronze' | 'silver' | 'gold';

/** §S6.1: one row of achievements.json (the seeder writes exactly these fields) */
export interface AchievementDef {
  slug: string;
  name: string;
  description: string;
  tier: AchTier;
  points: number;
  secret: boolean;
}

/** the display career the panel and the detectors read (§S5.4) */
export interface DisplayCareer { c: CareerCounters; best: Bests; ach: Record<string, number>; recent: MatchRecord[] }
