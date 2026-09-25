// BLOCKTOOTH — camera rig (CONTRACT.md §4 + the 2026-09-24 GROW-INTO-THE-FRAME framing). render-core lane.
//
//   k      = 2·tan(fov/2), fov = 30°
//   D*     = frameDistance(w)  (config.ts FRAMING — this file only springs toward it):
//            ONE run-long curve, ln D*(H) = ln D1 + k1·x + c·x² with x = ln(H/h1): a power law whose
//            log-log slope eases from 0.573 at LV 1 (D1 ≈ 34 m) to ≈ 0.86 at Size V (≈ 560–617 m) and
//            stays < 1, so the body's share of the view, H / (D*·k), RISES with every level and every
//            MASS BREACH and the camera never moves in as the titan grows (no per-rank reset). While a boss
//            is alive the director widens it just enough for the boss rig + every live boss telegraph
//            + the titan (config bossFrameNeed, held + released smoothly, never below the curve, ≤ 2×
//            it) and, when the fight is lopsided, slides the look target toward the fight's centre
//            (frameOffset, eased by the director at 3.5/s and smoothed here at 5/s).
//            The SIM's spawn ring reads the same frameDistance (zoom excluded — deterministic).
//   D      ← critically-damped spring toward D*, ω = 4/s (solved in closed form per frame, so a
//            long frame cannot overshoot or explode)
//   zoom   : player zoom MULTIPLIER on D (wheel / = - / pad right stick; Z resets; reset on a new
//            run). log-space target, smoothed at CAMERA_ZOOM.omega; clamped to [min, max] and
//            to the absolute distance band [dAbsMin, dAbsMax] (perf / "the whole city fits").
//            View-only: the sim never reads it.
//   punch  : on rankUp, rendered D × (1 − 0.08·(1 − easeOutCubic(τ/1.2))), τ ∈ [0, 1.2] s
//   target = titanPos(interp) + lead + up·(H·0.45), lead → v·0.25 s smoothed at ω = 6/s
//   pitch  → RANKS[rank].pitchDeg (54° at every Size) at ω = 3/s; yaw fixed 45°
//   camPos = target + D·(cos p·sin yaw, sin p, cos p·cos yaw)
//   near/far = cameraClip(D)
//   shake  : trauma model — trauma ∈ [0,1] decays 1.6/s, displacement ∝ trauma² × titan height;
//            heavy footsteps, collapses (per tier), boss attacks, explosions, rank-ups add trauma.
//            Disabled when quality.screenShake is false. The contract constructor is
//            `new CameraRig(camera)`: the rig then reads the LIVE Quality that createRenderCore
//            stashes on `camera.userData.quality`, so the settings toggle works with no extra
//            wiring (an explicit 2nd ctor arg / `rig.quality` / `rig.shakeEnabled` also work).
//
// Update order in the app frame: rig.update(w, f) → lighting.update(w, rig) → views → render.

import type * as THREE from 'three';
import type { World, SimEvent, RankIndex } from '../core/types.ts';
import type { FrameInfo, Quality } from './viewtypes.ts';
import { CAMERA, CAMERA_ZOOM, RANKS, cameraClip, cameraDistance, frameDistance, frameOffset } from '../core/config.ts';
import { easeOutCubic } from '../core/math.ts';

const DEG = Math.PI / 180;
const K = 2 * Math.tan((CAMERA.fovDeg * DEG) / 2);
const YAW = CAMERA.yawDeg * DEG;
const SIN_YAW = Math.sin(YAW), COS_YAW = Math.cos(YAW);

/** smoothing rates (1/s) — CONTRACT §4 */
const LEAD_OMEGA = 6;
/** boss-framing look-target offset: smooths the sim's 30 Hz eased value and the release after a boss
 *  (config CAMERA.frameOffOmega — the director replicates it for the spawn ring) */
const FRAME_OFF_OMEGA = CAMERA.frameOffOmega;
const PITCH_OMEGA = 3;
/** trauma decay per second (linear), displacement = trauma² × SHAKE_MAX_H × H */
const TRAUMA_DECAY = 1.6;
const SHAKE_MAX_H = 0.16;
/** max roll (rad) at trauma 1 */
const SHAKE_MAX_ROLL = 0.018;
/** the lead never pushes the titan further than this fraction of the vertical view extent */
const LEAD_MAX_FRAC = 0.22;

// ─────────────────────────────── framing + zoom (constants live in core/config.ts) ───────────────────────────────
/** The AUTO distance is config.ts cameraDistance (FRAMING: one run-long curve of body height; the
 *  rig itself follows frameDistance = the curve widened for a live boss). Re-exported under the view
 *  lane's names for the harnesses. */
