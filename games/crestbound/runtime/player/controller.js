/**
 * CRESTBOUND — runtime/player/controller.js
 * =============================================================================
 * THE GAME LIVES HERE (CONTRACT §11).
 *
 * A third-person ANALOG platformer controller: a real, explicit state machine
 * driving a fixed-substep simulation. Every movement number comes from
 * `core/tuning.js` (TUNE) — this file never invents a jump height, an
 * acceleration or a window. Numbers that TUNE deliberately does not carry
 * (skid duration, wall-slide clamp, footstep stride…) are module constants at
 * the top of the file, each with the reason it is local.
 *
 * -----------------------------------------------------------------------------
 * 1. WHAT IS AUTHORITATIVE
 * -----------------------------------------------------------------------------
 *  • `pos` is the FEET of the collision capsule; the capsule spans
 *    [pos.y, pos.y + height]. Crouching shrinks from the top.
 *  • `facing` (radians, yaw 0 faces −Z) is the direction the HERO points. It is
 *    NOT the camera yaw and never follows it directly: the camera proposes
 *    (`cameraRef.yawForMovement`), the stick disposes.
 *  • `vel` is world-space metres/second and is the only integration state; the
 *    ground model writes it from (facing × speed target), the air model only
 *    ever ADDS along the wish axis (Quake projection accel), so a long jump's
 *    17 m/s is never braked by holding forward.
 *  • The sim advances in fixed 1/120 s substeps. Feel is identical at 30 fps
 *    and 240 fps. Renderers read `renderPos` (interpolated), never `pos`.
 *  • ZERO heap allocation inside `update()`. Every scratch vector is hoisted to
 *    module scope; the history ring is a SLOT-mode `Ring` that copies fields
 *    into pre-built slots.
 *
 * -----------------------------------------------------------------------------
 * 2. GRAVITY
 * -----------------------------------------------------------------------------
 * `applyGravity(vy, dt, rising)` from tuning.js is THE gravity function; this
 * file never writes `vy -= g*dt`. It is applied as velocity Verlet — half a
 * step before the sweep, half after — with the `rising` flag latched once per
 * substep so both halves use the same g. That makes the sampled arc sit exactly
 * on the continuous parabola, so `jumpV[0] = 11.4` really does apex at
 * `apexFor(11.4) = 1.911 m` and the published REACH_TABLE is not a lie.
 * Exceptions: `poundFall` drives vy directly (TUNE.gravPoundFall === 0),
 * swimming/climbing/cannon own their vertical entirely, `wallslide` uses a
 * damped fall with a clamp, `fly` uses a fraction of gravity.
 *
 * -----------------------------------------------------------------------------
 * 3. STATE MACHINE — transitions table
 * -----------------------------------------------------------------------------
 * Legend: `mag` = input.move.mag · `sp` = horizontal speed · `X↓` = button
 * pressed this frame · `X‸` = button held. All windows/speeds from TUNE.
 *
 *  FROM          →  TO             WHEN
 *  ─────────────────────────────────────────────────────────────────────────────
 *  idle          →  run            mag ≥ 0.15
 *                →  crouch         crouch‸
 *                →  jump1/2/3      jump↓ (buffer) — chain per tripleWindow
 *                →  backflip       crouch‸ + jump↓ and sp < 2
 *                →  fall           lost ground (coyote starts)
 *  run           →  idle           mag < 0.15 and sp ≤ SKID_SPEED
 *                →  skid           mag < 0.15 and sp > SKID_SPEED
 *                →  pivot          dot(wish, vel) < reverseSnapDot and sp > 4
 *                →  jump1/2/3      jump↓
 *                →  longjump       crouch‸ + jump↓ and sp ≥ longJump.minSpeed
 *                →  sideflip       jump↓ within REVERSE_WINDOW of a stick reversal
 *                →  dive           dive↓ and sp ≥ dive.minSpeed
 *                →  crouchwalk     crouch‸ and mag ≥ 0.15 (below longjump speed)
 *                →  slopeSlide     groundSlopeDeg > slideDeg (iceSlideDeg on ice)
 *  skid          →  idle           sp ≤ SKID_SPEED   |  → run (mag ≥ 0.15)
 *  pivot         →  run            after PIVOT_TIME (facing snaps to wish)
 *                →  sideflip       jump↓ during the pivot
 *  crouch(walk)  →  idle/run       crouch released
 *                →  longjump       jump↓ at sp ≥ longJump.minSpeed
 *                →  backflip       jump↓ at sp < 2
 *  jump1/jump2   →  fall           vy ≤ 0            (jump3 keeps its somersault)
 *  jump1-3/fall  →  wallslide      wall |n.y|<0.4 held into, vy < 0
 *                →  wallkick       jump↓ within wallKick.window of a wall contact
 *                →  dive           dive↓ and sp ≥ dive.minSpeed
 *                →  poundHang      pound↓ (crouch in air)
 *                →  land/hardLand  ground contact (hardLand only from a FALL)
 *  longjump      →  (air control ×0.35, no state change until landing)
 *  backflip/     →  fall           vy ≤ 0
 *   sideflip
 *  wallslide     →  fall           left the wall / stopped holding into it
 *  wallkick      →  fall           vy ≤ 0 (lockout blocks a re-kick for 0.28 s)
 *  dive          →  slide          ground contact
 *                →  slideRecover   wall contact while diving
 *  slide         →  jump1          jump↓ after dive.slideMinTime (hopV)
 *                →  slideRecover   sp < SLIDE_END_SPEED or wall contact
 *  slideRecover  →  idle           after SLIDE_RECOVER
 *  poundHang     →  poundFall      after pound.hang (vel zeroed, hero spins)
 *  poundFall     →  poundLand      ground contact (shock, breakables, bounce)
 *  poundLand     →  jump1          jump↓ within pound.jumpWindow (bounceV)
 *                →  idle           after POUND_STUN
 *  land          →  idle/run       after landLag
 *  hardLand      →  idle           after hardLandLag (input locked)
 *  slopeSlide    →  jump1          jump↓ (slope.recoverJumpV, keeps slide speed)
 *                →  run/idle       slope under the threshold
 *  any           →  swimIdle/swim  entered a 'water' Volume ('splash')
 *  swim*         →  jump1          jump↓ while surfaced (swim.surfaceJumpV)
 *                →  fall           left the water ('surface')
 *  any(air)      →  climb          overlapping a 'ladder' Volume ('climbStart')
 *  climb         →  climbKick      jump↓ (climb.kickV = [away, up])
 *  any           →  cannon         enterCannon() — jump↓ fires → fly
 *  fly           →  fall           ground contact / setFly(false)
 *  any           →  dead           kill(cause) ('death')
 *
 * -----------------------------------------------------------------------------
 * 4. ANALOG LAW (measured by _harness/feelcheck.py)
 * -----------------------------------------------------------------------------
 *  • speed target: mag < 0.15 → 0 · mag < 0.55 → speedWalk·(mag/0.55) ·
 *    else lerp(speedWalk, speedRun, (mag−0.55)/0.45). Keyboard ramps 0→1 over
 *    0.09 s in input.js, so a TAP walks.
 *  • turn rate: lerp(turnRateSlow, turnRateFast, sp/speedRun) — snappy slow,
 *    a wide arc at full run (radius ≈ speedRun/turnRateFast ≈ 2.1 m).
 *  • run-up 0 → 9 m/s = speedRun/accelGround = 0.214 s;
 *    stop 9 → 0 = speedRun/decelGround = 0.141 s (< 0.16 s).
 *  • reversal at speed is a PIVOT, never a slow arc.
 *  • single jump apex 1.911 m, reached 11.4/34 = 0.335 s after take-off (≤ 0.34).
 *
 * -----------------------------------------------------------------------------
 * 5. WHAT OTHER MODULES READ
 * -----------------------------------------------------------------------------
 *  hero.js      : renderPos, facing, anim, animT, speedNorm, leanX, airborneT,
 *                 groundedT, vel, grounded, state, heroFade
 *  camera.js    : renderPos, facing, vel, state, grounded, submerged, headPos
 *  critters.js  : pos, vel, capsule, dead, kill(), stun(), radius, height
 *  collectibles : pos, capsule, radius, height, power, dead
 *  hazards      : pos, grounded, onGround, groundCollider
 *  game.js      : history (Ring, death rewind), events, __test, spawn/respawn
 */

import * as THREE from 'three';
import { TUNE, applyGravity, launchVelocityForApex } from '../core/tuning.js';
import { moveAndCollide, capsuleFor } from './collide.js';
import {
  Emitter, Ring, clamp, lerp, moveTowardAngle, wrapAngle, shortestAngle,
  headingFromYaw, yawFromHeading,
} from '../core/util.js';

/* ===========================================================================
 * Module constants — everything TUNE deliberately does not own.
 * Each one is presentation/plumbing, not a feel knob a designer retunes.
 * ======================================================================== */

/** Fixed simulation substep. CONTRACT §11 ("Fixed 1/120 s substep"). */
const FIXED = 1 / 120;
/** Spiral-of-death guard: at most 10 substeps (83 ms) per frame. */
const MAX_SUBSTEPS = 10;
/** A frame longer than this is a tab-switch, not a hitch — clamp it. */
const MAX_FRAME_DT = 0.25;

/** Stick magnitude under this is "no input" (matches the analog dead band). */
const MOVE_DEAD = 0.15;
/** Stick magnitude at which the walk band ends and the run ramp begins. */
const MOVE_WALK_TOP = 0.55;

/** Ground speed above which "release the stick" reads as a skid, not a stop. */
const SKID_SPEED = 4.0;
/** Duration of the reversal skid. CONTRACT §11: "pivot (0.12 s skid)". */
const PIVOT_TIME = 0.12;
/** Speed under which a reversal is just a turn (CONTRACT §11: "at speed > 4"). */
const PIVOT_MIN_SPEED = 4.0;
/** How long after a stick reversal a jump still becomes a sideflip (§11). */
const REVERSE_WINDOW = 0.12;
/** Speed under which crouch+jump is a backflip rather than a normal jump (§11). */
const BACKFLIP_MAX_SPEED = 2.0;

/** Crouched ground speed as a fraction of the analog target (a creep, not a stop). */
const CROUCH_SPEED_MUL = 0.5;

/** Air-control multiplier while committed to a long jump or a dive (§11 ×0.35). */
const COMMIT_AIR_CONTROL = 0.35;

/** Wall contact memory. The kick window itself is TUNE.wallKick.window. */
const WALL_MEM = 0.16;
/** |normal.y| below this is a near-vertical wall (CONTRACT §11). */
const WALL_MAX_NY = 0.40;
/** How hard the stick must push into a wall to stick to it. */
const WALL_INTO_DOT = 0.20;
/** Terminal fall speed while wall-sliding (presentation; TUNE has no wall slide). */
const WALL_SLIDE_MAX = 6.0;
/** Gravity fraction while wall-sliding. */
const WALL_SLIDE_GRAV = 0.45;
/** Scrape dust cadence while wall-sliding. */
const WALL_SCRAPE_EVERY = 0.07;

/** Ignore `grounded` for this long after a launch so nothing re-snaps us down. */
const NO_GROUND_AFTER_JUMP = 0.055;
/** Moving-platform launch window and how much of the deck velocity it keeps. */
const LAUNCH_TIME = 0.25;
const LAUNCH_KEEP = 0.70;

/** Speed pad / bounce pad re-trigger guards. */
const SPEEDPAD_CD = 0.35;
const BOUNCE_CD = 0.06;

/** Ground-pound landing stun (CONTRACT §11: "0.12 s stun"). */
const POUND_STUN = 0.12;
/** Getting back up from a belly slide. */
const SLIDE_RECOVER = 0.25;
/** Belly slide ends below this speed. */
const SLIDE_END_SPEED = 1.2;
/** A dive that hits a wall recovers instead of continuing. */
const SLIDE_WALL_DOT = 0.35;

/** Footstep stride in metres (walk → run). */
const STEP_WALK = 2.1;
const STEP_RUN = 1.6;
/** Crouched strides are shorter but quieter, so they fire less often. */
const STEP_CROUCH_MUL = 1.35;

/** Death-rewind history: 24 samples at 60 Hz = 0.4 s (CONTRACT §11). */
const HIST_N = 24;
const HIST_DT = 1 / 60;

/** Swim: gentle upward drift when submerged and idle (buoyancy, not a stroke). */
const SWIM_BUOYANCY = 0.6;
/** Minimum time between strokes so mashing does not rocket you. */
const STROKE_CD = 0.42;
/** How long the plunge state holds after entering water fast. */
const SWIM_DIVE_TIME = 0.45;
/** Head clearance fraction used to decide "submerged". */
const HEAD_FRAC = 0.86;

/** Quicksand: sink rate and movement penalty (CONTRACT §11 "sink 0.6 m/s"). */
const QUICKSAND_SINK = 0.6;
const QUICKSAND_MOVE = 0.45;
/** Each mashed jump inside quicksand adds this much escape velocity. */
const QUICKSAND_MASH = 1.2;
const QUICKSAND_MASH_MAX = 7.0;

/** Gravity fraction while gliding with the wing power. */
const FLY_GRAV = 0.34;
/** Cannon aim rate (rad/s) while seated in a cannon. */
const CANNON_AIM = 1.6;

/** Lean smoothing for the hero's turn lean. */
const LEAN_LAMBDA = 9;
/** Standing-clearance probe insets (conservative: errs toward "stay crouched"). */
const CLEAR_INSET_R = 0.92;
const CLEAR_INSET_Y = 0.03;

/** Land impact under this is silent (no thump, no dust). */
const LAND_QUIET = 1.2;

