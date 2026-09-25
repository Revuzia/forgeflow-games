// DYEFIELD — third-person FollowCamera (CONTRACT §5.1, DESIGN §2 camera table).
// Pivot 1.35 m over the feet, 4.3 m boom, 0.42 m right shoulder, vertical FOV 68°, rest pitch −14°,
// pitch clamp −65°…+40°. Mouse yaw/pitch under pointer lock (mouse-right decreases yaw — CONTRACT §2).
// A sphere-cast pulls the boom in instantly when geometry is in the way and eases it back out.
// The pivot is smoothed vertically only (steps / landings) with a 0.05 s time constant, so it never
// lags the runner by more than ~0.15 s; horizontally it rides the already-interpolated render pose.

import * as THREE from 'three';
import { CAMERA } from '../core/config.ts';
import { DEG } from '../core/types.ts';
import type { PhysicsWorld } from '../core/physics.ts';

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** radians; 0 looks toward +Z */
  yaw = 0;
  /** radians; + looks up */
  pitch = CAMERA.restPitchDeg * DEG;
  /** 0 = walk framing, 1 = slick framing — eased toward slickTarget every update (≈ 0.15 s) */
  slickBlend = 0;
  /** 1 while the runner is in SLICK / WALL-SLICK (game.ts sets it each frame) */
  slickTarget = 0;
  /** screen shake energy (hits taken, the WASHED pop); decays ~6/s */
  shake = 0;
  /** current boom length after collision (m) */
  boom = CAMERA.distance;
  /** true when the last update pulled the boom in */
  obstructed = false;

  private readonly pivot = new THREE.Vector3();
  private pivotYs = NaN;
  private readonly tmp = new THREE.Vector3();
  private shakeT = 0;

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, aspect, 0.08, 2400);
    this.camera.rotation.order = 'YXZ';
  }

  /** Point the camera along a yaw (e.g. the spawn facing) at the rest pitch. */
  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = CAMERA.restPitchDeg * DEG;
    this.pivotYs = NaN;
    this.boom = CAMERA.distance;
    this.slickBlend = 0;
    this.slickTarget = 0;
    this.shake = 0;
  }

  addMouse(dx: number, dy: number): void {
    if (!dx && !dy) return;
    this.yaw -= dx * CAMERA.sensitivity;
    this.pitch -= dy * CAMERA.sensitivity;
    const TAU = Math.PI * 2;
    if (this.yaw > Math.PI) this.yaw -= TAU;
    else if (this.yaw < -Math.PI) this.yaw += TAU;
    this.pitch = Math.min(CAMERA.maxPitchDeg * DEG, Math.max(CAMERA.minPitchDeg * DEG, this.pitch));
  }

  /** forward look direction (unit) */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  /**
   * @param feet  the runner's interpolated feet position (render pose)
   * @param physics  collision for the boom pull-in (null = no collision)
   */
  update(dt: number, feet: { x: number; y: number; z: number }, physics: PhysicsWorld | null): void {
    // SLICK tuck: pivot down + boom in, smoothly both ways (CONTRACT §11)
    const kb = 1 - Math.exp(-Math.max(0, dt) * 11);
    this.slickBlend += (this.slickTarget - this.slickBlend) * kb;
    if (Math.abs(this.slickTarget - this.slickBlend) < 1e-3) this.slickBlend = this.slickTarget;
    const s = this.slickBlend;
    const pivotY = CAMERA.pivotY + (CAMERA.slickPivotY - CAMERA.pivotY) * s;
    const dist = CAMERA.distance + (CAMERA.slickDistance - CAMERA.distance) * s;

    // vertical smoothing of the pivot (snap on big jumps such as a respawn / teleport)
    const ty = feet.y + pivotY;
    if (!Number.isFinite(this.pivotYs) || Math.abs(ty - this.pivotYs) > 3) this.pivotYs = ty;
    else this.pivotYs += (ty - this.pivotYs) * (1 - Math.exp(-Math.max(0, dt) / CAMERA.pivotLag));
    this.pivot.set(feet.x, this.pivotYs, feet.z);

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const rx = -cy, rz = sy;                               // screen-right on the ground
    const dir = this.forward(this.tmp);

    // shoulder point (pull the shoulder in first if a wall is right beside the runner)
    let shoulder = CAMERA.shoulder;
    const r = CAMERA.collideRadius;
    if (physics && shoulder > 0) {
      const h = physics.sphereCast(this.pivot.x, this.pivot.y, this.pivot.z, rx, 0, rz, r, shoulder);
      if (h) shoulder = Math.max(0, h.toi - 0.02);
    }
    const sxp = this.pivot.x + rx * shoulder, syp = this.pivot.y, szp = this.pivot.z + rz * shoulder;

    // boom collision: sweep back from the shoulder point, opposite the look direction
    let want = dist;
    this.obstructed = false;
    if (physics) {
      const h = physics.sphereCast(sxp, syp, szp, -dir.x, -dir.y, -dir.z, r, dist);
      if (h) { want = Math.max(0.35, h.toi - 0.05); this.obstructed = true; }
    }
    if (want < this.boom) this.boom = want;                 // pull in immediately: never see through a wall
    else this.boom = Math.min(want, this.boom + CAMERA.easeOutSpeed * dt);

    this.camera.position.set(sxp - dir.x * this.boom, syp - dir.y * this.boom, szp - dir.z * this.boom);
    let roll = 0;
    if (this.shake > 1e-3) {
      const a = Math.min(1, this.shake);
      this.shakeT += Math.max(0, dt) * 38;
      this.camera.position.x += Math.sin(this.shakeT * 1.3) * 0.05 * a;
      this.camera.position.y += Math.sin(this.shakeT * 1.7 + 1.1) * 0.04 * a;
      roll = Math.sin(this.shakeT * 0.9 + 2.3) * 0.015 * a;
      this.shake = Math.max(0, this.shake - Math.max(0, dt) * 6 * Math.max(0.35, this.shake));
    } else this.shake = 0;
    this.camera.rotation.set(this.pitch, this.yaw + Math.PI, roll, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  /** the smoothed pivot (world) */
  pivotPoint(out = new THREE.Vector3()): THREE.Vector3 { return out.copy(this.pivot); }
}
