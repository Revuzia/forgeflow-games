// PLAYGROUND: THE LIFE HOST (PLAYGROUND_BUILD.md 4, 11.2 to 11.7, 11.13, 11.14; LIFE.md 12; QUESTS.md 4). The LIFE CHUNK's facade: boot.ts imports this
// module dynamically AFTER the first frame of play (D-69), so `src/life/**`, the quest reducer and the journal store, `physics/props.ts` and Home's
// data are never in the first-play download (the file name is `later-life`: the G0b gate counts every chunk not named later-*). Until it lands,
// Home is today's toy and game.ts's early log keeps the player's touches and capsules (shell/lifeLink.ts).
//
// Once a frame, from game.ts simStep (its own lines, D-58):
//   act    the prop world's beginFrame; the due queued intents (a delayed hop, a voice); the party sync (bodies in and out, the cut's pieces)
//   drain  takeAuto (an `auto` land or bump goes to the attention budget: a soft thud at most, never a haptic, never a shake, never the meter)
//          and noteEvent (the player's touches: touch kinds, TOUCH records, the toss state)
//   sense  the prop world's endFrame and its strikes; the snapshot filled IN PLACE; lifeStep; the intents applied through the one arbiter
//          (LIFE moves bodies only by scootTo, hop and setSquash, which physics pauses under a touch; moveTo stays the ceremonies' and the cut's);
//          the over-budget rule; LIFE's events into the play-event ring
//   quest  the ring drained into the journal (collection.feedPlay), once a frame
// No call allocates per frame (typed arrays and reused objects only; an event's handling allocates nothing). Screens (the Journal, Travel)
// call the LifeHostApi members, which may allocate (they are not per frame).
//
// Physics members used (PG_PHYS round 4 built every one; round 3's FALLBACKS are gone, PG_SHELL.md R4b.2):
//   SoftEvent.auto / prop / other  an `auto` land or bump goes to the attention budget; a body bump's partner is `other` (its contactSlot = our slot)
//   metrics.contacts               a touching pair of awake bodies (a bit per contactSlot) adds UNIT.pair to the units
//   setBounds / setHome            a place's area on arrival and for a squishy who joins there (-1 at Home: the published corral about each body's
//                                  spot); the corral's home moves where LIFE brought a body to rest
//   carryTo                        LIFE's USE intent (a ride the player asked for): the body is lifted onto the seat or the board's free end
//   setParked / setAuto / grabProp / dragPropRay / releaseProp   Home's things shown and parked; D-95's AUTO and the hand on a hinge ride
import type { LifeEvents, LifeIntents, LifeSnapshot, PlayEventRing, SoftBodyLike, SoftEvent, TierName, V3 } from '../contracts.ts';
import { cameraForward, cameraRay, projectToNdc, pxToNdc, raycastAt, rayPlane } from '../input/camera.ts';
import type { Game } from './game.ts';
import type { LifeHostApi, LifeNote } from './lifeLink.ts';
import type { Genome } from '../core/genome.ts';
import { pitchRatio } from '../core/genome.ts';
import type { StorageLike } from '../core/settings.ts';
import type { StorageSubscribe } from '../core/save.ts';
import { createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeRemove, lifeStep, lifeScript, lifeSetJournal, lifeSetPair, lifeSetFriends,
  lifeLooks, lifeAddLook, lifeWishOf, lifePhrase, lifeAttention, lifeDebug, lifeSetHops, lifeThingTap, lifeGustOn, attentionSound, PHRASE, UNIT, CHAR_CAP, lifeSeeksNew, lifeWaitsTurn, lifeBusy, lifeUsesOf } from '../life/step.ts';
import type { LifeWorld } from '../life/step.ts';
import * as LIFE_STEP from '../life/step.ts';
import type { PropWorld } from '../physics/props.ts';
import { PLACE as HOME } from '../data/place_home.ts';
import { PLACE_INFO, THING_IDS, THING_KINDS, loadPlaceDef, MECH, PROP_SOUND, ZONE, ownsArea } from '../data/places.ts';
import type { PlaceDef, PlaceId, ThingDef } from '../data/places.ts';
import { INTENT, LIFE_FLAG, LIFE_EV, LOOK, SCRIPT, TOUCH, USE_VERB, WISH_KIND, SPECIES_LIFE, FAMILY_REACT, LOOK_ADD } from '../data/life.ts';
import { EV, BY, WISH_STATE, UI_KIND, EV_FLAG, QUESTS, CHAPTERS } from '../data/quests.ts';
import { CATALOG, speciesIdx, familyOf } from '../data/catalog.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
import type { JournalRuntime } from '../collection/journal_store.ts';
import { JOURNAL_FRAME_KEY, JOURNAL_FRAME_MAX_CHARS } from '../collection/journal.ts';
import type { CollectionEvent, JournalView } from '../collection/types.ts';
import { JOURNAL_KEY } from '../collection/constants.ts';
import { HOME_TEXT } from '../data/quests.ts';

const CAP = 16;          // characters (LIFE's world)
const QCAP = 64;         // queued (delayed) intents
const RING_CAP = 64;     // the play-event ring (QUESTS 4)
const FIRST_PLAY_S = 6, FIRST_WISH_S = 60, FIRST_WISH_LATEST_S = 300;
const HOP_LEAD_S = 0.12; // a HOP's anticipation squash comes this long before the impulse (LIFE act.ts)
const HOP_GO = 200;      // an internal queued kind: the hop impulse itself
const TAP_MS = 350, TAP_PX = 12;   // a press and release this short and this still is a tap on a thing (a longer or moving press is the camera's)
const MUSIC_BOX_S = 29.1, MUSIC_BOX_GAP_S = 40, KETTLE_BAR_S = 3.6;   // PLACES 4.1 / 4.2, AU-14: the tune's 8 bars, one start per 40 s; the whistle's one bar
const FLICK_MS = 1.2;    // a tapped ball rolls away from the camera at this speed (m/s): "Roll the Felt Ball"
const SHOWER_S = 4;      // a tapped Drip Leaf tips its shower this long (PLACES 2.1 M14: "tap it: the leaf tips a shower")
const SET_S = 6;         // a ride the body lands on within this many seconds of the player letting go of it (or lifting it there) is a ride the player SET UP
const PAD_USE_GAP_S = 2; // one USE BOUNCE per body per this many seconds of pad kicks (a landing's kicks in a row are one bounce)
const CHIME_V = 0.1, CHIME_GAP_S = 1;   // round 7 (R7_LIFE's request): a body's chime strike is its USE only when it moves into it (faster than this, or tossed), one a second
const HUSH_S = 4;        // round 5 (B7): a body the over-budget rule must put to sleep takes no new LIFE motion for this long (it comes to rest, then sleeps)
const ASKED_S = 30;      // round 5 (B7), round 6 (VERDICT_PG2 N1): a squishy the player asked to play ("Go play with...") is ASKED until it has used the thing (its
                         // USE BY PLAYER) or this long has passed: the budget never holds its motion back, never hushes it or puts it to sleep, and makes room for it
/** Home's things by THING_IDS index: what each one arrives after (PLACES 4.1) */
const THING_FELT = 0, THING_MUSIC = 1, THING_RUG = 2, THING_LAMP = 3, THING_SHELF = 4, THING_PAD = 5;
/** the cut flavour index (audio/cut.ts CUT_FLAVOURS: gel, sticky, foam, beads, dough, firm) of each material family (MATERIAL_FAMILY_IDS order) */
const FLAVOUR_OF: Readonly<Record<string, number>> = { jellygel: 0, gummy: 0, waterfill: 0, stickystretch: 1, slimegoo: 1, slowrise: 2, marshmallow: 2, beadsqueeze: 3, putty: 4, mochidough: 4, firmsilicone: 5, popdome: 5 };

/** Round 5 (VERDICT_PG C1, D-92): the parts that ship in their own lazy chunks (shell/later-quests.ts, shell/later-props.ts), requested in parallel with this
 *  one and handed in here, so the life chunk stays under its 150 KB cap. */
export interface LifeHostParts {
  attachJournal: typeof import('../collection/journal_store.ts').attachJournal;
  buildPropWorld: typeof import('../physics/props.ts').buildPropWorld;
}
export interface LifeHostDeps {
  parts: LifeHostParts;
  storage: StorageLike | null;
  subscribe?: StorageSubscribe;
  /** say a polite live line (the announcer) */
  say?(text: string): void;
  /** a small toast for a moment (a new stamp, a place open); `said`: the line was already said in the live region (the moment only shows it) */
  moment?(text: string, said?: boolean): void;
  /** the quest-complete haptic (only when the player completed it: D-84) */
  stampHaptic?(): void;
  /** a phone: a coarse pointer or the short side under 600 CSS px (LifeSnapshot.phone) */
  phone?(): boolean;
  /** prefers-reduced-motion */
  reducedMotion?(): boolean;
  /** the journal store's timers (node checks pass none: then it writes at once) */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** (round 9, dev and probes only) LIFE's world seed (default 0x5eed1e): probe_life_selfuse's `seed=` runs the same parties on another stream */
  lifeSeed?: number;
}

interface Char {
  on: boolean; body: SoftBodyLike | null; genome: Genome | null; itemId: string | null; view: number;
  kind: 0 | 1 | 2; group: number; species: number; family: number; flavour: number; pitch: number; frac: number; r: number;
  offX: number; offY: number; offZ: number;
  lastX: number; lastZ: number; vx: number; vz: number;
  homeX: number; homeZ: number;
  outAt: number;          // sim time it came out (FIRST_WISH's "out longest")
  scooting: boolean; scootX: number; scootZ: number;
  tossed: boolean; wasCarried: boolean; touchKind: number; asleepShown: boolean;
  rideUntil: number;      // RIDE (D-74)
  setT: number;           // sim time the player let go of it (a carry ended) or lifted it onto a ride (useRide): QUESTS 4's "rides the player set up"
  padT: number;           // sim time of its last USE BOUNCE from a pad kick
  chimeT: number;         // (round 7) sim time of its last USE RING from a chime strike
  perchT: number;         // (round 7) how long it has rested on top of a tall block (perchDown hops it down)
  padRestT: number;       // (round 9) how long it has rested on a pad in a place (padOffHop hops it off)
  outT: number;           // (round 9) how long it has rested outside the place's bounds (backIn hops it in)
  stuckT: number; stuckX: number; stuckZ: number;   // (round 9) where and since when a LIFE scoot has made no headway (unstick)
  hushT: number;          // round 5 (B7): until this sim time LIFE's motion intents for it are dropped (the over-budget rule is putting it to sleep)
  askedT: number;         // round 5 (B7): sim time the player last asked it to play (playWith); -1e9 once it used the thing (round 6: see asked())
}
const mkChar = (): Char => ({ on: false, body: null, genome: null, itemId: null, view: -1, kind: 0, group: -1, species: 255, family: 0, flavour: 0, pitch: 1, frac: 1, r: 0.5,
  offX: 0, offY: 0, offZ: 0, lastX: 0, lastZ: 0, vx: 0, vz: 0, homeX: 0, homeZ: 0, outAt: 0, scooting: false, scootX: 0, scootZ: 0,
  tossed: false, wasCarried: false, touchKind: -1, asleepShown: false, rideUntil: -1e9, setT: -1e9, padT: -1e9, chimeT: -1e9, perchT: 0, padRestT: 0, outT: 0, stuckT: 0, stuckX: 0, stuckZ: 0, hushT: -1e9, askedT: -1e9 });

function mkSnapshot(): LifeSnapshot {
  const n = CAP;
  return { n: 0, t: 0, place: 0, tier: 1, phone: false, calm: false, reducedMotion: false, autonomy: true, quiet: false, units: 0, musicField: 0, musicOn: true,
    musicBoxOn: false, beatPhase: 0, kind: new Uint8Array(n), group: new Int8Array(n), species: new Uint8Array(n), family: new Uint8Array(n),
    frac: new Float32Array(n).fill(1), r: new Float32Array(n).fill(0.5), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vz: new Float32Array(n), sx: new Float32Array(n).fill(NaN), sy: new Float32Array(n).fill(NaN), flags: new Uint16Array(n),
    zoneMask: new Uint16Array(n), submerged: new Float32Array(n), warmth: new Uint8Array(n), zoneThing: new Int16Array(n).fill(-1),
    patchThing: new Int16Array(n).fill(-1), nThings: 0, thingId: new Int16Array(32), thingX: new Float32Array(32), thingZ: new Float32Array(32),
    thingState: new Float32Array(32), thingBusy: new Uint8Array(32), nBumps: 0, bumpA: new Int8Array(32), bumpB: new Int8Array(32), touchKind: new Int8Array(n).fill(-1) };
}
function mkIntents(): LifeIntents {
  const n = 64;
  return { n: 0, kind: new Uint8Array(n), who: new Uint8Array(n), delayS: new Float32Array(n), a: new Float32Array(n), b: new Float32Array(n), c: new Float32Array(n),
    d: new Float32Array(n), e: new Float32Array(n), icon: new Uint8Array(n), style: new Uint8Array(n), prio: new Float32Array(n), groupKey: new Int16Array(n), dots: new Uint8Array(n) };
}
function mkEvents(): LifeEvents {
  const n = 32;
  return { n: 0, kind: new Uint8Array(n), sub: new Uint8Array(n), a: new Uint8Array(n), b: new Uint8Array(n), n2: new Uint8Array(n), thing: new Int8Array(n) };
}
function mkRing(cap = RING_CAP): PlayEventRing {
  return { n: 0, dropped: 0, kind: new Uint8Array(cap), sub: new Uint8Array(cap), place: new Uint8Array(cap), thing: new Int16Array(cap), a: new Uint8Array(cap),
    b: new Uint8Array(cap), fam: new Uint8Array(cap), n2: new Uint8Array(cap), by: new Uint8Array(cap), flag: new Uint8Array(cap), v: new Float32Array(cap) };
}
const TIER_IDX: Readonly<Record<string, number>> = { low: 0, med: 1, high: 2 };
const famIdxOfSpecies = (sp: number): number => (sp >= 0 && sp < CATALOG.length ? MATERIAL_FAMILY_IDS.indexOf(CATALOG[sp].family) : 255);
const questIdx = (id: string): number => QUESTS.findIndex((q) => q.id === id);
/** a quest's player title (Home's from HOME_TEXT here; the others come from the screens chunk's journal_text) */
export function homeQuestTitle(idx: number): string | null { const q = QUESTS[idx]; return q && q.chapter === 0 ? HOME_TEXT.quests[q.idx % 10]?.[0] ?? null : null; }

/** The front-most z (toward the camera) of a place's things' floor footprints in a layout (a thing's half extents by mechanism, turned by its yaw;
 *  patch and zone things count by their size too). For the camera's framing only (setPlayBounds), never for physics. */
export function frontReach(d: PlaceDef, layout: 0 | 1): number {
  let front = -Infinity;
  for (let k = 0; k < d.things.length; k++) {
    const t = d.things[k], sp = layout === 1 ? d.tall.things[k] ?? t : t, s = t.size;
    let hx: number, hz: number;
    switch (t.mech) {
      case MECH.block: case MECH.seesaw: hx = s[0]; hz = s[2] ?? s[0]; break;
      case MECH.bar: hx = (s[1] ?? 0) / 2; hz = s[0]; break;
      case MECH.ring: hx = hz = s[0] + (s[1] ?? 0); break;
      case MECH.swing: hx = s[0]; hz = (s[1] ?? 0) / 2; break;
      default: hx = s[0]; hz = s[2] || s[0];
    }
    const c = Math.abs(Math.cos(sp.yaw)), sn = Math.abs(Math.sin(sp.yaw));
    front = Math.max(front, sp.z + sn * hx + c * hz);
  }
  return front;
}

