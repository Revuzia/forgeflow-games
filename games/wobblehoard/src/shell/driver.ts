// Gesture actions (src/input/gestures.ts) -> the play body and the camera. Owns the per-finger touch state the feedback layer reads:
// which fingers are down or pulling, the pan of each contact, the deepest press of the current touch, and the "this contact became a pull
// (or was cancelled): no release bloop" marker.
import type { SoftBodyLike, StageLike, V3 } from '../contracts.ts';
import type { GestureAction, Slot } from '../input/gestures.ts';
import { CALIBRATION, TUNING, clamp01, hasPress, pressDirection, squishPressure } from './feel.ts';

export interface TouchState {
  readonly fingerDown: boolean[];
  readonly grabActive: boolean[];
  readonly fingerPan: number[];
  /** deepest press (0..1 of the safe depth) during the current / last touch of each finger */
  readonly peakPress: number[];
  /** step count at which a release of that finger must stay quiet (the contact was handed to a pull or cancelled) */
  readonly skipRelease: number[];
  /** any finger or grab on the play body */
  contact(): boolean;
  /** live PULL LEVEL of a finger's grab, 0..1 (feel.ts "THE PULL SIGNAL"): metrics.pull when the body reports it, else the driver's own
   *  measure (requested target distance from the grab's start over the learned maximum pull). Keeps the last value after the release. */
  pull(slot: number): number;
  /** a snap of that finger came back with the body's pull level: learn the body's maximum pull distance from it */
  learnPull(slot: number, snapIntensity: number): void;
  /** a new play body: forget the learned maximum pull */
  resetPull(): void;
  /** seconds this finger has pressed the body (0 = not down): the squeeze in progress (visible XP, xp.ts) */
  heldFor(slot: number): number;
  /** seconds this finger's pull has been held (0 = no grab): the stretch in progress. 0 for a Shift pull's mirrored second hand: the pair is ONE stretch. */
  pullFor(slot: number): number;
  /** the slot holds the mirrored second grab of a Shift pull (gestures.ts SHIFT) right now */
  readonly mirrored: boolean[];
  /**
   * The SoftEvent ('grab' or 'snap') of `slot` that this sim step drains belongs to a Shift pull's mirrored second hand, whose grab / release
   * the driver made just before the step (call it while draining, after stepCount++). The first hand carries the pull's voice, sound, haptic,
   * pay and tasks; the second makes none of them (feedback.ts handle's `twin`, game.ts drain).
   */
  mirrorEvent(kind: 'grab' | 'snap', slot: number): boolean;
}

/**
 * A Shift pull holds the body with two hands, one of them dragged by the mirror of the pointer: pressing near the top of the dome and dragging
 * up sends the mirrored hand DOWN, far below the table. The physics has no answer for a two-handed grab target under the table (measured:
 * 3 of 38 real-physics Shift pulls turned the mesh inside out, volume -0.97 .. 3.08; none do with this clamp), so while a Shift pair is held
 * (and the table exists) neither hand is asked for a point lower than this many metres above it. A lone finger and two real fingers are untouched.
 */
export const SHIFT_FLOOR_Y = 0.02;

export interface Driver {
  readonly touch: TouchState;
  onAction(a: GestureAction): void;
  /** lift fingers whose minimum contact time has passed (call once per sim step, before body.step) */
  flushPendingUps(): void;
  /** track the deepest press per finger (call once per sim step, after body.step) */
  notePress(): void;
  /** release every finger and grab on the body. Each body call is guarded: cleanup can never throw. */
  releaseBody(): void;
}

export interface DriverDeps {
  body(): SoftBodyLike;
  stage: StageLike;
  simTime(): number;
  stepCount(): number;
  panOfPoint(p: V3): number;
  extraSquish(): boolean;
  /** a gesture was recognised (hides the hint) */
  interact(): void;
  /** the view changed (orbit / zoom) */
  dirty(): void;
  report(e: unknown): void;
}

