// WOBBLEHOARD Hoard store: the v2 save (_spec/COLLECTION.md 5.1, 5.2, 5.4) through an injected StorageLike (the core/save.ts contract).
//
//   loadHoard(storage, deps)       read, validate, migrate from the slice-1 profile, park what cannot be read   (never throws)
//   createHoardStore(storage, o)   the live save + a throttled writer with a two-tab guard                     (never throws)
//
// Rules this file keeps:
//   * The slice-1 key `wobblehoard:v1:profile` is only READ here (core/save.ts readProfile, which writes nothing); never rewritten.
//   * The stored save is hostile input: every row is validated (the genome code must decode to the row's species, the id is at most 64
//     characters of A-Za-z0-9_-, counts are non-negative integers, row counts are capped). A hand-edited save can crash nothing and
//     mint nothing real: everything it holds is practice.
//   * Nothing a player owns vanishes silently. A blob that cannot be read, or from which rows had to be dropped, is parked under
//     HOARD_BACKUP_KEY first; a backup that holds readable squishies is never replaced by one that holds none; the load status says
//     what happened (copy.ts has the words). A blob with v > 2 is NEWER: this build runs on an in-memory save and never writes.
//   * A write that does not stick (quota, private mode, a guarded storage that swallows the error) is detected by reading it back
//     and reported (StorageReport.save = 'failing'); the game keeps playing.
//   * Two tabs: before each write the key is re-read. If another tab wrote since this store last synced, its save is adopted (when
//     this tab has nothing unsaved) or merged item by item (rebaseHoard). An injected subscription (the window 'storage' event) makes
//     an idle tab adopt the other tab's save as soon as it lands. Real items will come from the server (5.4: the mirror is
//     last-write-wins and re-fetched); the merge exists for the Practice shelf, which has no server behind it.
import type { Genome, SquishyInstance } from '../core/genome.ts';
import { SPECIES, decodeGenome, encodeGenome, makeStarterGenome, newInstance } from '../core/genome.ts';
import type { MeterState } from '../core/meter.ts';
import { createMeter, sanitizeMeter, DAY_MS } from '../core/meter.ts';
import type { TaskState } from '../core/drops.ts';
import { TASK_DEFS, TASKS_MAX_PER_WEEK, createTaskState } from '../core/drops.ts';
import { MERGE_DAILY_CAP } from '../core/merge.ts';
import { TIER_COUNT, tierIndex } from '../core/rarity.ts';
import type { Profile, StorageSubscribe } from '../core/save.ts';
import { readProfile } from '../core/save.ts';
import type { StorageLike } from '../core/settings.ts';
import { getSpecies, SPECIES_COUNT } from '../data/catalog.ts';
import {
  ACCT_TAG_PATTERN, DEVICE_ID_CHARS, DEVICE_ID_PATTERN, GHOST_ID_PREFIX, GHOST_ID_RANDOM_CHARS, GHOST_LOAD_CAP, HOARD_BACKUP_KEY, HOARD_KEY,
  HOARD_VERSION, ID_PATTERN, IDEM_PATTERN, MIRROR_CAP, PARENTS_MAX, PARK_MAX_CHARS, PENDING_CAP, PENDING_TTL_MS, SAVE_THROTTLE_MS,
  TASK_CAPSULE_CAP, WH_QUEUE_MAX,
} from './constants.ts';
import type {
  HoardItem, HoardLoadStatus, HoardMirror, HoardPrefs, HoardSave, HoardSaveState, ItemOrigin, Ledger, MirrorRow, PendingKind, PendingOp,
  PracticeTasks, SortKey, StorageReport,
} from './types.ts';

/* ───────────────────────────────────────────────── rows ───────────────────────────────────────────────── */

export const FLAG_FAV = 1;
export const FLAG_OFFERED = 2;
export const FLAG_SEEN = 4;
export const FLAG_RESERVED = 8;
const FLAGS_ALL = 15;
/** Origin codes stored in a row (append only). */
export const ORIGINS: readonly ItemOrigin[] = ['starter', 'drop', 'task', 'restock', 'blend'];
export const originCode = (o: ItemOrigin): number => ORIGINS.indexOf(o);
const MAX_T_MS = 8.64e15;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Random base36 characters from an injected [0, 1) source (never Math.random here). */
export function randomBase36(rand: () => number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = rand();
    const k = typeof x === 'number' && x >= 0 && x < 1 ? Math.floor(x * 36) : 0;
    s += '0123456789abcdefghijklmnopqrstuvwxyz'[k];
  }
  return s;
}

