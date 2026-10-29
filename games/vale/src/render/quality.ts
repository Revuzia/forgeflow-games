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
// uncapped) the render scale steps down by 0.05 to a floor of min(scale, 0.8). Hysteresis windows are 1 s;
// never more than one step per window. It only steps down for GPU-bound frames (r12 B4): a smaller buffer
// cannot shorten a frame the CPU is late on. Each window is classified from the GPU time
// (EXT_disjoint_timer_query_webgl2 around the frame's draws, GpuTimer) when the driver offers it, else from the
// renderer's own CPU time:
//   gpu   GPU time ≥ 85 % of the target (or, with no timer at all, renderer CPU < 60 % of it) → step down
//   cpu   otherwise → hold the scale
// A GPU time longer than the frame interval it is fed with is not that frame's draws (another process holding the
// GPU, a timer straddling a hitch): it is dropped, and a window whose readings were all dropped is never GPU-bound
// (perf PERF-M2: 29–31 ms readings at a steady 60 fps made contention hitches look GPU-bound).
// Back up (perf PERF-M2): vsync holds the interval at the display rate, so spare GPU time never shows as a faster
// frame on a 60 Hz display. A lowered scale therefore PROBES: after 3 on-target windows it steps up 0.05 and keeps
// the step only if the next 2 windows stay on target; a GPU-bound slow window inside the probe takes it back and
// doubles the wait before the next probe (≤ 32 windows), a kept probe resets it.
// The renderer feeds it only frames it wanted at the display rate: match frames, never the menu or its idle cap,
// never under an fpsCap below the display rate (Renderer.render), and re-configures it for every match.

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

export const PRESETS: Readonly<Record<Tier, Omit<Video, 'preset' | 'fpsCap' | 'fullscreen' | 'ambientEffects'>>> = {
  low: { renderScale: 0.75, shadows: 1, ao: 0, bloom: false, antialias: 'off', particles: 0, scatter: 0, maxDpr: 1 },
  medium: { renderScale: 0.9, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 1, scatter: 1, maxDpr: 1 },
  high: { renderScale: 1.0, shadows: 2, ao: 1, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 1 },
  ultra: { renderScale: 1.0, shadows: 3, ao: 2, bloom: true, antialias: 'smaa', particles: 2, scatter: 2, maxDpr: 2 },
};

