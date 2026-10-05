// Settings: defaults, validation of anything that came out of storage, persistence that can never throw, and the migration of
// older stored blobs. Pure TypeScript (no DOM at import time) so it runs under plain node in the probes.
//
// Stored under SETTINGS_KEY as JSON. Versions:
//   (no `v`)  slice 1 (2026-10-02): volume, squishBoost, haptics, shake, gravity, quality.
//   v: 2      SHELL-2a: the same six plus the OPTIONAL round-2 fields (music, extraSquish, calm, skipAnimations, fastOpen, shortcuts).
// Migration is by absence: a round-2 field that is not in the blob means "the player never chose", and resolveSettings() supplies the
// default at use time (so Calm keeps following prefers-reduced-motion until the player sets it). A blob from a NEWER build (v > 2) is
// read for the fields this build knows, and its unknown keys are carried through every save so a rollback never eats them.
import type { Settings, QualityTier } from '../contracts.ts';
import { clamp } from './rng.ts';

export const SETTINGS_KEY = 'wobblehoard:v1:settings';
export const SETTINGS_VERSION = 2;

/** The slice of Web Storage we use. localStorage satisfies it; so does a Map-backed fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * localStorage, or null when the browser refuses even to hand it over (sandboxed iframe, blocked site data).
 * The returned object is a guard: every method swallows exceptions (private mode and quota errors throw on write).
 */
export function safeLocalStorage(): StorageLike | null {
  let raw: Storage;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    raw = window.localStorage;
  } catch { return null; }
  return guardStorage(raw);
}

/** Wrap any storage so that no call can throw. A failed read is `null`; a failed write is silently dropped. */
export function guardStorage(raw: StorageLike): StorageLike {
  return {
    getItem(k) { try { return raw.getItem(k); } catch { return null; } },
    setItem(k, v) { try { raw.setItem(k, v); } catch { /* quota / private mode: keep playing, just don't persist */ } },
    removeItem(k) { try { raw.removeItem(k); } catch { /* ignore */ } },
  };
}

/** A tiny in-memory storage (tests, and the fallback when localStorage is unavailable). */
export function memoryStorage(seed: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

export interface SettingsEnv {
  /** Real haptics: navigator.vibrate exists AND the device has a touch screen (desktop Chromium exposes a vibrate() that does nothing). */
  vibrate: boolean;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
}

export function detectEnv(): SettingsEnv {
  let vibrate = false;
  let reducedMotion = false;
  try {
    const fn = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    let touch = false;
    try { touch = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints ?? 0) > 0; } catch { /* ignore */ }
    vibrate = fn && touch;
  } catch { /* ignore */ }
  try { reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  return { vibrate, reducedMotion };
}

export const QUALITY_VALUES: ReadonlyArray<QualityTier | 'auto'> = ['auto', 'low', 'med', 'high'];

/** The six slice-1 fields. The optional round-2 fields are deliberately absent here: see resolveSettings. */
export function defaultSettings(env: SettingsEnv = detectEnv()): Settings {
  return {
    volume: 0.8,
    squishBoost: 0.4,
    haptics: env.vibrate,
    shake: env.reducedMotion ? 0 : 0.35,
    gravity: true,
    quality: 'auto',
  };
}

/** Every field present: what the shell actually applies. */
export type ResolvedSettings = Required<Settings>;

/** Defaults of the optional round-2 fields (SOUND.md round 3: music 0.45; DESIGN 6.6: calm follows reduced motion). */
export function optionalDefaults(env: SettingsEnv): Pick<ResolvedSettings, 'music' | 'extraSquish' | 'calm' | 'skipAnimations' | 'fastOpen' | 'shortcuts'> {
  return { music: 0.45, extraSquish: false, calm: env.reducedMotion, skipAnimations: false, fastOpen: false, shortcuts: true };
}

/** Fill the optional fields the player never chose with their defaults. Never throws. */
export function resolveSettings(s: Settings, env: SettingsEnv): ResolvedSettings {
  const d = optionalDefaults(env);
  return {
    volume: s.volume, squishBoost: s.squishBoost, haptics: s.haptics, shake: s.shake, gravity: s.gravity, quality: s.quality,
    music: s.music ?? d.music, extraSquish: s.extraSquish ?? d.extraSquish, calm: s.calm ?? d.calm,
    skipAnimations: s.skipAnimations ?? d.skipAnimations, fastOpen: s.fastOpen ?? d.fastOpen, shortcuts: s.shortcuts ?? d.shortcuts,
  };
}

export const SETTING_KEYS = ['volume', 'squishBoost', 'haptics', 'shake', 'gravity', 'quality', 'music', 'extraSquish', 'calm', 'skipAnimations', 'fastOpen', 'shortcuts'] as const;
const OPTIONAL_UNITS = ['music'] as const;
const OPTIONAL_BOOLS = ['extraSquish', 'calm', 'skipAnimations', 'fastOpen', 'shortcuts'] as const;

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : fallback;

/**
 * Turn anything (parsed JSON from storage, a URL param, a hostile paste) into a valid Settings.
 * Each field that is missing, mistyped or out of range falls back to `base` (clamped numbers are kept clamped); an optional field that
 * is invalid AND absent from `base` stays absent. Unknown keys are dropped. Never throws.
 */
export function sanitizeSettings(raw: unknown, base: Settings): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Settings = {
    volume: unit(o.volume, base.volume),
    squishBoost: unit(o.squishBoost, base.squishBoost),
    haptics: typeof o.haptics === 'boolean' ? o.haptics : base.haptics,
    shake: unit(o.shake, base.shake),
    gravity: typeof o.gravity === 'boolean' ? o.gravity : base.gravity,
    quality: typeof o.quality === 'string' && (QUALITY_VALUES as readonly string[]).includes(o.quality)
      ? (o.quality as Settings['quality']) : base.quality,
  };
  for (const k of OPTIONAL_UNITS) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, 0, 1);
    else if (typeof base[k] === 'number') out[k] = base[k];
  }
  for (const k of OPTIONAL_BOOLS) {
    const v = o[k];
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof base[k] === 'boolean') out[k] = base[k];
  }
  return out;
}

