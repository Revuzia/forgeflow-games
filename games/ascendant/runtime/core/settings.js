/**
 * ASCENDANT — runtime/core/settings.js
 * ---------------------------------------------------------------------------
 * Player-facing settings + the quality ladder.
 *
 * Two responsibilities:
 *   1. QUALITY — four presets that are genuinely different, not cosmetic. Each
 *      one is a budget the renderer, the post chain, the particle system and
 *      the decorator all read from.
 *   2. Settings — a tiny validated, persisted, observable store.
 *
 * Import is side-effect free: localStorage is not touched until the first
 * get()/set()/quality() call, so the harness can import this in node.
 */

import { clamp, clamp01 } from './util.js';
import { TUNE } from './tuning.js';

/* ===========================================================================
 * Quality ladder
 * ======================================================================== */

/**
 * Preset fields
 *   dpr            device-pixel-ratio CEILING. The renderer uses
 *                  min(devicePixelRatio, dpr) and never exceeds 1.5.
 *   shadowMap      shadow map resolution in texels, 0 disables shadows entirely
 *   bloom          a bloom pass in the chain
 *   bloomScale     fraction of the frame the bloom mip chain is built from.
 *                  NOTE UnrealBloomPass already halves internally, so 1 here
 *                  still means its first mip is HALF the frame width, and 0.5
 *                  means a quarter.
 *                  high/ultra deliberately keep 1. Half-resolution bloom is
 *                  normally free-looking, but it is NOT free on this content:
 *                  the HDR scene buffer currently contains Infinity and values
 *                  up to 65504, and a coarser mip smears those over more of the
 *                  screen. Measured full-frame on neon-1, share of pixels at
 *                  luma 1.0:  full-res 80.6 %  ->  half-res 100 %. The look is
 *                  not this preset's to change, so the cheaper chain is only
 *                  used on the tiers that are allowed to trade quality.
 *   bloomClamp     ceiling on what the bloom bright-pass may read. 65504 (the
 *                  half-float maximum) is inert on finite pixels and only
 *                  removes NaN/Infinity. low/medium lower it to 12, which is
 *                  what makes their cheaper bloom look acceptable. Once the
 *                  source of the 65504s is fixed, 12-24 is safe everywhere and
 *                  high/ultra can drop to bloomScale 0.5 for free.
 *   aa             'smaa' | 'fxaa' | 'none'. SMAA is three full-screen draws
 *                  plus two full-size render targets it owns; FXAA is one draw
 *                  and no targets. Bloom is never switched off to save time —
 *                  the glow on emissive trim is load-bearing for the look, so
 *                  the low tiers make it CHEAPER rather than absent.
 *   smaa           legacy mirror of `aa === 'smaa'`, kept so anything still
 *                  reading the old boolean sees the truth
 *   ssao           reserved for the ultra tier (see note below)
 *   particles      0..1 multiplier on every particle budget and spawn rate
 *   decor          0..1 multiplier on instanced scatter density / draw distance
 *   shadowDistance metres of shadow coverage for the key light's ortho frustum
 *
 * The three extra fields below are additive (nothing in the contract names
 * them, so no other module is required to read them) and exist so that "low"
 * is a real 60 fps-on-an-Atom mode rather than the same frame with fewer
 * sparks:
 *   anisotropy     texture anisotropy cap (materials.js)
 *   maxLights      soft budget on simultaneous dynamic point lights (themes.js)
 *
 * SSAO note: three ships no SSAO pass in the addon set vendored for this game,
 * so `ssao:true` on ultra is carried as a declared budget only — the post chain
 * reads it, finds no SSAO pass available, and renders without it. The flag is
 * kept because the contract names it and because ultra's other costs (full
 * shadow distance, 110 m) are already tuned around it.
 */
export const QUALITY = {
  low: {
    id: 'low', label: 'LOW',
    dpr: 1, shadowMap: 0, bloom: true, bloomScale: 0.25, bloomClamp: 12,
    aa: 'fxaa', smaa: false, ssao: false,
    particles: 0.35, decor: 0.3, shadowDistance: 0,
    anisotropy: 1, maxLights: 2,
  },
  medium: {
    id: 'medium', label: 'MEDIUM',
    dpr: 1.25, shadowMap: 1024, bloom: true, bloomScale: 0.5, bloomClamp: 12,
    aa: 'fxaa', smaa: false, ssao: false,
    particles: 0.6, decor: 0.6, shadowDistance: 45,
    anisotropy: 2, maxLights: 4,
  },
  high: {
    id: 'high', label: 'HIGH',
    dpr: 1.5, shadowMap: 2048, bloom: true, bloomScale: 1, bloomClamp: 65504,
    aa: 'fxaa', smaa: false, ssao: false,
    particles: 1, decor: 1, shadowDistance: 70,
    anisotropy: 4, maxLights: 6,
  },
  ultra: {
    id: 'ultra', label: 'ULTRA',
    dpr: 1.5, shadowMap: 2048, bloom: true, bloomScale: 1, bloomClamp: 65504,
    aa: 'smaa', smaa: true, ssao: true,
    particles: 1, decor: 1, shadowDistance: 110,
    anisotropy: 8, maxLights: 8,
  },
};

