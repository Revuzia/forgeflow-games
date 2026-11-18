// PLAYGROUND Journal blob: sanitize, serialize (the revision 3 format), the two-tab merge, the cap's pruning order, the backfill, ids by ledger
// and warmth across merges (_spec/PLAYGROUND_BUILD.md 12; _spec/QUESTS.md 9 to 13; brief _handoff/briefs/PG_QUESTS.md steps 5 and 6).
//
// LOADING (D-69): the post-play LIFE CHUNK (journal_store.ts imports it); never imported by index.ts or anything boot loads.
// Rules this file keeps:
//   * The stored journal is hostile input: sanitizeJournal never throws, keeps only known fields with checked ranges, and returns null only
//     for something that is not a v1 journal object at all (the store parks it).
//   * Every field only grows or is a max, so two tabs merge by union or max (CO-03); `cur` is the last writer's; merging a blob with itself
//     is the identity.
//   * Item ids are classified by their Hoard item's ledger, never by their prefix (CO-10): the slice-1 starter keeps its old id and a 'jg-'
//     gift is practice. Real-ledger entries sit under the blob's one `acct` tag and leave on sign-out or an account switch.
//   * Over JOURNAL_MAX_CHARS the write drops `fd` rows, then Met-only `fr` rows with the fewest points (never Friends or closer, never a
//     best-friend pair), then `ids` no field names; never `qd`, `fx`, `ks`, `pl`, `gift` or a `wm` row (CO-11). Still over: null (refused).
import { PLACE_IDS, THING_IDS, placeInfo } from '../data/places.ts';
import { FRIENDSHIP } from '../data/life.ts';
import { CHAPTERS, FACT, GIFT_LISTS } from '../data/quests.ts';
import type { QuestDefs, QuestState, PlaceCaps, QuestOut } from '../core/quests.ts';
import {
  PAIR_SET, PARTY_MAX, SC, SPECIES_BITS, WISH_KEPT, WM_ROWS, buildQuestDefs, chapterOpen, createQuestState, finaleOpen, giftReady, hasKeys, isDone, isShown,
  markDone, markFact, needsAutonomy, questOpen, questProgress, recountDerived, setQuestParty, trackerQuest, friendLevel, forgetDropped,
} from '../core/quests.ts';
import { ACCT_TAG_PATTERN, DEVICE_ID_PATTERN, ID_PATTERN } from './constants.ts';
import type { JournalView, Ledger, StorageReport } from './types.ts';

/** The journal's keys besides JOURNAL_KEY (constants.ts), its version and limits (PLAYGROUND_BUILD 12). They live here, in the life chunk, to keep
 *  the first load under its 2 KB share (14.3). */
/** An unreadable journal is parked here (at most PARK_MAX_CHARS; a journal is at most JOURNAL_MAX_CHARS, so it parks whole). */
export const JOURNAL_BACKUP_KEY = 'wobblehoard:v2:journal.unreadable';
/** The Friendship Frame's thumbnail (a JPEG data URL), written once by the shell at the X8 photo, never inside the journal blob (PB 11.15). */
export const JOURNAL_FRAME_KEY = 'wobblehoard:v2:journal.frame';
export const JOURNAL_FRAME_MAX_CHARS = 12_000;
export const JOURNAL_VERSION = 1 as const;
/** The worst-case journal is about 13.2 KB (CO-02); over this the pruning order applies, then the write is refused (CO-11). */
export const JOURNAL_MAX_CHARS = 16_000;
/** Item ids the journal names, once each (warmth, the party). */
export const JOURNAL_IDS_MAX = 100;

const NO = 255;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const intIn = (x: unknown, lo: number, hi: number): number | null => (isInt(x) && x >= lo && x <= hi ? x : null);

/* ═══════════════════════════════════════ what each place can produce (QU-14) ═══════════════════════════════════════ */

/**
 * Per place idx: the REACT kinds, SOCIAL kinds and USE verbs it can produce. Derived from each PlaceDef by LIFE 4.2's triggers and LIFE 6.1's
 * moments (water and its depth, warm zones of 0.5 / 0.6 / 0.667 and more, cold, ice and marking ground, wind, updraft, magnet, the sky things,
 * the drip leaf, the bubble patch, someone's favourite place; a seesaw, a swing, a ball, peek spots, an echo zone, water or rain for the
 * squirt), as bit masks (bit = the REACT_KIND, SOCIAL_KIND or USE_VERB id; numbers, not names, to keep the life chunk small). `probe_quests.ts`
 * QU-14 recomputes this table from every PlaceDef and fails on a difference, as DT-16 does for THING_KINDS. The S2 and S3 rows are derived from
 * their PlaceDefs as they stand today (first-draft tall layouts).
 */
