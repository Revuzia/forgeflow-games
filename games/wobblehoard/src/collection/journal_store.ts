// PLAYGROUND Journal store and runtime (_spec/PLAYGROUND_BUILD.md 12; _spec/QUESTS.md 11; brief _handoff/briefs/PG_QUESTS.md steps 5 and 8).
//
//   createJournalStore(storage, opts)   the journal under JOURNAL_KEY: load (migrate, park, a newer blob read-only), throttled writes with a
//                                       two-tab merge, the cap's pruning order and the refused write (CO-01, CO-03, CO-11). Cloned from
//                                       store.ts createHoardStore; never touches the hoard key (CO-08: only ghostGrantGift writes a hoard row).
//   attachJournal(collection, deps)     the post-play life chunk's entry (D-69): builds the store, runs the backfill and the shelf reconcile,
//                                       resumes a pending gift, and attaches feedPlay / claimGift / warmthOf / journal() to the collection.
//
// LOADING (D-69): the LIFE CHUNK (the shell's quest host imports attachJournal); never boot. No clock and no random source of its own: the
// UTC day comes from the collection's injected clock (HoardGiftPort.now). Never a squish point, a capsule or a meter call (QUESTS 11).
import type { PlayEventRing } from '../contracts.ts';
import type { StorageSubscribe, VersionStep } from '../core/save.ts';
import { migrateVersioned } from '../core/save.ts';
import type { StorageLike } from '../core/settings.ts';
import type { QuestDefs } from '../core/quests.ts';
import {
  QOUT, SC, UNLOCK_FRIENDS, applyEventFields, applyPlayEvent, createQuestOut, friendMaskOf, giftListHas, giftReady, openPlacesByStamps, setGiftState, setQuestDay,
} from '../core/quests.ts';
import type { SpeciesId } from '../data/catalog.ts';
import { SPECIES, getSpecies } from '../data/catalog.ts';
import { BY, CHAPTERS, EV } from '../data/quests.ts';
import { GIFT_COPY } from './copy.ts';
import { giftItemId } from './ghost.ts';
import { JOURNAL_KEY, PARK_MAX_CHARS, SAVE_THROTTLE_MS } from './constants.ts';
import type { Journal } from './journal.ts';
import {
  JOURNAL_BACKUP_KEY, JOURNAL_MAX_CHARS, JOURNAL_VERSION, backfillJournal, createJournal, forgetJournalAccount, journalDefs, journalView, mergeJournals, reconcileJournalShelf, sanitizeJournal, serializeJournalCapped,
  setJournalParty, warmthOfId,
} from './journal.ts';
import type { Collection, GiftClaimResult, HoardGiftPort, HoardLoadStatus, HoardSaveState, JournalImpl, JournalView, StorageReport } from './types.ts';

