// HIT PARADE - WebGL2 renderer (CONTRACT §7, §16 Renderer). Base: dyefield runtime/src/view/renderer.ts.
//
// Kept from dyefield (and why - TECH_REUSE E30-E43):
//   * WebGL2 only; DPR cap min(1.5, devicePixelRatio); Neutral tone mapping (E33: AgX turned the palette tan/grey);
//     sRGB output; PCFShadowMap (E32: r186 has no soft enum, PCFShadowMap IS the soft PCF path), shadow map 1024.
//   * renderer.info.autoReset = false, reset once per rendered frame (E35: with a composer the counters otherwise
//     describe the last pass only).
//   * front-to-back opaque sort (E39: 4-8 % less GPU time in dyefield).
//   * the adaptive resolution governor, verbatim (E31: a scale change reallocates the drawing buffer, 257-383 ms on
//     the shared Intel iGPU - so it changes RARELY: p90 windows, hysteresis, probe-up, deep floor). E30: Chrome on this
//     box renders on the Intel UHD whatever powerPreference asks; perf numbers are iGPU numbers.
// New here:
//   * the context is created WITHOUT MSAA: the frame goes through an EffectComposer whose HalfFloat target has no
//     samples (E36), so AA is SMAAPass (view/post.ts); canvas MSAA would be paid for and never used.
//   * CONTRACT §16 surface: `new Renderer(canvas, {quality, touch})`, `three`, `resize()`, `info()`, `dispose()`.
//     quality 'high' = adaptive from the cap + bloom allowed; 'med' = adaptive, no bloom; 'low' = pinned floor,
//     shadow 512, no bloom. Touch (CONTRACT_MOBILE M7): adaptive starts at the floor.

import * as THREE from 'three';

export const MAX_DPR = 1.5;
export const MIN_SCALE_OF_DPR = 0.6;
export const ABS_MIN_SCALE = 0.75;
export const DEEP_OF_DPR = 0.6;
export const DEEP_AFTER_S = 3;

export type Quality = 'low' | 'med' | 'high';
type GovQuality = 'auto' | 'high' | 'low';

export interface RenderInfo {
  calls: number; triangles: number; programs: number; textures: number; geometries: number;
  scale: number; quality: Quality; gpu: string;
  /** drawing-buffer size (px) */
  buffer: [number, number];
  /** governor read-back */
  p90: number; targetMs: number; changes: number; last: string;
}

const FPS60_MS = 1000 / 60;
const CLOCK50_LO_MS = 19.5;
const CLOCK50_HI_MS = 20.5;
const WINDOW_S = 1.0;
const STEP_QUANT = 0.025;

function scaleBounds(): { min: number; max: number; deep: number } {
  const dpr = window.devicePixelRatio || 1;
  const max = Math.min(MAX_DPR, dpr);
  const min = Math.min(max, Math.max(ABS_MIN_SCALE, MIN_SCALE_OF_DPR * dpr));
  return { min, max, deep: Math.min(min, DEEP_OF_DPR * dpr) };
}

function percentile(sorted: Float32Array, n: number, p: number): number {
  if (n <= 0) return 0;
  const k = Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)));
  return sorted[k];
}

/** The resolution governor (verbatim logic from dyefield; the Renderer applies its scale). */
export class ResolutionGovernor {
  quality: GovQuality = 'auto';
  scale: number;
  min: number;
  max: number;
  targetMs = FPS60_MS;
  p90 = 0;
  clockMs = FPS60_MS;
  changes = 0;
  last = 'start';
  private readonly buf = new Float32Array(512);
  private readonly sorted = new Float32Array(512);
  private n = 0;
  private winS = 0;
  private grace = 2.0;
  private cooldown = 0;
  private held = 0;
  private probeAfter = 8;
  private overRun = 0;
  private spareRun = 0;
  private probeFrom = 0;
  private probeWindows = 0;
  private readonly clocks: number[] = [];
  deepMin: number;
  deepOpen = false;
  private floorOverS = 0;
  startLow = false;

  constructor(min: number, max: number, deepMin: number = min) {
    this.min = min; this.max = max; this.deepMin = Math.min(min, deepMin); this.scale = max;
  }

  lo(): number { return this.deepOpen && this.quality === 'auto' ? this.deepMin : this.min; }

