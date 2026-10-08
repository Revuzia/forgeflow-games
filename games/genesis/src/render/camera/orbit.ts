// GENESIS — the orbit camera (CONTRACT.md §15.8): around one planet, in its BODY frame (so the ground stays put under
// the camera while the planet turns and the sun crosses the sky), with one continuous zoom from system scale down to
// 2 m above the ground.
//
// State: a focus point on the surface (unit vector), distance from it, heading, tilt. Tilt follows the zoom (looking
// straight down from orbit, toward the horizon near the ground) plus whatever the player added with right-drag.
// The look target slides from the focus point to the planet centre and the camera "up" from local-up to system-up
// as the camera rises, so far views are steady globes and near views are grounded. The eye never enters the ground.
// Left-drag grabs the ground (pan at the cursor's scale), right-drag turns / tilts, the wheel zooms by a fraction of
// the altitude per notch, WASD/arrows pan, Q/E turn, R/F tilt.

import type { WorldView } from '../../client/worldview.ts';
import { qRotate, qRotateInv, type D3 } from '../../client/orbits.ts';
import { tangentBasis, fromLatLon } from '../../sim/core/vec3.ts';
import type { CameraPose } from '../frame.ts';
import { lookQuat, norm3, smoothstep, surfaceRadius, type CameraController, type InputState } from './common.ts';

const DEG = Math.PI / 180;

export class OrbitCamera implements CameraController {
  readonly mode = 'orbit' as const;
  planet = 0;
  focus: D3 = [0, 0, 1];
  dist = 9000;
  heading = 0;
  /** degrees added to the automatic tilt by the player */
  tiltBias = 0;
  /** explicit tilt (deg) overriding the automatic curve, or null */
  tiltFixed: number | null = null;
  minClear = 2;
  maxDist = 6e6;
  fov = 50;
  private vel: D3 = [0, 0, 0];

  /** automatic tilt (deg) for a distance: straight down from orbit, toward the horizon near the ground */
  autoTilt(dist: number): number {
    const t = smoothstep(Math.log10(45), Math.log10(9000), Math.log10(Math.max(dist, 1)));
    return 80 * (1 - t);
  }

  tilt(): number {
    const base = this.tiltFixed ?? this.autoTilt(this.dist);
    return Math.min(89, Math.max(0, base + this.tiltBias));
  }

