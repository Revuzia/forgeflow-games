// HIT PARADE - the side-on fighting camera (CONTRACT §7; numbers FIGHTING_DESIGN §7b/§7c, DESIGN_RESEARCH §5c).
//
// Rig (versus): vertical FOV 35 deg; camera on +Z looking at the fight plane z = 0; look-at = the fighters' mid-X at
// y 1.0 m; camera height 1.25 m (pitch -1.9 .. -3.3 deg over the distance range); distance =
//   max(vertical floor, horizontal need) clamped 4.36 .. 7.6 m, where
//   vertical floor  = ((1.8 + 0.45) / 2 + 0.25) / tan(vFOV/2)            = 4.36 m at 35 deg
//   horizontal need = (s/2 + 0.35 body + 0.9 margin) / (aspect * tan(vFOV/2))   (s = separation)
// which reproduces the research table (16:9: s 1.8 -> 4.36, 3 -> 4.91, 4 -> 5.80, 6 -> 7.58 m); a phone's wider aspect
// frames tighter by itself. Jumps PAN (look-at and camera rise together so the higher fighter's top stays below the HUD
// band - `safeTop`, CHANGED(fixer) D4 - or the top 12 % without a HUD); they zoom only when top-to-feet cannot fit. The set walls at x = +-8 m stay at the screen edge (mid-X clamp).
// Smoothing: asymmetric asymptotic averaging, frame-rate independent: alpha = 1 - (1 - a)^(dt*60); distance a = 0.15
// zooming OUT, 0.04 zooming IN (fast out / slow in); mid-X 0.2; look-Y 0.12.
// Shake (Eiserloh, research §5a/§5c): ROTATIONAL only, trauma 0..1, +0.10 light / +0.20 heavy / +0.35 IMPACT or punish
// counter / +0.5 KO, linear decay 1.6/s, shake = trauma^2, max yaw/pitch 2.5 deg, roll 4 deg, smooth incommensurate
// noise at 12-18 Hz; the shake clock runs at the slow-mo rate; ZERO shake during a perfect-parry freeze.
// Overrides (priority high -> low): cinematic pose (view/cinematics.ts) > KO orbit (25 deg toward the loser, zoom in;
// match point adds a 60-frame hold on the winner) > super-freeze punch-in > perfect-parry zoom freeze (60 f) > rig.
// BRAWL variant (bonus rounds): vFOV 45, lower (camera 1.0 m, look-at 0.95 m) and closer (x 0.85).

import * as THREE from 'three';

const DEG = Math.PI / 180;

export const CAM = {
  vfov: 35,
  camY: 1.25,
  lookY: 1.0,
  dMin: 4.36,
  dMax: 7.6,
  bodyHalf: 0.35,
  margin: 0.9,
  wallX: 8.0,
  /** metres of set wall kept visible past each wall when clamped */
  wallShow: 0.4,
  /** head must stay below the top 12 % of the frame (when no HUD safe area was given, see FightCamera.safeTop) */
  topMargin: 0.12,
  /** CHANGED(fixer) D4: clearance under the HUD band (fraction of the frame height) */
  safePad: 0.015,
  /** ... and the lower fighter's feet above the bottom 4 % */
  bottomMargin: 0.04,
  aOut: 0.15, aIn: 0.04, aX: 0.2, aY: 0.12,
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
  brawl: { vfov: 45, camY: 1.0, lookY: 0.95, closer: 0.85 },
};

export interface CamFighter { x: number; y: number; /** head height (m, world) */ head: number }

export interface CinePose { pos: THREE.Vector3; look: THREE.Vector3; fov: number; roll: number }

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

/** CONTRACT §7b distance for a separation (m) at an aspect (w/h) and vFOV (deg) */
export function distanceFor(sep: number, aspect: number, vfovDeg = CAM.vfov): number {
  const t = Math.tan(vfovDeg * DEG / 2);
  const dV = ((1.8 + 0.45) / 2 + 0.25) / t;
  const dH = (Math.abs(sep) / 2 + CAM.bodyHalf + CAM.margin) / (aspect * t);
  const lo = vfovDeg === CAM.vfov ? CAM.dMin : dV;
  const hi = vfovDeg === CAM.vfov ? CAM.dMax : CAM.dMax * (Math.tan(CAM.vfov * DEG / 2) / t);
  return Math.min(hi, Math.max(lo, Math.max(dV, dH)));
}

