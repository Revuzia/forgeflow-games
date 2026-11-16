// LIFE's world: one struct of arrays for every character, the place LIFE was given, the joint moments and the scratch it needs, allocated
// once by createLifeWorld (LIFE.md 11, 12; LF-02: nothing is allocated per tick after this). Pure: imports only ./, ../core, ../data and the
// contract TYPES (L1, LF-12). Spec: _spec/LIFE.md; brief: _handoff/briefs/PG_LIFE.md. Owned by PG_LIFE.
//
// HOT-PATH RULE (LF-02): functions called per tick take and return small integers or booleans; every float they produce goes into a typed
// array (w.f is the scratch), because a double passed to or returned from a call that V8 does not inline is boxed (a heap allocation).
import type { LifeSnapshot, LifeIntents, LifeEvents } from '../contracts.ts';
import type { PlaceDef } from '../data/places.ts';
import { THING_IDS, MECH, ownsArea } from '../data/places.ts';
import { THING_KIND, EMOTE, SALTS } from '../data/life.ts';
import { createAttention } from './attention.ts';
import type { Attention } from './attention.ts';

/** Capacities (the LIFE seam's: 16 characters, 64 intents, 32 events, 32 things). */
export const CAP = 16;
export const MAX_THINGS = 32;
export const MAX_ZONES = 16;
export const MAX_PATCHES = 16;
export const MAX_MOMENTS = 8;
export const MAX_MEMBERS = 6;
export const PHRASE_CAP = 64;
/** The think period (s of sim time) and the stagger per slot (LIFE 11: slot x 0.1 / 16). */
export const THINK_S = 0.1;
export const STAGGER_S = THINK_S / 16;

/** Brain states: B01..B20 are LIFE 4's behaviours by number; 21 = inside a joint moment (S01..S18); 22..25 = the piece group moves P01..P04. */
export const BEH = {
  NONE: 0, IDLE: 1, NOTICE: 2, WANDER: 3, USE: 4, BASK: 5, NAP: 6, WISH: 7, AFTERGLOW: 8, ARRIVE: 9, LOVE: 10, COMEBACK: 11, POSE: 12, WATCH: 13,
  CHEER: 14, ZONE: 15, HUFF: 16, COMFORT: 17, ANSWER: 18, HOLDON: 19, RIDE: 20, MOMENT: 21, FOLLOW: 22, HUDDLE: 23, HOPTOG: 24, JOIN: 25,
} as const;
export const NBEH = 26;

/** Scratch float slots in w.f (named, so no helper returns a double). NOW = the sim time of the think (or of the per-call pass) every brain
 *  function reads, instead of taking it as a parameter (a double argument to a call V8 does not inline is boxed: LF-02); DT = the think's dt;
 *  PX, PZ = the query point of the geometry tests below (inBounds, inKeepOut, inAreaAt, zoneStrengthAt, d2p). The world's scalar doubles
 *  live here too, never in object fields (a double stored to a tagged field is boxed every time): LAST_T the previous call's t (NaN before
 *  the first), T0 the session's first t, UNITS the units LIFE's own starts woke this call (not yet in the snapshot), MUSIC_ON the Music
 *  Box's last start, NEW_WISH the last new wish on screen, SONG the last S06 song. */
export const F = { X: 0, Z: 1, D: 2, X2: 3, Z2: 4, S: 5, T: 6, A: 7, B: 8, C: 9, E: 10, G: 11, NOW: 12, DT: 13, PX: 14, PZ: 15,
  LAST_T: 16, T0: 17, UNITS: 18, MUSIC_ON: 19, NEW_WISH: 20, SONG: 21 } as const;

