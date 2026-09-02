/**
 * CRESTBOUND — runtime/core/util.js
 * ---------------------------------------------------------------------------
 * Small, hot, dependency-free helpers. Deliberately contains NO three.js
 * import: everything here must be usable from the headless harness under plain
 * node with no WebGL context.
 *
 * Everything in this file is allocation-free on the hot path. Functions that
 * do allocate say so in their doc comment.
 */

/* ===========================================================================
 * Constants
 * ======================================================================== */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI * 0.5;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const EPS = 1e-6;

/* ===========================================================================
 * Scalar maths
 * ======================================================================== */

/**
 * Clamp `v` into [a, b]. NaN-safe: a NaN input returns `a`.
 * @param {number} v @param {number} a @param {number} b @returns {number}
 */
export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v === v ? v : a;
}

/** Clamp to [0, 1]. @param {number} v @returns {number} */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v === v ? v : 0;
}

/**
 * Linear interpolation. `t` is NOT clamped — extrapolation is intentional
 * (recoil springs and camera overshoot rely on it).
 * @param {number} a @param {number} b @param {number} t @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * FRAMERATE-INDEPENDENT exponential smoothing.
 *
 * Moves `a` toward `b` such that the remaining error decays by e^-lambda every
 * second, regardless of how long `dt` is. This is the only smoothing function
 * the game may use — a raw `lerp(a, b, 0.1)` per frame changes behaviour
 * between 60 Hz and 144 Hz and that is exactly the class of bug that makes a
 * game feel different on different machines.
 *
 *   lambda ~ 4   : lazy, cinematic
 *   lambda ~ 12  : responsive UI / camera follow
 *   lambda ~ 30  : near-instant, just takes the edge off a step change
 *
 * @param {number} a current value
 * @param {number} b target value
 * @param {number} lambda decay rate (1/seconds)
 * @param {number} dt seconds elapsed
 * @returns {number}
 */
export function damp(a, b, lambda, dt) {
  if (!(lambda > 0)) return b;
  if (!(dt > 0)) return a;
  return b + (a - b) * Math.exp(-lambda * dt);
}

/**
 * Framerate-independent smoothing for an angle in radians: takes the short way
 * around the circle so a yaw that crosses +/-PI does not spin the long way.
 * @param {number} a @param {number} b @param {number} lambda @param {number} dt
 * @returns {number} radians in (-PI, PI]
 */
export function dampAngle(a, b, lambda, dt) {
  return wrapAngle(a + shortestAngle(a, b) * (1 - Math.exp(-lambda * (dt > 0 ? dt : 0))));
}

/**
 * Move `a` toward `b` by at most `maxDelta`. Linear, not exponential — use for
 * things that must arrive exactly (crusher travel, volume fades).
 * @param {number} a @param {number} b @param {number} maxDelta @returns {number}
 */
export function approach(a, b, maxDelta) {
  const d = b - a;
  if (d > maxDelta) return a + maxDelta;
  if (d < -maxDelta) return a - maxDelta;
  return b;
}

/**
 * Hermite smoothstep between two edges, clamped.
 * @param {number} e0 @param {number} e1 @param {number} x @returns {number} 0..1
 */
export function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/**
 * Ken Perlin's smootherstep — C2 continuous, no visible acceleration seam.
 * @param {number} e0 @param {number} e1 @param {number} x @returns {number} 0..1
 */
export function smootherstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** @param {number} t 0..1 @returns {number} */
export function easeOutCubic(t) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** @param {number} t 0..1 @returns {number} */
export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * clamp01(t)) - 1) * 0.5;
}

/** @param {number} t 0..1 @returns {number} */
export function easeInCubic(t) {
  const u = clamp01(t);
  return u * u * u;
}

/**
 * Symmetric cubic ease. Contract §1 requires the `ease*` family; game.js drives
 * the 220 ms death rewind with it (game.js:1665) so the ghost decelerates into
 * the checkpoint instead of stopping dead.
 * @param {number} t 0..1 @returns {number}
 */
