// WOBBLEHOARD collection constants (_spec/COLLECTION.md 3.1, 5.1, 7.5, C-4, C-5, C-10). Plain numbers and strings only.
// The SQL config seeds of the (planned, not applied) server must equal these; a later probe compares them (COLLECTION S13).
// Numbers that already live in src/core are imported there, never re-typed here (MERGE_COST in particular).

/** At most this many unopened PLAY capsules wait on the table; at this many the meter stops paying (nothing is lost). C-5. */
export const WH_QUEUE_MAX = 5;
/** A play report carries at most this many touches (7.5, P4). */
export const MAX_EVENTS_PER_BATCH = 120;
/** Touches older than this are never paid ("the bank", C-4). The client keeps unsent touches in memory for at most this long. */
export const BANK_MAX_MS = 5 * 60_000;
/** Send a play batch every 30 to 45 s while touching (7.5); also on hide and before a capsule opens. */
export const BATCH_MIN_INTERVAL_MS = 30_000;
export const BATCH_MAX_INTERVAL_MS = 45_000;
/** Capacity of the in-memory touch buffer (5 minutes at the physical limit of about 12 touches a second is 3600). */
export const TOUCH_BUFFER_CAP = 4096;
/** Amount clamps the host applies (7.5): a squeeze hold 0..10 s, a pull intensity 0..1. */
export const MAX_SQUEEZE_SECONDS = 10;
export const MAX_PULL_INTENSITY = 1;
/** The meterfeed's release threshold (DESIGN 5.4: `release` with heldFor >= 0.4 s is a squeeze). Mirrors PAY.minSqueezeHoldSeconds in core/meter.ts. */
export const RELEASE_SQUEEZE_MIN_S = 0.4;

/** The v2 Hoard save (5.1). */
export const HOARD_VERSION = 2 as const;
export const HOARD_KEY = 'wobblehoard:v2:hoard';
/** Unreadable blobs are parked here (5.1), at most PARK_MAX_CHARS characters. */
export const HOARD_BACKUP_KEY = 'wobblehoard:v2:hoard.unreadable';
export const PARK_MAX_CHARS = 20_000;
/** Minimum ms between automatic writes (5.1: like core/save.ts). */
export const SAVE_THROTTLE_MS = 2000;

/** The Practice shelf holds at most this many ghosts (5.1); a capsule, a restock pick or a task capsule is refused at the cap. */
export const GHOST_CAP = 100;
/** A stored shelf may hold a few more than GHOST_CAP (two tabs merging their shelves, 5.4) before rows are dropped on load. */
export const GHOST_LOAD_CAP = 128;
/** Mirror rows kept on load (5.1). */
export const MIRROR_CAP = 2000;
/** Pending op keys: at most 20, dropped after 10 minutes (5.1, 7.7). */
export const PENDING_CAP = 20;
export const PENDING_TTL_MS = 10 * 60_000;
/** Practice task capsules (they bypass WH_QUEUE_MAX) are bounded by the weekly task limit anyway; this is the stored cap. */
export const TASK_CAPSULE_CAP = 10;

/** Item ids: at most 64 characters of A-Za-z0-9_- (5.1). Ghost ids are 'g-' + 12 base36 characters. */
export const ID_MAX_LEN = 64;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const GHOST_ID_PREFIX = 'g-';
export const GHOST_ID_RANDOM_CHARS = 12;
/** The device id: random, only a practice seed and (later) an idempotency key prefix; never an identity, never sent as one. */
export const DEVICE_ID_CHARS = 20;
export const DEVICE_ID_PATTERN = /^[a-z0-9]{8,40}$/;
/** Idempotency keys (C-10): 16 to 64 characters of A-Za-z0-9_-. */
export const IDEM_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/** acctTag: the first 32 hex characters of SHA-256('wh-acct:' + deviceId + ':' + authId) (5.4). Never the auth id itself. */
export const ACCT_TAG_PATTERN = /^[0-9a-f]{32}$/;

/** Tidy-up runs at most this many merges (MERGE 3.3; it also shares the daily merge cap of core/merge.ts). */
export const TIDY_MAX = 10;
/** Parents kept on a merged ghost (MERGE_COST is 2 or 3; this bounds a stored row). */
export const PARENTS_MAX = 3;

/** [U] COLLECTION 7.10: the pull intensity that means "stretched to twice its size". Placeholder until PHYS measures it; the
 *  'stretch-double' task may be unreachable on the current body. */
export const STRETCH_2X_INTENSITY = 0.8;
/** COLLECTION 7.10: a 'softPops' streak counts squeezes held at least this long; 'snaps' counts pulls at least this intense. */
export const SOFT_POP_STREAK_S = 1.8;
export const SNAP_TASK_INTENSITY = 0.35;
/** Default hold for the 'squeezes' task metric when a task has no param (7.10). */
export const SQUEEZE_TASK_DEFAULT_S = 0.4;
/** 'pokes' without a param counts only "gentle" pokes: freshness at least this (7.10). */
export const GENTLE_POKE_FRESHNESS = 0.5;

/** 24 h output lock of a merge (MERGE 3.2), in ms. The hour count itself is MERGE_OUTPUT_LOCK_HOURS in core/merge.ts. */
export const HOUR_MS = 3_600_000;