export interface LifeWorld {
  seed: number; maxChars: number;
  /* the place (lifeSetPlace, D-89) */
  placeIdx: number; visit: number; layout: number; bodyScale: number; def: PlaceDef | null; home: boolean; night: boolean;
  /** bounds of the layout in use: shape 0 disc (a = r), 1 rounded box (a, b half sizes, round). */
  bShape: number; bx: number; bz: number; ba: number; bb: number; bround: number;
  nThingDefs: number;
  thingGlobal: Int16Array; thingMech: Uint8Array; thingX: Float32Array; thingZ: Float32Array; thingYaw: Float32Array;
  thingS0: Float32Array; thingS1: Float32Array; thingS2: Float32Array;
  thingUseX: Float32Array; thingUseZ: Float32Array; thingPeek: Float32Array; thingPushX: Float32Array; thingPushZ: Float32Array;
  thingWayX: Float32Array; thingWayZ: Float32Array; thingRider: Float32Array; thingRide: Uint8Array; thingSwitch: Uint8Array;
  thingZone: Int8Array; thingPatch: Int8Array; thingKind: Uint8Array; thingIcon: Uint8Array; thingVerb: Uint8Array; thingFromN: Uint8Array;
  /** place-global thing index -> place-local index (-1 = not this place's) */
  globalToLocal: Int8Array;
  nZones: number; zoneKind: Uint8Array; zoneStr: Float32Array; zoneShape: Uint8Array; zoneX: Float32Array; zoneZ: Float32Array;
  zoneR: Float32Array; zoneHX: Float32Array; zoneHZ: Float32Array; zoneYaw: Float32Array; zoneFall0: Float32Array; zoneFall1: Float32Array;
  zoneSurf: Float32Array; zoneGlow: Uint8Array; zoneThing: Int8Array; zoneShower: Uint8Array;
  nPatches: number; patchShape: Uint8Array; patchX: Float32Array; patchZ: Float32Array; patchR: Float32Array; patchHX: Float32Array;
  patchHZ: Float32Array; patchYaw: Float32Array; patchNap: Uint8Array; patchIce: Uint8Array; patchThing: Int8Array; patchSand: Uint8Array;
  /** Home's home slots (lifeSetHome, D-87): NaN = none */
  homeX: Float32Array; homeZ: Float32Array;
  /* characters */
  active: Uint8Array; kind: Uint8Array; group: Int8Array; species: Uint8Array; family: Uint8Array; gseed: Uint32Array; warmth: Uint8Array;
  isNew: Uint8Array; addT: Float64Array; signature: Uint8Array; pitch: Float32Array;
  /** 5 traits per character: bouncy, curious, cuddly, chatty, dozy (LIFE 2) */
  traits: Float32Array;
  play: Float32Array; company: Float32Array; rest: Float32Array;
  /** 6 looks per character (LOOK order) and whether each reached 0.5 this visit (for DRY) */
  looks: Float32Array; lookHigh: Uint8Array;
  rng: Uint32Array;
  tick: Float64Array; lastThink: Float64Array;
  beh: Uint8Array; phase: Uint8Array; behT0: Float64Array; behEnd: Float64Array; behNext: Float64Array;
  tx: Float32Array; tz: Float32Array; tSpeed: Float32Array; tThing: Int8Array; tChar: Int8Array;
  progD: Float32Array; progT: Float64Array;
  cool: Float64Array;
  moving: Uint8Array; wakeClaimT: Float64Array;
  hopNextT: Float64Array; lastHopT: Float64Array; hopsLeft: Uint8Array; chain: Uint8Array;
  held: Uint8Array; releaseT: Float64Array; lastTouch: Int8Array; touchStartT: Float64Array; tossT: Float64Array; tossN: Uint8Array;
  graceUntil: Float64Array; rideUntil: Float64Array; rideThing: Int8Array; rideStarT: Float64Array; rideSeen: Uint8Array;
  seenThings: Uint32Array; seenChars: Uint16Array; noticeT: Float64Array; noticeSrc: Int16Array;
  zoneIn: Uint16Array; zoneSeen: Uint16Array; zoneInT: Float64Array;
  reactKey: Int16Array; reactN: Uint8Array; reactCool: Float64Array;
  inWaterT: Float64Array; airT: Float64Array; poseT: Float64Array; prevAir: Uint8Array;
  lastJoyT: Float64Array; lastNoticeT: Float64Array; favPlaceT: Float64Array;
  expr: Uint8Array; exprAmt: Float32Array; sqS: Float32Array; poseKey: Float32Array;
  gazeKind: Uint8Array;
  lastEmoteT: Float64Array; lastEmoteIcon: Uint8Array; iconT: Float64Array;
  huffT: Float64Array; huffFrom: Int8Array;
  wishKind: Uint8Array; wishTarget: Int16Array; wishT: Float64Array; wishLastNewT: Float64Array; wishGlance: Uint8Array; touchWishT: Float64Array;
  warmLookT: Float64Array; playWith: Int8Array; nextUse: Int8Array; firstPlay: Uint8Array;
  pairLevel: Uint8Array; pairBest: Uint8Array; pairGreet: Uint8Array; pairChats: Uint8Array; pairCool: Float64Array; pairNear: Uint8Array;
  onceVisit: Uint32Array;
  moment: Int8Array;
  /** zone sensing per character (each think): the warm, cold and wet (rain, shower, splash) strengths at its centre, the zone indices of the
   *  strongest warm / cold zone and of the water, wind and updraft zones it is in (-1 none); a B15 entry due (zone index + 1); "entered at
   *  once" (it came out, arrived or was cut inside a zone: no crossing needed, 3.1) */
  zWarm: Float32Array; zCold: Float32Array; zWet: Float32Array; zWarmK: Int8Array; zColdK: Int8Array; zWaterK: Int8Array; zWindK: Int8Array;
  zUpK: Int8Array; b15Zone: Int8Array; enterAtOnce: Uint8Array; onNap: Int8Array; onSand: Uint8Array;
  /** the behaviour's score when it started (the running one keeps +0.15), the arrival due (B09), the shy arrival's end */
  behScore: Float32Array; arrivePending: Uint8Array; shyUntil: Float64Array; partnerWaitT: Float64Array;
  /** per-call bookkeeping of the player's touch and landings, and the pending one-shot behaviours */
  afterglowDue: Uint8Array; watchDue: Int8Array; cheerDue: Uint8Array; huffDue: Uint8Array; landT: Float64Array; airCall: Uint8Array;
  addPending: Uint8Array; noticeTarget: Int16Array; useStage: Uint8Array; ridePrev: Uint8Array; usesVisit: Uint8Array;
  /** per place-local thing: the last squishy that used it and when (B16's "another squishy took the ball") */
  thingUser: Int8Array; thingUseT: Float64Array;
  /** lifeAddLook's REACT events wait here for the next lifeStep (it has no event list): slot, REACT kind, thing */
  pendN: number; pendSlot: Int8Array; pendKind: Uint8Array; pendThing: Int16Array;
  /* joint moments */
  mKind: Uint8Array; mN: Uint8Array; mMem: Int8Array; mT0: Float64Array; mEnd: Float64Array; mPhase: Uint8Array; mTurn: Uint8Array;
  mNext: Float64Array; mStep: Uint8Array; mThing: Int8Array; mX: Float32Array; mZ: Float32Array; mSoft: Uint8Array; mRide: Uint8Array;
  mCount: Uint8Array;
  /* groups (pieces): per group key 0..31 */
  cutT: Float64Array; cutPending: Uint8Array; groupHighKey: Int16Array; groupHighN: Uint8Array; groupEmoteT: Float64Array;
  pieceUseT: Float64Array; leaderIdleT: Float64Array;
  /* journal (lifeSetJournal) */
  owned: Uint32Array; openPlaces: number; favKnown: Uint32Array; thingKinds: number;
  /* scripts */
  firstPlayDone: number; firstWishDone: number; firstWishPending: number; firstWishSlot: number; firstWishDeadline: number; poseOn: number;
  cheerCause: number; squirtDue: Uint8Array;
  /* per-call */
  musicPrev: number;
  rowOfLocal: Int8Array; thingPrevX: Float32Array; thingPrevZ: Float32Array; thingPrevS: Float32Array; thingMovedT: Float64Array;
  bumpT: Float64Array; bumpWith: Int8Array; movers: number; nOut: number;
  /* intents bookkeeping */
  perChar: Uint8Array; phrase: Float32Array; phraseN: Uint8Array; phraseHead: number;
  f: Float64Array;
  att: Attention;
}

