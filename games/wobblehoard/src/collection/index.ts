// WOBBLEHOARD collection: createCollection(deps) -> Collection (_spec/COLLECTION.md 3.4). THIS BUILD IS GUEST-ONLY AND LOCAL:
// the practice ledger (ghost items, collection/ghost.ts) on a v2 save (collection/store.ts). No server, no bridge, no outgoing message
// of any kind. The server pieces (bridge.ts, api.ts, sync.ts and the 'real' ledger) slot in behind the same interface later:
//   * reads take a `ledger` argument; 'real' returns empty lists here;
//   * the actions are Promises that resolve with server-shaped results (snake_case fields), so the real versions change no caller;
//   * `feed` maps touches once (meterfeed.ts) and hands them to the practice meter; the real ledger will hand the same touches to a
//     preview meter and the play buffer (meterfeed.ts createPreviewMeter / createTouchBuffer, already built and probed).
// Clock and randomness: `deps.now` (epoch ms) and `deps.random` ([0, 1)); their defaults below are the ONLY reads of Date.now() and
// Math.random() in src/collection. DOM stays outside: storage, the cross-tab subscription and the timers are injected.
//
// WIRING (shell):
//   const subscribe: StorageSubscribe = (fn) => { const h = (e: StorageEvent) => fn(e.key); addEventListener('storage', h); return () => removeEventListener('storage', h); };
//   const profile = createProfileStore(storage, { subscribe });                       // first: the starter ghost then keeps its id
//   const collection = createCollection({ storage, profile: profile.profile, subscribe });
//   frame loop: for each drained SoftEvent -> collection.feed(ev, nowMs)              // any ms clock; anchored to the epoch inside
//   while a squeeze or a stretch is held: collection.previewTouch?.(kind, heldS, level) -> the pending arc's SP (pure, allocation-free)
//   collection.onChange(rerender); collection.onEvent((e) => e.type === 'capsule' ? stage.dropCapsule?.() ... )
//   const r = await collection.openCapsule(); then stage.playCapsuleReveal with r.item.genome / r.tier_idx / r.is_new; then markSeen([r.item_id])
//   merge: previewMerge(ids) -> hold -> merge(ids, preview.digest); MergeCeremonySpec.parents = r.parents (the consumed copies are
//          already gone from items()); then markSeen([r.item_id])
//   pagehide / visibilitychange hidden -> collection.flush(); focus -> collection.sync(); teardown -> collection.dispose()
import type { SoftEvent } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import type { Interaction, TouchKind } from '../core/meter.ts';
import { DAY_MS, capsuleThreshold, dailyRateFor, dailyStatus, meterFill, previewInteraction } from '../core/meter.ts';
import { MERGE_DAILY_CAP } from '../core/merge.ts';
import type { Profile, StorageSubscribe } from '../core/save.ts';
import type { StorageLike } from '../core/settings.ts';
import type { SpeciesId } from '../data/catalog.ts';
import { GHOST_CAP, HOARD_KEY, MAX_SQUEEZE_SECONDS, RELEASE_SQUEEZE_MIN_S, TIDY_MAX, WH_QUEUE_MAX } from './constants.ts';
import {
  createFeedOutcome, dayOf, ghostClaimRestock, ghostCompleteTask, ghostFeed, ghostMerge, ghostOpen, ghostPreviewMerge, ghostRestockView, ghostTaskRows,
  ghostTidy, mergesToday,
} from './ghost.ts';
import { SNAP_MIN_LEVEL, clampHold, createMappedTouch, mapSoftEvent } from './meterfeed.ts';
import { mergeErrorCopy, openErrorCopy, restockErrorCopy, taskErrorCopy } from './copy.ts';
import { buildStacks, defaultMergeInputs, tidyCandidates } from './stacks.ts';
import { FLAG_FAV, FLAG_SEEN, createHoardStore, rowToItem, sanitizePrefs } from './store.ts';
import type {
  ClaimResult, Collection, CollectionEvent, HoardItem, HoardPrefs, Ledger, MergePreviewResult, MergeResult, MeterView, OpenResult, PracticeSummary,
  RestockView, Stack, StorageReport, TaskResult, TaskRow, TidyResult,
} from './types.ts';