export function easeInOutCubic(t) {
  const u = clamp01(t);
  if (u < 0.5) return 4 * u * u * u;
  const v = -2 * u + 2;
  return 1 - (v * v * v) * 0.5;
}

/** @param {number} t 0..1 @returns {number} */
export function easeOutQuint(t) {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u * u;
}

/**
 * Overshoot ease — lands past the target then settles. Used for HUD numerals
 * and the checkpoint punch.
 * @param {number} t 0..1 @param {number} [s=1.70158] overshoot amount
 * @returns {number}
 */
export function easeOutBack(t, s) {
  const k = s === undefined ? 1.70158 : s;
  const u = clamp01(t) - 1;
  return u * u * ((k + 1) * u + k) + 1;
}

/**
 * Decaying elastic pulse: 1 at t=0 falling to 0 at t=1 while oscillating.
 * Drives camera punch and hit-stop wobble.
 * @param {number} t 0..1 @param {number} [freq=3] @returns {number}
 */
export function pulseDecay(t, freq) {
  const u = clamp01(t);
  return Math.cos(u * Math.PI * (freq === undefined ? 3 : freq)) * (1 - u) * (1 - u);
}

/**
 * Inverse lerp: where does `v` sit between a and b? Clamped to 0..1.
 * @param {number} a @param {number} b @param {number} v @returns {number}
 */
export function invLerp(a, b, v) {
  if (a === b) return 0;
  return clamp01((v - a) / (b - a));
}

/**
 * Remap `v` from one range to another, clamped to the output range.
 * @param {number} v @param {number} inA @param {number} inB
 * @param {number} outA @param {number} outB @returns {number}
 */
export function remap(v, inA, inB, outA, outB) {
  return outA + (outB - outA) * invLerp(inA, inB, v);
}

