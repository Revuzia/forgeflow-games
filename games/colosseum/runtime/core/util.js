// Colosseum — shared math / small helpers.
// Kept dependency-free so selftest.mjs can import it headlessly under node.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Frame-rate independent exponential approach. `rate` = fraction closed per second. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Shortest signed angular difference b-a, wrapped to [-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Angular approach that respects wrap-around. */
export function dampAngle(a, b, rate, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-rate * dt));
}

// ---------------------------------------------------------------------------
// Deterministic RNG — mulberry32. Every procedural system in the game seeds
// from a match seed so a given match looks identical on replay AND on a remote
// client (this is the multiplayer seam: same seed => same world).
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String -> uint32 hash, so slugs/names can seed deterministic generators. */
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Ellipse helpers. The arena floor is a true ellipse (a=43.5m, b=27.5m), so
// containment and edge-projection show up everywhere: movement clamping, spawn
// placement, crowd seating, gate positions.
// ---------------------------------------------------------------------------

/** Normalized ellipse radius at (x,z): <1 inside, 1 on the rim, >1 outside. */
export const ellipseNorm = (x, z, a, b) => Math.sqrt((x * x) / (a * a) + (z * z) / (b * b));

/** Push a point back onto/inside an ellipse of semi-axes a,b (with margin). */
export function clampToEllipse(x, z, a, b, margin = 0) {
  const ea = Math.max(0.001, a - margin);
  const eb = Math.max(0.001, b - margin);
  const n = ellipseNorm(x, z, ea, eb);
  if (n <= 1) return { x, z, hit: false };
  return { x: x / n, z: z / n, hit: true };
}

/**
 * Outward unit normal of the ellipse at the point nearest (x,z).
 * Gradient of (x/a)^2+(z/b)^2 is (2x/a^2, 2z/b^2) — normalize that.
 */
export function ellipseNormal(x, z, a, b) {
  let nx = x / (a * a);
  let nz = z / (b * b);
  const l = Math.hypot(nx, nz) || 1;
  return { x: nx / l, z: nz / l };
}

/**
 * Ramanujan's approximation of ellipse perimeter — used to distribute seats and
 * arcade arches at even arc-length rather than even angle (even-angle spacing
 * bunches badly at the ends of a 1.6:1 ellipse and reads as a mistake).
 */
export function ellipsePerimeter(a, b) {
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * N points spaced by (approximately) equal arc length around an ellipse.
 * Walks a fine angular table accumulating chord length, then resamples.
 * Returns [{x, z, theta, nx, nz}] with nx/nz the outward normal.
 */
export function ellipseArcPoints(a, b, count, phase = 0) {
  const STEPS = Math.max(512, count * 8);
  const cum = new Float64Array(STEPS + 1);
  let px = a * Math.cos(phase);
  let pz = b * Math.sin(phase);
  for (let i = 1; i <= STEPS; i++) {
    const t = phase + (i / STEPS) * TAU;
    const x = a * Math.cos(t);
    const z = b * Math.sin(t);
    cum[i] = cum[i - 1] + Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  const total = cum[STEPS];
  const out = [];
  let cursor = 1;
  for (let n = 0; n < count; n++) {
    const target = (n / count) * total;
    while (cursor < STEPS && cum[cursor] < target) cursor++;
    const t0 = cum[cursor - 1];
    const t1 = cum[cursor];
    const f = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
    const theta = phase + ((cursor - 1 + f) / STEPS) * TAU;
    const x = a * Math.cos(theta);
    const z = b * Math.sin(theta);
    const nrm = ellipseNormal(x, z, a, b);
    out.push({ x, z, theta, nx: nrm.x, nz: nrm.z });
  }
  return out;
}