/** A new ghost id ('g-' + 12 base36) that is not in use. */
export function newGhostId(rand: () => number, taken: (id: string) => boolean): string {
  for (let tries = 0; tries < 64; tries++) {
    const id = GHOST_ID_PREFIX + randomBase36(rand, GHOST_ID_RANDOM_CHARS);
    if (!taken(id)) return id;
  }
  // a broken random source (constant output): make the id unique by counting
  for (let k = 0; ; k++) { const id = `${GHOST_ID_PREFIX}x${k.toString(36)}`; if (!taken(id)) return id; }
}

/**
 * Validate one stored row. Returns a clean row, or null when it must be dropped: a bad genome code (or one whose species is not the
 * row's), an unknown species index, an id that is not 1..64 of A-Za-z0-9_-, a negative or non-integer count, a bad time or origin.
 * Practice rows never carry trade data: tradeCount 0, no offered or reserved flag. Bad parent entries are dropped, not the row.
 */
export function sanitizeRow(x: unknown, ledger: Ledger): MirrorRow | null {
  if (!Array.isArray(x) || x.length < 8 || x.length > 9) return null;
  const [id, sp, code, bornAt, flags, tradeCount, lockedUntil, origin] = x as unknown[];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (!isInt(sp) || sp < 0 || sp >= SPECIES_COUNT) return null;
  if (typeof code !== 'string' || code.length > 64) return null;
  const g = decodeGenome(code);
  if (!g || g.species !== SPECIES[sp]) return null;
  if (!isNum(bornAt) || bornAt < 0 || bornAt > MAX_T_MS) return null;
  if (!isInt(flags) || flags < 0 || flags > FLAGS_ALL) return null;
  if (!isInt(tradeCount) || tradeCount < 0 || tradeCount > 1e9) return null;
  if (!isNum(lockedUntil) || lockedUntil < 0 || lockedUntil > MAX_T_MS) return null;
  if (!isInt(origin) || origin < 0 || origin >= ORIGINS.length) return null;
  const ghost = ledger === 'practice';
  const row: MirrorRow = [id, sp, code, bornAt, ghost ? flags & (FLAG_FAV | FLAG_SEEN) : flags, ghost ? 0 : tradeCount, lockedUntil, origin];
  const p = x[8];
  if (ORIGINS[origin] === 'blend' && Array.isArray(p)) {
    const parents = p.filter((q): q is string => typeof q === 'string' && ID_PATTERN.test(q)).slice(0, PARENTS_MAX);
    if (parents.length) row.push(parents);
  }
  return row;
}

/** Build a row (the caller guarantees the values: ghost.ts and the migration). */
export function makeRow(id: string, genome: Genome, bornAt: number, flags: number, origin: ItemOrigin, lockedUntil = 0, parents?: readonly string[]): MirrorRow {
  const row: MirrorRow = [id, SPECIES.indexOf(genome.species), encodeGenome(genome), bornAt, flags, 0, lockedUntil, originCode(origin)];
  if (origin === 'blend' && parents && parents.length) row.push(parents.slice(0, PARENTS_MAX));
  return row;
}

/** A row as the Hoard shows it. `genomeCache` (optional) maps a code to its decoded genome so unchanged rows are not decoded again. */
export function rowToItem(row: MirrorRow, ledger: Ledger, genomeCache?: Map<string, Genome>): HoardItem | null {
  let g = genomeCache ? genomeCache.get(row[2]) : undefined;
  if (!g) { const d = decodeGenome(row[2]); if (!d) return null; g = d; if (genomeCache) genomeCache.set(row[2], d); }
  const def = getSpecies(g.species);
  if (!def) return null;
  const ghost = ledger === 'practice';
  const flags = row[4];
  const base = {
    id: row[0], species: def.id, speciesIdx: def.idx, tier: def.tier, tierIdx: tierIndex(def.tier), genome: g, code: row[2], name: def.name,
    bornAt: row[3], origin: ORIGINS[row[7]] ?? 'drop', tradeCount: ghost ? 0 : row[5], lockedUntil: row[6] > 0 ? row[6] : null,
    fav: (flags & FLAG_FAV) !== 0, offered: !ghost && (flags & FLAG_OFFERED) !== 0, seen: (flags & FLAG_SEEN) !== 0,
    reserved: !ghost && (flags & FLAG_RESERVED) !== 0, ghost, ledger,
  };
  const parents = row[8];
  return Object.freeze(parents && parents.length ? { ...base, parents: Object.freeze(parents.slice()) } : base) as HoardItem;
}

/* ───────────────────────────────────────────────── the save ───────────────────────────────────────────────── */

