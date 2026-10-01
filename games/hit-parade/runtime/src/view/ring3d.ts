// HIT PARADE - view-side ring geometry + the fight-line frame (CHANGED(VIEW3D), CONTRACT §35.2 / §35.3 / §35.7 / §35.11).
//
// Presentation-only FLOAT math (the sim's integer ring lives in core/sim/ring.ts; nothing here feeds back into the sim).
// Angles follow the §35.1 yaw convention: dir(yaw) = (x = sin yaw, z = cos yaw); a ring's `rot` is the yaw of poly side 0's
// outward normal / circle sector 0's centre; `r` = circle radius / poly APOTHEM (centre -> the boundary's inner face).
//
// LineFrame = a planar frame on the ground: origin O, R = screen-right, N = toward the camera (R = (N.z, -N.x), the §35.13
// item 5 rule), y up. The 1D-authored parts of the view (PRIME TIME timelines, v1 cinematic shots, the camera's KO / super /
// parry offsets, FX offsets) run in "line space" (x along R, z along N) and come out through toWorld().

import type * as THREE from 'three';

export interface RingGeom {
  shape: 'circle' | 'poly';
  /** circle radius / poly apothem (m) = the boundary's inner face */
  r: number;
  sides: number;
  /** radians, yaw convention */
  rot: number;
  cx: number; cz: number;
  /** view-only stage facts (stages.json ring / camera): wall top, thickness, splat surface + dust tint, camera clear radius */
  wallH: number;
  thick: number;
  surface: string;
  dust: string | null;
  clearR: number;
  /** outward side normals (poly) */
  nx: number[]; nz: number[];
}

export interface RingSnapLike { shape?: string; radius?: number; sides?: number; rot?: number; centre?: ReadonlyArray<number> }
interface StageRingLike {
  ring?: { shape?: string; radiusM?: number; sides?: number; rotDeg?: number; wallHeightM?: number; thicknessM?: number; surface?: string; dustColor?: string; centre?: ReadonlyArray<number> };
  cameraMaxM?: number;
  camera?: { clearRadiusM?: number };
}

const DEG = Math.PI / 180;

/** The ring for a match: the sim's snapshot ring (shape / size / rotation / centre) + the stage's view-only facts. */
export function ringFrom(snap: RingSnapLike | null | undefined, stage: unknown): RingGeom {
  const st = (stage ?? {}) as StageRingLike;
  const sr = st.ring ?? {};
  const shape = (snap?.shape ?? sr.shape) === 'poly' ? 'poly' : 'circle';
  const r = Number(snap?.radius ?? sr.radiusM ?? 5.5) || 5.5;
  const sides = Math.max(3, Math.round(Number(snap?.sides ?? sr.sides ?? (shape === 'poly' ? 8 : 16)) || 16));
  const rot = typeof snap?.rot === 'number' ? snap.rot : (Number(sr.rotDeg ?? 0) || 0) * DEG;
  const c = snap?.centre ?? sr.centre ?? [0, 0];
  // camera clear radius: the measured camera.clearRadiusM (rooftop / control room) else §35.11.5 cameraMaxM, else 9.5
  const clear = Number(st.camera?.clearRadiusM ?? st.cameraMaxM ?? 9.5) || 9.5;
  const g: RingGeom = {
    shape, r, sides, rot, cx: Number(c[0]) || 0, cz: Number(c[1]) || 0,
    wallH: Math.max(0.2, Number(sr.wallHeightM ?? 1.2) || 1.2), thick: Math.max(0.05, Number(sr.thicknessM ?? 0.4) || 0.4),
    surface: String(sr.surface ?? 'wall'), dust: typeof sr.dustColor === 'string' ? sr.dustColor : null,
    clearR: Math.max(r + 1.5, clear), nx: [], nz: [],
  };
  if (shape === 'poly') for (let k = 0; k < sides; k++) { const a = rot + (k * 2 * Math.PI) / sides; g.nx.push(Math.sin(a)); g.nz.push(Math.cos(a)); }
  return g;
}

