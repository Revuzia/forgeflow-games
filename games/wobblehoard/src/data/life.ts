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
/** LifeEvents.kind: what happened in LIFE this tick, for the play-event ring. SIGNATURE: B08 on its loved touch (QUESTS 4). 0 = none.
 *  SQUIRT (round 6, R6_DATA; append-only): a soaked foam the player squeezed squirts a little arc of water (the S14 squirt game, LIFE 6.1):
 *  a = the foam's slot, b = the target's slot (255: nobody within reach, the arc lands on the ground), sub = the drops to draw (12, 4 in Calm),
 *  thing = -1, n2 = 0. It is NOT a ring record: the host draws and sounds it (the render's spray arc, the audio's splash); the quest record of
 *  a squirt at a friend is the SOCIAL SQUIRT event LIFE emits beside it (a, b). See SQUIRT below. */
export const LIFE_EV = { SOCIAL: 1, USE: 2, REACT: 3, WISH: 4, DISCOVER: 5, PIECES: 6, SIGNATURE: 7, SQUIRT: 8 } as const;
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

/** REACT kinds (QUESTS 4, LIFE 4.2), LOVE included (B10 in its favourite place). RATTLE, GLOW and FIZZ belonged to the dropped places (D-96): no
 *  trigger produces them. */
export const REACT_KIND = {
  FLOAT: 1, WADE: 2, SOAK: 3, TOAST: 4, RISE: 5, OOZE: 6, WARM: 7, SHIVER: 8, FROST: 9, SNOWCAP: 10, GLIDE: 11, SPLASH: 12, DRIFT: 13,
  LIFT: 14, RATTLE: 15, GLOW: 16, GAZE_SKY: 17, PRINT: 18, SHOWER: 19, FIZZ: 20, HOLD_ON: 21, DRY: 22, LOVE: 23,
} as const;
/** SOCIAL moment kinds (QUESTS 4; LIFE 6.1's S01..S18: S05 is COPY, or PARADE with 3 or more). */
export const SOCIAL_KIND = {
  GREET: 1, CHAT: 2, BOOP: 3, NUZZLE: 4, COPY: 5, PARADE: 6, SING: 7, SNUGGLE: 8, PILE: 9, COMFORT: 10, TEETER: 11, PUSH: 12, PASS: 13, PEEK: 14,
  SQUIRT: 15, MIRROR: 16, ECHO: 17, DUET: 18, TWIRL: 19,
} as const;   // (ECHO, S16, needs an echo zone: Echo Hollow's only, dropped by D-96; no quest names it)
/** USE verbs (QUESTS 4; ThingDef.verb). */
export const USE_VERB = { ROLL: 1, ROCK: 2, SWING: 3, SPIN: 4, BOUNCE: 5, RING: 6, NAP: 7, FLOAT_ON: 8, SLIDE: 9, SWITCH: 10, LISTEN: 11, LEAN: 12, WADE: 13, SHAKE: 14, STEP: 15 } as const;

/* ═══════════════════════════════════════ salts (LIFE 11; D-53: the registry lives here, not in rng.ts) ═══════════════════════════════════════ */

/** Every LIFE and chatter random stream XORs one of these into its seed. DT-11 checks they differ from each other, from the 16 constants
 *  already in src and from the two base seeds (0x57a15b00 engine.ts, 0x0d011009 genome.ts), and re-greps src for new ones. */
export const SALTS = { trait: 0x7a11fe5d, motif: 0x2545f491, duet: 0x3c6ef372, life: 0x4bd6e3b1, wish: 0x6a09e667, chatter: 0x1b873593 } as const;

/* ═══════════════════════════════════════ the family numbers in places (PLACES 2.4) ═══════════════════════════════════════ */

/** density / soakedDensity relative to water (the float table, PLACES 2.5, DT-10; the shell writes mods[4] from them for EVERY family); soakRate
 *  per s (foams only); iceGrip x tableMu on ice; catch: the wind and updraft field catch (catchSoaked: a soaked slow-rise's); bounceGain on pads
 *  (padHoldS: the sticky families' hold before the spring); warmPose: the warm setSquash target (1 = none; toast families brown instead);
 *  coldSpeed: LIFE's gait speed factor in the cold (shiver: a 7 Hz render shiver); printDepth (m x 0.1 scale, 0..1) and printLifeS of its
 *  ground print; flavour: the voice and cut flavour index 0..5 = gel, sticky, foam, beads, dough, firm (audio/cut.ts FAMILY_FLAVOUR);
 *  mechPrefs: the mechanisms its family likes best (B04's family affinity, +0.15 each, from PLACES 3's cells). */
export interface FamilyReact { readonly density: number; readonly soakedDensity: number; readonly soakRate: number; readonly iceGrip: number; readonly catch: number;
  readonly catchSoaked?: number; readonly bounceGain: number; readonly padHoldS: number; readonly warmPose: number; readonly coldSpeed: number; readonly shiver: boolean;
  readonly toast: boolean; readonly printDepth: number; readonly printLifeS: number; readonly flavour: number; readonly mechPrefs: readonly number[] }
