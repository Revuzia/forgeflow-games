// Every tuned constant of the soft body lives here, with the reason it has that value. The numbers were tuned by
// LOOKING at the filmstrips (_harness/browser_physics.mjs -> _shots/phys/*.png) and by the numeric gates of
// _harness/probe_softbody.ts; the "tuned:" notes record what moved them and what broke when they moved the other way.
import type { Genome } from '../core/genome.ts';
import { lerp } from '../core/rng.ts';
import { physicsGenome, restRadiusOf } from './shape.ts';

/** Fixed internal time step. 6 substeps per 60 Hz frame, 1 XPBD iteration each (small-step XPBD: stiffness from step size, not iteration count). */
export const SUBSTEPS_PER_FRAME = 6;
export const H = 1 / (60 * SUBSTEPS_PER_FRAME);
/** step(dt) clamps dt to [0, MAX_DT]; that is at most MAX_SUBSTEPS fixed substeps per call. */
export const MAX_DT = 1 / 20;
export const MAX_SUBSTEPS = Math.ceil(MAX_DT / H + 1e-9);

/** Gravity (m/s^2). Game scale: a ~0.5 m toy at 10 m/s^2 reads as light and quick (real g would look like a heavy water bag). */
export const GRAVITY = 10;

export interface SoftParams {
  /** Shape-matching natural frequency (rad/s): how hard the body is pulled to its rest shape. From firmness, divided by size. */
  smOmega: number;
  /** Laplacian shape-memory gain per substep (0..~0.3): local dent smoothing and recovery. From firmness. */
  bendK: number;
  /** Edge compliance in XPBD units at the nominal step: alpha_tilde = alpha / h^2. From stretch. */
  edgeAlphaT: number;
  /** Strain beyond which the edge skin hardens (the "resists" part of stretch). From stretch. */
  edgeSoftStrain: number;
  /** Edge compliance multiplier once an edge is past its soft strain (smaller = harder skin). */
  edgeHarden: number;
  /** Hinge barrier: the vertices opposite an interior edge are kept at least `hingeLimit` x their rest distance apart (0 disables), with
   *  compliance `hingeAlphaT`: a one-sided bending constraint that resists a flap folding onto itself. The mesh resolution scales both
   *  (softbody.ts: limit - 0.05 log2(n / 642), alpha x 2^(-log2(n / 642) / 2), limit never below 0.8). tuned: 1.0 (barrier at rest
   *  length) folded MORE; below ~0.75 at detail 4 the fold came back; extra passes of this or of the edge constraints made it worse. */
  hingeLimit: number; hingeAlphaT: number;
  /** Seconds the glued feet are held after a lobe is let go. */
  pinHold: number;
  /** Volume-constraint compliance relative to the constraint's own scale (alpha_tilde = kappa * S0). Lower = more incompressible. */
  volKappa: number;
  /** Local (non-affine) internal velocity damping rate, 1/s: the peak flop and ripples. From bounce. */
  intDamp: number;
  /** Global (affine: squash / stretch / shear) internal damping rate, 1/s: stops the whole body bouncing like a ball. From bounce and firmness. */
  affDamp: number;
  /** Extra internal damping per m/s of internal speed (1/m): kills fast spikes (a lobe snapping back) but leaves small jiggle alone. From bounce. */
  intDamp2: number;
  /** Global drag on the whole velocity, 1/s: damps the body bobbing on its glued foot (the slow part of the wobble). From bounce. */
  drag: number;
  /** Table Coulomb friction coefficient. */
  tableMu: number;
  /** Tack layer (m, for a body of radius 0.5; scales with size): a foot particle that lifts off its REST height by less than this
   *  is mostly pulled back, so small springs-back never peel the foot (no hop); a real launch still leaves. It acts over the FULL
   *  thickness since the tack pass was fixed (it used to stop at the 1 cm NEAR band, so 0.02 meant 0.01). */
  glue: number;
  /** PEEL DAMPING ('no hop off the table'; physics round-2 fix round): the largest share of the body's upward centre-of-mass speed removed per
   *  substep while its tacky foot is being peeled off the table (softbody.ts, the tack pass). materials.ts scales it with the family's tack
   *  (SolverScale.groundDamp: it had no SoftParams field, so applyMaterial dropped it, the verifier's MINOR-9). */
  groundDamp: number;
  /** How deep a finger may press, as a fraction of the body thickness (firmer and bouncier = shallower). */
  squashDepth: number;
  /** Stiffness multiplier (shape matching + Laplacian) at the very tip of the swirl-peak: lower = floppier. */
  peakSoft: number;
  /** Crease healing. A vertex whose Laplacian residual (distance from mean(neighbours) + rotated rest offset) exceeds `creaseLo` edge
   *  lengths is being creased or folded over; the shape-memory gain there ramps up to `creaseGain` x the body gain at `creaseHi`
   *  edge lengths, ignoring the peak's softness (a smooth bend of the peak is a small residual and stays floppy, a crease is not). */
  creaseLo: number; creaseHi: number; creaseGain: number;
  /** Lower bound of the swirl-peak's Laplacian (local shape memory) weight, 0..1: the peak's POSITION stays floppy (peakSoft) but its
   *  own cone shape is held, so a press bends it over as a unit instead of crushing it into creases. 0 = as soft as the shape matching. */
  bendFloor: number;
  /** Max pull distance of a grab, in rest radii. From stretch. */
  maxPull: number;
  /** MAT CORRAL (tabletop only; the play-mat is a 3.5 m disc, its stitched ring at 3.34 m). Inside `matR0` metres of the origin nothing
   *  happens, so the rest pose and every interaction near the centre are untouched. Beyond it, ramping in over `matRamp` metres, the
   *  body's outward horizontal speed is braked at `matBrake` 1/s and the body glides back toward the dead zone at up to `matGlide` m/s (never under 10% of it, so it arrives and stops).
   *  Both act on the WHOLE body alike (a uniform velocity change, a rigid translation), so nothing deforms and the table friction never
   *  sees it; both are off while something holds the body (a fingertip touching it, a grab, the pinned feet) and in float mode (which has
   *  its hover spring). Past `matRim` metres the outward speed is removed outright and the glide is 4x faster: a hard bound for hostile
   *  input (a 12 m/s nudge every frame), never reached by a single nudge; it also acts while a finger is down but its tip touches nothing
   *  (the body was shoved out from under it: a finger that is merely down holds nothing; without this the probe's hostile fuzz shoved a
   *  body 5.1 m out past two such fingers).
   *  matBrake = matGlide = 0 (and matRim huge) disables it (the probe compares).
   *  Not genome-dependent. */
  matR0: number; matRamp: number; matBrake: number; matGlide: number; matRim: number;
  /** THIN-PART STRUTS (struts.ts, softbody.ts strutPass): chords through the inside of the thin floppy parts (the swirl-peak), so the skin
   *  model has some material INSIDE a feature that has almost no volume of its own. Built between vertices whose floppy weight is >= strutTau,
   *  at most strutMaxR rest radii long, up to strutPer per vertex, leaving both ends at least strutCos (cosine) below the tangent plane and
   *  crossing no triangle. One-sided: a strut shorter than strutMin x its rest length is pushed back out to it (XPBD compliance strutAlphaT,
   *  alpha / h^2); otherwise it does nothing. 0 strutMin disables them. */
  strutTau: number; strutMaxR: number; strutPer: number; strutCos: number; strutMin: number; strutAlphaT: number;
  /** Static Coulomb friction between the fingertip and the skin (FINGER.friction for the gel / DOLLOP; material families scale it with
   *  their tack: src/data/materials.ts SolverScale.fingerFriction). The kinetic coefficient scales with it (FINGER.frictionKinetic). */
  fingerFriction: number;
}

