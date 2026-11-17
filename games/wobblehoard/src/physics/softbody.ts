// WOBBLEHOARD soft body: a volume-preserving jelly on ~600 particles, XPBD + shape matching, pure TypeScript.
//
// No three.js, no DOM, no Math.random, no Date.now, nothing allocated per step (typed-array scratch only; an event
// allocates one small object, and only when one is emitted; the probe measures 0 bytes per frame once V8 has compiled the code,
// which is why no hot call passes or returns a double across a function too large to inline: V8 boxes those, one heap number each).
// Same genome + seed + input script => identical stateHash(), and reset() leaves the body bit-identical to a new one (nothing keys
// behaviour on the harness-only `debug` counters). Inputs are never trusted: genome fields (physicsGenome), coordinates (WORLD_LIMIT).
//
// TECHNIQUE (as recommended in _spec/CONTRACT.md section 4; tuned constants and the reasons are in params.ts)
//   Particles = vertices of a welded icosphere (detail 3 = 642). Small-step XPBD: a fixed substep H = 1/360 s, ONE
//   solver pass per substep, six substeps per 60 Hz frame; a time accumulator makes the result independent of the
//   frame dt jitter beyond the clamp. Inside a substep, in this order:
//     fingers/grabs advance -> mat corral (table only, outside its dead zone) -> predict (gravity, or the float-mode hover
//     spring) -> global shape matching -> local Laplacian shape memory -> enclosed-volume constraint -> edge distance
//     constraints -> hinge barrier -> thin-part struts -> grab attachments -> collisions (fingertip spheres, then the table) ->
//     contact fold limit -> v = dx/H -> internal-velocity damping, drag, self-righting.
//   * edge distance (compliance from genome.stretch, hardening past a strain limit): the skin.
//   * ONE global enclosed-volume constraint V = 1/6 sum p_a.(p_b x p_c) = V0 with an XPBD multiplier. Blocked particles
//     (inside a fingertip's reach, touching the table) get zero inverse mass in it, so the pressure is absorbed by the
//     free particles around the contact: a dent pushes up a bulge ring beside it, a table squash bulges at the flanks,
//     a pulled lobe thins its neck. No scale hacks anywhere.
//   * global shape matching (Mueller 2016 rotation extraction, warm started, 2 iterations): every particle is pulled
//     toward g_i = c + R q_i. Firmness sets the stiffness; the swirl-peak is softer so it lags and flops.
//   * Laplacian shape memory (a local, bending-like term, applied every other substep at twice the gain): each particle
//     is pulled toward the mean of its neighbours plus its rotated rest offset. Dents become smooth bowls instead of
//     pits with creased rims, and the surface recovers locally. Its gain does NOT soften with the swirl-peak (params.bendFloor):
//     the peak's position is floppy but its cone shape is held, so a press bends it over as a unit instead of crushing it
//     into creases, and a crease or flap left by a hard poke is pulled out again (residual-triggered boost, params.creaseLo).
//     It scales with the vertex count (a finer mesh needs a larger per-application gain for the same physical smoothing).
//   * HINGE BARRIER (anti-fold, one sided): for every interior edge the two vertices OPPOSITE it (one in each adjacent
//     triangle) are kept at least `hingeLimit` x their rest distance apart. A flap folding flat onto itself brings exactly
//     those two vertices together, so this is the cheapest bending term that makes a fold expensive, and being one sided it
//     stores no energy at rest. Without it a press on the swirl-peak or the dome top crumpled the skin into a star-shaped
//     pucker with tucked-under triangles (dihedral 171-180 degrees between neighbours; the rest shape's own maximum is 50).
//   * CONTACT FOLD LIMIT (foldLimit): the barrier above cannot see a flap that flips over without its two opposite vertices
//     approaching, and it runs before the contacts that cause most folds. So after both contact projections, on the edges near a
//     fingertip only, two neighbouring triangles may not fold past FINGER.foldMaxDeg: a fingertip wider than the swirl-peak's tip
//     used to crush it flat onto the sphere (176-180 degrees for ~100 ms under a hard side shove).
//   * damping acts on the INTERNAL velocity only (velocity minus the best-fit rigid motion v_cm + w x r): the global
//     affine part (squash / stretch / shear) and the local part (peak flop, ripples) have separate rates, plus a
//     speed-proportional term that kills fast spikes (a lobe snapping back) but leaves small jiggle alone, plus a global
//     drag that damps the body bobbing on its foot. All rates come from genome.bounce (and firmness).
//   * table y = 0: position projection + Coulomb friction (a tangential displacement bounded by mu x normal load, where
//     the load is the weight, the penetration and the downward push of a fingertip).
//   * fingers: kinematic spheres with Coulomb contact friction (the skin follows the tip, so a sloped press does not
//     squirt the body out sideways). Penetrating particles are projected out RADIALLY (to the nearest point of the sphere: an
//     earlier exit along the finger's travel carried peak vertices through the sphere and folded the peak base 171-180 degrees)
//     and the correction becomes velocity (a poke shoves a floating body). The tip moves CONTINUOUSLY: it starts seated on the whole local surface (not inside a
//     thin apex), swells with pressure at a limited speed (growRate), never goes below the table, and its depth share in a
//     two-finger pinch is eased, never switched (a switch used to teleport a tip by ~0.3 R in one substep). Pull: a
//     Gaussian patch soft-attached to a moving world target; the feet stay glued to the table while the lobe is pulled
//     (and for a moment after, so it springs back in place).
//   * DEVIATIONS from the recommended recipe, and why (the first two are what makes the body REST exactly and not hop):
//     (1) SUPPORTED-BODY GRAVITY. With one solver pass a soft network cannot carry the weight of 640 particles down to a
//         small foot (the load path is longer than the solver reaches in a frame), so a resting body sagged and crept.
//         While the foot is on the table gravity is faded out by `supp`; every deformation, finger load and impact is
//         still solved by the constraints, and friction still sees the true normal load.
//     (2) TACK. Squishies are sticky: a foot particle that lifts off its REST height by less than a thin layer (the whole
//         `glue` thickness, ~2.5 cm) is mostly pulled back, so the springing-back body wobbles on its foot instead of hopping
//         like a ball. (The layer used to be cut off at 1 cm, so a 7 mm kick from the shape memory carried a rim particle out of
//         it, the foot peeled off the table like a zip and a hard release of a large or firm body hopped 10 cm.)
//     (3) The hinge barrier and the contact fold limit above are bending-like terms the recipe lists only as optional ("weak local
//         bending if needed").
//     (4) MAT CORRAL (matCorral, params.matR0 ...): on the table, outside a 0.6 m dead zone, the body's outward speed is braked and
//         it glides back (rigidly: it never deforms), so a hard nudge cannot send it off the 3.5 m play-mat. Off while a fingertip
//         touching it, a grab or the pinned feet hold it (only its 2.5 m rim acts while a finger is down but touches nothing), and in
//         float mode; inside the dead zone it does nothing at all.
//     (5) THIN-PART STRUTS (struts.ts, strutPass): the skin has nothing inside it, and the swirl-peak has almost no volume of its own, so
//         nothing held its walls apart: a fingertip wider than the peak pressed one wall onto the other and the apex folded (130-180
//         degrees between neighbouring triangles as it whipped over). One-sided chords through the inside of the peak stand in for the
//         jelly there: they only resist being shortened, so the peak still bends, stretches and flops freely.
//     (6) The fingertip's speed cap scales with the mesh resolution (tipSpeed): the same travel per edge length on every mesh.
//     (7) SLIDING CONTACT (fix round: shell-faithful rubs and slides creased the skin): the fingertip friction is static / kinetic
//         (FINGER.friction 0.9 while the tip only presses, FINGER.frictionKinetic 0.3 for skin slipping under a tip that slides
//         sideways), a tip stays FINGER.tableGap rest radii above the table so it never pinches the foot rim against it, and of two
//         tips that would overlap the one that moved gives way (a rubbing finger no longer shoves a holding one aside).
//   * CUT2 (TRUE CUT, _spec/CUT2.md; tasks P2 and P3): a body built with `piece.region` is the REAL part of the squishy inside one convex cell: its rest mesh comes from
//     piece.ts (the cache prepareCut fills), it publishes `piece` (PieceInfo), `frac` is its measured share (rest volume / V3), `capFlat` is true, it is born at `at`
//     EXACTLY in the parent's `frame` (no lift), and the fold limit knows each hinge's own rest dihedral (HC / HCH / HSH). `planCut` (rest-frame plane, latched; 'at',
//     'median', 'latched'), `prepareCut` (resumable build of the two children, the retry ladder, the 'thin' / 'loose' refusals) and `placeAt` (exact placement and
//     re-homing) are the cut's API. Everything that depends on the rest shape is in `initRest` (task P6 runs it again on a merge). The legacy build (a whole at `at`,
//     the Minis' scaled whole, the old chunk) is unchanged until task P9; a WHOLE body is bit-identical to the one before CUT2 (probe_truecut L6b).
// Units: metres-ish; mass per particle ~1 (tributary area, mean 1).
import type { Genome } from '../core/genome.ts';
import { clamp, mulberry32 } from '../core/rng.ts';
import type {
  CutPlan, CutPlane, FingerDownArgs, PieceInfo, PieceOpts, PieceRegion, PropWorldLike, Quat, RayHit, Slot, SoftBodyLike, SoftEvent, SoftEventKind, SoftMetrics, V3,
} from '../contracts.ts';
import { buildIcosphere } from './mesh.ts';
import { buildChunkRest, buildRest, flatPoints, meshVolume, physicsGenome, restRadiusOf } from './shape.ts';
import type { RestShape } from './shape.ts';
import type { IcoMesh } from './mesh.ts';
import { deriveParams, EVENT_MIN_GAP_S, FINGER, GRAVITY, H, MAX_DT, MAX_SUBSTEPS } from './params.ts';
import type { SoftParams } from './params.ts';
import { extractRotation, rayMesh } from './mathx.ts';
import { buildStruts } from './struts.ts';
import { CutJob, FRAC_FLOOR, PIECE_TUNING, buildPieceLadder, cellPlanes, newCutPlanParts, partToken, pieceDetail, planSplit, planSplitTrue, wholeOf } from './piece.ts';
import { CutParts, MAX_PARTS } from './parts.ts';
import type { CutPlanParts, PieceBuilt } from './piece.ts';
import { CLIP_VOL, MAX_PLANES, WHOLE_CELL, clipMesh, compileCell, getSource, starVolume } from './region.ts';
import type { RegionCell, Source } from './region.ts';
import { getSpecies } from '../data/catalog.ts';
import { applyMaterial, DEFAULT_FAMILY_ID, MATERIAL_FAMILIES, resolveMaterial } from '../data/materials.ts';
import type { SolverMaterial } from '../data/materials.ts';

/** Kinematic fingertip (ids 0 and 1). */
class Finger {
  down = false;        // the pointer is down (counts in metrics.fingers)
  retracting = false;  // lifted; the tip is still sliding out (<= 60 ms) and still collides
  contacted = false;   // some particle has touched the tip since fingerDown
  pressed = false;     // 'press' already emitted for this touch
  px = 0; py = 0; pz = 0;   // surface anchor P0 (smoothed)
  tx = 0; ty = 0; tz = 0;   // anchor target (pointer slide)
  dx = 0; dy = -1; dz = 0;  // travel direction (unit)
  nx = 0; ny = 1; nz = 0;   // outward surface normal at the contact (unit)
  depth = 0;           // eased press depth 0..1
  depthV = 0;          // d(depth)/dt, 1/s
  target = 0;          // target depth 0..1 (fingerPressure)
  depthMax = 0.3;      // world distance at depth 1
  holdT = 0;           // seconds since fingerDown
  retractRate = 0;     // depth units per second while retracting
  tipR = 0.1;          // current tip radius
  share = 1;           // eased fraction of the depth range this tip uses (1 alone, FINGER.pinchShare as one jaw of a pinch)
  lift = 0;            // how far the anchor was lifted back off the surface at touch-down (seating), world units
  touching = false;    // some particle was inside the tip in the last substep
  cx = 0; cy = 0; cz = 0;   // tip centre (world)
  ocx = 0; ocy = 0; ocz = 0; // tip centre at the previous substep (for the contact friction)
  /** Back to the state of a new Finger (reset() must leave the body bit-identical to a fresh one). */
  clear(): void {
    this.down = false; this.retracting = false; this.contacted = false; this.pressed = false;
    this.px = 0; this.py = 0; this.pz = 0; this.tx = 0; this.ty = 0; this.tz = 0;
    this.dx = 0; this.dy = -1; this.dz = 0; this.nx = 0; this.ny = 1; this.nz = 0;
    this.depth = 0; this.depthV = 0; this.target = 0; this.depthMax = 0.3; this.holdT = 0; this.retractRate = 0;
    this.tipR = 0.1; this.share = 1; this.lift = 0; this.touching = false;
    this.cx = 0; this.cy = 0; this.cz = 0; this.ocx = 0; this.ocy = 0; this.ocz = 0;
  }
}

/** Soft attachment of a Gaussian vertex patch to a world target. */
class Grab {
  active = false;
  count = 0;
  verts: Int32Array;
  weights: Float64Array;
  p0: Float64Array;            // world positions of the patch at grab time (the patch translates with the hand)
  anchor = 0;                  // grabbed vertex
  t0x = 0; t0y = 0; t0z = 0;   // target at grab time (the pull is measured from here)
  c0x = 0; c0y = 0; c0z = 0;   // the body's centre of mass at grab time (the pull level is measured relative to the body: translation-free)
  rx = 0; ry = 0; rz = 0;      // raw target (grabMove)
  ex = 0; ey = 0; ez = 0;      // eased target
  ramp = 0;
  holdT = 0;
  slot = 0;                    // LOCK: the slot a lock was grabbed with (the 'finger' of its 'snap')
  nx = 0; ny = 1; nz = 0;      // GROUND FIX: the outward surface normal at the anchor when it was grabbed (unit) ...
  cap = -1;                    // ... and the deepest the target may be pushed INTO the body along it (m; < 0 = no limit)
  fl = false;                  // LOCK FIX: a lock made in float mode at the pull limit (its snap reports at least LOCK_MIN_PULL)
  constructor(n: number) { this.verts = new Int32Array(n); this.weights = new Float64Array(n); this.p0 = new Float64Array(n * 3); }
  /** Back to the state of a new Grab. */
  clear(): void {
    this.active = false; this.count = 0; this.anchor = 0;
    this.verts.fill(0); this.weights.fill(0); this.p0.fill(0);
    this.t0x = 0; this.t0y = 0; this.t0z = 0; this.c0x = 0; this.c0y = 0; this.c0z = 0; this.rx = 0; this.ry = 0; this.rz = 0; this.ex = 0; this.ey = 0; this.ez = 0;
    this.ramp = 0; this.holdT = 0; this.slot = 0; this.nx = 0; this.ny = 1; this.nz = 0; this.cap = -1; this.fl = false;
  }
}
/** LOCK: the placeholder of a grab slot (2 to 4) or a lock that has not been needed yet; never written (a real Grab replaces it first), so a computer that never locks or uses a touch finger allocates nothing for them. */
const IDLE_GRAB = new Grab(0);

const KIND_INDEX: Record<SoftEventKind, number> = { poke: 0, press: 1, release: 2, land: 3, grab: 4, snap: 5, bump: 6 };

const SM_ITERS = 2;                // rotation extraction iterations per substep (warm started)
const LAND_MIN_SPEED = 0.9;        // m/s of centre-of-mass fall speed for a 'land' event
const LAND_NORM = 4.5;             // m/s that maps to intensity 1
const POKE_NORM = 3.2;             // m/s predicted closing speed that maps to intensity 1
const MAX_SPEED = 14;              // safety clamp on particle speed (m/s)
const MAX_NUDGE = 12;              // nudge() clamps the velocity change to this (m/s)
const REACT_REF = 20;              // metrics.reaction: push-back (m/s^2 per unit body mass) that maps to 1 - 1/e. tuned: 10 saturated every
                                   // contact impulse at ~1; at 20 a held full press reads soft 0.2-0.6, starter 0.3-0.6, firm 0.45-0.9
const HOVER_OMEGA = 4.6, HOVER_ZETA = 0.62, HOVER_ABOVE = 0.35;
const BOB_AMP = 0.03, BOB_HZ = 0.33;
/** Give law exponent: depth ~ smOmega^GIVE_EXP, from deriveParams' own squashDepth 0.66 -> 0.34 over smOmega 12 -> 40 (see the constructor). */
const GIVE_EXP = Math.log(0.34 / 0.66) / Math.log(40 / 12);
/** Supported gravity is withdrawn as the lowest point of the shape-matching goal rises from 0 to GOAL_FLOAT x restRadius above the table
 *  (a body whose own shape no longer reaches the table is not carried by it; see substep). */
const GOAL_FLOAT = 0.03;
/** Peel damping (the tack pass) ramps in while the most-lifted foot particle still inside the tack layer is PEEL_LO .. PEEL_HI x glue up. */
const PEEL_LO = 0.35, PEEL_HI = 0.75;
/** Seconds the table edges stay in the contact fold limit after the last finger, grab or pinned foot let go (the release transient). */
const TABLE_FOLD_AFTER = 1.5;
/** Substeps the skin a fingertip had near it stays in the contact fold limit after it left the tip's reach (0.5 s; x the family's own
 *  recovery time over 0.5 s, up to 6x, for a family with a memory arm: see the constructor and substep). */
const TIP_FOLD_AFTER = 180;
/** foldLimit makes another pass only while some hinge was folded past the limit by more than this (cosine of the interior angle: ~0.6 deg
 *  at the limit). A held press keeps a few hinges a hair over the limit every substep, and chasing those cost 3-5 passes of the whole list
 *  per substep (somnuff held at 0.7: 11 000 -> 3 100 hinge checks per frame; physics fix round 2, MAJOR-4). */
const FOLD_DEEP = 0.01;
/** While the table edges are in the contact fold limit, so is the foot rim: every particle less than TABLE_FOLD_BAND x restRadius up. */
const TABLE_FOLD_BAND = 0.08;
/** A triangle at the table whose opposite vertex comes closer than SLIVER x its rest height to the edge is put back open (foldLimit). */
const SLIVER = 0.2;
const NEAR = 0.01;                // a particle this close to the table counts as touching it (m)
const BLOCK_MARGIN = 0.03;         // particles this close to a fingertip are 'blocked' for the volume constraint (m)
const LOAD_CONC = 10;              // friction normal load per touching particle is capped at this many particle-weights
// ---- material families (physics round 2; _spec/SQUISHY_SCIENCE.md section 3, src/data/materials.ts)
const MEM_MIN = 0.3;               // memory arm (Zener) only for memStiff >= this: gel 0.1, waterfill 0.1, firm silicone 0.05 stay the plain solver
const BLEED_MIN = 0.03;            // volume target (air bleed) only for volBleedMax >= this (firm silicone's 0.02 stays incompressible)
const TACK_STRANDS = 0.25;         // metrics.strands only for tack > this (sticky stretch, slime, mochi)
// ---- ceremony drivers (contracts.ts SoftBodyLike, DESIGN.md 6.4)
const FOLD_TAU = 0.2;              // setFold eases with this time constant (s)...
const FOLD_RATE = 2.5;             // ...and never faster than this per second (a 0 -> 1 fold takes >= 0.4 s: never snaps)
const MOVE_OMEGA = 6;              // moveTo: approach rate (1/s) at stiffness 1
const MOVE_VMAX = 3;               // moveTo: never faster than this (m/s) at stiffness 1
const TREMBLE_HZ = 17;             // tremble: goal jitter frequency (Hz) ...
const TREMBLE_AMP = 0.035;         // ...and amplitude at amp 1 (rest radii, along the surface normal)
const BURST_OVER = 0.25;           // burstOpen: goal overshoot at strength 1 (1.25x) ...
const BURST_TAU = 0.3;             // ...that settles with this time constant (s)
const BURST_SPEED = 2.2;           // ...plus a radial velocity kick of this many m/s at strength 1
// ---- CUT (_spec/CUT.md section 4) and stage B (B2 contact, B3 toss)
// (CUT3: the 1/8 floor FRAC_MIN is gone, the owner removed the limit on 2026-10-09; a body is built down to piece.ts FRAC_FLOOR and its mesh detail follows its share: piece.ts pieceDetail)
const NECK_WAIST = 0.3;           // setNeck(t = 1): the goal's waist is this fraction of the cross-section's width (CUT.md's 0.15 crumpled the gathered skin)
const NECK_SIGMA = 0.42;          // ... and the pinch falls off over this many rest radii either side of the plane (0.3 made the goal itself
                                   // crease: its waist ring was sharper than the mesh, 120-175 degrees between goal triangles; 2 of 100 bodies
                                   // flipped past 120 in the shell's 0.25 s pinch, 0 of 100 at 0.42)
const NECK_SWELL = 1;              // the lobes swell across the plane by at most this much to keep the goal's volume (0.3 capped it at t > 0.4)
const NECK_TAU = 0.04;             // setNeck eases with this time constant (s): never a snap
const ROUND_TAU = 2;               // a chunk's flat cut face rounds over with this time constant (s); a plastic family: 1 + memStiff s (putty 6)
const CONTACT_TACK = 0.5;          // ... and of a separating normal velocity (squishies are tacky: a stack does not bounce itself apart)
const CONTACT_MU_BODY = 0.5;       // ... and of the two bodies' relative sliding (their centres' velocities across the contact normal)
const CONTACT_RIGID = 1;           // ... and the share of the mean contact push applied to each body as a whole
const CONTACT_MU = 0.9;            // body-to-body friction: the share of the tangential relative velocity a contact removes per frame
const BUMP_MIN = 0.35;             // m/s of relative approach speed for a 'bump' event ...
const BUMP_GAP = 72;               // ... and only for a contact that was not there in the last 72 substeps (0.2 s)
const BUMP_NORM = 3;               // ... and the speed that maps to intensity 1
// ---- CUT2 5.5: the contact of a pair with a cut face (a body built with a region; a pair of two whole bodies runs the code above unchanged)
const PC_PUSH_MAX = 0.001;         // a particle's push, and a whole-body shove, is at most 1 mm per frame (a separation speed of at most 0.06 m/s per contact)
const PC_RAMP_S = 1.0;             // the contact skin of two PIECES eases in over their first second (a flush pair is born inside its own skin)
const PC_SHOVE_FULL = 12;          // the whole-body shove is scaled by min(1, contacts / 12) ...
const PC_STATIC_MU = 0.9;          // static friction between pieces: a slide slower than mu g cos(theta) dt is stopped, not halved (a piece on a 40 degree cap held; was creeping 0.1 to 0.24 m/s)
const PC_VERT_NY = 0.5;            // ... and is vertical when the mean contact normal is within 60 degrees of vertical (a stack, or a piece lying on a slope, is separated up and down, never sideways: with 0.8 (37 degrees) the lower piece of a 50 degree cut was shoved 0.2 m sideways, the upper one crept 0.08 m/s; CUT2 P4 / P8 trial)
/** PROBES ONLY (L7's regression row, the cost A/B): true runs the contact of two whole bodies for pairs with a cut face too, as before CUT2 task P5. */
/** CUT3 leg 3 (U02): the approach of an IMPACT between two pieces (closing faster than v0, fully mass-weighted from v0 + span) is shared by MASS, not half each: a 1 % tip that falls on a
 *  whole body at 4 m/s no longer drives that body 2 m/s into the table (it launched stars 0.2 to 0.4 m). Resting and birth contacts (approach under v0) are the half-half of CUT2 5.5. */
export const PIECE_IMPACT = { v0: 0.6, span: 0.8, ratio0: 4, ratio1: 20 };   // (ratio0 .. ratio1: the mass ratio of a pair from which EVERY exchange of the contact (sliding, approach, the rigid shove) goes by mass: a 1 % tip riding a whole body pumped it 0.3 m with equal shoves)
/** CUT3 leg 3 (U02): a cut piece that lands (on the table, or on another piece, closing faster than minSpeed) loses `k` of its upward centre speed per substep for `window` seconds (the
 *  mechanism of the tack's peel damping: uniform, no deformation): fragments land and stay, they do not hop. Whole squishies keep their bounce. */
export const PIECE_LAND = { minSpeed: 0.9, window: 0.2, k: 0.3, kh: 0.03 };   // (.kh: the share of the HORIZONTAL centre speed it also loses per substep in that window: a tip tossed off a star lands sliding and skidded on at 1.2 to 1.7 m/s, 0.1 s after touching down)
export const PIECE_CONTACT = { shipped: false, asym: false, vertNy: PC_VERT_NY };   // (.asym: the horizontal part of the rigid shove goes to the less table-supported body: see contactPiece)
/** PROBES ONLY: false extracts the best-fit rotation against the rest shape also while a neck forms (as before CUT2 task P5's finding), the control of the swap-tilt rows. */
export const NECK_FIT = { goal: true, depth: true };   // (.depth false: setNeck ignores `depth` and the oblique cap, the pinch of before CUT2 task P4: the A/B control of the swell and momentum rows)
/** CUT2 5.4 (P4): the tilted-plane neck gives the body net momentum (|v1 - v0| of the swap, measured by probe_neck.ts: it peaks for a plane whose normal is 35 to 65 degrees above the horizontal, |n_y| 0.57 to 0.9, and grows with the depth).
 *  The depth of a pinch along such a plane is CAPPED at `cap` (smoothly: full cap for |n_y| from 0.5 to 0.92, none below 0.3 and at 1; a family that pinches less than the cap is untouched). `cap` 1 = off. PROBES may set it. */
export const NECK_OBL = { cap: 0.6 };
/** CUT3 SLEEP / WAKE (restCheck; PROBES may set them). A piece sleeps after being calm for `after` s: on the table (its lowest particle within 1 cm + 5 % of its radius of it), no particle faster than `speed` m/s (a sanity bar), none moved by more than `move` rest radii (at least `moveMin` m) from where it was when the countdown started, none farther than `err` rest radii from its goal, nothing driving it
 *  (finger, grab, lock, carry, neck, ceremony driver, float mode), a memory-arm body with its memory shape still (`mem`: rest radii per frame). `hit`: a body touching a sleeper wakes it when the body itself has been calm (nothing drives it, its centre moves under `hitSpeed` m/s) for less than `hit` x `after` s
 *  (a body that is itself at rest leans on the sleeper as on a fixed support: two resting pieces never wake each other in turn). enabled false = nothing ever sleeps (the A/B control). */
export const SLEEP = { enabled: true, after: 0.5, speed: 1, move: 0.004, moveMin: 1.5e-3, err: 0.3, mem: 1e-4, hit: 0.5, hitSpeed: 0.15 };
/** PLAYGROUND (PG_PHYS; _spec/PLAYGROUND_BUILD.md 8.3, 8.6, 8.7). The LIFE drivers (setSquash, scootTo, hop), the touch gate, sleep for WHOLE bodies that opt in
 *  (sleepEnabled), and the prop pass. Every one of them is inert until it is used: a body with no PropWorld bound, sleepEnabled false and no LIFE driver call steps
 *  bit for bit as before (the hash rows of probe_softbody, probe_lock, probe_cut and probe_many). PROBES may read them; `hopVyCap` is the slice's hop cap (S1: 0.84 m/s,
 *  apex 3.53 cm with GRAVITY 10; S2 raises it per family after PH-01, PLAYGROUND_BUILD D-07). */
export const PG = {
  hopVyCap: 0.84, hopGap: 0.8, hopSubs: 10, hopHMax: 1.0,
  gateS: 0.12,                                   // the touch gate eases a LIFE driver out within this (s)
  scootMin: 0.04, scootMax: 0.5, scootEase: 0.12, // scootTo: speed band (m/s) and its ease in / out (s)
  squashMin: 0.75, squashMax: 1.12, squashTauMin: 0.08,
  supportCos: 0.8191520442889918,                // cos 35 deg: a prop face this close to world up SUPPORTS a body (D-11)
  tiltCos: 0.9993908270190958,                   // cos 2 deg: on a support tilted more, gravity's tangential part is kept (a ramp still slides)
  restKin: 0.02, restSpeed: 0.01,                // the rest test of a sleeping WHOLE adds: metrics.kinetic and the centre's speed (m/s) under these (8.6)
  wakeSpeed: 0.05, wakePush: 0.2,                // a contact wakes a sleeping whole only above this approach speed (m/s) or a push of this x mean edge in one frame
  memBusy: 0.02,                                 // metrics.memoryBusy: max |MEM - Q| over this x restRadius (putty, mochi dough, bead squeeze)
  workPen: 0.15, workSpeed: 0.3,                 // a prop contact joins the fold limit only while worked: penetration over this x mean edge, a body faster than this, or a moving prop
  holdK: 16, holdC: 6,                           // D-95 AUTO: a rider holds on (the ropes): its centre is sprung to the seat's centre line along the travel (1/s^2, 1/s) x AUTO's share
  boundsRim: 0.6,                                // setBounds: this far outside the place's area (m) the outward speed is reflected (the mat's rim, measured from the area's edge)
  carryMin: 0.2, carryMax: 5, carryArc: 0.15, carryArcK: 0.25, carryArcMax: 0.6,   // carryTo: seconds, and the arc's rise over the higher end (m: base + k x distance, capped)
};
/** PLAYGROUND: the packed prop data a bound world hands every body (src/physics/props.ts fills it; physics VALUES, not contract members). Per prop PS floats in S:
 *  [0] kind (0 none or parked, 1 sphere, 2 capsule, 3 box), [1] joint (0 static, 1 hinge, 2 free ball), [2] mu, [3] a capsule's segment axis (0 local x, 1 y, 2 z),
 *  [4..6] centre at the frame start, [7..15] rotation (row-major; column j = local axis j in world), [16..18] half sizes (box hx hy hz; sphere r; capsule r and the
 *  segment's HALF length), [19..21] linear velocity (a ball), [22..24] angular velocity (world; a hinge), [25..27] the hinge pivot, [28] bounding radius about the
 *  centre, [29] 1 = it moves this frame (advance it per substep: pose(t0) + v x (k x H), the rotation by w x k x H), [30] 1 = a STATIC support (a body may sleep on it).
 *  Per prop PA floats in A that the bodies add to (beginFrame clears them): [0..2] linear impulse, [3..5] angular impulse about the pivot (a hinge) or the centre,
 *  [6] the riders' inertia x time (supported mass x r_perp^2 x H, so endFrame divides by dt), [7] the largest body impulse this frame, [8] that body's contactSlot,
 *  [9] particle contacts this frame, [10] HELD bodies touching it this frame (a finger, a grab, a carry or a lock: D-95, a held rider wins over AUTO), [11] and [12]
 *  the riders' supported mass x the distance of their CENTRES from the hinge axis (and x its square) x time (D-95 AUTO's rider pendulum), [13] and [14] the HELD riders'
 *  supported mass x their centres' angular velocity about the axis x time, and their supported mass x time (D-95: the seat follows a held rider), [15] spare.
 *  Impulses are in BODY-MASS units (1 = a default whole: bodyMass = (restRadius / 0.5)^3 x frac). */
export interface PropSolve { readonly count: number; readonly S: Float64Array; readonly A: Float64Array }
/** A props.ts world tracks the bodies bound to it (setPropWorld) for its zone physics and pads (S2), applied from the life chunk once a frame. */
interface PropTrack { trk?(b: SoftBody, on: boolean): void }
/** (S also holds [31..33] a hinge's unit axis in world, [34] AUTO's share on a pendulum seat (D-95: its rider holds on), [35] spare.) */
export const PS = 36;
export const PA = 16;
/** GROUND FIX (LOCK.md section 4): a hand may push the grabbed patch INTO the body at most `inFrac` x the finger's safe press depth (SoftParams.squashDepth) x the body's thickness behind the patch (Infinity = no limit; PROBES may set it). */
export const GRAB_TUNE = { inFrac: 0.5, zone: 0.8, band: 0.3, volK: 0.1, allFrom: 3, iters: 8, allEvery: 2, still: 1.5, calm: 0.012, cap: 8 };   // (.zone: the skin within this many rest radii of a pulled or locked patch is in the contact fold limit, 0 = off; .band: while a lobe is pulled or locked, and for TABLE_FOLD_AFTER after, the skin this many rest radii above the table is in it too; .allFrom: with this many lobes held, the whole skin is in it; .still: seconds after the last lock, release or grab after which a hold of locks alone looks every other substep only (metrics.kinetic cannot tell: it reads 1.0 for a locked body, the patches fight the shape all the time); .iters: fold passes per substep while .allFrom or more lobes are held; .allEvery: the whole skin joins the limit on every n-th substep; .calm / .cap: after several lobes were held the whole skin stays in the limit until the body is calm (metrics.kinetic under .calm), at most .cap seconds (a release of several lobes rippled into 140 to 175 degree folds when the tip wake ended); .volK: the volume constraint compliance x this while two or more lobes are held (grabs + locks): several lobes pulled out at once swelled the body to 1.2 .. 1.4 of its volume)
const LIFT_OVER = 1.15;            // a pull asked past this x maxPull lifts the body off the mat (B3). LOCK FIX: unchanged on purpose; a Shift tap on a body that was lifted anyway puts it back and locks (putDownForLock). A longer line (1.3) plus a 0.3 s dwell was tried and withdrawn: it stops the owner's toss from starting for quick drags (browser_shell snap-mat's carry row, probe_gestures' 1.8 x drag at a 1.5 line)
const CARRY_OMEGA = 18;           // rad/s: how tightly a carried body follows the hand (critically damped, kinematic)
const TOSS_MAX = 6;                // m/s: the fastest throw
// ---- LOCK (_spec/LOCK.md): up to 5 concurrent finger / grab slots (touch fingers) and up to 6 locked lobes
const NSLOT = 5;                   // finger and grab slots
const MAX_LOCKS = 6;               // locked lobes (the shell passes 4 on low quality: SoftBody.maxLocks)
const LOCK_MIN_PULL = 0.95;        // a pull locks only when it is this fully stretched (STRETCH_FULL_INTENSITY)
const LOCK_FLOAT_MIN = 0.25;       // float mode: a pull whose hand is at the limit locks when the lobe is at least this stretched (the body follows the hand there; pullLevel reads 0.3 .. 0.8 at the limit)
const GRAB_FLOOR_Y = 0.02;         // GROUND FIX: on the table no grab target (the pointer's hand) goes lower than this (the Shift pair's SHIFT_FLOOR_Y of the shell, now for every hand)
const LOCK_REACH = 0.4;            // lockAt: a point this many rest radii from a locked patch's nearest vertex is on the lock
const TOSS_NORM = 4;               // m/s of throw speed that maps to 'toss' intensity 1
const RIM_BOUNCE = 0.35;           // past the mat's rim the outward speed is reflected with this restitution (the soft rim bounces it back)
const smooth01 = (t: number): number => { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); };
/**
 * V8 hidden-class hygiene. A numeric field that starts as a small integer (`= 0`) and later takes a fraction makes V8 generalise its
 * representation (Smi -> Double), deprecate the object's map and throw away every optimised function that touched it. On a fresh page
 * that turned the first frames of every new code path (first touch, first pinch, first grab) into 15-60 ms steps, and made warmUp() useless
 * for a body created before it ran. So the constructor passes each float field through a fraction once, while nothing is optimised yet,
 * and puts its value back. `ints` lists the fields that stay small integers (counters, indices): they keep the cheaper Smi representation.
 */
function settleDoubles(o: object, ints: ReadonlySet<string>): void {
  const r = o as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (typeof v === 'number' && !ints.has(k)) { r[k] = 0.5; r[k] = v; }
  }
}
const INT_FIELDS: ReadonlySet<string> = new Set([
  'n', 'ne', 'nt', 'nh', 'vertexCount', 'subIdx', 'airSub', 'contactCount', 'nearCount', 'keSubs', 'pinCount', 'liftPinCount',   // SoftBody
  'vnStamp', 'hashStamp', 'bodyId', 'lastTipSub', 'tipFoldSubs',
  'count', 'anchor', 'slot', 'lockN', 'maxLocks',                                                                 // Grab, locks
  'fingers', 'substeps', 'safetyResets', 'contacts',                                                              // metrics, debug
  'hopLeft', 'subK', 'propNear', 'onPropIdx', 'contactSlot', 'onProp',                                            // PLAYGROUND
]);

/** A coordinate farther than this from the origin (m) is garbage, not a gesture: the toy lives within a few metres, and a value like
 *  1e200 has no precision left against a 0.5 m body and overflows to Infinity when squared. Calls carrying one are ignored, like NaN. */
const WORLD_LIMIT = 1000;
const finite3 = (v: V3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const inWorld = (x: number, y: number, z: number): boolean => Math.abs(x) <= WORLD_LIMIT && Math.abs(y) <= WORLD_LIMIT && Math.abs(z) <= WORLD_LIMIT;
/**
 * Unit vector of (x, y, z) into out[0..2] and its length into out[3]; false for a zero or non-finite vector. A vector with a component
 * outside 1e-6..1e6 is first scaled by its largest component, so 1e300 or 1e-300 components neither overflow nor underflow (inside that
 * range it is the plain x / |v|, bit for bit).
 */
function unitOf(x: number, y: number, z: number, out: Float64Array): boolean {
  const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (!(m > 0) || m === Infinity) return false;   // NaN fails m > 0
  let k = 1;
  if (m < 1e-6 || m > 1e6) { k = m; x /= m; y /= m; z /= m; }
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l; out[3] = l * k;
  return true;
}

const ZERO3: V3 = { x: 0, y: 0, z: 0 };
/** The region of PieceOpts when it names at least one plane (ONE convex cell); null for none or for the whole's empty cell (the legacy build then applies). Two or more
 *  cells are not built in this version (CUT2 3.2, 3.3): a caller bug, not a player-reachable state. */
function regionOf(r: PieceRegion | undefined): PieceRegion | null {
  if (!r || typeof r !== 'object' || !Array.isArray(r.cells) || !Array.isArray(r.planes) || r.cells.length === 0) return null;
  if (r.cells.length > 1) throw new Error('SoftBody: a piece is exactly one convex cell in this build (got ' + r.cells.length + ')');
  const c = r.cells[0];
  return Array.isArray(c) && c.length > 0 ? r : null;
}
/** planCut's scratch (module level: JS runs one call at a time; nothing is allocated per call). */
const PC_PLANE = new Float64Array(4);                          // clipMesh's plane [nx, ny, nz, d]
const PC_PL5 = new Float64Array(5);                            // planSplit's [nx, ny, nz, d, parentFrac]
const PC_SCAL = new Float64Array(2);                           // [dW, the median offset]: doubles that must not cross a call
const PC_CELL_A: RegionCell = { np: 0, pl: new Float64Array(4 * (MAX_PLANES + 1)) };   // the two children's cells (the parent's half-spaces + the cut)
const PC_CELL_B: RegionCell = { np: 0, pl: new Float64Array(4 * (MAX_PLANES + 1)) };
const PC_SV = new Float64Array(2);                             // starVolume's [volume, phi]
const PC_PARTS = newCutPlanParts();
const PC_TRUE = newCutPlanParts();                              // trueShares' scratch
const PC_PLW = new Float64Array(5);                            // ... and the plane in W [nx, ny, nz, d, parentFrac]
const PC_N: V3 = { x: 0, y: 0, z: 1 };
const PC_PL4W = new Float64Array(4);                           // the latched plane in W [nx, ny, nz, d] for the parts analysis
const PC_CLIP = new Float64Array(16);
/** A planCut with phi (the share of the child that straight rays from its clipped centroid reach) at or above this is sound outright; below it the centre search of
 *  prepareCut decides (4.1 step 3, 4.5). */
const PC_PHI_OK = PIECE_TUNING.PHI_OK;

/** 6 x the signed volume of the tetrahedron (o, p_a, p_b, p_c) for points of P (indices a, b, c are point indices into P, 3 per point). */
function tetra6(P: Float64Array, a: number, b: number, c: number, ox: number, oy: number, oz: number): number {
  const ax = P[a * 3] - ox, ay = P[a * 3 + 1] - oy, az = P[a * 3 + 2] - oz;
  const bx = P[b * 3] - ox, by = P[b * 3 + 1] - oy, bz = P[b * 3 + 2] - oz;
  const cx = P[c * 3] - ox, cy = P[c * 3 + 1] - oy, cz = P[c * 3 + 2] - oz;
  return ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
}

/** The closest point of triangle (a, b, c) (point offsets into P, already x3) to (px, py, pz) (Ericson, Real-Time Collision Detection 5.1.5), written to out:
 *  out[0..2] the point, out[3..5] its barycentric weights of a, b, c. */
export function closestOnTri(px: number, py: number, pz: number, P: Float64Array, a: number, b: number, c: number, out: Float64Array): void {
  CT_PT[0] = px; CT_PT[1] = py; CT_PT[2] = pz;
  closestOnTriP(P, a, b, c, out, CT_PT);
}
const CT_PT = new Float64Array(3);
/** closestOnTri with the point in pt[0..2]: the hot loop of contactPiece calls THIS one (a function this size is not inlined, and three doubles passed to it are three HeapNumbers a call: 7 KB of garbage a frame at 24 pieces, CUT3 X22). The same arithmetic, bit for bit. */
function closestOnTriP(P: Float64Array, a: number, b: number, c: number, out: Float64Array, pt: Float64Array): void {
  const px = pt[0], py = pt[1], pz = pt[2];
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; out[3] = 1; out[4] = 0; out[5] = 0; return; }
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = P[b]; out[1] = P[b + 1]; out[2] = P[b + 2]; out[3] = 0; out[4] = 1; out[5] = 0; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; out[3] = 1 - v; out[4] = v; out[5] = 0; return;
  }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = P[c]; out[1] = P[c + 1]; out[2] = P[c + 2]; out[3] = 0; out[4] = 0; out[5] = 1; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; out[3] = 1 - w; out[4] = 0; out[5] = w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out[0] = P[b] + w * (P[c] - P[b]); out[1] = P[b + 1] + w * (P[c + 1] - P[b + 1]); out[2] = P[b + 2] + w * (P[c + 2] - P[b + 2]); out[3] = 0; out[4] = 1 - w; out[5] = w; return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w; out[3] = 1 - v - w; out[4] = v; out[5] = w;
}

/** Buckets of the per-body particle hash collide() looks particles up in (a power of two). */
const HASH_SIZE = 1024;
/** collide() remembers its last contact with at most this many other bodies (by their per-process id, modulo): the 'bump' on a new contact. */
const MAX_OTHERS = 16;             // a body without a contactSlot: its bump memory key is bodyId & 15 (as before PLAYGROUND), in entries MAX_SLOTS + (bodyId & 15)
const MAX_SLOTS = 32;              // PLAYGROUND (PH-19): a body WITH a contactSlot (0..31, the shell's) has its own entry: two partners never share one
let nextBodyId = 0;

/** CUT: the rest shape of a piece (CUT.md 4.3): the face piece is the species shape, a chunk a rounded blob (shape.ts buildChunkRest), each
 *  scaled so that its volume is exactly `frac` x the whole squishy's (the whole as the game builds it: detail 3), whatever its own mesh detail
 *  (a detail-2 mesh of the same shape encloses a few per cent less). The nominal radius is the whole's x cbrt(frac). */
const WHOLE_VOL = new Map<string, number>();
function pieceRest(genome: Genome, mesh: IcoMesh, frac: number, chunk: boolean): RestShape {
  const pg = physicsGenome(genome), key = `${pg.species}/${pg.size}`;
  let vw = WHOLE_VOL.get(key);
  if (vw === undefined) { vw = buildRest(genome, buildIcosphere(3)).restVolume; WHOLE_VOL.set(key, vw); }
  const R0 = restRadiusOf(genome) * Math.cbrt(frac);
  const r = chunk ? buildChunkRest(mesh, R0) : buildRest(genome, mesh);
  const s = Math.cbrt((frac * vw) / r.restVolume);
  for (let i = 0; i < r.restLocal.length; i++) r.restLocal[i] *= s;
  return { ...r, restRadius: R0, restCenterY: r.restCenterY * s, restVolume: r.restVolume * s * s * s, height: r.height * s };
}

/** A SolverMaterial made safe (it may come from a caller): every number finite and inside the range the solver is stable for. */
function sanitizeMaterial(m: SolverMaterial): SolverMaterial {
  const g = resolveMaterial(DEFAULT_FAMILY_ID, {} as Genome).solver;
  const src = (m && typeof m === 'object' ? m : g) as unknown as Record<string, unknown>;
  const num = (k: keyof SolverMaterial, lo: number, hi: number): number => {
    const v = src[k];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : clamp(g[k] as number, lo, hi);
  };
  return {
    scale: g.scale,   // the scales are already in the parameters (applyMaterial); kept for completeness
    volFloor: num('volFloor', 0.3, 1), volOutTau: num('volOutTau', 0.02, 10), volInTau: num('volInTau', 0.02, 10), volDampZeta: num('volDampZeta', 0, 2),
    memStiff: num('memStiff', 0, 8), memTau: num('memTau', 0.02, 10), memYield: num('memYield', 0, 0.3), memHealTau: num('memHealTau', 0.1, 60),
    memMax: num('memMax', 0, 1), jam: num('jam', 0, 1), tack: num('tack', 0, 1), tackBreakR0: num('tackBreakR0', 0, 2), tackAlphaT: num('tackAlphaT', 0, 2),
    stringiness: num('stringiness', 0, 1), sloshMass: num('sloshMass', 0, 0.6), sloshHz: num('sloshHz', 0.5, 8), sloshZeta: num('sloshZeta', 0.02, 1), snap: num('snap', 0, 1),
  };
}

export class SoftBody implements SoftBodyLike {
  readonly vertexCount: number;
  readonly positions: Float32Array;
  restLocal!: Float32Array;
  readonly indices: Uint32Array;
  readonly strain: Float32Array;
  readonly center: V3 = { x: 0, y: 0, z: 0 };
  readonly frame = { x: 0, y: 0, z: 0, w: 1 };
  readonly metrics: SoftMetrics = {
    compression: 0, compressionRate: 0, stretch: 0, volume: 1, kinetic: 0, grounded: true, fingers: 0, grabbed: false, press: 0, reaction: 0, strands: 0, slosh: 0,
    pull: 0, carried: false, locked: 0,
    asleep: false, onProp: -1, airborne: false, memoryBusy: false, contacts: 0, submerged: 0,   // PLAYGROUND (PG_PHYS; submerged: props.ts writes it in a water zone)
  };
  restRadius!: number;
  /** Harness-only counters (not part of SoftBodyLike). `safetyResets` must stay 0: it counts emergency non-finite recoveries. */
  readonly debug = { substeps: 0, safetyResets: 0, contacts: 0, maxSpeed: 0, minVolume: 1, force: 0, goalDrift: 0, foldWork: 0 };
  /** Resolved solver parameters (genome-derived plus any `opts.params` override). */
  readonly params: SoftParams;
  /** Frames per phase of warmUp()'s workout (a harness knob for timing it; the default is what the probe measures). */
  static warmFrames = 6;
  /** Harness knob (probe_truecut L6): false = the shipped neck goal, not re-centred (CUT2 5.1). Always true in the game. */
  static centreGoal = true;

  // ---- what warmUp() needs to build a twin (the genome is kept by reference, never mutated)
  private readonly genomeRef: Genome;
  private readonly detailArg: number | undefined;
  private readonly pieceArg: PieceOpts | undefined;
  // ---- CUT (CUT.md 4): the piece this body is, its fraction of the whole (built, now, and an eased change), the neck, the chunk's flat face
  private fracBuilt!: number;
  private fracNow = 1; private fracFrom = 1; private fracTo = 1; private fracT0 = 0; private fracDur = 0;
  private readonly chunk: boolean;
  private FLAT!: Float64Array;      // a chunk's goal with the flat cut face (rest-local); the goal eases from it to Q
  private flatK = 0;                        // 1 = the flat face, 0 = rounded over
  private readonly roundTau: number;
  private neckOn = false; private neckT = 0; private neckTarget = 0; private neckKappa = 0; private volNeck = 0;
  private npx = 0; private npy = 0; private npz = 0; private nnx = 0; private nny = 1; private nnz = 0;   // neck plane (world): the latched plane carried by the body's current pose (neckWorld), for the contact fold band
  private nkLatched = false; private nrx = 0; private nry = 0; private nrz = 0; private nrnx = 0; private nrny = 1; private nrnz = 0;   // CUT2 5.4: the neck plane LATCHED in the rest-local frame (a point on it, relative to the centre, and the unit normal), taken once at the first setNeck with t > 0
  private nkDepth = 1; private nkCap = 1;      // CUT2 5.4: the pinch depth 0..1 (1 = the waist NECK_WAIST of today), and the largest depth the plane's tilt allows (NECK_OBL), taken with the latch
  private homeX = 0; private homeZ = 0;     // reset() puts a piece back here (a whole body: the origin, as always)
  // ---- CUT2 (TRUE CUT, _spec/CUT2.md): what the body is (a real part of the squishy), and the plan of a cut of it (planCut / prepareCut)
  /** true for a body built with a region: it has a flat cut face (the contact of task P5 reads it). */
  readonly capFlat: boolean;
  /** CUT2 5.1/3: a body built with a region publishes what part of the whole it is (immutable; a merge publishes a NEW object); undefined for a whole or a legacy piece. */
  readonly piece: PieceInfo | undefined;
  private src: Source | null;                 // the whole's source solid (region bodies from the start, a whole on its first planCut)
  private regionArg: PieceRegion | undefined; // the region this body was built with (the parent of a cut of it)
  private cellData: RegionCell;               // ... compiled: the half-spaces n . x >= d of its one cell, in W
  private offX = 0; private offY = 0; private offZ = 0;   // PieceInfo.offset: the W position of this body's rest origin (0 for a whole)
  private smOmega0 = 0;                       // smOmega before the piece-size scaling (initRest applies it)
  private restWBuf: Float64Array | null = null;   // Q + offset: the rest mesh in W (the parent of a CutJob), made on the first prepareCut
  private latchOn = false; private lnx = 0; private lny = 0; private lnz = 1; private lnd = 0;   // the latched cut plane, in this body's rest-local frame (3.4)
  private lSound = true; private lPending = false;                                              // planCut's provisional soundness of the two children
  private cutJob: CutJob | null = null; private cutOut: CutPlan | null = null; private cutState = 0;   // prepareCut: 0 none, 1 running, 2 built, 3 thin, 4 loose
  private cutParts: CutParts | null = null;   // CUT3 leg 3: the connected parts of the latched cut on this body's rest mesh (parts.ts), read by fillPlan
  private readonly pvel = new Float64Array(2 * MAX_PARTS * 4);   // ... and each part's mass-weighted velocity sums (x, y, z, mass)
  private lastJobD = 0;                       // the plane offset (W) the plan was last refreshed for (the retry ladder moves it)
  private planD = 0;                          // the rest-local plane offset the plan in `cutOut` describes
  private readonly tsK = new Float64Array(5); private readonly tsR = new Float64Array(9); private tsOk = false;   // CUT3 trueShares' cache: the latched plane (W) and its result
  // ---- CUT3 SLEEP / WAKE (a resting PIECE stops stepping; it is still drawn at its pose): see restCheck
  private asleep = false;
  private restT = 0;                          // seconds the body has been at rest (restCheck's test passed on every step since)
  private calmT = 0;                          // seconds it has been calm: restT's test without the 'stands on the table' bar (a calm body that leans on a sleeper does not wake it)
  private readonly canSleep: boolean;         // a piece (built with `piece`); a whole squishy never sleeps
  private bRvalid = false;                    // bR is current (a sleeper's does not change)
  private restRef: Float64Array;             // the pose the rest countdown started from (a piece's positions; empty for a whole until sleepEnabled)
  private restRefOn = false;
  private ow = 1;                             // collide's pair in hand: 1 = the other body takes its share of every push, 0 = it sleeps and is a fixed support
  private cpContacts = 0;                     // the contact count of the last contactPiece
  private restMem = 0;                        // memoryStep: the largest move of the memory shape in the last frame (rest frame, rest radii)
  private readonly sleepStats = { sleeps: 0, wakes: 0, asleepSteps: 0 };   // harness readout (not part of the state)
  // ---- PLAYGROUND (PG_PHYS, PLAYGROUND_BUILD 8): sleep for wholes, the LIFE drivers and the touch gate, the prop pass. All inert until used (see PG).
  private sleepOn = false;                    // sleepEnabled: a WHOLE body may sleep (the shell opts in place and party bodies)
  /** PLAYGROUND (contracts.ts): the shell's contact slot 0..31 (-1 = none). Strikes carry it (PropWorldLike.drainStrikes). */
  contactSlot = -1;
  private bndShape = -1; private bndCx = 0; private bndCz = 0; private bndA = 0; private bndB = 0; private bndR = 0;   // setBounds (shape -1: the home corral)
  private cyOn = false; private cyT0 = 0; private cyDur = 1; private cySx = 0; private cySy = 0; private cySz = 0; private cyEx = 0; private cyEy = 0; private cyEz = 0; private cyArc = 0;   // carryTo
  private contactsAcc = 0;                     // PH-19: the contact slots this body touched in this frame's collides (published as metrics.contacts at the next step)
  private thrownF = false; private thrownCalm = 0;   // SoftEvent.auto: the player let go of the body (a grab or a carry released: a toss) since its last landing or its settling
  private evAuto = false; private evProp = -1; private evOther = -1;   // the next emit's SoftEvent.auto / prop / other (land and bump set them; emit resets them)
  private propBumpT: Int32Array = new Int32Array(0);   // per prop: the substep index of this body's last contact with it (a prop 'bump' is the start of a contact, like a body's)
  private scootOn = false; private stx = 0; private stz = 0; private sSpeed = 0; private sV = 0; private sGx = 0; private sGz = 0;   // scootTo: target, asked speed, the glide's speed and velocity now
  private sqTarget = 1; private sqNow = 1; private sqTau = 0.12; private sqAskTau = 0;   // setSquash: the asked squash (1 = released), the eased one, its time constant, the call in force
  private hopLeft = 0; private hopT = -10; private glueK = 1;   // hop: substeps left with the glue and peel suspended, its sim time, the tack factor (0 during them)
  private heldF = false;                       // the touch gate this frame: a finger down, a grab, a carry or a lock
  private suppEff = 0;                         // the share of the weight the supports carry this substep (supp x (1 - goal float) x glueK): the weight transfer
  private subK = 0;                            // the substep's index inside this frame (moving props advance by it)
  private pw: PropWorldLike | null = null; private ps: PropSolve | null = null;   // the bound prop world and its packed data
  private pbcx = 0; private pbcy = 0; private pbcz = 0; private pbR = 0;           // the body's bounding sphere at the frame start, with a margin for the frame's motion
  private propNear = 0; private propNearM = 0; private propMinY = 0;               // particles on up-facing prop faces this substep, their mass, the lowest support height
  private pminRaw = 0; private tblNearM = 0; private propFoldT = 0; private scootBlock = false; private peelRef = 0;                                       // the lowest prop face this substep; the table's own supported mass
  private supSx = 0; private supSy = 0; private supSz = 0;                         // their mass-weighted face normals (with the table's, the tilt of the support)
  private tiltOn = false; private tnx = 0; private tny = 1; private tnz = 0;       // the support is tilted past PG.tiltCos: gravity keeps its tangential part along (tnx, tny, tnz)
  private onMoving = false; private onPropIdx = -1; private fdl = 0;               // on a moving prop now; the prop carrying the most mass; the fingertips' downward push (the prop friction load)
  private holdOn = false; private holdAx = 0; private holdAy = 0; private holdAz = 0;   // D-95 AUTO: the rider's hold on a swing AUTO drives (an acceleration of the whole body)
  private bodyMass = 1;                        // (restRadius / 0.5)^3 x frac: the body's mass in default wholes (prop impulses)
  private memDev = 0; private readonly memBusyFam: boolean;                        // max |MEM - Q| / restRadius (memoryStep); the family reports memoryBusy
  private readonly pk = new Float64Array(16);  // the prop's pose this substep: centre (3), rotation (9), spare
  private readonly bq = new Float64Array(3);   // boundsAt's result: the signed distance from the place area's edge and the outward normal (x, z)
  private readonly pq = new Float64Array(6);   // a particle's signed distance to the prop and the prop's outward normal there (and wakesWhole's arguments)
  private propNM = new Float64Array(0);        // per prop this substep: supported mass and its mass-weighted centroid (x, y, z)
  // ---- B2 body-to-body contact (collide): this frame's vertex normals and particle hash (built once per frame on demand)
  private readonly VN: Float64Array;
  private vnStamp = -1;
  private readonly hashHead: Int32Array; private readonly hashNext: Int32Array;
  private hashStamp = -1; private hashCell!: number;   // hash cell edge: 1.5 x the mean rest edge
  meanEdge!: number;                // mean rest edge length (collide's contact skin); public since CUT2 (SoftBodyLike.meanEdge)
  private bR = 0;                           // boundRadius()'s result
  private vtStart: Int32Array | null = null;    // CUT2 5.5: the triangles around each vertex (CSR), built on the first contact with a piece; the closest point of a contact is searched there
  private vtList: Int32Array | null = null;
  private readonly cpPt = new Float64Array(4);   // the particle contactPiece looks the closest point of (closestOnTriP reads it here: no boxed doubles)
  private readonly cpS = new Float64Array(12);  // closestOnTri's scratch (point, weights) and the best of the triangles around the nearest vertex
  private readonly contactWith: Int32Array; // per other-body slot: the substep index of the last contact (bump on a new contact)
  private bodyId = 0;                       // a per-process id (collide's contact memory); not part of the state hash
  // ---- B3 pick up and toss
  private carried = false;
  private twoHanded = false;           // two fingers have been on the body since the last time none was: no pick up (see updateGrabs)
  private carrier = 0;                 // the grab (0 | 1) whose hand carries the body
  private carryOx = 0; private carryOy = 0; private carryOz = 0;      // the body's centre relative to the hand while carried
  private hvx = 0; private hvy = 0; private hvz = 0;                  // the hand's smoothed velocity (m/s)
  private phx = 0; private phy = 0; private phz = 0;                  // the hand target at the last substep
  // LOCK FIX: the pose just before the pick-up (made on the first lift of a body, not before), so a Shift tap on a body that was lifted anyway can put it back and lock the stretch (lockGrab)
  private liftX: Float64Array | null = null; private liftV: Float64Array | null = null; private liftPin: Uint8Array | null = null;
  private liftOk = false; private liftPinCount = 0; private liftPinHold = 0;
  private liftCx = 0; private liftCy = 0; private liftCz = 0; private liftVcx = 0; private liftVcy = 0; private liftVcz = 0;

  // ---- configuration
  private readonly n: number;
  private readonly ne: number;
  private readonly nt: number;
  private readonly p: SoftParams;
  private restVolume!: number;
  private restCenterY!: number;
  private invM!: Float64Array;      // 1 / mass
  private M!: Float64Array;         // mass
  private Mtot!: number;
  private Q!: Float64Array;         // rest local positions
  private softW!: Float64Array;     // per-vertex shape-matching stiffness multiplier
  private floppyW!: Float64Array;   // per-vertex weight of the floppy part (the swirl-peak): 0 body .. 1 tip
  private readonly tris: Uint32Array;
  private readonly E3: Int32Array;          // edge endpoints, pre-multiplied by 3
  private EWA!: Float64Array;       // edge inverse masses (a, b) and their sum
  private EWB!: Float64Array;
  private EWS!: Float64Array;
  private EL!: Float64Array;        // edge rest lengths
  private ESOFT!: Float64Array;     // strain limit (in length) beyond which the edge hardens
  private readonly nh: number;            // hinge count (interior edges)
  private readonly hingeLim: number;       // hinge barrier limit and compliance after the resolution scaling
  private readonly hingeAlpha: number;
  private readonly H3: Int32Array;          // hinge opposite-vertex pairs (pre-multiplied by 3)
  private readonly HE3: Int32Array;         // hinge edge endpoints (pre-multiplied by 3)
  private readonly touchStamp: Int32Array;  // substep index at which each particle was last put in the fold limit's list (dedupe)
  private readonly tipStamp: Int32Array;    // substep index at which each particle was last near a fingertip (FINGER.foldNear)
  private lastTipSub = -1000000;            // the last substep a fingertip was down or retracting
  private readonly tipFoldSubs: number;     // how long the skin a tip had near it stays in the fold limit (TIP_FOLD_AFTER, per family)
  private readonly nearList: Int32Array;    // those particles this substep (tipNearN of them), in scan order
  private tipNearN = 0;
  private readonly hingeStart: Int32Array;  // CSR: vertex -> the interior edges (hinges) it belongs to (as edge, or as opposite vertex)
  private readonly hingeOf: Int32Array;
  private readonly hingeStamp: Int32Array;  // substep index at which each hinge was last queued for the fold limit
  private readonly hingeList: Int32Array;   // the hinges near a fingertip this substep (hingeCount of them)
  private hingeCount = 0;
  private HC!: Float64Array;        // per hinge, the contact fold limit (5.3): cosine of the smallest interior angle, and the cosine / sine of half of it
  private HCH!: Float64Array;
  private HSH!: Float64Array;
  private HD!: Float64Array;        // rest distance between the two opposite vertices
  private HP!: Float64Array;        // rest distance of each opposite vertex from the hinge's edge line (2 per hinge; the sliver floor)
  private HW!: Float64Array;        // their inverse-mass sum
  private readonly valence: Float32Array;
  private readonly nbrStart: Int32Array;    // CSR adjacency (vertex -> neighbours) for the Laplacian term
  private readonly nbrIdx: Int32Array;
  private readonly nbrInv: Float64Array;
  private LQ!: Float64Array;        // rest Laplacian offsets q_i - mean(q_nbrs)
  private invH!: Float64Array;      // 1 / mean rest edge length around each vertex (crease detection scale)
  private volAlphaT!: number;       // volume compliance (alpha tilde)
  private ns!: number;              // thin-part struts (struts.ts): count, endpoints (pre-multiplied by 3), rest lengths, inverse-mass sums
  private S3!: Int32Array; private SL!: Float64Array; private SW!: Float64Array;
  private readonly tipSpeed: number;        // FINGER.maxSpeed scaled to the mesh resolution (see updateFingers)
  private smK!: number;             // shape-matching position gain per substep
  private smW2!: number;            // (smOmega H)^2 (x (1 + memStiff)): the jam stiffening scales it
  private readonly bendK: number;           // Laplacian gain per substep
  private readonly dampInt: number;         // local (non-affine) internal velocity damping fraction per substep
  private readonly dampAff: number;         // global (affine squash / stretch / shear) damping fraction per substep
  private readonly dampQ: number;           // nonlinear internal damping, per unit internal speed per substep
  private readonly dragF: number;
  private readonly seedPhase: number;

  // ---- material family (src/data/materials.ts: resolveMaterial -> applyMaterial + solver); every feature is a no-op for the gel
  /** Material family this body was built with (its species' family, or opts.family / opts.mat). Harness readout. */
  readonly family: string;
  private readonly mat: SolverMaterial;
  private readonly bleedOn: boolean;        // volume target (P1)
  // material scalars the per-substep code reads, cached as plain number fields (no object loads, no calls with double arguments in the
  // large substep / finalize functions: V8 does not inline into them, and a double passed to a call is boxed: measured 16-288 B per frame)
  private readonly jamK: number; private readonly volFloor: number; private readonly volOutK: number; private readonly volInK: number;
  private readonly tackS: number; private readonly strandsTau: number; private readonly strandsGain: number; private readonly bleedF: number;
  private vt = 1;                           // current volume target V* / V0 (air bleed), in [volFloor, 1]
  private volS0!: number;           // the volume constraint's own scale S0 (volAlphaT = volKappa * S0)
  private readonly memOn: boolean;          // memory arm (P2)
  private readonly wm: number;              // share of the shape stiffness that relaxes: memStiff / (1 + memStiff)
  private MEM!: Float64Array;       // memory shape (rest frame, centred like Q)
  private readonly plasticOn: boolean;      // memory with a yield: the edge rest lengths follow the memory (plastic set)
  private readonly sloshOn: boolean;        // slosh mode (P5)
  private slx = 0; private sly = 0; private slz = 0; private slvx = 0; private slvy = 0; private slvz = 0;
  private pvcx = 0; private pvcy = 0; private pvcz = 0;   // centre-of-mass velocity of the previous substep (slosh drive)
  private eax = 0; private eay = 0; private eaz = 0;       // the external acceleration the solver applied this substep (slosh drive)
  private strandsT = 0;                     // metrics.strands envelope (P6 fallback: friction + a strands signal for the renderer)
  // ---- goal shape: the shape matching, the Laplacian and (when it changes size) the edges aim at QG instead of Q
  private goalOn = false;
  private QG!: Float64Array;
  private QGN!: Float64Array;       // the goal without the tremble (what the skin's rest lengths follow; frameUpdate)
  private GB!: Float64Array;        // the goal without the memory arm (fold, burst, the cut), rest frame (frameUpdate, memoryStep)
  private volScale = 1;                     // the volume target's scale from setFrac: (frac now / frac built)
  private fracScale = 1;                    // ... and the goal's: cbrt of that
  private LQG!: Float64Array;
  private QS!: Float64Array;        // the equal-volume sphere (setFold's target), rest frame
  private NRM!: Float64Array;       // unit rest direction of each particle from the rest centre (tremble, slosh, burst)
  private EL0!: Float64Array;       // true rest edge lengths (strain is measured against these)
  private HD0!: Float64Array;       // true rest hinge distances
  private TPH!: Float64Array;       // tremble phase per particle
  private readonly NN = new Float64Array(9); // mass-weighted mean of n n^T over the rest directions (slosh)
  // ---- ceremony drivers
  private fold = 0; private foldTarget = 0;
  private moveOn = false; private mtx = 0; private mty = 0; private mtz = 0; private moveK = 1;
  private trembleAmp = 0;
  private burstO = 0;
  private edgesBent = false;               // EL / ESOFT / HD currently differ from the rest values

  // ---- state
  private readonly X: Float64Array;         // positions
  private readonly XP: Float64Array;        // predicted positions
  private readonly V: Float64Array;         // velocities
  private readonly GOAL: Float64Array;      // shape-matching goal positions of the last substep
  private readonly GRAD: Float64Array;      // volume gradients (scratch)
  private H0!: Float64Array;        // rest height of each particle above the table (the tack acts on lift beyond it)
  private foot!: Int32Array;        // particles whose rest height is within NEAR of the table (the tack layer acts on these)
  private readonly WV: Float64Array;        // per-substep inverse masses of the volume constraint (blocked particles = 0)
  private readonly pinned: Uint8Array;      // foot particles glued to the table while a lobe is pulled
  private pinCount = 0;
  private pinHold = 0;
  private kinSoft = 1;                      // kinetic fingertip friction multiplier of a family softer than the gel (constructor)
  private gripChangeT = -10;             // simTime of the last grab, lock or release
  private gripWake = 0; private gripCap = 0; private gripAll = false;   // the tail of a hold of several lobes (gripTail)
  private gripT = 0;                     // seconds the wide table band (GRAB_TUNE.band) stays after the last grab or lock
  private tableFoldT = 0;                   // seconds the table edges stay in the contact fold limit (TABLE_FOLD_AFTER after the last touch)
  private goalBottom = 0;                   // lowest point of the shape-matching goal in the last substep (supported gravity, see substep)
  private peelK = 0;                        // share of the upward centre-of-mass speed the peeling tack removes per substep (the tack pass)
  private landT = 0;                        // CUT3 leg 3: seconds left of a piece's landing absorption (PIECE_LAND), raised by an impact on the table or on another piece
  private readonly sums = new Float64Array(25);
  private readonly A9 = new Float64Array(9);
  private readonly qr = new Float64Array([0, 0, 0, 1]);
  private cx = 0; private cy = 0; private cz = 0;       // centre of mass (shape matching, predicted)
  private vcx = 0; private vcy = 0; private vcz = 0;    // rigid centre-of-mass velocity of the last substep
  private gravityOn = true;
  /** Simulated seconds since the last reset() (the float-mode bob phase and the event rate limiter run on it). */
  private simTime = 0;
  /** Substeps since the last reset(). Its parity schedules the Laplacian pass (never `debug.substeps`, a harness counter that
   *  reset() does not clear: keying behaviour on it made reset() differ from a fresh body). */
  private subIdx = 0;
  private acc = 0;
  private airSub = 0;                       // substeps since the last table contact
  private contactCount = 0;                 // particles that touched (y < 0) the table in the last substep
  private nearCount = 0;                    // particles within NEAR of the table at the end of the last substep
  private nearMass = 1;                     // their mass (friction normal-load proxy)
  private supp = 0;                         // 0..1 how much of its weight the table carries (see substep)
  private keAcc = 0;
  private reactAcc = 0;                     // summed fingertip corrections (mass x penetration) of this step's substeps
  private keSubs = 0;
  private prevCompression = 0;
  private lastAxisX = 0; private lastAxisY = 1; private lastAxisZ = 0;
  private lastAxisT = -10;
  private readonly fingers: Finger[] = [new Finger(), new Finger(), new Finger(), new Finger(), new Finger()];
  private readonly grabs: Grab[];
  private readonly locks: Grab[] = [IDLE_GRAB, IDLE_GRAB, IDLE_GRAB, IDLE_GRAB, IDLE_GRAB, IDLE_GRAB];   // LOCK: a lock is a grab whose pointer left; its slot stays in place (lockAt's index)
  private lockN = 0;                    // active locks
  /** LOCK: the most locks at once (6; the shell sets 4 on low quality). */
  maxLocks = MAX_LOCKS;
  private readonly rch = new Float64Array(3);   // updateGrabs: the reachable hand target (reach)
  private readonly shv = new Float64Array(3);   // the carry's step, for shiftGrab (a call takes no doubles: they would be boxed)
  private events: SoftEvent[] = [];
  private readonly lastEvent = new Float64Array(7 * 6).fill(-10);   // per event kind (KIND_INDEX) x finger (-1, 0 .. 4)
  private readonly rayOut = new Float64Array(4);
  private readonly rayOut2 = new Float64Array(4);
  private readonly ray6 = new Float64Array(6);              // rayMesh input scratch (origin, direction)
  private readonly u4 = new Float64Array(4);                // unitOf scratch
  private readonly u4b = new Float64Array(4);
  private readonly SDIST: Float64Array;                   // measureCut: signed distance of each particle from the plane
  private readonly NSCR: Float64Array;                    // setNeck's trial goal (the lobe swell's secant steps)
  private readonly NKS = new Float64Array(6);              // ... and the secant's state
  private readonly CLIP = new Float64Array(4 * 3);        // measureCut: a clipped triangle (up to 4 points)
  private pendingLand = -1;                 // land impact speed waiting to be emitted this step

  /**
   * `options.family` forces a material family (harness), `options.mat` a resolved SolverMaterial (src/data/materials.ts documents
   * `{ params: applyMaterial(deriveParams(neutral), mat), mat: mat.solver }`). With neither, the body takes its species' family
   * (catalog familyOf; an unknown species is the gel) and builds its parameters exactly as materials.ts documents: the genome's
   * firmness / bounce / stretch move it inside the family's band, the base is the physics tuning of a neutral genome.
   */
  constructor(genome: Genome, options: { detail?: number; seed?: number; params?: Partial<SoftParams>; mat?: SolverMaterial; family?: string; piece?: PieceOpts } = {}) {
    const opts = options ?? {};
    this.genomeRef = genome;
    // CUT: a piece of a cut squishy (CUT.md 4.3). Its fraction is sanitised like every input; a small piece gets the coarser mesh
    const pc = opts.piece && typeof opts.piece === 'object' ? opts.piece : null;
    let pf = pc && typeof pc.frac === 'number' && Number.isFinite(pc.frac) ? clamp(pc.frac, FRAC_FLOOR, 1) : 1;
    // CUT2 (5.1, 5.2): with a `region` (one convex cell with at least one plane) the body is the REAL part of the squishy: its rest mesh comes from piece.ts (the
    // cache prepareCut filled during the neck, else built here), `chunk` / `cutNormal` are ignored and `at` is EXACT (no lift). Without a region the legacy build
    // applies: a whole at `at`, the Minis' scaled whole, the old chunk (deleted by task P9).
    const reg = pc ? regionOf(pc.region) : null;
    const chunk = !reg && !!(pc && pc.chunk);
    this.capFlat = reg !== null;
    this.canSleep = pc !== null;
    this.pieceArg = pc ? { ...pc, frac: pf, chunk } : undefined;
    // CUT3: the mesh detail follows the share (0..3: piece.ts pieceDetail); a region piece that fails its build gates at that detail is built at the next finer one (buildPieceLadder:
    // the cut's own build, in the cache, is found at whatever detail it ended at)
    let detail0 = opts.detail ?? (pc ? pieceDetail(pf) : undefined);
    let built: PieceBuilt | null = null;
    if (reg) {
      if (!(pc && typeof pc.frac === 'number' && Number.isFinite(pc.frac))) throw new Error('SoftBody: a piece with a region needs a finite frac');
      const bl = buildPieceLadder(genome, reg, detail0 ?? 3, pf);
      if ('fail' in bl) throw new Error('SoftBody: the piece cannot be built (' + bl.fail + ')');
      built = bl; detail0 = bl.detail;
    }
    this.detailArg = detail0;
    // genome fields are sanitised where they are read (physicsGenome: non-finite -> documented default, finite -> clamped)
    const mesh = buildIcosphere(this.detailArg ?? 3);
    let rest: RestShape;
    if (reg && built) {
      const b = built;
      rest = b.rest;
      const S = getSource(genome);
      pf = rest.restVolume / S.v3;   // frac truth (3.2, 5.6): the body's own measured share; the asked one to 1e-12
      this.src = S;
      this.regionArg = reg;
      this.cellData = compileCell(reg, 0);
      this.offX = b.offset.x; this.offY = b.offset.y; this.offZ = b.offset.z;
      this.piece = { whole: wholeOf(genome), offset: { x: b.offset.x, y: b.offset.y, z: b.offset.z }, rayOrigin: { x: b.rayOrigin.x, y: b.rayOrigin.y, z: b.rayOrigin.z }, cells: cellPlanes(reg) };
    } else {
      this.src = null; this.regionArg = undefined; this.cellData = WHOLE_CELL; this.piece = undefined;
      rest = pc ? pieceRest(genome, mesh, pf, chunk) : buildRest(genome, mesh);
    }
    this.fracBuilt = pf; this.fracNow = pf; this.fracFrom = pf; this.fracTo = pf;
    this.chunk = chunk;
    const n = mesh.vertexCount;
    this.n = n;
    this.nt = mesh.tris.length / 3;
    this.ne = mesh.edges.length / 2;
    {
      const g0 = (genome && typeof genome === 'object' ? genome : {}) as Partial<Genome>;
      const famId = typeof opts.family === 'string' ? opts.family : (getSpecies(g0.species)?.family ?? DEFAULT_FAMILY_ID);
      const resolved = resolveMaterial(famId, g0 as Genome);
      this.family = resolved.familyId;
      // the genome is applied ONCE: through the family's band (resolveMaterial), on the physics tuning of a neutral genome
      const base = deriveParams({ ...g0, firmness: 0.5, bounce: 0.5, stretch: 0.5 } as Genome);
      this.p = applyMaterial(base, resolved);
      this.mat = sanitizeMaterial(opts.mat ?? resolved.solver);
      // GIVE (physics round-2 fix round): a stiffer material gives less under the same press. The fingertip is position-driven (pressure ->
      // depth: squashDepth x thickness), and since round 2 the parameters are built on a NEUTRAL genome, so every family and every genome
      // was pressed exactly as deep as the neutral gel: a firm silicone could only push back harder (feel distance to the gel 0.061), and a
      // genome's firmness no longer changed its give (the starter, firmness 0.38, lost 1% of its depth: the metrics press compressed it
      // 0.198 instead of 0.200). The law is the one deriveParams always used across the firmness range: squashDepth 0.66 -> 0.34 while
      // smOmega 12 -> 40, i.e. depth ~ smOmega^GIVE_EXP (-0.551), applied to the body's smOmega relative to the neutral gel's:
      //   * the GENOME part (firmness band, family-independent) both ways, as before round 2: the starter x1.03, firmness 0 x1.13, 1 x0.88;
      //   * the FAMILY part only where the family is stiffer than the gel (firm silicone x0.76, pop dome x0.70, gummy x0.86). A softer family
      //     keeps the gel's depth: its softness is its memory / bleed / flow, and a press deeper than the gel's was never tuned for it.
      const so = this.p.smOmega / base.smOmega;
      const fam0 = MATERIAL_FAMILIES[resolved.familyId].physics.smOmega / MATERIAL_FAMILIES[DEFAULT_FAMILY_ID].physics.smOmega;
      if (so > 0 && fam0 > 0) this.p.squashDepth *= Math.pow(so / fam0, GIVE_EXP) * (fam0 > 1 ? Math.pow(fam0, GIVE_EXP) : 1);
      // KINETIC FRICTION OF A SOFT FAMILY (physics round-2 fix round): FINGER.frictionKinetic was tuned on the gel, so a rub drags the
      // skin with a force the gel's stiffness holds without creasing. A family softer than the gel (shape stiffness ~ smOmega^2) takes
      // the same drag with (gel / family)^2 more shear: slime (9.5 vs 23) buckled its lower flank 2-4 tip radii from a 2.5 m/s rub
      // (176-179 degrees, the verifier's MAJOR-1). So the sliding coefficient scales with the stiffness ratio squared, at most 1 (the
      // gel and stiffer families keep theirs; static friction, which holds a pressing tip, is unchanged).
      this.kinSoft = fam0 < 1 ? fam0 * fam0 : 1;
    }
    // a parameter override (tuning, material families) only takes finite, non-negative numbers: every SoftParams field is a rate, gain,
    // compliance, length or ratio, and a NaN or a negative one would blow the solver up
    if (opts.params) {
      const pr = this.p as unknown as Record<string, number>, ov = opts.params as Record<string, unknown>;
      for (const k of Object.keys(pr)) { const v = ov[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0) pr[k] = v; }
    }
    // (a piece is a smaller toy of the same material: initRest applies deriveParams' sizeScale to this base value, smOmega ~ 1 / R of the piece's own radius)
    this.smOmega0 = this.p.smOmega;
    this.params = this.p;
    this.vertexCount = n;
    this.tris = mesh.tris;
    this.indices = mesh.tris;
    this.positions = new Float32Array(n * 3);
    this.strain = new Float32Array(n).fill(1);
    this.X = new Float64Array(n * 3);
    this.XP = new Float64Array(n * 3);
    this.V = new Float64Array(n * 3);
    this.GOAL = new Float64Array(n * 3);
    this.GRAD = new Float64Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.restRef = new Float64Array(this.canSleep ? n * 3 : 0);
    this.touchStamp = new Int32Array(n).fill(-1);
    this.tipStamp = new Int32Array(n).fill(-1000000);
    this.nearList = new Int32Array(n);
    this.WV = new Float64Array(n);
    this.grabs = [new Grab(n), new Grab(n), IDLE_GRAB, IDLE_GRAB, IDLE_GRAB];

    // topology: edge and hinge endpoints, adjacency (the rest-dependent data of the same edges and hinges is filled by initRest)
    const ne = this.ne;
    this.E3 = new Int32Array(ne * 2);
    {
      const nh = mesh.hinges.length / 4;
      this.nh = nh;
      this.H3 = new Int32Array(nh * 2); this.HE3 = new Int32Array(nh * 2);
      for (let h = 0; h < nh; h++) {
        const c = mesh.hinges[h * 4 + 2], d = mesh.hinges[h * 4 + 3];
        this.HE3[h * 2] = mesh.hinges[h * 4] * 3; this.HE3[h * 2 + 1] = mesh.hinges[h * 4 + 1] * 3;
        this.H3[h * 2] = c * 3; this.H3[h * 2 + 1] = d * 3;
      }
    }
    {
      const nh = this.nh, cnt = new Int32Array(n + 1);
      for (let h = 0; h < nh; h++) for (let k = 0; k < 4; k++) cnt[mesh.hinges[h * 4 + k] + 1]++;
      for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
      this.hingeStart = Int32Array.from(cnt);
      this.hingeOf = new Int32Array(nh * 4);
      const fill2 = new Int32Array(n);
      for (let h = 0; h < nh; h++) for (let k = 0; k < 4; k++) { const v = mesh.hinges[h * 4 + k]; this.hingeOf[this.hingeStart[v] + fill2[v]++] = h; }
      this.hingeStamp = new Int32Array(nh).fill(-1);
      this.hingeList = new Int32Array(nh);
    }
    this.valence = new Float32Array(n);
    for (let e = 0; e < ne; e++) {
      const a = mesh.edges[e * 2], b = mesh.edges[e * 2 + 1];
      this.E3[e * 2] = a * 3; this.E3[e * 2 + 1] = b * 3;
      this.valence[a] += 1; this.valence[b] += 1;
    }
    this.nbrStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.nbrStart[i + 1] = this.nbrStart[i] + this.valence[i];
    this.nbrIdx = new Int32Array(this.nbrStart[n]);
    const fill = new Int32Array(n);
    for (let e = 0; e < ne; e++) {
      const a = mesh.edges[e * 2], b = mesh.edges[e * 2 + 1];
      this.nbrIdx[this.nbrStart[a] + fill[a]++] = b;
      this.nbrIdx[this.nbrStart[b] + fill[b]++] = a;
    }
    this.nbrInv = new Float64Array(n);
    for (let i = 0; i < n; i++) this.nbrInv[i] = 1 / (this.nbrStart[i + 1] - this.nbrStart[i]);

    // material family switches
    const mt0 = this.mat;
    this.bleedOn = 1 - mt0.volFloor >= BLEED_MIN;
    this.jamK = 6 * mt0.jam; this.volFloor = mt0.volFloor; this.bleedF = this.bleedOn ? 1 : 0;
    this.volOutK = 1 - Math.exp(-H / mt0.volOutTau); this.volInK = 1 - Math.exp(-H / mt0.volInTau);
    this.tackS = mt0.tack > TACK_STRANDS ? mt0.tack : 0; this.strandsTau = 0.08 + 0.2 * mt0.stringiness; this.strandsGain = mt0.tack * (0.5 + 0.5 * mt0.stringiness);
    this.memOn = mt0.memStiff >= MEM_MIN;
    this.wm = this.memOn ? mt0.memStiff / (1 + mt0.memStiff) : 0;
    this.plasticOn = this.memOn && mt0.memYield > 0;
    // a family with a memory arm recovers its shape over memTau (1 + memStiff) s (SQUISHY_SCIENCE 3.1: putty 3 s, slime 3.2 s, beads 0.75 s),
    // and a crumple the fold limit held under the tip is still there that long: the fold-limit hold after the tip leaves lasts as long
    // (TIP_FOLD_AFTER at least, 6x at most); with 0.5 s for every family, putty and slime flipped 1-2 frames past 150 degrees exactly 0.5 s
    // after the lift
    this.tipFoldSubs = Math.round(TIP_FOLD_AFTER * (this.memOn ? Math.min(6, Math.max(1, mt0.memTau * (1 + mt0.memStiff) / 0.5)) : 1));
    this.sloshOn = mt0.sloshMass > 0.01;
    this.roundTau = this.memOn && mt0.memYield > 0 ? 1 + mt0.memStiff : ROUND_TAU;
    // PLAYGROUND: the families whose plastic memory refuses LIFE's squash and hop while it heals (LIFE.md 5.4), and the body's mass in default wholes
    this.memBusyFam = this.memOn && (this.family === 'putty' || this.family === 'mochidough' || this.family === 'beadsqueeze');
    { const rw = restRadiusOf(genome) / 0.5; this.bodyMass = rw * rw * rw * pf; }
    this.VN = new Float64Array(n * 3);
    this.SDIST = new Float64Array(n);
    this.NSCR = new Float64Array(n * 3);
    this.hashHead = new Int32Array(HASH_SIZE); this.hashNext = new Int32Array(n);
    this.contactWith = new Int32Array(MAX_SLOTS + MAX_OTHERS).fill(-1000000);
    this.bodyId = nextBodyId++;
    this.QG = new Float64Array(n * 3); this.QGN = new Float64Array(n * 3); this.GB = new Float64Array(n * 3); this.LQG = new Float64Array(n * 3);
    this.NRM = new Float64Array(n * 3);
    this.QS = new Float64Array(n * 3);
    this.TPH = new Float64Array(n);
    for (let i = 0; i < n; i++) this.TPH[i] = ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) * Math.PI * 2;

    // constants that depend on the mesh resolution only
    // The Laplacian is a 1-ring smoother: per application it spreads a disturbance one edge, so on a mesh with 4x the vertices
    // (detail 4) the same gain smooths a quarter of the physical distance and a press folded the skin it covered. Scale the gain with
    // the vertex count (the diffusion argument: gain x edge^2 stays constant); detail 3 (642 vertices) is the reference.
    this.bendK = Math.min(0.45, this.p.bendK * (n / 642));
    // The hinge barrier likewise wants to be tighter on a finer mesh (more skin under the same fingertip piles up before it can slide
    // out): 0.9 / 0.1 at detail 3 -> 0.8 / 0.05 at detail 4 (log2 of the vertex ratio: +2 at detail 4).
    const lg = Math.log2(n / 642);
    this.hingeLim = clamp(this.p.hingeLimit - 0.05 * lg, 0.8, 0.97);
    this.hingeAlpha = this.p.hingeAlphaT * Math.pow(2, -lg / 2);
    this.dampInt = 1 - Math.exp(-this.p.intDamp * H);
    this.dampAff = 1 - Math.exp(-this.p.affDamp * H);
    this.dampQ = this.p.intDamp2 * H;
    this.dragF = 1 - Math.exp(-this.p.drag * H);
    // The fingertip's speed cap is a per-substep travel limit in disguise: at FINGER.maxSpeed the tip moves 15 mm per substep, ~40% of an edge of
    // the swirl-peak at detail 3. On a finer mesh (detail 4: half the edge length) the same travel is ~80% of an edge, and the skin under a
    // hard shove could not follow it (adjacent triangles crushed onto the sphere at 125-145 degrees). So the cap scales with the edge length
    // (1 / sqrt of the vertex count, detail 3 = 1, never above 1): the same travel per edge on every mesh, detail 3 unchanged.
    this.tipSpeed = FINGER.maxSpeed * Math.min(1, Math.sqrt(642 / n));
    const seed = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed : physicsGenome(genome).seed;
    this.seedPhase = mulberry32(seed >>> 0)() * Math.PI * 2;

    // everything that depends on the rest shape (masses, edge and hinge rest data, struts, the goal buffers, the volume constraint's scale)
    this.initRest(rest, mesh);
    if (chunk) {
      // the flat cut face toward cutNormal (world = the rest frame at creation); default: the face down the -x axis
      const cn = pc && pc.cutNormal && finite3(pc.cutNormal) ? pc.cutNormal : { x: -1, y: 0, z: 0 };
      const cl = Math.hypot(cn.x, cn.y, cn.z) || 1;
      flatPoints(this.Q, mesh.tris, rest.restRadius, cn.x / cl, cn.y / cl, cn.z / cl, this.FLAT);
      this.flatK = 1;
    }

    // a piece starts where the cut left it (its lobe's centre, CUT.md 4.3) with its lobe's velocity; reset() brings it back to that spot
    if (pc && pc.at && finite3(pc.at) && inWorld(pc.at.x, pc.at.y, pc.at.z)) { this.homeX = pc.at.x; this.homeZ = pc.at.z; }
    this.reset();
    if (pc) {
      if (reg) {
        // CUT2: exact placement in the parent's pose, no lift (a lift per piece overlapped siblings by 22 to 48 particles: the shell applies one common lift)
        if (pc.at && finite3(pc.at) && inWorld(pc.at.x, pc.at.y, pc.at.z)) this.placeAt(pc.at, pc.vel && finite3(pc.vel) ? pc.vel : ZERO3, pc.frame);
        else if (pc.vel && finite3(pc.vel)) this.placeAt({ x: this.cx, y: this.cy, z: this.cz }, pc.vel, pc.frame);
        else if (pc.frame) this.placeAt({ x: this.cx, y: this.cy, z: this.cz }, ZERO3, pc.frame);
      } else {
        const X = this.X, V = this.V;
        if (pc.at && finite3(pc.at) && inWorld(pc.at.x, pc.at.y, pc.at.z)) {
          const dy = Math.max(0, pc.at.y - this.cy);
          for (let i = 0; i < n; i++) X[i * 3 + 1] += dy;
          this.XP.set(X); this.GOAL.set(X); this.cy += dy;
        }
        if (pc.vel && finite3(pc.vel)) {
          const vx = clamp(pc.vel.x, -MAX_NUDGE, MAX_NUDGE), vy = clamp(pc.vel.y, -MAX_NUDGE, MAX_NUDGE), vz = clamp(pc.vel.z, -MAX_NUDGE, MAX_NUDGE);
          for (let i = 0; i < n; i++) { V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz; }
        }
      }
      this.syncOutputs();
    }
    for (const o of [this, this.metrics, this.center, this.frame, this.debug, ...this.fingers, ...this.grabs] as object[]) settleDoubles(o, INT_FIELDS);
  }

  /**
   * Everything that depends on the REST SHAPE, in one place so that `adoptRest` (task P6: a joined piece commits to its target's rest shape in place) can run it
   * again: the masses, the rest data of the edges and hinges (lengths, opposite distances, the fold limit of each hinge from its own rest dihedral: 5.3), the
   * struts, the goal buffers and the volume constraint's scale. The topology (edge and hinge endpoints, adjacency) and the per-substep buffers belong to the
   * constructor; the detail never changes. `this.fracBuilt` must be set first (the sizeScale of the stiffness).
   */
  private initRest(rest: RestShape, mesh: IcoMesh): void {
    const n = this.n, ne = this.ne, nh = this.nh, Q = Float64Array.from(rest.restLocal);
    // a piece is a smaller toy of the same material: deriveParams' sizeScale (smOmega ~ 1 / R) for the piece's own radius
    this.p.smOmega = this.fracBuilt < 1 ? this.smOmega0 / Math.cbrt(this.fracBuilt) : this.smOmega0;
    this.restRadius = rest.restRadius;
    this.restVolume = rest.restVolume;
    this.restCenterY = rest.restCenterY;
    this.Q = Q;
    this.softW = new Float64Array(n);
    this.floppyW = Float64Array.from(rest.floppy);
    for (let i = 0; i < n; i++) this.softW[i] = 1 - (1 - this.p.peakSoft) * rest.floppy[i];
    this.M = Float64Array.from(rest.mass);
    this.invM = new Float64Array(n);
    let mt = 0;
    for (let i = 0; i < n; i++) { this.invM[i] = 1 / rest.mass[i]; mt += rest.mass[i]; }
    this.Mtot = mt;
    if (this.restLocal && this.restLocal.length === n * 3) this.restLocal.set(Q); else this.restLocal = Float32Array.from(Q);
    this.restWBuf = null;
    this.H0 = new Float64Array(n);
    for (let i = 0; i < n; i++) this.H0[i] = Q[i * 3 + 1] + rest.restCenterY;
    {
      let fc = 0;
      for (let i = 0; i < n; i++) if (this.H0[i] < NEAR) fc++;
      this.foot = new Int32Array(fc);
      fc = 0;
      for (let i = 0; i < n; i++) if (this.H0[i] < NEAR) this.foot[fc++] = i;
    }
    // hinges: the sliver floor (HP), the opposite vertices' rest distance (HD) and inverse-mass sum (HW), and the fold limit of each hinge (HC, HCH, HSH)
    this.HD = new Float64Array(nh); this.HW = new Float64Array(nh); this.HP = new Float64Array(nh * 2);
    this.HC = new Float64Array(nh); this.HCH = new Float64Array(nh); this.HSH = new Float64Array(nh);
    for (let h = 0; h < nh; h++) {
      const a = mesh.hinges[h * 4], b = mesh.hinges[h * 4 + 1], c = mesh.hinges[h * 4 + 2], d = mesh.hinges[h * 4 + 3];
      const ex = Q[b * 3] - Q[a * 3], ey = Q[b * 3 + 1] - Q[a * 3 + 1], ez = Q[b * 3 + 2] - Q[a * 3 + 2], el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
      for (let k = 0; k < 2; k++) {
        const v = k === 0 ? c : d, vx = Q[v * 3] - Q[a * 3], vy = Q[v * 3 + 1] - Q[a * 3 + 1], vz = Q[v * 3 + 2] - Q[a * 3 + 2];
        const cx = vy * ez - vz * ey, cy = vz * ex - vx * ez, cz = vx * ey - vy * ex;
        this.HP[h * 2 + k] = Math.sqrt(cx * cx + cy * cy + cz * cz) / el;
      }
      this.HD[h] = Math.sqrt((Q[c * 3] - Q[d * 3]) ** 2 + (Q[c * 3 + 1] - Q[d * 3 + 1]) ** 2 + (Q[c * 3 + 2] - Q[d * 3 + 2]) ** 2);
      this.HW[h] = this.invM[c] + this.invM[d];
      // the fold limit knows the hinge's own rest dihedral (5.3): foldLimit measures the interior angle between the two half-planes (pi - the normal dihedral).
      // Only for a body with a cut face (capFlat): a WHOLE body keeps the single limit of today on every hinge, bit for bit (X21), although some of its hinges
      // are sharper at rest than the spec assumed (probe L6b measures up to 97 degrees on a thin tip at detail 4)
      let lim = FINGER.foldMaxDeg;
      if (this.capFlat) {
        const ux = ex / el, uy = ey / el, uz = ez / el;
        let cx = Q[c * 3] - Q[a * 3], cy = Q[c * 3 + 1] - Q[a * 3 + 1], cz = Q[c * 3 + 2] - Q[a * 3 + 2];
        const tc = cx * ux + cy * uy + cz * uz;
        cx -= tc * ux; cy -= tc * uy; cz -= tc * uz;
        let dx = Q[d * 3] - Q[a * 3], dy = Q[d * 3 + 1] - Q[a * 3 + 1], dz = Q[d * 3 + 2] - Q[a * 3 + 2];
        const td = dx * ux + dy * uy + dz * uz;
        dx -= td * ux; dy -= td * uy; dz -= td * uz;
        const lc = Math.sqrt(cx * cx + cy * cy + cz * cz), ld = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (lc > 1e-12 && ld > 1e-12) {
          const cosInt = Math.max(-1, Math.min(1, (cx * dx + cy * dy + cz * dz) / (lc * ld)));
          const dihedral = 180 - (Math.acos(cosInt) * 180) / Math.PI;   // degrees between the two face normals at rest (0 = flat)
          lim = Math.min(170, Math.max(FINGER.foldMaxDeg, dihedral + 30));
        }
      }
      const half = (Math.PI - (lim * Math.PI) / 180) / 2;
      this.HCH[h] = Math.cos(half); this.HSH[h] = Math.sin(half); this.HC[h] = Math.cos(2 * half);
    }
    // edges: rest lengths and the inverse masses of the ends
    this.EWA = new Float64Array(ne); this.EWB = new Float64Array(ne); this.EWS = new Float64Array(ne);
    this.EL = new Float64Array(ne); this.ESOFT = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
      const a = mesh.edges[e * 2], b = mesh.edges[e * 2 + 1];
      this.EWA[e] = this.invM[a]; this.EWB[e] = this.invM[b]; this.EWS[e] = this.invM[a] + this.invM[b];
      const l = Math.sqrt((Q[a * 3] - Q[b * 3]) ** 2 + (Q[a * 3 + 1] - Q[b * 3 + 1]) ** 2 + (Q[a * 3 + 2] - Q[b * 3 + 2]) ** 2);
      this.EL[e] = l; this.ESOFT[e] = l * this.p.edgeSoftStrain;
    }
    // rest Laplacian offsets, crease-detection scale
    this.LQ = new Float64Array(n * 3);
    this.invH = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.nbrStart[i], e = this.nbrStart[i + 1];
      let mx = 0, my = 0, mz = 0;
      for (let j = s; j < e; j++) { const k = this.nbrIdx[j] * 3; mx += Q[k]; my += Q[k + 1]; mz += Q[k + 2]; }
      const inv = this.nbrInv[i];
      let sl = 0;
      for (let j = s; j < e; j++) { const k = this.nbrIdx[j] * 3; sl += Math.sqrt((Q[k] - Q[i * 3]) ** 2 + (Q[k + 1] - Q[i * 3 + 1]) ** 2 + (Q[k + 2] - Q[i * 3 + 2]) ** 2); }
      this.invH[i] = 1 / (sl * inv);
      this.LQ[i * 3] = Q[i * 3] - mx * inv; this.LQ[i * 3 + 1] = Q[i * 3 + 1] - my * inv; this.LQ[i * 3 + 2] = Q[i * 3 + 2] - mz * inv;
    }
    this.MEM = Float64Array.from(Q);
    this.FLAT = new Float64Array(n * 3);
    {
      let el = 0;
      for (let e = 0; e < ne; e++) el += this.EL[e];
      this.meanEdge = el / Math.max(1, ne);
      this.hashCell = 1.5 * this.meanEdge;
    }
    this.QG.set(Q); this.QGN.set(Q); this.GB.set(Q); this.LQG.set(this.LQ);
    this.EL0 = Float64Array.from(this.EL);
    this.HD0 = Float64Array.from(this.HD);
    {
      // equal-volume sphere around the rest centre, on the same directions (the mesh's own volume, so the fold keeps the volume exactly)
      const N9 = this.NN;
      N9.fill(0);
      for (let i = 0; i < n; i++) {
        const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
        this.NRM[i * 3] = x / l; this.NRM[i * 3 + 1] = y / l; this.NRM[i * 3 + 2] = z / l;
      }
      for (let i = 0; i < n; i++) {
        const m = rest.mass[i] / mt, x = this.NRM[i * 3], y = this.NRM[i * 3 + 1], z = this.NRM[i * 3 + 2];
        N9[0] += m * x * x; N9[1] += m * x * y; N9[2] += m * x * z; N9[3] += m * y * x; N9[4] += m * y * y; N9[5] += m * y * z; N9[6] += m * z * x; N9[7] += m * z * y; N9[8] += m * z * z;
      }
      const unitVol = meshVolume(this.NRM, mesh.tris);
      const rs = Math.cbrt(rest.restVolume / unitVol);
      for (let i = 0; i < n * 3; i++) this.QS[i] = this.NRM[i] * rs;
    }
    // constants derived from params at the fixed substep
    const wh = this.p.smOmega * H;
    // memory arm: the instantaneous stiffness is (1 + memStiff) x the relaxed one (SQUISHY_SCIENCE 3.1); the implicit form stays stable
    const wh2 = wh * wh * (this.memOn ? 1 + this.mat.memStiff : 1);
    this.smK = wh2 / (1 + wh2);
    this.smW2 = wh2;
    this.volS0 = this.volumeScale(Q);
    this.volAlphaT = this.p.volKappa * this.volS0;
    {
      // thin-part struts: chords through the inside of the swirl-peak (struts.ts)
      const st = buildStruts(Q, mesh, rest.strutW, this.p.strutTau, this.p.strutMaxR * rest.restRadius, Math.round(this.p.strutPer), this.p.strutCos, rest.feature);
      this.ns = st.count; this.S3 = st.ends3; this.SL = st.rest; this.SW = new Float64Array(this.ns);
      for (let k = 0; k < this.ns; k++) this.SW[k] = this.invM[st.ends3[k * 2] / 3] + this.invM[st.ends3[k * 2 + 1] / 3];
    }
  }

  get gravity(): boolean { return this.gravityOn; }
  set gravity(v: boolean) {
    const on = !!v;
    if (on === this.gravityOn) return;
    this.gravityOn = on;
    this.airSub = 0;
    this.wake();   // CUT3: a change of the gravity mode wakes a sleeping piece
    if (!on) { this.pinned.fill(0); this.pinCount = 0; this.carried = false; this.liftOk = false; }   // a floating body has no table to be glued to (nor a carry)
  }

  // ------------------------------------------------------------------------------------------------ public API

  reset(): void {
    const n = this.n, X = this.X, Q = this.Q;
    const oy = this.gravityOn ? this.restCenterY : this.hoverY(0), hx = this.homeX, hz = this.homeZ;
    for (let i = 0; i < n; i++) {
      X[i * 3] = Q[i * 3] + hx; X[i * 3 + 1] = Q[i * 3 + 1] + oy; X[i * 3 + 2] = Q[i * 3 + 2] + hz;
      this.GOAL[i * 3] = X[i * 3]; this.GOAL[i * 3 + 1] = X[i * 3 + 1]; this.GOAL[i * 3 + 2] = X[i * 3 + 2];
    }
    this.XP.set(X);
    this.V.fill(0);
    this.qr[0] = 0; this.qr[1] = 0; this.qr[2] = 0; this.qr[3] = 1;
    this.cx = hx; this.cy = oy; this.cz = hz;
    this.vcx = 0; this.vcy = 0; this.vcz = 0;
    this.acc = 0; this.airSub = this.gravityOn ? 0 : 1000; this.contactCount = 0;
    {
      let near = 0, nearM = 0;
      for (let i = 0; i < n; i++) if (X[i * 3 + 1] < NEAR) { near++; nearM += this.M[i]; }
      this.nearCount = near; this.nearMass = Math.max(1, nearM);
      this.supp = this.gravityOn ? smooth01((near - 1) / 4) : 0;
    }
    this.keAcc = 0; this.keSubs = 0; this.prevCompression = 0; this.reactAcc = 0;
    this.lastAxisX = 0; this.lastAxisY = 1; this.lastAxisZ = 0; this.lastAxisT = -10;
    this.simTime = 0; this.subIdx = 0; this.touchStamp.fill(-1); this.tipStamp.fill(-1000000); this.lastTipSub = -1000000; this.hingeStamp.fill(-1); this.tipNearN = 0; this.hingeCount = 0;
    for (const f of this.fingers) f.clear();
    for (const g of this.grabs) g.clear();
    for (const g of this.locks) g.clear();
    this.lockN = 0;
    this.pinned.fill(0); this.pinCount = 0; this.pinHold = 0; this.tableFoldT = 0; this.gripT = 0; this.gripWake = 0; this.gripCap = 0; this.gripAll = false; this.gripChangeT = -10; this.peelK = 0; this.goalBottom = 0;
    this.events.length = 0;
    this.lastEvent.fill(-10);
    this.pendingLand = -1;
    const m = this.metrics;
    m.compression = 0; m.compressionRate = 0; m.stretch = 0; m.volume = 1; m.kinetic = 0; m.grounded = this.gravityOn; m.fingers = 0; m.grabbed = false;
    m.press = 0; m.reaction = 0; m.strands = 0; m.slosh = 0; m.pull = 0; m.carried = false; m.locked = 0;
    // material and ceremony state back to a fresh body
    this.vt = 1; this.MEM.set(this.Q); this.QG.set(this.Q); this.LQG.set(this.LQ);
    this.EL.set(this.EL0); this.HD.set(this.HD0);
    for (let e = 0; e < this.ne; e++) this.ESOFT[e] = this.EL0[e] * this.p.edgeSoftStrain;
    this.goalOn = false; this.edgesBent = false;
    this.slx = 0; this.sly = 0; this.slz = 0; this.slvx = 0; this.slvy = 0; this.slvz = 0; this.pvcx = 0; this.pvcy = 0; this.pvcz = 0;
    this.strandsT = 0;
    this.fold = 0; this.foldTarget = 0; this.moveOn = false; this.mtx = 0; this.mty = 0; this.mtz = 0; this.moveK = 1;
    this.trembleAmp = 0; this.burstO = 0;
    // CUT / stage B state back to a fresh body (the piece keeps what it was built as: its fraction and its flat face)
    this.fracNow = this.fracBuilt; this.fracFrom = this.fracBuilt; this.fracTo = this.fracBuilt; this.fracT0 = 0; this.fracDur = 0;
    this.flatK = this.chunk ? 1 : 0; this.volScale = 1; this.GB.set(this.Q);
    this.neckOn = false; this.neckT = 0; this.neckTarget = 0; this.volNeck = 0; this.nkLatched = false;
    this.latchOn = false; this.cutJob = null; this.cutOut = null; this.cutState = 0;   // (CUT2: a body put back to rest forgets its plan of a cut)
    this.vnStamp = -1; this.hashStamp = -1; this.contactWith.fill(-1000000);
    this.carried = false; this.liftOk = false; this.twoHanded = false; this.carrier = 0; this.carryOx = 0; this.carryOy = 0; this.carryOz = 0; this.hvx = 0; this.hvy = 0; this.hvz = 0; this.phx = 0; this.phy = 0; this.phz = 0;
    this.strain.fill(1);
    this.asleep = false; this.restT = 0; this.calmT = 0; this.restRefOn = false; this.bRvalid = false; this.restMem = 1;
    // PLAYGROUND: the LIFE drivers released, the prop contact state cleared (the bound world, sleepEnabled and contactSlot are configuration and stay)
    this.scootOn = false; this.stx = 0; this.stz = 0; this.sSpeed = 0; this.sV = 0; this.sGx = 0; this.sGz = 0;
    this.sqTarget = 1; this.sqNow = 1; this.sqTau = 0.12; this.sqAskTau = 0; this.hopLeft = 0; this.hopT = -10; this.glueK = 1; this.heldF = false; this.suppEff = 0; this.subK = 0;
    this.propNear = 0; this.propNearM = 0; this.propMinY = 0; this.supSx = 0; this.supSy = 0; this.supSz = 0; this.tiltOn = false; this.tnx = 0; this.tny = 1; this.tnz = 0;
    this.onMoving = false; this.onPropIdx = -1; this.holdOn = false; this.fdl = 0; this.memDev = 0; this.pminRaw = 0; this.tblNearM = 0; this.propFoldT = 0; this.scootBlock = false; this.peelRef = 0;
    m.asleep = false; m.onProp = -1; m.airborne = false; m.memoryBusy = false; m.contacts = 0;
    this.cyOn = false;
    this.contactsAcc = 0; this.thrownF = false; this.thrownCalm = 0; this.evAuto = false; this.evProp = -1; this.evOther = -1; this.propBumpT.fill(-1000000);
    this.syncOutputs();
  }

  step(dt: number): void {
    // PLAYGROUND (PH-19): the contact slots touched in this frame's collides (the planner runs every pair before the bodies step)
    this.metrics.contacts = this.contactsAcc; this.contactsAcc = 0;
    if (this.asleep) {
      // CUT3 SLEEP: a sleeping piece takes no solver step (it is drawn at its pose, positions / center / frame / metrics stay as they were); a touch or any driver wakes it
      // (PLAYGROUND: a sleeping whole too, and a moving prop that reaches it wakes it: propTouch)
      if (!this.mustWake() && !(this.ps !== null && this.propTouch())) { this.sleepStats.asleepSteps++; return; }
      this.wake();
    }
    let d = Number.isFinite(dt) ? dt : (dt > 0 ? MAX_DT : 0);
    if (d < 0) d = 0;
    if (d > MAX_DT) d = MAX_DT;
    this.acc += d;
    let nsub = Math.floor(this.acc / H + 1e-6);
    if (nsub > MAX_SUBSTEPS) nsub = MAX_SUBSTEPS;
    this.acc -= nsub * H;
    if (this.acc < 0) this.acc = 0;
    if (nsub === 0) return;
    this.keAcc = 0; this.keSubs = 0; this.reactAcc = 0;
    // PLAYGROUND: the touch gate of this frame (the LIFE drivers ease out under it), and the body's bounding sphere for the prop pass
    this.heldF = this.isHeld();
    if (this.heldF && this.sqTarget !== 1) { this.sqTarget = 1; this.sqAskTau = 0; }   // a touch ends the squash pose (the call in force is released; LIFE asks again)
    if (this.ps !== null) this.propBound(nsub);
    // once per frame: memory arm, ceremony easing, goal shape (an int argument: no boxing). Only called when something is active: a body
    // that never needs it (the gel at rest, pressed or pulled) must not run a function the warm-up left without type feedback every frame
    // (it was deoptimised and ran unoptimised: 144 B of boxed doubles per frame)
    if (this.memOn || this.goalOn || this.edgesBent || this.fold !== this.foldTarget || this.burstO > 0 || this.trembleAmp > 0 || this.flatK > 0 || this.neckOn || this.fracDur > 0 || this.fracNow !== this.fracBuilt || this.sqNow !== this.sqTarget || this.sqNow !== 1) this.frameUpdate(nsub);
    for (let s = 0; s < nsub; s++) {
      this.subK = s;
      this.substep();
      this.simTime += H;
      this.postSubstep();
    }
    this.finalize(nsub);   // an integer: a double argument to a function this size is boxed (a HeapNumber per step)
    if (this.canSleep || this.sleepOn) this.restCheck(nsub);   // (a whole squishy without sleepEnabled runs not one instruction more than before CUT3: its calm timer stays 0, so it counts as restless for a sleeper it touches)
    if (this.thrownF) this.thrownSettle(nsub);
  }

  // ---- CUT3 SLEEP / WAKE (acceptance U06). A PIECE that has been at rest for SLEEP.after seconds stops stepping until it is touched, hit, joined or the gravity mode changes; its positions,
  // center, frame and metrics stay as they were, so it is still drawn at its pose, and step() costs a few comparisons. A whole squishy never sleeps (bit-identical solver).

  /** true while the body takes no solver step (a sleeping piece). */
  get sleeping(): boolean { return this.asleep; }
  /** The particles this body costs the solver this frame: 0 asleep, else its vertex count (the budget accountant of CUT3 sums these: broad.ts awakeParticles). */
  get awakeParticles(): number { return this.asleep ? 0 : this.n; }
  /** Harness readout: how often it fell asleep / was woken, and the steps it skipped asleep. */
  get sleepInfo(): { sleeps: number; wakes: number; asleepSteps: number; restT: number } { const s = this.sleepStats; return { sleeps: s.sleeps, wakes: s.wakes, asleepSteps: s.asleepSteps, restT: this.restT }; }
  /** Wake a sleeping piece (any driver call that moves or reshapes the body does): it steps again from the next step() and its rest timer starts over. Harmless on an awake body. */
  wake(): void {
    this.restT = 0; this.calmT = 0;
    if (!this.asleep) return;
    this.asleep = false; this.acc = 0; this.bRvalid = false; this.vnStamp = -1; this.hashStamp = -1; this.sleepStats.wakes++;
    this.metrics.asleep = false;
  }
  /** Something other than a call to wake() asks a sleeping piece to run: a finger or a grab on it, a lock, a carry, a ceremony driver, the neck, a change of size, float mode
   *  (PLAYGROUND: or a LIFE driver: a scoot, a squash pose still easing). */
  private mustWake(): boolean {
    if (this.lockN > 0 || this.carried || this.moveOn || this.neckOn || this.trembleAmp > 0 || this.burstO > 0 || this.fold !== this.foldTarget || this.fracDur > 0 || this.fracNow !== this.fracBuilt || this.flatK > 0 || !this.gravityOn) return true;
    if (this.scootOn || this.cyOn || this.sqNow !== this.sqTarget || this.hopLeft > 0) return true;
    for (let k = 0; k < NSLOT; k++) { const f = this.fingers[k]; if (f.down || f.retracting || this.grabs[k].active) return true; }
    return false;
  }

  // ---- PLAYGROUND (PG_PHYS; contracts.ts PLAYGROUND, PLAYGROUND_BUILD 8.6, 8.7): sleep for wholes, the LIFE drivers and the touch gate

  /** Opt in to sleep (contracts.ts): a WHOLE body may then sleep by the rest test of restCheck plus PLAYGROUND_BUILD 8.6's (kinetic, centre speed, a static support,
   *  no LIFE driver, memory converged). Off (the default) = every existing row unchanged. A piece sleeps either way (CUT3). Turning it off wakes the body. */
  get sleepEnabled(): boolean { return this.sleepOn; }
  set sleepEnabled(v: boolean) {
    const on = !!v;
    if (on === this.sleepOn) return;
    if (on && this.restRef.length !== this.n * 3) this.restRef = new Float64Array(this.n * 3);   // (allocated once, at the opt-in, never per frame)
    this.sleepOn = on;
    if (!on && !this.canSleep) this.wake();
    this.restT = 0; this.calmT = 0; this.restRefOn = false;
  }
  /** HELD (LIFE.md 5.5): a finger down, a grab, a carry or a lock. The touch gate of the LIFE drivers reads it (a lock counts here; it never counts for SoftEvent.auto, D-86). */
  private isHeld(): boolean {
    if (this.lockN > 0 || this.carried) return true;
    for (let k = 0; k < NSLOT; k++) if (this.fingers[k].down || this.grabs[k].active) return true;
    return false;
  }
  /** "The player is touching it" for SoftEvent.auto (LIFE.md 5.5): a finger down, a grab or a carry. A lock alone never counts (D-86). */
  private playerHas(): boolean {
    if (this.carried) return true;
    for (let k = 0; k < NSLOT; k++) if (this.fingers[k].down || this.grabs[k].active) return true;
    return false;
  }
  /** Once per step while the player's last touch still counts (thrownF): it stops counting once the body has rested on a support, untouched and slower than 0.1 m/s,
   *  for 0.3 s (a body set down gently never lands; LIFE's later hops and boops are auto again). */
  private thrownSettle(nsub: number): void {
    if (this.nearCount > 0 && !this.playerHas() && this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz < 0.01) this.thrownCalm += nsub * H; else this.thrownCalm = 0;
    if (this.thrownCalm >= 0.3) { this.thrownF = false; this.thrownCalm = 0; }
  }
  /** PH-19: this body and `o` touched in this frame's collide: each records the other's contact slot (metrics.contacts at their next step). */
  private markContact(o: SoftBody): void {
    const a = this.contactSlot, b = o.contactSlot;
    if (b >= 0 && b < MAX_SLOTS) this.contactsAcc |= 1 << b;
    if (a >= 0 && a < MAX_SLOTS) o.contactsAcc |= 1 << a;
  }
  /** A body-to-body 'bump' about to be emitted: SoftEvent.auto (neither body touched by the player nor thrown since its landing; a lock never counts) and .other. */
  private bumpWith(o: SoftBody): void {
    this.evAuto = !this.playerHas() && !this.thrownF && !o.playerHas() && !o.thrownF;
    this.evOther = o.contactSlot >= 0 && o.contactSlot < MAX_SLOTS ? o.contactSlot : -1;
  }
  /** PLAYGROUND (contracts.ts): move the corral's home spot (where a LIFE body last came to rest), so the home corral never glides it back to its spawn. Ignored for
   *  a non-finite or far-away point. (With place bounds set the bounds corral the body instead; the home is kept for reset() and for shape -1.) */
  setHome(x: number, z: number): void {
    if (x !== +x || z !== +z || !inWorld(x, 0, z)) return;   // (a number, finite and in the world)
    this.homeX = x; this.homeZ = z;
  }
  /** PLAYGROUND (contracts.ts): place bounds that replace the home corral: shape 0 a disc about (cx, cz) of radius a, 1 a rectangle of half sizes a, b with corners
   *  rounded by `round` (at most min(a, b)); -1 back to the home corral. The same brake, glide back and rim bounce as the mat's corral, about the area's EDGE: a centre
   *  inside the area is never touched (the dead zone is the whole area); outside it the outward speed is braked (ramping in over matRamp) and the body glides back to
   *  the edge at up to matGlide m/s; PG.boundsRim m past the edge the outward speed is reflected. Off, as the home corral is, while a grab, a lock, the pinned feet,
   *  moveTo, scootTo, carryTo or a moving prop (a rider, D-91) holds the body. Bad numbers are ignored (nothing changes). Not per frame: on travel, spawn and when
   *  Home's frame or party changes. */
  setBounds(shape: number, cx: number, cz: number, a: number, b: number, round: number): void {
    const sh = Math.floor(shape);
    if (sh < 0) { this.bndShape = -1; this.wake(); return; }
    const bb = sh === 1 ? b : a;
    if (sh > 1 || cx !== +cx || cz !== +cz || !inWorld(cx, a, cz) || !inWorld(0, bb, 0) || !(a > 0) || !(bb > 0)) return;
    this.bndShape = sh; this.bndCx = cx; this.bndCz = cz; this.bndA = a; this.bndB = bb;
    this.bndR = sh === 1 && round > 0 ? Math.min(round, a, bb) : 0;
    this.wake();   // (the corral acts on a body outside the new area; one at rest inside it falls asleep again within SLEEP.after)
  }
  /** PLAYGROUND (contracts.ts; keyboard parity, "Go play with..."): a scripted lift of the whole body along a smooth arc so that it stands at (x, z) on a support
   *  whose top is at height y (its lowest point goes to y: the centre to y + its rest centre height; y 0 = the table), over `seconds` (PG.carryMin..carryMax), set
   *  down with no velocity. A rigid kinematic translation like the carry (the body keeps its shape; its weight is held), the arc rising PG.carryArc + carryArcK x
   *  the distance (at most carryArcMax) over the higher end. Emits no poke, press, release, grab or snap (it can never pay); its landing and the bumps of its next
   *  0.3 s at rest are NOT auto (the player asked). A touch (a finger, a grab, a carry or a lock) ends it where the body is. Returns false (nothing changes) when
   *  HELD, carried, a ceremony driver (moveTo, a fold, a tremble, the cut) owns the body, or the point is not finite; a scoot is released by it. Wakes the body. */
  carryTo(x: number, y: number, z: number, seconds: number): boolean {
    if (x !== +x || y !== +y || z !== +z || !inWorld(x, y, z) || !(seconds > 0) || this.isHeld() || this.ceremonyOn()) return false;
    const T = seconds < PG.carryMin ? PG.carryMin : seconds > PG.carryMax ? PG.carryMax : seconds;
    this.wake();
    if (this.scootOn) { this.scootOn = false; this.sV = 0; this.sGx = 0; this.sGz = 0; }
    this.cySx = this.cx; this.cySy = this.cy; this.cySz = this.cz;
    this.cyEx = x; this.cyEy = Math.max(0, y) + this.restCenterY; this.cyEz = z;
    const dh = Math.sqrt((x - this.cx) * (x - this.cx) + (z - this.cz) * (z - this.cz));
    this.cyArc = Math.min(PG.carryArcMax, PG.carryArc + PG.carryArcK * dh);
    this.cyT0 = this.simTime; this.cyDur = T; this.cyOn = true;
    this.thrownF = true; this.thrownCalm = 0;
    return true;
  }
  /** carryTo is moving the body (harness readout). */
  get carryingTo(): boolean { return this.cyOn; }
  /** carryTo's translation, once per substep while it acts (like the carry: X moved rigidly before the prediction; gravity and the hover are held off). */
  private carryToStep(): void {
    if (this.heldF) { this.endCarryTo(false); return; }   // a touch takes it over where it is
    // the path: a quadratic Bezier from the start to the end centre through a control point 2 x arc over the higher end (its apex clears that end by about the arc),
    // timed by a smoothstep (at rest at both ends)
    const u0 = (this.simTime + H - this.cyT0) / this.cyDur, u = u0 >= 1 ? 1 : u0, sm = u * u * (3 - 2 * u), a0 = (1 - sm) * (1 - sm), a1 = 2 * sm * (1 - sm), a2 = sm * sm;
    const hi = this.cySy > this.cyEy ? this.cySy : this.cyEy;
    const tx = this.cySx + (this.cyEx - this.cySx) * sm, ty = a0 * this.cySy + a1 * (hi + 2 * this.cyArc) + a2 * this.cyEy, tz = this.cySz + (this.cyEz - this.cySz) * sm;
    const mx = tx - this.cx, my = ty - this.cy, mz = tz - this.cz, X = this.X;
    for (let i = 0; i < this.n * 3; i += 3) { X[i] += mx; X[i + 1] += my; X[i + 2] += mz; }
    this.cx += mx; this.cy += my; this.cz += mz;
    if (u >= 1) this.endCarryTo(true);
  }
  /** The end of carryTo: at rest (no velocity); arrived, the home corral's spot moves there (the player put it there: the corral never glides it back). */
  private endCarryTo(arrived: boolean): void {
    this.cyOn = false;
    if (arrived) { this.homeX = this.cyEx; this.homeZ = this.cyEz; }
    this.V.fill(0); this.vcx = 0; this.vcy = 0; this.vcz = 0; this.pvcx = 0; this.pvcy = 0; this.pvcz = 0;
    this.thrownF = true; this.thrownCalm = 0;
  }
  /** A ceremony or cut driver owns the body (moveTo, fold, tremble, burst, the neck, a size change): the LIFE drivers stand aside. */
  private ceremonyOn(): boolean {
    return this.cyOn || this.moveOn || this.fold !== 0 || this.foldTarget !== 0 || this.trembleAmp > 0 || this.burstO > 0 || this.neckOn || this.fracDur > 0;
  }
  /** The goal differs from the rest shape ONLY by a converged squash pose (a fixed goal: a posed body may sleep, PLAYGROUND_BUILD 8.6; LIFE 5.1 "Pose"). */
  private poseOnly(): boolean {
    return this.sqNow !== 1 && this.sqNow === this.sqTarget && this.fold === 0 && this.foldTarget === 0 && this.burstO === 0 && this.fracNow === this.fracBuilt && this.fracDur === 0 && this.flatK === 0 && !this.neckOn && this.trembleAmp === 0;
  }
  /** max |MEM - Q| over PG.memBusy x restRadius on putty, mochi dough or bead squeeze (LIFE.md 5.4; SoftMetrics.memoryBusy). */
  private memBusy(): boolean { return this.memBusyFam && this.memDev > PG.memBusy; }
  /** PLAYGROUND (contracts.ts): sleep now if the body passes the rest test's bounds this instant (sleepEnabled or a piece; gravity on; not held; no driver, timer or easing;
   *  metrics.kinetic < PG.restKin and the centre slower than PG.restSpeed; on the table or a STATIC prop face, never a moving one; memory converged). False and nothing
   *  changes otherwise. Zero position change. */
  sleep(): boolean {
    if (this.asleep) return true;
    if (!(this.sleepOn || this.canSleep) || !this.restBounds()) return false;
    this.fallAsleep();
    return true;
  }
  /** The instant part of the rest test (sleep() and restCheck share it). */
  private restBounds(): boolean {
    if (this.mustWake() || this.pinCount !== 0 || this.pinHold > 0 || this.tableFoldT > 0 || this.gripT > 0 || this.gripAll || this.strandsT !== 0 || this.pendingLand >= 0) return false;
    if (this.edgesBent && !this.memOn && !this.poseOnly()) return false;
    if (this.onMoving || this.memBusy() || this.metrics.kinetic >= PG.restKin) return false;
    if (this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz >= PG.restSpeed * PG.restSpeed) return false;
    if (this.memOn && this.restMem >= SLEEP.mem) return false;
    if (this.sloshOn && !(this.slx * this.slx + this.sly * this.sly + this.slz * this.slz < 4e-4 * this.restRadius * this.restRadius && this.slvx * this.slvx + this.slvy * this.slvy + this.slvz * this.slvz < SLEEP.speed * SLEEP.speed)) return false;
    return this.nearCount > 0 || this.cpContacts > 0;   // on the table or a static prop face (propNear counts in nearCount), or leaning on other bodies
  }
  private fallAsleep(): void {
    this.asleep = true; this.restRefOn = false; this.sleepStats.sleeps++;
    this.V.fill(0); this.vcx = 0; this.vcy = 0; this.vcz = 0; this.pvcx = 0; this.pvcy = 0; this.pvcz = 0; this.acc = 0;
    this.metrics.kinetic = 0; this.metrics.compressionRate = 0; this.metrics.asleep = true;
    this.bRvalid = false;   // (the bound radius is measured once more for the sleeper)
  }

  /** PLAYGROUND LIFE driver (contracts.ts): a volume-preserving goal squash, y x s and x, z x 1 / sqrt(s) in the body's rest frame, eased with time constant tauS (>= 0.08 s);
   *  s 0.75..1.12, 1 releases it. Under the touch gate it eases out within PG.gateS. Refused while HELD, while a ceremony driver owns the body and, for putty, mochi dough and
   *  bead squeeze, while their memory has not converged. A call identical to the one in force is a no-op and never wakes a sleeper. */
  setSquash(s: number, tauS: number): void {
    if (typeof s !== 'number' || !Number.isFinite(s) || typeof tauS !== 'number' || !Number.isFinite(tauS)) return;
    const sv = s < PG.squashMin ? PG.squashMin : s > PG.squashMax ? PG.squashMax : s;
    const tv = tauS < PG.squashTauMin ? PG.squashTauMin : tauS > 10 ? 10 : tauS;
    if (sv === this.sqTarget && (sv === 1 || tv === this.sqAskTau)) return;   // the call in force: nothing (a converged pose sent again at 10 Hz lets the body sleep)
    if (sv !== 1 && (this.isHeld() || this.ceremonyOn() || this.memBusy())) return;
    this.sqTarget = sv; this.sqTau = tv; this.sqAskTau = tv;
    this.wake();
  }
  /** PLAYGROUND LIFE driver (contracts.ts), LIFE's only travel: a horizontal rigid glide of the centre toward (x, z) at `speed` (PG.scootMin..scootMax m/s), eased in and out
   *  over PG.scootEase s; the corral is off while it acts; it yields to moveTo; NaN x releases it. False (nothing changes) while HELD or a ceremony driver is on. */
  scootTo(x: number, z: number, speed: number): boolean {
    if (typeof x !== 'number' || Number.isNaN(x)) { this.scootOn = false; this.sV = 0; this.sGx = 0; this.sGz = 0; return true; }
    if (!Number.isFinite(x) || typeof z !== 'number' || !Number.isFinite(z) || !inWorld(x, 0, z) || typeof speed !== 'number' || !Number.isFinite(speed)) return false;
    if (this.isHeld() || this.ceremonyOn()) return false;
    this.stx = x; this.stz = z;
    this.sSpeed = speed < PG.scootMin ? PG.scootMin : speed > PG.scootMax ? PG.scootMax : speed;
    if (!this.scootOn) { this.scootOn = true; this.sV = 0; }
    this.wake();
    return true;
  }
  /** PLAYGROUND LIFE driver (contracts.ts): a hop: (vx, vy, vz) added to every particle with the glue and the peel damping suspended (and the support's fade of gravity off)
   *  for PG.hopSubs substeps, so the same impulse leaves the ground at the same height in every family. vy is clamped to 0..PG.hopVyCap, the horizontal speed to
   *  PG.hopHMax (on a moving prop it adds to the prop's surface velocity the body already has). False when HELD, airborne, inside PG.hopGap s of its last hop, a ceremony
   *  driver is on, or its memory is busy. */
  hop(vx: number, vy: number, vz: number): boolean {
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return false;
    if (this.isHeld() || this.ceremonyOn() || this.memBusy() || !this.gravityOn || this.nearCount === 0 || this.simTime - this.hopT < PG.hopGap) return false;
    const y = vy < 0 ? 0 : vy > PG.hopVyCap ? PG.hopVyCap : vy;
    let x = vx, z = vz;
    const hl = Math.sqrt(x * x + z * z);
    if (hl > PG.hopHMax) { x *= PG.hopHMax / hl; z *= PG.hopHMax / hl; }
    this.wake();
    const V = this.V;
    for (let i = 0; i < this.n * 3; i += 3) { V[i] += x; V[i + 1] += y; V[i + 2] += z; }
    this.vcx += x; this.vcy += y; this.vcz += z;
    this.hopLeft = PG.hopSubs; this.hopT = this.simTime; this.glueK = 0;
    this.thrownF = false; this.thrownCalm = 0;   // (LIFE's hop from the ground: its landing is auto)
    return true;
  }

  /** PLAYGROUND (contracts.ts): bind a place's props (null = none: today's table only). A world that is not a props.ts world (no packed `solve`) is ignored. */
  setPropWorld(w: PropWorldLike | null): void {
    // (the world keeps a list of its bodies for its zones and pads, S2: props.ts trk; a world that has no zone physics ignores it)
    const o = this.pw as unknown as PropTrack | null;
    if (o && o !== w) o.trk?.(this, false);
    const s = w ? (w as unknown as { solve?: PropSolve }).solve : undefined;
    if (!w || !s || !(s.S instanceof Float64Array) || !(s.A instanceof Float64Array)) {
      this.pw = null; this.ps = null; this.propNear = 0; this.propNearM = 0; this.onMoving = false; this.onPropIdx = -1; this.tiltOn = false; this.metrics.onProp = -1; this.holdOn = false;
      return;
    }
    this.pw = w; this.ps = s; (w as unknown as PropTrack).trk?.(this, true);
    if (this.propNM.length < s.count * 4) this.propNM = new Float64Array(s.count * 4);   // (once per binding)
    if (this.propBumpT.length < s.count) this.propBumpT = new Int32Array(s.count);
    this.propBumpT.fill(-1000000);
    this.wake();
  }
  /** Once per frame with a world bound: the body's bounding sphere (its largest particle distance from the centre, plus the frame's travel and a margin). */
  private propBound(nsub: number): void {
    const X = this.X, n = this.n, cx = this.center.x, cy = this.center.y, cz = this.center.z;
    let r2 = 0;
    for (let i = 0; i < n * 3; i += 3) { const dx = X[i] - cx, dy = X[i + 1] - cy, dz = X[i + 2] - cz, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) r2 = d2; }
    const v = Math.sqrt(this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz) + this.sSpeed;
    this.pbcx = cx; this.pbcy = cy; this.pbcz = cz; this.pbR = Math.sqrt(r2) + v * nsub * H + NEAR + 0.02;
  }
  /** A sleeping body with a world bound: does a MOVING prop's bounding sphere reach it? (a ball rolled into it, a swing coming back): then it wakes. */
  private propTouch(): boolean {
    const P = this.ps;
    if (P === null) return false;
    const S = P.S, cx = this.center.x, cy = this.center.y, cz = this.center.z;
    if (!this.bRvalid) { this.boundRadius(); this.bRvalid = true; }
    for (let p = 0; p < P.count; p++) {
      const o = p * PS;
      if (S[o] === 0 || S[o + 29] === 0) continue;
      const dx = S[o + 4] - cx, dy = S[o + 5] - cy, dz = S[o + 6] - cz, rr = S[o + 28] + this.bR + NEAR;
      if (dx * dx + dy * dy + dz * dz < rr * rr) return true;
    }
    return false;
  }
  /** scootTo's glide, once per substep while it acts: a rigid horizontal translation of X (like moveTo: no momentum, the table carries the height, friction never
   *  sees it), at a speed that ramps up and down at sSpeed / PG.scootEase (full speed in PG.scootEase s, and to rest within it under the touch gate) and slows to a stop
   *  at the target. Under the touch gate or a ceremony driver it eases out and lets go (LIFE asks again after its grace). */
  private scootStep(): void {
    const dx = this.stx - this.cx, dz = this.stz - this.cz, d = Math.sqrt(dx * dx + dz * dz);
    const acc = this.sSpeed / PG.scootEase, dv = acc * H, gate = this.heldF || this.moveOn || this.scootBlock;
    const want = Math.min(this.sSpeed, Math.sqrt(2 * acc * d)) * (gate ? 0 : 1);
    const v0 = this.sV, v = v0 < want ? Math.min(want, v0 + dv) : Math.max(want, v0 - (gate ? dv / 0.9 : dv));   // (under the gate: at rest inside 0.9 x PG.scootEase, so within it at frame granularity)
    this.sV = v;
    if (gate && v <= 0) { this.scootOn = false; this.sGx = 0; this.sGz = 0; return; }
    if (d < 1e-4) { if (v <= dv) { this.scootOn = false; this.sV = 0; } this.sGx = 0; this.sGz = 0; return; }
    const s = Math.min(v * H, d), ux = dx / d, uz = dz / d, mx = ux * s, mz = uz * s, X = this.X;
    this.sGx = ux * v; this.sGz = uz * v;
    for (let i = 0; i < this.n * 3; i += 3) { X[i] += mx; X[i + 2] += mz; }
    this.cx += mx; this.cz += mz;
  }
  /**
   * THE PROP PASS (PLAYGROUND_BUILD 8.3, E4), once per substep with a world bound, between the fingertips and the table. Each prop's pose for this substep is its pose at
   * the frame start advanced by its velocity (a ball) or its angular velocity about the pivot (a hinge) over (k + 1) H, as the fingertips advance; a prop whose bounding
   * sphere misses the body's costs one sphere test. A particle inside a shape is projected to its surface (the shape's outward normal); a particle within NEAR of an
   * UP-FACING face (normal within 35 degrees of world up) is SUPPORTED: it counts for the supported gravity, the friction load, grounded and the land event (D-11).
   * Coulomb friction against the surface's own velocity (prop mu; its load is the penetration, plus the supported weight and a fingertip's push on an up-facing face).
   * The correction a particle gets goes to the prop as the opposite impulse, scaled to body-mass units (x bodyMass / Mtot, F#3), about the hinge's pivot. Contacts
   * join the contact fold limit only while worked (a moving prop, a fast body, or a penetration over PG.workPen mean edges: F#4). No tack and no strands on props.
   */
  private propPass(): void {
    const P = this.ps!, S = P.S, A = P.A, np = P.count, X = this.X, XP = this.XP, M = this.M, n = this.n, pk = this.pk, pq = this.pq, NM = this.propNM;
    const t1 = (this.subK + 1) * H, me = this.meanEdge;
    const load = this.supp * GRAVITY * H * H * Math.min(LOAD_CONC, this.Mtot / Math.max(1, this.nearMass));
    const fload = this.fdl / Math.max(1, this.nearMass);
    const imp = this.bodyMass / (this.Mtot * H);
    const stamp = this.touchStamp, now = this.subIdx, near = this.nearList;
    const ws2 = PG.workSpeed * PG.workSpeed * H * H, hold = this.propFoldT > 0;   // a contact is worked when its particle moves faster than PG.workSpeed relative to the surface
    let worked = false, gb = 0, gbM = 0, svs = 0;
    const gl = Math.sqrt(this.sGx * this.sGx + this.sGz * this.sGz), gx = gl > 1e-9 ? this.sGx / gl : 0, gz = gl > 1e-9 ? this.sGz / gl : 0;   // the scoot's direction (blocked by static props)
    let pnear = 0, pnearM = 0, minY = 1e9, ssx = 0, ssy = 0, ssz = 0, best = -1, bestM = 0, moving = false;
    for (let p = 0; p < np; p++) {
      const o = p * PS, kind = S[o];
      NM[p * 4] = 0;
      if (kind === 0) continue;
      const joint = S[o + 1], mv = S[o + 29] !== 0;
      // ---- the pose this substep (pk: centre 0..2, rotation 3..11 row-major)
      if (mv && joint === 1) {
        // a hinge: rotate the frame-start pose about the pivot by |w| t1 (Rodrigues)
        const wx = S[o + 22], wy = S[o + 23], wz = S[o + 24], wl = Math.sqrt(wx * wx + wy * wy + wz * wz), ang = wl * t1;
        const iw = 1 / Math.max(wl, 1e-12), ax = wx * iw, ay = wy * iw, az = wz * iw;   // (mv: w is not zero) (no integer / double ternaries in this function: V8 boxes them)
        const cs = Math.cos(ang), sn = Math.sin(ang), oc = 1 - cs;
        const m00 = cs + ax * ax * oc, m01 = ax * ay * oc - az * sn, m02 = ax * az * oc + ay * sn;
        const m10 = ay * ax * oc + az * sn, m11 = cs + ay * ay * oc, m12 = ay * az * oc - ax * sn;
        const m20 = az * ax * oc - ay * sn, m21 = az * ay * oc + ax * sn, m22 = cs + az * az * oc;
        const qx = S[o + 25], qy = S[o + 26], qz = S[o + 27], rx = S[o + 4] - qx, ry = S[o + 5] - qy, rz = S[o + 6] - qz;
        pk[0] = qx + m00 * rx + m01 * ry + m02 * rz; pk[1] = qy + m10 * rx + m11 * ry + m12 * rz; pk[2] = qz + m20 * rx + m21 * ry + m22 * rz;
        for (let c = 0; c < 3; c++) {
          const r0 = S[o + 7 + c], r1 = S[o + 10 + c], r2 = S[o + 13 + c];
          pk[3 + c] = m00 * r0 + m01 * r1 + m02 * r2; pk[6 + c] = m10 * r0 + m11 * r1 + m12 * r2; pk[9 + c] = m20 * r0 + m21 * r1 + m22 * r2;
        }
      } else {
        const tb = t1 * (mv ? 1 : 0);
        pk[0] = S[o + 4] + S[o + 19] * tb; pk[1] = S[o + 5] + S[o + 20] * tb; pk[2] = S[o + 6] + S[o + 21] * tb;
        for (let c = 0; c < 9; c++) pk[3 + c] = S[o + 7 + c];
      }
      // ---- broad phase: the prop's bounding sphere against the body's
      {
        const bx = pk[0] - this.pbcx, by = pk[1] - this.pbcy, bz = pk[2] - this.pbcz, rr = S[o + 28] + this.pbR;
        if (bx * bx + by * by + bz * bz > rr * rr) continue;
      }
      const mu = S[o + 2], hinge = joint === 1, dyn = joint !== 0, statSup = S[o + 30] !== 0;
      // (the world writes a zero angular velocity for every prop but a hinge, a zero velocity for every prop but a ball, and the pivot (a hinge) or the frame-start
      // centre (a ball) at 25..27: torques about the pivot; a ball's and a static prop's are never used)
      const wx = S[o + 22], wy = S[o + 23], wz = S[o + 24], vbx = S[o + 19], vby = S[o + 20], vbz = S[o + 21], qx = S[o + 25], qy = S[o + 26], qz = S[o + 27];
      const h0 = S[o + 16], h1 = S[o + 17], h2 = S[o + 18], cax = S[o + 3] | 0;
      const ux = pk[3 + cax], uy = pk[6 + cax], uz = pk[9 + cax];   // a capsule's segment axis (a column of the rotation)
      let jx = 0, jy = 0, jz = 0, lx = 0, ly = 0, lz = 0, nm = 0, ncx = 0, ncy = 0, ncz = 0, cnt = 0;
      let bAp = 0, bx = 0, by = 0, bz = 0, bnx = 0, bny = 0, bnz = 0;   // the fastest approach against a face that does not support (a prop 'bump', 8.8)
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, x = XP[i3], y = XP[i3 + 1], z = XP[i3 + 2];
        const dx = x - pk[0], dy = y - pk[1], dz = z - pk[2];
        // ---- signed distance to the surface and its outward normal there (into pq)
        if (kind === 1) {
          const d2 = dx * dx + dy * dy + dz * dz, rn = h0 + NEAR;
          if (d2 >= rn * rn) continue;
          const d = Math.sqrt(d2);
          if (d > 1e-9) { pq[0] = d - h0; pq[1] = dx / d; pq[2] = dy / d; pq[3] = dz / d; } else { pq[0] = -h0; pq[1] = 0; pq[2] = 1; pq[3] = 0; }
        } else if (kind === 2) {
          const t0 = dx * ux + dy * uy + dz * uz, tc = t0 < -h1 ? -h1 : t0 > h1 ? h1 : t0;
          const ex = dx - ux * tc, ey = dy - uy * tc, ez = dz - uz * tc, d2 = ex * ex + ey * ey + ez * ez, rn = h0 + NEAR;
          if (d2 >= rn * rn) continue;
          const d = Math.sqrt(d2);
          if (d > 1e-9) { pq[0] = d - h0; pq[1] = ex / d; pq[2] = ey / d; pq[3] = ez / d; } else { pq[0] = -h0; pq[1] = 0; pq[2] = 1; pq[3] = 0; }
        } else {
          const lxp = dx * pk[3] + dy * pk[6] + dz * pk[9], lyp = dx * pk[4] + dy * pk[7] + dz * pk[10], lzp = dx * pk[5] + dy * pk[8] + dz * pk[11];
          const ex = Math.abs(lxp) - h0, ey = Math.abs(lyp) - h1, ez = Math.abs(lzp) - h2;
          if (ex >= NEAR || ey >= NEAR || ez >= NEAR) continue;
          if ((ex > 0 ? 1 : 0) + (ey > 0 ? 1 : 0) + (ez > 0 ? 1 : 0) > 1) continue;   // an edge or corner zone: no face contact
          // the face: the axis of the largest excess (inside: the shallowest face)
          const ax = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
          const e = ax === 0 ? ex : ax === 1 ? ey : ez, sg = (ax === 0 ? lxp : ax === 1 ? lyp : lzp) < 0 ? -1 : 1;
          pq[0] = e; pq[1] = sg * pk[3 + ax]; pq[2] = sg * pk[6 + ax]; pq[3] = sg * pk[9 + ax];
        }
        const sd = pq[0], nx = pq[1], ny = pq[2], nz = pq[3], up = ny >= PG.supportCos;
        if (!up) {   // (the particle's predicted velocity against the surface's, along the normal: an impact on a side or underside; a landing on a top is the 'land')
          const ap = ((X[i3] - x) / H + vbx + wy * (z - qz) - wz * (y - qy)) * nx + ((X[i3 + 1] - y) / H + vby + wz * (x - qx) - wx * (z - qz)) * ny + ((X[i3 + 2] - z) / H + vbz + wx * (y - qy) - wy * (x - qx)) * nz;
          if (ap > bAp) { bAp = ap; bx = x; by = y; bz = z; bnx = nx; bny = ny; bnz = nz; }
        }
        if (sd < 0) { XP[i3] = x - nx * sd; XP[i3 + 1] = y - ny * sd; XP[i3 + 2] = z - nz * sd; }
        const pen = Math.max(0, -sd);
        // ---- Coulomb friction against the surface's velocity at the particle (a hinge: w x r; a ball: its velocity)
        const rx = XP[i3] - qx, ry = XP[i3 + 1] - qy, rz = XP[i3 + 2] - qz;
        const svx = vbx + wy * rz - wz * ry, svy = vby + wz * rx - wx * rz, svz = vbz + wx * ry - wy * rx;
        const fp = up ? pen + load + fload : pen;
        if (fp > 0) {
          const tux = XP[i3] - X[i3] - svx * H, tuy = XP[i3 + 1] - X[i3 + 1] - svy * H, tuz = XP[i3 + 2] - X[i3 + 2] - svz * H;
          const un = tux * nx + tuy * ny + tuz * nz, tx = tux - un * nx, ty = tuy - un * ny, tz = tuz - un * nz, tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
          if (tl > 1e-12) { const k2 = Math.min(1, (mu * fp) / tl); XP[i3] -= tx * k2; XP[i3 + 1] -= ty * k2; XP[i3 + 2] -= tz * k2; }
        }
        cnt++;
        if (dyn) {
          // the correction this particle got: the prop takes the opposite impulse (and its moment about the pivot)
          const m = M[i], cx = (XP[i3] - x) * m, cy = (XP[i3 + 1] - y) * m, cz = (XP[i3 + 2] - z) * m;
          jx -= cx; jy -= cy; jz -= cz;
          lx -= ry * cz - rz * cy; ly -= rz * cx - rx * cz; lz -= rx * cy - ry * cx;
        }
        if (up) {
          const m = M[i];
          nm += m; ncx += m * XP[i3]; ncy += m * XP[i3 + 1]; ncz += m * XP[i3 + 2];
          ssx += m * nx; ssy += m * ny; ssz += m * nz; svs += m * svy;
          if (XP[i3 + 1] < minY) minY = XP[i3 + 1];
          pnear++;
        }
        const wx2 = x - X[i3] - svx * H, wy2 = y - X[i3 + 1] - svy * H, wz2 = z - X[i3 + 2] - svz * H;
        const wk = mv || pen > PG.workPen * me || wx2 * wx2 + wy2 * wy2 + wz2 * wz2 > ws2;
        if (wk) worked = true;
        if ((wk || hold) && stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; }
        if (statSup) { const bk = (XP[i3] - x) * gx + (XP[i3 + 2] - z) * gz; if (bk < 0) { gb += M[i] * bk; gbM += M[i]; } }   // a static prop pushing the body back against its glide
      }
      if (cnt === 0) continue;
      // a prop 'bump': the START of a contact with this prop (none in the last BUMP_GAP substeps) closing faster than BUMP_MIN against a face that does not support
      if (now - this.propBumpT[p] > BUMP_GAP && bAp > BUMP_MIN) { this.evAuto = !this.playerHas() && !this.thrownF; this.evProp = p; this.emit('bump', bx, by, bz, bnx, bny, bnz, bAp / BUMP_NORM, 0, -1); }
      this.propBumpT[p] = now;
      const a = p * PA;
      A[a + 9] += cnt;
      if (this.heldF) A[a + 10] += 1;   // D-95: a HELD body touches it (the player has the rider: AUTO yields)
      if (dyn) {
        A[a] += jx * imp; A[a + 1] += jy * imp; A[a + 2] += jz * imp; A[a + 3] += lx * imp; A[a + 4] += ly * imp; A[a + 5] += lz * imp;
        const jm = Math.sqrt(jx * jx + jy * jy + jz * jz) * imp;
        if (jm > A[a + 7]) { A[a + 7] = jm; A[a + 8] = this.contactSlot; }
      }
      if (nm > 0) {
        NM[p * 4] = nm; NM[p * 4 + 1] = ncx; NM[p * 4 + 2] = ncy; NM[p * 4 + 3] = ncz;
        pnearM += nm;
        if (!statSup) moving = true;
        if (nm > bestM) { bestM = nm; best = p; }
      }
    }
    this.propNear = pnear; this.propNearM = pnearM; this.pminRaw = minY; this.supSx = ssx; this.supSy = ssy; this.supSz = ssz;
    this.onMoving = moving; this.onPropIdx = best;
    this.peelRef = 0; if (pnearM > 0) this.peelRef = svs / pnearM;   // the supporting surface's mean vertical speed (the peel damping's reference)
    // D-95: a rider HOLDS ON while AUTO or a hand drives its swing (S[34] = AUTO's share on a pendulum seat, 1 under a hand; 0 otherwise): its centre is sprung and damped
    // toward the seat's centre line along the travel, relative to the seat's own motion there (applied in the next substep's prediction). Without it a body balanced on
    // the round seat rolled off it within a few half swings at any arc, and off a seat a hand yanked 20 degrees (it rides on, 60/60, when nothing drives the seat: the
    // default dies down before it can roll off)
    this.holdOn = false;
    if (best >= 0 && S[best * PS + 34] > 0) {
      const o = best * PS, u = S[o + 34], kx = S[o + 31], ky = S[o + 32], kz = S[o + 33];
      const rx = S[o + 25] - S[o + 4], ry = S[o + 26] - S[o + 5], rz = S[o + 27] - S[o + 6], rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (rl > 1e-6) {
        const tx = (ky * rz - kz * ry) / rl, ty = (kz * rx - kx * rz) / rl, tz = (kx * ry - ky * rx) / rl;   // the travel: axis x rope
        const d = (this.cx - S[o + 4]) * tx + (this.cy - S[o + 5]) * ty + (this.cz - S[o + 6]) * tz;
        const wx = S[o + 22], wy = S[o + 23], wz = S[o + 24], px = this.cx - S[o + 25], py = this.cy - S[o + 26], pz = this.cz - S[o + 27];
        const v = (this.vcx - (wy * pz - wz * py)) * tx + (this.vcy - (wz * px - wx * pz)) * ty + (this.vcz - (wx * py - wy * px)) * tz;
        const ah = -(PG.holdK * d + PG.holdC * v) * u;
        this.holdOn = true; this.holdAx = ah * tx; this.holdAy = ah * ty; this.holdAz = ah * tz;
      }
    }
    // the contact fold limit keeps a prop contact for TABLE_FOLD_AFTER after it was last worked (the mirror of the table's tableFoldT: a slime draped on a bar after the
    // impact creased 145 degrees once the impact's speed was gone); and a scoot that a static prop holds back (more than a third of its glide step) is blocked
    this.propFoldT = worked ? TABLE_FOLD_AFTER : Math.max(0, this.propFoldT - H);
    this.scootBlock = this.scootOn && gbM >= 3 && gb < -0.33 * this.sV * H * gbM;   // (the particles a static prop touches are pushed back by a third of the glide step or more: head-on)
  }
  /** After the table pass's own count (tblNearM): the lowest support (the table at 0 when anything rests on it, else the lowest prop face) and the support's tilt. */
  private propSupport(): void {
    const tm = this.tblNearM;
    this.propMinY = 0;
    if (tm <= 0 && this.propNear > 0) this.propMinY = this.pminRaw;
    this.tiltOn = false;
    if (this.propNearM > 0) {
      const sx = this.supSx, sy = this.supSy + tm, sz = this.supSz, l = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (l > 1e-12 && sy / l < PG.tiltCos) { this.tiltOn = true; this.tnx = sx / l; this.tny = sy / l; this.tnz = sz / l; }
    }
  }
  /** WEIGHT TRANSFER (D-12): supported gravity fades a resting body's weight to zero, so a body resting on a MOVING prop adds bodyMass x g x its supported share to that
   *  prop at its contact centroid every substep (and its inertia about the hinge, so a seesaw or a swing carrying a rider swings at the rider's pace, not faster). */
  private propWeight(): void {
    const P = this.ps!, S = P.S, A = P.A, NM = this.propNM, np = P.count, nmT = Math.max(1e-9, this.nearMass);
    const w = this.bodyMass * GRAVITY * this.suppEff * H / nmT, mb = this.bodyMass / nmT;
    for (let p = 0; p < np; p++) {
      const nm = NM[p * 4];
      if (nm <= 0) continue;
      const o = p * PS;
      if (S[o + 1] !== 1) continue;   // only a hinge takes the weight (a static prop carries it; a free ball under a body is the floor's)
      const a = p * PA, inv = 1 / nm, rx = NM[p * 4 + 1] * inv - S[o + 25], ry = NM[p * 4 + 2] * inv - S[o + 26], rz = NM[p * 4 + 3] * inv - S[o + 27];
      const jy = -w * nm;
      A[a + 1] += jy; A[a + 3] += -rz * jy; A[a + 5] += rx * jy;
      const kx = S[o + 31], ky = S[o + 32], kz = S[o + 33], ra = rx * kx + ry * ky + rz * kz;
      A[a + 6] += mb * nm * (rx * rx + ry * ry + rz * rz - ra * ra) * H;
      // D-95 AUTO: the riders' own pendulum (the body's CENTRE about the axis: sum m d and sum m d^2), so the arc swings at the rider's pace and the seat never pulls it off
      const cx = this.cx - S[o + 25], cy = this.cy - S[o + 26], cz = this.cz - S[o + 27], ca = cx * kx + cy * ky + cz * kz, d2 = Math.max(0, cx * cx + cy * cy + cz * cz - ca * ca);
      A[a + 11] += mb * nm * Math.sqrt(d2) * H; A[a + 12] += mb * nm * d2 * H;
      // D-95: a HELD rider (the player has it by a finger, a grab, a carry or a lock): its centre's angular velocity about the axis, so the seat or board goes where the
      // hand takes the rider (a pull or a push of the rider swings it)
      if (this.heldF && d2 > 1e-4) {
        const lw = (cy * this.vcz - cz * this.vcy) * kx + (cz * this.vcx - cx * this.vcz) * ky + (cx * this.vcy - cy * this.vcx) * kz;
        A[a + 13] += mb * nm * (lw / d2) * H; A[a + 14] += mb * nm * H;
      }
    }
  }
  /** Once per step (after finalize): is the body at rest? It is when nothing drives it, it stands on the table, no particle moves faster than SLEEP.speed and none is farther than SLEEP.err rest radii from
   *  its goal; a body with a memory arm also needs the memory shape to have stopped flowing. restT counts the seconds this has held on every step; a piece asleep after SLEEP.after. */
  private restCheck(nsub: number): void {
    // PLAYGROUND: a body a MOVING prop carries never rests (8.6) and is never calm: out before any double is read (this once-a-frame function may run unoptimised,
    // where every double field read is a new HeapNumber: 350 B a frame for a rider on the rocker)
    if (this.onMoving) { this.calmT = 0; this.restT = 0; this.restRefOn = false; return; }
    let calm = !this.mustWake() && this.pinCount === 0 && this.pinHold <= 0 && this.tableFoldT <= 0 && this.gripT <= 0 && !this.gripAll && this.strandsT === 0
      && this.pendingLand < 0 && !(this.edgesBent && !this.memOn && !this.poseOnly()) && (!this.memOn || this.restMem < SLEEP.mem);
    if (calm && this.sloshOn) calm = this.slx * this.slx + this.sly * this.sly + this.slz * this.slz < 4e-4 * this.restRadius * this.restRadius && this.slvx * this.slvx + this.slvy * this.slvy + this.slvz * this.slvz < SLEEP.speed * SLEEP.speed;
    if (!calm) { this.calmT = 0; this.restT = 0; this.restRefOn = false; return; }
    // calmT: nothing drives the body and its centre is (nearly) still. A calm body that touches a sleeper leans on it; only a restless one wakes it (collide)
    if (this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz < SLEEP.hitSpeed * SLEEP.hitSpeed) this.calmT += nsub * H; else this.calmT = 0;
    if (!this.canSleep && !this.sleepOn) return;
    // PLAYGROUND (8.6): never on a moving prop; a WHOLE that opted in also needs PLAYGROUND_BUILD's bounds (metrics.kinetic, the centre's speed, memory converged)
    if ((this.sleepOn && (this.metrics.kinetic >= PG.restKin || this.memBusy()
      || this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz >= PG.restSpeed * PG.restSpeed))) { this.restT = 0; this.restRefOn = false; return; }
    const ref = this.restRef, n3 = this.n * 3, X = this.X, V = this.V, G = this.GOAL, v2 = SLEEP.speed * SLEEP.speed, e2 = SLEEP.err * SLEEP.err * this.restRadius * this.restRadius;
    let ymin = 1e9, still = true;
    for (let i = 0; i < n3; i += 3) {
      if (X[i + 1] < ymin) ymin = X[i + 1];
      if (V[i] * V[i] + V[i + 1] * V[i + 1] + V[i + 2] * V[i + 2] > v2) { still = false; break; }
      const dx = X[i] - G[i], dy = X[i + 1] - G[i + 1], dz = X[i + 2] - G[i + 2];
      if (dx * dx + dy * dy + dz * dz > e2) { still = false; break; }
    }
    // on the table: its lowest particle is at it, OR it lies on other pieces (cpContacts: it touched one at its last collide). CUT3 (verifier m3): a heap of shards never slept, so 24 pieces kept 21 awake and 64 kept 41 (3,192 particles).
    // Nothing is left hanging: a support that is moved, joined, touched or woken is restless, and a restless body in contact wakes the sleeper on it (collide: calmT), a change of gravity wakes every sleeper.
    if (!still || (ymin > 0.01 + 0.05 * this.restRadius && this.cpContacts === 0 && this.propNear === 0)) { this.restT = 0; this.restRefOn = false; return; }   // (PLAYGROUND: or on a static prop face)
    // REST = NO VISIBLE MOTION: no particle has left the pose it had when the countdown started by more than SLEEP.move rest radii (at least SLEEP.moveMin m). A jelly piece buzzes for ever (a piece
    // resting on another is shoved back and forth by the contact, up to a millimetre a frame: speeds of 0.2 to 0.4 m/s that go nowhere), which a speed bar cannot tell from a slow roll; the
    // displacement over the half second can.
    if (!this.restRefOn) { ref.set(X); this.restRefOn = true; this.restT = 0; return; }
    const tol = Math.max(SLEEP.moveMin, SLEEP.move * this.restRadius), t2 = tol * tol;
    for (let i = 0; i < n3; i += 3) {
      const dx = X[i] - ref[i], dy = X[i + 1] - ref[i + 1], dz = X[i + 2] - ref[i + 2];
      if (dx * dx + dy * dy + dz * dz > t2) { ref.set(X); this.restT = 0; return; }   // moved: the countdown starts again from here
    }
    this.restT += nsub * H;
    if (SLEEP.enabled && this.restT >= SLEEP.after) this.fallAsleep();
  }

  /** Ray vs the current surface, front faces only. `t` is in units of `dir` (point = origin + dir * t). */
  raycast(origin: V3, dir: V3): RayHit | null {
    if (!origin || !dir) return null;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    if (!inWorld(ox, oy, oz)) return null;                       // NaN, Infinity and absurd origins (|c| > WORLD_LIMIT)
    let dx = dir.x, dy = dir.y, dz = dir.z, k = 1;
    const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    if (!(m > 0) || m === Infinity) return null;                 // zero, NaN or infinite direction
    if (m < 1e-6 || m > 1e6) {                                   // a tiny or huge (but valid) direction: trace its unit vector, report t in units of dir
      const u4 = this.u4;
      unitOf(dx, dy, dz, u4);
      dx = u4[0]; dy = u4[1]; dz = u4[2]; k = 1 / u4[3];
    }
    if (!rayMesh(this.X, this.tris, this.setRay(ox, oy, oz, dx, dy, dz), this.rayOut)) return null;
    const tu = this.rayOut[0], tri = this.rayOut[1] | 0, u = this.rayOut[2], v = this.rayOut[3];
    const a = this.tris[tri * 3], b = this.tris[tri * 3 + 1], c = this.tris[tri * 3 + 2];
    const nrm = this.triNormal(a, b, c);
    const w0 = 1 - u - v;
    const vertex = w0 >= u && w0 >= v ? a : u >= v ? b : c;
    return {
      point: { x: ox + dx * tu, y: oy + dy * tu, z: oz + dz * tu },
      normal: { x: nrm[0], y: nrm[1], z: nrm[2] },
      vertex, t: tu * k,
    };
  }

  fingerDown(id: Slot, a: FingerDownArgs): void {
    const f = this.fingers[id];
    if (!f || !a || !a.point || !a.normal || !a.dir) return;
    const px = a.point.x, py = a.point.y, pz = a.point.z;
    // a NaN / Infinity anywhere, or an absurd point (|c| > WORLD_LIMIT), is ignored; directions are normalised without overflow
    if (!inWorld(px, py, pz) || !finite3(a.dir) || !finite3(a.normal)) return;
    const ud = this.u4, un = this.u4b;
    const hasN = unitOf(a.normal.x, a.normal.y, a.normal.z, un);
    let dx: number, dy: number, dz: number;
    if (unitOf(a.dir.x, a.dir.y, a.dir.z, ud)) { dx = ud[0]; dy = ud[1]; dz = ud[2]; }
    else if (hasN) { dx = -un[0]; dy = -un[1]; dz = -un[2]; }      // no direction: travel against the normal
    else { dx = 0; dy = -1; dz = 0; }                                 // neither: straight down
    let nx = hasN ? un[0] : 0, ny = hasN ? un[1] : 0, nz = hasN ? un[2] : 0;
    const nl = hasN ? 1 : 0;
    // a grab on this id is cancelled by a new touch
    if (this.grabs[id].active) this.grabRelease(id);

    const R = this.restRadius;
    // re-seat the contact on the CURRENT surface along the ray (the hit point may be a frame old)
    const L = 8 * R;
    let hx = px, hy = py, hz = pz;
    let hitTri = -1;
    if (rayMesh(this.X, this.tris, this.setRay(px - dx * L, py - dy * L, pz - dz * L, dx, dy, dz), this.rayOut)) {
      const t = this.rayOut[0];
      hx = px - dx * L + dx * t; hy = py - dy * L + dy * t; hz = pz - dz * L + dz * t;
      hitTri = this.rayOut[1] | 0;
    }
    if (nl > 1e-6 && (nx * -dx + ny * -dy + nz * -dz) > 0.05 * nl) { nx /= nl; ny /= nl; nz /= nl; }
    else if (hitTri >= 0) {
      const t3 = hitTri * 3;
      const nr = this.triNormal(this.tris[t3], this.tris[t3 + 1], this.tris[t3 + 2]);
      nx = nr[0]; ny = nr[1]; nz = nr[2];
    } else { nx = -dx; ny = -dy; nz = -dz; }

    // body thickness along the finger direction -> max safe depth
    let T = 2 * R;
    if (hitTri >= 0 && rayMesh(this.X, this.tris, this.setRay(hx + dx * L, hy + dy * L, hz + dz * L, -dx, -dy, -dz), this.rayOut2)) {
      T = Math.max(0.3 * R, L - this.rayOut2[0]);
    }
    // pressing toward the table can flatten the body to 25% (the table is the other jaw); pressing a free flank goes
    // less deep so the body is squeezed, not pierced
    const supported = hitTri >= 0 && hy + dy * T < 0.03 * R && dy < -0.5;
    // START TANGENT: the sphere is seated on the whole local surface, not just on the hit point. A tip wider than a thin feature (the
    // swirl-peak) would otherwise start with the apex already inside it, and the radial push-out of a vertex that deep ejects it
    // sideways past its own neighbours (a flipped triangle that never comes back). Lift the anchor back along -dir until no
    // vertex under the footprint is inside the tip.
    let lift = 0;
    if (hitTri >= 0) {
      const r0 = R * FINGER.rMin;
      let sc = -r0;                        // centre position along dir relative to the hit (default: sphere bottom on the hit)
      for (let i = 0; i < this.n; i++) {
        const rx = this.X[i * 3] - hx, ry = this.X[i * 3 + 1] - hy, rz = this.X[i * 3 + 2] - hz;
        const sv = rx * dx + ry * dy + rz * dz;
        const l2 = rx * rx + ry * ry + rz * rz - sv * sv;
        if (l2 >= r0 * r0 || sv < -2 * r0) continue;
        const need = sv - Math.sqrt(r0 * r0 - l2);     // centre must stay at or behind this
        if (need < sc) sc = need;
      }
      lift = Math.min(FINGER.maxLift * R, -r0 - sc);
    }
    hx -= dx * lift; hy -= dy * lift; hz -= dz * lift;
    f.down = true; f.retracting = false; f.contacted = false; f.pressed = false;
    f.px = hx; f.py = hy; f.pz = hz; f.tx = hx; f.ty = hy; f.tz = hz;
    f.dx = dx; f.dy = dy; f.dz = dz; f.nx = nx; f.ny = ny; f.nz = nz;
    f.depth = 0; f.depthV = 0; f.target = 0; f.holdT = 0; f.lift = lift;
    f.share = this.othersDown(id) ? FINGER.pinchShare : 1;
    f.tipR = R * FINGER.rMin;
    // a thin free part (the swirl-peak) can be shoved aside by far more than its own thickness, so a flank press may
    // always go FINGER.minFlankDepth rest radii deep
    // the reach of a flank press grows with how floppy the touched part is (the swirl-peak is shoved aside, a low flank is squeezed)
    let wf = 0;
    if (hitTri >= 0) for (let k = 0; k < 3; k++) wf = Math.max(wf, this.floppyW[this.tris[hitTri * 3 + k]]);
    const flank = FINGER.minFlankDepth + FINGER.peakReach * wf;
    f.depthMax = lift + Math.max(supported ? 0.2 * R : flank * R, this.p.squashDepth * (supported ? 1 : FINGER.flankShare) * T);
    this.placeTip(f, 1);
    f.ocx = f.cx; f.ocy = f.cy; f.ocz = f.cz;
  }

  fingerPressure(id: Slot, target: number): void {
    const f = this.fingers[id];
    if (!f || !f.down || !Number.isFinite(target)) return;
    f.target = clamp(target, 0, 1);
  }

  fingerMove(id: Slot, point: V3): void {
    const f = this.fingers[id];
    if (!f || !f.down || !point) return;
    const qx = point.x, qy = point.y, qz = point.z;
    if (!inWorld(qx, qy, qz)) return;                            // NaN, Infinity, absurd
    // project the pointer hit onto the plane through the anchor, perpendicular to the travel direction
    const ex = qx - f.px, ey = qy - f.py, ez = qz - f.pz;
    const s = ex * f.dx + ey * f.dy + ez * f.dz;
    const lx = f.px + ex - f.dx * s, ly = f.py + ey - f.dy * s, lz = f.pz + ez - f.dz * s;
    // follow the relief of the UNDEFORMED (goal) surface: the difference of two hits on the same goal mesh, so the
    // body's own motion / squash cancels and the press depth never feeds back on itself
    const L = 8 * this.restRadius;
    let ox = lx, oy = ly, oz = lz;
    if (rayMesh(this.GOAL, this.tris, this.setRay(f.px - f.dx * L, f.py - f.dy * L, f.pz - f.dz * L, f.dx, f.dy, f.dz), this.rayOut)
      && rayMesh(this.GOAL, this.tris, this.setRay(lx - f.dx * L, ly - f.dy * L, lz - f.dz * L, f.dx, f.dy, f.dz), this.rayOut2)) {
      const dt = this.rayOut2[0] - this.rayOut[0];
      ox = lx + f.dx * dt; oy = ly + f.dy * dt; oz = lz + f.dz * dt;
    }
    // keep the slide inside a sane distance of the body
    const dc = Math.sqrt((ox - this.cx) ** 2 + (oy - this.cy) ** 2 + (oz - this.cz) ** 2);
    if (dc > 3 * this.restRadius) return;
    f.tx = ox; f.ty = oy; f.tz = oz;
  }

  fingerUp(id: Slot): void {
    if (this.fingers[id] && this.fingers[id].down) { this.thrownF = true; this.thrownCalm = 0; }   // PLAYGROUND (8.8): a finger's flick is the player's too, until the body settles or lands
    const f = this.fingers[id];
    if (!f || !f.down) return;
    // 'release' on max(compression, press) (physics round-2 fix round, the shell's contract request): a single-finger dent the global
    // compression barely sees (a side press on the swirl-peak: compression < 0.1, press ~1) is a squeeze too. The press is THIS finger's own
    // indentation (finalize's metrics.press is the deeper of the two), and only while its tip is in the skin.
    let own = 0;
    if (f.touching) { const span = f.depthMax - f.lift; if (span > 1e-6) own = (clamp(f.depth, 0, 1) * f.depthMax * f.share - f.lift) / span; }
    const comp = Math.max(this.metrics.compression, clamp(own, 0, 1));
    if (f.contacted && comp > 0.08) {
      const front = f.depth * f.depthMax;
      this.emit('release', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz, comp, f.holdT, id);
    }
    f.down = false;
    if (f.depth > 1e-4) { f.retracting = true; f.retractRate = f.depth / FINGER.retractS; } else f.retracting = false;
    f.target = 0; f.depthV = 0;
  }

  grab(id: Slot, vertex: number, target: V3): void {
    let g = this.grabs[id];
    if (!g || !target) return;
    const tx = target.x, ty = target.y, tz = target.z;
    if (!inWorld(tx, ty, tz) || !Number.isFinite(vertex)) return;
    const v = Math.floor(vertex);
    if (v < 0 || v >= this.n) return;
    if (g === IDLE_GRAB) { g = this.grabs[id] = new Grab(this.n); settleDoubles(g, INT_FIELDS); }   // LOCK: a touch finger's slot (2 to 4) is made on first use
    if (g.active) this.grabRelease(id);
    const f = this.fingers[id];
    if (f.down || f.retracting) { f.down = false; f.retracting = false; f.depth = 0; f.depthV = 0; }
    const Q = this.Q, X = this.X;
    const sigma = 0.3 * this.restRadius / 2.2;       // patch radius 0.3 R = where the Gaussian weight has fallen to ~2%
    const inv2s2 = 1 / (2 * sigma * sigma);
    const qx = Q[v * 3], qy = Q[v * 3 + 1], qz = Q[v * 3 + 2];
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = Q[i * 3] - qx, dy = Q[i * 3 + 1] - qy, dz = Q[i * 3 + 2] - qz;
      const w = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv2s2);
      if (w < 0.03) continue;
      g.verts[c] = i; g.weights[c] = w;
      g.p0[c * 3] = X[i * 3]; g.p0[c * 3 + 1] = X[i * 3 + 1]; g.p0[c * 3 + 2] = X[i * 3 + 2];
      c++;
    }
    g.count = c; g.anchor = v; g.active = true; g.ramp = 0; g.holdT = 0;
    // squishies are tacky: the particles touching the table now stay glued to it until the lobe is let go
    if (this.gravityOn && this.pinCount === 0 && !this.carried) {   // (a carried body is in the hand, not on the mat)
      for (let i = 0; i < this.n; i++) if (X[i * 3 + 1] < NEAR) { this.pinned[i] = 1; this.pinCount++; }
    }
    this.pinHold = this.p.pinHold;
    // (GROUND FIX: the reference is on the reachable side of the floor too, or the first substep would pull the patch UP by the whole distance to the floor: the hostile fuzz grabs below the table)
    const tyr = this.gravityOn && ty < GRAB_FLOOR_Y ? GRAB_FLOOR_Y : ty;
    g.t0x = tx; g.t0y = tyr; g.t0z = tz; g.rx = tx; g.ry = tyr; g.rz = tz; g.ex = tx; g.ey = tyr; g.ez = tz;
    g.c0x = this.center.x; g.c0y = this.center.y; g.c0z = this.center.z;
    this.limitDepth(g, v);
    this.gripChangeT = this.simTime;
    const nrm = this.vertexNormal(v);
    this.emit('grab', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], 0.5, 0, id);
  }

  /**
   * PULL LEVEL of a grab, 0..1 (physics round-2 fix round; the 'snap' intensity and metrics.pull, contracts.ts): how far its target has been
   * pulled from where the grab started, over this body's own maximum pull (SoftParams.maxPull x restRadius: the family's maxPull with the
   * genome's stretch band; at a neutral genome 1.70 R for the gel, 1.13 R firm silicone, 2.85 R sticky stretch). updateGrabs clamps the pull
   * there, so 1 = the body reached its family's maxPull, for every family, and a half pull reads 0.5. Relative to the body's BASE: on the
   * table the grab pins the feet, so the base does not move and nothing is subtracted; with nothing pinned (floating) the body's centre
   * travel since the grab is subtracted, so a body dragged along is not a stretch (the verifier's MINOR-8). (Physics round 3: subtracting
   * the centre's travel on the table too, as fix round 2 did, also removed the stretch itself, because a stretched body's centre moves
   * toward the hand: a pull to the limit read 0.31-0.78 and a half pull 0.14-0.41.)
   */
  private pullLevel(g: Grab): number {
    const tk = this.pinCount > 0 ? 0 : 1;   // (an integer factor: no int / double ternary)
    const dx = g.ex - g.t0x - (this.cx - g.c0x) * tk, dy = g.ey - g.t0y - (this.cy - g.c0y) * tk, dz = g.ez - g.t0z - (this.cz - g.c0z) * tk, maxD = this.p.maxPull * this.restRadius;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) / (maxD > 1e-9 ? maxD : 1e-9);
    return l < 0 ? 0 : l > 1 - 1e-9 ? 1 : l;   // (the clamp leaves it a rounding error short of 1 at the limit)
  }

  /** LOCK FIX: how far the hand has pulled from where the grab began over the body's maxPull, 0..1, WITHOUT subtracting the body's own travel (the clamp's view; pullLevel is the stretch). */
  private handLevel(g: Grab): number {
    const dx = g.ex - g.t0x, dy = g.ey - g.t0y, dz = g.ez - g.t0z, maxD = this.p.maxPull * this.restRadius;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) / (maxD > 1e-9 ? maxD : 1e-9);
    return l < 0 ? 0 : l > 1 - 1e-9 ? 1 : l;
  }

  grabMove(id: Slot, target: V3): void {
    const g = this.grabs[id];
    if (!g || !g.active || !target) return;
    if (!inWorld(target.x, target.y, target.z)) return;
    g.rx = target.x; g.ry = target.y; g.rz = target.z;
  }

  grabRelease(id: Slot): void {
    const g = this.grabs[id];
    if (!g || !g.active) return;
    g.active = false;
    this.thrownF = true; this.thrownCalm = 0;   // PLAYGROUND (8.8): the player let go: its next landing (or a bump before it settles) is not auto
    this.gripChangeT = this.simTime;
    const other = this.otherGrab(id);
    if (this.carried && other < 0) {
      // B3 TOSS: let go of a carried body: it flies with the hand's velocity (at most TOSS_MAX), lands ('land') and squashes. The 'snap' of a
      // pull that got past the body's maximum is a full one (intensity 1): the shell plays its toss on it and the meter pays it as a pull.
      this.carried = false; this.liftOk = false;
      let vx = this.hvx, vy = this.hvy, vz = this.hvz;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > TOSS_MAX) { const k = TOSS_MAX / sp; vx *= k; vy *= k; vz *= k; }
      const V = this.V;
      for (let i = 0; i < this.n * 3; i += 3) { V[i] = vx; V[i + 1] = vy; V[i + 2] = vz; }
      this.vcx = vx; this.vcy = vy; this.vcz = vz;
      const v = g.anchor, X = this.X, nrm = this.vertexNormal(v);
      this.emit('snap', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], 1, g.holdT, id);
      return;
    }
    // the carrying hand let go while the other still holds a lobe: the other hand carries it from here
    if (this.carried && id === this.carrier) { this.startCarry(other); return; }
    // a snap when the pull got anywhere (>= 5% of the body's own maxPull; it was metrics.stretch > 0.05 until the round-2 fix round,
    // which a firm family pulled to its limit never reaches: slow-rise foam reads stretch 0.04 at its maxPull, so it never snapped)
    const pl = this.pullLevel(g);
    if (other < 0 && this.lockN === 0) this.pinHold = this.p.pinHold;
    if (pl > 0.05) {
      const v = g.anchor, X = this.X;
      const nrm = this.vertexNormal(v);
      this.emit('snap', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], pl, g.holdT, id);
    }
  }

  /** Visual aid (finger ghost, debug viewer): the current fingertip sphere of finger `id`, or null when it has no tip. Allocates; not for the hot path. */
  tip(id: Slot): { x: number; y: number; z: number; r: number; depth: number } | null {
    const f = this.fingers[id];
    if (!f || (!f.down && !f.retracting)) return null;
    return { x: f.cx, y: f.cy, z: f.cz, r: f.tipR, depth: f.depth };
  }

  /**
   * Optional SoftBodyLike member: pay the JIT warm-up now instead of on the player's first touch. A fresh page runs the solver in
   * V8's interpreter for its first few frames, and again for each code path the first time it runs (a finger, a pinch, a grab, float
   * mode): 15-70 ms per step() instead of ~0.8 ms. This drives a THROWAWAY twin (same genome, mesh and parameters) through every hot
   * path, so V8 optimises the shared code once, with complete type feedback: first a few frames that visit EVERY branch (two fingers,
   * rub, release, a grab with a finger still down, snap, float, a shove, a landing, every event kind) while the code is still being
   * profiled, then a mixed workout until it is compiled. THIS body is never touched: its state is bit-identical before and after.
   * (The once-per-frame entry points step() and finalize() still tier up with use: measured after warmUp() on node 22, ~11 KB of
   * short-lived numbers a frame for the first ~2 s, ~340 B a frame until ~20 s, then zero; a young-generation scavenge now and then, no
   * hitch. Forcing them with thousands of cheap calls here was tried: warmUp() got 2x slower and step() deoptimised on its first real
   * frame, so it is not done.)
   * Allocates the twin (garbage afterwards): call it once at load, e.g. behind the title card, never per frame. Nothing calls it
   * implicitly. Cost: 0.8-1.4 s measured in the 4-core test container while other jobs ran (node 22); the first-session hitches with and
   * without it are measured in _harness/probe_softbody.ts (cold JIT rows).
   */
  warmUp(): void {
    const w = new SoftBody(this.genomeRef, { detail: this.detailArg, params: this.p, mat: this.mat, family: this.family });
    const R = w.restRadius, dt = 1 / 60, F = Math.max(1, Math.floor(SoftBody.warmFrames));
    const ev: SoftEvent[] = [];
    const frame = (): void => { w.step(dt); w.tip(0); w.tip(1); w.drainEvents(ev); ev.length = 0; };
    // every ray is aimed relative to the twin's current centre: the shoves below move it off the middle of the mat, and a press that
    // misses warms nothing (measured: with world-fixed rays all 4 top presses of the workout missed, so a lone finger never ran; V8
    // later compiled the finger paths with that branch's type feedback empty, and the player's first press deoptimised them)
    const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): RayHit | null =>
      w.raycast({ x: w.center.x + ox, y: oy, z: w.center.z + oz }, { x: dx, y: dy, z: dz });
    const down = (id: 0 | 1, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void => {
      const h = ray(ox, oy, oz, dx, dy, dz);
      if (h) { w.fingerDown(id, { point: h.point, normal: h.normal, dir: { x: dx, y: dy, z: dz } }); w.fingerPressure(id, 1); }
    };
    const top = (id: 0 | 1, x: number): void => down(id, x * R, 6 * R, 0.05 * R, 0, -1, 0);
    const side = (id: 0 | 1, sx: number): void => down(id, sx * 6 * R, 0.7 * R, 0, -sx, 0, 0);
    const pull = (k: number): void => { const g = w.grabs[0]; if (g.active) w.grabMove(0, { x: g.t0x + 0.8 * R * k, y: g.t0y + 0.3 * R * k, z: g.t0z }); };
    // 1) every branch in the first frames (the twin's private state is nudged so 'press' and 'land' fire at once)
    top(0, 0.4); side(1, 1); w.fingers[0].holdT = w.fingers[1].holdT = FINGER.pressAfterS; frame();   // poke, press, pinch
    const hm = ray(0.1 * R, 6 * R, 0, 0, -1, 0); if (hm) w.fingerMove(0, hm.point); frame();                    // rub
    w.fingerUp(0);                                                                                   // release + retract
    const hg = ray(-6 * R, 0.8 * R, 0.1 * R, 1, 0, 0);
    if (hg) w.grab(0, hg.vertex, hg.point);                                                          // grab (pinned feet) while finger 1 is down
    pull(0.5); frame(); w.fingerUp(1); pull(1); frame();
    w.grabRelease(0); frame(); w.pinHold = 1e-9; frame();                                           // snap, pinned-feet hold and expiry
    {   // LOCK: a touch finger on slot 2, a grab on slot 3 pulled to a full stretch and locked, lockAt, two locks released one by one and together (the paths are first run here, not on the player's first lock)
      const hf = ray(0.5 * R, 6 * R, 0, 0, -1, 0);
      if (hf) { w.fingerDown(2, { point: hf.point, normal: hf.normal, dir: { x: 0, y: -1, z: 0 } }); w.fingerPressure(2, 1); frame(); frame(); w.fingerUp(2); frame(); }
      const maxD = w.p.maxPull * R;
      for (let k = 0; k < 3; k++) {
        const hl = ray((k & 1 ? 6 : -6) * R, 0.8 * R, 0, k & 1 ? -1 : 1, 0, 0);
        if (!hl) continue;
        w.grab(3, hl.vertex, hl.point);
        for (let i = 0; i < 14; i++) { const d = 1.1 * maxD * Math.min(1, (i + 1) / 8); w.grabMove(3, { x: hl.point.x + (k & 1 ? 1 : -1) * 0.8 * d, y: hl.point.y + 0.6 * d, z: hl.point.z }); frame(); }
        w.lockGrab(3); w.lockAt(hl.point); frame(); frame();
      }
      w.releaseLock(0); frame(); w.releaseLock('all'); frame(); w.pinHold = 1e-9; frame();
    }
    w.gravity = false; w.nudge({ x: 0.5, y: 0.3, z: -0.2 }); frame();                                // float, shove
    w.gravity = true; w.airSub = 8; w.vcy = -2; frame();                                             // land
    w.nudge({ x: 9, y: 0, z: 3 }); for (let i = 0; i < 8; i++) frame();                              // mat corral (outside the dead zone)
    w.fingerDown(1, { point: { x: w.center.x + 3 * R, y: 0.5 * R, z: w.center.z }, normal: { x: 0, y: 0, z: -1 }, dir: { x: 0, y: 0, z: 1 } });
    w.fingerPressure(1, 1); frame(); frame(); w.fingerUp(1); frame();                               // ... with a finger down that touches nothing
    w.setFold(1); w.tremble(0.5); w.moveTo({ x: 0.3, y: 0.5, z: 0 }, 1); frame(); frame();            // ceremony drivers
    w.burstOpen(0.8); frame(); w.setFold(0); w.tremble(0); w.moveTo(null); frame(); frame();
    // PLAYGROUND: the LIFE drivers are first run here, not on LIFE's first step (a first scoot deoptimised the substep: unoptimised frames, 2 KB of numbers each):
    // a squash pose with a scoot, the touch gate (a finger lands while it glides), a hop
    for (let i = 0; i < 6; i++) frame();
    w.setSquash(0.85, 0.12); w.scootTo(w.center.x + 0.4, w.center.z, 0.3); for (let i = 0; i < 4; i++) frame();
    top(0, 0.1); frame(); frame(); w.fingerUp(0); for (let i = 0; i < 3; i++) frame();
    w.setSquash(1, 0.12); w.scootTo(NaN, 0, 0); w.hopT = -10; w.hop(0.1, 0.6, 0); for (let i = 0; i < 8; i++) frame();
    // 2) a mixed workout until the optimiser has compiled it all
    for (let k = 0; k < 4; k++) {
      top(0, k & 1 ? -0.3 : 0.2); for (let i = 0; i < F; i++) frame();
      side(1, k & 1 ? -1 : 1); for (let i = 0; i < F; i++) frame();
      w.fingerUp(0); w.fingerUp(1); for (let i = 0; i < 2; i++) frame();
      const g = ray(6 * R, 0.8 * R, 0, -1, 0, 0);
      if (g) { w.grab(0, g.vertex, g.point); for (let i = 0; i < F; i++) { pull(i / F); frame(); } w.grabRelease(0); }
      w.gravity = (k & 1) === 1; if (w.gravity) w.nudge({ x: k - 2, y: 0, z: 8 }); for (let i = 0; i < F; i++) frame();
    }
    w.gravity = true; w.stateHash(); w.reset(); frame();
  }

  nudge(impulse: V3): void {
    if (!impulse) return;
    const u = this.u4;
    if (!unitOf(impulse.x, impulse.y, impulse.z, u)) return;     // zero, NaN or Infinity: nothing
    // at most MAX_NUDGE m/s, along the impulse's own direction (a 1e200 shove is a hard shove, not none: no overflow on the way)
    const l = Math.min(u[3], MAX_NUDGE), ix = u[0] * l, iy = u[1] * l, iz = u[2] * l;
    const V = this.V;
    this.wake();
    for (let i = 0; i < this.n; i++) { V[i * 3] += ix; V[i * 3 + 1] += iy; V[i * 3 + 2] += iz; }
  }

  // ---- ceremony drivers (contracts.ts SoftBodyLike, optional members; DESIGN.md 6.4). Deterministic, allocation-free, any value is safe.

  /** 0..1: morph the shape-matching goal toward the equal-volume sphere (eased with FOLD_TAU, at most FOLD_RATE per second: never snaps). */
  setFold(t: number): void {
    if (typeof t !== 'number' || Number.isNaN(t)) return;
    this.foldTarget = t <= 0 ? 0 : t >= 1 ? 1 : t;
    this.wake();
  }

  /** Kinematic spring of the centre of mass toward a world point (horizontal only on the table); null releases it. stiffness ~1 = default. */
  moveTo(p: V3 | null, stiffness?: number): void {
    if (p === null || p === undefined) { this.moveOn = false; return; }
    if (typeof p !== 'object' || !finite3(p) || !inWorld(p.x, p.y, p.z)) return;
    this.mtx = p.x; this.mty = p.y; this.mtz = p.z;
    const k = typeof stiffness === 'number' && Number.isFinite(stiffness) ? stiffness : 1;
    this.moveK = k < 0.1 ? 0.1 : k > 4 ? 4 : k;
    this.moveOn = true;
    this.wake();
  }

  /** 0..1: high-frequency goal jitter along the surface normal (the charge-up tremble). 0 = off. */
  tremble(amp: number): void {
    if (typeof amp !== 'number' || Number.isNaN(amp)) return;
    this.trembleAmp = amp <= 0 ? 0 : amp >= 1 ? 1 : amp;
    this.wake();
  }

  /** Spring open: a radial velocity kick (momentum-free) and a goal overshoot of 1 + 0.25 x strength that settles by itself (BURST_TAU). */
  burstOpen(strength: number): void {
    if (typeof strength !== 'number' || !(strength > 0)) return;   // NaN, <= 0: nothing
    const s = strength >= 1 ? 1 : strength;
    if (BURST_OVER * s > this.burstO) this.burstO = BURST_OVER * s;
    this.wake();
    const n = this.n, X = this.X, V = this.V, M = this.M, kick = BURST_SPEED * s;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { const m = M[i]; cx += m * X[i * 3]; cy += m * X[i * 3 + 1]; cz += m * X[i * 3 + 2]; }
    cx /= this.Mtot; cy /= this.Mtot; cz /= this.Mtot;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, dx = X[i3] - cx, dy = X[i3 + 1] - cy, dz = X[i3 + 2] - cz, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-9) continue;
      const k = kick / l;
      V[i3] += dx * k; V[i3 + 1] += dy * k; V[i3 + 2] += dz * k;
      mx += M[i] * dx * k; my += M[i] * dy * k; mz += M[i] * dz * k;
    }
    mx /= this.Mtot; my /= this.Mtot; mz /= this.Mtot;
    for (let i = 0; i < n; i++) { V[i * 3] -= mx; V[i * 3 + 1] -= my; V[i * 3 + 2] -= mz; }
  }

  // ---- CUT (contracts.ts SoftBodyLike, optional members; _spec/CUT.md section 4). Deterministic, allocation-free, any value is safe.

  /** Volume fraction of the whole squishy this body holds (1 for an uncut squishy; eased by setFrac). */
  get frac(): number { return this.fracNow; }

  /**
   * Pure: the fraction of this body's CURRENT volume on the plane's 'a' side (dot(p - point, normal) >= 0), or null when the plane misses
   * the body (every particle on one side). Exact for the mesh: every triangle is clipped against the plane and the volume of the 'a' part is
   * summed as tetrahedra from a point ON the plane (so the cut face itself adds nothing).
   */
  measureCut(plane: CutPlane): number | null {
    if (!plane || !plane.point || !plane.normal || !finite3(plane.point) || !finite3(plane.normal)) return null;
    if (!inWorld(plane.point.x, plane.point.y, plane.point.z)) return null;
    const u = this.u4;
    if (!unitOf(plane.normal.x, plane.normal.y, plane.normal.z, u)) return null;
    const nx = u[0], ny = u[1], nz = u[2], ox = plane.point.x, oy = plane.point.y, oz = plane.point.z;
    const X = this.X, n = this.n, tris = this.tris, SD = this.SDIST;
    let pos = 0, neg = 0;
    for (let i = 0; i < n; i++) { const d = (X[i * 3] - ox) * nx + (X[i * 3 + 1] - oy) * ny + (X[i * 3 + 2] - oz) * nz; SD[i] = d; if (d >= 0) pos++; else neg++; }
    if (pos === 0 || neg === 0) return null;
    let va = 0, vt = 0;
    const P = this.CLIP;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      vt += tetra6(X, a, b, c, ox, oy, oz);
      const da = SD[a], db = SD[b], dc = SD[c];
      if (da >= 0 && db >= 0 && dc >= 0) { va += tetra6(X, a, b, c, ox, oy, oz); continue; }
      if (da < 0 && db < 0 && dc < 0) continue;
      // Sutherland-Hodgman against the plane: the 'a' part of the triangle (3 or 4 points) into P, then fanned
      let m = 0;
      for (let k = 0; k < 3; k++) {
        const i0 = k === 0 ? a : k === 1 ? b : c, i1 = k === 0 ? b : k === 1 ? c : a, d0 = SD[i0], d1 = SD[i1];
        if (d0 >= 0) { P[m * 3] = X[i0 * 3]; P[m * 3 + 1] = X[i0 * 3 + 1]; P[m * 3 + 2] = X[i0 * 3 + 2]; m++; }
        if ((d0 >= 0) !== (d1 >= 0)) {
          const f = d0 / (d0 - d1);
          P[m * 3] = X[i0 * 3] + (X[i1 * 3] - X[i0 * 3]) * f; P[m * 3 + 1] = X[i0 * 3 + 1] + (X[i1 * 3 + 1] - X[i0 * 3 + 1]) * f; P[m * 3 + 2] = X[i0 * 3 + 2] + (X[i1 * 3 + 2] - X[i0 * 3 + 2]) * f;
          m++;
        }
      }
      for (let k = 1; k + 1 < m; k++) va += tetra6(P, 0, k, k + 1, ox, oy, oz);
    }
    if (!(vt > 0)) return null;
    const fr = va / vt;
    return fr < 0 ? 0 : fr > 1 ? 1 : fr;
  }

  /**
   * 0..1: morph the shape-matching goal into a waisted peanut along `plane` (world space), eased (NECK_TAU); at 1 the waist is
   * `NECK_WAIST + (1 - depth) (1 - NECK_WAIST)` of the cross-section's width (depth 1, the default, = today's 0.3; 0.35 = a 0.755 groove; 0 = no pinch). The volume
   * constraint holds the volume. null (or t <= 0 eased out) releases it. CUT2 5.4: the FIRST call with t > 0 pulls the plane back into the rest frame once
   * (n_r = R^T n, p_r = R^T (p - c)) and LATCHES it: the pinch, the contact fold band and the children are one plane carried by the body's pose, whatever the caller passes
   * afterwards; `setNeck(null, 0)` releases the latch.
   */
  setNeck(plane: CutPlane | null, t: number, depth?: number): void {
    if (plane === null || plane === undefined) { this.neckTarget = 0; this.nkLatched = false; return; }
    if (typeof plane !== 'object' || !plane.point || !plane.normal || !finite3(plane.point) || !finite3(plane.normal)) return;
    if (!inWorld(plane.point.x, plane.point.y, plane.point.z) || typeof t !== 'number' || Number.isNaN(t)) return;
    this.wake();   // CUT3: a piece that is being cut is awake
    // (called every frame of a neck: no doubles passed to a helper, no ternary between integer bounds and t)
    const nx = plane.normal.x, ny = plane.normal.y, nz = plane.normal.z, nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(nl > 1e-12) || nl === Infinity) return;
    const dp = depth === undefined || Number.isNaN(depth) || !NECK_FIT.depth ? 1 : depth;
    this.neckTarget = Math.min(1, Math.max(0, t));
    if (!this.nkLatched) {
      this.npx = plane.point.x; this.npy = plane.point.y; this.npz = plane.point.z; this.nnx = nx / nl; this.nny = ny / nl; this.nnz = nz / nl;
      this.nkCap = NECK_FIT.depth ? this.neckCap(ny < 0 ? -ny / nl : ny / nl) : 1;
      if (this.neckTarget > 0) this.latchNeck();
    }
    this.nkDepth = Math.min(Math.min(1, Math.max(0, dp)), this.nkCap);
    this.neckOn = true;
  }

  /** CUT2 5.4: the largest depth a pinch along a plane with |n_y| = a may have (NECK_OBL): 1 for a vertical or a level plane, NECK_OBL.cap for an oblique one, smooth in between. */
  private neckCap(a: number): number {
    const c = NECK_OBL.cap;
    if (c >= 1) return 1;
    return 1 - (1 - c) * smooth01((a - 0.3) / 0.2) * smooth01((1 - a) / 0.08);
  }

  /** Pull the world neck plane (npx.. nnx..) back into the rest frame with the pose of this moment and keep it (the first setNeck with t > 0). */
  private latchNeck(): void {
    const q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    const dx = this.npx - this.cx, dy = this.npy - this.cy, dz = this.npz - this.cz;
    this.nrx = r00 * dx + r10 * dy + r20 * dz; this.nry = r01 * dx + r11 * dy + r21 * dz; this.nrz = r02 * dx + r12 * dy + r22 * dz;
    this.nrnx = r00 * this.nnx + r10 * this.nny + r20 * this.nnz; this.nrny = r01 * this.nnx + r11 * this.nny + r21 * this.nnz; this.nrnz = r02 * this.nnx + r12 * this.nny + r22 * this.nnz;
    this.nkLatched = true;
  }

  /** The latched neck plane carried by the pose of this substep, into npx.. nnx.. (world): the contact fold band reads it. */
  private neckWorld(): void {
    const q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    const px = this.nrx, py = this.nry, pz = this.nrz, nx = this.nrnx, ny = this.nrny, nz = this.nrnz;
    this.npx = this.cx + r00 * px + r01 * py + r02 * pz; this.npy = this.cy + r10 * px + r11 * py + r12 * pz; this.npz = this.cz + r20 * px + r21 * py + r22 * pz;
    this.nnx = r00 * nx + r01 * ny + r02 * nz; this.nny = r10 * nx + r11 * ny + r12 * nz; this.nnz = r20 * nx + r21 * ny + r22 * nz;
  }

  // ---- CUT2 (TRUE CUT, _spec/CUT2.md 3.4, 4.5, 5.2, 5.6): planCut, prepareCut, placeAt. All of them read the REST mesh Q (prediction = construction), never the
  // deformed one on screen; the plane is pulled back into the rest frame once and latched.

  /** A body a cut can be planned on: a real piece, or a whole squishy at detail 3 (not a Minis copy and not a legacy chunk). */
  private cuttable(): boolean { return this.regionArg !== undefined || (!this.chunk && this.fracBuilt === 1 && this.n === 642); }

  private source(): Source {
    let s = this.src;
    if (s === null) { s = getSource(this.genomeRef); this.src = s; }
    return s;
  }

  /**
   * Plan a cut of THIS body by `plane` (world space) and fill `out` (no allocation). 'at': the plane as given, pulled back into the rest frame (n_r = R^T n,
   * d_r = n . (p - c), R the best-fit frame, c the centre of mass; in W n_W = n_r and d_W = d_r + n_r . offset) and LATCHED (the neck, the prediction and the
   * children all use the latched plane; prepareCut's retry ladder may still shift d_W by at most 0.012 R0 and then updates the plan). 'median': the point of `plane`
   * is ignored; d_r is bisected along n_r for all 40 steps until the two sides hold half the volume each (|fa - 0.5| < 1e-9). 'latched': the plane argument is
   * ignored, the latched plane is reused and only the live parts (velA, velB) and the build state are read again. `fa` is the exact share of this body's REST volume
   * on side A (Sutherland-Hodgman per triangle, tetrahedra from a point on the plane); offA / offB the children's rest origins in this body's rest-local frame (the
   * clipped volume centroids until both children are built, then the exact mass centroids); `sound` / `soundPending`: a 360-ray phi at each child's clipped
   * centroid (under 0.97: sound but pending, the centre search is the first stage of prepareCut). false when the plane misses the body, the body cannot be cut (a
   * Minis copy, a legacy chunk), or (latched) nothing is latched.
   */
  planCut(plane: CutPlane, out: CutPlan, mode: 'at' | 'median' | 'latched' = 'at'): boolean {
    if (!out || !out.rest || !out.rest.n || !this.cuttable()) return false;
    if (mode === 'latched') return this.latchOn ? this.fillPlan(out, false) : false;
    if (!plane || !plane.point || !plane.normal || !finite3(plane.point) || !finite3(plane.normal) || !inWorld(plane.point.x, plane.point.y, plane.point.z)) return false;
    const u = this.u4;
    if (!unitOf(plane.normal.x, plane.normal.y, plane.normal.z, u)) return false;
    const wx = u[0], wy = u[1], wz = u[2];
    // R^T n: rotate by the conjugate of the frame
    const q = this.qr, qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
    const tx = 2 * (qy * wz - qz * wy), ty = 2 * (qz * wx - qx * wz), tz = 2 * (qx * wy - qy * wx);
    let nx = wx + qw * tx + (qy * tz - qz * ty), ny = wy + qw * ty + (qz * tx - qx * tz), nz = wz + qw * tz + (qx * ty - qy * tx);
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= nl; ny /= nl; nz /= nl;
    const c = this.center;
    let d = wx * (plane.point.x - c.x) + wy * (plane.point.y - c.y) + wz * (plane.point.z - c.z);
    if (mode === 'median') { this.medianOffset(nx, ny, nz); d = PC_SCAL[1]; }
    this.lnx = nx; this.lny = ny; this.lnz = nz; this.lnd = d;
    this.latchOn = true;
    this.cutJob = null; this.cutState = 0; this.cutOut = out;
    this.lastJobD = d + nx * this.offX + ny * this.offY + nz * this.offZ; this.planD = d;
    if (!this.fillPlan(out, true)) { this.latchOn = false; this.cutOut = null; return false; }
    return true;
  }

  /** The offset d along the rest-local unit normal (nx, ny, nz) that halves the REST volume: 40 bisection steps between the extremes of Q along it. */
  private medianOffset(nx: number, ny: number, nz: number): void {
    const Q = this.Q, n = this.n, P = PC_PLANE, tris = this.tris, V = this.restVolume;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const s = nx * Q[i * 3] + ny * Q[i * 3 + 1] + nz * Q[i * 3 + 2]; if (s < lo) lo = s; if (s > hi) hi = s; }
    P[0] = nx; P[1] = ny; P[2] = nz;
    for (let k = 0; k < 40; k++) {
      const mid = 0.5 * (lo + hi);
      P[3] = mid;
      clipMesh(Q, tris, P, PC_CLIP);
      if (PC_CLIP[CLIP_VOL] / V > 0.5) lo = mid; else hi = mid;
    }
    PC_SCAL[1] = 0.5 * (lo + hi);
  }

  /** Fill `out` from the latched plane, the build state and the live velocities. `fresh`: also the 360-ray soundness of the two children (planCut, not a re-read). */
  private fillPlan(out: CutPlan, fresh: boolean): boolean {
    const P = PC_PARTS, N = PC_N, L = PC_PL5;
    L[0] = this.lnx; L[1] = this.lny; L[2] = this.lnz; L[3] = this.lnd; L[4] = this.fracBuilt;
    if (!planSplit(this.Q, this.tris, L, P)) return false;
    if (this.n <= 42 && this.regionArg !== undefined && !this.trueShares(P)) return false;   // CUT3: a coarse piece (12 / 42 particles) is cut by the shares of its TRUE region (piece.ts planSplitTrue)
    N.x = this.lnx; N.y = this.lny; N.z = this.lnz;
    const ox = this.offX, oy = this.offY, oz = this.offZ, job = this.cutJob, st = this.cutState;
    const dW = this.lnd + N.x * ox + N.y * oy + N.z * oz;
    PC_SCAL[0] = dW;
    out.rest.n.x = N.x; out.rest.n.y = N.y; out.rest.n.z = N.z;
    out.rest.d = job !== null ? job.d : dW;
    out.fa = job !== null ? job.plan.fa : P.fa;
    out.aspectA = P.aspectA; out.aspectB = P.aspectB;
    if (st === 2 && job !== null && job.a !== null && job.b !== null) {
      out.offA.x = job.a.offset.x - ox; out.offA.y = job.a.offset.y - oy; out.offA.z = job.a.offset.z - oz;
      out.offB.x = job.b.offset.x - ox; out.offB.y = job.b.offset.y - oy; out.offB.z = job.b.offset.z - oz;
    } else {
      out.offA.x = P.cA.x; out.offA.y = P.cA.y; out.offA.z = P.cA.z;
      out.offB.x = P.cB.x; out.offB.y = P.cB.y; out.offB.z = P.cB.z;
    }
    // CUT3 leg 3: a side of the clipped rest mesh that falls into several separate parts (a star's tips taken by one plane) is one body per part; the soundness of each part is the builder's to say
    const multi = out.acceptParts === true && this.n >= 162 && this.analyseParts(dW);
    if (fresh) { if (multi) { this.lSound = true; this.lPending = false; } else this.soundCheck(P.cA, P.cB); }
    out.sound = st === 4 ? false : st === 2 ? true : this.lSound;
    out.soundPending = st === 4 || st === 2 ? false : this.lPending;
    out.built = st === 2;
    this.sideVelocities(out);
    this.fillPartList(out, multi, job, st);
    return true;
  }

  /** The parts of the latched plane on this body's rest mesh (W frame). true when a side has two or more. */
  private analyseParts(dW: number): boolean {
    let cp = this.cutParts;
    if (cp === null || cp.A.lab.length !== this.n) { cp = new CutParts(this.n); this.cutParts = cp; }
    PC_PL4W[0] = this.lnx; PC_PL4W[1] = this.lny; PC_PL4W[2] = this.lnz; PC_PL4W[3] = dW;
    return cp.run(this.restW(), this.tris, this.n, PC_PL4W, 3 * FRAC_FLOOR * this.source().v3) >= 0 && cp.multi;
  }

  /** CutPlan.parts / partList (contracts.ts): one entry per body the cut makes. Only when a side has several parts or this body carries a `region.part` (the entries are reused objects: a plain cut of a
   *  plain body allocates nothing and leaves the list absent). The entries' offsets are the exact mass centroids once the job has built them. */
  private fillPartList(out: CutPlan, multi: boolean, job: CutJob | null, st: number): void {
    const rg = this.regionArg, T = rg ? rg.part : undefined;
    if (!multi && T === undefined) { out.parts = 2; out.partList = undefined; return; }
    const cp = this.cutParts!, ox = this.offX, oy = this.offY, oz = this.offZ;
    const total = multi ? cp.A.n + cp.B.n : 2;
    let list = out.partList;
    if (list === undefined) { list = []; out.partList = list; }
    while (list.length < total) list.push({ side: 0, part: undefined, frac: 0, off: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, aspect: 0 });
    list.length = total;
    out.parts = total;
    if (!multi) {
      const a = list[0], b = list[1];
      a.side = 0; a.part = T; a.frac = out.fa; a.off.x = out.offA.x; a.off.y = out.offA.y; a.off.z = out.offA.z; a.vel.x = out.velA.x; a.vel.y = out.velA.y; a.vel.z = out.velA.z; a.aspect = out.aspectA;
      b.side = 1; b.part = T; b.frac = 1 - out.fa; b.off.x = out.offB.x; b.off.y = out.offB.y; b.off.z = out.offB.z; b.vel.x = out.velB.x; b.vel.y = out.velB.y; b.vel.z = out.velB.z; b.aspect = out.aspectB;
      return;
    }
    // the mass-weighted mean velocity of the particles of each part
    const pv = this.pvel, M = this.M, V = this.V, n = this.n;
    pv.fill(0);
    for (let i = 0; i < n; i++) {
      const w = M[i], i3 = i * 3;
      const la = cp.A.lab[i], lb = cp.B.lab[i];
      if (la >= 0) { const o = la * 4; pv[o] += w * V[i3]; pv[o + 1] += w * V[i3 + 1]; pv[o + 2] += w * V[i3 + 2]; pv[o + 3] += w; }
      if (lb >= 0) { const o = (MAX_PARTS + lb) * 4; pv[o] += w * V[i3]; pv[o + 1] += w * V[i3 + 1]; pv[o + 2] += w * V[i3 + 2]; pv[o + 3] += w; }
    }
    const fa = out.fa;
    let idx = 0;
    for (let sd = 0; sd < 2; sd++) {
      const side = sd === 0 ? cp.A : cp.B, fs = sd === 0 ? fa : 1 - fa;
      for (let k = 0; k < side.n; k++, idx++) {
        const e = list[idx], o = (sd * MAX_PARTS + k) * 4, mw = pv[o + 3];
        e.side = sd as 0 | 1; e.part = partToken(T, side.n, k); e.frac = fs * (side.vol[k] / side.total); e.aspect = side.aspect[k];
        const kid = st === 2 && job !== null ? job.kids[idx] : undefined;
        if (kid && kid.built) { e.off.x = kid.built.offset.x - ox; e.off.y = kid.built.offset.y - oy; e.off.z = kid.built.offset.z - oz; }
        else { e.off.x = side.cx[k] - ox; e.off.y = side.cy[k] - oy; e.off.z = side.cz[k] - oz; }
        if (mw > 0) { e.vel.x = pv[o] / mw; e.vel.y = pv[o + 1] / mw; e.vel.z = pv[o + 2] / mw; }
        else { const v = sd === 0 ? out.velA : out.velB; e.vel.x = v.x; e.vel.y = v.y; e.vel.z = v.z; }
      }
    }
  }

  /** CUT3: replace the shares and centroids of `P` (planSplit's result for the latched plane, rest-local) by those of the TRUE region (the source solid cut by this piece's cell and the plane), cached for the
   *  latched plane (the quadrature is a few ms and fillPlan runs again whenever the build state changes). false: the region does not reach both sides. */
  private trueShares(P: CutPlanParts): boolean {
    const ox = this.offX, oy = this.offY, oz = this.offZ, dW = this.lnd + this.lnx * ox + this.lny * oy + this.lnz * oz, k = this.tsK, r = this.tsR;
    if (!(this.tsOk && k[0] === this.lnx && k[1] === this.lny && k[2] === this.lnz && k[3] === dW && k[4] === this.fracBuilt)) {
      const L = PC_PLW, T = PC_TRUE;
      L[0] = this.lnx; L[1] = this.lny; L[2] = this.lnz; L[3] = dW; L[4] = this.fracBuilt;
      T.aspectA = P.aspectA; T.aspectB = P.aspectB;
      T.cA.x = P.cA.x + ox; T.cA.y = P.cA.y + oy; T.cA.z = P.cA.z + oz; T.cB.x = P.cB.x + ox; T.cB.y = P.cB.y + oy; T.cB.z = P.cB.z + oz;   // (the mesh clip's centroids start the quadrature)
      if (!planSplitTrue(this.source(), this.cellData, L, T)) { this.tsOk = false; return false; }
      r[0] = T.fa; r[1] = T.fracA; r[2] = T.fracB; r[3] = T.cA.x; r[4] = T.cA.y; r[5] = T.cA.z; r[6] = T.cB.x; r[7] = T.cB.y; r[8] = T.cB.z;
      k[0] = this.lnx; k[1] = this.lny; k[2] = this.lnz; k[3] = dW; k[4] = this.fracBuilt; this.tsOk = true;
    }
    P.fa = r[0]; P.fracA = r[1]; P.fracB = r[2];
    P.cA.x = r[3] - ox; P.cA.y = r[4] - oy; P.cA.z = r[5] - oz; P.cB.x = r[6] - ox; P.cB.y = r[7] - oy; P.cB.z = r[8] - oz;
    return true;
  }

  /** planCut's cheap soundness (4.5): phi at each child's clipped centroid. Provisional answer: sound, pending when either phi is under PC_PHI_OK. */
  private soundCheck(cA: V3, cB: V3): void {
    const S = this.source(), cd = this.cellData, np = cd.np, ox = this.offX, oy = this.offY, oz = this.offZ, dW = PC_SCAL[0];
    const ok = np + 1 <= MAX_PLANES;
    let pending = false;
    for (let s = 0; s < 2 && ok; s++) {
      const cell = s === 0 ? PC_CELL_A : PC_CELL_B, sg = s === 0 ? 1 : -1, c = s === 0 ? cA : cB, pl = cell.pl;
      for (let k = 0; k < np * 4; k++) pl[k] = cd.pl[k];
      pl[np * 4] = sg * this.lnx; pl[np * 4 + 1] = sg * this.lny; pl[np * 4 + 2] = sg * this.lnz; pl[np * 4 + 3] = sg * dW;
      cell.np = np + 1;
      starVolume(S, cell, c.x + ox, c.y + oy, c.z + oz, 360, PC_SV);
      if (!(PC_SV[0] > 0) || !(PC_SV[1] >= PC_PHI_OK)) pending = true;
    }
    this.lSound = ok; this.lPending = ok && pending;
  }

  /** velA / velB: the mass-weighted mean world velocity of the particles whose REST position lies on side A / B of the latched plane (momentum is conserved across the cut). */
  private sideVelocities(out: CutPlan): void {
    const Q = this.Q, V = this.V, M = this.M, n = this.n, nx = this.lnx, ny = this.lny, nz = this.lnz, d = this.lnd;
    let ax = 0, ay = 0, az = 0, ma = 0, bx = 0, by = 0, bz = 0, mb = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, w = M[i];
      if (nx * Q[i3] + ny * Q[i3 + 1] + nz * Q[i3 + 2] - d >= 0) { ax += w * V[i3]; ay += w * V[i3 + 1]; az += w * V[i3 + 2]; ma += w; }
      else { bx += w * V[i3]; by += w * V[i3 + 1]; bz += w * V[i3 + 2]; mb += w; }
    }
    if (ma > 0) { out.velA.x = ax / ma; out.velA.y = ay / ma; out.velA.z = az / ma; } else { out.velA.x = 0; out.velA.y = 0; out.velA.z = 0; }
    if (mb > 0) { out.velB.x = bx / mb; out.velB.y = by / mb; out.velB.z = bz / mb; } else { out.velB.x = 0; out.velB.y = 0; out.velB.z = 0; }
  }

  /**
   * After a successful planCut: build the two children in time slices (4.5). Each call runs as many build stages as fit in `budgetMs`, never more than `maxStages` (a
   * test passes budgetMs = Infinity and a fixed maxStages so the frame at which the build completes does not depend on the machine). true when both children are in
   * the cache (the constructor takes them from it) and the plan passed to planCut holds the exact `offA` / `offB` and `built`; false while stages remain; 'loose'
   * when a child is not one body (the centre search found no centre that sees 95 % of it); 'thin' when no plane within 0.012 R0 passes the build gates. A refusal
   * stays until the next planCut. The retry ladder moves the latched plane by at most 0.012 R0 and then updates `rest`, `fa`, `offA` / `offB` and `velA` / `velB` of
   * the plan in the same call, so the plan always describes the plane being built.
   */
  prepareCut(budgetMs: number, maxStages?: number): boolean | 'thin' | 'loose' {
    const out = this.cutOut;
    if (!this.latchOn || out === null) return 'thin';
    if (this.cutState === 2) return true;
    if (this.cutState === 3) return 'thin';
    if (this.cutState === 4) return 'loose';
    let job = this.cutJob;
    if (job === null) {
      let id = 0;
      const rg = this.regionArg;
      if (rg) for (const pl of rg.planes) if (pl.id > id) id = pl.id;
      const dW = this.lnd + this.lnx * this.offX + this.lny * this.offY + this.lnz * this.offZ;
      job = new CutJob(this.genomeRef, { region: rg, frac: this.fracBuilt, pos: this.restW(), tris: this.tris, coarse: this.n <= 42, parts: out.acceptParts === true }, { id: id + 1, n: { x: this.lnx, y: this.lny, z: this.lnz }, d: dW });
      this.cutJob = job; this.cutState = 1; this.lastJobD = dW;
    }
    const ms = typeof budgetMs === 'number' && !Number.isNaN(budgetMs) ? budgetMs : 3;
    job.run(ms, typeof maxStages === 'number' && maxStages > 0 ? maxStages : Infinity);
    if (job.d !== this.lastJobD) {
      // the ladder shifted the plane: the latch follows (d_r = d_W - n_r . offset) and the plan is read again for the plane that is built
      this.lastJobD = job.d;
      this.lnd = job.d - (this.lnx * this.offX + this.lny * this.offY + this.lnz * this.offZ);
    }
    const st = job.status, was = this.cutState;
    this.cutState = st === 'ok' ? 2 : st === 'thin' ? 3 : st === 'loose' ? 4 : 1;
    if (this.cutState !== was || this.lnd !== this.planD) this.fillPlan(out, false);   // (a call that moved nothing costs only its build stages)
    this.planD = this.lnd;
    if (this.cutState === 2) return true;
    return this.cutState === 3 ? 'thin' : this.cutState === 4 ? 'loose' : false;
  }

  /** This body's rest mesh in W (Q + offset): the parent of a CutJob. Made on the first prepareCut. */
  private restW(): Float64Array {
    let w = this.restWBuf;
    if (w === null) {
      const Q = this.Q, n3 = this.n * 3;
      w = new Float64Array(n3);
      for (let i = 0; i < n3; i += 3) { w[i] = Q[i] + this.offX; w[i + 1] = Q[i + 1] + this.offY; w[i + 2] = Q[i + 2] + this.offZ; }
      this.restWBuf = w;
    }
    return w;
  }

  /**
   * Put a freshly built piece (before its first step) at world `at` (its rest centre of mass) with velocity `vel` and rotation `frame` (the parent's best-fit frame;
   * default none): every particle at `at + R(frame) . restLocal`, EXACTLY, with no lift and no clamp to the table (the shell applies one common lift to the pair, 6.4
   * step 3), `qr` = frame, `homeX` / `homeZ` = at.x / at.z (they come from the constructor otherwise, and drive matCorral and reset()). The velocity is the whole
   * piece's: momentum, with the slosh drive told that the body was already moving. Bad input is ignored.
   */
  placeAt(at: V3, vel: V3, frame?: Quat): void {
    if (!at || !finite3(at) || !inWorld(at.x, at.y, at.z)) return;
    this.wake();
    let qx = 0, qy = 0, qz = 0, qw = 1;
    if (frame && Number.isFinite(frame.x) && Number.isFinite(frame.y) && Number.isFinite(frame.z) && Number.isFinite(frame.w)) {
      const l = Math.sqrt(frame.x * frame.x + frame.y * frame.y + frame.z * frame.z + frame.w * frame.w);
      if (l > 1e-9) { qx = frame.x / l; qy = frame.y / l; qz = frame.z / l; qw = frame.w / l; }
    }
    const n = this.n, X = this.X, Q = this.Q, V = this.V;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, x = Q[i3], y = Q[i3 + 1], z = Q[i3 + 2];
      const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
      X[i3] = at.x + x + qw * tx + (qy * tz - qz * ty); X[i3 + 1] = at.y + y + qw * ty + (qz * tx - qx * tz); X[i3 + 2] = at.z + z + qw * tz + (qx * ty - qy * tx);
    }
    this.XP.set(X); this.GOAL.set(X);
    this.qr[0] = qx; this.qr[1] = qy; this.qr[2] = qz; this.qr[3] = qw;
    this.cx = at.x; this.cy = at.y; this.cz = at.z;
    this.homeX = at.x; this.homeZ = at.z;
    let vx = 0, vy = 0, vz = 0;
    if (vel && finite3(vel)) { vx = clamp(vel.x, -MAX_NUDGE, MAX_NUDGE); vy = clamp(vel.y, -MAX_NUDGE, MAX_NUDGE); vz = clamp(vel.z, -MAX_NUDGE, MAX_NUDGE); }
    for (let i = 0; i < n; i++) { V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz; }
    this.vcx = vx; this.vcy = vy; this.vcz = vz; this.pvcx = vx; this.pvcy = vy; this.pvcz = vz;
    let near = 0, nearM = 0;
    for (let i = 0; i < n; i++) if (X[i * 3 + 1] < NEAR) { near++; nearM += this.M[i]; }
    this.nearCount = near; this.nearMass = Math.max(1, nearM);
    this.supp = this.gravityOn ? smooth01((near - 1) / 4) : 0;
    this.syncOutputs();
  }

  /** Grow or shrink the rest volume smoothly (smoothstep in time) to `frac` of the whole over `seconds` (0: at once). The rest shape is the
   *  built one scaled by cbrt(frac / built); the volume constraint follows it. frac is clamped to FRAC_FLOOR .. 1 (CUT3: no 1/8 floor). */
  setFrac(frac: number, seconds: number): void {
    if (typeof frac !== 'number' || !Number.isFinite(frac)) return;
    const f = frac < FRAC_FLOOR ? FRAC_FLOOR : frac > 1 ? 1 : frac;
    const sec = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 0;
    this.wake();
    this.fracFrom = this.fracNow; this.fracTo = f; this.fracT0 = this.simTime; this.fracDur = sec;
    if (sec === 0) { this.fracNow = f; this.fracDur = 0; }
  }

  /**
   * B2 SOFT BODY-TO-BODY CONTACT (stage B item B2; CUT.md 4.5). Call once per frame, before step(), with every other body on the mat (a body
   * that is not a SoftBody, or this body itself, is skipped). Broad phase: bounding spheres. Narrow phase: each of this body's particles inside
   * the other's sphere is matched to the other's nearest particle (its per-frame particle hash) and measured along that particle's vertex
   * normal; closer than the contact skin (a quarter of both mean edge lengths) it is a contact: BOTH particles are pushed apart along the
   * normal, half each (positions), the approaching part of their relative velocity is removed (an inelastic contact: soft bodies do not
   * ring off each other) and CONTACT_MU of the sliding part (friction). A contact that closes faster than BUMP_MIN emits 'bump' (intensity =
   * the relative approach speed / BUMP_NORM, at = the mean contact point, normal = the mean contact normal, rate-limited like every event).
   * Deterministic (fixed orders), allocation-free (typed scratch; the hash and normals are built once per frame per body, on demand).
   */
  collide(others: readonly SoftBodyLike[], count?: number): void {   // (count: the planner keeps one list per body between frames and says how many entries are live: no array is rebuilt, no allocation)
    if (!others || typeof others.length !== 'number') return;
    if (this.asleep) return;   // CUT3: a sleeping piece pushes nothing; the awake bodies that reach it do the work (they lean on it, or wake it)
    const X = this.X, V = this.V, n = this.n, now = this.subIdx;
    this.boundRadius();
    const ra = this.bR;
    const nOthers = count === undefined || count > others.length ? others.length : count;
    for (let k = 0; k < nOthers; k++) {
      const o = others[k];
      if (!(o instanceof SoftBody) || o === this) continue;
      if (!(o.asleep && o.bRvalid)) { o.boundRadius(); o.bRvalid = o.asleep; }   // (a sleeper's bound radius is measured once)
      const rb = o.bR;
      const cdx = o.center.x - this.center.x, cdy = o.center.y - this.center.y, cdz = o.center.z - this.center.z;
      let skin = 0.25 * (this.meanEdge + o.meanEdge);
      const piecePair = !PIECE_CONTACT.shipped && (this.capFlat || o.capFlat);   // CUT2 5.5: a pair with a cut face has its own contact below; a pair of whole bodies runs the code after it, bit for bit
      if (piecePair && this.capFlat && o.capFlat) {
        // two pieces born together start inside each other's skin: the skin eases in (smoothstep over PC_RAMP_S) from the elder's age
        const age = this.simTime > o.simTime ? this.simTime : o.simTime;
        if (age < PC_RAMP_S) { const u = age / PC_RAMP_S; skin *= u * u * (3 - 2 * u); }
      }
      const reach = rb + skin;
      if (cdx * cdx + cdy * cdy + cdz * cdz > (ra + reach) * (ra + reach)) continue;   // broad phase: the spheres do not meet
      o.ensureContactData();
      // CUT3 SLEEP: a sleeping body is a fixed support (ow 0: it takes none of the push; this body takes all of it) unless this body is itself restless, which wakes it on contact
      const ow = o.asleep ? 0 : 1, mT = 2 - ow;
      this.ow = ow;
      if (piecePair) {
        this.cpPt[3] = skin;   // (passed in the scratch: a double argument to a function this size is a HeapNumber a call)
        this.contactPiece(o, now);
        if (ow === 0 && this.cpContacts > 0 && this.calmT < SLEEP.hit * SLEEP.after) o.wake();
        continue;
      }
      const OX = o.X, OV = o.V, VN = o.VN, head = o.hashHead, next = o.hashNext, cell = o.hashCell, deep = 0.6 * o.restRadius;
      const ocx = o.center.x, ocy = o.center.y, ocz = o.center.z, reach2 = reach * reach, search2 = 4 * cell * cell;
      let contacts = 0, appr = 0, sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0, spen = 0, pmax = 0, rnC = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, px = X[i3], py = X[i3 + 1], pz = X[i3 + 2];
        const ex = px - ocx, ey = py - ocy, ez = pz - ocz;
        if (ex * ex + ey * ey + ez * ez > reach2) continue;
        // nearest particle of the other body (27 hash cells around)
        const gx = Math.floor(px / cell), gy = Math.floor(py / cell), gz = Math.floor(pz / cell);
        let best = -1, bd2 = search2;
        for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let az = -1; az <= 1; az++) {
          let j = head[(Math.imul(gx + ax, 73856093) ^ Math.imul(gy + ay, 19349663) ^ Math.imul(gz + az, 83492791)) & (HASH_SIZE - 1)];
          while (j >= 0) {
            const j3 = j * 3, dx = px - OX[j3], dy = py - OX[j3 + 1], dz = pz - OX[j3 + 2], d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bd2) { bd2 = d2; best = j; }
            j = next[j];
          }
        }
        if (best < 0) continue;
        const b3 = best * 3, nx = VN[b3], ny = VN[b3 + 1], nz = VN[b3 + 2];
        const d = (px - OX[b3]) * nx + (py - OX[b3 + 1]) * ny + (pz - OX[b3 + 2]) * nz;
        if (d >= skin || d < -deep) continue;   // clear of it, or deeper than a frame can carry a particle (no direction to trust)
        const push = 0.5 * (skin - d), pT = push * mT, pO = push * ow;
        if (push > pmax) pmax = push;
        X[i3] += nx * pT; X[i3 + 1] += ny * pT; X[i3 + 2] += nz * pT;
        if (X[i3 + 1] < 0) X[i3 + 1] = 0;
        OX[b3] -= nx * pO; OX[b3 + 1] -= ny * pO; OX[b3 + 2] -= nz * pO;
        if (OX[b3 + 1] < 0) OX[b3 + 1] = 0;
        // inelastic along the normal, friction across it (half to each side)
        const rvx = V[i3] - OV[b3], rvy = V[i3 + 1] - OV[b3 + 1], rvz = V[i3 + 2] - OV[b3 + 2], vn = rvx * nx + rvy * ny + rvz * nz;
        const vnn = vn < 0 ? vn : CONTACT_TACK * vn, tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
        const ix = 0.5 * (vnn * nx + CONTACT_MU * tx), iy = 0.5 * (vnn * ny + CONTACT_MU * ty), iz = 0.5 * (vnn * nz + CONTACT_MU * tz);
        V[i3] -= ix * mT; V[i3 + 1] -= iy * mT; V[i3 + 2] -= iz * mT;
        OV[b3] += ix * ow; OV[b3 + 1] += iy * ow; OV[b3 + 2] += iz * ow;
        contacts++;
        if (-vn > appr) appr = -vn;
        sx += px; sy += py; sz += pz; snx += nx; sny += ny; snz += nz; spen += push;
      }
      if (contacts > 0) {
        // FRICTION OF THE WHOLE BODIES: the contact particles' own friction above cannot hold a body that slides as a whole (a stack on a
        // dome slid off sideways); the bodies' relative velocity across the mean contact normal is damped too (CONTACT_MU_BODY per frame,
        // half each, every particle alike: no deformation, no momentum created)
        const nl = Math.sqrt(snx * snx + sny * sny + snz * snz);
        if (nl > 1e-9) {
          const mx = snx / nl, my = sny / nl, mz = snz / nl;
          const rvx = this.vcx - o.vcx, rvy = this.vcy - o.vcy, rvz = this.vcz - o.vcz, rn = rvx * mx + rvy * my + rvz * mz;
          rnC = rn;   // (PLAYGROUND: the bodies' approach before this contact takes it out: wakesWhole)
          // ... and their approach along it (a body resting on another is not driven into it by its own weight: the contact particles' share
          // alone let the stack sink 5 cm a second into the body below)
          const an = rn < 0 ? 0.5 * rn : 0;
          const tx = (rvx - rn * mx) * 0.5 * CONTACT_MU_BODY + an * mx, ty = (rvy - rn * my) * 0.5 * CONTACT_MU_BODY + an * my, tz = (rvz - rn * mz) * 0.5 * CONTACT_MU_BODY + an * mz;
          // ... and a rigid share of the separation (CONTACT_RIGID of the mean push, each body as a whole): the push of a few contact
          // particles alone is spread over the whole body by the next solve, so a resting stack settled 0.18 R deep into the body below
          const rs = CONTACT_RIGID * spen / contacts, rx = mx * rs, ry = my * rs, rz = mz * rs;
          const txT = tx * mT, tyT = ty * mT, tzT = tz * mT, rxT = rx * mT, ryT = ry * mT, rzT = rz * mT;
          for (let i = 0; i < n * 3; i += 3) { V[i] -= txT; V[i + 1] -= tyT; V[i + 2] -= tzT; X[i] += rxT; X[i + 1] += ryT; X[i + 2] += rzT; if (X[i + 1] < 0) X[i + 1] = 0; }
          if (ow === 1) for (let i = 0; i < o.n * 3; i += 3) { OV[i] += tx; OV[i + 1] += ty; OV[i + 2] += tz; OX[i] -= rx; OX[i + 1] -= ry; OX[i + 2] -= rz; if (OX[i + 1] < 0) OX[i + 1] = 0; }
          this.vcx -= txT; this.vcy -= tyT; this.vcz -= tzT;
          if (ow === 1) { o.vcx += tx; o.vcy += ty; o.vcz += tz; }
        }
        if (ow === 1) o.syncOutputs();
        // a 'bump' is the START of a contact (none with that body in the last BUMP_GAP substeps) that closes faster than BUMP_MIN: bodies
        // resting against each other do not keep bumping
        const cs = o.contactSlot, slot = cs >= 0 && cs < MAX_SLOTS ? cs : MAX_SLOTS + (o.bodyId & (MAX_OTHERS - 1)), fresh = now - this.contactWith[slot] > BUMP_GAP;
        this.contactWith[slot] = now;
        this.markContact(o);
        if (fresh && appr > BUMP_MIN) {
          const ic = 1 / contacts;
          this.bumpWith(o);
          this.emit('bump', sx * ic, sy * ic, sz * ic, snx, sny, snz, appr / BUMP_NORM, 0, -1);   // normal: out of the other body
        }
        if (ow === 0) {
          if (o.canSleep && !o.sleepOn) { if (this.calmT < SLEEP.hit * SLEEP.after) o.wake(); }   // CUT3: a restless body wakes the sleeping piece it reaches (a body that opted in to sleepEnabled: PLAYGROUND's rule)
          else { const wk = this.pq; wk[0] = snx; wk[1] = sny; wk[2] = snz; wk[3] = pmax; wk[4] = skin; wk[5] = rnC; if (this.wakesWhole(o)) o.wake(); }   // PLAYGROUND (8.6): a sleeping WHOLE, only by a real knock
        }
      }
    }
    this.syncOutputs();
  }
  /** PLAYGROUND (PLAYGROUND_BUILD 8.6, F#5): a contact wakes a sleeping WHOLE only when this body closes on it faster than PG.wakeSpeed (its centre's velocity along
   *  the mean contact normal, plus its scootTo glide, which is not in V; a particle's own jiggle does not count) or drives a particle more than PG.wakePush x its
   *  mean edge INSIDE the sleeper (past the contact skin, which a resting contact keeps); otherwise the sleeper stays a fixed support for this pair (a nuzzle at
   *  0.04 m/s never wakes its partner, nor does a calm body resting against it). The contact's numbers come in pq: [the summed normal (3, out of the sleeper),
   *  the deepest half push, the skin, the centres' relative normal speed] (no doubles across the call). */
  private wakesWhole(o: SoftBody): boolean {
    const wk = this.pq, snx = wk[0], sny = wk[1], snz = wk[2], pmax = wk[3], skin = wk[4], l = Math.sqrt(snx * snx + sny * sny + snz * snz);
    if (!(l > 1e-9)) return false;
    const nx = snx / l, ny = sny / l, nz = snz / l;
    const appr = -(wk[5] + this.sGx * nx + this.sGz * nz);   // (the centres' approach along the normal before the contact took it out, and the glide)
    return appr > PG.wakeSpeed || 2 * pmax > skin + PG.wakePush * o.meanEdge;
  }

  /**
   * CUT2 5.5: the contact of a pair in which at least one body has a cut face (`capFlat`), called by collide() with the pair's contact skin (eased in for two young pieces).
   * Differences to the contact of two whole bodies: (1) distance and direction come from the CLOSEST POINT on the other surface (the triangles around the nearest particle,
   * Ericson 5.1.5), not from the nearest particle's vertex normal (at flush faces that normal tilts with the rim angle and invented a penetration of the vertex spacing times
   * its sine: 42 to 75 particles were "in contact" with the pieces exactly flush); the push goes along (p - closest) / |p - closest| and is shared by the three vertices of
   * the triangle by their barycentric weights; (2) a particle's push is at most PC_PUSH_MAX per frame, and so is the whole-body shove; (3) that shove is scaled by
   * min(1, contacts / 12) and is vertical when the mean normal is within 37 degrees of vertical.
   */
  private contactPiece(o: SoftBody, now: number): void {
    const X = this.X, V = this.V, n = this.n, OX = o.X, OV = o.V, cp = this.cpS, cpt = this.cpPt, skin = cpt[3];
    o.ensureTriLists();
    const vs = o.vtStart!, vl = o.vtList!, otris = o.tris;
    const head = o.hashHead, next = o.hashNext, cell = o.hashCell, deep = 0.6 * o.restRadius;
    const ocx = o.center.x, ocy = o.center.y, ocz = o.center.z, reach = o.bR + skin, reach2 = reach * reach, search2 = 4 * cell * cell;
    const ow = this.ow;   // CUT3: ow 0 = o sleeps and is a fixed support (this body takes all of every push and impulse, o none)
    this.cpContacts = 0;
    let contacts = 0, appr = 0, sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0, spen = 0;
    // the boxes of the two bodies: two halves of one cut are half-domes, their bounding spheres overlap while the bodies are a hand's width apart, their boxes do not (a parted pair costs
    // nothing; a flush or stacked pair only searches the particles inside the other's box grown by the skin)
    let bx0 = 1e30, by0 = 1e30, bz0 = 1e30, bx1 = -1e30, by1 = -1e30, bz1 = -1e30;
    for (let j = 0; j < o.n * 3; j += 3) {
      const x = OX[j], y = OX[j + 1], z = OX[j + 2];
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
    }
    bx0 -= skin; by0 -= skin; bz0 -= skin; bx1 += skin; by1 += skin; bz1 += skin;
    let ox0 = 1e30, oy0 = 1e30, oz0 = 1e30, ox1 = -1e30, oy1 = -1e30, oz1 = -1e30;
    for (let i = 0; i < n * 3; i += 3) {
      const x = X[i], y = X[i + 1], z = X[i + 2];
      if (x < ox0) ox0 = x; if (x > ox1) ox1 = x; if (y < oy0) oy0 = y; if (y > oy1) oy1 = y; if (z < oz0) oz0 = z; if (z > oz1) oz1 = z;
    }
    if (ox1 < bx0 || ox0 > bx1 || oy1 < by0 || oy0 > by1 || oz1 < bz0 || oz0 > bz1) return;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, px = X[i3], py = X[i3 + 1], pz = X[i3 + 2];
      if (px < bx0 || px > bx1 || py < by0 || py > by1 || pz < bz0 || pz > bz1) continue;
      const ex = px - ocx, ey = py - ocy, ez = pz - ocz;
      if (ex * ex + ey * ey + ez * ez > reach2) continue;
      // the nearest particle of the other body (27 hash cells around) ...
      const gx = Math.floor(px / cell), gy = Math.floor(py / cell), gz = Math.floor(pz / cell);
      let best = -1, bd2 = search2;
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let az = -1; az <= 1; az++) {
        let j = head[(Math.imul(gx + ax, 73856093) ^ Math.imul(gy + ay, 19349663) ^ Math.imul(gz + az, 83492791)) & (HASH_SIZE - 1)];
        while (j >= 0) {
          const j3 = j * 3, dx = px - OX[j3], dy = py - OX[j3 + 1], dz = pz - OX[j3 + 2], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bd2) { bd2 = d2; best = j; }
          j = next[j];
        }
      }
      if (best < 0) continue;
      // ... and the closest point on the triangles around it
      let cd2 = 1e30, bt = -1;
      cpt[0] = px; cpt[1] = py; cpt[2] = pz;
      for (let k = vs[best], ke = vs[best + 1]; k < ke; k++) {
        const t = vl[k] * 3;
        closestOnTriP(OX, otris[t] * 3, otris[t + 1] * 3, otris[t + 2] * 3, cp, cpt);
        const dx = px - cp[0], dy = py - cp[1], dz = pz - cp[2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < cd2) { cd2 = d2; bt = t; cp[6] = cp[0]; cp[7] = cp[1]; cp[8] = cp[2]; cp[9] = cp[3]; cp[10] = cp[4]; cp[11] = cp[5]; }
      }
      if (bt < 0) continue;
      const ia = otris[bt] * 3, ib = otris[bt + 1] * 3, ic = otris[bt + 2] * 3;
      // the face normal (unit) of that triangle fixes the side: d is negative for a particle behind it
      const u1x = OX[ib] - OX[ia], u1y = OX[ib + 1] - OX[ia + 1], u1z = OX[ib + 2] - OX[ia + 2], u2x = OX[ic] - OX[ia], u2y = OX[ic + 1] - OX[ia + 1], u2z = OX[ic + 2] - OX[ia + 2];
      let tnx = u1y * u2z - u1z * u2y, tny = u1z * u2x - u1x * u2z, tnz = u1x * u2y - u1y * u2x;
      const tl = Math.sqrt(tnx * tnx + tny * tny + tnz * tnz) || 1; tnx /= tl; tny /= tl; tnz /= tl;
      const rx0 = px - cp[6], ry0 = py - cp[7], rz0 = pz - cp[8], dd = Math.sqrt(cd2);
      // which side of the surface p is on: the face normal when the closest point is inside the triangle, the pseudo-normal (the barycentric blend of the vertex normals) when it is on an
      // edge or a vertex. A particle beside a convex rim has its closest point ON the rim edge; the face normal of the triangle the search happened to meet is then not facing it
      // (measured: a split tuft's tip 0.12 m OUTSIDE the sibling read as 0.12 m inside it and was pulled in instead of pushed out: the halves came back together after the parting)
      let sgn: number;
      if (cp[9] > 1e-6 && cp[10] > 1e-6 && cp[11] > 1e-6) sgn = rx0 * tnx + ry0 * tny + rz0 * tnz >= 0 ? 1 : -1;
      else {
        const VNo = o.VN, w0_ = cp[9], w1_ = cp[10], w2_ = cp[11];
        const pnx = w0_ * VNo[ia] + w1_ * VNo[ib] + w2_ * VNo[ic], pny = w0_ * VNo[ia + 1] + w1_ * VNo[ib + 1] + w2_ * VNo[ic + 1], pnz = w0_ * VNo[ia + 2] + w1_ * VNo[ib + 2] + w2_ * VNo[ic + 2];
        sgn = rx0 * pnx + ry0 * pny + rz0 * pnz >= 0 ? 1 : -1;
      }
      const d = sgn * dd;
      if (d >= skin || d < -deep) continue;   // clear of it, or deeper than a frame can carry a particle (no direction to trust)
      let nx = tnx, ny = tny, nz = tnz;
      if (dd > 1e-9) { const s = sgn / dd; nx = rx0 * s; ny = ry0 * s; nz = rz0 * s; }
      const w0 = cp[9], w1 = cp[10], w2 = cp[11], sw2 = w0 * w0 + w1 * w1 + w2 * w2;
      let lam = (skin - d) / (1 + sw2 * ow);
      if (lam > PC_PUSH_MAX) lam = PC_PUSH_MAX;
      X[i3] += nx * lam; X[i3 + 1] += ny * lam; X[i3 + 2] += nz * lam;
      if (X[i3 + 1] < 0) X[i3 + 1] = 0;
      if (ow === 1) {
        let pl = lam * w0;
        OX[ia] -= nx * pl; OX[ia + 1] -= ny * pl; OX[ia + 2] -= nz * pl; if (OX[ia + 1] < 0) OX[ia + 1] = 0;
        pl = lam * w1;
        OX[ib] -= nx * pl; OX[ib + 1] -= ny * pl; OX[ib + 2] -= nz * pl; if (OX[ib + 1] < 0) OX[ib + 1] = 0;
        pl = lam * w2;
        OX[ic] -= nx * pl; OX[ic + 1] -= ny * pl; OX[ic + 2] -= nz * pl; if (OX[ic + 1] < 0) OX[ic + 1] = 0;
      }
      // inelastic along the normal, friction across it: the relative velocity at the contact point, shared like the push
      const ovx = w0 * OV[ia] + w1 * OV[ib] + w2 * OV[ic], ovy = w0 * OV[ia + 1] + w1 * OV[ib + 1] + w2 * OV[ic + 1], ovz = w0 * OV[ia + 2] + w1 * OV[ib + 2] + w2 * OV[ic + 2];
      const rvx = V[i3] - ovx, rvy = V[i3 + 1] - ovy, rvz = V[i3 + 2] - ovz, vn = rvx * nx + rvy * ny + rvz * nz;
      const vnn = vn < 0 ? vn : CONTACT_TACK * vn, tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz, ik = 1 / (1 + sw2 * ow);
      const ix = ik * (vnn * nx + CONTACT_MU * tx), iy = ik * (vnn * ny + CONTACT_MU * ty), iz = ik * (vnn * nz + CONTACT_MU * tz);
      V[i3] -= ix; V[i3 + 1] -= iy; V[i3 + 2] -= iz;
      if (ow === 1) {
        OV[ia] += w0 * ix; OV[ia + 1] += w0 * iy; OV[ia + 2] += w0 * iz;
        OV[ib] += w1 * ix; OV[ib + 1] += w1 * iy; OV[ib + 2] += w1 * iz;
        OV[ic] += w2 * ix; OV[ic + 1] += w2 * iy; OV[ic + 2] += w2 * iz;
      }
      contacts++;
      if (-vn > appr) appr = -vn;
      sx += px; sy += py; sz += pz; snx += nx; sny += ny; snz += nz; spen += lam;
    }
    this.cpContacts = contacts;
    if (contacts > 0) {
      // the bodies' relative velocity across the mean contact normal is damped (as for whole bodies) ...
      const nl = Math.sqrt(snx * snx + sny * sny + snz * snz);
      if (nl > 1e-9) {
        const mx = snx / nl, my = sny / nl, mz = snz / nl;
        const rvx = this.vcx - o.vcx, rvy = this.vcy - o.vcy, rvz = this.vcz - o.vcz, rn = rvx * mx + rvy * my + rvz * mz;
        const an = rn < 0 ? 0.5 * rn : 0;
        // CUT3 leg 3: an impact (closing faster than PIECE_IMPACT.v0) is shared by mass (momentum conserved): this body takes wT of the approach's half-share, the other wO; wT + wO = 2
        let wT = 1, wO = 1, wMT = 1, wMO = 1;
        if (ow === 1) {
          const mt = this.fracNow, mo = o.fracNow, tot = mt + mo;
          if (tot > 0) {
            const ratio = (mt > mo ? mt : mo) / (mt > mo ? mo : mt), u = (ratio - PIECE_IMPACT.ratio0) / (PIECE_IMPACT.ratio1 - PIECE_IMPACT.ratio0), sM = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
            const sI = rn < -PIECE_IMPACT.v0 ? Math.min(1, (-rn - PIECE_IMPACT.v0) / PIECE_IMPACT.span) : 0, sA = sI > sM ? sI : sM;
            wMT = 1 + (2 * mo / tot - 1) * sM; wMO = 1 + (2 * mt / tot - 1) * sM;
            wT = 1 + (2 * mo / tot - 1) * sA; wO = 1 + (2 * mt / tot - 1) * sA;
          }
        }
        // sliding across the contact: halved each frame (as for whole bodies) but a slow slide is STOPPED: static friction holds what gravity gains in one frame along the cap
        // (mu g cos(theta) dt, cos(theta) = |m_y| for a body lying on a slope). With only the halving a piece on a 40 degree cap crept at 0.1 to 0.24 m/s for ever (the gain of a frame, halved away)
        const ttx = rvx - rn * mx, tty = rvy - rn * my, ttz = rvz - rn * mz, ts = Math.sqrt(ttx * ttx + tty * tty + ttz * ttz);
        const hold = PC_STATIC_MU * 9.81 * (1 / 60) * (my < 0 ? -my : my);
        const tf = ts > 1e-9 ? Math.max(0.5 * CONTACT_MU_BODY, ts <= hold ? 0.5 : hold / (2 * ts)) : 0;   // each body takes this share of the relative sliding velocity (1/2 each = all of it)
        const tx = ttx * tf + an * mx, ty = tty * tf + an * my, tz = ttz * tf + an * mz;
        const sxs = ttx * tf, sys = tty * tf, szs = ttz * tf, axs = an * mx, ays = an * my, azs = an * mz;
        const txT = sxs * wMT + axs * wT, tyT = sys * wMT + ays * wT, tzT = szs * wMT + azs * wT, txO = sxs * wMO + axs * wO, tyO = sys * wMO + ays * wO, tzO = szs * wMO + azs * wO;
        // ... and a rigid share of the separation: the mean push, scaled by the number of contacts, at most PC_PUSH_MAX, vertical for a stack (CUT2 5.5 item 4)
        let rs = CONTACT_RIGID * spen / contacts * (contacts >= PC_SHOVE_FULL ? 1 : contacts / PC_SHOVE_FULL);
        if (rs > PC_PUSH_MAX) rs = PC_PUSH_MAX;
        let rx = mx * rs, ry = my * rs, rz = mz * rs;
        const vny = PIECE_CONTACT.vertNy; if (my > vny || my < -vny) { rx = 0; rz = 0; ry = my > 0 ? rs : -rs; }
        // the horizontal part of the separation belongs to the body the table does not hold (CUT2 P4/P8): the reaction on a body lying on the table is carried by the table's friction, but a position shove is
        // not (a 50 degree cut pushed the lower piece 0.2 m sideways, 17 mm/s for as long as the upper piece lay on it); the total relative separation is kept (hT + hO = 2)
        const dh = PIECE_CONTACT.asym ? this.supp - o.supp : 0, hT = 1 - dh, hO = 1 + dh;
        const rxT = rx * hT * wMT, rzT = rz * hT * wMT, rxO = rx * hO * wMO, rzO = rz * hO * wMO, ryT = ry * wMT, ryO = ry * wMO;
        if (ow === 1) {
          for (let i = 0; i < n * 3; i += 3) { V[i] -= txT; V[i + 1] -= tyT; V[i + 2] -= tzT; X[i] += rxT; X[i + 1] += ryT; X[i + 2] += rzT; if (X[i + 1] < 0) X[i + 1] = 0; }
          for (let i = 0; i < o.n * 3; i += 3) { OV[i] += txO; OV[i + 1] += tyO; OV[i + 2] += tzO; OX[i] -= rxO; OX[i + 1] -= ryO; OX[i + 2] -= rzO; if (OX[i + 1] < 0) OX[i + 1] = 0; }
          this.vcx -= txT; this.vcy -= tyT; this.vcz -= tzT; o.vcx += txO; o.vcy += tyO; o.vcz += tzO;
        } else {
          // o sleeps: it is a fixed support, this body takes the whole separation and the whole relative velocity
          const tx2 = tx * 2, ty2 = ty * 2, tz2 = tz * 2, rx2 = rx * 2, ry2 = ry * 2, rz2 = rz * 2;
          for (let i = 0; i < n * 3; i += 3) { V[i] -= tx2; V[i + 1] -= ty2; V[i + 2] -= tz2; X[i] += rx2; X[i + 1] += ry2; X[i + 2] += rz2; if (X[i + 1] < 0) X[i + 1] = 0; }
          this.vcx -= tx2; this.vcy -= ty2; this.vcz -= tz2;
        }
      }
      if (ow === 1) o.syncOutputs();
      if (appr > PIECE_LAND.minSpeed && this.gravityOn) { this.landT = PIECE_LAND.window; if (ow === 1 && o.capFlat) o.landT = PIECE_LAND.window; }   // CUT3 leg 3: an impact between pieces: both absorb their rebound
      const cs = o.contactSlot, slot = cs >= 0 && cs < MAX_SLOTS ? cs : MAX_SLOTS + (o.bodyId & (MAX_OTHERS - 1)), fresh = now - this.contactWith[slot] > BUMP_GAP;
      this.contactWith[slot] = now;
      this.markContact(o);
      if (fresh && appr > BUMP_MIN) {
        const ic = 1 / contacts;
        this.bumpWith(o);
        this.emit('bump', sx * ic, sy * ic, sz * ic, snx, sny, snz, appr / BUMP_NORM, 0, -1);   // normal: out of the other body
      }
    }
  }

  /** The triangles around each vertex (CSR), built once, for the closest point of a piece contact (CUT2 5.5). */
  private ensureTriLists(): void {
    if (this.vtStart !== null) return;
    const n = this.n, tris = this.tris, nt3 = tris.length;
    const st = new Int32Array(n + 1), list = new Int32Array(nt3);
    for (let k = 0; k < nt3; k++) st[tris[k] + 1]++;
    for (let i = 0; i < n; i++) st[i + 1] += st[i];
    const fill = new Int32Array(n);
    for (let k = 0; k < nt3; k++) { const v = tris[k]; list[st[v] + fill[v]++] = (k / 3) | 0; }
    this.vtList = list; this.vtStart = st;
  }

  /** CUT3 broad phase (broad.ts ContactPlanner): this body's bounding sphere into out[o .. o + 3] = centre x, y, z and the radius (the bound radius plus a quarter of its mean edge, the half of
   *  collide's contact skin that belongs to this body). A sleeping body's radius is measured once. */
  boundSphere(out: Float64Array, o: number): void {
    if (!(this.asleep && this.bRvalid)) { this.boundRadius(); this.bRvalid = this.asleep; }
    out[o] = this.center.x; out[o + 1] = this.center.y; out[o + 2] = this.center.z; out[o + 3] = this.bR + 0.25 * this.meanEdge;
  }

  /** Largest particle distance from the centre into this.bR (collide's broad phase; a field, not a return value: a double returned from a
   *  call that is not inlined is boxed). */
  private boundRadius(): void {
    const X = this.X, cx = this.center.x, cy = this.center.y, cz = this.center.z;
    let r2 = 0;
    for (let i = 0; i < this.n; i++) { const dx = X[i * 3] - cx, dy = X[i * 3 + 1] - cy, dz = X[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) r2 = d2; }
    this.bR = Math.sqrt(r2);
  }

  /** collide()'s per-frame data of THIS body, built once per substep index: area-weighted vertex normals and the particle hash. */
  private ensureContactData(): void {
    const now = this.subIdx;
    if (this.vnStamp === now && this.hashStamp === now) return;
    const X = this.X, VN = this.VN, tris = this.tris, n = this.n;
    VN.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      VN[a] += nx; VN[a + 1] += ny; VN[a + 2] += nz; VN[b] += nx; VN[b + 1] += ny; VN[b + 2] += nz; VN[c] += nx; VN[c + 1] += ny; VN[c + 2] += nz;
    }
    for (let i = 0; i < n * 3; i += 3) { const l = Math.sqrt(VN[i] * VN[i] + VN[i + 1] * VN[i + 1] + VN[i + 2] * VN[i + 2]) || 1; VN[i] /= l; VN[i + 1] /= l; VN[i + 2] /= l; }
    const head = this.hashHead, next = this.hashNext, cell = this.hashCell;
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const hk = (Math.imul(Math.floor(X[i * 3] / cell), 73856093) ^ Math.imul(Math.floor(X[i * 3 + 1] / cell), 19349663) ^ Math.imul(Math.floor(X[i * 3 + 2] / cell), 83492791)) & (HASH_SIZE - 1);
      next[i] = head[hk]; head[hk] = i;
    }
    this.vnStamp = now; this.hashStamp = now;
  }

  drainEvents(out: SoftEvent[]): void {
    for (let i = 0; i < this.events.length; i++) out.push(this.events[i]);
    this.events.length = 0;
  }

  stateHash(): number {
    let h = 0x811c9dc5 | 0;
    const X = this.X;
    for (let i = 0; i < X.length; i++) {
      h ^= Math.round(X[i] * 8192) | 0;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // ------------------------------------------------------------------------------------------------ internals

  /** Fill the ray scratch for rayMesh (small: inlined, so its arguments are never boxed). */
  private setRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Float64Array {
    const r = this.ray6;
    r[0] = ox; r[1] = oy; r[2] = oz; r[3] = dx; r[4] = dy; r[5] = dz;
    return r;
  }

  private hoverY(t: number): number {
    return this.restRadius + HOVER_ABOVE + BOB_AMP * Math.sin(2 * Math.PI * BOB_HZ * t + this.seedPhase);
  }

  private triNormal(a: number, b: number, c: number): [number, number, number] {
    const X = this.X;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2];
    const vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return [nx, ny, nz];
  }

  private vertexNormal(v: number): [number, number, number] {
    // outward direction of the rest shape rotated by the frame (cheap, always finite)
    const Q = this.Q;
    let x = Q[v * 3], y = Q[v * 3 + 1], z = Q[v * 3 + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    x /= l; y /= l; z /= l;
    const q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
  }

  private volumeScale(q: Float64Array): number {
    // S0 = sum_i w_i |grad_i V|^2 / (6 V0)^2 at the rest shape (translation-invariant, so rest-local coordinates are fine)
    const n = this.n, g = new Float64Array(n * 3), tris = this.tris;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const bcx = q[b + 1] * q[c + 2] - q[b + 2] * q[c + 1], bcy = q[b + 2] * q[c] - q[b] * q[c + 2], bcz = q[b] * q[c + 1] - q[b + 1] * q[c];
      const cax = q[c + 1] * q[a + 2] - q[c + 2] * q[a + 1], cay = q[c + 2] * q[a] - q[c] * q[a + 2], caz = q[c] * q[a + 1] - q[c + 1] * q[a];
      const abx = q[a + 1] * q[b + 2] - q[a + 2] * q[b + 1], aby = q[a + 2] * q[b] - q[a] * q[b + 2], abz = q[a] * q[b + 1] - q[a + 1] * q[b];
      g[a] += bcx; g[a + 1] += bcy; g[a + 2] += bcz;
      g[b] += cax; g[b + 1] += cay; g[b + 2] += caz;
      g[c] += abx; g[c + 1] += aby; g[c + 2] += abz;
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += this.invM[i] * (g[i * 3] * g[i * 3] + g[i * 3 + 1] * g[i * 3 + 1] + g[i * 3 + 2] * g[i * 3 + 2]);
    const v6 = 6 * this.restVolume;
    return s / (v6 * v6);
  }

  /** Tip radius and centre from the eased depth. `share` < 1 limits a pinch jaw to part of its depth range. */
  private placeTip(f: Finger, share: number): void {
    const R = this.restRadius;
    const dv = clamp(f.depth, 0, 1);
    // the tip grows toward its pressure radius at a limited speed: a sphere that swells by 0.1 m in 50 ms shoves the skin around it
    // sideways faster than the mesh can follow (a thin peak is split open and folds); it can shrink at once
    const rT = R * (FINGER.rMin + (FINGER.rMax - FINGER.rMin) * dv);
    f.tipR = rT <= f.tipR ? rT : Math.min(rT, f.tipR + FINGER.growRate * R * H);
    const s = dv * f.depthMax * share - f.tipR;
    f.cx = f.px + f.dx * s; f.cy = f.py + f.dy * s; f.cz = f.pz + f.dz * s;
    // A fingertip cannot go through the table, nor pinch the skin against it: a low side press, or a rub sliding down toward the table,
    // would otherwise squeeze the foot rim between the sphere and the table (the table always wins, so the rim buckled into a fold, held
    // at the fold limit while the tip stayed, and snapped past 150 degrees when it lifted). So the sphere's bottom stays
    // FINGER.tableGap rest radii up (about the rim's thickness).
    const floor = f.tipR + FINGER.tableGap * R;
    if (f.cy < floor) f.cy = floor;
  }

  /**
   * Advance finger depth (critically damped), slide and retract by one substep, then place the tips (pinch-safe).
   * The depth share of a tip (1 alone, FINGER.pinchShare as one jaw of a pinch) is EASED, never switched: a kinematic tip
   * must move continuously, or a finger landing / lifting would teleport the other tip by ~0.3 R in one substep and shove
   * the body (a normal two-finger release used to squeeze MORE for ~30 ms instead of springing back). A retracting tip
   * keeps the share it had, so lifting a finger is a pure depth retraction.
   */
  private updateFingers(): void {
    const w = FINGER.omega;
    const slide = 1 - Math.exp(-FINGER.slideRate * H);
    for (let k = 0; k < NSLOT; k++) {
      const f = this.fingers[k];
      f.ocx = f.cx; f.ocy = f.cy; f.ocz = f.cz;
      if (f.down) {
        const want = this.othersDown(k) ? FINGER.pinchShare : 1;
        f.share += (want - f.share) * (1 - Math.exp(-(want < f.share ? FINGER.shareIn : FINGER.shareOut) * H));
        const acc = w * w * (f.target - f.depth) - 2 * w * f.depthV;
        f.depthV += acc * H;
        // the tip never moves faster than FINGER.maxSpeed into the body (a full-pressure tap would ram the skin at ~6 m/s, 17 mm per substep),
        // scaled to the mesh resolution (this.tipSpeed)
        const vcap = this.tipSpeed / Math.max(1e-6, f.depthMax);
        if (f.depthV > vcap) f.depthV = vcap; else if (f.depthV < -vcap) f.depthV = -vcap;
        f.depth += f.depthV * H;
        if (f.depth < 0) { f.depth = 0; f.depthV = 0; } else if (f.depth > 1) { f.depth = 1; f.depthV = 0; }
        f.holdT += H;
        f.px += (f.tx - f.px) * slide; f.py += (f.ty - f.py) * slide; f.pz += (f.tz - f.pz) * slide;
        this.placeTip(f, f.share);
      } else if (f.retracting) {
        f.depth -= f.retractRate * H;
        if (f.depth <= 0) { f.depth = 0; f.retracting = false; }
        f.px += (f.tx - f.px) * slide; f.py += (f.ty - f.py) * slide; f.pz += (f.tz - f.pz) * slide;
        this.placeTip(f, f.share);
      }
    }
    // pinch: the two tips never overlap or pass through each other. The tip that moved gives way: each yields in proportion to how far
    // it moved this substep (a still tip next to a sliding one keeps its place; a symmetric pinch splits it evenly, as before). Splitting
    // it evenly always let a finger rubbing up to a HOLDING one shove that tip aside by up to ~0.4 R in one frame (over 15 m/s, far past
    // the speed cap), dragging its dent through the skin: in 120 000 frames of the sane-gesture fuzz (5 genomes x 4 seeds), episodes over
    // 120 deg with a finger down went from 8 to 1 with this.
    for (let i = 0; i < NSLOT - 1; i++) for (let j = i + 1; j < NSLOT; j++) this.pinchPair(this.fingers[i], this.fingers[j]);
  }

  /** The pinch rule for one pair of tips (see updateFingers): neither overlaps the other nor is pushed into the table gap. */
  private pinchPair(a: Finger, b: Finger): void {
    if ((a.down || a.retracting) && (b.down || b.retracting)) {
      let dx = b.cx - a.cx, dy = b.cy - a.cy, dz = b.cz - a.cz;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const minD = a.tipR + b.tipR + FINGER.pinchGap * this.restRadius;
      if (d < minD) {
        if (d < 1e-9) { dx = 1; dy = 0; dz = 0; d = 1; }
        const ma = Math.sqrt((a.cx - a.ocx) ** 2 + (a.cy - a.ocy) ** 2 + (a.cz - a.ocz) ** 2);
        const mb = Math.sqrt((b.cx - b.ocx) ** 2 + (b.cy - b.ocy) ** 2 + (b.cz - b.ocz) ** 2);
        const wa = ma + mb > 1e-12 ? ma / (ma + mb) : 0.5, push = (minD - d) / d, pa = push * wa, pb = push - pa;
        a.cx -= dx * pa; a.cy -= dy * pa; a.cz -= dz * pa;
        b.cx += dx * pb; b.cy += dy * pb; b.cz += dz * pb;
        // ...and neither is pushed into the table gap (see placeTip)
        const fa = a.tipR + FINGER.tableGap * this.restRadius, fb = b.tipR + FINGER.tableGap * this.restRadius;
        if (a.cy < fa) a.cy = fa;
        if (b.cy < fb) b.cy = fb;
      }
    }
  }

  /**
   * MAT CORRAL (params.matR0 ...): beyond the dead zone, brake the outward horizontal speed of the body and glide it back; past the rim,
   * remove the outward speed entirely and glide back faster (no teleport). Both act on every particle alike (a uniform velocity change
   * and a rigid translation of X, before the prediction: the substep's velocity (XP - X) / H and the table friction never see the
   * translation, so the body does not deform). The centre and its velocity are measured here from X and V (a nudge() since the last
   * substep is already in V), only once the caller's cheap test on the last substep's centre (10% margin) says the body may be outside
   * the dead zone. `rimOnly` (a finger is down but its tip touches nothing): only the rim bound acts. A pure function of the state:
   * deterministic.
   */
  private matCorral(rimOnly: boolean): void {
    const p = this.p;
    const n = this.n, X = this.X, V = this.V, M = this.M;
    let sx = 0, sz = 0, svx = 0, svz = 0;
    for (let i = 0; i < n; i++) { const m = M[i], i3 = i * 3; sx += m * X[i3]; sz += m * X[i3 + 2]; svx += m * V[i3]; svz += m * V[i3 + 2]; }
    // about the body's HOME (the origin for the play body; its spot for a body built `at` one: a mat squishy or a piece keeps its own dead
    // zone and rim around where it was put, instead of being glided into the play body's)
    // (PLAYGROUND setBounds: about the place area's EDGE instead, PG.boundsRim past it the rim: its signed distance and outward normal; the dead zone is the whole area)
    const im = 1 / this.Mtot;
    let ux = 0, uz = 0, out = 0, rim = false;
    if (this.bndShape < 0) {
      const cx = sx * im - this.homeX, cz = sz * im - this.homeZ;
      const r = Math.sqrt(cx * cx + cz * cz);
      if (!(r > p.matR0) || (rimOnly && !(r >= p.matRim))) return;
      ux = cx / r; uz = cz / r; rim = r >= p.matRim; out = r - p.matR0;
    } else {
      this.boundsAt(sx * im, sz * im);
      out = this.bq[0]; ux = this.bq[1]; uz = this.bq[2]; rim = out >= PG.boundsRim;
      if (!(out > 0) || (rimOnly && !rim)) return;
    }
    const w = rim ? 1 : smooth01(out / Math.max(1e-6, p.matRamp));
    const vr = (svx * ux + svz * uz) * im;
    // past the rim the outward speed is reflected softly (RIM_BOUNCE: the mat's soft rim bounces a tossed body back, B3); inside it, braked
    const dv = vr > 0 ? -(rim ? 1 + RIM_BOUNCE : Math.min(1, p.matBrake * w * H)) * vr : 0;
    // the glide never drops below 10% of its speed, so a body just outside the dead zone reaches its edge and STOPS there (a glide that
    // faded to zero at the edge crept forever: ~1 cm/s at 6 cm out); it never overshoots the edge; past the rim it is 4x faster
    const g = Math.min(p.matGlide * (rim ? 4 : w > 0.1 ? w : 0.1) * H, out);
    const dvx = dv * ux, dvz = dv * uz, gx = -g * ux, gz = -g * uz;
    for (let i = 0; i < n * 3; i += 3) { X[i] += gx; X[i + 2] += gz; V[i] += dvx; V[i + 2] += dvz; }
    this.vcx += dvx; this.vcz += dvz;
  }
  /** The place bounds' signed distance of (px, pz) from the area's edge (positive outside) and the outward normal there, into bq[0..2] (no doubles returned). */
  private boundsAt(px: number, pz: number): void {
    const q = this.bq, dx = px - this.bndCx, dz = pz - this.bndCz;
    if (this.bndShape === 0) {
      const r = Math.sqrt(dx * dx + dz * dz);
      q[0] = r - this.bndA; if (r > 1e-9) { q[1] = dx / r; q[2] = dz / r; } else { q[1] = 1; q[2] = 0; }
      return;
    }
    const rr = this.bndR, ax = Math.abs(dx) - (this.bndA - rr), az = Math.abs(dz) - (this.bndB - rr), sx = dx < 0 ? -1 : 1, sz = dz < 0 ? -1 : 1;
    if (ax > 0 && az > 0) { const l = Math.sqrt(ax * ax + az * az); q[0] = l - rr; q[1] = sx * ax / l; q[2] = sz * az / l; }
    else if (ax > az) { q[0] = ax - rr; q[1] = sx; q[2] = 0; }
    else { q[0] = az - rr; q[1] = 0; q[2] = sz; }
  }
  /** The cheap test before boundsCorral (the last substep's centre): within 5 cm of the edge or outside. */
  private nearBoundsEdge(): boolean { this.boundsAt(this.cx, this.cz); return this.bq[0] > -0.05; }

  /**
   * THIN-PART STRUTS (struts.ts): chords through the inside of the swirl-peak, one-sided. A strut shorter than params.strutMin of its rest
   * length is pushed back out to it (XPBD, compliance params.strutAlphaT, one Gauss-Seidel pass on XP); a longer one does nothing, so the
   * peak still bends, stretches and flops freely and only its walls are kept from collapsing onto each other.
   */
  private strutPass(): void {
    const XP = this.XP, invM = this.invM, S3 = this.S3, SL = this.SL, SW = this.SW, lim = this.p.strutMin, aS = this.p.strutAlphaT;
    for (let h = 0; h < this.ns; h++) {
      const c = S3[h * 2], d = S3[h * 2 + 1];
      const dx = XP[c] - XP[d], dy = XP[c + 1] - XP[d + 1], dz = XP[c + 2] - XP[d + 2];
      const lo = lim * SL[h], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= lo * lo) continue;
      const len = Math.sqrt(d2);
      if (len < 1e-9) continue;
      const sc = (lo - len) / ((SW[h] + aS) * len);
      const wc = invM[c / 3] * sc, wd = invM[d / 3] * sc;
      XP[c] += dx * wc; XP[c + 1] += dy * wc; XP[c + 2] += dz * wc;
      XP[d] -= dx * wd; XP[d + 1] -= dy * wd; XP[d + 2] -= dz * wd;
    }
  }

  /** The hinge barrier over every interior edge (see the header): one Gauss-Seidel pass on XP. */
  private hingePass(): void {
    const XP = this.XP, invM = this.invM;
    const H3 = this.H3, HD = this.HD, HW = this.HW, nh = this.nh, lim = this.hingeLim, aHg = this.hingeAlpha;
    for (let h = 0; h < nh; h++) {
      const c = H3[h * 2], d = H3[h * 2 + 1];
      const dx = XP[c] - XP[d], dy = XP[c + 1] - XP[d + 1], dz = XP[c + 2] - XP[d + 2];
      const lo = lim * HD[h], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= lo * lo) continue;          // (no square root for the ~all hinges that are open wide enough)
      const len = Math.sqrt(d2);
      if (len < 1e-9) continue;
      const sc = (lo - len) / ((HW[h] + aHg) * len);
      const wc = invM[c / 3] * sc, wd = invM[d / 3] * sc;
      XP[c] += dx * wc; XP[c + 1] += dy * wc; XP[c + 2] += dz * wc;
      XP[d] -= dx * wd; XP[d + 1] -= dy * wd; XP[d + 2] -= dz * wd;
    }
  }
  /**
   * CONTACT FOLD LIMIT. A fingertip sphere wider than a thin feature (the swirl-peak's tip is ~4 cm across, the tip 10-23 cm) forces
   * every vertex of that feature onto its own surface, and a pointed cone laid onto a sphere cap cannot keep its triangles in order: a
   * hard side shove at the peak folded neighbouring triangles flat onto each other (162-180 degrees for ~100 ms, at HEAD too). Neither the
   * speed of the tip, its friction nor the hinge barrier (which only sees two vertices pressed TOGETHER) prevented it. So, after both
   * contact projections, the interior edges with a vertex within FINGER.foldNear tip radii of a fingertip this substep are checked: where
   * the two triangles fold past FINGER.foldMaxDeg (normal dihedral), the two vertices opposite the edge are rotated apart about it,
   * symmetrically, to exactly that limit (a hard one-sided bending constraint); then the touched vertices are put back on the fingertip
   * surface. The two constraints disagree for a crushed cone, so they alternate FINGER.foldIters times (Gauss-Seidel): one pass alone left
   * the skin up to 4.7% R inside the tip, and a single re-seat undid most of the unfolding. Pinned feet are never moved and nothing goes
   * under the table. Only the particles and edges near a tip are visited (lists built by the collision pass), so it costs little.
   * TABLE EDGES (physics round-2 fix round): the table is a contact too. While a finger or a grab works the body, the particles on the table
   * (y < NEAR) join the list, so the foot rim gets the same limit: a body rubbed across the table drags its foot, and when the finger slid
   * off (f0b0s1z1, sane-gesture fuzz frame 2098) the rim edge on the table creased 137-142 degrees for 5 frames, 2.5 tip radii from the
   * tip, out of reach of the fingertip list. With table edges in the list that run peaks at 110 (the limit); a body at rest on the table,
   * with nothing touching it, does not pay for it.
   */
  private foldLimit(): void {
    const XP = this.XP, H3 = this.H3, HE = this.HE3, HP = this.HP, pn = this.pinned, now = this.subIdx;
    // the edges touching a near particle, each once
    const near = this.nearList, nc = this.tipNearN, hs = this.hingeStart, ho = this.hingeOf, hst = this.hingeStamp, hl = this.hingeList;
    let hc = 0;
    for (let k = 0; k < nc; k++) {
      const v = near[k];
      for (let j = hs[v], e = hs[v + 1]; j < e; j++) { const h = ho[j]; if (hst[h] !== now) { hst[h] = now; hl[hc++] = h; } }
    }
    this.hingeCount = hc;
    // (CUT2 5.3: each hinge has its own limit, 110 degrees for a hinge whose rest dihedral is up to 80 and the rest dihedral + 30 for a sharper one: the rim of a cut
    // face is 100 to 140 degrees AT REST. Half the smallest allowed interior angle, its cosine and sine, and the cosine of the whole angle come from the per-hinge
    // arrays filled by initRest; for every hinge of a whole body the values are the ones this function always computed.)
    const HCa = this.HC, HCHa = this.HCH, HSHa = this.HSH;
    const maxIt = this.lockN + this.grabCount() >= GRAB_TUNE.allFrom ? GRAB_TUNE.iters : FINGER.foldIters;   // (LOCK: with the whole skin in the limit, fewer passes: it is held at the limit and chased every substep)
    for (let it = 0; it < maxIt; it++) {
      this.debug.foldWork += hc;
      let opened = false, deep = false;
      for (let q = 0; q < hc; q++) {
        const h = hl[q], c = H3[h * 2], d = H3[h * 2 + 1], a = HE[h * 2], b = HE[h * 2 + 1];
        const ch = HCHa[h], sh = HSHa[h], cosMin = HCa[h], deepCos = cosMin + FOLD_DEEP;
        // edge direction e, and the parts of (c - a), (d - a) perpendicular to it: the two half-planes of the hinge
        let ex = XP[b] - XP[a], ey = XP[b + 1] - XP[a + 1], ez = XP[b + 2] - XP[a + 2];
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el < 1e-9) continue;
        ex /= el; ey /= el; ez /= el;
        let cx = XP[c] - XP[a], cy = XP[c + 1] - XP[a + 1], cz = XP[c + 2] - XP[a + 2];
        const tc = cx * ex + cy * ey + cz * ez;
        cx -= tc * ex; cy -= tc * ey; cz -= tc * ez;
        let dx = XP[d] - XP[a], dy = XP[d + 1] - XP[a + 1], dz = XP[d + 2] - XP[a + 2];
        const td = dx * ex + dy * ey + dz * ez;
        dx -= td * ex; dy -= td * ey; dz -= td * ez;
        const lc = Math.sqrt(cx * cx + cy * cy + cz * cz), ld = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // SLIVER (physics round-2 fix round): a triangle squeezed flat into a line (its opposite vertex within SLIVER of its rest height
        // from the edge) has no defined side, so it cannot be "unfolded"; it is put back open, on the far side of the edge from its
        // neighbour, at SLIVER of its rest height. (A free rim particle dragged past a pinned edge by a full pull of sticky stretch lay
        // exactly on the edge's line: 180 degrees to the fold meter for 47 frames.) Only at the TABLE (an edge with an end on it): under a
        // fingertip a thin cone squeezed onto the sphere has slivers by design, and opening them there creased the detail-4 swirl-peak
        // under the hard side shove (168 degrees; the probe's shove row, 0 frames over 120 without the rule there).
        if (XP[a + 1] < NEAR || XP[b + 1] < NEAR) {
          const sc = lc < SLIVER * HP[h * 2] && !pn[c / 3] && ld > 1e-9, sd = !sc && ld < SLIVER * HP[h * 2 + 1] && !pn[d / 3] && lc > 1e-9;
          if (sc || sd) {
            const v = sc ? c : d, tv = sc ? tc : td, lo = sc ? ld : lc, hmin = SLIVER * HP[h * 2 + (sc ? 0 : 1)];
            const ox = (sc ? dx : cx) / lo, oy = (sc ? dy : cy) / lo, oz = (sc ? dz : cz) / lo;
            XP[v] = XP[a] + tv * ex - ox * hmin; XP[v + 1] = XP[a + 1] + tv * ey - oy * hmin; XP[v + 2] = XP[a + 2] + tv * ez - oz * hmin;
            if (XP[v + 1] < 0) XP[v + 1] = 0;
            opened = true; deep = true;
            continue;
          }
        }
        if (lc < 1e-9 || ld < 1e-9) continue;
        const ucx = cx / lc, ucy = cy / lc, ucz = cz / lc, udx = dx / ld, udy = dy / ld, udz = dz / ld;
        const cdu = ucx * udx + ucy * udy + ucz * udz;
        if (cdu <= cosMin) continue;    // the interior angle is wide enough: not folded
        if (cdu > deepCos) deep = true;
        // bisector m of the two half-planes, and w: in their plane, perpendicular to m, toward c
        let mx = ucx + udx, my = ucy + udy, mz = ucz + udz;
        const ml = Math.sqrt(mx * mx + my * my + mz * mz);
        if (ml < 1e-9) continue;
        mx /= ml; my /= ml; mz /= ml;
        const um = ucx * mx + ucy * my + ucz * mz;
        let wx = ucx - mx * um, wy = ucy - my * um, wz = ucz - mz * um;
        let wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
        if (wl < 1e-9) { wx = ey * mz - ez * my; wy = ez * mx - ex * mz; wz = ex * my - ey * mx; wl = Math.sqrt(wx * wx + wy * wy + wz * wz); if (wl < 1e-9) continue; }
        wx /= wl; wy /= wl; wz /= wl;
        // c and d at the same distances from the edge, at +-half the minimum angle from the bisector ...
        const cyN = XP[a + 1] + tc * ey + lc * (my * ch + wy * sh), dyN = XP[a + 1] + td * ey + ld * (my * ch - wy * sh);
        let cFix = pn[c / 3] !== 0, dFix = pn[d / 3] !== 0;
        if (cFix && dFix) continue;
        if (!cFix && !dFix) { if (cyN < 0) cFix = true; else if (dyN < 0) dFix = true; }
        if (!cFix && !dFix) {
          opened = true;
          XP[c] = XP[a] + tc * ex + lc * (mx * ch + wx * sh); XP[c + 1] = cyN; XP[c + 2] = XP[a + 2] + tc * ez + lc * (mz * ch + wz * sh);
          XP[d] = XP[a] + td * ex + ld * (mx * ch - wx * sh); XP[d + 1] = dyN; XP[d + 2] = XP[a + 2] + td * ez + ld * (mz * ch - wz * sh);
        } else {
          // ... unless one of them cannot move (a pinned foot, or the table under it): then the OTHER turns the whole way, away from it.
          // (Physics round-2 fix round. Turning only half, or turning a vertex that lies flat on the table into the table, left a foot
          // triangle folded flat over its pinned neighbour on the table: 180 degrees at the trailing foot of a full pull.) In the exactly
          // flat case (both half-planes the same), the free vertex turns UP, off the table.
          opened = true;
          const fv = cFix ? d : c, tf = cFix ? td : tc, lf = cFix ? ld : lc;
          const ox = cFix ? ucx : udx, oy = cFix ? ucy : udy, oz = cFix ? ucz : udz;    // the fixed half-plane
          const fx0 = cFix ? udx : ucx, fy0 = cFix ? udy : ucy, fz0 = cFix ? udz : ucz;  // the free one
          const pf = fx0 * ox + fy0 * oy + fz0 * oz;
          let vx = fx0 - ox * pf, vy = fy0 - oy * pf, vz = fz0 - oz * pf;
          let vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (vl < 1e-6) { vx = ey * oz - ez * oy; vy = ez * ox - ex * oz; vz = ex * oy - ey * ox; vl = Math.sqrt(vx * vx + vy * vy + vz * vz); if (vy < 0) { vx = -vx; vy = -vy; vz = -vz; } }
          if (vl < 1e-9) continue;
          vx /= vl; vy /= vl; vz /= vl;
          const s2 = Math.sqrt(Math.max(0, 1 - cosMin * cosMin));
          XP[fv] = XP[a] + tf * ex + lf * (ox * cosMin + vx * s2); XP[fv + 1] = XP[a + 1] + tf * ey + lf * (oy * cosMin + vy * s2); XP[fv + 2] = XP[a + 2] + tf * ez + lf * (oz * cosMin + vz * s2);
          if (XP[fv + 1] < 0) XP[fv + 1] = 0;
        }
      }
      // back onto the fingertip surfaces (radially), never under the table
      for (let k = 0; k < NSLOT; k++) {
        const f = this.fingers[k];
        if (!f.down && !f.retracting) continue;
        const r = f.tipR, r2 = r * r, fx = f.cx, fy = f.cy, fz = f.cz;
        for (let q = 0; q < nc; q++) {
          const i = near[q];
          if (pn[i]) continue;
          const i3 = i * 3, dx = XP[i3] - fx, dy = XP[i3 + 1] - fy, dz = XP[i3 + 2] - fz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r2 || d2 < 1e-14) continue;
          const sc = r / Math.sqrt(d2);
          XP[i3] = fx + dx * sc; XP[i3 + 1] = fy + dy * sc; XP[i3 + 2] = fz + dz * sc;
          if (XP[i3 + 1] < 0) XP[i3 + 1] = 0;
        }
      }
      // nothing was folded this pass, or nothing by more than FOLD_DEEP: the re-seat above was the last thing to do (most substeps of a
      // press end here, after one pass)
      if (!opened || !deep) break;
    }
  }

  private updateGrabs(): void {
    const ease = 1 - Math.exp(-35 * H);
    const maxD = this.p.maxPull * this.restRadius;
    // B3: only a LONE hand picks the body up. While two fingers are on it (a pinch, a squish with a pull, a pull from both sides) a pull
    // past the limit stretches the body to its maximum and holds it to the mat, as it did before pick up existed (the owner: "squish two
    // sides and pull ... now it LIFTS the squishy"). The latch stays until every finger is up, so lifting one finger of a two-handed
    // stretch does not hoist the body by the other.
    // LOCK (LOCK.md rule 2): a locked lobe is a hand too. Two or more hands (a finger, a grab or a lock: a slot with both counts once) and the body is never picked up.
    let hands = this.lockN;
    for (let k = 0; k < NSLOT; k++) if (this.grabs[k].active || this.fingers[k].down) hands++;
    if (hands >= 2) this.twoHanded = true; else if (hands === 0) this.twoHanded = false;
    for (let k = 0; k < MAX_LOCKS; k++) { const L = this.locks[k]; if (L.active) L.holdT += H; }   // a lock keeps counting the hold since its grab (its target is frozen)
    for (let k = 0; k < NSLOT; k++) {
      const g = this.grabs[k];
      if (!g.active) continue;
      g.ramp = Math.min(1, g.ramp + H / 0.06);
      g.holdT += H;
      // GROUND FIX (LOCK.md section 4): on the table the hand is never asked for a point under it. A pull INTO the table folded 5 of 12 species to 180 degrees and turned twangle inside
      // out (the pointer's target went metres under the table; only a Shift pair had a floor, the shell's SHIFT_FLOOR_Y). The floor is on the raw target, so what the pick-up line and
      // the easing see is the reachable hand.
      this.reach(g);
      const grx = this.rch[0], gry = this.rch[1], grz = this.rch[2];
      g.ex += (grx - g.ex) * ease; g.ey += (gry - g.ey) * ease; g.ez += (grz - g.ez) * ease;
      // B3 PICK UP: a hand that asks for more than LIFT_OVER x the body's maxPull (the raw target, not the clamped one) unsticks the body from
      // the mat and carries it (on the table only; a floating body is already in the hand's reach)
      if (!this.carried && this.gravityOn && !this.twoHanded && this.lockN === 0) {
        const rx = grx - g.t0x, ry = gry - g.t0y, rz = grz - g.t0z, lim = LIFT_OVER * maxD;
        if (rx * rx + ry * ry + rz * rz > lim * lim) this.startCarry(k);
      }
      if (this.carried && k === this.carrier) {
        // the hand leads the carried body by at most maxPull (the body follows at a limited speed and never under the table: a far or a
        // fast target, or one under the table, stretched the grabbed patch metres out of the body and inverted it; the hostile fuzz)
        // GROUND FIX: ... and the hand never goes lower than where the carried body's centre sits at its rest height (a hand under that drags the grabbed patch through the body: it
        // squashed against the table, creased to 180 degrees and inverted twangle)
        const hfloor = this.restCenterY - this.carryOy;
        if (g.ey < hfloor) g.ey = hfloor;
        if (g.ey < GRAB_FLOOR_Y) g.ey = GRAB_FLOOR_Y;
        const hx = this.cx - this.carryOx, hy = this.cy - this.carryOy, hz = this.cz - this.carryOz;
        const lx = g.ex - hx, ly = g.ey - hy, lz = g.ez - hz, ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (ll > maxD) { const s = maxD / ll; g.ex = hx + lx * s; g.ey = hy + ly * s; g.ez = hz + lz * s; }
        // the hand's velocity (smoothed over ~40 ms): the throw
        const kv = 1 - Math.exp(-H / 0.04);
        this.hvx += ((g.ex - this.phx) / H - this.hvx) * kv; this.hvy += ((g.ey - this.phy) / H - this.hvy) * kv; this.hvz += ((g.ez - this.phz) / H - this.hvz) * kv;
        this.phx = g.ex; this.phy = g.ey; this.phz = g.ez;
        continue;   // a carried body is not clamped to its maxPull: the hand has it
      }
      // clamp the pull distance
      const dx = g.ex - g.t0x, dy = g.ey - g.t0y, dz = g.ez - g.t0z;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dl > maxD) { const s = maxD / dl; g.ex = g.t0x + dx * s; g.ey = g.t0y + dy * s; g.ez = g.t0z + dz * s; }
    }
  }

  /**
   * GROUND FIX: how deep may a hand push the patch INTO the body? Area-weighted outward normal of the anchor from the triangles around it, and the thickness of the body
   * behind it along that normal (a ray from the far side), like a fingertip's safe depth: cap = GRAB_TUNE.inFrac x squashDepth x thickness. A pull sideways or outward is not
   * limited by it. (Pulling the top of a body DOWN, into the table, folded 5 of 12 species to 180 degrees: the patch was dragged a metre through the body.)
   */
  private limitDepth(g: Grab, v: number): void {
    g.cap = -1;
    const X = this.X, tris = this.tris;
    let sx = 0, sy = 0, sz = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      if (a !== v && b !== v && c !== v) continue;
      const a3 = a * 3, b3 = b * 3, c3 = c * 3;
      const ux = X[b3] - X[a3], uy = X[b3 + 1] - X[a3 + 1], uz = X[b3 + 2] - X[a3 + 2], wx = X[c3] - X[a3], wy = X[c3 + 1] - X[a3 + 1], wz = X[c3 + 2] - X[a3 + 2];
      sx += uy * wz - uz * wy; sy += uz * wx - ux * wz; sz += ux * wy - uy * wx;
    }
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (!(sl > 1e-12)) return;
    const nx = sx / sl, ny = sy / sl, nz = sz / sl, R = this.restRadius, L = 8 * R;
    g.nx = nx; g.ny = ny; g.nz = nz;
    const ax = X[v * 3], ay = X[v * 3 + 1], az = X[v * 3 + 2];
    let T = 2 * R;
    if (rayMesh(X, tris, this.setRay(ax - nx * L, ay - ny * L, az - nz * L, nx, ny, nz), this.rayOut)) T = Math.max(0.3 * R, L - this.rayOut[0]);
    const cap = GRAB_TUNE.inFrac * this.p.squashDepth * T;
    g.cap = cap >= 0 && cap < 1e6 ? cap : -1;
  }
  /** GROUND FIX: the target the hand can actually reach, into rch: the raw target with its inward part (against the grab's normal) limited to g.cap, then lifted to GRAB_FLOOR_Y on the table. */
  private reach(g: Grab): void {
    const r = this.rch;
    let x = g.rx, y = g.ry, z = g.rz;
    if (g.cap >= 0) {
      const dn = (x - g.t0x) * g.nx + (y - g.t0y) * g.ny + (z - g.t0z) * g.nz;
      if (dn < -g.cap) { const s = -g.cap - dn; x += g.nx * s; y += g.ny * s; z += g.nz * s; }
    }
    if (this.gravityOn && y < GRAB_FLOOR_Y) y = GRAB_FLOOR_Y;
    r[0] = x; r[1] = y; r[2] = z;
  }
  /** Put the particles near every pulled or locked patch (rest distance from its anchor under GRAB_TUNE.zone x R) in the fold limit's list, and in the tip wake. */
  private grabZone(): void {
    const n = this.n, Q = this.Q, stamp = this.touchStamp, now = this.subIdx, near = this.nearList, tst = this.tipStamp;
    const held = this.lockN + this.grabCount();
    this.lastTipSub = now;
    // (only locks held, no pointer grab, nothing changed for GRAB_TUNE.still seconds: the shape is quasi-static, so the limit looks every other substep: it is the most expensive part of holding six lobes)
    if ((now & 1) !== 0 && held === this.lockN && this.simTime - this.gripChangeT > GRAB_TUNE.still) return;
    // (the whole skin stays in the limit for a new single pull that starts before the body has calmed down after a multi-lobe hold)
    if (held >= GRAB_TUNE.allFrom) this.gripAll = true; else if (this.gripAll && this.metrics.kinetic < GRAB_TUNE.calm) this.gripAll = false;
    this.gripWake = 0.75; this.gripCap = GRAB_TUNE.cap;
    if (this.gripAll) {
      // three or more lobes held at once: the skin BETWEEN the stretched lobes creased too, far from every patch: the whole skin is in the limit (every substep, or every other one: GRAB_TUNE.allEvery)
      if ((now % GRAB_TUNE.allEvery) === 0) for (let i = 0; i < n; i++) { tst[i] = now; if (stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; } }
      else for (let i = 0; i < n; i++) tst[i] = now;
      return;
    }
    const r2 = GRAB_TUNE.zone * GRAB_TUNE.zone * this.restRadius * this.restRadius;
    for (let k = 0; k < NSLOT + MAX_LOCKS; k++) {
      const g = k < NSLOT ? this.grabs[k] : this.locks[k - NSLOT];
      if (!g.active) continue;
      const a3 = g.anchor * 3, ax = Q[a3], ay = Q[a3 + 1], az = Q[a3 + 2];
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, dx = Q[i3] - ax, dy = Q[i3 + 1] - ay, dz = Q[i3 + 2] - az;
        if (dx * dx + dy * dy + dz * dz >= r2) continue;
        tst[i] = now;
        if (stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; }
      }
    }
  }
  /** The tail of a hold of several lobes: the whole skin stays in the contact fold limit until the body is calm (see GRAB_TUNE.calm), at most GRAB_TUNE.cap seconds. */
  private gripTail(): void {
    this.gripCap -= H;
    if (this.gripCap <= 0) { this.gripWake = 0; return; }
    this.gripWake -= H;
    if (this.gripWake < 0.3 && this.metrics.kinetic > GRAB_TUNE.calm) this.gripWake = 0.3;
    if (!this.gripAll) return;
    const n = this.n, stamp = this.touchStamp, now = this.subIdx, near = this.nearList, tst = this.tipStamp;
    this.lastTipSub = now;
    for (let i = 0; i < n; i++) { tst[i] = now; if (stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; } }
  }
  /** Is a finger other than `id` down (the pinch share of a tip)? */
  private othersDown(id: number): boolean {
    for (let k = 0; k < NSLOT; k++) if (k !== id && this.fingers[k].down) return true;
    return false;
  }
  /** The lowest grab slot other than `id` that holds a lobe, or -1. */
  private otherGrab(id: number): number {
    for (let k = 0; k < NSLOT; k++) if (k !== id && this.grabs[k].active) return k;
    return -1;
  }
  private grabCount(): number {
    let c = 0;
    for (let k = 0; k < NSLOT; k++) if (this.grabs[k].active) c++;
    return c;
  }
  private anyGrab(): boolean {
    for (let k = 0; k < NSLOT; k++) if (this.grabs[k].active) return true;
    return false;
  }
  /** Is a touch finger (slot 2 to 4) whose tip works the body touching it? */
  private extraTouch(): boolean {
    for (let k = 2; k < NSLOT; k++) { const f = this.fingers[k]; if ((f.down || f.retracting) && f.touching) return true; }
    return false;
  }
  /** The carry moved the body by shv: a lobe held by another hand (or a lock) keeps its pull relative to it (rest patch, reference and target move with the body). */
  private shiftGrab(o: Grab): void {
    if (!o.active) return;
    const mx = this.shv[0], my = this.shv[1], mz = this.shv[2];
    o.t0x += mx; o.t0y += my; o.t0z += mz; o.c0x += mx; o.c0y += my; o.c0z += mz;
    const p0 = o.p0;
    for (let j = 0; j < o.count * 3; j += 3) { p0[j] += mx; p0[j + 1] += my; p0[j + 2] += mz; }
  }
  /** Pull the Gaussian patch of a grab (or a lock) toward its hand: p0 + (eased target - target at the grab), applied after the internal constraints. */
  private pullPatch(g: Grab, XP: Float64Array): void {
    const px = g.ex - g.t0x, py = g.ey - g.t0y, pz = g.ez - g.t0z;
    const kg = 0.45 * g.ramp;
    for (let j = 0; j < g.count; j++) {
      const i3 = g.verts[j] * 3, w = g.weights[j] * kg;
      XP[i3] += (g.p0[j * 3] + px - XP[i3]) * w;
      XP[i3 + 1] += (g.p0[j * 3 + 1] + py - XP[i3 + 1]) * w;
      XP[i3 + 2] += (g.p0[j * 3 + 2] + pz - XP[i3 + 2]) * w;
    }
  }

  /**
   * LOCK (SoftBodyLike.lockGrab; _spec/LOCK.md): freeze the pull held on grab `slot` where it is. Only a FULLY stretched pull locks (pull level >= LOCK_MIN_PULL, the
   * level 'snap' would report), never a carried body, never beyond `maxLocks`. The grab's patch moves to a free lock, with its eased target frozen, its pull reference and
   * the hold time since the grab (which keeps counting); the grab slot is freed WITHOUT a 'snap' (nothing is let go: the lobe stays stretched) and the pinned feet stay
   * pinned. The lock is a hand for the twoHanded latch (updateGrabs).
   */
  lockGrab(slot: number): boolean {
    const g = this.grabs[slot];
    if (!g || !g.active) return false;
    if (this.lockN >= this.maxLocks) return false;
    let i = 0;
    while (i < MAX_LOCKS && this.locks[i].active) i++;
    if (i >= MAX_LOCKS) return false;
    // LOCK FIX: a body that was picked up (the drag went far past the line and the Shift tap came late) is put back first; any other carried body cannot lock
    if (this.carried && !this.putDownForLock(slot, g)) return false;
    let fl = false;
    if (this.pullLevel(g) < LOCK_MIN_PULL) {
      // FLOAT (shell verifier MAJOR-2): nothing is glued to the table and a floating body follows the hand, so pullLevel (which subtracts the centre's travel) reads 0.3 .. 0.8 for a lobe pulled
      // to the limit: the hand is at maxPull (the clamp is saturated) and the lobe is visibly stretched. That is "fully stretched" there. Its snap then reports at least LOCK_MIN_PULL.
      if (this.gravityOn || this.pinCount > 0 || this.pullLevel(g) < LOCK_FLOAT_MIN || this.handLevel(g) < LOCK_MIN_PULL) return false;
      fl = true;
    }
    let L = this.locks[i];
    if (L === IDLE_GRAB) { L = this.locks[i] = new Grab(this.n); settleDoubles(L, INT_FIELDS); }   // made on the first lock in this place; none for a body that never locks
    const c = g.count;
    L.verts.set(g.verts.subarray(0, c)); L.weights.set(g.weights.subarray(0, c)); L.p0.set(g.p0.subarray(0, c * 3));
    L.count = c; L.anchor = g.anchor;
    L.t0x = g.t0x; L.t0y = g.t0y; L.t0z = g.t0z; L.c0x = g.c0x; L.c0y = g.c0y; L.c0z = g.c0z;
    L.ex = g.ex; L.ey = g.ey; L.ez = g.ez; L.rx = g.ex; L.ry = g.ey; L.rz = g.ez;   // frozen: the eased target is the locked target
    L.ramp = 1; L.holdT = g.holdT; L.slot = slot; L.fl = fl;
    L.active = true; this.lockN++;
    g.active = false;
    this.gripChangeT = this.simTime;
    this.metrics.locked = this.lockN; this.metrics.grabbed = this.anyGrab();   // (at once: the shell reads them before the next step)
    return true;
  }

  /**
   * LOCK FIX (owner request 1, "Shift after a full hold does not lock"): the body was picked up by this lone hand (a drag past the pick-up line) and the player taps
   * Shift. A carried body has no stretched lobe to lock, so the lift is undone: the pose kept at startCarry comes back (positions, velocities, the glued feet, the centre), the hand's
   * eased target is held at the full pull from where the grab began, and lockGrab goes on as for any fully stretched pull. false (nothing changed) when this is not a lone hand's lift of this
   * slot, or when the pull the body had would not be full. No allocation.
   */
  private putDownForLock(slot: number, g: Grab): boolean {
    const X0 = this.liftX, V0 = this.liftV, P0 = this.liftPin;
    if (!this.liftOk || this.carrier !== slot || X0 === null || V0 === null || P0 === null) return false;
    let hands = this.lockN;
    for (let k = 0; k < NSLOT; k++) if (this.grabs[k].active || this.fingers[k].down) hands++;
    if (hands !== 1) return false;
    const maxD = this.p.maxPull * this.restRadius;
    let dx = g.ex - g.t0x, dy = g.ey - g.t0y, dz = g.ez - g.t0z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(dl > 1e-9)) return false;
    if (dl > maxD) { const s = maxD / dl; dx *= s; dy *= s; dz *= s; }
    const tk = this.liftPinCount > 0 ? 0 : 1;   // (as pullLevel: with the feet glued the base does not move)
    const px = dx - (this.liftCx - g.c0x) * tk, py = dy - (this.liftCy - g.c0y) * tk, pz = dz - (this.liftCz - g.c0z) * tk;
    if (Math.sqrt(px * px + py * py + pz * pz) < LOCK_MIN_PULL * maxD) return false;
    this.X.set(X0); this.V.set(V0); this.pinned.set(P0);
    this.pinCount = this.liftPinCount; this.pinHold = this.liftPinHold;
    this.cx = this.liftCx; this.cy = this.liftCy; this.cz = this.liftCz; this.vcx = this.liftVcx; this.vcy = this.liftVcy; this.vcz = this.liftVcz;
    this.carried = false; this.liftOk = false; this.hvx = 0; this.hvy = 0; this.hvz = 0;
    g.ex = g.t0x + dx; g.ey = g.t0y + dy; g.ez = g.t0z + dz;
    this.vnStamp = -1; this.hashStamp = -1;   // (the cached vertex normals and state hash were of the carried pose)
    this.metrics.carried = false;
    return true;
  }

  /** LOCK (SoftBodyLike.releaseLock): let a lock (or all) go. Each fires a 'snap' (heldFor = the whole hold since its grab, intensity = the pull level, finger = its slot). */
  releaseLock(index: number | 'all'): void {
    if (index === 'all') { for (let i = 0; i < MAX_LOCKS; i++) this.freeLock(i); return; }
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < MAX_LOCKS) this.freeLock(index);
  }
  private freeLock(i: number): void {
    const L = this.locks[i];
    if (!L.active) return;
    L.active = false; this.lockN--;
    this.gripChangeT = this.simTime;
    this.metrics.locked = this.lockN;
    let pl = this.pullLevel(L);
    if (L.fl && pl < LOCK_MIN_PULL) pl = LOCK_MIN_PULL;   // (a float lock was locked at its limit: it pays as the full pull it was)
    const v = L.anchor, X = this.X;
    if (this.lockN === 0 && !this.anyGrab()) this.pinHold = this.p.pinHold;   // the feet stay glued for the snap-back transient, as after a grab
    if (pl > 0.05) {
      const nrm = this.vertexNormal(v);
      this.emitLockSnap(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], pl, L.holdT, L.slot);
    }
  }
  /** A lock's 'snap' is never rate limited (releasing 5 locks at once must pay 5 pulls); the event buffer's own cap applies. */
  private emitLockSnap(x: number, y: number, z: number, nx: number, ny: number, nz: number, intensity: number, heldFor: number, finger: number): void {
    if (this.events.length >= 128) return;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.events.push({ kind: 'snap', at: { x, y, z }, normal: { x: nx / nl, y: ny / nl, z: nz / nl }, intensity: clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1), heldFor, finger });
  }

  /** LOCK (SoftBodyLike.lockAt): which lock's patch is the world point on, or -1: the nearest locked vertex within LOCK_REACH rest radii. No allocation. */
  lockAt(point: V3): number {
    if (!point || this.lockN === 0) return -1;
    const px = point.x, py = point.y, pz = point.z;
    if (!inWorld(px, py, pz)) return -1;
    const X = this.X, lim = LOCK_REACH * this.restRadius;
    let best = -1, bd = lim * lim;
    for (let k = 0; k < MAX_LOCKS; k++) {
      const L = this.locks[k];
      if (!L.active) continue;
      for (let j = 0; j < L.count; j++) {
        const i3 = L.verts[j] * 3, dx = X[i3] - px, dy = X[i3 + 1] - py, dz = X[i3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = k; }
      }
    }
    return best;
  }

  /**
   * B3: lift the body off the mat (the pinned feet let go) and carry it with the hand: from now on its centre follows the hand at the anchor's
   * rest distance (kinematic, CARRY_OMEGA, see substep) and gravity is the hand's to hold. grabRelease throws it with the hand's velocity.
   */
  private startCarry(k: number): void {
    const g = this.grabs[k];
    // LOCK FIX: keep the pose before the lift (lockGrab can put the body back); made on a body's first lift
    if (this.liftX === null) { this.liftX = new Float64Array(this.n * 3); this.liftV = new Float64Array(this.n * 3); this.liftPin = new Uint8Array(this.n); }
    this.liftX.set(this.X); this.liftV!.set(this.V); this.liftPin!.set(this.pinned);
    this.liftPinCount = this.pinCount; this.liftPinHold = this.pinHold; this.liftCx = this.cx; this.liftCy = this.cy; this.liftCz = this.cz;
    this.liftVcx = this.vcx; this.liftVcy = this.vcy; this.liftVcz = this.vcz; this.liftOk = true;
    this.carried = true; this.carrier = k;
    this.pinned.fill(0); this.pinCount = 0; this.pinHold = 0;
    const Q = this.Q, a = g.anchor, ql = Math.sqrt(Q[a * 3] ** 2 + Q[a * 3 + 1] ** 2 + Q[a * 3 + 2] ** 2);
    let ox = this.cx - g.ex, oy = this.cy - g.ey, oz = this.cz - g.ez;
    const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (ol > 1e-9) { const k = ql / ol; ox *= k; oy *= k; oz *= k; } else { ox = 0; oy = -ql; oz = 0; }
    this.carryOx = ox; this.carryOy = oy; this.carryOz = oz;
    this.phx = g.ex; this.phy = g.ey; this.phz = g.ez; this.hvx = 0; this.hvy = 0; this.hvz = 0;
  }

  private substep(): void {
    const n = this.n, X = this.X, XP = this.XP, V = this.V, M = this.M, invM = this.invM, Q = this.Q;
    const GOAL = this.GOAL, GRAD = this.GRAD;
    this.debug.substeps++;
    this.subIdx++;

    this.updateFingers();
    this.updateGrabs();
    const f0 = this.fingers[0], f1 = this.fingers[1];
    let nFingers = (f0.down ? 1 : 0) + (f1.down ? 1 : 0);
    let extra = false;   // LOCK: a touch finger (slot 2 to 4) is down or retracting; false on a computer, where everything below is the two-finger code of before
    for (let k = 2; k < NSLOT; k++) { const fx = this.fingers[k]; if (fx.down) nFingers++; if (fx.down || fx.retracting) extra = true; }
    const grabbing = this.anyGrab() || this.lockN > 0;   // (a locked lobe holds the body too)
    // MAT CORRAL (the cheap dead-zone test on the last substep's centre is done here, inline, so the call only happens outside it): off while
    // something HOLDS the body (a grab, the pinned feet, a fingertip touching it); while a finger is down but its tip touches nothing (the
    // body was shoved out from under it) only the rim acts, so a nudge cannot carry the body off the mat past a finger that is merely down
    const hdx = this.cx - this.homeX, hdz = this.cz - this.homeZ;   // (about the body's home: see matCorral)
    // (PLAYGROUND: off while scootTo glides the body, as for moveTo, and while a moving prop carries it: a rider is never corralled, D-91)
    // (a hop's glue and peel stay suspended for PG.hopSubs substeps AND until the body is back on a support: at 0.84 m/s ten substeps lift the foot ~2 cm, inside
    // the jelly's 2.5 cm tack layer, which pulled it back to the table: the jelly gel, water fill, firm silicone and pop dome hopped 1.2 cm instead of 3.2)
    if (this.hopLeft > 0) { if (this.hopLeft > 1 || this.nearCount > 0) this.hopLeft--; if (this.hopLeft === 0) this.glueK = 1; }
    if (this.gravityOn && !grabbing && !this.moveOn && !this.scootOn && !this.cyOn && !this.onMoving && this.pinCount === 0 && (this.bndShape < 0 ? hdx * hdx + hdz * hdz > this.p.matR0 * this.p.matR0 * 0.81 : this.nearBoundsEdge())) {
      const a0 = f0.down || f0.retracting, a1 = f1.down || f1.retracting;
      if (!(a0 && f0.touching) && !(a1 && f1.touching) && !(extra && this.extraTouch())) this.matCorral(a0 || a1 || extra);
    }

    // ---- moveTo (ceremony): a kinematic spring of the centre of mass. A rigid translation of X before the prediction (like the corral):
    // the substep's velocity and the table friction never see it, so the body slides without deforming and arrives without momentum.
    // On the table (gravity on) only the horizontal part acts: the table carries the height.
    if (this.moveOn) {
      const k = this.moveK, a = 1 - Math.exp(-MOVE_OMEGA * k * H), vmax = MOVE_VMAX * k * H;
      let mx = (this.mtx - this.cx) * a, my = this.gravityOn ? 0 : (this.mty - this.cy) * a, mz = (this.mtz - this.cz) * a;
      const ml = Math.sqrt(mx * mx + my * my + mz * mz);
      if (ml > vmax) { const r = vmax / ml; mx *= r; my *= r; mz *= r; }
      for (let i = 0; i < n * 3; i += 3) { X[i] += mx; X[i + 1] += my; X[i + 2] += mz; }
      this.cx += mx; this.cy += my; this.cz += mz;
    }
    // ---- PLAYGROUND scootTo (LIFE's travel): the same kind of rigid horizontal glide, eased, touch-gated, yielding to moveTo (scootStep)
    if (this.scootOn) this.scootStep();
    // ---- PLAYGROUND carryTo ("Go play with...", keyboard parity): a scripted arc, a rigid translation like the carry
    if (this.cyOn) this.carryToStep();

    // ---- B3 carry: the centre follows the hand (a rigid, critically damped translation of X before the prediction, like moveTo: the body
    // keeps its shape and gains no momentum from it; the throw sets the velocity at the release)
    if (this.carried) {
      const g = this.grabs[this.carrier];
      if (g.active) {
        // (never below its rest height: a hand target under the table carried the body INTO it, the table squashed it flat every substep
        // and it inverted; the hostile fuzz's far grabs, physics round 3)
        const a = 1 - Math.exp(-CARRY_OMEGA * H), ty = g.ey + this.carryOy, tyc = ty > this.restCenterY ? ty : this.restCenterY;
        let mx = (g.ex + this.carryOx - this.cx) * a, my = (tyc - this.cy) * a, mz = (g.ez + this.carryOz - this.cz) * a;
        const vmax = TOSS_MAX * 2 * H, ml = Math.sqrt(mx * mx + my * my + mz * mz);
        if (ml > vmax) { const r = vmax / ml; mx *= r; my *= r; mz *= r; }
        for (let i = 0; i < n * 3; i += 3) { X[i] += mx; X[i + 1] += my; X[i + 2] += mz; }
        this.cx += mx; this.cy += my; this.cz += mz;
        // the OTHER hand (if it holds a lobe too) keeps its pull relative to the carried body: its rest patch and reference move with it, so
        // its maxPull clamp still applies (unclamped, it stretched the body 3 R across the room and inverted it: the hostile fuzz's two grabs)
        this.shv[0] = mx; this.shv[1] = my; this.shv[2] = mz;
        for (let j = 0; j < NSLOT; j++) if (j !== this.carrier) this.shiftGrab(this.grabs[j]);
        for (let j = 0; j < MAX_LOCKS; j++) this.shiftGrab(this.locks[j]);
      }
    }

    // ---- external acceleration + predict
    // SUPPORTED-BODY GRAVITY. With one XPBD pass per substep a soft network cannot carry the weight of 640 particles
    // down to a small contact patch (the load path is longer than the solver reaches in a frame), so a body at rest
    // would sag and creep. Real squishies barely sag under their own weight, so while the foot is on the table the
    // table is treated as carrying the weight of the body as a whole: gravity is faded out by `supp` (0 airborne,
    // 1 resting). That leaves every deformation, finger load and impact to the constraints but makes rest exact.
    // Friction still sees the true normal load (see the table pass).
    let ax = 0, ay = 0, az = 0;
    if (this.gravityOn) {
      // ... but only while the body's own shape stands on the table: the table carries a body, it never holds one up. When the lowest point of
      // the shape-matching goal (the shape the body is being pulled into, around its current centre) rises above the table, the body is being
      // lifted off its feet by its own springing back, and its weight acts (fully once the goal floats GOAL_FLOAT R up). Position-based, so it
      // is conservative: a wobble on the foot keeps its energy (a velocity-gated version, 'gravity only while rising above rest', took
      // energy out of every cycle and killed the starter's wobble: n_osc 1). It is what stops a squeezed MEMORY body (its goal is still the
      // squashed shape, which no longer reaches the table) from springing its centre up and hovering off the table (crumbit, beads, 28-36 mm).
      // (Physics round-2 fix round, MAJOR-3; the peel damping in the tack pass is the other half.)
      // (PLAYGROUND: the goal's float is measured from the lowest support, the table at 0 or a prop face (propMinY is 0 with no world); a hop's first substeps
      // feel their whole weight (glueK 0); on a support tilted past PG.tiltCos only gravity's part along the support's normal is carried, the rest pulls it downhill)
      const gu = (this.goalBottom - this.propMinY) / (GOAL_FLOAT * this.restRadius), gf = gu <= 0 ? 0 : gu >= 1 ? 1 : gu * gu * (3 - 2 * gu);
      const se = this.supp * (1 - gf) * this.glueK;
      this.suppEff = se;
      ay = this.carried || this.cyOn ? 0 : -GRAVITY * (1 - se);   // a carried body: the hand holds its weight (carryTo: the arc does)
      if (this.tiltOn && !this.carried && !this.cyOn) { const k = GRAVITY * se * this.tny; ax = k * this.tnx; ay = -GRAVITY + k * this.tny; az = k * this.tnz; }
    } else {
      // float mode: weak hover spring on the centre of mass (stiffer while a finger or a lobe holds it) + slow bob
      const boost = 1 + 2.5 * nFingers + (grabbing ? 3 : 0);
      const w2 = HOVER_OMEGA * HOVER_OMEGA * boost, c = 2 * HOVER_ZETA * HOVER_OMEGA * Math.sqrt(boost);
      // the bob of hoverY(), written out: substep() is too large for the optimiser to inline into, so a call passing and returning
      // a double would box both (two HeapNumbers per substep)
      const hy = this.restRadius + HOVER_ABOVE + BOB_AMP * Math.sin(2 * Math.PI * BOB_HZ * this.simTime + this.seedPhase);
      ax = -w2 * this.cx - c * this.vcx;
      ay = -w2 * (this.cy - hy) - c * this.vcy;
      az = -w2 * this.cz - c * this.vcz;
    }
    if (this.holdOn) { ax += this.holdAx; ay += this.holdAy; az += this.holdAz; }   // D-95 AUTO: a rider holds on (propPass)
    const hax = ax * H, hay = ay * H, haz = az * H;
    for (let i = 0; i < n * 3; i += 3) {
      const vx = V[i] + hax, vy = V[i + 1] + hay, vz = V[i + 2] + haz;
      V[i] = vx; V[i + 1] = vy; V[i + 2] = vz;
      XP[i] = X[i] + vx * H; XP[i + 1] = X[i + 1] + vy * H; XP[i + 2] = X[i + 2] + vz * H;
    }

    // ---- shape matching (global): c, A = sum m p q^T, R, goals, soft pull
    let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
    let gbOut = 0;
    {
      let sx = 0, sy = 0, sz = 0;
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
      // CUT2 5.4 (found by P5's gate rows): while a neck forms the best-fit rotation is extracted against the NECKED goal, as 5.7 does for a morph. Against the rest shape the matrix
      // A = sum m p q^T of a body sitting at the necked goal is R S I_Q (S the pinch, I_Q the rest shape's second moment): a product of two symmetric matrices that do not commute for
      // a plane that is not along the rest shape's own axes, so its polar rotation is turned by tens of degrees (measured at the swap: 23 to 156 degrees, the body lifted by up to 0.3 m)
      const QF = this.neckOn && NECK_FIT.goal ? this.QG : Q;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, m = M[i];
        const mx = m * XP[i3], my = m * XP[i3 + 1], mz = m * XP[i3 + 2];
        const qx = QF[i3], qy = QF[i3 + 1], qz = QF[i3 + 2];
        sx += mx; sy += my; sz += mz;
        a00 += mx * qx; a01 += mx * qy; a02 += mx * qz;
        a10 += my * qx; a11 += my * qy; a12 += my * qz;
        a20 += mz * qx; a21 += mz * qy; a22 += mz * qz;
      }
      const cx = sx / this.Mtot, cy = sy / this.Mtot, cz = sz / this.Mtot;
      this.cx = cx; this.cy = cy; this.cz = cz;
      const A = this.A9;
      A[0] = a00; A[1] = a01; A[2] = a02; A[3] = a10; A[4] = a11; A[5] = a12; A[6] = a20; A[7] = a21; A[8] = a22;
      const q = this.qr;
      extractRotation(A, q, SM_ITERS);
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
      r00 = 1 - 2 * (yy + zz); r01 = 2 * (xy - wz); r02 = 2 * (xz + wy);
      r10 = 2 * (xy + wz); r11 = 1 - 2 * (xx + zz); r12 = 2 * (yz - wx);
      r20 = 2 * (xz - wy); r21 = 2 * (yz + wx); r22 = 1 - 2 * (xx + yy);
      // jam (bead jamming, foam densification): stiffness x (1 + 6 jam c^2), c = the compression of the last frame. Computed for every body
      // (jamK = 0 gives exactly smK) because a value reassigned in a branch of this function is boxed (one HeapNumber per substep)
      const cj = this.prevCompression, w2j = this.smW2 * (1 + this.jamK * cj * cj), K = w2j / (1 + w2j);
      const soft = this.softW, QG = this.goalOn ? this.QG : Q;
      // slosh mode (liquid, beads): the shell's goal bulges along the liquid's offset s, 3 mu (s . n) n (an odd field: no net shift)
      const slK = this.sloshOn ? 3 * this.mat.sloshMass : 0, NRM = this.NRM, slx = this.slx, sly = this.sly, slz = this.slz;
      // ... minus its mass-weighted mean (R NN R^T s, NN = mean of n n^T at rest): on a lopsided body (fins, a tail) the raw field moved the
      // centre of mass with s, the shell's acceleration drove s again and the slosh pumped itself up (kinetic 0.77 two seconds after a press)
      let smx = 0, smy = 0, smz = 0;
      if (slK !== 0) {
        const N9 = this.NN;
        const bx = r00 * slx + r10 * sly + r20 * slz, by = r01 * slx + r11 * sly + r21 * slz, bz = r02 * slx + r12 * sly + r22 * slz;   // R^T s
        const ux = N9[0] * bx + N9[1] * by + N9[2] * bz, uy = N9[3] * bx + N9[4] * by + N9[5] * bz, uz = N9[6] * bx + N9[7] * by + N9[8] * bz;
        smx = slK * (r00 * ux + r01 * uy + r02 * uz); smy = slK * (r10 * ux + r11 * uy + r12 * uz); smz = slK * (r20 * ux + r21 * uy + r22 * uz);
      }
      let gb = Infinity;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const qx_ = QG[i3], qy_ = QG[i3 + 1], qz_ = QG[i3 + 2];
        let gx = cx + r00 * qx_ + r01 * qy_ + r02 * qz_;
        let gy = cy + r10 * qx_ + r11 * qy_ + r12 * qz_;
        let gz = cz + r20 * qx_ + r21 * qy_ + r22 * qz_;
        if (slK !== 0) {
          const nx = r00 * NRM[i3] + r01 * NRM[i3 + 1] + r02 * NRM[i3 + 2], ny = r10 * NRM[i3] + r11 * NRM[i3 + 1] + r12 * NRM[i3 + 2], nz = r20 * NRM[i3] + r21 * NRM[i3 + 1] + r22 * NRM[i3 + 2];
          const d = slK * (nx * slx + ny * sly + nz * slz);
          gx += nx * d - smx; gy += ny * d - smy; gz += nz * d - smz;
        }
        GOAL[i3] = gx; GOAL[i3 + 1] = gy; GOAL[i3 + 2] = gz;
        if (gy < gb) gb = gy;
        const k = K * soft[i];
        XP[i3] += (gx - XP[i3]) * k; XP[i3 + 1] += (gy - XP[i3 + 1]) * k; XP[i3 + 2] += (gz - XP[i3 + 2]) * k;
      }
      gbOut = gb;
    }
    this.goalBottom = gbOut;   // (assigned once, outside the block: a double reassigned in a branch of this function is boxed)

    // ---- Laplacian shape memory (local): pull each particle toward mean(neighbours) + R (q_i - mean(q_neighbours))
    // (every other substep with twice the gain: it is a soft smoothing term and this saves ~8% of the step)
    if ((this.subIdx & 1) === 0) {
      const bk = this.bendK * 2, soft = this.softW, st = this.nbrStart, nb = this.nbrIdx, ni = this.nbrInv, LQ = this.goalOn ? this.LQG : this.LQ, ih = this.invH;
      const lo = this.p.creaseLo, hi = this.p.creaseHi, boost = this.p.creaseGain, bf = this.p.bendFloor, span = 1 / Math.max(1e-6, hi - lo);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        let mx = 0, my = 0, mz = 0;
        for (let j = st[i], e = st[i + 1]; j < e; j++) { const k = nb[j] * 3; mx += XP[k]; my += XP[k + 1]; mz += XP[k + 2]; }
        const inv = ni[i];
        const lx = LQ[i3], ly = LQ[i3 + 1], lz = LQ[i3 + 2];
        const rx = mx * inv + r00 * lx + r01 * ly + r02 * lz - XP[i3];
        const ry = my * inv + r10 * lx + r11 * ly + r12 * lz - XP[i3 + 1];
        const rz = mz * inv + r20 * lx + r21 * ly + r22 * lz - XP[i3 + 2];
        // crease / fold detector: a residual of a good fraction of an edge length is not a smooth bend. There the gain ramps up
        // to the unsoftened body gain (x boost), so a flap is pulled back out even in the floppy peak.
        const res = Math.sqrt(rx * rx + ry * ry + rz * rz) * ih[i];
        let a = (res - lo) * span;
        a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
        const sb = soft[i] > bf ? soft[i] : bf;
        const k = Math.min(0.9, bk * (sb + (boost - sb) * a));
        XP[i3] += rx * k; XP[i3 + 1] += ry * k; XP[i3 + 2] += rz * k;
      }
    }

    // ---- enclosed-volume constraint (one global XPBD multiplier)
    {
      const tris = this.tris, nt = this.nt;
      const ox = this.cx, oy = this.cy, oz = this.cz;
      GRAD.fill(0);
      let vol6 = 0;
      for (let t = 0; t < nt; t++) {
        const t3 = t * 3;
        const a = tris[t3] * 3, b = tris[t3 + 1] * 3, c = tris[t3 + 2] * 3;
        const ax_ = XP[a] - ox, ay_ = XP[a + 1] - oy, az_ = XP[a + 2] - oz;
        const bx = XP[b] - ox, by = XP[b + 1] - oy, bz = XP[b + 2] - oz;
        const cx = XP[c] - ox, cy = XP[c + 1] - oy, cz = XP[c + 2] - oz;
        const bcx = by * cz - bz * cy, bcy = bz * cx - bx * cz, bcz = bx * cy - by * cx;
        vol6 += ax_ * bcx + ay_ * bcy + az_ * bcz;
        GRAD[a] += bcx; GRAD[a + 1] += bcy; GRAD[a + 2] += bcz;
        GRAD[b] += cy * az_ - cz * ay_; GRAD[b + 1] += cz * ax_ - cx * az_; GRAD[b + 2] += cx * ay_ - cy * ax_;
        GRAD[c] += ay_ * bz - az_ * by; GRAD[c + 1] += az_ * bx - ax_ * bz; GRAD[c + 2] += ax_ * by - ay_ * bx;
      }
      const v6 = 6 * this.restVolume;
      // volume target: V* = vt (air bleed, P1) x (1 + burst)^3 (burstOpen's overshoot is a bigger body, not a stretched one)
      const bsc = 1 + this.burstO;
      const C = (vol6 - v6 * this.vt * bsc * bsc * bsc * this.volScale) / v6;   // (x the setFrac scale, CUT)
      // Blocked particles (inside a fingertip's reach or touching the table) cannot absorb pressure: zero inverse mass.
      const WV = this.WV;
      const a0 = f0.down || f0.retracting, a1 = f1.down || f1.retracting;
      const r0 = f0.tipR + BLOCK_MARGIN, r1 = f1.tipR + BLOCK_MARGIN;
      let S = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        let w = invM[i];
        if (XP[i3 + 1] < NEAR) w = 0;
        else {
          if (a0) { const dx = XP[i3] - f0.cx, dy = XP[i3 + 1] - f0.cy, dz = XP[i3 + 2] - f0.cz; if (dx * dx + dy * dy + dz * dz < r0 * r0) w = 0; }
          if (a1) { const dx = XP[i3] - f1.cx, dy = XP[i3 + 1] - f1.cy, dz = XP[i3 + 2] - f1.cz; if (dx * dx + dy * dy + dz * dz < r1 * r1) w = 0; }
          if (extra) for (let k = 2; k < NSLOT; k++) {
            const fx = this.fingers[k];
            if (!fx.down && !fx.retracting) continue;
            const rx = fx.tipR + BLOCK_MARGIN, dx = XP[i3] - fx.cx, dy = XP[i3 + 1] - fx.cy, dz = XP[i3 + 2] - fx.cz;
            if (dx * dx + dy * dy + dz * dz < rx * rx) w = 0;
          }
        }
        WV[i] = w;
        S += w * (GRAD[i3] * GRAD[i3] + GRAD[i3 + 1] * GRAD[i3 + 1] + GRAD[i3 + 2] * GRAD[i3 + 2]);
      }
      S /= v6 * v6;
      // bottom-out of the air bleed (below; db = 0 for an incompressible family, so aEff = volAlphaT exactly). No branch-reassigned doubles
      // in this function: they are boxed (measured 2 HeapNumbers per substep for every compressible family)
      const vNow = vol6 / v6, vf = this.volFloor;
      const xb = Math.min(1, Math.max(0, (vf + 0.12 - vNow) / 0.14)), db = xb * xb * (3 - 2 * xb) * this.bleedF;
      // (and while a neck forms, CUT: the pinch moves the goal fast, and a compressible family's soft constraint let 7-20% of the volume go
      // in a 0.25 s pinch; the neck stiffens it toward the bottom-out value with t, never softens it)
      const dd = Math.max(db, this.volNeck), aEff = Math.min(this.volAlphaT, this.volAlphaT * (1 - dd) + 0.5 * this.volS0 * dd) * (1 + (GRAB_TUNE.volK - 1) * (this.lockN + this.grabCount() >= 2 ? 1 : 0));   // (LOCK: several lobes held at once: a stiffer volume; no int / double ternary: it would box)
      if (this.bleedOn) {
        // AIR BLEED (SQUISHY_SCIENCE 3.2): while something loads the body its volume target falls toward the squeezed volume (air leaves,
        // with volOutTau), and always returns toward 1 (air comes back through the skin, volInTau): the constraint holds the body at V*, so it
        // cannot re-inflate faster than air returns (the slow rise). Near the floor the spring stiffens back to incompressible (bottom-out).
        const vo = (a0 || a1 || extra || grabbing) && vNow < this.vt - 0.003 ? this.volOutK : 0;   // air leaves only while loaded
        const v1 = this.vt + (Math.max(vNow, vf) - this.vt) * vo;
        this.vt = Math.min(1, Math.max(vf, v1 + (1 - v1) * this.volInK));
      }
      const sc = (-C / (S + aEff)) / v6;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, s = sc * WV[i];
        XP[i3] += GRAD[i3] * s; XP[i3 + 1] += GRAD[i3 + 1] * s; XP[i3 + 2] += GRAD[i3 + 2] * s;
      }
    }

    // ---- edge distance constraints (Gauss-Seidel, 1 pass)
    {
      const E3 = this.E3, EL = this.EL, ES = this.ESOFT, EWA = this.EWA, EWB = this.EWB, EWS = this.EWS, ne = this.ne;
      const aT = this.p.edgeAlphaT, aH = aT * this.p.edgeHarden;
      for (let e = 0; e < ne; e++) {
        const a = E3[e * 2], b = E3[e * 2 + 1];
        const dx = XP[a] - XP[b], dy = XP[a + 1] - XP[b + 1], dz = XP[a + 2] - XP[b + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-12) continue;
        const C = len - EL[e];
        const s = -C / ((EWS[e] + (C > ES[e] ? aH : aT)) * len);
        const sa = s * EWA[e], sb = s * EWB[e];
        XP[a] += dx * sa; XP[a + 1] += dy * sa; XP[a + 2] += dz * sa;
        XP[b] -= dx * sb; XP[b + 1] -= dy * sb; XP[b + 2] -= dz * sb;
      }
    }

    // ---- hinge barrier: the two vertices opposite an interior edge must not be pressed together (that is a flap folded onto itself)
    if (this.p.hingeLimit > 0) this.hingePass();
    // ---- thin-part struts: the walls of the swirl-peak are not pressed onto each other (one-sided, see strutPass)
    // (and not while a neck forms: the struts across the waist held the walls apart against the pinch, and the skin between them buckled,
    // 178-180 degrees on tadpolo and glimglop once the neck was held at t = 1)
    if (this.ns > 0 && this.p.strutMin > 0 && this.fold < 0.01 && this.burstO < 0.01 && !(this.neckOn && this.neckT > 0.02)) this.strutPass();

    // ---- grab attachments (applied after the internal constraints so the user's hand wins within the substep)
    for (let k = 0; k < NSLOT; k++) { const g = this.grabs[k]; if (g.active) this.pullPatch(g, XP); }
    for (let k = 0; k < MAX_LOCKS; k++) { const g = this.locks[k]; if (g.active) this.pullPatch(g, XP); }   // LOCK: the pointer left, the target stays

    // ---- collisions: finger spheres, then the table (the table always wins)
    this.tipNearN = 0;
    let fingerDown = 0;   // mass-weighted downward push of the fingertips this substep: extra normal load on the table
    let react = 0;        // mass-weighted penetration the fingertips corrected this substep (metrics.reaction)
    for (let k = 0; k < NSLOT; k++) {
      const f = this.fingers[k];
      if (!f.down && !f.retracting) continue;
      const r = f.tipR, r2 = r * r, cx = f.cx, cy = f.cy, cz = f.cz;
      const fdx = cx - f.ocx, fdy = cy - f.ocy, fdz = cz - f.ocz;   // how far the tip itself moved this substep
      // static / kinetic friction: skin that would slip under the tip by more than friction x penetration this substep is sliding, and
      // is only held back by the kinetic coefficient, which takes over as the tip itself slides sideways (across its travel direction:
      // a press moves the tip only along it). See FINGER.frictionKinetic.
      // TACK NEEDS DWELL (physics round-2 fix round, MAJOR-1): a sticky family grips a fingertip that rests on it (fingerFriction up to
      // 1.8x the gel's), but adhesion builds with contact time, and a sliding tip gives none. So while the tip slides, the static grip
      // falls back to the gel's (FINGER.friction) and the kinetic drag to the gel's FINGER.frictionKinetic (never above a family's own),
      // scaled down for a family softer than the gel (kinSoft). With the tack kept on a rubbing tip, slime bulldozed its lower flank into
      // 167-179 degree wrinkles (wrigglo, 2.5 m/s rubs: 109 frames over 120 in one rub); with the gel's grip, 0.
      const muF = this.p.fingerFriction, muG = Math.min(muF, FINGER.friction);
      const al = fdx * f.dx + fdy * f.dy + fdz * f.dz;
      const lx = fdx - al * f.dx, ly = fdy - al * f.dy, lz = fdz - al * f.dz;
      const slu = Math.min(1, Math.sqrt(lx * lx + ly * ly + lz * lz) / (H * FINGER.frictionSlide * this.restRadius)), sls = slu * slu * (3 - 2 * slu);
      const muS = muF + (muG - muF) * sls, muK = muF + (FINGER.frictionKinetic * (muG / FINGER.friction) * this.kinSoft - muF) * sls;
      let hit = false;
      const rn2 = r2 * FINGER.foldNear * FINGER.foldNear, stamp = this.touchStamp, now = this.subIdx, near = this.nearList, tst = this.tipStamp;
      // while a tip works the skin, its wake is the last TIP_FOLD_AFTER substeps (a long rub on slime with the family's whole 3.2 s hold kept
      // most of the body in the list: 3.0 ms a frame instead of 2.0); the family's own longer hold starts when the last tip lifts (below)
      const hold = TIP_FOLD_AFTER;
      this.lastTipSub = now;
      for (let i = 0; i < n * 3; i += 3) {
        const dx = XP[i] - cx, dy = XP[i + 1] - cy, dz = XP[i + 2] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rn2) {
          // the skin the tip had near it a moment ago (its wake) stays in the fold limit (tipFoldSubs; see the release transient below)
          if (now - tst[i / 3] <= hold && stamp[i / 3] !== now) { stamp[i / 3] = now; near[this.tipNearN++] = i / 3; }
          continue;
        }
        tst[i / 3] = now;
        if (stamp[i / 3] !== now) { stamp[i / 3] = now; near[this.tipNearN++] = i / 3; }   // near the tip: the fold limit looks here
        if (d2 >= r2) continue;
        hit = true;
        const y0 = XP[i + 1];
        let nx: number, ny: number, nz: number, pen: number;
        const px0 = XP[i], pz0 = XP[i + 2];
        // Minimum-distance (radial) projection onto the sphere, for every particle. (An earlier "axial" exit pushed floppy skin out
        // along the finger's travel instead: a swirl-peak vertex that had entered the sphere BEHIND its centre was carried straight
        // through it to the leading face, past its own neighbours, and on the leading face it kept a squashed cone from spreading
        // sideways, so the apex triangles piled up on the sphere's cap and overlapped: 171-180 degree folds under a press on the peak
        // base. The radial exit spreads a squashed thin feature outward like real jelly; the contact friction below carries the skin.)
        if (d2 > 1e-14) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d;
        } else { nx = f.dx; ny = f.dy; nz = f.dz; pen = r; }
        XP[i] = cx + nx * r; XP[i + 1] = cy + ny * r; XP[i + 2] = cz + nz * r;
        // contact friction: the skin sticks to the fingertip. Undo (up to mu x penetration) the tangential slide of the
        // particle relative to the tip during this substep, so a finger drags the surface with it instead of letting a
        // sloped press squirt the body out sideways.
        const ux = (px0 - X[i]) - fdx, uy = (y0 - X[i + 1]) - fdy, uz = (pz0 - X[i + 2]) - fdz;
        const un = ux * nx + uy * ny + uz * nz;
        const tx = ux - un * nx, ty = uy - un * ny, tz = uz - un * nz;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-12) {
          const k2 = tl <= muS * pen ? 1 : muK * pen / tl;
          XP[i] -= tx * k2; XP[i + 1] -= ty * k2; XP[i + 2] -= tz * k2;
        }
        if (XP[i + 1] < y0) fingerDown += M[i / 3] * (y0 - XP[i + 1]);
        react += M[i / 3] * pen;
      }
      f.touching = hit;
      if (hit && !f.contacted && f.down) {
        f.contacted = true;
        // predicted peak closing speed of the critically damped approach, plus what it already has
        const closing = Math.min(FINGER.maxSpeed, Math.max(0, f.target - f.depth) * f.depthMax * FINGER.omega / Math.E + Math.max(0, f.depthV) * f.depthMax);
        const front = f.depth * f.depthMax;
        this.emit('poke', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz,
          clamp(closing / POKE_NORM, 0.05, 1), 0, k);
      }
    }
    // CUT: the neck joins the contact fold limit while it forms (the skin there is gathered into a waist of 15% of its width: without the
    // limit the ring crumpled, 40-100 edges past 90 degrees at t > 0.8)
    if (this.neckOn && this.neckT > 0.05) {
      if (this.nkLatched) this.neckWorld();
      const stamp = this.touchStamp, now = this.subIdx, near = this.nearList, band = 1.5 * NECK_SIGMA * this.restRadius * Math.cbrt(this.fracNow / this.fracBuilt);   // (no '=== ? 1 :': an integer / double ternary is boxed)
      const pxn = this.npx, pyn = this.npy, pzn = this.npz, nxn = this.nnx, nyn = this.nny, nzn = this.nnz;
      for (let i = 0; i < n; i++) {
        const sd = (XP[i * 3] - pxn) * nxn + (XP[i * 3 + 1] - pyn) * nyn + (XP[i * 3 + 2] - pzn) * nzn;
        if (sd < band && sd > -band && stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; }
      }
    }
    // THE SKIN AROUND A PULLED OR LOCKED PATCH is in the contact fold limit like the skin around a fingertip: a patch dragged hard (a full pull, a pull into the table, the pick-up) folded its
    // rim 130 to 180 degrees (twangle, crimpo, wrigglo: 0.2 R from the anchor). It stays in the limit for the tip wake after the lobe is let go (the snap-back).
    if (grabbing && GRAB_TUNE.zone > 0) this.grabZone(); else if (this.gripWake > 0) this.gripTail();
    // RELEASE TRANSIENT OF A FINGERTIP (physics round-2 fix round, MAJOR-1): skin a rub crumpled under the tip is held at the fold limit
    // while the tip is near it (7-18 edges at 110 degrees); once the tip slid on, or lifted and retracted out of reach, the crumple sprang
    // back unconstrained and flipped past 150 degrees for 1-5 frames (the verifier's rub set: putty, slime, beads, mochi, water fill). So the
    // skin a tip had near it stays in the fold limit for tipFoldSubs substeps after the tip left it: the tip's wake while it slides (above),
    // all of it after the lift (here).
    if (!(f0.down || f0.retracting || f1.down || f1.retracting || extra) && this.subIdx - this.lastTipSub <= this.tipFoldSubs && !(this.lockN > 0 && (this.subIdx & 1) !== 0 && !this.anyGrab() && this.simTime - this.gripChangeT > GRAB_TUNE.still)) {   // (not on every other substep while only locks are held and nothing changed for a while: grabZone)
      const stamp = this.touchStamp, now = this.subIdx, near = this.nearList, tst = this.tipStamp, hold = this.tipFoldSubs;
      for (let i = 0; i < n; i++) if (now - tst[i] <= hold && stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; }
    }
    // ---- PLAYGROUND prop pass (PLAYGROUND_BUILD 8.3): the bound world's shapes, between the fingertips and the table (the table always wins)
    if (this.ps !== null) { this.fdl = fingerDown; this.propPass(); }
    {
      const mu = this.p.tableMu, glue = this.p.glue * (this.restRadius / 0.5) * (1 - this.fold) * this.glueK, H0 = this.H0;   // the tack layer scales with the body (and lets go of a folding one; and of a hop: glueK)
      // normal-load proxy for Coulomb friction: this substep's penetration plus the supported weight (g h^2 per
      // particle, concentrated on the particles that are actually touching)
      const load = this.supp * GRAVITY * H * H * Math.min(LOAD_CONC, this.Mtot / Math.max(1, this.nearMass));
      const fload = fingerDown / Math.max(1, this.nearMass);   // a finger pressing down adds its force to the normal load
      let contacts = 0, near = 0, nearM = 0;
      const tstamp = this.touchStamp, tnow = this.subIdx, tnear = this.nearList;
      // the table edges join the contact fold limit while a finger, a grab or the pinned feet work the body and for TABLE_FOLD_AFTER after
      // (the release transient: a full pull let go snaps back onto its glued foot; see foldLimit)
      const worked = this.fingers[0].down || this.fingers[0].retracting || this.fingers[1].down || this.fingers[1].retracting || extra || grabbing || this.pinCount > 0;
      this.tableFoldT = worked ? TABLE_FOLD_AFTER : Math.max(0, this.tableFoldT - H);
      const tfold = this.tableFoldT > 0;
      // ... and with them the foot rim just above the table (TABLE_FOLD_BAND; physics round-2 fix round 2, MAJOR-2): a full pull drags the
      // body over its pinned feet, and the rim particle one row up (2-4 cm, above the NEAR band) buckled at 151-179 degrees for up to 60
      // frames (capnap, pastrel, petalop, taffelin on the soft corner genome)
      this.gripT = grabbing ? TABLE_FOLD_AFTER : Math.max(0, this.gripT - H);
      const band = tfold ? (this.gripT > 0 ? GRAB_TUNE.band : TABLE_FOLD_BAND) * this.restRadius : 0;
      for (let i = 0; i < n * 3; i += 3) {
        const y = XP[i + 1];
        if (y >= NEAR) { if (y < band && tstamp[i / 3] !== tnow) { tstamp[i / 3] = tnow; tnear[this.tipNearN++] = i / 3; } continue; }
        near++; nearM += M[i / 3];
        if (tfold && tstamp[i / 3] !== tnow) { tstamp[i / 3] = tnow; tnear[this.tipNearN++] = i / 3; }   // on the table: the fold limit looks here too
        let pen = load + fload;
        if (y < 0) { contacts++; pen -= y; XP[i + 1] = 0; } else {
          // tack: lifting off its REST height by less than `glue` is mostly undone (the rest pose is the equilibrium)
          const lift = y - H0[i / 3];
          if (lift > 0 && lift < glue) { const k = lift / glue; XP[i + 1] = H0[i / 3] + lift * k * k; }
        }
        const tx = XP[i] - X[i], tz = XP[i + 2] - X[i + 2];
        const tl = Math.sqrt(tx * tx + tz * tz);
        if (tl > 1e-12) {
          const cap = mu * pen;
          if (tl <= cap) { XP[i] = X[i]; XP[i + 2] = X[i + 2]; } else { const s = cap / tl; XP[i] -= tx * s; XP[i + 2] -= tz * s; }
        }
      }
      // The tack layer must be as thick as `glue`, not only as thick as the NEAR band the loop above looks at: a foot particle kicked up
      // by 7 mm in one substep (the shape memory pulls the rim up when the body is stretched tall) starts at y < NEAR, lands above NEAR,
      // is never seen again and the whole foot peels off the table (a hop of 10 cm after a hard release of a large or firm body).
      // PEEL DAMPING (physics round-2 fix round, MAJOR-3; the old SoftParams.groundDamp, which materials.ts scales with the tack): a tacky foot
      // being peeled off the table holds the body back. While the foot is still in the tack layer and its most-lifted particle is PEEL_LO ..
      // PEEL_HI x glue up (before the tack pulls it back), up to groundDamp of the body's upward centre-of-mass speed is removed per substep
      // (dampPass): the table pulls through the tack. A body whose foot stays down (the starter's hard release peels 0.35 x glue at most)
      // never feels it, so its wobble on the foot is untouched; a stiff body on a few foot particles (marigel's 6) that springs back at
      // 1.8 m/s no longer leaves the table (it flew 126 mm), it stretches up on its foot and wobbles. Off while a grab or the pinned feet hold
      // the body (the hand is in charge), and once the whole foot is out of the layer (a real launch, a nudge, a toss: it flies).
      let peel = 0, held = 0;
      {
        const foot = this.foot;
        for (let j = 0; j < foot.length; j++) {
          const i = foot[j], y = XP[i * 3 + 1];
          const lift = y - H0[i];
          if (lift < glue) { held++; if (lift > peel) peel = lift; }
          if (y < NEAR) continue;
          if (lift < glue) { const k = lift / glue; XP[i * 3 + 1] = H0[i] + lift * k * k; }
        }
      }
      {
        const pu = held > 0 && glue > 1e-9 && !grabbing && this.pinCount === 0 ? (peel / glue - PEEL_LO) / (PEEL_HI - PEEL_LO) : 0;
        this.peelK = this.p.groundDamp * (pu <= 0 ? 0 : pu >= 1 ? 1 : pu * pu * (3 - 2 * pu));
        // PLAYGROUND: a body resting on a STATIC prop face has no tack there (D-54), so nothing absorbed the spring of its own foot: it bobbed 3 cm for seconds on a
        // box top (the table's tack and peel damping are what make rest there exact). On static prop support the peel damping acts in full (a hop suspends it: glueK)
        // (on a MOVING prop it damps the speed relative to the surface under the body, peelRef: a rider bobbed on the rocker and loaded it 7 % over its weight)
        if (this.propNearM > 0 && !grabbing && this.pinCount === 0) { const pk2 = this.p.groundDamp * this.glueK; if (pk2 > this.peelK) this.peelK = pk2; }
        if (this.landT > 0) { this.landT -= H; if (this.peelK < PIECE_LAND.k) this.peelK = PIECE_LAND.k; }
      }
      // glued feet (a lobe is being pulled, or was just let go): hold them exactly where they were
      if (this.pinCount > 0) {
        if (!grabbing) { this.pinHold -= H; if (this.pinHold <= 0) { this.pinned.fill(0); this.pinCount = 0; } }
        const pn = this.pinned;
        if (this.pinCount > 0) for (let i = 0; i < n; i++) if (pn[i]) { XP[i * 3] = X[i * 3]; XP[i * 3 + 1] = 0; XP[i * 3 + 2] = X[i * 3 + 2]; }
      }
      // PLAYGROUND (D-11): particles resting on up-facing prop faces count as support (supported gravity, the friction load, grounded, the land event)
      if (this.ps !== null) { this.tblNearM = nearM; this.propSupport(); }
      near += this.propNear; nearM += this.propNearM;
      // land detection: first contact after being airborne, speed = centre-of-mass fall speed
      if (near > 0) {
        if (this.airSub >= 8 && -this.vcy > LAND_MIN_SPEED) this.pendingLand = Math.max(this.pendingLand, -this.vcy);
        if (this.capFlat && this.gravityOn && this.airSub >= 8 && -this.vcy > PIECE_LAND.minSpeed) this.landT = PIECE_LAND.window;
        this.airSub = 0;
      } else if (this.airSub < 100000) this.airSub++;
      this.contactCount = contacts;
      this.nearCount = near; this.nearMass = nearM;
      this.supp = smooth01((near - 1) / 4);
    }
    if (this.ps !== null && this.propNearM > 0) this.propWeight();   // PLAYGROUND (D-12): a body resting on a moving prop puts its weight on it

    this.reactAcc += react;
    // ---- contact fold limit: near a fingertip, no two neighbouring triangles may fold past FINGER.foldMaxDeg (see foldLimit)
    if (this.tipNearN > 0) this.foldLimit();

    // ---- velocity from positions, with the sums the damping pass needs
    {
      const invH = 1 / H, S = this.sums;
      let sm = 0, sx = 0, sy = 0, sz = 0, svx = 0, svy = 0, svz = 0, lx = 0, ly = 0, lz = 0;
      let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
      let b00 = 0, b01 = 0, b02 = 0, b10 = 0, b11 = 0, b12 = 0, b20 = 0, b21 = 0, b22 = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, m = M[i];
        const x = XP[i3], y = XP[i3 + 1], z = XP[i3 + 2];
        const vx = (x - X[i3]) * invH, vy = (y - X[i3 + 1]) * invH, vz = (z - X[i3 + 2]) * invH;
        X[i3] = x; X[i3 + 1] = y; X[i3 + 2] = z;
        V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
        const mvx = m * vx, mvy = m * vy, mvz = m * vz;
        sm += m; sx += m * x; sy += m * y; sz += m * z;
        svx += mvx; svy += mvy; svz += mvz;
        lx += y * mvz - z * mvy; ly += z * mvx - x * mvz; lz += x * mvy - y * mvx;
        ixx += m * (y * y + z * z); iyy += m * (x * x + z * z); izz += m * (x * x + y * y);
        ixy -= m * x * y; ixz -= m * x * z; iyz -= m * y * z;
        b00 += mvx * x; b01 += mvx * y; b02 += mvx * z;
        b10 += mvy * x; b11 += mvy * y; b12 += mvy * z;
        b20 += mvz * x; b21 += mvz * y; b22 += mvz * z;
      }
      S[0] = sm; S[1] = sx; S[2] = sy; S[3] = sz; S[4] = svx; S[5] = svy; S[6] = svz; S[7] = lx; S[8] = ly; S[9] = lz;
      S[10] = ixx; S[11] = iyy; S[12] = izz; S[13] = ixy; S[14] = ixz; S[15] = iyz;
      S[16] = b00; S[17] = b01; S[18] = b02; S[19] = b10; S[20] = b11; S[21] = b12; S[22] = b20; S[23] = b21; S[24] = b22;
    }
    this.dampPass();
    if (this.sloshOn) { this.eax = ax; this.eay = ay; this.eaz = az; this.sloshPass(); }
  }

  /**
   * SLOSH MODE (P5, SQUISHY_SCIENCE 3.8): one equivalent mass-spring-dashpot (Dodge and Abramson): the liquid's offset s from the shell
   * centre is driven by the shell's acceleration relative to the field the solver applied (at rest on the table, and in free fall, there is
   * no drive), it bulges the goal shape (see the shape matching) and pushes back on the shell (momentum-neutral overall). The mode is
   * HORIZONTAL (a free surface sloshes sideways; the vertical one is the bulk's own breathing, already in the volume constraint): with a
   * vertical component the liquid's push lifted the body off its supported-gravity rest and the two pumped each other into a 0.8 R hop.
   */
  private sloshPass(): void {
    const ax = this.eax, ay = this.eay, az = this.eaz, mt = this.mat, w = 2 * Math.PI * mt.sloshHz, z = mt.sloshZeta, mu = mt.sloshMass, R0 = this.restRadius;
    const lim = 200;   // m/s^2: a nudge is a velocity jump; its one-substep acceleration would be thousands
    const dx = -clamp((this.vcx - this.pvcx) / H - ax, -lim, lim), dy = 0 * ay, dz = -clamp((this.vcz - this.pvcz) / H - az, -lim, lim);
    this.slvx += (dx - w * w * this.slx - 2 * z * w * this.slvx) * H;
    this.slvy += (dy - w * w * this.sly - 2 * z * w * this.slvy) * H;
    this.slvz += (dz - w * w * this.slz - 2 * z * w * this.slvz) * H;
    this.slx += this.slvx * H; this.sly += this.slvy * H; this.slz += this.slvz * H;
    const sl = Math.sqrt(this.slx * this.slx + this.sly * this.sly + this.slz * this.slz), smax = 0.35 * R0;
    if (sl > smax) { const r = smax / sl; this.slx *= r; this.sly *= r; this.slz *= r; this.slvx *= r; this.slvy *= r; this.slvz *= r; }
    // the liquid's push on the shell: only while floating. On the table the push (up to ~5 m/s^2) beat the foot's friction and slid the
    // whole body 18 cm back and forth for seconds after a nudge; there the table takes it, and the sway shows in the shell's shape (the bulge)
    if (!this.gravityOn) {
      const k = H * mu / (1 - mu);
      const fx = k * (w * w * this.slx + 2 * z * w * this.slvx), fz = k * (w * w * this.slz + 2 * z * w * this.slvz);
      const V = this.V;
      for (let i = 0; i < this.n * 3; i += 3) { V[i] += fx; V[i + 2] += fz; }
      this.vcx += fx; this.vcz += fz;
    }
    this.pvcx = this.vcx; this.pvcy = this.vcy; this.pvcz = this.vcz;
  }

  /** Once per frame (before the substeps): ceremony easing, the memory arm, and the goal shape the shape matching aims at. */
  private frameUpdate(nsub: number): void {
    const h = nsub * H, n = this.n, Q = this.Q;
    if (this.fold !== this.foldTarget) {
      let d = (this.foldTarget - this.fold) * (1 - Math.exp(-h / FOLD_TAU));
      const cap = FOLD_RATE * h;
      if (d > cap) d = cap; else if (d < -cap) d = -cap;
      this.fold += d;
      if (Math.abs(this.foldTarget - this.fold) < 1e-4) this.fold = this.foldTarget;
    }
    if (this.burstO > 0) { this.burstO *= Math.exp(-h / BURST_TAU); if (this.burstO < 1e-4) this.burstO = 0; }
    // CUT: the eased fraction (setFrac), the chunk's flat face rounding over, the neck easing toward its target (setNeck)
    if (this.fracDur > 0) {
      const u = (this.simTime - this.fracT0) / this.fracDur, e = u >= 1 ? 1 : u <= 0 ? 0 : u * u * (3 - 2 * u);
      this.fracNow = this.fracFrom + (this.fracTo - this.fracFrom) * e;
      if (u >= 1) { this.fracNow = this.fracTo; this.fracDur = 0; }
    }
    if (this.flatK > 0) { this.flatK *= Math.exp(-h / this.roundTau); if (this.flatK < 1e-3) this.flatK = 0; }
    // PLAYGROUND setSquash: the pose eases toward its target (under the touch gate it is released and eases out within PG.gateS)
    if (this.sqNow !== this.sqTarget) {
      const tau = this.heldF ? Math.min(this.sqTau, PG.gateS / 3) : this.sqTau;
      this.sqNow += (this.sqTarget - this.sqNow) * (1 - Math.exp(-h / tau));
      if (Math.abs(this.sqTarget - this.sqNow) < 1e-3) this.sqNow = this.sqTarget;   // (0.1 % of the height: unseen; the pose is then a fixed goal and may sleep)
    }
    if (this.neckT !== this.neckTarget) {
      this.neckT += (this.neckTarget - this.neckT) * (1 - Math.exp(-h / NECK_TAU));
      if (Math.abs(this.neckTarget - this.neckT) < 1e-4) this.neckT = this.neckTarget;
      if (this.neckT === 0 && this.neckTarget === 0) this.neckOn = false;
    }
    // (no conditional between a small integer and a double here: V8 boxes such a value, one HeapNumber per frame)
    const fs = Math.cbrt(this.fracNow / this.fracBuilt), fk = this.flatK, nk = this.neckT * (this.neckOn ? 1 : 0);
    this.volScale = fs * fs * fs;
    this.volNeck = nk;   // the volume constraint stiffens with the neck (substep; a field: the substep's own int / double mix was boxed)
    const fd = this.fold, bo = this.burstO, ta = this.trembleAmp * TREMBLE_AMP * this.restRadius, sq = this.sqNow;
    const shaped = fd !== 0 || bo !== 0 || fs !== 1 || fk !== 0 || nk !== 0 || sq !== 1;
    if (!this.memOn && !shaped && ta === 0) {
      if (this.goalOn) { this.QG.set(Q); this.LQG.set(this.LQ); this.goalOn = false; }
      if (this.edgesBent) this.restoreEdges();
      return;
    }
    // GB = the goal without the memory arm: (Q + fold (QS - Q) + flat face (FLAT - Q)) x (1 + burst) x cbrt(frac / built), then the neck
    // (PLAYGROUND: x the squash pose, y x sq and x, z x 1 / sqrt(sq) in the rest frame: volume-preserving; exactly 1 when released)
    const QG = this.QG, QGN = this.QGN, GB = this.GB, QS = this.QS, FL = this.FLAT, MEM = this.MEM, NRM = this.NRM, wm = this.wm, sc = (1 + bo) * fs, TPH = this.TPH;
    const sqx = 1 / Math.sqrt(sq);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, qx = Q[i3], qy = Q[i3 + 1], qz = Q[i3 + 2];
      GB[i3] = (qx + fd * (QS[i3] - qx) + fk * (FL[i3] - qx)) * sc * sqx;
      GB[i3 + 1] = (qy + fd * (QS[i3 + 1] - qy) + fk * (FL[i3 + 1] - qy)) * sc * sq;
      GB[i3 + 2] = (qz + fd * (QS[i3 + 2] - qz) + fk * (FL[i3 + 2] - qz)) * sc * sqx;
    }
    this.fracScale = fs;
    if (nk > 0) { this.neckGoal(); if (SoftBody.centreGoal) this.centreGB(); }   // (no arguments: doubles passed to a call this large are boxed; it reads neckT and fracScale)
    // the memory arm measures the body against that goal: the body is MADE to take the cut / ceremony shape, it is not a deformation to keep
    if (this.memOn) this.memoryStep(nsub);
    // QG = GB + wm (MEM - Q) x the same scale, + tremble along the rest normal
    const ph = 2 * Math.PI * TREMBLE_HZ * this.simTime;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let x = GB[i3] + wm * (MEM[i3] - Q[i3]) * sc, y = GB[i3 + 1] + wm * (MEM[i3 + 1] - Q[i3 + 1]) * sc, z = GB[i3 + 2] + wm * (MEM[i3 + 2] - Q[i3 + 2]) * sc;
      QGN[i3] = x; QGN[i3 + 1] = y; QGN[i3 + 2] = z;
      if (ta > 0) { const o = ta * Math.sin(ph + TPH[i]); x += NRM[i3] * o; y += NRM[i3 + 1] * o; z += NRM[i3 + 2] * o; }
      QG[i3] = x; QG[i3 + 1] = y; QG[i3 + 2] = z;
    }
    const st = this.nbrStart, nb = this.nbrIdx, ni = this.nbrInv, LQG = this.LQG;
    for (let i = 0; i < n; i++) {
      let mx = 0, my = 0, mz = 0;
      for (let j = st[i], e = st[i + 1]; j < e; j++) { const k = nb[j] * 3; mx += QG[k]; my += QG[k + 1]; mz += QG[k + 2]; }
      const inv = ni[i], i3 = i * 3;
      LQG[i3] = QG[i3] - mx * inv; LQG[i3 + 1] = QG[i3 + 1] - my * inv; LQG[i3 + 2] = QG[i3 + 2] - mz * inv;
    }
    this.goalOn = true;
    // the skin's rest lengths follow the goal when it changes size or shape (fold, burst, the cut: frac / flat face / neck, the memory arm);
    // the tremble leaves them alone (they follow QGN, the goal without the tremble: physics round-2 fix round, MINOR-11, the plastic families'
    // rest lengths used to follow the 17 Hz tremble). The purely VISCOELASTIC arm (slime, sticky stretch, slow-rise, marshmallow: memory, no
    // yield) follows too since the fix round 2 (MAJOR-1): its goal holds the deformation for memTau, and a skin at its rest lengths around a
    // goal that is pushed together can only buckle (a rubbed slime crumpled 7-11 edges past 90 degrees and flipped when the fold limit let
    // go; with the rest lengths on the goal it does not crumple)
    if (shaped || this.memOn) {
      const E3 = this.E3, EL = this.EL, ES = this.ESOFT, ss = this.p.edgeSoftStrain;
      for (let e = 0; e < this.ne; e++) {
        const a = E3[e * 2], b = E3[e * 2 + 1];
        const l = Math.sqrt((QGN[a] - QGN[b]) ** 2 + (QGN[a + 1] - QGN[b + 1]) ** 2 + (QGN[a + 2] - QGN[b + 2]) ** 2);
        EL[e] = l; ES[e] = l * ss;
      }
      const H3 = this.H3, HD = this.HD;
      for (let hh = 0; hh < this.nh; hh++) {
        const c = H3[hh * 2], d = H3[hh * 2 + 1];
        HD[hh] = Math.sqrt((QGN[c] - QGN[d]) ** 2 + (QGN[c + 1] - QGN[d + 1]) ** 2 + (QGN[c + 2] - QGN[d + 2]) ** 2);
      }
      this.edgesBent = true;
    } else if (this.edgesBent) this.restoreEdges();
  }

  /**
   * CUT: the NECK (setNeck; CUT.md 4.2, CUT2 5.4) applied to GB (rest frame). The plane is the one setNeck latched in the rest frame;
   * the particles near it (Gaussian over NECK_SIGMA rest radii either side) are pulled toward the axis through the centroid of the
   * cross-section, by up to (1 - waist) = depth (1 - NECK_WAIST) at t = 1: a waisted peanut. The volume constraint keeps the volume, so the lobes swell.
   */
  private neckGoal(): void {
    const t = this.neckT, fs = this.fracScale;
    const GB = this.GB, n = this.n;
    // the LATCHED plane in the rest frame (CUT2 5.4: pulled back once by the first setNeck with t > 0; the plane is carried by the pose, not re-derived each frame)
    const px = this.nrx, py = this.nry, pz = this.nrz, nx = this.nrnx, ny = this.nrny, nz = this.nrnz;
    const waist = NECK_WAIST + (1 - this.nkDepth) * (1 - NECK_WAIST);   // CUT2 5.4: depth 1 = today's 0.3 (exactly), depth 0 = no pinch
    const sig = NECK_SIGMA * this.restRadius * fs, inv2 = 1 / (sig * sig);
    // the cross-section's centroid (weighted by the same Gaussian), projected onto the plane
    let ax = 0, ay = 0, az = 0, aw = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, s = (GB[i3] - px) * nx + (GB[i3 + 1] - py) * ny + (GB[i3 + 2] - pz) * nz, w = Math.exp(-s * s * inv2);
      ax += w * GB[i3]; ay += w * GB[i3 + 1]; az += w * GB[i3 + 2]; aw += w;
    }
    if (aw < 1e-9) return;
    ax /= aw; ay /= aw; az /= aw;
    const sa = (ax - px) * nx + (ay - py) * ny + (az - pz) * nz;
    ax -= nx * sa; ay -= ny * sa; az -= nz * sa;
    // ON THE TABLE the waist forms at the bottom of the cross-section (the body stands on its foot: pinching the foot up toward a centre
    // line pulled it off the table against the tack and crumpled the neck, 100 edges past 90 degrees): the axis is lowered to just above
    // the cross-section's lowest point (its lowest goal point within the Gaussian band), along the in-plane part of -y
    if (this.gravityOn) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, s = (GB[i3] - ax) * nx + (GB[i3 + 1] - ay) * ny + (GB[i3 + 2] - az) * nz;
        if (s * s > sig * sig) continue;
        if (GB[i3 + 1] < lo) lo = GB[i3 + 1];
        if (GB[i3 + 1] > hi) hi = GB[i3 + 1];
      }
      const ty = lo + 0.5 * waist * (hi - lo);
      if (lo < hi && ty < ay) {
        // move the axis point down by (ay - ty) along -y projected into the plane
        const dyl = ty - ay, ux = -nx * ny * dyl, uy = (1 - ny * ny) * dyl, uz = -nz * ny * dyl;
        ax += ux; ay += uy; az += uz;
      }
    }
    // K = [kappa a, kappa b, error a, error b, 6 v0, 6 v1]: a typed scratch, and the volumes summed in place, not by a call (a double
    // returned from a call the optimiser did not inline, or carried in a loop phi, was boxed: 96-350 B a frame in some compilations)
    const K = this.NKS, tris = this.tris;
    K[4] = 0;
    for (let q = 0; q < tris.length; q += 3) {
      const a = tris[q] * 3, b = tris[q + 1] * 3, c = tris[q + 2] * 3;
      K[4] += GB[a] * (GB[b + 1] * GB[c + 2] - GB[b + 2] * GB[c + 1]) + GB[a + 1] * (GB[b + 2] * GB[c] - GB[b] * GB[c + 2]) + GB[a + 2] * (GB[b] * GB[c + 1] - GB[b + 1] * GB[c]);
    }
    const k = (1 - waist) * t, v0 = K[4];
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, ox = GB[i3] - ax, oy = GB[i3 + 1] - ay, oz = GB[i3 + 2] - az, s = ox * nx + oy * ny + oz * nz;
      const pinch = k * Math.exp(-s * s * inv2);
      GB[i3] -= (ox - nx * s) * pinch; GB[i3 + 1] -= (oy - ny * s) * pinch; GB[i3 + 2] -= (oz - nz * s) * pinch;
    }
    // the volume the waist gives up goes into the two lobes: they swell across the normal (their in-plane offsets grow by up to kappa where
    // the pinch is weak), so the goal itself holds the volume and the volume constraint does not fight the shape matching for it. kappa is
    // solved by three secant steps on the goal's volume (a single linear step undershot by a third at t = 1, the swell was capped, and the
    // compressible families followed their shrinking goal: 14-21% of their volume lost in a 0.25 s pinch)
    K[5] = 0;
    for (let q = 0; q < tris.length; q += 3) {
      const a = tris[q] * 3, b = tris[q + 1] * 3, c = tris[q + 2] * 3;
      K[5] += GB[a] * (GB[b + 1] * GB[c + 2] - GB[b + 2] * GB[c + 1]) + GB[a + 1] * (GB[b + 2] * GB[c] - GB[b] * GB[c + 2]) + GB[a + 2] * (GB[b] * GB[c + 1] - GB[b + 1] * GB[c]);
    }
    const v1 = K[5];
    if (v1 > 1e-12 && v0 > v1) {
      const T = this.NSCR;
      K[0] = 0; K[1] = 0.1; K[2] = v1 - v0;
      for (let it = 0; it < 3; it++) {
        const kap = K[1];
        for (let i = 0; i < n; i++) {
          const i3 = i * 3, ox = GB[i3] - ax, oy = GB[i3 + 1] - ay, oz = GB[i3 + 2] - az, s = ox * nx + oy * ny + oz * nz;
          const e = kap * (1 - Math.exp(-s * s * inv2));
          T[i3] = GB[i3] + (ox - nx * s) * e; T[i3 + 1] = GB[i3 + 1] + (oy - ny * s) * e; T[i3 + 2] = GB[i3 + 2] + (oz - nz * s) * e;
        }
        K[3] = 0;
        for (let q = 0; q < tris.length; q += 3) {
          const a = tris[q] * 3, b = tris[q + 1] * 3, c = tris[q + 2] * 3;
          K[3] += T[a] * (T[b + 1] * T[c + 2] - T[b + 2] * T[c + 1]) + T[a + 1] * (T[b + 2] * T[c] - T[b] * T[c + 2]) + T[a + 2] * (T[b] * T[c + 1] - T[b + 1] * T[c]);
        }
        K[3] -= v0;
        const den = K[3] - K[2], next = den > 1e-15 ? K[1] - K[3] * (K[1] - K[0]) / den : K[1];
        K[0] = K[1]; K[2] = K[3];
        K[1] = Math.max(0, Math.min(NECK_SWELL, next));   // (Math.min / max: a ternary between the integer bounds and a double is boxed)
      }
      this.neckKappa = K[1];
      const kap = K[1];
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, ox = GB[i3] - ax, oy = GB[i3 + 1] - ay, oz = GB[i3 + 2] - az, s = ox * nx + oy * ny + oz * nz;
        const e = kap * (1 - Math.exp(-s * s * inv2));
        GB[i3] += (ox - nx * s) * e; GB[i3 + 1] += (oy - ny * s) * e; GB[i3 + 2] += (oz - nz * s) * e;
      }
    }
  }

  /** CUT2 5.1 (P0): THE GOAL KEEPS THE REST SHAPE'S CENTROID. The shape matching aims every goal point at (the body's centroid + R x the goal point), so a goal
   *  whose own mass-weighted mean is off the origin pulls the whole body by that mean every substep with no reaction: a thrust. The neck lowers the waist onto
   *  the table and swells the lobes away from it, so its mean moves up as t -> 1 and the body rode it (the known "neck swell": boingle x1.66, thudge x1.84;
   *  SHELL_4_FIX2, VERIFY_SHELL4 A-F3). Called only while a neck runs (P6 adds `|| morphOn`): fold (max 0.011 R0), burst and setFrac (uniform scales about the
   *  origin, exactly 0) are left alone so a whole body stays bit-for-bit what it was until its first setNeck. `debug.goalDrift` = the size (m) of the
   *  correction applied (probe L5). Scratch: NKS[0..2]; nothing allocated. */
  private centreGB(): void {
    const n = this.n, GB = this.GB, M = this.M, K = this.NKS;
    K[0] = 0; K[1] = 0; K[2] = 0;
    for (let i = 0; i < n; i++) { const m = M[i], i3 = i * 3; K[0] += m * GB[i3]; K[1] += m * GB[i3 + 1]; K[2] += m * GB[i3 + 2]; }
    const mi = 1 / this.Mtot;
    K[0] *= mi; K[1] *= mi; K[2] *= mi;
    for (let i = 0; i < n; i++) { const i3 = i * 3; GB[i3] -= K[0]; GB[i3 + 1] -= K[1]; GB[i3 + 2] -= K[2]; }
    this.debug.goalDrift = Math.sqrt(K[0] * K[0] + K[1] * K[1] + K[2] * K[2]);
  }

  private restoreEdges(): void {
    this.EL.set(this.EL0); this.HD.set(this.HD0);
    const ss = this.p.edgeSoftStrain;
    for (let e = 0; e < this.ne; e++) this.ESOFT[e] = this.EL0[e] * ss;
    this.edgesBent = false;
  }

  /**
   * MEMORY ARM (P2, SQUISHY_SCIENCE 3.1): a Zener / standard-linear-solid shape match. MEM is a lagging copy of the body's own shape in its
   * rest frame that flows toward the current shape (memTau), only by the misfit beyond a yield (Bingham: a plastic hold), heals back to the
   * true rest shape (memHealTau), never strays further than memMax R0, and keeps its centre on the rest centre (no momentum). Once per frame.
   */
  private memoryStep(nsub: number): void {
    const mt = this.mat, h = nsub * H, n = this.n, X = this.X, M = this.M, Q = this.Q, MEM = this.MEM, R0 = this.restRadius;
    const kFlow = 1 - Math.exp(-h / mt.memTau), kHeal = mt.memHealTau < 59 ? 1 - Math.exp(-h / mt.memHealTau) : 0;
    const yl = mt.memYield * R0, maxD = mt.memMax * R0;
    // the goal's own offset GB - Q (fold, burst, and the cut: fraction, flat face, neck; physics round-2 fix round, MINOR-6/13): the body is
    // MADE to take that shape, it is not a deformation the material should remember. Measured against the goal without it, a burst with
    // fingers down no longer sets a fold into putty for good (fossilo 153 degrees, over 120 for 9 s).
    const GB = this.GB;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { const m = M[i]; cx += m * X[i * 3]; cy += m * X[i * 3 + 1]; cz += m * X[i * 3 + 2]; }
    cx /= this.Mtot; cy /= this.Mtot; cz /= this.Mtot;
    const q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    let ox = 0, oy = 0, oz = 0, mvMax = 0, devMax = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, dx = X[i3] - cx, dy = X[i3 + 1] - cy, dz = X[i3 + 2] - cz;
      const gx = GB[i3] - Q[i3], gy = GB[i3 + 1] - Q[i3 + 1], gz = GB[i3 + 2] - Q[i3 + 2];
      const px = r00 * dx + r10 * dy + r20 * dz - gx, py = r01 * dx + r11 * dy + r21 * dz - gy, pz = r02 * dx + r12 * dy + r22 * dz - gz;
      let mx = MEM[i3], my = MEM[i3 + 1], mz = MEM[i3 + 2];
      const mx0 = mx, my0 = my, mz0 = mz;
      const ex = px - mx, ey = py - my, ez = pz - mz, len = Math.sqrt(ex * ex + ey * ey + ez * ez), excess = len - yl;
      if (excess > 0 && len > 1e-12) { const k = kFlow * excess / len; mx += ex * k; my += ey * k; mz += ez * k; }
      if (kHeal > 0) { mx += (Q[i3] - mx) * kHeal; my += (Q[i3 + 1] - my) * kHeal; mz += (Q[i3 + 2] - mz) * kHeal; }
      let fx = mx - Q[i3], fy = my - Q[i3 + 1], fz = mz - Q[i3 + 2];
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (fl > maxD) { const r = maxD / fl; fx *= r; fy *= r; fz *= r; }
      if (fl > devMax) devMax = fl;   // (PLAYGROUND memoryBusy: the memory shape's largest departure from the rest shape)
      MEM[i3] = Q[i3] + fx; MEM[i3 + 1] = Q[i3 + 1] + fy; MEM[i3 + 2] = Q[i3 + 2] + fz;
      const md = (MEM[i3] - mx0) * (MEM[i3] - mx0) + (MEM[i3 + 1] - my0) * (MEM[i3 + 1] - my0) + (MEM[i3 + 2] - mz0) * (MEM[i3 + 2] - mz0);
      if (md > mvMax) mvMax = md;
      ox += M[i] * fx; oy += M[i] * fy; oz += M[i] * fz;
    }
    this.restMem = Math.sqrt(mvMax) / R0;   // (CUT3 sleep: has the memory shape stopped flowing?)
    this.memDev = Math.min(devMax, maxD) / R0;
    ox /= this.Mtot; oy /= this.Mtot; oz /= this.Mtot;
    for (let i = 0; i < n; i++) { MEM[i * 3] -= ox; MEM[i * 3 + 1] -= oy; MEM[i * 3 + 2] -= oz; }
  }

  private dampPass(): void {
    const n = this.n, X = this.X, V = this.V, M = this.M, S = this.sums;
    const sm = S[0];
    let lx = S[7], ly = S[8], lz = S[9];
    let ixx = S[10], iyy = S[11], izz = S[12], ixy = S[13], ixz = S[14], iyz = S[15];
    let b00 = S[16], b01 = S[17], b02 = S[18], b10 = S[19], b11 = S[20], b12 = S[21], b20 = S[22], b21 = S[23], b22 = S[24];
    const inv = 1 / sm;
    const cx = S[1] * inv, cy = S[2] * inv, cz = S[3] * inv;
    const svx = S[4], svy = S[5], svz = S[6];
    const vcx = svx * inv, vcy = svy * inv, vcz = svz * inv;
    // about the centre of mass
    lx -= sm * (cy * vcz - cz * vcy); ly -= sm * (cz * vcx - cx * vcz); lz -= sm * (cx * vcy - cy * vcx);
    ixx -= sm * (cy * cy + cz * cz); iyy -= sm * (cx * cx + cz * cz); izz -= sm * (cx * cx + cy * cy);
    ixy += sm * cx * cy; ixz += sm * cx * cz; iyz += sm * cy * cz;
    b00 -= svx * cx; b01 -= svx * cy; b02 -= svx * cz;
    b10 -= svy * cx; b11 -= svy * cy; b12 -= svy * cz;
    b20 -= svz * cx; b21 -= svz * cy; b22 -= svz * cz;
    // omega = I^-1 L (symmetric 3x3 inverse by cofactors)
    const c00 = iyy * izz - iyz * iyz, c01 = ixz * iyz - ixy * izz, c02 = ixy * iyz - ixz * iyy;
    const c11 = ixx * izz - ixz * ixz, c12 = ixy * ixz - ixx * iyz, c22 = ixx * iyy - ixy * ixy;
    const det = ixx * c00 + ixy * c01 + ixz * c02;
    let wx = 0, wy = 0, wz = 0;
    // second-moment matrix S2 = sum m r r^T = (tr(I)/2) Id - I, and the best affine velocity gradient L = B S2^-1;
    // its symmetric part D is the global squash / stretch / shear rate (damped hard), the rest is local wobble
    let d00 = 0, d01 = 0, d02 = 0, d11 = 0, d12 = 0, d22 = 0;
    if (det > 1e-9) {
      const id = 1 / det;
      wx = (c00 * lx + c01 * ly + c02 * lz) * id;
      wy = (c01 * lx + c11 * ly + c12 * lz) * id;
      wz = (c02 * lx + c12 * ly + c22 * lz) * id;
      const sxx = 0.5 * (iyy + izz - ixx), syy = 0.5 * (ixx + izz - iyy), szz = 0.5 * (ixx + iyy - izz);
      const sxy = -ixy, sxz = -ixz, syz = -iyz;
      const k00 = syy * szz - syz * syz, k01 = sxz * syz - sxy * szz, k02 = sxy * syz - sxz * syy;
      const k11 = sxx * szz - sxz * sxz, k12 = sxy * sxz - sxx * syz, k22 = sxx * syy - sxy * sxy;
      const sdet = sxx * k00 + sxy * k01 + sxz * k02;
      if (sdet > 1e-12) {
        const is = 1 / sdet;
        const l00 = (b00 * k00 + b01 * k01 + b02 * k02) * is, l01 = (b00 * k01 + b01 * k11 + b02 * k12) * is, l02 = (b00 * k02 + b01 * k12 + b02 * k22) * is;
        const l10 = (b10 * k00 + b11 * k01 + b12 * k02) * is, l11 = (b10 * k01 + b11 * k11 + b12 * k12) * is, l12 = (b10 * k02 + b11 * k12 + b12 * k22) * is;
        const l20 = (b20 * k00 + b21 * k01 + b22 * k02) * is, l21 = (b20 * k01 + b21 * k11 + b22 * k12) * is, l22 = (b20 * k02 + b21 * k12 + b22 * k22) * is;
        d00 = l00; d11 = l11; d22 = l22;
        d01 = 0.5 * (l01 + l10); d02 = 0.5 * (l02 + l20); d12 = 0.5 * (l12 + l21);
      }
    }
    // peel damping (see the tack pass): the table pulls the body back through a peeling tacky foot, uniformly (no deformation)
    const rvy = vcy - this.peelRef, gdv = rvy > 0 ? rvy * this.peelK : 0;   // (PLAYGROUND: relative to a moving prop's surface under the body; peelRef is 0 without one)
    // CUT3 (verifier m5): a piece in its landing window (PIECE_LAND) also sheds a share of its horizontal centre speed, uniformly (no deformation); landT is raised for cut pieces only, so whole squishies are untouched
    const gdx = this.landT > 0 ? vcx * PIECE_LAND.kh : 0, gdz = this.landT > 0 ? vcz * PIECE_LAND.kh : 0;
    this.vcx = vcx - gdx; this.vcy = vcy - gdv; this.vcz = vcz - gdz;

    // self-righting torque (a weeble: it flops over but rights itself) + angular damping of the rigid spin
    const q = this.qr;
    const upx = 2 * (q[0] * q[1] - q[3] * q[2]), upy = 1 - 2 * (q[0] * q[0] + q[2] * q[2]), upz = 2 * (q[1] * q[2] + q[3] * q[0]);
    const sinT = Math.sqrt(upx * upx + upz * upz);
    const theta = Math.acos(clamp(upy, -1, 1));
    const scale = sinT > 1e-6 ? theta / sinT : 0;
    const float = !this.gravityOn;
    const kUp = float ? 30 : 40, cAng = float ? 4 : 8;
    const awx = (-upz * scale * kUp - cAng * wx) * H, awy = -cAng * wy * H, awz = (upx * scale * kUp - cAng * wz) * H;

    const dRes = this.dampInt, dAff = this.dampAff, dr = this.dragF, dQ = this.dampQ;
    let ke = 0;
    const vmax2 = MAX_SPEED * MAX_SPEED;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const rx = X[i3] - cx, ry = X[i3 + 1] - cy, rz = X[i3 + 2] - cz;
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      // internal velocity = v - v_cm - w x r
      const ivx = vx - vcx - (wy * rz - wz * ry), ivy = vy - vcy - (wz * rx - wx * rz), ivz = vz - vcz - (wx * ry - wy * rx);
      const sp2 = ivx * ivx + ivy * ivy + ivz * ivz;
      ke += M[i] * sp2;
      // global (affine, symmetric) part and the local remainder
      const avx = d00 * rx + d01 * ry + d02 * rz, avy = d01 * rx + d11 * ry + d12 * rz, avz = d02 * rx + d12 * ry + d22 * rz;
      const nl = dQ * Math.sqrt(sp2);
      const ga = Math.min(0.9, dAff + nl), gr = Math.min(0.9, dRes + nl);
      vx += -ga * avx - gr * (ivx - avx) - dr * vx + (awy * rz - awz * ry) - gdx;
      vy += -ga * avy - gr * (ivy - avy) - dr * vy + (awz * rx - awx * rz) - gdv;
      vz += -ga * avz - gr * (ivz - avz) - dr * vz + (awx * ry - awy * rx) - gdz;
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) { const s = MAX_SPEED / Math.sqrt(s2); vx *= s; vy *= s; vz *= s; }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
    }
    this.keAcc += 0.5 * ke / sm;
    this.keSubs++;
  }

  /** Per-substep bookkeeping that emits events (cheap). */
  private postSubstep(): void {
    for (let k = 0; k < NSLOT; k++) {
      const f = this.fingers[k];
      if (f.down && f.contacted && !f.pressed && f.holdT >= FINGER.pressAfterS && f.depth > 0.03) {
        f.pressed = true;
        const front = f.depth * f.depthMax;
        // heldFor is 0: contracts.ts reserves it for 'release' and 'snap' (the press fires at a fixed ~0.18 s anyway)
        this.emit('press', f.px + f.dx * front, f.py + f.dy * front, f.pz + f.dz * front, f.nx, f.ny, f.nz, clamp(f.depth, 0, 1), 0, k);
      }
    }
    if (this.pendingLand > 0) {
      const X = this.X;
      let lx = 0, lz = 0, c = 0;
      for (let i = 0; i < this.n; i++) if (X[i * 3 + 1] < 0.01) { lx += X[i * 3]; lz += X[i * 3 + 2]; c++; }
      if (c > 0) { lx /= c; lz /= c; } else { lx = this.cx; lz = this.cz; }
      this.evAuto = !this.playerHas() && !this.thrownF;   // PLAYGROUND (8.8): nobody touches it and nobody threw it since its last landing
      this.emit('land', lx, 0, lz, 0, 1, 0, clamp(this.pendingLand / LAND_NORM, 0.05, 1), 0, -1);
      this.thrownF = false; this.thrownCalm = 0;
      this.pendingLand = -1;
    }
  }

  private emit(kind: SoftEventKind, x: number, y: number, z: number, nx: number, ny: number, nz: number, intensity: number, heldFor: number, finger: number): void {
    const li = KIND_INDEX[kind] * 6 + (finger + 1);
    if (this.simTime - this.lastEvent[li] < EVENT_MIN_GAP_S || this.events.length >= 128) { this.evAuto = false; this.evProp = -1; this.evOther = -1; return; }
    this.lastEvent[li] = this.simTime;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.events.push({
      kind, at: { x, y, z }, normal: { x: nx / nl, y: ny / nl, z: nz / nl },
      intensity: clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1), heldFor, finger,
      auto: this.evAuto, prop: this.evProp, other: this.evOther,   // PLAYGROUND (8.8; contracts.ts SoftEvent): set by the land and bump paths, false / -1 / -1 otherwise
    });
    this.evAuto = false; this.evProp = -1; this.evOther = -1;
  }

  private syncOutputs(): void {
    const n = this.n, X = this.X, P = this.positions;
    for (let i = 0; i < n * 3; i++) P[i] = X[i];
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) { sx += this.M[i] * X[i * 3]; sy += this.M[i] * X[i * 3 + 1]; sz += this.M[i] * X[i * 3 + 2]; }
    this.center.x = sx / this.Mtot; this.center.y = sy / this.Mtot; this.center.z = sz / this.Mtot;
    this.frame.x = this.qr[0]; this.frame.y = this.qr[1]; this.frame.z = this.qr[2]; this.frame.w = this.qr[3];
  }

  /** End-of-step: outputs, strain, metrics, safety net. `nsub` substeps were taken (an int, so the call allocates nothing). */
  private finalize(nsub: number): void {
    const n = this.n, X = this.X, dt = nsub * H;
    // safety net: a non-finite state is recovered (and counted: the probe requires the count to stay 0)
    let sum = 0;
    for (let i = 0; i < n * 3; i++) sum += X[i];
    if (!Number.isFinite(sum)) {
      this.debug.safetyResets++;
      this.reset();
      return;
    }
    this.syncOutputs();
    const m = this.metrics;

    // strain per vertex = mean(edge / rest edge)
    const st = this.strain, E3 = this.E3, EL = this.EL0;
    st.fill(0);
    for (let e = 0; e < this.ne; e++) {
      const a = E3[e * 2], b = E3[e * 2 + 1];
      const dx = X[a] - X[b], dy = X[a + 1] - X[b + 1], dz = X[a + 2] - X[b + 2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / EL[e];
      st[a / 3] += r; st[b / 3] += r;
    }
    for (let i = 0; i < n; i++) st[i] /= this.valence[i];

    // volume
    const vol = meshVolume(X, this.tris) / this.restVolume;
    m.volume = vol;
    if (vol < this.debug.minVolume) this.debug.minVolume = vol;

    // press axis: a finger's travel direction, the pinch line, the last axis for 0.6 s after a lift, else world up
    let ax = 0, ay = 1, az = 0;
    let nf = 0, fa = this.fingers[0], fb = this.fingers[1];   // (the first two fingers down: the pinch line; with 2 fingers down exactly the old f0 and f1)
    for (let k = 0; k < NSLOT; k++) { const fk = this.fingers[k]; if (!fk.down) continue; nf++; if (nf === 1) fa = fk; else if (nf === 2) fb = fk; }
    if (nf >= 2) {
      ax = fb.cx - fa.cx; ay = fb.cy - fa.cy; az = fb.cz - fa.cz;
      const l = Math.sqrt(ax * ax + ay * ay + az * az);
      if (l > 1e-6) { ax /= l; ay /= l; az /= l; } else { ax = 0; ay = 1; az = 0; }
      this.lastAxisX = ax; this.lastAxisY = ay; this.lastAxisZ = az; this.lastAxisT = this.simTime;
    } else if (nf === 1) {
      const f = fa;
      ax = f.dx; ay = f.dy; az = f.dz;
      this.lastAxisX = ax; this.lastAxisY = ay; this.lastAxisZ = az; this.lastAxisT = this.simTime;
    } else if (this.simTime - this.lastAxisT < 0.6) {
      ax = this.lastAxisX; ay = this.lastAxisY; az = this.lastAxisZ;
    }
    // thickness along the axis now vs at rest (rest axis = axis rotated into body space by the inverse frame)
    const q = this.qr;
    const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
    const tx = 2 * (qy * az - qz * ay), ty = 2 * (qz * ax - qx * az), tz = 2 * (qx * ay - qy * ax);
    const lx = ax + qw * tx + (qy * tz - qz * ty), ly = ay + qw * ty + (qz * tx - qx * tz), lz = az + qw * tz + (qx * ty - qy * tx);
    let mn = Infinity, mx = -Infinity, rmn = Infinity, rmx = -Infinity;
    const Q = this.Q;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const d = X[i3] * ax + X[i3 + 1] * ay + X[i3 + 2] * az;
      if (d < mn) mn = d;
      if (d > mx) mx = d;
      const r = Q[i3] * lx + Q[i3 + 1] * ly + Q[i3 + 2] * lz;
      if (r < rmn) rmn = r;
      if (r > rmx) rmx = r;
    }
    const comp = clamp((1 - (mx - mn) / Math.max(1e-6, rmx - rmn)) / 0.75, 0, 1);
    const rate = (comp - this.prevCompression) / dt;
    this.prevCompression = comp;
    m.compression = comp;
    m.compressionRate += (rate - m.compressionRate) * (1 - Math.exp(-dt / 0.06));
    if (!Number.isFinite(m.compressionRate)) m.compressionRate = 0;

    // stretch: biggest outward displacement of any particle from where the rigid frame wants it
    const G = this.GOAL;
    let best = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const ux = G[i3] - this.cx, uy = G[i3 + 1] - this.cy, uz = G[i3 + 2] - this.cz;
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      const disp = ((X[i3] - G[i3]) * ux + (X[i3 + 1] - G[i3 + 1]) * uy + (X[i3 + 2] - G[i3 + 2]) * uz) / ul;
      if (disp > best) best = disp;
    }
    m.stretch = clamp((best - 0.1 * this.restRadius) / (2.3 * this.restRadius), 0, 1);

    m.kinetic = clamp((this.keAcc / Math.max(1, this.keSubs)) / 0.08, 0, 1);
    m.grounded = this.nearCount >= 3;
    m.airborne = this.nearCount === 0; m.onProp = this.onPropIdx; m.memoryBusy = this.memBusy();   // PLAYGROUND
    m.fingers = nf;
    m.grabbed = this.anyGrab();
    m.locked = this.lockN;
    m.carried = this.carried;
    // pull: the live PULL LEVEL (pullLevel: translation-free, 1 = the family's maxPull) of the deeper of the active grabs, 0 without one
    // (written out, not pullLevel(): a double returned from a call this large function does not inline is boxed, one HeapNumber per frame)
    {
      let pl = 0;
      const maxD = Math.max(1e-9, this.p.maxPull * this.restRadius), tk = this.pinCount > 0 ? 0 : 1;   // (see pullLevel: the base's travel)
      for (let k = 0; k < NSLOT; k++) {
        const g = this.grabs[k];
        if (!g.active) continue;
        const dx = g.ex - g.t0x - (this.cx - g.c0x) * tk, dy = g.ey - g.t0y - (this.cy - g.c0y) * tk, dz = g.ez - g.t0z - (this.cz - g.c0z) * tk;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) / maxD;
        if (l > pl) pl = l;
      }
      m.pull = pl > 1 - 1e-9 ? 1 : pl;
    }
    // press: the deepest current fingertip indentation, as a fraction of that finger's safe depth (the seating lift is not indentation);
    // only while the tip is actually in the skin. reaction: the push-back the fingertips met, a force (mass x penetration / H^2 per
    // substep, averaged over the step) mapped to 0..1 by REACT_REF, so a firm body pushes back harder than a soft one at the same depth.
    let press = 0;
    for (let k = 0; k < NSLOT; k++) {
      const f = this.fingers[k];
      if (!f.touching || (!f.down && !f.retracting)) continue;
      const span = f.depthMax - f.lift;
      if (span > 1e-6) { const v = (clamp(f.depth, 0, 1) * f.depthMax * f.share - f.lift) / span; if (v > press) press = v; }
    }
    m.press = clamp(press, 0, 1);
    const force = this.reactAcc / Math.max(1, nsub) / (H * H) / this.Mtot;   // per unit body mass: m/s^2
    m.reaction = force > 0 ? 1 - Math.exp(-force / REACT_REF) : 0;
    this.debug.force = force;
    // strands (P6 fallback: no adhesive bonds, the renderer draws the strings): a tacky body strings while a fingertip that held the skin
    // >= 0.1 s pulls away (its 50 ms retract), then the strings thin out with a time constant of 0.08 + 0.2 x stringiness s (they snap within
    // ~0.3-0.6 s, like the staggered bonds of the prototype, SQUISHY_SCIENCE 3.7)
    {
      if (this.tackS > 0) {
        let tug = false;
        for (let k = 0; k < NSLOT; k++) { const ff = this.fingers[k]; if (ff.retracting && ff.contacted && ff.holdT >= 0.1) tug = true; }
        if (tug) this.strandsT = 1;
        else if (this.strandsT > 0) { this.strandsT *= Math.exp(-dt / this.strandsTau); if (this.strandsT < 1e-3) this.strandsT = 0; }
        m.strands = Math.min(1, this.strandsGain * this.strandsT);
      } else m.strands = 0;
      m.slosh = this.sloshOn ? Math.min(1, Math.sqrt(this.slx * this.slx + this.sly * this.sly + this.slz * this.slz) / (0.35 * this.restRadius)) : 0;
    }
    const sp = Math.sqrt(this.vcx * this.vcx + this.vcy * this.vcy + this.vcz * this.vcz);
    if (sp > this.debug.maxSpeed) this.debug.maxSpeed = sp;
    this.debug.contacts = this.contactCount;
  }
}
