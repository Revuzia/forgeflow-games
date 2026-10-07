// VALE render — the in-match camera (STYLE_BIBLE "In-game camera", tokens.json `camera`).
//
// Pitch 52°, VERTICAL fov 26°, distance 28.5 m, zoom 24.5–33.0 m (spectator 20–44 m), fixed yaw
// looking −Z, focus at screen centre, no per-side offset — identical for every player (fairness).
// Modes:
//   locked       focus rides your fighter (critically damped, no lag you can exploit)
//   semi         pan freely, but the focus stays within a 6 m leash of your fighter
//   free         edge pan (pointer within 18 px of an edge) + keyboard pan at controls.panSpeed
//   scout (hold) free pan while held; release snaps back to your fighter (cut, 1 frame)
// Focus is clamped to the map bounds. Zoom eases over 200 ms. Screen shake (structure falls, own
// T4 casts) is ≤ 4 px for ≤ 120 ms, scaled by access.screenShake and off with reduceMotion.

import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export const CAMERA = {
  pitchDeg: 52, fovDeg: 26, distance: 28.5, minDistance: 24.5, maxDistance: 33.0,
  spectatorMin: 20, spectatorMax: 44, zoomEaseMs: 200, leash: 6, edgePx: 18,
} as const;

export type CameraMode = 'locked' | 'semi' | 'free';

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly focus = new Vector3();
  mode: CameraMode = 'semi';
  spectator = false;
  edgePan = true;
  /** 0..1 (controls.panSpeed) → 18..54 m/s */
  panSpeed = 0.5;
  shakeScale = 1;
  reduceMotion = false;
  private distance: number = CAMERA.distance;
  private zoomTarget: number = CAMERA.distance;
  private pitch = MathUtils.degToRad(CAMERA.pitchDeg);
  private bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
  private self: { x: number; z: number } | null = null;
  private scouting = false;
  private pointer = { x: 0, y: 0, inside: false };
  private keyPan = { x: 0, z: 0 };
  private shakeT = 0;
  private shakeDur = 0;
  private shakePx = 0;
  private seeded = false;
  private viewW = 1920;
  private viewH = 1080;

  constructor(aspect = 16 / 9) {
    this.camera = new PerspectiveCamera(CAMERA.fovDeg, aspect, 1, 400);
    this.camera.rotation.order = 'YXZ';
  }

  setBounds(sizeX: number, sizeZ: number): void { this.bounds = { minX: 0, minZ: 0, maxX: sizeX, maxZ: sizeZ }; }
  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w); this.viewH = Math.max(1, h);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
  }

  /** the local fighter's interpolated ground position (null while unknown) */
  setSelf(x: number | null, z: number | null): void {
    if (x === null || z === null) { this.self = null; return; }
    this.self = { x, z };
    if (!this.seeded) { this.focus.set(x, 0, z); this.seeded = true; }
  }
  /** jump the focus (minimap click, respawn, centerCamera) */
  focusOn(x: number, z: number): void { this.focus.set(x, 0, z); this.seeded = true; this.clamp(); }
  centerOnSelf(): void { if (this.self) this.focusOn(this.self.x, this.self.z); }
  setMode(m: CameraMode): void { this.mode = m; if (m === 'locked') this.centerOnSelf(); }
  scout(on: boolean): void {
    if (this.scouting && !on) this.centerOnSelf();
    this.scouting = on;
  }
  get isScouting(): boolean { return this.scouting; }
  setPointer(clientX: number, clientY: number, inside: boolean): void { this.pointer.x = clientX; this.pointer.y = clientY; this.pointer.inside = inside; }
  /** keyboard pan intent, each axis in −1..1 (screen right = +x, screen up = −z) */
  setKeyPan(x: number, z: number): void { this.keyPan.x = x; this.keyPan.z = z; }
  zoomBy(steps: number): void {
    const lo = this.spectator ? CAMERA.spectatorMin : CAMERA.minDistance;
    const hi = this.spectator ? CAMERA.spectatorMax : CAMERA.maxDistance;
    this.zoomTarget = MathUtils.clamp(this.zoomTarget + steps * 1.5, lo, hi);
  }
  setZoom(distance: number): void {
    const lo = this.spectator ? CAMERA.spectatorMin : CAMERA.minDistance;
    const hi = this.spectator ? CAMERA.spectatorMax : CAMERA.maxDistance;
    this.zoomTarget = this.distance = MathUtils.clamp(distance, lo, hi);
  }
  get zoom(): number { return this.distance; }
  shake(px: number, ms: number): void {
    if (this.reduceMotion || this.shakeScale <= 0) return;
    this.shakePx = Math.min(4, px) * this.shakeScale;
    this.shakeDur = Math.min(120, ms) / 1000;
    this.shakeT = this.shakeDur;
  }

  update(dt: number): void {
    const d = Math.min(0.1, Math.max(0, dt));
    // zoom ease (200 ms to ~95 %)
    this.distance += (this.zoomTarget - this.distance) * (1 - Math.exp(-d / (CAMERA.zoomEaseMs / 1000 / 3)));

    const free = this.mode === 'free' || this.scouting || !this.self;
    const following = this.mode === 'locked' && !this.scouting && this.self;
    if (following && this.self) {
      const k = 1 - Math.exp(-d * 18);
      this.focus.x += (this.self.x - this.focus.x) * k;
      this.focus.z += (this.self.z - this.focus.z) * k;
    } else {
      // pan: keyboard + edge
      let px = this.keyPan.x, pz = this.keyPan.z;
      if (this.edgePan && this.pointer.inside) {
        const e = CAMERA.edgePx;
        if (this.pointer.x <= e) px -= 1; else if (this.pointer.x >= this.viewW - 1 - e) px += 1;
        if (this.pointer.y <= e) pz -= 1; else if (this.pointer.y >= this.viewH - 1 - e) pz += 1;
      }
      if (px !== 0 || pz !== 0) {
        const speed = 18 + 36 * MathUtils.clamp(this.panSpeed, 0, 1);
        const len = Math.hypot(px, pz);
        this.focus.x += (px / len) * speed * d;
        this.focus.z += (pz / len) * speed * d;
      }
      if (!free && this.mode === 'semi' && this.self) {
        const dx = this.focus.x - this.self.x, dz = this.focus.z - this.self.z;
        const r = Math.hypot(dx, dz);
        if (r > CAMERA.leash) { this.focus.x = this.self.x + (dx / r) * CAMERA.leash; this.focus.z = this.self.z + (dz / r) * CAMERA.leash; }
      }
    }
    this.clamp();

    // place the camera
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    let fx = this.focus.x, fz = this.focus.z;
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - d);
      const a = this.shakePx * (this.shakeT / this.shakeDur) / 82; // 82 px per metre at the focus (1080p)
      const t = this.shakeT * 90;
      fx += Math.sin(t * 1.7) * a; fz += Math.cos(t * 2.3) * a;
    }
    this.camera.position.set(fx, this.distance * sp, fz + this.distance * cp);
    this.camera.rotation.set(-this.pitch, 0, 0);
    this.camera.updateMatrixWorld();
  }

  private clamp(): void {
    const b = this.bounds;
    this.focus.x = MathUtils.clamp(this.focus.x, b.minX, b.maxX);
    this.focus.z = MathUtils.clamp(this.focus.z, b.minZ, b.maxZ);
  }
}
