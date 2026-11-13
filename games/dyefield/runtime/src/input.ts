// DYEFIELD — input: an action map (CONTRACT §5.1: move*/jump/fire/slick/sub/special/pause/debug/map)
// over keyboard + mouse; SETTINGS remaps it live (setBindings from ui/settings.ts; phase 9). The sim never sees keys — it sees one PlayerIntent per
// 60 Hz tick, built here. Presses are LATCHED until the next tick consumes them, so a tap shorter
// than one tick (or one that lands between two ticks) still jumps / still splats once.
//
// CONTRACT_MOBILE M1 / M2: the input METHOD. `mode` is 'kbm' (keyboard + mouse) or 'touch', mirrored on <html> as the
// class df-kbm / df-touch (all CSS keys off it, never off a user agent). At boot: touch when
// matchMedia('(pointer: coarse)') matches AND navigator.maxTouchPoints > 0, else kbm; ?touch=1|0 overrides and PINS
// the mode (harnesses, desktop testing). Hybrid devices switch instantly: a pointerdown with pointerType 'touch' →
// touch; a real mouse move (pointerType 'mouse', non-zero movement) or a keydown of a bound key → kbm, but only when
// no touch is down (never mid-gesture). Not persisted. onMode(fn) → unsubscribe.
// The TouchState (touch/controls.ts writes it) is owned here: intent() takes the stick's analog vector when it is
// non-zero (else the keys' digital one), ORs the touch buttons with the keys and consumes the touch latches with the
// key latches; takeTouchLook() hands the Game the look radians accumulated since the last call.
//
// CONTRACT_CONTROLS C1: the 'aim' action (default RMB; SUB is E only now). It is VIEW input: never part of the
// PlayerIntent (no sim effect, every determinism hash unchanged). aiming() answers "is AIM wanted": the key held (hold
// mode, the default) or toggled (aimToggle = true: each press flips it), or the touch AIM button's toggle (TouchState.aim).
// The Game turns it into the camera's zoom / shoulder / look sensitivity (view/camera.ts) and hud.setAiming.

import { emptyIntent, type PlayerIntent } from './core/types.ts';
import type { TouchState } from './touch/controls.ts';

export type InputMode = 'kbm' | 'touch';

/** M1 boot detection: ?touch=1|0 (pinned) → else coarse pointer + touch points → touch, else kbm */
export function detectInputMode(search: string = typeof location !== 'undefined' ? location.search : ''): { mode: InputMode; pinned: boolean } {
  let q: string | null = null;
  try { q = new URLSearchParams(search).get('touch'); } catch { q = null; }
  if (q === '1' || q === 'true') return { mode: 'touch', pinned: true };
  if (q === '0' || q === 'false') return { mode: 'kbm', pinned: true };
  let coarse = false, points = 0;
  try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { coarse = false; }
  try { points = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0; } catch { points = 0; }
  return { mode: coarse && points > 0 ? 'touch' : 'kbm', pinned: false };
}

export type Action =
  | 'moveF' | 'moveB' | 'moveL' | 'moveR'
  | 'jump' | 'fire' | 'aim' | 'slick' | 'sub' | 'special'
  | 'pause' | 'debug' | 'map';

/**
 * Codes are KeyboardEvent.code, or 'Mouse0' / 'Mouse1' / 'Mouse2' for mouse buttons.
 * CONTRACT_CONTROLS C1: AIM on RMB (a view action: camera zoom + shoulder, look sensitivity × aimSens — never in the
 * PlayerIntent, so the sim and every hash are untouched); SUB is E only (RMB used to be a second SUB key). Old saves that
 * still carry the old default SUB (E + RMB) are migrated in ui/settings.ts sanitizeBindings.
 */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  moveF: ['KeyW', 'ArrowUp'],
  moveB: ['KeyS', 'ArrowDown'],
  moveL: ['KeyA', 'ArrowLeft'],
  moveR: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  slick: ['ShiftLeft', 'ShiftRight'],
  sub: ['KeyE'],
  special: ['KeyQ'],
  pause: ['Escape', 'KeyP'],
  debug: ['F1', 'Backquote'],
  map: ['KeyM'],
};
/** the SUB default before CONTRACT_CONTROLS C1 (a save holding exactly this is migrated: SUB → E, AIM → RMB) */
export const OLD_DEFAULT_SUB: readonly string[] = ['KeyE', 'Mouse2'];

