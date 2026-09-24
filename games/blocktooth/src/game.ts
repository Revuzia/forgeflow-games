// BLOCKTOOTH — the app: state machine + frame wiring (CONTRACT.md §14, §6, §12, §13, §3). app lane.
//
//   boot → title → select → loading → slate → play ⇄ draft / pause → end (tabloid)
//
//   * ONE GameLoop drives everything. onStep = one sim tick: stepWorld(world, input.titanInput());
//     every tick's events are copied (world.events is cleared per tick) into the frame list and
//     the 400-event ring the test surface reads. onFrame = input.update → camera → lighting →
//     every ViewModule → HUD / boss bar / broadcast / audio → render.
//   * The sim is FROZEN (loop.simEnabled = false, accumulator discarded — doctrine §5) for the
//     slate, drafts, pause, the run-end aftermath and the tabloid. Views keep idling cosmetics.
//   * Rank-up = hit-stop (loop.timeScale 0.15 for 0.25 s real time) + broadcast.sizeUp + a music
//     intensity sting; the camera rig reads the same rankUp event for its punch + zoom-out (§3/§4).
//   * A pending draft (hasPendingDraft) freezes the sim INSIDE the tick that granted it, then the
//     DraftScreen loops (reroll → rerollOffer, pick → pickUpgrade) until no draft is owed.
//   * runEnd → 2.5 s aftermath (sim stopped, fx still playing) → one render → the freeze-frame
//     photo (canvas.toDataURL right after that render) → broadcast.tabloid → retry/select/title.
//   * Every await is guarded by a run EPOCH (doctrine §4): a stale continuation from a previous
//     flow no-ops. Loads are serialised by a lock so a view is never mounted twice at once.
//   * Errors: a boot/load failure or a sim exception surfaces in #fatal (onFatal); a view throwing
//     in a frame is logged and only escalates to #fatal if it keeps failing (60 frames in a row).

import type { AlertKey, BiomeId, RankIndex, SimEvent, TitanId, TitanInput, World } from './core/types.ts';
import { BIOME_IDS, TITAN_IDS } from './core/types.ts';
import { BUDGET, INPUT_BUFFER_S, SIM_DT } from './core/config.ts';
import { createWorld, stepWorld } from './core/world.ts';
import { GameLoop, frameStats } from './core/loop.ts';
import { Input } from './core/input.ts';
import { DebugOverlay } from './core/debug.ts';
import { bestKey, loadBest, loadSettings, saveBest, type Settings } from './core/save.ts';

import { createRenderCore, defaultQuality, type RenderCore, type RenderStats } from './render/renderer.ts';
import { CameraRig } from './render/camera.ts';
import { Lighting } from './render/lighting.ts';
import { EnvView } from './render/env.ts';
import { warmup } from './render/warmup.ts';
import { FrameProf } from './render/frameprof.ts';
import type { FrameInfo, Quality, ViewCtx, ViewModule } from './render/viewtypes.ts';
import { CityView } from './city/cityview.ts';
import { TitanView } from './titans/titanview.ts';
import { renderPortraits } from './titans/portraits.ts';
import { EnemyView } from './ai/enemyview.ts';
import { BossView } from './ai/bossview.ts';
import { TelegraphView } from './render/telegraphview.ts';
import { ProjectileView } from './render/projectileview.ts';
import { HazardView } from './render/hazardview.ts';
import { FxView } from './render/fx.ts';
import { DebrisView } from './render/debris.ts';
import { CivilianView } from './render/civilians.ts';
import { PickupView } from './render/pickupview.ts';

import { Hud } from './ui/hud.ts';
import { Broadcast, runFigures } from './ui/broadcast.ts';
import { BossBar } from './ui/bossbar.ts';
import { SelectScreen } from './ui/select.ts';
import { DraftScreen } from './ui/draft.ts';
import { PauseMenu, TitleScreen } from './ui/menus.ts';

import { AudioEngine } from './audio/audio.ts';
import { Sfx } from './audio/sfx.ts';
import { Music } from './audio/music.ts';

import { TITANS } from './data/titans.ts';
import { BIOMES } from './data/biomes.ts';
import { BOSSES } from './data/bosses.ts';
import { UPGRADES, UPGRADE_BY_ID } from './data/upgrades.ts';
import { hasPendingDraft, pickUpgrade, rerollOffer, rollOffer } from './upgrades/draft.ts';

// ─────────────────────────────── types ───────────────────────────────

export type Screen = 'boot' | 'title' | 'select' | 'loading' | 'slate' | 'play' | 'draft' | 'pause' | 'end';

/** Which awaited modal screen currently owns input (so it can be closed on a forced transition). */
type Modal = 'title' | 'select' | 'slate' | 'draft' | 'pause' | 'end';

export interface AppParams {
  seed: number | null;
  titan: TitanId | null;
  biome: BiomeId | null;
  /** skip title + select: straight to loading → slate */
  autostart: boolean;
  /** cheats + debug conveniences */
  dev: boolean;
  /** session quality override (not saved) */
  quality: 0 | 1 | 2 | null;
  /** skip the open slate */
  noslate: boolean;
  /** adaptive render scale (default on; `?dynres=0` pins the drawing buffer at the quality DPR) */
  dynres: boolean;
  /** frame profiler (perf attribution; `?prof=1`, exposed as window.__BTPROF__) */
  prof: boolean;
}

export interface RunRequest {
  titan: TitanId;
  biome: BiomeId;
  seed: number;
  skipSlate?: boolean;
}

export type FatalHandler = (title: string, err: unknown) => void;

/** the one Object3D field the photo hides/restores (no three import needed in the app) */
type THREE_Object = { visible: boolean };

// ─────────────────────────────── tuning ───────────────────────────────

/** rank-up hit-stop (CONTRACT §3): sim time scale and real-time duration */
const HITSTOP_SCALE = 0.15;
const HITSTOP_S = 0.25;
/** frames drawn after a frozen modal's canvas changes size / quality before the picture is held
 *  again. On OPEN nothing is redrawn: the frame that opened the modal already drew the world at the
 *  tick it froze on (the only difference to a redraw is sub-tick interpolation, invisible under the
 *  modal's blurred, ~85 % opaque backdrop). The opening frames are when the GPU rasterises the modal's
 *  new DOM (three cards): ?prof=1 runs with 3 redrawn frames missed vsync on draft frames #2–#4. */
const HOLD_DRAWN = 1;
/** while hit-stop slows the sim, a buffered HOOK/DASH press must outlive one slowed tick (see Input.bufferS) */
const HITSTOP_BUFFER_S = Math.max(INPUT_BUFFER_S, SIM_DT / HITSTOP_SCALE + 0.02);
/**
 * A level-up owed in the same moment as a rank-up waits this long (real s) so the MASS BREACH
 * sting (broadcast SIZEUP_MS = 2.3 s: sweep in, hold, sweep out) is seen in full instead of being
 * frozen half-drawn under the MUTATION REPORT. The sim keeps running meanwhile.
 */
const SIZEUP_DRAFT_HOLD_S = 2.3;
/** real seconds between the runEnd event and the freeze-frame photo / tabloid */
const END_DELAY_S = 2.5;
/** scene roots hidden for the tabloid photo (live hostile warnings would bury the subject) */
const PHOTO_HIDDEN_ROOTS = ['view:telegraphs', 'view:hazards'] as const;
/** sim-event ring for __BT__.events(n) */
export const EVENT_RING = 400;
/** low-HP broadcast alert: fire below, re-arm above (fractions of max HP) */
const LOW_HP_FIRE = 0.25;
const LOW_HP_REARM = 0.45;
/** music intensity refresh period (s) */
const MUSIC_PERIOD_S = 0.25;
/** a view throwing this many frames in a row is a broken picture → #fatal */
const FRAME_ERROR_FATAL_STREAK = 60;
/** portrait size (px) for the select screen */
const PORTRAIT_PX = 320;

