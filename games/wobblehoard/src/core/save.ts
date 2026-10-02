// The player profile: one versioned envelope in localStorage.
//   wobblehoard:v1:profile = { v: 1, instance: SquishyInstance, stats: { pokes, squishes, pulls, releases } }
// The starter squishy is created ONCE and keeps the same instance id on every later visit: that stable id is the seam
// the trade module will hang on. Loading is corruption-safe (bad JSON or the wrong shape gives a fresh profile, never a
// throw) and saving is throttled so a poke-fest never hammers storage.
import type { Genome, SquishyInstance } from './genome.ts';
import { EYE_STYLES, GENOME_VERSION, PATTERNS, SPECIES, makeStarterGenome, newInstance, quantizeGenome } from './genome.ts';
import type { StorageLike } from './settings.ts';

export const PROFILE_KEY = 'wobblehoard:v1:profile';
/** One slot where an unreadable blob is parked before being replaced, so a bug here never silently destroys data. */
export const PROFILE_BACKUP_KEY = 'wobblehoard:v1:profile.unreadable';
export const PROFILE_VERSION = 1 as const;

export interface Stats { pokes: number; squishes: number; pulls: number; releases: number }
export interface Profile { v: typeof PROFILE_VERSION; instance: SquishyInstance; stats: Stats }

export type LoadStatus =
  | 'ok'          // loaded as stored
  | 'fresh'       // nothing stored yet (first visit) or storage unavailable
  | 'corrupt'     // bad JSON / wrong shape: replaced by a fresh profile (the old text is parked in PROFILE_BACKUP_KEY)
  | 'newer';      // written by a newer build (v > 1): we run on a fresh in-memory profile and never overwrite it

export interface LoadResult { profile: Profile; status: LoadStatus }

const UNIT_KEYS = [
  'chroma', 'lightness', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size',
  'glitter', 'speckle', 'eyeSpacing', 'eyeSize', 'eyeHeight',
] as const;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Strict structural check of a stored genome. Returns the canonical (quantised) genome, or null. */
export function parseGenome(x: unknown): Genome | null {
  if (!isObj(x)) return null;
  if (x.v !== GENOME_VERSION) return null;
  if (!(SPECIES as readonly unknown[]).includes(x.species)) return null;
  if (!(PATTERNS as readonly unknown[]).includes(x.pattern)) return null;
  if (!(EYE_STYLES as readonly unknown[]).includes(x.eyeStyle)) return null;
  if (!isNum(x.seed) || x.seed < 0 || x.seed > 4294967295) return null;
  if (!isNum(x.hue) || x.hue < 0 || x.hue > 359 || !isNum(x.coreHue) || x.coreHue < 0 || x.coreHue > 359) return null;
  for (const k of UNIT_KEYS) { const v = x[k]; if (!isNum(v) || v < 0 || v > 1) return null; }
  return quantizeGenome(x as unknown as Genome);
}

function parseInstance(x: unknown): SquishyInstance | null {
  if (!isObj(x)) return null;
  if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 128) return null;
  if (typeof x.name !== 'string' || x.name.length === 0 || x.name.length > 64) return null;
  if (!isNum(x.bornAt) || x.bornAt < 0) return null;
  if (!isNum(x.tradeCount) || x.tradeCount < 0 || !Number.isInteger(x.tradeCount)) return null;
  const genome = parseGenome(x.genome);
  if (!genome) return null;
  const o = x.origin;
  if (!isObj(o) || !['starter', 'drop', 'task', 'blend', 'trade'].includes(o.kind as string)) return null;
  const origin: SquishyInstance['origin'] = { kind: o.kind as SquishyInstance['origin']['kind'] };
  if (o.parents !== undefined) {
    if (!Array.isArray(o.parents) || !o.parents.every((p) => typeof p === 'string')) return null;
    origin.parents = o.parents.slice(0, 16) as string[];
  }
  return { id: x.id, genome, name: x.name, bornAt: x.bornAt, origin, tradeCount: x.tradeCount };
}