/** Ordered worst -> best, for the settings cycler and for auto-downgrade. */
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

/** Hard ceiling on pixel ratio regardless of preset (see feedback_forgeflow_games_fps). */
export const DPR_CEILING = 1.5;

/* ===========================================================================
 * Auto-detect
 * ======================================================================== */

/**
 * Pick a sensible starting preset from what the browser will tell us.
 *
 * Deliberately conservative, and it never auto-selects `ultra` — ultra is an
 * opt-in "my machine is a desk heater" tier. A first-run player getting a
 * smooth 60 is worth far more than a first-run player getting prettier stutter.
 *
 * @returns {'low'|'medium'|'high'|'ultra'}
 */
export function detectQuality() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav) return 'high';                       // headless harness

    const cores = Number(nav.hardwareConcurrency) || 4;
    const mem = Number(nav.deviceMemory) || 0;     // Chromium only, GB
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const ua = String(nav.userAgent || '');
    const touch = Number(nav.maxTouchPoints) || 0;

    const isMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua) ||
      (touch > 1 && /Macintosh/.test(ua) === false && /Windows NT/.test(ua) === false);

    let idx;                                        // index into QUALITY_ORDER
    if (isMobile) {
      idx = cores >= 8 ? 1 : 0;                     // medium / low
    } else if (cores >= 8) {
      idx = 2;                                      // high
    } else if (cores >= 4) {
      idx = 1;                                      // medium
    } else {
      idx = 0;                                      // low
    }

    // A 2x display quadruples the pixels. On a modest CPU that is the single
    // biggest reason a "high" machine misses 60.
    if (dpr >= 2 && cores < 8) idx--;
    // Reported low memory is a reliable signal for an integrated part.
    if (mem > 0 && mem <= 4) idx--;
    // A very wide core count with plenty of RAM earns the top non-ultra tier.
    if (cores >= 12 && (mem === 0 || mem >= 8) && !isMobile) idx = Math.max(idx, 2);

    return QUALITY_ORDER[clamp(idx, 0, 2)];
  } catch (e) {
    return 'medium';
  }
}

/* ===========================================================================
 * Defaults + validation
 * ======================================================================== */

const STORE_KEY = 'ascendant.settings';

/**
 * Every persisted field, with the exact defaults named in the contract.
 * `quality` is filled in at first use by detectQuality().
 * @type {{quality:string, sens:number, fov:number, invertY:boolean, master:number,
 *         music:number, sfx:number, showTimer:boolean, showViewmodel:boolean,
 *         motionBlurDip:boolean, hudScale:number}}
 */
export const DEFAULTS = {
  quality: 'high',
  sens: 1.0,
  fov: TUNE.fovBase,          // 82
  invertY: false,
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  showTimer: true,
  showViewmodel: true,
  motionBlurDip: true,
  hudScale: 1,
};

/** Legal ranges, surfaced so the settings menu can build its own sliders. */
export const RANGES = {
  sens: { min: 0.15, max: 4.0, step: 0.05 },
  fov: { min: 65, max: 110, step: 1 },
  master: { min: 0, max: 1, step: 0.05 },
  music: { min: 0, max: 1, step: 0.05 },
  sfx: { min: 0, max: 1, step: 0.05 },
  hudScale: { min: 0.8, max: 1.4, step: 0.05 },
};

const VALIDATORS = {
  quality: (v) => (Object.prototype.hasOwnProperty.call(QUALITY, v) ? v : null),
  sens: (v) => numField(v, RANGES.sens),
  fov: (v) => numField(v, RANGES.fov),
  invertY: (v) => !!v,
  master: (v) => volField(v),
  music: (v) => volField(v),
  sfx: (v) => volField(v),
  showTimer: (v) => !!v,
  showViewmodel: (v) => !!v,
  motionBlurDip: (v) => !!v,
  hudScale: (v) => numField(v, RANGES.hudScale),
};

function numField(v, range) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return clamp(n, range.min, range.max);
}

function volField(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return clamp01(n);
}

/* ===========================================================================
 * The store
 * ======================================================================== */

/** @type {object|null} */
let _state = null;
/** @type {Function[]} */
const _subs = [];
/** reusable array handed to subscribers so a settings change allocates nothing */
const _changed = [];
let _storageOk = true;

function storage() {
  if (!_storageOk) return null;
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) { _storageOk = false; return null; }
    return localStorage;
  } catch (e) {
    _storageOk = false;                      // private mode / blocked cookies
    return null;
  }
}

function ensure() {
  if (_state !== null) return _state;

  const s = {};
  const keys = Object.keys(DEFAULTS);
  for (let i = 0; i < keys.length; i++) s[keys[i]] = DEFAULTS[keys[i]];
  s.quality = detectQuality();

  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (!Object.prototype.hasOwnProperty.call(saved, k)) continue;
            const ok = VALIDATORS[k](saved[k]);
            if (ok !== null) s[k] = ok;
          }
        }
      }
    } catch (e) {
      // Corrupt blob: fall through with defaults and overwrite on next set().
      console.warn('[Settings] could not read saved settings, using defaults:', e && e.message);
    }
  }

  _state = s;
  return _state;
}

