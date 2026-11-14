// BLOCKTOOTH — camera rig (CONTRACT.md §4 + the 2026-09-24 GROW-INTO-THE-FRAME framing). render-core lane.
//
//   k      = 2·tan(fov/2), fov = 30°
//   D*     = frameDistance(w)  (config.ts FRAMING — this file only springs toward it):
//            ONE run-long curve, ln D*(H) = ln D1 + k1·x + c·x² with x = ln(H/h1): a power law whose
//            log-log slope eases from 0.573 at LV 1 (D1 ≈ 34 m) to ≈ 0.86 at Size V (≈ 560–617 m) and
//            stays < 1, so the body's share of the view, H / (D*·k), RISES with every level and every
//            MASS BREACH and the camera never moves in as the titan grows (no per-rank reset). While a boss
//            is alive the director widens it just enough for the boss rig + every live boss telegraph
//            + the titan (config bossFrameNeed, never below the curve, ≤ 2× it) and, when the fight is
//            lopsided, slides the look target toward the fight's centre (frameOffset, eased by the
//            director at 3.5/s and smoothed here at 5/s). Both are HELD with hysteresis (config
//            stepFrameHold / BOSS_FRAME): widened at once, shrunk / panned home only after a hold with
//            no need for the extra width (3.5 s, growing by 4 s per interrupted shrink up to 20 s), then
//            slowly (≤ 2.5 % of D per second, eased in) — the view no longer pumps with every tell.
//            The SIM's spawn ring reads the same frameDistance (zoom excluded — deterministic).
//   D      ← critically-damped spring toward D*, ω = 4/s (solved in closed form per frame, so a
//            long frame cannot overshoot or explode); while a boss is alive it WIDENS at ω = 9/s
//            (CAMERA.widenOmega) and never goes under the boss HARD FLOOR (config bossFrameFloorAt: the
//            boss rig, every live tell and the titan inside |ndc| 0.95 around the look target the rig
//            actually has — refitted every frame, so a tell never leaves the frame, not even on the
//            frame it spawns). The floor also binds the drawn D through a punch at the default zoom.
//   zoom   : player zoom MULTIPLIER on D (wheel / = - / pad right stick; Z resets; reset on a new
//            run). log-space target, smoothed at CAMERA_ZOOM.omega; clamped to [min, max] and
//            to the absolute distance band [dAbsMin, dAbsMax] (perf / "the whole city fits").
//            View-only: the sim never reads it.
//   punch  : on rankUp, rendered D × (1 − 0.08·(1 − easeOutCubic(τ/1.2))), τ ∈ [0, 1.2] s;
//            punch(frac, s) (v2 UPROAR, FEATURES_V2 §3.6: 0.06 over 0.8 s) starts the same curve with its
//            own depth / length — the stronger of a live punch and a new one wins (never stacked)
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
// ONLINE VS (lane B-VIEW, VS mode only; solo is untouched): the rig follows the BOUND seat (World cursor = the view
// seat, or the spectated one) and frames rivals: `vsBias` slides the look target a little toward the rivals that are
// within VS_CAM.range view-extents, `vsWiden` multiplies the drawn distance just enough to hold every near rival (and
// the own titan) inside |ndc| VS_CAM.margin (widen fast, hold, shrink slowly: the view never pumps), capped at
// VS_CAM.maxWiden (a 5 m titan next to a 60 m one is covered by the HUD pips instead). `retarget()` glides the look
// target from the old followed seat to the new one (spectate / follow the killer) and swallows the rank-change punch.
//
// Update order in the app frame: rig.update(w, f) → lighting.update(w, rig) → views → render.

import type * as THREE from 'three';
import type { World, SimEvent, RankIndex } from '../core/types.ts';
import type { FrameInfo, Quality } from './viewtypes.ts';
import { CAMERA, CAMERA_ZOOM, RANKS, bossFrameFloorAt, bossFrameNeed, cameraClip, cameraDistance, frameDistance, frameOffset } from '../core/config.ts';
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