/** Loading-card copy (app-owned; data/strings.ts carries no boot/loading lines). */
const LOADING = {
  boot: 'PATCHING INTO WARD-7…',
  render: 'WARMING UP THE CAMERA VAN…',
  desk: 'SEATING THE NEWS DESK…',
  ready: 'ON AIR IN 3… 2…',
  portraits: 'DEVELOPING THE SIGHTING PHOTOS…',
  city: 'SURVEYING THE BLOCKS…',
  mount: 'ROLLING OUT THE CITY…',
  warm: 'FOCUSING THE LENS…',
  live: 'WE ARE LIVE',
} as const;

/** Keys that close each modal through its own UI path (used by forced transitions / harness). */
const CLOSE_KEY: Record<Exclude<Modal, 'slate' | 'end'>, { key: string; code: string }> = {
  title: { key: 'Enter', code: 'Enter' },
  select: { key: 'Escape', code: 'Escape' },
  draft: { key: '1', code: 'Digit1' },
  pause: { key: 'Escape', code: 'Escape' },
};

// ─────────────────────────────── small helpers ───────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function isTitan(v: string | null | undefined): v is TitanId {
  return !!v && (TITAN_IDS as readonly string[]).includes(v);
}
function isBiome(v: string | null | undefined): v is BiomeId {
  return !!v && (BIOME_IDS as readonly string[]).includes(v);
}

/** Parse the URL params of CONTRACT §14. Unknown / malformed values fall back to null/false. */
export function parseParams(search: string): AppParams {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  const flag = (k: string) => {
    const v = q.get(k);
    return v !== null && v !== '0' && v.toLowerCase() !== 'false';
  };
  const seedRaw = q.get('seed');
  let seed: number | null = null;
  if (seedRaw !== null && seedRaw.trim() !== '') {
    const n = Number(seedRaw);
    if (Number.isFinite(n)) seed = Math.abs(Math.floor(n)) >>> 0;
  }
  const qual = q.get('quality');
  const quality = qual === '0' || qual === '1' || qual === '2' ? (Number(qual) as 0 | 1 | 2) : null;
  const titan = (q.get('titan') || '').toLowerCase();
  const biome = (q.get('biome') || '').toLowerCase();
  return {
    seed,
    titan: isTitan(titan) ? titan : null,
    biome: isBiome(biome) ? biome : null,
    autostart: flag('autostart'),
    dev: flag('dev'),
    quality,
    noslate: flag('noslate'),
    dynres: q.get('dynres') === null ? true : flag('dynres'),
    prof: flag('prof'),
  };
}

/**
 * Adaptive render scale. On integrated GPUs a GPU-bound frame misses vsync and the frame rate
 * halves. Measured on the reference Intel UHD at Size V + 250 foes, 1280×720, render scale PINNED
 * (?rscale=, 12 s perfcheck window): 1.0 → 5.6 % of frames miss vsync (p99 40 ms); 0.8 → 0.8 %;
 * 0.7 → 0.3 %; 0.6 → 0.2 %. The WebGL work itself barely scales with resolution (GPU timer 15.4 →
 * 14.0 ms from 1.0 to 0.6) — the pixel-bound part is the MSAA resolve + compositing of the canvas,
 * outside the timer — so the controller watches missed vsyncs, not the timer.
 *
 * Every second of live play it counts frames slower than 1.5× the display interval (the interval =
 * the fastest 1-s p10 seen this session, i.e. measured on cheap menu frames), IGNORING misses that
 * followed a frame whose main-thread work (sim + views + UI, excluding the render call) already ate
 * most of the interval — resolution cannot fix those. A p99 ≤ 22 ms budget allows < 1 % misses, so
 * ≥ 3 % in a window steps down: −0.1, or −0.2 at ≥ 6 %, −0.3 at ≥ 15 % (one step instead of three:
 * every step reallocates the drawing buffer, which stalls 55–75 ms while the GPU queue is full).
 * After a step the next 0.75 s is not judged (the step's own stall is not evidence). Up: +0.1 after
 * UP_CLEAN_S of windows with < 1 % misses; a level that fails within 6 s of a step up is locked
 * out for 60 s so the scale never oscillates. The scale multiplies the quality DPR (drawing buffer
 * only; the CSS size and every layout stay unchanged).
 */
export class DynRes {
  scale = 1;
  /** dev/perf attribution: `?rscale=0.7` pins the scale (no adaptation) */
  pinned = false;
  private readonly win = new Float32Array(240);
  private readonly cpu = new Float32Array(240);
  private n = 0;
  private acc = 0;
  private interval = 0;          // estimated display interval (s); 0 = unknown
  /** last decision window's missed-frame fraction (−1 = no live window yet) — test surface */
  lastMiss = -1;
  /** decisions taken (down / up steps) — test surface */
  steps = { down: 0, up: 0 };
  get displayInterval(): number { return this.interval; }
  private clean = 0;
  private t = 0;
  private lastUpT = -1e9;
  private lockUntil = 0;
  private settleUntil = 0;
  /** floor: 0.6 × the quality DPR (1280×720 → 768×432 drawing buffer on the reference Intel UHD) */
  static readonly MIN = 0.6;
  /** step down when at least this fraction of a live 1-s window missed vsync (GPU-side misses) */
  static readonly DOWN_MISS = 0.03;
  /** step up only after UP_CLEAN_S of windows with fewer misses than this */
  static readonly CLEAN_MISS = 0.01;
  static readonly UP_CLEAN_S = 10;
  static readonly LOCK_S = 60;
  static readonly SETTLE_S = 0.75;

  /** Feed every rendered frame's dt (s). `live` = the sim is running (only live play adapts).
   *  `prevCpu` = main-thread seconds of the frame BEFORE this gap (render call excluded).
   *  Returns true when `scale` changed. */
  frame(dt: number, live: boolean, prevCpu = 0): boolean {
    if (!(dt > 0) || this.pinned) return false;
    this.t += dt;
    if (this.n < this.win.length) { this.win[this.n] = dt; this.cpu[this.n] = prevCpu; this.n++; }
    this.acc += dt;
    if (this.acc < 1) return false;
    // one decision window per second
    const n = this.n;
    const a = Array.prototype.slice.call(this.win, 0, n) as number[];
    a.sort((x, y) => x - y);
    const p10 = a[Math.floor(n * 0.1)] ?? 0;
    if (n >= 20 && p10 > 0.004 && (this.interval === 0 || p10 < this.interval)) this.interval = Math.min(p10, 1 / 24);
    let changed = false;
    if (live && n >= 10 && this.interval > 0 && this.t >= this.settleUntil) {
      const lim = this.interval * 1.5, cpuLim = this.interval * 0.75;
      let miss = 0;
      for (let i = 0; i < n; i++) if (this.win[i] > lim && this.cpu[i] < cpuLim) miss++;
      const frac = miss / n;
      this.lastMiss = frac;
      if (frac >= DynRes.DOWN_MISS) {
        this.clean = 0;
        if (this.scale > DynRes.MIN + 1e-3) {
          if (this.t - this.lastUpT < 6) this.lockUntil = this.t + DynRes.LOCK_S;
          const step = frac >= 0.15 ? 0.3 : frac >= 0.06 ? 0.2 : 0.1;
          this.scale = Math.max(DynRes.MIN, Math.round((this.scale - step) * 10) / 10);
          this.steps.down++;
          this.settleUntil = this.t + DynRes.SETTLE_S;
          changed = true;
        }
      } else if (frac < DynRes.CLEAN_MISS) {
        this.clean += this.acc;
        if (this.clean >= DynRes.UP_CLEAN_S && this.scale < 1 - 1e-3 && this.t >= this.lockUntil) {
          this.scale = Math.min(1, Math.round((this.scale + 0.1) * 10) / 10);
          this.steps.up++;
          this.lastUpT = this.t;
          this.settleUntil = this.t + DynRes.SETTLE_S;
          this.clean = 0;
          changed = true;
        }
      } else {
        this.clean = 0;
      }
    }
    this.n = 0;
    this.acc = 0;
    return changed;
  }
}

