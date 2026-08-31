/* ============================================================================
 * ASCENDANT — runtime/game.js
 * Contract §21.  The state machine, the stage lifecycle, the death loop, the
 * checkpoint/coin/finish logic, the hub and its portals, the run timers and the
 * dev tools.
 *
 * Ownership / integration notes
 * -----------------------------
 *  • Game owns NO rendering of world geometry.  It owns state, timing and a
 *    small set of full-screen DOM overlays that are NOT part of the HUD API
 *    (contract §20 gives HUD toast/checkpointFlash/deathFlash/finish only):
 *      #asc-fade    the death / load fade-to-theme-colour veil
 *      #asc-intro   the stage intro card (world · stage · difficulty)
 *      #asc-prompt  the interact prompt (portals, click-to-resume)
 *      #asc-cont    the "press jump to continue" hint on the clear card
 *      #asc-dev     the dev readout (?dev=1 only)
 *    They live in #ui, created in the CONSTRUCTOR so Menu/StageSelect (built
 *    after Game in boot.js) paint above them in DOM order.
 *  • Services are injected by boot.js through attach()/attachUI() rather than
 *    imported here, so boot.js remains the single place that constructs the
 *    engine-level singletons.  Player/FPCamera/Viewmodel/Stage ARE constructed
 *    here because their lifetime is the stage lifetime.
 *  • Player, FPCamera and Viewmodel are built ONCE (on the first stage load) and
 *    reused for every subsequent stage — `physWorld` below is a stable object
 *    with live getters, so rebinding a stage never invalidates the references
 *    the player/camera captured.
 * ==========================================================================*/

import * as THREE from 'three';

import { WORLDS, HUB, getStage } from './data/index.js';
import { Stage } from './world/stage.js';
import { THEMES, applyTheme } from './world/themes.js';
import { Player } from './player/controller.js';
import { FPCamera } from './player/camera.js';
import { Viewmodel } from './player/viewmodel.js';
import { Save } from './core/save.js';
import { Settings } from './core/settings.js';
import { TUNE } from './core/tuning.js';
import { clamp, lerp, smoothstep, easeOutCubic, fmtTime, nowMs } from './core/util.js';

/* ---------------------------------------------------------------------------
 * Timeline constants (contract §21: death -> respawn budget is 620 ms total).
 * Stored as cumulative boundaries so the sequence is a pure function of elapsed
 * real milliseconds — no per-phase timers to drift.
 * ------------------------------------------------------------------------ */
/* Designed total is 560 ms, deliberately under the 620 ms contract bound: the
 * sequence advances on rAF, so a 50 Hz panel adds up to ~60-90 ms of frame
 * quantisation between the kill and the measured input restore (heavier stages
 * drop the odd frame during the swap). 540 designed
 * keeps the MEASURED median inside 620 on every stage weight (loopcheck asserts exactly that). */
const D_FLASH = 80;                       // 0    .. 80    flash + freeze + duck
const D_HOLD = 140;                       // 80   .. 220   hold on the death cam
const D_FADE = 130;                       // 220  .. 350   fade to theme colour
const D_RESTORE = 190;                    // 350  .. 540   fade back in
const T_HOLD_END = D_FLASH + D_HOLD;                       // 270
const T_FADE_END = T_HOLD_END + D_FADE;                    // 410  <- world swap
const T_DEATH_END = T_FADE_END + D_RESTORE;                // 620
const T_SOFT_START = T_HOLD_END - 20;     // manual respawn skips flash + hold

const INTRO_MS = 1600;                    // stage intro card, skippable
const INTRO_MIN_SKIP = 260;               // ignore a skip in the first 260 ms
const CLEAR_AUTO_MS = 4600;               // clear card auto-advance
const CLEAR_MIN_SKIP = 700;
const FINISH_SLOWMO_MS = 400;             // contract: 400 ms slow-mo
const FINISH_SLOWMO_MIN = 0.34;

/* Checkpoint / coin / finish trigger geometry lives with the pads themselves,
   in runtime/world/stage.js (checkpointAt / coinAt / finishAt). Game deliberately
   keeps no second copy: two sets of radii is how the two systems drifted apart. */

const PORTAL_PROMPT_R = 4.2;              // show the prompt
const PORTAL_ENTER_R = 1.55;              // walk-in radius
const PORTAL_ENTER_DWELL = 0.28;          // seconds inside ENTER_R to trigger

const HUB_ID = 'hub';
const RESUME_PROMPT = 'CLICK TO RESUME';
const RESUME_SUB = 'pointer released';
const ACTION_COOLDOWN = 380;              // ms — de-dupes key + event paths

/* Dev free-fly, anchored to the real sprint speed so it stays proportionate
   if TUNE is retuned. */
const NOCLIP_SPEED = (TUNE && typeof TUNE.speedSprint === 'number' ? TUNE.speedSprint : 12.2) * 1.35;
const NOCLIP_FAST = NOCLIP_SPEED * 2.8;

/* Module-scope scratch — nothing in an update path allocates. */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _col = new THREE.Color();
const _box = new THREE.Box3();

/* ---------------------------------------------------------------------------
 * Small local helpers (kept private — util.js is the shared home for anything
 * another module would want).
 * ------------------------------------------------------------------------ */

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/** Accepts [x,y,z] | {x,y,z} | Vector3 | {p:...} | {pos:...} | {position:...}. */
function toVec3(src, out) {
  out.set(0, 0, 0);
  if (!src) return out;
  if (Array.isArray(src)) {
    out.set(isNum(src[0]) ? src[0] : 0, isNum(src[1]) ? src[1] : 0, isNum(src[2]) ? src[2] : 0);
    return out;
  }
  if (isNum(src.x) && isNum(src.y) && isNum(src.z)) { out.set(src.x, src.y, src.z); return out; }
  if (src.pos !== undefined) return toVec3(src.pos, out);
  if (src.p !== undefined) return toVec3(src.p, out);
  if (src.position !== undefined) return toVec3(src.position, out);
  if (src.center !== undefined) return toVec3(src.center, out);
  return out;
}

function yawOf(src, fallback) {
  if (!src) return fallback || 0;
  if (isNum(src.yaw)) return src.yaw;
  if (isNum(src.rot)) return src.rot;
  if (src.rotation && isNum(src.rotation.y)) return src.rotation.y;
  return fallback || 0;
}

/** Colour of any shape (0xRRGGBB | '#rgb' | THREE.Color | {color:...}) -> css. */
function cssColor(c, fallback) {
  const fb = fallback || '#05070d';
  try {
    if (c === null || c === undefined) return fb;
    if (typeof c === 'number' && Number.isFinite(c)) {
      return '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
    }
    if (typeof c === 'string') return c;
    if (c.isColor) return '#' + c.getHexString();
    if (c.color !== undefined) return cssColor(c.color, fb);
  } catch (e) { /* fall through */ }
  return fb;
}

function shade(css, k) {
  try {
    _col.set(css);
    _col.multiplyScalar(k);
    return '#' + _col.getHexString();
  } catch (e) { return css; }
}

/** Call `on`/`addEventListener`/`subscribe` — whichever the emitter exposes. */
function bindEvent(emitter, name, fn) {
  if (!emitter || typeof fn !== 'function') return false;
  try {
    if (typeof emitter.on === 'function') { emitter.on(name, fn); return true; }
    if (typeof emitter.addEventListener === 'function') { emitter.addEventListener(name, fn); return true; }
    if (typeof emitter.subscribe === 'function') { emitter.subscribe(name, fn); return true; }
  } catch (e) { /* emitter shape mismatch — proximity fallbacks still cover us */ }
  return false;
}

function safe(fn, ctx) {
  try { return fn(); } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[ascendant] ' + (ctx || 'call') + ':', e);
    return undefined;
  }
}

/** A complete no-op spatial index — used only before the first stage exists. */
const EMPTY_BROADPHASE = {
  add() {}, remove() {}, refresh() {},
  query(aabb, out) { if (out) { out.length = 0; return out; } return []; },
};
const EMPTY_ARRAY = [];

/* ==========================================================================
 * Game
 * ========================================================================*/
export class Game {
  /**
   * @param {import('./core/engine.js').Engine} engine
   * @param {HTMLElement} container  the #game-container element
   */
  constructor(engine, container) {
    this.engine = engine;
    this.container = container || document.body;

    /* ---- contract §21 surface ---- */
    this.state = 'loading';               // loading|title|hub|playing|paused|dead|cleared|select
    this.world = null;                    // current WORLD def (null in the hub)
    this.stage = null;
    this.player = null;
    this.hud = null;
    this.menu = null;
    this.stageSelect = null;
    this.audio = null;
    this.fx = null;                       // ParticleSystem
    this.save = Save;
    this.timeMs = 0;                      // current stage clock (ms, gameplay only)
    this.totalMs = 0;                     // whole-run clock (ms)
    this.deaths = 0;                      // whole-run deaths

    /* ---- injected by boot.js ---- */
    this.input = null;
    this.impacts = null;
    this.decals = null;                   // fx/decals.js — scuffs, scorches, death marks
    this.mats = null;
    this.settings = Settings;
    this.onProgress = null;               // (p01, message) => void, boot bar
    this.onFatal = null;                  // (err) => void, unrecoverable loop

    /* ---- owned by Game ---- */
    this.camera = null;                   // FPCamera
    this.viewmodel = null;
    this.stageId = null;
    this.theme = null;
    this.themeId = 'hub';
    this.cpIndex = 0;
    this.stageDeaths = 0;
    this.coins = 0;
    this.timeScale = 1;
    this.frames = 0;                      // boot.js watchdog reads this
    this.dev = false;
    this.noclip = false;
    this.freezeHazards = false;

    /* ---- flags / timers (all real-time ms unless stated) ---- */
    this._booted = false;
    this._loading = false;
    this._pendingStage = null;            // ?stage=<id> — consumed by PLAY
    this._prePauseState = 'playing';
    this._deathT = -1;                    // <0 = no death sequence running
    this._deathCause = 'void';
    this._deathSwapped = false;
    this._deathSoft = false;
    this._introT = -1;
    this._clearT = -1;
    this._clearSummary = null;
    this._finishT = -1;
    this._timerRun = false;
    this._fadeA = 0;
    this._fadeFrom = 0; this._fadeTo = 0; this._fadeT = 0; this._fadeDur = 0;
    this._fadeColor = '#05070d';
    this._relockAt = 0;
    this._lastAction = Object.create(null);
    this._selectOpen = false;
    this._coinTaken = [];
    this._cpAuthored = [];                // clockOffset values from the stage def
    this._cpRecorded = [];                // clock recorded on first arrival
    this._portals = [];
    this._portalNear = -1;
    this._portalDwell = 0;
    this._pT = '';
    this._pS = '';
    this._pL = false;
    this._pendingFullReset = false;
    this._prevPlayerDead = false;
    this._devAccum = 0;
    this._colliderT = 0;
    this._colliderGroup = null;
    this._titleT = 0;
    this._audioStarted = false;
    this._vmWanted = false;
    this._destroyed = false;
    this._ncPos = new THREE.Vector3();
    this._bestMs = null;
    this._errStreak = 0;
    this._fovPull = 0;
    this._fovBase = undefined;
    this._fovLeft = undefined;
    this._quatBase = null;
    this._quatLeft = null;
    this._showColliders = false;
    this._playerBound = false;
    this._fadeResolve = null;
    this._settingsSub = null;
    this._spawnOut = { pos: new THREE.Vector3(), yaw: 0 };
    this._prevSelectState = 'paused';

    /* Stable physics-world handle handed to Player once and never replaced. */
    const self = this;
    this.physWorld = {
      game: this,
      get stage() { return self.stage; },
      get broadphase() { return self.stage && self.stage.broadphase ? self.stage.broadphase : EMPTY_BROADPHASE; },
      get killVolumes() { return self.stage && self.stage.killVolumes ? self.stage.killVolumes : EMPTY_ARRAY; },
      get hazards() { return self.stage && self.stage.hazards ? self.stage.hazards : EMPTY_ARRAY; },
      get checkpoints() { return self.stage && self.stage.checkpoints ? self.stage.checkpoints : EMPTY_ARRAY; },
      get coins() { return self.stage && self.stage.coins ? self.stage.coins : EMPTY_ARRAY; },
      get killY() { return self.stage && self.stage.def && isNum(self.stage.def.killY) ? self.stage.def.killY : -60; },
      get bounds() { return self.stage ? self.stage.bounds : null; },
      get scene() { return self.engine ? self.engine.scene : null; },
    };

    /* Reused HUD snapshot — HUD.update() is called every frame. */
    this._snap = {
      stageName: '', worldName: '', stageIdx: 0, stageCount: 0,
      timeMs: 0, totalMs: 0, deaths: 0, cpIndex: 0, cpCount: 0,
      progress01: 0, coins: 0, coinTotal: 0, best: null, speed: 0,
      state: 'loading', par: 0, difficulty: 1, isHub: true, pointerLocked: false,
    };

    this._buildOverlays();
  }

