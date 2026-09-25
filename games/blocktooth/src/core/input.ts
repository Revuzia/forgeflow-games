// BLOCKTOOTH — keyboard + gamepad input (CONTRACT.md §14).
//
// App-side module (it listens to DOM events and polls the Gamepad API). The SIM never sees
// this class — it only receives the latched, world-space `TitanInput` built by titanInput().
//
// Model
//   * Keyboard by `event.code` (layout-independent). Key events only QUEUE edges; update()
//     (once per rendered frame) latches them, so pressed(a) is true for exactly the frame
//     after the press. update() is idempotent within one animation frame (keyed on
//     document.timeline.currentTime), so the app loop and a UI screen may both call it.
//   * Gamepads (standard mapping) are polled in update(): left stick (radial deadzone 0.2 with
//     rescale) + d-pad. A = confirm (ui) / HOOK (game); B = back (ui) / DASH (game); RB = dash;
//     Start = pause; X = reroll.
//   * Gameplay actions (ability, dash, stick/move) read false / zero while mode === 'ui'.
//   * Flipping `mode` clears every edge + buffer. game → ui: every key/button held at the flip
//     is DEAD until physically released (the stick until it recentres), so a held direction can
//     never navigate the menu that just opened. ui → game: only movement (WASD / arrows / d-pad /
//     stick) held through the screen stays live — the titan keeps walking without a re-press —
//     while the Space/Enter/digit that confirmed the menu stays dead and can never leak into the
//     first gameplay tick.
//   * Keys shared by gameplay and UI (Space, pad A, pad B) do not CONFIRM/BACK for
//     `sharedKeyGuardS` after a game → ui flip, so mashing the hook when a draft pops up
//     cannot pick a card blind. Enter / 1 / 2 / 3 / R / Esc are never guarded.
//   * ability / dash presses are additionally BUFFERED for INPUT_BUFFER_S and consumed by the
//     first titanInput() call inside that window — exactly once, however many sim ticks run in
//     the frame (a press between two 30 Hz ticks is never lost, never doubled).
//   * Window blur / hidden tab releases everything.
//   * Camera ZOOM (view-only, never reaches the sim): mouse wheel, '=' / '-' (and numpad + / -) held,
//     gamepad right stick vertical; Z / pad R3 resets. zoomInput(dt) returns this frame's ln-zoom
//     delta (+ = pull back / see more). All zero in ui mode (a wheel over a menu scrolls the menu).

import type { TitanInput } from './types.ts';
import { INPUT_BUFFER_S, screenToWorld } from './config.ts';

export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'confirm' | 'back' | 'pause' | 'debug'
  | 'ability' | 'dash' | 'ultimate'   // v2: UPROAR (FEATURES_V2 §2.4)
  | 'pick1' | 'pick2' | 'pick3' | 'reroll'
  | 'zoomIn' | 'zoomOut' | 'zoomReset';

export const ACTIONS: readonly Action[] = [
  'up', 'down', 'left', 'right', 'confirm', 'back', 'pause', 'debug', 'ability', 'dash', 'ultimate', 'pick1', 'pick2', 'pick3', 'reroll',
  'zoomIn', 'zoomOut', 'zoomReset',
];

export type InputMode = 'ui' | 'game';
export type InputDevice = 'keyboard' | 'gamepad';

// ─────────────────────────────── tuning ───────────────────────────────
/** radial stick deadzone (magnitude), rescaled so the live range starts at 0 */
export const STICK_DEADZONE = 0.2;
/** stick → menu navigation: engage above, release below (hysteresis) */
const NAV_PRESS = 0.55;
const NAV_RELEASE = 0.35;
/** gamepad menu auto-repeat (keyboard uses the OS key-repeat) */
const NAV_REPEAT_DELAY_MS = 380;
const NAV_REPEAT_EVERY_MS = 110;
/** default guard for shared gameplay/UI keys after a game → ui flip (s) */
export const SHARED_KEY_GUARD_S = 0.35;
/** zoom: ln-zoom per wheel notch (≈ ×1.13), per second of a held key, per second of full right stick */
export const ZOOM_WHEEL_STEP = 0.12;
export const ZOOM_KEY_RATE = 1.35;
export const ZOOM_PAD_RATE = 1.5;
/** right-stick deadzone for zoom (vertical axis only) */
const ZOOM_PAD_DEADZONE = 0.25;
/** most notches one frame may apply (a free-spinning wheel / trackpad fling) */
const ZOOM_WHEEL_MAX_NOTCHES = 6;

