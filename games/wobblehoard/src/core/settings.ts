// Settings: defaults, validation of anything that came out of storage, and persistence that can never throw.
// Pure TypeScript (no DOM at import time) so it runs under plain node in the probes.
import type { Settings, QualityTier } from '../contracts.ts';
import { clamp } from './rng.ts';

export const SETTINGS_KEY = 'wobblehoard:v1:settings';

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
  /** navigator.vibrate exists (false on iOS Safari and desktop). */
  vibrate: boolean;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
}

export function detectEnv(): SettingsEnv {
  let vibrate = false;
  let reducedMotion = false;
  try { vibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; } catch { /* ignore */ }
  try { reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  return { vibrate, reducedMotion };
}

export const QUALITY_VALUES: ReadonlyArray<QualityTier | 'auto'> = ['auto', 'low', 'med', 'high'];

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

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : fallback;

/**
 * Turn anything (parsed JSON from storage, a URL param, a hostile paste) into a valid Settings.
 * Each field that is missing, mistyped or out of range falls back to `base` (clamped numbers are kept clamped).
 * Unknown keys are dropped. Never throws.
 */
export function sanitizeSettings(raw: unknown, base: Settings): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    volume: unit(o.volume, base.volume),
    squishBoost: unit(o.squishBoost, base.squishBoost),
    haptics: typeof o.haptics === 'boolean' ? o.haptics : base.haptics,
    shake: unit(o.shake, base.shake),
    gravity: typeof o.gravity === 'boolean' ? o.gravity : base.gravity,
    quality: typeof o.quality === 'string' && (QUALITY_VALUES as readonly string[]).includes(o.quality)
      ? (o.quality as Settings['quality']) : base.quality,
  };
}

/** Validate one value for one key (used by the debug hook and by UI controls). Returns the clamped/valid value. */
export function sanitizeSetting<K extends keyof Settings>(key: K, value: unknown, base: Settings): Settings[K] {
  return sanitizeSettings({ [key]: value }, base)[key];
}

/** Read the stored settings. Missing, corrupt or unreadable storage yields the defaults. */
export function loadSettings(storage: StorageLike | null, env: SettingsEnv = detectEnv()): Settings {
  const base = defaultSettings(env);
  if (!storage) return base;
  let text: string | null = null;
  try { text = storage.getItem(SETTINGS_KEY); } catch { return base; }
  if (!text) return base;
  try { return sanitizeSettings(JSON.parse(text), base); } catch { return base; }
}

/** Persist. Returns false when storage is missing or refused the write (the caller may ignore it). */
export function saveSettings(storage: StorageLike | null, s: Settings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      volume: s.volume, squishBoost: s.squishBoost, haptics: s.haptics, shake: s.shake, gravity: s.gravity, quality: s.quality,
    }));
    // a guarded storage swallows write errors, so verify
    return storage.getItem(SETTINGS_KEY) !== null;
  } catch { return false; }
}
