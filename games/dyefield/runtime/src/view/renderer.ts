// DYEFIELD — WebGL2 renderer setup (CONTRACT §5.1): antialias, DPR ≤ 1.5, Neutral tone mapping
// (CHANGED(integrator) from AgX, see CONTRACT §5.1), sRGB output,
// PCF shadows, honest per-frame counters (info.autoReset = false; reset once per frame).
// three r186 removed PCFSoftShadowMap (it warns and falls back); PCFShadowMap is the soft PCF path
// (the sun's shadow.radius sets the softness).
//
// GPU choice: the context asks for powerPreference 'high-performance' (the discrete GPU on a dual-GPU
// laptop). Measured on the dev box (Chrome 153, Windows 11, Intel UHD 0x9A60 + RTX A2000 Laptop):
// Chrome does NOT honour it on Windows — 'default', 'low-power' and 'high-performance' WebGL2
// contexts all report the Intel UHD, and WebGPU warns that powerPreference is ignored on Windows
// (crbug.com/369219127). The GPU a player gets there is chosen by Windows (Settings → Display →
// Graphics → Chrome → High performance), so the frame rate is held by the adaptive resolution below.
//
// Adaptive render resolution (quality 'auto'): the drawing-buffer pixel ratio moves between a floor
// (max(0.75, 0.6 × devicePixelRatio)) and the cap (min(1.5, devicePixelRatio)) to hold the frame
// rate. The judge is the p90 frame time over 1 s windows against a target interval: 60 fps, or the
// display's own ~50 Hz clock when that is what the fastest frames sit on (a 50 Hz monitor can never
// show 60 fps, so it must not drive the scale to the floor — the dev box's only display is 50 Hz).
// Frame intervals cannot tell a vsync-capped 50 Hz display from an uncapped GPU that happens to run
// at a steady 50 fps; the latter only exists with dev flags (--disable-gpu-vsync). Hysteresis:
//   * over   p90 > 1.2 × target        → step down (∝ √(target / p90), 5–20 % per step) — on the
//                                         SECOND consecutive over-window (one noisy window is not a
//                                         trend), or at once when p90 > 1.8 × target
//   * spare  p90 < 0.8 × target        → step up 8 % after two consecutive spare windows (headroom is
//                                         visible: uncapped / high-Hz display)
//   * hold   p90 ≤ 1.1 × target        → after `probeAfter` held seconds, probe up 5 %; a probe that
//                                         turns into 'over' within 2 windows is undone and the next
//                                         probe waits twice as long (8 s → 128 s max)
//   * between 1.1× and 1.2×            → no change (the dead band)
// Nothing scales during the first 2 s of play, nor in the 2 windows right after a change.
// Why so conservative (phase 5, 8 runners): a scale change reallocates the drawing buffer, and on
// the dev box's shared Intel iGPU (dwm + a display-driver host hold 30–45 % of its 3D engine) that
// reallocation measured 257–383 ms in one frame. A governor that reacts to every noisy window pays
// that hitch over and over; one that changes rarely pays it once.
// quality 'high' pins the cap, 'low' pins the floor (Settings hook; no UI this phase).

import * as THREE from 'three';

export const MAX_DPR = 1.5;
/** floor of the adaptive pixel ratio: max(ABS_MIN_SCALE, MIN_SCALE_OF_DPR × devicePixelRatio) */
export const MIN_SCALE_OF_DPR = 0.6;
export const ABS_MIN_SCALE = 0.75;

export type RenderQuality = 'auto' | 'high' | 'low';
export const RENDER_QUALITIES: readonly RenderQuality[] = ['auto', 'high', 'low'];
export function isRenderQuality(v: unknown): v is RenderQuality {
  return v === 'auto' || v === 'high' || v === 'low';
}

/** what the adaptive governor is doing (F1 panel, __DF__.render(), perfcheck) */
export interface AdaptiveInfo {
  quality: RenderQuality;
  /** current drawing-buffer pixel ratio */
  scale: number;
  min: number;
  max: number;
  /** target frame interval (ms) the governor holds */
  targetMs: number;
  /** p90 frame time (ms) of the last full 1 s window (0 before the first) */
  p90: number;
  /** the display's frame clock estimate (ms) */
  clockMs: number;
  changes: number;
  last: string;
}

