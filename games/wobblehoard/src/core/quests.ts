// PLAYGROUND Journal: the pure quest reducer (_spec/QUESTS.md 3 to 11; _spec/PLAYGROUND_BUILD.md 12; brief _handoff/briefs/PG_QUESTS.md).
//
//   buildQuestDefs(input)                       compile the 110 rules of src/data/quests.ts against the shipped places (once per build or ship)
//   createQuestState(defs)                      a fresh state: every field a typed array, so applying an event allocates nothing
//   applyPlayEvent(st, ring, i, defs, out)      apply ring record i; returns how many output records `out` now holds
//
// Rules this file keeps:
//   * PURE: no clock (the UTC day is injected with setQuestDay), no random source, no DOM, no meter, no capsule and no squish point. It imports
//     only ./rng.ts, ../data/quests.ts, ../data/life.ts, ../data/catalog.ts and types (it loads first in a fresh node process: probe_genome).
//   * ALLOCATION-FREE after warm-up (QU-01): the state, the defs and the output are typed arrays; derived events (FRIEND, DISCOVER and the
//     first wish's grant) go through the same scalar function, never through an object.
//   * NOTHING GOES DOWN (Q1, Q9, QU-10, CS-13): counters, bitsets, stamps, facts, keepsakes, places, warmth and friendship only grow (a counter
//     is capped, never decremented); there is no within-visit clause, no timer and no calendar gate on content (gifts are not content: their
//     one-a-day rule is the claim's, in the collection).
//   * A by-SELF clause also accepts a by-PLAYER record that carries EV_FLAG.AUTONOMY_OFF (QUESTS 5, D-79).
//   * Only shown quests count (D-78): a quest whose clause needs an unshipped place, or an event no shipped place can produce, is hidden; a
//     finale is shown once its chapter has 5 shown main quests. Ring records of the derived kinds (FRIEND, DISCOVER) are ignored: only this
//     reducer makes them.
import type { PlayEventRing } from '../contracts.ts';
import { CATALOG } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import { FRIENDSHIP, SOCIAL, SOCIAL_KIND, SPECIES_LIFE, USE_VERB, WARMTH, WISH_KIND, TOUCH, REACT_KIND } from '../data/life.ts';
import {
  BY, CHAPTERS, EV, EV_FLAG, FACT, FACT_REACTS, FINALE_AT, FRIEND_LEVEL, GIFT, GIFT_LISTS, KEEPSAKES, KEEP_BY, PIECES_USE, QUESTS, WISH_RULES, WISH_STATE,
} from '../data/quests.ts';
import type { QuestDef } from '../data/quests.ts';

/* ═══════════════════════════════════════ sizes ═══════════════════════════════════════ */

/** Species bitsets are 64 bits (QUESTS 5); fact masks are kept for species idx 0..63. */
export const SPECIES_BITS = 64;
/** Places 16 bits, things 64 bits, parts 8 bits, families 16 bits (QUESTS 5). */
export const PLACE_BITS = 16;
/** A `distinct 'pair'` clause keeps a hash set of at most this many pairs (QUESTS 5). */
export const PAIR_SET = 32;
/** Friendship rows (LIFE 6.2: at most 128 of 1225). */
export const FR_ROWS = FRIENDSHIP.maxRows;
/** Warmth rows: one per item id the journal names (PLAYGROUND_BUILD 12: at most 100, the shelf cap). */
export const WM_ROWS = 100;
/** Party slots the journal maps to item ids (LIFE 10.4: at most 16 characters). */
export const PARTY_MAX = 16;
/** Resting wishes kept (QUESTS 8). */
export const WISH_KEPT = WISH_RULES.kept;
/** Chapters (11) and the gift rows by chapter. */
export const CHAPTER_COUNT = CHAPTERS.length;
const NO = 255;
/** A press under this many seconds is a tap, never a squeeze (DESIGN 5.4; core/meter.ts PAY.minSqueezeHoldSeconds): no TOUCH clause ever
 *  counts it (QUESTS Q3, QU-03), whatever the clause says. */
export const SQUEEZE_MIN_S = 0.4;

/** The scalar slots of QuestState.sc. */
export const SC = {
  PL: 0,        // places open (bit per place idx)
  ST: 1,        // stamps (quests done)
  KS: 2,        // keepsakes (bit per keepsake)
  FW: 3,        // the scripted first wish: 0 not shown, 1 shown, 2 granted (H8)
  WISHER: 4,    // the first wish's wisher species (255 = none: it rested in the Journal at 5:00)
  SG: 5,        // places where a song happened (bit per place idx; the Songbook)
  WG: 6,        // wishes come true (the Wish Jar)
  DAY: 7,       // the injected UTC day (setQuestDay)
  FDDAY: 8,     // the day frDay counts
  GDAY: 9,      // the last gift claim's day (-1 none)
  FRN: 10,      // friendship rows in use
  WIN: 11,      // resting wishes in use
  BF: 12,       // the backfill ran (1)
  CURP: 13,     // the current place idx
  GOLD: 14,     // gold-edged pages (F0..F10 all found)
  VSEQ: 15,     // visits so far this session (the first wish's dedupe)
  FWVSEQ: 16,   // VSEQ of the first wish's grant
  PARTYN: 17,   // party slots in use
} as const;

/* ═══════════════════════════════════════ the compiled rules ═══════════════════════════════════════ */

/** What a place can produce (QU-14): a bit per REACT kind (1..23), SOCIAL kind (1..19) and USE verb (1..15). */
export interface PlaceCaps { readonly reacts: number; readonly socials: number; readonly verbs: number }
/** Input of buildQuestDefs: the place and thing id tables (src/data/places.ts PLACE_IDS, THING_IDS), which places have shipped, the stamps
 *  each place opens at (0 = at the start, -1 = when the first wish shows), each thing's place idx, and each place's caps. */
export interface QuestDefsInput {
  readonly placeIds: readonly string[];
  readonly thingIds: readonly string[];
  readonly shipped: readonly boolean[];
  readonly opensAt: readonly number[];
  readonly thingPlace: readonly number[];
  readonly caps: readonly PlaceCaps[];
}

const DIST = { none: 0, species: 1, family: 2, thing: 3, part: 4, pair: 5, place: 6 } as const;
const DIST_OF: Readonly<Record<string, number>> = { species: 1, family: 2, thing: 3, part: 4, pair: 5, place: 6 };
const QK = { main: 0, finale: 1, bonus: 2 } as const;