export function createLifeWorld(seed: number, maxChars: number): LifeWorld {
  const n = CAP, f32 = (k: number) => new Float32Array(k), f64 = (k: number) => new Float64Array(k), u8 = (k: number) => new Uint8Array(k);
  const i8 = (k: number) => new Int8Array(k), nanF64 = (k: number) => new Float64Array(k).fill(-1e9), T = MAX_THINGS;
  const w: LifeWorld = {
    seed: seed >>> 0, maxChars: Math.min(CAP, Math.max(1, maxChars | 0)),
    placeIdx: 0, visit: 0, layout: 0, bodyScale: 1, def: null, home: true, night: false,
    bShape: 0, bx: 0, bz: 0, ba: 3.4, bb: 3.4, bround: 0,
    nThingDefs: 0, thingGlobal: new Int16Array(T), thingMech: u8(T), thingX: f32(T), thingZ: f32(T), thingYaw: f32(T),
    thingS0: f32(T), thingS1: f32(T), thingS2: f32(T),
    thingUseX: f32(T), thingUseZ: f32(T), thingPeek: f32(T * 4), thingPushX: f32(T), thingPushZ: f32(T),
    thingWayX: f32(T), thingWayZ: f32(T), thingRider: f32(T), thingRide: u8(T), thingSwitch: u8(T),
    thingZone: i8(T), thingPatch: i8(T), thingKind: u8(T), thingIcon: u8(T), thingVerb: u8(T), thingFromN: u8(T),
    globalToLocal: new Int8Array(THING_IDS.length + 2).fill(-1),
    nZones: 0, zoneKind: u8(MAX_ZONES), zoneStr: f32(MAX_ZONES), zoneShape: u8(MAX_ZONES), zoneX: f32(MAX_ZONES), zoneZ: f32(MAX_ZONES),
    zoneR: f32(MAX_ZONES), zoneHX: f32(MAX_ZONES), zoneHZ: f32(MAX_ZONES), zoneYaw: f32(MAX_ZONES), zoneFall0: f32(MAX_ZONES), zoneFall1: f32(MAX_ZONES),
    zoneSurf: f32(MAX_ZONES), zoneGlow: u8(MAX_ZONES), zoneThing: i8(MAX_ZONES), zoneShower: u8(MAX_ZONES),
    nPatches: 0, patchShape: u8(MAX_PATCHES), patchX: f32(MAX_PATCHES), patchZ: f32(MAX_PATCHES), patchR: f32(MAX_PATCHES), patchHX: f32(MAX_PATCHES),
    patchHZ: f32(MAX_PATCHES), patchYaw: f32(MAX_PATCHES), patchNap: u8(MAX_PATCHES), patchIce: u8(MAX_PATCHES), patchThing: i8(MAX_PATCHES), patchSand: u8(MAX_PATCHES),
    homeX: f32(n).fill(NaN), homeZ: f32(n).fill(NaN),
    active: u8(n), kind: u8(n), group: i8(n), species: u8(n), family: u8(n), gseed: new Uint32Array(n), warmth: u8(n),
    isNew: u8(n), addT: f64(n), signature: u8(n), pitch: f32(n),
    traits: f32(n * 5), play: f32(n), company: f32(n), rest: f32(n), looks: f32(n * 6), lookHigh: u8(n),
    rng: new Uint32Array(n), tick: f64(n), lastThink: f64(n),
    beh: u8(n), phase: u8(n), behT0: f64(n), behEnd: f64(n), behNext: f64(n),
    tx: f32(n), tz: f32(n), tSpeed: f32(n), tThing: i8(n).fill(-1), tChar: i8(n).fill(-1), progD: f32(n), progT: f64(n),
    cool: nanF64(n * NBEH), moving: u8(n), wakeClaimT: nanF64(n),
    hopNextT: f64(n), lastHopT: nanF64(n), hopsLeft: u8(n), chain: u8(n),
    held: u8(n), releaseT: nanF64(n), lastTouch: i8(n).fill(-1), touchStartT: nanF64(n), tossT: nanF64(n * 3), tossN: u8(n),
    graceUntil: nanF64(n), rideUntil: nanF64(n), rideThing: i8(n).fill(-1), rideStarT: nanF64(n), rideSeen: u8(n),
    seenThings: new Uint32Array(n * 2), seenChars: new Uint16Array(n), noticeT: nanF64(n * 48), noticeSrc: new Int16Array(n).fill(-1),
    zoneIn: new Uint16Array(n), zoneSeen: new Uint16Array(n), zoneInT: nanF64(n * MAX_ZONES),
    reactKey: new Int16Array(n * 48).fill(-1), reactN: u8(n), reactCool: nanF64(n * 24),
    inWaterT: nanF64(n), airT: nanF64(n), poseT: nanF64(n), prevAir: u8(n),
    lastJoyT: nanF64(n), lastNoticeT: nanF64(n), favPlaceT: nanF64(n),
    expr: u8(n), exprAmt: f32(n), sqS: f32(n).fill(1), poseKey: f32(n * 4), gazeKind: u8(n),
    lastEmoteT: nanF64(n), lastEmoteIcon: u8(n), iconT: nanF64(n * 25),
    huffT: nanF64(n), huffFrom: i8(n).fill(-1),
    wishKind: u8(n), wishTarget: new Int16Array(n).fill(-1), wishT: nanF64(n), wishLastNewT: nanF64(n), wishGlance: u8(n), touchWishT: nanF64(n),
    warmLookT: nanF64(n), playWith: i8(n).fill(-1), nextUse: i8(n).fill(-1), firstPlay: u8(n),
    pairLevel: u8(n * n), pairBest: u8(n * n), pairGreet: u8(n * n), pairChats: u8(n * n), pairCool: nanF64(n * n), pairNear: u8(n * n),
    onceVisit: new Uint32Array(n),
    moment: i8(n).fill(-1),
    zWarm: f32(n), zCold: f32(n), zWet: f32(n), zWarmK: i8(n).fill(-1), zColdK: i8(n).fill(-1), zWaterK: i8(n).fill(-1), zWindK: i8(n).fill(-1),
    zUpK: i8(n).fill(-1), b15Zone: i8(n), enterAtOnce: u8(n), onNap: i8(n).fill(-1), onSand: u8(n),
    behScore: f32(n), arrivePending: u8(n), shyUntil: nanF64(n), partnerWaitT: nanF64(n),
    afterglowDue: u8(n), watchDue: i8(n).fill(-1), cheerDue: u8(n), huffDue: u8(n), landT: nanF64(n), airCall: u8(n),
    addPending: u8(n), noticeTarget: new Int16Array(n).fill(-1), useStage: u8(n), ridePrev: u8(n), usesVisit: u8(n),
    thingUser: i8(MAX_THINGS).fill(-1), thingUseT: nanF64(MAX_THINGS),
    pendN: 0, pendSlot: i8(16), pendKind: u8(16), pendThing: new Int16Array(16),
    mKind: u8(MAX_MOMENTS), mN: u8(MAX_MOMENTS), mMem: i8(MAX_MOMENTS * MAX_MEMBERS).fill(-1), mT0: f64(MAX_MOMENTS), mEnd: f64(MAX_MOMENTS),
    mPhase: u8(MAX_MOMENTS), mTurn: u8(MAX_MOMENTS), mNext: f64(MAX_MOMENTS), mStep: u8(MAX_MOMENTS), mThing: i8(MAX_MOMENTS).fill(-1),
    mX: f32(MAX_MOMENTS), mZ: f32(MAX_MOMENTS), mSoft: u8(MAX_MOMENTS), mRide: u8(MAX_MOMENTS), mCount: u8(MAX_MOMENTS),
    cutT: nanF64(32), cutPending: u8(32), groupHighKey: new Int16Array(32 * 8).fill(-1), groupHighN: u8(32 * 8), groupEmoteT: nanF64(32),
    pieceUseT: nanF64(n), leaderIdleT: nanF64(32),
    owned: new Uint32Array(2), openPlaces: 1, favKnown: new Uint32Array(4), thingKinds: 0,
    firstPlayDone: 0, firstWishDone: 0, firstWishPending: 0, firstWishSlot: -1, firstWishDeadline: 0, poseOn: 0,
    cheerCause: -1, squirtDue: u8(n), musicPrev: 0,
    rowOfLocal: i8(T).fill(-1), thingPrevX: f32(T).fill(NaN), thingPrevZ: f32(T).fill(NaN), thingPrevS: f32(T).fill(NaN), thingMovedT: nanF64(T),
    bumpT: nanF64(n), bumpWith: i8(n).fill(-1), movers: 0, nOut: 0,
    perChar: u8(n), phrase: f32(PHRASE_CAP * 16), phraseN: u8(PHRASE_CAP), phraseHead: 0,
    f: f64(24),
    att: createAttention(),
  };
  w.f[F.LAST_T] = NaN; w.f[F.T0] = NaN; w.f[F.MUSIC_ON] = -1e9; w.f[F.NEW_WISH] = -1e9; w.f[F.SONG] = -1e9;
  return w;
}

