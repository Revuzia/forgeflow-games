// Deterministic transcendentals for the sim (ONLINE_PLAN B-0 / netcode.md §6.4; port of the netcode lab
// prototype _spec/online/netcode_lab/detmath.ts).
//
// Why: the ECMAScript spec lets every engine approximate Math.sin / cos / tan / atan2 / exp / log / pow /
// hypot / asin ... (and the `**` operator) its own way. Chromium, Firefox and WebKit return different last bits
// than Node for several of them (measured, netcode.md §6.4), and a one-ulp difference grows into visible
// gameplay divergence within about a minute. Online VS runs the whole sim on every peer (lockstep), so every
// peer must compute the same bits.
//
// How: every function here is built ONLY from operations IEEE-754 defines exactly (+ - * /, Math.sqrt,
// Math.floor / abs, integer bit ops, Float64Array bit views). Same inputs -> same bits in every JS engine, on
// every CPU. Kernels follow the fdlibm polynomial shapes: max relative error against V8 <= 3.3e-16 for sin,
// cos, tan, atan2, asin, log, exp, hypot and ~1.6e-15 for pow (netcode_lab/detmath_acc.ts). Huge arguments
// lose accuracy but stay deterministic.
//
// Rule (enforced by _harness/detban.ts in `npm run check`): sim modules (everything createWorld / stepWorld /
// the draft path reach) and the harness bots import these instead of the Math built-ins. Math.sqrt, abs,
// floor, ceil, round, trunc, sign, min, max, imul, fround and % are exact and stay as they are. Views
// (three.js, render/, ui/, audio/) do not need this and keep native Math. Do NOT monkey-patch the global Math.
//
// THREE-free, DOM-free, allocation-free.

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
/** index of the high 32-bit word of a float64 in the Uint32 view (1 on little-endian, 0 on big-endian) */
const HI = (() => { F[0] = 1; return U[1] === 0x3ff00000 ? 1 : 0; })();
const LO = 1 - HI;

/** exact 2^k for -1022..1023 */
function pow2i(k: number): number {
  U[HI] = ((k + 1023) & 0x7ff) << 20; U[LO] = 0; return F[0];
}

export const PI = 3.141592653589793;
const PIO2 = 1.5707963267948966;
const PIO4 = 0.7853981633974483;

const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21;
const INVPIO2 = 6.36619772367581382433e-01;

function ksin(x: number, y: number): number {
  const z = x * x, v = z * x;
  const r = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)));
  return x - ((z * (0.5 * y - v * r) - y) - v * -1.66666666666666324348e-01);
}
function kcos(x: number, y: number): number {
  const z = x * x;
  const r = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 + z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + (z * r - x * y));
}
// Cody-Waite reduction: x = n * pi/2 + (y0 + y1)
let redN = 0, redY0 = 0, redY1 = 0;
function reduce(x: number): void {
  const n = Math.floor(x * INVPIO2 + 0.5);
  let r = x - n * PIO2_1; let w = n * PIO2_1T;
  let y0 = r - w;
  const t = r; w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w); y0 = r - w;
  redN = n; redY0 = y0; redY1 = (r - y0) - w;
}

/** deterministic Math.sin */
export function sin(x: number): number {
  if (x - x !== 0) return NaN;                         // NaN or ±Infinity
  if (Math.abs(x) <= PIO4) return ksin(x, 0);
  reduce(x); const q = ((redN % 4) + 4) % 4;
  return q === 0 ? ksin(redY0, redY1) : q === 1 ? kcos(redY0, redY1) : q === 2 ? -ksin(redY0, redY1) : -kcos(redY0, redY1);
}
/** deterministic Math.cos */
export function cos(x: number): number {
  if (x - x !== 0) return NaN;
  if (Math.abs(x) <= PIO4) return kcos(x, 0);
  reduce(x); const q = ((redN % 4) + 4) % 4;
  return q === 0 ? kcos(redY0, redY1) : q === 1 ? -ksin(redY0, redY1) : q === 2 ? -kcos(redY0, redY1) : ksin(redY0, redY1);
}
/** deterministic Math.tan */
export function tan(x: number): number { return sin(x) / cos(x); }

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-01, AT1 = -1.99999999998764832476e-01, AT2 = 1.42857142725034663711e-01,
  AT3 = -1.11111104054623557880e-01, AT4 = 9.09088713343650656196e-02, AT5 = -7.69187620504482999495e-02,
  AT6 = 6.66107313738753120669e-02, AT7 = -5.83357013379057348645e-02, AT8 = 4.97687799461593236017e-02,
  AT9 = -3.65315727442169155270e-02, AT10 = 1.62858201153657823623e-02;