export interface QuestDefs {
  readonly nq: number;
  readonly nc: number;
  readonly quests: readonly QuestDef[];
  /** per quest: first clause index (nq + 1 entries), chapter, kind (0 main, 1 finale, 2 bonus) */
  readonly qFirst: Uint16Array;
  readonly qChapter: Uint8Array;
  readonly qKind: Uint8Array;
  /** per clause */
  readonly cQuest: Uint16Array;
  readonly cEv: Uint8Array;
  readonly cSub: Uint32Array;     // 3 words per clause: a bit per sub id 0..95; all zero = any
  readonly cPlace: Int16Array;    // -1 any, -2 away, else the place idx
  readonly cThing: Int16Array;    // -1 any
  readonly cFam: Int16Array;      // -1 any
  readonly cMinN: Uint8Array;
  readonly cBy: Int8Array;        // -1 any, 0 SELF, 1 PLAYER
  readonly cCount: Uint16Array;
  readonly cDist: Uint8Array;
  readonly cSame: Uint8Array;
  readonly cV: Float32Array;      // NaN = none
  readonly cFlag: Uint8Array;
  readonly cPair: Int16Array;     // the pair-set slot of a distinct 'pair' clause, else -1
  readonly nPairSlots: number;
  /** clauses by event kind: evList[evFirst[k] .. evFirst[k + 1]) */
  readonly evFirst: Uint16Array;
  readonly evList: Uint16Array;
  /** quest bitsets (4 words): shown (D-78); keyboard-completable (QU-09; K and K*); blocked with autonomy off (QU-16) */
  readonly shown: Uint32Array;
  readonly keys: Uint32Array;
  readonly keyStar: Uint32Array;
  readonly needsAuto: Uint32Array;
  /** places */
  readonly nPlaces: number;
  readonly placeShipped: number;  // bit per place
  readonly opensAt: Int16Array;
  /** species tables (by species idx, 255 / -1 = none) */
  readonly spFavPlace: Uint8Array;
  readonly spFavThing: Int16Array;
  readonly spFriend: Uint8Array;
  /** friendship points per SOCIAL kind (LIFE 6.1) */
  readonly socialPoints: Uint8Array;
  readonly thingPlace: Uint8Array;
}

/** The keyboard routes (QU-09, PLAYGROUND_BUILD 11.8, D-77, D-93): which records a keyboard player can cause. Space on the focused squishy
 *  (a squeeze, and a squirt from a soaked foam), the keyboard stretch (K*), "Go play with..." (a use and the rides), "Tap it yourself" (every
 *  switch, ball and thing a tap swings, part by part), Enter on a showing bubble, the Wishes now list, the Cut bar, the shutter, Travel; and
 *  everything LIFE does by itself. Not reachable by key: a toss (no keyboard toss). Returns 0 no route, 1 a route, 2 only the stretch (K*). */
export function keyRoute(ev: number, sub: number): number {
  if (ev === EV.TOUCH) return sub === TOUCH.SQUEEZE || sub === TOUCH.SQUEEZE_1S ? 1 : sub === TOUCH.STRETCH || sub === TOUCH.STRETCH_06 ? 2 : 0;
  return 1;
}
/** With "Squishies move on their own" off (LIFE 5.6, D-79): LIFE issues no hop, scoot or glide except a use the player asked for and a ride the
 *  player set up. These moments need a squishy to walk or hop on its own, so a clause that names only them is blocked (QU-16). */
const AUTO_ONLY_SOCIAL = (1 << SOCIAL_KIND.BOOP) | (1 << SOCIAL_KIND.NUZZLE) | (1 << SOCIAL_KIND.COPY) | (1 << SOCIAL_KIND.PARADE) | (1 << SOCIAL_KIND.SNUGGLE)
  | (1 << SOCIAL_KIND.PASS) | (1 << SOCIAL_KIND.PEEK) | (1 << SOCIAL_KIND.COMFORT);
export const AUTONOMY_ONLY_SOCIALS = AUTO_ONLY_SOCIAL;

const subBit = (m: Uint32Array, c: number, s: number): boolean => s < 96 && (m[c * 3 + (s >>> 5)] & (1 << (s & 31))) !== 0;
const subAny = (m: Uint32Array, c: number): boolean => (m[c * 3] | m[c * 3 + 1] | m[c * 3 + 2]) === 0;

/** Compile the rules (D-78's shown set, QU-09's keyboard set, QU-16's autonomy set and the lookup tables). Allocates; call once per build or
 *  when a place ships. */
