// HIT PARADE - player settings (CONTRACT §8, §17.1, §18.7). Pattern: dyefield ui/settings.ts SettingsStore
// (field-by-field sanitise, `on()` change events with the changed top-level keys) + blocktooth Settings
// (screenShake, reduceFlashing, cinematic).
//
// Persisted INSIDE the save blob (`hitparade.save.v1` -> `settings`, CONTRACT §8) through ui/save.ts, so every
// storage touch is already try/catch-wrapped there (private windows / sandboxed iframes: not remembered, never a
// crash).
//
//   controls       per player [P1, P2]: { scheme 0 SIMPLE (default) | 1 CLASSIC (CONTRACT §1), keys (input.ts Action
//                  -> KeyboardEvent.code[], <= 3), pad (Action -> Standard-mapping button index[], <= 3) } - the
//                  shape lane UI's settings screen reads (ui/types.ts PlayerControls, action ids up/down/left/right/
//                  l/m/h/s/assist/throw/parry/impact/taunt/pause). A key belongs to ONE action of ONE player (a
//                  saved conflict from an old build: P1 first, then P2, the first keeps it).
//   volume         master / music / sfx / voice / crowd, 0..1 (audio.setVolumes takes this object)
//   gore           'splatter' (comic red, default) | 'sparks' | 'confetti' (owner rule: a settings toggle)
//   screenShake    0..1 camera-shake scale (0 = off)
//   reduceFlashing no full-screen flashes (super flash / parry flash are dimmed by the view)
//   cinematics     'full' | 'short' - Lv3 PRIME TIME camera shots only; the sim's cinematic frame count never
//                  changes (CONTRACT §8)
//   bloom          optional bloom pass (view quality)
//   quality        'low' | 'med' | 'high' (default high, med on a coarse-pointer device; the renderer's resolution
//                  governor adapts inside it; ?quality= overrides per page)
//   showFps        the fps chip
//   touch*         CONTRACT_MOBILE M8 overlay options (only read in touch mode): scale, opacity, left-handed,
//                  touchScheme 'pad' (default) | 'swipe', touchLayout (per-button {dx, dy, s} offsets or null), haptics
//   language       'en' (the only one shipped)
//
// `viewSettings(s)` maps onto view/bout.ts ViewSettings (§17.1) - the one place that mapping lives.

import { ACTIONS, PAD_BUTTONS, defaultKeys, defaultPad, type Action, type KeyBindings, type PadBindings } from '../input.ts';
import { SaveStore } from './save.ts';

export type Scheme = 0 | 1;
export type Gore = 'splatter' | 'sparks' | 'confetti';
export type Cinematics = 'full' | 'short';
export type Quality = 'low' | 'med' | 'high';
export type TouchScheme = 'pad' | 'swipe';
/** custom touch-button offsets (lane UI's layout editor): button id -> { dx, dy, s } */
export type TouchLayout = Record<string, { dx: number; dy: number; s: number }>;

export interface PlayerControls { scheme: Scheme; keys: KeyBindings; pad: PadBindings }

export interface Volumes { master: number; music: number; sfx: number; voice: number; crowd: number }

export interface Settings {
  controls: [PlayerControls, PlayerControls];
  volume: Volumes;
  gore: Gore;
  screenShake: number;
  reduceFlashing: boolean;
  cinematics: Cinematics;
  bloom: boolean;
  quality: Quality;
  showFps: boolean;
  touchScale: number;
  touchOpacity: number;
  touchLeftHanded: boolean;
  touchScheme: TouchScheme;
  touchLayout: TouchLayout | null;
  haptics: boolean;
  language: 'en';
}

/** view/bout.ts ViewSettings (CONTRACT §17.1) */
export interface ViewSettingsShape {
  splatter: Gore;
  screenShake: number;
  reduceFlashing: boolean;
  cinematicCamera: Cinematics;
  bloom: boolean;
}

export const GORE: readonly Gore[] = ['splatter', 'sparks', 'confetti'];
export const QUALITIES: readonly Quality[] = ['low', 'med', 'high'];
export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.5, sfx: 0.9, voice: 0.9, crowd: 0.7 };
export const TOUCH_SCALE_MIN = 0.8;
export const TOUCH_SCALE_MAX = 1.3;
export const TOUCH_OPACITY_MIN = 0.35;
export const TOUCH_OPACITY_MAX = 1;

