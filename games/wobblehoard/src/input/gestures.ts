// WOBBLEHOARD gesture state machine. PURE: no DOM, no three.js, no clock of its own, no randomness.
// Pointer samples (CSS px + a millisecond timestamp) and a hit-test callback go in; discrete actions come out through
// `emit`. The app turns the actions into SoftBodyLike / StageLike calls, so the real pointer events, the keyboard's
// Space key and the window.__WH__ debug hook all run through exactly this code.
//
//   down on the body, up within 180 ms with little movement ........ TAP     fingerDown(0.55) ... fingerUp
//   down on the body and hold > 180 ms ................................ SQUISH  pressure 0.55 -> 1 over 900 ms (smoothstep)
//   down on the body, then move > 14 px not-outward ................... RUB     fingerMove along the surface
//   down on the body, then move > 14 px outward (cos > 0.2) ........... PULL    grab(vertex under the press) / grabMove / grabRelease
//   ... the same pull with SHIFT held at that moment (mouse / pen) ..... PULL x2  a second grab on the OPPOSITE side (the press point reflected
//                                                                     through the body's screen centre) on the other slot, both pulled outward
//                                                                     by the same amount, the way two fingers do on a phone
//   down on empty space with a FINGER or a PEN, or the right/middle mouse button anywhere ... ORBIT   drag
//   a LEFT mouse click on empty space .................................. nothing (owner decision 2026-10-06: with a mouse only the right button turns the view)
//   wheel, or two fingers on empty space ............................... ZOOM
//   two fingers on empty space dragged together, or the right/middle mouse button dragged with SHIFT held ... PAN (round 14, the room camera: the picture
//                                                                     follows the fingers; the plain right-drag still turns the view, the pinch still zooms)
//   up to five fingers on the body ..................................... five body fingers: slots 0 to 4 (LOCK.md decision 3). A TOUCH finger (not Space's
//                                                                     synthetic one) takes the first free slot of the first `host.slots()` (5 when the body
//                                                                     offers them, else the old 2); everything else (mouse, pen, scripted pointer, Space) only 0 and 1
//   cancel / lost capture ............................................... everything is released cleanly
//
// CARRY (round 14, R14_CARRY, owner decision D-105: "make it easier to pick up and move squishies around"). Only where `host.carryOn()` says so (a place, Home
// with two or more out; Home with one squishy out is the published toy and this machine is the published one there, row for row):
//   down on the body, then move > 14 px within carryMs (400 ms), lone, no Shift ... CARRY  grab(lift) / grabMove / grabRelease: it comes with the finger
//   down on the body, held still past carryMs, then move ......................... PULL outward (a stretch, as published: past the line it lifts) or RUB
//   Shift + drag, or a second finger on the same body ............................ the published pull / two-handed stretch (never a carry)
// So "how the gesture starts" decides: a drag picks it up, a hold first makes it a squish that a drag then stretches or rubs.
//
// SHIFT (owner decision 2026-10-06). `PointerSample.shift` is read ONCE, by the move that commits a press to a pull. If the other body slot is
// free, the mirror point (press reflected through host.bodyScreen(), then shrunk x0.92 per try down to x0.5 while the ray misses the body) is
// grabbed on that slot (`grab` with `mirrorOf`), and every later move sets its target from the real pointer reflected through the LIVE centre.
// Slot busy (Space's synthetic finger, a second touch) or nothing hit = the plain single pull, silently. A gesture never changes mode midway:
// Shift released later keeps the mirror, Shift pressed later does nothing; up / cancel / cancelAll / a lost body release both grabs once each.
import type { Slot, V3 } from '../contracts.ts';

export type { Slot };

export interface BodyHit { point: V3; normal: V3; dir: V3; vertex: number }
/** The body's silhouette disc in screen px (centre of mass projected, radius ~ rest radius projected). */
export interface ScreenDisc { x: number; y: number; r: number }

