// Every feel constant of the shell in one place, and the body CALIBRATION: the three places where the shell compensates for what the
// physics reports today. Audit finding 5 (shell.json): these used to be unguarded magic numbers inside app.ts.
//
// CALIBRATION rules
//   * Each compensation names the metric that would retire it and is applied only through the functions below.
//   * The round-2 metric `press` (contracts.ts SoftMetrics.press, real on every body since physics round 2) is the guard: a body that
//     reports it is driven on the CONTRACT scales: the squelch from max(compression, press), the release bubbles from the deepest press of
//     the touch (bubblePressAt), the pull from the contract's PULL LEVEL (below). bubbleAt and stretchFull apply ONLY to a body without
//     `press` (the slice body and the probe mocks).
//   * ONE compensation stays on for every body: the press-direction bend (pressDownLo / pressDownHi, `bendWithPress`). It is not a sound
//     or meter scale but the finger's travel direction: on an up-facing hit the finger pushes DOWN into the toy on the table instead of
//     along the line of sight. Measured with the physics-round-2 SoftBody (Dollop, 1280x800 default camera, a 1.4 s squeeze on 13 hit
//     points; _harness/shellview/node_checks.ts re-measures it every run): with the bend 12 of 13 squeezes end in a `release` event,
//     without it 3 of 13. Every up-facing hit (normal.y > 0.4, most of the visible body) dents fully (press 1.00) but reads compression
//     0.000-0.013 at the lift, and the physics fires `release` only for compression > 0.08 (softbody.ts fingerUp). Release events carry the
//     release bloop AND the meter's squeeze credit (collection/meterfeed.ts: release with heldFor >= 0.4 s), so retiring the bend today
//     would make most squeezes silent at the lift and pay nothing. Contract request (physics): fire `release` on max(compression, press)
//     at the lift; then set `bendWithPress` to false (node_checks.ts says when the measurement allows it). 2026-10-06: physics fix round 2
//     releases on max(compression, press) (13 of 13 without the bend), but the bend STAYS for the squash into the table (a dome press
//     without it only dents: compression 0.00 in the browser's held-squish checks); node_checks.ts now only requires that it may go.
//
// THE PULL SIGNAL (physics round 2, contracts.ts "PULL INTENSITY"): one 0..1 scale everywhere, the PULL LEVEL = how far the grab's
// target has been pulled from where the grab started, over the body's own maximum pull (1 = its family's maxPull, for every family).
//   * 'snap' intensity IS the pull level at the release: used as is (no 1/stretchFull rescale; that saturated every pull over ~30%).
//   * The held pull voice, the strand tension and the pull FX need it LIVE. The body does not report a live pull level (SoftBody's
//     pullLevel() is private; contract request: SoftMetrics.pull), so the driver computes the same quantity from what it sends: the
//     distance of the requested grab target from the grab's start, over the body's maximum pull distance, LEARNED from the body's own
//     snaps (maxD = distance / snap intensity for an unclamped snap; DEFAULT_MAX_PULL_R x restRadius until the first one). A body that
//     reports `metrics.pull` is read directly. metrics.stretch (the body's extent: 0.04-0.40 at a full pull depending on the family) is no
//     longer a pull signal for a press-reporting body.
import type { SoftMetrics, V3 } from '../contracts.ts';
import { clamp } from '../core/rng.ts';

export const TUNING = {
  maxDt: 1 / 20,
  /** a finger stays down at least this long in SIM time, so a sub-frame tap still reaches the body as a poke */
  minContactS: 0.09,
  orbitRadPerPx: 0.0075,
  /** sign of stage.orbit(dYaw, dPitch) for a drag right / drag down. stage.ts: "pass (dx * k, dy * k) of a pointer drag and the scene turns with the finger". */
  orbitSignYaw: 1,
  orbitSignPitch: 1,
  /** stage.zoom(delta): wheel notches in, stage units out */
  zoomGain: 1,
  panMax: 0.8,
  /** fallback compensation, see CALIBRATION.pressDownLo */
  pressDownLo: 0.2,
  pressDownHi: 0.45,
  /** fallback compensation, see CALIBRATION.bubbleAt */
  bubbleAt: 0.3,
  bubbleFull: 0.6,
  /** fallback compensation, see CALIBRATION.stretchFull */
  stretchFull: 0.35,
  consecutiveFrameErrorsFatal: 5,
  recentEvents: 32,
  /** Extra squish (Settings.extraSquish): the pressure target is pushed this fraction of the way toward full depth. */
  extraSquish: 0.45,
} as const;

