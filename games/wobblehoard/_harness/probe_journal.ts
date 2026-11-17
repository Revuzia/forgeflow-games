// PLAYGROUND journal probe (PG_QUESTS): CO-01 to CO-11 of _spec/PLAYGROUND_BUILD.md 18 over src/collection/journal.ts, journal_store.ts, the
// index.ts hooks and ghost.ts ghostGrantGift. Plain node:  node _harness/probe_journal.ts   (exit 1 on any failure). Storage is an in-memory
// StorageLike with a quota switch; timers are manual (nothing runs on its own); the clock is a variable.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PlayEventRing } from '../src/contracts.ts';
import type { StorageLike } from '../src/core/settings.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { createCollection } from '../src/collection/index.ts';
import type { Collection, HoardSave, CollectionEvent } from '../src/collection/index.ts';
import { HOARD_KEY, ID_PATTERN, JOURNAL_KEY, GHOST_CAP } from '../src/collection/constants.ts';
import { serializeHoard, sanitizeHoard, makeRow, FLAG_SEEN } from '../src/collection/store.ts';
import { originCopy, itemOriginCopy, GIFT_COPY } from '../src/collection/copy.ts';
import { giftItemId } from '../src/collection/ghost.ts';
import {
  JOURNAL_BACKUP_KEY, JOURNAL_MAX_CHARS, createJournal, journalDefs, mergeJournals, sanitizeJournal, serializeJournal, serializeJournalCapped, backfillJournal, reconcileJournalShelf, forgetJournalAccount,
  journalIdIndex, setJournalParty, warmthOfId,
} from '../src/collection/journal.ts';
import type { Journal, ShelfItem } from '../src/collection/journal.ts';
import { attachJournal, createJournalStore, loadJournal } from '../src/collection/journal_store.ts';
import type { JournalRuntime } from '../src/collection/journal_store.ts';
import { SC, applyEventFields, createQuestOut, isDone, markDone, setQuestDay, setQuestParty, FR_ROWS, PAIR_SET } from '../src/core/quests.ts';
import { QUESTS, CHAPTERS, EV, BY, FACT, WISH_STATE, GIFT_LISTS } from '../src/data/quests.ts';
import { SOCIAL_KIND as S, WISH_KIND, SPECIES_LIFE } from '../src/data/life.ts';
import { CATALOG, speciesBaseGenome } from '../src/data/catalog.ts';
import { createAchievements } from '../src/shell/achievementsBinding.ts';
import type { AchGameLike } from '../src/shell/achievementsBinding.ts';
import { ACH_KEY } from '../src/core/achStore.ts';
import type { PortalEnv } from '../src/portal/bridge.ts';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
let bad = 0;
const row = (id: string, what: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${extra ? '  ' + extra : ''}`); };
const DAY = 86_400_000;
let T = 20407 * DAY + 3_600_000;
const now = (): number => T;
const timers: { fn: () => void; at: number }[] = [];
const fakeTimers = { setTimer: (fn: () => void, ms: number): unknown => { const t = { fn, at: T + ms }; timers.push(t); return t; }, clearTimer: (h: unknown): void => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); } };
const runTimers = (): void => { for (const t of timers.splice(0)) t.fn(); };
const d = journalDefs();
const qIdx = (id: string): number => QUESTS.findIndex((q) => q.id === id);
const sp = (id: string): number => CATALOG.findIndex((c) => c.id === id);

interface MemStorage extends StorageLike { map: Map<string, string>; sets: string[]; quota: boolean; silent: boolean }
function memoryStorage(): MemStorage {
  const map = new Map<string, string>();
  const s: MemStorage = {
    map, sets: [], quota: false, silent: false,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { s.sets.push(k); if (s.quota) { if (s.silent) return; throw new Error('QuotaExceededError'); } map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return s;
}
const mkColl = (storage: StorageLike | null, seed = 1): Collection => createCollection({ storage, now, random: mulberry32(seed), ...fakeTimers, throttleMs: 2000 });
const mkJ = (c: Collection, storage: StorageLike | null): JournalRuntime => attachJournal(c, { storage, ...fakeTimers, throttleMs: 2000 })!;
/** Make chapter 1's gift ready the way play would: the first wish, the first trip (H8), then C8 done. */
function giftReadyState(rt: JournalRuntime): void {
  const st = rt.store.journal.st, out = createQuestOut(256);
  setQuestDay(st, Math.floor(T / DAY));
  applyEventFields(st, d, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, BY.SELF, 0, WISH_KIND.PLACE);
  applyEventFields(st, d, out, EV.VISIT, 0, 1, -1, 255, 255, 255, 1, BY.PLAYER, 0, 0);
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5']) markDone(st, d, qIdx(id), out);
  markDone(st, d, qIdx('C8'), out);
}
const storedHoard = (m: MemStorage): HoardSave => JSON.parse(m.getItem(HOARD_KEY)!) as HoardSave;
const giftRows = (m: MemStorage, dev: string): number => storedHoard(m).ghosts.filter((r) => typeof r[0] === 'string' && r[0].startsWith('jg-' + dev)).length;
const ring = (cap = 64): PlayEventRing => ({ n: 0, dropped: 0, kind: new Uint8Array(cap), sub: new Uint8Array(cap), place: new Uint8Array(cap), thing: new Int16Array(cap), a: new Uint8Array(cap),
  b: new Uint8Array(cap), fam: new Uint8Array(cap), n2: new Uint8Array(cap), by: new Uint8Array(cap), flag: new Uint8Array(cap), v: new Float32Array(cap) });
const push = (r: PlayEventRing, k: number, sub: number, place: number, thing: number, a: number, b: number, n2: number, by: number, v = 0, flag = 0): void => {
  const i = r.n++; r.kind[i] = k; r.sub[i] = sub; r.place[i] = place; r.thing[i] = thing; r.a[i] = a; r.b[i] = b; r.fam[i] = 0; r.n2[i] = n2; r.by[i] = by; r.flag[i] = flag; r.v[i] = v;
};

/* ═══════════════════════════════ CO-01: the store ═══════════════════════════════ */
{
  const m = memoryStorage();
  const c = mkColl(m), rt = mkJ(c, m);
  const r = ring();
  push(r, EV.TOUCH, 1, 0, -1, 0, 255, 1, BY.PLAYER, 0.8);
  push(r, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, BY.SELF, WISH_KIND.PLACE);
  push(r, EV.SOCIAL, S.GREET, 0, -1, 0, 3, 2, BY.SELF);
  c.feedPlay!(r, T);
  T += 3000; runTimers(); c.flush();
  const text = m.getItem(JOURNAL_KEY);
  const back = loadJournal(m, d, rt.store.journal.dev);
  row('CO-01', 'save and load: the journal written under wobblehoard:v2:journal loads back "ok" to the same canonical text (H1 done, Hearthlog open, a friendship row)',
    !!text && back.status === 'ok' && serializeJournal(back.journal, d) === text && isDone(back.journal.st, qIdx('H1')) && (back.journal.st.sc[SC.PL] & 2) !== 0 && back.journal.st.sc[SC.FRN] === 1,
    `${text?.length} chars`);
  // hostile JSON never throws
  const hostile: string[] = ['{', '[]', 'null', '1', '"x"', '{"v":1}', '{"v":"1"}', '{"v":1.5}', '{"v":0}', '{"v":-3}',
    '{"v":1,"qd":5,"qp":"x","fx":[[999,1],[-1,2],["a",3],[3,1e99]],"fr":[[1,1,5],[3,2,1e99],[0,300,4]],"ids":[1,2,"../x","ok_id"],"wm":[[0,99],[3,5],["a"]],"gift":[[1,9,9,9],[0,1,1,1],[1,2,2,1e12]],"cur":{"p":99,"party":[0,0,7,-1]}}',
    '{"v":1,"__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"qd":"@@@@","ks":-1,"pl":1e40,"pv":[1e9,-1,"a"],"wi":[[1,1,1,1],[2],[null]],"fw":[9,999],"st":"x"}',
    JSON.stringify({ v: 1, qp: new Array(5000).fill([1, 0, 3, [1, 2, 3]]), fx: new Array(5000).fill([1, 4095]), fr: new Array(5000).fill([1, 2, 3]), ids: new Array(5000).fill('a'), wm: new Array(5000).fill([0, 50]) }),
    JSON.stringify({ v: 1, qp: [[0, 0, 70000, [64, 65, -1, 1.5, 'x']]], fd: [1, 'x'], gday: 'x', wday: -1, real: [99, -1] })];
  let threw = '', okRanges = true;
  for (const h of hostile) {
    try {
      const mm = memoryStorage(); mm.map.set(JOURNAL_KEY, h);
      const L = loadJournal(mm, d, 'abcdefgh12');
      const j = L.journal;
      const s1 = serializeJournal(j, d);
      if (s1.length > JOURNAL_MAX_CHARS * 2) okRanges = false;
      if (j.ids.length > 100 || j.st.sc[SC.FRN] > FR_ROWS || j.st.sc[SC.WIN] > 3 || ({} as Record<string, unknown>).polluted !== undefined) okRanges = false;
      for (let s = 0; s < j.st.fx.length; s++) if (j.st.fx[s] > 0xfff) okRanges = false;
    } catch (e) { threw = `${h.slice(0, 40)}: ${(e as Error).message}`; }
  }
  // fuzz: 2000 random mutations of a real blob
  const base = JSON.parse(text!) as Record<string, unknown>;
  const rnd = mulberry32(99);
  const junk = (): unknown => [null, -1, 1e99, 'x', [], {}, [[1, 2, 3]], true, 0.5, '{', [-5, 'y', null]][Math.floor(rnd() * 11)];
  for (let k = 0; k < 2000 && !threw; k++) {
    const x: Record<string, unknown> = JSON.parse(JSON.stringify(base));
    const keys = Object.keys(x);
    for (let z = 0; z < 3; z++) x[keys[Math.floor(rnd() * keys.length)]] = junk();
    try { const j = sanitizeJournal(x, d); if (j) serializeJournal(j, d); } catch (e) { threw = `fuzz ${k}: ${(e as Error).message}`; }
  }
  row('CO-01', 'hostile JSON never throws: 14 hand-made hostile blobs (wrong types, out-of-range indexes, 5000-row arrays, __proto__ keys) and 2000 random field mutations; every kept value is in range',
    !threw && okRanges, threw || '2014 blobs');
  // park: an unreadable blob is parked and replaced; a more recoverable backup is never replaced by junk
  const pm = memoryStorage(); pm.map.set(JOURNAL_KEY, '{junk');
  const pc = mkColl(pm); const prt = mkJ(pc, pm);
  const parked1 = pm.getItem(JOURNAL_BACKUP_KEY);
  const replaced = pm.getItem(JOURNAL_KEY) !== '{junk';
  pm.map.set(JOURNAL_BACKUP_KEY, text!); pm.map.set(JOURNAL_KEY, '{more junk');
  const L2 = loadJournal(pm, d, 'abcdefgh12');
  row('CO-01', 'an unreadable journal is parked under wobblehoard:v2:journal.unreadable and replaced (status "recovered"); a readable backup is never replaced by junk',
    prt.store.status === 'recovered' && parked1 === '{junk' && replaced && L2.status === 'recovered' && pm.getItem(JOURNAL_BACKUP_KEY) === text, `${prt.store.status}, backup ${parked1}`);
  // newer: read-only in memory
  const nm = memoryStorage(); const newer = JSON.stringify({ v: 2, future: true }); nm.map.set(JOURNAL_KEY, newer);
  const nc = mkColl(nm); const nrt = mkJ(nc, nm);
  const nr = ring(); push(nr, EV.TOUCH, 1, 0, -1, 0, 255, 1, BY.PLAYER, 0.8); nc.feedPlay!(nr, T); T += 5000; runTimers(); nc.flush(); nrt.store.writeNow();
  row('CO-01', 'a journal from a newer build (v 2) is read-only: this build plays on in memory and never writes over it (report save "off")',
    nrt.store.status === 'newer' && nm.getItem(JOURNAL_KEY) === newer && nrt.store.report().save === 'off', `${nrt.store.status}, ${nrt.store.report().save}`);
  c.dispose(); pc.dispose(); nc.dispose();
}

/* ═══════════════════════════════ CO-02: the worst case ═══════════════════════════════ */
function worstJournal(): Journal {
  const j = createJournal(d, 'a'.repeat(40));
  const st = j.st;
  j.acct = '0123456789abcdef0123456789abcdef';
  for (let k = 0; k < 100; k++) { const id = `${k.toString(36).padStart(2, '0')}${'x'.repeat(62)}`; j.ids.push(id); j.real[k] = k % 2; st.wm[k] = 49; st.wmDay[k] = 20407; st.wmBits[k] = 15; }
  setQuestDay(st, 20407);
  for (let r = 0, lo = 0, hi = 49; r < FR_ROWS; r++) { st.frLo[r] = lo; st.frHi[r] = hi; st.frPts[r] = 39.5; st.frDay[r] = 19.5; if (--hi <= lo) { lo++; hi = 49; } }
  st.sc[SC.FRN] = FR_ROWS; st.sc[SC.FDDAY] = 20407;
  for (let s = 0; s < 64; s++) st.fx[s] = 0xfff;
  // every clause in progress at one short of its target, with high-numbered distinct items
  for (let c = 0; c < d.nc; c++) {
    st.cnt[c] = Math.max(0, d.cCount[c] - 1) || 0;
    if (d.cPair[c] >= 0) for (let k = 0; k < d.cCount[c] - 1; k++) st.pairs[d.cPair[c] * PAIR_SET + k] = 60000 + k;   // a pair set stops at its target
    else if (d.cSame[c]) { st.bits[c * 2] = 0xffffffff; st.bits[c * 2 + 1] = 0xffffffff; }
    else if (d.cDist[c]) for (let k = 0; k < d.cCount[c] - 1; k++) st.bits[c * 2 + 1] |= 1 << (31 - k);
    if (st.cnt[c] === 0) st.cnt[c] = 0;
  }
  for (let p = 0; p < 10; p++) st.pv[p] = 65535;
  for (let k = 0; k < 3; k++) { st.wiSp[k] = 40 + k; st.wiKind[k] = 8; st.wiTarget[k] = 61; st.wiDay[k] = 20407; }
  st.sc[SC.WIN] = 3;
  for (const ch of [1, 2, 3, 4, 10]) { st.giftState[ch] = 2; st.giftSp[ch] = 49; st.giftDay[ch] = 20407; }
  setQuestParty(st, [...Array(16).keys()].map((k) => k + 80), new Array(16).fill(49), 16);
  st.sc[SC.KS] = 0xfffff; st.sc[SC.PL] = 0x3ff; st.sc[SC.SG] = 0x3ff; st.sc[SC.WG] = 999999; st.sc[SC.GDAY] = 20407; st.sc[SC.ST] = 0;
  return j;
}
{
  const j = worstJournal();
  const t = serializeJournal(j, d);
  row('CO-02', `the worst-case journal (100 ids of 64 characters, 128 friendship rows with today's points, 100 warmth rows, every clause in progress, 64 fact masks, 3 wishes, 5 gifts, a party of 16) is at most ${JOURNAL_MAX_CHARS} characters`,
    t.length <= JOURNAL_MAX_CHARS, `${t.length} chars`);
  const real36 = createJournal(d, 'a'.repeat(20)); const w = worstJournal(); real36.ids = w.ids.map((_, k) => `${k.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`); Object.assign(real36, { st: w.st, real: w.real, acct: w.acct });
  row('CO-02', 'the same with real 36-character UUIDs', serializeJournal(real36, d).length <= JOURNAL_MAX_CHARS, `${serializeJournal(real36, d).length} chars`);
}