export interface GestureHost {
  /** Ray through the pixel against the current body surface; null = empty space. */
  hitTest(x: number, y: number): BodyHit | null;
  bodyScreen(): ScreenDisc | null;
  /** World point under the pixel on the camera-facing plane through `through` (pull target); null if the ray is parallel. */
  planePoint(x: number, y: number, through: V3): V3 | null;
  /** How many finger slots the body under the fingers offers: 5 (a body that locks, LOCK.md), else the old 2. Absent = 5. Read at every touch press. */
  slots?(): number;
  /** (round 14, R14_CARRY, D-105) true where squishies are moved around (a place; Home with two or more out): a drag that starts on the body within
   *  `carryMs` of the press CARRIES it (see CARRY below). Absent / false = exactly the published machine. Read at the move that commits a press. */
  carryOn?(): boolean;
}

/** The slots a touch finger may take (LOCK.md decision 3); mouse, pen and scripted pointers keep to the first two. */
export const TOUCH_SLOTS = 5;
const POINTER_SLOTS = 2;

export type GestureKind = 'tap' | 'squish' | 'rub' | 'pull' | 'orbit' | 'pinch' | 'carry';

export type GestureAction =
  | { type: 'fingerDown'; slot: Slot; hit: BodyHit }
  | { type: 'fingerPressure'; slot: Slot; target: number }
  | { type: 'fingerMove'; slot: Slot; point: V3 }
  /** why: 'tap' | 'release' = the finger lifted; 'pull' = handing the contact over to a grab; 'cancel' = interrupted */
  | { type: 'fingerUp'; slot: Slot; why: 'tap' | 'release' | 'pull' | 'cancel' }
  /** `mirrorOf` is set only on the second grab of a Shift pull: it is the OTHER slot of the same pointer (the real finger's). Absent otherwise.
   *  `lift` (round 14, CARRY): the grab of a carry: the body is picked up at once (SoftBodyLike.lift). Absent otherwise. */
  | { type: 'grab'; slot: Slot; vertex: number; target: V3; mirrorOf?: Slot; lift?: true }
  | { type: 'grabMove'; slot: Slot; target: V3 }
  /** `still` (round 14, CARRY): a carry's finger rested STILL_MS before it let go: the body is set down, never thrown (the room view may still be moving the hand) */
  | { type: 'grabRelease'; slot: Slot; why: 'up' | 'cancel'; still?: true }
  /** dx, dy: pointer movement in px since the last sample */
  | { type: 'orbit'; dx: number; dy: number }
  /** (round 14, R14_ROOMS) dx, dy: how far the picture should follow in px (the midpoint of two fingers on empty space; a Shift + right / middle drag) */
  | { type: 'pan'; dx: number; dy: number }
  /** delta is wheel-like: > 0 = away from the squishy (zoom out), < 0 = closer. One mouse-wheel notch ~ 1. */
  | { type: 'zoom'; delta: number; source: 'wheel' | 'pinch' }
  /** classification notice (analytics, the hint line, the probe). `slot` is set for body gestures. */
  | { type: 'gesture'; kind: GestureKind; pointer: number; slot?: Slot };

export interface GestureConfig {
  tapMs: number;            // up within this = tap; past it the press is a squish
  slopPx: number;           // movement beyond this commits a press to rub or pull
  outwardCos: number;       // cos(angle between the drag and 'away from the body centre') must exceed this to pull
  tapPressure: number;      // fingerPressure target at contact
  rampMs: number;           // squeeze ramp 0.55 -> 1 starts at tapMs and lasts this long
  rubMaxPressure: number;   // a rubbing finger never presses harder than this
  minOutwardPx: number;     // pressing closer than this to the centre has no meaningful 'outward'
  wheelPxPerNotch: number;
  pinchPxPerNotch: number;  // pinch distance change (px) that counts as one wheel notch
  carryMs: number;          // (round 14, CARRY) with host.carryOn(): a press that starts moving within this many ms carries the body
}

export const DEFAULT_GESTURE_CONFIG: Readonly<GestureConfig> = {
  tapMs: 180, slopPx: 14, outwardCos: 0.2, tapPressure: 0.55, rampMs: 900, rubMaxPressure: 0.7,
  minOutwardPx: 4, wheelPxPerNotch: 100, pinchPxPerNotch: 90, carryMs: 400,
};

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  /** ms, any monotonic clock, but the same clock for every call (pointer samples and update()). */
  t: number;
  /** 0 = primary (also touch/pen contact). 1 = middle, 2 = secondary => orbit. */
  button?: number;
  /** What the pointer is. Only 'mouse' changes anything: its LEFT button on empty space does nothing (it used to turn the camera; the owner wants
   *  only the right button to). Absent (a synthetic pointer, the debug hook, the Space key) = as a finger: empty space turns the view. */
  type?: 'mouse' | 'touch' | 'pen';
  /** Shift is held (a mouse or pen event's shiftKey; the pointer glue never sets it for touch). Read only on the sample that commits a press
   *  to a pull: true there = pull both sides. Absent / false = exactly the old machine. */
  shift?: boolean;
}

