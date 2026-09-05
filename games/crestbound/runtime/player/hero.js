/**
 * CRESTBOUND — runtime/player/hero.js
 * ---------------------------------------------------------------------------
 * NIM — the hero. CONTRACT §13.
 *
 *   export class Hero {
 *     constructor(scene, mats, quality);
 *     root;                      // THREE.Group at player.renderPos, rotation.y = facing
 *     update(dt, player);        // pose blend from player.anim/animT/vel/grounded
 *     setTheme(theme); setVisible(v); setPower(powerId|null);
 *     shadowBlob;                // soft radial plane, projected onto the ground below
 *   }
 *
 * ===========================================================================
 * DESIGN
 * ===========================================================================
 * Nim is a stylised explorer in the A-Hat-in-Time / Astro-Bot register: a big
 * round head (0.50 m across), a compact 0.55 m barrel of a coat, chunky boots
 * and mitten hands, goggles pushed up on the brow, a small pack with a rolled
 * blanket, and a long scarf that does all the secondary motion the skeleton
 * cannot. Total height 1.50 m — exactly `TUNE.height`, so the silhouette and
 * the collision capsule agree and the player can read their own clearance.
 *
 * Everything is procedural. There is no GLB, no image file and no naked
 * primitive anywhere: every visible part is a lathe of an authored profile, a
 * chamfered box from `builders.bevelBoxGeometry`, a tapered tube from
 * `builders.tubeGeometry`, or a merge of several of those. Parts that share a
 * material AND a bone are merged at construction, which is what keeps a fully
 * articulated character down to ~26 draw calls.
 *
 * ---------------------------------------------------------------------------
 * RIG
 * ---------------------------------------------------------------------------
 * A hierarchy of plain Object3Ds — no SkinnedMesh, no skinning cost, and every
 * bone is a real transform the harness can read:
 *
 *   root ──► rig ──► hips ──► spine ──► chest ──► neck ──► head ──► eyes/goggles
 *                      │                  ├─► shoulderR ─► upperArmR ─► lowerArmR ─► handR
 *                      │                  └─► shoulderL ─► upperArmL ─► lowerArmL ─► handL
 *                      ├─► upperLegR ─► lowerLegR ─► footR
 *                      └─► upperLegL ─► lowerLegL ─► footL
 *
 * `root` carries world position + facing (contract). `rig` carries everything
 * the ANIMATOR owns and the world must not see baked into facing: squash /
 * stretch scale, the flip rotations (somersault, backflip, cartwheel, pound
 * spin), the run bob and the lean. Splitting them means a somersault never
 * corrupts `root.rotation.y`, which other systems read.
 *
 * Bone convention: a limb's own axis runs down −Y, so a POSITIVE rotation about
 * X swings its tip toward −Z, i.e. FORWARD (yaw 0 faces −Z, contract §0). The
 * character's right is +X. This is asserted once here and assumed everywhere
 * below, so every pose number reads as "positive = forward".
 *
 * ---------------------------------------------------------------------------
 * ANIMATOR
 * ---------------------------------------------------------------------------
 * Two layers that never fight:
 *
 *  1. POSE — one writer per controller state (§11's list, all 31 of them) fills
 *     a flat table of per-bone Euler TARGETS. Every frame the rest pose is
 *     copied in first, so a writer only states what it actually changes.
 *     Targets are then integrated toward with an exponential (critically
 *     damped) smoother at 14 /s per bone, 18 /s for the root — the contract's
 *     numbers — which is what makes state changes read as a body accelerating
 *     rather than a puppet snapping.
 *
 *  2. CYCLES — procedural, phase-driven, layered on top of the pose. The run
 *     cycle is driven by DISTANCE TRAVELLED, not by time: stride 1.90 m at a
 *     full run, 1.10 m at a walk, interpolated by the analog speed. Feet
 *     therefore never skate — the contact phase is locked to ground motion at
 *     every stick magnitude, which is the single biggest tell between a
 *     hand-made platformer and a shipped one. On top: contra-rotating arm
 *     swing, hip sway with counter-rotating shoulders, a 2× head bob, lean into
 *     the turn from `player.leanX` and forward lean from normalised speed.
 *
 * Flips are NOT sprung — a somersault has to land on exactly one turn, so
 * `jump3` drives root pitch through +2π over its measured air time, `backflip`
 * through −2π, `sideflip` rolls a full cartwheel, and `poundHang` spins yaw 2π
 * inside its 0.20 s hang. They are written straight to the rig and then decay
 * out over the landing.
 *
 * Squash and stretch: 0.85 on landing, 1.12 leaving the ground, volume
 * preserved on XZ, sprung back at 13 /s.
 *
 * Feet plant: while grounded a two-bone analytic IK pulls each foot onto the
 * ground plane implied by `player.pos` + the ground normal, blended in by a
 * weight that falls to zero the moment the hero leaves the floor. Slopes get
 * an ankle roll so the boot sole lies flat instead of stabbing the hill.
 *
 * ---------------------------------------------------------------------------
 * SCARF
 * ---------------------------------------------------------------------------
 * A 7-link Verlet chain (8 particles) simulated in WORLD space so it carries
 * real inertia through a run, a flip and a wall kick. Forces: gravity,
 * air drag, a wind term derived from the hero's own velocity (so it streams
 * behind at speed and settles at rest) and a slow gust. Constraints, three
 * relaxation passes: segment length, and a sphere push-out around the chest so
 * it can never sink into the coat. The ribbon geometry is rebuilt in place into
 * a pre-allocated Float32Array — no allocation, no BufferGeometry churn.
 *
 * ---------------------------------------------------------------------------
 * SHADOW
 * ---------------------------------------------------------------------------
 * Nim casts a real shadow (castShadow on, receiveShadow off — a 1.5 m character
 * self-shadowing at this scale only ever produces acne), PLUS a contact blob:
 * a radial-alpha disc on a custom ShaderMaterial with depthWrite off, projected
 * by a single downward `world.broadphase.raycast` onto whatever is beneath, laid
 * on the surface normal, spreading and fading with altitude. The blob is what
 * makes a landing readable; the cast shadow is what makes the hero belong to the
 * scene. Both are needed.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE
 * ---------------------------------------------------------------------------
 * `update()` performs ZERO heap allocation: every temporary is module scope,
 * the bone table is a fixed array of records, the Verlet state is two
 * Float32Arrays, and the shadow raycast writes into a reused result object.
 * Quality scales lathe/tube segment counts and the scarf's relaxation passes.
 *
 * @module runtime/player/hero
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bevelBoxGeometry, discGeometry } from '../world/builders.js';
// bevelBoxGeometry / tubeGeometry / discGeometry are the studio's shared
// vocabulary (world/builders.js). Everything they do not cover — a lathe of an
// authored profile, a tapered limb capsule — is built below in the SAME
// non-indexed {position, normal, uv} format so any combination can be merged.
import {
  clamp, clamp01, lerp, damp, dampAngle, smoothstep, mulberry32, numOr, TAU,
} from '../core/util.js';
import { TUNE } from '../core/tuning.js';

/* ═════════════════════════════════ constants ═════════════════════════════════ */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Proportions, metres. Read as: feet on y = 0, crown at 1.50 m (= TUNE.height).
 * Head 0.50 m across and torso 0.55 m tall are the two numbers the silhouette
 * lives or dies by; everything else is derived so the joints land on them.
 */
const P = {
  hipY: 0.66,          // hips bone, world y at rest
  hipDrop: 0.04,       // leg sockets sit slightly below the hips bone
  spineY: 0.10,        // spine   local +y from hips
  chestY: 0.18,        // chest   local +y from spine   -> world 0.94
  neckY: 0.16,         // neck    local +y from chest   -> world 1.10
  headY: 0.12,         // head    local +y from neck    -> world 1.22
  headR: 0.250,        // head radius -> crown 1.47, hair tuft to ~1.52
  torsoR: 0.205,       // coat half-width at the chest
  waistR: 0.170,
  shoulderX: 0.185,
  shoulderY: 0.055,
  upperArm: 0.215,
  lowerArm: 0.195,
  handLen: 0.105,
  legX: 0.112,
  upperLeg: 0.245,
  lowerLeg: 0.215,
  ankleY: 0.160,       // boot top / ankle joint
  bootH: 0.160,
  bootL: 0.300,
  bootW: 0.170,
};

/** Stride lengths (metres of ground travel per FULL cycle). Contract §13. */
const STRIDE_RUN = 1.90;
const STRIDE_WALK = 1.10;

/**
 * Fold whole turns out of a flip angle. A completed turn is visually the
 * identity, so when a driver lets go of a flip channel only the fraction still
 * owed should unwind — otherwise a finished somersault plays a full circle
 * BACKWARDS on the way out (measured: the backflip re-inverted the other way
 * between f40 and f46). Idempotent: |a| < PI already folds to itself.
 */
function foldTurns(a) { return a - TAU * Math.round(a / TAU); }

/** Blend rates — the contract's critically-damped spring constants. */
const BONE_LAMBDA = 14;
const ROOT_LAMBDA = 18;
const SQUASH_LAMBDA = 13;

/**
 * Rate the CYCLIC layer's envelope fades in and out at.
 *
 * Why there is a second layer at all — measured, not guessed. `damp()` is a
 * first-order low pass: fed a sinusoid at omega it returns
 * `lambda / hypot(lambda, omega)` of the amplitude, lagging by
 * `atan(omega/lambda)`. At the contract's full run (`TUNE.speedRun` 9.0 m/s
 * over a `STRIDE_RUN` 1.90 m cycle) that is 4.74 Hz, omega = 29.8 rad/s, so a
 * BONE_LAMBDA of 14 delivered only 0.426 of every authored amplitude, 64.8
 * degrees late: the authored 0.80 rad leg swing arrived as 0.341 and the
 * headline sprint read as a brisk walk (measured on the phase-exact run strip
 * — upperArm peak 0.394 against a predicted 0.392).
 *
 * So periodic channels are written to `b.cx/cy/cz` and added AFTER the spring
 * — undamped, therefore delivered at full amplitude and in phase — while the
 * spring keeps doing the one job it is good at: blending between STATES. The
 * envelope below is what crossfades the cyclic layer when the state changes;
 * the oscillation inside it is never smoothed.
 */
const CYC_LAMBDA = 13;

/** Squash / stretch extremes. */
const SQUASH_LAND = 0.85;
const STRETCH_JUMP = 1.12;

/**
 * Turns per second the ground pound keeps spinning at THROUGH THE FALL, on top
 * of the full turn the 0.20 s hang already banked. CONTRACT §13 is "pound spin
 * + fist"; the spin used to stop dead when the hang ended, which measured as
 * hips roll 0.1 / −0.3 / 0.8 deg across the whole drop — a statue at 40 m/s.
 */
const POUND_SPIN_HZ = 2.4;

/**
 * Height of the rig's ROTATION pivot above the soles, metres. Every flip, lean
 * and topple turns about this point — the hips (`P.hipY` 0.66 less the small
 * drop to the joint) — not about the feet. See `_applyRoot`.
 */
const RIG_PIVOT_Y = 0.62;

/**
 * Boot sole contact points, foot-local metres from the ankle. These are the
 * geometry the sole clamp measures — keep them in step with _buildLegs().
 */
const SOLE_TOE_Z = 0.186;
const SOLE_HEEL_Z = 0.086;

/**
 * Skull profile in units of `P.headR`, bottom-to-top: `[radiusMul, yMul]`.
 * ONE source of truth. The skull lathe, the hair shell, the mouth arc and the
 * eye sinking all read it, so a hair cap can never again close BELOW the crown
 * (which is what left Nim bald from the follow camera) and an eyeball can never
 * again be authored 9 mm OUTSIDE the surface it is supposed to sit in.
 */
/**
 * Historical: the LATHE profile the head used to be built from, kept because
 * the header and the eye notes are measured against it. Nothing reads it any
 * more — `headDirRadius` below replaced it (see the note there).
 */
const SKULL_LEGACY = [
  [0.000, -0.96], [0.400, -0.90], [0.740, -0.66], [0.940, -0.28],
  [1.000, 0.06], [0.950, 0.42], [0.740, 0.72], [0.400, 0.92], [0.000, 0.99],
];
void SKULL_LEGACY;

/**
 * HEAD SHAPE — one smooth radial field, no merged solids.
 *
 * ROUND 4 (critic, `_shots/hero/_r2_headzoom.png`): the head scored a hard
 * reject for being LUMPY — "a shading crease runs temple → cheek → jaw", "the
 * crown is dented", "three flesh-coloured lumps" (nose plus two cheek pads
 * that read as warts), "ears are bare skin spheres … a fourth and fifth face
 * lump". Every one of those is the SAME defect: the head was a lathe with four
 * separate closed solids (jaw wedge, two cheek pads, two ear cylinders, a
 * two-part nose) merged INTO it, and two intersecting closed surfaces meet at a
 * hard crease with two sets of normals. No amount of tuning the pieces removes
 * a crease that intersection geometry creates.
 *
 * So the skull, the jaw, the brow ridge and the nose are now ONE C1-continuous
 * radial function `headDirRadius(d)` sampled on a sphere: the surface is
 * `d · headDirRadius(d)`, normals come from central differences of that same
 * function, and there is no seam anywhere on the face because there is no
 * second surface. The cheek pads are gone entirely (the jaw term does that job
 * smoothly); the ears are the only remaining separate part and they moved off
 * the face to the silhouette, behind the widest point and below brow height.
 */
const HEAD_JAW = 0.040;      // metres of forward-and-down fullness (the chin)
const HEAD_BROW = 0.0085;    // brow ridge over the eyes
const NOSE_LAT = -0.26;      // nose axis latitude, rad below the head equator
const NOSE_NY = Math.sin(NOSE_LAT);
const NOSE_NZ = -Math.cos(NOSE_LAT);
const NOSE_UY = Math.cos(NOSE_LAT);
const NOSE_UZ = Math.sin(NOSE_LAT);
/*
 * The nose kernel is ASYMMETRIC, and that is the whole design. A symmetric
 * bump 25 mm proud over a 140 mm base was measured on the first Round 4 build
 * (`_shots/hero/_r3_headzoom.png`) and it VANISHED — at this stylisation a
 * gentle swell with no shadow line under it is not a nose. A button nose reads
 * because the BRIDGE blends up into the brow while the BASE drops off sharply
 * enough to catch a shadow: the up half-angle is wide (0.24), the down half
 * narrow (0.175). The FALLOFF matters as much as the amplitude: a
 * `(1 - q)^1.8` kernel has zero slope at its rim, so it melts into the cheek
 * and photographed as no nose at all even at 40 mm proud (`_r3_headzoom.png`,
 * second Round 4 build). `1 - q^2.5` holds ~82 % of its height out to half
 * radius and then leaves the surface at a finite, steep slope — a real base
 * line for the light to break on, which is what a nose actually is.
 * Extent: 100 mm wide, 100 mm tall, 48 mm proud, y in [-0.108, -0.005], so the
 * TOP of it still lands below the eyes' lower rim — the constraint the
 * pre-Round-4 face broke.
 */
const NOSE_AX = 0.200;       // kernel half-angle across the face
const NOSE_AY_UP = 0.240;    // ...up toward the brow (blends)
const NOSE_AY_DN = 0.175;    // ...down toward the lip (sharp, casts)
const NOSE_H = 0.048;        // metres proud at the tip

/**
 * Eye placement. ROUND 4 rejects, in the critic's words: "small white ovals
 * with an oversized black pupil, no iris colour and no catchlight, set ~60 %
 * down the skull and roughly 2.5 eye-widths apart, with the nose landing
 * BETWEEN them … vacant and squashed downward, the opposite of the Astro Bot /
 * A Hat in Time eye placement (eyes high, large, wet)."
 *
 * Four numbers move together, and the visible LENS is what they are solved for
 * rather than the ball. A ball of radius `EYE_R` sunk so that `EYE_PROUD`
 * stands outside the skull shows a lens of radius
 * `sqrt(EYE_PROUD·(2·EYE_R − EYE_PROUD))`:
 *   old  0.042 ball, 7.3 mm proud → 23.7 mm lens radius, centres 148 mm apart
 *        = 3.1 lens-widths of gap. Small, low, wide — the vacant read.
 *   new  0.056 ball, 13.1 mm proud → 36 mm lens radius, centres 111 mm apart
 *        = 1.55 lens-widths. Large, high, close.
 * The sink is measured against the ACTUAL surface at build time (see
 * `_buildHead`), not against a remembered radius, so the brow ridge and the jaw
 * term can move without un-sinking the eyeballs.
 */
const EYE_YAW = 0.285;                      // rad off dead-ahead, per eye
const EYE_R = 0.056;                        // eyeball radius
const EYE_PROUD = 0.0131;                   // metres of ball outside the skull
const EYE_Y = 0.036;                        // eye height, head-local metres
const PUPIL_R = 0.0200;                     // iris cap radius on the eyeball
const IRIS_INNER = 0.0092;                  // pupil radius inside the iris
const IRIS_LIMBAL = 0.0182;                 // dark limbal ring starts here
const GLINT_R = 0.0105;                     // catchlight bead

/**
 * Face furniture heights, head-local metres. They are stated together because
 * they are solved together — the critic's "brows … floating a full eye-height
 * above the eyes" and "the image-right brow clips the goggle strap" are the
 * same failure, a face laid out feature by feature instead of as a stack.
 * Measured clearances at these numbers, from the built geometry:
 *   eye lens top      0.072   ─┐  7 mm
 *   brow underside    0.079   ─┘
 *   brow top          0.101   ─┐ 27 mm
 *   goggle rim bottom 0.128   ─┘
 *   goggle rim top    0.217   ─┐ 13 mm
 *   hairline (front)  0.230   ─┘
 */
const BROW_Y = 0.086;
const GOG_Y = 0.172;                        // goggle cup centre height
const GOG_AZ = 0.380;                       // rad off dead-ahead, per cup
const GOG_STRAP_Y0 = 0.150;
const GOG_STRAP_Y1 = 0.205;

/** Mouth: a swept LIP, one continuous tube — see `_buildHead`. */
const MOUTH_Y = -0.145;
const MOUTH_SWEEP = 0.300;                  // half the azimuth arc, rad
const MOUTH_LIFT = 0.020;                   // how far the corners curl up

/**
 * How far the pupils may travel off centre, as a rotation about the HEAD axis.
 * At the eye's 0.21 m radius this is 6.7 mm of slide — a dart. The old 0.34
 * was 71 mm, which threw the irises clean off the eyeballs and is most of why
 * they read as chrome rings rather than pupils.
 */
const PUPIL_LOOK_YAW = 0.042;
const PUPIL_LOOK_PITCH = 0.036;

/** Idle "look around" fires after this many seconds of standing still. */
const IDLE_LOOK_AFTER = 4.0;

/** Ceiling on the idle look-around head yaw, radians. */
const LOOK_YAW_MAX = 0.58;

/** Blink cadence, seconds. */
const BLINK_MIN = 3.0;
const BLINK_MAX = 5.0;
const BLINK_TIME = 0.13;

/** Scarf. */
const SCARF_LINKS = 7;                 // contract: 7 links => 8 particles
const SCARF_SEG = 0.105;               // metres per link -> ~0.74 m of scarf
const SCARF_GRAVITY = -15.5;
const SCARF_DAMP = 0.965;              // velocity retention per Verlet step
const SCARF_WIND = 0.115;              // how hard the hero's own velocity drags it
const SCARF_BODY_R = 0.255;            // chest sphere the scarf may never enter
/*
 * HEAD sphere, and the anchor offset that goes with it.
 *
 * The chain used to be pinned at `bones.neck` + 0.04 Y with NO backward offset,
 * and the ONLY body collider was the chest sphere. In every face-down or
 * horizontal pose (land, swim, fly, longjump, dive) gravity therefore dragged
 * the chain straight across the jaw: measured in five separate captures, where
 * it rendered as a smooth white tapered blade out of Nim's mouth — a beak — and
 * in dive_p90 as a V of both tails out of the face.
 *
 * Two fixes, both at the generator:
 *  1. The collar is pinned BEHIND the neck (`SCARF_ANCHOR_BACK` along the neck
 *     bone's own +Z, which is backward — yaw 0 faces −Z, contract §0), so the
 *     chain starts on the nape and never on the throat.
 *  2. A head sphere joins the chest sphere in the push-out pass, so no relaxed
 *     particle can end up inside the skull, the muzzle or the goggles.
 * The radius clears the nose (0.250 skull + 0.048 proud at the tip).
 */
const SCARF_HEAD_R = 0.265;
const SCARF_ANCHOR_BACK = 0.135;       // metres behind the neck, neck-local +Z
const SCARF_ANCHOR_UP = 0.030;         // ...and up, neck-local +Y
const SCARF_ANCHOR_SIDE = 0.070;       // ...and off the centreline, neck-local +X
/*
 * Lateral bias, metres/s^2, toward the hero's RIGHT (the same side the existing
 * `drape` term pushes). Anchoring on the nape and adding a head sphere put the
 * chain 0.24-0.40 m clear of the face in WORLD space (measured, _hf_scarf.json)
 * — but a chain that hangs in the hero's SAGITTAL plane still projects across
 * the jaw from the front-three-quarter camera every gate photographs him from.
 * A real scarf never hangs in that plane: it lies over a shoulder. This is the
 * force that puts it there, and unlike `drape` it does not fade out at speed —
 * speed is exactly when the prone states that failed occur.
 */
const SCARF_SIDE = 6.4;
/**
 * ROUND 4 (critic): "SCARF GEOMETRY reads as a flat rigid slab … a
 * zero-thickness 7-quad DoubleSide ribbon … in profile it is a flat red plank
 * glued down the chest to the waist — no fold, no taper read, no thickness."
 * The verlet chain was explicitly cleared ("the chain itself is FINE"), so the
 * fix is the SKIN, not the solver: the ribbon is now a four-sided prism with a
 * real thickness that tapers to the tip and a twist that runs down the chain
 * and increases with speed, so the cloth turns edge-on and back as it trails.
 */
const SCARF_W0 = 0.105;                // ribbon half-width at the collar
const SCARF_W1 = 0.050;                // ...and at the tip
const SCARF_H0 = 0.021;                // half-THICKNESS at the collar
const SCARF_H1 = 0.009;                // ...and at the tip
const SCARF_TWIST = 0.62;              // rad of twist accumulated down the chain
const SCARF_FACES = 4;                 // sides of the prism

/** Palette. The coat is the read-at-40-m silhouette colour; keep it hot. */
const COL = {
  coat: 0xd8532b,        // warm orange-red
  coatDark: 0xa63a1c,    // shadowed panels / under-flap
  trim: 0x2c4a52,        // dark teal — mittens, collar, cuffs, knee caps
  /* ROUND 3 (critic, `_shots/_vz_herohead.png`): under the Keep courtyard key
   * the head rendered as a FLAT BLOWN CREAM DISC — no brow, no shading, no
   * highlight rolloff — and it was the single brightest object in the frame, so
   * bloom then haloed it. 0xf3cba4 is 0.95/0.80/0.64: at the top of the curve
   * before any light is applied, so every bit of the sculpted brow, jaw and
   * goggle shadow the model carries was being compressed into clip. Pulled down
   * ~18 % in sRGB (~30 % in linear), which is where a mid-fair skin actually
   * sits and leaves the whole shading range above it. */
  skin: 0xc0916b,
  skinShade: 0xa87a58,
  hair: 0x4a2f22,
  boot: 0x37312e,
  leather: 0x7a5233,
  rope: 0x8a6f45,      // pack webbing. Was 0xc7ab7a, one step off the new cream scarf.
  /* ROUND 4 (critic): "the rims render as a scribbled blue-white streak … the
   * least convincing material on him". Two causes, both here: a COOL near-white
   * albedo at metalness 0.94 mirrors the sky into a blown streak, and
   * `PART_M.metal` 0.16 asked for a 16-tiles-per-part repeat on a 12 mm-wide
   * lathe rim, which is the scribble. Warm brass at a lower metalness holds a
   * readable specular instead of a mirror, and the texel scale moved with it. */
  metal: 0x9d8148,
  lens: 0x9fe8ff,
  eyeWhite: 0xf7f1e6,
  eyePupil: 0x161b22,
  // IRIS. The pupil mesh is vertex-coloured (one draw, three colours): a dark
  // limbal ring at the rim, warm amber for the iris body, near-black for the
  // pupil itself. The critic's "no iris colour" was literally true — the whole
  // cap was one flat 0x161b22.
  irisRim: 0x2b1a10,
  iris: 0xa8621f,
  irisIn: 0x6d3a12,
  // A LIP, not a brow. The mouth used to be cut from the same dark-brown cloth
  // as the brows and lashes and sat 5 cm under the nose, which read as a
  // moustache in every close-up. Warm berry, clearly not hair.
  lip: 0x9c4a3e,
  blanket: 0xcfd6c8,
  buckle: 0xd8b25c,
};

/**
 * Scarf tint per realm — the one piece of Nim that changes with the world.
 *
 * ROUND 4 (critic): "SCARF DOES NOT READ — colour, not physics. COL.coat
 * 0xd8532b vs SCARF_TINT.verdant = SCARF_DEFAULT = 0xd53a2c is a 1.16:1
 * relative-luminance contrast ratio; on the one course that ships, the scarf is
 * coat-camouflage." Measured: L(coat) = 0.210, L(old verdant scarf) = 0.196.
 *
 * The scarf is the accessory that has to separate from a hot orange coat AND
 * from grass, stone and sky, from 2 m and from 20 m. Only VALUE does that at
 * every distance, so every realm tint is now a high-luminance cloth carrying a
 * realm HUE rather than a realm-saturated mid-tone. Measured L for the new
 * verdant tint is 0.847 — a 3.45:1 ratio against the coat, up from 1.16:1.
 * `_scarfContrast` below enforces the same floor on any palette-derived
 * fallback, so a realm that never lands in this table cannot regress.
 */
const SCARF_TINT = {
  keep: 0xf3ddac,
  verdant: 0xeaf1dc,
  ember: 0xffe9b8,
  rime: 0xe4f2ff,
  azure: 0xdcf6ee,
};
const SCARF_DEFAULT = 0xeaf1dc;

/** Relative-luminance floor the scarf must clear against the coat. */
const SCARF_MIN_LUM = 0.62;

/** Fallback PBR for every material key, used when Mats cannot answer. */
const MAT_FALLBACK = {
  cloth: { color: 0xffffff, roughness: 0.92, metalness: 0.0 },
  rubber: { color: 0xffffff, roughness: 0.78, metalness: 0.0 },
  metal: { color: 0xffffff, roughness: 0.30, metalness: 0.92 },
  glass: { color: 0xffffff, roughness: 0.08, metalness: 0.0 },
  wood: { color: 0xffffff, roughness: 0.80, metalness: 0.0 },
  rope: { color: 0xffffff, roughness: 0.95, metalness: 0.0 },
  plaster: { color: 0xffffff, roughness: 0.88, metalness: 0.0 },
  gold: { color: 0xffffff, roughness: 0.28, metalness: 0.95 },
  emissive: { color: 0xffffff, roughness: 1.0, metalness: 0.0 },
};

/**
 * The size in METRES of the hero part each material dresses. This is half of
 * the texel-scale contract: a world texture is baked for a fixed
 * tiles-per-metre (`texture.repeat`, e.g. plaster 0.30 = one 3.3 m crack
 * network per tile), hero UVs run 0..1 across a part, so the ONLY repeat that
 * shows the pattern at world scale on a part `L` metres across is
 * `L × sourceTilesPerMetre`. Hand-picking 1..4 here is what stretched a 3.3 m
 * wall-crack network across a 0.50 m skull. Keep these in step with the
 * geometry builders below (and with _harness/heromatcheck.py's PART_SIZE).
 */
const PART_M = {
  coat: 0.58, coatDark: 0.58, trim: 0.20, scarf: 0.74,
  skin: 0.50, hair: 0.30, boot: 0.30, metal: 0.08, gold: 0.05,
  leather: 0.24, rope: 0.30, blanket: 0.23, lens: 0.10,
  eyeWhite: 0.12, eyeDark: 0.06, lip: 0.10,
};

/** Bone table order. Index-addressable so the update loop never allocates. */
const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderR', 'upperArmR', 'lowerArmR', 'handR',
  'shoulderL', 'upperArmL', 'lowerArmL', 'handL',
  'upperLegR', 'lowerLegR', 'footR',
  'upperLegL', 'lowerLegL', 'footL',
];

/* ═════════════════════════════════ scratch ═════════════════════════════════ */
/* Module scope. Nothing in update() may allocate — the profiler is watching.  */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _col0 = new THREE.Color();
const _col1 = new THREE.Color();

/** Reused raycast result for the contact blob (Broadphase.raycast writes here). */
const _rayHit = {
  t: 0,
  normal: new THREE.Vector3(0, 1, 0),
  point: new THREE.Vector3(),
  collider: null,
  heightfield: null,
};

/** Two-bone IK output. One shared record — read it before the next solve. */
const _ik = { hip: 0, knee: 0, reached: false };

/* Scarf ribbon scratch. `_writeScarfGeometry` runs every frame and must not
 * allocate, so the two cross-section rings it ping-pongs between, their face
 * normals, the corner offsets and the previous centre all live here. */
const _scarfRingA = new Float64Array(12);
const _scarfRingB = new Float64Array(12);
const _scarfNorA = new Float64Array(12);
const _scarfNorB = new Float64Array(12);
const _scarfPrevC = new Float64Array(3);
const _scarfCX = new Float64Array(4);
const _scarfCN = new Float64Array(4);

/* ═══════════════════════════ geometry primitives ═══════════════════════════ */
/*
 * `builders.js` owns the world's geometry vocabulary and every one of its
 * helpers emits NON-INDEXED {position, normal, uv}, which is what makes any
 * combination legal for `mergeGeometries`. The two shapes a character needs
 * that a platform never does — a lathe of an authored profile and a capsule —
 * are built here in the same format so hero parts merge with builder parts.
 */

/**
 * Revolve a 2D profile around +Y. `pts` is [[radius, y], …] bottom-to-top; a
 * radius of 0 caps the end with a fan. Emits non-indexed pos/normal/uv, with
 * V running along the profile and U around the revolution.
 *
 * @param {Array<Array<number>>} pts
 * @param {number} seg radial segments
 * @returns {THREE.BufferGeometry}
 */