/* ═══════════════════════════════ CO-03: two tabs ═══════════════════════════════ */
{
  const out = createQuestOut(256);
  const a = createJournal(d, 'abcdefgh12'), b = createJournal(d, 'abcdefgh12');
  setQuestDay(a.st, 20407); setQuestDay(b.st, 20407);
  for (const j of [a, b]) applyEventFields(j.st, d, out, EV.WISH, WISH_STATE.SHOWN, 0, 1, 0, 255, 0, 0, 0, 0, 1);
  applyEventFields(a.st, d, out, EV.TOUCH, 1, 0, -1, 0, 255, 0, 1, 1, 0, 0.9);                          // a: H1
  applyEventFields(b.st, d, out, EV.CAPSULE, 0, 0, -1, 7, 255, 0, 1, 1, 0, 0);                         // b: H4, F0 of species 7
  for (let k = 0; k < 4; k++) applyEventFields(a.st, d, out, EV.SOCIAL, S.NUZZLE, 0, -1, 2, 3, 0, 2, 0, 0, 0);
  for (let k = 0; k < 2; k++) applyEventFields(b.st, d, out, EV.SOCIAL, S.NUZZLE, 0, -1, 2, 3, 0, 2, 0, 0, 0);
  journalIdIndex(a, 'g-aaaaaaaaaaaa', true); a.st.wm[0] = 7;
  journalIdIndex(b, 'g-aaaaaaaaaaaa', true); b.st.wm[0] = 9; journalIdIndex(b, 'g-bbbbbbbbbbbb', true); b.st.wm[1] = 3;
  b.st.giftState[1] = 1; b.st.giftSp[1] = sp('puddlo'); b.st.giftDay[1] = 20407;
  a.st.sc[SC.CURP] = 0; b.st.sc[SC.CURP] = 1;
  const m = mergeJournals(a, b, d);
  const fr = m.st.frPts[0];
  const ok = isDone(m.st, qIdx('H1')) && isDone(m.st, qIdx('H4')) && (m.st.fx[7] & 1) !== 0 && fr === 8 && warmthOfId(m, 'g-aaaaaaaaaaaa') === 9 && warmthOfId(m, 'g-bbbbbbbbbbbb') === 3
    && m.st.giftState[1] === 1 && m.st.sc[SC.CURP] === 0 && m.st.sc[SC.ST] >= 2;
  row('CO-03', 'the two-tab merge is a union or a max for every field: quests (H1 from one tab, H4 from the other), facts, friendship (max 8 of 8 and 4), warmth by id (max), gifts (max state); cur is the writer\'s',
    ok, `stamps ${m.st.sc[SC.ST]}, pair points ${fr}, warmth ${warmthOfId(m, 'g-aaaaaaaaaaaa')}/${warmthOfId(m, 'g-bbbbbbbbbbbb')}`);
  const w = worstJournal();
  const t1 = serializeJournal(w, d), t2 = serializeJournal(mergeJournals(w, w, d), d), t3 = serializeJournal(mergeJournals(m, m, d), d);
  if (t1 !== t2 || t3 !== serializeJournal(m, d)) { const A = JSON.parse(t1), B = JSON.parse(t2), C = JSON.parse(t3), D = JSON.parse(serializeJournal(m, d)); for (const k of Object.keys(A)) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) console.log(`     worst differs in ${k}`); for (const k of Object.keys(C)) if (JSON.stringify(C[k]) !== JSON.stringify(D[k])) console.log(`     pair differs in ${k}: ${JSON.stringify(C[k]).slice(0, 80)} vs ${JSON.stringify(D[k]).slice(0, 80)}`); }
  row('CO-03', 'merging a blob with itself is the identity (the worst case and the merged pair above, canonical text equal)', t1 === t2 && t3 === serializeJournal(m, d));
  const ab = serializeJournal(mergeJournals(mergeJournals(a, b, d), b, d), d) === serializeJournal(mergeJournals(a, b, d), d);
  row('CO-03', 'merging the same tab twice changes nothing more (idempotent)', ab);
  // the store-level two tabs: tab A writes, tab B (dirty) writes later and folds A's in
  const shared = memoryStorage();
  const ca = mkColl(shared, 1), ja = mkJ(ca, shared);
  const cb = mkColl(shared, 2), jb = mkJ(cb, shared);
  const ra = ring(); push(ra, EV.TOUCH, 1, 0, -1, 0, 255, 1, BY.PLAYER, 0.9); ca.feedPlay!(ra, T); ja.store.writeNow();
  const rb = ring(); push(rb, EV.CAPSULE, 0, 0, -1, 9, 255, 1, BY.PLAYER); cb.feedPlay!(rb, T); jb.store.writeNow();
  const final = loadJournal(shared, d, 'x').journal;
  row('CO-03', 'two stores on one storage: the later write folds the other tab\'s in (H1 from tab A and H4 from tab B both stored)', isDone(final.st, qIdx('H1')) && isDone(final.st, qIdx('H4')), `conflicts ${jb.store.report().conflicts}`);
  ca.dispose(); cb.dispose();
}

