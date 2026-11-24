// PLAYGROUND (PLAYGROUND_BUILD.md 4, 11.1, 11.14; D-58, D-69): the FIRST-LOAD side of the LIFE host. Tiny on purpose (the shell's first-load
// share is 12 KB): the seam game.ts calls from its own simStep lines, and the early log that keeps the player's events from the first frame of
// play until the life chunk (shell/later-life.ts, loaded after the first frame of play) attaches and turns them into ring records.
//
//   simStep (game.ts):  gestures -> LIFE act (life.act) -> bodies.step -> drain (life.takeAuto / life.noteEvent per SoftEvent) ->
//                       LIFE sense + think (life.sense) -> timers, feedback, cut, capsules, ceremonies -> the quest host (life.quest)
// Steps 2, 5 and 7 are their own lines in simStep, never game.onStep hooks (D-58). Until a host is attached every line is a null test, so the
// game is today's toy bit for bit.
import type { SoftBodyLike, SoftEvent } from '../contracts.ts';

/** What the life chunk's host gives the frame (shell/later-life.ts createLifeHost). */
export interface LifeHostLike {
  /** (2) apply LIFE's due intents through the one arbiter (finger > cut and ceremony > LIFE) and begin the prop world's frame; before bodies.step */
  act(dt: number): void;
  /** (4) an event of body `b` that is `auto` (LIFE's own motion, nothing the player touched or threw): the host routes it to the attention budget
   *  and returns true, and then feedback.handle and collection.feed never see it (D-62, SH-05). false = an event for feedback as today. */
  takeAuto(b: SoftBodyLike, ev: SoftEvent): boolean;
  /** (4) every other event of body `b` (the player's touches: the touch kinds, the TOUCH records, the toss state) */
  noteEvent(b: SoftBodyLike, ev: SoftEvent): void;
  /** (5) end the prop world's frame, fill the snapshot, lifeStep, express; after drain */
  sense(dt: number): void;
  /** (7) drain the play-event ring into the journal (collection.feedPlay); after the ceremonies */
  quest(): void;
  /** the shell's own moments the host turns into records (a capsule opened, a ceremony ended, the Snap shutter) */
  note(kind: LifeNote, arg?: string | number | Blob): void;
  /** a Hand press (CSS px over the canvas) and its release: a short still press that hits no squishy and lands on a shown thing taps it (a ball
   *  rolls, the Music Box plays, the fireplace switches; one USE record by PLAYER). The press still goes to the gesture machine as before. */
  pressAt(id: number, x: number, y: number): void;
  /** true when the release made a thing tap */
  releaseAt(id: number, x: number, y: number): boolean;
  /** D-95 (revised): a Hand press on a hinge ride's seat or board (the swing, the rocker) with no squishy in front: the hand takes it (physics grabProp).
   *  true = the press is the host's until dropAt (the gesture machine never sees it, so it never turns the view) */
  grabAt?(id: number, x: number, y: number, noRide?: boolean): boolean;
  /** (round 15) a hand resting on a ride gives its finger back (a second finger came down: a pinch) */
  yieldHand?(): { id: number; x: number; y: number } | null;
  /** the pointer of a held seat or board moved: the hand pulls or pushes it; true when `id` is the host's */
  dragAt?(id: number, x: number, y: number): boolean;
  /** the pointer of a held seat or board was let go (x, y NaN: a cancel): it swings on from the hand's motion; true when it was the host's */
  dropAt?(id: number, x: number, y: number): boolean;
  /** every hand lets go (a cancel of all input, releaseEverything, a trip); true when one held something */
  dropAll?(): boolean;
  /** the host holds pointer `id` (a seat or board in the hand; round 14: a second finger's carry) */
  holds?(id: number): boolean;
  /** (round 14, R14_CARRY, D-105) the forgiving grab: a press that hit no squishy, where squishies are carried: the squishy it lands just beside (within a small
   *  margin of its silhouette; at least a 44 px target): the mat body, null for the play squishy, undefined for none (game.ts pickBody keeps the last body) */
  nearBody?(x: number, y: number): import('./bodies.ts').ExtraBody | null | undefined;
  /** round 5 (11.4, D-16, SH-03; VERDICT_PG B2): the first cut of the play squishy with the host attached: the party STAYS out (no mat clear);
   *  every untouched whole but the play squishy is put to sleep first. Returns how many squishies went back to the shelf (always 0). */
  beforeCut?(): number;
  /** the most pieces ONE cut squishy may be cut into: min(the tier's pieces cap, the characters cap - (wholes - 1)) while 2 or more wholes
   *  are out; null with one squishy out (the published safety ceiling alone, unchanged). D-103: once the life chunk's party cutter (later-cut.ts) is in,
   *  the Cut tool's cap is the PARTY's piece budget (Cutter.budget), shared by every cut squishy; this stays for a game without that cutter */
  pieceCap?(): number | null;
  /** the dev hook's view (allocates: dev only) */
  debug(): unknown;
  dispose(): void;
}

