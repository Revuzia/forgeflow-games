// Small THREE-free math + shape tests shared by every sim system (CONTRACT.md §2).
// Heading θ ⇒ direction (sin θ, cos θ) in XZ.
import type { Shape } from './types.ts';

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const headingOf = (dx: number, dz: number) => Math.atan2(dx, dz);
export const dirX = (h: number) => Math.sin(h);
export const dirZ = (h: number) => Math.cos(h);
/** wrap to (−π, π] */
export function wrapAngle(a: number): number { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
/** shortest-path interpolation between headings */
export const lerpAngle = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;
/** turn `from` toward `to` by at most maxStep radians */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = wrapAngle(to - from);
  return from + clamp(d, -maxStep, maxStep);
}
export const dist2 = (ax: number, az: number, bx: number, bz: number) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax: number, az: number, bx: number, bz: number) => Math.sqrt(dist2(ax, az, bx, bz));

// Easing (view + sim tweens)
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export function easeOutBack(t: number, s = 1.70158): number { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; }

/** Distance from point to segment (and the closest-point parameter). */
export function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const vx = x1 - x0, vz = z1 - z0;
  const L2 = vx * vx + vz * vz;
  let t = L2 > 1e-9 ? ((px - x0) * vx + (pz - z0) * vz) / L2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t));
}

/**
 * Does a circle (cx,cz,cr) overlap the shape? cr = 0 → point test.
 * This is THE hit test for attacks, telegraphs and hazards — do not re-implement it.
 */
export function circleInShape(s: Shape, cx: number, cz: number, cr: number): boolean {
  switch (s.k) {
    case 'circle': return dist2(cx, cz, s.x, s.z) <= (s.r + cr) * (s.r + cr);
    case 'ring': {
      const d = dist(cx, cz, s.x, s.z);
      return d + cr >= s.r0 && d - cr <= s.r1;
    }
    case 'cone': {
      const dx = cx - s.x, dz = cz - s.z;
      const d = Math.hypot(dx, dz);
      if (d - cr > s.r) return false;
      if (d <= cr) return true;
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - s.dir));
      // widen the half-angle by the circle's angular radius at that distance
      const slack = Math.asin(clamp(cr / d, 0, 1));
      return ang <= s.half + slack;
    }
    case 'lane': {
      const fx = Math.sin(s.dir), fz = Math.cos(s.dir);
      const dx = cx - s.x, dz = cz - s.z;
      const along = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      return along >= -cr && along <= s.len + cr && Math.abs(side) <= s.w / 2 + cr;
    }
    case 'oval': {
      // rotate into local frame (local +Z = heading rot), then normalized ellipse test with radius slack
      const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
      const dx = cx - s.x, dz = cz - s.z;
      const lz = dx * fx + dz * fz;          // along heading
      const lx = dx * fz - dz * fx;          // across
      const ex = lx / (s.rx + cr), ez = lz / (s.rz + cr);
      return ex * ex + ez * ez <= 1;
    }
    case 'capsule': return segDist(cx, cz, s.x0, s.z0, s.x1, s.z1) <= s.r + cr;
  }
}

/** Axis-aligned rectangle (centre x,z, full extents w,d) vs shape — used for buildings. */
export function rectInShape(s: Shape, x: number, z: number, w: number, d: number): boolean {
  // closest point of the rect to the shape's anchor, then a point/circle test; for non-convex
  // shapes (ring) and long shapes (lane/capsule) test the rect's circumscribed circle as a fallback.
  const hw = w / 2, hd = d / 2;
  const ax = s.k === 'capsule' ? (s.x0 + s.x1) / 2 : s.x;
  const az = s.k === 'capsule' ? (s.z0 + s.z1) / 2 : s.z;
  const qx = clamp(ax, x - hw, x + hw), qz = clamp(az, z - hd, z + hd);
  if (circleInShape(s, qx, qz, 0)) return true;
  if (s.k === 'circle') return false;                    // closest point is exact for circles
  return circleInShape(s, x, z, Math.hypot(hw, hd) * 0.85);
}

/** Loose XZ bounds of a shape (for broadphase grid queries). */
export function shapeBounds(s: Shape): { minX: number; minZ: number; maxX: number; maxZ: number } {
  switch (s.k) {
    case 'circle': return { minX: s.x - s.r, minZ: s.z - s.r, maxX: s.x + s.r, maxZ: s.z + s.r };
    case 'ring': return { minX: s.x - s.r1, minZ: s.z - s.r1, maxX: s.x + s.r1, maxZ: s.z + s.r1 };
    case 'cone': return { minX: s.x - s.r, minZ: s.z - s.r, maxX: s.x + s.r, maxZ: s.z + s.r };
    case 'oval': { const m = Math.max(s.rx, s.rz); return { minX: s.x - m, minZ: s.z - m, maxX: s.x + m, maxZ: s.z + m }; }
    case 'lane': {
      const ex = s.x + Math.sin(s.dir) * s.len, ez = s.z + Math.cos(s.dir) * s.len, h = s.w / 2;
      return { minX: Math.min(s.x, ex) - h, minZ: Math.min(s.z, ez) - h, maxX: Math.max(s.x, ex) + h, maxZ: Math.max(s.z, ez) + h };
    }
    case 'capsule': return {
      minX: Math.min(s.x0, s.x1) - s.r, minZ: Math.min(s.z0, s.z1) - s.r,
      maxX: Math.max(s.x0, s.x1) + s.r, maxZ: Math.max(s.z0, s.z1) + s.r,
    };
  }
}

/** Anchor point of a shape (for event positions / fx). */
export function shapeCenter(s: Shape): { x: number; z: number } {
  switch (s.k) {
    case 'capsule': return { x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2 };
    case 'lane': return { x: s.x + Math.sin(s.dir) * s.len / 2, z: s.z + Math.cos(s.dir) * s.len / 2 };
    default: return { x: s.x, z: s.z };
  }
}
