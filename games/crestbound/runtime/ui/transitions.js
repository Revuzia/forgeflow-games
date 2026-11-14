/* ============================================================================
 * CRESTBOUND — runtime/ui/transitions.js
 * Screen transitions. Contract §27:
 *
 *   export class Transitions { constructor(root); fade(ms, color?) -> Promise;
 *                              iris(ms); wipe(); }
 *
 * Extended for this game's needs (slice brief):
 *   fade(ms, color)                 cover / uncover with a flat colour
 *   iris(ms, direction, opts)       circle iris centred on a screen point (0..1)
 *   wipe(ms, opts)                  gold-edged sweep across the frame
 *   setRewind(v01)                  the sepia rewind vignette the death sequence
 *                                   drives every frame while the ghost plays back
 *
 * DESIGN
 * ------
 * Four independent layers live inside one `.cb-trans` container (pointer-events
 * none, z above every other UI surface). Each layer is driven by ONE WAAPI
 * animation of a compositor-only property (opacity / transform), never by
 * per-frame JS, so a transition costs nothing on the main thread while a course
 * is loading on it.
 *
 *  · FADE   — a full-bleed plate; opacity 0 <-> 1.
 *  · IRIS   — a circle whose 9999px box-shadow spread fills everything OUTSIDE
 *             it (see style.js): scale 0 = screen fully covered, scale max =
 *             screen fully revealed. That inversion is what lets the iris close
 *             ON the hero rather than away from him. The focus point arrives as
 *             {x, y} in 0..1 viewport space (game.js projects the hero), and the
 *             radius that guarantees coverage is the farthest viewport corner
 *             from that point.
 *  · WIPE   — a translated plate with a gold leading edge; one pass sweeps the
 *             frame, `{cover:true}` stops it half way (screen covered).
 *  · REWIND — a sepia vignette + scanline drift, held at an arbitrary strength
 *             by setRewind(v) so the 220 ms death rewind can ramp it in and out
 *             in step with the ghost playback.
 *
 * STATE MODEL
 * -----------
 * `fade()` and `iris()` ALTERNATE when no direction is given: if the screen is
 * currently covered by that layer the call uncovers it, otherwise it covers.
 * That makes the common integration
 *
 *     await tr.fade(260); await game.loadCourse(id); await tr.fade(320);
 *
 * do the obvious thing, while `fadeOut/fadeIn/irisIn/irisOut` stay available
 * when a caller wants to be explicit. Every promise resolves exactly once, even
 * when a newer transition cancels an older one (the older one resolves early
 * rather than hanging a caller's `await` forever — an un-resolved transition
 * promise deadlocks a course load).
 *
 * Nothing here reads the DOM for layout except `window.innerWidth/Height` at the
 * start of an iris, and nothing allocates per frame.
 * ==========================================================================*/

import { clamp } from '../core/util.js';
import { Settings } from '../core/settings.js';
import { injectStyles, UIRegistry, el, cssColor, icon, UI_TOKENS } from './style.js';

/** Fallback colour for every layer (matches --void / the boot background). */
const DEFAULT_COLOR = '#0b0a16';

/** Reduced motion still needs the cover, just not the theatre. */
const REDUCED_MAX_MS = 140;

/** Iris hole radius at scale 1, in px — must match `.ct-iris i` in style.js. */
const IRIS_BASE_R = 100;

export class Transitions {
  /**
   * @param {HTMLElement} root the #ui element (falls back to #ui, then body)
   */
  constructor(root) {
    injectStyles();
    this.root = root || document.getElementById('ui') || document.body;

    this.el = el('div', 'cb-trans cb-ui');

    /* --- fade plate --------------------------------------------------- */
    this.nFade = el('div', 'ct-fade');

    /* --- iris (hole + gold rim) --------------------------------------- */
    this.nIris = el('div', 'ct-iris');
    this.nIrisHole = el('i');
    this.nIrisRim = el('u');
    this.nIris.appendChild(this.nIrisHole);
    this.nIris.appendChild(this.nIrisRim);

    /* --- wipe plate ---------------------------------------------------- */
    this.nWipe = el('div', 'ct-wipe');

    /* --- rewind vignette ----------------------------------------------- */
    this.nRewind = el('div', 'ct-rewind');
    const lines = el('div', 'rw-lines');
    for (let i = 0; i < 4; i++) lines.appendChild(el('i'));
    const glyph = el('div', 'rw-glyph');
    glyph.innerHTML = icon('rewind') + '<span>REWIND</span>';
    this.nRewind.appendChild(lines);
    this.nRewind.appendChild(glyph);

    this.el.appendChild(this.nFade);
    this.el.appendChild(this.nIris);
    this.el.appendChild(this.nWipe);
    this.el.appendChild(this.nRewind);
    this.root.appendChild(this.el);

    /** Live animation handles + their pending resolvers, per layer. */
    this._anim = { fade: null, iris: null, wipe: null };
    this._pending = { fade: null, iris: null, wipe: null };

    /** Covered flags: is that layer currently hiding the frame? */
    this._faded = false;
    this._irised = false;

    /** Last written rewind strength (quantised — setRewind is called per frame). */
    this._rewind = -1;

    UIRegistry.transitions = this;
  }

