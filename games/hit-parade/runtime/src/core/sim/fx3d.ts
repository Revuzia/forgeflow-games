// HIT PARADE — fixed-point 3D geometry for the deterministic sim (CHANGED(SIM3D), CONTRACT §35.1).
//
// Trig in core/sim goes ONLY through this module: browser libm results (Math.sin / cos / atan2 / sqrt / hypot) differ
// between engines and would desync rollback netplay. Everything here is integer math on JS numbers holding integers
// (exact while |value| < 2^53: +, -, * and a floor / trunc of a / b are exact for integer operands below 2^53).
//
// Conventions (CONTRACT §35.1):
//   * yaw = integer in [0, 65536) (65536 = 360 deg). yaw 0 faces +Z; positive yaw turns toward +X (three.js rotation.y of
//     a model facing +Z at rest). dir(yaw) = (x = sin yaw, z = cos yaw).
//   * Q14 = fixed point with 16384 = 1.0 (unit direction vectors, sines).
//   * Positions / lengths are sim units U (10 um, units.ts M = 100000 U per metre).
//
// SAFE RANGES (all callers stay inside them; probe_3d checks the extremes):
//   * positions / offsets |v| <= 2^25 U (335 m; the ring is <= 6 m = 600000 U) -> dot / cross of two offsets < 2^51;
//   * dotQ / crossQ of an offset (<= 2^30 U) with a Q14 vector (<= 2^14) < 2^45;
//   * isqrt(n) exact for 0 <= n < 2^53 (squared offsets up to 2^50 are fine);
//   * mulQ(a, q) exact for |a| <= 2^38.
//
// The sine table is built at load from a fixed-order Taylor polynomial evaluated in IEEE doubles (only +, -, *, / with
// fixed operand order = bit-identical on every engine), then rounded to Q14. probe_3d pins its hash.

export const Q = 16384;
export const Q_SHIFT = 14;
export const YAW_TURN = 65536;
export const YAW_HALF = 32768;
export const YAW_QUARTER = 16384;
/** quarter-wave table resolution: 4096 steps over 90 deg (4 yaw units per entry, linear interpolation between) */
export const SIN_STEPS = 4096;

const HALF_PI = 1.5707963267948966; // IEEE double of pi / 2 (a literal: identical everywhere)

/** sin(x) for x in [0, pi/2] by a Taylor polynomial (degree 21, Horner, fixed order). Error < 1e-15 on that range. */
function taylorSin(x: number): number {
  const x2 = x * x;
  // x - x^3/3! + x^5/5! - ... + x^21/21!, Horner from the highest term
  let t = 1 / 51090942171709440000; // 1/21!
  t = 1 / 121645100408832000 - x2 * t; // 1/19!
  t = 1 / 355687428096000 - x2 * t; // 1/17!
  t = 1 / 1307674368000 - x2 * t; // 1/15!
  t = 1 / 6227020800 - x2 * t; // 1/13!
  t = 1 / 39916800 - x2 * t; // 1/11!
  t = 1 / 362880 - x2 * t; // 1/9!
  t = 1 / 5040 - x2 * t; // 1/7!
  t = 1 / 120 - x2 * t; // 1/5!
  t = 1 / 6 - x2 * t; // 1/3!
  t = 1 - x2 * t;
  return x * t;
}

/** SIN_Q[k] = round(sin(k * 90deg / 4096) * 16384), k = 0..4096 (quarter wave, exact 0 and 16384 at the ends). */
export const SIN_Q: Int32Array = (() => {
  const t = new Int32Array(SIN_STEPS + 1);
  for (let k = 0; k <= SIN_STEPS; k++) {
    const x = (k * HALF_PI) / SIN_STEPS;
    t[k] = Math.round(taylorSin(x) * Q);
  }
  t[0] = 0;
  t[SIN_STEPS] = Q;
  return t;
})();

/** sin over one quadrant position r in [0, 16384] (yaw units), Q14, linear between table entries. */
function sinQuad(r: number): number {
  const i = r >> 2;
  const f = r & 3;
  if (f === 0) return SIN_Q[i];
  const a = SIN_Q[i];
  return a + (((SIN_Q[i + 1] - a) * f) >> 2);
}