const ALL_ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];

const NAMED: Record<string, string> = {
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL', ControlRight: 'CTRL', AltLeft: 'ALT', AltRight: 'ALT', Escape: 'ESC', Tab: 'TAB', Enter: 'ENTER',
  Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'CAPS',
};

/** A KeyboardEvent.code / 'MouseN' as a short keycap label: KeyQ → Q, Digit1 → 1, Mouse2 → RMB, ShiftLeft → SHIFT. */
export function codeLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'NUM ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.replace(/(Left|Right)$/, '').toUpperCase();
}
/** actions that fire a one-shot UI callback on press (not sim input) */
const UI_ACTIONS: ReadonlySet<Action> = new Set<Action>(['pause', 'debug', 'map']);

/** a text field keeps its own long-press / selection behaviour (the profile name) */
function isTextField(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable === true);
}

export class Input {
  /** live = the sim accepts movement / fire input (in play). UI actions work regardless. */
  live = false;
  /** the SETTINGS key-remap capture is listening: every key / button is ignored here (phase 9) */
  suspended = false;
  private bindings = new Map<string, Action[]>();
  private readonly held = new Set<string>();
  private readonly latched = new Set<Action>();
  private mdx = 0;
  private mdy = 0;
  private readonly uiHandlers: Array<(a: Action, e: Event) => void> = [];
  private readonly target: HTMLElement;
  private readonly off: Array<() => void> = [];
  /** CONTRACT_MOBILE M2: written by touch/controls.ts, read by intent() / takeTouchLook() (C1: + the AIM toggle) */
  readonly touch: TouchState = { moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, held: new Set(), latched: new Set(), active: 0, aim: false };
  /** CONTRACT_CONTROLS C1: the AIM mode — false = hold the AIM key (the default, the industry norm), true = each press
   *  toggles it (SETTINGS "toggle aim"; main.ts writes it from Settings.aimToggle) */
  private aimToggleMode = false;
  /** C1 toggle mode: the current toggled state (cleared by releaseAll / clearAim / a mode switch) */
  private aimOn = false;
  private curMode: InputMode;
  /** ?touch=1|0: the mode never switches by itself */
  readonly pinned: boolean;
  private readonly modeFns: Array<(m: InputMode) => void> = [];

