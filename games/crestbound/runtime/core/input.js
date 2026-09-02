/* ============================================================================
 * CRESTBOUND — runtime/core/input.js
 * Contract §4. ANALOG third-person input: keyboard (with an analog ramp so a
 * tap walks and a hold runs), standard-mapping gamepad (left stick = the real
 * analog control, right stick = orbit), mouse orbit both pointer-locked and as
 * a plain left-drag, remappable + persisted bindings, frame-stable edges, a
 * suspension gate for menus and a harness surface that drives REAL events.
 *
 * Ported from Ascendant's input.js (first-person obby, proven): the binding /
 * persistence / edge-detect / pointer-lock / look-hygiene / phantom-gamepad
 * machinery is transliterated, storage keys renamed to `crestbound.*`. What the
 * contract CHANGED is not kept: no pointer-lock-only play (lock is optional —
 * the game is fully playable with drag-orbit), no digital WASD (keys ramp), no
 * sprint (analog magnitude IS walk/run), no first-person touch overlay.
 *
 * Consumers read the public block after `update(dt)`, once per frame, BEFORE
 * player.update():
 *
 *   move  {x, y, mag}   camera-relative INPUT space: x = right, y = forward.
 *                       mag 0..1 is the analog run/walk control. Keyboard keys
 *                       ramp 0→1 over KEY_RAMP_UP (0.09 s) and 1→0 over
 *                       KEY_RAMP_DOWN (0.06 s): a tap (< ~50 ms) peaks below
 *                       0.55 = walk, a hold reaches 1 = run. Diagonals are
 *                       normalised to mag ≤ 1. Gamepad left stick: radial
 *                       deadzone STICK_DEAD (0.15), outer STICK_OUTER (0.95),
 *                       mag = clamped radial magnitude. Sources sum, then clamp.
 *   look  {dx, dy}      orbit delta THIS FRAME in RADIANS, sens + invert
 *                       already applied. Sign convention: +dx = mouse right /
 *                       stick right / orbitRight key; +dy = mouse down / stick
 *                       down / orbitDown key (i.e. "pull the camera up over the
 *                       hero"). The camera decides what a positive delta means
 *                       for yaw/pitch; invertX/Y flip the MOUSE and STICK sign
 *                       only — the Q/E/R/V keys are explicit directions.
 *                       Mouse: px × TUNE.cam.orbitSpeedMouse × camSens.
 *                       Right stick / keys: TUNE.cam.orbitSpeedKey rad/s.
 *                       `lookIsRaw` is FALSE: the camera must not re-apply
 *                       sensitivity or invert.
 *   ONE ACTION, ONE     Every edge (pressed/released) belongs to the transition
 *   EDGE                not-held → held for the ACTION, never to an individual
 *                       key or pad button. crouch is bound to Ctrl AND C AND
 *                       Shift, and RB AND the right-stick click both recenter:
 *                       holding two of them is one intent, and releasing one of
 *                       two held keys must never raise `jumpReleased` (that is a
 *                       jump-cut the player did not ask for).
 *   edges               jumpPressed / jumpReleased / jumpHeld (+ `jump` alias),
 *                       crouch(+Pressed/Released), dive(+Pressed), pound
 *                       (+Pressed), recenterPressed, peek (held, +Pressed/
 *                       Released), interact(+Pressed), pausePressed,
 *                       restartPressed, toCheckpointPressed, camTogglePressed,
 *                       mutePressed, fullscreenPressed, devPressed, anyPressed.
 *                       `pound` = crouch/pound action; the CONTROLLER decides
 *                       (crouch while airborne = pound). poundPressed is true
 *                       whenever crouchPressed is, plus any pound-only binding.
 *   gamepad             {connected, id, index, rumble(strong, weak, ms)}; the
 *                       same rumble is also `input.rumble(...)`. Haptics are
 *                       gated by Settings.gamepadVibrate.
 *   pointerLocked       true while the canvas owns the pointer. `locked` alias.
 *   suspended           menus: gameplay reads false/zero, MENU_ACTIONS (pause,
 *                       mute, fullscreen, dev, camToggle) still fire.
 *
 * Events (`on(evt, fn)`): 'lock' · 'unlock'(reason:'key'|'external') ·
 * 'gamepadconnected'(true) · 'gamepaddisconnected' · 'anykey'(source) ·
 * 'canvasclick'(button) — a left click on the canvas that did NOT turn into a
 * drag; game.js calls requestLock() from this during play · 'blur' · 'bindings'
 * (action|null) · 'lockerror' · 'mute' · 'fullscreen'.
 *
 * Settings: this module does NOT statically import settings.js (core stays
 * dependency-light and importable under the Node harness). It reads the
 * `crestbound.settings` localStorage snapshot at construction for camSensX /
 * camSensY / invertX / invertY / gamepadVibrate, exposes `applySettings(s)` for
 * game.js to push live values, AND — as a safety net — lazily subscribes to the
 * sibling `Settings` store after construction when it is present. Both paths
 * write the same five fields, so double wiring is harmless.
 *
 * Determinism / allocation: nothing in update() allocates. Every accumulator
 * is a numeric field; scratch is module-scope; the action table is a fixed
 * object iterated over a frozen array. The only per-frame platform allocation
 * is `navigator.getGamepads()` itself, which the browser owns.
 *
 * Harness surface (`__test`): press(code)/release(code) dispatch REAL
 * KeyboardEvents on window (code + key, bubbles, cancelable) so the whole
 * binding/edge/ramp path is exercised; stick(x, y) injects an analog vector
 * that OVERRIDES keyboard + pad until stick(0, 0); look(dx, dy) injects
 * radians for the next frame; pad(buttonIndex, down) and padAxes(lx, ly, rx,
 * ry) feed a virtual gamepad through the real polling path.
 * ==========================================================================*/

import { TUNE } from './tuning.js';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ---------------------------------------------------------------------------
 * Tunables (not movement — those live in tuning.js)
 * ------------------------------------------------------------------------ */

/** Seconds for a held key's analog value to ramp 0 → 1 (tap = walk, hold = run). */
export const KEY_RAMP_UP = 0.09;
/** Seconds for a released key's analog value to ramp 1 → 0. */
export const KEY_RAMP_DOWN = 0.06;
/** Left-stick radial deadzone (inner) and the deflection that counts as full. */
export const STICK_DEAD = 0.15;
export const STICK_OUTER = 0.95;
/** Right-stick deadzone and response curve exponent (Ascendant-proven). */
const STICK_DEAD_LOOK = 0.14;
const LOOK_CURVE = 1.65;
/** Movement (px) below which a press/release on the canvas is a CLICK, not a drag. */
const DRAG_CLICK_PX = 6;
/** Mouse-wheel notches → zoom units (camera reads `zoom`, +in / −out). */
const WHEEL_ZOOM_PER_PX = 1 / 100;

/**
 * LOOK HYGIENE (ported from Ascendant — every bound below closed a shipped
 * bug, all measured by its lookcheck harness). All angular bounds are AFTER
 * sensitivity, in radians: pixels are not a physical unit (400–25 600 DPI
 * mice, per-player sens), the angle a hand can turn a view through is.
 */
