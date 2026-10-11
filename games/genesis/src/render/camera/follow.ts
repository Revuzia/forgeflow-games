// GENESIS — the follow camera (CONTRACT.md §15.8): keep the camera on a moving thing — a person, a herd, the creature, a
// ship (on the pad, climbing, circling, crossing between the worlds, coming down), a disaster, the god's own body.
//
// The camera sits at an OFFSET from the subject that is smoothed in the subject's own frame (the offset eases, the
// subject does not lag: a rocket at hundreds of metres a second stays framed), behind its motion unless the player has
// turned the view (a drag orbits around it, the wheel moves in and out, Q/E turn, R/F tilt; the view drifts back
// behind it a few seconds after the player lets go). Collision-aware: the eye never goes under the ground or the water
// and rises when a hill, a cliff or the canopy would come between it and the subject. A climbing rocket is framed from
// below and to the side, looking up along its plume; a ship in space from behind and outside its path.

import type { WorldView } from '../../client/worldview.ts';
import type { EntityRef } from '../../sim/types.ts';
import { qRotate, qRotateInv, type D3 } from '../../client/orbits.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import type { CameraPose } from '../frame.ts';
import { lookQuat, norm3, surfaceRadius, type CameraController, type InputState } from './common.ts';
import { resolveTarget, type TargetState } from './targets.ts';

