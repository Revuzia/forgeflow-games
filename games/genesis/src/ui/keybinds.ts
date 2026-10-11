// GENESIS — every input action, its default keys and gamepad buttons, rebinding and conflicts (CONTRACT.md §16:
// "key rebinding (all actions)", "rebindable, stored in localStorage"). DOM-free at import (tests/ui-logic.test.ts).
//
// A binding is a combo string: modifiers in a fixed order then the KeyboardEvent.code — "Ctrl+KeyK", "Shift+Period",
// "Slash" — or, for the slap modifier, a bare modifier name ("Alt"). HOLD actions (camera movement, the radial, drawing
// a gesture) match their key whatever Shift does (Shift runs the camera faster) but not with Ctrl/Alt/Meta; PRESS
// actions match their exact combo. Gamepad buttons use the W3C standard mapping names below. Two actions sharing a
// combo is a conflict: the settings panel shows it, and the first action in this list wins at runtime.
//
// Key LAYERS: an action with a `context` ('photo', 'walk') is live only in that camera mode, and there it comes first:
// its key shadows whatever the world layer binds to the same key (in photo mode Space takes the picture instead of
// pausing, P leaves instead of entering). Conflicts are checked within a layer, never across layers.

/** a modal key layer (a camera mode); actions without one are the world's */
export type Context = 'photo' | 'walk';

export interface ActionDef {
  id: string;
  label: string;
  group: 'Camera' | 'Time' | 'Powers' | 'Hand' | 'Windows' | 'Photo mode' | 'Walking';
  keys: string[];
  pad?: string[];
  /** held (true while down) rather than a single press */
  hold?: boolean;
  /** a modifier that changes a mouse click (slap = modifier + click) */
  modifier?: boolean;
  desc?: string;
  /** live only in this camera mode, where it shadows the world's binding of the same key */
  context?: Context;
}

/** gamepad buttons of the standard mapping, by index */
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Home'] as const;

