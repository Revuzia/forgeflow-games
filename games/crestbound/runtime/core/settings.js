/**
 * CRESTBOUND — runtime/core/settings.js
 * ---------------------------------------------------------------------------
 * Player-facing settings + the quality ladder. CONTRACT §2.
 *
 * Two responsibilities:
 *   1. QUALITY — four presets that are genuinely different, not cosmetic. Each
 *      one is a budget the renderer, the post chain, the particle system, the
 *      terrain grass and the decorator all read from.
 *   2. Settings — a tiny validated, persisted, observable store.
 *
 * Ported from Ascendant. What changed for a third-person analog platformer:
 *   - no `fov` setting (the follow camera owns FOV via TUNE.cam), no
 *     `showViewmodel`, no `motionBlurDip`, no single `sens`;
 *   - camera fields: camSensX / camSensY / invertX / invertY / camMode;
 *   - accessibility: reduceMotion (camera shake, screen pulses, speed lines);
 *   - gamepadVibrate;
 *   - QUALITY gains `grass` (instance-count scale for terrain.js) and the
 *     shadow map ladder is 2048 / 1024 / 512 (low keeps a small map instead of
 *     none: a hero with NO cast shadow reads as floating, which is the one
 *     thing an analog platformer can never afford).
 *
 * Import is side-effect free: localStorage is not touched until the first
 * get()/set()/quality() call, so the harness can import this in node.
 */

import { clamp, clamp01 } from './util.js';

/* ===========================================================================
 * Quality ladder
 * ======================================================================== */

/**
 * Preset fields
 *   dpr            device-pixel-ratio CEILING. The renderer uses
 *                  min(devicePixelRatio, dpr) and never exceeds 1.5.
 *   shadowMap      shadow map resolution in texels (2048 / 1024 / 512). Never 0:
 *                  see the header — the hero's contact shadow is a readability
 *                  feature, not decoration.
 *   bloom          a bloom pass in the chain
 *   bloomScale     fraction of the frame the bloom mip chain is built from
 *                  (UnrealBloomPass already halves internally: 1 = half-res
 *                  first mip, 0.5 = quarter-res).
 *   bloomClamp     ceiling on what the bloom bright-pass may read (post.js
 *                  takes the min of this and its own default).
 *   aa             'smaa' | 'fxaa' | 'none'. SMAA is three full-screen draws
 *                  plus two full-size targets; FXAA is one draw, no targets.
 *   smaa           legacy mirror of `aa === 'smaa'`.
 *   ssao           declared budget for the ultra tier; post.js renders without
 *                  it when the vendored addons carry no AO pass.
 *   particles      0..1 multiplier on every particle budget and spawn rate
 *   decor          0..1 multiplier on instanced scatter density / draw distance
 *   shadowDistance metres of shadow coverage the following frustum spans
 *   grass          0..1 scale on the terrain grass instance count
 *                  (terrain.js: 30k blades at 1.0, ~8k at 0.27)
 *   anisotropy     texture anisotropy cap (materials.js)
 *   maxLights      soft budget on simultaneous dynamic point lights (themes.js)
 */
export const QUALITY = {
  low: {
    id: 'low', label: 'LOW',
    dpr: 1, shadowMap: 512, bloom: true, bloomScale: 0.25, bloomClamp: 12,
    aa: 'fxaa', smaa: false, ssao: false,
    particles: 0.35, decor: 0.3, shadowDistance: 28, grass: 0.27,
    anisotropy: 1, maxLights: 2,
    shadowFilter: 'basic', shadowCasterRadius: 3.0, renderScale: 0.60,
  },
  medium: {
    id: 'medium', label: 'MEDIUM',
    dpr: 1.25, shadowMap: 1024, bloom: true, bloomScale: 0.5, bloomClamp: 12,
    aa: 'fxaa', smaa: false, ssao: false,
    particles: 0.6, decor: 0.6, shadowDistance: 45, grass: 0.55,
    anisotropy: 2, maxLights: 3,
    shadowFilter: 'pcf', shadowCasterRadius: 2.0, renderScale: 0.72,
  },
  high: {
    id: 'high', label: 'HIGH',
    dpr: 1.5, shadowMap: 2048, bloom: true, bloomScale: 0.5, bloomClamp: 16,
    aa: 'fxaa', smaa: false, ssao: false,
    particles: 1, decor: 1, shadowDistance: 70, grass: 1,
    anisotropy: 2, maxLights: 4,
    shadowFilter: 'pcf', shadowCasterRadius: 1.5, renderScale: 0.85,
  },
  ultra: {
    id: 'ultra', label: 'ULTRA',
    dpr: 1.5, shadowMap: 2048, bloom: true, bloomScale: 1, bloomClamp: 16,
    aa: 'smaa', smaa: true, ssao: true,
    particles: 1, decor: 1, shadowDistance: 110, grass: 1,
    anisotropy: 8, maxLights: 8,
    shadowFilter: 'pcfsoft', shadowCasterRadius: 0.9, renderScale: 1.00,
  },
};

