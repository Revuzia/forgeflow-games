// GENESIS — free-fly camera (6DoF) and the fixed 'surface' camera of the test surface (CONTRACT.md §15.8, §18).
//
// Position and orientation live in the planet's BODY frame. Orientation is yaw / pitch / roll in the local east-north-
// up frame of the position, re-derived each frame so "level" stays level as you fly around the curved world.
// Speed scales with altitude (metres per second ≈ altitude, floored at walking pace). Left-drag looks, WASD moves,
// Space / C rise and sink, Q / E roll, Shift is fast. The camera never goes below 1.5 m above the ground.

import type { WorldView } from '../../client/worldview.ts';
import { qMul, qRotate, type D3, type DQ } from '../../client/orbits.ts';
import { fromLatLon, tangentBasis } from '../../sim/core/vec3.ts';
import type { CameraPose } from '../frame.ts';
import { basisQuat, norm3, surfaceRadius, type CameraController, type InputState } from './common.ts';

const DEG = Math.PI / 180;

export class FlyCamera implements CameraController {
  mode: 'fly' | 'surface' = 'fly';
  planet = 0;
  /** body-frame position, metres from the centre */
  pos: D3 = [0, 3100, 0];
  yaw = 0;
  pitch = 0;
  roll = 0;
  fov = 55;
  minClear = 1.5;
  /** hold altitude above ground while moving (surface mode) */
  holdAltitude: number | null = null;

  setSurface(planet: number, view: WorldView, latDeg: number, lonDeg: number, alt: number, yawDeg: number, pitchDeg: number): void {
    this.planet = planet;
    this.mode = 'surface';
    const pv = view.planet(planet);
    const d: D3 = [0, 0, 0];
    fromLatLon(d, latDeg * DEG, lonDeg * DEG);
    const g = pv ? surfaceRadius(pv, d) : 3000;
    this.pos = [d[0] * (g + alt), d[1] * (g + alt), d[2] * (g + alt)];
    this.yaw = yawDeg * DEG;
    this.pitch = pitchDeg * DEG;
    this.roll = 0;
    this.holdAltitude = alt;
  }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    const pv = view.planet(this.planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    const r = Math.hypot(this.pos[0], this.pos[1], this.pos[2]);
    const up: D3 = [this.pos[0] / r, this.pos[1] / r, this.pos[2] / r];
    const ground = surfaceRadius(pv, up);
    const alt = Math.max(0, r - ground);
    // look
    if (input.dragL[0] || input.dragL[1]) {
      this.yaw += input.dragL[0] * 0.0032;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - input.dragL[1] * 0.0032));
      if (this.mode === 'surface') this.mode = 'fly';
    }
    if (input.keys.has('KeyQ')) this.roll -= dt * 1.0;
    if (input.keys.has('KeyE')) this.roll += dt * 1.0;
    this.roll *= Math.exp(-dt * 1.5); // roll drifts back to level
    // local frame and view axes
    const east: D3 = [0, 0, 0], north: D3 = [0, 0, 0];
    tangentBasis(east, north, up);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // forward: heading yaw from north toward east, pitched by pitch
    const fwd: D3 = [0, 0, 0], rgt: D3 = [0, 0, 0], cup: D3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const h = north[i] * cy + east[i] * sy;
      fwd[i] = h * cp + up[i] * sp;
      rgt[i] = east[i] * cy - north[i] * sy;
    }
    // camera up = right × forward... (right-handed: X = right, Y = up, Z = −forward)
    cup[0] = rgt[1] * fwd[2] - rgt[2] * fwd[1];
    cup[1] = rgt[2] * fwd[0] - rgt[0] * fwd[2];
    cup[2] = rgt[0] * fwd[1] - rgt[1] * fwd[0];
    norm3(cup);
    // roll about forward
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const rx: D3 = [rgt[0] * cr + cup[0] * sr, rgt[1] * cr + cup[1] * sr, rgt[2] * cr + cup[2] * sr];
    const ux: D3 = [cup[0] * cr - rgt[0] * sr, cup[1] * cr - rgt[1] * sr, cup[2] * cr - rgt[2] * sr];
    // move
    const speed = Math.max(4, alt * 1.1) * (input.shift ? 4 : 1);
    let mx = 0, my = 0, mz = 0;
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) mz += 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) mz -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) mx += 1;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) mx -= 1;
    if (input.keys.has('Space')) my += 1;
    if (input.keys.has('KeyC')) my -= 1;
    my -= input.wheel * 0.01;
    if (mx || my || mz) {
      this.holdAltitude = null;
      if (this.mode === 'surface') this.mode = 'fly';
      for (let i = 0; i < 3; i++) this.pos[i] += (fwd[i] * mz + rx[i] * mx + up[i] * my) * speed * dt;
    }
    // clearance (and altitude hold for the fixed surface camera)
    const r2 = Math.hypot(this.pos[0], this.pos[1], this.pos[2]);
    const d2: D3 = [this.pos[0] / r2, this.pos[1] / r2, this.pos[2] / r2];
    const g2 = surfaceRadius(pv, d2);
    let want = r2;
    if (this.holdAltitude != null) want = g2 + this.holdAltitude;
    want = Math.max(want, g2 + this.minClear);
    if (want !== r2) for (let i = 0; i < 3; i++) this.pos[i] = d2[i] * want;
    // basis → quaternion (body), then to system
    const qb: DQ = [0, 0, 0, 1];
    basisQuat(rx[0], rx[1], rx[2], ux[0], ux[1], ux[2], -fwd[0], -fwd[1], -fwd[2], qb);
    const qs = qMul(pv.quat, qb);
    const ps = qRotate(pv.quat, this.pos);
    out.pos[0] = pv.center[0] + ps[0];
    out.pos[1] = pv.center[1] + ps[1];
    out.pos[2] = pv.center[2] + ps[2];
    out.quat[0] = qs[0]; out.quat[1] = qs[1]; out.quat[2] = qs[2]; out.quat[3] = qs[3];
    out.fov = this.fov;
    out.planet = pv.id;
  }
}