export function presetVideo(tier: Tier, base?: Partial<Video>): Video {
  return { fpsCap: 0, fullscreen: false, ambientEffects: true, ...base, ...PRESETS[tier], preset: tier };
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

export type FrameBound = 'cpu' | 'gpu' | '';

/** on-target windows before the first up-probe, the most a failed probe can push that wait to, and the windows a
 *  probe step must stay on target to be kept */
const PROBE_AFTER = 3;
const PROBE_MAX = 32;
const PROBE_HOLD = 2;

/** frame-interval driven render-scale controller (GPU-bound windows only; see the header) */
export class DynamicResolution {
  enabled = true;
  private base = 1;
  private floor = 0.8;
  private current = 1;
  private acc = 0;
  private frames = 0;
  private sum = 0;
  private cpuSum = 0;
  private gpuSum = 0;
  private gpuN = 0;
  /** GPU readings dropped this window (longer than their frame interval) */
  private gpuDropped = 0;
  private slow = 0;
  /** on-target windows in a row below base (toward the next up-probe) */
  private onTarget = 0;
  /** the scale before the running up-probe (−1: no probe running) and the windows it still has to hold */
  private probeFrom = -1;
  private probeLeft = 0;
  /** on-target windows the next probe waits for */
  private probeWait = PROBE_AFTER;
  private targetMs = 1000 / 60;
  /** what limited the last slow window ('' = on target) */
  bound: FrameBound = '';

  configure(base: number, fpsCap: number): void {
    this.base = base;
    this.floor = Math.min(base, 0.8);
    this.current = base;
    this.targetMs = 1000 / (fpsCap > 0 ? Math.min(fpsCap, 144) : 60);
    this.reset();
    this.slow = this.onTarget = this.probeLeft = 0;
    this.probeFrom = -1;
    this.probeWait = PROBE_AFTER;
    this.bound = '';
  }

  /** drop the window in progress (sampling paused: a menu, an idle cap, a scene change) */
  reset(): void {
    this.acc = this.frames = this.sum = this.cpuSum = this.gpuSum = this.gpuN = this.gpuDropped = 0;
  }

  get scale(): number { return this.enabled ? this.current : this.base; }

  /**
   * feed one frame: its interval (ms), the renderer's own CPU time for it (ms) and the GPU time of its draws
   * when a timer query measured it (ms, null = unknown); returns true when the scale changed
   */
  sample(intervalMs: number, cpuMs = 0, gpuMs: number | null = null): boolean {
    if (!this.enabled || !(intervalMs > 0) || intervalMs > 250) return false;
    this.acc += intervalMs; this.frames++; this.sum += intervalMs; this.cpuSum += Math.max(0, cpuMs);
    if (gpuMs !== null && gpuMs >= 0) {
      if (gpuMs <= intervalMs) { this.gpuSum += gpuMs; this.gpuN++; } else this.gpuDropped++;
    }
    if (this.acc < 1000) return false;
    const avg = this.sum / this.frames, cpu = this.cpuSum / this.frames, gpu = this.gpuN > 0 ? this.gpuSum / this.gpuN : null;
    const timed = this.gpuN + this.gpuDropped > 0;
    this.reset();
    const t = this.targetMs;
    const gpuBound = gpu !== null ? gpu >= t * 0.85 : !timed && cpu < t * 0.6;
    const late = avg > t * 1.12;
    // a CPU-late window with a light GPU (measured) says the resolution has room; without a reading it says nothing
    const room = !late || (!gpuBound && gpu !== null && gpu < t * 0.6);
    this.bound = late ? (gpuBound ? 'gpu' : 'cpu') : '';
    if (this.probeFrom >= 0) {
      if (late && gpuBound) {
        // the probe step did not hold: back down, and wait longer before the next one
        this.current = this.probeFrom; this.probeFrom = -1; this.probeLeft = 0;
        this.probeWait = Math.min(PROBE_MAX, this.probeWait * 2);
        this.slow = this.onTarget = 0;
        return true;
      }
      if (!room || --this.probeLeft > 0) return false;
      // kept: the wait resets, and a scale still under base probes the next step at once
      this.probeFrom = -1; this.probeWait = PROBE_AFTER;
      return this.probeUp();
    }
    if (late && gpuBound) {
      this.onTarget = 0;
      if (++this.slow >= 2 && this.current > this.floor + 1e-3) {
        this.current = Math.max(this.floor, Math.round((this.current - 0.05) * 100) / 100); this.slow = 0; return true;
      }
      return false;
    }
    this.slow = 0;
    if (!room) return false;
    if (this.current < this.base - 1e-3 && ++this.onTarget >= this.probeWait) return this.probeUp();
    return false;
  }

  /** the up-probe (vsync never shows headroom as a faster frame): one step, kept if the next windows hold */
  private probeUp(): boolean {
    this.onTarget = 0;
    if (this.current >= this.base - 1e-3) return false;
    this.probeFrom = this.current; this.probeLeft = PROBE_HOLD;
    this.current = Math.min(this.base, Math.round((this.current + 0.05) * 100) / 100);
    return true;
  }
}

/**
 * GPU time of a span of draws (EXT_disjoint_timer_query_webgl2), read back a few frames later without
 * blocking. `last` stays null where the extension is missing (Safari, some drivers) or a result was disjoint.
 * Never nest it inside another TIME_ELAPSED query (the harness' own timers run with dynamic resolution off).
 */
export class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pool: WebGLQuery[] = [];
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** queries in flight when the reading was cleared: their results are dropped */
  private discard = 0;
  last: number | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) ?? null;
  }

  get available(): boolean { return this.ext !== null; }

  begin(): void {
    if (!this.ext || this.dead || this.active || this.pending.length >= 4) return;
    const q = this.pool.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || this.dead || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** the newest finished measurement (ms), or null */
  poll(): number | null {
    const gl = this.gl, ext = this.ext;
    if (!ext || this.dead) return null;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
      this.pending.shift();
      this.pool.push(q);
      if (this.discard > 0) { this.discard--; continue; }
      this.last = disjoint ? null : ns / 1e6;
    }
    return this.last;
  }

  /** forget the last reading and the queries still in flight (a match ended: the next one must not inherit them) */
  clear(): void { this.last = null; this.discard = this.pending.length; }

  /**
   * perf PERF-m4: the context was lost — every query belongs to it and is gone. Drop them without a GL call (a
   * restored context reports each as a foreign object) and never measure again: the renderer builds a new timer
   * on the restored context.
   */
  abandon(): void {
    this.pool.length = 0; this.pending.length = 0; this.active = null; this.last = null; this.discard = 0;
    this.dead = true;
  }
  private dead = false;

  dispose(): void {
    if (this.dead) return;
    for (const q of [...this.pool, ...this.pending]) this.gl.deleteQuery(q);
    if (this.active) this.gl.deleteQuery(this.active);
    this.pool.length = 0; this.pending.length = 0; this.active = null;
  }
}
