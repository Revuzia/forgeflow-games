// GENESIS — the render lane's camera modes as the interface drives them (src/ui/host.ts RenderCameraModes): follow,
// the cinematic dolly, walking in the god's body, photo mode and its lens — each a controller of the rig, so every
// switch blends (render/camera/rig.ts). It also takes the test surface's camera specs for those modes
// (CONTRACT.md §18: camera({ mode: 'follow' | 'dolly' | 'walk' | 'photo', ... })).

import type { WorldView } from '../../client/worldview.ts';
import type { EntityRef, UnitVec } from '../../sim/types.ts';
import { qRotateInv, type D3 } from '../../client/orbits.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import { nearestPlanet } from '../frame.ts';
import type { CameraRig } from './rig.ts';
import { PHOTO, type Lens } from './photo.ts';
import { resolveTarget } from './targets.ts';
import type { SeenEvent } from './walk.ts';

const DEG = Math.PI / 180;

/** the spec fields the modes read (app.ts CameraSpec plus the lens) */
export interface ModeSpec {
  mode: 'follow' | 'dolly' | 'walk' | 'photo';
  planet: number;
  lat: number;
  lon: number;
  /** heading (deg) */
  yaw?: number;
  pitch?: number;
  alt?: number;
  dist?: number;
  fov?: number;
  target?: EntityRef | null;
  /** dolly: pin the move at this fraction; its sweep and length */
  t?: number;
  radius?: number;
  duration?: number;
  /** photo lens */
  focus?: number;
  blur?: number;
  exposure?: number;
  roll?: number;
  /** walk: the god's alignment for the look of the body (−1..1) */
  alignment?: number;
  blend?: number;
}

export class CameraModes {
  private rig: CameraRig;
  private view: WorldView | null = null;
  private pendingPhoto: boolean | null = null;
  /** the controller to go back to when photo mode ends */
  private beforePhoto: 'orbit' | 'follow' | 'dolly' | 'walk' | 'fly' | 'system' = 'orbit';
  readonly dof = true;
  /** the App sends god.seen with these (walking among the people) */
  set onSeen(f: ((e: SeenEvent) => void) | null) { this.rig.walk.onSeen = f; }

  constructor(rig: CameraRig) { this.rig = rig; }

  /** the rig hands the world over each frame (the modes need it to place cameras) */
  frame(view: WorldView): void {
    this.view = view;
    if (this.pendingPhoto !== null) { const on = this.pendingPhoto; this.pendingPhoto = null; this.photo(on); }
  }

  follow(ref: EntityRef | null): void {
    const r = this.rig;
    if (!ref) { if (r.mode === 'follow') this.backToOrbit(); return; }
    r.followCam.set(ref);
    r.use(r.followCam, 1.2);
  }