/** Journal format steps: JOURNAL_MIGRATIONS[n] turns a v n journal into v n + 1 (core/save.ts migrateVersioned). Empty while v1 is the only format. */
export const JOURNAL_MIGRATIONS: readonly VersionStep[] = [];
const DAY = 86_400_000;
/** The words for a refused gift claim (QUESTS 11, 15): the gift always waits. */
export function giftErrorCopy(e: string): string {
  return e === 'shelf_full' ? GIFT_COPY.shelfFull : e === 'one_a_day' ? GIFT_COPY.oneADay : e === 'signed_in' ? GIFT_COPY.signedIn : GIFT_COPY.wait;
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/* ═══════════════════════════════════════ parking ═══════════════════════════════════════ */

/** How much a text could give back: 2 a v1 journal object, 1 a JSON object, 0 not JSON, -1 nothing. The backup is never moved to a lower value. */
export function journalSalvageValue(text: string | null): number {
  if (text === null || text === '') return -1;
  let x: unknown;
  try { x = JSON.parse(text); } catch { return 0; }
  if (!isObj(x)) return 0;
  return x.v === JOURNAL_VERSION && ('qd' in x || 'fx' in x) ? 2 : 1;
}
export function parkJournalText(storage: StorageLike, text: string): boolean {
  try {
    const t = text.length <= PARK_MAX_CHARS ? text : text.slice(0, PARK_MAX_CHARS);
    if (journalSalvageValue(t) < journalSalvageValue(storage.getItem(JOURNAL_BACKUP_KEY))) return false;
    storage.setItem(JOURNAL_BACKUP_KEY, t);
    return storage.getItem(JOURNAL_BACKUP_KEY) === t;
  } catch { return false; }
}

/* ═══════════════════════════════════════ load ═══════════════════════════════════════ */

export interface LoadedJournal { journal: Journal; status: HoardLoadStatus; canWrite: boolean; parked: boolean; text: string | null }

/** Load the journal. Never throws. 'newer' (a v above JOURNAL_VERSION): a fresh journal in memory, never written over the newer blob. */
export function loadJournal(storage: StorageLike | null, defs: QuestDefs, deviceId: string): LoadedJournal {
  const fresh = (): Journal => createJournal(defs, deviceId);
  if (!storage) return { journal: fresh(), status: 'unavailable', canWrite: false, parked: false, text: null };
  let text: string | null;
  try { text = storage.getItem(JOURNAL_KEY); } catch { return { journal: fresh(), status: 'unavailable', canWrite: false, parked: false, text: null }; }
  if (text === null || text === '') return { journal: fresh(), status: 'fresh', canWrite: true, parked: false, text };
  let parsed: unknown;
  let ok = true;
  try { parsed = JSON.parse(text); } catch { ok = false; }
  if (ok && isObj(parsed) && typeof parsed.v === 'number' && Number.isFinite(parsed.v) && parsed.v > JOURNAL_VERSION) {
    return { journal: fresh(), status: 'newer', canWrite: false, parked: false, text };
  }
  if (ok) {
    const m = migrateVersioned(parsed, JOURNAL_VERSION, JOURNAL_MIGRATIONS);
    const j = m.ok ? sanitizeJournal(m.value, defs) : null;
    if (j) { j.dev = deviceId || j.dev; return { journal: j, status: 'ok', canWrite: true, parked: false, text }; }
  }
  const parked = parkJournalText(storage, text);
  return { journal: fresh(), status: 'recovered', canWrite: true, parked, text };
}

/* ═══════════════════════════════════════ the store ═══════════════════════════════════════ */

export interface JournalStoreOptions {
  defs: QuestDefs;
  deviceId: string;
  /** epoch ms (the collection's injected clock) */
  now: () => number;
  throttleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  subscribe?: StorageSubscribe;
  onExternal?: () => void;
  onSaveState?: (s: HoardSaveState) => void;
  /** The cap (default JOURNAL_MAX_CHARS; probes lower it to show the refusal). */
  maxChars?: number;
}
export interface JournalStore {
  /** The live journal; REPLACED when another tab's journal is merged in (read it through this getter). */
  readonly journal: Journal;
  readonly status: HoardLoadStatus;
  report(): StorageReport;
  /** Something changed: a throttled write (at most one per SAVE_THROTTLE_MS). */
  markDirty(): void;
  /** Write now if dirty. */
  flush(): void;
  /** Write now, unthrottled, dirty or not (the gift steps 1 and 3); true when the text was written and read back. */
  writeNow(): boolean;
  /** Re-read storage; true when another tab's journal was merged in. */
  sync(): boolean;
  dispose(): void;
  readonly writes: number;
  /** Writes refused because even the pruned text was over JOURNAL_MAX_CHARS (CO-11). */
  readonly refused: number;
}

export function createJournalStore(storage: StorageLike | null, opts: JournalStoreOptions): JournalStore {
  const throttle = opts.throttleMs ?? SAVE_THROTTLE_MS;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const defs = opts.defs;
  const loaded = loadJournal(storage, defs, opts.deviceId);
  let journal = loaded.journal;
  let canWrite = loaded.canWrite && storage !== null;
  let saveState: HoardSaveState = canWrite ? 'ok' : 'off';
  let dirty = false, timer: unknown = null, lastWrite = -Infinity, writes = 0, refused = 0, conflicts = 0;
  let lastText: string | null = loaded.text;

  const readRaw = (): string | null => { if (!storage) return null; try { return storage.getItem(JOURNAL_KEY); } catch { return null; } };
  const setState = (s: HoardSaveState): void => {
    if (s === saveState) return;
    saveState = s;
    if (opts.onSaveState) try { opts.onSaveState(s); } catch { /* a listener must not break the store */ }
  };
  /** Merge another tab's write in (union or max: no base text needed). True when memory changed. */
  const reconcile = (): boolean => {
    const cur = readRaw();
    if (cur === lastText) return false;
    conflicts++;
    lastText = cur;
    if (cur === null || cur === '') { dirty = true; return false; }
    let parsed: unknown;
    try { parsed = JSON.parse(cur); } catch { parsed = undefined; }
    if (isObj(parsed) && typeof parsed.v === 'number' && parsed.v > JOURNAL_VERSION) { canWrite = false; setState('off'); return false; }
    const m = parsed === undefined ? null : migrateVersioned(parsed, JOURNAL_VERSION, JOURNAL_MIGRATIONS);
    const theirs = m && m.ok ? sanitizeJournal(m.value, defs) : null;
    if (!theirs) { if (storage) parkJournalText(storage, cur); dirty = true; return false; }
    journal = mergeJournals(journal, theirs, defs);
    dirty = true;
    return true;
  };
  const write = (force: boolean): boolean => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if ((!dirty && !force) || !canWrite || !storage) return false;
    const changed = reconcile();
    if (!canWrite) return false;
    lastWrite = opts.now();
    const text = serializeJournalCapped(journal, defs, opts.maxChars ?? JOURNAL_MAX_CHARS);
    if (text === null) { refused++; dirty = true; setState('failing'); return false; }   // memory and the stored blob keep everything
    writes++;
    let ok = false;
    try { storage.setItem(JOURNAL_KEY, text); ok = storage.getItem(JOURNAL_KEY) === text; } catch { ok = false; }
    if (ok) { lastText = text; dirty = false; setState('ok'); } else { dirty = true; setState('failing'); }
    if (changed && opts.onExternal) try { opts.onExternal(); } catch { /* ignore */ }
    return ok;
  };
  const schedule = (): void => {
    dirty = true;
    if (!canWrite || timer !== null) return;
    const wait = Math.max(0, lastWrite + throttle - opts.now());
    if (wait === 0) { write(false); return; }
    timer = setTimer(() => { timer = null; write(false); }, wait);
  };
  const sync = (): boolean => {
    if (!storage || readRaw() === lastText || loaded.status === 'newer' || loaded.status === 'unavailable') return false;
    const changed = reconcile();
    if (changed && opts.onExternal) try { opts.onExternal(); } catch { /* ignore */ }
    if (dirty && canWrite) schedule();
    return changed;
  };
  let unsubscribe: (() => void) | null = null;
  if (opts.subscribe) {
    try { unsubscribe = opts.subscribe((key) => { if (key === null || key === JOURNAL_KEY) sync(); }); } catch { unsubscribe = null; }
  }
  return {
    get journal() { return journal; },
    status: loaded.status,
    report: () => ({ load: loaded.status, save: saveState, parked: loaded.parked, conflicts }),
    markDirty() { if (timer !== null) { dirty = true; return; } schedule(); },
    flush() { write(false); },
    writeNow: () => write(true),
    sync,
    dispose() {
      write(false);
      if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
    },
    get writes() { return writes; },
    get refused() { return refused; },
  };
}