/** VS rival framing (see the header). range: rivals considered (view extents of the unwidened distance); margin: the
 *  |ndc| every considered titan must stay inside; widenOmega: 1/s rise; holdS: s before a shrink starts; shrinkOmega:
 *  1/s shrink; biasFrac: look-target slide toward the rivals' centre (fraction of the way), biasMax: cap (fraction of
 *  the view extent), glideOmega: 1/s of the spectate glide */
const VS_CAM = { range: 3.2, margin: 0.8, maxWiden: 2.4, widenOmega: 5, holdS: 2.0, shrinkOmega: 0.55, biasFrac: 0.3, biasMax: 0.14, biasOmega: 3, glideOmega: 4 } as const;

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
  // TITAN PASS (BRIARWICK POP-UP PARK): one micro-kick per pod burst, only for chain links 0..podLinkCap, so a
  // 16-28-pod cascade ripples instead of saturating trauma (its 'seed' explosions add no trauma of their own)
  podLink: 0.04, podLinkCap: 8,
  // GATEKEEPERS (lane K2a): stagger × 0.6 (§6.7), the arrival / kill / lock / finale beats (the kill's MASS BREACH
  // rankUp adds its own punch + rankUp trauma on the same tick, so the kill itself stays modest)
  gateStaggerK: 0.6, gateSpawn: 0.2, gateDefeated: 0.4, gateLocked: 0.1, finale: 0.35,
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
  private floorD = 0;        // boss hard floor this frame (m; 0 = none) — config bossFrameFloorAt
  private zoomLog = 0;       // smoothed ln(zoom multiplier)
  private zoomLogT = 0;      // target ln(zoom multiplier)
  private pitch = RANKS[0].pitchDeg * DEG;
  private leadX = 0; private leadZ = 0;
  private offX = 0; private offZ = 0;   // boss-framing look-target offset (config frameOffset), smoothed
  private tx = 0; private ty = 0; private tz = 0;
  private punchT = -1;       // < 0 = inactive
  private punchK: number = CAMERA.punchFrac;   // depth of the live punch (fraction of D)
  private punchS: number = CAMERA.punchS;      // length of the live punch (s)
  private trauma = 0;
  private shakeT = 0;
  private lastRank: RankIndex = 0;
  private readonly tgt = { x: 0, y: 0, z: 0 };
  // VS framing state (all 0 / 1 in solo)
  private vsK = 1;                 // extra distance multiplier holding the near rivals in frame
  private vsHoldT = 0;             // s left before vsK may shrink
  private biasX = 0; private biasZ = 0;     // smoothed look-target slide toward the rivals
  private glX = 0; private glZ = 0;         // spectate glide offset (decays to 0)
  private retargetPending = false;
  private retX = 0; private retZ = 0;       // look target of the previous followed seat

  constructor(camera: THREE.PerspectiveCamera, quality?: Quality) {
    this.camera = camera;
    this.quality = quality ?? null;
  }

  /** Current camera distance to the look target (m), including the player zoom and the rank-up
   *  punch — the ACTUAL distance every LOD / fog / shadow consumer must follow. */
  get distance(): number { return this.dRender; }

  /** The automatic (spring) distance before the player zoom and the punch (m). */
  get autoDist(): number { return this.d; }

  /** This frame's boss hard floor (m; 0 = no boss / nothing to hold) — probes. */
  get bossFloor(): number { return this.floorD; }

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

  /** v2 (FEATURES_V2 §3.6): a camera punch-in of `frac` × D easing back out over `s` seconds (UPROAR fires
   *  it with 0.06 / 0.8). Reduce motion is the caller's switch (game.ts skips the call). A live punch that
   *  is currently deeper is kept; otherwise the new one replaces it. View-only. */
  punch(frac: number, s: number): void {
    if (!(frac > 0) || !(s > 0) || !Number.isFinite(frac) || !Number.isFinite(s)) return;
    const k = Math.min(0.5, frac);
    if (this.punchT >= 0) {
      const tau = this.punchT / this.punchS;
      const live = tau < 1 ? this.punchK * (1 - easeOutCubic(tau)) : 0;
      if (live >= k) return;
    }
    this.punchK = k;
    this.punchS = s;
    this.punchT = 0;
  }

  /** VS: the extra distance multiplier currently holding rivals in frame (1 = none; solo always 1) — probes / HUD. */
  get rivalWiden(): number { return this.vsK; }

  /** VS: the followed seat changed (spectate, follow the killer, respawn): glide the look target from where it was to
   *  the new seat instead of cutting, and do not read the rank difference as a rank-up. View-only. */
  retarget(): void {
    this.retargetPending = true;
    this.retX = this.tx; this.retZ = this.tz;
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
    this.vsK = 1; this.vsHoldT = 0; this.biasX = this.biasZ = 0; this.glX = this.glZ = 0; this.retargetPending = false;
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
      if (rank > this.lastRank && this.punchT < 0) { this.punchT = 0; this.punchK = CAMERA.punchFrac; this.punchS = CAMERA.punchS; }
      this.lastRank = rank;
    }

    // ── look target: interpolated titan + smoothed velocity lead + boss-framing offset + height
    //    (before the distance: the boss floor below is fitted around THIS target; the lead's cap reads
    //    last frame's distance) ──
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
    const vs = w.mode === 'vs';
    if (vs) {
      this.vsBias(w, x, z, dt);
      const kg = 1 - Math.exp(-VS_CAM.glideOmega * dt);
      this.glX -= this.glX * kg; this.glZ -= this.glZ * kg;
      if (Math.abs(this.glX) + Math.abs(this.glZ) < 1e-3) { this.glX = 0; this.glZ = 0; }
    } else if (this.biasX !== 0 || this.biasZ !== 0 || this.glX !== 0 || this.glZ !== 0 || this.vsK !== 1) {
      this.biasX = this.biasZ = this.glX = this.glZ = 0; this.vsK = 1;   // a solo world after a VS one
    }
    this.tx = x + this.leadX + this.offX + this.biasX + this.glX;
    this.tz = z + this.leadZ + this.offZ + this.biasZ + this.glZ;
    this.ty = H * CAMERA.targetYFrac;
    if (this.retargetPending) {
      this.retargetPending = false;
      this.glX = this.retX - (this.tx - this.glX);
      this.glZ = this.retZ - (this.tz - this.glZ);
      this.tx = x + this.leadX + this.offX + this.biasX + this.glX;
      this.tz = z + this.leadZ + this.offZ + this.biasZ + this.glZ;
      this.lastRank = rank;
    }

    // ── distance: critically damped spring toward D*, exact solution over dt. While a boss is alive
    //    the spring widens at CAMERA.widenOmega (the director's held framing widens at once; the rig
    //    follows in ≈ 0.4 s, and shrinks at zoomOmega behind the director's slow release), and the
    //    auto distance never goes under the boss HARD FLOOR (config bossFrameFloorAt: the rig, every live
    //    tell and the titan inside |ndc| 0.95 around the target above — re-fitted on this frame's
    //    state, so a tell that spawns off screen widens the view on the frame it appears) ──
    const dStar = frameDistance(w);
    const boss = w.boss !== null && w.boss !== undefined && w.boss.alive;
    const om = boss && dStar > this.d ? CAMERA.widenOmega : CAMERA.zoomOmega;
    if (dt > 0) {
      const x0 = this.d - dStar;
      const e = Math.exp(-om * dt);
      const c = this.dv + om * x0;
      this.d = dStar + (x0 + c * dt) * e;
      this.dv = (c - om * (x0 + c * dt)) * e;
    }
    if (!Number.isFinite(this.d) || this.d <= 0) { this.d = dStar; this.dv = 0; }
    this.floorD = 0;
    if (boss) {
      bossFrameNeed(w);                     // refresh the framing scratch to THIS state (pure; the director re-runs it before every read)
      this.floorD = bossFrameFloorAt(this.tx - T.x, this.tz - T.z, this.camera.aspect);
      if (this.d < this.floorD) { this.d = this.floorD; if (this.dv < 0) this.dv = 0; }
    }

    let punch = 1;
    if (this.punchT >= 0) {
      this.punchT += dt;
      const tau = this.punchT / this.punchS;
      if (tau >= 1) this.punchT = -1;
      else punch = 1 - this.punchK * (1 - easeOutCubic(tau));
    }
    // ── player zoom: log-space, smoothed, re-clamped every frame (the band is absolute metres,
    //    so a rank-up can tighten the allowed multiplier) ──
    this.zoomLogT = this.clampZoomLog(this.zoomLogT, this.d);
    this.zoomLog += (this.zoomLogT - this.zoomLog) * (1 - Math.exp(-ZOOM_OMEGA * dt));
    if (Math.abs(this.zoomLogT - this.zoomLog) < 1e-4) this.zoomLog = this.zoomLogT;
    this.dRender = this.d * Math.exp(this.zoomLog) * punch;
    // the floor binds the drawn view at the default zoom (or wider) — a punch never dips a tell out;
    // a player zoom-in is the player's choice
    if (this.floorD > 0 && this.zoomLog >= -1e-3 && this.dRender < this.floorD) this.dRender = this.floorD;
    if (vs) {
      this.vsWiden(w, dt, this.dRender);
      if (this.vsK > 1) this.dRender = Math.min(this.dRender * this.vsK, Math.max(D_ABS_MAX, this.dRender));
    }

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
    const vsMode = w.mode === 'vs';
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      // VS: another seat's own-body events (hurt, rank-up, kit pulses) never shake or punch THIS camera; its footsteps
      // do, attenuated by distance (a Size V walking past is felt, not a full shake)
      if (vsMode && e.p !== undefined && e.p >= 0 && e.p !== w.cur) {
        if (e.type === 'footstep') { add += TR.footstep * Math.max(0, Math.min(1, e.heavy)) * 0.6 * att(e.x, e.z); continue; }
        if (e.type === 'rankUp' || e.type === 'titanHurt' || e.type === 'vent' || e.type === 'wireDetonate' || e.type === 'ability'
          || e.type === 'pulse' || e.type === 'bloomBurst') continue;
      }
      switch (e.type) {
        case 'rankUp': this.punchT = 0; this.punchK = CAMERA.punchFrac; this.punchS = CAMERA.punchS; this.lastRank = e.rank; add += TR.rankUp; break;
        case 'footstep': add += TR.footstep * Math.max(0, Math.min(1, e.heavy)); break;
        case 'buildingCollapse': {
          const base = TR.collapseBase + TR.collapsePerTier * e.tier - TR.collapseRankRelief * rank;
          add += Math.max(0.03, base) * att(e.x, e.z);
          break;
        }
        case 'floorBreak': if (e.tier >= rank) add += TR.floorBreak * att(e.x, e.z); break;
        case 'bump': add += TR.bump; break;
        case 'explosion':
          if (e.kind === 'seed' && w.titanId === 'briarwick') break;   // pod bursts shake via 'bloomBurst' below
          add += Math.min(0.35, TR.explosion + TR.explosionPerExtent * (e.r / ext) * 0.3) * att(e.x, e.z); break;
        case 'bossAttack': add += TR.bossAttack * Math.max(0.35, att(e.x, e.z)); break;
        // GATEKEEPERS §6.7 (lane K2a): trauma is already titan-relative (displacement ∝ titan height), so a
        // gatekeeper's beats are not rescaled by H — its stagger shakes at 0.6×, its phase change not at all
        case 'bossStagger': add += w.boss && w.boss.role === 'gate' ? TR.bossStagger * TR.gateStaggerK : TR.bossStagger; break;
        case 'gateRam': add += TR.bossAttack * Math.max(0.35, att(e.x, e.z)); break;
        case 'gateSpawn': add += TR.gateSpawn; break;
        case 'gateDefeated': add += TR.gateDefeated; break;
        case 'gateLocked': add += TR.gateLocked; break;
        case 'finale': if (e.on) add += TR.finale; break;
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
        case 'bloomBurst': if (e.link <= TR.podLinkCap) add += TR.podLink * att(e.x, e.z); break;
        default: break;
      }
    }
    if (add > 0) this.shake(add);
    void H;
  }

  /** VS: smoothed slide of the look target toward the centre of the near rivals (so own titan + rival both fit with
   *  less widening). x, z = the followed titan's interpolated position. */
  private vsBias(w: World, x: number, z: number, dt: number): void {
    const ext = Math.max(1, this.dRender * K);
    const reach = VS_CAM.range * ext;
    let sx = 0, sz = 0, n = 0;
    const ps = w.players;
    for (let i = 0; i < ps.length; i++) {
      if (i === w.cur) continue;
      const P = ps[i];
      if (!P.titan.alive || P.vs.eliminated) continue;
      const dx = P.titan.x - x, dz = P.titan.z - z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const wgt = 1 - d / reach;
      sx += dx * wgt; sz += dz * wgt; n += wgt;
    }
    let bx = 0, bz = 0;
    if (n > 0) {
      bx = (sx / n) * VS_CAM.biasFrac; bz = (sz / n) * VS_CAM.biasFrac;
      const cap = VS_CAM.biasMax * ext, m = Math.hypot(bx, bz);
      if (m > cap && m > 0) { bx *= cap / m; bz *= cap / m; }
    }
    const k = 1 - Math.exp(-VS_CAM.biasOmega * dt);
    this.biasX += (bx - this.biasX) * k;
    this.biasZ += (bz - this.biasZ) * k;
  }

  /** VS: grow this.vsK so every near live rival (and the followed titan) fits inside |ndc| VS_CAM.margin around the
   *  look target; `base` = the unwidened drawn distance. Widens fast, holds, then shrinks slowly. */
  private vsWiden(w: World, dt: number, base: number): void {
    const aspect = Math.max(0.5, this.camera.aspect || 1.7778);
    const halfH = (base * K) * 0.5 * VS_CAM.margin;
    const halfW = halfH * aspect;
    const reach = VS_CAM.range * base * K;
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    let need = 1;
    const ps = w.players;
    for (let i = -1; i < ps.length; i++) {
      // i = -1 is the followed titan itself (the slide must never push it out of frame)
      const P = i < 0 ? ps[Math.max(0, w.cur)] : ps[i];
      if (i >= 0 && (i === w.cur || !P.titan.alive || P.vs.eliminated)) continue;
      const T = P.titan;
      const dx = T.x - this.tx, dz = T.z - this.tz;
      if (i >= 0 && Math.hypot(dx, dz) > reach) continue;
      const sxx = dx * COS_YAW - dz * SIN_YAW;
      const su = -dx * SIN_YAW - dz * COS_YAW;
      const yb = su * sp, yt = yb + T.height * cp;
      const kx = (Math.abs(sxx) + T.radius) / halfW;
      const ky = Math.max(yt, 0) / halfH, kb = Math.max(-yb, 0) / halfH;
      need = Math.max(need, kx, ky, kb);
    }
    const target = Math.min(VS_CAM.maxWiden, Math.max(1, need));
    if (target > this.vsK) {
      this.vsK += (target - this.vsK) * (1 - Math.exp(-VS_CAM.widenOmega * dt));
      this.vsHoldT = VS_CAM.holdS;
    } else if (target > this.vsK * 0.97) {
      this.vsHoldT = VS_CAM.holdS;
    } else {
      this.vsHoldT -= dt;
      if (this.vsHoldT <= 0) this.vsK += (target - this.vsK) * (1 - Math.exp(-VS_CAM.shrinkOmega * dt));
    }
    if (this.vsK < 1.0005) this.vsK = 1;
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