export const defaultPrefs = (): HoardPrefs => ({ view: 'cabinet', sort: 'tier', tiers: 0, lanes: 0, onlySpares: false, onlyMissing: false, onlyHearts: false, onlyShelf: false });
const SORT_KEYS: readonly SortKey[] = ['tier', 'newest', 'name', 'spares', 'catalog'];
const PENDING_KINDS: readonly PendingKind[] = ['play', 'open', 'restock', 'task', 'merge', 'tidy', 'trade'];

export function sanitizePrefs(x: unknown): HoardPrefs {
  const d = defaultPrefs();
  if (!isObj(x)) return d;
  const mask = (v: unknown, bits: number): number => (isInt(v) && v >= 0 ? v & ((1 << bits) - 1) : 0);
  const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);
  return {
    view: x.view === 'grid' ? 'grid' : 'cabinet',
    sort: (SORT_KEYS as readonly unknown[]).includes(x.sort) ? (x.sort as SortKey) : d.sort,
    tiers: mask(x.tiers, TIER_COUNT), lanes: mask(x.lanes, 6),
    onlySpares: bool(x.onlySpares, false), onlyMissing: bool(x.onlyMissing, false), onlyHearts: bool(x.onlyHearts, false), onlyShelf: bool(x.onlyShelf, false),
  };
}

/** Pending op keys (C11): exactly {kind, idem, acctTag, at}; anything else in an entry (item ids, picks, touches) is dropped. */
export function sanitizePending(x: unknown, nowMs: number): PendingOp[] {
  if (!Array.isArray(x)) return [];
  const out: PendingOp[] = [];
  for (const e of x) {
    if (out.length >= PENDING_CAP) break;
    if (!isObj(e)) continue;
    if (!(PENDING_KINDS as readonly unknown[]).includes(e.kind)) continue;
    if (typeof e.idem !== 'string' || !IDEM_PATTERN.test(e.idem)) continue;
    if (typeof e.acctTag !== 'string' || !ACCT_TAG_PATTERN.test(e.acctTag)) continue;
    if (!isNum(e.at) || e.at < nowMs - PENDING_TTL_MS || e.at > nowMs + PENDING_TTL_MS) continue;
    out.push({ kind: e.kind as PendingKind, idem: e.idem, acctTag: e.acctTag, at: e.at });
  }
  return out;
}

const pityOf = (x: unknown): number[] => {
  const out = new Array<number>(TIER_COUNT).fill(0);
  if (Array.isArray(x)) for (let i = 0; i < TIER_COUNT; i++) { const v = x[i]; out[i] = isInt(v) && v > 0 ? Math.min(255, v) : 0; }
  return out;
};
const intIn = (x: unknown, lo: number, hi: number, dflt: number): number => (isInt(x) ? Math.min(hi, Math.max(lo, x)) : dflt);
const dayOrNull = (x: unknown): number | null => (isInt(x) && x >= 0 && x <= MAX_T_MS / DAY_MS ? x : null);

/** Known task-progress keys: every task id and its streak key. */
const PROGRESS_KEYS: ReadonlySet<string> = new Set(TASK_DEFS.flatMap((t) => [t.id, `${t.id}#streak`]));

function sanitizeTaskState(x: unknown): TaskState {
  if (!isObj(x)) return createTaskState();
  const ids = Array.isArray(x.claimedToday) ? x.claimedToday.filter((s): s is string => typeof s === 'string' && TASK_DEFS.some((t) => t.id === s)) : [];
  return {
    week: isInt(x.week) && x.week >= 0 ? x.week : null,
    claimedThisWeek: intIn(x.claimedThisWeek, 0, TASKS_MAX_PER_WEEK, 0),
    day: dayOrNull(x.day),
    claimedToday: Array.from(new Set(ids)).slice(0, TASK_DEFS.length),
  };
}
function sanitizePracticeTasks(x: unknown): PracticeTasks {
  const o = isObj(x) ? x : {};
  const progress: Record<string, number> = {};
  if (isObj(o.progress)) for (const [k, v] of Object.entries(o.progress)) if (PROGRESS_KEYS.has(k) && isInt(v) && v >= 0) progress[k] = Math.min(v, 1e6);
  return { state: sanitizeTaskState(o.state), day: dayOrNull(o.day), progress };
}