/**
 * Fields added 2026-09-02 by the perf pass, all measured with
 * `_harness/frameprobe.py` on the reference Intel UHD at 1920x1080:
 *
 *   renderScale         CONTRACT hard rule 4. The fraction of CSS pixels the
 *                       drawing buffer is allocated at; engine.js multiplies it
 *                       into the device pixel ratio, so the canvas keeps its CSS
 *                       size and the compositor upscales on presentation. The
 *                       frame is GPU FILL-bound (T = C + F*pixels, F ~ 78-91 %),
 *                       so this is the only lever with the range to reach the
 *                       fps target on the reference Intel UHD. A DYNAMIC
 *                       controller in engine.js moves within +/-0.15 of the
 *                       tier value; see Engine.setRenderScale.
 *                       (A depth PREPASS lived here for one pass and was
 *                       reverted: +67k tris per course, both courses over the
 *                       450k budget, and the frame stayed fill-bound.)
 *   shadowFilter        'basic' (1 tap) | 'pcf' (9 taps) | 'pcfsoft' (9 lerped
 *                       taps, ~4x the fetches of 'pcf'). PCFSoft measured
 *                       -5.29 ms against a single tap, which is real money on
 *                       a frame that has to reach 18 ms.
 *   shadowCasterRadius  world bounding radius below which a mesh stops casting
 *                       a shadow. course.js already applied a flat 1.5 m rule; this makes it a tier
 *                       knob, and HIGH keeps the 1.5 m it had, so HIGH's shadows
 *                       are unchanged. The shadow pass draws 100 meshes /
 *                       186k triangles on the Keep; a 0.7 m prop contributes a
 *                       shadow nobody can see and costs a draw call in a
 *                       260-draw budget.
 *
 * `bloomScale` at HIGH dropped 1 -> 0.5 (measured -4.6 ms), `anisotropy`
 * 4 -> 2 (-3.7 ms) and `maxLights` 6 -> 4 (-9.4 ms for all six). No feature is
 * removed at any tier: ULTRA keeps full-resolution bloom, 8x anisotropy,
 * PCFSoft shadows and every caster.
 */

/** Ordered worst -> best, for the settings cycler and for auto-downgrade. */
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

/** Hard ceiling on pixel ratio regardless of preset (see feedback_forgeflow_games_fps). */
export const DPR_CEILING = 1.5;

/** Legal camera modes. 'follow' auto-yaws behind the hero; 'free' never auto-yaws. */
export const CAM_MODES = ['follow', 'free'];

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

/**
 * Honour the OS-level reduced-motion preference on a first run only (a saved
 * explicit choice always wins).
 * @returns {boolean}
 */
function detectReduceMotion() {
  try {
    if (typeof matchMedia !== 'function') return false;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    return !!(mq && mq.matches);
  } catch (e) {
    return false;
  }
}

/* ===========================================================================
 * Defaults + validation
 * ======================================================================== */

const STORE_KEY = 'crestbound.settings';

/**
 * Every persisted field, with the exact defaults named in the contract.
 * `quality` is filled in at first use by detectQuality().
 * @type {{quality:string, camSensX:number, camSensY:number, invertX:boolean,
 *         invertY:boolean, camMode:string, master:number, music:number,
 *         sfx:number, showTimer:boolean, hudScale:number,
 *         gamepadVibrate:boolean, reduceMotion:boolean}}
 */
export const DEFAULTS = {
  quality: 'high',
  camSensX: 1.0,
  camSensY: 1.0,
  invertX: false,
  invertY: false,
  camMode: 'follow',
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  showTimer: true,
  hudScale: 1,
  gamepadVibrate: true,
  reduceMotion: false,
};

/** Legal ranges, surfaced so the settings menu can build its own sliders. */
export const RANGES = {
  camSensX: { min: 0.15, max: 4.0, step: 0.05 },
  camSensY: { min: 0.15, max: 4.0, step: 0.05 },
  master: { min: 0, max: 1, step: 0.05 },
  music: { min: 0, max: 1, step: 0.05 },
  sfx: { min: 0, max: 1, step: 0.05 },
  hudScale: { min: 0.8, max: 1.4, step: 0.05 },
};

const VALIDATORS = {
  quality: (v) => (Object.prototype.hasOwnProperty.call(QUALITY, v) ? v : null),
  camSensX: (v) => numField(v, RANGES.camSensX),
  camSensY: (v) => numField(v, RANGES.camSensY),
  invertX: (v) => !!v,
  invertY: (v) => !!v,
  camMode: (v) => (CAM_MODES.indexOf(v) !== -1 ? v : null),
  master: (v) => volField(v),
  music: (v) => volField(v),
  sfx: (v) => volField(v),
  showTimer: (v) => !!v,
  hudScale: (v) => numField(v, RANGES.hudScale),
  gamepadVibrate: (v) => !!v,
  reduceMotion: (v) => !!v,
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
  s.reduceMotion = detectReduceMotion();

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
  /** localStorage key, exposed for tooling/tests. */
  KEY: STORE_KEY,

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
   * Restore every field to its default (re-running quality auto-detect and the
   * reduced-motion media query) and broadcast. Used by the "reset settings"
   * button in the options menu.
   * @returns {object}
   */
  reset() {
    const s = ensure();
    _changed.length = 0;
    const keys = Object.keys(DEFAULTS);
    const auto = detectQuality();
    const rm = detectReduceMotion();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = k === 'quality' ? auto : (k === 'reduceMotion' ? rm : DEFAULTS[k]);
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

export default Settings;
