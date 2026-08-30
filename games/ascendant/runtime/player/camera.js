/**
 * ASCENDANT — runtime/player/camera.js
 * ---------------------------------------------------------------------------
 * First-person camera feel. CONTRACT §14.
 *
 *   export class FPCamera {
 *     constructor(camera, player, input, settings);
 *     update(dt);
 *     shake(amount, ms);  dip(amount);  setDeathCam(bool);
 *   }
 *
 * Everything is applied through ONE rig so the transform order can never drift:
 *
 *   rig  (world eye position + dip + death drop + shake translation)
 *    └ yawObj    (rotation.y  — heading)
 *       └ bobObj (bob translation, in yaw space so lateral bob follows facing)
 *          └ pitchObj (rotation.x — pitch + landing nod + death pitch + shake)
 *             └ rollObj  (rotation.z — strafe roll + wall lean + punch + shake)
 *                └ THREE camera (identity; only the projection changes)
 *
 * The rig is a detached root (it lives in no scene), so `rig.updateMatrixWorld(true)`
 * at the end of update() is what keeps the camera's world matrix current — the
 * renderer skips that itself for any camera that has a parent.
 *
 * No per-frame heap allocation: every temporary lives at module scope.
 */

import * as THREE from 'three';
import { TUNE } from '../core/tuning.js';
import { clamp, lerp, damp, smoothstep, easeOutCubic, easeInOutSine } from '../core/util.js';
import { Settings as SettingsSingleton } from '../core/settings.js';

/* ───────────────────────────── constants ───────────────────────────── */

const DEG = Math.PI / 180;

// eye height
const EYE_LAMBDA      = 26;        // exp-damp rate → ~0.12 s to settle stand/crouch

// head bob
const BOB_BLEND_LAMBDA = 20;       // ~0.15 s blend in / out (grounded ↔ air)
const BOB_V_MAX        = 0.045;    // metres, spec ceiling
const BOB_H_MAX        = 0.030;    // metres, spec ceiling
const STRIDE_SLOW      = 3.6;      // metres per FULL cycle (= 2 footsteps) at a crawl
const STRIDE_FAST      = 6.4;      // metres per full cycle at sprint
const BOB_MIN_SPEED    = 0.55;     // below this the accumulator idles
const STEP_SYNC_TIME   = 0.08;     // s to fold a footstep phase correction in

// landing dip (critically damped, analytic — unconditionally stable)
const DIP_MAX_M   = 0.14;
const DIP_OMEGA   = 46;            // (1+ωt)e^-ωt ≈ 0.02 at t = 0.12 s
const IMPACT_REF  = 26;            // m/s of impact that maps to dip = 1
const NOD_MAX     = 1.4 * DEG;
const NOD_OMEGA   = 34;
const COALESCE_S  = 0.06;          // ignore a duplicate land/punch inside this window

// roll
const ROLL_STRAFE = 1.6 * DEG;
const ROLL_WALL   = 0.8 * DEG;
const ROLL_LAMBDA = 9;

// fov
const FOV_SPRINT_ADD  = 8;         // TUNE.fovSprint - TUNE.fovBase
const FOV_CROUCH_ADD  = -6;
const FOV_LAMBDA      = 12;        // ≈ 0.25 s ease, never a snap
const FOV_BOUNCE_KICK = 12;        // degrees, bounce pads
const FOV_BOUNCE_S    = 0.30;
const KICK_RISE_S     = 0.045;

// checkpoint punch
const PUNCH_S    = 0.090;
const PUNCH_FOV  = 1.5;            // degrees
const PUNCH_ROLL = 1.5 * DEG;

// death cam
const DEATH_S      = 0.320;
const DEATH_DROP   = 0.55;         // metres
const DEATH_ROLL   = 9 * DEG;
const DEATH_PITCH  = -12 * DEG;    // negative = look down

// look
const PITCH_LIMIT   = 89 * DEG;
// Input exports the same constant; kept local so camera.js has no core/input.js import.
const RAD_PER_PIXEL = 0.0022;      // radians of yaw/pitch per sens-scaled mouse pixel

/* ───────────────────────────── scratch ───────────────────────────── */

const _spring = { x: 0, v: 0 };
const _right  = new THREE.Vector3();

/**
 * Exact free response of a critically damped 2nd-order system.
 *   x(t) = (x0 + (v0 + ω·x0)·t)·e^(-ω·t)
 * Analytic rather than integrated so a 50 ms frame can never blow it up.
 */
