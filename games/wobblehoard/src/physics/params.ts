// Every tuned constant of the soft body lives here, with the reason it has that value. The numbers were tuned by
// LOOKING at the filmstrips (_harness/browser_physics.mjs -> _shots/phys/*.png) and by the numeric gates of
// _harness/probe_softbody.ts; the "tuned:" notes record what moved them.
import type { Genome } from '../core/genome.ts';
import { clamp, lerp } from '../core/rng.ts';

/** Fixed internal time step. 6 substeps per 60 Hz frame, 1 XPBD iteration each (small-step XPBD: stiffness from step size, not iteration count). */
export const SUBSTEPS_PER_FRAME = 6;
export const H = 1 / (60 * SUBSTEPS_PER_FRAME);
/** step(dt) clamps dt to [0, MAX_DT]; that is at most MAX_SUBSTEPS fixed substeps per call. */
export const MAX_DT = 1 / 20;
export const MAX_SUBSTEPS = Math.ceil(MAX_DT / H + 1e-9);

/** Gravity (m/s^2). A toy this size reads as light and quick: real g would look like a heavy water bag. */
export const GRAVITY = 15;

export interface SoftParams {
  /** Shape-matching natural frequency (rad/s): how hard the body is pulled to its rest shape. From firmness. */
  smOmega: number;
  /** Edge compliance in XPBD units at the nominal step: alpha_tilde = alpha / h^2. From stretch. */
  edgeAlphaT: number;
  /** Strain beyond which the edge skin hardens (the "resists" part of stretch). From stretch. */
  edgeSoftStrain: number;
  /** Volume-constraint compliance relative to the constraint's own scale (alpha_tilde = kappa * S0). Lower = more incompressible. */
  volKappa: number;
  /** Internal (non-rigid) velocity damping rate, 1/s. From bounce. */
  intDamp: number;
  /** Tiny global drag, 1/s. */
  drag: number;
  /** Table Coulomb friction coefficient. */
  tableMu: number;
  /** Max pull distance of a grab, in rest radii. From stretch. */
  maxPull: number;
}

export function deriveParams(g: Genome): SoftParams {
  const f = clamp(g.firmness, 0, 1), b = clamp(g.bounce, 0, 1), s = clamp(g.stretch, 0, 1);
  return {
    smOmega: lerp(13, 36, f),
    edgeAlphaT: lerp(0.05, 0.7, s),
    edgeSoftStrain: lerp(0.10, 0.55, s),
    volKappa: 0.5,
    intDamp: lerp(11, 1.6, Math.pow(b, 0.9)),
    drag: 0.18,
    tableMu: 0.85,
    maxPull: 1.0 + 1.4 * s,
  };
}

/** Finger / contact constants. */
export const FINGER = {
  /** Critically damped depth response: omega (rad/s) -> ~95% in 79 ms. */
  omega: 60,
  /** fingerUp retracts the tip linearly in this many seconds (contract: <= 60 ms). */
  retractS: 0.05,
  /** Tip radius as a fraction of restRadius: fingertip -> palm. */
  rMin: 0.2, rMax: 0.45,
  /** A single finger may push at most this fraction of the body thickness along its direction. */
  maxThickness: 0.72,
  /** The two tips of a pinch keep this clearance (in rest radii) between their surfaces. */
  pinchGap: 0.3,
  /** Held >= this long (s) and in contact -> 'press' event. */
  pressAfterS: 0.18,
  /** Pointer slide low-pass (1/s) so a jumpy pointer never teleports the kinematic tip. */
  slideRate: 38,
};

export const EVENT_MIN_GAP_S = 0.05;
