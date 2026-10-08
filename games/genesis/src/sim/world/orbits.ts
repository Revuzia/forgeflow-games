// GENESIS — celestial mechanics as PURE functions of (params, tick): Kepler orbits, moon hierarchy, planet spin and the
// body-frame direction of the star. No state, no stepping (CONTRACT.md §12): the sim evaluates them at integer ticks,
// the renderer at its interpolated fractional render tick, and both get the same answer.
//
// Conventions (identical to src/client/orbits.ts, which predates this file):
//   * System frame: metres, star at the origin, +Y = ecliptic north. Orbits run counter-clockwise seen from +Y.
//   * Mean anomaly M = phase0 + 2π·tick/period. In the orbital plane the position is (a(cosE − e), 0, −a√(1−e²) sinE),
//     then tilted by `inc` about +X and turned by `node` about +Y.
//   * Body quaternion = orbitPlane(node, inc) × tilt(axialTilt about +X) × spin(about +Y). Positive spin is prograde.
//   * The pole leans toward the orbit plane's +Z, so true anomaly 0 is the vernal (northern spring) equinox and true
//     anomaly 90° the northern summer solstice. The calendar year fraction is the mean anomaly / 2π.

import type { OrbitParams } from '../types.ts';

export type D3 = [number, number, number];
/** quaternion (x, y, z, w) */
export type DQ = [number, number, number, number];

const TAU = Math.PI * 2;

