// WOBBLEHOARD trophies (UI.md 6 and B6; _handoff/design/PUBLISH_CHECKLIST_SHORT.md section 3): the 20 achievements, their evaluator and their save shape.
//
// PURE: no DOM, no storage, no network, no clock and no random source in this file. The caller passes the time (`now`) and every fact; the evaluator only
// decides. `src/data/achievements.json` is the single source of the rows (the portal seeder reads the same file), and its `trigger` objects hold every
// threshold: this file never re-types a number (the probe checks them against the meter's own constants, so the economy and the trophies cannot drift).
//
// WHAT FEEDS IT (src/shell/achievementsBinding.ts does the wiring; every fact comes from something the game really does):
//   touch(ev, tMs)      every SoftEvent the collection is fed (collection.feed): a squeeze is a `release` held long enough, a stretch is a `snap`
//                       at the pull level, a toss is a `snap` while the body was carried, the medley is a squeeze and a stretch inside the window
//   carried(on)         once per sim step: SoftMetrics.carried of the play body or a mat body (a pull past the body's limit lifts it)
//   pieces(n, busy)     once per sim step: Cutter.pieces and Cutter.busy (1 = whole). A rise to 2 or more is a cut, 4 is "four at once", a fall back
//                       to 1 while a join was playing is "put back together" (an instant reconnect that LEAVING forces is not the player's doing)
//   opened(tierIdx)     a capsule opened (OpenOk), merged(tierIdx, tierUp) a merge or a Tidy-up merge (MergeOk), taskDone() a task claimed
//   species(n)          how many of the 50 species the Hoard holds (stacks with copies > 0)
// Once per slug: a slug in `save.earned` never fires again, in this page or after a reload. Nothing here ever loses or undoes a trophy.
import achievementsFile from '../data/achievements.json' with { type: 'json' };

export type AchTier = 'bronze' | 'silver' | 'gold' | 'diamond';
export const ACH_TIERS: readonly AchTier[] = ['bronze', 'silver', 'gold', 'diamond'];
/** The portal pipeline's tier defaults (XP per achievement): bronze 5, silver 15, gold 30, diamond 60 (8 / 7 / 3 / 2 rows = 355 XP). */
export const TIER_POINTS: Readonly<Record<AchTier, number>> = { bronze: 5, silver: 15, gold: 30, diamond: 60 };

export type TriggerOn = 'squeeze' | 'stretch' | 'toss' | 'medley' | 'pieces' | 'join' | 'open' | 'merge' | 'tier' | 'task' | 'species';
const TRIGGERS: readonly TriggerOn[] = ['squeeze', 'stretch', 'toss', 'medley', 'pieces', 'join', 'open', 'merge', 'tier', 'task', 'species'];

/** When a row is earned. `min`: the fact's value must be at least this (squeeze: seconds held; stretch: pull level 0..1; pieces: pieces at once; open and tier:
 *  tier index 0..5; species: species owned). `tierUp`: a merge that lifted the rarity. `windowMs`: the medley's window. `tier` fires for an opened capsule OR a merge. */
export interface Trigger { on: TriggerOn; min?: number; tierUp?: boolean; windowMs?: number }

export interface AchievementDef {
  /** final: the portal's achievement slug (a-z, 0-9, _; at most 64) */
  slug: string;
  /** at most 80 characters (the portal seeder's cap) */
  name: string;
  /** at most 240; kind wording (no loss, no streak, no timer pressure) */
  description: string;
  tier: AchTier;
  points: number;
  /** shown as "???" until earned (the portal row is `secret`) */
  hidden: boolean;
  trigger: Trigger;
}

