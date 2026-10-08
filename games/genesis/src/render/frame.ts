// GENESIS — frames and the floating origin (CONTRACT.md §15.1).
//
// The system frame is metres in double precision, star at the origin. Every frame the camera sits at the three.js
// origin and every object is placed at (its system position − the camera's system position), so the GPU only ever
// sees small numbers. Planets are Groups at that offset with quaternion = body orientation; terrain, water and (later)
// trees, buildings and crowds are children in the BODY frame (unit vectors × (radius + height)).
//
// A CameraPose is double precision too: system position + orientation (camera looks down its −Z, +Y up).

import { Quaternion, Vector3 } from 'three';
import type { D3, DQ } from '../client/orbits.ts';
import { qRotate, qRotateInv } from '../client/orbits.ts';
import type { PlanetView } from '../client/worldview.ts';

export interface CameraPose {
  /** system-frame position (m) */
  pos: D3;
  /** system-frame orientation */
  quat: DQ;
  /** vertical field of view (degrees) */
  fov: number;
  /** the planet the camera belongs to (orbit / surface modes), -1 = none (system view) */
  planet: number;
}

export function newPose(): CameraPose {
  return { pos: [0, 0, 1e6], quat: [0, 0, 0, 1], fov: 50, planet: -1 };
}

export function copyPose(dst: CameraPose, src: CameraPose): CameraPose {
  dst.pos[0] = src.pos[0]; dst.pos[1] = src.pos[1]; dst.pos[2] = src.pos[2];
  dst.quat[0] = src.quat[0]; dst.quat[1] = src.quat[1]; dst.quat[2] = src.quat[2]; dst.quat[3] = src.quat[3];
  dst.fov = src.fov;
  dst.planet = src.planet;
  return dst;
}

/** world (camera-relative) position of a system-frame point */
export function toWorld(sys: ArrayLike<number>, cam: CameraPose, out: Vector3): Vector3 {
  return out.set(sys[0] - cam.pos[0], sys[1] - cam.pos[1], sys[2] - cam.pos[2]);
}

export function quatToThree(q: DQ, out: Quaternion): Quaternion {
  return out.set(q[0], q[1], q[2], q[3]);
}

/** a system-frame point → the planet's body frame (m, relative to its centre) */
export function sysToBody(pv: PlanetView, sys: ArrayLike<number>, out: D3 = [0, 0, 0]): D3 {
  const d: D3 = [sys[0] - pv.center[0], sys[1] - pv.center[1], sys[2] - pv.center[2]];
  return qRotateInv(pv.quat, d, out);
}

/** a body-frame point (m, relative to the centre) → system frame */
export function bodyToSys(pv: PlanetView, body: ArrayLike<number>, out: D3 = [0, 0, 0]): D3 {
  qRotate(pv.quat, body, out);
  out[0] += pv.center[0]; out[1] += pv.center[1]; out[2] += pv.center[2];
  return out;
}

/** distance (m) between a system point and a planet's centre */
export function distTo(pv: PlanetView, sys: ArrayLike<number>): number {
  return Math.hypot(sys[0] - pv.center[0], sys[1] - pv.center[1], sys[2] - pv.center[2]);
}

/** which planet a camera position belongs to: the one with the smallest altitude-to-radius ratio */
export function nearestPlanet(planets: PlanetView[], sys: ArrayLike<number>): PlanetView | null {
  let best: PlanetView | null = null;
  let bestScore = Infinity;
  for (const pv of planets) {
    const d = distTo(pv, sys);
    const score = (d - pv.params.radius) / pv.params.radius;
    if (score < bestScore) { bestScore = score; best = pv; }
  }
  return best;
}

/** star illuminance (scene units) at a planet: 8 at the reference distance for a luminosity-1 star */
export const SUN_E_REF = 8;
export const SUN_DIST_REF = 1.5e6;
export function sunIlluminance(luminosity: number, dist: number): number {
  const d = Math.max(dist, 1);
  return Math.min(80, SUN_E_REF * Math.max(0, luminosity) * (SUN_DIST_REF / d) * (SUN_DIST_REF / d));
}
