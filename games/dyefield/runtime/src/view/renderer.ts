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
// Deep floor (PERF lane): the regular floor max(0.75, 0.6 × DPR) holds a DPR-1 screen at 0.75. When
// the scale already sits on that floor and p90 stays over 1.1 × target for DEEP_AFTER_S (3) consecutive
// windows, the floor opens down to 0.6 × DPR (0.6 on a DPR-1 laptop) and the governor keeps stepping.
// It closes again once the scale climbs back above the regular floor. 'low' still pins the regular floor.
// Why so conservative (phase 5, 8 runners): a scale change reallocates the drawing buffer, and on
// the dev box's shared Intel iGPU (dwm + a display-driver host hold 30–45 % of its 3D engine) that
// reallocation measured 257–383 ms in one frame. A governor that reacts to every noisy window pays
// that hitch over and over; one that changes rarely pays it once.
// quality 'high' pins the cap, 'low' pins the floor (Settings hook; no UI this phase).
//
// Opaque draw order (PERF lane): strictly front to back (groupOrder, renderOrder, then view depth).
// three's default sorts by material id before depth, so a wall drawn after the floor behind it made
// every floor pixel run the full dye / surface shader before being overdrawn. Measured with the
// frame-interleaved A/B bench (_harness/abperf.py): 4–8 % less GPU time per frame on all three maps.
// `renderer.dfOpaqueSort` exposes the function so the bench can restore it after a variant.
//
// CONTRACT_MOBILE M7 — the touch profile (createRenderer opts.touch, or rig.setTouchProfile on a hybrid switch):
//   * quality 'auto' STARTS at the regular floor (max(0.75, 0.6 × DPR)) instead of the cap, and the governor above
//     climbs from there (spare / probe windows); the cap stays min(1.5, DPR).
//   * shadowMapCap(): 1024 on touch (the sun's map is authored at 1024, view/sky.ts), 512 once the governor has sat
//     on the floor OVER BUDGET (the last window's p90 > 1.1 × target, the deep-floor test) for SHADOW_DROP_S (5) s of
//     play; back to 1024 after 5 s with the scale above the floor (it had headroom to climb). "Over budget" matters:
//     at DPR ≥ 2.5 the regular floor max(0.75, 0.6 × DPR) reaches the cap min(1.5, DPR), so a phone sits "on the
//     floor" from the first frame even at a steady 60 fps. Infinity off touch (the desktop map is never touched).
//     game.ts applies it to the scene's sun. Integration fix: at DPR ≥ 2.5 the scale can never leave the floor, so the
//     "above the floor" way back never opens and one 5 s hitch kept 512 for the rest of the session. 1024 is now also
//     PROBED again after SHADOW_PROBE_S (15) s within budget at 512; each repeat drop doubles that wait (max 120 s), so
//     a phone that cannot hold 1024 settles on 512 instead of flipping (the governor's own probe-up pattern).
//   * antialias is chosen at context creation (it cannot change later): main.ts turns it OFF on a touch device with
//     DPR ≥ 2 (?aa=0|1 overrides for A/B measurement). At DPR ≥ 2 the drawing buffer is already ≥ 1.2 × CSS px at
//     the touch floor, so MSAA's cost buys little there. Measured 2026-09-29 (dev box Intel UHD iGPU, headless Chrome,
//     Pixel-7 emulation 844×390 @ DPR 3 → buffer 1266×585, Pier 18 match, A B A B, 8 s each; the iGPU is shared with
//     other sessions, so informational): vsync-capped both hold the 50 Hz display (50 fps, p90 20.2 ms); uncapped
//     (--disable-gpu-vsync --disable-frame-rate-limit) p90 8.4 / 9.0 ms with MSAA vs 5.3 / 7.4 ms without (fps median
//     99.5 / 120.6 vs 168.1 / 115.5) — roughly 1.6–3 ms of GPU time per frame saved.

import * as THREE from 'three';

