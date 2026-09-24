// DYEFIELD — input: an action map (CONTRACT §5.1: move*/jump/fire/slick/sub/special/pause/debug/map)
// over keyboard + mouse, ready for remapping. The sim never sees keys — it sees one PlayerIntent per
// 60 Hz tick, built here. Presses are LATCHED until the next tick consumes them, so a tap shorter
// than one tick (or one that lands between two ticks) still jumps / still splats once.

import { emptyIntent, type PlayerIntent } from './core/types.ts';

export type Action =
  | 'moveF' | 'moveB' | 'moveL' | 'moveR'
  | 'jump' | 'fire' | 'slick' | 'sub' | 'special'
  | 'pause' | 'debug' | 'map';

/** Codes are KeyboardEvent.code, or 'Mouse0' / 'Mouse1' / 'Mouse2' for mouse buttons. */
export const DEFAULT_BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  moveF: ['KeyW', 'ArrowUp'],
  moveB: ['KeyS', 'ArrowDown'],
  moveL: ['KeyA', 'ArrowLeft'],
  moveR: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  fire: ['Mouse0'],
  slick: ['ShiftLeft', 'ShiftRight'],
  sub: ['KeyE', 'Mouse2'],
  special: ['KeyQ'],
  pause: ['Escape', 'KeyP'],
  debug: ['F1', 'Backquote'],
  map: ['KeyM'],
};

const ALL_ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];
/** actions that fire a one-shot UI callback on press (not sim input) */
const UI_ACTIONS: ReadonlySet<Action> = new Set<Action>(['pause', 'debug', 'map']);

export class Input {
  /** live = the sim accepts movement / fire input (in play). UI actions work regardless. */
  live = false;
  private bindings = new Map<string, Action[]>();
  private readonly held = new Set<string>();
  private readonly latched = new Set<Action>();
  private mdx = 0;
  private mdy = 0;
  private readonly uiHandlers: Array<(a: Action, e: Event) => void> = [];
  private readonly target: HTMLElement;
  private readonly off: Array<() => void> = [];

  constructor(target: HTMLElement, bindings: Readonly<Record<Action, readonly string[]>> = DEFAULT_BINDINGS) {
    this.target = target;
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
    on(window, 'contextmenu', (e) => { if (this.live) e.preventDefault(); });
    on(window, 'blur', () => this.releaseAll());
    const vis = (): void => { if (document.hidden) this.releaseAll(); };
    document.addEventListener('visibilitychange', vis);
    this.off.push(() => document.removeEventListener('visibilitychange', vis));
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

  /** subscribe to UI-action presses (pause / debug / map) */
  onUi(fn: (a: Action, e: Event) => void): void { this.uiHandlers.push(fn); }

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
    out.yaw = camYaw;
    out.pitch = camPitch;
    out.jump = v('jump');
    out.fire = v('fire');
    out.slick = v('slick');
    out.sub = v('sub');
    out.special = v('special');
    this.latched.clear();
    return out;
  }

  releaseAll(): void {
    this.held.clear();
    this.latched.clear();
    this.mdx = 0; this.mdy = 0;
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
      if (UI_ACTIONS.has(a)) { if (!repeat) for (const h of this.uiHandlers) h(a, e); }
      else if (this.live && !repeat) this.latched.add(a);
    }
    return true;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code || e.key;
    const acts = this.bindings.get(code);
    if (!acts) return;
    // keep the page from scrolling / opening help / tab-cycling while playing
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    if (code === 'F1' || this.live) e.preventDefault();
    if (down) this.press(code, e, e.repeat);
    else this.held.delete(code);
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    const code = 'Mouse' + e.button;
    if (!this.bindings.has(code)) return;
    if (down) {
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
