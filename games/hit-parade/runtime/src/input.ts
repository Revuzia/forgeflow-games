// HIT PARADE - input: keyboard + gamepad (+ the touch overlay's bits) -> ONE 16-bit input word per local player
// per sim tick (CONTRACT §4.4). Pattern: dyefield input.ts (mode detection, per-tick latches, remap suspend) +
// blocktooth input.ts (Gamepad API polling, standard mapping).
//
// The word (CONTRACT §4.4): bit0 UP · bit1 DOWN · bit2 LEFT · bit3 RIGHT (screen-relative; the sim converts to
// back/forward with `facing`) · bit4 L · bit5 M · bit6 H · bit7 S · bit8 ASSIST · bit9 THROW macro · bit10 PARRY
// macro · bit11 IMPACT · bit12 TAUNT · bits 13-15 always 0.
//
//   * SOCD cleaning happens HERE, before the word is formed (CONTRACT §4.3.9 / FIGHTING_DESIGN §4b):
//     LEFT + RIGHT = neutral, UP + DOWN = neutral. It runs on the merged word (keyboard OR pad OR touch), so a
//     keyboard LEFT and a pad RIGHT held together also cancel.
//   * Per-tick LATCHING (dyefield: "a tap shorter than one tick ... still jumps"): every press since the last
//     tick is OR-ed into the next word even if the key is already up, so a 5 ms tap still reaches the sim for
//     exactly one frame (motion inputs and chords need that). A latched direction whose opposite is HELD is
//     dropped (the held one wins), so a fast left->right roll never produces a one-frame SOCD neutral.
//   * The sim does chord detection itself (L+M within 2 frames = THROW, M+H = PARRY, from its own history):
//     this layer only sets the macro bits when a dedicated THROW / PARRY key or pad button is pressed.
//   * Default bindings = FIGHTING_DESIGN §5a / §5b SIMPLE rows with the four-button model (CONTRACT §1):
//       P1 keyboard: W A S D (Space = up too) · J L · K M · L H · I S(PECIAL) · U ASSIST · H THROW · O PARRY ·
//                    P IMPACT · Y TAUNT · Esc pause
//       P2 keyboard: arrows · Num1 L · Num2 M · Num3 H · Num5 S · Num4 ASSIST · Num0 THROW · Num6 PARRY ·
//                    Num+ IMPACT · Num* TAUNT
//       Gamepad (Standard mapping): X/Square L · Y/Triangle M · RB H · A/Cross SPECIAL · B/Circle ASSIST ·
//                    LT THROW · LB PARRY · RT IMPACT · SELECT/Back TAUNT · START pause · d-pad + left stick move
//                    (8-way sectors of 45 deg, 30 % radial dead zone)
//     CLASSIC uses the same buttons (the scheme only changes how the SIM parses the word). Every binding is
//     remappable per player (settings.ts sanitises and persists them; setBindings applies them live).
//   * Gamepads: `navigator.getGamepads()` is polled ONCE per tick (sampleAll). Pad slot p (0 = P1, 1 = P2) is
//     the p-th connected pad in index order unless pinned with setPadSlot(p, index).
//   * `live` = the sim accepts input (a bout in play). When false every word is 0 but UI actions (pause) still
//     fire and latches are still consumed (nothing queued from the menus leaks into the first fight frame).
//   * `suspended` = the settings key-remap capture is listening: every key / button is ignored here (set by the
//     window 'hp:capture' {on} event that lane UI's menus dispatch around a capture).
//   * force(p, word, ticks) = the test surface's `dev.setInputs` (a harness-scripted word for n ticks).
//   * CONTRACT_MOBILE M1: the input METHOD (`mode` 'kbm' | 'touch') lives on <html> as hp-kbm / hp-touch; boot
//     detection = coarse pointer + touch points, `?touch=1|0` pins it; hybrid devices switch on a touch
//     pointerdown / a real mouse move or bound key. The touch overlay (lane UI) writes `input.touch` (§18.5):
//     its `held` bits are OR-ed into player 0's word and its `latched` bits are consumed at each tick.

export type InputMode = 'kbm' | 'touch';
export type Device = 'keyboard' | 'gamepad' | 'touch' | 'none';