export interface GestureSnapshot {
  id: number; kind: 'body' | 'orbit' | 'ignored'; mode: 'press' | 'rub' | 'pull' | 'orbit' | 'ignored'; slot: Slot | -1; squishing: boolean; pressure: number;
  /** the slot of this pointer's mirrored second grab (a Shift pull), or -1 */
  mirror: Slot | -1;
}

export interface Gestures {
  pointerDown(s: PointerSample): void;
  /** A press that did its work already (it let a locked lobe go, LOCK.md decision 2): the pointer is known and ignored, so its moves and its up are swallowed and
   *  nothing else starts under it. A duplicate id is cleaned up first, as in pointerDown. */
  consume(s: PointerSample): void;
  pointerMove(s: PointerSample): void;
  pointerUp(s: PointerSample): void;
  /** pointercancel / lostpointercapture: release without classifying. */
  pointerCancel(id: number, t: number): void;
  cancelAll(t: number): void;
  /** Advance time: hold detection and the pressure ramp. Call every frame. */
  update(t: number): void;
  /** (round 14, R14_ROOMS) The view moved under a still finger (the room camera scrolls while a squishy is carried to the frame's edge): every pull asks its
   *  hand's target again from where its pointer is, so the body stays under the finger. Emits only grabMove. */
  retarget(): void;
  wheel(deltaPx: number): void;
  isActive(id: number): boolean;
  activeCount(): number;
  snapshot(): GestureSnapshot[];
}

interface Ptr {
  id: number;
  kind: 'body' | 'orbit' | 'ignored';
  mode: 'press' | 'rub' | 'pull' | 'orbit' | 'ignored';
  slot: Slot;
  x: number; y: number;      // latest position
  sx: number; sy: number;    // press position
  t0: number;
  tLast: number;             // latest time seen for this pointer (time never runs backwards for a press)
  hit: BodyHit | null;
  squish: boolean;
  pressure: number;
  orbitAnnounced: boolean;
  /** (CARRY) a carry's pointer: where it last moved by more than STILL_PX and when (a let go after STILL_MS without moving is a set-down, never a throw) */
  lift?: boolean; mx?: number; my?: number; tm?: number;
  /** (CARRY, round 15) the finger's own speed on the screen (px per ms, smoothed over FLICK_TAU) and its last sample: a let go under FLICK_V is a set-down */
  fv?: number; fx?: number; fy?: number; ft?: number;
  /** a Shift pull's second grab: its slot (-1 = none) and the surface point it holds (the camera-facing plane for its target goes through it) */
  mslot: Slot | -1;
  mthrough: V3 | null;
  /** the body's screen centre when the finger went down (NaN: none): the outward direction of a pull is measured from it */
  pcx: number; pcy: number;
}

/** The mirror point shrinks toward the centre by this factor per try while the ray through it misses the body, down to MIRROR_MIN_SCALE. */
/** (CARRY) a carry's finger that has not moved more than STILL_PX for STILL_MS lets go of a still hand */
const STILL_MS = 120, STILL_PX = 3;
/** (CARRY, round 15, R15_FIX F3: VERDICT_R14 F3, "a carry let go by Home's back rim jumps 4 m") THE FINGER decides between a toss and a set-down, not the hand:
 *  a carry let go while the finger moves slower than FLICK_V px per ms on the screen (350 px/s; its speed smoothed over FLICK_TAU ms and fading while it rests)
 *  lets go of a still hand too. The hand's speed is measured across the FLOOR (the level plane): far back in a room a few px of finger are metres of hand, and
 *  the room view scrolls the hand along under a finger at the frame's edge, so a slow or just-stopped finger let go of a hand at up to the fastest toss: the
 *  squishy was thrown at the rim and came back across the felt. A flick (a fast finger at the let go) is the published toss as before. */
