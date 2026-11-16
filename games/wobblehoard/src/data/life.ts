// PLAYGROUND LIFE data: the id tables of the LIFE seam (contracts.ts PLAYGROUND block), the salt registry, the family numbers in places,
// the gaits, the look rates, the behaviour and social-moment tables, the REACT triggers, the reaction channels and their defaults, and every
// species' favourite place, thing and best friend. Specs: _spec/LIFE.md (2, 3, 3.1, 4, 4.1, 4.2, 5.2, 6.1, 7.1, 8.2, 11, 12), _spec/PLACES.md
// (2.4, 3, 5), _spec/PLAYGROUND_BUILD.md 6. Owned by the DATA lane (PG_DATA).
//
// LOADING (D-69): the post-play LIFE CHUNK. Boot code may import an id table from here (only what it uses is kept: every computed table is
// built by a /* @__PURE__ */ call, so tree shaking drops what boot does not read); the DATA lane's first-load cap is 4 KB (PLAYGROUND_BUILD 14.3).
// Every id list is APPEND-ONLY (an id may be saved or sent between lanes): DT-14 freezes them. Pure data: no DOM, no clock, no Math.random.
//
// Import order inside src/data (no cycle, every module loads first in a fresh node: probe_genome): places.ts <- life.ts <- quests.ts; the place
// modules import places.ts and life.ts; journal_text.ts imports any of them and is imported by none of them.
import type { MaterialFamilyId } from './materials.ts';
import type { SpeciesId } from './catalog.ts';
import type { PlaceId, ThingId } from './places.ts';
import { MECH } from './places.ts';

/* ═══════════════════════════════════════ the id tables of the LIFE seam ═══════════════════════════════════════ */

/** The 24 squishmoji (LIFE 7.1); 0 = none. StageLike.emote's icon. There is no heart icon (the Hoard's Heart is the protection mark). */
export const EMOTE = {
  snug: 1, hello: 2, giggle: 3, sparkle: 4, question: 5, wow: 6, zzz: 7, note: 8, star: 9, swirl: 10, puff: 11, sun: 12,
  flame: 13, snowflake: 14, droplet: 15, bubbles: 16, leaf: 17, moon: 18, ball: 19, bell: 20, shell: 21, postcard: 22, squeeze: 23, stretch: 24,
} as const;
/** Eyes-only expressions (StageLike.setBodyExpression; contracts.ts): 0 none, 1 happy, 2 sleepy, 3 surprised, 4 shy, 5 proud. */
export const EXPR = { none: 0, happy: 1, sleepy: 2, surprised: 3, shy: 4, proud: 5 } as const;
/** Creature syllables (LIFE 8.2): the first float of each 4-float syllable of SquishAudio.creature's `phrase`. */
export const SYL = { chirp: 0, coo: 1, purr: 2, hum: 3, trill: 4, yawn: 5, chitter: 6, peep: 7 } as const;
/** The player's touch kind on a character (LifeSnapshot.touchKind; -1 = none) and the TOUCH record's sub id (QUESTS 4). SQUEEZE_1S (held 1 s
 *  or more) and STRETCH_06 (a pull to level 0.6 or more) grant touch wishes (QUESTS 8); CUT is a cut that starts on a character (B13);
 *  TOSS_HARD a toss that lands faster than 3 m/s (LIFE 5.5). */
export const TOUCH = { POKE: 0, SQUEEZE: 1, STRETCH: 2, TOSS: 3, CARRY: 4, SQUEEZE_1S: 5, STRETCH_06: 6, CUT: 7, TOSS_HARD: 8 } as const;
/** LifeIntents.kind (contracts.ts). No intent kind can press, grab or lock: autonomy never pays (LIFE L3). 0 = none. */
export const INTENT = { GAZE: 1, SCOOT: 2, HOP: 3, SQUASH: 4, POSE: 5, GLIDE: 6, SETTLE: 7, EXPRESS: 8, EMOTE: 9, VOICE: 10, CANCEL: 11, USE: 12 } as const;
/** LifeSnapshot.flags bits. HELD (its own brain) = TOUCHED | CARRIED | LOCKED; "the player is touching" = TOUCHED | CARRIED, never LOCKED alone
 *  (D-86). RIDE: the player set it on a ride (D-74), cleared after 20 s, at the end of its joint moment, or on a touch. */