  setFromLatLon(planet: number, latDeg: number, lonDeg: number, dist: number, headingDeg = 0, tiltDeg: number | null = null): void {
    this.planet = planet;
    fromLatLon(this.focus, latDeg * DEG, lonDeg * DEG);
    this.dist = dist;
    this.heading = headingDeg * DEG;
    this.tiltBias = 0;
    this.tiltFixed = tiltDeg;
  }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    const pv = view.planet(this.planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    const R = pv.params.radius;
    const east: D3 = [0, 0, 0], north: D3 = [0, 0, 0];
    tangentBasis(east, north, this.focus);
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    const fwd: D3 = [north[0] * ch + east[0] * sh, north[1] * ch + east[1] * sh, north[2] * ch + east[2] * sh];
    const right: D3 = [east[0] * ch - north[0] * sh, east[1] * ch - north[1] * sh, east[2] * ch - north[2] * sh];
    const fovRad = this.fov * DEG;
    const altApprox = Math.max(this.dist, 1);
    // metres per pixel at the focus distance → angle on the sphere per pixel
    const mpp = (2 * Math.tan(fovRad / 2) * altApprox) / Math.max(200, input.viewH);
    const gFocus = surfaceRadius(pv, this.focus);
    // ── input ──
    // left drag: grab the ground (camera-relative pan)
    let panX = -input.dragL[0], panY = input.dragL[1];
    const k = input.shift ? 3 : 1;
    const keyPan = 220 * dt * k;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) panY += keyPan;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) panY -= keyPan;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) panX -= keyPan;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) panX += keyPan;
    if (panX || panY) {
      const scale = this.dist > 2 * R ? Math.min(mpp, 0.02 * R) : mpp;
      const ang = Math.min(0.5, scale / gFocus);
      const tl = this.tilt() * DEG;
      // forward pans further when looking toward the horizon
      const fwdScale = 1 / Math.max(0.35, Math.cos(tl));
      for (let i = 0; i < 3; i++) this.focus[i] += (right[i] * panX + fwd[i] * panY * fwdScale) * ang;
      norm3(this.focus);
    }
    // right drag: heading + tilt
    if (input.dragR[0] || input.dragR[1]) {
      this.heading += input.dragR[0] * 0.005;
      this.tiltBias = Math.min(60, Math.max(-80, this.tiltBias - input.dragR[1] * 0.25));
    }
    if (input.keys.has('KeyQ')) this.heading -= dt * 1.2;
    if (input.keys.has('KeyE')) this.heading += dt * 1.2;
    if (input.keys.has('KeyR')) this.tiltBias = Math.min(60, this.tiltBias + dt * 30);
    if (input.keys.has('KeyF')) this.tiltBias = Math.max(-80, this.tiltBias - dt * 30);
    // wheel: altitude-proportional zoom (≈ 14 % per notch), keys +/-
    let zoom = input.wheel;
    if (input.keys.has('Equal') || input.keys.has('NumpadAdd')) zoom -= dt * 600;
    if (input.keys.has('Minus') || input.keys.has('NumpadSubtract')) zoom += dt * 600;
    if (zoom) this.dist = Math.min(this.maxDist, Math.max(this.minClear, this.dist * Math.exp(zoom * 0.0013)));
    void this.vel;

    // ── pose in the body frame ──
    tangentBasis(east, north, this.focus);
    const ch2 = Math.cos(this.heading), sh2 = Math.sin(this.heading);
    for (let i = 0; i < 3; i++) fwd[i] = north[i] * ch2 + east[i] * sh2;
    const tl = this.tilt() * DEG;
    const up = this.focus;
    const F: D3 = [up[0] * gFocus, up[1] * gFocus, up[2] * gFocus];
    const off: D3 = [up[0] * Math.cos(tl) - fwd[0] * Math.sin(tl), up[1] * Math.cos(tl) - fwd[1] * Math.sin(tl), up[2] * Math.cos(tl) - fwd[2] * Math.sin(tl)];
    let eye: D3 = [F[0] + off[0] * this.dist, F[1] + off[1] * this.dist, F[2] + off[2] * this.dist];
    // keep clear of the ground (and water) under the eye
    const re = Math.hypot(eye[0], eye[1], eye[2]);
    const eyeDir: D3 = [eye[0] / re, eye[1] / re, eye[2] / re];
    const gEye = surfaceRadius(pv, eyeDir) + this.minClear;
    if (re < gEye) eye = [eyeDir[0] * gEye, eyeDir[1] * gEye, eyeDir[2] * gEye];
    // look target: the focus point near the ground, the planet centre from far away
    const far = smoothstep(1.2 * R, 5 * R, this.dist);
    const target: D3 = [F[0] * (1 - far), F[1] * (1 - far), F[2] * (1 - far)];
    // up: the camera's pitched up near the ground, the system's up (in the body frame) far away
    const upNear: D3 = [up[0] * Math.sin(tl) + fwd[0] * Math.cos(tl), up[1] * Math.sin(tl) + fwd[1] * Math.cos(tl), up[2] * Math.sin(tl) + fwd[2] * Math.cos(tl)];
    const sysUp = qRotateInv(pv.quat, [0, 1, 0]);
    const upv: D3 = norm3([upNear[0] * (1 - far) + sysUp[0] * far, upNear[1] * (1 - far) + sysUp[1] * far, upNear[2] * (1 - far) + sysUp[2] * far]);
    // body → system
    const eyeSys = qRotate(pv.quat, eye);
    const tgtSys = qRotate(pv.quat, target);
    const upSys = qRotate(pv.quat, upv);
    out.pos[0] = pv.center[0] + eyeSys[0];
    out.pos[1] = pv.center[1] + eyeSys[1];
    out.pos[2] = pv.center[2] + eyeSys[2];
    lookQuat(eyeSys, tgtSys, upSys, out.quat);
    out.fov = this.fov;
    out.planet = pv.id;
  }

  /** altitude of the eye above the surface (m) for the last pose — cheap approximation from the state */
  altitude(): number {
    return this.dist * Math.cos(this.tilt() * DEG);
  }
}