const SLUG_RE = /^[a-z][a-z0-9_]{1,63}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate the data file. Rows that are malformed are LEFT OUT (the probe asserts none are: a static file never ships a bad row); duplicates keep the first. */
export function parseAchievements(file: unknown): AchievementDef[] {
  const rows = file && typeof file === 'object' ? (file as { achievements?: unknown }).achievements : null;
  if (!Array.isArray(rows)) return [];
  const out: AchievementDef[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const t = o.trigger as Record<string, unknown> | null | undefined;
    if (typeof o.slug !== 'string' || !SLUG_RE.test(o.slug) || seen.has(o.slug)) continue;
    if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 80) continue;
    if (typeof o.description !== 'string' || !o.description.trim() || o.description.length > 240) continue;
    if (typeof o.tier !== 'string' || !(ACH_TIERS as readonly string[]).includes(o.tier)) continue;
    if (!isNum(o.points) || o.points < 0 || typeof o.hidden !== 'boolean') continue;
    if (!t || typeof t !== 'object' || typeof t.on !== 'string' || !(TRIGGERS as readonly string[]).includes(t.on)) continue;
    const trigger: Trigger = { on: t.on as TriggerOn };
    if (t.min !== undefined) { if (!isNum(t.min)) continue; trigger.min = t.min; }
    if (t.tierUp !== undefined) { if (typeof t.tierUp !== 'boolean') continue; trigger.tierUp = t.tierUp; }
    if (t.windowMs !== undefined) { if (!isNum(t.windowMs) || t.windowMs <= 0) continue; trigger.windowMs = t.windowMs; }
    seen.add(o.slug);
    out.push({ slug: o.slug, name: o.name, description: o.description, tier: o.tier as AchTier, points: o.points, hidden: o.hidden, trigger });
  }
  return out;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze(parseAchievements(achievementsFile));
export const ACH_BY_SLUG: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map((d) => [d.slug, d]));
export const ACH_TOTAL_POINTS: number = ACHIEVEMENTS.reduce((n, d) => n + d.points, 0);

const BY_ON = new Map<TriggerOn, AchievementDef[]>();
for (const d of ACHIEVEMENTS) { const l = BY_ON.get(d.trigger.on); if (l) l.push(d); else BY_ON.set(d.trigger.on, [d]); }
/** The smallest `min` any row asks of a fact: what counts as "a squeeze" or "a stretch" at all (the rows' own data, never a copy of the meter's number). */
const floorOf = (on: TriggerOn): number => { let m = Infinity; for (const d of BY_ON.get(on) ?? []) m = Math.min(m, d.trigger.min ?? 0); return m === Infinity ? 0 : m; };
const SQUEEZE_FLOOR = floorOf('squeeze');
const STRETCH_FLOOR = floorOf('stretch');
const MEDLEY_WINDOW = ((BY_ON.get('medley') ?? [])[0]?.trigger.windowMs) ?? 12000;

/* ───────────────────────────────────────────────── the save ───────────────────────────────────────────────── */

export const ACH_SAVE_VERSION = 1;
/** Lifetime counters from the day this build started counting (no backfill: Records says so). */
export interface AchCounters { squeezes: number; stretches: number; tosses: number; cuts: number; joins: number; capsules: number; merges: number; tasks: number; species: number }
export const COUNTER_KEYS: readonly (keyof AchCounters)[] = ['squeezes', 'stretches', 'tosses', 'cuts', 'joins', 'capsules', 'merges', 'tasks', 'species'];
export interface AchSave {
  v: 1;
  /** epoch ms: when this device first started counting */
  since: number;
  /** slug -> epoch ms earned. Slugs this build does not know (a newer build's) are carried through untouched. */
  earned: Record<string, number>;
  counters: AchCounters;
}

const COUNTER_MAX = 1_000_000_000;
const EARNED_MAX_KEYS = 120;
const MAX_T_MS = 8.64e15;
const EARNED_KEY_RE = /^[a-z0-9_]{1,64}$/;
export const emptyCounters = (): AchCounters => ({ squeezes: 0, stretches: 0, tosses: 0, cuts: 0, joins: 0, capsules: 0, merges: 0, tasks: 0, species: 0 });
export const emptyAchSave = (now: number): AchSave => ({ v: 1, since: isNum(now) && now >= 0 && now <= MAX_T_MS ? Math.floor(now) : 0, earned: {}, counters: emptyCounters() });