export function deriveParams(genome: Genome): SoftParams {
  // every field sanitised first (physicsGenome: non-finite -> the documented default, finite -> clamped to 0..1)
  const g = physicsGenome(genome);
  const f = g.firmness, b = g.bounce, s = g.stretch;
  // bigger toys wobble slower, and carry the same energy at the same squash fraction (without this a size-1 body hops)
  const sizeScale = 0.5 / restRadiusOf(g);
  return {
    // tuned: below ~12 rad/s the foot's friction and the stiff skin stop the body returning (7 s to recover, 3.5% error);
    // above ~40 a squash stores enough energy to launch the body off the table.
    smOmega: lerp(12, 40, f) * sizeScale,
    // tuned: 0.05 left creased rims on a released pinch; 0.15 gives smooth bowls. Applied every other substep at 2x.
    bendK: lerp(0.08, 0.2, f),
    // tuned: 1-2 (stiff skin) stores so much energy that the body hops, and a single Gauss-Seidel pass of stiff edges
    // dissipates the wobble numerically; 4-5 keeps the oscillation alive.
    edgeAlphaT: lerp(3, 5.5, s),
    // "how far it pulls before it resists": strain at which the skin hardens (35% .. 160%)
    edgeSoftStrain: lerp(0.35, 1.6, s),
    edgeHarden: 0.12,
    // tuned: 0.9 holds the skin spread under a deep press best, but on a FIRM body (which presses less deep and has less crowding to fight)
    // it also took the release overshoot of a hard peak press from 50 mm to 12 mm; 0.8 keeps the wobble and folds no worse there
    hingeLimit: lerp(0.9, 0.8, f), hingeAlphaT: 0.1,
    // tuned: without a hold the body, sheared over its pinned foot, was released and slid 0.5 m with the snap
    pinHold: 0.5,
    volKappa: 0.5,
    intDamp: lerp(8, 1, Math.pow(b, 0.9)),
    affDamp: lerp(6, 1, b) + 4 * f,
    // tuned: 0 gave a creased, folded lobe snap-back; 20 kills the wobble of soft bouncy bodies; 9..16 keeps n_osc >= 3.
    intDamp2: lerp(16, 9, b),
    // tuned: the knob that sets the decay time constant of the slow wobble: 0.18 -> tau 2.5 s, 1..2 -> tau 0.9..1.4 s.
    drag: lerp(2.0, 1.0, b),
    // squishies are tacky: a finger press on a slope must not shove the body out from under it (see also FINGER.friction)
    tableMu: 1.5,
    // tuned: 0.008 left a 10 cm hop for firm bouncy bodies, 0.02 removes it (and larger values change nothing)
    glue: 0.02,
    // tuned (probe_species 'hop after release' row, the verifier's hop.ts: 50 species x 3 genomes x 2 pressure profiles): 0.25 with the ramp
    // at 0.1..0.5 x glue also caught the firm bouncy starter's mild peel and took its peak wobble to tau 3.4 s; 0.35 at 0.35..0.75 x glue
    // leaves every wobble row as it was and, with the goal-based support (softbody.ts), no press of the 300 hops
    groundDamp: 0.35,
    // tuned: a firm or bouncy toy resists a finger, and a deep squash of a bouncy body is the one thing that still hops
    squashDepth: lerp(0.66, 0.34, f) * lerp(1, 0.78, b),
    // tuned: below ~0.15 the tip no longer bends further (the finger reach, not the stiffness, limits the flop)
    peakSoft: 0.12,
    // tuned: bendFloor 1 (the peak's cone shape as stiff as the body's) took the worst crease of the 272-press sweep from 178 to 105 degrees;
    // 0.5 still left 110 and hopped. The crease boost is only a safety net now: 0.15..0.5 / gain 2 fixed nothing more and made the starter
    // hop; 0.6..1.2 / 1.2 never triggers in the normal presses and heals what a hostile fuzz leaves.
    creaseLo: 0.6, creaseHi: 1.2, creaseGain: 1.2, bendFloor: 1,
    maxPull: 1.0 + 1.4 * s,
    // tuned (probe 'mat corral' rows): a 12 m/s nudge (the nudge() clamp) carried the body 3-6.6 m and ten 4 m/s shoves 9 m with no corral;
    // these keep the worst case inside ~2.5 m and bring a body back from 2.5 m to the dead zone in a few seconds
    matR0: 0.6, matRamp: 0.6, matBrake: 6, matGlide: 0.35, matRim: 2.5,
    // tuned (probe 'hard side shove' and 'dense press matrix' rows, physview peak_shove): without struts a pressure-1 shove 6 cm under the tip
    // of a soft peak collapsed its walls (edges at 29% of their length) and the apex folded 138-150 degrees as it whipped over, and a hold or
    // a rub at the peak base of a soft genome folded 116-132 degrees; strutMin 0.85..0.95 all fix the shove (worst 111..115 at detail 3),
    // 0.9 is the middle. strutPer: 3 left the detail-4 shove at 116 degrees, 4 at 114, 5 at 112 (169 struts at detail 3, 733 at detail 4).
    // strutCos 0.4 (only steep chords) let the soft shove fold again (173 degrees): the chords across the cone are the shallow ones.
    // strutTau 0.5 = the upper half of the floppy zone (the cone itself, not its base, which must bend). The flop of the starter's peak under
    // the gate's side poke is 31.5% R with them (28.4% without).
    strutTau: 0.5, strutMaxR: 0.5, strutPer: 5, strutCos: 0.2, strutMin: 0.9, strutAlphaT: 0.05,
    fingerFriction: FINGER.friction,
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
  /** Coulomb friction between the fingertip and the skin (tacky: the surface follows the finger). tuned: 0 let a press on the
   *  dome shoulder squirt the whole body out sideways; 0.9 holds it. This is the STATIC coefficient: skin that has not slipped
   *  under the tip this substep is held exactly. */
  friction: 0.9,
  /** Kinetic coefficient of the fingertip contact, reached while the tip itself slides sideways (a rub): skin that slips under a
   *  sliding tip is only dragged with this much friction. Why: with 0.9 everywhere a rubbing tip (the shell drags at 1.5-3 m/s) bulldozed
   *  the skin ahead of it into a ridge that the contact crushed to ~160 degrees every substep, faster than the fold limit could open it.
   *  Measured on the verifier's 180 camera-plane rubs (peak base -> front flank, 1.5-3 m/s, pressure capped at 0.7; starter, f0b0s0z0,
   *  f0b0s1z1), frames over 120 degrees: 0.9 everywhere with foldIters 4 (before) 192 in 22 rubs, worst 180; kinetic 0.3 alone 43 in 8;
   *  foldIters 8 alone 20 in 5; both 1 (124 deg); with tableGap as well none (worst 110). A plain static / kinetic switch on every contact
   *  (no tip-slide gate, below) let a still press slip too: the gate's squeeze lost compression (0.204 -> 0.188, under its 0.2 bar) and a
   *  high-bounce peak release damped out (f1b1s0 tau 0.96 -> 2.23 s); with the gate both are bit-identical to before. Taking it out of
   *  the final set (0.9 everywhere, all else kept) fails the probe's slide-toward-the-table row again: 6 frames over 120, 172 deg. */
  frictionKinetic: 0.3,
  /** ...blended in (smoothstep) as the tip's sideways speed (across its own travel direction) rises from 0 to this many rest radii per
   *  second. A press, a hold or a tap moves the tip only along its travel: full static friction, exactly as before. */
  frictionSlide: 1.0,
  /** A free flank (no table behind it) is pressed at most this fraction of squashDepth x thickness... */
  flankShare: 0.75,
  /** ...but never less than this many rest radii (a thin peak is shoved aside, not pierced). tuned: 0.42 flopped the tip only
   *  18% R under the gate's poke, 0.8 gave ~27%; once the peak held its cone shape (bendFloor) and the tip swelled at a limited
   *  speed (growRate) 0.8 gave 23.5%; the peak (floppy weight ~0.8 at the gate's poke) now reaches 0.8 + 0.2 x 0.8 = 0.96 R: ~30%. */
  minFlankDepth: 0.8,
  /** ...plus this many rest radii x the floppy weight (0..1) of the touched part: a thin swirl-peak is shoved further aside than a low
   *  flank is squeezed (a deeper low press squeezed the foot rim against the table into a crease). */
  peakReach: 0.12,
  /** Each jaw of a two-finger pinch keeps this fraction of its depth range (tuned: 1.0 squirted the body out upward). */
  pinchShare: 0.62,
  /** Rates (1/s) at which a tip eases its depth share toward the pinch value (a partner landed: quick, the tip backs off) and back
   *  toward 1 (the partner left: slow, so the remaining finger never lunges deeper while the body is springing back). A switch
   *  instead of an ease teleported the tip ~0.3 R in one substep. */
  shareIn: 7, shareOut: 2,
  /** The two tips of a pinch keep this clearance (in rest radii) between their surfaces. */
  pinchGap: 0.3,
  /** Touch-down seats the tip sphere on the whole local surface: the anchor is lifted back along the finger direction (at most this many
   *  rest radii) until no vertex under the footprint is inside the tip. A tip wider than the swirl-peak otherwise starts with the apex
   *  already inside it and pushes it out sideways. */
  maxLift: 0.35,
  /** Cap (m/s) on how fast the tip may move into the body: the critically damped ease reaches ~6 m/s on a full-pressure tap. tuned: 3.5 left
   *  the peak unfolded under a hard shove but flopped only 17% R (the gate wants 25%: the flop IS partly that violence); 5.5 keeps ~29% (28% since the
   *  fingertip projects every particle radially: the removed 'peakAxial' exit, see softbody.ts, collisions). */
  maxSpeed: 5.5,
  // (softbody.ts uses maxSpeed x min(1, sqrt(642 / particles)) as `tipSpeed`: the same travel per edge length on every mesh, so a
  //  detail-4 body (2562 particles) gets 2.75 m/s. It is read ONCE, in the constructor: changing maxSpeed later changes nothing for
  //  bodies that already exist.)
  /** Contact fold limit (softbody.ts foldLimit): near a fingertip no two neighbouring triangles may fold past this normal dihedral (degrees;
   *  the rest shape's own maximum is 50). tuned: 110 took the detail-4 peak-flank tap from 161 to 111 and a low side press at the table rim
   *  from 132 to 113, and changed nothing that did not fold (flop, wobble, presses); side presses at the peak: see foldIters. */
  foldMaxDeg: 110,
  /** ...checked on edges with a vertex within this many tip radii of a fingertip this substep. tuned: 1.0 (only the vertices inside it) left
   *  the crease of the detail-4 peak-flank tap, which forms just beyond the contact (1.1-1.3 tip radii); 1.3 and 1.6 both fix it. */
  foldNear: 1.3,
  /** ...alternating with putting the touched skin back on the fingertip this many times per substep (Gauss-Seidel: the two disagree for
   *  a crushed cone). tuned on 48 side presses at the peak with the shell's pressure profile (0.55 at contact, ramp to 1; 5 genomes, 2
   *  heights, 4 directions, detail 3 and 4): 0 (no limit) worst 179 deg / 100 frames over 120; 1: 159 / 21; 2: 141 / 7; 3: 131 / 1;
   *  4: 115 / 0. (One pass WITHOUT re-seating left the skin up to 4.7% R inside the tip.) An instant pressure-1 shove (a stress case the
   *  shell never sends): 180 / 252 -> 138 / 4 over 16 presses, NOT under 115 / 0; tried without success: 5, 6, 8 passes, ending on the fold
   *  pass instead of the re-seat, foldNear 1.6 / 2.0 (worst 136-178, erratic), and sharing the opening with the edge's own two vertices
   *  (much worse, 156-180). The remaining folds are a thin cone crushed under a wider sphere (detail 4) and the rebound at the lift.
   *  Raised to 8 (fix round, shell-faithful rubs and slides; see frictionKinetic for the numbers): under a SLIDING tip the crushed ridge
   *  moves every substep; with HEAD's friction 4 passes left 192 frames over 120 in the 180 rubs, 8 passes 20. With the rest of the fix in place
   *  4 also passes the probe's round-5 rows (worst 111-112 deg instead of 110): 8 is kept as margin. The passes stop early once one finds
   *  nothing folded (a plain press: one pass), so it costs nothing where nothing folds (step() / the probe's reference kernel: HEAD
   *  0.79-0.84, now 0.80-0.84). Raised to 16 (fix round 2, the verifier's rub set on real catalog bodies): a rub sliding down a soft
   *  memory body toward the table crumples 12-18 edges at once (putty fossilo, slime gloopsy, wrigglo), and 8 passes left 2-4 frames at
   *  122-152 degrees; 16 hold them at 110. Same early stop, so a press that folds nothing still pays one pass. */
  foldIters: 16,
  /** A fingertip sphere's lowest point stays at least this many rest radii above the table (was 0: only out of the table). A low press or
   *  a slide toward the table otherwise pinched the foot rim between the sphere and the table: the table always wins and the rim was
   *  held folded at the fold limit (110) for the whole slide, then snapped past 150 degrees at the lift. 0.12 R keeps a pinch-free gap
   *  of about the foot rim's thickness. Taking it out of the final set (0, all else kept) fails the probe's camera-plane rub row (4 frames
   *  over 120, 147 deg) and slide row (5 frames, 138 deg) again. */
  tableGap: 0.12,
  /** Max speed (rest radii per second) at which the tip sphere grows with pressure (it shrinks at once). */
  growRate: 0.6,
  /** Held >= this long (s) and in contact -> 'press' event. */
  pressAfterS: 0.18,
  /** Pointer slide low-pass (1/s) so a jumpy pointer never teleports the kinematic tip. */
  slideRate: 38,
};

export const EVENT_MIN_GAP_S = 0.05;
