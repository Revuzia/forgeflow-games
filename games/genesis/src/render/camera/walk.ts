// GENESIS — walking among them (CONTRACT.md §15.8 walk): the player's BODY on the surface (render/camera/avatar.ts), in
// third person (the camera behind and above the luminous figure) or first person (the wheel all the way in), on the
// curved ground of a world the size of a town — and on its water.
//
//   W A S D     walk along the view (Shift runs); the body turns smoothly toward where it goes
//   drag        look (either button); Q / E turn
//   R (held)    jump; held longer, float up (to ~14 m) — let go and glide down; F sinks
//   wheel       closer / farther; in to the shoulder, first person
// The people around see the god (a `god.seen` command every couple of seconds while someone is within sight, through
// the onSeen hook the App binds): believers kneel and pray, the fearful flee, the rest stop and stare (the sim decides
// from each one's faith). Everything is in the planet's BODY frame like the rest of the rig.

import type { WorldView } from '../../client/worldview.ts';
import { qMul, qRotate, type D3, type DQ } from '../../client/orbits.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import type { CameraPose } from '../frame.ts';
import { basisQuat, lookQuat, norm3, surfaceRadius, type CameraController, type InputState } from './common.ts';
import { AVATAR_STATE } from './avatar.ts';
import { AVATAR } from './targets.ts';

const TAU = Math.PI * 2;

export interface SeenEvent { planet: number; pos: [number, number, number]; radius: number }

export class WalkCamera implements CameraController {
  readonly mode = 'walk' as const;
  planet = 0;
  /** where the feet stand: body-frame unit vector */
  dir: D3 = [0, 1, 0];
  /** view heading (rad from north toward east) and pitch (rad, + up) */
  yaw = 0;
  pitch = -0.12;
  /** the body's own facing (rad), easing toward the way it walks */
  bodyYaw = 0;
  /** third-person distance (m); under ~1 it is first person */
  dist = 5.5;
  fov = 60;
  pace = 1.8;
  run = 4.2;
  /** height of the feet over the ground (m) and its rate (m/s) */
  private lift = 0;
  private vz = 0;
  private walked = 0;
  private moving = 0;
  private seenAt = -1e9;
  private seenPos: D3 | null = null;
  private clock = 0;
  /** −1 cruel .. +1 kind (HandView.alignment, the god's record) */
  alignment = 0.5;
  /** the gamepad's left stick (−1..1) */
  stickX = 0;
  stickY = 0;
  /** called when the people near the body should see it (the App sends god.seen) */
  onSeen: ((e: SeenEvent) => void) | null = null;
  /** first person (derived from the distance) */
  get firstPerson(): boolean { return this.dist < 1.05; }

  place(planet: number, dir: ArrayLike<number>, heading: number): void {
    this.planet = planet;
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    this.dir = [dir[0] / l, dir[1] / l, dir[2] / l];
    this.yaw = heading;
    this.bodyYaw = heading;
    this.pitch = -0.12;
    this.lift = 0;
    this.vz = 0;
    this.seenPos = null;
    AVATAR_STATE.active = true;
  }