/** Validate one value for one key (used by the debug hook and by UI controls). Returns the clamped/valid value. */
export function sanitizeSetting<K extends keyof Settings>(key: K, value: unknown, base: Settings): Settings[K] {
  return sanitizeSettings({ [key]: value }, base)[key];
}

/** Parse a stored text into settings (null when it is not a settings blob). Exported for the multi-tab 'storage' event. */
export function parseSettingsText(text: string | null, env: SettingsEnv): Settings | null {
  if (!text) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return sanitizeSettings(raw, defaultSettings(env));
  } catch { return null; }
}

/** Read the stored settings. Missing, corrupt or unreadable storage yields the defaults; a slice-1 blob (no `v`) migrates as is. */
export function loadSettings(storage: StorageLike | null, env: SettingsEnv = detectEnv()): Settings {
  const base = defaultSettings(env);
  if (!storage) return base;
  let text: string | null = null;
  try { text = storage.getItem(SETTINGS_KEY); } catch { return base; }
  return parseSettingsText(text, env) ?? base;
}

/** Persist (format v2: the six slice fields always, an optional field only once the player chose it). Returns false when storage is
 *  missing or refused the write (the caller may ignore it). Unknown keys of a blob written by a NEWER build are kept. */
export function saveSettings(storage: StorageLike | null, s: Settings): boolean {
  if (!storage) return false;
  try {
    let carry: Record<string, unknown> = {};
    try {
      const prev: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
      if (prev && typeof prev === 'object' && !Array.isArray(prev) && typeof (prev as { v?: unknown }).v === 'number' && (prev as { v: number }).v > SETTINGS_VERSION) {
        carry = { ...(prev as Record<string, unknown>) };
      }
    } catch { /* unreadable: nothing to carry */ }
    const out: Record<string, unknown> = { ...carry, v: Math.max(SETTINGS_VERSION, typeof carry.v === 'number' ? carry.v : 0),
      volume: s.volume, squishBoost: s.squishBoost, haptics: s.haptics, shake: s.shake, gravity: s.gravity, quality: s.quality };
    for (const k of OPTIONAL_UNITS) if (typeof s[k] === 'number') out[k] = s[k];
    for (const k of OPTIONAL_BOOLS) if (typeof s[k] === 'boolean') out[k] = s[k];
    storage.setItem(SETTINGS_KEY, JSON.stringify(out));
    // a guarded storage swallows write errors, so verify
    return storage.getItem(SETTINGS_KEY) !== null;
  } catch { return false; }
}