function sanitizeMirror(x: unknown, nowMs: number): HoardMirror | null {
  if (!isObj(x)) return null;
  if (typeof x.acctTag !== 'string' || !ACCT_TAG_PATTERN.test(x.acctTag)) return null; // a forged or missing tag wipes the mirror (C12)
  const items: MirrorRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(x.items)) for (const r of x.items) {
    if (items.length >= MIRROR_CAP) break;
    const row = sanitizeRow(r, 'real');
    if (row && !seen.has(row[0])) { seen.add(row[0]); items.push(row); }
  }
  return {
    acctTag: x.acctTag, at: isNum(x.at) && x.at >= 0 ? Math.min(x.at, MAX_T_MS) : 0, version: intIn(x.version, 0, 2 ** 31, 0), items,
    meter: sanitizeMeter(x.meter, nowMs), credits: intIn(x.credits, 0, WH_QUEUE_MAX + TASK_CAPSULE_CAP, 0), pity: pityOf(x.pity),
    serverDay: intIn(x.serverDay, 0, Math.floor(MAX_T_MS / DAY_MS), 0),
  };
}

/** A new, empty save (no ghosts yet). */
export function emptyHoard(deviceId: string): HoardSave {
  return {
    v: HOARD_VERSION, deviceId, ghosts: [], ghostMeter: createMeter(), ghostPity: new Array<number>(TIER_COUNT).fill(0), ghostCapsules: 0,
    ghostTaskCapsules: 0, ghostRestockDay: null, ghostTasks: { state: createTaskState(), day: null, progress: {} }, ghostMerges: { day: null, count: 0 },
    ghostOpened: 0, mirror: null, pending: [], prefs: defaultPrefs(), migratedFromV1: false,
  };
}

/**
 * Validate a parsed v2 save. Returns null when it is not a usable v2 envelope at all (wrong version, no ghost list): the caller parks it.
 * Otherwise the clean save and how many practice rows had to be dropped (the caller parks the original when that is not 0).
 */
export function sanitizeHoard(x: unknown, nowMs: number, rand: () => number): { save: HoardSave; droppedGhosts: number } | null {
  if (!isObj(x) || x.v !== HOARD_VERSION || !Array.isArray(x.ghosts)) return null;
  const deviceId = typeof x.deviceId === 'string' && DEVICE_ID_PATTERN.test(x.deviceId) ? x.deviceId : randomBase36(rand, DEVICE_ID_CHARS);
  const ghosts: MirrorRow[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const r of x.ghosts) {
    const row = ghosts.length < GHOST_LOAD_CAP ? sanitizeRow(r, 'practice') : null;
    if (!row || ids.has(row[0])) { dropped++; continue; }
    ids.add(row[0]);
    ghosts.push(row);
  }
  const gm = isObj(x.ghostMerges) ? x.ghostMerges : {};
  return {
    save: {
      v: HOARD_VERSION, deviceId, ghosts,
      ghostMeter: sanitizeMeter(x.ghostMeter, nowMs),
      ghostPity: pityOf(x.ghostPity),
      ghostCapsules: intIn(x.ghostCapsules, 0, WH_QUEUE_MAX, 0),
      ghostTaskCapsules: intIn(x.ghostTaskCapsules, 0, TASK_CAPSULE_CAP, 0),
      ghostRestockDay: dayOrNull(x.ghostRestockDay),
      ghostTasks: sanitizePracticeTasks(x.ghostTasks),
      ghostMerges: { day: dayOrNull(gm.day), count: intIn(gm.count, 0, MERGE_DAILY_CAP, 0) },
      ghostOpened: intIn(x.ghostOpened, 0, 1e9, 0),
      mirror: sanitizeMirror(x.mirror, nowMs),
      pending: sanitizePending(x.pending, nowMs),
      prefs: sanitizePrefs(x.prefs),
      migratedFromV1: x.migratedFromV1 === true,
    },
    droppedGhosts: dropped,
  };
}

/** The canonical text of a save (fixed key order). */
export function serializeHoard(s: HoardSave): string {
  return JSON.stringify({
    v: s.v, deviceId: s.deviceId, ghosts: s.ghosts, ghostMeter: s.ghostMeter, ghostPity: s.ghostPity, ghostCapsules: s.ghostCapsules,
    ghostTaskCapsules: s.ghostTaskCapsules, ghostRestockDay: s.ghostRestockDay, ghostTasks: s.ghostTasks, ghostMerges: s.ghostMerges,
    ghostOpened: s.ghostOpened, mirror: s.mirror, pending: s.pending, prefs: s.prefs, migratedFromV1: s.migratedFromV1,
  });
}

/** A deep copy through the canonical text (the save is plain JSON). */
export const cloneHoard = (s: HoardSave): HoardSave => JSON.parse(serializeHoard(s)) as HoardSave;

