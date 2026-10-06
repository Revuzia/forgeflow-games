// WOBBLEHOARD collection types (_spec/COLLECTION.md 3.4, 5.1, 5.3; _spec/MERGE.md 3, 7). Types only: no runtime code.
//
// TWO LEDGERS. 'real' items are minted by the server (planned: bridge.ts, api.ts, sync.ts; not in this build). 'practice' items are
// GHOSTS: made on this device by collection/ghost.ts, kept only in this device's storage, never sent anywhere, never tradeable, never
// mergeable with real items, never promoted to real (COLLECTION C-6). Every item, stack and result below carries its `ledger`, and a
// ghost carries `ghost: true`, so no consumer can mistake one for the other.
//
// Result shapes copy the server's reply fields (snake_case: item_id, genome_code, tier_idx, is_new, ...) so the shell's ceremony code
// (COLLECTION 10, MERGE 7) is the same for both ledgers; they add `ledger` and the decoded `item`.
import type { SoftEvent } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import type { MeterState, TouchKind } from '../core/meter.ts';
import type { TaskDef, TaskState } from '../core/drops.ts';
import type { MergePreviewOk } from '../core/merge.ts';
import type { TierId } from '../core/rarity.ts';
import type { SpeciesId } from '../data/catalog.ts';

export type Ledger = 'real' | 'practice';
/** How an item came to be. 'trade' is never written (provenance of ownership is tradeCount plus the server ledger: DESIGN 7.1). */
export type ItemOrigin = 'starter' | 'drop' | 'task' | 'restock' | 'blend';

/** One squishy as the Hoard shows it: real (server) or ghost (practice, device only). Immutable: the store hands out new objects. */
export interface HoardItem {
  /** real: server UUID. ghost: 'g-' + 12 base36 characters (the slice-1 starter keeps its old id when migrated). */
  readonly id: string;
  readonly species: SpeciesId;
  readonly speciesIdx: number;
  /** From the catalog (tier is a property of the species, not of the genome). */
  readonly tier: TierId;
  readonly tierIdx: number;
  /** Decoded from `code`, never edited. */
  readonly genome: Genome;
  /** The g1 share string of `genome` (canonical). */
  readonly code: string;
  /** The catalog name (nicknames from a fixed list are not stored yet: the compact row has no slot for one). */
  readonly name: string;
  /** Epoch ms. */
  readonly bornAt: number;
  readonly origin: ItemOrigin;
  /** Blend only: the consumed ids. */
  readonly parents?: readonly string[];
  /** Server value; ghosts are always 0. */
  readonly tradeCount: number;
  /** Epoch ms (the SERVER clock for real items, the device clock for ghosts); null = free. */
  readonly lockedUntil: number | null;
  /** Hearted ("Heart" everywhere a player sees it; the wire name stays `fav`). */
  readonly fav: boolean;
  readonly offered: boolean;
  readonly seen: boolean;
  readonly reserved: boolean;
  /** true = practice: never tradeable, never mergeable with real items, never sent anywhere. */
  readonly ghost: boolean;
  readonly ledger: Ledger;
}

/** A PRACTICE item. Lives on this device only. */
export interface GhostItem extends HoardItem {
  readonly ghost: true;
  readonly ledger: 'practice';
  readonly tradeCount: 0;
  readonly offered: false;
  readonly reserved: false;
}

/** A REAL item (server-minted). No code in this build creates one. */
export interface RealItem extends HoardItem {
  readonly ghost: false;
  readonly ledger: 'real';
}

/**
 * Compact storage row (5.1): [id, speciesIdx, g1code, bornAt, flags, tradeCount, lockedUntil|0, originCode, parents?].
 * flags: fav 1, offered 2, seen 4, reserved 8. originCode: 0 starter, 1 drop, 2 task, 3 restock, 4 blend.
 * `parents` (optional 9th element, ghosts only: at most 3 ids) is an addition to the 5.1 sketch: a ghost has no server row to keep them.
 */