/** Build the LIFE host and attach it to the game (game.attachLife). Returns null when the game cannot host it (no stage camera). */
export function createLifeHost(game: Game, deps: LifeHostDeps): LifeHostApi {
  const stage = game.stage, audio = game.audio, bodies = game.bodies;
  const w: LifeWorld = createLifeWorld(deps.lifeSeed ?? 0x5eed1e, CAP);
  const s = mkSnapshot(), out = mkIntents(), ev = mkEvents(), ring = mkRing();
  const att = lifeAttention(w);
  const chars: Char[] = Array.from({ length: CAP }, mkChar);
  const report = (e: unknown): void => { console.error(e); };
  lifeSetHops(w, 0);   // S1: every family at the S1 hop cap (LIFE 5.2)
  // (round 7, R7_LIFE's request) LIFE gets onto teeters, rockers and swings by itself, now that the host lifts its own get-on without the player's mark (useRide's
  // `self`); AUTO stays the player's. The switch is LIFE's (step.ts lifeSetSelfRides), looked up so a LIFE without it is left as it was.
  (LIFE_STEP as unknown as { lifeSetSelfRides?: (lw: LifeWorld, on: boolean) => void }).lifeSetSelfRides?.(w, true);

  // ---- the queued intents (a delayed hop or voice): typed arrays, no allocation ----
  const qKind = new Uint8Array(QCAP), qWho = new Uint8Array(QCAP), qDue = new Float64Array(QCAP), qA = new Float32Array(QCAP), qB = new Float32Array(QCAP),
    qC = new Float32Array(QCAP), qD = new Float32Array(QCAP), qE = new Float32Array(QCAP), qIcon = new Uint8Array(QCAP), qStyle = new Uint8Array(QCAP), qDots = new Uint8Array(QCAP);
  let qLen = 0;
  const phraseBuf = new Float32Array(16);
  const creatureP = { phrase: phraseBuf, n: 0, flavour: 0, register: 0, pitch: 1, pan: 0, level: 1, group: 1, echo: false, at: 0, sing: false };
  const thudP = { kind: 0, intensity: 0, pitch: 1, pan: 0 };
  const nudgeV = { x: 0, y: 0, z: 0 };   // GLIDE's velocity change (one object, reused)
  const propP = { kind: 0, intensity: 0, note: 0, pan: 0, auto: true, size: 0.22 };
  // a held voice (PG_AUDIO: a creaking rocker or swing, a rolling ball): every frame while it moves, then once at 0 (its own object: `key` + `held` mark it held)
  const heldP = { kind: 0, intensity: 0, pan: 0, auto: true, key: 0, held: 0, size: 0.22 };
  const heldWas = new Float32Array(64);
  const ballV = new Float64Array(3);
  let coldPitch = 1;          // a cold place's voices sound a semitone lower (PG_AUDIO: x 2^(-1/12); Frostbell's whole-place cold)
  let finaleOff = -1;         // sim time the place's finale light eases back (thingFx(-1, 2, 0)), -1 none
  let playerTouchT = -1e9;    // the player's last tap or hand on a thing (a held voice by the player is not `auto`)
  const scr = new Float32Array(4);
  const looks = new Float32Array(6);
  const vis = new Float32Array(4);
  const wishOut = new Int32Array(2);
  const strikes = new Float32Array(32 * 4);
  const counts = { emote: 0, voice: 0, scoot: 0, hop: 0, gaze: 0, pose: 0, auto: 0, records: 0, ride: 0, held: 0, askedUse: 0, squirt: 0 };   // what LIFE did through the host (the dev view; held: motion the budget's wake gate dropped; askedUse: uses BY PLAYER)
  let wakeClaim = 0;                       // round 5 (B7): the units this frame's allowed wakes add (the snapshot shows them next frame)

  // ---- the place: Home's world now, a place's world after a trip ----
  let placeIdx = 0, visit = 1, layout: 0 | 1 = 0, bodyScale = 1;
  let def: PlaceDef = HOME;
  let world: PropWorld | null = null;
  let thingFirst = new Int16Array(0);      // per place-local thing: its first prop (-1: none, a patch thing)
  let thingGlobal = new Int16Array(0);     // per place-local thing: its THING_IDS index
  const homeShown = new Uint8Array(8);     // Home's things shown now
  let travelling = false;
  let floatParked = false;                 // the Float rule (D-97, replaced D-83): Float is on: every squishy out floats, at every place (LIFE's motion, rides and thing play pause; the world stays)
  // round 5: a "Go play with..." lift onto a swing holds the seat with a steadying hand (useRide, steadyStep): its prop, the squishy, when it sat, the ease
  let steadyP = -1, steadyI = -1, steadyOnT = -1, steadyT0 = 0, steadyEase = 0.5, steadyLand = 0, steadyEnd = 0;
  const steadyFrom = new Float64Array(3), steadyTo = new Float64Array(3);

  // ---- the journal, the ring and the moments ----
  let journal: JournalRuntime | null = null;
  const { attachJournal, buildPropWorld } = deps.parts;
  // (round 6: a place the save's stamps already reach opens QUIETLY while the journal attaches ("places that shipped since the last load": a player who passed
  // 12 stamps before Ripple Shore shipped; journal_store drops its load-time events on purpose). The open places of the save as it was before the attach are
  // read here, so the host can show those that opened at this load once it is up)
  let placesBefore = -1;
  try { const raw = deps.storage?.getItem(JOURNAL_KEY); const o = raw ? JSON.parse(raw) as { pl?: unknown } : null; if (o && typeof o.pl === 'number') placesBefore = o.pl; } catch { placesBefore = -1; }
  try { journal = attachJournal(game.hoard, { storage: deps.storage, subscribe: deps.subscribe, setTimer: deps.setTimer, clearTimer: deps.clearTimer }); } catch (e) { report(e); }
  const owned = new Uint32Array(2), favKnown = new Uint32Array(4), friendMask = new Uint32Array(2);
  let openPlacesMask = 1;
  const wishKindOf = new Int32Array(CAP), wishTargetOf = new Int32Array(CAP).fill(-1);
  let sheets = 0;                          // bit 0 the Journal, bit 1 Travel (LIFE goes quiet)
  let attachT = -1;                        // sim time the host attached (FIRST_WISH's 5:00)
  let firstReleaseT = -1, firstRevealT = -1, firstPlaySent = false, firstWishSent = false, freshProfile = false;
  let touchingNow = false;
  let lastCeremony: 'capsule' | 'merge' | null = null;
  // the party through a ceremony (11.3, D-52): beforeStart's mat.clear() is a STASH; right after the end the squishies come back, one a step
  let ceremonyOn = false;
  const stash: string[] = [];              // item ids of the squishies out when the ceremony started (not the play body)
  let prevPlay: string | null = null;      // the play squishy's item id when it started (a capsule's newcomer takes its place: it comes back beside it)
  const restoreQ: string[] = [];           // item ids still to bring back (at most 5)
  const shelved: string[] = [];            // names that found no room ("... went back to the shelf for a rest.")
  let newcomerId: string | null = null;    // the capsule's newcomer: added NEW (B09's shy arrival and hello)
  let firstCapsule = false;                // this capsule is the player's first (the Journal's H4 not done when it started): D-52 keeps both out

  // (round 6, the dev view: the things the squishies USED by themselves in this place since the arrival, the things their own REACTs named (a wade in the
  // Rock Pool, a glide on the Ice Pond, a shower under the Drip Leaf) and the things their own social moments were played around (a peek round the Driftwood
  // Log, a teeter on the Leaf Teeter, a pile in a nest), THING_IDS index)
  const selfUsed = new Set<number>(), selfReacted = new Set<number>(), selfSocial = new Set<number>();
  const write = (kind: number, sub: number, thing: number, a: number, b: number, n2: number, by: number, v = 0, flag = 0): void => {
    if (by === BY.SELF && thing >= 0) {
      if (kind === EV.USE && selfUsed.size < 64) selfUsed.add(thing);
      else if (kind === EV.REACT && selfReacted.size < 64) selfReacted.add(thing);
      else if (kind === EV.SOCIAL && selfSocial.size < 64) selfSocial.add(thing);
    }
    if (ring.n >= ring.kind.length) { ring.dropped++; return; }
    counts.records++;
    const i = ring.n++;
    ring.kind[i] = kind; ring.sub[i] = sub; ring.place[i] = placeIdx; ring.thing[i] = thing; ring.a[i] = a; ring.b[i] = b; ring.fam[i] = famIdxOfSpecies(a);
    ring.n2[i] = n2; ring.by[i] = by; ring.flag[i] = flag | (game.settings.autonomy ? 0 : EV_FLAG.AUTONOMY_OFF); ring.v[i] = v;
  };

  /** the journal's inputs to LIFE (on a journal change, never per frame): owned species, open places, known favourites, the thing kinds */
  function pushJournal(): void {
    const view = journal ? safeView() : null;
    owned.fill(0); favKnown.fill(0);
    try { for (const it of game.hoard.items()) { const sp = it.speciesIdx; if (sp >= 0 && sp < 64) owned[sp >>> 5] |= 1 << (sp & 31); } } catch (e) { report(e); }
    openPlacesMask = view ? (view.places | 1) : 1;
    let kinds = 0;
    for (const p of PLACE_INFO) if ((openPlacesMask & (1 << p.idx)) !== 0 && p.shipped) kinds |= THING_KINDS[p.id];
    if (view) for (let sp = 0; sp < view.facts.length && sp < 64; sp++) {
      const f = view.facts[sp];
      if (f & (1 << 1)) favKnown[(sp * 2) >>> 5] |= 1 << ((sp * 2) & 31);
      if (f & (1 << 2)) favKnown[(sp * 2 + 1) >>> 5] |= 1 << ((sp * 2 + 1) & 31);
    }
    lifeSetJournal(w, owned, openPlacesMask, favKnown, kinds);
    if (journal) for (let sp = 0; sp < 64; sp++) if ((owned[sp >>> 5] & (1 << (sp & 31))) !== 0) { try { game.hoard.friendMask?.(sp, friendMask); lifeSetFriends(w, sp, friendMask); } catch (e) { report(e); } }
  }
  function safeView(): JournalView | null { try { return journal ? journal.view() : null; } catch (e) { report(e); return null; } }

  // ---- the party: the play body, the squishies brought out, the cut's pieces (LIFE characters by stable slot) ----
  let cutGroup = -1;            // the slot the cut squishy had as a whole (its pieces' group key), -1 while whole
  const slotOfBody = (b: SoftBodyLike): number => { for (let i = 0; i < CAP; i++) if (chars[i].on && chars[i].body === b) return i; return -1; };
  const freeSlot = (): number => { for (let i = 0; i < CAP; i++) if (!chars[i].on && i !== cutGroup) return i; return -1; };
  function wholesOut(): number { let n = 0; for (let i = 0; i < CAP; i++) if (chars[i].on && chars[i].kind === 0) n++; return n; }
  /** cheap: does the registry hold exactly the bodies on the mat now? (no allocation) */
  function partyChanged(): boolean {
    let n = 0;
    if (slotOfBody(bodies.body) < 0) return true;
    n++;
    const xs = bodies.extras;
    for (let i = 0; i < xs.length; i++) { if (slotOfBody(xs[i].body) < 0) return true; n++; }
    let on = 0;
    for (let i = 0; i < CAP; i++) if (chars[i].on) on++;
    return on !== n;
  }
  function addChar(b: SoftBodyLike, g: Genome, itemId: string | null, off: V3, kind: 0 | 1 | 2, group: number, isNew = false): number {
    const i = freeSlot();
    if (i < 0) return -1;
    const c = chars[i];
    c.on = true; c.body = b; c.genome = g; c.itemId = itemId; c.kind = kind; c.group = kind === 0 ? i : group;
    c.view = bodies.viewIdOf(b) ?? -1;
    try { c.species = speciesIdx(g.species); c.family = MATERIAL_FAMILY_IDS.indexOf(familyOf(g.species)); } catch { c.species = 255; c.family = 0; }
    c.flavour = FLAVOUR_OF[MATERIAL_FAMILY_IDS[c.family] ?? 'jellygel'] ?? 0;
    c.frac = b.frac ?? 1;
    c.pitch = pitchRatio(g) * (kind === 0 ? 1 : Math.pow(0.5 / Math.max(0.05, c.frac), 0.4));
    c.r = b.restRadius * Math.cbrt(c.frac);
    c.offX = off.x; c.offY = off.y; c.offZ = off.z;
    const ce = b.center;
    c.lastX = ce.x + off.x; c.lastZ = ce.z + off.z; c.vx = 0; c.vz = 0;
    c.homeX = c.lastX; c.homeZ = c.lastZ;
    c.outAt = game.simTime; c.scooting = false; c.tossed = false; c.wasCarried = false; c.touchKind = -1; c.asleepShown = false; c.rideUntil = -1e9; c.setT = -1e9; c.padT = -1e9; c.chimeT = -1e9; c.perchT = 0; c.padRestT = 0; c.outT = 0; c.stuckT = game.simTime; c.hushT = -1e9; c.askedT = -1e9;
    try { (b as { contactSlot?: number }).contactSlot = i; } catch { /* a mock */ }
    if (world) { try { b.setPropWorld?.(world); } catch (e) { report(e); } }
    let warm = 0;
    try { warm = itemId ? Math.min(5, Math.floor((game.hoard.warmthOf?.(itemId) ?? 0))) : 0; } catch { warm = 0; }
    lifeAdd(w, i, g, kind, c.group, warm, isNew);
    if (placeIdx === 0 && kind === 0) lifeSetHome(w, i, c.homeX, c.homeZ);
    return i;
  }
  /** the same squishy in another body (it came back from a ceremony's stash, or a quick switch made a squishy that was out the play body): the
   *  character keeps its slot and its brain (needs, looks, friendships: a ceremony is not "coming out", LIFE 3), only its body and view change */
  function rebind(i: number, e: { b: SoftBodyLike; off: V3 }): void {
    const c = chars[i], b = e.b;
    clearBubbles(i);
    for (let k = 0; k < qLen; k++) if (qWho[k] === i) qKind[k] = 0;
    try { c.body?.setPropWorld?.(null); } catch { /* gone */ }
    c.body = b; c.view = bodies.viewIdOf(b) ?? -1;
    c.offX = e.off.x; c.offY = e.off.y; c.offZ = e.off.z;
    c.frac = b.frac ?? 1; c.r = b.restRadius * Math.cbrt(c.frac);
    const ce = b.center;
    c.lastX = ce.x + c.offX; c.lastZ = ce.z + c.offZ; c.vx = 0; c.vz = 0; c.homeX = c.lastX; c.homeZ = c.lastZ;
    c.scooting = false; c.tossed = false; c.wasCarried = false; c.touchKind = -1; c.asleepShown = false; c.rideUntil = -1e9;
    try { (b as { contactSlot?: number }).contactSlot = i; } catch { /* a mock */ }
    if (world) { try { b.setPropWorld?.(world); } catch (x) { report(x); } }
    if (placeIdx === 0) lifeSetHome(w, i, c.homeX, c.homeZ);
  }
  function removeChar(i: number): void {
    const c = chars[i];
    if (!c.on) return;
    clearBubbles(i);
    try { c.body?.setPropWorld?.(null); } catch { /* gone */ }
    lifeRemove(w, i);
    // its queued intents go with it
    for (let k = 0; k < qLen; k++) if (qWho[k] === i) qKind[k] = 0;
    c.on = false; c.body = null; c.genome = null; c.itemId = null; c.view = -1;
  }
  /** the party is inside a ceremony or coming back from one (11.3): the registry waits, so nobody is lifeRemoved / lifeAdded for it */
  const partyHeld = (): boolean => ceremonyOn || game.ceremonies.active || game.ceremonies.pending || restoreQ.length > 0;
  /** bring the registry in line with the bodies on the mat (allocates only when something changed: a squishy out or back, a cut, a join) */
  let partySynced = false;       // the first sync (the party the host found at attach) is done: later wholes are brought out by the player
  let cutSignalled = -1;         // the whole that got its CUT touch frame (LIFE 9: the touch comes before the whole is removed)
  function syncParty(): void {
    if (partyHeld() || !partyChanged()) return;
    const cutNow = game.cut.pieces > 1;
    if (!cutNow) cutSignalled = -1;
    const playId = game.identity.itemId;
    // the bodies now (the play body first)
    const list: Array<{ b: SoftBodyLike; g: Genome; id: string | null; off: V3; piece: boolean }> = [{ b: bodies.body, g: game.identity.genome, id: playId, off: { x: 0, y: 0, z: 0 }, piece: cutNow }];
    for (const x of bodies.extras) list.push({ b: x.body, g: x.genome, id: x.itemId ?? (x.piece ? playId : null), off: x.position, piece: !!x.piece || game.cut.isPiece(x.body) });
    // gone: off the mat, or replaced (a cut swaps the play body for its pieces; whole again swaps a fresh body in)
    let wholeCut = -1;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || list.some((e) => e.b === c.body)) continue;
      // the same squishy, whole, in a new body (back from a ceremony's stash; a quick switch to a squishy that was out): it keeps its brain
      if (c.kind === 0 && c.itemId !== null) {
        const e = list.find((x) => !x.piece && x.id === c.itemId && slotOfBody(x.b) < 0);
        if (e) { rebind(i, e); continue; }
      }
      if (cutNow && c.kind === 0 && c.itemId !== null && c.itemId === playId) {
        // the whole that was cut: its slot is its pieces' group key. PG_LIFE (step.ts, LIFE 9): the whole first gets one frame with the CUT touch (the most
        // curious other whole walks over to look), then it is removed and its pieces join (the registry waits that one frame)
        if (cutSignalled !== i) { cutSignalled = i; c.touchKind = TOUCH.CUT; return; }
        wholeCut = i;
      }
      removeChar(i);
    }
    if (wholeCut >= 0) { cutGroup = wholeCut; cutSignalled = -1; }
    if (!cutNow && cutGroup >= 0) {
      // whole again: the pieces are gone (removed above); the fresh whole takes the group's slot back
      const g = cutGroup;
      cutGroup = -1;
      for (const e of list) if (!e.piece && slotOfBody(e.b) < 0 && e.id === playId) { addCharAt(g, e); break; }
    }
    // new: wholes, and pieces (the play body is the face piece, the rest chunks)
    for (const e of list) {
      if (slotOfBody(e.b) >= 0) continue;
      if (e.piece && cutGroup >= 0) addChar(e.b, e.g, e.id, e.off, e.b === bodies.body ? 1 : 2, cutGroup);
      else {
        // a capsule's newcomer arrives NEW (B09: the shy arrival, and its hello within 5 s); in a place a squishy who joins stands at a free spawn spot
        const isNew = e.id !== null && e.id === newcomerId;
        const i = addChar(e.b, e.g, e.id, e.off, 0, -1, isNew);
        if (i >= 0 && placeIdx !== 0 && !travelling) settleInPlace(i);
        // QUESTS 4: one BRING per squishy the player brings out (the Hoard, a switch; the attach's own party and a capsule's newcomer, which CAPSULE records, are not)
        if (i >= 0 && partySynced && !isNew) write(EV.BRING, 0, -1, chars[i].species, 255, 1, BY.PLAYER);
      }
    }
    newcomerId = null;
    partySynced = true;
    afterPartyChange();
  }
  /** in a place: a squishy who came out (the Hoard, back from a ceremony) stands at the layout's spawn spot farthest from everyone else, at rest
   *  (the mat builds it at Home's mat spot, which in a place may be inside a thing) */
  function settleInPlace(i: number): void {
    const lay = layout === 1 ? def.tall : def;
    const spawn = lay.spawn === 'matLayout' ? null : lay.spawn;
    if (!spawn || !spawn.length || !chars[i].body) return;
    let best = 0, bd = -1;
    for (let k = 0; k < spawn.length; k++) {
      let d = 1e9;
      for (let j = 0; j < CAP; j++) if (j !== i && chars[j].on) d = Math.min(d, Math.hypot(chars[j].lastX - spawn[k][0], chars[j].lastZ - spawn[k][1]));
      if (d > bd) { bd = d; best = k; }
    }
    place(chars[i], spawn[best][0], spawn[best][1]);
    const c = chars[i], b = lay.bounds;
    try { c.body!.setBounds?.(b.shape === 'disc' ? 0 : 1, b.x - c.offX, b.z - c.offZ, b.shape === 'disc' ? (b.r ?? 3) : (b.hx ?? 3), b.shape === 'disc' ? 0 : (b.hz ?? 2.4), b.round ?? 0); } catch (e) { report(e); }
  }
  function addCharAt(slot: number, e: { b: SoftBodyLike; g: Genome; id: string | null; off: V3 }): void {
    // a fresh whole in a given (free) slot: take the lowest free one, then move it if needed (slots are LIFE keys only)
    const keep = cutGroup;
    cutGroup = -1;
    const i = addChar(e.b, e.g, e.id, e.off, 0, -1);
    cutGroup = keep;
    void slot; void i;
  }
  /** a party change: sleep for several, the friendship pairs, Home's corral homes and things, the journal's party */
  function afterPartyChange(): void {
    const n = wholesOut();
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body) continue;
      // sleep only with a party (one squishy alone behaves exactly as the published toy); pieces keep CUT3's own rule
      if (c.kind === 0) { try { const want = n >= 2; if (c.body.sleepEnabled !== want) { if (!want) c.body.wake?.(); c.body.sleepEnabled = want; } } catch { /* a mock */ } }
      // a view re-added under a new id (the mat's re-layout, a swap) starts awake: the mirror follows, so the next snapshot tells it the truth
      const nv = bodies.viewIdOf(c.body) ?? c.view;
      if (nv !== c.view) { c.view = nv; c.asleepShown = false; }
    }
    // friendship levels of every pair out (LIFE 6.2), from the journal
    const view = safeView();
    if (view) {
      for (let i = 0; i < CAP; i++) for (let j = i + 1; j < CAP; j++) {
        const a = chars[i], b = chars[j];
        if (!a.on || !b.on || a.kind !== 0 || b.kind !== 0) continue;
        const f = view.friends.find((r) => (r.a === a.species && r.b === b.species) || (r.a === b.species && r.b === a.species));
        lifeSetPair(w, i, j, f ? f.level : 0, !!f && f.best);
      }
    }
    try { const ids: string[] = []; for (const c of chars) if (c.on && c.kind === 0 && c.itemId) ids.push(c.itemId); game.hoard.setJournalParty?.(ids); } catch (e) { report(e); }
    floatRule();
    if (placeIdx === 0) homeThings();
  }

  // ---- the Float rule (D-97, owner 2026-11-19 "float doesnt actually make them float"; it replaced D-83, which forced the table with a party or in a place):
  //      Float floats EVERY squishy out (any party, its cut pieces) at EVERY place. The place's world stays bound and its things stay where they are (the
  //      player's taps on them still work); while it is on LIFE starts no motion (autonomy off: no walks, hops, self-started uses or rides; feelings, looks and
  //      voices go on) and the AUTO chips hide. Each squishy rises where it stands (its hover spot, physics' home, inside the place's area); Table brings
  //      everyone down gently (physics' descent) and LIFE takes up its motion again. The saved setting is the one truth: nothing here overrides it. ----
  function floatRule(): void {
    const now = !game.settings.gravity;
    for (let i = 0; i < CAP; i++) { const b = chars[i].body; if (chars[i].on && b && b.gravity === now) { try { b.gravity = !now; } catch { /* a mock */ } } }
    if (now === floatParked) return;
    floatParked = now;
    if (now) for (let i = 0; i < CAP; i++) if (chars[i].on && chars[i].body) floatHome(i);
  }
  /** D-97: a squishy that starts floating rises where it stands: its hover spot (physics' home) is its centre now (a walk is ended), kept inside the place's
   *  area by its radius + 0.25 m so a toss in the air never carries it out of the place (physics' bounds corral catches the rest) */
  function floatHome(i: number): void {
    const c = chars[i], b = c.body!;
    if (c.scooting) { try { b.scootTo?.(NaN, 0, 0); } catch { /* ignore */ } c.scooting = false; }
    let x = b.center.x + c.offX, z = b.center.z + c.offZ;
    if (placeIdx !== 0) {
      const bd = (layout === 1 ? def.tall : def).bounds, m = c.r + 0.25;
      if (bd.shape === 'disc') {
        const r = Math.max(0, (bd.r ?? 3) - m), dx = x - bd.x, dz = z - bd.z, d = Math.hypot(dx, dz);
        if (d > r && d > 1e-6) { x = bd.x + dx * r / d; z = bd.z + dz * r / d; }
      } else {
        const hx = Math.max(0, (bd.hx ?? 3) - m), hz = Math.max(0, (bd.hz ?? 2.4) - m);
        x = Math.min(bd.x + hx, Math.max(bd.x - hx, x)); z = Math.min(bd.z + hz, Math.max(bd.z - hz, z));
      }
    }
    try { b.setHome?.(x - c.offX, z - c.offZ); } catch { /* a mock */ }
  }

  // ---- Home's things (PLACES 4.1, D-88): each shows after its event AND while the party is at least its spot's fromN ----
  function frameTall(): boolean { try { return stage.camera.aspect < 0.9; } catch { return false; } }
  function measureScale(): number {
    try {
      const L = (stage as { matLayout?: (n: number) => V3[] }).matLayout?.(2);
      if (L && L.length >= 2) { const d = Math.hypot(L[1].x - L[0].x, L[1].z - L[0].z); const unit = frameTall() ? Math.hypot(0.9, 1.3) : 1.3; if (d > 1e-6) return d / unit; }
    } catch { /* an old stage */ }
    return 1;
  }
  function arrived(k: number): boolean {
    const v = journal ? safeView() : null;
    const done = (id: string): boolean => { const q = questIdx(id); return !!v && q >= 0 && !!v.quests[q]?.done; };
    switch (k) {
      case THING_FELT: case THING_MUSIC: return true;
      case THING_RUG: return done('H5');                             // after the first hello
      case THING_LAMP: return done('H4');                            // after the first capsule (the backfill marks H4 for an older shelf)
      case THING_SHELF: return done('H8');                           // with the Home finale
      case THING_PAD: return done('C8');                             // (round 9, R9_FIX 4: with the cabin's finale, as its data says (arrives after finale:hearthlog);
                                                                     //  it was never shown: "pads ship in S2", and S2 has shipped)
      default: return false;
    }
  }
  function homeThings(): void {
    if (placeIdx !== 0 || !world) return;
    const tall = layout === 1, n = Math.max(1, wholesOut());
    for (let k = 0; k < HOME.things.length; k++) {
      const t = HOME.things[k], spot = tall ? HOME.tall.things[k] : null;
      const fromN = (spot ? spot.fromN : t.fromN) ?? 1;
      const show = arrived(k) && n >= fromN;   // (D-97: Float no longer parks Home's things: they stay where they are)
      if ((homeShown[k] === 1) === show) continue;
      homeShown[k] = show ? 1 : 0;
      try { world.setParked(k, !show); } catch (e) { report(e); }
      const x = (spot ? spot.x : t.x) * bodyScale, z = (spot ? spot.z : t.z) * bodyScale, yaw = spot ? spot.yaw : t.yaw;
      try { stage.setHomeThing?.(k, show, x, z, yaw); } catch (e) { report(e); }
    }
    // the Felt Ball's bounds: the visible table (the world shrinks it by the ball's radius, D-67)
    try { if (stage.visibleTable?.(vis)) world.setBallBounds(vis[0], vis[1], vis[2], vis[3]); } catch (e) { report(e); }
  }
  /** (re)build Home's prop world for the frame in use (on attach, a frame change, a body-size change) */
  function buildHome(): void {
    layout = frameTall() ? 1 : 0;
    bodyScale = measureScale();
    def = HOME; placeIdx = 0;
    world = buildPropWorld(HOME, layout === 1 ? 'tall' : 'wide', bodyScale);
    mapThings();
    homeShown.fill(0);
    for (let k = 0; k < HOME.things.length; k++) { try { world.setParked(k, true); } catch { /* none */ } }
    for (const c of chars) if (c.on && c.body) { try { c.body.setPropWorld?.(world); } catch (e) { report(e); } }
    try { stage.bindProps?.(world.poses, world.count, world.propThing); } catch (e) { report(e); }
    lifeSetPlace(w, 0, visit, HOME, layout, bodyScale);
    for (let i = 0; i < CAP; i++) if (chars[i].on && chars[i].kind === 0) lifeSetHome(w, i, chars[i].homeX, chars[i].homeZ);
    homeThings();
  }
  function mapThings(): void {
    const nt = def.things.length;
    steadyP = -1; steadyI = -1; steadyOnT = -1;   // (a new world: no hand holds anything in it)
    thingFirst = new Int16Array(nt).fill(-1); thingGlobal = new Int16Array(nt);
    for (let k = 0; k < nt; k++) thingGlobal[k] = THING_IDS.indexOf(def.things[k].id);
    if (world) for (let p = world.count - 1; p >= 0; p--) { const t = world.propThing[p]; if (t >= 0 && t < nt) thingFirst[t] = p; }
  }

  // ---- bubbles: 8 stage slots, one say / group bubble and one wish per character at most ----
  const slotWho = new Int8Array(8).fill(-1), slotStyle = new Int8Array(8).fill(-1), slotUntil = new Float64Array(8).fill(-1e9), slotIcon = new Uint8Array(8);
  function clearBubbles(i: number): void {
    for (let k = 0; k < 8; k++) if (slotWho[k] === i) { try { stage.clearEmote?.(k); } catch { /* ignore */ } slotWho[k] = -1; slotStyle[k] = -1; }
  }
  function showEmote(i: number, icon: number, style: number, dots: number, flags: number): void {
    const c = chars[i];
    const think = style === 1 || style === 3;
    const kindKey = think ? 1 : 0;
    let slot = -1;
    for (let k = 0; k < 8; k++) if (slotWho[k] === i && slotStyle[k] === kindKey) { slot = k; break; }
    if (icon === 0) { if (slot >= 0) { try { stage.clearEmote?.(slot); } catch { /* ignore */ } slotWho[slot] = -1; slotStyle[slot] = -1; } return; }
    const t = game.simTime;
    if (slot < 0) for (let k = 0; k < 8; k++) if (slotWho[k] < 0 || (slotStyle[k] === 0 && slotUntil[k] < t)) { slot = k; break; }
    if (slot < 0 || c.view < 0) return;
    slotWho[slot] = i; slotStyle[slot] = kindKey; slotUntil[slot] = think ? 1e12 : t + 2.0; slotIcon[slot] = icon;
    try { stage.emote?.(slot, c.view, icon, think ? 1 : style, think ? 0 : 2.0, dots, flags | (style === 3 ? 2 : 0)); } catch (e) { report(e); }
  }

  // ---- intents (the one arbiter: LIFE drives a body only by scootTo, hop and setSquash; physics pauses them under a touch) ----
  /** round 6 (N1): the player asked it to play and it has not used that thing yet (for at most ASKED_S) */
  function asked(c: Char): boolean { return game.simTime - c.askedT <= ASKED_S; }
  function applyIntent(kind: number, i: number, a: number, b: number, cc: number, d: number, e: number, icon: number, style: number, dots: number): void {
    const c = chars[i];
    if (!c.on || !c.body) return;
    const body = c.body;
    // round 5 (B7, D-61): a body the over-budget rule is putting to sleep takes no new LIFE motion until it sleeps (or the hush ends): physics' sleep() needs it still
    const motion = kind === INTENT.SCOOT || kind === INTENT.HOP || kind === HOP_GO || kind === INTENT.GLIDE || kind === INTENT.SQUASH;
    if (motion && c.hushT > game.simTime && !asked(c)) return;
    // round 5 (B7, SH-22): and over the budget nothing wakes. A motion intent for a SLEEPING body is dropped while waking it would put the awake units over
    // unitCap (+ the ride allowance); this frame's earlier wakes count. LIFE's own gate checks a start's wake, but a squishy LIFE already counts as a mover
    // keeps its token while this rule puts its body to sleep, and its next scoot or hop woke it straight back (node_checks' B7 window: 13 such wakes in 30 s
    // with 5 out, over the cap in 4 of 24 samples). A use the player asked for ("Go play with...") is never held back.
    if (motion && c.body.metrics.asleep === true && !asked(c)) {
      const wake = c.kind === 0 ? UNIT.whole - UNIT.sleeper : UNIT.piece - UNIT.sleeper;
      if (s.units + wakeClaim + wake > att.unitCap + att.allowance + 0.001) { counts.held++; return; }
      wakeClaim += wake;
    }
    switch (kind) {
      case INTENT.SCOOT:
        if (floatParked) return;
        try { if (body.scootTo?.(a - c.offX, b - c.offZ, cc)) { c.scooting = true; c.scootX = a; c.scootZ = b; counts.scoot++; } } catch (x) { report(x); }
        return;
      case INTENT.HOP:
        if (floatParked) return;
        // (R10 LOCOMOTION, D-100: the crawl IS the walking gait: a hop on the spot during LIFE's walk (its gait step hop) is not layered on it; a hop that goes
        //  somewhere (a boop, onto a pad), a hop within 15 cm of the walk's end (LIFE's step hop needs more) or after it, and every hop in Calm (no crawl) stay)
        if (a === 0 && cc === 0 && c.scooting && world !== null && !world.calm && Math.hypot(c.lastX - c.scootX, c.lastZ - c.scootZ) > 0.15) return;
        if (d < 0.999) { try { body.setSquash?.(d, 0.08); } catch (x) { report(x); } queue(HOP_GO, i, HOP_LEAD_S, a, b, cc, 0, 0, 0, 0, 0); }
        else doHop(i, a, b, cc);
        return;
      case HOP_GO: try { body.setSquash?.(1, 0.08); } catch { /* ignore */ } doHop(i, a, b, cc); return;
      case INTENT.SQUASH: if (!floatParked) { try { body.setSquash?.(a, b); } catch (x) { report(x); } } return;
      case INTENT.POSE: if (c.view >= 0) { counts.pose++; try { stage.setBodyPose?.(c.view, a, b, cc, d, e); } catch (x) { report(x); } } return;
      case INTENT.GLIDE: if (!floatParked) { nudgeV.x = a; nudgeV.y = 0; nudgeV.z = b; try { body.nudge(nudgeV); } catch (x) { report(x); } } return;
      case INTENT.SETTLE: endScoot(i); return;
      case INTENT.CANCEL:
        for (let k = 0; k < qLen; k++) if (qWho[k] === i) qKind[k] = 0;
        endScoot(i);
        try { body.setSquash?.(1, 0.12); } catch { /* ignore */ }
        return;
      case INTENT.GAZE:
        if (c.view < 0) return;
        counts.gaze++;
        try {
          if (Number.isNaN(a)) { const p = stage.camera.position; stage.setBodyGaze?.(c.view, p.x, p.y, p.z, d > 0 ? d : 1); }
          else stage.setBodyGaze?.(c.view, a, b, cc, d);
        } catch (x) { report(x); }
        return;
      case INTENT.EXPRESS: if (c.view >= 0) { try { stage.setBodyExpression?.(c.view, a, b); } catch (x) { report(x); } } return;
      case INTENT.EMOTE: counts.emote++; showEmote(i, icon, style, dots, a | 0); return;
      case INTENT.VOICE: counts.voice++; voice(i, a, b, cc, icon); return;
      case INTENT.USE: useRide(i, a | 0, b === 1); return;   // (round 7: b 1 = LIFE's own get-on, R7_LIFE's B04 RIDE)
      default: return;
    }
  }
  /** LIFE's USE intent (LIFE act.ts: a ride the player asked for; LIFE never climbs): physics lifts the body onto the swing's seat or the rocker board's
   *  end nobody is near (carryTo: y = the support's TOP, the body is set down standing there at rest; no event on the way, so never paid), and LIFE
   *  takes it from there (the snapshot's RIDE, D-74). Nothing happens on a parked or missing thing, with Float's parked world, or while held.
   *  Round 7 (R7_LIFE's request): `self` = LIFE's own get-on (B04 RIDE, intent b 1): the same lift, but NOT a ride the player set up (no `setT`), so the ride's
   *  USE is by SELF and no player quest (I7, R9, the rides) counts it. */
  function useRide(i: number, k: number, self = false): void {
    const c = chars[i], td = def.things[k], p = k >= 0 && k < thingFirst.length ? thingFirst[k] : -1;
    if (!c.on || !c.body || !world || floatParked || !td || !td.ride || p < 0 || world.isParked(p)) return;
    const P = world.poses;
    let x = P[p * 8], z = P[p * 8 + 2], y = P[p * 8 + 1];
    let steady = false;
    if (td.mech === MECH.swing) {
      // round 5: the seat may be swinging (a push, AUTO). The lift aims at the seat's REST spot (under its beam: thingSpot, pivotY - rope, as physics builds
      // it) and a steadying hand (physics' grabProp / dragProp, the hand that always wins, D-95) eases the seat there and holds it until the squishy sits on it
      // (steadyStep lets go). Round 4 aimed at the seat where it was when asked: a swinging seat had moved on by the landing, so the squishy came down beside
      // it and slid off or leaned on it from the floor. Not when the player's own hand has the seat (it is theirs): then the seat where it is now, as before.
      if (!world.isHandHeld(p) && steadyP < 0) {
        const sp = thingSpot(k), sy = (td.p.pivotY ?? 1.62) - (td.p.rope ?? 1.4);
        if (world.grabProp(p, x, y, z)) {
          steadyP = p; steadyI = i; steadyOnT = -1;
          steadyFrom[0] = x; steadyFrom[1] = y; steadyFrom[2] = z; steadyTo[0] = sp[0]; steadyTo[1] = sy; steadyTo[2] = sp[1];
          x = sp[0]; y = sy; z = sp[1]; steady = true;
        }
      }
      y += td.size[0];                                         // the seat: a capsule of radius size[0] across its travel
    } else {
      y += td.size[1];                                         // the board: half thickness size[1]; an end 60 % of the way out along its local x
      const yaw = layout === 1 ? (def.tall.things[k]?.yaw ?? td.yaw) : td.yaw, ex = Math.cos(yaw) * td.size[0] * 0.6, ez = Math.sin(yaw) * td.size[0] * 0.6;
      let near0 = 1e9, near1 = 1e9;
      for (let j = 0; j < CAP; j++) {
        if (j === i || !chars[j].on) continue;
        near0 = Math.min(near0, Math.hypot(chars[j].lastX - (x + ex), chars[j].lastZ - (z + ez)));
        near1 = Math.min(near1, Math.hypot(chars[j].lastX - (x - ex), chars[j].lastZ - (z - ez)));
      }
      const sgn = near0 >= near1 ? 1 : -1;
      x += sgn * ex; z += sgn * ez;
    }
    const d = Math.hypot(x - c.lastX, z - c.lastZ), T = Math.min(5, Math.max(0.6, 0.5 + d * 0.45));
    let ok = false;
    try { ok = c.body.carryTo?.(x - c.offX, y - c.offY, z - c.offZ, T) === true; } catch (e) { report(e); }
    if (ok) { c.scooting = false; if (!self) c.setT = game.simTime; counts.ride++; }
    if (steady) {
      if (!ok) { endSteady(); return; }
      // the seat eases to rest over most of the lift (a smoothstep of the hand's point, never a snap), then the hand holds it there; at most 2 s past the
      // lift's end the hand lets go whatever happened (steadyStep)
      steadyT0 = game.simTime; steadyEase = Math.min(0.8, Math.max(0.3, 0.45 * T)); steadyLand = game.simTime + T; steadyEnd = steadyLand + 2;
      steadyStep();
    }
  }
  /** (round 7) a squishy resting on top of a block thing at least PERCH_TOP tall for PERCH_S hops down (sense: Char.perchT) to the floor beside it, on the side
   *  toward the play area's middle, set down at rest (carryTo: no event on the way, never paid). Home's blocks are all lower. */
  const PERCH_S = 1.5, PERCH_TOP = 0.6;
  /** (round 8) the height of the top a squishy could be set on: a block's top face; a STATIC bar's (physics props.ts MECH.bar: an arch's top bar at p.height, a standing
   *  bar's top, a lying bar's top 2 r); 0 for every other thing (rides, movers, pads, water: never a perch). Round 7 lifted down from blocks only; R7_SHELL's list: a
   *  squishy set on Cloudloft's Sunbow Arch (its top bar 1.3 m up) stayed up there */
  function perchTop(td: ThingDef): number {
    if (td.ride) return 0;
    if (td.mech === MECH.block) return 2 * td.size[1];
    if (td.mech !== MECH.bar) return 0;
    const pp = td.p as { arch?: number; height?: number; standing?: number };
    return pp.arch ? (pp.height ?? td.size[2]) : pp.standing ? td.size[1] : 2 * td.size[0];
  }
  /** (round 9, R9_FIX 1) off a pad: after PAD_REST_S at rest on pad part p (longer than any family's sticky hold before a kick, 0.6 s, and a landing's squash)
   *  the squishy hops (carryTo, as perchDown: no event on the way, never paid) to the floor pad radius + its own + 0.15 m from the part's middle, toward the play
   *  area's middle, or the nearest direction (0.45 rad steps either way) whose spot is inside the bounds and clear of every pad part and of the other squishies */
  const PAD_REST_S = 1.5;
  function padOffHop(c: Char, i: number, p: number): void {
    if (!world || !c.body) return;
    const P = world.poses, px = P[p * 8], pz = P[p * 8 + 2], bd = layout === 1 ? def.tall.bounds : def.bounds, td = def.things[world.propThing[p]];
    const out = td.size[0] + c.r + 0.15, a0 = Math.atan2(bd.z - pz, bd.x - px);
    for (let k = 0; k < 9; k++) {
      const a = a0 + ((k & 1) === 1 ? 0.45 : -0.45) * Math.ceil(k / 2), tx = px + Math.cos(a) * out, tz = pz + Math.sin(a) * out;
      if (bd.shape === 'disc' ? Math.hypot(tx - bd.x, tz - bd.z) > (bd.r ?? 3) - 0.2 : Math.abs(tx - bd.x) > (bd.hx ?? 3) - 0.2 || Math.abs(tz - bd.z) > (bd.hz ?? 2.4) - 0.2) continue;
      let clear = true;
      for (let q = 0; q < world.count && clear; q++) {
        const tq = def.things[world.propThing[q]];
        if (tq?.mech === MECH.pad && !world.isParked(q) && Math.hypot(tx - P[q * 8], tz - P[q * 8 + 2]) < tq.size[0] + 0.8 * c.r) clear = false;
      }
      for (let j = 0; j < CAP && clear; j++) { const o = chars[j]; if (j !== i && o.on && o.body && Math.hypot(tx - o.lastX, tz - o.lastZ) < 0.9 * (c.r + o.r)) clear = false; }
      if (!clear) continue;
      try { c.body.carryTo?.(tx - c.offX, -c.offY, tz - c.offZ, 0.9); } catch (e) { report(e); }
      return;
    }
  }
  /** (round 9, R9_FIX 3) how far (m) a centre at (x, z) is outside the layout's bounds (<= 0 inside; the corners rounded as physics' setBounds rounds them) */
  const OUT_REST_S = 0.6, IN_MARGIN = 0.15;
  function outOfBounds(x: number, z: number): number {
    const bd = layout === 1 ? def.tall.bounds : def.bounds, dx = x - bd.x, dz = z - bd.z;
    if (bd.shape === 'disc') return Math.hypot(dx, dz) - (bd.r ?? 3);
    const hx = bd.hx ?? 3.4, hz = bd.hz ?? 2.4, rr = Math.min(bd.round ?? 0, hx, hz), ax = Math.abs(dx) - (hx - rr), az = Math.abs(dz) - (hz - rr);
    return ax > 0 && az > 0 ? Math.hypot(ax, az) - rr : Math.max(ax, az) - rr;
  }
  /** (round 9) back inside the bounds: a hop (carryTo, as perchDown) to the nearest spot IN_MARGIN inside the edge (clamped into the box less IN_MARGIN and the
   *  rounding, or along the disc's radius), set down at rest */
  function backIn(c: Char, i: number, x: number, z: number): void {
    if (!c.body) return;
    const bd = layout === 1 ? def.tall.bounds : def.bounds;
    let tx: number, tz: number;
    if (bd.shape === 'disc') { const d = Math.hypot(x - bd.x, z - bd.z) || 1, R = Math.max(0.1, (bd.r ?? 3) - IN_MARGIN); tx = bd.x + ((x - bd.x) * R) / d; tz = bd.z + ((z - bd.z) * R) / d; }
    else {
      const m = IN_MARGIN + Math.min(bd.round ?? 0, 0.4) * 0.3, ix = Math.max(0.05, (bd.hx ?? 3.4) - m), iz = Math.max(0.05, (bd.hz ?? 2.4) - m);
      tx = Math.min(bd.x + ix, Math.max(bd.x - ix, x)); tz = Math.min(bd.z + iz, Math.max(bd.z - iz, z));
    }
    void i;
    try { c.body.carryTo?.(tx - c.offX, -c.offY, tz - c.offZ, 0.7); } catch (e) { report(e); }
  }
  /** (round 9) a stuck scoot toward a spot more than 1 m away: a hop (carryTo 0.6 s, an arc over what it touches) UNSTICK_M toward it, kept inside the bounds and clear of
   *  the other squishies; LIFE's walk then goes on from there (or ends on arrival) */
  const STUCK_S = 4, UNSTICK_M = 0.6;
  function unstick(c: Char, i: number, x: number, z: number): void {
    if (!c.body) return;
    let dx = c.scootX - x, dz = c.scootZ - z;
    const dl = Math.hypot(dx, dz);
    if (!(dl > 1)) return;   // (a scoot that ends against a thing on purpose (a lean on the log, a bump into the trunk) is never lifted)
    dx /= dl; dz /= dl;
    const step = UNSTICK_M;
    // (round 10, R10_FIX 2) the lift goes straight toward the spot, or, when that spot is taken by another squishy or outside the bounds, the first of 0.6 and
    // 1.2 rad to either side that is free (a detour round what holds it): VERDICT_R9 (c) Rainleaf phone, two squishies held for 2.5 minutes in the 2.8 m wide tall
    // layout, where the straight step always met another body and round 9's unstick gave up
    let tx = NaN, tz = NaN;
    for (let q = 0; q < 5 && !(tx === tx); q++) {
      const a = q === 0 ? 0 : (q & 1 ? 1 : -1) * (q < 3 ? 0.6 : 1.2), ca = Math.cos(a), sa = Math.sin(a);
      let cx = x + (dx * ca - dz * sa) * step, cz = z + (dx * sa + dz * ca) * step;
      if (outOfBounds(cx, cz) > -IN_MARGIN) { const bd = layout === 1 ? def.tall.bounds : def.bounds; cx += (bd.x - cx) * 0.2; cz += (bd.z - cz) * 0.2; if (outOfBounds(cx, cz) > 0) continue; }
      let free = true;
      for (let j = 0; j < CAP; j++) { const o = chars[j]; if (j !== i && o.on && o.body && Math.hypot(cx - o.lastX, cz - o.lastZ) < 0.9 * (c.r + o.r)) { free = false; break; } }
      if (free) { tx = cx; tz = cz; }
    }
    if (!(tx === tx)) return;
    try { c.body.carryTo?.(tx - c.offX, -c.offY, tz - c.offZ, 0.6); } catch (e) { report(e); }
    c.scooting = false;   // (carryTo released the scoot driver; LIFE's walk re-aims it)
  }
  function perchDown(c: Char, p: number, td: ThingDef): void {
    if (!world || !c.body) return;
    const P = world.poses, bx = P[p * 8], bz = P[p * 8 + 2], bd = layout === 1 && placeIdx !== 0 ? def.tall.bounds : def.bounds;
    let dx = bd.x - bx, dz = bd.z - bz;
    // (how far out: a block's half footprint; a bar's own radius (an arch is walked under, so the floor in front of its top bar is free))
    const dl = Math.hypot(dx, dz) || 1, out = (td.mech === MECH.bar ? td.size[0] : Math.max(td.size[0], td.size[2])) + c.r + 0.15;
    dx /= dl; dz /= dl;
    try { c.body.carryTo?.(bx + dx * out - c.offX, -c.offY, bz + dz * out - c.offZ, 0.9); } catch (e) { report(e); }
  }
  // ---- (round 8) a CARRIED squishy in a place moves over the ground (game.ts asks this before the published camera-facing plane). The published pull holds the hand
  // on the camera-facing plane through the press, so a drag up the frame lifted the squishy more than it took it back: things at the back of a place (the Sand Mound,
  // the ramp's top, the tall layouts' Vane Disc and Puff Pads) were out of a straight carry's reach (R7_SHELL 5B, the phone's L4 / U2). In a place, once physics
  // carries the body, the hand's target is the pointer's ray on the LEVEL plane at the height the hand had when it picked the squishy up (so the hand does not jump),
  // kept inside the place's reach (its bounds, their front reach, + CARRY_RIM): a drag up the frame takes it back over the floor, a drag down brings it forward, a
  // flick tosses it along the ground. Home (and every pull that is not a carry) keeps the published plane: null.
  const CARRY_RIM = 0.3, CARRY_LEAD = 0.9;   // (the lead under physics' maxPull, at least 1.0 x the rest radius: its own clamp never acts on a carry in a place)
  let carryB: SoftBodyLike | null = null, carryY = 0;
  // (the seam lives in this chunk, not in the first-play download: the gesture machine asks game.host.planePoint at every move, so while the host is attached it
  //  asks carryPoint first for the squishy being carried (the pull's own body: `through` and the answer are in its space) and the published plane otherwise;
  //  dispose gives the published one back)
  const gHost = game.host as { planePoint(x: number, y: number, through: V3): V3 | null };
  const planeAt = gHost.planePoint;
  gHost.planePoint = (x: number, y: number, through: V3): V3 | null => {
    let q: V3 | null = null;
    if (placeIdx !== 0) for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (c.on && c.body && c.body.metrics.carried === true) { q = carryPoint(x, y, through, c.body, { x: c.offX, y: c.offY, z: c.offZ }); break; }
    }
    if (!q) carryB = null;   // (no carry now: the next carry takes its height afresh at its own pick-up)
    return q ?? planeAt(x, y, through);
  };
  function carryPoint(x: number, y: number, through: V3, body: SoftBodyLike, off: V3): V3 | null {
    if (placeIdx === 0 || !world || body.metrics.carried !== true) { carryB = null; return null; }
    const cam = stage.camera;
    if (!cam) return null;
    try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
    const n = pxToNdc(x, y, game.viewport), r = cameraRay(cam, n.x, n.y);
    if (carryB !== body) {
      // the first move of this carry: the hand's height now, on the published plane (through the press point, in world space)
      const h = rayPlane(r.origin, r.dir, { x: through.x + off.x, y: through.y + off.y, z: through.z + off.z }, cameraForward(cam));
      carryB = body; carryY = h ? h.y : body.center.y + off.y;
    }
    let px: number, pz: number;
    const t = r.dir.y < -1e-4 ? (carryY - r.origin.y) / r.dir.y : -1;
    if (t > 0) { px = r.origin.x + r.dir.x * t; pz = r.origin.z + r.dir.z * t; }
    else { const l = Math.hypot(r.dir.x, r.dir.z) || 1; px = r.origin.x + (r.dir.x / l) * 60; pz = r.origin.z + (r.dir.z / l) * 60; }   // (at or above the horizon: far along it, clamped below)
    const b = (layout === 1 ? def.tall : def).bounds;
    if (b.shape === 'disc') {
      const R = (b.r ?? 3) + CARRY_RIM, dx = px - b.x, dz = pz - b.z, d = Math.hypot(dx, dz);
      if (d > R) { px = b.x + (dx * R) / d; pz = b.z + (dz * R) / d; }
    } else {
      const hx = (b.hx ?? 3) + CARRY_RIM, hz = b.hz ?? 2.4, z1 = Math.max(b.z + hz, frontReach(def, layout)) + CARRY_RIM;
      px = Math.min(b.x + hx, Math.max(b.x - hx, px)); pz = Math.min(z1, Math.max(b.z - hz - CARRY_RIM, pz));
    }
    // the hand leads the body by at most CARRY_LEAD x its rest radius across the floor (every move asks again from where the body is now, so a drag reaches the
    // spot under the pointer as it goes): a target metres ahead (the level plane near the horizon) put physics' own lead clamp and follow speed limit to work,
    // which left the height unheld (measured: a 120 px drag up the frame lifted the squishy 1.2 to 1.4 m at every place)
    const cx = body.center.x + off.x, cz = body.center.z + off.z, ex = px - cx, ez = pz - cz, el = Math.hypot(ex, ez), lead = CARRY_LEAD * body.restRadius;
    if (el > lead) { px = cx + (ex * lead) / el; pz = cz + (ez * lead) / el; }
    return { x: px - off.x, y: carryY - off.y, z: pz - off.z };
  }
  // ---- the steadying hand of a "Go play with..." lift onto a swing (useRide; its state is declared with the place's, a world rebuild clears it) ----
  function endSteady(): void {
    if (steadyP < 0) return;
    const p = steadyP;
    steadyP = -1; steadyI = -1; steadyOnT = -1;
    // (the player's hand may have taken the seat meanwhile: grabAt clears steadyP first, so this never lets go of a hand that is the player's)
    try { world?.releaseProp(p); } catch { /* gone */ }
  }
  /** once a frame before the props step (act): the hand's point eases from where the seat was to its rest spot, and the hand lets go once the squishy has sat
   *  on the seat for 0.3 s after its lift, when a touch takes the squishy, or 2 s after the lift's planned end */
  function steadyStep(): void {
    if (steadyP < 0) return;
    const c = steadyI >= 0 ? chars[steadyI] : null, b = c && c.on ? c.body : null, W = world;
    if (!W || !b || W.isParked(steadyP) || !W.isHandHeld(steadyP)) { endSteady(); return; }
    const t = game.simTime, m = b.metrics;
    if (m.fingers > 0 || m.grabbed || m.carried === true || t > steadyEnd) { endSteady(); return; }
    const u0 = (t - steadyT0) / steadyEase, u = u0 <= 0 ? 0 : u0 >= 1 ? 1 : u0, sm = u * u * (3 - 2 * u);
    W.dragProp(steadyP, steadyFrom[0] + (steadyTo[0] - steadyFrom[0]) * sm, steadyFrom[1] + (steadyTo[1] - steadyFrom[1]) * sm, steadyFrom[2] + (steadyTo[2] - steadyFrom[2]) * sm);
    // (sitting: on the seat once the lift is over (carryTo sets it down at rest at its planned end): a squishy brushing the seat on its arc does not count)
    if ((m.onProp ?? -1) === steadyP && t >= steadyLand) { if (steadyOnT < 0) steadyOnT = t; else if (t - steadyOnT >= 0.3) endSteady(); }
    else steadyOnT = -1;
  }
  function doHop(i: number, vx: number, vy: number, vz: number): void {
    const c = chars[i];
    try { if (c.body?.hop?.(vx, vy, vz)) counts.hop++; } catch (x) { report(x); }
  }
  function endScoot(i: number): void {
    const c = chars[i];
    if (!c.body) return;
    if (c.scooting) { try { c.body.scootTo?.(NaN, 0, 0); } catch { /* ignore */ } }
    c.scooting = false;
    rehome(i);
  }
  /** the corral's home moves to where LIFE brought the body to rest (physics setHome), so the corral never glides it back to its spawn spot */
  function rehome(i: number): void {
    const b = chars[i].body;
    if (!b) return;
    try { b.setHome?.(b.center.x, b.center.z); } catch { /* a mock */ }
  }
  function queue(kind: number, who: number, delay: number, a: number, b: number, c: number, d: number, e: number, icon: number, style: number, dots: number): void {
    let k = -1;
    for (let j = 0; j < qLen; j++) if (qKind[j] === 0) { k = j; break; }
    if (k < 0) { if (qLen >= QCAP) return; k = qLen++; }
    qKind[k] = kind; qWho[k] = who; qDue[k] = game.simTime + Math.max(0, delay); qA[k] = a; qB[k] = b; qC[k] = c; qD[k] = d; qE[k] = e; qIcon[k] = icon; qStyle[k] = style; qDots[k] = dots;
  }
  function voice(i: number, handle: number, register: number, group: number, phrase: number): void {
    if (!audio.creature) return;
    const c = chars[i];
    const n = lifePhrase(w, handle, phraseBuf);
    if (n <= 0) return;
    const sx = s.sx[i];
    creatureP.n = n; creatureP.flavour = c.flavour; creatureP.register = register > 0 ? 1 : 0; creatureP.pitch = c.pitch * coldPitch;
    creatureP.pan = sx === sx ? Math.max(-1, Math.min(1, (sx * 2 - 1) * 0.7)) : 0;
    creatureP.level = sx === sx ? Math.max(0.4, 1 - Math.hypot(sx - 0.5, s.sy[i] - 0.5)) : 0.5;
    creatureP.group = Math.max(1, Math.min(3, group | 0)); creatureP.at = 0;
    creatureP.sing = phrase === PHRASE.SING || phrase === PHRASE.DUET;
    try { audio.creature(creatureP); } catch (x) { report(x); }
  }

  // ---- auto events and the player's touches (drain) ----
  function takeAuto(b: SoftBodyLike, e: SoftEvent): boolean {
    if (e.kind !== 'land' && e.kind !== 'bump') return false;
    const i = slotOfBody(b);
    // physics marks it (PLAYGROUND 8.8, PG_PHYS round 4: true unless the player touches the body or let go of it since it settled; a lock alone
    // never clears it, D-86); an event without the mark (an older physics, a mock) is the player's, as the published game treats every event
    const auto = e.auto === true;
    if (e.kind === 'land' && i >= 0) chars[i].tossed = false;
    if (!auto) return false;
    counts.auto++;
    // the attention budget: a soft thud at most (never a haptic, never a shake, never the meter)
    try {
      if (attentionSound(att, s) && audio.autoThud) {
        thudP.kind = e.kind === 'land' ? 0 : 1; thudP.intensity = e.intensity; thudP.pitch = i >= 0 ? chars[i].pitch : 1; thudP.pan = i >= 0 && s.sx[i] === s.sx[i] ? (s.sx[i] * 2 - 1) * 0.7 : 0;
        audio.autoThud(thudP);
      }
    } catch (x) { report(x); }
    // a BODY bump (a prop bump carries `prop` >= 0) with its partner: physics' SoftEvent.other, its contactSlot = our slot
    const other = e.other ?? -1;
    if (e.kind === 'bump' && i >= 0 && s.nBumps < 32 && (e.prop ?? -1) < 0 && other >= 0 && other < CAP && other !== i && chars[other].on) { s.bumpA[s.nBumps] = i; s.bumpB[s.nBumps] = other; s.nBumps++; }
    return true;
  }
  function noteEvent(b: SoftBodyLike, e: SoftEvent): void {
    const i = slotOfBody(b);
    if (i < 0) return;
    const c = chars[i];
    const sp = c.species;
    switch (e.kind) {
      case 'poke': c.touchKind = TOUCH.POKE; break;
      case 'release':
        c.touchKind = e.heldFor >= 1 ? TOUCH.SQUEEZE_1S : TOUCH.SQUEEZE;
        if (e.heldFor >= 0.4) write(EV.TOUCH, TOUCH.SQUEEZE, -1, sp, 255, 1, BY.PLAYER, e.heldFor);
        if (firstReleaseT < 0 && b === bodies.body) firstReleaseT = game.simTime;
        break;
      case 'snap': {
        const lvl = e.intensity;
        if (c.wasCarried) { c.touchKind = lvl >= 0.99 ? TOUCH.TOSS_HARD : TOUCH.TOSS; c.tossed = true; }
        else c.touchKind = lvl >= 0.6 ? TOUCH.STRETCH_06 : TOUCH.STRETCH;
        write(EV.TOUCH, TOUCH.STRETCH, -1, sp, 255, 1, BY.PLAYER, lvl);
        if (firstReleaseT < 0 && b === bodies.body) firstReleaseT = game.simTime;
        break;
      }
      case 'land': c.tossed = false; break;
      default: break;
    }
  }

  // ---- the snapshot (filled IN PLACE) ----
  function quietNow(): boolean {
    return sheets !== 0 || travelling || game.tool !== 'hand' || game.cut.busy || game.ceremonies.active || game.ceremonies.pending || !game.input.live || game.hidden;
  }
  function fillSnapshot(dt: number): void {
    const t = game.simTime;
    let n = 0;
    for (let i = 0; i < CAP; i++) if (chars[i].on) n = i + 1;
    s.n = n; s.t = t; s.place = placeIdx;
    let tier = 1;
    try { tier = TIER_IDX[stage.stats().tier] ?? 1; } catch { tier = 1; }
    s.tier = tier;
    s.phone = deps.phone?.() ?? false;
    s.calm = game.settings.calm; s.reducedMotion = deps.reducedMotion?.() ?? false;
    if (world) world.calm = s.calm || s.reducedMotion;   // (R10 LOCOMOTION, D-100: Calm or reduced motion: no crawl, LIFE's walk is today's glide)
    s.autonomy = game.settings.autonomy && !floatParked;
    s.quiet = quietNow();
    s.musicField = 0; s.musicOn = game.settings.music > 0.001; s.musicBoxOn = musicBoxOnUntil > t; s.beatPhase = (t * 66 / 60) % 1;
    const vw = Math.max(1, game.viewport.w), vh = Math.max(1, game.viewport.h);
    let units = 0, touching = false;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body) { s.flags[i] = 0; s.touchKind[i] = -1; continue; }
      const b = c.body, m = b.metrics, ce = b.center;
      const x = ce.x + c.offX, z = ce.z + c.offZ;
      if (dt > 0) { c.vx = (x - c.lastX) / dt; c.vz = (z - c.lastZ) / dt; }
      c.lastX = x; c.lastZ = z;
      s.kind[i] = c.kind; s.group[i] = c.group; s.species[i] = c.species; s.family[i] = c.family; s.frac[i] = c.frac; s.r[i] = c.r;
      s.x[i] = x; s.y[i] = ce.y + c.offY; s.z[i] = z; s.vx[i] = c.vx; s.vz[i] = c.vz;
      if (c.view >= 0 && stage.bodyScreenPoint?.(c.view, scr)) { s.sx[i] = scr[0] / vw; s.sy[i] = scr[1] / vh; } else { s.sx[i] = NaN; s.sy[i] = NaN; }
      const carried = m.carried === true;
      // a carry let go: a toss until it lands (and a ride it lands on is one the player set up). (round 8) One let go while it already rests ON something (a ride's
      // top, the floor: the carry over the ground sets a squishy down there) never "lands" (no fall, no land event) and stayed a toss: R8's phone run set a squishy at
      // the Glide Ramp's top twice and the second (picked up from the ramp and set back) was no USE. Supported at the let go = set down, not tossed.
      if (c.wasCarried && !carried) { c.tossed = !((m.onProp ?? -1) >= 0 || m.grounded === true); c.setT = t; }
      if (!c.wasCarried && carried) c.touchKind = TOUCH.CARRY;
      c.wasCarried = carried;
      let f = 0;
      if (m.fingers > 0 || m.grabbed) f |= LIFE_FLAG.TOUCHED;
      if (carried) f |= LIFE_FLAG.CARRIED;
      if ((m.locked ?? 0) > 0) f |= LIFE_FLAG.LOCKED;
      const asleep = m.asleep === true;
      if (asleep) f |= LIFE_FLAG.ASLEEP;
      if (m.grounded) f |= LIFE_FLAG.GROUNDED;
      const onProp = m.onProp ?? -1;
      if (onProp >= 0) f |= LIFE_FLAG.ON_PROP;
      if (m.airborne === true || (!m.grounded && onProp < 0)) f |= LIFE_FLAG.AIRBORNE;
      // (round 8) a toss that never lands is no toss: a squishy let go while it already rested on something (the carry over the ground sets one down there) gets no
      // land event, and the carry's snap event can come a frame after the let go and mark it tossed again; resting = supported and nearly still across the floor.
      // R8's final run: the second squishy set on the Sand Mound's top (on target) stayed "tossed" and its ride (R9) was never the player's
      if (c.tossed && !carried && (onProp >= 0 || m.grounded === true) && c.vx * c.vx + c.vz * c.vz < 0.09) c.tossed = false;
      if (c.tossed) f |= LIFE_FLAG.TOSSED;
      if (s.sx[i] === s.sx[i]) f |= LIFE_FLAG.VISIBLE;
      if (m.memoryBusy === true) f |= LIFE_FLAG.MEMORY_BUSY;
      if ((m.submerged ?? 0) > 0) f |= LIFE_FLAG.IN_WATER;   // (S2: physics' water share; LIFE's float table reads its own zones first)
      // RIDE (D-74): a body the player set down on a ride prop stays on it 20 s
      if (onProp >= 0 && world && c.tossed === false && (f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) === 0) {
        const th = onProp < world.count ? world.propThing[onProp] : -1;
        if (th >= 0 && def.things[th]?.ride && c.rideUntil < t - 25) {
          c.rideUntil = t + 20;
          // QUESTS 4: "the shell [gives USE] for rides the player set up" (I7 "Set a squishy at the top of the ramp", R9 the Sand Mound): the ride's verb, by PLAYER
          if (t - c.setT < SET_S) write(EV.USE, def.things[th].verb, thingGlobal[th], c.species, 255, 1, BY.PLAYER, 0);
        }
      }
      if ((f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) c.rideUntil = -1e9;
      if (c.rideUntil > t) f |= LIFE_FLAG.RIDE;
      // (round 7) a squishy set down on top of a TALL block (Lanternroof's Chimney Corner, 1.4 m; the cabin's hearth, 0.9 m) hops down beside it after PERCH_S:
      // up there it stood above the place camera's frame (s3run2's phone shot: on the chimney, half out of the top edge, behind the HUD's buttons)
      if (dt > 0 && onProp >= 0 && world && onProp < world.count && !c.tossed && (f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) === 0) {
        const th = world.propThing[onProp], td = th >= 0 ? def.things[th] : null, top = td ? perchTop(td) : 0;
        // (ON its top: the centre above the thing's top; one leaning on its side, as at the chimney's warm nap foot, or standing under the arch, stays where it is)
        if (td && top >= PERCH_TOP && ce.y + c.offY > top) { c.perchT += dt; if (c.perchT >= PERCH_S) { c.perchT = 0; perchDown(c, onProp, td); } } else c.perchT = 0;
      } else c.perchT = 0;
      // (round 9, R9_FIX 1) a squishy at REST on a pad in a place (its run of kicks over, or a foot on the rim) hops off after PAD_REST_S to the floor beside the pad
      // (padOffHop). R8's phone U2 traced on the real physics with this host (R9_FIX.md 1): the first drop's Dollop bounced five times, came to rest on the front
      // Puff Pad and STAYED there, and the next two squishies dropped on the pad landed on its head (1 of 3 bounces); a body left on a pad's rim stayed pinned
      // there for the visit (R7_LIFE). Home's Bounce Pad is unchanged (its party row stands in front of it)
      if (dt > 0 && placeIdx !== 0 && onProp >= 0 && world && onProp < world.count && (f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.AIRBORNE)) === 0
        && c.vx * c.vx + c.vz * c.vz < 0.09 && def.things[world.propThing[onProp]]?.mech === MECH.pad) {
        c.padRestT += dt;
        if (c.padRestT >= PAD_REST_S) { c.padRestT = 0; padOffHop(c, i, onProp); }
      } else c.padRestT = 0;
      // (round 9, R9_FIX 3) a squishy that comes to REST outside the place's bounds (a hard toss toward an open side) hops back in after OUT_REST_S (backIn). The
      // bounds corral glides a body back from the edge slowly (about 3 cm/s 0.13 m out) and stops while it sleeps: R8's phone toss at Cloudloft rested 0.12 m past the
      // tall bounds' side and was still there 6 s later (traced on the real physics with this host: asleep at once, the glide 0.12 m in 3.5 s once woken)
      if (dt > 0 && placeIdx !== 0 && onProp < 0 && (f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.AIRBORNE | LIFE_FLAG.LOCKED | LIFE_FLAG.RIDE)) === 0
        && c.vx * c.vx + c.vz * c.vz < 0.09 && outOfBounds(x, z) > 0.02) {
        c.outT += dt;
        if (c.outT >= OUT_REST_S) { c.outT = 0; backIn(c, i, x, z); }
      } else c.outT = 0;
      // (round 9, R9_FIX 2) a LIFE scoot that makes no headway (3 cm in STUCK_S) in a place is lifted past what holds it (unstick): R9's traces had a putty held
      // against the Sunbow Arch's post for 100 s and more, its every walk, bask and wander going nowhere (a static prop it touches blocks its glide)
      if (dt > 0 && placeIdx !== 0 && c.scooting && (f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.AIRBORNE | LIFE_FLAG.LOCKED | LIFE_FLAG.RIDE | LIFE_FLAG.ASLEEP)) === 0) {
        if (Math.hypot(x - c.stuckX, z - c.stuckZ) > 0.03) { c.stuckX = x; c.stuckZ = z; c.stuckT = t; }
        else if (t - c.stuckT > STUCK_S) { c.stuckT = t; unstick(c, i, x, z); }
      } else { c.stuckX = x; c.stuckZ = z; c.stuckT = t; }
      s.flags[i] = f;
      if ((f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) touching = true;
      s.touchKind[i] = c.touchKind; c.touchKind = -1;
      zonesAt(i, x, z);
      s.submerged[i] = m.submerged ?? 0;
      s.warmth[i] = 0;
      units += asleep ? UNIT.sleeper : c.kind === 0 ? UNIT.whole : UNIT.piece;   // (LIFE's own weights, PF-00: PG_LIFE round 4's request)
      if (asleep !== c.asleepShown && c.view >= 0) { c.asleepShown = asleep; try { stage.setBodyAsleep?.(c.view, asleep); } catch { /* ignore */ } }
      // a scoot that has arrived: release the driver and re-home the corral there (setHome)
      if (c.scooting && Math.hypot(x - c.scootX, z - c.scootZ) < 0.05 && Math.hypot(c.vx, c.vz) < 0.02) endScoot(i);
    }
    // a touching pair of awake bodies adds UNIT.pair (LIFE 10.3): physics' metrics.contacts, a bit per contactSlot (= our slot), published at each step
    for (let i = 0; i < CAP; i++) for (let j = i + 1; j < CAP; j++) {
      const a = chars[i], b = chars[j];
      if (!a.on || !b.on || !a.body || !b.body || (s.flags[i] & LIFE_FLAG.ASLEEP) || (s.flags[j] & LIFE_FLAG.ASLEEP)) continue;
      const ca = a.body.metrics.contacts ?? 0, cb = b.body.metrics.contacts ?? 0;
      if (((ca >>> j) & 1) !== 0 || ((cb >>> i) & 1) !== 0) units += UNIT.pair;
    }
    s.units = units;
    if (touching !== touchingNow) { touchingNow = touching; try { audio.setTouching?.(touching); } catch { /* ignore */ } }
    // the things out now
    let nt = 0;
    if (world && !floatParked) for (let k = 0; k < def.things.length && nt < 32; k++) {
      if (placeIdx === 0 && homeShown[k] !== 1) continue;
      const p = thingFirst[k], td = def.things[k];
      s.thingId[nt] = thingGlobal[k];
      if (p >= 0) { s.thingX[nt] = world.poses[p * 8]; s.thingZ[nt] = world.poses[p * 8 + 2]; s.thingState[nt] = world.poses[p * 8 + 7]; }
      else { const sp = thingSpot(k); s.thingX[nt] = sp[0]; s.thingZ[nt] = sp[1]; s.thingState[nt] = 0; }
      s.thingBusy[nt] = 0;
      void td;
      nt++;
    }
    s.nThings = nt;
  }
  const spotOut = new Float64Array(2);
  function thingSpot(k: number): Float64Array {
    const t = def.things[k], spot = layout === 1 ? def.tall.things[k] : null, sc = def.unit === 'slot' ? bodyScale : 1;
    spotOut[0] = (spot ? spot.x : t.x) * sc; spotOut[1] = (spot ? spot.z : t.z) * sc;
    return spotOut;
  }
  /** zones and the ground patch at a character's centre, in the layout in use (the place's own geometry) */
  function zonesAt(i: number, x: number, z: number): void {
    let mask = 0, zt = -1, best = 0, pt = -1;
    const sc = def.unit === 'slot' ? bodyScale : 1;
    const zones = def.zones;
    for (let k = 0; k < zones.length; k++) {
      const zd = zones[k], a = layout === 1 ? def.tall.zones[k] ?? zd : zd;
      if (zd.switchable && world && world.zoneOn[k] === 0) continue;
      if (zd.shower && !showerPhaseOn(zd.shower)) continue;   // a shower envelope (Rainleaf's rain: 40 s on, 30 s off from the arrival, sim time)
      const dx = x - a.x * sc, dz = z - a.z * sc;
      const inside = a.shape === 'disc' ? dx * dx + dz * dz <= ((a.r ?? 0) * sc) ** 2 : Math.abs(dx) <= (a.hx ?? 0) * sc && Math.abs(dz) <= (a.hz ?? 0) * sc;
      if (!inside) continue;
      mask |= 1 << zd.kind;
      if (zd.strength > best) { best = zd.strength; zt = ownerOf(zd.id, 'zone'); }
    }
    const pats = def.patches;
    for (let k = 0; k < pats.length; k++) {
      const pd = pats[k], a = layout === 1 ? def.tall.patches[k] ?? pd : pd;
      const dx = x - a.x * sc, dz = z - a.z * sc;
      const inside = a.shape === 'disc' ? dx * dx + dz * dz <= ((a.r ?? 0) * sc) ** 2 : Math.abs(dx) <= (a.hx ?? 0) * sc && Math.abs(dz) <= (a.hz ?? 0) * sc;
      if (inside) { pt = ownerOf(pd.id, 'patch'); break; }
    }
    s.zoneMask[i] = mask; s.zoneThing[i] = zt; s.patchThing[i] = pt;
  }
  function ownerOf(id: string, field: 'zone' | 'patch'): number {
    const ts = def.things;
    for (let k = 0; k < ts.length; k++) if ((ts[k] as ThingDef)[field] === id) return thingGlobal[k] ?? -1;
    return -1;
  }

  // ---- LIFE's events -> the ring (QUESTS 4; PG_LIFE / PG_QUESTS conventions) ----
  function pumpEvents(): void {
    for (let k = 0; k < ev.n; k++) {
      const kind = ev.kind[k], sub = ev.sub[k], ea = ev.a[k], eb = ev.b[k], n2 = ev.n2[k], thing = ev.thing[k];
      const a = ea < CAP && chars[ea].on ? chars[ea].species : 255, b = eb < CAP && chars[eb].on ? chars[eb].species : 255;
      const piece = ea < CAP && chars[ea].on && chars[ea].kind !== 0 ? EV_FLAG.PIECE : 0;
      switch (kind) {
        case LIFE_EV.SOCIAL:
          if (thing === -2) write(EV.SOCIAL, sub, -1, a, b, n2, BY.SELF, -1, piece);   // the friend wish's grant greet: no points
          else write(EV.SOCIAL, sub, thing, a, b, n2, BY.SELF, 0, piece);
          if (placeIdx === 0) homeThingsSoon = true;   // the first hello brings the rug
          break;
        case LIFE_EV.USE:
          write(EV.USE, sub, thing, a, 255, n2, eb === 254 ? BY.PLAYER : BY.SELF, 0, piece); if (eb === 254) { counts.askedUse++; if (ea < CAP) chars[ea].askedT = -1e9; }   // (round 6: it used the thing it was asked to: no longer ASKED)
          if (sub === USE_VERB.NAP && placeIdx !== 0) chimneyBreath(thing);   // (round 7: a nap at the Chimney Corner's warm foot: the chimney breathes deeper)
          break;
        case LIFE_EV.REACT: write(EV.REACT, sub, thing, a, 255, n2, BY.SELF, 0, piece); break;
        case LIFE_EV.PIECES: write(EV.PIECES, sub, thing, a, 255, n2, BY.SELF, 0, EV_FLAG.PIECE); break;
        case LIFE_EV.SIGNATURE: write(EV.SIGNATURE, sub, thing, a, 255, n2, BY.SELF, 0, piece); break;
        case LIFE_EV.DISCOVER: write(EV.DISCOVER, sub, thing, a, 255, n2, BY.SELF, 0, piece); break;
        // round 6 (R6_DATA 3, LIFE 6.1 S14): the squirt game's arc. Not a ring record (the quest counts the SOCIAL SQUIRT LIFE emits beside it, above): a short
        // squirt sound at the squirter and the drops handed to the render (sub = the drop count, 4 with Calm or reduced motion; b = the target slot, 255 nobody)
        case LIFE_EV.SQUIRT: squirt(ea, eb, sub); break;
        case LIFE_EV.WISH:
          if (sub === WISH_STATE.SHOWN) {
            let wk = 0, target = thing;
            if (ea < CAP && lifeWishOf(w, ea, wishOut)) { wk = wishOut[0]; target = wishOut[1]; wishKindOf[ea] = wk; wishTargetOf[ea] = target; }
            if (eb === 254 && n2 === 0) { wk = WISH_KIND.PLACE; target = 1; }   // FIRST_WISH resting at the 5:00 backstop
            write(EV.WISH, WISH_STATE.SHOWN, target, eb === 254 && n2 === 0 && ea >= CAP ? 255 : a, 255, n2, BY.SELF, wk);
          } else if (sub === WISH_STATE.GRANTED && ea < CAP) {
            const wk = wishKindOf[ea];
            write(EV.WISH, WISH_STATE.GRANTED, wishTargetOf[ea], a, 255, 1, wk === WISH_KIND.FRIEND || wk === WISH_KIND.PLACE || wk === WISH_KIND.RIDE || wk === WISH_KIND.TOUCH ? BY.PLAYER : BY.SELF, wk);
            wishKindOf[ea] = 0; wishTargetOf[ea] = -1;
          }
          break;
        default: break;
      }
    }
  }
  let homeThingsSoon = false;

  // ---- round 6: what the S2 places need from the host (Ripple Shore, Frostbell Ridge, Rainleaf Garden) ----
  /** the squirt (LIFE_EV.SQUIRT, R6_DATA 3): a short, quiet splash at the squirter and its drops along an arc to the target (the render's squirtFx, R6_RENDER;
   *  absent in an older stage: the sound alone). The target's wet look and its wow are LIFE's; the quest counts the SOCIAL SQUIRT. */
  const squirtP = { kind: PROP_SOUND.splash, intensity: 0.3, note: 0, pan: 0, auto: false, size: 0.12 };
  function squirt(i: number, j: number, drops: number): void {
    if (i < 0 || i >= CAP || !chars[i].on) return;
    const c = chars[i];
    counts.squirt++;
    const sx = s.sx[i];
    if (audio.prop) { squirtP.pan = sx === sx ? Math.max(-1, Math.min(1, (sx * 2 - 1) * 0.7)) : 0; try { audio.prop(squirtP); } catch (x) { report(x); } }
    const fx = (stage as { squirtFx?: (from: number, to: number, drops: number, dirX?: number, dirZ?: number) => boolean }).squirtFx;
    if (!fx || c.view < 0) return;
    const to = j >= 0 && j < CAP && chars[j].on && chars[j].view >= 0 ? chars[j].view : 255;
    // (no target: ahead along its facing, which is toward the player: the camera's side of the floor)
    let dx = 0, dz = 1;
    try { const p = stage.camera.position, ax = p.x - c.lastX, az = p.z - c.lastZ, l = Math.hypot(ax, az); if (l > 1e-6) { dx = ax / l; dz = az / l; } } catch { /* a mock camera */ }
    try { fx.call(stage, c.view, to, drops, dx, dz); } catch (x) { report(x); }
  }
  /** a soaking or drying foam's density (R6_PHYS 2.1, SoftBodyLike.mods[4] served as PropWorld.mods(body)): its family's dry density lerped to its soaked density
   *  by LIFE's soak look, at 10 Hz, only for the families whose two densities differ (slow rise, marshmallow): a soaked slow rise sinks in the Steam Pool, a
   *  drying one floats up again. Not at Home (no water there; Home stays bit for bit). */
  let modsT = 0;
  function modsStep(): void {
    if (!world || placeIdx === 0 || floatParked || game.simTime - modsT < 0.1) return;
    modsT = game.simTime;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body) continue;
      const fr = (FAMILY_REACT as Readonly<Record<string, { density: number; soakedDensity: number } | undefined>>)[MATERIAL_FAMILY_IDS[c.family] ?? ''];
      if (!fr || !(fr.soakedDensity !== fr.density)) continue;
      const m = world.mods(c.body);
      if (!m) continue;
      lifeLooks(w, i, looks);
      const rho = fr.density + (fr.soakedDensity - fr.density) * Math.min(1, Math.max(0, looks[LOOK.soak]));
      if (Math.abs(m[4] - rho) > 0.004) m[4] = rho;
    }
  }
  /** the weather of the place (R6_PHYS 2.2 / 2.3, PG_AUDIO round 2): each wind zone's gust follows LIFE's gust clock (lifeGustOn: the push, LIFE's HOLD_ON and the
   *  gust sound agree), and the bed hears each weather event as it starts: a gust (its strength), a wave on a surf edge, a shower envelope turning on or off */
  const gustOn = new Uint8Array(16), waveHi = new Uint8Array(16), showerWas = new Int8Array(16);
  const ambP = { weather: 0 };
  function weatherStep(): void {
    if (!world || placeIdx === 0 || travelling) return;
    const zones = def.zones, n = Math.min(16, zones.length, world.zoneCount);
    for (let k = 0; k < n; k++) {
      const zd = zones[k];
      let ev = -1;
      if (zd.kind === ZONE.wind && zd.gust) {
        const on = lifeGustOn(w, k);
        try { world.setGust(k, on); } catch (x) { report(x); }
        if (on && !gustOn[k]) ev = zd.strength;
        gustOn[k] = on ? 1 : 0;
      } else if (zd.wave) {
        const lv = world.waveLevel(k), hi = lv > 0.15 ? 1 : lv < 0.05 ? 0 : waveHi[k];
        if (hi && !waveHi[k]) ev = 0.8;
        waveHi[k] = hi;
      } else if (zd.shower) {
        const on = showerPhaseOn(zd.shower) ? 1 : 0;
        if (showerWas[k] !== on) ev = on;
        showerWas[k] = on;
      }
      if (ev >= 0 && audio.setAmbience) { ambP.weather = ev; try { audio.setAmbience(ambP); } catch (x) { report(x); } }
    }
    windLook();
  }

  // ---- round 7: what Lanternroof and Cloudloft need from the host (R6_RENDER requests 3 to 5, R6_PHYS 2.3; PLACES 4.8, 4.10) ----
  /** the wind's level to the look, once a frame: the strongest gust of the place's gusting wind zones (world.gustLevel: physics' push, eased in and out over
   *  0.3 s, on LIFE's clock through setGust above), so the look's sway and streaks follow the push the squishies feel: Lanternroof's lanterns sway, its gust
   *  streaks drift and its Vane Disc turns (thingFx(-1, 3, level)); a look without wind ignores it. Sent when it changes (zero allocation). */
  let windWas = -1;
  function windLook(): void {
    if (!world) return;
    let lv = 0;
    const n = Math.min(def.zones.length, world.zoneCount);
    for (let k = 0; k < n; k++) { const zd = def.zones[k]; if (zd.kind === ZONE.wind && zd.gust) { const g = world.gustLevel(k); if (g > lv) lv = g; } }
    if (Math.abs(lv - windWas) < 0.004 && !(lv === 0 && windWas !== 0)) return;
    windWas = lv;
    try { stage.thingFx?.(-1, 3, lv); } catch { /* a look without wind */ }
  }
  /** Lanternroof's Vane Disc (PLACES 4.8: "a flush wind rose: the breeze turns it; a squishy on it rides round"). Physics builds no turntable for it (D-96: wind and
   *  the updraft are the only new physics; R6_PHYS 2.3), so the host keeps its turn: the gust of the wind zone it stands in (the look turns the painted rose by the
   *  same level, thingFx(-1, 3)) and a player's poke (a tap on the disc: thingFx(k, 1, 1), the look's spin for VANE_POKE_S). Whoever stands on it while it turns
   *  rides it: one USE SPIN each turn (L4 "Ride the Vane Disc"; by the PLAYER when the player set it there or poked the disc), and its eyes follow the turn. */
  const VANE_GUST = 0.35, VANE_POKE_S = 3, VANE_W = 1.4;   // a gust turns it from this level; a poke spins it this long; rad/s at full gust (the look's own speed)
  let vaneK = -1, vaneZone = -1, vanePokeT = -1e9, vaneA = 0, vaneTurning = false;
  let cometEnd = -1e9, cometDur = 6;   // (the Star Scope's comet flies until this sim time, for this long: tapThing, cometGaze)
  /** while the Star Scope's comet flies, every squishy on screen follows it with its eyes; after it, each one's eyes are its own again (LIFE's next gaze).
   *  The look flies its head along COMET_NDC (frame coordinates, per layout) at COMET_D metres from the camera (render/places/lanternroof.ts COMET_PATH and
   *  COMET_DEPTH, the same numbers: the comet is set in view space so every framing shows it); the eyes look at that point in the world. Zero allocation. */
  const COMET_NDC = [[-0.42, 0.86, 0.36, 0.74], [-0.85, 0.95, 0.0, 0.88]] as const, COMET_D = 60;
  let cometGazing = false;
  function cometGaze(): void {
    const t = game.simTime, on = t < cometEnd;
    if (!on && !cometGazing) return;
    const u = Math.min(1, Math.max(0, 1 - (cometEnd - t) / cometDur)), P = COMET_NDC[layout === 1 ? 1 : 0];
    let gx = 0, gy = 6, gz = -60;   // (a mock camera without matrices: high in the back)
    if (on) {
      // (the head's frame point at COMET_D metres in view space, then into the world: the camera's projection and world matrices)
      try {
        const cam = stage.camera, pe = cam.projectionMatrix.elements, me = cam.matrixWorld.elements;
        const xv = (P[0] + (P[2] - P[0]) * u + pe[8]) * COMET_D / pe[0], yv = (P[1] + (P[3] - P[1]) * u + pe[9]) * COMET_D / pe[5], zv = -COMET_D;
        const wx = me[0] * xv + me[4] * yv + me[8] * zv + me[12], wy = me[1] * xv + me[5] * yv + me[9] * zv + me[13], wz = me[2] * xv + me[6] * yv + me[10] * zv + me[14];
        if (Number.isFinite(wx + wy + wz)) { gx = wx; gy = wy; gz = wz; }
      } catch { /* a mock camera */ }
    }
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || c.view < 0 || c.kind === 2) continue;
      try {
        if (on && (s.flags[i] & LIFE_FLAG.VISIBLE) !== 0 && (s.flags[i] & LIFE_FLAG.ASLEEP) === 0) stage.setBodyGaze?.(c.view, gx, gy, gz, 1);
        else if (!on) stage.setBodyGaze?.(c.view, 0, 0, 0, 0);
      } catch { /* ignore */ }
    }
    cometGazing = on;
  }
  const vaneRode = new Uint8Array(CAP);
  /** (round 8) Rainleaf's Drip Leaf: its big leaf as render/places/rainleaf.ts draws it (the stalk 2 x size[1] tall at the thing's spot; the leaf from the stalk's top
   *  toward its drip zone, dLen + 0.35 m long and 0.95 m wide, tipped 0.32 rad down toward its tip), in the layout in use. -1: none here. Set with the vane (vaneSetup). */
  let leafK = -1;
  const LEAF_TIP = 0.32;
  function leafTap(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (leafK < 0) return -1;
    const td = def.things[leafK], zi = td.zone ? def.zones.findIndex((z) => z.id === td.zone) : -1;
    const za = zi >= 0 ? (layout === 1 ? def.tall.zones[zi] ?? def.zones[zi] : def.zones[zi]) : null;
    if (!za) return -1;
    const sp = thingSpot(leafK), sx = sp[0], sz = sp[1], H = 2 * td.size[1] - 0.02;
    let ux = za.x - sx, uz = za.z - sz;
    const dl = Math.hypot(ux, uz);
    if (dl > 1e-6) { ux /= dl; uz /= dl; } else { ux = 1; uz = 0; }
    const L = Math.max(0.3, dl) + 0.35, W = 0.95, c = Math.cos(LEAF_TIP), sn = Math.sin(LEAF_TIP);
    // the leaf: S + a A + b B (a in 0..1, b in -0.5..0.5), A = (ux c, -sn, uz c) L along it, B = (-uz, 0, ux) W across it (A and B are at right angles)
    const ax = ux * c * L, ay = -sn * L, az = uz * c * L, bx = -uz * W, bz = ux * W;
    const nx = ay * bz, ny = az * bx - ax * bz, nz = -ay * bx;   // A x B (B has no y)
    const den = dx * nx + dy * ny + dz * nz;
    if (Math.abs(den) < 1e-9) return -1;
    const t = ((sx - ox) * nx + (H - oy) * ny + (sz - oz) * nz) / den;
    if (!(t > 0)) return -1;
    const qx = ox + dx * t - sx, qy = oy + dy * t - H, qz = oz + dz * t - sz;
    const a = (qx * ax + qy * ay + qz * az) / (L * L), b = (qx * bx + qz * bz) / (W * W);
    return a >= -0.05 && a <= 1.05 && b >= -0.55 && b <= 0.55 ? t : -1;
  }
  /** (round 9, R9_FIX 3) Frostbell's Shake Pine: its snowy crown as render/places/frostbell.ts draws it (three cones from 1.25 m to 2.65 m, radius 0.5 down to 0.28,
   *  over the trunk's spot) has no prop (the trunk and the low branch are its props): a press that reaches the crown before any prop taps the pine. The crown stands
   *  above every squishy, so a party in front of the trunk no longer hides the whole tree (R8's phone run: the trunk behind the squishy set under the branch, the
   *  branch at the frame's edge: "tap": "body"). Approximated by the cone of the tiers' outline: radius 0.5 at 1.25 m to 0.2 at 2.65 m. -1: none here. */
  let crownK = -1;
  function crownTap(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (crownK < 0) return -1;
    const sp = thingSpot(crownK), cx = sp[0], cz = sp[1], y0 = 1.25, y1 = 2.65, r0 = 0.5, r1 = 0.2;
    // march the ray through the crown's height band (24 steps): the first point inside the cone's radius at its height
    const ta = Math.abs(dy) > 1e-9 ? (y0 - oy) / dy : -1, tb = Math.abs(dy) > 1e-9 ? (y1 - oy) / dy : -1;
    let t0 = Math.min(ta, tb), t1 = Math.max(ta, tb);
    if (!(t1 > 0)) return -1;
    if (t0 < 0) t0 = 0;
    for (let k = 0; k <= 24; k++) {
      const t = t0 + ((t1 - t0) * k) / 24, y = oy + dy * t, r = r0 + ((r1 - r0) * (y - y0)) / (y1 - y0), ex = ox + dx * t - cx, ez = oz + dz * t - cz;
      if (ex * ex + ez * ez <= r * r) return t;
    }
    return -1;
  }
  function vaneSetup(): void {
    crownK = placeIdx === 0 ? -1 : def.things.findIndex((t) => isPine(t) && t.look === 'pine');
    leafK = placeIdx === 0 ? -1 : def.things.findIndex((t) => t.look === 'dripleaf' && t.switch === 'shower');
    vaneK = -1; vaneZone = -1; vanePokeT = -1e9; vaneTurning = false; vaneRode.fill(0);
    for (let k = 0; k < def.things.length; k++) if (def.things[k].mech === MECH.turntable && thingFirst[k] < 0) { vaneK = k; break; }
    if (vaneK < 0) return;
    const sp = thingSpot(vaneK), x = sp[0], z = sp[1];
    for (let k = 0; k < def.zones.length; k++) {
      const zd = def.zones[k], a = layout === 1 ? def.tall.zones[k] ?? zd : zd;
      if (zd.kind !== ZONE.wind) continue;
      const dx = x - a.x, dz = z - a.z;
      if (a.shape === 'disc' ? dx * dx + dz * dz <= (a.r ?? 0) ** 2 : Math.abs(dx) <= (a.hx ?? 0) && Math.abs(dz) <= (a.hz ?? 0)) { vaneZone = k; break; }
    }
  }
  function vaneStep(dt: number): void {
    if (vaneK < 0 || !world || floatParked || travelling) return;
    const t = game.simTime, poked = t - vanePokeT < VANE_POKE_S;
    const lv = vaneZone >= 0 && vaneZone < world.zoneCount ? world.gustLevel(vaneZone) : 0;
    const turning = poked || lv >= VANE_GUST;
    const om = poked ? Math.max(VANE_W, lv * VANE_W) : lv * VANE_W;
    vaneA += om * dt;
    if (!turning && vaneTurning) {
      // the turn ended: each rider's eyes are its own again (LIFE's next gaze takes over)
      for (let i = 0; i < CAP; i++) if (vaneRode[i] && chars[i].on && chars[i].view >= 0) { try { stage.setBodyGaze?.(chars[i].view, 0, 0, 0, 0); } catch { /* ignore */ } }
      vaneRode.fill(0);
    }
    vaneTurning = turning;
    if (!turning) return;
    const sp = thingSpot(vaneK), r = def.things[vaneK].size[0];
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body) continue;
      const on = Math.hypot(c.lastX - sp[0], c.lastZ - sp[1]) <= r && (s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.AIRBORNE)) === 0;
      if (!on) continue;
      if (!vaneRode[i]) {
        vaneRode[i] = 1;
        write(EV.USE, def.things[vaneK].verb, thingGlobal[vaneK], c.species, 255, 1, poked || t - c.setT < SET_S ? BY.PLAYER : BY.SELF, 0, c.kind !== 0 ? EV_FLAG.PIECE : 0);
      }
      // (its eyes go round with the disc: a point 2 m out turning with the rose, a little above the floor)
      if (c.view >= 0) { try { stage.setBodyGaze?.(c.view, c.lastX + Math.cos(vaneA) * 2, 0.6, c.lastZ + Math.sin(vaneA) * 2, 1); } catch { /* ignore */ } }
    }
  }
  /** a tap on the Vane Disc: it has no prop for the ray, so the press is tested against its painted disc on the floor (after the props missed or hit farther) */
  function vaneTap(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tProp: number): number {
    if (vaneK < 0 || !(dy < -1e-4)) return -1;
    const tf = (0.01 - oy) / dy;
    if (!(tf > 0) || tf >= tProp) return -1;
    const sp = thingSpot(vaneK), hx = ox + dx * tf - sp[0], hz = oz + dz * tf - sp[1];
    return hx * hx + hz * hz <= def.things[vaneK].size[0] ** 2 ? tf : -1;
  }
  /** the chimney's breath (Lanternroof's Chimney Corner, the warm nap spot at its foot): a deeper breath of warm air when the player taps it or a squishy settles
   *  down to nap at its foot (LIFE's USE NAP naming it); the look's own (thingFx(k, 1, 1)) */
  function chimneyBreath(globalThing: number): void {
    for (let k = 0; k < def.things.length; k++) if (thingGlobal[k] === globalThing && def.things[k].look === 'chimney') { try { stage.thingFx?.(k, 1, 1); } catch { /* none */ } return; }
  }
  /** the Shake Pine (PLACES 4.4): its branch struck (a body's bump on the trunk at 0.3 m/s or more, a brush, or the player's tap: physics strikes the branch) drops
   *  a snow puff on anyone within p.puffR (0.7 m) of the branch: snow +p.puffSnow (0.5) with the pine as its source (LIFE's SNOWCAP REACT names it: I4 "Snow from
   *  the pine", whoever shook it), the stage's snow puff; at most one puff a second */
  let pineT = -1e9;
  function pinePuff(th: number, prop: number): boolean {
    const t = game.simTime;
    if (!world || t - pineT < 1) return false;
    pineT = t;
    const td = def.things[th], P = world.poses;
    const bx = P[prop * 8], bz = P[prop * 8 + 2], r = td.p.puffR ?? LOOK_ADD.pinePuff.r, amt = td.p.puffSnow ?? LOOK_ADD.pinePuff.amount;
    for (let i = 0; i < CAP; i++) { const c = chars[i]; if (c.on && Math.hypot(c.lastX - bx, c.lastZ - bz) <= r + c.r) lifeAddLook(w, i, LOOK.snow, amt, thingGlobal[th]); }
    try { stage.thingFx?.(th, 1, 1); } catch { /* no puff drawn */ }
    return true;
  }
  const isPine = (td: ThingDef | undefined): boolean => !!td && td.mech === MECH.bar && (td.p.branchL ?? 0) > 0;
  /** the Snowball (PLACES 4.4: "push it to a friend: it rolls into them and leaves them snowy (+0.3)"): a rolling ball with p.snowLook that meets a body */
  const snowT = new Float64Array(CAP);
  function snowballStep(): void {
    if (!world || placeIdx === 0 || floatParked) return;
    for (let k = 0; k < def.things.length; k++) {
      const td = def.things[k], p = thingFirst[k];
      if (td.mech !== MECH.ball || !(td.p.snowLook > 0) || p < 0 || !world.ballVelocity(p, ballV) || Math.hypot(ballV[0], ballV[2]) < 0.25) continue;
      const P = world.poses, bx = P[p * 8], bz = P[p * 8 + 2], t = game.simTime;
      for (let i = 0; i < CAP; i++) {
        const c = chars[i];
        if (!c.on || t - snowT[i] < 1.5 || Math.hypot(c.lastX - bx, c.lastZ - bz) > td.size[0] + c.r + 0.06) continue;
        snowT[i] = t;
        lifeAddLook(w, i, LOOK.snow, td.p.snowLook ?? LOOK_ADD.snowball.amount, thingGlobal[k]);
      }
    }
  }

  // ---- the prop world's strikes: sounds for every cause, USE records for the player's and a body's (never the weather's) ----
  function drainProps(): void {
    if (!world) return;
    const n = world.drainStrikes(strikes);
    for (let k = 0; k < n; k++) {
      const prop = strikes[k * 4] | 0, inten = strikes[k * 4 + 1], cause = strikes[k * 4 + 2] | 0, slot = strikes[k * 4 + 3] | 0;
      const th = prop >= 0 && prop < world.count ? world.propThing[prop] : -1;
      if (th < 0) continue;
      const td = def.things[th];
      if (audio.prop && td.sound) {
        propP.kind = td.sound; propP.intensity = inten; propP.note = td.notes?.[world.propPart[prop]] ?? 0; propP.auto = cause !== 0;
        propP.size = td.mech === MECH.ball ? td.size[0] : 0.22; propP.pan = 0;
        try { audio.prop(propP); } catch (x) { report(x); }
      }
      if (cause === 2) continue;   // a weather strike is a sound only (QUESTS 4)
      // (round 6) the Shake Pine's branch: a body's bump (cause 1) or the player's tap (cause 0, the poke of tapThing) drops its snow puff; a body's shake is its USE
      if (isPine(td) && world.propPart[prop] === 1) {
        // (round 7: a body's shake is one USE a puff, at most one a second, as the puff: a body resting against the branch in a gust was a record every strike)
        if (pinePuff(th, prop) && cause === 1 && slot >= 0 && slot < CAP && chars[slot].on) write(EV.USE, td.verb, thingGlobal[th], chars[slot].species, 255, 1, BY.SELF, 0);
        continue;
      }
      // a body's strike on a chime (cause 1): its USE RING only when the body moved into it (faster than CHIME_V, or tossed), at most one a CHIME_GAP_S (round 7,
      // R7_LIFE's request: a body RESTING against the lantern line while the Night Breeze swung the lanterns into it was struck again and again, 1002 USE RING
      // records in 300 s, and a squishy leaning on the Icicle Bells would have rung I9 by itself)
      if (cause === 1 && slot >= 0 && slot < CAP && chars[slot].on && td.mech === MECH.chime) {
        const c = chars[slot];
        if ((c.tossed || Math.hypot(c.vx, c.vz) > CHIME_V) && game.simTime - c.chimeT >= CHIME_GAP_S) { c.chimeT = game.simTime; write(EV.USE, td.verb, thingGlobal[th], c.species, 255, 1, BY.SELF, world.propPart[prop]); }
      }
      // a pad's kick (physics strikes the pad, cause 1, the body's slot): one USE BOUNCE by the body per landing's run of kicks (G4 "Bounce on the Moss Bouncer")
      else if (cause === 1 && slot >= 0 && slot < CAP && chars[slot].on && td.mech === MECH.pad && game.simTime - chars[slot].padT >= PAD_USE_GAP_S) {
        chars[slot].padT = game.simTime;
        write(EV.USE, td.verb, thingGlobal[th], chars[slot].species, 255, 1, BY.SELF, 0);
      }
    }
  }

  /** the held voices of the place's moving things (PG_AUDIO): a hinge's creak (the rocker, the swing) and a ball's roll, `held` = speed 0..1 every frame
   *  while it moves and once 0 when it stops; `auto` unless the player's hand holds it or the player tapped a thing in the last 2 s */
  function heldVoices(): void {
    if (!world || !audio.prop) return;
    const W = world as PropWorld & { omega?(p: number): number };
    let byPlayer = game.simTime - playerTouchT < 2;
    for (let j = 0; j < 4; j++) if (handOn[j] === 1) byPlayer = true;
    for (let k = 0; k < def.things.length; k++) {
      const td = def.things[k], p = thingFirst[k];
      if (p < 0 || p >= heldWas.length || (td.sound !== PROP_SOUND.creak && td.sound !== PROP_SOUND.ball)) continue;
      if (placeIdx === 0 && homeShown[k] !== 1) continue;
      let v = 0;
      if (td.mech === MECH.ball) { if (W.ballVelocity(p, ballV)) v = Math.min(1, Math.hypot(ballV[0], ballV[2]) / 1.5); }
      else if (typeof W.omega === 'function') { const o = W.omega(p); v = o === o ? Math.min(1, Math.abs(o) / 1.5) : 0; }
      if (v < 0.03) v = 0;
      if (v === 0 && heldWas[p] === 0) continue;
      heldWas[p] = v;
      heldP.kind = td.sound; heldP.intensity = v; heldP.held = v; heldP.key = p; heldP.size = td.mech === MECH.ball ? td.size[0] : 0.22;
      heldP.auto = !byPlayer; heldP.pan = 0;
      try { audio.prop(heldP); } catch (x) { report(x); }
    }
  }

  // ---- the awake budget (D-61, D-85, SH-22): over the cap, the farthest untouched LIFE mover stops and untouched still wholes sleep ----
  // Round 5 (VERDICT_PG B7: 5 out on high stayed at 3 to 4.3 units against 2.5 for 20 s): physics' sleep() refuses a body that is not at rest, and LIFE kept
  // every one of them moving, so the rule asked the same farthest body every frame and nobody ever slept. Now the rule takes as many wholes as the excess needs,
  // farthest first: each that physics puts to sleep counts; each it refuses is HUSHED (its scoot ends, its squash eases out, LIFE's new motion intents for it are
  // dropped for HUSH_S), so it comes to rest and sleeps a moment later. The touched, carried, tossed and riding bodies are never forced.
  // Round 6 (VERDICT_PG2 N1: on med, unitCap 1.48, a squishy asked to "Go play with..." stayed asleep or was put to sleep on its way): an ASKED squishy is
  // never taken (not stopped, hushed or slept), and while it is still asleep its wake counts against the cap, so the rule sleeps another (the play squishy too,
  // if untouched) until LIFE's own gate (units + its wake <= unitCap) lets its walk start (after 4 s LIFE starts it anyway: brain.ts ASK_WAIT_S). The bodies an
  // awake asked squishy touches are not slept either (a sleeper is a wall it cannot push past: the med-tier walk stalled against the sleeping play squishy).
  const tried = new Uint8Array(CAP);
  function overBudget(): void {
    const cap = att.unitCap + att.allowance + 0.001;
    let pend = 0, near = 0;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body || !asked(c)) continue;
      if (c.body.metrics.asleep === true) pend += c.kind === 0 ? UNIT.whole - UNIT.sleeper : UNIT.piece - UNIT.sleeper;
      else near |= c.body.metrics.contacts ?? 0;   // the bodies it is pushing past: a sleeper is a wall it cannot move (it stays awake while touched)
    }
    // (round 10, R10_FIX 1) the TURN (world.ts lifeWaitsTurn): in a place (not Home, not the cabin, which keep their published rows), one sleeping squishy whose
    // by-itself use waits for its wake while LIFE's mover token is free counts its wake as pending too; the extra sleeps it needs take only squishies that do
    // nothing that moves (lifeBusy false: no LIFE walk, no moment), the one that used most first, so the budget's cap is unchanged and nobody is stopped mid-walk
    const turns = placeIdx > 1 && s.autonomy && !s.quiet && w.movers < att.moverCap;
    let turn = 0;
    if (turns) for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (c.on && c.kind === 0 && c.body && c.body.metrics.asleep === true && !asked(c) && lifeWaitsTurn(w, i)) { turn = UNIT.whole - UNIT.sleeper; break; }
    }
    const over = s.units + pend > cap;
    if (!over && !(s.units + pend + turn > cap)) return;
    const cx = 0, cz = 0, t = game.simTime;
    // (round 10) in a place a squishy LIFE is walking (a mover) is the last the rule takes: an awake one standing still sleeps first (R10_FIX.md 1: a walk to a thing
    // was slept 0.5 s after its start while another stood awake, and the walk was lost); the farthest scoot is stopped only when no such one is awake
    const idleFirst = placeIdx > 1;
    // (round 10) and in a place the body a LIFE walker is pushing past is not slept while they touch (as round 6 spares the bodies an asked squishy touches): a
    // sleeper is a wall a scoot cannot move, and in the tall layouts (2.8 m wide) a party of three stands close, so every walk out of a huddle pushed one
    if (idleFirst) for (let i = 0; i < CAP; i++) { const c = chars[i]; if (c.on && c.body && c.scooting && lifeBusy(w, i) && c.body.metrics.asleep !== true) near |= c.body.metrics.contacts ?? 0; }
    let idleAwake = false;
    if (idleFirst) for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (c.on && c.kind === 0 && c.body && !lifeBusy(w, i) && !asked(c) && !lifeSeeksNew(w, i) && ((near >>> i) & 1) === 0 && (s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.RIDE | LIFE_FLAG.ASLEEP)) === 0 && !c.tossed) { idleAwake = true; break; }
    }
    let far = -1, fd = -1;
    if (over && !idleAwake) for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.scooting || asked(c) || lifeSeeksNew(w, i) || (s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.RIDE)) !== 0) continue;
      const d = Math.hypot(c.lastX - cx, c.lastZ - cz);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) endScoot(far);
    // (round 10) in a place the excess is counted down by what each sleep really frees: its whole's wake AND the touching-pair unit of every awake body it touches
    // (LIFE 10.3's UNIT.pair goes with either body's sleep). Round 5's count (excess / a whole's wake, rounded up) made one squishy walking into a sleeper (2.28
    // units against 1.06: two wholes and their pair) take TWO sleeps, and the second was the walker: every by-itself walk in a party of three at the low tier
    // ended there (R10_FIX.md 1, the trace). Home and the cabin keep round 5's count.
    let left = s.units + pend - cap, leftTurn = left + turn;
    let need = over ? Math.ceil(left / (UNIT.whole - UNIT.sleeper) - 1e-6) : 0;
    let needTurn = turn > 0 ? Math.ceil(leftTurn / (UNIT.whole - UNIT.sleeper) - 1e-6) - need : 0;
    tried.fill(0);
    while (idleFirst ? left > 1e-6 || (turn > 0 && leftTurn > 1e-6) : need > 0 || needTurn > 0) {
      const forTurn = idleFirst ? !(left > 1e-6) : need <= 0;
      let sl = -1, sd = -1;
      for (let i = 0; i < CAP; i++) {
        const c = chars[i];
        // (round 9, R9_FIX 2) a squishy on its way to a thing nobody in the party has used this visit, while the visit's variety floor is not met (LIFE's
        // lifeSeeksNew), is spared as an asked one is: the rule sleeps another; the budget's cap is unchanged
        if (tried[i] || !c.on || c.kind !== 0 || !c.body || asked(c) || lifeSeeksNew(w, i) || ((near >>> i) & 1) !== 0 || (s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.RIDE | LIFE_FLAG.ASLEEP)) !== 0 || c.tossed) continue;
        if (forTurn && (lifeBusy(w, i) || lifeWaitsTurn(w, i))) continue;   // (round 10: a turn never stops a walk or a moment, nor another waiter)
        // (round 10) in a place: an awake one standing still before a mover; for a turn, the one that used most this visit first (then the farthest)
        const d = (idleFirst && !lifeBusy(w, i) ? 100 : 0) + (forTurn ? 10 * lifeUsesOf(w, i) : 0) + Math.hypot(c.lastX - cx, c.lastZ - cz);
        if (d > sd) { sd = d; sl = i; }
      }
      if (sl < 0) break;
      tried[sl] = 1;
      if (forTurn) needTurn--; else need--;
      const c = chars[sl];
      if (idleFirst) {
        let freed = UNIT.whole - UNIT.sleeper;
        const cs = c.body!.metrics.contacts ?? 0;
        for (let j = 0; j < CAP; j++) {
          const o = chars[j];
          if (j === sl || tried[j] || !o.on || !o.body || (s.flags[j] & LIFE_FLAG.ASLEEP) !== 0) continue;
          if (((cs >>> j) & 1) !== 0 || (((o.body.metrics.contacts ?? 0) >>> sl) & 1) !== 0) freed += UNIT.pair;
        }
        left -= freed; leftTurn -= freed;
      }
      let slept = false;
      try { slept = c.body!.sleep?.() === true; } catch { slept = false; }
      if (!slept) {
        // not at rest yet: it is hushed (no new LIFE motion), its scoot ends and its squash eases out, so a later frame's sleep() takes
        if (c.hushT <= t) { c.hushT = t + HUSH_S; for (let k = 0; k < qLen; k++) if (qWho[k] === sl && (qKind[k] === HOP_GO || qKind[k] === INTENT.HOP || qKind[k] === INTENT.SCOOT)) qKind[k] = 0; }
        endScoot(sl);
        try { c.body!.setSquash?.(1, 0.12); } catch { /* ignore */ }
      } else c.hushT = -1e9;
    }
  }

  // ---- scripts (LIFE 4.1): FIRST_PLAY on a fresh profile 6 s after the player lets go; FIRST_WISH 60 s after the first reveal (5:00 at the latest) ----
  function scripts(): void {
    const t = game.simTime;
    if (!firstPlaySent && freshProfile && firstReleaseT >= 0 && t - firstReleaseT >= FIRST_PLAY_S) {
      firstPlaySent = true;
      const i = slotOfBody(bodies.body);
      if (i >= 0) lifeScript(w, i, SCRIPT.FIRST_PLAY, 0);
    }
    if (!firstWishSent && journal) {
      const due = (firstRevealT >= 0 && t - firstRevealT >= FIRST_WISH_S) || (attachT >= 0 && t - attachT >= FIRST_WISH_LATEST_S);
      if (due) {
        const view = safeView();
        if (view && view.firstWish === 0) {
          firstWishSent = true;
          lifeScript(w, wisher(), SCRIPT.FIRST_WISH, firstRevealT >= 0 && t - firstRevealT >= FIRST_WISH_S ? 0 : 1);
        } else firstWishSent = true;
      }
    }
  }
  /** D-70: Dollop if out, else a Hearthlog fan out, else the party member out longest */
  function wisher(): number {
    const dollop = speciesIdx('dollop');
    let fan = -1, longest = -1, lt = 1e12;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || c.kind !== 0) continue;
      if (c.species === dollop) return i;
      const sp = CATALOG[c.species]?.id as keyof typeof SPECIES_LIFE | undefined;
      if (fan < 0 && sp && SPECIES_LIFE[sp]?.place === 'hearthlog') fan = i;
      if (c.outAt < lt) { lt = c.outAt; longest = i; }
    }
    return fan >= 0 ? fan : longest;
  }

  // ---- the kettle and the Music Box (D-81): a sim-time tune timer, the shell's own (LifeSnapshot.musicBoxOn) ----
  let musicBoxOnUntil = -1e9;
  // the Drip Leaf's shower (a 'shower' switch's zone, off until a tap) and a place's shower envelope (its clock starts at the arrival, sim time)
  let showerZone = -1, showerThing = -1, showerOff = -1, arriveT = 0;
  const showerPhaseOn = (sh: { onS: number; offS: number }): boolean => { const cyc = sh.onS + sh.offS; return !(cyc > 0) || (game.simTime - arriveT) % cyc < sh.onS; };
  function showerStep(): void {
    if (showerOff < 0 || game.simTime < showerOff || !world) return;
    showerOff = -1;
    if (showerZone >= 0 && showerZone < world.zoneCount) world.setZoneOn(showerZone, false);
    try { stage.thingFx?.(showerThing, 1, 0); } catch { /* none */ }
  }
  let lastTuneT = -1e9;                    // the last start of a tune (the Music Box or the kettle): the kettle keeps 60 s from a Music Box tune
  let tuneKind = -1;                       // 0 the Music Box, 1 the kettle (the one playing now)
  let kettleK = -1, kettleNext = Infinity; // the place's kettle (its things index) and its next whistle on sim time
  let kRng = 0x6b657474;                   // the whistle's seeded timer (an LCG of its own: LIFE's streams stay untouched)
  const kRand = (): number => { kRng = (Math.imul(kRng, 1664525) + 1013904223) >>> 0; return kRng / 4294967296; };
  function kettleArm(from: number): void {
    if (kettleK < 0) { kettleNext = Infinity; return; }
    const p = def.things[kettleK].p as { everyMin?: number; everyMax?: number };
    const a = p.everyMin ?? 45, b = p.everyMax ?? 90;
    kettleNext = from + a + kRand() * Math.max(0, b - a);
  }
  /** a tune starts (tune 0 the Music Box's 8 bars, 1 the kettle's one bar): the audio, the shell's own timer for LIFE, the kettle's steam */
  function startTune(tune: 0 | 1, k: number): boolean {
    const t = game.simTime;
    if (tune === 0 && t - lastTuneT < MUSIC_BOX_GAP_S && tuneKind === 0) return false;
    try { audio.musicBox?.({ on: true, tune }); } catch (x) { report(x); }
    tuneKind = tune; lastTuneT = t; musicBoxOnUntil = t + (tune === 0 ? MUSIC_BOX_S : KETTLE_BAR_S);
    if (tune === 1 && k >= 0) {
      try { stage.thingFx?.(k, 1, 1); } catch { /* no puff drawn */ }
      // the steam (PLACES 4.2): wet +0.2 on every squishy within 1.2 m of the kettle, its source the kettle (a REACT names it)
      const p = def.things[k].p as { steamWet?: number; steamR?: number };
      const sp = thingSpot(k), r = p.steamR ?? 1.2;
      for (let i = 0; i < CAP; i++) if (chars[i].on && Math.hypot(chars[i].lastX - sp[0], chars[i].lastZ - sp[1]) <= r) lifeAddLook(w, i, LOOK.wet, p.steamWet ?? 0.2, thingGlobal[k]);
    }
    return true;
  }
  function stopTune(): void {
    try { audio.musicBox?.({ on: false, tune: tuneKind < 0 ? 0 : tuneKind }); } catch (x) { report(x); }
    musicBoxOnUntil = -1e9; tuneKind = -1;
  }
  /** once a step in a place with a kettle: it whistles by itself every 45 to 90 s, never within 60 s of a Music Box tune, never while LIFE is quiet */
  function kettleStep(): void {
    if (kettleK < 0 || travelling) return;
    const t = game.simTime;
    if (t < kettleNext || s.quiet) return;
    if (musicBoxOnUntil > t || (tuneKind === 0 && t - lastTuneT < 60)) { kettleNext = Math.max(t, lastTuneT + 60) + 1; return; }
    startTune(1, kettleK);
    kettleArm(t);
  }

  // ---- the player's taps on things (PLACES 2.1 M13 / M14, D-93's "tap it yourself" by pointer): a press that hits no squishy and lands on a shown
  // thing, released within 350 ms and 12 px (a longer or moving press is the camera's): a ball rolls away, a hinge or chime is poked, a switch
  // switches (the Music Box's tune, the kettle's whistle, the fireplace's fire). Each is one USE record by PLAYER (H9 "roll the ball", C8's fire).
  const tapId = new Int32Array(4).fill(-1), tapX = new Float32Array(4), tapY = new Float32Array(4), tapT = new Float64Array(4);
  let tapWhy = '';   // the last tap's outcome (the dev hook's view): a thing id, or why it was not a thing tap
  function pressAt(id: number, x: number, y: number): void {
    let k = -1;
    for (let j = 0; j < 4; j++) if (tapId[j] === id || (k < 0 && tapId[j] < 0)) k = j;
    if (k < 0) k = 0;
    tapId[k] = id; tapX[k] = x; tapY[k] = y; tapT[k] = game.clock.now();
  }
  function releaseAt(id: number, x: number, y: number): boolean {
    let k = -1;
    for (let j = 0; j < 4; j++) if (tapId[j] === id) { k = j; break; }
    if (k < 0) return false;
    tapId[k] = -1;
    if (game.clock.now() - tapT[k] > TAP_MS || Math.hypot(x - tapX[k], y - tapY[k]) > TAP_PX) return false;
    return tapThing(x, y);
  }
  /** (round 9, R9_FIX 4: the owner's "fix it" for Home's things hidden behind the party) At HOME a still tap whose ray first meets one or more RESTING party
   *  squishies and then a SHOWN Home thing's collider goes to the thing (its own tap: the Music Box's tune, the lamp, the shelf's bell, the pad's boing, the ball's
   *  roll); the squishy's poke is cancelled (the gesture's finger lifts with no tap). Resting: not carried, not scooting, slower than 0.15 m/s and on the
   *  ground (asleep or idle). A press that moves or holds is the squishy's as before (a pull, a squeeze), a squishy LIFE is moving still takes the press, and every
   *  place keeps "a squishy in front takes the press". Why this and not a row that steps aside or leaves gaps: the party row's slots and Home's framing are pinned
   *  by the published Home rows and LIFE's camera model (a thing 1 to 2.4 m behind a 1 m squishy shows over it only from ~43 degrees of pitch; R8_SHELL 5 (7)),
   *  and this changes no geometry: only where a still click on that exact spot goes (R9_FIX.md 4). */
  /** (round 9) a Home block drawn taller than its collider (the Warm Lamp: its 0.2 m base is the prop, its shade reaches p.shadeH = 0.6 m, homekit.ts): a ray that
   *  meets the drawn upright box (the base's half width, 0..shadeH, at body scale) before prop p takes that thing's prop instead. A click on the lamp's shade was a
   *  miss: DT-18's tap point (the drawn silhouette's middle, 0.3 m up) is on the shade */
  function homeShadeProp(p: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (placeIdx !== 0 || !world) return p;
    const sc = def.unit === 'slot' ? bodyScale : 1, q = world.poses;
    let best = p, bt = p >= 0 ? (q[p * 8] - ox) * dx + (q[p * 8 + 1] - oy) * dy + (q[p * 8 + 2] - oz) * dz : Infinity;
    for (let k = 0; k < def.things.length; k++) {
      const td = def.things[k], H = (td.p.shadeH ?? 0) * sc, f = thingFirst[k] ?? -1;
      if (!(H > 0) || f < 0 || homeShown[k] !== 1) continue;
      const sp = thingSpot(k), r = td.size[0] * sc;
      let lo = 0, hi = Infinity;
      const sl = (o: number, d: number, a: number, b: number): boolean => { if (Math.abs(d) < 1e-12) return o >= a && o <= b; const u = (a - o) / d, v = (b - o) / d; lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); return lo <= hi; };
      if (!sl(ox, dx, sp[0] - r, sp[0] + r) || !sl(oy, dy, 0, H) || !sl(oz, dz, sp[1] - r, sp[1] + r)) continue;
      if (lo < bt) { bt = lo; best = f; }
    }
    return best;
  }
  let throughWhy = '';   // (dev view) the last Home still tap's through-tap outcome
  function throughTap(x: number, y: number): boolean {
    throughWhy = 'off';
    if (placeIdx !== 0 || !world || s.quiet || game.tool !== 'hand') return false;   // (D-97: also while floating: the things stay and answer)
    const cam = stage.camera;
    if (!cam) return false;
    try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
    const n = pxToNdc(x, y, game.viewport), ray = cameraRay(cam, n.x, n.y);
    const p = homeShadeProp(propOnRay(world, ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z), ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z);
    const th = p >= 0 && p < world.count ? world.propThing[p] : -1;
    if (th < 0 || th >= def.things.length || homeShown[th] !== 1) { throughWhy = `no thing (${p})`; return false; }
    const q = world.poses, tThing = (q[p * 8] - ray.origin.x) * ray.dir.x + (q[p * 8 + 1] - ray.origin.y) * ray.dir.y + (q[p * 8 + 2] - ray.origin.z) * ray.dir.z;
    let behind = 0;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body) continue;
      const hit = raycastAt(c.body, ray.origin, ray.dir, { x: c.offX, y: c.offY, z: c.offZ });
      if (!hit || !(hit.t < tThing)) continue;
      // (resting: asleep, or not carried, not in the air and slower than 0.3 m/s across the floor (a jelly's own wobble is slower); a squishy on the move takes
      //  the press. A scoot flag alone is no motion: a body the budget put to sleep mid-scoot kept it)
      const m = c.body.metrics;
      if (m.asleep !== true && (m.carried === true || m.airborne === true || Math.hypot(c.vx, c.vz) > 0.3)) { throughWhy = `moving ${CATALOG[c.species]?.id ?? i}`; return false; }
      behind++;
    }
    throughWhy = behind > 0 ? `through ${def.things[th].id} (${behind})` : `clear ${def.things[th].id}`;
    return behind > 0 && (tapThing(x, y, true) || tapWhy === def.things[th].id);   // (a thing with nothing to do still takes the tap: never the squishy's)
  }
  /** (round 9) the input port's release, seen first by the life chunk while it is attached (dispose gives it back): Home's through-tap above */
  type UpPort = { pointerUp(p: { id: number; x: number; y: number }): void; pointerCancel(id: number): void };
  const inPort = ((game as { input?: UpPort }).input ?? null) as UpPort | null;
  const upPublished = inPort ? inPort.pointerUp : null;
  if (inPort && upPublished) inPort.pointerUp = (p: { id: number; x: number; y: number }): void => {
    let k = -1;
    if (placeIdx === 0) for (let j = 0; j < 4; j++) if (tapId[j] === p.id) { k = j; break; }
    if (k >= 0 && game.clock.now() - tapT[k] <= TAP_MS && Math.hypot(p.x - tapX[k], p.y - tapY[k]) <= TAP_PX && throughTap(p.x, p.y)) {
      tapId[k] = -1;
      inPort.pointerCancel(p.id);   // (the squishy's finger lifts with no tap: the press was the thing's)
      return;
    }
    upPublished.call(inPort, p);
  };
  /** (round 7) the prop a press's ray finds, seen through the place's walls. A wall is a 2.4 m physics box (PROPS.WALL_H: the cabin's log walls, the guard
   *  behind Lanternroof's knee-high parapet) and never a thing: where it is drawn lower than its box, its unseen part took the press meant for a thing behind
   *  it (from the camera Lanternroof's front wall stood over the Star Scope, the hammock's seat and the chimney: "wall"). The ray goes on from the wall's far
   *  side (walls are the world's last props, one box each, in the layout's order). -1: nothing. */
  function propOnRay(W: PropWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    let p = W.raycast(ox, oy, oz, dx, dy, dz);
    if (p < 0 || W.propThing[p] >= 0) return p;
    const ws = (layout === 1 ? def.tall : def).walls.filter((a) => a.shape === 'box'), P = W.poses;
    for (let n = 0; n < 4 && p >= 0 && W.propThing[p] < 0; n++) {
      const a = ws[ws.length - (W.count - p)];
      if (!a) return p;
      let lo = 0, hi = Infinity;
      const sl = (o: number, d: number, h: number): boolean => { if (Math.abs(d) < 1e-12) return o >= -h && o <= h; const u = (-h - o) / d, v = (h - o) / d; lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); return lo <= hi; };
      // (the box: its pose's centre; half its height = its centre's height, as it stands on the floor; no layout's wall has a yaw, so its axes are the world's)
      if (!(sl(ox - P[p * 8], dx, a.hx ?? 0.15) && sl(oy - P[p * 8 + 1], dy, P[p * 8 + 1]) && sl(oz - P[p * 8 + 2], dz, a.hz ?? 0.15)) || !Number.isFinite(hi)) return p;
      ox += dx * (hi + 1e-3); oy += dy * (hi + 1e-3); oz += dz * (hi + 1e-3);
      p = W.raycast(ox, oy, oz, dx, dy, dz);
    }
    return p;
  }
  function tapThing(x: number, y: number, through = false): boolean {
    if (!world || s.quiet || game.tool !== 'hand') { tapWhy = 'off'; return false; }   // (D-97: also while floating)
    const cam = stage.camera;
    if (!cam) { tapWhy = 'nocam'; return false; }
    try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
    const n = pxToNdc(x, y, game.viewport);
    const ray = cameraRay(cam, n.x, n.y);
    let p = homeShadeProp(propOnRay(world, ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z), ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z);
    // (round 8) the Drip Leaf's big leaf has no prop (the stalk is its prop): a press that reaches the drawn leaf before any prop taps the Drip Leaf. A player taps the
    // leaf, not its 2 cm stalk; with a squishy set under it (G7) the stalk's middle is behind the squishy and the press was "body" or nothing (R7's final1b2 G7 row)
    let leafHit = false;
    if (leafK >= 0) {
      const tl = leafTap(ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z), q = world.poses;
      const tP = p >= 0 ? (q[p * 8] - ray.origin.x) * ray.dir.x + (q[p * 8 + 1] - ray.origin.y) * ray.dir.y + (q[p * 8 + 2] - ray.origin.z) * ray.dir.z : Infinity;
      if (tl >= 0 && tl < tP) {
        for (let i = 0; i < CAP; i++) { const c = chars[i]; if (!c.on || !c.body) continue; const hit = raycastAt(c.body, ray.origin, ray.dir, { x: c.offX, y: c.offY, z: c.offZ }); if (hit && hit.t < tl) { tapWhy = 'body'; return false; } }
        const lp = thingFirst[leafK] ?? -1;
        if (lp >= 0) { p = lp; leafHit = true; }
      }
    }
    // (round 9) the Shake Pine's crown, as the leaf: a press that reaches the drawn crown before any prop (and before any squishy) taps the pine (its branch: part 1)
    if (crownK >= 0 && !leafHit) {
      const tc = crownTap(ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z), q = world.poses;
      const tP = p >= 0 ? (q[p * 8] - ray.origin.x) * ray.dir.x + (q[p * 8 + 1] - ray.origin.y) * ray.dir.y + (q[p * 8 + 2] - ray.origin.z) * ray.dir.z : Infinity;
      if (tc >= 0 && tc < tP) {
        for (let i = 0; i < CAP; i++) { const c = chars[i]; if (!c.on || !c.body) continue; const hit = raycastAt(c.body, ray.origin, ray.dir, { x: c.offX, y: c.offY, z: c.offZ }); if (hit && hit.t < tc) { tapWhy = 'body'; return false; } }
        const cp = thingFirst[crownK] ?? -1;
        if (cp >= 0) { p = cp; leafHit = true; }
      }
    }
    // (round 7) the Vane Disc has no prop for the ray: its painted disc on the floor takes the press when no prop stands nearer (a prop's centre along the ray)
    if (vaneK >= 0 && !leafHit) {
      let tP = Infinity;
      if (p >= 0) { const q = world.poses; tP = (q[p * 8] - ray.origin.x) * ray.dir.x + (q[p * 8 + 1] - ray.origin.y) * ray.dir.y + (q[p * 8 + 2] - ray.origin.z) * ray.dir.z; }
      const tv = vaneTap(ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z, tP);
      if (tv >= 0) {
        for (let i = 0; i < CAP; i++) { const c = chars[i]; if (!c.on || !c.body) continue; const hit = raycastAt(c.body, ray.origin, ray.dir, { x: c.offX, y: c.offY, z: c.offZ }); if (hit && hit.t < tv) { tapWhy = 'body'; return false; } }
        // "push it round with a poke" (PLACES 4.8): the rose spins for VANE_POKE_S (the look's), its whoosh; whoever stands on it rides (vaneStep: USE SPIN by the PLAYER)
        const vd = def.things[vaneK];
        tapWhy = vd.id; playerTouchT = game.simTime; vanePokeT = game.simTime;
        try { stage.thingFx?.(vaneK, 1, 1); } catch { /* none */ }
        if (audio.prop && vd.sound) { propP.kind = vd.sound; propP.intensity = 0.6; propP.note = 0; propP.auto = false; propP.size = 0.22; propP.pan = 0; try { audio.prop(propP); } catch (x) { report(x); } }
        lifeThingTap(w, thingGlobal[vaneK]);
        return true;
      }
    }
    if (p < 0) { tapWhy = 'miss'; return false; }
    const th = world.propThing[p];
    if (th < 0 || th >= def.things.length) { tapWhy = 'wall'; return false; }
    // a squishy in front of the thing takes the press (the gesture machine has it already)
    const pr = world.poses, px = pr[p * 8] - ray.origin.x, py = pr[p * 8 + 1] - ray.origin.y, pz = pr[p * 8 + 2] - ray.origin.z;
    const tThing = px * ray.dir.x + py * ray.dir.y + pz * ray.dir.z;
    if (!leafHit && !through) for (let i = 0; i < CAP; i++) {   // (the leaf's own check above measured to the drawn leaf; Home's through-tap checked its own)
      const c = chars[i];
      if (!c.on || !c.body) continue;
      const hit = raycastAt(c.body, ray.origin, ray.dir, { x: c.offX, y: c.offY, z: c.offZ });
      if (hit && hit.t < tThing) { tapWhy = 'body'; return false; }
    }
    tapWhy = def.things[th].id;
    playerTouchT = game.simTime;
    const td = def.things[th], g = thingGlobal[th];
    const actor = nearestTo(pr[p * 8], pr[p * 8 + 2]);
    const sp = actor >= 0 ? chars[actor].species : 255;
    if (td.switch === 'tune') {
      const tune: 0 | 1 = td.id === 'kettle' ? 1 : 0;
      if (musicBoxOnUntil > game.simTime && tuneKind === tune && tune === 0) stopTune();   // a second tap stops the Music Box (AU-14)
      else if (!startTune(tune, th)) return true;                                       // one start per 40 s: the tap is taken, nothing plays
      write(EV.USE, td.verb, g, sp, 255, 1, BY.PLAYER, 0);
      lifeThingTap(w, g);   // (PG_LIFE round 4: a switch tap is always noticed by everyone within 1.5 m)
      return true;
    }
    if (td.switch === 'shower') {
      // the Drip Leaf (PLACES 2.1 M14): the leaf tips a shower: its wet zone on for SHOWER_S, its puff and rustle; LIFE hears the tap (SHOWER under it, G7)
      const zi = td.zone ? def.zones.findIndex((z) => z.id === td.zone) : -1;
      if (zi >= 0) { world.setZoneOn(zi, true); showerZone = zi; showerThing = th; showerOff = game.simTime + SHOWER_S; }
      try { stage.thingFx?.(th, 1, 1); } catch { /* none */ }
      if (audio.prop && td.sound) { propP.kind = td.sound; propP.intensity = 0.8; propP.note = 0; propP.auto = false; propP.size = 0.22; propP.pan = 0; try { audio.prop(propP); } catch (x) { report(x); } }
      write(EV.USE, USE_VERB.SWITCH, g, sp, 255, 1, BY.PLAYER, 0);
      lifeThingTap(w, g);
      return true;
    }
    if (td.switch === 'fire' || td.switch === 'zone') {
      // the fireplace's fire, the lamp's warmth: the thing's zone on or off, its puff; the warm zone follows (zonesAt reads zoneOn)
      const zi = td.zone ? def.zones.findIndex((z) => z.id === td.zone) : -1;
      if (zi >= 0) world.setZoneOn(zi, world.zoneOn[zi] === 0);
      try { stage.thingFx?.(th, 1, 1); } catch { /* none */ }
      // the fire's crackle puffs the bed (PG_AUDIO: prop({ kind: crackle }) for 5 s), only when the fire comes on
      if (td.sound === PROP_SOUND.crackle && zi >= 0 && world.zoneOn[zi] !== 0 && audio.prop) { propP.kind = td.sound; propP.intensity = 1; propP.note = 0; propP.auto = false; propP.size = 0.22; propP.pan = 0; try { audio.prop(propP); } catch (x) { report(x); } }
      write(EV.USE, USE_VERB.SWITCH, g, sp, 255, 1, BY.PLAYER, 0);
      // LIFE hears it (PG_LIFE round 4): noticed by everyone near; a fire's puff is a tune they may sing to (C8's finale), so a fire only when it comes on
      if (td.switch !== 'fire' || (zi >= 0 && world.zoneOn[zi] !== 0)) lifeThingTap(w, g);
      return true;
    }
    if (td.switch === 'comet') {
      // (round 7, PLACES 4.8) the Star Scope: a slow comet crosses the sky (the look's, its p.cometS; none with reduced motion) and every squishy on screen looks
      // up at it (LIFE's GAZE_SKY for each, its thing the scope: L2 "Moon watchers" counts them); one USE SWITCH by the PLAYER (L7 "A shooting star"). One comet
      // at a time: a tap while it flies is taken and does nothing more.
      const cs = (td.p as { cometS?: number }).cometS ?? 6;
      if (game.simTime < cometEnd) return true;
      cometEnd = game.simTime + cs; cometDur = cs;
      try { stage.thingFx?.(th, 1, 1); } catch { /* none */ }
      if (audio.prop && td.sound) { propP.kind = td.sound; propP.intensity = 0.5; propP.note = 0; propP.auto = false; propP.size = 0.22; propP.pan = 0; try { audio.prop(propP); } catch (x) { report(x); } }
      write(EV.USE, USE_VERB.SWITCH, g, sp, 255, 1, BY.PLAYER, 0);
      lifeThingTap(w, g);
      return true;
    }
    if (td.look === 'chimney') {
      // (round 7) the Chimney Corner: a tap and it breathes a deeper puff of warm air (the look's); its warm foot is the nap spot (LIFE's). Nothing pays.
      chimneyBreath(g);
      lifeThingTap(w, g);
      return true;
    }
    if (isPine(td)) {
      // (round 6, PLACES 4.4) "tap it: it shakes": the same poke on the branch (part 1, whether the press found the trunk or the branch); physics strikes the
      // branch (cause 0) and drainProps drops the snow puff on whoever stands under it
      const br = thingFirst[th] + 1;
      world.poke(br > 0 && br < world.count && world.propThing[br] === th ? br : p, ray.dir.x * 0.8, -0.3, ray.dir.z * 0.8);
      write(EV.USE, td.verb, g, sp, 255, 1, BY.PLAYER, 0);
      lifeThingTap(w, g);
      return true;
    }
    if (td.mech === MECH.ball) {
      // a flick: the ball rolls away from the camera
      const hx = ray.dir.x, hz = ray.dir.z, hl = Math.hypot(hx, hz) || 1;
      world.poke(p, (hx / hl) * FLICK_MS, 0, (hz / hl) * FLICK_MS);
      write(EV.USE, td.verb, g, sp, 255, 1, BY.PLAYER, 0);
      return true;
    }
    if (td.mech === MECH.chime || td.mech === MECH.seesaw || td.mech === MECH.swing) {
      world.poke(p, ray.dir.x * 0.6, -0.4, ray.dir.z * 0.6);
      write(EV.USE, td.verb, g, sp, 255, 1, BY.PLAYER, world.propPart[p]);
      if (td.mech === MECH.chime) lifeThingTap(w, g);   // a tapped chime row is one bar of tune (PG_LIFE round 4, LIFE 6.1)
      return true;
    }
    if (td.sound) {
      // (round 9, R9_FIX 4) any other thing with a voice answers a tap with it (Home's Keepsake Shelf its bell, a pad its boing, the Glide Ramp its whoosh) and whoever
      // is near notices; no USE record (U2 / G4 count the bounces of squishies). They did nothing before: the dev view said the thing's id and the release fell through
      if (audio.prop) { propP.kind = td.sound; propP.intensity = 0.5; propP.note = 0; propP.auto = false; propP.size = 0.22; propP.pan = 0; try { audio.prop(propP); } catch (x) { report(x); } }
      lifeThingTap(w, g);
      return true;
    }
    return false;
  }
  /** the character nearest a point (the squishy "watching" a thing the player tapped: its species goes in the USE record), -1 when none */
  function nearestTo(x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < CAP; i++) { const c = chars[i]; if (!c.on || c.kind !== 0) continue; const d = Math.hypot(c.lastX - x, c.lastZ - z); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  // ---- D-95 (revised, the owner 2026-11-17): a hinge ride (the swing, the rocker) dies down by itself after a push (unchanged); AUTO is the PLAYER'S
  // toggle (a small control on the thing, ui/thingAuto.ts; off by default, never LIFE's or autonomy's) that keeps a gentle steady arc; a hand always
  // wins: the player grabs the seat or board (here: grabAt / dragAt / dropAt, physics grabProp / dragPropRay / releaseProp) or the rider (the
  // gesture machine's grab, as any squishy; physics' held-rider rule turns the seat with it). PG_PHYS round 4's PropWorld members, no fallback.
  const autoWanted = new Set<string>();   // the rides the player set to AUTO this session (a trip rebuilds the world: re-applied on arrival)
  const hingeRide = (td: ThingDef | undefined): boolean => !!td && (td.mech === MECH.swing || td.mech === MECH.seesaw);
  const hasAuto = (): boolean => !!world;
  function applyAuto(): void {
    if (!hasAuto()) return;
    for (let k = 0; k < def.things.length; k++) if (hingeRide(def.things[k])) { try { world!.setAuto(k, autoWanted.has(def.things[k].id)); } catch (e) { report(e); } }
  }
  // (a slot is in use by its own flag, never by a sentinel id: the dev hook's pointers have NEGATIVE ids, -1 for its pointer 0, and round 4's first
  //  version kept -1 as "free", so it took every move of the dev hook's pointer 0 and no squishy could be lifted through it: snap-mat / cut-real / shift-pull)
  const handOn = new Uint8Array(4), handId = new Int32Array(4), handProp = new Int16Array(4), handX = new Float32Array(4), handY = new Float32Array(4), handT = new Float64Array(4), handMoved = new Uint8Array(4);
  const handSlot = (id: number): number => { for (let j = 0; j < 4; j++) if (handOn[j] === 1 && handId[j] === id) return j; return -1; };
  const handFree = (): number => { for (let j = 0; j < 4; j++) if (handOn[j] === 0) return j; return -1; };
  function dropAll(): boolean {
    let any = false;
    for (let j = 0; j < 4; j++) if (handOn[j] === 1) { any = true; handOn[j] = 0; try { world?.releaseProp(handProp[j]); } catch { /* gone */ } }
    endSteady();
    return any;
  }
  function grabAt(id: number, x: number, y: number): boolean {
    const W = world;
    if (!W || s.quiet || game.tool !== 'hand' || handSlot(id) >= 0) return false;   // (D-97: also while floating)
    const j = handFree();
    if (j < 0) return false;
    const cam = stage.camera;
    if (!cam) return false;
    try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
    const n = pxToNdc(x, y, game.viewport), ray = cameraRay(cam, n.x, n.y);
    const p = propOnRay(W, ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z);
    const th = p >= 0 ? W.propThing[p] : -1;
    if (th < 0 || !hingeRide(def.things[th]) || W.isParked(p)) return false;
    // a squishy in front of the seat (the rider) takes the press: the gesture machine grabs it, as any squishy
    const pr = W.poses, tThing = (pr[p * 8] - ray.origin.x) * ray.dir.x + (pr[p * 8 + 1] - ray.origin.y) * ray.dir.y + (pr[p * 8 + 2] - ray.origin.z) * ray.dir.z;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body) continue;
      const hit = raycastAt(c.body, ray.origin, ray.dir, { x: c.offX, y: c.offY, z: c.offZ });
      if (hit && hit.t < tThing) return false;
    }
    if (!W.grabProp(p, NaN, NaN, NaN)) return false;   // (NaN: the raycast's own hit on it)
    if (p === steadyP) { steadyP = -1; steadyI = -1; steadyOnT = -1; }   // (a lift's steadying hand: the player's hand has the seat now, never let go of it for them)
    handOn[j] = 1; handId[j] = id; handProp[j] = p; handX[j] = x; handY[j] = y; handT[j] = game.clock.now(); handMoved[j] = 0; playerTouchT = game.simTime;
    tapWhy = `hand:${def.things[th].id}`;
    return true;
  }
  function dragAt(id: number, x: number, y: number): boolean {
    const j = handSlot(id);
    if (j < 0) return false;
    const W = world, cam = stage.camera;
    if (Math.hypot(x - handX[j], y - handY[j]) > TAP_PX) handMoved[j] = 1;
    if (W && cam) {
      try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
      const n = pxToNdc(x, y, game.viewport), ray = cameraRay(cam, n.x, n.y);
      W.dragPropRay(handProp[j], ray.origin.x, ray.origin.y, ray.origin.z, ray.dir.x, ray.dir.y, ray.dir.z);
    }
    return true;
  }
  function dropAt(id: number, x: number, y: number): boolean {
    const W = world;
    const j = handSlot(id);
    if (j < 0) return false;
    handOn[j] = 0;
    const p = handProp[j];
    try { W?.releaseProp(p); } catch (e) { report(e); }
    if (!W || x !== x) return true;   // a cancel
    const th = p >= 0 && p < W.count ? W.propThing[p] : -1;
    if (th < 0) return true;
    if (!handMoved[j] && game.clock.now() - handT[j] <= TAP_MS) { tapThing(x, y); return true; }   // a still tap: round 3's poke and its USE record
    if (handMoved[j]) { const td = def.things[th], a = nearestTo(W.poses[p * 8], W.poses[p * 8 + 2]); write(EV.USE, td.verb, thingGlobal[th], a >= 0 ? chars[a].species : 255, 255, 1, BY.PLAYER, W.propPart[p]); }
    return true;
  }
  const autoAt = { x: 0, y: 0, z: 0 };

  // ---- the collection's journal events: moments, the unlock line, friendships back into LIFE ----
  const frame = createFrameWatch(deps.storage, () => pushJournal());
  const offEvents = game.hoard.onEvent((e: CollectionEvent) => {
    try {
      switch (e.type) {
        case 'quest': {
          // "New stamp: ..." (QUESTS 15): Home's titles ship here (HOME_TEXT); every other chapter's come from the lazy journal_text (later-journal-text)
          const title = homeQuestTitle(e.quest);
          if (title) deps.moment?.(`New stamp: ${title}`);
          else {
            const q = e.quest;
            void import('../data/journal_text.ts').then((m) => { const t = m.QUEST_TEXT[q]?.[0]; deps.moment?.(t ? `New stamp: ${t}` : 'New stamp'); }, () => { deps.moment?.('New stamp'); });
          }
          if (e.byPlayer) deps.stampHaptic?.();
          void frame.quest(e.quest);   // (round 8: the Friendship Frame at X8)
          // a chapter's finale done in its own place: the place's finale light (PG_RENDER: Ripple's sunset, Frostbell's evening and stars), eased back after 20 s
          { const q = QUESTS[e.quest]; if (q && q.kind === 'finale' && q.chapter > 0 && CHAPTERS[q.chapter]?.place === placeIdx && placeIdx !== 0) { try { stage.thingFx?.(-1, 2, 1); finaleOff = game.simTime + 20; } catch { /* none */ } } }
          pushJournal();
          if (placeIdx === 0) homeThings();
          break;
        }
        case 'unlock': {
          const p = PLACE_INFO.find((x) => x.idx === e.place);
          // (round 6: the line is said at once, as before, and the play UI also SHOWS it in the moments slot: a sighted player saw nothing when a place opened by
          // stamps, the Places button being there already; the tracker pill then points the way, ui/later-play.ts)
          if (p && p.shipped) { const line = `${p.name} is open. Find it in Places.`; deps.say?.(line); deps.moment?.(line, true); }
          pushJournal();
          // 11.7 / PG_AUDIO: the place's data, look and sound are fetched in the background once it opens (the trip then waits for nothing new); a failure is
          // harmless (the trip loads them again and says so if they still fail)
          if (p && p.shipped && p.idx !== 0) {
            const id = p.id as PlaceId;
            setTimeout(() => { void loadPlaceDef(id).catch(() => undefined); void Promise.resolve(stage.loadPlace?.(id)).catch(() => undefined); void Promise.resolve(audio.loadAmbience?.(id)).catch(() => undefined); }, 1500);
          }
          break;
        }
        case 'friend': {
          for (let i = 0; i < CAP; i++) for (let j = i + 1; j < CAP; j++) {
            const a = chars[i], b = chars[j];
            if (a.on && b.on && a.kind === 0 && b.kind === 0 && ((a.species === e.a && b.species === e.b) || (a.species === e.b && b.species === e.a))) lifeSetPair(w, i, j, e.level, false);
          }
          if (e.level >= 2) for (const sp of [e.a, e.b]) { game.hoard.friendMask?.(sp, friendMask); lifeSetFriends(w, sp, friendMask); }
          break;
        }
        case 'fact': if (e.fact === 3) { game.hoard.friendMask?.(e.species, friendMask); lifeSetFriends(w, e.species, friendMask); } break;
        case 'keepsake': { const v = safeView(); if (v) { try { stage.setKeepsakes?.(v.keepsakes); } catch { /* ignore */ } } break; }
        case 'gift': if (e.state === 'ready') deps.moment?.('A gift is waiting in the Journal.'); break;
        default: break;
      }
    } catch (x) { report(x); }
  });
  const offCeremony = game.on('ceremony', (e) => {
    if (e.type === 'start') {
      lastCeremony = e.kind;
      // 11.3: the start's mat.clear() (ceremonies beforeStart) is a stash. The registry still lists who was out (syncParty waits while the
      // party is held), so the stash is read from it; a ceremony queued behind another keeps the first one's squishies still to come back.
      ceremonyOn = true;
      const playId = game.identity.itemId;
      for (const id of restoreQ) if (id !== playId && !stash.includes(id)) stash.push(id);
      restoreQ.length = 0;
      for (let i = 0; i < CAP; i++) { const c = chars[i]; if (c.on && c.kind === 0 && c.itemId !== null && c.itemId !== playId && !stash.includes(c.itemId)) stash.push(c.itemId); }
      if (prevPlay === null) prevPlay = playId;
      if (e.kind === 'capsule') { const v = safeView(), h4 = questIdx('H4'); firstCapsule = !!v && h4 >= 0 && !v.quests[h4]?.done; }
      return;
    }
    if (e.type === 'end') {
      const kind = lastCeremony;
      if (kind === 'capsule') { write(EV.CAPSULE, 0, -1, (() => { try { return speciesIdx(e.info.item.genome.species); } catch { return 255; } })(), 255, 1, BY.PLAYER); if (firstRevealT < 0) firstRevealT = game.simTime; }
      lastCeremony = null;
      ceremonyOn = false;
      // the result is the play body now (ceremonies.ts adopts it before this event): the stash comes back beside it, then, for the player's FIRST
      // capsule only, the squishy that was in play (D-52 and 11.3: "the first capsule's newcomer stays out when there is room"; QUESTS 13's first
      // hello). Every later reveal replaces the play squishy as the published game does; the party around it survives every ceremony (11.3).
      const nowPlay = game.identity.itemId;
      const has = (id: string): boolean => { try { return !!game.hoard.item(id); } catch { return false; } };
      for (const id of stash) if (id !== nowPlay && has(id)) restoreQ.push(id);
      if (kind === 'capsule' && firstCapsule && prevPlay !== null && prevPlay !== nowPlay && has(prevPlay) && !restoreQ.includes(prevPlay)) restoreQ.push(prevPlay);
      firstCapsule = false;
      if (kind === 'capsule') newcomerId = nowPlay;
      stash.length = 0; prevPlay = null; shelved.length = 0;
    }
  });
  /** one squishy of the stash back on the mat per step once no ceremony runs or waits (5 at most: within 0.1 s; 11.3 asks 0.5 s) */
  function pumpRestore(): void {
    if (!restoreQ.length || ceremonyOn || game.ceremonies.active || game.ceremonies.pending || game.phase !== 'play') return;
    const id = restoreQ.shift()!;
    let it: ReturnType<typeof game.hoard.item> = null;
    try { it = game.hoard.item(id); } catch { it = null; }
    if (it && it.id !== game.identity.itemId && !game.mat.has(it.id)) {
      let r: string | null = null;
      try { r = game.mat.add({ genome: it.genome, itemId: it.id, tier: it.tier as TierName, name: it.name }, { restore: true }); } catch (x) { report(x); r = 'failed'; }
      if (r === 'full') shelved.push(it.name);
    }
    if (!restoreQ.length && shelved.length) {
      // the tier drop policy's kind line (11.3): who found no room goes back to the shelf, said once
      deps.say?.(shelved.length === 1 ? `${shelved[0]} went back to the shelf for a rest.` : `${shelved.length} squishies went back to the shelf for a rest.`);
      shelved.length = 0;
    }
  }

  // ---- attach: the early log, the journal, Home ----
  attachT = game.simTime;
  {
    const L = game.earlyLog;
    for (let k = 0; k < L.n; k++) {
      const sp = L.species[k];
      if (L.kind[k] === 1 && L.v[k] >= 0.4) write(EV.TOUCH, TOUCH.SQUEEZE, -1, sp, 255, 1, BY.PLAYER, L.v[k]);
      else if (L.kind[k] === 2) write(EV.TOUCH, TOUCH.STRETCH, -1, sp, 255, 1, BY.PLAYER, L.v[k]);
      else if (L.kind[k] === 3) { write(EV.CAPSULE, 0, -1, sp, 255, 1, BY.PLAYER); if (firstRevealT < 0) firstRevealT = game.simTime; }
    }
    if (L.n > 0 && firstReleaseT < 0 && L.kind[0] !== 3) firstReleaseT = game.simTime;
    L.n = 0;
  }
  pushJournal();
  { const v0 = safeView(); freshProfile = !!v0 && v0.stamps === 0; }   // a fresh profile (FIRST_PLAY), latched at attach: the first stamp lands during it
  {
    // the places this load opened (open now, not in the save before the attach): the open line, said once and shown in the moments slot (the play UI lands a
    // moment after the host, so the lines wait for it); then the tracker pill points the way (ui/later-play.ts)
    const v0 = safeView();
    const lines = v0 && placesBefore >= 0 ? PLACE_INFO.filter((p) => p.shipped && p.idx > 1 && (v0.places & (1 << p.idx)) !== 0 && (placesBefore & (1 << p.idx)) === 0).map((p) => `${p.name} is open. Find it in Places.`) : [];
    // (round 7: more than three at one load, a save on a build that ships several places at once: each line is said, ONE moment shows them all; the moments queue
    // holds three and summed the rest as "N new stamps", the wrong words for places)
    if (lines.length) setTimeout(() => { for (const l of lines) { deps.say?.(l); if (lines.length <= 3) deps.moment?.(l, true); } if (lines.length > 3) deps.moment?.(`${lines.length} places are open. Find them in Places.`, true); }, 1500);
  }
  syncParty();
  buildHome();
  try { stage.setAutonomyFraming?.(true); } catch (e) { report(e); }
  try { const v = safeView(); if (v) stage.setKeepsakes?.(v.keepsakes); } catch { /* ignore */ }
  let lastTall = frameTall(), lastScale = bodyScale, boundsTick = 0;
  const offSettings = game.on('settings', () => { floatRule(); });

  // ---- travel (S1): the place picker's path (QUESTS 15, 11.7) ----
  async function travel(id: string, devAny = false): Promise<boolean> {
    if (travelling || partyHeld()) return false;   // (whenIdle: never during a ceremony or while its party is coming back)
    const target = PLACE_INFO.find((p) => p.id === id);
    if (!target) return false;
    if (target.idx === placeIdx) return true;
    // (devAny: the dev hook's check of a place that has not shipped or opened yet, PG_SHELL R4's S2 visits; the Travel sheet never passes it)
    if (target.idx !== 0 && !devAny && (!target.shipped || (openPlacesMask & (1 << target.idx)) === 0)) return false;
    travelling = true;
    try {
      // leaving: a cut squishy goes back together, the locks let go, the fingers lift
      try { game.releaseEverything(); game.cut.reconnectAll(false); } catch (e) { report(e); }
      let nextDef: PlaceDef = HOME;
      if (target.idx !== 0) {
        const [d, ok] = await Promise.all([loadPlaceDef(target.id as PlaceId), stage.loadPlace ? stage.loadPlace(target.id) : Promise.resolve(false), audio.loadAmbience ? audio.loadAmbience(target.id).catch(() => false) : Promise.resolve(false)]);
        if (!ok) { deps.say?.(`${target.name} did not load. Try again.`); return false; }
        nextDef = d;
      }
      syncParty();
      // the crossfade first (a snapshot fade, never a flash), then the swap under it
      const shown = stage.setPlace ? stage.setPlace(target.idx === 0 ? null : target.id, 0.6) : false;
      if (target.idx !== 0 && !shown) { deps.say?.(`${target.name} did not load. Try again.`); return false; }
      enterPlace(nextDef);
      write(EV.VISIT, 0, -1, chars.find((c) => c.on && c.kind === 0)?.species ?? 255, 255, wholesOut(), BY.PLAYER);
      for (const c of chars) if (c.on && c.kind === 0) write(EV.BRING, 0, -1, c.species, 255, 1, BY.PLAYER);   // QUESTS 4: one BRING per member who came along
      deps.say?.(target.idx === 0 ? 'You are at Home.' : `You are at ${target.name}.`);
      return true;
    } catch (e) { report(e); deps.say?.(`${target.name} did not load. Try again.`); return false; }
    finally { travelling = false; }
  }
  function enterPlace(next: PlaceDef): void {
    dropAll();
    for (let i = 0; i < CAP; i++) if (chars[i].on) { clearBubbles(i); endScoot(i); }
    if (musicBoxOnUntil > game.simTime) stopTune();   // a tune does not follow the party to another place
    visit++;
    showerOff = -1; showerZone = -1; showerThing = -1;   // (a shower in progress stays behind)
    gustOn.fill(0); waveHi.fill(0); showerWas.fill(-1); pineT = -1e9; snowT.fill(-1e9); modsT = -1e9;   // (round 6: the new place's weather starts afresh)
    windWas = -1; cometEnd = -1e9; if (cometGazing) cometGaze();   // (round 7: the new place's wind look and comet start afresh; eyes let go of the old one)
    selfUsed.clear(); selfReacted.clear(); selfSocial.clear();
    def = next; placeIdx = next.idx;
    coldPitch = next.zones.some((z) => z.kind === ZONE.cold && z.strength >= 0.5) ? Math.pow(2, -1 / 12) : 1;
    heldWas.fill(0);
    if (finaleOff >= 0) { finaleOff = -1; try { stage.thingFx?.(-1, 2, 0); } catch { /* none */ } }
    kettleK = placeIdx === 0 ? -1 : next.things.findIndex((t) => t.switch === 'tune' && t.id === 'kettle');
    if (placeIdx === 0) {
      // home again: every body back at its mat slot (the play body at slot 0, the k-th squishy out at slot k: mat.ts builds them there),
      // Home's framing and world
      try { stage.setPlayBounds?.(NaN, NaN, NaN, NaN); } catch { /* ignore */ }
      try { audio.setAmbience?.({ place: null }); audio.setMusicStyle?.('home'); } catch (e) { report(e); }
      try { stage.setHeatPoint?.(NaN, NaN, NaN); } catch { /* ignore */ }
      const L = (stage as { matLayout?: (n: number) => V3[] }).matLayout?.(Math.max(1, wholesOut())) ?? [];
      const p0 = slotOfBody(bodies.body);
      if (p0 >= 0 && chars[p0].kind === 0) place(chars[p0], L[0]?.x ?? 0, L[0]?.z ?? 0);
      let k = 1;
      for (const x of bodies.extras) {
        if (x.piece) continue;
        const i = slotOfBody(x.body);
        if (i < 0 || chars[i].kind !== 0) continue;
        const spot = L[k++] ?? { x: 0, y: 0, z: 0 };
        place(chars[i], spot.x, spot.z);   // (place-space: place() takes the body's own draw offset off)
      }
      homeShown.fill(0);
      // Home keeps the published corral about each body's own spot (setBounds -1; D-87's rectangle is not sent: one squishy alone stays the published toy)
      for (let i = 0; i < CAP; i++) { const c = chars[i]; if (c.on && c.body) { try { c.body.setBounds?.(-1, 0, 0, 0, 0, 0); } catch (e) { report(e); } } }
      buildHome();
      vaneSetup();   // (none at Home)
      try { stage.setAutonomyFraming?.(true); } catch { /* ignore */ }
      kettleNext = Infinity;
      return;
    }
    try { stage.setAutonomyFraming?.(false); } catch { /* ignore */ }
    // Home's things leave with Home (R4 fix): the stage draws a shown Home thing at the bound prop whose propThing is ITS index, so in a place
    // the Felt Ball, the Music Box and the Snooze Rug followed the place's things 0, 1 and 2 (the rug under the cabin's Yarn Ball: the "jagged
    // black shape" of the round-3 phone shot) or stood at their Home spots (the stray ball and box in the S2 shots)
    for (let k = 0; k < homeShown.length; k++) { if (homeShown[k] === 1) { homeShown[k] = 0; try { stage.setHomeThing?.(k, false, 0, 0, 0); } catch (e) { report(e); } } }
    layout = frameTall() ? 1 : 0;
    const lay = layout === 1 ? next.tall : next;
    world = buildPropWorld(next, layout === 1 ? 'tall' : 'wide', 1);
    mapThings();
    vaneSetup();   // (round 7: Lanternroof's Vane Disc, in the layout in use)
    for (let k = 0; k < next.things.length; k++) { try { world.setParked(k, false); } catch { /* none */ } }
    // a shower switch's zone is dry until the player taps its thing (the Drip Leaf); the place's shower envelope starts its clock now
    arriveT = game.simTime; showerOff = -1; showerZone = -1; showerThing = -1;
    for (const t of next.things) if (t.switch === 'shower' && t.zone) { const zi = next.zones.findIndex((z) => z.id === t.zone); if (zi >= 0) world.setZoneOn(zi, false); }
    applyAuto();   // (D-95: the rides the player set to AUTO keep it across trips)
    try { stage.bindProps?.(world.poses, world.count, world.propThing); } catch (e) { report(e); }
    const b = lay.bounds;
    {
      // the framing: the layout's bounds, their FRONT edge (+z, the bottom of the screen) pushed out to every thing's footprint + 0.1 m, so a thing on
      // the front edge stands above the HUD's bottom rows (R4b: the cabin's tall Rocker Board at z 3.0 lay under the hint, "Put back" and the name tag)
      const hx = b.shape === 'disc' ? (b.r ?? 3) : (b.hx ?? 3), hz = b.shape === 'disc' ? (b.r ?? 3) : (b.hz ?? 2.4);
      const z0 = b.z - hz, z1 = Math.max(b.z + hz, frontReach(next, layout) + 0.1);
      // (round 8, R8_LIFE's request 11) the camera's pitch range: the layout's own (`camPitch`, e.g. a tall layout wider than P7's) or the place's (P8 camera.pitch)
      const pr = (lay as { readonly camPitch?: readonly [number, number] }).camPitch ?? next.camera.pitch;
      try { stage.setPlayBounds?.(b.x, (z0 + z1) / 2, hx, (z1 - z0) / 2, pr[0], pr[1]); } catch (e) { report(e); }
    }
    // the capsule lands clear of the things (x, z, r triples)
    try {
      const xzr = new Float32Array(3 * Math.min(32, next.things.length));
      next.things.forEach((t, k) => { if (k >= 32) return; const sp = layout === 1 ? next.tall.things[k] : t; xzr[k * 3] = sp.x; xzr[k * 3 + 1] = sp.z; xzr[k * 3 + 2] = Math.max(0.3, t.size[0]); });
      stage.setObstacles?.(xzr, Math.min(32, next.things.length));
    } catch (e) { report(e); }
    // the heat point (toast browns the side facing it): the warm thing's spot IN THE LAYOUT IN USE (round 7: the wide spot was sent in the tall layout too, over the
    // look's own: the cabin's fire and Lanternroof's chimney stood elsewhere on a phone)
    const hk = next.things.findIndex((t) => !!t.zone && next.zones.find((z) => z.id === t.zone)?.kind === 6);
    if (hk >= 0) { const hs = thingSpot(hk); try { stage.setHeatPoint?.(hs[0], 0.4, hs[1]); } catch { /* ignore */ } }
    try { audio.setAmbience?.({ place: next.id, on: true }); audio.setMusicStyle?.(next.music); } catch (e) { report(e); }
    const spawn = lay.spawn === 'matLayout' ? [] : lay.spawn;
    let k = 0;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body || c.kind !== 0) continue;
      const sp = spawn[k % Math.max(1, spawn.length)] ?? [0, 0];
      k++;
      place(c, sp[0], sp[1]);
      try { c.body.setPropWorld?.(world); } catch (e) { report(e); }
      // the place's area replaces the home corral (PG_PHYS setBounds, in the body's own frame); FALLBACK without it: the corral re-homed by place() and the walls
      try { c.body.setBounds?.(b.shape === 'disc' ? 0 : 1, b.x - c.offX, b.z - c.offZ, b.shape === 'disc' ? (b.r ?? 3) : (b.hx ?? 3), b.shape === 'disc' ? 0 : (b.hz ?? 2.4), b.round ?? 0); } catch (e) { report(e); }
    }
    lifeSetPlace(w, placeIdx, visit, next, layout, 1);
    // spawned at rest: every member but the first moverCap sleeps at once (11.3)
    let woke = 0;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.body || c.kind !== 0) continue;
      if (woke < Math.max(1, att.moverCap)) { woke++; continue; }
      try { c.body.sleep?.(); } catch { /* ignore */ }
    }
    kettleArm(game.simTime);   // the kettle's first whistle 45 to 90 s after the arrival
  }
  /** put a body at rest at (x, z) on the floor (under the travel crossfade), its corral home there */
  function place(c: Char, x: number, z: number): void {
    const b = c.body!;
    try {
      if (typeof b.placeAt === 'function') { const y = b.center.y; b.placeAt({ x: x - c.offX, y, z: z - c.offZ }, { x: 0, y: 0, z: 0 }); }
      c.homeX = x; c.homeZ = z; c.lastX = x; c.lastZ = z;
      if (placeIdx === 0) { const i = chars.indexOf(c); if (i >= 0) lifeSetHome(w, i, x, z); }
    } catch (e) { report(e); }
  }

  // ---- the host ----
  const host: LifeHostApi = {
    get place() { return placeIdx; },
    get travelling() { return travelling; },
    openPlaces: () => openPlacesMask,
    travel,
    journal: () => safeView(),
    setSheet(kind, open) {
      const bit = kind === 'journal' ? 1 : 2;
      const was = sheets;
      sheets = open ? sheets | bit : sheets & ~bit;
      if (open && !(was & bit)) write(EV.UI, kind === 'journal' ? UI_KIND.JOURNAL : UI_KIND.TRAVEL, -1, 255, 255, 0, BY.PLAYER);
    },
    bubble(k, outXYR) {
      if (k < 0 || k >= 8 || slotWho[k] < 0) return null;
      if (slotStyle[k] === 0 && slotUntil[k] < game.simTime) return null;
      if (!stage.emoteScreen?.(k, outXYR)) return null;
      return { icon: slotIcon[k], wish: slotStyle[k] === 1, species: chars[slotWho[k]]?.species ?? 255 };
    },
    tapBubble(k) {
      if (k < 0 || k >= 8 || slotWho[k] < 0) return null;
      const i = slotWho[k], sp = chars[i]?.species ?? 255, wish = slotStyle[k] === 1;
      write(EV.UI, UI_KIND.EMOTE_TAP, -1, sp, 255, 0, BY.PLAYER);
      if (wish) {
        // reading a wish bubble is the wish card's "seen" (H7): the first wish names its place, the others theirs
        const wk = lifeWishOf(w, i, wishOut) ? wishOut[0] : WISH_KIND.PLACE, target = lifeWishOf(w, i, wishOut) ? wishOut[1] : 1;
        write(EV.WISH, WISH_STATE.SEEN, target, sp, 255, 1, BY.PLAYER, wk);
      }
      return { icon: slotIcon[k], wish, species: sp, kind: wish && lifeWishOf(w, i, wishOut) ? wishOut[0] : 0, target: wish && lifeWishOf(w, i, wishOut) ? wishOut[1] : -1 };
    },
    wishesNow() {
      const rows: Array<{ species: number; kind: number; target: number }> = [];
      for (let i = 0; i < CAP; i++) if (chars[i].on && lifeWishOf(w, i, wishOut)) rows.push({ species: chars[i].species, kind: wishOut[0], target: wishOut[1] });
      return rows;
    },
    act(dt) {
      if (dt > 0) weatherStep();   // (round 6: the gusts follow LIFE's clock before the props step; the bed hears each weather event)
      if (dt > 0 && world) world.beginFrame();   // (D-97: the world steps while floating too)
      steadyStep();
      pumpRestore();
      syncParty();
      // the frame changed (a rotation, a resize across aspect 0.9) or the play body's size: Home re-lays its things (a place keeps its layout until the next trip)
      if (placeIdx === 0 && !travelling) {
        const tall = frameTall(), sc = measureScale();
        if (tall !== lastTall || Math.abs(sc - lastScale) > 1e-3) { lastTall = tall; lastScale = sc; buildHome(); }
        // the Felt Ball's bounds follow the rest framing the camera eases to after a party change (visibleTable is zero-allocation): 1 Hz
        else if (world && ++boundsTick >= 60) { boundsTick = 0; try { if (stage.visibleTable?.(vis)) world.setBallBounds(vis[0], vis[1], vis[2], vis[3]); } catch { /* an old stage */ } }
      }
      kettleStep();
      showerStep();
      const t = game.simTime;
      for (let k = 0; k < qLen; k++) {
        if (qKind[k] === 0 || qDue[k] > t) continue;
        const kind = qKind[k];
        qKind[k] = 0;
        applyIntent(kind, qWho[k], qA[k], qB[k], qC[k], qD[k], qE[k], qIcon[k], qStyle[k], qDots[k]);
      }
      while (qLen > 0 && qKind[qLen - 1] === 0) qLen--;
    },
    takeAuto,
    noteEvent,
    pressAt,
    releaseAt,
    grabAt,
    dragAt,
    dropAt,
    dropAll,
    holds: (id) => handSlot(id) >= 0,
    autoThings() {
      const rows: Array<{ k: number; id: string; on: boolean; x: number; y: number }> = [];
      if (!hasAuto() || placeIdx === 0 || s.quiet || floatParked) return rows;
      const cam = stage.camera;
      if (!cam) return rows;
      for (let k = 0; k < def.things.length; k++) {
        const td = def.things[k];
        if (!hingeRide(td)) continue;
        // the anchor stands still and clear of the squishies: a swing's beam (the ropes' top, PLACES p.pivotY); above a rocker's pivot, over its riders' heads
        const sp = thingSpot(k);
        autoAt.x = sp[0]; autoAt.z = sp[1];
        autoAt.y = td.mech === MECH.swing ? (td.p.pivotY ?? 1.6) - 0.05 : (td.p.pivot ?? 0.25) + 0.65;
        let nd: { x: number; y: number } | null = null;
        try { nd = projectToNdc(cam, autoAt); } catch { nd = null; }
        if (!nd || !(Math.abs(nd.x) <= 1.05 && Math.abs(nd.y) <= 1.05)) continue;
        rows.push({ k, id: td.id, on: autoWanted.has(td.id), x: (nd.x + 1) * 0.5 * game.viewport.w, y: (1 - nd.y) * 0.5 * game.viewport.h });
      }
      return rows;
    },
    autoAvoid() {
      // (round 7: the Lanternroof shots: the hammock's chip, under its beam, stood over two of the five lanterns on a phone and over the Vane Disc on a desktop)
      const out: number[] = [], cam = stage.camera, W = world, vw = game.viewport.w, vh = game.viewport.h;
      if (!W || !cam || placeIdx === 0 || s.quiet || floatParked) return out;
      const put = (x: number, y: number, z: number, rx: number, ry: number, soft: number): void => {
        autoAt.x = x; autoAt.y = y; autoAt.z = z;
        let nd: { x: number; y: number } | null = null;
        try { nd = projectToNdc(cam, autoAt); } catch { nd = null; }
        if (nd) out.push((nd.x + 1) * 0.5 * vw, (1 - nd.y) * 0.5 * vh, rx, ry, soft);
      };
      // (a hinge ride's own seat or board: SOFT, the chip is its control and stands by it; s3run2's phone shot had the hammock's chip on the hammock's seat)
      for (let q = 0; q < W.count; q++) { const k = W.propThing[q]; if (k >= 0 && !W.isParked(q)) put(W.poses[q * 8], W.poses[q * 8 + 1], W.poses[q * 8 + 2], 22, 22, hingeRide(def.things[k]) ? 1 : 0); }
      if (vaneK >= 0) {
        // (the painted disc: its rim's offsets from its centre on screen, across and in depth, are the half sizes of its ellipse)
        const sp = thingSpot(vaneK), r0 = def.things[vaneK].size[0], n = out.length;
        put(sp[0], 0, sp[1], 0, 0, 0); put(sp[0] + r0, 0, sp[1], 0, 0, 0); put(sp[0], 0, sp[1] + r0, 0, 0, 0);
        if (out.length === n + 15) { out[n + 2] = Math.abs(out[n + 5] - out[n]); out[n + 3] = Math.abs(out[n + 11] - out[n + 1]); }
        out.length = out.length === n + 15 ? n + 5 : n;
      }
      // (and, SOFT, the squishies' faces: s3run2's Cloudloft shot had the Kite Swing's chip over Dollop's face on a pad by the swing, hiding it and taking the press.
      //  0.7 of a body's screen radius; ui/thingAuto.ts gives them up before it would hide a chip, and keeps a chip where it is while that spot stays free)
      const e = cam.matrixWorld.elements;   // (the camera's right: its first column; a body's screen radius is its rim's distance from its centre)
      for (let i = 0; i < CAP; i++) {
        const c = chars[i];
        if (!c.on || !c.body || c.view < 0) continue;
        const cx = c.body.center.x + c.offX, cy = c.body.center.y + c.offY, cz = c.body.center.z + c.offZ, n = out.length;
        put(cx, cy, cz, 0, 0, 1); put(cx + e[0] * c.r, cy + e[1] * c.r, cz + e[2] * c.r, 0, 0, 1);
        if (out.length === n + 10) { out[n + 2] = out[n + 3] = 0.7 * Math.hypot(out[n + 5] - out[n], out[n + 6] - out[n + 1]); }
        out.length = out.length === n + 10 ? n + 5 : n;
      }
      return out;
    },
    setThingAuto(k, on) {
      const td = def.things[k];
      if (!hasAuto() || !hingeRide(td)) return false;
      let ok = false;
      try { ok = world!.setAuto(k, on); } catch (e) { report(e); }
      if (!ok) return false;
      if (on) autoWanted.add(td.id); else autoWanted.delete(td.id);
      return true;
    },
    playWith(itemId, k) {
      const i = chars.findIndex((c) => c.on && c.kind === 0 && c.itemId === itemId);
      if (i < 0 || !def.things[k] || floatParked || travelling) return false;
      lifeScript(w, i, SCRIPT.PLAY_WITH, k);
      chars[i].askedT = game.simTime; chars[i].hushT = -1e9;   // (round 6, N1: an asked squishy is never hushed)
      return true;
    },
    thingsNow() {
      const rows: Array<{ k: number; id: string; ride: boolean }> = [];
      if (!world || floatParked || travelling) return rows;
      for (let k = 0; k < def.things.length; k++) {
        const td = def.things[k];
        if (placeIdx === 0 && homeShown[k] !== 1) continue;
        rows.push({ k, id: td.id, ride: !!td.ride });
      }
      return rows;
    },
    partyNow() {
      const rows: Array<{ itemId: string; species: number; play: boolean }> = [];
      for (let i = 0; i < CAP; i++) { const c = chars[i]; if (c.on && c.kind === 0 && c.itemId) rows.push({ itemId: c.itemId, species: c.species, play: c.body === bodies.body }); }
      return rows;
    },
    beforeCut() {
      // 11.4 (D-16, SH-03; round 5, VERDICT_PG B2): the party stays when the play squishy is cut; first every untouched whole but the play squishy
      // sleeps (its units make room for the pieces: med 5 pieces 1.10 + 3 sleepers 0.09 = 1.19 against 1.49). Nobody goes back to the shelf.
      for (let i = 0; i < CAP; i++) {
        const c = chars[i];
        if (!c.on || c.kind !== 0 || !c.body || c.body === bodies.body) continue;
        const m = c.body.metrics;
        if (m.fingers > 0 || m.grabbed || m.carried === true || c.tossed) continue;
        try { c.body.sleep?.(); } catch { /* a mock */ }
      }
      return 0;
    },
    frameThumb: () => frame.read(),
    pieceCap() {
      // pieces = min(the tier's pieces cap, the characters cap - (wholes - 1)) while 2 or more wholes are out (the cut squishy counts as its whole);
      // one squishy out keeps the published safety ceiling (null)
      const wholes = wholesOut() + (cutGroup >= 0 ? 1 : 0);
      if (wholes < 2) return null;
      let t = 1;
      try { t = TIER_IDX[stage.stats().tier] ?? 1; } catch { t = 1; }
      return Math.max(2, Math.min(CHAR_CAP.pieces[t], CHAR_CAP.chars[t] - (wholes - 1)));
    },
    sense(dt) {
      if (dt > 0 && world) { world.endFrame(dt); drainProps(); heldVoices(); }
      if (finaleOff >= 0 && game.simTime >= finaleOff) { finaleOff = -1; try { stage.thingFx?.(-1, 2, 0); } catch { /* none */ } }
      fillSnapshot(dt);
      wakeClaim = 0;   // (the snapshot's units now show every body woken before it)
      scripts();
      lifeStep(w, s, out, ev);
      s.nBumps = 0;
      for (let k = 0; k < out.n; k++) {
        const kind = out.kind[k], who = out.who[k], delay = out.delayS[k];
        if (delay > 0.0005) queue(kind, who, delay, out.a[k], out.b[k], out.c[k], out.d[k], out.e[k], out.icon[k], out.style[k], out.dots[k]);
        else applyIntent(kind, who, out.a[k], out.b[k], out.c[k], out.d[k], out.e[k], out.icon[k], out.style[k], out.dots[k]);
      }
      pumpEvents();
      overBudget();
      // the looks LIFE integrates (frost, wet, soak, sand, snow, toast) onto the bodies (only where a place gives them: at Home they stay 0)
      if (placeIdx !== 0) for (let i = 0; i < CAP; i++) {
        const c = chars[i];
        if (!c.on || c.view < 0) continue;
        lifeLooks(w, i, looks);
        try { stage.setBodyLook?.(c.view, looks[0], looks[1], looks[3], looks[5], looks[4]); } catch { /* ignore */ }
      }
      if (homeThingsSoon) { homeThingsSoon = false; }
      if (dt > 0) { modsStep(); snowballStep(); vaneStep(dt); cometGaze(); }   // (round 6: a soaking foam's density for the water; the Snowball's snow on whoever it rolls into; round 7: the Vane Disc's riders)
    },
    quest() {
      if (ring.n > 0 && journal) {
        try { game.hoard.feedPlay?.(ring, game.epochNow()); } catch (e) { report(e); }
        ring.n = 0;
      }
    },
    note(kind: LifeNote, arg?: string | number | Blob) {
      switch (kind) {
        case 'photo': write(EV.PHOTO, 0, -1, chars.find((c) => c.on)?.species ?? 255, 255, wholesOut(), BY.PLAYER); frame.photo(arg); break;
        case 'emoteTap': write(EV.UI, UI_KIND.EMOTE_TAP, -1, typeof arg === 'number' ? arg : 255, 255, 0, BY.PLAYER); break;
        case 'wishSeen': write(EV.WISH, WISH_STATE.SEEN, typeof arg === 'number' ? arg : 1, chars.find((c) => c.on)?.species ?? 255, 255, 1, BY.PLAYER, WISH_KIND.PLACE); break;
        default: break;
      }
    },
    debug() {
      const v = safeView();
      return {
        life: lifeDebug(w), place: placeIdx, visit, layout, bodyScale, units: s.units, quiet: s.quiet, autonomy: s.autonomy, floatParked,
        chars: chars.map((c, i) => (c.on ? { slot: i, kind: c.kind, group: c.group, species: CATALOG[c.species]?.id ?? null, itemId: c.itemId, view: c.view, x: +c.lastX.toFixed(3), z: +c.lastZ.toFixed(3), flags: s.flags[i], asleep: c.body?.metrics.asleep === true, sub: +s.submerged[i].toFixed(3), onProp: c.body?.metrics.onProp ?? -1, rho: (() => { const m = world && c.body ? world.mods(c.body) : null; return m ? +m[4].toFixed(3) : null; })(), sx: s.sx[i] === s.sx[i] ? +(s.sx[i] * game.viewport.w).toFixed(1) : null, sy: s.sy[i] === s.sy[i] ? +(s.sy[i] * game.viewport.h).toFixed(1) : null, scoot: c.scooting, hush: c.hushT > game.simTime, looks: (() => { lifeLooks(w, i, looks); return Array.from(looks, (x) => +x.toFixed(2)); })() } : null)).filter(Boolean),
        things: def.things.map((t, k) => {
          const p = thingFirst[k] ?? -1, at = !!world && p >= 0;
          // (its centre on screen in CSS px, for the harness's taps: the stage camera's projection, dev view only)
          let sx: number | null = null, sy: number | null = null;
          if (at) { try { const n = projectToNdc(stage.camera, { x: world!.poses[p * 8], y: world!.poses[p * 8 + 1], z: world!.poses[p * 8 + 2] }); if (n) { sx = +((n.x + 1) * 0.5 * game.viewport.w).toFixed(1); sy = +((1 - n.y) * 0.5 * game.viewport.h).toFixed(1); } } catch { /* a mock camera */ } }
          // (round 6, dev view: every part's centre on screen too: the harness taps three different shells or bells)
          const parts: Array<[number, number, number, number]> = [];   // [sx, sy, x, z]
          if (world) for (let q = 0; q < world.count; q++) { if (world.propThing[q] !== k) continue; try { const n = projectToNdc(stage.camera, { x: world.poses[q * 8], y: world.poses[q * 8 + 1], z: world.poses[q * 8 + 2] }); if (n) parts.push([+((n.x + 1) * 0.5 * game.viewport.w).toFixed(1), +((1 - n.y) * 0.5 * game.viewport.h).toFixed(1), +world.poses[q * 8].toFixed(3), +world.poses[q * 8 + 2].toFixed(3)]); } catch { /* a mock camera */ } }
          // (and the floor spot a player sets a squishy on: its use spot, a ramp's top end, a zone's or patch's centre, else under its first prop; in the layout in use)
          let set: [number, number] | null = null, setW: [number, number] | null = null;
          try {
            const sp = layout === 1 && placeIdx !== 0 ? def.tall.things[k] : null, sc = def.unit === 'slot' ? bodyScale : 1, yaw = sp ? sp.yaw : t.yaw;
            let fx = (sp ? sp.x : t.x) * sc, fz = (sp ? sp.z : t.z) * sc;
            const use = sp ? sp.use : t.useSpot;
            const zi = t.zone ? def.zones.findIndex((z) => ownsArea(t.zone, z.id)) : -1, za = zi >= 0 ? (layout === 1 && placeIdx !== 0 ? def.tall.zones[zi] ?? def.zones[zi] : def.zones[zi]) : null;
            if (za) { fx = za.x * sc; fz = za.z * sc; }   // (its zone in the layout in use: the Rock Pool's water, the Drip Leaf's drip)
            else if (use) { fx = use[0] * sc; fz = use[1] * sc; }
            else if (t.mech === MECH.ramp) { fx -= Math.cos(yaw) * t.size[0] * 0.7; fz -= Math.sin(yaw) * t.size[0] * 0.7; }
            const n = projectToNdc(stage.camera, { x: fx, y: t.mech === MECH.ramp ? (t.p.top ?? 0.3) : 0, z: fz });
            setW = [+fx.toFixed(3), +fz.toFixed(3)];
            if (n) set = [+((n.x + 1) * 0.5 * game.viewport.w).toFixed(1), +((1 - n.y) * 0.5 * game.viewport.h).toFixed(1)];
          } catch { set = null; }
          return { id: t.id, shown: placeIdx === 0 ? homeShown[k] === 1 : true, parked: at ? world!.isParked(p) : null, x: at ? +world!.poses[p * 8].toFixed(3) : null, z: at ? +world!.poses[p * 8 + 2].toFixed(3) : null, sx, sy, parts, set, setW };
        }),
        counts: { ...counts },
        selfUsed: [...selfUsed].map((t) => THING_IDS[t] ?? t), selfReacted: [...selfReacted].map((t) => THING_IDS[t] ?? t), selfSocial: [...selfSocial].map((t) => THING_IDS[t] ?? t),
        ring: { dropped: ring.dropped }, firstPlaySent, firstWishSent, freshProfile,
        party: { held: partyHeld(), restoring: [...restoreQ], newcomer: newcomerId },
        tap: tapWhy, through: throughWhy,
        // (round 7: Lanternroof's Vane Disc as the host turns it, and the Star Scope's comet; null where the place has none)
        vane: vaneK >= 0 ? { turning: vaneTurning, poked: game.simTime - vanePokeT < VANE_POKE_S, riders: vaneRode.reduce((a, x) => a + x, 0) } : null,
        comet: cometEnd > game.simTime,
        zones: world ? def.zones.map((z, k) => [z.id, world!.zoneOn[k] ?? 1, +(z.kind === ZONE.wind ? world!.gustLevel(k) : z.wave ? world!.waveLevel(k) : 0).toFixed(3)]) : null,   // (round 6: a gust's or a wave's level now)
        auto: { api: hasAuto(), on: [...autoWanted], hands: [...handOn].filter((x) => x === 1).length },
        tune: { on: musicBoxOnUntil > game.simTime, kind: tuneKind, kettle: kettleK, kettleNext: Number.isFinite(kettleNext) ? +kettleNext.toFixed(2) : null },
        journal: v ? { stamps: v.stamps, places: v.places, firstWish: v.firstWish, done: v.quests.filter((q) => q.done).map((q) => q.id), keepsakes: v.keepsakes } : null,
      };
    },
    dispose() {
      dropAll();
      gHost.planePoint = planeAt;
      if (inPort && upPublished) inPort.pointerUp = upPublished;
      offEvents(); offCeremony(); offSettings();
      for (let i = 0; i < CAP; i++) if (chars[i].on) { clearBubbles(i); try { chars[i].body?.setPropWorld?.(null); } catch { /* ignore */ } }
      try { stage.bindProps?.(null, 0, null); stage.setAutonomyFraming?.(false); } catch { /* ignore */ }
      try { journal?.flush(); journal?.dispose(); } catch { /* ignore */ }
    },
  };
  return host;
}