export const PLACE_CAPS: readonly PlaceCaps[] = [
  /* home        reacts -; socials + -; verbs ROLL BOUNCE RING NAP SWITCH LISTEN */
  { reacts: 0, socials: 862206, verbs: 3298 },
  /* hearthlog   reacts TOAST RISE OOZE WARM SHIVER FROST LOVE; socials + TEETER PUSH; verbs ROLL ROCK SWING NAP SWITCH LISTEN */
  { reacts: 8389616, socials: 868350, verbs: 3214 },
  /* ripple      reacts FLOAT WADE SOAK SPLASH DRIFT PRINT DRY LOVE; socials + PEEK SQUIRT; verbs ROLL RING FLOAT_ON SLIDE LEAN WADE */
  { reacts: 12857358, socials: 911358, verbs: 13122 },
  /* frostbell   reacts FLOAT WADE SOAK TOAST RISE OOZE WARM SHIVER FROST SNOWCAP GLIDE PRINT HOLD_ON DRY LOVE; socials + SQUIRT; verbs ROLL RING NAP SLIDE WADE SHAKE STEP */
  { reacts: 14946302, socials: 894974, verbs: 58050 },
  /* rainleaf    reacts SOAK SPLASH PRINT SHOWER LOVE; socials + TEETER SQUIRT; verbs ROLL ROCK BOUNCE SWITCH WADE STEP */
  { reacts: 9179144, socials: 897022, verbs: 42022 },
  /* fizzwell    DROPPED (D-96): nothing */
  { reacts: 0, socials: 0, verbs: 0 },
  /* cogwhistle  DROPPED (D-96): nothing */
  { reacts: 0, socials: 0, verbs: 0 },
  /* lanternroof reacts SOAK TOAST RISE OOZE WARM SPLASH GAZE_SKY HOLD_ON DRY LOVE; socials + PUSH SQUIRT; verbs SWING SPIN RING NAP SWITCH WADE */
  { reacts: 14815480, socials: 890878, verbs: 9432 },
  /* echohollow  DROPPED (D-96): nothing */
  { reacts: 0, socials: 0, verbs: 0 },
  /* cloudloft   reacts LIFT PRINT HOLD_ON LOVE; socials + PUSH; verbs ROLL SWING BOUNCE NAP STEP */
  { reacts: 10764288, socials: 866302, verbs: 32938 },
];
/** Things per place in THING_IDS order (places.ts: Home 0..5, Hearthlog 6..11, ...; append-only). QU-14 checks every ThingDef.place. */
const THINGS_PER_PLACE = [6, 6, 6, 7, 6, 6, 7, 6, 6, 6] as const;
export const THING_PLACE: readonly number[] = THINGS_PER_PLACE.flatMap((n, p) => new Array<number>(n).fill(p));

let defaultDefs: QuestDefs | null = null;
/** Per place idx: shipped, and the stamps it opens at (0 = the start, -1 = the first wish), from PLACE_INFO (D-96: a dropped place has no row:
 *  never shipped, opens never (0 with no ship bit)). */
export const PLACE_SHIPPED: readonly boolean[] = PLACE_IDS.map((_, i) => placeInfo(i)?.shipped === true);
export const PLACE_OPENS_AT: readonly number[] = PLACE_IDS.map((_, i) => { const p = placeInfo(i); return !p ? 0 : p.stampsToOpen === 'firstWish' ? -1 : p.stampsToOpen; });
/** The rules compiled against this build's shipped places (PLACE_INFO.shipped). */
export function journalDefs(): QuestDefs {
  if (!defaultDefs) {
    defaultDefs = buildQuestDefs({
      placeIds: PLACE_IDS, thingIds: THING_IDS, shipped: PLACE_SHIPPED, opensAt: PLACE_OPENS_AT, thingPlace: THING_PLACE, caps: PLACE_CAPS,
    });
  }
  return defaultDefs;
}

/* ═══════════════════════════════════════ the in-memory journal ═══════════════════════════════════════ */

export interface Journal {
  /** the device id (the hoard's; written for the gift id's sake and checked on load) */
  dev: string;
  /** the acctTag of the real-ledger rows, or null */
  acct: string | null;
  /** item ids the journal names, once each (warmth by index, the party) */
  ids: string[];
  /** 1 = ids[i] is a real-ledger item */
  real: Uint8Array;
  st: QuestState;
}

export function createJournal(defs: QuestDefs, dev: string): Journal {
  return { dev: DEVICE_ID_PATTERN.test(dev) ? dev : '', acct: null, ids: [], real: new Uint8Array(JOURNAL_IDS_MAX), st: createQuestState(defs) };
}

/** The index of an item id in `ids`, adding it when `add` (reusing a slot no field names when full); -1 when absent or no room. */
export function journalIdIndex(j: Journal, id: string, add: boolean): number {
  const i = j.ids.indexOf(id);
  if (i >= 0 || !add || !ID_PATTERN.test(id)) return i;
  if (j.ids.length < JOURNAL_IDS_MAX) { j.ids.push(id); clearIdRow(j, j.ids.length - 1); return j.ids.length - 1; }
  for (let k = 0; k < j.ids.length; k++) if (!idNamed(j, k)) { j.ids[k] = id; clearIdRow(j, k); return k; }
  return -1;
}
function clearIdRow(j: Journal, k: number): void { j.st.wm[k] = 0; j.st.wmDay[k] = -1; j.st.wmBits[k] = 0; j.real[k] = 0; }
/** Does a field name ids[k]: a warmth row, or the party? */
function idNamed(j: Journal, k: number): boolean {
  if (j.st.wm[k] > 0 || j.st.wmBits[k] !== 0) return true;
  for (let s = 0; s < PARTY_MAX; s++) if (j.st.party[s] === k) return true;
  return false;
}

/** The party as item ids, with each one's species idx (the reducer's warmth goes to the first party item of the actor's species). */
export function setJournalParty(j: Journal, itemIds: readonly string[], speciesOf: (id: string) => number): void {
  const idx: number[] = [], sp: number[] = [];
  for (const id of itemIds) {
    if (typeof id !== 'string' || idx.length >= PARTY_MAX) continue;
    const s = speciesOf(id);
    if (!(s >= 0 && s < NO)) continue;
    const k = journalIdIndex(j, id, true);
    idx.push(k); sp.push(s);
  }
  setQuestParty(j.st, idx, sp, idx.length);
}
export function warmthOfId(j: Journal, id: string): number {
  const k = j.ids.indexOf(id);
  return k >= 0 ? j.st.wm[k] : 0;
}

