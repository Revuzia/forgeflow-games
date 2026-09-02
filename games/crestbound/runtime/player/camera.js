/**
 * CRESTBOUND — runtime/player/camera.js
 * ---------------------------------------------------------------------------
 * Third-person orbit-follow camera. CONTRACT §12.
 *
 *   export class FollowCamera {
 *     constructor(camera, player, input, world, settings);
 *     yaw, pitch, dist, mode:'follow'|'free'|'peek'|'cinematic'|'death';
 *     update(dt);
 *     recenter(); shake(amount, ms); punch(amount); setCinematic(pathDef|null); setDeathCam(bool);
 *     get forwardFlat(); get yawForMovement();
 *   }
 *
 * DESIGN — what a good third-person platformer camera has to get right, and
 * how each rule is implemented here:
 *
 *  1. THE HERO LEADS THE FRAME. The camera does not sit on the hero, it sits on
 *     a FOCUS point that chases the hero with framerate-independent exponential
 *     damping (`TUNE.cam.lagPos`). At full run the focus trails by ~1 m, so the
 *     hero is always slightly ahead of centre in the direction of travel and the
 *     player sees where they are going. Vertical lag is SLOWER while airborne
 *     (a single jump does not bob the frame) but a large fall (> 2.5 m below
 *     the focus) catches up within 0.4 s so the landing is never off-screen.
 *
 *  2. NEVER FIGHT THE PLAYER. Auto-yaw (easing the camera behind the run
 *     direction) only runs in 'follow' mode, only above 4 m/s, only after 1.2 s
 *     with no manual orbit, never while the hero runs TOWARD the camera (the
 *     classic dead-zone — otherwise the camera whips around while you are
 *     looking at the hero's face), and is FROZEN during every committed move
 *     (long jump, dive, slide, wall kick, pound, side/back flip, cannon). Its
 *     rate ramps in with `TUNE.cam.lagYaw` so it starts and stops as an S-curve
 *     rather than a step. `yawForMovement` (what the controller steers by)
 *     holds the PREVIOUS yaw for 0.15 s after a recenter so a mid-air stick
 *     input never flips direction under the player.
 *
 *  3. NEVER CLIP. Three whisker rays (centre, ±0.25 m along camera-right) are
 *     cast from the focus toward the desired camera position through
 *     `world.broadphase.raycast`. A hit pulls the camera in INSTANTLY to
 *     `t − collideRadius` (floored at the near plane, NOT at `minDist` — that is
 *     the player's zoom minimum and would hold the lens inside a close wall);
 *     clearing eases back out over
 *     0.6 s so the camera never pumps. A fourth ray protects the shoulder
 *     offset itself, so pressing the hero into a wall cannot push the focus
 *     inside it. Under 2.2 m the hero fades (`player.heroFade` 0..1, read by
 *     hero.js) so the near plane never slices the model.
 *
 *  4. MOTION FEEL IN THE LENS. FOV eases from `fov` to `fovRun` with speed,
 *     +6° on long jump / dive, +4° underwater (and the post chain is told, for
 *     its tint + wobble), `peekFov` in peek. Impacts are analytic critically-
 *     damped springs (a 50 ms frame cannot blow them up): `punch()` on a pound
 *     landing dips the distance, kicks the FOV and nods the pitch; `shake()` is
 *     smooth lattice value-noise, never a random jitter.
 *
 *  5. MODES are explicit and exclusive: follow | free (no auto-yaw, no pitch
 *     return) | peek (first person from the head, hero hidden) | cinematic
 *     (Catmull-Rom path — course intro, crest celebration orbit) | death
 *     (focus frozen at the death point, slow orbit, 1.5 m pull-out). Leaving a
 *     cinematic blends back to the follow pose over 0.6 s; leaving death after
 *     a respawn snaps the focus to the hero and the yaw behind them, because a
 *     respawn must be crisp.
 *
 * Coordinate conventions (CONTRACT): yaw 0 faces −Z, +yaw is counter-clockwise
 * from above; `headingFromYaw` is the ONE conversion. `pitch` is the camera's
 * ELEVATION above the focus (positive = camera above, looking down).
 * `input.look` is in radians and already sens+invert scaled (CONTRACT §4).
 *
 * The camera is posed in WORLD space: it must be a root-level object (parent
 * = scene or none). No per-frame heap allocation: every temporary is hoisted.
 */

import * as THREE from 'three';
import { TUNE, headingFromYaw, yawFromHeading } from '../core/tuning.js';
import {
  clamp, lerp, damp, smoothstep, wrapAngle, shortestAngle,
  easeInOutSine, moveTowardAngle,
} from '../core/util.js';
import { Settings as SettingsSingleton } from '../core/settings.js';

/* ───────────────────────────── constants ───────────────────────────── */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

// auto-yaw
const MANUAL_IDLE_S        = 1.2;    // s without manual orbit before auto-yaw may run
const AUTO_MIN_SPEED       = 4.0;    // m/s
const AUTO_TOWARD_DEADZONE = 2.55;   // rad: |delta| above this = running at the camera → hold
const AUTO_SOFT_DELTA      = 0.45;   // rad: rate scales down inside this so it never hunts

// pitch return
const PITCH_IDLE_S         = 3.0;
const PITCH_RETURN_RATE    = 0.25;   // rad/s

// focus lag
const AIR_LAG_V            = 3.5;    // vertical lambda while airborne (no bob on a hop)
const AIR_CATCHUP_DY       = 2.5;    // m: beyond this vertical error, catch up fast
const AIR_CATCHUP_LAMBDA   = 7.5;    // e^-7.5·0.4 ≈ 5 % — settles within 0.4 s

// collision
const WHISKER_M            = 0.25;
const COLLIDE_OUT_LAMBDA   = 5.0;    // 95 % of the way back out in 0.6 s
const COLLIDE_OUT_MAX_RATE = 12.0;   // m/s ceiling so a long pull-in never snaps out
const NEAR_FADE_DIST       = 2.2;    // hero fades below this camera distance
// Floor for the COLLISION pull-in only. `TUNE.cam.minDist` is the orbit/zoom
// minimum — the closest the player may pull the camera themselves — and must
// NOT clamp the whisker result: a wall 0.4 m behind the hero (hero pressed flat
// against it) would then hold the lens 1.6 m back, i.e. on the far side of the
// wall. CONTRACT §12 says "pull in to hit − collideRadius" with no floor, so the
// only real floor is the renderer's near plane (engine DEFAULT_NEAR 0.05); the
// hero is already fully faded by then (heroFade hits 1 at minDist).
const COLLIDE_MIN_DIST     = 0.12;
const DIST_LAMBDA          = 6.0;    // base distance changes (death pull-out) ease

