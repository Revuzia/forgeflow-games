import * as THREE from 'three';
import { FLIGHT } from '../core/config';
import type { Input } from '../core/Input';
import type { Settings } from '../core/types';

// Body-frame axes for local-space rotation integration (shared, never mutated).
const AXIS_RIGHT = new THREE.Vector3(1, 0, 0); // local +X (right wing)
const AXIS_UP = new THREE.Vector3(0, 1, 0); // local +Y (canopy up)
const AXIS_FWD = new THREE.Vector3(0, 0, -1); // local -Z (nose)
/** Pitch clamp — the nose stops just short of vertical so the view never
 *  gimbal-flips past straight up/down (fixes the old stuck-sideways attitude). */
const MAX_PITCH = THREE.MathUtils.degToRad(82);
/** Max cosmetic bank (visual roll) when hard-turning or holding Q/E. */
const MAX_BANK = THREE.MathUtils.degToRad(28);
/** How strongly yaw-rate leans the bank into a turn. */
const BANK_PER_YAWRATE = 0.16;
/** Bank ease + auto-level responsiveness (higher = snappier return to level). */
const BANK_LERP = 5;

export class FlightController {
  position = new THREE.Vector3(0, 40, 0);
  velocity = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  euler = new THREE.Euler(0, 0, 0, 'YXZ');

  energy = FLIGHT.energyMax;
  boosting = false;
  speed = 0;
  lookBack = false;
  zooming = false;
  /** Seconds of control lockout (lightning stun, etc.). */
  stunTimer = 0;

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  // Reused per-axis delta rotation (no per-frame allocation).
  private qDelta = new THREE.Quaternion();
  // 180° about local up — rear-view flip that stays correct while looping/inverted.
  private lookBackFlip = new THREE.Quaternion().setFromAxisAngle(AXIS_UP, Math.PI);

  /**
   * @param roll Optional manual roll axis in [-1, 1] (positive = roll right /
   *   bank right). Wired from Game.ts (Q/E) — see integration notes. Combines
   *   additively with the built-in Q/E read below and is clamped, so double
   *   binding never runs away. Defaults to 0 so existing callers still compile.
   */
  update(
    dt: number,
    input: Input,
    settings: Settings,
    minAlt: number,
    maxAlt: number,
    bounds: number,
    roll = 0
  ) {
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    const stunned = this.stunTimer > 0;
    const sens = settings.mouseSens * 0.0022;
    const inv = settings.invertY ? -1 : 1;

    // --- Orientation: world-up yaw + clamped pitch, with an auto-leveling bank.
    // The euler (YXZ) is the authority: euler.y = heading (world up), euler.x =
    // pitch (clamped short of vertical), euler.z = cosmetic bank that always eases
    // back to level. The old unclamped body-frame 6DOF model coupled yaw+pitch
    // into roll, which left the camera stuck sideways and never cleanly looped.
    // (Owner 2026-07-17.)
    let bankTarget = 0;
    if (input.isControlActive() && !this.lookBack && !stunned) {
      const yawDelta = -input.mouseDX * sens * FLIGHT.mouseYaw;
      const pitchDelta = -input.mouseDY * sens * FLIGHT.mousePitch * inv;

      // Optional intentional roll (Q/E + external axis) leans the bank harder but
      // still auto-levels — never a permanent sideways attitude.
      let rollAxis = 0;
      if (input.isDown('KeyQ')) rollAxis -= 1;
      if (input.isDown('KeyE')) rollAxis += 1;
      rollAxis = THREE.MathUtils.clamp(rollAxis + roll, -1, 1);

      this.euler.y += yawDelta;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x + pitchDelta, -MAX_PITCH, MAX_PITCH);

      const yawRate = yawDelta / Math.max(dt, 1e-4);
      bankTarget = THREE.MathUtils.clamp(
        -yawRate * BANK_PER_YAWRATE + rollAxis * MAX_BANK,
        -MAX_BANK,
        MAX_BANK
      );
    }
    // Bank (visual roll) always eases toward its target — 0 when not turning — so
    // the horizon can never stick sideways. euler stays the source of truth.
    const bankK = 1 - Math.exp(-BANK_LERP * dt);
    this.euler.z = THREE.MathUtils.lerp(this.euler.z, bankTarget, bankK);
    this.quaternion.setFromEuler(this.euler);

    // Look-back (rear glance) moved to KeyC — E is now roll-right. Read after
    // steering so this frame's roll/steer use the prior lookBack state (matches
    // the original one-frame ordering).
    this.lookBack = !stunned && input.isDown('KeyC');
    this.zooming = !stunned && input.isMouseDown(1);
    // RMB = afterburner (button 2)
    const wantBoost = !stunned && (input.isMouseDown(2) || input.isDown('KeyB'));
    this.boosting = wantBoost && this.energy > 1;

