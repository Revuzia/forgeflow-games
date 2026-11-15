// BLOCKTOOTH — persisted settings + personal bests (CONTRACT.md §14).
//
// Every storage touch is wrapped in try/catch: sandboxed iframes (the portal), private
// windows, disabled storage and quota errors all throw — sometimes on the mere
// `window.localStorage` property read. A failure degrades to defaults / no-op, never a crash.
// Loaded values are sanitised field by field, so a corrupt or hand-edited blob (or an older
// schema) can never push NaN / out-of-range numbers into the audio graph or the renderer.

import type { Profile } from './types.ts';
import { sanitizeProfile } from '../meta/profile.ts';

export type Settings = {
  master: number;          // 0..1
  music: number;           // 0..1
  sfx: number;             // 0..1
  quality: 0 | 1 | 2;      // low / med / high
  screenShake: boolean;
  reduceFlashing: boolean;
  /** v2 (FEATURES_V2 §13.1): cinematic → 'reduced' variant; no camera punch on UPROAR / breach */
  reduceMotion: boolean;
  /** v2: opening — 0 = legacy freeze-frame slate · 1 = short cinematic · 2 = full cinematic */
  cinematic: 0 | 1 | 2;
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  quality: 2,
  screenShake: true,
  reduceFlashing: false,
  reduceMotion: false,
  cinematic: 2,
});

const SETTINGS_KEY = 'blocktooth.settings.v1';
const BEST_KEY = 'blocktooth.best.v1';
const PROFILE_KEY = 'blocktooth.profile.v1';

// ─────────────────────────────── storage access ───────────────────────────────

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** localStorage or null. The property read itself can throw (SecurityError in sandboxed iframes). */
function store(): StorageLike | null {
  try {
    const g = globalThis as unknown as { localStorage?: StorageLike };
    const s = g.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const s = store();
    if (!s) return null;
    const raw = s.getItem(key);
    if (raw === null || raw === '') return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;   // quota exceeded / storage disabled
  }
}

// ─────────────────────────────── sanitising ───────────────────────────────

function unit(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

function qualityOf(v: unknown, fallback: 0 | 1 | 2): 0 | 1 | 2 {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const q = Math.round(n);
  return q <= 0 ? 0 : q >= 2 ? 2 : 1;
}

/** Coerce anything (partial, corrupt, older schema) into a complete, in-range Settings. */
export function sanitizeSettings(v: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    master: unit(o.master, d.master),
    music: unit(o.music, d.music),
    sfx: unit(o.sfx, d.sfx),
    quality: qualityOf(o.quality, d.quality),
    screenShake: bool(o.screenShake, d.screenShake),
    reduceFlashing: bool(o.reduceFlashing, d.reduceFlashing),
    reduceMotion: bool(o.reduceMotion, d.reduceMotion),
    cinematic: qualityOf(o.cinematic, d.cinematic),     // same {0,1,2} rounding as quality
  };
}

// ─────────────────────────────── settings ───────────────────────────────

/** Saved settings merged over the defaults (defaults when storage is missing / blocked / corrupt). */
export function loadSettings(): Settings {
  return sanitizeSettings(readJson(SETTINGS_KEY));
}

/** Persist settings (sanitised first). Returns false when storage is unavailable — never throws. */
export function saveSettings(s: Settings): boolean {
  return writeJson(SETTINGS_KEY, sanitizeSettings(s));
}

// ─────────────────────────────── v2 profile (FEATURES_V2 §8.3) ───────────────────────────────
// Lane L5. Every read and write is wrapped (readJson / writeJson never throw). When storage is missing,
// blocked or full, the profile degrades to an IN-MEMORY copy for the session: a failed save keeps the
// profile here and loadProfile returns it (newer than whatever storage still holds) until a save succeeds.
// The blob is coerced field by field by meta/profile.ts sanitizeProfile on the way in AND out.

let memProfile: Profile | null = null;

/** The persistent goals / unlocks profile (key 'blocktooth.profile.v1'). Never throws. */
export function loadProfile(): Profile {
  try {
    if (memProfile) return sanitizeProfile(memProfile);
    return sanitizeProfile(readJson(PROFILE_KEY));
  } catch {
    return sanitizeProfile(null);
  }
}

/** Persist the profile (sanitised first). false = storage unavailable: kept in memory for the session. */
export function saveProfile(p: Profile): boolean {
  try {
    const clean = sanitizeProfile(p);
    if (writeJson(PROFILE_KEY, clean)) { memProfile = null; return true; }
    memProfile = clean;
    return false;
  } catch {
    return false;
  }
}

// ─────────────────────────────── personal bests ───────────────────────────────

/** Conventional key for a per-titan/biome best: e.g. bestKey('molo', 'grideast', 'tonnage'). */
export function bestKey(titan: string, biome: string, stat: string): string {
  return `${titan}.${biome}.${stat}`;
}

function sanitizeBest(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  }
  return out;
}

/** Every stored personal best ({} when storage is missing / blocked / corrupt). */
export function loadBest(): Record<string, number> {
  return sanitizeBest(readJson(BEST_KEY));
}

/**
 * Record personal bests. Two call shapes:
 *  * `saveBest(key, value, lowerIsBetter?)` — keeps the better of the stored and new value
 *    (higher wins unless `lowerIsBetter`, e.g. a clear time). Returns true when `value` is a
 *    NEW best (and it was stored).
 *  * `saveBest(record)` — merges a whole record, keeping the HIGHER value per key. Returns true
 *    when any key improved.
 * Non-finite values are ignored. Never throws.
 */
export function saveBest(key: string, value: number, lowerIsBetter?: boolean): boolean;
export function saveBest(record: Record<string, number>): boolean;
export function saveBest(a: string | Record<string, number>, value?: number, lowerIsBetter?: boolean): boolean {
  try {
    const cur = loadBest();
    let improved = false;
    if (typeof a === 'string') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      const prev = cur[a];
      const better = prev === undefined || (lowerIsBetter ? value < prev : value > prev);
      if (!better) return false;
      cur[a] = value;
      improved = true;
    } else if (a && typeof a === 'object') {
      for (const [k, v] of Object.entries(a)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const prev = cur[k];
        if (prev === undefined || v > prev) { cur[k] = v; improved = true; }
      }
      if (!improved) return false;
    } else {
      return false;
    }
    return writeJson(BEST_KEY, cur) && improved;
  } catch {
    return false;
  }
}