/** Voice flavour ids (SquishAudio.creature's flavour). */
export const FLAVOUR = { gel: 0, sticky: 1, foam: 2, beads: 3, dough: 4, firm: 5 } as const;
export const FAMILY_REACT = {
  slowrise: { density: 0.15, soakedDensity: 1.2, soakRate: 0.18, iceGrip: 0.35, catch: 0.8, catchSoaked: 0.3, bounceGain: 0.5, padHoldS: 0, warmPose: 1.0, coldSpeed: 0.6, shiver: false, toast: false, printDepth: 0.7, printLifeS: 12, flavour: FLAVOUR.foam, mechPrefs: [MECH.ring] },
  marshmallow: { density: 0.11, soakedDensity: 0.4, soakRate: 0.06, iceGrip: 0.3, catch: 1.0, bounceGain: 0.6, padHoldS: 0, warmPose: 1.0, coldSpeed: 1.0, shiver: false, toast: true, printDepth: 0.4, printLifeS: 6, flavour: FLAVOUR.foam, mechPrefs: [MECH.ring, MECH.pad] },
  mochidough: { density: 1.1, soakedDensity: 1.1, soakRate: 0, iceGrip: 0.4, catch: 0.2, bounceGain: 0.45, padHoldS: 0, warmPose: 1.06, coldSpeed: 0.7, shiver: false, toast: false, printDepth: 0.8, printLifeS: 40, flavour: FLAVOUR.dough, mechPrefs: [MECH.ring] },
  jellygel: { density: 1.02, soakedDensity: 1.02, soakRate: 0, iceGrip: 0.15, catch: 0.35, bounceGain: 1.1, padHoldS: 0, warmPose: 0.92, coldSpeed: 1.0, shiver: true, toast: false, printDepth: 0.25, printLifeS: 8, flavour: FLAVOUR.gel, mechPrefs: [MECH.ball, MECH.pad] },
  waterfill: { density: 1.0, soakedDensity: 1.0, soakRate: 0, iceGrip: 0.15, catch: 0.25, bounceGain: 1.0, padHoldS: 0, warmPose: 1.0, coldSpeed: 1.0, shiver: true, toast: false, printDepth: 0.2, printLifeS: 6, flavour: FLAVOUR.gel, mechPrefs: [MECH.ball, MECH.pool] },
  putty: { density: 1.25, soakedDensity: 1.25, soakRate: 0, iceGrip: 0.45, catch: 0.1, bounceGain: 0.4, padHoldS: 0, warmPose: 0.97, coldSpeed: 0.7, shiver: false, toast: false, printDepth: 1.0, printLifeS: 120, flavour: FLAVOUR.dough, mechPrefs: [MECH.ring, MECH.mound] },
  stickystretch: { density: 1.05, soakedDensity: 1.05, soakRate: 0, iceGrip: 0.7, catch: 0.15, bounceGain: 0.6, padHoldS: 0.4, warmPose: 0.95, coldSpeed: 1.0, shiver: true, toast: false, printDepth: 0.4, printLifeS: 20, flavour: FLAVOUR.sticky, mechPrefs: [MECH.ball, MECH.swing] },
  slimegoo: { density: 1.08, soakedDensity: 1.08, soakRate: 0, iceGrip: 0.8, catch: 0.1, bounceGain: 0.5, padHoldS: 0.6, warmPose: 0.82, coldSpeed: 0.5, shiver: false, toast: false, printDepth: 0.6, printLifeS: 30, flavour: FLAVOUR.sticky, mechPrefs: [MECH.ring] },
  firmsilicone: { density: 1.15, soakedDensity: 1.15, soakRate: 0, iceGrip: 0.08, catch: 0.1, bounceGain: 1.25, padHoldS: 0, warmPose: 1.0, coldSpeed: 1.15, shiver: false, toast: false, printDepth: 0.15, printLifeS: 5, flavour: FLAVOUR.firm, mechPrefs: [MECH.pad, MECH.ball, MECH.swing] },
  popdome: { density: 0.14, soakedDensity: 0.14, soakRate: 0, iceGrip: 0.1, catch: 0.6, bounceGain: 1.2, padHoldS: 0, warmPose: 1.0, coldSpeed: 1.15, shiver: false, toast: false, printDepth: 0.15, printLifeS: 5, flavour: FLAVOUR.firm, mechPrefs: [MECH.pad, MECH.turntable] },
  gummy: { density: 1.1, soakedDensity: 1.1, soakRate: 0, iceGrip: 0.12, catch: 0.3, bounceGain: 1.15, padHoldS: 0, warmPose: 0.92, coldSpeed: 1.0, shiver: true, toast: false, printDepth: 0.25, printLifeS: 8, flavour: FLAVOUR.gel, mechPrefs: [MECH.ball, MECH.pad] },
  beadsqueeze: { density: 1.45, soakedDensity: 1.45, soakRate: 0, iceGrip: 0.25, catch: 0.15, bounceGain: 0.8, padHoldS: 0, warmPose: 1.0, coldSpeed: 1.0, shiver: false, toast: false, printDepth: 0.6, printLifeS: 30, flavour: FLAVOUR.beads, mechPrefs: [MECH.chime, MECH.ball] },
} as const satisfies Record<MaterialFamilyId, FamilyReact>;

/* ═══════════════════════════════════════ gaits (LIFE 5.2) ═══════════════════════════════════════ */

/** squash: the anticipation squash (1 = none: putty and slime goo never hop); vyS1 / vyS2: the hop speed (S1 cap 0.84 m/s for every family,
 *  apex 0.84^2 / (2 x 10) = 3.53 cm with the physics' GRAVITY 10; S2 raises it after PH-01); stepsPerS; glide m/s (scootTo speed);
 *  memoryGated: no squash, pose or hop while its plastic memory has not converged (LIFE 5.4); maxHopsPerMin: mochi dough, 1 per 6 s. */
export interface Gait { readonly name: string; readonly squash: number; readonly vyS1: number; readonly vyS2: number; readonly stepsPerS: number; readonly glide: number;
  readonly hops: boolean; readonly memoryGated: boolean; readonly maxHopsPerMin?: number }
