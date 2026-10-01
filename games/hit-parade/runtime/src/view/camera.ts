// HIT PARADE - the orbit fighting camera (CONTRACT §7, CHANGED(VIEW3D) §35.7; numbers FIGHTING_DESIGN §7b/§7c).
//
// 3D ring (CHANGED(VIEW3D)): the SIM owns the camera basis - MatchSnap.camN, the unit perpendicular of the fight line on
// the camera side (§35.3) - and the view smooths it. Rig (versus): target = the pair midpoint (smoothed on the ground plane)
// at y 1.0 m; position = mid + N * dist + up * 1.35 m (pitch ~ -4 deg); vertical FOV 35 deg; distance =
//   max(vertical floor, horizontal need) clamped 4.4 .. 9.5 m, where
//   vertical floor  = ((1.8 + 0.45) / 2 + 0.25) / tan(vFOV/2)            = 4.36 m at 35 deg
//   horizontal need = (s/2 + 0.35 body + 0.9 margin) / (aspect * tan(vFOV/2))   (s = planar separation)
// The camera azimuth (the yaw of N) and the midpoint are eased (frame-rate independent asymptotic averaging) so the camera
// ORBITS as the pair circles; camN never flips (sim continuity), so neither does the camera. Jumps PAN (look-at and camera
// rise together so the higher fighter's top stays below the HUD band `safeTop`); they zoom only when top-to-feet cannot fit.
// Occlusion (every mode but a `free` pose): (1) set geometry - the camera's planar radius stays inside the stage's clear
// radius (stages.json camera.clearRadiusM / cameraMaxM, §35.11.5): pull in along the view line and widen the FOV by the
// same ratio so the framing holds; (2) the ring wall - outside the ring's inner face the camera rises until every sight
// line to the fighters' feet clears the wall top (<= 2.95 m, the clear band), else it pulls in (FOV widened again).
// Wall SWING: when the pair is at the ring wall with the camera side facing it, the rig first swings its azimuth up to
// +-40 deg off camN (the smallest swing whose sight lines need <= 0.35 m of raise; eased, sign-sticky) - a lower, profile
// shot instead of a steep one over the wall. Inputs stay the sim's (camN basis); a swing this size keeps LEFT / RIGHT
// reading left / right on screen.
// Shake (Eiserloh, research §5a/§5c): ROTATIONAL only, trauma 0..1, +0.10 light / +0.20 heavy / +0.35 IMPACT or punish
// counter / +0.5 KO, linear decay 1.6/s, shake = trauma^2, max yaw/pitch 2.5 deg, roll 4 deg, smooth incommensurate
// noise at 12-18 Hz; the shake clock runs at the slow-mo rate; ZERO shake during a perfect-parry freeze.
// Overrides (priority high -> low): cinematic pose (view/prime.ts, world metres) > KO orbit (25 deg toward the loser, zoom
// in; match point adds a hold on the winner) > super-freeze punch-in > perfect-parry zoom freeze (60 f) > rig. Overrides are
// authored in the camera's LOCAL frame (x along screen-right R from the midpoint, z along N) - the old 1D numbers - and
// converted to world, so they work at any fight-line angle.
// BRAWL variant (bonus rounds): behind/above the player - vFOV 45, camera 2.7 m looking down at 0.95 m, the azimuth turned
// 20 deg toward the player's back (over his shoulder toward the soft-lock goon; 38 / 2 / 56 / -16 deg instead when a goon
// would stand in the sight line to the player - sticky), distance fit to the player + the goons in reach (4.5 m) projected into the frame.

import * as THREE from 'three';
import { ringEntry, ringGap, wrapPi, type RingGeom } from './ring3d.ts';

const DEG = Math.PI / 180;

