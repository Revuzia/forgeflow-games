// The player profile: one versioned envelope in localStorage.
//   wobblehoard:v1:profile = { v: 1, instance: SquishyInstance, stats: { pokes, squishes, pulls, releases } }
// The starter squishy is created ONCE and keeps the same instance id on every later visit: that stable id is the seam
// the trade module will hang on. Loading is corruption-safe (bad JSON or the wrong shape gives a fresh profile, never a
// throw) and saving is throttled so a poke-fest never hammers storage.
//
// Audit fixes (2026-10-05; every exported signature is unchanged, additions are optional):
//   (a) MIGRATION. The envelope and the stored genome are versioned and run through step migrations (PROFILE_MIGRATIONS,
//       GENOME_MIGRATIONS: entry n turns version n into n + 1) before they are validated, so a schema bump no longer reads
//       as "corrupt" and replaces the player's squishy and its stable id. Both tables are empty while v1 is the only
//       format; probe_collection.ts fails if PROFILE_VERSION or GENOME_VERSION is raised without the matching step.
//       A genome written by a NEWER build (genome.v above GENOME_VERSION) now counts as 'newer' (run in memory, never
//       overwrite it) instead of 'corrupt'. A migrated envelope is written back at once, and the text it replaces is
//       kept first under profilePreMigrationKey(from) (only if that slot is empty).
//       BACKUP SLOT: an unreadable blob is still parked in PROFILE_BACKUP_KEY, but a backup that holds a readable
//       squishy is never overwritten by one that does not (profileSalvageValue ranks them).
//   (b) SANITISING. A stored genome keeps only the known Genome keys (canonicalGenome); parent ids are kept only when
//       they are strings of 1..128 characters, at most PARENTS_MAX of them (a bad parent entry is dropped, it no
//       longer costs the player the squishy); the birth time is clamped to the Date range. Nothing unknown is re-saved.
//   (c) TWO TABS. A write first re-reads the key: if the text is not what this store last read or wrote, another tab
//       wrote in between, and its profile is folded in instead of clobbered (stats = theirs + our unsaved delta; the
//       instance stays theirs unless this tab changed it). The shell can also inject a change subscription
//       (`subscribe`, wired to the window 'storage' event) so an idle tab adopts the other tab's profile as soon as it
//       lands. This is a cheap guard, not a lock: a read-compare-write still has a window of microseconds between two
//       tabs writing in the same instant. A profile from a newer build seen this way stops this store's writes.
//       No DOM here: the subscription is injected.
import type { Genome, SquishyInstance } from './genome.ts';
import { EYE_STYLES, GENOME_VERSION, PATTERNS, SPECIES, canonicalGenome, genomeEquals, makeStarterGenome, newInstance } from './genome.ts';
import type { StorageLike } from './settings.ts';

export const PROFILE_KEY = 'wobblehoard:v1:profile';
/** One slot where an unreadable blob is parked before being replaced, so a bug here never silently destroys data. */
export const PROFILE_BACKUP_KEY = 'wobblehoard:v1:profile.unreadable';
export const PROFILE_VERSION = 1 as const;
/** Where the text of an envelope is kept before a migration rewrites it (written once per source version, never overwritten). */
export const profilePreMigrationKey = (fromVersion: number): string => `${PROFILE_KEY}.v${fromVersion}`;
/** Longest text parked in a backup slot. */
export const PARK_MAX_CHARS = 20000;
/** Bounds of the stored instance (anything longer is refused or dropped, never re-saved). */
export const INSTANCE_ID_MAX = 128;
export const INSTANCE_NAME_MAX = 64;
export const PARENTS_MAX = 8;
/** Largest epoch time the store keeps (the end of the JS Date range). */
const MAX_T_MS = 8.64e15;

export interface Stats { pokes: number; squishes: number; pulls: number; releases: number }
export interface Profile { v: typeof PROFILE_VERSION; instance: SquishyInstance; stats: Stats }
const STAT_KEYS = ['pokes', 'squishes', 'pulls', 'releases'] as const satisfies readonly (keyof Stats)[];

export type LoadStatus =
  | 'ok'          // loaded as stored (possibly migrated from an older version: see LoadResult.migratedFrom)
  | 'fresh'       // nothing stored yet (first visit) or storage unavailable
  | 'corrupt'     // bad JSON / wrong shape: replaced by a fresh profile (the old text is parked in PROFILE_BACKUP_KEY)
  | 'newer';      // written by a newer build (envelope v > 1, or a genome newer than GENOME_VERSION): we run on a fresh in-memory profile and never overwrite it