export function buildQuestDefs(input: QuestDefsInput, quests: readonly QuestDef[] = QUESTS): QuestDefs {
  const nq = quests.length;
  let nc = 0;
  for (const q of quests) nc += q.clauses.length;
  const qFirst = new Uint16Array(nq + 1), qChapter = new Uint8Array(nq), qKind = new Uint8Array(nq);
  const cQuest = new Uint16Array(nc), cEv = new Uint8Array(nc), cSub = new Uint32Array(nc * 3), cPlace = new Int16Array(nc), cThing = new Int16Array(nc);
  const cFam = new Int16Array(nc), cMinN = new Uint8Array(nc), cBy = new Int8Array(nc), cCount = new Uint16Array(nc), cDist = new Uint8Array(nc);
  const cSame = new Uint8Array(nc), cV = new Float32Array(nc), cFlag = new Uint8Array(nc), cPair = new Int16Array(nc);
  let nPairSlots = 0;
  let c = 0;
  for (let qi = 0; qi < nq; qi++) {
    const q = quests[qi];
    if (q.idx !== qi) throw new Error(`quest ${q.id}: idx ${q.idx} is not its position ${qi}`);
    qFirst[qi] = c; qChapter[qi] = q.chapter; qKind[qi] = QK[q.kind];
    for (const cl of q.clauses) {
      cQuest[c] = qi; cEv[c] = cl.ev;
      if (cl.sub) for (const s of cl.sub) if (s >= 0 && s < 96) cSub[c * 3 + (s >>> 5)] |= 1 << (s & 31);
      cPlace[c] = cl.place === undefined ? -1 : cl.place === 'away' ? -2 : cl.place;
      cThing[c] = cl.thing ?? -1; cFam[c] = cl.family ?? -1; cMinN[c] = cl.minN ?? 0; cBy[c] = cl.by ?? -1; cCount[c] = cl.count;
      cDist[c] = cl.distinct ? DIST_OF[cl.distinct] : 0; cSame[c] = cl.sameSpecies ? 1 : 0; cV[c] = cl.v ?? NaN; cFlag[c] = cl.flag ?? 0;
      cPair[c] = cl.distinct === 'pair' ? nPairSlots++ : -1;
      c++;
    }
  }
  qFirst[nq] = c;
  // clauses by event kind
  const evFirst = new Uint16Array(34), evList = new Uint16Array(nc);
  const counts = new Uint16Array(33);
  for (let k = 0; k < nc; k++) counts[cEv[k]]++;
  for (let e = 0; e < 33; e++) evFirst[e + 1] = evFirst[e] + counts[e];
  const fill = evFirst.slice(0, 33);
  for (let k = 0; k < nc; k++) evList[fill[cEv[k]]++] = k;
  // places
  const nPlaces = input.placeIds.length;
  let placeShipped = 0;
  const opensAt = new Int16Array(PLACE_BITS);
  for (let p = 0; p < nPlaces && p < PLACE_BITS; p++) { if (input.shipped[p]) placeShipped |= 1 << p; opensAt[p] = input.opensAt[p]; }
  const thingPlace = new Uint8Array(input.thingIds.length);
  for (let t = 0; t < thingPlace.length; t++) thingPlace[t] = input.thingPlace[t] ?? NO;
  // species tables
  const spFavPlace = new Uint8Array(SPECIES_BITS).fill(NO), spFavThing = new Int16Array(SPECIES_BITS).fill(-1), spFriend = new Uint8Array(SPECIES_BITS).fill(NO);
  const idxOf = new Map<string, number>(CATALOG.map((d) => [d.id, d.idx] as [string, number]));
  for (const d of CATALOG) {
    if (d.idx >= SPECIES_BITS) continue;
    const life = (SPECIES_LIFE as Readonly<Record<string, { place: string; thing: string; friend: string }>>)[d.id];
    if (!life) continue;
    spFavPlace[d.idx] = Math.max(0, input.placeIds.indexOf(life.place));
    spFavThing[d.idx] = input.thingIds.indexOf(life.thing);
    spFriend[d.idx] = idxOf.get(life.friend) ?? NO;
  }
  const socialPoints = new Uint8Array(32);
  for (const s of SOCIAL) socialPoints[s.kind] = s.points;
  // shown, keys, needsAuto (D-78, QU-09, QU-16)
  const shown = new Uint32Array(4), keys = new Uint32Array(4), keyStar = new Uint32Array(4), needsAuto = new Uint32Array(4);
  const placesFor = (k: number): number => {
    // the places (bit mask) where clause k's event can happen, among the shipped ones
    let m = placeShipped;
    const pl = cPlace[k];
    if (pl >= 0) m &= 1 << pl; else if (pl === -2) m &= ~1;
    if (cThing[k] >= 0) { const tp = thingPlace[cThing[k]]; m &= tp === NO ? 0 : 1 << tp; }
    const ev = cEv[k];
    let can = 0;
    for (let p = 0; p < nPlaces; p++) {
      if (!(m & (1 << p))) continue;
      const cap = input.caps[p] ?? { reacts: 0, socials: 0, verbs: 0 };
      let ok = true;
      if (ev === EV.REACT || ev === EV.PIECES || ev === EV.SOCIAL || (ev === EV.USE && cThing[k] < 0)) {
        if (ev === EV.USE) ok = subAny(cSub, k) ? cap.verbs !== 0 : (cap.verbs & subMask32(cSub, k, 0)) !== 0;
        else if (ev === EV.SOCIAL) ok = subAny(cSub, k) ? cap.socials !== 0 : (cap.socials & subMask32(cSub, k, 0)) !== 0;
        else if (ev === EV.REACT) ok = subAny(cSub, k) ? cap.reacts !== 0 : (cap.reacts & subMask32(cSub, k, 0)) !== 0;
        else { // PIECES: a REACT kind, or PIECES_USE + a verb
          const r = subMask32(cSub, k, 0), u = subMask32(cSub, k, PIECES_USE);
          ok = subAny(cSub, k) ? cap.reacts !== 0 || cap.verbs !== 0 : (cap.reacts & r) !== 0 || (cap.verbs & u) !== 0;
        }
      }
      if (ev === EV.DISCOVER && subBit(cSub, k, FACT.PLACE)) ok = ok && (cap.reacts & (1 << REACT_KIND.LOVE)) !== 0;
      if (ev === EV.WISH && cV[k] === WISH_KIND.PLACE) ok = ok && p !== 0;   // a place wish is granted by arriving at another place
      if (ok) can |= 1 << p;
    }
    return can;
  };
  const popc = (x: number): number => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
  const completable = new Uint8Array(nq);
  for (let qi = 0; qi < nq; qi++) {
    const ch = quests[qi].chapter;
    const chPlace = CHAPTERS[ch].place;
    let ok = chPlace < 0 || (placeShipped & (1 << chPlace)) !== 0;
    let key = 2, auto = false;
    for (let k = qFirst[qi]; k < qFirst[qi + 1] && ok; k++) {
      const can = placesFor(k);
      ok = cDist[k] === DIST.place ? popc(can) >= cCount[k] : can !== 0;
      // keyboard: every clause needs a route; K* if one needs the stretch
      let route = 0;
      if (subAny(cSub, k)) route = keyRoute(cEv[k], -1);
      else for (let s = 0; s < 96; s++) if (subBit(cSub, k, s)) { const r = keyRoute(cEv[k], s); if (r === 1) { route = 1; break; } if (r === 2) route = 2; }
      if (route === 0) key = 0; else if (route === 2 && key === 2) key = 1;
      // autonomy off: a SOCIAL clause whose every allowed kind needs autonomy
      if (cEv[k] === EV.SOCIAL && !subAny(cSub, k) && (subMask32(cSub, k, 0) & ~AUTO_ONLY_SOCIAL) === 0) auto = true;
    }
    completable[qi] = ok ? 1 : 0;
    if (key >= 1) keys[qi >>> 5] |= 1 << (qi & 31);             // K or K* (K* is a keyboard route too: the stretch)
    if (key === 1) keyStar[qi >>> 5] |= 1 << (qi & 31);
    if (auto) needsAuto[qi >>> 5] |= 1 << (qi & 31);
  }
  for (let qi = 0; qi < nq; qi++) {
    let ok = completable[qi] === 1;
    if (ok && qKind[qi] === QK.finale && quests[qi].chapter !== 0) {
      let mains = 0;
      for (let j = 0; j < nq; j++) if (qChapter[j] === qChapter[qi] && qKind[j] === QK.main && completable[j]) mains++;
      ok = mains >= FINALE_AT;
    }
    if (ok) shown[qi >>> 5] |= 1 << (qi & 31);
  }
  return {
    nq, nc, quests, qFirst, qChapter, qKind, cQuest, cEv, cSub, cPlace, cThing, cFam, cMinN, cBy, cCount, cDist, cSame, cV, cFlag, cPair, nPairSlots,
    evFirst, evList, shown, keys, keyStar, needsAuto, nPlaces, placeShipped, opensAt, spFavPlace, spFavThing, spFriend, socialPoints, thingPlace,
  };
}
/** The clause's sub ids base..base + 31 as a 32-bit mask (sub ids 0..31 for REACT, SOCIAL and USE). */
function subMask32(m: Uint32Array, c: number, base: number): number {
  let out = 0;
  for (let s = 0; s < 32; s++) if (subBit(m, c, base + s)) out |= 1 << s;
  return out;
}

/* ═══════════════════════════════════════ the state ═══════════════════════════════════════ */

