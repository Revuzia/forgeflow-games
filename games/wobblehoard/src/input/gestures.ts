// WOBBLEHOARD gesture state machine. PURE: no DOM, no three.js, no clock of its own, no randomness.
// Pointer samples (CSS px + a millisecond timestamp) and a hit-test callback go in; discrete actions come out through
// `emit`. The app turns the actions into SoftBodyLike / StageLike calls, so the real pointer events, the keyboard's
// Space key and the window.__WH__ debug hook all run through exactly this code.
//
//   down on the body, up within 180 ms with little movement ........ TAP     fingerDown(0.55) ... fingerUp
//   down on the body and hold > 180 ms ................................ SQUISH  pressure 0.55 -> 1 over 900 ms (smoothstep)
//   down on the body, then move > 14 px not-outward ................... RUB     fingerMove along the surface
//   down on the body, then move > 14 px outward (cos > 0.2) ........... PULL    grab(vertex under the press) / grabMove / grabRelease
//   down on empty space (or right/middle button anywhere) ............. ORBIT   drag
//   wheel, or two fingers on empty space ............................... ZOOM
//   two fingers on the body ............................................ two body fingers: slots 0 and 1 (max 2)
//   cancel / lost capture ............................................... everything is released cleanly
import type { V3 } from '../contracts.ts';

export interface BodyHit { point: V3; normal: V3; dir: V3; vertex: number }
/** The body's silhouette disc in screen px (centre of mass projected, radius ~ rest radius projected). */
export interface ScreenDisc { x: number; y: number; r: number }

export interface GestureHost {
  /** Ray through the pixel against the current body surface; null = empty space. */
  hitTest(x: number, y: number): BodyHit | null;
  bodyScreen(): ScreenDisc | null;
  /** World point under the pixel on the camera-facing plane through `through` (pull target); null if the ray is parallel. */
  planePoint(x: number, y: number, through: V3): V3 | null;
}

export type Slot = 0 | 1;
export type GestureKind = 'tap' | 'squish' | 'rub' | 'pull' | 'orbit' | 'pinch';

export type GestureAction =
  | { type: 'fingerDown'; slot: Slot; hit: BodyHit }
  | { type: 'fingerPressure'; slot: Slot; target: number }
  | { type: 'fingerMove'; slot: Slot; point: V3 }
  /** why: 'tap' | 'release' = the finger lifted; 'pull' = handing the contact over to a grab; 'cancel' = interrupted */
  | { type: 'fingerUp'; slot: Slot; why: 'tap' | 'release' | 'pull' | 'cancel' }
  | { type: 'grab'; slot: Slot; vertex: number; target: V3 }
  | { type: 'grabMove'; slot: Slot; target: V3 }
  | { type: 'grabRelease'; slot: Slot; why: 'up' | 'cancel' }
  /** dx, dy: pointer movement in px since the last sample */
  | { type: 'orbit'; dx: number; dy: number }
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
}

export const DEFAULT_GESTURE_CONFIG: Readonly<GestureConfig> = {
  tapMs: 180, slopPx: 14, outwardCos: 0.2, tapPressure: 0.55, rampMs: 900, rubMaxPressure: 0.7,
  minOutwardPx: 4, wheelPxPerNotch: 100, pinchPxPerNotch: 90,
};

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  /** ms, any monotonic clock, but the same clock for every call (pointer samples and update()). */
  t: number;
  /** 0 = primary (also touch/pen contact). 1 = middle, 2 = secondary => orbit. */
  button?: number;
}

export interface GestureSnapshot { id: number; kind: 'body' | 'orbit' | 'ignored'; mode: 'press' | 'rub' | 'pull' | 'orbit' | 'ignored'; slot: Slot | -1; squishing: boolean; pressure: number }

export interface Gestures {
  pointerDown(s: PointerSample): void;
  pointerMove(s: PointerSample): void;
  pointerUp(s: PointerSample): void;
  /** pointercancel / lostpointercapture: release without classifying. */
  pointerCancel(id: number, t: number): void;
  cancelAll(t: number): void;
  /** Advance time: hold detection and the pressure ramp. Call every frame. */
  update(t: number): void;
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
}

const smooth01 = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

