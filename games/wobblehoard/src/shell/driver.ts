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
}

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
  const downAt = [0, 0];
  const pendingAt = [-1, -1];
  const pendingWhy: Array<'tap' | 'release'> = ['tap', 'tap'];
  // the pull level the driver measures: grab start (world), requested distance from it, the body's maximum pull distance (learned)
  const g0x = [0, 0], g0y = [0, 0], g0z = [0, 0], pullDist = [0, 0];
  let maxPullD = 0;   // 0 = not learned yet (CALIBRATION.defaultMaxPullR x restRadius)
  const notePull = (slot: number, t: V3): void => { pullDist[slot] = Math.hypot(t.x - g0x[slot], t.y - g0y[slot], t.z - g0z[slot]); };

  const touch: TouchState = {
    fingerDown, grabActive, fingerPan, peakPress, skipRelease,
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
  };

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
        if (grabActive[a.slot]) { grabActive[a.slot] = false; body.grabRelease(a.slot); }
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
        fingerPan[a.slot] = d.panOfPoint(a.target);
        g0x[a.slot] = a.target.x; g0y[a.slot] = a.target.y; g0z[a.slot] = a.target.z; pullDist[a.slot] = 0;
        body.grab(a.slot, a.vertex, a.target);
        break;
      case 'grabMove': if (grabActive[a.slot]) { body.grabMove(a.slot, a.target); fingerPan[a.slot] = d.panOfPoint(a.target); notePull(a.slot, a.target); } break;
      case 'grabRelease':
        if (grabActive[a.slot]) { grabActive[a.slot] = false; body.grabRelease(a.slot); }
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
        if (grabActive[s]) { grabActive[s] = false; try { body.grabRelease(s); } catch (e) { d.report(e); } }
        if (fingerDown[s] || pendingAt[s] >= 0) { try { executeUp(s, 'cancel'); } catch (e) { fingerDown[s] = false; pendingAt[s] = -1; d.report(e); } }
      }
    },
  };
}
