// GENESIS — how big the god's things are DRAWN (render-side presentation only; the sim's sizes, masses and craters never
// change). The Touch is sized to the view so it reads from a street and from orbit; what it lifts and hurls is drawn
// in proportion to it while it holds them and as they leave it, then eases back to its true size over the last third
// of the flight, so the landing, the dust and the crater match the sim. Nothing in flight is ever drawn smaller than a
// readable number of pixels. Pure arithmetic (no three.js): the throw tests import it.

/** the share of the camera distance the Touch spans (its vortex height), and its bounds in metres */
export const TOUCH_SHARE = 0.14;
export const TOUCH_MIN = 3.2;
export const TOUCH_MAX = 140;

/** the Touch's size (m) seen from `camDist` metres */
export function touchSize(camDist: number): number {
  return Math.max(TOUCH_MIN, Math.min(TOUCH_MAX, camDist * TOUCH_SHARE));
}

/** what a held thing is drawn as at least, as a share of the Touch's size */
export const HELD_SHARE = 0.35;

/**
 * A held or thrown thing's drawn size (m): `trueSize` raised to HELD_SHARE × the Touch's size while held (`progress`
 * < 0) and at release, easing back to the true size over the last third of its flight (`progress` 0..1).
 */
export function presentScale(trueSize: number, touch: number, progress: number): number {
  const big = Math.max(trueSize, HELD_SHARE * touch);
  if (progress < 0) return big;
  const t = Math.min(1, Math.max(0, (progress - 2 / 3) * 3));
  const e = t * t * (3 - 2 * t);
  return big + (trueSize - big) * e;
}

/** the on-screen size (px) of something `size` metres across at `dist` metres, in a view `heightPx` tall with `fovDeg` */
export function pixelSize(size: number, dist: number, heightPx: number, fovDeg: number): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return (size / Math.max(1e-6, 2 * dist * t)) * heightPx;
}

/** the smallest size (m) that still spans `minPx` pixels at `dist` metres */
export function sizeForPixels(minPx: number, dist: number, heightPx: number, fovDeg: number): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return (minPx * 2 * dist * t) / Math.max(1, heightPx);
}

/** a flying thing is never drawn below this many pixels */
export const FLIGHT_MIN_PX = 12;

/**
 * The drawn size (m) of a thing in flight: its presentation scale, but never under FLIGHT_MIN_PX on screen — except
 * in the last moments before it lands (progress past 0.92), when it settles to its true size for the impact.
 */
export function flightDrawSize(trueSize: number, touch: number, progress: number, dist: number, heightPx: number, fovDeg: number): number {
  const s = presentScale(trueSize, touch, progress);
  const floor = sizeForPixels(FLIGHT_MIN_PX, dist, heightPx, fovDeg);
  const keep = 1 - Math.min(1, Math.max(0, (progress - 0.92) / 0.08));
  return Math.max(s, floor * keep, trueSize);
}

/**
 * Seconds until a ballistic body at height `h0` (m) above flat ground, rising at `vUp` m/s, comes down under gravity g.
 * (On a small world the ground curves away; the renderer refines it by integrating — this is the estimate.)
 */
export function flightTime(vUp: number, h0: number, g: number): number {
  const gg = Math.max(0.1, g);
  return (vUp + Math.sqrt(Math.max(0, vUp * vUp + 2 * gg * Math.max(0, h0)))) / gg;
}