  dolly(o: { planet: number; center: UnitVec; radius: number } | null): void {
    const r = this.rig;
    if (!o) { if (r.mode === 'dolly') this.backToOrbit(); return; }
    // start the arc from where the eye is now (its bearing from the place)
    let h0 = 0.4;
    const pv = this.view?.planet(o.planet);
    if (pv) {
      const p = r.pose.pos;
      const b = qRotateInv(pv.quat, [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]]);
      const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
      tangentBasis(e, n, o.center);
      h0 = Math.atan2(b[0] * e[0] + b[1] * e[1] + b[2] * e[2], b[0] * n[0] + b[1] * n[1] + b[2] * n[2]);
    }
    r.dollyCam.begin(o.planet, o.center, o.radius, h0);
    r.dollyCam.pinned = null;
    r.use(r.dollyCam, 1.8);
  }

  walk(o: { planet: number; at: UnitVec; heading: number } | null): void {
    const r = this.rig;
    if (!o) {
      if (r.mode === 'walk') {
        // rise from the ground: an orbit over where the body stood
        const w = r.walk;
        const o2 = r.orbit;
        o2.planet = w.planet;
        o2.focus = [w.dir[0], w.dir[1], w.dir[2]];
        o2.dist = 140;
        o2.heading = w.yaw;
        o2.tiltFixed = 60;
        o2.tiltBias = 0;
        w.leave();
        r.use(o2, 1.6);
      }
      return;
    }
    r.walk.place(o.planet, o.at, o.heading);
    r.use(r.walk, 1.4);
  }

  photo(on: boolean): void {
    const r = this.rig;
    if (on) {
      if (!this.view) { this.pendingPhoto = true; return; }
      if (r.mode !== 'photo') this.beforePhoto = r.mode === 'surface' ? 'fly' : (r.mode as typeof this.beforePhoto);
      r.photoCam.from(r.pose, this.view);
      PHOTO.lens.fov = r.pose.fov;
      PHOTO.on = true;
      r.use(r.photoCam, 0.25);
    } else {
      PHOTO.on = false;
      if (r.mode !== 'photo') return;
      const back = this.beforePhoto;
      if (back === 'follow' && r.followCam.ref) r.use(r.followCam, 0.8);
      else if (back === 'walk') r.use(r.walk, 0.8);
      else if (back === 'dolly') r.use(r.dollyCam, 0.8);
      else if (back === 'system') r.use(r.system, 0.8);
      else this.backToOrbit();
    }
  }

  lens(l: Readonly<Lens>): void {
    Object.assign(PHOTO.lens, l);
    this.rig.photoCam.fov = l.fov;
  }

  /** the orbit camera over where the eye looks now */
  backToOrbit(): void {
    const r = this.rig;
    const view = this.view;
    const o = r.orbit;
    if (view) {
      const pv = (r.pose.planet >= 0 ? view.planet(r.pose.planet) : null) ?? nearestPlanet(view.planets, r.pose.pos);
      if (pv) {
        const p = r.pose.pos;
        const b = qRotateInv(pv.quat, [p[0] - pv.center[0], p[1] - pv.center[1], p[2] - pv.center[2]]);
        const l = Math.hypot(b[0], b[1], b[2]) || 1;
        o.planet = pv.id;
        // follow / dolly: centre the orbit on what was framed
        const sub = r.mode === 'follow' ? r.followCam.subject() : null;
        if (sub && sub.planet === pv.id) { const sl = Math.hypot(sub.pos[0], sub.pos[1], sub.pos[2]) || 1; o.focus = [sub.pos[0] / sl, sub.pos[1] / sl, sub.pos[2] / sl]; }
        else if (r.mode === 'dolly') o.focus = [...r.dollyCam.center] as D3;
        else o.focus = [b[0] / l, b[1] / l, b[2] / l];
        o.dist = Math.max(40, Math.min(pv.params.radius * 3, l - pv.params.radius + 60));
        o.tiltFixed = null;
        o.tiltBias = 0;
      }
    }
    r.use(o, 1.2);
  }

  /** the test surface's camera spec for these modes (lat / lon already resolved from a POI or a target) */
  applySpec(s: ModeSpec, view: WorldView): void {
    this.view = view;
    const r = this.rig;
    const blend = s.blend ?? 0;
    const la = s.lat * DEG, lo = s.lon * DEG;
    const at: UnitVec = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    switch (s.mode) {
      case 'follow': {
        if (!s.target) return;
        r.followCam.set(s.target);
        if (s.yaw != null) r.followCam.yaw = s.yaw * DEG;
        if (s.pitch != null) r.followCam.pitch = s.pitch * DEG;
        if (s.fov) r.followCam.fov = s.fov;
        if (s.dist) {
          const st = resolveTarget(view, s.target);
          const natural = st ? st.size * (s.target.kind === 'ship' ? 2.4 : 3.4) + 4 : 20;
          r.followCam.zoom = s.dist / Math.max(1, natural);
        }
        r.use(r.followCam, blend);
        break;
      }
      case 'dolly': {
        const radius = s.radius ?? (s.target?.kind === 'settlement' ? 140 : 90);
        r.dollyCam.begin(s.planet, at, radius, (s.yaw ?? 25) * DEG);
        if (s.duration) r.dollyCam.duration = s.duration;
        r.dollyCam.pinned = s.t ?? null;
        r.use(r.dollyCam, blend);
        break;
      }
      case 'walk': {
        r.walk.place(s.planet, at, (s.yaw ?? 0) * DEG);
        if (s.pitch != null) r.walk.pitch = s.pitch * DEG;
        if (s.dist != null) r.walk.dist = Math.max(0.6, s.dist);
        if (s.fov) r.walk.fov = s.fov;
        if (s.alignment != null) r.walk.alignment = s.alignment;
        r.use(r.walk, blend);
        break;
      }
      case 'photo': {
        r.photoCam.at(view, s.planet, s.lat, s.lon, s.alt ?? 30, s.yaw ?? 0, s.pitch ?? -4);
        const L = PHOTO.lens;
        if (s.fov) L.fov = s.fov;
        if (s.focus != null) L.focus = s.focus;
        if (s.blur != null) L.blur = s.blur;
        if (s.exposure != null) L.exposure = s.exposure;
        if (s.roll != null) L.roll = s.roll;
        r.photoCam.fov = L.fov;
        PHOTO.on = true;
        r.use(r.photoCam, blend);
        break;
      }
    }
  }
}