/** solve Kepler's equation M = E − e sinE (Newton; e < 0.97) */
export function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 12; i++) {
    const f = E - e * Math.sin(E) - M;
    const d = 1 - e * Math.cos(E);
    const dE = f / d;
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** mean anomaly (unwrapped) at `tick` */
export function meanAnomaly(o: OrbitParams, tick: number): number {
  return (o.phase0 || 0) + (o.period > 0 ? (TAU * tick) / o.period : 0);
}

/** fraction of the year 0..1 (0 = vernal equinox) */
export function yearFraction(o: OrbitParams, tick: number): number {
  const M = meanAnomaly(o, tick);
  const f = M / TAU;
  return f - Math.floor(f);
}

/** completed orbits since the vernal equinox before tick 0 (the calendar year index, 0-based) */
export function orbitCount(o: OrbitParams, tick: number): number {
  return Math.floor(meanAnomaly(o, tick) / TAU);
}

/** Position of a body relative to its parent (metres, system axes) at a (fractional) tick. */
export function orbitOffset(o: OrbitParams, tick: number, out: D3 = [0, 0, 0]): D3 {
  if (!(o.a > 0) || !(o.period > 0)) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const e = Math.min(0.97, Math.max(0, o.e || 0));
  const M = meanAnomaly(o, tick);
  const E = eccentricAnomaly(((M % TAU) + TAU) % TAU, e);
  const x = o.a * (Math.cos(E) - e);
  const zp = -o.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const ci = Math.cos(o.inc || 0), si = Math.sin(o.inc || 0);
  const y1 = -zp * si;
  const z1 = zp * ci;
  const cn = Math.cos(o.node || 0), sn = Math.sin(o.node || 0);
  out[0] = x * cn + z1 * sn;
  out[1] = y1;
  out[2] = -x * sn + z1 * cn;
  return out;
}

/**
 * System-frame centre of body `id`, following parents (moons orbit planets). `orbitOf(id)` returns the body's orbit or
 * undefined for unknown ids (treated as the star / origin).
 */
export function bodyCenter(orbitOf: (id: number) => OrbitParams | undefined, id: number, tick: number, out: D3 = [0, 0, 0]): D3 {
  let cx = 0, cy = 0, cz = 0;
  let cur = id;
  const tmp: D3 = [0, 0, 0];
  for (let depth = 0; depth < 8 && cur >= 0; depth++) {
    const o = orbitOf(cur);
    if (!o) break;
    orbitOffset(o, tick, tmp);
    cx += tmp[0]; cy += tmp[1]; cz += tmp[2];
    cur = o.parent;
  }
  out[0] = cx; out[1] = cy; out[2] = cz;
  return out;
}

// ───────────────────────────── quaternions ─────────────────────────────

export function qMul(a: DQ, b: DQ, out: DQ = [0, 0, 0, 1]): DQ {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function qAxis(x: number, y: number, z: number, angle: number, out: DQ = [0, 0, 0, 1]): DQ {
  const s = Math.sin(angle / 2);
  out[0] = x * s; out[1] = y * s; out[2] = z * s; out[3] = Math.cos(angle / 2);
  return out;
}

/** rotate v by q */
export function qRotate(q: DQ, v: ArrayLike<number>, out: D3 = [0, 0, 0]): D3 {
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

/** rotate v by the inverse of q */
export function qRotateInv(q: DQ, v: ArrayLike<number>, out: D3 = [0, 0, 0]): D3 {
  const c: DQ = [-q[0], -q[1], -q[2], q[3]];
  return qRotate(c, v, out);
}

/** orientation of the orbital plane (node about +Y, then inc about +X) */
export function orbitPlaneQuat(o: OrbitParams, out: DQ = [0, 0, 0, 1]): DQ {
  const a = qAxis(0, 1, 0, o.node || 0);
  const b = qAxis(1, 0, 0, o.inc || 0);
  return qMul(a, b, out);
}

/** body (spinning) frame -> system frame */
export function bodyQuat(o: OrbitParams, axialTilt: number, spin: number, out: DQ = [0, 0, 0, 1]): DQ {
  const plane = orbitPlaneQuat(o);
  const tilt = qAxis(1, 0, 0, axialTilt || 0);
  const pt = qMul(plane, tilt);
  const s = qAxis(0, 1, 0, spin);
  return qMul(pt, s, out);
}

/** equatorial (tilted, non-spinning) frame -> system frame */
export function equatorQuat(o: OrbitParams, axialTilt: number, out: DQ = [0, 0, 0, 1]): DQ {
  const plane = orbitPlaneQuat(o);
  const tilt = qAxis(1, 0, 0, axialTilt || 0);
  return qMul(plane, tilt, out);
}

// ───────────────────────────── spin, sun, calendar ─────────────────────────────

/** Rotation angle at `tick` from an anchor (angle `spin0` at `tick0`); a frozen sun keeps the anchor angle. */
export function spinAt(spin0: number, tick0: number, dayHours: number, frozen: boolean, tick: number): number {
  if (frozen || !(dayHours > 0)) return spin0;
  return spin0 + (TAU * (tick - tick0)) / (dayHours * 60);
}

/**
 * Unit vector toward the star in the BODY frame of a planet whose centre is `center` (system frame), at rotation
 * `spin`. Every insolation computation in the sim (climate, plants, sleep) reads this.
 */
export function sunDirBody(center: ArrayLike<number>, o: OrbitParams, axialTilt: number, spin: number, out: D3 = [0, 0, 0]): D3 {
  const l = Math.hypot(center[0], center[1], center[2]) || 1;
  const s: D3 = [-center[0] / l, -center[1] / l, -center[2] / l];
  const q = bodyQuat(o, axialTilt, spin);
  return qRotateInv(q, s, out);
}

/** Longitude (rad) of the star in the planet's equatorial non-spinning frame. */
export function sunLongitude(center: ArrayLike<number>, o: OrbitParams, axialTilt: number): number {
  const l = Math.hypot(center[0], center[1], center[2]) || 1;
  const s: D3 = [-center[0] / l, -center[1] / l, -center[2] / l];
  const q = equatorQuat(o, axialTilt);
  const e = qRotateInv(q, s);
  return Math.atan2(e[0], e[2]);
}

/** local solar hour (0..dayHours scaled to 0..24 convention) at body longitude 0 for a given spin */
export function hourAtLon0(spin: number, sunLon: number): number {
  const h = 12 + ((spin - sunLon) / TAU) * 24;
  return ((h % 24) + 24) % 24;
}

/** the spin angle that puts the sun at local hour `hour` over longitude 0 */
export function spinForHour(hour: number, sunLon: number): number {
  return sunLon + ((hour - 12) / 24) * TAU;
}

/** Year fraction of the middle of a pinned season (0 spring equinox, 1 summer solstice, 2 autumn, 3 winter). */
export function seasonYearFraction(season: number): number {
  return (((Math.round(season) % 4) + 4) % 4) * 0.25;
}

/**
 * Orbital position of a body as if it were at year fraction `yf` (used when a season is pinned: the sun sits where it
 * would at that point of the year, while the planet stays put on its orbit for the renderer).
 */
export function orbitOffsetAtYearFraction(o: OrbitParams, yf: number, out: D3 = [0, 0, 0]): D3 {
  const fake: OrbitParams = { ...o, phase0: yf * TAU, period: o.period };
  return orbitOffset(fake, 0, out);
}

/** blackbody colour (linear RGB, max component 1) for a temperature in kelvin (1 000–40 000 K) */
export function blackbody(tempK: number, out: D3 = [1, 1, 1]): D3 {
  const t = Math.min(40000, Math.max(1000, tempK)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = (c: number) => { const s = Math.min(255, Math.max(0, c)) / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  r = lin(r); g = lin(g); b = lin(b);
  const m = Math.max(r, g, b, 1e-6);
  out[0] = r / m; out[1] = g / m; out[2] = b / m;
  return out;
}

/** 1 AU in game metres: the home orbit (Earth-like light at luminosity 1) */
export const AU = 1.5e6;