const count = (x: unknown): number => (isNum(x) && x >= 0 ? Math.min(Math.floor(x), 1e9) : 0);

/** Stats are lenient on purpose: a missing or damaged counter becomes 0 rather than costing the player their squishy. */
function parseStats(x: unknown): Stats {
  const o = isObj(x) ? x : {};
  return { pokes: count(o.pokes), squishes: count(o.squishes), pulls: count(o.pulls), releases: count(o.releases) };
}

/** Validate a parsed envelope. Returns null for anything that is not a v1 profile. */
export function parseProfile(x: unknown): Profile | null {
  if (!isObj(x) || x.v !== PROFILE_VERSION) return null;
  const instance = parseInstance(x.instance);
  if (!instance) return null;
  return { v: PROFILE_VERSION, instance, stats: parseStats(x.stats) };
}

export interface ProfileDeps {
  /** injectable so tests can pin the id and the birth time */
  makeInstance?: () => SquishyInstance;
}

export function freshProfile(deps: ProfileDeps = {}): Profile {
  const instance = deps.makeInstance ? deps.makeInstance() : newInstance(makeStarterGenome(), { kind: 'starter' });
  return { v: PROFILE_VERSION, instance, stats: { pokes: 0, squishes: 0, pulls: 0, releases: 0 } };
}

/** Load. Never throws, whatever is (or is not) in storage. */
export function loadProfile(storage: StorageLike | null, deps: ProfileDeps = {}): LoadResult {
  if (!storage) return { profile: freshProfile(deps), status: 'fresh' };
  let text: string | null;
  try { text = storage.getItem(PROFILE_KEY); } catch { return { profile: freshProfile(deps), status: 'fresh' }; }
  if (text === null || text === '') return { profile: freshProfile(deps), status: 'fresh' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { profile: freshProfile(deps), status: park(storage, text) }; }
  if (isObj(parsed) && isNum(parsed.v) && parsed.v > PROFILE_VERSION) return { profile: freshProfile(deps), status: 'newer' };
  const ok = parseProfile(parsed);
  if (ok) return { profile: ok, status: 'ok' };
  return { profile: freshProfile(deps), status: park(storage, text) };
}

function park(storage: StorageLike, text: string): LoadStatus {
  try { storage.setItem(PROFILE_BACKUP_KEY, text.slice(0, 20000)); } catch { /* ignore */ }
  return 'corrupt';
}

/** Write the envelope now. Returns false if storage refused. Never throws. */
export function saveProfile(storage: StorageLike | null, p: Profile): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify({ v: p.v, instance: p.instance, stats: p.stats }));
    return true;
  } catch { return false; }
}

export interface ProfileStoreOptions extends ProfileDeps {
  /** minimum ms between automatic writes (default 2000) */
  throttleMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
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
}

/** Profile + throttled autosave. The first-visit profile is written straight away so the starter id is stable from visit one. */
export function createProfileStore(storage: StorageLike | null, opts: ProfileStoreOptions = {}): ProfileStore {
  const throttle = opts.throttleMs ?? 2000;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const loaded = loadProfile(storage, opts);
  const profile = loaded.profile;
  const canWrite = loaded.status !== 'newer';
  let dirty = false;
  let lastWrite = -Infinity;
  let timer: unknown = null;
  let writes = 0;

  const write = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!dirty || !canWrite) return;
    dirty = false;
    lastWrite = now();
    writes++;
    saveProfile(storage, profile);
  };
  const schedule = (): void => {
    dirty = true;
    if (!canWrite || timer !== null) return;
    const wait = Math.max(0, lastWrite + throttle - now());
    if (wait === 0) { write(); return; }
    timer = setTimer(() => { timer = null; write(); }, wait);
  };

  if (canWrite && loaded.status !== 'ok') { dirty = true; write(); }

  return {
    profile,
    status: loaded.status,
    bump(stat) { profile.stats[stat] = Math.min(profile.stats[stat] + 1, 1e9); schedule(); },
    touch() { schedule(); },
    flush() { write(); },
    dispose() { write(); },
    get writes() { return writes; },
  };
}
