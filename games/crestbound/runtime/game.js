/* ============================================================================
 * CRESTBOUND — runtime/game.js
 * Contract §28. The state machine, the course lifecycle, the Keep and its gates,
 * the REWIND death loop, checkpoints, crests and the course-clear celebration,
 * pause policy, timers, power hats, the cannon reticle, Old Fen, and the dev tools.
 *
 * Ported from ASCENDANT runtime/game.js (same studio, first-person obby) and
 * extended for a third-person ANALOG platformer. What survives the port is the
 * hard-won lifecycle discipline; what changes is everything the contract changes
 * (no viewmodel, no pointer-lock-only input, the FollowCamera, the Hero, an open
 * hub with painting gates instead of a portal ring, crests instead of a finish gate).
 *
 * Ownership / integration notes
 * -----------------------------
 *  • Game owns NO rendering of world geometry. It owns state, timing, and a small
 *    set of full-screen DOM overlays that are NOT part of the HUD API (§27 gives
 *    HUD toast/crestGet/checkpointFlash/deathFlash/courseClear only):
 *      #cb-veil     the death / load veil — an IRIS (radial mask) or a fade
 *      #cb-prompt   the interact prompt (gates, Old Fen)
 *      #cb-cine     cinematic letterbox bars + caption (course intro, gate unlock)
 *      #cb-reticle  the cannon aim reticle — only when the HUD has no setReticle
 *      #cb-dev      the dev readout (?dev=1 only)
 *    They live in #ui, created in the CONSTRUCTOR so Menu/CourseCard (built after
 *    Game in boot.js) paint above them in DOM order.
 *  • Services are injected by boot.js through attach()/attachUI() rather than
 *    imported here, so boot.js remains the single place that constructs the
 *    engine-level singletons. Player / FollowCamera / Hero / Course ARE constructed
 *    here because their lifetime is the course lifetime.
 *  • Player, FollowCamera and Hero are built ONCE (first course load) and reused
 *    for every course — `physWorld` is a stable object with live getters, so
 *    rebinding a course never invalidates the references they captured.
 *  • Player ↔ camera dependency: Player wants `cameraRef.yaw` for camera-relative
 *    movement, FollowCamera wants the player. `_camRef` (live getters onto
 *    `this.cam`) breaks the cycle without a placeholder object.
 *
 * Lessons carried over verbatim (they cost real bugs in Ascendant)
 * ----------------------------------------------------------------
 *  • POINTER LOCK LOSS IS A PAUSE, NEVER A TOGGLE. 'pause' is the only toggle and
 *    only an explicit press raises it. Lock loss and focus loss may pause, never
 *    resume; the ESC that opens the menu also drops the lock, and if that second
 *    arrival were a toggle the menu would resume itself on a frame-rate-dependent
 *    race. Dev mode never pauses on lock loss (harnesses cannot hold lock).
 *  • `input.suspended` is DERIVED every frame from what is on screen
 *    (_uiOwnsInput), never accumulated by two writers.
 *  • Every authored sequence (death, intro, clear, gate-open) is frozen by a menu
 *    state and by nothing else; every exit from a sequence funnels through one
 *    _end* method so a card can never be left up over a live game.
 *  • A player's `dead` flag is read as a RISING EDGE (never re-trigger per frame).
 *  • Detection lives with the thing detected (checkpoints/gates: the course's own
 *    volumes; coins/sigils/crests: Collectibles); Game owns what they MEAN — save
 *    writes, HUD, audio, particles, camera, progression. Checkpoint arrival is
 *    IDEMPOTENT by index so an event and a volume test can never double-fire.
 *  • Deferred work is guarded by an epoch (`_epoch`) so a stale promise from a
 *    course that has since been left can never touch the next one (doctrine §4).
 *
 * Death → respawn (contract §28): measured MEDIAN ≤ 700 ms, ceiling 950 ms.
 *   0     .. 90    impact hold — Impacts.death() (flash, hit-stop, death cam)
 *   90    .. 310   REWIND — the hero's last 0.4 s (player.history ring) played
 *                  backward over 220 ms along the ring; desaturate ramps in
 *   310   .. 420   iris closes on the hero
 *   420            SWAP at full cover: course.resetFrom(cp), player.respawn,
 *                  cam.recenter, input restored  ← `lastRespawnMs` is stamped here
 *   420   .. 620   iris opens, desaturate releases; state returns to live at 620
 * Designed 620 total; the swap lands ~420-460 ms measured, well inside 700.
 * Never a course rebuild on respawn.
 * ==========================================================================*/

import * as THREE from 'three';

import { REALMS, COURSE_META, KEEP_ID, CREST_TOTAL, getCourse, realmOf, isCourseId, prefetchCourse } from './data/index.js';
import { Course } from './world/course.js';
import { THEMES, applyTheme } from './world/themes.js';
import { Player } from './player/controller.js';
import { FollowCamera } from './player/camera.js';
import { Hero } from './player/hero.js';
import { Save } from './core/save.js';
import { Settings } from './core/settings.js';
import { TUNE } from './core/tuning.js';
import { clamp, lerp, smoothstep, easeOutCubic, easeInOutCubic, fmtTime, nowMs, headingFromYaw } from './core/util.js';

/* ---------------------------------------------------------------------------
 * Timeline constants — cumulative boundaries so every sequence is a pure
 * function of elapsed real milliseconds (no per-phase timers to drift).
 * ------------------------------------------------------------------------ */
const D_HIT = 90;                         // 0   .. 90    impact hold (Impacts hit-stop)
const D_REWIND = 220;                     // 90  .. 310   rewind ghost
const D_COVER = 110;                      // 310 .. 420   iris close
const D_REVEAL = 200;                     // 420 .. 620   iris open
const T_REWIND_START = D_HIT;                              // 90
const T_REWIND_END = T_REWIND_START + D_REWIND;            // 310
const T_SWAP = T_REWIND_END + D_COVER;                     // 420  <- world swap
const T_DEATH_END = T_SWAP + D_REVEAL;                     // 620
const T_SOFT_START = T_REWIND_END - 20;   // manual "to checkpoint" skips hit + rewind
const HISTORY_SECONDS = 0.4;              // contract §11: history ring covers 0.4 s at 60 Hz

const CLEAR_ORBIT_MS = 2200;              // crest celebration orbit (contract §28)
const CLEAR_ORBIT_RADIUS = 4.6;
const CLEAR_ORBIT_KEYS = 9;
const CLEAR_ORBIT_LOOK_Y = 0.9;           // crest anchor: the burst point, lifted to eye level
const CLEAR_ORBIT_HERO_Y = 0.9;           // hero anchor: Nim's chest above his feet
const CLEAR_ORBIT_RISE = 1.4;             // lens above the frame centre at the first key
const CLEAR_ORBIT_SKIN = 0.42;            // lens clearance from the occluder it was staged off
const CLEAR_ORBIT_MIN_R = 1.90;           // never closer than this: below it the burst whites out
/* Staging ladder of lens HEIGHT offsets, tried nearest-first. Both signs are
   needed, for opposite reasons, and both were measured on verdant-1: a spire
   poking up between a high lens and a hero below it is cleared by DROPPING the
   lens; a tower pyramid roof standing beside the hero is cleared by RAISING it
   and looking down. Neither direction alone is enough. */
const CLEAR_ORBIT_DROPS = [0, 1.7, -0.9, 3.4, -1.8];
const CLEAR_ORBIT_PULL_PAD = 0.30;        // how far INSIDE the occluder the lens is parked
const CLEAR_ORBIT_PULL_ITERS = 3;         // re-probe after each pull-in: the next blocker may be nearer
const CLEAR_ORBIT_GAP_M = 3.0;            // occluded gap at which a blocked key scores zero
const CLEAR_ORBIT_PROBE_R = 13;           // metres of world worth collecting for the visual probe
const CLEAR_ORBIT_RAYS_MAX = 420;         // hard ray budget for one staging pass
/* Wall-clock budget for the whole staging pass. MEASURED: one visual ray over
   the ~23-mesh / 165k-triangle probe list costs 3.4 ms on this box (38 rays in
   131.3 ms), so this is a budget of roughly 55 rays - and it is a HARD cap, not
   a target: the pass runs on the frame the camera CUTS to the cinematic, which
   is the one frame in the shot where a stall cannot be seen. */
const CLEAR_ORBIT_MS_BUDGET = 300;
/* Score at which a key is GOOD ENOUGH to stop searching: the hero is visible.
   A clear pedestal on top of that is worth 0.1 more, but it is never worth
   another six raycasts to chase — this shot exists to show Nim. */
const CLEAR_ORBIT_ACCEPT = 0.9;
/* Subtrees a staging ray must never see: the collectible layer (the crest the
   orbit is ABOUT sits at the crest anchor, so its own gold and enamel blocked
   every ray out of that anchor and inverted the score) and the fx layer. */
const ORBIT_SKIP_NODES = ['collectibles', 'fx', 'particles', 'decals'];

const INTRO_MIN_SKIP = 400;               // ignore a skip in the first 400 ms
const INTRO_DEFAULT_MS = 5200;            // when the authored path carries no times
const CINE_FALLBACK_MS = 3200;

const GATE_OPEN_MS = 2600;                // gate unlock cinematic
const GATE_OPEN_BURST_AT = 1150;          // when the door bursts inside the cinematic
const GATE_PROMPT_R = 4.2;                // show the prompt
const GATE_ENTER_R = 1.45;                // walk-in radius (when the gate has no Volume)
const GATE_ENTER_DWELL = 0.16;            // seconds inside ENTER_R to trigger
const GATE_REARM_R = 2.6;                 // must leave this far before a cancelled gate re-arms
const FEN_TALK_R = 2.6;
const FEN_PROMPT_R = 4.5;

/** Coins that buy a crest — contract §0 names. The ONE coin denominator. */
const COINS_FOR_CREST = 100;

/** Largest single presentation step, ms — matches engine.MAX_PRESENT_DT. */
const MAX_PRESENT_MS = 1000;

const COURSE_TOAST_MS = 2600;
const ACTION_COOLDOWN = 380;              // ms — de-dupes key + event paths
const POWER_DEFAULT_S = 30;

/* Dev free-fly, anchored to the run speed so it stays proportionate if TUNE moves. */
const NOCLIP_SPEED = (TUNE && typeof TUNE.speedRun === 'number' ? TUNE.speedRun : 9) * 1.6;
const NOCLIP_FAST = NOCLIP_SPEED * 2.8;

/* Module-scope scratch — nothing in an update path allocates. */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _col = new THREE.Color();
const _box = new THREE.Box3();
const _rayHit = { t: 0, normal: new THREE.Vector3(), collider: null };
/* Crest-celebration orbit stager (see _buildOrbit) — sized once, never grown. */
const _orbLook = new THREE.Vector3();
const _orbCrest = new THREE.Vector3();
const _orbHero = new THREE.Vector3();
const _orbDir = new THREE.Vector3();
const _orbCand = new THREE.Vector3();
const _orbBest = new THREE.Vector3();
const _orbFrom = new THREE.Vector3();
const _orbSphere = new THREE.Sphere();
const _orbRay = new THREE.Raycaster();

/* ---------------------------------------------------------------------------
 * Small local helpers (private — util.js is the shared home for anything
 * another module would want).
 * ------------------------------------------------------------------------ */
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/** Accepts [x,y,z] | {x,y,z} | Vector3 | {p:...} | {pos:...} | {position:...} | {center:...}. */
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
  const fb = fallback || '#0b0a16';
  try {
    if (c === null || c === undefined) return fb;
    if (typeof c === 'number' && Number.isFinite(c)) return '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
    if (typeof c === 'string') return c;
    if (c.isColor) return '#' + c.getHexString();
    if (c.color !== undefined) return cssColor(c.color, fb);
  } catch (e) { /* fall through */ }
  return fb;
}

function shade(css, k) {
  try { _col.set(css); _col.multiplyScalar(k); return '#' + _col.getHexString(); } catch (e) { return css; }
}

/** Call `on`/`addEventListener`/`subscribe` — whichever the emitter exposes. */
function bindEvent(emitter, name, fn) {
  if (!emitter || typeof fn !== 'function') return false;
  try {
    if (typeof emitter.on === 'function') { emitter.on(name, fn); return true; }
    if (typeof emitter.addEventListener === 'function') { emitter.addEventListener(name, fn); return true; }
    if (typeof emitter.subscribe === 'function') { emitter.subscribe(name, fn); return true; }
  } catch (e) { /* emitter shape mismatch — fallbacks still cover us */ }
  return false;
}

function safe(fn, ctx) {
  try { return fn(); } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[crestbound] ' + (ctx || 'call') + ':', e);
    return undefined;
  }
}

/** Authored cinematic time: seconds when small, milliseconds when large. */
function toMs(t) {
  if (!isNum(t)) return 0;
  return t > 120 ? t : t * 1000;
}