  /* ======================================================================
   * Injection — boot.js wires the singletons it constructed.
   * ====================================================================*/
  attach(services) {
    if (!services) return this;
    if (services.input) this.input = services.input;
    if (services.audio) this.audio = services.audio;
    if (services.fx) this.fx = services.fx;
    if (services.impacts) this.impacts = services.impacts;
    if (services.decals) this.decals = services.decals;
    if (services.mats) this.mats = services.mats;
    if (services.settings) this.settings = services.settings;
    if (services.save) this.save = services.save;
    if (typeof services.onProgress === 'function') this.onProgress = services.onProgress;
    if (typeof services.onFatal === 'function') this.onFatal = services.onFatal;
    if (services.dev !== undefined) this.dev = !!services.dev;
    if (services.stage) this._pendingStage = String(services.stage);
    return this;
  }

  attachUI(ui) {
    if (!ui) return this;
    if (ui.hud) this.hud = ui.hud;
    if (ui.menu) this.menu = ui.menu;
    if (ui.stageSelect) this.stageSelect = ui.stageSelect;
    return this;
  }

  /* ======================================================================
   * DOM overlays owned by Game
   * ====================================================================*/
  _buildOverlays() {
    const doc = document;
    if (!doc.getElementById('asc-game-style')) {
      const st = doc.createElement('style');
      st.id = 'asc-game-style';
      st.textContent = GAME_CSS;
      doc.head.appendChild(st);
    }

    const root = doc.getElementById('ui') || doc.body;
    const mk = (id, cls, html) => {
      let el = doc.getElementById(id);
      if (!el) {
        el = doc.createElement('div');
        el.id = id;
        root.appendChild(el);
      }
      el.className = cls;
      if (html !== undefined) el.innerHTML = html;
      return el;
    };

    this.el = {};
    this.el.fade = mk('asc-fade', 'asc-fade');
    this.el.intro = mk('asc-intro', 'asc-intro',
      '<div class="asc-intro-inner">' +
        '<div class="asc-intro-world"></div>' +
        '<div class="asc-intro-name"></div>' +
        '<div class="asc-intro-sub"></div>' +
        '<div class="asc-intro-diff"><span class="asc-diff-label">DIFFICULTY</span><i class="asc-pips"></i></div>' +
      '</div>');
    this.el.prompt = mk('asc-prompt', 'asc-prompt',
      '<div class="asc-prompt-inner"><b class="asc-key">E</b><span class="asc-prompt-text"></span></div>' +
      '<div class="asc-prompt-sub"></div>');
    this.el.cont = mk('asc-cont', 'asc-cont', '<span></span>');
    this.el.dev = mk('asc-dev', 'asc-dev');

    this.el.introWorld = this.el.intro.querySelector('.asc-intro-world');
    this.el.introName = this.el.intro.querySelector('.asc-intro-name');
    this.el.introSub = this.el.intro.querySelector('.asc-intro-sub');
    this.el.introPips = this.el.intro.querySelector('.asc-pips');
    this.el.promptKey = this.el.prompt.querySelector('.asc-key');
    this.el.promptText = this.el.prompt.querySelector('.asc-prompt-text');
    this.el.promptSub = this.el.prompt.querySelector('.asc-prompt-sub');
    this.el.contText = this.el.cont.querySelector('span');

    this._setFade(0);
  }

  /* ======================================================================
   * Boot (contract §21: `async boot()`)
   * ====================================================================*/
  async boot() {
    if (this._booted) return this;
    this._booted = true;

    this._progress(0.05, 'reading save');
    safe(() => this.save.load(), 'save.load');

    this._progress(0.14, 'applying settings');
    this._applySettings();
    if (this.settings && typeof this.settings.on === 'function') {
      this._settingsSub = () => this._applySettings();
      this.settings.on(this._settingsSub);
    }

    this._progress(0.22, 'wiring input');
    this._bindInput();
    this._bindWindow();

    /* The hub doubles as the title backdrop: the menu sits over a real, lit,
       playable world instead of a black void.  Control is withheld until PLAY. */
    this._progress(0.35, 'building the sanctum');
    await this.loadStage(HUB_ID, { silent: true, toTitle: true, holdVeil: true });

    this._progress(0.96, 'ready');
    this.state = 'title';
    this._suspendInput(true);
    safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
    safe(() => this.viewmodel && this.viewmodel.setVisible(false), 'vm.setVisible');
    safe(() => this.menu && this.menu.open('title'), 'menu.open(title)');

    if (this.dev) this._installDev();

    /* Start the loop BEFORE lifting the veil so the reveal is actually animated
       (the tween is driven by update(), not by a CSS transition). */
    this.engine.start((dt) => this.update(dt));
    this._fadeIn(760);
    this._progress(1, 'ready');
    return this;
  }

  _suspendInput(on) {
    const inp = this.input;
    if (!inp) return;
    if (typeof inp.setSuspended === 'function') safe(() => inp.setSuspended(!!on), 'setSuspended');
    else inp.suspended = !!on;
  }

  _progress(p, msg) {
    if (typeof this.onProgress === 'function') safe(() => this.onProgress(clamp(p, 0, 1), msg), 'onProgress');
  }

  /* ======================================================================
   * Settings
   * ====================================================================*/
  _applySettings() {
    const S = this.settings || Settings;
    const s = safe(() => S.get(), 'settings.get') || {};
    const q = safe(() => S.quality(), 'settings.quality') || null;

    if (this.input && typeof this.input.setSensitivity === 'function') {
      this.input.setSensitivity(isNum(s.sens) ? s.sens : 1, !!s.invertY);
    }
    if (this.audio && typeof this.audio.setVolumes === 'function') {
      safe(() => this.audio.setVolumes({
        master: isNum(s.master) ? s.master : 0.8,
        music: isNum(s.music) ? s.music : 0.6,
        sfx: isNum(s.sfx) ? s.sfx : 0.9,
      }), 'audio.setVolumes');
    }
    if (q) {
      if (this.engine && this.engine.post && typeof this.engine.post.setQuality === 'function') {
        safe(() => this.engine.post.setQuality(q), 'post.setQuality');
      }
      if (this.fx && typeof this.fx.setQuality === 'function') safe(() => this.fx.setQuality(q), 'fx.setQuality');
    }
    this._vmWanted = s.showViewmodel !== false;
    if (this.viewmodel && typeof this.viewmodel.setVisible === 'function') {
      const live = this.state === 'playing' || this.state === 'hub' || this.state === 'dead' || this.state === 'cleared';
      safe(() => this.viewmodel.setVisible(this._vmWanted && live), 'vm.setVisible');
    }
  }

  /* ======================================================================
   * Event wiring
   * ====================================================================*/
  _bindInput() {
    const inp = this.input;
    if (!inp) return;
    bindEvent(inp, 'pause', () => {
      /* Input fires this on ESC, pointer-lock loss and tab hide. */
      if (this.state === 'paused') { this.resume(); return; }
      this.pause('input');
    });
    bindEvent(inp, 'blur', () => { this.pause('blur'); });
    bindEvent(inp, 'unlock', () => {
      if (this._isLive() && this._deathT < 0) this.pause('unlock');
    });
  }

  _bindWindow() {
    if (typeof window === 'undefined') return;
    this._onWinBlur = () => this.pause('blur');
    this._onWinResize = () => safe(() => this.engine.resize(), 'engine.resize');
    window.addEventListener('blur', this._onWinBlur, false);
    window.addEventListener('resize', this._onWinResize, false);

    /* game_controls.js drives this (its Pause button + exit-fullscreen). */
    window.__PAUSE__ = {
      toggle: () => this.togglePause(),
      pause: () => this.pause('controls'),
      resume: () => this.resume(),
      isPaused: () => this.state === 'paused',
    };
  }

  /**
   * The Player raises what only the Player can know: it died, it landed.
   *
   * It does NOT raise checkpoint/coin/finish — the Stage detects those, because
   * the Stage owns the pads, the orbs and the gate. Binding them here as well
   * would either be dead (the controller never emits them) or a second, rival
   * trigger system. See _bindStageEvents.
   */
  _bindPlayerEvents() {
    const p = this.player;
    if (!p || !p.events || this._playerBound) return;
    this._playerBound = true;
    bindEvent(p.events, 'death', (cause) => this.onDeath(typeof cause === 'string' ? cause : 'void'));
    bindEvent(p.events, 'land', (speed, surface) => {
      if (this.impacts && typeof this.impacts.land === 'function') {
        safe(() => this.impacts.land(speed, surface, p.pos), 'impacts.land');
      }
    });
  }

  /**
   * The stage is the single detector of checkpoints, orbs and the gate; Game is
   * the single owner of what they MEAN — save writes, HUD, audio, particles,
   * camera punch and progression. One detection, one reaction, no flags.
   *
   * Bound per stage: each Stage builds a fresh Emitter, and the old stage is
   * disposed (which clears its listeners) in _disposeStage.
   */
  _bindStageEvents(stage) {
    if (!stage || !stage.events) return;
    bindEvent(stage.events, 'checkpoint', (i) => this.onCheckpoint(i | 0));
    bindEvent(stage.events, 'coin', (i) => this.onCoin(i | 0));
    bindEvent(stage.events, 'finish', () => this.onFinish());
  }

  /* ======================================================================
   * Stage lifecycle
   * ====================================================================*/