/* ───────────────────────────── the place (lifeSetPlace, D-89; lifeSetHome, D-87) ───────────────────────────── */

const KIND_OF_ICON: Record<number, number> = { [EMOTE.ball]: THING_KIND.ball, [EMOTE.bell]: THING_KIND.bell, [EMOTE.droplet]: THING_KIND.droplet,
  [EMOTE.note]: THING_KIND.note, [EMOTE.flame]: THING_KIND.flame, [EMOTE.sun]: THING_KIND.sun };
/** ThingDef.switch codes. */
export const SWITCH = { none: 0, zone: 1, motor: 2, tune: 3, shower: 4, echo: 5, fire: 6, comet: 7 } as const;

/** Copy the layout in use into the world's preallocated arrays (never per tick). Home's spots are slot units x bodyScale (D-67). */
export function copyPlace(w: LifeWorld, def: PlaceDef, layout: number): void {
  const tall = layout === 1 && def.tall ? def.tall : null;
  const sc = def.unit === 'slot' ? w.bodyScale : 1;
  const b = tall ? tall.bounds : def.bounds;
  w.bShape = b.shape === 'disc' ? 0 : 1; w.bx = b.x * sc; w.bz = b.z * sc;
  w.ba = b.shape === 'disc' ? (b.r ?? 3.4) : (b.hx ?? 3.4); w.bb = b.shape === 'disc' ? (b.r ?? 3.4) : (b.hz ?? 2.4); w.bround = b.round ?? 0;
  w.globalToLocal.fill(-1);
  const nt = Math.min(MAX_THINGS, def.things.length); w.nThingDefs = nt;
  for (let k = 0; k < nt; k++) {
    const t = def.things[k], sp = tall ? tall.things[k] : null;
    const g = THING_IDS.indexOf(t.id); w.thingGlobal[k] = g; if (g >= 0) w.globalToLocal[g] = k;
    w.thingMech[k] = t.mech; w.thingX[k] = (sp ? sp.x : t.x) * sc; w.thingZ[k] = (sp ? sp.z : t.z) * sc; w.thingYaw[k] = sp ? sp.yaw : t.yaw;
    w.thingS0[k] = t.size[0]; w.thingS1[k] = t.size[1]; w.thingS2[k] = t.size[2];
    const use = sp ? sp.use : t.useSpot;
    if (use) { w.thingUseX[k] = use[0] * sc; w.thingUseZ[k] = use[1] * sc; }
    else if (t.mech === MECH.ring) { w.thingUseX[k] = w.thingX[k]; w.thingUseZ[k] = w.thingZ[k]; }
    else { w.thingUseX[k] = NaN; w.thingUseZ[k] = NaN; }
    const pk = sp ? sp.peek : t.peek;
    for (let j = 0; j < 4; j++) w.thingPeek[k * 4 + j] = pk ? pk[j] * sc : NaN;
    const ps = sp ? sp.push : t.push;
    w.thingPushX[k] = ps ? ps[0] * sc : NaN; w.thingPushZ[k] = ps ? ps[1] * sc : NaN;
    if (t.mech === MECH.ring) {
      const way = (t.p.way ?? 0.6) + t.size[0], yaw = w.thingYaw[k];
      w.thingWayX[k] = w.thingX[k] + Math.cos(yaw) * way; w.thingWayZ[k] = w.thingZ[k] + Math.sin(yaw) * way;
    } else { w.thingWayX[k] = NaN; w.thingWayZ[k] = NaN; }
    w.thingRider[k] = t.p.rider ?? 0; w.thingRide[k] = t.ride ? 1 : 0;
    w.thingSwitch[k] = t.switch ? SWITCH[t.switch] : 0;
    w.thingIcon[k] = t.icon; w.thingVerb[k] = t.verb; w.thingKind[k] = KIND_OF_ICON[t.icon] ?? 0;
    w.thingFromN[k] = (sp ? sp.fromN : undefined) ?? t.fromN ?? 0;
    w.thingZone[k] = -1; w.thingPatch[k] = -1;
  }
  const nz = Math.min(MAX_ZONES, def.zones.length); w.nZones = nz;
  for (let k = 0; k < nz; k++) {
    const z = def.zones[k], a = tall ? tall.zones[k] : z;
    w.zoneKind[k] = z.kind; w.zoneStr[k] = z.strength; w.zoneShape[k] = a.shape === 'disc' ? 0 : 1;
    w.zoneX[k] = a.x * sc; w.zoneZ[k] = a.z * sc; w.zoneR[k] = a.r ?? 0; w.zoneHX[k] = a.hx ?? 0; w.zoneHZ[k] = a.hz ?? 0; w.zoneYaw[k] = a.yaw ?? 0;
    w.zoneFall0[k] = z.falloff ? z.falloff[0] : -1; w.zoneFall1[k] = z.falloff ? z.falloff[1] : 1;
    w.zoneSurf[k] = z.surfaceY ?? 0; w.zoneGlow[k] = z.glow ? 1 : 0; w.zoneShower[k] = z.shower ? 1 : 0;
    w.zoneThing[k] = -1;
    for (let t = 0; t < nt; t++) if (ownsArea(def.things[t].zone, z.id)) { w.zoneThing[k] = t; if (w.thingZone[t] < 0) w.thingZone[t] = k; break; }
  }
  const np = Math.min(MAX_PATCHES, def.patches.length); w.nPatches = np;
  for (let k = 0; k < np; k++) {
    const p = def.patches[k], a = tall ? tall.patches[k] : p;
    w.patchShape[k] = a.shape === 'disc' ? 0 : 1; w.patchX[k] = a.x * sc; w.patchZ[k] = a.z * sc; w.patchR[k] = (a.r ?? 0) * (def.unit === 'slot' ? 1 : 1);
    w.patchHX[k] = a.hx ?? 0; w.patchHZ[k] = a.hz ?? 0; w.patchYaw[k] = a.yaw ?? 0;
    w.patchNap[k] = p.nap ? 1 : 0; w.patchIce[k] = p.ice ? 1 : 0; w.patchSand[k] = p.id.indexOf('sand') >= 0 ? 1 : 0;
    w.patchThing[k] = -1;
    for (let t = 0; t < nt; t++) if (ownsArea(def.things[t].patch, p.id)) { w.patchThing[k] = t; if (w.thingPatch[t] < 0) w.thingPatch[t] = k; break; }
  }
}

