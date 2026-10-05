// Gesture actions (src/input/gestures.ts) -> the play body and the camera. Owns the per-finger touch state the feedback layer reads:
// which fingers are down or pulling, the pan of each contact, the deepest press of the current touch, and the "this contact became a pull
// (or was cancelled): no release bloop" marker.
import type { SoftBodyLike, StageLike, V3 } from '../contracts.ts';
import type { GestureAction, Slot } from '../input/gestures.ts';
import { TUNING, hasPress, pressDirection, squishPressure } from './feel.ts';

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

  const touch: TouchState = {
    fingerDown, grabActive, fingerPan, peakPress, skipRelease,
    contact: () => fingerDown[0] || fingerDown[1] || grabActive[0] || grabActive[1] || pendingAt[0] >= 0 || pendingAt[1] >= 0,
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
        body.grab(a.slot, a.vertex, a.target);
        break;
      case 'grabMove': if (grabActive[a.slot]) { body.grabMove(a.slot, a.target); fingerPan[a.slot] = d.panOfPoint(a.target); } break;
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