/** Normalises any integer yaw into [0, 65536). */
export function wrapYaw(yaw: number): number {
  return ((yaw % YAW_TURN) + YAW_TURN) % YAW_TURN;
}

/** sin(yaw) in Q14 (yaw any integer). */
export function sinQ(yaw: number): number {
  const y = ((yaw % YAW_TURN) + YAW_TURN) % YAW_TURN;
  const q = y >> 14;
  const r = y & 16383;
  switch (q) {
    case 0:
      return sinQuad(r);
    case 1:
      return sinQuad(YAW_QUARTER - r);
    case 2:
      return 0 - sinQuad(r); // 0 - x, never -0
    default:
      return 0 - sinQuad(YAW_QUARTER - r);
  }
}

/** cos(yaw) in Q14. */
export function cosQ(yaw: number): number {
  return sinQ(yaw + YAW_QUARTER);
}

/** dir(yaw) = (sin yaw, cos yaw) in Q14 -> out[o], out[o + 1] (x, z). */
export function yawToDir(yaw: number, out: Int32Array | number[], o = 0): void {
  out[o] = sinQ(yaw);
  out[o + 1] = cosQ(yaw);
}

/** x component (Q14) of dir(yaw). */
export function dirX(yaw: number): number {
  return sinQ(yaw);
}
/** z component (Q14) of dir(yaw). */
export function dirZ(yaw: number): number {
  return cosQ(yaw);
}

/** angle a in [0, 8192] (yaw units) with tan(a) = n / d, 0 <= n <= d, d > 0 (binary search on the table). */
function atanOct(n: number, d: number): number {
  let lo = 0;
  let hi = 8192;
  // largest a with sin(a) * d <= n * cos(a)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sinQuad(mid) * d <= n * sinQuad(YAW_QUARTER - mid)) lo = mid;
    else hi = mid - 1;
  }
  if (lo < 8192) {
    // pick the nearer of lo / lo + 1 (compare the cross residues)
    const e0 = n * sinQuad(YAW_QUARTER - lo) - sinQuad(lo) * d; // >= 0
    const e1 = sinQuad(lo + 1) * d - n * sinQuad(YAW_QUARTER - lo - 1); // > 0
    if (e1 < e0) return lo + 1;
  }
  return lo;
}

/**
 * Integer atan2 in the yaw convention: the yaw whose dir(yaw) points along (dx, dz). (0, 0) -> 0. |dx|, |dz| <= 2^36.
 */
export function dirToYaw(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  const ax = dx < 0 ? -dx : dx;
  const az = dz < 0 ? -dz : dz;
  // a = angle from +Z toward +X inside the first quadrant
  const a = ax <= az ? atanOct(ax, az) : YAW_QUARTER - atanOct(az, ax);
  let y: number;
  if (dx >= 0) y = dz >= 0 ? a : YAW_HALF - a;
  else y = dz < 0 ? YAW_HALF + a : YAW_TURN - a;
  return y & (YAW_TURN - 1);
}

/** Shortest signed turn from yaw a to yaw b, in (-32768, 32768]. */
export function yawDelta(a: number, b: number): number {
  let d = (b - a) & (YAW_TURN - 1);
  if (d > YAW_HALF) d -= YAW_TURN;
  return d;
}

/** Turns `yaw` toward `target` by at most `maxStep` (> 0) yaw units; returns the new yaw in [0, 65536). */
export function turnToward(yaw: number, target: number, maxStep: number): number {
  const d = yawDelta(yaw, target);
  if (d <= maxStep && d >= -maxStep) return target & (YAW_TURN - 1);
  return (yaw + (d > 0 ? maxStep : -maxStep)) & (YAW_TURN - 1);
}

/** Integer floor(sqrt(n)) for 0 <= n < 2^53 (Newton from above; exact). */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  if (n < 4) return 1;
  let bits: number;
  if (n >= 4294967296) bits = 64 - Math.clz32(Math.floor(n / 4294967296));
  else bits = 32 - Math.clz32(n >>> 0);
  const half = (bits + 1) >> 1;
  let x = 1;
  for (let k = 0; k < half; k++) x *= 2; // 2^ceil(bits/2) >= sqrt(n)
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2);
    if (y >= x) return x;
    x = y;
  }
}