export const GAITS = {
  slowrise: { name: 'sink', squash: 0.78, vyS1: 0.6, vyS2: 0.9, stepsPerS: 0.5, glide: 0.18, hops: true, memoryGated: false },
  marshmallow: { name: 'pad', squash: 0.75, vyS1: 0.7, vyS2: 1.1, stepsPerS: 0.9, glide: 0.22, hops: true, memoryGated: false },
  mochidough: { name: 'plod', squash: 0.9, vyS1: 0.45, vyS2: 0.6, stepsPerS: 0.6, glide: 0.18, hops: true, memoryGated: true, maxHopsPerMin: 10 },
  jellygel: { name: 'jiggle', squash: 0.84, vyS1: 0.8, vyS2: 1.2, stepsPerS: 1.2, glide: 0.26, hops: true, memoryGated: false },
  waterfill: { name: 'slosh', squash: 0.86, vyS1: 0.7, vyS2: 1.0, stepsPerS: 0.8, glide: 0.22, hops: true, memoryGated: false },
  putty: { name: 'shuffle', squash: 1, vyS1: 0, vyS2: 0, stepsPerS: 0, glide: 0.12, hops: false, memoryGated: true },
  stickystretch: { name: 'peel', squash: 0.85, vyS1: 0.75, vyS2: 1.1, stepsPerS: 0.9, glide: 0.2, hops: true, memoryGated: false },
  slimegoo: { name: 'ooze', squash: 1, vyS1: 0, vyS2: 0, stepsPerS: 0, glide: 0.1, hops: false, memoryGated: false },
  firmsilicone: { name: 'boing', squash: 0.88, vyS1: 0.84, vyS2: 1.55, stepsPerS: 1.4, glide: 0.32, hops: true, memoryGated: false },
  popdome: { name: 'bob', squash: 0.9, vyS1: 0.8, vyS2: 1.4, stepsPerS: 1.1, glide: 0.28, hops: true, memoryGated: false },
  gummy: { name: 'chew', squash: 0.86, vyS1: 0.75, vyS2: 1.2, stepsPerS: 1.6, glide: 0.28, hops: true, memoryGated: false },
  beadsqueeze: { name: 'crunch', squash: 0.86, vyS1: 0.7, vyS2: 0.9, stepsPerS: 0.8, glide: 0.22, hops: true, memoryGated: true },
} as const satisfies Record<MaterialFamilyId, Gait>;
/** The S1 hop cap (m/s) and what pieces do (LIFE 5.2): vy x 0.8, horizontal x cbrt(frac); Calm or reduced motion: heights x 0.6, chains of 3. */
export const HOP = { capS1: 0.84, pieceVy: 0.8, calmScale: 0.6, calmChain: 3, minGapS: 0.8 } as const;

/* ═══════════════════════════════════════ looks (LIFE 3.1) ═══════════════════════════════════════ */

/** Per look: rise per s (x the cause's strength where it has one), its cap, and its falls per s (only while its rising cause is absent).
 *  frost: x the cold strength; soak: the family's soakRate (foams) in water or rain; sand: on sand while moving (cap 0.6); snow: on snow while
 *  still (cap 0.3) and the host's adds; toast: x the warmth, capped at 0.75 x the warmth where it stands (Home's lamp 0.4 gives 0.3), toast
 *  families only. A look crossing 0.5 upward emits its REACT once per visit (REACT_TRIGGERS). */
export const LOOK_RATES = {
  frost: { rise: 0.05, cap: 1, fallWarm: 0.1, fall: 0.02 },
  wet: { rise: 0.3, cap: 1, fallWarm: 0.15, fall: 0.05 },
  soak: { rise: 1, cap: 1, fallWarm: 0.1, fall: 0.02 },
  sand: { rise: 0.1, cap: 0.6, fallWarm: 0.02, fall: 0.02 },
  snow: { rise: 0.03, cap: 0.3, fallWarm: 0.1, fall: 0.2 },
  toast: { rise: 0.04, cap: 0.75, fallWarm: 0.01, fall: 0.01 },
} as const satisfies Record<keyof typeof LOOK, { rise: number; cap: number; fallWarm: number; fall: number }>;
/** The host's lifeAddLook amounts (LIFE 3.1, PLACES 4.2 to 4.4, S14): look id, amount, radius m (0 = the target only), seconds it lasts.
 *  The kettle's steam reaches 1.2 m: PLACES 4.2 wins over LIFE 3.1's "within 0.6 m" (the orchestrator's ruling, 2026-11-16, PG_DATA round 2);
 *  the host applies it to every body within `r` of the kettle. */
export const LOOK_ADD = {
  pinePuff: { look: LOOK.snow, amount: 0.5, r: 0.7, thing: 'shakepine' },
  snowball: { look: LOOK.snow, amount: 0.3, r: 0, thing: 'snowball' },
  kettleSteam: { look: LOOK.wet, amount: 0.2, r: 1.2, forS: 4, thing: 'kettle' },
  squirtTarget: { look: LOOK.wet, amount: 0.3, r: 0, thing: '' },
  squirtFoam: { look: LOOK.soak, amount: -0.4, r: 0, thing: '' },
} as const satisfies Record<string, { look: number; amount: number; r: number; forS?: number; thing: ThingId | '' }>;
/** The squirt game (LIFE 6.1 S14, PLACES 4.3 "soak a foam in the pool, then squeeze it to squirt a friend"; round 6, the orchestrator's decision:
 *  "a squishy that has soaked in the Rock Pool and is then squeezed by the player squirts a little arc of water"). LIFE detects it in its touch
 *  pass: the player's squeeze of a WHOLE whose soak look is at least `soakMin` (only foams soak: slow rise and marshmallow, in water or rain),
 *  held at least `holdS` (a tap is never a squeeze, QUESTS Q3; the keyboard's Space squeeze is the same press). The target: the nearest other
 *  character (whole or piece) whose body is within `reach` m of the foam's (the gap between the two surfaces; a keyboard squeeze uses the same
 *  rule). Then: LIFE_EV.SQUIRT (the arc, always), and with a target a SOCIAL SQUIRT event (S14, 1 friendship point: R7 "A squirt for a friend"
 *  counts it at Ripple Shore), the target's wet look +0.3 (LOOK_ADD.squirtTarget), its wow then giggle (SCRIPT.SQUIRTED's reaction); the foam's
 *  soak -0.4 (LOOK_ADD.squirtFoam: the water is squeezed out, so the next squirt needs another soak). `drops` / `dropsCalm` and `arcS` are the
 *  render's spray (12 drops over 0.4 s; 4 in Calm or reduced motion). */
export const SQUIRT = { soakMin: 0.5, holdS: 0.4, reach: 1.2, drops: 12, dropsCalm: 4, arcS: 0.4 } as const;
/** Needs (LIFE 3): start levels each time a squishy comes out, rise and fall per s of sim time (x (0.5 + the trait)), the thresholds. */
export const NEEDS = {
  start: { play: 0.3, company: 0.3, rest: 0.2 },
  play: { rise: 0.01, use: -0.3, loved: -0.4, touch: -0.2, toss: -0.4 },
  company: { rise: 0.008, alone: 2, social: -0.5, friendNear: -0.2, touch: -0.3 },
  rest: { rise: 0.004, riseActive: 0.01, warmFactor: 1.5, nap: -0.02 },
  high: 0.8, comfort: 0.5,
} as const;

