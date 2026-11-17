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
// FALLBACKS for what PG_PHYS round 3 did not build (PG_PHYS.md section 6), each marked FALLBACK below and listed in PG_SHELL.md:
//   SoftEvent.auto      -> the host decides: a land of a body LIFE drove in the last 2 s that nobody touches or threw; a bump while nobody touches
//                          any body and some body was LIFE-driven in the last 2 s (ev.auto wins whenever physics sets it)
//   SoftEvent.other     -> a body bump's partner = the nearest other character to the contact point
//   metrics.contacts    -> a touching pair = two characters whose centres are closer than r1 + r2 + 0.02 m
//   setBounds / setHome -> the body's own mat corral, re-homed where LIFE last brought it to rest (setHome when physics offers it, else the
//                          corral's home spot the constructor and placeAt write); places keep bodies in with their walls
//   carryTo             -> "Go play with..." on a ride and LIFE's USE intent do nothing (no scripted lift exists)
import type { LifeEvents, LifeIntents, LifeSnapshot, PlayEventRing, SoftBodyLike, SoftEvent, V3 } from '../contracts.ts';
import type { Game } from './game.ts';
import type { LifeHostApi, LifeNote } from './lifeLink.ts';
import type { Genome } from '../core/genome.ts';
import { pitchRatio } from '../core/genome.ts';
import type { StorageLike } from '../core/settings.ts';
import type { StorageSubscribe } from '../core/save.ts';
import { createLifeWorld, lifeSetPlace, lifeSetHome, lifeAdd, lifeRemove, lifeStep, lifeScript, lifeSetJournal, lifeSetPair, lifeSetFriends,
  lifeLooks, lifeWishOf, lifePhrase, lifeAttention, lifeDebug, lifeSetHops, attentionSound, PHRASE } from '../life/step.ts';
import type { LifeWorld } from '../life/step.ts';
import { buildPropWorld } from '../physics/props.ts';
import type { PropWorld } from '../physics/props.ts';
import { PLACE as HOME } from '../data/place_home.ts';
import { PLACE_INFO, THING_IDS, THING_KINDS, loadPlaceDef, MECH } from '../data/places.ts';
import type { PlaceDef, PlaceId, ThingDef } from '../data/places.ts';
import { INTENT, LIFE_FLAG, LIFE_EV, SCRIPT, TOUCH, WISH_KIND, SPECIES_LIFE } from '../data/life.ts';
import { EV, BY, WISH_STATE, UI_KIND, EV_FLAG, QUESTS } from '../data/quests.ts';
import { CATALOG, speciesIdx, familyOf } from '../data/catalog.ts';
import { MATERIAL_FAMILY_IDS } from '../data/materials.ts';
import { attachJournal } from '../collection/journal_store.ts';
import type { JournalRuntime } from '../collection/journal_store.ts';
import type { CollectionEvent, JournalView } from '../collection/types.ts';
import { HOME_TEXT } from '../data/quests.ts';

const CAP = 16;          // characters (LIFE's world)
const QCAP = 64;         // queued (delayed) intents
const RING_CAP = 64;     // the play-event ring (QUESTS 4)
const AUTO_WINDOW_S = 2; // FALLBACK auto: a body LIFE drove this recently
const FIRST_PLAY_S = 6, FIRST_WISH_S = 60, FIRST_WISH_LATEST_S = 300;
const HOP_LEAD_S = 0.12; // a HOP's anticipation squash comes this long before the impulse (LIFE act.ts)
const HOP_GO = 200;      // an internal queued kind: the hop impulse itself
/** Home's things by THING_IDS index: what each one arrives after (PLACES 4.1) */
const THING_FELT = 0, THING_MUSIC = 1, THING_RUG = 2, THING_LAMP = 3, THING_SHELF = 4, THING_PAD = 5;
/** the cut flavour index (audio/cut.ts CUT_FLAVOURS: gel, sticky, foam, beads, dough, firm) of each material family (MATERIAL_FAMILY_IDS order) */
const FLAVOUR_OF: Readonly<Record<string, number>> = { jellygel: 0, gummy: 0, waterfill: 0, stickystretch: 1, slimegoo: 1, slowrise: 2, marshmallow: 2, beadsqueeze: 3, putty: 4, mochidough: 4, firmsilicone: 5, popdome: 5 };