/** Wrap an angle into (-PI, PI]. @param {number} a @returns {number} */
export function wrapAngle(a) {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/**
 * Signed shortest angular distance from `a` to `b`, in (-PI, PI].
 * @param {number} a @param {number} b @returns {number}
 */
export function shortestAngle(a, b) {
  return wrapAngle(b - a);
}

/** Sign that returns 0 for 0. @param {number} v @returns {-1|0|1} */
export function sign0(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/**
 * Kill denormal dust so a velocity that is "basically zero" actually reads as
 * zero to the stop-check in the controller.
 * @param {number} v @param {number} [eps=1e-4] @returns {number}
 */
export function deadzone(v, eps) {
  const e = eps === undefined ? 1e-4 : eps;
  return v < e && v > -e ? 0 : v;
}

/** @param {number} deg @returns {number} radians */
export function toRad(deg) { return deg * DEG2RAD; }
/** @param {number} rad @returns {number} degrees */
export function toDeg(rad) { return rad * RAD2DEG; }

/* ===========================================================================
 * Deterministic randomness
 * ======================================================================== */

/**
 * Mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Every piece of "random" content in the game (decor scatter, particle jitter
 * seeds, grain offsets) must come from a seeded generator so that a stage looks
 * identical on every machine and across every reload. `Math.random()` is
 * forbidden in world generation.
 *
 * @param {number} seed any 32-bit-ish integer
 * @returns {() => number} generator producing floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = (seed | 0) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a style string hash — turns a stage id into a stable numeric seed.
 * @param {string} str @param {number} [seed=2166136261]
 * @returns {number} unsigned 32-bit integer
 */
export function hashString(str, seed) {
  let h = (seed === undefined ? 2166136261 : seed) >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Uniform float in [min, max) from a generator.
 * @param {() => number} rng @param {number} min @param {number} max
 * @returns {number}
 */
export function randRange(rng, min, max) {
  return min + (max - min) * rng();
}

/**
 * Uniform integer in [min, max] inclusive.
 * @param {() => number} rng @param {number} min @param {number} max
 * @returns {number}
 */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Pick one element of an array. Returns undefined for an empty array.
 * @template T @param {() => number} rng @param {T[]} arr @returns {T}
 */
export function pick(rng, arr) {
  return arr.length ? arr[(rng() * arr.length) | 0] : undefined;
}

/**
 * Fisher-Yates, in place, deterministic for a given generator.
 * @template T @param {() => number} rng @param {T[]} arr @returns {T[]} arr
 */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/* ===========================================================================
 * Time
 * ======================================================================== */

const _perf = (typeof performance !== 'undefined' && typeof performance.now === 'function')
  ? performance
  : null;

/**
 * Monotonic milliseconds. Falls back to Date.now() under node so the harness
 * can time things without a DOM.
 * @returns {number}
 */
export function nowMs() {
  return _perf ? _perf.now() : Date.now();
}

/**
 * Format seconds as "M:SS.mmm" — the run-timer format.
 *
 * NOTE the unit: this takes SECONDS. Timers held in milliseconds must be
 * divided first (`fmtTime(ms / 1000)`). Negative / NaN inputs format as
 * "0:00.000" rather than throwing, because a HUD must never show NaN.
 *
 * @param {number} sec
 * @returns {string}
 */
export function fmtTime(sec) {
  let s = Number(sec);
  if (!isFinite(s) || s < 0) s = 0;
  const total = Math.floor(s * 1000 + 0.5);
  const m = (total / 60000) | 0;
  const ss = ((total % 60000) / 1000) | 0;
  const ms = total % 1000;
  return m + ':' + (ss < 10 ? '0' : '') + ss + '.' + (ms < 100 ? (ms < 10 ? '00' : '0') : '') + ms;
}

/**
 * Compact "M:SS.mm" (centiseconds) for tight HUD slots and stage-select cards.
 * @param {number} sec @returns {string}
 */
export function fmtTimeShort(sec) {
  let s = Number(sec);
  if (!isFinite(s) || s < 0) s = 0;
  const total = Math.floor(s * 100 + 0.5);
  const m = (total / 6000) | 0;
  const ss = ((total % 6000) / 100) | 0;
  const cs = total % 100;
  return m + ':' + (ss < 10 ? '0' : '') + ss + '.' + (cs < 10 ? '0' : '') + cs;
}

/**
 * Signed delta against a par/best time, e.g. "-2.418" / "+0.750".
 * @param {number} sec current @param {number} refSec reference @returns {string}
 */
export function fmtDelta(sec, refSec) {
  const d = (Number(sec) || 0) - (Number(refSec) || 0);
  const sign = d < 0 ? '-' : '+';
  const a = Math.abs(d);
  return sign + a.toFixed(3);
}

/* ===========================================================================
 * Pool
 * ======================================================================== */

/**
 * A fixed-shape object pool.
 *
 * `acquire()` performs ZERO allocation while the pool is warm — the free list
 * is a pre-sized array used as a stack, and handing an object out is a single
 * indexed read plus a decrement. Only an exhausted pool allocates, and it grows
 * permanently when it does, so the second minute of play never allocates for a
 * pattern the first minute already paid for.
 *
 * @template T
 */
export class Pool {
  /**
   * @param {() => T} factory  makes a fresh object
   * @param {(o: T) => void} [reset]  returns an object to its neutral state;
   *        called on release, never on acquire, so the cost is paid off-peak
   * @param {number} [size=0]  how many to pre-build
   */
  constructor(factory, reset, size) {
    if (typeof factory !== 'function') throw new TypeError('Pool: factory must be a function');
    this._factory = factory;
    this._reset = typeof reset === 'function' ? reset : null;

    const n = size | 0;
    this._free = new Array(n > 0 ? n : 8);
    this._count = 0;
    /** total objects the pool has ever created */
    this.created = 0;
    /** objects currently handed out */
    this.live = 0;

    for (let i = 0; i < n; i++) {
      this._free[i] = this._factory();
      this._count++;
      this.created++;
    }
  }

  /** @returns {T} */
  acquire() {
    let o;
    if (this._count > 0) {
      this._count--;
      o = this._free[this._count];
      this._free[this._count] = null;
    } else {
      o = this._factory();
      this.created++;
    }
    this.live++;
    return o;
  }

  /**
   * Hand an object back. Safe to call with null. Calling twice with the same
   * object corrupts the pool, so callers must null their reference.
   * @param {T} o
   */
  release(o) {
    if (o === null || o === undefined) return;
    if (this._reset) this._reset(o);
    this._free[this._count] = o;
    this._count++;
    if (this.live > 0) this.live--;
  }

  /** Pre-build up to `n` free objects so the first burst does not allocate. */
  warm(n) {
    while (this._count < n) {
      this._free[this._count] = this._factory();
      this._count++;
      this.created++;
    }
    return this;
  }

  /** Objects currently available without allocating. @returns {number} */
  get available() { return this._count; }

  /** Drop every pooled object (does not touch objects still handed out). */
  clear() {
    for (let i = 0; i < this._count; i++) this._free[i] = null;
    this._count = 0;
  }
}

/* ===========================================================================
 * Emitter
 * ======================================================================== */

const _EMPTY = [];

/**
 * The event bus every other module uses (`player.events`, `game.events`, ...).
 *
 * Design notes that matter:
 *  - `emit` allocates nothing for up to four payload arguments. Beyond four it
 *    falls back to `apply`, which does allocate — so hot events keep to four.
 *  - Removing a listener from inside its own callback is legal. During a
 *    dispatch, `off` writes a tombstone instead of splicing, and the array is
 *    compacted once the outermost dispatch unwinds. Without that, a listener
 *    that unsubscribes itself silently skips the next listener in the list.
 *  - A throwing listener is logged and the remaining listeners still run: one
 *    broken HUD widget must not take the player controller down with it.
 */
export class Emitter {
  constructor() {
    /** @type {Map<string, Array<Function|null>>} */
    this._map = new Map();
    this._depth = 0;
    this._dirty = false;
  }

  /**
   * @param {string} evt
   * @param {Function} fn
   * @returns {Function} the same fn, so callers can keep the handle for off()
   */
  on(evt, fn) {
    if (typeof fn !== 'function') return fn;
    let list = this._map.get(evt);
    if (list === undefined) { list = []; this._map.set(evt, list); }
    list.push(fn);
    return fn;
  }

  /**
   * Subscribe for exactly one dispatch. `off(evt, fn)` with the ORIGINAL
   * function still removes it.
   * @param {string} evt @param {Function} fn @returns {Function} the wrapper
   */
  once(evt, fn) {
    if (typeof fn !== 'function') return fn;
    const self = this;
    const wrap = function (a, b, c, d) {
      self.off(evt, wrap);
      fn(a, b, c, d);
    };
    wrap.__orig = fn;
    this.on(evt, wrap);
    return wrap;
  }

  /**
   * Remove one listener, or every listener for `evt` when `fn` is omitted.
   * @param {string} evt @param {Function} [fn]
   */
  off(evt, fn) {
    const list = this._map.get(evt);
    if (list === undefined) return;

    if (fn === undefined) {
      if (this._depth > 0) {
        for (let i = 0; i < list.length; i++) list[i] = null;
        this._dirty = true;
      } else {
        list.length = 0;
      }
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f === fn || (f !== null && f.__orig === fn)) {
        if (this._depth > 0) { list[i] = null; this._dirty = true; }
        else list.splice(i, 1);
        return;
      }
    }
  }

  /** Remove every listener for every event. */
  clear() {
    if (this._depth > 0) {
      this._map.forEach(markAllNull);
      this._dirty = true;
    } else {
      this._map.clear();
    }
  }

  /** @param {string} evt @returns {boolean} */
  has(evt) {
    const list = this._map.get(evt);
    if (list === undefined) return false;
    for (let i = 0; i < list.length; i++) if (list[i] !== null) return true;
    return false;
  }

  /**
   * Dispatch. Up to four payload arguments are passed with zero allocation;
   * more than four falls back to Function.apply.
   * @param {string} evt @param {*} [a] @param {*} [b] @param {*} [c] @param {*} [d]
   */
  emit(evt, a, b, c, d) {
    const list = this._map.get(evt);
    if (list === undefined || list.length === 0) return;

    this._depth++;
    const many = arguments.length > 5;
    let extra = _EMPTY;
    if (many) {
      extra = new Array(arguments.length - 1);
      for (let i = 1; i < arguments.length; i++) extra[i - 1] = arguments[i];
    }

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f === null) continue;
      try {
        if (many) f.apply(null, extra);
        else f(a, b, c, d);
      } catch (err) {
        console.error('[Emitter] listener for "' + evt + '" threw:', err);
      }
    }

    this._depth--;
    if (this._depth === 0 && this._dirty) this._compact();
  }

  /** @private */
  _compact() {
    this._dirty = false;
    this._map.forEach(compactList, this._map);
  }
}