export type MirrorRow = [id: string, speciesIdx: number, code: string, bornAt: number, flags: number, tradeCount: number, lockedUntil: number, originCode: number, parents?: string[]];

/** The read-only cache of a signed-in account (5.1). Never written by this build; kept, validated, on load and save. */
export interface HoardMirror {
  /** NOT the auth id: the first 32 hex characters of SHA-256('wh-acct:' + deviceId + ':' + authId) (5.4). */
  acctTag: string;
  at: number;
  version: number;
  items: MirrorRow[];
  meter: MeterState;
  credits: number;
  pity: number[];
  serverDay: number;
}

export type PendingKind = 'play' | 'open' | 'restock' | 'task' | 'merge' | 'tidy' | 'trade';
/** An in-flight op as a reload may know it: kind and key only, never item ids, picks, task ids or touches (5.1, 7.7). */
export interface PendingOp { kind: PendingKind; idem: string; acctTag: string; at: number }

export type SortKey = 'tier' | 'newest' | 'name' | 'spares' | 'catalog';
export interface HoardPrefs {
  view: 'cabinet' | 'grid';
  sort: SortKey;
  /** Tier filter chips as a bit mask (bit i = tier index i); 0 = no tier filter. */
  tiers: number;
  /** Lane filter chips (LANES order in catalog.ts) as a bit mask; 0 = no lane filter. */
  lanes: number;
  onlySpares: boolean;
  onlyMissing: boolean;
  /** Additions to the 5.1 sketch (9.2 lists these chips): stacks with a hearted copy / with something on the offer shelf. */
  onlyHearts: boolean;
  onlyShelf: boolean;
}

/** Practice task bookkeeping (additions to the 5.1 sketch: the practice economy needs them). */
export interface PracticeTasks {
  /** core/drops.ts claim bookkeeping (week limit, ids claimed today). */
  state: TaskState;
  /** UTC day of `progress`; the counters reset when the day changes. */
  day: number | null;
  /** Counters by task id (and `<id>#streak` for soft pops), as COLLECTION 7.10 counts them. */
  progress: Record<string, number>;
}

/** The v2 save (5.1), with the practice-economy fields this build needs (marked "added"). */
export interface HoardSave {
  v: 2;
  /** Random; a practice seed salt and (later) an idempotency-key prefix; never an identity, never sent as one. */
  deviceId: string;
  /** The Practice shelf (cap GHOST_CAP). */
  ghosts: MirrorRow[];
  /** Practice meter (core/meter.ts). */
  ghostMeter: MeterState;
  /** Practice merge pity, length 6. */
  ghostPity: number[];
  /** Unopened practice PLAY capsules (cap WH_QUEUE_MAX; at the cap the practice meter stops paying). */
  ghostCapsules: number;
  /** Added: unopened practice TASK capsules (they bypass the table cap, C-5). */
  ghostTaskCapsules: number;
  /** Added: UTC day of the last practice restock pick (null = never). */
  ghostRestockDay: number | null;
  /** Added: practice tasks. */
  ghostTasks: PracticeTasks;
  /** Added: practice merges on a UTC day (the 10-a-day cap applies to practice too). */
  ghostMerges: { day: number | null; count: number };
  /** Added: practice capsules opened, lifetime (6.3: the UI may skip the first-capsule hint). */
  ghostOpened: number;
  mirror: HoardMirror | null;
  /** In-flight mutating ops: KEYS ONLY. Always empty in this build (nothing is ever sent). */
  pending: PendingOp[];
  prefs: HoardPrefs;
  migratedFromV1: boolean;
}