export interface RendererRig {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** call once per rendered frame before the first render() */
  beginFrame(): void;
  /** fit the drawing buffer to the canvas' CSS size × the current render scale; true when it changed */
  resize(camera: THREE.PerspectiveCamera): boolean;
  /** feed one frame interval (ms); `playing` false keeps the governor idle (menus, pause) */
  frameTime(ms: number, playing: boolean): void;
  /** (re)start the no-scaling grace period — called when play (re)starts */
  graceFor(seconds: number): void;
  setQuality(q: RenderQuality): void;
  adaptive(): AdaptiveInfo;
  stats(): { calls: number; triangles: number; programs: number; textures: number; geometries: number; scale: number };
  gpu(): string;
}

/** true when this browser can create a WebGL2 context at all (asked the same way the game asks) */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** tone-mapping operators selectable with the dev query param ?tonemap= (default Neutral, CONTRACT §5.1) */
export const TONE_MAPS: Record<string, THREE.ToneMapping> = {
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  none: THREE.NoToneMapping,
};

const FPS60_MS = 1000 / 60;
/** a measured frame clock inside this band is a ~50 Hz display (the only sub-60 clock honoured) */
const CLOCK50_LO_MS = 19.5;
const CLOCK50_HI_MS = 20.5;
const WINDOW_S = 1.0;
const STEP_QUANT = 0.025;

function scaleBounds(): { min: number; max: number } {
  const dpr = window.devicePixelRatio || 1;
  const max = Math.min(MAX_DPR, dpr);
  const min = Math.min(max, Math.max(ABS_MIN_SCALE, MIN_SCALE_OF_DPR * dpr));
  return { min, max };
}

function percentile(sorted: Float32Array, n: number, p: number): number {
  if (n <= 0) return 0;
  const k = Math.min(n - 1, Math.max(0, Math.round((n - 1) * p)));
  return sorted[k];
}

/** The resolution governor (pure logic; the rig applies its scale). */
export class ResolutionGovernor {
  quality: RenderQuality = 'auto';
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
  private probeFrom = 0;          // scale before the pending probe (0 = none)
  private probeWindows = 0;
  private readonly clocks: number[] = [];

  constructor(min: number, max: number) {
    this.min = min;
    this.max = max;
    this.scale = max;
  }

  setBounds(min: number, max: number): void {
    this.min = min;
    this.max = max;
    this.scale = this.pinned() ?? Math.min(max, Math.max(min, this.scale));
  }

  setQuality(q: RenderQuality): void {
    this.quality = q;
    const p = this.pinned();
    if (p !== null) { this.scale = p; this.last = `quality ${q}`; }
    else { this.scale = this.max; this.last = 'quality auto'; this.resetWindow(); this.probeAfter = 8; }
  }

  private pinned(): number | null {
    return this.quality === 'high' ? this.max : this.quality === 'low' ? this.min : null;
  }

  graceFor(s: number): void {
    this.grace = Math.max(this.grace, s);
    this.resetWindow();
  }

  private resetWindow(): void {
    this.n = 0;
    this.winS = 0;
  }

  private set(v: number, why: string): boolean {
    const q = Math.min(this.max, Math.max(this.min, Math.round(v / STEP_QUANT) / (1 / STEP_QUANT)));
    const nv = q > this.max - STEP_QUANT * 0.5 ? this.max : q < this.min + STEP_QUANT * 0.5 ? this.min : q;
    if (Math.abs(nv - this.scale) < 1e-6) return false;
    this.scale = nv;
    this.changes++;
    this.last = why;
    this.cooldown = 2;          // skip the window that contains the buffer reallocation, and the next
    this.overRun = 0;
    this.spareRun = 0;
    this.held = 0;
    return true;
  }