export interface QuestState {
  readonly sc: Int32Array;
  /** 128-bit done set */
  readonly done: Uint32Array;
  /** per clause: the counter (for a distinct clause, the distinct count) and a 64-bit set (distinct items, or sameSpecies species) */
  readonly cnt: Uint16Array;
  readonly bits: Uint32Array;
  /** pair sets: PAIR_SET keys per slot (key = lo * 256 + hi + 1; 0 = empty) */
  readonly pairs: Uint32Array;
  /** fact mask per species idx */
  readonly fx: Uint16Array;
  /** visits per place idx */
  readonly pv: Uint16Array;
  /** friendship rows: lo, hi species, points (multiples of 0.5), today's points */
  readonly frLo: Uint8Array;
  readonly frHi: Uint8Array;
  readonly frPts: Float32Array;
  readonly frDay: Float32Array;
  /** warmth by the journal's item index: points 0..50, the day of `wmBits`, today's gains (bits 0-1 loved touches, 2 favourite visit, 3 nap) */
  readonly wm: Uint8Array;
  readonly wmDay: Int32Array;
  readonly wmBits: Uint8Array;
  /** the party: the journal's item index and species of each slot */
  readonly party: Int16Array;
  readonly partySp: Uint8Array;
  /** resting wishes, oldest first: species, kind, target, day */
  readonly wiSp: Uint8Array;
  readonly wiKind: Uint8Array;
  readonly wiTarget: Int16Array;
  readonly wiDay: Int32Array;
  /** gifts by chapter: 0 none, 1 pending, 2 granted; the picked species; the claim's day */
  readonly giftState: Uint8Array;
  readonly giftSp: Uint8Array;
  readonly giftDay: Int32Array;
}

export function createQuestState(defs: QuestDefs): QuestState {
  const sc = new Int32Array(24);
  sc[SC.PL] = 1;                 // Home is open at the start
  sc[SC.WISHER] = NO;
  sc[SC.GDAY] = -1;
  sc[SC.FDDAY] = -1;
  sc[SC.DAY] = 0;
  return {
    sc, done: new Uint32Array(4), cnt: new Uint16Array(defs.nc), bits: new Uint32Array(defs.nc * 2), pairs: new Uint32Array(Math.max(1, defs.nPairSlots) * PAIR_SET),
    fx: new Uint16Array(SPECIES_BITS), pv: new Uint16Array(PLACE_BITS),
    frLo: new Uint8Array(FR_ROWS), frHi: new Uint8Array(FR_ROWS), frPts: new Float32Array(FR_ROWS), frDay: new Float32Array(FR_ROWS),
    wm: new Uint8Array(WM_ROWS), wmDay: new Int32Array(WM_ROWS).fill(-1), wmBits: new Uint8Array(WM_ROWS),
    party: new Int16Array(PARTY_MAX).fill(-1), partySp: new Uint8Array(PARTY_MAX).fill(NO),
    wiSp: new Uint8Array(WISH_KEPT), wiKind: new Uint8Array(WISH_KEPT), wiTarget: new Int16Array(WISH_KEPT), wiDay: new Int32Array(WISH_KEPT),
    giftState: new Uint8Array(16), giftSp: new Uint8Array(16).fill(NO), giftDay: new Int32Array(16).fill(-1),
  };
}

/** Inject the UTC day (the collection's clock: Math.floor(nowMs / DAY_MS)). Today's friendship points reset when it changes. */
export function setQuestDay(st: QuestState, day: number): void {
  st.sc[SC.DAY] = day | 0;
}
/** The party as the journal maps it: item indexes (into the journal's `ids`) and species, slot by slot. */
export function setQuestParty(st: QuestState, idx: ArrayLike<number>, species: ArrayLike<number>, n: number): void {
  const m = n < PARTY_MAX ? n : PARTY_MAX;
  for (let i = 0; i < PARTY_MAX; i++) { st.party[i] = i < m ? idx[i] : -1; st.partySp[i] = i < m ? species[i] : NO; }
  st.sc[SC.PARTYN] = m;
}

/* ═══════════════════════════════════════ the output ═══════════════════════════════════════ */

/** Output record kinds (the collection turns them into its events `quest`, `fact`, `keepsake`, `friend`, `unlock`, `gift`). */
export const QOUT = { QUEST: 1, FACT: 2, KEEPSAKE: 3, FRIEND: 4, UNLOCK: 5, GIFT: 6, WARMTH: 7 } as const;
/** UNLOCK's a for Friends Everywhere (a chapter, not a place). */
export const UNLOCK_FRIENDS = 100;
/** QUEST: a = quest idx, b = chapter, by = the completing record's by (D-84: the haptic only when PLAYER). FACT: a = species, b = fact bit.
 *  KEEPSAKE: a = bit. FRIEND: a = lo, b = hi species, by = level. UNLOCK: a = place idx (or UNLOCK_FRIENDS). GIFT: a = chapter (its gift is
 *  ready). WARMTH: a = item index, b = new points. */
export interface QuestOut { n: number; dropped: number; readonly kind: Uint8Array; readonly a: Int16Array; readonly b: Int16Array; readonly by: Uint8Array }
export function createQuestOut(cap = 64): QuestOut {
  return { n: 0, dropped: 0, kind: new Uint8Array(cap), a: new Int16Array(cap), b: new Int16Array(cap), by: new Uint8Array(cap) };
}
function emit(out: QuestOut, kind: number, a: number, b: number, by: number): void {
  const i = out.n;
  if (i >= out.kind.length) { out.dropped++; return; }
  out.kind[i] = kind; out.a[i] = a; out.b[i] = b; out.by[i] = by;
  out.n = i + 1;
}

/* ═══════════════════════════════════════ queries ═══════════════════════════════════════ */

export const isDone = (st: QuestState, q: number): boolean => (st.done[q >>> 5] & (1 << (q & 31))) !== 0;
export const isShown = (d: QuestDefs, q: number): boolean => (d.shown[q >>> 5] & (1 << (q & 31))) !== 0;
export const hasKeys = (d: QuestDefs, q: number): boolean => (d.keys[q >>> 5] & (1 << (q & 31))) !== 0;
export const needsAutonomy = (d: QuestDefs, q: number): boolean => (d.needsAuto[q >>> 5] & (1 << (q & 31))) !== 0;
export const placeOpen = (st: QuestState, p: number): boolean => (st.sc[SC.PL] & (1 << p)) !== 0;

/** Finales done among the place chapters (0..9). */
export function finalesDone(st: QuestState): number {
  let n = 0;
  for (let ch = 0; ch < CHAPTER_COUNT; ch++) if (CHAPTERS[ch].place >= 0 && isDone(st, CHAPTERS[ch].finale)) n++;
  return n;
}
export function chapterOpen(st: QuestState, ch: number): boolean {
  const c = CHAPTERS[ch];
  if (c.opens === 'start') return true;
  if (c.opens === 'finales') return finalesDone(st) >= (c.n ?? 2);
  return c.place >= 0 && placeOpen(st, c.place);
}
export function mainsDone(st: QuestState, d: QuestDefs, ch: number): number {
  let n = 0;
  for (let q = 0; q < d.nq; q++) if (d.qChapter[q] === ch && d.qKind[q] === QK.main && isDone(st, q)) n++;
  return n;
}
/** QU-05: each finale opens at FINALE_AT of its chapter's 7 main quests; Home's when the scripted first wish shows. */
export function finaleOpen(st: QuestState, d: QuestDefs, ch: number): boolean {
  if (ch === 0) return st.sc[SC.FW] >= 1;
  return mainsDone(st, d, ch) >= FINALE_AT;
}
/** A quest counts events only while it is shown, its chapter is open and (a finale) the finale is open. */
export function questOpen(st: QuestState, d: QuestDefs, q: number): boolean {
  if (!isShown(d, q)) return false;
  const ch = d.qChapter[q];
  if (!chapterOpen(st, ch)) return false;
  return d.qKind[q] !== QK.finale || finaleOpen(st, d, ch);
}
/** The quest's progress for "2 of 3": the sum over its clauses of min(count, target), and the sum of the targets. */
export function questProgress(st: QuestState, d: QuestDefs, q: number, out: Int32Array): void {
  let have = 0, need = 0;
  for (let k = d.qFirst[q]; k < d.qFirst[q + 1]; k++) { const t = d.cCount[k]; need += t; have += isDone(st, q) ? t : Math.min(t, st.cnt[k]); }
  out[0] = have; out[1] = need;
}
/** "Needs: Squishies move on their own" (QU-16): shown, not done, and every route needs a squishy to move on its own. */
export const blockedByAutonomy = (st: QuestState, d: QuestDefs, q: number, autonomy: boolean): boolean => !autonomy && !isDone(st, q) && needsAutonomy(d, q);