/** deterministic Math.atan */
export function atan(x0: number): number {
  if (x0 !== x0) return NaN;
  const neg = x0 < 0; let x = Math.abs(x0); let id = -1;
  if (x > 1e17) return neg ? -ATANHI[3] : ATANHI[3];
  if (x >= 0.4375) {
    if (x < 1.1875) { if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); } }
    else { if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; } }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  let r: number;
  if (id < 0) r = x - x * (s1 + s2);
  else r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return neg ? -r : r;
}
/** deterministic Math.atan2 */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 0 && y === 0) return (1 / x < 0) ? (1 / y < 0 ? -PI : PI) : (1 / y < 0 ? -0 : 0);
  if (x === 0) return y > 0 ? PIO2 : -PIO2;
  const a = atan(Math.abs(y / x));
  if (x > 0) return y >= 0 ? a : -a;
  return y >= 0 ? PI - a : -(PI - a);
}
/** deterministic Math.asin */
export function asin(x: number): number { return atan2(x, Math.sqrt(1 - x * x)); }
/** deterministic Math.acos */
export function acos(x: number): number { return atan2(Math.sqrt(1 - x * x), x); }

const LN2HI = 6.93147180369123816490e-01, LN2LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
/** deterministic Math.exp */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.13) return 0;
  const k = Math.floor(x * INVLN2 + 0.5);
  const hi = x - k * LN2HI, lo = k * LN2LO, r = hi - lo;
  const t = r * r;
  const c = r - t * (1.66666666666666019037e-01 + t * (-2.77777777770155933842e-03 + t * (6.61375632143793436117e-05 + t * (-1.65339022054652515390e-06 + t * 4.13813679705723846039e-08))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  if (k >= -1021 && k <= 1023) return y * pow2i(k);
  return k > 0 ? y * pow2i(1023) * pow2i(k - 1023) : y * pow2i(-1021) * pow2i(k + 1021);
}
/** deterministic Math.log */
export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k -= 54; }   // subnormal: scale by 2^54
  F[0] = x; let hx = U[HI];
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  U[HI] = hx | (i ^ 0x3ff00000);               // normalize m to [sqrt2/2, sqrt2)
  k += i >>> 20;
  const f = F[0] - 1;
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (3.999999999940941908e-01 + w * (2.222219843214978396e-01 + w * 1.531383769920937332e-01));
  const t2 = z * (6.666666666666735130e-01 + w * (2.857142874366239149e-01 + w * (1.818357216161805012e-01 + w * 1.479819860511658591e-01)));
  const R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2HI - ((hfsq - (s * (hfsq + R) + k * LN2LO)) - f);
}
/** deterministic Math.pow (and the `**` operator, which the sim must not use) */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === 0.5 && x >= 0) return Math.sqrt(x);
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (Math.floor(y) !== y) return NaN;
    const m = exp(y * log(-x));
    return (Math.abs(y) % 2 === 1) ? -m : m;
  }
  if (Math.floor(y) === y && Math.abs(y) <= 64) {         // repeated squaring: exact-ish and deterministic
    let b = y < 0 ? 1 / x : x, e = Math.abs(y), r = 1;
    while (e > 0) { if (e & 1) r *= b; b *= b; e >>>= 1; }
    return r;
  }
  return exp(y * log(x));
}
/** deterministic 2-argument Math.hypot (no overflow guard: sim magnitudes are far below 1e150) */
export function hypot(a: number, b: number): number { return Math.sqrt(a * a + b * b); }