function latheGeo(pts, seg) {
  const s = Math.max(4, seg | 0);
  const n = pts.length;
  const pos = [];
  const nor = [];
  const uv = [];

  // profile normals: perpendicular to each segment in the (r, y) plane,
  // averaged at the shared vertices so the silhouette shades smoothly.
  const pn = new Array(n);
  for (let i = 0; i < n; i++) pn[i] = [0, 0];
  for (let i = 0; i < n - 1; i++) {
    const dr = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dr, dy) || 1;
    const nr = dy / l, ny = -dr / l;      // rotate the tangent +90° outward
    pn[i][0] += nr; pn[i][1] += ny;
    pn[i + 1][0] += nr; pn[i + 1][1] += ny;
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(pn[i][0], pn[i][1]) || 1;
    pn[i][0] /= l; pn[i][1] /= l;
  }

  // total profile length for a proportional V coordinate
  let total = 0;
  const vAt = new Array(n);
  vAt[0] = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    vAt[i] = total;
  }
  if (total > 1e-6) for (let i = 0; i < n; i++) vAt[i] /= total;

  const push = (r, y, nr, ny, a, u, v) => {
    const c = Math.cos(a), si = Math.sin(a);
    pos.push(c * r, y, si * r);
    const nl = Math.hypot(nr, ny) || 1;
    nor.push((c * nr) / nl, ny / nl, (si * nr) / nl);
    uv.push(u, v);
  };

  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * TAU;
    const a1 = ((i + 1) / s) * TAU;
    const u0 = i / s, u1 = (i + 1) / s;
    for (let j = 0; j < n - 1; j++) {
      const r0 = pts[j][0], y0 = pts[j][1];
      const r1 = pts[j + 1][0], y1 = pts[j + 1][1];
      const v0 = vAt[j], v1 = vAt[j + 1];
      if (r0 < 1e-5 && r1 < 1e-5) continue;
      /*
       * WINDING. Every one of these triples used to be emitted in the order
       * that makes the face point INWARD — verified, not argued: a raycast
       * fired at Nim's right eye from 0.8 m in front of his face reported its
       * first FrontSide hit 41 mm BEHIND the eye centre (the far wall of the
       * ball) and its second on the far wall of the SKULL, 0.43 m back. So
       * every lathe part on the hero — skull, jaw, ears, cheeks, nose, eyes,
       * coat, collar, belt, sleeves, thighs, shins, mittens, goggles — was
       * rendering its INSIDE. The stored vertex normals are computed outward,
       * which is why the shading looked plausible and nobody caught it; but a
       * culled near wall cannot occlude anything, so the sunk eyeballs were
       * drawn straight through the face and read as balls glued to it, and the
       * cheeks, nose and jaw did the same. Second and third vertex swapped.
       */
      if (r0 < 1e-5) {
        // bottom cap fan
        push(0, y0, pn[j][0], pn[j][1], a0, u0, v0);
        push(r1, y1, pn[j + 1][0], pn[j + 1][1], a0, u0, v1);
        push(r1, y1, pn[j + 1][0], pn[j + 1][1], a1, u1, v1);
        continue;
      }
      if (r1 < 1e-5) {
        // top cap fan
        push(r0, y0, pn[j][0], pn[j][1], a0, u0, v0);
        push(0, y1, pn[j + 1][0], pn[j + 1][1], a0, u0, v1);
        push(r0, y0, pn[j][0], pn[j][1], a1, u1, v0);
        continue;
      }
      // quad -> two triangles, wound CCW seen from OUTSIDE
      push(r0, y0, pn[j][0], pn[j][1], a0, u0, v0);
      push(r1, y1, pn[j + 1][0], pn[j + 1][1], a1, u1, v1);
      push(r0, y0, pn[j][0], pn[j][1], a1, u1, v0);

      push(r0, y0, pn[j][0], pn[j][1], a0, u0, v0);
      push(r1, y1, pn[j + 1][0], pn[j + 1][1], a0, u0, v1);
      push(r1, y1, pn[j + 1][0], pn[j + 1][1], a1, u1, v1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Capsule as a lathe profile — a limb, not a pill: `rTop`/`rBot` taper so an
 * upper arm reads thicker at the shoulder. Origin at the TOP of the shaft so a
 * bone can own it directly (limbs run down −Y).
 */
function limbGeo(rTop, rBot, len, seg, rings) {
  const rr = Math.max(3, rings | 0);
  const pts = [];
  /*
   * Bottom hemisphere, POLE FIRST.
   *
   * This loop used to run `i = rr … 1`, which emitted the cap equator-DOWNWARD
   * — the opposite of the bottom-to-top order `latheGeo` winds against — and
   * stopped one step short of `r = 0`, so it never closed. What every
   * `limbGeo` part actually rendered was: a back-facing (therefore CULLED)
   * lower hemisphere, a straight cone cutting the corner back up to the
   * equator, and an open hole at the pole. A `limbGeo(r, r, 0.001, …)` sphere
   * — every eyeball, cheek pad, nose tip, ear, knee cap and goggle rivet on
   * Nim — was a hollow BOWL, which is most of why the eyes photographed as two
   * lit domes stuck on the face with a seam across the middle instead of as
   * balls sunk in a socket. Ascending order closes the cap (`latheGeo` fans an
   * `r = 0` end) and costs 3 triangles per segment LESS than the fault did.
   */
  for (let i = 0; i <= rr; i++) {
    const a = (i / rr) * Math.PI * 0.5;
    pts.push([rBot * Math.sin(a), -len - rBot * Math.cos(a)]);
  }
  pts.push([rTop, 0]);
  // top hemisphere
  for (let i = 1; i <= rr; i++) {
    const a = (i / rr) * Math.PI * 0.5;
    pts.push([rTop * Math.cos(a), rTop * Math.sin(a)]);
  }
  // profile runs bottom-to-top already
  return latheGeo(pts, seg);
}

/**
 * Skull radius in METRES at a head-local height `y`, read off the one `SKULL`
 * profile. 0 at or above the crown and below the chin. Construction-time only.
 * @param {number} y @returns {number}
 */
function skullRadius(y) {
  return headRadiusAtHeight(-Math.PI * 0.5, y);
}

/* ───────────────────────── the head, as one surface ───────────────────────── */
/*
 * `headDirRadius` is the ONLY description of Nim's head. Skull, jaw, chin, brow
 * ridge and nose are additive terms in it, so the surface it defines is smooth
 * everywhere and there is no intersection seam to shade as a crease. Everything
 * that needs to sit ON the head — hair shell, mouth, brows, goggles, eyes —
 * asks this function where the surface is instead of assuming a sphere.
 * Construction time only; nothing here runs per frame.
 */

/** Radius, metres, along the unit direction (dx, dy, dz). Head-local. */
function headDirRadius(dx, dy, dz) {
  const R = P.headR;
  const u = dy;
  const dn = u < 0 ? -u : 0;
  // base egg: widest just under the equator, crown a touch tighter
  let r = R * (1 + 0.024 * (1 - u * u) - 0.030 * u - 0.020 * dn * dn);

  const front = dz < 0 ? -dz : 0;
  // chin + jaw: forward-and-down fullness, faded out at the very bottom pole so
  // the chin is a curve and not a point
  const jf = front * front * (3 - 2 * front);
  const jd = dn * dn * Math.sqrt(dn) * (1 - smoothstep(0.86, 1.0, dn));
  r += HEAD_JAW * jf * jd;

  // brow ridge — a soft band above the eyes, front-facing only
  const bw = (u - 0.215) / 0.150;
  r += HEAD_BROW * jf * front * Math.exp(-bw * bw);

  // nose: an anisotropic raised-cosine cap about a down-and-forward axis. AY is
  // chosen so the kernel reaches zero BELOW the eyes.
  const na = dy * NOSE_NY + dz * NOSE_NZ;
  if (na > 0.30) {
    const nu = dy * NOSE_UY + dz * NOSE_UZ;
    const rawU = Math.atan2(nu, na);
    const ar = Math.atan2(dx, na) / NOSE_AX;
    const au = rawU / (rawU >= 0 ? NOSE_AY_UP : NOSE_AY_DN);
    const q = ar * ar + au * au;
    if (q < 1) r += NOSE_H * (1 - Math.pow(q, 2.5));
  }
  return r;
}

/* scratch for the head builders — construction time, reused so a 36x28 sphere
 * does not allocate 3000 arrays while it is being sampled. */
const _hp0 = [0, 0, 0];
const _hp1 = [0, 0, 0];
const _hp2 = [0, 0, 0];
const _hp3 = [0, 0, 0];
const _hp4 = [0, 0, 0];
const _hn0 = [0, 0, 0];

/**
 * Surface point at (azimuth `a`, elevation `e`). Azimuth matches `latheGeo`:
 * x = r·cos a, z = r·sin a, so the FACE is at a = −π/2.
 */
function headPoint(a, e, out) {
  const ce = Math.cos(e), se = Math.sin(e);
  const dx = ce * Math.cos(a), dy = se, dz = ce * Math.sin(a);
  const r = headDirRadius(dx, dy, dz);
  out[0] = dx * r; out[1] = dy * r; out[2] = dz * r;
  return out;
}

/** Outward unit normal at (a, e), by central differences of `headPoint`. */
function headNormal(a, e, out) {
  const h = 0.006;
  const lim = Math.PI * 0.5 - 1e-3;
  const e0 = e > lim ? lim : (e < -lim ? -lim : e);
  headPoint(a + h, e0, _hp1);
  headPoint(a - h, e0, _hp2);
  const eu = Math.min(lim, e0 + h), ed = Math.max(-lim, e0 - h);
  headPoint(a, eu, _hp3);
  headPoint(a, ed, _hp4);
  const t1x = _hp1[0] - _hp2[0], t1y = _hp1[1] - _hp2[1], t1z = _hp1[2] - _hp2[2];
  const t2x = _hp3[0] - _hp4[0], t2y = _hp3[1] - _hp4[1], t2z = _hp3[2] - _hp4[2];
  let nx = t1y * t2z - t1z * t2y;
  let ny = t1z * t2x - t1x * t2z;
  let nz = t1x * t2y - t1y * t2x;
  let l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l; ny /= l; nz /= l;
  headPoint(a, e0, _hp1);
  if (nx * _hp1[0] + ny * _hp1[1] + nz * _hp1[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  out[0] = nx; out[1] = ny; out[2] = nz;
  return out;
}

/** Elevation whose surface point sits at head-local height `y`, at azimuth `a`. */
function headElevAtHeight(a, y) {
  let lo = -Math.PI * 0.5, hi = Math.PI * 0.5;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) * 0.5;
    headPoint(a, m, _hp0);
    if (_hp0[1] < y) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}

/** Cross-section radius (in the XZ plane) at azimuth `a`, height `y`. */
function headRadiusAtHeight(a, y) {
  headPoint(a, headElevAtHeight(a, y), _hp0);
  return Math.hypot(_hp0[0], _hp0[2]);
}

/** Crown height, metres. Read once so the hair shell can close above it. */
const HEAD_TOP = headDirRadius(0, 1, 0);

/**
 * The head, sampled off `headDirRadius`. Non-indexed with ANALYTIC normals, so
 * adjacent triangles that share a parameter share a normal exactly and the
 * surface shades smooth — which a `computeVertexNormals` on non-indexed
 * geometry cannot do, and which is the other half of why the old head read as
 * faceted and dented.
 */
function headGeo(seg, rings) {
  const s = Math.max(10, seg | 0);
  const n = Math.max(8, rings | 0);
  const pos = [];
  const nor = [];
  const uv = [];
  const lim = Math.PI * 0.5;
  /*
   * NON-UNIFORM azimuth. Uniform sampling spends as many columns on the back of
   * the skull — a plain sphere — as on the nose, and at 36 columns the nose
   * kernel got 2.5 of them, which is why the first Round 4 build shipped a face
   * with no nose on it at all. Warping by `phi - W*sin(phi)` about the face
   * azimuth raises local density by 1/(1 - W) = 1.82x at the nose and drops it
   * to 0.69x at the nape, for exactly zero extra triangles.
   */
  const W = 0.45;
  const aFace = -Math.PI * 0.5;
  // t = 0 and t = 1 both land on the NAPE, so the u = 0 / u = 1 texture seam
  // sits under the hair. Parameterising from the face put that seam on the
  // cheek, and it photographed as a vertical line down the right of the face
  // (`turntable_a0`, second Round 4 build) — the geometry closed exactly, the
  // UVs did not.
  const warp = (t) => {
    const phi = t * TAU - Math.PI;
    return aFace + phi - W * Math.sin(phi);
  };
  const emit = (i, j) => {
    const a = warp(i / s);
    const e = -lim + (j / n) * (2 * lim);
    headPoint(a, e, _hp0);
    headNormal(a, e, _hn0);
    pos.push(_hp0[0], _hp0[1], _hp0[2]);
    nor.push(_hn0[0], _hn0[1], _hn0[2]);
    uv.push(i / s, j / n);
  };
  // winding matches latheGeo's (see the note there): j increases upward
  for (let i = 0; i < s; i++) {
    for (let j = 0; j < n; j++) {
      emit(i, j); emit(i + 1, j + 1); emit(i + 1, j);
      emit(i, j); emit(i, j + 1); emit(i + 1, j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * A closed tube swept along an arc that RIDES the head surface — the lip and
 * the brows. Replaces the 17 separate bevel boxes the critic photographed as
 * "a segmented caterpillar, not a lip": one continuous surface cannot show the
 * seams between beads, because it has none.
 *
 * @param {number} a0,a1   azimuth range of the arc
 * @param {(f:number)=>number} yAt      head-local height at f ∈ [−1, 1]
 * @param {(f:number)=>number} halfW    half-height of the tube across the face
 * @param {(f:number)=>number} halfH    half-thickness outward from the skull
 * @param {number} lift    metres the tube centre stands off the surface
 * @param {number} samples arc samples
 * @param {number} ring    points around the tube
 */
function surfaceTubeGeo(a0, a1, yAt, halfW, halfH, lift, samples, ring) {
  const N = Math.max(3, samples | 0);
  const K = Math.max(4, ring | 0);
  const cx = new Float64Array(N * 3);      // centre
  const sx = new Float64Array(N * 3);      // "up the face" axis
  const nx2 = new Float64Array(N * 3);     // outward axis
  const hw = new Float64Array(N);
  const hh = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const f = (i / (N - 1)) * 2 - 1;
    const a = a0 + (a1 - a0) * (i / (N - 1));
    const y = yAt(f);
    const e = headElevAtHeight(a, y);
    headPoint(a, e, _hp0);
    headNormal(a, e, _hn0);
    cx[i * 3] = _hp0[0] + _hn0[0] * lift;
    cx[i * 3 + 1] = _hp0[1] + _hn0[1] * lift;
    cx[i * 3 + 2] = _hp0[2] + _hn0[2] * lift;
    nx2[i * 3] = _hn0[0]; nx2[i * 3 + 1] = _hn0[1]; nx2[i * 3 + 2] = _hn0[2];
    hw[i] = halfW(f); hh[i] = halfH(f);
  }
  // side axis = normal x tangent, tangent from the centreline itself
  for (let i = 0; i < N; i++) {
    const ia = Math.max(0, i - 1) * 3, ib = Math.min(N - 1, i + 1) * 3;
    let tx = cx[ib] - cx[ia], ty = cx[ib + 1] - cx[ia + 1], tz = cx[ib + 2] - cx[ia + 2];
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const nxi = nx2[i * 3], nyi = nx2[i * 3 + 1], nzi = nx2[i * 3 + 2];
    let ux = nyi * tz - nzi * ty, uy = nzi * tx - nxi * tz, uz = nxi * ty - nyi * tx;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    sx[i * 3] = ux / ul; sx[i * 3 + 1] = uy / ul; sx[i * 3 + 2] = uz / ul;
  }

  const pos = [];
  const nor = [];
  const uv = [];
  const pt = (i, k, o) => {
    const th = (k / K) * TAU;
    const c = Math.cos(th), si = Math.sin(th);
    const wx = sx[i * 3] * hw[i] * c + nx2[i * 3] * hh[i] * si;
    const wy = sx[i * 3 + 1] * hw[i] * c + nx2[i * 3 + 1] * hh[i] * si;
    const wz = sx[i * 3 + 2] * hw[i] * c + nx2[i * 3 + 2] * hh[i] * si;
    o[0] = cx[i * 3] + wx; o[1] = cx[i * 3 + 1] + wy; o[2] = cx[i * 3 + 2] + wz;
    const l = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
    o[3] = wx / l; o[4] = wy / l; o[5] = wz / l;
    return o;
  };
  const A = [0, 0, 0, 0, 0, 0];
  const push = (i, k) => {
    pt(i, k, A);
    pos.push(A[0], A[1], A[2]);
    nor.push(A[3], A[4], A[5]);
    uv.push(k / K, i / (N - 1));
  };
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < K; k++) {
      push(i, k); push(i + 1, k + 1); push(i + 1, k);
      push(i, k); push(i, k + 1); push(i + 1, k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Scratch object used to orient a built geometry's +Y onto an arbitrary axis. */
const _orient = new THREE.Object3D();

/**
 * Place `geo` (authored around +Y) so its +Y points along (nx, ny, nz) at
 * (px, py, pz), with an optional spin about that axis. Construction-time only.
 */
function orientTo(geo, px, py, pz, nx, ny, nz, roll) {
  _v0.set(nx, ny, nz).normalize();
  _q0.setFromUnitVectors(UP, _v0);
  _orient.quaternion.copy(_q0);
  _orient.position.set(px, py, pz);
  _orient.scale.set(1, 1, 1);
  if (roll) _orient.rotateY(roll);
  _orient.updateMatrix();
  geo.applyMatrix4(_orient.matrix);
  return geo;
}

/**
 * HAIR SHELL — a skull-hugging cap whose HAIRLINE varies with azimuth: high at
 * the front (the goggles live on the brow), low at the temples and lower still
 * at the nape, with a ragged edge so the read is hair and not a bowl.
 *
 * This exists because a LATHE cannot do it. The cap it replaced was a lathe
 * that closed at `r = 0` at `0.90 R` — 22 mm BELOW the 0.99 R crown — so the
 * top of the skull came through it and, from the follow camera (26–34 degrees
 * above and behind, the view the player has all game), Nim was a bald ivory egg
 * with a brown patch at the back. Radius here is `skullRadius(y) + off`, so the
 * shell can never sink into the head, and the last ring lands ABOVE the crown,
 * so there is nothing left to be bald.
 *
 * @param {number} seg   azimuth segments
 * @param {number} rings rings from hairline to crown
 * @param {number} off   metres the shell stands off the skull
 * @returns {THREE.BufferGeometry}
 */
function hairShellGeo(seg, rings, off) {
  const R = P.headR;
  const s = Math.max(8, seg | 0);
  const n = Math.max(3, rings | 0);
  const yTop = HEAD_TOP + 0.012;              // above the crown, whatever it is
  const pos = [];
  const uv = [];

  /*
   * ROUND 4 (critic): "HAIR is a scatter of chunky dark-brown blocks on the
   * crown only. From the hairline down to the goggle strap the skull is bare
   * skin, and from behind the whole back of the head is bare tan."
   * Measured cause: this hairline ran `0.52 + 0.32·front` of R, so the NAPE sat
   * at +0.20 R — the shell stopped 5 cm ABOVE the widest point and left the
   * entire lower back of the skull bare from every camera behind Nim, which is
   * the camera the player has all game. Measured at the new coefficients:
   * front 0.60 R (a forehead for the goggles to sit on), temples 0.10 R, nape
   * −0.60 R — hair closes below the ears and wraps the whole back of the head,
   * which `turntable_a4` now shows.
   *
   * `latheGeo` convention: x = r·cos a, z = r·sin a, so the FACE is at
   * sin a = −1 and `front` runs +1 (brow) .. −1 (nape).
   */
  const line = (a) => {
    const front = -Math.sin(a);
    return R * (0.10 + 0.60 * front - 0.10 * front * front
      + 0.055 * Math.sin(a * 5 + 0.7)
      + 0.032 * Math.sin(a * 8 - 1.1));
  };
  const px = [0, 0, 0, 0];
  const ring = (a, j, out) => {
    const t = j / n;
    const y0 = line(a);
    const y = y0 + (yTop - y0) * Math.pow(t, 0.80);
    const r = headRadiusAtHeight(a, y) + off * (1 - t * t * t);
    out[0] = Math.cos(a) * r; out[1] = y; out[2] = Math.sin(a) * r; out[3] = t;
    return out;
  };
  const emit = (a, j) => { ring(a, j, px); pos.push(px[0], px[1], px[2]); uv.push(a / TAU, px[3]); };

  // winding matches latheGeo's — outward-facing (see the note there)
  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * TAU, a1 = ((i + 1) / s) * TAU;
    for (let j = 0; j < n; j++) {
      emit(a0, j); emit(a1, j + 1); emit(a1, j);
      emit(a0, j); emit(a0, j + 1); emit(a1, j + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();          // non-indexed -> faceted, which is the look
  return g;
}

/** Translate/rotate/scale a geometry in place (construction-time only). */
function place(g, x, y, z, rx, ry, rz, sx, sy, sz) {
  if (sx !== undefined) {
    g.scale(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
  }
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  if (x || y || z) g.translate(x || 0, y || 0, z || 0);
  return g;
}

/** Merge a list of geometries, disposing the inputs. Returns null if empty. */
function mergeAll(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const out = mergeGeometries(list, false);
  if (out) for (let i = 0; i < list.length; i++) list[i].dispose();
  return out || list[0];
}

/* ═══════════════════════════════ materials ═══════════════════════════════ */

/**
 * Build a hero material from the shared library WITHOUT inheriting its
 * world-space box projection (which would swim across a moving character) and
 * without sharing its instance (the hero needs its own opacity for `heroFade`,
 * the vanish power and the metal swap).
 *
 * THREE RULES, all three learned from a material audit that scored Nim 2/10:
 *
 *  1. NEVER TINT THROUGH THE WORLD ALBEDO. three multiplies `color × map`, and
 *     a world albedo is a *dyed* fabric/plaster/leaf image, not a white base:
 *     the library's `cloth` mean is (0.12, 0.19, 0.22) dark teal, so an
 *     authored coat of #d8532b rendered as #190f09 — 6 % of its luminance,
 *     hue gone. The map is therefore rebuilt as a NEUTRAL VALUE map
 *     (`detailTex`): the same weave/grain/wear signal, greyscale, normalised
 *     about its own mean, so `color` survives exactly and the texture reads as
 *     shading rather than as dye. The library's normal and roughness maps are
 *     carried over untouched — they never tinted anything.
 *
 *  2. TEXEL SCALE COMES FROM THE PART, NOT FROM A HAND-PICKED NUMBER.
 *     `opts.size` is the part's size in metres; the repeat is
 *     `size × sourceTilesPerMetre`, which puts the pattern on Nim at exactly
 *     the size it is on the world. See PART_M.
 *
 *  3. THE MATERIAL CLASS FOLLOWS THE SOURCE. If the library baked this key as
 *     MeshPhysicalMaterial (cloth's sheen lobe, glass's clearcoat) the hero
 *     gets a physical material and inherits those lobes, so cloth reads as
 *     cloth and glass as glass instead of everything reading as one plastic.
 *     TRANSMISSION IS THE ONE THING NOT INHERITED: it makes the renderer draw
 *     the whole scene a second time into the transmission target — measured on
 *     verdant-1 at 871 draws vs 437 (materials.js `transmissionToAlpha`) — so
 *     the hero copies the world's own choice, alpha + clearcoat + envMap.
 *
 * @param {object} mats  the Mats singleton (or null)
 * @param {string} key   material key (contract §14)
 * @param {string} themeId
 * @param {object} opts  {color, roughness, metalness, emissive, emissiveIntensity,
 *                        size, detail, transparent, opacity, side, flatShading,
 *                        sheen, clearcoat, …}
 * @returns {THREE.MeshStandardMaterial|THREE.MeshPhysicalMaterial}
 */
function deriveMaterial(mats, key, themeId, opts) {
  const o = opts || {};
  let src = null;
  try {
    if (mats && typeof mats.get === 'function') src = mats.get(key, themeId);
  } catch (e) { src = null; }

  const fb = MAT_FALLBACK[key] || MAT_FALLBACK.cloth;
  const def = {
    color: o.color !== undefined ? o.color : fb.color,
    roughness: o.roughness !== undefined ? o.roughness : (src ? src.roughness : fb.roughness),
    metalness: o.metalness !== undefined ? o.metalness : (src ? src.metalness : fb.metalness),
  };
  const physical = !!(o.physical || (src && src.isMeshPhysicalMaterial));
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);

  // ---- texel scale: part metres × the source's own tiles-per-metre ---------
  const size = numOr(o.size, 0.3);
  const srcRep = (src && src.map && src.map.repeat && src.map.repeat.x) || 1;
  const rep = clamp(size * srcRep, 0.02, 8);

  if (src) {
    // albedo -> neutral detail (rule 1). If the canvas cannot be read back
    // (tainted / DataTexture / no 2D context) we ship NO albedo map rather
    // than a map that would eat the authored colour.
    if (src.map) m.map = detailTex(src.map, rep, numOr(o.detail, 0.55));
    if (src.normalMap) {
      m.normalMap = cloneTex(src.normalMap, rep);
      m.normalScale.set(numOr(o.normalScale, 0.7), numOr(o.normalScale, 0.7));
    }
    if (src.roughnessMap) m.roughnessMap = cloneTex(src.roughnessMap, rep);
    if (src.metalnessMap) m.metalnessMap = m.roughnessMap || cloneTex(src.metalnessMap, rep);
    m.envMapIntensity = numOr(o.envMapIntensity, numOr(src.envMapIntensity, 1));

    // rule 3: inherit the source's surface LOBES (never its transmission)
    if (physical) {
      if (src.isMeshPhysicalMaterial) {
        if (src.sheen) {
          m.sheen = src.sheen;
          m.sheenRoughness = src.sheenRoughness;
          if (src.sheenColor) m.sheenColor.copy(src.sheenColor);
        }
        if (src.clearcoat) { m.clearcoat = src.clearcoat; m.clearcoatRoughness = src.clearcoatRoughness; }
        m.specularIntensity = src.specularIntensity;
        m.ior = src.ior;
      }
      if (o.sheen !== undefined) m.sheen = o.sheen;
      if (o.sheenRoughness !== undefined) m.sheenRoughness = o.sheenRoughness;
      if (o.sheenColor !== undefined) m.sheenColor.set(o.sheenColor);
      if (o.clearcoat !== undefined) m.clearcoat = o.clearcoat;
      if (o.clearcoatRoughness !== undefined) m.clearcoatRoughness = o.clearcoatRoughness;
      if (o.specularIntensity !== undefined) m.specularIntensity = o.specularIntensity;
      if (o.ior !== undefined) m.ior = o.ior;
    }
  }

  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity === undefined ? 1 : o.emissiveIntensity;
  }
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity === undefined ? 1 : o.opacity; }
  if (o.side !== undefined) m.side = o.side;
  if (o.flatShading) m.flatShading = true;
  if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;

  m.name = 'nim.' + key;
  m.userData.nimKey = key;
  m.userData.baseOpacity = m.opacity;
  m.userData.baseColor = m.color.getHex();
  return m;
}

const _texClones = new Map();
const _texDetail = new Map();

/** Clone a library texture once per (texture, repeat) and cache it. */
function cloneTex(t, repeat) {
  if (!t) return null;
  const id = (t.uuid || 'x') + '|' + repeat.toFixed(3);
  let c = _texClones.get(id);
  if (c) return c;
  c = t.clone();
  c.wrapS = THREE.RepeatWrapping;
  c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(repeat, repeat);
  c.needsUpdate = true;
  _texClones.set(id, c);
  return c;
}

/** Scratch canvas for the albedo readback. Construction-time only. */
let _detailCv = null;
let _detailCtx = null;

/**
 * Turn a world ALBEDO map into a neutral DETAIL map: greyscale, normalised so
 * its mean sits at `DETAIL_BASE`, with the deviation from that mean scaled by
 * `strength`. Multiplying an authored colour by this preserves the hue and
 * ~86 % of the luminance while keeping every weave, crack and wear mark the
 * bake produced.
 *
 * Built once per (texture, repeat, strength) at construction; the pixels are
 * never touched again. Returns null when the source cannot be read back, and
 * `deriveMaterial` then ships no albedo map at all — a flat authored colour is
 * a far smaller error than a destroyed one.
 */
/*
 * `DETAIL_BASE` is the sRGB grey the source's MEAN maps to, i.e. the albedo
 * multiplier Nim's authored palette is rendered through. It is calibrated, not
 * picked: the one hero material that was correctly exposed before this pass was
 * the skin, whose `plaster` albedo mean was 0.72 sRGB (~0.48 linear) — a
 * daylight-lit face at verdant's key 3.15 / exposure 1.06 sat just under clip
 * at that multiplier. 0.74 puts skin back exactly where it read right and lands
 * the coat's #d8532b at ~0.33 linear red: a rich orange that survives the sun
 * instead of a white blob. A neutral 1.0 base blows every sunlit panel out.
 */
const DETAIL_BASE = 0.74;     // sRGB grey the mean maps to  (~0.50 linear)
const DETAIL_N = 128;         // detail maps do not need the source's resolution

function detailTex(src, repeat, strength) {
  if (!src) return null;
  const id = (src.uuid || 'x') + '|' + repeat.toFixed(3) + '|' + strength.toFixed(2);
  const hit = _texDetail.get(id);
  if (hit !== undefined) return hit;

  let out = null;
  try {
    const img = src.image || (src.source && src.source.data);
    if (img && (img.width || 0) > 0) {
      if (!_detailCv) {
        _detailCv = document.createElement('canvas');
        _detailCv.width = DETAIL_N; _detailCv.height = DETAIL_N;
        _detailCtx = _detailCv.getContext('2d', { willReadFrequently: true });
      }
      const ctx = _detailCtx;
      ctx.clearRect(0, 0, DETAIL_N, DETAIL_N);
      ctx.drawImage(img, 0, 0, DETAIL_N, DETAIL_N);
      const id2 = ctx.getImageData(0, 0, DETAIL_N, DETAIL_N);
      const d = id2.data;

      // mean luminance of the source, in the space the pixels are stored in
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.30 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      const mean = Math.max(1, sum / (d.length / 4));

      const base = DETAIL_BASE * 255;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] * 0.30 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        // ratio about the mean, softened, clamped so no texel can go black
        const r = 1 + (lum / mean - 1) * strength;
        const v = clamp(base * r, base * 0.58, 255);
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(id2, 0, 0);

      // a fresh canvas per texture: CanvasTexture keeps a reference to it
      const cv = document.createElement('canvas');
      cv.width = DETAIL_N; cv.height = DETAIL_N;
      cv.getContext('2d').drawImage(_detailCv, 0, 0);

      out = new THREE.CanvasTexture(cv);
      out.name = (src.name || 'tex') + '.nimDetail';
      out.colorSpace = THREE.SRGBColorSpace;
      out.wrapS = THREE.RepeatWrapping;
      out.wrapT = THREE.RepeatWrapping;
      out.anisotropy = src.anisotropy || 1;
      out.generateMipmaps = true;
      out.minFilter = THREE.LinearMipmapLinearFilter;
      out.magFilter = THREE.LinearFilter;
      out.repeat.set(repeat, repeat);
      out.needsUpdate = true;
    }
  } catch (e) { out = null; }

  _texDetail.set(id, out);
  return out;
}

/* ═══════════════════════════════ shadow blob ═══════════════════════════════ */

const BLOB_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLOB_FRAG = /* glsl */`
uniform vec3  uColor;    // the MULTIPLIER at full coverage: the sky-lit shade, luminance ~0.30
uniform float uOpacity;  // coverage 0..1 (fades with altitude)
uniform float uSoft;     // 0 = contact (flat plateau + short penumbra), 1 = airborne gradient
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = clamp(length(d) * 2.0, 0.0, 1.0);
  /* LIGHT LANE r1 (critic C3 "NO CAST SHADOW UNDER NIM at the checkpoint pads",
   * "never suppress the contact blob over the pad - instead MULTIPLY it so the
   * darkest point under the feet is <= 0.55 of the pad albedo").
   *
   * The old blob was an alpha-blended disc of a dark colour at 0.48 peak alpha:
   * on a self-lit pad that is a 15 % dip the ACES curve then compresses to
   * nothing, and its core fell to a quarter strength 35 cm from the centre.
   * This one is a MULTIPLIER (MultiplyBlending: dst * src): the ground keeps
   * its own texture, its emissive lift and everything the ring adds, and is
   * darkened toward the shade colour by coverage. Coverage is a PLATEAU under
   * the feet (r < ~0.45 of the radius - the boots and the AO they cast) with a
   * real penumbra outside it, so the point 0.3 m behind the heels is still
   * inside the plateau. Airborne (uSoft -> 1) the plateau shrinks to a point
   * and the whole disc becomes a soft gradient, as before. */
  float core = 1.0 - smoothstep(mix(0.44, 0.0, uSoft), mix(0.98, 1.0, uSoft), r);
  float skirt = 1.0 - smoothstep(0.50, 1.0, r);
  float a = clamp(core * 0.86 + skirt * 0.14, 0.0, 1.0) * uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(mix(vec3(1.0), uColor, a), 1.0);
}
`;

/**
 * The contact shadow: a radial-alpha disc laid on whatever is beneath Nim.
 * Its whole job is to answer "where will I land" one frame before the player
 * asks, so it is projected by a real raycast and never a fixed plane.
 */
/** Luminance of the contact shadow's multiplier at full coverage (see BLOB_FRAG). */
const BLOB_SHADE_LUM = 0.30;

class ShadowBlob {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts] {radius, maxDist, opacity, color}
   */
  constructor(scene, opts) {
    const o = opts || {};
    this.scene = scene;
    this.radius = numOr(o.radius, 0.46);
    this.maxDist = numOr(o.maxDist, 7.0);
    this.maxOpacity = numOr(o.opacity, 0.60);
    /* The SHADE COLOUR. A contact shadow is the ground lit by everything EXCEPT
     * the key, which outdoors is a blue sky and indoors is the fill — never
     * black. setTheme() overwrites this from the theme rig. */
    this.shadeColor = new THREE.Color(0x2a3444);

    this.geo = discGeometry(1, 32);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(o.color === undefined ? 0x05070c : o.color) },
        uOpacity: { value: 0 },
        uSoft: { value: 0.58 },
      },
      vertexShader: BLOB_VERT,
      fragmentShader: BLOB_FRAG,
      transparent: true,
      /* dst * src: a shade, not a paint (see BLOB_FRAG). Alpha is (ZERO,
       * SRC_ALPHA) with src.a = 1, so the target's alpha is untouched. */
      blending: THREE.MultiplyBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'nim.shadowBlob';
    /* LIGHT LANE 2026-09-04 (critic C3 "the emissive pad disc swallows the
     * contact"): the checkpoint ring is an additive mesh at renderOrder 6, so
     * at 3 the blob was drawn FIRST and the ring's glow was added over it. 7
     * puts the contact on top of everything transparent under Nim's feet. The
     * pad's self-light itself is capped per theme (`palette.padGlow`). */
    this.mesh.renderOrder = 7;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._visible = true;
    this._op = 0;
    this._scale = this.radius * 2;
    this._hit = false;
    /* checkpoint pad footprint (see _padTop): read once per course off the
     * pad InstancedMesh's geometry, so a re-authored plinth is followed */
    this._padMesh = null;
    this._padR = 1.55;
    this._padH = 0.14;
  }

  /**
   * LIGHT LANE r1 - WHY THE BLOB NEVER SHOWED ON A CHECKPOINT PAD.
   * Measured (`_harness/_light_probe.py`, verdant-1 cp1): the broadphase ray
   * lands on the deck the pad sits on (y 4.40, where the controller stands),
   * but the pad is a 0.14 m plinth with no collider (course.js chamferDisc),
   * so its TOP is at 4.54 and the blob at 4.42 was 12 cm INSIDE the stone,
   * failing the depth test everywhere. Nim's boots stand 12-14 cm inside the
   * plinth for the same reason (out of this lane: the pad needs a collider or a
   * flush height). Until then the contact lifts itself to the pad top whenever
   * the feet are inside a pad's footprint - the physics world publishes the
   * checkpoints, and the pad's own geometry gives the radius/height.
   * Allocation-free after the first course.
   * @returns {number} the ground height the blob should sit on
   */
  _padTop(x, z, gy, world) {
    const cps = world && world.checkpoints;
    if (!cps || !cps.length) return gy;
    const course = world.course;
    const base = course && course._cpBase ? course._cpBase : null;
    if (base !== this._padMesh) {
      this._padMesh = base;
      let r = 1.55, h = 0.14;
      try {
        const g = base && base.geometry;
        if (g) {
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox;
          if (bb && isFinite(bb.max.x) && isFinite(bb.max.y)) { r = Math.max(0.5, bb.max.x); h = Math.max(0, bb.max.y); }
        }
      } catch (e) { /* keep the defaults */ }
      this._padR = r; this._padH = h;
    }
    if (this._padH <= 0.005) return gy;
    const r2 = this._padR * this._padR;
    let top = gy;
    for (let i = 0; i < cps.length; i++) {
      const p = cps[i] && cps[i].pos;
      if (!p) continue;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > r2) continue;
      if (Math.abs(gy - p.y) > 0.5) continue;      // a pad on another floor
      const t = p.y + this._padH;
      if (t > top) top = t;
    }
    return top;
  }

  setTheme(theme) {
    /* ROUND 5. This used to be `fog * 0.13` — a near-black version of the haze,
     * which is why the critic measured the blob interior at [11,20,13] with "no
     * coloured bounce at all". What actually lights a shadow is the FILL and the
     * hemi sky: in verdant that is 0x8fc0ff at 1.76 over a 0x8cbcec hemi, i.e. a
     * distinctly BLUE shade, and in ember it is the lava bounce. Mixing the
     * theme's fill/hemi with its fog keeps a furnace shadow warm and a meadow
     * shadow blue without a per-theme constant to maintain. The multiplier is
     * far higher than 0.13 because the material's own alpha is what makes it a
     * shadow — the COLOUR should be the colour of the light that is still
     * arriving. */
    const L = (theme && theme.lights) || null;
    const fill = (L && L.fill && L.fill.color);
    const hemi = (L && L.hemi && L.hemi.skyColor);
    const fog = theme && theme.fog && theme.fog.color;
    const bounce = (fill !== undefined && fill !== null) ? fill
      : ((hemi !== undefined && hemi !== null) ? hemi : 0x4a6a90);
    _col0.set(bounce);
    if (hemi !== undefined && hemi !== null) _col1.set(hemi), _col0.lerp(_col1, 0.35);
    if (fog !== undefined && fog !== null) _col1.set(fog), _col0.lerp(_col1, 0.42);
    this.shadeColor.copy(_col0);
    /* The uniform is the MULTIPLIER at full coverage, so its luminance IS the
     * darkest the ground can go under the feet. 0.30: a pad at HDR 1.2 lands
     * at ~0.36, which ACES + sRGB put ~30 % under the lit pad in the frame -
     * the contact the critic asked to measure. The hue stays the sky's. */
    const lum = 0.2126 * _col0.r + 0.7152 * _col0.g + 0.0722 * _col0.b;
    if (lum > 1e-4) _col0.multiplyScalar(BLOB_SHADE_LUM / lum);
    _col0.r = Math.min(0.9, _col0.r); _col0.g = Math.min(0.9, _col0.g); _col0.b = Math.min(0.9, _col0.b);
    this.mat.uniforms.uColor.value.copy(_col0);
  }

  setVisible(v) {
    this._visible = !!v;
    if (!this._visible) this.mesh.visible = false;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} pos  hero feet, world
   * @param {object|null} world  {broadphase}
   * @param {number} scale       radius multiplier (squash widens the blob)
   */
  update(dt, pos, world, scale) {
    if (!this._visible) { this.mesh.visible = false; return; }
    const bp = world && world.broadphase;

    this._hit = false;
    if (bp && typeof bp.raycast === 'function') {
      _v0.set(pos.x, pos.y + 0.30, pos.z);
      try {
        this._hit = !!bp.raycast(_v0, DOWN, this.maxDist + 0.4, _rayHit);
      } catch (e) { this._hit = false; }
    }

    if (!this._hit) {
      this._op = damp(this._op, 0, 14, dt);
      if (this._op < 0.004) { this.mesh.visible = false; return; }
      this.mat.uniforms.uOpacity.value = this._op;
      return;
    }

    // Where the ray met the world, and how far above it we are.
    let gy = pos.y + 0.30 - _rayHit.t;
    let n = _rayHit.normal;
    const padTop = this._padTop(pos.x, pos.z, gy, world);
    if (padTop > gy) { gy = padTop; n = UP; }
    const dist = Math.max(0, pos.y - gy);
    const t = clamp01(dist / this.maxDist);
    const fade = 1 - smoothstep(0, 1, t);

    const wantScale = this.radius * 2 * (1 + t * 1.45) * (scale || 1);
    const wantOp = this.maxOpacity * fade * fade;

    this._scale = damp(this._scale, wantScale, 16, dt);
    this._op = damp(this._op, wantOp, 16, dt);
    this.mat.uniforms.uSoft.value = 0.20 + t * 0.65;

    if (this._op < 0.004) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mat.uniforms.uOpacity.value = this._op;

    // Lift a hair along the surface normal — z-fighting on a shadow reads as
    // strobing, which is worse than no shadow at all.
    this.mesh.position.set(pos.x + n.x * 0.022, gy + n.y * 0.022, pos.z + n.z * 0.022);
    _q0.setFromUnitVectors(UP, n);
    this.mesh.quaternion.copy(_q0);
    this.mesh.scale.set(this._scale, 1, this._scale);
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ═══════════════════════════════ two-bone IK ═══════════════════════════════ */

/**
 * Analytic two-bone solve in the sagittal plane. `dy` is how far the target is
 * BELOW the hip socket, `fz` how far FORWARD of it (both metres, hip-local).
 * Writes `_ik` = {hip, knee} as bone-local X rotations under this file's
 * convention (positive X = tip forward, knee flexes negative).
 */
function solveLeg(dy, fz, l1, l2) {
  const dmin = Math.abs(l1 - l2) + 1e-3;
  const dmax = l1 + l2 - 1e-3;
  let d = Math.hypot(dy, fz);
  _ik.reached = d <= dmax;
  d = clamp(d, dmin, dmax);

  const base = Math.atan2(fz, Math.max(1e-4, dy));
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const cosB = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);

  _ik.hip = base + Math.acos(cosA);
  _ik.knee = -(Math.PI - Math.acos(cosB));
  return _ik;
}

/* ══════════════════ ONE DRAW: atlas + rigid-skin consolidation ══════════════════ */
/**
 * three.js issues ONE DRAW PER GEOMETRY GROUP, so an articulated character
 * built the honest way — one mesh per part, hung off the bone that moves it —
 * costs one draw per (part x material). Nim measured 31 shaded + 14 shadow
 * draws on verdant-1's spawn frame. Merging the parts is only legal if the
 * merge keeps ARTICULATING, and that is exactly what RIGID SKINNING buys:
 * every vertex is weighted 1.0 to the bone its part hung off, the existing
 * Object3D rig BECOMES the Skeleton, the pose writers keep writing the same
 * bone rotations they always did — and the whole body draws once.
 *
 * The other half is the material. Nim's parts differ in colour, roughness,
 * metalness, normal-map strength and two physical lobes; ONE material can
 * cover all of them only if every one of those differences moves into DATA:
 *
 *   colour              -> a `color` VERTEX ATTRIBUTE (three multiplies it in)
 *   albedo detail       -> atlas page `map`,        per-part UV island
 *   normal              -> atlas page `normalMap`,  normalScale pre-baked per tile
 *   roughness/metalness -> atlas page `ormMap`,     G and B (what three reads)
 *   clearcoat           -> atlas page `ccMap`,      R = amount, G = roughness
 *   sheen               -> atlas page `sheenMap`,   RGB = sheenColor x sheen
 *
 * Every page shares ONE tile layout, so a single UV remap serves all of them,
 * and a page that nothing writes is never allocated. What does NOT survive is
 * anything three has no map for: `envMapIntensity`, `ior`, `specularIntensity`
 * and `sheenRoughness` collapse to one vertex-weighted value each.
 *
 * ALPHA IS NEVER USED as a data channel. A 2D canvas stores premultiplied
 * pixels, so packing an independent value into A silently destroys the RGB
 * precision of any texel whose A is small. Every page here is opaque.
 */

/** Padding, in atlas pixels, around every tile — filled with the tile's OWN
 *  continued tiling, so a mip level can blur into it without ever pulling in
 *  a neighbouring part's texels. */
const ATLAS_PAD = 8;

/** What a tile means when nothing writes it. */
const ATLAS_DEFAULT = {
  map: '#ffffff',        // albedo detail: white = no modulation
  normalMap: '#8080ff',  // flat tangent-space normal
  ormMap: '#00ffff',     // G = roughness 1, B = metalness 1 (base scalars are 1)
  ccMap: '#000000',      // clearcoat 0
  sheenMap: '#000000',   // sheen colour black = no lobe
  shrMap: '#ffffff',     // sheen ROUGHNESS lives in A; opaque white = 1
};

/** Pages whose bytes are sRGB-encoded colour (the rest are raw data). */
const ATLAS_SRGB = ['map', 'sheenMap'];

/** A grid-packed set of canvas pages that all share one tile layout. */
class PartAtlas {
  constructor(size, tile, pad) {
    this.size = size | 0;
    this.tile = tile | 0;
    this.pad = pad === undefined ? ATLAS_PAD : pad;
    this.inner = this.tile - this.pad * 2;
    this.cols = Math.max(1, Math.floor(this.size / this.tile));
    this.slots = this.cols * this.cols;
    this.used = 0;
    this.pages = Object.create(null);
    this.ok = true;
  }

  /** Lazily create a page, pre-filled with its neutral value. */
  page(name) {
    let p = this.pages[name];
    if (p) return p;
    let cv = null, ctx = null;
    try {
      cv = document.createElement('canvas');
      cv.width = this.size;
      cv.height = this.size;
      ctx = cv.getContext('2d', { willReadFrequently: true });
    } catch (e) { ctx = null; }
    if (!ctx) { this.ok = false; return null; }
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = ATLAS_DEFAULT[name] || '#000000';
    ctx.fillRect(0, 0, this.size, this.size);
    p = { cv, ctx };
    this.pages[name] = p;
    return p;
  }

  /** Reserve one tile; returns its pixel origin and the UV rect of its inner area. */
  reserve() {
    if (this.used >= this.slots) return null;
    const i = this.used++;
    const px = (i % this.cols) * this.tile;
    const py = Math.floor(i / this.cols) * this.tile;
    return {
      px, py,
      u0: (px + this.pad) / this.size,
      v0: 1 - (py + this.pad + this.inner) / this.size,
      du: this.inner / this.size,
      dv: this.inner / this.size,
    };
  }

  /** Flat CSS-colour fill of a whole tile, padding included. */
  fill(name, slot, css) {
    const p = this.page(name);
    if (!p || !slot) return;
    p.ctx.fillStyle = css;
    p.ctx.fillRect(slot.px, slot.py, this.tile, this.tile);
  }

  /**
   * Flat fill that WRITES the alpha channel (`copy`, not `source-over`).
   * Only ever used with RGB at full white, where the canvas's premultiplied
   * round-trip is exact — see the ALPHA note in the header.
   */
  fillAlpha(name, slot, a) {
    const p = this.page(name);
    if (!p || !slot) return;
    p.ctx.save();
    /* `copy` replaces the destination across the WHOLE clip region, not just
       the drawn rect — without this clip the first call wipes every tile
       already painted on the page (measured: it turned Nim black). */
    p.ctx.beginPath();
    p.ctx.rect(slot.px, slot.py, this.tile, this.tile);
    p.ctx.clip();
    p.ctx.globalCompositeOperation = 'copy';
    p.ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0.02, Math.min(1, a)).toFixed(4) + ')';
    p.ctx.fillRect(slot.px, slot.py, this.tile, this.tile);
    p.ctx.restore();
  }

  /**
   * Paint a TILING source image so the tile's inner area covers exactly the
   * texture region [x0,x1] x [y0,y1] the part sampled, and the padding
   * continues the same tiling. `y` is UV-up: both the source canvases and this
   * atlas upload with flipY, so v = 1 is the TOP row of both and no flip is
   * needed anywhere.
   */
  drawTiled(name, slot, img, x0, x1, y0, y1) {
    const p = this.page(name);
    if (!p || !img || !slot) return false;
    const dx = x1 - x0, dy = y1 - y0;
    if (!(dx > 1e-9) || !(dy > 1e-9)) return false;
    const sx = this.inner / dx, sy = this.inner / dy;   // atlas px per texture unit
    const i0 = Math.floor(x0 - this.pad / sx), i1 = Math.ceil(x1 + this.pad / sx);
    const j0 = Math.floor(y0 - this.pad / sy), j1 = Math.ceil(y1 + this.pad / sy);
    if ((i1 - i0) * (j1 - j0) > 512) return false;      // pathological repeat
    const ctx = p.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.px, slot.py, this.tile, this.tile);
    ctx.clip();
    const ox = slot.px + this.pad, oy = slot.py + this.pad;
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        ctx.drawImage(img, ox + (i - x0) * sx, oy + (y1 - (j + 1)) * sy, sx, sy);
      }
    }
    ctx.restore();
    return true;
  }

  /**
   * Re-encode one tile between linear and sRGB bytes. A page is sampled in ONE
   * colour space; a source texture that was authored in the other one has to be
   * converted as it lands, or its mid-tones shift.
   */
  recode(name, slot, toSrgb) {
    this.mapTile(name, slot, (d) => {
      for (let k = 0; k < d.length; k += 4) {
        for (let c = 0; c < 3; c++) {
          const x = d[k + c] / 255;
          d[k + c] = b255(toSrgb
            ? (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
            : (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
        }
      }
    });
  }

  /** In-place per-pixel pass over one tile (bakes normalScale, roughness gain). */
  mapTile(name, slot, fn) {
    const p = this.pages[name];
    if (!p || !slot) return;
    let d = null;
    try { d = p.ctx.getImageData(slot.px, slot.py, this.tile, this.tile); } catch (e) { return; }
    fn(d.data);
    p.ctx.putImageData(d, slot.px, slot.py);
  }

  /** Upload every page that exists. */
  build() {
    const out = Object.create(null);
    for (const name in this.pages) {
      const t = new THREE.CanvasTexture(this.pages[name].cv);
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      t.colorSpace = ATLAS_SRGB.indexOf(name) >= 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      out[name] = t;
    }
    return out;
  }

  dispose() {
    for (const name in this.pages) { this.pages[name].cv.width = 1; this.pages[name].cv.height = 1; }
    this.pages = Object.create(null);
  }
}

/** UV bounding box of a geometry, degenerate axes widened to a unit span. */
function uvBox(g, out) {
  const a = g.attributes && g.attributes.uv;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  if (a) {
    const arr = a.array, n = a.count;
    for (let i = 0; i < n; i++) {
      const u = arr[i * 2], v = arr[i * 2 + 1];
      if (!isFinite(u) || !isFinite(v)) continue;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
  }
  if (!isFinite(u0)) { u0 = 0; u1 = 1; v0 = 0; v1 = 1; }
  if (u1 - u0 < 1e-6) { const c = (u0 + u1) * 0.5; u0 = c - 0.5; u1 = c + 0.5; }
  if (v1 - v0 < 1e-6) { const c = (v0 + v1) * 0.5; v0 = c - 0.5; v1 = c + 0.5; }
  out.u0 = u0; out.u1 = u1; out.v0 = v0; out.v1 = v1;
  return out;
}

/** The drawable image behind a texture, or null. */
function texImage(t) {
  if (!t) return null;
  const img = t.image;
  if (!img) return null;
  return (typeof img.width === 'number' && img.width > 0) ? img : null;
}

/** 0..1 -> a 0..255 byte. */
function b255(x) { return Math.max(0, Math.min(255, Math.round(x * 255))); }

/** A material's tiles-per-UV-unit, from whichever map it has. */
function matRepeat(m) {
  const t = m.map || m.normalMap || m.roughnessMap;
  return (t && t.repeat && t.repeat.x) ? t.repeat.x : 1;
}

/**
 * Reuse ONE update-range record per attribute so a per-frame partial upload
 * allocates nothing (three empties `updateRanges` once it has uploaded them).
 */
function pushUpdateRange(attr, rec, start, count) {
  const ur = attr.updateRanges;
  if (ur && ur.length === 0) {
    rec.start = start;
    rec.count = count;
    ur.push(rec);
  }
  attr.needsUpdate = true;
}

/* ═══════════════════════════════════ Hero ═══════════════════════════════════ */

/**
 * The parts whose shadow IS Nim's silhouette.  Everything else on him is trim:
 * the shadow map is a second full draw of every caster, and a cuff, a goggle
 * lens or a pack clasp adds a few texels to a 1.5 m character's shadow for a
 * whole extra draw call each.  See Hero._attach.
 */
const HERO_SHADOW_PARTS = new Set([
  'coat', 'coatDark', 'head', 'hair', 'pack', 'bootL', 'bootR',
  'sleeveUL', 'sleeveUR', 'shinL', 'shinR', 'mittenL', 'mittenR',
]);

export class Hero {
  /**
   * @param {THREE.Scene} scene
   * @param {object} mats   the Mats singleton from world/materials.js
   * @param {string|object} quality 'low'|'medium'|'high'|'ultra' or a QUALITY record
   */
  constructor(scene, mats, quality) {
    this.scene = scene;
    this.mats = mats || null;
    this.quality = quality || 'high';
    this.q = Hero._qLevel(quality);          // 0..3

    this.themeId = 'keep';
    this.theme = null;
    this.visible = true;
    this.power = null;

    /** @type {THREE.Group} world transform: position = feet, rotation.y = facing */
    this.root = new THREE.Group();
    this.root.name = 'nim.root';
    this.root.matrixAutoUpdate = true;

    /** Animator-owned transform: squash/stretch, flips, bob, lean. */
    this.rig = new THREE.Object3D();
    this.rig.name = 'nim.rig';
    this.root.add(this.rig);

    // ---- rig -------------------------------------------------------------
    /** @type {Object<string, THREE.Object3D>} */
    this.bones = Object.create(null);
    /** flat, index-addressable bone records — the update loop's hot array */
    this._bones = [];
    this._buildSkeleton();

    // ---- materials -------------------------------------------------------
    this._mats = [];                 // every hero material, for fade / power / dispose
    this._geos = [];                 // every geometry, for dispose
    this._buildMaterials();

    // ---- meshes ----------------------------------------------------------
    this._meshes = [];
    this._buildBody();
    this._buildHead();
    this._buildArms();
    this._buildLegs();
    this._buildPack();
    this._buildWings();

    // ---- scarf (Verlet, world space) -------------------------------------
    this._scarfP = new Float32Array((SCARF_LINKS + 1) * 3);
    this._scarfPrev = new Float32Array((SCARF_LINKS + 1) * 3);
    this._scarfInit = false;
    this._buildScarf();

    // ---- one draw: atlas + rigid skin (see the header above Hero) --------
    this._body = null;
    this._atlas = null;
    this._eyeRange = null;
    this._scarfColStart = 0;
    this._scarfColCount = 0;
    this._merged = this._consolidate();

    // ---- shadow ----------------------------------------------------------
    /* opacity 0.42 -> 0.56 (2026-09-04): the contact blob is the one shadow
     * that survives a glowing checkpoint pad under Nim's boots. */
    /* LIGHT LANE r1: 0.50 m / 0.56 -> 0.62 m / 1.0. The blob is now a
     * multiplier with a plateau (BLOB_FRAG), so "opacity" is full coverage
     * under the feet and the radius is the AO reach, not a paint radius. */
    this.shadowBlob = new ShadowBlob(scene, { radius: 0.62, maxDist: 7.0, opacity: 1.0 });

    // ---- animator state --------------------------------------------------
    this._anim = 'idle';
    this._prevAnim = 'idle';
    this._animT = 0;
    this._dist = 0;             // ground distance travelled (drives the run cycle)
    this._phase = 0;            // run cycle phase, radians
    this._speed = 0;
    this._speedN = 0;           // speed / speedRun, 0..1
    this._lean = 0;
    this._leanTgt = 0;
    this._grounded = true;
    this._prevGrounded = true;
    this._airT = 0;
    this._lastAirT = 0.5;
    this._idleT = 0;
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._breathe = 0;
    /* Cycle clocks for the two states that have no ground travel to drive
       them. `_dist` only accumulates while GROUNDED, so a hero on a pole or on
       a wall had a phase that never moved: climb and wallslide measured
       identical to 3 dp at t = 0.05 / 0.25 / 0.5 and photographed as statues.
       These integrate on their own, weighted by the motion the state does
       have (climb rate, slide speed) with a floor so a held grip still
       shifts. */
    this._climbPh = 0;
    this._wallPh = 0;

    this._squash = 1;
    this._squashTgt = 1;

    // flips are driven, not sprung — see the header
    this._flipPitch = 0;
    this._flipRoll = 0;
    this._flipYaw = 0;
    this._flipDecay = 0;
    this._flipDrvX = false;
    this._flipDrvY = false;
    this._flipDrvZ = false;
    this._rootPitchDrv = false;

    this._rootPitch = 0;
    this._rootRoll = 0;
    this._rootYaw = 0;
    this._rootY = 0;
    this._rootZ = 0;

    // Cyclic layer (see CYC_LAMBDA). `_cycW` is the envelope; the three root
    // channels are the periodic part of the bob, roll and pitch. They are HELD
    // across a state change, not zeroed, so the envelope can fade a mid-stride
    // pose out instead of snapping it to rest in one frame.
    this._cycW = 0;
    this._cycTgt = 0;
    this._cycY = 0;
    this._cycRoll = 0;
    this._cycPitch = 0;

    this._ikW = 0;              // foot-plant IK blend weight
    this._groundN = new THREE.Vector3(0, 1, 0);

    this._blinkT = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
    this._blink = 0;
    this._pupilX = 0;
    this._pupilY = 0;

    this._fade = 1;
    this._fadeApplied = -1;
    this._wingT = 0;

    this._rng = mulberry32(0x4e696d);

    scene.add(this.root);
    Hero.last = this;

    // rest pose is the reference every pose writer diffs against
    this._captureRest();
    this.setTheme('keep');
  }

  /* ───────────────────────────── construction ───────────────────────────── */

  /** Map a quality name (or QUALITY record) onto 0..3. */
  static _qLevel(q) {
    if (typeof q === 'number') return clamp(q | 0, 0, 3);
    const name = (q && typeof q === 'object') ? (q.name || q.quality || '') : String(q || '');
    switch (String(name).toLowerCase()) {
      case 'low': return 0;
      case 'medium': return 1;
      case 'ultra': return 3;
      default: return 2;
    }
  }

  /** Radial segment count for a lathe, by quality. */
  _seg(hi) { return [Math.max(6, hi >> 1), Math.max(8, (hi * 3) >> 2), hi, hi + 4][this.q]; }

  /**
   * The bone hierarchy. Every bone is a bare Object3D so the harness can read
   * `hero.bones.head.rotation` directly, and so a pose is a set of numbers
   * rather than a set of keyframes.
   */
  _buildSkeleton() {
    const mk = (name, parent, x, y, z) => {
      const o = new THREE.Object3D();
      o.name = 'nim.' + name;
      o.position.set(x, y, z);
      parent.add(o);
      this.bones[name] = o;
      return o;
    };

    const hips = mk('hips', this.rig, 0, P.hipY, 0);
    const spine = mk('spine', hips, 0, P.spineY, 0);
    const chest = mk('chest', spine, 0, P.chestY, 0);
    const neck = mk('neck', chest, 0, P.neckY, 0);
    mk('head', neck, 0, P.headY, 0);

    for (const s of [1, -1]) {
      const sfx = s > 0 ? 'R' : 'L';
      const sh = mk('shoulder' + sfx, chest, s * P.shoulderX, P.shoulderY, 0);
      const ua = mk('upperArm' + sfx, sh, 0, 0, 0);
      const la = mk('lowerArm' + sfx, ua, 0, -P.upperArm, 0);
      mk('hand' + sfx, la, 0, -P.lowerArm, 0);

      const ul = mk('upperLeg' + sfx, hips, s * P.legX, -P.hipDrop, 0);
      const ll = mk('lowerLeg' + sfx, ul, 0, -P.upperLeg, 0);
      mk('foot' + sfx, ll, 0, -P.lowerLeg, 0);
      void la; void ll;
    }

    // rest pose: arms a touch out and forward, legs a hair apart — a T-pose
    // reads as a mannequin even for one frame of a load hitch.
    this.bones.upperArmR.rotation.set(0.06, 0, 0.165);
    this.bones.upperArmL.rotation.set(0.06, 0, -0.165);
    this.bones.lowerArmR.rotation.set(0.32, 0, 0.06);
    this.bones.lowerArmL.rotation.set(0.32, 0, -0.06);
    this.bones.handR.rotation.set(0.10, 0, 0.05);
    this.bones.handL.rotation.set(0.10, 0, -0.05);
    this.bones.upperLegR.rotation.set(0, 0, 0.035);
    this.bones.upperLegL.rotation.set(0, 0, -0.035);
    this.bones.lowerLegR.rotation.set(-0.06, 0, 0);
    this.bones.lowerLegL.rotation.set(-0.06, 0, 0);
    this.bones.spine.rotation.set(-0.03, 0, 0);
    this.bones.chest.rotation.set(0.04, 0, 0);

    for (let i = 0; i < BONE_NAMES.length; i++) {
      const name = BONE_NAMES[i];
      const o = this.bones[name];
      this._bones.push({
        name, o,
        rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z,   // rest
        tx: o.rotation.x, ty: o.rotation.y, tz: o.rotation.z,   // sprung target
        bx: o.rotation.x, by: o.rotation.y, bz: o.rotation.z,   // sprung BASE
        cx: 0, cy: 0, cz: 0,                                    // cyclic delta
      });
    }
    /** name -> record, so pose writers read like prose. */
    this.B = Object.create(null);
    for (let i = 0; i < this._bones.length; i++) this.B[this._bones[i].name] = this._bones[i];

    // Pre-resolved limb groups. Any pose writer that has to pick a side at
    // RUNTIME (foot plant, wall brace) indexes these instead of concatenating
    // a bone name — string building in an update path is heap allocation.
    // Index 0 = right (+X), index 1 = left (−X).
    // `penY` is the foot-lock feedback term: the measured sole penetration from
    // the previous frame, fed back into this frame's IK target. It is what
    // closes the loop between the analytic leg solve (which only knows about
    // the ankle) and the real 0.30 m boot (whose toe and heel are what actually
    // touch). Converges in ~3 frames and decays to zero in the air.
    this._legs = [
      { side: 1, ul: this.B.upperLegR, ll: this.B.lowerLegR, ft: this.B.footR, penY: 0 },
      { side: -1, ul: this.B.upperLegL, ll: this.B.lowerLegL, ft: this.B.footL, penY: 0 },
    ];
    this._arms = [
      { side: 1, ua: this.B.upperArmR, la: this.B.lowerArmR, hd: this.B.handR },
      { side: -1, ua: this.B.upperArmL, la: this.B.lowerArmL, hd: this.B.handL },
    ];
  }

  _captureRest() {
    for (let i = 0; i < this._bones.length; i++) {
      const b = this._bones[i];
      b.rx = b.o.rotation.x; b.ry = b.o.rotation.y; b.rz = b.o.rotation.z;
      b.bx = b.rx; b.by = b.ry; b.bz = b.rz;
    }
  }

  /** One material per look. All of them go through `deriveMaterial`. */
  _buildMaterials() {
    const M = this.mats;
    const t = this.themeId;
    const reg = (m) => { this._mats.push(m); return m; };

    // `size` is the part's size in metres (PART_M) — it, not a hand-picked
    // number, sets the texel scale. `detail` is how much of the source's own
    // value variation survives into the neutral detail map: high on woven and
    // grained parts, low on skin (a face is not a plaster wall).
    this.M = {
      coat: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.coat, roughness: 0.88, size: PART_M.coat, detail: 0.60,
        sheen: 0.42, sheenRoughness: 0.62, sheenColor: 0x7a3a22, specularIntensity: 0.30,
      })),
      coatDark: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.coatDark, roughness: 0.93, size: PART_M.coatDark, detail: 0.60,
        sheen: 0.38, sheenRoughness: 0.70, sheenColor: 0x5d2816, specularIntensity: 0.26,
      })),
      trim: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.trim, roughness: 0.80, size: PART_M.trim, detail: 0.55,
        sheen: 0.40, sheenRoughness: 0.58, sheenColor: 0x2f4c55, specularIntensity: 0.34,
      })),
      scarf: reg(deriveMaterial(M, 'cloth', t, {
        color: SCARF_DEFAULT, roughness: 0.95, size: PART_M.scarf, detail: 0.65,
        side: THREE.DoubleSide,
        sheen: 0.48, sheenRoughness: 0.52, sheenColor: 0x7c2a1e, specularIntensity: 0.28,
      })),
      // Skin is the one place the library map is nearly suppressed: `plaster`
      // is the Keep's wall bake, and even at world scale its crack network has
      // no business on a face. It contributes pore-level value only.
      /* ROUND 3, second pass. Dropping the albedo alone did not clear the
       * blown-disc read at the Keep courtyard (`_shots/_vz_herohead.png`): the
       * head is a smooth sphere facing straight up at the dome, so a big part
       * of what was clipping was the ENVIRONMENT term, not the diffuse. The
       * skull is skin, not porcelain — it should barely mirror the sky at all.
       * Albedo down again, envMapIntensity pinned low, roughness up, and the
       * clearcoat (a wet/varnished layer on a face) removed. */
      skin: reg(deriveMaterial(M, 'plaster', t, {
        // ...and once the head became ONE smooth surface, what was left of
        // that crack network stopped hiding in the facets and photographed as
        // leathery FOLDS running temple to jaw (`_r3_headzoom.png`). A face is
        // not a plaster wall: the normal contribution drops 0.25 -> 0.07 and
        // the value modulation 0.18 -> 0.09, which leaves pore-level grain and
        // nothing structural.
        color: COL.skin, roughness: 0.74, size: PART_M.skin, detail: 0.09,
        normalScale: 0.07, physical: true, sheen: 0.18, sheenRoughness: 0.85,
        sheenColor: 0x8a5a48, specularIntensity: 0.22, clearcoat: 0.0, clearcoatRoughness: 0.9,
        envMapIntensity: 0.32,
      })),
      hair: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.hair, roughness: 0.70, size: PART_M.hair, detail: 0.70,
        sheen: 0.55, sheenRoughness: 0.34, sheenColor: 0x3d2418, specularIntensity: 0.45,
      })),
      boot: reg(deriveMaterial(M, 'rubber', t, {
        color: COL.boot, roughness: 0.86, size: PART_M.boot, detail: 0.65,
        physical: true, clearcoat: 0.22, clearcoatRoughness: 0.60, specularIntensity: 0.45,
      })),
      // Goggle brass. `metalness` 0.94 at `roughness` 0.28 is a MIRROR: on a
      // 12 mm rim under an open sky that is a moving specular the width of the
      // whole part, which is what photographed as "a scribbled blue-white
      // streak". 0.80 / 0.42 keeps a metal response and lets the albedo show,
      // and `detail` 0.75 -> 0.28 stops the library's machined grain from
      // scribbling at the rim's texel density.
      metal: reg(deriveMaterial(M, 'metal', t, {
        color: COL.metal, roughness: 0.42, metalness: 0.80, size: PART_M.metal, detail: 0.28,
      })),
      gold: reg(deriveMaterial(M, 'gold', t, {
        color: COL.buckle, roughness: 0.30, metalness: 0.90, size: PART_M.gold, detail: 0.70,
      })),
      // Leather, not foliage: `leaves` is an alpha-cut canopy CARD baked GREEN
      // (albedo mean 0.12, 0.22, 0.06) — it turned the pack black-green. `wood`
      // is the library's organic grain and is what a waxed leather pack wants.
      leather: reg(deriveMaterial(M, 'wood', t, {
        color: COL.leather, roughness: 0.72, size: PART_M.leather, detail: 0.60,
        physical: true, clearcoat: 0.28, clearcoatRoughness: 0.45, specularIntensity: 0.50,
      })),
      rope: reg(deriveMaterial(M, 'rope', t, {
        color: COL.rope, roughness: 0.94, size: PART_M.rope, detail: 0.80, normalScale: 0.9,
      })),
      blanket: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.blanket, roughness: 0.94, size: PART_M.blanket, detail: 0.60,
        sheen: 0.35, sheenRoughness: 0.68, sheenColor: 0x7e857a, specularIntensity: 0.22,
      })),
      // Glass the way the world does it (materials.js `transmissionToAlpha`):
      // alpha + clearcoat + a hot env term. A real `transmission` here would
      // re-draw the entire scene into the transmission target — the perf gate
      // is 260 draws and that alone measured +434 on verdant-1.
      lens: reg(deriveMaterial(M, 'glass', t, {
        color: COL.lens, roughness: 0.05, metalness: 0.0, size: PART_M.lens, detail: 0.35,
        physical: true, clearcoat: 1.0, clearcoatRoughness: 0.04, ior: 1.45,
        specularIntensity: 1.0, envMapIntensity: 2.4,
        // The lens is a DOME now, so the environment term does the work a flat
        // disc could not: `emissive` drops from 0.16 to 0.04 (a self-lit lens
        // is the "near-opaque pale disc" read, and it feeds the bloom that the
        // owner has flagged on trim across several games) and the alpha opens
        // up so the forehead reads THROUGH the glass.
        emissive: COL.lens, emissiveIntensity: 0.04,
        // FrontSide, and it is a DRAW CALL, not a preference: three.js renders
        // a `transparent` + `DoubleSide` material in two passes (back faces,
        // then front) unless `forceSinglePass`, and `_harness/drawprobe.py`
        // duly recorded `nim.goggleLens` twice at 416 tris in a single frame.
        // A closed dome sitting on the forehead has no back faces worth
        // drawing, so this is one draw and half the fragments for nothing lost.
        transparent: true, opacity: 0.30, side: THREE.FrontSide,
      })),
      // The sclera is a WET EYE, not a lamp: the old emissive 0.55 is what made
      // two 0.12 m discs read as stick-on googly eyes in every screenshot.
      eyeWhite: reg(deriveMaterial(M, 'plaster', t, {
        color: COL.eyeWhite, roughness: 0.38, size: PART_M.eyeWhite, detail: 0.10,
        normalScale: 0.15, physical: true, clearcoat: 0.16, clearcoatRoughness: 0.12,
        specularIntensity: 0.45, envMapIntensity: 0.18,
        emissive: 0xfff4e8, emissiveIntensity: 0.03,
      })),
      // The IRIS. Matte, not a mirror: the old 0.30 roughness with a 0.20
      // clearcoat put a broad specular in the middle of a 3 mm-proud ring and
      // every close-up came back with two chrome donuts where the eyes belong.
      // The catchlight is now a real GEOMETRIC bead in the sclera mesh, so the
      // pupil itself is allowed to be flat black.
      // The IRIS is vertex-coloured (limbal ring / iris / pupil in ONE draw),
      // so the base colour is white and the geometry carries the palette.
      eyeDark: reg(deriveMaterial(M, 'plaster', t, {
        color: 0xffffff, roughness: 0.46, size: PART_M.eyeDark, detail: 0.10,
        normalScale: 0.15, physical: true, clearcoat: 0.22, clearcoatRoughness: 0.20,
        specularIntensity: 0.35, envMapIntensity: 0.10,
      })),
      // Lips. A separate key so the mouth is not cut from brow-brown cloth.
      lip: reg(deriveMaterial(M, 'plaster', t, {
        color: COL.lip, roughness: 0.52, size: PART_M.lip, detail: 0.12,
        normalScale: 0.20, physical: true, sheen: 0.20, sheenRoughness: 0.60,
        sheenColor: 0x6d2a24, specularIntensity: 0.42,
        clearcoat: 0.14, clearcoatRoughness: 0.30,
      })),
    };

    // The iris rides 1.6 mm off a 42 mm ball. That is inside the depth
    // buffer's noise at a 2.4 m portrait distance, so bias it forward rather
    // than let a pupil flicker.
    this.M.eyeDark.vertexColors = true;
    this.M.eyeDark.polygonOffset = true;
    this.M.eyeDark.polygonOffsetFactor = -2;
    this.M.eyeDark.polygonOffsetUnits = -2;

    // Wing power — additive energy membrane. Built now, shown only on demand.
    this.M.wing = reg(new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.M.wing.userData.baseOpacity = 0.72;

    // Metal power — a chrome swap applied over every part.
    this.M.chrome = reg(new THREE.MeshStandardMaterial({
      color: 0xd6dde6, roughness: 0.10, metalness: 1.0,
    }));
    this.M.chrome.userData.baseOpacity = 1;
  }

  /**
   * The parts whose shadow is Nim's silhouette. Everything else on him is trim
   * and stops casting (see `_attach`) — measured: 24 shadow draws down to 8.
   */
  /**
   * Attach a mesh to a bone. Every hero mesh goes through here so the shadow
   * flags, frustum policy and bookkeeping are stated exactly once.
   */
  _attach(bone, geo, mat, name) {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'nim.' + name;
    /* Nim casts a REAL shadow, but only from the parts that make his
       silhouette.  The shadow map is a second full draw of every caster, and a
       cuff, a goggle lens or a pack clasp adds a few texels to a 1.5 m
       character's shadow for a whole extra draw call each — the blob under his
       feet plus the big parts already read as "Nim, standing there". */
    m.castShadow = HERO_SHADOW_PARTS.has(name);
    m.receiveShadow = false;
    m.frustumCulled = false;    // the hero is always on screen or behind the camera
    m.matrixAutoUpdate = true;
    bone.add(m);
    this._meshes.push(m);
    this._geos.push(geo);
    return m;
  }

  /** Torso: a tapered coat barrel with a flared hem, belt and shoulder yoke. */
  _buildBody() {
    const seg = this._seg(16);
    const chest = this.bones.chest;
    const hips = this.bones.hips;

    // --- coat body: lathe from the hem up to the collar, chest-local ----
    // chest bone is at world 0.94; the coat runs 0.50 .. 1.08 world.
    const cy = P.hipY + P.spineY + P.chestY;
    const coat = latheGeo([
      [0.000, 0.50 - cy],
      [0.150, 0.505 - cy],
      [0.214, 0.545 - cy],          // flared hem lip
      [0.198, 0.600 - cy],
      [0.186, 0.680 - cy],          // waist
      [P.torsoR, 0.800 - cy],       // chest
      [0.196, 0.905 - cy],
      [0.168, 0.985 - cy],          // shoulders
      [0.120, 1.045 - cy],
      [0.086, 1.075 - cy],          // collar throat
      [0.000, 1.080 - cy],
    ], seg);

    // recessed front placket — the coat needs one hard line or it reads as a jar
    const placket = place(
      bevelBoxGeometry(0.055, 0.42, 0.045, 0.012, 1),
      0, 0.760 - cy, -0.185, 0.10, 0, 0,
    );
    this._attach(chest, mergeAll([coat, placket]), this.M.coat, 'coat');

    // --- dark accents: hem band + shoulder yoke. Same material, same bone,
    //     so they are ONE draw call, not two.
    const dark = [place(
      latheGeo([[0.206, 0.524 - cy], [0.222, 0.534 - cy], [0.222, 0.560 - cy], [0.206, 0.570 - cy]], seg),
      0, 0, 0,
    )];
    for (const s of [1, -1]) {
      dark.push(place(
        bevelBoxGeometry(0.145, 0.085, 0.185, 0.030, 1),
        s * 0.150, 0.985 - cy, 0, 0, 0, -s * 0.30,
      ));
    }
    this._attach(chest, mergeAll(dark), this.M.coatDark, 'coatDark');

    // --- collar (a soft roll the scarf sits in) ---
    // It used to run 1.062 .. 1.126 at a 0.086 .. 0.134 radius, which is
    // entirely INSIDE a 0.50 m skull whose chin reaches down to 0.98: the only
    // reason it was ever on screen is that the lathe winding was inverted and
    // the head was not occluding anything. Dropped to the base of the head and
    // widened past the coat's shoulder, so it is a teal roll under the chin
    // instead of a draw call spent on geometry no camera can reach.
    const collar = latheGeo([
      [0.156, 0.998 - cy], [0.182, 1.010 - cy], [0.186, 1.030 - cy],
      [0.168, 1.048 - cy], [0.130, 1.058 - cy],
    ], seg);
    this._attach(chest, collar, this.M.trim, 'collar');

    // --- belt + side pouch on the hips bone, so they sway with them ---
    const belt = place(
      latheGeo([[0.190, -0.010], [0.203, -0.004], [0.203, 0.030], [0.190, 0.036]], seg),
      0, 0.006, 0,
    );
    const pouch = place(bevelBoxGeometry(0.110, 0.095, 0.070, 0.020, 1), 0.170, -0.030, 0.060, 0, 0.5, 0);
    this._attach(hips, mergeAll([belt, pouch]), this.M.leather, 'belt');

    const buckle = place(bevelBoxGeometry(0.085, 0.058, 0.030, 0.010, 1), 0, 0.013, -0.190);
    this._attach(hips, buckle, this.M.gold, 'buckle');
  }

  /**
   * Head. ONE smooth surface (`headGeo` off `headDirRadius`) carrying skull,
   * jaw, chin, brow ridge and nose, plus swept-tube brows and lip that ride
   * that surface, goggles pushed up onto the forehead, ears moved off the face
   * to the silhouette, and big sunk eyes with a coloured iris and a real
   * catchlight. Round 4 rewrite — see the notes on `headDirRadius`, `EYE_YAW`
   * and `surfaceTubeGeo` for what each reject cost and why the fix is here.
   */
  _buildHead() {
    const head = this.bones.head;
    const R = P.headR;

    /* ── the skull ─────────────────────────────────────────────────────────
     * The head is the one part of Nim the camera stares at all game, so it
     * gets the resolution: `headDirRadius`'s nose kernel is ~0.29 rad wide and
     * needs at least four columns across it to read as a button rather than a
     * facet. 36 x 28 at full quality is 4032 triangles — 0.9 % of the 450 k
     * scene budget, and it buys a face with no seams in it.
     */
    const hseg = this._seg(36);
    const skull = headGeo(hseg, Math.round(hseg * 0.84));

    /* ── ears ──────────────────────────────────────────────────────────────
     * ROUND 4 (critic): "EARS are bare untextured skin spheres stuck to the
     * sides at brow height with no lobe, helix or attachment — visually a
     * fourth and fifth face lump." Now a real shell — concha dish, helix rim,
     * a back wall that buries into the skull — and, decisively, MOVED: 25 %
     * behind the widest point and 5.5 cm BELOW the eyes, so it lands on the
     * silhouette edge and never again inside the face.
     */
    const earPts = [
      [0.0000, 0.0072], [0.0105, 0.0040], [0.0195, 0.0068], [0.0276, 0.0165],
      [0.0330, 0.0262], [0.0366, 0.0220], [0.0356, 0.0072], [0.0286, -0.0092],
      [0.0143, -0.0152], [0.0000, -0.0170],
    ];
    const ears = [];
    for (const s of [1, -1]) {
      /* Height matters as much as depth. The first Round 4 ear sat at
       * dy = -0.075 with a 10 mm sink: its top reached y = +0.023 while the
       * hair shell's temple line at that azimuth is y = +0.009, so the hair
       * covered it and `turntable_a2` showed no ear at all. dy = -0.185 puts
       * the ear centre at y = -0.048 - between the eye (0.036) and the nose
       * base (-0.106), where an ear actually belongs - and an 8 mm sink leaves
       * the helix rim ~17 mm proud instead of 7. */
      const ex = s * 0.958, ey = -0.185, ez = 0.220;
      const el = Math.hypot(ex, ey, ez);
      const dx = ex / el, dy = ey / el, dz = ez / el;
      const er = headDirRadius(dx, dy, dz) - 0.008;
      const g = latheGeo(earPts, this._seg(12));
      g.scale(1.30, 1.0, 0.86);
      ears.push(orientTo(g, dx * er, dy * er, dz * er, dx, dy, dz, 0));
    }

    this._attach(head, mergeAll([skull].concat(ears)), this.M.skin, 'head');

    // --- hair --------------------------------------------------------------
    // The shell now runs from a 0.60 R forehead down to a -0.60 R nape (see
    // `hairShellGeo`), so there is no bare skin behind the goggles from any
    // camera. Blades, fringe and tufts are accents ON that shell, not a
    // scatter of blocks on a bald head.
    const hair = [hairShellGeo(this._seg(22), 6, 0.013)];

    // blades swept back off the crown to break the 20 m outline
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.34;
      hair.push(place(
        bevelBoxGeometry(0.034 - Math.abs(i - 2) * 0.004, 0.150, 0.022, 0.009, 1),
        Math.sin(a) * 0.072, R * 0.88 + 0.014, -0.010 - Math.cos(a) * 0.012,
        -1.25, a, a * 0.5,
      ));
    }
    // a fringe ON the hairline, above the goggles
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.36;
      hair.push(place(
        bevelBoxGeometry(0.050, 0.062, 0.022, 0.009, 1),
        Math.sin(a) * 0.105, R * 0.885, -R * 0.50 + Math.abs(a) * 0.026,
        0.62, a * 0.6, a * 0.7,
      ));
    }
    // sideburn wedges so the hairline meets the ears instead of stopping short
    for (const s of [1, -1]) {
      hair.push(place(
        bevelBoxGeometry(0.030, 0.075, 0.048, 0.012, 1),
        s * 0.205, R * 0.10, -0.030, 0.06, 0, -s * 0.16,
      ));
    }
    // three tufts standing off the crown
    for (let i = 0; i < 3; i++) {
      const a = 1.9 + i * 1.5;
      hair.push(place(
        bevelBoxGeometry(0.044, 0.104, 0.026, 0.010, 1),
        Math.cos(a) * 0.100, R * 0.88, Math.sin(a) * 0.100,
        -0.80 + i * 0.20, a, 0.28 - i * 0.16,
      ));
    }
    // The goggle strap: a band that FOLLOWS the skull instead of a fixed-radius
    // hoop floating off it. Dark brown leather, merged into the hair mesh —
    // same colour, same bone, one draw call saved on the model the camera
    // stares at all game.
    const strapPts = [];
    for (let i = 0; i <= 4; i++) {
      const yy = GOG_STRAP_Y0 + (GOG_STRAP_Y1 - GOG_STRAP_Y0) * (i / 4);
      const rr0 = headRadiusAtHeight(0, yy) + (i === 0 || i === 4 ? 0.016 : 0.021);
      strapPts.push([rr0, yy]);
    }
    hair.push(latheGeo(strapPts, this._seg(18)));

    /* ── brows ─────────────────────────────────────────────────────────────
     * ROUND 4 (critic): "two dark-brown bars floating a full eye-height above
     * the eyes over bare flesh, so they read as a second goggle strap … the
     * image-right brow clips the goggle strap's lower edge." Measured: the bars
     * sat at EYE_Y + 0.060 over a 0.042 eyeball — 18 mm of bare skin between
     * eyeball top and brow. Now swept tubes that RIDE the skull 6 mm above the
     * eye, arched, and tapered to points at both ends so they read as brows;
     * and the goggles moved 6 cm up the forehead, so the nearest goggle edge is
     * 27 mm clear of the brow top instead of touching it.
     */
    for (const s of [1, -1]) {
      const az = -Math.PI * 0.5 + s * EYE_YAW;
      hair.push(surfaceTubeGeo(
        az - s * 0.175, az + s * 0.175,
        (f) => BROW_Y + 0.009 * (1 - f * f) - 0.004 * f,
        (f) => 0.0072 * Math.pow(Math.max(1e-3, 1 - f * f), 0.32),
        (f) => 0.0055 * Math.pow(Math.max(1e-3, 1 - f * f), 0.32),
        0.0020, 11, 6,
      ));
    }
    this._attach(head, mergeAll(hair), this.M.hair, 'hair');

    /* ── the mouth ─────────────────────────────────────────────────────────
     * ROUND 4 (critic): "a dark-berry strip whose individual quads are visible
     * at close range — it reads as a segmented caterpillar, not a lip." It was
     * 17 separate bevel boxes chained along an arc; overlapping them 3x hid the
     * seams at 20 m and not at 0.6 m. One swept tube on the head surface has no
     * seams to hide, and the corner taper is now a real taper rather than a
     * shorter box.
     */
    this._attach(head, surfaceTubeGeo(
      -Math.PI * 0.5 - MOUTH_SWEEP, -Math.PI * 0.5 + MOUTH_SWEEP,
      (f) => MOUTH_Y + f * f * MOUTH_LIFT,
      (f) => 0.0112 * Math.pow(Math.max(1e-3, 1 - f * f), 0.30),
      (f) => 0.0066 * Math.pow(Math.max(1e-3, 1 - f * f), 0.30),
      0.0022, 24, 7,
    ), this.M.lip, 'mouth');

    /* ── goggles, pushed up onto the forehead ──────────────────────────────
     * ROUND 4 (critic): "GOGGLES read as painted-on, not as glass and metal:
     * the lenses are near-opaque pale discs with no reflection or refraction,
     * and the rims render as a scribbled blue-white streak." The rim is now a
     * closed brass torus section (a rim has a cross-section; the old open
     * 7-point cup did not), sitting on the surface at the angle the surface
     * actually has, and the lens is a DOME — a curved lens rolls a highlight
     * across itself as the head turns, which is the whole reason glass reads as
     * glass. Colour and texel scale moved with it (see COL.metal).
     */
    const gseg = this._seg(16);
    const frames = [];
    const lenses = [];
    for (const s of [1, -1]) {
      const az = -Math.PI * 0.5 + s * GOG_AZ;
      const e = headElevAtHeight(az, GOG_Y);
      headPoint(az, e, _hp0);
      headNormal(az, e, _hn0);
      const px = _hp0[0], py = _hp0[1], pz = _hp0[2];
      const nx = _hn0[0], ny = _hn0[1], nz = _hn0[2];

      // rim: a closed cross-section swept round, so it has a real edge
      frames.push(orientTo(latheGeo([
        [0.0510, 0.000], [0.0600, -0.002], [0.0655, 0.006], [0.0645, 0.019],
        [0.0575, 0.025], [0.0495, 0.019], [0.0470, 0.007], [0.0510, 0.000],
      ], gseg), px + nx * 0.008, py + ny * 0.008, pz + nz * 0.008, nx, ny, nz, 0));

      // rivet on the outboard side of each cup
      const raz = -Math.PI * 0.5 + s * (GOG_AZ + 0.150);
      const re = headElevAtHeight(raz, GOG_Y - 0.004);
      headPoint(raz, re, _hp0);
      headNormal(raz, re, _hn0);
      frames.push(orientTo(limbGeo(0.0090, 0.0100, 0.004, 8, 2),
        _hp0[0] + _hn0[0] * 0.012, _hp0[1] + _hn0[1] * 0.012, _hp0[2] + _hn0[2] * 0.012,
        _hn0[0], _hn0[1], _hn0[2], 0));

      // the dome
      const lensPts = [[0.0525, 0.0000]];
      for (let i = 6; i >= 0; i--) {
        const t = i / 6;
        lensPts.push([0.0525 * t, 0.0035 + 0.0165 * Math.sqrt(Math.max(0, 1 - t * t))]);
      }
      lenses.push(orientTo(latheGeo(lensPts, gseg),
        px + nx * 0.008, py + ny * 0.008, pz + nz * 0.008, nx, ny, nz, 0));
    }
    // bridge between the two cups
    {
      const e = headElevAtHeight(-Math.PI * 0.5, GOG_Y);
      headPoint(-Math.PI * 0.5, e, _hp0);
      headNormal(-Math.PI * 0.5, e, _hn0);
      frames.push(orientTo(bevelBoxGeometry(0.062, 0.020, 0.026, 0.007, 1),
        _hp0[0] + _hn0[0] * 0.010, _hp0[1] + _hn0[1] * 0.010, _hp0[2] + _hn0[2] * 0.010,
        _hn0[0], _hn0[1], _hn0[2], 0));
    }
    this._attach(head, mergeAll(frames), this.M.metal, 'goggleFrame');
    this._attach(head, mergeAll(lenses), this.M.lens, 'goggleLens');

    /* ── eyes ──────────────────────────────────────────────────────────────
     * A pivot per feature so blink (scale) and look (rotate) never interfere.
     * The ball is sunk against the ACTUAL surface (`headPoint` at the eye's own
     * azimuth and height, then EYE_R − EYE_PROUD inward along the real normal),
     * so the brow ridge and the jaw term can move without un-sinking it.
     */
    const eseg = this._seg(24);
    const sclera = [];
    const pupils = [];
    let restY = 0;
    for (const s of [1, -1]) {
      const az = -Math.PI * 0.5 + s * EYE_YAW;
      const e = headElevAtHeight(az, EYE_Y);
      headPoint(az, e, _hp0);
      headNormal(az, e, _hn0);
      const nx = _hn0[0], ny = _hn0[1], nz = _hn0[2];
      const sink = EYE_R - EYE_PROUD;
      const cx = _hp0[0] - nx * sink;
      const cy = _hp0[1] - ny * sink;
      const cz = _hp0[2] - nz * sink;
      restY += cy * 0.5;

      // a surface frame at the eye: N out, U up the face, S across it
      let ux = -ny * nx, uy = 1 - ny * ny, uz = -ny * nz;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const sx2 = ny * uz - nz * uy, sy2 = nz * ux - nx * uz, sz2 = nx * uy - ny * ux;

      // the eyeball
      sclera.push(place(limbGeo(EYE_R, EYE_R, 0.001, eseg, 5), cx, cy + 0.0005, cz));

      /* CATCHLIGHT — a real bead of wet sclera standing ~3.4 mm proud of the
       * iris at 14 degrees off the eye axis, so it straddles the iris and never
       * washes out. The critic's "no catchlight" was measured, not impression:
       * the old bead was GLINT_R 0.0055 at a radius INSIDE the iris cap, so the
       * iris drew over it and what showed was a material specular. */
      const gdx = nx * 0.970 + ux * 0.205 + sx2 * (s * 0.125);
      const gdy = ny * 0.970 + uy * 0.205 + sy2 * (s * 0.125);
      const gdz = nz * 0.970 + uz * 0.205 + sz2 * (s * 0.125);
      const gl = Math.hypot(gdx, gdy, gdz) || 1;
      const gd = EYE_R - 0.0055;
      sclera.push(place(limbGeo(GLINT_R, GLINT_R, 0.001, this._seg(10), 3),
        cx + (gdx / gl) * gd, cy + (gdy / gl) * gd + 0.0005, cz + (gdz / gl) * gd));

      /* IRIS — a cap that CONFORMS to the eyeball, vertex-coloured so a dark
       * limbal ring, a warm amber iris and a near-black pupil all ship in ONE
       * draw call. Colours are assigned from the lathe's own axial radius
       * BEFORE the cap is oriented, so they cannot drift with placement. */
      const ER = EYE_R + 0.0016;
      const irisPts = [[PUPIL_R, Math.sqrt(EYE_R * EYE_R - PUPIL_R * PUPIL_R) - 0.0018]];
      const rr = [PUPIL_R, 0.0192, IRIS_LIMBAL, 0.0158, 0.0125, IRIS_INNER, 0.0086,
        0.0060, 0.0032, 0.0000];
      for (let i = 0; i < rr.length; i++) {
        irisPts.push([rr[i], Math.sqrt(Math.max(1e-9, ER * ER - rr[i] * rr[i]))]);
      }
      const iris = latheGeo(irisPts, eseg);
      const ip = iris.attributes.position.array;
      const col = new Float32Array(ip.length);
      for (let i = 0; i < ip.length; i += 3) {
        const r2 = Math.hypot(ip[i], ip[i + 2]);
        let hex;
        if (r2 >= IRIS_LIMBAL) hex = COL.irisRim;
        else if (r2 <= IRIS_INNER) hex = COL.eyePupil;
        else hex = (r2 < (IRIS_INNER + IRIS_LIMBAL) * 0.5) ? COL.irisIn : COL.iris;
        _col0.setHex(hex, THREE.SRGBColorSpace);
        col[i] = _col0.r; col[i + 1] = _col0.g; col[i + 2] = _col0.b;
      }
      iris.setAttribute('color', new THREE.BufferAttribute(col, 3));
      pupils.push(orientTo(iris, cx, cy, cz, nx, ny, nz, 0));
    }

    this._eyeRestY = restY;
    this._eyePivot = new THREE.Object3D();
    this._eyePivot.name = 'nim.eyes';
    this._eyePivot.position.set(0, restY, 0);
    head.add(this._eyePivot);
    for (let i = 0; i < sclera.length; i++) sclera[i].translate(0, -restY, 0);
    for (let i = 0; i < pupils.length; i++) pupils[i].translate(0, -restY, 0);

    this._sclera = this._attach(this._eyePivot, mergeAll(sclera), this.M.eyeWhite, 'sclera');

    this._pupilPivot = new THREE.Object3D();
    this._pupilPivot.name = 'nim.pupils';
    this._eyePivot.add(this._pupilPivot);
    this._pupils = this._attach(this._pupilPivot, mergeAll(pupils), this.M.eyeDark, 'pupils');
    if (this._pupils) this._pupils.castShadow = false;
    if (this._sclera) this._sclera.castShadow = false;
  }

  /** Arms: sleeve, cuff and a mitten with a thumb wedge. */
  _buildArms() {
    const seg = this._seg(12);
    for (const s of [1, -1]) {
      const sfx = s > 0 ? 'R' : 'L';
      const ua = this.bones['upperArm' + sfx];
      const la = this.bones['lowerArm' + sfx];
      const hd = this.bones['hand' + sfx];

      // upper sleeve: thicker at the shoulder, gathered at the elbow
      const sleeve = limbGeo(0.086, 0.070, P.upperArm, seg, 3);
      const shoulderCap = place(limbGeo(0.092, 0.092, 0.010, seg, 3), 0, 0.006, 0);
      this._attach(ua, mergeAll([sleeve, shoulderCap]), this.M.coat, 'sleeveU' + sfx);

      // forearm + cuff
      const fore = limbGeo(0.068, 0.058, P.lowerArm, seg, 3);
      this._attach(la, fore, this.M.coat, 'sleeveL' + sfx);
      const cuff = place(
        latheGeo([[0.062, -P.lowerArm - 0.004], [0.078, -P.lowerArm + 0.006], [0.078, -P.lowerArm + 0.044], [0.062, -P.lowerArm + 0.052]], seg),
        0, 0, 0,
      );
      this._attach(la, cuff, this.M.trim, 'cuff' + sfx);

      // mitten: a rounded paddle plus a thumb wedge, merged
      const palm = place(
        limbGeo(0.062, 0.052, P.handLen - 0.052, seg, 3),
        0, -0.010, 0, 0, 0, 0, 1.0, 1.0, 0.80,
      );
      const thumb = place(
        limbGeo(0.026, 0.024, 0.042, this._seg(8), 2),
        -s * 0.052, -0.052, -0.014, 0.20, 0, -s * 1.05,
      );
      this._attach(hd, mergeAll([palm, thumb]), this.M.trim, 'mitten' + sfx);
    }
  }

  /** Legs: coat-matched thigh, gaitered shin, chunky boot with a tread sole. */
  _buildLegs() {
    const seg = this._seg(12);
    for (const s of [1, -1]) {
      const sfx = s > 0 ? 'R' : 'L';
      const ul = this.bones['upperLeg' + sfx];
      const ll = this.bones['lowerLeg' + sfx];
      const ft = this.bones['foot' + sfx];

      this._attach(ul, limbGeo(0.098, 0.082, P.upperLeg, seg, 3), this.M.coat, 'thigh' + sfx);

      // Knee cap: reads the bend at 20 m. It is strapped over the joint and so
      // rides the SHIN bone (whose origin IS the knee), which lets it merge
      // into the shin's own trim mesh — two draw calls back, paid straight into
      // the lip mesh the face needed. Same material, same bone, one draw.
      const knee = place(limbGeo(0.084, 0.084, 0.012, seg, 3), 0, 0.006, -0.008);
      const shin = limbGeo(0.078, 0.064, P.lowerLeg, seg, 3);
      this._attach(ll, mergeAll([shin, knee]), this.M.trim, 'shin' + sfx);

      /*
       * BOOT. Chamfered shell + tapering vamp + rounded toe cap + rolled cuff +
       * lace bars + a WAISTED sole with lugs, all merged into one rubber mesh:
       * fourteen sub-parts, one draw call.
       *
       * What was wrong, measured off _r3z_boots.png (turntable_a1 / a5 /
       * idle_p50): the sole was ONE slab, `bevelBox(bootW + 0.014, 0.034,
       * bootL)` centred at z = −0.052 — span z ∈ [−0.202, +0.098] — under an
       * upper that reached only [−0.171, +0.085]. It therefore overshot the
       * toe by 31 mm and the heel by 13 mm with square, untapered edges, and
       * its exposed TOP face caught the sky light as a flat tan plate. At 20 m
       * and in every profile pose Nim stood on two planks.
       *
       * The sole is now three segments — forefoot, waist, heel — whose plan
       * view is boot-shaped and whose extremes sit 1–2 mm INSIDE the upper's,
       * so nothing overhangs anywhere and the only sole surface a camera can
       * see is the welt edge. Keep SOLE_TOE_Z / SOLE_HEEL_Z in step with the
       * forefoot's and heel's outer faces.
       */
      const boot = [];
      // ankle shell (z ∈ [−0.137, +0.085])
      boot.push(place(bevelBoxGeometry(P.bootW, P.bootH, P.bootL * 0.74, 0.038, 1), 0, -P.bootH * 0.5 + 0.016, -0.026));
      // vamp: narrower and lower than the shell, so the boot tapers forward
      boot.push(place(bevelBoxGeometry(0.150, 0.112, 0.110, 0.040, 1), 0, -0.078, -0.108));
      // toe cap: smaller again and kicked up, so the tip reads as a round toe
      boot.push(place(bevelBoxGeometry(0.116, 0.078, 0.062, 0.028, 1), 0, -0.086, -0.156, -0.16, 0, 0));
      // rolled cuff
      // 8 radial segments, not `seg`: the cuff is a 20 mm roll around a 0.09 m
      // radius and reads identically at 8, for 24 fewer triangles per boot.
      boot.push(place(
        latheGeo([[0.074, 0.006], [0.094, 0.018], [0.094, 0.052], [0.074, 0.062]], 8),
        0, 0, -0.012,
      ));
      // two lace bars across the front of the ankle, 3 mm proud
      for (let i = 0; i < 2; i++) {
        boot.push(place(bevelBoxGeometry(0.146, 0.011, 0.012, 0.004, 1), 0, -0.018 - i * 0.030, -0.134));
      }
      /*
       * Sole: a forefoot pad and a heel block with a SHANK (a gap) between
       * them — the plan view a real boot has, and 44 triangles cheaper than
       * carrying a third segment across the waist. Both sit 4 mm proud of the
       * ground; the tread lugs below are the actual contact patch, bottoming at
       * EXACTLY −bootH so a planted foot touches the ground plane instead of
       * sinking through it. Keep SOLE_TOE_Z / SOLE_HEEL_Z on their outer faces.
       */
      boot.push(place(bevelBoxGeometry(0.156, 0.030, 0.118, 0.013, 1), 0, -0.141, -0.126));  // forefoot
      boot.push(place(bevelBoxGeometry(0.152, 0.034, 0.096, 0.013, 1), 0, -0.139, 0.036));   // heel
      // lugs: two under the ball of the foot, one under the heel
      for (let i = 0; i < 2; i++) {
        boot.push(place(bevelBoxGeometry(0.140, 0.012, 0.028, 0.005, 1), 0, -P.bootH + 0.006, -0.160 + i * 0.054));
      }
      boot.push(place(bevelBoxGeometry(0.128, 0.012, 0.030, 0.005, 1), 0, -P.bootH + 0.006, 0.040));
      this._attach(ft, mergeAll(boot), this.M.boot, 'boot' + sfx);
    }
  }

  /** Backpack with a rolled blanket and rope straps over the shoulders. */
  _buildPack() {
    const chest = this.bones.chest;
    const cy = P.hipY + P.spineY + P.chestY;
    const seg = this._seg(12);

    const body = place(bevelBoxGeometry(0.230, 0.235, 0.130, 0.032, 1), 0, 0.855 - cy, 0.225);
    const flap = place(bevelBoxGeometry(0.238, 0.090, 0.140, 0.028, 1), 0, 0.955 - cy, 0.228, -0.10, 0, 0);
    const sidePocketA = place(bevelBoxGeometry(0.060, 0.110, 0.090, 0.020, 1), 0.128, 0.840 - cy, 0.222);
    const sidePocketB = place(bevelBoxGeometry(0.060, 0.110, 0.090, 0.020, 1), -0.128, 0.840 - cy, 0.222);
    this._attach(chest, mergeAll([body, flap, sidePocketA, sidePocketB]), this.M.leather, 'pack');

    // rolled blanket lashed across the top. limbGeo's origin is at the TOP of
    // its shaft, so after the +Z roll it runs +X — shift back by half to centre.
    const roll = place(
      limbGeo(0.056, 0.056, 0.230, seg, 3),
      -0.115, 0.995 - cy, 0.232, 0, 0, Math.PI * 0.5,
    );
    this._attach(chest, roll, this.M.blanket, 'blanket');

    /* Straps: two over the shoulders, two lashing the roll.
     *
     * ROUND 4 (critic): "COLLAR — two cream tongues hang below the blue collar
     * band, directly under the chin, and read as fangs or drool in every front
     * shot." They are these straps. Measured: a 0.300 m box centred at world
     * y 0.900 reaches y 1.050, and the coat lathe has necked in to r = 0.120
     * by then — so at x = 0.118 the coat surface is at z = -0.022 while the
     * strap sat at z = -0.115, leaving 9 cm of rope hanging in free air under
     * the chin, cropped at the top by the teal collar. Shortened to 0.230 and
     * dropped to y 0.860 so the strap ends 2.3 cm BELOW the collar and hugs
     * the chest, where the coat radius (~0.199) actually contains it.
     */
    const straps = [];
    for (const s of [1, -1]) {
      straps.push(place(bevelBoxGeometry(0.046, 0.230, 0.022, 0.008, 1), s * 0.118, 0.860 - cy, -0.166, 0.06, 0, -s * 0.12));
      straps.push(place(bevelBoxGeometry(0.040, 0.026, 0.290, 0.008, 1), s * 0.118, 0.975 - cy, 0.060, 0.18, 0, 0));
      straps.push(place(bevelBoxGeometry(0.030, 0.150, 0.026, 0.006, 1), s * 0.072, 0.995 - cy, 0.234, 0, 0, 0));
    }
    this._attach(chest, mergeAll(straps), this.M.rope, 'packStraps');

    // clasps
    const clasps = [];
    for (const s of [1, -1]) clasps.push(place(bevelBoxGeometry(0.044, 0.032, 0.020, 0.006, 1), s * 0.118, 0.795 - cy, -0.146));
    this._attach(chest, mergeAll(clasps), this.M.gold, 'packClasps');
  }

  /**
   * Wing power: two swept energy membranes, five feather blades each, hidden
   * until `setPower('wing')`. Additive so they glow rather than shade.
   */
  _buildWings() {
    const chest = this.bones.chest;
    const cy = P.hipY + P.spineY + P.chestY;

    this.wings = [];
    for (const s of [1, -1]) {
      const pivot = new THREE.Object3D();
      pivot.name = 'nim.wing' + (s > 0 ? 'R' : 'L');
      pivot.position.set(s * 0.115, 0.930 - cy, 0.150);
      pivot.visible = false;
      chest.add(pivot);

      const blades = [];
      for (let i = 0; i < 5; i++) {
        const f = i / 4;
        const len = 0.46 - f * 0.20;
        const a = -0.30 + f * 0.95;
        blades.push(place(
          bevelBoxGeometry(0.030, len, 0.008, 0.006, 1),
          s * (0.030 + f * 0.055), len * 0.42, -f * 0.055,
          0, 0, s * a,
        ));
      }
      const mesh = new THREE.Mesh(mergeAll(blades), this.M.wing);
      mesh.name = 'nim.wingMesh' + (s > 0 ? 'R' : 'L');
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      pivot.add(mesh);
      this._geos.push(mesh.geometry);
      this.wings.push(pivot);
    }
  }

  /* ───────────────────── consolidation into one draw ───────────────────── */

  /**
   * Fold every OPAQUE part of the rig into ONE rigidly-skinned mesh with ONE
   * material, backed by the atlas described at the top of this file.
   *
   * WHY IT IS STILL ARTICULATED. Each part's vertices are baked into ROOT-LOCAL
   * bind space and weighted 1.0 to the bone the part used to hang off, and the
   * rig's own Object3Ds become the Skeleton. `skinned = bone.world * bindInv *
   * v` is then EXACTLY the transform the scene graph was applying — the pose
   * writers, the flips, the squash on `rig` and the foot IK all keep working
   * unchanged, because they still write the same bones.
   *
   * The scarf comes along as a DYNAMIC vertex range weighted to a bone that
   * never moves: `_writeScarfGeometry` already produces ROOT-LOCAL positions,
   * which is precisely what an identity bind reproduces, so its Float32Arrays
   * simply become views into the merged buffers.
   *
   * Anything transparent (the goggle lens, the wing membranes) stays its own
   * draw — three must sort those against the scene, and a merged opaque body
   * cannot be sorted.
   *
   * Never fatal: on any failure the per-part meshes are left exactly as built.
   * @returns {boolean} whether the merge happened
   */
  _consolidate() {
    if (typeof document === "undefined" || globalThis.CRESTBOUND_NOMERGE) return false;
    const root = this.root;
    root.updateMatrixWorld(true);

    /* ---- 1. which parts may merge ---------------------------------------- */
    const keep = [];
    const parts = [];
    for (let i = 0; i < this._meshes.length; i++) {
      const m = this._meshes[i];
      const mat = m.material;
      if (!m.parent || !m.geometry || !mat || mat.transparent || mat === this.M.wing) { keep.push(m); continue; }
      parts.push({
        mesh: m, geo: m.geometry, mat, bone: m.parent, dyn: false,
        eye: (m === this._sclera || m === this._pupils),
      });
    }
    if (parts.length < 2) return false;
    // eyes last so setPower('metal') can spare them with one geometry group
    parts.sort((a, b) => (a.eye ? 1 : 0) - (b.eye ? 1 : 0));

    const statBone = new THREE.Object3D();
    statBone.name = 'nim.staticBone';
    root.add(statBone);
    root.updateMatrixWorld(true);
    if (this.scarfMesh && this.scarfMesh.geometry) {
      parts.push({ mesh: this.scarfMesh, geo: this.scarfMesh.geometry, mat: this.M.scarf, bone: statBone, dyn: true, eye: false });
    }

    /* ---- 2. one atlas tile per part -------------------------------------- */
    const atlas = new PartAtlas(1024, 128);
    const box = { u0: 0, u1: 1, v0: 0, v1: 1 };
    let anyCC = false, anySheen = false;
    let wAll = 0, envSum = 0, specSum = 0, shRSum = 0, shRW = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.geo.index) p.geo = p.geo.toNonIndexed();
      p.n = p.geo.attributes.position.count;
      p.slot = atlas.reserve();
      if (!p.slot) return false;                       // atlas full: leave the rig alone

      const m = p.mat;
      const rep = matRepeat(m);
      uvBox(p.geo, box);
      /* THE TILE IS SQUARE, SO THE REGION IT HOLDS MUST BE SQUARE TOO.
         Fitting a non-square UV box to a square tile stretches the texture along
         one axis — measured as visible banding across Nim's head, where the
         lathe's v span is shorter than its u span. One shared `span` keeps the
         u:v texel aspect exactly what the per-part material sampled, and also
         keeps the derivative-based tangent frame (three builds TBN from dFdx of
         the UVs) identical, which is what normal mapping reads. */
      p.span = Math.max(box.u1 - box.u0, box.v1 - box.v0);
      p.u0 = box.u0; p.v0 = box.v0;
      const x0 = box.u0 * rep, x1 = (box.u0 + p.span) * rep;
      const y0 = box.v0 * rep, y1 = (box.v0 + p.span) * rep;

      const im = texImage(m.map);
      if (im && atlas.drawTiled('map', p.slot, im, x0, x1, y0, y1)
          && m.map.colorSpace !== THREE.SRGBColorSpace) {
        atlas.recode('map', p.slot, true);          // linear source onto an sRGB page
      }

      const nm = texImage(m.normalMap);
      if (nm && atlas.drawTiled('normalMap', p.slot, nm, x0, x1, y0, y1)) {
        if (m.normalMap.colorSpace === THREE.SRGBColorSpace) atlas.recode('normalMap', p.slot, false);
        const ns = (m.normalScale && m.normalScale.x !== undefined) ? m.normalScale.x : 1;
        if (Math.abs(ns - 1) > 0.01) {
          atlas.mapTile('normalMap', p.slot, (d) => {
            for (let k = 0; k < d.length; k += 4) {
              d[k] = b255(0.5 + (d[k] / 255 - 0.5) * ns);
              d[k + 1] = b255(0.5 + (d[k + 1] / 255 - 0.5) * ns);
            }
          });
        }
      }

      const rough = clamp01(numOr(m.roughness, 1));
      const metal = clamp01(numOr(m.metalness, 0));
      const om = texImage(m.roughnessMap);
      if (om && atlas.drawTiled('ormMap', p.slot, om, x0, x1, y0, y1)) {
        if (m.roughnessMap.colorSpace === THREE.SRGBColorSpace) atlas.recode('ormMap', p.slot, false);
        atlas.mapTile('ormMap', p.slot, (d) => {
          for (let k = 0; k < d.length; k += 4) {
            d[k + 1] = b255((d[k + 1] / 255) * rough);
            d[k + 2] = b255((d[k + 2] / 255) * metal);
          }
        });
      } else {
        atlas.fill('ormMap', p.slot, 'rgb(0,' + b255(rough) + ',' + b255(metal) + ')');
      }

      const cc = numOr(m.clearcoat, 0);
      if (cc > 0.002) {
        anyCC = true;
        atlas.fill('ccMap', p.slot, 'rgb(' + b255(cc) + ',' + b255(numOr(m.clearcoatRoughness, 0)) + ',0)');
      }
      const sh = numOr(m.sheen, 0);
      if (sh > 0.002 && m.sheenColor) {
        anySheen = true;
        _col0.copy(m.sheenColor).multiplyScalar(sh);
        atlas.fill('sheenMap', p.slot, '#' + _col0.getHexString());
        atlas.fillAlpha('shrMap', p.slot, numOr(m.sheenRoughness, 1));
        shRSum += numOr(m.sheenRoughness, 1) * p.n;
        shRW += p.n;
      }

      wAll += p.n;
      envSum += numOr(m.envMapIntensity, 1) * p.n;
      specSum += numOr(m.specularIntensity, 1) * p.n;
    }
    if (!atlas.ok) return false;

    /* ---- 3. one geometry ------------------------------------------------- */
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].n;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    const cols = new Float32Array(total * 3);
    const sIdx = new Uint16Array(total * 4);
    const sWgt = new Float32Array(total * 4);

    const bones = [];
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const m4 = new THREE.Matrix4();
    const m3 = new THREE.Matrix3();
    const v = new THREE.Vector3();
    let head = 0, eyeStart = -1, eyeCount = 0, scarfStart = -1, scarfCount = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let bi = bones.indexOf(p.bone);
      if (bi < 0) { bi = bones.length; bones.push(p.bone); }

      m4.multiplyMatrices(rootInv, p.mesh.matrixWorld);
      m3.getNormalMatrix(m4);

      const ap = p.geo.attributes.position.array;
      const an = p.geo.attributes.normal ? p.geo.attributes.normal.array : null;
      const au = p.geo.attributes.uv ? p.geo.attributes.uv.array : null;
      const ac = p.geo.attributes.color ? p.geo.attributes.color.array : null;
      const mc = p.mat.color;
      const sl = p.slot;
      const bu = p.u0, bv = p.v0, isp = 1 / p.span;    // the SAME square region the tile holds

      for (let k = 0; k < p.n; k++) {
        const o3 = (head + k) * 3, o2 = (head + k) * 2, o4 = (head + k) * 4;
        v.set(ap[k * 3], ap[k * 3 + 1], ap[k * 3 + 2]).applyMatrix4(m4);
        pos[o3] = v.x; pos[o3 + 1] = v.y; pos[o3 + 2] = v.z;
        if (an) {
          v.set(an[k * 3], an[k * 3 + 1], an[k * 3 + 2]).applyMatrix3(m3).normalize();
          nor[o3] = v.x; nor[o3 + 1] = v.y; nor[o3 + 2] = v.z;
        } else { nor[o3 + 1] = 1; }
        const u = au ? au[k * 2] : bu;
        const w = au ? au[k * 2 + 1] : bv;
        uvs[o2] = sl.u0 + (u - bu) * isp * sl.du;
        uvs[o2 + 1] = sl.v0 + (w - bv) * isp * sl.dv;
        cols[o3] = mc.r * (ac ? ac[k * 3] : 1);
        cols[o3 + 1] = mc.g * (ac ? ac[k * 3 + 1] : 1);
        cols[o3 + 2] = mc.b * (ac ? ac[k * 3 + 2] : 1);
        sIdx[o4] = bi;
        sWgt[o4] = 1;
      }
      if (p.eye) { if (eyeStart < 0) eyeStart = head; eyeCount += p.n; }
      if (p.dyn) { scarfStart = head; scarfCount = p.n; }
      head += p.n;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sWgt, 4));
    if (scarfCount > 0) {
      geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    }
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.85, 0), 3.4);

    /* ---- 4. one material ------------------------------------------------- */
    const tex = atlas.build();
    const def = {
      color: 0xffffff, vertexColors: true,
      roughness: 1, metalness: 1,
      /* `envMapIntensity` and `specularIntensity` are the two lobe scalars three
         gives no map slot for, so they become ONE vertex-count-weighted mean.
         A per-vertex attribute + a shader patch carrying them per part WAS built
         and measured (`_harness/_lane_final_ab.py`, one frozen verdant-1 frame,
         merged and per-part meshes alive at once): the mean reproduces the
         per-part hero to 1.008 whole-body luminance, the per-part patch to
         0.910. The simpler thing is also the faithful one here, so it ships. */
      envMapIntensity: wAll > 0 ? envSum / wAll : 1,
    };
    if (tex.map) def.map = tex.map;
    if (tex.normalMap) def.normalMap = tex.normalMap;
    if (tex.ormMap) { def.roughnessMap = tex.ormMap; def.metalnessMap = tex.ormMap; }
    const mat = (anyCC || anySheen) ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);
    if (anyCC) {
      mat.clearcoat = 1;
      mat.clearcoatMap = tex.ccMap;
      mat.clearcoatRoughness = 1;
      mat.clearcoatRoughnessMap = tex.ccMap;
    }
    if (anySheen) {
      mat.sheen = 1;
      mat.sheenColor.setRGB(1, 1, 1);
      mat.sheenColorMap = tex.sheenMap;
      /* sheenRoughness is the ONE lobe scalar that visibly matters per part —
         Nim's skin is a broad 0.85 velvet and his coat a tighter 0.62, and an
         average of the two flattens the face. `sheenRoughnessMap` reads .a, so
         this page carries it in alpha over full-white RGB, where the canvas's
         premultiplied round-trip is lossless. */
      if (tex.shrMap) { mat.sheenRoughness = 1; mat.sheenRoughnessMap = tex.shrMap; }
      else mat.sheenRoughness = shRW > 0 ? shRSum / shRW : 1;
    }
    if (mat.isMeshPhysicalMaterial) mat.specularIntensity = wAll > 0 ? specSum / wAll : 1;
    mat.name = 'nim.body';
    mat.userData.baseOpacity = 1;
    mat.userData.baseColor = 0xffffff;
    this._mats.push(mat);
    this._installRim(mat);

    /* ---- 5. the skinned mesh --------------------------------------------- */
    const inverses = [];
    for (let i = 0; i < bones.length; i++) {
      inverses.push(new THREE.Matrix4().multiplyMatrices(rootInv, bones[i].matrixWorld).invert());
    }
    const body = new THREE.SkinnedMesh(geo, mat);
    body.name = 'nim.body';
    body.castShadow = true;
    /* VISUAL PASS 2026-09-04: the body RECEIVES as well. With the sun's frustum
     * now hero-following at ~3.5 cm texels (engine.js), Nim's head shadows his
     * own chest and the backpack shadows the coat — the self-occlusion that
     * separates a lit character from a decal. The header's "receiveShadow off"
     * note dates from the 18 cm-texel map, where this was only acne. */
    body.receiveShadow = true;
    body.frustumCulled = false;
    body.matrixAutoUpdate = true;
    root.add(body);
    body.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());

    /* ---- 6. retire the per-part meshes ----------------------------------- */
    /* `CB_KEEP_PARTS` leaves the ORIGINAL per-part meshes in the rig, hidden,
       instead of retiring them. It is off in play and exists so a harness can
       render the merged body and the meshes it replaced in the SAME frozen
       frame and diff them — which is the only measurement that can tell a
       material bug from run-to-run scene variance. See _harness/_lane_final_ab.py. */
    const KEEP_PARTS = !!globalThis.CB_KEEP_PARTS;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (KEEP_PARTS) { p.mesh.visible = false; continue; }
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
      const gi = this._geos.indexOf(p.mesh.geometry);
      if (gi >= 0) this._geos.splice(gi, 1);
      if (p.mesh.geometry !== p.geo) p.geo.dispose();
      p.mesh.geometry.dispose();
      void 0;
    }
    this._geos.push(geo);
    this._meshes = keep;
    this._meshes.push(body);

    this._body = body;
    this._atlas = atlas;
    /* Build metadata: which atlas tile each part landed in, and the texture
       region that tile holds. Cheap to keep and it is the only way to audit an
       atlas after the fact. */
    this._atlasSlots = parts.map((p) => ({
      name: p.mesh.name, slot: p.slot, rep: matRepeat(p.mat), mat: p.mat,
      u0: p.u0, v0: p.v0, span: p.span,
    }));
    this._eyeRange = eyeCount > 0 ? { start: eyeStart, count: eyeCount } : null;
    this._sclera = null;
    this._pupils = null;

    /* the scarf's own arrays become VIEWS into the merged buffers, so
       `_writeScarfGeometry` keeps writing exactly what it wrote before */
    if (scarfCount > 0) {
      this._scarfPos = pos.subarray(scarfStart * 3, (scarfStart + scarfCount) * 3);
      this._scarfNor = nor.subarray(scarfStart * 3, (scarfStart + scarfCount) * 3);
      this._scarfRange = { pos: scarfStart * 3, count: scarfCount * 3 };
      this._scarfURa = { start: 0, count: 0 };
      this._scarfURb = { start: 0, count: 0 };
      this._scarfColStart = scarfStart;
      this._scarfColCount = scarfCount;
    }
    this._scarfGeo = geo;
    if (this.scarfMesh) { this.scarfMesh = null; }
    return true;
  }

  /**
   * FRESNEL RIM on the ONE body material (owner, 2026-09-04: "no key-light
   * direction or rim on the hero ... the single biggest pasted-on tell").
   *
   * One `onBeforeCompile` on the merged material, two uniforms, one program:
   * a grazing-angle term (`(1 - N.V)^3`) weighted toward the side facing the
   * theme's RIM light, added to the indirect specular so it is LIGHT, not
   * albedo-tinted — the coat's dark teal trim rims as brightly as the orange
   * coat does. The colour/direction come from the ThemeDef's `lights.rim`
   * via `setTheme`, so the halo agrees with the rig's actual back light and no
   * program is compiled per theme (the values are uniform writes).
   * @param {THREE.Material} mat
   */
  _installRim(mat) {
    const rimU = this._rimU || (this._rimU = {
      uCbHeroRim: { value: new THREE.Vector4(1, 0.95, 0.85, 0.9) },
      uCbHeroRimDir: { value: new THREE.Vector3(0.15, 0.35, -0.92).normalize() },
      /* LIGHT LANE 2026-09-04 (owner O2 "Nim is unlit ... no key on the face,
       * no rim"): two more uniform-only terms on the same program.
       *   uCbHeroSky  rgb = the theme's SKY colour, a = strength (~0.35): an
       *               omnidirectional fresnel so the silhouette edge always
       *               carries a cool sky rim whichever way the rig's back light
       *               happens to point — view-dependent, zero draw cost.
       *   uCbHeroFill rgb = a theme-tinted fill, a = intensity in the same
       *               units as a DirectionalLight: a wrapped lambert from the
       *               CAMERA side, so whatever face of Nim the player sees is
       *               never the unlit one (the Keep's key is behind him at
       *               spawn). It is a material term, not a scene light, so the
       *               light count and the shader permutation do not change. */
      uCbHeroSky: { value: new THREE.Vector4(0.56, 0.72, 0.95, 0.35) },
      uCbHeroFill: { value: new THREE.Vector4(1, 0.95, 0.88, 0.9) },
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCbHeroRim = rimU.uCbHeroRim;
      shader.uniforms.uCbHeroRimDir = rimU.uCbHeroRimDir;
      shader.uniforms.uCbHeroSky = rimU.uCbHeroSky;
      shader.uniforms.uCbHeroFill = rimU.uCbHeroFill;
      const AO = '#include <aomap_fragment>';
      if (shader.fragmentShader.indexOf(AO) === -1) return;
      shader.fragmentShader = 'uniform vec4 uCbHeroRim;\nuniform vec3 uCbHeroRimDir;\n' +
        'uniform vec4 uCbHeroSky;\nuniform vec4 uCbHeroFill;\n' +
        shader.fragmentShader.replace(AO, AO + `
  {
    // CRESTBOUND hero rim + sky back light + camera fill (player/hero.js _installRim)
    // The SMOOTH normal, not the bump-perturbed one: a rim that follows the
    // weave of the coat is a scribble, a rim that follows the silhouette is a rim.
    vec3 cbN = normalize( nonPerturbedNormal );
    float cbNV = saturate( dot( cbN, geometryViewDir ) );
    // LIGHT LANE r1 (critic: "Nim has NO RIM in any of the 147 frames"). The old
    // (1-NV)^2 fresnel was full only in the last ~4 % of the silhouette radius,
    // which at the 0.60 tier scale is under one pixel. This is a stylised BAND:
    // full over the outer fifth of the radius (N.V < 0.45), gone by N.V 0.80.
    float cbF = smoothstep( 0.20, 0.55, 1.0 - cbNV );
    // the theme's own back light gives the rim its side (world direction)
    vec3 cbRd = normalize( ( viewMatrix * vec4( uCbHeroRimDir, 0.0 ) ).xyz );
    float cbBack = saturate( dot( cbN, cbRd ) * 0.5 + 0.5 );
    reflectedLight.indirectSpecular += uCbHeroRim.rgb * ( cbF * cbBack * uCbHeroRim.a );
    // a CAMERA-PINNED back light, upper-right-behind in view space, in the
    // dome's colour: the hair light and the shoulder rim are on screen whichever
    // way Nim or the rig happens to face
    vec3 cbPin = normalize( vec3( 0.42, 0.62, -0.66 ) );
    float cbPinW = saturate( dot( cbN, cbPin ) * 0.65 + 0.35 );
    // 40 % albedo-tinted: light, so the dark teal trim still rims, but the
    // near-black hair takes a third less, so the hair light is a fringe and
    // not a white cap (r1 crops, keep/verdant)
    vec3 cbTint = mix( vec3( 1.0 ), saturate( diffuseColor.rgb * 2.2 ), 0.4 );
    reflectedLight.indirectSpecular += uCbHeroSky.rgb * cbTint * ( cbF * cbPinW * uCbHeroSky.a );
    // camera-side wrapped lambert, albedo-tinted like a real diffuse term
    float cbWrap = saturate( dot( geometryNormal, geometryViewDir ) * 0.55 + 0.45 );
    reflectedLight.indirectDiffuse += diffuseColor.rgb * uCbHeroFill.rgb * ( cbWrap * uCbHeroFill.a * RECIPROCAL_PI );
  }`);
    };
    mat.customProgramCacheKey = () => 'cb-hero-rim3';
    mat.needsUpdate = true;
  }

  /** Re-bake the scarf's baked vertex colour after `setTheme` re-dyes it. */
  _restainScarf() {
    if (!this._body || !this._scarfColCount) return;
    const a = this._body.geometry.attributes.color;
    const arr = a.array, c = this.M.scarf.color;
    const s = this._scarfColStart * 3, n = this._scarfColCount * 3;
    for (let i = 0; i < n; i += 3) { arr[s + i] = c.r; arr[s + i + 1] = c.g; arr[s + i + 2] = c.b; }
    a.needsUpdate = true;
  }

  /**
   * The scarf ribbon. 7 quads, non-indexed, positions and normals rewritten in
   * place every frame from the Verlet chain. Parented to `root` (NOT `rig`) so
   * squash and flips never stretch the cloth.
   */
  _buildScarf() {
    // 4 faces per link, 2 triangles each: a PRISM, not a plane. 168 vertices
    // for the whole scarf — the cost of thickness is 126 extra vertices
    // written per frame, and what it buys is the fold, the edge-on read and
    // the taper the critic said the flat ribbon had none of.
    const verts = SCARF_LINKS * SCARF_FACES * 6;
    this._scarfPos = new Float32Array(verts * 3);
    this._scarfNor = new Float32Array(verts * 3);
    this._scarfUv = new Float32Array(verts * 2);

    for (let i = 0; i < SCARF_LINKS; i++) {
      const v0 = i / SCARF_LINKS, v1 = (i + 1) / SCARF_LINKS;
      for (let k = 0; k < SCARF_FACES; k++) {
        const u0 = k / SCARF_FACES, u1 = (k + 1) / SCARF_FACES;
        const o = (i * SCARF_FACES + k) * 12;
        const uvs = [u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1];
        for (let m = 0; m < 12; m++) this._scarfUv[o + m] = uvs[m];
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this._scarfPos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this._scarfNor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this._scarfUv, 2));
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.5);

    this._scarfGeo = g;
    this.scarfMesh = new THREE.Mesh(g, this.M.scarf);
    this.scarfMesh.name = 'nim.scarf';
    this.scarfMesh.castShadow = true;
    this.scarfMesh.receiveShadow = false;
    this.scarfMesh.frustumCulled = false;
    this.root.add(this.scarfMesh);
    this._geos.push(g);
  }

  /* ─────────────────────────────── public API ─────────────────────────────── */

  /**
   * Realm dress. Accepts a ThemeDef (contract §15) or a bare theme id.
   * The scarf takes the realm colour; the blob takes the realm's fog.
   */
  setTheme(theme) {
    const def = (theme && typeof theme === 'object') ? theme : null;
    const id = def ? (def.id || 'keep') : String(theme || 'keep');
    this.theme = def;
    this.themeId = id;

    let tint = SCARF_TINT[id];
    if (tint === undefined) {
      tint = (def && def.palette && def.palette.accent !== undefined)
        ? def.palette.accent : SCARF_DEFAULT;
    }
    _col0.set(tint);
    /* A palette-derived fallback can be any value at all, and the one that
     * shipped (verdant's accent) was a 1.16:1 luminance ratio against the coat
     * — the scarf vanished. Lift anything below the floor toward white until
     * it clears it: the hue survives, the read is guaranteed. */
    for (let i = 0; i < 12; i++) {
      const L = 0.2126 * _col0.r + 0.7152 * _col0.g + 0.0722 * _col0.b;
      if (L >= SCARF_MIN_LUM) break;
      _col0.lerp(_col1.setRGB(1, 1, 1), 0.18);
    }
    this.M.scarf.color.copy(_col0);
    this.M.scarf.userData.baseColor = this.M.scarf.color.getHex();
    // the merged body carries the scarf's colour as a baked vertex attribute
    this._restainScarf();

    // Lenses pick up the realm accent so the goggles never read as dead glass.
    const acc = (def && def.palette && def.palette.crest !== undefined) ? def.palette.crest : COL.lens;
    _col1.set(acc).lerp(_col0.set(COL.lens), 0.55);
    this.M.lens.color.copy(_col1);
    this.M.lens.emissive.copy(_col1);
    this.M.lens.userData.baseColor = this.M.lens.color.getHex();

    // Wing energy matches the realm too.
    if (def && def.palette && def.palette.accent !== undefined) this.M.wing.color.set(def.palette.accent);

    // The fresnel rim takes the theme's own back light (see _installRim).
    if (this._rimU) {
      const R = def && def.lights && def.lights.rim;
      const K = def && def.lights && def.lights.key;
      _col0.set(R && R.color !== undefined ? R.color : 0xfff2d8);
      /* `lights.heroRim` (themes.js): `back` = the theme back light's share of
       * the band, `intensity` = the camera-pinned sky rim. Both are HDR adds
       * on the coat's indirect specular before ACES. */
      const HR = def && def.lights && def.lights.heroRim;
      const strength = HR && typeof HR.back === 'number' ? Math.max(0, Math.min(3, HR.back))
        : (R && typeof R.intensity === 'number' ? Math.min(1.2, 0.25 + R.intensity * 0.25) : 0.7);
      this._rimU.uCbHeroRim.value.set(_col0.r, _col0.g, _col0.b, strength);
      const d = (R && Array.isArray(R.dir) && R.dir.length >= 3) ? R.dir
        : (K && Array.isArray(K.dir) && K.dir.length >= 3 ? [K.dir[2], 0.35, -K.dir[0]] : [0.15, 0.35, -0.92]);
      this._rimU.uCbHeroRimDir.value.set(d[0], d[1], d[2]);
      if (this._rimU.uCbHeroRimDir.value.lengthSq() < 1e-8) this._rimU.uCbHeroRimDir.value.set(0.15, 0.35, -0.92);
      this._rimU.uCbHeroRimDir.value.normalize();

      /* LIGHT LANE: sky fresnel from the dome / hemi sky, camera fill from the
       * theme's own `lights.heroFill` ({color, intensity}) — declared per theme
       * in themes.js; the fallback is the key colour pulled toward the hemi sky
       * at ~30 % of the key's intensity, i.e. a cinematic ~3-4:1 key:fill. */
      const H = def && def.lights && def.lights.hemi;
      const skySpec = (H && H.skyColor !== undefined) ? H.skyColor
        : (def && def.sky && def.sky.params && def.sky.params.top !== undefined ? def.sky.params.top : 0x8fb8f0);
      _col0.set(skySpec);
      // lift a dark dome (ember's soot sky) so the rim is still a rim
      for (let i = 0; i < 6; i++) {
        const L = 0.2126 * _col0.r + 0.7152 * _col0.g + 0.0722 * _col0.b;
        if (L >= 0.30) break;
        _col0.lerp(_col1.setRGB(1, 1, 1), 0.22);
      }
      const F = def && def.lights && def.lights.heroFill;
      // lift the dome colour to a rim that can read over a sunlit coat
      for (let i = 0; i < 6; i++) {
        const L = 0.2126 * _col0.r + 0.7152 * _col0.g + 0.0722 * _col0.b;
        if (L >= 0.55) break;
        _col0.lerp(_col1.setRGB(1, 1, 1), 0.25);
      }
      const skyStrength = HR && typeof HR.intensity === 'number' ? Math.max(0, Math.min(4, HR.intensity))
        : (F && typeof F.sky === 'number' ? Math.max(0, Math.min(1.2, F.sky)) * 3.5 : 1.3);
      this._rimU.uCbHeroSky.value.set(_col0.r, _col0.g, _col0.b, skyStrength);
      if (F && F.color !== undefined) _col0.set(F.color);
      else {
        _col0.set(K && K.color !== undefined ? K.color : 0xffffff);
        _col1.set(skySpec);
        _col0.lerp(_col1, 0.35);
      }
      const keyI = K && typeof K.intensity === 'number' ? K.intensity : 2.2;
      const fillI = F && typeof F.intensity === 'number' ? Math.max(0, Math.min(4, F.intensity)) : Math.max(0.5, Math.min(1.4, keyI * 0.30));
      this._rimU.uCbHeroFill.value.set(_col0.r, _col0.g, _col0.b, fillI);
    }

    this.shadowBlob.setTheme(def);
  }

  /** Show / hide the whole hero (peek camera, cinematics, the death iris). */
  setVisible(v) {
    const want = !!v;
    if (want === this.visible) return;
    this.visible = want;
    this.root.visible = want;
    this.shadowBlob.setVisible(want);
  }

  /**
   * Power hats (contract §22 `power` crests).
   *   'wing'   — energy wings + a lighter fall pose
   *   'metal'  — chrome material swap
   *   'vanish' — 40 % opacity
   * `null` restores the default dress.
   */
  setPower(id) {
    const p = id || null;
    if (p === this.power) return;
    this.power = p;

    // wings
    const wingOn = p === 'wing';
    for (let i = 0; i < this.wings.length; i++) this.wings[i].visible = wingOn;
    this.M.wing.opacity = wingOn ? this.M.wing.userData.baseOpacity : 0;

    // chrome swap
    const chromeOn = p === 'metal';
    for (let i = 0; i < this._meshes.length; i++) {
      const m = this._meshes[i];
      if (m === this._sclera || m === this._pupils) continue;      // keep the face readable
      if (m === this._body && this._eyeRange) {
        /* The merged body is ONE draw with no groups; chrome splits it into
           three ranges over two materials for as long as the power is up, so
           the eyes stay flesh and readable. Off again = back to one draw. */
        const g = m.geometry, e = this._eyeRange;
        g.clearGroups();
        if (chromeOn) {
          const tail = g.attributes.position.count - (e.start + e.count);
          if (e.start > 0) g.addGroup(0, e.start, 0);
          g.addGroup(e.start, e.count, 1);
          if (tail > 0) g.addGroup(e.start + e.count, tail, 0);
          if (!m.userData.origMat) m.userData.origMat = m.material;
          m.material = [this.M.chrome, m.userData.origMat];
        } else if (m.userData.origMat) {
          m.material = m.userData.origMat;
          m.userData.origMat = null;
        }
        continue;
      }
      if (chromeOn) {
        if (!m.userData.origMat) m.userData.origMat = m.material;
        m.material = this.M.chrome;
      } else if (m.userData.origMat) {
        m.material = m.userData.origMat;
        m.userData.origMat = null;
      }
    }
    if (this.scarfMesh) {
      if (chromeOn) {
        if (!this.scarfMesh.userData.origMat) this.scarfMesh.userData.origMat = this.scarfMesh.material;
        this.scarfMesh.material = this.M.chrome;
      } else if (this.scarfMesh.userData.origMat) {
        this.scarfMesh.material = this.scarfMesh.userData.origMat;
        this.scarfMesh.userData.origMat = null;
      }
    }

    // vanish opacity is applied through the same path as heroFade
    this._fadeApplied = -1;
  }

  /* ─────────────────────────────── the update ─────────────────────────────── */

  /**
   * One frame of hero. Reads the controller, writes the rig. ZERO allocation.
   * @param {number} dt seconds (already clamped by the engine)
   * @param {object} player the §11 Player
   */
  update(dt, player) {
    const d = clamp(numOr(dt, 0), 0, 1 / 15);
    if (!this.visible) { this.shadowBlob.update(d, this.root.position, null, 1); return; }

    // ---- read the controller (defensively — the hero must survive a stub) --
    const p = player || null;
    const rp = p && (p.renderPos || p.pos);
    const vel = p && p.vel;

    if (rp) this.root.position.set(rp.x, rp.y, rp.z);
    const facing = p ? numOr(p.facing, this.root.rotation.y) : this.root.rotation.y;
    this.root.rotation.y = facing;

    const vx = vel ? numOr(vel.x, 0) : 0;
    const vy = vel ? numOr(vel.y, 0) : 0;
    const vz = vel ? numOr(vel.z, 0) : 0;
    const horiz = Math.hypot(vx, vz);
    this._speed = p ? numOr(p.speed, horiz) : horiz;
    this._speedN = clamp01(this._speed / TUNE.speedRun);

    const grounded = p ? !!(p.grounded || p.onGround) : true;
    this._prevGrounded = this._grounded;
    this._grounded = grounded;

    let anim = p && typeof p.anim === 'string' ? p.anim : (p && typeof p.state === 'string' ? p.state : 'idle');
    if (p && p.dead) anim = 'dead';
    this._prevAnim = this._anim;
    this._anim = anim;
    this._animT = p ? numOr(p.animT, this._animT + d) : this._animT + d;
    if (anim !== this._prevAnim && !p) this._animT = 0;

    // ground normal (for the foot plant); the controller may not publish one
    const gn = p && (p.groundNormal || p.groundN);
    if (gn && typeof gn.y === 'number') this._groundN.set(gn.x || 0, gn.y, gn.z || 0);
    else this._groundN.set(0, 1, 0);
    if (this._groundN.lengthSq() < 1e-6) this._groundN.set(0, 1, 0);

    // ---- bookkeeping the cycles need ------------------------------------
    if (grounded) {
      this._dist += horiz * d;
      this._airT = 0;
    } else {
      if (this._prevGrounded) this._lastAirT = 0;
      this._airT += d;
    }
    const stride = lerp(STRIDE_WALK, STRIDE_RUN, clamp01((this._speed - TUNE.speedWalk) / (TUNE.speedRun - TUNE.speedWalk)));
    if (grounded && this._speed > 0.25) {
      // Wrapped, because `_dist` is cumulative for a whole course: a raw
      // phase of 10^5 rad would start losing sine precision late in a run.
      this._phase = ((this._dist / Math.max(0.3, stride)) * TAU) % TAU;
    }

    this._leanTgt = p ? clamp(numOr(p.leanX, 0), -1, 1) : 0;
    this._lean = damp(this._lean, this._leanTgt, 9, d);

    this._breathe += d * (1.15 + this._speedN * 0.9);
    if (anim === 'idle' && this._speed < 0.2) this._idleT += d; else this._idleT = 0;

    // ---- squash / stretch triggers ---------------------------------------
    this._updateSquash(d, anim, vy);

    // ---- pose ------------------------------------------------------------
    this._resetTargets();
    this._writePose(anim, d, p, vx, vy, vz, horiz);
    this._integrateBones(d);
    this._applyRoot(d);

    // ---- IK pass: after the blend, after the root. Order matters ---------
    this._applyFootPlant(d);

    // ---- world transform is final; children can now be resolved ----------
    this.root.updateMatrixWorld(true);

    // ---- secondary -------------------------------------------------------
    this._updateFace(d, anim);
    this._updateScarf(d, vx, vy, vz, facing);
    this._updateWings(d, anim);
    this._updateFade(p);

    // ---- contact shadow --------------------------------------------------
    const world = p && p.world ? p.world : null;
    this.shadowBlob.update(d, this.root.position, world, 1 / Math.max(0.6, this._squash));
  }

  /** Copy the rest pose into every target — pose writers then state only deltas. */
  _resetTargets() {
    const B = this._bones;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      b.tx = b.rx; b.ty = b.ry; b.tz = b.rz;
    }
    this._rootPitch = 0;
    this._rootRoll = 0;
    this._rootYaw = 0;
    this._rootY = 0;
    this._rootZ = 0;
    this._ikW = 0;
    /* Per-frame OWNERSHIP of the driven channels. `_applyRoot` decays a flip
       only on a frame no pose driver claimed it, and drives the root pitch
       straight through (no spring) when a driver claims that. Cleared here, set
       by the driver that writes the channel. */
    this._flipDrvX = false;
    this._flipDrvY = false;
    this._flipDrvZ = false;
    this._rootPitchDrv = false;
    // NOT cleared: b.cx/cy/cz and the cyclic root channels. A writer that does
    // not claim the layer this frame simply leaves `_cycTgt` at 0, and the
    // envelope fades the last cyclic pose out over ~1/13 s.
    this._cycTgt = 0;
  }

  /**
   * Integrate every bone toward its target with the contract's spring rate,
   * THEN add the cyclic layer on top — undamped, so a 4.7 Hz sprint arrives at
   * the amplitude and the phase it was authored with (see CYC_LAMBDA).
   *
   * `b.bx/by/bz` is the sprung base kept apart from `b.o.rotation`, because the
   * foot-plant IK writes the published rotation and a spring that read its own
   * output back would fold the IK correction into the next frame's blend.
   */
  _integrateBones(dt) {
    const B = this._bones;
    this._cycW = damp(this._cycW, this._cycTgt, CYC_LAMBDA, dt);
    const w = this._cycW;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      b.bx = damp(b.bx, b.tx, BONE_LAMBDA, dt);
      b.by = dampAngle(b.by, b.ty, BONE_LAMBDA, dt);
      b.bz = damp(b.bz, b.tz, BONE_LAMBDA, dt);
      const r = b.o.rotation;
      r.x = b.bx + b.cx * w;
      r.y = b.by + b.cy * w;
      r.z = b.bz + b.cz * w;
    }
  }

  /** Root transform: sprung lean + driven flips + squash. */
  _applyRoot(dt) {
    const rig = this.rig;

    /* Sprung lean / bob. EXCEPT when a driver claims the pitch: the long jump
       authors its own 0.16 s smoothstep to -0.95 rad, and pushing that through
       the ROOT_LAMBDA=18 spring — starting from the run cycle's +0.20 lean —
       delivered the superman silhouette at t = 0.37 s of a 0.45 s move, i.e. on
       the DESCENT. A driven channel is written, not chased; the spring picks the
       value back up from wherever the driver left it on the next state. */
    rig.userData.px = this._rootPitchDrv
      ? this._rootPitch
      : damp(numOr(rig.userData.px, 0), this._rootPitch, ROOT_LAMBDA, dt);
    rig.userData.rz = damp(numOr(rig.userData.rz, 0), this._rootRoll, ROOT_LAMBDA, dt);
    rig.userData.ry = damp(numOr(rig.userData.ry, 0), this._rootYaw, ROOT_LAMBDA, dt);
    rig.userData.oy = damp(numOr(rig.userData.oy, 0), this._rootY, ROOT_LAMBDA, dt);
    rig.userData.oz = damp(numOr(rig.userData.oz, 0), this._rootZ, ROOT_LAMBDA, dt);

    /*
     * FLIPS decay out once the state that drove them is gone — and ONLY then.
     * The decay used to run on every frame `_flipDecay` was positive, including
     * the frames the driver was writing the channel, because every driver
     * re-arms `_flipDecay` while it drives. exp(-11*dt) = 0.832 per frame took
     * 17 % of every driven turn back on the frame it was authored, so a TAU
     * somersault peaked at 5.23 rad (83 %) and the triple landed nose-down.
     * A channel no driver claimed this frame folds its whole turns out first
     * (see `foldTurns`) and then unwinds the remainder, so a COMPLETED flip
     * settles forward through the last few degrees and only an ABORTED one
     * rotates back.
     */
    if (this._flipDecay > 0) {
      const k = Math.exp(-11 * dt);
      let idle = true;
      if (this._flipDrvX) idle = false; else this._flipPitch = foldTurns(this._flipPitch) * k;
      if (this._flipDrvY) idle = false; else this._flipYaw = foldTurns(this._flipYaw) * k;
      if (this._flipDrvZ) idle = false; else this._flipRoll = foldTurns(this._flipRoll) * k;
      if (idle) this._flipDecay -= dt;
    }

    // NOTE the sign: `_flipPitch` is stated in the contract's units (+2π for a
    // jump3 somersault, −2π for a backflip) and negated here because a POSITIVE
    // rotation about +X tips the body BACKWARD in three's frame.
    // The run's bob, body roll and lean pulse are CYCLIC and go on undamped for
    // the same reason the bone cycles do: at 9.5 Hz (the 2x bob) a ROOT_LAMBDA
    // of 18 passed 0.29 of the authored amplitude, so the sprint had no bounce.
    const cw = this._cycW;
    rig.rotation.set(
      rig.userData.px - this._flipPitch + this._cycPitch * cw,
      rig.userData.ry + this._flipYaw,
      rig.userData.rz + this._flipRoll + this._cycRoll * cw,
    );

    this._squash = damp(this._squash, this._squashTgt, SQUASH_LAMBDA, dt);
    this._squashTgt = damp(this._squashTgt, 1, SQUASH_LAMBDA * 0.75, dt);
    const sy = this._squash;
    const sxz = 1 / Math.sqrt(Math.max(0.2, sy));       // preserve volume
    rig.scale.set(sxz, sy, sxz);

    /*
     * PIVOT. `rig` hangs off `root`, whose origin is the SOLE PLANE, so writing
     * the rotation straight onto it span every flip and every root pitch around
     * the boots: a jump3 somersault swung the whole body a full body-length
     * BELOW the feet, and `_poseDead` toppled the corpse two metres off its own
     * contact blob. A body rotates about its HIPS.
     *
     * Rather than re-parent (which would move the squash pivot off the feet and
     * hide the rig transform from every harness that reads `hero.rig`), apply
     * the pivot as a translation. For a pivot p in rig-local space, rotating
     * about p instead of the origin is exactly
     *      T = S·p − R·S·p
     * which leaves T = 0 when R is identity — so a standing, leaning, squashing
     * Nim is bit-identical to before, and only rotation moves the body about
     * the hips. Squash still scales from the soles.
     */
    _v0.set(0, RIG_PIVOT_Y * sy, 0).applyEuler(rig.rotation);
    rig.position.set(
      -_v0.x,
      RIG_PIVOT_Y * sy - _v0.y + rig.userData.oy + this._cycY * cw,
      -_v0.z + rig.userData.oz,
    );
  }

  /**
   * Squash on impact, stretch on take-off. Triggered off state EDGES so it
   * fires once per event rather than every frame the state is held.
   */
  _updateSquash(dt, anim, vy) {
    const a = anim;
    const prev = this._prevAnim;
    if (a !== prev) {
      if (a === 'land' || a === 'hardLand' || a === 'poundLand') {
        const hard = a === 'hardLand' || a === 'poundLand';
        this._squashTgt = hard ? SQUASH_LAND - 0.06 : SQUASH_LAND;
        this._squash = this._squashTgt;
      } else if (a === 'jump1' || a === 'jump2' || a === 'jump3' ||
                 a === 'longjump' || a === 'backflip' || a === 'sideflip' ||
                 a === 'wallkick' || a === 'dive') {
        this._squashTgt = STRETCH_JUMP;
        this._squash = STRETCH_JUMP;
      }
    }
    // a fast landing with no explicit land state still deserves the impact
    if (this._grounded && !this._prevGrounded && a !== 'land' && a !== 'hardLand') {
      const impact = clamp01(-vy / 24);
      if (impact > 0.15) {
        this._squashTgt = lerp(1, SQUASH_LAND, impact);
        this._squash = this._squashTgt;
      }
    }
  }

  /* ───────────────────────────── pose writers ───────────────────────────── */

  /**
   * The pose table. One branch per controller state (§11). Every branch writes
   * bone targets; the cycles below layer on top. Numbers are radians and were
   * authored against the silhouette, not against a reference rig.
   */
  _writePose(anim, dt, player, vx, vy, vz, horiz) {
    const B = this.B;
    const t = this._animT;
    const sn = this._speedN;

    switch (anim) {
      case 'run':
      case 'crouchwalk':
        this._poseLocomotion(anim === 'crouchwalk');
        break;

      case 'idle':
        this._poseIdle(dt);
        break;

      case 'skid':
      case 'pivot':
        this._poseSkid(anim === 'pivot');
        break;

      case 'bonk':
        this._poseBonk(t);
        break;

      case 'crouch':
        this._poseCrouch(0.85);
        break;

      case 'jump1': this._poseJump(1, t); break;
      case 'jump2': this._poseJump(2, t); break;
      case 'jump3': this._poseJump(3, t); break;

      case 'longjump': this._poseLongJump(t); break;
      case 'backflip': this._poseBackflip(t); break;
      case 'sideflip': this._poseSideflip(t, player); break;

      case 'fall': this._poseFall(vy); break;
      case 'fly': this._poseFly(t); break;

      case 'dive': this._poseDive(t); break;
      case 'slide': this._poseSlide(t); break;
      case 'slideRecover': this._poseSlideRecover(t); break;

      case 'wallslide': this._poseWallslide(dt, player); break;
      case 'wallkick': this._poseWallkick(t); break;

      case 'poundHang': this._posePoundHang(t); break;
      case 'poundFall': this._posePoundFall(t); break;
      case 'poundLand': this._posePoundLand(t); break;

      case 'land': this._poseLand(t, false); break;
      case 'hardLand': this._poseLand(t, true); break;

      case 'slopeSlide': this._poseSlopeSlide(horiz); break;

      case 'swimIdle': this._poseSwim(false, true); break;
      case 'swim': this._poseSwim(false, false); break;
      case 'swimDive': this._poseSwim(true, false); break;

      case 'climb': this._poseClimb(dt, player); break;
      case 'climbKick': this._poseClimbKick(t); break;

      case 'cannon': this._poseCannon(t); break;

      case 'dead': this._poseDead(t); break;

      default:
        // Unknown state: never freeze. Fall back to whichever of the two
        // universal poses matches the physical situation.
        if (this._grounded) this._poseLocomotion(false); else this._poseFall(vy);
        break;
    }

    // ---- universal layers -------------------------------------------------
    // NOTE the foot plant is NOT here. It is an IK pass and runs AFTER the
    // spring blend and after the root transform settles (see update()) —
    // correcting a target that is then damped at 14 /s would leave the boots
    // a frame and a half behind the ground during a fast run cycle.
    if (this._grounded) this._flipDecay = Math.max(this._flipDecay, 0.0001);

    // lean into the turn (contract: player.leanX) and forward by speed
    this._rootRoll += -this._lean * 0.38;
    B.chest.tz += -this._lean * 0.16;
    B.head.tz += -this._lean * 0.10;
    B.head.ty += this._lean * 0.22;                 // look where you are turning

    /*
     * Forward lean by speed. The SIGN was wrong: `rig.rotation.x` is applied as
     * a rotation about +X, which tips the body's +Y toward +Z — and +Z is
     * BEHIND a hero whose yaw 0 faces −Z. So `+= sn * 0.20` leaned the sprint
     * 11.5 degrees BACKWARD, against both the comment and the spine's own
     * −0.13. (`_poseDive` −1.35 "nose down" and `_poseSlide` −1.50 "flat on the
     * deck" are the two unambiguous witnesses for the sign.) Skid, pivot and
     * bonk author their own stance out of the same speed and are excluded.
     */
    if (this._grounded && anim !== 'crouch' && anim !== 'slide' && anim !== 'dive' &&
        anim !== 'skid' && anim !== 'pivot' && anim !== 'bonk' && anim !== 'slopeSlide') {
      this._rootPitch -= sn * 0.24;                 // −pitch = nose forward
      this._rootY += -sn * 0.020;                   // ...and settle a little
    }

    void vx; void vz;
  }

  /**
   * Run / walk. Phase comes from DISTANCE, so contact never skates at any stick
   * magnitude. Amplitudes scale from a walk's shuffle to a run's full stride.
   */
  _poseLocomotion(crouched) {
    const B = this.B;
    const ph = this._phase;
    const sn = this._speedN;
    const walkMix = clamp01((this._speed - 0.3) / (TUNE.speedWalk - 0.2));
    const amp = lerp(0.16, 0.80, sn) * walkMix;
    const armAmp = lerp(0.20, 0.92, sn) * walkMix;
    const s = Math.sin(ph);
    const c = Math.cos(ph);

    if (this._speed < 0.18) { this._poseIdle(0); return; }

    /*
     * Everything PERIODIC below is written to the cyclic channels (`cx/cy/cz`,
     * `_cycY`, `_cycRoll`) and only the DC terms are sprung targets. The
     * amplitudes are unchanged — they were always right; the 14 /s smoother was
     * eating 57 % of them at the 4.74 Hz full-run cadence and lagging the rest
     * by 65 degrees, which is why 9 m/s read as a stroll.
     */
    this._cycTgt = 1;

    // legs — opposite phase, knee flexes on the swing half
    B.upperLegR.cx = s * amp;
    B.upperLegL.cx = -s * amp;
    B.lowerLegR.tx = -0.10;
    B.lowerLegL.tx = -0.10;
    B.lowerLegR.cx = -clamp01(-Math.sin(ph + 0.95)) * (0.55 + sn * 0.85);
    B.lowerLegL.cx = -clamp01(-Math.sin(ph + 0.95 + Math.PI)) * (0.55 + sn * 0.85);
    B.footR.tx = 0.14; B.footL.tx = 0.14;
    B.footR.cx = -s * 0.22 * amp;
    B.footL.cx = s * 0.22 * amp;

    // arms — contra to the legs, elbows pumping
    B.upperArmR.cx = -s * armAmp;
    B.upperArmL.cx = s * armAmp;
    B.upperArmR.tz = 0.165 + sn * 0.10;
    B.upperArmL.tz = -0.165 - sn * 0.10;
    B.lowerArmR.tx = 0.34; B.lowerArmL.tx = 0.34;
    B.lowerArmR.cx = clamp01(-s) * (0.30 + sn * 0.55);
    B.lowerArmL.cx = clamp01(s) * (0.30 + sn * 0.55);

    // hips sway, shoulders counter-rotate — the difference between a walk and
    // a puppet slid along a rail
    B.hips.cy = s * (0.06 + sn * 0.07);
    B.hips.cz = c * 0.045 * sn;
    B.chest.cy = -s * (0.07 + sn * 0.10);
    B.head.cy = s * 0.05;

    /* DRIVE. ROUND 4 (critic): "RUN TORSO DOES NOT LEAN — chest.x = 0.040 rad
     * (2.3 degrees) at a 9.0 m/s full run … the limbs cycle correctly but with
     * a vertical torso the profile read is an upright shuffle rather than a
     * driving run." Measured and true: `_poseLocomotion` wrote `spine.tx` and
     * nothing else in the pitch channel, and the chest bone was left at its
     * rest 0.040 — the whole forward lean was the root's 0.24 rad, which tips
     * the LEGS with the body and so reads as posture, not effort.
     *
     * The spine and chest now carry a real lean that scales with speed
     * (-0.20 and -0.26 at a full run, 0.46 rad = 26 degrees of torso on top of
     * the root's 14), and the neck counter-rotates so Nim still looks where he
     * is going instead of at his boots — which is the actual shape of a sprint.
     */
    B.spine.tx = -0.035 - sn * 0.165;
    B.chest.tx = -0.045 - sn * 0.215;
    B.neck.tx = 0.050 + sn * 0.210;
    B.head.tx = 0.045 + sn * 0.180;

    // 2× vertical bob (now that it is delivered, it is worth having a flight
    // phase in it), plus a touch of body roll on the plant
    this._cycY = Math.sin(ph * 2) * (0.010 + sn * 0.034);
    this._cycRoll = Math.sin(ph) * 0.050 * sn;
    this._cycPitch = 0;
    this._rootY += -sn * 0.012;

    if (crouched) {
      this._poseCrouchOverlay(0.55);
      this._rootY -= 0.14;
    }
  }

  /** Idle: breathe, weight shift, and a look-around after 4 s of stillness. */
  _poseIdle(dt) {
    const B = this.B;
    const br = Math.sin(this._breathe * 1.5);
    const sway = Math.sin(this._breathe * 0.45);

    B.chest.tx = 0.04 + br * 0.035;
    B.spine.tx = -0.03 - br * 0.020;
    B.upperArmR.tx = 0.06 + br * 0.045;
    B.upperArmL.tx = 0.06 + br * 0.045;
    B.upperArmR.tz = 0.165 + br * 0.030;
    B.upperArmL.tz = -0.165 - br * 0.030;
    B.hips.tz = sway * 0.035;
    B.hips.ty = sway * 0.045;
    B.head.tz = -sway * 0.030;
    this._rootY += br * 0.010;

    // look-around: a slow scan of the room, on a 6 s loop, once idle > 4 s
    if (this._idleT > IDLE_LOOK_AFTER) {
      const lt = (this._idleT - IDLE_LOOK_AFTER) % 6.0;
      const w = smoothstep(0, 0.6, lt) * (1 - smoothstep(4.4, 5.4, lt));
      const dir = Math.sin(lt * 1.05);
      // clamped: past ~0.6 rad the far eye rides onto the head's silhouette
      // edge, which is where a stuck-on eyeball announces itself
      B.head.ty += dir * LOOK_YAW_MAX * w;
      B.head.tx += (0.10 - Math.abs(dir) * 0.16) * w;
      B.chest.ty += dir * 0.16 * w;
      this._lookYaw = dir * w;
    } else {
      this._lookYaw = damp(this._lookYaw, 0, 6, Math.max(dt, 1 / 120));
    }
  }

  /**
   * BONK — grounded, shoulder into a wall that will not move. A short recoil
   * off the impact (the first 0.18 s), then a press: both palms flat on the
   * wall, weight forward, boots scuffing at half the run cadence so the hero
   * reads as TRYING rather than as a run cycle playing on the spot.
   */
  _poseBonk(t) {
    const B = this.B;
    const recoil = 1 - clamp01(t / 0.18);              // 1 -> 0 over the first 0.18 s
    const ph = t * 7.0;                                // slow scuff cadence
    const sc = Math.sin(ph);

    // Sign, same defect as the run lean: +pitch is BACKWARD, so the old
    // `0.20 − recoil*0.30` settled the hero leaning AWAY from the wall — a
    // backward stumble with the arms spread, not the palms-on-the-wall press
    // the pose is describing. −0.24 is weight forward, into the wall.
    this._rootPitch = -0.24 + recoil * 0.38;           // snap back, then lean in
    this._rootY -= 0.05 + recoil * 0.06;

    // palms on the wall, elbows out
    B.upperArmR.tx = -1.42 - recoil * 0.25;
    B.upperArmL.tx = -1.42 - recoil * 0.25;
    B.upperArmR.tz = 0.46;
    B.upperArmL.tz = -0.46;
    B.lowerArmR.tx = 0.30;
    B.lowerArmL.tx = 0.30;

    // boots scuffing: a small, out-of-phase churn, never a full stride
    B.upperLegR.tx = 0.10 + sc * 0.26;
    B.upperLegL.tx = 0.10 - sc * 0.26;
    B.lowerLegR.tx = -0.30 - clamp01(sc) * 0.34;
    B.lowerLegL.tx = -0.30 - clamp01(-sc) * 0.34;
    B.footR.tx = 0.24 - sc * 0.14;
    B.footL.tx = 0.24 + sc * 0.14;

    B.hips.ty = sc * 0.05;
    B.spine.tx = 0.16;
    B.chest.tx = 0.10 + recoil * 0.18;
    B.head.tx = 0.26 + recoil * 0.10;                  // chin up, looking at the wall
  }

  /** Skid / pivot: lean AWAY from travel, arms flung out for balance. */
  _poseSkid(isPivot) {
    const B = this.B;
    const k = isPivot ? 1.0 : 0.75;
    // +pitch is BACKWARD (see the note in _writePose). The old −0.34 hunched
    // the hero FORWARD over a skid he is supposed to be leaning away from.
    this._rootPitch = 0.34 * k;                       // lean back into the stop
    this._rootY -= 0.10 * k;
    B.upperLegR.tx = 0.44 * k;
    B.upperLegL.tx = -0.30 * k;
    B.lowerLegR.tx = -0.42 * k;
    B.lowerLegL.tx = -0.20 * k;
    B.footR.tx = 0.42 * k;
    B.footL.tx = 0.10;
    B.upperArmR.tx = -0.75 * k;
    B.upperArmL.tx = -0.55 * k;
    B.upperArmR.tz = 0.62 * k;
    B.upperArmL.tz = -0.70 * k;
    B.lowerArmR.tx = 0.55;
    B.lowerArmL.tx = 0.70;
    B.chest.tx = -0.16 * k;
    B.head.tx = -0.22 * k;                            // gaze level under the back lean
    if (isPivot) {
      B.hips.ty = this._lean * 0.35;
      B.chest.ty = -this._lean * 0.40;
    }
  }

  _poseCrouch(k) { this._poseCrouchOverlay(k); this._rootY -= 0.30 * k; }

  /** The crouch shape, reusable by crouchwalk and the pre-longjump frames. */
  _poseCrouchOverlay(k) {
    const B = this.B;
    B.upperLegR.tx = 0.92 * k; B.upperLegL.tx = 0.92 * k;
    B.upperLegR.tz = 0.22 * k; B.upperLegL.tz = -0.22 * k;
    B.lowerLegR.tx = -1.55 * k; B.lowerLegL.tx = -1.55 * k;
    B.footR.tx = 0.62 * k; B.footL.tx = 0.62 * k;
    B.spine.tx = 0.30 * k;
    B.chest.tx = 0.22 * k;
    B.head.tx = -0.34 * k;
    B.upperArmR.tx = 0.55 * k; B.upperArmL.tx = 0.55 * k;
    B.upperArmR.tz = 0.34 * k; B.upperArmL.tz = -0.34 * k;
    B.lowerArmR.tx = 1.05 * k; B.lowerArmL.tx = 1.05 * k;
  }

  /**
   * The jump family. 1 = tuck, 2 = knee raise + arm punch, 3 = a full forward
   * somersault whose rotation is driven to land on exactly one turn over the
   * measured air time (contract §13).
   */
  _poseJump(n, t) {
    const B = this.B;
    const rise = clamp01(t / 0.22);

    if (n === 1) {
      // tuck: knees up, arms swept back then forward
      B.upperLegR.tx = 0.75 * rise; B.upperLegL.tx = 0.52 * rise;
      B.lowerLegR.tx = -0.95 * rise; B.lowerLegL.tx = -0.62 * rise;
      B.footR.tx = 0.35; B.footL.tx = 0.28;
      B.upperArmR.tx = -0.95 * rise; B.upperArmL.tx = -0.95 * rise;
      B.upperArmR.tz = 0.42; B.upperArmL.tz = -0.42;
      B.lowerArmR.tx = 0.62; B.lowerArmL.tx = 0.62;
      B.spine.tx = -0.14 * rise;
      B.head.tx = -0.12 * rise;
      this._rootPitch = -0.10;
    } else if (n === 2) {
      // knee raise + a punch of the arms overhead
      B.upperLegR.tx = 1.35 * rise; B.upperLegL.tx = 0.30 * rise;
      B.lowerLegR.tx = -1.45 * rise; B.lowerLegL.tx = -0.35 * rise;
      B.footR.tx = 0.50; B.footL.tx = 0.18;
      B.upperArmR.tx = -2.15 * rise; B.upperArmL.tx = -2.15 * rise;
      B.upperArmR.tz = 0.26; B.upperArmL.tz = -0.26;
      B.lowerArmR.tx = 0.32; B.lowerArmL.tx = 0.32;
      B.spine.tx = -0.20 * rise;
      B.head.tx = 0.16 * rise;
      this._rootPitch = -0.16;
      this._rootRoll += 0.10;
    } else {
      // jump3: full somersault. Air time is the exact reach-table figure, so
      // the turn always completes a hair before the landing frame.
      const air = Math.max(0.35, this._jumpAirTime(3));
      const f = clamp01(t / air);
      /*
       * CONSTANT angular velocity, not a smoothstep. `smoothstep(0.02, 0.92, f)`
       * delivered 8 degrees of turn at f = 0.10 and a whole turn by f = 0.90, so
       * the two moments a player actually reads — the take-off and the landing —
       * both photographed as plain idle (measured: jump3_p10 and jump3_p90
       * pixel-identical to idle_p50, hips pitch 0.0 deg for the whole first
       * 0.5 s). A real somersault takes ALL of its angular momentum at take-off
       * and then turns at a constant rate: 38 deg by p10, 345 deg by p90 —
       * unmistakable flip information in every frame.
       */
      this._flipPitch = TAU * clamp01(f / 0.94);
      this._flipDrvX = true;
      this._flipDecay = 0.35;
      /*
       * ...and three POSE phases, none of which is the rest pose. The old
       * `tuck = sin(PI · f · 1.12)` is zero at BOTH ends by construction, which
       * is why the launch and the landing were idle no matter what the tuck
       * amplitudes were.
       */
      const launch = 1 - smoothstep(0, 0.24, f);     // the drive off the floor
      const tuck = smoothstep(0.06, 0.34, f) * (1 - smoothstep(0.56, 0.84, f));
      const land = smoothstep(0.58, 0.92, f);        // reaching for the floor
      B.upperLegR.tx = -0.55 * launch + 1.55 * tuck + 0.72 * land;
      B.upperLegL.tx = -0.48 * launch + 1.45 * tuck + 0.42 * land;
      B.lowerLegR.tx = 0.10 * launch - 2.05 * tuck - 0.95 * land;
      B.lowerLegL.tx = 0.10 * launch - 2.05 * tuck - 0.62 * land;
      B.footR.tx = -0.55 * launch + 0.55 * tuck + 0.46 * land;
      B.footL.tx = -0.55 * launch + 0.55 * tuck + 0.46 * land;
      B.upperArmR.tx = 2.60 * launch + 0.85 * tuck - 1.35 * land;
      B.upperArmL.tx = 2.60 * launch + 0.85 * tuck - 1.05 * land;
      B.upperArmR.tz = 0.30 * launch + 0.55 * tuck + 1.42 * land;
      B.upperArmL.tz = -0.30 * launch - 0.55 * tuck - 1.42 * land;
      B.lowerArmR.tx = 0.24 * launch + 1.75 * tuck + 0.78 * land;
      B.lowerArmL.tx = 0.24 * launch + 1.75 * tuck + 0.78 * land;
      B.spine.tx = -0.30 * launch + 0.42 * tuck + 0.30 * land;
      B.chest.tx = -0.16 * launch + 0.30 * tuck + 0.18 * land;
      B.head.tx = 0.34 * launch - 0.30 * tuck - 0.46 * land;
      this._rootPitch = -0.34 * launch - 0.30 * land;
      this._rootY -= 0.16 * land;
    }
  }

  /** Air time of a jump-family move, from the published reach table. */
  _jumpAirTime(n) {
    // The reach table is computed by tuning.js from the SAME numbers the
    // controller integrates, so this can never drift from what actually happens.
    const v0 = TUNE.jumpV[clamp(n - 1, 0, 2)];
    return (v0 / TUNE.gravRise) + (v0 / TUNE.gravFall);
  }

  /**
   * Long jump: SUPERMAN. Body flat, ONE straight line from fingertips to toes.
   *
   * The old pose was neither a superman nor distinguishable from the dive:
   * `upperArm.tx = −2.55` is up-and-BACK (a limb bone's tip goes to
   * −L·sin(θ) in Z, so a NEGATIVE tx swings it behind the hero — the header's
   * "positive = forward" convention), so both arms ended folded beside the ears,
   * and `lowerLeg.tx = −0.28` with `upperLeg.tx = −0.40` left the knees visibly
   * folded. Photographed at 54 degrees of body pitch that reads as a crouching
   * man lying on his side, and it was pixel-for-pixel the dive.
   *
   * What a superman actually is, and what is authored here:
   *   - body FLAT (−1.40 rad, 80 degrees), not merely leaning;
   *   - arms in line with the spine and PAST the head (tx ≈ +2.95 → the hands
   *     end up ahead of the crown), elbows locked straight;
   *   - legs straight, together and trailing, knees locked, toes pointed;
   *   - a shallow back arch and the chin UP, eyes on the landing.
   * The dive (below) contradicts every one of those: steeper than flat, arms
   * angled DOWN off the body line, head tucked between them, hips piked.
   */
  _poseLongJump(t) {
    const B = this.B;
    const k = smoothstep(0, 0.16, t);
    this._rootPitch = -1.40 * k;                   // flat along the arc
    this._rootPitchDrv = true;                     // driven, not sprung (see _applyRoot)
    this._rootY += 0.32 * k;
    // arms extended past the head, a hair apart so the skull stays readable
    B.upperArmR.tx = 2.95 * k; B.upperArmL.tx = 2.95 * k;
    B.upperArmR.tz = 0.30 * k; B.upperArmL.tz = -0.30 * k;
    B.lowerArmR.tx = -0.06 * k; B.lowerArmL.tx = -0.06 * k;   // elbows locked
    B.handR.tx = -0.10 * k; B.handL.tx = -0.10 * k;
    B.shoulderR.tz = -0.14 * k; B.shoulderL.tz = 0.14 * k;    // shrugged forward
    // legs locked straight and closed, in line with the spine
    B.upperLegR.tx = -0.12 * k; B.upperLegL.tx = -0.12 * k;
    B.upperLegR.tz = -0.035 * k; B.upperLegL.tz = 0.035 * k;  // ankles together
    B.lowerLegR.tx = 0.06 * k; B.lowerLegL.tx = 0.06 * k;     // knees locked
    B.footR.tx = -0.62 * k; B.footL.tx = -0.62 * k;           // toes pointed
    B.spine.tx = -0.16 * k;                                    // shallow arch
    B.chest.tx = -0.14 * k;
    B.neck.tx = 0.32 * k;
    B.head.tx = 0.92 * k;                          // chin UP, eyes on the landing
  }

  /**
   * Backflip: a full BACKWARD turn, tight tuck, arms crossed in.
   *
   * Same two defects as jump3, same two fixes: the turn runs at a constant
   * rate (so p10 and p90 carry real rotation instead of 8 deg and a completed
   * circle), and the pose envelope has a LAUNCH and a LAND phase, so
   * backflip_p10 and backflip_p90 stop being pixel-identical to idle_p50. The
   * launch is the giveaway of a backflip specifically: arms thrown up and BACK
   * over the head while the legs drive, the mirror of jump3's forward swing.
   */
  _poseBackflip(t) {
    const B = this.B;
    const air = (TUNE.backflip.vy / TUNE.gravRise) + (TUNE.backflip.vy / TUNE.gravFall);
    const f = clamp01(t / Math.max(0.35, air));
    this._flipPitch = -TAU * clamp01(f / 0.94);
    this._flipDrvX = true;
    this._flipDecay = 0.35;
    const launch = 1 - smoothstep(0, 0.24, f);
    const tuck = smoothstep(0.06, 0.34, f) * (1 - smoothstep(0.56, 0.84, f));
    const land = smoothstep(0.58, 0.92, f);
    B.upperLegR.tx = -0.42 * launch + 1.65 * tuck + 0.66 * land;
    B.upperLegL.tx = -0.42 * launch + 1.65 * tuck + 0.40 * land;
    B.lowerLegR.tx = 0.12 * launch - 2.15 * tuck - 0.92 * land;
    B.lowerLegL.tx = 0.12 * launch - 2.15 * tuck - 0.60 * land;
    B.footR.tx = -0.50 * launch + 0.60 * tuck + 0.44 * land;
    B.footL.tx = -0.50 * launch + 0.60 * tuck + 0.44 * land;
    B.upperArmR.tx = -2.45 * launch + 1.10 * tuck - 1.25 * land;
    B.upperArmL.tx = -2.45 * launch + 1.10 * tuck - 0.95 * land;
    B.upperArmR.tz = 0.22 * launch + 0.42 * tuck + 1.48 * land;
    B.upperArmL.tz = -0.22 * launch - 0.42 * tuck - 1.48 * land;
    B.lowerArmR.tx = 0.30 * launch + 2.05 * tuck + 0.72 * land;
    B.lowerArmL.tx = 0.30 * launch + 2.05 * tuck + 0.72 * land;
    B.spine.tx = -0.34 * launch + 0.36 * tuck + 0.26 * land;
    B.chest.tx = -0.18 * launch + 0.14 * tuck + 0.16 * land;
    B.head.tx = -0.38 * launch - 0.42 * tuck - 0.42 * land;
    this._rootPitch = 0.30 * launch - 0.26 * land;
    this._rootY -= 0.14 * land;
  }

  /** Sideflip: a cartwheel about the roll axis, in the direction of the flip. */
  _poseSideflip(t, player) {
    const B = this.B;
    const air = (TUNE.sideflip.vy / TUNE.gravRise) + (TUNE.sideflip.vy / TUNE.gravFall);
    const f = clamp01(t / Math.max(0.35, air));
    const dir = (player && numOr(player.flipDir, 0)) || (this._lean >= 0 ? 1 : -1);
    this._flipRoll = dir * TAU * smoothstep(0.02, 0.90, f);
    this._flipDrvZ = true;
    this._flipDecay = 0.35;
    const tuck = Math.sin(Math.PI * clamp01(f * 1.10));
    B.upperLegR.tx = 0.95 * tuck; B.upperLegL.tx = 1.35 * tuck;
    B.upperLegR.tz = 0.45 * tuck; B.upperLegL.tz = -0.20 * tuck;
    B.lowerLegR.tx = -1.35 * tuck; B.lowerLegL.tx = -1.75 * tuck;
    B.upperArmR.tx = -1.10 * tuck; B.upperArmL.tx = -1.10 * tuck;
    B.upperArmR.tz = 1.35 * tuck; B.upperArmL.tz = -1.35 * tuck;
    B.lowerArmR.tx = 0.45; B.lowerArmL.tx = 0.45;
    B.chest.tz = dir * 0.30 * tuck;
    B.head.tz = -dir * 0.28 * tuck;
  }

  /** Falling: arms up and out, legs reaching for the floor as speed builds. */
  _poseFall(vy) {
    const B = this.B;
    const f = clamp01(-vy / 22);
    B.upperArmR.tx = -1.15 - f * 0.55; B.upperArmL.tx = -1.15 - f * 0.55;
    B.upperArmR.tz = 0.60 + f * 0.35; B.upperArmL.tz = -0.60 - f * 0.35;
    B.lowerArmR.tx = 0.55; B.lowerArmL.tx = 0.55;
    B.upperLegR.tx = 0.34 - f * 0.30; B.upperLegL.tx = 0.10 - f * 0.20;
    B.lowerLegR.tx = -0.55 + f * 0.35; B.lowerLegL.tx = -0.28 + f * 0.20;
    B.footR.tx = 0.25 + f * 0.25; B.footL.tx = 0.20 + f * 0.25;
    B.spine.tx = -0.10 + f * 0.16;
    B.head.tx = -0.16 - f * 0.22;             // look down at the landing
    this._rootPitch = -0.06 + f * 0.22;
    // a slow air-flail roll so a long fall never freezes
    this._rootRoll += Math.sin(this._breathe * 2.1) * 0.06 * f;
  }

  /** Wing power glide — arms out, body level, legs trailing. */
  _poseFly(t) {
    const B = this.B;
    const beat = Math.sin(t * 7.0);
    B.upperArmR.tx = -1.45; B.upperArmL.tx = -1.45;
    B.upperArmR.tz = 1.15 + beat * 0.16; B.upperArmL.tz = -1.15 - beat * 0.16;
    B.lowerArmR.tx = 0.18; B.lowerArmL.tx = 0.18;
    B.upperLegR.tx = -0.28; B.upperLegL.tx = -0.22;
    B.lowerLegR.tx = -0.30; B.lowerLegL.tx = -0.24;
    B.spine.tx = -0.16;
    B.head.tx = 0.24;
    this._rootPitch = -0.42 + beat * 0.05;
    this._rootY += 0.06 + beat * 0.03;
  }

  /**
   * Dive: BELLY FIRST, and deliberately the opposite read to the superman above.
   *
   * Same defect as the long jump before it — `upperArm.tx = −2.75` put both
   * arms up and BEHIND the ears, not forward — plus the two states shared a
   * silhouette. Every channel below now contradicts `_poseLongJump`:
   *   superman  flat (−1.40)   arms in line past the head   back arched   chin UP
   *   dive      steep (−1.86)  arms angled DOWN off the line head TUCKED  hips piked
   * so the pair can be told apart from a thumbnail, at any yaw.
   */
  _poseDive(t) {
    const B = this.B;
    const k = smoothstep(0, 0.12, t);
    this._rootPitch = -1.86 * k;                   // past flat: head below the hips
    this._rootY += 0.34 * k;
    this._rootZ += -0.06 * k;
    // arms speared AHEAD and below the body line, hands close together
    B.upperArmR.tx = 2.28 * k; B.upperArmL.tx = 2.28 * k;
    B.upperArmR.tz = 0.10 * k; B.upperArmL.tz = -0.10 * k;
    B.lowerArmR.tx = -0.04 * k; B.lowerArmL.tx = -0.04 * k;
    B.handR.tx = 0.26 * k; B.handL.tx = 0.26 * k;      // knife-edge, leading
    B.shoulderR.tz = -0.24 * k; B.shoulderL.tz = 0.24 * k;
    // legs straight and trailing, but scissored — never the closed superman line
    B.upperLegR.tx = -0.20 * k; B.upperLegL.tx = -0.06 * k;
    B.upperLegR.tz = 0.17 * k; B.upperLegL.tz = -0.17 * k;
    B.lowerLegR.tx = 0.02 * k; B.lowerLegL.tx = 0.02 * k;
    B.footR.tx = -0.70 * k; B.footL.tx = -0.55 * k;
    B.spine.tx = 0.30 * k;                             // piked, belly leading
    B.chest.tx = 0.16 * k;
    B.neck.tx = -0.22 * k;
    B.head.tx = -0.26 * k;                             // head TUCKED between the arms
  }

  /** Belly slide: flat on the deck, one arm forward, one tucked, feet kicking. */
  _poseSlide(t) {
    const B = this.B;
    this._rootPitch = -1.50;
    this._rootY += -0.42;
    const kick = Math.sin(t * 12);
    B.upperArmR.tx = -2.60; B.upperArmL.tx = -1.95;
    B.upperArmR.tz = 0.22; B.upperArmL.tz = -0.55;
    B.lowerArmR.tx = 0.10; B.lowerArmL.tx = 1.05;
    B.upperLegR.tx = -0.18 + kick * 0.16; B.upperLegL.tx = -0.18 - kick * 0.16;
    B.lowerLegR.tx = -0.50 - kick * 0.30; B.lowerLegL.tx = -0.50 + kick * 0.30;
    B.footR.tx = -0.40; B.footL.tx = -0.40;
    B.spine.tx = -0.20;
    B.head.tx = 0.62;
  }

  /** Slide into a wall: a 0.25 s scramble back to the feet. */
  _poseSlideRecover(t) {
    const B = this.B;
    const f = clamp01(t / 0.25);
    this._rootPitch = lerp(-1.50, -0.20, f);
    this._rootY += lerp(-0.42, -0.05, f);
    B.upperArmR.tx = lerp(-2.60, -0.30, f); B.upperArmL.tx = lerp(-1.95, -0.30, f);
    B.upperArmR.tz = 0.45; B.upperArmL.tz = -0.45;
    B.lowerArmR.tx = 1.15; B.lowerArmL.tx = 1.15;
    B.upperLegR.tx = lerp(-0.18, 0.95, f); B.upperLegL.tx = lerp(-0.18, 0.55, f);
    B.lowerLegR.tx = lerp(-0.50, -1.30, f); B.lowerLegL.tx = lerp(-0.50, -0.90, f);
    B.spine.tx = lerp(-0.20, 0.28, f);
    B.head.tx = lerp(0.62, -0.10, f);
  }

  /**
   * Wall slide: brace against the wall. `player.wallN` is the wall's outward
   * normal, so the hero turns his back toward −wallN and reaches into it.
   */
  _poseWallslide(dt, player) {
    const B = this.B;
    const n = player && player.wallN;
    // side of the body the wall is on, in hero-local space
    let side = 1;
    if (n && typeof n.x === 'number') {
      const f = this.root.rotation.y;
      const lx = Math.cos(f) * n.x - Math.sin(f) * n.z;
      side = lx >= 0 ? 1 : -1;
    }
    // index into the pre-resolved limb groups — no string building per frame
    const ni = side > 0 ? 0 : 1;
    const fi = side > 0 ? 1 : 0;
    const armNear = this._arms[ni], armFar = this._arms[fi];
    const legNear = this._legs[ni], legFar = this._legs[fi];

    /*
     * The old wall slide wrote NOTHING that varied with time, so all three
     * captures were the same image (measured: hips pitch 6.9 deg / roll 11.5
     * deg, constant), and it braced nothing: one arm out, the other down, both
     * feet in the rest stance, body barely rolled. It read as "idle with an
     * arm out".
     *
     * Now: the shoulders TURN to the wall, the body ROLLS hard into it, the
     * near palm is flat on the wall high and the far hand low, the near boot is
     * planted flat ON the wall plane with the knee driven out and the far leg
     * trails straight down — and the whole thing judders, because a boot
     * grinding down rock is stick-slip friction, not a lift descending.
     */
    this._wallPh += dt * (16.0 + this._speedN * 9.0);
    if (this._wallPh > 1e4) this._wallPh -= 1e4;
    const j = Math.sin(this._wallPh);                 // fast friction chatter
    const slip = Math.sin(this._wallPh * 0.21);       // slow hand-over-hand slip

    this._rootRoll += side * 0.44 + j * 0.028;        // pressed into the wall
    this._rootYaw += -side * 0.36;                    // shoulders square to it
    this._rootPitch = -0.10 + j * 0.018;
    this._rootY += j * 0.014;

    // near arm: forearm and palm flat on the wall, high, sliding down it
    armNear.ua.tx = -0.95 - slip * 0.30;
    armNear.ua.tz = side * (1.42 + slip * 0.10);
    armNear.la.tx = 1.15;
    armNear.hd.tz = side * 0.55;
    // far arm: reaching across, fingertips on the wall low
    armFar.ua.tx = -0.42;
    armFar.ua.tz = side * 0.34;
    armFar.la.tx = 1.38;
    armFar.hd.tz = side * 0.30;
    // near leg: boot planted FLAT on the wall, knee driven out
    legNear.ul.tx = 0.62 + j * 0.045;
    legNear.ul.tz = side * 0.66;
    legNear.ll.tx = -0.78;
    legNear.ft.tx = 0.12;
    legNear.ft.tz = side * 0.42;
    // far leg: straight, trailing down the wall, toe dragging
    legFar.ul.tx = -0.24;
    legFar.ul.tz = -side * 0.08;
    legFar.ll.tx = -0.12;
    legFar.ft.tx = 0.34;

    B.spine.tz = side * 0.14;
    B.chest.tz = side * 0.30;
    B.chest.ty = -side * 0.24;                        // shoulder into the rock
    B.head.ty = side * 0.48;                          // looking along the wall
    B.head.tx = -0.24 + j * 0.02;                     // ...and up, for the kick
  }

  /** Wall kick: the coil-and-release off the wall, arms thrown up. */
  _poseWallkick(t) {
    const B = this.B;
    const f = clamp01(t / 0.20);
    B.upperArmR.tx = lerp(-0.6, -2.35, f); B.upperArmL.tx = lerp(-0.6, -2.35, f);
    B.upperArmR.tz = lerp(0.9, 0.28, f); B.upperArmL.tz = lerp(-0.9, -0.28, f);
    B.lowerArmR.tx = 0.35; B.lowerArmL.tx = 0.35;
    B.upperLegR.tx = lerp(1.25, -0.25, f); B.upperLegL.tx = lerp(0.85, 0.30, f);
    B.lowerLegR.tx = lerp(-1.55, -0.20, f); B.lowerLegL.tx = lerp(-1.10, -0.45, f);
    B.footR.tx = 0.30; B.footL.tx = 0.30;
    B.spine.tx = lerp(0.22, -0.22, f);
    B.head.tx = lerp(-0.20, 0.14, f);
    this._rootPitch = lerp(0.20, -0.18, f);
  }

  /**
   * Pound hang: the whole body spins a full turn about yaw inside the 0.20 s
   * hang (contract §11) and cocks a fist over the head.
   */
  _posePoundHang(t) {
    const B = this.B;
    const f = clamp01(t / TUNE.pound.hang);
    this._flipYaw = TAU * smoothstep(0, 1, f);
    this._flipDrvY = true;
    this._flipDecay = 0.25;
    // Knees snapped to the chest — a BALL, so the drop that follows reads as
    // stored energy. The old hang wrote both arms symmetrically overhead at
    // ±0.55 out and the legs only half-tucked, which photographed as a star.
    B.upperLegR.tx = 1.78; B.upperLegL.tx = 1.66;
    B.upperLegR.tz = 0.24; B.upperLegL.tz = -0.24;
    B.lowerLegR.tx = -2.30; B.lowerLegL.tx = -2.30;
    B.footR.tx = 0.62; B.footL.tx = 0.62;
    // ONE fist cocked over the crown; the other arm folded across the chest, so
    // the silhouette is asymmetric and points at the fist that is about to fall
    B.upperArmR.tx = -2.66; B.upperArmR.tz = 0.36;   // out, so the head cannot hide it
    B.lowerArmR.tx = 0.16; B.handR.tx = 0.38;
    B.upperArmL.tx = -1.30; B.upperArmL.tz = -0.66;
    B.lowerArmL.tx = 1.60; B.handL.tx = 0.30;
    B.spine.tx = 0.34; B.chest.tx = 0.24;
    B.head.tx = -0.30;
    this._rootY += 0.16;
  }

  /**
   * Pound fall: a FIST-DOWN drop. Both previous versions read as a man standing
   * upright in mid-air with his arms out — the second one because its arms were
   * swept back symmetrically at −1.02 with the legs locked straight, which from
   * the front-three-quarter camera is exactly a star.
   *
   * The read now: knees tucked, the whole rig pitched 17 degrees over the
   * impact point, the right arm locked straight so the fist leads down the fall
   * axis, the left elbow thrown high and back, and the head tucked onto the
   * fist. Asymmetric, compact, and pointing at the floor — a silhouette that
   * cannot be confused with anything else in the state table.
   */
  _posePoundFall(t) {
    const B = this.B;

    /*
     * SPIN. CONTRACT §13 asks for "pound spin + fist" and the previous build
     * had neither during the fall: measured hips pitch −28.6 deg CONSTANT at
     * t = 0.05 / 0.25 / 0.5 and roll 0.1 / −0.3 / 0.8 deg, i.e. a body frozen
     * in mid-air. The hang's turn was dropped the instant the fall began.
     *
     * The drill spin therefore CONTINUES through the fall, driven (never
     * sprung) off the state clock and picking up exactly where the hang's TAU
     * left off, so there is no discontinuity at the state edge. It is what
     * turns three identical stills into three different ones, and it is why
     * the drive arm can be symmetric: at any yaw the silhouette is the same.
     */
    this._flipYaw = TAU * (1 + t * POUND_SPIN_HZ);
    this._flipDrvY = true;
    this._flipDecay = 0.30;

    // a fine judder on top, so even a single frame reads as violent
    const wob = Math.sin(t * 26) * 0.030;

    /*
     * FIST. Both arms are locked straight and driven down the FALL AXIS with
     * the fists closed together ahead of the chest. The rig is pitched −0.95
     * rad, so a limb at tx = +0.95 points at true world down and +1.34 is
     * down-and-well-forward: the arms then stand 54 degrees OFF the torso
     * axis, which is what actually reads. The old version put the body at
     * −0.50 and one arm at +0.66 — 9 degrees off the torso, so the arm
     * vanished inside the coat and the drop photographed as a man standing
     * still in the air with his arms at his sides.
     */
    B.shoulderR.tz = -0.34; B.shoulderL.tz = 0.34;       // shoulders to the centreline
    B.upperArmR.tx = 1.34 + wob; B.upperArmL.tx = 1.34 - wob;
    B.upperArmR.tz = -0.18; B.upperArmL.tz = 0.18;       // forearms converging
    B.lowerArmR.tx = 0.02; B.lowerArmL.tx = 0.02;        // elbows locked
    B.handR.tx = 0.46; B.handL.tx = 0.46;                // knuckles cocked down

    // heels snapped up behind — a tuck that does not crowd the fists
    B.upperLegR.tx = 0.34; B.upperLegL.tx = 0.26;
    B.upperLegR.tz = 0.20; B.upperLegL.tz = -0.20;
    B.lowerLegR.tx = -2.30; B.lowerLegL.tx = -2.20;
    B.footR.tx = 0.68; B.footL.tx = 0.68;

    B.spine.tx = 0.34; B.chest.tx = 0.26;                // curled over the fists
    B.neck.tx = -0.16; B.head.tx = -0.44;                // head tucked, eyes on the impact

    this._rootPitch = -0.95;                             // −pitch = over the impact
    this._rootRoll += wob * 0.8;
    this._rootY += 0.06;
  }

  /** Pound land: the shock crouch, then a fast pop back to standing. */
  _posePoundLand(t) {
    const B = this.B;
    const f = clamp01(t / 0.18);
    const k = 1 - f;
    this._poseCrouchOverlay(0.80 + k * 0.25);
    this._rootY -= 0.36 * (0.5 + k * 0.5);
    B.upperArmR.tx = -0.35 - k * 0.55; B.upperArmL.tx = -0.35 - k * 0.55;
    B.upperArmR.tz = 0.75 + k * 0.35; B.upperArmL.tz = -0.75 - k * 0.35;
    B.head.tx = -0.42 * (0.4 + k * 0.6);
  }

  /** Landing absorb. Hard landings drop further and take a hand to the floor. */
  _poseLand(t, hard) {
    const B = this.B;
    const dur = hard ? TUNE.hardLandLag : TUNE.landLag + 0.14;
    const f = clamp01(t / Math.max(0.06, dur));
    const k = (1 - f) * (hard ? 1.0 : 0.62);
    this._poseCrouchOverlay(0.35 + k * 0.62);
    this._rootY -= (0.10 + k * 0.24);
    B.upperArmR.tx = -0.20 - k * 1.10; B.upperArmL.tx = -0.20 - k * 0.55;
    B.upperArmR.tz = 0.40 + k * 0.45; B.upperArmL.tz = -0.40 - k * 0.30;
    B.lowerArmR.tx = 0.55 + k * 0.35; B.lowerArmL.tx = 0.85;
    if (hard) { B.chest.tx = 0.28 * k; B.head.tx = -0.44 * k; }
  }

  /** Slope slide: surfing stance, knees loaded, arms out for balance. */
  _poseSlopeSlide(horiz) {
    const B = this.B;
    const f = clamp01(horiz / TUNE.slope.maxSpeed);
    this._rootPitch = -0.22 - f * 0.18;
    this._rootRoll += this._lean * 0.30;
    this._rootY -= 0.16;
    B.upperLegR.tx = 0.72; B.upperLegL.tx = 0.42;
    B.upperLegR.tz = 0.28; B.upperLegL.tz = -0.20;
    B.lowerLegR.tx = -1.05; B.lowerLegL.tx = -0.70;
    B.footR.tx = 0.42; B.footL.tx = 0.30;
    B.upperArmR.tx = -0.95; B.upperArmL.tx = -0.95;
    B.upperArmR.tz = 1.05; B.upperArmL.tz = -1.05;
    B.lowerArmR.tx = 0.35; B.lowerArmL.tx = 0.35;
    B.spine.tx = 0.16;
    B.head.tx = 0.10;
  }

  /**
   * Swim. Surfaced: an alternating crawl stroke with a flutter kick.
   * Submerged: a frog kick — arms sweep together, legs snap and glide.
   */
  _poseSwim(submerged, idle) {
    const B = this.B;
    const t = this._breathe;
    if (idle) {
      /* TREADING. ROUND 4 (critic): "SWIM states are not strokes … the state
       * sheet cannot separate them from idle at thumbnail size." The two water
       * states now differ in the two things a thumbnail actually carries: BODY
       * AXIS (upright here, prone below) and ARM PHASE (both arms sculling
       * together here, strictly alternating below). */
      const s = Math.sin(t * 2.4);
      const sc = Math.sin(t * 3.6);
      this._rootPitch = -0.22;
      // hands sculling out at chest height, palms sweeping in and out together
      B.upperArmR.tx = -1.42; B.upperArmL.tx = -1.42;
      B.upperArmR.tz = 1.18 + sc * 0.30; B.upperArmL.tz = -1.18 - sc * 0.30;
      B.upperArmR.ty = -0.30 - sc * 0.35; B.upperArmL.ty = 0.30 + sc * 0.35;
      B.lowerArmR.tx = 0.95; B.lowerArmL.tx = 0.95;
      B.handR.tz = sc * 0.55; B.handL.tz = -sc * 0.55;
      // eggbeater kick: knees out, shins scissoring out of phase
      B.upperLegR.tx = 0.62 + s * 0.30; B.upperLegL.tx = 0.62 - s * 0.30;
      B.upperLegR.tz = 0.46; B.upperLegL.tz = -0.46;
      B.lowerLegR.tx = -1.05 - clamp01(s) * 0.30;
      B.lowerLegL.tx = -1.05 - clamp01(-s) * 0.30;
      B.footR.tx = 0.25; B.footL.tx = 0.25;
      B.spine.tx = 0.10; B.chest.tx = 0.08;
      B.head.tx = 0.30; B.head.ty = Math.sin(t * 0.8) * 0.35;
      this._rootY += Math.sin(t * 1.6) * 0.035;
      return;
    }
    if (!submerged) {
      /* FRONT CRAWL. Prone, and ROLLING: the body rotates toward the pulling
       * arm and the head turns out of the water to breathe on that side. The
       * roll is what makes a crawl read as a stroke at thumbnail size — an
       * un-rolled prone body with symmetric arms is a superman pose. */
      const ph = t * 4.2;
      const s = Math.sin(ph), c = -s;
      this._rootPitch = -1.18;
      this._rootRoll += s * 0.52;
      this._rootY += 0.18;
      // one arm reaching forward past the head, the other finishing the pull
      B.upperArmR.tx = -1.55 - s * 1.45; B.upperArmL.tx = -1.55 - c * 1.45;
      B.upperArmR.tz = 0.30 + clamp01(-s) * 0.55;
      B.upperArmL.tz = -0.30 - clamp01(-c) * 0.55;
      // high-elbow recovery on the arm that is out of the water
      B.lowerArmR.tx = 0.30 + clamp01(-s) * 1.25 + clamp01(s) * 0.35;
      B.lowerArmL.tx = 0.30 + clamp01(-c) * 1.25 + clamp01(c) * 0.35;
      B.upperLegR.tx = -0.15 + Math.sin(ph * 2) * 0.42;
      B.upperLegL.tx = -0.15 - Math.sin(ph * 2) * 0.42;
      B.lowerLegR.tx = -0.35; B.lowerLegL.tx = -0.35;
      B.footR.tx = -0.45; B.footL.tx = -0.45;
      B.chest.ty = s * 0.34;
      B.head.tx = 0.42; B.head.ty = s * 0.80; B.head.tz = s * 0.30;
      return;
    }
    // frog kick, submerged: pull, tuck, snap, glide
    const ph = (t * 2.1) % 1;
    const pull = smoothstep(0, 0.35, ph) * (1 - smoothstep(0.45, 0.75, ph));
    const kick = smoothstep(0.25, 0.55, ph) * (1 - smoothstep(0.60, 0.90, ph));
    this._rootPitch = -1.45;
    this._rootY += 0.20;
    B.upperArmR.tx = -2.45 + pull * 1.90; B.upperArmL.tx = -2.45 + pull * 1.90;
    B.upperArmR.tz = 0.20 + pull * 0.95; B.upperArmL.tz = -0.20 - pull * 0.95;
    B.lowerArmR.tx = 0.15 + pull * 0.55; B.lowerArmL.tx = 0.15 + pull * 0.55;
    B.upperLegR.tx = -0.20 + kick * 1.10; B.upperLegL.tx = -0.20 + kick * 1.10;
    B.upperLegR.tz = kick * 0.55; B.upperLegL.tz = -kick * 0.55;
    B.lowerLegR.tx = -0.15 - kick * 1.55; B.lowerLegL.tx = -0.15 - kick * 1.55;
    B.footR.tx = -0.40; B.footL.tx = -0.40;
    B.spine.tx = -0.10;
    B.head.tx = 0.35;
  }

  /**
   * Climb: alternating hand-over-hand up a pole or a net.
   *
   * Two defects, both fixed at the generator.
   *
   * 1. NO CYCLE. The phase was `this._dist * 3.4`, and `_dist` only accumulates
   *    while GROUNDED — on a pole the hero is not grounded, so the phase never
   *    moved: hips pitch 4.6 deg, roll 0.3 deg and handR.z 0.383 measured
   *    IDENTICAL to 3 decimal places at t = 0.05, 0.25 and 0.5. A dedicated
   *    clock now integrates off the climb RATE, with a floor so a held grip
   *    still shifts its weight.
   *
   * 2. NO GRIP. `upperArm.tx = −2.35` swings a limb up and BEHIND the hero (the
   *    tip goes to −L·sin θ in Z, so negative tx = backward — see the header),
   *    which is why both hands measured BEHIND the back at z = +0.31 / +0.38
   *    and the state sat 2 degrees away from `fall`: idle with an arm out. The
   *    sign is flipped, so the hands close on something IN FRONT of the chest,
   *    and the knees now pinch the pole instead of hanging.
   */
  _poseClimb(dt, player) {
    const B = this.B;
    const vy = player && player.vel ? numOr(player.vel.y, 0) : 0;
    this._climbPh += dt * (1.35 + Math.abs(vy) * 2.4);
    if (this._climbPh > 1e4) this._climbPh -= 1e4;
    const ph = this._climbPh;
    const s = Math.sin(ph), c = -s;
    // reach: the hand that is high is straight, the low one is hauling
    this._rootPitch = -0.34;                 // chest pulled in to the pole
    this._rootY += s * 0.045;                // the hitch of each pull
    B.upperArmR.tx = 2.46 + s * 0.42; B.upperArmL.tx = 2.46 + c * 0.42;
    B.upperArmR.tz = 0.26; B.upperArmL.tz = -0.26;      // grip WIDE of the face
    B.lowerArmR.tx = 0.55 + clamp01(-s) * 0.85; B.lowerArmL.tx = 0.55 + clamp01(-c) * 0.85;
    B.handR.tx = 0.45; B.handL.tx = 0.45;    // mittens closed round the pole
    B.upperLegR.tx = 0.92 + c * 0.42; B.upperLegL.tx = 0.92 + s * 0.42;
    B.upperLegR.tz = 0.42; B.upperLegL.tz = -0.42;      // knees pinching it
    B.lowerLegR.tx = -1.30 - clamp01(c) * 0.40; B.lowerLegL.tx = -1.30 - clamp01(s) * 0.40;
    B.footR.tx = 0.52; B.footL.tx = 0.52;
    B.spine.tx = 0.12;
    B.chest.ty = s * 0.24;
    B.hips.ty = -s * 0.20;
    B.head.tx = -0.26;                       // eyes up the pole
  }

  /** Kicking off a pole: a hard push away with both legs. */
  _poseClimbKick(t) {
    const B = this.B;
    const f = clamp01(t / 0.22);
    // starts from the climb's GRIP (arms forward, tx = +2.42) and throws them
    // down and open as the legs fire — the old start of −2.35 was the arms-back
    // pose the climb no longer holds, so the kick began with a 4.8 rad snap
    B.upperArmR.tx = lerp(2.42, -0.85, f); B.upperArmL.tx = lerp(2.42, -0.85, f);
    B.upperArmR.tz = 0.75; B.upperArmL.tz = -0.75;
    B.lowerArmR.tx = 0.65; B.lowerArmL.tx = 0.65;
    B.upperLegR.tx = lerp(1.20, -0.30, f); B.upperLegL.tx = lerp(1.20, -0.30, f);
    B.lowerLegR.tx = lerp(-1.65, -0.15, f); B.lowerLegL.tx = lerp(-1.65, -0.15, f);
    B.spine.tx = lerp(0.28, -0.20, f);
    this._rootPitch = lerp(0.24, -0.16, f);
  }

  /** Loaded in a cannon: a tight ball, arms wrapped around the knees. */
  _poseCannon(t) {
    const B = this.B;
    this._poseCrouchOverlay(1.10);
    this._rootY -= 0.30;
    B.upperArmR.tx = 0.95; B.upperArmL.tx = 0.95;
    B.upperArmR.tz = 0.55; B.upperArmL.tz = -0.55;
    B.lowerArmR.tx = 1.95; B.lowerArmL.tx = 1.95;
    B.head.tx = -0.55;
    this._rootPitch = 0.22 + Math.sin(t * 18) * 0.03;      // fizzing on the fuse
  }

  /**
   * Dead: limp. Knees fold, arms drop, head lolls.
   *
   * The topple is a rotation about the HIPS (see `_applyRoot`), so the numbers
   * are the ones that put a 1.5 m body FLAT: −1.45 rad lays it prone with the
   * hips at the pivot height, and the 0.42 m drop then sets the torso down at
   * about its own half-thickness. The old −1.05 / −0.55 pair was tuned against
   * a rotation about the soles and buried the corpse in the terrain 2–3 m from
   * its own contact blob.
   */
  _poseDead(t) {
    const B = this.B;
    const f = clamp01(t / 0.45);
    this._rootPitch = -1.45 * f;
    this._rootRoll += 0.40 * f;
    this._rootY -= 0.42 * f;
    B.upperArmR.tx = -0.20 * f; B.upperArmL.tx = -0.10 * f;
    B.upperArmR.tz = 0.95 * f + 0.165; B.upperArmL.tz = -1.15 * f - 0.165;
    B.lowerArmR.tx = 0.30; B.lowerArmL.tx = 0.20;
    B.upperLegR.tx = 0.85 * f; B.upperLegL.tx = 0.45 * f;
    B.upperLegR.tz = 0.35 * f; B.upperLegL.tz = -0.15 * f;
    B.lowerLegR.tx = -1.35 * f; B.lowerLegL.tx = -0.75 * f;
    B.footR.tx = -0.20; B.footL.tx = -0.20;
    B.spine.tx = 0.30 * f;
    B.chest.tx = -0.15 * f;
    B.head.tx = 0.55 * f; B.head.tz = 0.35 * f;
  }

  /* ────────────────────────────── foot plant IK ────────────────────────────── */

  /**
   * Two-bone IK that keeps both boots on the ground plane implied by the
   * player's feet position and the ground normal.
   *
   * Runs as a POST pass on the blended rotations (`bone.o.rotation`), never on
   * the pose targets: the targets are damped at 14 /s, so a correction written
   * there arrives a frame and a half late and the boots swim through the floor
   * at run speed. This is the standard pose → blend → IK order.
   *
   * The plane is evaluated in RIG-LOCAL space: the rig origin is at the feet,
   * so the target height under a foot at (fx, fz) is simply the plane through
   * the origin with the (yaw-rotated) ground normal, corrected for the bob
   * offset and squash scale the rig is carrying this frame.
   */
  _applyFootPlant(dt) {
    const legs = this._legs;
    const a = this._anim;
    const off = !this._grounded ||
      a === 'slide' || a === 'dive' || a === 'dead' || a === 'cannon' ||
      a === 'swim' || a === 'swimIdle' || a === 'swimDive' || a === 'climb';
    if (off) {
      // release the foot lock smoothly — a snap on take-off is very visible
      legs[0].penY = damp(legs[0].penY, 0, 16, dt);
      legs[1].penY = damp(legs[1].penY, 0, 16, dt);
      return;
    }

    const w = clamp01(1 - this._speedN * 0.35) *
      (a === 'idle' || a === 'run' || a === 'crouchwalk' || a === 'crouch' || a === 'land' ||
        a === 'bonk' ? 1 : 0.45);
    if (w <= 0.01) return;

    // Per-leg CONTACT weight. Pinning the swing leg to the ground plane is
    // exactly how a run turns into a skate: only the planted foot gets IK.
    // Below a slow walk both feet are planted, so both get it in full.
    const moving = clamp01((this._speed - 0.35) / 1.2);
    const sp = Math.sin(this._phase);

    // ground normal into rig-local (root yaw only; rig lean is small enough
    // to ignore here and ignoring it keeps this allocation- and matrix-free)
    const f = this.root.rotation.y;
    const cf = Math.cos(f), sf = Math.sin(f);
    const nx = this._groundN.x, ny = Math.max(0.25, this._groundN.y), nz = this._groundN.z;
    const lnx = cf * nx - sf * nz;
    const lnz = sf * nx + cf * nz;

    const hipY = P.hipY - P.hipDrop;
    const l1 = P.upperLeg, l2 = P.lowerLeg;

    // The IK solves in UNSCALED rig-local metres, but the rig carries a bob
    // offset, a lean rotation AND a squash scale. Compensating only the offset
    // is not enough: a 0.16 rad forward lean alone drops a 0.62 m hip by 8 mm
    // and pushes the boots through the floor. Take the rig's real matrix and
    // invert its Y row, which handles all three exactly and for free.
    //   rootY = m10·x + m11·y + m12·z + m13   ⇒   y = (rootY − m10·x − m12·z − m13)/m11
    this.rig.updateMatrix();
    const e = this.rig.matrix.elements;
    const m10 = e[1], m12 = e[9], m13 = e[13];
    let m11 = e[5];
    if (Math.abs(m11) < 1e-4) m11 = 1;         // rig rotated flat on its side: bail to identity
    // the ankle rides `ankleY` above the sole, in the same unscaled space
    const soleY = P.ankleY;

    for (let i = 0; i < 2; i++) {
      const leg = this._legs[i];
      const s = leg.side;
      // the BLENDED rotations, not the targets — see the doc comment
      const ulr = leg.ul.o.rotation, llr = leg.ll.o.rotation, ftr = leg.ft.o.rotation;

      // contact: the R leg plants on the -sin half of the cycle, L on the +sin
      const contact = lerp(1, clamp01(-s * sp * 1.6 + 0.25), moving);
      const wl = w * contact;
      if (wl <= 0.01) continue;

      // where the animated pose put this foot, forward of the hip
      const fx = s * P.legX;
      const fz = Math.sin(ulr.x) * (l1 + l2) * 0.7;
      // Ground plane height in ROOT space under this foot. The foot's root-space
      // XZ is approximated by its rig-local XZ — on the steepest walkable slope
      // (slope.slideDeg = 38°) that costs at most a couple of millimetres, and
      // it keeps the solve to scalars.
      const groundY = -(lnx * fx + lnz * (-fz)) / ny;
      // ...expressed as the rig-local ankle height that lands the sole there,
      // plus the foot-lock feedback term measured from the real boot last frame
      const targetY = (groundY + leg.penY - m10 * fx - m12 * (-fz) - m13) / m11 + soleY;

      // Forward kinematics of the two-bone chain as the POSE currently has it.
      // Comparing this against the target is what lets the IK be a one-sided
      // ground CLAMP at speed instead of a hard lock that fights the run cycle.
      // 2 cm band, so any real penetration saturates to a FULL correction —
      // a proportional clamp leaves the boot permanently part-way through.
      const poseFootY = hipY - l1 * Math.cos(ulr.x) - l2 * Math.cos(ulr.x + llr.x);
      const pen = clamp01((targetY - poseFootY) / 0.02);

      // Standing and walking: full two-way plant, so a slope tilts the stance.
      // Running: only the penetration term, so the swing leg stays free and
      // nothing but an actual boot-through-floor gets corrected.
      // NOTE `pen` is deliberately NOT gated by `contact`: a swing foot must
      // stay out of the floor too, and penetration is penetration whatever the
      // cycle phase says. `contact` only shapes the two-way plant.
      const wEff = Math.max(wl * (1 - moving), pen);
      if (wEff <= 0.01) continue;

      solveLeg(hipY - targetY, fz, l1, l2);
      ulr.x = lerp(ulr.x, _ik.hip, wEff);
      llr.x = lerp(llr.x, _ik.knee, wEff);

      // ankle: lay the sole along the slope instead of stabbing it
      const slopeFwd = Math.atan2(-lnz, ny);
      const slopeSide = Math.atan2(lnx, ny);
      ftr.x = lerp(ftr.x, -(ulr.x + llr.x) + slopeFwd, wEff * 0.85);
      ftr.z = lerp(ftr.z, -slopeSide, wEff * 0.85);
      if (wEff > this._ikW) this._ikW = wEff;
    }

    this._clampSoles(dt);
  }

  /**
   * The sole clamp — the second half of the foot plant, and the half that
   * actually matters. The leg solve only knows where the ANKLE is; what the
   * player sees touching the floor is a 0.30 m boot whose toe and heel swing
   * ±70 mm as the ankle pitches through a run cycle.
   *
   * So: publish the pose, measure where the real toe and heel ended up, and
   *   1. LEVEL the boot toward the ground plane in proportion to the dig, which
   *      removes the dominant term immediately (this frame), and
   *   2. feed the residual back into each leg's `penY`, which the next frame's
   *      IK target lifts by. A closed loop, converging in about three frames —
   *      invisible at 60 fps, and it never fights the animation when the boot
   *      is already clear.
   *
   * Costs one extra `updateMatrixWorld` over the rig. That is ~35 matrix
   * multiplies; the pose is published again at the end of update() anyway.
   */
  _clampSoles(dt) {
    this.root.updateMatrixWorld(true);
    const rp = this.root.position;
    const n = this._groundN;
    const ny = Math.max(0.25, n.y);
    const legs = this._legs;

    for (let i = 0; i < 2; i++) {
      const leg = legs[i];
      const mw = leg.ft.o.matrixWorld;
      const ftr = leg.ft.o.rotation;

      // real world contact points of the boot, in foot-local metres
      _v0.set(0, -P.ankleY, -SOLE_TOE_Z).applyMatrix4(mw);
      _v1.set(0, -P.ankleY, SOLE_HEEL_Z).applyMatrix4(mw);

      // ground plane through the player's feet, world
      const gToe = rp.y - (n.x * (_v0.x - rp.x) + n.z * (_v0.z - rp.z)) / ny;
      const gHeel = rp.y - (n.x * (_v1.x - rp.x) + n.z * (_v1.z - rp.z)) / ny;
      const penToe = gToe - _v0.y;
      const penHeel = gHeel - _v1.y;
      const pen = Math.max(penToe, penHeel);

      if (pen > 0.002) {
        // 1. level: rotate the ankle toward flat, hardest on the digging end
        const k = clamp01(pen / 0.03);
        const slopeFwd = Math.atan2(-(Math.sin(this.root.rotation.y) * n.x + Math.cos(this.root.rotation.y) * n.z), ny);
        const legX = leg.ul.o.rotation.x + leg.ll.o.rotation.x;
        ftr.x = lerp(ftr.x, -legX + slopeFwd, k);
        // 2. feed the residual into the next frame's IK target
        leg.penY = clamp(leg.penY + pen, 0, 0.20);
        if (k > this._ikW) this._ikW = k;
      } else {
        // clear of the floor: bleed the lock off so it cannot accumulate
        leg.penY = damp(leg.penY, 0, 7, dt);
      }
    }
  }

  /* ──────────────────────────────── the face ──────────────────────────────── */

  /**
   * Blink on a 3–5 s random cadence, and look toward the turn. Both are pure
   * transform work on two pivots — no material churn, no texture swap.
   */
  _updateFace(dt, anim) {
    // blink
    this._blinkT -= dt;
    if (this._blinkT <= 0) {
      this._blink = BLINK_TIME;
      this._blinkT = BLINK_MIN + this._rng() * (BLINK_MAX - BLINK_MIN);
    }
    let closed = 0;
    if (this._blink > 0) {
      this._blink -= dt;
      const f = clamp01(1 - this._blink / BLINK_TIME);
      closed = Math.sin(Math.PI * f);          // down and back up
    }
    // dead / hard land: eyes squeezed shut, no random blink needed
    if (anim === 'dead') closed = 1;
    else if (anim === 'hardLand' || anim === 'poundLand') closed = Math.max(closed, 0.75);

    const open = 1 - closed * 0.94;
    this._eyePivot.scale.set(1, open, 1);
    this._eyePivot.position.y = this._eyeRestY - closed * 0.012;

    // Look toward the turn direction, with a little vertical from pitch. This
    // pivot is at the HEAD origin, so a rotation here is an arc of radius 0.21:
    // the old 0.34 rad slid the irises 71 mm and threw them off the eyeballs
    // entirely. PUPIL_LOOK_* keep the dart inside the 47 mm lens.
    const wantX = clamp(this._lean, -1, 1) * 0.42 + this._lookYaw * 0.55;
    const wantY = clamp(-this._rootPitch * 0.8, -0.5, 0.5);
    this._pupilX = damp(this._pupilX, wantX, 11, dt);
    this._pupilY = damp(this._pupilY, wantY, 11, dt);
    this._pupilPivot.rotation.set(this._pupilY * PUPIL_LOOK_PITCH, this._pupilX * PUPIL_LOOK_YAW, 0);
  }

  /* ─────────────────────────────── the scarf ─────────────────────────────── */

  /**
   * 7-link Verlet chain, simulated in WORLD space, drawn in root-local space.
   * The world→local step is a hand-rolled inverse of (translate + yaw) — the
   * rig's squash must NOT reach the cloth, so the full matrix inverse would be
   * wrong even if it were free.
   */
  _updateScarf(dt, vx, vy, vz, facing) {
    const N = SCARF_LINKS + 1;
    const p = this._scarfP;
    const q = this._scarfPrev;

    /*
     * Anchor at the NAPE, in world space — not at the throat. The offset is
     * taken in the NECK BONE'S OWN FRAME (its +Z column is "backward", its +Y
     * column "up the spine") so it follows every pitch the body takes: prone in
     * a longjump the anchor rides ABOVE the neck, which is exactly where a real
     * collar sits and exactly what stops the chain falling across the face.
     * The columns carry the rig's squash scale, so they are normalised.
     */
    const nm = this.bones.neck.matrixWorld.elements;
    const uxl = Math.hypot(nm[0], nm[1], nm[2]) || 1;
    const uyl = Math.hypot(nm[4], nm[5], nm[6]) || 1;
    const uzl = Math.hypot(nm[8], nm[9], nm[10]) || 1;
    _v0.setFromMatrixPosition(this.bones.neck.matrixWorld);
    const ax = _v0.x + (nm[8] / uzl) * SCARF_ANCHOR_BACK + (nm[4] / uyl) * SCARF_ANCHOR_UP
      + (nm[0] / uxl) * SCARF_ANCHOR_SIDE;
    const ay = _v0.y + (nm[9] / uzl) * SCARF_ANCHOR_BACK + (nm[5] / uyl) * SCARF_ANCHOR_UP
      + (nm[1] / uxl) * SCARF_ANCHOR_SIDE;
    const az = _v0.z + (nm[10] / uzl) * SCARF_ANCHOR_BACK + (nm[6] / uyl) * SCARF_ANCHOR_UP
      + (nm[2] / uxl) * SCARF_ANCHOR_SIDE;

    if (!this._scarfInit) {
      for (let i = 0; i < N; i++) {
        p[i * 3] = ax; p[i * 3 + 1] = ay - i * SCARF_SEG; p[i * 3 + 2] = az;
        q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2];
      }
      this._scarfInit = true;
    }

    // If the hero teleported (respawn, checkpoint, painting entry) the chain
    // would whip across the level. Snap it home instead.
    const dx0 = p[0] - ax, dy0 = p[1] - ay, dz0 = p[2] - az;
    if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > 9) {
      for (let i = 0; i < N; i++) {
        p[i * 3] = ax; p[i * 3 + 1] = ay - i * SCARF_SEG; p[i * 3 + 2] = az;
        q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2];
      }
    }

    // wind: the hero's own motion, plus a slow gust so a standing scarf lives
    const gust = Math.sin(this._breathe * 0.9) * 0.55 + Math.sin(this._breathe * 2.3) * 0.25;
    const drape = 1.35 * (1 - this._speedN);
    // over the shoulder, always — see SCARF_SIDE
    const side = SCARF_SIDE * (0.30 + this._speedN * 1.30) + drape;
    const wx = -vx * SCARF_WIND * 9 + gust * 0.45 + Math.cos(facing) * side;
    const wy = -vy * SCARF_WIND * 3.2 + gust * 0.20;
    const wz = -vz * SCARF_WIND * 9 + gust * 0.35 - Math.sin(facing) * side;

    const h = Math.min(dt, 1 / 45);
    const h2 = h * h;

    // A travelling ripple, phase-offset down the chain. Without it a strong
    // wind term drives every particle the same way and an inextensible chain
    // becomes a straight rod pointing downwind — the "rigid blade" read.
    const flut = 0.55 + this._speedN * 2.6;
    const flutT = this._breathe * 9.5;

    // integrate
    for (let i = 1; i < N; i++) {
      const o = i * 3;
      const px = p[o], py = p[o + 1], pz = p[o + 2];
      let ivx = (px - q[o]) * SCARF_DAMP;
      let ivy = (py - q[o + 1]) * SCARF_DAMP;
      let ivz = (pz - q[o + 2]) * SCARF_DAMP;
      // tip links are lighter, so they trail further
      const light = 0.7 + (i / N) * 0.6;
      const rip = Math.sin(flutT - i * 1.35) * flut * (i / N);
      ivx += (wx + rip * 0.9) * h2 * light * 14;
      ivy += (SCARF_GRAVITY + wy + rip * 1.6) * h2 * 14;
      ivz += (wz - rip * 0.9) * h2 * light * 14;
      q[o] = px; q[o + 1] = py; q[o + 2] = pz;
      p[o] = px + ivx; p[o + 1] = py + ivy; p[o + 2] = pz + ivz;
    }
    // the collar link is pinned
    p[0] = ax; p[1] = ay; p[2] = az;
    q[0] = ax; q[1] = ay; q[2] = az;

    /*
     * RELAX. Order and gain both matter, and both were wrong: the body push-out
     * ran AFTER the length pass inside the same iteration, so the LAST thing
     * done to the chain every pass was to re-break the segment lengths — and
     * the length pass itself only applied half the correction (×0.5), twice.
     * Measured result: a 0.105 m link reaching 0.455 m (433 %) and a 0.735 m
     * scarf spanning 1.61 m at a 9 m/s run. That is not cloth, it is an elastic
     * band, and it rendered as a rigid blade and as a detached floating shard.
     *
     * Now: push out of the body FIRST, then project the lengths at full gain,
     * so the length constraint is always the last word.
     */
    _v1.setFromMatrixPosition(this.bones.chest.matrixWorld);
    _v2.setFromMatrixPosition(this.bones.head.matrixWorld);
    const iters = this.q === 0 ? 4 : 8;
    const bodyR2 = SCARF_BODY_R * SCARF_BODY_R;
    const headR2 = SCARF_HEAD_R * SCARF_HEAD_R;
    for (let k = 0; k < iters; k++) {
      // body sphere: the scarf may never sink into the coat
      for (let i = 1; i < N; i++) {
        const o = i * 3;
        const ex = p[o] - _v1.x, ey = p[o + 1] - _v1.y, ez = p[o + 2] - _v1.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < bodyR2 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (SCARF_BODY_R - d) / d;
          p[o] += ex * push; p[o + 1] += ey * push; p[o + 2] += ez * push;
        }
      }
      /* HEAD sphere. Without it the only thing between the chain and the jaw
         was gravity, and gravity points at the face whenever the body is
         horizontal.
         It starts at i = 2, not i = 1. The collar is pinned on the nape, which
         is INSIDE this sphere (0.138 m from the head bone), so pushing the
         first two particles out would straighten the chain into a rod at the
         one place a scarf should drape. They cannot reach the face anyway:
         particle 2 is at most 0.210 m of chain from the anchor and the muzzle
         is 0.408 m away from it. Every particle that CAN reach the face is
         inside this pass. */
      for (let i = 2; i < N; i++) {
        const o = i * 3;
        const ex = p[o] - _v2.x, ey = p[o + 1] - _v2.y, ez = p[o + 2] - _v2.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < headR2 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (SCARF_HEAD_R - d) / d;
          p[o] += ex * push; p[o + 1] += ey * push; p[o + 2] += ez * push;
        }
      }
      for (let i = 0; i < SCARF_LINKS; i++) {
        const a = i * 3, b = (i + 1) * 3;
        let ddx = p[b] - p[a], ddy = p[b + 1] - p[a + 1], ddz = p[b + 2] - p[a + 2];
        const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1e-6;
        const corr = (len - SCARF_SEG) / len;
        ddx *= corr; ddy *= corr; ddz *= corr;
        // the collar particle is pinned, so link 0 takes its whole correction
        // on the far end
        if (i > 0) {
          p[a] += ddx * 0.5; p[a + 1] += ddy * 0.5; p[a + 2] += ddz * 0.5;
          p[b] -= ddx * 0.5; p[b + 1] -= ddy * 0.5; p[b + 2] -= ddz * 0.5;
        } else {
          p[b] -= ddx; p[b + 1] -= ddy; p[b + 2] -= ddz;
        }
      }
      p[0] = ax; p[1] = ay; p[2] = az;
    }

    /*
     * INEXTENSIBILITY, guaranteed. Gauss–Seidel converges toward the length
     * constraint but never reaches it, and a scarf that stretches even 20 %
     * reads as rubber. One follow-the-leader pass from the pinned collar
     * outward clamps every link to AT MOST its rest length — O(7), no
     * allocation, and it makes 100 % the hard ceiling on stretch rather than a
     * number that depends on how violent the frame was.
     */
    for (let i = 1; i < N; i++) {
      const a = (i - 1) * 3, b = i * 3;
      const ddx = p[b] - p[a], ddy = p[b + 1] - p[a + 1], ddz = p[b + 2] - p[a + 2];
      const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (len > SCARF_SEG && len > 1e-6) {
        const s = SCARF_SEG / len;
        p[b] = p[a] + ddx * s;
        p[b + 1] = p[a + 1] + ddy * s;
        p[b + 2] = p[a + 2] + ddz * s;
      }
    }

    this._writeScarfGeometry(ax, ay, az, facing);
  }

  /**
   * Rebuild the ribbon in place. World points are converted to root-local by
   * subtracting the root position and un-rotating by facing (root has no other
   * transform — see the class header).
   */
  _writeScarfGeometry(ax, ay, az, facing) {
    const N = SCARF_LINKS + 1;
    const p = this._scarfP;
    const pos = this._scarfPos;
    const nor = this._scarfNor;
    const rp = this.root.position;
    const cf = Math.cos(-facing), sf = Math.sin(-facing);
    const ringA = _scarfRingA;
    const ringB = _scarfRingB;
    const norA = _scarfNorA;
    const norB = _scarfNorB;

    // hero-local "right" used to break the degenerate case of a vertical scarf
    const rx = cf, rz = -sf;

    // Twist runs DOWN the chain and grows with speed, so the cloth turns
    // edge-on and back as it trails. A flat ribbon cannot do this; a prism can,
    // and it is the difference between "a red plank" and cloth.
    const twSpeed = 0.55 + this._speedN * 1.5;
    const twPhase = this._breathe * 3.1;

    let cur = ringA, curN = norA, prev = ringB, prevN = norB;
    let have = false;

    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const wx = p[o] - rp.x, wy = p[o + 1] - rp.y, wz = p[o + 2] - rp.z;
      // Ry(-facing) * (wx, wy, wz)
      const lx = cf * wx + sf * wz;
      const ly = wy;
      const lz = -sf * wx + cf * wz;

      // tangent (toward the next point; reuse the previous for the tip)
      let tx = 0, ty = -1, tz = 0;
      if (i < N - 1) {
        const o2 = (i + 1) * 3;
        const wx2 = p[o2] - rp.x, wy2 = p[o2 + 1] - rp.y, wz2 = p[o2 + 2] - rp.z;
        tx = (cf * wx2 + sf * wz2) - lx;
        ty = wy2 - ly;
        tz = (-sf * wx2 + cf * wz2) - lz;
      } else if (have) {
        tx = lx - _scarfPrevC[0]; ty = ly - _scarfPrevC[1]; tz = lz - _scarfPrevC[2];
      }
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      // side = tangent x up, falling back to hero-right when vertical
      let sx = -tz, sy = 0, sz = tx;
      let sl = Math.sqrt(sx * sx + sz * sz);
      if (sl < 0.08) { sx = rx; sy = 0; sz = rz; sl = Math.sqrt(sx * sx + sz * sz) || 1; }
      sx /= sl; sy /= sl; sz /= sl;

      // normal = side x tangent
      let nx = sy * tz - sz * ty;
      let ny = sz * tx - sx * tz;
      let nz = sx * ty - sy * tx;

      // roll the (side, normal) frame about the tangent
      const f01 = i / (N - 1);
      const tw = SCARF_TWIST * f01
        + twSpeed * 0.35 * Math.sin(twPhase - i * 0.85) * f01;
      const ct = Math.cos(tw), st = Math.sin(tw);
      const s2x = sx * ct - nx * st, s2y = sy * ct - ny * st, s2z = sz * ct - nz * st;
      const n2x = nx * ct + sx * st, n2y = ny * ct + sy * st, n2z = nz * ct + sz * st;

      const w = lerp(SCARF_W0, SCARF_W1, f01);
      const h = lerp(SCARF_H0, SCARF_H1, f01);

      // four corners of the cross-section, in order around it
      const cxs = _scarfCX, cns = _scarfCN;
      cxs[0] = w; cxs[1] = w; cxs[2] = -w; cxs[3] = -w;
      cns[0] = h; cns[1] = -h; cns[2] = -h; cns[3] = h;
      for (let k = 0; k < 4; k++) {
        const k3 = k * 3;
        cur[k3] = lx + s2x * cxs[k] + n2x * cns[k];
        cur[k3 + 1] = ly + s2y * cxs[k] + n2y * cns[k];
        cur[k3 + 2] = lz + s2z * cxs[k] + n2z * cns[k];
      }
      // face normals: the outward bisector of each edge of the section
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        const mx = (cxs[k] + cxs[k2]) * 0.5, mn = (cns[k] + cns[k2]) * 0.5;
        let fx = s2x * mx + n2x * mn;
        let fy = s2y * mx + n2y * mn;
        let fz = s2z * mx + n2z * mn;
        const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        const k3 = k * 3;
        curN[k3] = fx / fl; curN[k3 + 1] = fy / fl; curN[k3 + 2] = fz / fl;
      }

      if (have) {
        for (let k = 0; k < 4; k++) {
          const k2 = (k + 1) & 3;
          const oi = ((i - 1) * SCARF_FACES + k) * 18;
          const a0 = k * 3, a1 = k2 * 3;
          // tri A: prev[k], cur[k2], prev[k2]   tri B: prev[k], cur[k], cur[k2]
          pos[oi] = prev[a0]; pos[oi + 1] = prev[a0 + 1]; pos[oi + 2] = prev[a0 + 2];
          pos[oi + 3] = cur[a1]; pos[oi + 4] = cur[a1 + 1]; pos[oi + 5] = cur[a1 + 2];
          pos[oi + 6] = prev[a1]; pos[oi + 7] = prev[a1 + 1]; pos[oi + 8] = prev[a1 + 2];
          pos[oi + 9] = prev[a0]; pos[oi + 10] = prev[a0 + 1]; pos[oi + 11] = prev[a0 + 2];
          pos[oi + 12] = cur[a0]; pos[oi + 13] = cur[a0 + 1]; pos[oi + 14] = cur[a0 + 2];
          pos[oi + 15] = cur[a1]; pos[oi + 16] = cur[a1 + 1]; pos[oi + 17] = cur[a1 + 2];

          const px = prevN[a0], py = prevN[a0 + 1], pz = prevN[a0 + 2];
          const qx = curN[a0], qy = curN[a0 + 1], qz = curN[a0 + 2];
          nor[oi] = px; nor[oi + 1] = py; nor[oi + 2] = pz;
          nor[oi + 3] = qx; nor[oi + 4] = qy; nor[oi + 5] = qz;
          nor[oi + 6] = px; nor[oi + 7] = py; nor[oi + 8] = pz;
          nor[oi + 9] = px; nor[oi + 10] = py; nor[oi + 11] = pz;
          nor[oi + 12] = qx; nor[oi + 13] = qy; nor[oi + 14] = qz;
          nor[oi + 15] = qx; nor[oi + 16] = qy; nor[oi + 17] = qz;
        }
      }

      _scarfPrevC[0] = lx; _scarfPrevC[1] = ly; _scarfPrevC[2] = lz;
      const tmp = prev; prev = cur; cur = tmp;
      const tmpN = prevN; prevN = curN; curN = tmpN;
      have = true;
    }

    const g = this._scarfGeo;
    if (this._scarfRange) {
      /* The scarf is a slice of the merged body buffer: upload ONLY that slice,
         through one reused range record apiece so the frame allocates nothing. */
      pushUpdateRange(g.attributes.position, this._scarfURa, this._scarfRange.pos, this._scarfRange.count);
      pushUpdateRange(g.attributes.normal, this._scarfURb, this._scarfRange.pos, this._scarfRange.count);
    } else {
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
    }
    void ax; void ay; void az;
  }

  /* ──────────────────────────── powers and fade ──────────────────────────── */

  _updateWings(dt, anim) {
    if (this.power !== 'wing') return;
    this._wingT += dt;
    const flap = anim === 'fly' || !this._grounded;
    const beat = Math.sin(this._wingT * (flap ? 11 : 2.2));
    for (let i = 0; i < this.wings.length; i++) {
      const s = i === 0 ? 1 : -1;
      const w = this.wings[i];
      w.rotation.z = s * (0.30 + beat * (flap ? 0.55 : 0.10));
      w.rotation.x = beat * 0.12;
      w.scale.setScalar(0.92 + beat * 0.06);
    }
    this.M.wing.opacity = this.M.wing.userData.baseOpacity * (0.7 + Math.abs(beat) * 0.3);
  }

  /**
   * `player.heroFade` is the FADE AMOUNT, not the opacity: 0 = solid, 1 = fully
   * hidden. That is the convention both producers use — FollowCamera writes
   * `fade = 1` for peek (which must hide the hero completely, since peek is a
   * first-person view from `headPos`) and `0` at full camera distance, and
   * Player initialises the field to 0 meaning "solid". Reading it as an opacity
   * made Nim 100 % invisible at spawn in both the Keep and verdant-1.
   * Opacity is therefore `1 - heroFade`; the vanish power multiplies it.
   * Materials are only touched when the value actually moves.
   */
  _updateFade(player) {
    let want = 1 - clamp01(numOr(player ? player.heroFade : 0, 0));
    if (this.power === 'vanish') want *= 0.40;
    this._fade = want;
    if (Math.abs(this._fade - this._fadeApplied) < 0.004) return;
    this._fadeApplied = this._fade;

    const solid = this._fade >= 0.995;
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      if (m === this.M.wing) continue;                  // additive, own opacity
      const base = numOr(m.userData.baseOpacity, 1);
      const o = base * this._fade;
      m.opacity = o;
      const wantTrans = !solid || base < 1;
      if (m.transparent !== wantTrans) { m.transparent = wantTrans; m.needsUpdate = true; }
      m.depthWrite = o > 0.62;
    }
    // fully faded: stop drawing entirely rather than paying for invisible meshes
    const show = this._fade > 0.02;
    this.rig.visible = show;
    if (this._body) this._body.visible = show;
    if (this.scarfMesh) this.scarfMesh.visible = show;
  }

  /* ───────────────────────────────── teardown ───────────────────────────────── */

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.shadowBlob.dispose();
    if (this._body && this._body.material) {
      const bm = this._body.material;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'clearcoatMap', 'sheenColorMap', 'sheenRoughnessMap']) {
        if (bm[k] && bm[k].dispose) bm[k].dispose();
      }
      if (this._body.skeleton && this._body.skeleton.dispose) this._body.skeleton.dispose();
    }
    if (this._atlas) { this._atlas.dispose(); this._atlas = null; }
    for (let i = 0; i < this._geos.length; i++) {
      const g = this._geos[i];
      if (g && g.dispose) g.dispose();
    }
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      if (m && m.dispose) m.dispose();
    }
    this._geos.length = 0;
    this._mats.length = 0;
    this._meshes.length = 0;
    if (Hero.last === this) Hero.last = null;
  }
}