/** (round 8, R8_SHELL 4) the Friendship Frame's wiring (QUESTS 6.10 / 10, PLAYGROUND_BUILD 11.15): the photo that completes X8 ("Picture of friends") is the last one
 *  the player took (Snap > Save writes the PHOTO record X8 counts: the host's note('photo', blob)); at X8's stamp its 160 x 120 JPEG thumbnail is written ONCE under
 *  its own key (ui/later-frame.ts: a lazy module of its own, imported only then); the Journal's Keepsakes page shows it in the Friendship Frame (read). `store`:
 *  node checks pass their own. */
export function createFrameWatch(storage: StorageLike | null, onStored?: () => void,
  store: (s: StorageLike | null, b: Blob) => Promise<boolean> = (s, b) => import('../ui/later-frame.ts').then((m) => m.storeFrame(s, b))): {
  photo(b: unknown): void; quest(questIdx: number): Promise<boolean>; read(): string | null;
} {
  let photo: Blob | null = null;
  const read = (): string | null => {
    try { const u = storage?.getItem(JOURNAL_FRAME_KEY) ?? null; return u && u.startsWith('data:image/jpeg;base64,') && u.length <= JOURNAL_FRAME_MAX_CHARS ? u : null; } catch { return null; }
  };
  return {
    photo(b) { photo = typeof Blob !== 'undefined' && b instanceof Blob ? b : null; },
    quest(q) {
      if (QUESTS[q]?.id !== 'X8') return Promise.resolve(false);
      const b = photo;
      photo = null;
      if (!b || read()) return Promise.resolve(false);
      return store(storage, b).then((ok) => { if (ok) onStored?.(); return ok; }, () => false);
    },
    read,
  };
}

/** the bubbles' DOM hit areas ship in this chunk (D-92): boot.ts attaches them once the host is attached */
export { attachBubbleTaps } from '../ui/wishes.ts';
/** the AUTO controls of the hinge rides (D-95 revised) ship in this chunk too: boot.ts attaches them with the bubble taps */
export { attachThingAuto } from '../ui/thingAuto.ts';

/** the life chunk's entry: build the host and attach it (boot.ts and the dev hook call this after the first frame of play) */
export function attachLifeHost(game: Game, deps: LifeHostDeps): LifeHostApi | null {
  if (game.life) return game.life as LifeHostApi;
  const h = createLifeHost(game, deps);
  game.attachLife(h);
  return h;
}