/* ───────────────────────────── geometry (LF-02: no double crosses a call; results in w.f or as integers) ───────────────────────────── */

/** Squared distances as integers in cm² (never boxed): character i to character j, to thing row r, to the query point (w.f[F.PX], w.f[F.PZ]). */
export const CM2 = 1e4;
export function d2c(s: LifeSnapshot, i: number, j: number): number { const dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j]; return ((dx * dx + dz * dz) * CM2) | 0; }
export function d2t(s: LifeSnapshot, i: number, r: number): number { const dx = s.x[i] - s.thingX[r], dz = s.z[i] - s.thingZ[r]; return ((dx * dx + dz * dz) * CM2) | 0; }
export function d2p(w: LifeWorld, s: LifeSnapshot, i: number): number { const dx = s.x[i] - w.f[F.PX], dz = s.z[i] - w.f[F.PZ]; return ((dx * dx + dz * dz) * CM2) | 0; }
/** The distance between characters i and j in mm (an integer). */
export function dmm(s: LifeSnapshot, i: number, j: number): number { const dx = s.x[i] - s.x[j], dz = s.z[i] - s.z[j]; return (Math.sqrt(dx * dx + dz * dz) * 1000) | 0; }

/** Is the query point inside zone k (patch 0) or patch k (patch 1)? (a disc of r, or a box of hx, hz turned by yaw) */
export function inAreaAt(w: LifeWorld, patch: number, k: number): boolean {
  const dx = w.f[F.PX] - (patch ? w.patchX[k] : w.zoneX[k]), dz = w.f[F.PZ] - (patch ? w.patchZ[k] : w.zoneZ[k]);
  if ((patch ? w.patchShape[k] : w.zoneShape[k]) === 0) { const r = patch ? w.patchR[k] : w.zoneR[k]; return dx * dx + dz * dz <= r * r; }
  const yaw = patch ? w.patchYaw[k] : w.zoneYaw[k], c = Math.cos(yaw), sn = Math.sin(yaw);
  return Math.abs(dx * c + dz * sn) <= (patch ? w.patchHX[k] : w.zoneHX[k]) && Math.abs(dz * c - dx * sn) <= (patch ? w.patchHZ[k] : w.zoneHZ[k]);
}