/** The v1 instance as ghost number one (5.2 step 2): same id when it is a valid row id, seen, never locked. */
export function ghostRowFromInstance(inst: SquishyInstance, rand: () => number): MirrorRow | null {
  let code: string;
  try { code = encodeGenome(inst.genome); } catch { return null; }
  const g = decodeGenome(code);
  if (!g || !getSpecies(g.species)) return null;
  const id = ID_PATTERN.test(inst.id) ? inst.id : newGhostId(rand, () => false);
  const kind = inst.origin.kind;
  const origin: ItemOrigin = kind === 'drop' || kind === 'task' || kind === 'restock' || kind === 'blend' ? kind : 'starter';
  const bornAt = isNum(inst.bornAt) && inst.bornAt >= 0 ? Math.min(inst.bornAt, MAX_T_MS) : 0;
  return makeRow(id, g, bornAt, FLAG_SEEN, origin, 0, origin === 'blend' ? (inst.origin.parents ?? []).filter((p) => ID_PATTERN.test(p)) : undefined);
}

/** A fresh save whose ghost one is a new starter Dollop (5.2 step 3). */
export function freshHoard(nowMs: number, rand: () => number): HoardSave {
  const save = emptyHoard(randomBase36(rand, DEVICE_ID_CHARS));
  const inst = newInstance(makeStarterGenome(), { kind: 'starter' }, 'Dollop', newGhostId(rand, () => false), nowMs);
  const row = ghostRowFromInstance(inst, rand);
  if (row) save.ghosts.push(row);
  return save;
}

/** A save built from the slice-1 profile (5.2 step 2): ghosts = [profile.instance] with the same id. */
export function hoardFromProfile(profile: Profile, nowMs: number, rand: () => number): HoardSave {
  const save = emptyHoard(randomBase36(rand, DEVICE_ID_CHARS));
  const row = ghostRowFromInstance(profile.instance, rand);
  if (!row) return freshHoard(nowMs, rand);
  save.ghosts.push(row);
  save.migratedFromV1 = true;
  return save;
}

/* ───────────────────────────────────────────────── parking ───────────────────────────────────────────────── */

/**
 * How much a stored or parked text could give back: 2 = a v2 envelope with at least one readable row (ghost or mirror), 1 = a JSON
 * object, 0 = not JSON, -1 = nothing. The backup slot is never moved to a lower value.
 */
export function hoardSalvageValue(text: string | null): number {
  if (text === null || text === '') return -1;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return 0; }
  if (!isObj(x)) return 0;
  const anyRow = (rows: unknown, ledger: Ledger): boolean => Array.isArray(rows) && rows.some((r) => sanitizeRow(r, ledger) !== null);
  return anyRow(x.ghosts, 'practice') || (isObj(x.mirror) && anyRow(x.mirror.items, 'real')) ? 2 : 1;
}

/** What to park: the text itself when it fits; a parseable save that is too long is parked without its mirror (a server cache) first. */
function parkable(text: string): string {
  if (text.length <= PARK_MAX_CHARS) return text;
  try {
    const x = JSON.parse(text) as unknown;
    if (isObj(x) && 'mirror' in x) { const t = JSON.stringify({ ...x, mirror: null }); if (t.length <= PARK_MAX_CHARS) return t; }
  } catch { /* not JSON: truncate */ }
  return text.slice(0, PARK_MAX_CHARS);
}

/** Park a text under HOARD_BACKUP_KEY unless the slot holds something more recoverable. Returns true when it was written. Never throws. */
export function parkHoardText(storage: StorageLike, text: string): boolean {
  try {
    const t = parkable(text);
    const cur = storage.getItem(HOARD_BACKUP_KEY);
    if (hoardSalvageValue(t) < hoardSalvageValue(cur)) return false;
    storage.setItem(HOARD_BACKUP_KEY, t);
    return storage.getItem(HOARD_BACKUP_KEY) === t;
  } catch { return false; }
}

/* ───────────────────────────────────────────────── load ───────────────────────────────────────────────── */

export interface HoardDeps {
  /** Epoch ms now. */
  now: () => number;
  /** [0, 1) source for ids made while loading (device id, a fresh starter's id). */
  rand: () => number;
  /**
   * The slice-1 profile the shell already loaded (createProfileStore(...).profile), so the starter ghost keeps the SAME id as the
   * shell's play squishy. Omitted: the v1 key is read here (read only). null: ignore v1.
   */
  profile?: Profile | null;
}

export interface LoadedHoard {
  save: HoardSave;
  status: HoardLoadStatus;
  /** False for 'newer' and 'unavailable': this build must not write. */
  canWrite: boolean;
  /** An unreadable text was parked under HOARD_BACKUP_KEY during this load. */
  parked: boolean;
  /** The raw text found under HOARD_KEY (the two-tab guard's first sync point). */
  text: string | null;
}