// fov
const FOV_LAMBDA           = 12;
const FOV_PEEK_LAMBDA      = 16;
const FOV_MOVE_BOOST       = 6;      // long jump / dive
const FOV_UNDERWATER       = 4;
const UNDERWATER_LAMBDA    = 8;

// recenter
const RECENTER_HOLD_S      = 0.15;   // yawForMovement keeps the old yaw this long

// death
const DEATH_ORBIT_RATE     = 0.3;    // rad/s
const DEATH_PULL_M         = 1.5;
const DEATH_PITCH_LIFT     = 0.12;   // rad, eased in
const RESPAWN_SNAP_DIST    = 3.0;    // m the hero moved during death → treat as respawn

// cinematic
const CINE_BLEND_S         = 0.6;

// peek
const PEEK_PITCH_MAX       = 1.25;   // rad
const PEEK_EYE_DROP        = 0.10;   // m below headPos

// punch (pound landing) — analytic critically-damped springs
const PUNCH_OMEGA          = 28;
const PUNCH_DIST_M         = 0.45;
const PUNCH_FOV_DEG        = 4.0;
const PUNCH_PITCH_RAD      = 2.5 * DEG;
const PUNCH_COALESCE_S     = 0.06;

// shake
const SHAKE_POS_M          = 0.06;
const SHAKE_ROLL_RAD       = 1.6 * DEG;
const SHAKE_PITCH_RAD      = 0.9 * DEG;
const SHAKE_FREQ_A         = 23;
const SHAKE_FREQ_B         = 47;

// numerics
const FOV_EPS              = 0.008;  // deg — below this the projection is not rebuilt
const DT_MAX               = 1 / 20;

/** States during which auto-yaw is frozen (never fight a committed move). */
const FREEZE_STATES = {
  longjump: 1, dive: 1, slide: 1, slideRecover: 1, wallkick: 1, wallslide: 1,
  poundHang: 1, poundFall: 1, poundLand: 1, sideflip: 1, backflip: 1, cannon: 1,
};
/** States that widen the lens. */
const FOV_BOOST_STATES = { longjump: 1, dive: 1 };

/* ───────────────────────────── scratch ───────────────────────────── */

const _fwd       = new THREE.Vector3();
const _right     = new THREE.Vector3();
const _focusT    = new THREE.Vector3();   // this frame's focus target
const _heroC     = new THREE.Vector3();   // hero centre (no shoulder)
const _desired   = new THREE.Vector3();
const _dir       = new THREE.Vector3();
const _origin    = new THREE.Vector3();
const _look      = new THREE.Vector3();
const _tmp       = new THREE.Vector3();
const _tmp2      = new THREE.Vector3();
const _fwdOut    = new THREE.Vector3();   // returned by `forwardFlat`
const _qA        = new THREE.Quaternion();
const _hit       = { t: 0, normal: new THREE.Vector3(), collider: null };
const _spring    = { x: 0, v: 0 };

/**
 * Exact free response of a critically damped 2nd-order system.
 *   x(t) = (x0 + (v0 + ω·x0)·t)·e^(-ω·t)
 * Analytic rather than integrated so a long frame can never blow it up.
 */
function critDamp(x, v, omega, dt, out) {
  const e = Math.exp(-omega * dt);
  const a = v + omega * x;
  out.x = (x + a * dt) * e;
  out.v = (v - a * omega * dt) * e;
  return out;
}

/** Integer lattice hash → [-1, 1]. Deterministic, allocation-free. */
function hash1(i, seed) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** 1-D smooth value noise (Perlin-style lattice + Hermite blend). */
function noise1(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u);
}

/** Two-octave shake signal in [-1, 1]. */
function shakeNoise(t, seed) {
  return noise1(t * SHAKE_FREQ_A, seed) * 0.65 + noise1(t * SHAKE_FREQ_B, seed + 7) * 0.35;
}

/** Uniform Catmull-Rom on one axis. */
function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Read an [x,y,z] array or {x,y,z} object into a Float64Array slot. */
function readVec3(src, arr, k) {
  if (!src) { arr[k] = 0; arr[k + 1] = 0; arr[k + 2] = 0; return false; }
  if (Array.isArray(src) || ArrayBuffer.isView(src)) {
    arr[k] = +src[0] || 0; arr[k + 1] = +src[1] || 0; arr[k + 2] = +src[2] || 0;
    return true;
  }
  if (typeof src === 'object') {
    arr[k] = +src.x || 0; arr[k + 1] = +src.y || 0; arr[k + 2] = +src.z || 0;
    return true;
  }
  return false;
}

/** camera-right for a yaw about +Y: fwd × up. */
function rightFromFwd(fwd, out) {
  out.set(-fwd.z, 0, fwd.x);
  return out;
}

/* ───────────────────────────── FollowCamera ───────────────────────────── */