export const CAM = {
  vfov: 35,
  camY: 1.35,
  lookY: 1.0,
  dMin: 4.4,
  dMax: 9.5,
  bodyHalf: 0.35,
  margin: 0.9,
  /** head must stay below the top 12 % of the frame (when no HUD safe area was given, see FightCamera.safeTop) */
  topMargin: 0.12,
  /** CHANGED(fixer) D4: clearance under the HUD band (fraction of the frame height) */
  safePad: 0.015,
  /** ... and the lower fighter's feet above the bottom 4 % */
  bottomMargin: 0.04,
  aOut: 0.15, aIn: 0.04, aX: 0.2, aY: 0.12,
  /** CHANGED(VIEW3D): azimuth easing per 60 Hz frame (a sidewalk orbits ~43 deg/s: ~5 deg of lag) */
  aYaw: 0.12,
  /** CHANGED(VIEW3D) wall swing: max azimuth offset from camN, easing, the raise a swing must get under */
  swingMaxDeg: 40, aSwing: 0.06, swingOkRaise: 0.35,
  /** CHANGED(VIEW3D) occlusion: the top of the clear camera band (§35.11.5: y 1.30-3.00 m holds no set geometry) */
  maxY: 2.95,
  /** outside the ring the camera stays at or above the band floor */
  bandLow: 1.3,
  /** clearance of a sight line over the ring wall top (m) */
  wallClear: 0.08,
  /** FOV cap when a pull-in widens the lens */
  fovMax: 62,
  trauma: { L: 0.10, H: 0.20, PC: 0.35, IMPACT: 0.35, KO: 0.5 },
  decay: 1.6,
  maxYawDeg: 2.5, maxPitchDeg: 2.5, maxRollDeg: 4.0,
  freq: [79, 101, 113, 89, 97, 107] as const,        // rad/s: 12.6 .. 18 Hz, incommensurate
  parryFrames: 60,
  superFrames: 45,
  koOrbitDeg: 25,
  /** KO hitstop (FIGHTING_DESIGN 7c: 30 f), then the x0.25 slow-mo window (45 real frames) the orbit spans */
  koHitstopFrames: 30,
  koSlowFrames: 45,
  koHoldFrames: 60,
  brawl: { vfov: 45, camY: 2.7, lookY: 0.95, dMin: 3.8, dMax: 8.5, behindDeg: 20, reach: 4.5 },
};

/** a fighter for the camera: world metres (z optional = 0 for the 1D labs), head = the silhouette top (m, world) */
export interface CamFighter { x: number; y: number; z?: number; head: number }

/** `free` = a fixed lab / harness pose: no occlusion correction */
export interface CinePose { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number; free?: boolean }

function ease(a: number, dt: number): number { return 1 - Math.pow(1 - a, Math.max(0, dt) * 60); }
function smooth01(t: number): number { const x = t < 0 ? 0 : t > 1 ? 1 : t; return x * x * (3 - 2 * x); }

/**
 * CHANGED(fixer) D4: the lowest look-at height that keeps world height `top` (on the fight plane) at or below the screen
 * line `safeTop` (fraction of the frame height from the top) for the constant-pitch rig: camera at look + `delta`, `d` m
 * from the plane. Exact for any x on the plane (camera-space depth does not depend on x): NDC y = tan(angle to the point
 * relative to the view axis) / tan(vfov / 2).
 */
export function lookFloorFor(top: number, d: number, vfovDeg: number, delta: number, safeTop: number): number {
  const t = Math.tan(vfovDeg * DEG / 2);
  const aMax = Math.atan((1 - 2 * safeTop) * t);          // max angle above the view axis
  const pitch = Math.atan(delta / d);                      // view axis below horizontal
  return top - delta - d * Math.tan(aMax - pitch);
}
/** the highest look-at height that keeps world height `feet` at or above the bottom margin (fraction from the bottom) */
export function lookCeilFor(feet: number, d: number, vfovDeg: number, delta: number, bottom: number): number {
  const t = Math.tan(vfovDeg * DEG / 2);
  const aMin = Math.atan((1 - 2 * bottom) * t);            // max angle below the view axis
  const pitch = Math.atan(delta / d);
  return feet - delta - d * Math.tan(-aMin - pitch);
}

/** CONTRACT §7b / §35.7 distance for a separation (m) at an aspect (w/h) and vFOV (deg) */
export function distanceFor(sep: number, aspect: number, vfovDeg = CAM.vfov): number {
  const t = Math.tan(vfovDeg * DEG / 2);
  const dV = ((1.8 + 0.45) / 2 + 0.25) / t;
  const dH = (Math.abs(sep) / 2 + CAM.bodyHalf + CAM.margin) / (aspect * t);
  const lo = vfovDeg === CAM.vfov ? CAM.dMin : dV;
  const hi = vfovDeg === CAM.vfov ? CAM.dMax : CAM.dMax * (Math.tan(CAM.vfov * DEG / 2) / t);
  return Math.min(hi, Math.max(lo, Math.max(dV, dH)));
}