/** §4.4 bit values */
export const BIT = {
  UP: 1 << 0, DOWN: 1 << 1, LEFT: 1 << 2, RIGHT: 1 << 3,
  L: 1 << 4, M: 1 << 5, H: 1 << 6, S: 1 << 7,
  ASSIST: 1 << 8, THROW: 1 << 9, PARRY: 1 << 10, IMPACT: 1 << 11, TAUNT: 1 << 12,
} as const;
/** every defined bit (13-15 reserved, always 0) */
export const WORD_MASK = 0x1fff;
const DIRS = BIT.UP | BIT.DOWN | BIT.LEFT | BIT.RIGHT;

/** the sim actions (one word bit each) */
export type SimAction = 'up' | 'down' | 'left' | 'right' | 'l' | 'm' | 'h' | 's' | 'assist' | 'throw' | 'parry' | 'impact' | 'taunt';
/** UI actions (one-shot callbacks, never in the word) */
export type UiAction = 'pause';
export type Action = SimAction | UiAction;

export const SIM_ACTIONS: readonly SimAction[] = ['up', 'down', 'left', 'right', 'l', 'm', 'h', 's', 'assist', 'throw', 'parry', 'impact', 'taunt'];
export const ACTIONS: readonly Action[] = [...SIM_ACTIONS, 'pause'];

export const ACTION_BIT: Readonly<Record<SimAction, number>> = {
  up: BIT.UP, down: BIT.DOWN, left: BIT.LEFT, right: BIT.RIGHT,
  l: BIT.L, m: BIT.M, h: BIT.H, s: BIT.S,
  assist: BIT.ASSIST, throw: BIT.THROW, parry: BIT.PARRY, impact: BIT.IMPACT, taunt: BIT.TAUNT,
};

/** KeyboardEvent.code per action */
export type KeyBindings = Record<Action, string[]>;
/** Standard-mapping button indices per action (directions: the d-pad; the left stick always moves too) */
export type PadBindings = Record<Action, number[]>;

export const DEFAULT_KEYS: readonly [Readonly<KeyBindings>, Readonly<KeyBindings>] = [
  {
    up: ['KeyW', 'Space'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    l: ['KeyJ'], m: ['KeyK'], h: ['KeyL'], s: ['KeyI'],
    assist: ['KeyU'], throw: ['KeyH'], parry: ['KeyO'], impact: ['KeyP'], taunt: ['KeyY'],
    pause: ['Escape'],
  },
  {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    l: ['Numpad1'], m: ['Numpad2'], h: ['Numpad3'], s: ['Numpad5'],
    assist: ['Numpad4'], throw: ['Numpad0'], parry: ['Numpad6'], impact: ['NumpadAdd'], taunt: ['NumpadMultiply'],
    pause: [],
  },
];

/** Standard Gamepad mapping indices */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
} as const;
export const PAD_BUTTONS = 17;

export const DEFAULT_PAD: Readonly<PadBindings> = {
  up: [PAD.UP], down: [PAD.DOWN], left: [PAD.LEFT], right: [PAD.RIGHT],
  l: [PAD.X], m: [PAD.Y], h: [PAD.RB], s: [PAD.A],
  assist: [PAD.B], throw: [PAD.LT], parry: [PAD.LB], impact: [PAD.RT], taunt: [PAD.SELECT],
  pause: [PAD.START],
};

/** left-stick radial dead zone (FIGHTING_DESIGN §5b: 30 %) */
export const STICK_DEADZONE = 0.3;
/** analog trigger / button press threshold */
const PAD_PRESS = 0.5;

const KEY_NAMES: Record<string, string> = {
  Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL', AltLeft: 'ALT',
  AltRight: 'ALT', Escape: 'ESC', Tab: 'TAB', Enter: 'ENTER', Backquote: '`', ArrowUp: 'UP', ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', CapsLock: 'CAPS', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -',
  NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .', NumpadEnter: 'NUM ENTER',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=',
};
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT', 'HOME'];

/** a KeyboardEvent.code as a short keycap label: KeyJ -> J, Numpad1 -> NUM 1, ArrowUp -> UP */
export function codeLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'NUM ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.replace(/(Left|Right)$/, '').toUpperCase();
}

/** a standard-mapping button index as a label (Xbox names: A B X Y LB RB LT RT) */
export function padLabel(i: number): string {
  return PAD_NAMES[i] ?? 'B' + i;
}

