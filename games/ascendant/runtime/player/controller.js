// ============================================================================
//  ASCENDANT — runtime/player/controller.js
//  THE MOVEMENT CONTROLLER. Everything the game feels like lives in this file.
//
//  Design notes that other modules must honour:
//    * `pos` is the FEET of the collision capsule (the capsule spans
//      [pos.y, pos.y + height]). `eye` / `crouchEye` in TUNE are heights above
//      the feet, which is why crouching "shrinks from the top".
//    * The simulation runs on a FIXED 1/120 s substep. Feel is byte-identical
//      at 30 fps and 240 fps. `renderPos` is the interpolated, render-facing
//      position — cameras and viewmodels must read `renderPos` / `eyePos`,
//      never `pos`.
//    * `yaw` / `pitch` are owned here. FPCamera calls `addLook(dx, dy)`.
//    * No per-frame heap allocation in the sim path. Every scratch vector is
//      hoisted to module scope.
// ============================================================================

import * as THREE from 'three';
import { TUNE } from '../core/tuning.js';
import { moveAndCollide, capsuleFor } from './collide.js';
import { Emitter } from '../core/util.js';

// ---------------------------------------------------------------------------
//  Simulation constants (things that are NOT global tuning knobs)
// ---------------------------------------------------------------------------
const FIXED = 1 / 120;            // fixed simulation substep
const MAX_SUBSTEPS = 10;          // spiral-of-death guard
const MAX_FRAME_DT = 0.25;

const STOP_SPEED = 4.0;           // friction floor -> full stop in ~0.136 s
const STICKY_FRICTION_MUL = 2.2;

const AIR_LOCK_TIME = 0.22;       // reduced air control window after a wall jump
const AIR_LOCK_MIN = 0.26;        // air accel multiplier at the start of the lock

const WALL_MEM = 0.12;            // how long a wall contact is remembered (jump)
const WALL_FRESH = 0.09;          // remembered-contact age that still counts as "on the wall"
const WALL_MAX_NY = 0.40;         // |normal.y| below this == near-vertical wall
const WALL_INTO_DOT = 0.20;       // how hard you must hold into the wall to stick
const WALL_AIM_ASSIST = 1.8;      // wish-direction blend added to a wall jump
const WALL_SCRAPE_EVERY = 0.07;

const NO_GROUND_AFTER_JUMP = 0.055; // ignore `grounded` briefly so nothing re-snaps us
const LAUNCH_TIME = 0.25;         // moving-platform launch window
const LAUNCH_KEEP = 0.70;         // ...keeps 70% of the mover's horizontal velocity

const SPEEDPAD_CD = 0.35;
const BOUNCE_CD = 0.06;
const BOUNCE_HELD_BONUS = 1.25;   // held jump on the contact frame = +25% apex
const BOUNCE_DEFAULT_POWER = 2.5;

const STEP_WALK = 2.1;            // metres per footstep
const STEP_SPRINT = 1.6;
const STEP_CROUCH_MUL = 1.35;

const SPRINT_RAMP = 0.18;         // seconds run -> sprint
const SPRINT_FWD_MIN = 0.30;      // forward-ish input required to sprint

const PITCH_LIMIT = 1.5533;       // +/- 89 deg
const EYE_LAMBDA = 16;            // eye-height smoothing
const STAND_GUARD = 0.10;         // re-crouch window if we stood into a ceiling

const FOOT_LIFT = Math.max(0, TUNE.height - TUNE.crouchHeight); // crouch-jump tuck

const CLEAR_INSET_R = 0.92;       // shrink factor for the standing-clearance probe
const CLEAR_INSET_Y = 0.03;

// ---------------------------------------------------------------------------
//  Module scratch — NOTHING in the sim path allocates.
// ---------------------------------------------------------------------------
const _carry = new THREE.Vector3();
const _carryPrev = new THREE.Vector3();
const _launchV = new THREE.Vector3();
const _wallN = new THREE.Vector3();
const _lastWallN = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _box = new THREE.Box3();
const _fwd = new THREE.Vector3();
const _query = [];
const _capsuleOut = {};