function fromV1OrFresh(storage: StorageLike | null, deps: HoardDeps, nowMs: number): { save: HoardSave; migrated: boolean } {
  let profile: Profile | null = null;
  if (deps.profile !== undefined) profile = deps.profile;
  else if (storage) profile = readProfile(storage).profile;
  if (profile) return { save: hoardFromProfile(profile, nowMs, deps.rand), migrated: true };
  return { save: freshHoard(nowMs, deps.rand), migrated: false };
}

/** Load the Hoard (5.2). Never throws. Writes only the backup slot here; the store writes the save itself. */
export function loadHoard(storage: StorageLike | null, deps: HoardDeps): LoadedHoard {
  const nowMs = deps.now();
  if (!storage) { const b = fromV1OrFresh(null, deps, nowMs); return { save: b.save, status: 'unavailable', canWrite: false, parked: false, text: null }; }
  let text: string | null;
  try { text = storage.getItem(HOARD_KEY); } catch {
    const b = fromV1OrFresh(null, deps, nowMs);
    return { save: b.save, status: 'unavailable', canWrite: false, parked: false, text: null };
  }
  let recovered = false;
  let parked = false;
  if (text !== null && text !== '') {
    let parsed: unknown;
    let parsedOk = true;
    try { parsed = JSON.parse(text); } catch { parsedOk = false; }
    if (parsedOk && isObj(parsed) && isNum(parsed.v) && parsed.v > HOARD_VERSION) {
      const b = fromV1OrFresh(storage, deps, nowMs);
      return { save: b.save, status: 'newer', canWrite: false, parked: false, text };
    }
    const r = parsedOk ? sanitizeHoard(parsed, nowMs, deps.rand) : null;
    if (r && r.droppedGhosts === 0) return { save: r.save, status: 'ok', canWrite: true, parked: false, text };
    parked = parkHoardText(storage, text);
    if (r) return { save: r.save, status: 'repaired', canWrite: true, parked, text };
    recovered = true;
  }
  const b = fromV1OrFresh(storage, deps, nowMs);
  return { save: b.save, status: recovered ? 'recovered' : b.migrated ? 'migrated' : 'fresh', canWrite: true, parked, text };
}

/* ───────────────────────────────────────────────── accounts (C05, C12) ───────────────────────────────────────────────── */

/**
 * Account switch or sign-out (5.4): keep the mirror and the pending keys only when they are tagged with `keepTag`; null (signed out)
 * removes both. Prefs and the Practice shelf stay. Pure: returns a new save.
 */
export function forgetAccount(save: HoardSave, keepTag: string | null): HoardSave {
  const out = cloneHoard(save);
  if (!out.mirror || keepTag === null || out.mirror.acctTag !== keepTag) out.mirror = null;
  out.pending = keepTag === null ? [] : out.pending.filter((p) => p.acctTag === keepTag);
  return out;
}

/* ───────────────────────────────────────────────── two tabs ───────────────────────────────────────────────── */

const rowKey = (r: MirrorRow): string => JSON.stringify(r);

/**
 * Three-way merge of the Practice side of two saves that both moved on from `base` (5.4, two tabs). Items merge by id: an item one
 * side added is kept, an item one side consumed is gone, and a changed row (heart, seen) takes the side that changed it. Counters
 * add both sides' deltas (clamped to their caps); the meter is taken whole from the side that touched more recently (two meters cannot
 * be added); pity per tier from the side that changed it. The mirror and pending keys are theirs (server truth wins, 5.4).
 */