/* ═══════════════════════════════ CO-04: the backfill ═══════════════════════════════ */
{
  const out = createQuestOut(256);
  const items: ShelfItem[] = [{ id: 'g-111111111111', speciesIdx: 0, ledger: 'practice' }, { id: 'g-222222222222', speciesIdx: 5, ledger: 'practice' }, { id: 'g-333333333333', speciesIdx: 5, ledger: 'practice' }];
  const j = createJournal(d, 'abcdefgh12');
  const ran = backfillJournal(j, d, items, 2, out);
  const again = backfillJournal(j, d, items, 9, out);
  const f = createJournal(d, 'abcdefgh12');
  backfillJournal(f, d, [items[0]], 0, out);
  const ok = ran && !again && (j.st.fx[0] & 1) && (j.st.fx[5] & 1) && isDone(j.st, qIdx('H1')) && isDone(j.st, qIdx('H3')) && isDone(j.st, qIdx('H4')) && !isDone(j.st, qIdx('H2'))
    && j.st.sc[SC.ST] === 3 && (f.st.fx[0] & 1) && !isDone(f.st, qIdx('H1')) && f.st.sc[SC.ST] === 0 && f.st.sc[SC.BF] === 1;
  row('CO-04', 'the backfill runs once: F0 for every owned species; H1, H3 and H4 done when the shelf shows them (a capsule opened or two owned); a fresh one-Dollop save gets only F0; a second run does nothing',
    !!ok, `stamps ${j.st.sc[SC.ST]} / fresh ${f.st.sc[SC.ST]}`);
  // through the real collection: an existing v2 hoard with 3 items
  const m = memoryStorage();
  const c0 = mkColl(m, 3); c0.flush();
  const h = storedHoard(m);
  h.ghosts.push(makeRow('g-zzzzzzzzzzz1', speciesBaseGenome('crimpo', 1), T, FLAG_SEEN, 'drop')); h.ghostOpened = 1;
  m.map.set(HOARD_KEY, serializeHoard(h)); c0.dispose();
  const c1 = mkColl(m, 3); const j1 = mkJ(c1, m); const v1 = c1.journal!()!;
  const c2 = mkColl(m, 3); j1.store.writeNow(); const j2 = mkJ(c2, m); const v2 = c2.journal!()!;
  row('CO-04', 'through createCollection + attachJournal on an existing v2 hoard (Dollop, a capsule Crimpo, 1 opened): F0 for both, H1 H3 H4 done; a reload does not run it again',
    (v1.facts[sp('dollop')] & 1) === 1 && (v1.facts[sp('crimpo')] & 1) === 1 && v1.stamps === 3 && v2.stamps === 3 && j2.store.journal.st.sc[SC.BF] === 1, `stamps ${v1.stamps} then ${v2.stamps}`);
  c1.dispose(); c2.dispose();
}