/** A fresh non-zero 31-bit seed (app-side: the sim only ever sees the number). */
export function freshSeed(): number {
  const s = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0x7fffffff)) >>> 0;
  return (s & 0x7fffffff) || 1;
}

/** Quality preset for a settings level (DPR ≤ BUDGET.dprMax always). */
export function qualityFor(level: 0 | 1 | 2, s: Settings): Quality {
  const base = defaultQuality();
  const cap = level === 0 ? 1 : level === 1 ? 1.25 : BUDGET.dprMax;
  return {
    dpr: Math.max(0.5, Math.min(base.dpr, cap, BUDGET.dprMax)),
    shadows: level > 0,
    level,
    reduceFlashing: !!s.reduceFlashing,
    screenShake: !!s.screenShake,
  };
}

/** rAF-or-timeout: lets the loading card paint, and never hangs in a hidden tab (rAF paused). */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(() => fin()); } catch { /* no rAF */ }
    setTimeout(fin, 120);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Dispatch a synthetic key press (down + up) on window — drives a UI screen through its own keys. */
function synthKey(key: string, code: string): void {
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
  } catch { /* no KeyboardEvent (non-browser) */ }
}

/** The loading / boot card from index.html (#boot). All no-ops when the page lacks it. */
class Splash {
  private readonly root: HTMLElement | null;
  private readonly fill: HTMLElement | null;
  private readonly status: HTMLElement | null;
  constructor(doc: Document) {
    this.root = doc.getElementById('boot');
    this.fill = doc.getElementById('boot-fill');
    this.status = doc.getElementById('boot-status');
  }
  show(text: string, frac: number): void {
    if (this.root) this.root.classList.remove('gone');
    this.set(text, frac);
  }
  set(text: string, frac: number): void {
    if (this.status && this.status.textContent !== text) this.status.textContent = text;
    if (this.fill) this.fill.style.width = `${Math.round(6 + 94 * clamp01(frac))}%`;
  }
  hide(): void { if (this.root) this.root.classList.add('gone'); }
  get visible(): boolean { return !!this.root && !this.root.classList.contains('gone'); }
}

// ─────────────────────────────── the app ───────────────────────────────

export class App {
  readonly params: AppParams;
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;

  // engine
  readonly input: Input;
  readonly loop: GameLoop;
  readonly core: RenderCore;
  readonly rig: CameraRig;
  readonly lighting: Lighting;
  readonly views: readonly ViewModule[];
  readonly debug: DebugOverlay;

  // ui
  readonly hud: Hud;
  readonly broadcast: Broadcast;
  readonly bossbar: BossBar;
  readonly titleScreen: TitleScreen;
  readonly selectScreen: SelectScreen;
  readonly draftScreen: DraftScreen;
  readonly pauseMenu: PauseMenu;

  // audio
  readonly audio: AudioEngine;
  readonly sfx: Sfx;
  readonly music: Music;

  /** called for unrecoverable errors (main.ts shows #fatal) */
  onFatal: FatalHandler = (title, err) => { console.error('[blocktooth]', title, err); };

  private _screen: Screen = 'boot';
  private _world: World | null = null;
  /** views mounted for the current world, in mount order */
  private mounted: ViewModule[] = [];
  /** world + views ready to update/render */
  private live = false;
  private epoch = 0;
  private loadLock: Promise<void> = Promise.resolve();
  private modal: Modal | null = null;
  private settings: Settings;
  private readonly splash: Splash;
  private portraits: Promise<Record<TitanId, string>> | null = null;
  private _choice: { titan: TitanId; biome: BiomeId; seed: number };

  // frame plumbing (double-buffered event lists: the list handed to views stays intact for a frame)
  private evA: SimEvent[] = [];
  private evB: SimEvent[] = [];
  private readonly noEvents: readonly SimEvent[] = [];
  private readonly ring: SimEvent[] = [];
  private ringHead = 0;
  private readonly fi: FrameInfo = { alpha: 1, dt: 0, time: 0, events: [], camDist: 1, frozen: true };
  private time = 0;

  // run-scoped app state
  private hitStopT = 0;
  /** real seconds left in which a newly owed draft waits for the MASS BREACH sting (0 = none) */
  private sizeUpHoldT = 0;
  /** adaptive render scale (see DynRes) */
  readonly dynres = new DynRes();
  /** wall ms inside core.render() this frame, and the previous frame's main-thread s without it (DynRes) */
  private renderMs = 0;
  private prevCpuS = 0;
  /** frames drawn since a frozen modal (draft / pause) opened, and the canvas key they were drawn at */
  private heldFrames = 0;
  private heldKey = '';
  /** ?prof=1 frame profiler (null otherwise) */
  readonly prof: FrameProf | null = null;
  private stingT = 0;
  private musicAcc = 0;
  private lowHpArmed = true;
  private wantDraft = false;
  private draftSuppressTick = -1;
  private ending = false;
  private endT = 0;
  private endResult: 'clear' | 'dead' | null = null;
  private _testFrozen = false;
  private forcedInput: TitanInput | null = null;