export const CALIBRATION = {
  /** Press-direction bend: on up-facing hits (normal.y above lo) the finger travel is bent toward straight down, fully at hi. */
  pressDownLo: TUNING.pressDownLo,
  pressDownHi: TUNING.pressDownHi,
  /** Keep the bend for bodies that report `press`. Physics fix round 2 (2026-10-06) fires `release` on max(compression, press), so the
   *  releases no longer need it (node_checks.ts: 13 of 13 without it), but it stays for the FEEL: a press on the dome goes DOWN and squashes
   *  the toy into the table (without it the same hold only dents the dome: compression 0.00 in the browser checks). */
  bendWithPress: true,
  /** Release FX on a body WITHOUT `press`: bubbles + pops above this release intensity (the slice body reported 0.35-0.57 for a hard squeeze). */
  bubbleAt: TUNING.bubbleAt,
  bubbleFull: TUNING.bubbleFull,
  /** Release FX on a body WITH `press`: the deepest press of the touch (0..1 of the safe depth) gates the bubbles (contract scale). */
  bubblePressAt: 0.7,
  bubblePressFull: 1,
  /** Body WITHOUT press only: stretch / stretchFull (and the snap intensity, then metrics.stretch at the release) is the pull level. */
  stretchFull: TUNING.stretchFull,
  /** The pull level's maximum distance, in rest radii, until the body's first snap teaches the real one (contracts.ts: ~1.7 R jelly gel). */
  defaultMaxPullR: 1.7,
} as const;

export const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/** The body reports the round-2 `press` metric (contracts.ts: consumers treat undefined as 0, so presence is the feature test). */
export const hasPress = (m: SoftMetrics): boolean => typeof m.press === 'number';

/** Squeeze depth for the squelch voice, haptics and FX: max(compression, press) when press exists (contracts.ts SoftMetrics.press). */
export const squeezeDepth = (m: SoftMetrics): number => (typeof m.press === 'number' ? Math.max(m.compression, m.press) : m.compression);

/** Finger travel direction for a press at a hit with outward `normal` and camera ray `dir`. Allocates only when it bends (fingerDown). */
export function pressDirection(normal: V3, dir: V3, bodyHasPress: boolean): V3 {
  if (bodyHasPress && !CALIBRATION.bendWithPress) return dir;
  const lo = CALIBRATION.pressDownLo, hi = CALIBRATION.pressDownHi;
  const t = hi <= lo ? 0 : clamp((normal.y - lo) / (hi - lo), 0, 1);
  const k = t * t * (3 - 2 * t);
  if (k <= 0) return dir;
  const x = dir.x * (1 - k), y = dir.y * (1 - k) - k, z = dir.z * (1 - k);
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

/** A body without press (slice semantics): metrics.stretch, or a snap intensity (then the stretch at the release), as a pull level. */
export const stretchPullLevel = (stretch: number): number => clamp01(stretch / CALIBRATION.stretchFull);

/** 0..1 pull level of a 'snap' (contracts.ts PULL INTENSITY): the intensity itself on a round-2 body, rescaled stretch on a slice body. */
export const snapPullLevel = (intensity: number, bodyHasPress: boolean): number => (bodyHasPress ? clamp01(intensity) : stretchPullLevel(intensity));

/**
 * Release FX level: 0 = no bubbles, else 0..1 (how many pops: 1 + floor(level * 2.999)). Without `press`: the release intensity against
 * bubbleAt / bubbleFull (the slice compensation). With `press`: the deepest press of the touch against bubblePressAt / bubblePressFull.
 */
export function releaseFxLevel(intensity: number, peakPress: number, bodyHasPress: boolean): number {
  if (bodyHasPress) {
    const d = clamp01(Math.max(peakPress, intensity));
    if (d < CALIBRATION.bubblePressAt) return 0;
    return Math.max(1e-3, clamp01((d - CALIBRATION.bubblePressAt) / Math.max(1e-6, CALIBRATION.bubblePressFull - CALIBRATION.bubblePressAt)));
  }
  const I = clamp01(intensity);
  if (!(I > CALIBRATION.bubbleAt)) return 0;
  return Math.max(1e-3, clamp01((I - CALIBRATION.bubbleAt) / (CALIBRATION.bubbleFull - CALIBRATION.bubbleAt)));
}

/** Extra squish: push the pressure target toward full depth (1 stays 1, 0 stays 0). */
export const squishPressure = (target: number, extra: boolean): number => (extra ? 1 - (1 - clamp01(target)) * (1 - TUNING.extraSquish) : clamp01(target));