/**
 * The tracker (SH-20, QUESTS 15): the first unfinished main quest that can be done now, of the current place's chapter, then Home's, then
 * Friends Everywhere's; never a hidden quest, one blocked by autonomy off, or (when the last input was a key) one without a keyboard route.
 * Returns the quest idx or -1.
 */
export function trackerQuest(st: QuestState, d: QuestDefs, place: number, lastInputKey: boolean, autonomy: boolean): number {
  let chHere = -1;
  for (let ch = 0; ch < CHAPTER_COUNT; ch++) if (CHAPTERS[ch].place === place) chHere = ch;
  const order0 = chHere, order1 = 0, order2 = CHAPTER_COUNT - 1;
  for (let o = 0; o < 3; o++) {
    const ch = o === 0 ? order0 : o === 1 ? order1 : order2;
    if (ch < 0 || (o === 1 && ch === order0) || !chapterOpen(st, ch)) continue;
    for (let q = 0; q < d.nq; q++) {
      if (d.qChapter[q] !== ch || d.qKind[q] !== QK.main || isDone(st, q) || !questOpen(st, d, q)) continue;
      if (blockedByAutonomy(st, d, q, autonomy) || (lastInputKey && !hasKeys(d, q)) || !doableAt(d, q, place)) continue;
      return q;
    }
  }
  return -1;
}
/** Can every clause of quest q happen at this place ("can be done now": a clause names no place or thing, or names this place or one of its
 *  things; 'away' is any place but Home)? */
export function doableAt(d: QuestDefs, q: number, place: number): boolean {
  for (let k = d.qFirst[q]; k < d.qFirst[q + 1]; k++) {
    const p = d.cPlace[k];
    if (p >= 0 && p !== place) return false;
    if (p === -2 && place === 0) return false;
    if (d.cThing[k] >= 0 && d.thingPlace[d.cThing[k]] !== place) return false;
  }
  return true;
}
/** Is the chapter's gift ready to claim (QUESTS 11, D-29): its finale done, the Home finale (H8) done, no gift row for it yet, fewer than 5
 *  gifts for life. The one-a-day and Practice-only rules are the claim's (the collection). */
export function giftReady(st: QuestState, ch: number): boolean {
  if (ch < 0 || ch >= CHAPTER_COUNT || !CHAPTERS[ch].gift || !GIFT_LISTS[ch]) return false;
  if (!isDone(st, CHAPTERS[ch].finale) || !isDone(st, CHAPTERS[0].finale)) return false;
  if (st.giftState[ch] !== 0) return false;
  return giftsForLife(st) < GIFT.lifetime;
}
export function giftsForLife(st: QuestState): number {
  let n = 0;
  for (let ch = 0; ch < st.giftState.length; ch++) if (st.giftState[ch] !== 0) n++;
  return n;
}

/* ═══════════════════════════════════════ the reducer ═══════════════════════════════════════ */

/** The record value `v` (a double) per recursion depth: passed through this buffer, never as an argument, so a non-integral value (a hold of
 *  0.5 s, a pull level) is never boxed by a call (QU-01). */
const VBUF = new Float64Array(8);

/** Apply ring record `i`. Returns out.n (the output records written so far: the caller resets out.n before a batch). Pure and allocation-free. */
export function applyPlayEvent(st: QuestState, ring: PlayEventRing, i: number, defs: QuestDefs, out: QuestOut): number {
  const kind = ring.kind[i];
  if (kind === EV.FRIEND || kind === EV.DISCOVER || kind === 0) return out.n;  // derived kinds come from this reducer only
  VBUF[0] = ring.v[i];
  step(st, defs, out, kind, ring.sub[i], ring.place[i], ring.thing[i], ring.a[i], ring.b[i], ring.fam[i], ring.n2[i], ring.by[i], ring.flag[i], 0);
  return out.n;
}

/** The same as applyPlayEvent with the record's fields as numbers (the probes' event scripts and the journal's own GIFT record). */
export function applyEventFields(st: QuestState, defs: QuestDefs, out: QuestOut, kind: number, sub: number, place: number, thing: number, a: number, b: number,
  fam: number, n2: number, by: number, flag: number, v: number): number {
  if (kind === EV.FRIEND || kind === EV.DISCOVER || kind === 0) return out.n;
  VBUF[0] = v;
  step(st, defs, out, kind, sub, place, thing, a, b, fam, n2, by, flag, 0);
  return out.n;
}
/** A derived record (FRIEND, DISCOVER, the first wish's grant) one level deeper. */
function derive(st: QuestState, d: QuestDefs, out: QuestOut, kind: number, sub: number, place: number, thing: number, a: number, b: number, fam: number,
  n2: number, by: number, flag: number, v: number, depth: number): void {
  if (depth + 1 >= VBUF.length) return;
  VBUF[depth + 1] = v;
  step(st, d, out, kind, sub, place, thing, a, b, fam, n2, by, flag, depth + 1);
}