  /**
   * @param {string} stageId
   * @param {{silent?:boolean, toTitle?:boolean, fromHub?:boolean}} [opts]
   */
  async loadStage(stageId, opts) {
    const o = opts || {};
    if (this._loading) return this;
    this._loading = true;
    const id = String(stageId || HUB_ID);

    try {
      /* ---- 1. freeze the world, THEN veil it ---- */
      this.state = 'loading';
      this._timerRun = false;
      this._endIntro(true);
      this._endClear(true);
      this._cancelDeath();
      this._setPrompt('', '');
      this._hideCont();
      safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
      safe(() => this.viewmodel && this.viewmodel.setVisible(false), 'vm.setVisible');
      this._suspendInput(true);

      if (!o.silent) {
        this._setFadeColor(this._fadeColorFor(this._themeForStage(id)));
        await this._fadeOut(200);
      } else {
        this._setFade(1);
      }

      this._progress(0.40, 'loading ' + id);

      /* ---- 2. resolve the def ---- */
      const def = await this._resolveStageDef(id);
      if (!def) throw new Error('stage "' + id + '" has no definition');

      /* ---- 3. tear the old stage down (never on respawn — only here) ---- */
      this._disposeStage();

      /* ---- 4. theme first, so the stage builds against the right palette --- */
      const themeId = def.theme || (this._worldOf(id) && this._worldOf(id).theme) || (id === HUB_ID ? 'hub' : 'neon');
      this._applyThemeFor(themeId);
      this._progress(0.55, 'materialising');

      /* ---- 5. build ---- */
      const ctx = { mats: this.mats, fx: this.fx, audio: this.audio, save: this.save, game: this, engine: this.engine };
      let stage = null;
      if (typeof Stage.load === 'function') stage = await Stage.load(def, this.engine, ctx);
      if (!stage) stage = new Stage(def, this.engine, ctx);
      this.stage = stage;
      this.stageId = def.id || id;
      this.world = this._worldOf(this.stageId);
      if (stage.group && this.engine.scene && !stage.group.parent) this.engine.scene.add(stage.group);
      /* Checkpoints, orbs and the gate reach Game only through here. */
      this._bindStageEvents(stage);

      this._progress(0.72, 'placing hazards');

      /* ---- 6. per-stage bookkeeping ---- */
      const cps = stage.checkpoints || EMPTY_ARRAY;
      this._cpAuthored.length = 0;
      this._cpRecorded.length = 0;
      for (let i = 0; i < cps.length; i++) {
        const src = (def.checkpoints && def.checkpoints[i]) || cps[i] || null;
        this._cpAuthored[i] = src && isNum(src.clockOffset) ? src.clockOffset : undefined;
        this._cpRecorded[i] = undefined;
      }
      this._coinTaken.length = 0;
      const coinCount = (stage.coins && stage.coins.length) || 0;
      for (let i = 0; i < coinCount; i++) this._coinTaken[i] = false;
      this.coins = 0;
      this.cpIndex = 0;
      this.stageDeaths = 0;
      this.timeMs = 0;
      this._portals = this._resolvePortals(def, stage);
      this._portalNear = -1;
      this._portalDwell = 0;
      this._refreshPortalState();

      /* Cached once per load — _snapshot() runs every frame and must not
         re-read the save store (it allocates a record object per call). */
      const rec0 = this.stageId === HUB_ID ? null : safe(() => this.save.stage(this.stageId), 'save.stage');
      this._bestMs = rec0 && isNum(rec0.best) ? rec0.best : null;

      /* ---- 7. audio + ambience ---- */
      safe(() => this.audio && this.audio.setTheme(themeId), 'audio.setTheme');
      this._startAmbience();

      /* ---- 8. player / camera / viewmodel (built once, reused forever) ---- */
      this._ensureActors();
      /* The stage must track the FEET. Without this it falls back to the engine
         camera — 1.62 m too high for every pad, orb, cull and light test. */
      safe(() => stage.setPlayer(this.player), 'stage.setPlayer');
      const sp = this._spawnFor(0);
      safe(() => this.player.spawn(sp.pos, sp.yaw), 'player.spawn');
      this._ncPos.copy(this.player.pos);
      safe(() => this.camera && this.camera.setDeathCam(false), 'camera.setDeathCam');
      safe(() => this.viewmodel && this.viewmodel.setTheme(this.theme), 'vm.setTheme');
      if (this.engine.post) {
        safe(() => this.engine.post.setDamage(0), 'post.setDamage');
      }

      /* ---- 9. one settle frame so the first visible frame is complete ---- */
      safe(() => stage.update(0), 'stage.update(0)');
      safe(() => this.player.update(0), 'player.update(0)');
      safe(() => this.camera && this.camera.update(0), 'camera.update(0)');
      this._progress(0.9, 'ready');

      /* ---- 10. hand over.  The reveal and the intro card run together, both
         driven by update() — never awaited, or the loop would stall on them. */
      if (o.toTitle) {
        this.state = 'title';
        if (!o.holdVeil) this._fadeIn(520);
      } else {
        this._fadeIn(300);
        this._startIntro(def);
      }
      return this;
    } catch (err) {
      this._loading = false;
      this._onLoadError(id, err);
      throw err;
    } finally {
      this._loading = false;
    }
  }

  async _resolveStageDef(id) {
    let def = null;
    if (id === HUB_ID && HUB && typeof HUB === 'object') def = HUB;
    if (!def && typeof getStage === 'function') def = await getStage(id);
    if (def && def.default) def = def.default;
    if (def && !def.id) def.id = id;
    return def || null;
  }

  _onLoadError(id, err) {
    if (typeof console !== 'undefined') console.error('[ascendant] stage load failed: ' + id, err);
    this._setFade(0);
    this.state = this.stage ? (this.stageId === HUB_ID ? 'hub' : 'playing') : 'title';
    if (this.hud && typeof this.hud.toast === 'function') {
      safe(() => this.hud.toast('COULD NOT LOAD ' + String(id).toUpperCase(), String(err && err.message || err), 'error'), 'hud.toast');
    }
    if (!this.stage) safe(() => this.menu && this.menu.open('title'), 'menu.open');
  }

  _disposeStage() {
    const st = this.stage;
    if (!st) return;
    this.stage = null;
    this._clearColliderDebug();
    /* Marks belong to the world they were left in. */
    safe(() => this.decals && this.decals.clear(), 'decals.clear');
    safe(() => this.impacts && this.impacts.cancelDeath(), 'impacts.cancelDeath');
    safe(() => { if (st.group && st.group.parent) st.group.parent.remove(st.group); }, 'scene.remove');
    safe(() => st.dispose(), 'stage.dispose');   // also clears its event listeners
  }

  _ensureActors() {
    if (!this.player) {
      this.player = new Player(this.physWorld, this.input, this.audio, this.fx);
      this._bindPlayerEvents();
    } else {
      /* Same physWorld object — but re-point any field the Player cached. */
      const p = this.player;
      if ('world' in p) p.world = this.physWorld;
      if ('broadphase' in p) p.broadphase = this.physWorld.broadphase;
      if ('killVolumes' in p) p.killVolumes = this.physWorld.killVolumes;
      if ('killY' in p) p.killY = this.physWorld.killY;
    }
    const post = this.engine ? this.engine.post : null;
    if (!this.camera) {
      /* 5th arg: Post drives the death-cam desaturation. Without it FPCamera
         hunts for a `setDamage` on player.fx and silently gives up. */
      this.camera = new FPCamera(this.engine.camera, this.player, this.input, this.settings || Settings, post);
    } else if (post && this.camera.post !== post && typeof this.camera.setPost === 'function') {
      /* Camera outlives the stage; re-point it if it ever lost the chain. */
      safe(() => this.camera.setPost(post), 'camera.setPost');
    }
    if (!this.viewmodel) {
      /* CONTRACT §15: the arms live on the OVERLAY pair, never in the world.
         engine.overlayScene/overlayCamera are what post.js's ViewmodelPass draws;
         building them into engine.scene both clipped them through geometry and
         left that pass rendering an empty scene. */
      const vmScene = (this.engine && this.engine.overlayScene) || this.engine.scene;
      const vmCam = (this.engine && this.engine.overlayCamera) || this.engine.camera;
      this.viewmodel = new Viewmodel(vmScene, vmCam, this.theme);
    }
    this._wireImpacts();
  }

  /**
   * Impacts is constructed in boot.js before FPCamera and Post exist, so the
   * pieces it needs arrive here, once both do. Until this ran, `_dip`, `_shake`,
   * `_deathCam`, the screen flash (`_pulse`) and the damage vignette (`_damage`)
   * were all guarded no-ops: Impacts held the raw PerspectiveCamera, which has
   * none of those methods, and no Post at all.
   */
  _wireImpacts() {
    const im = this.impacts;
    if (!im) return;
    const post = this.engine ? this.engine.post : null;
    if (this.camera && typeof im.setCamera === 'function' && im.camera !== this.camera) {
      safe(() => im.setCamera(this.camera), 'impacts.setCamera');
    }
    if (post && typeof im.setPost === 'function' && im.post !== post) {
      safe(() => im.setPost(post), 'impacts.setPost');
    }
    if (this.decals && typeof im.setDecals === 'function' && im.decals !== this.decals) {
      safe(() => im.setDecals(this.decals), 'impacts.setDecals');
    }
    if (this.theme && typeof im.setTheme === 'function') safe(() => im.setTheme(this.theme), 'impacts.setTheme');
  }

  _startAmbience() {
    if (!this.fx || typeof this.fx.ambient !== 'function') return;
    const th = this.theme;
    const part = th && th.particles ? th.particles : null;
    const b = (this.stage && this.stage.bounds) || null;
    if (!part) return;
    const box = b || _box.set(_v1.set(-40, -10, -40), _v2.set(40, 60, 40));
    safe(() => this.fx.ambient(part.type || 'mote', box, isNum(part.rate) ? part.rate : 12), 'fx.ambient');
  }

  _themeForStage(id) {
    if (id === HUB_ID) return (HUB && HUB.theme) || 'hub';
    const w = this._worldOf(id);
    return (w && w.theme) || 'neon';
  }

  _applyThemeFor(themeId) {
    this.themeId = themeId;
    const th = (THEMES && THEMES[themeId]) || (THEMES && THEMES.hub) || null;
    this.theme = th;
    let ok = false;
    if (typeof applyTheme === 'function') {
      ok = safe(() => { applyTheme(this.engine, themeId); return true; }, 'applyTheme') === true;
    }
    if (!ok && th && this.engine && typeof this.engine.setTheme === 'function') {
      safe(() => this.engine.setTheme(th), 'engine.setTheme');
    }
    /* Expose the palette to the CSS overlays so cards inherit the world tint. */
    const pal = (th && th.palette) || {};
    const accent = cssColor(pal.accent || pal.checkpointOn || pal.checkpoint, '#5ec8ff');
    const root = document.documentElement;
    root.style.setProperty('--asc-accent', accent);
    root.style.setProperty('--asc-accent-dim', shade(accent, 0.45));
    root.style.setProperty('--asc-kill', cssColor(pal.kill, '#ff5a3c'));
    root.style.setProperty('--asc-bg', cssColor(th && th.bg, '#05070d'));
    this._setFadeColor(this._fadeColorFor(themeId));
  }

  _fadeColorFor(themeId) {
    const th = (THEMES && THEMES[themeId]) || null;
    if (!th) return '#05070d';
    const bg = cssColor(th.bg || (th.fog && th.fog.color), '#05070d');
    return shade(bg, 0.34);
  }

  _worldOf(stageId) {
    if (!WORLDS || !WORLDS.length || !stageId || stageId === HUB_ID) return null;
    for (let i = 0; i < WORLDS.length; i++) {
      const w = WORLDS[i];
      if (w && w.stages && w.stages.indexOf(stageId) !== -1) return w;
    }
    return null;
  }

  /* ======================================================================
   * Stage intro card
   * ====================================================================*/
  _startIntro(def) {
    const w = this._worldOf(def.id);
    const isHub = def.id === HUB_ID;
    this.state = isHub ? 'hub' : 'playing';
    this._introT = 0;
    this._timerRun = false;

    const worldName = isHub ? 'THE SANCTUM' : (w && w.name) || (def.world || '').toUpperCase();
    const idx = w ? w.stages.indexOf(def.id) + 1 : 0;
    const label = idx > 0 ? worldName + '  ·  STAGE ' + idx + ' / ' + w.stages.length : worldName;

    this.el.introWorld.textContent = label;
    this.el.introName.textContent = def.name || String(def.id || '').toUpperCase();
    this.el.introSub.textContent = def.subtitle || '';
    this.el.introSub.style.display = def.subtitle ? '' : 'none';

    const diff = clamp(Math.round(isNum(def.difficulty) ? def.difficulty : 1), 1, 10);
    let pips = '';
    for (let i = 0; i < 10; i++) pips += '<u class="' + (i < diff ? 'on' : '') + '"></u>';
    this.el.introPips.innerHTML = pips;
    this.el.intro.querySelector('.asc-intro-diff').style.display = isHub ? 'none' : '';

    this.el.intro.classList.add('show');
    safe(() => this.hud && this.hud.setVisible(true), 'hud.setVisible');
    safe(() => this.viewmodel && this.viewmodel.setVisible(this._vmWanted), 'vm.setVisible');

    /* Input comes back NOW so the card is skippable and you can look around
       while it reads; the body stays frozen because update() skips
       player.update while _introT >= 0. */
    this._suspendInput(false);
    this._requestLockSoon(0);
  }

  _stepIntro(ms) {
    this._introT += ms;
    if (this._introT >= INTRO_MS) { this._endIntro(); return; }
    if (this._introT > INTRO_MIN_SKIP && this.input) {
      const i = this.input;
      if (i.jumpPressed || i.interactPressed || i.crouchPressed || i.sprintPressed) this._endIntro();
    }
  }