export interface LoadResult {
  profile: Profile;
  status: LoadStatus;
  /** Set when the stored envelope was an older version and was migrated on load (the version it had). */
  migratedFrom?: number;
}

/** "Another tab changed storage": the shell wires the window 'storage' event (`e.key`, null for clear()). No DOM in core. */
export type StorageSubscribe = (onChange: (key: string | null) => void) => () => void;

/* ───────────────────────────────────────────────── migrations ───────────────────────────────────────────────── */

/** One migration step: takes an object of version n, returns the same data as version n + 1 (with `v` set to n + 1). */
export type VersionStep = (x: Record<string, unknown>) => Record<string, unknown>;
/** Envelope steps: PROFILE_MIGRATIONS[n] turns a v n envelope into v n + 1. Empty while v1 is the only format. */
export const PROFILE_MIGRATIONS: Readonly<Record<number, VersionStep>> = Object.freeze({});
/** Stored-genome steps: GENOME_MIGRATIONS[n] turns a genome object with v = n into v = n + 1. Empty while GENOME_VERSION is 1. */
export const GENOME_MIGRATIONS: Readonly<Record<number, VersionStep>> = Object.freeze({});

export type MigrateResult = { ok: true; value: Record<string, unknown>; from: number } | { ok: false; why: 'newer' | 'unmigratable' };

/**
 * Bring a versioned object (`{ v: integer, ... }`) up to `target` through `steps`. 'newer' when v is above the target,
 * 'unmigratable' when v is missing, not an integer, or a step is missing or fails. Never throws, never mutates its input
 * (a step must return a new object; one that returns a wrong `v` is refused).
 */
export function migrateVersioned(x: unknown, target: number, steps: Readonly<Record<number, VersionStep>>): MigrateResult {
  if (!isObj(x) || typeof x.v !== 'number' || !Number.isInteger(x.v)) return { ok: false, why: 'unmigratable' };
  const from = x.v;
  if (from > target) return { ok: false, why: 'newer' };
  let cur: Record<string, unknown> = x;
  for (let v = from; v < target; v++) {
    const step = Object.prototype.hasOwnProperty.call(steps, v) ? steps[v] : undefined;
    if (typeof step !== 'function') return { ok: false, why: 'unmigratable' };
    let next: unknown;
    try { next = step({ ...cur }); } catch { return { ok: false, why: 'unmigratable' }; }
    if (!isObj(next) || next.v !== v + 1) return { ok: false, why: 'unmigratable' };
    cur = next;
  }
  return { ok: true, value: cur, from };
}

/* ───────────────────────────────────────────────── validation ───────────────────────────────────────────────── */

const UNIT_KEYS = [
  'chroma', 'lightness', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size',
  'glitter', 'speckle', 'eyeSpacing', 'eyeSize', 'eyeHeight',
] as const;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Strict structural check of a stored genome (current version). Returns the canonical (quantised) genome with ONLY the known keys, or null. */
export function parseGenome(x: unknown): Genome | null {
  if (!isObj(x)) return null;
  if (x.v !== GENOME_VERSION) return null;
  if (!(SPECIES as readonly unknown[]).includes(x.species)) return null;
  if (!(PATTERNS as readonly unknown[]).includes(x.pattern)) return null;
  if (!(EYE_STYLES as readonly unknown[]).includes(x.eyeStyle)) return null;
  if (!isNum(x.seed) || x.seed < 0 || x.seed > 4294967295) return null;
  if (!isNum(x.hue) || x.hue < 0 || x.hue > 359 || !isNum(x.coreHue) || x.coreHue < 0 || x.coreHue > 359) return null;
  for (const k of UNIT_KEYS) { const v = x[k]; if (!isNum(v) || v < 0 || v > 1) return null; }
  return canonicalGenome(x); // (b) copies exactly the Genome keys: unknown keys are dropped, never re-saved
}

const ORIGIN_KINDS: readonly string[] = ['starter', 'drop', 'task', 'blend', 'trade', 'restock'];