/** the widened vFOV (deg) that keeps the framing at the look point when the camera moves from `d0` to `d1` m away */
function widen(fovDeg: number, d0: number, d1: number): number {
  if (!(d1 > 1e-3) || d1 >= d0) return fovDeg;
  const t = Math.tan(fovDeg * DEG / 2) * (d0 / d1);
  return Math.min(CAM.fovMax, Math.max(fovDeg, 2 * Math.atan(t) / DEG));
}

export class FightCamera {
  readonly camera: THREE.PerspectiveCamera;
  variant: 'versus' | 'brawl' = 'versus';
  trauma = 0;
  shakeScale = 1;
  /** CHANGED(fixer) D4: fraction of the frame height covered by the top HUD band (0 = unknown -> CAM.topMargin) */
  safeTop = 0;
  /** CHANGED(VIEW3D): the sim's camera normal for this frame (MatchSnap.camN; null = +Z, the 1D labs) */
  camN: [number, number] | null = null;
  /** CHANGED(VIEW3D): the ring (occlusion); null = no correction */
  ring: RingGeom | null = null;
  /** CHANGED(VIEW3D) BRAWL: extra world points to frame with the player (goons in reach) as [x, z] */
  readonly extra: Array<[number, number]> = [];
  /** CHANGED(VIEW3D) BRAWL: the player's planar forward [x, z] (from the snapshot yaw) - which side "behind" is */
  fwd0: [number, number] | null = null;
  /** smoothed rig state */
  dist = CAM.dMin;
  midX = 0;
  midZ = 0;
  lookY = CAM.lookY;
  /** smoothed camera azimuth (radians, yaw convention: the camera sits along (sin yaw, cos yaw) from the midpoint) */
  yaw = 0;
  /** CHANGED(VIEW3D): the wall swing added to `yaw` for the rig (radians, eased) */
  swing = 0;
  private brawlOff: number = CAM.brawl.behindDeg;
  private shakeT = 0;
  private init = false;
  // overrides (sim frame of start; -1 = off)
  private parryAt = -1;
  private parryWho = 0;
  private superAt = -1;
  private superWho = 0;
  private superFrames = CAM.superFrames;
  private koAt = -1;
  private koLoser = 1;
  private koWinner = 0;
  private koMatch = false;
  private cine: CinePose | null = null;
  private wasCine = false;
  private readonly look = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly lf: Array<{ x: number; z: number; y: number; head: number }> = [{ x: 0, z: 0, y: 0, head: 1.8 }, { x: 0, z: 0, y: 0, head: 1.8 }];
  private readonly feet: Array<[number, number, number]> = [];
  /** last frame read-back (lab / harness) */
  readonly last = {
    dist: 0, midX: 0, lookY: 0, fov: 0, sep: 0, mode: 'rig', fill: 0, shake: 0,
    // CHANGED(VIEW3D)
    yawDeg: 0, yawTDeg: 0, midZ: 0, pos: [0, 0, 0] as number[], look: [0, 0, 0] as number[], raise: 0, pull: 0, clearPull: 0, occluded: 0, camR: 0, swingDeg: 0, brawlOffDeg: 0,
  };

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(CAM.vfov, aspect, 0.1, 120);
    this.camera.position.set(0, CAM.camY, CAM.dMin);
  }

  private vfov(): number { return this.variant === 'brawl' ? CAM.brawl.vfov : CAM.vfov; }

  /** the current screen-right R and camera normal N on the ground plane (the smoothed azimuth) */
  basis(): { rx: number; rz: number; nx: number; nz: number } {
    const a = this.yaw + this.swing;
    const nx = Math.sin(a), nz = Math.cos(a);
    return { rx: nz, rz: -nx, nx, nz };
  }

  reset(): void {
    this.init = false; this.trauma = 0; this.parryAt = -1; this.superAt = -1; this.koAt = -1; this.cine = null;
  }

  addTrauma(amount: number): void {
    if (amount > 0) this.trauma = Math.min(1, this.trauma + amount);
  }

  perfectParry(frame: number, who: number): void { this.parryAt = frame; this.parryWho = who; }
  superFreeze(frame: number, who: number, frames = CAM.superFrames): void { this.superAt = frame; this.superWho = who; this.superFrames = frames; }
  ko(frame: number, winner: number, loser: number, matchPoint: boolean): void {
    this.koAt = frame; this.koWinner = winner; this.koLoser = loser; this.koMatch = matchPoint;
  }
  clearKo(): void { this.koAt = -1; }
  /** a cinematic pose for this frame (null = back to the rig: a hard CUT, like SF) */
  setCinematic(p: CinePose | null): void { this.cine = p; }

  /** local camera frame (origin = the smoothed midpoint, x along R, z along N) -> world, in place */
  private toWorld(v: THREE.Vector3): THREE.Vector3 {
    const a = this.yaw + this.swing;
    const nx = Math.sin(a), nz = Math.cos(a);
    const x = v.x, z = v.z;
    return v.set(this.midX + nz * x + nx * z, v.y, this.midZ - nx * x + nz * z);
  }

  /** CHANGED(VIEW3D): the camera height a position outside the ring needs so its sight lines to `targets` clear the wall */
  private wallNeed(px: number, pz: number, targets: ReadonlyArray<[number, number, number]>): number {
    const g = this.ring;
    if (!g || ringGap(g, px, pz) >= 0.3) return 0;
    let h = CAM.bandLow;
    for (const t of targets) {
      const u = ringEntry(g, px, pz, t[0], t[2]);
      if (u > 0 && u < 0.999) h = Math.max(h, (g.wallH + CAM.wallClear - t[1] * u) / (1 - u));
    }
    return h;
  }

  /** CHANGED(VIEW3D) wall swing: the azimuth offset the rig should take (radians) for the smoothed mid / dist / yaw */
  private swingTarget(camY: number, targets: ReadonlyArray<[number, number, number]>): number {
    const g = this.ring;
    if (!g) return 0;
    const cost = (d: number): number => {
      const a = this.yaw + d;
      const px = this.midX + Math.sin(a) * this.dist, pz = this.midZ + Math.cos(a) * this.dist;
      const rr = Math.hypot(px - g.cx, pz - g.cz);
      let c = rr > g.clearR - 0.2 ? (rr - (g.clearR - 0.2)) * 2 : 0;
      const h = this.wallNeed(px, pz, targets);
      if (h > camY) c += h - camY;
      // a lens just over the wall top sees the coping lamps / rails huge in the foreground: keep 0.9 m off the wall line
      const gap = ringGap(g, px, pz);
      if (Math.abs(gap) < 0.9 && Math.max(camY, h) < g.wallH + 0.9) c += 0.5 * (0.9 - Math.abs(gap)) / 0.9;
      return c;
    };
    let best = 0, bc = cost(0);
    if (bc <= CAM.swingOkRaise) return 0;
    const pref = this.swing >= 0 ? 1 : -1;               // sign-sticky: no flip-flop between +d and -d
    for (let m = 10; m <= CAM.swingMaxDeg; m += 10) {
      const cp = cost(pref * m * DEG), cn = cost(-pref * m * DEG);
      const [c, d] = cp <= cn + 0.1 ? [cp, pref * m] : [cn, -pref * m];
      if (c < bc - 0.02) { bc = c; best = d * DEG; }
      if (c <= CAM.swingOkRaise) break;
    }
    return best;
  }

  /**
   * CHANGED(VIEW3D) occlusion: keep `pos` inside the stage's clear radius and its sight lines to `targets` over the ring
   * wall (raise, else pull in along the view line). Returns the vFOV that keeps the framing at `look`.
   */
  private constrain(pos: THREE.Vector3, look: THREE.Vector3, fov: number, targets: ReadonlyArray<[number, number, number]>, maxY: number): number {
    const g = this.ring;
    const L = this.last;
    L.raise = 0; L.pull = 0; L.clearPull = 0; L.occluded = 0;
    if (!g) return fov;
    let out = fov;
    const rad = (x: number, z: number) => Math.hypot(x - g.cx, z - g.cz);
    // (1) set geometry: planar radius <= clear radius - 0.2 (the look point is inside the ring, so a root exists on the ray)
    const lim = g.clearR - 0.2;
    if (rad(pos.x, pos.z) > lim) {
      const dx = pos.x - look.x, dz = pos.z - look.z, ax = look.x - g.cx, az = look.z - g.cz;
      const A = dx * dx + dz * dz, B = 2 * (ax * dx + az * dz), C = ax * ax + az * az - lim * lim;
      const disc = B * B - 4 * A * C;
      if (A > 1e-9 && disc >= 0) {
        const u = Math.max(0.05, Math.min(1, (-B + Math.sqrt(disc)) / (2 * A)));
        const d0 = pos.distanceTo(look);
        pos.set(look.x + dx * u, look.y + (pos.y - look.y) * u, look.z + dz * u);
        out = widen(out, d0, pos.distanceTo(look));
        L.clearPull = Math.round((1 - u) * d0 * 1000) / 1000;
      }
    }
    // (2) the ring wall: outside the inner face (+0.3 m) the camera stays in the clear band and sees the feet over the wall
    if (ringGap(g, pos.x, pos.z) < 0.3) {
      const need = (): number => Math.max(CAM.bandLow, this.wallNeed(pos.x, pos.z, targets));
      let h = need();
      if (h > pos.y) {
        if (h <= maxY) { L.raise = Math.round((h - pos.y) * 1000) / 1000; pos.y = h; }
        else {
          // raise to the band top, then pull in along the view line until the sight lines clear (or 2.4 m from the look)
          L.raise = Math.round(Math.max(0, maxY - pos.y) * 1000) / 1000;
          pos.y = Math.max(pos.y, maxY);
          const d0 = pos.distanceTo(look);
          const sx = pos.x, sy = pos.y, sz = pos.z;
          let u = 1;
          for (let k = 0; k < 24; k++) {
            u -= 0.04;
            pos.set(look.x + (sx - look.x) * u, sy, look.z + (sz - look.z) * u);
            if (pos.distanceTo(look) < 2.4) break;
            if (ringGap(g, pos.x, pos.z) >= 0.3) break;
            h = need();
            if (h <= pos.y) break;
          }
          const d1 = pos.distanceTo(look);
          out = widen(out, d0, d1);
          L.pull = Math.round((d0 - d1) * 1000) / 1000;
          if (ringGap(g, pos.x, pos.z) < 0.3 && need() > pos.y + 0.01) L.occluded = 1;
        }
      }
    }
    return out;
  }

  /**
   * @param dt      real seconds since the last rendered frame
   * @param f       the two fighters (world metres; z optional)
   * @param frame   the sim frame (MatchSnap.frame) - override timing is in sim frames
   * @param timeScale 1, or 0.25 in the KO slow-mo (the shake clock follows it)
   */
  update(dt: number, f: [CamFighter, CamFighter], aspect: number, frame: number, timeScale = 1): void {
    const cam = this.camera;
    let fov = this.vfov();
    const brawl = this.variant === 'brawl';
    const x0 = f[0].x, z0 = f[0].z ?? 0, x1 = f[1].x, z1 = f[1].z ?? 0;
    const sep = Math.hypot(x1 - x0, z1 - z0);
    // the sim's camera normal -> target azimuth (continuity is the sim's; the view only eases it)
    const cn = this.camN;
    const yawT = cn && Number.isFinite(cn[0]) && Number.isFinite(cn[1]) && (cn[0] !== 0 || cn[1] !== 0) ? Math.atan2(cn[0], cn[1]) : 0;
    let midXT = (x0 + x1) / 2, midZT = (z0 + z1) / 2;
    let dT = distanceFor(sep, aspect, fov);
    let yawAim = yawT;
    if (brawl) {
      // behind / above the player (fighter 0): the azimuth turned toward his back (-R side, P1 is screen-left), the look
      // point between the player and the goons in reach, the distance fit to every point projected into the frame
      const B = CAM.brawl;
      // the player's back is the screen side his forward points away from (R = (cos yawT, -sin yawT)); turning the camera
      // normal toward -s * R is a yaw change of -s * behindDeg
      const fw = this.fwd0;
      const s = fw ? (Math.sign(fw[0] * Math.cos(yawT) - fw[1] * Math.sin(yawT)) || 1) : 1;
      let cx = x0, cz = z0, n = 1;
      for (const [gx, gz] of this.extra) if (Math.hypot(gx - x0, gz - z0) < B.reach) { cx += gx; cz += gz; n++; }
      cx /= n; cz /= n;
      midXT = x0 + (cx - x0) * 0.55; midZT = z0 + (cz - z0) * 0.55;
      // a goon standing between the lens and the player hides him: of a few azimuths around "behind" (20 deg) take the one
      // whose sight line to the player passes no goon nearer than 0.65 m (penalty by how close), preferring 20 deg
      let bestOff = B.behindDeg, bestCost = Infinity;
      for (const off of [B.behindDeg, B.behindDeg + 18, B.behindDeg - 18, B.behindDeg + 36, B.behindDeg - 36]) {
        const a = yawT - s * off * DEG;
        const camX = midXT + Math.sin(a) * 5.5, camZ = midZT + Math.cos(a) * 5.5;
        const vx = x0 - camX, vz = z0 - camZ, vl = Math.hypot(vx, vz) || 1;
        let c = Math.abs(off - B.behindDeg) * 0.004 - (off === this.brawlOff ? 0.05 : 0);
        for (const [gx, gz] of this.extra) {
          const t = ((gx - camX) * vx + (gz - camZ) * vz) / (vl * vl);
          if (t <= 0.05 || t >= 0.97) continue;            // behind the player or behind the lens
          const px = camX + vx * t - gx, pz = camZ + vz * t - gz;
          const dd = Math.hypot(px, pz);
          if (dd < 0.65) c += (0.65 - dd) * 2;
        }
        if (c < bestCost - 1e-6) { bestCost = c; bestOff = off; }
      }
      this.brawlOff = bestOff;
      this.last.brawlOffDeg = bestOff;
      yawAim = yawT - s * bestOff * DEG;
      const nx = Math.sin(yawAim), nz = Math.cos(yawAim), rx = nz, rz = -nx;
      const th = Math.tan(fov * DEG / 2) * aspect;
      let need = B.dMin;
      const pts: Array<[number, number]> = [[x0, z0]];
      for (const [gx, gz] of this.extra) if (Math.hypot(gx - x0, gz - z0) < B.reach) pts.push([gx, gz]);
      for (const [px, pz] of pts) {
        const lx = (px - midXT) * rx + (pz - midZT) * rz, lz = (px - midXT) * nx + (pz - midZT) * nz;
        need = Math.max(need, lz + (Math.abs(lx) + 0.7) / th);
      }
      dT = Math.min(B.dMax, need);
    }
    const baseLook = brawl ? CAM.brawl.lookY : CAM.lookY;
    const baseCamY = brawl ? CAM.brawl.camY : CAM.camY;
    // jump pan: keep the higher fighter's top (head, or raised hands) below the HUD band while the lower fighter's feet
    // stay inside the bottom 4 %. Pan first (research 7b: jumps pan, they do not zoom); only when top-to-feet no longer
    // fits the frame at this distance (a full-apex jump at point-blank range) does the camera ease out.
    // CHANGED(fixer) D4: the top line is the HUD's measured bottom edge (`safeTop`), the pan is solved with the camera's real
    // pitch, and the pan UP is a hard floor on the smoothed look height; only the settle back down is eased.
    const top = Math.max(f[0].head, f[1].head);
    const feet = Math.min(f[0].y, f[1].y);
    const delta = baseCamY - baseLook;                      // camera height above the look-at point (constant pitch rig)
    const safeTop = this.safeTop > 0 ? Math.min(0.4, this.safeTop + CAM.safePad) : CAM.topMargin;
    const panFloor = (d: number): number => lookFloorFor(top, d, fov, delta, safeTop);
    const panCeil = (d: number): number => lookCeilFor(feet, d, fov, delta, CAM.bottomMargin);
    if (!brawl) for (let k = 0; k < 24 && panFloor(dT) > panCeil(dT) && dT < CAM.dMax * 1.25; k++) dT = Math.min(CAM.dMax * 1.25, dT * 1.04);
    const lookYT = brawl ? baseLook : Math.max(baseLook, Math.min(panFloor(dT), panCeil(dT)));
    const snap = !this.init || (this.wasCine && !this.cine);
    if (snap) {
      this.dist = dT; this.midX = midXT; this.midZ = midZT; this.lookY = lookYT; this.yaw = yawAim; this.init = true;
    } else {
      this.dist += (dT - this.dist) * ease(dT > this.dist ? CAM.aOut : CAM.aIn, dt);
      const kx = ease(CAM.aX, dt);
      this.midX += (midXT - this.midX) * kx;
      this.midZ += (midZT - this.midZ) * kx;
      this.lookY += (lookYT - this.lookY) * ease(CAM.aY, dt);
      this.yaw += wrapPi(yawAim - this.yaw) * ease(CAM.aYaw, dt);
      // the airborne fighter's head never slips under the HUD while the smoothing catches up (at the ACTUAL distance).
      if (!brawl) { const floorNow = panFloor(this.dist); if (this.lookY < floorNow) this.lookY = floorNow; }
    }
    this.wasCine = !!this.cine;
    // wall swing (versus rig): the smallest azimuth offset whose sight lines clear the ring wall without a steep raise
    if (!brawl && this.ring) {
      const ft = this.feet;
      ft.length = 0;
      ft.push([x0, 0.05, z0], [x1, 0.05, z1]);
      const sT = this.swingTarget(baseCamY + (this.lookY - baseLook), ft);
      this.swing = snap ? sT : this.swing + (sT - this.swing) * ease(CAM.aSwing, dt);
    } else this.swing = 0;
    // the fighters in the camera's local frame (x along R from the smoothed midpoint, z along N)
    const ya = this.yaw + this.swing;
    const nx = Math.sin(ya), nz = Math.cos(ya), rx = nz, rz = -nx;
    for (let i = 0; i < 2; i++) {
      const dx = f[i].x - this.midX, dz = (f[i].z ?? 0) - this.midZ;
      const q = this.lf[i];
      q.x = dx * rx + dz * rz; q.z = dx * nx + dz * nz; q.y = f[i].y; q.head = f[i].head;
    }
    // rig pose (local)
    this.look.set(0, this.lookY, 0);
    this.pos.set(0, baseCamY + (this.lookY - baseLook), this.dist);
    let fovNow = fov;
    let roll = 0;
    let mode = 'rig';
    let shakeOk = true;
    let local = true;

    if (this.cine) {
      this.pos.copy(this.cine.pos); this.look.copy(this.cine.look); fovNow = this.cine.fov; roll = this.cine.roll; mode = 'cinematic';
      local = false;
    } else if (this.koAt >= 0) {
      const t = frame - this.koAt;
      const lf = this.lf;
      const loser = lf[this.koLoser] ?? lf[1], winner = lf[this.koWinner] ?? lf[0];
      // orbit across the slow-mo window that follows the KO hitstop; a small push-in during the hitstop itself
      const w = smooth01((t - CAM.koHitstopFrames) / CAM.koSlowFrames);
      const push = smooth01(t / 8) * 0.06;
      const dir = Math.sign(loser.x - winner.x) || 1;
      const focusX = (loser.x) * 0.6 * w;
      const dist = this.dist * (1 - push - 0.15 * w);
      const focusY = this.lookY;
      const holdAt = CAM.koHitstopFrames + CAM.koSlowFrames;
      this.look.set(focusX, focusY, 0);
      const ang = CAM.koOrbitDeg * DEG * w * dir;
      this.pos.set(focusX + Math.sin(ang) * dist, this.pos.y, Math.cos(ang) * dist);
      if (this.koMatch && t > holdAt) {
        // P2 finish hold: a LOW hero shot on the winner from the side away from the loser. The camera sits at 0.62 m and
        // looks up at the chest, so the frame's bottom ray stays above ~0.5 m for 10 m: the loser lying on the floor behind
        // the winner is out of frame.
        const h = smooth01((t - holdAt) / 22);
        const hx = winner.x - dir * 1.05, hz = winner.z + 2.55;
        this.tmpA.set(winner.x + dir * 0.12, Math.max(1.3, (winner.head ?? 1.8) * 0.74), winner.z);
        this.tmpB.set(hx, 0.62, hz);
        this.look.lerp(this.tmpA, h);
        this.pos.lerp(this.tmpB, h);
        fovNow = fov + (33 - fov) * h;
        roll = -dir * 1.5 * DEG * h;
      }
      mode = 'ko';
    } else if (this.superAt >= 0 && frame - this.superAt < this.superFrames + 12) {
      const t = frame - this.superAt;
      const inW = smooth01(t / 6), outW = 1 - smooth01((t - this.superFrames) / 12);
      const w = Math.min(inW, outW);
      const who = this.lf[this.superWho] ?? this.lf[0];
      const other = this.lf[1 - this.superWho] ?? this.lf[1];
      const face = Math.sign(other.x - who.x) || 1;
      this.tmpA.set(who.x + face * 0.25, 1.2 + Math.max(0, who.y), who.z);
      this.tmpB.set(who.x + face * 1.1, 1.38 + Math.max(0, who.y), who.z + 2.7);
      this.look.lerp(this.tmpA, w);
      this.pos.lerp(this.tmpB, w);
      fovNow = fov + (30 - fov) * w;
      roll = -face * 2.5 * DEG * w;
      mode = 'super';
    } else if (this.parryAt >= 0 && frame - this.parryAt < CAM.parryFrames + 10) {
      const t = frame - this.parryAt;
      const w = Math.min(smooth01(t / 4), 1 - smooth01((t - CAM.parryFrames) / 10));
      const who = this.lf[this.parryWho] ?? this.lf[0];
      this.tmpA.set(who.x * 0.4, this.lookY + 0.1, who.z * 0.4);
      this.tmpB.set(this.tmpA.x, this.pos.y + 0.05, this.dist * 0.8);
      this.look.lerp(this.tmpA, w);
      this.pos.lerp(this.tmpB, w);
      fovNow = fov - 3 * w;
      shakeOk = t >= CAM.parryFrames;                     // zero shake inside the freeze (the read matters more)
      mode = 'parry';
    }
    if (local) { this.toWorld(this.look); this.toWorld(this.pos); }
    // occlusion (the fighters' feet are the sight-line targets; a `free` lab pose is left alone)
    if (!this.cine || !this.cine.free) {
      const ft = this.feet;
      ft.length = 0;
      ft.push([x0, 0.05, z0], [x1, 0.05, z1]);
      if (brawl) for (const [gx, gz] of this.extra) if (Math.hypot(gx - x0, gz - z0) < CAM.brawl.reach) ft.push([gx, 0.05, gz]);
      if (this.cine) ft.push([this.look.x, Math.max(0.05, this.look.y - 0.8), this.look.z]);
      fovNow = this.constrain(this.pos, this.look, fovNow, ft, this.cine ? 3.4 : CAM.maxY);
      if (this.pos.y < 0.12) this.pos.y = 0.12;
    } else { const L = this.last; L.raise = 0; L.pull = 0; L.clearPull = 0; L.occluded = 0; }
    fov = fovNow;
    if (cam.fov !== fovNow || cam.aspect !== aspect) { cam.fov = fovNow; cam.aspect = aspect; cam.updateProjectionMatrix(); }
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (roll) cam.rotateZ(roll);

    // rotational trauma shake
    let amount = 0;
    if (this.trauma > 0) {
      amount = shakeOk ? this.trauma * this.trauma * Math.max(0, Math.min(1, this.shakeScale)) : 0;
      const sdt = dt * timeScale;
      this.shakeT += sdt;
      if (amount > 1e-4) {
        const t = this.shakeT, q = CAM.freq;
        const n1 = Math.sin(t * q[0]) * 0.62 + Math.sin(t * q[3] + 1.9) * 0.38;
        const n2 = Math.sin(t * q[1] + 0.7) * 0.62 + Math.sin(t * q[4] + 2.6) * 0.38;
        const n3 = Math.sin(t * q[2] + 1.3) * 0.62 + Math.sin(t * q[5] + 0.4) * 0.38;
        cam.rotateY(n1 * CAM.maxYawDeg * DEG * amount);
        cam.rotateX(n2 * CAM.maxPitchDeg * DEG * amount);
        cam.rotateZ(n3 * CAM.maxRollDeg * DEG * amount);
      }
      if (shakeOk) this.trauma = Math.max(0, this.trauma - CAM.decay * sdt);
    }
    cam.updateMatrixWorld();
    const L = this.last;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    L.dist = this.pos.distanceTo(this.look); L.midX = this.midX; L.lookY = this.lookY; L.fov = fovNow; L.sep = sep;
    L.mode = mode; L.fill = 1.8 / (2 * this.dist * Math.tan(fov * DEG / 2)); L.shake = amount;
    L.yawDeg = r3((((this.yaw + this.swing) / DEG) % 360 + 360) % 360); L.yawTDeg = r3(((yawT / DEG) % 360 + 360) % 360); L.midZ = this.midZ;
    L.swingDeg = r3(this.swing / DEG);
    L.pos = [r3(this.pos.x), r3(this.pos.y), r3(this.pos.z)]; L.look = [r3(this.look.x), r3(this.look.y), r3(this.look.z)];
    L.camR = this.ring ? r3(Math.hypot(this.pos.x - this.ring.cx, this.pos.z - this.ring.cz)) : 0;
  }

  /** world -> screen uv (0..1, y up) for FX anchored on a world point */
  toScreen(p: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    this.tmpA.copy(p).project(this.camera);
    return out.set(this.tmpA.x * 0.5 + 0.5, this.tmpA.y * 0.5 + 0.5);
  }
}