  _endIntro(silent) {
    if (this._introT < 0) return;
    this._introT = -1;
    this.el.intro.classList.remove('show');
    if (!silent) this._handOverControl();
  }

  _handOverControl() {
    const isHub = this.stageId === HUB_ID;
    this.state = isHub ? 'hub' : 'playing';
    this._timerRun = true;
    this._suspendInput(false);
    safe(() => this.hud && this.hud.setVisible(true), 'hud.setVisible');
    safe(() => this.viewmodel && this.viewmodel.setVisible(this._vmWanted), 'vm.setVisible');
    this._requestLockSoon(0);
  }

  /* ======================================================================
   * Title -> play
   * ====================================================================*/

  /** The PLAY button.  This click IS the user gesture that starts audio. */
  startGame() {
    this.startAudio();
    safe(() => this.menu && this.menu.close(), 'menu.close');
    const target = this._pendingStage;
    this._pendingStage = null;
    if (target && target !== HUB_ID) {
      this.loadStage(target).catch(() => {});
      return;
    }
    /* Already standing in the hub — just take the controls. */
    if (this.stageId === HUB_ID && this.stage) {
      this._startIntro(this.stage.def || HUB);
      return;
    }
    this.returnToHub();
  }

  /* Aliases a Menu implementation may reasonably reach for. */
  play() { this.startGame(); }
  start() { this.startGame(); }
  continueRun() { this.startGame(); }

  startAudio() {
    if (this._audioStarted || !this.audio) return;
    this._audioStarted = true;
    safe(() => this.audio.init(), 'audio.init');
    safe(() => this.audio.setTheme(this.themeId), 'audio.setTheme');
    this._applySettings();
  }

  toTitle() {
    this._cancelDeath();
    this._endIntro(true);
    this._endClear(true);
    this.state = 'title';
    this._timerRun = false;
    if (this.input) {
      this._suspendInput(true);
      safe(() => this.input.releaseLock(), 'releaseLock');
    }
    safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
    safe(() => this.viewmodel && this.viewmodel.setVisible(false), 'vm.setVisible');
    safe(() => this.menu && this.menu.open('title'), 'menu.open');
  }
  quitToTitle() { this.toTitle(); }

  /* ======================================================================
   * Pause
   * ====================================================================*/
  pause(reason) {
    if (this.state !== 'playing' && this.state !== 'hub') return;
    if (this._deathT >= 0) return;                  // never mid-death sequence
    this._prePauseState = this.state;
    this.state = 'paused';
    this._timerRun = false;
    if (this.input) {
      this._suspendInput(true);
      safe(() => this.input.releaseLock(), 'releaseLock');
    }
    this._setPrompt('', '');
    safe(() => this.audio && this.audio.duck(400), 'audio.duck');
    safe(() => this.menu && this.menu.open('pause'), 'menu.open(pause)');
  }