/** Zone k's strength at the query point into w.f[F.S] (0 outside); with a falloff [full radius, edge strength] it falls evenly to the edge. */
export function zoneStrengthAt(w: LifeWorld, k: number): void {
  w.f[F.S] = 0;
  if (!inAreaAt(w, 0, k)) return;
  let s = w.zoneStr[k];
  if (w.zoneShape[k] === 0 && w.zoneFall0[k] >= 0) {
    const dx = w.f[F.PX] - w.zoneX[k], dz = w.f[F.PZ] - w.zoneZ[k], d = Math.sqrt(dx * dx + dz * dz), r0 = w.zoneFall0[k], r1 = w.zoneR[k];
    if (d > r0 && r1 > r0) s = s + (w.zoneFall1[k] - s) * ((d - r0) / (r1 - r0));
  }
  w.f[F.S] = s;
}

/** Is the query point inside the place's bounds shrunk by shrinkMm / 1000 m (a rounded box: the corner circle of radius `round`)? */
export function inBounds(w: LifeWorld, shrinkMm: number): boolean {
  const shrink = shrinkMm * 0.001, dx = w.f[F.PX] - w.bx, dz = w.f[F.PZ] - w.bz;
  if (w.bShape === 0) { const r = w.ba - shrink; return r > 0 && dx * dx + dz * dz <= r * r; }
  const hx = w.ba - shrink, hz = w.bb - shrink;
  if (hx <= 0 || hz <= 0) return false;
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (ax > hx || az > hz) return false;
  const rr = w.bround - shrink;
  if (rr <= 0) return true;
  const cx = hx - rr, cz = hz - rr;
  if (ax <= cx || az <= cz) return true;
  return (ax - cx) * (ax - cx) + (az - cz) * (az - cz) <= rr * rr;
}