export type AchLoadStatus = 'fresh' | 'ok' | 'newer' | 'unreadable';

/** Read whatever came out of storage (already JSON-parsed). Never throws; garbage fields become defaults, bad rows are dropped. */
export function sanitizeAchSave(raw: unknown, now: number): { save: AchSave; status: AchLoadStatus } {
  if (raw === null || raw === undefined) return { save: emptyAchSave(now), status: 'fresh' };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { save: emptyAchSave(now), status: 'unreadable' };
  const o = raw as Record<string, unknown>;
  if (!isNum(o.v) || o.v < 1) return { save: emptyAchSave(now), status: 'unreadable' };
  const save = emptyAchSave(now);
  if (isNum(o.since) && o.since >= 0 && o.since <= MAX_T_MS) save.since = Math.floor(o.since);
  const e = o.earned;
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    let n = 0;
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      if (n >= EARNED_MAX_KEYS) break;
      if (!EARNED_KEY_RE.test(k) || !isNum(v) || v < 0 || v > MAX_T_MS) continue;
      save.earned[k] = Math.floor(v);
      n++;
    }
  }
  const c = o.counters;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    for (const k of COUNTER_KEYS) { const v = (c as Record<string, unknown>)[k]; if (isNum(v) && v >= 0) save.counters[k] = Math.min(COUNTER_MAX, Math.floor(v)); }
  }
  return { save, status: o.v > ACH_SAVE_VERSION ? 'newer' : 'ok' };
}

/** Fold `other` into `into` (two tabs, or a reload that raced a write): the union of trophies (the earlier stamp wins), the larger of each counter, the earlier start. */
export function mergeAchSaves(into: AchSave, other: AchSave): void {
  for (const [k, t] of Object.entries(other.earned)) {
    if (!(k in into.earned)) { if (Object.keys(into.earned).length < EARNED_MAX_KEYS) into.earned[k] = t; } else if (t < into.earned[k]) into.earned[k] = t;
  }
  for (const k of COUNTER_KEYS) if (other.counters[k] > into.counters[k]) into.counters[k] = other.counters[k];
  if (other.since < into.since) into.since = other.since;
}

/* ───────────────────────────────────────────────── the evaluator ───────────────────────────────────────────────── */

/** The slice of a SoftEvent the evaluator reads (contracts.ts SoftEvent satisfies it). */
export interface TouchLike { kind: string; intensity: number; heldFor: number }

export interface EvaluatorDeps {
  /** the save it fills (it mutates `earned` and `counters` in place) */
  save: AchSave;
  /** epoch ms, stamped on a new trophy */
  now(): number;
  /** a trophy was just earned (once per slug, ever). `retro`: found by looking at what the player already had when counting started. */
  onUnlock(def: AchievementDef, at: number, retro: boolean): void;
  /** the save changed (a counter or a trophy): the store writes soon */
  onDirty?(): void;
}

export interface Evaluator {
  readonly save: AchSave;
  touch(ev: TouchLike, tMs: number): void;
  carried(on: boolean): void;
  pieces(n: number, busy: boolean): void;
  opened(tierIdx: number): void;
  merged(tierIdx: number, tierUp: boolean): void;
  taskDone(): void;
  species(n: number, retro?: boolean): void;
  isEarned(slug: string): boolean;
  earnedAt(slug: string): number | null;
  /** trophies earned among the rows this build knows */
  earnedCount(): number;
  earnedPoints(): number;
  /** countable rows only (species): how far along, capped at the target; null for a one-moment row */
  progress(slug: string): { value: number; target: number } | null;
}