/** The most recently constructed Hero — the harness hook binds to this. */
Hero.last = null;

/**
 * Harness surface (contract §13 / the gates). Read-only snapshots; safe to call
 * from `python _harness/*` through `CRESTBOUND.game.hero`.
 *
 *   Hero.__test.bones()  -> {name: {x,y,z, wx,wy,wz}}  local euler + world pos
 *   Hero.__test.pose()   -> {anim, animT, phase, speed, squash, flip…, ik, fade}
 */
Hero.__test = {
  bones(hero) {
    const h = hero || Hero.last;
    if (!h) return null;
    const out = {};
    for (let i = 0; i < h._bones.length; i++) {
      const b = h._bones[i];
      _v0.setFromMatrixPosition(b.o.matrixWorld);
      out[b.name] = {
        x: +b.o.rotation.x.toFixed(4),
        y: +b.o.rotation.y.toFixed(4),
        z: +b.o.rotation.z.toFixed(4),
        wx: +_v0.x.toFixed(4), wy: +_v0.y.toFixed(4), wz: +_v0.z.toFixed(4),
      };
    }
    return out;
  },
  pose(hero) {
    const h = hero || Hero.last;
    if (!h) return null;
    return {
      anim: h._anim,
      animT: +h._animT.toFixed(4),
      phase: +h._phase.toFixed(4),
      dist: +h._dist.toFixed(3),
      speed: +h._speed.toFixed(3),
      speedN: +h._speedN.toFixed(3),
      grounded: h._grounded,
      squash: +h._squash.toFixed(4),
      flipPitch: +h._flipPitch.toFixed(4),
      flipRoll: +h._flipRoll.toFixed(4),
      flipYaw: +h._flipYaw.toFixed(4),
      lean: +h._lean.toFixed(4),
      ik: +h._ikW.toFixed(3),
      blink: +h._blink.toFixed(3),
      fade: +h._fade.toFixed(3),
      power: h.power,
      theme: h.themeId,
      meshes: h._meshes.length,
      scarfTip: [
        +h._scarfP[SCARF_LINKS * 3].toFixed(3),
        +h._scarfP[SCARF_LINKS * 3 + 1].toFixed(3),
        +h._scarfP[SCARF_LINKS * 3 + 2].toFixed(3),
      ],
      shadow: {
        visible: h.shadowBlob.mesh.visible,
        opacity: +h.shadowBlob._op.toFixed(3),
        y: +h.shadowBlob.mesh.position.y.toFixed(3),
      },
    };
  },
};

export default Hero;
