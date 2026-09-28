// DYEFIELD — third-person FollowCamera (CONTRACT §5.1, DESIGN §2 camera table).
// Pivot 1.35 m over the feet, 4.3 m boom, 0.42 m right shoulder, vertical FOV 68°, rest pitch −14°,
// pitch clamp −65°…+40°. Mouse yaw/pitch under pointer lock (mouse-right decreases yaw — CONTRACT §2).
// A sphere-cast pulls the boom in instantly when geometry is in the way and eases it back out.
// The pivot is smoothed vertically only (steps / landings) with a 0.05 s time constant, so it never
// lags the runner by more than ~0.15 s; horizontally it rides the already-interpolated render pose.
//
// Phase 10 juice (CONTRACT_P6_11 §21): TRAUMA-based screen shake.
//   * `addTrauma(amount, cap)` raises trauma (0..1) by `amount` but never above `cap` — every source
//     has its own ceiling, so 8.5 shots/s of MIST-RASP can only ever hold a small tremor while a slam
//     next to you may reach 1. Trauma decays linearly (SHAKE.decay per second).
//   * The shake itself is trauma^SHAKE.power × the SHAKE maxima, driven by smooth incommensurate sine
//     noise. It is ROTATIONAL only (yaw / pitch / roll of the rendered camera): the aim ray (game.ts:
//     camera position + `forward()` from yaw/pitch) is never moved by it, so shots stay honest.
//   * `reduceMotion` (settings flag) zeroes the shake; `shakeScale` is an optional 0..1 strength knob.
//   * `shake` is kept as a legacy alias of `trauma` (older call sites that write `cam.shake = …`).
// Settings hooks for the frontend: `sensitivityScale` and `invertY` apply in addMouse().

import * as THREE from 'three';
import { CAMERA } from '../core/config.ts';
import { DEG } from '../core/types.ts';
import type { PhysicsWorld } from '../core/physics.ts';