    if (this.boosting) {
      this.energy = Math.max(0, this.energy - FLIGHT.energyDrain * dt);
      if (this.energy <= 0) this.boosting = false;
    } else {
      this.energy = Math.min(FLIGHT.energyMax, this.energy + FLIGHT.energyRegen * dt);
    }

    // Orientation basis (after the rotation update above)
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);

    // Thrust inputs (disabled while stunned)
    let thrust = 0;
    let strafe = 0;
    let vert = 0;
    if (!stunned) {
      if (input.isDown('KeyW')) thrust += 1;
      if (input.isDown('KeyS')) thrust -= 0.7;
      if (input.isDown('KeyD')) strafe += 1;
      if (input.isDown('KeyA')) strafe -= 1;
      if (input.isDown('Space')) vert += 1;
      if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) vert -= 1;
    }

    const maxSp = this.boosting ? FLIGHT.afterburnerMax : FLIGHT.maxSpeed;
    const drag = this.boosting ? FLIGHT.afterburnerDrag : FLIGHT.drag;

    this.tmp.copy(this.forward).multiplyScalar(thrust * FLIGHT.accel * (this.boosting ? 1.6 : 1));
    this.velocity.addScaledVector(this.tmp, dt);
    this.tmp.copy(this.right).multiplyScalar(strafe * FLIGHT.strafeAccel);
    this.velocity.addScaledVector(this.tmp, dt);
    this.tmp.copy(this.up).multiplyScalar(vert * FLIGHT.verticalAccel);
    this.velocity.addScaledVector(this.tmp, dt);

    // Drag
    const damp = Math.exp(-drag * dt);
    this.velocity.multiplyScalar(damp);

    // Cap speed
    this.speed = this.velocity.length();
    if (this.speed > maxSp) {
      this.velocity.multiplyScalar(maxSp / this.speed);
      this.speed = maxSp;
    }

    // Position integration happens in Game via integrateSubstep + solid collision
    // so high-speed ships don't tunnel through buildings. Still soft-clamp here as fallback.
    this.position.addScaledVector(this.velocity, dt);
    this.clampWorld(minAlt, maxAlt, bounds);
  }

  bounce(normal: THREE.Vector3, damageScale = 1) {
    const vn = this.velocity.dot(normal);
    if (vn < 0) {
      // Kill into-wall velocity + bounce
      this.velocity.addScaledVector(normal, -vn * (1 + FLIGHT.bounceRestitution));
    } else {
      // Still sliding along surface — damp outward component slightly
      this.velocity.addScaledVector(normal, Math.min(8, vn * 0.15));
    }
    // Extra separation so next frame isn't still intersecting at high speed
    this.position.addScaledVector(normal, 0.35);
    // Cap residual speed after impact so we don't re-tunnel immediately
    const sp = this.velocity.length();
    if (sp > FLIGHT.maxSpeed * 0.85) {
      this.velocity.multiplyScalar((FLIGHT.maxSpeed * 0.85) / sp);
    }
    this.speed = this.velocity.length();
    return Math.min(FLIGHT.collisionDamage * damageScale, Math.abs(vn) * 0.85 + 2);
  }

  /** Integrate position in substeps for collision (call from Game). */
  integrateSubstep(dt: number) {
    this.position.addScaledVector(this.velocity, dt);
  }

  clampWorld(minAlt: number, maxAlt: number, bounds: number) {
    this.position.y = THREE.MathUtils.clamp(this.position.y, minAlt, maxAlt);
    const lim = bounds * 0.95;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -lim, lim);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -lim, lim);
  }

  getAimDirection(out: THREE.Vector3) {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  getCameraQuaternion(out: THREE.Quaternion) {
    if (this.lookBack) {
      // Rear view: 180° about the ship's own up axis. Works in any attitude
      // (looping / inverted), unlike the old euler-based flip.
      out.copy(this.quaternion).multiply(this.lookBackFlip);
    } else {
      out.copy(this.quaternion);
    }
    return out;
  }

  reset(pos: THREE.Vector3, yaw = 0) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.euler.set(0, yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.energy = FLIGHT.energyMax;
    this.boosting = false;
    this.speed = 0;
    this.stunTimer = 0;
  }

  applyStun(seconds: number) {
    this.stunTimer = Math.max(this.stunTimer, seconds);
    this.boosting = false;
    this.velocity.multiplyScalar(0.35);
  }
}