export type * from './types.ts';
export { HOARD_KEY, HOARD_BACKUP_KEY, WH_QUEUE_MAX, GHOST_CAP } from './constants.ts';
export { findGhostIds } from './ghost.ts';

export interface CollectionDeps {
  /** The StorageLike of core/settings.ts (safeLocalStorage() in the browser); null = run in memory. */
  storage: StorageLike | null;
  /** Epoch ms. Default Date.now. */
  now?: () => number;
  /** [0, 1). Default Math.random. Used for practice rolls and ids only (never for anything real). */
  random?: () => number;
  /**
   * The slice-1 profile the shell already loaded (createProfileStore(storage).profile): the starter ghost then keeps the shell's starter
   * id. Omitted: the v1 key is read (read only). null: ignore the v1 profile.
   */
  profile?: Profile | null;
  /** Cross-tab: the shell wires window 'storage' (core/save.ts StorageSubscribe). Without it, two tabs are reconciled at each write. */
  subscribe?: StorageSubscribe;
  /** Throttle of automatic writes (default 2000 ms) and injectable timers (tests). */
  throttleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** The feed re-anchors the shell's clock to the epoch clock when they drift apart by more than this. */
const CLOCK_SLACK_MS = 1000;
const EMPTY_ITEMS: readonly HoardItem[] = Object.freeze([]);

export function createCollection(deps: CollectionDeps): Collection {
  const now = deps.now ?? (() => Date.now());
  const rand = deps.random ?? (() => Math.random());
  const ledger: Ledger = 'practice';
  const isPractice = (l: Ledger): boolean => l === 'practice';

  let disposed = false;
  let listeners: Array<() => void> = [];
  let eventListeners: Array<(e: CollectionEvent) => void> = [];
  const notify = (): void => {
    const ls = listeners;
    for (let i = 0; i < ls.length; i++) { try { ls[i](); } catch { /* a UI listener must not break the frame loop */ } }
  };
  const emit = (e: CollectionEvent): void => {
    const ls = eventListeners;
    for (let i = 0; i < ls.length; i++) { try { ls[i](e); } catch { /* ignore */ } }
  };

  // ---- caches (rebuilt only after a change) ----
  let version = 0;
  let itemsVersion = -1;
  let itemsCache: readonly HoardItem[] = EMPTY_ITEMS;
  let byId = new Map<string, HoardItem>();
  const genomeCache = new Map<string, Genome>();
  let stacksVersion = -1;
  let stacksValidUntil = -Infinity;
  let stacksCache: readonly Stack[] = [];
  let realStacks: readonly Stack[] | null = null;

  // ---- transition trackers for the events ----
  let wasFull = false;
  let lastRate = 1;
  const trackTransitions = (): void => {
    const s = store.save;
    wasFull = s.ghostCapsules >= WH_QUEUE_MAX;
    const m = s.ghostMeter;
    lastRate = dailyRateFor(m.day === dayOf(now()) ? m.dayCapsules : 0);
  };

  // the store may report during its own construction (a failing first write): nobody listens yet, and `store` is not assigned
  let ready = false;
  const store = createHoardStore(deps.storage, {
    now, rand, profile: deps.profile, throttleMs: deps.throttleMs, setTimer: deps.setTimer, clearTimer: deps.clearTimer, subscribe: deps.subscribe,
    onExternal: () => { version++; if (!ready) return; trackTransitions(); emit({ type: 'external' }); notify(); },
    onSaveState: () => { if (!ready) return; emit({ type: 'storage', report: store.report() }); notify(); },
  });
  ready = true;
  trackTransitions();

  const changed = (): void => { version++; store.markDirty(); notify(); };

  const practiceItems = (): readonly HoardItem[] => {
    if (itemsVersion === version) return itemsCache;
    const out: HoardItem[] = [];
    const map = new Map<string, HoardItem>();
    for (const row of store.save.ghosts) { const it = rowToItem(row, 'practice', genomeCache); if (it) { out.push(it); map.set(it.id, it); } }
    out.sort((a, b) => a.bornAt - b.bornAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (genomeCache.size > 4 * GHOST_CAP) genomeCache.clear();
    itemsCache = Object.freeze(out);
    byId = map;
    itemsVersion = version;
    return itemsCache;
  };

  const practiceStacks = (): readonly Stack[] => {
    const t = now();
    if (stacksVersion === version && t < stacksValidUntil) return stacksCache;
    const items = practiceItems();
    stacksCache = Object.freeze(buildStacks(items, 'practice', t).map((st) => Object.freeze(st)));
    // a lock that runs out changes the stack (mergeable, locked): rebuild then
    let next = Infinity;
    for (const it of items) if (it.lockedUntil !== null && it.lockedUntil > t && it.lockedUntil < next) next = it.lockedUntil;
    stacksValidUntil = next;
    stacksVersion = version;
    return stacksCache;
  };

  // ---- feed: the frame loop's hot path ----
  const touch = createMappedTouch();
  const scratch: Interaction = { kind: 'poke', amount: 0, heldS: 0, tMs: 0 };
  const outcome = createFeedOutcome();
  // [clock offset, last fed time] in a typed array: plain `let` doubles in a closure would box a number on every paid touch
  const clk = new Float64Array([NaN, -Infinity]);
  const epochOf = (tMs: number): number => {
    const wall = now();
    let t = wall;
    if (typeof tMs === 'number' && Number.isFinite(tMs)) {
      if (clk[0] !== clk[0] || Math.abs(tMs + clk[0] - wall) > CLOCK_SLACK_MS) clk[0] = wall - tMs;
      t = tMs + clk[0];
    }
    if (t < clk[1]) t = clk[1];
    clk[1] = t;
    return t;
  };

  const feed = (ev: SoftEvent, tMs: number): void => {
    if (disposed || !mapSoftEvent(ev, touch)) return; // not a touch: no work, no allocation
    scratch.kind = touch.kind;
    scratch.amount = touch.amount;
    scratch.heldS = touch.heldS;
    scratch.tMs = epochOf(tMs);
    const s = store.save;
    ghostFeed(s, scratch, outcome);
    if (outcome.full) {
      if (!wasFull) { wasFull = true; emit({ type: 'table-full' }); }
      return;
    }
    if (!outcome.accepted) return;
    if (outcome.earned > 0) emit({ type: 'capsule', source: 'play', credits: s.ghostCapsules + s.ghostTaskCapsules });
    const full = s.ghostCapsules >= WH_QUEUE_MAX;
    if (full && !wasFull) emit({ type: 'table-full' });
    wasFull = full;
    const rate = dailyRateFor(s.ghostMeter.dayCapsules);
    if (rate < lastRate) emit(rate === 0 ? { type: 'done-today' } : { type: 'resting' });
    lastRate = rate;
    store.markDirty(); // the meter moved (items did not: the item caches stay valid)
    notify();
  };

  // ---- the pending preview (FUN.md 2.2): what the touch in progress would pay if it ended now. Pure: reads the meter, writes nothing
  // but its own scratch record; the same mapping as mapSoftEvent and the feed's clock (never earlier than the last fed touch). ----
  // The work writes its answer into a typed array and the method itself stays tiny, so the engine inlines it into the caller's frame
  // loop and the returned number is never boxed: no allocation at all per call (probe_collection C08 measures it).
  const pv: Interaction = { kind: 'poke', amount: 0, heldS: 0, tMs: 0 };
  const pvOut = new Float64Array(1);
  const previewInto = (kind: unknown, heldS: unknown, level: unknown): void => {
    pvOut[0] = 0;
    if (disposed) return;
    let k: unknown = kind, h: unknown = heldS, l: unknown = level;
    if (kind !== null && typeof kind === 'object') { const q = kind as { kind?: unknown; heldS?: unknown; level?: unknown }; k = q.kind; h = q.heldS; l = q.level; } // the one-object form
    const s = store.save;
    if (s.ghostCapsules >= WH_QUEUE_MAX) return; // table full: the meter does not move
    const hold = typeof h === 'number' && h > 0 && h !== Infinity ? h : 0; // NaN, infinite, negative, missing -> 0 (as mapSoftEvent)
    // A tap pays nothing (owner decision 2026-10-06, "short taps pay nothing"): a poke previews 0, and so does a squeeze that would be
    // released under 0.4 s (that release is a tap too). The meter says the same (computePay), this just skips the work.
    if (k === 'poke') return;
    else if (k === 'squeeze') {
      if (!(hold >= RELEASE_SQUEEZE_MIN_S)) return; // that release would not be a squeeze: it is a tap, which pays 0
      pv.kind = 'squeeze'; pv.amount = hold > MAX_SQUEEZE_SECONDS ? MAX_SQUEEZE_SECONDS : hold; pv.heldS = 0;
    } else if (k === 'pull') {
      const lv = typeof l === 'number' && l > 0 ? (l > 1 ? 1 : l) : 0;
      if (!(lv > SNAP_MIN_LEVEL)) return; // no snap would fire
      pv.kind = 'pull'; pv.amount = lv; pv.heldS = clampHold(hold);
    } else return;
    const wall = now();
    pv.tMs = clk[1] > wall ? clk[1] : wall;
    pvOut[0] = previewInteraction(s.ghostMeter, pv);
  };
  const previewTouch = (kind: TouchKind | { kind?: unknown; heldS?: unknown; level?: unknown }, heldS?: number, level?: number): number => {
    previewInto(kind, heldS, level);
    return pvOut[0];
  };

  const meter = (): MeterView => {
    const s = store.save;
    const m = s.ghostMeter;
    const st = dailyStatus(m, dayOf(now()));
    return {
      ledger, fill: meterFill(m), sp: m.sp, threshold: capsuleThreshold(m.earned), credits: s.ghostCapsules + s.ghostTaskCapsules,
      playCredits: s.ghostCapsules, resting: st.rate > 0 && st.rate < 1, doneToday: st.hardStopped, tableFull: s.ghostCapsules >= WH_QUEUE_MAX, offline: false,
    };
  };

  const ctx = (): { rand: () => number; now: number } => ({ rand, now: now() });
  const unavailable = <E extends string>(error: E): { ok: false; ledger: Ledger; error: E } => ({ ok: false, ledger: 'real', error });

  const collection: Collection = {
    get mode() { return 'guest' as const; },
    get ledger() { return ledger; },
    items: (l: Ledger = ledger) => (isPractice(l) ? practiceItems().slice() : []),
    item: (id: string) => { practiceItems(); return byId.get(id) ?? null; },
    stacks: (l: Ledger = ledger) => {
      if (isPractice(l)) return practiceStacks().slice();
      if (!realStacks) realStacks = Object.freeze(buildStacks([], 'real', 0).map((st) => Object.freeze(st)));
      return realStacks.slice();
    },
    meter,
    practice: (): PracticeSummary => {
      const s = store.save;
      return { ghosts: s.ghosts.length, cap: GHOST_CAP, full: s.ghosts.length >= GHOST_CAP, opened: s.ghostOpened, mergesToday: mergesToday(s, now()), mergeCap: MERGE_DAILY_CAP };
    },
    onChange(fn) {
      listeners = listeners.concat(fn);
      return () => { listeners = listeners.filter((f) => f !== fn); };
    },
    onEvent(fn) {
      eventListeners = eventListeners.concat(fn);
      return () => { eventListeners = eventListeners.filter((f) => f !== fn); };
    },
    feed,
    previewTouch,
    openCapsule(): Promise<OpenResult> {
      if (!isPractice(ledger)) return Promise.resolve(unavailable('unavailable'));
      const r = ghostOpen(store.save, ctx());
      if (r.ok) { wasFull = store.save.ghostCapsules >= WH_QUEUE_MAX; changed(); } else r.message = openErrorCopy(r.error);
      return Promise.resolve(r);
    },
    restock(): RestockView { return ghostRestockView(store.save, now()); },
    claimRestock(pick: SpeciesId): Promise<ClaimResult> {
      if (!isPractice(ledger)) return Promise.resolve(unavailable('unavailable'));
      const r = ghostClaimRestock(store.save, pick, ctx());
      if (r.ok) changed(); else r.message = restockErrorCopy(r.error);
      return Promise.resolve(r);
    },
    tasks(): TaskRow[] { return ghostTaskRows(store.save, now()); },
    completeTask(id: string): Promise<TaskResult> {
      if (!isPractice(ledger)) return Promise.resolve(unavailable('unavailable'));
      const r = ghostCompleteTask(store.save, id, now());
      if (r.ok) { changed(); emit({ type: 'capsule', source: 'task', credits: r.credits }); } else r.message = taskErrorCopy(r.error, r.progress, r.target);
      return Promise.resolve(r);
    },
    mergeInputs: (species: SpeciesId) => defaultMergeInputs(practiceStacks(), species),
    previewMerge(ids): MergePreviewResult {
      if (!isPractice(ledger)) return unavailable('unavailable');
      const r = ghostPreviewMerge(store.save, ids, now());
      if (!r.ok) r.message = mergeErrorCopy(r.error);
      return r;
    },
    merge(ids, digest): Promise<MergeResult> {
      if (!isPractice(ledger)) return Promise.resolve(unavailable('unavailable'));
      const r = ghostMerge(store.save, ids, typeof digest === 'string' ? digest : '', ctx());
      if (r.ok) changed(); else r.message = mergeErrorCopy(r.error);
      return Promise.resolve(r);
    },
    tidyPlan(opts) {
      const left = Math.max(0, MERGE_DAILY_CAP - mergesToday(store.save, now()));
      return tidyCandidates(practiceStacks(), { includeRare: !!(opts && opts.includeRare), maxPairs: Math.min(TIDY_MAX, left) });
    },
    tidy(plan): Promise<TidyResult> {
      if (!isPractice(ledger)) return Promise.resolve({ ok: false, ledger: 'real', results: [], done: 0, best: null, error: 'unavailable' });
      const r = ghostTidy(store.save, plan, ctx());
      for (const x of r.results) if (!x.ok) x.message = mergeErrorCopy(x.error);
      if (r.done > 0) changed();
      return Promise.resolve(r);
    },
    setFav(ids, fav) {
      let n = 0;
      if (Array.isArray(ids)) for (const row of store.save.ghosts) if (ids.includes(row[0])) { const f = fav ? row[4] | FLAG_FAV : row[4] & ~FLAG_FAV; if (f !== row[4]) { row[4] = f; n++; } }
      if (n) changed();
      return Promise.resolve();
    },
    markSeen(ids) {
      let n = 0;
      if (Array.isArray(ids)) for (const row of store.save.ghosts) if (ids.includes(row[0]) && !(row[4] & FLAG_SEEN)) { row[4] |= FLAG_SEEN; n++; }
      if (n) changed();
      return Promise.resolve();
    },
    prefs: (): HoardPrefs => ({ ...store.save.prefs }),
    setPrefs(p) {
      const next = sanitizePrefs({ ...store.save.prefs, ...(p && typeof p === 'object' ? p : {}) });
      if (JSON.stringify(next) === JSON.stringify(store.save.prefs)) return;
      store.save.prefs = next;
      store.markDirty();
      notify();
    },
    storage: (): StorageReport => store.report(),
    sync() { if (!disposed) store.sync(); },
    flush() { store.flush(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      store.dispose();
      listeners = [];
      eventListeners = [];
    },
  };
  return collection;
}

/** The storage key the shell's 'storage' listener can filter on (any of these changing means "call collection.sync()"). */
export const COLLECTION_STORAGE_KEYS: readonly string[] = [HOARD_KEY];
/** UTC day length used for the practice day boundary (re-exported for the UI's "come back tomorrow" maths). */
export const PRACTICE_DAY_MS = DAY_MS;