/** One species in the cabinet (5.3). buildStacks returns 50 of them, owned or not, in catalog order. */
export interface Stack {
  idx: number;
  species: SpeciesId;
  name: string;
  tier: TierId;
  tierIdx: number;
  /** Lane index in catalog.ts LANES (the feel filter). */
  laneIdx: number;
  ledger: Ledger;
  /** Items of this species in the stack's ledger. */
  copies: number;
  /** The first hearted copy (oldest first), else the oldest by bornAt (ties by id). */
  keeper: string | null;
  /** Every other copy, newest first. */
  spareIds: string[];
  /** copies - 1 (0 when unowned). */
  spares: number;
  /** Spares that are not hearted, not locked, not reserved and not on the offer shelf (MERGE 3.1, 3.3), newest first. */
  mergeableIds: string[];
  mergeable: number;
  locked: number;
  unseen: number;
  offered: number;
  hearted: number;
  keeperHearted: boolean;
  /** Every copy is locked (the plinth's clock). */
  allLocked: boolean;
  /** Newest bornAt of any copy (0 when unowned): the 'newest' sort. */
  newestAt: number;
}

/** The HUD ring (9.7). */
export interface MeterView {
  ledger: Ledger;
  /** 0..1 toward the next capsule. */
  fill: number;
  sp: number;
  /** SP the next capsule costs (30, 50, 75, then 100). */
  threshold: number;
  /** Capsules waiting (play + task). */
  credits: number;
  /** Play capsules waiting (the table cap counts these). */
  playCredits: number;
  /** Daily rate is reduced (25%): "Squishies are resting". */
  resting: boolean;
  /** The 12-a-day stop from play: "They'll be ready tomorrow". */
  doneToday: boolean;
  /** WH_QUEUE_MAX play capsules wait: the meter does not pay until one is opened. */
  tableFull: boolean;
  /** Always false for the practice ledger (no server). */
  offline: boolean;
}

/** A refusal: the wire code (`error`) and, when the collection filled it in, the plain-English line for the player (`message`, copy.ts). */
export type Fail<E extends string> = { ok: false; ledger: Ledger; error: E; message?: string };

export interface OpenOk {
  ok: true;
  ledger: Ledger;
  item_id: string;
  species_idx: number;
  tier_idx: number;
  genome_code: string;
  is_new: boolean;
  /** Copies of this species now (including the new one). */
  copies: number;
  source: 'play' | 'task';
  credits_left: number;
  /** The new item (unseen until markSeen). */
  item: HoardItem;
  /** DESIGN 6.1: a repeat Common or Uncommon may play the 0.8 s quick pop. */
  quick: boolean;
}
export type OpenResult = OpenOk | Fail<'no_capsule' | 'shelf_full' | 'unavailable'>;

export interface ClaimOk {
  ok: true;
  ledger: Ledger;
  item_id: string;
  species_idx: number;
  tier_idx: number;
  genome_code: string;
  is_new: boolean;
  copies: number;
  item: HoardItem;
  quick: boolean;
}
export type ClaimResult = ClaimOk | Fail<'not_offered' | 'already_claimed' | 'shelf_full' | 'unavailable'>;

export interface RestockView {
  ledger: Ledger;
  /** UTC day the offer belongs to. */
  day: number;
  /** The three offered species in display order (restockDisplayOrder: species you lack first, higher tier first). */
  offer: SpeciesId[];
  claimed: boolean;
  display: { species: SpeciesId; name: string; tier: TierId; copies: number; isNew: boolean }[];
}

export interface TaskRow {
  def: TaskDef;
  progress: number;
  target: number;
  done: boolean;
  claimed: boolean;
  /** Five task capsules were paid this week: "That's all the tasks for this week". */
  weeklyLimitReached: boolean;
}
export type TaskResult =
  | { ok: true; ledger: Ledger; credits: number }
  | { ok: false; ledger: Ledger; error: 'not_offered' | 'not_done' | 'already_claimed' | 'weekly_limit' | 'queue_full' | 'bad_payload' | 'unavailable'; progress?: number; target?: number; message?: string };

export type MergeErrorCode =
  | 'wrong_count' | 'not_yours' | 'locked' | 'favourite' | 'reserved' | 'mixed_species' | 'mythic_cannot_merge' | 'unknown_species'
  | 'invalid_genome' | 'not_enough_copies' | 'daily_cap' | 'unavailable';

