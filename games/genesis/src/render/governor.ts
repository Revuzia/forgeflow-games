// GENESIS — the adaptive quality governor (smoothness, macfix 2026-11). On 'auto' quality the game watches its own
// frame times in the browser and walks a ladder of rungs: render scale first, then the expensive passes (cloud and
// atmosphere steps, GTAO, shadows), never vegetation or anything the sim sees (quality never changes the sim:
// CONTRACT §15.9). It drops quickly when frames run long and climbs back slowly, one rung per probe, with a back-off
// per rung when a climb fails, so it never thrashes. A manual preset in the settings switches it off.

import { QUALITY_NAMES, type Quality, type QualityName } from './quality.ts';

/** one step of the ladder: a preset and the cuts laid over it */
export interface Rung {
  preset: QualityName;
  /** multiplies the preset's render scale */
  scale: number;
  /** 0 none · 1 lighter cloud / atmosphere marches · 2 + no GTAO · 3 + one shadow cascade · 4 + no shadows, no god rays */
  cuts: number;
  label: string;
}

const rank = (q: QualityName) => QUALITY_NAMES.indexOf(q);
const lower = (a: QualityName, b: QualityName): QualityName => (rank(a) <= rank(b) ? a : b);

/**
 * The ladder for a machine whose probe picked `probe`: the presets from the ceiling (the probe's pick, at most High —
 * Ultra and Cinematic are manual choices) down to the start (the probe's pick, at most Medium), then cuts on the
 * start preset. Index 0 is the best rung; `start` is where a first load begins.
 */
export function buildLadder(probe: QualityName): { rungs: Rung[]; start: number } {
  const ceiling = lower(probe, 'high');
  const base = lower(probe, 'medium');
  const rungs: Rung[] = [];
  for (let i = rank(ceiling); i > rank(base); i--) rungs.push({ preset: QUALITY_NAMES[i], scale: 1, cuts: 0, label: QUALITY_NAMES[i] });
  const start = rungs.length;
  const cuts: [number, number][] = [[1, 0], [0.85, 0], [0.85, 1], [0.8, 2], [0.75, 3], [0.7, 4], [0.62, 4]];
  for (const [scale, c] of cuts) rungs.push({ preset: base, scale, cuts: c, label: `${base}${scale < 1 ? ` ×${scale}` : ''}${c ? ` −${c}` : ''}` });
  return { rungs, start };
}

/** a rung's cuts laid over a quality (a copy is expected: the caller's own, already carrying the settings' toggles) */
export function applyRung(q: Quality, r: Rung): Quality {
  q.renderScale *= r.scale;
  if (r.cuts >= 1) {
    q.cloudSteps = Math.max(16, Math.round(q.cloudSteps * 0.7));
    q.cloudLightSteps = Math.max(2, q.cloudLightSteps - 1);
    q.atmoSteps = Math.max(8, Math.round(q.atmoSteps * 0.75));
  }
  if (r.cuts >= 2) q.ssao = false;
  if (r.cuts >= 3) q.shadowCascades = Math.min(q.shadowCascades, 1);
  if (r.cuts >= 4) { q.shadowCascades = 0; q.godRays = false; }
  return q;
}

export interface GovernorTuning {
  /** the frame interval aimed at (ms): 60 fps, also on 120 Hz screens */
  target: number;
  /** one judgement window (ms of wall time) */
  window: number;
  /** a window is slow when its mean interval is over target × this, or its 90th percentile over target × slowP90 */
  slowMean: number;
  slowP90: number;
  /** a window this far over (mean > target × severe) drops two rungs at once */
  severe: number;
  /** a window has headroom when mean < target × okMean and p90 < target × okP90 */
  okMean: number;
  okP90: number;
  /** slow windows in a row before a drop */
  slowWindows: number;
  /** good time (ms) before the first climb probe from a rung; doubles per failed climb up to maxHold */
  hold: number;
  maxHold: number;
  /** a drop this soon (ms) after a climb marks that climb failed */
  failWithin: number;
  /** after any change, samples are ignored this long (ms: the resize and the pipeline refilling) */
  settle: number;
  /** intervals longer than this (ms) are not frames (a hidden tab, a debugger, a load) */
  maxSample: number;
}