  /* ======================================================================
   * INTERNALS
   * ====================================================================*/

  /** Settings.reduceMotion, defensively (settings may not have loaded). */
  _reduced() {
    try {
      const s = Settings && typeof Settings.get === 'function' ? Settings.get() : null;
      return !!(s && s.reduceMotion);
    } catch (e) { return false; }
  }

  /** Clamp a caller's duration, honouring reduced motion. */
  _dur(ms, fallback) {
    let d = Number(ms);
    if (!isFinite(d) || d < 0) d = fallback;
    d = clamp(d, 0, 8000);
    if (this._reduced()) d = Math.min(d, REDUCED_MAX_MS);
    return d;
  }

  /**
   * Run one WAAPI animation on a layer, cancelling whatever was running there.
   * The cancelled transition's promise RESOLVES (false) rather than hanging.
   * Resolves true when this animation reached its end state.
   */
  _run(key, node, frames, ms, easing, onDone) {
    /* Retire whatever was on this layer. A superseded transition resolves
       `false` immediately — never left hanging on a caller's await. */
    const prev = this._pending[key];
    if (prev) { this._pending[key] = null; try { prev(false); } catch (e) { /* ignore */ } }
    const prevAnim = this._anim[key];
    if (prevAnim) {
      this._anim[key] = null;
      prevAnim.onfinish = null; prevAnim.oncancel = null;   // its callbacks must not touch the new state
      try { prevAnim.cancel(); } catch (e) { /* ignore */ }
    }

    let settle = null;
    const p = new Promise((resolve) => { settle = resolve; });
    this._pending[key] = settle;

    /* Write the end state inline as well: WAAPI fill keeps the visual, but an
       explicit write means a later cancel() can never snap the layer back to
       its stylesheet value mid-transition. */
    const applyEnd = () => {
      const end = frames[frames.length - 1];
      for (const k in end) {
        if (k === 'easing' || k === 'offset') continue;
        node.style[k] = end[k];
      }
    };

    const done = (ok) => {
      if (this._pending[key] !== settle) return;             // superseded: stay quiet
      this._pending[key] = null;
      if (ok) {
        applyEnd();
        if (onDone) { try { onDone(); } catch (e) { /* ignore */ } }
      }
      settle(ok);
    };

    if (ms <= 0 || typeof node.animate !== 'function') { done(true); return p; }

    let a = null;
    try {
      a = node.animate(frames, { duration: ms, easing: easing || UI_TOKENS.ease.inOut, fill: 'both' });
    } catch (e) { a = null; }
    if (!a) { done(true); return p; }

    this._anim[key] = a;
    a.onfinish = () => { if (this._anim[key] === a) this._anim[key] = null; done(true); };
    a.oncancel = () => { if (this._anim[key] === a) this._anim[key] = null; done(false); };
    return p;
  }

  /** True while any cover transition is mid-flight. */
  get busy() {
    return !!(this._anim.fade || this._anim.iris || this._anim.wipe);
  }

  /** True while the frame is hidden by the fade plate or a closed iris. */
  get covered() { return this._faded || this._irised; }

  /* ======================================================================
   * FADE
   * ====================================================================*/