/* ═══════════════════════════════════════ behaviours (LIFE 4) and social moments (LIFE 6.1) ═══════════════════════════════════════ */

/** Who may run it: a bit each for a whole squishy, a face piece and a chunk. */
export const WHO = { W: 1, F: 2, C: 4 } as const;
/** base: the trigger score before trait and need factors (LIFE 4's score column); moves: 0 still, 1 moves (a mover token, LIFE 10.3), 2 one
 *  hop or a pulse through the gate; durS: [min, max] s it runs (0 = until something better or its own end); cooldownS (perVisit: once per
 *  visit per target); who: WHO bits. */
export interface BehaviourDef { readonly id: number; readonly name: string; readonly base: number; readonly moves: 0 | 1 | 2; readonly durS: readonly [number, number];
  readonly cooldownS: number; readonly perVisit?: boolean; readonly who: number }
export const BEHAVIOURS: readonly BehaviourDef[] = [
  { id: 1, name: 'idle', base: 0.1, moves: 0, durS: [0, 0], cooldownS: 0, who: 7 },
  { id: 2, name: 'notice', base: 0.9, moves: 0, durS: [1.5, 1.5], cooldownS: 4, perVisit: true, who: 3 },
  { id: 3, name: 'wander', base: 0.3, moves: 1, durS: [0, 0], cooldownS: 6, who: 3 },
  { id: 4, name: 'use', base: 0.3, moves: 1, durS: [3, 12], cooldownS: 15, who: 3 },
  { id: 5, name: 'bask', base: 0.7, moves: 1, durS: [0, 15], cooldownS: 20, who: 3 },
  { id: 6, name: 'nap', base: 0.8, moves: 1, durS: [30, 90], cooldownS: 30, who: 7 },
  { id: 7, name: 'wish', base: 0.7, moves: 0, durS: [0, 0], cooldownS: 0, who: 3 },
  { id: 8, name: 'afterglow', base: 1.0, moves: 0, durS: [1.5, 1.5], cooldownS: 0, who: 7 },
  { id: 9, name: 'arrive', base: 1.0, moves: 2, durS: [1, 1], cooldownS: 0, perVisit: true, who: 7 },
  { id: 10, name: 'love', base: 0.95, moves: 0, durS: [2, 2], cooldownS: 0, perVisit: true, who: 3 },
  { id: 11, name: 'comeback', base: 1.0, moves: 1, durS: [0, 0], cooldownS: 0, who: 7 },
  { id: 12, name: 'pose', base: 1.0, moves: 0, durS: [0, 0], cooldownS: 0, who: 3 },
  { id: 13, name: 'watch', base: 0.6, moves: 0, durS: [0, 0], cooldownS: 0, who: 3 },
  { id: 14, name: 'cheer', base: 1.0, moves: 2, durS: [1.2, 1.2], cooldownS: 0, who: 3 },
  { id: 15, name: 'zone', base: 0.95, moves: 0, durS: [2, 4], cooldownS: 0, perVisit: true, who: 7 },
  { id: 16, name: 'huff', base: 0.5, moves: 0, durS: [0, 3], cooldownS: 300, who: 1 },
  { id: 17, name: 'comfort', base: 0.85, moves: 1, durS: [3, 3], cooldownS: 30, who: 3 },
  { id: 18, name: 'answer', base: 0.7, moves: 0, durS: [0, 0], cooldownS: 20, who: 3 },
  { id: 19, name: 'holdon', base: 0.8, moves: 0, durS: [0, 0], cooldownS: 0, who: 7 },
  { id: 20, name: 'ride', base: 1.0, moves: 0, durS: [0, 20], cooldownS: 0, who: 7 },
];
/** Behaviour rules with numbers (LIFE 4, 5.5): the seeded noise, the stickiness of the running behaviour, the notice and perception radii, the
 *  huff's quiet first minute, the release grace, the shy arrival, the ride's stay, the toast hop-back. */
export const BRAIN = { noise: 0.05, keep: 0.15, thinkS: 0.1, noticeR: 1.5, perceive0: 1.2, perceiveCurious: 1.0, useR: 3, keepOut: 0.4, huffQuietS: 60, huffMaxS: 3,
  graceS: 1.5, shyS: 20, shyExtra: 0.5, helloWithinS: 5, rideS: 20, toastHopAt: 0.6, toastHop: 0.3, waterMaxS: 30, partnerWaitS: 2, dizzyTosses: 3, dizzyWindowS: 20 } as const;
/** id: S01..S18; kind: SOCIAL_KIND; who: WHO bits; points: friendship points per pair (LIFE 6.2; maxPerVisit for chat); r: the start radius
 *  (m; 0 = contact or set by a ride); durS: [min, max]; perVisit: once per pair per visit. */
export interface SocialDef { readonly id: number; readonly kind: number; readonly who: number; readonly points: number; readonly r: number; readonly durS: readonly [number, number];
  readonly perVisit?: boolean; readonly maxPerVisit?: number }
