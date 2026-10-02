// WOBBLEHOARD rest-shape language: ONE evaluator for every species.
//
// A rest shape is a star-convex surface r(u) around the body centre, for a unit direction u. A species is a RECIPE (data):
//
//   r(u) = ellipsoidRadius(u; rx, ry, rz) * (1 + sum_i sign_i * amp_i * g_i(u) + swirl(u))        clamped to [R_MIN, R_MAX]
//
// where each feature g_i is a smooth Gaussian on the sphere (a 'bump' adds, a 'dent' subtracts, a 'ridge' is a bump stretched
// along a great-circle arc: a crest, a fin, a belt) and mirrorX duplicates a feature across the x = 0 plane (ears, horns, cheeks).
// The radius is in units of the genome-scaled rest radius (physics: R0 = 0.5 * lerp(0.8, 1.25, size)), so r = 1 is a sphere.
//
// Used by the physics lane (rest positions = u * r(u) * R0), the render lane (silhouette checks) and the catalog probe.
// Pure TypeScript: no three, no DOM, no Math.random, no Date. evalShape allocates nothing (hot path: ~640 calls per body build).
//
// Falloff of a feature is the CHORDAL Gaussian  g = exp(-|u - d|^2 / w^2) = exp(-2 (1 - u.d) / w^2)  (|u - d|^2 = 2 - 2 u.d),
// which is exp(-theta^2 / w^2) for small angles theta and needs no acos. `width` w is the angle (radians) at which g = 1/e.
// Resolution rule: a 642-vertex sim mesh has ~0.14 rad vertex spacing, so every width must be >= SHAPE_MIN_WIDTH (0.35 rad).

export type Vec3 = readonly [number, number, number];
export type FeatureKind = 'bump' | 'dent' | 'ridge';

export interface ShapeFeature {
  /** Unit direction of the feature centre (the helpers below normalise; evalShape assumes |dir| = 1). */
  dir: Vec3;
  /** Strength as a fraction of the base radius, always > 0: 'bump' and 'ridge' add amp, 'dent' subtracts amp. */
  amp: number;
  /** Angular width in radians (g = 1/e at that angle). >= SHAPE_MIN_WIDTH. For a 'ridge' this is the width ACROSS the spine. */
  width: number;
  kind: FeatureKind;
  /** Also place a mirror copy of the feature at (-x, y, z). Needs |dir.x| >= 0.25 or the two copies would pile up. */
  mirrorX?: boolean;
  /** 'ridge' only: unit normal of the great circle the ridge follows (perpendicular to dir). Built by `ridge()`. */
  n?: Vec3;
  /** 'ridge' only: length scale along the spine in radians (>= width). */
  len?: number;
}

/** A spiral piping ridge on the flanks (what makes DOLLOP's swirl): amp * sin(lobes * phi + twist * theta) * window(theta). theta = angle from +Y. */
export interface ShapeSwirl {
  amp: number;
  lobes: number;
  twist: number;
  /** theta window [a0, a1] over which the swirl fades in (smoothstep). */
  fadeIn: readonly [number, number];
  /** theta window [b0, b1] over which it fades out again. */
  fadeOut: readonly [number, number];
}

export interface ShapeRecipe {
  /** Base ellipsoid semi-axes [rx, ry, rz] (x = left/right, y = up, z = front toward the camera, where the eyes are). */
  radii: Vec3;
  features: readonly ShapeFeature[];
  swirl?: ShapeSwirl;
}

/** Hard limits of the surface radius (units of R0). evalShape clamps to them; the catalog probe requires recipes to stay clear of them. */
export const SHAPE_R_MIN = 0.35;
export const SHAPE_R_MAX = 1.9;
/** Narrowest allowed feature, radians (a 642-vertex mesh resolves ~2.5 vertices across this). */
export const SHAPE_MIN_WIDTH = 0.35;

/* ───────────────────────────────────────── helpers that build recipes ───────────────────────────────────────── */

const norm3 = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/** Raised lump at `dir` (any non-zero vector; it is normalised). */
export const bump = (dir: Vec3, amp: number, width: number, mirrorX = false): ShapeFeature =>
  ({ dir: norm3(dir[0], dir[1], dir[2]), amp, width, kind: 'bump', ...(mirrorX ? { mirrorX: true } : {}) });

/** Dimple at `dir`. */
export const dent = (dir: Vec3, amp: number, width: number, mirrorX = false): ShapeFeature =>
  ({ dir: norm3(dir[0], dir[1], dir[2]), amp, width, kind: 'dent', ...(mirrorX ? { mirrorX: true } : {}) });