export const MAX_DPR = 1.5;
/** floor of the adaptive pixel ratio: max(ABS_MIN_SCALE, MIN_SCALE_OF_DPR × devicePixelRatio) */
export const MIN_SCALE_OF_DPR = 0.6;
export const ABS_MIN_SCALE = 0.75;
/** the deep floor on 'auto' (DEEP_OF_DPR × devicePixelRatio), opened by a sustained overload at the floor */
export const DEEP_OF_DPR = 0.6;
/** seconds (1 s windows) of p90 > 1.1 × target at the regular floor before the deep floor opens */
export const DEEP_AFTER_S = 3;
/** CONTRACT_MOBILE M7: the touch shadow-map cap, and the floor-held seconds that drop it to SHADOW_LOW */
export const SHADOW_TOUCH = 1024;
export const SHADOW_LOW = 512;
export const SHADOW_DROP_S = 5;
/** seconds within budget at 512 before 1024 is tried again (doubled after each repeat drop, up to the max) */
export const SHADOW_PROBE_S = 15;
export const SHADOW_PROBE_MAX_S = 120;

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
  /** the floor in effect (the deep floor while it is open) */
  min: number;
  max: number;
  /** the regular floor max(0.75, 0.6 × DPR) and the deep floor 0.6 × DPR; deepOpen = the deep floor is in effect */
  floor: number;
  deepMin: number;
  deepOpen: boolean;
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
  /** CONTRACT_MOBILE M7: the touch profile on / off (a hybrid device switched input method) */
  setTouchProfile(on: boolean): void;
  /** CONTRACT_MOBILE M7: the largest shadow map the sun may use now (Infinity = no cap: desktop) */
  shadowMapCap(): number;
  /** CONTRACT_MOBILE M7 read-back: the profile, the context's antialias, the shadow cap, the floor-held seconds, the
   *  512 drops so far, the current probe wait and the seconds the budget has held (the probe back to 1024) */
  mobile(): { touch: boolean; antialias: boolean; shadowCap: number; floorHeldS: number; startScale: number;
    shadowDrops: number; shadowProbeS: number; budgetHeldS: number };
}

export interface RendererOptions {
  /** CONTRACT_MOBILE M7 touch profile (start 'auto' at the floor, cap the shadow map) */
  touch?: boolean;
  /** the WebGL context's antialias (fixed at creation; default true) */
  antialias?: boolean;
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
  /** the deep floor (≤ min) and whether it is open; seconds over target while sitting on the floor */
  deepMin: number;
  deepOpen = false;
  private floorOverS = 0;
  /** CONTRACT_MOBILE M7: 'auto' starts at the regular floor instead of the cap (the touch profile) */
  startLow = false;

  constructor(min: number, max: number, deepMin: number = min) {
    this.min = min;
    this.max = max;
    this.deepMin = Math.min(min, deepMin);
    this.scale = max;
  }

  /** the floor in effect */
  lo(): number {
    return this.deepOpen && this.quality === 'auto' ? this.deepMin : this.min;
  }

  setBounds(min: number, max: number, deepMin: number = min): void {
    this.min = min;
    this.max = max;
    this.deepMin = Math.min(min, deepMin);
    this.scale = this.pinned() ?? Math.min(max, Math.max(this.lo(), this.scale));
  }

  setQuality(q: RenderQuality): void {
    this.quality = q;
    this.deepOpen = false;
    this.floorOverS = 0;
    const p = this.pinned();
    if (p !== null) { this.scale = p; this.last = `quality ${q}`; }
    else {
      this.scale = this.startLow ? this.min : this.max;
      this.last = this.startLow ? 'quality auto (touch: from the floor)' : 'quality auto';
      this.resetWindow();
      this.probeAfter = 8;
    }
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
    const lo = this.lo();
    const q = Math.min(this.max, Math.max(lo, Math.round(v / STEP_QUANT) / (1 / STEP_QUANT)));
    const nv = q > this.max - STEP_QUANT * 0.5 ? this.max : q < lo + STEP_QUANT * 0.5 ? lo : q;
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
    const r = this.p90 / this.targetMs;
    // deep floor: a sustained overload while already on the regular floor opens it (see the header)
    if (this.scale <= this.min + 1e-6 && r > 1.1) this.floorOverS += WINDOW_S;
    else this.floorOverS = 0;
    if (this.deepOpen && this.scale > this.min + 1e-6) this.deepOpen = false;
    if (!this.deepOpen && this.deepMin < this.min - 1e-6 && this.floorOverS >= DEEP_AFTER_S) {
      this.deepOpen = true;
      this.floorOverS = 0;
      this.last = `deep floor ${this.deepMin.toFixed(2)} opened (p90 ${this.p90.toFixed(1)} ms at the floor for ${DEEP_AFTER_S} s)`;
      return this.set(this.scale * Math.min(0.95, Math.max(0.8, Math.sqrt(this.targetMs / this.p90))), this.last);
    }
    if (this.cooldown > 0) { this.cooldown--; return false; }

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
      quality: this.quality, scale: this.scale, min: this.lo(), max: this.max, targetMs: this.targetMs,
      p90: this.p90, clockMs: this.clockMs, changes: this.changes, last: this.last,
      floor: this.min, deepMin: this.deepMin, deepOpen: this.deepOpen && this.quality === 'auto',
    };
  }
}