export const LIFE_FLAG = {
  TOUCHED: 1, CARRIED: 2, LOCKED: 4, ASLEEP: 8, GROUNDED: 16, ON_PROP: 32, IN_WATER: 64, AIRBORNE: 128, TOSSED: 256, NEW: 512, VISIBLE: 1024,
  MEMORY_BUSY: 2048, RIDE: 4096,
} as const;
/** LifeEvents.kind: what happened in LIFE this tick, for the play-event ring. SIGNATURE: B08 on its loved touch (QUESTS 4). 0 = none. */
export const LIFE_EV = { SOCIAL: 1, USE: 2, REACT: 3, WISH: 4, DISCOVER: 5, PIECES: 6, SIGNATURE: 7 } as const;
/** lifeScript ids (LIFE 4.1). */
export const SCRIPT = { FIRST_PLAY: 1, FIRST_WISH: 2, PLAY_WITH: 3, POSE: 4, CHEER: 5, SQUIRTED: 6 } as const;
/** Wish kinds (QUESTS 8; lifeWishOf out[0]; the WISH record's v). WARM = warm up or dry off. */
export const WISH_KIND = { PLACE: 1, THING: 2, RIDE: 3, FRIEND: 4, TOUCH: 5, NAP: 6, SONG: 7, WARM: 8 } as const;
/** The six look levels LIFE integrates (LIFE 3.1), in lifeLooks' out order: frost, wet, soak, sand, snow, toast. */
export const LOOK = { frost: 0, wet: 1, soak: 2, sand: 3, snow: 4, toast: 5 } as const;
/** The thing-wish glyph kinds (QUESTS 8: ball, bell, droplet, note, flame or sun), as bits of THING_KINDS (places.ts) and lifeSetJournal's
 *  thingKinds mask; each kind's glyph is the EMOTE of the same name. */
export const THING_KIND = { ball: 1, bell: 2, droplet: 4, note: 8, flame: 16, sun: 32 } as const;

/* ── the event sub ids LIFE produces (QUESTS 4; quests.ts re-exports them, so the reducer and LIFE share one table) ── */

/** REACT kinds (QUESTS 4, LIFE 4.2), LOVE included (B10 in its favourite place). */
export const REACT_KIND = {
  FLOAT: 1, WADE: 2, SOAK: 3, TOAST: 4, RISE: 5, OOZE: 6, WARM: 7, SHIVER: 8, FROST: 9, SNOWCAP: 10, GLIDE: 11, SPLASH: 12, DRIFT: 13,
  LIFT: 14, RATTLE: 15, GLOW: 16, GAZE_SKY: 17, PRINT: 18, SHOWER: 19, FIZZ: 20, HOLD_ON: 21, DRY: 22, LOVE: 23,
} as const;
/** SOCIAL moment kinds (QUESTS 4; LIFE 6.1's S01..S18: S05 is COPY, or PARADE with 3 or more). */
export const SOCIAL_KIND = {
  GREET: 1, CHAT: 2, BOOP: 3, NUZZLE: 4, COPY: 5, PARADE: 6, SING: 7, SNUGGLE: 8, PILE: 9, COMFORT: 10, TEETER: 11, PUSH: 12, PASS: 13, PEEK: 14,
  SQUIRT: 15, MIRROR: 16, ECHO: 17, DUET: 18, TWIRL: 19,
} as const;
/** USE verbs (QUESTS 4; ThingDef.verb). */
export const USE_VERB = { ROLL: 1, ROCK: 2, SWING: 3, SPIN: 4, BOUNCE: 5, RING: 6, NAP: 7, FLOAT_ON: 8, SLIDE: 9, SWITCH: 10, LISTEN: 11, LEAN: 12, WADE: 13, SHAKE: 14, STEP: 15 } as const;

/* ═══════════════════════════════════════ salts (LIFE 11; D-53: the registry lives here, not in rng.ts) ═══════════════════════════════════════ */

/** Every LIFE and chatter random stream XORs one of these into its seed. DT-11 checks they differ from each other, from the 16 constants
 *  already in src and from the two base seeds (0x57a15b00 engine.ts, 0x0d011009 genome.ts), and re-greps src for new ones. */
export const SALTS = { trait: 0x7a11fe5d, motif: 0x2545f491, duet: 0x3c6ef372, life: 0x4bd6e3b1, wish: 0x6a09e667, chatter: 0x1b873593 } as const;
