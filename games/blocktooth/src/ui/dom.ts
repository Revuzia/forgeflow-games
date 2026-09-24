// BLOCKTOOTH — UI DOM helpers (CONTRACT.md §12). ui lane.
// Everything the overlay screens share: element builders, cheap change-only writers,
// number/time formatting, the UI-mode push/restore around modal screens, and UiKeys —
// the keyboard + gamepad navigation driver every modal screen uses.
//
// Why UiKeys reads DOM keydown + navigator.getGamepads() itself instead of polling
// Input.pressed(): modal screens are awaited Promises and nothing in the contract says who
// calls Input.update() while they are open. Reading the raw devices makes the screens work
// whether or not the app's frame loop is running. Screens still set `input.mode = 'ui'`
// (gameplay actions read false) and call `input.clearEdges()` on close, so a key used to
// dismiss a screen never leaks into gameplay as a hook/dash/pause edge.

import type { Input } from '../core/input.ts';
import type { Settings } from '../core/save.ts';
import type { Rarity } from '../core/types.ts';
import './styles.css';

// ─────────────────────────────── element builders ───────────────────────────────

/** Create an element with an optional class list and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Shorthand: a div with classes, appended to `parent` when given. */
export function div(cls: string, parent?: HTMLElement | null, text?: string): HTMLDivElement {
  const d = el('div', cls, text);
  if (parent) parent.appendChild(d);
  return d;
}

/** Remove every child. */
export function clearEl(e: HTMLElement): void { while (e.firstChild) e.removeChild(e.firstChild); }

/** A <span class="bt-key">KEY</span> key-hint chip. */
export function keyChip(label: string, cls = ''): HTMLSpanElement {
  return el('span', `bt-key${cls ? ' ' + cls : ''}`, label);
}

/** Text node writer that only touches the DOM when the value changes. */
export class TextSlot {
  readonly node: HTMLElement;
  private v: string | null = null;
  constructor(node: HTMLElement) { this.node = node; }
  set(v: string): void { if (v !== this.v) { this.v = v; this.node.textContent = v; } }
  reset(): void { this.v = null; }
}

/** Writes a numeric CSS custom property / transform only when the quantized value changes. */
export class VarSlot {
  readonly node: HTMLElement;
  readonly name: string;
  private q: number;
  private v = NaN;
  constructor(node: HTMLElement, name: string, quantum = 0.002) { this.node = node; this.name = name; this.q = quantum; }
  set(v: number): void {
    const r = Math.round(v / this.q) * this.q;
    if (r !== this.v) { this.v = r; this.node.style.setProperty(this.name, r.toFixed(4)); }
  }
  reset(): void { this.v = NaN; }
}

/** Toggle a class only when the state changes. */
export class ClassSlot {
  readonly node: HTMLElement;
  readonly cls: string;
  private on: boolean | null = null;
  constructor(node: HTMLElement, cls: string) { this.node = node; this.cls = cls; }
  set(on: boolean): void { if (on !== this.on) { this.on = on; this.node.classList.toggle(this.cls, on); } }
  reset(): void { this.on = null; }
}

/** Restart a one-shot flourish without forcing layout (Web Animations API). */
export function pulse(e: Element, frames: Keyframe[], ms: number, easing = 'cubic-bezier(.2,.8,.2,1)'): void {
  if (typeof (e as HTMLElement).animate !== 'function') return;
  (e as HTMLElement).animate(frames, { duration: ms, easing });
}

// ─────────────────────────────── formatting ───────────────────────────────

/** Fill {tokens} in a copy template. Unknown tokens are left as-is. */
export function fmt(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** 12480 → "12,480" (integers; negative/NaN safe). */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = Math.round(Math.abs(n)).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? '-' + out : out;
}

/** Seconds → "m:ss" (or "h:mm:ss" past an hour). */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0');
}

