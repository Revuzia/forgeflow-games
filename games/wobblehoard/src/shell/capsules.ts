// The capsule table (COLLECTION 9.4, DESIGN 6.2 / 6.3, render handover STAGE_API_FOR_SHELL 3-4).
//
//   * Credits come from the collection port. On its 'capsule' event (a capsule became ready): audio.meterFull({ quiet: mid-squeeze }),
//     haptic [10], the HUD ring pulse, and (if no capsule stands on the table) stage.dropCapsule({ onLand: haptic [18] }). The stage keeps ONE capsule on the table
//     ("another dropCapsule() replaces an unopened capsule"), so the queue of up to 5 is the HUD count; the next one drops when the
//     current one has been opened.
//   * Hold to open: a press that hits the landed capsule (CapsuleHandle.hitTest, CSS px) belongs to the capsule, not to the gestures.
//     Every frame: setSqueeze(held / 0.5 s); capsuleBeat 'grab' at the press and again at 0.18 s. At 1 it opens; a quick tap (<= 250 ms,
//     < 14 px) opens too; letting go in between cancels (setSqueeze(0)). Never while the play body is being touched.
//   * Open: collection.openCapsule() first (result first), then the ceremony with that capsule. Over 1.5 s waiting: it keeps wobbling;
//     at 10 s: "Still working. Your capsule is safe." A refusal melts back (setSqueeze 0) with the collection's message.
//   * The DOM twin (the HUD button, Enter / Space on it) calls openNext(): the 3D object is never the only way (COLLECTION 9.10).
import type { CapsuleHandle, SquishAudio, StageLike } from '../contracts.ts';
import type { Haptics } from '../input/haptics.ts';
import { CAPSULE_LAND_HAPTIC, METER_FULL_HAPTIC } from '../input/haptics.ts';
import type { Ceremonies } from './ceremonies.ts';
import type { CapsuleOutcome, MeterReading, ShellCollection } from './collectionPort.ts';

export const HOLD_TO_OPEN_MS = 500;
const TAP_MS = 250;
const TAP_SLOP_PX = 14;
const WAIT_WOBBLE_MS = 1500;
const WAIT_GIVE_UP_MS = 10000;

export interface CapsuleUi {
  /** the meter reading changed (ring fill, credits, states) */
  meter(m: MeterReading): void;
  /** credits went up: the single 400 ms ring pulse + "A capsule is ready" */
  ready(credits: number): void;
  /** a short message (refusal, still working) */
  message(text: string): void;
}

export interface Capsules {
  /** re-read the collection's meter (call on collection.onChange and after a ceremony) */
  sync(): void;
  /** stop listening to the collection */
  dispose(): void;
  readonly reading: MeterReading;
  /** a capsule stands on the table and can be held */
  readonly onTable: boolean;
  readonly opening: boolean;
  readonly holding: boolean;
  /** pointer routing: true = the capsule took this pointer */
  pointerDown(id: number, x: number, y: number): boolean;
  pointerMove(id: number, x: number, y: number): boolean;
  pointerUp(id: number): boolean;
  pointerCancel(id: number): boolean;
  /** per frame (ms clock): the squeeze progress, the slow-reply wobble */
  update(): void;
  /** the DOM twin: open the next capsule (no hold) */
  openNext(): Promise<void>;
  /** where the capsule is on screen (CSS px), for the harness and the HUD */
  screenPoint(): { x: number; y: number; r: number } | null;
  /** forget the 3D capsule (stage disposed, context lost) */
  cancelHold(): void;
}

export interface CapsulesDeps {
  stage: StageLike;
  audio: SquishAudio;
  haptics: Haptics;
  collection: ShellCollection;
  ceremonies: Ceremonies;
  now(): number;
  calm(): boolean;
  /** a finger or grab is on the play body (no opening mid-squish; the meter-full plink goes quiet) */
  bodyContact(): boolean;
  ui: CapsuleUi;
  report(e: unknown): void;
}