/** a deep copy of the default bindings of player p */
export function defaultKeys(p: 0 | 1): KeyBindings {
  const src = DEFAULT_KEYS[p];
  const out = {} as KeyBindings;
  for (const a of ACTIONS) out[a] = [...src[a]];
  return out;
}
export function defaultPad(): PadBindings {
  const out = {} as PadBindings;
  for (const a of ACTIONS) out[a] = [...DEFAULT_PAD[a]];
  return out;
}

/** SOCD cleaning (CONTRACT §4.4): L+R = neutral, U+D = neutral; bits 13-15 cleared */
export function socd(word: number): number {
  let w = word & WORD_MASK;
  if ((w & BIT.LEFT) && (w & BIT.RIGHT)) w &= ~(BIT.LEFT | BIT.RIGHT);
  if ((w & BIT.UP) && (w & BIT.DOWN)) w &= ~(BIT.UP | BIT.DOWN);
  return w;
}

/** the word's buttons as a readable string (debug / input display): e.g. "6 L+S" (numpad notation, screen-relative) */
export function describeWord(word: number): string {
  const u = !!(word & BIT.UP), d = !!(word & BIT.DOWN), l = !!(word & BIT.LEFT), r = !!(word & BIT.RIGHT);
  const num = (u ? (l ? 7 : r ? 9 : 8) : d ? (l ? 1 : r ? 3 : 2) : l ? 4 : r ? 6 : 5);
  const btn: string[] = [];
  const names: Array<[number, string]> = [[BIT.L, 'L'], [BIT.M, 'M'], [BIT.H, 'H'], [BIT.S, 'S'], [BIT.ASSIST, 'AS'],
    [BIT.THROW, 'THROW'], [BIT.PARRY, 'PARRY'], [BIT.IMPACT, 'IMPACT'], [BIT.TAUNT, 'TAUNT']];
  for (const [b, n] of names) if (word & b) btn.push(n);
  return String(num) + (btn.length ? ' ' + btn.join('+') : '');
}

/** 8-way stick sector -> direction bits (screen: +x right, pad axis 1 is DOWN-positive) */
export function stickBits(x: number, y: number, dead = STICK_DEADZONE): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const mag = Math.hypot(x, y);
  if (mag < dead) return 0;
  const deg = (Math.atan2(-y, x) * 180) / Math.PI;       // 0 = right, 90 = up
  const sector = ((Math.round(deg / 45) % 8) + 8) % 8;     // 0 R, 1 UR, 2 U, 3 UL, 4 L, 5 DL, 6 D, 7 DR
  const T = [BIT.RIGHT, BIT.RIGHT | BIT.UP, BIT.UP, BIT.UP | BIT.LEFT, BIT.LEFT, BIT.LEFT | BIT.DOWN, BIT.DOWN, BIT.DOWN | BIT.RIGHT];
  return T[sector];
}

/** M1 boot detection: ?touch=1|0 (pinned) -> else coarse pointer + touch points -> touch, else kbm */
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

/** CONTRACT §18.5: written by the touch overlay (lane UI), consumed here for player 0 */
export interface TouchState {
  /** §4.4 bits the overlay holds right now */
  held: number;
  /** bits pressed since the last tick (OR-ed in by the overlay; cleared at each tick) */
  latched: number;
  /** touches currently down */
  active: number;
}

interface Binding { p: 0 | 1; action: Action }

type PadSource = () => ReadonlyArray<Gamepad | null>;

function isTextField(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable === true);
}

export interface PadInfo { index: number; id: string; mapping: string; player: 0 | 1 | null; buttons: number[]; axes: number[] }

export class Input {
  /** the sim accepts input (a bout in play) */
  live = false;
  /** the key-remap capture is listening: every key / button is ignored */
  suspended = false;
  /** §18.5 touch overlay state (player 0) */
  readonly touch: TouchState = { held: 0, latched: 0, active: 0 };
  /** ?touch=1|0: the mode never switches by itself */
  readonly pinned: boolean;