// ─────────────────────────────── keyboard map ───────────────────────────────
const KEYMAP: Readonly<Record<string, readonly Action[]>> = {
  KeyW: ['up'], ArrowUp: ['up'],
  KeyS: ['down'], ArrowDown: ['down'],
  KeyA: ['left'], ArrowLeft: ['left'],
  KeyD: ['right'], ArrowRight: ['right'],
  Space: ['ability', 'confirm'],
  Enter: ['confirm'], NumpadEnter: ['confirm'],
  ShiftLeft: ['dash'], ShiftRight: ['dash'],
  Escape: ['back', 'pause'],
  KeyP: ['pause'],
  F1: ['debug'],
  Digit1: ['pick1'], Digit2: ['pick2'], Digit3: ['pick3'],
  Numpad1: ['pick1'], Numpad2: ['pick2'], Numpad3: ['pick3'],
  KeyR: ['reroll'],
  Equal: ['zoomIn'], NumpadAdd: ['zoomIn'],
  Minus: ['zoomOut'], NumpadSubtract: ['zoomOut'],
  KeyZ: ['zoomReset'],
  KeyE: ['ultimate'],                 // v2 UPROAR (pad Y / RT in pollPads)
};

/** reverse map: action → key codes */
const ACTION_CODES: Record<Action, string[]> = (() => {
  const out = {} as Record<Action, string[]>;
  for (const a of ACTIONS) out[a] = [];
  for (const code of Object.keys(KEYMAP)) for (const a of KEYMAP[code]) out[a].push(code);
  return out;
})();

/** default browser behaviour suppressed for these (page scroll, focus hop, help, sticky keys) */
const PREVENT_CODES: ReadonlySet<string> = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'F1', 'Tab',
]);
const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'Tab', 'F1', 'OSLeft', 'OSRight', 'ContextMenu',
]);
const GAMEPLAY: ReadonlySet<Action> = new Set<Action>(['ability', 'dash', 'ultimate']);
/** camera actions: like GAMEPLAY they only exist in 'game' mode, but they are never buffered */
const VIEW: ReadonlySet<Action> = new Set<Action>(['zoomIn', 'zoomOut', 'zoomReset']);
const NAV: readonly Action[] = ['up', 'down', 'left', 'right'];
/** keys that mean something in gameplay AND in menus (guarded after game → ui) */
const SHARED_KEY_CODES: ReadonlySet<string> = new Set(['Space']);
const MOVE_CODES = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
} as const;
/** every movement key code (live across a ui → game flip; see the mode setter) */
const MOVE_CODE_SET: ReadonlySet<string> = new Set<string>([
  ...MOVE_CODES.up, ...MOVE_CODES.down, ...MOVE_CODES.left, ...MOVE_CODES.right,
]);

// ─────────────────────────────── gamepad map (standard mapping) ───────────────────────────────
const PAD_BUTTONS = 17;
const PAD_A = 0, PAD_B = 1, PAD_X = 2, PAD_Y = 3, PAD_RB = 5, PAD_RT = 7, PAD_SELECT = 8, PAD_START = 9, PAD_R3 = 11;
const PAD_UP = 12, PAD_DOWN = 13, PAD_LEFT = 14, PAD_RIGHT = 15;
/** d-pad buttons: movement in play (live across a ui → game flip, like the movement keys) */
const PAD_MOVE_BUTTONS: readonly number[] = [PAD_UP, PAD_DOWN, PAD_LEFT, PAD_RIGHT];
/** buttons that count for "press any key" */
const PAD_ANY: readonly number[] = [PAD_A, PAD_B, PAD_X, PAD_Y, PAD_START, PAD_SELECT, PAD_UP, PAD_DOWN, PAD_LEFT, PAD_RIGHT];

function clockNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** True when a key event targets a text-entry element (let the user type; do not steal keys). */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return t !== 'range' && t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit' && t !== 'reset' && t !== 'color';
  }
  return false;
}