/* ═══════════════════════════════════════ base64 of the done set (no DOM: btoa is not used) ═══════════════════════════════════════ */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function wordsToB64(w: Uint32Array): string {
  const bytes: number[] = [];
  for (let i = 0; i < w.length; i++) bytes.push(w[i] & 255, (w[i] >>> 8) & 255, (w[i] >>> 16) & 255, (w[i] >>> 24) & 255);
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
function b64ToWords(s: unknown, w: Uint32Array): boolean {
  if (typeof s !== 'string' || s.length > 64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return false;
  const bytes: number[] = [];
  for (let i = 0; i + 3 < s.length + 0 && i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (s[i + k] === '=' || s[i + k] === undefined ? -1 : B64.indexOf(s[i + k])));
    if (c[0] < 0 || c[1] < 0) return false;
    const n = (c[0] << 18) | (c[1] << 12) | (Math.max(0, c[2]) << 6) | Math.max(0, c[3]);
    bytes.push((n >>> 16) & 255); if (c[2] >= 0) bytes.push((n >>> 8) & 255); if (c[3] >= 0) bytes.push(n & 255);
  }
  for (let i = 0; i < w.length; i++) w[i] = ((bytes[i * 4] ?? 0) | ((bytes[i * 4 + 1] ?? 0) << 8) | ((bytes[i * 4 + 2] ?? 0) << 16) | ((bytes[i * 4 + 3] ?? 0) << 24)) >>> 0;
  return true;
}

/* ═══════════════════════════════════════ serialize (PLAYGROUND_BUILD 12, revision 3 format) ═══════════════════════════════════════ */

interface SerOpts { noFd?: boolean; frSkip?: Uint8Array; namedIdsOnly?: boolean }
const isBestPair = (d: QuestDefs, lo: number, hi: number): boolean => lo < SPECIES_BITS && d.spFriend[lo] === hi;

/** The canonical text of a journal (fixed key order). The extra fields beyond PLAYGROUND_BUILD 12's sketch: `fw` [first wish state, its
 *  wisher], `sg` (places with a song: the Songbook), `wg` (wishes come true: the Wish Jar). */
export function serializeJournal(j: Journal, d: QuestDefs, o: SerOpts = {}): string {
  const st = j.st, sc = st.sc;
  // ids: all, or (pruning) only the ones a field names
  const map = new Int16Array(JOURNAL_IDS_MAX).fill(-1);
  const ids: string[] = [];
  for (let k = 0; k < j.ids.length; k++) if (!o.namedIdsOnly || idNamed(j, k)) { map[k] = ids.length; ids.push(j.ids[k]); }
  const real: number[] = [];
  for (let k = 0; k < j.ids.length; k++) if (map[k] >= 0 && j.real[k]) real.push(map[k]);
  // qp rows: [quest, clause, count] plus, for a distinct or sameSpecies clause, its items: bit positions 0..63, or the pair keys
  const qp: (number | number[])[][] = [];
  for (let q = 0; q < d.nq; q++) {
    if (isDone(st, q)) continue;
    for (let c = d.qFirst[q]; c < d.qFirst[q + 1]; c++) {
      const items: number[] = [];
      if (d.cPair[c] >= 0) { for (let k = 0; k < PAIR_SET; k++) { const e = st.pairs[d.cPair[c] * PAIR_SET + k]; if (e) items.push(e); } }
      else if (d.cDist[c] !== 0 || d.cSame[c]) { for (let b = 0; b < 64; b++) if (st.bits[c * 2 + (b >>> 5)] & (1 << (b & 31))) items.push(b); }
      if (st.cnt[c] === 0 && items.length === 0) continue;
      qp.push(items.length ? [q, c - d.qFirst[q], st.cnt[c], items] : [q, c - d.qFirst[q], st.cnt[c]]);
    }
  }
  const fx: number[][] = [];
  for (let s = 0; s < SPECIES_BITS; s++) if (st.fx[s]) fx.push([s, st.fx[s]]);
  const fr: number[][] = [], fdRows: number[][] = [];
  for (let r = 0; r < sc[SC.FRN]; r++) {
    if (o.frSkip && o.frSkip[r]) continue;
    fr.push([st.frLo[r], st.frHi[r], st.frPts[r]]);
    if (!o.noFd && st.frDay[r] > 0) fdRows.push([st.frLo[r], st.frHi[r], st.frDay[r]]);
  }
  const wm: number[][] = [];
  for (let k = 0; k < j.ids.length; k++) {
    if (map[k] < 0 || (st.wm[k] === 0 && st.wmBits[k] === 0)) continue;
    wm.push(st.wmBits[k] !== 0 && st.wmDay[k] === sc[SC.DAY] ? [map[k], st.wm[k], st.wmBits[k]] : [map[k], st.wm[k]]);   // today's gains (wday)
  }
  let pvLen = 0;
  for (let p = 0; p < st.pv.length; p++) if (st.pv[p]) pvLen = p + 1;
  const wi: number[][] = [];
  for (let k = 0; k < sc[SC.WIN]; k++) wi.push([st.wiSp[k], st.wiKind[k], st.wiTarget[k], st.wiDay[k]]);
  const gift: number[][] = [];
  for (let ch = 0; ch < st.giftState.length; ch++) if (st.giftState[ch]) gift.push([ch, st.giftState[ch], st.giftSp[ch], st.giftDay[ch]]);
  const party: number[] = [];
  for (let s = 0; s < sc[SC.PARTYN]; s++) { const k = st.party[s]; if (k >= 0 && map[k] >= 0) party.push(map[k]); }
  const out: Record<string, unknown> = { v: JOURNAL_VERSION, dev: j.dev, bf: sc[SC.BF], st: sc[SC.ST] };
  if (j.acct) out.acct = j.acct;
  out.qd = wordsToB64(st.done); out.qp = qp; out.fx = fx; out.fr = fr;
  if (!o.noFd && fdRows.length) out.fd = [sc[SC.FDDAY], fdRows];
  out.ids = ids; out.real = real; out.wm = wm; out.wday = sc[SC.DAY]; out.ks = sc[SC.KS] >>> 0; out.pl = sc[SC.PL]; out.pv = Array.from(st.pv.subarray(0, pvLen));
  out.wi = wi; out.gift = gift; out.gday = sc[SC.GDAY]; out.fw = [sc[SC.FW], sc[SC.WISHER]]; out.sg = sc[SC.SG]; out.wg = sc[SC.WG];
  out.cur = { p: sc[SC.CURP], party }; out.day = sc[SC.DAY];
  return JSON.stringify(out);
}

/** The write's text under the cap, by the pruning order (CO-11); null when even the pruned text is over (the write is refused). */
export function serializeJournalCapped(j: Journal, d: QuestDefs, max = JOURNAL_MAX_CHARS): string | null {
  let t = serializeJournal(j, d);
  if (t.length <= max) return t;
  const o: SerOpts = { noFd: true };
  t = serializeJournal(j, d, o);
  if (t.length <= max) return t;
  // Met-only friendship rows, fewest points first; never Friends or closer, never a best-friend pair (LF-15's rule)
  const st = j.st, n = st.sc[SC.FRN];
  const cand: number[] = [];
  for (let r = 0; r < n; r++) if (st.frPts[r] < FRIENDSHIP.friends && !isBestPair(d, st.frLo[r], st.frHi[r])) cand.push(r);
  cand.sort((a, b) => st.frPts[a] - st.frPts[b] || a - b);
  o.frSkip = new Uint8Array(n);
  for (const r of cand) {
    o.frSkip[r] = 1;
    t = serializeJournal(j, d, o);
    if (t.length <= max) return t;
  }
  o.namedIdsOnly = true;
  t = serializeJournal(j, d, o);
  return t.length <= max ? t : null;
}

/* ═══════════════════════════════════════ sanitize (hostile JSON never throws) ═══════════════════════════════════════ */

/** A clean journal from a parsed v1 object, or null when it is not one (the store parks it). */
export function sanitizeJournal(x: unknown, d: QuestDefs): Journal | null {
  try { return sanitizeInner(x, d); } catch { return null; }
}
function sanitizeInner(x: unknown, d: QuestDefs): Journal | null {
  if (!isObj(x) || x.v !== JOURNAL_VERSION) return null;
  const j = createJournal(d, typeof x.dev === 'string' ? x.dev : '');
  const st = j.st, sc = st.sc;
  if (typeof x.acct === 'string' && ACCT_TAG_PATTERN.test(x.acct)) j.acct = x.acct;
  sc[SC.BF] = x.bf === 1 ? 1 : 0;
  b64ToWords(x.qd, st.done);
  // only quests that exist
  for (let q = d.nq; q < 128; q++) st.done[q >>> 5] &= ~(1 << (q & 31));
  if (Array.isArray(x.qp)) for (const r of x.qp.slice(0, 400)) {
    if (!Array.isArray(r)) continue;
    const q = intIn(r[0], 0, d.nq - 1), k = intIn(r[1], 0, 2);
    if (q === null || k === null || d.qFirst[q] + k >= d.qFirst[q + 1]) continue;
    const c = d.qFirst[q] + k;
    const cnt = Math.min(intIn(r[2], 0, 65535) ?? 0, d.cCount[c]);
    const items = Array.isArray(r[3]) ? (r[3] as unknown[]).slice(0, 64) : [];
    if (d.cPair[c] >= 0) {
      let m = 0;
      for (const e of items) if (isInt(e) && e > 0 && e <= 65536 && m < PAIR_SET) { let dup = false; for (let z = 0; z < m; z++) if (st.pairs[d.cPair[c] * PAIR_SET + z] === e) dup = true; if (!dup) st.pairs[d.cPair[c] * PAIR_SET + m++] = e; }
      st.cnt[c] = Math.min(d.cCount[c], m);   // a distinct count is its items (core/quests.ts keeps them equal)
    } else if (d.cDist[c] !== 0 || d.cSame[c]) {
      let m = 0;
      for (const e of items) if (isInt(e) && e >= 0 && e < 64) { const w = c * 2 + (e >>> 5), bt = 1 << (e & 31); if (!(st.bits[w] & bt)) { st.bits[w] |= bt; m++; } }
      st.cnt[c] = d.cDist[c] !== 0 ? Math.min(d.cCount[c], m) : cnt;
    } else st.cnt[c] = cnt;
  }
  if (Array.isArray(x.fx)) for (const r of x.fx.slice(0, 256)) {
    if (!Array.isArray(r)) continue;
    const s = intIn(r[0], 0, SPECIES_BITS - 1), m = intIn(r[1], 0, 0xffff);
    if (s !== null && m !== null) st.fx[s] |= m & 0xfff;
  }
  if (Array.isArray(x.fr)) for (const r of x.fr.slice(0, 400)) {
    if (!Array.isArray(r) || sc[SC.FRN] >= st.frLo.length) continue;
    const a = intIn(r[0], 0, 254), b = intIn(r[1], 0, 254), p = isNum(r[2]) && r[2] > 0 && r[2] < 1e6 ? Math.round(r[2] * 2) / 2 : null;
    if (a === null || b === null || p === null || a >= b) continue;
    let dup = false;
    for (let k = 0; k < sc[SC.FRN]; k++) if (st.frLo[k] === a && st.frHi[k] === b) { st.frPts[k] = Math.max(st.frPts[k], p); dup = true; }
    if (dup) continue;
    const k = sc[SC.FRN]++;
    st.frLo[k] = a; st.frHi[k] = b; st.frPts[k] = p;
  }
  if (Array.isArray(x.fd) && x.fd.length === 2 && isInt(x.fd[0]) && Array.isArray(x.fd[1])) {
    sc[SC.FDDAY] = x.fd[0];
    for (const r of (x.fd[1] as unknown[]).slice(0, 400)) {
      if (!Array.isArray(r)) continue;
      const a = intIn(r[0], 0, 254), b = intIn(r[1], 0, 254), p = isNum(r[2]) && r[2] > 0 ? Math.min(FRIENDSHIP.perDay, r[2]) : null;
      if (a === null || b === null || p === null) continue;
      for (let k = 0; k < sc[SC.FRN]; k++) if (st.frLo[k] === a && st.frHi[k] === b) st.frDay[k] = Math.max(st.frDay[k], p);
    }
  }
  if (Array.isArray(x.ids)) for (const id of x.ids.slice(0, JOURNAL_IDS_MAX * 2)) {
    if (j.ids.length >= JOURNAL_IDS_MAX) break;
    j.ids.push(typeof id === 'string' && ID_PATTERN.test(id) && !j.ids.includes(id) ? id : '');
  }
  const okIdx = (v: unknown): number | null => { const k = intIn(v, 0, j.ids.length - 1); return k !== null && j.ids[k] !== '' ? k : null; };
  if (Array.isArray(x.real)) for (const v of x.real.slice(0, JOURNAL_IDS_MAX)) { const k = okIdx(v); if (k !== null) j.real[k] = 1; }
  if (Array.isArray(x.wm)) for (const r of x.wm.slice(0, JOURNAL_IDS_MAX * 2)) {
    if (!Array.isArray(r)) continue;
    const k = okIdx(r[0]), p = intIn(r[1], 0, 50);
    if (k === null || p === null) continue;
    st.wm[k] = Math.max(st.wm[k], p);
    const wday = intIn(x.wday, 0, 1e7), b = intIn(r[2], 0, 15);
    if (wday !== null && b !== null) { st.wmDay[k] = wday; st.wmBits[k] = b; }
  }
  sc[SC.KS] = (intIn(x.ks, 0, 0xffffffff) ?? 0) & 0xfffff;
  sc[SC.PL] = ((intIn(x.pl, 0, 0xffff) ?? 1) | 1) & ((1 << d.nPlaces) - 1);
  if (Array.isArray(x.pv)) x.pv.slice(0, st.pv.length).forEach((v, p) => { const n = intIn(v, 0, 65535); if (n !== null) st.pv[p] = n; });
  if (Array.isArray(x.wi)) for (const r of x.wi.slice(-WISH_KEPT * 4)) {
    if (!Array.isArray(r)) continue;
    const s = intIn(r[0], 0, 254), k = intIn(r[1], 1, 15), t = intIn(r[2], -1, 255), day = intIn(r[3], 0, 1e7);
    if (s === null || k === null || t === null || day === null) continue;
    pushWish(st, s, k, t, day);
  }
  if (Array.isArray(x.gift)) for (const r of x.gift.slice(0, 32)) {
    if (!Array.isArray(r)) continue;
    const ch = intIn(r[0], 0, CHAPTERS.length - 1), state = intIn(r[1], 1, 2), s = intIn(r[2], 0, 254), day = intIn(r[3], 0, 1e7);
    if (ch === null || state === null || s === null || day === null || !CHAPTERS[ch].gift || !GIFT_LISTS[ch]) continue;
    if (state > st.giftState[ch]) { st.giftState[ch] = state; st.giftSp[ch] = s; st.giftDay[ch] = day; }
  }
  sc[SC.GDAY] = intIn(x.gday, -1, 1e7) ?? -1;
  if (Array.isArray(x.fw)) { sc[SC.FW] = intIn(x.fw[0], 0, 2) ?? 0; sc[SC.WISHER] = intIn(x.fw[1], 0, 255) ?? NO; }
  sc[SC.SG] = (intIn(x.sg, 0, 0xffff) ?? 0);
  sc[SC.WG] = intIn(x.wg, 0, 1e6) ?? 0;
  sc[SC.DAY] = intIn(x.day, 0, 1e7) ?? 0;
  if (isObj(x.cur)) {
    sc[SC.CURP] = intIn(x.cur.p, 0, d.nPlaces - 1) ?? 0;
    const idx: number[] = [];
    if (Array.isArray(x.cur.party)) for (const v of x.cur.party.slice(0, PARTY_MAX)) { const k = okIdx(v); if (k !== null && !idx.includes(k)) idx.push(k); }
    setQuestParty(st, idx, idx.map(() => NO), idx.length);   // species come back with the shelf (reconcileJournalShelf)
  }
  // compact empty id slots away (an invalid id was kept as '' only so the indexes above stayed right)
  compactIds(j, (k) => j.ids[k] !== '');
  sc[SC.ST] = intIn(x.st, 0, 1000) ?? 0;
  forgetDropped(st, d);   // D-96: a save that names a dropped place's stamp, keepsake, visit or wish loads without it
  recountDerived(st, d);
  return j;
}
function popcount32(x: number): number { let n = 0; for (let i = 0; i < 32; i++) if (x & (1 << i)) n++; return n; }
function pushWish(st: QuestState, s: number, k: number, t: number, day: number): void {
  let n = st.sc[SC.WIN];
  for (let i = 0; i < n; i++) if (st.wiSp[i] === s) { for (let z = i; z < n - 1; z++) { st.wiSp[z] = st.wiSp[z + 1]; st.wiKind[z] = st.wiKind[z + 1]; st.wiTarget[z] = st.wiTarget[z + 1]; st.wiDay[z] = st.wiDay[z + 1]; } n--; break; }
  if (n >= WISH_KEPT) { for (let z = 0; z < n - 1; z++) { st.wiSp[z] = st.wiSp[z + 1]; st.wiKind[z] = st.wiKind[z + 1]; st.wiTarget[z] = st.wiTarget[z + 1]; st.wiDay[z] = st.wiDay[z + 1]; } n--; }
  st.wiSp[n] = s; st.wiKind[n] = k; st.wiTarget[n] = t; st.wiDay[n] = day;
  st.sc[SC.WIN] = n + 1;
}

/** Keep only the ids `keep` accepts, renumbering every field that names an id (warmth rows, the party, `real`). */
function compactIds(j: Journal, keep: (k: number) => boolean): void {
  const st = j.st;
  const map = new Int16Array(JOURNAL_IDS_MAX).fill(-1);
  const ids: string[] = [];
  const wm = st.wm.slice(), wmDay = st.wmDay.slice(), wmBits = st.wmBits.slice(), real = j.real.slice();
  for (let k = 0; k < j.ids.length; k++) if (keep(k)) { map[k] = ids.length; ids.push(j.ids[k]); }
  st.wm.fill(0); st.wmDay.fill(-1); st.wmBits.fill(0); j.real.fill(0);
  for (let k = 0; k < j.ids.length; k++) { const n = map[k]; if (n < 0) continue; st.wm[n] = wm[k]; st.wmDay[n] = wmDay[k]; st.wmBits[n] = wmBits[k]; j.real[n] = real[k]; }
  const pIdx: number[] = [], pSp: number[] = [];
  for (let s = 0; s < st.sc[SC.PARTYN]; s++) { const k = st.party[s]; if (k >= 0 && map[k] >= 0) { pIdx.push(map[k]); pSp.push(st.partySp[s]); } }
  setQuestParty(st, pIdx, pSp, pIdx.length);
  j.ids = ids;
}

/* ═══════════════════════════════════════ two tabs (CO-03): union or max, `cur` last writer ═══════════════════════════════════════ */

/** Merge `theirs` (the stored blob another tab wrote) into a copy of `ours`. Every field only grows or is a max; `cur` stays ours (this tab
 *  writes last). When the two `acct` tags differ, theirs' real-ledger rows are not taken (they belong to another account). */
export function mergeJournals(ours: Journal, theirs: Journal, d: QuestDefs): Journal {
  const out = cloneJournal(ours, d);
  const o = out.st, t = theirs.st;
  const acctClash = !!theirs.acct && !!ours.acct && theirs.acct !== ours.acct;
  if (!out.acct && theirs.acct) out.acct = theirs.acct;
  if (!out.dev && theirs.dev) out.dev = theirs.dev;
  for (let w = 0; w < 4; w++) o.done[w] |= t.done[w];
  for (let c = 0; c < d.nc; c++) {
    o.bits[c * 2] |= t.bits[c * 2]; o.bits[c * 2 + 1] |= t.bits[c * 2 + 1];
    if (d.cPair[c] >= 0) {
      const base = d.cPair[c] * PAIR_SET;
      let m = 0;
      while (m < PAIR_SET && o.pairs[base + m]) m++;
      for (let k = 0; k < PAIR_SET; k++) {
        const e = t.pairs[base + k];
        if (!e || m >= PAIR_SET) continue;
        let dup = false;
        for (let z = 0; z < m; z++) if (o.pairs[base + z] === e) dup = true;
        if (!dup) o.pairs[base + m++] = e;
      }
      o.cnt[c] = Math.min(d.cCount[c], Math.max(o.cnt[c], t.cnt[c], m));
    } else if (d.cDist[c] !== 0) o.cnt[c] = Math.min(d.cCount[c], Math.max(o.cnt[c], t.cnt[c], popcount32(o.bits[c * 2]) + popcount32(o.bits[c * 2 + 1])));
    else o.cnt[c] = Math.min(d.cCount[c], Math.max(o.cnt[c], t.cnt[c]));   // counters saturate at their target (core/quests.ts)
  }
  for (let s = 0; s < SPECIES_BITS; s++) o.fx[s] |= t.fx[s];
  for (let p = 0; p < o.pv.length; p++) o.pv[p] = Math.max(o.pv[p], t.pv[p]);
  const sc = o.sc, tc = t.sc;
  sc[SC.KS] |= tc[SC.KS]; sc[SC.PL] |= tc[SC.PL]; sc[SC.SG] |= tc[SC.SG]; sc[SC.BF] |= tc[SC.BF];
  sc[SC.WG] = Math.max(sc[SC.WG], tc[SC.WG]); sc[SC.GDAY] = Math.max(sc[SC.GDAY], tc[SC.GDAY]); sc[SC.DAY] = Math.max(sc[SC.DAY], tc[SC.DAY]);
  if (tc[SC.FW] > sc[SC.FW]) sc[SC.FW] = tc[SC.FW];
  if (sc[SC.WISHER] === NO) sc[SC.WISHER] = tc[SC.WISHER];
  sc[SC.ST] = Math.max(sc[SC.ST], tc[SC.ST]);
  // friendship: max per pair; today's points: the later day, or the max on the same day
  const sameDay = sc[SC.FDDAY] === tc[SC.FDDAY];
  if (tc[SC.FDDAY] > sc[SC.FDDAY]) { o.frDay.fill(0); sc[SC.FDDAY] = tc[SC.FDDAY]; }
  for (let r = 0; r < tc[SC.FRN]; r++) {
    const lo = t.frLo[r], hi = t.frHi[r];
    let k = -1;
    for (let z = 0; z < sc[SC.FRN]; z++) if (o.frLo[z] === lo && o.frHi[z] === hi) { k = z; break; }
    if (k < 0) {
      if (sc[SC.FRN] < o.frLo.length) { k = sc[SC.FRN]++; o.frLo[k] = lo; o.frHi[k] = hi; o.frPts[k] = 0; o.frDay[k] = 0; }
      else {
        let worst = -1;
        for (let z = 0; z < sc[SC.FRN]; z++) if (o.frPts[z] < FRIENDSHIP.friends && !isBestPair(d, o.frLo[z], o.frHi[z]) && (worst < 0 || o.frPts[z] < o.frPts[worst])) worst = z;
        if (worst < 0 || o.frPts[worst] >= t.frPts[r]) continue;
        k = worst; o.frLo[k] = lo; o.frHi[k] = hi; o.frPts[k] = 0; o.frDay[k] = 0;
      }
    }
    o.frPts[k] = Math.max(o.frPts[k], t.frPts[r]);
    if (sameDay || tc[SC.FDDAY] === sc[SC.FDDAY]) o.frDay[k] = Math.max(o.frDay[k], t.frDay[r]);
  }
  // warmth by id (max), the ids' union, real flags (by id)
  for (let k = 0; k < theirs.ids.length; k++) {
    if (acctClash && theirs.real[k]) continue;
    const id = theirs.ids[k];
    const has = out.ids.indexOf(id);
    if (has < 0 && t.wm[k] === 0 && t.wmBits[k] === 0 && !theirs.real[k]) { if (out.ids.length < JOURNAL_IDS_MAX) journalIdIndex(out, id, true); continue; }
    const n = has >= 0 ? has : journalIdIndex(out, id, true);
    if (n < 0) continue;
    o.wm[n] = Math.max(o.wm[n], t.wm[k]);
    if (t.wmDay[k] > o.wmDay[n]) { o.wmDay[n] = t.wmDay[k]; o.wmBits[n] = t.wmBits[k]; }
    else if (t.wmDay[k] === o.wmDay[n]) o.wmBits[n] = (Math.max(o.wmBits[n] & 3, t.wmBits[k] & 3)) | ((o.wmBits[n] | t.wmBits[k]) & 12);
    if (theirs.real[k]) out.real[n] = 1;
  }
  // wishes: the newest WISH_KEPT of the union, one per species (ours win a tie)
  const wl: { s: number; k: number; t: number; day: number; ord: number }[] = [];
  for (let i = 0; i < tc[SC.WIN]; i++) wl.push({ s: t.wiSp[i], k: t.wiKind[i], t: t.wiTarget[i], day: t.wiDay[i], ord: i });
  for (let i = 0; i < sc[SC.WIN]; i++) wl.push({ s: o.wiSp[i], k: o.wiKind[i], t: o.wiTarget[i], day: o.wiDay[i], ord: 100 + i });
  wl.sort((a, b) => a.day - b.day || a.ord - b.ord);
  sc[SC.WIN] = 0;
  for (const w of wl) pushWish(o, w.s, w.k, w.t, w.day);
  // gifts: max state per chapter
  for (let ch = 0; ch < o.giftState.length; ch++) {
    if (t.giftState[ch] > o.giftState[ch]) { o.giftState[ch] = t.giftState[ch]; if (o.giftSp[ch] === NO) o.giftSp[ch] = t.giftSp[ch]; }
    if (o.giftDay[ch] < 0 || (t.giftDay[ch] >= 0 && t.giftDay[ch] < o.giftDay[ch])) o.giftDay[ch] = t.giftDay[ch];
  }
  recountDerived(o, d);
  return out;
}

export function cloneJournal(j: Journal, d: QuestDefs): Journal {
  const st = createQuestState(d);
  const s = j.st;
  st.sc.set(s.sc); st.done.set(s.done); st.cnt.set(s.cnt); st.bits.set(s.bits); st.pairs.set(s.pairs); st.fx.set(s.fx); st.pv.set(s.pv);
  st.frLo.set(s.frLo); st.frHi.set(s.frHi); st.frPts.set(s.frPts); st.frDay.set(s.frDay); st.wm.set(s.wm); st.wmDay.set(s.wmDay); st.wmBits.set(s.wmBits);
  st.party.set(s.party); st.partySp.set(s.partySp); st.wiSp.set(s.wiSp); st.wiKind.set(s.wiKind); st.wiTarget.set(s.wiTarget); st.wiDay.set(s.wiDay);
  st.giftState.set(s.giftState); st.giftSp.set(s.giftSp); st.giftDay.set(s.giftDay);
  return { dev: j.dev, acct: j.acct, ids: j.ids.slice(), real: j.real.slice(), st };
}

/* ═══════════════════════════════════════ the shelf: backfill, ids by ledger, warmth across merges, accounts ═══════════════════════════════════════ */

/** The part of a Hoard item the journal reads. */
export interface ShelfItem { readonly id: string; readonly speciesIdx: number; readonly ledger: Ledger; readonly parents?: readonly string[] }

/**
 * The backfill (`bf`, once; QUESTS 13, CO-04): F0 for every owned species; H1, H3 and H4 done when the shelf shows them (at least one capsule
 * opened, or two or more owned). Returns true when it ran. Its stamps land without a quest moment (the caller drops `out`).
 */
export function backfillJournal(j: Journal, d: QuestDefs, items: readonly ShelfItem[], opened: number, out: QuestOut): boolean {
  if (j.st.sc[SC.BF]) return false;
  for (const it of items) if (it.speciesIdx >= 0) markFact(j.st, it.speciesIdx, FACT.MET);
  if (opened >= 1 || items.length >= 2) for (const id of ['H1', 'H3', 'H4']) { const q = d.quests.findIndex((x) => x.id === id); if (q >= 0) markDone(j.st, d, q, out); }
  j.st.sc[SC.BF] = 1;
  return true;
}

/**
 * At load, against the Hoard (CO-06, CO-10): first move (max) the warmth of every id that left the shelf to the blend row that names it as a
 * parent (a merge whose journal write lagged the hoard's never lowers warmth); then drop the warmth rows and party entries of ids no longer
 * on the shelf; classify every id by its Hoard item's ledger (never by its prefix); give the party its species back.
 */
export function reconcileJournalShelf(j: Journal, items: readonly ShelfItem[]): void {
  const byId = new Map<string, ShelfItem>();
  for (const it of items) byId.set(it.id, it);
  const st = j.st;
  for (let k = 0; k < j.ids.length; k++) {
    if (byId.has(j.ids[k]) || st.wm[k] === 0) continue;
    for (const it of items) {
      if (!it.parents || !it.parents.includes(j.ids[k])) continue;
      const n = journalIdIndex(j, it.id, true);
      if (n >= 0) st.wm[n] = Math.max(st.wm[n], st.wm[k]);
    }
  }
  for (let s = 0; s < st.sc[SC.PARTYN]; s++) { const k = st.party[s]; const it = k >= 0 ? byId.get(j.ids[k]) : undefined; st.partySp[s] = it ? it.speciesIdx : NO; }
  compactIds(j, (k) => byId.has(j.ids[k]));
  for (let k = 0; k < j.ids.length; k++) { const it = byId.get(j.ids[k]); j.real[k] = it && it.ledger !== 'practice' ? 1 : 0; }
  if (!j.real.some((x) => x === 1) && !j.acct) j.acct = null;
}

/** Sign-out or an account switch (COLLECTION 4, M25): the real-ledger entries leave unless they belong to `keepTag`; practice ids stay. */
export function forgetJournalAccount(j: Journal, keepTag: string | null): void {
  if (j.acct !== null && keepTag !== null && j.acct === keepTag) return;
  compactIds(j, (k) => !j.real[k]);
  j.acct = keepTag;
}

/* ═══════════════════════════════════════ the read model ═══════════════════════════════════════ */

const KIND_NAMES = ['main', 'finale', 'bonus'] as const;
export function journalView(j: Journal, d: QuestDefs, storage: StorageReport, giftsAllowed = true): JournalView {
  const st = j.st, sc = st.sc;
  const prog = new Int32Array(2);
  const quests = d.quests.map((q, i) => {
    questProgress(st, d, i, prog);
    return { idx: i, id: q.id, chapter: q.chapter, kind: KIND_NAMES[d.qKind[i]], shown: isShown(d, i), open: questOpen(st, d, i), done: isDone(st, i), have: prog[0], need: prog[1],
      keys: hasKeys(d, i), needsAutonomy: needsAutonomy(d, i) };
  });
  const friends: JournalView['friends'] = [];
  for (let r = 0; r < sc[SC.FRN]; r++) friends.push({ a: st.frLo[r], b: st.frHi[r], points: st.frPts[r], level: friendLevel(st.frPts[r]), best: isBestPair(d, st.frLo[r], st.frHi[r]) });
  const wishes: JournalView['wishes'] = [];
  for (let k = 0; k < sc[SC.WIN]; k++) wishes.push({ species: st.wiSp[k], kind: st.wiKind[k], target: st.wiTarget[k], day: st.wiDay[k] });
  const gifts: JournalView['gifts'] = [];
  for (let ch = 0; ch < CHAPTERS.length; ch++) {
    if (st.giftState[ch]) gifts.push({ chapter: ch, state: st.giftState[ch] === 2 ? 'granted' : 'pending', species: st.giftSp[ch], day: st.giftDay[ch] });
    else if (giftReady(st, ch)) gifts.push({ chapter: ch, state: 'ready', species: NO, day: -1 });
  }
  return {
    stamps: sc[SC.ST], places: sc[SC.PL], friendsOpen: chapterOpen(st, CHAPTERS.length - 1), quests, facts: Array.from(st.fx), keepsakes: sc[SC.KS] >>> 0,
    friends, wishes, firstWish: sc[SC.FW], wisher: sc[SC.WISHER], gifts, giftsAllowed, tracker: (place, key, auto) => trackerQuest(st, d, place, key, auto), storage,
  };
}
/** Re-exported for the store and the probes. */
export { finaleOpen };