  // error accounting
  private frameErrStreak = 0;
  private frameErrTotal = 0;
  private fatalShown = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, params: AppParams) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.params = params;
    this.splash = new Splash(document);
    this.settings = loadSettings();
    this._choice = {
      titan: params.titan ?? 'molo',
      biome: params.biome ?? 'grideast',
      seed: params.seed ?? freshSeed(),
    };

    this.input = new Input(window);
    this.input.mode = 'ui';

    // render core + camera + lights (fixed light pool, created once)
    const level = params.quality ?? this.settings.quality;
    this.core = createRenderCore(canvas, qualityFor(level, this.settings));
    this.rig = new CameraRig(this.core.camera);
    this.lighting = new Lighting(this.core.scene);

    // every run-scoped view, constructed ONCE (CONTRACT §6); mount/unmount per run
    const ctx: ViewCtx = { renderer: this.core.renderer, scene: this.core.scene, camera: this.core.camera, quality: this.core.quality };
    this.views = [
      new EnvView(ctx),
      new CityView(ctx),
      new CivilianView(ctx),
      new PickupView(ctx),
      new DebrisView(ctx),
      new TitanView(ctx),
      new EnemyView(ctx),
      new BossView(ctx),
      new HazardView(ctx),
      new TelegraphView(ctx),
      new ProjectileView(ctx),
      new FxView(ctx),
    ];

    // UI (HTML overlay). Layer z-order comes from ui/styles.css.
    this.hud = new Hud(uiRoot);
    this.bossbar = new BossBar(uiRoot);
    this.broadcast = new Broadcast(uiRoot, this.input);
    this.draftScreen = new DraftScreen(uiRoot, this.input);
    this.selectScreen = new SelectScreen(uiRoot, this.input);
    this.titleScreen = new TitleScreen(uiRoot, this.input);
    this.pauseMenu = new PauseMenu(uiRoot, this.input);
    this.pauseMenu.onSettings = (s) => this.applySettings(s);
    this.hud.show(false);
    this.bossbar.hide();
    this.debug = new DebugOverlay(uiRoot);

    // audio (silent until unlocked by a gesture)
    this.audio = new AudioEngine();
    this.sfx = new Sfx(this.audio);
    this.music = new Music(this.audio);

    this.loop = new GameLoop(this.onStep, this.onFrame);
    const rs = Number(new URLSearchParams(location.search).get('rscale'));
    if (params.dev && rs >= 0.3 && rs <= 1) { this.dynres.scale = rs; this.dynres.pinned = true; this.core.setQuality(this.currentQuality()); }
    if (params.prof) {
      this.prof = new FrameProf(this.core.renderer);
      (window as unknown as { __BTPROF__?: FrameProf }).__BTPROF__ = this.prof;
      // shadow-pass attribution: wall ms of three's WebGLShadowMap.render per frame
      const sm = this.core.renderer.shadowMap as unknown as { render: (...a: unknown[]) => void; __ms?: number; __n?: number };
      const orig = sm.render.bind(sm);
      sm.render = (...a: unknown[]) => {
        const t0 = performance.now(), prevNeeds = (this.lighting as unknown as { sun?: { shadow: { needsUpdate: boolean; autoUpdate: boolean } } }).sun?.shadow;
        const will = !!prevNeeds && (prevNeeds.autoUpdate || prevNeeds.needsUpdate);
        orig(...a);
        if (will) { sm.__ms = (sm.__ms ?? 0) + performance.now() - t0; sm.__n = (sm.__n ?? 0) + 1; }
      };
    }
    this.applySettings(this.settings, false);
    this.installDomHooks();
  }

  // ─────────────────────────────── public surface (main.ts, testsurface.ts) ───────────────────────────────

  get screen(): Screen { return this._screen; }
  /** the live world (read-only by convention — views and the test surface never write gameplay) */
  get world(): World | null { return this._world; }
  /** titan / biome / seed of the current (or next) run */
  get choice(): { titan: TitanId; biome: BiomeId; seed: number } { return { ...this._choice }; }
  get testFrozen(): boolean { return this._testFrozen; }
  get isEnding(): boolean { return this.ending; }

  /** Boot: start the frame loop, then the title (or ?autostart straight into a run). */
  async boot(): Promise<void> {
    this.splash.show(LOADING.boot, 0.1);
    this.loop.start();
    this.splash.set(LOADING.desk, 0.6);
    await yieldFrame();
    this.splash.set(LOADING.ready, 1);
    if (this.params.autostart) {
      const c = this._choice;
      await this.startRun({ titan: c.titan, biome: c.biome, seed: c.seed, skipSlate: this.params.noslate });
      return;
    }
    void this.goTitle();
  }

  /** Title screen → select → run. */
  async goTitle(): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    this.setScreen('title');
    this.input.mode = 'ui';
    this.splash.hide();
    this.music.play('title');
    this.modal = 'title';
    // pre-render the select portraits while the title is up (cached for the whole page; a no-op
    // once done) so Enter → select is instant
    if (!this.portraits) setTimeout(() => { if (ep === this.epoch && this._screen === 'title') void this.getPortraits(); }, 700);
    try {
      await this.titleScreen.run();
    } finally {
      if (this.modal === 'title') this.modal = null;
    }
    if (ep !== this.epoch) return;
    void this.audio.unlock();       // the title's Enter/click is the first user gesture
    this.sfx.ui('confirm');
    void this.goSelect();
  }

  /** Titan + biome select → run (null result = back to the title). */
  async goSelect(initial?: { titan?: TitanId; biome?: BiomeId }): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    // 'loading' until the select screen actually takes input (portraits may still be rendering):
    // screen === 'select' must mean "the select screen is listening"
    this.setScreen('loading');
    this.input.mode = 'ui';
    this.music.play('select');
    // portraits are rendered once per page; show the card only if they are not ready yet
    const pending = this.getPortraits();
    const slow = setTimeout(() => { if (ep === this.epoch) this.splash.show(LOADING.portraits, 0.5); }, 150);
    let portraits: Record<TitanId, string>;
    try { portraits = await pending; } finally { clearTimeout(slow); }
    this.splash.hide();
    if (ep !== this.epoch) return;
    this.setScreen('select');
    this.modal = 'select';
    let res: { titan: TitanId; biome: BiomeId } | null;
    try {
      res = await this.selectScreen.run(portraits, initial ?? { titan: this._choice.titan, biome: this._choice.biome });
    } finally {
      if (this.modal === 'select') this.modal = null;
    }
    if (ep !== this.epoch) return;
    if (!res) { this.sfx.ui('back'); void this.goTitle(); return; }
    this.sfx.ui('confirm');
    void this.startRun({ titan: res.titan, biome: res.biome, seed: freshSeed(), skipSlate: this.params.noslate });
  }

  /**
   * Start a run: loading (createWorld, mount every view, warm shaders) → slate (or play with
   * skipSlate). Resolves once the slate is up (or play has begun) — NOT when the slate is dismissed.
   */
  async startRun(req: RunRequest): Promise<void> {
    const titan: TitanId = isTitan(req.titan) ? req.titan : 'molo';
    const biome: BiomeId = isBiome(req.biome) ? req.biome : 'grideast';
    const seed = Number.isFinite(req.seed) ? (Math.abs(Math.floor(req.seed)) >>> 0) : freshSeed();
    const ep = ++this.epoch;
    const prevLock = this.loadLock;
    let release: () => void = () => {};
    this.loadLock = new Promise<void>((r) => { release = r; });
    let ok = false;
    try {
      await prevLock;                                   // a superseded load bails at its next await
      if (ep !== this.epoch) return;
      await this.closeScreens();
      if (ep !== this.epoch) return;
      this.teardownRun();
      this._choice = { titan, biome, seed };
      ok = await this.loadRun(ep, titan, biome, seed);
    } catch (e) {
      if (ep === this.epoch) this.fail('the run failed to load', e);
      return;
    } finally {
      release();
    }
    if (!ok || ep !== this.epoch) return;
    if (req.skipSlate) { this.enterPlay(); return; }
    void this.runSlate(ep);
  }

  /** Same titan + biome, new seed. */
  retry(): Promise<void> {
    const c = this._choice;
    return this.startRun({ titan: c.titan, biome: c.biome, seed: freshSeed(), skipSlate: this.params.noslate });
  }

  /** Pause (Esc / P / __PAUSE__ / tab hidden). Only from live play. */
  pause(): void {
    if (this._screen === 'play' && !this.ending && this.live) void this.runPause();
  }

  /** Resume from the pause menu (drives the menu's own Resume path so its session closes cleanly). */
  resume(): void {
    if (this._screen === 'pause') void this.closeModalByKeys('pause');
  }

  togglePause(): void {
    if (this._screen === 'pause') this.resume();
    else this.pause();
  }

  /** Test surface: freeze / unfreeze the sim while in play (views keep idling). */
  freeze(on: boolean): void {
    this._testFrozen = !!on;
    // a draft granted by step() while frozen opens on the next frame — do not tick past it
    if (this._screen === 'play' && !this.ending) this.loop.simEnabled = !this._testFrozen && !this.wantDraft;
  }

  /** Test surface: run n ticks synchronously (only while frozen). */
  stepFrozen(n: number, input?: TitanInput | null): number {
    const w = this._world;
    if (!w || !this.live) throw new Error('step(): no live run');
    if (this.loop.simEnabled) throw new Error('step(): the sim is running — call freeze(true) first');
    const k = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.floor(n))) : 0;
    this.forcedInput = input ?? { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
    const t0 = w.tick;
    try {
      this.loop.stepSync(k);
    } finally {
      this.forcedInput = null;
    }
    // stepSync bypasses the loop's own freeze check; a draft/run end reached here opens on the next frame
    this.loop.simEnabled = false;
    return w.tick - t0;
  }

  /**
   * Test surface: dismiss whatever modal owns the game (slate / draft / tabloid / pause) through
   * its own close path. Resolves true when the screen changed.
   */
  async dismiss(): Promise<boolean> {
    const before = this._screen;
    switch (before) {
      case 'slate':
      case 'end': {
        const b = this.broadcast as unknown as { dismiss?: () => boolean };
        if (typeof b.dismiss === 'function') b.dismiss();
        else synthKey('Enter', 'Enter');
        break;
      }
      case 'draft': await this.closeModalByKeys('draft'); break;
      case 'pause': await this.closeModalByKeys('pause'); break;
      case 'title': await this.closeModalByKeys('title'); break;
      default: return false;
    }
    for (let i = 0; i < 40 && this._screen === before; i++) await wait(50);
    return this._screen !== before;
  }

  /**
   * Run a world mutation OUTSIDE a tick (cheats, drafts) and route the events it emits to the
   * views/UI exactly like a tick's (world.events is only cleared at the next tick's start).
   */
  mutate<T>(fn: (w: World) => T): T {
    const w = this._world;
    if (!w) throw new Error('no live run');
    const n0 = w.events.length;
    const out = fn(w);
    const ev = w.events;
    for (let i = n0; i < ev.length; i++) this.pushEvent(ev[i]);
    return out;
  }

  /** The last n sim events (oldest first). */
  recentEvents(n: number): SimEvent[] {
    const total = Math.min(this.ring.length, EVENT_RING);
    const k = Math.max(0, Math.min(total, Number.isFinite(n) ? Math.floor(n) : total));
    const out: SimEvent[] = new Array(k);
    // newest sits at ringHead - 1
    let idx = (this.ringHead - k + EVENT_RING * 2) % EVENT_RING;
    for (let i = 0; i < k; i++) {
      out[i] = this.ring[idx];
      idx = (idx + 1) % EVENT_RING;
    }
    return out;
  }

  /** Renderer counters of the last rendered frame. */
  renderStats(): RenderStats { return this.core.stats(); }

  /**
   * Render one still frame right now (no events, dt 0 — nothing advances) and return the canvas
   * as a data URL. Used by __BT__.shot(); must run in one task so the drawing buffer is intact.
   */
  captureFrame(type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): string {
    const w = this._world;
    if (w && this.live) this.drawWorld(w, this.loop.alpha, 0, this.time, this.noEvents, false);
    else this.core.render();
    return this.core.renderer.domElement.toDataURL(type, quality);
  }

  /** Apply settings to audio, quality (DPR / shadows), screen shake and flashing. */
  applySettings(s: Settings, fromUser = true): void {
    this.settings = { ...s };
    this.audio.setVolumes(s.master, s.music, s.sfx);
    this.core.setQuality(this.currentQuality());
    try { document.documentElement.classList.toggle('bt-reduce-flash', !!s.reduceFlashing); } catch { /* no DOM */ }
    if (fromUser) this.sfx.ui('confirm');
  }

  /** The quality preset for the current settings × the adaptive render scale. */
  private currentQuality(): Quality {
    const q = qualityFor(this.params.quality ?? this.settings.quality, this.settings);
    if (this.params.dynres) q.dpr = Math.max(0.5, q.dpr * this.dynres.scale);
    return q;
  }

  // ─────────────────────────────── loading / teardown ───────────────────────────────

  /** Build the world and mount every view. Returns false when superseded (epoch changed). */
  private async loadRun(ep: number, titan: TitanId, biome: BiomeId, seed: number): Promise<boolean> {
    this.setScreen('loading');
    this.input.mode = 'ui';
    this.splash.show(LOADING.city, 0.05);
    await yieldFrame();
    if (ep !== this.epoch) return false;

    const w = createWorld({ titan, biome, seed });
    this._world = w;
    this.resetRunState();
    this.lighting.applyBiome(BIOMES[biome]);

    const n = this.views.length;
    for (let i = 0; i < n; i++) {
      const v = this.views[i];
      this.splash.set(LOADING.mount, 0.1 + 0.6 * (i / n));
      await v.mount(w);
      this.mounted.push(v);                         // recorded even if superseded, so teardown unmounts it
      if (ep !== this.epoch) return false;
      if (i % 3 === 2) {
        await yieldFrame();
        if (ep !== this.epoch) return false;
      }
    }

    // position every instance once (frozen, no events) so the warm frame sees the real scene.
    // `live` stays false until warmup is done: a view updating mid-warmup could flip visibility
    // that warmup is about to restore (it force-shows everything, then puts it back).
    this.rig.reset(w);
    this.drawWorld(w, 1, 0, this.time, this.noEvents, false, false);

    this.splash.set(LOADING.warm, 0.8);
    await yieldFrame();
    if (ep !== this.epoch) return false;
    await warmup(this.core.renderer, this.core.scene, this.core.camera);
    if (ep !== this.epoch) return false;
    await this.warmCompositor();
    if (ep !== this.epoch) return false;

    this.live = true;
    this.splash.set(LOADING.live, 1);
    // one real frame on screen before the card lifts (the slate freeze-frame is this picture)
    this.drawWorld(w, 1, 0, this.time, this.noEvents, false);
    this.splash.hide();
    return true;
  }

  /**
   * Compositor pre-warm (once per page). The FIRST draft of a session stalled the GPU process for
   * 240–280 ms with no script running (LoAF: 253 ms frame, 0 ms script) — the browser compiling
   * its filter shaders for the MUTATION REPORT backdrop (backdrop-filter blur + saturate) and the
   * dimmed cards (filter saturate + brightness) on the d3d11 ANGLE backend. Later drafts were
   * clean. Painting a tiny, near-transparent sample of those exact classes above the loading card
   * for a few frames moves that one-time compile into the load.
   */
  private compositorWarm = false;
  private async warmCompositor(): Promise<void> {
    if (this.compositorWarm || new URLSearchParams(location.search).get('warmui') === '0') return;
    const w = this._world;
    const layer = this.uiRoot.querySelector('.bt-draft');
    if (!w || !layer) return;
    this.compositorWarm = true;
    // a detached copy of the real MUTATION REPORT (backdrop, header, footer) + one real card per
    // rarity built by the draft screen itself, so every paint shader the first draft needs is seen
    const box = layer.cloneNode(true) as HTMLElement;
    box.classList.remove('bt-hidden');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'z-index:901;opacity:.02;pointer-events:none';
    const cardsBox = box.querySelector('.bt-draft-cards');
    const build = (this.draftScreen as unknown as { buildCard?: (w: World, id: string, def: unknown, i: number) => HTMLElement }).buildCard;
    if (cardsBox && typeof build === 'function') {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const u of UPGRADES) if (!seen.has(u.rarity)) { seen.add(u.rarity); ids.push(u.id); }
      ids.forEach((id, i) => {
        try {
          const card = build.call(this.draftScreen, w, id, UPGRADE_BY_ID[id], i);
          if (i === 0) card.classList.add('is-sel');
          cardsBox.appendChild(card);
        } catch { /* warm only */ }
      });
    }
    this.uiRoot.appendChild(box);
    // the real open animates the cards + header on the compositor (transform / opacity layers)
    try {
      const kf = [{ transform: 'translateY(30%) rotate(6deg) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }];
      box.querySelectorAll('.bt-dossier, .bt-draft-head').forEach((e) => { (e as HTMLElement).animate(kf, { duration: 160, fill: 'both' }); });
    } catch { /* no WAAPI */ }
    try {
      for (let i = 0; i < 8; i++) await yieldFrame();
    } finally {
      box.remove();
    }
  }

  /** Unmount everything run-scoped and drop the world. Safe to call repeatedly. */
  private teardownRun(): void {
    this.loop.simEnabled = false;
    this.loop.timeScale = 1;
    this.live = false;
    for (let i = this.mounted.length - 1; i >= 0; i--) {
      try { this.mounted[i].unmount(); } catch (e) { console.error('[blocktooth] unmount failed', e); }
    }
    this.mounted = [];
    this._world = null;
    this.hud.show(false);
    this.bossbar.hide();
    this.broadcast.clear();
    this.evA.length = 0;
    this.evB.length = 0;
    this.ring.length = 0;
    this.ringHead = 0;
    this.resetRunState();
  }

  private resetRunState(): void {
    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.input.bufferS = INPUT_BUFFER_S;
    this.stingT = 0;
    this.musicAcc = 0;
    this.lowHpArmed = true;
    this.wantDraft = false;
    this.draftSuppressTick = -1;
    this.ending = false;
    this.endT = 0;
    this.endResult = null;
    this._testFrozen = false;
    this.forcedInput = null;
    this.loop.timeScale = 1;
  }

  /**
   * Close whatever awaited modal is open, through its own path: broadcast.clear() for the slate
   * (resolves) and the tabloid (abandons); a synthetic key for the rest (their continuations are
   * epoch-guarded, so whatever they resolve with is ignored).
   */
  private async closeScreens(): Promise<void> {
    this.broadcast.clear();
    if (this.modal === 'slate' || this.modal === 'end') this.modal = null;
    const m = this.modal;
    if (m) await this.closeModalByKeys(m);
  }

  private async closeModalByKeys(m: Modal): Promise<void> {
    if (m === 'slate' || m === 'end') { this.broadcast.clear(); if (this.modal === m) this.modal = null; return; }
    const k = CLOSE_KEY[m];
    // a screen swallows presses for its first ~200–350 ms (armMs): retry until it closes
    for (let i = 0; i < 40 && this.modal === m; i++) {
      synthKey(k.key, k.code);
      await wait(90);
    }
    if (this.modal === m) {
      console.warn('[blocktooth] could not close the ' + m + ' screen through its keys');
      this.modal = null;
    }
  }

  // ─────────────────────────────── screens ───────────────────────────────

  private setScreen(s: Screen): void {
    this._screen = s;
    try { document.body.dataset.screen = s; } catch { /* no DOM */ }
  }

  private async runSlate(ep: number): Promise<void> {
    const w = this._world;
    if (!w) return;
    this.setScreen('slate');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.hud.show(false);
    this.music.stop();
    this.sfx.ui('slate');
    this.modal = 'slate';
    try {
      await this.broadcast.openSlate(BIOMES[w.biomeId], TITANS[w.titanId]);
    } finally {
      if (this.modal === 'slate') this.modal = null;
    }
    if (ep !== this.epoch || this._world !== w) return;
    void this.audio.unlock();       // the slate's "press any key" is a user gesture too
    this.enterPlay();
  }

  private enterPlay(): void {
    const w = this._world;
    if (!w) return;
    this.setScreen('play');
    this.input.mode = 'game';
    this.input.clearEdges();
    this.hud.show(true);
    this.loop.simEnabled = !this._testFrozen && !this.ending;
    this.musicAcc = MUSIC_PERIOD_S;               // refresh intensity on the next frame
    this.music.play(w.boss && w.boss.alive ? 'boss' : w.biomeId);
  }

  private async runDraft(): Promise<void> {
    const w = this._world;
    if (!w) return;
    const ep = this.epoch;
    this.setScreen('draft');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.sfx.ui('draft');
    let guard = 0;
    while (ep === this.epoch && this._world === w && hasPendingDraft(w) && guard++ < 64) {
      const offer = this.mutate((ww) => rollOffer(ww));
      if (!offer || offer.length === 0) {
        // nothing offerable (should be impossible while hasPendingDraft is true) — never block play
        this.draftSuppressTick = w.tick + 30;
        break;
      }
      this.modal = 'draft';
      let res: { pick: string } | { reroll: true };
      try {
        res = await this.draftScreen.open(w, offer, Math.max(0, w.upgrades.rerolls | 0));
      } finally {
        if (this.modal === 'draft') this.modal = null;
      }
      if (ep !== this.epoch || this._world !== w) return;
      if ('reroll' in res) {
        this.mutate((ww) => rerollOffer(ww));
        this.sfx.ui('move');
        continue;
      }
      const id = res.pick;
      this.mutate((ww) => pickUpgrade(ww, id));
      this.sfx.ui('pick');
    }
    if (ep !== this.epoch || this._world !== w) return;
    this.enterPlay();
  }

  private async runPause(): Promise<void> {
    const w = this._world;
    if (!w || this._screen !== 'play' || this.ending) return;
    const ep = this.epoch;
    this.setScreen('pause');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.music.setIntensity(0.08);
    this.sfx.ui('back');
    this.modal = 'pause';
    let choice: 'resume' | 'retry' | 'quit';
    try {
      choice = await this.pauseMenu.open();
    } finally {
      if (this.modal === 'pause') this.modal = null;
    }
    if (ep !== this.epoch || this._world !== w) return;
    // the menu saved whatever the player changed in Settings — make sure it is applied
    this.applySettings(loadSettings(), false);
    if (choice === 'retry') { this.sfx.ui('confirm'); void this.retry(); return; }
    if (choice === 'quit') { this.sfx.ui('back'); void this.goTitle(); return; }
    this.sfx.ui('confirm');
    this.enterPlay();
  }

  /** runEnd → aftermath timer (the sim is already stopped; fx keep playing). */
  private beginEnding(result: 'clear' | 'dead'): void {
    if (this.ending) return;
    this.ending = true;
    this.endResult = result;
    this.endT = END_DELAY_S;
    this.wantDraft = false;
    this.loop.simEnabled = false;
    this.loop.timeScale = 1;
    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.input.bufferS = INPUT_BUFFER_S;
    this.input.mode = 'ui';
    this.music.setIntensity(result === 'clear' ? 1 : 0.15);
    const w = this._world;
    if (w) this.recordBests(w, result);
  }

  /** Aftermath over: photo right after a render, then the tabloid. */
  private async runTabloid(): Promise<void> {
    const w = this._world;
    if (!w) return;
    const ep = this.epoch;
    let photo = '';
    // the front-page photo is of the SUBJECT: live hostile telegraphs (and their x-ray pass) and
    // hazard paint are left out of it (the telegraph view has also faded them during the aftermath)
    const hidden: THREE_Object[] = [];
    for (const name of PHOTO_HIDDEN_ROOTS) {
      const o = this.core.scene.getObjectByName(name) as THREE_Object | undefined;
      if (o && o.visible) { o.visible = false; hidden.push(o); }
    }
    try {
      this.core.render();                               // the photo is THIS render
      photo = this.core.renderer.domElement.toDataURL('image/jpeg', 0.9);
    } catch (e) {
      console.error('[blocktooth] freeze-frame photo failed', e);
    } finally {
      for (const o of hidden) o.visible = true;
    }
    this.setScreen('end');
    this.hud.show(false);
    this.bossbar.hide();
    this.music.play('tabloid');
    this.sfx.ui('print');
    this.modal = 'end';
    let choice: 'retry' | 'select' | 'title';
    try {
      choice = await this.broadcast.tabloid(w, photo);
    } finally {
      if (this.modal === 'end') this.modal = null;
    }
    if (ep !== this.epoch) return;
    this.sfx.ui('confirm');
    if (choice === 'retry') void this.retry();
    else if (choice === 'select') void this.goSelect({ titan: w.titanId, biome: w.biomeId });
    else void this.goTitle();
  }

  /**
   * File this run's personal bests (core/save.ts). The figures come from broadcast.runFigures —
   * the same generator the tabloid prints and compares with — and the bests as they stood BEFORE
   * this run are handed to the broadcast first, so its record book stamps exactly what fell.
   */
  private recordBests(w: World, result: 'clear' | 'dead'): void {
    try {
      const t = w.titanId, b = w.biomeId;
      this.broadcast.priorBests(loadBest());
      const fig = runFigures(w, result);
      const higher: Record<string, number> = {};
      for (const k in fig) if (k !== 'clearS') higher[bestKey(t, b, k)] = fig[k];
      saveBest(higher);
      if (fig.clearS !== undefined) saveBest(bestKey(t, b, 'clearS'), fig.clearS, true);   // lower wins
    } catch { /* storage blocked — bests are a nicety */ }
  }

  private getPortraits(): Promise<Record<TitanId, string>> {
    if (!this.portraits) {
      this.portraits = renderPortraits(this.core.renderer, PORTRAIT_PX).catch((e: unknown) => {
        console.error('[blocktooth] portrait render failed', e);
        this.portraits = null;                       // try again next time the select opens
        return {} as Record<TitanId, string>;
      });
    }
    return this.portraits;
  }

  // ─────────────────────────────── the loop ───────────────────────────────

  /** One sim tick. */
  private readonly onStep = (): void => {
    const w = this._world;
    if (!w || !this.live) return;
    try {
      this.input.update();                               // idempotent within one animation frame
      const inp = this.forcedInput ?? this.input.titanInput();
      stepWorld(w, inp);
    } catch (e) {
      this.loop.simEnabled = false;
      this.fail('the simulation stopped', e);
      return;
    }
    const ev = w.events;
    for (let i = 0; i < ev.length; i++) this.pushEvent(ev[i]);   // a rankUp here arms sizeUpHoldT
    if (w.run.result) {
      this.loop.simEnabled = false;                      // run over: nothing more to simulate
    } else if (w.tick > this.draftSuppressTick && hasPendingDraft(w)) {
      this.wantDraft = true;
      // freeze INSIDE the tick that granted it — unless the MASS BREACH sting is on screen: then
      // play runs on and the draft opens when the sting is over (afterFrame)
      if (!(this.sizeUpHoldT > 0) || this._testFrozen) this.loop.simEnabled = false;
    }
  };

  /** One rendered frame. */
  private readonly onFrame = (alpha: number, dt: number, time: number): void => {
    this.time = time;
    const f0 = performance.now();
    this.renderMs = 0;
    const P = this.prof;
    if (P) P.begin();
    try {
      this.input.update();
      if (this.input.pressed('debug')) this.debug.toggle();
      if (this._screen === 'play' && !this.ending && this.input.pressed('pause')) this.pause();
      const w = this._world;
      if (w && this.live) {
        if (this.holdCanvas()) {
          // frozen modal (draft / pause): the world does not move, so the picture under the
          // (near-opaque, blurred) modal is held instead of redrawn — events keep collecting for
          // the first live frame; timers still run
          if (P) { P.mark('input'); P.annotate('held'); }
          this.afterFrame(w, dt);
          if (P) P.mark('afterFrame');
        } else {
          const events = this.swapEvents();
          if (P) P.mark('input');
          this.drawWorld(w, alpha, dt, time, events, true);
          this.afterFrame(w, dt);
          if (P) P.mark('afterFrame');
        }
      }
      if (this.params.dynres) {
        const live = !!w && this.live && this._screen === 'play' && this.loop.simEnabled && !this.ending && !this._testFrozen;
        if (this.dynres.frame(dt, live, this.prevCpuS)) { this.core.setQuality(this.currentQuality()); if (P) P.annotate('dynres->' + this.dynres.scale); }
        if (P) P.mark('dynres');
      }
      this.frameErrStreak = 0;
    } catch (e) {
      this.frameError(e);
    }
    this.prevCpuS = (performance.now() - f0 - this.renderMs + this.loop.lastSimMs) / 1000;
    if (P) {
      const L = this.loop;
      P.scale = this.dynres.scale;
      P.end(L.lastRawMs, L.lastTicks, L.lastSimMs, this.core.renderer.info, this._screen);
    }
    if (this.debug.visible) {
      try { this.debug.update(this._world, this.core.stats(), frameStats()); } catch { /* debug only */ }
    }
  };

  /**
   * Camera → lighting → views → HUD / boss bar / audio (+ app reactions) → render.
   * `react` = false for still frames (loading prime, shots): no audio/app reactions.
   */
  private drawWorld(w: World, alpha: number, dt: number, time: number, events: readonly SimEvent[], react: boolean, render = true): void {
    const f = this.fi;
    f.alpha = alpha;
    f.dt = dt;
    f.time = time;
    f.events = events;
    f.frozen = this.viewsFrozen();
    f.camDist = this.rig.distance;
    const P = react ? this.prof : null;
    this.rig.update(w, f);
    f.camDist = this.rig.distance;
    if (P) P.mark('camera');
    this.lighting.update(w, this.rig);
    if (P) P.mark('lighting');
    const views = this.mounted;
    for (let i = 0; i < views.length; i++) {
      views[i].update(w, f);
      if (P) P.mark(views[i].constructor.name);
    }
    if (react) {
      this.hud.update(w, dt);
      if (events.length) this.hud.onEvents(w, events);
      this.bossbar.update(w.boss);
      if (P) P.mark('hud');
      const tg = this.rig.target;
      this.sfx.onEvents(w, events, tg.x, tg.z);
      if (P) P.mark('sfx');
      if (events.length) this.appEvents(events);
      if (P) { P.mark('appEvents'); for (let i = 0; i < events.length; i++) if (events[i].type === 'rankUp' || events[i].type === 'levelUp') P.annotate(events[i].type); }
    }
    if (render) {
      if (P) P.gpuBegin();
      const r0 = performance.now();
      this.core.render();
      this.renderMs += performance.now() - r0;
      if (P) {
        P.gpuEnd(); P.mark('render');
        const R = this.core.renderer as unknown as { __resizeMs?: number };
        const SM = this.core.renderer.shadowMap as unknown as { __ms?: number; __n?: number };
        if (SM.__n) { P.annotate('sh' + (SM.__ms ?? 0).toFixed(1)); SM.__ms = 0; SM.__n = 0; }
        if (R.__resizeMs !== undefined) { P.annotate('resize=' + R.__resizeMs.toFixed(1) + 'ms'); R.__resizeMs = undefined; }
      }
    }
  }

  /**
   * true = skip this frame's world draw and keep the last presented picture. Only while a frozen
   * modal (draft / pause) is up: views are frozen there (viewsFrozen), so the picture cannot change,
   * yet the GPU kept redrawing ~1M triangles every frame under the modal while also compositing it.
   * On the reference Intel UHD at Size V that made 19 % of draft frames miss vsync (?prof=1, perfcheck
   * window: 29 of 154 draft frames > 30 ms; after the hold: 4 of 160). A canvas that is not drawn keeps
   * showing its last frame (preserveDrawingBuffer only matters for reads). Redrawn if the canvas box,
   * DPR or shadow setting changes while the modal is open (settings in the pause menu).
   */
  private holdCanvas(): boolean {
    const s = this._screen;
    if ((s !== 'draft' && s !== 'pause') || this.loop.simEnabled || this.ending || this._testFrozen) {
      this.heldFrames = 0;
      this.heldKey = '';
      return false;
    }
    const c = this.canvas, q = this.core.quality;
    const key = c.clientWidth + 'x' + c.clientHeight + '@' + q.dpr + (q.shadows ? 's' : '') + q.level;
    if (this.heldKey === '') {
      this.heldKey = key;                       // just opened: the canvas holds the last live frame
      this.heldFrames = HOLD_DRAWN;
    } else if (key !== this.heldKey) {
      this.heldKey = key;                       // resized / quality changed while open: redraw
      this.heldFrames = 0;
    }
    if (this.heldFrames < HOLD_DRAWN) { this.heldFrames++; return false; }
    return true;
  }

  /** Views idle (no sim-driven motion) everywhere except live play and the run-end aftermath. */
  private viewsFrozen(): boolean {
    if (this._screen !== 'play') return true;
    if (this.ending) return false;
    return this._testFrozen;
  }

  /** App-level reactions to this frame's events. */
  private appEvents(events: readonly SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'rankUp': this.onRankUp(e.rank); break;
        case 'alert': this.broadcast.alert(e.key); break;
        case 'bossSpawn': {
          const def = BOSSES[e.boss];
          if (def) this.bossbar.show(def);
          if (this._screen === 'play' || this._screen === 'draft') this.music.play('boss');
          this.stingT = Math.max(this.stingT, 3);
          break;
        }
        case 'bossPhase': this.stingT = Math.max(this.stingT, 2); break;
        case 'bossDefeated': this.stingT = Math.max(this.stingT, 4); break;
        case 'eliteSpawn': this.stingT = Math.max(this.stingT, 2); break;
        case 'runEnd': this.beginEnding(e.result); break;
        default: break;
      }
    }
  }

  private onRankUp(rank: RankIndex): void {
    if (!this.ending && this._screen === 'play' && !this._testFrozen) {
      this.loop.timeScale = HITSTOP_SCALE;
      this.hitStopT = HITSTOP_S;
      this.input.bufferS = HITSTOP_BUFFER_S;
    }
    this.broadcast.sizeUp(rank);
    this.stingT = Math.max(this.stingT, 4);
    this.music.setIntensity(1);
  }

  /** Timers + transitions that follow a rendered frame. */
  private afterFrame(w: World, dt: number): void {
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      if (this.hitStopT <= 0) { this.hitStopT = 0; this.loop.timeScale = 1; this.input.bufferS = INPUT_BUFFER_S; }
    }
    if (this.sizeUpHoldT > 0) this.sizeUpHoldT = Math.max(0, this.sizeUpHoldT - dt);
    if (this.stingT > 0) this.stingT = Math.max(0, this.stingT - dt);

    if (this._screen === 'play' && !this.ending) {
      this.musicAcc += dt;
      if (this.musicAcc >= MUSIC_PERIOD_S) {
        this.musicAcc = 0;
        this.music.setIntensity(this.musicIntensity(w));
      }
      this.checkLowHp(w);
    }

    if (this.ending) {
      if (this._screen === 'play') {
        this.endT -= dt;
        if (this.endT <= 0) void this.runTabloid();       // renders + captures synchronously first
      }
      return;
    }
    if (this.wantDraft && this._screen === 'play' && !this._testFrozen && !(this.sizeUpHoldT > 0)) {
      this.wantDraft = false;
      void this.runDraft();
    }
  }

  private musicIntensity(w: World): number {
    const T = w.titan;
    let alive = 0;
    const E = w.enemies;
    for (let i = 0; i < E.length; i++) if (E[i].alive) alive++;
    let x = 0.3 + 0.07 * T.rank + Math.min(0.3, alive / 90);
    if (w.boss && w.boss.alive) x = Math.max(x, 0.72 + 0.09 * (w.boss.phase - 1));
    const hpF = T.maxHp > 0 ? T.hp / T.maxHp : 1;
    if (hpF < 0.35) x += 0.12;
    if (this.stingT > 0) x += 0.25 * Math.min(1, this.stingT / 2);
    return clamp01(x);
  }

  /** The sim has no low-HP alert emitter: the app raises `alert lowHp` once per dip (hysteresis). */
  private checkLowHp(w: World): void {
    const T = w.titan;
    if (!T.alive || !(T.maxHp > 0)) return;
    const f = T.hp / T.maxHp;
    if (this.lowHpArmed && f < LOW_HP_FIRE) {
      this.lowHpArmed = false;
      const key: AlertKey = 'lowHp';
      // routed through next frame's event list so the HUD, broadcast and sfx all see it
      this.evA.push({ type: 'alert', key });
    } else if (!this.lowHpArmed && f > LOW_HP_REARM) {
      this.lowHpArmed = true;
    }
  }

  // ─────────────────────────────── events plumbing ───────────────────────────────

  private pushEvent(e: SimEvent): void {
    // a rank-up (from a tick or a mutate()) holds any draft owed right now until the sting is seen
    if (e.type === 'rankUp' && !this._testFrozen && !this.ending) this.sizeUpHoldT = SIZEUP_DRAFT_HOLD_S;
    this.evA.push(e);
    this.ring[this.ringHead] = e;
    this.ringHead = (this.ringHead + 1) % EVENT_RING;
  }

  /** Hand out everything collected since the last frame; the next frame collects into the other list. */
  private swapEvents(): readonly SimEvent[] {
    const out = this.evA;
    this.evA = this.evB;
    this.evA.length = 0;
    this.evB = out;
    return out;
  }

  // ─────────────────────────────── errors + DOM hooks ───────────────────────────────

  private fail(title: string, err: unknown): void {
    console.error('[blocktooth]', title, err);
    if (this.fatalShown) return;
    this.fatalShown = true;
    try { this.onFatal(title, err); } catch { /* the reporter itself failed */ }
  }

  private frameError(e: unknown): void {
    this.frameErrStreak++;
    this.frameErrTotal++;
    if (this.frameErrTotal <= 8) console.error('[blocktooth] frame error', e);
    if (this.frameErrStreak >= FRAME_ERROR_FATAL_STREAK) this.fail('the picture froze', e);
  }

  private installDomHooks(): void {
    // auto-pause when the tab is hidden (CONTRACT §14); never destroys the run
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    // …and when the window loses focus (alt-tab, another monitor, the portal page around the
    // iframe): Input already releases every held key on blur, so without this an unattended
    // titan stood still while the sim kept running and died in ~25–45 s. pause() is a no-op
    // outside live play (menus, drafts, the tabloid, the run-end aftermath).
    window.addEventListener('blur', () => this.pause());
    // first user gesture unlocks audio (the engine also listens; this covers ?autostart pages)
    const unlock = () => {
      void this.audio.unlock();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // menu navigation ticks (the UI screens own their keys; this only adds the sound)
    let lastMove = 0;
    window.addEventListener('keydown', (e) => {
      const s = this._screen;
      if (s !== 'select' && s !== 'pause' && s !== 'draft' && s !== 'end') return;
      const nav = e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight'
        || e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD';
      if (!nav) return;
      const now = performance.now();
      if (now - lastMove < 70) return;
      lastMove = now;
      this.sfx.ui('move');
    }, true);
    // a lost GL context cannot be recovered mid-run with the scene state we hold
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.loop.simEnabled = false;
      this.fail('the graphics device was reset', new Error('WebGL context lost — reload to restart the broadcast.'));
    });
    // keep the drawing buffer sized even while frozen / between frames
    window.addEventListener('resize', () => { try { this.core.resize(); } catch { /* ignore */ } });
  }
}
