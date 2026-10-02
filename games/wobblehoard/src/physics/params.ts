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

/** Gravity (m/s^2). Game scale: a ~0.5 m toy at 10 m/s^2 reads as light and quick (real g would look like a heavy water bag). */
export const GRAVITY = 10;

export interface SoftParams {
  /** Shape-matching natural frequency (rad/s): how hard the body is pulled to its rest shape. From firmness. */
  smOmega: number;
  /** Laplacian shape-memory gain per substep (0..~0.3): local dent smoothing and recovery. From firmness. */
  bendK: number;
  /** Edge compliance in XPBD units at the nominal step: alpha_tilde = alpha / h^2. From stretch. */
  edgeAlphaT: number;
  /** Strain beyond which the edge skin hardens (the "resists" part of stretch). From stretch. */
  edgeSoftStrain: number;
  /** Volume-constraint compliance relative to the constraint's own scale (alpha_tilde = kappa * S0). Lower = more incompressible. */
  volKappa: number;
  /** Local (non-affine) internal velocity damping rate, 1/s: the peak flop and ripples. From bounce. */
  intDamp: number;
  /** Global (affine: squash / stretch / shear) internal damping rate, 1/s: stops the whole body bouncing like a ball. From bounce. */
  affDamp: number;
  /** Extra internal damping per m/s of internal speed (1/m): kills the fast release spike but leaves the small jiggle alone. From bounce. */
  intDamp2: number;
  /** Tiny global drag, 1/s. */
  drag: number;
  /** Table Coulomb friction coefficient. */
  tableMu: number;
  /** Fraction of the upward centre-of-mass velocity removed per substep while the foot is down (tacky table: no hop). */
  groundDamp: number;
  /** Viscous tack: fraction of its upward speed a foot particle (within ~1 cm of the table) loses per substep. */
  footVisc: number;
  /** Tack layer (m): a foot particle that would lift off the table by less than this in one substep stays glued to it, so
   *  small springs-back never peel the foot (no hop); a real launch (a nudge, a hard rebound) still leaves. */
  glue: number;
  /** How deep a finger may press, as a fraction of the body thickness (firmer = shallower: a firm toy cannot be squashed as far). */
  squashDepth: number;
  /** Stiffness multiplier (shape matching + Laplacian) at the very tip of the swirl-peak: lower = floppier. */
  peakSoft: number;
  /** Max pull distance of a grab, in rest radii. From stretch. */
  maxPull: number;
}

export function deriveParams(g: Genome): SoftParams {
  const f = clamp(g.firmness, 0, 1), b = clamp(g.bounce, 0, 1), s = clamp(g.stretch, 0, 1);
  return {
    smOmega: lerp(12, 40, f),
    bendK: lerp(0.02, 0.1, f),
    edgeAlphaT: lerp(3, 5.5, s),
    edgeSoftStrain: lerp(0.35, 1.6, s),
    volKappa: 0.5,
    intDamp: lerp(8, 1, Math.pow(b, 0.9)),
    affDamp: lerp(6, 1, b) + 4 * f,
    intDamp2: lerp(8, 0, b),
    drag: 0.18,
    tableMu: 1.5,
    groundDamp: 0,
    glue: 0.008,
    squashDepth: lerp(0.66, 0.34, f),
    peakSoft: 0.35,
    footVisc: 0,
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
  /** Coulomb friction between the fingertip and the skin (tacky: the surface follows the finger). */
  friction: 0.9,
  /** ...pressing a free flank (no table behind it) goes at most this fraction of squashDepth (see SoftParams). */
  flankShare: 0.75,
  /** Each jaw of a two-finger pinch keeps this fraction of its depth range. */
  pinchShare: 0.62,
  /** The two tips of a pinch keep this clearance (in rest radii) between their surfaces. */
  pinchGap: 0.3,
  /** Held >= this long (s) and in contact -> 'press' event. */
  pressAfterS: 0.18,
  /** Pointer slide low-pass (1/s) so a jumpy pointer never teleports the kinematic tip. */
  slideRate: 38,
};

export const EVENT_MIN_GAP_S = 0.05;