/** Short on-screen key hint for an action ('SPACE', 'SHIFT', 'ENTER', 'A', …). */
export function actionLabel(a: Action, device: InputDevice = 'keyboard'): string {
  if (device === 'gamepad') {
    switch (a) {
      case 'up': return 'D-PAD UP';
      case 'down': return 'D-PAD DOWN';
      case 'left': return 'D-PAD LEFT';
      case 'right': return 'D-PAD RIGHT';
      case 'confirm': return 'A';
      case 'back': return 'B';
      case 'pause': return 'START';
      case 'debug': return 'F1';
      case 'ability': return 'A';
      case 'dash': return 'B';
      case 'ultimate': return 'Y';
      case 'pick1': case 'pick2': case 'pick3': return 'A';
      case 'reroll': return 'X';
      case 'zoomIn': return 'R-STICK UP';
      case 'zoomOut': return 'R-STICK DOWN';
      case 'zoomReset': return 'R3';
    }
  }
  switch (a) {
    case 'up': return 'W';
    case 'down': return 'S';
    case 'left': return 'A';
    case 'right': return 'D';
    case 'confirm': return 'ENTER';
    case 'back': return 'ESC';
    case 'pause': return 'ESC';
    case 'debug': return 'F1';
    case 'ability': return 'SPACE';
    case 'dash': return 'SHIFT';
    case 'ultimate': return 'E';
    case 'pick1': return '1';
    case 'pick2': return '2';
    case 'pick3': return '3';
    case 'reroll': return 'R';
    case 'zoomIn': return '=';
    case 'zoomOut': return '-';
    case 'zoomReset': return 'Z';
  }
}

export class Input {
  /** after a game → ui flip, Space / pad A / pad B do not confirm/back for this long (s). 0 disables. */
  sharedKeyGuardS = SHARED_KEY_GUARD_S;
  /**
   * How long a buffered HOOK / DASH press waits for a sim tick to consume it (s). The app widens
   * it while the sim runs slowed (rank-up hit-stop: one tick per SIM_DT / timeScale of real time),
   * so a press between two slowed ticks is never dropped. Never below INPUT_BUFFER_S.
   */
  bufferS = INPUT_BUFFER_S;

  private readonly win: Window;
  private _mode: InputMode = 'ui';
  private _lastDevice: InputDevice = 'keyboard';
  private uiSince = -Infinity;          // clock (ms) of the last game → ui flip

  // keyboard
  private readonly keysDown = new Set<string>();
  private readonly keysDead = new Set<string>();   // held across a mode flip / blur: ignored until released
  private readonly pending = new Set<Action>();    // queued by key events, latched by update()
  private pendingAny = false;
  // latched for this frame
  private readonly edges = new Set<Action>();
  private anyEdge = false;
  private lastFrameKey: number | null = null;

  // ability / dash buffers (clock ms of the unconsumed press, or -Infinity)
  private abilityAt = -Infinity;
  private dashAt = -Infinity;
  /** v2 UPROAR buffer (same rule as ability / dash) */
  private ultimateAt = -Infinity;

  // gamepad
  private readonly padDown: boolean[] = new Array<boolean>(PAD_BUTTONS).fill(false);
  private readonly padPrev: boolean[] = new Array<boolean>(PAD_BUTTONS).fill(false);
  private readonly padDead: boolean[] = new Array<boolean>(PAD_BUTTONS).fill(false);
  private padRawMag = 0;
  private padSX = 0;                     // deadzoned stick, screen space (x right, y up)
  private padSY = 0;
  private padRY = 0;                     // right stick vertical, deadzoned (down = +)
  private wheelNotches = 0;              // queued wheel notches (+ = zoom out), game mode only
  private stickDead = false;             // held across a mode flip: ignored until it recentres
  private readonly navOn: Record<'up' | 'down' | 'left' | 'right', boolean> = { up: false, down: false, left: false, right: false };
  private readonly navNext: Record<'up' | 'down' | 'left' | 'right', number> = { up: 0, down: 0, left: 0, right: 0 };

  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  private readonly onVisibility: () => void;
  private readonly onWheel: (e: WheelEvent) => void;