  /** one frame interval in ms; returns true when the scale changed */
  frame(ms: number, playing: boolean): boolean {
    if (this.quality !== 'auto' || !playing || !(ms > 0) || ms > 250) return false;
    const s = ms / 1000;
    if (this.grace > 0) { this.grace -= s; return false; }
    if (this.n < this.buf.length) this.buf[this.n++] = ms;
    this.winS += s;
    if (this.winS < WINDOW_S) return false;

    // ── one full window
    const n = this.n;
    this.sorted.set(this.buf.subarray(0, n));
    const view = this.sorted.subarray(0, n);
    view.sort();
    const p10 = percentile(view, n, 0.10);
    this.p90 = percentile(view, n, 0.90);
    this.resetWindow();
    // the display's frame clock: the fastest frames of the last few windows sit on its tick. Only a
    // ~50 Hz clock (19.5–20.5 ms) replaces the 60 fps target: a 50 Hz monitor (or headless Chrome on
    // a box whose primary display is 50 Hz) can never show 60, so chasing 16.7 ms there would only
    // drive the scale to the floor. Any other clock (60 / 120 / 144 Hz …) keeps the 60 fps target.
    this.clocks.push(p10);
    if (this.clocks.length > 5) this.clocks.shift();
    this.clockMs = Math.min(...this.clocks);
    this.targetMs = this.clockMs >= CLOCK50_LO_MS && this.clockMs <= CLOCK50_HI_MS ? this.clockMs : FPS60_MS;
    if (this.cooldown > 0) { this.cooldown--; return false; }

    const r = this.p90 / this.targetMs;
    if (this.probeFrom > 0) {
      this.probeWindows++;
      if (r > 1.2) {                          // the probe cost frames: undo it, back off
        const back = this.probeFrom;
        this.probeFrom = 0;
        this.probeAfter = Math.min(128, this.probeAfter * 2);
        return this.set(back, `probe undone (p90 ${this.p90.toFixed(1)} ms)`);
      }
      if (this.probeWindows >= 2) { this.probeFrom = 0; this.probeAfter = 8; }
    }
    if (r > 1.2) {
      this.overRun++;
      this.spareRun = 0;
      this.held = 0;
      if (this.overRun < 2 && r <= 1.8) return false;   // one noisy window is not a trend
      const f = Math.min(0.95, Math.max(0.8, Math.sqrt(this.targetMs / this.p90)));
      return this.set(this.scale * f, `down (p90 ${this.p90.toFixed(1)} ms > ${(1.2 * this.targetMs).toFixed(1)})`);
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
        if (this.set(this.scale * 1.05, `probe up (held ${this.probeAfter} s)`)) {
          this.probeFrom = from;
          this.probeWindows = 0;
          return true;
        }
      }
      return false;
    }
    this.held = 0;                            // dead band
    return false;
  }

  info(): AdaptiveInfo {
    return {
      quality: this.quality, scale: this.scale, min: this.min, max: this.max, targetMs: this.targetMs,
      p90: this.p90, clockMs: this.clockMs, changes: this.changes, last: this.last,
    };
  }
}

export function createRenderer(canvas: HTMLCanvasElement, toneMap: string = 'neutral', quality: RenderQuality = 'auto'): RendererRig {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required (this context is WebGL 1)');
  const b0 = scaleBounds();
  const gov = new ResolutionGovernor(b0.min, b0.max);
  gov.setQuality(quality);
  renderer.setPixelRatio(gov.scale);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPS[toneMap] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x9cd3ff, 1);

  let lastW = 0, lastH = 0, lastScale = 0, lastDpr = window.devicePixelRatio || 1;
  const rig: RendererRig = {
    renderer,
    canvas,
    beginFrame() {
      renderer.info.reset();
    },
    resize(camera) {
      const dpr = window.devicePixelRatio || 1;
      if (dpr !== lastDpr) {                    // moved to another monitor / zoom changed
        lastDpr = dpr;
        const b = scaleBounds();
        gov.setBounds(b.min, b.max);
      }
      const w = Math.max(1, Math.floor(canvas.clientWidth || window.innerWidth));
      const h = Math.max(1, Math.floor(canvas.clientHeight || window.innerHeight));
      const scale = gov.scale;
      if (w === lastW && h === lastH && scale === lastScale) return false;
      const sized = w !== lastW || h !== lastH;
      lastW = w; lastH = h; lastScale = scale;
      renderer.setPixelRatio(scale);
      renderer.setSize(w, h, false);
      if (sized) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      return true;
    },
    frameTime(ms, playing) {
      gov.frame(ms, playing);
    },
    graceFor(seconds) {
      gov.graceFor(seconds);
    },
    setQuality(q) {
      gov.setQuality(q);
    },
    adaptive() {
      return gov.info();
    },
    stats() {
      const i = renderer.info;
      return {
        calls: i.render.calls,
        triangles: i.render.triangles,
        programs: i.programs ? i.programs.length : 0,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
        scale: gov.scale,
      };
    },
    gpu() {
      try {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch {
        return 'unknown';
      }
    },
  };
  return rig;
}