export type MergePreviewResult =
  | {
    ok: true; ledger: Ledger; preview: MergePreviewOk;
    /** Odds digest of exactly what this preview shows (MERGE M-1, M-7): pass it to merge(). */
    digest: string;
    /** The selected copies, in the order given. */
    inputs: HoardItem[];
    mergesToday: number;
    /** Merges left today (0 = the hold should be disabled: "10 merges today"). */
    mergesLeft: number;
    lockHours: number;
  }
  | { ok: false; ledger: Ledger; error: MergeErrorCode; itemId?: string; message?: string };

export interface MergeOk {
  ok: true;
  ledger: Ledger;
  item_id: string;
  species_idx: number;
  tier_idx: number;
  tier_up: boolean;
  genome_code: string;
  is_new: boolean;
  /** Copies of the result's species now (including the new one). */
  copies: number;
  consumed: string[];
  pity: number[];
  merges_today: number;
  reason: 'roll' | 'finished-row' | 'pity' | 'stay';
  /** The new item (unseen, locked 24 h). */
  item: HoardItem;
  /** The consumed copies, for MergeCeremonySpec.parents. They are already gone from items(): take them from here, not from a lookup. */
  parents: HoardItem[];
}
export type MergeResult =
  | MergeOk
  | { ok: false; ledger: Ledger; error: MergeErrorCode | 'odds_changed'; itemId?: string; preview?: MergePreviewOk; digest?: string; message?: string };

export interface TidyResult {
  ok: boolean;
  ledger: Ledger;
  /** One per merge that ran, in plan order; the last one is the refusal if the run stopped early. */
  results: MergeResult[];
  done: number;
  /** Index into results of the best result (highest tier, then a new species, then the earliest): the one full ceremony (MERGE M-5). */
  best: number | null;
  error?: 'bad_payload' | 'unavailable';
}

/** How the stored Hoard was found at load (a status the UI can show; copy.ts holds the words). */
export type HoardLoadStatus =
  | 'ok'          // loaded as stored
  | 'fresh'       // first visit: a new Practice shelf with the starter
  | 'migrated'    // built from the slice-1 profile (the starter keeps its id; the v1 key is left alone)
  | 'recovered'   // the stored shelf could not be read: it was parked under HOARD_BACKUP_KEY and the shelf started again
  | 'repaired'    // some stored rows could not be read and were left out; the original was parked under HOARD_BACKUP_KEY
  | 'newer'       // written by a newer build: running in memory, never overwriting it
  | 'unavailable';// no usable storage: running in memory, nothing is kept after the page closes
export type HoardSaveState = 'ok' | 'failing' | 'off';
export interface StorageReport {
  load: HoardLoadStatus;
  /** 'failing' = the last write did not stick (quota, private mode); 'off' = this build is not writing (newer save, no storage). */
  save: HoardSaveState;
  /** A copy of an unreadable save sits in HOARD_BACKUP_KEY from this session's load. */
  parked: boolean;
  /** Times another tab's write was found and folded in (two tabs). */
  conflicts: number;
}

export type CollectionEvent =
  | { type: 'capsule'; source: 'play' | 'task'; credits: number }   // a capsule is ready: stage.dropCapsule, audio.meterFull, "A capsule is ready"
  | { type: 'table-full' }                                          // "Table full: open one to keep going." (once per transition)
  | { type: 'resting' }                                             // the daily rate dropped to 25%
  | { type: 'done-today' }                                          // the 12-a-day stop
  | { type: 'storage'; report: StorageReport }                      // the save started or stopped failing
  | { type: 'external' };                                           // another tab changed the Hoard and this one folded it in

/** The practice summary (shelf size and counters the UI shows). */
export interface PracticeSummary { ghosts: number; cap: number; full: boolean; opened: number; mergesToday: number; mergeCap: number }

/**
 * What the shell and the UI call (COLLECTION 3.4). This build: guest mode, practice ledger only.
 *  * Reads with `ledger = 'real'` return empty lists (no server); every action on the real ledger would answer `unavailable`
 *    (unreachable in this build: `ledger` is always 'practice').
 *  * The Promise-returning actions decide synchronously (result first) and resolve at once for practice; they stay Promises so
 *    the server-backed versions can slot in without changing callers.
 */
