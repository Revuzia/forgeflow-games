// PLAYGROUND Journal data: the play-event id tables, all 110 quests as clause rules (QUESTS 6, exactly as written), the chapters, the 20
// keepsakes, the five gift lists and Home's chapter text. Specs: _spec/QUESTS.md (4, 5, 6, 7, 8, 9, 10, 11, 15), _spec/PLAYGROUND_BUILD.md 6 and 12.
// Owned by the DATA lane (PG_DATA). LOADING (D-69): the post-play LIFE CHUNK (the reducer and the tracker read it); every other chapter's
// titles and hints are player text in the lazy journal_text.ts. Every id list is APPEND-ONLY (quest idx, keepsake bit and fact bit are saved).
// Imports life.ts and places.ts only (no cycle: life.ts never imports this module); never src/core/quests.ts.
import type { SpeciesId } from './catalog.ts';
import type { PlaceId, ThingId } from './places.ts';
import { PLACE_IDS, THING_IDS } from './places.ts';
import { TOUCH, WISH_KIND, REACT_KIND, SOCIAL_KIND, USE_VERB } from './life.ts';

/* ═══════════════════════════════════════ event ids (QUESTS 4; contracts.ts PlayEventRing) ═══════════════════════════════════════ */

/** The REACT, SOCIAL and USE sub ids are LIFE's (defined in life.ts, the producer) and re-exported here for the reducer. A TOUCH record's sub
 *  is a life.ts TOUCH id (SQUEEZE, STRETCH, TOSS). */
export { REACT_KIND, SOCIAL_KIND, USE_VERB };
/** PlayEventRing.kind. 0 = none. */
export const EV = { VISIT: 1, BRING: 2, TOUCH: 3, USE: 4, REACT: 5, SOCIAL: 6, FRIEND: 7, WISH: 8, DISCOVER: 9, PIECES: 10, CUT: 11, WHOLE: 12, PHOTO: 13, CAPSULE: 14,
  GIFT: 15, UI: 16, SIGNATURE: 17 } as const;
/** A WISH record's sub. */
export const WISH_STATE = { SHOWN: 1, SEEN: 2, GRANTED: 3 } as const;
/** A FRIEND record's sub (LIFE 6.2's levels). */
export const FRIEND_LEVEL = { MET: 1, FRIENDS: 2, CLOSE: 3 } as const;
/** A UI record's sub. */
export const UI_KIND = { JOURNAL: 1, TRAVEL: 2, EMOTE_TAP: 3, GO_PLAY: 4 } as const;
/** The 12 facts per species (QUESTS 9): the bit index in the species' 16-bit mask, also a DISCOVER record's sub. */
export const FACT = { MET: 0, PLACE: 1, THING: 2, FRIEND: 3, WATER: 4, WARM: 5, COLD: 6, GROUND: 7, SONG: 8, TOUCH: 9, WISH: 10, TWIN: 11 } as const;
/** PlayEventRing.by. */
export const BY = { SELF: 0, PLAYER: 1 } as const;
/** PlayEventRing.flag bits: a piece took part, a best-friend pair, a species new to the player, "Squishies move on their own" was off. */
export const EV_FLAG = { PIECE: 1, BEST_PAIR: 2, NEW_SPECIES: 4, AUTONOMY_OFF: 8 } as const;
/** A PIECES record's sub is the underlying REACT kind, or PIECES_USE + the USE verb (the two tables overlap as numbers: REACT 5 is RISE,
 *  USE 5 is BOUNCE), so one sub id names one deed. */
export const PIECES_USE = 64;

/* ═══════════════════════════════════════ the rule grammar (QUESTS 5) ═══════════════════════════════════════ */