export const GOVERNOR_TUNING: GovernorTuning = {
  target: 1000 / 60, window: 1500, slowMean: 1.18, slowP90: 1.7, severe: 1.9, okMean: 1.08, okP90: 1.3,
  slowWindows: 2, hold: 8000, maxHold: 180000, failWithin: 6000, settle: 1200, maxSample: 250,
};

export interface GovernorStats { mean: number; p90: number; fps: number; windows: number; drops: number; climbs: number; failed: number }

export class FrameGovernor {
  readonly rungs: Rung[];
  readonly top: number;
  rung: number;
  enabled = true;
  readonly stats: GovernorStats = { mean: 0, p90: 0, fps: 0, windows: 0, drops: 0, climbs: 0, failed: 0 };
  private readonly t: GovernorTuning;
  private readonly buf = new Float32Array(1024);
  private n = 0;
  private winStart = -1;
  private settleUntil = 0;
  private slowRun = 0;
  private goodMs = 0;
  private lastClimbAt = -1e9;
  private lastClimbFrom = -1;
  private readonly holdMs: number[];

  constructor(rungs: Rung[], start: number, tuning: Partial<GovernorTuning> = {}) {
    this.rungs = rungs;
    this.top = 0;
    this.rung = Math.max(0, Math.min(rungs.length - 1, start));
    this.t = { ...GOVERNOR_TUNING, ...tuning };
    this.holdMs = rungs.map(() => this.t.hold);
  }

  get current(): Rung { return this.rungs[this.rung]; }

  /** ignore frames for a while (a camera cut, a load, a resize the governor did not make) */
  pause(now: number, ms = this.t.settle): void {
    this.settleUntil = Math.max(this.settleUntil, now + ms);
    this.n = 0;
    this.winStart = -1;
  }

  /**
   * One frame's interval (ms, from requestAnimationFrame) at time `now` (ms). Returns the new rung index when the
   * governor moves, else -1.
   */
  sample(dtMs: number, now: number): number {
    if (!this.enabled || this.rungs.length < 2) return -1;
    if (now < this.settleUntil) return -1;
    if (!(dtMs > 0) || dtMs > this.t.maxSample) { this.n = 0; this.winStart = -1; return -1; }
    if (this.winStart < 0) this.winStart = now;
    if (this.n < this.buf.length) this.buf[this.n++] = dtMs;
    if (now - this.winStart < this.t.window || this.n < 8) return -1;
    return this.judge(now);
  }

  private judge(now: number): number {
    const t = this.t, n = this.n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.buf[i];
    const mean = sum / n;
    const sorted = this.buf.subarray(0, n).sort();
    const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
    const span = now - this.winStart;
    this.n = 0;
    this.winStart = now;
    const s = this.stats;
    s.mean = mean; s.p90 = p90; s.fps = 1000 / mean; s.windows++;
    const slow = mean > t.target * t.slowMean || p90 > t.target * t.slowP90;
    if (slow) {
      this.goodMs = 0;
      this.slowRun++;
      const severe = mean > t.target * t.severe;
      if ((severe || this.slowRun >= t.slowWindows) && this.rung < this.rungs.length - 1) {
        // a drop soon after a climb: that climb failed; wait longer before trying it again
        if (now - this.lastClimbAt < t.failWithin && this.lastClimbFrom >= 0) {
          this.holdMs[this.lastClimbFrom] = Math.min(t.maxHold, this.holdMs[this.lastClimbFrom] * 2);
          s.failed++;
          this.lastClimbFrom = -1;
        }
        return this.move(Math.min(this.rungs.length - 1, this.rung + (severe ? 2 : 1)), now, false);
      }
      return -1;
    }
    this.slowRun = 0;
    const ok = mean < t.target * t.okMean && p90 < t.target * t.okP90;
    if (!ok) { this.goodMs = 0; return -1; }
    this.goodMs += span;
    if (this.rung > this.top && this.goodMs >= this.holdMs[this.rung]) {
      this.lastClimbAt = now;
      this.lastClimbFrom = this.rung;
      return this.move(this.rung - 1, now, true);
    }
    return -1;
  }

  private move(to: number, now: number, up: boolean): number {
    if (to === this.rung) return -1;
    this.rung = to;
    this.goodMs = 0;
    this.slowRun = 0;
    if (up) this.stats.climbs++; else this.stats.drops++;
    this.pause(now);
    return to;
  }
}
