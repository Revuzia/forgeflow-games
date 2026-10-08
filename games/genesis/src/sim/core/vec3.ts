// GENESIS — tiny allocation-free vector helpers for the sim (no three.js in the sim core).
//
// Positions on a planet are UNIT vectors in the planet's body frame (the frame that spins with the planet); metres
// above the datum sphere are a separate scalar. World-space placement is the renderer's job.

export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function len(a: ArrayLike<number>): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function normalize(out: V3, a: ArrayLike<number>): V3 {
  const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
  out[0] = a[0] / l;
  out[1] = a[1] / l;
  out[2] = a[2] / l;
  return out;
}

export function cross(out: V3, a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function sub(out: V3, a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function add(out: V3, a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function scale(out: V3, a: ArrayLike<number>, s: number): V3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

/** Great-circle angle (radians) between two unit vectors. Multiply by the planet radius for metres. */
export function angleBetween(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(d);
}

/** Spherical linear interpolation between unit vectors a and b (t in [0,1]). */
export function slerp(out: V3, a: ArrayLike<number>, b: ArrayLike<number>, t: number): V3 {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d > 0.9995) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return normalize(out, out);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  out[0] = a[0] * wa + b[0] * wb;
  out[1] = a[1] * wa + b[1] * wb;
  out[2] = a[2] * wa + b[2] * wb;
  return out;
}

/** Move from unit vector p along the tangent direction `dir` (need not be tangent; it is projected) by `angle` rad. */
export function moveAlong(out: V3, p: ArrayLike<number>, dir: ArrayLike<number>, angle: number): V3 {
  const d = dot(dir, p);
  let tx = dir[0] - p[0] * d;
  let ty = dir[1] - p[1] * d;
  let tz = dir[2] - p[2] * d;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (tl < 1e-12) {
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return out;
  }
  tx /= tl;
  ty /= tl;
  tz /= tl;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[0] = p[0] * c + tx * s;
  out[1] = p[1] * c + ty * s;
  out[2] = p[2] * c + tz * s;
  return out;
}

/** Latitude (radians, +north = +Y) of a unit vector in the body frame. */
export function latitude(p: ArrayLike<number>): number {
  return Math.asin(Math.max(-1, Math.min(1, p[1])));
}

/** Longitude (radians) of a unit vector in the body frame (0 at +Z, increasing toward +X). */
export function longitude(p: ArrayLike<number>): number {
  return Math.atan2(p[0], p[2]);
}

/** Unit vector from latitude / longitude (radians). */
export function fromLatLon(out: V3, lat: number, lon: number): V3 {
  const c = Math.cos(lat);
  out[0] = c * Math.sin(lon);
  out[1] = Math.sin(lat);
  out[2] = c * Math.cos(lon);
  return out;
}

/** An orthonormal tangent basis (east, north) at unit vector p. Poles get a stable fallback. */
export function tangentBasis(east: V3, north: V3, p: ArrayLike<number>): void {
  // east = Y x p (normalised); at the poles use X as the reference
  let ex = p[2];
  let ey = 0;
  let ez = -p[0];
  let l = Math.sqrt(ex * ex + ez * ez);
  if (l < 1e-9) {
    ex = 1;
    ey = 0;
    ez = 0;
    l = 1;
  }
  east[0] = ex / l;
  east[1] = ey / l;
  east[2] = ez / l;
  cross(north, p, east);
}
