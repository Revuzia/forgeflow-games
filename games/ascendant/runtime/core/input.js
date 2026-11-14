/* ============================================================================
 * ASCENDANT — runtime/core/input.js
 * Contract §4.  Pointer lock, layout-independent keyboard, remappable bindings,
 * gamepad (standard mapping) and a touch fallback — merged into one frame-stable
 * state block that consumers read after Input.update(dt).
 *
 * Integration notes for other modules
 * -----------------------------------
 *  • `look.dx/.dy` are RAW MOUSE PIXELS already multiplied by sensitivity and by
 *    the invert-Y sign (contract: "already sens-scaled").  FPCamera should NOT
 *    multiply by Settings.sens again — convert pixels to radians with
 *    `RAD_PER_PX` (exported) or use the pre-converted `lookRad`.
 *  • Input does NOT import settings.js (keeps core dependency-free).  It reads
 *    the `ascendant.settings` localStorage snapshot for `sens`/`invertY` and
 *    exposes `setSensitivity(sens, invertY)` so Game can push live changes from
 *    `Settings.on(...)`.
 *  • `mute` (KeyM) is reported as an edge ONLY.  game_controls.js already owns
 *    the page-level mute on KeyM — toggling here too would cancel it out.
 *  • `fullscreen` (KeyF) is handled here (index.html sets `fs_hotkey:false`, i.e.
 *    the game claims F) unless a listener is registered via `on('fullscreen')`.
 * ==========================================================================*/

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/** Radians of yaw/pitch per sens-scaled mouse pixel. */
export const RAD_PER_PX = 0.0022;

/**
 * LOOK HYGIENE — the bounds below exist because of one shipped bug and its
 * family. yaw/pitch have one writer (Player._applyLook) and the look channel
 * that feeds it had four ways to carry something that was not the player's
 * hand: a units bug in the controller's standalone fallback (fixed there), a
 * 900 px per-event clamp that let one glitch event turn the view 113 deg, a
 * gamepad axis that was read without the stick ever moving, and a touch mode
 * entered on capability sniffing alone. _harness/lookcheck.py drives every
 * one of them in production mode.
 *
 * All angular bounds are AFTER sensitivity, in radians, because pixels are
 * not a physical unit: mice ship from 400 to 25 600 DPI (64x) and the player
 * tunes `sens` to their own. What is invariant across all of them is the
 * angle a hand can turn a view through in a given time.
 */

/**
 * The most ONE mousemove event may turn the view, after sensitivity.
 *
 * 0.5 rad is 28.6 deg. A hard 180 deg flick in 100 ms is 14 deg per event on
 * a 125 Hz mouse and 20 deg per event on a 90 Hz Bluetooth one — the worst
 * cases, since 1000 Hz mice split the same flick into 1.8 deg events. So no
 * human event reaches this and it costs nothing; a glitch event (a driver
 * hiccup, the repositioning delta a browser emits on the event right after
 * pointer lock engages, a script-dispatched event) is cut from "pinned at the
 * clamp" to a bounded jolt.
 *
 * The previous bound here was 900 px, RAW: 1.98 rad at sens 1, a 113 deg
 * turn from one event — measured exactly that by lookcheck's spike phase.
 */
const MAX_EVENT_RAD = 0.5;

/**
 * Ceiling on the look ONE FRAME may deliver, after sensitivity, as a RATE so
 * a long frame is not punished and a short one is not starved. 42 rad/s is
 * 2400 deg/s — above the fastest measured human flicks (a 180 deg flick in
 * 100 ms is 1800 deg/s) — with MAX_EVENT_RAD as the floor so a single
 * bounded event always fits in a 4 ms frame. This is the backstop behind the
 * per-event bound for a BURST of many bounded glitch events inside one frame.
 *
 * It replaces a 7200 px/s RAW-pixel rate cap that delivered exactly 50% of a
 * 180 deg/100 ms flick at 60 fps (240 px in, 120 px out) and at 240 fps —
 * i.e. it halved every fast turn a real player made. Measured in Node against
 * that build; the flick phase of lookcheck now guards against it.
 */
const MAX_LOOK_RAD_PER_SEC = 42;

/**
 * Mousemove events watched after each pointer-lock acquisition.
 *
 * The FIRST event after lock is always dropped: Chromium computes its
 * movementX/Y against a cursor position from before the lock, so it can carry
 * the whole screen-space distance the cursor was warped by. Observed under a
 * real lock: the harness asked for a -600 px move and the first event read
 * (-923, -105) — the extra 323/105 px is the warp. The next events of the
 * window are dropped only if they are implausible (past MAX_EVENT_RAD), so a
 * player who clicks and immediately flicks loses at most one event's worth
 * of motion — 1 to 8 ms of it.
 */
const LOCK_SETTLE_EVENTS = 3;

/**
 * How long after a lock acquisition an implausible event is still treated as
 * cursor warp rather than a hand.
 *
 * The count window above assumes the warp arrives in the first few events. It
 * does not reliably: measured landing AFTER three ordinary moves had already
 * spent the window, where it fell through to the clamp and was applied as a
 * full 28.6 deg jump — measured arriving ~366 ms after the lock. A time window
 * outlasts the burst either way; outside it, warp does not happen.
 */
const LOCK_SETTLE_MS = 600;

/**
 * How long a pause-bound keypress keeps explaining a pointer-lock loss.
 * Chrome drops the lock asynchronously — measured at 20-40 ms after the ESC
 * keydown on a healthy frame, and well past 250 ms on a loaded one — so the
 * window has to outlast a bad frame without swallowing an unrelated later loss.
 */
const LOCK_LOSS_KEY_WINDOW = 1000;

/** Every logical action, in a stable order (iterated per frame — no allocation). */
export const ACTIONS = Object.freeze([
  'forward', 'back', 'left', 'right',
  'jump', 'sprint', 'crouch', 'interact',
  'restart', 'respawnToCheckpoint',
  'pause', 'stageSelect', 'mute', 'fullscreen', 'dev',
]);

/** Actions that stay live while `suspended` (menus need them). */
const MENU_ACTIONS = Object.freeze({
  pause: 1, stageSelect: 1, mute: 1, fullscreen: 1, dev: 1,
});

/** Default remappable bindings, by KeyboardEvent.code (layout independent). */
export const DEFAULT_BINDINGS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'KeyC'],
  interact: ['KeyE'],
  restart: ['KeyR'],
  respawnToCheckpoint: ['KeyT'],
  pause: ['Escape'],
  stageSelect: ['Tab'],
  mute: ['KeyM'],
  fullscreen: ['KeyF'],
  dev: ['Backquote'],
});

const BINDINGS_KEY = 'ascendant.bindings.v1';
const SETTINGS_KEY = 'ascendant.settings';

/** Codes whose browser default we swallow while the game owns the page. */
const SWALLOW = Object.freeze({
  Space: 1, Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
  Backquote: 1, F1: 0,
});

/* Standard-gamepad button indices (W3C "standard" mapping). */
const PAD_A = 0, PAD_B = 1, PAD_X = 2, PAD_Y = 3;
const PAD_LB = 4, PAD_RB = 5, PAD_LT = 6, PAD_RT = 7;
const PAD_SELECT = 8, PAD_START = 9;
const PAD_DU = 12, PAD_DD = 13, PAD_DL = 14, PAD_DR = 15;
const PAD_BUTTON_COUNT = 18;