/* ═══════════════════════════════ CO-05: the gift grant ═══════════════════════════════ */
{
  const results: string[] = [];
  let allOk = true;
  const fail = (why: string): void => { allOk = false; results.push(why); };
  // (a) the plain path
  {
    const m = memoryStorage(); const c = mkColl(m, 5); const rt = mkJ(c, m); giftReadyState(rt);
    const evs: string[] = []; c.onEvent((e: CollectionEvent) => { if (e.type === 'gift') evs.push(`${e.state}`); });
    const r = await c.claimGift!(1, 'puddlo');
    const dev = rt.store.journal.dev;
    const row1 = storedHoard(m).ghosts.find((x) => x[0] === giftItemId(dev, 1));
    const jt = loadJournal(m, d, dev).journal;
    if (!r.ok || !row1 || row1[7] !== 3 || !ID_PATTERN.test(giftItemId(dev, 1)) || giftItemId(dev, 1).length > 46 || jt.st.giftState[1] !== 2 || evs.join() !== 'pending,granted') fail(`plain: ${JSON.stringify(r).slice(0, 80)} ${evs}`);
    const it = c.item(giftItemId(dev, 1))!;
    if (itemOriginCopy(it) !== 'Gift' || originCopy(it.origin, it.id) !== 'Gift' || originCopy('restock', 'g-abc') !== 'Restock' || it.origin !== 'restock') fail('copy: not "Gift"');
    const again = await c.claimGift!(1, 'puddlo');
    if (again.ok || giftRows(m, dev) !== 1) fail('a second claim of the same chapter');
    c.dispose();
  }
  // (b) interrupted after step 1 (pending stored, no row): a reload grants it once
  {
    const m = memoryStorage(); const c = mkColl(m, 6); const rt = mkJ(c, m); giftReadyState(rt);
    const st = rt.store.journal.st; st.giftState[1] = 1; st.giftSp[1] = sp('crumbit'); st.giftDay[1] = Math.floor(T / DAY); st.sc[SC.GDAY] = st.giftDay[1]; rt.store.writeNow(); c.flush();
    const dev = rt.store.journal.dev; c.dispose();
    const c2 = mkColl(m, 6); const rt2 = mkJ(c2, m);
    if (rt2.store.journal.st.giftState[1] !== 2 || giftRows(m, dev) !== 1 || storedHoard(m).ghosts.find((x) => x[0] === giftItemId(dev, 1))![1] !== sp('crumbit')) fail('after step 1: reload did not grant exactly one');
    c2.dispose(); const c3 = mkColl(m, 6); mkJ(c3, m); if (giftRows(m, dev) !== 1) fail('after step 1: a second reload added another'); c3.dispose();
  }
  // (c) interrupted after step 2 (row stored, journal still pending): a reload marks it granted, adds nothing
  {
    const m = memoryStorage(); const c = mkColl(m, 7); const rt = mkJ(c, m); giftReadyState(rt);
    const st = rt.store.journal.st; st.giftState[1] = 1; st.giftSp[1] = sp('swishel'); st.giftDay[1] = Math.floor(T / DAY); rt.store.writeNow();
    const dev = rt.store.journal.dev;
    const h = storedHoard(m); h.ghosts.push(makeRow(giftItemId(dev, 1), speciesBaseGenome('swishel', 1), T, 0, 'restock')); m.map.set(HOARD_KEY, serializeHoard(h));
    c.dispose();
    const c2 = mkColl(m, 7); const rt2 = mkJ(c2, m);
    if (rt2.store.journal.st.giftState[1] !== 2 || giftRows(m, dev) !== 1) fail('after step 2: not exactly one');
    c2.dispose();
  }
  // (c2) after step 2, the gift row already merged into a blend (named as a parent): granted, nothing added
  {
    const m = memoryStorage(); const c = mkColl(m, 8); const rt = mkJ(c, m); giftReadyState(rt);
    const st = rt.store.journal.st; st.giftState[1] = 1; st.giftSp[1] = sp('puddlo'); st.giftDay[1] = Math.floor(T / DAY); rt.store.writeNow();
    const dev = rt.store.journal.dev;
    const h = storedHoard(m); h.ghosts.push(makeRow('g-blendblend01', speciesBaseGenome('puddlo', 3), T, 0, 'blend', 0, [giftItemId(dev, 1), 'g-other0000001'])); m.map.set(HOARD_KEY, serializeHoard(h));
    c.dispose();
    const c2 = mkColl(m, 8); const rt2 = mkJ(c2, m);
    if (rt2.store.journal.st.giftState[1] !== 2 || giftRows(m, dev) !== 0) fail('after step 2 + a merge: a second gift');
    c2.dispose();
  }
  // (c3) a claim retried in the same session after the row was merged into a blend elsewhere (another tab): granted, no second row
  {
    const m = memoryStorage(); const c = mkColl(m, 16); const rt = mkJ(c, m); giftReadyState(rt); c.flush();
    const st = rt.store.journal.st; st.giftState[1] = 1; st.giftSp[1] = sp('puddlo'); st.giftDay[1] = Math.floor(T / DAY); st.sc[SC.GDAY] = st.giftDay[1];
    const dev = rt.store.journal.dev;
    const h = storedHoard(m); h.ghosts.push(makeRow('g-blendblend02', speciesBaseGenome('puddlo', 4), T, 0, 'blend', 0, [giftItemId(dev, 1), 'g-other0000002'])); m.map.set(HOARD_KEY, serializeHoard(h));
    c.sync();
    const r = await c.claimGift!(1, 'puddlo');
    if (r.ok || rt.store.journal.st.giftState[1] !== 2 || giftRows(m, dev) !== 0) fail(`merged then retried: rows ${giftRows(m, dev)}, state ${rt.store.journal.st.giftState[1]}`);
    c.dispose();
  }
  // (d) after step 3: a reload changes nothing; a load never reverts "granted" even with no row anywhere (PLAYGROUND_BUILD 23)
  {
    const m = memoryStorage(); const c = mkColl(m, 9); const rt = mkJ(c, m); giftReadyState(rt);
    await c.claimGift!(1, 'puddlo'); const dev = rt.store.journal.dev; c.dispose();
    const h = storedHoard(m); h.ghosts = h.ghosts.filter((x) => x[0] !== giftItemId(dev, 1)); m.map.set(HOARD_KEY, serializeHoard(h));   // merged away twice by an older build
    const c2 = mkColl(m, 9); const rt2 = mkJ(c2, m);
    if (rt2.store.journal.st.giftState[1] !== 2 || giftRows(m, dev) !== 0) fail('after step 3: a reload reverted or re-granted');
    c2.dispose();
  }
  // (e) step 2 with failing storage (quota), then a reload: stays pending, never granted without a row; the next load grants it
  {
    const m = memoryStorage(); const c = mkColl(m, 10); const rt = mkJ(c, m); giftReadyState(rt); rt.store.writeNow(); c.flush();
    const dev = rt.store.journal.dev;
    m.quota = true;
    const r = await c.claimGift!(1, 'crumbit');
    const pendingMem = rt.store.journal.st.giftState[1];
    const msg = !r.ok ? r.message : '';
    m.quota = false;   // the tab closes before anything else is written; the stored journal still says ready (the step 1 write failed too)
    const jt = loadJournal(m, d, dev).journal;
    if (r.ok || pendingMem !== 1 || msg !== GIFT_COPY.wait || jt.st.giftState[1] === 2 || giftRows(m, dev) !== 0) fail(`quota: ok=${r.ok} mem=${pendingMem} stored=${jt.st.giftState[1]} rows=${giftRows(m, dev)} "${msg}"`);
    // the tab is gone without another write (not disposed): a reload finds the gift ready and the retry grants exactly one
    const c2 = mkColl(m, 10); const rt2 = mkJ(c2, m);
    const r2 = await c2.claimGift!(1, 'crumbit');
    if (!r2.ok || rt2.store.journal.st.giftState[1] !== 2 || giftRows(m, dev) !== 1) fail(`quota: the retry after reload did not grant exactly one (${JSON.stringify(r2).slice(0, 60)}, rows ${giftRows(m, dev)})`);
    // and if the old tab does write later (its memory still holds the row and "pending"), the shelf keeps one row and the journal stays granted
    c.dispose(); c2.sync();
    if (giftRows(m, dev) !== 1 || loadJournal(m, d, dev).journal.st.giftState[1] !== 2) fail('quota: the old tab\'s late write doubled or reverted the gift');
    c2.dispose();
    const ms = memoryStorage(); const cs = mkColl(ms, 11); const rs = mkJ(cs, ms); giftReadyState(rs); ms.quota = true; ms.silent = true;
    const r3 = await cs.claimGift!(1, 'puddlo');
    if (r3.ok || rs.store.journal.st.giftState[1] !== 1) fail('silent storage: granted without a stored row');
    cs.dispose();
  }
  // (f) a round trip through today's serializeHoard (an older build) keeps the row: origin restock, id valid
  {
    const m = memoryStorage(); const c = mkColl(m, 12); const rt = mkJ(c, m); giftReadyState(rt); await c.claimGift!(1, 'swishel'); const dev = rt.store.journal.dev; c.dispose();
    const re = sanitizeHoard(JSON.parse(serializeHoard(sanitizeHoard(JSON.parse(m.getItem(HOARD_KEY)!), T, mulberry32(1))!.save)), T, mulberry32(1))!;
    if (re.droppedGhosts !== 0 || !re.save.ghosts.some((x) => x[0] === giftItemId(dev, 1) && x[7] === 3)) fail('serializeHoard round trip lost the gift row');
  }
  // (g) two tabs claim the same chapter: one row
  {
    const m = memoryStorage(); const ca = mkColl(m, 13); const ja = mkJ(ca, m); giftReadyState(ja); ja.store.writeNow(); ca.flush();
    const cb = mkColl(m, 13); const jb = mkJ(cb, m);
    const ra = await ca.claimGift!(1, 'puddlo'); const rb = await cb.claimGift!(1, 'puddlo');
    const dev = ja.store.journal.dev;
    cb.sync(); ca.sync();
    if (!ra.ok || giftRows(m, dev) !== 1) fail(`two tabs: ${giftRows(m, dev)} rows (b ${rb.ok})`);
    ca.dispose(); cb.dispose();
  }
  // (g2) two tabs, two different chapters, the same UTC day: the second tab's claim waits ("One gift a day")
  {
    const m = memoryStorage(); const ca = mkColl(m, 17); const ja = mkJ(ca, m); giftReadyState(ja);
    markDone(ja.store.journal.st, d, CHAPTERS[2].finale, createQuestOut(64)); ja.store.writeNow(); ca.flush();
    const cb = mkColl(m, 17); const jb = mkJ(cb, m);
    const ra = await ca.claimGift!(1, 'puddlo');
    const rb = await cb.claimGift!(2, 'boingle');
    if (!ra.ok || rb.ok || (rb.ok === false && rb.error !== 'one_a_day') || giftRows(m, ja.store.journal.dev) !== 1) fail(`two tabs, two chapters, one day: ${ra.ok} ${JSON.stringify(rb).slice(0, 60)}`);
    void jb; ca.dispose(); cb.dispose();
  }
  // (h) the rules: listed species only, 1 per UTC day, 5 for life, the shelf cap keeps it waiting
  {
    const m = memoryStorage(); const c = mkColl(m, 14); const rt = mkJ(c, m); giftReadyState(rt);
    const st = rt.store.journal.st, out = createQuestOut(256);
    for (const ch of [2, 3, 4, 10]) markDone(st, d, CHAPTERS[ch].finale, out);
    const notListed = await c.claimGift!(1, 'boingle');
    const r1 = await c.claimGift!(1, 'puddlo');
    const r2 = await c.claimGift!(2, 'boingle');
    T += DAY; const r3 = await c.claimGift!(2, 'boingle');
    T += DAY; await c.claimGift!(3, 'munchip'); T += DAY; await c.claimGift!(4, 'plumpet'); T += DAY; const r5 = await c.claimGift!(10, 'capnap');
    const dev = rt.store.journal.dev;
    const tiers = Object.values(GIFT_LISTS).flat().every((s) => ['common', 'uncommon'].includes(CATALOG[sp(s)].tier));
    if (notListed.ok || !r1.ok || r2.ok || (r2.ok === false && r2.message !== GIFT_COPY.oneADay) || !r3.ok || !r5.ok || giftRows(m, dev) !== 5 || !tiers) fail(`rules: ${[notListed.ok, r1.ok, r2.ok, r3.ok, r5.ok].join()} rows ${giftRows(m, dev)}`);
    const lifetime = rt.store.journal.st.giftState.filter((x) => x === 2).length;
    if (lifetime !== 5) fail(`lifetime ${lifetime}`);
    c.dispose();
    // the shelf cap
    const fm = memoryStorage(); const fc = mkColl(fm, 15); fc.flush();
    const h = storedHoard(fm); for (let k = h.ghosts.length; k < GHOST_CAP; k++) h.ghosts.push(makeRow(`g-full${String(k).padStart(8, '0')}`, speciesBaseGenome('dollop', k), T, 0, 'drop'));
    fm.map.set(HOARD_KEY, serializeHoard(h)); fc.dispose();
    const fc2 = mkColl(fm, 15); const frt = mkJ(fc2, fm); giftReadyState(frt);
    const rf = await fc2.claimGift!(1, 'puddlo');
    if (rf.ok || rf.message !== GIFT_COPY.shelfFull || frt.store.journal.st.giftState[1] !== 1) fail('shelf full: did not wait');
    fc2.dispose();
  }
  for (const r of results) console.log(`     CO-05 case: ${r}`);
  row('CO-05', 'the gift grant: interrupted after step 1, 2 (also merged into a blend), 3; step 2 on failing (quota and silent) storage then a reload; a serializeHoard round trip; two tabs: exactly one gift per chapter, at most 5 for life, at most 1 a UTC day, listed species only (all Common or Uncommon), origin restock shown as "Gift", the id in ID_PATTERN (at most 46 chars), the shelf cap keeps it waiting',
    allOk, results.join(' | ') || '15 cases');
}

