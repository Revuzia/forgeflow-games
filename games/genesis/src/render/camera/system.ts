// GENESIS — the system camera (CONTRACT.md §15.8): the whole system around the star. Left-drag orbits, right-drag
// tilts, the wheel zooms (log scale). Clicking a planet marker is handled by the app (rig.flyTo → orbit mode).

import type { WorldView } from '../../client/worldview.ts';
import type { D3 } from '../../client/orbits.ts';
import type { CameraPose } from '../frame.ts';
import { lookQuat, type CameraController, type InputState } from './common.ts';

export class SystemCamera implements CameraController {
  readonly mode = 'system' as const;
  planet = -1;
  yaw = 0.6;
  pitch = 0.55;
  dist = 6.5e6;
  fov = 45;
  /** system-frame point the camera circles (the star by default) */
  center: D3 = [0, 0, 0];

  /** frame the whole system: distance from the widest orbit */
  frame(view: WorldView): void {
    let maxA = 0;
    for (const p of view.planets) if (p.params.orbit.parent < 0) maxA = Math.max(maxA, p.params.orbit.a * (1 + p.params.orbit.e));
    this.dist = Math.max(2e5, maxA * 2.3);
  }

  update(_dt: number, _view: WorldView, input: InputState, out: CameraPose): void {
    if (input.dragL[0] || input.dragL[1]) {
      this.yaw -= input.dragL[0] * 0.004;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + input.dragL[1] * 0.004));
    }
    if (input.dragR[1]) this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + input.dragR[1] * 0.004));
    if (input.wheel) this.dist = Math.min(1.6e7, Math.max(2e4, this.dist * Math.exp(input.wheel * 0.0012)));
    const cp = Math.cos(this.pitch);
    const eye: D3 = [
      this.center[0] + Math.sin(this.yaw) * cp * this.dist,
      this.center[1] + Math.sin(this.pitch) * this.dist,
      this.center[2] + Math.cos(this.yaw) * cp * this.dist,
    ];
    out.pos[0] = eye[0]; out.pos[1] = eye[1]; out.pos[2] = eye[2];
    const rel: D3 = [eye[0] - this.center[0], eye[1] - this.center[1], eye[2] - this.center[2]];
    lookQuat(rel, [0, 0, 0], [0, 1, 0], out.quat);
    out.fov = this.fov;
    out.planet = -1;
  }
}
