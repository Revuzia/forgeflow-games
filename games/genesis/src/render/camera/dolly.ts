// GENESIS — the cinematic dolly (CONTRACT.md §15.8): a slow crane move around a settlement (or any place, or a thing)
// for trailer shots. The eye travels an arc of ~140° around the place over `duration` seconds and back (ping-pong,
// eased at the ends so the reversal is a hold, not a bounce); altitude and focal length follow curves along the arc —
// it opens high and wide, swoops low and close with a longer lens over the middle (the parallax of roofs against the
// fields), and rises again — while the look target drifts a little over the place. The ground is respected (the eye
// rises over hills and canopy between it and the place). `t` pins the move at a fraction (deterministic shots); a
// drag or the wheel hands the camera back to the player (the modes layer returns to orbit).

import type { WorldView } from '../../client/worldview.ts';
import { qRotate, type D3 } from '../../client/orbits.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import type { CameraPose } from '../frame.ts';
import { lookQuat, norm3, smoothstep, surfaceRadius, type CameraController, type InputState } from './common.ts';

export class DollyCamera implements CameraController {
  readonly mode = 'dolly' as const;
  planet = 0;
  /** the place: body-frame unit vector and its reach (m) */
  center: D3 = [0, 0, 1];
  radius = 120;
  /** the arc's start heading (rad from north), its sweep (rad) and its length (s) */
  heading0 = 0.4;
  sweep = 2.45;
  duration = 26;
  /** elapsed seconds; `pinned` (0..1) holds the move at that fraction */
  t = 0;
  pinned: number | null = null;
  /** the player took the camera */
  released = false;
  private lift = 0;

  begin(planet: number, center: ArrayLike<number>, radius: number, heading0 = 0.4): void {
    this.planet = planet;
    const l = Math.hypot(center[0], center[1], center[2]) || 1;
    this.center = [center[0] / l, center[1] / l, center[2] / l];
    this.radius = Math.max(25, radius);
    this.heading0 = heading0;
    this.t = 0;
    this.released = false;
    this.lift = 0;
  }

  /** the move's phase 0..1..0 (ping-pong, eased) */
  phase(): number {
    if (this.pinned != null) return Math.max(0, Math.min(1, this.pinned));
    const u = (this.t / this.duration) % 2;
    const p = u < 1 ? u : 2 - u;
    return smoothstep(0, 1, p);
  }

  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void {
    const pv = view.planet(this.planet) ?? view.planets[0];
    if (!pv) return;
    this.planet = pv.id;
    if (input.dragL[0] || input.dragL[1] || input.dragR[0] || input.dragR[1] || input.wheel) this.released = true;
    this.t += dt;
    const p = this.phase();
    const c = this.center;
    const east: D3 = [0, 0, 0], north: D3 = [0, 0, 0];
    tangentBasis(east, north, c);
    const R = pv.params.radius;
    const g = surfaceRadius(pv, c);
    // curves along the arc: distance and height dip in the middle, the lens lengthens there
    const mid = Math.sin(p * Math.PI);
    const dist = this.radius * (2.6 - 1.2 * mid) + 40;
    const height = this.radius * (1.35 - 0.95 * mid) + 12;
    const fov = 52 - 18 * mid;
    const h = this.heading0 + this.sweep * p;
    const dir: D3 = [north[0] * Math.cos(h) + east[0] * Math.sin(h), north[1] * Math.cos(h) + east[1] * Math.sin(h), north[2] * Math.cos(h) + east[2] * Math.sin(h)];
    // the eye on the arc (an angle on the sphere), raised over whatever stands between it and the place
    const ang = dist / R;
    const eyeDir = norm3([c[0] * Math.cos(ang) + dir[0] * Math.sin(ang), c[1] * Math.cos(ang) + dir[1] * Math.sin(ang), c[2] * Math.cos(ang) + dir[2] * Math.sin(ang)]);
    const ge = surfaceRadius(pv, eyeDir);
    let eyeR = Math.max(ge, g) + height;
    // the look target: over the place's middle, drifting a fifth of its reach across the arc
    const drift = ((p - 0.5) * this.radius * 0.4) / R;
    const side: D3 = [east[0] * Math.cos(h) - north[0] * Math.sin(h), east[1] * Math.cos(h) - north[1] * Math.sin(h), east[2] * Math.cos(h) - north[2] * Math.sin(h)];
    const tDir = norm3([c[0] + side[0] * drift, c[1] + side[1] * drift, c[2] + side[2] * drift]);
    const tR = surfaceRadius(pv, tDir) + Math.min(14, this.radius * 0.08);
    const target: D3 = [tDir[0] * tR, tDir[1] * tR, tDir[2] * tR];
    // line of sight over hills and the canopy (sampled toward the place)
    const tree = pv.fields.get('tree');
    let need = 0;
    for (let j = 1; j < 8; j++) {
      const s = j / 8;
      const u = norm3([eyeDir[0] + (tDir[0] - eyeDir[0]) * s, eyeDir[1] + (tDir[1] - eyeDir[1]) * s, eyeDir[2] + (tDir[2] - eyeDir[2]) * s]);
      const lineR = eyeR + (tR - eyeR) * s;
      const canopy = tree ? Math.min(1, pv.grid.sample(tree, u[0], u[1], u[2]) * 2.2) * 18 : 0;
      const gr = surfaceRadius(pv, u) + canopy + 2;
      if (lineR < gr) need = Math.max(need, (gr - lineR) / Math.max(0.1, 1 - s));
    }
    this.lift += (need - this.lift) * (1 - Math.exp(-dt * (need > this.lift ? 5 : 0.8)));
    eyeR += this.lift;
    const eye: D3 = [eyeDir[0] * eyeR, eyeDir[1] * eyeR, eyeDir[2] * eyeR];
    const up = eyeDir;
    const eyeS = qRotate(pv.quat, eye), tgtS = qRotate(pv.quat, target), upS = qRotate(pv.quat, up);
    out.pos[0] = pv.center[0] + eyeS[0]; out.pos[1] = pv.center[1] + eyeS[1]; out.pos[2] = pv.center[2] + eyeS[2];
    lookQuat(eyeS, tgtS, upS, out.quat);
    out.fov = fov;
    out.planet = pv.id;
  }
}
