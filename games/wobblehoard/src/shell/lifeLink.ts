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
  note(kind: LifeNote, arg?: string | number): void;
  /** a Hand press (CSS px over the canvas) and its release: a short still press that hits no squishy and lands on a shown thing taps it (a ball
   *  rolls, the Music Box plays, the fireplace switches; one USE record by PLAYER). The press still goes to the gesture machine as before. */
  pressAt(id: number, x: number, y: number): void;
  /** true when the release made a thing tap */
  releaseAt(id: number, x: number, y: number): boolean;
  /** D-95 (revised): a Hand press on a hinge ride's seat or board (the swing, the rocker) with no squishy in front: the hand takes it (physics grabProp).
   *  true = the press is the host's until dropAt (the gesture machine never sees it, so it never turns the view) */
  grabAt?(id: number, x: number, y: number): boolean;
  /** the pointer of a held seat or board moved: the hand pulls or pushes it; true when `id` is the host's */
  dragAt?(id: number, x: number, y: number): boolean;
  /** the pointer of a held seat or board was let go (x, y NaN: a cancel): it swings on from the hand's motion; true when it was the host's */
  dropAt?(id: number, x: number, y: number): boolean;
  /** every hand lets go (a cancel of all input, releaseEverything, a trip); true when one held something */
  dropAll?(): boolean;
  /** the host holds pointer `id` (a seat or board in the hand) */
  holds?(id: number): boolean;
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
  /** the player switches AUTO of place-local thing k (a hinge ride) on or off; false when it cannot (no such ride, no AUTO in physics) */
  setThingAuto(k: number, on: boolean): boolean;
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