const PAD_ACTION_BUTTONS = Object.freeze([
  [PAD_A, 'jump'],
  [PAD_B, 'crouch'],
  [PAD_X, 'interact'],
  [PAD_Y, 'respawnToCheckpoint'],
  [PAD_LB, 'crouch'],
  [PAD_RB, 'sprint'],
  [PAD_LT, 'sprint'],
  [PAD_RT, 'sprint'],
  [PAD_SELECT, 'stageSelect'],
  [PAD_START, 'pause'],
  [PAD_DU, 'forward'],
  [PAD_DD, 'back'],
  [PAD_DL, 'left'],
  [PAD_DR, 'right'],
]);

/* Tuning for analog sticks. */
const STICK_DEAD_MOVE = 0.18;
const STICK_DEAD_LOOK = 0.14;
const LOOK_CURVE = 1.65;          // response curve exponent for the right stick
const PAD_LOOK_PX_PER_SEC = 1450; // pixel-equivalents/sec at full stick deflection
const TRIGGER_ON = 0.35;

/* ---- module-scope scratch (never allocate in update) ---------------------- */
const _scratch = { mx: 0, my: 0, len: 0 };

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

/** Radial deadzone + response curve, sign preserved. */
function curveAxis(v, dead, expo) {
  const a = Math.abs(v);
  if (a <= dead) return 0;
  const n = (a - dead) / (1 - dead);
  const c = expo === 1 ? n : Math.pow(n, expo);
  return v < 0 ? -c : c;
}

/** Pretty label for a binding code, for the controls UI. */
export function codeLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
  if (code.startsWith('Mouse')) {
    const n = code.slice(5);
    return n === '0' ? 'Left Click' : n === '1' ? 'Middle Click' : n === '2' ? 'Right Click' : 'Mouse ' + n;
  }
  switch (code) {
    case 'Space': return 'Space';
    case 'ShiftLeft': return 'L Shift';
    case 'ShiftRight': return 'R Shift';
    case 'ControlLeft': return 'L Ctrl';
    case 'ControlRight': return 'R Ctrl';
    case 'AltLeft': return 'L Alt';
    case 'AltRight': return 'R Alt';
    case 'Escape': return 'Esc';
    case 'Backquote': return '`';
    case 'Tab': return 'Tab';
    case 'Enter': return 'Enter';
    case 'Backslash': return '\\';
    case 'Minus': return '-';
    case 'Equal': return '=';
    default: return code;
  }
}

/* ==========================================================================
 * Input
 * ========================================================================*/
export class Input {
  /**
   * @param {HTMLElement} domElement canvas (or any element) that owns pointer lock
   */
  constructor(domElement) {
    this.dom = domElement || (IS_BROWSER ? document.body : null);

    /* ---- public contract state ---- */
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };        // sens-scaled pixels, consumed by camera
    this.lookRad = { dx: 0, dy: 0 };     // same, pre-converted to radians

    this.jump = false; this.jumpPressed = false; this.jumpReleased = false;
    this.sprint = false; this.sprintPressed = false; this.sprintReleased = false;
    this.crouch = false; this.crouchPressed = false; this.crouchReleased = false;
    this.interact = false; this.interactPressed = false;
    this.restart = false; this.restartPressed = false;
    this.respawnPressed = false;
    this.pausePressed = false;
    this.stageSelectPressed = false;
    this.mutePressed = false;
    this.fullscreenPressed = false;
    this.devPressed = false;
    this.anyPressed = false;

    this.locked = false;
    this._suspended = false;   // public accessor `suspended` is defined below

    /* ---- config ---- */
    this.bindings = this._loadBindings();
    this.sensitivity = 1;
    this.invertY = false;
    this.autoLock = true;          // click-to-lock on the canvas
    this.touchLookSens = 1.35;

    /* ---- device state ---- */
    /**
     * Touch mode: the on-screen controls and the touch look zone. True from
     * the start ONLY when the primary pointer is coarse (a phone, a tablet);
     * otherwise it arms on the first real touch event (_armTouch). It used to
     * be decided by capability sniffing — `ontouchstart` + maxTouchPoints —
     * which is true on every touchscreen laptop, so a player with a mouse got
     * the touch overlay and, since _onPointerDownDom bailed on hasTouch, no
     * click-to-lock: measured by lookcheck's laptop probe, "a real mouse
     * click did NOT take pointer lock".
     */
    this.hasTouch = IS_BROWSER && this._detectCoarsePointer();
    this.touchSeen = false;
    this.touchActive = false;
    this.gamepadConnected = false;
    this.gamepadId = '';
    /**
     * False until a look stick has been seen to MOVE. Gamepad look stays off
     * until then — see the phantom-device guard in _pollGamepad.
     */
    this.padLookArmed = false;
    this._padIndex = -1;
    this._padLookRestX = NaN;   // first sampled axes[2]/[3], the device's rest
    this._padLookRestY = NaN;

    /* ---- internals ---- */
    this._acts = Object.create(null);
    for (let i = 0; i < ACTIONS.length; i++) {
      this._acts[ACTIONS[i]] = {
        kbd: false, pad: false, touch: false,
        held: false, pressed: false, released: false,
        pressQ: 0, releaseQ: 0,           // events accumulated between frames
      };
    }
    this._codeMap = Object.create(null);
    this._rebuildCodeMap();

    this._downCodes = Object.create(null);
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._lockSettle = 0;          // mousemove events still inside the post-lock window
    this._lockSettleUntil = 0;     // ...and the wall-clock end of that window
    this.lockCount = 0;            // pointer-lock acquisitions this session
    /** Look events refused or bounded, for diagnostics — lookcheck reads these. */
    this.lookDrops = { untrusted: 0, settle: 0, clamped: 0, frame: 0 };
    this._padLookX = 0;
    this._padLookY = 0;
    this._padMoveX = 0;
    this._padMoveY = 0;
    this._padPrev = new Uint8Array(PAD_BUTTON_COUNT);
    this._padCur = new Uint8Array(PAD_BUTTON_COUNT);

    this._listeners = new Map();
    this._lockWanted = false;
    this._lockRetryAt = 0;
    this._lastPauseEmit = -1e9;
    this._pauseKeyAt = -1e9;       // when a pause-bound key was last pressed WHILE locked
    this._unadjustedOk = true;
    this._destroyed = false;

    this._touchUI = null;
    this._touchStick = { id: -1, baseX: 0, baseY: 0, x: 0, y: 0 };
    this._touchLook = { id: -1, x: 0, y: 0 };