export function createCapsules(d: CapsulesDeps): Capsules {
  let reading: MeterReading = safeRead();
  let credits = reading.credits;
  let cap: CapsuleHandle | null = null;
  let opening = false;
  let hold: { id: number; t0: number; sx: number; sy: number; moved: number; grab2: boolean } | null = null;
  let waitSince = -1, lastWobble = 0, saidStill = false;

  function safeRead(): MeterReading {
    try { return d.collection.meter(); } catch (e) { d.report(e); return { fill: 0, credits: 0, resting: false, doneToday: false, tableFull: false, offline: false }; }
  }

  function dropIfNeeded(): void {
    if (cap || opening || d.ceremonies.active || credits <= 0 || !d.stage.dropCapsule) return;
    try { cap = d.stage.dropCapsule({ onLand: () => { try { d.haptics.pattern?.(CAPSULE_LAND_HAPTIC); } catch { /* optional */ } } }); }
    catch (e) { d.report(e); cap = null; }
  }

  async function open(c: CapsuleHandle | null): Promise<void> {
    if (opening || d.ceremonies.active || credits <= 0) return;
    opening = true;
    hold = null;
    try { c?.setSqueeze(1); } catch { /* gone */ }
    waitSince = d.now(); lastWobble = waitSince; saidStill = false;
    let r: CapsuleOutcome;
    try { r = await d.collection.openCapsule(); } catch (e) { d.report(e); r = { ok: false as const, error: 'exception', message: 'Something went wrong. Reload and try again.' }; }
    waitSince = -1;
    if (!r.ok) {
      try { c?.setSqueeze(0); } catch { /* gone */ }
      opening = false;
      d.ui.message(r.message);
      sync();
      return;
    }
    if (c === cap) cap = null;   // the reveal owns it from here (it disposes it at its end)
    opening = false;
    try { await d.ceremonies.playReveal(r, { capsule: c }); }
    catch (e) { d.report(e); }
    sync();
    dropIfNeeded();
  }

  /** the collection's 'capsule' event: the meter-full cue (DESIGN 6.2); the drop follows in sync() (onChange comes right after) */
  function ready(n: number): void {
    try { d.audio.meterFull?.({ quiet: d.bodyContact() }); } catch (e) { d.report(e); }
    try { d.haptics.pattern?.(METER_FULL_HAPTIC); } catch { /* optional */ }
    d.ui.ready(n);
  }
  const offEvent = d.collection.onEvent((e) => { if (e.type === 'capsule') ready(e.credits); });

  function sync(): void {
    reading = safeRead();
    credits = reading.credits;
    if (credits <= 0 && cap && !opening) { try { cap.remove(); } catch { /* gone */ } cap = null; }
    d.ui.meter(reading);
    dropIfNeeded();
  }

  return {
    sync,
    dispose() { offEvent(); },
    get reading() { return reading; },
    get onTable() { return !!cap && cap.landed; },
    get opening() { return opening; },
    get holding() { return hold !== null; },
    pointerDown(id, x, y) {
      if (!cap || opening || d.ceremonies.active) return false;
      let hit = false;
      try { hit = cap.landed && cap.hitTest(x, y); } catch { hit = false; }
      if (!hit) return false;
      if (d.bodyContact() || hold) return true;  // never open mid-squish; one hand on the capsule at a time (the press is swallowed)
      hold = { id, t0: d.now(), sx: x, sy: y, moved: 0, grab2: false };
      try { cap.setSqueeze(0.04); d.audio.capsuleBeat?.({ beat: 'grab', progress: 0.1, calm: d.calm() }); } catch (e) { d.report(e); }
      return true;
    },
    pointerMove(id, x, y) {
      if (!hold || hold.id !== id) return false;
      hold.moved = Math.max(hold.moved, Math.hypot(x - hold.sx, y - hold.sy));
      return true;
    },
    pointerUp(id) {
      if (!hold || hold.id !== id) return false;
      const h = hold;
      hold = null;
      const held = d.now() - h.t0;
      if (held <= TAP_MS && h.moved < TAP_SLOP_PX) void open(cap);
      else { try { cap?.setSqueeze(0); } catch { /* gone */ } }
      return true;
    },
    pointerCancel(id) {
      if (!hold || hold.id !== id) return false;
      hold = null;
      try { cap?.setSqueeze(0); } catch { /* gone */ }
      return true;
    },
    update() {
      const t = d.now();
      if (hold && cap) {
        const held = t - hold.t0;
        const p = Math.min(1, held / HOLD_TO_OPEN_MS);
        try { cap.setSqueeze(p); } catch { /* gone */ }
        if (!hold.grab2 && held >= 180) { hold.grab2 = true; try { d.audio.capsuleBeat?.({ beat: 'grab', progress: 0.6, calm: d.calm() }); } catch (e) { d.report(e); } }
        if (p >= 1) void open(cap);
      }
      if (waitSince >= 0) {
        if (t - waitSince > WAIT_WOBBLE_MS && t - lastWobble > 600) { lastWobble = t; try { cap?.wobble(0.6); } catch { /* gone */ } }
        if (!saidStill && t - waitSince > WAIT_GIVE_UP_MS) { saidStill = true; d.ui.message('Still working. Your capsule is safe.'); }
      }
    },
    openNext: () => open(cap),
    screenPoint() { try { return cap ? cap.screenPoint() : null; } catch { return null; } },
    cancelHold() { if (hold) { hold = null; try { cap?.setSqueeze(0); } catch { /* gone */ } } },
  };
}