function step(st: QuestState, d: QuestDefs, out: QuestOut, kind: number, sub: number, place: number, thing: number, a: number, b: number, fam: number,
  n2: number, by: number, flag: number, depth: number): void {
  const sc = st.sc;
  const v = VBUF[depth];
  if (sc[SC.FDDAY] !== sc[SC.DAY]) { sc[SC.FDDAY] = sc[SC.DAY]; st.frDay.fill(0); }
  // 1. the state each kind keeps besides its clauses
  switch (kind) {
    case EV.VISIT:
      if (place < PLACE_BITS) { if (st.pv[place] < 65535) st.pv[place]++; }
      sc[SC.VSEQ]++;
      sc[SC.CURP] = place;
      // H8 (QU-15): the first wish is granted by the first arrival at Hearthlog Cabin with any party, whoever wished it
      if (place === 1 && sc[SC.FW] === 1) {
        sc[SC.FW] = 2; sc[SC.FWVSEQ] = sc[SC.VSEQ];
        derive(st, d, out, EV.WISH, WISH_STATE.GRANTED, 1, -1, sc[SC.WISHER], NO, NO, 0, by, flag, WISH_KIND.PLACE, depth);   // by: the trip's (the player's, from Travel)
      }
      break;
    case EV.BRING:
      fact(st, d, out, a, FACT.MET, place, by, depth);
      if (a < SPECIES_BITS && d.spFavPlace[a] === place && place !== 0) warmSpecies(st, out, a, WARMTH.favPlace, 4);
      break;
    case EV.CAPSULE: case EV.GIFT:
      fact(st, d, out, a, FACT.MET, place, by, depth);
      break;
    case EV.REACT: case EV.PIECES: {
      const r = kind === EV.PIECES && sub >= PIECES_USE ? -1 : sub;
      if (r === REACT_KIND.LOVE) fact(st, d, out, a, FACT.PLACE, place, by, depth);
      if (r > 0) for (let f = FACT.WATER; f <= FACT.GROUND; f++) { const ks = FACT_REACTS[f]; for (let j = 0; j < ks.length; j++) if (ks[j] === r) fact(st, d, out, a, f, place, by, depth); }
      if (thing >= 0 && a < SPECIES_BITS && d.spFavThing[a] === thing) fact(st, d, out, a, FACT.THING, place, by, depth);
      if (kind === EV.PIECES && sub === PIECES_USE + USE_VERB.NAP) napWarmth(st, d, out, a, place);
      break;
    }
    case EV.USE:
      if (thing >= 0 && a < SPECIES_BITS && d.spFavThing[a] === thing) fact(st, d, out, a, FACT.THING, place, by, depth);
      if (sub === USE_VERB.NAP) napWarmth(st, d, out, a, place);
      break;
    case EV.SOCIAL:
      if (sub === SOCIAL_KIND.GREET && a < SPECIES_BITS && b < SPECIES_BITS && d.spFriend[a] === b) {
        fact(st, d, out, a, FACT.FRIEND, place, by, depth); fact(st, d, out, b, FACT.FRIEND, place, by, depth);
      }
      if (sub === SOCIAL_KIND.SING) { fact(st, d, out, a, FACT.SONG, place, by, depth); fact(st, d, out, b, FACT.SONG, place, by, depth); if (place < PLACE_BITS) sc[SC.SG] |= 1 << place; }
      if (sub === SOCIAL_KIND.MIRROR) { fact(st, d, out, a, FACT.TWIN, place, by, depth); fact(st, d, out, b, FACT.TWIN, place, by, depth); }
      if (sub === SOCIAL_KIND.PILE) { napWarmth(st, d, out, a, place); napWarmth(st, d, out, b, place); }
      // v < 0: a friend wish's grant greets once more with no points (QUESTS 8)
      if (v >= 0) friendship(st, d, out, a, b, d.socialPoints[sub] ?? 0, place, by, flag, depth);
      break;
    case EV.SIGNATURE:
      fact(st, d, out, a, FACT.TOUCH, place, by, depth);
      warmSpecies(st, out, a, WARMTH.loved, 1);
      break;
    case EV.WISH:
      if (sub === WISH_STATE.SHOWN) {
        if (sc[SC.FW] === 0) {
          // the scripted first wish (no natural wish shows before it): Hearthlog opens, Home's finale opens (QUESTS 7, 8; D-70)
          sc[SC.FW] = 1; sc[SC.WISHER] = a;
          openPlace(st, out, 1);
        }
        if (a !== NO) restWish(st, a, v, thing);
      } else if (sub === WISH_STATE.GRANTED) {
        // the scripted wish's grant is this reducer's (VISIT above); LIFE's own record of it in the same visit is not counted twice
        if (depth === 0 && v === WISH_KIND.PLACE && place === 1 && sc[SC.FW] === 2 && sc[SC.FWVSEQ] === sc[SC.VSEQ] && (a === sc[SC.WISHER] || sc[SC.WISHER] === NO)) return;
        dropWish(st, a);
        fact(st, d, out, a, FACT.WISH, place, by, depth);
        warmSpecies(st, out, a, WARMTH.wish, 0);
        if (sc[SC.WG] < 1e6) sc[SC.WG]++;
      }
      break;
    default: break;
  }
  // 2. the clauses
  match(st, d, out, kind, sub, place, thing, a, b, fam, n2, by, flag, depth);
  // 3. keepsakes that follow counts (QUESTS 10)
  keepsakeCounts(st, out);
}

function match(st: QuestState, d: QuestDefs, out: QuestOut, kind: number, sub: number, place: number, thing: number, a: number, b: number, fam: number,
  n2: number, by: number, flag: number, depth: number): void {
  if (kind >= 33) return;
  const v = VBUF[depth];
  for (let j = d.evFirst[kind], end = d.evFirst[kind + 1]; j < end; j++) {
    const c = d.evList[j];
    const q = d.cQuest[c];
    if (isDone(st, q) || !questOpen(st, d, q)) continue;
    // the grammar (QUESTS 5)
    if (!subAny(d.cSub, c) && !subBit(d.cSub, c, sub)) continue;
    const cp = d.cPlace[c];
    if (cp === -2 ? place === 0 || place === NO : cp >= 0 && cp !== place) continue;
    if (d.cThing[c] >= 0 && d.cThing[c] !== thing) continue;
    if (d.cFam[c] >= 0 && d.cFam[c] !== fam) continue;
    if (n2 < d.cMinN[c]) continue;
    const cb = d.cBy[c];
    if (cb === BY.PLAYER && by !== BY.PLAYER) continue;
    if (cb === BY.SELF && by !== BY.SELF && (flag & EV_FLAG.AUTONOMY_OFF) === 0) continue;
    const cv = d.cV[c];
    if (kind === EV.TOUCH && (sub === TOUCH.SQUEEZE || sub === TOUCH.SQUEEZE_1S) && !(v >= SQUEEZE_MIN_S)) continue;   // a tap (Q3)
    if (cv === cv) {
      if (kind === EV.TOUCH) { if (!(v >= cv)) continue; }
      else if (kind === EV.WISH) { if (v !== cv) continue; }
    }
    const cf = d.cFlag[c];
    if (cf !== 0 && (flag & cf) !== cf) continue;
    // count: a satisfied counter saturates at its target (no information is lost: the clause is met; never a decrement), but a sameSpecies
    // clause keeps collecting species (X7 needs one species in all three clauses)
    const dist = d.cDist[c];
    const full = st.cnt[c] >= d.cCount[c];
    if (dist === DIST.none) {
      if (!full) st.cnt[c]++;
      if (d.cSame[c] && a < SPECIES_BITS) st.bits[c * 2 + (a >>> 5)] |= 1 << (a & 31);
    } else if (full) {
      // a satisfied distinct clause stops collecting
    } else if (dist === DIST.pair) {
      if (a >= NO || b >= NO || a === b) continue;
      const key = (a < b ? a * 256 + b : b * 256 + a) + 1;
      const base = d.cPair[c] * PAIR_SET;
      let k = 0;
      for (; k < PAIR_SET; k++) { const e = st.pairs[base + k]; if (e === key || e === 0) break; }
      if (k === PAIR_SET || st.pairs[base + k] === key) continue;
      st.pairs[base + k] = key;
      st.cnt[c]++;
    } else {
      const x = dist === DIST.species ? a : dist === DIST.family ? fam : dist === DIST.thing ? thing : dist === DIST.part ? (v | 0) : place;
      if (x < 0 || x >= 64 || x !== x) continue;
      const w = c * 2 + (x >>> 5), m = 1 << (x & 31);
      if (st.bits[w] & m) continue;
      st.bits[w] |= m;
      st.cnt[c]++;
    }
    if (st.cnt[c] >= d.cCount[c]) tryComplete(st, d, out, q, by, depth);
  }
}