/**
 * A bump stretched along an arc: centred on `dir`, running along the great circle that contains `dir` and `along` (a direction the
 * spine heads toward). `width` is the thickness across it, `len` how far it runs along it (radians).
 * Example: a crest from nose to tail over the top = ridge([0, 1, 0], [0, 0, 1], 0.3, 0.5, 1.1).
 */
export const ridge = (dir: Vec3, along: Vec3, amp: number, width: number, len: number, mirrorX = false): ShapeFeature => {
  const d = norm3(dir[0], dir[1], dir[2]);
  const cx = d[1] * along[2] - d[2] * along[1], cy = d[2] * along[0] - d[0] * along[2], cz = d[0] * along[1] - d[1] * along[0];
  return { dir: d, amp, width, kind: 'ridge', len, n: norm3(cx, cy, cz), ...(mirrorX ? { mirrorX: true } : {}) };
};

export const shape = (radii: Vec3, features: readonly ShapeFeature[], swirl?: ShapeSwirl): ShapeRecipe =>
  (swirl ? { radii, features, swirl } : { radii, features });

/* ───────────────────────────────────────────── the evaluator ───────────────────────────────────────────── */

const SW = (e0: number, e1: number, x: number): number => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};

/** Gaussian weight of one feature at direction (ux, uy, uz). */
function featureWeight(f: ShapeFeature, ux: number, uy: number, uz: number): number {
  const d = f.dir;
  const dot = ux * d[0] + uy * d[1] + uz * d[2];
  const w2 = f.width * f.width;
  if (f.kind === 'ridge') {
    const n = f.n as Vec3, len = f.len as number;
    const across = ux * n[0] + uy * n[1] + uz * n[2];
    return Math.exp(-(across * across) / w2 - (2 - 2 * dot) / (len * len));
  }
  return Math.exp(-(2 - 2 * dot) / w2);
}

/**
 * Surface radius (units of the genome-scaled rest radius) along the UNIT direction (ux, uy, uz). Pure, allocation-free, clamped to
 * [SHAPE_R_MIN, SHAPE_R_MAX]. Position of the surface point = u * evalShape(...) * R0.
 */
export function evalShape(recipe: ShapeRecipe, ux: number, uy: number, uz: number): number {
  const rd = recipe.radii;
  const ex = ux / rd[0], ey = uy / rd[1], ez = uz / rd[2];
  let k = 1;
  const fs = recipe.features;
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    let g = featureWeight(f, ux, uy, uz);
    if (f.mirrorX) g += featureWeight(f, -ux, uy, uz);
    k += f.kind === 'dent' ? -f.amp * g : f.amp * g;
  }
  const sw = recipe.swirl;
  if (sw !== undefined) {
    const theta = Math.acos(uy < -1 ? -1 : uy > 1 ? 1 : uy);
    k += sw.amp * Math.sin(sw.lobes * Math.atan2(uz, ux) + sw.twist * theta)
      * SW(sw.fadeIn[0], sw.fadeIn[1], theta) * (1 - SW(sw.fadeOut[0], sw.fadeOut[1], theta));
  }
  const r = k / Math.sqrt(ex * ex + ey * ey + ez * ez);
  return r < SHAPE_R_MIN ? SHAPE_R_MIN : r > SHAPE_R_MAX ? SHAPE_R_MAX : r;
}

/* ─────────────────────────────── integrals and measurements (not hot: ~4000 evaluations) ─────────────────────────────── */

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Number of Fibonacci-lattice directions used by the measurements below (deterministic, near-uniform on the sphere). */
export const SHAPE_SAMPLES = 4096;

/** Call `cb` for n near-uniform unit directions (Fibonacci lattice). */
export function forEachDirection(n: number, cb: (ux: number, uy: number, uz: number, i: number) => void): void {
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * GOLDEN;
    cb(Math.cos(phi) * rr, y, Math.sin(phi) * rr, i);
  }
}

/** Enclosed volume relative to a unit sphere: mean of r^3 over the sphere (V = 1/3 * integral of r^3 dOmega; the sphere gives 1). */
export function shapeVolumeRatio(recipe: ShapeRecipe, n: number = SHAPE_SAMPLES): number {
  let s = 0;
  forEachDirection(n, (x, y, z) => { const r = evalShape(recipe, x, y, z); s += r * r * r; });
  return s / n;
}

export interface ShapeBounds {
  /** Smallest and largest surface radius over the sphere (units of R0). */
  rMin: number;
  rMax: number;
  /** Axis-aligned box of the surface points u * r(u). */
  min: [number, number, number];
  max: [number, number, number];
  /** max.y - min.y, the standing height (units of R0). */
  height: number;
}