export type LifeNote = 'capsule' | 'ceremonyStart' | 'ceremonyEnd' | 'photo' | 'cut' | 'whole' | 'emoteTap' | 'journal' | 'travelSheet' | 'wishSeen';

/** What the screens (the Journal, Travel: later-* chunks) ask the host. Types only here: no first-load bytes. */
export interface LifeHostApi extends LifeHostLike {
  /** the place idx shown now (0 = Home) */
  readonly place: number;
  /** a trip is under way (Packing up, the crossfade) */
  readonly travelling: boolean;
  /** the places open (a bit per place idx; Home always) */
  openPlaces(): number;
  /** go to a place id ('home' = Home): the Travel sheet's path (whenIdle, leaving, the loads, the crossfade, the party spawned at rest);
   *  resolves true on arrival, false when it could not (the player stays where they were) */
  travel(placeId: string, devAny?: boolean): Promise<boolean>;
  /** the journal's read model (allocates: screens only), or null before the journal attached */
  journal(): import('../collection/types.ts').JournalView | null;
  /** the Journal or Travel sheet is open (LIFE goes quiet) */
  setSheet(kind: 'journal' | 'travel', open: boolean): void;
  /** (round 8) the Friendship Frame's photo: the X8 photo's thumbnail (a JPEG data URL, ui/later-frame.ts), or null while none is stored */
  frameThumb?(): string | null;
  /** the open wishes of the characters out now: [species idx, wish kind, target] per row (allocates: screens only) */
  wishesNow(): Array<{ species: number; kind: number; target: number }>;
  /** the bubble in stage slot k (0..7): its centre and radius in CSS px into out[0..2], its icon, whether it is a wish; null when empty (the 44 px hit areas, 250 ms) */
  bubble(k: number, out: Float32Array): { icon: number; wish: boolean; species: number } | null;
  /** the player tapped the bubble in slot k: UI EMOTE_TAP (H6) and, for a wish, WISH SEEN (H7); null when it is gone */
  tapBubble(k: number): { icon: number; wish: boolean; species: number; kind: number; target: number } | null;
  /** D-95 (revised): the AUTO toggles of the place shown: its hinge rides (the swing, the rocker), each with its place-local index, thing id, state and the
   *  anchor of its control in CSS px over the canvas (the floor at the thing's foot); [] while LIFE is quiet (a sheet, a ceremony, travel, a non-Hand tool) or
   *  when physics has no AUTO (allocates: the control's 250 ms placement only) */
  autoThings(): Array<{ k: number; id: string; on: boolean; x: number; y: number }>;
  /** round 7: the spots an AUTO chip must not cover, [x, y, rx, ry, soft] after another (an ellipse's centre and half sizes, CSS px over the canvas; soft 1 = a
   *  squishy's face or a hinge ride's own seat, given up before a chip would be hidden): every part of the place's things, a flush thing's painted disc
   *  (Lanternroof's Vane Disc) and every squishy out; [] when none (allocates: the 250 ms placement only) */
  autoAvoid?(): number[];
  /** the player switches AUTO of place-local thing k (a hinge ride) on or off; false when it cannot (no such ride, no AUTO in physics) */
  setThingAuto(k: number, on: boolean): boolean;
  /** "Go play with..." (11.8; the name tag popover's entry, the dev hook until it is built): the squishy with this item id plays with place-local thing k
   *  next (LIFE's PLAY_WITH, which works with autonomy off; a ride is reached by physics' carryTo, never paid); false when no such squishy or thing */
  playWith?(itemId: string, k: number): boolean;
  /** round 5 (B3): the things of the place shown that a squishy can be asked to play with now (place-local index, thing id, a ride or not);
   *  allocates (the name tag popover only) */
  thingsNow?(): Array<{ k: number; id: string; ride: boolean }>;
  /** round 5 (B3): the wholes out now (item id, species idx; `play` = the play squishy), in LIFE slot order; allocates (UI only) */
  partyNow?(): Array<{ itemId: string; species: number; play: boolean }>;
}

/** Raw early events (before the host attached): what the host needs to write TOUCH and CAPSULE records for them. At most EARLY_CAP; the rest
 *  are counted. Typed arrays, so recording one allocates nothing. */
export const EARLY_CAP = 32;
export interface EarlyLog {
  n: number;
  dropped: number;
  /** 1 a release (a squeeze ended: v = heldFor s), 2 a snap (a stretch ended: v = the pull level), 3 a capsule opened */
  kind: Uint8Array;
  v: Float32Array;
  /** the catalog species idx of the body (255 none) */
  species: Uint8Array;
}
export function createEarlyLog(): EarlyLog {
  return { n: 0, dropped: 0, kind: new Uint8Array(EARLY_CAP), v: new Float32Array(EARLY_CAP), species: new Uint8Array(EARLY_CAP) };
}
export function noteEarly(log: EarlyLog, kind: number, v: number, species: number): void {
  if (log.n >= EARLY_CAP) { log.dropped++; return; }
  const i = log.n++;
  log.kind[i] = kind; log.v[i] = Number.isFinite(v) ? v : 0; log.species[i] = species >= 0 && species < 255 ? species : 255;
}