  resume() {
    if (this.state !== 'paused') return;
    safe(() => this.menu && this.menu.close(), 'menu.close');
    this.state = this._prePauseState === 'hub' ? 'hub' : 'playing';
    this._timerRun = true;
    this._suspendInput(false);
    this._requestLockSoon(140);
  }
  unpause() { this.resume(); }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause('toggle');
  }

  _requestLockSoon(delayMs) {
    this._relockAt = nowMs() + (isNum(delayMs) ? delayMs : 0);
  }

  /* ======================================================================
   * Menus opened from the pause screen
   * ====================================================================*/
  openSettings() { safe(() => this.menu && this.menu.open('settings'), 'menu.open'); }
  openControls() { safe(() => this.menu && this.menu.open('controls'), 'menu.open'); }
  openCredits() { safe(() => this.menu && this.menu.open('credits'), 'menu.open'); }

  openStageSelect() {
    if (!this.stageSelect) return;
    if (this._isLive()) this.pause('select');
    this._selectOpen = true;
    this._prevSelectState = this.state;
    this.state = 'select';
    safe(() => this.menu && this.menu.close(), 'menu.close');
    safe(() => this.stageSelect.open(), 'stageSelect.open');
  }

  closeStageSelect() {
    if (!this._selectOpen) return;
    this._selectOpen = false;
    safe(() => this.stageSelect && this.stageSelect.close(), 'stageSelect.close');
    if (this.state === 'select') {
      this.state = 'paused';
      safe(() => this.menu && this.menu.open('pause'), 'menu.open(pause)');
    }
  }

  toggleStageSelect() {
    if (this._selectOpen || this.state === 'select') this.closeStageSelect();
    else this.openStageSelect();
  }

  /* ======================================================================
   * Death loop — contract §21, <= 620 ms, never rebuilds the stage.
   * ====================================================================*/
  onDeath(cause) {
    if (this._deathT >= 0) return;                  // already dying
    if (this.noclip) return;                        // dev fly-through is immune
    if (!this._isLive() && this.state !== 'cleared') return;
    if (this.state === 'cleared') return;           // finished — no post-mortem

    const c = typeof cause === 'string' && cause ? cause : 'void';
    this.deaths++;
    this.stageDeaths++;
    if (this.stageId && this.stageId !== HUB_ID) safe(() => this.save.addDeath(this.stageId), 'save.addDeath');
    this._beginRespawn(true, c);
  }

  /** Contract §21 `respawn()` — back to the last checkpoint, no death counted. */
  respawn() {
    if (this._deathT >= 0 || !this._isLive()) return;
    if (!this._cooldown('respawn')) return;
    this._beginRespawn(false, 'manual');
  }

  _beginRespawn(isDeath, cause) {
    this._killFadeTween();          // the sequence drives the veil frame-exactly
    this.state = 'dead';
    this._deathCause = cause || 'void';
    this._deathSoft = !isDeath;
    this._deathSwapped = false;
    this._deathT = isDeath ? 0 : T_SOFT_START;
    this._timerRun = false;
    this._setPrompt('', '');
    this._portalDwell = 0;

    this._suspendInput(true);
    this._setFadeColor(this._fadeColorFor(this.themeId));

    if (isDeath) {
      /* THE FELT DEATH IS IMPACTS' JOB (contract §19): the cause-coloured screen
         flash, the damage vignette, the death cam, the knock, the burst, the duck
         and the death hit are all one call — and now that Game hands it the real
         FPCamera and Post (_wireImpacts) and ticks its clock, they all land.
         Game keeps the TIMELINE: the veil, the swap at 410 ms and the state.
         Doing any of it here as well would be the same defect twice over. */
      const p = this.player ? this.player.pos : _v1.set(0, 0, 0);
      if (this._impactsOwnsDeathScreen()) {
        safe(() => this.impacts.death(this._deathCause, p), 'impacts.death');
      } else {
        /* No Impacts (a harness may run without it) — Game covers the minimum. */
        const post = this.engine && this.engine.post;
        if (post) safe(() => post.pulse(0.85, D_FLASH), 'post.pulse');
        safe(() => this.camera && this.camera.setDeathCam(true), 'camera.setDeathCam');
        safe(() => this.camera && this.camera.shake(0.55, 220), 'camera.shake');
        if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('death', p), 'fx.burst');
        safe(() => this.audio && this.audio.sfx('death'), 'audio.sfx');
        safe(() => this.audio && this.audio.duck(700), 'audio.duck');
      }
      safe(() => this.hud && this.hud.deathFlash(this._deathCause), 'hud.deathFlash');
    } else {
      safe(() => this.audio && this.audio.duck(260), 'audio.duck');
    }
  }

  /**
   * Whether fx/impacts.js is driving the death SCREEN this run — the flash and
   * the damage vignette. Exactly one system does; Game keeps the timeline (veil,
   * the swap at 410 ms, the state) either way, and takes the screen over only
   * where there is no Impacts to hand it to.
   */
  _impactsOwnsDeathScreen() {
    return !!(this.impacts && typeof this.impacts.death === 'function');
  }

  _stepDeath(ms) {
    this._deathT += ms;
    const t = this._deathT;
    const post = this.engine && this.engine.post;

    /* Damage vignette: up through the flash, hold, then release on fade-in.
       Impacts runs this exact ramp off its own clock when it owns the screen. */
    if (post && !this._deathSoft && !this._impactsOwnsDeathScreen()) {
      let dmg;
      if (t < D_FLASH) dmg = t / D_FLASH;
      else if (t < T_FADE_END) dmg = 1;
      else dmg = 1 - clamp((t - T_FADE_END) / D_RESTORE, 0, 1);
      safe(() => post.setDamage(clamp(dmg, 0, 1)), 'post.setDamage');
    }

    /* Veil: 0 until the hold ends, up over 140 ms, back down over 210 ms. */
    const swapping = !this._deathSwapped && t >= T_FADE_END;
    let a;
    if (swapping) a = 1;                       // the swap frame is FULLY black
    else if (t < T_HOLD_END) a = 0;
    else if (t < T_FADE_END) a = smoothstep(0, 1, (t - T_HOLD_END) / D_FADE);
    else a = 1 - easeOutCubic(clamp((t - T_FADE_END) / D_RESTORE, 0, 1));
    this._setFade(clamp(a, 0, 1));

    /* The swap happens at full black — one frame, no stage rebuild. */
    if (swapping) {
      this._deathSwapped = true;
      this._performRespawn();
      return;                                  // fade-in starts next frame
    }

    /* End on the NEAREST frame to the 620 ms budget rather than the first frame
       past it, so frame quantisation does not bias the loop long. */
    if (t >= T_DEATH_END - ms * 0.5) {
      this._deathT = -1;
      this._deathSoft = false;
      this._setFade(0);
      if (post) safe(() => post.setDamage(0), 'post.setDamage');
      this.state = this.stageId === HUB_ID ? 'hub' : 'playing';
      this._timerRun = true;
    }
  }

  /** Runs during black: rewind hazards, replace the player, restore the camera. */
  _performRespawn() {
    if (this._pendingFullReset) this._fullStageReset();
    const cp = this.cpIndex;
    if (this.stage) {
      /* resetFrom rewinds the stage clock so the gauntlet presents the same
         phase every attempt — that is what makes it learnable (contract §17). */
      safe(() => this.stage.resetFrom(cp), 'stage.resetFrom');
    }
    const sp = this._spawnFor(cp);
    if (this.player) {
      safe(() => this.player.respawn(sp.pos, sp.yaw), 'player.respawn');
      this._ncPos.copy(this.player.pos);
    }
    safe(() => this.camera && this.camera.setDeathCam(false), 'camera.setDeathCam');
    safe(() => this.camera && this.camera.update(0), 'camera.update(0)');
    safe(() => this.viewmodel && this.viewmodel.update(0, this.player), 'vm.update(0)');
    /* The camera is back — hand the controls over immediately (contract §21). */
    if (this.input) {
      safe(() => this.input.clear(), 'input.clear');
      this._suspendInput(false);
    }
    this._requestLockSoon(0);
  }

  _cancelDeath() {
    if (this._deathT < 0) return;
    this._deathT = -1;
    this._deathSoft = false;
    this._deathSwapped = false;
    /* Abort the felt half too, or its state machine stays latched and swallows
       every later death (`if (this.deathActive) return`). */
    safe(() => this.impacts && this.impacts.cancelDeath(), 'impacts.cancelDeath');
    if (this.engine && this.engine.post) safe(() => this.engine.post.setDamage(0), 'post.setDamage');
    safe(() => this.camera && this.camera.setDeathCam(false), 'camera.setDeathCam');
  }

  _spawnFor(cpIndex) {
    const out = this._spawnOut || (this._spawnOut = { pos: new THREE.Vector3(), yaw: 0 });
    let got = null;
    if (this.stage && typeof this.stage.spawnFor === 'function') {
      got = safe(() => this.stage.spawnFor(cpIndex | 0), 'stage.spawnFor');
    }
    if (got) {
      toVec3(got.pos !== undefined ? got.pos : got, out.pos);
      out.yaw = yawOf(got, 0);
      return out;
    }
    const def = (this.stage && this.stage.def) || null;
    const cps = (this.stage && this.stage.checkpoints) || (def && def.checkpoints) || EMPTY_ARRAY;
    const cp = cpIndex > 0 ? cps[cpIndex] : null;
    if (cp) { toVec3(cp, out.pos); out.yaw = yawOf(cp, 0); return out; }
    const sp = def && def.spawn ? def.spawn : null;
    toVec3(sp, out.pos);
    out.yaw = yawOf(sp, 0);
    return out;
  }

  /* ======================================================================
   * Checkpoints / coins / finish
   *
   * Each of these runs EXACTLY ONCE per event, from exactly one place:
   * stage.events -> _bindStageEvents -> here. The Stage has already lit the pad
   * / popped the orb / flared the gate; everything below is the part Game owns —
   * save, HUD, audio, particles, camera and progression.
   * ====================================================================*/
  onCheckpoint(i) {
    const idx = i | 0;
    if (!this.stage || idx <= this.cpIndex) return;   // never go backwards
    const cps = this.stage.checkpoints || EMPTY_ARRAY;
    if (idx >= cps.length) return;

    this.cpIndex = idx;
    this._recordCpClock(idx);
    if (this.stageId && this.stageId !== HUB_ID) safe(() => this.save.setCheckpoint(this.stageId, idx), 'save.setCheckpoint');

    safe(() => this.hud && this.hud.checkpointFlash(), 'hud.checkpointFlash');
    safe(() => this.hud && this.hud.toast('CHECKPOINT ' + idx + ' / ' + (cps.length - 1), fmtTime(this.timeMs / 1000), 'checkpoint'), 'hud.toast');
    safe(() => this.audio && this.audio.sfx('checkpoint'), 'audio.sfx');
    safe(() => this.camera && this.camera.dip(-0.06), 'camera.dip');
    safe(() => this.camera && this.camera.punch && this.camera.punch(), 'camera.punch');
    if (this.fx && typeof this.fx.burst === 'function') {
      toVec3(cps[idx], _v1);
      safe(() => this.fx.burst('checkpoint', _v1), 'fx.burst');
    }
  }

  /**
   * The stage clock at the moment of first arrival becomes the respawn phase —
   * but ONLY where the author did not pin `clockOffset`.  An authored offset is
   * a deliberate difficulty statement and is never overwritten.
   */
  _recordCpClock(i) {
    if (!this.stage) return;
    if (this._cpAuthored[i] !== undefined) return;
    if (this._cpRecorded[i] !== undefined) return;
    const clock = isNum(this.stage.clock) ? this.stage.clock : 0;
    this._cpRecorded[i] = clock;
    const cp = this.stage.checkpoints && this.stage.checkpoints[i];
    if (cp) cp.clockOffset = clock;
  }

  onCoin(i) {
    const idx = i | 0;
    if (!this.stage || !this.stage.coins || idx < 0 || idx >= this.stage.coins.length) return;
    if (this._coinTaken[idx]) return;
    this._coinTaken[idx] = true;
    this.coins++;
    if (this.stageId && this.stageId !== HUB_ID) safe(() => this.save.collectCoin(this.stageId, idx), 'save.collectCoin');

    /* The orb's own pop/ghost-halo is the Stage's; Game only reads where it was
       so the burst lands in the right place. */
    toVec3(this.stage.coins[idx], _v1);
    if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('coin', _v1), 'fx.burst');
    safe(() => this.audio && this.audio.sfx('coin'), 'audio.sfx');
    safe(() => this.hud && this.hud.toast('ORB ' + this.coins + ' / ' + this.stage.coins.length, '', 'coin'), 'hud.toast');
  }

  onFinish() {
    if (this.state === 'cleared' || this._clearT >= 0) return;
    if (!this._isLive()) return;
    /* A stage with no gate can never be cleared — the hub declares `finish: null`
       and there is nothing to clear in the sanctum. No clear card, no best time,
       no nextStage. (Stage never raises `finish` there either; this is the belt
       to that braces, and it reads off the stage rather than off an id.) */
    if (!this._canClear()) return;

    this.state = 'cleared';
    this._timerRun = false;
    this._clearT = 0;
    this._finishT = 0;
    this.timeScale = FINISH_SLOWMO_MIN;
    if (this.input) safe(() => this.input.clear(), 'input.clear');

    const ms = Math.round(this.timeMs);
    const rec = safe(() => this.save.stage(this.stageId), 'save.stage') || {};
    const prevBest = isNum(rec.best) ? rec.best : null;
    const isBest = prevBest === null || ms < prevBest;

    safe(() => this.save.clearStage(this.stageId, ms), 'save.clearStage');
    if (isBest) { safe(() => this.save.setBest(this.stageId, ms), 'save.setBest'); this._bestMs = ms; }

    const def = (this.stage && this.stage.def) || {};
    const w = this.world;
    const summary = {
      stageId: this.stageId,
      stageName: def.name || String(this.stageId).toUpperCase(),
      worldName: (w && w.name) || '',
      timeMs: ms,
      best: isBest ? ms : prevBest,
      prevBest,
      isNewBest: isBest,
      par: isNum(def.par) ? def.par : 0,
      underPar: isNum(def.par) ? ms <= def.par : false,
      deaths: this.stageDeaths,
      totalDeaths: this.deaths,
      coins: this.coins,
      coinTotal: (this.stage && this.stage.coins && this.stage.coins.length) || 0,
      totalMs: Math.round(this.totalMs),
      isLastOfWorld: this._isLastOfWorld(),
    };
    this._clearSummary = summary;

    /* Finish sequence: particles, fanfare, duck, bloom lift, camera pull. */
    const p = this.player ? this.player.pos : _v1.set(0, 0, 0);
    if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('finish', p), 'fx.burst');
    safe(() => this.audio && this.audio.sfx('finish'), 'audio.sfx');
    safe(() => this.audio && this.audio.duck(900), 'audio.duck');
    if (this.engine && this.engine.post) {
      safe(() => this.engine.post.pulse(0.45, 260), 'post.pulse');
      const bl = (this.theme && this.theme.bloom) || null;
      if (bl) safe(() => this.engine.post.setBloom({
        strength: (isNum(bl.strength) ? bl.strength : 0.6) * 1.9,
        radius: isNum(bl.radius) ? bl.radius : 0.5,
        threshold: isNum(bl.threshold) ? bl.threshold : 0.75,
      }), 'post.setBloom');
    }
    safe(() => this.hud && this.hud.finish(summary), 'hud.finish');
    this._showCont(summary.isLastOfWorld ? 'WORLD COMPLETE — PRESS JUMP' : 'PRESS JUMP TO CONTINUE');
  }

  /**
   * Can the current stage be completed at all? A stage without a finish gate
   * (the hub: `isHub: true`, `finish: null`) has no clear condition, so no clear
   * card, no best time and no next stage — you leave it through a portal.
   */
  _canClear() {
    if (!this.stage || this.stageId === HUB_ID) return false;
    return !!this.stage.finish;
  }

  _isLastOfWorld() {
    const w = this.world;
    if (!w || !w.stages) return false;
    return w.stages.indexOf(this.stageId) === w.stages.length - 1;
  }

  _stepClear(ms) {
    this._clearT += ms;
    const t = this._clearT;

    /* 400 ms slow-mo, easing back to real time. */
    if (this._finishT >= 0) {
      this._finishT += ms;
      const k = clamp(this._finishT / FINISH_SLOWMO_MS, 0, 1);
      this.timeScale = lerp(FINISH_SLOWMO_MIN, 1, easeOutCubic(k));
      if (k >= 1) { this.timeScale = 1; this._finishT = -1; }
    }

    /* Camera pull: an 8-degree FOV push that settles over 900 ms.  Applied
       AFTER FPCamera.update so it composes with, rather than fights, the rig. */
    const pull = 1 - clamp(t / 900, 0, 1);
    this._fovPull = 9 * easeOutCubic(pull);

    const canSkip = t > CLEAR_MIN_SKIP && this.input &&
      (this.input.jumpPressed || this.input.interactPressed);
    if (canSkip || t >= CLEAR_AUTO_MS) this._advanceAfterClear();
  }

  _advanceAfterClear() {
    if (this._clearT < 0) return;
    this._endClear(false);
    const last = this._clearSummary && this._clearSummary.isLastOfWorld;
    if (last) this.returnToHub(true);
    else this.nextStage();
  }

  _endClear(silent) {
    if (this._clearT < 0 && !silent) return;
    this._clearT = -1;
    this._finishT = -1;
    this.timeScale = 1;
    this._fovPull = 0;
    this._hideCont();
    if (this.engine && this.engine.post && this.theme && this.theme.bloom) {
      safe(() => this.engine.post.setBloom(this.theme.bloom), 'post.setBloom');
    }
  }

  /* ======================================================================
   * Flow
   * ====================================================================*/
  async nextStage() {
    const w = this.world;
    if (!w || !w.stages) return this.returnToHub();
    const i = w.stages.indexOf(this.stageId);
    if (i >= 0 && i < w.stages.length - 1) return this.loadStage(w.stages[i + 1]);
    return this.returnToHub(true);
  }

  async returnToHub(worldCleared) {
    this._endClear(true);
    this._cancelDeath();
    const r = await this.loadStage(HUB_ID);
    if (worldCleared && this.hud && typeof this.hud.toast === 'function') {
      const name = (this._clearSummary && this._clearSummary.worldName) || 'WORLD';
      safe(() => this.hud.toast(name + ' CLEARED', 'A new gate is open', 'success'), 'hud.toast');
    }
    return r;
  }

  /**
   * A restart is a respawn with a full stage rewind — the rewind is deferred to
   * the black frame in _performRespawn so the player never sees the stage pop
   * back to its start state mid-fade.
   */
  restartStage() {
    if (!this.stage || this._loading) return;
    if (!this._cooldown('restart')) return;
    this._cancelDeath();
    this._endClear(true);
    this._endIntro(true);
    this._pendingFullReset = true;
    this._beginRespawn(false, 'restart');
    safe(() => this.hud && this.hud.toast('STAGE RESTARTED', '', 'info'), 'hud.toast');
  }

  /**
   * Dev-only forward skip (exposed as __dev.skipCP / __dev.skipToCheckpoint,
   * never as a public method — in release there is no way to reach it).
   * Rewinds the stage clock to the target checkpoint so hazards present the
   * same phase they would on a normal arrival.
   */
  _skipToCheckpoint(index) {
    if (!this.stage) return -1;
    const cps = this.stage.checkpoints || EMPTY_ARRAY;
    if (!cps.length) return -1;
    const next = clamp(isNum(index) ? index | 0 : this.cpIndex + 1, 0, cps.length - 1);
    if (next > this.cpIndex) this.onCheckpoint(next);
    else this.cpIndex = next;
    safe(() => this.stage.resetFrom(this.cpIndex), 'stage.resetFrom');
    const sp = this._spawnFor(this.cpIndex);
    if (this.player) {
      safe(() => this.player.respawn(sp.pos, sp.yaw), 'player.respawn');
      this._ncPos.copy(this.player.pos);
    }
    return this.cpIndex;
  }

  /** Runs inside the black frame only. */
  _fullStageReset() {
    this._pendingFullReset = false;
    if (!this.stage) return;
    this.cpIndex = 0;
    this.timeMs = 0;
    this.stageDeaths = 0;
    this.coins = 0;
    for (let i = 0; i < this._coinTaken.length; i++) this._coinTaken[i] = false;
    for (let i = 0; i < this._cpRecorded.length; i++) {
      this._cpRecorded[i] = undefined;
      const cp = this.stage.checkpoints && this.stage.checkpoints[i];
      if (cp) cp.clockOffset = this._cpAuthored[i];
    }
    safe(() => this.stage.reset(), 'stage.reset');
    this._restoreCoinMeshes();
  }

  restartRun() {
    this.deaths = 0;
    this.totalMs = 0;
    this.timeMs = 0;
    this.coins = 0;
    this._clearSummary = null;
    this._cancelDeath();
    this._endClear(true);
    return this.returnToHub();
  }

  _restoreCoinMeshes() {
    const coins = (this.stage && this.stage.coins) || EMPTY_ARRAY;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!c) continue;
      if (typeof c.restore === 'function') { safe(() => c.restore(), 'coin.restore'); continue; }
      const m = c.mesh || c.obj || c.node || (c.isObject3D ? c : null);
      if (m) m.visible = true;
      c.collected = false;
    }
  }

  _cooldown(key) {
    const t = nowMs();
    if (this._lastAction[key] && t - this._lastAction[key] < ACTION_COOLDOWN) return false;
    this._lastAction[key] = t;
    return true;
  }

  /* ======================================================================
   * Hub portals
   * ====================================================================*/
  _resolvePortals(def, stage) {
    const list = [];
    const push = (worldId, pos, yaw, label) => {
      const w = this._worldById(worldId);
      if (!w) return;
      list.push({
        world: w,
        worldId: w.id,
        label: label || w.name || w.id,
        pos: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z),
        yaw: yaw || 0,
      });
    };

    /* 1. authored: def.portals = [{world, p, yaw, label}] */
    const src = (stage && stage.portals) || def.portals;
    if (Array.isArray(src) && src.length) {
      for (let i = 0; i < src.length; i++) {
        const pt = src[i];
        if (!pt) continue;
        toVec3(pt, _v1);
        push(pt.world || pt.worldId || pt.to || pt.id, _v1, yawOf(pt, 0), pt.label || pt.name);
      }
      if (list.length) return list;
    }

    /* 2. derived: objects tagged as portals in the hub definition */
    const objs = def.objects;
    if (Array.isArray(objs)) {
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (!o) continue;
        const wid = o.portal || o.world || (o.kindOf === 'portal' ? o.target : null);
        const isPortal = o.portal !== undefined || o.kindOf === 'portal' || o.kind === 'portal';
        if (!isPortal || !wid) continue;
        toVec3(o, _v1);
        push(wid, _v1, yawOf(o, 0), o.label);
      }
      if (list.length) return list;
    }

    /* 3. fallback: an even arc of gates in front of the hub spawn, so a hub
          definition without explicit portal metadata is still fully playable. */
    const sp = def.spawn || { p: [0, 2, 0], yaw: 0 };
    toVec3(sp, _v2);
    const baseYaw = yawOf(sp, 0);
    const worlds = WORLDS || EMPTY_ARRAY;
    if (!worlds.length) return list;
    const n = worlds.length;
    const spread = 1.15;                                 // radians, total arc
    for (let i = 0; i < n; i++) {
      const a = baseYaw + (n === 1 ? 0 : (-spread / 2 + (spread * i) / (n - 1)));
      _v1.set(_v2.x - Math.sin(a) * 12, _v2.y, _v2.z - Math.cos(a) * 12);
      push(worlds[i].id, _v1, a + Math.PI, worlds[i].name);
    }
    return list;
  }

  _worldById(id) {
    if (!id || !WORLDS) return null;
    for (let i = 0; i < WORLDS.length; i++) if (WORLDS[i] && WORLDS[i].id === id) return WORLDS[i];
    return null;
  }

  _portalLocked(worldId) {
    const unlocked = safe(() => this.save.unlockedWorlds(), 'save.unlockedWorlds');
    if (!Array.isArray(unlocked)) return null;             // no gating available
    if (unlocked.indexOf(worldId) !== -1) return null;
    const idx = WORLDS ? WORLDS.findIndex((w) => w && w.id === worldId) : -1;
    const prev = idx > 0 ? WORLDS[idx - 1] : null;
    return prev ? 'CLEAR ' + (prev.name || prev.id).toUpperCase() + ' TO OPEN' : 'LOCKED';
  }

  _firstUnclearedStage(world) {
    if (!world || !world.stages || !world.stages.length) return null;
    for (let i = 0; i < world.stages.length; i++) {
      const rec = safe(() => this.save.stage(world.stages[i]), 'save.stage');
      if (!rec || !rec.cleared) return world.stages[i];
    }
    return world.stages[0];
  }

  /**
   * Lock state and target stage are resolved ONCE per hub load — they can only
   * change by clearing a stage, which happens outside the hub.  _updatePortals
   * then runs every frame reading nothing but cached numbers.
   */
  _refreshPortalState() {
    for (let i = 0; i < this._portals.length; i++) {
      const pt = this._portals[i];
      pt.lockReason = this._portalLocked(pt.worldId);
      pt.target = pt.lockReason ? null : this._firstUnclearedStage(pt.world);
      let sub = 'ENTER';
      if (pt.target) {
        const rec = safe(() => this.save.stage(pt.target), 'save.stage');
        if (rec && isNum(rec.best)) sub = 'BEST ' + fmtTime(rec.best / 1000);
        else if (rec && rec.cleared) sub = 'CLEARED';
        const w = pt.world;
        if (w && w.stages) {
          const n = w.stages.indexOf(pt.target) + 1;
          if (n > 0) sub = 'STAGE ' + n + ' / ' + w.stages.length + '   ' + sub;
        }
      }
      pt.sub = pt.lockReason || sub;
    }
  }

  _updatePortals(dt) {
    if (this.state !== 'hub' || !this.player || this._loading || this._deathT >= 0) {
      if (this._portalNear !== -1) { this._portalNear = -1; this._setPrompt('', ''); }
      return;
    }
    const pp = this.player.pos;
    let near = -1;
    let bestD = PORTAL_PROMPT_R * PORTAL_PROMPT_R;
    for (let i = 0; i < this._portals.length; i++) {
      const pt = this._portals[i];
      const dy = pp.y - pt.pos.y;
      if (dy > 6 || dy < -4) continue;
      const dx = pp.x - pt.pos.x, dz = pp.z - pt.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; near = i; }
    }

    if (near !== this._portalNear) {
      this._portalNear = near;
      this._portalDwell = 0;
      if (near === -1) this._setPrompt('', '');
    }
    if (near === -1) return;

    const pt = this._portals[near];
    this._setPrompt(pt.label, pt.sub, !!pt.lockReason);
    if (pt.lockReason || !pt.target) { this._portalDwell = 0; return; }

    const inside = bestD <= PORTAL_ENTER_R * PORTAL_ENTER_R;
    this._portalDwell = inside ? this._portalDwell + dt : 0;
    const pressed = this.input && this.input.interactPressed;
    if (pressed || this._portalDwell >= PORTAL_ENTER_DWELL) {
      this._portalDwell = 0;
      this._setPrompt('', '');
      safe(() => this.audio && this.audio.sfx('ui_ok'), 'audio.sfx');
      this.loadStage(pt.target, { fromHub: true }).catch(() => {});
    }
  }

  /* ======================================================================
   * Death safety net
   *
   * There is NO trigger detection here. Checkpoints, orbs and the gate are
   * detected once, by the Stage, against the player's feet, and arrive as
   * stage.events -> onCheckpoint / onCoin / onFinish (see _bindStageEvents).
   * A second detector here is what made every one of them fire twice — two
   * radii, two height windows, two save writes, two bursts.
   *
   * What is left is the part only Game can do: notice a death the player did
   * not announce.
   * ====================================================================*/
  _checkDeath() {
    const st = this.stage;
    if (!st || !this.player || this._deathT >= 0) return;
    const live = this.state === 'playing' || this.state === 'hub';
    if (!live) return;
    const pp = this.player.pos;

    /* Void safety net: the stage owns killY, the player only owns kill volumes. */
    const killY = this.physWorld.killY;
    if (pp.y < killY && !this.player.dead) {
      if (typeof this.player.kill === 'function') {
        try { this.player.kill('void'); } catch (e) { this.onDeath('void'); }
      } else this.onDeath('void');
    }

    /* The player may set `dead` without an event reaching us.  Read it as a
       RISING EDGE only: a `dead` flag the player never clears would otherwise
       re-trigger the sequence forever, one death per frame. */
    const dead = !!this.player.dead;
    if (dead && !this._prevPlayerDead && this._deathT < 0) {
      this.onDeath(this.player.deathCause || 'void');
    }
    this._prevPlayerDead = dead;
  }

  /* ======================================================================
   * Per-frame
   * ====================================================================*/

  /**
   * Contract §21 fixes this order and it is not negotiable:
   *   input   — the frame's intent must exist before anything consumes it.
   *   stage   — hazards advance the stage clock FIRST so the player collides
   *             against where the movers ARE this frame, not where they were
   *             last frame (the difference is a one-frame carry error, which is
   *             exactly the "the platform ate me" bug).
   *   player  — movement + collision + hazards, reading the settled world.
   *   camera  — the rig follows a position that is already final, so there is
   *             no sub-frame lag between the eye and the body.
   *   viewmodel — hangs off the camera; it must read the camera's final basis.
   *   fx      — particles emitted by this frame's events are simulated once,
   *             in the same frame they were spawned.
   *   hud     — reads a fully settled snapshot; never a half-updated one.
   *   render  — last, so the frame that reaches the screen is internally
   *             consistent from input to pixels.
   */
  update(dt) {
    if (this._destroyed) return;
    try {
      this._update(dt);
      this._errStreak = 0;
    } catch (err) {
      this._errStreak = (this._errStreak || 0) + 1;
      if (this._errStreak === 1 || this._errStreak % 120 === 0) {
        if (typeof console !== 'undefined') console.error('[ascendant] frame error', err);
      }
      /* A loop that cannot complete a frame is dead — hand it to boot.js so the
         player gets a readable failure card instead of a frozen picture. */
      if (this._errStreak === 90 && typeof this.onFatal === 'function') {
        safe(() => this.onFatal(err), 'onFatal');
      }
    }
  }

  _update(dt) {
    const rdt = isNum(dt) && dt > 0 ? Math.min(dt, 1 / 20) : 1 / 60;
    const rms = rdt * 1000;

    /* --- real-time sequences (never scaled by slow-mo) --- */
    if (this._deathT >= 0) this._stepDeath(rms);
    if (this._introT >= 0) this._stepIntro(rms);
    if (this._clearT >= 0) this._stepClear(rms);
    if (this._fadeDur > 0) this._stepFade(rms);

    const live = this.state === 'playing' || this.state === 'hub';
    const simulating = live || this.state === 'dead' || this.state === 'cleared' || this.state === 'title';
    /* 'title' still simulates: the menu sits over a living world, not a photo.
       Only an actual menu state stops the clock. */
    const simBlocked = this.state === 'paused' || this.state === 'select' || this._selectOpen;
    const menuOpen = simBlocked || this.state === 'title' || !!(this.menu && this.menu.isOpen);
    const sdt = simulating && !simBlocked ? Math.min(rdt * this.timeScale, 1 / 20) : 0;

    /* --- timers: gameplay only --- */
    if (this._timerRun && live && !menuOpen && this._deathT < 0) {
      if (this.stageId !== HUB_ID) this.timeMs += rms;
      this.totalMs += rms;
    }

    /* --- pointer lock re-acquisition after a menu / ESC --- */
    if (this._relockAt && nowMs() >= this._relockAt && this.input) {
      this._relockAt = 0;
      if ((live || this._introT >= 0) && !this.input.locked) {
        try { this.input.requestLock(); } catch (e) { /* browser cooldown */ }
      }
    }

    /* ================= the mandated order ================= */
    if (this.input) this.input.update(rdt);
    this._readInputActions();

    const frozen = this._deathT >= 0 || this._introT >= 0 || this._clearT >= 0 || !simulating || simBlocked;

    if (this.stage) {
      if (this.freezeHazards) this.stage.update(0);
      else if (simulating && !simBlocked) this.stage.update(sdt);
    }

    if (this.player && !frozen) this.player.update(sdt);
    if (this.noclip && this.player) this._stepNoclip(rdt);

    if (this.camera) this.camera.update(sdt);
    this._postCameraOverrides(rdt);

    if (this.viewmodel) this.viewmodel.update(sdt, this.player);
    /* REAL dt (contract §19): Impacts' cooldowns and its death machine are wall
       clocks, not gameplay clocks. Without this tick every throttle in it latches
       after the first use — the second landing produces no dip, no dust, no thump. */
    if (this.impacts && typeof this.impacts.update === 'function') this.impacts.update(rdt);
    if (this.decals) this.decals.update(rdt);
    if (this.fx) this.fx.update(sdt);

    /* Game logic sits between fx and hud: the HUD must see this frame's
       checkpoint / coin / finish, not the previous frame's. The stage already
       raised them from stage.update() above; this is only the death net. */
    if (!frozen) this._checkDeath();
    this._updatePortals(rdt);
    this._updateResumePrompt();

    if (this.hud) this.hud.update(rdt, this._snapshot());
    if (this.dev) this._updateDev(rms);

    this.engine.render(rdt);
    this.frames++;                 // only a COMPLETED frame counts (boot watchdog)
  }

  /** Global actions read straight off the Input edge flags (no key listeners). */
  _readInputActions() {
    const inp = this.input;
    if (!inp) return;
    if (inp.stageSelectPressed) this.toggleStageSelect();
    if (this._isLive()) {
      if (inp.restartPressed) this.restartStage();
      if (inp.respawnPressed) this.respawn();
    }
    if (this.dev && inp.devPressed) this._toggleDevPanel();
  }

  _menuOpen() {
    if (this.state === 'paused' || this.state === 'title' || this.state === 'select') return true;
    if (this.menu && this.menu.isOpen) return true;
    if (this._selectOpen) return true;
    return false;
  }

  _isLive() { return this.state === 'playing' || this.state === 'hub'; }

  /**
   * Composed on top of FPCamera rather than replacing it: the title drift and
   * the finish FOV pull are ADDITIVE offsets.
   *
   * FPCamera rewrites the transform every frame, but this must not depend on
   * that.  So each frame we compare what we left behind last frame with what is
   * there now: identical means FPCamera did not rewrite it, and we restore our
   * own base before re-applying — which makes the offset absolute instead of
   * accumulating into a runaway spin/zoom.
   */
  _postCameraOverrides(rdt) {
    const cam = this.engine && this.engine.camera;
    if (!cam) return;

    let dFov = 0, drift = false;
    if (this.state === 'title') {
      this._titleT += rdt;
      drift = true;
      dFov = Math.sin(this._titleT * 0.23) * 1.1;
    } else if (this._fovPull) {
      dFov = this._fovPull;
    }

    /* --- rotation --- */
    if (drift) {
      if (this._quatLeft && cam.quaternion.equals(this._quatLeft)) cam.quaternion.copy(this._quatBase);
      if (!this._quatBase) { this._quatBase = cam.quaternion.clone(); this._quatLeft = cam.quaternion.clone(); }
      else this._quatBase.copy(cam.quaternion);
      const t = this._titleT;
      cam.rotateY(Math.sin(t * 0.17) * 0.055);
      cam.rotateX(Math.sin(t * 0.11 + 1.3) * 0.018);
      this._quatLeft.copy(cam.quaternion);
    } else if (this._quatLeft) {
      if (cam.quaternion.equals(this._quatLeft)) cam.quaternion.copy(this._quatBase);
      this._quatLeft = null;
      this._quatBase = null;
    }

    /* --- fov --- */
    if (dFov !== 0) {
      if (this._fovLeft !== undefined && cam.fov === this._fovLeft) cam.fov = this._fovBase;
      this._fovBase = cam.fov;
      cam.fov = this._fovBase + dFov;
      cam.updateProjectionMatrix();
      this._fovLeft = cam.fov;
    } else if (this._fovLeft !== undefined) {
      if (cam.fov === this._fovLeft) { cam.fov = this._fovBase; cam.updateProjectionMatrix(); }
      this._fovLeft = undefined;
      this._fovBase = undefined;
    }
  }

  /* ======================================================================
   * HUD snapshot (reused object — zero allocation per frame)
   * ====================================================================*/
  _snapshot() {
    const s = this._snap;
    const st = this.stage;
    const def = (st && st.def) || null;
    const w = this.world;
    const isHub = this.stageId === HUB_ID;

    s.state = this.state;
    s.isHub = isHub;
    s.stageName = isHub ? 'THE SANCTUM' : (def && def.name) || String(this.stageId || '').toUpperCase();
    s.worldName = isHub ? 'HUB' : (w && w.name) || (def && def.world ? String(def.world).toUpperCase() : '');
    s.stageIdx = w ? w.stages.indexOf(this.stageId) + 1 : 0;
    s.stageCount = w ? w.stages.length : 0;
    s.timeMs = this.timeMs;
    s.totalMs = this.totalMs;
    s.deaths = this.deaths;
    s.cpIndex = this.cpIndex;
    s.cpCount = st && st.checkpoints ? Math.max(0, st.checkpoints.length - 1) : 0;
    s.coins = this.coins;
    s.coinTotal = st && st.coins ? st.coins.length : 0;
    s.par = def && isNum(def.par) ? def.par : 0;
    s.difficulty = def && isNum(def.difficulty) ? def.difficulty : 1;
    s.pointerLocked = !!(this.input && this.input.locked);

    s.best = isHub ? null : this._bestMs;      // cached at load, refreshed on finish

    let prog = -1;
    if (st && this.player && typeof st.progress === 'function') {
      try {
        const p = st.progress(this.player.pos);
        if (isNum(p)) prog = clamp(p, 0, 1);
      } catch (e) { prog = -1; }
    }
    if (prog < 0) prog = s.cpCount > 0 ? clamp(this.cpIndex / s.cpCount, 0, 1) : 0;
    s.progress01 = prog;

    if (this.player && this.player.vel) {
      const v = this.player.vel;
      s.speed = Math.sqrt(v.x * v.x + v.z * v.z);
    } else s.speed = 0;

    return s;
  }

  /* ======================================================================
   * Fade veil
   * ====================================================================*/
  _setFadeColor(css) {
    if (this._fadeColor === css) return;
    this._fadeColor = css;
    if (this.el && this.el.fade) this.el.fade.style.background = css;
  }

  _setFade(a) {
    const v = clamp(a, 0, 1);
    if (Math.abs(v - this._fadeA) < 0.002 && v !== 0 && v !== 1) return;
    this._fadeA = v;
    if (this.el && this.el.fade) {
      this.el.fade.style.opacity = String(v);
      this.el.fade.style.display = v <= 0.001 ? 'none' : 'block';
    }
  }

  _stepFade(ms) {
    if (this._fadeDur <= 0) return;
    this._fadeT += ms;
    const k = clamp(this._fadeT / this._fadeDur, 0, 1);
    this._setFade(lerp(this._fadeFrom, this._fadeTo, easeOutCubic(k)));
    if (k >= 1) {
      this._fadeDur = 0;
      this._setFade(this._fadeTo);
      if (this._fadeResolve) { const r = this._fadeResolve; this._fadeResolve = null; r(); }
    }
  }

  _tweenFade(to, ms) {
    if (this._fadeResolve) { const r = this._fadeResolve; this._fadeResolve = null; r(); }
    this._fadeFrom = this._fadeA;
    this._fadeTo = clamp(to, 0, 1);
    this._fadeT = 0;
    this._fadeDur = Math.max(1, ms | 0);
    if (this._fadeTo > 0 && this.el && this.el.fade) this.el.fade.style.display = 'block';
    return new Promise((res) => {
      this._fadeResolve = res;
      /* The rAF loop is not running during boot — resolve on a timer too. */
      setTimeout(() => {
        if (this._fadeResolve === res) {
          this._fadeResolve = null;
          this._fadeDur = 0;
          this._setFade(this._fadeTo);
          res();
        }
      }, this._fadeDur + 60);
    });
  }

  /** Stops an in-flight tween without touching the current alpha. */
  _killFadeTween() {
    this._fadeDur = 0;
    if (this._fadeResolve) { const r = this._fadeResolve; this._fadeResolve = null; r(); }
  }

  _fadeOut(ms) { return this._tweenFade(1, ms); }
  _fadeIn(ms) { return this._tweenFade(0, ms); }

  /* ======================================================================
   * Prompt / continue hint
   * ====================================================================*/
  /* Compares by identity, not by a concatenated key: this runs every frame and
     must not allocate. */
  _setPrompt(text, sub, locked) {
    const t = text || '';
    const s = sub || '';
    const l = !!locked;
    if (this._pT === t && this._pS === s && this._pL === l) return;
    this._pT = t; this._pS = s; this._pL = l;
    const el = this.el.prompt;
    if (!t) { el.classList.remove('show'); return; }
    this.el.promptText.textContent = t;
    this.el.promptSub.textContent = s;
    el.classList.toggle('locked', l);
    this.el.promptKey.style.display = l ? 'none' : '';
    el.classList.add('show');
  }

  _updateResumePrompt() {
    if (this.state !== 'playing' && this.state !== 'hub') return;
    if (this._portalNear !== -1) return;
    const inp = this.input;
    const wantResume = !!inp && !inp.locked && !inp.hasTouch && this._deathT < 0 && this._introT < 0;
    if (wantResume) this._setPrompt(RESUME_PROMPT, RESUME_SUB, true);
    else if (this._pT === RESUME_PROMPT) this._setPrompt('', '');
  }

  _showCont(text) {
    this.el.contText.textContent = text;
    this.el.cont.classList.add('show');
  }
  _hideCont() { this.el.cont.classList.remove('show'); }

  /* ======================================================================
   * Dev tools — ?dev=1 only.  In release `__dev` is never defined.
   * ====================================================================*/
  _installDev() {
    this.dev = true;
    this.el.dev.classList.add('show');

    const g = this;
    this.__dev = {
      /* contract §21 */
      skipCP() { return g._skipToCheckpoint(); },
      skipToCheckpoint(i) { return g._skipToCheckpoint(i); },
      noclip(on) {
        g.noclip = on === undefined ? !g.noclip : !!on;
        if (g.noclip && g.player) g._ncPos.copy(g.player.pos);
        if (!g.noclip && g.player && g.player.__test) g.player.__test.setVel(_v1.set(0, 0, 0));
        return g.noclip;
      },
      goto(stageId) { return g.loadStage(String(stageId)); },
      tp(x, y, z) {
        if (!g.player) return null;
        _v1.set(+x || 0, +y || 0, +z || 0);
        if (g.player.__test) g.player.__test.teleport(_v1);
        else g.player.respawn(_v1, g.player.yaw || 0);
        g._ncPos.copy(_v1);
        return g.player.pos;
      },
      freezeHazards(on) {
        g.freezeHazards = on === undefined ? !g.freezeHazards : !!on;
        return g.freezeHazards;
      },
      showColliders(on) {
        const want = on === undefined ? !g._showColliders : !!on;
        g._showColliders = want;
        if (!want) g._clearColliderDebug();
        else g._colliderT = 1e9;                 // force a rebuild next frame
        return want;
      },
      /* extras */
      state() { return g._snapshot(); },
      panel(on) { g._toggleDevPanel(on); },
      setClock(t) { if (g.stage) g.stage.clock = +t || 0; return g.stage ? g.stage.clock : 0; },
      restart() { g.restartStage(); },
      finish() { g.onFinish(); },
      kill(cause) { g.onDeath(cause || 'manual'); },
      worlds() { return WORLDS; },
      game: g,
    };
  }

  _toggleDevPanel(on) {
    if (!this.dev) return;
    const want = on === undefined ? !this.el.dev.classList.contains('show') : !!on;
    this.el.dev.classList.toggle('show', want);
  }

  _updateDev(ms) {
    if (this._showColliders) {
      this._colliderT += ms;
      if (this._colliderT >= 300) { this._colliderT = 0; this._rebuildColliderDebug(); }
    }
    this._devAccum += ms;
    if (this._devAccum < 180) return;
    this._devAccum = 0;
    if (!this.el.dev.classList.contains('show')) return;

    const p = this.player;
    const st = this.engine && this.engine.stats ? this.engine.stats : null;
    const pos = p && p.pos ? p.pos : _v1.set(0, 0, 0);
    const vel = p && p.vel ? p.vel : _v2.set(0, 0, 0);
    const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    const surf = (p && (p.surface || (p.result && p.result.surface))) || 'normal';

    this.el.dev.textContent =
      'state    ' + this.state + (this.noclip ? '  [NOCLIP]' : '') + (this.freezeHazards ? '  [FROZEN]' : '') + '\n' +
      'stage    ' + (this.stageId || '-') + '   cp ' + this.cpIndex + '\n' +
      'clock    ' + (this.stage && isNum(this.stage.clock) ? this.stage.clock.toFixed(2) : '-') + ' s\n' +
      'pos      ' + pos.x.toFixed(2) + ', ' + pos.y.toFixed(2) + ', ' + pos.z.toFixed(2) + '\n' +
      'vel      ' + vel.x.toFixed(2) + ', ' + vel.y.toFixed(2) + ', ' + vel.z.toFixed(2) + '\n' +
      'speed    ' + hs.toFixed(2) + ' m/s   air ' + (p && isNum(p.stats && p.stats.airTime) ? p.stats.airTime.toFixed(2) : '0.00') + '\n' +
      'grounded ' + (p ? !!p.grounded : false) + '   wall ' + (p ? !!p.wallSliding : false) + '\n' +
      'surface  ' + surf + '\n' +
      'time     ' + fmtTime(this.timeMs / 1000) + '   deaths ' + this.deaths + '\n' +
      'fps      ' + (st && isNum(st.fps) ? st.fps.toFixed(0) : '-') +
        '   draws ' + (st && isNum(st.drawCalls) ? st.drawCalls : '-') +
        '   tris ' + (st && isNum(st.tris) ? st.tris : '-');
  }

  _rebuildColliderDebug() {
    this._clearColliderDebug();
    const st = this.stage;
    if (!st || !this.engine || !this.engine.scene) return;
    const group = new THREE.Group();
    group.name = 'asc-collider-debug';
    group.renderOrder = 999;

    const list = [];
    const bounds = st.bounds || _box.set(_v1.set(-200, -100, -200), _v2.set(400, 300, 200));
    if (st.broadphase && typeof st.broadphase.query === 'function') {
      safe(() => st.broadphase.query(bounds, list), 'broadphase.query');
    }
    const solid = new THREE.Color(0x37e0a0);
    for (let i = 0; i < list.length && i < 1200; i++) {
      const c = list[i];
      if (!c || !c.aabb) continue;
      const h = new THREE.Box3Helper(c.aabb, c.active === false ? 0x555555 : solid.getHex());
      h.material.depthTest = false;
      h.material.transparent = true;
      h.material.opacity = 0.65;
      group.add(h);
    }
    const kills = st.killVolumes || EMPTY_ARRAY;
    for (let i = 0; i < kills.length && i < 600; i++) {
      const k = kills[i];
      if (!k) continue;
      let bb = k.aabb || k.box || null;
      if (!bb && k.center && k.half) {
        toVec3(k.center, _v3);
        toVec3(k.half, _v4);
        bb = new THREE.Box3(_v3.clone().sub(_v4), _v3.clone().add(_v4));
      }
      if (!bb || !bb.isBox3) continue;
      const h = new THREE.Box3Helper(bb, 0xff3a2a);
      h.material.depthTest = false;
      h.material.transparent = true;
      h.material.opacity = 0.8;
      group.add(h);
    }
    this._colliderGroup = group;
    this.engine.scene.add(group);
  }

  _clearColliderDebug() {
    const g = this._colliderGroup;
    if (!g) return;
    this._colliderGroup = null;
    if (g.parent) g.parent.remove(g);
    g.traverse((o) => {
      if (o.geometry) safe(() => o.geometry.dispose(), 'geo.dispose');
      if (o.material) safe(() => o.material.dispose(), 'mat.dispose');
    });
  }

  /* ======================================================================
   * Dev noclip — a free-fly that keeps the player entity authoritative so the
   * camera, viewmodel and HUD all keep working unchanged.
   * ====================================================================*/
  _stepNoclip(dt) {
    const cam = this.engine.camera;
    const p = this.player;
    if (!cam || !p) return;
    const inp = this.input;
    const speed = (inp && inp.sprint ? NOCLIP_FAST : NOCLIP_SPEED) * dt;

    cam.getWorldDirection(_v1);                 // convention-free forward
    _v1.normalize();
    _v2.set(0, 1, 0).cross(_v1).normalize().multiplyScalar(-1);   // right

    _v3.set(0, 0, 0);
    if (inp) {
      _v3.addScaledVector(_v1, inp.move.y);
      _v3.addScaledVector(_v2, inp.move.x);
      if (inp.jump) _v3.y += 1;
      if (inp.crouch) _v3.y -= 1;
    }
    if (_v3.lengthSq() > 1e-6) _v3.normalize().multiplyScalar(speed);
    this._ncPos.add(_v3);

    if (p.__test && typeof p.__test.teleport === 'function') {
      safe(() => p.__test.teleport(this._ncPos), 'player.teleport');
      if (typeof p.__test.setVel === 'function') safe(() => p.__test.setVel(_v4.set(0, 0, 0)), 'player.setVel');
    } else if (p.pos) {
      p.pos.copy(this._ncPos);
      if (p.vel) p.vel.set(0, 0, 0);
    }
    if ('grounded' in p) p.grounded = true;      // suppress fall/land reactions
  }

  /* ======================================================================
   * Teardown
   * ====================================================================*/
  dispose() {
    this._destroyed = true;
    if (typeof window !== 'undefined') {
      if (this._onWinBlur) window.removeEventListener('blur', this._onWinBlur);
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
      if (window.__PAUSE__ && window.__PAUSE__.isPaused) delete window.__PAUSE__;
    }
    if (this.settings && this._settingsSub && typeof this.settings.off === 'function') {
      safe(() => this.settings.off(this._settingsSub), 'settings.off');
    }
    this._clearColliderDebug();
    this._disposeStage();
    safe(() => this.audio && this.audio.stopAll(), 'audio.stopAll');
    safe(() => this.fx && this.fx.dispose(), 'fx.dispose');
    const ids = ['asc-fade', 'asc-intro', 'asc-prompt', 'asc-cont', 'asc-dev'];
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
}