export function rebaseHoard(base: HoardSave, theirs: HoardSave, ours: HoardSave): HoardSave {
  const out = cloneHoard(theirs);
  const b = new Map(base.ghosts.map((r) => [r[0], r] as [string, MirrorRow]));
  const t = new Map(theirs.ghosts.map((r) => [r[0], r] as [string, MirrorRow]));
  const o = new Map(ours.ghosts.map((r) => [r[0], r] as [string, MirrorRow]));
  const ghosts: MirrorRow[] = [];
  const ids = new Set<string>([...t.keys(), ...o.keys()]);
  for (const id of ids) {
    const rb = b.get(id), rt = t.get(id), ro = o.get(id);
    if (ro && !rb) { ghosts.push(ro); continue; }                       // we added it
    if (rt && !rb) { ghosts.push(rt); continue; }                       // they added it
    if (!rb || !ro || !rt) continue;                                    // one side consumed it
    ghosts.push(rowKey(ro) !== rowKey(rb) ? ro : rt);                   // both kept it: the side that changed it wins
  }
  ghosts.sort((x, y) => x[3] - y[3] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  out.ghosts = ghosts.slice(0, GHOST_LOAD_CAP);
  const delta = (pick: (s: HoardSave) => number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, pick(theirs) + pick(ours) - pick(base)));
  out.ghostCapsules = delta((s) => s.ghostCapsules, 0, WH_QUEUE_MAX);
  out.ghostTaskCapsules = delta((s) => s.ghostTaskCapsules, 0, TASK_CAPSULE_CAP);
  out.ghostOpened = delta((s) => s.ghostOpened, 0, 1e9);
  const lastT = (m: MeterState): number => m.lastEventMs ?? -1;
  if (lastT(ours.ghostMeter) !== lastT(base.ghostMeter) && lastT(ours.ghostMeter) >= lastT(theirs.ghostMeter)) out.ghostMeter = JSON.parse(JSON.stringify(ours.ghostMeter)) as MeterState;
  out.ghostPity = theirs.ghostPity.map((v, i) => (ours.ghostPity[i] !== base.ghostPity[i] ? ours.ghostPity[i] : v));
  if (ours.ghostMerges.day === theirs.ghostMerges.day && ours.ghostMerges.day !== null) {
    const bc = base.ghostMerges.day === ours.ghostMerges.day ? base.ghostMerges.count : 0;
    out.ghostMerges = { day: ours.ghostMerges.day, count: Math.min(MERGE_DAILY_CAP, theirs.ghostMerges.count + ours.ghostMerges.count - bc) };
  } else if ((ours.ghostMerges.day ?? -1) > (theirs.ghostMerges.day ?? -1)) out.ghostMerges = { ...ours.ghostMerges };
  out.ghostRestockDay = Math.max(theirs.ghostRestockDay ?? -1, ours.ghostRestockDay ?? -1) >= 0 ? Math.max(theirs.ghostRestockDay ?? -1, ours.ghostRestockDay ?? -1) : null;
  // tasks: the later day wins; on the same day the claimed ids are united and the week count adds our delta
  const ot = ours.ghostTasks, tt = theirs.ghostTasks, bt = base.ghostTasks;
  if ((ot.day ?? -1) > (tt.day ?? -1)) out.ghostTasks = JSON.parse(JSON.stringify(ot)) as PracticeTasks;
  else if (ot.day === tt.day) {
    const progress: Record<string, number> = { ...tt.progress };
    for (const [k, v] of Object.entries(ot.progress)) progress[k] = Math.max(progress[k] ?? 0, v);
    const sameWeek = ot.state.week === tt.state.week;
    const claimedToday = Array.from(new Set([...tt.state.claimedToday, ...(ot.state.day === tt.state.day ? ot.state.claimedToday : [])]));
    const ourNew = sameWeek ? Math.max(0, ot.state.claimedThisWeek - (bt.state.week === ot.state.week ? bt.state.claimedThisWeek : 0)) : 0;
    out.ghostTasks = { state: { ...tt.state, claimedThisWeek: Math.min(TASKS_MAX_PER_WEEK, tt.state.claimedThisWeek + ourNew), claimedToday }, day: tt.day, progress };
  }
  if (JSON.stringify(ours.prefs) !== JSON.stringify(base.prefs)) out.prefs = { ...ours.prefs };
  out.migratedFromV1 = theirs.migratedFromV1 || ours.migratedFromV1;
  return out;
}

/* ───────────────────────────────────────────────── the store ───────────────────────────────────────────────── */

export interface HoardStoreOptions extends HoardDeps {
  /** Minimum ms between automatic writes (default SAVE_THROTTLE_MS). */
  throttleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** Cross-tab: the shell wires window 'storage' (see core/save.ts StorageSubscribe). */
  subscribe?: StorageSubscribe;
  /** Called after another tab's save was adopted or merged in (the in-memory save object was replaced). */
  onExternal?: () => void;
  /** Called when the save state changes ('ok' <-> 'failing'). */
  onSaveState?: (s: HoardSaveState) => void;
}

export interface HoardStore {
  /** The live save. ghost.ts mutates it in place; it is REPLACED when another tab's save is folded in (read it through this getter). */
  readonly save: HoardSave;
  readonly status: HoardLoadStatus;
  report(): StorageReport;
  /** Something changed: schedule a throttled write. Allocation-free while a write is already scheduled. */
  markDirty(): void;
  /** Write now if dirty. */
  flush(): void;
  /** Re-read storage; true when another tab's change was folded in. */
  sync(): boolean;
  dispose(): void;
  /** Writes issued (probe readout). */
  readonly writes: number;
}

