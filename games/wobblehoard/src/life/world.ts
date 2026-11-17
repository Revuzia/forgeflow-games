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
/** (my reading of LF-09's "2 to 3 thing uses" in a 5-minute visit) after USES_FULL by-itself thing uses this visit (USE events: a ball boop,
 *  a nap on a nap thing; w.usesVisit) a squishy starts no more uses by its play or its dozy trait, nor an S12 pass; a nap from real
 *  tiredness (rest > 0.75), a player-asked use and FIRST_PLAY still come. */
export const USES_FULL = 2;

/** Scratch float slots in w.f (named, so no helper returns a double). NOW = the sim time of the think (or of the per-call pass) every brain
 *  function reads, instead of taking it as a parameter (a double argument to a call V8 does not inline is boxed: LF-02); DT = the think's dt;
 *  PX, PZ = the query point of the geometry tests below (inBounds, inKeepOut, inAreaAt, zoneStrengthAt, d2p). The world's scalar doubles
 *  live here too, never in object fields (a double stored to a tagged field is boxed every time): LAST_T the previous call's t (NaN before
 *  the first), T0 the session's first t, UNITS the units LIFE's own starts woke this call (not yet in the snapshot), MUSIC_ON the Music
 *  Box's last start, NEW_WISH the last new wish on screen, SONG the last S06 song, TUNE_U the end of a tapped thing's tune (lifeThingTap). */
export const F = { X: 0, Z: 1, D: 2, X2: 3, Z2: 4, S: 5, T: 6, A: 7, B: 8, C: 9, E: 10, G: 11, NOW: 12, DT: 13, PX: 14, PZ: 15,
  LAST_T: 16, T0: 17, UNITS: 18, MUSIC_ON: 19, NEW_WISH: 20, SONG: 21, TUNE_U: 22 } as const;