/** the OS 'reduce motion' preference: screen shake starts at 0.4 instead of 1 */
function osReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** a phone / tablet starts at 'med' (its GPU budget), everything else at 'high' */
function coarsePointer(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

export function defaultControls(p: 0 | 1): PlayerControls {
  return { scheme: 0, keys: defaultKeys(p), pad: defaultPad() };
}

export function defaultSettings(): Settings {
  return {
    controls: [defaultControls(0), defaultControls(1)],
    volume: { ...DEFAULT_VOLUMES },
    gore: 'splatter',
    screenShake: osReducedMotion() ? 0.4 : 1,
    reduceFlashing: false,
    cinematics: 'full',
    bloom: true,
    quality: coarsePointer() ? 'med' : 'high',
    showFps: false,
    touchScale: 1,
    touchOpacity: 0.75,
    touchLeftHanded: false,
    touchScheme: 'pad',
    touchLayout: null,
    haptics: true,
    language: 'en',
  };
}

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : d);

/** KeyboardEvent.code values a binding may hold (no mouse buttons: a fighter is keys + pads) */
export const CODE_RE = /^(Key[A-Z]|Digit\d|Numpad(\d|Add|Subtract|Multiply|Divide|Decimal|Enter)|F\d{1,2}|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Tab|Enter|Escape|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Backspace|Insert|Delete|Home|End|PageUp|PageDown|IntlBackslash)$/;

/** both players' key bindings (raw[p] = one player's keys): valid codes, <= 3 per action, one owner per code (P1 first) */
export function sanitizeKeys(raw: ReadonlyArray<unknown>): [KeyBindings, KeyBindings] {
  const out: [KeyBindings, KeyBindings] = [defaultKeys(0), defaultKeys(1)];
  for (const p of [0, 1] as const) {
    const r = raw[p];
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    for (const a of ACTIONS) {
      const v = o[a];
      if (!Array.isArray(v)) continue;
      out[p][a] = [...new Set(v.filter((c): c is string => typeof c === 'string' && CODE_RE.test(c)))].slice(0, 3);
    }
  }
  const seen = new Set<string>();
  for (const p of [0, 1] as const) {
    for (const a of ACTIONS) out[p][a] = out[p][a].filter((c) => { if (seen.has(c)) return false; seen.add(c); return true; });
  }
  return out;
}

/** one player's pad bindings: button indices 0..16, <= 3 per action, one action per button */
export function sanitizePad(raw: unknown): PadBindings {
  const out = defaultPad();
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const a of ACTIONS) {
      const v = o[a];
      if (!Array.isArray(v)) continue;
      out[a] = [...new Set(v.filter((b): b is number => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b < PAD_BUTTONS))].slice(0, 3);
    }
  }
  const seen = new Set<number>();
  for (const a of ACTIONS) out[a] = out[a].filter((b) => { if (seen.has(b)) return false; seen.add(b); return true; });
  return out;
}

/** both players' controls ({ scheme, keys, pad } each) */
export function sanitizeControls(raw: unknown): [PlayerControls, PlayerControls] {
  const arr = Array.isArray(raw) ? raw : [];
  const obj = (p: 0 | 1): Record<string, unknown> => (arr[p] && typeof arr[p] === 'object' ? arr[p] as Record<string, unknown> : {});
  const keys = sanitizeKeys([obj(0).keys, obj(1).keys]);
  const one = (p: 0 | 1): PlayerControls => ({ scheme: obj(p).scheme === 1 ? 1 : 0, keys: keys[p], pad: sanitizePad(obj(p).pad) });
  return [one(0), one(1)];
}

function sanitizeTouchLayout(raw: unknown): TouchLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: TouchLayout = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,24}$/i.test(k) || !v || typeof v !== 'object' || ++n > 24) continue;
    const o = v as Record<string, unknown>;
    out[k] = { dx: clamp(o.dx, -2000, 2000, 0), dy: clamp(o.dy, -2000, 2000, 0), s: clamp(o.s, 0.5, 2, 1) };
  }
  return Object.keys(out).length ? out : null;
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const vol = (r.volume && typeof r.volume === 'object' ? r.volume : {}) as Record<string, unknown>;
  return {
    controls: sanitizeControls(r.controls),
    volume: {
      master: clamp(vol.master, 0, 1, d.volume.master),
      music: clamp(vol.music, 0, 1, d.volume.music),
      sfx: clamp(vol.sfx, 0, 1, d.volume.sfx),
      voice: clamp(vol.voice, 0, 1, d.volume.voice),
      crowd: clamp(vol.crowd, 0, 1, d.volume.crowd),
    },
    gore: pick(r.gore, GORE, d.gore),
    screenShake: clamp(typeof r.screenShake === 'boolean' ? (r.screenShake ? 1 : 0) : r.screenShake, 0, 1, d.screenShake),
    reduceFlashing: bool(r.reduceFlashing, d.reduceFlashing),
    cinematics: pick(r.cinematics, ['full', 'short'] as const, d.cinematics),
    bloom: bool(r.bloom, d.bloom),
    quality: pick(r.quality, QUALITIES, d.quality),
    showFps: bool(r.showFps, d.showFps),
    touchScale: clamp(r.touchScale, TOUCH_SCALE_MIN, TOUCH_SCALE_MAX, d.touchScale),
    touchOpacity: clamp(r.touchOpacity, TOUCH_OPACITY_MIN, TOUCH_OPACITY_MAX, d.touchOpacity),
    touchLeftHanded: bool(r.touchLeftHanded, d.touchLeftHanded),
    touchScheme: pick(r.touchScheme, ['pad', 'swipe'] as const, d.touchScheme),
    touchLayout: sanitizeTouchLayout(r.touchLayout),
    haptics: bool(r.haptics, d.haptics),
    language: 'en',
  };
}