/** opaque render-list order: front to back after groupOrder / renderOrder (see the header) */
export function frontToBack(a: THREE.RenderItem, b: THREE.RenderItem): number {
  return (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (a.z - b.z) || (a.id - b.id);
}

export function createRenderer(canvas: HTMLCanvasElement, toneMap: string = 'neutral', quality: RenderQuality = 'auto',
  opts: RendererOptions = {}): RendererRig {
  const antialias = opts.antialias !== false;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is required (this context is WebGL 1)');
  const b0 = scaleBounds();
  const gov = new ResolutionGovernor(b0.min, b0.max, b0.deep);
  let touch = opts.touch === true;
  gov.startLow = touch;
  gov.setQuality(quality);
  const startScale = gov.scale;
  // M7 shadow cap: seconds the governor has held the floor over budget / stayed above the floor / held the budget at
  // 512 (play time only), the latch, the current probe wait and the drop count
  let floorS = 0, aboveS = 0, okS = 0, shadowLow = false, probeS = SHADOW_PROBE_S, shadowDrops = 0;
  renderer.setPixelRatio(gov.scale);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE_MAPS[toneMap] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x9cd3ff, 1);
  renderer.setOpaqueSort(frontToBack);
  (renderer as THREE.WebGLRenderer & { dfOpaqueSort?: typeof frontToBack }).dfOpaqueSort = frontToBack;

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
        gov.setBounds(b.min, b.max, b.deep);
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
      if (!touch || !playing || gov.quality !== 'auto' || !(ms > 0) || ms > 250) return;
      const s = ms / 1000;
      const atFloor = gov.scale <= gov.min + 1e-6;
      const over = gov.p90 > 1.1 * gov.targetMs;
      if (atFloor && over) floorS += s; else floorS = 0;
      if (atFloor) aboveS = 0; else aboveS += s;
      if (over) okS = 0; else okS += s;
      if (!shadowLow && floorS >= SHADOW_DROP_S) {
        shadowLow = true; okS = 0; shadowDrops++;
        if (shadowDrops > 1) probeS = Math.min(SHADOW_PROBE_MAX_S, probeS * 2);   // 1024 failed again: wait longer
      } else if (shadowLow && (aboveS >= SHADOW_DROP_S || okS >= probeS)) {
        shadowLow = false; floorS = 0;
      }
    },
    graceFor(seconds) {
      gov.graceFor(seconds);
    },
    setQuality(q) {
      gov.setQuality(q);
      // review B-F3: a player's QUALITY pick clears the touch shadow latch. frameTime() only runs the shadow bookkeeping
      // under 'auto', so a 512 cap latched there used to stay for the rest of the page after HIGH (or LOW); back to
      // 'auto' starts the 1024 → 512 watch afresh
      floorS = 0; aboveS = 0; okS = 0; shadowLow = false; probeS = SHADOW_PROBE_S; shadowDrops = 0;
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
    setTouchProfile(on) {
      if (on === touch) return;
      touch = on;
      gov.startLow = on;                          // the next setQuality('auto') starts from there
      floorS = 0; aboveS = 0; okS = 0; shadowLow = false; probeS = SHADOW_PROBE_S; shadowDrops = 0;
    },
    shadowMapCap() {
      if (!touch) return Infinity;
      return shadowLow && gov.quality === 'auto' ? SHADOW_LOW : SHADOW_TOUCH;
    },
    mobile() {
      let aa = antialias;
      try { aa = renderer.getContext().getContextAttributes()?.antialias ?? antialias; } catch { /* lost */ }
      return { touch, antialias: aa, shadowCap: rig.shadowMapCap(), floorHeldS: Math.round(floorS * 10) / 10, startScale,
        shadowDrops, shadowProbeS: probeS, budgetHeldS: Math.round(okS * 10) / 10 };
    },
  };
  return rig;
}
