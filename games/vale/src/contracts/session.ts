// VALE — session + profile seam (CONTRACT §7, §8). Types only.
//
// SESSION MODEL (explicit): this slice is LOCAL. Matchmaking, draft and the match simulation run in
// the browser with bots in every open seat (LocalSession). The seam for a dedicated server is this
// interface: a RemoteSession would implement the same methods over a socket, the Sim would run on
// the server, and MatchClient.view would be rebuilt from snapshots. The UI and presentation only
// ever talk to `Session`, never to the Sim or to the profile store directly.
//
// IDENTITY: there are no accounts. IdentityProvider returns a LocalIdentity created on first boot.
// LOGIN SEAM: a LoginIdentityProvider replaces LocalIdentityProvider, and a RemoteProfileStore
// replaces LocalProfileStore; nothing above them changes.

import type { Command, MatchResult, MatchSetup, PlayerId, SimEvent, WorldView, LoadoutChoice } from './sim.ts';

// ── identity ────────────────────────────────────────────────────────────────────────────────────
export interface Identity { id: string; displayName: string; kind: 'local' | 'account'; createdAt: string }
export interface IdentityProvider {
  current(): Identity;
  rename(name: string): Identity;
  /** future: 'account' providers sign in/out; the local provider reports false */
  readonly canSignIn: boolean;
}

// ── profile (persisted; versioned with migrations) ───────────────────────────────────────────────
export const PROFILE_SCHEMA = 1 as const;

export interface LedgerEntry {
  txn: string;                 // unique id
  at: string;                  // ISO time
  currency: string;            // CurrencyDef id
  delta: number;               // + grant, − spend
  balance: number;             // balance after this entry
  reason: 'match_grant' | 'first_win' | 'purchase' | 'starter' | 'refund' | 'migration';
  ref?: string;                // matchId or sku
}
/** ownership is an explicit record, never implied by a flag */
export interface OwnershipRecord {
  id: string;                  // unique record id
  sku: string;                 // Offer sku or 'starter:<skinId>'
  kind: 'skin';
  ref: string;                 // SkinDef id
  fighter: string;
  acquiredAt: string;
  source: 'starter' | 'purchase' | 'grant';
  txn?: string;                // ledger txn that paid for it
  price?: { currency: string; amount: number };
  catalogVersion: string;
}
export interface RatingRecord { ratingId: string; rating: number; rd: number; vol: number; games: number; wins: number; peak: number; provisional: boolean; updatedAt: string }
export interface MatchHistoryEntry {
  matchId: string; at: string; queue: string; mode: string; fighter: string; skin: string;
  won: boolean; placement: number; kills: number; deaths: number; assists: number; cs: number; duration: number;
  grants: GrantSummary; ratingDelta?: number;
}
export interface Settings {
  video: { preset: 'low' | 'medium' | 'high' | 'ultra' | 'custom'; renderScale: number; shadows: 0 | 1 | 2 | 3; ao: 0 | 1 | 2; bloom: boolean;
    antialias: 'off' | 'smaa' | 'msaa'; particles: 0 | 1 | 2; scatter: 0 | 1 | 2; fpsCap: 0 | 30 | 60 | 120 | 144; maxDpr: number; fullscreen: boolean };
  audio: { master: number; music: number; sfx: number; voice: number; ui: number; ambience: number; muteInBackground: boolean };
  controls: { binds: Record<string, string>; quickCast: boolean; cameraLock: boolean; edgePan: boolean; panSpeed: number; attackMoveOnClick: boolean; selfCastModifier: string };
  access: { colorblind: 'off' | 'deutan' | 'protan' | 'tritan'; uiScale: number; hudScale: number; minimapScale: number; reduceMotion: boolean; screenShake: number; subtitles: boolean };
  gameplay: { showDamageNumbers: boolean; showAllyIndicators: boolean; healthBarTicks: boolean; minimapSide: 'right' | 'left' };
}
export interface Profile {
  schema: typeof PROFILE_SCHEMA;
  identity: Identity;
  level: number; xp: number;
  wallet: Record<string, number>;
  ledger: LedgerEntry[];
  owned: OwnershipRecord[];
  equipped: Record<string, string>;          // fighter id → skin id (must be owned)
  loadouts: Record<string, LoadoutChoice>;   // fighter id → last setup choice
  ratings: Record<string, RatingRecord>;
  history: MatchHistoryEntry[];              // newest first, capped at 50
  firstWinAt?: string;                       // last first-win-of-the-day grant (ISO)
  settings: Settings;
  seenCatalogVersion?: string;
  tutorialsSeen: string[];
}
export interface ProfileStore {
  load(): Profile | null;
  save(p: Profile): void;
  reset(): void;
}