const cross = (a: D3, b: D3): D3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class FollowCamera implements CameraController {
  readonly mode = 'follow' as const;
  planet = 0;
  ref: EntityRef | null = null;
  /** the player's turn around the subject (rad, 0 = behind it) and tilt above its horizon (rad) */
  yaw = 0;
  pitch = 0.3;
  /** distance multiplier on the subject's natural framing distance */
  zoom = 1;
  fov = 50;
  /** seconds since the player last turned the view (the view drifts back behind the subject after a while) */
  private idle = 99;
  private off: D3 | null = null;
  private lift = 0;
  private state: TargetState | null = null;
  private lastPlanet = -2;
  /** the subject is gone (died, burned out, a ship that ended): the camera holds where it was */
  lost = false;

  /** follow a thing (keeps the current turn when re-targeting the same thing) */
  set(ref: EntityRef | null): void {
    const same = ref && this.ref && ref.kind === this.ref.kind && ref.id === this.ref.id;
    this.ref = ref;
    if (!same) { this.off = null; this.yaw = 0; this.pitch = ref?.kind === 'ship' ? 0.1 : 0.32; this.zoom = 1; this.idle = 99; this.lift = 0; }
    this.lost = false;
  }

  /** the subject's state this frame (for the HUD / the modes layer) */
  subject(): TargetState | null { return this.state; }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    if (!this.ref) return;
    const s = resolveTarget(view, this.ref, this.state ?? undefined);
    if (!s) { this.lost = true; return; }
    this.state = s;
    this.lost = false;
    // ── input: orbit around the subject ──
    const dx = input.dragL[0] + input.dragR[0], dy = input.dragL[1] + input.dragR[1];
    if (dx || dy) { this.yaw -= dx * 0.005; this.pitch = Math.max(-0.6, Math.min(1.45, this.pitch + dy * 0.004)); this.idle = 0; }
    const k = input.keys;
    if (k.has('KeyQ')) { this.yaw += dt * 1.2; this.idle = 0; }
    if (k.has('KeyE')) { this.yaw -= dt * 1.2; this.idle = 0; }
    if (k.has('KeyR')) { this.pitch = Math.min(1.45, this.pitch + dt * 0.6); this.idle = 0; }
    if (k.has('KeyF')) { this.pitch = Math.max(-0.6, this.pitch - dt * 0.6); this.idle = 0; }
    if (input.wheel) this.zoom = Math.max(0.15, Math.min(40, this.zoom * Math.exp(input.wheel * 0.0012)));
    this.idle += dt;
    // after a few seconds untouched the view drifts back behind the subject's motion
    if (this.idle > 4 && s.fwd && s.speed > 0.05) this.yaw *= Math.exp(-dt * 0.5);
    // ── the subject's frame ──
    const onWorld = s.planet >= 0;
    const pv = onWorld ? view.planet(s.planet) : undefined;
    if (s.planet !== this.lastPlanet) { this.off = null; this.lastPlanet = s.planet; }
    const radial: D3 = onWorld ? norm3([s.pos[0], s.pos[1], s.pos[2]]) : [0, 1, 0];
    let fwd: D3;
    const ship = this.ref.kind === 'ship';
    if (s.fwd && Math.abs(dot(s.fwd, radial)) < 0.98) fwd = norm3([s.fwd[0] - radial[0] * dot(s.fwd, radial), s.fwd[1] - radial[1] * dot(s.fwd, radial), s.fwd[2] - radial[2] * dot(s.fwd, radial)]);
    else { const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0]; tangentBasis(e, n, radial); fwd = n; }
    const side = norm3(cross(fwd, radial));
    const dist = Math.max(4, Math.min(onWorld ? 4000 : 20000, (s.size * (ship ? 2.4 : 3.4) + 4) * this.zoom));
    // ── the desired offset ──
    let want: D3;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    if (ship && onWorld) {
      // a ship: a climbing rocket from below and to the side, looking up along its plume (the player's turn swings the
      // eye around its axis); one standing, circling or coming down from behind and above
      const axis = norm3([s.up[0], s.up[1], s.up[2]]);
      const climbing = dot(axis, radial) > 0.3 && s.speed > 0;
      if (climbing) {
        let across = cross(axis, fwd);
        if (Math.hypot(across[0], across[1], across[2]) < 1e-3) across = [...side] as D3;
        norm3(across);
        const turned = cross(axis, across);
        const a2: D3 = [0, 1, 2].map((i) => across[i] * cy + turned[i] * sy) as D3;
        want = [0, 1, 2].map((i) => (-axis[i] * 0.45 + a2[i] * 0.9 + radial[i] * (0.05 + sp * 0.5)) * dist) as D3;
      } else want = [0, 1, 2].map((i) => (-fwd[i] * cp * cy + side[i] * cp * sy + radial[i] * (sp + 0.25)) * dist) as D3;
    } else if (ship && !onWorld) {
      // between the worlds: behind its path and out of its plane, the star off to one side
      const axis = norm3([s.up[0], s.up[1], s.up[2]]);
      const out2 = norm3(cross(axis, [0, 1, 0]));
      want = [0, 1, 2].map((i) => (-axis[i] * cp * Math.cos(this.yaw) + out2[i] * cp * Math.sin(this.yaw) * 0.8 + [0, 1, 0][i] * (sp + 0.15)) * dist) as D3;
    } else {
      want = [0, 1, 2].map((i) => (-fwd[i] * cp * cy + side[i] * cp * sy + radial[i] * sp) * dist) as D3;
    }
    // ── smoothing in the subject's frame ──
    if (!this.off) this.off = [...want] as D3;
    const kk = 1 - Math.exp(-dt * (this.idle < 0.2 ? 12 : 2.6));
    for (let i = 0; i < 3; i++) this.off[i] += (want[i] - this.off[i]) * kk;
    let eye: D3 = [s.pos[0] + this.off[0], s.pos[1] + this.off[1], s.pos[2] + this.off[2]];
    const lookAt: D3 = ship ? [s.pos[0] + s.up[0] * s.size * 0.42, s.pos[1] + s.up[1] * s.size * 0.42, s.pos[2] + s.up[2] * s.size * 0.42]
      : [s.pos[0] + radial[0] * s.size * 0.15, s.pos[1] + radial[1] * s.size * 0.15, s.pos[2] + radial[2] * s.size * 0.15];
    // ── collision: above the ground under the eye, and nothing rising between the eye and the subject ──
    if (pv) {
      let need = 0;
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        const p: D3 = [lookAt[0] + (eye[0] - lookAt[0]) * t, lookAt[1] + (eye[1] - lookAt[1]) * t, lookAt[2] + (eye[2] - lookAt[2]) * t];
        const r = Math.hypot(p[0], p[1], p[2]);
        const u: D3 = [p[0] / r, p[1] / r, p[2] / r];
        const tree = pv.fields.get('tree');
        const canopy = tree && t > 0.2 ? Math.min(1, pv.grid.sample(tree, u[0], u[1], u[2]) * 2.2) * 16 : 0;
        const clear = (j === 6 ? 1.5 : 0.8) + canopy;
        const g = surfaceRadius(pv, u) + clear;
        if (r < g) need = Math.max(need, (g - r) / Math.max(0.15, t));
      }
      this.lift += (need - this.lift) * (1 - Math.exp(-dt * (need > this.lift ? 6 : 1.2)));
      if (this.lift > 0.01) eye = [eye[0] + radial[0] * this.lift, eye[1] + radial[1] * this.lift, eye[2] + radial[2] * this.lift];
      const re = Math.hypot(eye[0], eye[1], eye[2]);
      const ue: D3 = [eye[0] / re, eye[1] / re, eye[2] / re];
      const ge = surfaceRadius(pv, ue) + 1.5;
      if (re < ge) eye = [ue[0] * ge, ue[1] * ge, ue[2] * ge];
      // body → system
      const eyeS = qRotate(pv.quat, eye), tgtS = qRotate(pv.quat, lookAt), upS = qRotate(pv.quat, radial);
      out.pos[0] = pv.center[0] + eyeS[0]; out.pos[1] = pv.center[1] + eyeS[1]; out.pos[2] = pv.center[2] + eyeS[2];
      lookQuat(eyeS, tgtS, upS, out.quat);
      out.planet = pv.id;
      this.planet = pv.id;
    } else {
      out.pos[0] = eye[0]; out.pos[1] = eye[1]; out.pos[2] = eye[2];
      lookQuat(eye, lookAt, [0, 1, 0], out.quat);
      out.planet = -1;
    }
    out.fov = this.fov;
    void qRotateInv;
  }
}