/** Read a stored instance: the instance, null (unreadable), or 'newer' (its genome was written by a newer build). */
function readInstance(x: unknown): SquishyInstance | null | 'newer' {
  if (!isObj(x)) return null;
  if (isObj(x.genome) && isNum(x.genome.v) && x.genome.v > GENOME_VERSION) return 'newer';
  if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > INSTANCE_ID_MAX) return null;
  if (typeof x.name !== 'string' || x.name.length === 0 || x.name.length > INSTANCE_NAME_MAX) return null;
  if (!isNum(x.bornAt) || x.bornAt < 0) return null;
  if (!isNum(x.tradeCount) || x.tradeCount < 0 || !Number.isInteger(x.tradeCount)) return null;
  const g = migrateVersioned(x.genome, GENOME_VERSION, GENOME_MIGRATIONS);
  if (!g.ok) return g.why === 'newer' ? 'newer' : null;
  const genome = parseGenome(g.value);
  if (!genome) return null;
  const o = x.origin;
  if (!isObj(o) || !ORIGIN_KINDS.includes(o.kind as string)) return null;
  const origin: SquishyInstance['origin'] = { kind: o.kind as SquishyInstance['origin']['kind'] };
  if (Array.isArray(o.parents)) {
    // (b) bounded: only plausible id strings, at most PARENTS_MAX; a bad entry is dropped (it is provenance, not the squishy)
    const parents = o.parents.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= INSTANCE_ID_MAX).slice(0, PARENTS_MAX);
    if (parents.length) origin.parents = parents;
  }
  return { id: x.id, genome, name: x.name, bornAt: Math.min(x.bornAt, MAX_T_MS), origin, tradeCount: Math.min(x.tradeCount, 1e9) };
}

const count = (x: unknown): number => (isNum(x) && x >= 0 ? Math.min(Math.floor(x), 1e9) : 0);

/** Stats are lenient on purpose: a missing or damaged counter becomes 0 rather than costing the player their squishy. */
function parseStats(x: unknown): Stats {
  const o = isObj(x) ? x : {};
  return { pokes: count(o.pokes), squishes: count(o.squishes), pulls: count(o.pulls), releases: count(o.releases) };
}

type EnvelopeRead = { kind: 'ok'; profile: Profile; from: number } | { kind: 'newer' } | { kind: 'bad' };

function readEnvelope(x: unknown): EnvelopeRead {
  if (isObj(x) && isNum(x.v) && x.v > PROFILE_VERSION) return { kind: 'newer' };
  const m = migrateVersioned(x, PROFILE_VERSION, PROFILE_MIGRATIONS);
  if (!m.ok) return m.why === 'newer' ? { kind: 'newer' } : { kind: 'bad' };
  const instance = readInstance(m.value.instance);
  if (instance === 'newer') return { kind: 'newer' };
  if (!instance) return { kind: 'bad' };
  return { kind: 'ok', profile: { v: PROFILE_VERSION, instance, stats: parseStats(m.value.stats) }, from: m.from };
}

/** Validate a parsed envelope (migrating an older version first). Returns null for anything that is not a readable profile, or one from a newer build. */
export function parseProfile(x: unknown): Profile | null {
  const r = readEnvelope(x);
  return r.kind === 'ok' ? r.profile : null;
}

/**
 * How much a stored or parked text could give back: 2 = it holds a readable squishy (even inside a damaged envelope, or one a
 * newer build can read), 1 = a JSON object without one, 0 = not JSON, -1 = nothing. The backup slot is never moved to a lower value.
 */
export function profileSalvageValue(text: string | null): number {
  if (text === null || text === '') return -1;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return 0; }
  if (!isObj(x)) return 0;
  return readInstance(x.instance) !== null ? 2 : 1;
}

/* ───────────────────────────────────────────────── load and save ───────────────────────────────────────────────── */

export interface ProfileDeps {
  /** injectable so tests can pin the id and the birth time */
  makeInstance?: () => SquishyInstance;
}

export function freshProfile(deps: ProfileDeps = {}): Profile {
  const instance = deps.makeInstance ? deps.makeInstance() : newInstance(makeStarterGenome(), { kind: 'starter' });
  return { v: PROFILE_VERSION, instance, stats: { pokes: 0, squishes: 0, pulls: 0, releases: 0 } };
}

const readRaw = (storage: StorageLike | null): string | null => {
  if (!storage) return null;
  try { return storage.getItem(PROFILE_KEY); } catch { return null; }
};

/**
 * Read the stored profile WITHOUT writing anything (no parking, no fresh profile): for a reader that must leave the slice-1 key
 * alone (src/collection/store.ts migrates it into the v2 Hoard). Never throws.
 */