export interface LifeHostDeps {
  storage: StorageLike | null;
  subscribe?: StorageSubscribe;
  /** say a polite live line (the announcer) */
  say?(text: string): void;
  /** a small toast for a moment (a new stamp, a place open) */
  moment?(text: string): void;
  /** the quest-complete haptic (only when the player completed it: D-84) */
  stampHaptic?(): void;
  /** a phone: a coarse pointer or the short side under 600 CSS px (LifeSnapshot.phone) */
  phone?(): boolean;
  /** prefers-reduced-motion */
  reducedMotion?(): boolean;
  /** the journal store's timers (node checks pass none: then it writes at once) */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

interface Char {
  on: boolean; body: SoftBodyLike | null; genome: Genome | null; itemId: string | null; view: number;
  kind: 0 | 1 | 2; group: number; species: number; family: number; flavour: number; pitch: number; frac: number; r: number;
  offX: number; offY: number; offZ: number;
  lastX: number; lastZ: number; vx: number; vz: number;
  homeX: number; homeZ: number;
  outAt: number;          // sim time it came out (FIRST_WISH's "out longest")
  driveT: number;         // sim time LIFE last drove it (scoot or hop): the FALLBACK auto window
  scooting: boolean; scootX: number; scootZ: number;
  tossed: boolean; wasCarried: boolean; touchKind: number; asleepShown: boolean;
  rideUntil: number;      // RIDE (D-74)
}
const mkChar = (): Char => ({ on: false, body: null, genome: null, itemId: null, view: -1, kind: 0, group: -1, species: 255, family: 0, flavour: 0, pitch: 1, frac: 1, r: 0.5,
  offX: 0, offY: 0, offZ: 0, lastX: 0, lastZ: 0, vx: 0, vz: 0, homeX: 0, homeZ: 0, outAt: 0, driveT: -1e9, scooting: false, scootX: 0, scootZ: 0,
  tossed: false, wasCarried: false, touchKind: -1, asleepShown: false, rideUntil: -1e9 });

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

/** Build the LIFE host and attach it to the game (game.attachLife). Returns null when the game cannot host it (no stage camera). */
export function createLifeHost(game: Game, deps: LifeHostDeps): LifeHostApi {
  const stage = game.stage, audio = game.audio, bodies = game.bodies;
  const w: LifeWorld = createLifeWorld(0x5eed1e, CAP);
  const s = mkSnapshot(), out = mkIntents(), ev = mkEvents(), ring = mkRing();
  const att = lifeAttention(w);
  const chars: Char[] = Array.from({ length: CAP }, mkChar);
  const report = (e: unknown): void => { console.error(e); };
  lifeSetHops(w, 0);   // S1: every family at the S1 hop cap (LIFE 5.2)

  // ---- the queued intents (a delayed hop or voice): typed arrays, no allocation ----
  const qKind = new Uint8Array(QCAP), qWho = new Uint8Array(QCAP), qDue = new Float64Array(QCAP), qA = new Float32Array(QCAP), qB = new Float32Array(QCAP),
    qC = new Float32Array(QCAP), qD = new Float32Array(QCAP), qE = new Float32Array(QCAP), qIcon = new Uint8Array(QCAP), qStyle = new Uint8Array(QCAP), qDots = new Uint8Array(QCAP);
  let qLen = 0;
  const phraseBuf = new Float32Array(16);
  const creatureP = { phrase: phraseBuf, n: 0, flavour: 0, register: 0, pitch: 1, pan: 0, level: 1, group: 1, echo: false, at: 0, sing: false };
  const thudP = { kind: 0, intensity: 0, pitch: 1, pan: 0 };
  const propP = { kind: 0, intensity: 0, note: 0, pan: 0, auto: true, size: 0.22 };
  const scr = new Float32Array(4);
  const looks = new Float32Array(6);
  const vis = new Float32Array(4);
  const wishOut = new Int32Array(2);
  const strikes = new Float32Array(32 * 4);

  // ---- the place: Home's world now, a place's world after a trip ----
  let placeIdx = 0, visit = 1, layout: 0 | 1 = 0, bodyScale = 1;
  let def: PlaceDef = HOME;
  let world: PropWorld | null = null;
  let thingFirst = new Int16Array(0);      // per place-local thing: its first prop (-1: none, a patch thing)
  let thingGlobal = new Int16Array(0);     // per place-local thing: its THING_IDS index
  const homeShown = new Uint8Array(8);     // Home's things shown now
  let travelling = false;
  let floatParked = false;                 // the Float rule (D-83): Float with one squishy at Home binds no prop world
  let groundSaid = false;

  // ---- the journal, the ring and the moments ----
  let journal: JournalRuntime | null = null;
  try { journal = attachJournal(game.hoard, { storage: deps.storage, subscribe: deps.subscribe, setTimer: deps.setTimer, clearTimer: deps.clearTimer }); } catch (e) { report(e); }
  const owned = new Uint32Array(2), favKnown = new Uint32Array(4), friendMask = new Uint32Array(2);
  let openPlacesMask = 1;
  const wishKindOf = new Int32Array(CAP), wishTargetOf = new Int32Array(CAP).fill(-1);
  let sheets = 0;                          // bit 0 the Journal, bit 1 Travel (LIFE goes quiet)
  let attachT = -1;                        // sim time the host attached (FIRST_WISH's 5:00)
  let firstReleaseT = -1, firstRevealT = -1, firstPlaySent = false, firstWishSent = false, freshProfile = false;
  let touchingNow = false;
  let lastCeremony: 'capsule' | 'merge' | null = null;

  const write = (kind: number, sub: number, thing: number, a: number, b: number, n2: number, by: number, v = 0, flag = 0): void => {
    if (ring.n >= ring.kind.length) { ring.dropped++; return; }
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
  function addChar(b: SoftBodyLike, g: Genome, itemId: string | null, off: V3, kind: 0 | 1 | 2, group: number): number {
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
    c.outAt = game.simTime; c.driveT = -1e9; c.scooting = false; c.tossed = false; c.wasCarried = false; c.touchKind = -1; c.asleepShown = false; c.rideUntil = -1e9;
    try { (b as { contactSlot?: number }).contactSlot = i; } catch { /* a mock */ }
    if (world && !floatParked) { try { b.setPropWorld?.(world); } catch (e) { report(e); } }
    let warm = 0;
    try { warm = itemId ? Math.min(5, Math.floor((game.hoard.warmthOf?.(itemId) ?? 0))) : 0; } catch { warm = 0; }
    lifeAdd(w, i, g, kind, c.group, warm, false);
    if (placeIdx === 0 && kind === 0) lifeSetHome(w, i, c.homeX, c.homeZ);
    return i;
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
  /** bring the registry in line with the bodies on the mat (allocates only when something changed: a squishy out or back, a cut, a join) */
  function syncParty(): void {
    if (!partyChanged()) return;
    const cutNow = game.cut.pieces > 1;
    const playId = game.identity.itemId;
    // the bodies now (the play body first)
    const list: Array<{ b: SoftBodyLike; g: Genome; id: string | null; off: V3; piece: boolean }> = [{ b: bodies.body, g: game.identity.genome, id: playId, off: { x: 0, y: 0, z: 0 }, piece: cutNow }];
    for (const x of bodies.extras) list.push({ b: x.body, g: x.genome, id: x.itemId ?? (x.piece ? playId : null), off: x.position, piece: !!x.piece || game.cut.isPiece(x.body) });
    // gone: off the mat, or replaced (a cut swaps the play body for its pieces; whole again swaps a fresh body in)
    let wholeCut = -1;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || list.some((e) => e.b === c.body)) continue;
      if (cutNow && c.kind === 0 && c.itemId !== null && c.itemId === playId) wholeCut = i;   // the whole that was cut: its slot is its pieces' group key
      removeChar(i);
    }
    if (wholeCut >= 0) cutGroup = wholeCut;
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
      else addChar(e.b, e.g, e.id, e.off, 0, -1);
    }
    afterPartyChange();
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
      c.view = bodies.viewIdOf(c.body) ?? c.view;
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

  // ---- the Float rule (D-83): Float at Home with one squishy out; otherwise gravity is forced at run time (the saved setting never changes) ----
  function floatRule(): void {
    const wantFloat = !game.settings.gravity;
    const lone = wholesOut() <= 1 && placeIdx === 0 && cutGroup < 0;
    const parkNow = wantFloat && lone;
    if (wantFloat && !lone) {
      for (const c of chars) if (c.on && c.body && !c.body.gravity) { try { c.body.gravity = true; } catch { /* ignore */ } }
      try { stage.setFloatMode(false); } catch { /* ignore */ }
      if (!groundSaid) { groundSaid = true; deps.say?.('Here your squishies stand on the ground.'); }
    }
    if (parkNow !== floatParked) {
      floatParked = parkNow;
      for (const c of chars) if (c.on && c.body) { try { c.body.setPropWorld?.(parkNow ? null : world); } catch { /* ignore */ } }
      try { stage.bindProps?.(parkNow || !world ? null : world.poses, parkNow || !world ? 0 : world.count, parkNow || !world ? null : world.propThing); } catch (e) { report(e); }
      if (placeIdx === 0) homeThings();
    }
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
      case THING_PAD: return false;                                  // pads ship in S2
      default: return false;
    }
  }
  function homeThings(): void {
    if (placeIdx !== 0 || !world) return;
    const tall = layout === 1, n = Math.max(1, wholesOut());
    for (let k = 0; k < HOME.things.length; k++) {
      const t = HOME.things[k], spot = tall ? HOME.tall.things[k] : null;
      const fromN = (spot ? spot.fromN : t.fromN) ?? 1;
      const show = !floatParked && arrived(k) && n >= fromN;
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
    for (const c of chars) if (c.on && c.body && !floatParked) { try { c.body.setPropWorld?.(world); } catch (e) { report(e); } }
    try { if (!floatParked) stage.bindProps?.(world.poses, world.count, world.propThing); } catch (e) { report(e); }
    lifeSetPlace(w, 0, visit, HOME, layout, bodyScale);
    for (let i = 0; i < CAP; i++) if (chars[i].on && chars[i].kind === 0) lifeSetHome(w, i, chars[i].homeX, chars[i].homeZ);
    homeThings();
  }
  function mapThings(): void {
    const nt = def.things.length;
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
  function applyIntent(kind: number, i: number, a: number, b: number, cc: number, d: number, e: number, icon: number, style: number, dots: number): void {
    const c = chars[i];
    if (!c.on || !c.body) return;
    const body = c.body;
    switch (kind) {
      case INTENT.SCOOT:
        if (floatParked) return;
        try { if (body.scootTo?.(a - c.offX, b - c.offZ, cc)) { c.driveT = game.simTime; c.scooting = true; c.scootX = a; c.scootZ = b; } } catch (x) { report(x); }
        return;
      case INTENT.HOP:
        if (floatParked) return;
        if (d < 0.999) { try { body.setSquash?.(d, 0.08); } catch (x) { report(x); } queue(HOP_GO, i, HOP_LEAD_S, a, b, cc, 0, 0, 0, 0, 0); }
        else doHop(i, a, b, cc);
        return;
      case HOP_GO: try { body.setSquash?.(1, 0.08); } catch { /* ignore */ } doHop(i, a, b, cc); return;
      case INTENT.SQUASH: if (!floatParked) { try { body.setSquash?.(a, b); } catch (x) { report(x); } } return;
      case INTENT.POSE: if (c.view >= 0) { try { stage.setBodyPose?.(c.view, a, b, cc, d, e); } catch (x) { report(x); } } return;
      case INTENT.GLIDE: if (!floatParked) { try { body.nudge({ x: a, y: 0, z: b }); c.driveT = game.simTime; } catch (x) { report(x); } } return;
      case INTENT.SETTLE: endScoot(i); return;
      case INTENT.CANCEL:
        for (let k = 0; k < qLen; k++) if (qWho[k] === i) qKind[k] = 0;
        endScoot(i);
        try { body.setSquash?.(1, 0.12); } catch { /* ignore */ }
        return;
      case INTENT.GAZE:
        if (c.view < 0) return;
        try {
          if (Number.isNaN(a)) { const p = stage.camera.position; stage.setBodyGaze?.(c.view, p.x, p.y, p.z, d > 0 ? d : 1); }
          else stage.setBodyGaze?.(c.view, a, b, cc, d);
        } catch (x) { report(x); }
        return;
      case INTENT.EXPRESS: if (c.view >= 0) { try { stage.setBodyExpression?.(c.view, a, b); } catch (x) { report(x); } } return;
      case INTENT.EMOTE: showEmote(i, icon, style, dots, a | 0); return;
      case INTENT.VOICE: voice(i, a, b, cc, icon); return;
      case INTENT.USE: return;   // FALLBACK: a player-asked use on a ride needs carryTo, which physics has not built
      default: return;
    }
  }
  function doHop(i: number, vx: number, vy: number, vz: number): void {
    const c = chars[i];
    try { if (c.body?.hop?.(vx, vy, vz)) c.driveT = game.simTime; } catch (x) { report(x); }
  }
  function endScoot(i: number): void {
    const c = chars[i];
    if (!c.body) return;
    if (c.scooting) { try { c.body.scootTo?.(NaN, 0, 0); } catch { /* ignore */ } }
    c.scooting = false;
    rehome(i);
  }
  /** FALLBACK for setHome (PG_PHYS has not built it): the corral's home moves to where LIFE brought the body to rest, so it never glides it back */
  function rehome(i: number): void {
    const c = chars[i], b = c.body as (SoftBodyLike & { homeX?: number; homeZ?: number }) | null;
    if (!b) return;
    const x = b.center.x, z = b.center.z;
    try {
      if (typeof b.setHome === 'function') b.setHome(x, z);
      else if (typeof b.homeX === 'number' && typeof b.homeZ === 'number') { b.homeX = x; b.homeZ = z; }   // FALLBACK: the corral's own home spot (softbody.ts: the constructor and placeAt write it)
    } catch { /* a mock */ }
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
    creatureP.n = n; creatureP.flavour = c.flavour; creatureP.register = register > 0 ? 1 : 0; creatureP.pitch = c.pitch;
    creatureP.pan = sx === sx ? Math.max(-1, Math.min(1, (sx * 2 - 1) * 0.7)) : 0;
    creatureP.level = sx === sx ? Math.max(0.4, 1 - Math.hypot(sx - 0.5, s.sy[i] - 0.5)) : 0.5;
    creatureP.group = Math.max(1, Math.min(3, group | 0)); creatureP.at = 0;
    creatureP.sing = phrase === PHRASE.SING || phrase === PHRASE.DUET;
    try { audio.creature(creatureP); } catch (x) { report(x); }
  }

  // ---- auto events and the player's touches (drain) ----
  function anyTouched(): boolean {
    for (let i = 0; i < CAP; i++) { const c = chars[i]; if (!c.on || !c.body) continue; const m = c.body.metrics; if (m.fingers > 0 || m.grabbed || m.carried === true || c.tossed) return true; }
    return false;
  }
  function takeAuto(b: SoftBodyLike, e: SoftEvent): boolean {
    if (e.kind !== 'land' && e.kind !== 'bump') return false;
    const i = slotOfBody(b);
    const t = game.simTime;
    let auto: boolean;
    const flag = (e as { auto?: boolean }).auto;
    if (flag !== undefined) auto = flag;   // physics knows (PLAYGROUND 8.8)
    else if (e.kind === 'land') {
      // FALLBACK: a land of a body LIFE drove lately that nobody touches and nobody threw
      const c = i >= 0 ? chars[i] : null;
      auto = !!c && t - c.driveT < AUTO_WINDOW_S && !c.tossed && b.metrics.fingers === 0 && !b.metrics.grabbed && b.metrics.carried !== true;
    } else {
      // FALLBACK: a bump while nobody touches or threw any body and some body was LIFE-driven lately
      let driven = false;
      for (let k = 0; k < CAP; k++) if (chars[k].on && t - chars[k].driveT < AUTO_WINDOW_S) { driven = true; break; }
      auto = driven && !anyTouched();
    }
    if (e.kind === 'land' && i >= 0) chars[i].tossed = false;
    if (!auto) return false;
    // the attention budget: a soft thud at most (never a haptic, never a shake, never the meter)
    try {
      if (attentionSound(att, s) && audio.autoThud) {
        thudP.kind = e.kind === 'land' ? 0 : 1; thudP.intensity = e.intensity; thudP.pitch = i >= 0 ? chars[i].pitch : 1; thudP.pan = i >= 0 && s.sx[i] === s.sx[i] ? (s.sx[i] * 2 - 1) * 0.7 : 0;
        audio.autoThud(thudP);
      }
    } catch (x) { report(x); }
    if (e.kind === 'bump' && i >= 0 && s.nBumps < 32) {
      // FALLBACK for SoftEvent.other: the partner is the nearest other character to the contact point
      let best = -1, bd = 1e9;
      for (let k = 0; k < CAP; k++) {
        if (k === i || !chars[k].on) continue;
        const dx = chars[k].lastX - (e.at.x + chars[i].offX), dz = chars[k].lastZ - (e.at.z + chars[i].offZ), d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) { s.bumpA[s.nBumps] = i; s.bumpB[s.nBumps] = best; s.nBumps++; }
    }
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
      if (c.wasCarried && !carried) c.tossed = true;   // a carry let go: a toss until it lands
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
      if (c.tossed) f |= LIFE_FLAG.TOSSED;
      if (s.sx[i] === s.sx[i]) f |= LIFE_FLAG.VISIBLE;
      if (m.memoryBusy === true) f |= LIFE_FLAG.MEMORY_BUSY;
      // RIDE (D-74): a body the player set down on a ride prop stays on it 20 s
      if (onProp >= 0 && world && c.tossed === false && (f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) === 0) {
        const th = onProp < world.count ? world.propThing[onProp] : -1;
        if (th >= 0 && def.things[th]?.ride && c.rideUntil < t - 25) c.rideUntil = t + 20;
      }
      if ((f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) c.rideUntil = -1e9;
      if (c.rideUntil > t) f |= LIFE_FLAG.RIDE;
      s.flags[i] = f;
      if ((f & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED)) !== 0) touching = true;
      s.touchKind[i] = c.touchKind; c.touchKind = -1;
      zonesAt(i, x, z);
      s.submerged[i] = m.submerged ?? 0;
      s.warmth[i] = 0;
      units += asleep ? 0.03 : c.kind === 0 ? 1 : 0.22;
      if (asleep !== c.asleepShown && c.view >= 0) { c.asleepShown = asleep; try { stage.setBodyAsleep?.(c.view, asleep); } catch { /* ignore */ } }
      // a scoot that has arrived: release the driver and re-home the corral there (FALLBACK setHome)
      if (c.scooting && Math.hypot(x - c.scootX, z - c.scootZ) < 0.05 && Math.hypot(c.vx, c.vz) < 0.02) endScoot(i);
    }
    // FALLBACK for metrics.contacts: a touching pair of awake bodies adds 0.25 (LIFE 10.3)
    for (let i = 0; i < CAP; i++) for (let j = i + 1; j < CAP; j++) {
      const a = chars[i], b = chars[j];
      if (!a.on || !b.on || (s.flags[i] & LIFE_FLAG.ASLEEP) || (s.flags[j] & LIFE_FLAG.ASLEEP)) continue;
      const dx = a.lastX - b.lastX, dz = a.lastZ - b.lastZ, rr = a.r + b.r + 0.02;
      if (dx * dx + dz * dz < rr * rr) units += 0.25;
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
        case LIFE_EV.USE: write(EV.USE, sub, thing, a, 255, n2, eb === 254 ? BY.PLAYER : BY.SELF, 0, piece); break;
        case LIFE_EV.REACT: write(EV.REACT, sub, thing, a, 255, n2, BY.SELF, 0, piece); break;
        case LIFE_EV.PIECES: write(EV.PIECES, sub, thing, a, 255, n2, BY.SELF, 0, EV_FLAG.PIECE); break;
        case LIFE_EV.SIGNATURE: write(EV.SIGNATURE, sub, thing, a, 255, n2, BY.SELF, 0, piece); break;
        case LIFE_EV.DISCOVER: write(EV.DISCOVER, sub, thing, a, 255, n2, BY.SELF, 0, piece); break;
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
      if (cause === 1 && slot >= 0 && slot < CAP && chars[slot].on && td.mech === MECH.chime) write(EV.USE, td.verb, thingGlobal[th], chars[slot].species, 255, 1, BY.SELF, world.propPart[prop]);
    }
  }

  // ---- the awake budget (D-61, D-85): over the cap, the farthest untouched LIFE mover stops and untouched still wholes sleep ----
  function overBudget(): void {
    const cap = att.unitCap + att.allowance + 0.001;
    if (!(s.units > cap)) return;
    const cx = 0, cz = 0;
    let far = -1, fd = -1;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || !c.scooting || (s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.RIDE)) !== 0) continue;
      const d = Math.hypot(c.lastX - cx, c.lastZ - cz);
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { endScoot(far); return; }
    let sl = -1, sd = -1;
    for (let i = 0; i < CAP; i++) {
      const c = chars[i];
      if (!c.on || c.kind !== 0 || !c.body || (s.flags[i] & (LIFE_FLAG.TOUCHED | LIFE_FLAG.CARRIED | LIFE_FLAG.RIDE | LIFE_FLAG.ASLEEP | LIFE_FLAG.ON_PROP)) !== 0 || c.tossed) continue;
      const d = Math.hypot(c.lastX - cx, c.lastZ - cz);
      if (d > sd) { sd = d; sl = i; }
    }
    if (sl >= 0) { try { chars[sl].body!.sleep?.(); } catch { /* ignore */ } }
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