export function createGestures(host: GestureHost, emit: (a: GestureAction) => void, config: Partial<GestureConfig> = {}): Gestures {
  const cfg: GestureConfig = { ...DEFAULT_GESTURE_CONFIG, ...config };
  const ptrs = new Map<number, Ptr>();
  let tickT = 0;
  let pinch: { a: number; b: number; dist: number } | null = null;

  const slotFree = (s: Slot): boolean => { for (const p of ptrs.values()) if (p.kind === 'body' && p.slot === s) return false; return true; };

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
    const ox = p.sx - c.x, oy = p.sy - c.y;
    const ol = Math.hypot(ox, oy);
    if (ol < Math.max(cfg.minOutwardPx, 0.1 * c.r)) return false;
    const dx = x - p.sx, dy = y - p.sy;
    const dl = Math.hypot(dx, dy);
    if (dl === 0) return false;
    return (dx * ox + dy * oy) / (dl * ol) > cfg.outwardCos;
  }

  function doRub(p: Ptr, x: number, y: number): void {
    const h = host.hitTest(x, y);
    if (h) emit({ type: 'fingerMove', slot: p.slot, point: h.point });
    // off the body: the finger stays where it last touched (no action)
  }

  function moveBody(p: Ptr, x: number, y: number): void {
    if (p.mode === 'press') {
      if (Math.hypot(x - p.sx, y - p.sy) <= cfg.slopPx) return;
      const hit = p.hit!;
      if (outwardPull(p, x, y)) {
        p.mode = 'pull';
        emit({ type: 'gesture', kind: 'pull', pointer: p.id, slot: p.slot });
        emit({ type: 'fingerUp', slot: p.slot, why: 'pull' });
        emit({ type: 'grab', slot: p.slot, vertex: hit.vertex, target: host.planePoint(x, y, hit.point) ?? hit.point });
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
      const target = host.planePoint(x, y, p.hit!.point);
      if (target) emit({ type: 'grabMove', slot: p.slot, target });
    }
  }

  function releasePtr(p: Ptr, cancelled: boolean): void {
    if (p.kind === 'body') {
      if (p.mode === 'pull') emit({ type: 'grabRelease', slot: p.slot, why: cancelled ? 'cancel' : 'up' });
      else {
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
      const base = { id: s.id, x: s.x, y: s.y, sx: s.x, sy: s.y, t0: s.t, tLast: s.t, squish: false, pressure: 0, orbitAnnounced: false };
      const button = s.button ?? 0;
      const hit = button === 0 ? host.hitTest(s.x, s.y) : null;
      if (hit) {
        const slot: Slot | null = slotFree(0) ? 0 : slotFree(1) ? 1 : null;
        if (slot === null) { ptrs.set(s.id, { ...base, kind: 'ignored', mode: 'ignored', slot: 0, hit: null }); return; }
        const p: Ptr = { ...base, kind: 'body', mode: 'press', slot, hit, pressure: cfg.tapPressure };
        ptrs.set(s.id, p);
        emit({ type: 'fingerDown', slot, hit });
        emit({ type: 'fingerPressure', slot, target: cfg.tapPressure });
        return;
      }
      // empty space (or a non-primary button): orbit, or pinch-zoom when a second empty-space finger arrives
      let orbiting = 0;
      for (const q of ptrs.values()) if (q.kind === 'orbit') orbiting++;
      if (orbiting >= 2) { ptrs.set(s.id, { ...base, kind: 'ignored', mode: 'ignored', slot: 0, hit: null }); return; }
      const p: Ptr = { ...base, kind: 'orbit', mode: 'orbit', slot: 0, hit: null };
      if (orbiting === 1) {
        const other = [...ptrs.values()].find((q) => q.kind === 'orbit')!;
        pinch = { a: other.id, b: s.id, dist: Math.max(1, Math.hypot(other.x - s.x, other.y - s.y)) };
        emit({ type: 'gesture', kind: 'pinch', pointer: s.id });
      }
      ptrs.set(s.id, p);
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
          }
          return;
        }
        const dx = s.x - px, dy = s.y - py;
        if (dx === 0 && dy === 0) return;
        if (!p.orbitAnnounced) { p.orbitAnnounced = true; emit({ type: 'gesture', kind: 'orbit', pointer: p.id }); }
        emit({ type: 'orbit', dx, dy });
        return;
      }
      if (p.kind !== 'body') return;
      tickBody(p, s.t);
      moveBody(p, s.x, s.y);
    },

    pointerUp(s) {
      const p = ptrs.get(s.id);
      if (!p) return;
      if (finite(s)) {
        if (p.kind === 'body') {
          tickBody(p, s.t);
          if (Math.hypot(s.x - p.x, s.y - p.y) >= 0.5) { p.x = s.x; p.y = s.y; moveBody(p, s.x, s.y); }
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

    wheel(deltaPx) {
      if (!Number.isFinite(deltaPx) || deltaPx === 0) return;
      const d = deltaPx / cfg.wheelPxPerNotch;
      emit({ type: 'zoom', delta: d < -3 ? -3 : d > 3 ? 3 : d, source: 'wheel' });
    },

    isActive: (id) => ptrs.has(id),
    activeCount: () => ptrs.size,
    snapshot: () => [...ptrs.values()].map((p) => ({
      id: p.id, kind: p.kind, mode: p.mode, slot: p.kind === 'body' ? p.slot : -1, squishing: p.squish, pressure: p.pressure,
    })),
  };
}