export interface LifeWorld {
  seed: number; maxChars: number;
  /* the place (lifeSetPlace, D-89) */
  placeIdx: number; visit: number; layout: number; bodyScale: number; def: PlaceDef | null; home: boolean; night: boolean;
  /** bounds of the layout in use: shape 0 disc (a = r), 1 rounded box (a, b half sizes, round). */
  bS: number; bx: number; bz: number; ba: number; bb: number; br: number;
  nTD: number;
  tG: Int16Array; tM: Uint8Array; tX: Float32Array; tZ: Float32Array; tY: Float32Array;
  tS: Float32Array; tS1: Float32Array; tS2: Float32Array;
  tUX: Float32Array; tUZ: Float32Array; tP: Float32Array; tPX: Float32Array; tPZ: Float32Array;
  tWX: Float32Array; tWZ: Float32Array; tR: Float32Array; tRi: Uint8Array; tSw: Uint8Array;
  tZo: Int8Array; tPa: Int8Array; tK: Uint8Array; tI: Uint8Array; tV: Uint8Array; tFN: Uint8Array;
  /** place-global thing index -> place-local index (-1 = not this place's) */
  gTL: Int8Array;
  nZ: number; zK: Uint8Array; zS: Float32Array; zSh: Uint8Array; zX: Float32Array; zZ: Float32Array;
  zR: Float32Array; zH: Float32Array; zHZ: Float32Array; zY: Float32Array; zF0: Float32Array; zF1: Float32Array;
  zSu: Float32Array; zG: Uint8Array; zT: Int8Array; zSo: Uint8Array;
  /** (round 4) a current in the zone (a water zone's flow, or a current zone: DRIFT); a wind zone's gusts (everyS min, max, forS) and LIFE's
   *  gust clock on sim time (the next gust's start, the current gust's end: B19, HOLD_ON) */
  zFl: Uint8Array; zGa: Float32Array; zGb: Float32Array; zGf: Float32Array; zGn: Float64Array; zGe: Float64Array;
  /** a sky thing (ThingDef p.sky: the Moon Dish; GAZE_SKY), a marking patch (PatchDef.mark), the ground's mark and whether it is snow */
  tSk: Uint8Array; pMk: Uint8Array; gMk: number; snG: number;
  nP: number; pS: Uint8Array; pX: Float32Array; pZ: Float32Array; pR: Float32Array; pH: Float32Array;
  pHZ: Float32Array; pY: Float32Array; pN: Uint8Array; pI: Uint8Array; pT: Int8Array; pSa: Uint8Array;
  /** Home's home slots (lifeSetHome, D-87): NaN = none */
  hX: Float32Array; hZ: Float32Array;
  /* characters */
  ac: Uint8Array; ki: Uint8Array; gr: Int8Array; species: Uint8Array; fa: Uint8Array; gs: Uint32Array; wa: Uint8Array;
  iN: Uint8Array; aT: Float64Array; si: Uint8Array; pi: Float32Array;
  /** 5 traits per character: bouncy, curious, cuddly, chatty, dozy (LIFE 2) */
  tr: Float32Array;
  pl: Float32Array; co: Float32Array; re: Float32Array;
  /** 6 looks per character (LOOK order) and whether each reached 0.5 this visit (for DRY) */
  lo: Float32Array; lH: Uint8Array;
  rng: Uint32Array;
  ti: Float64Array; lT: Float64Array;
  beh: Uint8Array; ph: Uint8Array; bT: Float64Array; bE: Float64Array; bN: Float64Array;
  tx: Float32Array; tz: Float32Array; tSp: Float32Array; tT: Int8Array; tC: Int8Array;
  pD: Float32Array; pT1: Float64Array;
  coo: Float64Array;
  mo: Uint8Array; wCT: Float64Array;
  hNT: Float64Array; lHT: Float64Array; ch: Uint8Array;
  he: Uint8Array; rT: Float64Array; lTo: Int8Array; tST: Float64Array; tT1: Float64Array; 
  gU: Float64Array; rU: Float64Array; rTh: Int8Array; rST: Float64Array; 
  sT: Uint32Array; sC: Uint16Array; nT: Float64Array; 
  zSe: Uint16Array; zIT: Float64Array;
  rK: Int16Array; rN: Uint8Array; rC: Float64Array;
  iWT: Float64Array; aT1: Float64Array; pT2: Float64Array; pA: Uint8Array;
  /** (round 4) since when FLOAT's and WADE's own conditions have held without a break (LIFE 4.2's "for 1 s" is the body's state, not the
   *  zone entry: a hop in a puddle is not a float) */
  fT: Float64Array; wdT: Float64Array;
  lJT: Float64Array; lNT: Float64Array; fPT: Float64Array;
  ex: Uint8Array; eA: Float32Array; sqS: Float32Array; pK: Float32Array;
  gK: Uint8Array;
  lET: Float64Array; lEI: Uint8Array; iT: Float64Array;
  hT: Float64Array; hF: Int8Array;
  /** after a cut, the most curious other whole walks over to look (9): the cut whole's slot (its pieces' group key) and until when */
  lA: Int8Array; lU: Float64Array;
  wK: Uint8Array; wT: Int16Array; wT1: Float64Array; wLNT: Float64Array; wG: Uint8Array; tWT: Float64Array;
  wLT: Float64Array; pW: Int8Array; nU: Int8Array; fP: Uint8Array;
  pL: Uint8Array; pB: Uint8Array; pG: Uint8Array; pC: Uint8Array; pCo: Float64Array; pNe: Uint8Array;
  oV: Uint32Array;
  moo: Int8Array;
  /** zone sensing per character (each think): the warm, cold and wet (rain, shower, splash) strengths at its centre, the zone indices of the
   *  strongest warm / cold zone and of the water, wind and updraft zones it is in (-1 none); a B15 entry due (zone index + 1); "entered at
   *  once" (it came out, arrived or was cut inside a zone: no crossing needed, 3.1) */
  zW: Float32Array; zC: Float32Array; zWe: Float32Array; zWK: Int8Array; zCK: Int8Array; zWK1: Int8Array; zWK2: Int8Array;
  zUK: Int8Array; b1: Int8Array; eAO: Uint8Array; oN: Int8Array; oS: Uint8Array;
  /** (round 4) the ice patch and the marking patch under it (-1 none), the current zone at its centre (-1); a glide's and a drift's distance
   *  so far (m), since when it has been idle by a sky thing, and the start of the last gust it held on in */
  oI: Int8Array; oM: Int8Array; zDK: Int8Array; gDs: Float32Array; dDs: Float32Array; skT: Float64Array; gHo: Float64Array;
  /** the behaviour's score when it started (the running one keeps +0.15), the arrival due (B09), the shy arrival's end */
  bSc: Float32Array; aP: Uint8Array; sU: Float64Array; pWT: Float64Array;
  /** per-call bookkeeping of the player's touch and landings, and the pending one-shot behaviours */
  aD: Uint8Array; wD: Int8Array; cD: Uint8Array; hD: Uint8Array; lT1: Float64Array; aC: Uint8Array;
  aPe: Uint8Array; nTa: Int16Array; uS: Uint8Array; rP: Uint8Array; uV: Uint8Array;
  /** (round 4) waiting in B04's first phase for a mover token (a B03 wander does not take the token from it) */
  tw: Uint8Array;
  /** per place-local thing: the last squishy that used it and when (B16's "another squishy took the ball") */
  tU: Int8Array; tUT: Float64Array;
  /** lifeAddLook's REACT events wait here for the next lifeStep (it has no event list): slot, REACT kind, thing */
  pN1: number; pSl: Int8Array; pKi: Uint8Array; pTh: Int16Array;
  /* joint moments */
  mK: Uint8Array; mN: Uint8Array; mM: Int8Array; mT0: Float64Array; mE: Float64Array; mP: Uint8Array; mT: Uint8Array;
  mNe: Float64Array; mS: Uint8Array; mTh: Int8Array; mSo: Uint8Array; mR: Uint8Array;
  mC: Uint8Array;
  /* groups (pieces): per group key 0..31 */
  cT: Float64Array; cP: Uint8Array; gHK: Int16Array; gHN: Uint8Array; gET: Float64Array;
  pUT: Float64Array; 
  /* journal (lifeSetJournal) */
  ow: Uint32Array; oP: number; fK: Uint32Array; tKi: number;
  /** lifeSetFriends: per species idx (2 words, 64 species), the species it may wish to see: Friends or closer, or its best friend once F3 */
  fr: Uint32Array;
  /** lifeSetHops: the families (bit per MATERIAL_FAMILY_IDS index) whose S2 raised hop passed PH-01 (0 = every family at the S1 cap) */
  hR: number;
  /* scripts */
  fPD: number; fWD: number; fWP: number; fWS: number; fWDe: number; pO: number;
  cC: number; sD: Uint8Array;
  /* per-call */
  mPr: number;
  /** lifeThingTap (round 4): the place-local thing whose tapped tune plays until w.f[F.TUNE_U] (the fire puff, a chime row); -1 none */
  tnK: number;
  rOL: Int8Array; tPX1: Float32Array; tPZ1: Float32Array; tPS: Float32Array; tMT: Float64Array;
  bT1: Float64Array; bW: Int8Array; movers: number; nO: number;
  /* intents bookkeeping */
  pCh: Uint8Array; phh: Float32Array; pN2: Uint8Array; pHe: number;
  f: Float64Array;
  att: Attention;
}