/** Most ONE mousemove may turn the view. 0.5 rad = 28.6°; no human event reaches it. */
const MAX_EVENT_RAD = 0.5;
/** Per-frame ceiling as a RATE (42 rad/s = 2400°/s, above the fastest measured flick). */
const MAX_LOOK_RAD_PER_SEC = 42;
/**
 * Chromium bug: the FIRST mousemove after pointer lock engages computes its
 * movementX/Y against the pre-lock cursor and can carry the whole warp
 * distance (observed: −600 px asked, (−923, −105) delivered). That event is
 * dropped when |movement| exceeds LOCK_WARP_PX; the next LOCK_SETTLE_EVENTS−1
 * events are dropped only if implausible (past MAX_EVENT_RAD).
 */
const LOCK_WARP_PX = 300;
const LOCK_SETTLE_EVENTS = 3;
/** How long a pause-bound keypress keeps explaining a pointer-lock loss (ms). */
const LOCK_LOSS_KEY_WINDOW = 1000;
/** Browser cooldown after an ESC-driven unlock before a new request can succeed (ms). */
const LOCK_COOLDOWN_MS = 1300;

/* ---------------------------------------------------------------------------
 * Actions + bindings (CONTRACT §4 — verbatim)
 * ------------------------------------------------------------------------ */

/** Every logical action, in a stable order (iterated per frame — no allocation). */
export const ACTIONS = Object.freeze([
  'jump', 'crouch', 'dive', 'pound', 'orbitLeft', 'orbitRight', 'orbitUp', 'orbitDown',
  'recenter', 'peek', 'interact', 'pause', 'restart', 'toCheckpoint', 'mute', 'fullscreen', 'dev', 'camToggle',
]);

/** The four digital movement axes. Bindable like actions; they feed the analog ramp. */
export const MOVE_AXES = Object.freeze(['moveForward', 'moveBack', 'moveLeft', 'moveRight']);

/** Everything with a binding slot: axes first, then actions. */
export const BINDABLE = Object.freeze(MOVE_AXES.concat(ACTIONS));

/** Actions that stay live while `suspended` (menus need them). */
const MENU_ACTIONS = Object.freeze({ pause: 1, mute: 1, fullscreen: 1, dev: 1, camToggle: 1 });

/** Default remappable bindings, by KeyboardEvent.code (layout independent). */
export const DEFAULT_BINDINGS = Object.freeze({
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'], crouch: ['ControlLeft', 'KeyC', 'ShiftLeft'], dive: ['KeyF', 'KeyX'], pound: ['ControlLeft', 'KeyC'],
  orbitLeft: ['KeyQ'], orbitRight: ['KeyE'], orbitUp: ['KeyR'], orbitDown: ['KeyV'], recenter: ['KeyZ'], peek: ['KeyG'],
  interact: ['KeyE'], pause: ['Escape'], restart: ['KeyR'], toCheckpoint: ['KeyT'], mute: ['KeyM'], fullscreen: ['F11'], dev: ['Backquote'], camToggle: ['KeyB'],
});

const BINDINGS_KEY = 'crestbound.bindings.v1';
const SETTINGS_KEY = 'crestbound.settings';

/** Codes whose browser default we swallow while the game owns the page. */
const SWALLOW = Object.freeze({
  Space: 1, Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
  Backquote: 1, F11: 1,
});

/** Mouse button → binding code, precomputed so event handlers never concatenate. */
const MOUSE_CODES = Object.freeze(['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4']);

/* Standard-gamepad button indices (W3C "standard" mapping). */
const PAD_A = 0, PAD_B = 1, PAD_X = 2, PAD_Y = 3;
const PAD_LB = 4, PAD_RB = 5, PAD_LT = 6, PAD_RT = 7;
const PAD_SELECT = 8, PAD_START = 9, PAD_L3 = 10, PAD_R3 = 11;
const PAD_DU = 12, PAD_DD = 13, PAD_DL = 14, PAD_DR = 15;
const PAD_BUTTON_COUNT = 18;
const TRIGGER_ON = 0.35;

/**
 * Button → action. A/Cross jump · X/Square dive · B/Circle crouch (the
 * controller turns an airborne crouch into a pound) · LB peek · RB recenter ·
 * R3 recenter · Start pause · Back restart · Y interact · D-pad = digital move
 * through the same ramp as the keys. Triggers are deliberately unbound.
 */
const PAD_ACTION_BUTTONS = Object.freeze([
  [PAD_A, 'jump'],
  [PAD_X, 'dive'],
  [PAD_B, 'crouch'],
  [PAD_B, 'pound'],
  [PAD_Y, 'interact'],
  [PAD_LB, 'peek'],
  [PAD_RB, 'recenter'],
  [PAD_R3, 'recenter'],
  [PAD_START, 'pause'],
  [PAD_SELECT, 'restart'],
  [PAD_DU, 'moveForward'],
  [PAD_DD, 'moveBack'],
  [PAD_DL, 'moveLeft'],
  [PAD_DR, 'moveRight'],
]);

/* ---------------------------------------------------------------------------
 * Helpers. NOTE there is deliberately NO module-scope scratch object here: every
 * intermediate in update() is a `let` local, which V8 keeps in a register — a
 * scratch OBJECT would box each double into a fresh HeapNumber every frame,
 * which is exactly the per-frame allocation the doctrine forbids.
 * ------------------------------------------------------------------------ */

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function clampSens(v) { return Math.min(6, Math.max(0.05, v)); }

/** Radial deadzone + response curve, sign preserved (right stick). */
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

/**
 * KeyboardEvent.key for a KeyboardEvent.code, for the harness's synthetic
 * events (a real keydown carries both; some page code keys off `key`).
 */
export function keyForCode(code) {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return code.slice(6);
  if (code.startsWith('Arrow')) return code;
  if (code.startsWith('F') && code.length <= 3 && /^F\d+$/.test(code)) return code;
  switch (code) {
    case 'Space': return ' ';
    case 'ShiftLeft': case 'ShiftRight': return 'Shift';
    case 'ControlLeft': case 'ControlRight': return 'Control';
    case 'AltLeft': case 'AltRight': return 'Alt';
    case 'MetaLeft': case 'MetaRight': return 'Meta';
    case 'Backquote': return '`';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'Backslash': return '\\';
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Semicolon': return ';';
    case 'Quote': return '\'';
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Slash': return '/';
    default: return code;   // Escape, Enter, Tab, Backspace, Delete, Home, End…
  }
}

/* ==========================================================================
 * Input
 * ========================================================================*/