    this._readSettingsSnapshot();
    if (IS_BROWSER) this._attach();
    if (this.hasTouch) this._buildTouchUI();
  }

  /* ======================================================================
   * Event emitter — 'lock' | 'unlock' | 'pause' | 'blur' | 'bindings' |
   *                 'lockerror' | 'fullscreen' | 'mute' | 'gamepad'
   *
   * Pause-relevant events, and who is allowed to raise them:
   *   'pause'  — INTENT, a toggle. Raised ONLY by an explicit press of a
   *              pause-bound control. Exactly one per press.
   *   'unlock' — FACT: pointer lock went away. Argument is the reason:
   *              'key'      the player's own pause key caused it, so the
   *                         'pause' toggle above already owns the decision —
   *                         a listener must NOT pause or resume on it;
   *              'external' anything else (clicked away, browser UI, our own
   *                         releaseLock) — a listener may pause, never resume.
   *   'blur'   — FACT: focus or visibility went away. Pause-only.
   * One physical action must reach the game as exactly one pause decision.
   * ====================================================================*/
  on(evt, fn) {
    if (typeof fn !== 'function') return this;
    let a = this._listeners.get(evt);
    if (!a) { a = []; this._listeners.set(evt, a); }
    if (a.indexOf(fn) === -1) a.push(fn);
    return this;
  }

  off(evt, fn) {
    const a = this._listeners.get(evt);
    if (!a) return this;
    const i = a.indexOf(fn);
    if (i !== -1) a.splice(i, 1);
    return this;
  }

  _emit(evt, arg) {
    const a = this._listeners.get(evt);
    if (!a || a.length === 0) return false;
    for (let i = 0; i < a.length; i++) {
      try { a[i](arg); } catch (e) { /* a bad listener never kills input */ }
    }
    return true;
  }

  /* ======================================================================
   * Bindings
   * ====================================================================*/
  _loadBindings() {
    const out = Object.create(null);
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      out[a] = DEFAULT_BINDINGS[a] ? DEFAULT_BINDINGS[a].slice() : [];
    }
    try {
      const raw = IS_BROWSER ? window.localStorage.getItem(BINDINGS_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (let i = 0; i < ACTIONS.length; i++) {
            const a = ACTIONS[i];
            const v = parsed[a];
            if (Array.isArray(v)) {
              const codes = [];
              for (let k = 0; k < v.length && codes.length < 4; k++) {
                if (typeof v[k] === 'string' && v[k].length > 0 && codes.indexOf(v[k]) === -1) codes.push(v[k]);
              }
              if (codes.length) out[a] = codes;
            }
          }
        }
      }
    } catch (e) { /* private mode / corrupt JSON: defaults stand */ }
    return out;
  }

  _saveBindings() {
    try {
      if (IS_BROWSER) window.localStorage.setItem(BINDINGS_KEY, JSON.stringify(this.bindings));
    } catch (e) { /* private mode: bindings live for the session only */ }
  }

  _rebuildCodeMap() {
    const m = Object.create(null);
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      const codes = this.bindings[a];
      if (!codes) continue;
      for (let k = 0; k < codes.length; k++) {
        const c = codes[k];
        let list = m[c];
        if (!list) { list = []; m[c] = list; }
        if (list.indexOf(a) === -1) list.push(a);
      }
    }
    this._codeMap = m;
  }

  /** Replace every code bound to an action. */
  setBinding(action, codes) {
    if (!this._acts[action]) return false;
    const arr = [];
    const src = Array.isArray(codes) ? codes : [codes];
    for (let i = 0; i < src.length && arr.length < 4; i++) {
      if (typeof src[i] === 'string' && src[i] && arr.indexOf(src[i]) === -1) arr.push(src[i]);
    }
    this.bindings[action] = arr;
    this._rebuildCodeMap();
    this._saveBindings();
    this._emit('bindings', action);
    return true;
  }

  /** Bind one code into a slot (0 = primary, 1 = alternate). Steals it from any other action. */
  rebind(action, code, slot) {
    if (!this._acts[action] || typeof code !== 'string' || !code) return false;
    const s = (slot | 0) || 0;
    for (let i = 0; i < ACTIONS.length; i++) {
      const other = ACTIONS[i];
      if (other === action) continue;
      const list = this.bindings[other];
      const idx = list.indexOf(code);
      if (idx !== -1) list.splice(idx, 1);
    }
    const cur = this.bindings[action];
    const dup = cur.indexOf(code);
    if (dup !== -1) cur.splice(dup, 1);
    while (cur.length < s) cur.push('');
    cur[s] = code;
    for (let i = cur.length - 1; i >= 0; i--) if (!cur[i]) cur.splice(i, 1);
    this._rebuildCodeMap();
    this._saveBindings();
    this._emit('bindings', action);
    return true;
  }

  resetBindings() {
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      this.bindings[a] = DEFAULT_BINDINGS[a] ? DEFAULT_BINDINGS[a].slice() : [];
    }
    this._rebuildCodeMap();
    this._saveBindings();
    this._emit('bindings', null);
  }

  bindingLabel(action, slot) {
    const list = this.bindings[action];
    if (!list) return '—';
    return codeLabel(list[(slot | 0) || 0]);
  }

  /**
   * Listen for the next key/mouse code and bind it. Returns a cancel function.
   * Escape cancels the capture instead of binding.
   */
  captureBinding(action, slot, done) {
    if (!IS_BROWSER || !this._acts[action]) return function () {};
    const self = this;
    let live = true;
    const finish = (code) => {
      if (!live) return;
      live = false;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      if (code) self.rebind(action, code, slot);
      if (typeof done === 'function') { try { done(code || null); } catch (e) {} }
    };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      finish(e.code === 'Escape' ? null : e.code);
    };
    const onMouse = (e) => {
      e.preventDefault(); e.stopPropagation();
      finish('Mouse' + e.button);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => finish(null);
  }

  /* ======================================================================
   * Sensitivity (pushed by Game from Settings, or read from its snapshot)
   * ====================================================================*/
  setSensitivity(sens, invertY) {
    if (isFiniteNum(sens)) this.sensitivity = Math.min(6, Math.max(0.05, sens));
    if (typeof invertY === 'boolean') this.invertY = invertY;
  }

  _readSettingsSnapshot() {
    try {
      if (!IS_BROWSER) return;
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') {
        if (isFiniteNum(s.sens)) this.sensitivity = Math.min(6, Math.max(0.05, s.sens));
        if (typeof s.invertY === 'boolean') this.invertY = s.invertY;
      }
    } catch (e) { /* defaults stand */ }
  }

  /* ======================================================================
   * Pointer lock
   * ====================================================================*/
  requestLock() {
    if (!IS_BROWSER || !this.dom) return;
    if (this.hasTouch && !this.dom.requestPointerLock) {
      /* Touch-only device: there is no pointer lock — enter "playing" directly. */
      if (!this.locked) { this.locked = true; this._emit('lock'); }
      return;
    }
    this._lockWanted = true;
    if (this.locked) return;
    if (typeof this.dom.requestPointerLock !== 'function') {
      if (!this.locked) { this.locked = true; this._emit('lock'); }
      return;
    }
    try {
      let p = null;
      if (this._unadjustedOk) {
        try {
          p = this.dom.requestPointerLock({ unadjustedMovement: true });
        } catch (inner) {
          this._unadjustedOk = false;
          p = null;
          try { this.dom.requestPointerLock(); } catch (e2) { /* cooldown */ }
        }
      } else {
        p = this.dom.requestPointerLock();
      }
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* NotSupportedError on unadjustedMovement, or the ESC cooldown. */
          this._unadjustedOk = false;
          this._lockRetryAt = (IS_BROWSER ? performance.now() : 0) + 1300;
        });
      }
    } catch (e) {
      this._lockRetryAt = (IS_BROWSER ? performance.now() : 0) + 1300;
    }
  }

  releaseLock() {
    this._lockWanted = false;
    if (!IS_BROWSER) return;
    if (this.hasTouch && !document.pointerLockElement) {
      if (this.locked) { this.locked = false; this._emit('unlock'); }
      return;
    }
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
  }

  /* ======================================================================
   * DOM wiring
   * ====================================================================*/
  /**
   * Is the PRIMARY pointer coarse — a phone or a tablet? Only `(pointer:
   * coarse)` answers that. `ontouchstart` / maxTouchPoints say the machine
   * CAN take touch, which every touchscreen laptop can, and is no reason to
   * take the mouse away from someone using one. See _armTouch for how a
   * touch-capable machine enters touch mode: by being touched.
   */
  _detectCoarsePointer() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) {}
    return false;
  }

  /**
   * Is this a MOBILE device — a phone or a tablet — as opposed to a machine
   * that merely accepts touch?
   *
   * `(any-pointer: fine)` is the question that separates them: it is true when
   * SOME attached pointer is fine (a mouse, a trackpad), which every laptop
   * has and no phone does. A touchscreen laptop answers true and is therefore
   * not mobile, however many times its screen is touched.
   *
   * Used only to gate the on-screen controls (see _armTouch). A real phone
   * still gets them at construction from _detectCoarsePointer.
   */
  _isMobileDevice() {
    try {
      if (window.matchMedia && window.matchMedia('(any-pointer: fine)').matches) return false;
    } catch (e) { return false; }
    return true;
  }

  _attach() {
    const dom = this.dom;

    this._onKeyDown = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey && (e.code === 'KeyR' || e.code === 'KeyW' || e.code === 'KeyT')) return; // let the browser have them
      const code = e.code;
      if (SWALLOW[code] && !e.metaKey) e.preventDefault();
      if (e.repeat) return;
      if (this._downCodes[code]) return;
      this._downCodes[code] = 1;
      this._pressCode(code, true);

      /* A pause-bound key pressed WHILE the pointer is locked is itself the
         reason the browser is about to drop the lock. Record it so
         _onLockChange reports that loss as 'key' rather than as an independent
         cause: one physical ESC must produce exactly ONE pause decision. Two
         reports of the same press is the race that opened the menu and then
         immediately closed it again. */
      if (this.locked) {
        const acts = this._codeMap[code];
        if (acts && acts.indexOf('pause') !== -1) {
          this._pauseKeyAt = IS_BROWSER ? performance.now() : 0;
        }
      }
    };

    this._onKeyUp = (e) => {
      const code = e.code;
      if (!this._downCodes[code]) {
        /* Key went down while unfocused: still clear any latched state. */
        this._releaseCode(code, true);
        return;
      }
      this._downCodes[code] = 0;
      this._releaseCode(code, true);
    };

    this._onMouseDown = (e) => {
      if (this.hasTouch) return;
      const code = 'Mouse' + e.button;
      if (this._downCodes[code]) return;
      this._downCodes[code] = 1;
      this._pressCode(code, true);
    };

    this._onMouseUp = (e) => {
      const code = 'Mouse' + e.button;
      if (!this._downCodes[code]) return;
      this._downCodes[code] = 0;
      this._releaseCode(code, true);
    };

    this._onMouseMove = (e) => {
      /* Only a hand may look. A script-dispatched mousemove (an extension, a
         page script) is not one — and it is the one kind of event that can
         carry any movementX/Y it likes: lookcheck's untrusted movementY=-900
         turned the view 113 deg under the old code. */
      if (e.isTrusted === false) { this.lookDrops.untrusted++; return; }
      if (!this.locked || this.suspended) return;
      let dx = e.movementX, dy = e.movementY;
      if (!isFiniteNum(dx)) dx = 0;
      if (!isFiniteNum(dy)) dy = 0;

      /* Per-event bound, in pixels equivalent to MAX_EVENT_RAD at the current
         sensitivity (sens is clamped to [0.05, 6], so this is finite). */
      const capPx = MAX_EVENT_RAD / (RAD_PER_PX * this.sensitivity);
      const implausible = dx > capPx || dx < -capPx || dy > capPx || dy < -capPx;

      /* Post-lock settle window — see LOCK_SETTLE_EVENTS and LOCK_SETTLE_MS. */
      if (this._lockSettle > 0) {
        const first = this._lockSettle === LOCK_SETTLE_EVENTS;
        this._lockSettle--;
        if (first || implausible) { this.lookDrops.settle++; return; }
      } else if (implausible && this._lockSettleUntil > 0 &&
                 (IS_BROWSER ? performance.now() : 0) < this._lockSettleUntil) {
        this.lookDrops.settle++;
        return;
      }

      /* Outside the warp window an implausible event is BOUNDED, not dropped:
         a frame hitch coalesces real motion into one big event, and discarding
         it loses input the hand actually made.

         Inside the window the opposite holds, which is why the settle branches
         above return rather than fall through here. Clamping warp does not
         discard it — it converts the cursor-warp distance into the LARGEST
         jump the game allows (MAX_EVENT_RAD, 28.6 deg) and applies it.
         Measured before this split: entering play and clicking once, sending
         no mouse movement at all, threw the view +32.8 deg of pitch and
         -49.6 deg of yaw, and a few lock acquisitions walked the pitch to the
         +/-89 clamp — the view pinned at the sky, mouse apparently dead. */
      if (implausible) {
        this.lookDrops.clamped++;
        if (dx > capPx) dx = capPx; else if (dx < -capPx) dx = -capPx;
        if (dy > capPx) dy = capPx; else if (dy < -capPx) dy = -capPx;
      }

      this._mouseDX += dx;
      this._mouseDY += dy;
    };

    this._onPointerDownDom = (e) => {
      /* A touch never asks for pointer lock (the touch UI owns "playing" on a
         touch device), and on a coarse-pointer device only a real mouse may.
         Decided per EVENT by pointerType, not by hasTouch, so a mouse keeps
         working on a machine that has also been touched. */
      const pt = e && e.pointerType;
      if (pt === 'touch') return;
      if (this.hasTouch && pt !== 'mouse') return;
      if (this.suspended || !this.autoLock) return;
      if (!this.locked) this.requestLock();
    };

    this._onLockChange = () => {
      const el = document.pointerLockElement;
      const now = !!el && (el === this.dom || (this.dom && this.dom.contains && this.dom.contains(el)));
      if (now === this.locked) return;
      this.locked = now;
      if (now) {
        this._mouseDX = 0; this._mouseDY = 0;
        this._lockSettle = LOCK_SETTLE_EVENTS;
        this._lockSettleUntil = (IS_BROWSER ? performance.now() : 0) + LOCK_SETTLE_MS;
        this.lockCount++;
        this._emit('lock');
      } else {
        this._releaseAllKeys();
        /* ONE cause, ONE report. 'unlock' is a statement of fact with the reason
           attached; it is NOT a second pause event. Firing 'pause' here as well
           used to hand the same physical ESC to the game's pause TOGGLE twice —
           the second hit landed while the game was already paused and resumed
           it, which is why the menu "didn't always stay up". Whether it did was
           decided by whether a frame happened to land between the keydown and
           the browser's pointerlockchange. */
        const t = IS_BROWSER ? performance.now() : 0;
        const byKey = (t - this._pauseKeyAt) < LOCK_LOSS_KEY_WINDOW;
        this._pauseKeyAt = -1e9;
        this._emit('unlock', byKey ? 'key' : 'external');
      }
    };

    this._onLockError = () => {
      this._unadjustedOk = false;
      this._lockRetryAt = performance.now() + 1300;
      this._emit('lockerror');
    };

    this._onBlur = () => {
      this._releaseAllKeys();
      this._mouseDX = 0; this._mouseDY = 0;
      this._emit('blur');
    };

    this._onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        this._releaseAllKeys();
        this._mouseDX = 0; this._mouseDY = 0;
        /* 'blur' alone. It is already a pause-ONLY signal on the game side;
           also firing 'pause' here put a tab-hide through the pause TOGGLE,
           so hiding the tab while the menu was up RESUMED the game. */
        this._emit('blur');
      }
    };

    this._onPadConnect = (e) => {
      this.gamepadConnected = true;
      this._resetPadLookArming();     // a fresh device has not moved a stick yet
      this._padIndex = e.gamepad ? e.gamepad.index : -1;
      this.gamepadId = e.gamepad ? (e.gamepad.id || 'gamepad') : 'gamepad';
      this._emit('gamepad', true);
    };

    this._onPadDisconnect = (e) => {
      if (e.gamepad && e.gamepad.index === this._padIndex) {
        this._padIndex = -1;
        this.gamepadConnected = false;
        this.gamepadId = '';
        this._padPrev.fill(0);
        this._padCur.fill(0);
        this._padMoveX = 0; this._padMoveY = 0;
        this._resetPadLookArming();
        for (let i = 0; i < ACTIONS.length; i++) this._acts[ACTIONS[i]].pad = false;
        this._emit('gamepad', false);
      }
    };

    /* Touch mode arms on the first touch actually SEEN — see hasTouch. */
    this._onTouchSeen = () => { this._armTouch(); };

    window.addEventListener('keydown', this._onKeyDown, false);
    window.addEventListener('keyup', this._onKeyUp, false);
    window.addEventListener('mousedown', this._onMouseDown, false);
    window.addEventListener('mouseup', this._onMouseUp, false);
    document.addEventListener('mousemove', this._onMouseMove, false);
    document.addEventListener('pointerlockchange', this._onLockChange, false);
    document.addEventListener('pointerlockerror', this._onLockError, false);
    window.addEventListener('blur', this._onBlur, false);
    document.addEventListener('visibilitychange', this._onVisibility, false);
    window.addEventListener('gamepadconnected', this._onPadConnect, false);
    window.addEventListener('gamepaddisconnected', this._onPadDisconnect, false);
    window.addEventListener('touchstart', this._onTouchSeen, { capture: true, passive: true });
    if (dom && dom.addEventListener) dom.addEventListener('pointerdown', this._onPointerDownDom, false);
  }

  destroy() {
    if (this._destroyed || !IS_BROWSER) return;
    this._destroyed = true;
    window.removeEventListener('keydown', this._onKeyDown, false);
    window.removeEventListener('keyup', this._onKeyUp, false);
    window.removeEventListener('mousedown', this._onMouseDown, false);
    window.removeEventListener('mouseup', this._onMouseUp, false);
    document.removeEventListener('mousemove', this._onMouseMove, false);
    document.removeEventListener('pointerlockchange', this._onLockChange, false);
    document.removeEventListener('pointerlockerror', this._onLockError, false);
    window.removeEventListener('blur', this._onBlur, false);
    document.removeEventListener('visibilitychange', this._onVisibility, false);
    window.removeEventListener('gamepadconnected', this._onPadConnect, false);
    window.removeEventListener('gamepaddisconnected', this._onPadDisconnect, false);
    window.removeEventListener('touchstart', this._onTouchSeen, { capture: true });
    if (this.dom && this.dom.removeEventListener) this.dom.removeEventListener('pointerdown', this._onPointerDownDom, false);
    if (this._touchUI && this._touchUI.parentNode) this._touchUI.parentNode.removeChild(this._touchUI);
    this._touchUI = null;
    this._listeners.clear();
  }

  /* ---- raw code -> action edges ---- */
  _pressCode(code, fromKeyboard) {
    const list = this._codeMap[code];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const st = this._acts[list[i]];
      if (fromKeyboard) st.kbd = true;
      st.pressQ++;
    }
  }

  _releaseCode(code, fromKeyboard) {
    const list = this._codeMap[code];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const st = this._acts[a];
      if (fromKeyboard) {
        /* Only clear if no other bound code for this action is still down. */
        st.kbd = this._anyBoundCodeDown(a);
      }
      st.releaseQ++;
    }
  }

  _anyBoundCodeDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this._downCodes[codes[i]]) return true;
    return false;
  }

  _releaseAllKeys() {
    for (const code in this._downCodes) {
      if (this._downCodes[code]) {
        this._downCodes[code] = 0;
        const list = this._codeMap[code];
        if (list) for (let i = 0; i < list.length; i++) this._acts[list[i]].releaseQ++;
      }
    }
    for (let i = 0; i < ACTIONS.length; i++) this._acts[ACTIONS[i]].kbd = false;
    this._touchStick.id = -1; this._touchStick.x = 0; this._touchStick.y = 0;
    this._touchLook.id = -1;
    if (this._touchUI) this._resetTouchVisual();
    for (let i = 0; i < ACTIONS.length; i++) this._acts[ACTIONS[i]].touch = false;
  }

  /**
   * The ONE pause *intent* channel: an explicit press of a pause-bound control
   * (ESC, gamepad START, the touch pause button). The game treats it as a
   * toggle, so nothing else may raise it — pointer-lock loss and tab-hide are
   * reported through 'unlock' and 'blur', which are pause-only on the game side.
   * The short debounce only coalesces a keyboard and a gamepad press of the
   * same beat; it is not what keeps the menu open.
   */
  _firePause(reason) {
    const t = IS_BROWSER ? performance.now() : 0;
    if (t - this._lastPauseEmit < 250) return;
    this._lastPauseEmit = t;
    this._emit('pause', reason);
  }

  /* ======================================================================
   * Gamepad
   * ====================================================================*/
  /** Forget which device we were watching: a new pad must earn look again. */
  _resetPadLookArming() {
    this.padLookArmed = false;
    this._padLookRestX = NaN;
    this._padLookRestY = NaN;
    this._padLookX = 0;
    this._padLookY = 0;
  }

  _pollGamepad(dt) {
    this._padMoveX = 0; this._padMoveY = 0;
    this._padLookX = 0; this._padLookY = 0;
    if (!IS_BROWSER || !navigator.getGamepads) return;

    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return; }
    if (!pads) return;

    let pad = null;
    if (this._padIndex >= 0 && this._padIndex < pads.length && pads[this._padIndex]) {
      pad = pads[this._padIndex];
    } else {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) {
          if (i !== this._padIndex) this._resetPadLookArming();   // different device
          pad = p; this._padIndex = i; this.gamepadId = p.id || 'gamepad';
          break;
        }
      }
    }
    if (!pad || !pad.connected) {
      if (this.gamepadConnected) {
        this.gamepadConnected = false;
        this._padPrev.fill(0); this._padCur.fill(0);
        this._resetPadLookArming();
        for (let i = 0; i < ACTIONS.length; i++) this._acts[ACTIONS[i]].pad = false;
      }
      return;
    }
    this.gamepadConnected = true;

    const ax = pad.axes;
    const btns = pad.buttons;

    /* --- sticks --- */
    if (ax && ax.length >= 2) {
      const lx = isFiniteNum(ax[0]) ? ax[0] : 0;
      const ly = isFiniteNum(ax[1]) ? ax[1] : 0;
      const mag = Math.sqrt(lx * lx + ly * ly);
      if (mag > STICK_DEAD_MOVE) {
        const scaled = Math.min(1, (mag - STICK_DEAD_MOVE) / (1 - STICK_DEAD_MOVE));
        const inv = scaled / mag;
        this._padMoveX = lx * inv;
        this._padMoveY = -ly * inv;   // stick +Y is "down"; game +Y is forward
      }
    }
    if (ax && ax.length >= 4) {
      const rawX = isFiniteNum(ax[2]) ? ax[2] : 0;
      const rawY = isFiniteNum(ax[3]) ? ax[3] : 0;

      /* PHANTOM-DEVICE GUARD. Plenty of hardware that is not a controller
         enumerates as one — keyboards, mice, wheels, flight sticks — and an
         uncentred trigger reported as axes[3] rests at -1 rather than 0.
         Feeding that into look every frame walks the pitch to the +/-89 deg
         clamp with the player's hands nowhere near a pad: measured at +67.2
         deg of pitch in 1.5 s of no input at all (_harness/lookcheck.py's
         phantom-pad phase), ending pinned at the clamp.

         Magnitude cannot tell a parked axis from a held stick — both read
         past the deadzone. MOVEMENT can: a real stick travels, a phantom axis
         is a constant. So remember where the axes were first seen and arm pad
         look only once one of them has travelled a deadzone away from that
         rest. A player who is already holding the stick arms it the moment
         they let go; a device that never moves never arms. */
      if (!(this._padLookRestX === this._padLookRestX)) {   // NaN test: first sample
        this._padLookRestX = rawX;
        this._padLookRestY = rawY;
      } else if (!this.padLookArmed) {
        if (Math.abs(rawX - this._padLookRestX) > STICK_DEAD_LOOK ||
            Math.abs(rawY - this._padLookRestY) > STICK_DEAD_LOOK) {
          this.padLookArmed = true;
        }
      }

      if (this.padLookArmed) {
        const rx = curveAxis(rawX, STICK_DEAD_LOOK, LOOK_CURVE);
        const ry = curveAxis(rawY, STICK_DEAD_LOOK, LOOK_CURVE);
        const step = PAD_LOOK_PX_PER_SEC * (dt > 0.05 ? 0.05 : dt);
        this._padLookX = rx * step;
        this._padLookY = ry * step;
      }
    }

    /* --- buttons --- */
    this._padCur.fill(0);
    if (btns) {
      const n = Math.min(btns.length, PAD_BUTTON_COUNT);
      for (let i = 0; i < n; i++) {
        const b = btns[i];
        if (!b) continue;
        let on;
        if (i === PAD_LT || i === PAD_RT) on = (isFiniteNum(b.value) ? b.value : (b.pressed ? 1 : 0)) > TRIGGER_ON;
        else on = !!b.pressed || (isFiniteNum(b.value) && b.value > 0.5);
        this._padCur[i] = on ? 1 : 0;
      }
    }

    for (let i = 0; i < ACTIONS.length; i++) this._acts[ACTIONS[i]].pad = false;

    for (let i = 0; i < PAD_ACTION_BUTTONS.length; i++) {
      const idx = PAD_ACTION_BUTTONS[i][0];
      const action = PAD_ACTION_BUTTONS[i][1];
      const st = this._acts[action];
      if (!st) continue;
      const cur = this._padCur[idx];
      const prev = this._padPrev[idx];
      if (cur) st.pad = true;
      if (cur && !prev) st.pressQ++;
      else if (!cur && prev) st.releaseQ++;
    }

    const tmp = this._padPrev;
    this._padPrev = this._padCur;
    this._padCur = tmp;
  }

  /** Haptics, if the pad exposes an actuator. Safe no-op everywhere else. */
  rumble(strong, weak, ms) {
    if (!IS_BROWSER || !navigator.getGamepads || this._padIndex < 0) return;
    try {
      const pads = navigator.getGamepads();
      const pad = pads && pads[this._padIndex];
      const act = pad && pad.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        act.playEffect('dual-rumble', {
          duration: Math.max(0, Math.min(1000, ms || 120)),
          strongMagnitude: clamp01(strong || 0),
          weakMagnitude: clamp01(weak === undefined ? (strong || 0) * 0.6 : weak),
        }).catch(() => {});
      }
    } catch (e) {}
  }

  /* ======================================================================
   * Touch fallback  (left stick + jump/sprint/crouch, right half = look)
   * ====================================================================*/
  /**
   * Enter touch mode because a touch was seen. Idempotent. Builds the
   * on-screen controls on demand; `touchSeen` records the fact for anyone
   * who wants to know whether touch mode was sniffed or earned.
   */
  _armTouch() {
    this.touchSeen = true;
    if (this.hasTouch) return;
    /* The on-screen stick and buttons are for MOBILE, not for every machine
       that can register a touch. A touchscreen laptop has a real mouse or
       trackpad, and one stray tap of its screen used to swap that player onto
       phone controls permanently — there is no path back, hasTouch never
       clears. `touchSeen` above still records that a touch happened, for
       anyone who wants to know; it just no longer rebuilds the UI. */
    if (!this._isMobileDevice()) return;
    this.hasTouch = true;
    this._buildTouchUI();
    this._emit('touch', true);
  }

  _buildTouchUI() {
    if (!IS_BROWSER || this._touchUI) return;
    const host = document.getElementById('ui') || document.body;
    if (!host) return;

    if (!document.getElementById('asc-touch-style')) {
      const st = document.createElement('style');
      st.id = 'asc-touch-style';
      st.textContent = [
        '#asc-touch{position:absolute;inset:0;pointer-events:none;z-index:5;touch-action:none;',
        '  font-family:system-ui,-apple-system,sans-serif;-webkit-user-select:none;user-select:none}',
        '#asc-touch.off{display:none}',
        '#asc-touch .zone{position:absolute;pointer-events:auto;touch-action:none}',
        '#asc-touch #asc-look{left:38%;right:0;top:0;bottom:0}',
        '#asc-touch #asc-stickzone{left:0;bottom:0;width:38%;height:62%}',
        '#asc-touch #asc-stick{position:absolute;width:132px;height:132px;margin:-66px 0 0 -66px;left:120px;top:60%;',
        '  border-radius:50%;border:2px solid rgba(150,214,255,.30);',
        '  background:radial-gradient(circle at 50% 50%,rgba(20,40,66,.42),rgba(8,16,28,.24) 70%,transparent 72%);',
        '  opacity:.5;transition:opacity .18s ease}',
        '#asc-touch #asc-stick.on{opacity:.95}',
        '#asc-touch #asc-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;',
        '  border-radius:50%;background:radial-gradient(circle at 38% 32%,#bfe8ff,#4aa6e8 55%,#1c5f9c);',
        '  box-shadow:0 3px 12px rgba(0,0,0,.5),0 0 16px rgba(90,200,255,.35);will-change:transform}',
        '#asc-touch .btn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;',
        '  display:flex;align-items:center;justify-content:center;color:#dff2ff;letter-spacing:.14em;',
        '  font-size:11px;font-weight:600;text-transform:uppercase;',
        '  border:2px solid rgba(150,214,255,.34);background:rgba(12,26,44,.44);',
        '  box-shadow:inset 0 0 18px rgba(90,190,255,.14),0 2px 10px rgba(0,0,0,.42);',
        '  transition:transform .08s ease,background .12s ease,border-color .12s ease}',
        '#asc-touch .btn.on{transform:scale(.92);background:rgba(46,124,190,.62);border-color:rgba(190,240,255,.8)}',
        '#asc-touch #asc-jump{right:26px;bottom:34px;width:98px;height:98px;font-size:13px}',
        '#asc-touch #asc-sprint{right:132px;bottom:118px;width:70px;height:70px}',
        '#asc-touch #asc-crouch{right:132px;bottom:34px;width:70px;height:70px}',
        '#asc-touch #asc-pausebtn{left:14px;top:14px;width:44px;height:44px;font-size:15px;border-radius:12px}',
      ].join('\n');
      document.head.appendChild(st);
    }

    const root = document.createElement('div');
    root.id = 'asc-touch';
    root.innerHTML = [
      '<div class="zone" id="asc-look"></div>',
      '<div class="zone" id="asc-stickzone"></div>',
      '<div id="asc-stick"><div id="asc-knob"></div></div>',
      '<div class="btn" id="asc-jump">Jump</div>',
      '<div class="btn" id="asc-sprint">Run</div>',
      '<div class="btn" id="asc-crouch">Duck</div>',
      '<div class="btn" id="asc-pausebtn">II</div>',
    ].join('');
    host.appendChild(root);
    this._touchUI = root;

    this._elStick = root.querySelector('#asc-stick');
    this._elKnob = root.querySelector('#asc-knob');

    const stickZone = root.querySelector('#asc-stickzone');
    const lookZone = root.querySelector('#asc-look');

    /* ---- left stick ---- */
    const onStickStart = (e) => {
      if (this.suspended) return;
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      this._touchStick.id = t.identifier === undefined ? -2 : t.identifier;
      this._touchStick.baseX = t.clientX;
      this._touchStick.baseY = t.clientY;
      this._touchStick.x = 0; this._touchStick.y = 0;
      this.touchActive = true;
      if (this._elStick) {
        this._elStick.style.left = t.clientX + 'px';
        this._elStick.style.top = t.clientY + 'px';
        this._elStick.classList.add('on');
      }
      if (!this.locked) { this.locked = true; this._emit('lock'); }
    };
    const onStickMove = (e) => {
      if (this._touchStick.id === -1) return;
      e.preventDefault();
      const list = e.changedTouches;
      for (let i = 0; i < (list ? list.length : 1); i++) {
        const t = list ? list[i] : e;
        const id = t.identifier === undefined ? -2 : t.identifier;
        if (id !== this._touchStick.id) continue;
        const R = 60;
        let dx = (t.clientX - this._touchStick.baseX) / R;
        let dy = (t.clientY - this._touchStick.baseY) / R;
        const m = Math.sqrt(dx * dx + dy * dy);
        if (m > 1) { dx /= m; dy /= m; }
        this._touchStick.x = dx;
        this._touchStick.y = -dy;
        if (this._elKnob) this._elKnob.style.transform = 'translate(' + (dx * R).toFixed(1) + 'px,' + (dy * R).toFixed(1) + 'px)';
      }
    };
    const onStickEnd = (e) => {
      const list = e.changedTouches;
      for (let i = 0; i < (list ? list.length : 1); i++) {
        const t = list ? list[i] : e;
        const id = t.identifier === undefined ? -2 : t.identifier;
        if (id !== this._touchStick.id) continue;
        this._touchStick.id = -1;
        this._touchStick.x = 0; this._touchStick.y = 0;
        this._resetTouchVisual();
      }
    };
    stickZone.addEventListener('touchstart', onStickStart, { passive: false });
    stickZone.addEventListener('touchmove', onStickMove, { passive: false });
    stickZone.addEventListener('touchend', onStickEnd, { passive: false });
    stickZone.addEventListener('touchcancel', onStickEnd, { passive: false });

    /* ---- right half look drag ---- */
    const onLookStart = (e) => {
      if (e.isTrusted === false) { this.lookDrops.untrusted++; return; }   // only a finger may look
      if (this.suspended) return;
      e.preventDefault();
      const t = e.changedTouches ? e.changedTouches[0] : e;
      this._touchLook.id = t.identifier === undefined ? -2 : t.identifier;
      this._touchLook.x = t.clientX;
      this._touchLook.y = t.clientY;
      this.touchActive = true;
      if (!this.locked) { this.locked = true; this._emit('lock'); }
    };
    const onLookMove = (e) => {
      if (e.isTrusted === false) { this.lookDrops.untrusted++; return; }
      if (this._touchLook.id === -1) return;
      e.preventDefault();
      const list = e.changedTouches;
      for (let i = 0; i < (list ? list.length : 1); i++) {
        const t = list ? list[i] : e;
        const id = t.identifier === undefined ? -2 : t.identifier;
        if (id !== this._touchLook.id) continue;
        this._mouseDX += (t.clientX - this._touchLook.x) * this.touchLookSens;
        this._mouseDY += (t.clientY - this._touchLook.y) * this.touchLookSens;
        this._touchLook.x = t.clientX;
        this._touchLook.y = t.clientY;
      }
    };
    const onLookEnd = (e) => {
      const list = e.changedTouches;
      for (let i = 0; i < (list ? list.length : 1); i++) {
        const t = list ? list[i] : e;
        const id = t.identifier === undefined ? -2 : t.identifier;
        if (id === this._touchLook.id) this._touchLook.id = -1;
      }
    };
    lookZone.addEventListener('touchstart', onLookStart, { passive: false });
    lookZone.addEventListener('touchmove', onLookMove, { passive: false });
    lookZone.addEventListener('touchend', onLookEnd, { passive: false });
    lookZone.addEventListener('touchcancel', onLookEnd, { passive: false });

    /* ---- buttons ---- */
    this._wireTouchButton(root.querySelector('#asc-jump'), 'jump');
    this._wireTouchButton(root.querySelector('#asc-sprint'), 'sprint');
    this._wireTouchButton(root.querySelector('#asc-crouch'), 'crouch');
    this._wireTouchButton(root.querySelector('#asc-pausebtn'), 'pause');
  }

  _wireTouchButton(el, action) {
    if (!el) return;
    const st = this._acts[action];
    const down = (e) => {
      e.preventDefault();
      if (this.suspended && !MENU_ACTIONS[action]) return;
      if (st.touch) return;
      st.touch = true;
      st.pressQ++;
      el.classList.add('on');
      this.touchActive = true;
      if (!this.locked && !MENU_ACTIONS[action]) { this.locked = true; this._emit('lock'); }
    };
    const up = (e) => {
      e.preventDefault();
      if (!st.touch) return;
      st.touch = false;
      st.releaseQ++;
      el.classList.remove('on');
    };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
  }

  _resetTouchVisual() {
    if (this._elKnob) this._elKnob.style.transform = 'translate(0px,0px)';
    if (this._elStick) this._elStick.classList.remove('on');
  }

  /** Show/hide the on-screen controls (menus call this). */
  setTouchVisible(v) {
    if (!this._touchUI) return;
    this._touchUI.classList.toggle('off', !v);
    if (!v) {
      this._touchStick.id = -1; this._touchStick.x = 0; this._touchStick.y = 0;
      this._touchLook.id = -1;
      this._resetTouchVisual();
    }
  }

  /* ======================================================================
   * Per-frame update — call ONCE, before player.update
   * ====================================================================*/
  update(dt) {
    const d = isFiniteNum(dt) && dt > 0 ? (dt > 0.05 ? 0.05 : dt) : 0.016;

    /* Re-request pointer lock after the browser's post-ESC cooldown. */
    if (this._lockWanted && !this.locked && !this.suspended && this._lockRetryAt > 0) {
      const t = IS_BROWSER ? performance.now() : 0;
      if (t >= this._lockRetryAt) { this._lockRetryAt = 0; this.requestLock(); }
    }

    this._pollGamepad(d);

    /* ---- resolve every action: held + edges ---- */
    let any = false;
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      const st = this._acts[a];
      const rawHeld = st.kbd || st.pad || st.touch;
      let pressed = st.pressQ > 0;
      let released = st.releaseQ > 0;
      /* A key held across frames without a fresh event is neither edge. */
      if (!pressed && rawHeld && !st.held) pressed = true;
      if (!released && !rawHeld && st.held) released = true;
      st.pressQ = 0; st.releaseQ = 0;

      const blocked = this.suspended && !MENU_ACTIONS[a];
      st.held = rawHeld;
      st.pressed = blocked ? false : pressed;
      st.released = blocked ? false : released;
      if (st.pressed) any = true;
    }
    this.anyPressed = any;

    /* ---- movement ---- */
    let mx = 0, my = 0;
    if (!this.suspended) {
      if (this._acts.right.held) mx += 1;
      if (this._acts.left.held) mx -= 1;
      if (this._acts.forward.held) my += 1;
      if (this._acts.back.held) my -= 1;
      mx += this._padMoveX + this._touchStick.x;
      my += this._padMoveY + this._touchStick.y;
      const len = Math.sqrt(mx * mx + my * my);
      if (len > 1) { mx /= len; my /= len; }
      _scratch.len = len;
    }
    this.move.x = mx;
    this.move.y = my;

    /* ---- look: consume the accumulated deltas exactly once ---- */
    let lx = this._mouseDX + this._padLookX;
    let ly = this._mouseDY + this._padLookY;
    this._mouseDX = 0; this._mouseDY = 0;
    if (this.suspended || (!this.locked && !this.touchActive)) { lx = 0; ly = 0; }
    const sens = this.sensitivity;
    const invert = this.invertY ? -1 : 1;
    /* Per-FRAME ceiling, in the angle the player will actually see — see
       MAX_LOOK_RAD_PER_SEC. The backstop behind the per-event bound, for a
       burst of many bounded events inside one frame. Scaled by the frame's
       REAL length (not the 50 ms sim clamp above) so a hitch that legitimately
       accumulated a whole flick still delivers it. */
    const capDt = isFiniteNum(dt) && dt > 0 ? (dt > 0.25 ? 0.25 : dt) : 0.016;
    const capRad = MAX_LOOK_RAD_PER_SEC * capDt;
    const capPx = (capRad > MAX_EVENT_RAD ? capRad : MAX_EVENT_RAD) / (RAD_PER_PX * sens);
    if (lx > capPx || lx < -capPx || ly > capPx || ly < -capPx) {
      this.lookDrops.frame++;
      if (lx > capPx) lx = capPx; else if (lx < -capPx) lx = -capPx;
      if (ly > capPx) ly = capPx; else if (ly < -capPx) ly = -capPx;
    }
    this.look.dx = isFiniteNum(lx) ? lx * sens : 0;
    this.look.dy = isFiniteNum(ly) ? ly * sens * invert : 0;
    this.lookRad.dx = this.look.dx * RAD_PER_PX;
    this.lookRad.dy = this.look.dy * RAD_PER_PX;

    /* ---- flatten to the contract's public booleans ---- */
    const j = this._acts.jump;
    this.jump = j.held && !this.suspended;
    this.jumpPressed = j.pressed;
    this.jumpReleased = j.released;

    const sp = this._acts.sprint;
    this.sprint = sp.held && !this.suspended;
    this.sprintPressed = sp.pressed;
    this.sprintReleased = sp.released;

    const cr = this._acts.crouch;
    this.crouch = cr.held && !this.suspended;
    this.crouchPressed = cr.pressed;
    this.crouchReleased = cr.released;

    const it = this._acts.interact;
    this.interact = it.held && !this.suspended;
    this.interactPressed = it.pressed;

    const rs = this._acts.restart;
    this.restart = rs.held && !this.suspended;
    this.restartPressed = rs.pressed;

    this.respawnPressed = this._acts.respawnToCheckpoint.pressed;
    this.pausePressed = this._acts.pause.pressed;
    this.stageSelectPressed = this._acts.stageSelect.pressed;
    this.mutePressed = this._acts.mute.pressed;
    this.fullscreenPressed = this._acts.fullscreen.pressed;
    this.devPressed = this._acts.dev.pressed;

    /* ---- side channels ---- */
    if (this.pausePressed) this._firePause('key');
    if (this.mutePressed) this._emit('mute');   // game_controls already toggled it
    if (this.fullscreenPressed) {
      if (!this._emit('fullscreen')) {
        try {
          if (window.__CONTROLS__ && window.__CONTROLS__.toggleFullscreen) window.__CONTROLS__.toggleFullscreen();
        } catch (e) {}
      }
    }
  }

  /* ======================================================================
   * Generic queries (menus, dev tools, rebind UI)
   * ====================================================================*/
  held(action) { const s = this._acts[action]; return s ? s.held : false; }
  pressed(action) { const s = this._acts[action]; return s ? s.pressed : false; }
  released(action) { const s = this._acts[action]; return s ? s.released : false; }

  /** Zero everything without touching bindings — used on state transitions. */
  clear() {
    this._releaseAllKeys();
    this._mouseDX = 0; this._mouseDY = 0;
    this._padMoveX = 0; this._padMoveY = 0;
    this._padLookX = 0; this._padLookY = 0;
    for (let i = 0; i < ACTIONS.length; i++) {
      const st = this._acts[ACTIONS[i]];
      st.held = false; st.pressed = false; st.released = false;
      st.pressQ = 0; st.releaseQ = 0; st.pad = false;
    }
    this.move.x = 0; this.move.y = 0;
    this.look.dx = 0; this.look.dy = 0;
    this.lookRad.dx = 0; this.lookRad.dy = 0;
    this.jump = this.sprint = this.crouch = this.interact = this.restart = false;
    this.jumpPressed = this.jumpReleased = false;
  }

  /**
   * Contract-facing flag. Exposed as an accessor rather than a plain field so
   * that a direct `input.suspended = true` (which is how the contract reads)
   * ALSO drops the held state immediately — otherwise a menu opened mid-sprint
   * would leave one frame of stale movement, and closing it would resume a
   * sprint the player is no longer holding.
   */
  get suspended() { return this._suspended; }
  set suspended(v) { this.setSuspended(v); }

  /** Menus call this. Keeps pause/select/mute/fullscreen/dev alive. */
  setSuspended(v) {
    const next = !!v;
    /* Dev/harness immunity: two systems drive this flag (Game._suspendInput and
       the UI capture counter in style.js) and a leaked capture leaves it stuck
       TRUE under automation, where pointer lock can never be held. A stuck
       suspension still lets movement recompute but hard-gates jump - which made
       feelcheck measure a passing game as 8 failures. With ?dev=1 the input
       never suspends; menus still work off their own state. */
    if (this.devNoSuspend && next) return;
    if (next === this._suspended) return;
    this._suspended = next;
    if (next) {
      this.move.x = 0; this.move.y = 0;
      this.look.dx = 0; this.look.dy = 0;
      this.lookRad.dx = 0; this.lookRad.dy = 0;
      this._mouseDX = 0; this._mouseDY = 0;
      this.jump = this.sprint = this.crouch = this.interact = this.restart = false;
      this.jumpPressed = this.jumpReleased = false;
      this._touchStick.x = 0; this._touchStick.y = 0; this._touchStick.id = -1;
      this._touchLook.id = -1;
      this._resetTouchVisual();
    }
  }
}

export default Input;