function persist() {
  const store = storage();
  if (!store || _state === null) return;
  try {
    store.setItem(STORE_KEY, JSON.stringify(_state));
  } catch (e) {
    _storageOk = false;                      // quota / privacy; stop retrying
  }
}

function notify() {
  if (_subs.length === 0) return;
  for (let i = 0; i < _subs.length; i++) {
    const fn = _subs[i];
    if (typeof fn !== 'function') continue;
    try {
      fn(_state, _changed);
    } catch (e) {
      console.error('[Settings] subscriber threw:', e);
    }
  }
}

export const Settings = {
  /**
   * The LIVE settings object. Read freely — including per frame, it allocates
   * nothing. Do NOT mutate it: writes must go through `set()` so they are
   * validated, persisted and broadcast.
   * @returns {object}
   */
  get() {
    return ensure();
  },

  /**
   * Apply a patch. Unknown keys are ignored, out-of-range values are clamped,
   * wrong types are dropped. Subscribers fire once, with the list of keys that
   * actually changed — nothing fires if the patch was a no-op.
   *
   * @param {object} patch
   * @returns {object} the live settings object
   */
  set(patch) {
    const s = ensure();
    if (!patch || typeof patch !== 'object') return s;

    _changed.length = 0;
    const keys = Object.keys(patch);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!Object.prototype.hasOwnProperty.call(VALIDATORS, k)) continue;
      const v = VALIDATORS[k](patch[k]);
      if (v === null || v === s[k]) continue;
      s[k] = v;
      _changed.push(k);
    }

    if (_changed.length === 0) return s;
    persist();
    notify();
    return s;
  },

  /**
   * The active quality preset object. Always a valid preset even if the stored
   * value is nonsense.
   * @returns {object} one of the QUALITY entries
   */
  quality() {
    const s = ensure();
    return QUALITY[s.quality] || QUALITY.high;
  },

  /** @returns {string} the active preset id */
  qualityId() {
    return ensure().quality;
  },

  /**
   * Step the quality ladder. Used by the settings menu and by the automatic
   * downgrade prompt when the engine measures a sustained sub-45 fps.
   * @param {number} delta -1 or +1
   * @returns {string} the new preset id
   */
  stepQuality(delta) {
    const s = ensure();
    const i = QUALITY_ORDER.indexOf(s.quality);
    const next = QUALITY_ORDER[clamp((i < 0 ? 2 : i) + (delta | 0), 0, QUALITY_ORDER.length - 1)];
    this.set({ quality: next });
    return next;
  },

  /**
   * The pixel ratio the renderer should actually use.
   * @param {number} [deviceRatio] override, defaults to window.devicePixelRatio
   * @returns {number}
   */
  pixelRatio(deviceRatio) {
    const q = this.quality();
    const dev = isFinite(deviceRatio) && deviceRatio > 0
      ? deviceRatio
      : (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
    return Math.min(dev, q.dpr, DPR_CEILING);
  },

  /**
   * Subscribe to changes. The callback receives (settings, changedKeys) where
   * `changedKeys` is a SHARED array valid only for the duration of the call —
   * copy it if you need to keep it.
   * @param {(s:object, changed:string[]) => void} fn
   * @returns {Function} fn
   */
  on(fn) {
    if (typeof fn === 'function' && _subs.indexOf(fn) === -1) _subs.push(fn);
    return fn;
  },

  /** @param {Function} fn */
  off(fn) {
    const i = _subs.indexOf(fn);
    if (i !== -1) _subs.splice(i, 1);
  },

  /**
   * Restore every field to its default (re-running quality auto-detect) and
   * broadcast. Used by the "reset settings" button in the options menu.
   * @returns {object}
   */
  reset() {
    const s = ensure();
    _changed.length = 0;
    const keys = Object.keys(DEFAULTS);
    const auto = detectQuality();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = k === 'quality' ? auto : DEFAULTS[k];
      if (s[k] !== v) { s[k] = v; _changed.push(k); }
    }
    persist();
    if (_changed.length) notify();
    return s;
  },

  /**
   * Wipe the persisted blob (used by the "erase all progress" flow, alongside
   * Save.reset()). The in-memory state is reset too.
   */
  purge() {
    const store = storage();
    if (store) { try { store.removeItem(STORE_KEY); } catch (e) { /* ignore */ } }
    _state = null;
    ensure();
    _changed.length = 0;
    notify();
  },

  /** @returns {object} a detached copy, safe to hand to JSON / a debug panel */
  snapshot() {
    const s = ensure();
    const out = {};
    const keys = Object.keys(s);
    for (let i = 0; i < keys.length; i++) out[keys[i]] = s[keys[i]];
    return out;
  },
};