/** One clause, a persistent counter that never resets. ev: EV id; sub: any of these sub ids; place: a place idx or 'away' (any place but Home);
 *  thing: a global thing idx (THING_IDS); mech: a MECH id; family: a MATERIAL_FAMILY_IDS idx; minN: characters in one event (pieces count; a
 *  PIECES record's n); by: SELF 0 / PLAYER 1 (a by-SELF clause also accepts a by-PLAYER record with EV_FLAG.AUTONOMY_OFF); count: how many;
 *  distinct: count distinct species / families / things / parts (a USE RING's part in v) / pairs / places; sameSpecies: every clause of the
 *  quest must share one species; v: TOUCH: the least held s or pull level; WISH: the wish kind (WISH_KIND) it must be; flag: EV_FLAG bits the
 *  record must carry (X8's best pair). */
export interface Clause { readonly ev: number; readonly sub?: readonly number[]; readonly place?: number | 'away'; readonly thing?: number; readonly mech?: number;
  readonly family?: number; readonly minN?: number; readonly by?: 0 | 1; readonly count: number;
  readonly distinct?: 'species' | 'family' | 'thing' | 'part' | 'pair' | 'place'; readonly sameSpecies?: true; readonly v?: number; readonly flag?: number }
/** idx: append-only (saved); id: the spec's code (H1, C8, X10); chapter: CHAPTERS index; keys: K = the keyboard can complete it, K* = it needs
 *  the keyboard stretch (QUESTS 6); playerClause: on a gift finale, the index of its player-caused clause (QU-07). */
export interface QuestDef { readonly idx: number; readonly id: string; readonly chapter: number; readonly kind: 'main' | 'finale' | 'bonus'; readonly clauses: readonly Clause[];
  readonly keys: 'K' | 'K*'; readonly playerClause?: number }

const P = (id: PlaceId): number => PLACE_IDS.indexOf(id);
const T = (id: ThingId): number => THING_IDS.indexOf(id);
type Opt = Omit<Clause, 'ev' | 'count'>;
const c = (ev: number, count: number, o: Opt = {}): Clause => ({ ev, count, ...o });
const kindOf = (k: number): QuestDef['kind'] => (k === 7 ? 'finale' : k < 7 ? 'main' : 'bonus');
const LETTER = ['H', 'C', 'R', 'I', 'G', 'T', 'W', 'L', 'E', 'U', 'X'];
/** Ten quests of one chapter, in spec order (#1..#7 main, #8 the finale, #9..#10 bonus). */
function chapter(ch: number, rules: readonly (readonly Clause[])[], keys: Readonly<Record<number, 'K*'>> = {}, playerClause?: number): QuestDef[] {
  return rules.map((clauses, k) => ({ idx: ch * 10 + k, id: LETTER[ch] + (k + 1), chapter: ch, kind: kindOf(k), clauses, keys: keys[k] ?? 'K',
    ...(k === 7 && playerClause !== undefined ? { playerClause } : {}) }));
}
const { VISIT, TOUCH: EV_TOUCH, USE, REACT, SOCIAL, FRIEND, WISH, DISCOVER, PIECES, PHOTO, CAPSULE, UI } = EV;
const R = REACT_KIND, S = SOCIAL_KIND, U = USE_VERB;
const F1 = (place: PlaceId): Clause => c(DISCOVER, 1, { sub: [FACT.PLACE], place: P(place) });