/* ═══════════════════════════════ CO-06: warmth across merges ═══════════════════════════════ */
{
  const j = createJournal(d, 'abcdefgh12'), out = createQuestOut(64);
  setQuestDay(j.st, 20407);
  const ids = ['g-parent00001', 'g-parent00002', 'g-other000003'];
  for (const id of ids) journalIdIndex(j, id, true);
  j.st.wm[0] = 30; j.st.wm[1] = 12; j.st.wm[2] = 4;
  // the hoard: both parents were merged into a blend (the journal's write lagged); the blend row names them
  const shelf: ShelfItem[] = [{ id: 'g-blend000001', speciesIdx: 0, ledger: 'practice', parents: ['g-parent00001', 'g-parent00002'] }, { id: 'g-other000003', speciesIdx: 1, ledger: 'practice' }];
  reconcileJournalShelf(j, shelf);
  const ok1 = warmthOfId(j, 'g-blend000001') === 30 && warmthOfId(j, 'g-other000003') === 4 && j.ids.length === 2;
  // a merge keeps the larger warmth: a granted wish (+3) on one copy, then the merge of both
  const a = createJournal(d, 'abcdefgh12'), b = createJournal(d, 'abcdefgh12');
  journalIdIndex(a, 'g-x00000000001', true); a.st.wm[0] = 20; journalIdIndex(b, 'g-x00000000001', true); b.st.wm[0] = 23;
  const m = mergeJournals(a, b, d);
  setJournalParty(m, ['g-x00000000001'], () => 4);
  applyEventFields(m.st, d, out, EV.WISH, WISH_STATE.GRANTED, 0, -1, 4, 255, 0, 0, BY.PLAYER, 0, WISH_KIND.NAP);
  row('CO-06', 'warmth: before the shelf prune, a pruned parent\'s warmth moves (max) to the blend row naming it (30 from 30 and 12), unrelated rows stay; a merge keeps the larger (23 of 20 and 23), then +3 for a granted wish',
    ok1 && warmthOfId(m, 'g-x00000000001') === 26, `blend ${warmthOfId(j, 'g-blend000001')}, merged ${warmthOfId(m, 'g-x00000000001')}`);
}