  setBounds(min: number, max: number, deepMin: number = min): void {
    this.min = min; this.max = max; this.deepMin = Math.min(min, deepMin);
    this.scale = this.pinned() ?? Math.min(max, Math.max(this.lo(), this.scale));
  }

  setQuality(q: GovQuality): void {
    this.quality = q;
    this.deepOpen = false;
    this.floorOverS = 0;
    const p = this.pinned();
    if (p !== null) { this.scale = p; this.last = `quality ${q}`; }
    else {
      this.scale = this.startLow ? this.min : this.max;
      this.last = this.startLow ? 'quality auto (touch: from the floor)' : 'quality auto';
      this.n = 0; this.winS = 0;
      this.probeAfter = 8;
    }
  }

  private pinned(): number | null { return this.quality === 'high' ? this.max : this.quality === 'low' ? this.min : null; }

  graceFor(s: number): void { this.grace = Math.max(this.grace, s); this.n = 0; this.winS = 0; }

  private set(v: number, why: string): boolean {
    const lo = this.lo();
    const q = Math.min(this.max, Math.max(lo, Math.round(v / STEP_QUANT) / (1 / STEP_QUANT)));
    const nv = q > this.max - STEP_QUANT * 0.5 ? this.max : q < lo + STEP_QUANT * 0.5 ? lo : q;
    if (Math.abs(nv - this.scale) < 1e-6) return false;
    this.scale = nv; this.changes++; this.last = why;
    this.cooldown = 2; this.overRun = 0; this.spareRun = 0; this.held = 0;
    return true;
  }

  frame(ms: number, playing: boolean): boolean {
    if (this.quality !== 'auto' || !playing || !(ms > 0) || ms > 250) return false;
    const s = ms / 1000;
    if (this.grace > 0) { this.grace -= s; return false; }
    if (this.n < this.buf.length) this.buf[this.n++] = ms;
    this.winS += s;
    if (this.winS < WINDOW_S) return false;
    const n = this.n;
    this.sorted.set(this.buf.subarray(0, n));
    const view = this.sorted.subarray(0, n);
    view.sort();
    const p10 = percentile(view, n, 0.10);
    this.p90 = percentile(view, n, 0.90);
    this.n = 0; this.winS = 0;
    this.clocks.push(p10);
    if (this.clocks.length > 5) this.clocks.shift();
    this.clockMs = Math.min(...this.clocks);
    this.targetMs = this.clockMs >= CLOCK50_LO_MS && this.clockMs <= CLOCK50_HI_MS ? this.clockMs : FPS60_MS;
    const r = this.p90 / this.targetMs;
    if (this.scale <= this.min + 1e-6 && r > 1.1) this.floorOverS += WINDOW_S; else this.floorOverS = 0;
    if (this.deepOpen && this.scale > this.min + 1e-6) this.deepOpen = false;
    if (!this.deepOpen && this.deepMin < this.min - 1e-6 && this.floorOverS >= DEEP_AFTER_S) {
      this.deepOpen = true;
      this.floorOverS = 0;
      this.last = `deep floor ${this.deepMin.toFixed(2)} opened`;
      return this.set(this.scale * Math.min(0.95, Math.max(0.8, Math.sqrt(this.targetMs / this.p90))), this.last);
    }
    if (this.cooldown > 0) { this.cooldown--; return false; }
    if (this.probeFrom > 0) {
      this.probeWindows++;
      if (r > 1.2) {
        const back = this.probeFrom;
        this.probeFrom = 0;
        this.probeAfter = Math.min(128, this.probeAfter * 2);
        return this.set(back, `probe undone (p90 ${this.p90.toFixed(1)} ms)`);
      }
      if (this.probeWindows >= 2) { this.probeFrom = 0; this.probeAfter = 8; }
    }
    if (r > 1.2) {
      this.overRun++; this.spareRun = 0; this.held = 0;
      if (this.overRun < 2 && r <= 1.8) return false;
      const f = Math.min(0.95, Math.max(0.8, Math.sqrt(this.targetMs / this.p90)));
      return this.set(this.scale * f, `down (p90 ${this.p90.toFixed(1)} ms)`);
    }
    this.overRun = 0;
    if (r < 0.8) {
      if (this.scale >= this.max) return false;
      if (++this.spareRun < 2) return false;
      return this.set(this.scale * 1.08, `up (p90 ${this.p90.toFixed(1)} ms, headroom)`);
    }
    this.spareRun = 0;
    if (r <= 1.1) {
      this.held += WINDOW_S;
      if (this.held >= this.probeAfter && this.scale < this.max && this.probeFrom === 0) {
        const from = this.scale;
        if (this.set(this.scale * 1.05, `probe up (held ${this.probeAfter} s)`)) { this.probeFrom = from; this.probeWindows = 0; return true; }
      }
      return false;
    }
    this.held = 0;
    return false;
  }
}

