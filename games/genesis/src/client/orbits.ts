// GENESIS — client-side celestial mechanics: Kepler positions and planet body orientation at any (fractional) tick.
//
// The sim sends OrbitParams + PlanetParams in snapshots; positions are analytic (CONTRACT.md §12), so the client
// evaluates them at the INTERPOLATED render tick instead of waiting for snapshots. Everything here is double precision
// (plain JS numbers) in the SYSTEM frame: metres, star at the origin, +Y = ecliptic north.
//
// Conventions (shared with the lookdev generator and documented for the sim lane):
//   * Orbits run counter-clockwise seen from +Y. Mean anomaly M = phase0 + 2π·tick/period. In the orbital plane the
//     position is (a(cosE − e), 0, −a√(1−e²) sinE), then tilted by `inc` about +X and turned by `node` about +Y.
//   * Body quaternion = orbitPlane(node, inc) × tilt(axialTilt about +X) × spin(about +Y). Positive spin is prograde,
//     so the ground moves east (body +Z at lon 0 toward +X) and local solar time advances.
//   * With phase0 = 0 the planet sits at the vernal equinox at tick 0 and northern summer solstice a quarter year
//     later (solar declination δ ≈ axialTilt · sin(2π · dayOfYear / yearDays)).

import type { OrbitParams, PlanetParams } from '../sim/types.ts';

export type D3 = [number, number, number];
/** quaternion (x, y, z, w), double precision */
export type DQ = [number, number, number, number];

/** solve Kepler's equation M = E − e sinE (Newton, e < 0.97) */
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

/** Position of a body relative to its parent (metres, system axes) at `tick`. */
export function orbitOffset(o: OrbitParams, tick: number, out: D3 = [0, 0, 0]): D3 {
  if (!(o.a > 0) || !(o.period > 0)) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const e = Math.min(0.97, Math.max(0, o.e || 0));
  const M = (o.phase0 || 0) + (2 * Math.PI * tick) / o.period;
  const E = eccentricAnomaly(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
  const x = o.a * (Math.cos(E) - e);
  const zp = -o.a * Math.sqrt(1 - e * e) * Math.sin(E);
  // tilt about +X by inc: (x, y, z) -> (x, y cos i − z sin i, y sin i + z cos i) with y = 0
  const ci = Math.cos(o.inc || 0), si = Math.sin(o.inc || 0);
  const y1 = -zp * si;
  const z1 = zp * ci;
  // turn about +Y by node: (x, z) -> (x cos n + z sin n, −x sin n + z cos n)
  const cn = Math.cos(o.node || 0), sn = Math.sin(o.node || 0);
  out[0] = x * cn + z1 * sn;
  out[1] = y1;
  out[2] = -x * sn + z1 * cn;
  return out;
}

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

/** rotate v by q (q·v·q*) */
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

const _qa: DQ = [0, 0, 0, 1];
const _qb: DQ = [0, 0, 0, 1];
const _qc: DQ = [0, 0, 0, 1];

/** Orientation of the orbital plane (node about +Y, then inc about +X). */
export function orbitPlaneQuat(o: OrbitParams, out: DQ = [0, 0, 0, 1]): DQ {
  qAxis(0, 1, 0, o.node || 0, _qa);
  qAxis(1, 0, 0, o.inc || 0, _qb);
  return qMul(_qa, _qb, out);
}

/** Spin angle at `tick` given the snapshot's spin at `snapTick` (sunFrozen stops it). */
export function spinAt(p: PlanetParams, snapTick: number, tick: number): number {
  if (p.sunFrozen || !(p.dayHours > 0)) return p.spin;
  return p.spin + (2 * Math.PI * (tick - snapTick)) / (p.dayHours * 60);
}

/** Body-frame → system-frame rotation at a given spin angle. */
export function bodyQuat(p: PlanetParams, spin: number, out: DQ = [0, 0, 0, 1]): DQ {
  orbitPlaneQuat(p.orbit, _qc);
  qAxis(1, 0, 0, p.axialTilt || 0, _qa);
  qMul(_qc, _qa, _qb);
  qAxis(0, 1, 0, spin, _qa);
  return qMul(_qb, _qa, out);
}

/** Blackbody colour (linear RGB, max component 1) for a temperature in kelvin (fit of the CIE locus, 1 000–40 000 K). */
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
  // sRGB-ish 0..255 -> linear
  const lin = (c: number) => { const s = Math.min(255, Math.max(0, c)) / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  r = lin(r); g = lin(g); b = lin(b);
  const m = Math.max(r, g, b, 1e-6);
  out[0] = r / m; out[1] = g / m; out[2] = b / m;
  return out;
}