/** Every state the machine can be in. Exported for harnesses. */
export const STATES = Object.freeze([
  'idle', 'run', 'skid', 'pivot', 'crouch', 'crouchwalk',
  'jump1', 'jump2', 'jump3', 'longjump', 'backflip', 'sideflip', 'fall',
  'dive', 'slide', 'slideRecover', 'wallslide', 'wallkick',
  'poundHang', 'poundFall', 'poundLand', 'land', 'hardLand', 'slopeSlide',
  'swimIdle', 'swim', 'swimDive', 'climb', 'climbKick', 'cannon', 'fly', 'dead',
]);

/** States that commit the arc: air control is reduced and never re-aimed. */
const COMMITTED = { longjump: 1, dive: 1 };
/** States that ignore ordinary ground/air locomotion entirely. */
const NO_LOCOMOTION = {
  poundHang: 1, poundFall: 1, poundLand: 1, hardLand: 1,
  climb: 1, cannon: 1, dead: 1, slideRecover: 1,
};

/* ===========================================================================
 * Module scratch — NOTHING in the sim path allocates.
 * ======================================================================== */

const _fwd = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _wallN = new THREE.Vector3();
const _carry = new THREE.Vector3();
const _carryPrev = new THREE.Vector3();
const _push = new THREE.Vector3();
const _pushPrev = new THREE.Vector3();
const _launchV = new THREE.Vector3();
const _box = new THREE.Box3();
const _query = [];
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

/** Reusable options objects for audio/particles — never allocate to call them. */
const _sfxOpt = { gain: 1, rate: 1, impact: 0, power: 0 };
const _fxOpt = { strength: 0, surface: 'normal', count: 0, speed: 0, radius: 0 };

/**
 * Fallback collision result, used only when no broadphase world is attached
 * (harness / bootstrap frames). Reused — never reallocated.
 */
const _fbRes = {
  grounded: false,
  groundNormal: new THREE.Vector3(0, 1, 0),
  groundCollider: null,
  groundHeightfield: null,
  groundSlopeDeg: 0,
  ceiling: false,
  walls: [],
  platformVel: new THREE.Vector3(),
  surface: 'normal',
  surfaceProps: null,
  stepped: false,
  crushed: false,
  hitVel: new THREE.Vector3(),
  kill: null,
  killKind: null,
  inWater: null,
  waterSurfaceY: NaN,
  inQuicksand: false,
  quicksand: null,
  wind: null,
  current: null,
  ladder: null,
  stepUpBlocked: false,
  volumes: [],
  breakable: null,
  poundFalling: false,
};

/* ===========================================================================
 * Helpers
 * ======================================================================== */

/** Horizontal magnitude without allocating a vector. */
function hyp2(x, z) { return Math.sqrt(x * x + z * z); }

/**
 * Quake-style directional acceleration: project the current velocity onto the
 * wish direction and add ONLY the deficit. This is why air control can redirect
 * a jump without ever braking it — a 17 m/s long jump already exceeds the
 * 9 m/s wish speed along its own axis, so nothing is added and the arc holds.
 */
function accelerateXZ(vel, wx, wz, wishSpeed, accel, dt) {
  if (wishSpeed <= 0 || accel <= 0) return;
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * dt;
  if (a > add) a = add;
  vel.x += a * wx;
  vel.z += a * wz;
}

/** Accepts Vector3 | [x,y,z] | {x,y,z} and writes into `out`. */
function readVec(v, out, dx, dy, dz) {
  if (!v) { out.set(dx || 0, dy || 0, dz || 0); return out; }
  if (Array.isArray(v)) { out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0); return out; }
  if (typeof v.x === 'number') { out.set(v.x, +v.y || 0, +v.z || 0); return out; }
  out.set(dx || 0, dy || 0, dz || 0);
  return out;
}

/** Factory for the history ring's pre-built slots (SLOT mode — zero alloc). */
function histSlot() { return { x: 0, y: 0, z: 0, facing: 0 }; }

/** Footstep sample for a surface key (every name exists in core/audio.js §5). */
function stepSample(surface) {
  switch (surface) {
    case 'grass': case 'leaves': case 'moss': return 'step_grass';
    case 'snow': case 'ice_snow': return 'step_snow';
    case 'sand': case 'dirt': return 'step_sand';
    case 'wood': case 'bridge': case 'plank': return 'step_wood';
    case 'ice': return 'step_ice';
    case 'metal': case 'grate': case 'conveyor': case 'panel':
    case 'speed': case 'bounce': case 'rubber': return 'step_metal';
    default: return 'step_stone';
  }
}

/* ===========================================================================
 * Player
 * ======================================================================== */

export class Player {
  /**
   * @param {object|null} world      anything exposing {broadphase, killVolumes, volumes}
   * @param {object|null} input      core/input.js Input
   * @param {object|null} audio      core/audio.js Audio
   * @param {object|null} fx         fx/impacts.js Impacts (or a ParticleSystem)
   * @param {object|null} cameraRef  {yaw|yawForMovement} — camera-relative movement.
   *                                 MAY BE NULL (harness): input falls back to world space.
   */
  constructor(world, input, audio, fx, cameraRef) {
    this.world = world || null;
    this.input = input || null;
    this.audio = audio || null;
    this.fx = fx || null;
    this.cameraRef = cameraRef || null;

    this.events = new Emitter();

    /* ── transform ─────────────────────────────────────────────────────── */
    /** @type {THREE.Vector3} FEET position (authoritative sim state). */
    this.pos = new THREE.Vector3();
    /** @type {THREE.Vector3} world velocity, m/s. */
    this.vel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    /** @type {THREE.Vector3} interpolated render position — hero/camera read THIS. */
    this.renderPos = new THREE.Vector3();
    /** Hero yaw in radians (0 faces −Z). */
    this.facing = 0;

    /* ── capsule ───────────────────────────────────────────────────────── */
    this.radius = TUNE.radius;
    this.height = TUNE.height;

    /* ── published state (contract §11) ────────────────────────────────── */
    this.state = 'fall';
    this.stateT = 0;
    this.anim = 'fall';
    this.animT = 0;
    this.speed = 0;
    this.speedNorm = 0;
    this.leanX = 0;
    this.airborneT = 0;
    this.groundedT = 0;
    this.jumpCount = 0;
    this.grounded = false;
    this.dead = false;
    this.deathCause = null;
    this.crouching = false;
    this.sliding = false;
    this.inWater = null;
    this.submerged = false;
    this.surface = 'normal';
    this.surfaceProps = null;
    /** @type {THREE.Vector3} current wall normal (zero when not on a wall). */
    this.wallN = new THREE.Vector3();
    /** @type {THREE.Vector3} velocity currently carrying us (mover deck + belt). */
    this.carried = new THREE.Vector3();
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundCollider = null;
    this.groundHeightfield = null;
    this.groundSlopeDeg = 0;
    /** Active power hat id ('wing'|'metal'|'vanish'|null) — read by collectibles. */
    this.power = null;
    /** Stun timer (bumbler knockback). Written by `stun()`. */
    this.stunT = 0;
    /** 0..1 hero fade, written by FollowCamera when the lens is close. */
    this.heroFade = 0;
    /** Last landing impact speed (m/s), for the HUD/critic. */
    this.lastLandImpact = 0;
    this.lastJumpKind = null;

    /** Death rewind: 0.4 s of {x,y,z,facing} at 60 Hz, SLOT mode (no alloc). */
    this.history = new Ring(HIST_N, histSlot);

    /* ── timers / latches ──────────────────────────────────────────────── */
    this._acc = 0;              // substep accumulator
    this._histT = 0;            // history sampling accumulator
    this.coyoteT = 0;
    this.bufferT = 0;
    this._chainT = 0;           // triple-jump chain window
    this._wallT = 0;            // wall contact memory
    this._wallLockT = 0;        // wall-kick lockout
    this._noGroundT = 0;
    this._launchT = 0;
    this._speedCD = 0;
    this._bounceCD = 0;
    this._scrapeT = 0;          // slide/scrape dust cadence
    this._ambT = 0;             // ambient volume fx cadence (bubbles, sand, wind)
    this._reverseT = 0;         // sideflip window after a stick reversal
    this._jumpT = 0;            // time since the last jump-family take-off
    this._strokeT = 0;
    this._pivotRate = 0;
    this._qsMash = 0;
    this._standGuardT = 0;
    this._stepDist = 0;

    this._cutArmed = false;     // a cuttable jump is rising
    this._cutPending = false;   // released before jumpHoldMin — cut when it expires
    this._fellFromJump = false; // hard landings only come from FALLS
    this._skipGravHalf = false;
    this._jumpedThisStep = false;
    this._rising = false;
    this._wallRef = null;
    this._lastCp = -1;
    this._triggerSeen = null;   // last trigger volume id fired
    this._ringSeen = null;
    this._climbVol = null;
    this._climbAngle = 0;
    this._cannon = null;
    this._flyT = 0;

    /* ── per-frame input latches (edges survive into the substeps) ─────── */
    this._inMoveX = 0;
    this._inMoveY = 0;
    this._inMag = 0;
    this._jumpHeld = false;
    this._jumpPressLatch = false;
    this._jumpReleaseLatch = false;
    this._crouchHeld = false;
    this._divePressLatch = false;
    this._poundPressLatch = false;
    this._camYaw = 0;

    /* ── resolved wish (world space, unit) ─────────────────────────────── */
    this._wx = 0;
    this._wz = 0;
    this._wmag = 0;

    /* ── external forces ───────────────────────────────────────────────── */
    this._wind = new THREE.Vector3();
    this._impulse = new THREE.Vector3();

    /* ── reused sub-objects (never reallocated) ────────────────────────── */
    this._headPos = new THREE.Vector3();
    this._capOut = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: TUNE.radius };
    this._cs = {
      pos: this.pos,
      vel: this.vel,
      radius: this.radius,
      height: this.height,
      crouching: false,
      grounded: false,
      jumped: false,
      poundFalling: false,
      wantSnap: true,
      stepUp: TUNE.stepUp,
    };
    this._snap = {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      state: 'fall', anim: 'fall', grounded: false, jumpCount: 0,
      speed: 0, facing: 0, inWater: false, sliding: false,
    };

    /** Set false if the Game routes all audio off `events` instead. */
    this.autoAudio = true;
    /** Optional hard override of the void plane. */
    this.killYOverride = null;
    this.killY = -1e5;

    this.stats = { jumps: 0, wallKicks: 0, dives: 0, pounds: 0, deaths: 0, distance: 0, steps: 0 };

