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
// Units: metres-ish; mass per particle ~1 (tributary area, mean 1).
import type { Genome } from '../core/genome.ts';
import { clamp, mulberry32 } from '../core/rng.ts';
import type {
  CutPlane, FingerDownArgs, PieceOpts, RayHit, SoftBodyLike, SoftEvent, SoftEventKind, SoftMetrics, V3,
} from '../contracts.ts';
import { buildIcosphere } from './mesh.ts';
import { buildChunkRest, buildRest, flatPoints, meshVolume, physicsGenome, restRadiusOf } from './shape.ts';
import type { RestShape } from './shape.ts';
import type { IcoMesh } from './mesh.ts';
import { deriveParams, EVENT_MIN_GAP_S, FINGER, GRAVITY, H, MAX_DT, MAX_SUBSTEPS } from './params.ts';
import type { SoftParams } from './params.ts';
import { extractRotation, rayMesh } from './mathx.ts';
import { buildStruts } from './struts.ts';
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
  constructor(n: number) { this.verts = new Int32Array(n); this.weights = new Float64Array(n); this.p0 = new Float64Array(n * 3); }
  /** Back to the state of a new Grab. */
  clear(): void {
    this.active = false; this.count = 0; this.anchor = 0;
    this.verts.fill(0); this.weights.fill(0); this.p0.fill(0);
    this.t0x = 0; this.t0y = 0; this.t0z = 0; this.c0x = 0; this.c0y = 0; this.c0z = 0; this.rx = 0; this.ry = 0; this.rz = 0; this.ex = 0; this.ey = 0; this.ez = 0;
    this.ramp = 0; this.holdT = 0;
  }
}

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
const FRAC_MIN = 0.125;            // no piece smaller than 1/8 of the whole (CUT.md 2.4)
const PIECE_D2 = 0.35;             // pieces under this fraction of the whole use mesh detail 2 (CUT.md 4.3)
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
const LIFT_OVER = 1.15;            // a pull asked past this x maxPull lifts the body off the mat (B3)
const CARRY_OMEGA = 18;            // rad/s: how tightly a carried body follows the hand (critically damped, kinematic)
const TOSS_MAX = 6;                // m/s: the fastest throw
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
  'n', 'ne', 'nt', 'nh', 'vertexCount', 'subIdx', 'airSub', 'contactCount', 'nearCount', 'keSubs', 'pinCount',   // SoftBody
  'vnStamp', 'hashStamp', 'bodyId', 'lastTipSub', 'tipFoldSubs',
  'count', 'anchor',                                                                                              // Grab
  'fingers', 'substeps', 'safetyResets', 'contacts',                                                              // metrics, debug
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

/** 6 x the signed volume of the tetrahedron (o, p_a, p_b, p_c) for points of P (indices a, b, c are point indices into P, 3 per point). */
function tetra6(P: Float64Array, a: number, b: number, c: number, ox: number, oy: number, oz: number): number {
  const ax = P[a * 3] - ox, ay = P[a * 3 + 1] - oy, az = P[a * 3 + 2] - oz;
  const bx = P[b * 3] - ox, by = P[b * 3 + 1] - oy, bz = P[b * 3 + 2] - oz;
  const cx = P[c * 3] - ox, cy = P[c * 3 + 1] - oy, cz = P[c * 3 + 2] - oz;
  return ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
}