export const ACTIONS: ActionDef[] = [
  // camera (held)
  { id: 'cam.forward', label: 'Pan forward', group: 'Camera', keys: ['KeyW', 'ArrowUp'], hold: true },
  { id: 'cam.back', label: 'Pan back', group: 'Camera', keys: ['KeyS', 'ArrowDown'], hold: true },
  { id: 'cam.left', label: 'Pan left', group: 'Camera', keys: ['KeyA', 'ArrowLeft'], hold: true },
  { id: 'cam.right', label: 'Pan right', group: 'Camera', keys: ['KeyD', 'ArrowRight'], hold: true },
  { id: 'cam.turnLeft', label: 'Turn left', group: 'Camera', keys: ['KeyZ'], hold: true },
  { id: 'cam.turnRight', label: 'Turn right', group: 'Camera', keys: ['KeyX'], hold: true },
  { id: 'cam.tiltUp', label: 'Tilt toward the horizon', group: 'Camera', keys: ['KeyR'], hold: true },
  { id: 'cam.tiltDown', label: 'Tilt to look down', group: 'Camera', keys: ['KeyF'], hold: true },
  { id: 'cam.zoomIn', label: 'Descend', group: 'Camera', keys: ['Equal', 'NumpadAdd'], pad: ['RB'], hold: true },
  { id: 'cam.zoomOut', label: 'Rise', group: 'Camera', keys: ['Minus', 'NumpadSubtract'], pad: ['LB'], hold: true },
  { id: 'cam.system', label: 'System view', group: 'Camera', keys: ['KeyM'] },
  { id: 'cam.fly', label: 'Free flight', group: 'Camera', keys: ['KeyV'] },
  { id: 'cam.home', label: 'Back to orbit of this world', group: 'Camera', keys: ['Home'] },
  { id: 'cam.follow', label: 'Follow the selection', group: 'Camera', keys: ['KeyL'] },
  { id: 'cam.look', label: 'Look at the selection', group: 'Camera', keys: ['Backslash'] },
  { id: 'cam.dolly', label: 'Cinematic: circle the selected settlement', group: 'Camera', keys: ['KeyJ'] },
  { id: 'cam.walk', label: 'Walk among them (at the selection or the cursor)', group: 'Camera', keys: ['KeyK'] },
  { id: 'cam.photo', label: 'Photo mode', group: 'Camera', keys: ['KeyP'] },
  { id: 'cam.menu', label: 'Camera modes', group: 'Camera', keys: ['Backquote'], pad: ['Back'] },
  // time
  { id: 'time.pause', label: 'Pause / resume', group: 'Time', keys: ['Space'] },
  { id: 'time.speed1', label: 'Speed 1×', group: 'Time', keys: ['Digit1'] },
  { id: 'time.speed10', label: 'Speed 10×', group: 'Time', keys: ['Digit2'] },
  { id: 'time.speed100', label: 'Speed 100×', group: 'Time', keys: ['Digit3'] },
  { id: 'time.speed1000', label: 'Speed 1000×', group: 'Time', keys: ['Digit4'] },
  { id: 'time.faster', label: 'Faster', group: 'Time', keys: ['Digit5'], pad: ['Up'] },
  { id: 'time.slower', label: 'Slower', group: 'Time', keys: ['Digit0'], pad: ['Down'] },
  { id: 'time.stepTick', label: 'Step one minute', group: 'Time', keys: ['Comma'] },
  { id: 'time.stepHour', label: 'Step one hour', group: 'Time', keys: ['Period'] },
  { id: 'time.stepDay', label: 'Step one day', group: 'Time', keys: ['Shift+Period'] },
  { id: 'time.rewindHour', label: 'Rewind one hour', group: 'Time', keys: ['Shift+Comma'] },
  // powers
  { id: 'ui.palette', label: 'Command palette', group: 'Powers', keys: ['Slash', 'Ctrl+KeyK'], pad: ['Y'] },
  { id: 'ui.freeform', label: 'Do this… (words)', group: 'Powers', keys: ['Enter', 'Semicolon'], pad: ['X'] },
  { id: 'ui.radial', label: 'Radial menu (hold)', group: 'Powers', keys: ['KeyQ'], pad: ['RS'], hold: true },
  { id: 'ui.gesture', label: 'Draw a gesture (hold)', group: 'Powers', keys: ['KeyG'], pad: ['LT'], hold: true },
  { id: 'tool.apply', label: 'Use the power at the cursor', group: 'Powers', keys: ['KeyY'], pad: ['A'] },
  { id: 'tool.repeat', label: 'Cast the last power again at the cursor', group: 'Powers', keys: ['KeyT'] },
  { id: 'tool.cancel', label: 'Cancel / back', group: 'Powers', keys: ['Escape'], pad: ['B'] },
  { id: 'tool.bigger', label: 'Brush larger', group: 'Powers', keys: ['BracketRight'] },
  { id: 'tool.smaller', label: 'Brush smaller', group: 'Powers', keys: ['BracketLeft'] },
  { id: 'tool.stronger', label: 'Brush stronger', group: 'Powers', keys: ['Shift+BracketRight'] },
  { id: 'tool.weaker', label: 'Brush weaker', group: 'Powers', keys: ['Shift+BracketLeft'] },
  // hand
  { id: 'hand.primary', label: 'Hand / use (hold: grab, paint)', group: 'Hand', keys: [], pad: ['RT'], hold: true },
  { id: 'hand.take', label: 'Take what is under the hand / set it down', group: 'Hand', keys: ['KeyE'], pad: ['LS'] },
  { id: 'hand.throw', label: 'Throw what the hand holds toward the cursor', group: 'Hand', keys: ['Shift+KeyE'] },
  { id: 'hand.slap', label: 'Slap what is under the hand', group: 'Hand', keys: ['KeyB'] },
  { id: 'hand.stroke', label: 'Stroke what is under the hand', group: 'Hand', keys: ['KeyN'] },
  { id: 'hand.slapMod', label: 'Slap modifier (+ click)', group: 'Hand', keys: ['Alt'], modifier: true },
  // windows
  { id: 'ui.chronicle', label: 'Chronicle', group: 'Windows', keys: ['KeyC'] },
  { id: 'ui.overlayNext', label: 'Next map overlay', group: 'Windows', keys: ['KeyO'], pad: ['Right'] },
  { id: 'ui.overlayPrev', label: 'Previous map overlay', group: 'Windows', keys: ['Shift+KeyO'], pad: ['Left'] },
  { id: 'ui.overlayOff', label: 'Overlay off', group: 'Windows', keys: ['Alt+KeyO'] },
  { id: 'ui.inspect', label: 'Inspect what is under the cursor', group: 'Windows', keys: ['KeyI'] },
  { id: 'ui.laws', label: 'Laws of this world', group: 'Windows', keys: ['KeyU'] },
  { id: 'ui.settings', label: 'Settings', group: 'Windows', keys: ['F10', 'Ctrl+Comma'] },
  { id: 'ui.saves', label: 'Saves', group: 'Windows', keys: ['F6', 'Ctrl+KeyS'] },
  { id: 'ui.newWorld', label: 'New world', group: 'Windows', keys: ['F3'] },
  { id: 'ui.mods', label: 'Mods', group: 'Windows', keys: ['F8'] },
  { id: 'ui.quicksave', label: 'Quicksave', group: 'Windows', keys: ['F5'] },
  { id: 'ui.quickload', label: 'Quickload', group: 'Windows', keys: ['F9'] },
  { id: 'ui.help', label: 'Controls card', group: 'Windows', keys: ['F1', 'Shift+Slash'] },
  { id: 'ui.menu', label: 'Game menu', group: 'Windows', keys: ['F2'], pad: ['Start'] },
  { id: 'ui.hide', label: 'Hide the interface', group: 'Windows', keys: ['KeyH'] },
  // photo mode (its own layer: the camera flies free, the interface is hidden, time stands still unless let run)
  { id: 'photo.capture', label: 'Take the picture', group: 'Photo mode', keys: ['Space', 'Enter'], pad: ['A'], context: 'photo' },
  { id: 'photo.exit', label: 'Leave photo mode', group: 'Photo mode', keys: ['KeyP'], pad: ['B'], context: 'photo' },
  { id: 'photo.focusNear', label: 'Focus nearer', group: 'Photo mode', keys: ['BracketLeft'], pad: ['Down'], context: 'photo' },
  { id: 'photo.focusFar', label: 'Focus farther', group: 'Photo mode', keys: ['BracketRight'], pad: ['Up'], context: 'photo' },
  { id: 'photo.blurLess', label: 'Less depth blur', group: 'Photo mode', keys: ['Shift+BracketLeft'], context: 'photo' },
  { id: 'photo.blurMore', label: 'More depth blur', group: 'Photo mode', keys: ['Shift+BracketRight'], context: 'photo' },
  { id: 'photo.exposureDown', label: 'Darker', group: 'Photo mode', keys: ['Comma'], pad: ['Left'], context: 'photo' },
  { id: 'photo.exposureUp', label: 'Brighter', group: 'Photo mode', keys: ['Period'], pad: ['Right'], context: 'photo' },
  { id: 'photo.zoomIn', label: 'Longer lens (zoom in)', group: 'Photo mode', keys: ['Equal', 'NumpadAdd'], context: 'photo' },
  { id: 'photo.zoomOut', label: 'Wider lens (zoom out)', group: 'Photo mode', keys: ['Minus', 'NumpadSubtract'], context: 'photo' },
  { id: 'photo.filter', label: 'Next filter', group: 'Photo mode', keys: ['KeyT'], pad: ['X'], context: 'photo' },
  { id: 'photo.frame', label: 'Next frame', group: 'Photo mode', keys: ['KeyG'], pad: ['Y'], context: 'photo' },
  { id: 'photo.panel', label: 'Show / hide the photo panel', group: 'Photo mode', keys: ['KeyH'], pad: ['Start'], context: 'photo' },
  { id: 'photo.time', label: 'Freeze time / let it run', group: 'Photo mode', keys: ['KeyY'], context: 'photo' },
  // walking among them (the world's keys still work: powers, the hand, time)
  { id: 'walk.exit', label: 'Rise from the ground (leave walking)', group: 'Walking', keys: ['KeyK'], pad: ['B'], context: 'walk' },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MOD_CODES: Record<string, string> = {
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', ShiftLeft: 'Shift', ShiftRight: 'Shift', MetaLeft: 'Meta', MetaRight: 'Meta',
};

export interface KeyLike { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

/** the combo string of a key event ("Ctrl+Shift+KeyK"); a bare modifier press gives its name ("Alt") */
export function comboOf(e: KeyLike): string {
  if (MOD_CODES[e.code]) return MOD_CODES[e.code];
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.code);
  return parts.join('+');
}

export function splitCombo(c: string): { mods: Set<string>; code: string } {
  const parts = c.split('+');
  const code = parts.pop() ?? '';
  return { mods: new Set(parts), code };
}

const KEY_NAMES: Record<string, string> = {
  Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', BracketLeft: '[', BracketRight: ']', Minus: '−', Equal: '=',
  Backquote: '`', Space: 'Space', Enter: 'Enter', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Tab: 'Tab', Backspace: '⌫', Delete: 'Del',
};

/** a combo as people read it: "Ctrl K", "⇧ .", "/" */
export function comboLabel(c: string): string {
  if (!c) return '—';
  if (MODS.includes(c as (typeof MODS)[number])) return c === 'Shift' ? '⇧ Shift' : c;
  const { mods, code } = splitCombo(c);
  let k = KEY_NAMES[code] ?? code;
  if (code.startsWith('Key')) k = code.slice(3);
  else if (code.startsWith('Digit')) k = code.slice(5);
  else if (code.startsWith('Numpad')) k = `Num ${code.slice(6)}`;
  const m = MODS.filter((x) => mods.has(x)).map((x) => (x === 'Shift' ? '⇧' : x === 'Meta' ? '⌘' : x));
  return [...m, k].join(' ');
}

export interface BindingState { keys: Record<string, string[]>; pad: Record<string, string[]> }

const STORE_KEY = 'genesis.keybinds.v1';

export interface Storage { get<T>(k: string, d: T): T; set(k: string, v: unknown): void }

export class Keybinds {
  private keys = new Map<string, string[]>();
  private pad = new Map<string, string[]>();
  private storage: Storage | null;
  /** codes currently down (hold actions read them) */
  readonly down = new Set<string>();
  /** told when bindings change (kept for older callers; prefer listen()) */
  onChange: (() => void) | null = null;
  private listeners: (() => void)[] = [];

  /** be told whenever a binding changes (labels built from bindings refresh) */
  listen(fn: () => void): void { this.listeners.push(fn); }

  constructor(storage: Storage | null = null) {
    this.storage = storage;
    this.resetAll(false);
    const saved = storage?.get<Partial<BindingState> | null>(STORE_KEY, null);
    if (saved?.keys) for (const [id, v] of Object.entries(saved.keys)) if (ACTION_BY_ID.has(id) && Array.isArray(v)) this.keys.set(id, v.filter((x) => typeof x === 'string'));
    if (saved?.pad) for (const [id, v] of Object.entries(saved.pad)) if (ACTION_BY_ID.has(id) && Array.isArray(v)) this.pad.set(id, v.filter((x) => typeof x === 'string'));
  }

  private save(): void {
    this.storage?.set(STORE_KEY, { keys: Object.fromEntries(this.keys), pad: Object.fromEntries(this.pad) } satisfies BindingState);
    this.onChange?.();
    for (const l of this.listeners) l();
  }

  keysOf(id: string): string[] { return this.keys.get(id) ?? []; }
  padOf(id: string): string[] { return this.pad.get(id) ?? []; }

  /** the first key of an action as people read it ("" when unbound) */
  hint(id: string): string {
    const k = this.keysOf(id)[0];
    return k ? comboLabel(k) : '';
  }

  /** set slot `i` of an action's keys (a combo, or '' to clear the slot) */
  setKey(id: string, i: number, combo: string): void {
    const l = [...this.keysOf(id)];
    if (combo) l[i] = combo; else l.splice(i, 1);
    this.keys.set(id, l.filter(Boolean));
    this.save();
  }

  setPad(id: string, i: number, button: string): void {
    const l = [...this.padOf(id)];
    if (button) l[i] = button; else l.splice(i, 1);
    this.pad.set(id, l.filter(Boolean));
    this.save();
  }

  reset(id: string): void {
    const a = ACTION_BY_ID.get(id);
    if (!a) return;
    this.keys.set(id, [...a.keys]);
    this.pad.set(id, [...(a.pad ?? [])]);
    this.save();
  }

  resetAll(save = true): void {
    for (const a of ACTIONS) { this.keys.set(a.id, [...a.keys]); this.pad.set(a.id, [...(a.pad ?? [])]); }
    if (save) this.save();
  }

  /**
   * press actions whose combo is exactly this event's (in list order: the first wins a conflict). With a `context`
   * (a camera mode's layer) only that layer's actions are returned; without one, only the world's.
   */
  pressActions(e: KeyLike, context?: Context): string[] {
    const c = comboOf(e);
    const out: string[] = [];
    for (const a of ACTIONS) {
      if (a.hold || a.modifier || a.context !== context) continue;
      if (this.keysOf(a.id).includes(c)) out.push(a.id);
    }
    return out;
  }

  /** hold actions this key starts (Shift allowed; Ctrl / Alt / Meta not) */
  holdActions(e: KeyLike): string[] {
    if (e.ctrlKey || e.altKey || e.metaKey) return [];
    const out: string[] = [];
    for (const a of ACTIONS) {
      if (!a.hold) continue;
      for (const k of this.keysOf(a.id)) {
        const { mods, code } = splitCombo(k);
        if (code === e.code && !mods.has('Ctrl') && !mods.has('Alt') && !mods.has('Meta')) { out.push(a.id); break; }
      }
    }
    return out;
  }

  /** is a hold action's key down now */
  held(id: string): boolean {
    for (const k of this.keysOf(id)) if (this.down.has(splitCombo(k).code)) return true;
    return false;
  }

  /** is the modifier of a modifier action down in this event (slap = modifier + click) */
  modifierDown(id: string, e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): boolean {
    for (const k of this.keysOf(id)) {
      if (k === 'Alt' && e.altKey) return true;
      if (k === 'Ctrl' && e.ctrlKey) return true;
      if (k === 'Shift' && e.shiftKey) return true;
      if (k === 'Meta' && e.metaKey) return true;
    }
    return false;
  }

  /** actions bound to a gamepad button (the world's, or with `context` that layer's only) */
  padActions(button: string, context?: Context): string[] {
    const out: string[] = [];
    for (const a of ACTIONS) if (a.context === context && this.padOf(a.id).includes(button)) out.push(a.id);
    return out;
  }

  /**
   * Conflicts: every combo (or pad button) bound to more than one action. A hold key and a press combo with Shift on
   * the same code do not conflict (Shift+E throws, E takes; W pans faster with Shift held).
   */
  conflicts(): { combo: string; actions: string[]; pad: boolean }[] {
    const by = new Map<string, string[]>();
    for (const a of ACTIONS) for (const k of this.keysOf(a.id)) {
      // a camera mode's layer is its own namespace (it shadows the world's keys on purpose)
      const key = a.context ? `${a.context}:${k}` : a.hold ? `hold:${splitCombo(k).code}` : a.modifier ? `mod:${k}` : `press:${k}`;
      const l = by.get(key) ?? [];
      l.push(a.id);
      by.set(key, l);
    }
    // a hold key also collides with a plain (unmodified) press of the same code
    for (const [key, ids] of [...by.entries()]) {
      if (!key.startsWith('hold:')) continue;
      const code = key.slice(5);
      const press = by.get(`press:${code}`) ?? [];
      if (press.length) by.set(key, [...ids, ...press]);
    }
    const out: { combo: string; actions: string[]; pad: boolean }[] = [];
    for (const [key, ids] of by) {
      const uniq = [...new Set(ids)];
      if (uniq.length > 1) out.push({ combo: key.slice(key.indexOf(':') + 1), actions: uniq, pad: false });
    }
    const pb = new Map<string, string[]>();
    for (const a of ACTIONS) for (const b of this.padOf(a.id)) { const k = a.context ? `${a.context}:${b}` : b; const l = pb.get(k) ?? []; l.push(a.id); pb.set(k, l); }
    for (const [b, ids] of pb) if (ids.length > 1) out.push({ combo: b.slice(b.indexOf(':') + 1), actions: ids, pad: true });
    return out;
  }

  /** the actions that conflict with this one (for the settings row) */
  conflictsOf(id: string): string[] {
    const out = new Set<string>();
    for (const c of this.conflicts()) if (c.actions.includes(id)) for (const o of c.actions) if (o !== id) out.add(o);
    return [...out];
  }
}
