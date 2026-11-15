// SCRATCH PROTOTYPE (netcode lane): deterministic transcendentals built ONLY from IEEE-754 exact ops
// (+ - * / Math.sqrt, integer bit ops, Math.floor/trunc/abs). Same inputs -> same bits in every JS engine.
// Kernels follow the fdlibm polynomial shapes (accuracy ~1e-15 rel. on the reduced range; huge args
// lose accuracy but stay deterministic). NOT production code: a prototype to prove the lockstep path.

const F = new Float64Array(1), U = new Uint32Array(F.buffer);   // little-endian: U[1] = high word
function pow2i(k: number): number {                                  // exact 2^k for -1022..1023
  F[0] = 0; U[1] = ((k + 1023) & 0x7ff) << 20; U[0] = 0; return F[0];
}

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
// Cody-Waite reduction: x = n*pi/2 + (y0 + y1)
const RED = { n: 0, y0: 0, y1: 0 };
function reduce(x: number): void {
  const n = Math.floor(x * INVPIO2 + 0.5);
  let r = x - n * PIO2_1; let w = n * PIO2_1T;
  let y0 = r - w;
  const t = r; w = n * PIO2_2; r = t - w; w = n * PIO2_2T - ((t - r) - w); y0 = r - w;
  RED.n = n; RED.y0 = y0; RED.y1 = (r - y0) - w;
}
export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return ksin(x, 0);
  reduce(x); const q = ((RED.n % 4) + 4) % 4;
  return q === 0 ? ksin(RED.y0, RED.y1) : q === 1 ? kcos(RED.y0, RED.y1) : q === 2 ? -ksin(RED.y0, RED.y1) : -kcos(RED.y0, RED.y1);
}
export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kcos(x, 0);
  reduce(x); const q = ((RED.n % 4) + 4) % 4;
  return q === 0 ? kcos(RED.y0, RED.y1) : q === 1 ? -ksin(RED.y0, RED.y1) : q === 2 ? -kcos(RED.y0, RED.y1) : ksin(RED.y0, RED.y1);
}
export function dtan(x: number): number { return dsin(x) / dcos(x); }

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function datan(x0: number): number {
  if (x0 !== x0) return NaN;
  const neg = x0 < 0; let x = Math.abs(x0); let id = -1;
  if (x > 1e17) return neg ? -ATANHI[3] : ATANHI[3];
  if (x >= 0.4375) {
    if (x < 1.1875) { if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); } }
    else { if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; } }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  let r: number;
  if (id < 0) r = x - x * (s1 + s2);
  else r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return neg ? -r : r;
}
const PI = 3.141592653589793, PIO2 = 1.5707963267948966;
export function datan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 0 && y === 0) return (1 / x < 0) ? (1 / y < 0 ? -PI : PI) : (1 / y < 0 ? -0 : 0);
  if (x === 0) return y > 0 ? PIO2 : -PIO2;
  const a = datan(Math.abs(y / x));
  if (x > 0) return y >= 0 ? a : -a;
  return y >= 0 ? PI - a : -(PI - a);
}
export function dasin(x: number): number { return datan2(x, Math.sqrt(1 - x * x)); }
export function dacos(x: number): number { return datan2(Math.sqrt(1 - x * x), x); }

const LN2HI = 6.93147180369123816490e-01, LN2LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
export function dexp(x: number): number {
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
export function dlog(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k -= 54; }   // subnormal: scale by 2^54
  F[0] = x; let hx = U[1];
  k += (hx >>> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  U[1] = hx | (i ^ 0x3ff00000);               // normalize m to [sqrt2/2, sqrt2)
  k += i >>> 20;
  const f = F[0] - 1;
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (3.999999999940941908e-01 + w * (2.222219843214978396e-01 + w * 1.531383769920937332e-01));
  const t2 = z * (6.666666666666735130e-01 + w * (2.857142874366239149e-01 + w * (1.818357216161805012e-01 + w * 1.479819860511658591e-01)));
  const R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2HI - ((hfsq - (s * (hfsq + R) + k * LN2LO)) - f);
}
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === 0.5 && x >= 0) return Math.sqrt(x);
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (Math.floor(y) !== y) return NaN;
    const m = dexp(y * dlog(-x));
    return (Math.abs(y) % 2 === 1) ? -m : m;
  }
  if (Number.isInteger(y) && Math.abs(y) <= 64) {         // exact-ish repeated squaring (deterministic)
    let b = y < 0 ? 1 / x : x, e = Math.abs(y), r = 1;
    while (e > 0) { if (e & 1) r *= b; b *= b; e >>>= 1; }
    return r;
  }
  return dexp(y * dlog(x));
}
export function dhypot(...a: number[]): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}
export function dcbrt(x: number): number { return x < 0 ? -dpow(-x, 1 / 3) : dpow(x, 1 / 3); }
export function dtanh(x: number): number { const e = dexp(2 * x); return (e - 1) / (e + 1); }
export function dexpm1(x: number): number { return dexp(x) - 1; }
export function dlog2(x: number): number { return dlog(x) / 0.6931471805599453; }
export function dlog10(x: number): number { return dlog(x) / 2.302585092994046; }
export function dlog1p(x: number): number { return dlog(1 + x); }

/** PROTOTYPE ONLY: replace the engine's Math transcendentals for this page/process. */
export function installDetMath(): void {
  const M = Math as any;
  M.sin = dsin; M.cos = dcos; M.tan = dtan; M.atan = datan; M.atan2 = datan2; M.asin = dasin; M.acos = dacos;
  M.exp = dexp; M.log = dlog; M.pow = dpow; M.hypot = dhypot; M.cbrt = dcbrt; M.tanh = dtanh; M.expm1 = dexpm1;
  M.log2 = dlog2; M.log10 = dlog10; M.log1p = dlog1p;
}