/** Minutes after midnight (float ok) → "HH:MM" on a 24 h broadcast clock. */
export function fmtClock(minutes: number): string {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** RankIndex 0..4 → "I".."V". */
export function roman(rank: number): string { return ROMAN[Math.max(0, Math.min(4, rank | 0))]; }

/** Cosmetic pick (UI may use Math.random — CONTRACT §0.3). */
export function pickOne<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** Stable pick from a seed (so the same run shows the same tabloid copy). */
export function pickSeeded<T>(arr: readonly T[], seed: number): T {
  const i = (((seed | 0) % arr.length) + arr.length) % arr.length;
  return arr[i];
}

/** Tiny deterministic cosmetic PRNG for CSS-painted art (skylines) so it never reshuffles. */
export function cosmeticRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────── station palette ───────────────────────────────

export const UI_COLORS = {
  navy: '#14213d', cream: '#f4ecd8', coral: '#ff6f5e', red: '#e63946', teal: '#2f7f86',
  gold: '#ffd166', ink: '#1b1426',
} as const;

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#c9bfa6', rare: '#2f9fa8', epic: '#8a63d2', legendary: '#ffc53d',
};

// ─────────────────────────────── settings → UI ───────────────────────────────

/** Apply the UI-relevant settings (reduce flashing) as a root class the stylesheet reads. */
export function applyUiSettings(s: Pick<Settings, 'reduceFlashing'>): void {
  document.documentElement.classList.toggle('bt-reduce-flash', !!s.reduceFlashing);
}