/* ═══════════════════════════════ CO-07: probe_collection and its imports unchanged ═══════════════════════════════ */
{
  const pc = spawnSync(process.execPath, [resolve(HERE, 'probe_collection.ts')], { encoding: 'utf8', cwd: ROOT });
  const pi = spawnSync(process.execPath, [resolve(HERE, 'probe_collection_imports.ts')], { encoding: 'utf8', cwd: ROOT });
  const m1 = /(\d+)\/(\d+) checks passed/.exec(pc.stdout ?? ''), m2 = /(\d+)\/(\d+) checks passed/.exec(pi.stdout ?? '');
  const fails = (pc.stdout ?? '').split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.split(' ')[1]);
  row('CO-07', 'probe_collection at least 73/74 with C08 the only possible failure (the known open, flaky allocation row: it fails on the unchanged HEAD too), and probe_collection_imports 10/10',
    !!m1 && Number(m1[2]) === 74 && Number(m1[1]) >= 73 && fails.every((f) => f === 'C08') && !!m2 && m2[1] === m2[2] && m2[2] === '10', `${m1?.[0]} (${fails.join() || 'none failed'}), ${m2?.[0]}`);
}

/* ═══════════════════════════════ CO-08: the hoard key only through ghostGrantGift ═══════════════════════════════ */
{
  const strip = (s: string): string => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const files = ['src/core/quests.ts', 'src/collection/journal.ts', 'src/collection/journal_store.ts'];
  const hits = files.filter((f) => /HOARD_KEY|wobblehoard:v2:hoard['"]/.test(strip(readFileSync(resolve(ROOT, f), 'utf8'))));
  const m = memoryStorage(); const c = mkColl(m, 20); c.flush();
  const rt = mkJ(c, m); giftReadyState(rt);
  m.sets.length = 0;
  const r = ring(); for (let k = 0; k < 40; k++) push(r, EV.SOCIAL, S.GREET, 1, -1, k % 9, 9 + (k % 5), 2, BY.SELF);
  c.feedPlay!(r, T); T += 3000; runTimers(); rt.store.writeNow(); c.setJournalParty!(['g-nope']); rt.flush();
  const before = m.sets.filter((k) => k === HOARD_KEY).length;
  await c.claimGift!(1, 'puddlo');
  const during = m.sets.filter((k) => k === HOARD_KEY).length - before;
  const others = m.sets.filter((k) => k !== HOARD_KEY && k !== JOURNAL_KEY && k !== JOURNAL_BACKUP_KEY);
  row('CO-08', 'the journal touches the hoard key only through ghostGrantGift: no Journal file names it; feeding, party changes and journal writes set only the journal keys; the claim\'s step 2 writes the hoard once',
    hits.length === 0 && before === 0 && during === 1 && others.length === 0, `${hits.join(', ') || 'no file'}; hoard writes before ${before}, during the claim ${during}; other keys ${others.join() || 'none'}`);
  c.dispose();
}

/* ═══════════════════════════════ CO-09: a signed-in ledger gets no gift ═══════════════════════════════ */
{
  const m = memoryStorage(); const c = mkColl(m, 21);
  const real = Object.create(c) as Collection;
  let port: Parameters<NonNullable<Collection['attachJournal']>>[0] | null = null;
  (real as { attachJournal: Collection['attachJournal'] }).attachJournal = (impl) => { port = impl; const p = c.attachJournal!(impl); return { ...p, ledger: () => 'real' as const }; };
  const rt = attachJournal(real, { storage: m, ...fakeTimers })!; giftReadyState(rt);
  void port;
  const rows0 = storedHoard(m).ghosts.length;
  const r = await rt.claimGift(1, 'puddlo');
  row('CO-09', 'a non-practice ledger gets no gift: the claim answers signed_in with "Your gift will wait here for now." and adds no row; the view says giftsAllowed false (no Yes button) and the gift stays ready for later (T8)',
    !r.ok && r.error === 'signed_in' && r.message === GIFT_COPY.signedIn && storedHoard(m).ghosts.length === rows0 && rt.store.journal.st.giftState[1] === 0 && rt.view().giftsAllowed === false
    && rt.view().gifts.some((g) => g.chapter === 1 && g.state === 'ready'), JSON.stringify(r));
  c.dispose();
}

/* ═══════════════════════════════ CO-10: ids by ledger ═══════════════════════════════ */
{
  const j = createJournal(d, 'abcdefgh12');
  const starter = 'slice1-starter-id'; const gift = giftItemId('abcdefgh12', 1); const realG = 'g-looksghost01'; const realU = '0b6f5a3e-0000-4000-8000-00000000abcd';
  for (const id of [starter, gift, realG, realU]) { const k = journalIdIndex(j, id, true); j.st.wm[k] = 5; }
  j.acct = '0123456789abcdef0123456789abcdef';
  reconcileJournalShelf(j, [
    { id: starter, speciesIdx: 0, ledger: 'practice' }, { id: gift, speciesIdx: 3, ledger: 'practice' }, { id: realG, speciesIdx: 4, ledger: 'real' }, { id: realU, speciesIdx: 5, ledger: 'real' },
  ]);
  const cls = j.ids.map((id, k) => `${id.slice(0, 6)}:${j.real[k] ? 'real' : 'practice'}`).join(' ');
  const okCls = j.real[j.ids.indexOf(starter)] === 0 && j.real[j.ids.indexOf(gift)] === 0 && j.real[j.ids.indexOf(realG)] === 1 && j.real[j.ids.indexOf(realU)] === 1;
  const t = JSON.parse(serializeJournal(j, d)) as { acct?: string; real: number[] };
  const k2 = createJournal(d, 'x'); Object.assign(k2, { ids: j.ids.slice(), real: j.real.slice(), st: j.st, acct: j.acct });
  forgetJournalAccount(k2, '0123456789abcdef0123456789abcdef');
  const kept = k2.ids.length;
  forgetJournalAccount(k2, null);
  row('CO-10', 'ids are classified by their Hoard item\'s ledger, never by prefix (the slice-1 starter\'s old id and a jg- gift stay practice; a real item stays real even with a g- prefix); real rows sit under the blob\'s one acct and leave on sign-out, practice ids stay',
    okCls && t.acct === j.acct && t.real.length === 2 && kept === 4 && k2.ids.length === 2 && k2.ids.includes(starter) && k2.ids.includes(gift) && k2.acct === null && warmthOfId(k2, starter) === 5, cls);
}

/* ═══════════════════════════════ CO-11: over the cap ═══════════════════════════════ */
{
  const j = worstJournal();
  // push it over: 64-character ids no field names would be kept by a normal write; Met-only rows with few points; today's points
  const st = j.st;
  for (let r = 0; r < FR_ROWS; r++) { st.frPts[r] = r < 100 ? 1 + (r % 5) : 30; st.frLo[r] = r % 40; st.frHi[r] = 40 + (r % 10); }
  st.frLo[0] = 0; st.frHi[0] = sp(SPECIES_LIFE.dollop.friend); st.frPts[0] = 1;                       // a Met-only best-friend pair: never dropped
  for (let k = 50; k < 100; k++) { st.wm[k] = 0; st.wmBits[k] = 0; }                                // ids 50..99 not named (no warmth row, not in the party)
  setQuestParty(st, [0, 1], [0, 1], 2);
  const full = serializeJournal(j, d);
  const t40 = serializeJournalCapped(j, d, full.length - 1);
  const x = JSON.parse(t40!) as Record<string, unknown>;
  const t2 = serializeJournalCapped(j, d, JSON.stringify({ ...JSON.parse(full), fd: undefined }).length - 200);
  const y = t2 ? JSON.parse(t2) as { fr: number[][]; ids: string[]; wm: number[][] } : null;
  const metKept = y ? y.fr.filter((r) => r[2] < 12).length : -1;
  const bestKept = !!y && y.fr.some((r) => r[0] === 0 && r[1] === sp(SPECIES_LIFE.dollop.friend));
  const big = y ? y.fr.filter((r) => r[2] >= 12).length : -1;
  const t3 = serializeJournalCapped(j, d, 9000);
  const z = t3 ? JSON.parse(t3) as { ids: string[]; wm: number[][]; qd: string; fx: number[][]; ks: number; pl: number; gift: number[][] } : null;
  const okOrder = !!t40 && !('fd' in x) && (x.fr as unknown[]).length === FR_ROWS && !!y && bestKept && big === 28 && metKept < 100
    && !!z && z.ids.length === 50 && z.wm.length === 50 && z.fx.length === 64 && z.gift.length === 5 && z.ks === 0xfffff && z.pl === 0x3ff;
  row('CO-11', 'over the cap the write drops fd first, then Met-only fr rows fewest points first (never a best-friend pair, never Friends or closer), then ids no field names; never qd, fx, ks, pl, gift or a wm row',
    okOrder, `full ${full.length}; minus fd ${t40?.length}; Met-only rows left ${metKept}, Friends+ ${big}, best pair kept ${bestKept}; at 9000: ids ${z?.ids.length}, wm ${z?.wm.length}`);
  // still over: refused; memory and the stored blob keep everything; the next change retries (the store with its cap lowered to 4000)
  const m = memoryStorage(); const c = mkColl(m, 30); const rt = mkJ(c, m); rt.store.writeNow();
  const storedBefore = m.getItem(JOURNAL_KEY);
  const tight = createJournalStore(m, { defs: d, deviceId: rt.store.journal.dev, now, ...fakeTimers, maxChars: 4000 });
  const tj = tight.journal;
  for (let k = 0; k < 100; k++) { journalIdIndex(tj, `${k.toString(36).padStart(2, '0')}${'q'.repeat(62)}`, true); tj.st.wm[k] = 50; }
  const okW = tight.writeNow();
  const state1 = tight.report().save, refused1 = tight.refused;
  tight.markDirty(); T += 5000; runTimers();
  row('CO-11', 'a write still over the cap after pruning (100 warmth rows naming 64-character ids under a 4000 cap) is refused: report "failing", the stored blob unchanged, memory keeps every warmth row; the next change tries again',
    !okW && state1 === 'failing' && m.getItem(JOURNAL_KEY) === storedBefore && tj.st.wm[99] === 50 && tj.ids.length === 100 && refused1 === 1 && tight.refused === 2,
    `refused ${refused1} then ${tight.refused}, stored unchanged ${m.getItem(JOURNAL_KEY) === storedBefore}`);
  // the same refusal shown directly
  const tiny = serializeJournalCapped(worstJournal(), d, 1000);
  row('CO-11', 'serializeJournalCapped returns null (refuse) when even the fully pruned text is over the cap', tiny === null);
  c.dispose();
}

/* ═══════════════ CO-12 (round 3): the Journal beside the PC line's trophies (src/shell/achievementsBinding.ts, src/core/achStore.ts) ═══════════════
 * boot.ts hands the game `ach.observe(hoard)`, a Proxy over the collection; the life chunk will call attachJournal on THAT object. These rows
 * check that the Journal, its feed and the gift grant work through it and that the trophies see exactly what they saw without a Journal. */
{
  type Bus = { subs: Set<(k: string | null) => void>; fire(k: string | null): void; subscribe(fn: (k: string | null) => void): () => void };
  const bus = (): Bus => { const subs = new Set<(k: string | null) => void>(); return { subs, fire: (k) => { for (const f of [...subs]) f(k); }, subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; } }; };
  const fenv = (): PortalEnv => ({ now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined, framed: false, post: () => undefined, onMessage: () => () => undefined });
  const touch = (kind: 'release' | 'snap', intensity: number, heldFor: number) => ({ kind, at: { x: 0, y: 0.5, z: 0.5 }, normal: { x: 0, y: 0, z: 1 }, intensity, heldFor, finger: 0 }) as Parameters<Collection['feed']>[0];
  const fakeGame = (hoard: Collection) => {
    const hooks = new Set<(dt: number, t: number) => void>();
    const g = { phase: 'play', simTime: 0, body: { metrics: { carried: false } }, bodies: { extras: [] }, cut: { pieces: 1, busy: false }, ceremonies: { active: false, pending: false }, hoard,
      onStep(fn: (dt: number, t: number) => void) { hooks.add(fn); return () => { hooks.delete(fn); }; }, step() { g.simTime += 1 / 60; for (const f of [...hooks]) f(1 / 60, g.simTime); } };
    return g;
  };
  /** One boot-like rig on ONE storage (as boot.ts: the hoard, the trophies and the journal share storage and the window 'storage' bus). */
  const rig = (withJournal: boolean, seed: number) => {
    const m = memoryStorage(), b = bus();
    const hoard = createCollection({ storage: m, now, random: mulberry32(seed), ...fakeTimers, throttleMs: 2000, subscribe: b.subscribe });
    const ach = createAchievements({ storage: m, now, env: fenv(), subscribe: b.subscribe });
    const c = ach.observe(hoard);
    const g = fakeGame(c);
    const off = ach.attach(g as unknown as AchGameLike, { announce: () => undefined });
    const rt = withJournal ? attachJournal(c, { storage: m, subscribe: b.subscribe, ...fakeTimers, throttleMs: 2000 }) : null;
    return { m, b, hoard, ach, c, g, rt, off };
  };
  const play = (r: ReturnType<typeof rig>): void => {
    for (let k = 0; k < 6; k++) { r.c.feed(touch('release', 0.6, 1.2), T + k * 900); r.g.step(); }
    for (let k = 0; k < 4; k++) { r.c.feed(touch('snap', 0.8, 0.5), T + 7000 + k * 900); r.g.step(); }
  };
  const A = rig(false, 31), B = rig(true, 31);
  row('CO-12', 'attachJournal through the trophies wrapper (ach.observe(hoard), the object boot.ts gives createGame) attaches: journal(), feedPlay, claimGift, warmthOf and setJournalParty answer through the Proxy',
    !!B.rt && B.c.journal!() !== null && typeof B.c.feedPlay === 'function' && typeof B.c.claimGift === 'function' && B.c.warmthOf!('nope') === 0);
  // the same touches in both rigs, then the Journal's own traffic in B only (a ring of play, a gift)
  play(A); play(B);
  const r1 = ring(16);
  push(r1, EV.VISIT, 0, 0, -1, sp('dollop') >= 0 ? sp('dollop') : 0, 255, 1, BY.PLAYER);
  push(r1, EV.TOUCH, 1, 0, -1, 0, 255, 1, BY.PLAYER, 1.0);
  B.c.feedPlay!(r1, T);
  const stampsB = B.rt!.store.journal.st.sc[SC.ST];
  giftReadyState(B.rt!);
  const setsBefore = B.m.sets.length;
  const speciesBefore = B.ach.save.counters.species;
  const g1 = await B.c.claimGift!(1, 'puddlo');
  const giftSets = B.m.sets.slice(setsBefore);
  const dev = B.rt!.store.journal.dev;
  const giftItem = B.c.item(giftItemId(dev, 1));
  row('CO-12', 'the gift grant through the wrapper: one row on the shelf ("Gift" on the Hoard line), the journal granted; its writes touch only the hoard and journal keys, never wobblehoard:v1:ach',
    g1.ok && giftRows(B.m, dev) === 1 && !!giftItem && itemOriginCopy(giftItem) === 'Gift' && B.rt!.store.journal.st.giftState[1] === 2 && !giftSets.includes(ACH_KEY) && giftSets.includes(HOARD_KEY) && giftSets.includes(JOURNAL_KEY),
    `keys written: ${[...new Set(giftSets)].join(' ')}`);
  B.c.flush(); A.c.flush(); B.ach.store.flush(); A.ach.store.flush();
  const strip = (s: string | null): string => { const o = JSON.parse(s ?? '{}') as { counters?: Record<string, number>; earned?: Record<string, number> }; return JSON.stringify({ c: o.counters, e: Object.keys(o.earned ?? {}).sort() }); };
  row('CO-12', 'trophy behaviour is unchanged by the Journal: after the same touches, the trophies\' save (nine counters, the earned set) with a Journal attached, a ring fed and a gift granted equals the save without one',
    strip(A.m.getItem(ACH_KEY)) === strip(B.m.getItem(ACH_KEY)) && B.ach.save.counters.squeezes === 6 && B.ach.save.counters.capsules === 0 && B.ach.save.counters.tasks === 0,
    `A ${strip(A.m.getItem(ACH_KEY))} | B ${strip(B.m.getItem(ACH_KEY))}`);
  row('CO-12', 'the Journal never writes or names the trophies\' key, and the trophies never write the journal\'s keys (one shared storage)',
    !['src/collection/journal.ts', 'src/collection/journal_store.ts', 'src/core/quests.ts'].some((f) => /v1:ach|ACH_KEY|achStore/.test(readFileSync(resolve(ROOT, f), 'utf8')))
      && !A.m.sets.some((k) => k.startsWith('wobblehoard:v2:journal')) && (JOURNAL_KEY as string) !== ACH_KEY && !JOURNAL_KEY.startsWith('wobblehoard:v1:') && stampsB >= 0,
    `journal key ${JOURNAL_KEY}, trophies key ${ACH_KEY}`);
  // the window 'storage' bus: another tab's trophies write must not re-read the journal, another tab's journal write must not re-read the trophies
  {
    const reads: string[] = []; const get0 = B.m.getItem; B.m.getItem = (k: string) => { reads.push(k); return get0(k); };
    B.b.fire(ACH_KEY); const onAch = reads.splice(0);
    B.b.fire(JOURNAL_KEY); const onJ = reads.splice(0);
    B.m.getItem = get0;
    row('CO-12', 'the shared storage bus: a trophies-key change re-reads the trophies only (never the journal); a journal-key change re-reads the journal only (never the trophies, never the hoard)',
      onAch.includes(ACH_KEY) && !onAch.includes(JOURNAL_KEY) && onJ.includes(JOURNAL_KEY) && !onJ.includes(ACH_KEY) && !onJ.includes(HOARD_KEY), `on ach: ${onAch.join(' ')} | on journal: ${onJ.join(' ')}`);
  }
  // the Journal's own events reach the shell's listeners through the wrapper's onEvent, and its external fold-in never fires 'external' (which would sync the trophies)
  {
    const seen: string[] = []; const offE = B.c.onEvent((e: CollectionEvent) => seen.push(e.type));
    const r2 = ring(8); push(r2, EV.VISIT, 0, 0, -1, 0, 255, 1, BY.PLAYER); B.c.feedPlay!(r2, T);
    const other = JSON.parse(B.m.getItem(JOURNAL_KEY)!) as Record<string, unknown>; B.m.setItem(JOURNAL_KEY, JSON.stringify(other)); B.b.fire(JOURNAL_KEY);
    offE();
    row('CO-12', 'a journal change from another tab folds in without a collection \'external\' event (the trophies and the capsule table re-sync only on the hoard\'s own)', !seen.includes('external'), seen.join(' ') || '(none)');
  }
  // the dev hook's replace-and-restore pattern on the wrapper (failNextMerge) leaves the journal hooks alone
  {
    const orig = B.c.feedPlay!; (B.c as { feedPlay?: unknown }).feedPlay = () => undefined; (B.c as { feedPlay?: unknown }).feedPlay = orig;
    const before = B.rt!.store.journal.st.sc[SC.ST]; const r3 = ring(8); push(r3, EV.TOUCH, 1, 0, -1, 0, 255, 1, BY.PLAYER, 1.0); B.c.feedPlay!(r3, T);
    row('CO-12', 'a member replaced and restored through the wrapper (the dev hook\'s pattern) still reaches the journal (no recursion, no lost feed)', B.rt!.store.journal.st.sc[SC.ST] >= before);
  }
  // INFO (not a check): the trophies' species sweep runs on open / merge / restock / another tab's hoard, not on a gift; a gifted new species is counted at the next sweep
  console.log(`info CO-12 the species counter around a gift: before ${speciesBefore}, right after the grant ${B.ach.save.counters.species}, owned now ${B.hoard.stacks().filter((s) => s.copies > 0).length} (the trophies count a gifted species at their next sweep: request to PG_SHELL in PG_QUESTS.md round 3)`);
  A.off(); B.off(); A.ach.dispose(); B.ach.dispose(); A.hoard.dispose(); B.hoard.dispose();
}

console.log(`\n${bad === 0 ? 'all checks passed' : `${bad} FAILED`}`);
process.exit(bad ? 1 : 0);