/** All 110 quests (QUESTS 6.0 to 6.10, exactly as written). */
export const QUESTS: readonly QuestDef[] = /* @__PURE__ */ (() => [
  ...chapter(0, [
    [c(EV_TOUCH, 1, { sub: [TOUCH.SQUEEZE], v: 0.4 })],
    [c(USE, 1, { place: P('home'), by: BY.SELF })],
    [c(EV_TOUCH, 1, { sub: [TOUCH.STRETCH], v: 0.35 })],
    [c(CAPSULE, 1)],
    [c(SOCIAL, 1, { sub: [S.GREET] })],
    [c(UI, 1, { sub: [UI_KIND.EMOTE_TAP] })],
    [c(WISH, 1, { sub: [WISH_STATE.SEEN] })],
    [c(WISH, 1, { sub: [WISH_STATE.GRANTED], v: WISH_KIND.PLACE })],
    [c(USE, 3, { thing: T('feltball'), sub: [U.ROLL], by: BY.PLAYER })],
    [c(SOCIAL, 1, { sub: [S.PILE], thing: T('snoozerug'), minN: 2 })],
  ], { 2: 'K*' }),
  ...chapter(1, [
    [c(VISIT, 1, { place: P('hearthlog') })],
    [c(REACT, 2, { sub: [R.WARM], place: P('hearthlog'), distinct: 'species' })],
    [c(SOCIAL, 1, { sub: [S.PUSH], place: P('hearthlog') })],
    [c(USE, 2, { thing: T('yarnball'), sub: [U.ROLL], by: BY.SELF, distinct: 'species' })],
    [c(SOCIAL, 1, { sub: [S.TEETER], thing: T('rockerboard') })],
    [c(PIECES, 1, { sub: [R.WARM], place: P('hearthlog'), minN: 3 })],
    [c(USE, 1, { thing: T('kettle'), sub: [U.LISTEN], by: BY.SELF })],
    [c(USE, 1, { thing: T('hearth'), sub: [U.SWITCH], by: BY.PLAYER }), c(SOCIAL, 1, { sub: [S.SING], place: P('hearthlog'), minN: 3 })],
    [c(REACT, 1, { sub: [R.TOAST, R.RISE], place: P('hearthlog') })],
    [F1('hearthlog')],
  ], {}, 0),
  ...chapter(2, [
    [c(VISIT, 1, { place: P('ripple') })],
    [c(REACT, 3, { sub: [R.FLOAT, R.WADE], thing: T('rockpool'), distinct: 'family' })],
    [c(USE, 3, { thing: T('shellchimes'), sub: [U.RING], distinct: 'part' })],
    [c(SOCIAL, 1, { sub: [S.PASS], thing: T('pebbleball') })],
    [c(SOCIAL, 1, { sub: [S.PEEK], thing: T('driftlog') })],
    [c(PIECES, 1, { sub: [R.FLOAT, R.WADE], place: P('ripple'), minN: 3 })],
    [c(SOCIAL, 1, { sub: [S.SQUIRT], place: P('ripple') })],
    [c(EV_TOUCH, 1, { sub: [TOUCH.SQUEEZE], place: P('ripple') }), c(SOCIAL, 1, { sub: [S.SNUGGLE], place: P('ripple'), minN: 3 })],
    [c(USE, 2, { thing: T('sandmound'), sub: [U.SLIDE] })],
    [F1('ripple')],
  ], {}, 0),
  ...chapter(3, [
    [c(VISIT, 1, { place: P('frostbell') })],
    [c(REACT, 2, { sub: [R.FROST], place: P('frostbell'), distinct: 'species' })],
    [c(REACT, 2, { sub: [R.GLIDE], thing: T('icepond'), distinct: 'family' })],
    [c(REACT, 1, { sub: [R.SNOWCAP], thing: T('shakepine') })],
    [c(SOCIAL, 1, { sub: [S.NUZZLE], place: P('frostbell') })],
    [c(PIECES, 1, { sub: [R.GLIDE], place: P('frostbell'), minN: 3 })],
    [c(USE, 2, { thing: T('glideramp'), sub: [U.SLIDE] })],
    [c(WISH, 1, { sub: [WISH_STATE.GRANTED], place: P('frostbell'), by: BY.PLAYER }), c(SOCIAL, 1, { sub: [S.PILE], place: P('frostbell'), minN: 3 })],
    [c(USE, 5, { thing: T('iciclebells'), sub: [U.RING] })],
    [F1('frostbell')],
  ], {}, 0),
  ...chapter(4, [
    [c(VISIT, 1, { place: P('rainleaf') })],
    [c(REACT, 3, { sub: [R.SPLASH], place: P('rainleaf'), distinct: 'species' })],
    [c(SOCIAL, 1, { sub: [S.TEETER], thing: T('leafteeter') })],
    [c(USE, 3, { thing: T('mossbouncer'), sub: [U.BOUNCE] })],
    [c(SOCIAL, 1, { sub: [S.PARADE], place: P('rainleaf'), minN: 3 })],
    [c(PIECES, 1, { sub: [R.SPLASH], place: P('rainleaf'), minN: 3 })],
    [c(REACT, 1, { sub: [R.SHOWER], thing: T('dripleaf') })],
    [c(PHOTO, 1, { place: P('rainleaf'), minN: 2 }), c(SOCIAL, 1, { sub: [S.SING], place: P('rainleaf'), minN: 3 })],
    [c(REACT, 1, { sub: [R.SOAK], place: P('rainleaf') })],
    [F1('rainleaf')],
  ], {}, 0),
  ...chapter(5, [
    [c(VISIT, 1, { place: P('fizzwell') })],
    [c(REACT, 1, { sub: [R.FLOAT], place: P('fizzwell') }), c(REACT, 1, { sub: [R.WADE], place: P('fizzwell') })],
    [c(USE, 2, { thing: T('swirlride'), sub: [U.SPIN] })],
    [c(REACT, 2, { sub: [R.FIZZ], thing: T('bubblepatch'), distinct: 'species' })],
    [c(SOCIAL, 3, { sub: [S.GREET], place: P('fizzwell'), distinct: 'pair' })],
    [c(PIECES, 1, { sub: [R.FLOAT, R.WADE], place: P('fizzwell'), minN: 3 })],
    [c(USE, 1, { thing: T('tap'), sub: [U.SWITCH], by: BY.PLAYER }), c(REACT, 1, { sub: [R.DRIFT], place: P('fizzwell') })],
    [c(SOCIAL, 1, { sub: [S.SING], place: P('fizzwell'), minN: 3 })],
    [c(USE, 2, { thing: T('soapslide'), sub: [U.SLIDE] })],
    [F1('fizzwell')],
  ]),
  ...chapter(6, [
    [c(VISIT, 1, { place: P('cogwhistle') })],
    [c(USE, 1, { thing: T('windupkey'), sub: [U.SWITCH], by: BY.PLAYER }), c(USE, 1, { thing: T('spinningcog'), sub: [U.SPIN] })],
    [c(USE, 3, { thing: T('springplate'), sub: [U.BOUNCE] })],
    [c(USE, 1, { thing: T('magnet'), sub: [U.SWITCH], by: BY.PLAYER }), c(USE, 1, { thing: T('steelmarble'), sub: [U.ROLL] })],
    [c(SOCIAL, 2, { sub: [S.COPY], place: P('cogwhistle') })],
    [c(PIECES, 1, { sub: [PIECES_USE + U.SPIN], place: P('cogwhistle'), minN: 3 })],
    [c(USE, 2, { thing: T('tickclock'), sub: [U.LISTEN], distinct: 'species' })],
    [c(USE, 1, { thing: T('spinningcog'), sub: [U.SPIN] }), c(USE, 1, { thing: T('springplate'), sub: [U.BOUNCE] }), c(USE, 1, { thing: T('littlebell'), sub: [U.RING] })],
    [c(USE, 3, { thing: T('littlebell'), sub: [U.RING] })],
    [F1('cogwhistle')],
  ]),
  ...chapter(7, [
    [c(VISIT, 1, { place: P('lanternroof') })],
    [c(REACT, 2, { sub: [R.GAZE_SKY], place: P('lanternroof'), distinct: 'species' })],
    [c(USE, 3, { thing: T('lanternline'), sub: [U.RING], distinct: 'part' })],
    [c(USE, 1, { thing: T('vanedisc'), sub: [U.SPIN] })],
    [c(REACT, 2, { sub: [R.HOLD_ON], place: P('lanternroof'), distinct: 'species' })],
    [c(PIECES, 1, { sub: [R.HOLD_ON], place: P('lanternroof'), minN: 3 })],
    [c(USE, 1, { thing: T('starscope'), sub: [U.SWITCH], by: BY.PLAYER })],
    [c(SOCIAL, 1, { sub: [S.SING], place: P('lanternroof'), minN: 3 })],
    [c(SOCIAL, 1, { sub: [S.PUSH], thing: T('hammock') })],
    [F1('lanternroof')],
  ]),
  ...chapter(8, [
    [c(VISIT, 1, { place: P('echohollow') })],
    [c(REACT, 2, { sub: [R.GLOW], thing: T('glowpool'), distinct: 'species' })],
    [c(USE, 3, { thing: T('crystals'), sub: [U.RING], distinct: 'part' })],
    [c(USE, 1, { thing: T('echostone'), sub: [U.SWITCH], by: BY.PLAYER })],
    [c(SOCIAL, 1, { sub: [S.ECHO], place: P('echohollow') })],
    [c(PIECES, 1, { sub: [R.GLOW], place: P('echohollow'), minN: 3 })],
    [c(SOCIAL, 1, { sub: [S.PEEK], thing: T('humrock') })],
    [c(SOCIAL, 1, { sub: [S.SING], place: P('echohollow'), minN: 3 })],
    [c(USE, 2, { thing: T('stoneslide'), sub: [U.SLIDE] })],
    [F1('echohollow')],
  ]),
  ...chapter(9, [
    [c(VISIT, 1, { place: P('cloudloft') })],
    [c(USE, 3, { thing: T('puffpads'), sub: [U.BOUNCE] })],
    [c(REACT, 2, { sub: [R.LIFT], place: P('cloudloft'), distinct: 'species' })],
    [c(SOCIAL, 1, { sub: [S.PUSH], thing: T('kiteswing') })],
    [c(SOCIAL, 1, { sub: [S.COPY], thing: T('puffpads') })],
    [c(PIECES, 1, { sub: [PIECES_USE + U.BOUNCE], place: P('cloudloft'), minN: 3 })],
    [c(SOCIAL, 1, { sub: [S.PASS], thing: T('cloudball') })],
    [c(SOCIAL, 1, { sub: [S.PARADE], thing: T('sunbowarch'), minN: 3 })],
    [c(SOCIAL, 1, { sub: [S.PILE], thing: T('cloudnest'), minN: 2 })],
    [F1('cloudloft')],
  ]),
  ...chapter(10, [
    [c(SOCIAL, 3, { sub: [S.GREET], distinct: 'pair' })],
    [c(FRIEND, 1, { sub: [FRIEND_LEVEL.FRIENDS] })],
    [c(DISCOVER, 1, { sub: [FACT.FRIEND] })],
    [c(SOCIAL, 3, { sub: [S.SING], distinct: 'place' })],
    [c(VISIT, 3, { place: 'away', distinct: 'place' })],
    [c(REACT, 4, { distinct: 'family' })],
    [c(REACT, 1, { sub: [R.WADE, R.FLOAT], sameSpecies: true }), c(REACT, 1, { sub: [R.FROST, R.SHIVER], sameSpecies: true }), c(REACT, 1, { sub: [R.WARM], sameSpecies: true })],
    [c(PHOTO, 1, { minN: 3, flag: EV_FLAG.BEST_PAIR })],
    [c(SOCIAL, 3, { sub: [S.PILE], distinct: 'place' })],
    [c(WISH, 5, { sub: [WISH_STATE.GRANTED], by: BY.PLAYER })],
  ], {}, 0),
])();

