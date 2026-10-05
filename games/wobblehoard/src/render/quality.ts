// Quality tiers and the auto governor. The tier table is the single place that decides what each tier costs:
//   high = transmission at full res (+ the transmission target's own 4x MSAA) + DPR <= 2 + the densest fine mesh
//   med  = transmission at 0.5 res, DPR <= 1.5
//   low  = no transmission (alpha-blended fresnel + core glow), DPR <= 1, the thinnest mesh and FX
// The default framebuffer's MSAA is fixed when the WebGL context is created, so it is requested once (cheap on tiled
// mobile GPUs) and the tiers differ in everything else.
import type { QualityTier } from '../contracts.ts';

export interface TierSpec {
  tier: QualityTier;
  fineFreq: number;          // geodesic frequency of the fine render mesh: 10 f^2 + 2 vertices
  dprCap: number;
  transmission: boolean;
  transmissionScale: number;
  glitterMax: number;        // suspended specks (cap, genome.glitter picks the actual count)
  bubbleMax: number;
}

export const TIERS: Record<QualityTier, TierSpec> = {
  high: { tier: 'high', fineFreq: 32, dprCap: 2, transmission: true, transmissionScale: 1, glitterMax: 150, bubbleMax: 40 },
  med: { tier: 'med', fineFreq: 24, dprCap: 1.5, transmission: true, transmissionScale: 0.5, glitterMax: 100, bubbleMax: 32 },
  low: { tier: 'low', fineFreq: 16, dprCap: 1, transmission: false, transmissionScale: 0.5, glitterMax: 48, bubbleMax: 20 },
};

const ORDER: QualityTier[] = ['high', 'med', 'low'];
export const nextLowerTier = (t: QualityTier): QualityTier => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(t) + 1)];

/** Frame-time governor. `sample()` is fed the wall-clock time between two render() calls. */
export class QualityGovernor {
  mode: QualityTier | 'auto' = 'auto';
  tier: QualityTier = 'med';
  /** Smoothed frame time (EMA, ms). */
  frameMsEma = 0;
  /** Drop threshold for the 1 s window average, ms. */
  readonly dropAboveMs = 24;
  private sum = 0;
  private count = 0;
  private windowT = 0;
  private hold = 0;

  /** Returns the tier to switch to, or null for "no change". */
  setMode(q: QualityTier | 'auto'): QualityTier | null {
    this.mode = q;
    this.resetWindow(30);
    if (q === 'auto') return null; // keep whatever we are on (starts at med)
    if (q !== this.tier) { this.tier = q; return q; }
    return null;
  }

  /** Ignore the next `frames` samples (shader compiles, resizes and tier switches cause one-off long frames). */
  resetWindow(frames = 20): void {
    this.sum = 0; this.count = 0; this.windowT = 0; this.hold = frames;
  }

  sample(raw: number): QualityTier | null {
    // > 2 s between two renders = a paused / hidden tab or the first frame: ignored. Anything shorter COUNTS, clamped to 100 ms (4x the
    // threshold) for the drop decision: a device that really runs at 2 fps must still drop a tier (ignoring every sample over 400 ms, as
    // before, starved the window there and it never dropped), while one stray long hitch in an otherwise smooth second stays under it.
    if (!(raw > 0) || raw > 2000) return null;
    this.frameMsEma = this.frameMsEma === 0 ? raw : this.frameMsEma * 0.9 + raw * 0.1;
    const ms = Math.min(raw, 100);
    if (this.hold > 0) { this.hold--; return null; }
    this.sum += ms; this.count++; this.windowT += ms;
    if (this.windowT < 1000) return null;
    const avg = this.sum / this.count;
    this.sum = 0; this.count = 0; this.windowT = 0;
    if (this.mode === 'auto' && avg > this.dropAboveMs && this.tier !== 'low') {
      this.tier = nextLowerTier(this.tier);
      this.resetWindow(24);
      return this.tier;
    }
    return null;
  }
}
