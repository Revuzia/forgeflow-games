// GENESIS — the camera modes' fallbacks (CONTRACT.md §15.8), used by the App until the render lane's own follow / dolly /
// walk / photo controllers are bound (src/ui/host.ts RenderCameraModes). Two pieces:
//   WalkCamera   the player's body on the surface: an eye 1.65 m over the ground (or the water: the god walks on it),
//                W A S D along the heading, Shift runs, a drag (or the right stick) looks, Z / X turn, R / F tilt the
//                head; a small step bob while moving. A CameraController, so the rig blends into and out of it.
//   DollyDriver  the cinematic arc around a place: drives the orbit camera's heading, distance, tilt and a slow drift of
//                its focus around the place (parallax), until the player takes the camera back (any drag, wheel or key).
// Both work in the planet's BODY frame like the rest of the rig, so the ground stays put while the world turns.

import type { WorldView } from '../client/worldview.ts';
import type { CameraPose } from '../render/frame.ts';
import type { OrbitCamera } from '../render/camera/orbit.ts';
import { qMul, qRotate, type D3, type DQ } from '../client/orbits.ts';
import { tangentBasis } from '../sim/core/vec3.ts';
import { basisQuat, norm3, surfaceRadius, type CameraController, type InputState } from '../render/camera/common.ts';

const TAU = Math.PI * 2;

export class WalkCamera implements CameraController {
  // (the rig's controller modes are orbit / surface / system / fly: a body on the ground is a surface view)
  readonly mode = 'surface' as const;
  planet = 0;
  /** where the body stands: body-frame unit vector */
  dir: D3 = [0, 1, 0];
  /** heading (rad from local north toward east) and head pitch (rad, + up) */
  yaw = 0;
  pitch = -0.04;
  fov = 64;
  /** eye height over the ground (m) */
  eye = 1.65;
  /** walking pace (m/s) and the factor Shift runs at */
  pace = 1.6;
  run = 3.4;
  /** the gamepad's left stick (−1..1, y down) */
  stickX = 0;
  stickY = 0;
  /** metres walked (the step bob's phase; tests read it) */
  walked = 0;
  private moving = 0;
  private east: D3 = [0, 0, 0];
  private north: D3 = [0, 0, 0];

  /** stand at a point looking along a heading */
  place(planet: number, dir: ArrayLike<number>, yaw: number, pitch = -0.04): void {
    this.planet = planet;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    this.dir = [dir[0] / l, dir[1] / l, dir[2] / l];
    this.yaw = yaw;
    this.pitch = pitch;
    this.moving = 0;
  }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    const pv = view.planet(this.planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    // ── look: a drag with either button (the mouse), the right stick (the shell adds it to the right drag) ──
    this.yaw += (input.dragL[0] + input.dragR[0]) * 0.0034;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - (input.dragL[1] + input.dragR[1]) * 0.0034));
    const k = input.keys;
    if (k.has('KeyQ')) this.yaw -= dt * 1.5;
    if (k.has('KeyE')) this.yaw += dt * 1.5;
    if (k.has('KeyR')) this.pitch = Math.min(1.35, this.pitch + dt * 0.9);
    if (k.has('KeyF')) this.pitch = Math.max(-1.35, this.pitch - dt * 0.9);
    // ── walk ──
    let mz = 0, mx = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    mz -= this.stickY;
    mx += this.stickX;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const up = this.dir;
    const east = this.east, north = this.north;
    tangentBasis(east, north, up);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const R = pv.params.radius;
    const speed = this.pace * (input.shift ? this.run : 1);
    if (mx || mz) {
      const step = (speed * dt) / R;
      for (let i = 0; i < 3; i++) up[i] += ((north[i] * cy + east[i] * sy) * mz + (east[i] * cy - north[i] * sy) * mx) * step;
      norm3(up);
      tangentBasis(east, north, up);
      this.walked += speed * dt * Math.min(1, Math.hypot(mx, mz));
      this.moving = Math.min(1, this.moving + dt * 5);
    } else this.moving = Math.max(0, this.moving - dt * 4);
    // the eye: over the ground or the water's surface, with a small bob per step (two steps a metre and a half)
    const bob = Math.sin((this.walked / 0.75) * TAU) * 0.022 * this.moving * (input.shift ? 1.5 : 1);
    const r = surfaceRadius(pv, up) + this.eye + bob;
    // ── the view basis (as the fly camera builds it: X right, Y up, Z back) ──
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd: D3 = [0, 0, 0], rgt: D3 = [0, 0, 0], cup: D3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const hd = north[i] * cy + east[i] * sy;
      fwd[i] = hd * cp + up[i] * sp;
      rgt[i] = east[i] * cy - north[i] * sy;
    }
    cup[0] = rgt[1] * fwd[2] - rgt[2] * fwd[1];
    cup[1] = rgt[2] * fwd[0] - rgt[0] * fwd[2];
    cup[2] = rgt[0] * fwd[1] - rgt[1] * fwd[0];
    norm3(cup);
    const qb: DQ = [0, 0, 0, 1];
    basisQuat(rgt[0], rgt[1], rgt[2], cup[0], cup[1], cup[2], -fwd[0], -fwd[1], -fwd[2], qb);
    const qs = qMul(pv.quat, qb);
    const ps = qRotate(pv.quat, [up[0] * r, up[1] * r, up[2] * r]);
    out.pos[0] = pv.center[0] + ps[0];
    out.pos[1] = pv.center[1] + ps[1];
    out.pos[2] = pv.center[2] + ps[2];
    out.quat[0] = qs[0]; out.quat[1] = qs[1]; out.quat[2] = qs[2]; out.quat[3] = qs[3];
    out.fov = this.fov;
    out.planet = pv.id;
  }
}