export function createHoardStore(storage: StorageLike | null, opts: HoardStoreOptions): HoardStore {
  const throttle = opts.throttleMs ?? SAVE_THROTTLE_MS;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const loaded = loadHoard(storage, opts);
  let save = loaded.save;
  let canWrite = loaded.canWrite && storage !== null;
  let saveState: HoardSaveState = canWrite ? 'ok' : 'off';
  let dirty = false;
  let timer: unknown = null;
  let lastWrite = -Infinity;
  let writes = 0;
  let conflicts = 0;
  /** The sync point: the text storage held when this store last read or wrote it. */
  let lastText: string | null = loaded.text;
  /** The save as of lastText, for the three-way merge (text; parsed only when a merge is needed). */
  let baseText: string | null = loaded.status === 'ok' ? loaded.text : null;

  const readRaw = (): string | null => { if (!storage) return null; try { return storage.getItem(HOARD_KEY); } catch { return null; } };
  const setState = (s: HoardSaveState): void => {
    if (s === saveState) return;
    saveState = s;
    if (opts.onSaveState) try { opts.onSaveState(s); } catch { /* a UI listener must not break the store */ }
  };

  /** Fold another tab's write into this store. Returns true when the in-memory save changed. */
  const reconcile = (): boolean => {
    const cur = readRaw();
    if (cur === lastText) return false;
    conflicts++;
    if (cur === null || cur === '') { lastText = cur; dirty = true; return false; }         // removed elsewhere: ours is written back
    let parsed: unknown;
    try { parsed = JSON.parse(cur); } catch { parsed = undefined; }
    if (isObj(parsed) && isNum(parsed.v) && parsed.v > HOARD_VERSION) { canWrite = false; setState('off'); lastText = cur; return false; }
    const theirs = parsed === undefined ? null : sanitizeHoard(parsed, opts.now(), opts.rand);
    if (!theirs) { if (storage) parkHoardText(storage, cur); lastText = cur; dirty = true; return false; }
    if (theirs.droppedGhosts > 0 && storage) parkHoardText(storage, cur);
    if (!dirty) save = theirs.save;
    else {
      let base: HoardSave | null = null;
      if (baseText) { try { const p = sanitizeHoard(JSON.parse(baseText), opts.now(), opts.rand); base = p ? p.save : null; } catch { base = null; } }
      save = rebaseHoard(base ?? emptyHoard(save.deviceId), theirs.save, save);
    }
    lastText = cur;
    baseText = cur;
    return true;
  };

  const write = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!dirty || !canWrite || !storage) return;
    const changed = reconcile();
    if (!canWrite) return;
    dirty = false;
    lastWrite = opts.now();
    writes++;
    const text = serializeHoard(save);
    let ok = false;
    try { storage.setItem(HOARD_KEY, text); ok = storage.getItem(HOARD_KEY) === text; } catch { ok = false; }
    if (ok) { lastText = text; baseText = text; setState('ok'); } else { dirty = true; setState('failing'); }
    if (changed && opts.onExternal) try { opts.onExternal(); } catch { /* ignore */ }
  };

  const schedule = (): void => {
    dirty = true;
    if (!canWrite || timer !== null) return;
    const wait = Math.max(0, lastWrite + throttle - opts.now());
    if (wait === 0) { write(); return; }
    timer = setTimer(() => { timer = null; write(); }, wait);
  };

  const sync = (): boolean => {
    if (!storage || readRaw() === lastText) return false;
    if (loaded.status === 'newer' || loaded.status === 'unavailable') return false;
    const had = dirty;
    const changed = reconcile();
    if (changed && opts.onExternal) try { opts.onExternal(); } catch { /* ignore */ }
    if ((had || dirty) && canWrite) schedule();
    return changed;
  };

  // first write: a new, migrated, recovered or repaired save is written at once (the starter's id is stable from visit one)
  if (canWrite && loaded.status !== 'ok') { dirty = true; write(); }

  let unsubscribe: (() => void) | null = null;
  if (opts.subscribe) {
    try { unsubscribe = opts.subscribe((key) => { if (key === null || key === HOARD_KEY) sync(); }); } catch { unsubscribe = null; }
  }

  return {
    get save() { return save; },
    status: loaded.status,
    report: () => ({ load: loaded.status, save: saveState, parked: loaded.parked, conflicts }),
    markDirty() { if (timer !== null) { dirty = true; return; } schedule(); },
    flush() { write(); },
    sync,
    dispose() {
      write();
      if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
    },
    get writes() { return writes; },
  };
}