export const SOCIAL: readonly SocialDef[] = [
  { id: 1, kind: SOCIAL_KIND.GREET, who: 3, points: 1, r: 1.6, durS: [2.5, 2.5], perVisit: true },
  { id: 2, kind: SOCIAL_KIND.CHAT, who: 1, points: 1, r: 1.5, durS: [3, 5], maxPerVisit: 3 },
  { id: 3, kind: SOCIAL_KIND.BOOP, who: 3, points: 1, r: 1.2, durS: [0.6, 1.5] },
  { id: 4, kind: SOCIAL_KIND.NUZZLE, who: 3, points: 2, r: 1.0, durS: [3, 6] },
  { id: 5, kind: SOCIAL_KIND.COPY, who: 7, points: 1, r: 2.0, durS: [2, 8] },
  { id: 6, kind: SOCIAL_KIND.SING, who: 7, points: 1, r: 2.5, durS: [7.3, 7.3] },
  { id: 7, kind: SOCIAL_KIND.SNUGGLE, who: 7, points: 1, r: 2.5, durS: [8, 8] },
  { id: 8, kind: SOCIAL_KIND.PILE, who: 7, points: 1, r: 0, durS: [30, 90] },
  { id: 9, kind: SOCIAL_KIND.COMFORT, who: 3, points: 2, r: 2.5, durS: [3, 3] },
  { id: 10, kind: SOCIAL_KIND.TEETER, who: 7, points: 2, r: 0, durS: [6, 12] },
  { id: 11, kind: SOCIAL_KIND.PUSH, who: 3, points: 1, r: 2.5, durS: [8, 12] },
  { id: 12, kind: SOCIAL_KIND.PASS, who: 7, points: 1, r: 2.5, durS: [3, 10] },
  { id: 13, kind: SOCIAL_KIND.PEEK, who: 3, points: 1, r: 3.0, durS: [4, 4] },
  { id: 14, kind: SOCIAL_KIND.SQUIRT, who: 1, points: 1, r: 1.2, durS: [1.5, 1.5] },
  { id: 15, kind: SOCIAL_KIND.MIRROR, who: 1, points: 0, r: 2.0, durS: [4, 4], perVisit: true },
  { id: 16, kind: SOCIAL_KIND.ECHO, who: 3, points: 1, r: 0, durS: [3, 6] },
  { id: 17, kind: SOCIAL_KIND.DUET, who: 1, points: 2, r: 2.5, durS: [7.3, 7.3], perVisit: true },
  { id: 18, kind: SOCIAL_KIND.TWIRL, who: 1, points: 2, r: 2.0, durS: [3, 3], perVisit: true },
];
/** Friendship (LIFE 6.2): the level thresholds in points, the daily cap per pair, the best-friend bonus, the sparse table's size. */
export const FRIENDSHIP = { met: 1, friends: 12, close: 40, perDay: 20, bestBonus: 1.5, maxRows: 128 } as const;
/** Warmth (LIFE 6.3): per instance 0..50, its five glow dots, the gains and their daily caps. */
export const WARMTH = { max: 50, dots: [5, 15, 25, 35, 50], loved: 1, lovedPerDay: 3, wish: 3, favPlace: 2, favNap: 1 } as const;

/* ═══════════════════════════════════════ words the life chunk shows (D-42: only the bubble words; the rest is journal_text.ts) ═══════════════════════════════════════ */

/** The five trait words, in LIFE 2's order (the Journal shows the two furthest above their medians; the medians follow). */
export const TRAIT_WORDS = ['bouncy', 'curious', 'cuddly', 'chatty', 'dozy'] as const;
export const TRAIT_MEDIANS = [0.52, 0.53, 0.39, 0.65, 0.37] as const;
/** The one-word label under a bubble (LIFE 7.2: the first three a new player sees, then only with "Words under bubbles" on), per EMOTE id
 *  (index 0 unused). It ships in the life chunk, not the lazy text, because bubbles show from the first minute. */
export const BUBBLE_WORDS: readonly string[] = ['', 'snug', 'hello', 'giggly', 'loves it', 'curious', 'wow', 'sleepy', 'singing', 'did it', 'whee', 'hmph', 'warm',
  'toasty', 'chilly', 'splash', 'fizzy', 'calm', 'moon', 'play', 'ding', 'shell', 'a trip', 'squeeze', 'stretch'];
/** What a tapped bubble means (LIFE 7.1, shown for 2 s; H6 "Tap a bubble" is a Home quest, so it ships with the bubbles), per EMOTE id. */
export const BUBBLE_MEANINGS: readonly string[] = ['', 'I like you', 'Hello!', 'Hee hee!', 'Ooh, wow!', "What's that?", 'Oh!', 'Sleepy...', 'La la la!', 'I did it!', 'Whee!',
  'Hmph!', 'Warm and happy', 'Toasty!', 'Brr, chilly', 'Splash!', 'Fizzy!', 'So calm', 'The moon!', "Let's play!", 'Ding!', 'A shell!', 'I want to go somewhere',
  'A slow squeeze, please', 'A big stretch, please'];
/** The star bubble's two other meanings (LIFE 7.1): in a thought bubble (a ride wish) and beside a lone rider (B20). */
export const STAR_MEANINGS = { wish: 'A ride, please!', rider: 'Ride with me!' } as const;

/* ═══════════════════════════════════════ reaction channels (D-80) and PLACES 3's defaults ═══════════════════════════════════════ */

/** Every reaction cell's channel (PlaceDef.reactions, DEFAULT_REACTIONS). How to read `arg` per channel:
 *  PHYS: PHYS_ARG (the physics the family numbers drive: water density, ground grip, prop contact, pad gain, field catch);
 *  POSE: the setSquash target x 100 (96 = 0.96); RPOSE: RPOSE (setBodyPose: lean, sway, wiggle, shiver, breathing);
 *  LOOK: LOOK id x 100 + the level in hundredths (560 = toast 0.60; level 1 = falling toward 0, "dries out"); PARTICLE: PARTICLE;
 *  SOUND: REACT_SOUND; BEHAV: the behaviour number 1..20 (B06 nap = 6), 21 = the family's cold gait (FAMILY_REACT.coldSpeed), 100 + n =
 *  social moment S<n> (113 peekaboo, 105 follow the leader); MARK: places.ts MARK (the ground mark it leaves). DT-06 counts these. */
export const CHANNEL = { PHYS: 1, POSE: 2, RPOSE: 3, LOOK: 4, PARTICLE: 5, SOUND: 6, BEHAV: 7, MARK: 8 } as const;
export const PHYS_ARG = { water: 1, grip: 2, contact: 3, pad: 4, field: 5 } as const;
export const RPOSE = { lean: 1, sway: 2, wiggle: 3, shiver: 4, breath: 5 } as const;
export const PARTICLE = { steam: 1, embers: 2, sparkles: 3, drips: 4, bubbles: 5, strands: 6, glow: 7, ripple: 8, puff: 9 } as const;
/** voice: a creature phrase LIFE plans (an answer, a hum, a coo); strike: the struck thing's own note at the family's strike (a clear ring, a
 *  dull tap); the rest are short family sounds the audio lane synthesises. */
export const REACT_SOUND = { voice: 1, strike: 2, splash: 3, plip: 4, puff: 5, squelch: 6, peel: 7, rattle: 8, crunch: 9, sizzle: 10, thud: 11, fizz: 12, squeak: 13 } as const;
export const BEHAV_COLD_GAIT = 21;