function markAllNull(list) {
  for (let i = 0; i < list.length; i++) list[i] = null;
}

function compactList(list, key) {
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const f = list[r];
    if (f !== null) { list[w] = f; w++; }
  }
  list.length = w;
  if (w === 0 && this && typeof this.delete === 'function') this.delete(key);
}

/* ===========================================================================
 * Small array + misc helpers
 * ======================================================================== */

/**
 * O(1) removal that does not preserve order — the right tool for "live
 * particles" / "active hazards" lists that are rebuilt every frame anyway.
 * @template T @param {T[]} arr @param {number} i @returns {T[]} arr
 */
export function swapRemove(arr, i) {
  const last = arr.length - 1;
  if (i < 0 || i > last) return arr;
  if (i !== last) arr[i] = arr[last];
  arr.length = last;
  return arr;
}

/**
 * Remove the first occurrence of `v`, preserving order.
 * @template T @param {T[]} arr @param {T} v @returns {boolean} whether it was found
 */
export function removeItem(arr, v) {
  const i = arr.indexOf(v);
  if (i === -1) return false;
  arr.splice(i, 1);
  return true;
}

/**
 * A trailing-edge throttle used for resize / settings persistence. Returns a
 * function with a `.cancel()` and a `.flush()`.
 * @param {Function} fn @param {number} ms @returns {Function}
 */