  /**
   * Cross-fade the frame to (or back from) a flat colour.
   * With no `dir` the call ALTERNATES: covered -> uncover, clear -> cover.
   *
   * @param {number}  [ms=280]   duration
   * @param {string|number} [color] any colour form (#hex, 0xRRGGBB, css)
   * @param {'out'|'in'} [dir]   'out' = fade TO colour (cover), 'in' = reveal
   * @returns {Promise<boolean>} true when the animation completed
   */
  fade(ms, color, dir) {
    const d = this._dur(ms, 280);
    const to = dir ? dir : (this._faded ? 'in' : 'out');
    const cover = to !== 'in';
    if (color != null) this.nFade.style.setProperty('--tc', cssColor(color, DEFAULT_COLOR));
    else if (!this.nFade.style.getPropertyValue('--tc')) this.nFade.style.setProperty('--tc', DEFAULT_COLOR);

    const from = this._faded ? 1 : 0;
    const end = cover ? 1 : 0;
    this._faded = cover;
    return this._run('fade', this.nFade,
      [{ opacity: String(from) }, { opacity: String(end) }],
      d, cover ? UI_TOKENS.ease.in : UI_TOKENS.ease.out);
  }

  /** Explicit: fade TO `color` and leave the frame covered. */
  fadeOut(ms, color) { return this.fade(ms, color, 'out'); }

  /** Explicit: fade the cover away and leave the frame visible. */
  fadeIn(ms, color) { return this.fade(ms, color, 'in'); }

  /** Cover instantly (no animation) — used before a hard course swap. */
  cover(color) {
    if (color != null) this.nFade.style.setProperty('--tc', cssColor(color, DEFAULT_COLOR));
    return this.fade(0, color, 'out');
  }

  /** Drop every cover instantly. Never leaves a caller's await hanging. */
  clear() {
    this.fade(0, null, 'in');
    if (this._irised) this.iris(0, 'out');
    this.setRewind(0);
    this.nWipe.classList.remove('is-on');
    this.nWipe.style.transform = 'translateX(-102%)';
  }

  /* ======================================================================
   * IRIS
   * ====================================================================*/

  /**
   * Storybook iris on a screen point.
   *
   * @param {number} [ms=460] duration
   * @param {'in'|'out'|'close'|'open'|object} [direction]
   *        'in'/'close' shrinks the hole until the frame is covered;
   *        'out'/'open' grows it from nothing until the frame is clear.
   *        Omit to alternate. May instead be the options object.
   * @param {{x:number,y:number}|{at:{x,y},color:*,dir:string}} [opts]
   *        `at` (or the object itself) is the focus point in 0..1 viewport
   *        coordinates — {x:0.5,y:0.5} when absent.
   * @returns {Promise<boolean>}
   */
  iris(ms, direction, opts) {
    let dir = null;
    let o = opts || null;
    if (direction && typeof direction === 'object') { o = direction; dir = o.dir || o.direction || null; }
    else if (typeof direction === 'string') dir = direction;
    if (o && o.dir && !dir) dir = o.dir;

    const at = (o && (o.at || (typeof o.x === 'number' ? o : null))) || null;
    const px = clamp(at && isFinite(at.x) ? at.x : 0.5, -0.5, 1.5);
    const py = clamp(at && isFinite(at.y) ? at.y : 0.5, -0.5, 1.5);
    const color = o && o.color != null ? o.color : null;

    const d = this._dur(ms, 460);
    const close = dir ? (dir === 'in' || dir === 'close') : !this._irised;

    if (color != null) this.nIris.style.setProperty('--tc', cssColor(color, DEFAULT_COLOR));
    else if (!this.nIris.style.getPropertyValue('--tc')) this.nIris.style.setProperty('--tc', DEFAULT_COLOR);

    /* Radius that reaches the farthest viewport corner from the focus point,
       so "open" really does clear the whole frame. */
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    const cx = px * w, cy = py * h;
    const dx = Math.max(cx, w - cx), dy = Math.max(cy, h - cy);
    const rMax = Math.sqrt(dx * dx + dy * dy) + 8;
    const kMax = rMax / IRIS_BASE_R;

    const left = (px * 100).toFixed(3) + '%';
    const top = (py * 100).toFixed(3) + '%';
    this.nIrisHole.style.left = left; this.nIrisHole.style.top = top;
    this.nIrisRim.style.left = left; this.nIrisRim.style.top = top;

    this.nIris.classList.add('is-on');
    const from = this._irised ? 0 : kMax;
    const to = close ? 0 : kMax;
    this._irised = close;

    /* The gold rim rides the hole but fades out as it disappears, so a closed
       iris is a clean plate rather than a bright dot. */
    const rimFrom = this._reduced() ? 0 : (from > 0 ? 0.85 : 0);
    const rimTo = this._reduced() ? 0 : (to > 0 ? 0.85 : 0);
    if (typeof this.nIrisRim.animate === 'function' && d > 0) {
      try {
        this.nIrisRim.animate(
          [{ transform: 'scale(' + from.toFixed(4) + ')', opacity: String(rimFrom) },
            { transform: 'scale(' + to.toFixed(4) + ')', opacity: String(rimTo) }],
          { duration: d, easing: close ? UI_TOKENS.ease.in : UI_TOKENS.ease.out, fill: 'both' });
      } catch (e) { /* decorative only */ }
    } else {
      this.nIrisRim.style.transform = 'scale(' + to.toFixed(4) + ')';
      this.nIrisRim.style.opacity = String(rimTo);
    }

    return this._run('iris', this.nIrisHole,
      [{ transform: 'scale(' + from.toFixed(4) + ')' }, { transform: 'scale(' + to.toFixed(4) + ')' }],
      d, close ? UI_TOKENS.ease.in : UI_TOKENS.ease.out,
      () => {
        /* fully open = the layer is doing nothing; take it out of compositing */
        if (!this._irised) { this.nIris.classList.remove('is-on'); this.nIrisRim.style.opacity = '0'; }
      });
  }

