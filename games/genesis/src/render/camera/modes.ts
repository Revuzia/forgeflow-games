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
  /** photo from a stand-off: aim at this body-frame point (m) of `planet` instead of the target (a ship's launch site
   * after it has gone, a crater) — shot scripts */
  focusPoint?: [number, number, number];
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
    r.walk.pinnedAlignment = null;
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

  /**
   * Photo mode aimed at a thing from a stand-off, like a tracking camera on the ground: the eye stands `dist` metres
   * (along the ground) from the thing's ground point on bearing `yaw` (deg from north), `alt` over the ground, aimed at
   * the thing itself (a rocket climbing, a moon falling) with `pitch` added to the aim. Null when the thing is not here.
   */
  private standOff(view: WorldView, s: ModeSpec): { planet: number; lat: number; lon: number; yaw: number; pitch: number } | null {
    const ref = s.target ?? null;
    let planet = s.planet;
    let T: D3 | null = s.focusPoint ? [s.focusPoint[0], s.focusPoint[1], s.focusPoint[2]] : null;
    if (!T && ref && ref.kind === 'ship') {
      // a ship: where the sim says it is at the snapshot (the ship layer's pose may be a frame or a stepped wait old)
      const sv = view.ships.find((q) => q.id === ref.id);
      const pv0 = sv && sv.planet >= 0 ? view.planet(sv.planet) : undefined;
      if (sv && pv0) {
        const l = Math.hypot(sv.pos[0], sv.pos[1], sv.pos[2]) || 1;
        const r0 = view.groundRadius(pv0, sv.pos[0] / l, sv.pos[1] / l, sv.pos[2] / l) + Math.max(0, sv.alt);
        planet = pv0.id;
        T = [sv.pos[0] / l * r0, sv.pos[1] / l * r0, sv.pos[2] / l * r0];
      }
    }
    if (!T && ref) {
      const st = resolveTarget(view, ref);
      if (st && st.planet >= 0) { planet = st.planet; T = [st.pos[0], st.pos[1], st.pos[2]]; }
    }
    const pv = view.planet(planet);
    if (!T || !pv) return null;
    const R = pv.params.radius;
    const u: D3 = [T[0], T[1], T[2]];
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const e: D3 = [0, 0, 0], n: D3 = [0, 0, 0];
    tangentBasis(e, n, u);
    const b = (s.yaw ?? 0) * DEG, a = (s.dist ?? 300) / R;
    const c: D3 = [0, 1, 2].map((i) => u[i] * Math.cos(a) + (n[i] * Math.cos(b) + e[i] * Math.sin(b)) * Math.sin(a)) as D3;
    const cl = Math.hypot(c[0], c[1], c[2]) || 1;
    c[0] /= cl; c[1] /= cl; c[2] /= cl;
    const rc = view.groundRadius(pv, c[0], c[1], c[2]) + (s.alt ?? 30);
    const v: D3 = [T[0] - c[0] * rc, T[1] - c[1] * rc, T[2] - c[2] * rc];
    const vl = Math.hypot(v[0], v[1], v[2]) || 1;
    tangentBasis(e, n, c);
    const yaw = Math.atan2(v[0] * e[0] + v[1] * e[1] + v[2] * e[2], v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / DEG;
    const pitch = Math.asin(Math.max(-1, Math.min(1, (v[0] * c[0] + v[1] * c[1] + v[2] * c[2]) / vl))) / DEG + (s.pitch ?? 0);
    return { planet: pv.id, lat: Math.asin(Math.max(-1, Math.min(1, c[1]))) / DEG, lon: Math.atan2(c[0], c[2]) / DEG, yaw, pitch };
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
          if (st) r.followCam.zoom = s.dist / Math.max(1, st.size * (s.target.kind === 'ship' ? 2.4 : 3.4) + 4);
          // (not drawn yet — a ship launched this very tick: measured on its first frame)
          else r.followCam.wantDist = s.dist;
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
        r.walk.pinnedAlignment = s.alignment ?? null;
        if (s.alignment != null) r.walk.alignment = s.alignment;
        r.use(r.walk, blend);
        break;
      }
      case 'photo': {
        const aim = (s.target || s.focusPoint) && s.dist ? this.standOff(view, s) : null;
        if (aim) r.photoCam.at(view, aim.planet, aim.lat, aim.lon, s.alt ?? 30, aim.yaw, aim.pitch);
        else r.photoCam.at(view, s.planet, s.lat, s.lon, s.alt ?? 30, s.yaw ?? 0, s.pitch ?? -4);
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