    /* ── dev/harness hook ─────────────────────────────────────────────── */
    const self = this;
    this.__test = {
      teleport(v) {
        readVec(v, self.pos, self.pos.x, self.pos.y, self.pos.z);
        self.prevPos.copy(self.pos);
        self.renderPos.copy(self.pos);
        self._acc = 0;
      },
      setVel(v) { readVec(v, self.vel, 0, 0, 0); self.speed = hyp2(self.vel.x, self.vel.z); },
      setFacing(yaw) { if (isFinite(yaw)) self.facing = wrapAngle(yaw); },
      /** Force a state. Real moves fire their real launch; the rest just set it. */
      force(stateName) { self._force(stateName); },
      state() { return self._snapshot(); },
      step(dt) { self._step(dt); },
      fixedStep: FIXED,
    };
  }

  /* =========================================================================
   * Lifecycle
   * ====================================================================== */

  /** Swap the collision world when a course loads. */
  setWorld(world) {
    this.world = world || null;
    this.groundCollider = null;
    this.groundHeightfield = null;
    this._wallRef = null;
    this._climbVol = null;
    this.inWater = null;
    this._lastCp = -1;
    this._triggerSeen = null;
    this._ringSeen = null;
  }

  /** Initial placement — also clears the run statistics. */
  spawn(pos, yaw) {
    this._place(pos, yaw);
    this.stats.jumps = 0; this.stats.wallKicks = 0; this.stats.dives = 0;
    this.stats.pounds = 0; this.stats.deaths = 0; this.stats.distance = 0; this.stats.steps = 0;
  }

  /**
   * Post-death placement. CONTRACT §11: "resets everything incl. jumpCount and
   * history" — the death rewind must never replay the PREVIOUS life's ring.
   */
  respawn(pos, yaw) { this._place(pos, yaw); }

  _place(pos, yaw) {
    if (pos !== undefined && pos !== null) readVec(pos, this.pos, this.pos.x, this.pos.y, this.pos.z);
    if (typeof yaw === 'number' && isFinite(yaw)) this.facing = wrapAngle(yaw);

    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this._wind.set(0, 0, 0);
    this._impulse.set(0, 0, 0);
    _carryPrev.set(0, 0, 0);
    _pushPrev.set(0, 0, 0);
    _launchV.set(0, 0, 0);
    this.carried.set(0, 0, 0);

    this.dead = false;
    this.deathCause = null;
    this.state = 'fall';
    this.stateT = 0;
    this.anim = 'fall';
    this.animT = 0;

    this.grounded = false;
    this.groundNormal.set(0, 1, 0);
    this.groundCollider = null;
    this.groundHeightfield = null;
    this.groundSlopeDeg = 0;
    this.surface = 'normal';
    this.surfaceProps = null;

    this.crouching = false;
    this.sliding = false;
    this.height = TUNE.height;
    this.radius = TUNE.radius;

    this.inWater = null;
    this.submerged = false;
    this.wallN.set(0, 0, 0);

    this.speed = 0;
    this.speedNorm = 0;
    this.leanX = 0;
    this.airborneT = 0;
    this.groundedT = 0;
    this.jumpCount = 0;
    this.stunT = 0;
    this.heroFade = 0;
    this.lastLandImpact = 0;
    this.lastJumpKind = null;

    this._acc = 0;
    this._histT = 0;
    this.coyoteT = 0;
    this.bufferT = 0;
    this._chainT = 0;
    this._wallT = 0;
    this._wallLockT = 0;
    this._noGroundT = 0;
    this._launchT = 0;
    this._speedCD = 0;
    this._bounceCD = 0;
    this._scrapeT = 0;
    this._ambT = 0;
    this._reverseT = 0;
    this._jumpT = 0;
    this._strokeT = 0;
    this._pivotRate = 0;
    this._qsMash = 0;
    this._standGuardT = 0;
    this._stepDist = 0;
    this._cutArmed = false;
    this._cutPending = false;
    this._fellFromJump = false;
    this._skipGravHalf = false;
    this._jumpedThisStep = false;
    this._wallRef = null;
    this._climbVol = null;
    this._cannon = null;
    this._flyT = 0;
    this._lastCp = -1;
    this._triggerSeen = null;
    this._ringSeen = null;
    this._jumpPressLatch = false;
    this._jumpReleaseLatch = false;
    this._divePressLatch = false;
    this._poundPressLatch = false;
    this._jumpHeld = false;
    this._crouchHeld = false;

    this.history.clear();
    this._pushHistory();
    this._syncCollide();
  }

  /**
   * Kill the player. Idempotent — lava and a crusher on the same substep
   * produce exactly one 'death'.
   */
  kill(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause || 'void';
    this.vel.set(0, 0, 0);
    this._wind.set(0, 0, 0);
    this._impulse.set(0, 0, 0);
    _carryPrev.set(0, 0, 0);
    _pushPrev.set(0, 0, 0);
    _launchV.set(0, 0, 0);
    this.carried.set(0, 0, 0);
    this.grounded = false;
    this.bufferT = 0;
    this.coyoteT = 0;
    this._acc = 0;
    this.stats.deaths++;
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this._setState('dead');
    this._ev('death', this.deathCause, this.pos);
    /* Presentation belongs to whoever listens; the local fallback only runs in
       a standalone harness with nothing bound. */
    if (!this._hasListener('death')) {
      this._sfx('death');
      this._fxBurst('death', this.pos);
    }
  }

  /** Bumbler knockback stun (critters.js calls `stun(seconds)`). */
  stun(seconds) {
    const t = +seconds;
    if (!isFinite(t) || t <= 0) return;
    if (t > this.stunT) this.stunT = t;
    this.bufferT = 0;
  }

  /** Set the active power hat id (collectibles read `player.power`). */
  setPower(id) { this.power = id || null; }

  dispose() {
    if (this.events && typeof this.events.clear === 'function') {
      try { this.events.clear(); } catch (err) { /* optional API */ }
    }
    this.world = null;
    this.cameraRef = null;
    this.groundCollider = null;
    this.groundHeightfield = null;
    this._wallRef = null;
    this._climbVol = null;
    this._cannon = null;
  }

  /* =========================================================================
   * Read-only views
   * ====================================================================== */

  /** Interpolated feet position. SHARED vector — copy it, do not retain it. */
  get feetPos() { return this.renderPos; }

  /** Interpolated head position (top of the capsule). SHARED — copy it. */
  get headPos() {
    this._headPos.set(this.renderPos.x, this.renderPos.y + this.height, this.renderPos.z);
    return this._headPos;
  }

  /** The collision capsule {a, b, r}. SHARED — copy it. */
  get capsule() { return capsuleFor(this._syncCollide(), this._capOut); }

  /** Alias hazards use. */
  get onGround() { return this.grounded; }

  /** Unit XZ heading the hero faces. SHARED vector — copy it. */
  get forward() { return headingFromYaw(this.facing, _fwd); }

  /* =========================================================================
   * External forces
   * ====================================================================== */

  /** Continuous acceleration for this frame (m/s²). Consumed by the substeps. */
  addWind(x, y, z) {
    if (this.dead) return;
    if (x !== null && typeof x === 'object') { readVec(x, _dir, 0, 0, 0); this._wind.add(_dir); return; }
    this._wind.x += x || 0; this._wind.y += y || 0; this._wind.z += z || 0;
  }

  /** Instantaneous velocity change (m/s), applied on the next substep. */
  addImpulse(x, y, z) {
    if (this.dead) return;
    if (x !== null && typeof x === 'object') { readVec(x, _dir, 0, 0, 0); this._impulse.add(_dir); return; }
    this._impulse.x += x || 0; this._impulse.y += y || 0; this._impulse.z += z || 0;
  }

  /**
   * Board a cannon (hazards/launch.js). The hero is parked at `mouth`, aims
   * with the stick, and JUMP fires along the aim at `power` m/s.
   * @param {{p:number[]|THREE.Vector3, yaw:number, pitch:number, power:number, ref?:object}} def
   */
  enterCannon(def) {
    if (this.dead || !def) return;
    this._cannon = def;
    readVec(def.p || def.mouth, this.pos, this.pos.x, this.pos.y, this.pos.z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.facing = isFinite(def.yaw) ? def.yaw : this.facing;
    this._cannonPitch = isFinite(def.pitch) ? def.pitch : 0.6;
    this.grounded = false;
    this.bufferT = 0;
    this._setState('cannon');
    this._ev('cannonEnter', def);
    this._sfx('ui_move');
  }

  /** Glide mode (wing power / rainbow ride). */
  setFly(on, seconds) {
    if (on) {
      this._flyT = isFinite(seconds) && seconds > 0 ? seconds : 1e9;
      if (!this.grounded) this._setState('fly');
    } else {
      this._flyT = 0;
      if (this.state === 'fly') this._setState('fall');
    }
  }

  /* =========================================================================
   * update — fixed-step driver
   * ====================================================================== */

  /**
   * Advance the simulation. ALWAYS in 1/120 s slices; `renderPos` is what the
   * renderer sees, so the hero never stutters when the frame time and the
   * substep do not divide evenly.
   * @param {number} dt seconds since the last frame
   */
  update(dt) {
    if (!isFinite(dt) || dt <= 0) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;

    this._latchInput();
    this._resolveKillY();

    if (this.dead) {
      this.stateT += dt;
      this.animT = this.stateT;
      this.prevPos.copy(this.pos);
      this.renderPos.copy(this.pos);
      this._wind.set(0, 0, 0);
      this._impulse.set(0, 0, 0);
      return;
    }

    /* ---- fixed substeps ------------------------------------------------ */
    this._acc += dt;
    let n = 0;
    while (this._acc >= FIXED) {
      this.prevPos.copy(this.pos);
      this._step(FIXED);
      this._acc -= FIXED;
      n++;
      if (this.dead) { this._acc = 0; break; }
      if (n >= MAX_SUBSTEPS) { this._acc = 0; break; }
    }

    /* ---- render interpolation ------------------------------------------ */
    let alpha = this._acc / FIXED;
    if (alpha < 0) alpha = 0; else if (alpha > 1) alpha = 1;
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);

    /* ---- published presentation channels ------------------------------- */
    this._publish(dt);

    /* ---- history ring (death rewind), sampled at a steady 60 Hz --------- */
    this._histT += dt;
    while (this._histT >= HIST_DT) {
      this._histT -= HIST_DT;
      this._pushHistory();
    }

    this._wind.set(0, 0, 0);
    this._impulse.set(0, 0, 0);
    this._jumpPressLatch = false;
    this._jumpReleaseLatch = false;
    this._divePressLatch = false;
    this._poundPressLatch = false;
  }

  /**
   * Copy the per-frame input edges into fields the substeps consume, so a
   * button press is never lost between substeps and never fires twice.
   */
  _latchInput() {
    const inp = this.input;
    const live = !!inp && !inp.suspended && !this.dead;

    if (live) {
      const mv = inp.move;
      let mx = mv ? (+mv.x || 0) : 0;
      let my = mv ? (+mv.y || 0) : 0;
      let mag = mv && isFinite(mv.mag) ? +mv.mag : hyp2(mx, my);
      if (mag > 1) { const k = 1 / mag; mx *= k; my *= k; mag = 1; }
      if (mag < 1e-4) { mx = 0; my = 0; mag = 0; }
      this._inMoveX = mx; this._inMoveY = my; this._inMag = mag;

      if (inp.jumpPressed) { this._jumpPressLatch = true; this.bufferT = TUNE.buffer; }
      if (inp.jumpReleased) this._jumpReleaseLatch = true;
      this._jumpHeld = !!inp.jump;
      this._crouchHeld = !!inp.crouch;
      if (inp.divePressed) this._divePressLatch = true;
      /* pound and crouch share ControlLeft/KeyC in DEFAULT_BINDINGS; input.js
         already ORs them into `pound`. A dive press in the same frame WINS
         (contract §11: "Diving with the pound button held is NOT a pound"). */
      if (inp.poundPressed || inp.crouchPressed) this._poundPressLatch = true;
    } else {
      this._inMoveX = 0; this._inMoveY = 0; this._inMag = 0;
      this._jumpHeld = false;
      this._crouchHeld = false;
      if (this.dead) { this._jumpReleaseLatch = false; this._jumpPressLatch = false; }
    }

    /* Camera yaw for camera-relative movement. cameraRef may be NULL (harness):
       fall back to world space, where the stick is simply +X right / −Z forward. */
    const cr = this.cameraRef;
    let cy = 0;
    if (cr) {
      const a = cr.yawForMovement;
      if (typeof a === 'number' && isFinite(a)) cy = a;
      else if (typeof cr.yaw === 'number' && isFinite(cr.yaw)) cy = cr.yaw;
    }
    this._camYaw = cy;
  }

  /* =========================================================================
   * _step — ONE 1/120 s slice
   * ====================================================================== */
  _step(dt) {
    const vel = this.vel;
    const pos = this.pos;
    const wasGrounded = this.grounded;
    const wasX = pos.x, wasY = pos.y, wasZ = pos.z;
    const preVy = vel.y;
    this._jumpedThisStep = false;

    /* ---- 1. timers ----------------------------------------------------- */
    this.stateT += dt;
    if (this.coyoteT > 0) this.coyoteT -= dt;
    if (this.bufferT > 0) this.bufferT -= dt;
    if (this._chainT > 0) { this._chainT -= dt; if (this._chainT <= 0) this.jumpCount = 0; }
    if (this._wallT > 0) this._wallT -= dt;
    if (this._wallLockT > 0) this._wallLockT -= dt;
    if (this._noGroundT > 0) this._noGroundT -= dt;
    if (this._launchT > 0) this._launchT -= dt;
    if (this._speedCD > 0) this._speedCD -= dt;
    if (this._bounceCD > 0) this._bounceCD -= dt;
    if (this._scrapeT > 0) this._scrapeT -= dt;
    if (this._ambT > 0) this._ambT -= dt;
    if (this._reverseT > 0) this._reverseT -= dt;
    if (this._strokeT > 0) this._strokeT -= dt;
    if (this._standGuardT > 0) this._standGuardT -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this._flyT > 0 && this._flyT < 1e8) {
      this._flyT -= dt;
      if (this._flyT <= 0 && this.state === 'fly') this._setState('fall');
    }
    if (this._jumpT < 10) this._jumpT += dt;

    /* ---- 2. wish direction (camera-relative) --------------------------- */
    this._resolveWish();

    /* ---- 3. stance ----------------------------------------------------- */
    this._resolveStance();

    /* ---- 4. state entry decisions driven by buttons -------------------- */
    this._preMove(dt);

    /* ---- 5. jump-height cut (hold/release) ----------------------------- */
    this._resolveJumpCut();

    /* ---- 6. impulses --------------------------------------------------- */
    if (this._impulse.x !== 0 || this._impulse.y !== 0 || this._impulse.z !== 0) {
      vel.add(this._impulse);
      this._impulse.set(0, 0, 0);
      if (vel.y > 0.05) { this.grounded = false; this._noGroundT = NO_GROUND_AFTER_JUMP; }
    }

    /* ---- 7. locomotion ------------------------------------------------- */
    this._locomotion(dt);

    /* ---- 8. wind volumes / scripted force ------------------------------ */
    if (this._wind.x !== 0 || this._wind.y !== 0 || this._wind.z !== 0) {
      vel.x += this._wind.x * dt;
      vel.y += this._wind.y * dt;
      vel.z += this._wind.z * dt;
    }

    /* ---- 9. gravity, first half (velocity Verlet) ---------------------- */
    this._rising = vel.y > 0;
    this._grav(dt * 0.5);

    /* ---- 10. conveyor push + mover launch, in POSITION ------------------
       A belt must never silently pump velocity, and the mover RIDE belongs to
       collide.js (carryAndPush) — integrating platformVel here too carried the
       player at twice the deck speed in Ascendant. Only the belt and the
       post-departure launch are ours. */
    if (this.grounded) {
      pos.x += _pushPrev.x * dt;
      pos.z += _pushPrev.z * dt;
    } else if (this._launchT > 0) {
      const k = this._launchT / LAUNCH_TIME;
      pos.x += _launchV.x * k * dt;
      pos.z += _launchV.z * k * dt;
    }

    /* ---- 11. rotating platforms turn the hero with them ---------------- */
    if (this.grounded && this.groundCollider) {
      const w = this._platformYawRate(this.groundCollider);
      if (w !== 0) this.facing = wrapAngle(this.facing + w * dt);
    }

    /* ---- 12. sweep + resolve ------------------------------------------- */
    const res = this._collide(dt);

    /* ---- 13. read the contacts ----------------------------------------- */
    this._readContacts(res, wasGrounded, preVy, dt);

    /* ---- 14. gravity, second half -------------------------------------- */
    if (this._skipGravHalf) this._skipGravHalf = false;
    else this._grav(dt * 0.5);

    /* ---- 15. volumes (water / quicksand / wind / current / ladder …) ---- */
    this._readVolumes(res, dt);

    /* ---- 16. hazards --------------------------------------------------- */
    this._killTests(res);
    if (this.dead) return;

    /* ---- 17. bookkeeping ----------------------------------------------- */
    const dx = pos.x - wasX, dz = pos.z - wasZ;
    const moved = hyp2(dx, dz);
    this.stats.distance += moved;
    this.speed = hyp2(vel.x, vel.z);

    if (this.grounded) {
      this.airborneT = 0;
      this.groundedT += dt;
      this._footsteps(moved);
    } else {
      this.groundedT = 0;
      this.airborneT += dt;
    }

    /* ---- 18. late state resolution (what the hero plays) --------------- */
    this._postState();

    /* NaN guard: one bad collider must not poison the run. */
    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
      pos.set(wasX, wasY, wasZ);
      vel.set(0, 0, 0);
    }
  }

  /* =========================================================================
   * Input → wish direction and speed target
   * ====================================================================== */

  /**
   * Rotate the analog stick (x right, y forward) into world space by the
   * camera yaw. yaw 0 faces −Z, so forward = (−sin, −cos) and right =
   * (cos, −sin); the wish is `x·right + y·forward`, re-normalised.
   */
  _resolveWish() {
    const mag = this._inMag;
    if (mag < MOVE_DEAD || this.stunT > 0) { this._wx = 0; this._wz = 0; this._wmag = 0; return; }
    const mx = this._inMoveX, my = this._inMoveY;
    const c = Math.cos(this._camYaw), s = Math.sin(this._camYaw);
    let wx = mx * c - my * s;
    let wz = -mx * s - my * c;
    const l = hyp2(wx, wz);
    if (l > 1e-6) { wx /= l; wz /= l; } else { wx = 0; wz = 0; }
    this._wx = wx; this._wz = wz; this._wmag = mag;
  }

  /**
   * The analog speed curve (CONTRACT §11): a dead band, a walk band that scales
   * linearly to `speedWalk`, then a run ramp to `speedRun`.
   */
  _speedTarget(mag) {
    if (mag < MOVE_DEAD) return 0;
    if (mag < MOVE_WALK_TOP) return TUNE.speedWalk * (mag / MOVE_WALK_TOP);
    return lerp(TUNE.speedWalk, TUNE.speedRun, (mag - MOVE_WALK_TOP) / (1 - MOVE_WALK_TOP));
  }

  /**
   * Turn the hero toward the wish direction. The rate is interpolated by speed:
   * `turnRateSlow` when nearly stopped (snappy), `turnRateFast` at full run
   * (a wide, committed arc). Airborne uses `airTurnRate`, and a committed arc
   * (long jump / dive) uses a third of it so the move never fights the camera.
   */
  _turnToward(dt, wx, wz, airborne) {
    if (wx === 0 && wz === 0) return;
    const target = yawFromHeading(wx, wz);
    let rate;
    if (airborne) {
      rate = TUNE.airTurnRate;
      if (COMMITTED[this.state] === 1) rate *= COMMIT_AIR_CONTROL;
    } else {
      const k = clamp(this.speed / TUNE.speedRun, 0, 1);
      rate = lerp(TUNE.turnRateSlow, TUNE.turnRateFast, k);
    }
    this.facing = moveTowardAngle(this.facing, target, rate * dt);
  }

  /* =========================================================================
   * Stance — crouch shrinks the capsule from the TOP (feet planted)
   * ====================================================================== */
  _resolveStance() {
    const st = this.state;
    /* Derived from the INPUT and from the states that are physically low, never
       from `crouch`/`crouchwalk` themselves: those two are a CONSEQUENCE of
       `crouching` (see _postState), so reading them back here would latch the
       hero into a permanent crouch the moment the button came up. */
    const wantLow = st === 'dive' || st === 'slide' || st === 'slideRecover' ||
      st === 'poundLand' ||
      (this._crouchHeld && this.grounded && st !== 'slopeSlide');

    if (wantLow === this.crouching) return;

    const wantH = wantLow ? TUNE.crouchHeight : TUNE.height;
    if (!wantLow) {
      /* Growing back up: prove the space is free first. Blocked → stay low,
         which is the safe failure under a crusher. */
      if (!this._capsuleClear(this.pos.x, this.pos.y, this.pos.z, this.radius, wantH)) {
        this._standGuardT = 0.10;
        return;
      }
    }
    this.crouching = wantLow;
    this.height = wantH;
  }

  /**
   * Is an upright capsule of `h` metres at (x, y, z) free of solid geometry?
   * Conservative — it errs toward "blocked".
   */
  _capsuleClear(x, y, z, radius, h) {
    const w = this.world;
    const bp = w && w.broadphase;
    if (!bp || typeof bp.query !== 'function') return true;

    const r = radius * CLEAR_INSET_R;
    _box.min.set(x - r, y + CLEAR_INSET_Y, z - r);
    _box.max.set(x + r, y + h - CLEAR_INSET_Y, z + r);

    _query.length = 0;
    let list;
    try { list = bp.query(_box, _query) || _query; } catch (err) { return true; }
    if (!list || !list.length) return true;

    const bmin = _box.min, bmax = _box.max;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.active === false || c.solid === false) continue;
      const ab = c.aabb;
      if (!ab || !ab.min || !ab.max) continue;
      if (ab.max.x <= bmin.x || ab.min.x >= bmax.x) continue;
      if (ab.max.y <= bmin.y || ab.min.y >= bmax.y) continue;
      if (ab.max.z <= bmin.z || ab.min.z >= bmax.z) continue;
      return false;
    }
    return true;
  }

  /* =========================================================================
   * Pre-move: everything a button press can start this substep
   * ====================================================================== */
  _preMove(dt) {
    const st = this.state;

    /* Timed states that expire on their own. */
    if (st === 'pivot' && this.stateT >= PIVOT_TIME) {
      if (this._wmag > 0) this.facing = yawFromHeading(this._wx, this._wz);
      this._setState(this._wmag > 0 ? 'run' : 'idle');
    } else if (st === 'land' && this.stateT >= TUNE.landLag) {
      this._setState(this._wmag > 0 ? 'run' : 'idle');
    } else if (st === 'hardLand' && this.stateT >= TUNE.hardLandLag) {
      this._setState('idle');
    } else if (st === 'poundLand' && this.stateT >= POUND_STUN) {
      this._setState('idle');
    } else if (st === 'slideRecover' && this.stateT >= SLIDE_RECOVER) {
      this._setState('idle');
    } else if (st === 'poundHang' && this.stateT >= TUNE.pound.hang) {
      this._setState('poundFall');
      this.vel.set(0, -TUNE.pound.fall, 0);
      this._sfx('pound_hang');
    } else if (st === 'climbKick' && this.stateT >= 0.18) {
      this._setState('fall');
    } else if (st === 'wallkick' && (this.vel.y <= 0 || this.stateT > 0.35)) {
      this._setState('fall');
    } else if (st === 'swimDive' && this.stateT >= SWIM_DIVE_TIME) {
      this._setState('swim');
    }

    /* Stun locks everything except gravity and existing momentum. */
    if (this.stunT > 0) return;

    /* Cannon: aim with the stick, JUMP fires. */
    if (st === 'cannon') {
      if (this._wmag > 0) {
        this.facing = moveTowardAngle(this.facing, yawFromHeading(this._wx, this._wz), CANNON_AIM * dt);
        this._cannonPitch = clamp(this._cannonPitch + this._inMoveY * 0.9 * dt, 0.15, 1.35);
      }
      if (this.bufferT > 0) { this.bufferT = 0; this._fireCannon(); }
      return;
    }

    /* Ground pound: crouch/pound pressed while airborne, and not already
       committed to a dive. A dive press in the same frame wins (§11). */
    if (this._poundPressLatch && !this._divePressLatch && !this.grounded && !this.inWater &&
      st !== 'poundHang' && st !== 'poundFall' && st !== 'climb' && st !== 'cannon' && st !== 'dive') {
      this._doPound();
      return;
    }

    /* Dive: ground or air, at speed. */
    if (this._divePressLatch && st !== 'dive' && st !== 'slide' && st !== 'poundHang' && st !== 'poundFall') {
      if (this.inWater) this._doSwimDash();
      else if (this.speed >= TUNE.dive.minSpeed || (!this.grounded && this.speed >= TUNE.dive.minSpeed * 0.6)) this._doDive();
    }

    /* Jump family — buffered, so a press just before landing still fires. */
    if (this.bufferT > 0) this._tryJump();
  }

  /**
   * Resolve a buffered jump into exactly one move. Order is deliberate: the
   * contextual moves (water, ladder, pound-jump, slide hop, slope recover)
   * come before the general ground jumps, and the wall kick is the airborne
   * fallback so an accidental wall touch never eats a double jump.
   */
  _tryJump() {
    const st = this.state;

    /* --- water ------------------------------------------------------- */
    if (this.inWater) {
      if (!this.submerged) this._doSurfaceHop();
      else this._doStroke();
      this.bufferT = 0;
      return;
    }

    /* --- ladder ------------------------------------------------------ */
    if (st === 'climb') { this._doClimbKick(); this.bufferT = 0; return; }

    /* --- pound-jump: within pound.jumpWindow of the pound landing ----- */
    if (st === 'poundLand' && this.stateT <= TUNE.pound.jumpWindow) {
      this._doPoundJump();
      this.bufferT = 0;
      return;
    }

    /* --- belly-slide hop --------------------------------------------- */
    if (st === 'slide' && this.stateT >= TUNE.dive.slideMinTime) {
      this._doSlideHop();
      this.bufferT = 0;
      return;
    }

    /* --- slope slide recovery ---------------------------------------- */
    if (st === 'slopeSlide') {
      this._doSlopeJump();
      this.bufferT = 0;
      return;
    }

    /* --- hard landing locks the jump (that is the punishment) --------- */
    if (st === 'hardLand') return;

    /* --- quicksand: mash to escape ------------------------------------ */
    if (this._inQuicksand) {
      this._doQuicksandMash();
      this.bufferT = 0;
      return;
    }

    /* --- grounded (or inside coyote time) ----------------------------- */
    if (this.grounded || this.coyoteT > 0) {
      if (this._crouchHeld) {
        if (this.speed >= TUNE.longJump.minSpeed) this._doLongJump();
        else if (this.speed < BACKFLIP_MAX_SPEED) this._doBackflip();
        else this._doJump();
      } else if (this._reverseT > 0 && this.speed >= PIVOT_MIN_SPEED * 0.5) {
        this._doSideflip();
      } else {
        this._doJump();
      }
      this.bufferT = 0;
      return;
    }

    /* --- airborne: wall kick ------------------------------------------ */
    if (this._canWallKick()) {
      this._doWallKick();
      this.bufferT = 0;
    }
    /* Otherwise the buffer keeps running down — that IS the jump buffer. */
  }

  /* =========================================================================
   * The jump family
   * ====================================================================== */

  /**
   * Shared bookkeeping for every move that leaves the ground under power.
   *
   * GRAVITY PHASE: `_launch` deliberately does NOT touch `_skipGravHalf`. A move
   * started in `_preMove` (before the sweep) wants the ordinary two half-steps —
   * that is what puts its apex exactly on the continuous parabola. A launch
   * applied AFTER the sweep (a bounce pad, a pound bounce) has not been
   * integrated yet, so those callers set `_skipGravHalf` themselves or their
   * apex lands one substep short.
   */
  _launch(stateName, cuttable) {
    this.grounded = false;
    this._noGroundT = NO_GROUND_AFTER_JUMP;
    this.coyoteT = 0;
    this.bufferT = 0;
    this._wallT = 0;
    this._jumpedThisStep = true;
    this._jumpT = 0;
    this._cutArmed = !!cuttable;
    this._cutPending = false;
    this._fellFromJump = true;       // hard landings only come from FALLS
    this._stepDist = 0;
    this.stats.jumps++;
    this._setState(stateName);
  }

  /**
   * Single / double / triple. The chain advances only when the previous landing
   * was recent (`tripleWindow`) AND the hero is moving (`tripleMinSpeed`); any
   * landing that is not promptly followed by a jump resets it.
   */
  _doJump() {
    let n = 1;
    if (this._chainT > 0 && this.jumpCount >= 1 && this.jumpCount < 3 &&
      this.speed >= TUNE.tripleMinSpeed) {
      n = this.jumpCount + 1;
    }
    this.jumpCount = n;
    this._chainT = 0;
    this.vel.y = TUNE.jumpV[n - 1];
    this._launch(n === 1 ? 'jump1' : (n === 2 ? 'jump2' : 'jump3'), true);
    this.lastJumpKind = n === 1 ? 'single' : (n === 2 ? 'double' : 'triple');
    this._ev('jump', this.lastJumpKind, this.pos);
    this._sfx(n === 1 ? 'jump1' : (n === 2 ? 'jump2' : 'jump3'));
    this._fxBurst(n === 3 ? 'jump3' : 'jump', this.pos);
  }

  /**
   * LONG JUMP — crouch + jump at speed. Horizontal velocity is SET (not added)
   * along the facing so the distance is exactly the authored one, and air
   * control drops to 35 % so the arc cannot be steered into a wall.
   */
  _doLongJump() {
    headingFromYaw(this.facing, _fwd);
    const lj = TUNE.longJump;
    this.vel.x = _fwd.x * lj.fwd;
    this.vel.z = _fwd.z * lj.fwd;
    this.vel.y = lj.vy;
    this.jumpCount = 0;
    this._chainT = 0;
    this._launch('longjump', false);
    this.lastJumpKind = 'long';
    this._ev('longjump', this.pos);
    this._ev('jump', 'long', this.pos);
    this._sfx('longjump');
    this._fxBurst('longjump', this.pos);
  }

  /** BACKFLIP — crouch + jump from (near) rest: straight up, drifting back. */
  _doBackflip() {
    headingFromYaw(this.facing, _fwd);
    const bf = TUNE.backflip;
    this.vel.x = -_fwd.x * bf.back;
    this.vel.z = -_fwd.z * bf.back;
    this.vel.y = bf.vy;
    this.jumpCount = 0;
    this._chainT = 0;
    this._launch('backflip', false);
    this.lastJumpKind = 'backflip';
    this._ev('backflip', this.pos);
    this._ev('jump', 'backflip', this.pos);
    this._sfx('backflip');
    this._fxBurst('jump', this.pos);
  }

  /** SIDEFLIP — jump within REVERSE_WINDOW of a stick reversal at speed. */
  _doSideflip() {
    const sf = TUNE.sideflip;
    let wx = this._wx, wz = this._wz;
    if (wx === 0 && wz === 0) { headingFromYaw(this.facing, _fwd); wx = -_fwd.x; wz = -_fwd.z; }
    this.facing = yawFromHeading(wx, wz);
    this.vel.x = wx * sf.lateral;
    this.vel.z = wz * sf.lateral;
    this.vel.y = sf.vy;
    this.jumpCount = 0;
    this._chainT = 0;
    this._reverseT = 0;
    this._launch('sideflip', false);
    this.lastJumpKind = 'sideflip';
    this._ev('sideflip', this.pos);
    this._ev('jump', 'sideflip', this.pos);
    this._sfx('sideflip');
    this._fxBurst('jump', this.pos);
  }

  /** True when a fresh, near-vertical wall contact is still kickable. */
  _canWallKick() {
    if (this.grounded || this.inWater) return false;
    if (this._wallLockT > 0) return false;
    if (this._wallT <= WALL_MEM - TUNE.wallKick.window) return false;   // outside the window
    if (this.wallN.x === 0 && this.wallN.z === 0) return false;
    /* minFall: the hero must be falling (or nearly) — you bonk a wall on the
       way up, you kick it on the way down. */
    return this.vel.y <= TUNE.wallKick.minFall;
  }

  /** WALL KICK — off the wall normal, facing flips to face away from the wall. */
  _doWallKick() {
    const wk = TUNE.wallKick;
    const n = this.wallN;
    const vel = this.vel;
    /* Cancel everything heading into the wall, then push off it. */
    const into = vel.x * n.x + vel.z * n.z;
    if (into < 0) { vel.x -= into * n.x; vel.z -= into * n.z; }
    vel.x += n.x * wk.away;
    vel.z += n.z * wk.away;
    vel.y = wk.vy;
    this.facing = yawFromHeading(n.x, n.z);
    this.jumpCount = 1;
    this._chainT = 0;
    this._wallLockT = wk.lockout;
    this._launch('wallkick', true);
    this.stats.wallKicks++;
    this.lastJumpKind = 'wallkick';
    this._ev('wallkick', this.pos, n);
    this._ev('jump', 'wallkick', this.pos);
    this._sfx('wallkick');
    this._fxBurst('wallkick', this.pos);
  }

  /** DIVE — a committed forward launch that becomes a belly slide on landing. */
  _doDive() {
    headingFromYaw(this.facing, _fwd);
    const dv = TUNE.dive;
    this.vel.x = _fwd.x * dv.fwd;
    this.vel.z = _fwd.z * dv.fwd;
    if (this.vel.y < dv.vy) this.vel.y = dv.vy;
    this.jumpCount = 0;
    this._chainT = 0;
    this.grounded = false;
    this._noGroundT = NO_GROUND_AFTER_JUMP;
    this._fellFromJump = true;
    this._cutArmed = false;
    this._setState('dive');
    this.stats.dives++;
    this._ev('dive', this.pos);
    this._sfx('dive');
    this._fxBurst('dive', this.pos);
  }

  /** Jump-cancel out of a belly slide (a low, fast hop that keeps the speed). */
  _doSlideHop() {
    this.vel.y = TUNE.dive.hopV;
    this.jumpCount = 1;
    this._launch('jump1', true);
    this.lastJumpKind = 'hop';
    this._ev('jump', 'hop', this.pos);
    this._sfx('jump1');
    this._fxBurst('jump', this.pos);
  }

  /** GROUND POUND — hang, then a constant-speed plunge. */
  _doPound() {
    this.vel.set(0, 0, 0);
    this.jumpCount = 0;
    this._chainT = 0;
    this._cutArmed = false;
    this._cutPending = false;
    this._setState('poundHang');
    this.stats.pounds++;
    this._ev('pound', this.pos);
    this._sfx('pound_hang');
  }

  /** Pound-jump: a big vertical out of the landing stun. */
  _doPoundJump() {
    this.vel.y = TUNE.pound.bounceV;
    this.jumpCount = 1;
    this._launch('jump1', false);
    this.lastJumpKind = 'poundjump';
    this._ev('jump', 'poundjump', this.pos);
    this._sfx('jump2');
    this._fxBurst('poundShock', this.pos);
  }

  /** Slope-slide recovery jump: keeps the slide speed, adds the recover launch. */
  _doSlopeJump() {
    this.vel.y = TUNE.slope.recoverJumpV;
    this.jumpCount = 1;
    this._launch('jump1', true);
    this.lastJumpKind = 'slope';
    this._ev('jump', 'slope', this.pos);
    this._sfx('jump1');
  }

  /** Quicksand escape: every mashed jump adds a little more lift. */
  _doQuicksandMash() {
    this._qsMash = Math.min(this._qsMash + QUICKSAND_MASH, QUICKSAND_MASH_MAX);
    this.vel.y = this._qsMash;
    this._sfx('jump1', 0.6);
    this._fxBurst('sandPuff', this.pos);
    if (this._qsMash >= QUICKSAND_MASH_MAX) {
      this.vel.y = TUNE.jumpV[0] * 0.75;
      this._qsMash = 0;
      this._launch('jump1', false);
      this._ev('jump', 'quicksand', this.pos);
    }
  }

  _fireCannon() {
    const c = this._cannon;
    this._cannon = null;
    const power = (c && isFinite(c.power)) ? c.power : 24;
    const pitch = isFinite(this._cannonPitch) ? this._cannonPitch : 0.6;
    headingFromYaw(this.facing, _fwd);
    const ch = Math.cos(pitch);
    this.vel.set(_fwd.x * power * ch, Math.sin(pitch) * power, _fwd.z * power * ch);
    this.jumpCount = 0;
    this._flyT = 0;                     // ballistic, not a glide
    this._launch('fall', false);
    this._sfx('cannon_fire');
    this._fxBurst('longjump', this.pos);
    if (c && c.ref && typeof c.ref.onFire === 'function') { try { c.ref.onFire(this); } catch (err) { /* hazard owns its own errors */ } }
  }

  /**
   * Variable jump height. The full `jumpV` is guaranteed for `jumpHoldMin`
   * seconds no matter when the button comes up, so a tap never produces a
   * frame-rate-dependent hop; after that a release cuts the rise by `jumpCut`.
   */
  _resolveJumpCut() {
    if (this._jumpReleaseLatch) {
      this._jumpReleaseLatch = false;
      if (this._cutArmed) this._cutPending = true;
    }
    if (this._cutPending && this._cutArmed) {
      if (this._jumpT >= TUNE.jumpHoldMin) {
        if (this.vel.y > 0) this.vel.y *= TUNE.jumpCut;
        this._cutPending = false;
        this._cutArmed = false;
      }
    }
    if (this.vel.y <= 0) { this._cutArmed = false; this._cutPending = false; }
  }

  /* =========================================================================
   * Locomotion — one branch per family of states
   * ====================================================================== */
  _locomotion(dt) {
    const st = this.state;

    if (this.inWater) { this._swimMove(dt); return; }
    if (st === 'climb') { this._climbMove(dt); return; }
    if (NO_LOCOMOTION[st] === 1) {
      /* Pound / stun states: no steering at all, but a pound plunge holds its
         constant speed and a slide-recover bleeds what is left. */
      if (st === 'poundFall') this.vel.set(0, -TUNE.pound.fall, 0);
      else if (st === 'poundHang') this.vel.set(0, 0, 0);
      else if (st === 'slideRecover' || st === 'hardLand' || st === 'poundLand') {
        /* Bleed to a stop with the same move-toward-zero the ground model uses
           (a multiplicative decay would go NEGATIVE at very low speed). */
        const sp = hyp2(this.vel.x, this.vel.z);
        const drop = TUNE.decelGround * 0.6 * dt;
        if (sp <= drop || sp < 1e-5) { this.vel.x = 0; this.vel.z = 0; }
        else { const k = (sp - drop) / sp; this.vel.x *= k; this.vel.z *= k; }
      }
      return;
    }
    if (st === 'slopeSlide') { this._slopeMove(dt); return; }
    if (st === 'slide') { this._slideMove(dt); return; }
    if (this.grounded) this._groundMove(dt);
    else this._airMove(dt);
  }

  /**
   * GROUND — the analog platformer model: the velocity is driven toward
   * (facing × speedTarget) at `accelGround`, and toward zero at `decelGround`
   * when the stick is released. A vector move-toward makes the numbers exact:
   * 0 → 9 m/s in speedRun/accelGround = 0.214 s, 9 → 0 in 0.141 s.
   *
   * ICE is a different physics: a Quake projection accel with very low friction,
   * so the hero keeps authority but drifts (TUNE.ice).
   */
  _groundMove(dt) {
    const vel = this.vel;
    const st = this.state;

    /* Reversal detection: a hard stick reversal at speed becomes a PIVOT (a
       0.12 s skid then a snap turn), and arms the sideflip window. */
    if (this._wmag > 0 && this.speed > PIVOT_MIN_SPEED && st !== 'pivot') {
      const inv = 1 / Math.max(this.speed, 1e-6);
      const d = this._wx * vel.x * inv + this._wz * vel.z * inv;
      if (d < TUNE.sideflip.reverseDot) this._reverseT = REVERSE_WINDOW;
      if (d < TUNE.reverseSnapDot) {
        this._setState('pivot');
        this._pivotRate = Math.max(this.speed / PIVOT_TIME, TUNE.decelGround);
        this._ev('slide', this.pos, this.surface);
        this._sfx('slide');
        _fxOpt.strength = clamp(this.speed / TUNE.speedRun, 0.2, 1);
        _fxOpt.surface = this.surface;
        _fxOpt.count = 6;
        _fxOpt.speed = this.speed;
        this._fxBurst('slideDust', this.pos, _fxOpt);
        return;
      }
    }

    /* The pivot itself: brake to a stop over PIVOT_TIME, no steering. */
    if (st === 'pivot') {
      const sp = this.speed;
      const drop = this._pivotRate * dt;
      if (sp <= drop || sp < 1e-5) { vel.x = 0; vel.z = 0; }
      else { const k = (sp - drop) / sp; vel.x *= k; vel.z *= k; }
      return;
    }

    const onIce = this.surface === 'ice';
    let target = this._speedTarget(this._wmag);
    if (this.crouching && target > TUNE.speedWalk * CROUCH_SPEED_MUL * 2) target *= CROUCH_SPEED_MUL;
    if (this._inQuicksand) target *= QUICKSAND_MOVE;
    if (st === 'land') target *= 0.85;          // the 0.05 s landing dip

    this._turnToward(dt, this._wx, this._wz, false);

    if (onIce) {
      /* friction first (a stop-speed floor keeps low speeds from creeping) */
      const sp = hyp2(vel.x, vel.z);
      if (sp > 1e-5) {
        const control = sp < 2.0 ? 2.0 : sp;
        let ns = sp - control * TUNE.ice.friction * dt;
        if (ns < 0) ns = 0;
        const k = ns / sp;
        vel.x *= k; vel.z *= k;
      } else { vel.x = 0; vel.z = 0; }
      accelerateXZ(vel, this._wx, this._wz, target, TUNE.ice.accel, dt);
      return;
    }

    headingFromYaw(this.facing, _fwd);
    const tx = target > 0 ? _fwd.x * target : 0;
    const tz = target > 0 ? _fwd.z * target : 0;
    const rate = (target > 0 ? TUNE.accelGround : TUNE.decelGround) * dt;
    const dx = tx - vel.x, dz = tz - vel.z;
    const d = hyp2(dx, dz);
    if (d <= rate || d < 1e-6) { vel.x = tx; vel.z = tz; }
    else { const k = rate / d; vel.x += dx * k; vel.z += dz * k; }
  }

  /**
   * AIR — Quake projection acceleration (adds only the deficit along the wish
   * axis, so a long jump is never braked by holding forward), a cap computed
   * from the LAUNCH speed, and the same `airDrag` the published REACH_TABLE was
   * integrated with, so the measured gaps match the authored ones.
   */
  _airMove(dt) {
    const vel = this.vel;
    const committed = COMMITTED[this.state] === 1;
    const ctrl = committed ? COMMIT_AIR_CONTROL : 1;

    this._turnToward(dt, this._wx, this._wz, true);

    const wish = this._speedTarget(this._wmag);
    const pre = hyp2(vel.x, vel.z);
    accelerateXZ(vel, this._wx, this._wz, wish, TUNE.accelAir * ctrl, dt);

    /* Air speed cap = max(launch horizontal speed, speedWalk) + bonus. Speed
       carried in from a pad, a slope or a long jump is never clipped down. */
    let cap = Math.max(this._launchSpeed, TUNE.speedWalk) + TUNE.airSpeedCapBonus;
    if (pre > cap) cap = pre;
    const now = hyp2(vel.x, vel.z);
    if (now > cap && now > 1e-6) { const k = cap / now; vel.x *= k; vel.z *= k; }

    /* Horizontal air drag, exactly as `simulateJump` integrates it. */
    const f = 1 - TUNE.airDrag * dt;
    vel.x *= f; vel.z *= f;
  }

  /** SLOPE SLIDE — accelerate straight down the fall line, capped. */
  _slopeMove(dt) {
    const n = this.groundNormal;
    let dx = n.x, dz = n.z;                 // the normal leans DOWNHILL in XZ
    const l = hyp2(dx, dz);
    if (l < 1e-5) { this._setState(this._wmag > 0 ? 'run' : 'idle'); return; }
    dx /= l; dz /= l;
    const vel = this.vel;
    vel.x += dx * TUNE.slope.accel * dt;
    vel.z += dz * TUNE.slope.accel * dt;
    /* A little steering authority so a slide is playable, not a cutscene. */
    accelerateXZ(vel, this._wx, this._wz, TUNE.speedWalk, TUNE.accelGround * 0.25, dt);
    const sp = hyp2(vel.x, vel.z);
    if (sp > TUNE.slope.maxSpeed) { const k = TUNE.slope.maxSpeed / sp; vel.x *= k; vel.z *= k; }
    if (sp > 0.6) this.facing = yawFromHeading(vel.x, vel.z);
    if (this._scrapeT <= 0) {
      this._scrapeT = 0.09;
      _fxOpt.strength = clamp(sp / TUNE.slope.maxSpeed, 0.2, 1);
      _fxOpt.surface = this.surface;
      _fxOpt.count = 5;
      _fxOpt.speed = sp;
      this._fxBurst('slideDust', this.pos, _fxOpt);
      this._ev('slide', this.pos, this.surface);
    }
  }

  /** BELLY SLIDE — friction only; a little steering, no acceleration. */
  _slideMove(dt) {
    const vel = this.vel;
    const sp = hyp2(vel.x, vel.z);
    const fr = (this.surface === 'ice' ? TUNE.ice.friction : TUNE.dive.slideFriction) * dt;
    if (sp <= fr || sp < 1e-5) { vel.x = 0; vel.z = 0; }
    else { const k = (sp - fr) / sp; vel.x *= k; vel.z *= k; }
    /* Steer the slide gently (a quarter of the ground turn rate). */
    if (this._wmag > 0 && sp > 0.5) {
      const target = yawFromHeading(this._wx, this._wz);
      this.facing = moveTowardAngle(this.facing, target, TUNE.turnRateFast * 0.5 * dt);
      headingFromYaw(this.facing, _fwd);
      const s2 = hyp2(vel.x, vel.z);
      vel.x = _fwd.x * s2; vel.z = _fwd.z * s2;
    }
    if (this._scrapeT <= 0) {
      this._scrapeT = 0.08;
      _fxOpt.strength = clamp(sp / TUNE.dive.fwd, 0.15, 1);
      _fxOpt.surface = this.surface;
      _fxOpt.count = 5;
      _fxOpt.speed = sp;
      this._fxBurst('slideDust', this.pos, _fxOpt);
    }
    if (sp < SLIDE_END_SPEED && this.stateT >= TUNE.dive.slideMinTime) this._setState('slideRecover');
  }

  /**
   * SWIM — surface and submerged. Analog horizontal at `swim.speed`, `jump` is
   * a stroke (or a hop out at the surface), `crouch` sinks, and everything is
   * bled by `swim.drag` so the water always feels heavy.
   */
  _swimMove(dt) {
    const vel = this.vel;
    const sw = TUNE.swim;

    this._turnToward(dt, this._wx, this._wz, false);

    const target = sw.speed * clamp(this._wmag, 0, 1);
    accelerateXZ(vel, this._wx, this._wz, target, sw.accel, dt);

    /* vertical: sink on crouch, buoyancy toward the surface, drag otherwise */
    if (this._crouchHeld) {
      if (vel.y > -sw.sink) vel.y -= sw.accel * dt;
      if (vel.y < -sw.sink) vel.y = -sw.sink;
    } else if (this.submerged) {
      vel.y += SWIM_BUOYANCY * dt;
    }

    /* drag on all three axes — this is what makes water heavy */
    const f = Math.max(0, 1 - sw.drag * dt);
    vel.x *= f; vel.z *= f;
    vel.y *= f;

    /* Never float above the surface: at the waterline the vertical is clamped
       so the hero bobs instead of launching. */
    const sy = this._waterSurfaceY;
    if (isFinite(sy)) {
      const head = this.pos.y + this.height * HEAD_FRAC;
      if (head > sy && vel.y > 0) vel.y *= 0.25;
    }

    if (this.state !== 'swimDive') this._setState(this._wmag > 0 || Math.abs(vel.y) > 0.6 ? 'swim' : 'swimIdle');
  }

  /** Stroke: a pulse of forward + rise, rate-limited so mashing does nothing. */
  _doStroke() {
    if (this._strokeT > 0) return;
    this._strokeT = STROKE_CD;
    const sw = TUNE.swim;
    if (this.vel.y < sw.rise) this.vel.y = sw.rise;
    headingFromYaw(this.facing, _fwd);
    this.vel.x += _fwd.x * sw.speed * 0.5;
    this.vel.z += _fwd.z * sw.speed * 0.5;
    this._setState('swim');
    this._sfx('swim_stroke');
    this._fxBurst('bubbles', this.pos);
  }

  /** A dash while submerged — the swimDive move. */
  _doSwimDash() {
    const sw = TUNE.swim;
    headingFromYaw(this.facing, _fwd);
    this.vel.x = _fwd.x * sw.diveV;
    this.vel.z = _fwd.z * sw.diveV;
    this._setState('swimDive');
    this._sfx('swim_stroke');
    this._fxBurst('bubbles', this.pos);
  }

  /** Surfaced + jump: hop clean out of the water. */
  _doSurfaceHop() {
    this.vel.y = TUNE.swim.surfaceJumpV;
    this.jumpCount = 1;
    this.inWater = null;
    this.submerged = false;
    this._launch('jump1', true);
    this.lastJumpKind = 'surface';
    this._ev('surface', this.pos);
    this._ev('jump', 'surface', this.pos);
    this._sfx('surface');
    this._fxBurst('splash', this.pos);
  }

  /**
   * CLIMB — poles, nets and trees. A pole (`props.pole = [x,z]`) is orbited:
   * the stick's X drives the angle and its Y drives the height, with a radial
   * spring holding `climb.radius`. Flat ladders slide laterally instead.
   */
  _climbMove(dt) {
    const v = this._climbVol;
    const cl = TUNE.climb;
    const vel = this.vel;
    if (!v || v.active === false) { this._endClimb(); return; }

    const props = v.props || null;
    const pole = props && props.pole;

    vel.y = this._inMoveY * cl.speed;

    if (pole) {
      const px = +pole[0] || 0, pz = +pole[1] || 0;
      let rx = this.pos.x - px, rz = this.pos.z - pz;
      let r = hyp2(rx, rz);
      if (r < 1e-4) { rx = 1; rz = 0; r = 1; }
      rx /= r; rz /= r;
      /* tangential (orbit) + radial spring back to the grip radius */
      const tanX = -rz, tanZ = rx;
      const orbit = this._inMoveX * cl.speed;
      const pull = (r - cl.radius - this.radius) * 6;
      vel.x = tanX * orbit - rx * pull;
      vel.z = tanZ * orbit - rz * pull;
      this.facing = yawFromHeading(-rx, -rz);       // face the pole
    } else {
      /* Flat ladder / net: slide across its face, facing into it. */
      const yaw = (props && isFinite(props.yaw)) ? props.yaw : this.facing;
      headingFromYaw(yaw, _fwd);
      const rightX = -_fwd.z, rightZ = _fwd.x;
      vel.x = rightX * this._inMoveX * cl.speed;
      vel.z = rightZ * this._inMoveX * cl.speed;
      this.facing = yaw;
    }

    /* Top of the climb: step off onto the ledge. */
    const top = props && isFinite(props.top) ? props.top : v.aabb.max.y;
    if (this.pos.y + this.height > top + 0.15 && this._inMoveY > 0.2) {
      headingFromYaw(this.facing, _fwd);
      vel.x += _fwd.x * 2.4;
      vel.z += _fwd.z * 2.4;
      vel.y = 3.0;
      this._endClimb();
    }
  }

  /** Kick off a pole/net: away from it and up (climb.kickV = [away, up]). */
  _doClimbKick() {
    const k = TUNE.climb.kickV;
    headingFromYaw(this.facing, _fwd);
    this.vel.x = -_fwd.x * k[0];
    this.vel.z = -_fwd.z * k[0];
    this.vel.y = k[1];
    this.facing = yawFromHeading(-_fwd.x, -_fwd.z);
    this._climbVol = null;
    this.jumpCount = 1;
    this._launch('climbKick', true);
    this._ev('climbEnd', this.pos);
    this._ev('jump', 'climb', this.pos);
    this._sfx('jump1');
  }

  _startClimb(v) {
    if (this._climbVol === v) return;
    this._climbVol = v;
    this.vel.set(0, 0, 0);
    this.jumpCount = 0;
    this._chainT = 0;
    this.grounded = false;
    this._setState('climb');
    this._ev('climbStart', this.pos, v);
  }

  _endClimb() {
    if (!this._climbVol) return;
    this._climbVol = null;
    this._setState('fall');
    this._ev('climbEnd', this.pos);
  }

  /* =========================================================================
   * Gravity
   * ====================================================================== */

  /**
   * Half (or whole) step of vertical acceleration through `applyGravity` —
   * THE gravity function (CONTRACT §0). Never `vy -= g*dt` anywhere else.
   */
  _grav(h) {
    if (h <= 0) return;
    const st = this.state;
    if (this.inWater || st === 'climb' || st === 'cannon' ||
      st === 'poundHang' || st === 'poundFall' || st === 'dead') return;

    const vel = this.vel;
    if (st === 'wallslide') {
      vel.y = applyGravity(vel.y, h * WALL_SLIDE_GRAV, false);
      if (vel.y < -WALL_SLIDE_MAX) vel.y = -WALL_SLIDE_MAX;
      return;
    }
    if (st === 'fly' && this._flyT > 0) {
      vel.y = applyGravity(vel.y, h * FLY_GRAV, this._rising);
      return;
    }
    if (this._inQuicksand && !this.grounded) {
      vel.y = applyGravity(vel.y, h * 0.25, this._rising);
      if (vel.y < -QUICKSAND_SINK) vel.y = -QUICKSAND_SINK;
      return;
    }
    vel.y = applyGravity(vel.y, h, this._rising);
  }

  /* =========================================================================
   * Collision
   * ====================================================================== */

  _syncCollide() {
    const cs = this._cs;
    cs.pos = this.pos;
    cs.vel = this.vel;
    cs.radius = this.radius;
    cs.height = this.height;
    cs.crouching = this.crouching;
    cs.grounded = this.grounded;
    cs.jumped = this._jumpedThisStep;
    cs.poundFalling = this.state === 'poundFall';
    cs.stepUp = TUNE.stepUp;
    /* Never re-snap onto the ledge we just left, and never on a launch frame. */
    cs.wantSnap = this.grounded && this.vel.y <= 0.01 && this._noGroundT <= 0;
    return cs;
  }

  _collide(dt) {
    const cs = this._syncCollide();
    const w = this.world;
    if (w && (w.broadphase || w.colliders || w.heightfields) && typeof moveAndCollide === 'function') {
      const res = moveAndCollide(cs, w, dt);
      if (res) return res;
    }
    return this._fallbackCollide(dt);
  }

  /**
   * Minimal flat-ground integrator for bootstrap frames and a standalone
   * harness that supplies only `{groundY}`. Keeps the controller testable with
   * no world at all.
   */
  _fallbackCollide(dt) {
    const pos = this.pos, vel = this.vel, r = _fbRes, w = this.world;
    const gy = (w && typeof w.groundY === 'number') ? w.groundY : null;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    r.grounded = false;
    r.ceiling = false;
    r.crushed = false;
    r.stepped = false;
    r.surface = 'normal';
    r.surfaceProps = null;
    r.groundCollider = null;
    r.groundHeightfield = null;
    r.groundSlopeDeg = 0;
    r.groundNormal.set(0, 1, 0);
    r.platformVel.set(0, 0, 0);
    r.kill = null;
    r.killKind = null;
    r.inWater = null;
    r.waterSurfaceY = NaN;
    r.inQuicksand = false;
    r.wind = null;
    r.current = null;
    r.ladder = null;
    r.breakable = null;
    if (r.walls.length) r.walls.length = 0;
    if (r.volumes.length) r.volumes.length = 0;

    if (gy !== null && pos.y <= gy && vel.y <= 0) {
      r.hitVel.copy(vel);
      pos.y = gy;
      vel.y = 0;
      r.grounded = true;
    }
    return r;
  }

  /* =========================================================================
   * Contacts — landing, walls, surfaces, carry
   * ====================================================================== */
  _readContacts(res, wasGrounded, preVy, dt) {
    const vel = this.vel;

    let grounded = !!(res && res.grounded);
    if (this._noGroundT > 0 && vel.y > 0) grounded = false;      // just launched
    if (this.inWater || this.state === 'climb' || this.state === 'cannon') grounded = grounded && vel.y <= 0;

    const surface = (res && res.surface) ? res.surface : 'normal';
    const props = (res && res.surfaceProps) ? res.surfaceProps : null;

    this.groundCollider = (res && res.groundCollider) ? res.groundCollider : null;
    this.groundHeightfield = (res && res.groundHeightfield) ? res.groundHeightfield : null;
    this.groundSlopeDeg = (res && isFinite(res.groundSlopeDeg)) ? res.groundSlopeDeg : 0;
    if (res && res.groundNormal) this.groundNormal.copy(res.groundNormal);
    else if (grounded) this.groundNormal.set(0, 1, 0);
    this.surface = grounded ? surface : 'normal';
    this.surfaceProps = grounded ? props : null;

    /* ---- walls ------------------------------------------------------- */
    const walls = (res && res.walls) ? res.walls : null;
    let hitWall = false;
    if (walls && walls.length) {
      let best = -2, bestI = -1;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const n = w && w.normal;
        if (!n) continue;
        if (Math.abs(n.y) > WALL_MAX_NY) continue;
        const d = this._wmag > 0 ? -(this._wx * n.x + this._wz * n.z) : 0.001;
        if (d > best) { best = d; bestI = i; }
      }
      if (bestI >= 0) {
        const n = walls[bestI].normal;
        const hl = hyp2(n.x, n.z) || 1;
        _wallN.set(n.x / hl, 0, n.z / hl);
        this.wallN.copy(_wallN);
        this._wallRef = walls[bestI].collider || null;
        this._wallT = WALL_MEM;
        hitWall = true;
      }
    }
    if (this._wallT <= 0) { this.wallN.set(0, 0, 0); this._wallRef = null; }

    /* A dive or a belly slide that hits a wall recovers instead of grinding. */
    if (hitWall && (this.state === 'dive' || this.state === 'slide')) {
      const into = -(this.vel.x * this.wallN.x + this.vel.z * this.wallN.z);
      if (into > SLIDE_WALL_DOT * Math.max(this.speed, 1)) {
        this.vel.x = 0; this.vel.z = 0;
        this._setState('slideRecover');
        this._sfx('land_soft');
      }
    }

    /* ---- ceiling ----------------------------------------------------- */
    if (res && res.ceiling) {
      if (!this.crouching && this._standGuardT > 0) {
        this.crouching = true;
        this.height = TUNE.crouchHeight;
      }
      if (vel.y > 0) vel.y = 0;
    }

    /* ---- wall slide -------------------------------------------------- */
    this._evalWallSlide(dt);

    /* ---- landing ----------------------------------------------------- */
    if (grounded && !wasGrounded) {
      this._onLand(preVy, surface, props);
    } else if (grounded) {
      this.grounded = true;
    } else {
      if (wasGrounded) {
        if (!this._jumpedThisStep) {
          this.coyoteT = TUNE.coyote;
          this._fellFromJump = false;               // walked off → a real FALL
          if (this.state !== 'dive' && this.state !== 'fly' && !this.inWater &&
            this.state !== 'climb' && this.state !== 'cannon') this._setState('fall');
        }
        /* Keep 70 % of the deck velocity for 0.25 s — how a mover launches you. */
        if (_carryPrev.x !== 0 || _carryPrev.z !== 0) {
          _launchV.set(_carryPrev.x * LAUNCH_KEEP, 0, _carryPrev.z * LAUNCH_KEEP);
          this._launchT = LAUNCH_TIME;
        }
        this._launchSpeed = Math.max(this._launchSpeed, hyp2(vel.x, vel.z));
      }
      this.grounded = false;
    }

    /* ---- surface effects (only while in contact) --------------------- */
    if (this.grounded) this._surfaceEffects(surface, props, preVy);

    /* ---- carry reference for the NEXT substep ------------------------ */
    _carry.set(0, 0, 0);
    _push.set(0, 0, 0);
    if (this.grounded) {
      const pv = res && res.platformVel;
      if (pv) _carry.set(pv.x || 0, pv.y || 0, pv.z || 0);
      if (surface === 'conveyor' && props) {
        readVec(props.dir, _dir, 1, 0, 0);
        _dir.y = 0;
        const dl = _dir.length();
        if (dl > 1e-5) {
          _dir.multiplyScalar(1 / dl);
          let power = typeof props.power === 'number' ? props.power : 4;
          const max = TUNE.conveyorMax;
          if (power > max) power = max; else if (power < -max) power = -max;
          _push.x += _dir.x * power;
          _push.z += _dir.z * power;
        }
      }
      _carry.add(_push);
    }
    _carryPrev.copy(_carry);
    _pushPrev.copy(_push);
    this.carried.copy(_carry);
  }

  /**
   * Landing. `land`/`hardLand` lag only ever comes from a FALL — never from the
   * jump family — so the triple chain is never eaten by a landing animation.
   */
  _onLand(preVy, surface, props) {
    const impact = preVy < 0 ? -preVy : 0;
    this.lastLandImpact = impact;
    this.grounded = true;
    this.coyoteT = 0;
    this._launchT = 0;
    this._launchSpeed = 0;
    this._wallT = 0;
    this._wallLockT = 0;
    this._cutArmed = false;
    this._cutPending = false;
    this._qsMash = 0;
    this._stepDist = STEP_WALK * 0.55;
    this.wallN.set(0, 0, 0);

    const st = this.state;
    const hard = impact >= TUNE.hardLandSpeed && !this._fellFromJump;

    if (st === 'poundFall') {
      this._onPoundLand(surface, props);
      return;
    }
    if (st === 'dive') {
      this._setState('slide');
      this._chainT = 0;
      this.jumpCount = 0;
      this._fellFromJump = false;
      this._ev('slide', this.pos, surface);
      this._sfx('slide');
      this._ev('land', impact, surface, false);
      return;
    }

    /* Triple-jump chain: the window opens on EVERY landing; jumping inside it
       at speed advances the chain, letting it lapse resets to a single. */
    this._chainT = TUNE.tripleWindow;

    if (hard) {
      this._setState('hardLand');
      this.vel.x *= 0.35; this.vel.z *= 0.35;
      this.jumpCount = 0;
      this._chainT = 0;
    } else if (this._fellFromJump || impact > LAND_QUIET) {
      this._setState('land');
    } else {
      this._setState(this._wmag > 0 ? 'run' : 'idle');
    }
    this._fellFromJump = false;

    this._ev('land', impact, surface, hard);
    if (impact > LAND_QUIET && !this._hasListener('land')) {
      _sfxOpt.impact = impact;
      _sfxOpt.gain = 1;
      this._sfxOpts(hard ? 'land_hard' : 'land_soft', _sfxOpt);
      _fxOpt.strength = clamp(impact / TUNE.hardLandSpeed, 0.15, 1);
      _fxOpt.surface = surface;
      _fxOpt.count = 0;
      this._fxBurst(hard ? 'hardLand' : 'land', this.pos, _fxOpt);
    }
  }

  /** The pound landing: shock ring, breakables, bounce pads, then the stun. */
  _onPoundLand(surface, props) {
    this._setState('poundLand');
    this.vel.set(0, 0, 0);
    this.jumpCount = 0;
    this._chainT = 0;
    this._ev('poundLand', this.pos);
    this._ev('land', TUNE.pound.fall, surface, true);
    this._sfx('pound_land');
    _fxOpt.strength = 1;
    _fxOpt.surface = surface;
    _fxOpt.radius = TUNE.pound.shockRadius;
    _fxOpt.count = 0;
    this._fxBurst('poundShock', this.pos, _fxOpt);

    /* Breakables under the pound. The hazard owns what "broken" means — we only
       tell it, duck-typed, and never mutate its collider ourselves. */
    this._breakUnder();

    /* A bounce surface turns the pound into a launch. */
    if (surface === 'bounce') {
      const apex = (props && isFinite(props.power)) ? props.power : TUNE.bounceDefaultApex;
      this.vel.y = Math.max(launchVelocityForApex(apex), TUNE.pound.bounceV);
      this._launch('jump1', false);
      this._skipGravHalf = true;    // post-sweep launch: it owes only ONE half-step
      this._ev('bounce', apex, this.pos);
      this._sfx('bounce');
    }
  }

  /** Tell the contacted breakable (and the ground hazard) that a pound landed. */
  _breakUnder() {
    const res = this._lastRes;
    const b = res && res.breakable;
    this._notifyPound(b);
    const gc = this.groundCollider;
    if (gc && gc !== b) this._notifyPound(gc);
  }

  _notifyPound(col) {
    if (!col) return;
    const ref = col.ref || null;
    try {
      if (ref) {
        if (typeof ref.onPound === 'function') { ref.onPound(this, col); return; }
        if (typeof ref.break === 'function') { ref.break(col, this); return; }
        if (typeof ref.hit === 'function') { ref.hit('pound', this, col); return; }
      }
      const p = col.props;
      if (p && typeof p.onPound === 'function') p.onPound(this, col);
    } catch (err) { /* a hazard threw: the sim goes on */ }
  }

  /** Bounce pads, speed pads and the slope threshold, evaluated on contact. */
  _surfaceEffects(surface, props, preVy) {
    if (surface === 'bounce' && preVy <= 0.01 && this._bounceCD <= 0 && this.state !== 'poundLand') {
      const apex = (props && isFinite(props.power)) ? props.power : TUNE.bounceDefaultApex;
      /* `launchVelocityForApex` uses gravRise, so the apex is EXACTLY `power`. */
      this.vel.y = launchVelocityForApex(this._jumpHeld ? apex * 1.25 : apex);
      this._bounceCD = BOUNCE_CD;
      this.jumpCount = 0;
      this._chainT = 0;
      this._launch('jump1', false);
      this._skipGravHalf = true;    // post-sweep launch: it owes only ONE half-step
      this._ev('bounce', apex, this.pos);
      this._sfx('bounce');
      this._fxBurst('bounce', this.pos);
      return;
    }

    if ((surface === 'speed' || surface === 'speedpad') && this._speedCD <= 0) {
      const power = (props && isFinite(props.power)) ? props.power : 12;
      readVec(props && props.dir, _dir, 0, 0, 0);
      if (_dir.lengthSq() < 1e-8) {
        if (this.speed > 0.5) _dir.set(this.vel.x, 0, this.vel.z);
        else _dir.copy(this.forward);
      }
      const l = _dir.length();
      if (l > 1e-6) {
        _dir.multiplyScalar(1 / l);
        this.vel.x = _dir.x * power;
        this.vel.y += _dir.y * power;
        this.vel.z = _dir.z * power;
        if (Math.abs(_dir.x) + Math.abs(_dir.z) > 1e-4) this.facing = yawFromHeading(_dir.x, _dir.z);
        this._speedCD = SPEEDPAD_CD;
        this._launchSpeed = hyp2(this.vel.x, this.vel.z);
        this._sfx('jump1');
        this._fxBurst('spark', this.pos);
      }
    }

    /* Slope slide: past the threshold for this surface the hero loses grip. */
    const lim = surface === 'ice' ? TUNE.slope.iceSlideDeg : TUNE.slope.slideDeg;
    const st = this.state;
    if (this.groundSlopeDeg > lim) {
      if (st !== 'slopeSlide' && st !== 'slide' && st !== 'dive' && st !== 'poundLand' && st !== 'hardLand') {
        this._setState('slopeSlide');
      }
    } else if (st === 'slopeSlide') {
      this._setState(this._wmag > 0 ? 'run' : 'idle');
    }
  }

  /** Wall slide: airborne, falling, a fresh near-vertical wall, holding into it. */
  _evalWallSlide(dt) {
    const st = this.state;
    if (this.grounded || this.inWater || st === 'climb' || st === 'cannon' ||
      st === 'poundFall' || st === 'poundHang' || st === 'dive') {
      if (st === 'wallslide') this._setState('fall');
      return;
    }
    let slide = false;
    if (this._wallT > 0 && this.vel.y < 0 && this._wmag > 0) {
      const into = -(this._wx * this.wallN.x + this._wz * this.wallN.z);
      if (into > WALL_INTO_DOT) slide = true;
    }
    if (slide) {
      if (st !== 'wallslide') this._setState('wallslide');
      /* Hug the wall: kill anything still heading into it. */
      const n = this.wallN;
      const into = this.vel.x * n.x + this.vel.z * n.z;
      if (into < 0) { this.vel.x -= into * n.x; this.vel.z -= into * n.z; }
      if (this.vel.y < -WALL_SLIDE_MAX) this.vel.y = -WALL_SLIDE_MAX;
      if (this._scrapeT <= 0) {
        this._scrapeT = WALL_SCRAPE_EVERY;
        this._fxBurst('spark', this.pos);
        this._sfx('step_stone', 0.3);
      }
    } else if (st === 'wallslide') {
      this._setState('fall');
    }
  }

  /* =========================================================================
   * Volumes — water, quicksand, wind, current, ladder, checkpoint, trigger
   * ====================================================================== */
  _readVolumes(res, dt) {
    this._lastRes = res;

    /* ---- water ------------------------------------------------------- */
    const water = res ? res.inWater : null;
    const wasWater = this.inWater;
    this.inWater = water || null;
    this._waterSurfaceY = res && isFinite(res.waterSurfaceY) ? res.waterSurfaceY : NaN;

    if (water && !wasWater) {
      const enterSpeed = Math.abs(this.vel.y);
      this._setState(enterSpeed > 6 ? 'swimDive' : 'swimIdle');
      this.jumpCount = 0;
      this._chainT = 0;
      this._cutArmed = false;
      this._fellFromJump = false;
      /* Entering fast plunges you; entering slow just wets your boots. */
      if (this.vel.y < -TUNE.swim.diveV) this.vel.y = -TUNE.swim.diveV;
      this._ev('splash', true, this.pos);
      this._sfx('splash');
      _fxOpt.strength = clamp(enterSpeed / 20, 0.25, 1.2);
      _fxOpt.surface = 'water';
      this._fxBurst('splash', this.pos, _fxOpt);
    } else if (!water && wasWater) {
      if (this.state === 'swim' || this.state === 'swimIdle' || this.state === 'swimDive') this._setState('fall');
      this._ev('surface', this.pos);
      this._sfx('surface');
      this._fxBurst('splash', this.pos);
    }

    if (water) {
      const head = this.pos.y + this.height * HEAD_FRAC;
      const sy = this._waterSurfaceY;
      this.submerged = isFinite(sy) ? head < sy : true;
      if (this.submerged && this._ambT <= 0) {
        this._ambT = 0.55;
        this._fxBurst('bubbles', this.pos);
      }
    } else {
      this.submerged = false;
    }

    /* ---- quicksand ---------------------------------------------------- */
    this._inQuicksand = !!(res && res.inQuicksand);
    if (this._inQuicksand) {
      const q = res.quicksand;
      const sink = (q && q.props && isFinite(q.props.sink)) ? q.props.sink : QUICKSAND_SINK;
      if (this.vel.y > -sink) this.vel.y = Math.max(this.vel.y - sink * dt * 4, -sink);
      if (this._ambT <= 0) { this._ambT = 0.25; this._fxBurst('sandPuff', this.pos); }
    } else if (this._qsMash > 0 && this.grounded) {
      this._qsMash = 0;
    }

    /* ---- wind --------------------------------------------------------- */
    const wind = res ? res.wind : null;
    if (wind && wind.props) {
      readVec(wind.props.dir, _dir, 0, 1, 0);
      const power = isFinite(wind.props.power) ? wind.props.power : 8;
      const l = _dir.length();
      if (l > 1e-6) {
        _dir.multiplyScalar(power / l);
        this.vel.x += _dir.x * dt;
        this.vel.y += _dir.y * dt;
        this.vel.z += _dir.z * dt;
      }
      if (this._ambT <= 0) { this._ambT = 0.4; this._sfx('wind', 0.35); }
    }

    /* ---- current (swim push) ------------------------------------------ */
    const cur = res ? res.current : null;
    if (cur && cur.props && this.inWater) {
      readVec(cur.props.dir, _dir, 0, 0, -1);
      const power = isFinite(cur.props.power) ? cur.props.power : 4;
      const l = _dir.length();
      if (l > 1e-6) {
        _dir.multiplyScalar(power / l);
        this.vel.x += _dir.x * dt * 3;
        this.vel.y += _dir.y * dt * 3;
        this.vel.z += _dir.z * dt * 3;
      }
    }

    /* ---- ladder ------------------------------------------------------- */
    const lad = res ? res.ladder : null;
    if (lad && this.state !== 'climbKick' && !this.inWater) {
      /* Grab when airborne, or when pushing into it from the ground. */
      const pushing = this._wmag > 0.3;
      if (this.state === 'climb') this._climbVol = lad;
      else if (!this.grounded || pushing) this._startClimb(lad);
    } else if (this.state === 'climb') {
      this._endClimb();
    }

    /* ---- checkpoints / triggers / rings -------------------------------- */
    const vols = res ? res.volumes : null;
    if (vols && vols.length) {
      for (let i = 0; i < vols.length; i++) {
        const v = vols[i];
        if (!v) continue;
        const p = v.props || null;
        if (v.kind === 'checkpoint') {
          const idx = p && isFinite(p.index) ? (p.index | 0) : 0;
          if (idx !== this._lastCp) {
            this._lastCp = idx;
            this._ev('checkpoint', idx);
            this._ev('collect', 'checkpoint', idx);
          }
        } else if (v.kind === 'trigger') {
          const id = p ? (p.id !== undefined ? p.id : p.trigger) : undefined;
          if (p && (p.ring === true || p.kind === 'ring')) {
            if (this._ringSeen !== v.id) { this._ringSeen = v.id; this._ev('ringPass', id, this.pos); }
          } else if (id !== undefined && id !== this._triggerSeen) {
            this._triggerSeen = id;
            this._ev('collect', p && p.power ? 'power' : 'trigger', id);
          }
        }
      }
    }
  }

  /* =========================================================================
   * Hazards
   * ====================================================================== */
  _resolveKillY() {
    if (typeof this.killYOverride === 'number' && isFinite(this.killYOverride)) {
      this.killY = this.killYOverride;
      return;
    }
    const w = this.world;
    let ky = null;
    if (w) {
      if (typeof w.killY === 'number') ky = w.killY;
      else if (w.def && typeof w.def.killY === 'number') ky = w.def.killY;
      else if (w.course && w.course.def && typeof w.course.def.killY === 'number') ky = w.course.def.killY;
    }
    this.killY = (ky === null || !isFinite(ky)) ? -1e5 : ky;
  }

  _killTests(res) {
    if (this.dead) return;
    if (res && res.crushed) { this.kill('crush'); return; }
    if (this.pos.y < this.killY) { this.kill('void'); return; }
    const kv = res ? res.kill : null;
    if (kv) this.kill(kv.kind || res.killKind || 'lava');
  }

  /* =========================================================================
   * Footsteps
   * ====================================================================== */
  _footsteps(moved) {
    const st = this.state;
    if (st === 'slide' || st === 'slopeSlide' || st === 'poundLand' || st === 'hardLand') { this._stepDist = 0; return; }
    if (this.speed <= 0.6) { this._stepDist *= 0.9; return; }
    this._stepDist += moved;
    let need = lerp(STEP_WALK, STEP_RUN, clamp(this.speed / TUNE.speedRun, 0, 1));
    if (this.crouching) need *= STEP_CROUCH_MUL;
    if (this._stepDist >= need) {
      this._stepDist -= need;
      this.stats.steps++;
      this._ev('step', this.surface, this.pos, this.speed);
      this._sfx(stepSample(this.surface));
    }
  }

  /* =========================================================================
   * State machine plumbing
   * ====================================================================== */

  _setState(name) {
    if (this.state === name) return;
    this.state = name;
    this.stateT = 0;
    this.anim = name;
    this.animT = 0;
    this.sliding = name === 'slide' || name === 'slopeSlide';
    if (name === 'jump1' || name === 'jump2' || name === 'jump3' ||
      name === 'longjump' || name === 'backflip' || name === 'sideflip' ||
      name === 'wallkick' || name === 'dive') {
      this._launchSpeed = hyp2(this.vel.x, this.vel.z);
    }
  }

  /**
   * Late resolution — the states that are a CONSEQUENCE of the physics rather
   * than of a button: idle/run/skid on the ground, fall in the air.
   */
  _postState() {
    const st = this.state;
    if (this.dead || st === 'cannon' || st === 'climb' || this.inWater) return;

    if (this.grounded) {
      if (st === 'idle' || st === 'run' || st === 'skid' || st === 'crouch' || st === 'crouchwalk') {
        if (this.crouching) this._setState(this._wmag > 0 && this.speed > 0.4 ? 'crouchwalk' : 'crouch');
        else if (this._wmag > 0) this._setState('run');
        else this._setState(this.speed > SKID_SPEED ? 'skid' : 'idle');
      } else if (st === 'fall' || st === 'jump1' || st === 'jump2' || st === 'jump3' ||
        st === 'wallslide' || st === 'wallkick' || st === 'longjump' ||
        st === 'backflip' || st === 'sideflip' || st === 'fly' || st === 'climbKick') {
        /* Reached the ground without _onLand seeing it (a snap): normalise. */
        this._setState(this._wmag > 0 ? 'run' : 'idle');
      }
    } else {
      /* jump3 keeps its somersault for the whole arc; jump1/2 tuck then fall. */
      if ((st === 'jump1' || st === 'jump2') && this.vel.y <= 0) this._setState('fall');
      else if ((st === 'backflip' || st === 'sideflip') && this.vel.y <= 0 && this.stateT > 0.25) this._setState('fall');
      else if (st === 'idle' || st === 'run' || st === 'skid' || st === 'pivot' ||
        st === 'crouch' || st === 'crouchwalk' || st === 'land' || st === 'slideRecover') {
        this._setState('fall');
      }
    }
    this.anim = this.state;
    this.animT = this.stateT;
  }

  /** Harness override — real moves fire for real; anything else is set flat. */
  _force(name) {
    switch (name) {
      case 'jump1': this.jumpCount = 0; this._chainT = 0; this._doJump(); return;
      case 'jump2': this.jumpCount = 1; this._chainT = TUNE.tripleWindow; this.speed = Math.max(this.speed, TUNE.tripleMinSpeed); this._doJump(); return;
      case 'jump3': this.jumpCount = 2; this._chainT = TUNE.tripleWindow; this.speed = Math.max(this.speed, TUNE.tripleMinSpeed); this._doJump(); return;
      case 'longjump': this._doLongJump(); return;
      case 'backflip': this._doBackflip(); return;
      case 'sideflip': this._doSideflip(); return;
      case 'dive': this._doDive(); return;
      case 'poundHang': this._doPound(); return;
      case 'wallkick': this._doWallKick(); return;
      case 'dead': this.kill('forced'); return;
      default:
        if (STATES.indexOf(name) >= 0) this._setState(name);
    }
  }

  /* =========================================================================
   * Published presentation channels (hero.js / camera.js / HUD)
   * ====================================================================== */
  _publish(dt) {
    this.animT = this.stateT;
    this.anim = this.state;
    this.speed = hyp2(this.vel.x, this.vel.z);
    this.speedNorm = clamp(this.speed / TUNE.speedRun, 0, 1);

    /* Turn lean: how fast the hero is rotating, scaled by how fast they move.
       Positive = leaning into a left turn (+yaw). */
    let lean = 0;
    if (dt > 0) {
      const d = shortestAngle(this._leanPrevFacing === undefined ? this.facing : this._leanPrevFacing, this.facing);
      lean = clamp((d / dt) / TUNE.turnRateSlow, -1, 1) * this.speedNorm;
    }
    this._leanPrevFacing = this.facing;
    const k = 1 - Math.exp(-LEAN_LAMBDA * Math.max(dt, 1e-4));
    this.leanX += (lean - this.leanX) * k;
    if (Math.abs(this.leanX) < 1e-4) this.leanX = 0;
  }

  /** One history sample: {x, y, z, facing}. SLOT mode — copies, never allocates. */
  _pushHistory() {
    const s = this.history.slot();
    if (s) {
      s.x = this.pos.x; s.y = this.pos.y; s.z = this.pos.z; s.facing = this.facing;
      this.history.commit();
    }
  }

  _snapshot() {
    const s = this._snap;
    s.pos.x = this.pos.x; s.pos.y = this.pos.y; s.pos.z = this.pos.z;
    s.vel.x = this.vel.x; s.vel.y = this.vel.y; s.vel.z = this.vel.z;
    s.state = this.state;
    s.anim = this.anim;
    s.grounded = this.grounded;
    s.jumpCount = this.jumpCount;
    s.speed = this.speed;
    s.facing = this.facing;
    s.inWater = !!this.inWater;
    s.sliding = this.sliding;
    return s;
  }

  /* =========================================================================
   * Rotating platforms
   *
   * There is no angular-velocity field in the Collider contract, so derive it
   * from two `velocityAt` samples: for a pure spin about Y,
   * v(p + x·d) − v(p) == (0, 0, −ωy·d).
   * ====================================================================== */
  _platformYawRate(col) {
    if (!col) return 0;
    const av = col.angularVelocity || (col.ref && col.ref.angularVelocity);
    if (av && typeof av.y === 'number' && isFinite(av.y)) return av.y;
    if (typeof col.angVelY === 'number' && isFinite(col.angVelY)) return col.angVelY;
    if (col.ref && typeof col.ref.angVelY === 'number' && isFinite(col.ref.angVelY)) return col.ref.angVelY;
    if (typeof col.velocityAt !== 'function') return 0;

    const p = this.pos;
    const d = 0.5;
    let ra, rb;
    try {
      ra = col.velocityAt(_pa.set(p.x, p.y, p.z), _va) || _va;
      rb = col.velocityAt(_pb.set(p.x + d, p.y, p.z), _vb) || _vb;
    } catch (err) { return 0; }
    if (!ra || !rb || typeof ra.z !== 'number' || typeof rb.z !== 'number') return 0;

    const dvx = rb.x - ra.x;
    const dvz = rb.z - ra.z;
    if (!isFinite(dvx) || !isFinite(dvz)) return 0;
    if (Math.abs(dvx) > Math.abs(dvz) * 0.35 + 0.02) return 0;
    const wy = -dvz / d;
    if (!isFinite(wy) || Math.abs(wy) < 1e-3) return 0;
    return wy > 12 ? 12 : (wy < -12 ? -12 : wy);
  }

  /* =========================================================================
   * Events / audio / fx plumbing — none of it may ever break movement
   * ====================================================================== */

  _ev(name, a, b, c) {
    const e = this.events;
    if (!e || typeof e.emit !== 'function') return;
    try { e.emit(name, a, b, c); } catch (err) { /* a listener threw; the sim goes on */ }
  }

  _hasListener(name) {
    const e = this.events;
    if (!e || typeof e.has !== 'function') return false;
    try { return !!e.has(name); } catch (err) { return false; }
  }

  /** `gain` variant — audio.js reads an OPTIONS OBJECT, never a bare number. */
  _sfx(name, gain) {
    if (!this.autoAudio) return;
    const a = this.audio;
    if (!a || typeof a.sfx !== 'function') return;
    try {
      if (gain === undefined) a.sfx(name);
      else { _sfxOpt.gain = gain; _sfxOpt.impact = 0; _sfxOpt.power = 0; _sfxOpt.rate = 1; a.sfx(name, _sfxOpt); }
    } catch (err) { /* audio must never break movement */ }
  }

  _sfxOpts(name, opts) {
    if (!this.autoAudio) return;
    const a = this.audio;
    if (!a || typeof a.sfx !== 'function') return;
    try { a.sfx(name, opts); } catch (err) { /* noop */ }
  }

  _fxBurst(preset, pos, opts) {
    const f = this.fx;
    if (!f) return;
    try {
      if (typeof f.burst === 'function') { f.burst(preset, pos, opts); return; }
      const ps = f.particles || f.ps;
      if (ps && typeof ps.burst === 'function') ps.burst(preset, pos, opts);
    } catch (err) { /* fx must never break movement */ }
  }
}

/* The launch-speed cache is declared on the prototype so it always exists even
   before the first launch (the air cap reads it every airborne substep). */
Player.prototype._launchSpeed = 0;
Player.prototype._inQuicksand = false;
Player.prototype._waterSurfaceY = NaN;
Player.prototype._lastRes = null;
Player.prototype._cannonPitch = 0.6;
Player.prototype._leanPrevFacing = undefined;

export default Player;
