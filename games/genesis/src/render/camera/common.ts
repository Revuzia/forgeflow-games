// GENESIS — camera plumbing shared by every controller: the controller interface, pointer/key input state, double
// precision look-at, and the ground query cameras use to stay out of the terrain.

import type { WorldView, PlanetView } from '../../client/worldview.ts';
import type { CameraPose } from '../frame.ts';
import type { D3, DQ } from '../../client/orbits.ts';
import { groundHeight } from '../../sim/grid/surface.ts';

export type CameraMode = 'orbit' | 'surface' | 'system' | 'fly';

export interface InputState {
  /** pixels moved this frame with each button held */
  dragL: [number, number];
  dragR: [number, number];
  dragM: [number, number];
  wheel: number;
  keys: Set<string>;
  shift: boolean;
  /** viewport height in CSS pixels (for pixel → angle conversions) */
  viewH: number;
}

export function newInput(): InputState {
  return { dragL: [0, 0], dragR: [0, 0], dragM: [0, 0], wheel: 0, keys: new Set(), shift: false, viewH: 720 };
}

export interface CameraController {
  readonly mode: CameraMode;
  /** the planet the pose is attached to (-1 = system) */
  planet: number;
  /** compute this frame's pose; `input` is consumed (drags / wheel already accumulated for the frame) */
  update(dt: number, view: WorldView, input: InputState, out: CameraPose): void;
}

/** double-precision look-at → quaternion (camera looks down −Z, `up` hint) */
export function lookQuat(eye: ArrayLike<number>, target: ArrayLike<number>, up: ArrayLike<number>, out: DQ): DQ {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz);
  if (l < 1e-9) {
    // up parallel to the view: pick any perpendicular
    const a = Math.abs(zx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    xx = a[1] * zz - a[2] * zy; xy = a[2] * zx - a[0] * zz; xz = a[0] * zy - a[1] * zx;
    l = Math.hypot(xx, xy, xz);
  }
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return basisQuat(xx, xy, xz, yx, yy, yz, zx, zy, zz, out);
}

/** quaternion from an orthonormal basis given as columns X, Y, Z */
export function basisQuat(m11: number, m21: number, m31: number, m12: number, m22: number, m32: number, m13: number, m23: number, m33: number, out: DQ): DQ {
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    out[3] = 0.25 / s; out[0] = (m32 - m23) * s; out[1] = (m13 - m31) * s; out[2] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    out[3] = (m32 - m23) / s; out[0] = 0.25 * s; out[1] = (m12 + m21) / s; out[2] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    out[3] = (m13 - m31) / s; out[0] = (m12 + m21) / s; out[1] = 0.25 * s; out[2] = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    out[3] = (m21 - m12) / s; out[0] = (m13 + m31) / s; out[1] = (m23 + m32) / s; out[2] = 0.25 * s;
  }
  return out;
}

export function qSlerp(a: DQ, b: DQ, t: number, out: DQ): DQ {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0: number, k1: number;
  if (cos > 0.9999) { k0 = 1 - t; k1 = t; }
  else {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  out[0] = a[0] * k0 + bx * k1; out[1] = a[1] * k0 + by * k1; out[2] = a[2] * k0 + bz * k1; out[3] = a[3] * k0 + bw * k1;
  const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
  return out;
}

/** radius (from the centre) of whatever the camera must stay above: ground or the water surface */
export function surfaceRadius(pv: PlanetView, dir: ArrayLike<number>): number {
  const g = pv.grid;
  let r = pv.params.radius;
  try {
    r = Math.max(r - 1e4, groundR(pv, dir));
  } catch { /* fields not ready */ }
  const w = pv.fields.get('water');
  const s = pv.fields.get('surface');
  if (w && s) {
    const h = g.locate(dir[0], dir[1], dir[2]);
    const lvl = (s[h.a] + w[h.a]) * h.wa + (s[h.b] + w[h.b]) * h.wb + (s[h.c] + w[h.c]) * h.wc;
    const wet = w[h.a] * h.wa + w[h.b] * h.wb + w[h.c] * h.wc;
    if (wet > 0.05) r = Math.max(r, pv.params.radius + lvl);
  }
  return r;
}

function groundR(pv: PlanetView, dir: ArrayLike<number>): number {
  return groundHeight(pv.ground, dir[0], dir[1], dir[2]);
}

export function norm3(v: D3): D3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