export class FightCamera {
  readonly camera: THREE.PerspectiveCamera;
  variant: 'versus' | 'brawl' = 'versus';
  trauma = 0;
  shakeScale = 1;
  /** CHANGED(fixer) D4: fraction of the frame height covered by the top HUD band (0 = unknown -> CAM.topMargin) */
  safeTop = 0;
  /** smoothed rig state */
  dist = CAM.dMin;
  midX = 0;
  lookY = CAM.lookY;
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
  /** last frame read-back (lab / harness) */
  readonly last = { dist: 0, midX: 0, lookY: 0, fov: 0, sep: 0, mode: 'rig', fill: 0, shake: 0 };

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(CAM.vfov, aspect, 0.1, 120);
    this.camera.position.set(0, CAM.camY, CAM.dMin);
  }

  private vfov(): number { return this.variant === 'brawl' ? CAM.brawl.vfov : CAM.vfov; }

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

  /**
   * @param dt      real seconds since the last rendered frame
   * @param f       the two fighters (world metres)
   * @param frame   the sim frame (MatchSnap.frame) - override timing is in sim frames
   * @param timeScale 1, or 0.25 in the KO slow-mo (the shake clock follows it)
   */
  update(dt: number, f: [CamFighter, CamFighter], aspect: number, frame: number, timeScale = 1): void {
    const cam = this.camera;
    const fov = this.vfov();
    const brawl = this.variant === 'brawl';
    const sep = Math.abs(f[1].x - f[0].x);
    let dT = distanceFor(sep, aspect, fov);
    if (brawl) dT *= CAM.brawl.closer;
    const baseLook = brawl ? CAM.brawl.lookY : CAM.lookY;
    const baseCamY = brawl ? CAM.brawl.camY : CAM.camY;
    // jump pan: keep the higher fighter's top (head, or raised hands) below the HUD band while the lower fighter's feet
    // stay inside the bottom 4 %. Pan first (research 7b: jumps pan, they do not zoom); only when top-to-feet no longer
    // fits the frame at this distance (a full-apex jump at point-blank range) does the camera ease out.
    // CHANGED(fixer) D4: the top line is the HUD's measured bottom edge (`safeTop`, from game.ts; was a fixed 12 % while the
    // bars + NERVE strip cover ~17 % at 16:9, so an apex jump put the jumper's head behind the P1 bar), the pan is solved
    // with the camera's real pitch, and the pan UP is a hard floor on the smoothed look height (a 0.12 ease used to lag
    // the rising head by ~0.3 m at the apex); only the settle back down is eased.
    const top = Math.max(f[0].head, f[1].head);
    const feet = Math.min(f[0].y, f[1].y);
    const delta = baseCamY - baseLook;                      // camera height above the look-at point (constant pitch rig)
    const safeTop = this.safeTop > 0 ? Math.min(0.4, this.safeTop + CAM.safePad) : CAM.topMargin;
    const panFloor = (d: number): number => lookFloorFor(top, d, fov, delta, safeTop);
    const panCeil = (d: number): number => lookCeilFor(feet, d, fov, delta, CAM.bottomMargin);
    for (let k = 0; k < 24 && panFloor(dT) > panCeil(dT) && dT < CAM.dMax * 1.25; k++) dT = Math.min(CAM.dMax * 1.25, dT * 1.04);
    const lookYT = Math.max(baseLook, Math.min(panFloor(dT), panCeil(dT)));
    // wall clamp
    let midT = (f[0].x + f[1].x) / 2;
    const halfW = dT * Math.tan(fov * DEG / 2) * aspect;
    const lim = CAM.wallX + CAM.wallShow - halfW;
    if (lim > 0) midT = Math.max(-lim, Math.min(lim, midT)); else midT = 0;
    if (!this.init || this.wasCine && !this.cine) {
      this.dist = dT; this.midX = midT; this.lookY = lookYT; this.init = true;
    } else {
      this.dist += (dT - this.dist) * ease(dT > this.dist ? CAM.aOut : CAM.aIn, dt);
      this.midX += (midT - this.midX) * ease(CAM.aX, dt);
      this.lookY += (lookYT - this.lookY) * ease(CAM.aY, dt);
      // the airborne fighter's head never slips under the HUD while the smoothing catches up (at the ACTUAL distance).
      // Head beats feet here: while the zoom-out is still catching up, the grounded fighter's feet may dip under the
      // bottom margin for a few frames; the jumper (what the other player must read to anti-air) stays in full view.
      const floorNow = panFloor(this.dist);
      if (this.lookY < floorNow) this.lookY = floorNow;
    }
    this.wasCine = !!this.cine;
    // rig pose
    this.look.set(this.midX, this.lookY, 0);
    this.pos.set(this.midX, baseCamY + (this.lookY - baseLook), this.dist);
    let fovNow = fov;
    let roll = 0;
    let mode = 'rig';
    let shakeOk = true;

    if (this.cine) {
      this.pos.copy(this.cine.pos); this.look.copy(this.cine.look); fovNow = this.cine.fov; roll = this.cine.roll; mode = 'cinematic';
    } else if (this.koAt >= 0) {
      const t = frame - this.koAt;
      const loser = f[this.koLoser] ?? f[1], winner = f[this.koWinner] ?? f[0];
      // orbit across the slow-mo window that follows the KO hitstop; a small push-in during the hitstop itself
      const w = smooth01((t - CAM.koHitstopFrames) / CAM.koSlowFrames);
      const push = smooth01(t / 8) * 0.06;
      const dir = Math.sign(loser.x - winner.x) || 1;
      let focusX = this.midX + (loser.x - this.midX) * 0.6 * w;
      let dist = this.dist * (1 - push - 0.15 * w);
      let focusY = this.lookY;
      const holdAt = CAM.koHitstopFrames + CAM.koSlowFrames;
      if (this.koMatch && t > holdAt) {                   // finish: hold on the winner
        const h = smooth01((t - holdAt) / 20);
        focusX += (winner.x - focusX) * h;
        dist += (3.6 - dist) * h;
        focusY += (1.15 - focusY) * h;
      }
      this.look.set(focusX, focusY, 0);
      const ang = CAM.koOrbitDeg * DEG * w * dir;
      this.pos.set(focusX + Math.sin(ang) * dist, this.pos.y, Math.cos(ang) * dist);
      mode = 'ko';
    } else if (this.superAt >= 0 && frame - this.superAt < this.superFrames + 12) {
      const t = frame - this.superAt;
      const inW = smooth01(t / 6), outW = 1 - smooth01((t - this.superFrames) / 12);
      const w = Math.min(inW, outW);
      const who = f[this.superWho] ?? f[0];
      const other = f[1 - this.superWho] ?? f[1];
      const face = Math.sign(other.x - who.x) || 1;
      this.tmpA.set(who.x + face * 0.25, 1.2 + Math.max(0, who.y), 0);
      this.tmpB.set(who.x + face * 1.1, 1.38 + Math.max(0, who.y), 2.7);
      this.look.lerp(this.tmpA, w);
      this.pos.lerp(this.tmpB, w);
      fovNow = fov + (30 - fov) * w;
      roll = -face * 2.5 * DEG * w;
      mode = 'super';
    } else if (this.parryAt >= 0 && frame - this.parryAt < CAM.parryFrames + 10) {
      const t = frame - this.parryAt;
      const w = Math.min(smooth01(t / 4), 1 - smooth01((t - CAM.parryFrames) / 10));
      const who = f[this.parryWho] ?? f[0];
      this.tmpA.set(this.midX + (who.x - this.midX) * 0.4, this.lookY + 0.1, 0);
      this.tmpB.set(this.tmpA.x, this.pos.y + 0.05, this.dist * 0.8);
      this.look.lerp(this.tmpA, w);
      this.pos.lerp(this.tmpB, w);
      fovNow = fov - 3 * w;
      shakeOk = t >= CAM.parryFrames;                     // zero shake inside the freeze (the read matters more)
      mode = 'parry';
    }
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
    L.dist = this.pos.distanceTo(this.look); L.midX = this.midX; L.lookY = this.lookY; L.fov = fovNow; L.sep = sep;
    L.mode = mode; L.fill = 1.8 / (2 * this.dist * Math.tan(fov * DEG / 2)); L.shake = amount;
  }

  /** world -> screen uv (0..1, y up) for FX anchored on a world point */
  toScreen(p: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    this.tmpA.copy(p).project(this.camera);
    return out.set(this.tmpA.x * 0.5 + 0.5, this.tmpA.y * 0.5 + 0.5);
  }
}