/** did the player touch the camera this frame (a drag, the wheel, a camera key) */
export function cameraTouched(input: InputState): boolean {
  return !!(input.dragL[0] || input.dragL[1] || input.dragR[0] || input.dragR[1] || input.dragM[0] || input.dragM[1] || input.wheel || input.keys.size);
}

export class DollyDriver {
  active = false;
  planet = -1;
  /** the place: body-frame unit vector, and its reach (m) */
  center: D3 = [0, 0, 1];
  radius = 80;
  /** seconds since it began */
  t = 0;
  private h0 = 0;
  private base = 300;

  /** begin circling a place with the orbit camera (keeps the current heading so the move starts where the eye is) */
  begin(orbit: OrbitCamera, planet: number, center: ArrayLike<number>, radius: number): void {
    const l = Math.hypot(center[0], center[1], center[2]) || 1;
    this.center = [center[0] / l, center[1] / l, center[2] / l];
    this.planet = planet;
    this.radius = Math.max(25, radius);
    this.base = Math.max(150, Math.min(900, this.radius * 2.4 + 110));
    this.t = 0;
    this.h0 = orbit.planet === planet ? orbit.heading : 0;
    this.active = true;
    orbit.planet = planet;
    orbit.focus = [this.center[0], this.center[1], this.center[2]];
    orbit.dist = this.base;
    orbit.tiltBias = 0;
    orbit.tiltFixed = 64;
  }

  /**
   * One frame of the arc (before the rig reads the orbit camera): the heading turns a full circle in ~75 s, the
   * distance breathes ±15 %, the tilt sways 58°–70°, and the focus wanders a fifth of the place's reach around its
   * centre. Returns false — and stops — when the player took the camera.
   */
  update(dt: number, orbit: OrbitCamera, input: InputState, planetRadius: number): boolean {
    if (!this.active) return false;
    if (cameraTouched(input) || orbit.planet !== this.planet) { this.active = false; return false; }
    this.t += dt;
    const t = this.t;
    orbit.heading = this.h0 + t * 0.084;
    orbit.dist = this.base * (1 + 0.15 * Math.sin((t * TAU) / 57));
    orbit.tiltFixed = 64 + 6 * Math.sin((t * TAU) / 43 + 1.1);
    const east: D3 = [0, 0, 0], north: D3 = [0, 0, 0];
    tangentBasis(east, north, this.center);
    const a = (t * TAU) / 61;
    const drift = (this.radius * 0.2) / Math.max(1, planetRadius);
    const f: D3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) f[i] = this.center[i] + (east[i] * Math.cos(a) + north[i] * Math.sin(a)) * drift;
    orbit.focus = norm3(f);
    return true;
  }
}
