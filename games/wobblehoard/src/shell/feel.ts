// Every feel constant of the shell in one place, and the body CALIBRATION: the three places where the shell compensates for what the
// physics reports today. Audit finding 5 (shell.json): these used to be unguarded magic numbers inside app.ts.
//
// CALIBRATION rules
//   * Each compensation names the metric that would retire it and is applied only through the functions below.
//   * The round-2 metric `press` (contracts.ts SoftMetrics.press) is the guard: a body that reports it is driven on the CONTRACT scales
//     wherever `press` actually replaces the compensation (squelch depth, release FX).
//   * Two compensations are NOT replaced by `press` and stay on for every body until physics changes (measured with the real SoftBody at
//     checkpoint 24, 2026-10-05, default camera 1280x800, Dollop, scratch script calib2.ts; re-measured by _harness/shellview/node_checks.ts,
//     which fails loudly when the physics changes enough to retire them):
//       - the press-direction bend: without it a squeeze of 1.4 s gave a `release` event on 3 of 13 hit points, with it on 12 of 13
//         (release needs compression > 0.08 along the press axis at lift: contract 4.1). Release events are what blooping, bubbles AND the
//         meter's squeeze credit (DESIGN 5.4) hang on, so retiring the bend today would make most squeezes pay nothing.
//       - the stretch rescale: a full pull (grab target 2.2 rest radii out) reports metrics.stretch 0.30 and snap 0.28, while the contract
//         says 1 = pulled to about 2.2x. Without the rescale every pull sounds and looks like a third of a pull.
//     Set `bendWithPress` / `rescaleStretchWithPress` to false to drive a press-reporting body purely on the contract (the SHELL-2a brief's
//     literal reading); the node checks print what that costs.
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
  /** Keep the bend for bodies that report `press` (see the header: 12/13 vs 3/13 release events). */
  bendWithPress: true,
  /** Release FX on a body WITHOUT `press`: bubbles + pops above this release intensity (the slice body reported 0.35-0.57 for a hard squeeze). */
  bubbleAt: TUNING.bubbleAt,
  bubbleFull: TUNING.bubbleFull,
  /** Release FX on a body WITH `press`: the deepest press of the touch (0..1 of the safe depth) gates the bubbles (contract scale). */
  bubblePressAt: 0.7,
  bubblePressFull: 1,
  /** Stretch rescale: stretch / stretchFull drives the pull sound and FX (a full pull reads ~1). */
  stretchFull: TUNING.stretchFull,
  rescaleStretchWithPress: true,
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

/** Multiplier from metrics.stretch to "pull level" (1 / stretchFull while the rescale applies, else 1). */
export const pullScale = (bodyHasPress: boolean): number => (bodyHasPress && !CALIBRATION.rescaleStretchWithPress ? 1 : 1 / CALIBRATION.stretchFull);

/** 0..1 "how hard was that pull" from a stretch value (metrics.stretch or a snap intensity). */
export const pullLevel = (stretch: number, bodyHasPress: boolean): number => clamp01(stretch * pullScale(bodyHasPress));

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