export function createDriver(d: DriverDeps): Driver {
  const fingerDown = [false, false];
  const grabActive = [false, false];
  const fingerPan = [0, 0];
  const peakPress = [0, 0];
  const skipRelease = [-1, -1];
  const mirrored = [false, false];
  const mirrorGrabStep = [-1, -1];      // step count at which the mirrored grab's 'grab' event is drained (action time + 1)
  const mirrorSnapStep = [-1, -1];      // the same for the 'snap' of the mirrored release
  const downAt = [0, 0];
  const grabAt = [0, 0];
  const pendingAt = [-1, -1];
  const pendingWhy: Array<'tap' | 'release'> = ['tap', 'tap'];
  // the pull level the driver measures: grab start (world), requested distance from it, the body's maximum pull distance (learned)
  const g0x = [0, 0], g0y = [0, 0], g0z = [0, 0], pullDist = [0, 0];
  let maxPullD = 0;   // 0 = not learned yet (CALIBRATION.defaultMaxPullR x restRadius)
  const floorScratch: V3 = { x: 0, y: 0, z: 0 };   // the body copies the target at once, so one scratch serves every clamped call
  /** the target as the body gets it: a Shift pair's hands never go under the table (SHIFT_FLOOR_Y); everything else as asked */
  const handTarget = (slot: number, t: V3): V3 => {
    if ((!mirrored[slot] && !mirrored[1 - slot]) || t.y >= SHIFT_FLOOR_Y || !d.body().gravity) return t;
    floorScratch.x = t.x; floorScratch.y = SHIFT_FLOOR_Y; floorScratch.z = t.z;
    return floorScratch;
  };
  const notePull = (slot: number, t: V3): void => { pullDist[slot] = Math.hypot(t.x - g0x[slot], t.y - g0y[slot], t.z - g0z[slot]); };

  const touch: TouchState = {
    fingerDown, grabActive, fingerPan, peakPress, skipRelease, mirrored,
    mirrorEvent: (kind, slot) => (slot === 0 || slot === 1) && (kind === 'grab' ? mirrorGrabStep : mirrorSnapStep)[slot] === d.stepCount(),
    contact: () => fingerDown[0] || fingerDown[1] || grabActive[0] || grabActive[1] || pendingAt[0] >= 0 || pendingAt[1] >= 0,
    pull(slot) {
      const reported = (d.body().metrics as { pull?: number }).pull;   // a live pull level from the body, if it ever reports one
      if (typeof reported === 'number' && grabActive[slot]) return clamp01(reported);
      const md = maxPullD > 0 ? maxPullD : CALIBRATION.defaultMaxPullR * Math.max(1e-6, d.body().restRadius);
      return clamp01(pullDist[slot] / md);
    },
    learnPull(slot, I) {
      const dist = pullDist[slot];
      if (!(dist > 1e-6) || !Number.isFinite(I)) return;
      if (I > 0.05 && I < 0.98) maxPullD = dist / I;                       // an unclamped snap: the distance it read is exactly dist
      else if (I >= 0.98 && (maxPullD === 0 || maxPullD > dist)) maxPullD = dist;   // clamped at its limit: the limit is at most dist
    },
    resetPull() { maxPullD = 0; pullDist[0] = pullDist[1] = 0; },
    heldFor: (slot) => (fingerDown[slot] ? Math.max(1e-6, d.simTime() - downAt[slot]) : 0),
    pullFor: (slot) => (grabActive[slot] && !mirrored[slot] ? Math.max(1e-6, d.simTime() - grabAt[slot]) : 0),
  };

  /** let go of a slot's grab (the caller checked it is active); a mirrored one marks its release so its 'snap' is recognised as the second hand's */
  function endGrab(slot: Slot, body: SoftBodyLike): void {
    grabActive[slot] = false;
    if (mirrored[slot]) { mirrored[slot] = false; mirrorSnapStep[slot] = d.stepCount() + 1; }
    body.grabRelease(slot);
  }

  function executeUp(slot: Slot, why: 'tap' | 'release' | 'pull' | 'cancel'): void {
    pendingAt[slot] = -1;
    if (!fingerDown[slot]) return;
    fingerDown[slot] = false;
    if (why === 'pull' || why === 'cancel') skipRelease[slot] = d.stepCount() + 1;
    d.body().fingerUp(slot);
  }

  function onAction(a: GestureAction): void {
    const body = d.body();
    switch (a.type) {
      case 'fingerDown': {
        if (pendingAt[a.slot] >= 0) executeUp(a.slot, pendingWhy[a.slot]);
        else if (fingerDown[a.slot]) executeUp(a.slot, 'cancel');
        if (grabActive[a.slot]) endGrab(a.slot, body);
        body.fingerDown(a.slot, { point: a.hit.point, normal: a.hit.normal, dir: pressDirection(a.hit.normal, a.hit.dir, hasPress(body.metrics)) });
        fingerDown[a.slot] = true;
        downAt[a.slot] = d.simTime();
        peakPress[a.slot] = 0;
        fingerPan[a.slot] = d.panOfPoint(a.hit.point);
        break;
      }
      case 'fingerPressure': if (fingerDown[a.slot]) body.fingerPressure(a.slot, squishPressure(a.target, d.extraSquish())); break;
      case 'fingerMove': if (fingerDown[a.slot]) { body.fingerMove(a.slot, a.point); fingerPan[a.slot] = d.panOfPoint(a.point); } break;
      case 'fingerUp':
        if (a.why === 'tap' || a.why === 'release') {
          if (d.simTime() - downAt[a.slot] >= TUNING.minContactS) executeUp(a.slot, a.why);
          else { pendingAt[a.slot] = downAt[a.slot] + TUNING.minContactS; pendingWhy[a.slot] = a.why; }
        } else executeUp(a.slot, a.why);
        break;
      case 'grab':
        grabActive[a.slot] = true;
        mirrored[a.slot] = a.mirrorOf !== undefined;                 // the second hand of a Shift pull (gestures.ts SHIFT)
        if (mirrored[a.slot]) mirrorGrabStep[a.slot] = d.stepCount() + 1;
        fingerPan[a.slot] = d.panOfPoint(a.target);
        g0x[a.slot] = a.target.x; g0y[a.slot] = a.target.y; g0z[a.slot] = a.target.z; pullDist[a.slot] = 0;
        grabAt[a.slot] = d.simTime();
        body.grab(a.slot, a.vertex, handTarget(a.slot, a.target));
        break;
      case 'grabMove': if (grabActive[a.slot]) { body.grabMove(a.slot, handTarget(a.slot, a.target)); fingerPan[a.slot] = d.panOfPoint(a.target); notePull(a.slot, a.target); } break;
      case 'grabRelease':
        if (grabActive[a.slot]) endGrab(a.slot, body);
        break;
      case 'orbit':
        d.stage.orbit(TUNING.orbitSignYaw * a.dx * TUNING.orbitRadPerPx, TUNING.orbitSignPitch * a.dy * TUNING.orbitRadPerPx);
        d.dirty();
        break;
      case 'zoom':
        d.stage.zoom(a.delta * TUNING.zoomGain);
        d.dirty();
        break;
      case 'gesture':
        d.interact();
        break;
    }
  }

  return {
    touch,
    onAction,
    flushPendingUps() {
      const t = d.simTime();
      if (pendingAt[0] >= 0 && t >= pendingAt[0]) executeUp(0, pendingWhy[0]);
      if (pendingAt[1] >= 0 && t >= pendingAt[1]) executeUp(1, pendingWhy[1]);
    },
    notePress() {
      const p = d.body().metrics.press;
      if (typeof p !== 'number') return;
      if (fingerDown[0] && p > peakPress[0]) peakPress[0] = p;
      if (fingerDown[1] && p > peakPress[1]) peakPress[1] = p;
    },
    releaseBody() {
      const body = d.body();
      for (const s of [0, 1] as const) {
        if (grabActive[s]) { try { endGrab(s, body); } catch (e) { d.report(e); } }
        if (fingerDown[s] || pendingAt[s] >= 0) { try { executeUp(s, 'cancel'); } catch (e) { fingerDown[s] = false; pendingAt[s] = -1; d.report(e); } }
      }
    },
  };
}