// Fallback collision result, used only when no broadphase world is attached
// (harness / bootstrap). Reused — never reallocated.
const _fbRes = {
  grounded: false,
  groundNormal: new THREE.Vector3(0, 1, 0),
  groundCollider: null,
  ceiling: false,
  walls: [],
  platformVel: new THREE.Vector3(),
  surface: 'normal',
  surfaceProps: null,
  stepped: false,
  crushed: false,
  hitVel: 0,
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/**
 * Quake-style directional acceleration. Projects the current velocity onto the
 * wish direction and only adds the DEFICIT, which is what makes strafing feel
 * crisp instead of tank-like: turning does not fight your existing speed, it
 * simply stops adding once you already move that fast in that direction.
 *
 * `bonus` re-adds the speed friction just removed along the wish axis, so the
 * steady-state ground speed is exactly `wishSpeed` instead of the lower
 * friction/accel fixed point.
 */
function accelerateXZ(vel, wx, wz, wishSpeed, accel, dt, bonus) {
  if (wishSpeed <= 0) return;
  const cur = vel.x * wx + vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * dt + (bonus > 0 ? bonus : 0);
  if (a > add) a = add;
  vel.x += a * wx;
  vel.z += a * wz;
}

/**
 * Ground friction with a stop-speed floor. Returns the scale factor applied to
 * the horizontal velocity so the caller can compensate the accelerate step.
 */
function frictionXZ(vel, friction, dt) {
  const sp = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (sp < 1e-5) { vel.x = 0; vel.z = 0; return 1; }
  const control = sp < STOP_SPEED ? STOP_SPEED : sp;
  let ns = sp - control * friction * dt;
  if (ns < 0) ns = 0;
  const scale = ns / sp;
  vel.x *= scale;
  vel.z *= scale;
  return scale;
}

/** Accepts Vector3 | [x,y,z] | {x,y,z} and writes into `out`. */
function readVec(v, out, dx, dy, dz) {
  if (!v) { out.set(dx || 0, dy || 0, dz || 0); return out; }
  if (Array.isArray(v)) { out.set(v[0] || 0, v[1] || 0, v[2] || 0); return out; }
  if (typeof v.x === 'number') { out.set(v.x, v.y || 0, v.z || 0); return out; }
  out.set(dx || 0, dy || 0, dz || 0);
  return out;
}

// `capsuleFor` is owned by collide.js. Two calling conventions are plausible
// across a parallel build — detect once from arity, verify by execution.
let _capMode = 0; // 0 unknown | 1 = (state, out) | 2 = (pos, radius, height, out)
function playerCapsule(state) {
  if (typeof capsuleFor !== 'function') return null;
  if (_capMode === 0) _capMode = capsuleFor.length >= 3 ? 2 : 1;
  if (_capMode === 2) {
    try { return capsuleFor(state.pos, state.radius, state.height, _capsuleOut); }
    catch (err) { _capMode = 1; }
  }
  try { return capsuleFor(state, _capsuleOut); }
  catch (err) {
    _capMode = 2;
    try { return capsuleFor(state.pos, state.radius, state.height, _capsuleOut); }
    catch (err2) { return null; }
  }
}

// ===========================================================================
//  Player
// ===========================================================================
export class Player {
  /**
   * @param {object} world  anything exposing {broadphase, killVolumes} — the
   *                        Stage. May be null at construction; call setWorld().
   * @param {object} input  core/input.js Input
   * @param {object} audio  core/audio.js Audio
   * @param {object} fx     fx/impacts.js Impacts (or ParticleSystem)
   */
  constructor(world, input, audio, fx) {
    this.world = world || null;
    this.input = input || null;
    this.audio = audio || null;
    this.fx = fx || null;

    this.events = new Emitter();

    // ---- transform -------------------------------------------------------
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.renderPos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    // ---- capsule ---------------------------------------------------------
    this.radius = TUNE.radius;
    this.height = TUNE.height;
    this._tuck = 0;               // crouch-jump foot lift currently applied
    this._eyeH = TUNE.eye;        // smoothed eye height above `pos`

    // ---- movement state --------------------------------------------------
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundCollider = null;
    this.surface = 'normal';
    this.surfaceProps = null;
    this.sprinting = false;
    this.sprintBlend = 0;
    this.crouching = false;
    this.wallSliding = false;
    this.wallNormal = new THREE.Vector3();
    this.dead = false;
    this.deadT = 0;
    this.deathCause = null;

    this.coyoteT = 0;
    this.bufferT = 0;

    this.wishX = 0;
    this.wishZ = 0;
    this.wishLen = 0;
    this.moveSpeedTarget = TUNE.speedRun;
    this.speed = 0;               // horizontal speed, for the HUD
    this.speed3 = 0;              // full speed including vertical
    this.airTime = 0;
    this.lastLandImpact = 0;
    this.lastJumpKind = null;

    // ---- internal timers -------------------------------------------------
    this._acc = 0;
    this._wallT = 0;
    this._airLockT = 0;
    this._noGroundT = 0;
    this._speedCD = 0;
    this._bounceCD = 0;
    this._launchT = 0;
    this._scrapeT = 0;
    this._standT = 0;
    this._stepDist = 0;
    this._extLookT = 0;

    this._wallRef = null;
    this._lastWallJumpRef = null;
    this._lastWallJumpValid = false;
    this._speedRef = null;
    this._cutArmed = false;
    this._bounceRise = false;
    this._skipGravHalf = false;
    this._jumpedThisStep = false;
    this._jumpHeld = false;
    this._jumpReleasedLatch = false;

    this._wind = new THREE.Vector3();
    this._impulse = new THREE.Vector3();
    this._eyePos = new THREE.Vector3();

    // ---- integration switches other modules may flip ---------------------
    /** Set false if collide.js already translates the player by platformVel. */
    this.applyPlatformCarry = true;
    /** Set false if the Game wires all audio off `events` instead. */
    this.autoAudio = true;
    /** Set false to make FPCamera the only source of look input. */
    this.consumeLook = true;
    /** Optional hard override of the void plane. */
    this.killYOverride = null;
    this.killY = -1e5;

    // ---- persistent collide state (never reallocated) --------------------
    this._cs = {
      pos: this.pos,
      vel: this.vel,
      radius: this.radius,
      height: this.height,
      crouching: false,
      grounded: false,
      stepUp: TUNE.stepUp,
      wantSnap: true,
      justJumped: false,
      yaw: 0,
    };

    this.stats = {
      airTime: 0,
      maxAirTime: 0,
      maxSpeed: 0,
      jumps: 0,
      wallJumps: 0,
      distance: 0,
      deaths: 0,
      steps: 0,
    };

    // ---- dev harness hook ------------------------------------------------
    const self = this;
    this.__test = {
      teleport(v) {
        readVec(v, self.pos, self.pos.x, self.pos.y, self.pos.z);
        self.prevPos.copy(self.pos);
        self.renderPos.copy(self.pos);
        self._acc = 0;
      },
      setVel(v) { readVec(v, self.vel, 0, 0, 0); },
      forceJump() {
        self.bufferT = TUNE.buffer;
        self.coyoteT = Math.max(self.coyoteT, TUNE.coyote);
      },
      state() {
        return {
          pos: { x: self.pos.x, y: self.pos.y, z: self.pos.z },
          vel: { x: self.vel.x, y: self.vel.y, z: self.vel.z },
          renderPos: { x: self.renderPos.x, y: self.renderPos.y, z: self.renderPos.z },
          grounded: self.grounded, crouching: self.crouching, sprinting: self.sprinting,
          sprintBlend: self.sprintBlend, wallSliding: self.wallSliding, dead: self.dead,
          coyoteT: self.coyoteT, bufferT: self.bufferT, airLockT: self._airLockT,
          height: self.height, tuck: self._tuck, eyeH: self._eyeH,
          surface: self.surface, speed: self.speed, yaw: self.yaw, pitch: self.pitch,
          stats: {
            airTime: self.stats.airTime, maxAirTime: self.stats.maxAirTime,
            maxSpeed: self.stats.maxSpeed, jumps: self.stats.jumps,
            wallJumps: self.stats.wallJumps, distance: self.stats.distance,
            deaths: self.stats.deaths, steps: self.stats.steps,
          },
        };
      },
      step(dt) { self._step(dt); },
      fixedStep: FIXED,
    };
  }

  // -------------------------------------------------------------------------
  //  Lifecycle
  // -------------------------------------------------------------------------

  /** Swap the collision world when a stage loads. */
  setWorld(world) {
    this.world = world || null;
    this.groundCollider = null;
    this._wallRef = null;
    this._lastWallJumpRef = null;
    this._lastWallJumpValid = false;
    this._speedRef = null;
  }

  /** Initial placement — also clears the run statistics. */
  spawn(pos, yaw) {
    this._place(pos, yaw);
    this.stats.airTime = 0;
    this.stats.maxAirTime = 0;
    this.stats.maxSpeed = 0;
    this.stats.jumps = 0;
    this.stats.wallJumps = 0;
    this.stats.distance = 0;
    this.stats.deaths = 0;
    this.stats.steps = 0;
  }

  /** Post-death placement. Keeps lifetime run stats. */
  respawn(pos, yaw) {
    this._place(pos, yaw);
  }

  _place(pos, yaw) {
    if (pos !== undefined && pos !== null) {
      readVec(pos, this.pos, this.pos.x, this.pos.y, this.pos.z);
    }
    if (typeof yaw === 'number' && isFinite(yaw)) this.yaw = yaw;
    this.pitch = 0;

    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);

    this.vel.set(0, 0, 0);
    this._wind.set(0, 0, 0);
    this._impulse.set(0, 0, 0);
    _carryPrev.set(0, 0, 0);
    _launchV.set(0, 0, 0);

    this.dead = false;
    this.deadT = 0;
    this.deathCause = null;

    this.grounded = false;
    this.groundNormal.set(0, 1, 0);
    this.groundCollider = null;
    this.surface = 'normal';
    this.surfaceProps = null;

    this.crouching = false;
    this.height = TUNE.height;
    this.radius = TUNE.radius;
    this._tuck = 0;
    this._eyeH = TUNE.eye;

    this.sprinting = false;
    this.sprintBlend = 0;

    this.wallSliding = false;
    this.wallNormal.set(0, 0, 0);
    this._wallRef = null;
    this._wallT = 0;
    this._lastWallJumpRef = null;
    this._lastWallJumpValid = false;
    _lastWallN.set(0, 0, 0);

    this.coyoteT = 0;
    this.bufferT = 0;
    this._acc = 0;
    this._airLockT = 0;
    this._noGroundT = 0;
    this._speedCD = 0;
    this._speedRef = null;
    this._bounceCD = 0;
    this._launchT = 0;
    this._scrapeT = 0;
    this._standT = 0;
    this._stepDist = 0;
    this._cutArmed = false;
    this._bounceRise = false;
    this._skipGravHalf = false;
    this._jumpedThisStep = false;
    this._jumpHeld = false;
    this._jumpReleasedLatch = false;

    this.airTime = 0;
    this.stats.airTime = 0;
    this.lastLandImpact = 0;
    this.lastJumpKind = null;
    this.speed = 0;
    this.speed3 = 0;

    this._syncCollideState();
  }

  /**
   * Kill the player. Idempotent — a lava volume and a crusher firing on the
   * same substep produce exactly one 'death'.
   */
  kill(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.deathCause = cause || 'manual';
    this.vel.set(0, 0, 0);
    this._wind.set(0, 0, 0);
    this._impulse.set(0, 0, 0);
    _carryPrev.set(0, 0, 0);
    _launchV.set(0, 0, 0);
    this._launchT = 0;
    this.grounded = false;
    this.wallSliding = false;
    this._wallT = 0;
    this.bufferT = 0;
    this.coyoteT = 0;
    this._acc = 0;
    this.stats.deaths++;
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this._ev('death', this.deathCause, this.pos);
    // Presentation is owned by whoever listens to 'death' — the Game routes it
    // to fx/impacts.js (or covers the minimum itself when Impacts is absent).
    // 'death' is CRITICAL in core/audio.js, so the 18 ms anti-machinegun floor
    // never dedupes a second copy: firing it here as well doubled the death
    // sound and the death burst on every single death. The local fallback runs
    // only when nothing at all is wired to the event (standalone harness).
    if (!this._hasListener('death')) {
      this._sfx('death');
      this._fxDeath(this.deathCause, this.pos);
    }
  }

  dispose() {
    if (this.events && typeof this.events.clear === 'function') {
      try { this.events.clear(); } catch (err) { /* optional API */ }
    }
    this.world = null;
    this.groundCollider = null;
    this._wallRef = null;
    this._speedRef = null;
    this._lastWallJumpRef = null;
  }

  // -------------------------------------------------------------------------
  //  Look — the player owns yaw/pitch; FPCamera drives it through addLook().
  // -------------------------------------------------------------------------
  addLook(dx, dy) {
    this._extLookT = 0.5;
    if (this.dead) return;
    this._applyLook(dx, dy);
  }

  _applyLook(dx, dy) {
    if (!isFinite(dx) || !isFinite(dy)) return;
    this.yaw -= dx;
    this.pitch -= dy;
    if (this.pitch > PITCH_LIMIT) this.pitch = PITCH_LIMIT;
    else if (this.pitch < -PITCH_LIMIT) this.pitch = -PITCH_LIMIT;
    // Keep yaw bounded so a long session never loses float precision.
    if (this.yaw > 1e5 || this.yaw < -1e5) this.yaw = this.yaw % (Math.PI * 2);
  }

  setYaw(y) { if (isFinite(y)) this.yaw = y; }
  setPitch(p) {
    if (!isFinite(p)) return;
    this.pitch = p > PITCH_LIMIT ? PITCH_LIMIT : (p < -PITCH_LIMIT ? -PITCH_LIMIT : p);
  }

  // -------------------------------------------------------------------------
  //  External forces (wind volumes, scripted launches)
  // -------------------------------------------------------------------------

  /** Continuous acceleration for this frame (m/s^2). Cleared every update(). */
  addWind(x, y, z) {
    if (this.dead) return;
    if (x !== null && typeof x === 'object') {
      readVec(x, _dir, 0, 0, 0);
      this._wind.add(_dir);
      return;
    }
    this._wind.x += x || 0; this._wind.y += y || 0; this._wind.z += z || 0;
  }

  /** Instantaneous velocity change (m/s), applied on the next substep. */
  addImpulse(x, y, z) {
    if (this.dead) return;
    if (x !== null && typeof x === 'object') {
      readVec(x, _dir, 0, 0, 0);
      this._impulse.add(_dir);
      return;
    }
    this._impulse.x += x || 0; this._impulse.y += y || 0; this._impulse.z += z || 0;
  }

  // -------------------------------------------------------------------------
  //  Read-only views
  // -------------------------------------------------------------------------

  /** Interpolated eye position. SHARED vector — copy it, do not retain it. */
  get eyePos() {
    this._eyePos.set(this.renderPos.x, this.renderPos.y + this._eyeH, this.renderPos.z);
    return this._eyePos;
  }

  /** Horizontal forward vector from yaw. SHARED vector — copy it. */
  get forward() {
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return _fwd;
  }

  get eyeHeight() { return this._eyeH; }
  get capsuleHeight() { return this.height; }
  get onGround() { return this.grounded; }

  // =========================================================================
  //  update — fixed-step driver
  //
  //  The simulation ALWAYS advances in 1/120 s slices, so the feel is
  //  identical at 30 fps and 240 fps. What the renderer sees is the
  //  interpolated `renderPos`, which is why the camera never stutters even
  //  when the frame time and the substep do not divide evenly.
  // =========================================================================
  update(dt) {
    if (!isFinite(dt) || dt <= 0) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;

    const inp = this.input;
    const active = !!inp && !inp.suspended && !this.dead;

    // --- look ------------------------------------------------------------
    if (this._extLookT > 0) this._extLookT -= dt;
    if (active && this.consumeLook && this._extLookT <= 0 && inp.look) {
      const lx = inp.look.dx || 0;
      const ly = inp.look.dy || 0;
      if (lx !== 0 || ly !== 0) this._applyLook(lx, ly);
    }

    // --- latch per-frame input edges into the substep sim -----------------
    if (active) {
      if (inp.jumpPressed) this.bufferT = TUNE.buffer;
      if (inp.jumpReleased) this._jumpReleasedLatch = true;
      this._jumpHeld = !!inp.jump;
    } else {
      this._jumpHeld = false;
      if (this.dead) this._jumpReleasedLatch = false;
    }

    // --- resolve the void plane once per frame ---------------------------
    this._resolveKillY();

    if (this.dead) {
      this.deadT += dt;
      this.prevPos.copy(this.pos);
      this.renderPos.copy(this.pos);
      this._wind.set(0, 0, 0);
      this._impulse.set(0, 0, 0);
      this._updateEye(dt);
      return;
    }

    // --- fixed substeps ---------------------------------------------------
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

    // --- render interpolation --------------------------------------------
    let alpha = this._acc / FIXED;
    if (alpha < 0) alpha = 0;
    else if (alpha > 1) alpha = 1;
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);

    this._updateEye(dt);

    // per-frame accumulators are consumed by the substeps above
    this._wind.set(0, 0, 0);
    this._impulse.set(0, 0, 0);
  }

  // =========================================================================
  //  _step — ONE 1/120 s slice of the simulation
  // =========================================================================
  _step(dt) {
    const T = TUNE;
    const vel = this.vel;
    const pos = this.pos;
    const inp = this.input;

    const wasGrounded = this.grounded;
    const wasY = pos.y;
    const wasX = pos.x;
    const wasZ = pos.z;
    this._jumpedThisStep = false;

    // ---- 1. timers -------------------------------------------------------
    if (this.coyoteT > 0) this.coyoteT -= dt;
    if (this.bufferT > 0) this.bufferT -= dt;
    if (this._wallT > 0) this._wallT -= dt;
    if (this._airLockT > 0) this._airLockT -= dt;
    if (this._noGroundT > 0) this._noGroundT -= dt;
    if (this._speedCD > 0) this._speedCD -= dt;
    if (this._bounceCD > 0) this._bounceCD -= dt;
    if (this._launchT > 0) this._launchT -= dt;
    if (this._scrapeT > 0) this._scrapeT -= dt;
    if (this._standT > 0) this._standT -= dt;

    // ---- 2. input --------------------------------------------------------
    let mx = 0, my = 0, sprintHeld = false, crouchHeld = false;
    if (inp && !inp.suspended) {
      const mv = inp.move;
      if (mv) { mx = mv.x || 0; my = mv.y || 0; }
      sprintHeld = !!inp.sprint;
      crouchHeld = !!inp.crouch;
    }
    let wl = Math.sqrt(mx * mx + my * my);
    if (wl > 1) { mx /= wl; my /= wl; wl = 1; }
    if (wl < 1e-4) { mx = 0; my = 0; wl = 0; }

    // wish direction in world space (yaw 0 faces -Z, +X is right)
    let wx = 0, wz = 0;
    if (wl > 0) {
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      wx = cy * mx - sy * my;
      wz = -sy * mx - cy * my;
      const l = Math.sqrt(wx * wx + wz * wz);
      if (l > 1e-6) { wx /= l; wz /= l; } else { wx = 0; wz = 0; }
    }
    this.wishX = wx; this.wishZ = wz; this.wishLen = wl;

    // ---- 3. stance (crouch / crouch-jump tuck) ---------------------------
    this._resolveStance(crouchHeld);

    // ---- 4. sprint blend -------------------------------------------------
    const wantSprint = sprintHeld && !this.crouching && my > SPRINT_FWD_MIN && wl > 0.35;
    const sprintStep = dt / SPRINT_RAMP;
    if (wantSprint) {
      this.sprintBlend += sprintStep;
      if (this.sprintBlend > 1) this.sprintBlend = 1;
    } else {
      this.sprintBlend -= sprintStep;
      if (this.sprintBlend < 0) this.sprintBlend = 0;
    }
    this.sprinting = this.sprintBlend > 0.5;

    const runTarget = T.speedRun + (T.speedSprint - T.speedRun) * this.sprintBlend;
    // Crouching only slows you on the ground: a crouch-jump is a tuck, not a
    // slow-walk, so mid-air steering keeps full authority.
    const baseTarget = (this.crouching && this.grounded) ? T.speedCrouch : runTarget;
    this.moveSpeedTarget = baseTarget;
    const wishSpeed = baseTarget * wl;

    // ---- 5. surface parameters ------------------------------------------
    const surf = this.surface;
    let sAccel = T.accelGround;
    let sFriction = T.friction;
    if (surf === 'ice') {
      sAccel = T.iceAccel;        // 26 — you drift...
      sFriction = T.iceFriction;  // 1.4 — ...but you never lose authority
    } else if (surf === 'sticky') {
      sFriction = T.friction * STICKY_FRICTION_MUL;
    }

    // ---- 6. wall-slide evaluation (from the previous substep's contacts) --
    this._evalWallSlide(wx, wz, wl, dt);

    // ---- 7. jump ---------------------------------------------------------
    if (this.bufferT > 0) {
      if (this.grounded || this.coyoteT > 0) {
        this._doJump(this.grounded ? 'ground' : 'coyote');
      } else if (this._canWallJump()) {
        this._doWallJump(wx, wz, wl);
      }
    }

    // ---- 8. variable jump height ----------------------------------------
    if (this._jumpReleasedLatch) {
      if (this._cutArmed && vel.y > 0 && !this._bounceRise) {
        vel.y *= T.jumpCut;
        this._cutArmed = false;
      }
      this._jumpReleasedLatch = false;
    }
    if (vel.y <= 0) {
      this._cutArmed = false;
      this._bounceRise = false;
    }

    // ---- 9. impulses -----------------------------------------------------
    if (this._impulse.x !== 0 || this._impulse.y !== 0 || this._impulse.z !== 0) {
      vel.add(this._impulse);
      this._impulse.set(0, 0, 0);
      if (vel.y > 0.05) {
        this.grounded = false;
        this._noGroundT = NO_GROUND_AFTER_JUMP;
      }
    }

    // ---- 10. horizontal acceleration ------------------------------------
    if (this.grounded) {
      // Friction runs first; the amount it removed along the wish axis is
      // handed back to accelerate() as `bonus` so the steady-state ground
      // speed is EXACTLY the target instead of a lower fixed point.
      const preAlong = vel.x * wx + vel.z * wz;
      const scale = frictionXZ(vel, sFriction, dt);
      const bonus = preAlong > 0 ? preAlong * (1 - scale) : 0;
      const preSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      accelerateXZ(vel, wx, wz, wishSpeed, sAccel, dt, bonus);
      // Accelerating along the wish axis must never RAISE the total ground
      // speed past the target. Without this, holding into a wall while
      // strafing pumps speed every substep — the wall eats the into-wall
      // component and accelerate keeps re-adding it — and you outrun the
      // authored reach envelope. Speed already carried in from a pad or a
      // bounce is preserved (the cap never drops below what you arrived with).
      const cap = preSpeed > wishSpeed ? preSpeed : wishSpeed;
      const nowSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (nowSpeed > cap && nowSpeed > 1e-6) {
        const k = cap / nowSpeed;
        vel.x *= k; vel.z *= k;
      }
    } else {
      // Air: same projection accelerate. It self-caps — once you already move
      // at `wishSpeed` along the wish axis nothing more is added — so you can
      // steer hard enough to SAVE a jump but you cannot free-accelerate.
      let airAccel = T.accelAir;
      if (this._airLockT > 0) {
        const k = this._airLockT / AIR_LOCK_TIME;
        airAccel *= AIR_LOCK_MIN + (1 - AIR_LOCK_MIN) * (1 - k);
      }
      const airWish = runTarget * wl;   // never the crouch penalty in the air
      const preSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      accelerateXZ(vel, wx, wz, airWish, airAccel, dt, 0);
      // You may STEER freely — redirect all of your speed — but air control
      // can never RAISE the total past speedAirCap. Otherwise strafing against
      // a wall (which eats the into-wall component every substep) pumps speed
      // without limit, since airDrag alone is far too gentle to hold it.
      // Momentum arriving from a pad or a bounce is untouched: the cap never
      // drops below the speed you came in with.
      const capAir = preSpeed > TUNE.speedAirCap ? preSpeed : TUNE.speedAirCap;
      const nowAir = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (nowAir > capAir && nowAir > 1e-6) {
        const k = capAir / nowAir;
        vel.x *= k; vel.z *= k;
      }

      // ZERO air friction below the cap. Above it, airDrag bleeds the excess.
      const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      if (hs > T.speedAirCap) {
        let ns = hs - hs * T.airDrag * dt;
        if (ns < T.speedAirCap) ns = T.speedAirCap;
        const k = ns / hs;
        vel.x *= k; vel.z *= k;
      }
    }

    // ---- 11. wind (volumes / scripted) ----------------------------------
    if (this._wind.x !== 0 || this._wind.y !== 0 || this._wind.z !== 0) {
      vel.x += this._wind.x * dt;
      vel.y += this._wind.y * dt;
      vel.z += this._wind.z * dt;
    }

    // ---- 12. gravity, first half ----------------------------------------
    // Velocity Verlet: half a step of gravity before the sweep and half after.
    // Plain Euler loses v*dt/2 of apex (5 cm at 120 Hz), which would make the
    // published reach envelope a lie. This makes the sampled arc land exactly
    // on the continuous parabola, so jumpV 12.6 really does apex at 2.089 m.
    this._gravity(dt * 0.5);

    // ---- 13. platform carry (POSITION, not velocity) ---------------------
    // Riding a mover must not silently pump your velocity, so the carry is
    // applied to the position and resolved by the collision sweep.
    if (this.applyPlatformCarry) {
      if (this.grounded) {
        pos.x += _carryPrev.x * dt;
        pos.y += _carryPrev.y * dt;
        pos.z += _carryPrev.z * dt;
      } else if (this._launchT > 0) {
        // ...EXCEPT that leaving a mover keeps 70% of its horizontal velocity
        // for 0.25 s, which is how an obby lets a platform launch you.
        const k = this._launchT / LAUNCH_TIME;
        pos.x += _launchV.x * k * dt;
        pos.z += _launchV.z * k * dt;
      }
    }

    // ---- 14. rotating platforms turn the player -------------------------
    if (this.grounded && this.groundCollider) {
      const w = this._platformYawRate(this.groundCollider);
      if (w !== 0) this.yaw += w * dt;
    }

    // ---- 15. sweep + resolve --------------------------------------------
    const preVy = vel.y;
    const res = this._collide(dt);

    // ---- 16. read the result --------------------------------------------
    this._readContacts(res, wasGrounded, preVy, wx, wz, wl, dt);

    // ---- 16b. gravity, second half --------------------------------------
    // Skipped when a contact effect (bounce / upward speed pad) just SET the
    // vertical velocity: that launch has not been integrated yet, so it must
    // enter the next substep with exactly one half-step of gravity ahead of
    // it — the same phase a jump gets — or its apex lands a step short.
    if (this._skipGravHalf) this._skipGravHalf = false;
    else this._gravity(dt * 0.5);

    // ---- 17. hazards -----------------------------------------------------
    this._killTests(res);
    if (this.dead) return;

    // ---- 18. stats + footsteps ------------------------------------------
    const dx = pos.x - wasX;
    const dz = pos.z - wasZ;
    const moved = Math.sqrt(dx * dx + dz * dz);
    this.stats.distance += moved;

    this.speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    this.speed3 = Math.sqrt(this.speed * this.speed + vel.y * vel.y);
    if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;

    if (this.grounded) {
      this.airTime = 0;
      this.stats.airTime = 0;
      if (this.speed > 0.6) {
        this._stepDist += moved;
        let need = STEP_WALK + (STEP_SPRINT - STEP_WALK) * this.sprintBlend;
        if (this.crouching) need *= STEP_CROUCH_MUL;
        if (this._stepDist >= need) {
          this._stepDist -= need;
          this.stats.steps++;
          this._ev('step', this.surface, this.pos, this.speed);
          this._sfx(this._stepSample(this.surface));
        }
      } else {
        this._stepDist *= 0.9;
      }
    } else {
      this.airTime += dt;
      this.stats.airTime = this.airTime;
      if (this.airTime > this.stats.maxAirTime) this.stats.maxAirTime = this.airTime;
    }

    // guard against a NaN leaking in from an external force / bad collider
    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
      pos.set(wasX, wasY, wasZ);
      vel.set(0, 0, 0);
    }
  }

  /**
   * Half (or whole) step of vertical acceleration. Gravity is ASYMMETRIC — a
   * rise at gravRise and a fall at gravFall — which is what kills the floaty
   * hang at the top of a jump. A bounce-pad arc rises at gravFall instead, so
   * its apex is exactly the authored `power`.
   */
  _gravity(h) {
    const T = TUNE;
    const vel = this.vel;
    if (this.wallSliding) {
      vel.y -= T.gravWallSlide * h;
      if (vel.y < -T.wallSlideMax) vel.y = -T.wallSlideMax;
      return;
    }
    const g = vel.y > 0 ? (this._bounceRise ? T.gravFall : T.gravRise) : T.gravFall;
    vel.y -= g * h;
    if (vel.y < -T.terminal) vel.y = -T.terminal;
  }

  // =========================================================================
  //  Collision
  // =========================================================================
  _syncCollideState() {
    const cs = this._cs;
    cs.pos = this.pos;
    cs.vel = this.vel;
    cs.radius = this.radius;
    cs.height = this.height;
    cs.crouching = this.crouching;
    cs.grounded = this.grounded;
    cs.stepUp = TUNE.stepUp;
    // Hints for collide.js: never down-snap us onto the ledge we just left,
    // and never re-snap on the frame we jumped.
    cs.wantSnap = this.grounded && this.vel.y <= 0.01 && this._noGroundT <= 0;
    cs.justJumped = this._jumpedThisStep;
    cs.yaw = this.yaw;
    return cs;
  }

  _collide(dt) {
    const cs = this._syncCollideState();
    const w = this.world;
    if (w && w.broadphase && typeof moveAndCollide === 'function') {
      const res = moveAndCollide(cs, w, dt);
      if (res) return res;
    }
    return this._fallbackCollide(dt);
  }

  /**
   * Minimal flat-ground integrator used when no broadphase world is attached
   * (bootstrap frames and `_harness/feelcheck.mjs`, which can supply just
   * `{groundY}`). Keeps the controller independently testable.
   */
  _fallbackCollide(dt) {
    const pos = this.pos;
    const vel = this.vel;
    const r = _fbRes;
    const w = this.world;
    const gy = (w && typeof w.groundY === 'number') ? w.groundY : null;

    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;

    r.grounded = false;
    r.ceiling = false;
    r.crushed = false;
    r.stepped = false;
    r.hitVel = 0;
    r.surface = 'normal';
    r.surfaceProps = null;
    r.groundCollider = null;
    r.groundNormal.set(0, 1, 0);
    r.platformVel.set(0, 0, 0);
    if (r.walls.length) r.walls.length = 0;

    if (gy !== null && pos.y <= gy && vel.y <= 0) {
      r.hitVel = -vel.y;
      pos.y = gy;
      vel.y = 0;
      r.grounded = true;
    }
    return r;
  }

  // =========================================================================
  //  Contact handling — landing, surfaces, walls, platform carry
  // =========================================================================
  _readContacts(res, wasGrounded, preVy, wx, wz, wl, dt) {
    const T = TUNE;
    const vel = this.vel;

    let grounded = !!(res && res.grounded);
    // Suppress ground for a few ms after a jump so nothing can pin us down on
    // the very frame we left the floor.
    if (this._noGroundT > 0 && vel.y > 0) grounded = false;

    const surface = (res && res.surface) ? res.surface : 'normal';
    const props = (res && res.surfaceProps) ? res.surfaceProps : null;

    this.groundCollider = (res && res.groundCollider) ? res.groundCollider : null;
    if (res && res.groundNormal) {
      this.groundNormal.set(res.groundNormal.x, res.groundNormal.y, res.groundNormal.z);
    } else if (grounded) {
      this.groundNormal.set(0, 1, 0);
    }
    this.surface = grounded ? surface : 'normal';
    this.surfaceProps = grounded ? props : null;

    // ---- wall contacts ---------------------------------------------------
    const walls = (res && res.walls) ? res.walls : null;
    if (walls && walls.length) {
      let best = -2;
      let bestI = -1;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const n = w && w.normal;
        if (!n) continue;
        if (Math.abs(n.y) > WALL_MAX_NY) continue;      // must be near-vertical
        // prefer the wall we are pushing hardest into
        const d = wl > 0 ? -(wx * n.x + wz * n.z) : 0.001;
        if (d > best) { best = d; bestI = i; }
      }
      if (bestI >= 0) {
        const w = walls[bestI];
        const n = w.normal;
        const hl = Math.sqrt(n.x * n.x + n.z * n.z) || 1;
        _wallN.set(n.x / hl, 0, n.z / hl);
        this.wallNormal.copy(_wallN);
        this._wallRef = w.collider || null;
        this._wallT = WALL_MEM;
      }
    }

    // ---- ceiling safety net ---------------------------------------------
    // If we stood up into geometry (a crusher closing over us), duck straight
    // back down. Shrinking the capsule from the top is always legal.
    if (res && res.ceiling) {
      if (!this.crouching && this._standT > 0) {
        this.crouching = true;
        this.height = T.crouchHeight;
      }
      if (vel.y > 0) vel.y = 0;
    }

    // ---- landing ---------------------------------------------------------
    if (grounded && !wasGrounded) {
      const impact = preVy < 0 ? -preVy : 0;
      this.lastLandImpact = impact;
      this.grounded = true;
      this.wallSliding = this._setWallSlide(false);
      this._wallT = 0;
      this._lastWallJumpRef = null;
      this._lastWallJumpValid = false;
      this._airLockT = 0;
      this._bounceRise = false;
      this._launchT = 0;
      this.coyoteT = 0;
      // Landing NEVER touches horizontal velocity — momentum is preserved.
      this._stepDist = (STEP_WALK * 0.55);
      this._ev('land', impact, surface, this.pos);
      // Same ownership rule as 'death': the Game routes 'land' to Impacts,
      // which applies the authored loudness curve AND its LAND_MIN quiet-tick
      // gate. Duplicating the thump + dust ring here double-fired both and
      // bypassed that gate. Local fallback only when nothing is listening.
      if (impact > 0.9 && !this._hasListener('land')) {
        this._sfx('land', { impact: impact });
        this._fxLand(impact, surface, this.pos);
      }
    } else if (grounded) {
      this.grounded = true;
    } else {
      // ---- leaving the ground -------------------------------------------
      if (wasGrounded) {
        // Coyote time only starts when you WALK off — a jump consumes it.
        if (!this._jumpedThisStep) this.coyoteT = T.coyote;
        // Keep up to 70% of the mover's horizontal velocity for 0.25 s.
        if (_carryPrev.x !== 0 || _carryPrev.z !== 0) {
          _launchV.set(_carryPrev.x * LAUNCH_KEEP, 0, _carryPrev.z * LAUNCH_KEEP);
          this._launchT = LAUNCH_TIME;
        }
      }
      this.grounded = false;
    }

    // ---- surface effects (only while actually in contact) ---------------
    if (this.grounded) {
      if (surface === 'bounce' && props !== null && preVy <= 0.01) {
        this._applyBounce(props);
      } else if (surface === 'bounce' && props === null && preVy <= 0.01) {
        this._applyBounce(null);
      } else if (surface === 'speed') {
        this._applySpeedPad(props);
      }
    }

    // ---- carry reference velocity for the NEXT substep -------------------
    _carry.set(0, 0, 0);
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
          const max = T.conveyorMax;
          if (power > max) power = max;
          else if (power < -max) power = -max;
          _carry.x += _dir.x * power;
          _carry.z += _dir.z * power;
        }
      }
    }
    _carryPrev.copy(_carry);
  }

  /**
   * Bounce pad. `power` is the exact apex in metres — the launch uses gravFall
   * on the way up (see the gravity block) so v^2 / (2 * gravFall) == power to
   * the millimetre, every single time. Holding jump on the contact frame buys
   * you 25% more apex: pure skill expression, fully deterministic.
   */
  _applyBounce(props) {
    if (this._bounceCD > 0) return;
    if (this.surface === 'sticky') return;             // sticky never bounces
    const T = TUNE;
    let power = (props && typeof props.power === 'number') ? props.power : BOUNCE_DEFAULT_POWER;
    if (!(power > 0)) power = BOUNCE_DEFAULT_POWER;
    if (this._jumpHeld) power *= BOUNCE_HELD_BONUS;

    this.vel.y = Math.sqrt(2 * T.gravFall * power);
    this._bounceRise = true;
    this._skipGravHalf = true;
    this._cutArmed = false;                            // a bounce cannot be cut
    this._bounceCD = BOUNCE_CD;
    this.grounded = false;
    this._noGroundT = NO_GROUND_AFTER_JUMP;
    this.coyoteT = 0;
    this.bufferT = 0;
    this.wallSliding = this._setWallSlide(false);
    this._lastWallJumpRef = null;
    this._lastWallJumpValid = false;
    this._ev('bounce', power, this.pos);
    this._sfx('bounce', { power: power });   // audio.js scales the pad voice off o.power
    this._fxBurst('land', this.pos);
  }

  /** Speed pad: one shot per entry, 0.35 s cooldown. */
  _applySpeedPad(props) {
    if (this._speedCD > 0) return;
    const power = (props && typeof props.power === 'number') ? props.power : 8;
    readVec(props && props.dir, _dir, 0, 0, 0);
    if (_dir.lengthSq() < 1e-8) {
      // No direction authored: shove along current travel, else along facing.
      if (this.speed > 0.5) _dir.set(this.vel.x, 0, this.vel.z);
      else _dir.copy(this.forward);
    }
    const l = _dir.length();
    if (l < 1e-6) return;
    _dir.multiplyScalar(1 / l);
    this.vel.x += _dir.x * power;
    this.vel.y += _dir.y * power;
    this.vel.z += _dir.z * power;
    this._speedCD = SPEEDPAD_CD;
    this._speedRef = this.groundCollider;
    if (_dir.y > 0.2) {
      this.grounded = false;
      this._noGroundT = NO_GROUND_AFTER_JUMP;
      this._skipGravHalf = true;
    }
    this._ev('speed', power, this.pos);
    this._sfx('jump');
  }

  // =========================================================================
  //  Walls
  // =========================================================================
  _setWallSlide(v) {
    if (v !== this.wallSliding) this._ev('wallslide', v, this.wallNormal, this.pos);
    return v;
  }

  _evalWallSlide(wx, wz, wl, dt) {
    // airborne + fresh near-vertical contact + falling + holding into it
    const fresh = this._wallT > WALL_FRESH;
    let slide = false;
    if (!this.grounded && fresh && this.vel.y < 0 && wl > 0) {
      const into = -(wx * this.wallNormal.x + wz * this.wallNormal.z);
      if (into > WALL_INTO_DOT) slide = true;
    }
    if (slide !== this.wallSliding) this.wallSliding = this._setWallSlide(slide);
    if (slide) {
      // kill any residual velocity heading into the wall so we hug it
      const n = this.wallNormal;
      const into = this.vel.x * n.x + this.vel.z * n.z;
      if (into < 0) { this.vel.x -= into * n.x; this.vel.z -= into * n.z; }
      if (this.vel.y < -TUNE.wallSlideMax) this.vel.y = -TUNE.wallSlideMax;
      if (this._scrapeT <= 0) {
        this._scrapeT = WALL_SCRAPE_EVERY;
        this._ev('wallscrape', this.pos, this.wallNormal);
        this._fxBurst('wallScrape', this.pos, this.wallNormal);
        this._sfx('step_stone', { gain: 0.3 });
      }
    }
  }

  _canWallJump() {
    if (this.grounded) return false;
    if (this._wallT <= 0) return false;
    if (Math.abs(this.wallNormal.x) < 1e-4 && Math.abs(this.wallNormal.z) < 1e-4) return false;
    if (!this._lastWallJumpValid) return true;
    // The same wall cannot be re-jumped without touching ground or a new wall.
    if (this._lastWallJumpRef !== null && this._wallRef !== null) {
      return this._wallRef !== this._lastWallJumpRef;
    }
    // No collider identity available: fall back to comparing normals.
    const d = this.wallNormal.x * _lastWallN.x + this.wallNormal.z * _lastWallN.z;
    return d < 0.9;
  }

  _doJump(kind) {
    const T = TUNE;
    this.vel.y = T.jumpV;                 // exact, so the apex is exact
    this.grounded = false;
    this._noGroundT = NO_GROUND_AFTER_JUMP;
    this.coyoteT = 0;
    this.bufferT = 0;
    this._cutArmed = true;
    this._bounceRise = false;
    this.wallSliding = this._setWallSlide(false);
    this._wallT = 0;
    this._jumpedThisStep = true;
    this._stepDist = 0;
    this.stats.jumps++;
    this.lastJumpKind = kind;
    this._ev('jump', kind, this.pos);
    this._sfx('jump');
    this._fxBurst('dust', this.pos);
  }

  _doWallJump(wx, wz, wl) {
    const T = TUNE;
    const vel = this.vel;
    const n = this.wallNormal;
    const away = T.wallJumpV[0];
    const up = T.wallJumpV[1];

    // Cancel everything heading into the wall, then push off it.
    const into = vel.x * n.x + vel.z * n.z;
    if (into < 0) { vel.x -= into * n.x; vel.z -= into * n.z; }
    vel.x += n.x * away;
    vel.z += n.z * away;
    // A little aim assist so you can steer the push-off along the wall.
    if (wl > 0 && (wx * n.x + wz * n.z) > -0.2) {
      vel.x += wx * WALL_AIM_ASSIST * wl;
      vel.z += wz * WALL_AIM_ASSIST * wl;
    }
    vel.y = up;

    this._lastWallJumpRef = this._wallRef;
    this._lastWallJumpValid = true;
    _lastWallN.copy(n);

    this._airLockT = AIR_LOCK_TIME;       // 0.22 s of reduced air control
    this._wallT = 0;
    this.wallSliding = this._setWallSlide(false);
    this.grounded = false;
    this._noGroundT = NO_GROUND_AFTER_JUMP;
    this.bufferT = 0;
    this.coyoteT = 0;
    this._cutArmed = true;
    this._bounceRise = false;
    this._jumpedThisStep = true;
    this.stats.jumps++;
    this.stats.wallJumps++;
    this.lastJumpKind = 'wall';
    this._ev('jump', 'wall', this.pos);
    this._sfx('jump');
    this._fxBurst('wallScrape', this.pos, n);
  }

  // =========================================================================
  //  Stance — crouch shrinks from the TOP (feet planted); the crouch-jump
  //  tuck instead pins the TOP and lifts the FEET, which is what buys you the
  //  extra ledge clearance. Both keep the eye continuous, so the camera never
  //  pops: any discrete change to pos.y is subtracted straight out of the
  //  smoothed eye height.
  // =========================================================================
  _resolveStance(wantCrouch) {
    const T = TUNE;
    const pos = this.pos;
    const grounded = this.grounded;

    const wantTuck = (wantCrouch && !grounded) ? FOOT_LIFT : 0;
    const wantH = wantCrouch ? T.crouchHeight : T.height;

    if (wantCrouch === this.crouching && wantTuck === this._tuck) return;

    // Where the capsule bottom ends up. On the ground the feet are planted, so
    // the tuck is simply discarded without moving anything.
    const newY = grounded ? pos.y : (pos.y - this._tuck + wantTuck);

    const oldBottom = pos.y;
    const oldTop = pos.y + this.height;
    const newBottom = newY;
    const newTop = newY + wantH;

    if (newBottom < oldBottom - 1e-4 || newTop > oldTop + 1e-4) {
      // The capsule grows into space it did not previously occupy: prove it
      // is free first. Blocked -> keep the current stance entirely.
      if (!this._capsuleClear(pos.x, newBottom, pos.z, this.radius, wantH)) return;
    }

    const dy = newY - pos.y;
    pos.y = newY;
    this.prevPos.y += dy;      // keep the render interpolation continuous
    this._eyeH -= dy;          // and keep the ABSOLUTE eye height continuous

    if (!this.crouching && wantCrouch) this._stepDist *= 0.5;
    if (this.crouching && !wantCrouch) this._standT = STAND_GUARD;

    this.crouching = wantCrouch;
    this.height = wantH;
    this._tuck = wantTuck;
  }

  /**
   * Is an upright capsule of `h` metres at (x, y, z) free of solid geometry?
   * Uses the shared Broadphase + each Collider's cached world AABB, so it is a
   * conservative test: it errs toward "blocked", i.e. toward staying crouched,
   * which is the safe failure for a crusher.
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
    try {
      list = bp.query(_box, _query) || _query;
    } catch (err) {
      return true;      // no probe available: let the ceiling net catch it
    }
    if (!list || !list.length) return true;

    const bmin = _box.min;
    const bmax = _box.max;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.active === false) continue;
      const ab = c.aabb;
      if (!ab || !ab.min || !ab.max) continue;
      if (ab.max.x <= bmin.x || ab.min.x >= bmax.x) continue;
      if (ab.max.y <= bmin.y || ab.min.y >= bmax.y) continue;
      if (ab.max.z <= bmin.z || ab.min.z >= bmax.z) continue;
      return false;
    }
    return true;
  }

  // =========================================================================
  //  Eye height
  // =========================================================================
  _eyeTarget() {
    if (!this.crouching) return TUNE.eye;
    // Tucked in the air the head stays where it was, so the eye sits lower
    // relative to the (raised) feet by exactly the tuck.
    return this._tuck > 0 ? (TUNE.eye - this._tuck) : TUNE.crouchEye;
  }

  _updateEye(dt) {
    const target = this._eyeTarget();
    if (dt <= 0) { this._eyeH = target; return; }
    const k = 1 - Math.exp(-EYE_LAMBDA * dt);
    this._eyeH += (target - this._eyeH) * k;
    if (Math.abs(target - this._eyeH) < 1e-4) this._eyeH = target;
  }

  // =========================================================================
  //  Hazards
  // =========================================================================
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
      else if (w.stage && w.stage.def && typeof w.stage.def.killY === 'number') ky = w.stage.def.killY;
    }
    this.killY = (ky === null || !isFinite(ky)) ? -1e5 : ky;
  }

  _killTests(res) {
    if (this.dead) return;

    if (res && res.crushed) {
      this._ev('crush', this.pos);
      this.kill('crush');
      return;
    }
    if (this.pos.y < this.killY) {
      this.kill('void');
      return;
    }

    const w = this.world;
    const kvs = w && w.killVolumes;
    if (!kvs || !kvs.length) return;

    const cap = playerCapsule(this._syncCollideState());
    if (cap === null || cap === undefined) return;

    for (let i = 0; i < kvs.length; i++) {
      const kv = kvs[i];
      if (!kv || kv.active === false || typeof kv.hits !== 'function') continue;
      let hit = false;
      try { hit = kv.hits(cap); } catch (err) { hit = false; }
      if (hit) {
        this.kill(kv.kind || 'lava');
        return;
      }
    }
  }

  // =========================================================================
  //  Rotating platforms
  //
  //  There is no angular-velocity field in the Collider contract, so derive it
  //  from two `velocityAt` samples: for a pure spin about Y,
  //  v(p + x*d) - v(p) == (0, 0, -wy*d).
  // =========================================================================
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
    } catch (err) {
      return 0;
    }
    if (!ra || !rb || typeof ra.z !== 'number' || typeof rb.z !== 'number') return 0;

    const dvx = rb.x - ra.x;
    const dvz = rb.z - ra.z;
    if (!isFinite(dvx) || !isFinite(dvz)) return 0;
    // A pure Y spin produces no X difference across an X offset.
    if (Math.abs(dvx) > Math.abs(dvz) * 0.35 + 0.02) return 0;
    const wy = -dvz / d;
    if (!isFinite(wy) || Math.abs(wy) < 1e-3) return 0;
    return wy > 12 ? 12 : (wy < -12 ? -12 : wy);
  }

  // =========================================================================
  //  Events / audio / fx plumbing
  // =========================================================================
  _ev(name, a, b, c) {
    const e = this.events;
    if (!e || typeof e.emit !== 'function') return;
    try { e.emit(name, a, b, c); } catch (err) { /* a listener threw; the sim goes on */ }
  }

  _stepSample(surface) {
    if (surface === 'ice') return 'step_ice';
    if (surface === 'conveyor' || surface === 'speed' || surface === 'bounce') return 'step_metal';
    return 'step_stone';
  }

  /** True when at least one live listener is bound to `name` on our emitter. */
  _hasListener(name) {
    const e = this.events;
    if (!e || typeof e.has !== 'function') return false;
    try { return !!e.has(name); } catch (err) { return false; }
  }

  _sfx(name, opts) {
    if (!this.autoAudio) return;
    const a = this.audio;
    if (!a || typeof a.sfx !== 'function') return;
    // core/audio.js reads an OPTIONS OBJECT ({gain, rate, impact, power, ...});
    // a bare number as the second argument is silently ignored there, so only
    // real objects are forwarded.
    const o = (opts && typeof opts === 'object') ? opts : undefined;
    try { a.sfx(name, o); } catch (err) { /* audio must never break movement */ }
  }

  _fxBurst(preset, pos, extra) {
    const f = this.fx;
    if (!f) return;
    try {
      if (typeof f.burst === 'function') { f.burst(preset, pos, extra); return; }
      const ps = f.particles || f.ps;
      if (ps && typeof ps.burst === 'function') ps.burst(preset, pos, extra);
    } catch (err) { /* fx must never break movement */ }
  }

  _fxLand(v, surf, pos) {
    const f = this.fx;
    if (!f) return;
    try {
      if (typeof f.land === 'function') { f.land(v, surf, pos); return; }
      const im = f.impacts;
      if (im && typeof im.land === 'function') { im.land(v, surf, pos); return; }
    } catch (err) { return; }
    this._fxBurst('land', pos);
  }

  _fxDeath(cause, pos) {
    const f = this.fx;
    if (!f) return;
    try {
      if (typeof f.death === 'function') { f.death(cause, pos); return; }
      const im = f.impacts;
      if (im && typeof im.death === 'function') { im.death(cause, pos); return; }
    } catch (err) { return; }
    this._fxBurst('death', pos);
  }
}

export default Player;