function tryComplete(st: QuestState, d: QuestDefs, out: QuestOut, q: number, by: number, depth: number): void {
  if (isDone(st, q)) return;
  let same0 = -1, same1 = -1;
  for (let k = d.qFirst[q]; k < d.qFirst[q + 1]; k++) {
    if (st.cnt[k] < d.cCount[k]) return;
    if (d.cSame[k]) { same0 &= st.bits[k * 2]; same1 &= st.bits[k * 2 + 1]; }
  }
  if (same0 !== -1 || same1 !== -1) { if ((same0 | same1) === 0) return; }
  complete(st, d, out, q, by, depth);
}

function complete(st: QuestState, d: QuestDefs, out: QuestOut, q: number, by: number, depth: number): void {
  const sc = st.sc;
  const feBefore = chapterOpen(st, CHAPTER_COUNT - 1);
  st.done[q >>> 5] |= 1 << (q & 31);
  sc[SC.ST]++;
  const ch = d.qChapter[q];
  emit(out, QOUT.QUEST, q, ch, by);
  if (d.qKind[q] === QK.finale) {
    const cd = CHAPTERS[ch];
    const bit = 1 << cd.keepsake;
    if (!(sc[SC.KS] & bit)) { sc[SC.KS] |= bit; emit(out, QOUT.KEEPSAKE, cd.keepsake, ch, by); }
    if (giftReady(st, ch)) emit(out, QOUT.GIFT, ch, 0, by);
    // the Home finale makes the gifts of finales already done claimable
    if (ch === 0) for (let c2 = 1; c2 < CHAPTER_COUNT; c2++) if (giftReady(st, c2)) emit(out, QOUT.GIFT, c2, 0, by);
  }
  openPlacesByStamps(st, d, out);
  if (!feBefore && chapterOpen(st, CHAPTER_COUNT - 1)) emit(out, QOUT.UNLOCK, UNLOCK_FRIENDS, CHAPTER_COUNT - 1, by);
  // a quest may already be satisfied when its finale opens (5 mains done): finales count only while open, so nothing to re-check here
  void depth;
}

/** Places open by stamps only, in order (QUESTS 7, QU-06): an unshipped place is skipped and its stamps are kept; it opens the moment it ships. */
export function openPlacesByStamps(st: QuestState, d: QuestDefs, out: QuestOut): void {
  for (let p = 2; p < d.nPlaces && p < PLACE_BITS; p++) {
    if (placeOpen(st, p) || !(d.placeShipped & (1 << p))) continue;
    const at = d.opensAt[p];
    if (at > 0 && st.sc[SC.ST] >= at) openPlace(st, out, p);
  }
}
function openPlace(st: QuestState, out: QuestOut, p: number): void {
  const bit = 1 << p;
  if (st.sc[SC.PL] & bit) return;
  st.sc[SC.PL] |= bit;
  emit(out, QOUT.UNLOCK, p, 0, 0);
}

/* ── facts (QUESTS 9) ── */
function fact(st: QuestState, d: QuestDefs, out: QuestOut, sp: number, f: number, place: number, by: number, depth: number): void {
  if (sp >= SPECIES_BITS || f < 0 || f > 15) return;
  const m = 1 << f;
  const before = st.fx[sp];
  if (before & m) return;
  const after = before | m;
  st.fx[sp] = after;
  if ((after & 0x7ff) === 0x7ff && (before & 0x7ff) !== 0x7ff) st.sc[SC.GOLD]++;
  emit(out, QOUT.FACT, sp, f, by);
  if (depth < 3) derive(st, d, out, EV.DISCOVER, f, place, -1, sp, NO, NO, 0, by, 0, 0, depth);
}

/* ── friendship (LIFE 6.2) ── */
function friendship(st: QuestState, d: QuestDefs, out: QuestOut, a: number, b: number, pts: number, place: number, by: number, flag: number, depth: number): void {
  if (pts <= 0 || a >= NO || b >= NO || a === b) return;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  const best = lo < SPECIES_BITS && d.spFriend[lo] === hi;
  let r = -1;
  const n = st.sc[SC.FRN];
  for (let k = 0; k < n; k++) if (st.frLo[k] === lo && st.frHi[k] === hi) { r = k; break; }
  if (r < 0) {
    if (n < FR_ROWS) { r = n; st.sc[SC.FRN] = n + 1; }
    else {
      // full: drop the Met-only pair with the fewest points, never Friends or closer and never a best-friend pair
      let worst = -1;
      for (let k = 0; k < n; k++) {
        if (st.frPts[k] >= FRIENDSHIP.friends || (st.frLo[k] < SPECIES_BITS && d.spFriend[st.frLo[k]] === st.frHi[k])) continue;
        if (worst < 0 || st.frPts[k] < st.frPts[worst]) worst = k;
      }
      if (worst < 0) return;
      r = worst;
    }
    st.frLo[r] = lo; st.frHi[r] = hi; st.frPts[r] = 0; st.frDay[r] = 0;
  }
  let add = best ? pts * FRIENDSHIP.bestBonus : pts;
  const room = FRIENDSHIP.perDay - st.frDay[r];
  if (add > room) add = room;
  if (add <= 0) return;
  const before = st.frPts[r];
  const after = before + add;
  st.frPts[r] = after;
  st.frDay[r] += add;
  const l0 = before >= FRIENDSHIP.close ? 3 : before >= FRIENDSHIP.friends ? 2 : before >= FRIENDSHIP.met ? 1 : 0;
  const l1 = after >= FRIENDSHIP.close ? 3 : after >= FRIENDSHIP.friends ? 2 : after >= FRIENDSHIP.met ? 1 : 0;
  for (let l = l0 + 1; l <= l1; l++) {
    emit(out, QOUT.FRIEND, lo, hi, l);
    if (depth < 3) derive(st, d, out, EV.FRIEND, l, place, -1, lo, hi, NO, 2, by, flag & EV_FLAG.BEST_PAIR, 0, depth);
  }
}

/** The friendship level of a points total (LIFE 6.2): 0 none, then FRIEND_LEVEL MET, FRIENDS, CLOSE. */
export function friendLevel(x: number): number {
  return x >= FRIENDSHIP.close ? FRIEND_LEVEL.CLOSE : x >= FRIENDSHIP.friends ? FRIEND_LEVEL.FRIENDS : x >= FRIENDSHIP.met ? FRIEND_LEVEL.MET : 0;
}