  leave(): void {
    AVATAR_STATE.active = false;
    AVATAR.active = false;
  }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    const pv = view.planet(this.planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    this.clock += dt;
    // ── look ──
    this.yaw += (input.dragL[0] + input.dragR[0]) * 0.0034;
    this.pitch = Math.max(-1.3, Math.min(1.25, this.pitch - (input.dragL[1] + input.dragR[1]) * 0.0034));
    const k = input.keys;
    if (k.has('KeyQ')) this.yaw -= dt * 1.6;
    if (k.has('KeyE')) this.yaw += dt * 1.6;
    if (input.wheel) this.dist = Math.max(0.6, Math.min(26, this.dist * Math.exp(input.wheel * 0.0015)));
    // ── walk along the view ──
    let mz = 0, mx = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    mz -= this.stickY; mx += this.stickX;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const up = this.dir;
    const east: D3 = [0, 0, 0], north: D3 = [0, 0, 0];
    tangentBasis(east, north, up);
    const R = pv.params.radius;
    const speed = this.pace * (input.shift ? this.run / this.pace : 1) * (this.lift > 0.5 ? 1.6 : 1);
    if (mx || mz) {
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      const step = (speed * dt) / R;
      for (let i = 0; i < 3; i++) up[i] += ((north[i] * cy + east[i] * sy) * mz + (east[i] * cy - north[i] * sy) * mx) * step;
      norm3(up);
      tangentBasis(east, north, up);
      this.walked += speed * dt * Math.min(1, Math.hypot(mx, mz));
      this.moving = Math.min(1, this.moving + dt * 4);
      // the body turns toward where it goes
      const want = this.yaw + Math.atan2(mx, mz);
      let d = ((want - this.bodyYaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (mz < 0 && Math.abs(mx) < 0.3) d = ((this.yaw - this.bodyYaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.bodyYaw += d * Math.min(1, dt * 8);
    } else this.moving = Math.max(0, this.moving - dt * 4);
    // ── jump and float ──
    const g = 9.8;
    if (k.has('KeyR')) {
      if (this.lift < 0.05) this.vz = 4.2;
      else this.vz = Math.min(3.5, this.vz + dt * 14);
    } else if (k.has('KeyF')) this.vz = Math.max(-6, this.vz - dt * 12);
    else this.vz -= g * dt * (this.lift > 1.5 ? 0.18 : 1);
    this.lift = Math.max(0, Math.min(14, this.lift + this.vz * dt));
    if (this.lift <= 0 && this.vz < 0) this.vz = 0;
    if (this.lift >= 14 && this.vz > 0) this.vz = 0;
    const ground = surfaceRadius(pv, up);
    const feet = ground + this.lift;
    // ── the body (drawn by the ship layer's frame on the planet's group) ──
    const s = AVATAR_STATE;
    s.active = true;
    s.planet = pv.id;
    s.pos.set(up[0] * feet, up[1] * feet, up[2] * feet);
    s.up.set(up[0], up[1], up[2]);
    const bc = Math.cos(this.bodyYaw), bs = Math.sin(this.bodyYaw);
    s.fwd.set(north[0] * bc + east[0] * bs, north[1] * bc + east[1] * bs, north[2] * bc + east[2] * bs);
    s.stride = (this.walked / 0.85) * Math.PI;
    s.moving = this.moving;
    s.float = Math.min(1, this.lift / 2.5);
    s.lift = this.lift;
    s.visible = !this.firstPerson;
    s.alignment = this.alignment;
    AVATAR.active = true; AVATAR.planet = pv.id; AVATAR.pos = [up[0], up[1], up[2]]; AVATAR.heading = this.bodyYaw;
    // ── the view ──
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd: D3 = [0, 0, 0], rgt: D3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const hd = north[i] * cy + east[i] * sy;
      fwd[i] = hd * cp + up[i] * sp;
      rgt[i] = east[i] * cy - north[i] * sy;
    }
    const head = feet + 2.0 + Math.sin(this.walked / 0.85 * TAU) * 0.02 * this.moving;
    let eye: D3, target: D3;
    if (this.firstPerson) {
      eye = [up[0] * head, up[1] * head, up[2] * head];
      target = [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]];
      const cup: D3 = [rgt[1] * fwd[2] - rgt[2] * fwd[1], rgt[2] * fwd[0] - rgt[0] * fwd[2], rgt[0] * fwd[1] - rgt[1] * fwd[0]];
      norm3(cup);
      const qb: DQ = [0, 0, 0, 1];
      basisQuat(rgt[0], rgt[1], rgt[2], cup[0], cup[1], cup[2], -fwd[0], -fwd[1], -fwd[2], qb);
      const qs = qMul(pv.quat, qb);
      const ps = qRotate(pv.quat, eye);
      out.pos[0] = pv.center[0] + ps[0]; out.pos[1] = pv.center[1] + ps[1]; out.pos[2] = pv.center[2] + ps[2];
      out.quat[0] = qs[0]; out.quat[1] = qs[1]; out.quat[2] = qs[2]; out.quat[3] = qs[3];
    } else {
      // over the shoulder: behind along the view, a little up, kept out of the ground
      const d = this.dist;
      const pivot: D3 = [up[0] * (feet + 1.75), up[1] * (feet + 1.75), up[2] * (feet + 1.75)];
      eye = [pivot[0] - fwd[0] * d + rgt[0] * d * 0.12, pivot[1] - fwd[1] * d + rgt[1] * d * 0.12, pivot[2] - fwd[2] * d + rgt[2] * d * 0.12];
      const re = Math.hypot(eye[0], eye[1], eye[2]);
      const ue: D3 = [eye[0] / re, eye[1] / re, eye[2] / re];
      const ge = surfaceRadius(pv, ue) + 0.6;
      if (re < ge) eye = [ue[0] * ge, ue[1] * ge, ue[2] * ge];
      target = [pivot[0] + fwd[0] * 2, pivot[1] + fwd[1] * 2, pivot[2] + fwd[2] * 2];
      const eyeS = qRotate(pv.quat, eye), tgtS = qRotate(pv.quat, target), upS = qRotate(pv.quat, up);
      out.pos[0] = pv.center[0] + eyeS[0]; out.pos[1] = pv.center[1] + eyeS[1]; out.pos[2] = pv.center[2] + eyeS[2];
      lookQuat(eyeS, tgtS, upS, out.quat);
    }
    out.fov = this.fov;
    out.planet = pv.id;
    // ── the people see the god ──
    this.maybeSeen(view, pv.id, up);
  }

  /** every ~2.5 s while walking among people (or 1 s after moving 15 m), tell the App so it can send god.seen */
  private maybeSeen(view: WorldView, planet: number, up: D3): void {
    if (!this.onSeen) return;
    const now = this.clock;
    const moved = this.seenPos ? Math.acos(Math.min(1, up[0] * this.seenPos[0] + up[1] * this.seenPos[1] + up[2] * this.seenPos[2])) * (view.planet(planet)?.params.radius ?? 3000) : 1e9;
    if (now - this.seenAt < (moved > 15 ? 1 : 2.5)) return;
    const pv = view.planet(planet);
    const A = pv?.agents;
    if (!pv || !A) return;
    const R = pv.params.radius;
    let near = false;
    for (let i = 0; i < A.count && !near; i++) {
      const d = Math.acos(Math.min(1, A.pos[i * 3] * up[0] + A.pos[i * 3 + 1] * up[1] + A.pos[i * 3 + 2] * up[2])) * R;
      if (d < 45) near = true;
    }
    if (!near) return;
    this.seenAt = now;
    this.seenPos = [up[0], up[1], up[2]];
    this.onSeen({ planet, pos: [up[0], up[1], up[2]], radius: 40 + (this.lift > 3 ? 40 : 0) });
  }
}
