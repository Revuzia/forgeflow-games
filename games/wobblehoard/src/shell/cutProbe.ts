// Cut probes (CUT3.md 5, U02 / U03): geometry the HARNESS needs to make the swipe a player would make across the tips of a star, in node (shellview/cutter_checks.ts) and in the real browser (the dev hook's
// tipSwipe / multiSwipe). Pure and read-only: no physics call, no state; nothing here is used by the game itself (only src/shell/debugHook.ts imports it).
//   * tipSwipe: a screen line perpendicular to a tip's axis as the camera sees it, `f` of the way from the body's radius to the tip's apex.
//   * componentSizes: the vertex counts of the connected parts above a plane on a body's mesh (edges between kept vertices): an INDEPENDENT count of what the physics calls the parts of a side.
//   * bestMultiSwipe: a grid search (36 angles x 29 offsets) for the screen line whose plane through the camera leaves the most separate parts on the two sides, the biggest still holding 40 % of the mesh.
import type { SoftBodyLike, V3 } from '../contracts.ts';
import type { CameraLike, Viewport } from '../input/camera.ts';
import { cameraPosition, cameraRay, projectToNdc, pxToNdc } from '../input/camera.ts';

export interface ScreenSwipe { x0: number; y0: number; x1: number; y1: number }

/** The part of a swipe line that lies inside the viewport (a margin of `m` px): the SAME line, so the same plane; a player cannot press outside the screen. null when under 40 px of it is left (Liang-Barsky). */
export function clipToViewport(s: ScreenSwipe, vp: Viewport, m = 6): ScreenSwipe | null {
  let t0 = 0, t1 = 1;
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  for (const [p, q] of [[-dx, s.x0 - m], [dx, vp.w - m - s.x0], [-dy, s.y0 - m], [dy, vp.h - m - s.y0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  const out = { x0: s.x0 + t0 * dx, y0: s.y0 + t0 * dy, x1: s.x0 + t1 * dx, y1: s.y0 + t1 * dy };
  return Math.hypot(out.x1 - out.x0, out.y1 - out.y0) >= 40 ? out : null;
}

/** The directions (rest frame) of the thin tips of a species' recipe, mirrored copies included. A feature is a thin tip when it is tall for its width (the `thin` test of probe_truecut.ts: amp / width past 0.7 to 1.3, width under 0.6 rad). */
export function tipDirsOfRecipe(features: ReadonlyArray<{ kind: string; amp: number; width: number; dir: readonly [number, number, number]; mirrorX?: boolean }>): V3[] {
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const out: V3[] = [];
  for (const ft of features) {
    if (ft.kind === 'dent') continue;
    const a = clamp01((ft.amp / ft.width - 0.7) / 0.6), b = clamp01((ft.width - 0.4) / 0.2);
    if (a * a * (3 - 2 * a) * (1 - b * b * (3 - 2 * b)) <= 0.2) continue;
    out.push({ x: ft.dir[0], y: ft.dir[1], z: ft.dir[2] });
    if (ft.mirrorX) out.push({ x: -ft.dir[0], y: ft.dir[1], z: ft.dir[2] });
  }
  return out;
}

const unitOf = (v: V3): V3 | null => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : null; };
const crossOf = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const rotate = (q: { x: number; y: number; z: number; w: number }, v: V3): V3 => {
  const tx = q.y * v.z - q.z * v.y + q.w * v.x, ty = q.z * v.x - q.x * v.z + q.w * v.y, tz = q.x * v.y - q.y * v.x + q.w * v.z;
  return { x: v.x + 2 * (q.y * tz - q.z * ty), y: v.y + 2 * (q.z * tx - q.x * tz), z: v.z + 2 * (q.x * ty - q.y * tx) };
};
/** world point to CSS px over the canvas (null: behind the camera) */
export function toPx(cam: CameraLike, vp: Viewport, p: V3): { x: number; y: number } | null {
  const n = projectToNdc(cam, p);
  return n ? { x: (n.x + 1) * 0.5 * vp.w, y: (1 - n.y) * 0.5 * vp.h } : null;
}

/** A swipe across the tip of `body` in rest direction `dir` (the species' recipe direction): perpendicular to the tip's axis as the camera sees it, `f` of the way from the body's radius to the apex.
 *  null when the tip is shorter than 15 % of the radius or points at the camera. */
export function tipSwipe(body: SoftBodyLike, cam: CameraLike, vp: Viewport, dir: V3, f = 0.4): (ScreenSwipe & { tipLen: number }) | null {
  const c = body.center, dW = rotate(body.frame, dir), P = body.positions, R0 = body.restRadius;
  let apex = -Infinity;
  for (let i = 0; i < body.vertexCount; i++) apex = Math.max(apex, (P[i * 3] - c.x) * dW.x + (P[i * 3 + 1] - c.y) * dW.y + (P[i * 3 + 2] - c.z) * dW.z);
  if (!(apex - R0 > 0.15 * R0)) return null;
  const sc = apex - (1 - f) * (apex - R0), p = { x: c.x + dW.x * sc, y: c.y + dW.y * sc, z: c.z + dW.z * sc };
  const eye = cameraPosition(cam), view = unitOf({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
  const t = view ? crossOf(dW, view) : null;
  if (!t || Math.hypot(t.x, t.y, t.z) < 0.4) return null;
  const tu = unitOf(t)!, half = 0.7 * R0;
  const e0 = toPx(cam, vp, { x: p.x - tu.x * half, y: p.y - tu.y * half, z: p.z - tu.z * half }), e1 = toPx(cam, vp, { x: p.x + tu.x * half, y: p.y + tu.y * half, z: p.z + tu.z * half });
  const clipped = e0 && e1 ? clipToViewport({ x0: e0.x, y0: e0.y, x1: e1.x, y1: e1.y }, vp) : null;
  return clipped ? { ...clipped, tipLen: apex - R0 } : null;
}

/** the vertex counts of the connected parts of the mesh above the world plane (n . (p - point) >= 0), largest first */
export function componentSizes(b: SoftBodyLike, point: V3, n: V3): number[] {
  const P = b.positions, I = b.indices, nv = b.vertexCount, keep = new Uint8Array(nv), par = new Int32Array(nv);
  for (let i = 0; i < nv; i++) { keep[i] = (P[i * 3] - point.x) * n.x + (P[i * 3 + 1] - point.y) * n.y + (P[i * 3 + 2] - point.z) * n.z >= 0 ? 1 : 0; par[i] = i; }
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], c = I[t + (k + 1) % 3]; if (keep[a] && keep[c]) par[find(a)] = find(c); }
  const cnt = new Map<number, number>();
  for (let i = 0; i < nv; i++) if (keep[i]) { const k = find(i); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  return [...cnt.values()].sort((a, c) => c - a);
}

/** the plane the Cutter makes of a screen swipe (point = the camera, unit normal), the same way cut.ts swipe() does */
export function swipePlane(cam: CameraLike, vp: Viewport, s: ScreenSwipe): { point: V3; normal: V3 } | null {
  const a = pxToNdc(s.x0, s.y0, vp), b = pxToNdc(s.x1, s.y1, vp), ra = cameraRay(cam, a.x, a.y), rb = cameraRay(cam, b.x, b.y);
  const normal = unitOf(crossOf(ra.dir, rb.dir));
  return normal ? { point: cameraPosition(cam), normal } : null;
}
/** how many separate parts the two sides of a swipe's plane form on `body`'s mesh */
export function partsOfSwipe(body: SoftBodyLike, cam: CameraLike, vp: Viewport, s: ScreenSwipe): number {
  const pl = swipePlane(cam, vp, s);
  return pl ? componentSizes(body, pl.point, pl.normal).length + componentSizes(body, pl.point, { x: -pl.normal.x, y: -pl.normal.y, z: -pl.normal.z }).length : 0;
}

/** The screen line (through the body on the screen) whose plane leaves the MOST separate parts of at least 5 vertices on its two sides, the biggest part still holding 40 % of the mesh (the tips are the small ones).
 *  null when no line leaves three parts or more. */
export function bestMultiSwipe(body: SoftBodyLike, cam: CameraLike, vp: Viewport): (ScreenSwipe & { parts: number }) | null {
  const c = toPx(cam, vp, body.center), e = toPx(cam, vp, { x: body.center.x + body.restRadius, y: body.center.y, z: body.center.z });
  if (!c || !e) return null;
  const pr = Math.abs(e.x - c.x);
  let best: (ScreenSwipe & { parts: number; small: number }) | null = null;
  for (let a = 0; a < 36; a++) {
    const th = (a * Math.PI) / 36, dx = Math.cos(th), dy = Math.sin(th);
    for (let k = -14; k <= 14; k++) {
      const o = (k / 10) * pr, qx = c.x - dy * o, qy = c.y + dx * o;
      const s = clipToViewport({ x0: qx - 2.4 * pr * dx, y0: qy - 2.4 * pr * dy, x1: qx + 2.4 * pr * dx, y1: qy + 2.4 * pr * dy }, vp);   // (the part of the line a finger can draw on the screen: the same plane)
      if (!s) continue;
      const pl = swipePlane(cam, vp, s);
      if (!pl) continue;
      const all = [...componentSizes(body, pl.point, pl.normal), ...componentSizes(body, pl.point, { x: -pl.normal.x, y: -pl.normal.y, z: -pl.normal.z })].sort((p, q) => q - p);
      if (all.length < 3 || all[0] < 0.4 * body.vertexCount || all[all.length - 1] < 5) continue;
      const small = all.slice(1).reduce((t, x) => t + x, 0);
      if (!best || all.length > best.parts || (all.length === best.parts && small < best.small)) best = { ...s, parts: all.length, small };
    }
  }
  return best ? { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1, parts: best.parts } : null;
}