export function readProfile(storage: StorageLike | null): { status: LoadStatus; profile: Profile | null; migratedFrom?: number } {
  const text = readRaw(storage);
  if (text === null || text === '') return { status: 'fresh', profile: null };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { status: 'corrupt', profile: null }; }
  const r = readEnvelope(parsed);
  if (r.kind === 'newer') return { status: 'newer', profile: null };
  if (r.kind === 'bad') return { status: 'corrupt', profile: null };
  return r.from !== PROFILE_VERSION ? { status: 'ok', profile: r.profile, migratedFrom: r.from } : { status: 'ok', profile: r.profile };
}

/** Load. Never throws, whatever is (or is not) in storage. */
export function loadProfile(storage: StorageLike | null, deps: ProfileDeps = {}): LoadResult {
  if (!storage) return { profile: freshProfile(deps), status: 'fresh' };
  let text: string | null;
  try { text = storage.getItem(PROFILE_KEY); } catch { return { profile: freshProfile(deps), status: 'fresh' }; }
  if (text === null || text === '') return { profile: freshProfile(deps), status: 'fresh' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { profile: freshProfile(deps), status: park(storage, text) }; }
  const r = readEnvelope(parsed);
  if (r.kind === 'newer') return { profile: freshProfile(deps), status: 'newer' };
  if (r.kind === 'ok') return r.from !== PROFILE_VERSION ? { profile: r.profile, status: 'ok', migratedFrom: r.from } : { profile: r.profile, status: 'ok' };
  return { profile: freshProfile(deps), status: park(storage, text) };
}

/** Park an unreadable text in the backup slot, unless the slot already holds something more recoverable (a). */
function park(storage: StorageLike, text: string): LoadStatus {
  try {
    const t = text.slice(0, PARK_MAX_CHARS);
    const cur = storage.getItem(PROFILE_BACKUP_KEY);
    if (profileSalvageValue(t) >= profileSalvageValue(cur)) storage.setItem(PROFILE_BACKUP_KEY, t);
  } catch { /* ignore */ }
  return 'corrupt';
}

const envelopeText = (p: Profile): string => JSON.stringify({ v: p.v, instance: p.instance, stats: p.stats });

/** Write the envelope now. Returns false if storage refused (including a guarded storage that dropped the write). Never throws. */
export function saveProfile(storage: StorageLike | null, p: Profile): boolean {
  if (!storage) return false;
  try {
    const text = envelopeText(p);
    storage.setItem(PROFILE_KEY, text);
    return storage.getItem(PROFILE_KEY) === text;
  } catch { return false; }
}

/* ───────────────────────────────────────────────── the store ───────────────────────────────────────────────── */

export interface ProfileStoreOptions extends ProfileDeps {
  /** minimum ms between automatic writes (default 2000) */
  throttleMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /**
   * Optional cross-tab guard (c): called once with a listener; the shell wires it to the window 'storage' event, e.g.
   * `(fn) => { const h = (e: StorageEvent) => fn(e.key); addEventListener('storage', h); return () => removeEventListener('storage', h); }`.
   * Without it, another tab's write is still detected (and folded in) at this store's next write.
   */
  subscribe?: StorageSubscribe;
}

export interface ProfileStore {
  readonly profile: Profile;
  readonly status: LoadStatus;
  /** Count one gesture. Marks the profile dirty; a write is scheduled no sooner than the throttle allows. */
  bump(stat: keyof Stats): void;
  /** Mark dirty without changing stats (e.g. after a rename). */
  touch(): void;
  /** Write immediately if dirty (call on pagehide / visibilitychange hidden). */
  flush(): void;
  dispose(): void;
  /** How many storage writes have been issued (probe readout). */
  readonly writes: number;
  /** Optional (c): re-read storage now and fold in another tab's write (the subscription calls it; safe to call any time, e.g. on focus). */
  sync?(): void;
  /** Optional (c): how many times another tab's write was found and folded in instead of overwritten (probe readout). */
  readonly conflicts?: number;
}

const snapshotInstance = (i: SquishyInstance): SquishyInstance =>
  ({ ...i, genome: { ...i.genome }, origin: i.origin.parents ? { kind: i.origin.kind, parents: i.origin.parents.slice() } : { kind: i.origin.kind } });