/** True when flashes should be toned down (setting or OS reduced-motion). */
export function flashesReduced(): boolean {
  if (document.documentElement.classList.contains('bt-reduce-flash')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─────────────────────────────── modal plumbing ───────────────────────────────

/** Put the Input layer in UI mode; returns a restore fn (previous mode + cleared edges). */
export function enterUiMode(input: Input | null | undefined): () => void {
  if (!input) return () => {};
  const prev = input.mode;
  input.mode = 'ui';
  try { input.clearEdges(); } catch { /* input not ready — harmless */ }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    input.mode = prev;
    try { input.clearEdges(); } catch { /* ignore */ }
  };
}

/** Remember the focused element; the returned fn restores it (if it is still in the page). */
export function saveFocus(): () => void {
  const prev = document.activeElement as HTMLElement | null;
  return () => {
    if (prev && prev.isConnected && typeof prev.focus === 'function') {
      try { prev.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };
}

/** Focus without scrolling the page. */
export function focusEl(e: HTMLElement | null | undefined): void {
  if (e && typeof e.focus === 'function') { try { e.focus({ preventScroll: true }); } catch { /* ignore */ } }
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────── UiKeys: keyboard + gamepad nav ───────────────────────────────

export type UiAct =
  | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause'
  | 'pick1' | 'pick2' | 'pick3' | 'reroll' | 'alt';

export interface UiPress {
  /** mapped action, or null for an unmapped key (still a press — "any key") */
  act: UiAct | null;
  /** lower-case KeyboardEvent.key ('enter', 'r', 'arrowup', ' ') or 'pad:<button>' */
  key: string;
  source: 'key' | 'pad';
  repeat: boolean;
}

export interface UiKeysOpts {
  /** ms after start() during which presses are swallowed (stops carry-over mashing) */
  armMs?: number;
  /** whether Space counts as confirm (drafts turn it off: Space is the in-game HOOK) */
  spaceConfirms?: boolean;
  /** per-frame callback while running (cosmetic animation) */
  onFrame?: (dtMs: number) => void;
}

const PASS_THROUGH = new Set(['tab', 'shift', 'control', 'alt', 'meta', 'os', 'capslock', 'contextmenu', 'numlock', 'scrolllock']);

function mapKey(e: KeyboardEvent, spaceConfirms: boolean): UiAct | null {
  const k = e.key.toLowerCase();
  const c = e.code;
  if (k === 'arrowup' || c === 'KeyW') return 'up';
  if (k === 'arrowdown' || c === 'KeyS') return 'down';
  if (k === 'arrowleft' || c === 'KeyA') return 'left';
  if (k === 'arrowright' || c === 'KeyD') return 'right';
  if (k === 'enter' || k === 'numpadenter') return 'confirm';
  if (k === ' ' || c === 'Space') return spaceConfirms ? 'confirm' : 'alt';
  if (k === 'escape' || k === 'backspace') return 'back';
  if (c === 'KeyP') return 'pause';
  if (k === '1' || c === 'Digit1' || c === 'Numpad1') return 'pick1';
  if (k === '2' || c === 'Digit2' || c === 'Numpad2') return 'pick2';
  if (k === '3' || c === 'Digit3' || c === 'Numpad3') return 'pick3';
  if (c === 'KeyR') return 'reroll';
  return null;
}

/** Standard-mapping gamepad button → action. */
const PAD_MAP: Record<number, UiAct> = {
  0: 'confirm', 1: 'back', 2: 'reroll', 3: 'alt', 8: 'back', 9: 'pause',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

/**
 * Keyboard + gamepad navigation for one modal screen. Keydown is taken in the CAPTURE phase on
 * window and stopped there, so gameplay listeners never see keys meant for the menu (F-keys,
 * Tab and modifiers pass through). Gamepad buttons are edge-detected against a snapshot taken
 * at start(), so a button still held from gameplay is not a press. Left stick auto-repeats.
 */
export class UiKeys {
  private onPress: (p: UiPress) => void;
  private opts: Required<Omit<UiKeysOpts, 'onFrame'>> & { onFrame: ((dtMs: number) => void) | null };
  private running = false;
  private armAt = 0;
  private raf = 0;
  private lastT = 0;
  private prevBtn: boolean[] = [];
  private stickDir: UiAct | null = null;
  private stickNextAt = 0;

  constructor(onPress: (p: UiPress) => void, opts: UiKeysOpts = {}) {
    this.onPress = onPress;
    this.opts = { armMs: opts.armMs ?? 160, spaceConfirms: opts.spaceConfirms ?? true, onFrame: opts.onFrame ?? null };
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.running) return;
    const k = e.key.toLowerCase();
    if (PASS_THROUGH.has(k) || /^f\d{1,2}$/.test(k) || e.ctrlKey || e.metaKey || e.altKey) return;
    const act = mapKey(e, this.opts.spaceConfirms);
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() < this.armAt) return;
    const isNav = act === 'up' || act === 'down' || act === 'left' || act === 'right';
    if (e.repeat && !isNav) return;
    this.onPress({ act, key: k, source: 'key', repeat: e.repeat });
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.armAt = performance.now() + this.opts.armMs;
    this.prevBtn = this.readButtons();
    this.stickDir = this.readStick();
    this.stickNextAt = performance.now() + 400;
    window.addEventListener('keydown', this.onKeyDown, true);
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.pollPad(t);
      if (this.opts.onFrame) this.opts.onFrame(Math.min(100, t - this.lastT));
      this.lastT = t;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener('keydown', this.onKeyDown, true);
    cancelAnimationFrame(this.raf);
  }

  private pads(): Gamepad[] {
    const out: Gamepad[] = [];
    try {
      const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of list) if (p && p.connected) out.push(p);
    } catch { /* gamepads blocked by permissions policy */ }
    return out;
  }

  private readButtons(): boolean[] {
    const b: boolean[] = [];
    for (const p of this.pads()) {
      for (let i = 0; i < p.buttons.length; i++) b[i] = b[i] || p.buttons[i].pressed || p.buttons[i].value > 0.6;
    }
    return b;
  }

  private readStick(): UiAct | null {
    for (const p of this.pads()) {
      const x = p.axes[0] ?? 0, y = p.axes[1] ?? 0;
      if (Math.abs(x) < 0.55 && Math.abs(y) < 0.55) continue;
      if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
      return y > 0 ? 'down' : 'up';
    }
    return null;
  }

  private pollPad(now: number): void {
    const btn = this.readButtons();
    const armed = now >= this.armAt;
    for (let i = 0; i < btn.length; i++) {
      if (btn[i] && !this.prevBtn[i] && armed) {
        this.onPress({ act: PAD_MAP[i] ?? null, key: 'pad:' + i, source: 'pad', repeat: false });
        if (!this.running) return;   // the press closed the screen
      }
    }
    this.prevBtn = btn;
    const dir = this.readStick();
    if (dir !== this.stickDir) {
      this.stickDir = dir;
      if (dir && armed) { this.onPress({ act: dir, key: 'pad:stick', source: 'pad', repeat: false }); this.stickNextAt = now + 380; }
    } else if (dir && armed && now >= this.stickNextAt) {
      this.onPress({ act: dir, key: 'pad:stick', source: 'pad', repeat: true });
      this.stickNextAt = now + 130;
    }
  }
}

/** Wrap an index into [0, n). */
export function wrapIndex(i: number, n: number): number { return ((i % n) + n) % n; }
