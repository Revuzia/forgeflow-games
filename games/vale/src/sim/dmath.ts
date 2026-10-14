// VALE sim — deterministic math. IEEE 754 makes + − × ÷ and sqrt exact-rounded on every engine, but
// Math.sin / cos / atan2 / asin / acos / hypot are implementation-defined (V8, JavaScriptCore and
// SpiderMonkey can differ in the last bits). Online play runs the same sim on every client in lockstep
// (CONTRACT §7), so the sim uses these instead: range reduction + fixed polynomials built from the exact
// operations only, accurate to ~1e-15 on the reduced range — the same bits everywhere.

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const QUARTER_PI = 0.7853981633974483;
const TWO_PI = 6.283185307179586;

/** sin on [-π/4, π/4] (Taylor to x^15: error < 1e-16 there) */
function sinK(x: number): number {
  const z = x * x;
  return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z * (1 / 6227020800 + z * (-1 / 1307674368000))))))));
}
/** cos on [-π/4, π/4] */
function cosK(x: number): number {
  const z = x * x;
  return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 + z * (1 / 479001600 + z * (-1 / 87178291200 + z * (1 / 20922789888000))))))));
}

/** reduce x to r in [-π/4, π/4] and a quadrant q: x = q·π/2 + r */
function reduce(x: number): [number, number] {
  let y = x - TWO_PI * Math.floor(x / TWO_PI + 0.5);          // [-π, π]
  const q = Math.round(y / HALF_PI);                           // -2..2
  y -= q * HALF_PI;
  return [y, ((q % 4) + 4) % 4];
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? sinK(r) : q === 1 ? cosK(r) : q === 2 ? -sinK(r) : -cosK(r);
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? cosK(r) : q === 1 ? -sinK(r) : q === 2 ? -cosK(r) : sinK(r);
}

/** atan on [0, tan(π/12)] by series, wider ranges by the identities atan(x) = π/6 + atan((x√3-1)/(x+√3)) and π/2 - atan(1/x) */
function atanK(x: number): number {
  // |x| <= 0.2679 (tan 15°): the series converges fast (x^2 <= 0.0718)
  const z = x * x;
  let s = 0, t = x, n = 1;
  for (let i = 0; i < 14; i++) { s += t / n; t *= -z; n += 2; }
  return s;
}
const SQRT3 = 1.7320508075688772;
const TAN15 = 0.2679491924311227;
export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  let off = 0, inv = false;
  if (a > 1) { a = 1 / a; inv = true; }
  if (a > TAN15) { a = (a * SQRT3 - 1) / (a + SQRT3); off = PI / 6; }
  let r = off + atanK(a);
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : (Object.is(x, -0) ? (Object.is(y, -0) ? -PI : PI) : y);
  const a = datan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

export function dasin(x: number): number {
  if (x >= 1) return HALF_PI;
  if (x <= -1) return -HALF_PI;
  return datan2(x, Math.sqrt((1 - x) * (1 + x)));
}

export function dacos(x: number): number { return HALF_PI - dasin(x); }

/** x² as one exact multiply (`x ** 2` is pow(), implementation-approximated) */
export function sq(x: number): number { return x * x; }

/** √(a² + b²) from the exact operations (no Math.hypot) */
export function dhypot(a: number, b: number, c = 0): number { return Math.sqrt(a * a + b * b + c * c); }

export const DPI = PI;
export const DQUARTER_PI = QUARTER_PI;