/* ═══════════════════════════════════════ chapters, keepsakes, gifts (QUESTS 6, 7, 10, 11) ═══════════════════════════════════════ */

/** How a chapter opens: 'start' (Home), 'firstWish' (Hearthlog: when the first wish shows, or at 5:00 of play), a stamp count (QUESTS 7), or
 *  'finales' (Friends Everywhere: when `n` chapter finales are done). place: its place idx, -1 for Friends Everywhere. finale: its finale
 *  quest idx; keepsake: the finale's keepsake bit; gift: the finale gives a gift (GIFT_LISTS[chapter]). */
export interface ChapterDef { readonly idx: number; readonly place: number; readonly opens: 'start' | 'firstWish' | 'finales' | number; readonly n?: number;
  readonly finale: number; readonly keepsake: number; readonly gift: boolean }
export const CHAPTERS: readonly ChapterDef[] = [
  { idx: 0, place: 0, opens: 'start', finale: 7, keepsake: 0, gift: false },
  { idx: 1, place: 1, opens: 'firstWish', finale: 17, keepsake: 1, gift: true },
  { idx: 2, place: 2, opens: 12, finale: 27, keepsake: 2, gift: true },
  { idx: 3, place: 3, opens: 20, finale: 37, keepsake: 3, gift: true },
  { idx: 4, place: 4, opens: 28, finale: 47, keepsake: 4, gift: true },
  { idx: 5, place: 5, opens: 36, finale: 57, keepsake: 5, gift: false },
  { idx: 6, place: 6, opens: 45, finale: 67, keepsake: 6, gift: false },
  { idx: 7, place: 7, opens: 54, finale: 77, keepsake: 7, gift: false },
  { idx: 8, place: 8, opens: 63, finale: 87, keepsake: 8, gift: false },
  { idx: 9, place: 9, opens: 72, finale: 97, keepsake: 9, gift: false },
  { idx: 10, place: -1, opens: 'finales', n: 2, finale: 107, keepsake: 10, gift: true },
];
/** The REACT kinds that find each family fact (QUESTS 9: F1 a LOVE, F4 water, F5 warm, F6 cold, F7 ground); DT-15 checks each has a trigger. */
export const FACT_REACTS: Readonly<Record<number, readonly number[]>> = {
  [FACT.PLACE]: [REACT_KIND.LOVE],
  [FACT.WATER]: [REACT_KIND.FLOAT, REACT_KIND.WADE, REACT_KIND.SOAK, REACT_KIND.SPLASH],
  [FACT.WARM]: [REACT_KIND.WARM, REACT_KIND.TOAST, REACT_KIND.RISE, REACT_KIND.OOZE],
  [FACT.COLD]: [REACT_KIND.FROST, REACT_KIND.SHIVER, REACT_KIND.SNOWCAP, REACT_KIND.HOLD_ON],
  [FACT.GROUND]: [REACT_KIND.GLIDE, REACT_KIND.PRINT],
};
/** A finale opens at FINALE_AT of its chapter's 7 main quests (Q6); Home's opens when the first wish shows. */
export const FINALE_AT = 5;
/** How a keepsake is found (QUESTS 10). */
export const KEEP_BY = { FINALE: 1, BEST_PAIRS: 2, CLOSE_PAIRS: 3, SONG_PLACES: 4, WISHES: 5, GOLD_PAGES: 6, ALL_PLACES: 7 } as const;
/** The 20 keepsakes: bit (append-only, a 32-bit set), id (their names and lines are journal_text.ts KEEPSAKE_TEXT), how they are found and
 *  the number (the chapter for a finale, a count otherwise; ALL_PLACES: every place, BEST_PAIRS 25: all of them). */