/* ==========================================================================
 * Overlay styling — Game-owned chrome only.  The HUD ships its own art.
 * ========================================================================*/
const GAME_CSS = `
:root{
  --asc-accent:#5ec8ff; --asc-accent-dim:#2b6f96; --asc-kill:#ff5a3c; --asc-bg:#05070d;
  --asc-ui-font:'Segoe UI Variable Display','Segoe UI',Inter,system-ui,-apple-system,sans-serif;
  --asc-mono:ui-monospace,'Cascadia Mono',Consolas,'SF Mono',monospace;
}
#asc-fade{position:absolute;inset:0;background:#05070d;opacity:0;display:none;
  pointer-events:none;z-index:1;will-change:opacity}

#asc-intro{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;
  justify-content:center;pointer-events:none;z-index:2;opacity:0;transition:opacity .28s ease}
#asc-intro.show{opacity:1}
#asc-intro .asc-intro-inner{transform:translateY(-11vh) scale(.985);opacity:0;
  transition:transform .55s cubic-bezier(.16,.9,.3,1),opacity .45s ease;text-align:center;
  padding:26px 54px;position:relative}
#asc-intro.show .asc-intro-inner{transform:translateY(-11vh) scale(1);opacity:1}
#asc-intro .asc-intro-inner::before,#asc-intro .asc-intro-inner::after{content:'';position:absolute;
  left:12%;right:12%;height:1px;background:linear-gradient(90deg,transparent,var(--asc-accent),transparent);
  opacity:.55}
#asc-intro .asc-intro-inner::before{top:0}
#asc-intro .asc-intro-inner::after{bottom:0}
#asc-intro .asc-intro-world{font:600 11px/1 var(--asc-ui-font);letter-spacing:.44em;
  color:var(--asc-accent);text-transform:uppercase;margin-left:.44em;opacity:.9}
#asc-intro .asc-intro-name{margin-top:16px;font:200 clamp(34px,6.2vw,74px)/1.02 var(--asc-ui-font);
  letter-spacing:.14em;margin-left:.14em;text-transform:uppercase;
  background:linear-gradient(178deg,#ffffff 12%,#dbe9f6 46%,var(--asc-accent) 108%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 6px 26px rgba(0,0,0,.75))}
#asc-intro .asc-intro-sub{margin-top:10px;font:300 13px/1.5 var(--asc-ui-font);letter-spacing:.2em;
  color:#93aac4;text-transform:uppercase;margin-left:.2em}
#asc-intro .asc-intro-diff{margin-top:20px;display:flex;align-items:center;justify-content:center;gap:12px}
#asc-intro .asc-diff-label{font:600 9px/1 var(--asc-ui-font);letter-spacing:.36em;color:#5d7590}
#asc-intro .asc-pips{display:inline-flex;gap:4px}
#asc-intro .asc-pips u{width:13px;height:3px;border-radius:2px;background:#22303f;display:block;
  transition:background .2s}
#asc-intro .asc-pips u.on{background:var(--asc-accent);box-shadow:0 0 8px var(--asc-accent)}

#asc-prompt{position:absolute;left:0;right:0;bottom:16.5%;display:flex;flex-direction:column;
  align-items:center;gap:7px;pointer-events:none;z-index:2;opacity:0;
  transform:translateY(9px);transition:opacity .16s ease,transform .16s ease}
#asc-prompt.show{opacity:1;transform:translateY(0)}
#asc-prompt .asc-prompt-inner{display:flex;align-items:center;gap:11px;padding:9px 17px 9px 11px;
  border-radius:11px;background:linear-gradient(180deg,rgba(16,26,40,.82),rgba(8,13,21,.86));
  border:1px solid rgba(140,190,235,.20);
  box-shadow:0 10px 34px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.07);
  backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px)}
#asc-prompt .asc-key{font:700 12px/1 var(--asc-mono);color:#0a1017;background:var(--asc-accent);
  min-width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 2px 0 var(--asc-accent-dim),0 0 16px color-mix(in srgb,var(--asc-accent) 55%,transparent)}
#asc-prompt .asc-prompt-text{font:600 13px/1 var(--asc-ui-font);letter-spacing:.2em;color:#eaf3ff;
  text-transform:uppercase;margin-left:.2em}
#asc-prompt .asc-prompt-sub{font:500 10px/1 var(--asc-ui-font);letter-spacing:.3em;color:#7b93ad;
  text-transform:uppercase;margin-left:.3em}
#asc-prompt.locked .asc-prompt-inner{border-color:rgba(255,120,90,.28)}
#asc-prompt.locked .asc-prompt-text{color:#ffd6cb}
#asc-prompt.locked .asc-prompt-sub{color:var(--asc-kill)}

#asc-cont{position:absolute;left:0;right:0;bottom:9%;text-align:center;pointer-events:none;z-index:2;
  opacity:0;transition:opacity .35s ease}
#asc-cont.show{opacity:1;animation:asc-breathe 2.1s ease-in-out infinite}
#asc-cont span{font:600 11px/1 var(--asc-ui-font);letter-spacing:.42em;color:#9fb8d2;
  text-transform:uppercase;margin-left:.42em;text-shadow:0 2px 12px rgba(0,0,0,.8)}
@keyframes asc-breathe{0%,100%{opacity:.45}50%{opacity:1}}

#asc-dev{position:absolute;left:10px;top:10px;display:none;white-space:pre;pointer-events:none;z-index:3;
  font:500 11px/1.55 var(--asc-mono);color:#8fe8c4;padding:9px 13px;border-radius:8px;
  background:rgba(5,9,14,.72);border:1px solid rgba(80,220,170,.18);
  text-shadow:0 1px 2px rgba(0,0,0,.9);backdrop-filter:blur(4px)}
#asc-dev.show{display:block}

@media (prefers-reduced-motion:reduce){
  #asc-intro .asc-intro-inner{transition-duration:.01ms}
  #asc-cont.show{animation:none;opacity:1}
}
`;

export default Game;