const FLICK_V = 0.35, FLICK_TAU = 50;
const MIRROR_SHRINK = 0.92;
const MIRROR_MIN_SCALE = 0.5;

const smooth01 = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

export function createGestures(host: GestureHost, emit: (a: GestureAction) => void, config: Partial<GestureConfig> = {}): Gestures {
  const cfg: GestureConfig = { ...DEFAULT_GESTURE_CONFIG, ...config };
  const ptrs = new Map<number, Ptr>();
  let tickT = 0;
  let pinch: { a: number; b: number; dist: number; mx: number; my: number } | null = null;

  /** a slot is busy while a body pointer owns it, or holds it as its mirrored second grab (a Shift pull) */
  const slotFree = (s: Slot): boolean => { for (const p of ptrs.values()) if (p.kind === 'body' && (p.slot === s || p.mslot === s)) return false; return true; };
  /** (CARRY) no other pointer is on the body: a second finger on it makes a two-handed stretch, never a carry */
  const lone = (q: Ptr): boolean => { for (const p of ptrs.values()) if (p !== q && p.kind === 'body') return false; return true; };
  /** the first free slot this pointer may take, or null: a real touch finger (id >= 0: Space's synthetic one is -1000) may use the first host.slots() of the five, everything else the first two */
  function freeSlot(s: PointerSample): Slot | null {
    const n = s.type === 'touch' && s.id >= 0 ? Math.max(POINTER_SLOTS, Math.min(TOUCH_SLOTS, Math.floor(host.slots ? host.slots() : TOUCH_SLOTS))) : POINTER_SLOTS;
    for (let k = 0; k < n; k++) if (slotFree(k as Slot)) return k as Slot;
    return null;
  }

  function pressureAt(p: Ptr, t: number): number {
    const s = smooth01((t - p.t0 - cfg.tapMs) / cfg.rampMs);
    const v = cfg.tapPressure + (1 - cfg.tapPressure) * s;
    return p.mode === 'rub' ? Math.min(v, cfg.rubMaxPressure) : v;
  }

  /** hold detection + pressure ramp for one body pointer at time t (tickEach: the same at tickT, for the per-frame Map.forEach) */
  const tickEach = (p: Ptr): void => { tickBody(p, tickT); };
  function tickBody(p: Ptr, t: number): void {
    if (p.kind !== 'body' || p.mode === 'pull') return;
    if (t < p.tLast) t = p.tLast; else p.tLast = t;
    if (!p.squish && t - p.t0 > cfg.tapMs) {
      p.squish = true;
      if (p.mode === 'press') emit({ type: 'gesture', kind: 'squish', pointer: p.id, slot: p.slot });
    }
    if (p.squish) {
      const v = pressureAt(p, t);
      if (Math.abs(v - p.pressure) >= 0.003 || (v >= 1 && p.pressure < 1)) {
        p.pressure = v;
        emit({ type: 'fingerPressure', slot: p.slot, target: v });
      }
    }
  }

  function outwardPull(p: Ptr, x: number, y: number): boolean {
    const c = host.bodyScreen();
    if (!c) return false;
    const dx = x - p.sx, dy = y - p.sy;
    const dl = Math.hypot(dx, dy);
    if (dl === 0) return false;
    // (round 12, R12_INTEGRATE) "away from the body's centre": from where the centre is now OR from where it was on screen when the finger went down. A squishy
    // that was walking (D-100's crawl) or is shoved by the press itself moves on screen before the drag passes the slop; measured from its live centre alone,
    // an outward drag from the side of a walking squishy read as a rub and it could not be lifted. A body that stands still is unchanged (both are one point).
    return outwardFrom(p, c.x, c.y, c.r, dx, dy, dl) || (p.pcx === p.pcx && outwardFrom(p, p.pcx, p.pcy, c.r, dx, dy, dl));
  }
  function outwardFrom(p: Ptr, cx: number, cy: number, r: number, dx: number, dy: number, dl: number): boolean {
    const ox = p.sx - cx, oy = p.sy - cy;
    const ol = Math.hypot(ox, oy);
    if (ol < Math.max(cfg.minOutwardPx, 0.1 * r)) return false;
    return (dx * ox + dy * oy) / (dl * ol) > cfg.outwardCos;
  }

  function doRub(p: Ptr, x: number, y: number): void {
    const h = host.hitTest(x, y);
    if (h) emit({ type: 'fingerMove', slot: p.slot, point: h.point });
    // off the body: the finger stays where it last touched (no action)
  }

  /**
   * Shift pull: grab the point opposite the press on the other slot. The press point reflected through the body's screen centre is ray-tested;
   * a miss (a lopsided silhouette) shrinks it toward the centre (x0.92 per try, down to x0.5). The other slot busy, or nothing hit: no
   * mirror, silently (the plain single pull stands). The first target is the reflection of the pointer NOW through the same centre, on the
   * camera-facing plane through the mirrored vertex, as the real grab's target is on its own.
   */
  function startMirror(p: Ptr, x: number, y: number): void {
    const ms: Slot = p.slot === 0 ? 1 : 0;
    if (!slotFree(ms)) return;
    const c = host.bodyScreen();
    if (!c) return;
    const ox = p.sx - c.x, oy = p.sy - c.y;
    for (let k = 1; k >= MIRROR_MIN_SCALE - 1e-9; k *= MIRROR_SHRINK) {
      const h = host.hitTest(c.x - ox * k, c.y - oy * k);
      if (!h) continue;
      p.mslot = ms;
      p.mthrough = h.point;
      emit({ type: 'grab', slot: ms, vertex: h.vertex, target: host.planePoint(2 * c.x - x, 2 * c.y - y, h.point) ?? h.point, mirrorOf: p.slot });
      return;
    }
  }

  /** the mirrored grab follows the real pointer reflected through the LIVE screen centre (the body may have moved since the press) */
  function moveMirror(p: Ptr, x: number, y: number): void {
    if (p.mslot === -1 || !p.mthrough) return;
    const c = host.bodyScreen();
    if (!c) return;
    const target = host.planePoint(2 * c.x - x, 2 * c.y - y, p.mthrough);
    if (target) emit({ type: 'grabMove', slot: p.mslot, target });
  }

  function moveBody(p: Ptr, x: number, y: number, shift: boolean): void {
    if (p.mode === 'press') {
      if (Math.hypot(x - p.sx, y - p.sy) <= cfg.slopPx) return;
      const hit = p.hit!;
      if (!shift && p.tLast - p.t0 <= cfg.carryMs && host.carryOn?.() === true && lone(p)) {
        // CARRY (round 14): the drag started on the body before it was held still: pick it up now, it comes with the finger (any direction)
        p.mode = 'pull'; p.lift = true; p.mx = x; p.my = y; p.tm = p.tLast; p.fv = 0; p.fx = x; p.fy = y; p.ft = p.tLast;
        emit({ type: 'gesture', kind: 'carry', pointer: p.id, slot: p.slot });
        emit({ type: 'fingerUp', slot: p.slot, why: 'pull' });
        emit({ type: 'grab', slot: p.slot, vertex: hit.vertex, target: host.planePoint(x, y, hit.point) ?? hit.point, lift: true });
      } else if (outwardPull(p, x, y)) {
        p.mode = 'pull';
        emit({ type: 'gesture', kind: 'pull', pointer: p.id, slot: p.slot });
        emit({ type: 'fingerUp', slot: p.slot, why: 'pull' });
        emit({ type: 'grab', slot: p.slot, vertex: hit.vertex, target: host.planePoint(x, y, hit.point) ?? hit.point });
        if (shift) startMirror(p, x, y);   // Shift is read here and nowhere else: a gesture never changes mode midway
      } else {
        p.mode = 'rub';
        emit({ type: 'gesture', kind: 'rub', pointer: p.id, slot: p.slot });
        if (p.pressure > cfg.rubMaxPressure) { // a hard squeeze that starts rubbing eases off to rub pressure
          p.pressure = cfg.rubMaxPressure;
          emit({ type: 'fingerPressure', slot: p.slot, target: p.pressure });
        }
        doRub(p, x, y);
      }
    } else if (p.mode === 'rub') {
      doRub(p, x, y);
    } else if (p.mode === 'pull') {
      if (p.lift && Math.hypot(x - p.mx!, y - p.my!) > STILL_PX) { p.mx = x; p.my = y; p.tm = p.tLast; }
      if (p.lift && p.tLast > p.ft!) {   // (the finger's own speed; a call with the same point (retarget: the view moved under a still finger) samples a speed of 0)
        const dt = p.tLast - p.ft!, k = Math.exp(-dt / FLICK_TAU);
        p.fv = p.fv! * k + (Math.hypot(x - p.fx!, y - p.fy!) / dt) * (1 - k); p.fx = x; p.fy = y; p.ft = p.tLast;
      }
      const target = host.planePoint(x, y, p.hit!.point);
      if (target) emit({ type: 'grabMove', slot: p.slot, target });
      moveMirror(p, x, y);
    }
  }

  function releasePtr(p: Ptr, cancelled: boolean): void {
    if (p.kind === 'body') {
      if (p.mode === 'pull') {
        const why = cancelled ? 'cancel' : 'up';
        // (CARRY: a finger that has rested STILL_MS lets go of a still hand, even while the room view scrolls the hand along: it sets the squishy down, never throws it)
        // (round 15: ... and so does a finger that is slow on the screen at the let go, FLICK_V; with no clock at all (every time equal) nothing is known: the hand decides)
        emit(p.lift && !cancelled && (p.tLast - p.tm! >= STILL_MS || (p.tLast > p.t0 && p.fv! * Math.exp(-(p.tLast - p.ft!) / FLICK_TAU) < FLICK_V)) ? { type: 'grabRelease', slot: p.slot, why, still: true } : { type: 'grabRelease', slot: p.slot, why });
        if (p.mslot !== -1) emit({ type: 'grabRelease', slot: p.mslot, why });   // a Shift pull lets go of both hands, exactly once each
      } else {
        if (!cancelled && p.mode === 'press' && !p.squish) emit({ type: 'gesture', kind: 'tap', pointer: p.id, slot: p.slot });
        emit({ type: 'fingerUp', slot: p.slot, why: cancelled ? 'cancel' : p.mode === 'press' && !p.squish ? 'tap' : 'release' });
      }
    }
    ptrs.delete(p.id);
    if (p.kind === 'orbit' && pinch && (pinch.a === p.id || pinch.b === p.id)) pinch = null;
  }

  function finite(s: PointerSample): boolean { return Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.t); }

  return {
    pointerDown(s) {
      if (!finite(s)) return;
      const dup = ptrs.get(s.id);
      if (dup) releasePtr(dup, true); // a missed pointerup: clean up, then start over
      const base = { id: s.id, x: s.x, y: s.y, sx: s.x, sy: s.y, t0: s.t, tLast: s.t, squish: false, pressure: 0, orbitAnnounced: false, mslot: -1 as Slot | -1, mthrough: null as V3 | null, pcx: NaN, pcy: NaN };
      const button = s.button ?? 0;
      const hit = button === 0 ? host.hitTest(s.x, s.y) : null;
      if (hit) {
        const slot = freeSlot(s);
        if (slot === null) { ptrs.set(s.id, { ...base, kind: 'ignored', mode: 'ignored', slot: 0, hit: null }); return; }
        const p: Ptr = { ...base, kind: 'body', mode: 'press', slot, hit, pressure: cfg.tapPressure };
        const c0 = host.bodyScreen();
        if (c0) { p.pcx = c0.x; p.pcy = c0.y; }
        ptrs.set(s.id, p);
        emit({ type: 'fingerDown', slot, hit });
        emit({ type: 'fingerPressure', slot, target: cfg.tapPressure });
        return;
      }
      // a LEFT mouse click on empty space does nothing: with a mouse only the right (or middle) button turns the view (owner decision 2026-10-06).
      // The pointer stays known (as ignored) so its move and up are swallowed; a finger or a pen still drags empty space to turn.
      if (button === 0 && s.type === 'mouse') { ptrs.set(s.id, { ...base, kind: 'ignored', mode: 'ignored', slot: 0, hit: null }); return; }
      // empty space (or a non-primary button): orbit, or pinch-zoom when a second empty-space finger arrives
      let orbiting = 0;
      for (const q of ptrs.values()) if (q.kind === 'orbit') orbiting++;
      if (orbiting >= 2) { ptrs.set(s.id, { ...base, kind: 'ignored', mode: 'ignored', slot: 0, hit: null }); return; }
      const p: Ptr = { ...base, kind: 'orbit', mode: 'orbit', slot: 0, hit: null };
      if (orbiting === 1) {
        const other = [...ptrs.values()].find((q) => q.kind === 'orbit')!;
        pinch = { a: other.id, b: s.id, dist: Math.max(1, Math.hypot(other.x - s.x, other.y - s.y)), mx: (other.x + s.x) / 2, my: (other.y + s.y) / 2 };
        emit({ type: 'gesture', kind: 'pinch', pointer: s.id });
      }
      ptrs.set(s.id, p);
    },

    consume(s) {
      if (!finite(s)) return;
      const dup = ptrs.get(s.id);
      if (dup) releasePtr(dup, true);
      ptrs.set(s.id, { id: s.id, x: s.x, y: s.y, sx: s.x, sy: s.y, t0: s.t, tLast: s.t, squish: false, pressure: 0, orbitAnnounced: false, mslot: -1, mthrough: null, pcx: NaN, pcy: NaN, kind: 'ignored', mode: 'ignored', slot: 0, hit: null });
    },

    pointerMove(s) {
      const p = ptrs.get(s.id);
      if (!p || !finite(s)) return;
      const px = p.x, py = p.y;
      p.x = s.x; p.y = s.y;
      if (p.kind === 'orbit') {
        if (pinch && (pinch.a === p.id || pinch.b === p.id)) {
          const a = ptrs.get(pinch.a), b = ptrs.get(pinch.b);
          if (a && b) {
            const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            const delta = -(d - pinch.dist) / cfg.pinchPxPerNotch;
            pinch.dist = d;
            if (Math.abs(delta) > 1e-6) emit({ type: 'zoom', delta, source: 'pinch' });
            // (round 14) the two fingers' midpoint moved: the picture follows it (a pan)
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (mx !== pinch.mx || my !== pinch.my) { emit({ type: 'pan', dx: mx - pinch.mx, dy: my - pinch.my }); pinch.mx = mx; pinch.my = my; }
          }
          return;
        }
        const dx = s.x - px, dy = s.y - py;
        if (dx === 0 && dy === 0) return;
        if (!p.orbitAnnounced) { p.orbitAnnounced = true; emit({ type: 'gesture', kind: 'orbit', pointer: p.id }); }
        emit({ type: s.shift === true ? 'pan' : 'orbit', dx, dy });   // (round 14: Shift + the right / middle button pans)
        return;
      }
      if (p.kind !== 'body') return;
      tickBody(p, s.t);
      if (p.lift && s.t > p.tLast) p.tLast = s.t;   // (CARRY: a carry's own clock, for its still let go)
      moveBody(p, s.x, s.y, s.shift === true);
    },

    pointerUp(s) {
      const p = ptrs.get(s.id);
      if (!p) return;
      if (finite(s)) {
        if (p.kind === 'body') {
          tickBody(p, s.t);
          if (p.lift && s.t > p.tLast) p.tLast = s.t;
          if (Math.hypot(s.x - p.x, s.y - p.y) >= 0.5) { p.x = s.x; p.y = s.y; moveBody(p, s.x, s.y, s.shift === true); }
        }
      }
      releasePtr(p, false);
    },

    pointerCancel(id) {
      const p = ptrs.get(id);
      if (p) releasePtr(p, true);
    },

    cancelAll() {
      for (const p of [...ptrs.values()]) releasePtr(p, true);
      pinch = null;
    },

    update(t) {
      if (!Number.isFinite(t) || ptrs.size === 0) return;
      tickT = t;
      ptrs.forEach(tickEach);   // Map.forEach with a bound callback: no iterator object per frame
    },

    retarget() {
      for (const p of ptrs.values()) if (p.kind === 'body' && p.mode === 'pull') moveBody(p, p.x, p.y, false);
    },

    wheel(deltaPx) {
      if (!Number.isFinite(deltaPx) || deltaPx === 0) return;
      const d = deltaPx / cfg.wheelPxPerNotch;
      emit({ type: 'zoom', delta: d < -3 ? -3 : d > 3 ? 3 : d, source: 'wheel' });
    },

    isActive: (id) => ptrs.has(id),
    activeCount: () => ptrs.size,
    snapshot: () => [...ptrs.values()].map((p) => ({
      id: p.id, kind: p.kind, mode: p.mode, slot: p.kind === 'body' ? p.slot : -1, squishing: p.squish, pressure: p.pressure, mirror: p.mslot,
    })),
  };
}