/** PLACES 3's default columns, each with the mechanisms or zone kinds it stands for (a thing with no cell of its own takes these). */
export const DEFAULT_COLUMNS = {
  pool: { zone: 1, deep: true }, shallow: { zone: 1, deep: false }, rain: { zone: 8 }, warm: { zone: 6 }, cold: { zone: 7 },
  ice: { patch: 'ice' }, ground: { patch: 'mark' }, air: { zone: 3, zone2: 4 }, pad: { mech: MECH.pad },
  ride: { mech: MECH.ramp, mechs: [MECH.ramp, MECH.seesaw, MECH.swing, MECH.turntable, MECH.floater] }, ball: { mech: MECH.ball },
  ring: { mech: MECH.ring }, chime: { mech: MECH.chime }, magnet: { zone: 5 }, echo: { zone: 9 }, tune: { switch: 'tune' },
} as const;
export type DefaultColumn = keyof typeof DEFAULT_COLUMNS;
export interface DefaultReaction { readonly tag: 'P' | 'L' | 'S' | 'B'; readonly chan: number; readonly arg: number }
/** Unpack a default column: per family (MATERIAL_FAMILY_IDS order) a count, then [tag 0..3, chan, arg] x count. */
function unpackDefaults(src: Readonly<Record<DefaultColumn, readonly number[]>>): Readonly<Record<DefaultColumn, readonly (readonly DefaultReaction[])[]>> {
  const tags = ['P', 'L', 'S', 'B'] as const, out = {} as Record<DefaultColumn, DefaultReaction[][]>;
  for (const key of Object.keys(src) as DefaultColumn[]) {
    const a = src[key], col: DefaultReaction[][] = [];
    for (let i = 0; i < a.length;) { const n = a[i++], cell: DefaultReaction[] = []; for (let k = 0; k < n; k++, i += 3) cell.push({ tag: tags[a[i]], chan: a[i + 1], arg: a[i + 2] }); col.push(cell); }
    out[key] = col;
  }
  return out;
}
/** PLACES 3.1 to 3.3, every cell's channels per family (D-80), generated from the page by the DATA lane's cell mapper (its words do not ship). */
export const DEFAULT_REACTIONS: Readonly<Record<DefaultColumn, readonly (readonly DefaultReaction[])[]>> = /* @__PURE__ */ unpackDefaults({
  pool: [3,0,1,1,1,4,250,2,6,3,1,0,1,1,1,1,4,130,1,1,4,130,1,1,4,130,2,0,1,1,1,4,130,1,1,4,130,1,1,5,8,1,2,6,3,1,0,1,1,1,1,4,130,1,2,6,8],
  shallow: [2,1,4,250,2,6,4,2,1,4,130,2,6,5,2,2,6,6,1,8,1,1,2,6,3,1,2,6,3,2,1,8,1,2,6,11,1,2,6,7,1,1,8,2,1,2,6,3,1,2,6,3,1,2,6,3,1,2,6,3],
  rain: [1,1,4,250,1,1,4,250,1,1,4,130,1,1,4,130,1,1,4,130,1,1,5,4,1,1,4,130,2,1,5,4,2,6,4,1,1,4,130,1,1,4,130,1,1,4,130,1,2,6,4],
  warm: [2,1,4,201,3,7,5,2,1,4,560,2,6,10,1,0,2,106,2,0,2,92,1,4,130,1,1,5,1,1,0,2,97,1,0,2,95,1,0,2,82,1,3,3,5,1,3,3,5,2,0,2,92,1,4,130,1,2,6,8],
  cold: [3,0,2,96,3,7,6,1,4,50,2,0,2,104,1,4,50,2,3,7,21,1,4,50,2,3,3,4,1,4,50,2,3,3,4,1,4,50,1,3,7,21,1,3,3,4,1,3,7,21,1,3,7,21,1,3,7,21,1,3,3,4,1,2,6,8],
  ice: [1,0,1,2,1,0,1,2,1,0,1,2,1,0,1,2,1,0,1,2,1,0,1,2,1,0,1,2,2,0,1,2,1,8,2,1,0,1,2,1,0,1,2,1,0,1,2,2,0,1,2,2,6,8],
  ground: [1,1,8,1,1,1,8,1,1,1,8,1,1,1,8,1,1,1,8,1,1,1,8,1,1,1,8,1,1,1,8,2,1,1,8,1,1,1,8,1,1,1,8,1,1,1,8,1],
  air: [1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,0,1,5,1,2,6,8],
  pad: [1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,1,0,1,4,2,0,1,4,2,6,8],
  ride: [2,1,1,3,3,7,20,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,2,6,8],
  ball: [1,3,7,4,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,3,7,4,1,2,6,8],
  ring: [1,3,7,6,1,0,1,3,1,0,1,3,1,0,1,3,1,1,7,6,1,0,1,3,1,1,5,6,1,0,1,3,1,3,7,6,1,0,1,3,1,0,1,3,1,2,6,8],
  chime: [1,2,6,2,1,2,6,2,1,2,6,2,1,2,6,2,1,2,6,2,1,2,6,2,1,1,1,3,1,2,6,2,1,2,6,2,1,2,6,2,1,2,6,2,1,2,6,2],
  magnet: [1,3,7,13,1,3,7,13,1,3,7,13,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,0,1,3,1,3,7,4,2,3,7,4,2,6,8],
  echo: [1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1,1,2,6,1],
  tune: [1,3,3,2,1,3,3,2,1,3,3,2,1,3,3,2,1,3,3,2,1,3,3,1,1,3,3,2,1,3,3,2,1,3,7,18,1,3,7,18,1,3,3,2,1,2,6,8],
});

/* ═══════════════════════════════════════ REACT triggers (LIFE 4.2; D-72, DT-15, LF-21) ═══════════════════════════════════════ */