export function createEvaluator(d: EvaluatorDeps): Evaluator {
  const save = d.save;
  const c = save.counters;
  let lastSqueeze = -Infinity, lastStretch = -Infinity;
  let lifted = false;
  let prevPieces = 1, prevBusy = false;

  const has = (slug: string): boolean => Object.prototype.hasOwnProperty.call(save.earned, slug);
  const bump = (k: keyof AchCounters): void => { if (c[k] < COUNTER_MAX) { c[k]++; d.onDirty?.(); } };

  /** one fact: every unearned row listening for `on` whose threshold the value reaches is earned now */
  function fire(on: TriggerOn, value: number, retro = false, tierUp = false): void {
    const list = BY_ON.get(on);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const def = list[i];
      if (has(def.slug)) continue;
      const t = def.trigger;
      if (t.min !== undefined && !(value >= t.min)) continue;
      if (t.tierUp && !tierUp) continue;
      const at = d.now();
      save.earned[def.slug] = at;
      d.onDirty?.();
      try { d.onUnlock(def, at, retro); } catch { /* a failing toast or post must never undo or block a trophy */ }
    }
  }

  function medleyTouch(kind: 'squeeze' | 'stretch', t: number): void {
    if (kind === 'squeeze') lastSqueeze = t; else lastStretch = t;
    const other = kind === 'squeeze' ? lastStretch : lastSqueeze;
    const gap = t - other;
    if (gap >= 0 && gap <= MEDLEY_WINDOW) fire('medley', 1);
  }

  return {
    save,
    touch(ev, tMs) {
      const k = ev.kind;
      if (k === 'release') {
        const h = ev.heldFor;
        if (typeof h !== 'number' || !(h >= SQUEEZE_FLOOR) || h === Infinity) return;
        bump('squeezes');
        fire('squeeze', h);
        if (isNum(tMs)) medleyTouch('squeeze', tMs);
      } else if (k === 'snap') {
        const i = ev.intensity;
        if (lifted) { lifted = false; bump('tosses'); fire('toss', 1); }
        if (typeof i !== 'number' || !Number.isFinite(i) || !(i >= STRETCH_FLOOR)) return;
        bump('stretches');
        fire('stretch', i);
        if (isNum(tMs)) medleyTouch('stretch', tMs);
      }
    },
    carried(on) { lifted = !!on; },
    pieces(n, busy) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return;
      if (n >= 2 && prevPieces < 2) bump('cuts');
      if (n >= 2 && n !== prevPieces) fire('pieces', n);
      if (n === 1 && prevPieces >= 2 && prevBusy) { bump('joins'); fire('join', 1); }
      prevPieces = n; prevBusy = busy;
    },
    opened(tierIdx) { const t = Number.isFinite(tierIdx) ? tierIdx : 0; bump('capsules'); fire('open', t); fire('tier', t); },
    merged(tierIdx, tierUp) { const t = Number.isFinite(tierIdx) ? tierIdx : 0; bump('merges'); fire('merge', t, false, !!tierUp); fire('tier', t); },
    taskDone() { bump('tasks'); fire('task', 1); },
    species(n, retro = false) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return;
      if (n > c.species) { c.species = Math.min(COUNTER_MAX, Math.floor(n)); d.onDirty?.(); }
      fire('species', n, retro);
    },
    isEarned: has,
    earnedAt: (slug) => (has(slug) ? save.earned[slug] : null),
    earnedCount() { let n = 0; for (const def of ACHIEVEMENTS) if (has(def.slug)) n++; return n; },
    earnedPoints() { let n = 0; for (const def of ACHIEVEMENTS) if (has(def.slug)) n += def.points; return n; },
    progress(slug) {
      const def = ACH_BY_SLUG.get(slug);
      if (!def || def.trigger.on !== 'species' || def.trigger.min === undefined) return null;
      return { value: Math.min(c.species, def.trigger.min), target: def.trigger.min };
    },
  };
}