export const KEEPSAKES: readonly { readonly bit: number; readonly id: string; readonly by: number; readonly n: number }[] = [
  { bit: 0, id: 'feltstar', by: KEEP_BY.FINALE, n: 0 }, { bit: 1, id: 'emberpinecone', by: KEEP_BY.FINALE, n: 1 },
  { bit: 2, id: 'seaglasspebble', by: KEEP_BY.FINALE, n: 2 }, { bit: 3, id: 'tinyfrostbell', by: KEEP_BY.FINALE, n: 3 },
  { bit: 4, id: 'raindropbead', by: KEEP_BY.FINALE, n: 4 }, { bit: 5, id: 'bubblering', by: KEEP_BY.FINALE, n: 5 },
  { bit: 6, id: 'littlebrasscog', by: KEEP_BY.FINALE, n: 6 }, { bit: 7, id: 'paperlantern', by: KEEP_BY.FINALE, n: 7 },
  { bit: 8, id: 'glowcrystal', by: KEEP_BY.FINALE, n: 8 }, { bit: 9, id: 'cloudpuff', by: KEEP_BY.FINALE, n: 9 },
  { bit: 10, id: 'friendshipframe', by: KEEP_BY.FINALE, n: 10 }, { bit: 11, id: 'paircharm', by: KEEP_BY.BEST_PAIRS, n: 1 },
  { bit: 12, id: 'friendshipribbon', by: KEEP_BY.CLOSE_PAIRS, n: 1 }, { bit: 13, id: 'ribbongarland', by: KEEP_BY.CLOSE_PAIRS, n: 5 },
  { bit: 14, id: 'songbook', by: KEEP_BY.SONG_PLACES, n: 5 }, { bit: 15, id: 'wishjar', by: KEEP_BY.WISHES, n: 10 },
  { bit: 16, id: 'littlebutton', by: KEEP_BY.GOLD_PAGES, n: 5 }, { bit: 17, id: 'thimble', by: KEEP_BY.GOLD_PAGES, n: 15 },
  { bit: 18, id: 'pocketmap', by: KEEP_BY.ALL_PLACES, n: 10 }, { bit: 19, id: 'friendsquilt', by: KEEP_BY.BEST_PAIRS, n: 25 },
];
/** The five gift lists by chapter idx (PLACES 5, QUESTS 11): three Common or Uncommon fans of the next place (Friends Everywhere: the three
 *  families with no Common); pick one. */