export function createLifeWorld(seed: number, maxChars: number): LifeWorld {
  const n = CAP, f32 = (k: number) => new Float32Array(k), f64 = (k: number) => new Float64Array(k), u8 = (k: number) => new Uint8Array(k);
  const i8 = (k: number) => new Int8Array(k), nanF64 = (k: number) => new Float64Array(k).fill(-1e9), T = MAX_THINGS;
  const w: LifeWorld = {
    seed: seed >>> 0, maxChars: Math.min(CAP, Math.max(1, maxChars | 0)),
    placeIdx: 0, visit: 0, layout: 0, bodyScale: 1, def: null, home: true, night: false,
    bS: 0, bx: 0, bz: 0, ba: 3.4, bb: 3.4, br: 0,
    nTD: 0, tG: new Int16Array(T), tM: u8(T), tX: f32(T), tZ: f32(T), tY: f32(T),
    tS: f32(T), tS1: f32(T), tS2: f32(T),
    tUX: f32(T), tUZ: f32(T), tP: f32(T * 4), tPX: f32(T), tPZ: f32(T),
    tWX: f32(T), tWZ: f32(T), tR: f32(T), tRi: u8(T), tSw: u8(T),
    tZo: i8(T), tPa: i8(T), tK: u8(T), tI: u8(T), tV: u8(T), tFN: u8(T),
    gTL: new Int8Array(THING_IDS.length + 2).fill(-1),
    nZ: 0, zK: u8(MAX_ZONES), zS: f32(MAX_ZONES), zSh: u8(MAX_ZONES), zX: f32(MAX_ZONES), zZ: f32(MAX_ZONES),
    zR: f32(MAX_ZONES), zH: f32(MAX_ZONES), zHZ: f32(MAX_ZONES), zY: f32(MAX_ZONES), zF0: f32(MAX_ZONES), zF1: f32(MAX_ZONES),
    zSu: f32(MAX_ZONES), zG: u8(MAX_ZONES), zT: i8(MAX_ZONES), zSo: u8(MAX_ZONES),
    zFl: u8(MAX_ZONES), zGa: f32(MAX_ZONES), zGb: f32(MAX_ZONES), zGf: f32(MAX_ZONES), zGn: new Float64Array(MAX_ZONES).fill(1e9), zGe: new Float64Array(MAX_ZONES).fill(-1e9),
    tSk: u8(T), pMk: u8(MAX_PATCHES), gMk: 0, snG: 0,
    nP: 0, pS: u8(MAX_PATCHES), pX: f32(MAX_PATCHES), pZ: f32(MAX_PATCHES), pR: f32(MAX_PATCHES), pH: f32(MAX_PATCHES),
    pHZ: f32(MAX_PATCHES), pY: f32(MAX_PATCHES), pN: u8(MAX_PATCHES), pI: u8(MAX_PATCHES), pT: i8(MAX_PATCHES), pSa: u8(MAX_PATCHES),
    hX: f32(n).fill(NaN), hZ: f32(n).fill(NaN),
    ac: u8(n), ki: u8(n), gr: i8(n), species: u8(n), fa: u8(n), gs: new Uint32Array(n), wa: u8(n),
    iN: u8(n), aT: f64(n), si: u8(n), pi: f32(n),
    tr: f32(n * 5), pl: f32(n), co: f32(n), re: f32(n), lo: f32(n * 6), lH: u8(n),
    rng: new Uint32Array(n), ti: f64(n), lT: f64(n),
    beh: u8(n), ph: u8(n), bT: f64(n), bE: f64(n), bN: f64(n),
    tx: f32(n), tz: f32(n), tSp: f32(n), tT: i8(n).fill(-1), tC: i8(n).fill(-1), pD: f32(n), pT1: f64(n),
    coo: nanF64(n * NBEH), mo: u8(n), wCT: nanF64(n),
    hNT: f64(n), lHT: nanF64(n), ch: u8(n),
    he: u8(n), rT: nanF64(n), lTo: i8(n).fill(-1), tST: nanF64(n), tT1: nanF64(n * 3), 
    gU: nanF64(n), rU: nanF64(n), rTh: i8(n).fill(-1), rST: nanF64(n), 
    sT: new Uint32Array(n * 2), sC: new Uint16Array(n), nT: nanF64(n * 48), 
    zSe: new Uint16Array(n), zIT: nanF64(n * MAX_ZONES),
    rK: new Int16Array(n * 48).fill(-1), rN: u8(n), rC: nanF64(n * 24),
    iWT: nanF64(n), aT1: nanF64(n), pT2: nanF64(n), pA: u8(n), fT: nanF64(n), wdT: nanF64(n),
    lJT: nanF64(n), lNT: nanF64(n), fPT: nanF64(n),
    ex: u8(n), eA: f32(n), sqS: f32(n).fill(1), pK: f32(n * 4), gK: u8(n),
    lET: nanF64(n), lEI: u8(n), iT: nanF64(n * 25),
    hT: nanF64(n), hF: i8(n).fill(-1), lA: i8(n).fill(-1), lU: nanF64(n),
    wK: u8(n), wT: new Int16Array(n).fill(-1), wT1: nanF64(n), wLNT: nanF64(n), wG: u8(n), tWT: nanF64(n),
    wLT: nanF64(n), pW: i8(n).fill(-1), nU: i8(n).fill(-1), fP: u8(n),
    pL: u8(n * n), pB: u8(n * n), pG: u8(n * n), pC: u8(n * n), pCo: nanF64(n * n), pNe: u8(n * n),
    oV: new Uint32Array(n),
    moo: i8(n).fill(-1),
    zW: f32(n), zC: f32(n), zWe: f32(n), zWK: i8(n).fill(-1), zCK: i8(n).fill(-1), zWK1: i8(n).fill(-1), zWK2: i8(n).fill(-1),
    zUK: i8(n).fill(-1), b1: i8(n), eAO: u8(n), oN: i8(n).fill(-1), oS: u8(n),
    oI: i8(n).fill(-1), oM: i8(n).fill(-1), zDK: i8(n).fill(-1), gDs: f32(n), dDs: f32(n), skT: nanF64(n), gHo: nanF64(n),
    bSc: f32(n), aP: u8(n), sU: nanF64(n), pWT: nanF64(n),
    aD: u8(n), wD: i8(n).fill(-1), cD: u8(n), hD: u8(n), lT1: nanF64(n), aC: u8(n),
    aPe: u8(n), nTa: new Int16Array(n).fill(-1), uS: u8(n), rP: u8(n), uV: u8(n), tw: u8(n),
    tU: i8(MAX_THINGS).fill(-1), tUT: nanF64(MAX_THINGS),
    pN1: 0, pSl: i8(16), pKi: u8(16), pTh: new Int16Array(16),
    mK: u8(MAX_MOMENTS), mN: u8(MAX_MOMENTS), mM: i8(MAX_MOMENTS * MAX_MEMBERS).fill(-1), mT0: f64(MAX_MOMENTS), mE: f64(MAX_MOMENTS),
    mP: u8(MAX_MOMENTS), mT: u8(MAX_MOMENTS), mNe: f64(MAX_MOMENTS), mS: u8(MAX_MOMENTS), mTh: i8(MAX_MOMENTS).fill(-1),
    mSo: u8(MAX_MOMENTS), mR: u8(MAX_MOMENTS), mC: u8(MAX_MOMENTS),
    cT: nanF64(32), cP: u8(32), gHK: new Int16Array(32 * 8).fill(-1), gHN: u8(32 * 8), gET: nanF64(32),
    pUT: nanF64(n), 
    ow: new Uint32Array(2), oP: 1, fK: new Uint32Array(4), tKi: 0, fr: new Uint32Array(128), hR: 0,
    fPD: 0, fWD: 0, fWP: 0, fWS: -1, fWDe: 0, pO: 0,
    cC: -1, sD: u8(n), mPr: 0, tnK: -1,
    rOL: i8(T).fill(-1), tPX1: f32(T).fill(NaN), tPZ1: f32(T).fill(NaN), tPS: f32(T).fill(NaN), tMT: nanF64(T),
    bT1: nanF64(n), bW: i8(n).fill(-1), movers: 0, nO: 0,
    pCh: u8(n), phh: f32(PHRASE_CAP * 16), pN2: u8(PHRASE_CAP), pHe: 0,
    f: f64(24),
    att: createAttention(),
  };
  w.f[F.LAST_T] = NaN; w.f[F.T0] = NaN; w.f[F.MUSIC_ON] = -1e9; w.f[F.NEW_WISH] = -1e9; w.f[F.SONG] = -1e9; w.f[F.TUNE_U] = -1e9;
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
  w.bS = b.shape === 'disc' ? 0 : 1; w.bx = b.x * sc; w.bz = b.z * sc;
  w.ba = b.shape === 'disc' ? (b.r ?? 3.4) : (b.hx ?? 3.4); w.bb = b.shape === 'disc' ? (b.r ?? 3.4) : (b.hz ?? 2.4); w.br = b.round ?? 0;
  w.gTL.fill(-1);
  const nt = Math.min(MAX_THINGS, def.things.length); w.nTD = nt;
  for (let k = 0; k < nt; k++) {
    const t = def.things[k], sp = tall ? tall.things[k] : null;
    const g = THING_IDS.indexOf(t.id); w.tG[k] = g; if (g >= 0) w.gTL[g] = k;
    w.tM[k] = t.mech; w.tX[k] = (sp ? sp.x : t.x) * sc; w.tZ[k] = (sp ? sp.z : t.z) * sc; w.tY[k] = sp ? sp.yaw : t.yaw;
    w.tS[k] = t.size[0]; w.tS1[k] = t.size[1]; w.tS2[k] = t.size[2];
    const use = sp ? sp.use : t.useSpot;
    if (use) { w.tUX[k] = use[0] * sc; w.tUZ[k] = use[1] * sc; }
    else if (t.mech === MECH.ring) { w.tUX[k] = w.tX[k]; w.tUZ[k] = w.tZ[k]; }
    else { w.tUX[k] = NaN; w.tUZ[k] = NaN; }
    const pk = sp ? sp.peek : t.peek;
    for (let j = 0; j < 4; j++) w.tP[k * 4 + j] = pk ? pk[j] * sc : NaN;
    const ps = sp ? sp.push : t.push;
    w.tPX[k] = ps ? ps[0] * sc : NaN; w.tPZ[k] = ps ? ps[1] * sc : NaN;
    if (t.mech === MECH.ring) {
      const way = (t.p.way ?? 0.6) + t.size[0], yaw = w.tY[k];
      w.tWX[k] = w.tX[k] + Math.cos(yaw) * way; w.tWZ[k] = w.tZ[k] + Math.sin(yaw) * way;
    } else { w.tWX[k] = NaN; w.tWZ[k] = NaN; }
    w.tR[k] = t.p.rider ?? 0; w.tRi[k] = t.ride ? 1 : 0;
    w.tSw[k] = t.switch ? SWITCH[t.switch] : 0;
    w.tSk[k] = (t.p as { sky?: number }).sky ? 1 : 0;
    w.tI[k] = t.icon; w.tV[k] = t.verb; w.tK[k] = KIND_OF_ICON[t.icon] ?? 0;
    w.tFN[k] = (sp ? sp.fromN : undefined) ?? t.fromN ?? 0;
    w.tZo[k] = -1; w.tPa[k] = -1;
  }
  const nz = Math.min(MAX_ZONES, def.zones.length); w.nZ = nz;
  for (let k = 0; k < nz; k++) {
    const z = def.zones[k], a = tall ? tall.zones[k] : z;
    w.zK[k] = z.kind; w.zS[k] = z.strength; w.zSh[k] = a.shape === 'disc' ? 0 : 1;
    w.zX[k] = a.x * sc; w.zZ[k] = a.z * sc; w.zR[k] = a.r ?? 0; w.zH[k] = a.hx ?? 0; w.zHZ[k] = a.hz ?? 0; w.zY[k] = a.yaw ?? 0;
    w.zF0[k] = z.falloff ? z.falloff[0] : -1; w.zF1[k] = z.falloff ? z.falloff[1] : 1;
    w.zSu[k] = z.surfaceY ?? 0; w.zG[k] = z.glow ? 1 : 0; w.zSo[k] = z.shower ? 1 : 0;
    w.zFl[k] = z.flow && (z.flow[0] !== 0 || z.flow[1] !== 0) ? 1 : 0;
    w.zGa[k] = z.gust ? z.gust.everyS[0] : 0; w.zGb[k] = z.gust ? z.gust.everyS[1] : 0; w.zGf[k] = z.gust ? z.gust.forS : 0;
    w.zT[k] = -1;
    for (let t = 0; t < nt; t++) if (ownsArea(def.things[t].zone, z.id)) { w.zT[k] = t; if (w.tZo[t] < 0) w.tZo[t] = k; break; }
  }
  w.gMk = def.ground.mark ? 1 : 0; w.snG = def.weather === 'snow' ? 1 : 0; // (round 4) Frostbell's snowy ground: the snow look rises on it while still
  const np = Math.min(MAX_PATCHES, def.patches.length); w.nP = np;
  for (let k = 0; k < np; k++) {
    const p = def.patches[k], a = tall ? tall.patches[k] : p;
    w.pS[k] = a.shape === 'disc' ? 0 : 1; w.pX[k] = a.x * sc; w.pZ[k] = a.z * sc; w.pR[k] = (a.r ?? 0) * (def.unit === 'slot' ? 1 : 1);
    w.pH[k] = a.hx ?? 0; w.pHZ[k] = a.hz ?? 0; w.pY[k] = a.yaw ?? 0;
    w.pN[k] = p.nap ? 1 : 0; w.pI[k] = p.ice ? 1 : 0; w.pSa[k] = p.id.indexOf('sand') >= 0 ? 1 : 0; w.pMk[k] = p.mark ? 1 : 0;
    w.pT[k] = -1;
    for (let t = 0; t < nt; t++) if (ownsArea(def.things[t].patch, p.id)) { w.pT[k] = t; if (w.tPa[t] < 0) w.tPa[t] = k; break; }
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

/** Is the query point inside zone k (patch 0) or patch k (patch 1) grown by growMm / 1000 m? (a disc of r, or a box of hx, hz turned by yaw) */
export function inAreaAt(w: LifeWorld, patch: number, k: number, growMm: number): boolean {
  const dx = w.f[F.PX] - (patch ? w.pX[k] : w.zX[k]), dz = w.f[F.PZ] - (patch ? w.pZ[k] : w.zZ[k]), g = growMm * 0.001;
  if ((patch ? w.pS[k] : w.zSh[k]) === 0) { const r = (patch ? w.pR[k] : w.zR[k]) + g; return dx * dx + dz * dz <= r * r; }
  const yaw = patch ? w.pY[k] : w.zY[k], c = Math.cos(yaw), sn = Math.sin(yaw);
  return Math.abs(dx * c + dz * sn) <= (patch ? w.pH[k] : w.zH[k]) + g && Math.abs(dz * c - dx * sn) <= (patch ? w.pHZ[k] : w.zHZ[k]) + g;
}

/** Zone k's strength at the query point into w.f[F.S] (0 outside); with a falloff [full radius, edge strength] it falls evenly to the edge. */
export function zoneStrengthAt(w: LifeWorld, k: number): void {
  w.f[F.S] = 0;
  if (!inAreaAt(w, 0, k, 0)) return;
  let s = w.zS[k];
  if (w.zSh[k] === 0 && w.zF0[k] >= 0) {
    const dx = w.f[F.PX] - w.zX[k], dz = w.f[F.PZ] - w.zZ[k], d = Math.sqrt(dx * dx + dz * dz), r0 = w.zF0[k], r1 = w.zR[k];
    if (d > r0 && r1 > r0) s = s + (w.zF1[k] - s) * ((d - r0) / (r1 - r0));
  }
  w.f[F.S] = s;
}

/** Is the query point inside the place's bounds shrunk by shrinkMm / 1000 m (a rounded box: the corner circle of radius `round`)? */
export function inBounds(w: LifeWorld, shrinkMm: number): boolean {
  const shrink = shrinkMm * 0.001, dx = w.f[F.PX] - w.bx, dz = w.f[F.PZ] - w.bz;
  if (w.bS === 0) { const r = w.ba - shrink; return r > 0 && dx * dx + dz * dz <= r * r; }
  const hx = w.ba - shrink, hz = w.bb - shrink;
  if (hx <= 0 || hz <= 0) return false;
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (ax > hx || az > hz) return false;
  const rr = w.br - shrink;
  if (rr <= 0) return true;
  const cx = hx - rr, cz = hz - rr;
  if (ax <= cx || az <= cz) return true;
  return (ax - cx) * (ax - cx) + (az - cz) * (az - cz) <= rr * rr;
}

/** Is the query point inside thing k's keep-out (its footprint grown by growMm / 1000 m)? Patch and walk-on things (rug, pad, turntable,
 *  pool) have none. */
export function inKeepOut(w: LifeWorld, s: LifeSnapshot, k: number, growMm: number): boolean {
  const m = w.tM[k], g = growMm * 0.001;
  let tx = w.tX[k], tz = w.tZ[k];
  const row = w.rOL[k];
  if (row >= 0) { tx = s.thingX[row]; tz = s.thingZ[row]; }
  else if (s.nThings > 0 || w.home) return false; // not out now (Home's things arrive one by one)
  if (m === 0 || m === MECH.pad || m === MECH.turntable || m === MECH.pool) return false;
  const dx = w.f[F.PX] - tx, dz = w.f[F.PZ] - tz, s0 = w.tS[k], s1 = w.tS1[k];
  if (m === MECH.ball || m === MECH.mound || m === MECH.chime) { const r = s0 + g; return dx * dx + dz * dz <= r * r; }
  if (m === MECH.ring) return Math.abs(Math.sqrt(dx * dx + dz * dz) - s0) <= s1 + g;
  const yaw = w.tY[k], c = Math.cos(yaw), sn = Math.sin(yaw), lx = Math.abs(dx * c + dz * sn), lz = Math.abs(dz * c - dx * sn);
  if (m === MECH.swing) return lx <= 0.7 + s1 * 0.5 + g && lz <= s1 * 0.5 + g;
  if (m === MECH.bar) return lx <= s1 * 0.5 + g && lz <= s0 + g;
  return lx <= s0 + g && lz <= w.tS2[k] + g;
}
/** Is the query point clear of every thing's keep-out grown by growMm? */
export function clearOfThings(w: LifeWorld, s: LifeSnapshot, growMm: number): boolean {
  for (let k = 0; k < w.nTD; k++) if (inKeepOut(w, s, k, growMm)) return false;
  return true;
}
/** The query point becomes the target point (w.f[F.X], w.f[F.Z]). */
export function qT(w: LifeWorld): void { w.f[F.PX] = w.f[F.X]; w.f[F.PZ] = w.f[F.Z]; }
/** No lean: the pose lean (w.f[F.X2], w.f[F.Z2]) is 0 (also a hop straight up). */
export function noLean(w: LifeWorld): void { w.f[F.X2] = 0; w.f[F.Z2] = 0; }
/** Is the query point a free target for character i: inside the bounds shrunk by R + 0.2 m and clear of every keep-out (0.4 m, R + 0.05)? */
export function freeSpot(w: LifeWorld, s: LifeSnapshot, i: number): boolean { return inBounds(w, shrinkMm(s, i)) && clearOfThings(w, s, keepMm(s, i)); }
/** A free target's keep-out growth for a body of radius r: 0.4 m, and at least R + 0.05 m (mm). */
export function keepMm(s: LifeSnapshot, i: number): number { return s.r[i] + 0.05 > 0.4 ? ((s.r[i] + 0.05) * 1000) | 0 : 400; }
/** The shrink R + 0.2 m of a free target for character i (mm). */
export function shrinkMm(s: LifeSnapshot, i: number): number { return ((s.r[i] + 0.2) * 1000) | 0; }

/* ───────────────────────────── the gust clock (round 4: B19 and HOLD_ON in real places) ───────────────────────────── */

/** LIFE's own gust clock on sim time for every wind zone with gust data (PLACES 2.2: "gusts by data", e.g. the Night Breeze every 6..10 s
 *  for 2.5 s): deterministic from the world's seed, the visit and the zone (no host clock exists for it: the shell, physics and audio each
 *  had none or their own; they can follow this one through lifeGustOn). Advanced once per lifeStep; allocates nothing. */
export function gustStep(w: LifeWorld, t: number): void {
  for (let k = 0; k < w.nZ; k++) {
    if (!(w.zGf[k] > 0)) continue;
    if (w.zGn[k] >= 1e8) gustNext(w, k, t);
    for (let n = 0; n < 8 && t >= w.zGn[k]; n++) { w.zGe[k] = w.zGn[k] + w.zGf[k]; gustNext(w, k, w.zGn[k]); }
  }
}
/** Zone k's next gust start after `from`: from + a draw in its everyS range (at least its gust length), from a hash of seed, visit, zone, time. */
function gustNext(w: LifeWorld, k: number, from: number): void {
  let h = (w.seed ^ Math.imul(w.visit + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b) ^ ((from * 1000) | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h = (h ^ (h >>> 16)) >>> 0;
  const gap = w.zGa[k] + (w.zGb[k] - w.zGa[k]) * (h / 4294967296);
  w.zGn[k] = from + (gap > w.zGf[k] ? gap : w.zGf[k]);
}

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
  w.rng[i] = (w.gs[i] ^ SALTS.life ^ Math.imul(w.visit + 1, 0x85ebca6b)) >>> 0;
}

/* ───────────────────────────── intents and events (the hot path) ───────────────────────────── */

/** Append an intent for character `who`; returns its index or -1 (the list is full, or a runaway character passed 12 in one call). */
export function pushIntent(w: LifeWorld, out: LifeIntents, kind: number, who: number): number {
  if (out.n >= out.kind.length || w.pCh[who] >= 12) return -1;
  const k = out.n++;
  w.pCh[who]++;
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