export class FollowCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera  the engine's main camera (root-level)
   * @param {object} player   runtime/player/controller.js Player
   * @param {object} input    runtime/core/input.js Input
   * @param {object} world    {broadphase, killVolumes, volumes} (or a Course — it has .broadphase)
   * @param {object} [settings] runtime/core/settings.js Settings (falls back to the singleton)
   */
  constructor(camera, player, input, world, settings) {
    this.camera   = camera || null;
    this.player   = player || null;
    this.input    = input || null;
    this.world    = world || null;
    this.settings = settings || SettingsSingleton;

    // ── public state ──────────────────────────────────────────────────────
    /** orbit yaw (rad), wraps in (-π, π] */
    this.yaw   = 0;
    /** camera elevation above the focus (rad), clamped pitchMin..pitchMax */
    this.pitch = TUNE.cam.defaultPitch;
    /** current (collided) camera distance from the focus (m) */
    this.dist  = TUNE.cam.dist;
    /** 'follow' | 'free' | 'peek' | 'cinematic' | 'death' */
    this.mode  = 'follow';
    /** applied vertical FOV (deg) */
    this.fov   = TUNE.cam.fov;

    // ── lagged focus ──────────────────────────────────────────────────────
    this._focus     = new THREE.Vector3();
    this._focusInit = false;
    this._pos       = new THREE.Vector3();     // final camera world position
    this._lookPt    = new THREE.Vector3();     // final look target
    this._shoulder  = TUNE.cam.shoulder;       // live (collision-reduced) shoulder

    // ── orbit / auto-yaw ──────────────────────────────────────────────────
    this._time         = 0;
    this._lastManualT  = -1e9;
    this._autoRate     = 0;                    // 0..1 ramp of the auto-yaw rate
    this._pitchIdleT   = 0;                    // s since last manual pitch
    this._camMode      = 'follow';             // Settings.camMode
    this._invertX      = false;
    this._invertY      = false;
    this._sensX        = 1;
    this._sensY        = 1;

    // ── distance ──────────────────────────────────────────────────────────
    this._distBase   = TUNE.cam.dist;          // eased base (death pull-out)
    this._distColl   = TUNE.cam.dist;          // collision-limited distance

    // ── recenter ──────────────────────────────────────────────────────────
    this._rcActive  = false;
    this._rcT       = 0;
    this._rcFrom    = 0;
    this._rcHoldT   = 0;
    this._rcHoldYaw = 0;

    // ── fov ───────────────────────────────────────────────────────────────
    this._fovBase    = TUNE.cam.fov;
    this._fovApplied = -1;
    this._underwater = 0;
    this._underwaterApplied = -1;

    // ── punch springs ─────────────────────────────────────────────────────
    this._pDistX = 0;  this._pDistV = 0;
    this._pFovX = 0;   this._pFovV = 0;
    this._pPitchX = 0; this._pPitchV = 0;
    this._lastPunchT = -1;

    // ── shake ─────────────────────────────────────────────────────────────
    this._shakeAmp = 0; this._shakeT = 0; this._shakeDur = 0; this._shakeSeed = 1;
    this._shakeX = 0; this._shakeY = 0; this._shakeRoll = 0; this._shakePitch = 0;

    // ── peek ──────────────────────────────────────────────────────────────
    this._peekOn    = false;
    this._peekPitch = 0;

    // ── death ─────────────────────────────────────────────────────────────
    this._deathOn    = false;
    this._deathT     = 0;
    this._deathFocus = new THREE.Vector3();
    this._deathHero  = new THREE.Vector3();

    // ── cinematic ─────────────────────────────────────────────────────────
    this._cine       = null;                   // normalised path (see setCinematic)
    this._cineT      = 0;
    this._cineDone   = false;
    this._cineBlendT = -1;                     // ≥ 0 while blending back to follow
    this._cinePos    = new THREE.Vector3();
    this._cineQuat   = new THREE.Quaternion();
    this._cineFov    = TUNE.cam.fov;
    this._yawMoveCine = 0;

    // ── outputs to siblings ───────────────────────────────────────────────
    this._heroFade = 0;
    this._post     = null;

    // ── settings ──────────────────────────────────────────────────────────
    this._onSettings = () => this._readSettings();
    this._readSettings();
    if (this.settings && typeof this.settings.on === 'function') this.settings.on(this._onSettings);

    // ── test surface ──────────────────────────────────────────────────────
    const self = this;
    this.__test = {
      state() {
        return {
          yaw: self.yaw, pitch: self.pitch, dist: self.dist, mode: self.mode, fov: self.fov,
          yawForMovement: self.yawForMovement,
          focus: [self._focus.x, self._focus.y, self._focus.z],
          pos: [self._pos.x, self._pos.y, self._pos.z],
          look: [self._lookPt.x, self._lookPt.y, self._lookPt.z],
          distBase: self._distBase, distColl: self._distColl, shoulder: self._shoulder,
          autoRate: self._autoRate, autoFrozen: self._autoFrozen(),
          sinceManual: self._time - self._lastManualT,
          recentering: self._rcActive, recenterT: self._rcT, holdT: self._rcHoldT,
          heroFade: self._heroFade, underwater: self._underwater,
          peek: self._peekOn, death: self._deathOn,
          cinematic: !!self._cine, cinematicT: self._cineT, cinematicDone: self._cineDone,
          time: self._time,
        };
      },
      setYaw(y) { self.yaw = wrapAngle(+y || 0); self._autoRate = 0; self._rcActive = false; },
      setPitch(p) { self.pitch = clamp(+p || 0, TUNE.cam.pitchMin, TUNE.cam.pitchMax); },
    };

    this._snapToPlayer(true);
    this._compose(0);
  }

  /* ─────────────────────────── public API ─────────────────────────── */

  /** Swap the collision world (course load). Additive to the contract. */
  setWorld(world) { this.world = world || null; }

  /** Post chain for underwater tint. Resolved lazily from player.fx if not set. */
  setPost(post) { this._post = (post && typeof post.setUnderwater === 'function') ? post : null; }

  /** Ease the yaw to directly behind the hero over `TUNE.cam.recenterTime`. */
  recenter() {
    if (this._deathOn || this._cine) return;
    this._rcHoldYaw = this._rcActive ? this._rcHoldYaw : this.yaw;
    this._rcHoldT   = RECENTER_HOLD_S;
    this._rcActive  = true;
    this._rcT       = 0;
    this._rcFrom    = this.yaw;
    this._autoRate  = 0;
  }

  /**
   * Additive decaying shake. `amount` 0..1-ish (0.3 = a stomp nearby, 1 = the
   * Warden's landing). Never cuts a bigger shake short.
   */
  shake(amount, ms) {
    const a = Math.max(0, +amount || 0);
    if (a <= 0) return;
    const remaining = this._shakeDur > 0 ? this._shakeAmp * (1 - this._shakeT / this._shakeDur) : 0;
    this._shakeAmp  = Math.max(a, remaining);
    this._shakeT    = 0;
    this._shakeDur  = Math.max(0.02, (+ms || 220) / 1000);
    this._shakeSeed = (this._shakeSeed + 17) % 4093;
  }

  /**
   * Impact punch (pound landing, hard landing): the distance dips in, the FOV
   * kicks wide and the pitch nods, all on critically-damped springs.
   * @param {number} amount 0..1 (1 = ground pound)
   */
  punch(amount) {
    const a = clamp(amount === undefined ? 1 : (+amount || 0), 0, 2);
    if (a <= 0) return;
    if (this._lastPunchT >= 0 && this._time - this._lastPunchT < PUNCH_COALESCE_S) return;
    this._lastPunchT = this._time;
    // impulse the velocity (a kick), not the position, so it reads as a hit.
    // A critically damped spring kicked from rest peaks at v0/(ω·e) after 1/ω s,
    // so scale by ω·e to make PUNCH_*_ constants the actual peak amplitudes.
    const k = PUNCH_OMEGA * Math.E * a;
    this._pDistV  -= PUNCH_DIST_M    * k;
    this._pFovV   += PUNCH_FOV_DEG   * k;
    this._pPitchV += PUNCH_PITCH_RAD * k;
    if (a >= 0.6) this.shake(0.35 * a, 180);
  }

  /**
   * Death cam. true → freeze the focus where the hero died, orbit slowly, pull
   * out 1.5 m. false → back to follow; if the hero has since moved (respawn) the
   * focus snaps to them and the yaw lands behind them — a respawn must be crisp.
   */
  setDeathCam(on) {
    const v = !!on;
    if (v === this._deathOn) return;
    this._deathOn = v;
    if (v) {
      this._deathT = 0;
      this._deathFocus.copy(this._focus);
      const src = this._heroSrc();
      if (src) this._deathHero.set(src.x, src.y, src.z);
      this._rcActive = false;
      this._peekOn = false;
      this.mode = 'death';
    } else {
      this._deathT = 0;
      const src = this._heroSrc();
      const moved = src ? _tmp.set(src.x, src.y, src.z).distanceTo(this._deathHero) : 0;
      this._clearTransients();
      if (!src || moved > RESPAWN_SNAP_DIST) this._snapToPlayer(true);
      else this._snapToPlayer(false);
      this.mode = this._camMode;
    }
  }

  /**
   * Cinematic path, or null to return to follow (blends back over 0.6 s).
   *
   * pathDef forms:
   *   {keys:[{p:[x,y,z], look:[x,y,z]|'player', t:seconds, fov?}, …], loop?, onDone?}
   *   [{p, look, t}, …]                                  (bare key array)
   *   {orbit:{center:[x,y,z], radius, height, duration, turns?, startYaw?, fov?}, onDone?}
   *     → a generated orbit (crest celebration: centre = pedestal, 2.2 s)
   * Key times are absolute seconds from the start of the path and must ascend.
   */
  setCinematic(pathDef) {
    if (!pathDef) {
      if (this._cine) {
        this._cine = null;
        this._cineBlendT = 0;                          // blend from the last cinematic pose
        this._cinePos.copy(this._pos);
        if (this.camera) this._cineQuat.copy(this.camera.quaternion);
        this.mode = this._deathOn ? 'death' : this._camMode;
      }
      return;
    }
    const cine = this._normalisePath(pathDef);
    if (!cine) return;
    this._cine = cine;
    this._cineT = 0;
    this._cineDone = false;
    this._cineBlendT = -1;
    this._yawMoveCine = this.yaw;
    this._rcActive = false;
    this._peekOn = false;
    this.mode = 'cinematic';
  }

  /** Unit XZ forward of the camera (the direction the lens faces, flattened). */
  get forwardFlat() {
    if (this.mode === 'cinematic' && this.camera) {
      // real lens direction while a path plays
      this.camera.getWorldDirection(_fwdOut);
      _fwdOut.y = 0;
      const l = _fwdOut.length();
      if (l > 1e-5) return _fwdOut.multiplyScalar(1 / l);
    }
    return headingFromYaw(this.yaw, _fwdOut);
  }

  /**
   * The yaw the controller resolves stick input against. Equals `yaw` except:
   * for 0.15 s after a recenter it keeps the pre-recenter yaw (a mid-air input
   * must not flip), and during a cinematic it keeps the yaw from before the
   * path started so movement stays predictable under a moving lens.
   */
  get yawForMovement() {
    if (this._rcHoldT > 0) return this._rcHoldYaw;
    if (this._cine) return this._yawMoveCine;
    return this.yaw;
  }

  /** Camera world position (the value composed last frame). */
  get position() { return this._pos; }
  /** The lagged focus point. */
  get focus() { return this._focus; }
  /** 0..1 hero fade written to player.heroFade this frame. */
  get heroFade() { return this._heroFade; }
  get deathCam() { return this._deathOn; }
  get cinematicDone() { return this._cineDone; }

  /** Snap the focus to the hero and the yaw behind them (course load / respawn). */
  snapToPlayer() { this._clearTransients(); this._snapToPlayer(true); this._compose(0); }

  /* ─────────────────────────── main update ─────────────────────────── */

  update(dt) {
    const d = clamp(+dt || 0, 0, DT_MAX);
    this._time += d;

    const input = this.input;
    const suspended = !!(input && input.suspended);

    // 1 ── mode toggle (B / camToggle) ---------------------------------------
    if (input && input.camTogglePressed && !suspended && !this._cine && !this._deathOn) {
      const next = this._camMode === 'free' ? 'follow' : 'free';
      if (this.settings && typeof this.settings.set === 'function') this.settings.set({ camMode: next });
      else this._camMode = next;
    }

    // 2 ── peek enter / exit --------------------------------------------------
    const wantPeek = !!(input && input.peek && !suspended && !this._cine && !this._deathOn);
    if (wantPeek !== this._peekOn) {
      this._peekOn = wantPeek;
      if (wantPeek) { this._peekPitch = 0; this._rcActive = false; }
      else { this._distColl = TUNE.cam.minDist; }   // ease back out from the head
    }

    // 3 ── resolve mode -------------------------------------------------------
    this.mode = this._cine ? 'cinematic' : (this._deathOn ? 'death' : (this._peekOn ? 'peek' : this._camMode));

    // 4 ── manual orbit ------------------------------------------------------
    this._consumeLook(d, suspended);

    // 5 ── recenter trigger --------------------------------------------------
    if (input && input.recenterPressed && !suspended && !this._peekOn) this.recenter();
    if (this._rcHoldT > 0) this._rcHoldT = Math.max(0, this._rcHoldT - d);

    // 6 ── yaw drivers: recenter > death orbit > auto-yaw --------------------
    if (this._rcActive) this._updateRecenter(d);
    else if (this._deathOn) this.yaw = wrapAngle(this.yaw + DEATH_ORBIT_RATE * d);
    else this._updateAutoYaw(d);

    // 7 ── pitch return ------------------------------------------------------
    this._updatePitchReturn(d);

    // 8 ── focus lag ---------------------------------------------------------
    this._updateFocus(d);

    // 9 ── springs / shake ---------------------------------------------------
    this._updateSprings(d);
    this._updateShake(d);

    // 10 ── distance + collision --------------------------------------------
    this._updateDistance(d);

    // 11 ── cinematic clock --------------------------------------------------
    if (this._cine) this._updateCinematic(d);
    else if (this._cineBlendT >= 0) {
      this._cineBlendT += d;
      if (this._cineBlendT >= CINE_BLEND_S) this._cineBlendT = -1;
    }

    // 12 ── compose the camera ----------------------------------------------
    this._compose(d);

    // 13 ── lens + sibling outputs ------------------------------------------
    this._updateFov(d);
    this._updateOutputs(d);
  }

  /* ─────────────────────────── internals ─────────────────────────── */

  _readSettings() {
    const s = (this.settings && typeof this.settings.get === 'function')
      ? (this.settings.get() || {})
      : (this.settings || {});
    this._camMode = s.camMode === 'free' ? 'free' : 'follow';
    this._invertX = !!s.invertX;
    this._invertY = !!s.invertY;
    this._sensX = (typeof s.camSensX === 'number' && isFinite(s.camSensX)) ? clamp(s.camSensX, 0.05, 10) : 1;
    this._sensY = (typeof s.camSensY === 'number' && isFinite(s.camSensY)) ? clamp(s.camSensY, 0.05, 10) : 1;
    if (!this._cine && !this._deathOn && !this._peekOn) this.mode = this._camMode;
  }

  /** Player position source: renderPos (interpolated feet) → pos. */
  _heroSrc() {
    const p = this.player;
    if (!p) return null;
    return p.renderPos || p.pos || null;
  }

  _heroSpeed() {
    const p = this.player;
    if (!p) return 0;
    if (p.vel) return Math.hypot(+p.vel.x || 0, +p.vel.z || 0);
    return +p.speed || 0;
  }

  _autoFrozen() {
    const p = this.player;
    if (!p) return false;
    const st = p.state;
    return FREEZE_STATES[st] === 1;
  }

  _clearTransients() {
    this._pDistX = this._pDistV = 0;
    this._pFovX = this._pFovV = 0;
    this._pPitchX = this._pPitchV = 0;
    this._shakeAmp = 0; this._shakeDur = 0; this._shakeT = 0;
    this._shakeX = this._shakeY = this._shakeRoll = this._shakePitch = 0;
    this._rcActive = false; this._rcHoldT = 0;
    this._autoRate = 0;
  }

  /** Put the focus on the hero now; optionally the yaw behind them too. */
  _snapToPlayer(withYaw) {
    const src = this._heroSrc();
    if (!src) return;
    const p = this.player;
    if (withYaw && p && typeof p.facing === 'number' && isFinite(p.facing)) {
      this.yaw = wrapAngle(p.facing);
      this.pitch = TUNE.cam.defaultPitch;
    }
    headingFromYaw(this.yaw, _fwd);
    rightFromFwd(_fwd, _right);
    this._shoulder = TUNE.cam.shoulder;
    this._focus.set(src.x, src.y + TUNE.cam.height, src.z).addScaledVector(_right, this._shoulder);
    this._focusInit = true;
    this._distBase = TUNE.cam.dist;
    this._distColl = TUNE.cam.dist;
    this.dist = TUNE.cam.dist;
  }

  _consumeLook(dt, suspended) {
    const input = this.input;
    if (!input || !input.look) return;
    let dx = +input.look.dx || 0;
    let dy = +input.look.dy || 0;
    // The camera owns this frame's delta — consume it so nothing double-applies.
    input.look.dx = 0; input.look.dy = 0;
    if (dx === 0 && dy === 0) return;
    if (suspended || this._deathOn || this._cine || dt <= 0) return;

    // CONTRACT §4: input.look is already sens + invert scaled. Only an input
    // that explicitly flags itself raw gets the settings applied here.
    if (input.lookIsRaw === true) {
      dx *= this._sensX * (this._invertX ? -1 : 1);
      dy *= this._sensY * (this._invertY ? -1 : 1);
    }

    this._lastManualT = this._time;
    this._autoRate = 0;
    this._rcActive = false;

    if (this._peekOn) {
      this.yaw = wrapAngle(this.yaw - dx);
      this._peekPitch = clamp(this._peekPitch - dy, -PEEK_PITCH_MAX, PEEK_PITCH_MAX);
      return;
    }
    // mouse right → orbit right (camera swings clockwise seen from above = −yaw)
    this.yaw = wrapAngle(this.yaw - dx);
    // mouse forward (dy < 0) → camera rises (pitch up)
    if (dy !== 0) {
      this.pitch = clamp(this.pitch - dy, TUNE.cam.pitchMin, TUNE.cam.pitchMax);
      this._pitchIdleT = 0;
    }
  }

  _updateRecenter(dt) {
    const p = this.player;
    const target = (p && typeof p.facing === 'number' && isFinite(p.facing)) ? p.facing : this.yaw;
    this._rcT += dt;
    const k = clamp(this._rcT / Math.max(1e-3, TUNE.cam.recenterTime), 0, 1);
    const e = easeInOutSine(k);
    // interpolate from the start yaw toward the LIVE facing so a turning hero is tracked
    this.yaw = wrapAngle(this._rcFrom + shortestAngle(this._rcFrom, target) * e);
    if (k >= 1) { this.yaw = wrapAngle(target); this._rcActive = false; }
  }

  _updateAutoYaw(dt) {
    // eligibility — every rule in the header, in order
    let want = 0;
    let target = this.yaw;
    if (this.mode === 'follow' && !this._peekOn) {
      const speed = this._heroSpeed();
      const idle = this._time - this._lastManualT;
      if (speed > AUTO_MIN_SPEED && idle >= MANUAL_IDLE_S && !this._autoFrozen()) {
        const v = this.player.vel;
        const runYaw = v ? yawFromHeading(v.x, v.z) : this.yaw;
        const delta = shortestAngle(this.yaw, runYaw);
        if (Math.abs(delta) < AUTO_TOWARD_DEADZONE) { want = 1; target = runYaw; }
      }
    }
    // rate ramps in / out with lagYaw → S-curve start and stop, never a step
    this._autoRate = damp(this._autoRate, want, TUNE.cam.lagYaw, dt);
    if (this._autoRate < 1e-3) { this._autoRate = 0; return; }
    if (want === 0) return;
    const delta = shortestAngle(this.yaw, target);
    // soften inside AUTO_SOFT_DELTA so the camera settles instead of hunting
    const soft = smoothstep(0, AUTO_SOFT_DELTA, Math.abs(delta));
    const rate = TUNE.cam.autoYaw * this._autoRate * (0.25 + 0.75 * soft);
    this.yaw = moveTowardAngle(this.yaw, target, rate * dt);
  }

  _updatePitchReturn(dt) {
    if (this._peekOn || this._cine || this._deathOn) return;
    this._pitchIdleT += dt;
    if (this.mode !== 'follow') return;
    if (this._pitchIdleT < PITCH_IDLE_S) return;
    const d = TUNE.cam.defaultPitch - this.pitch;
    if (Math.abs(d) < 1e-4) { this.pitch = TUNE.cam.defaultPitch; return; }
    const step = PITCH_RETURN_RATE * dt;
    this.pitch += d > step ? step : (d < -step ? -step : d);
  }

  _updateFocus(dt) {
    const src = this._heroSrc();
    if (!src) return;
    const p = this.player;

    headingFromYaw(this.yaw, _fwd);
    rightFromFwd(_fwd, _right);

    // hero centre and shoulder-offset target
    _heroC.set(src.x, src.y + TUNE.cam.height, src.z);
    _focusT.copy(_heroC).addScaledVector(_right, this._shoulder);

    if (!this._focusInit) { this._focus.copy(_focusT); this._focusInit = true; return; }
    if (this._deathOn) { this._focus.copy(this._deathFocus); return; }
    if (dt <= 0) return;

    const grounded = !!(p && (p.grounded || p.onGround));
    const inWater  = !!(p && (p.inWater || p.submerged));
    const lam = TUNE.cam.lagPos;

    // horizontal: hero leads by v/lambda
    this._focus.x = damp(this._focus.x, _focusT.x, lam, dt);
    this._focus.z = damp(this._focus.z, _focusT.z, lam, dt);

    // vertical: slow in the air (no bob per hop), fast catch-up on a big fall / landing
    let lamY = lam;
    if (!grounded && !inWater) {
      const dy = _focusT.y - this._focus.y;
      lamY = Math.abs(dy) > AIR_CATCHUP_DY ? AIR_CATCHUP_LAMBDA : AIR_LAG_V;
    }
    this._focus.y = damp(this._focus.y, _focusT.y, lamY, dt);
  }

  _updateSprings(dt) {
    if (dt <= 0) return;
    critDamp(this._pDistX, this._pDistV, PUNCH_OMEGA, dt, _spring);
    this._pDistX = _spring.x; this._pDistV = _spring.v;
    if (Math.abs(this._pDistX) < 1e-5 && Math.abs(this._pDistV) < 1e-4) { this._pDistX = 0; this._pDistV = 0; }

    critDamp(this._pFovX, this._pFovV, PUNCH_OMEGA, dt, _spring);
    this._pFovX = _spring.x; this._pFovV = _spring.v;
    if (Math.abs(this._pFovX) < 1e-4 && Math.abs(this._pFovV) < 1e-3) { this._pFovX = 0; this._pFovV = 0; }

    critDamp(this._pPitchX, this._pPitchV, PUNCH_OMEGA, dt, _spring);
    this._pPitchX = _spring.x; this._pPitchV = _spring.v;
    if (Math.abs(this._pPitchX) < 1e-6 && Math.abs(this._pPitchV) < 1e-5) { this._pPitchX = 0; this._pPitchV = 0; }
  }

  _updateShake(dt) {
    if (this._shakeDur <= 0) {
      this._shakeX = this._shakeY = this._shakeRoll = this._shakePitch = 0;
      return;
    }
    this._shakeT += dt;
    if (this._shakeT >= this._shakeDur) {
      this._shakeDur = 0; this._shakeAmp = 0;
      this._shakeX = this._shakeY = this._shakeRoll = this._shakePitch = 0;
      return;
    }
    const k = 1 - this._shakeT / this._shakeDur;
    const a = this._shakeAmp * k * k;
    const t = this._shakeT, s = this._shakeSeed;
    this._shakeX     = shakeNoise(t, s)      * a * SHAKE_POS_M;
    this._shakeY     = shakeNoise(t, s + 31) * a * SHAKE_POS_M * 0.8;
    this._shakeRoll  = shakeNoise(t, s + 59) * a * SHAKE_ROLL_RAD;
    this._shakePitch = shakeNoise(t, s + 83) * a * SHAKE_PITCH_RAD;
  }

  /**
   * Desired distance = eased base (+1.5 m on death) + punch dip, then the
   * whisker raycasts pull it in. Pull-in is instant; release eases out.
   */
  _updateDistance(dt) {
    const C = TUNE.cam;
    const baseWant = this._deathOn ? C.dist + DEATH_PULL_M : C.dist;
    this._distBase = dt > 0 ? damp(this._distBase, baseWant, DIST_LAMBDA, dt) : baseWant;

    if (this._peekOn || this._cine) {
      // peek/cinematic do not orbit — hold the collision state at minimum so the
      // return eases out from the head rather than popping to full distance
      if (this._peekOn) this._distColl = C.minDist;
      this.dist = Math.max(C.minDist, this._distColl);
      return;
    }

    let want = Math.max(C.minDist, this._distBase + this._pDistX);

    // geometry
    headingFromYaw(this.yaw, _fwd);
    rightFromFwd(_fwd, _right);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _dir.set(-_fwd.x * cp, sp, -_fwd.z * cp);          // unit: focus → camera

    const bp = this._broadphase();
    if (bp) {
      // (a) shoulder guard: hero centre → shoulder focus must be clear
      const src = this._heroSrc();
      if (src) {
        _heroC.set(src.x, src.y + C.height, src.z);
        let sh = C.shoulder;
        if (sh !== 0) {
          _tmp.copy(_right).multiplyScalar(Math.sign(sh));
          if (bp.raycast(_heroC, _tmp, Math.abs(sh) + C.collideRadius, _hit)) {
            sh = Math.sign(sh) * Math.max(0, _hit.t - C.collideRadius);
          }
        }
        this._shoulder = dt > 0 ? damp(this._shoulder, sh, 14, dt) : sh;
      }

      // (b) three whiskers from the focus toward the desired position
      const maxD = want + C.collideRadius;
      let limit = want;
      for (let i = -1; i <= 1; i++) {
        _origin.copy(this._focus).addScaledVector(_right, i * WHISKER_M);
        if (bp.raycast(_origin, _dir, maxD, _hit)) {
          const cand = _hit.t - C.collideRadius;
          if (cand < limit) limit = cand;
        }
      }
      // The whisker result overrides the zoom minimum: clamping to minDist here
      // is what pushes the lens THROUGH a close wall. Floor at the near plane.
      want = Math.max(COLLIDE_MIN_DIST, limit);
    }

    if (dt <= 0) { this._distColl = want; }
    else if (want < this._distColl) { this._distColl = want; }                     // pull in: instant
    else {
      let next = damp(this._distColl, want, COLLIDE_OUT_LAMBDA, dt);              // ease back out
      const maxStep = COLLIDE_OUT_MAX_RATE * dt;
      if (next - this._distColl > maxStep) next = this._distColl + maxStep;
      this._distColl = next;
    }
    this.dist = this._distColl;
  }

  _broadphase() {
    const w = this.world;
    if (!w) return null;
    const bp = w.broadphase || (w.course && w.course.broadphase) || null;
    return (bp && typeof bp.raycast === 'function') ? bp : null;
  }

  _updateCinematic(dt) {
    const c = this._cine;
    if (!c) return;
    if (!this._cineDone || c.loop) this._cineT += dt;
    const tEnd = c.times[c.n - 1];
    let t = this._cineT;
    if (c.loop && tEnd > 0) { t = t % tEnd; }
    else if (t >= tEnd) {
      t = tEnd;
      if (!this._cineDone) {
        this._cineDone = true;
        if (typeof c.onDone === 'function') { try { c.onDone(this); } catch (e) { console.error('[FollowCamera] onDone threw:', e); } }
      }
    }
    // locate the segment
    let i = 0;
    while (i < c.n - 2 && t >= c.times[i + 1]) i++;
    const t0 = c.times[i], t1 = c.times[Math.min(c.n - 1, i + 1)];
    const u = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 1;
    const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(c.n - 1, i + 1), i3 = Math.min(c.n - 1, i + 2);
    const P = c.pos, L = c.look;
    this._cinePos.set(
      catmull(P[i0 * 3], P[i1 * 3], P[i2 * 3], P[i3 * 3], u),
      catmull(P[i0 * 3 + 1], P[i1 * 3 + 1], P[i2 * 3 + 1], P[i3 * 3 + 1], u),
      catmull(P[i0 * 3 + 2], P[i1 * 3 + 2], P[i2 * 3 + 2], P[i3 * 3 + 2], u));
    if (c.lookPlayer[i1] === 1 || c.lookPlayer[i2] === 1) {
      _look.copy(this._focus);
    } else {
      _look.set(
        catmull(L[i0 * 3], L[i1 * 3], L[i2 * 3], L[i3 * 3], u),
        catmull(L[i0 * 3 + 1], L[i1 * 3 + 1], L[i2 * 3 + 1], L[i3 * 3 + 1], u),
        catmull(L[i0 * 3 + 2], L[i1 * 3 + 2], L[i2 * 3 + 2], L[i3 * 3 + 2], u));
    }
    this._cineFov = lerp(c.fov[i1], c.fov[i2], u);
    this._lookPt.copy(_look);
  }

  /** Pose the camera for the current mode. */
  _compose(dt) {
    const cam = this.camera;

    if (this._cine) {
      this._pos.copy(this._cinePos);
      if (cam) {
        cam.position.copy(this._pos);
        cam.up.copy(UP);
        cam.lookAt(this._lookPt);
        this._cineQuat.copy(cam.quaternion);
        cam.updateMatrixWorld(true);
      }
      return;
    }

    headingFromYaw(this.yaw, _fwd);
    rightFromFwd(_fwd, _right);

    if (this._peekOn) {
      // first person from the head, looking along the orbit heading
      const p = this.player;
      const head = p && p.headPos;
      const src = this._heroSrc();
      if (head) this._pos.set(head.x, head.y - PEEK_EYE_DROP, head.z);
      else if (src) this._pos.set(src.x, src.y + TUNE.height - PEEK_EYE_DROP, src.z);
      const pp = this._peekPitch + this._shakePitch;
      const cpp = Math.cos(pp), spp = Math.sin(pp);
      this._lookPt.set(this._pos.x + _fwd.x * cpp, this._pos.y + spp, this._pos.z + _fwd.z * cpp);
    } else {
      // orbit: focus − fwd·cos(pitch)·dist + up·sin(pitch)·dist
      let pitch = this.pitch + this._pPitchX + this._shakePitch;
      if (this._deathOn) {
        this._deathT = Math.min(1, this._deathT + dt / 0.5);
        pitch += DEATH_PITCH_LIFT * easeInOutSine(this._deathT);
      }
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      this._pos.set(
        this._focus.x - _fwd.x * cp * this.dist,
        this._focus.y + sp * this.dist,
        this._focus.z - _fwd.z * cp * this.dist);
      this._lookPt.copy(this._focus);
    }

    // shake translation in camera-right / up
    this._pos.addScaledVector(_right, this._shakeX);
    this._pos.y += this._shakeY;

    if (!cam) return;
    cam.position.copy(this._pos);
    cam.up.copy(UP);
    cam.lookAt(this._lookPt);
    if (this._shakeRoll !== 0) cam.rotateZ(this._shakeRoll);

    // blend out of a cinematic: slerp from the last path pose toward the follow pose
    if (this._cineBlendT >= 0) {
      const k = 1 - easeInOutSine(clamp(this._cineBlendT / CINE_BLEND_S, 0, 1));
      if (k > 1e-4) {
        _qA.copy(cam.quaternion);
        cam.quaternion.copy(_qA).slerp(this._cineQuat, k);
        _tmp2.copy(this._pos).lerp(this._cinePos, k);
        cam.position.copy(_tmp2);
        this._pos.copy(_tmp2);
      }
    }
    cam.updateMatrixWorld(true);
  }

  _updateFov(dt) {
    const cam = this.camera;
    const C = TUNE.cam;
    const p = this.player;

    let target, lam = FOV_LAMBDA;
    if (this._cine) {
      target = this._cineFov;
    } else if (this._peekOn) {
      target = C.peekFov; lam = FOV_PEEK_LAMBDA;
    } else {
      const speed = this._heroSpeed();
      const run = smoothstep(TUNE.speedWalk, TUNE.speedRun, speed);
      target = lerp(C.fov, C.fovRun, run);
      if (p && FOV_BOOST_STATES[p.state] === 1) target += FOV_MOVE_BOOST;
    }
    target += FOV_UNDERWATER * this._underwater;

    this._fovBase = dt > 0 ? damp(this._fovBase, target, lam, dt) : target;
    const wanted = this._fovBase + this._pFovX;
    this.fov = wanted;
    if (!cam || !cam.isPerspectiveCamera) return;
    if (Math.abs(wanted - this._fovApplied) > FOV_EPS) {
      cam.fov = wanted;
      cam.updateProjectionMatrix();
      this._fovApplied = wanted;
    }
  }

  _updateOutputs(dt) {
    const p = this.player;
    // hero fade: peek hides the hero; a close camera fades it before the near plane
    let fade = 0;
    if (this._peekOn) fade = 1;
    else if (!this._cine) fade = 1 - smoothstep(TUNE.cam.minDist, NEAR_FADE_DIST, this.dist);
    this._heroFade = fade;
    if (p) p.heroFade = fade;

    // underwater tell for the post chain
    const sub = !!(p && p.submerged);
    this._underwater = dt > 0 ? damp(this._underwater, sub ? 1 : 0, UNDERWATER_LAMBDA, dt) : (sub ? 1 : 0);
    if (this._underwater < 1e-3) this._underwater = 0;
    if (Math.abs(this._underwater - this._underwaterApplied) > 0.002) {
      const post = this._resolvePost();
      if (post) {
        this._underwaterApplied = this._underwater;
        try { post.setUnderwater(this._underwater); } catch (e) { this._post = null; }
      }
    }
  }

  _resolvePost() {
    if (this._post) return this._post;
    const p = this.player;
    const fx = p && p.fx;
    if (fx && typeof fx.setUnderwater === 'function') { this._post = fx; return fx; }
    if (fx && fx.post && typeof fx.post.setUnderwater === 'function') { this._post = fx.post; return fx.post; }
    const w = this.world;
    if (w && w.post && typeof w.post.setUnderwater === 'function') { this._post = w.post; return w.post; }
    return null;
  }

  /**
   * Normalise a pathDef into typed arrays (allocation happens here, at set
   * time — never per frame). Returns null on an unusable path.
   */
  _normalisePath(def) {
    let keys = null, loop = false, onDone = null;
    if (Array.isArray(def)) keys = def;
    else if (def.orbit) {
      const o = def.orbit;
      const n = 17;
      const c = [0, 0, 0]; readVec3(o.center, c, 0);
      const radius = +o.radius > 0 ? +o.radius : 4.0;
      const height = isFinite(+o.height) ? +o.height : 1.6;
      const dur = +o.duration > 0 ? +o.duration : 2.2;
      const turns = isFinite(+o.turns) ? +o.turns : 0.5;
      const y0 = isFinite(+o.startYaw) ? +o.startYaw : this.yaw;
      keys = new Array(n);
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const a = y0 + turns * Math.PI * 2 * k;
        headingFromYaw(a, _tmp);
        keys[i] = {
          p: [c[0] - _tmp.x * radius, c[1] + height, c[2] - _tmp.z * radius],
          look: [c[0], c[1] + height * 0.35, c[2]],
          t: dur * k, fov: o.fov,
        };
      }
      loop = !!def.loop; onDone = def.onDone || null;
    } else {
      keys = def.keys || def.cam || null;
      loop = !!def.loop; onDone = def.onDone || null;
    }
    if (!keys || keys.length === 0) return null;
    const n = Math.max(2, keys.length);
    const pos = new Float64Array(n * 3), look = new Float64Array(n * 3);
    const times = new Float64Array(n), fov = new Float64Array(n);
    const lookPlayer = new Uint8Array(n);
    let lastT = -1;
    for (let i = 0; i < n; i++) {
      const k = keys[Math.min(i, keys.length - 1)];
      readVec3(k.p || k.pos || k.position, pos, i * 3);
      const lk = k.look !== undefined ? k.look : k.lookAt;
      if (lk === 'player' || lk === undefined || lk === null) { lookPlayer[i] = 1; readVec3(null, look, i * 3); }
      else readVec3(lk, look, i * 3);
      let t = +k.t; if (!isFinite(t)) t = i * 1.0;
      if (i > 0 && t <= lastT) t = lastT + 1e-3;      // must ascend
      if (keys.length === 1 && i === 1) t = lastT + 1;
      times[i] = t; lastT = t;
      fov[i] = isFinite(+k.fov) ? +k.fov : TUNE.cam.fov;
    }
    // path times are relative to the first key
    const t0 = times[0];
    if (t0 !== 0) for (let i = 0; i < n; i++) times[i] -= t0;
    return { n, pos, look, times, fov, lookPlayer, loop, onDone };
  }

  /* ─────────────────────────── teardown ─────────────────────────── */

  dispose() {
    if (this.settings && typeof this.settings.off === 'function') {
      try { this.settings.off(this._onSettings); } catch (_) { /* no-op */ }
    }
    if (this.player && this.player.heroFade !== undefined) this.player.heroFade = 0;
    this._cine = null;
    this._post = null;
  }
}

export default FollowCamera;
