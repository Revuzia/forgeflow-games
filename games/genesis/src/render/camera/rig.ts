// GENESIS — the camera rig (CONTRACT.md §15.8): owns the controllers and blends between them — orbit, system, free-fly,
// follow (camera/follow.ts), the cinematic dolly (dolly.ts), walking in the god's body (walk.ts) and photo mode
// (photo.ts); `modes` (modes.ts) is the interface's door to the last four (src/ui/host.ts RenderCameraModes).
//
// Switching mode or flying to a planet starts a blend from the last rendered pose to the new controller's live pose.
// Both are expressed relative to a reference point that moves with the world (the target planet's centre, or the star
// for the system view) — planets cross their own diameter in a second at speed — and the blend interpolates the
// DIRECTION by slerp and the DISTANCE logarithmically, so a system-to-surface flight covers six orders of magnitude
// smoothly. Orientation slerps; FOV lerps. Ease-in-out over `duration`.

import type { WorldView } from '../../client/worldview.ts';
import { qRotateInv, type D3 } from '../../client/orbits.ts';
import { copyPose, newPose, type CameraPose } from '../frame.ts';
import { qSlerp, type CameraController, type CameraMode, type InputState } from './common.ts';
import { OrbitCamera } from './orbit.ts';
import { FlyCamera } from './fly.ts';
import { SystemCamera } from './system.ts';
import { FollowCamera } from './follow.ts';
import { DollyCamera } from './dolly.ts';
import { WalkCamera } from './walk.ts';
import { PhotoCamera } from './photo.ts';
import { CameraModes } from './modes.ts';

export class CameraRig {
  readonly orbit = new OrbitCamera();
  readonly fly = new FlyCamera();
  readonly system = new SystemCamera();
  readonly followCam = new FollowCamera();
  readonly dollyCam = new DollyCamera();
  readonly walk = new WalkCamera();
  readonly photoCam = new PhotoCamera();
  /** follow / dolly / walk / photo as the interface and the test surface drive them */
  readonly modes = new CameraModes(this);
  private lostFor = 0;
  active: CameraController = this.orbit;
  readonly pose: CameraPose = newPose();
  private desired: CameraPose = newPose();
  private from: CameraPose = newPose();
  private fromRel: D3 = [0, 0, 0];
  private blendT = 1;
  private blendDur = 0;
  /** set when the pose jumped (exposure / temporal effects should reset) */
  cut = true;

  get mode(): CameraMode { return this.active.mode; }

  /** switch controller; `duration` 0 = cut */
  use(c: CameraController, duration = 1.6): void {
    if (c !== this.active || duration > 0) {
      this.active = c;
      if (duration > 0) {
        copyPose(this.from, this.pose);
        this.blendT = 0;
        this.blendDur = duration;
        this.fromRel[0] = NaN;
      } else {
        this.blendT = 1;
        this.cut = true;
      }
    }
  }

  /** fly from wherever we are to orbit around a planet */
  flyToPlanet(view: WorldView, planet: number, duration = 3.2): void {
    const pv = view.planet(planet);
    if (!pv) return;
    const o = this.orbit;
    o.planet = planet;
    // keep the current view direction toward the planet: focus = the sub-camera point
    const rel = [this.pose.pos[0] - pv.center[0], this.pose.pos[1] - pv.center[1], this.pose.pos[2] - pv.center[2]];
    const l = Math.hypot(rel[0], rel[1], rel[2]) || 1;
    // body-frame direction of the camera
    const d = qRotateInv(pv.quat, [rel[0] / l, rel[1] / l, rel[2] / l]);
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    o.focus = [d[0] / dl, d[1] / dl, d[2] / dl];
    o.dist = pv.params.radius * 3.2;
    o.tiltBias = 0;
    o.tiltFixed = null;
    this.use(o, duration);
  }

  private refPoint(view: WorldView, planet: number, out: D3): D3 {
    const pv = planet >= 0 ? view.planet(planet) : undefined;
    if (pv) { out[0] = pv.center[0]; out[1] = pv.center[1]; out[2] = pv.center[2]; }
    else { out[0] = 0; out[1] = 0; out[2] = 0; }
    return out;
  }

  update(dt: number, view: WorldView, input: InputState): CameraPose {
    this.modes.frame(view);
    // a followed thing that is gone (died, burned out) for a while, a cinematic the player took over: back to orbit
    if (this.active === this.followCam && this.followCam.lost) {
      this.lostFor += dt;
      if (this.lostFor > 2.5) { this.lostFor = 0; this.modes.backToOrbit(); }
    } else this.lostFor = 0;
    if (this.active === this.dollyCam && this.dollyCam.released) { this.dollyCam.released = false; this.modes.backToOrbit(); }
    if (this.active !== this.walk) this.walk.leave();
    this.active.update(dt, view, input, this.desired);
    if (this.blendT >= 1) {
      copyPose(this.pose, this.desired);
      return this.pose;
    }
    const ref = this.refPoint(view, this.desired.planet, [0, 0, 0]);
    if (Number.isNaN(this.fromRel[0])) {
      this.fromRel[0] = this.from.pos[0] - ref[0];
      this.fromRel[1] = this.from.pos[1] - ref[1];
      this.fromRel[2] = this.from.pos[2] - ref[2];
    }
    this.blendT = Math.min(1, this.blendT + dt / Math.max(1e-3, this.blendDur));
    const t = this.blendT * this.blendT * (3 - 2 * this.blendT);
    const a = this.fromRel;
    const b: D3 = [this.desired.pos[0] - ref[0], this.desired.pos[1] - ref[1], this.desired.pos[2] - ref[2]];
    const la = Math.hypot(a[0], a[1], a[2]) || 1, lb = Math.hypot(b[0], b[1], b[2]) || 1;
    const ua: [number, number, number, number] = [a[0] / la, a[1] / la, a[2] / la, 0];
    const ub: [number, number, number, number] = [b[0] / lb, b[1] / lb, b[2] / lb, 0];
    // slerp unit directions (as pure quaternions, w = 0, the same formula applies)
    const dir = slerpDir(ua, ub, t);
    const dist = Math.exp(Math.log(la) * (1 - t) + Math.log(lb) * t);
    this.pose.pos[0] = ref[0] + dir[0] * dist;
    this.pose.pos[1] = ref[1] + dir[1] * dist;
    this.pose.pos[2] = ref[2] + dir[2] * dist;
    qSlerp(this.from.quat, this.desired.quat, t, this.pose.quat);
    this.pose.fov = this.from.fov + (this.desired.fov - this.from.fov) * t;
    this.pose.planet = this.desired.planet;
    return this.pose;
  }

  blending(): boolean { return this.blendT < 1; }
}

function slerpDir(a: number[], b: number[], t: number): D3 {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (d > 0.99999) {
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const k0 = Math.sin((1 - t) * th) / s, k1 = Math.sin(t * th) / s;
  return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
}