/** Is the query point inside thing k's keep-out (its footprint grown by growMm / 1000 m)? Patch and walk-on things (rug, pad, turntable,
 *  pool) have none. */
export function inKeepOut(w: LifeWorld, s: LifeSnapshot, k: number, growMm: number): boolean {
  const m = w.thingMech[k], g = growMm * 0.001;
  let tx = w.thingX[k], tz = w.thingZ[k];
  const row = w.rowOfLocal[k];
  if (row >= 0) { tx = s.thingX[row]; tz = s.thingZ[row]; }
  else if (s.nThings > 0 || w.home) return false; // not out now (Home's things arrive one by one)
  if (m === 0 || m === MECH.pad || m === MECH.turntable || m === MECH.pool) return false;
  const dx = w.f[F.PX] - tx, dz = w.f[F.PZ] - tz, s0 = w.thingS0[k], s1 = w.thingS1[k];
  if (m === MECH.ball || m === MECH.mound || m === MECH.chime) { const r = s0 + g; return dx * dx + dz * dz <= r * r; }
  if (m === MECH.ring) return Math.abs(Math.sqrt(dx * dx + dz * dz) - s0) <= s1 + g;
  const yaw = w.thingYaw[k], c = Math.cos(yaw), sn = Math.sin(yaw), lx = Math.abs(dx * c + dz * sn), lz = Math.abs(dz * c - dx * sn);
  if (m === MECH.swing) return lx <= 0.7 + s1 * 0.5 + g && lz <= s1 * 0.5 + g;
  if (m === MECH.bar) return lx <= s1 * 0.5 + g && lz <= s0 + g;
  return lx <= s0 + g && lz <= w.thingS2[k] + g;
}
/** Is the query point clear of every thing's keep-out grown by growMm? */
export function clearOfThings(w: LifeWorld, s: LifeSnapshot, growMm: number): boolean {
  for (let k = 0; k < w.nThingDefs; k++) if (inKeepOut(w, s, k, growMm)) return false;
  return true;
}
/** A free target's keep-out growth for a body of radius r: 0.4 m, and at least R + 0.05 m (mm). */
export function keepMm(s: LifeSnapshot, i: number): number { return s.r[i] + 0.05 > 0.4 ? ((s.r[i] + 0.05) * 1000) | 0 : 400; }
/** The shrink R + 0.2 m of a free target for character i (mm). */
export function shrinkMm(s: LifeSnapshot, i: number): number { return ((s.r[i] + 0.2) * 1000) | 0; }