  // ---- the collection's journal events: moments, the unlock line, friendships back into LIFE ----
  const offEvents = game.hoard.onEvent((e: CollectionEvent) => {
    try {
      switch (e.type) {
        case 'quest': {
          const title = homeQuestTitle(e.quest);
          deps.moment?.(title ? `New stamp: ${title}` : 'New stamp');
          if (e.byPlayer) deps.stampHaptic?.();
          pushJournal();
          if (placeIdx === 0) homeThings();
          break;
        }
        case 'unlock': {
          const p = PLACE_INFO.find((x) => x.idx === e.place);
          if (p && p.shipped) deps.say?.(`${p.name} is open. Find it in Places.`);
          pushJournal();
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
    if (e.type === 'start') { lastCeremony = e.kind; return; }
    if (e.type === 'end') {
      if (lastCeremony === 'capsule') { write(EV.CAPSULE, 0, -1, (() => { try { return speciesIdx(e.info.item.genome.species); } catch { return 255; } })(), 255, 1, BY.PLAYER); if (firstRevealT < 0) firstRevealT = game.simTime; }
      lastCeremony = null;
    }
  });

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
  syncParty();
  buildHome();
  try { stage.setAutonomyFraming?.(true); } catch (e) { report(e); }
  try { const v = safeView(); if (v) stage.setKeepsakes?.(v.keepsakes); } catch { /* ignore */ }
  let lastTall = frameTall(), lastScale = bodyScale;
  const offSettings = game.on('settings', () => { floatRule(); });

  // ---- travel (S1): the place picker's path (QUESTS 15, 11.7) ----
  async function travel(id: string): Promise<boolean> {
    if (travelling) return false;
    const target = PLACE_INFO.find((p) => p.id === id);
    if (!target) return false;
    if (target.idx === placeIdx) return true;
    if (target.idx !== 0 && (!target.shipped || (openPlacesMask & (1 << target.idx)) === 0)) return false;
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
      deps.say?.(target.idx === 0 ? 'You are at Home.' : `You are at ${target.name}.`);
      return true;
    } catch (e) { report(e); deps.say?.(`${target.name} did not load. Try again.`); return false; }
    finally { travelling = false; }
  }
  function enterPlace(next: PlaceDef): void {
    for (let i = 0; i < CAP; i++) if (chars[i].on) { clearBubbles(i); endScoot(i); }
    visit++;
    def = next; placeIdx = next.idx;
    if (placeIdx === 0) {
      // home again: every body back at its mat slot, Home's framing and world
      try { stage.setPlayBounds?.(NaN, NaN, NaN, NaN); } catch { /* ignore */ }
      try { audio.setAmbience?.({ place: null }); audio.setMusicStyle?.('home'); } catch (e) { report(e); }
      try { stage.setHeatPoint?.(NaN, NaN, NaN); } catch { /* ignore */ }
      const L = (stage as { matLayout?: (n: number) => V3[] }).matLayout?.(Math.max(1, wholesOut())) ?? [];
      let k = 0;
      for (let i = 0; i < CAP; i++) {
        const c = chars[i];
        if (!c.on || !c.body || c.kind !== 0) continue;
        const spot = L[k++] ?? { x: 0, y: 0, z: 0 };
        place(c, spot.x, spot.z);
      }
      homeShown.fill(0);
      buildHome();
      try { stage.setAutonomyFraming?.(true); } catch { /* ignore */ }
      return;
    }
    try { stage.setAutonomyFraming?.(false); } catch { /* ignore */ }
    layout = frameTall() ? 1 : 0;
    const lay = layout === 1 ? next.tall : next;
    world = buildPropWorld(next, layout === 1 ? 'tall' : 'wide', 1);
    mapThings();
    for (let k = 0; k < next.things.length; k++) { try { world.setParked(k, false); } catch { /* none */ } }
    try { stage.bindProps?.(world.poses, world.count, world.propThing); } catch (e) { report(e); }
    const b = lay.bounds;
    try { stage.setPlayBounds?.(b.x, b.z, b.shape === 'disc' ? (b.r ?? 3) : (b.hx ?? 3), b.shape === 'disc' ? (b.r ?? 3) : (b.hz ?? 2.4)); } catch (e) { report(e); }
    // the capsule lands clear of the things (x, z, r triples)
    try {
      const xzr = new Float32Array(3 * Math.min(32, next.things.length));
      next.things.forEach((t, k) => { if (k >= 32) return; const sp = layout === 1 ? next.tall.things[k] : t; xzr[k * 3] = sp.x; xzr[k * 3 + 1] = sp.z; xzr[k * 3 + 2] = Math.max(0.3, t.size[0]); });
      stage.setObstacles?.(xzr, Math.min(32, next.things.length));
    } catch (e) { report(e); }
    const hearth = next.things.find((t) => t.zone && next.zones.find((z) => z.id === t.zone)?.kind === 6);
    if (hearth) { try { stage.setHeatPoint?.(hearth.x, 0.4, hearth.z); } catch { /* ignore */ } }
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
      if (dt > 0 && world && !floatParked) world.beginFrame();
      syncParty();
      // the frame changed (a rotation, a resize across aspect 0.9) or the play body's size: Home re-lays its things (a place keeps its layout until the next trip)
      if (placeIdx === 0 && !travelling) {
        const tall = frameTall(), sc = measureScale();
        if (tall !== lastTall || Math.abs(sc - lastScale) > 1e-3) { lastTall = tall; lastScale = sc; buildHome(); }
      }
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
    sense(dt) {
      if (dt > 0 && world && !floatParked) { world.endFrame(dt); drainProps(); }
      fillSnapshot(dt);
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
    },
    quest() {
      if (ring.n > 0 && journal) {
        try { game.hoard.feedPlay?.(ring, game.epochNow()); } catch (e) { report(e); }
        ring.n = 0;
      }
    },
    note(kind: LifeNote, arg?: string | number) {
      switch (kind) {
        case 'photo': write(EV.PHOTO, 0, -1, chars.find((c) => c.on)?.species ?? 255, 255, wholesOut(), BY.PLAYER); break;
        case 'emoteTap': write(EV.UI, UI_KIND.EMOTE_TAP, -1, typeof arg === 'number' ? arg : 255, 255, 0, BY.PLAYER); break;
        case 'wishSeen': write(EV.WISH, WISH_STATE.SEEN, typeof arg === 'number' ? arg : 1, chars.find((c) => c.on)?.species ?? 255, 255, 1, BY.PLAYER, WISH_KIND.PLACE); break;
        default: break;
      }
    },
    debug() {
      const v = safeView();
      return {
        life: lifeDebug(w), place: placeIdx, visit, layout, bodyScale, units: s.units, quiet: s.quiet, autonomy: s.autonomy, floatParked,
        chars: chars.map((c, i) => (c.on ? { slot: i, kind: c.kind, group: c.group, species: CATALOG[c.species]?.id ?? null, itemId: c.itemId, view: c.view, x: +c.lastX.toFixed(3), z: +c.lastZ.toFixed(3), flags: s.flags[i], asleep: c.body?.metrics.asleep === true } : null)).filter(Boolean),
        things: placeIdx === 0 ? HOME.things.map((t, k) => ({ id: t.id, shown: homeShown[k] === 1 })) : def.things.map((t) => ({ id: t.id, shown: true })),
        ring: { dropped: ring.dropped }, firstPlaySent, firstWishSent, freshProfile,
        journal: v ? { stamps: v.stamps, places: v.places, firstWish: v.firstWish, done: v.quests.filter((q) => q.done).map((q) => q.id), keepsakes: v.keepsakes } : null,
      };
    },
    dispose() {
      offEvents(); offCeremony(); offSettings();
      for (let i = 0; i < CAP; i++) if (chars[i].on) { clearBubbles(i); try { chars[i].body?.setPropWorld?.(null); } catch { /* ignore */ } }
      try { stage.bindProps?.(null, 0, null); stage.setAutonomyFraming?.(false); } catch { /* ignore */ }
      try { journal?.flush(); journal?.dispose(); } catch { /* ignore */ }
    },
  };
  return host;
}

/** the bubbles' DOM hit areas ship in this chunk (D-92): boot.ts attaches them once the host is attached */
export { attachBubbleTaps } from '../ui/wishes.ts';

/** the life chunk's entry: build the host and attach it (boot.ts and the dev hook call this after the first frame of play) */
export function attachLifeHost(game: Game, deps: LifeHostDeps): LifeHostApi | null {
  if (game.life) return game.life as LifeHostApi;
  const h = createLifeHost(game, deps);
  game.attachLife(h);
  return h;
}