/** Buckets of the per-body particle hash collide() looks particles up in (a power of two). */
const HASH_SIZE = 1024;
/** collide() remembers its last contact with at most this many other bodies (by their per-process id, modulo): the 'bump' on a new contact. */
const MAX_OTHERS = 16;
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
  readonly restLocal: Float32Array;
  readonly indices: Uint32Array;
  readonly strain: Float32Array;
  readonly center: V3 = { x: 0, y: 0, z: 0 };
  readonly frame = { x: 0, y: 0, z: 0, w: 1 };
  readonly metrics: SoftMetrics = {
    compression: 0, compressionRate: 0, stretch: 0, volume: 1, kinetic: 0, grounded: true, fingers: 0, grabbed: false, press: 0, reaction: 0, strands: 0, slosh: 0,
    pull: 0, carried: false,
  };
  readonly restRadius: number;
  /** Harness-only counters (not part of SoftBodyLike). `safetyResets` must stay 0: it counts emergency non-finite recoveries. */
  readonly debug = { substeps: 0, safetyResets: 0, contacts: 0, maxSpeed: 0, minVolume: 1, force: 0 };
  /** Resolved solver parameters (genome-derived plus any `opts.params` override). */
  readonly params: SoftParams;
  /** Frames per phase of warmUp()'s workout (a harness knob for timing it; the default is what the probe measures). */
  static warmFrames = 6;

  // ---- what warmUp() needs to build a twin (the genome is kept by reference, never mutated)
  private readonly genomeRef: Genome;
  private readonly detailArg: number | undefined;
  private readonly pieceArg: PieceOpts | undefined;
  // ---- CUT (CUT.md 4): the piece this body is, its fraction of the whole (built, now, and an eased change), the neck, the chunk's flat face
  private readonly fracBuilt: number;
  private fracNow = 1; private fracFrom = 1; private fracTo = 1; private fracT0 = 0; private fracDur = 0;
  private readonly chunk: boolean;
  private readonly FLAT: Float64Array;      // a chunk's goal with the flat cut face (rest-local); the goal eases from it to Q
  private flatK = 0;                        // 1 = the flat face, 0 = rounded over
  private readonly roundTau: number;
  private neckOn = false; private neckT = 0; private neckTarget = 0; private neckKappa = 0; private volNeck = 0;
  private npx = 0; private npy = 0; private npz = 0; private nnx = 0; private nny = 1; private nnz = 0;   // neck plane (world)
  private homeX = 0; private homeZ = 0;     // reset() puts a piece back here (a whole body: the origin, as always)
  // ---- B2 body-to-body contact (collide): this frame's vertex normals and particle hash (built once per frame on demand)
  private readonly VN: Float64Array;
  private vnStamp = -1;
  private readonly hashHead: Int32Array; private readonly hashNext: Int32Array;
  private hashStamp = -1; private readonly hashCell: number;   // hash cell edge: 1.5 x the mean rest edge
  private readonly meanEdge: number;        // mean rest edge length (collide's contact skin)
  private bR = 0;                           // boundRadius()'s result
  private readonly contactWith: Int32Array; // per other-body slot: the substep index of the last contact (bump on a new contact)
  private bodyId = 0;                       // a per-process id (collide's contact memory); not part of the state hash
  // ---- B3 pick up and toss
  private carried = false;
  private carrier = 0;                 // the grab (0 | 1) whose hand carries the body
  private carryOx = 0; private carryOy = 0; private carryOz = 0;      // the body's centre relative to the hand while carried
  private hvx = 0; private hvy = 0; private hvz = 0;                  // the hand's smoothed velocity (m/s)
  private phx = 0; private phy = 0; private phz = 0;                  // the hand target at the last substep

  // ---- configuration
  private readonly n: number;
  private readonly ne: number;
  private readonly nt: number;
  private readonly p: SoftParams;
  private readonly restVolume: number;
  private readonly restCenterY: number;
  private readonly invM: Float64Array;      // 1 / mass
  private readonly M: Float64Array;         // mass
  private readonly Mtot: number;
  private readonly Q: Float64Array;         // rest local positions
  private readonly softW: Float64Array;     // per-vertex shape-matching stiffness multiplier
  private readonly floppyW: Float64Array;   // per-vertex weight of the floppy part (the swirl-peak): 0 body .. 1 tip
  private readonly tris: Uint32Array;
  private readonly E3: Int32Array;          // edge endpoints, pre-multiplied by 3
  private readonly EWA: Float64Array;       // edge inverse masses (a, b) and their sum
  private readonly EWB: Float64Array;
  private readonly EWS: Float64Array;
  private readonly EL: Float64Array;        // edge rest lengths
  private readonly ESOFT: Float64Array;     // strain limit (in length) beyond which the edge hardens
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
  private readonly HD: Float64Array;        // rest distance between the two opposite vertices
  private readonly HP: Float64Array;        // rest distance of each opposite vertex from the hinge's edge line (2 per hinge; the sliver floor)
  private readonly HW: Float64Array;        // their inverse-mass sum
  private readonly valence: Float32Array;
  private readonly nbrStart: Int32Array;    // CSR adjacency (vertex -> neighbours) for the Laplacian term
  private readonly nbrIdx: Int32Array;
  private readonly nbrInv: Float64Array;
  private readonly LQ: Float64Array;        // rest Laplacian offsets q_i - mean(q_nbrs)
  private readonly invH: Float64Array;      // 1 / mean rest edge length around each vertex (crease detection scale)
  private readonly volAlphaT: number;       // volume compliance (alpha tilde)
  private readonly ns: number;              // thin-part struts (struts.ts): count, endpoints (pre-multiplied by 3), rest lengths, inverse-mass sums
  private readonly S3: Int32Array; private readonly SL: Float64Array; private readonly SW: Float64Array;
  private readonly tipSpeed: number;        // FINGER.maxSpeed scaled to the mesh resolution (see updateFingers)
  private readonly smK: number;             // shape-matching position gain per substep
  private readonly smW2: number;            // (smOmega H)^2 (x (1 + memStiff)): the jam stiffening scales it
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
  private readonly volS0: number;           // the volume constraint's own scale S0 (volAlphaT = volKappa * S0)
  private readonly memOn: boolean;          // memory arm (P2)
  private readonly wm: number;              // share of the shape stiffness that relaxes: memStiff / (1 + memStiff)
  private readonly MEM: Float64Array;       // memory shape (rest frame, centred like Q)
  private readonly plasticOn: boolean;      // memory with a yield: the edge rest lengths follow the memory (plastic set)
  private readonly sloshOn: boolean;        // slosh mode (P5)
  private slx = 0; private sly = 0; private slz = 0; private slvx = 0; private slvy = 0; private slvz = 0;
  private pvcx = 0; private pvcy = 0; private pvcz = 0;   // centre-of-mass velocity of the previous substep (slosh drive)
  private eax = 0; private eay = 0; private eaz = 0;       // the external acceleration the solver applied this substep (slosh drive)
  private strandsT = 0;                     // metrics.strands envelope (P6 fallback: friction + a strands signal for the renderer)
  // ---- goal shape: the shape matching, the Laplacian and (when it changes size) the edges aim at QG instead of Q
  private goalOn = false;
  private readonly QG: Float64Array;
  private readonly QGN: Float64Array;       // the goal without the tremble (what the skin's rest lengths follow; frameUpdate)
  private readonly GB: Float64Array;        // the goal without the memory arm (fold, burst, the cut), rest frame (frameUpdate, memoryStep)
  private volScale = 1;                     // the volume target's scale from setFrac: (frac now / frac built)
  private fracScale = 1;                    // ... and the goal's: cbrt of that
  private readonly LQG: Float64Array;
  private readonly QS: Float64Array;        // the equal-volume sphere (setFold's target), rest frame
  private readonly NRM: Float64Array;       // unit rest direction of each particle from the rest centre (tremble, slosh, burst)
  private readonly EL0: Float64Array;       // true rest edge lengths (strain is measured against these)
  private readonly HD0: Float64Array;       // true rest hinge distances
  private readonly TPH: Float64Array;       // tremble phase per particle
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
  private readonly H0: Float64Array;        // rest height of each particle above the table (the tack acts on lift beyond it)
  private readonly foot: Int32Array;        // particles whose rest height is within NEAR of the table (the tack layer acts on these)
  private readonly WV: Float64Array;        // per-substep inverse masses of the volume constraint (blocked particles = 0)
  private readonly pinned: Uint8Array;      // foot particles glued to the table while a lobe is pulled
  private pinCount = 0;
  private pinHold = 0;
  private kinSoft = 1;                      // kinetic fingertip friction multiplier of a family softer than the gel (constructor)
  private tableFoldT = 0;                   // seconds the table edges stay in the contact fold limit (TABLE_FOLD_AFTER after the last touch)
  private goalBottom = 0;                   // lowest point of the shape-matching goal in the last substep (supported gravity, see substep)
  private peelK = 0;                        // share of the upward centre-of-mass speed the peeling tack removes per substep (the tack pass)
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
  private readonly fingers: Finger[] = [new Finger(), new Finger()];
  private readonly grabs: Grab[];
  private events: SoftEvent[] = [];
  private readonly lastEvent = new Float64Array(7 * 3).fill(-10);   // per event kind (KIND_INDEX) x finger (-1, 0, 1)
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
    const pf = pc && typeof pc.frac === 'number' && Number.isFinite(pc.frac) ? clamp(pc.frac, FRAC_MIN, 1) : 1;
    const chunk = !!(pc && pc.chunk);
    this.pieceArg = pc ? { ...pc, frac: pf, chunk } : undefined;
    this.detailArg = opts.detail ?? (pc && pf < PIECE_D2 ? 2 : undefined);
    // genome fields are sanitised where they are read (physicsGenome: non-finite -> documented default, finite -> clamped)
    const mesh = buildIcosphere(this.detailArg ?? 3);
    const rest = pc ? pieceRest(genome, mesh, pf, chunk) : buildRest(genome, mesh);
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
    // a piece is a smaller toy of the same material: deriveParams' sizeScale (smOmega ~ 1 / R) for the piece's own radius
    if (pf < 1) this.p.smOmega /= Math.cbrt(pf);
    this.params = this.p;
    this.vertexCount = n;
    this.tris = mesh.tris;
    this.indices = mesh.tris;
    this.restRadius = rest.restRadius;
    this.restVolume = rest.restVolume;
    this.restCenterY = rest.restCenterY;
    this.Q = rest.restLocal;
    this.softW = new Float64Array(n);
    this.floppyW = Float64Array.from(rest.floppy);
    for (let i = 0; i < n; i++) this.softW[i] = 1 - (1 - this.p.peakSoft) * rest.floppy[i];
    this.M = rest.mass;
    this.invM = new Float64Array(n);
    let mt = 0;
    for (let i = 0; i < n; i++) { this.invM[i] = 1 / rest.mass[i]; mt += rest.mass[i]; }
    this.Mtot = mt;
    this.restLocal = Float32Array.from(rest.restLocal);
    this.positions = new Float32Array(n * 3);
    this.strain = new Float32Array(n).fill(1);
    this.X = new Float64Array(n * 3);
    this.XP = new Float64Array(n * 3);
    this.V = new Float64Array(n * 3);
    this.GOAL = new Float64Array(n * 3);
    this.GRAD = new Float64Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.touchStamp = new Int32Array(n).fill(-1);
    this.tipStamp = new Int32Array(n).fill(-1000000);
    this.nearList = new Int32Array(n);
    this.WV = new Float64Array(n);
    this.H0 = new Float64Array(n);
    for (let i = 0; i < n; i++) this.H0[i] = rest.restLocal[i * 3 + 1] + rest.restCenterY;
    {
      let fc = 0;
      for (let i = 0; i < n; i++) if (this.H0[i] < NEAR) fc++;
      this.foot = new Int32Array(fc);
      fc = 0;
      for (let i = 0; i < n; i++) if (this.H0[i] < NEAR) this.foot[fc++] = i;
    }
    this.grabs = [new Grab(n), new Grab(n)];

    // edges, adjacency, rest Laplacian offsets
    const ne = this.ne, Q = rest.restLocal;
    this.E3 = new Int32Array(ne * 2);
    this.EWA = new Float64Array(ne); this.EWB = new Float64Array(ne); this.EWS = new Float64Array(ne);
    this.EL = new Float64Array(ne); this.ESOFT = new Float64Array(ne);
    {
      const nh = mesh.hinges.length / 4;
      this.nh = nh;
      this.H3 = new Int32Array(nh * 2); this.HD = new Float64Array(nh); this.HW = new Float64Array(nh); this.HE3 = new Int32Array(nh * 2);
      this.HP = new Float64Array(nh * 2);
      for (let h = 0; h < nh; h++) {
        const c = mesh.hinges[h * 4 + 2], d = mesh.hinges[h * 4 + 3];
        {
          const a = mesh.hinges[h * 4], b = mesh.hinges[h * 4 + 1];
          const ex = Q[b * 3] - Q[a * 3], ey = Q[b * 3 + 1] - Q[a * 3 + 1], ez = Q[b * 3 + 2] - Q[a * 3 + 2], el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
          for (let k = 0; k < 2; k++) {
            const v = k === 0 ? c : d, vx = Q[v * 3] - Q[a * 3], vy = Q[v * 3 + 1] - Q[a * 3 + 1], vz = Q[v * 3 + 2] - Q[a * 3 + 2];
            const cx = vy * ez - vz * ey, cy = vz * ex - vx * ez, cz = vx * ey - vy * ex;
            this.HP[h * 2 + k] = Math.sqrt(cx * cx + cy * cy + cz * cz) / el;
          }
        }
        this.HE3[h * 2] = mesh.hinges[h * 4] * 3; this.HE3[h * 2 + 1] = mesh.hinges[h * 4 + 1] * 3;
        this.H3[h * 2] = c * 3; this.H3[h * 2 + 1] = d * 3;
        this.HD[h] = Math.sqrt((Q[c * 3] - Q[d * 3]) ** 2 + (Q[c * 3 + 1] - Q[d * 3 + 1]) ** 2 + (Q[c * 3 + 2] - Q[d * 3 + 2]) ** 2);
        this.HW[h] = this.invM[c] + this.invM[d];
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
      this.EWA[e] = this.invM[a]; this.EWB[e] = this.invM[b]; this.EWS[e] = this.invM[a] + this.invM[b];
      const l = Math.sqrt((Q[a * 3] - Q[b * 3]) ** 2 + (Q[a * 3 + 1] - Q[b * 3 + 1]) ** 2 + (Q[a * 3 + 2] - Q[b * 3 + 2]) ** 2);
      this.EL[e] = l; this.ESOFT[e] = l * this.p.edgeSoftStrain;
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
    this.LQ = new Float64Array(n * 3);
    this.invH = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.nbrStart[i], e = this.nbrStart[i + 1];
      let mx = 0, my = 0, mz = 0;
      for (let j = s; j < e; j++) { const k = this.nbrIdx[j] * 3; mx += Q[k]; my += Q[k + 1]; mz += Q[k + 2]; }
      const inv = 1 / (e - s);
      this.nbrInv[i] = inv;
      let sl = 0;
      for (let j = s; j < e; j++) { const k = this.nbrIdx[j] * 3; sl += Math.sqrt((Q[k] - Q[i * 3]) ** 2 + (Q[k + 1] - Q[i * 3 + 1]) ** 2 + (Q[k + 2] - Q[i * 3 + 2]) ** 2); }
      this.invH[i] = 1 / (sl * inv);
      this.LQ[i * 3] = Q[i * 3] - mx * inv; this.LQ[i * 3 + 1] = Q[i * 3 + 1] - my * inv; this.LQ[i * 3 + 2] = Q[i * 3 + 2] - mz * inv;
    }

    // material family switches and the goal-shape buffers
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
    this.MEM = Float64Array.from(Q);
    this.FLAT = new Float64Array(n * 3);
    this.roundTau = this.memOn && mt0.memYield > 0 ? 1 + mt0.memStiff : ROUND_TAU;
    if (chunk) {
      // the flat cut face toward cutNormal (world = the rest frame at creation); default: the face down the -x axis
      const cn = pc && pc.cutNormal && finite3(pc.cutNormal) ? pc.cutNormal : { x: -1, y: 0, z: 0 };
      const cl = Math.hypot(cn.x, cn.y, cn.z) || 1;
      flatPoints(Q, mesh.tris, rest.restRadius, cn.x / cl, cn.y / cl, cn.z / cl, this.FLAT);
      this.flatK = 1;
    }
    this.VN = new Float64Array(n * 3);
    this.SDIST = new Float64Array(n);
    this.NSCR = new Float64Array(n * 3);
    this.hashHead = new Int32Array(HASH_SIZE); this.hashNext = new Int32Array(n);
    {
      let el = 0;
      for (let e = 0; e < this.ne; e++) el += this.EL[e];
      this.meanEdge = el / Math.max(1, this.ne);
      this.hashCell = 1.5 * this.meanEdge;
    }
    this.contactWith = new Int32Array(MAX_OTHERS).fill(-1000000);
    this.bodyId = nextBodyId++;
    this.QG = Float64Array.from(Q);
    this.QGN = Float64Array.from(Q);
    this.GB = Float64Array.from(Q);
    this.LQG = Float64Array.from(this.LQ);
    this.EL0 = Float64Array.from(this.EL);
    this.HD0 = Float64Array.from(this.HD);
    this.NRM = new Float64Array(n * 3);
    this.QS = new Float64Array(n * 3);
    this.TPH = new Float64Array(n);
    {
      // equal-volume sphere around the rest centre, on the same directions (the mesh's own volume, so the fold keeps the volume exactly)
      for (let i = 0; i < n; i++) {
        const x = Q[i * 3], y = Q[i * 3 + 1], z = Q[i * 3 + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
        this.NRM[i * 3] = x / l; this.NRM[i * 3 + 1] = y / l; this.NRM[i * 3 + 2] = z / l;
        this.TPH[i] = ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) * Math.PI * 2;
      }
      for (let i = 0; i < n; i++) {
        const m = rest.mass[i] / mt, x = this.NRM[i * 3], y = this.NRM[i * 3 + 1], z = this.NRM[i * 3 + 2], N9 = this.NN;
        N9[0] += m * x * x; N9[1] += m * x * y; N9[2] += m * x * z; N9[3] += m * y * x; N9[4] += m * y * y; N9[5] += m * y * z; N9[6] += m * z * x; N9[7] += m * z * y; N9[8] += m * z * z;
      }
      const unitVol = meshVolume(this.NRM, mesh.tris);
      const rs = Math.cbrt(rest.restVolume / unitVol);
      for (let i = 0; i < n * 3; i++) this.QS[i] = this.NRM[i] * rs;
    }

    // constants derived from params at the fixed substep
    const wh = this.p.smOmega * H;
    // memory arm: the instantaneous stiffness is (1 + memStiff) x the relaxed one (SQUISHY_SCIENCE 3.1); the implicit form stays stable
    const wh2 = wh * wh * (this.memOn ? 1 + mt0.memStiff : 1);
    this.smK = wh2 / (1 + wh2);
    this.smW2 = wh2;
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
    this.volS0 = this.volumeScale(rest.restLocal);
    this.volAlphaT = this.p.volKappa * this.volS0;
    // The fingertip's speed cap is a per-substep travel limit in disguise: at FINGER.maxSpeed the tip moves 15 mm per substep, ~40% of an edge of
    // the swirl-peak at detail 3. On a finer mesh (detail 4: half the edge length) the same travel is ~80% of an edge, and the skin under a
    // hard shove could not follow it (adjacent triangles crushed onto the sphere at 125-145 degrees). So the cap scales with the edge length
    // (1 / sqrt of the vertex count, detail 3 = 1, never above 1): the same travel per edge on every mesh, detail 3 unchanged.
    this.tipSpeed = FINGER.maxSpeed * Math.min(1, Math.sqrt(642 / n));
    {
      // thin-part struts: chords through the inside of the swirl-peak (struts.ts)
      const st = buildStruts(rest.restLocal, mesh, rest.strutW, this.p.strutTau, this.p.strutMaxR * rest.restRadius, Math.round(this.p.strutPer), this.p.strutCos, rest.feature);
      this.ns = st.count; this.S3 = st.ends3; this.SL = st.rest; this.SW = new Float64Array(this.ns);
      for (let k = 0; k < this.ns; k++) this.SW[k] = this.invM[st.ends3[k * 2] / 3] + this.invM[st.ends3[k * 2 + 1] / 3];
    }
    const seed = typeof opts.seed === 'number' && Number.isFinite(opts.seed) ? opts.seed : physicsGenome(genome).seed;
    this.seedPhase = mulberry32(seed >>> 0)() * Math.PI * 2;

    // a piece starts where the cut left it (its lobe's centre, CUT.md 4.3) with its lobe's velocity; reset() brings it back to that spot
    if (pc && pc.at && finite3(pc.at) && inWorld(pc.at.x, pc.at.y, pc.at.z)) { this.homeX = pc.at.x; this.homeZ = pc.at.z; }
    this.reset();
    if (pc) {
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
      this.syncOutputs();
    }
    for (const o of [this, this.metrics, this.center, this.frame, this.debug, ...this.fingers, ...this.grabs] as object[]) settleDoubles(o, INT_FIELDS);
  }

  get gravity(): boolean { return this.gravityOn; }
  set gravity(v: boolean) {
    const on = !!v;
    if (on === this.gravityOn) return;
    this.gravityOn = on;
    this.airSub = 0;
    if (!on) { this.pinned.fill(0); this.pinCount = 0; this.carried = false; }   // a floating body has no table to be glued to (nor a carry)
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
    this.pinned.fill(0); this.pinCount = 0; this.pinHold = 0; this.tableFoldT = 0; this.peelK = 0; this.goalBottom = 0;
    this.events.length = 0;
    this.lastEvent.fill(-10);
    this.pendingLand = -1;
    const m = this.metrics;
    m.compression = 0; m.compressionRate = 0; m.stretch = 0; m.volume = 1; m.kinetic = 0; m.grounded = this.gravityOn; m.fingers = 0; m.grabbed = false;
    m.press = 0; m.reaction = 0; m.strands = 0; m.slosh = 0; m.pull = 0; m.carried = false;
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
    this.neckOn = false; this.neckT = 0; this.neckTarget = 0; this.volNeck = 0;
    this.vnStamp = -1; this.hashStamp = -1; this.contactWith.fill(-1000000);
    this.carried = false; this.carrier = 0; this.carryOx = 0; this.carryOy = 0; this.carryOz = 0; this.hvx = 0; this.hvy = 0; this.hvz = 0; this.phx = 0; this.phy = 0; this.phz = 0;
    this.strain.fill(1);
    this.syncOutputs();
  }

  step(dt: number): void {
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
    // once per frame: memory arm, ceremony easing, goal shape (an int argument: no boxing). Only called when something is active: a body
    // that never needs it (the gel at rest, pressed or pulled) must not run a function the warm-up left without type feedback every frame
    // (it was deoptimised and ran unoptimised: 144 B of boxed doubles per frame)
    if (this.memOn || this.goalOn || this.edgesBent || this.fold !== this.foldTarget || this.burstO > 0 || this.trembleAmp > 0 || this.flatK > 0 || this.neckOn || this.fracDur > 0 || this.fracNow !== this.fracBuilt) this.frameUpdate(nsub);
    for (let s = 0; s < nsub; s++) {
      this.substep();
      this.simTime += H;
      this.postSubstep();
    }
    this.finalize(nsub);   // an integer: a double argument to a function this size is boxed (a HeapNumber per step)
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

  fingerDown(id: 0 | 1, a: FingerDownArgs): void {
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
    f.share = this.fingers[id ^ 1].down ? FINGER.pinchShare : 1;
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

  fingerPressure(id: 0 | 1, target: number): void {
    const f = this.fingers[id];
    if (!f || !f.down || !Number.isFinite(target)) return;
    f.target = clamp(target, 0, 1);
  }

  fingerMove(id: 0 | 1, point: V3): void {
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

  fingerUp(id: 0 | 1): void {
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

  grab(id: 0 | 1, vertex: number, target: V3): void {
    const g = this.grabs[id];
    if (!g || !target) return;
    const tx = target.x, ty = target.y, tz = target.z;
    if (!inWorld(tx, ty, tz) || !Number.isFinite(vertex)) return;
    const v = Math.floor(vertex);
    if (v < 0 || v >= this.n) return;
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
    g.t0x = tx; g.t0y = ty; g.t0z = tz; g.rx = tx; g.ry = ty; g.rz = tz; g.ex = tx; g.ey = ty; g.ez = tz;
    g.c0x = this.center.x; g.c0y = this.center.y; g.c0z = this.center.z;
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

  grabMove(id: 0 | 1, target: V3): void {
    const g = this.grabs[id];
    if (!g || !g.active || !target) return;
    if (!inWorld(target.x, target.y, target.z)) return;
    g.rx = target.x; g.ry = target.y; g.rz = target.z;
  }

  grabRelease(id: 0 | 1): void {
    const g = this.grabs[id];
    if (!g || !g.active) return;
    g.active = false;
    if (this.carried && !this.grabs[0].active && !this.grabs[1].active) {
      // B3 TOSS: let go of a carried body: it flies with the hand's velocity (at most TOSS_MAX), lands ('land') and squashes. The 'snap' of a
      // pull that got past the body's maximum is a full one (intensity 1): the shell plays its toss on it and the meter pays it as a pull.
      this.carried = false;
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
    if (this.carried && id === this.carrier) { this.startCarry(1 - id); return; }
    // a snap when the pull got anywhere (>= 5% of the body's own maxPull; it was metrics.stretch > 0.05 until the round-2 fix round,
    // which a firm family pulled to its limit never reaches: slow-rise foam reads stretch 0.04 at its maxPull, so it never snapped)
    const pl = this.pullLevel(g);
    if (!this.grabs[0].active && !this.grabs[1].active) this.pinHold = this.p.pinHold;
    if (pl > 0.05) {
      const v = g.anchor, X = this.X;
      const nrm = this.vertexNormal(v);
      this.emit('snap', X[v * 3], X[v * 3 + 1], X[v * 3 + 2], nrm[0], nrm[1], nrm[2], pl, g.holdT, id);
    }
  }

  /** Visual aid (finger ghost, debug viewer): the current fingertip sphere of finger `id`, or null when it has no tip. Allocates; not for the hot path. */
  tip(id: 0 | 1): { x: number; y: number; z: number; r: number; depth: number } | null {
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
    w.gravity = false; w.nudge({ x: 0.5, y: 0.3, z: -0.2 }); frame();                                // float, shove
    w.gravity = true; w.airSub = 8; w.vcy = -2; frame();                                             // land
    w.nudge({ x: 9, y: 0, z: 3 }); for (let i = 0; i < 8; i++) frame();                              // mat corral (outside the dead zone)
    w.fingerDown(1, { point: { x: w.center.x + 3 * R, y: 0.5 * R, z: w.center.z }, normal: { x: 0, y: 0, z: -1 }, dir: { x: 0, y: 0, z: 1 } });
    w.fingerPressure(1, 1); frame(); frame(); w.fingerUp(1); frame();                               // ... with a finger down that touches nothing
    w.setFold(1); w.tremble(0.5); w.moveTo({ x: 0.3, y: 0.5, z: 0 }, 1); frame(); frame();            // ceremony drivers
    w.burstOpen(0.8); frame(); w.setFold(0); w.tremble(0); w.moveTo(null); frame(); frame();
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
    for (let i = 0; i < this.n; i++) { V[i * 3] += ix; V[i * 3 + 1] += iy; V[i * 3 + 2] += iz; }
  }

  // ---- ceremony drivers (contracts.ts SoftBodyLike, optional members; DESIGN.md 6.4). Deterministic, allocation-free, any value is safe.

  /** 0..1: morph the shape-matching goal toward the equal-volume sphere (eased with FOLD_TAU, at most FOLD_RATE per second: never snaps). */
  setFold(t: number): void {
    if (typeof t !== 'number' || Number.isNaN(t)) return;
    this.foldTarget = t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  /** Kinematic spring of the centre of mass toward a world point (horizontal only on the table); null releases it. stiffness ~1 = default. */
  moveTo(p: V3 | null, stiffness?: number): void {
    if (p === null || p === undefined) { this.moveOn = false; return; }
    if (typeof p !== 'object' || !finite3(p) || !inWorld(p.x, p.y, p.z)) return;
    this.mtx = p.x; this.mty = p.y; this.mtz = p.z;
    const k = typeof stiffness === 'number' && Number.isFinite(stiffness) ? stiffness : 1;
    this.moveK = k < 0.1 ? 0.1 : k > 4 ? 4 : k;
    this.moveOn = true;
  }

  /** 0..1: high-frequency goal jitter along the surface normal (the charge-up tremble). 0 = off. */
  tremble(amp: number): void {
    if (typeof amp !== 'number' || Number.isNaN(amp)) return;
    this.trembleAmp = amp <= 0 ? 0 : amp >= 1 ? 1 : amp;
  }

  /** Spring open: a radial velocity kick (momentum-free) and a goal overshoot of 1 + 0.25 x strength that settles by itself (BURST_TAU). */
  burstOpen(strength: number): void {
    if (typeof strength !== 'number' || !(strength > 0)) return;   // NaN, <= 0: nothing
    const s = strength >= 1 ? 1 : strength;
    if (BURST_OVER * s > this.burstO) this.burstO = BURST_OVER * s;
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
   * 0..1: morph the shape-matching goal into a waisted peanut along `plane` (world space; carried with the body), eased (NECK_TAU); at 1
   * the waist is NECK_WAIST of the cross-section's width. The volume constraint holds the volume. null (or t <= 0 eased out) releases it.
   */
  setNeck(plane: CutPlane | null, t: number): void {
    if (plane === null || plane === undefined) { this.neckTarget = 0; return; }
    if (typeof plane !== 'object' || !plane.point || !plane.normal || !finite3(plane.point) || !finite3(plane.normal)) return;
    if (!inWorld(plane.point.x, plane.point.y, plane.point.z) || typeof t !== 'number' || Number.isNaN(t)) return;
    // (called every frame of a neck: no doubles passed to a helper, no ternary between integer bounds and t)
    const nx = plane.normal.x, ny = plane.normal.y, nz = plane.normal.z, nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(nl > 1e-12) || nl === Infinity) return;
    this.npx = plane.point.x; this.npy = plane.point.y; this.npz = plane.point.z; this.nnx = nx / nl; this.nny = ny / nl; this.nnz = nz / nl;
    this.neckTarget = Math.min(1, Math.max(0, t));
    this.neckOn = true;
  }

  /** Grow or shrink the rest volume smoothly (smoothstep in time) to `frac` of the whole over `seconds` (0: at once). The rest shape is the
   *  built one scaled by cbrt(frac / built); the volume constraint follows it. frac is clamped to 1/8 .. 1. */
  setFrac(frac: number, seconds: number): void {
    if (typeof frac !== 'number' || !Number.isFinite(frac)) return;
    const f = frac < FRAC_MIN ? FRAC_MIN : frac > 1 ? 1 : frac;
    const sec = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 0;
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
  collide(others: readonly SoftBodyLike[]): void {
    if (!others || typeof others.length !== 'number') return;
    const X = this.X, V = this.V, n = this.n, now = this.subIdx;
    this.boundRadius();
    const ra = this.bR;
    for (let k = 0; k < others.length; k++) {
      const o = others[k];
      if (!(o instanceof SoftBody) || o === this) continue;
      o.boundRadius();
      const rb = o.bR;
      const cdx = o.center.x - this.center.x, cdy = o.center.y - this.center.y, cdz = o.center.z - this.center.z;
      const skin = 0.25 * (this.meanEdge + o.meanEdge);
      const reach = rb + skin;
      if (cdx * cdx + cdy * cdy + cdz * cdz > (ra + reach) * (ra + reach)) continue;   // broad phase: the spheres do not meet
      o.ensureContactData();
      const OX = o.X, OV = o.V, VN = o.VN, head = o.hashHead, next = o.hashNext, cell = o.hashCell, deep = 0.6 * o.restRadius;
      const ocx = o.center.x, ocy = o.center.y, ocz = o.center.z, reach2 = reach * reach, search2 = 4 * cell * cell;
      let contacts = 0, appr = 0, sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0, spen = 0;
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
        const push = 0.5 * (skin - d);
        X[i3] += nx * push; X[i3 + 1] += ny * push; X[i3 + 2] += nz * push;
        if (X[i3 + 1] < 0) X[i3 + 1] = 0;
        OX[b3] -= nx * push; OX[b3 + 1] -= ny * push; OX[b3 + 2] -= nz * push;
        if (OX[b3 + 1] < 0) OX[b3 + 1] = 0;
        // inelastic along the normal, friction across it (half to each side)
        const rvx = V[i3] - OV[b3], rvy = V[i3 + 1] - OV[b3 + 1], rvz = V[i3 + 2] - OV[b3 + 2], vn = rvx * nx + rvy * ny + rvz * nz;
        const vnn = vn < 0 ? vn : CONTACT_TACK * vn, tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
        const ix = 0.5 * (vnn * nx + CONTACT_MU * tx), iy = 0.5 * (vnn * ny + CONTACT_MU * ty), iz = 0.5 * (vnn * nz + CONTACT_MU * tz);
        V[i3] -= ix; V[i3 + 1] -= iy; V[i3 + 2] -= iz;
        OV[b3] += ix; OV[b3 + 1] += iy; OV[b3 + 2] += iz;
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
          // ... and their approach along it (a body resting on another is not driven into it by its own weight: the contact particles' share
          // alone let the stack sink 5 cm a second into the body below)
          const an = rn < 0 ? 0.5 * rn : 0;
          const tx = (rvx - rn * mx) * 0.5 * CONTACT_MU_BODY + an * mx, ty = (rvy - rn * my) * 0.5 * CONTACT_MU_BODY + an * my, tz = (rvz - rn * mz) * 0.5 * CONTACT_MU_BODY + an * mz;
          // ... and a rigid share of the separation (CONTACT_RIGID of the mean push, each body as a whole): the push of a few contact
          // particles alone is spread over the whole body by the next solve, so a resting stack settled 0.18 R deep into the body below
          const rs = CONTACT_RIGID * spen / contacts, rx = mx * rs, ry = my * rs, rz = mz * rs;
          for (let i = 0; i < n * 3; i += 3) { V[i] -= tx; V[i + 1] -= ty; V[i + 2] -= tz; X[i] += rx; X[i + 1] += ry; X[i + 2] += rz; if (X[i + 1] < 0) X[i + 1] = 0; }
          for (let i = 0; i < o.n * 3; i += 3) { OV[i] += tx; OV[i + 1] += ty; OV[i + 2] += tz; OX[i] -= rx; OX[i + 1] -= ry; OX[i + 2] -= rz; if (OX[i + 1] < 0) OX[i + 1] = 0; }
          this.vcx -= tx; this.vcy -= ty; this.vcz -= tz; o.vcx += tx; o.vcy += ty; o.vcz += tz;
        }
        o.syncOutputs();
        // a 'bump' is the START of a contact (none with that body in the last BUMP_GAP substeps) that closes faster than BUMP_MIN: bodies
        // resting against each other do not keep bumping
        const slot = o.bodyId & (MAX_OTHERS - 1), fresh = now - this.contactWith[slot] > BUMP_GAP;
        this.contactWith[slot] = now;
        if (fresh && appr > BUMP_MIN) {
          const ic = 1 / contacts;
          this.emit('bump', sx * ic, sy * ic, sz * ic, snx, sny, snz, appr / BUMP_NORM, 0, -1);   // normal: out of the other body
        }
      }
    }
    this.syncOutputs();
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
    const a = this.fingers[0], b = this.fingers[1];
    for (let k = 0; k < 2; k++) {
      const f = this.fingers[k];
      f.ocx = f.cx; f.ocy = f.cy; f.ocz = f.cz;
      if (f.down) {
        const want = this.fingers[k ^ 1].down ? FINGER.pinchShare : 1;
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
    const im = 1 / this.Mtot, cx = sx * im - this.homeX, cz = sz * im - this.homeZ;
    const r = Math.sqrt(cx * cx + cz * cz);
    if (!(r > p.matR0) || (rimOnly && !(r >= p.matRim))) return;
    const ux = cx / r, uz = cz / r, rim = r >= p.matRim, w = rim ? 1 : smooth01((r - p.matR0) / Math.max(1e-6, p.matRamp));
    const vr = (svx * ux + svz * uz) * im;
    // past the rim the outward speed is reflected softly (RIM_BOUNCE: the mat's soft rim bounces a tossed body back, B3); inside it, braked
    const dv = vr > 0 ? -(rim ? 1 + RIM_BOUNCE : Math.min(1, p.matBrake * w * H)) * vr : 0;
    // the glide never drops below 10% of its speed, so a body just outside the dead zone reaches its edge and STOPS there (a glide that
    // faded to zero at the edge crept forever: ~1 cm/s at 6 cm out); it never overshoots the edge; past the rim it is 4x faster
    const g = Math.min(p.matGlide * (rim ? 4 : w > 0.1 ? w : 0.1) * H, r - p.matR0);
    const dvx = dv * ux, dvz = dv * uz, gx = -g * ux, gz = -g * uz;
    for (let i = 0; i < n * 3; i += 3) { X[i] += gx; X[i + 2] += gz; V[i] += dvx; V[i + 2] += dvz; }
    this.vcx += dvx; this.vcz += dvz;
  }

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
    const half = (Math.PI - (FINGER.foldMaxDeg * Math.PI) / 180) / 2;   // half the smallest allowed interior angle at an edge
    const ch = Math.cos(half), sh = Math.sin(half), cosMin = Math.cos(2 * half), deepCos = cosMin + FOLD_DEEP;
    for (let it = 0; it < FINGER.foldIters; it++) {
      let opened = false, deep = false;
      for (let q = 0; q < hc; q++) {
        const h = hl[q], c = H3[h * 2], d = H3[h * 2 + 1], a = HE[h * 2], b = HE[h * 2 + 1];
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
      for (let k = 0; k < 2; k++) {
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
    for (let k = 0; k < 2; k++) {
      const g = this.grabs[k];
      if (!g.active) continue;
      g.ramp = Math.min(1, g.ramp + H / 0.06);
      g.holdT += H;
      g.ex += (g.rx - g.ex) * ease; g.ey += (g.ry - g.ey) * ease; g.ez += (g.rz - g.ez) * ease;
      // B3 PICK UP: a hand that asks for more than LIFT_OVER x the body's maxPull (the raw target, not the clamped one) unsticks the body from
      // the mat and carries it (on the table only; a floating body is already in the hand's reach)
      if (!this.carried && this.gravityOn) {
        const rx = g.rx - g.t0x, ry = g.ry - g.t0y, rz = g.rz - g.t0z, lim = LIFT_OVER * maxD;
        if (rx * rx + ry * ry + rz * rz > lim * lim) this.startCarry(k);
      }
      if (this.carried && k === this.carrier) {
        // the hand leads the carried body by at most maxPull (the body follows at a limited speed and never under the table: a far or a
        // fast target, or one under the table, stretched the grabbed patch metres out of the body and inverted it; the hostile fuzz)
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
   * B3: lift the body off the mat (the pinned feet let go) and carry it with the hand: from now on its centre follows the hand at the anchor's
   * rest distance (kinematic, CARRY_OMEGA, see substep) and gravity is the hand's to hold. grabRelease throws it with the hand's velocity.
   */
  private startCarry(k: number): void {
    const g = this.grabs[k];
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
    const nFingers = (f0.down ? 1 : 0) + (f1.down ? 1 : 0);
    const grabbing = this.grabs[0].active || this.grabs[1].active;
    // MAT CORRAL (the cheap dead-zone test on the last substep's centre is done here, inline, so the call only happens outside it): off while
    // something HOLDS the body (a grab, the pinned feet, a fingertip touching it); while a finger is down but its tip touches nothing (the
    // body was shoved out from under it) only the rim acts, so a nudge cannot carry the body off the mat past a finger that is merely down
    const hdx = this.cx - this.homeX, hdz = this.cz - this.homeZ;   // (about the body's home: see matCorral)
    if (this.gravityOn && !grabbing && !this.moveOn && this.pinCount === 0 && hdx * hdx + hdz * hdz > this.p.matR0 * this.p.matR0 * 0.81) {
      const a0 = f0.down || f0.retracting, a1 = f1.down || f1.retracting;
      if (!(a0 && f0.touching) && !(a1 && f1.touching)) this.matCorral(a0 || a1);
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
        const o = this.grabs[1 - this.carrier];
        if (o.active) {
          o.t0x += mx; o.t0y += my; o.t0z += mz; o.c0x += mx; o.c0y += my; o.c0z += mz;
          const p0 = o.p0;
          for (let j = 0; j < o.count * 3; j += 3) { p0[j] += mx; p0[j + 1] += my; p0[j + 2] += mz; }
        }
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
      const gu = this.goalBottom / (GOAL_FLOAT * this.restRadius), gf = gu <= 0 ? 0 : gu >= 1 ? 1 : gu * gu * (3 - 2 * gu);
      ay = this.carried ? 0 : -GRAVITY * (1 - this.supp * (1 - gf));   // a carried body: the hand holds its weight
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
      for (let i = 0; i < n; i++) {
        const i3 = i * 3, m = M[i];
        const mx = m * XP[i3], my = m * XP[i3 + 1], mz = m * XP[i3 + 2];
        const qx = Q[i3], qy = Q[i3 + 1], qz = Q[i3 + 2];
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
      const dd = Math.max(db, this.volNeck), aEff = Math.min(this.volAlphaT, this.volAlphaT * (1 - dd) + 0.5 * this.volS0 * dd);
      if (this.bleedOn) {
        // AIR BLEED (SQUISHY_SCIENCE 3.2): while something loads the body its volume target falls toward the squeezed volume (air leaves,
        // with volOutTau), and always returns toward 1 (air comes back through the skin, volInTau): the constraint holds the body at V*, so it
        // cannot re-inflate faster than air returns (the slow rise). Near the floor the spring stiffens back to incompressible (bottom-out).
        const vo = (a0 || a1 || grabbing) && vNow < this.vt - 0.003 ? this.volOutK : 0;   // air leaves only while loaded
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
    for (let k = 0; k < 2; k++) {
      const g = this.grabs[k];
      if (!g.active) continue;
      const px = g.ex - g.t0x, py = g.ey - g.t0y, pz = g.ez - g.t0z;
      const kg = 0.45 * g.ramp;
      for (let j = 0; j < g.count; j++) {
        const i3 = g.verts[j] * 3, w = g.weights[j] * kg;
        XP[i3] += (g.p0[j * 3] + px - XP[i3]) * w;
        XP[i3 + 1] += (g.p0[j * 3 + 1] + py - XP[i3 + 1]) * w;
        XP[i3 + 2] += (g.p0[j * 3 + 2] + pz - XP[i3 + 2]) * w;
      }
    }

    // ---- collisions: finger spheres, then the table (the table always wins)
    this.tipNearN = 0;
    let fingerDown = 0;   // mass-weighted downward push of the fingertips this substep: extra normal load on the table
    let react = 0;        // mass-weighted penetration the fingertips corrected this substep (metrics.reaction)
    for (let k = 0; k < 2; k++) {
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
      const stamp = this.touchStamp, now = this.subIdx, near = this.nearList, band = 1.5 * NECK_SIGMA * this.restRadius * Math.cbrt(this.fracNow / this.fracBuilt);   // (no '=== ? 1 :': an integer / double ternary is boxed)
      const pxn = this.npx, pyn = this.npy, pzn = this.npz, nxn = this.nnx, nyn = this.nny, nzn = this.nnz;
      for (let i = 0; i < n; i++) {
        const sd = (XP[i * 3] - pxn) * nxn + (XP[i * 3 + 1] - pyn) * nyn + (XP[i * 3 + 2] - pzn) * nzn;
        if (sd < band && sd > -band && stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; }
      }
    }
    // RELEASE TRANSIENT OF A FINGERTIP (physics round-2 fix round, MAJOR-1): skin a rub crumpled under the tip is held at the fold limit
    // while the tip is near it (7-18 edges at 110 degrees); once the tip slid on, or lifted and retracted out of reach, the crumple sprang
    // back unconstrained and flipped past 150 degrees for 1-5 frames (the verifier's rub set: putty, slime, beads, mochi, water fill). So the
    // skin a tip had near it stays in the fold limit for tipFoldSubs substeps after the tip left it: the tip's wake while it slides (above),
    // all of it after the lift (here).
    if (!(f0.down || f0.retracting || f1.down || f1.retracting) && this.subIdx - this.lastTipSub <= this.tipFoldSubs) {
      const stamp = this.touchStamp, now = this.subIdx, near = this.nearList, tst = this.tipStamp, hold = this.tipFoldSubs;
      for (let i = 0; i < n; i++) if (now - tst[i] <= hold && stamp[i] !== now) { stamp[i] = now; near[this.tipNearN++] = i; }
    }
    {
      const mu = this.p.tableMu, glue = this.p.glue * (this.restRadius / 0.5) * (1 - this.fold), H0 = this.H0;   // the tack layer scales with the body (and lets go of a folding one)
      // normal-load proxy for Coulomb friction: this substep's penetration plus the supported weight (g h^2 per
      // particle, concentrated on the particles that are actually touching)
      const load = this.supp * GRAVITY * H * H * Math.min(LOAD_CONC, this.Mtot / Math.max(1, this.nearMass));
      const fload = fingerDown / Math.max(1, this.nearMass);   // a finger pressing down adds its force to the normal load
      let contacts = 0, near = 0, nearM = 0;
      const tstamp = this.touchStamp, tnow = this.subIdx, tnear = this.nearList;
      // the table edges join the contact fold limit while a finger, a grab or the pinned feet work the body and for TABLE_FOLD_AFTER after
      // (the release transient: a full pull let go snaps back onto its glued foot; see foldLimit)
      const worked = this.fingers[0].down || this.fingers[0].retracting || this.fingers[1].down || this.fingers[1].retracting || this.grabs[0].active || this.grabs[1].active || this.pinCount > 0;
      this.tableFoldT = worked ? TABLE_FOLD_AFTER : Math.max(0, this.tableFoldT - H);
      const tfold = this.tableFoldT > 0;
      // ... and with them the foot rim just above the table (TABLE_FOLD_BAND; physics round-2 fix round 2, MAJOR-2): a full pull drags the
      // body over its pinned feet, and the rim particle one row up (2-4 cm, above the NEAR band) buckled at 151-179 degrees for up to 60
      // frames (capnap, pastrel, petalop, taffelin on the soft corner genome)
      const band = tfold ? TABLE_FOLD_BAND * this.restRadius : 0;
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
      }
      // glued feet (a lobe is being pulled, or was just let go): hold them exactly where they were
      if (this.pinCount > 0) {
        if (!grabbing) { this.pinHold -= H; if (this.pinHold <= 0) { this.pinned.fill(0); this.pinCount = 0; } }
        const pn = this.pinned;
        if (this.pinCount > 0) for (let i = 0; i < n; i++) if (pn[i]) { XP[i * 3] = X[i * 3]; XP[i * 3 + 1] = 0; XP[i * 3 + 2] = X[i * 3 + 2]; }
      }
      // land detection: first contact after being airborne, speed = centre-of-mass fall speed
      if (near > 0) {
        if (this.airSub >= 8 && -this.vcy > LAND_MIN_SPEED) this.pendingLand = Math.max(this.pendingLand, -this.vcy);
        this.airSub = 0;
      } else if (this.airSub < 100000) this.airSub++;
      this.contactCount = contacts;
      this.nearCount = near; this.nearMass = nearM;
      this.supp = smooth01((near - 1) / 4);
    }

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
    if (this.neckT !== this.neckTarget) {
      this.neckT += (this.neckTarget - this.neckT) * (1 - Math.exp(-h / NECK_TAU));
      if (Math.abs(this.neckTarget - this.neckT) < 1e-4) this.neckT = this.neckTarget;
      if (this.neckT === 0 && this.neckTarget === 0) this.neckOn = false;
    }
    // (no conditional between a small integer and a double here: V8 boxes such a value, one HeapNumber per frame)
    const fs = Math.cbrt(this.fracNow / this.fracBuilt), fk = this.flatK, nk = this.neckT * (this.neckOn ? 1 : 0);
    this.volScale = fs * fs * fs;
    this.volNeck = nk;   // the volume constraint stiffens with the neck (substep; a field: the substep's own int / double mix was boxed)
    const fd = this.fold, bo = this.burstO, ta = this.trembleAmp * TREMBLE_AMP * this.restRadius;
    const shaped = fd !== 0 || bo !== 0 || fs !== 1 || fk !== 0 || nk !== 0;
    if (!this.memOn && !shaped && ta === 0) {
      if (this.goalOn) { this.QG.set(Q); this.LQG.set(this.LQ); this.goalOn = false; }
      if (this.edgesBent) this.restoreEdges();
      return;
    }
    // GB = the goal without the memory arm: (Q + fold (QS - Q) + flat face (FLAT - Q)) x (1 + burst) x cbrt(frac / built), then the neck
    const QG = this.QG, QGN = this.QGN, GB = this.GB, QS = this.QS, FL = this.FLAT, MEM = this.MEM, NRM = this.NRM, wm = this.wm, sc = (1 + bo) * fs, TPH = this.TPH;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, qx = Q[i3], qy = Q[i3 + 1], qz = Q[i3 + 2];
      GB[i3] = (qx + fd * (QS[i3] - qx) + fk * (FL[i3] - qx)) * sc;
      GB[i3 + 1] = (qy + fd * (QS[i3 + 1] - qy) + fk * (FL[i3 + 1] - qy)) * sc;
      GB[i3 + 2] = (qz + fd * (QS[i3 + 2] - qz) + fk * (FL[i3 + 2] - qz)) * sc;
    }
    this.fracScale = fs;
    if (nk > 0) this.neckGoal();   // (no arguments: doubles passed to a call this large are boxed; it reads neckT and fracScale)
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
   * CUT: the NECK (setNeck; CUT.md 4.2) applied to GB (rest frame). The world plane is carried into the rest frame by the body's current
   * frame; the particles near it (Gaussian over NECK_SIGMA rest radii either side) are pulled toward the axis through the centroid of the
   * cross-section, by up to (1 - NECK_WAIST) at t = 1: a waisted peanut. The volume constraint keeps the volume, so the lobes swell.
   */
  private neckGoal(): void {
    const t = this.neckT, fs = this.fracScale;
    const GB = this.GB, n = this.n, q = this.qr, qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    // R^T (plane point - centre), R^T normal
    const dx = this.npx - this.cx, dy = this.npy - this.cy, dz = this.npz - this.cz;
    const px = r00 * dx + r10 * dy + r20 * dz, py = r01 * dx + r11 * dy + r21 * dz, pz = r02 * dx + r12 * dy + r22 * dz;
    const nx = r00 * this.nnx + r10 * this.nny + r20 * this.nnz, ny = r01 * this.nnx + r11 * this.nny + r21 * this.nnz, nz = r02 * this.nnx + r12 * this.nny + r22 * this.nnz;
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
      const ty = lo + 0.5 * NECK_WAIST * (hi - lo);
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
    const k = (1 - NECK_WAIST) * t, v0 = K[4];
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
    let ox = 0, oy = 0, oz = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, dx = X[i3] - cx, dy = X[i3 + 1] - cy, dz = X[i3 + 2] - cz;
      const gx = GB[i3] - Q[i3], gy = GB[i3 + 1] - Q[i3 + 1], gz = GB[i3 + 2] - Q[i3 + 2];
      const px = r00 * dx + r10 * dy + r20 * dz - gx, py = r01 * dx + r11 * dy + r21 * dz - gy, pz = r02 * dx + r12 * dy + r22 * dz - gz;
      let mx = MEM[i3], my = MEM[i3 + 1], mz = MEM[i3 + 2];
      const ex = px - mx, ey = py - my, ez = pz - mz, len = Math.sqrt(ex * ex + ey * ey + ez * ez), excess = len - yl;
      if (excess > 0 && len > 1e-12) { const k = kFlow * excess / len; mx += ex * k; my += ey * k; mz += ez * k; }
      if (kHeal > 0) { mx += (Q[i3] - mx) * kHeal; my += (Q[i3 + 1] - my) * kHeal; mz += (Q[i3 + 2] - mz) * kHeal; }
      let fx = mx - Q[i3], fy = my - Q[i3 + 1], fz = mz - Q[i3 + 2];
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (fl > maxD) { const r = maxD / fl; fx *= r; fy *= r; fz *= r; }
      MEM[i3] = Q[i3] + fx; MEM[i3 + 1] = Q[i3 + 1] + fy; MEM[i3 + 2] = Q[i3 + 2] + fz;
      ox += M[i] * fx; oy += M[i] * fy; oz += M[i] * fz;
    }
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
    const gdv = vcy > 0 ? vcy * this.peelK : 0;
    this.vcx = vcx; this.vcy = vcy - gdv; this.vcz = vcz;

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
      vx += -ga * avx - gr * (ivx - avx) - dr * vx + (awy * rz - awz * ry);
      vy += -ga * avy - gr * (ivy - avy) - dr * vy + (awz * rx - awx * rz) - gdv;
      vz += -ga * avz - gr * (ivz - avz) - dr * vz + (awx * ry - awy * rx);
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) { const s = MAX_SPEED / Math.sqrt(s2); vx *= s; vy *= s; vz *= s; }
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
    }
    this.keAcc += 0.5 * ke / sm;
    this.keSubs++;
  }

  /** Per-substep bookkeeping that emits events (cheap). */
  private postSubstep(): void {
    for (let k = 0; k < 2; k++) {
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
      this.emit('land', lx, 0, lz, 0, 1, 0, clamp(this.pendingLand / LAND_NORM, 0.05, 1), 0, -1);
      this.pendingLand = -1;
    }
  }

  private emit(kind: SoftEventKind, x: number, y: number, z: number, nx: number, ny: number, nz: number, intensity: number, heldFor: number, finger: number): void {
    const li = KIND_INDEX[kind] * 3 + (finger + 1);
    if (this.simTime - this.lastEvent[li] < EVENT_MIN_GAP_S) return;
    if (this.events.length >= 128) return;
    this.lastEvent[li] = this.simTime;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.events.push({
      kind, at: { x, y, z }, normal: { x: nx / nl, y: ny / nl, z: nz / nl },
      intensity: clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1), heldFor, finger,
    });
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
    const f0 = this.fingers[0], f1 = this.fingers[1];
    const nf = (f0.down ? 1 : 0) + (f1.down ? 1 : 0);
    if (nf === 2) {
      ax = f1.cx - f0.cx; ay = f1.cy - f0.cy; az = f1.cz - f0.cz;
      const l = Math.sqrt(ax * ax + ay * ay + az * az);
      if (l > 1e-6) { ax /= l; ay /= l; az /= l; } else { ax = 0; ay = 1; az = 0; }
      this.lastAxisX = ax; this.lastAxisY = ay; this.lastAxisZ = az; this.lastAxisT = this.simTime;
    } else if (nf === 1) {
      const f = f0.down ? f0 : f1;
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
    m.fingers = nf;
    m.grabbed = this.grabs[0].active || this.grabs[1].active;
    m.carried = this.carried;
    // pull: the live PULL LEVEL (pullLevel: translation-free, 1 = the family's maxPull) of the deeper of the active grabs, 0 without one
    // (written out, not pullLevel(): a double returned from a call this large function does not inline is boxed, one HeapNumber per frame)
    {
      let pl = 0;
      const maxD = Math.max(1e-9, this.p.maxPull * this.restRadius), tk = this.pinCount > 0 ? 0 : 1;   // (see pullLevel: the base's travel)
      for (let k = 0; k < 2; k++) {
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
    for (let k = 0; k < 2; k++) {
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
        const ff0 = this.fingers[0], ff1 = this.fingers[1];
        if ((ff0.retracting && ff0.contacted && ff0.holdT >= 0.1) || (ff1.retracting && ff1.contacted && ff1.holdT >= 0.1)) this.strandsT = 1;
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