  private keys: [KeyBindings, KeyBindings] = [defaultKeys(0), defaultKeys(1)];
  private pads: [PadBindings, PadBindings] = [defaultPad(), defaultPad()];
  private codeMap = new Map<string, Binding[]>();
  private readonly held = new Set<string>();
  private readonly latched: [number, number] = [0, 0];
  private readonly padBits: [number, number] = [0, 0];
  private readonly padPrev: [Uint8Array, Uint8Array] = [new Uint8Array(PAD_BUTTONS), new Uint8Array(PAD_BUTTONS)];
  private readonly padSlot: [number | null, number | null] = [null, null];
  private readonly forced: Array<{ word: number; ticks: number } | null> = [null, null];
  private readonly lastWord: [number, number] = [0, 0];
  private readonly dev: [Device, Device] = ['none', 'none'];
  private readonly uiFns = new Set<(a: UiAction, p: 0 | 1, e: Event | null) => void>();
  private readonly modeFns = new Set<(m: InputMode) => void>();
  private readonly off: Array<() => void> = [];
  private curMode: InputMode;
  private padSource: PadSource;
  /** sampleAll calls so far (= sim ticks that read input) */
  samples = 0;
  /** keydown events that reached a binding (read-back for the lab / harness) */
  keyEvents = 0;