/* ═══════════════════════════════════════ the runtime: what the life chunk attaches ═══════════════════════════════════════ */

export interface JournalDeps {
  storage: StorageLike | null;
  subscribe?: StorageSubscribe;
  throttleMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** Compile the rules against another shipped set (probes: an S1, S2 or S3 build). Default: this build's PLACE_INFO. */
  defs?: QuestDefs;
}
export interface JournalRuntime extends JournalImpl {
  readonly store: JournalStore;
  readonly defs: QuestDefs;
  /** Sign-out (null) or an account switch: real-ledger entries leave (M25, CO-10). */
  accountChanged(acctTag: string | null): void;
}

/**
 * Attach the Journal to a collection (the life chunk calls this once, after the first frame of play). Returns null when the collection has no
 * journal hooks. Runs, in order: the shelf reconcile (warmth across merges, ids by ledger), the backfill (once), places that shipped since the
 * last load, and every pending gift (QUESTS 11 "On load": on the shelf or named as a blend parent = granted; otherwise steps 2 and 3 again).
 */
export function attachJournal(collection: Collection, deps: JournalDeps): JournalRuntime | null {
  if (!collection.attachJournal) return null;
  const defs = deps.defs ?? journalDefs();
  const out = createQuestOut(64);
  let store: JournalStore | null = null;
  let port: HoardGiftPort | null = null;
  const st = () => store!.journal.st;
  const today = (): number => Math.floor(port!.now() / DAY);
  const emitOut = (): void => {
    const p = port!;
    for (let k = 0; k < out.n; k++) {
      const a = out.a[k], b = out.b[k];
      switch (out.kind[k]) {
        case QOUT.QUEST: p.emit({ type: 'quest', quest: a, chapter: b, byPlayer: out.by[k] === BY.PLAYER }); break;
        case QOUT.FACT: p.emit({ type: 'fact', species: a, fact: b }); break;
        case QOUT.KEEPSAKE: p.emit({ type: 'keepsake', bit: a }); break;
        case QOUT.FRIEND: p.emit({ type: 'friend', a, b, level: out.by[k] }); break;
        case QOUT.UNLOCK: p.emit({ type: 'unlock', place: a === UNLOCK_FRIENDS ? UNLOCK_FRIENDS : a }); break;
        case QOUT.GIFT: p.emit({ type: 'gift', chapter: a, state: 'ready' }); break;
        default: break;
      }
    }
    out.n = 0;
  };
  const finishGift = (ch: number, spIdx: number, itemId: string): void => {
    const s = st();
    setGiftState(s, ch, 2, spIdx, s.giftDay[ch] >= 0 ? s.giftDay[ch] : today());
    applyEventFields(s, defs, out, EV.GIFT, 0, s.sc[SC.CURP], -1, spIdx, 255, 255, 0, BY.PLAYER, 0, 0);   // F0: "You met ..."
    store!.writeNow();
    emitOut();
    port!.emit({ type: 'gift', chapter: ch, state: 'granted', itemId });
  };
  /** Is the chapter's gift id on the shelf, or named as a parent of a blend row (QUESTS 11's load check)? */
  const giftOnShelf = (ch: number): boolean => {
    const id = giftItemId(port!.deviceId(), ch);
    for (const it of port!.items()) if (it.id === id || (it.parents && it.parents.includes(id))) return true;
    return false;
  };
  /** Steps 2 and 3 for a pending gift (a claim, or a load). A gift already on the shelf or merged into a blend is granted without a new row. */
  const resume = (ch: number): GiftClaimResult => {
    const s = st();
    const sp = s.giftSp[ch];
    const def = getSpecies(SPECIES[sp]);
    if (!def) return { ok: false, ledger: 'practice', error: 'not_offered', message: GIFT_COPY.wait };
    if (giftOnShelf(ch) && !port!.item(giftItemId(port!.deviceId(), ch))) {
      // merged away since step 2: granted, nothing added (a second row here would be a second gift)
      setGiftState(s, ch, 2, sp, s.giftDay[ch]);
      store!.writeNow();
      port!.emit({ type: 'gift', chapter: ch, state: 'granted' });
      return { ok: false, ledger: 'practice', error: 'not_ready', message: GIFT_COPY.wait };
    }
    const r = port!.grantGift(ch, def.id);
    if (!r.ok) { r.message = giftErrorCopy(r.error); return r; }
    finishGift(ch, def.idx, r.item_id);
    return r;
  };
  const impl: JournalImpl = {
    view(): JournalView { return journalView(store!.journal, defs, store!.report(), !port || port.ledger() === 'practice'); },
    feedPlay(ring: PlayEventRing, _nowMs: number): void {
      if (!store || ring.n <= 0) return;
      const s = st();
      setQuestDay(s, today());
      const n = ring.n < ring.kind.length ? ring.n : ring.kind.length;
      for (let i = 0; i < n; i++) applyPlayEvent(s, ring, i, defs, out);
      if (out.n > 0) emitOut();
      store.markDirty();
    },
    claimGift(chapter: number, pick: SpeciesId): Promise<GiftClaimResult> {
      const fail = (error: 'not_offered' | 'not_ready' | 'one_a_day' | 'signed_in' | 'unavailable'): Promise<GiftClaimResult> =>
        Promise.resolve({ ok: false, ledger: port ? port.ledger() : 'practice', error, message: giftErrorCopy(error) });
      if (!store || !port) return fail('unavailable');
      if (port.ledger() !== 'practice') return fail('signed_in');               // CO-09, M3: no gift on a signed-in ledger before T8
      if (!Number.isInteger(chapter) || chapter < 0 || chapter >= CHAPTERS.length || !giftListHas(chapter, pick)) return fail('not_offered');
      store.sync();   // another tab's claim first: its day and its gift rows count here (one a UTC day across tabs)
      const s = st();
      const def = getSpecies(pick)!;
      if (s.giftState[chapter] === 2) return fail('not_ready');
      if (s.giftState[chapter] === 1) {
        if (s.giftSp[chapter] !== def.idx) return fail('not_offered');         // the pick was fixed at step 1
        return Promise.resolve(resume(chapter));
      }
      if (!giftReady(s, chapter)) return fail('not_ready');
      const day = today();
      if (s.sc[SC.GDAY] === day) return fail('one_a_day');
      // step 1: pending with the pick, unthrottled
      setGiftState(s, chapter, 1, def.idx, day);
      store.writeNow();
      port.emit({ type: 'gift', chapter, state: 'pending' });
      // steps 2 (verified) and 3
      return Promise.resolve(resume(chapter));
    },
    warmthOf(itemId: string): number { return store ? warmthOfId(store.journal, itemId) : 0; },
    setParty(itemIds: readonly string[]): void {
      if (!store || !port) return;
      const p = port;
      setJournalParty(store.journal, itemIds, (id) => { const it = p.item(id); return it ? it.speciesIdx : -1; });
      store.markDirty();
    },
    friendMask(sp: number, o: Uint32Array): boolean { if (!store) { o[0] = o[1] = 0; return false; } return friendMaskOf(store.journal.st, defs, sp, o); },
    flush(): void { if (store) store.flush(); },
    dispose(): void { if (store) store.dispose(); },
  };
  port = collection.attachJournal(impl);
  const p = port;
  store = createJournalStore(deps.storage, {
    defs, deviceId: p.deviceId(), now: p.now, throttleMs: deps.throttleMs, setTimer: deps.setTimer, clearTimer: deps.clearTimer, subscribe: deps.subscribe,
  });
  // load-time work (its stamps land quietly: no quest moments for what the shelf already shows)
  const j = store.journal;
  setQuestDay(j.st, today());
  reconcileJournalShelf(j, p.items());
  backfillJournal(j, defs, p.items(), p.opened(), out);
  openPlacesByStamps(j.st, defs, out);
  out.n = 0;
  for (let ch = 0; ch < CHAPTERS.length; ch++) {
    if (j.st.giftState[ch] !== 1) continue;
    if (giftOnShelf(ch)) { setGiftState(j.st, ch, 2, j.st.giftSp[ch], j.st.giftDay[ch]); continue; }
    if (p.ledger() === 'practice') resume(ch);
  }
  store.markDirty();
  const rt: JournalRuntime = {
    ...impl, store, defs,
    accountChanged(acctTag: string | null): void { forgetJournalAccount(store!.journal, acctTag); store!.markDirty(); },
  };
  return rt;
}