export function debounce(fn, ms) {
  let handle = 0;
  let lastArgs = null;
  const run = function () {
    handle = 0;
    const a = lastArgs;
    lastArgs = null;
    if (a) fn.apply(null, a);
    else fn();
  };
  const wrapped = function () {
    lastArgs = arguments.length ? Array.prototype.slice.call(arguments) : null;
    if (handle) clearTimeout(handle);
    handle = setTimeout(run, ms);
  };
  wrapped.cancel = function () { if (handle) { clearTimeout(handle); handle = 0; } lastArgs = null; };
  wrapped.flush = function () { if (handle) { clearTimeout(handle); run(); } };
  return wrapped;
}

/**
 * A rolling numeric average with a fixed window and no allocation after
 * construction. Used for the fps counter and for smoothing HUD speed.
 */
export class RollingAverage {
  /** @param {number} [size=30] */
  constructor(size) {
    const n = (size | 0) > 0 ? size | 0 : 30;
    this._buf = new Float64Array(n);
    this._i = 0;
    this._n = 0;
    this._sum = 0;
    /** current mean */
    this.value = 0;
  }

  /** @param {number} v @returns {number} the new mean */
  push(v) {
    if (!isFinite(v)) return this.value;
    if (this._n === this._buf.length) this._sum -= this._buf[this._i];
    else this._n++;
    this._buf[this._i] = v;
    this._sum += v;
    this._i = (this._i + 1) % this._buf.length;
    this.value = this._sum / this._n;
    return this.value;
  }

  reset() {
    this._buf.fill(0);
    this._i = 0;
    this._n = 0;
    this._sum = 0;
    this.value = 0;
  }
}

/**
 * Read a nested property with a default — used everywhere theme / stage data
 * from another module is consumed, so a missing optional field degrades to a
 * sane value instead of throwing during a level load.
 * @param {object} obj @param {string} path dot-separated @param {*} fallback
 * @returns {*}
 */
export function dig(obj, path, fallback) {
  if (obj === null || obj === undefined) return fallback;
  let cur = obj;
  let start = 0;
  const p = path;
  for (let i = 0; i <= p.length; i++) {
    if (i === p.length || p.charCodeAt(i) === 46 /* '.' */) {
      const key = p.slice(start, i);
      start = i + 1;
      if (cur === null || cur === undefined) return fallback;
      cur = cur[key];
    }
  }
  return cur === undefined || cur === null ? fallback : cur;
}