  /** Explicit: close the iris on `at` and leave the frame covered. */
  irisIn(ms, at, color) { return this.iris(ms, { dir: 'in', at, color }); }

  /** Explicit: open the iris from `at` and leave the frame clear. */
  irisOut(ms, at, color) { return this.iris(ms, { dir: 'out', at, color }); }

  /* ======================================================================
   * WIPE
   * ====================================================================*/

  /**
   * A gold-edged plate sweeps across the frame. One call = one full pass
   * (covered at the half-way point, clear at the end) unless `{cover:true}`,
   * which parks the plate over the frame for a load.
   *
   * @param {number} [ms=520]
   * @param {{dir?:'ltr'|'rtl', color?:*, cover?:boolean}} [opts]
   * @returns {Promise<boolean>}
   */
  wipe(ms, opts) {
    const o = opts || {};
    const d = this._dur(ms, 520);
    const rtl = o.dir === 'rtl';
    if (o.color != null) this.nWipe.style.setProperty('--tc', cssColor(o.color, DEFAULT_COLOR));
    else if (!this.nWipe.style.getPropertyValue('--tc')) this.nWipe.style.setProperty('--tc', DEFAULT_COLOR);

    const a = rtl ? '102%' : '-102%';
    const b = '0%';
    const c = rtl ? '-102%' : '102%';
    this.nWipe.classList.add('is-on');
    this.nWipe.style.transform = 'translateX(' + a + ')';

    const frames = o.cover
      ? [{ transform: 'translateX(' + a + ')' }, { transform: 'translateX(' + b + ')' }]
      : [{ transform: 'translateX(' + a + ')' },
        { transform: 'translateX(' + b + ')', offset: 0.5, easing: UI_TOKENS.ease.out },
        { transform: 'translateX(' + c + ')' }];

    return this._run('wipe', this.nWipe, frames, d,
      o.cover ? UI_TOKENS.ease.out : UI_TOKENS.ease.inOut,
      () => { if (!o.cover) this.nWipe.classList.remove('is-on'); });
  }

  /* ======================================================================
   * REWIND VIGNETTE  (driven per frame by the death sequence)
   * ====================================================================*/

  /**
   * Strength of the sepia rewind vignette, 0..1. Safe to call every frame:
   * the value is quantised to 1/32 and only written when it actually changed.
   * @param {number} v01
   */
  setRewind(v01) {
    let v = Number(v01);
    if (!isFinite(v)) v = 0;
    v = clamp(v, 0, 1);
    const q = Math.round(v * 32) / 32;
    if (q === this._rewind) return;
    const wasOn = this._rewind > 0;
    this._rewind = q;
    this.nRewind.style.opacity = q.toFixed(3);
    const on = q > 0.004;
    if (on !== wasOn) this.nRewind.classList.toggle('is-on', on);
  }

  /** Current rewind strength (quantised). */
  get rewind() { return Math.max(0, this._rewind); }

  /* ======================================================================
   * TEARDOWN
   * ====================================================================*/

  dispose() {
    for (const k in this._pending) {
      const r = this._pending[k];
      this._pending[k] = null;
      if (r) { try { r(false); } catch (e) { /* ignore */ } }
    }
    for (const k in this._anim) {
      const a = this._anim[k];
      this._anim[k] = null;
      if (a) { try { a.cancel(); } catch (e) { /* ignore */ } }
    }
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.transitions === this) UIRegistry.transitions = null;
  }
}

export default Transitions;
