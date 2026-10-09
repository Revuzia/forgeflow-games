// The trophy save (UI.md 6: "counters in wobblehoard:v1:ach"): its own ADDITIVE key, never the Hoard row (wobblehoard:v2:hoard), never the profile, never the
// settings. One JSON blob { v: 1, since, earned: { slug: epochMs }, counters }. Pure TypeScript over an injected StorageLike (core/settings.ts), so it runs
// under plain node in the probe; no DOM here.
//
// Rules (the same family as core/save.ts and collection/store.ts):
//   * an unreadable blob is parked under ACH_BACKUP_KEY (at most 20 000 characters) and counting starts again; the parked copy is never read or deleted here
//   * a blob written by a NEWER build (v > 1) is read for what this build knows and NEVER overwritten (running in memory; `writable` false)
//   * a write first folds in what is stored (the union of trophies, the larger counters), so a second tab or a racing reload can never make a trophy go away
//   * writes are throttled (2 s) except a new trophy, which the binding flushes at once; flush() on pagehide
//   * no storage (a sandbox that refuses localStorage): everything still works in memory for the page
import type { StorageSubscribe } from './save.ts';
import type { StorageLike } from './settings.ts';
import type { AchLoadStatus, AchSave } from './achievements.ts';
import { ACH_SAVE_VERSION, mergeAchSaves, sanitizeAchSave } from './achievements.ts';

export const ACH_KEY = 'wobblehoard:v1:ach';
export const ACH_BACKUP_KEY = 'wobblehoard:v1:ach.unreadable';
export const ACH_PARK_MAX_CHARS = 20_000;
export const ACH_THROTTLE_MS = 2000;

export interface AchStoreDeps {
  /** epoch ms (stamps `since` on a fresh save) */
  now(): number;
  throttleMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
  /** the window 'storage' subscription the shell already has (core/save.ts StorageSubscribe): another tab's write is folded in */
  subscribe?: StorageSubscribe;
}

export interface AchStore {
  /** the live save: the evaluator mutates it in place; the store merges other tabs' trophies into it in place */
  readonly save: AchSave;
  readonly status: AchLoadStatus;
  /** false when nothing is ever written (storage missing, or a newer build's blob) */
  readonly writable: boolean;
  /** something changed: write within the throttle */
  markDirty(): void;
  /** write now when something changed */
  flush(): void;
  /** re-read storage and fold it in (never writes) */
  sync(): void;
  dispose(): void;
}

export function createAchStore(storage: StorageLike | null, deps: AchStoreDeps): AchStore {
  const throttle = deps.throttleMs ?? ACH_THROTTLE_MS;
  const setT = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  let disposed = false;
  let dirty = false;
  let timer: unknown = null;

  const read = (): { raw: unknown; text: string | null; parsed: boolean } => {
    let text: string | null = null;
    try { text = storage ? storage.getItem(ACH_KEY) : null; } catch { text = null; }
    if (text === null) return { raw: null, text, parsed: true };
    try { return { raw: JSON.parse(text), text, parsed: true }; } catch { return { raw: undefined, text, parsed: false }; }
  };

  const first = read();
  let status: AchLoadStatus;
  let save: AchSave;
  if (!first.parsed) {
    // not JSON at all: park a copy, start again
    try { storage?.setItem(ACH_BACKUP_KEY, (first.text ?? '').slice(0, ACH_PARK_MAX_CHARS)); } catch { /* ignore */ }
    ({ save } = sanitizeAchSave(null, deps.now()));
    status = 'unreadable';
  } else {
    const r = sanitizeAchSave(first.raw, deps.now());
    save = r.save;
    status = r.status;
    if (status === 'unreadable') { try { storage?.setItem(ACH_BACKUP_KEY, (first.text ?? '').slice(0, ACH_PARK_MAX_CHARS)); } catch { /* ignore */ } }
  }
  const writable = storage !== null && status !== 'newer';

  function write(): void {
    if (!writable) return;
    // fold in whatever is stored now (another tab's trophies), then write the union
    const cur = read();
    if (cur.parsed && cur.raw !== null) {
      const r = sanitizeAchSave(cur.raw, deps.now());
      if (r.status === 'ok') mergeAchSaves(save, r.save);
      else if (r.status === 'newer') return;   // somebody wrote a newer blob since we loaded: leave it alone
    }
    try { storage!.setItem(ACH_KEY, JSON.stringify({ v: ACH_SAVE_VERSION, since: save.since, earned: save.earned, counters: save.counters })); } catch { /* quota / private mode */ }
  }

  function flush(): void {
    if (timer !== null) { clearT(timer); timer = null; }
    if (disposed || !dirty) return;
    dirty = false;
    write();
  }

  const store: AchStore = {
    get save() { return save; },
    get status() { return status; },
    get writable() { return writable; },
    markDirty() {
      if (disposed) return;
      dirty = true;
      if (timer === null && writable) timer = setT(() => { timer = null; flush(); }, throttle);
    },
    flush,
    sync() {
      if (disposed || !storage) return;
      const cur = read();
      if (!cur.parsed || cur.raw === null) return;
      const r = sanitizeAchSave(cur.raw, deps.now());
      if (r.status === 'ok' || r.status === 'newer') mergeAchSaves(save, r.save);
    },
    dispose() {
      if (disposed) return;
      try { flush(); } catch { /* ignore */ }
      disposed = true;
      if (timer !== null) { clearT(timer); timer = null; }
      off();
    },
  };
  const off = deps.subscribe ? deps.subscribe((key) => { if (key === null || key === ACH_KEY) store.sync(); }) : (): void => {};

  // a first visit (or a parked blob) writes at once, so `since` (the day counting began) is fixed and the fresh blob is the one on disk
  if (status === 'fresh' || status === 'unreadable') { dirty = true; flush(); }
  return store;
}
