// Gesture actions (src/input/gestures.ts) -> the play body and the camera. Owns the per-finger touch state the feedback layer reads:
// which fingers are down or pulling, the pan of each contact, the deepest press of the current touch, and the "this contact became a pull
// (or was cancelled): no release bloop" marker.
//
// LOCK (_spec/LOCK.md, SHELL half): five finger / grab slots (touch fingers use 2 to 4), and the lock mechanics the input port calls: `lockPulls` (a Shift tap
// locks every fully stretched pull, feature-detected on the body), `releaseLockAt` (a press on a locked lobe), `releaseLocks` (Esc, leaving), `lockCount`
// and `fillMarkers` (where the lobes are held, for the stage's thin marker). The shell never counts on the order of the body's lock list: it asks the body
// (`lockAt`) which lock a point is on, and its own list of locked vertices (for the markers only) is pruned against the body's `metrics.locked`.
import type { SoftBodyLike, StageLike, V3 } from '../contracts.ts';
import type { GestureAction, Slot } from '../input/gestures.ts';
import { CALIBRATION, TUNING, clamp01, hasPress, pressDirection, squishPressure } from './feel.ts';

/** the finger / grab slots (LOCK: the old two plus three for touch fingers) */
export const SLOT_COUNT = 5;
/** the locks the shell keeps a marker for (the physics allows at most 6, 4 on low quality) */
export const LOCK_TRACK_MAX = 8;

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
  /**
   * The drag of a real finger's grab on the body: where its hand is now less where the grab began (world space of the body), written into
   * `out`. False while no finger holds a grab: a tap, a press, a squeeze or a rub is no drag, and a Shift pull's mirrored second hand is not a
   * finger. cut.ts reads it: a piece joins another only when the player DRAGS it into the other (CUT.md 1), never because a finger happens to
   * rest on a piece that lies beside its twin (SHELL-4 fix 1, VERIFY A-F2).
   */
  dragOf(out: V3): boolean;
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
  /** release every finger and grab on the body. Each body call is guarded: cleanup can never throw. LOCKS are not touched (releaseLocks). */
  releaseBody(): void;
  /**
   * LOCK: a Shift tap. Asks the body to lock every pull held right now (the mirrored second hand too); the body locks only a grab whose pull level is at least
   * 0.95 and refuses past its limit, and a body without `lockGrab` locks nothing. Returns how many locked (0 = nothing happened: the caller plays no sound).
   * A locked slot is free at once: the pointer that held it keeps its press, but its moves and its release no longer reach the body.
   */
  lockPulls(): number;
  /** LOCK: lobes locked now, on every body the driver watches (the body's `metrics.locked`, else what it locked itself) */
  lockCount(): number;
  /** LOCK: a press landed at this body-space point of the ACTIVE body: if it is on a locked lobe, let that one go (it snaps back and pays as a pull). True = a lock was released. */
  releaseLockAt(point: V3): boolean;
  /** LOCK: let every lock go, on every body (Esc, leaving); each snaps back and pays as a pull. True when there was any. */
  releaseLocks(): boolean;
  /**
   * LOCK: the world points where the lobes are held now (the grabbed vertex of each lock, drawn offset by `offsetOf(body)`), written into `out` in place (no
   * allocation once warm). The list is pruned against the bodies first. Returns the count.
   */
  fillMarkers(out: V3[], offsetOf?: (b: SoftBodyLike) => V3): number;
}