export function shapeBounds(recipe: ShapeRecipe, n: number = SHAPE_SAMPLES): ShapeBounds {
  const b: ShapeBounds = { rMin: Infinity, rMax: -Infinity, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], height: 0 };
  forEachDirection(n, (x, y, z) => {
    const r = evalShape(recipe, x, y, z);
    if (r < b.rMin) b.rMin = r;
    if (r > b.rMax) b.rMax = r;
    const p0 = x * r, p1 = y * r, p2 = z * r;
    if (p0 < b.min[0]) b.min[0] = p0; if (p0 > b.max[0]) b.max[0] = p0;
    if (p1 < b.min[1]) b.min[1] = p1; if (p1 > b.max[1]) b.max[1] = p1;
    if (p2 < b.min[2]) b.min[2] = p2; if (p2 > b.max[2]) b.max[2] = p2;
  });
  b.height = b.max[1] - b.min[1];
  return b;
}

/**
 * Surface steepness at a direction: |grad_tangent r| / r = tan(tilt), where tilt is the angle between the surface normal and the
 * radial direction (0 = sphere-like, 1 = 45 degrees, 2 = 63 degrees). Central finite differences along two tangents.
 */
export function shapeSlope(recipe: ShapeRecipe, ux: number, uy: number, uz: number): number {
  // a tangent basis that is well conditioned for any u
  let ax = 1, ay = 0, az = 0;
  if (Math.abs(ux) > 0.6) { ax = 0; ay = 1; }
  let t1x = ay * uz - az * uy, t1y = az * ux - ax * uz, t1z = ax * uy - ay * ux;
  const l1 = Math.hypot(t1x, t1y, t1z); t1x /= l1; t1y /= l1; t1z /= l1;
  const t2x = uy * t1z - uz * t1y, t2y = uz * t1x - ux * t1z, t2z = ux * t1y - uy * t1x;
  const e = 0.01;
  const along = (tx: number, ty: number, tz: number): number => {
    let px = ux + e * tx, py = uy + e * ty, pz = uz + e * tz; let l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
    let qx = ux - e * tx, qy = uy - e * ty, qz = uz - e * tz; l = Math.hypot(qx, qy, qz); qx /= l; qy /= l; qz /= l;
    return (evalShape(recipe, px, py, pz) - evalShape(recipe, qx, qy, qz)) / (2 * e);
  };
  const g1 = along(t1x, t1y, t1z), g2 = along(t2x, t2y, t2z);
  return Math.hypot(g1, g2) / evalShape(recipe, ux, uy, uz);
}

/**
 * Silhouette distance between two recipes: RMS over the sphere of the difference of their VOLUME-NORMALISED radius functions
 * (each r divided by cbrt(volume ratio), so "same shape, different size" is distance 0 and form is what is compared). Unit: fraction of
 * the body radius. About 0.05 = a sphere against a 0.8 flattened ellipsoid; 0.15+ = clearly different at a glance.
 */
export function shapeDistance(a: ShapeRecipe, b: ShapeRecipe, n: number = 1024): number {
  const sa = Math.cbrt(shapeVolumeRatio(a, n)), sb = Math.cbrt(shapeVolumeRatio(b, n));
  let s = 0;
  forEachDirection(n, (x, y, z) => { const d = evalShape(a, x, y, z) / sa - evalShape(b, x, y, z) / sb; s += d * d; });
  return Math.sqrt(s / n);
}

/* ───────────────────────────────────────────────── DOLLOP ───────────────────────────────────────────────── */

/**
 * DOLLOP, the slice squishy (species 0): a squat dome flattened to 0.8 in Y, a narrow raised swirl-peak at +Y leaning a little, a
 * faint spiral piping ridge on the flanks and a flat-ish foot. Fitted (grid search) against the radial profile of
 * `restPoint('dollop', ...)` in src/physics/shape.ts, the physics lane's current build: RMS error 0.012 R0 over the whole sphere, worst
 * case 0.085 R0 at the very tip of the peak (the physics peak is pinched narrower than the 0.35 rad feature-width floor allows).
 * probe_catalog.ts re-measures this against the live physics function and fails if it drifts.
 */
export const DOLLOP_RECIPE: ShapeRecipe = shape(
  [1, 0.8, 1],
  [
    bump([0.06, 1, 0.035], 0.5, 0.35),
    dent([0, -1, 0], 0.1, 0.5),
  ],
  { amp: 0.028, lobes: 3, twist: 6.5, fadeIn: [0.3, 0.8], fadeOut: [1.9, 2.5] },
);