/** opaque render-list order: front to back after groupOrder / renderOrder */
export function frontToBack(a: THREE.RenderItem, b: THREE.RenderItem): number {
  return (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (a.z - b.z) || (a.id - b.id);
}

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

export interface RendererOptions { quality: Quality; touch: boolean }

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly gov: ResolutionGovernor;
  quality: Quality;
  touch: boolean;
  /** increments whenever the drawing-buffer size changes (post / outline listeners compare it) */
  sizeVersion = 0;
  /** drawing-buffer size (px) and CSS size */
  readonly buffer = new THREE.Vector2(1, 1);
  readonly css = new THREE.Vector2(1, 1);
  private lastW = 0;
  private lastH = 0;
  private lastScale = 0;
  private lastDpr = 1;
  private gpuName = '';

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions) {
    this.canvas = canvas;
    this.quality = opts.quality;
    this.touch = opts.touch;
    const r = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false,
      preserveDrawingBuffer: false, depth: true,
    });
    if (!r.capabilities.isWebGL2) throw new Error('WebGL 2 is required (this context is WebGL 1)');
    this.three = r;
    const b = scaleBounds();
    this.gov = new ResolutionGovernor(b.min, b.max, b.deep);
    this.gov.startLow = this.touch;
    this.gov.setQuality(this.quality === 'low' ? 'low' : 'auto');
    this.lastDpr = window.devicePixelRatio || 1;
    r.setPixelRatio(this.gov.scale);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    r.setClearColor(0x0b0a10, 1);
    r.setOpaqueSort(frontToBack);
    this.resize();
  }

  /** shadow-map size the scene's key light should use (CONTRACT §7: 1024; 'low' 512) */
  shadowSize(): number { return this.quality === 'low' ? 512 : 1024; }

  /** bloom allowed by quality (the setting may still turn it off) */
  bloomAllowed(): boolean { return this.quality === 'high' && !this.touch; }

  setQuality(q: Quality): void {
    this.quality = q;
    this.gov.setQuality(q === 'low' ? 'low' : 'auto');
    this.resize();
  }

  /** call once per rendered frame before the first render(): honest per-frame counters (E35) */
  beginFrame(): void { this.three.info.reset(); }

  /** feed one rAF interval (ms); `playing` false keeps the governor idle (menus, pause) */
  frameTime(ms: number, playing: boolean): void {
    if (this.gov.frame(ms, playing)) this.resize();
  }

  graceFor(s: number): void { this.gov.graceFor(s); }

  /** Fit the drawing buffer to the canvas' CSS size x the governor scale. Returns true when it changed. */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this.lastDpr) { this.lastDpr = dpr; const b = scaleBounds(); this.gov.setBounds(b.min, b.max, b.deep); }
    const w = Math.max(1, Math.floor(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight || window.innerHeight));
    const scale = this.gov.scale;
    if (w === this.lastW && h === this.lastH && scale === this.lastScale) return false;
    this.lastW = w; this.lastH = h; this.lastScale = scale;
    this.three.setPixelRatio(scale);
    this.three.setSize(w, h, false);
    this.css.set(w, h);
    this.three.getDrawingBufferSize(this.buffer);
    this.sizeVersion++;
    return true;
  }

  gpu(): string {
    if (this.gpuName) return this.gpuName;
    try {
      const gl = this.three.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch { this.gpuName = 'unknown'; }
    return this.gpuName;
  }

  info(): RenderInfo {
    const i = this.three.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles, programs: i.programs ? i.programs.length : 0,
      textures: i.memory.textures, geometries: i.memory.geometries, scale: this.gov.scale, quality: this.quality,
      gpu: this.gpu(), buffer: [this.buffer.x, this.buffer.y], p90: this.gov.p90, targetMs: this.gov.targetMs,
      changes: this.gov.changes, last: this.gov.last,
    };
  }

  dispose(): void {
    this.three.dispose();
  }
}