/** distance from (px, pz) to the boundary (> 0 inside, < 0 outside) */
export function ringGap(g: RingGeom, px: number, pz: number): number {
  const qx = px - g.cx, qz = pz - g.cz;
  if (g.shape === 'circle') return g.r - Math.hypot(qx, qz);
  let m = Infinity;
  for (let k = 0; k < g.sides; k++) m = Math.min(m, g.r - (qx * g.nx[k] + qz * g.nz[k]));
  return m;
}

/** distance along the unit planar direction (ux, uz) from an INSIDE point to the boundary (0 when already outside) */
export function ringRay(g: RingGeom, px: number, pz: number, ux: number, uz: number): number {
  const qx = px - g.cx, qz = pz - g.cz;
  if (g.shape === 'circle') {
    const b = qx * ux + qz * uz, c = qx * qx + qz * qz - g.r * g.r;
    const disc = b * b - c;
    return disc <= 0 ? 0 : Math.max(0, -b + Math.sqrt(disc));
  }
  let t = Infinity;
  for (let k = 0; k < g.sides; k++) {
    const dn = ux * g.nx[k] + uz * g.nz[k];
    if (dn <= 1e-9) continue;
    t = Math.min(t, (g.r - (qx * g.nx[k] + qz * g.nz[k])) / dn);
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** clamp (px, pz) inside the ring with `margin` m to spare -> out [x, z] */
export function ringClamp(g: RingGeom, px: number, pz: number, margin: number, out: [number, number]): [number, number] {
  let qx = px - g.cx, qz = pz - g.cz;
  const lim = Math.max(0.1, g.r - margin);
  if (g.shape === 'circle') {
    const d = Math.hypot(qx, qz);
    if (d > lim) { qx *= lim / d; qz *= lim / d; }
  } else {
    for (let it = 0; it < 3; it++) for (let k = 0; k < g.sides; k++) {
      const d = qx * g.nx[k] + qz * g.nz[k];
      if (d > lim) { qx -= g.nx[k] * (d - lim); qz -= g.nz[k] * (d - lim); }
    }
  }
  out[0] = g.cx + qx; out[1] = g.cz + qz;
  return out;
}

/**
 * The segment (cx, cz) -> (tx, tz) from a camera OUTSIDE the ring to a point inside: the fraction u in (0, 1) where it
 * crosses the boundary (the wall's inner face). -1 when the camera is inside (no crossing) or the target is outside.
 */
export function ringEntry(g: RingGeom, cx: number, cz: number, tx: number, tz: number): number {
  const ax = cx - g.cx, az = cz - g.cz, bx = tx - g.cx, bz = tz - g.cz;
  if (g.shape === 'circle') {
    const r2 = g.r * g.r;
    if (ax * ax + az * az <= r2 || bx * bx + bz * bz > r2) return -1;
    const dx = bx - ax, dz = bz - az;
    const A = dx * dx + dz * dz, B = 2 * (ax * dx + az * dz), C = ax * ax + az * az - r2;
    const disc = B * B - 4 * A * C;
    if (A < 1e-9 || disc < 0) return -1;
    const u = (-B - Math.sqrt(disc)) / (2 * A);
    return u > 0 && u < 1 ? u : -1;
  }
  let enter = -1;
  for (let k = 0; k < g.sides; k++) {
    const da = ax * g.nx[k] + az * g.nz[k] - g.r, db = bx * g.nx[k] + bz * g.nz[k] - g.r;
    if (db > 0) return -1;                          // the target is outside this side
    if (da > 0) enter = Math.max(enter, da / (da - db));
  }
  return enter > 0 && enter < 1 ? enter : -1;
}

/** the boundary point nearest (px, pz) and the wall's INWARD normal -> [x, z, nx, nz] */
export function ringWallAt(g: RingGeom, px: number, pz: number, out: [number, number, number, number]): [number, number, number, number] {
  const qx = px - g.cx, qz = pz - g.cz;
  if (g.shape === 'circle') {
    const d = Math.hypot(qx, qz);
    const ux = d > 1e-6 ? qx / d : Math.sin(g.rot), uz = d > 1e-6 ? qz / d : Math.cos(g.rot);
    out[0] = g.cx + ux * g.r; out[1] = g.cz + uz * g.r; out[2] = -ux; out[3] = -uz;
    return out;
  }
  let bk = 0, bd = -Infinity;
  for (let k = 0; k < g.sides; k++) { const d = qx * g.nx[k] + qz * g.nz[k]; if (d > bd) { bd = d; bk = k; } }
  const ex = g.r - bd;
  out[0] = px + g.nx[bk] * ex; out[1] = pz + g.nz[bk] * ex; out[2] = -g.nx[bk]; out[3] = -g.nz[bk];
  return out;
}

/** the solid part of the boundary a splat decal can sit on (m above the floor): a cable railing has none (floor splat) */
export function ringSolidTop(g: RingGeom): number {
  const s = g.surface.toLowerCase();
  if (/cable|rope|chain|fence|net/.test(s)) return 0;
  if (/rail/.test(s)) return Math.min(g.wallH, 0.42);          // control room: riveted kick panels 0.42 m under the rails
  return g.wallH;
}

/** planar yaw (radians, yaw convention) of a direction (dx, dz) */
export function yawOf(dx: number, dz: number): number { return Math.atan2(dx, dz); }

/** shortest signed angle a -> b (radians) */
export function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

export class LineFrame {
  ox = 0; oz = 0;
  /** R = screen-right (unit, planar) */
  rx = 1; rz = 0;
  get nx(): number { return -this.rz; }
  get nz(): number { return this.rx; }

  /** from an origin and the camera normal N (R = (N.z, -N.x)) */
  fromN(ox: number, oz: number, nx: number, nz: number): this {
    const l = Math.hypot(nx, nz);
    const ux = l > 1e-9 ? nx / l : 0, uz = l > 1e-9 ? nz / l : 1;
    this.ox = ox; this.oz = oz; this.rx = uz; this.rz = -ux;
    return this;
  }
  /** from an origin and R */
  fromR(ox: number, oz: number, rx: number, rz: number): this {
    const l = Math.hypot(rx, rz);
    this.ox = ox; this.oz = oz; this.rx = l > 1e-9 ? rx / l : 1; this.rz = l > 1e-9 ? rz / l : 0;
    return this;
  }
  copy(o: LineFrame): this { this.ox = o.ox; this.oz = o.oz; this.rx = o.rx; this.rz = o.rz; return this; }
  /** line space (x along R, y up, z along N) -> world */
  toWorld(lx: number, y: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.ox + this.rx * lx + this.nx * lz, y, this.oz + this.rz * lx + this.nz * lz);
  }
  /** a world vector (in place) -> line space */
  toLocal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const dx = p.x - this.ox, dz = p.z - this.oz;
    return out.set(dx * this.rx + dz * this.rz, p.y, dx * this.nx + dz * this.nz);
  }
  lx(x: number, z: number): number { return (x - this.ox) * this.rx + (z - this.oz) * this.rz; }
  lz(x: number, z: number): number { return (x - this.ox) * this.nx + (z - this.oz) * this.nz; }
  /** world yaw (three.js rotation.y) of a body facing `sign` x R */
  yawAlong(sign: number): number { return Math.atan2(sign * this.rx, sign * this.rz); }
  /** rotation.y that maps an object's local +Z onto N (and +X onto R) */
  yawN(): number { return Math.atan2(this.nx, this.nz); }
  applyTo(o: THREE.Object3D): void { o.position.set(this.ox, 0, this.oz); o.rotation.set(0, this.yawN(), 0); o.updateMatrixWorld(true); }
}
