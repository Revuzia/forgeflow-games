// GENESIS — picking (CONTRACT.md §15.8): a camera ray against the DISPLACED terrain of every planet.
//
// The ray is taken into each candidate planet's body frame (double precision), clipped to the planet's bounding
// shell, then marched with steps proportional to the height above the ground (terrain slopes are bounded, so this
// never tunnels through a ridge in practice) and refined by bisection. The ground is groundHeight() from
// src/sim/grid/surface.ts over a GroundSource built from the WorldView's fields — the same function the sim uses to
// place feet — or the water surface where there is water. Result: planet id, body-frame unit vector, cell, distance.

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { WorldView, PlanetView } from '../client/worldview.ts';
import { qRotateInv, type D3 } from '../client/orbits.ts';
import type { CameraPose } from './frame.ts';
import { surfaceRadius } from './camera/common.ts';

export interface PickHit {
  planet: number;
  /** body-frame unit vector of the hit */
  dir: D3;
  /** nearest sim cell */
  cell: number;
  /** distance from the camera (m) */
  dist: number;
  /** height of the hit above the datum (m) */
  height: number;
}

const _v = new Vector3();

/** ray direction (world = system axes) through normalised device coordinates */
export function rayDirection(camera: PerspectiveCamera, ndcX: number, ndcY: number, out: D3): D3 {
  _v.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
  out[0] = _v.x; out[1] = _v.y; out[2] = _v.z;
  return out;
}

function pickPlanet(pv: PlanetView, pose: CameraPose, dir: D3): PickHit | null {
  const R = pv.params.radius;
  const oS: D3 = [pose.pos[0] - pv.center[0], pose.pos[1] - pv.center[1], pose.pos[2] - pv.center[2]];
  const o = qRotateInv(pv.quat, oS);
  const d = qRotateInv(pv.quat, dir);
  const top = R + Math.max(pv.maxSurface, 0) + 8;
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - top * top;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = Math.max(0, -b - sq);
  const tEnd = -b + sq;
  if (tEnd < 0) return null;
  const p: D3 = [0, 0, 0];
  const at = (tt: number): number => {
    p[0] = o[0] + d[0] * tt; p[1] = o[1] + d[1] * tt; p[2] = o[2] + d[2] * tt;
    const r = Math.hypot(p[0], p[1], p[2]);
    const u: D3 = [p[0] / r, p[1] / r, p[2] / r];
    return r - surfaceRadius(pv, u);
  };
  let h = at(t);
  if (h < 0) return null; // camera underground: no pick
  let prevT = t;
  for (let i = 0; i < 600 && t <= tEnd; i++) {
    prevT = t;
    t += Math.max(0.15, h * 0.6);
    h = at(t);
    if (h < 0) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 24; k++) {
        const mid = 0.5 * (lo + hi);
        if (at(mid) < 0) hi = mid; else lo = mid;
      }
      at(hi);
      const r = Math.hypot(p[0], p[1], p[2]);
      const u: D3 = [p[0] / r, p[1] / r, p[2] / r];
      return { planet: pv.id, dir: u, cell: pv.grid.nearestCell(u[0], u[1], u[2]), dist: hi, height: r - R };
    }
  }
  return null;
}

/** nearest hit over all planets along the ray */
export function pick(view: WorldView, pose: CameraPose, dir: D3): PickHit | null {
  let best: PickHit | null = null;
  for (const pv of view.planets) {
    if (!pv.alive) continue;
    const hit = pickPlanet(pv, pose, dir);
    if (hit && (!best || hit.dist < best.dist)) best = hit;
  }
  return best;
}