  constructor(target: HTMLElement, bindings: Readonly<Record<Action, readonly string[]>> = DEFAULT_BINDINGS,
    detected: { mode: InputMode; pinned: boolean } = detectInputMode()) {
    this.target = target;
    this.curMode = detected.mode;
    this.pinned = detected.pinned;
    this.applyModeClass();
    this.setBindings(bindings);
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => this.onKey(e, true), { capture: true });
    on(window, 'keyup', (e) => this.onKey(e, false), { capture: true });
    on(window, 'mousedown', (e) => this.onMouse(e, true));
    on(window, 'mouseup', (e) => this.onMouse(e, false));
    on(window, 'mousemove', (e) => {
      if (!this.live) return;
      if (document.pointerLockElement === this.target) { this.mdx += e.movementX || 0; this.mdy += e.movementY || 0; }
    });
    // M1 hybrid switching (pointer events: a touch's compatibility mouse events never arrive as pointerType 'mouse')
    on(window, 'pointerdown', (e) => { if (e.pointerType === 'touch') this.switchMode('touch'); }, { capture: true, passive: true });
    on(window, 'pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.curMode === 'touch' && (e.movementX || e.movementY)) this.switchMode('kbm');
    }, { capture: true, passive: true });
    // touch mode: no long-press menu on the game or the UI (text fields keep theirs); kbm: as before (only in play)
    on(window, 'contextmenu', (e) => {
      if (this.live) { e.preventDefault(); return; }
      if (this.curMode === 'touch' && !isTextField(e.target)) e.preventDefault();
    });
    // (iOS gesturestart / change / end are prevented page-wide by ui/boot.ts installPageHygiene — CONTRACT_MOBILE M5)
    on(window, 'blur', () => this.releaseAll());
    const vis = (): void => { if (document.hidden) this.releaseAll(); };
    document.addEventListener('visibilitychange', vis);
    this.off.push(() => document.removeEventListener('visibilitychange', vis));
  }

  // ───────────────────────────── CONTRACT_MOBILE M1: the input method ─────────────────────────────
  get mode(): InputMode { return this.curMode; }

  /** subscribe to input-method switches → unsubscribe */
  onMode(fn: (m: InputMode) => void): () => void {
    this.modeFns.push(fn);
    return () => { const i = this.modeFns.indexOf(fn); if (i >= 0) this.modeFns.splice(i, 1); };
  }

  /** a hybrid switch: instant, never while a touch is down, never when ?touch= pinned the mode */
  private switchMode(m: InputMode): void {
    if (this.pinned || m === this.curMode) return;
    if (this.touch.active > 0) return;
    this.curMode = m;
    this.applyModeClass();
    this.aimOn = false;
    if (m === 'touch') { this.held.clear(); this.latched.clear(); this.mdx = 0; this.mdy = 0; }
    else this.clearTouch();
    for (const fn of [...this.modeFns]) {
      try { fn(m); } catch (e) { console.error('[dyefield] input mode listener', e); }
    }
  }

  private applyModeClass(): void {
    try {
      const c = document.documentElement.classList;
      c.toggle('df-touch', this.curMode === 'touch');
      c.toggle('df-kbm', this.curMode === 'kbm');
    } catch { /* no DOM */ }
  }

  /** M2: the touch look radians accumulated since the last call (zeroed) */
  takeTouchLook(): { dyaw: number; dpitch: number } {
    const t = this.touch;
    const r = { dyaw: t.lookYaw, dpitch: t.lookPitch };
    t.lookYaw = 0; t.lookPitch = 0;
    return r;
  }

  // ───────────────────────────── CONTRACT_CONTROLS C1: AIM (view only) ─────────────────────────────
  get aimToggle(): boolean { return this.aimToggleMode; }
  /** hold (false) / toggle (true); a change drops a toggled aim */
  set aimToggle(on: boolean) {
    const v = !!on;
    if (v !== this.aimToggleMode) { this.aimToggleMode = v; this.aimOn = false; }
  }

  /**
   * AIM is wanted right now: in play, the AIM key held (hold mode) or toggled on (toggle mode), or the touch AIM button
   * toggled on. The Game decides what it does (no zoom while slicked / washed); the sim never sees it.
   */
  aiming(): boolean {
    if (!this.live) return false;
    if (this.touch.aim) return true;
    return this.aimToggleMode ? this.aimOn : this.isHeld('aim');
  }

  /** drop a toggled aim (keyboard toggle + the touch button): a wash, the final horn */
  clearAim(): void {
    this.aimOn = false;
    this.touch.aim = false;
  }

  /** fire a UI action from a non-key source (the touch overlay's MAP tap) */
  emitUi(a: Action, e: Event): void {
    if (!UI_ACTIONS.has(a)) return;
    for (const h of [...this.uiHandlers]) h(a, e);
  }

  private clearTouch(): void {
    const t = this.touch;
    t.moveX = 0; t.moveZ = 0; t.lookYaw = 0; t.lookPitch = 0;
    t.held.clear();
    t.latched.clear();
    t.aim = false;
  }

  setBindings(b: Readonly<Record<Action, readonly string[]>>): void {
    this.bindings = new Map();
    for (const a of ALL_ACTIONS) {
      for (const code of b[a] ?? []) {
        const list = this.bindings.get(code) ?? [];
        list.push(a);
        this.bindings.set(code, list);
      }
    }
  }

  /** the codes bound to an action (in binding order) */
  bindingsFor(a: Action): string[] {
    const out: string[] = [];
    for (const [code, acts] of this.bindings) if (acts.includes(a)) out.push(code);
    return out;
  }

  /** the keycap label of an action's FIRST binding (HUD badges show the actual binding, e.g. special → Q) */
  keyLabel(a: Action): string {
    const b = this.bindingsFor(a);
    return b.length ? codeLabel(b[0]) : '';
  }

  /** subscribe to UI-action presses (pause / debug / map) → unsubscribe */
  onUi(fn: (a: Action, e: Event) => void): () => void {
    this.uiHandlers.push(fn);
    return () => { const i = this.uiHandlers.indexOf(fn); if (i >= 0) this.uiHandlers.splice(i, 1); };
  }

  isHeld(a: Action): boolean {
    for (const [code, acts] of this.bindings) if (acts.includes(a) && this.held.has(code)) return true;
    return false;
  }

  /** accumulated pointer-lock mouse motion since the last call (pixels) */
  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mdx, dy: this.mdy };
    this.mdx = 0; this.mdy = 0;
    return r;
  }

  /** Build this tick's intent (camera-relative) and consume latched presses. */
  intent(camYaw: number, camPitch: number, out: PlayerIntent = emptyIntent()): PlayerIntent {
    const live = this.live;
    const v = (a: Action): boolean => live && (this.isHeld(a) || this.latched.has(a));
    out.moveZ = (v('moveF') ? 1 : 0) - (v('moveB') ? 1 : 0);
    out.moveX = (v('moveR') ? 1 : 0) - (v('moveL') ? 1 : 0);
    // M2 merge: the stick's analog vector when it is deflected (the sim normalises |v| > 1 and keeps the magnitude)
    const t = this.touch;
    if (live && (t.moveX !== 0 || t.moveZ !== 0)) {
      const m = Math.hypot(t.moveX, t.moveZ);
      const k = m > 1 ? 1 / m : 1;
      out.moveX = t.moveX * k;
      out.moveZ = t.moveZ * k;
    }
    out.yaw = camYaw;
    out.pitch = camPitch;
    out.jump = v('jump') || (live && t.latched.has('jump'));
    out.fire = v('fire') || (live && t.held.has('fire'));
    out.slick = v('slick') || (live && t.held.has('slick'));
    out.sub = v('sub') || (live && t.latched.has('sub'));
    out.special = v('special') || (live && t.latched.has('special'));
    this.latched.clear();
    t.latched.clear();
    return out;
  }

  releaseAll(): void {
    this.held.clear();
    this.latched.clear();
    this.mdx = 0; this.mdy = 0;
    this.aimOn = false;
    this.clearTouch();
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }

  private press(code: string, e: Event, repeat: boolean): boolean {
    const acts = this.bindings.get(code);
    if (!acts) return false;
    if (!repeat) this.held.add(code);
    for (const a of acts) {
      if (UI_ACTIONS.has(a)) { if (!repeat) for (const h of [...this.uiHandlers]) h(a, e); }
      else if (a === 'aim') { if (this.live && !repeat && this.aimToggleMode) this.aimOn = !this.aimOn; }   // C1: view only
      else if (this.live && !repeat) this.latched.add(a);
    }
    return true;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.suspended) return;
    const code = e.code || e.key;
    const acts = this.bindings.get(code);
    if (!acts) return;
    // keep the page from scrolling / opening help / tab-cycling while playing
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    // M1: a bound key on a hybrid device (an iPad keyboard) switches back to keyboard + mouse
    if (down && !e.repeat && !code.startsWith('Mouse')) this.switchMode('kbm');
    if (code === 'F1' || this.live) e.preventDefault();
    if (down) this.press(code, e, e.repeat);
    else this.held.delete(code);
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    if (this.suspended) return;
    const code = 'Mouse' + e.button;
    if (!this.bindings.has(code)) return;
    if (down) {
      // touch mode: a tap's compatibility mousedown is not a mouse button (the touch overlay owns FIRE)
      if (this.curMode === 'touch') return;
      // sim buttons count only when aimed at the game: pointer locked, or pressed on the canvas
      const onGame = document.pointerLockElement === this.target || e.target === this.target;
      if (!onGame) return;
      if (this.live) e.preventDefault();
      this.press(code, e, false);
    } else {
      this.held.delete(code);
    }
  }
}