export const autoDistance = cameraDistance;
export { FRAMING, CAMERA_ZOOM, BOSS_FRAME, autoFrameFrac, framingCurve, framingTable, frameDistance, frameOffset } from '../core/config.ts';
export const ZOOM_MIN = CAMERA_ZOOM.min;
export const ZOOM_MAX = CAMERA_ZOOM.max;
export const D_ABS_MIN = CAMERA_ZOOM.dAbsMin;
export const D_ABS_MAX = CAMERA_ZOOM.dAbsMax;
const ZOOM_OMEGA = CAMERA_ZOOM.omega;

/** Trauma added per event (before distance attenuation). Metres-of-amplitude from CONTRACT §4
 *  ("heavy footstep adds H·0.02·heavy") are converted: trauma = metres / (SHAKE_MAX_H·H). */
const TR = {
  footstep: CAMERA.shakePerH / SHAKE_MAX_H,   // × heavy (0..1)   → ≈0.125 at Size V
  collapseBase: 0.10, collapsePerTier: 0.075, collapseRankRelief: 0.05,
  floorBreak: 0.025,
  bump: 0.14,
  explosion: 0.06, explosionPerExtent: 0.9,
  bossAttack: 0.32, bossStagger: 0.28, bossDefeated: 0.85, bossSpawn: 0.4,
  rankUp: 0.55,
  hurtBase: 0.08, hurtPerFrac: 1.4,
  vent: 0.3, wireDetonate: 0.22, ability: 0.12, pulse: 0.05,
} as const;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** optional live Quality (reads screenShake every frame) — the app passes core.quality */
  quality: Quality | null;
  /** hard switch for shake, ANDed with quality.screenShake */
  shakeEnabled = true;
  /** dev/probe: extra pitch (deg) on top of the framing table (0 in play) */
  pitchProbeDeg = 0;

  private d = 17.2;          // spring state (m) — the AUTO distance, zoom not applied
  private dv = 0;            // spring velocity (m/s)
  private dRender = 17.2;    // after zoom + punch (the actual camera distance)
  private zoomLog = 0;       // smoothed ln(zoom multiplier)
  private zoomLogT = 0;      // target ln(zoom multiplier)
  private pitch = RANKS[0].pitchDeg * DEG;
  private leadX = 0; private leadZ = 0;
  private offX = 0; private offZ = 0;   // boss-framing look-target offset (config frameOffset), smoothed
  private tx = 0; private ty = 0; private tz = 0;
  private punchT = -1;       // < 0 = inactive
  private trauma = 0;
  private shakeT = 0;
  private lastRank: RankIndex = 0;
  private readonly tgt = { x: 0, y: 0, z: 0 };

  constructor(camera: THREE.PerspectiveCamera, quality?: Quality) {
    this.camera = camera;
    this.quality = quality ?? null;
  }

  /** Current camera distance to the look target (m), including the player zoom and the rank-up
   *  punch — the ACTUAL distance every LOD / fog / shadow consumer must follow. */
  get distance(): number { return this.dRender; }

  /** The automatic (spring) distance before the player zoom and the punch (m). */
  get autoDist(): number { return this.d; }

  /** Current (smoothed) player zoom multiplier; > 1 = pulled back. */
  get zoom(): number { return Math.exp(this.zoomLog); }

  /** Target player zoom multiplier (where the smoothing is heading). */
  get zoomTarget(): number { return Math.exp(this.zoomLogT); }

  /** Zoom by a log step (+ = out / see more, − = in). Clamped to [ZOOM_MIN, ZOOM_MAX] and the
   *  absolute distance band. View-only. */
  zoomBy(dLog: number): void {
    if (!Number.isFinite(dLog) || dLog === 0) return;
    this.zoomLogT = this.clampZoomLog(this.zoomLogT + dLog, this.d);
  }

  /** Back to the automatic framing (the zoom eases home). */
  resetZoom(): void { this.zoomLogT = 0; }

  /** Current look target (world, m). The returned object is live — copy it if you keep it. */
  get target(): { x: number; y: number; z: number } {
    this.tgt.x = this.tx; this.tgt.y = this.ty; this.tgt.z = this.tz;
    return this.tgt;
  }

  /** Current vertical view extent at the target distance (m) = D·k. */
  get viewExtent(): number { return this.dRender * K; }

  /** Add trauma (0..1 scale; 1 = the biggest shake). Ignored when shake is disabled. */
  shake(amount: number): void {
    if (!(amount > 0) || !this.shakeOn()) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Snap everything to the titan's current state (run start, retry, teleport cheats). */
  reset(w: World): void {
    const T = w.titan;
    const H = Math.max(0.1, T.height);
    this.d = frameDistance(w);
    this.dv = 0;
    this.zoomLog = this.zoomLogT = 0;            // a new run starts at the automatic framing
    this.dRender = this.d;
    this.pitch = this.pitchFor(T.rank);
    this.leadX = 0; this.leadZ = 0;
    const fo = frameOffset(w);
    this.offX = fo.x; this.offZ = fo.z;
    this.tx = T.x + fo.x; this.tz = T.z + fo.z; this.ty = H * CAMERA.targetYFrac;
    this.punchT = -1;
    this.trauma = 0;
    this.lastRank = T.rank;
    this.apply(0, 0, 0, 0);
  }

  update(w: World, f: FrameInfo): void {
    const dt = Math.min(0.1, Math.max(0, f.dt));
    const T = w.titan;
    const H = Math.max(0.1, T.height);
    const rank = T.rank;

    // ── events: punch + trauma ──
    this.readEvents(w, f.events, H);
    if (rank !== this.lastRank) {
      // rank changed without us seeing the event (cheat.rank / frames dropped) — still punch
      if (rank > this.lastRank && this.punchT < 0) this.punchT = 0;
      this.lastRank = rank;
    }

    // ── distance: critically damped spring toward D*, exact solution over dt ──
    const dStar = frameDistance(w);
    const om = CAMERA.zoomOmega;
    if (dt > 0) {
      const x0 = this.d - dStar;
      const e = Math.exp(-om * dt);
      const c = this.dv + om * x0;
      this.d = dStar + (x0 + c * dt) * e;
      this.dv = (c - om * (x0 + c * dt)) * e;
    }
    if (!Number.isFinite(this.d) || this.d <= 0) { this.d = dStar; this.dv = 0; }

    let punch = 1;
    if (this.punchT >= 0) {
      this.punchT += dt;
      const tau = this.punchT / CAMERA.punchS;
      if (tau >= 1) this.punchT = -1;
      else punch = 1 - CAMERA.punchFrac * (1 - easeOutCubic(tau));
    }
    // ── player zoom: log-space, smoothed, re-clamped every frame (the band is absolute metres,
    //    so a rank-up can tighten the allowed multiplier) ──
    this.zoomLogT = this.clampZoomLog(this.zoomLogT, this.d);
    this.zoomLog += (this.zoomLogT - this.zoomLog) * (1 - Math.exp(-ZOOM_OMEGA * dt));
    if (Math.abs(this.zoomLogT - this.zoomLog) < 1e-4) this.zoomLog = this.zoomLogT;
    this.dRender = this.d * Math.exp(this.zoomLog) * punch;

    // ── look target: interpolated titan + smoothed velocity lead + height ──
    const a = f.alpha;
    const x = T.px + (T.x - T.px) * a;
    const z = T.pz + (T.z - T.pz) * a;
    let lx = T.vx * CAMERA.leadS, lz = T.vz * CAMERA.leadS;
    const lmax = LEAD_MAX_FRAC * this.dRender * K;
    const lm = Math.hypot(lx, lz);
    if (lm > lmax && lm > 0) { lx *= lmax / lm; lz *= lmax / lm; }
    const kl = 1 - Math.exp(-LEAD_OMEGA * dt);
    this.leadX += (lx - this.leadX) * kl;
    this.leadZ += (lz - this.leadZ) * kl;
    const fo = frameOffset(w);
    const ko = 1 - Math.exp(-FRAME_OFF_OMEGA * dt);
    this.offX += (fo.x - this.offX) * ko;
    this.offZ += (fo.z - this.offZ) * ko;
    this.tx = x + this.leadX + this.offX;
    this.tz = z + this.leadZ + this.offZ;
    this.ty = H * CAMERA.targetYFrac;

    // ── pitch ──
    const pTarget = this.pitchFor(rank);
    this.pitch += (pTarget - this.pitch) * (1 - Math.exp(-PITCH_OMEGA * dt));

    // ── shake ──
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    if (!this.shakeOn()) this.trauma = 0;
    const amp = this.trauma * this.trauma;
    let sx = 0, sy = 0, roll = 0;
    if (amp > 1e-5) {
      const t = this.shakeT;
      const m = amp * SHAKE_MAX_H * H;
      sx = m * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.3 + 1.7) * 0.4);
      sy = m * (Math.sin(t * 43.7 + 0.9) * 0.6 + Math.sin(t * 71.9 + 2.3) * 0.4);
      roll = amp * SHAKE_MAX_ROLL * (Math.sin(t * 29.3 + 0.4) * 0.7 + Math.sin(t * 53.1) * 0.3);
    }
    this.apply(sx, sy, roll, dt);
  }

  // ─────────────────────────────── internals ───────────────────────────────
  /** ln(zoom) limited to [ZOOM_MIN, ZOOM_MAX] and to D_ABS_MIN ≤ dAuto·zoom ≤ D_ABS_MAX. The auto
   *  framing itself is never pushed (at 1× the camera sits wherever the framing wants it). */
  private clampZoomLog(z: number, dAuto: number): number {
    const d = Math.max(1e-3, dAuto);
    const lo = Math.min(0, Math.max(Math.log(ZOOM_MIN), Math.log(D_ABS_MIN / d)));
    const hi = Math.max(0, Math.min(Math.log(ZOOM_MAX), Math.log(D_ABS_MAX / d)));
    return z < lo ? lo : z > hi ? hi : z;
  }

  /** target pitch (rad) for a rank: RANKS[rank].pitchDeg (+ the dev probe offset) */
  private pitchFor(rank: RankIndex): number {
    return (RANKS[rank].pitchDeg + this.pitchProbeDeg) * DEG;
  }

  private shakeOn(): boolean {
    if (!this.shakeEnabled) return false;
    const q = this.quality ?? (this.camera.userData.quality as Quality | undefined) ?? null;
    return q ? q.screenShake !== false : true;
  }

  private readEvents(w: World, ev: readonly SimEvent[], H: number): void {
    if (ev.length === 0) return;
    const ext = Math.max(1, this.dRender * K);
    const cx = this.tx, cz = this.tz;
    // distance attenuation: full within half a view extent, gone at 1.6 extents
    const att = (x: number, z: number) => {
      const d = Math.hypot(x - cx, z - cz) / ext;
      return d <= 0.5 ? 1 : d >= 1.6 ? 0 : 1 - (d - 0.5) / 1.1;
    };
    const rank = w.titan.rank;
    let add = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      switch (e.type) {
        case 'rankUp': this.punchT = 0; this.lastRank = e.rank; add += TR.rankUp; break;
        case 'footstep': add += TR.footstep * Math.max(0, Math.min(1, e.heavy)); break;
        case 'buildingCollapse': {
          const base = TR.collapseBase + TR.collapsePerTier * e.tier - TR.collapseRankRelief * rank;
          add += Math.max(0.03, base) * att(e.x, e.z);
          break;
        }
        case 'floorBreak': if (e.tier >= rank) add += TR.floorBreak * att(e.x, e.z); break;
        case 'bump': add += TR.bump; break;
        case 'explosion': add += Math.min(0.35, TR.explosion + TR.explosionPerExtent * (e.r / ext) * 0.3) * att(e.x, e.z); break;
        case 'bossAttack': add += TR.bossAttack * Math.max(0.35, att(e.x, e.z)); break;
        case 'bossStagger': add += TR.bossStagger; break;
        case 'bossDefeated': add += TR.bossDefeated; break;
        case 'bossSpawn': add += TR.bossSpawn; break;
        case 'titanHurt': {
          const frac = w.titan.maxHp > 0 ? e.dmg / w.titan.maxHp : 0;
          add += Math.min(0.4, TR.hurtBase + TR.hurtPerFrac * frac);
          break;
        }
        case 'vent': add += TR.vent * Math.min(1.5, 0.5 + e.power * 0.5); break;
        case 'wireDetonate': add += TR.wireDetonate; break;
        case 'ability': add += TR.ability; break;
        case 'pulse': add += TR.pulse; break;
        default: break;
      }
    }
    if (add > 0) this.shake(add);
    void H;
  }

  /** Place the camera from the rig state plus a shake offset in the view plane. */
  private apply(sx: number, sy: number, roll: number, _dt: number): void {
    const cam = this.camera;
    const D = this.dRender;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // camera offset direction from the target (unit): (cp·sinY, sp, cp·cosY)
    const ox = cp * SIN_YAW, oy = sp, oz = cp * COS_YAW;
    const px = this.tx + D * ox, py = this.ty + D * oy, pz = this.tz + D * oz;
    // view basis: right = (cosY, 0, −sinY); up = forward × right … (forward = −o)
    const rx = COS_YAW, rz = -SIN_YAW;
    // up vector of the camera (perpendicular to o and right): u = o × r
    const ux = oy * rz - oz * 0, uy = oz * rx - ox * rz, uz = ox * 0 - oy * rx;
    const offX = rx * sx + ux * sy, offY = uy * sy, offZ = rz * sx + uz * sy;
    cam.position.set(px + offX, py + offY, pz + offZ);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tx + offX, this.ty + offY, this.tz + offZ);
    if (roll !== 0) cam.rotateZ(roll);
    const clip = cameraClip(D);
    if (Math.abs(cam.near - clip.near) > 1e-4 * clip.near || Math.abs(cam.far - clip.far) > 1e-4 * clip.far) {
      cam.near = clip.near; cam.far = clip.far;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