/**
 * Coerce to a finite number, else the fallback. The defensive read used at
 * every module boundary.
 * @param {*} v @param {number} fallback @returns {number}
 */
export function numOr(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

/**
 * @param {number} bytes
 * @returns {string} e.g. "3.4 MB"
 */
export function fmtBytes(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/* ===========================================================================
 * CRESTBOUND additions — CONTRACT §1
 * ======================================================================== */

/**
 * THE heading convention (CONTRACT: yaw 0 faces −Z, +yaw turns counter-
 * clockwise seen from above, i.e. exactly `THREE.Object3D.rotation.y`).
 *
 * This is the ONE place an authored yaw becomes a direction. It is written
 * identically in `tuning.js` (which must stay import-free so it runs under the
 * node validators); the two are kept byte-for-byte equal on purpose so there is
 * no import cycle and no drift. Anything with x/y/z fields works as `out`
 * (a THREE.Vector3 or a plain object); when `out` is omitted a plain object is
 * allocated — hot callers pass a hoisted scratch.
 *
 * @param {number} yaw radians
 * @param {{x:number,y:number,z:number}} [out]
 * @returns {{x:number,y:number,z:number}} out
 */
export function headingFromYaw(yaw, out) {
  out = out || { x: 0, y: 0, z: 0 };
  out.x = -Math.sin(yaw); out.y = 0; out.z = -Math.cos(yaw);
  return out;
}

/**
 * Inverse of headingFromYaw for a flat (x, z) direction. Returns the yaw whose
 * heading points along (x, z); `yawFromHeading(0, -1) === 0`.
 * @param {number} x @param {number} z @returns {number} radians in (-PI, PI]
 */
export function yawFromHeading(x, z) {
  return Math.atan2(-x, -z);
}

/**
 * Framerate-independent exponential smoothing of a vector, IN PLACE.
 * Same semantics as `damp()` applied per component: the remaining error decays
 * by e^-lambda per second. Works on any {x,y,z} (THREE.Vector3 included).
 * Allocation-free.
 *
 * @param {{x:number,y:number,z:number}} cur   modified in place
 * @param {{x:number,y:number,z:number}} target
 * @param {number} lambda decay rate (1/seconds)
 * @param {number} dt seconds
 * @returns {{x:number,y:number,z:number}} cur
 */
export function dampVec3(cur, target, lambda, dt) {
  if (!(lambda > 0)) { cur.x = target.x; cur.y = target.y; cur.z = target.z; return cur; }
  if (!(dt > 0)) return cur;
  const k = Math.exp(-lambda * dt);
  cur.x = target.x + (cur.x - target.x) * k;
  cur.y = target.y + (cur.y - target.y) * k;
  cur.z = target.z + (cur.z - target.z) * k;
  return cur;
}

/**
 * Move angle `a` toward angle `b` by at most `maxDelta` radians, taking the
 * short way around the circle. Linear (not exponential) — this is the hero's
 * turn-rate limiter (`turnRateSlow` / `turnRateFast` × dt), where the rate must
 * be exact so the turn radius at full run is the number the bible says.
 *
 * @param {number} a current angle (radians)
 * @param {number} b target angle (radians)
 * @param {number} maxDelta maximum change this call (radians, >= 0)
 * @returns {number} the new angle, wrapped into (-PI, PI]
 */
export function moveTowardAngle(a, b, maxDelta) {
  const d = shortestAngle(a, b);
  const m = maxDelta > 0 ? maxDelta : 0;
  if (d > m) return wrapAngle(a + m);
  if (d < -m) return wrapAngle(a - m);
  return wrapAngle(b);
}

/**
 * Fixed-capacity ring buffer. The death rewind reads the last 0.4 s of hero
 * poses out of one of these (24 samples at 60 Hz) and plays them backward.
 *
 * Two modes, chosen at construction:
 *
 *  - REFERENCE mode (`new Ring(n)`): `push(v)` stores `v` itself. Simple, but
 *    the caller owns the allocation of every value it pushes.
 *
 *  - SLOT mode (`new Ring(n, factory)`): every slot is pre-built by `factory()`
 *    once, and `push(v)` COPIES the fields of `v` into the oldest slot. The
 *    field list is captured from `factory()`'s result at construction, so the
 *    copy loop allocates nothing — that is how the controller records
 *    `{x, y, z, facing}` every frame without a single allocation. Pass an
 *    explicit `copy(slot, v)` as the third argument for non-flat values.
 *
 * Indexing: `at(0)` is the OLDEST sample, `at(length - 1)` the newest;
 * `last(0)` is the newest, `last(1)` the one before it — the rewind walks
 * `last(i)` upward. Out-of-range reads return `undefined`.
 */
export class Ring {
  /**
   * @param {number} n capacity (>= 1)
   * @param {() => object} [factory] pre-builds slots (SLOT mode)
   * @param {(slot:object, v:object) => void} [copy] custom field copy for SLOT mode
   */
  constructor(n, factory, copy) {
    const cap = (n | 0) > 0 ? n | 0 : 1;
    /** @type {any[]} */
    this._buf = new Array(cap);
    this._head = 0;         // index the NEXT push writes to
    this._n = 0;
    /** capacity — fixed for the life of the ring */
    this.capacity = cap;
    this._factory = typeof factory === 'function' ? factory : null;
    this._copy = typeof copy === 'function' ? copy : null;
    /** @type {string[]|null} field names captured once, for the flat copy */
    this._keys = null;

    if (this._factory) {
      for (let i = 0; i < cap; i++) this._buf[i] = this._factory();
      if (!this._copy) this._keys = Object.keys(this._buf[0] || {});
    } else {
      for (let i = 0; i < cap; i++) this._buf[i] = undefined;
    }
  }

  /** number of samples currently held (<= capacity) */
  get length() { return this._n; }

  /** true once the ring has wrapped at least once */
  get full() { return this._n === this.capacity; }

  /**
   * Record a value. In SLOT mode the fields of `v` are copied into the
   * recycled slot and the slot is returned; in REFERENCE mode `v` is stored
   * and returned.
   * @param {*} v
   * @returns {*} the stored slot/value
   */
  push(v) {
    const i = this._head;
    let stored;
    if (this._factory) {
      const slot = this._buf[i];
      if (this._copy) this._copy(slot, v);
      else {
        const keys = this._keys;
        for (let k = 0; k < keys.length; k++) { const key = keys[k]; slot[key] = v[key]; }
      }
      stored = slot;
    } else {
      this._buf[i] = v;
      stored = v;
    }
    this._head = (i + 1) % this.capacity;
    if (this._n < this.capacity) this._n++;
    return stored;
  }

  /**
   * SLOT mode only: hand out the slot the next `push` would overwrite so the
   * caller can fill it directly, then call `commit()`. Saves the copy for
   * callers that build the sample in place.
   * @returns {object|undefined}
   */
  slot() {
    return this._factory ? this._buf[this._head] : undefined;
  }

  /** SLOT mode only: advance after filling `slot()` directly. */
  commit() {
    this._head = (this._head + 1) % this.capacity;
    if (this._n < this.capacity) this._n++;
  }

  /**
   * @param {number} i 0 = oldest … length-1 = newest
   * @returns {*} the sample, or undefined when out of range
   */
  at(i) {
    if (!(i >= 0) || i >= this._n) return undefined;
    const start = (this._head - this._n + this.capacity) % this.capacity;
    return this._buf[(start + i) % this.capacity];
  }

  /**
   * @param {number} i 0 = newest, 1 = the one before, …
   * @returns {*} the sample, or undefined when out of range
   */
  last(i) {
    const k = i === undefined ? 0 : i;
    if (!(k >= 0) || k >= this._n) return undefined;
    return this._buf[(this._head - 1 - k + this.capacity * 2) % this.capacity];
  }

  /** Forget every sample (slots are kept, nothing is freed). */
  clear() {
    this._head = 0;
    this._n = 0;
    if (!this._factory) for (let i = 0; i < this.capacity; i++) this._buf[i] = undefined;
  }
}
