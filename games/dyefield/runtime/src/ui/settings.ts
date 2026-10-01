// DYEFIELD — player settings + profile (CONTRACT_P6_11 §20). Two small stores persisted in localStorage
// (every read / write in try/catch: a private window or blocked storage just means "not remembered").
//
//   SettingsStore  key remap (every action; Input codes), mouse sensitivity (× the camera's base), invert Y,
//                  colorblind marks, master / music / sfx volume (0..1 — the shape audio.setVolumes() takes),
//                  render quality auto | high | low, show FPS.
//   ProfileStore   the lobby selections: name, crew (1 SUNCREW | 2 GULF CREW), kit, map (or 'random'), the
//                  time-of-day preset, bot skill; CONTRACT_FFA F3: the match mode ('teams' | 'ffa', default
//                  'teams') and the FFA colour (1..8 = teams.json → ffa, default 1 = amber); CONTRACT_WASHOUT W4: the
//                  rule ('turf' | 'washout', default 'turf').
//   CONTRACT_CONTROLS C1: Settings.aimSens (0.3–1.2, 0.65) and aimToggle (false = hold AIM); the 'aim' binding (RMB) and
//                  the saved-bindings migration (the old default SUB [E, RMB] → [E] + AIM [RMB]; see sanitizeBindings).
//
// Both emit change events: `store.on((value, keys) => …)` → an unsubscribe function. `keys` lists the
// top-level fields that changed. The integrator wires audio with one line:
//   settings.on((s, k) => { if (k.includes('volume')) audio.setVolumes(s.volume); });

import { DEFAULT_BINDINGS, OLD_DEFAULT_SUB, type Action } from '../input.ts';
import { BOT_SKILL_IDS, DEFAULT_BOT_SKILL, parseBotSkill, type BotSkill } from '../core/match/roster.ts';
import { isRenderQuality, type RenderQuality } from '../view/renderer.ts';
import type { TeamId } from '../core/types.ts';

export type Bindings = Record<Action, string[]>;

export interface Volumes { master: number; music: number; sfx: number }

export interface Settings {
  bindings: Bindings;
  /** multiplier on CAMERA.sensitivity (0.25 … 3) */
  sensitivity: number;
  invertY: boolean;
  /** teams.json colorblind palette + the GULF CREW hatch (dye shader uColorblind, HUD, minimap) */
  colorblind: boolean;
  volume: Volumes;
  quality: RenderQuality;
  showFps: boolean;
  /** no screen shake (FollowCamera.reduceMotion / the juice module) */
  reduceMotion: boolean;
  // ── CONTRACT_MOBILE M8: touch controls (the overlay in runtime/src/touch/; only read in touch mode) ──
  /** touch look gain (× the M2 look rates), 0.3 … 3 */
  touchSens: number;
  /** control size multiplier, 0.8 … 1.3 (hit targets never drop below 44 CSS px) */
  touchScale: number;
  /** idle control opacity, 0.35 … 1 (a pressed control is 1.0) */
  touchOpacity: number;
  /** mirror the whole layout (stick on the right, buttons on the left) */
  touchLeftHanded: boolean;
  /** touch-only aim assist (slowdown + a light rotational pull, touch/aimassist.ts) */
  aimAssist: boolean;
  /** navigator.vibrate feedback (a no-op where unsupported, e.g. iOS) */
  haptics: boolean;
  // ── CONTRACT_CONTROLS C1: AIM (view only) ──
  /** look sensitivity while aiming (× the normal mouse / touch look), 0.3 … 1.2 */
  aimSens: number;
  /** false = hold AIM (the default, the industry norm); true = each AIM press toggles it */
  aimToggle: boolean;
}

/** CONTRACT_CONTROLS C1 range + default of the aim sensitivity */
export const AIM_SENS_MIN = 0.3;
export const AIM_SENS_MAX = 1.2;
export const AIM_SENS_DEFAULT = 0.65;

/** CONTRACT_MOBILE M8 ranges */
export const TOUCH_SENS_MIN = 0.3;
export const TOUCH_SENS_MAX = 3;
export const TOUCH_SCALE_MIN = 0.8;
export const TOUCH_SCALE_MAX = 1.3;
export const TOUCH_OPACITY_MIN = 0.35;
export const TOUCH_OPACITY_MAX = 1;

/** CONTRACT_FFA F1: the match mode (mirrors core/types.ts `MatchMode`) */
export type ProfileMode = 'teams' | 'ffa';
export const PROFILE_MODES: readonly ProfileMode[] = ['teams', 'ffa'];
/** CONTRACT_WASHOUT W4: the match rule (mirrors core/types.ts `MatchRule`) — TURF (paint, the default) or WASHOUT */
export type ProfileRule = 'turf' | 'washout';
export const PROFILE_RULES: readonly ProfileRule[] = ['turf', 'washout'];
/** FFA crews are 1..8 (teams.json → ffa) */
export const FFA_COLORS = 8;