export interface Collection {
  readonly mode: 'loading' | 'guest' | 'signedIn';
  /** Which items the Hoard is showing: always 'practice' in this build. */
  readonly ledger: Ledger;
  /** A fresh array each call (the items themselves are frozen), oldest first. */
  items(ledger?: Ledger): HoardItem[];
  item(id: string): HoardItem | null;
  /** 50 entries, owned or not, catalog order. */
  stacks(ledger?: Ledger): Stack[];
  meter(): MeterView;
  practice(): PracticeSummary;
  /** Called after any change the UI shows (items, meter, prefs, storage status). Returns the unsubscribe function. */
  onChange(fn: () => void): () => void;
  /** Transitions the UI announces or acts on (capsule ready, table full, resting, ...). Returns the unsubscribe function. */
  onEvent(fn: (e: CollectionEvent) => void): () => void;
  /** Every SoftEvent, from the frame loop. `tMs` = the shell's ms clock (performance.now() or Date.now()). Allocation-free when the event is not a touch. */
  feed(ev: SoftEvent, tMs: number): void;
  /**
   * PENDING PREVIEW (FUN.md 2.2, added 2026-10-06 by the ECON lane): the SP the touch in progress would pay if it ended now, as `feed`
   * would credit it: the meter's pay table (core/meter.ts DESIGN 5.4), freshness, a medley bonus it would complete, the daily rate, the
   * valve's room, and 0 when the table is full or the day is done. The shell draws the growing "pending arc" from it every frame while a
   * squeeze or a stretch is held; the arc then banks exactly what it showed, unless something else is fed before the release.
   *   kind 'squeeze': heldS = seconds pressed so far; under 0.4 s 0 (that release is not a squeeze; the contact's poke has already paid).
   *   kind 'pull':    heldS = seconds since the grab, level = the live pull level 0..1 (1 = the family's maxPull, as the snap will
   *                   report it); level 0.35 or more pays per second held, less the flat "never stretched" rate, 0.05 or less 0 (no snap).
   *   kind 'poke':    what a poke now would pay (heldS and level ignored).
   * Not a touch: nothing is fed or stored. Pure and allocation-free; any number may be NaN or out of range (clamped, never throws).
   * Also accepts the arguments as one object { kind, heldS, level } (other fields ignored), the form a feature-detecting caller passes.
   */
  previewTouch?(kind: TouchKind, heldS: number, level: number): number;
  /** Opens the oldest waiting capsule (result first: animate afterwards, COLLECTION 10). */
  openCapsule(): Promise<OpenResult>;
  restock(): RestockView;
  claimRestock(pick: SpeciesId): Promise<ClaimResult>;
  tasks(): TaskRow[];
  completeTask(id: string): Promise<TaskResult>;
  /** The pad's default inputs for a species: the newest MERGE_COST mergeable spares (never the keeper), or null. */
  mergeInputs(species: SpeciesId): string[] | null;
  previewMerge(ids: readonly string[]): MergePreviewResult;
  merge(ids: readonly string[], digest: string): Promise<MergeResult>;
  tidyPlan(opts: { includeRare: boolean }): string[][];
  tidy(plan: readonly (readonly string[])[]): Promise<TidyResult>;
  setFav(ids: readonly string[], fav: boolean): Promise<void>;
  markSeen(ids: readonly string[]): Promise<void>;
  prefs(): HoardPrefs;
  setPrefs(p: Partial<HoardPrefs>): void;
  storage(): StorageReport;
  /** Re-read storage and fold in another tab's change (the injected subscription calls it; call it on focus too). */
  sync(): void;
  /** Write now if anything changed (pagehide, visibilitychange hidden). */
  flush(): void;
  dispose(): void;
  // Trade, offer shelf, friends, board, block and report (TRADE.md 7.2) are NOT part of this build. When the server exists they
  // join this interface as server-only members (real ledger, signed in); a guest sees "Sign in to trade" (COLLECTION 6).
}