export class Input {
  /**
   * @param {HTMLElement} domElement the canvas: owns pointer lock, click-to-lock
   *   and drag-orbit. Keyboard and gamepad are window-level.
   */
  constructor(domElement) {
    this.dom = domElement || (IS_BROWSER ? document.body : null);

    /* ---- public contract state ---- */
    this.move = { x: 0, y: 0, mag: 0 };
    this.look = { dx: 0, dy: 0 };
    /**
     * FALSE: `look` is already sensitivity- and invert-scaled (CONTRACT §4), so
     * the camera must apply neither again. FollowCamera._consumeLook reads this
     * flag; it exists so a stub/alternate input can hand over raw radians.
     */
    this.lookIsRaw = false;
    /** Wheel zoom this frame (+ = zoom in). Extra; camera may ignore it. */
    this.zoom = 0;

    this.jump = false; this.jumpHeld = false; this.jumpPressed = false; this.jumpReleased = false;
    this.crouch = false; this.crouchPressed = false; this.crouchReleased = false;
    this.dive = false; this.divePressed = false;
    this.pound = false; this.poundPressed = false;
    this.recenterPressed = false;
    this.peek = false; this.peekPressed = false; this.peekReleased = false;
    this.interact = false; this.interactPressed = false;
    this.pausePressed = false;
    this.restart = false; this.restartPressed = false;
    this.toCheckpointPressed = false;
    this.camTogglePressed = false;
    this.mutePressed = false;
    this.fullscreenPressed = false;
    this.devPressed = false;
    this.anyPressed = false;
    /** True while any manual orbit source (mouse, drag, stick, keys) moved this frame. */
    this.orbiting = false;

    this.pointerLocked = false;
    this.dragging = false;
    this._suspended = false;   // public accessor `suspended` is defined below
    /** With ?dev=1 game.js may set this: the input then never suspends (harness immunity). */
    this.devNoSuspend = false;

    /* ---- settings mirror (see header) ---- */
    this.settings = { camSensX: 1, camSensY: 1, invertX: false, invertY: false, gamepadVibrate: true };

    /* ---- gamepad (public block) ---- */
    const self = this;
    this.gamepad = {
      connected: false, id: '', index: -1, mapping: '',
      rumble: function (strong, weak, ms) { return self.rumble(strong, weak, ms); },
    };
    /** False until a look stick has been seen to MOVE (phantom-device guard). */
    this.padLookArmed = false;
    this._padLookRestX = NaN;
    this._padLookRestY = NaN;

    /* ---- config ---- */
    this.bindings = this._loadBindings();

    /* ---- internals: action table ---- */
    this._acts = Object.create(null);
    for (let i = 0; i < BINDABLE.length; i++) {
      this._acts[BINDABLE[i]] = {
        kbd: false, pad: false, padWas: false,
        held: false, pressed: false, released: false,
        pressQ: 0, releaseQ: 0,           // events accumulated between frames
        v: 0,                             // analog ramp value (move axes only)
      };
    }
    this._downCodes = Object.create(null);   // before the code map: _rebuildCodeMap resyncs held flags from it
    this._codeMap = Object.create(null);
    this._rebuildCodeMap();

    /* ---- look accumulators (RADIANS, already sens/invert scaled) ---- */
    this._mouseRadX = 0;   // locked mousemove + unlocked drag
    this._mouseRadY = 0;
    this._injRadX = 0;     // __test.look injection (raw radians, no sens)
    this._injRadY = 0;
    this._wheelPx = 0;
    this._lockSettle = 0;  // mousemove events still inside the post-lock window
    this.lockCount = 0;
    /** Look events refused or bounded, for diagnostics. */
    this.lookDrops = { untrusted: 0, settle: 0, clamped: 0, frame: 0 };

    /* ---- drag state ---- */
    this._drag = { active: false, id: -1, button: -1, x: 0, y: 0, dist: 0 };

    /* ---- gamepad state ---- */
    this._padIndex = -1;
    this._padStickX = 0; this._padStickY = 0;     // left stick, deadzoned, game space
    this._padLookX = 0; this._padLookY = 0;       // right stick, rad this frame
    /** Raw button state of the polled pad this frame (edges live on the actions). */
    this._padCur = new Uint8Array(PAD_BUTTON_COUNT);
    this._padAnyEdge = false;
    /* virtual pad for the harness: null until __test.pad/padAxes is used */
    this._vpad = null;

    /* ---- test injection ---- */
    this._testStick = { active: false, x: 0, y: 0 };

    this._listeners = new Map();
    this._lockRetryAt = 0;
    this._pauseKeyAt = -1e9;       // when a pause-bound key was last pressed WHILE locked
    this._unadjustedOk = true;
    this._destroyed = false;
    this._settingsSub = null;

    this._readSettingsSnapshot();
    if (IS_BROWSER) this._attach();
    this._bindSettingsStore();

    this.__test = this._buildTestSurface();
  }