/** The producer conditions. IN_WATER_FLOAT: in a water zone and not grounded for forS; IN_WATER_WADE: in water with a surface of `min` m or
 *  more, grounded, for forS; LOOK_UP: look `arg` crosses `min` upward (a lifeAddLook of it fires every time: `addEvent`); POSE_AT: warm pose
 *  `arg` (x 100) reached for family `fam` in a warm zone of `min` or more; IN_ZONE: inside a zone of kind `arg` with strength `min` or more for
 *  forS (`shiverOnly`: a family with `shiver`); GLIDE: a glide on a patch of grip under `arg` that carries it `min` m; LAND_SHALLOW: a landing
 *  in water with a surface under `min` m; CURRENT: floating and carried `min` m by a current; UPDRAFT: airborne in an updraft for forS;
 *  NEAR_MAGNET: a bead squeeze within `min` m of a switched-on magnet; GLOW_WATER: in a glowing water zone for forS; SKY: idle within `min` m of
 *  a sky thing for forS at night (or on screen when the comet crosses: `addEvent`); FIRST_PRINT: its first print mark on a marking ground;
 *  UNDER_DRIP: under a shower zone while it drips for forS; FIZZ_ZONE: in the Bubble Patch for forS; BEHAVIOUR: behaviour `arg` starts;
 *  LOOK_DRY: soak or wet falls under `min` in a warm zone after reaching 0.5. */
export const REACT_COND = { IN_WATER_FLOAT: 1, IN_WATER_WADE: 2, LOOK_UP: 3, POSE_AT: 4, IN_ZONE: 5, GLIDE: 6, LAND_SHALLOW: 7, CURRENT: 8, UPDRAFT: 9, NEAR_MAGNET: 10,
  GLOW_WATER: 11, SKY: 12, FIRST_PRINT: 13, UNDER_DRIP: 14, FIZZ_ZONE: 15, BEHAVIOUR: 16, LOOK_DRY: 17 } as const;
/** once 'visit': once per character per zone or thing per visit; 'event': every time, after cooldownS. thing: where the REACT's thing comes
 *  from: the zone's owning thing (LifeSnapshot.zoneThing), the patch's (patchThing), the source thing of the lifeAddLook or switch that caused
 *  it, or none (-1). addEvent: a lifeAddLook (or the comet) also fires it, every time, with its source thing. */
/** D-96: RATTLE (Cogwhistle's magnet), GLOW (Echo Hollow's Glow Pool) and FIZZ (Fizzwell's Bubble Patch) have no row: only the dropped places
 *  could produce them, so no quest, fact or line names them (their REACT_KIND and REACT_COND ids stay, append-only, unused). */
export interface ReactTrigger { readonly kind: number; readonly cond: number; readonly arg: number; readonly min?: number; readonly forS?: number; readonly fam?: MaterialFamilyId;
  readonly shiverOnly?: boolean; readonly once: 'visit' | 'event'; readonly cooldownS: number; readonly thing: 'zone' | 'patch' | 'source' | 'none'; readonly addEvent?: boolean }
export const REACT_TRIGGERS: readonly ReactTrigger[] = [
  { kind: REACT_KIND.FLOAT, cond: REACT_COND.IN_WATER_FLOAT, arg: 0, forS: 1, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.WADE, cond: REACT_COND.IN_WATER_WADE, arg: 0, min: 0.12, forS: 1, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.SOAK, cond: REACT_COND.LOOK_UP, arg: LOOK.soak, min: 0.5, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.TOAST, cond: REACT_COND.LOOK_UP, arg: LOOK.toast, min: 0.5, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.RISE, cond: REACT_COND.POSE_AT, arg: 106, min: 0.6, fam: 'mochidough', once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.OOZE, cond: REACT_COND.POSE_AT, arg: 82, min: 0.6, fam: 'slimegoo', once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.WARM, cond: REACT_COND.IN_ZONE, arg: 6, min: 0.5, forS: 2, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.SHIVER, cond: REACT_COND.IN_ZONE, arg: 7, min: 0, forS: 2, shiverOnly: true, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.FROST, cond: REACT_COND.LOOK_UP, arg: LOOK.frost, min: 0.5, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.SNOWCAP, cond: REACT_COND.LOOK_UP, arg: LOOK.snow, min: 0.5, once: 'visit', cooldownS: 0, thing: 'source', addEvent: true },
  { kind: REACT_KIND.GLIDE, cond: REACT_COND.GLIDE, arg: 0.5, min: 0.5, once: 'event', cooldownS: 10, thing: 'patch' },
  { kind: REACT_KIND.SPLASH, cond: REACT_COND.LAND_SHALLOW, arg: 0, min: 0.12, once: 'event', cooldownS: 5, thing: 'zone' },
  { kind: REACT_KIND.DRIFT, cond: REACT_COND.CURRENT, arg: 0, min: 0.3, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.LIFT, cond: REACT_COND.UPDRAFT, arg: 0, forS: 0.3, once: 'event', cooldownS: 5, thing: 'zone' },
  { kind: REACT_KIND.GAZE_SKY, cond: REACT_COND.SKY, arg: 0, min: 1.5, forS: 3, once: 'visit', cooldownS: 0, thing: 'source', addEvent: true },
  { kind: REACT_KIND.PRINT, cond: REACT_COND.FIRST_PRINT, arg: 0, once: 'visit', cooldownS: 0, thing: 'patch' },
  { kind: REACT_KIND.SHOWER, cond: REACT_COND.UNDER_DRIP, arg: 0, forS: 1, once: 'event', cooldownS: 20, thing: 'zone' },
  { kind: REACT_KIND.HOLD_ON, cond: REACT_COND.BEHAVIOUR, arg: 19, once: 'event', cooldownS: 0, thing: 'none' },
  { kind: REACT_KIND.DRY, cond: REACT_COND.LOOK_DRY, arg: LOOK.soak, min: 0.1, once: 'visit', cooldownS: 0, thing: 'zone' },
  { kind: REACT_KIND.LOVE, cond: REACT_COND.BEHAVIOUR, arg: 10, once: 'visit', cooldownS: 0, thing: 'none' },
];

/* ═══════════════════════════════════════ favourites and best friends (PLACES 5; DT-03, DT-04) ═══════════════════════════════════════ */

