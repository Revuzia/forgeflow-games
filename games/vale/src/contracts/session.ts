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
  /** CHANGED(SESSION), additive (client F15): the teammate you lit a Lantern nod for after this match (Session.nod) */
  nod?: PlayerId;
}
export interface Settings {
  video: { preset: 'low' | 'medium' | 'high' | 'ultra' | 'custom'; renderScale: number; shadows: 0 | 1 | 2 | 3; ao: 0 | 1 | 2; bloom: boolean;
    antialias: 'off' | 'smaa' | 'msaa'; particles: 0 | 1 | 2; scatter: 0 | 1 | 2; fpsCap: 0 | 30 | 60 | 120 | 144; maxDpr: number; fullscreen: boolean;
    /** CHANGED(RENDER), r12 M14, default true: the T0 ambient life (motes, flames, critters; ambient.ts). Not on the
     *  ladder: a preset never changes it; its density follows the tier. A stored profile without it reads true */
    ambientEffects: boolean;
    /** CHANGED(SESSION), additive optional (perf PERF-M2 step 5), default true: the renderer lowers its render scale for
     *  a moment when frames run long. session/settings.ts normalizeSettings always writes it; absent reads true */
    dynamicResolution?: boolean };
  audio: { master: number; music: number; sfx: number; voice: number; ui: number; ambience: number; muteInBackground: boolean;
    /** CHANGED(SESSION), additive optional (audio AUD-m4), both default false: the mix summed to mono after the master /
     *  a lower limiter with gentle compression for loud transients. normalizeSettings always writes them; absent reads false */
    mono?: boolean; softenLoud?: boolean };
  controls: { binds: Record<string, string>; quickCast: boolean; cameraLock: boolean; edgePan: boolean; panSpeed: number; attackMoveOnClick: boolean; selfCastModifier: string };
  access: { colorblind: 'off' | 'deutan' | 'protan' | 'tritan'; uiScale: number; hudScale: number; minimapScale: number; reduceMotion: boolean; screenShake: number; subtitles: boolean;
    /** CHANGED(UI), r12 M4 §5, both default false: a 150 ms HARM screen-edge mark when you lose control /
     *  a 120 ms ink screen-edge mark when a hit lands on you (a stored profile without them reads false) */
    locFlash: boolean; damageFlash: boolean };
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
  /** CHANGED(SESSION), additive (client F17): the emblem the avatar shows (an id from the UI's earnable emblems;
   *  Session.setEmblem). Absent: the UI's default */
  emblem?: string;
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
  /** CHANGED(SESSION), additive: the fighter (and optional role/skin) chosen at queue time — required by
   *  'role_preset' queues, optional for practice (skips the solo pick). Ignored by other protocols. */
  preset?: { fighter: string; role?: string; skin?: string };
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
  /** CHANGED(W4), additive: BRIDGE Lot swaps this seat has left (absent = no limit) */
  swaps?: number;
  /** CHANGED(W4), additive (client F12): finalize / trade / done only — this seat is ready (a human sent { a: 'ready' };
   *  a bot has finished its skin and loadout). Absent in the other phases */
  ready?: boolean;
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
  /** CHANGED(SESSION), additive: pending finalize-phase trade requests involving the viewing seat */
  trades?: { from: PlayerId; to: PlayerId }[];
}
export type DraftAction =
  | { a: 'hover'; fighter: string } | { a: 'lock' } | { a: 'ban'; fighter: string } | { a: 'skin'; skin: string }
  | { a: 'loadout'; loadout: LoadoutChoice } | { a: 'benchSwap'; fighter: string } | { a: 'reroll' }
  | { a: 'tradeRequest'; with: PlayerId } | { a: 'tradeAccept'; with: PlayerId }
  /** CHANGED(W4), additive (client F12): finalize Lock in — this seat is ready; once every seat is, the finalize
   *  timer drops to a short grace (draft.ts READY_GRACE) */
  | { a: 'ready' };

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
  /** CHANGED(UI), additive optional (feature-check before calling): the death recap's source — damage your
   *  fighter took in the last 15 s, newest last (SimApi.damageLog of `you`; a remote host streams it). */
  damageLog?(): readonly DamageLogEntry[];
}
/** CHANGED(UI), additive: one death-recap row (same shape as SimApi.damageLog entries) */
export interface DamageLogEntry { t: number; src: number; srcName: string; srcDef: string; ability?: string; amount: number; dtype: 'phys' | 'magic' | 'true' }

export type SessionEvent =
  | { type: 'queue'; state: 'idle' | 'searching' | 'found' | 'accepted' | 'declined'; queue?: string; elapsed?: number; estimate?: number;
      /** CHANGED(SESSION), additive: ready-check seconds left / window, seats accepted / total ('found' | 'accepted') */
      readyTimer?: number; readyMax?: number; accepted?: number; total?: number;
      /** CHANGED(SESSION), additive: why the queue ended, and the re-queue lockout in seconds ('declined' | 'idle') */
      reason?: 'declined' | 'timeout' | 'cancelled' | 'dodged'; lockout?: number }
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
  // CHANGED(SESSION), additive optional methods (LocalSession implements all three; callers must
  // feature-check): decline the ready check (cancelQueue() during a ready check does the same),
  // set the number of bot party members (returns the party), queue again with the last request.
  declineMatch?(): void;
  setPartyBots?(count: number): PartyMember[];
  playAgain?(): void;
  /** CHANGED(SESSION), additive: the game-server link (CONTRACT §7.2); null/absent = offline build */
  online?(): OnlineInfo | null;
  /** CHANGED(SESSION), additive optional (W2 flow-blockers): try the game-server link again now (the offline bar's Try
   *  again). Without it the UI dispatches the page-level retry event the link also listens for */
  reconnect?(): void;
  /** CHANGED(SESSION), additive optional (client F15): record a Lantern nod for a teammate in this match's history entry.
   *  False when the match is not in the history, the player is not your teammate, or the entry already has a nod */
  nod?(matchId: string, player: PlayerId): boolean;
  /** CHANGED(SESSION), additive optional (client F17): keep the chosen emblem on the profile (Profile.emblem); '' clears it */
  setEmblem?(emblem: string): void;
}

/** the online link as the UI shows it */
export interface OnlineInfo { status: 'connecting' | 'online' | 'offline' | 'refused'; players: number; searching: Record<string, number>; reason?: string }