function critDamp(x, v, omega, dt, out) {
  const e = Math.exp(-omega * dt);
  const a = v + omega * x;
  out.x = (x + a * dt) * e;
  out.v = (v - a * omega * dt) * e;
  return out;
}

/** Smooth, cheap, deterministic pseudo-noise in [-1,1]. Three incommensurate sines. */
function shakeNoise(t, seed) {
  return Math.sin(t * 31.1 + seed) * 0.55 +
         Math.sin(t * 17.3 + seed * 2.13) * 0.30 +
         Math.sin(t * 47.7 + seed * 0.71) * 0.15;
}

/** Stride length grows with speed: short choppy steps walking, long strides sprinting. */
function strideLength(speed) {
  return lerp(STRIDE_SLOW, STRIDE_FAST, clamp(speed / TUNE.speedSprint, 0, 1));
}

/* ───────────────────────────── FPCamera ───────────────────────────── */

export class FPCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera  the engine's main camera
   * @param {object} player                   runtime/player/controller.js Player
   * @param {object} input                    runtime/core/input.js Input
   * @param {object} [settings]               runtime/core/settings.js Settings (falls back to the singleton)
   * @param {object} [post]                   runtime/fx/post.js Post — for the death-cam desaturation
   */
  constructor(camera, player, input, settings = null, post = null) {
    this.camera   = camera;
    this.player   = player;
    this.input    = input;
    this.settings = settings || SettingsSingleton;

    // ── rig ────────────────────────────────────────────────────────────────
    this.rig      = new THREE.Object3D();  this.rig.name      = 'fpcam.rig';
    this.yawObj   = new THREE.Object3D();  this.yawObj.name   = 'fpcam.yaw';
    this.bobObj   = new THREE.Object3D();  this.bobObj.name   = 'fpcam.bob';
    this.pitchObj = new THREE.Object3D();  this.pitchObj.name = 'fpcam.pitch';
    this.rollObj  = new THREE.Object3D();  this.rollObj.name  = 'fpcam.roll';
    this.rig.add(this.yawObj);
    this.yawObj.add(this.bobObj);
    this.bobObj.add(this.pitchObj);
    this.pitchObj.add(this.rollObj);
    this.rig.matrixAutoUpdate = true;
    if (camera) {
      if (camera.parent) camera.parent.remove(camera);
      camera.position.set(0, 0, 0);
      camera.quaternion.identity();
      this.rollObj.add(camera);
    }

    // ── look state ─────────────────────────────────────────────────────────
    this._yaw   = 0;
    this._pitch = 0;
    this._ownsLook = !(player && typeof player.addLook === 'function');

    // Look plumbing. `player.addLook(dx, dy)` takes RADIANS — it does `yaw -= dx`
    // straight — so pixels must be converted before they get there. And contract §4
    // says input.look is "already sens-scaled" (core/input.js also folds in the
    // invert-Y sign), so applying Settings.sens here as well would square the user's
    // setting. Resolve both questions once, at construction:
    //   'rad' → input.lookRad : radians, sens + invertY already applied  (core/input.js)
    //   'px'  → input.look    : sens-scaled pixels, camera converts to radians
    //   'raw' → input.lookRaw : untouched pixels, camera owns sens + invertY + convert
    this._lookSrc = (input && input.lookRad) ? 'rad' : ((input && input.lookRaw) ? 'raw' : 'px');
    this._inputScalesSens = this._lookSrc !== 'raw' && !!(input && (
      typeof input.sensitivity === 'number' ||   // core/input.js
      typeof input.sens === 'number' ||
      input.sensApplied === true ||
      this._lookSrc === 'rad'
    ));

    // ── feel state ─────────────────────────────────────────────────────────
    this.eyeHeight   = TUNE.eye;
    this.speedFactor = 0;          // 0..1, horizontal speed above run speed (post / speed lines)
    this.bobPhase    = 0;          // radians; bob bottom at π/2 + kπ (== footstep)
    this.bobX        = 0;
    this.bobY        = 0;
    this._bobBlend   = 0;
    this._phaseFix   = 0;          // pending footstep phase correction (radians)

    this._dipX = 0; this._dipV = 0;
    this._nodX = 0; this._nodV = 0;
    this._lastDipT = -1;

    this._roll = 0;

    this._fovBase   = TUNE.fovBase;
    this._fovTarget = TUNE.fovBase;
    this._fovApplied = -1;
    this._kickAmt = 0; this._kickT = 0; this._kickDur = 0;

    this._punchT = PUNCH_S + 1; this._punchSign = 1; this._punchScale = 1; this._lastPunchT = -1;

    this._shakeAmp = 0; this._shakeT = 0; this._shakeDur = 0; this._shakeSeed = 0;
    this._shakeX = 0; this._shakeY = 0; this._shakePitch = 0; this._shakeRoll = 0;

    this._deathOn = false;
    this._deathT  = 0;
    this._damageApplied = -1;

    this._time = 0;
    this._base = new THREE.Vector3();

    // ── settings ───────────────────────────────────────────────────────────
    this._sens = 1; this._invertY = false; this._fovUser = TUNE.fovBase; this._comfort = 1;
    this._onSettings = () => this._readSettings();
    this._readSettings();
    if (this.settings && typeof this.settings.on === 'function') this.settings.on(this._onSettings);

    // ── post (death desaturation) ──────────────────────────────────────────
    this.post = null;
    this.setPost(post);

    // ── player events ──────────────────────────────────────────────────────
    this._events = (player && player.events && typeof player.events.on === 'function') ? player.events : null;
    this._hLand       = (impact, surface) => this.land(impact, surface);
    this._hStep       = () => this.syncFootstep();
    this._hBounce     = () => this.kick(FOV_BOUNCE_KICK, FOV_BOUNCE_S * 1000);
    // No 'checkpoint' listener here. Checkpoints are detected by Stage and owned by
    // Game, which calls camera.punch() directly — the player emitter never carries them.
    if (this._events) {
      this._events.on('land', this._hLand);
      this._events.on('step', this._hStep);
      this._events.on('bounce', this._hBounce);
    }

    // Let the viewmodel phase-lock its arm pump to the head bob without a hard
    // module dependency (additive only — never overwrites an existing handle).
    if (player && player.fpCamera === undefined) {
      try { player.fpCamera = this; } catch (_) { /* frozen player object — fine */ }
    }

    // Seed yaw/pitch from the player if it already spawned.
    this._pullLookFromPlayer();
    this._composeRig();
  }

  /* ─────────────────────────── public API ─────────────────────────── */

  /** Post instance used for the death-cam desaturation. Resolved lazily if not passed in. */
  setPost(post) {
    if (post && typeof post.setDamage === 'function') { this.post = post; return; }
    const fx = this.player && this.player.fx;
    if (fx && typeof fx.setDamage === 'function') { this.post = fx; return; }
    if (fx && fx.post && typeof fx.post.setDamage === 'function') { this.post = fx.post; return; }
    if (post && post.post && typeof post.post.setDamage === 'function') { this.post = post.post; return; }
  }

  /**
   * Additive decaying camera shake.
   * @param {number} amount 0..1-ish (0.4 = a solid hit, 1 = an explosion)
   * @param {number} ms     duration
   */
  shake(amount, ms = 220) {
    const a = Math.max(0, Number(amount) || 0);
    if (a <= 0) return;
    // Take the stronger of the two so a small shake can never cut a big one short.
    const remaining = this._shakeDur > 0 ? this._shakeAmp * (1 - this._shakeT / this._shakeDur) : 0;
    this._shakeAmp = Math.max(a, remaining);
    this._shakeT   = 0;
    this._shakeDur = Math.max(0.02, (Number(ms) || 220) / 1000);
    this._shakeSeed = (this._shakeSeed + 7.13) % 1000;
  }

  /**
   * Camera dip. `amount` is normalised: 1 == the full DIP_MAX_M drop.
   *
   * A NEGATIVE amount is a LIFT rather than a drop, and it also fires the
   * checkpoint punch — that is how game.js signals a checkpoint (`dip(-0.06)`),
   * and a lift plus a 1.5 deg FOV/roll pulse is exactly the accent that wants.
   *
   * Coalesced, so a Game-side call plus the player's own 'land' event dip once.
   */
  dip(amount) {
    const raw = Number(amount) || 0;
    if (raw < 0) {
      const lift = Math.min(1, -raw) * DIP_MAX_M * this._comfort;
      if (lift > this._dipX) { this._dipX = lift; this._dipV = 0; }
      this.punch(1);
      return;
    }
    const a = clamp(raw, 0, 1);
    if (a <= 0) return;
    const t = this._time;
    if (this._lastDipT >= 0 && t - this._lastDipT < COALESCE_S && -this._dipX >= a * DIP_MAX_M * this._comfort * 0.9) return;
    this._lastDipT = t;

    const drop = -a * DIP_MAX_M * this._comfort;
    if (drop < this._dipX) { this._dipX = drop; this._dipV = 0; }

    // Big landings nod the head down as well.
    const nod = -NOD_MAX * smoothstep(0.42, 1.0, a) * this._comfort;
    if (nod < this._nodX) { this._nodX = nod; this._nodV = 0; }

    if (a > 0.55) this.shake(0.12 * a, 130);
  }

  /** Convenience: convert a land impact speed (m/s) into a dip. */
  land(impactSpeed, _surface) {
    this.dip(clamp((Number(impactSpeed) || 0) / IMPACT_REF, 0, 1));
  }

  /** A short additive FOV kick that rises fast and eases out. Never snaps. */
  kick(degrees = TUNE.fovKick, ms = 300) {
    const d = Number(degrees) || 0;
    if (d === 0) return;
    const cur = this._kickCurrent();
    this._kickAmt = Math.max(Math.abs(d), cur) * Math.sign(d || 1);
    this._kickT   = 0;
    this._kickDur = Math.max(KICK_RISE_S + 0.02, (Number(ms) || 300) / 1000);
  }

  /** Checkpoint punch — a 90 ms, 1.5° FOV + roll pulse. */
  punch(scale = 1) {
    const t = this._time;
    if (this._lastPunchT >= 0 && t - this._lastPunchT < COALESCE_S) return;
    this._lastPunchT = t;
    this._punchT = 0;
    this._punchScale = clamp(Number(scale) || 1, 0, 3);
    this._punchSign = -this._punchSign;
  }

  /**
   * Death cam. true → drop 0.55 m, roll 9°, pitch down 12° over 320 ms and
   * ramp post.setDamage 0→1. false → restore instantly (respawn must be crisp).
   */
  setDeathCam(on) {
    const v = !!on;
    if (v === this._deathOn) return;
    this._deathOn = v;
    if (!v) {
      this._deathT = 0;
      this._applyDamage(0);
      // A death is always followed by a respawn teleport — clear transient state
      // so the player never gets handed a camera mid-wobble.
      this._dipX = 0; this._dipV = 0;
      this._nodX = 0; this._nodV = 0;
      this._shakeAmp = 0; this._shakeDur = 0;
      this._shakeX = this._shakeY = this._shakePitch = this._shakeRoll = 0;
      this._kickAmt = 0; this._kickDur = 0;
      this._punchT = PUNCH_S + 1;
      this._bobBlend = 0; this._phaseFix = 0;
    }
  }

  /** Snap the bob phase so its next bottom coincides with this footstep. */
  syncFootstep() {
    // Bob bottoms sit at φ = π/2 + kπ. Fold the shortest correction in over ~80 ms
    // rather than snapping, so a resync is never visible as a jolt.
    const target = Math.round((this.bobPhase - Math.PI * 0.5) / Math.PI) * Math.PI + Math.PI * 0.5;
    let d = target - this.bobPhase;
    while (d > Math.PI * 0.5) d -= Math.PI;
    while (d < -Math.PI * 0.5) d += Math.PI;
    this._phaseFix = d;
  }

  get yaw()   { return this._yaw; }
  get pitch() { return this._pitch; }
  get fov()   { return this._fovApplied; }
  get deathCam() { return this._deathOn; }

  /* ─────────────────────────── main update ─────────────────────────── */

  update(dt) {
    const d = clamp(Number(dt) || 0, 0, 1 / 15);
    this._time += d;

    const player = this.player;
    const input  = this.input;

    // 1 ── look ------------------------------------------------------------
    this._consumeLook(d);
    this._pullLookFromPlayer();

    // 2 ── eye height ------------------------------------------------------
    const crouching = !!(player && player.crouching);
    const eyeTarget = crouching ? TUNE.crouchEye : TUNE.eye;
    this.eyeHeight = damp(this.eyeHeight, eyeTarget, EYE_LAMBDA, d);

    // 3 ── speed factor ----------------------------------------------------
    let hSpeed = 0;
    if (player && player.vel) {
      const vx = player.vel.x, vz = player.vel.z;
      hSpeed = Math.sqrt(vx * vx + vz * vz);
    }
    const sf = clamp((hSpeed - TUNE.speedRun) / Math.max(0.001, TUNE.speedSprint - TUNE.speedRun), 0, 1);
    this.speedFactor = damp(this.speedFactor, sf, 8, d);

    // 4 ── head bob --------------------------------------------------------
    this._updateBob(d, hSpeed, !!(player && player.grounded));

    // 5 ── landing dip + nod ----------------------------------------------
    critDamp(this._dipX, this._dipV, DIP_OMEGA, d, _spring);
    this._dipX = _spring.x; this._dipV = _spring.v;
    if (Math.abs(this._dipX) < 1e-5 && Math.abs(this._dipV) < 1e-4) { this._dipX = 0; this._dipV = 0; }

    critDamp(this._nodX, this._nodV, NOD_OMEGA, d, _spring);
    this._nodX = _spring.x; this._nodV = _spring.v;
    if (Math.abs(this._nodX) < 1e-6 && Math.abs(this._nodV) < 1e-5) { this._nodX = 0; this._nodV = 0; }

    // 6 ── roll ------------------------------------------------------------
    this._updateRoll(d);

    // 7 ── punch + fov -----------------------------------------------------
    this._updatePunch(d);
    this._updateFov(d, crouching);

    // 8 ── shake -----------------------------------------------------------
    this._updateShake(d);

    // 9 ── death cam -------------------------------------------------------
    if (this._deathOn && this._deathT < 1) {
      this._deathT = Math.min(1, this._deathT + d / DEATH_S);
      this._applyDamage(easeOutCubic(this._deathT));
    }

    // 10 ── compose --------------------------------------------------------
    this._composeRig();
  }

  /* ─────────────────────────── internals ─────────────────────────── */

  _readSettings() {
    const s = (this.settings && typeof this.settings.get === 'function')
      ? (this.settings.get() || {})
      : (this.settings || {});
    this._sens    = (typeof s.sens === 'number' && isFinite(s.sens)) ? clamp(s.sens, 0.05, 10) : 1;
    this._invertY = !!s.invertY;
    this._fovUser = (typeof s.fov === 'number' && isFinite(s.fov)) ? clamp(s.fov, 60, 120) : TUNE.fovBase;
    // `motionBlurDip` is the comfort toggle for the impact effects — when it is off
    // the dip/bob still exist (they carry information) but at a third of the amplitude.
    this._comfort = (s.motionBlurDip === false) ? 0.35 : 1;
    this.sensMultiplier = this._inputScalesSens ? 1 : this._sens;
  }

  _consumeLook(dt) {
    const input = this.input;
    if (!input) return;
    const mode = this._lookSrc;
    const src = mode === 'rad' ? input.lookRad : (mode === 'raw' ? input.lookRaw : input.look);
    if (!src) return;

    let dx = Number(src.dx) || 0;
    let dy = Number(src.dy) || 0;

    // Consume every mirror of this frame's delta — the contract says the camera owns
    // them, and leaving a stale copy behind would let a second reader double-apply it.
    if (input.look)    { input.look.dx = 0;    input.look.dy = 0; }
    if (input.lookRad) { input.lookRad.dx = 0; input.lookRad.dy = 0; }
    if (input.lookRaw) { input.lookRaw.dx = 0; input.lookRaw.dy = 0; }

    if (dx === 0 && dy === 0) return;
    if (this._deathOn) return;                        // frozen while dying
    if (input.suspended) return;                      // menu open — swallow, never accumulate

    if (!this._inputScalesSens) {
      const m = this._sens;
      dx *= m;
      dy *= m * (this._invertY ? -1 : 1);
    }
    if (mode !== 'rad') { dx *= RAD_PER_PIXEL; dy *= RAD_PER_PIXEL; }   // pixels → radians

    const player = this.player;
    if (!this._ownsLook) {
      player.addLook(dx, dy);                         // addLook() is in RADIANS
    } else {
      this._yaw   -= dx;
      this._pitch -= dy;
      if (this._yaw > Math.PI) this._yaw -= Math.PI * 2;
      else if (this._yaw < -Math.PI) this._yaw += Math.PI * 2;
      this._pitch = clamp(this._pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }
  }

  _pullLookFromPlayer() {
    const p = this.player;
    if (!p) return;
    if (typeof p.yaw === 'number')   this._yaw   = p.yaw;
    if (typeof p.pitch === 'number') this._pitch = clamp(p.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  _updateBob(dt, hSpeed, grounded) {
    const want = (grounded && hSpeed > BOB_MIN_SPEED && !this._deathOn) ? 1 : 0;
    this._bobBlend = damp(this._bobBlend, want, BOB_BLEND_LAMBDA, dt);
    if (this._bobBlend < 1e-4) this._bobBlend = 0;

    if (want) {
      // Phase is driven by DISTANCE, not time, so it stays honest through
      // acceleration and matches the footstep accumulator exactly.
      const stride = strideLength(hSpeed);
      this.bobPhase += (Math.PI * 2) * (hSpeed * dt) / stride;
    }

    // fold in a pending footstep resync
    if (this._phaseFix !== 0) {
      const step = this._phaseFix * Math.min(1, dt / STEP_SYNC_TIME);
      this.bobPhase += step;
      this._phaseFix -= step;
      if (Math.abs(this._phaseFix) < 1e-4) this._phaseFix = 0;
    }
    if (this.bobPhase > Math.PI * 2) this.bobPhase -= Math.PI * 2;
    else if (this.bobPhase < 0) this.bobPhase += Math.PI * 2;

    // Two-axis Lissajous: vertical at 2f (one dip per footstep), horizontal at 1f
    // (weight shifting onto the planted foot). Amplitude scales with speed.
    const amp = clamp(hSpeed / TUNE.speedSprint, 0, 1) * this._bobBlend * this._comfort;
    const p = this.bobPhase;
    this.bobY = -BOB_V_MAX * amp * (0.5 - 0.5 * Math.cos(2 * p));   // 0 at top, -max at φ=π/2, 3π/2
    this.bobX =  BOB_H_MAX * amp * Math.sin(p);
  }

  _updateRoll(dt) {
    const input  = this.input;
    const player = this.player;

    let strafe = 0;
    if (input && input.move && !input.suspended) strafe = clamp(Number(input.move.x) || 0, -1, 1);
    let target = -strafe * ROLL_STRAFE;                       // roll toward -sign(strafe)

    if (player && player.wallSliding) {
      // Lean into the wall. rotation.z > 0 reads as "leaning left", and a wall
      // normal points from the wall toward the player, so right·n > 0 ⇒ wall on the left.
      let side = Math.sign(strafe) || 0;
      const n = player.wallNormal || (player.walls && player.walls[0] && player.walls[0].normal);
      if (n) {
        _right.set(Math.cos(this._yaw), 0, -Math.sin(this._yaw));   // camera right for yaw about +Y
        const dot = _right.x * n.x + _right.z * n.z;
        if (Math.abs(dot) > 0.05) side = Math.sign(dot);
      }
      if (side === 0) side = 1;
      target += side * ROLL_WALL;
    }

    this._roll = damp(this._roll, target, ROLL_LAMBDA, dt);
  }

  _kickCurrent() {
    if (this._kickDur <= 0 || this._kickT >= this._kickDur) return 0;
    const t = this._kickT;
    if (t < KICK_RISE_S) return this._kickAmt * (t / KICK_RISE_S);
    const k = (t - KICK_RISE_S) / (this._kickDur - KICK_RISE_S);
    return this._kickAmt * (1 - easeOutCubic(clamp(k, 0, 1)));
  }

  _updateFov(dt, crouching) {
    const cam = this.camera;
    if (!cam || !cam.isPerspectiveCamera) return;
    const player = this.player;

    let base = this._fovUser;
    if (player && player.sprinting && !player.crouching) base += FOV_SPRINT_ADD * clamp(0.35 + this.speedFactor, 0, 1);
    if (crouching) base += FOV_CROUCH_ADD;
    this._fovTarget = base;
    this._fovBase = damp(this._fovBase, this._fovTarget, FOV_LAMBDA, dt);

    if (this._kickDur > 0) {
      this._kickT += dt;
      if (this._kickT >= this._kickDur) { this._kickDur = 0; this._kickAmt = 0; this._kickT = 0; }
    }

    const punchEnv = this._punchEnv();
    const wanted = this._fovBase + this._kickCurrent() + PUNCH_FOV * punchEnv * (this._punchScale || 1);

    // 0.008 deg of an 82 deg FOV is 1 part in 10 000 — invisible, but it stops a
    // settled FOV from re-running three's projection rebuild every single frame.
    if (Math.abs(wanted - this._fovApplied) > 0.008) {
      cam.fov = wanted;
      cam.updateProjectionMatrix();
      this._fovApplied = wanted;
    }
  }

  _punchEnv() {
    if (this._punchT >= PUNCH_S) return 0;
    // single smooth up-and-back pulse over 90 ms
    return Math.sin(Math.PI * (this._punchT / PUNCH_S));
  }

  _updatePunch(dt) {
    if (this._punchT < PUNCH_S) this._punchT += dt;
  }

  _updateShake(dt) {
    if (this._shakeDur <= 0) {
      this._shakeX = this._shakeY = this._shakePitch = this._shakeRoll = 0;
      return;
    }
    this._shakeT += dt;
    if (this._shakeT >= this._shakeDur) {
      this._shakeDur = 0; this._shakeAmp = 0;
      this._shakeX = this._shakeY = this._shakePitch = this._shakeRoll = 0;
      return;
    }
    const k = 1 - this._shakeT / this._shakeDur;
    const decay = k * k;
    const a = this._shakeAmp * decay * this._comfort;
    const t = this._shakeT;
    const s = this._shakeSeed;
    this._shakeX     = shakeNoise(t, s)         * a * 0.030;
    this._shakeY     = shakeNoise(t, s + 11.7)  * a * 0.026;
    this._shakePitch = shakeNoise(t, s + 23.4)  * a * 0.9 * DEG;
    this._shakeRoll  = shakeNoise(t, s + 37.9)  * a * 1.4 * DEG;
  }

  _applyDamage(v) {
    if (!this.post) this.setPost(null);
    if (!this.post) return;
    const q = clamp(v, 0, 1);
    if (Math.abs(q - this._damageApplied) < 0.002) return;
    this._damageApplied = q;
    try { this.post.setDamage(q); } catch (_) { this.post = null; }
  }

  _composeRig() {
    const player = this.player;
    const rig = this.rig;

    // eye position — cached so a frame with no player never accumulates offsets
    const src = (player && (player.renderPos || player.pos)) || null;
    if (src) this._base.set(src.x, src.y, src.z);
    let eye = this.eyeHeight;

    // death cam
    let deathRoll = 0, deathPitch = 0;
    if (this._deathT > 0) {
      const e = easeInOutSine(clamp(this._deathT, 0, 1));
      eye       -= DEATH_DROP * e;
      deathRoll  = DEATH_ROLL * e;
      deathPitch = DEATH_PITCH * e;
    }

    rig.position.set(this._base.x, this._base.y + eye + this._dipX + this._shakeY, this._base.z);

    // yaw
    this.yawObj.rotation.set(0, this._yaw, 0);

    // bob translation lives in yaw space (lateral bob follows facing, not pitch)
    this.bobObj.position.set(this.bobX + this._shakeX, this.bobY, 0);

    // pitch
    this.pitchObj.rotation.set(
      clamp(this._pitch + this._nodX + deathPitch + this._shakePitch, -PITCH_LIMIT - 0.3, PITCH_LIMIT + 0.3),
      0, 0
    );

    // roll
    const punchRoll = PUNCH_ROLL * this._punchEnv() * this._punchSign * (this._punchScale || 1);
    this.rollObj.rotation.set(0, 0, this._roll + deathRoll + punchRoll + this._shakeRoll);

    // Keep ownership of the camera even if something reparented it, then push the
    // whole detached rig through matrix update — the renderer will not do it for a
    // camera that has a parent.
    const cam = this.camera;
    if (cam && cam.parent !== this.rollObj) {
      if (cam.parent) cam.parent.remove(cam);
      cam.position.set(0, 0, 0);
      cam.quaternion.identity();
      cam.scale.set(1, 1, 1);
      this.rollObj.add(cam);
    }
    rig.updateMatrixWorld(true);
  }

  /* ─────────────────────────── teardown ─────────────────────────── */

  dispose() {
    if (this.settings && typeof this.settings.off === 'function') {
      try { this.settings.off(this._onSettings); } catch (_) { /* no-op */ }
    }
    const ev = this._events;
    if (ev && typeof ev.off === 'function') {
      try {
        ev.off('land', this._hLand);
        ev.off('step', this._hStep);
        ev.off('bounce', this._hBounce);
      } catch (_) { /* no-op */ }
    }
    this._events = null;
    if (this.camera && this.camera.parent === this.rollObj) this.rollObj.remove(this.camera);
    if (this.player && this.player.fpCamera === this) this.player.fpCamera = undefined;
  }
}

export default FPCamera;