/** Settings -> view/bout.ts ViewSettings (CONTRACT §17.1 / §18.7) */
export function viewSettings(s: Readonly<Settings>): ViewSettingsShape {
  return { splatter: s.gore, screenShake: s.screenShake, reduceFlashing: s.reduceFlashing, cinematicCamera: s.cinematics, bloom: s.bloom };
}

export type SettingsListener = (value: Readonly<Settings>, keys: Array<keyof Settings>) => void;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** the settings, persisted in the save blob: set(patch) -> sanitise -> persist -> notify the keys that changed */
export class SettingsStore {
  private value: Settings;
  private readonly fns = new Set<SettingsListener>();
  readonly save: SaveStore;

  constructor(save?: SaveStore) {
    this.save = save ?? new SaveStore();
    this.value = sanitizeSettings(this.save.settingsRaw());
  }

  get(): Readonly<Settings> { return this.value; }

  /** false when the last write did not reach storage (private window / blocked): the value still applies */
  get persisted(): boolean { return this.save.persisted; }

  /** merge a patch of top-level keys; returns the keys that changed */
  set(patch: Partial<Settings>): Array<keyof Settings> {
    const next = sanitizeSettings({ ...this.value, ...patch });
    const keys: Array<keyof Settings> = [];
    for (const k of Object.keys(next) as Array<keyof Settings>) {
      if (JSON.stringify(next[k]) !== JSON.stringify(this.value[k])) keys.push(k);
    }
    if (!keys.length) return keys;
    this.value = next;
    this.save.writeSettings(next);
    for (const fn of [...this.fns]) {
      try { fn(this.value, keys); } catch (e) { console.error('[hit-parade] settings listener', e); }
    }
    return keys;
  }

  /** the remap capture: `code` becomes key `slot` of (p, action) and leaves every other action of both players */
  bindKey(p: 0 | 1, action: Action, code: string, slot = 0): boolean {
    if (!CODE_RE.test(code)) return false;
    const controls = clone(this.value.controls);
    for (const q of [0, 1] as const) for (const a of ACTIONS) controls[q].keys[a] = controls[q].keys[a].filter((c) => c !== code);
    const list = controls[p].keys[action];
    const i = Math.max(0, Math.min(list.length, Math.floor(slot)));
    list.splice(i, list[i] !== undefined ? 1 : 0, code);
    controls[p].keys[action] = list.slice(0, 3);
    return this.set({ controls }).length > 0;
  }

  /** a pad binding: `button` becomes button `slot` of (p, action) and leaves p's other actions */
  bindPad(p: 0 | 1, action: Action, button: number, slot = 0): boolean {
    if (!Number.isInteger(button) || button < 0 || button >= PAD_BUTTONS) return false;
    const controls = clone(this.value.controls);
    for (const a of ACTIONS) controls[p].pad[a] = controls[p].pad[a].filter((b) => b !== button);
    const list = controls[p].pad[action];
    const i = Math.max(0, Math.min(list.length, Math.floor(slot)));
    list.splice(i, list[i] !== undefined ? 1 : 0, button);
    controls[p].pad[action] = list.slice(0, 3);
    return this.set({ controls }).length > 0;
  }

  setScheme(p: 0 | 1, scheme: Scheme): void {
    const controls = clone(this.value.controls);
    controls[p].scheme = scheme === 1 ? 1 : 0;
    this.set({ controls });
  }

  /** player p's keys + pad back to the defaults (the scheme is kept); no argument = both players */
  resetControls(p?: 0 | 1): void {
    const controls = clone(this.value.controls);
    for (const q of p === undefined ? [0, 1] as const : [p]) {
      controls[q] = { scheme: controls[q].scheme, keys: defaultKeys(q), pad: defaultPad() };
    }
    this.set({ controls });
  }

  reset(): void { this.set(defaultSettings()); }

  on(fn: SettingsListener): () => void {
    this.fns.add(fn);
    return () => { this.fns.delete(fn); };
  }
}
