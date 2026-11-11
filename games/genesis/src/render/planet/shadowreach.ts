// GENESIS — how far a sun shadow can reach over a curved planet (PERF F11: shadow caster culling per cascade).
//
// A caster whose top stands e metres above the lowest receiving ground near a cascade throws its shadow at most
// x metres along the ground, where x is the least solution of  x · tan(el(x)) >= e,  el(x) = the sun's lowest
// elevation over the way: the elevation at the camera, less the planet's curvature over the distance from the camera
// to the far end of the shadow (a 3 km world turns 1° every 52 m). The ray from the caster's top descends at least
// x · tan(el(x)) relative to the sphere over x metres (the local elevation only falls along the way), so it is below
// every receiver past x. A sun too low to bound it (el <= 2°) answers Infinity: draw everything, so mountains keep
// their long evening shadows. Pure functions: tests/render-shadowreach.test.ts.

/** sun elevations below this draw every caster (no useful bound) */
export const REACH_MIN_EL = 0.035;

/**
 * Horizontal reach (m) of the shadow of a caster e metres above the lowest receiver. `el0`: the sun's elevation at
 * the camera (rad); `d0`: the distance from the camera to the farthest caster point considered, before the shadow
 * (m); `R`: planet radius (m); `margin` (m) is added (filter kernel, texel size).
 */
export function shadowReach(e: number, el0: number, d0: number, R: number, margin: number): number {
  if (!(e > 0)) return margin;
  const f = (x: number): number => {
    const el = el0 - (d0 + x) / R;
    return el > REACH_MIN_EL ? e / Math.tan(el) + margin : Infinity;
  };
  // iterate up from 0: f is increasing, so x <- f(x) climbs to the least fixed point (or diverges: Infinity)
  let x = 0;
  for (let it = 0; it < 16 && Number.isFinite(x); it++) {
    const nx = f(x) * 1.02 + 0.5;
    if (nx <= x) break;
    x = nx;
  }
  // (any x with f(x) <= x bounds the shadow)
  return Number.isFinite(x) && f(x) <= x ? x : Infinity;
}

/**
 * Least ground distance (m, measured at radius rRecv) from a spherical cap (unit centre direction (dx, dy, dz),
 * angular radius aR) to the points of a sphere (centre c, radius r, body frame) — 0 if they overlap in angle.
 */
export function capGap(dx: number, dy: number, dz: number, aR: number, cx: number, cy: number, cz: number, r: number, rRecv: number): number {
  const cl = Math.hypot(cx, cy, cz);
  if (cl <= r) return 0;
  const aC = Math.asin(Math.min(1, r / cl));
  const cos = Math.max(-1, Math.min(1, (dx * cx + dy * cy + dz * cz) / cl));
  const g = Math.acos(cos) - aR - aC;
  return g > 0 ? g * Math.max(0, rRecv) : 0;
}
