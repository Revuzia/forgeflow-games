// VALE sim — 2D math on plain numbers (CONTRACT §2: metres, radians, facing 0 = +x toward +y).
//
// Hot paths pass scalars and write into caller-owned `V2` objects instead of returning new
// vectors, so per-tick loops do not allocate. Shape tests take the tested unit's radius (`pr`) so
// a unit whose edge overlaps a shape counts as inside (generous hits read better than exact ones).

import type { ShapeT } from '../contracts/catalog.ts';

export interface V2 { x: number; y: number }
export type Poly = readonly (readonly [number, number])[];

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function v2(x = 0, y = 0): V2 { return { x, y }; }
export function set(out: V2, x: number, y: number): V2 { out.x = x; out.y = y; return out; }

export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function len(x: number, y: number): number { return Math.sqrt(x * x + y * y); }
export function dist2(ax: number, ay: number, bx: number, by: number): number { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
export function dist(ax: number, ay: number, bx: number, by: number): number { return Math.sqrt(dist2(ax, ay, bx, by)); }
export function dot(ax: number, ay: number, bx: number, by: number): number { return ax * bx + ay * by; }
export function cross(ax: number, ay: number, bx: number, by: number): number { return ax * by - ay * bx; }

/** unit vector of (x, y) into `out`; a zero vector becomes `fallback` angle's direction (default +x) */
export function normInto(out: V2, x: number, y: number, fallbackAngle = 0): V2 {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-9) { out.x = Math.cos(fallbackAngle); out.y = Math.sin(fallbackAngle); return out; }
  out.x = x / l; out.y = y / l; return out;
}

// ── angles ──────────────────────────────────────────────────────────────────────────────────────
export function angleOf(x: number, y: number): number { return Math.atan2(y, x); }
/** wrap to (-π, π] */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU; else if (a > Math.PI) a -= TAU;
  return a;
}
/** signed shortest turn from a to b */
export function angleDiff(a: number, b: number): number { return wrapAngle(b - a); }
export function dirFromAngle(out: V2, a: number): V2 { out.x = Math.cos(a); out.y = Math.sin(a); return out; }
export function rotateInto(out: V2, x: number, y: number, a: number): V2 {
  const c = Math.cos(a), s = Math.sin(a);
  const rx = x * c - y * s, ry = x * s + y * c;
  out.x = rx; out.y = ry; return out;
}
/** turn `from` toward `to` by at most maxStep radians */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * maxStep);
}

// ── segments ────────────────────────────────────────────────────────────────────────────────────
/** squared distance from point p to segment ab */
export function segPointDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 1e-12 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + abx * t - px, qy = ay + aby * t - py;
  return qx * qx + qy * qy;
}

/**
 * First parameter t ∈ [0, 1] at which the segment a→b touches the circle (c, r); 0 if a is already
 * inside; -1 if it never does. Used for swept projectile hits so fast shots cannot tunnel.
 */
export function segmentCircleT(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const fx = ax - cx, fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax, dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy);
  if (b >= 0) return -1;                       // moving away
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
export function segmentHitsCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  return segPointDist2(ax, ay, bx, by, cx, cy) <= r * r;
}

/** proper or touching intersection of segments ab and cd */
export function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = cross(dx - cx, dy - cy, ax - cx, ay - cy);
  const d2 = cross(dx - cx, dy - cy, bx - cx, by - cy);
  const d3 = cross(bx - ax, by - ay, cx - ax, cy - ay);
  const d4 = cross(bx - ax, by - ay, dx - ax, dy - ay);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) || (d2 === 0 && onSeg(cx, cy, dx, dy, bx, by)) ||
    (d3 === 0 && onSeg(ax, ay, bx, by, cx, cy)) || (d4 === 0 && onSeg(ax, ay, bx, by, dx, dy));
}
function onSeg(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  return Math.min(ax, bx) <= px && px <= Math.max(ax, bx) && Math.min(ay, by) <= py && py <= Math.max(ay, by);
}

// ── shapes (CONTRACT: catalog Shape; rect anchored at origin, extending `length` along dir) ───────
export function inCircle(px: number, py: number, pr: number, ox: number, oy: number, r: number): boolean {
  const rr = r + pr;
  return dist2(px, py, ox, oy) <= rr * rr;
}
export function inRing(px: number, py: number, pr: number, ox: number, oy: number, r: number, inner: number): boolean {
  const d = dist(px, py, ox, oy);
  return d <= r + pr && d >= inner - pr;
}
/** cone with apex at o, axis (dx, dy) (unit), radius r, half-angle `half` (radians) */
export function inCone(px: number, py: number, pr: number, ox: number, oy: number, dx: number, dy: number, r: number, half: number): boolean {
  const vx = px - ox, vy = py - oy;
  const d2 = vx * vx + vy * vy;
  const rr = r + pr;
  if (d2 > rr * rr) return false;
  if (half >= Math.PI - 1e-6) return true;
  const d = Math.sqrt(d2);
  if (d <= pr) return true;                    // the unit overlaps the apex
  const cosA = (vx * dx + vy * dy) / d;
  const a = Math.acos(clamp(cosA, -1, 1));
  // widen by the angular size of the unit so edge-overlap counts
  return a <= half + Math.asin(clamp(pr / d, 0, 1));
}
/** rectangle from o along unit dir (dx, dy): u ∈ [0, length], |v| ≤ width/2 (both inflated by pr) */
export function inRect(px: number, py: number, pr: number, ox: number, oy: number, dx: number, dy: number, length: number, width: number): boolean {
  const vx = px - ox, vy = py - oy;
  const u = vx * dx + vy * dy;
  const v = -vx * dy + vy * dx;
  return u >= -pr && u <= length + pr && Math.abs(v) <= width * 0.5 + pr;
}
export function inShape(s: ShapeT, px: number, py: number, pr: number, ox: number, oy: number, dx: number, dy: number): boolean {
  switch (s.kind) {
    case 'circle': return inCircle(px, py, pr, ox, oy, s.radius);
    case 'ring': return inRing(px, py, pr, ox, oy, s.radius, s.inner);
    case 'cone': return inCone(px, py, pr, ox, oy, dx, dy, s.radius, s.angleDeg * DEG * 0.5);
    case 'rect': return inRect(px, py, pr, ox, oy, dx, dy, s.length, s.width);
  }
}
/** radius of a circle around the anchor that contains the whole shape (broad-phase queries) */
export function shapeReach(s: ShapeT): number {
  switch (s.kind) {
    case 'circle': case 'ring': case 'cone': return s.radius;
    case 'rect': return Math.sqrt(s.length * s.length + s.width * s.width * 0.25);
  }
}

// ── polygons ────────────────────────────────────────────────────────────────────────────────────
/** even-odd ray cast; points exactly on an edge may land either way */
export function pointInPolygon(px: number, py: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export interface Aabb { minX: number; minY: number; maxX: number; maxY: number }
export function polygonAabb(poly: Poly): Aabb {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}
/** squared distance from a point to the polygon's boundary */
export function polygonEdgeDist2(px: number, py: number, poly: Poly): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = segPointDist2(poly[j][0], poly[j][1], poly[i][0], poly[i][1], px, py);
    if (d < best) best = d;
  }
  return best;
}