  /* ======================================================================
   * Event emitter
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
   * Bindings (persisted at BINDINGS_KEY)
   * ====================================================================*/
  _loadBindings() {
    const out = Object.create(null);
    for (let i = 0; i < BINDABLE.length; i++) {
      const a = BINDABLE[i];
      out[a] = DEFAULT_BINDINGS[a] ? DEFAULT_BINDINGS[a].slice() : [];
    }
    try {
      const raw = IS_BROWSER ? window.localStorage.getItem(BINDINGS_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (let i = 0; i < BINDABLE.length; i++) {
            const a = BINDABLE[i];
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
    for (let i = 0; i < BINDABLE.length; i++) {
      const a = BINDABLE[i];
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
    /* Keys physically down that just lost/gained a binding: resync held flags. */
    for (let i = 0; i < BINDABLE.length; i++) {
      const st = this._acts[BINDABLE[i]];
      st.kbd = this._anyBoundCodeDown(BINDABLE[i]);
    }
  }

  /**
   * CONTRACT: replace every code bound to an action (or move axis). Codes may
   * be shared between actions by design (E = orbitRight + interact), so this
   * never steals a code from another action. Persists + emits 'bindings'.
   * @param {string} action
   * @param {string|string[]} codes
   */
  rebind(action, codes) {
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

  /** Bind one code into a slot (0 primary, 1 alternate). Steals it from every other action. */
  rebindSlot(action, code, slot) {
    if (!this._acts[action] || typeof code !== 'string' || !code) return false;
    const s = (slot | 0) || 0;
    for (let i = 0; i < BINDABLE.length; i++) {
      const other = BINDABLE[i];
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
    for (let i = 0; i < BINDABLE.length; i++) {
      const a = BINDABLE[i];
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
   * Listen for the next key/mouse code and bind it into `slot`. Returns a
   * cancel function. Escape cancels the capture instead of binding.
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
      if (code) self.rebindSlot(action, code, slot);
      if (typeof done === 'function') { try { done(code || null); } catch (e) {} }
    };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      finish(e.code === 'Escape' ? null : e.code);
    };
    const onMouse = (e) => {
      e.preventDefault(); e.stopPropagation();
      finish(MOUSE_CODES[e.button] || ('Mouse' + e.button));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => finish(null);
  }

  /* ======================================================================
   * Settings (mirror of the five fields this module consumes)
   * ====================================================================*/
  /**
   * Push live settings. Accepts the whole Settings object or a partial patch;
   * unknown keys are ignored, bad values are dropped.
   * @param {{camSensX?:number, camSensY?:number, invertX?:boolean, invertY?:boolean, gamepadVibrate?:boolean}} s
   */
  applySettings(s) {
    if (!s || typeof s !== 'object') return this;
    const t = this.settings;
    if (isFiniteNum(s.camSensX)) t.camSensX = clampSens(s.camSensX);
    if (isFiniteNum(s.camSensY)) t.camSensY = clampSens(s.camSensY);
    if (typeof s.invertX === 'boolean') t.invertX = s.invertX;
    if (typeof s.invertY === 'boolean') t.invertY = s.invertY;
    if (typeof s.gamepadVibrate === 'boolean') t.gamepadVibrate = s.gamepadVibrate;
    return this;
  }

  _readSettingsSnapshot() {
    try {
      if (!IS_BROWSER) return;
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') this.applySettings(s);
    } catch (e) { /* defaults stand */ }
  }

  /**
   * Safety net: subscribe to the sibling Settings store if it exists. Dynamic
   * so a missing/broken settings.js can never take input down with it, and so
   * this module stays importable in isolation. Same module instance as boot's
   * static import (ES module cache), so `Settings.on` sees every change.
   */
  _bindSettingsStore() {
    if (!IS_BROWSER) return;
    const self = this;
    let p = null;
    try { p = import('./settings.js'); } catch (e) { return; }
    if (!p || typeof p.then !== 'function') return;
    p.then((m) => {
      if (self._destroyed) return;
      const S = m && m.Settings;
      if (!S || typeof S.get !== 'function') return;
      try { self.applySettings(S.get()); } catch (e) {}
      if (typeof S.on === 'function') {
        self._settingsSub = function () { try { self.applySettings(S.get()); } catch (e) {} };
        self._settingsStore = S;
        try { S.on(self._settingsSub); } catch (e) { self._settingsSub = null; }
      }
    }).catch(() => { /* no settings.js yet — snapshot + applySettings() stand */ });
  }

  /* ======================================================================
   * Pointer lock (OPTIONAL — the game plays fully unlocked via drag-orbit)
   * ====================================================================*/
  /** Whether this browser/element can lock the pointer at all. */
  get canLock() { return !!(IS_BROWSER && this.dom && typeof this.dom.requestPointerLock === 'function'); }

  /** Ascendant-compatible alias. */
  get locked() { return this.pointerLocked; }

  /**
   * Ask for pointer lock. Must run inside a user gesture (game.js calls it from
   * 'canvasclick' during play). Silently no-ops during the browser's post-ESC
   * cooldown, while suspended, or when the platform has no pointer lock.
   */
  requestLock() {
    if (!this.canLock || this.pointerLocked || this.suspended) return false;
    const t = IS_BROWSER ? performance.now() : 0;
    if (t < this._lockRetryAt) return false;
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
          this._lockRetryAt = (IS_BROWSER ? performance.now() : 0) + LOCK_COOLDOWN_MS;
        });
      }
      return true;
    } catch (e) {
      this._lockRetryAt = t + LOCK_COOLDOWN_MS;
      return false;
    }
  }

  releaseLock() {
    if (!IS_BROWSER) return;
    try { if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  }

  /* ======================================================================
   * DOM wiring
   * ====================================================================*/
  _attach() {
    const dom = this.dom;

    /* ---- keyboard ---- */
    this._onKeyDown = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const code = e.code;
      if (!code) return;
      /* Browser-reserved chords we can neither prevent nor see the keyup of. */
      if ((e.ctrlKey || e.metaKey) && (code === 'KeyT' || code === 'KeyN')) return;
      if (SWALLOW[code] && !e.metaKey && typeof e.preventDefault === 'function') e.preventDefault();
      if (e.repeat) return;
      if (this._downCodes[code]) return;
      this._downCodes[code] = 1;
      this._pressCode(code, true);

      /* A pause-bound key pressed WHILE the pointer is locked is itself the
         reason the browser is about to drop the lock. Record it so
         _onLockChange reports that loss as 'key' rather than as an independent
         cause: one physical ESC must produce exactly ONE pause decision. */
      if (this.pointerLocked) {
        const acts = this._codeMap[code];
        if (acts && acts.indexOf('pause') !== -1) this._pauseKeyAt = performance.now();
      }
    };

    this._onKeyUp = (e) => {
      const code = e.code;
      if (!code) return;
      if (!this._downCodes[code]) {
        /* Key went down while unfocused: still clear any latched state. */
        this._releaseCode(code, true);
        return;
      }
      this._downCodes[code] = 0;
      this._releaseCode(code, true);
    };

    /* ---- mouse buttons as bindable codes (window-level) ---- */
    this._onMouseDown = (e) => {
      const code = MOUSE_CODES[e.button];
      if (!code || this._downCodes[code]) return;
      this._downCodes[code] = 1;
      this._pressCode(code, true);
    };
    this._onMouseUp = (e) => {
      const code = MOUSE_CODES[e.button];
      if (!code || !this._downCodes[code]) return;
      this._downCodes[code] = 0;
      this._releaseCode(code, true);
    };

    /* ---- locked mouse look ---- */
    this._onMouseMove = (e) => {
      /* Only a hand may look. A script-dispatched mousemove can carry any
         movementX/Y it likes (Ascendant lookcheck: untrusted −900 px = 113°). */
      if (e.isTrusted === false) { this.lookDrops.untrusted++; return; }
      if (!this.pointerLocked || this.suspended) return;
      let dx = e.movementX, dy = e.movementY;
      if (!isFiniteNum(dx)) dx = 0;
      if (!isFiniteNum(dy)) dy = 0;

      /* Post-lock settle window — see LOCK_WARP_PX / LOCK_SETTLE_EVENTS. */
      if (this._lockSettle > 0) {
        const first = this._lockSettle === LOCK_SETTLE_EVENTS;
        this._lockSettle--;
        if (first) {
          if (dx > LOCK_WARP_PX || dx < -LOCK_WARP_PX || dy > LOCK_WARP_PX || dy < -LOCK_WARP_PX) { this.lookDrops.settle++; return; }
        } else if (this._implausiblePx(dx, dy)) { this.lookDrops.settle++; return; }
      }
      this._accumMousePx(dx, dy);
    };

    /* ---- canvas pointer: click-to-lock signal + unlocked drag-orbit ---- */
    this._onPointerDown = (e) => {
      if (e.isTrusted === false && !this._allowUntrustedPointer) return;
      const pt = e.pointerType;
      if (pt === 'touch') return;             // no touch orbit in this build
      if (this.pointerLocked) return;         // locked: mousemove owns look
      const b = e.button | 0;
      if (b !== 0 && b !== 2) return;
      const d = this._drag;
      d.active = true; d.id = e.pointerId === undefined ? -2 : e.pointerId; d.button = b;
      d.x = e.clientX; d.y = e.clientY; d.dist = 0;
      this.dragging = false;                  // becomes true once it moves past DRAG_CLICK_PX
      try { if (dom.setPointerCapture && e.pointerId !== undefined) dom.setPointerCapture(e.pointerId); } catch (err) {}
    };

    this._onPointerMove = (e) => {
      const d = this._drag;
      if (!d.active) return;
      if (e.isTrusted === false && !this._allowUntrustedPointer) return;
      const id = e.pointerId === undefined ? -2 : e.pointerId;
      if (id !== d.id) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      if (!isFiniteNum(dx) || !isFiniteNum(dy)) return;
      d.dist += Math.abs(dx) + Math.abs(dy);
      if (d.dist > DRAG_CLICK_PX) this.dragging = true;
      if (this.pointerLocked || this.suspended || !this.dragging) return;
      this._accumMousePx(dx, dy);
    };

    this._onPointerUp = (e) => {
      const d = this._drag;
      if (!d.active) return;
      const id = e.pointerId === undefined ? -2 : e.pointerId;
      if (id !== d.id) return;
      const wasClick = !this.dragging && d.button === 0;
      d.active = false; d.id = -1;
      this.dragging = false;
      try { if (dom.releasePointerCapture && e.pointerId !== undefined) dom.releasePointerCapture(e.pointerId); } catch (err) {}
      /* A left click that never became a drag: game.js decides whether this
         is a "lock the pointer" moment (during play) or nothing (menus). */
      if (wasClick && !this.pointerLocked && !this.suspended) this._emit('canvasclick', 0);
    };

    this._onWheel = (e) => {
      if (this.suspended) return;
      const dy = e.deltaY;
      if (!isFiniteNum(dy)) return;
      /* deltaMode 1 = lines, 2 = pages; normalise to pixels. */
      const px = e.deltaMode === 1 ? dy * 16 : (e.deltaMode === 2 ? dy * 400 : dy);
      this._wheelPx += px;
      if (typeof e.preventDefault === 'function') e.preventDefault();
    };

    this._onLockChange = () => {
      const el = document.pointerLockElement;
      const now = !!el && (el === this.dom || (this.dom && this.dom.contains && this.dom.contains(el)));
      if (now === this.pointerLocked) return;
      this.pointerLocked = now;
      if (now) {
        this._mouseRadX = 0; this._mouseRadY = 0;
        this._lockSettle = LOCK_SETTLE_EVENTS;
        this._endDrag();
        this.lockCount++;
        this._emit('lock');
      } else {
        this._releaseAllKeys();
        /* ONE cause, ONE report. 'unlock' is a statement of fact with the reason
           attached; it is NOT a second pause event (Ascendant: firing 'pause'
           here too closed the menu the same ESC had just opened). */
        const t = performance.now();
        const byKey = (t - this._pauseKeyAt) < LOCK_LOSS_KEY_WINDOW;
        this._pauseKeyAt = -1e9;
        if (byKey) this._lockRetryAt = t + LOCK_COOLDOWN_MS;
        this._emit('unlock', byKey ? 'key' : 'external');
      }
    };

    this._onLockError = () => {
      this._unadjustedOk = false;
      this._lockRetryAt = performance.now() + LOCK_COOLDOWN_MS;
      this._emit('lockerror');
    };

    this._onBlur = () => {
      this._releaseAllKeys();
      this._endDrag();
      this._mouseRadX = 0; this._mouseRadY = 0; this._wheelPx = 0;
      this._emit('blur');
    };

    this._onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        this._releaseAllKeys();
        this._endDrag();
        this._mouseRadX = 0; this._mouseRadY = 0; this._wheelPx = 0;
        this._emit('blur');
      }
    };

    this._onContextMenu = (e) => {
      /* Right-drag orbits; the page-level game_controls.js already blocks the
         menu, this is belt-and-braces for the canvas itself. */
      if (typeof e.preventDefault === 'function') e.preventDefault();
    };

    this._onPadConnect = (e) => {
      const g = e.gamepad;
      this._adoptPad(g ? g.index : -1, g ? (g.id || 'gamepad') : 'gamepad', g ? (g.mapping || '') : '');
    };

    this._onPadDisconnect = (e) => {
      if (e.gamepad && e.gamepad.index === this._padIndex) this._dropPad();
    };

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
    if (dom && dom.addEventListener) {
      dom.addEventListener('pointerdown', this._onPointerDown, false);
      dom.addEventListener('pointermove', this._onPointerMove, false);
      dom.addEventListener('pointerup', this._onPointerUp, false);
      dom.addEventListener('pointercancel', this._onPointerUp, false);
      dom.addEventListener('lostpointercapture', this._onPointerUp, false);
      dom.addEventListener('wheel', this._onWheel, { passive: false });
      dom.addEventListener('contextmenu', this._onContextMenu, false);
    }
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._settingsStore && this._settingsSub && typeof this._settingsStore.off === 'function') {
      try { this._settingsStore.off(this._settingsSub); } catch (e) {}
    }
    this._settingsSub = null; this._settingsStore = null;
    if (!IS_BROWSER) return;
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
    const dom = this.dom;
    if (dom && dom.removeEventListener) {
      dom.removeEventListener('pointerdown', this._onPointerDown, false);
      dom.removeEventListener('pointermove', this._onPointerMove, false);
      dom.removeEventListener('pointerup', this._onPointerUp, false);
      dom.removeEventListener('pointercancel', this._onPointerUp, false);
      dom.removeEventListener('lostpointercapture', this._onPointerUp, false);
      dom.removeEventListener('wheel', this._onWheel, { passive: false });
      dom.removeEventListener('contextmenu', this._onContextMenu, false);
    }
    this._listeners.clear();
  }

  /* ---- mouse pixel → radian accumulation with the per-event bound ---- */
  _implausiblePx(dx, dy) {
    const s = this.settings;
    const capX = MAX_EVENT_RAD / (TUNE.cam.orbitSpeedMouse * s.camSensX);
    const capY = MAX_EVENT_RAD / (TUNE.cam.orbitSpeedMouse * s.camSensY);
    return dx > capX || dx < -capX || dy > capY || dy < -capY;
  }

  _accumMousePx(dx, dy) {
    const s = this.settings;
    let rx = dx * TUNE.cam.orbitSpeedMouse * s.camSensX;
    let ry = dy * TUNE.cam.orbitSpeedMouse * s.camSensY;
    let clamped = false;
    if (rx > MAX_EVENT_RAD) { rx = MAX_EVENT_RAD; clamped = true; } else if (rx < -MAX_EVENT_RAD) { rx = -MAX_EVENT_RAD; clamped = true; }
    if (ry > MAX_EVENT_RAD) { ry = MAX_EVENT_RAD; clamped = true; } else if (ry < -MAX_EVENT_RAD) { ry = -MAX_EVENT_RAD; clamped = true; }
    if (clamped) this.lookDrops.clamped++;
    if (s.invertX) rx = -rx;
    if (s.invertY) ry = -ry;
    this._mouseRadX += rx;
    this._mouseRadY += ry;
  }

  _endDrag() {
    const d = this._drag;
    if (d.active && IS_BROWSER && this.dom && this.dom.releasePointerCapture && d.id >= 0) {
      try { this.dom.releasePointerCapture(d.id); } catch (e) {}
    }
    d.active = false; d.id = -1; d.dist = 0;
    this.dragging = false;
  }

  /* ---- raw code -> action edges ---- */
  _pressCode(code, fromKeyboard) {
    const list = this._codeMap[code];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const st = this._acts[list[i]];
      /* ONE action, ONE edge. `crouch` is bound to Ctrl AND C AND Shift, and a
         pad button can hold the same action: pressing a second source while the
         action is already held must NOT queue a second press — that reads as two
         separate intents downstream (two pounds, two jumps out of one hold). The
         edge belongs to the transition not-held → held. */
      if (!st.kbd && !st.pad) st.pressQ++;
      if (fromKeyboard) st.kbd = true;
    }
  }

  _releaseCode(code, fromKeyboard) {
    const list = this._codeMap[code];
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const st = this._acts[a];
      /* Only clear if no other bound code for this action is still down. */
      if (fromKeyboard) st.kbd = this._anyBoundCodeDown(a);
      /* Symmetric to _pressCode: releasing ONE of several held sources is not a
         release edge. A spurious jumpReleased is a jump-cut (vy × jumpCut) the
         player never asked for — the single most damaging false edge here. */
      if (!st.kbd && !st.pad) st.releaseQ++;
    }
  }

  _anyBoundCodeDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (this._downCodes[codes[i]]) return true;
    return false;
  }

  /**
   * Focus loss / lock loss: every physically-down code is forgotten. One release
   * edge per ACTION that was keyboard-held (not one per code), and never for an
   * action a connected pad is still holding.
   */
  _releaseAllKeys() {
    for (const code in this._downCodes) if (this._downCodes[code]) this._downCodes[code] = 0;
    for (let i = 0; i < BINDABLE.length; i++) {
      const st = this._acts[BINDABLE[i]];
      if (st.kbd && !st.pad) st.releaseQ++;
      st.kbd = false;
    }
  }

  /* ======================================================================
   * Gamepad
   * ====================================================================*/
  _adoptPad(index, id, mapping) {
    const fresh = index !== this._padIndex || !this.gamepad.connected;
    this._padIndex = index;
    this.gamepad.index = index;
    this.gamepad.id = id || 'gamepad';
    this.gamepad.mapping = mapping || '';
    if (fresh) {
      this._resetPadLookArming();    // a fresh device has not moved a stick yet
      this._padCur.fill(0);
      this._clearPadHeld();
      this.gamepad.connected = true;
      this._emit('gamepadconnected', true);
    }
  }

  _dropPad() {
    if (!this.gamepad.connected && this._padIndex < 0) return;
    this._padIndex = -1;
    this.gamepad.connected = false;
    this.gamepad.id = '';
    this.gamepad.index = -1;
    this.gamepad.mapping = '';
    this._padCur.fill(0);
    this._padStickX = 0; this._padStickY = 0;
    this._resetPadLookArming();
    this._clearPadHeld();
    this._emit('gamepaddisconnected', false);
  }

  /** Drop every pad-held flag (and its edge memory) without touching keyboard state. */
  _clearPadHeld() {
    for (let i = 0; i < BINDABLE.length; i++) {
      const st = this._acts[BINDABLE[i]];
      st.pad = false; st.padWas = false;
    }
  }

  /** Forget which device we were watching: a new pad must earn look again. */
  _resetPadLookArming() {
    this.padLookArmed = false;
    this._padLookRestX = NaN;
    this._padLookRestY = NaN;
    this._padLookX = 0;
    this._padLookY = 0;
  }

  _pollGamepad(dt) {
    this._padStickX = 0; this._padStickY = 0;
    this._padLookX = 0; this._padLookY = 0;
    this._padAnyEdge = false;

    let pad = null;
    if (this._vpad) {
      pad = this._vpad;                       // harness virtual pad
      if (!this.gamepad.connected) this._adoptPad(99, 'virtual', 'standard');
    } else {
      if (!IS_BROWSER || !navigator.getGamepads) return;
      let pads;
      try { pads = navigator.getGamepads(); } catch (e) { return; }
      if (!pads) return;
      if (this._padIndex >= 0 && this._padIndex < pads.length && pads[this._padIndex]) {
        pad = pads[this._padIndex];
      } else {
        for (let i = 0; i < pads.length; i++) {
          const p = pads[i];
          if (p && p.connected) { pad = p; break; }
        }
      }
      if (!pad || !pad.connected) { if (this.gamepad.connected) this._dropPad(); return; }
      if (pad.index !== this._padIndex || !this.gamepad.connected) this._adoptPad(pad.index, pad.id, pad.mapping);
    }

    const ax = pad.axes;
    const btns = pad.buttons;

    /* --- left stick: THE analog control. Radial deadzone, outer ring, mag = clamped radial. --- */
    if (ax && ax.length >= 2) {
      const lx = isFiniteNum(ax[0]) ? ax[0] : 0;
      const ly = isFiniteNum(ax[1]) ? ax[1] : 0;
      const r = Math.sqrt(lx * lx + ly * ly);
      if (r > STICK_DEAD) {
        const mag = clamp01((r - STICK_DEAD) / (STICK_OUTER - STICK_DEAD));
        const inv = mag / r;
        this._padStickX = lx * inv;
        this._padStickY = -ly * inv;      // pad +Y is "down"; game +Y is forward
      }
    }

    /* --- right stick: orbit at TUNE.cam.orbitSpeedKey rad/s × curve × sens --- */
    if (ax && ax.length >= 4) {
      const rawX = isFiniteNum(ax[2]) ? ax[2] : 0;
      const rawY = isFiniteNum(ax[3]) ? ax[3] : 0;
      /* PHANTOM-DEVICE GUARD (Ascendant): keyboards/wheels/flight sticks
         enumerate as pads with an axis parked at −1; magnitude cannot tell a
         parked axis from a held stick, MOVEMENT can. Arm look only once an
         axis has travelled a deadzone away from where it was first seen. */
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
        const s = this.settings;
        const rx = curveAxis(rawX, STICK_DEAD_LOOK, LOOK_CURVE);
        const ry = curveAxis(rawY, STICK_DEAD_LOOK, LOOK_CURVE);
        const step = TUNE.cam.orbitSpeedKey * dt;
        this._padLookX = rx * step * s.camSensX * (s.invertX ? -1 : 1);
        this._padLookY = ry * step * s.camSensY * (s.invertY ? -1 : 1);
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

    /* Edges are derived from the ACTION's held state, not from the button's:
       two buttons map to `recenter` (RB and the right-stick click), so a
       per-button edge would fire it twice when a player uses both. Pass 1
       remembers last frame, pass 2 recomputes held, pass 3 emits one edge. */
    for (let i = 0; i < BINDABLE.length; i++) {
      const st = this._acts[BINDABLE[i]];
      st.padWas = st.pad;
      st.pad = false;
    }
    for (let i = 0; i < PAD_ACTION_BUTTONS.length; i++) {
      const st = this._acts[PAD_ACTION_BUTTONS[i][1]];
      if (st && this._padCur[PAD_ACTION_BUTTONS[i][0]]) st.pad = true;
    }
    for (let i = 0; i < BINDABLE.length; i++) {
      const st = this._acts[BINDABLE[i]];
      if (st.pad === st.padWas) continue;
      /* A key already holding the action owns the edge; the pad only adds one. */
      if (st.kbd) continue;
      if (st.pad) { st.pressQ++; this._padAnyEdge = true; }
      else st.releaseQ++;
    }
  }

  /**
   * Haptics, gated by Settings.gamepadVibrate. Safe no-op everywhere else.
   * @param {number} strong 0..1 low-frequency motor
   * @param {number} weak   0..1 high-frequency motor (defaults to 0.6 × strong)
   * @param {number} ms     duration, clamped to 2 s
   */
  rumble(strong, weak, ms) {
    if (!this.settings.gamepadVibrate) return false;
    if (!IS_BROWSER || !navigator.getGamepads || this._padIndex < 0 || this._vpad) return false;
    try {
      const pads = navigator.getGamepads();
      const pad = pads && pads[this._padIndex];
      const act = pad && pad.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        const p = act.playEffect('dual-rumble', {
          startDelay: 0,
          duration: Math.max(0, Math.min(2000, ms || 120)),
          strongMagnitude: clamp01(strong || 0),
          weakMagnitude: clamp01(weak === undefined || weak === null ? (strong || 0) * 0.6 : weak),
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ======================================================================
   * Per-frame update — call ONCE, before player.update
   * ====================================================================*/
  update(dt) {
    const d = isFiniteNum(dt) && dt > 0 ? (dt > 0.05 ? 0.05 : dt) : 1 / 60;
    const suspended = this.suspended;

    this._pollGamepad(d);

    /* ---- resolve every action + axis: held + edges ---- */
    let anyRaw = false;
    for (let i = 0; i < BINDABLE.length; i++) {
      const a = BINDABLE[i];
      const st = this._acts[a];
      const rawHeld = st.kbd || st.pad;
      let pressed = st.pressQ > 0;
      let released = st.releaseQ > 0;
      /* A key held across frames without a fresh event is neither edge. */
      if (!pressed && rawHeld && !st.held) pressed = true;
      if (!released && !rawHeld && st.held) released = true;
      st.pressQ = 0; st.releaseQ = 0;
      if (pressed) anyRaw = true;

      const blocked = suspended && !MENU_ACTIONS[a];
      st.held = rawHeld;
      st.pressed = blocked ? false : pressed;
      st.released = blocked ? false : released;
    }
    this.anyPressed = anyRaw;
    if (anyRaw) this._emit('anykey', this._padAnyEdge ? 'pad' : 'key');

    /* ---- movement: keyboard/D-pad analog ramp → vector, + left stick, + injection ---- */
    let mx = 0, my = 0, mag = 0;
    if (!suspended) {
      const acts = this._acts;
      /* Locals only: a module-scope scratch OBJECT would box every double it
         holds into a fresh HeapNumber each frame. `let` stays in a register. */
      let kx = this._ramp(acts.moveRight, d) - this._ramp(acts.moveLeft, d);
      let ky = this._ramp(acts.moveForward, d) - this._ramp(acts.moveBack, d);
      let len = Math.sqrt(kx * kx + ky * ky);
      if (len > 1) { kx /= len; ky /= len; }                             // diagonals normalised
      if (this._testStick.active) {
        mx = this._testStick.x; my = this._testStick.y;                  // OVERRIDES keyboard + pad
      } else {
        mx = kx + this._padStickX;
        my = ky + this._padStickY;
      }
      len = Math.sqrt(mx * mx + my * my);
      if (len > 1) { mx /= len; my /= len; len = 1; }
      mag = len;
    } else {
      /* Menus: ramps snap to zero so resuming never replays a stale run. */
      this._acts.moveForward.v = 0; this._acts.moveBack.v = 0;
      this._acts.moveLeft.v = 0; this._acts.moveRight.v = 0;
    }
    this.move.x = mx;
    this.move.y = my;
    this.move.mag = mag;

    /* ---- look: consume every accumulator exactly once (radians) ---- */
    let lx = this._mouseRadX + this._injRadX;
    let ly = this._mouseRadY + this._injRadY;
    this._mouseRadX = 0; this._mouseRadY = 0;
    this._injRadX = 0; this._injRadY = 0;
    if (suspended) { lx = 0; ly = 0; }
    /* Per-FRAME ceiling in the angle the player will see, scaled by the REAL
       frame length (not the sim clamp) so a hitch that legitimately gathered a
       whole flick still delivers it. Backstop for a burst of bounded events. */
    const capDt = isFiniteNum(dt) && dt > 0 ? (dt > 0.25 ? 0.25 : dt) : 1 / 60;
    let capRad = MAX_LOOK_RAD_PER_SEC * capDt;
    if (capRad < MAX_EVENT_RAD) capRad = MAX_EVENT_RAD;
    if (lx > capRad || lx < -capRad || ly > capRad || ly < -capRad) {
      this.lookDrops.frame++;
      if (lx > capRad) lx = capRad; else if (lx < -capRad) lx = -capRad;
      if (ly > capRad) ly = capRad; else if (ly < -capRad) ly = -capRad;
    }
    if (!suspended) {
      /* Right stick (already rad this frame, sens+invert applied). */
      lx += this._padLookX; ly += this._padLookY;
      /* Q/E/R/V: explicit directions at orbitSpeedKey rad/s — no invert, no sens. */
      const kstep = TUNE.cam.orbitSpeedKey * d;
      const A = this._acts;
      if (A.orbitRight.held) lx += kstep;
      if (A.orbitLeft.held) lx -= kstep;
      if (A.orbitDown.held) ly += kstep;
      if (A.orbitUp.held) ly -= kstep;
    }
    this.look.dx = isFiniteNum(lx) ? lx : 0;
    this.look.dy = isFiniteNum(ly) ? ly : 0;
    this.orbiting = this.look.dx !== 0 || this.look.dy !== 0;

    /* ---- wheel zoom ---- */
    const wz = this._wheelPx; this._wheelPx = 0;
    this.zoom = suspended ? 0 : -wz * WHEEL_ZOOM_PER_PX;

    /* ---- flatten to the contract's public booleans ---- */
    const A = this._acts;
    const j = A.jump;
    this.jump = this.jumpHeld = j.held && !suspended;
    this.jumpPressed = j.pressed;
    this.jumpReleased = j.released;

    const cr = A.crouch;
    this.crouch = cr.held && !suspended;
    this.crouchPressed = cr.pressed;
    this.crouchReleased = cr.released;

    const dv = A.dive;
    this.dive = dv.held && !suspended;
    this.divePressed = dv.pressed;

    /* pound = crouch while airborne (controller decides). Symmetric with
       crouch, plus any pound-only binding a player may set. */
    const po = A.pound;
    this.pound = this.crouch || (po.held && !suspended);
    this.poundPressed = this.crouchPressed || po.pressed;

    this.recenterPressed = A.recenter.pressed;

    const pk = A.peek;
    this.peek = pk.held && !suspended;
    this.peekPressed = pk.pressed;
    this.peekReleased = pk.released;

    const it = A.interact;
    this.interact = it.held && !suspended;
    this.interactPressed = it.pressed;

    const rs = A.restart;
    this.restart = rs.held && !suspended;
    this.restartPressed = rs.pressed;

    this.toCheckpointPressed = A.toCheckpoint.pressed;
    this.pausePressed = A.pause.pressed;
    this.camTogglePressed = A.camToggle.pressed;
    this.mutePressed = A.mute.pressed;
    this.fullscreenPressed = A.fullscreen.pressed;
    this.devPressed = A.dev.pressed;

    /* ---- side channels ---- */
    if (this.mutePressed) this._emit('mute');   // game_controls.js already toggled the page mute on KeyM
    if (this.fullscreenPressed) {
      if (!this._emit('fullscreen')) {
        try {
          if (IS_BROWSER && window.__CONTROLS__ && window.__CONTROLS__.toggleFullscreen) window.__CONTROLS__.toggleFullscreen();
        } catch (e) {}
      }
    }
  }

  /**
   * Analog ramp for one digital axis: toward 1 at 1/KEY_RAMP_UP per second
   * while held, toward 0 at 1/KEY_RAMP_DOWN when released. A key tapped for
   * one 60 Hz frame peaks at 0.185 (walk); 50 ms → 0.56; a hold hits 1 at 90 ms.
   *
   * `st.pressed` counts as held for exactly the frame the press landed: a tap
   * whose keydown AND keyup fall between two frames is never `held` on any
   * frame, and without this the hero would not move at all for it. THE
   * contract promise is "a tap produces a walk", so the shortest possible tap
   * must still produce the smallest possible walk.
   */
  _ramp(st, d) {
    const target = (st.held || st.pressed) ? 1 : 0;
    let v = st.v;
    if (v === target) return v;
    if (target > v) { v += d / KEY_RAMP_UP; if (v > 1) v = 1; }
    else { v -= d / KEY_RAMP_DOWN; if (v < 0) v = 0; }
    st.v = v;
    return v;
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
    this._endDrag();
    this._mouseRadX = 0; this._mouseRadY = 0;
    this._injRadX = 0; this._injRadY = 0; this._wheelPx = 0;
    this._padStickX = 0; this._padStickY = 0;
    this._padLookX = 0; this._padLookY = 0;
    for (let i = 0; i < BINDABLE.length; i++) {
      const st = this._acts[BINDABLE[i]];
      st.held = false; st.pressed = false; st.released = false;
      st.pressQ = 0; st.releaseQ = 0; st.pad = false; st.padWas = false; st.v = 0;
    }
    this._zeroPublic();
  }

  _zeroPublic() {
    this.move.x = 0; this.move.y = 0; this.move.mag = 0;
    this.look.dx = 0; this.look.dy = 0;
    this.zoom = 0; this.orbiting = false;
    this.jump = this.jumpHeld = this.crouch = this.dive = this.pound = this.peek = this.interact = this.restart = false;
    this.jumpPressed = this.jumpReleased = this.crouchPressed = this.crouchReleased = false;
    this.divePressed = this.poundPressed = this.recenterPressed = this.peekPressed = this.peekReleased = false;
    this.interactPressed = this.restartPressed = this.toCheckpointPressed = false;
  }

  /**
   * Contract-facing flag. An accessor rather than a plain field so that a
   * direct `input.suspended = true` ALSO drops the held state immediately —
   * otherwise a menu opened mid-run would leave one frame of stale movement,
   * and closing it would resume a run the player is no longer holding.
   */
  get suspended() { return this._suspended; }
  set suspended(v) { this.setSuspended(v); }

  /** Menus call this. Keeps pause/mute/fullscreen/dev/camToggle alive. */
  setSuspended(v) {
    const next = !!v;
    if (this.devNoSuspend && next) return;
    if (next === this._suspended) return;
    this._suspended = next;
    if (next) {
      this._mouseRadX = 0; this._mouseRadY = 0; this._injRadX = 0; this._injRadY = 0; this._wheelPx = 0;
      this._endDrag();
      this._acts.moveForward.v = 0; this._acts.moveBack.v = 0;
      this._acts.moveLeft.v = 0; this._acts.moveRight.v = 0;
      this._zeroPublic();
    }
  }

  /* ======================================================================
   * Harness surface — drives the REAL paths (doctrine §5)
   * ====================================================================*/
  _buildTestSurface() {
    const self = this;
    /* Synthetic pointer events are untrusted; the harness opts in explicitly. */
    this._allowUntrustedPointer = false;

    function dispatchKey(type, code) {
      if (!IS_BROWSER || typeof KeyboardEvent === 'undefined') return false;
      let ev;
      try {
        ev = new KeyboardEvent(type, { code: code, key: keyForCode(code), bubbles: true, cancelable: true });
      } catch (e) { return false; }
      try { return window.dispatchEvent(ev); } catch (e) { return false; }
    }

    return {
      /** Dispatch a REAL keydown on window (code + key). */
      press(code) { return dispatchKey('keydown', code); },
      /** Dispatch a REAL keyup on window. */
      release(code) { return dispatchKey('keyup', code); },
      /**
       * Inject an analog stick vector (x right, y forward, |v| ≤ 1). Overrides
       * keyboard + gamepad until stick(0, 0).
       */
      stick(x, y) {
        const ts = self._testStick;
        const vx = isFiniteNum(x) ? x : 0, vy = isFiniteNum(y) ? y : 0;
        if (vx === 0 && vy === 0) { ts.active = false; ts.x = 0; ts.y = 0; return; }
        const r = Math.sqrt(vx * vx + vy * vy);
        const k = r > 1 ? 1 / r : 1;
        ts.active = true; ts.x = vx * k; ts.y = vy * k;
      },
      /** Inject orbit radians for the next update() (raw — no sens/invert). */
      look(dx, dy) {
        self._injRadX += isFiniteNum(dx) ? dx : 0;
        self._injRadY += isFiniteNum(dy) ? dy : 0;
      },
      /**
       * Virtual standard-mapping gamepad through the real polling path.
       * pad(index, down) sets a button; padAxes(lx, ly, rx, ry) sets sticks;
       * pad(null) removes the virtual pad.
       */
      pad(index, down) {
        if (index === null) { self._vpad = null; self._dropPad(); return; }
        const vp = self._ensureVPad();
        const i = index | 0;
        if (i >= 0 && i < PAD_BUTTON_COUNT) { vp.buttons[i].pressed = !!down; vp.buttons[i].value = down ? 1 : 0; }
      },
      padAxes(lx, ly, rx, ry) {
        const vp = self._ensureVPad();
        vp.axes[0] = isFiniteNum(lx) ? lx : 0; vp.axes[1] = isFiniteNum(ly) ? ly : 0;
        vp.axes[2] = isFiniteNum(rx) ? rx : 0; vp.axes[3] = isFiniteNum(ry) ? ry : 0;
      },
      /** Let synthetic (untrusted) pointer events drive drag-orbit + canvasclick. */
      allowUntrustedPointer(v) { self._allowUntrustedPointer = !!v; },
      /** Simulate pointer-lock state without the browser (harness only). */
      setLocked(v) {
        const next = !!v;
        if (next === self.pointerLocked) return;
        self.pointerLocked = next;
        if (next) { self._lockSettle = LOCK_SETTLE_EVENTS; self.lockCount++; self._emit('lock'); }
        else { self._releaseAllKeys(); self._emit('unlock', 'external'); }
      },
      /** Snapshot for dumps (allocates — harness only). */
      state() {
        return {
          move: { x: self.move.x, y: self.move.y, mag: self.move.mag },
          look: { dx: self.look.dx, dy: self.look.dy },
          jump: self.jump, jumpPressed: self.jumpPressed, jumpReleased: self.jumpReleased,
          crouch: self.crouch, crouchPressed: self.crouchPressed, dive: self.dive, divePressed: self.divePressed,
          pound: self.pound, poundPressed: self.poundPressed, peek: self.peek, recenterPressed: self.recenterPressed,
          interactPressed: self.interactPressed, pausePressed: self.pausePressed, restartPressed: self.restartPressed,
          toCheckpointPressed: self.toCheckpointPressed, camTogglePressed: self.camTogglePressed,
          suspended: self.suspended, pointerLocked: self.pointerLocked, dragging: self.dragging,
          gamepad: self.gamepad.connected, lookDrops: Object.assign({}, self.lookDrops),
          settings: Object.assign({}, self.settings),
        };
      },
    };
  }

  _ensureVPad() {
    if (this._vpad) return this._vpad;
    const buttons = [];
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) buttons.push({ pressed: false, touched: false, value: 0 });
    this._vpad = { index: 99, id: 'virtual', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: buttons };
    return this._vpad;
  }
}

export default Input;