  constructor(win: Window) {
    this.win = win;
    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keyUp(e);
    this.onBlur = () => this.releaseAll();
    this.onVisibility = () => { if (this.win.document && this.win.document.hidden) this.releaseAll(); };
    this.onWheel = (e) => this.wheel(e);
    win.addEventListener('keydown', this.onKeyDown);
    win.addEventListener('keyup', this.onKeyUp);
    win.addEventListener('blur', this.onBlur);
    win.addEventListener('wheel', this.onWheel, { passive: false });
    if (win.document) win.document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Detach every listener (page teardown / tests). */
  dispose(): void {
    this.win.removeEventListener('keydown', this.onKeyDown);
    this.win.removeEventListener('keyup', this.onKeyUp);
    this.win.removeEventListener('blur', this.onBlur);
    this.win.removeEventListener('wheel', this.onWheel);
    if (this.win.document) this.win.document.removeEventListener('visibilitychange', this.onVisibility);
    this.releaseAll();
  }

  // ─────────────────────────────── mode ───────────────────────────────
  /** 'ui' while any screen owns input (title/select/slate/draft/pause/tabloid); 'game' in play. */
  get mode(): InputMode { return this._mode; }
  set mode(m: InputMode) {
    if (m !== 'ui' && m !== 'game') return;
    if (m === this._mode) return;
    this._mode = m;
    if (m === 'ui') {
      // game → ui: everything held across the flip is dead until released / recentred, so a held
      // direction cannot navigate (and a held Space cannot confirm) the screen that just opened
      for (const c of this.keysDown) this.keysDead.add(c);
      this.keysDown.clear();
      for (let i = 0; i < PAD_BUTTONS; i++) if (this.padDown[i]) this.padDead[i] = true;
      if (this.padRawMag >= STICK_DEADZONE) this.stickDead = true;
    } else {
      // ui → game: MOVEMENT held through a draft / pause / slate stays (or comes back) live, so the
      // titan keeps walking without a re-press — moving cannot leak a menu action. Every other held
      // key / button (Space, Enter, Esc, digits, R, Shift, pad A/B/X/Start) stays dead until released.
      for (const c of this.keysDead) if (MOVE_CODE_SET.has(c)) this.keysDown.add(c);
      for (const c of this.keysDown) {
        if (MOVE_CODE_SET.has(c)) { this.keysDead.delete(c); continue; }
        this.keysDead.add(c);
      }
      for (const c of this.keysDead) this.keysDown.delete(c);
      for (let i = 0; i < PAD_BUTTONS; i++) {
        if (PAD_MOVE_BUTTONS.includes(i)) { this.padDead[i] = false; continue; }
        if (this.padDown[i]) this.padDead[i] = true;
      }
      this.stickDead = false;
    }
    this.navOn.up = this.navOn.down = this.navOn.left = this.navOn.right = false;
    this.clearEdges();
    this.uiSince = m === 'ui' ? clockNow() : -Infinity;
  }

  /** the device that produced the most recent press ('keyboard' | 'gamepad') — for key hints */
  get lastDevice(): InputDevice { return this._lastDevice; }

  // ─────────────────────────────── per frame ───────────────────────────────
  /** Latch queued key edges + poll gamepads. Call once per rendered frame (extra calls in the
   *  same animation frame are ignored). */
  update(): void {
    const key = this.frameKey();
    if (key !== null) {
      if (key === this.lastFrameKey) return;
      this.lastFrameKey = key;
    }
    this.edges.clear();
    for (const a of this.pending) this.edges.add(a);
    this.pending.clear();
    this.anyEdge = this.pendingAny;
    this.pendingAny = false;
    this.pollPads(clockNow());
  }

  /** true for the frame an action was pressed (gameplay actions: game mode only). */
  pressed(a: Action): boolean {
    if ((GAMEPLAY.has(a) || VIEW.has(a)) && this._mode !== 'game') return false;
    return this.edges.has(a);
  }

  /** true while an action is held (gameplay actions: game mode only). */
  held(a: Action): boolean {
    if ((GAMEPLAY.has(a) || VIEW.has(a)) && this._mode !== 'game') return false;
    const codes = ACTION_CODES[a];
    for (let i = 0; i < codes.length; i++) if (this.keysDown.has(codes[i])) return true;
    return this.padHeld(a);
  }

  /** true for the frame any key / pad button was freshly pressed ("PRESS ANY KEY"). */
  anyPressed(): boolean { return this.anyEdge; }

  /** Screen-space move vector (x right, y up), |v| ≤ 1: keys + stick + d-pad. Zero in ui mode. */
  stick(): { x: number; y: number } {
    if (this._mode !== 'game') return { x: 0, y: 0 };
    let x = 0, y = 0;
    // keyboard
    if (this.anyDown(MOVE_CODES.right)) x += 1;
    if (this.anyDown(MOVE_CODES.left)) x -= 1;
    if (this.anyDown(MOVE_CODES.up)) y += 1;
    if (this.anyDown(MOVE_CODES.down)) y -= 1;
    const km = Math.hypot(x, y);
    if (km > 1) { x /= km; y /= km; }
    // gamepad stick + d-pad
    if (!this.stickDead) { x += this.padSX; y += this.padSY; }
    if (this.padLive(PAD_RIGHT)) x += 1;
    if (this.padLive(PAD_LEFT)) x -= 1;
    if (this.padLive(PAD_UP)) y += 1;
    if (this.padLive(PAD_DOWN)) y -= 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  /**
   * This frame's camera zoom request as a ln-zoom delta (+ = pull back / see more): wheel notches
   * queued since the last call + held '=' / '-' + the right stick, over `dt` seconds. Call ONCE per
   * rendered frame. Always 0 in ui mode (and the wheel queue is dropped there). View-only.
   */
  zoomInput(dt: number): number {
    const notches = this.wheelNotches;
    this.wheelNotches = 0;
    if (this._mode !== 'game') return 0;
    const d = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    let z = Math.max(-ZOOM_WHEEL_MAX_NOTCHES, Math.min(ZOOM_WHEEL_MAX_NOTCHES, notches)) * ZOOM_WHEEL_STEP;
    let keys = 0;
    if (this.held('zoomOut')) keys += 1;
    if (this.held('zoomIn')) keys -= 1;
    z += keys * ZOOM_KEY_RATE * d;
    if (!this.stickDead) z += this.padRY * ZOOM_PAD_RATE * d;
    return z;
  }

  /**
   * The latched per-tick command for the sim, move already in WORLD space (screenToWorld).
   * Call once per sim tick. Buffered ability/dash presses are consumed by the first call within
   * INPUT_BUFFER_S of the press — exactly once. All zero/false in ui mode.
   */
  titanInput(): TitanInput {
    if (this._mode !== 'game') return { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
    const s = this.stick();
    const m = screenToWorld(s.x, s.y);
    const now = clockNow();
    const win = Math.max(INPUT_BUFFER_S, Number.isFinite(this.bufferS) ? this.bufferS : 0) * 1000;
    let ability = false, dash = false;
    if (this.abilityAt > -Infinity) {
      ability = now - this.abilityAt <= win;
      this.abilityAt = -Infinity;
    }
    if (this.dashAt > -Infinity) {
      dash = now - this.dashAt <= win;
      this.dashAt = -Infinity;
    }
    let ultimate = false;
    if (this.ultimateAt > -Infinity) {
      ultimate = now - this.ultimateAt <= win;
      this.ultimateAt = -Infinity;
    }
    return { mx: m.mx, mz: m.mz, ability, abilityHeld: this.held('ability'), dash, ultimate };
  }

  /** Forget this frame's edges, queued edges and the ability/dash buffers (a screen consumed them). */
  clearEdges(): void {
    this.edges.clear();
    this.pending.clear();
    this.anyEdge = false;
    this.pendingAny = false;
    this.abilityAt = -Infinity;
    this.dashAt = -Infinity;
    this.ultimateAt = -Infinity;
    this.wheelNotches = 0;
  }

  // ─────────────────────────────── wheel (camera zoom) ───────────────────────────────
  private wheel(e: WheelEvent): void {
    if (this._mode !== 'game' || e.ctrlKey) return;      // menus scroll; ctrl+wheel = browser zoom
    if (isTextEntry(e.target)) return;
    const dy = Number.isFinite(e.deltaY) ? e.deltaY : 0;
    if (dy === 0) return;
    e.preventDefault();                                   // never scroll the page / portal under play
    this._lastDevice = 'keyboard';
    // normalise to notches: pixel mode ≈ 100 px per notch (trackpads send small fractions), line
    // mode 3 lines, page mode 1 page
    const n = e.deltaMode === 1 ? dy / 3 : e.deltaMode === 2 ? dy : dy / 100;
    this.wheelNotches += n;
  }

  // ─────────────────────────────── keyboard ───────────────────────────────
  private keyDown(e: KeyboardEvent): void {
    if (isTextEntry(e.target)) return;
    const code = e.code;
    if (PREVENT_CODES.has(code)) e.preventDefault();
    this._lastDevice = 'keyboard';
    const acts = KEYMAP[code];

    if (e.repeat) {
      // OS auto-repeat: never a new press. Menus get navigation repeat from live (not dead) keys.
      if (acts && this._mode === 'ui' && this.keysDown.has(code)) {
        for (const a of acts) if (NAV.includes(a)) this.pending.add(a);
      }
      return;
    }

    // a fresh press revives a key that was dead across a flip/blur
    this.keysDead.delete(code);
    this.keysDown.add(code);
    const guarded = this.inSharedGuard() && SHARED_KEY_CODES.has(code);
    if (!MODIFIER_CODES.has(code) && !guarded) this.pendingAny = true;
    if (!acts) return;
    for (const a of acts) {
      if (VIEW.has(a)) {
        if (this._mode === 'game') this.pending.add(a);
        continue;
      }
      if (GAMEPLAY.has(a)) {
        if (this._mode === 'game') {
          this.pending.add(a);
          if (a === 'ability') this.abilityAt = clockNow();
          else if (a === 'ultimate') this.ultimateAt = clockNow();
          else this.dashAt = clockNow();
        }
        continue;
      }
      if (guarded && (a === 'confirm' || a === 'back')) continue;
      this.pending.add(a);
    }
  }

  private keyUp(e: KeyboardEvent): void {
    const code = e.code;
    if (PREVENT_CODES.has(code) && !isTextEntry(e.target)) e.preventDefault();
    this.keysDown.delete(code);
    this.keysDead.delete(code);
  }

  /** Blur / hidden tab: drop every held key, edge and buffer; pad buttons held now are dead. */
  private releaseAll(): void {
    this.keysDown.clear();
    this.keysDead.clear();
    for (let i = 0; i < PAD_BUTTONS; i++) if (this.padDown[i]) this.padDead[i] = true;
    if (this.padRawMag >= STICK_DEADZONE) this.stickDead = true;
    this.navOn.up = this.navOn.down = this.navOn.left = this.navOn.right = false;
    this.clearEdges();
  }

  private anyDown(codes: readonly string[]): boolean {
    for (let i = 0; i < codes.length; i++) if (this.keysDown.has(codes[i])) return true;
    return false;
  }

  private inSharedGuard(): boolean {
    return this._mode === 'ui' && this.sharedKeyGuardS > 0 && clockNow() - this.uiSince < this.sharedKeyGuardS * 1000;
  }

  /** document.timeline.currentTime is constant inside one animation frame → once-per-frame key. */
  private frameKey(): number | null {
    try {
      const doc = this.win.document as (Document & { timeline?: { currentTime: unknown } }) | undefined;
      const ct = doc && doc.timeline ? doc.timeline.currentTime : null;
      return typeof ct === 'number' && Number.isFinite(ct) ? ct : null;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────── gamepad ───────────────────────────────
  private padLive(i: number): boolean { return this.padDown[i] && !this.padDead[i]; }

  private padHeld(a: Action): boolean {
    const game = this._mode === 'game';
    switch (a) {
      case 'up': case 'down': case 'left': case 'right': return this.navOn[a];
      case 'confirm': return !game && this.padLive(PAD_A);
      case 'back': return !game && this.padLive(PAD_B);
      case 'ability': return game && this.padLive(PAD_A);
      case 'dash': return game && (this.padLive(PAD_B) || this.padLive(PAD_RB));
      case 'ultimate': return game && (this.padLive(PAD_Y) || this.padLive(PAD_RT));
      case 'pause': return this.padLive(PAD_START);
      case 'reroll': return this.padLive(PAD_X);
      default: return false;
    }
  }

  private readPads(): readonly (Gamepad | null)[] {
    try {
      const nav = this.win.navigator as Navigator | undefined;
      if (!nav || typeof nav.getGamepads !== 'function') return [];
      return nav.getGamepads() || [];
    } catch {
      return [];   // permissions-policy / insecure context
    }
  }

  private pollPads(now: number): void {
    const pads = this.readPads();
    for (let i = 0; i < PAD_BUTTONS; i++) { this.padPrev[i] = this.padDown[i]; this.padDown[i] = false; }
    let ax = 0, ay = 0, best = 0, ry = 0;
    for (let p = 0; p < pads.length; p++) {
      const pad = pads[p];
      if (!pad || !pad.connected) continue;
      const n = Math.min(pad.buttons.length, PAD_BUTTONS);
      for (let i = 0; i < n; i++) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > 0.5)) this.padDown[i] = true;
      }
      const x = pad.axes.length > 0 ? pad.axes[0] : 0;
      const y = pad.axes.length > 1 ? pad.axes[1] : 0;
      const mag = Math.hypot(x, y);
      if (Number.isFinite(mag) && mag > best) { best = mag; ax = x; ay = y; }
      const r = pad.axes.length > 3 ? pad.axes[3] : 0;
      if (Number.isFinite(r) && Math.abs(r) > Math.abs(ry)) ry = r;
    }
    // right stick vertical → zoom (down = pull back); deadzone with rescale
    const ra = Math.abs(ry);
    this.padRY = ra < ZOOM_PAD_DEADZONE ? 0 : Math.sign(ry) * (Math.min(1, ra) - ZOOM_PAD_DEADZONE) / (1 - ZOOM_PAD_DEADZONE);
    if (this.padRY !== 0) this._lastDevice = 'gamepad';

    // stick: radial deadzone with rescale; screen y is up (pad axis 1 is down-positive)
    this.padRawMag = best;
    if (best < STICK_DEADZONE) {
      this.padSX = 0; this.padSY = 0;
      this.stickDead = false;                       // recentred → alive again
    } else {
      const k = (Math.min(best, 1) - STICK_DEADZONE) / (1 - STICK_DEADZONE) / best;
      this.padSX = ax * k;
      this.padSY = -ay * k;
      if (!this.stickDead) this._lastDevice = 'gamepad';
    }

    // button edges (dead buttons revive once released)
    const game = this._mode === 'game';
    const guard = this.inSharedGuard();
    for (let i = 0; i < PAD_BUTTONS; i++) {
      if (this.padDead[i] && !this.padDown[i]) this.padDead[i] = false;
      if (!this.padDown[i] || this.padPrev[i] || this.padDead[i]) continue;
      this._lastDevice = 'gamepad';
      const shared = i === PAD_A || i === PAD_B || i === PAD_RB;
      if (PAD_ANY.includes(i) && !(guard && shared)) this.anyEdge = true;
      switch (i) {
        case PAD_A:
          if (game) { this.edges.add('ability'); this.abilityAt = now; }
          else if (!guard) this.edges.add('confirm');
          break;
        case PAD_B:
          if (game) { this.edges.add('dash'); this.dashAt = now; }
          else if (!guard) this.edges.add('back');
          break;
        case PAD_RB:
          if (game) { this.edges.add('dash'); this.dashAt = now; }
          break;
        case PAD_Y: case PAD_RT:          // v2 UPROAR (play only; modal screens read pad Y through ui/dom.ts)
          if (game) { this.edges.add('ultimate'); this.ultimateAt = now; }
          break;
        case PAD_START: this.edges.add('pause'); break;
        case PAD_R3: if (game) this.edges.add('zoomReset'); break;
        case PAD_X: this.edges.add('reroll'); break;
        default: break;
      }
    }

    // navigation (d-pad OR dominant stick axis, hysteresis), with menu auto-repeat
    const sx = this.stickDead ? 0 : this.padSX, sy = this.stickDead ? 0 : this.padSY;
    const horiz = Math.abs(sx) >= Math.abs(sy);
    this.navDir('up', this.padLive(PAD_UP), sy, !horiz, now);
    this.navDir('down', this.padLive(PAD_DOWN), -sy, !horiz, now);
    this.navDir('right', this.padLive(PAD_RIGHT), sx, horiz, now);
    this.navDir('left', this.padLive(PAD_LEFT), -sx, horiz, now);
  }

  private navDir(d: 'up' | 'down' | 'left' | 'right', dpad: boolean, comp: number, dominant: boolean, now: number): void {
    const was = this.navOn[d];
    const stickOn = was ? comp > NAV_RELEASE : (comp > NAV_PRESS && dominant);
    const on = dpad || stickOn;
    this.navOn[d] = on;
    if (!on) return;
    if (!was) {
      this.edges.add(d);
      this.navNext[d] = now + NAV_REPEAT_DELAY_MS;
    } else if (this._mode === 'ui' && now >= this.navNext[d]) {
      this.edges.add(d);
      this.navNext[d] = now + NAV_REPEAT_EVERY_MS;
    }
  }
}