/** A species' favourite place and thing and its best friend (one of 25 authored, symmetric pairs). Species facts, never per instance.
 *  D-96 (round 6): the 17 fans of the three dropped places are re-homed to a kept place's thing of the same kind of use (a ride to a ride, a
 *  pool to a pool, a bell to a bell, a switch to a switch; every family still in 2+ places, a Common in each; Hearthlog's six unchanged, so the
 *  live cabin is as it was): Plumpet, Glugbean and Tadpolo to Lanternroof (Rainleaf's gift list is now Lanternroof's: the next place to open),
 *  Gloopsy, Kneadle and Fossilo to Ripple Shore, Thudge, Spirelo, Cindergoo and Ambrosel to Frostbell Ridge, Rattlebead, Glimglop and Burrbin to
 *  Rainleaf Garden, Cushlet, Flipdome, Dimpla and Prismelo to Cloudloft (8 / 9 / 9 / 9 / 9 fans; the old pair on each line's comment). */
export interface SpeciesLife { readonly place: PlaceId; readonly thing: ThingId; readonly friend: SpeciesId }
export const SPECIES_LIFE = {
  dollop: { place: 'hearthlog', thing: 'yarnball', friend: 'crimpo' },
  plumpet: { place: 'lanternroof', thing: 'hammock', friend: 'wisplet' },   // D-96: was fizzwell / spongeraft
  twangle: { place: 'cloudloft', thing: 'kiteswing', friend: 'chunkle' },
  puddlo: { place: 'ripple', thing: 'rockpool', friend: 'boingle' },
  glugbean: { place: 'lanternroof', thing: 'moondish', friend: 'thumbly' },   // D-96: was fizzwell / bathwater
  crumbit: { place: 'ripple', thing: 'shellchimes', friend: 'cushlet' },
  chunkle: { place: 'lanternroof', thing: 'lanternline', friend: 'twangle' },
  munchip: { place: 'rainleaf', thing: 'mossbouncer', friend: 'dimpla' },
  wisplet: { place: 'cloudloft', thing: 'updraft', friend: 'plumpet' },
  cushlet: { place: 'cloudloft', thing: 'puffpads', friend: 'crumbit' },   // D-96: was cogwhistle / springplate
  crimpo: { place: 'hearthlog', thing: 'hearth', friend: 'dollop' },
  thumbly: { place: 'hearthlog', thing: 'rockerboard', friend: 'glugbean' },
  boingle: { place: 'frostbell', thing: 'icepond', friend: 'puddlo' },
  dimpla: { place: 'cloudloft', thing: 'cloudball', friend: 'munchip' },   // D-96: was echohollow / echostone
  nuzzo: { place: 'cloudloft', thing: 'cloudball', friend: 'capnap' },
  tadpolo: { place: 'lanternroof', thing: 'vanedisc', friend: 'swishel' },   // D-96: was fizzwell / swirlride
  swishel: { place: 'ripple', thing: 'pebbleball', friend: 'tadpolo' },
  granulo: { place: 'ripple', thing: 'sandmound', friend: 'sproutle' },
  sproutle: { place: 'rainleaf', thing: 'seedpod', friend: 'granulo' },
  wrigglo: { place: 'rainleaf', thing: 'splashspots', friend: 'knubby' },
  acornel: { place: 'rainleaf', thing: 'dripleaf', friend: 'hooplet' },
  capnap: { place: 'hearthlog', thing: 'snugbasket', friend: 'nuzzo' },
  knubby: { place: 'frostbell', thing: 'steampool', friend: 'wrigglo' },
  kneadle: { place: 'ripple', thing: 'sandmound', friend: 'burrbin' },   // D-96: was cogwhistle / spinningcog
  hooplet: { place: 'frostbell', thing: 'glideramp', friend: 'acornel' },
  spirelo: { place: 'frostbell', thing: 'iciclebells', friend: 'diademo' },   // D-96: was echohollow / crystals
  zingle: { place: 'lanternroof', thing: 'hammock', friend: 'gloopsy' },
  petalop: { place: 'rainleaf', thing: 'leafteeter', friend: 'marigel' },
  burrbin: { place: 'rainleaf', thing: 'mossbouncer', friend: 'kneadle' },   // D-96: was cogwhistle / magnet
  marigel: { place: 'rainleaf', thing: 'steppingstones', friend: 'petalop' },
  gloopsy: { place: 'ripple', thing: 'rockpool', friend: 'zingle' },   // D-96: was fizzwell / soapslide
  hushpuff: { place: 'hearthlog', thing: 'hearth', friend: 'thudge' },
  slumbrel: { place: 'cloudloft', thing: 'cloudnest', friend: 'caromel' },
  thudge: { place: 'frostbell', thing: 'snowdriftnest', friend: 'hushpuff' },   // D-96: was cogwhistle / tickclock
  diademo: { place: 'frostbell', thing: 'iciclebells', friend: 'spirelo' },
  taffelin: { place: 'lanternroof', thing: 'vanedisc', friend: 'cindergoo' },
  rattlebead: { place: 'rainleaf', thing: 'seedpod', friend: 'pastrel' },   // D-96: was fizzwell / bubblepatch
  cindergoo: { place: 'frostbell', thing: 'steampool', friend: 'taffelin' },   // D-96: was echohollow / glowpool
  selenuff: { place: 'lanternroof', thing: 'moondish', friend: 'flipdome' },
  pastrel: { place: 'hearthlog', thing: 'kettle', friend: 'rattlebead' },
  flipdome: { place: 'cloudloft', thing: 'kiteswing', friend: 'selenuff' },   // D-96: was cogwhistle / littlebell
  caromel: { place: 'cloudloft', thing: 'puffpads', friend: 'slumbrel' },
  ambrosel: { place: 'frostbell', thing: 'glideramp', friend: 'fossilo' },   // D-96: was echohollow / stoneslide
  tidelume: { place: 'ripple', thing: 'bobring', friend: 'glimglop' },
  glimglop: { place: 'rainleaf', thing: 'dripleaf', friend: 'tidelume' },   // D-96: was fizzwell / tap
  somnuff: { place: 'lanternroof', thing: 'chimneycorner', friend: 'constello' },
  fossilo: { place: 'ripple', thing: 'driftlog', friend: 'ambrosel' },   // D-96: was echohollow / humrock
  skeinara: { place: 'lanternroof', thing: 'starscope', friend: 'prismelo' },
  constello: { place: 'frostbell', thing: 'snowdriftnest', friend: 'somnuff' },
  prismelo: { place: 'cloudloft', thing: 'cloudnest', friend: 'skeinara' },   // D-96: was echohollow / mossbed
} as const satisfies Record<SpeciesId, SpeciesLife>;