export const GIFT_LISTS: Readonly<Record<number, readonly SpeciesId[]>> = {
  1: ['puddlo', 'crumbit', 'swishel'], 2: ['boingle', 'hooplet', 'knubby'], 3: ['munchip', 'sproutle', 'acornel'], 4: ['plumpet', 'glugbean', 'tadpolo'],
  10: ['capnap', 'kneadle', 'wrigglo'],
};
/** The gift rules (QUESTS 11; D-29, D-31): at most 5 for life, 1 per UTC day, after the Home finale, Practice shelf only; the item id
 *  'jg-' + deviceId + '-' + chapter, origin 'restock'. */
export const GIFT = { lifetime: 5, perDay: 1, idPrefix: 'jg-', origin: 'restock' } as const;
/** Wish caps (QUESTS 8): per squishy 1 open, 1 wish bubble on screen, 3 kept in the Journal, 180 s since that squishy's last, 120 s since any
 *  new wish, the first wish 60 s after the first reveal (at most at 5:00 of play), 40% of place and thing wishes point at an undiscovered
 *  favourite, a touch wish at most once per 10 min, a by-PLAYER nap / song / thing / warm grant needs the player's act in the last 10 s. */
export const WISH_RULES = { open: 1, onScreen: 1, kept: 3, perSquishyS: 180, anyS: 120, firstAfterRevealS: 60, firstLatestS: 300, favShare: 0.4, touchEveryS: 600, playerWindowS: 10 } as const;

/* ═══════════════════════════════════════ Home's text (D-42: the tracker needs it before the lazy text) ═══════════════════════════════════════ */

/** Chapter 0's name and its ten titles and hints (QUESTS 6.0, exactly as written; DT-02 and DT-08 screen them). */
export const HOME_TEXT = {
  chapter: 'First Days',
  quests: [
    ['A gentle squeeze', 'Press and hold your squishy for a moment.'],
    ['Watch it play', 'Let go and wait a little.'],
    ['A big stretch', 'Pull it out, then let go.'],
    ['Open a capsule', 'Squeeze and stretch to fill the meter.'],
    ['Say hello', 'Two squishies out together will say hello.'],
    ['Tap a bubble', 'Tap a bubble to see what it means.'],
    ['A first wish', 'Tap the thought bubble to read it.'],
    ['A wish comes true', 'Go to the place on the postcard.'],
    ['Roll the felt ball', 'Flick the Felt Ball three times.'],
    ['Nap time', 'Two squishies nap on the Snooze Rug.'],
  ],
} as const;
