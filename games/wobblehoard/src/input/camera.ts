// Camera maths for the input layer, written against plain matrix elements so it needs no `three` import at runtime and
// runs under node with a real THREE.PerspectiveCamera (or any object that exposes the same four matrices).
// three stores matrices column-major: element (row r, col c) is e[c * 4 + r].
import type { SoftBodyLike, V3 } from '../contracts.ts';
import type { BodyHit, GestureHost, ScreenDisc } from './gestures.ts';

export interface Mat4Like { elements: ArrayLike<number> }
export interface CameraLike {
  matrixWorld: Mat4Like;
  matrixWorldInverse: Mat4Like;
  projectionMatrix: Mat4Like;
  projectionMatrixInverse: Mat4Like;
  updateMatrixWorld?(force?: boolean): void;
}

export interface Viewport { w: number; h: number }

/** Pixel (CSS px, origin top-left of the canvas) to normalised device coordinates (y up). */
export const pxToNdc = (x: number, y: number, vp: Viewport): { x: number; y: number } => ({
  x: (x / Math.max(1, vp.w)) * 2 - 1,
  y: 1 - (y / Math.max(1, vp.h)) * 2,
});

const norm = (x: number, y: number, z: number): V3 => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};

function unproject(m: ArrayLike<number>, w: ArrayLike<number>, x: number, y: number, z: number): V3 {
  const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
  const vw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = 1 / (vw || 1e-12);
  const cx = vx * iw, cy = vy * iw, cz = vz * iw;
  return {
    x: w[0] * cx + w[4] * cy + w[8] * cz + w[12],
    y: w[1] * cx + w[5] * cy + w[9] * cz + w[13],
    z: w[2] * cx + w[6] * cy + w[10] * cz + w[14],
  };
}

export const cameraPosition = (cam: CameraLike): V3 => {
  const w = cam.matrixWorld.elements;
  return { x: w[12], y: w[13], z: w[14] };
};
/** Unit vector the camera looks along. */
export const cameraForward = (cam: CameraLike): V3 => {
  const w = cam.matrixWorld.elements;
  return norm(-w[8], -w[9], -w[10]);
};
export const cameraRight = (cam: CameraLike): V3 => {
  const w = cam.matrixWorld.elements;
  return norm(w[0], w[1], w[2]);
};

/** World-space ray (origin = camera position, unit dir) through an NDC point. */
export function cameraRay(cam: CameraLike, ndcX: number, ndcY: number): { origin: V3; dir: V3 } {
  const origin = cameraPosition(cam);
  const far = unproject(cam.projectionMatrixInverse.elements, cam.matrixWorld.elements, ndcX, ndcY, 1);
  return { origin, dir: norm(far.x - origin.x, far.y - origin.y, far.z - origin.z) };
}

/** World point to NDC; null when behind the camera. */
export function projectToNdc(cam: CameraLike, p: V3): { x: number; y: number } | null {
  const v = cam.matrixWorldInverse.elements, m = cam.projectionMatrix.elements;
  const vx = v[0] * p.x + v[4] * p.y + v[8] * p.z + v[12];
  const vy = v[1] * p.x + v[5] * p.y + v[9] * p.z + v[13];
  const vz = v[2] * p.x + v[6] * p.y + v[10] * p.z + v[14];
  const cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
  const cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
  const cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
  if (!(cw > 1e-6)) return null;
  return { x: cx / cw, y: cy / cw };
}

/** Ray vs plane (through `through`, normal `n`). null when parallel or the plane is behind the ray. */
export function rayPlane(origin: V3, dir: V3, through: V3, n: V3): V3 | null {
  const denom = dir.x * n.x + dir.y * n.y + dir.z * n.z;
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((through.x - origin.x) * n.x + (through.y - origin.y) * n.y + (through.z - origin.z) * n.z) / denom;
  if (!(t > 0)) return null;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
}

export interface BodyHostOptions {
  camera(): CameraLike | null;
  body(): SoftBodyLike | null;
  viewport(): Viewport;
  /** Render offset of that body (stage.addBody position; the play mat): the body simulates at its own origin and is DRAWN here. Default 0. */
  offset?(): V3;
}

const ZERO: V3 = { x: 0, y: 0, z: 0 };

/** Raycast one body drawn at render offset `off` (the mat): the ray is moved into the body's own space. Hit points are body-space. */
export function raycastAt(body: SoftBodyLike, origin: V3, dir: V3, off: V3): { point: V3; normal: V3; vertex: number; t: number } | null {
  return body.raycast(off === ZERO || (off.x === 0 && off.y === 0 && off.z === 0) ? origin : { x: origin.x - off.x, y: origin.y - off.y, z: origin.z - off.z }, dir);
}

export interface BodyHost extends GestureHost {
  /** Screen position (px) of the body's centre of mass: where Space pokes. */
  screenCentre(): { x: number; y: number } | null;
  /** NDC x of a world point (audio pan), or null if it is behind the camera. */
  ndcOf(p: V3): { x: number; y: number } | null;
}

export function createBodyHost(o: BodyHostOptions): BodyHost {
  const off = (): V3 => (o.offset ? o.offset() : ZERO);
  /** a body-space point in world (render) space */
  const world = (p: V3): V3 => { const d = off(); return d.x === 0 && d.y === 0 && d.z === 0 ? p : { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z }; };
  const refresh = (): CameraLike | null => {
    const c = o.camera();
    if (c && c.updateMatrixWorld) c.updateMatrixWorld();
    return c;
  };
  const ray = (x: number, y: number): { origin: V3; dir: V3; cam: CameraLike } | null => {
    const cam = refresh();
    if (!cam) return null;
    const n = pxToNdc(x, y, o.viewport());
    return { ...cameraRay(cam, n.x, n.y), cam };
  };
  const toPx = (n: { x: number; y: number }, vp: Viewport): { x: number; y: number } => ({ x: (n.x * 0.5 + 0.5) * vp.w, y: (0.5 - n.y * 0.5) * vp.h });

  const bodyScreen = (): ScreenDisc | null => {
    const body = o.body();
    const cam = refresh();
    if (!body || !cam) return null;
    const vp = o.viewport();
    const bc = world(body.center);
    const c = projectToNdc(cam, bc);
    if (!c) return null;
    const right = cameraRight(cam);
    const R = body.restRadius;
    const e = projectToNdc(cam, { x: bc.x + right.x * R, y: bc.y + right.y * R, z: bc.z + right.z * R });
    const cp = toPx(c, vp);
    const r = e ? Math.abs(toPx(e, vp).x - cp.x) : 0;
    return { x: cp.x, y: cp.y, r };
  };

  return {
    hitTest(x, y): BodyHit | null {
      const body = o.body();
      const r = ray(x, y);
      if (!body || !r) return null;
      const h = raycastAt(body, r.origin, r.dir, off());
      if (!h) return null;
      return { point: h.point, normal: h.normal, dir: r.dir, vertex: h.vertex };
    },
    bodyScreen,
    planePoint(x, y, through): V3 | null {
      const r = ray(x, y);
      if (!r) return null;
      // `through` and the answer are body-space (grab targets): intersect in world space, then move back
      const d = off();
      const hit = rayPlane(r.origin, r.dir, world(through), cameraForward(r.cam));
      return hit ? { x: hit.x - d.x, y: hit.y - d.y, z: hit.z - d.z } : null;
    },
    screenCentre() {
      const d = bodyScreen();
      return d ? { x: d.x, y: d.y } : null;
    },
    ndcOf(p) {
      const cam = refresh();
      return cam ? projectToNdc(cam, world(p)) : null;
    },
  };
}