export interface DriverDeps {
  body(): SoftBodyLike;
  /** every body a lock may sit on (the play body and the mat's): Esc and leaving release them all. Default: the active body only. */
  bodies?(): readonly SoftBodyLike[];
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

const N = SLOT_COUNT;
const falses = (): boolean[] => new Array<boolean>(N).fill(false);
const zeros = (): number[] => new Array<number>(N).fill(0);
const neg = (): number[] => new Array<number>(N).fill(-1);

export function createDriver(d: DriverDeps): Driver {
  const fingerDown = falses();
  const grabActive = falses();
  const fingerPan = zeros();
  const peakPress = zeros();
  const skipRelease = neg();
  const mirrored = falses();
  const mirrorGrabStep = neg();      // step count at which the mirrored grab's 'grab' event is drained (action time + 1)
  const mirrorSnapStep = neg();      // the same for the 'snap' of the mirrored release
  const downAt = zeros();
  const grabAt = zeros();
  const grabVertex = zeros();        // the vertex each grab holds (the lock marker's anchor)
  const pendingAt = neg();
  const pendingWhy: Array<'tap' | 'release'> = new Array<'tap' | 'release'>(N).fill('tap');
  // the pull level the driver measures: grab start (world), requested distance from it, the body's maximum pull distance (learned)
  const g0x = zeros(), g0y = zeros(), g0z = zeros(), pullDist = zeros();
  const gtx = zeros(), gty = zeros(), gtz = zeros();   // where each grab's hand is now (the last requested target)
  let maxPullD = 0;   // 0 = not learned yet (CALIBRATION.defaultMaxPullR x restRadius)
  const floorScratch: V3 = { x: 0, y: 0, z: 0 };   // the body copies the target at once, so one scratch serves every clamped call
  /** the target as the body gets it: a Shift pair's hands never go under the table (SHIFT_FLOOR_Y); everything else as asked */
  const handTarget = (slot: number, t: V3): V3 => {
    if ((!mirrored[slot] && !(slot < 2 && mirrored[1 - slot])) || t.y >= SHIFT_FLOOR_Y || !d.body().gravity) return t;
    floorScratch.x = t.x; floorScratch.y = SHIFT_FLOOR_Y; floorScratch.z = t.z;
    return floorScratch;
  };
  const notePull = (slot: number, t: V3): void => { gtx[slot] = t.x; gty[slot] = t.y; gtz[slot] = t.z; pullDist[slot] = Math.hypot(t.x - g0x[slot], t.y - g0y[slot], t.z - g0z[slot]); };

  // ---- LOCK: the shell's own list of what it locked (the vertex each lock holds), for the markers; the body's lock list is the truth
  let lockN = 0;
  const lockBody: Array<SoftBodyLike | null> = new Array<SoftBodyLike | null>(LOCK_TRACK_MAX).fill(null);
  const lockVertex = new Array<number>(LOCK_TRACK_MAX).fill(0);
  let lockSnapAt = -1;   // step count at which a lock release's 'snap' is drained (learnPull ignores it: its slot may hold a newer pull)
  const bodiesNow = (): readonly SoftBodyLike[] => (d.bodies ? d.bodies() : [d.body()]);
  /** LOCK.md rule 4: at most 6 locked lobes, 4 on the low quality tier. The physics keeps the cap in `maxLocks` (not a contract member: feature-detected); it is set at every lock, so a tier change takes effect at once. */
  const lockCap = (): number => { try { return d.stage.stats().tier === 'low' ? 4 : 6; } catch { return 6; } };
  const trackedOn = (b: SoftBodyLike): number => { let n = 0; for (let i = 0; i < lockN; i++) if (lockBody[i] === b) n++; return n; };
  /** metrics.locked is a readout valid after step(): between a lock or a release made by the shell and the next sim step it is one step behind (it still says the old count), so
   *  in that window the shell's own list is the count; after it the readout counts too (a lock the shell did not track, past LOCK_TRACK_MAX, is still a hand) */
  let touchedAt = -1;   // the step count at which the shell last locked or released
  const reportedOn = (b: SoftBodyLike): number => { const m = (b.metrics as { locked?: number }).locked; return typeof m === 'number' ? m : 0; };
  const lockedOn = (b: SoftBodyLike): number => (d.stepCount() === touchedAt ? trackedOn(b) : Math.max(reportedOn(b), trackedOn(b)));
  function untrack(i: number): void {
    for (let k = i; k < lockN - 1; k++) { lockBody[k] = lockBody[k + 1]; lockVertex[k] = lockVertex[k + 1]; }
    lockN--;
    lockBody[lockN] = null;
  }
  const vx = (b: SoftBodyLike, v: number): number => b.positions[v * 3];
  const vy = (b: SoftBodyLike, v: number): number => b.positions[v * 3 + 1];
  const vz = (b: SoftBodyLike, v: number): number => b.positions[v * 3 + 2];
  const probe: V3 = { x: 0, y: 0, z: 0 };
  /** forget tracked locks the body no longer has: a body that is gone, or a vertex that is no longer on a lock's patch (asked of the body itself, which is always current;
   *  `force` asks even when the body's readout says all is well, as right after a release). A body that cannot answer `lockAt` is trusted by its readout. */
  function prune(force: boolean): void {
    if (lockN === 0) return;
    const live = bodiesNow();
    for (let i = lockN - 1; i >= 0; i--) {
      const b = lockBody[i]!;
      let keep = live.indexOf(b) >= 0;
      if (keep) {
        if (typeof b.lockAt === 'function') {
          if (force || trackedOn(b) > reportedOn(b)) {
            probe.x = vx(b, lockVertex[i]); probe.y = vy(b, lockVertex[i]); probe.z = vz(b, lockVertex[i]);
            try { keep = b.lockAt(probe) >= 0; } catch (e) { d.report(e); }
          }
        } else keep = reportedOn(b) > 0;
      }
      if (!keep) untrack(i);
    }
  }

  const touch: TouchState = {
    fingerDown, grabActive, fingerPan, peakPress, skipRelease, mirrored,
    mirrorEvent: (kind, slot) => slot >= 0 && slot < N && (kind === 'grab' ? mirrorGrabStep : mirrorSnapStep)[slot] === d.stepCount(),
    contact() {
      for (let s = 0; s < N; s++) if (fingerDown[s] || grabActive[s] || pendingAt[s] >= 0) return true;
      return false;
    },
    pull(slot) {
      const reported = (d.body().metrics as { pull?: number }).pull;   // a live pull level from the body, if it ever reports one
      if (typeof reported === 'number' && grabActive[slot]) return clamp01(reported);
      const md = maxPullD > 0 ? maxPullD : CALIBRATION.defaultMaxPullR * Math.max(1e-6, d.body().restRadius);
      return clamp01(pullDist[slot] / md);
    },
    learnPull(slot, I) {
      if (lockSnapAt === d.stepCount()) return;   // the snap of a released lock: its slot may hold a newer pull, whose distance says nothing about this one
      const dist = pullDist[slot];
      if (!(dist > 1e-6) || !Number.isFinite(I)) return;
      if (I > 0.05 && I < 0.98) maxPullD = dist / I;                       // an unclamped snap: the distance it read is exactly dist
      else if (I >= 0.98 && (maxPullD === 0 || maxPullD > dist)) maxPullD = dist;   // clamped at its limit: the limit is at most dist
    },
    resetPull() { maxPullD = 0; pullDist.fill(0); },
    heldFor: (slot) => (fingerDown[slot] ? Math.max(1e-6, d.simTime() - downAt[slot]) : 0),
    pullFor: (slot) => (grabActive[slot] && !mirrored[slot] ? Math.max(1e-6, d.simTime() - grabAt[slot]) : 0),
    dragOf(out) {
      let best = -1, bd = -1;
      for (let s = 0; s < N; s++) {
        if (!grabActive[s] || mirrored[s]) continue;
        const l = Math.hypot(gtx[s] - g0x[s], gty[s] - g0y[s], gtz[s] - g0z[s]);
        if (l > bd) { bd = l; best = s; }
      }
      if (best < 0) return false;
      out.x = gtx[best] - g0x[best]; out.y = gty[best] - g0y[best]; out.z = gtz[best] - g0z[best];
      return true;
    },
  };

  /** let go of a slot's grab (the caller checked it is active); a mirrored one marks its release so its 'snap' is recognised as the second hand's */
  function endGrab(slot: Slot, body: SoftBodyLike, still?: boolean): void {
    grabActive[slot] = false;
    if (mirrored[slot]) { mirrored[slot] = false; mirrorSnapStep[slot] = d.stepCount() + 1; }
    body.grabRelease(slot as 0 | 1, still);   // (contracts.ts still types grabRelease / fingerUp 0 | 1; every slot of the five is accepted at run time; `still`: round 14 CARRY)
  }

  function executeUp(slot: Slot, why: 'tap' | 'release' | 'pull' | 'cancel'): void {
    pendingAt[slot] = -1;
    if (!fingerDown[slot]) return;
    fingerDown[slot] = false;
    if (why === 'pull' || why === 'cancel') skipRelease[slot] = d.stepCount() + 1;
    d.body().fingerUp(slot as 0 | 1);
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
        gtx[a.slot] = a.target.x; gty[a.slot] = a.target.y; gtz[a.slot] = a.target.z;
        grabAt[a.slot] = d.simTime();
        grabVertex[a.slot] = a.vertex;
        body.grab(a.slot, a.vertex, handTarget(a.slot, a.target));
        if (a.lift) body.lift?.(a.slot);   // (round 14, CARRY: the drag that starts on the body picks it up at once)
        break;
      case 'grabMove': if (grabActive[a.slot]) { body.grabMove(a.slot, handTarget(a.slot, a.target)); fingerPan[a.slot] = d.panOfPoint(a.target); notePull(a.slot, a.target); } break;
      case 'grabRelease':
        if (grabActive[a.slot]) endGrab(a.slot, body, a.still);
        break;
      case 'orbit':
        d.stage.orbit(TUNING.orbitSignYaw * a.dx * TUNING.orbitRadPerPx, TUNING.orbitSignPitch * a.dy * TUNING.orbitRadPerPx);
        d.dirty();
        break;
      case 'zoom':
        d.stage.zoom(a.delta * TUNING.zoomGain);
        d.dirty();
        break;
      case 'pan':   // (round 14, R14_ROOMS: the room camera's pan; a stage without it ignores it)
        d.stage.pan?.(a.dx, a.dy);
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
      for (let s = 0; s < N; s++) if (pendingAt[s] >= 0 && t >= pendingAt[s]) executeUp(s as Slot, pendingWhy[s]);
    },
    notePress() {
      const p = d.body().metrics.press;
      if (typeof p !== 'number') return;
      for (let s = 0; s < N; s++) if (fingerDown[s] && p > peakPress[s]) peakPress[s] = p;
    },
    releaseBody() {
      const body = d.body();
      for (let s = 0; s < N; s++) {
        if (grabActive[s]) { try { endGrab(s as Slot, body); } catch (e) { d.report(e); } }
        if (fingerDown[s] || pendingAt[s] >= 0) { try { executeUp(s as Slot, 'cancel'); } catch (e) { fingerDown[s] = false; pendingAt[s] = -1; d.report(e); } }
      }
    },

    lockPulls() {
      const body = d.body();
      if (typeof body.lockGrab !== 'function') return 0;
      const capped = body as { maxLocks?: number };
      if (typeof capped.maxLocks === 'number') capped.maxLocks = lockCap();
      let n = 0;
      // the primary hand of a Shift pair first, then its mirrored twin (slot order does that for a mouse: the pointer's slot is the lower one or not, either way each is asked once)
      for (let s = 0; s < N; s++) {
        if (!grabActive[s]) continue;
        let ok = false;
        try { ok = body.lockGrab(s) === true; } catch (e) { d.report(e); }
        if (!ok) continue;
        n++;
        grabActive[s] = false;      // the slot is free: the pointer's later moves and its release are no-ops here
        mirrored[s] = false;        // (a locked twin is a lock like any other: no mirror marking, its release pays as a pull)
        if (lockN < LOCK_TRACK_MAX) { lockBody[lockN] = body; lockVertex[lockN] = grabVertex[s]; lockN++; }
      }
      if (n > 0) touchedAt = d.stepCount();
      return n;
    },
    lockCount() {
      let n = 0;
      for (const b of bodiesNow()) n += lockedOn(b);
      return n;
    },
    releaseLockAt(point) {
      const b = d.body();
      if (typeof b.lockAt !== 'function' || typeof b.releaseLock !== 'function' || lockedOn(b) === 0) return false;
      let i = -1;
      try { i = b.lockAt(point); } catch (e) { d.report(e); }
      if (!(i >= 0)) return false;
      lockSnapAt = d.stepCount() + 1;
      touchedAt = d.stepCount();
      try { b.releaseLock(i); } catch (e) { d.report(e); return false; }
      prune(true);
      return true;
    },
    releaseLocks() {
      let any = false;
      for (const b of bodiesNow()) {
        if (typeof b.releaseLock !== 'function' || lockedOn(b) === 0) continue;
        any = true;
        lockSnapAt = d.stepCount() + 1;
        try { b.releaseLock('all'); } catch (e) { d.report(e); }
      }
      if (any) touchedAt = d.stepCount();
      while (lockN > 0) untrack(lockN - 1);
      return any;
    },
    fillMarkers(out, offsetOf) {
      prune(false);
      while (out.length > lockN) out.pop();
      for (let i = 0; i < lockN; i++) {
        const b = lockBody[i]!, v = lockVertex[i];
        const o = offsetOf ? offsetOf(b) : null;
        let p = out[i];
        if (!p) { p = { x: 0, y: 0, z: 0 }; out.push(p); }
        p.x = vx(b, v) + (o ? o.x : 0); p.y = vy(b, v) + (o ? o.y : 0); p.z = vz(b, v) + (o ? o.z : 0);
      }
      return lockN;
    },
  };
}