/** Round-half-away-from-zero of a / b for integers, b > 0 (exact while |2a| < 2^53). */
export function divRound(a: number, b: number): number {
  if (a >= 0) return Math.floor((2 * a + b) / (2 * b));
  return -Math.floor((-2 * a + b) / (2 * b));
}

/** round(a * q / 16384): scale an integer length by a Q14 factor (|a| <= 2^38). */
export function mulQ(a: number, q: number): number {
  const p = a * q;
  if (p >= 0) return Math.floor((p + 8192) / Q);
  return -Math.floor((-p + 8192) / Q);
}

/**
 * CHANGED(SIM3D): `amount` U along yaw with the Q14 direction's own length divided out (|dir(yaw)| is 16384 +- ~1.5 from the
 * table rounding: plain mulQ would walk up to 0.01 % short / long off the axes) -> out[o], out[o + 1] (x, z), rounded.
 * |amount| <= 2^24.
 */
export function alongYaw(amount: number, yaw: number, out: Int32Array | number[], o = 0): void {
  const sx = sinQ(yaw);
  const cz = cosQ(yaw);
  if (sx === 0 || cz === 0) {
    // on an axis the table is exact (0 / +-16384)
    out[o] = mulQ(amount, sx);
    out[o + 1] = mulQ(amount, cz);
    return;
  }
  const lenQ10 = isqrt((sx * sx + cz * cz) * 1048576); // |dir| x 1024
  out[o] = divRound(amount * sx * 1024, lenQ10);
  out[o + 1] = divRound(amount * cz * 1024, lenQ10);
}

/** Length of (x, z) in the same units (floor). */
export function len2(x: number, z: number): number {
  return isqrt(x * x + z * z);
}

/** Plain dot of two integer vectors (ranges: see header). */
export function dot2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz;
}

/** Plain 2D cross (a.x * b.z - a.z * b.x). Positive = b is clockwise of a seen from +Y (toward +X from +Z). */
export function cross2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/** Projection of offset (x, z) (U) on a Q14 unit vector (ux, uz), in U (rounded). */
export function dotQ(x: number, z: number, ux: number, uz: number): number {
  return divRound(x * ux + z * uz, Q);
}

/**
 * Unit vector of (x, z) in Q14 -> out[o], out[o + 1]; returns the length (U). A zero vector gives (fallbackX, fallbackZ).
 */
export function normQ(x: number, z: number, out: Int32Array | number[], o = 0, fbx = 0, fbz = Q): number {
  const l = isqrt(x * x + z * z);
  if (l === 0) {
    out[o] = fbx;
    out[o + 1] = fbz;
    return 0;
  }
  out[o] = divRound(x * Q, l);
  out[o + 1] = divRound(z * Q, l);
  return l;
}

/** Rotates (x, z) by yaw (yaw convention: +yaw turns +Z toward +X) -> out[o], out[o + 1] (same units, rounded). */
export function rot(x: number, z: number, yaw: number, out: Int32Array | number[], o = 0): void {
  const c = cosQ(yaw);
  const s = sinQ(yaw);
  out[o] = divRound(x * c + z * s, Q);
  out[o + 1] = divRound(z * c - x * s, Q);
}

/** The fighter-local right vector of a facing dir (fx, fz): right = forward x up = (-fz, fx). */
export function rightOf(fx: number, fz: number, out: Int32Array | number[], o = 0): void {
  out[o] = -fz;
  out[o + 1] = fx;
}

/** Degrees (yaw convention, data compile only) -> yaw units. */
export function degToYaw(deg: number): number {
  return wrapYaw(Math.round((deg * YAW_TURN) / 360));
}

/** Yaw units -> radians (view / snapshots only; never used by the step). */
export function yawToRad(yaw: number): number {
  return (wrapYaw(yaw) * 2 * Math.PI) / YAW_TURN;
}

/** Yaw units -> degrees in [0, 360) (view / events only). */
export function yawToDeg(yaw: number): number {
  return (wrapYaw(yaw) * 360) / YAW_TURN;
}

/** uint32 hash of the sine table (probe_3d pins it: every engine must build the same table). */
export function sinTableHash(): number {
  let h = 0x811c9dc5 | 0;
  for (let k = 0; k <= SIN_STEPS; k++) {
    h = Math.imul(h ^ SIN_Q[k], 0x01000193);
  }
  return h >>> 0;
}