/* ───────────────────────────── randomness (LIFE 11: one stream per character, in a Uint32Array) ───────────────────────────── */

/** mulberry32's step on w.rng[i]; the draw in [0, 1) goes to w.f[F.G] and its 16-bit value is returned (an int, never boxed). */
export function rnd(w: LifeWorld, i: number): number {
  let a = (w.rng[i] + 0x6d2b79f5) >>> 0;
  w.rng[i] = a;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = (t ^ (t >>> 14)) >>> 0;
  w.f[F.G] = u / 4294967296;
  return u >>> 16;
}
/** A draw in [0, 1) as an inlinable expression (rnd's 16-bit value / 65536). */
export const U16 = 1 / 65536;

export function seedChar(w: LifeWorld, i: number): void {
  w.rng[i] = (w.gseed[i] ^ SALTS.life ^ Math.imul(w.visit + 1, 0x85ebca6b)) >>> 0;
}

/* ───────────────────────────── intents and events (the hot path) ───────────────────────────── */

/** Append an intent for character `who`; returns its index or -1 (the list is full, or a runaway character passed 12 in one call). */
export function pushIntent(w: LifeWorld, out: LifeIntents, kind: number, who: number): number {
  if (out.n >= out.kind.length || w.perChar[who] >= 12) return -1;
  const k = out.n++;
  w.perChar[who]++;
  out.kind[k] = kind; out.who[k] = who; out.delayS[k] = 0;
  out.a[k] = 0; out.b[k] = 0; out.c[k] = 0; out.d[k] = 0; out.e[k] = 0;
  out.icon[k] = 0; out.style[k] = 0; out.prio[k] = 0; out.groupKey[k] = -1; out.dots[k] = 0;
  return k;
}

/** Append a LIFE event; returns its index or -1 when full (capacity 32). */
export function pushEvent(ev: LifeEvents, kind: number, sub: number, a: number, b: number, n2: number, thing: number): number {
  if (ev.n >= ev.kind.length) return -1;
  const k = ev.n++;
  ev.kind[k] = kind; ev.sub[k] = sub; ev.a[k] = a; ev.b[k] = b < 0 ? 255 : b; ev.n2[k] = n2; ev.thing[k] = thing;
  return k;
}

/** The pair index of slots a and b (ordered). */
export function pairIdx(a: number, b: number): number { return a < b ? a * CAP + b : b * CAP + a; }