export interface Profile {
  name: string;
  crew: TeamId;
  /** CONTRACT_FFA F3: TEAMS · 4 v 4 (default) or FREE-FOR-ALL */
  mode: ProfileMode;
  /** CONTRACT_WASHOUT W4: the RULE pick — 'turf' (default; an old save without it loads as turf) or 'washout' */
  rule: ProfileRule;
  /** CONTRACT_FFA F3: the human's FFA colour, 1..8 (default 1 = amber); bots take the rest */
  ffaColor: number;
  kit: string;
  /** a map id or 'random' */
  map: string;
  /** Pier 18 time of day (a lighting preset id): 'noon' | 'golden' */
  preset: string;
  skill: BotSkill;
}

/** audio README defaults (master 0.8, music 0.45, sfx 0.9) */
export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 0.8, music: 0.45, sfx: 0.9 };
export const SENS_MIN = 0.25;
export const SENS_MAX = 3;
export const NAME_MAX = 12;

const SETTINGS_KEY = 'dyefield.settings.v1';
const PROFILE_KEY = 'dyefield.profile.v1';

export function defaultBindings(): Bindings {
  const out = {} as Bindings;
  for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

/** the OS 'reduce motion' preference: the REDUCE MOTION default until the player sets it */
function osReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function defaultSettings(): Settings {
  return {
    bindings: defaultBindings(), sensitivity: 1, invertY: false, colorblind: false,
    volume: { ...DEFAULT_VOLUMES }, quality: 'auto', showFps: false, reduceMotion: osReducedMotion(),
    touchSens: 1, touchScale: 1, touchOpacity: 0.75, touchLeftHanded: false, aimAssist: true, haptics: true,
    aimSens: AIM_SENS_DEFAULT, aimToggle: false,
  };
}

export function defaultProfile(): Profile {
  return { name: '', crew: 1, mode: 'teams', rule: 'turf', ffaColor: 1, kit: 'mist-rasp', map: 'pier18', preset: 'noon', skill: DEFAULT_BOT_SKILL };
}

/** a display name: letters, digits, space, - _ . ' ; trimmed; ≤ NAME_MAX */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} _.'-]+/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('');
}

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const CODE_RE = /^(Key[A-Z]|Digit\d|Numpad[\w]+|F\d{1,2}|Mouse[0-4]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Tab|Enter|Escape|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Backspace|Insert|Delete|Home|End|PageUp|PageDown|IntlBackslash)$/;

const sameCodes = (v: unknown, want: readonly string[]): boolean =>
  Array.isArray(v) && v.length === want.length && v.every((c, i) => c === want[i]);

/**
 * CONTRACT_CONTROLS C1 migration (a save from before AIM existed has no `aim` key):
 *   * a saved `sub` that is EXACTLY the old default [E, RMB] becomes [E], and `aim` gets [RMB];
 *   * a player-customised `sub` is kept as it is, and `aim` then defaults to [RMB] only when no other action holds RMB
 *     (else AIM starts unbound — SETTINGS shows it, the player binds it).
 * A save that has an `aim` key (this build on) is taken as saved, like every other action.
 */
function sanitizeBindings(raw: unknown): Bindings {
  const out = defaultBindings();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const hasAim = Array.isArray(r.aim);
  for (const a of Object.keys(out) as Action[]) {
    const v = r[a];
    if (!Array.isArray(v)) continue;
    const codes = v.filter((c): c is string => typeof c === 'string' && CODE_RE.test(c)).slice(0, 3);
    out[a] = [...new Set(codes)];
  }
  if (!hasAim) {
    if (sameCodes(r.sub, OLD_DEFAULT_SUB)) out.sub = ['KeyE'];
    out.aim = [];                                   // decided below, once every other action has its codes
  }
  // a code may belong to one action only (a saved conflict from an old build: the first action keeps it)
  const seen = new Set<string>();
  for (const a of Object.keys(out) as Action[]) {
    out[a] = out[a].filter((c) => { if (seen.has(c)) return false; seen.add(c); return true; });
  }
  if (!hasAim) out.aim = seen.has('Mouse2') ? [] : ['Mouse2'];
  return out;
}