// ── grants (computed by the GrantService — server-authoritative in a live deployment) ─────────────
export interface GrantSummary {
  currency: Record<string, number>;
  xp: number;
  levelBefore: number; levelAfter: number;
  firstWin: boolean;
  lines: { label: string; currency?: string; amount: number }[];
  ratingBefore?: number; ratingAfter?: number; tierBefore?: string; tierAfter?: string;
}

// ── matchmaking / lobby / draft ─────────────────────────────────────────────────────────────────
export interface PartyMember { id: string; name: string; isBot: boolean; ready: boolean; role?: string }
export interface QueueRequest {
  queue: string;
  roles?: [string, string?];            // primary/secondary role preference (Rift)
  custom?: CustomLobbyConfig;
  practice?: MatchSetup['practice'];
}
export interface CustomLobbyConfig {
  mode: string; map: string;
  seats: { team: number; kind: 'you' | 'bot' | 'open'; difficulty?: 'novice' | 'adept' | 'veteran'; fighter?: string }[];
  rulesOverride?: Record<string, unknown>;
}

export type DraftPhase = 'ban' | 'pick' | 'trade' | 'finalize' | 'bench' | 'done';
export interface DraftSeat {
  player: PlayerId; team: number; name: string; isBot: boolean; isYou: boolean;
  role?: string; hover?: string; locked?: string; skin?: string; loadout?: LoadoutChoice;
  rerolls?: number;
}
export interface DraftState {
  queue: string; mode: string;
  phase: DraftPhase;
  /** whose turn (seat players) and what action */
  turn: { players: PlayerId[]; action: 'ban' | 'pick' | 'free' } | null;
  timer: number; timerMax: number;
  seats: DraftSeat[];
  bans: { team: number; fighter: string | null }[];
  /** Bridge: the shared bench per team */
  bench: Record<number, string[]>;
  available: string[];                  // fighter ids still pickable
  log: string[];
}
export type DraftAction =
  | { a: 'hover'; fighter: string } | { a: 'lock' } | { a: 'ban'; fighter: string } | { a: 'skin'; skin: string }
  | { a: 'loadout'; loadout: LoadoutChoice } | { a: 'benchSwap'; fighter: string } | { a: 'reroll' }
  | { a: 'tradeRequest'; with: PlayerId } | { a: 'tradeAccept'; with: PlayerId };

// ── the live match as the client sees it ─────────────────────────────────────────────────────────
export interface MatchClient {
  readonly setup: MatchSetup;
  readonly you: PlayerId;
  readonly view: WorldView;
  /** fraction (0..1) between the last two sim ticks, for render interpolation */
  readonly alpha: number;
  send(cmd: Command): void;
  onEvents(cb: (events: SimEvent[]) => void): () => void;
  /** advance the local host by real elapsed seconds (no-op for a remote host). Returns ticks run. */
  pump(dtSeconds: number): number;
  /** practice tool / dev: 0 pauses, 1 normal, up to 16 fast-forward (local host only) */
  setTimeScale(s: number): void;
  readonly timeScale: number;
  leave(): void;
}

export type SessionEvent =
  | { type: 'queue'; state: 'idle' | 'searching' | 'found' | 'accepted' | 'declined'; queue?: string; elapsed?: number; estimate?: number }
  | { type: 'draft'; state: DraftState }
  | { type: 'loading'; setup: MatchSetup; progress: number }
  | { type: 'match'; client: MatchClient }
  | { type: 'postgame'; result: MatchResult; grants: GrantSummary; you: PlayerId }
  | { type: 'profile'; profile: Profile }
  | { type: 'error'; message: string };

export interface Session {
  readonly kind: 'local' | 'remote';
  readonly identity: Identity;
  profile(): Profile;
  on(cb: (e: SessionEvent) => void): () => void;
  // party + queue
  party(): PartyMember[];
  queue(req: QueueRequest): void;
  acceptMatch(): void;
  cancelQueue(): void;
  // draft
  draft(action: DraftAction): void;
  // match
  currentMatch(): MatchClient | null;
  /** loading screen finished (assets ready): start the clock */
  matchReady(): void;
  // economy (server-authoritative in a live deployment)
  purchase(sku: string): { ok: true; record: OwnershipRecord } | { ok: false; reason: 'unknown_sku' | 'owned' | 'funds' | 'unavailable' };
  equipSkin(fighter: string, skin: string): { ok: boolean; reason?: string };
  saveLoadout(fighter: string, loadout: LoadoutChoice): void;
  updateSettings(patch: Partial<Settings>): void;
  rename(name: string): void;
  resetProfile(): void;
}