/** A complete no-op spatial index — used only before the first course exists. */
const EMPTY_BROADPHASE = {
  add() {}, remove() {}, refresh() {}, addHeightfield() {}, heightfields: [], count: 0,
  query(aabb, out) { if (out) { out.length = 0; return out; } return []; },
  raycast() { return false; },
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
    this.container = container || (typeof document !== 'undefined' ? document.body : null);

    /* ---- contract §28 surface ---- */
    this.state = 'loading';           // loading|title|keep|playing|paused|dead|card|clear|cinematic
    this.course = null;               // Course instance
    this.player = null;               // Player
    this.hero = null;                 // Hero
    this.cam = null;                  // FollowCamera
    this.hud = null;
    this.menu = null;
    this.card = null;                 // CourseCard
    this.transitions = null;          // Transitions
    this.audio = null;
    this.fx = null;                   // ParticleSystem
    this.save = Save;
    this.input = null;
    this.courseId = null;
    this.realmId = null;
    this.timeMs = 0;                  // current course clock (gameplay only, never in the Keep)
    this.sessionMs = 0;               // whole-session clock (gameplay only)
    this.deaths = 0;                  // session deaths
    this.courseDeaths = 0;
    this.lastRespawnMs = -1;          // kill -> controls restored, measured with performance.now
    this.lastDeathTimeline = { hit: 0, rewind: 0, swap: 0, total: 0 };

    /* ---- injected by boot.js ---- */
    this.impacts = null;
    this.decals = null;
    this.mats = null;
    this.settings = Settings;
    this.quality = null;
    this.onProgress = null;           // (p01, message) => void, boot bar
    this.onFatal = null;              // (err) => void, unrecoverable loop
    this.dev = false;
    this.__dev = undefined;           // defined only with ?dev=1 (hard rule 9)

    /* ---- owned by Game ---- */
    this.def = null;                  // current course def
    this.theme = null;
    this.themeId = 'keep';
    this.cpIndex = 0;
    this.timeScale = 1;
    this.frames = 0;                  // boot.js watchdog reads this (COMPLETED frames only)
    this.noclip = false;
    this.freezeHazards = false;
    this.power = null;                // {id, t} while a power hat is active
    this.muted = false;

    /* ---- flags / timers (real-time ms unless stated) ---- */
    this._booted = false;
    this._loading = false;
    this._epoch = 0;                  // bumps on every course load / leave; stale async no-ops
    this._pendingCourse = null;       // ?course=<id>
    this._bootIntoCourse = false;     // ?course= + ?dev=1 → boot straight in
    this._prePauseState = 'playing';
    this._wasLockedAtPause = false;
    this._deathT = -1;                // <0 = no death sequence running
    this._deathSeeded = false;        // first step owns the frame the kill landed in
    this._deathCause = 'void';
    this._deathSwapped = false;
    this._deathSoft = false;
    this._deathStartedAt = 0;
    this._deathIsRewinding = false;
    this._rewindN = 0;                // samples captured for this rewind
    this._rewindBuf = new Float32Array(4 * 64);   // x,y,z,facing × up to 64 samples (0.4 s @ 60 Hz = 24)
    this._rewindK = 0;                // 0..1 desaturate amount currently applied
    this._clearT = -1;
    this._clearDef = null;
    this._clearSummary = null;
    this._clearResolved = false;
    this._cineT = -1;                 // course intro / generic cinematic
    this._cineMs = 0;
    this._cineKind = '';
    this._cineDone = null;
    this._gateOpenT = -1;
    this._gateOpenGate = null;
    this._gateOpenBurst = false;
    this._gateQueue = [];
    this._timerRun = false;
    this._veilA = 0;
    this._veilFrom = 0; this._veilTo = 0; this._veilT = 0; this._veilDur = 0;
    this._veilMode = 'fade';          // 'fade'|'iris'
    this._veilColor = '#0b0a16';
    this._veilCx = 50; this._veilCy = 50;
    this._veilResolve = null;
    this._lastAction = Object.create(null);
    this._gates = [];                 // resolved Keep gates (see _resolveGates)
    this._gateNear = -1;
    this._gateDwell = 0;
    this._gateArmed = true;
    this._gateSuppressed = -1;
    this._fen = null;                 // Old Fen record in the Keep
    this._fenLine = 0;
    this._fenNear = false;
    this._pT = ''; this._pS = ''; this._pL = false;
    this._prevPlayerDead = false;
    this._prevPlayerState = '';
    this._prevCamMode = '';
    this._devAccum = 0;
    this._colliderT = 0;
    this._colliderGroup = null;
    this._showColliders = false;
    this._titleT = 0;
    this._audioStarted = false;
    this._destroyed = false;
    this._ncPos = new THREE.Vector3();
    this._errStreak = 0;
    this._playerBound = false;
    this._settingsSub = null;
    this._spawnOut = { pos: new THREE.Vector3(), yaw: 0 };
    this._warden = null;
    this._collectibles = null;
    this._crestDefs = EMPTY_ARRAY;
    this._pendingFullReset = false;
    this._cpVolumes = [];             // course checkpoint volumes (kind 'checkpoint'), by index
    this._cpCount = 0;
    this._courseToastT = -1;
    this._hudReticleOwn = false;
    this._reticleOn = false;
    this._fovPull = 0;
    this._moodWanted = 'explore';
    this._moodApplied = '';
    this._hideHeroForPeek = false;

    /* Preallocated cinematic paths (mutated in place — never rebuilt per event). */
    this._orbitPath = { cam: [], kind: 'orbit', text: '' };
    for (let i = 0; i < CLEAR_ORBIT_KEYS; i++) this._orbitPath.cam.push({ p: [0, 0, 0], look: [0, 0, 0], t: 0 });
    this._gatePath = { cam: [{ p: [0, 0, 0], look: [0, 0, 0], t: 0 }, { p: [0, 0, 0], look: [0, 0, 0], t: 0 }, { p: [0, 0, 0], look: [0, 0, 0], t: 0 }], kind: 'gate', text: '' };

    /* Stable physics-world handle handed to Player once and never replaced. */
    const self = this;
    this.physWorld = {
      game: this,
      get course() { return self.course; },
      get broadphase() { return self.course && self.course.broadphase ? self.course.broadphase : EMPTY_BROADPHASE; },
      get killVolumes() { return self.course && self.course.killVolumes ? self.course.killVolumes : EMPTY_ARRAY; },
      get volumes() { return self.course && self.course.volumes ? self.course.volumes : EMPTY_ARRAY; },
      get hazards() { return self.course && self.course.hazards ? self.course.hazards : EMPTY_ARRAY; },
      get critters() { return self.course && self.course.critters ? self.course.critters : EMPTY_ARRAY; },
      get checkpoints() { return self.course && self.course.checkpoints ? self.course.checkpoints : EMPTY_ARRAY; },
      get waters() { return self.course && self.course.waters ? self.course.waters : EMPTY_ARRAY; },
      get killY() { return self.def && isNum(self.def.killY) ? self.def.killY : -30; },
      get bounds() { return self.course ? self.course.bounds : null; },
      get scene() { return self.engine ? self.engine.scene : null; },
      get clock() { return self.course && isNum(self.course.clock) ? self.course.clock : 0; },
    };

    /* Camera reference for the Player (contract §11: cameraRef.yaw). Live getters
       so it can be handed over BEFORE the FollowCamera exists. */
    this._camRef = {
      get yaw() {
        const c = self.cam;
        if (!c) return 0;
        const y = c.yawForMovement;
        return isNum(y) ? y : (isNum(c.yaw) ? c.yaw : 0);
      },
      get pitch() { return self.cam && isNum(self.cam.pitch) ? self.cam.pitch : 0; },
      get mode() { return self.cam ? self.cam.mode : 'follow'; },
      get forwardFlat() { return self.cam ? self.cam.forwardFlat : null; },
      get camera() { return self.engine ? self.engine.camera : null; },
    };

    /* Reused HUD snapshot — HUD.update() is called every frame (contract §27). */
    this._snapPower = { id: null, t: 0 };
    this._snapWarden = { hp: 0, hpMax: 3 };
    this._snap = {
      courseName: '', realmName: '', courseId: '', realmId: '',
      crests: 0, crestsTotal: 0, crestIds: [],
      coins: 0, coinsTotal: 0, sigils: 0, sigilsTotal: 0,
      timeMs: 0, sessionMs: 0, deaths: 0, cpIndex: 0, cpCount: 0,
      power: null, raceMs: null, warden: null, speed: 0,
      state: 'loading', isKeep: true, difficulty: 1, showTimer: true,
      cannon: false, cannonYaw: 0, cannonPitch: 0, camMode: 'follow', pointerLocked: false,
      crestTotal: 0, crestGrandTotal: 0, bestMs: null, muted: false, power01: 0,
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
    if (services.quality) this.quality = services.quality;
    if (typeof services.onProgress === 'function') this.onProgress = services.onProgress;
    if (typeof services.onFatal === 'function') this.onFatal = services.onFatal;
    if (services.dev !== undefined) this.dev = !!services.dev;
    if (services.course) this._pendingCourse = String(services.course);
    if (services.bootIntoCourse !== undefined) this._bootIntoCourse = !!services.bootIntoCourse;
    return this;
  }

  attachUI(ui) {
    if (!ui) return this;
    if (ui.hud) this.hud = ui.hud;
    if (ui.menu) this.menu = ui.menu;
    if (ui.card) this.card = ui.card;
    if (ui.courseCard) this.card = ui.courseCard;
    if (ui.transitions) this.transitions = ui.transitions;
    this._hudReticleOwn = !!(this.hud && typeof this.hud.setReticle === 'function');
    return this;
  }

  /* ======================================================================
   * DOM overlays owned by Game
   * ====================================================================*/
  _buildOverlays() {
    if (typeof document === 'undefined') { this.el = null; return; }
    const doc = document;
    if (!doc.getElementById('cb-game-style')) {
      const st = doc.createElement('style');
      st.id = 'cb-game-style';
      st.textContent = GAME_CSS;
      doc.head.appendChild(st);
    }
    const root = doc.getElementById('ui') || doc.body;
    const mk = (id, cls, html) => {
      let el = doc.getElementById(id);
      if (!el) { el = doc.createElement('div'); el.id = id; root.appendChild(el); }
      el.className = cls;
      if (html !== undefined) el.innerHTML = html;
      return el;
    };
    this.el = {};
    this.el.veil = mk('cb-veil', 'cb-veil');
    this.el.prompt = mk('cb-prompt', 'cb-prompt',
      '<div class="cb-prompt-inner"><b class="cb-key">E</b><span class="cb-prompt-text"></span></div>' +
      '<div class="cb-prompt-sub"></div>');
    this.el.cine = mk('cb-cine', 'cb-cine',
      '<div class="cb-bar top"></div><div class="cb-bar bottom"></div>' +
      '<div class="cb-cine-cap"><div class="cb-cine-name"></div><div class="cb-cine-text"></div></div>' +
      '<div class="cb-cine-skip">PRESS JUMP TO SKIP</div>');
    this.el.reticle = mk('cb-reticle', 'cb-reticle', '<i></i><u></u><u></u><u></u><u></u>');
    this.el.dev = mk('cb-dev', 'cb-dev');

    this.el.promptKey = this.el.prompt.querySelector('.cb-key');
    this.el.promptText = this.el.prompt.querySelector('.cb-prompt-text');
    this.el.promptSub = this.el.prompt.querySelector('.cb-prompt-sub');
    this.el.cineName = this.el.cine.querySelector('.cb-cine-name');
    this.el.cineText = this.el.cine.querySelector('.cb-cine-text');
    this.el.cineSkip = this.el.cine.querySelector('.cb-cine-skip');
    this._setVeil(0);
  }

  /* ======================================================================
   * Boot (contract §28: `async boot()`)
   * ====================================================================*/
  async boot() {
    if (this._booted) return this;
    this._booted = true;

    this._progress(0.05, 'reading save');
    safe(() => this.save.load(), 'save.load');

    this._progress(0.12, 'applying settings');
    this._applySettings();
    if (this.settings && typeof this.settings.on === 'function') {
      this._settingsSub = () => this._applySettings();
      this.settings.on(this._settingsSub);
    }

    this._progress(0.2, 'wiring input');
    this._bindInput();
    this._bindWindow();
    this._publishHandle();

    /* ?course=<id>: preload for harnesses; with ?dev=1 boot straight into it. */
    const direct = this._bootIntoCourse && this._pendingCourse && this._pendingCourse !== KEEP_ID && isCourseId(this._pendingCourse);
    if (this._pendingCourse && isCourseId(this._pendingCourse)) prefetchCourse(this._pendingCourse);

    /* The engine's dynamic render scale (CONTRACT hard rule 4) may not step
       while Nim is in the air: a resolution change during a jump is the one
       moment the upscale is visible, because the whole frame is moving and the
       eye is locked on a single silhouette. Grounded, a 0.05 step is invisible. */
    this.engine.renderScaleGuard = () => {
      const p = this.player;
      return !!(p && !p.grounded && !p.dead && this.state === 'playing');
    };

    if (direct) {
      this._progress(0.35, 'building ' + this._pendingCourse);
      const id = this._pendingCourse;
      this._pendingCourse = null;
      this.startAudio();
      await this.loadCourse(id, { silent: true, holdVeil: true, skipIntro: true });
      if (this.dev) this._installDev();
      this.engine.start((dt) => this.update(dt));
      this._veilIn(600);
      this._progress(1, 'ready');
      return this;
    }

    /* The Keep doubles as the title backdrop: the menu sits over a real, lit,
       playable world instead of a black void. Control is withheld until PLAY. */
    this._progress(0.35, 'building the keep');
    await this.loadCourse(KEEP_ID, { silent: true, toTitle: true, holdVeil: true });

    this._progress(0.96, 'ready');
    this.state = 'title';
    this._suspendInput(true);
    safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
    safe(() => this.menu && this.menu.open('title'), 'menu.open(title)');
    if (this.dev) this._installDev();

    /* Start the loop BEFORE lifting the veil so the reveal is animated (the
       tween is driven by update(), not by a CSS transition). */
    this.engine.start((dt) => this.update(dt));
    this._veilIn(820);
    this._progress(1, 'ready');
    return this;
  }

  /** globalThis.CRESTBOUND — boot.js publishes the full handle; this guarantees one exists. */
  _publishHandle() {
    try {
      const g = globalThis;
      if (g.CRESTBOUND && g.CRESTBOUND.game === this) return;
      if (!g.CRESTBOUND) g.CRESTBOUND = { engine: this.engine, game: this, THREE, version: '0.1.0' };
      else { g.CRESTBOUND.game = this; g.CRESTBOUND.engine = this.engine; }
    } catch (e) { /* non-browser */ }
  }

  /* ======================================================================
   * Live run counters — ONE scope, ONE denominator.
   *
   * The HUD chip, the pause header and the course-clear panel all used to read
   * a different pair (live coins vs `save.coinsBest`, the 100-coin crest
   * threshold vs the count of coins PLACED in the course), so one run could
   * read 37/100, 0/100 and 0/121 on three surfaces at once. These two getters
   * are the single source: what the player is holding RIGHT NOW, and the
   * threshold that buys the coin crest.
   * ====================================================================*/
  /** Coins banked in the CURRENT visit (not the save's best). */
  get coins() {
    const c = this._collectibles;
    return c && c.counts && isNum(c.counts.coins) ? c.counts.coins | 0 : 0;
  }

  /**
   * Coins that buy this course's coin crest — the one denominator.
   *
   * ZERO when the def declares no coin crest, and that zero is load-bearing:
   * the fallback used to be a flat 100, so THE KEEP — `coins: []`, no `crests`
   * key at all (runtime/data/keep.js) — inherited a course rule and the hub HUD
   * printed '0 / 100' for coins that do not exist there. A denominator the
   * player can never reach is worse than no chip; the HUD hides the chip on 0.
   */
  get coinsGoal() {
    const d = this.def;
    if (d && Array.isArray(d.crests)) {
      for (let i = 0; i < d.crests.length; i++) {
        const cr = d.crests[i];
        if (cr && cr.type === 'coins' && isNum(cr.threshold) && cr.threshold > 0) return cr.threshold | 0;
      }
    }
    return 0;
  }

  /** Sigils banked in the current visit. */
  get sigils() {
    const c = this._collectibles;
    return c && c.counts && isNum(c.counts.sigils) ? c.counts.sigils | 0 : 0;
  }

  _suspendInput(on) {
    const inp = this.input;
    if (!inp) return;
    if (typeof inp.setSuspended === 'function') safe(() => inp.setSuspended(!!on), 'setSuspended');
    else inp.suspended = !!on;
  }

  /**
   * Does a UI surface own the input right now? DERIVED, never accumulated.
   * The death freeze counts only up to the swap: _performRespawn hands the
   * controls back the instant the world is replaced while _deathT still counts
   * out the reveal. Cinematics leave input live so they are skippable (the body
   * stays frozen because update() skips player.update while a cinematic runs).
   */
  _uiOwnsInput() {
    if (this.state === 'title' || this.state === 'paused' || this.state === 'card') return true;
    if (this.menu && this.menu.isOpen) return true;
    if (this.card && this.card.isOpen) return true;
    if (this.hud && this.hud.clearOpen) return true;
    if (this._clearT >= 0) return true;
    if (this._gateOpenT >= 0) return true;
    if (this._deathT >= 0 && !this._deathSwapped) return true;
    return false;
  }

  _reconcileSuspend() {
    const inp = this.input;
    if (!inp) return;
    const want = this._uiOwnsInput();
    if (!!inp.suspended !== want) this._suspendInput(want);
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
    if (q) this.quality = q;

    if (this.audio && typeof this.audio.setVolumes === 'function') {
      safe(() => this.audio.setVolumes({
        master: this.muted ? 0 : (isNum(s.master) ? s.master : 0.8),
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
    if (typeof document !== 'undefined') {
      const scale = isNum(s.hudScale) ? clamp(s.hudScale, 0.6, 1.6) : 1;
      document.documentElement.style.setProperty('--cb-hud-scale', String(scale));
      document.documentElement.classList.toggle('cb-reduce-motion', !!s.reduceMotion);
    }
    if (this.cam && typeof this.cam.setMode === 'function' && (s.camMode === 'follow' || s.camMode === 'free')) {
      if (this.cam.mode === 'follow' || this.cam.mode === 'free') safe(() => this.cam.setMode(s.camMode), 'cam.setMode');
    }
    this._snap.showTimer = s.showTimer !== false;
  }

  /* ======================================================================
   * Event wiring
   * ====================================================================*/
  _bindInput() {
    const inp = this.input;
    if (!inp) return;
    /* Edge flags (pausePressed etc.) are read per frame in _readInputActions;
       these are the FACTS the Input reports asynchronously. Facts pause, never
       resume (see header). */
    bindEvent(inp, 'blur', () => this.pause('blur'));
    bindEvent(inp, 'unlock', (reason) => {
      if (reason === 'key' || reason === 'pause') return;   // the pause key already acted
      if (this.dev) return;                                   // harness immunity
      if (this._isLive() && this._deathT < 0) this.pause('unlock');
    });
    bindEvent(inp, 'gamepadconnected', () => {
      safe(() => this.hud && this.hud.toast('CONTROLLER CONNECTED', '', 'info'), 'hud.toast');
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
   * The Player raises what only the Player can know. Collect/checkpoint arrive
   * from it too (contract §11) — both idempotent here.
   */
  _bindPlayerEvents() {
    const p = this.player;
    if (!p || !p.events || this._playerBound) return;
    this._playerBound = true;
    bindEvent(p.events, 'death', (cause) => this.onDeath(typeof cause === 'string' ? cause : 'void'));
    bindEvent(p.events, 'checkpoint', (i) => this.onCheckpoint(i | 0));
    bindEvent(p.events, 'collect', (kind, id) => this._onPlayerCollect(kind, id));
    bindEvent(p.events, 'cannonEnter', () => {
      safe(() => this.audio && this.audio.sfx('ui_move'), 'audio.sfx');
      safe(() => this.hud && this.hud.toast('AIM', 'JUMP TO FIRE', 'info'), 'hud.toast');
    });
    bindEvent(p.events, 'ringPass', () => safe(() => this.audio && this.audio.sfx('ring_pass'), 'audio.sfx'));
    bindEvent(p.events, 'land', (speed, surface, hard) => {
      if (this.impacts && typeof this.impacts.land === 'function') {
        safe(() => this.impacts.land(speed, surface, p.pos, null), 'impacts.land');
      }
      if (hard && this.input && this.input.gamepad && typeof this.input.gamepad.rumble === 'function') {
        safe(() => this.input.gamepad.rumble(0.6, 0.3, 120), 'rumble');
      }
    });
    bindEvent(p.events, 'poundLand', (pos) => {
      if (this.impacts && typeof this.impacts.pound === 'function') safe(() => this.impacts.pound(pos || p.pos), 'impacts.pound');
    });
  }

  /**
   * The course's Collectibles detect coins/sigils/crests (contract §22) and
   * present their own pickup (spin, pop, coin/sigil sfx). Game owns the MEANING:
   * save writes, the crest celebration, the sigilsDone / coins100 stingers, HUD.
   */
  _bindCourseEvents(course) {
    const col = course && course.collectibles;
    this._collectibles = col || null;
    if (col && col.events) {
      bindEvent(col.events, 'crest', (def) => this.onCrest(def));
      bindEvent(col.events, 'sigilsDone', () => {
        safe(() => this.audio && this.audio.stinger('sigilsDone'), 'audio.stinger');
        safe(() => this.hud && this.hud.toast('EIGHT SIGILS', 'A CREST APPEARS', 'success'), 'hud.toast');
      });
      bindEvent(col.events, 'coins100', () => {
        safe(() => this.audio && this.audio.stinger('coins100'), 'audio.stinger');
        safe(() => this.hud && this.hud.toast('A HUNDRED COINS', 'A CREST APPEARS', 'success'), 'hud.toast');
      });
      bindEvent(col.events, 'power', (id, dur) => this._givePower(id, dur));
    }
    if (course && course.events) {
      bindEvent(course.events, 'checkpoint', (i) => this.onCheckpoint(i | 0));
      bindEvent(course.events, 'power', (id, dur) => this._givePower(id, dur));
      bindEvent(course.events, 'wardenDown', () => {
        safe(() => this.audio && this.audio.stinger('unlock'), 'audio.stinger');
        safe(() => this.hud && this.hud.toast('WARDEN DEFEATED', '', 'success'), 'hud.toast');
      });
    }
  }

  _onPlayerCollect(kind, id) {
    if (kind === 'power') this._givePower(id);
    else if (kind === 'checkpoint') this.onCheckpoint(id | 0);
  }

  /* ======================================================================
   * Course lifecycle
   * ====================================================================*/

  /**
   * @param {string} courseId
   * @param {{silent?:boolean, toTitle?:boolean, holdVeil?:boolean, fromGate?:object,
   *          fromCourse?:string, cpIndex?:number, skipIntro?:boolean}} [opts]
   */
  async loadCourse(courseId, opts) {
    const o = opts || {};
    if (this._loading) return this;
    this._loading = true;
    const id = String(courseId || KEEP_ID);
    const epoch = ++this._epoch;

    try {
      /* ---- 1. freeze the world, THEN cover it ---- */
      this.state = 'loading';
      this._timerRun = false;
      this._endCinematic(true);
      this._endClear(true);
      this._endGateOpen(true);
      this._cancelDeath();
      this._setPrompt('', '');
      this._setReticle(false);
      this._clearPower();
      safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
      this._suspendInput(true);

      if (!o.silent) {
        this._setVeilColor(this._veilColorFor(this._themeFor(id)));
        await this._veilOut(o.fromGate ? 380 : 260, o.fromGate ? 'iris' : 'fade');
      } else {
        this._setVeil(1, 'fade');
      }
      if (epoch !== this._epoch) return this;

      this._progress(0.4, 'loading ' + id);

      /* ---- 2. resolve the def ---- */
      const def = await getCourse(id);
      if (epoch !== this._epoch) return this;
      if (!def) throw new Error('course "' + id + '" has no definition');

      /* ---- 3. tear the old course down (never on respawn — only here) ---- */
      this._disposeCourse();

      /* ---- 4. theme first, so the course builds against the right palette ---- */
      const themeId = def.theme || this._themeFor(id);
      this._applyThemeFor(themeId);
      this._progress(0.55, 'materialising');

      /* ---- 5. build ---- */
      const ctx = {
        mats: this.mats, fx: this.fx, audio: this.audio, save: this.save, game: this, engine: this.engine,
        quality: this.quality, impacts: this.impacts, decals: this.decals, settings: this.settings,
      };
      let course = null;
      if (typeof Course.load === 'function') course = await Course.load(def, this.engine, ctx);
      if (epoch !== this._epoch) { safe(() => course && course.dispose(), 'course.dispose'); return this; }
      if (!course) course = new Course(def, this.engine, ctx);
      this.course = course;
      this.def = def;
      this.courseId = def.id || id;
      const realm = realmOf(this.courseId);
      this.realmId = realm ? realm.id : null;
      if (course.group && this.engine.scene && !course.group.parent) this.engine.scene.add(course.group);
      this._bindCourseEvents(course);
      this._progress(0.72, 'placing hazards');

      /* ---- 6. per-course bookkeeping ---- */
      this.cpIndex = isNum(o.cpIndex) ? clamp(o.cpIndex | 0, 0, Math.max(0, (course.checkpoints || EMPTY_ARRAY).length - 1)) : 0;
      this.timeMs = 0;
      this.courseDeaths = 0;
      this._prevPlayerDead = false;
      this._indexCheckpointVolumes(course);
      this._indexCrests(def);
      this._findWarden(course);
      this._resolveGates(def, course);
      this._resolveFen(def, course);
      this._moodWanted = 'explore';

      /* ---- 7. audio + ambience ---- */
      safe(() => this.audio && this.audio.setTheme(themeId), 'audio.setTheme');
      this._startAmbience();

      /* ---- 8. actors (built once, reused forever) ---- */
      this._ensureActors();
      safe(() => this.player.setWorld(this.physWorld), 'player.setWorld');
      safe(() => course.setPlayer(this.player), 'course.setPlayer');
      const sp = (this.courseId === KEEP_ID && o.fromCourse) ? this._keepSpawnFor(o.fromCourse) : this._spawnFor(this.cpIndex);
      safe(() => this.player.spawn(sp.pos, sp.yaw), 'player.spawn');
      this._ncPos.copy(this.player.pos);
      safe(() => this.cam && this.cam.setDeathCam(false), 'cam.setDeathCam');
      safe(() => this.cam && this.cam.setCinematic(null), 'cam.setCinematic');
      safe(() => this.cam && this.cam.recenter(), 'cam.recenter');
      safe(() => this.hero && this.hero.setTheme(this.theme), 'hero.setTheme');
      safe(() => this.hero && this.hero.setVisible(true), 'hero.setVisible');
      safe(() => this.hero && this.hero.setPower(null), 'hero.setPower');
      if (this.engine.post) {
        safe(() => this.engine.post.setDamage && this.engine.post.setDamage(0), 'post.setDamage');
        safe(() => this.engine.post.setUnderwater && this.engine.post.setUnderwater(0), 'post.setUnderwater');
      }
      this._setRewindGrade(0);

      /* ---- 9. warm-up under the veil so the first visible frame is complete ---- */
      safe(() => course.warmup && course.warmup(this.engine.renderer, this.engine.camera), 'course.warmup');
      safe(() => course.update(0, this.player), 'course.update(0)');
      safe(() => this.player.update(0), 'player.update(0)');
      safe(() => this.cam && this.cam.update(0), 'cam.update(0)');
      safe(() => this.hero && this.hero.update(0, this.player), 'hero.update(0)');
      if (this.engine && typeof this.engine.followShadow === 'function') safe(() => this.engine.followShadow(this.player.renderPos || this.player.pos), 'followShadow');
      this._progress(0.9, 'ready');

      /* ---- 10. hand over ---- */
      const isKeep = this.courseId === KEEP_ID;
      if (o.toTitle) {
        this.state = 'title';
        if (!o.holdVeil) this._veilIn(520);
      } else if (isKeep) {
        this._handOverControl();
        if (!o.holdVeil) this._veilIn(o.fromCourse ? 520 : 380);
        this._queueGateUnlocks(!!o.fromCourse);
      } else {
        const seen = safe(() => this.save.flags.get('intro:' + this.courseId), 'flags.get');
        const wantIntro = !o.skipIntro && def.intro && !seen;
        if (!o.holdVeil) this._veilIn(wantIntro ? 700 : 420, o.fromGate ? 'iris' : 'fade');
        if (wantIntro) this._startIntro(def);
        else { this._handOverControl(); this._toastCourse(def); }
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

  _onLoadError(id, err) {
    if (typeof console !== 'undefined') console.error('[crestbound] course load failed: ' + id, err);
    this._setVeil(0);
    this.state = this.course ? (this.courseId === KEEP_ID ? 'keep' : 'playing') : 'title';
    if (this.hud && typeof this.hud.toast === 'function') {
      safe(() => this.hud.toast('COULD NOT LOAD ' + String(id).toUpperCase(), String((err && err.message) || err), 'error'), 'hud.toast');
    }
    if (!this.course) safe(() => this.menu && this.menu.open('title'), 'menu.open');
  }

  _disposeCourse() {
    const c = this.course;
    if (!c) return;
    this.course = null;
    this._collectibles = null;
    this._warden = null;
    this._gates.length = 0;
    this._gateNear = -1;
    this._fen = null;
    this._clearColliderDebug();
    safe(() => this.decals && this.decals.clear(), 'decals.clear');
    safe(() => this.impacts && this.impacts.cancelDeath && this.impacts.cancelDeath(), 'impacts.cancelDeath');
    safe(() => { if (c.group && c.group.parent) c.group.parent.remove(c.group); }, 'scene.remove');
    safe(() => c.dispose(), 'course.dispose');   // also clears its event listeners
  }

  _ensureActors() {
    if (!this.player) {
      this.player = new Player(this.physWorld, this.input, this.audio, this.fx, this._camRef);
      this._bindPlayerEvents();
    }
    if (!this.cam) {
      this.cam = new FollowCamera(this.engine.camera, this.player, this.input, this.physWorld, this.settings || Settings);
      const s = safe(() => (this.settings || Settings).get(), 'settings.get') || {};
      if (typeof this.cam.setMode === 'function' && (s.camMode === 'follow' || s.camMode === 'free')) safe(() => this.cam.setMode(s.camMode), 'cam.setMode');
    }
    if (!this.hero) {
      this.hero = new Hero(this.engine.scene, this.mats, this.quality);
      if (this.hero.root && this.engine.scene && !this.hero.root.parent) this.engine.scene.add(this.hero.root);
    }
    this._wireImpacts();
  }

  /**
   * Impacts is constructed in boot.js before the FollowCamera and Post exist, so
   * the pieces it needs arrive here, once both do (dip/shake/punch/death cam).
   */
  _wireImpacts() {
    const im = this.impacts;
    if (!im) return;
    const post = this.engine ? this.engine.post : null;
    if (this.cam && typeof im.setCamera === 'function' && im.camera !== this.cam) safe(() => im.setCamera(this.cam), 'impacts.setCamera');
    if (post && typeof im.setPost === 'function' && im.post !== post) safe(() => im.setPost(post), 'impacts.setPost');
    if (this.decals && typeof im.setDecals === 'function' && im.decals !== this.decals) safe(() => im.setDecals(this.decals), 'impacts.setDecals');
    if (this.theme && typeof im.setTheme === 'function') safe(() => im.setTheme(this.theme), 'impacts.setTheme');
  }

  _startAmbience() {
    if (!this.fx || typeof this.fx.ambient !== 'function') return;
    const th = this.theme;
    const list = th && th.particles && Array.isArray(th.particles.ambient) ? th.particles.ambient : null;
    const b = (this.course && this.course.bounds) || null;
    const box = b && b.isBox3 ? b : _box.set(_v1.set(-60, -10, -60), _v2.set(60, 60, 60));
    if (typeof this.fx.clearAmbient === 'function') safe(() => this.fx.clearAmbient(), 'fx.clearAmbient');
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.preset) continue;
      safe(() => this.fx.ambient(a.preset, box, isNum(a.rate) ? a.rate : 12), 'fx.ambient');
    }
  }

  _themeFor(id) {
    if (id === KEEP_ID) return 'keep';
    const m = COURSE_META[id];
    if (m && m.theme) return m.theme;
    const r = realmOf(id);
    return (r && r.theme) || 'verdant';
  }

  _applyThemeFor(themeId) {
    this.themeId = themeId;
    const th = (THEMES && THEMES[themeId]) || (THEMES && THEMES.keep) || null;
    this.theme = th;
    let ok = false;
    if (typeof applyTheme === 'function') ok = safe(() => { applyTheme(this.engine, themeId); return true; }, 'applyTheme') === true;
    if (!ok && th && this.engine && typeof this.engine.setTheme === 'function') safe(() => this.engine.setTheme(th), 'engine.setTheme');
    safe(() => this.impacts && this.impacts.setTheme && this.impacts.setTheme(th), 'impacts.setTheme');

    /* Expose the palette to the CSS overlays so cards inherit the realm tint. */
    if (typeof document !== 'undefined') {
      const pal = (th && th.palette) || {};
      const realm = realmOf(this.courseId) || null;
      const accent = cssColor(pal.accent || (realm && realm.accent) || pal.crest, '#ffd166');
      const root = document.documentElement;
      root.style.setProperty('--cb-accent', accent);
      root.style.setProperty('--cb-accent-dim', shade(accent, 0.45));
      root.style.setProperty('--cb-kill', cssColor(pal.kill, '#ff5a3c'));
      root.style.setProperty('--cb-bg', cssColor(th && th.bg, '#0b0a16'));
    }
    this._setVeilColor(this._veilColorFor(themeId));
  }

  _veilColorFor(themeId) {
    const th = (THEMES && THEMES[themeId]) || null;
    if (!th) return '#0b0a16';
    const bg = cssColor(th.bg || (th.fog && th.fog.color), '#0b0a16');
    return shade(bg, 0.3);
  }

  /* ---- per-course indexes (built once per load; read allocation-free per frame) ---- */

  _indexCheckpointVolumes(course) {
    const out = this._cpVolumes;
    out.length = 0;
    const cps = (course && course.checkpoints) || EMPTY_ARRAY;
    this._cpCount = cps.length;
    for (let i = 0; i < cps.length; i++) out[i] = null;
    const vols = (course && course.volumes) || EMPTY_ARRAY;
    for (let i = 0; i < vols.length; i++) {
      const v = vols[i];
      if (!v || v.kind !== 'checkpoint') continue;
      const pr = v.props || v;
      const idx = isNum(pr.index) ? pr.index : (isNum(pr.cp) ? pr.cp : (isNum(v.index) ? v.index : -1));
      if (idx >= 0 && idx < cps.length) out[idx] = v;
    }
    /* A checkpoint object may carry its own volume. */
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (cp && !out[i] && cp.volume && typeof cp.volume.contains === 'function') out[i] = cp.volume;
    }
  }

  _indexCrests(def) {
    const defs = (def && Array.isArray(def.crests)) ? def.crests : EMPTY_ARRAY;
    this._crestDefs = defs;
    const s = this._snap;
    const ids = s.crestIds;
    ids.length = 0;
    for (let i = 0; i < defs.length; i++) ids.push({ id: defs[i].id, got: false, name: defs[i].name || '', type: defs[i].type || 'open' });
    this._refreshCrestGot();
  }

  _refreshCrestGot() {
    const ids = this._snap.crestIds;
    if (!ids.length) return;
    const rec = this.courseId !== KEEP_ID ? safe(() => this.save.course(this.courseId), 'save.course') : null;
    const got = rec && Array.isArray(rec.crests) ? rec.crests : EMPTY_ARRAY;
    for (let i = 0; i < ids.length; i++) ids[i].got = got.indexOf(ids[i].id) !== -1;
    this._snap.bestMs = null;
  }

  _findWarden(course) {
    this._warden = null;
    const cr = (course && course.critters) || EMPTY_ARRAY;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      if (c && (c.kind === 'warden' || (c.def && c.def.kind === 'warden'))) { this._warden = c; return; }
    }
  }

  /* ======================================================================
   * Keep gates (contract §26)
   * ====================================================================*/
  _resolveGates(def, course) {
    const list = this._gates;
    list.length = 0;
    if (!def || def.id !== KEEP_ID) return;
    const src = (course && Array.isArray(course.gates) && course.gates.length) ? course.gates : (Array.isArray(def.gates) ? def.gates : EMPTY_ARRAY);
    for (let i = 0; i < src.length; i++) {
      const g = src[i];
      if (!g || !g.course || !isCourseId(g.course) || g.course === KEEP_ID) continue;
      const meta = COURSE_META[g.course] || {};
      const req = g.requires && isNum(g.requires.crests) ? g.requires.crests : (isNum(meta.gateCrests) ? meta.gateCrests : 0);
      /* The stand-out spot BELONGS TO THE DATA: keep.js authors `exitP`/`exitYaw`
         (p - heading(yaw)*1.9, yaw + PI) because heading(yaw) points INTO the wall.
         Resolve it here once so _keepSpawnFor never has to re-derive it — and when
         a gate omits it, derive it the same way (backwards along the heading). */
      const gYaw = yawOf(g, 0);
      /* NOT `src`: the gate list one scope out is already called `src`, and a
         `const src` in this block put `const g = src[i]` at the top of the same
         block in the temporal dead zone — every Keep load threw
         "Cannot access 'src' before initialization" out of _resolveGates. */
      const gsrc = (g.exitP === undefined || g.exitP === null) && g.def ? g.def : g;
      const exitPos = new THREE.Vector3();
      const exitYawRaw = isNum(g.exitYaw) ? g.exitYaw : (isNum(gsrc.exitYaw) ? gsrc.exitYaw : null);
      if (gsrc.exitP !== undefined && gsrc.exitP !== null) toVec3(gsrc.exitP, exitPos);
      else { toVec3(g, exitPos); headingFromYaw(gYaw, _v1); exitPos.addScaledVector(_v1, -1.9); }
      list.push({
        index: i,
        course: g.course,
        kind: g.kind || 'painting',
        pos: toVec3(g, new THREE.Vector3()),
        yaw: gYaw,
        exitPos,
        exitYaw: isNum(exitYawRaw) ? exitYawRaw : (gYaw + Math.PI),
        requires: req,
        volume: g.volume && typeof g.volume.contains === 'function' ? g.volume : null,
        ref: g,
        label: meta.name || String(g.course).toUpperCase(),
        realmName: (realmOf(g.course) || {}).name || '',
        locked: true,
        sub: '',
      });
    }
    this._refreshGateState();
  }

  /** Lock state resolved per Keep load and after every unlock — never per frame. */
  _refreshGateState() {
    const total = safe(() => this.save.crestTotal(), 'save.crestTotal') | 0;
    for (let i = 0; i < this._gates.length; i++) {
      const g = this._gates[i];
      g.locked = total < g.requires;
      const rec = safe(() => this.save.course(g.course), 'save.course');
      const n = rec && Array.isArray(rec.crests) ? rec.crests.length : 0;
      const bestOpen = rec && rec.bestMs && isNum(rec.bestMs.open) ? rec.bestMs.open : null;
      if (g.locked) g.sub = g.requires + ' CREST' + (g.requires === 1 ? '' : 'S') + ' TO OPEN';
      else g.sub = (g.realmName ? g.realmName + '   ' : '') + 'CRESTS ' + n + ' / 7' + (bestOpen !== null ? '   BEST ' + fmtTime(bestOpen / 1000) : '');
      const ref = g.ref;
      if (ref) {
        if (typeof ref.setLocked === 'function') safe(() => ref.setLocked(g.locked), 'gate.setLocked');
        else if ('locked' in ref) ref.locked = g.locked;
      }
    }
  }

  _updateGates(dt) {
    if (this.state !== 'keep' || !this.player || this._loading || this._deathT >= 0 || this._gateOpenT >= 0) {
      if (this._gateNear !== -1) { this._gateNear = -1; this._setPrompt('', ''); }
      return;
    }
    const pp = this.player.pos;
    let near = -1;
    let bestD = GATE_PROMPT_R * GATE_PROMPT_R;
    for (let i = 0; i < this._gates.length; i++) {
      const g = this._gates[i];
      const dy = pp.y - g.pos.y;
      if (dy > 4.5 || dy < -3.5) continue;
      const dx = pp.x - g.pos.x, dz = pp.z - g.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; near = i; }
    }

    /* A cancelled card leaves the player standing in the gate: keep it disarmed
       until they walk clear, or the card would pop straight back up. */
    if (this._gateSuppressed !== -1) {
      if (near !== this._gateSuppressed || bestD > GATE_REARM_R * GATE_REARM_R) this._gateSuppressed = -1;
    }

    if (near !== this._gateNear) {
      this._gateNear = near;
      this._gateDwell = 0;
      if (near === -1) { if (!this._fenNear) this._setPrompt('', ''); }
    }
    if (near === -1) return;

    const g = this._gates[near];
    this._setPrompt(g.label, g.sub, g.locked);
    if (g.locked || this._gateSuppressed === near) { this._gateDwell = 0; return; }

    let inside;
    if (g.volume) inside = !!safe(() => g.volume.contains(pp), 'gate.contains');
    else inside = bestD <= GATE_ENTER_R * GATE_ENTER_R;
    this._gateDwell = inside ? this._gateDwell + dt : 0;
    const pressed = this.input && this.input.interactPressed && bestD <= (GATE_ENTER_R * 1.6) * (GATE_ENTER_R * 1.6);
    if (pressed || this._gateDwell >= GATE_ENTER_DWELL) {
      this._gateDwell = 0;
      this.enterGate(g);
    }
  }

  /**
   * Walking into a painting: course card → 'enter' → iris → loadCourse.
   * Contract §28 `enterGate(gate)`; accepts a resolved gate or a raw keep gate def.
   */
  enterGate(gate) {
    if (!gate || this.state !== 'keep' || this._loading) return;
    let g = gate;
    if (!('locked' in gate) || !gate.pos) {
      g = null;
      for (let i = 0; i < this._gates.length; i++) if (this._gates[i].ref === gate || this._gates[i].course === gate.course) { g = this._gates[i]; break; }
      if (!g) return;
    }
    if (g.locked) {
      safe(() => this.audio && this.audio.sfx('ui_back'), 'audio.sfx');
      safe(() => this.hud && this.hud.toast('SEALED', g.requires + ' CRESTS TO OPEN', 'locked'), 'hud.toast');
      return;
    }
    const epoch = this._epoch;
    this.state = 'card';
    this._timerRun = false;
    this._setPrompt('', '');
    this._suspendInput(true);
    safe(() => this.audio && this.audio.sfx('ui_ok'), 'audio.sfx');
    safe(() => this.audio && this.audio.duck(300), 'audio.duck');

    const gateIdx = this._gates.indexOf(g);
    getCourse(g.course).then((def) => {
      if (epoch !== this._epoch || this.state !== 'card') return null;
      if (this.card && typeof this.card.show === 'function') return this.card.show(def, this.save);
      return 'enter';                                    // no card module: walk straight in
    }).then((choice) => {
      if (epoch !== this._epoch || this.state !== 'card') return;
      if (choice === 'enter') {
        if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('paintingRipple', g.pos), 'fx.burst');
        safe(() => this.audio && this.audio.sfx('painting_enter'), 'audio.sfx');
        safe(() => this.save.clearCheckpoint(g.course), 'save.clearCheckpoint');
        this.loadCourse(g.course, { fromGate: g }).catch(() => {});
      } else {
        this._gateSuppressed = gateIdx;
        this.state = 'keep';
        this._timerRun = true;
        this._suspendInput(false);
        safe(() => this.audio && this.audio.sfx('ui_back'), 'audio.sfx');
      }
    }).catch((err) => {
      if (epoch !== this._epoch) return;
      this._gateSuppressed = gateIdx;
      this.state = 'keep';
      this._timerRun = true;
      this._suspendInput(false);
      safe(() => this.hud && this.hud.toast('COULD NOT OPEN ' + g.label, String((err && err.message) || err), 'error'), 'hud.toast');
    });
  }

  /**
   * Where Nim stands after leaving a course: in front of that course's painting,
   * facing into the room, feet on whatever floor is under the spot.
   */
  _keepSpawnFor(fromCourse) {
    const out = this._spawnOut;
    let g = null;
    for (let i = 0; i < this._gates.length; i++) if (this._gates[i].course === fromCourse) { g = this._gates[i]; break; }
    if (!g) return this._spawnFor(0);
    /* `g.yaw` is the heading the player WALKS IN WITH, so heading(g.yaw) points into
       the wall the painting hangs on. Standing out is the reverse: the resolved gate
       carries keep.js's authored exitPos/exitYaw, which already encode p - h*1.9 and
       yaw + PI. Stepping FORWARD along the heading (the old bug) put Nim inside the
       wall and, in the lobby, outside the floor entirely. */
    if (g.exitPos) out.pos.copy(g.exitPos);
    else { headingFromYaw(g.yaw, _v1); out.pos.copy(g.pos).addScaledVector(_v1, -1.9); }
    out.yaw = isNum(g.exitYaw) ? g.exitYaw : (g.yaw + Math.PI);
    /* Drop to the floor: paintings hang on walls, so gate.p is at picture height. */
    const bp = this.physWorld.broadphase;
    if (bp && typeof bp.raycast === 'function') {
      _v2.copy(out.pos); _v2.y += 1.2;
      const hit = safe(() => bp.raycast(_v2, _down, 8, _rayHit), 'broadphase.raycast');
      if (hit && isNum(_rayHit.t)) out.pos.y = _v2.y - _rayHit.t + 0.05;
    }
    return out;
  }

  /* ---- gate unlock sequence (once per gate, Save.flags) ---- */

  _queueGateUnlocks(fromCourse) {
    this._gateQueue.length = 0;
    const firstVisit = !safe(() => this.save.flags.get('keepSeen'), 'flags.get');
    const total = safe(() => this.save.crestTotal(), 'save.crestTotal') | 0;
    for (let i = 0; i < this._gates.length; i++) {
      const g = this._gates[i];
      if (total < g.requires) continue;
      const key = 'gateOpen:' + g.course;
      if (safe(() => this.save.flags.get(key), 'flags.get')) continue;
      /* Gates that were never sealed (requires 0) and everything already open on the
         very first visit are simply marked — a reveal for a door that was never shut
         reads as a glitch, not a reward. */
      if (g.requires === 0 || firstVisit) { safe(() => this.save.flags.set(key, true), 'flags.set'); continue; }
      this._gateQueue.push(g);
    }
    if (firstVisit) safe(() => this.save.flags.set('keepSeen', true), 'flags.set');
    this._refreshGateState();
  }

  _startGateOpen(g) {
    this._gateOpenGate = g;
    this._gateOpenT = 0;
    this._gateOpenBurst = false;
    this._timerRun = false;
    this._setPrompt('', '');
    /* Camera: a slow push toward the door from a spot in the room. */
    headingFromYaw(g.yaw, _v1);
    const path = this._gatePath;
    const k0 = path.cam[0], k1 = path.cam[1], k2 = path.cam[2];
    k0.p[0] = g.pos.x + _v1.x * 7.5; k0.p[1] = g.pos.y + 2.4; k0.p[2] = g.pos.z + _v1.z * 7.5;
    k1.p[0] = g.pos.x + _v1.x * 5.2; k1.p[1] = g.pos.y + 1.6; k1.p[2] = g.pos.z + _v1.z * 5.2;
    k2.p[0] = g.pos.x + _v1.x * 4.4; k2.p[1] = g.pos.y + 1.3; k2.p[2] = g.pos.z + _v1.z * 4.4;
    for (let i = 0; i < 3; i++) { path.cam[i].look[0] = g.pos.x; path.cam[i].look[1] = g.pos.y + 0.6; path.cam[i].look[2] = g.pos.z; }
    k0.t = 0; k1.t = GATE_OPEN_BURST_AT / 1000; k2.t = GATE_OPEN_MS / 1000;
    path.text = g.label;
    safe(() => this.cam && this.cam.setCinematic(path), 'cam.setCinematic');
    this._showCine(g.realmName ? g.realmName : 'THE KEEP', 'A GATE OPENS  ·  ' + g.label, false);
    safe(() => this.audio && this.audio.duck(500), 'audio.duck');
  }

  _stepGateOpen(ms) {
    this._gateOpenT += ms;
    const t = this._gateOpenT;
    const g = this._gateOpenGate;
    if (!this._gateOpenBurst && t >= GATE_OPEN_BURST_AT && g) {
      this._gateOpenBurst = true;
      if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('gateOpen', g.pos), 'fx.burst');
      safe(() => this.audio && this.audio.sfx('gate_open'), 'audio.sfx');
      safe(() => this.audio && this.audio.stinger('unlock'), 'audio.stinger');
      safe(() => this.cam && this.cam.shake && this.cam.shake(0.35, 320), 'cam.shake');
      safe(() => this.engine.post && this.engine.post.pulse && this.engine.post.pulse(0.35, 220), 'post.pulse');
      const ref = g.ref;
      if (ref) {
        if (typeof ref.open === 'function') safe(() => ref.open(), 'gate.open');
        else if (typeof ref.setLocked === 'function') safe(() => ref.setLocked(false), 'gate.setLocked');
        else if ('locked' in ref) ref.locked = false;
      }
      safe(() => this.save.flags.set('gateOpen:' + g.course, true), 'flags.set');
    }
    if (t >= GATE_OPEN_MS) this._endGateOpen(false);
  }

  _endGateOpen(silent) {
    if (this._gateOpenT < 0) return;
    this._gateOpenT = -1;
    const g = this._gateOpenGate;
    this._gateOpenGate = null;
    this._hideCine();
    safe(() => this.cam && this.cam.setCinematic(null), 'cam.setCinematic');
    if (silent) return;
    if (g) {
      safe(() => this.save.flags.set('gateOpen:' + g.course, true), 'flags.set');
      safe(() => this.hud && this.hud.toast(g.label + ' UNLOCKED', g.sub, 'success'), 'hud.toast');
    }
    this._refreshGateState();
    if (this.state === 'cinematic') this.state = 'keep';
    this._timerRun = true;
  }

  /* ======================================================================
   * Old Fen (keep caretaker NPC) — dialogue via hud.toast
   * ====================================================================*/
  _resolveFen(def, course) {
    this._fen = null;
    this._fenNear = false;
    if (!def || def.id !== KEEP_ID) return;
    let src = null;
    const npcs = Array.isArray(def.npcs) ? def.npcs : EMPTY_ARRAY;
    for (let i = 0; i < npcs.length; i++) if (npcs[i] && npcs[i].kind === 'fen') { src = npcs[i]; break; }
    let ref = null;
    const cr = (course && course.critters) || EMPTY_ARRAY;
    for (let i = 0; i < cr.length; i++) { const c = cr[i]; if (c && (c.kind === 'fen' || (c.def && c.def.kind === 'fen'))) { ref = c; break; } }
    if (!src && !ref) return;
    const lines = (src && Array.isArray(src.lines) && src.lines.length) ? src.lines : (ref && ref.def && Array.isArray(ref.def.lines) ? ref.def.lines : EMPTY_ARRAY);
    this._fen = { pos: toVec3(src || (ref && ref.def) || ref, new THREE.Vector3()), lines, ref, name: (src && src.name) || 'OLD FEN' };
    this._fenLine = safe(() => this.save.flags.get('fenLine'), 'flags.get') | 0;
  }

  _updateFen() {
    const f = this._fen;
    if (!f || this.state !== 'keep' || !this.player || this._gateNear !== -1) { this._fenNear = false; return; }
    const pp = this.player.pos;
    const pos = f.ref && f.ref.mesh && f.ref.mesh.position ? f.ref.mesh.position : f.pos;
    const dx = pp.x - pos.x, dz = pp.z - pos.z, dy = pp.y - pos.y;
    const d2 = dx * dx + dz * dz;
    const near = d2 < FEN_PROMPT_R * FEN_PROMPT_R && dy < 3 && dy > -3;
    if (near !== this._fenNear) { this._fenNear = near; if (!near) this._setPrompt('', ''); }
    if (!near) return;
    this._setPrompt(f.name, 'TALK', false);
    if (this.input && this.input.interactPressed && d2 < FEN_TALK_R * FEN_TALK_R) this._talkToFen();
  }

  _talkToFen() {
    const f = this._fen;
    if (!f || !this._cooldown('fen')) return;
    const total = safe(() => this.save.crestTotal(), 'save.crestTotal') | 0;
    let line;
    if (!f.lines.length) line = 'Bring me crests, little one. The Keep remembers every one.';
    else { line = f.lines[this._fenLine % f.lines.length]; this._fenLine++; safe(() => this.save.flags.set('fenLine', this._fenLine), 'flags.set'); }
    if (typeof line === 'object' && line) line = line.text || String(line);
    safe(() => this.hud && this.hud.toast(f.name, String(line).replace('{crests}', String(total)), 'dialogue'), 'hud.toast');
    safe(() => this.audio && this.audio.sfx('ui_move'), 'audio.sfx');
    if (f.ref && typeof f.ref.talk === 'function') safe(() => f.ref.talk(), 'fen.talk');
    if (!safe(() => this.save.flags.get('fenMet'), 'flags.get')) safe(() => this.save.flags.set('fenMet', true), 'flags.set');
  }

  /* ======================================================================
   * Cinematics — course intro (first entry) and generic paths
   * ====================================================================*/
  _startIntro(def) {
    const intro = def.intro;
    const keys = intro && Array.isArray(intro.cam) ? intro.cam : null;
    let ms = keys && keys.length ? toMs(keys[keys.length - 1].t) : 0;
    if (!(ms > 0)) ms = keys && keys.length ? INTRO_DEFAULT_MS : CINE_FALLBACK_MS;
    this._cineKind = 'intro';
    this._cineMs = ms;
    this._cineT = 0;
    this._cineDone = () => {
      safe(() => this.save.flags.set('intro:' + this.courseId, true), 'flags.set');
      this._handOverControl();
      this._toastCourse(def);
    };
    this.state = 'cinematic';
    this._timerRun = false;
    safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
    safe(() => this.cam && this.cam.setCinematic(keys ? intro : null), 'cam.setCinematic');
    this._showCine((realmOf(def.id) || {}).name || '', def.name || '', true, intro && intro.text ? intro.text : '');
    /* Input comes back NOW so the cinematic is skippable; the body stays frozen
       because update() skips player.update while _cineT >= 0. */
    this._suspendInput(false);
  }

  _stepCinematic(ms) {
    this._cineT += ms;
    if (this._cineT >= this._cineMs) { this._endCinematic(false); return; }
    if (this._cineT > INTRO_MIN_SKIP && this.input) {
      const i = this.input;
      if (i.jumpPressed || i.interactPressed || i.divePressed) this._endCinematic(false);
    }
  }

  _endCinematic(silent) {
    if (this._cineT < 0) return;
    this._cineT = -1;
    this._hideCine();
    safe(() => this.cam && this.cam.setCinematic(null), 'cam.setCinematic');
    safe(() => this.cam && this.cam.recenter(), 'cam.recenter');
    const done = this._cineDone;
    this._cineDone = null;
    if (!silent && typeof done === 'function') done();
  }

  _showCine(kicker, title, showSkip, text) {
    if (!this.el) return;
    const lock = kicker ? kicker + '  ·  ' + title : title;
    /* The prose slot is PROSE. A course whose intro.text is just its own name
       printed the title twice (lockup + body copy); reject it here so no course
       data can reintroduce the duplicate. */
    let body = text ? String(text) : '';
    const flat = body.replace(/\s+/g, ' ').trim().toUpperCase();
    if (flat && (flat === String(title || '').toUpperCase() || flat === lock.replace(/\s+/g, ' ').trim().toUpperCase()
      || flat === String(kicker || '').toUpperCase())) body = '';
    this.el.cineName.textContent = lock;
    this.el.cineText.textContent = body;
    this.el.cineText.style.display = body ? '' : 'none';
    this.el.cineSkip.style.display = showSkip ? '' : 'none';
    this.el.cine.classList.add('show');
  }

  _hideCine() { if (this.el) this.el.cine.classList.remove('show'); }

  _handOverControl() {
    const isKeep = this.courseId === KEEP_ID;
    this.state = isKeep ? 'keep' : 'playing';
    this._timerRun = true;
    this._suspendInput(false);
    safe(() => this.hud && this.hud.setVisible(true), 'hud.setVisible');
    safe(() => this.hero && this.hero.setVisible(true), 'hero.setVisible');
  }

  _toastCourse(def) {
    if (!def || def.id === KEEP_ID) return;
    const realm = realmOf(def.id);
    safe(() => this.hud && this.hud.toast(def.name || String(def.id).toUpperCase(),
      (realm ? realm.name + '  ·  ' : '') + (def.subtitle || ''), 'course'), 'hud.toast');
  }

  /* ======================================================================
   * Title -> play
   * ====================================================================*/

  /** NEW GAME: wipe the save, then take the controls in the Keep. This click IS the audio gesture. */
  newGame() {
    this.startAudio();
    safe(() => this.save.reset(), 'save.reset');
    this._refreshGateState();
    this._refreshCrestGot();
    this._startFromTitle(true);
  }

  /** CONTINUE: keep the save, take the controls. */
  continueGame() {
    this.startAudio();
    this._startFromTitle(false);
  }

  /** Generic PLAY (a menu with one button). Continues when a save exists. */
  startGame() { this.continueGame(); }
  play() { this.startGame(); }
  start() { this.startGame(); }

  _startFromTitle(fresh) {
    safe(() => this.menu && this.menu.close(), 'menu.close');
    const target = this._pendingCourse;
    this._pendingCourse = null;
    if (target && target !== KEEP_ID && isCourseId(target)) {
      this.loadCourse(target).catch(() => {});
      return;
    }
    if (this.courseId === KEEP_ID && this.course) {
      this._handOverControl();
      this._queueGateUnlocks(false);
      if (fresh) safe(() => this.hud && this.hud.toast('THE KEEP', 'FIND THE PAINTINGS', 'course'), 'hud.toast');
      else {
        const t = safe(() => this.save.totals(), 'save.totals');
        if (t && t.crests > 0) safe(() => this.hud && this.hud.toast('WELCOME BACK', t.crests + ' CREST' + (t.crests === 1 ? '' : 'S') + ' FOUND', 'course'), 'hud.toast');
      }
      return;
    }
    this.returnToKeep().catch(() => {});
  }

  startAudio() {
    if (this._audioStarted || !this.audio) return;
    this._audioStarted = true;
    safe(() => this.audio.init(), 'audio.init');
    safe(() => this.audio.setTheme(this.themeId), 'audio.setTheme');
    this._applySettings();
  }

  toTitle() {
    this._cancelDeath();
    this._endCinematic(true);
    this._endClear(true);
    this._endGateOpen(true);
    this.state = 'title';
    this._timerRun = false;
    this._setPrompt('', '');
    if (this.input) { this._suspendInput(true); safe(() => this.input.releaseLock(), 'releaseLock'); }
    safe(() => this.hud && this.hud.setVisible(false), 'hud.setVisible');
    safe(() => this.menu && this.menu.open('title'), 'menu.open');
    if (this.courseId !== KEEP_ID) this.loadCourse(KEEP_ID, { toTitle: true }).catch(() => {});
  }
  quitToTitle() { this.toTitle(); }

  /* ======================================================================
   * Pause — ESC toggles; lock/focus loss PAUSES ONLY (header)
   * ====================================================================*/
  pause(reason) {
    if (this.state !== 'playing' && this.state !== 'keep') return;
    if (this._deathT >= 0) return;                    // never mid-death sequence
    this._prePauseState = this.state;
    this._wasLockedAtPause = !!(this.input && this.input.pointerLocked);
    this.state = 'paused';
    this._timerRun = false;
    if (this.input) { this._suspendInput(true); if (reason !== 'unlock') safe(() => this.input.releaseLock(), 'releaseLock'); }
    this._setPrompt('', '');
    safe(() => this.audio && this.audio.duck(400), 'audio.duck');
    safe(() => this.menu && this.menu.open('pause'), 'menu.open(pause)');
  }

  resume() {
    if (this.state !== 'paused') return;
    safe(() => this.menu && this.menu.close(), 'menu.close');
    this.state = this._prePauseState === 'keep' ? 'keep' : 'playing';
    /* The clock belongs to whichever authored sequence is still running. */
    this._timerRun = this._cineT < 0 && this._deathT < 0 && this._clearT < 0 && this._gateOpenT < 0;
    if (this._cineT >= 0) this.state = 'cinematic';
    this._suspendInput(false);
    /* Only ever re-request the lock the player HAD — and only inside the gesture
       that resumed (this call), where the browser will honour it. */
    if (this._wasLockedAtPause && this.input) safe(() => this.input.requestLock(), 'requestLock');
    this._wasLockedAtPause = false;
  }
  unpause() { this.resume(); }

  togglePause() {
    if (this.state === 'paused') this.resume();
    else this.pause('toggle');
  }

  openSettings() { safe(() => this.menu && this.menu.open('settings'), 'menu.open'); }
  openControls() { safe(() => this.menu && this.menu.open('controls'), 'menu.open'); }
  openCredits() { safe(() => this.menu && this.menu.open('credits'), 'menu.open'); }

  toggleMute() {
    this.muted = !this.muted;
    this._applySettings();
    safe(() => this.hud && this.hud.toast(this.muted ? 'MUTED' : 'SOUND ON', '', 'info'), 'hud.toast');
    return this.muted;
  }

  toggleFullscreen() {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else (document.documentElement.requestFullscreen && document.documentElement.requestFullscreen());
    } catch (e) { /* not allowed outside a gesture */ }
  }

  toggleCamMode() {
    const S = this.settings || Settings;
    const s = safe(() => S.get(), 'settings.get') || {};
    const next = s.camMode === 'free' ? 'follow' : 'free';
    safe(() => S.set({ camMode: next }), 'settings.set');
    if (this.cam && typeof this.cam.setMode === 'function') safe(() => this.cam.setMode(next), 'cam.setMode');
    else if (this.cam) this.cam.mode = next;
    safe(() => this.hud && this.hud.toast('CAMERA', next === 'free' ? 'FREE ORBIT' : 'FOLLOW', 'info'), 'hud.toast');
    safe(() => this.audio && this.audio.sfx('ui_move'), 'audio.sfx');
    return next;
  }

  /* ======================================================================
   * Death loop — contract §28: REWIND, median ≤ 700 ms, never rebuilds the course.
   * ====================================================================*/
  onDeath(cause) {
    if (this._deathT >= 0) return;                    // already dying
    if (this.noclip) return;                          // dev fly-through is immune
    if (!this._isLive()) return;                      // a clear / card / cinematic is not a death

    const c = typeof cause === 'string' && cause ? cause : 'void';
    this.deaths++;
    this.courseDeaths++;
    if (this.courseId && this.courseId !== KEEP_ID) safe(() => this.save.addDeath(this.courseId), 'save.addDeath');
    this._beginRespawn(true, c);
  }

  /** Contract §28 `respawn()` — back to the last checkpoint, no death counted. */
  respawn() {
    if (this._deathT >= 0 || !this._isLive()) return;
    if (!this._cooldown('respawn')) return;
    this._beginRespawn(false, 'manual');
  }

  _beginRespawn(isDeath, cause) {
    this._killVeilTween();                            // the sequence drives the veil frame-exactly
    this._deathStartedAt = nowMs();
    this.state = 'dead';
    this._deathCause = cause || 'void';
    this._deathSoft = !isDeath;
    this._deathSwapped = false;
    this._deathIsRewinding = false;
    this._deathSeeded = false;
    this._deathT = isDeath ? 0 : T_SOFT_START;
    this._timerRun = false;
    this._setPrompt('', '');
    this._setReticle(false);
    this._gateDwell = 0;
    this._suspendInput(true);
    this._setVeilColor(this._veilColorFor(this.themeId));
    this._captureHistory();
    this._moodWanted = 'danger';

    if (isDeath) {
      /* THE FELT DEATH IS IMPACTS' JOB: the cause-coloured flash, the hit-stop,
         the death cam, the burst, the duck and the death hit are one call. Game
         keeps the TIMELINE. */
      const p = this.player ? this.player.pos : _v1.set(0, 0, 0);
      if (this.impacts && typeof this.impacts.death === 'function') {
        safe(() => this.impacts.death(this._deathCause, p), 'impacts.death');
      } else {
        const post = this.engine && this.engine.post;
        if (post && post.pulse) safe(() => post.pulse(0.85, D_HIT), 'post.pulse');
        safe(() => this.cam && this.cam.setDeathCam(true), 'cam.setDeathCam');
        safe(() => this.cam && this.cam.shake && this.cam.shake(0.55, 220), 'cam.shake');
        if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('death', p), 'fx.burst');
        safe(() => this.audio && this.audio.sfx('death'), 'audio.sfx');
        safe(() => this.audio && this.audio.duck(700), 'audio.duck');
      }
      safe(() => this.audio && this.audio.stinger('death'), 'audio.stinger');
      safe(() => this.hud && this.hud.deathFlash(this._deathCause), 'hud.deathFlash');
      if (this.input && this.input.gamepad && typeof this.input.gamepad.rumble === 'function') safe(() => this.input.gamepad.rumble(1, 0.6, 260), 'rumble');
    } else {
      safe(() => this.audio && this.audio.duck(260), 'audio.duck');
    }
  }

  /**
   * Snapshot the player's history ring into a flat buffer, newest LAST. The Ring
   * order is not specified by the contract, so it is detected once per death
   * (whichever end sits closest to the death position is the newest sample).
   */
  _captureHistory() {
    this._rewindN = 0;
    const p = this.player;
    const ring = p && p.history;
    if (!ring || typeof ring.at !== 'function') return;
    const n = Math.min(ring.length | 0, this._rewindBuf.length >> 2);
    if (n < 2) return;
    const first = ring.at(0), last = ring.at(n - 1);
    if (!first || !last) return;
    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
    const dF = (first.x - px) ** 2 + (first.y - py) ** 2 + (first.z - pz) ** 2;
    const dL = (last.x - px) ** 2 + (last.y - py) ** 2 + (last.z - pz) ** 2;
    const newestFirst = dF < dL;
    const buf = this._rewindBuf;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const s = ring.at(newestFirst ? n - 1 - i : i);
      if (!s || !isNum(s.x) || !isNum(s.y) || !isNum(s.z)) continue;
      buf[w * 4] = s.x; buf[w * 4 + 1] = s.y; buf[w * 4 + 2] = s.z; buf[w * 4 + 3] = isNum(s.facing) ? s.facing : (p.facing || 0);
      w++;
    }
    this._rewindN = w;
  }

  /** Move the hero along the captured ring, newest → oldest, u = 1 → 0. */
  _applyRewind(u) {
    const hero = this.hero;
    const n = this._rewindN;
    if (!hero || !hero.root || n < 2) return;
    const buf = this._rewindBuf;
    const f = clamp(u, 0, 1) * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const k = f - i0;
    const root = hero.root;
    root.position.set(
      lerp(buf[i0 * 4], buf[i1 * 4], k),
      lerp(buf[i0 * 4 + 1], buf[i1 * 4 + 1], k),
      lerp(buf[i0 * 4 + 2], buf[i1 * 4 + 2], k),
    );
    const a = buf[i0 * 4 + 3], b = buf[i1 * 4 + 3];
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    root.rotation.y = a + d * k;
    if (typeof hero.rewindPose === 'function') safe(() => hero.rewindPose(1 - u), 'hero.rewindPose');
    else if (typeof hero.setLimp === 'function') safe(() => hero.setLimp(true), 'hero.setLimp');
  }

  _setRewindGrade(k) {
    const v = clamp(k, 0, 1);
    if (Math.abs(v - this._rewindK) < 0.004 && v !== 0 && v !== 1) return;
    this._rewindK = v;
    const tr = this.transitions;
    if (tr && typeof tr.setRewind === 'function') safe(() => tr.setRewind(v), 'transitions.setRewind');
    const post = this.engine && this.engine.post;
    if (post && typeof post.setRewind === 'function') safe(() => post.setRewind(v), 'post.setRewind');
    else if (post && typeof post.setDesaturate === 'function') safe(() => post.setDesaturate(v), 'post.setDesaturate');
    if (this.el) this.el.veil.classList.toggle('rewind', v > 0.02);
  }

  _stepDeath(ms) {
    /* The death clock is ANCHORED to the kill instant, not to the frames after
       it: the kill is detected below the presentation steppers, so the first
       step also owns the part of that frame which had already elapsed. Without
       this the sequence loses up to a whole frame — 18 ms at the perf budget,
       but most of a second on a stalling frame, which is exactly where
       `lastRespawnMs` (wall clock) used to overshoot its ceiling. */
    if (this._deathSeeded) {
      this._deathT += ms;
    } else {
      this._deathSeeded = true;
      const since = nowMs() - this._deathStartedAt;
      this._deathT += (isNum(since) && since > ms) ? Math.min(since, MAX_PRESENT_MS) : ms;
    }
    const t = this._deathT;

    /* --- rewind ghost (90..310) --- */
    if (!this._deathSoft) {
      if (t >= T_REWIND_START && t < T_REWIND_END) {
        if (!this._deathIsRewinding) {
          this._deathIsRewinding = true;
          if (this.fx && typeof this.fx.burst === 'function' && this.player) safe(() => this.fx.burst('deathRewind', this.player.pos), 'fx.burst');
          safe(() => this.audio && this.audio.sfx('vanish_warn'), 'audio.sfx');
          if (typeof this.hero.setLimp === 'function') safe(() => this.hero.setLimp(true), 'hero.setLimp');
        }
        const k = (t - T_REWIND_START) / D_REWIND;
        this._applyRewind(1 - easeInOutCubic(k));
        this._setRewindGrade(smoothstep(0, 1, k * 2.2));
      } else if (t >= T_REWIND_END && this._deathIsRewinding && !this._deathSwapped) {
        this._applyRewind(0);
        this._setRewindGrade(1);
      }
    }

    /* --- veil: iris closes 310..420, opens 420..620 (centred on the hero) --- */
    const swapping = !this._deathSwapped && t >= T_SWAP;
    let a;
    if (swapping) a = 1;                                  // the swap frame is FULLY covered
    else if (t < T_REWIND_END) a = 0;
    else if (t < T_SWAP) { this._aimVeilAtHero(); a = smoothstep(0, 1, (t - T_REWIND_END) / D_COVER); }
    else a = 1 - easeOutCubic(clamp((t - T_SWAP) / D_REVEAL, 0, 1));
    this._setVeil(clamp(a, 0, 1), 'iris');
    if (t >= T_SWAP) this._setRewindGrade(1 - clamp((t - T_SWAP) / D_REVEAL, 0, 1));

    /* The swap happens at full cover — one frame, no course rebuild. */
    if (swapping) {
      this._deathSwapped = true;
      this._performRespawn();
      return;                                         // reveal starts next frame
    }

    /* End on the NEAREST frame to the budget rather than the first frame past it. */
    if (t >= T_DEATH_END - ms * 0.5) {
      this._deathT = -1;
      this._deathSoft = false;
      this._deathIsRewinding = false;
      this._setVeil(0);
      this._setRewindGrade(0);
      if (this.engine && this.engine.post && this.engine.post.setDamage) safe(() => this.engine.post.setDamage(0), 'post.setDamage');
      this.state = this.courseId === KEEP_ID ? 'keep' : 'playing';
      this._timerRun = true;
      this._moodWanted = 'explore';
      const total = nowMs() - this._deathStartedAt;
      this.lastDeathTimeline.total = total;
    }
  }

  /** Runs under full cover: rewind hazards, re-place the player, restore the camera + input. */
  _performRespawn() {
    if (this._pendingFullReset) this._fullCourseReset();
    const cp = this.cpIndex;
    if (this.course) {
      /* resetFrom rewinds the course clock so the gauntlet presents the same phase
         every attempt — that is what makes it learnable (determinism law). */
      safe(() => this.course.resetFrom(cp), 'course.resetFrom');
    }
    const sp = this._spawnFor(cp);
    if (this.player) {
      safe(() => this.player.respawn(sp.pos, sp.yaw), 'player.respawn');
      this._ncPos.copy(this.player.pos);
    }
    this._clearPower();
    if (this.hero) {
      if (typeof this.hero.setLimp === 'function') safe(() => this.hero.setLimp(false), 'hero.setLimp');
      if (typeof this.hero.snap === 'function') safe(() => this.hero.snap(this.player), 'hero.snap');
      safe(() => this.hero.update(0, this.player), 'hero.update(0)');
    }
    safe(() => this.cam && this.cam.setDeathCam(false), 'cam.setDeathCam');
    safe(() => this.cam && this.cam.recenter(), 'cam.recenter');
    safe(() => this.cam && this.cam.update(0), 'cam.update(0)');
    if (this.engine && typeof this.engine.followShadow === 'function' && this.player) safe(() => this.engine.followShadow(this.player.renderPos || this.player.pos), 'followShadow');
    /* The camera is back — hand the controls over immediately. */
    if (this.input) {
      safe(() => this.input.clear && this.input.clear(), 'input.clear');
      this._suspendInput(false);
    }
    const now = nowMs();
    this.lastRespawnMs = now - this._deathStartedAt;
    this.lastDeathTimeline.hit = D_HIT;
    this.lastDeathTimeline.rewind = this._deathSoft ? 0 : D_REWIND;
    this.lastDeathTimeline.swap = this.lastRespawnMs;
  }

  _cancelDeath() {
    if (this._deathT < 0) return;
    this._deathT = -1;
    this._deathSoft = false;
    this._deathSwapped = false;
    this._deathIsRewinding = false;
    this._setRewindGrade(0);
    if (this.hero && typeof this.hero.setLimp === 'function') safe(() => this.hero.setLimp(false), 'hero.setLimp');
    safe(() => this.impacts && this.impacts.cancelDeath && this.impacts.cancelDeath(), 'impacts.cancelDeath');
    if (this.engine && this.engine.post && this.engine.post.setDamage) safe(() => this.engine.post.setDamage(0), 'post.setDamage');
    safe(() => this.cam && this.cam.setDeathCam(false), 'cam.setDeathCam');
  }

  /** Project the hero to the screen so the iris closes on Nim, not on the screen centre. */
  _aimVeilAtHero() {
    const cam = this.engine && this.engine.camera;
    const p = this.hero && this.hero.root ? this.hero.root.position : (this.player ? this.player.pos : null);
    if (!cam || !p) { this._veilCx = 50; this._veilCy = 50; return; }
    _v3.copy(p); _v3.y += 0.8;
    _v3.project(cam);
    if (_v3.z > 1 || !isNum(_v3.x) || !isNum(_v3.y)) { this._veilCx = 50; this._veilCy = 50; return; }
    this._veilCx = clamp((_v3.x * 0.5 + 0.5) * 100, 8, 92);
    this._veilCy = clamp((0.5 - _v3.y * 0.5) * 100, 8, 92);
  }

  /**
   * Where the player stands and faces for a checkpoint index. `out.yaw` follows
   * the contract's one convention (yaw 0 faces −Z), which is also the controller's,
   * so no conversion happens here — course.spawnFor already returns it.
   */
  _spawnFor(cpIndex) {
    const out = this._spawnOut;
    let got = null;
    if (this.course && typeof this.course.spawnFor === 'function') got = safe(() => this.course.spawnFor(cpIndex | 0), 'course.spawnFor');
    if (got) { toVec3(got.pos !== undefined ? got.pos : got, out.pos); out.yaw = yawOf(got, 0); return out; }
    const def = this.def;
    const cps = (this.course && this.course.checkpoints) || (def && def.checkpoints) || EMPTY_ARRAY;
    const cp = cpIndex > 0 ? cps[cpIndex] : null;
    if (cp) { toVec3(cp, out.pos); out.yaw = yawOf(cp, 0); return out; }
    toVec3(def && def.spawn ? def.spawn : null, out.pos);
    out.yaw = yawOf(def && def.spawn, 0);
    return out;
  }

  /* ======================================================================
   * Checkpoints
   * ====================================================================*/
  onCheckpoint(i) {
    const idx = i | 0;
    if (!this.course || idx <= this.cpIndex || !this._isLive()) return;   // never backwards, idempotent
    const cps = this.course.checkpoints || EMPTY_ARRAY;
    if (idx >= cps.length) return;

    this.cpIndex = idx;
    if (this.courseId && this.courseId !== KEEP_ID) safe(() => this.save.setCheckpoint(this.courseId, idx), 'save.setCheckpoint');

    safe(() => this.hud && this.hud.checkpointFlash(idx, cps.length - 1), 'hud.checkpointFlash');
    if (this.courseId !== KEEP_ID) {
      safe(() => this.hud && this.hud.toast('CHECKPOINT ' + idx + ' / ' + (cps.length - 1), fmtTime(this.timeMs / 1000), 'checkpoint'), 'hud.toast');
    }
    safe(() => this.audio && this.audio.sfx('checkpoint'), 'audio.sfx');
    safe(() => this.audio && this.audio.stinger('checkpoint'), 'audio.stinger');
    safe(() => this.cam && this.cam.punch && this.cam.punch(0.05), 'cam.punch');
    const cp = cps[idx];
    if (cp && typeof cp.light === 'function') safe(() => cp.light(true), 'cp.light');
    if (this.fx && typeof this.fx.burst === 'function') { toVec3(cp, _v1); safe(() => this.fx.burst('checkpoint', _v1), 'fx.burst'); }
  }

  /**
   * Belt to the event's braces: the course's OWN checkpoint volumes tested here
   * against the feet. Idempotent by index with onCheckpoint, so a controller that
   * also raises 'checkpoint' can never double-fire; a controller that does not,
   * still gets checkpoints.
   */
  _checkCheckpointVolumes() {
    if (!this.player || this._cpCount === 0) return;
    const pp = this.player.pos;
    const vols = this._cpVolumes;
    const cps = this.course.checkpoints;
    for (let i = this.cpIndex + 1; i < this._cpCount; i++) {
      const v = vols[i];
      let inside = false;
      if (v) inside = !!v.contains(pp);
      else {
        const cp = cps[i];
        if (!cp) continue;
        toVec3(cp, _v1);
        const dx = pp.x - _v1.x, dz = pp.z - _v1.z, dy = pp.y - _v1.y;
        inside = dx * dx + dz * dz < 1.44 && dy > -0.6 && dy < 1.6;
      }
      if (inside) { this.onCheckpoint(i); return; }
    }
  }

  /* ======================================================================
   * Crests — the celebration and the clear card (contract §28)
   * ====================================================================*/
  onCrest(def) {
    if (!def || !this._isLive() || this._clearT >= 0) return;
    const crestId = def.id || 'open';
    const courseId = this.courseId;
    if (!courseId || courseId === KEEP_ID) return;

    const epochBefore = this._epoch;
    const ms = Math.round(this.timeMs);
    const rec = safe(() => this.save.course(courseId), 'save.course') || {};
    const wasCleared = !!rec.cleared;
    const prevBest = rec.bestMs && isNum(rec.bestMs[crestId]) ? rec.bestMs[crestId] : null;
    const already = Array.isArray(rec.crests) && rec.crests.indexOf(crestId) !== -1;
    const isBest = prevBest === null || ms < prevBest;

    safe(() => this.save.collectCrest(courseId, crestId), 'save.collectCrest');
    if (isBest) safe(() => this.save.setBestMs(courseId, crestId, ms), 'save.setBestMs');
    if (this._collectibles && this._collectibles.counts && isNum(this._collectibles.counts.coins)) {
      const coins = this._collectibles.counts.coins;
      if (coins > (isNum(rec.coinsBest) ? rec.coinsBest : 0)) safe(() => this.save.setCoinsBest(courseId, coins), 'save.setCoinsBest');
    }
    this._refreshCrestGot();
    if (epochBefore !== this._epoch) return;

    /* ---- the celebration ---- */
    this.state = 'clear';
    this._clearT = 0;
    this._clearDef = def;
    this._clearResolved = false;
    this._timerRun = false;
    this._setPrompt('', '');
    this._setReticle(false);
    this._moodWanted = 'clear';
    if (this.input) safe(() => this.input.clear && this.input.clear(), 'input.clear');
    this._suspendInput(true);

    const rec2 = safe(() => this.save.course(courseId), 'save.course') || {};
    const nowGot = Array.isArray(rec2.crests) ? rec2.crests.length : 0;
    const total = safe(() => this.save.crestTotal(), 'save.crestTotal') | 0;
    const summary = {
      courseId, courseName: (this.def && this.def.name) || courseId.toUpperCase(),
      realmName: (realmOf(courseId) || {}).name || '',
      crestId, crestName: def.name || crestId.toUpperCase(), crestType: def.type || 'open',
      timeMs: ms, best: isBest ? ms : prevBest, prevBest, isNewBest: isBest, alreadyHad: already,
      par: this.def && this.def.par && isNum(this.def.par[crestId]) ? this.def.par[crestId] : 0,
      underPar: this.def && this.def.par && isNum(this.def.par[crestId]) ? ms <= this.def.par[crestId] : false,
      crests: nowGot, crestsTotal: this._crestDefs.length || 7, crestTotal: total,
      /* ONE scope (this run) and ONE denominator (the crest threshold) — the
         same pair the HUD chip and the pause header show. `coinsPlaced` stays
         for anything that wants the count authored into the course, but no
         surface prints it as the coin goal. */
      coins: this.coins,
      coinsTotal: this.coinsGoal,
      coinsPlaced: this._collectibles && this._collectibles.counts ? this._collectibles.counts.coinsTotal | 0 : 0,
      sigils: this._collectibles && this._collectibles.counts ? this._collectibles.counts.sigils | 0 : 0,
      deaths: this.courseDeaths, totalDeaths: this.deaths, sessionMs: Math.round(this.sessionMs),
      firstClear: !wasCleared,
      newlyUnlocked: this._newlyUnlockedAt(total),
      onStay: () => this._resolveClear('stay'),
      onReturn: () => this._resolveClear('keep'),
    };
    this._clearSummary = summary;

    /* Pedestal position: the crest def's own p / spawnAt, else where Nim stands. */
    const pos = _v2;
    if (def.pedestal) toVec3(def.pedestal, pos);
    else if (def.p) toVec3(def.p, pos);
    else if (def.spawnAt) toVec3(def.spawnAt, pos);
    else if (this.player) pos.copy(this.player.pos);
    if (this.impacts && typeof this.impacts.collect === 'function') safe(() => this.impacts.collect('crestGrand', pos), 'impacts.collect');
    else if (this.fx && typeof this.fx.burst === 'function') safe(() => this.fx.burst('crestGrand', pos), 'fx.burst');
    safe(() => this.audio && this.audio.stinger('crest'), 'audio.stinger');
    safe(() => this.audio && this.audio.duck(900), 'audio.duck');
    safe(() => this.hud && this.hud.crestGet(def), 'hud.crestGet');
    if (this.engine && this.engine.post) {
      safe(() => this.engine.post.pulse && this.engine.post.pulse(0.45, 260), 'post.pulse');
      /* A celebration GLOW, not a whiteout. MEASURED on verdant-1 at the same
         orbit frame: x1.9 strength put the frame at mean luminance 186.9 with
         53 % of pixels over 200 (normal play is 83 / 5 %); the theme's own
         strength at that moment measures 158 / 38 %. x1.25 keeps the lift
         readable as "the world brightened" without taking the sky, the hills
         and the HUD's own timer with it. */
      const bl = (this.theme && this.theme.bloom) || null;
      if (bl && this.engine.post.setBloom) safe(() => this.engine.post.setBloom({
        strength: (isNum(bl.strength) ? bl.strength : 0.6) * 1.25, radius: isNum(bl.radius) ? bl.radius : 0.5, threshold: isNum(bl.threshold) ? bl.threshold : 0.75,
      }), 'post.setBloom');
    }
    if (this.input && this.input.gamepad && typeof this.input.gamepad.rumble === 'function') safe(() => this.input.gamepad.rumble(0.8, 0.8, 400), 'rumble');
    if (this.hero && typeof this.hero.celebrate === 'function') safe(() => this.hero.celebrate(CLEAR_ORBIT_MS / 1000), 'hero.celebrate');
    this._buildOrbit(pos);
    safe(() => this.cam && this.cam.setCinematic(this._orbitPath), 'cam.setCinematic');
  }

  /**
   * Camera orbit for the crest celebration: 2.2 s, a rising sweep of ~300 deg
   * that ends over Nim's shoulder - STAGED AGAINST THE WORLD AND AGAINST BOTH
   * SUBJECTS, not against a circle.
   *
   * The keys used to be pure trigonometry (`ang = base + PI + k*PI*1.65`,
   * `r = 4.6 - k*1.4`, look at the crest) handed straight to
   * `cam.setCinematic()`, which by design bypasses the follow camera's whisker
   * pull-in. So the one shot in the game that exists to show the hero was the
   * one shot with no occlusion response and no idea where the hero was.
   *
   * MEASURED on a real contact collect of verdant-1's 'open' crest
   * (_harness/_uiorb3.py): the crest sits at [9.2, 19.30, -32.8] and NIM ends
   * the walk-in at [9.2, 18.15, -32.3] - 2.05 m BELOW the look target. Every
   * ray from the crest anchor to every orbit key was clear (broadphase AND a
   * raycast over the 127 visible course meshes: 9 of 9 null), and the shot was
   * still wrong, because the ray that matters - lens to NIM - was blocked by
   * `merged_cb.copper.verdant` at 3.06 m of 4.67 m. A spire poking up between
   * a high lens and a hero standing below it.
   *
   * So the stager now:
   *   1. frames BOTH subjects - the look target is the midpoint of the crest
   *      burst and Nim's chest, so neither can leave the frame;
   *   2. tests every candidate key from BOTH anchors, with the follow camera's
   *      own `probeClear` (colliders, the probe camcheck gates) AND a raycast
   *      over the course's visible opaque meshes, because the occluder that
   *      broke this shot is DECORATION and carries no collider;
   *   3. searches a ladder of lens DROPS before radius pull-ins - dropping the
   *      lens toward the subjects clears an up-poking spire where pulling in
   *      never can - starting each key at its neighbour's accepted rung so the
   *      dolly stays smooth;
   *   4. keeps the least-bad candidate when nothing is fully clear, and never
   *      stages below Nim's feet or inside `CLEAR_ORBIT_MIN_R`.
   *
   * Runs ONCE per crest, never per frame, under a hard ray budget.
   */
  _buildOrbit(center) {
    const path = this._orbitPath;
    const cam = this.cam;
    const base = cam && isNum(cam.yaw) ? cam.yaw : 0;

    const crest = _orbCrest.set(center.x, center.y + CLEAR_ORBIT_LOOK_Y, center.z);
    const hero = _orbHero.copy(crest);
    let feetY = center.y;
    const hp = this.player && this.player.pos ? this.player.pos : null;
    if (hp && isNum(hp.x)) { hero.set(hp.x, hp.y + CLEAR_ORBIT_HERO_Y, hp.z); feetY = hp.y; }
    const look = _orbLook.copy(crest).add(hero).multiplyScalar(0.5);
    const floorY = Math.min(feetY, crest.y - CLEAR_ORBIT_HERO_Y) + 0.55;

    this._collectOrbitMeshes(look);
    this._orbRays = 0;
    const tStart = nowMs();
    /* One deadline for the whole pass, not a per-key share: the hardest key is
       usually the FIRST one (it derives the staging the rest inherit), and a
       per-key share starved it - measured, keys 0-3 came back at hero scores
       0.29-0.46 where a shared deadline had them clear. */
    const tEnd = tStart + CLEAR_ORBIT_MS_BUDGET;

    let prevD = 0, prevF = 1;
    for (let i = 0; i < CLEAR_ORBIT_KEYS; i++) {
      const k = i / (CLEAR_ORBIT_KEYS - 1);
      const ang = base + Math.PI + k * Math.PI * 1.65;
      const sx = -Math.sin(ang), sz = -Math.cos(ang);
      const r0 = CLEAR_ORBIT_RADIUS - k * 1.4;
      const y0 = look.y + CLEAR_ORBIT_RISE - k * 0.7;
      const bx = center.x + sx * r0, bz = center.z + sz * r0;

      let bestScore = -1, bestD = prevD, bestF = prevF;
      _orbBest.set(bx, Math.max(floorY, y0), bz);

      /* (a) INHERIT the neighbour's staging first: one ray, and it almost
         always holds, because consecutive keys are 0.6 m apart on a 2.2 s
         sweep. Restarting every key from the nominal ring instead burned the
         whole budget re-deriving the same answer nine times - MEASURED: the
         pass ran 207.7 ms and still left keys 7 and 8 unstaged. */
      if ((prevD !== 0 || prevF < 0.999) && nowMs() < tEnd) {
        const py = y0 + CLEAR_ORBIT_DROPS[prevD];
        if (py >= floorY) {
          const ox = bx - look.x, oy = py - look.y, oz = bz - look.z;
          const dl = Math.sqrt(ox * ox + oy * oy + oz * oz);
          const f = dl > 1e-3 ? Math.min(1, Math.max(prevF, CLEAR_ORBIT_MIN_R / dl)) : 1;
          let ff = f;
          _orbCand.set(look.x + ox * ff, Math.max(floorY, look.y + oy * ff), look.z + oz * ff);
          let sc = this._stageScore(hero, crest, _orbCand);
          if (sc > bestScore) { bestScore = sc; bestD = prevD; bestF = ff; _orbBest.copy(_orbCand); }
          /* and let a near-miss CONVERGE from here rather than restarting the
             whole ladder at the nominal ring - that restart is what kept the
             pass at ~10 rays per key. */
          for (let it = 0; it < CLEAR_ORBIT_PULL_ITERS && sc < CLEAR_ORBIT_ACCEPT && nowMs() < tEnd; it++) {
            const t = this._orbHit;
            if (t < 0) break;
            const dcur = dl * ff;
            const shrink = Math.max(CLEAR_ORBIT_MIN_R / dcur, (dcur - (t + CLEAR_ORBIT_PULL_PAD)) / dcur);
            if (shrink >= 0.995) break;
            ff *= shrink;
            _orbCand.set(look.x + ox * ff, Math.max(floorY, look.y + oy * ff), look.z + oz * ff);
            sc = this._stageScore(hero, crest, _orbCand);
            if (sc > bestScore) { bestScore = sc; bestD = prevD; bestF = ff; _orbBest.copy(_orbCand); }
          }
        }
      }

      for (let n = 0; n < CLEAR_ORBIT_DROPS.length && bestScore < CLEAR_ORBIT_ACCEPT && nowMs() < tEnd; n++) {
        /* Start at the rung the previous key settled on and wrap - temporal
           coherence (the dolly reads as a move, not a cut) AND full coverage.
           The zigzag this replaces could not reach the outer rungs at all. */
        const di = (prevD + n) % CLEAR_ORBIT_DROPS.length;
        const py = y0 + CLEAR_ORBIT_DROPS[di];
        if (py < floorY) continue;
        const ox = bx - look.x, oy = py - look.y, oz = bz - look.z;
        const dlBase = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (!(dlBase > 1e-3)) continue;

        _orbCand.set(bx, py, bz);
        let sc = this._stageScore(hero, crest, _orbCand);
        let f = 1;
        if (sc > bestScore) { bestScore = sc; bestD = di; bestF = 1; _orbBest.copy(_orbCand); }

        /* COMPUTED PULL-IN, not a ladder of guesses. `_segScore` leaves the hit
           distance in `_orbHit`, so we know exactly how much clear air there is
           between the occluder and Nim: park the lens inside it, then re-probe
           and repeat, because the next thing in the way may be nearer still.
           MEASURED on verdant-1's 'open' crest (_shots/ui/_z_celeb_250.png):
           the tower's copper PYRAMID ROOF stood 2.75 m in front of a lens 4.5 m
           out. No lens DROP clears a roof that runs to the ground, and no fixed
           radius scale lands reliably in the 1.75 m of air behind it - only the
           measurement does. */
        for (let it = 0; it < CLEAR_ORBIT_PULL_ITERS && sc < CLEAR_ORBIT_ACCEPT && nowMs() < tEnd; it++) {
          const t = this._orbHit;
          if (t < 0) break;
          const dl = dlBase * f;
          const shrink = Math.max(CLEAR_ORBIT_MIN_R / dl, (dl - (t + CLEAR_ORBIT_PULL_PAD)) / dl);
          if (shrink >= 0.995) break;               // already as tight as it may go
          f *= shrink;
          _orbCand.set(look.x + ox * f, Math.max(floorY, look.y + oy * f), look.z + oz * f);
          sc = this._stageScore(hero, crest, _orbCand);
          if (sc > bestScore) { bestScore = sc; bestD = di; bestF = f; _orbBest.copy(_orbCand); }
        }
      }
      prevD = bestD; prevF = bestF;

      const key = path.cam[i];
      key.p[0] = _orbBest.x; key.p[1] = _orbBest.y; key.p[2] = _orbBest.z;
      key.look[0] = look.x; key.look[1] = look.y; key.look[2] = look.z;
      key.t = k * CLEAR_ORBIT_MS / 1000;
    }
    /* Staging cost, kept for the harness the way `lastRespawnMs` is: this pass
       raycasts, and a silent regression here is a hitch on every crest. */
    this.lastOrbitStageMs = nowMs() - tStart;
  }

  /**
   * @private How well one candidate lens position frames the pair: 1 when both
   * anchors see it, otherwise the worst anchor's clear fraction of the way. The
   * hero anchor is tested FIRST and short-circuits, because it is the one that
   * fails - the crest, floating clear of the level, almost never does.
   */
  _stageScore(hero, crest, p) {
    const a = this._segScore(hero, p);
    /* Hero first, and a hero-blocked key can never outscore a hero-clear one —
       the reject this fixes is "Nim is never on screen", so a lens that sees
       him and half the pedestal beats one that frames the pedestal perfectly
       with him behind a roof. The crest ray is only paid for once the hero is
       already clear, which is what keeps the pass inside its time budget. */
    if (a < 1) return a * CLEAR_ORBIT_ACCEPT * 0.98;   // _orbHit = the hero leg's blocker
    const hHit = this._orbHit;
    const out = CLEAR_ORBIT_ACCEPT + (1 - CLEAR_ORBIT_ACCEPT) * this._segScore(crest, p);
    this._orbHit = hHit;                               // the pull-in only ever chases the hero
    return out;
  }

  /**
   * @private 1 when the LENS at `p` can see the subject at `anchor`, else the
   * fraction of the way the view survives.
   *
   * The ray is cast LENS -> SUBJECT, which is the actual line of sight and not
   * a stylistic choice: course meshes render `side: FrontSide`, and
   * `Raycaster` honours that, so a ray leaving the subject and exiting through
   * a roof's UNDERSIDE reports nothing. MEASURED during a live celebration
   * (_harness/_uiceleb4.py diag): hero -> key1 over the very same 24-mesh probe
   * list returned `listHit: []` while key1 -> hero over the same segment hit
   * `merged_cb.copper.verdant` at 2.75 m of 4.46 m. Same segment, opposite
   * direction, opposite verdict — cast the way the camera looks.
   */
  _segScore(anchor, p) {
    _orbDir.set(anchor.x - p.x, anchor.y - p.y, anchor.z - p.z);
    const d = _orbDir.length();
    if (!(d > 1e-4)) return 0;
    _orbDir.multiplyScalar(1 / d);
    _orbFrom.set(p.x, p.y, p.z);
    const need = Math.max(0.05, d - CLEAR_ORBIT_SKIN);
    let hit = -1;
    const cam = this.cam;
    if (cam && typeof cam.probeClear === 'function' && this._orbRays < CLEAR_ORBIT_RAYS_MAX) {
      this._orbRays++;
      const t = cam.probeClear(_orbFrom, _orbDir, need);
      if (t >= 0) hit = t;
    }
    if (hit < 0) {
      const list = this._orbMeshes;
      if (list && list.length && this._orbRays < CLEAR_ORBIT_RAYS_MAX) {
        this._orbRays++;
        _orbRay.set(_orbFrom, _orbDir);
        _orbRay.near = 0.02; _orbRay.far = need;
        const hits = _orbRay.intersectObjects(list, false);
        for (let i = 0; i < hits.length; i++) {
          if (hits[i].distance > 0.05) { hit = hits[i].distance; break; }
        }
      }
    }
    this._orbHit = hit;
    if (hit < 0) return 1;
    /* Score the ABSOLUTE gap still in the way, not the ratio `hit / d`: pulling
       the lens in shrinks hit and d together, so the ratio barely moves and the
       search could not tell a 1.8 m pull-in from doing nothing. What actually
       improves is the distance between the blocker and the subject. */
    const gap = d - hit;
    return 1 - clamp(gap / CLEAR_ORBIT_GAP_M, 0, 1);
  }

  /**
   * @private Course meshes worth raycasting for the staging pass: visible,
   * opaque, non-instanced, not the collectible layer, and within
   * `CLEAR_ORBIT_PROBE_R` of the subject. The radius prefilter is what keeps
   * this affordable - the full visible set on verdant-1 is 127 meshes / 207k
   * triangles and costs ~6.5 ms per ray (measured, _harness/_uiorb2.py).
   */
  _collectOrbitMeshes(look) {
    let out = this._orbMeshes;
    if (!out) out = this._orbMeshes = [];
    out.length = 0;
    const root = this.course && this.course.group;
    if (!root) return out;
    const stack = this._orbStack || (this._orbStack = []);
    stack.length = 0;
    stack.push(root);
    const R = CLEAR_ORBIT_PROBE_R;
    while (stack.length) {
      const o = stack.pop();
      if (!o || o.visible === false) continue;
      /* PRUNE the subtree, which `traverseVisible` cannot do — a name check in
         its callback skips one node and still walks its children, which is how
         `crestGold` / `crestEnamel` ended up in the probe list. */
      if (o.name && ORBIT_SKIP_NODES.indexOf(o.name) >= 0) continue;
      /* Terrain is a heightfield the BROADPHASE already answers for, and its
         box spans the whole course, so every visual ray paid a full 39k-triangle
         test for an answer probeClear had already given. */
      if (o.name === 'terrain') continue;
      if (o.isMesh && !o.isInstancedMesh && o.geometry) {
        const m = o.material;
        const solid = !(m && !Array.isArray(m) && (m.transparent === true || m.visible === false));
        if (solid) {
          const g = o.geometry;
          if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { /* skip */ } }
          const bs = g.boundingSphere;
          if (bs) {
            _orbSphere.copy(bs).applyMatrix4(o.matrixWorld);
            if (_orbSphere.center.distanceTo(look) - _orbSphere.radius <= R) out.push(o);
          }
        }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) stack.push(ch[i]);
    }
    return out;
  }

  _stepClear(ms) {
    this._clearT += ms;
    const t = this._clearT;
    const pull = 1 - clamp(t / 900, 0, 1);
    this._fovPull = 7 * easeOutCubic(pull);
    if (t >= CLEAR_ORBIT_MS && !this._clearCardUp) {
      this._clearCardUp = true;
      safe(() => this.cam && this.cam.setCinematic(null), 'cam.setCinematic');
      safe(() => this.cam && this.cam.recenter(), 'cam.recenter');
      const s = this._clearSummary;
      let r = null;
      if (this.hud && typeof this.hud.courseClear === 'function') r = safe(() => this.hud.courseClear(s), 'hud.courseClear');
      if (r && typeof r.then === 'function') {
        const epoch = this._epoch;
        r.then((choice) => { if (epoch === this._epoch) this._resolveClear(choice === 'keep' || choice === 'return' || choice === 'returnToKeep' ? 'keep' : 'stay'); }).catch(() => {});
      } else if (!this.hud || typeof this.hud.courseClear !== 'function') {
        this._resolveClear('stay');                   // no card module: back to play
      }
    }
  }

  /** STAY (resume — the crest stays collected) or RETURN TO KEEP. Idempotent. */
  _resolveClear(choice) {
    if (this._clearT < 0 || this._clearResolved) return;
    this._clearResolved = true;
    safe(() => this.audio && this.audio.sfx('ui_ok'), 'audio.sfx');
    if (choice === 'keep') { this.returnToKeep({ cleared: true }).catch(() => {}); return; }
    this._endClear(false);
    this.state = 'playing';
    this._timerRun = true;
    this._suspendInput(false);
    this._moodWanted = 'explore';
    safe(() => this.hud && this.hud.toast('CARRY ON', (this._clearSummary ? this._clearSummary.crests : 0) + ' / 7 CRESTS', 'info'), 'hud.toast');
  }
  stay() { this._resolveClear('stay'); }
  onCourseClear() { this._resolveClear('keep'); }

  _endClear(silent) {
    if (this._clearT < 0 && !silent) return;
    this._clearT = -1;
    this._clearCardUp = false;
    this._clearDef = null;
    this._fovPull = 0;
    /* THE CARD COMES DOWN WITH THE SEQUENCE — every exit funnels through here. */
    safe(() => this.hud && this.hud.hideCourseClear && this.hud.hideCourseClear(), 'hud.hideCourseClear');
    safe(() => this.cam && this.cam.setCinematic(null), 'cam.setCinematic');
    if (this.engine && this.engine.post && this.engine.post.setBloom && this.theme && this.theme.bloom) {
      safe(() => this.engine.post.setBloom(this.theme.bloom), 'post.setBloom');
    }
  }

  /** Course ids whose gate this crest total just crossed (for the clear card). */
  _newlyUnlockedAt(total) {
    const prev = total - 1;
    const out = [];
    for (const id of Object.keys(COURSE_META)) {
      const g = COURSE_META[id].gateCrests;
      if (g > prev && g <= total && g > 0) out.push(id);
    }
    return out;
  }

  /* ======================================================================
   * Flow
   * ====================================================================*/
  async returnToKeep(opts) {
    const o = opts || {};
    const from = this.courseId && this.courseId !== KEEP_ID ? this.courseId : null;
    this._endClear(true);
    this._cancelDeath();
    if (from) safe(() => this.save.clearCheckpoint(from), 'save.clearCheckpoint');
    const r = await this.loadCourse(KEEP_ID, { fromCourse: from || undefined });
    if (o.cleared && this.hud && typeof this.hud.toast === 'function' && this._clearSummary) {
      const s = this._clearSummary;
      safe(() => this.hud.toast(s.courseName, s.crests + ' / ' + s.crestsTotal + ' CRESTS', 'success'), 'hud.toast');
    }
    return r;
  }

  /**
   * A restart is a respawn with a full course rewind — deferred to the covered
   * frame in _performRespawn so the player never sees the course pop.
   */
  restartCourse() {
    if (!this.course || this._loading) return;
    if (!this._cooldown('restart')) return;
    this._cancelDeath();
    this._endClear(true);
    this._endCinematic(true);
    this._endGateOpen(true);
    if (this.state === 'paused') this.resume();
    if (!this._isLive()) return;
    this._pendingFullReset = true;
    this._beginRespawn(false, 'restart');
    safe(() => this.hud && this.hud.toast(this.courseId === KEEP_ID ? 'BACK TO THE HALL' : 'COURSE RESTARTED', '', 'info'), 'hud.toast');
  }

  /** Runs under cover only. */
  _fullCourseReset() {
    this._pendingFullReset = false;
    if (!this.course) return;
    this.cpIndex = 0;
    this.timeMs = 0;
    this.courseDeaths = 0;
    if (this.courseId !== KEEP_ID) safe(() => this.save.clearCheckpoint(this.courseId), 'save.clearCheckpoint');
    safe(() => this.course.reset(), 'course.reset');
    if (this._collectibles && typeof this._collectibles.reset === 'function') safe(() => this._collectibles.reset(), 'collectibles.reset');
  }

  /** Whole-session reset: timers and deaths to zero, back to the Keep. The save is untouched. */
  restartSession() {
    this.deaths = 0;
    this.sessionMs = 0;
    this.timeMs = 0;
    this._clearSummary = null;
    this._cancelDeath();
    this._endClear(true);
    return this.returnToKeep();
  }

  /** Dev-only forward skip (exposed as __dev.skipCP — never public). */
  _skipToCheckpoint(index) {
    if (!this.course) return -1;
    const cps = this.course.checkpoints || EMPTY_ARRAY;
    if (!cps.length) return -1;
    const next = clamp(isNum(index) ? index | 0 : this.cpIndex + 1, 0, cps.length - 1);
    if (next > this.cpIndex) this.onCheckpoint(next);
    else this.cpIndex = next;
    safe(() => this.course.resetFrom(this.cpIndex), 'course.resetFrom');
    const sp = this._spawnFor(this.cpIndex);
    if (this.player) { safe(() => this.player.respawn(sp.pos, sp.yaw), 'player.respawn'); this._ncPos.copy(this.player.pos); }
    safe(() => this.cam && this.cam.recenter(), 'cam.recenter');
    return this.cpIndex;
  }

  _cooldown(key) {
    const t = nowMs();
    if (this._lastAction[key] && t - this._lastAction[key] < ACTION_COOLDOWN) return false;
    this._lastAction[key] = t;
    return true;
  }

  /* ======================================================================
   * Power hats
   * ====================================================================*/
  _givePower(id, durationS) {
    if (!id || !this._isLive()) return;
    let dur = isNum(durationS) ? durationS : 0;
    if (!(dur > 0) && this.def && Array.isArray(this.def.powers)) {
      for (let i = 0; i < this.def.powers.length; i++) {
        const p = this.def.powers[i];
        if (p && (p.kind === id || p.id === id) && isNum(p.duration)) { dur = p.duration; break; }
      }
    }
    if (!(dur > 0)) dur = POWER_DEFAULT_S;
    if (!this.power) this.power = { id, t: dur, max: dur };
    else { this.power.id = id; this.power.t = dur; this.power.max = dur; }
    if (this.player) this.player.power = id;
    safe(() => this.hero && this.hero.setPower(id), 'hero.setPower');
    safe(() => this.audio && this.audio.sfx('crest'), 'audio.sfx');
    safe(() => this.hud && this.hud.toast(String(id).toUpperCase() + ' HAT', Math.round(dur) + ' SECONDS', 'power'), 'hud.toast');
    if (this.fx && typeof this.fx.burst === 'function' && this.player) safe(() => this.fx.burst('wingGust', this.player.pos), 'fx.burst');
  }

  _stepPower(sdt) {
    const p = this.power;
    if (!p) return;
    p.t -= sdt;
    if (p.t <= 3 && p.t + sdt > 3) safe(() => this.audio && this.audio.sfx('vanish_warn'), 'audio.sfx');
    if (p.t <= 0) {
      this._clearPower();
      safe(() => this.hud && this.hud.toast('HAT FADED', '', 'info'), 'hud.toast');
    }
  }

  _clearPower() {
    if (!this.power) return;
    this.power = null;
    if (this.player) this.player.power = null;
    safe(() => this.hero && this.hero.setPower(null), 'hero.setPower');
  }

  /* ======================================================================
   * Death safety net — the part only Game can do: notice a death the player
   * did not announce (void plane), read `dead` as a rising edge.
   * ====================================================================*/
  _checkDeath() {
    if (!this.course || !this.player || this._deathT >= 0 || !this._isLive()) return;
    const pp = this.player.pos;
    const killY = this.physWorld.killY;
    if (pp.y < killY && !this.player.dead) {
      if (typeof this.player.kill === 'function') { try { this.player.kill('void'); } catch (e) { this.onDeath('void'); } }
      else this.onDeath('void');
    }
    const dead = !!this.player.dead;
    if (dead && !this._prevPlayerDead && this._deathT < 0) this.onDeath(this.player.deathCause || 'void');
    this._prevPlayerDead = dead;
  }

  /* ======================================================================
   * Per-frame
   *
   * Order (task brief, fixed): input.update → (if live) player.update →
   * course.update(dt, player) → collectibles/critters events → cam.update →
   * hero.update → hud.update → engine.followShadow(player.renderPos) → render.
   * ====================================================================*/
  update(dt) {
    if (this._destroyed) return;
    try {
      this._update(dt);
      this._errStreak = 0;
    } catch (err) {
      this._errStreak = (this._errStreak || 0) + 1;
      if (this._errStreak === 1 || this._errStreak % 120 === 0) {
        if (typeof console !== 'undefined') console.error('[crestbound] frame error', err);
      }
      /* A loop that cannot complete a frame is dead — hand it to boot.js so the
         player gets a readable failure card instead of a frozen picture. */
      if (this._errStreak === 90 && typeof this.onFatal === 'function') safe(() => this.onFatal(err), 'onFatal');
    }
  }

  _update(dt) {
    const rdt = isNum(dt) && dt > 0 ? Math.min(dt, 1 / 20) : 1 / 60;
    const rms = rdt * 1000;

    /**
     * PRESENTATION CLOCK — the WALL delta, not the simulation's clamped `dt`.
     * The 1/20 s clamp exists to keep a long frame from launching the player
     * through a wall; it has no business slowing a 620 ms death sequence down
     * to 1.4 s on a 90 ms frame (which is exactly what it did: `lastRespawnMs`
     * is wall-clock, the sequence was not). Everything the PLAYER WATCHES —
     * death, cinematic, clear, gate-open, veil, impacts, decals, gate dwell —
     * runs on `wdt`; everything that MOVES A BODY still runs on `rdt`.
     */
    const eng = this.engine;
    const wdt = eng && isNum(eng.rawDt) && eng.rawDt > 0 ? eng.rawDt : rdt;
    const wms = wdt * 1000;

    /* --- real-time sequences: frozen by a menu state and by nothing else --- */
    const uiFrozen = this.state === 'paused' || (this.menu && this.menu.isOpen && this.state !== 'title');
    if (this._deathT >= 0 && !uiFrozen) this._stepDeath(wms);
    if (this._cineT >= 0 && !uiFrozen) this._stepCinematic(wms);
    if (this._clearT >= 0 && !uiFrozen) this._stepClear(wms);
    if (this._gateOpenT >= 0 && !uiFrozen) this._stepGateOpen(wms);
    if (this._veilDur > 0) this._stepVeil(wms);

    const live = this._isLive();
    /* 'title' still simulates: the menu sits over a living Keep, not a photo. */
    const simulating = live || this.state === 'dead' || this.state === 'clear' || this.state === 'title' || this.state === 'cinematic' || this.state === 'card';
    const simBlocked = this.state === 'paused';
    const hitStop = this.impacts && isNum(this.impacts.timeScale) ? this.impacts.timeScale : 1;
    const sdt = simulating && !simBlocked ? Math.min(rdt * this.timeScale * hitStop, 1 / 20) : 0;

    /* --- timers: gameplay only --- */
    if (this._timerRun && live && this._deathT < 0) {
      if (this.courseId !== KEEP_ID) this.timeMs += rms;
      this.sessionMs += rms;
    }

    /* ================= the mandated order ================= */
    this._reconcileSuspend();
    if (this.input) this.input.update(rdt);
    this._readInputActions();

    const frozen = this._deathT >= 0 || this._cineT >= 0 || this._clearT >= 0 || this._gateOpenT >= 0 || !simulating || simBlocked || this.state === 'card';

    if (this.player && !frozen) {
      this.player.update(sdt);
      this._stepPower(sdt);
    }
    if (this.noclip && this.player && live) this._stepNoclip(rdt);

    if (this.course) {
      if (this.freezeHazards) this.course.update(0, this.player);
      else if (simulating && !simBlocked) this.course.update(sdt, this.player);
    }

    /* Game logic between sim and camera: the HUD must see THIS frame's events. */
    if (!frozen) {
      this._checkDeath();
      this._checkCheckpointVolumes();
    }
    this._updateGates(wdt);
    this._updateFen();
    this._pollPlayerState();
    this._pollMood();

    /* Gate-open cinematics are queued for a quiet moment in the Keep. */
    if (this._gateQueue.length && this.state === 'keep' && this._deathT < 0 && this._cineT < 0 && !this._loading && this.player && this.player.grounded !== false) {
      const g = this._gateQueue.shift();
      this.state = 'cinematic';
      this._startGateOpen(g);
    }

    if (this.cam) this.cam.update(this._deathT >= 0 && !this._deathSwapped ? rdt : sdt);
    this._postCameraOverrides(rdt);

    /* Hero: during the rewind Game drives the root along the ring itself. */
    if (this.hero) {
      if (!this._deathIsRewinding || this._deathSwapped) this.hero.update(sdt, this.player);
      const peek = !!(this.cam && this.cam.mode === 'peek');
      if (peek !== this._hideHeroForPeek) { this._hideHeroForPeek = peek; safe(() => this.hero.setVisible(!peek), 'hero.setVisible'); }
    }

    /* WALL dt: Impacts' cooldowns and its death machine are wall clocks — they
       must agree with the Game's death timeline, which is also wall-driven. */
    if (this.impacts && typeof this.impacts.update === 'function') this.impacts.update(wdt);
    if (this.decals && typeof this.decals.update === 'function') this.decals.update(wdt);
    if (this.fx && typeof this.fx.update === 'function') this.fx.update(sdt, this.engine.camera ? this.engine.camera.position : null);

    if (this.hud) this.hud.update(rdt, this._snapshot());
    if (this.dev) this._updateDev(rms);

    if (this.player && this.engine && typeof this.engine.followShadow === 'function') {
      this.engine.followShadow(this._deathIsRewinding && this.hero && this.hero.root ? this.hero.root.position : (this.player.renderPos || this.player.pos));
    }
    this.engine.render(rdt);
    this.frames++;                                    // only a COMPLETED frame counts (boot watchdog)
  }

  /** Global actions read straight off the Input edge flags (no key listeners). */
  _readInputActions() {
    const inp = this.input;
    if (!inp) return;
    if (inp.pausePressed) {
      if (this.state === 'paused') {
        /* A sub-page (settings/controls) owns its own ESC; only the pause page resumes. */
        const page = this.menu && (this.menu.page || this.menu.current);
        if (!page || page === 'pause') this.resume();
      } else if (this._isLive() || this.state === 'cinematic') {
        if (this.state === 'cinematic' && this._cineT >= 0) this._endCinematic(false);
        else this.pause('input');
      }
    }
    if (this._isLive()) {
      if (inp.restartPressed) this.restartCourse();
      if (inp.toCheckpointPressed) this.respawn();
      if (inp.camTogglePressed) this.toggleCamMode();
    }
    if (inp.mutePressed) this.toggleMute();
    if (inp.fullscreenPressed) this.toggleFullscreen();
    if (this.dev && inp.devPressed) this._toggleDevPanel();
  }

  /** Cannon reticle + player-state-driven presentation, on transitions only. */
  _pollPlayerState() {
    const p = this.player;
    const st = p ? p.state : '';
    if (st !== this._prevPlayerState) {
      this._prevPlayerState = st;
      const inCannon = st === 'cannon' && this._isLive();
      this._setReticle(inCannon);
      if (st === 'fly' && this._reticleOn) { this._setReticle(false); safe(() => this.audio && this.audio.sfx('cannon_fire'), 'audio.sfx'); safe(() => this.cam && this.cam.punch && this.cam.punch(0.12), 'cam.punch'); }
    }
    if (this._reticleOn && p && this.el && !this._hudReticleOwn) {
      /* Reticle follows the aim: the camera looks where the cannon points, so centre is right. */
      this._snap.cannonYaw = isNum(p.facing) ? p.facing : 0;
    }
  }

  _setReticle(on) {
    if (on === this._reticleOn) return;
    this._reticleOn = on;
    this._snap.cannon = on;
    if (this._hudReticleOwn) safe(() => this.hud.setReticle(on), 'hud.setReticle');
    else if (this.el) this.el.reticle.classList.toggle('show', on);
  }

  /** Audio mood layer from the situation (contract §5 setMood). Applied on change only. */
  _pollMood() {
    let m = this._moodWanted;
    const p = this.player;
    if (this._isLive()) {
      if (p && p.submerged) m = 'underwater';
      else if (this._warden && isNum(this._warden.hp) && this._warden.hp > 0 && this._warden.engaged) m = 'boss';
      else if (this._moodWanted === 'danger' || this._moodWanted === 'clear') m = this._moodWanted;
      else m = 'explore';
    }
    if (m !== this._moodApplied) {
      this._moodApplied = m;
      safe(() => this.audio && this.audio.setMood && this.audio.setMood(m), 'audio.setMood');
    }
  }

  _menuOpen() {
    if (this.state === 'paused' || this.state === 'title' || this.state === 'card') return true;
    return !!(this.menu && this.menu.isOpen);
  }

  _isLive() { return this.state === 'playing' || this.state === 'keep'; }

  /**
   * Composed on top of FollowCamera rather than replacing it: the title drift and
   * the clear FOV pull are ADDITIVE offsets, restored before re-applying so they
   * never accumulate.
   */
  _postCameraOverrides(rdt) {
    const cam = this.engine && this.engine.camera;
    if (!cam) return;
    let dFov = 0;
    if (this.state === 'title') { this._titleT += rdt; dFov = Math.sin(this._titleT * 0.23) * 1.1; }
    else if (this._fovPull) dFov = this._fovPull;

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
    const def = this.def;
    const isKeep = this.courseId === KEEP_ID;
    const realm = isKeep ? null : realmOf(this.courseId);
    const col = this._collectibles;
    const counts = col && col.counts ? col.counts : null;

    s.state = this.state;
    s.isKeep = isKeep;
    s.courseId = this.courseId || '';
    s.realmId = this.realmId || '';
    s.courseName = isKeep ? 'THE KEEP' : (def && def.name) || String(this.courseId || '').toUpperCase();
    s.realmName = isKeep ? '' : (realm && realm.name) || '';
    s.difficulty = def && isNum(def.difficulty) ? def.difficulty : 1;
    s.crestsTotal = this._crestDefs.length;
    let got = 0;
    const ids = s.crestIds;
    for (let i = 0; i < ids.length; i++) if (ids[i].got) got++;
    s.crests = got;
    s.coins = counts && isNum(counts.coins) ? counts.coins : 0;
    s.coinsTotal = counts && isNum(counts.coinsTotal) ? counts.coinsTotal : 0;
    s.sigils = counts && isNum(counts.sigils) ? counts.sigils : 0;
    s.sigilsTotal = def && Array.isArray(def.sigils) ? def.sigils.length : (isKeep ? 0 : 8);
    s.timeMs = this.timeMs;
    s.sessionMs = this.sessionMs;
    s.deaths = this.deaths;
    s.cpIndex = this.cpIndex;
    s.cpCount = Math.max(0, this._cpCount - 1);
    if (this.power) { this._snapPower.id = this.power.id; this._snapPower.t = this.power.t; s.power = this._snapPower; s.power01 = this.power.max > 0 ? clamp(this.power.t / this.power.max, 0, 1) : 0; }
    else { s.power = null; s.power01 = 0; }
    s.raceMs = col && isNum(col.raceMs) && col.raceMs >= 0 ? col.raceMs : null;
    const w = this._warden;
    if (w && isNum(w.hp) && (w.engaged || w.hp < (isNum(w.hpMax) ? w.hpMax : 3))) { this._snapWarden.hp = w.hp; this._snapWarden.hpMax = isNum(w.hpMax) ? w.hpMax : 3; s.warden = this._snapWarden; }
    else s.warden = null;
    if (this.player && this.player.vel) { const v = this.player.vel; s.speed = Math.sqrt(v.x * v.x + v.z * v.z); }
    else s.speed = 0;
    s.cannon = this._reticleOn;
    s.camMode = this.cam ? this.cam.mode : 'follow';
    s.pointerLocked = !!(this.input && this.input.pointerLocked);
    s.muted = this.muted;
    if ((this.frames & 31) === 0) {                   // cheap, but not needed per frame
      s.crestTotal = safe(() => this.save.crestTotal(), 'save.crestTotal') | 0;
      /* 91 was typed in. It is 13 courses x 7, and data/index.js already
         computes exactly that from REALMS — so the hub's denominator now moves
         with the course list instead of going stale the day a realm gains one. */
      s.crestGrandTotal = CREST_TOTAL;
    }
    return s;
  }

  /* ======================================================================
   * Veil — iris (radial mask centred on Nim) or fade; frame-exact, Game-owned.
   * The Transitions module is used for gate/course transitions when it offers
   * a cover+reveal PAIR (see _veilOut); the death timeline always uses this.
   * ====================================================================*/
  _setVeilColor(css) {
    if (this._veilColor === css) return;
    this._veilColor = css;
    if (this.el) this.el.veil.style.background = css;
  }

  _setVeil(a, mode) {
    const v = clamp(a, 0, 1);
    if (mode && mode !== this._veilMode) { this._veilMode = mode; if (this.el) this.el.veil.classList.toggle('iris', mode === 'iris'); }
    if (Math.abs(v - this._veilA) < 0.002 && v !== 0 && v !== 1) return;
    this._veilA = v;
    if (!this.el) return;
    const el = this.el.veil;
    const clear = v <= 0.001;
    if (this._veilMode === 'iris' && !clear) {
      /* The iris expresses coverage through the mask radius, so the plate stays
         fully opaque while it is on screen. */
      el.style.opacity = '1';
      el.style.setProperty('--cb-ir', ((1 - v) * 100).toFixed(2) + '%');
      el.style.setProperty('--cb-ix', this._veilCx.toFixed(1) + '%');
      el.style.setProperty('--cb-iy', this._veilCy.toFixed(1) + '%');
    } else {
      /* A CLEARED veil is clear in every mode: display:none alone left an iris
         plate sitting at opacity 1, so anything that so much as unhid the
         element (or measured it) saw a full cover over a live course. */
      el.style.opacity = clear ? '0' : String(v);
      if (clear) el.style.setProperty('--cb-ir', '100%');
    }
    el.style.display = clear ? 'none' : 'block';
  }

  _stepVeil(ms) {
    if (this._veilDur <= 0) return;
    this._veilT += ms;
    const k = clamp(this._veilT / this._veilDur, 0, 1);
    this._setVeil(lerp(this._veilFrom, this._veilTo, easeOutCubic(k)));
    if (k >= 1) {
      this._veilDur = 0;
      this._setVeil(this._veilTo);
      if (this._veilResolve) { const r = this._veilResolve; this._veilResolve = null; r(); }
    }
  }

  _tweenVeil(to, ms, mode) {
    if (this._veilResolve) { const r = this._veilResolve; this._veilResolve = null; r(); }
    if (mode === 'iris') this._aimVeilAtHero();
    this._veilFrom = this._veilA;
    this._veilTo = clamp(to, 0, 1);
    this._veilT = 0;
    this._veilDur = Math.max(1, ms | 0);
    if (mode) this._setVeil(this._veilA, mode);
    if (this._veilTo > 0 && this.el) this.el.veil.style.display = 'block';
    return new Promise((res) => {
      this._veilResolve = res;
      /* The rAF loop is not running during boot — resolve on a timer too. */
      setTimeout(() => {
        if (this._veilResolve === res) { this._veilResolve = null; this._veilDur = 0; this._setVeil(this._veilTo); res(); }
      }, this._veilDur + 60);
    });
  }

  _killVeilTween() {
    this._veilDur = 0;
    if (this._veilResolve) { const r = this._veilResolve; this._veilResolve = null; r(); }
  }

  /** Does the Transitions module offer a cover AND a reveal? Only then is it trusted for a load. */
  _transitionPair() {
    const tr = this.transitions;
    if (!tr) return null;
    const cover = typeof tr.iris === 'function' ? 'iris' : (typeof tr.fade === 'function' ? 'fade' : null);
    const reveal = ['reveal', 'open', 'irisOpen', 'uncover', 'clear'].find((n) => typeof tr[n] === 'function') || null;
    return cover && reveal ? { cover, reveal } : null;
  }

  async _veilOut(ms, mode) {
    const pair = this._transitionPair();
    if (pair) {
      this._usingTransitions = true;
      try {
        if (mode === 'iris' && pair.cover === 'iris') await this.transitions.iris(ms);
        else if (pair.cover === 'fade') await this.transitions.fade(ms, this._veilColor);
        else await this.transitions.iris(ms);
        return;
      } catch (e) { this._usingTransitions = false; }
    }
    return this._tweenVeil(1, ms, mode || 'fade');
  }

  _veilIn(ms, mode) {
    if (this._usingTransitions) {
      this._usingTransitions = false;
      const pair = this._transitionPair();
      if (pair) { safe(() => this.transitions[pair.reveal](ms), 'transitions.reveal'); this._setVeil(0); return Promise.resolve(); }
    }
    return this._tweenVeil(0, ms, mode);
  }

  /* ======================================================================
   * Prompt
   * ====================================================================*/
  _setPrompt(text, sub, locked) {
    const t = text || '', s = sub || '', l = !!locked;
    if (this._pT === t && this._pS === s && this._pL === l) return;
    this._pT = t; this._pS = s; this._pL = l;
    if (!this.el) return;
    const el = this.el.prompt;
    if (!t) { el.classList.remove('show'); return; }
    this.el.promptText.textContent = t;
    this.el.promptSub.textContent = s;
    el.classList.toggle('locked', l);
    this.el.promptKey.style.display = l ? 'none' : '';
    el.classList.add('show');
  }

  /* ======================================================================
   * Dev tools — ?dev=1 only. In release `__dev` is never defined.
   * ====================================================================*/
  _installDev() {
    this.dev = true;
    if (this.el) this.el.dev.classList.add('show');
    const g = this;
    this.__dev = {
      /* contract §28 */
      goto(courseId, cpIndex) { return g.loadCourse(String(courseId), { skipIntro: true, cpIndex: isNum(cpIndex) ? cpIndex : undefined }); },
      tp(x, y, z) {
        if (!g.player) return null;
        _v1.set(+x || 0, +y || 0, +z || 0);
        if (g.player.__test && typeof g.player.__test.teleport === 'function') g.player.__test.teleport(_v1);
        else g.player.respawn(_v1, g.player.facing || 0);
        g._ncPos.copy(_v1);
        safe(() => g.cam && g.cam.recenter(), 'cam.recenter');
        return g.player.pos;
      },
      give(crestId) {
        const defs = g._crestDefs;
        let def = null;
        for (let i = 0; i < defs.length; i++) if (defs[i].id === crestId) { def = defs[i]; break; }
        if (!def) def = { id: String(crestId || 'open'), type: 'open', name: String(crestId || 'open').toUpperCase() };
        if (g._collectibles && typeof g._collectibles.collect === 'function') safe(() => g._collectibles.collect('crest', def.id), 'collectibles.collect');
        g.onCrest(def);
        return def.id;
      },
      noclip(on) {
        g.noclip = on === undefined ? !g.noclip : !!on;
        if (g.noclip && g.player) g._ncPos.copy(g.player.pos);
        if (!g.noclip && g.player && g.player.__test) g.player.__test.setVel(_v1.set(0, 0, 0));
        return g.noclip;
      },
      skipCP(i) { return g._skipToCheckpoint(i); },
      state() { return g._snapshot(); },
      /* extras */
      kill(cause) { g.onDeath(cause || 'manual'); },
      respawn() { g.respawn(); },
      restart() { g.restartCourse(); },
      keep() { return g.returnToKeep(); },
      stay() { g._resolveClear('stay'); },
      clearChoice(c) { g._resolveClear(c === 'keep' ? 'keep' : 'stay'); },
      setClock(t) { if (g.course) g.course.clock = +t || 0; return g.course ? g.course.clock : 0; },
      freezeHazards(on) { g.freezeHazards = on === undefined ? !g.freezeHazards : !!on; return g.freezeHazards; },
      showColliders(on) {
        const want = on === undefined ? !g._showColliders : !!on;
        g._showColliders = want;
        if (!want) g._clearColliderDebug(); else g._colliderT = 1e9;
        return want;
      },
      power(id, s) { g._givePower(id || 'wing', s); },
      unlockAll() { for (const id of Object.keys(COURSE_META)) g.save.flags.set('gateOpen:' + id, true); g._refreshGateState(); },
      gates() { return g._gates; },
      panel(on) { g._toggleDevPanel(on); },
      realms() { return REALMS; },
      timeline() { return g.lastDeathTimeline; },
      game: g,
    };
  }

  _toggleDevPanel(on) {
    if (!this.dev || !this.el) return;
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
    if (!this.el || !this.el.dev.classList.contains('show')) return;
    const p = this.player;
    const st = this.engine && this.engine.stats ? this.engine.stats : null;
    const pos = p && p.pos ? p.pos : _v1.set(0, 0, 0);
    const vel = p && p.vel ? p.vel : _v2.set(0, 0, 0);
    const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    this.el.dev.textContent =
      'state    ' + this.state + (this.noclip ? '  [NOCLIP]' : '') + (this.freezeHazards ? '  [FROZEN]' : '') + '\n' +
      'course   ' + (this.courseId || '-') + '   cp ' + this.cpIndex + ' / ' + Math.max(0, this._cpCount - 1) + '\n' +
      'clock    ' + (this.course && isNum(this.course.clock) ? this.course.clock.toFixed(2) : '-') + ' s\n' +
      'pos      ' + pos.x.toFixed(2) + ', ' + pos.y.toFixed(2) + ', ' + pos.z.toFixed(2) + '\n' +
      'vel      ' + vel.x.toFixed(2) + ', ' + vel.y.toFixed(2) + ', ' + vel.z.toFixed(2) + '   speed ' + hs.toFixed(2) + '\n' +
      'player   ' + (p ? p.state : '-') + ' / ' + (p ? p.anim : '-') + '   grounded ' + (p ? !!p.grounded : false) + '   surface ' + ((p && p.surface) || '-') + '\n' +
      'cam      ' + (this.cam ? this.cam.mode : '-') + '   yaw ' + (this.cam && isNum(this.cam.yaw) ? this.cam.yaw.toFixed(2) : '-') + '\n' +
      'time     ' + fmtTime(this.timeMs / 1000) + '   deaths ' + this.deaths + '   respawn ' + (this.lastRespawnMs >= 0 ? this.lastRespawnMs.toFixed(0) + ' ms' : '-') + '\n' +
      'fps      ' + (st && isNum(st.fps) ? st.fps.toFixed(0) : '-') + '   draws ' + (st && isNum(st.drawCalls) ? st.drawCalls : '-') +
        '   tris ' + (st && isNum(st.tris) ? st.tris : '-') + '   p99 ' + (st && isNum(st.p99Ms) ? st.p99Ms.toFixed(1) : '-');
  }

  _rebuildColliderDebug() {
    this._clearColliderDebug();
    const c = this.course;
    if (!c || !this.engine || !this.engine.scene) return;
    const group = new THREE.Group();
    group.name = 'cb-collider-debug';
    group.renderOrder = 999;
    const list = [];
    const bounds = c.bounds && c.bounds.isBox3 ? c.bounds : _box.set(_v1.set(-200, -100, -200), _v2.set(200, 300, 200));
    if (c.broadphase && typeof c.broadphase.query === 'function') safe(() => c.broadphase.query(bounds, list), 'broadphase.query');
    for (let i = 0; i < list.length && i < 1500; i++) {
      const k = list[i];
      if (!k || !k.aabb) continue;
      const h = new THREE.Box3Helper(k.aabb, k.active === false ? 0x555555 : 0x37e0a0);
      h.material.depthTest = false; h.material.transparent = true; h.material.opacity = 0.65;
      group.add(h);
    }
    const kills = c.killVolumes || EMPTY_ARRAY;
    for (let i = 0; i < kills.length && i < 600; i++) {
      const k = kills[i];
      if (!k) continue;
      let bb = k.aabb || k.box || null;
      if (!bb && k.center && k.half) { toVec3(k.center, _v3); toVec3(k.half, _v4); bb = new THREE.Box3(_v3.clone().sub(_v4), _v3.clone().add(_v4)); }
      if (!bb || !bb.isBox3) continue;
      const h = new THREE.Box3Helper(bb, 0xff3a2a);
      h.material.depthTest = false; h.material.transparent = true; h.material.opacity = 0.8;
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

  /** Dev noclip — free-fly that keeps the player entity authoritative. */
  _stepNoclip(dt) {
    const cam = this.engine.camera;
    const p = this.player;
    if (!cam || !p) return;
    const inp = this.input;
    const speed = (inp && inp.crouch ? NOCLIP_FAST : NOCLIP_SPEED) * dt;
    cam.getWorldDirection(_v1); _v1.normalize();
    _v2.copy(_up).cross(_v1).normalize().multiplyScalar(-1);
    _v3.set(0, 0, 0);
    if (inp && inp.move) {
      _v3.addScaledVector(_v1, inp.move.y);
      _v3.addScaledVector(_v2, inp.move.x);
      if (inp.jump) _v3.y += 1;
      if (inp.dive) _v3.y -= 1;
    }
    if (_v3.lengthSq() > 1e-6) _v3.normalize().multiplyScalar(speed);
    this._ncPos.add(_v3);
    if (p.__test && typeof p.__test.teleport === 'function') {
      safe(() => p.__test.teleport(this._ncPos), 'player.teleport');
      if (typeof p.__test.setVel === 'function') safe(() => p.__test.setVel(_v4.set(0, 0, 0)), 'player.setVel');
    } else if (p.pos) { p.pos.copy(this._ncPos); if (p.vel) p.vel.set(0, 0, 0); }
    if ('grounded' in p) p.grounded = true;
  }

  /* ======================================================================
   * Teardown
   * ====================================================================*/
  dispose() {
    this._destroyed = true;
    this._epoch++;
    if (typeof window !== 'undefined') {
      if (this._onWinBlur) window.removeEventListener('blur', this._onWinBlur);
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
      if (window.__PAUSE__ && window.__PAUSE__.isPaused) delete window.__PAUSE__;
    }
    if (this.settings && this._settingsSub && typeof this.settings.off === 'function') safe(() => this.settings.off(this._settingsSub), 'settings.off');
    this._clearColliderDebug();
    this._disposeCourse();
    safe(() => this.audio && this.audio.stopAll(), 'audio.stopAll');
    safe(() => this.fx && this.fx.dispose(), 'fx.dispose');
    if (typeof document !== 'undefined') {
      const ids = ['cb-veil', 'cb-prompt', 'cb-cine', 'cb-reticle', 'cb-dev'];
      for (let i = 0; i < ids.length; i++) { const el = document.getElementById(ids[i]); if (el && el.parentNode) el.parentNode.removeChild(el); }
    }
  }
}

/* ==========================================================================
 * Overlay styling — Game-owned chrome only. The HUD ships its own art.
 * ========================================================================*/
const GAME_CSS = `
:root{
  --cb-accent:#ffd166; --cb-accent-dim:#7a6431; --cb-kill:#ff5a3c; --cb-bg:#0b0a16; --cb-hud-scale:1;
  --cb-ui-font:'Rajdhani','Segoe UI Variable Display','Segoe UI',Inter,system-ui,-apple-system,sans-serif;
  --cb-mono:ui-monospace,'Cascadia Mono',Consolas,'SF Mono',monospace;
}
#cb-veil{position:absolute;inset:0;background:#0b0a16;opacity:0;display:none;pointer-events:none;z-index:1;
  will-change:opacity;--cb-ir:100%;--cb-ix:50%;--cb-iy:50%}
#cb-veil.iris{-webkit-mask-image:radial-gradient(circle at var(--cb-ix) var(--cb-iy),transparent calc(var(--cb-ir) - 1.2%),#000 var(--cb-ir));
  mask-image:radial-gradient(circle at var(--cb-ix) var(--cb-iy),transparent calc(var(--cb-ir) - 1.2%),#000 var(--cb-ir))}
#cb-veil.rewind{box-shadow:inset 0 0 0 1px rgba(255,255,255,.04)}

#cb-prompt{position:absolute;left:0;right:0;bottom:17%;display:flex;flex-direction:column;align-items:center;gap:7px;
  pointer-events:none;z-index:2;opacity:0;transform:translateY(9px) scale(var(--cb-hud-scale));transition:opacity .16s ease,transform .16s ease}
#cb-prompt.show{opacity:1;transform:translateY(0) scale(var(--cb-hud-scale))}
#cb-prompt .cb-prompt-inner{display:flex;align-items:center;gap:11px;padding:9px 18px 9px 11px;border-radius:14px;
  background:linear-gradient(180deg,rgba(38,28,60,.84),rgba(16,12,28,.9));border:1px solid rgba(255,220,150,.22);
  box-shadow:0 10px 34px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px)}
#cb-prompt .cb-key{font:700 12px/1 var(--cb-mono);color:#1a1230;background:var(--cb-accent);min-width:24px;height:24px;border-radius:7px;
  display:flex;align-items:center;justify-content:center;box-shadow:0 2px 0 var(--cb-accent-dim),0 0 16px color-mix(in srgb,var(--cb-accent) 55%,transparent)}
#cb-prompt .cb-prompt-text{font:600 14px/1 var(--cb-ui-font);letter-spacing:.2em;color:#fff4dc;text-transform:uppercase;margin-left:.2em}
#cb-prompt .cb-prompt-sub{font:500 10.5px/1 var(--cb-ui-font);letter-spacing:.3em;color:#b9a9d6;text-transform:uppercase;margin-left:.3em}
#cb-prompt.locked .cb-prompt-inner{border-color:rgba(255,120,90,.3)}
#cb-prompt.locked .cb-prompt-text{color:#ffd6cb}
#cb-prompt.locked .cb-prompt-sub{color:var(--cb-kill)}

#cb-cine{position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity .35s ease}
#cb-cine.show{opacity:1}
#cb-cine .cb-bar{position:absolute;left:0;right:0;height:0;background:#04030a;transition:height .6s cubic-bezier(.2,.8,.2,1)}
#cb-cine .cb-bar.top{top:0}#cb-cine .cb-bar.bottom{bottom:0}
#cb-cine.show .cb-bar{height:9.5vh}
#cb-cine .cb-cine-cap{position:absolute;left:6%;right:6%;bottom:12.5vh;text-align:left}
#cb-cine .cb-cine-name{font:600 12px/1 var(--cb-ui-font);letter-spacing:.44em;color:var(--cb-accent);text-transform:uppercase;opacity:.95}
#cb-cine .cb-cine-text{margin-top:10px;font:400 clamp(15px,1.6vw,20px)/1.45 var(--cb-ui-font);color:#f3e9d2;max-width:56ch;text-shadow:0 2px 10px rgba(0,0,0,.8)}
/* BOTTOM-CENTRE. The page-level control cluster (game_controls.js) is fixed at
   bottom:8px right:8px on every ForgeFlow game page; at right:6% this hint's
   last letter touched the fullscreen chip. The corner is reserved. */
#cb-cine .cb-cine-skip{position:absolute;left:0;right:0;bottom:56px;text-align:center;font:600 10px/1 var(--cb-ui-font);letter-spacing:.4em;color:#8f84b5;text-transform:uppercase;
  animation:cb-breathe 2.1s ease-in-out infinite}
@keyframes cb-breathe{0%,100%{opacity:.4}50%{opacity:1}}

#cb-reticle{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;pointer-events:none;z-index:2;opacity:0;
  transform:scale(1.6);transition:opacity .18s ease,transform .22s cubic-bezier(.2,.9,.3,1.3)}
#cb-reticle.show{opacity:1;transform:scale(1)}
#cb-reticle i{position:absolute;inset:0;border-radius:50%;border:2px solid var(--cb-accent);box-shadow:0 0 14px color-mix(in srgb,var(--cb-accent) 60%,transparent),inset 0 0 8px rgba(0,0,0,.5)}
#cb-reticle u{position:absolute;background:var(--cb-accent);border-radius:2px}
#cb-reticle u:nth-child(2){left:50%;top:-10px;width:2px;height:12px;margin-left:-1px}
#cb-reticle u:nth-child(3){left:50%;bottom:-10px;width:2px;height:12px;margin-left:-1px}
#cb-reticle u:nth-child(4){top:50%;left:-10px;height:2px;width:12px;margin-top:-1px}
#cb-reticle u:nth-child(5){top:50%;right:-10px;height:2px;width:12px;margin-top:-1px}

#cb-dev{position:absolute;left:10px;top:10px;display:none;white-space:pre;pointer-events:none;z-index:3;
  font:500 11px/1.55 var(--cb-mono);color:#8fe8c4;padding:9px 13px;border-radius:8px;background:rgba(5,9,14,.72);
  border:1px solid rgba(80,220,170,.18);text-shadow:0 1px 2px rgba(0,0,0,.9);backdrop-filter:blur(4px)}
#cb-dev.show{display:block}

.cb-reduce-motion #cb-cine .cb-bar{transition-duration:.01ms}
.cb-reduce-motion #cb-cine .cb-cine-skip{animation:none;opacity:1}
@media (prefers-reduced-motion:reduce){#cb-cine .cb-cine-skip{animation:none;opacity:1}}
`;

export default Game;
