import * as THREE from 'three';
import { FLIGHT } from '../core/config';
import type { Input } from '../core/Input';
import type { Settings } from '../core/types';

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
  private desiredRoll = 0;

  update(dt: number, input: Input, settings: Settings, minAlt: number, maxAlt: number, bounds: number) {
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    const stunned = this.stunTimer > 0;
    const sens = settings.mouseSens * 0.0022;
    const inv = settings.invertY ? -1 : 1;

    // Steer whenever engaged (pointer lock preferred but not required)
    if (input.isControlActive() && !this.lookBack && !stunned) {
      this.euler.y -= input.mouseDX * sens * FLIGHT.mouseYaw;
      this.euler.x -= input.mouseDY * sens * FLIGHT.mousePitch * inv;
      this.euler.x = THREE.MathUtils.clamp(this.euler.x, -Math.PI * 0.45, Math.PI * 0.45);
    }

    this.lookBack = !stunned && input.isDown('KeyE');
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

    // Orientation basis
    this.quaternion.setFromEuler(this.euler);
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

    // Visual roll from yaw rate / strafe
    const yawRate = -input.mouseDX * sens;
    this.desiredRoll = THREE.MathUtils.clamp(strafe * 0.35 + yawRate * 8, -0.5, 0.5);
    this.euler.z = THREE.MathUtils.lerp(this.euler.z, this.desiredRoll * FLIGHT.rollFromYaw, 1 - Math.exp(-6 * dt));
    this.quaternion.setFromEuler(this.euler);
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
      const e = this.euler.clone();
      e.y += Math.PI;
      e.z = -e.z;
      out.setFromEuler(e);
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
