// HIT PARADE - presented body yaw (CHANGED(fix_view) D2, CONTRACT §35.23 fix_view note). Presentation only.
//
// The sim re-faces with a SNAP (auto-face the first frame a fighter is free after a whiffed / stepped move, hitstun,
// knockdown or a throw: 35-180 deg in one sim frame). The view presents the body yaw through this smoother instead:
//   * continuous tracking (the sim yaw moving <= TURN.passDeg per sim frame: auto-face while walking / circling /
//     stepping, a move's own tracking) is shown AT ONCE - no lag;
//   * a bigger change is a re-face: the presented yaw turns toward the sim yaw with an accelerate / decelerate profile
//     (speed rises TURN.accelDeg per frame, never faster than the distance left allows to stop, cap TURN.maxDeg):
//     20 deg -> 2 frames, 35 -> 3, 115 -> 6, 180 -> 7;
//   * HIT READS: `lockIn` = sim frames until the fighter's own first active frame; the turn speeds up so it lands by
//     then, and from the first active frame on the presented yaw IS the sim yaw (hitboxes, projectile launch, throw arc);
//   * ROLLBACK / SEEK SAFETY: it advances per SIM frame (not per rendered frame), so a rendered frame that shows the
//     same sim frame again changes nothing; a backwards frame, a jump of more than TURN.maxGap frames (a seek, a
//     rollback burst, a lab replay) or a turn still open after TURN.maxLag frames snaps to the sim yaw (catch-up).
// Pure state machine (no THREE); radians in, radians out, yaw convention = three.js rotation.y.

const DEG = Math.PI / 180;

export const TURN = {
  /** per-sim-frame change shown at once (continuous tracking), deg */
  passDeg: 12,
  /** re-face acceleration, deg / frame^2 */
  accelDeg: 14,
  /** re-face speed cap, deg / frame */
  maxDeg: 45,
  /** more sim frames than this between two presented frames -> snap */
  maxGap: 8,
  /** a re-face still open after this many sim frames -> snap (catch-up) */
  maxLag: 12,
};

export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

export class TurnSmoother {
  /** the presented yaw (radians) */
  yaw = 0;
  private sim = 0;
  /** signed speed of the running re-face (rad / frame) */
  private v = 0;
  private frame = -1;
  private open = 0;
  private ready = false;
  /** read-back: the last error (presented - sim, deg) and why the last frame snapped ('' = it did not) */
  readonly last = { errDeg: 0, snap: '', open: 0 };

  /** forget everything: the next step() presents the sim yaw */
  reset(): void { this.ready = false; this.v = 0; this.open = 0; }

  /** the presented yaw is forced (a cinematic pose): follow it, the sim yaw is chased from here once it is released */
  hold(yaw: number, simYaw: number, frame: number): void {
    this.yaw = yaw; this.sim = simYaw; this.v = 0; this.open = 0; this.ready = true;
    this.frame = Number.isFinite(frame) ? frame : -1;
    this.last.errDeg = 0; this.last.snap = 'hold'; this.last.open = 0;
  }

  private snapTo(simYaw: number, frame: number, why: string): number {
    this.yaw = simYaw; this.sim = simYaw; this.v = 0; this.open = 0; this.ready = true;
    this.frame = Number.isFinite(frame) ? frame : -1;
    this.last.errDeg = 0; this.last.snap = why; this.last.open = 0;
    return this.yaw;
  }

  /**
   * Advance to sim frame `frame` whose sim yaw is `simYaw`. `lockIn` = sim frames until the fighter's own first active
   * frame (0 = an active frame now), -1 = no attack constraint. Returns the presented yaw.
   */
  step(simYaw: number, frame: number, lockIn = -1): number {
    if (!Number.isFinite(simYaw)) return this.yaw;
    if (!this.ready || !Number.isFinite(frame) || this.frame < 0) return this.snapTo(simYaw, frame, 'init');
    if (frame < this.frame) return this.snapTo(simYaw, frame, 'back');
    const n = frame - this.frame;
    if (n > TURN.maxGap) return this.snapTo(simYaw, frame, 'gap');
    this.last.snap = '';
    if (n === 0) {
      // the same sim frame presented again (a fast display, a frozen / paused sim): nothing moves - unless a rollback
      // rewrote this very frame, which then counts as one frame of chase
      if (wrapAngle(simYaw - this.sim) === 0) return this.yaw;
    }
    const steps = Math.max(1, n);
    // continuous tracking moves the presented yaw with the sim (no lag); a bigger jump is left to the chase
    const d = wrapAngle(simYaw - this.sim);
    if (Math.abs(d) <= TURN.passDeg * DEG * steps) this.yaw = wrapAngle(this.yaw + d);
    this.sim = simYaw;
    this.frame = frame;
    for (let k = 0; k < steps; k++) {
      const li = lockIn >= 0 ? lockIn + (steps - 1 - k) : -1;
      if (this.chase(li)) break;
    }
    this.last.errDeg = Math.round(wrapAngle(this.yaw - this.sim) / DEG * 10) / 10;
    this.last.open = this.open;
    return this.yaw;
  }

  /** one sim frame of the re-face; true when the presented yaw reached the sim yaw */
  private chase(lockIn: number): boolean {
    const e = wrapAngle(this.sim - this.yaw);
    const ae = Math.abs(e);
    if (ae < 0.05 * DEG) { this.yaw = this.sim; this.v = 0; this.open = 0; return true; }
    if (lockIn === 0) { this.yaw = this.sim; this.v = 0; this.open = 0; this.last.snap = 'active'; return true; }
    const sg = e > 0 ? 1 : -1;
    if (this.v * sg < 0) this.v = 0;                      // the target swung to the other side: restart from rest
    const a = TURN.accelDeg * DEG;
    let sp = Math.min(Math.abs(this.v) + a, Math.sqrt(a * ae), TURN.maxDeg * DEG);
    if (lockIn > 0) sp = Math.max(sp, ae / lockIn);      // land the turn by the first active frame
    if (sp >= ae) { this.yaw = this.sim; this.v = 0; this.open = 0; return true; }
    this.yaw = wrapAngle(this.yaw + sg * sp);
    this.v = sg * sp;
    if (++this.open > TURN.maxLag) { this.yaw = this.sim; this.v = 0; this.open = 0; this.last.snap = 'lag'; return true; }
    return false;
  }
}