export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const vol = (r.volume && typeof r.volume === 'object' ? r.volume : {}) as Record<string, unknown>;
  return {
    bindings: sanitizeBindings(r.bindings),
    sensitivity: clamp(r.sensitivity, SENS_MIN, SENS_MAX, d.sensitivity),
    invertY: bool(r.invertY, d.invertY),
    colorblind: bool(r.colorblind, d.colorblind),
    volume: {
      master: clamp(vol.master, 0, 1, d.volume.master),
      music: clamp(vol.music, 0, 1, d.volume.music),
      sfx: clamp(vol.sfx, 0, 1, d.volume.sfx),
    },
    quality: isRenderQuality(r.quality) ? r.quality : d.quality,
    showFps: bool(r.showFps, d.showFps),
    reduceMotion: bool(r.reduceMotion, d.reduceMotion),
    // CONTRACT_MOBILE M8: an old save has none of these → the defaults (every older field loads unchanged)
    touchSens: clamp(r.touchSens, TOUCH_SENS_MIN, TOUCH_SENS_MAX, d.touchSens),
    touchScale: clamp(r.touchScale, TOUCH_SCALE_MIN, TOUCH_SCALE_MAX, d.touchScale),
    touchOpacity: clamp(r.touchOpacity, TOUCH_OPACITY_MIN, TOUCH_OPACITY_MAX, d.touchOpacity),
    touchLeftHanded: bool(r.touchLeftHanded, d.touchLeftHanded),
    aimAssist: bool(r.aimAssist, d.aimAssist),
    haptics: bool(r.haptics, d.haptics),
    // CONTRACT_CONTROLS C1: an old save has neither → the defaults (0.65, hold)
    aimSens: clamp(r.aimSens, AIM_SENS_MIN, AIM_SENS_MAX, d.aimSens),
    aimToggle: bool(r.aimToggle, d.aimToggle),
  };
}

export function sanitizeProfile(raw: unknown, kits: readonly string[], maps: readonly string[]): Profile {
  const d = defaultProfile();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const kit = typeof r.kit === 'string' && kits.includes(r.kit) ? r.kit : d.kit;
  const map = typeof r.map === 'string' && (r.map === 'random' || maps.includes(r.map)) ? r.map : d.map;
  return {
    name: cleanName(r.name),
    crew: r.crew === 2 ? 2 : 1,
    mode: r.mode === 'ffa' ? 'ffa' : 'teams',
    rule: r.rule === 'washout' ? 'washout' : 'turf',      // CONTRACT_WASHOUT W4: anything else (an old save) → turf
    ffaColor: typeof r.ffaColor === 'number' && Number.isInteger(r.ffaColor) && r.ffaColor >= 1 && r.ffaColor <= FFA_COLORS ? r.ffaColor : d.ffaColor,
    kit, map,
    preset: r.preset === 'golden' ? 'golden' : 'noon',
    skill: typeof r.skill === 'string' && (BOT_SKILL_IDS as readonly string[]).includes(r.skill) ? parseBotSkill(r.skill) : d.skill,
  };
}

function load(key: string): unknown {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function save(key: string, v: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

type Listener<T> = (value: Readonly<T>, keys: Array<keyof T>) => void;

/** A tiny observable object store: set(patch) → persist → notify with the changed top-level keys. */
class Store<T extends object> {
  protected value: T;
  private readonly listeners = new Set<Listener<T>>();
  private readonly key: string;
  private readonly clean: (raw: unknown) => T;
  /** false when localStorage refused the last write (private window / blocked storage) */
  persisted = true;

  constructor(key: string, clean: (raw: unknown) => T) {
    this.key = key;
    this.clean = clean;
    this.value = clean(load(key));
  }

  get(): Readonly<T> { return this.value; }

  /** merge a patch (top-level keys), sanitize, persist, notify the keys that changed */
  set(patch: Partial<T>): Array<keyof T> {
    const next = this.clean({ ...this.value, ...patch });
    const keys: Array<keyof T> = [];
    for (const k of Object.keys(next) as Array<keyof T>) {
      if (JSON.stringify(next[k]) !== JSON.stringify(this.value[k])) keys.push(k);
    }
    if (!keys.length) return keys;
    this.value = next;
    this.persisted = save(this.key, next);
    for (const fn of [...this.listeners]) {
      try { fn(this.value, keys); } catch (e) { console.error('[dyefield] settings listener', e); }
    }
    return keys;
  }

  /** subscribe → unsubscribe */
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

export class SettingsStore extends Store<Settings> {
  constructor() { super(SETTINGS_KEY, sanitizeSettings); }
  reset(): void { this.set(defaultSettings()); }
  resetBindings(): void { this.set({ bindings: defaultBindings() }); }
}

export class ProfileStore extends Store<Profile> {
  constructor(kits: readonly string[], maps: readonly string[]) {
    super(PROFILE_KEY, (raw) => sanitizeProfile(raw, kits, maps));
  }
}

export { BOT_SKILL_IDS };