  constructor(opts: { keys?: [KeyBindings, KeyBindings]; pads?: [PadBindings, PadBindings]; detected?: { mode: InputMode; pinned: boolean };
    padSource?: PadSource; target?: Window } = {}) {
    const d = opts.detected ?? detectInputMode();
    this.curMode = d.mode;
    this.pinned = d.pinned;
    this.padSource = opts.padSource ?? Input.navigatorPads;
    if (opts.keys) this.keys = [opts.keys[0], opts.keys[1]];
    if (opts.pads) this.pads = [opts.pads[0], opts.pads[1]];
    this.rebuild();
    this.applyModeClass();
    const w = opts.target ?? (typeof window !== 'undefined' ? window : null);
    if (!w) return;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, o);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, o));
    };
    on(w, 'keydown', (e) => this.onKey(e, true), { capture: true });
    on(w, 'keyup', (e) => this.onKey(e, false), { capture: true });
    on(w, 'pointerdown', (e) => { if (e.pointerType === 'touch') this.switchMode('touch'); }, { capture: true, passive: true });
    on(w, 'pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.curMode === 'touch' && (e.movementX || e.movementY)) this.switchMode('kbm');
    }, { capture: true, passive: true });
    on(w, 'blur', () => this.releaseAll());
    // lane UI's key-remap capture announces itself (ui/menus.ts: window 'hp:capture' {on}): suspend while it listens
    const cap = (e: Event): void => {
      const on = !!(e as CustomEvent<{ on?: boolean }>).detail?.on;
      this.suspended = on;
      if (on) this.releaseAll();
    };
    w.addEventListener('hp:capture', cap);
    this.off.push(() => w.removeEventListener('hp:capture', cap));
    const vis = (): void => { if (document.hidden) this.releaseAll(); };
    document.addEventListener('visibilitychange', vis);
    this.off.push(() => document.removeEventListener('visibilitychange', vis));
  }

  /** navigator.getGamepads() (permissions policy / insecure context -> none) */
  static navigatorPads(): ReadonlyArray<Gamepad | null> {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!nav || typeof nav.getGamepads !== 'function') return [];
      return nav.getGamepads() || [];
    } catch {
      return [];
    }
  }

  // ───────────────────────────── bindings ─────────────────────────────
  setBindings(p: 0 | 1, keys: KeyBindings | null, pad?: PadBindings | null): void {
    if (keys) this.keys[p] = keys;
    if (pad) this.pads[p] = pad;
    this.rebuild();
  }

  keyBindings(p: 0 | 1): Readonly<KeyBindings> { return this.keys[p]; }
  padBindings(p: 0 | 1): Readonly<PadBindings> { return this.pads[p]; }

  /** the first key of an action for player p as a keycap label ('' when unbound) */
  keyLabel(p: 0 | 1, a: Action): string {
    const c = this.keys[p][a]?.[0];
    return c ? codeLabel(c) : '';
  }
  padButtonLabel(p: 0 | 1, a: Action): string {
    const b = this.pads[p][a]?.[0];
    return typeof b === 'number' ? padLabel(b) : '';
  }

  private rebuild(): void {
    const m = new Map<string, Binding[]>();
    for (const p of [0, 1] as const) {
      for (const a of ACTIONS) {
        for (const code of this.keys[p][a] ?? []) {
          const list = m.get(code) ?? [];
          list.push({ p, action: a });
          m.set(code, list);
        }
      }
    }
    this.codeMap = m;
  }

  // ───────────────────────────── mode (M1) ─────────────────────────────
  get mode(): InputMode { return this.curMode; }

  onMode(fn: (m: InputMode) => void): () => void {
    this.modeFns.add(fn);
    return () => { this.modeFns.delete(fn); };
  }

  private switchMode(m: InputMode): void {
    if (this.pinned || m === this.curMode) return;
    if (this.touch.active > 0) return;
    this.curMode = m;
    this.applyModeClass();
    for (const fn of [...this.modeFns]) {
      try { fn(m); } catch (e) { console.error('[hit-parade] input mode listener', e); }
    }
  }

  private applyModeClass(): void {
    try {
      const c = document.documentElement.classList;
      c.toggle('hp-touch', this.curMode === 'touch');
      c.toggle('hp-kbm', this.curMode === 'kbm');
    } catch { /* no DOM */ }
  }

  // ───────────────────────────── UI actions ─────────────────────────────
  onUi(fn: (a: UiAction, p: 0 | 1, e: Event | null) => void): () => void {
    this.uiFns.add(fn);
    return () => { this.uiFns.delete(fn); };
  }

  private emitUi(a: UiAction, p: 0 | 1, e: Event | null): void {
    for (const fn of [...this.uiFns]) {
      try { fn(a, p, e); } catch (err) { console.error('[hit-parade] input ui listener', err); }
    }
  }

  // ───────────────────────────── pads ─────────────────────────────
  /** pin pad slot p to a getGamepads() index (null = automatic: the p-th connected pad) */
  setPadSlot(p: 0 | 1, index: number | null): void {
    this.padSlot[p] = index === null || !Number.isFinite(index) ? null : Math.max(0, Math.floor(index));
  }

  /** replace the gamepad source (tests) */
  setPadSource(src: PadSource | null): void {
    this.padSource = src ?? Input.navigatorPads;
  }

  /** the pad object each player reads this tick */
  private padsFor(list: ReadonlyArray<Gamepad | null>): [Gamepad | null, Gamepad | null] {
    const connected: Gamepad[] = [];
    for (const g of list) if (g && g.connected) connected.push(g);
    const pick = (p: 0 | 1): Gamepad | null => {
      const pin = this.padSlot[p];
      if (pin !== null) return connected.find((g) => g.index === pin) ?? null;
      // automatic: the p-th connected pad; when the other player pinned one, the first pad left over
      const other = this.padSlot[p === 0 ? 1 : 0];
      if (other === null) return connected[p] ?? null;
      return connected.filter((g) => g.index !== other)[0] ?? null;
    };
    return [pick(0), pick(1)];
  }

  /** read every pad once: direction + button bits per player, and START edges -> pause */
  pollPads(): void {
    let list: ReadonlyArray<Gamepad | null> = [];
    try { list = this.padSource(); } catch { list = []; }
    const both = this.padsFor(list);
    for (const p of [0, 1] as const) {
      const pad = both[p];
      const prev = this.padPrev[p];
      if (!pad || this.suspended) { this.padBits[p] = 0; prev.fill(0); continue; }
      const map = this.pads[p];
      let bits = 0;
      const n = Math.min(pad.buttons.length, PAD_BUTTONS);
      const now = new Uint8Array(PAD_BUTTONS);
      for (let i = 0; i < n; i++) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > PAD_PRESS)) now[i] = 1;
      }
      for (const a of SIM_ACTIONS) {
        for (const i of map[a] ?? []) if (now[i]) { bits |= ACTION_BIT[a]; break; }
      }
      bits |= stickBits(pad.axes.length > 0 ? pad.axes[0] : 0, pad.axes.length > 1 ? pad.axes[1] : 0);
      // START (or whatever 'pause' is bound to): one UI action per press edge
      for (const i of map.pause ?? []) if (now[i] && !prev[i]) this.emitUi('pause', p, null);
      let any = false;
      for (let i = 0; i < PAD_BUTTONS; i++) { if (now[i] && !prev[i]) any = true; prev[i] = now[i]; }
      if (any || (bits & DIRS)) this.dev[p] = 'gamepad';
      this.padBits[p] = bits;
    }
  }

  /** connected pads with their player slot (read-back) */
  padInfo(): PadInfo[] {
    let list: ReadonlyArray<Gamepad | null> = [];
    try { list = this.padSource(); } catch { list = []; }
    const both = this.padsFor(list);
    const out: PadInfo[] = [];
    for (const g of list) {
      if (!g || !g.connected) continue;
      out.push({ index: g.index, id: g.id, mapping: g.mapping, player: both[0] === g ? 0 : both[1] === g ? 1 : null,
        buttons: g.buttons.map((b) => (b.pressed || b.value > PAD_PRESS ? 1 : 0)), axes: [...g.axes].map((v) => Math.round(v * 1000) / 1000) });
    }
    return out;
  }

  // ───────────────────────────── per-tick sampling ─────────────────────────────
  /** the keyboard bits player p holds right now */
  private keyHeld(p: 0 | 1): number {
    let bits = 0;
    for (const code of this.held) {
      const list = this.codeMap.get(code);
      if (!list) continue;
      for (const b of list) if (b.p === p && b.action !== 'pause') bits |= ACTION_BIT[b.action as SimAction];
    }
    return bits;
  }

  /**
   * One sim tick: poll the pads once, build BOTH players' words (keyboard OR pad OR touch, latched presses,
   * SOCD) and consume the latches. Call exactly once per tick. `out` receives [p1, p2].
   */
  sampleAll(out: [number, number] = [0, 0]): [number, number] {
    this.pollPads();
    this.samples++;
    for (const p of [0, 1] as const) {
      let held = this.keyHeld(p) | this.padBits[p];
      let lat = this.latched[p];
      if (p === 0) { held |= this.touch.held; lat |= this.touch.latched; }
      // a latched direction whose opposite is held loses (no one-frame SOCD neutral on a fast roll)
      let extra = lat & ~held;
      if (held & BIT.RIGHT) extra &= ~BIT.LEFT;
      if (held & BIT.LEFT) extra &= ~BIT.RIGHT;
      if (held & BIT.UP) extra &= ~BIT.DOWN;
      if (held & BIT.DOWN) extra &= ~BIT.UP;
      let w = socd(held | extra);
      this.latched[p] = 0;
      if (p === 0) this.touch.latched = 0;
      const f = this.forced[p];
      if (f) {
        w = socd(f.word);
        if (--f.ticks <= 0) this.forced[p] = null;
      } else if (!this.live) {
        w = 0;
      }
      this.lastWord[p] = w;
      out[p] = w;
    }
    return out;
  }

  /** the word of the last tick for player p (input display / read-back) */
  word(p: 0 | 1): number { return this.lastWord[p]; }

  /** dev / test surface: player p's word is exactly `word` for the next `ticks` ticks (even when not live) */
  force(p: 0 | 1, word: number, ticks: number): void {
    const n = Math.max(0, Math.floor(Number.isFinite(ticks) ? ticks : 0));
    this.forced[p] = n > 0 ? { word: word & WORD_MASK, ticks: n } : null;
  }

  /** the device that produced player p's most recent press (button prompts) */
  lastDevice(p: 0 | 1): Device { return this.dev[p]; }

  /** codes currently held (read-back) */
  heldCodes(): string[] { return [...this.held]; }

  releaseAll(): void {
    this.held.clear();
    this.latched[0] = 0; this.latched[1] = 0;
    this.touch.held = 0; this.touch.latched = 0;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    this.uiFns.clear();
    this.modeFns.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.suspended) return;
    const code = e.code || e.key;
    const list = this.codeMap.get(code);
    if (!list) return;
    if (isTextField(e.target)) return;
    if (down && !e.repeat) this.switchMode('kbm');
    // keep the page from scrolling (Space / arrows) while a bout runs; menus keep their own keys
    if (this.live && code !== 'Escape') e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.held.add(code);
      this.keyEvents++;
      for (const b of list) {
        if (b.action === 'pause') this.emitUi('pause', b.p, e);
        else { this.latched[b.p] |= ACTION_BIT[b.action as SimAction]; this.dev[b.p] = 'keyboard'; }
      }
    } else {
      this.held.delete(code);
    }
  }
}