/* ── warmth (LIFE 6.3): per item, never falls; gains capped per day ── */
function warmSpecies(st: QuestState, out: QuestOut, sp: number, add: number, dayBit: number): void {
  const n = st.sc[SC.PARTYN];
  for (let s = 0; s < n; s++) {
    if (st.partySp[s] !== sp) continue;
    const it = st.party[s];
    if (it < 0 || it >= WM_ROWS) return;
    warmItem(st, out, it, add, dayBit);
    return;   // the first party member of that species: pieces have no item id, their deeds count for the parent
  }
}
/** dayBit: 0 no daily cap (a granted wish), 1 a loved touch (at most WARMTH.lovedPerDay a day), 4 the favourite visit, 8 the favourite nap. */
function warmItem(st: QuestState, out: QuestOut, it: number, add: number, dayBit: number): void {
  const day = st.sc[SC.DAY];
  if (st.wmDay[it] !== day) { st.wmDay[it] = day; st.wmBits[it] = 0; }
  const bits = st.wmBits[it];
  if (dayBit === 1) { const loved = bits & 3; if (loved >= WARMTH.lovedPerDay) return; st.wmBits[it] = (bits & ~3) | (loved + 1); }
  else if (dayBit > 1) { if (bits & dayBit) return; st.wmBits[it] = bits | dayBit; }
  const before = st.wm[it];
  const after = Math.min(WARMTH.max, before + add);
  if (after === before) return;
  st.wm[it] = after;
  emit(out, QOUT.WARMTH, it, after, 0);
}
function napWarmth(st: QuestState, d: QuestDefs, out: QuestOut, sp: number, place: number): void {
  if (sp < SPECIES_BITS && d.spFavPlace[sp] === place && place !== 0) warmSpecies(st, out, sp, WARMTH.favNap, 8);
}

/* ── wishes kept in the Journal (QUESTS 8, QU-12): one per species, the newest 3 ── */
function restWish(st: QuestState, sp: number, kind: number, target: number): void {
  let n = st.sc[SC.WIN];
  for (let k = 0; k < n; k++) if (st.wiSp[k] === sp) { removeWishAt(st, k); n--; break; }
  if (n >= WISH_KEPT) { removeWishAt(st, 0); n--; }      // a 4th quietly replaces the oldest
  st.wiSp[n] = sp; st.wiKind[n] = kind; st.wiTarget[n] = target; st.wiDay[n] = st.sc[SC.DAY];
  st.sc[SC.WIN] = n + 1;
}
function dropWish(st: QuestState, sp: number): void {
  const n = st.sc[SC.WIN];
  for (let k = 0; k < n; k++) if (st.wiSp[k] === sp) { removeWishAt(st, k); return; }
}
function removeWishAt(st: QuestState, k: number): void {
  const n = st.sc[SC.WIN];
  for (let j = k; j < n - 1; j++) { st.wiSp[j] = st.wiSp[j + 1]; st.wiKind[j] = st.wiKind[j + 1]; st.wiTarget[j] = st.wiTarget[j + 1]; st.wiDay[j] = st.wiDay[j + 1]; }
  st.sc[SC.WIN] = n - 1;
}

/* ── keepsakes by count (QUESTS 10) ── */
function keepsakeCounts(st: QuestState, out: QuestOut): void {
  const sc = st.sc;
  let bestPairs = -1, closePairs = -1;
  for (let i = 0; i < KEEPSAKES.length; i++) {
    const k = KEEPSAKES[i];
    const bit = 1 << k.bit;
    if (sc[SC.KS] & bit) continue;
    let have = 0;
    switch (k.by) {
      case KEEP_BY.BEST_PAIRS:
        if (bestPairs < 0) { bestPairs = 0; for (let s = 0; s < SPECIES_BITS; s++) if ((st.fx[s] & (1 << FACT.FRIEND)) !== 0) bestPairs++; bestPairs = bestPairs >>> 1; }
        have = bestPairs; break;
      case KEEP_BY.CLOSE_PAIRS:
        if (closePairs < 0) { closePairs = 0; for (let r = 0; r < sc[SC.FRN]; r++) if (st.frPts[r] >= FRIENDSHIP.close) closePairs++; }
        have = closePairs; break;
      case KEEP_BY.SONG_PLACES: have = popcount16(sc[SC.SG]); break;
      case KEEP_BY.WISHES: have = sc[SC.WG]; break;
      case KEEP_BY.GOLD_PAGES: have = sc[SC.GOLD]; break;
      case KEEP_BY.ALL_PLACES: { have = 0; for (let p = 0; p < PLACE_BITS; p++) if (st.pv[p] > 0) have++; break; }
      default: continue;   // finales: complete()
    }
    if (have >= k.n) { sc[SC.KS] |= bit; emit(out, QOUT.KEEPSAKE, k.bit, -1, 0); }
  }
}
function popcount16(x: number): number { let n = 0; for (let i = 0; i < 16; i++) if (x & (1 << i)) n++; return n; }

/* ═══════════════════════════════════════ state outside the ring (the journal's own writes) ═══════════════════════════════════════ */

/** The gift claim's journal rows (QUESTS 11 steps 1 and 3). state: 1 pending, 2 granted; never lowered (a load never reverts a granted
 *  gift: PLAYGROUND_BUILD 23). */
export function setGiftState(st: QuestState, ch: number, state: number, speciesIdx: number, day: number): void {
  if (ch < 0 || ch >= st.giftState.length) return;
  if (state <= st.giftState[ch]) return;
  st.giftState[ch] = state;
  if (st.giftSp[ch] === NO) st.giftSp[ch] = speciesIdx;
  if (st.giftDay[ch] < 0) st.giftDay[ch] = day;
  if (day > st.sc[SC.GDAY]) st.sc[SC.GDAY] = day;
}
/** Is a species one of this chapter's gift choices? */
export function giftListHas(ch: number, species: SpeciesId): boolean {
  const l = GIFT_LISTS[ch];
  return !!l && l.includes(species);
}
/** The backfill's own writes (CO-04): a fact found without its event, a quest marked done (its stamp counts). */
export function markFact(st: QuestState, sp: number, f: number): void {
  if (sp >= SPECIES_BITS) return;
  const before = st.fx[sp], after = before | (1 << f);
  st.fx[sp] = after;
  if ((after & 0x7ff) === 0x7ff && (before & 0x7ff) !== 0x7ff) st.sc[SC.GOLD]++;
}
export function markDone(st: QuestState, d: QuestDefs, q: number, out: QuestOut): void {
  if (isDone(st, q)) return;
  complete(st, d, out, q, BY.PLAYER, 0);
}
/** Recount the derived scalars after a load or a merge (stamps from the done set, gold pages from the facts). */
export function recountDerived(st: QuestState, d: QuestDefs): void {
  let n = 0;
  for (let q = 0; q < d.nq; q++) if (isDone(st, q)) n++;
  st.sc[SC.ST] = Math.max(st.sc[SC.ST], n);
  let g = 0;
  for (let s = 0; s < SPECIES_BITS; s++) if ((st.fx[s] & 0x7ff) === 0x7ff) g++;
  st.sc[SC.GOLD] = g;
}