const sameInstance = (a: SquishyInstance, b: SquishyInstance): boolean =>
  a.id === b.id && a.name === b.name && a.bornAt === b.bornAt && a.tradeCount === b.tradeCount && a.origin.kind === b.origin.kind
  && (a.origin.parents ?? []).join('\u0000') === (b.origin.parents ?? []).join('\u0000') && genomeEquals(a.genome, b.genome);

/** Profile + throttled autosave. The first-visit profile is written straight away so the starter id is stable from visit one. */
export function createProfileStore(storage: StorageLike | null, opts: ProfileStoreOptions = {}): ProfileStore {
  const throttle = opts.throttleMs ?? 2000;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const loaded = loadProfile(storage, opts);
  const profile = loaded.profile;
  let canWrite = loaded.status !== 'newer';
  let dirty = false;
  let lastWrite = -Infinity;
  let timer: unknown = null;
  let writes = 0;
  let conflicts = 0;
  // (c) the sync point: the text storage held when this store last read or wrote it, and the profile as of that text
  let lastText: string | null = readRaw(storage);
  let baseStats: Stats = { ...profile.stats };
  let baseInstance: SquishyInstance = snapshotInstance(profile.instance);

  /** Fold another tab's write (anything in storage that is not lastText) into this store. Never throws. */
  const reconcile = (): void => {
    const cur = readRaw(storage);
    if (cur === lastText) return;
    conflicts++;
    let parsed: unknown;
    let read: EnvelopeRead | null = null;
    if (cur !== null && cur !== '') { try { parsed = JSON.parse(cur); read = readEnvelope(parsed); } catch { read = null; } }
    if (read && read.kind === 'newer') { canWrite = false; lastText = cur; return; } // a newer build owns the key now: never overwrite it
    if (read && read.kind === 'ok') {
      const theirs = read.profile;
      for (const k of STAT_KEYS) profile.stats[k] = Math.min(1e9, theirs.stats[k] + Math.max(0, profile.stats[k] - baseStats[k]));
      // the instance: ours only if this tab changed it since the sync point; copied IN PLACE (the shell holds a reference)
      if (sameInstance(profile.instance, baseInstance)) Object.assign(profile.instance, snapshotInstance(theirs.instance));
      baseStats = { ...theirs.stats };
      baseInstance = snapshotInstance(theirs.instance);
      lastText = cur;
      return;
    }
    // junk or removed: keep ours (the next write restores a good profile); park junk first so nothing vanishes silently
    if (cur !== null && cur !== '' && storage) park(storage, cur);
    lastText = cur;
    dirty = true;
  };

  const write = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!dirty || !canWrite) return;
    reconcile();
    if (!canWrite) return;
    dirty = false;
    lastWrite = now();
    writes++;
    if (saveProfile(storage, profile)) {
      lastText = envelopeText(profile);
      baseStats = { ...profile.stats };
      baseInstance = snapshotInstance(profile.instance);
    }
  };
  const schedule = (): void => {
    dirty = true;
    if (!canWrite || timer !== null) return;
    const wait = Math.max(0, lastWrite + throttle - now());
    if (wait === 0) { write(); return; }
    timer = setTimer(() => { timer = null; write(); }, wait);
  };
  const sync = (): void => {
    if (readRaw(storage) === lastText) return;
    const had = dirty;
    reconcile();
    if ((had || dirty) && canWrite) schedule();
  };

  if (canWrite && loaded.migratedFrom !== undefined && storage && lastText !== null) {
    // (a) keep the pre-migration text once before the migrated envelope replaces it
    try { const k = profilePreMigrationKey(loaded.migratedFrom); if (storage.getItem(k) === null) storage.setItem(k, lastText.slice(0, PARK_MAX_CHARS)); } catch { /* ignore */ }
  }
  if (canWrite && (loaded.status !== 'ok' || loaded.migratedFrom !== undefined)) { dirty = true; write(); }

  let unsubscribe: (() => void) | null = null;
  if (opts.subscribe) {
    try { unsubscribe = opts.subscribe((key) => { if (key === null || key === PROFILE_KEY) sync(); }); } catch { unsubscribe = null; }
  }

  return {
    profile,
    status: loaded.status,
    bump(stat) { profile.stats[stat] = Math.min(profile.stats[stat] + 1, 1e9); schedule(); },
    touch() { schedule(); },
    flush() { write(); },
    dispose() {
      write();
      if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
    },
    sync,
    get writes() { return writes; },
    get conflicts() { return conflicts; },
  };
}