/** trauma → shake mapping (tuned on 1600×900 shots: firing ≈ 2 px tremor, a slam ≈ 25 px) */
export const SHAKE = {
  /** shake = trauma^power (1.5: small trauma still reads as a tremor, big trauma dominates) */
  power: 1.5,
  /** trauma lost per second (1 → 0 in ~0.7 s) */
  decay: 1.45,
  /** maxima at shake = 1 */
  yawDeg: 1.9,
  pitchDeg: 1.6,
  rollDeg: 2.6,
  /** noise frequencies (rad/s): ~9–15 Hz, incommensurate so the pattern never visibly repeats */
  freq: [61, 83, 97, 53, 71, 89] as const,
};

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
  /** screen-shake trauma 0..1 (see addTrauma); decays SHAKE.decay per second */
  trauma = 0;
  /** settings: reduce motion → no screen shake at all */
  reduceMotion = false;
  /** settings: shake strength 0..1 (1 = default) */
  shakeScale = 1;
  /** settings: mouse sensitivity multiplier (1 = CAMERA.sensitivity) */
  sensitivityScale = 1;
  /** settings: invert the vertical mouse axis */
  invertY = false;
  /** current boom length after collision (m) */
  boom = CAMERA.distance;
  /** true when the last update pulled the boom in */
  obstructed = false;
  /** shake applied on the last update (radians; harness read-back) */
  readonly lastShake = { yaw: 0, pitch: 0, roll: 0, amount: 0 };

  private readonly pivot = new THREE.Vector3();
  private pivotYs = NaN;
  private readonly tmp = new THREE.Vector3();
  private shakeT = 0;

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, aspect, 0.08, 2400);
    this.camera.rotation.order = 'YXZ';
  }

  /** legacy alias of `trauma` (older call sites: `cam.shake = Math.min(1, cam.shake + k)`) */
  get shake(): number { return this.trauma; }
  set shake(v: number) { this.trauma = v > 0 ? (v < 1 ? v : 1) : 0; }

  /**
   * Add screen-shake trauma: raises it by `amount`, but a source never pushes it past its own `cap`
   * (a trauma already above the cap is left alone — a small source never cuts a big shake short).
   */
  addTrauma(amount: number, cap = 1): void {
    if (!(amount > 0)) return;
    const c = cap < 1 ? cap : 1;
    if (this.trauma >= c) return;
    this.trauma = Math.min(c, this.trauma + amount);
  }

  /** Point the camera along a yaw (e.g. the spawn facing) at the rest pitch. */
  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = CAMERA.restPitchDeg * DEG;
    this.pivotYs = NaN;
    this.boom = CAMERA.distance;
    this.slickBlend = 0;
    this.slickTarget = 0;
    this.trauma = 0;
  }

  addMouse(dx: number, dy: number): void {
    if (!dx && !dy) return;
    const s = CAMERA.sensitivity * (this.sensitivityScale > 0 ? this.sensitivityScale : 1);
    this.yaw -= dx * s;
    this.pitch -= (this.invertY ? -dy : dy) * s;
    const TAU = Math.PI * 2;
    if (this.yaw > Math.PI) this.yaw -= TAU;
    else if (this.yaw < -Math.PI) this.yaw += TAU;
    this.pitch = Math.min(CAMERA.maxPitchDeg * DEG, Math.max(CAMERA.minPitchDeg * DEG, this.pitch));
  }

  /** forward look direction (unit) — the AIM direction (never includes the shake) */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  /**
   * @param feet  the runner's interpolated feet position (render pose)
   * @param physics  collision for the boom pull-in (null = no collision)
   */
  update(dt: number, feet: { x: number; y: number; z: number }, physics: PhysicsWorld | null): void {
    const sdt = Math.max(0, dt);
    // SLICK tuck: pivot down + boom in, smoothly both ways (CONTRACT §11)
    const kb = 1 - Math.exp(-sdt * 11);
    this.slickBlend += (this.slickTarget - this.slickBlend) * kb;
    if (Math.abs(this.slickTarget - this.slickBlend) < 1e-3) this.slickBlend = this.slickTarget;
    const s = this.slickBlend;
    const pivotY = CAMERA.pivotY + (CAMERA.slickPivotY - CAMERA.pivotY) * s;
    const dist = CAMERA.distance + (CAMERA.slickDistance - CAMERA.distance) * s;

    // vertical smoothing of the pivot (snap on big jumps such as a respawn / teleport)
    const ty = feet.y + pivotY;
    if (!Number.isFinite(this.pivotYs) || Math.abs(ty - this.pivotYs) > 3) this.pivotYs = ty;
    else this.pivotYs += (ty - this.pivotYs) * (1 - Math.exp(-sdt / CAMERA.pivotLag));
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
    else this.boom = Math.min(want, this.boom + CAMERA.easeOutSpeed * sdt);

    this.camera.position.set(sxp - dir.x * this.boom, syp - dir.y * this.boom, szp - dir.z * this.boom);

    // trauma shake (rotation only — the aim ray never moves)
    let sYaw = 0, sPitch = 0, sRoll = 0, amount = 0;
    if (this.trauma > 0) {
      const k = this.reduceMotion ? 0 : Math.max(0, Math.min(1, this.shakeScale));
      amount = Math.pow(this.trauma, SHAKE.power) * k;
      if (amount > 1e-4) {
        this.shakeT += sdt;
        const t = this.shakeT, f = SHAKE.freq;
        const n1 = Math.sin(t * f[0]) * 0.62 + Math.sin(t * f[3] + 1.9) * 0.38;
        const n2 = Math.sin(t * f[1] + 0.7) * 0.62 + Math.sin(t * f[4] + 2.6) * 0.38;
        const n3 = Math.sin(t * f[2] + 1.3) * 0.62 + Math.sin(t * f[5] + 0.4) * 0.38;
        sYaw = n1 * SHAKE.yawDeg * DEG * amount;
        sPitch = n2 * SHAKE.pitchDeg * DEG * amount;
        sRoll = n3 * SHAKE.rollDeg * DEG * amount;
      }
      this.trauma = Math.max(0, this.trauma - sdt * SHAKE.decay);
    }
    this.lastShake.yaw = sYaw; this.lastShake.pitch = sPitch; this.lastShake.roll = sRoll; this.lastShake.amount = amount;
    this.camera.rotation.set(this.pitch + sPitch, this.yaw + Math.PI + sYaw, sRoll, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  /** the smoothed pivot (world) */
  pivotPoint(out = new THREE.Vector3()): THREE.Vector3 { return out.copy(this.pivot); }
}
