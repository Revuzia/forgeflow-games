// VALE render — the quality ladder (CONTRACT §9.4, client_hud §settings "Video ladder") and dynamic
// resolution.
//
//            scale  AO     shadows        bloom  AA     particles  scatter  DPR
//   Low      0.75   off    1024² hard     off    off    0          0        1
//   Medium   0.90   half   2048² PCF      on     SMAA   1          1        1
//   High     1.00   half*  2048² PCF      on     SMAA   2          2        1
//   Ultra    1.00   full   4096² PCF      on     SMAA   2          2        ≤ 2
//   (* the UI ladder ships High with half-res AO; `video.ao` decides: 1 half, 2 full)
//
// The renderer honours the individual Settings.video fields (the UI writes a preset into them);
// `tier` is only a label for SMAA preset, bloom levels and the particle budget. Telegraphs, the grade,
// fog of war and every overlay are IDENTICAL on every tier (competitive information).
//
// Dynamic resolution: when the frame interval stays above the target (1 / fpsCap, 60 Hz when
// uncapped) the render scale steps down by 0.05 to a floor of min(scale, 0.8); it steps back up after
// a sustained headroom. Hysteresis windows are 1 s; never more than one step per window.

import type { Settings } from '../contracts/session.ts';

export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export type Video = Settings['video'];

export interface ResolvedQuality {
  tier: Tier;
  renderScale: number;
  maxDpr: number;
  shadows: 0 | 1 | 2 | 3;
  ao: 0 | 1 | 2;
  bloom: boolean;
  aa: 'off' | 'smaa' | 'msaa';
  particles: 0 | 1 | 2;
  scatter: 0 | 1 | 2;
  fpsCap: number;
  /** particle budget on screen (tokens vfx.rules.screenParticleBudget; low extrapolated) */
  particleBudget: number;
  /** burst-count multiplier from `particles` (density only, never size, colour or timing) */
  particleDensity: number;
  /** pooled point lights for `flash` layers (fixed per tier: changing it recompiles materials) */
  flashLights: number;
}

export const PRESETS: Readonly<Record<Tier, Omit<Video, 'preset' | 'fpsCap' | 'fullscreen'>>> = {
  low: { renderScale: 0.75, shadows: 1, ao: 0, bloom: false, antialias: 'off', particles: 0, scatter: 0, maxDpr: 1 },
  medium: { renderScale: 0.9, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 1, scatter: 1, maxDpr: 1 },
  high: { renderScale: 1.0, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 1 },
  ultra: { renderScale: 1.0, shadows: 3, ao: 2, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 2 },
};

export function presetVideo(tier: Tier, base?: Partial<Video>): Video {
  return { fpsCap: 0, fullscreen: false, ...base, ...PRESETS[tier], preset: tier };
}

function tierOf(v: Video): Tier {
  if (v.preset !== 'custom') return v.preset;
  if (v.shadows >= 3 || v.ao >= 2) return 'ultra';
  if (v.ao === 0 && !v.bloom) return 'low';
  if (v.particles >= 2) return 'high';
  return 'medium';
}

const clampInt = <T extends number>(v: number, lo: number, hi: number): T => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo))) as T;

export function resolveQuality(v: Video): ResolvedQuality {
  const tier = tierOf(v);
  const particles = clampInt<0 | 1 | 2>(v.particles, 0, 2);
  return {
    tier,
    renderScale: Math.max(0.5, Math.min(2, Number.isFinite(v.renderScale) ? v.renderScale : 1)),
    maxDpr: Math.max(1, Math.min(3, Number.isFinite(v.maxDpr) ? v.maxDpr : 1)),
    shadows: clampInt<0 | 1 | 2 | 3>(v.shadows, 0, 3),
    ao: clampInt<0 | 1 | 2>(v.ao, 0, 2),
    bloom: !!v.bloom,
    aa: v.antialias === 'msaa' ? 'smaa' : v.antialias,   // MSAA is not offered on the HalfFloat chain; SMAA stands in
    particles,
    scatter: clampInt<0 | 1 | 2>(v.scatter, 0, 2),
    fpsCap: v.fpsCap || 0,
    particleBudget: tier === 'ultra' ? 2500 : tier === 'high' ? 2000 : tier === 'medium' ? 900 : 450,
    particleDensity: particles === 2 ? 1 : particles === 1 ? 0.6 : 0.35,
    flashLights: tier === 'low' ? 0 : tier === 'medium' ? 2 : 4,
  };
}

/** frame-interval driven render-scale controller */
export class DynamicResolution {
  enabled = true;
  private base = 1;
  private floor = 0.8;
  private current = 1;
  private acc = 0;
  private frames = 0;
  private sum = 0;
  private slow = 0;
  private fast = 0;
  private targetMs = 1000 / 60;

  configure(base: number, fpsCap: number): void {
    this.base = base;
    this.floor = Math.min(base, 0.8);
    this.current = base;
    this.targetMs = 1000 / (fpsCap > 0 ? Math.min(fpsCap, 144) : 60);
    this.acc = this.frames = this.sum = this.slow = this.fast = 0;
  }

  get scale(): number { return this.enabled ? this.current : this.base; }

  /** feed one frame's interval (ms); returns true when the scale changed */
  sample(frameMs: number): boolean {
    if (!this.enabled || !(frameMs > 0) || frameMs > 250) return false;
    this.acc += frameMs; this.frames++; this.sum += frameMs;
    if (this.acc < 1000) return false;
    const avg = this.sum / this.frames;
    this.acc = this.frames = this.sum = 0;
    if (avg > this.targetMs * 1.12) { this.slow++; this.fast = 0; } else if (avg < this.targetMs * 0.8) { this.fast++; this.slow = 0; } else { this.slow = this.fast = 0; }
    if (this.slow >= 2 && this.current > this.floor + 1e-3) {
      this.current = Math.max(this.floor, Math.round((this.current - 0.05) * 100) / 100); this.slow = 0; return true;
    }
    if (this.fast >= 3 && this.current < this.base - 1e-3) {
      this.current = Math.min(this.base, Math.round((this.current + 0.05) * 100) / 100); this.fast = 0; return true;
    }
    return false;
  }
}
