/* ============================================================================
 * CRESTBOUND — runtime/ui/coursecard.js
 * The painting you walk into. Contract §27:
 *
 *   export class CourseCard {
 *     constructor(root, game);
 *     show(courseDef, save) -> Promise<'enter'|'cancel'>;
 *   }
 *
 * Walking into a painting in THE KEEP (or through an unlocked door) raises this
 * card: a gilded frame around a painted view of the realm, the course name and
 * subtitle burnt into the canvas, difficulty pips, the SEVEN crest slots (filled
 * gold when claimed — and only then does the crest's NAME appear; an unclaimed
 * slot shows what KIND of crest it is, never where it is), the coin best, the
 * best time, and ENTER / BACK.
 *
 * ART DIRECTION
 * -------------
 * The "painting" is a real painting: a deterministic procedural landscape drawn
 * to a 2D canvas — sky gradient, sun and halo, three parallax ridge layers built
 * from a seeded sum-of-sines silhouette, a realm landmark, drifting motes and a
 * varnish vignette — seeded by `hashString(courseId)`, so a course always shows
 * the same picture and no two courses show the same one. Never a flat colour
 * block (hard rule 1's spirit: nothing visible is a naked primitive).
 * The canvas is painted ONCE per course and cached; re-showing the same course
 * costs one `putImageData`-free repaint of nothing at all.
 *
 * INPUT
 * -----
 * Enter / Space / gamepad A confirm, Escape / Backspace / gamepad B cancel,
 * arrows and the left stick move between the two buttons. Every button carries
 * `cb-btn` and `__activate` so `loopcheck.py` can drive the Keep -> course path
 * without synthesising pointer events. The card is the only pointer-events
 * surface while it is up, and it hands input back to the game on close.
 * ==========================================================================*/

import { clamp, mulberry32, hashString } from '../core/util.js';
import { Save } from '../core/save.js';
import { REALMS, COURSE_META } from '../data/index.js';
import {
  injectStyles, UI_TOKENS, UIRegistry, el, fmtMs, makeButton, makeDots, makeCrestPip,
  animateOnce, FocusList, padNav, uiSfx, uiRumble, pushCapture, popCapture, cssColor,
  prettyId,
} from './style.js';

/** Crests per course (contract §0). */
const CRESTS = UI_TOKENS.counts.crests;

/** Backing-store size of the painting (CSS scales it to the frame). */
const PAINT_W = 1280;
const PAINT_H = 380;

/** What an UNCLAIMED slot admits to — the kind, never the name or the place. */
const TYPE_HINT = {
  open: 'SOMEWHERE',
  sigils: 'EIGHT SIGILS',
  coins: 'ONE HUNDRED COINS',
  secret: 'A SECRET',
  boss: 'THE WARDEN',
  race: 'A RACE',
  power: 'A POWER',
};

/** Realm palettes for the painting. [skyTop, skyBottom, sun, ridgeFar, ridgeMid, ridgeNear, mote] */
const REALM_PAINT = {
  verdant: {
    sky: ['#6fb6e8', '#bfe4f2', '#f5e6bd'], sun: '#fff3c4', sunGlow: 'rgba(255,236,170,.55)',
    ridges: ['#7fae86', '#4f8a63', '#2c5a44'], mote: 'rgba(255,246,200,.75)', motes: 34,
    ground: '#24503c', landmark: 'fort', haze: 'rgba(226,240,214,.32)',
  },
  ember: {
    sky: ['#2a0f16', '#7a2312', '#e2661f'], sun: '#ffd08a', sunGlow: 'rgba(255,140,40,.5)',
    ridges: ['#6a2617', '#3f150e', '#210a08'], mote: 'rgba(255,168,72,.85)', motes: 58,
    ground: '#180706', landmark: 'foundry', haze: 'rgba(255,120,40,.24)',
  },
  rime: {
    sky: ['#12203f', '#3a5f8f', '#bfe0f0'], sun: '#eaf6ff', sunGlow: 'rgba(180,226,255,.45)',
    ridges: ['#8fb6cf', '#5c7f9e', '#2f4560'], mote: 'rgba(238,250,255,.9)', motes: 62,
    ground: '#e6f1f8', landmark: 'peak', haze: 'rgba(214,236,248,.34)',
  },
  azure: {
    sky: ['#0d2b4a', '#2f7fa8', '#a8e6dd'], sun: '#ffeec2', sunGlow: 'rgba(150,230,255,.42)',
    ridges: ['#67a5b4', '#2f6f86', '#164056'], mote: 'rgba(206,246,255,.8)', motes: 30,
    ground: '#123a4e', landmark: 'temple', haze: 'rgba(178,232,238,.28)',
  },
  keep: {
    sky: ['#1a1230', '#3a2551', '#a87ec4'], sun: '#ffe6a8', sunGlow: 'rgba(255,214,140,.4)',
    ridges: ['#4a3364', '#31204a', '#1d1330'], mote: 'rgba(255,232,190,.7)', motes: 26,
    ground: '#150e26', landmark: 'keep', haze: 'rgba(180,150,220,.2)',
  },
};

export class CourseCard {
  /**
   * @param {HTMLElement} root the #ui element
   * @param {object} game      the Game instance (audio, input, routing)
   */
  constructor(root, game) {
    injectStyles();
    this.game = game || null;
    this.root = root || document.getElementById('ui') || document.body;

    this._open = false;
    this._resolve = null;
    this._keyHandler = null;
    this._padHandler = (n) => this._onPadNav(n);
    /** courseId -> painted canvas, so re-entering the Keep never repaints. */
    this._paintCache = new Map();
    this._def = null;

    this._build();
    UIRegistry.card = this;
  }

  /* ======================================================================
   * BUILD  (once — show() only writes text)
   * ====================================================================*/

  _build() {
    this.el = el('div', 'cb-card cb-ui');

    const frame = el('div', 'cc-frame');
    for (const c of ['tl', 'tr', 'bl', 'br']) frame.appendChild(el('div', 'cc-orn ' + c));

    const plate = el('div', 'cc-plate');

    /* --- the painting -------------------------------------------------- */
    const paint = el('div', 'cc-paint');
    this.canvas = document.createElement('canvas');
    this.canvas.width = PAINT_W;
    this.canvas.height = PAINT_H;
    paint.appendChild(this.canvas);
    paint.appendChild(el('div', 'cc-glint'));

    const title = el('div', 'cc-title');
    this.nRealm = el('div', 'cb-eyebrow cc-realm');
    this.nName = el('div', 'cc-name');
    this.nSub = el('div', 'cc-subtitle');
    title.appendChild(this.nRealm); title.appendChild(this.nName); title.appendChild(this.nSub);

    const diff = el('div', 'cc-diff');
    const dk = el('div', 'k'); dk.textContent = 'DIFFICULTY';
    this.nDiffHost = el('div');
    diff.appendChild(dk); diff.appendChild(this.nDiffHost);

    paint.appendChild(title); paint.appendChild(diff);
    this.nPaint = paint;

    /* --- body: crest slots, stats, buttons ----------------------------- */
    const body = el('div', 'cc-body');

    const crests = el('div', 'cc-crests');
    this._slots = [];
    for (let i = 0; i < CRESTS; i++) {
      const slot = el('div', 'cc-slot');
      const pip = makeCrestPip(false);
      const nm = el('div', 'nm');
      const best = el('div', 'best');
      slot.appendChild(pip); slot.appendChild(nm); slot.appendChild(best);
      crests.appendChild(slot);
      this._slots.push({ slot, pip, nm, best });
    }
    this.nCrests = crests;

    const stats = el('div', 'cc-stats');
    const mkStat = (k, gold) => {
      const c = el('div', 'cc-stat');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v' + (gold ? ' gold' : ''));
      c.appendChild(kk); c.appendChild(vv);
      stats.appendChild(c);
      return vv;
    };
    this.vCoins = mkStat('COINS', true);
    this.vBest = mkStat('BEST TIME', false);
    this.vDeaths = mkStat('DEATHS', false);
    this.nStats = stats;

    const btns = el('div', 'cc-btns');
    this.btnEnter = makeButton('ENTER', { primary: true, centered: true, onClick: () => this._choose('enter') });
    this.btnBack = makeButton('BACK', { centered: true, onClick: () => this._choose('cancel') });
    btns.appendChild(this.btnEnter); btns.appendChild(this.btnBack);
    this.nBtns = btns;

    this.nHint = el('div', 'cc-hint');
    this.nHint.innerHTML =
      '<b class="cb-kbd">ENTER</b><b class="cb-pad a">A</b> ENTER<i>·</i>' +
      '<b class="cb-kbd">ESC</b><b class="cb-pad b">B</b> BACK';

    this.nLock = el('div', 'cc-hint');
    this.nLock.style.color = 'var(--gold)';
    this.nLock.style.display = 'none';

    body.appendChild(crests); body.appendChild(stats);
    body.appendChild(btns); body.appendChild(this.nLock); body.appendChild(this.nHint);

    plate.appendChild(paint); plate.appendChild(body);
    frame.appendChild(plate);
    this.el.appendChild(frame);
    this.root.appendChild(this.el);

    this.nFrame = frame;
    this.nav = new FocusList(btns, { columns: 2, wrap: true, onMove: () => uiSfx(this.game, 'ui_move') });
    this.nav.bindHover();
  }

  /* ======================================================================
   * SHOW / CLOSE
   * ====================================================================*/

  get isOpen() { return this._open; }

  /**
   * Raise the card for a course.
   *
   * @param {object} courseDef a full course def (§25) OR a COURSE_META-shaped
   *   record; only {id, name, subtitle, realm, theme, difficulty, crests[]} are read.
   * @param {object} [save] the Save.course(id) record
   *   {crests:[crestId], coinsBest, cleared, deaths, bestMs:{crestId:ms}}.
   *   Omitted -> read from Save.
   * @param {{locked?:boolean, needCrests?:number, haveCrests?:number}} [opts]
   *   a sealed gate: ENTER is disabled and the requirement is spelled out.
   * @returns {Promise<'enter'|'cancel'>}
   */
  show(courseDef, save, opts) {
    const def = courseDef || {};
    const o = opts || {};
    const id = def.id || def.courseId || '';
    const meta = (id && COURSE_META[id]) || null;
    this._def = def;

    /* --- identity ------------------------------------------------------ */
    const realmId = def.realm || (meta && meta.realm) || def.theme || 'keep';
    const realm = REALMS.find((r) => r.id === realmId) || null;
    const themeId = def.theme || (meta && meta.theme) || realmId;
    const name = String(def.name || (meta && meta.name) || prettyId(id) || 'A COURSE');
    const sub = String(def.subtitle || (meta && meta.subtitle) || '');
    const diff = clamp((def.difficulty != null ? def.difficulty : (meta ? meta.difficulty : 1)) | 0, 0, 10);

    this.nRealm.textContent = realm ? realm.name : prettyId(realmId);
    this.nName.textContent = name.toUpperCase();
    this.nSub.textContent = sub;
    this.nSub.style.display = sub ? '' : 'none';

    /* Difficulty is authored 1..10; the pip strip reads better as 5, so it is
       shown as ceil(d/2) of 5 and the top pip burns red at 9-10. */
    this.nDiffHost.textContent = '';
    this.nDiffHost.appendChild(makeDots(Math.ceil(diff / 2), 5));

    /* Realm accent, scoped to the card: the frame glow, eyebrow and focus ring
       take the realm's colour without disturbing the global HUD theme. */
    if (realm && realm.accent != null) {
      const hex = cssColor(realm.accent, '#e9c36b');
      this.el.style.setProperty('--accent', hex);
      this.el.style.setProperty('--accent-glow', this._glow(hex));
    } else {
      this.el.style.removeProperty('--accent');
      this.el.style.removeProperty('--accent-glow');
    }

    this._paint(id || themeId, themeId);

    /* --- save record --------------------------------------------------- */
    let rec = save || null;
    if (!rec && id) {
      /* Never MINT a record just to look at a painting. Save.course() is a
         non-mutating read now (it returns a shared empty record for a course
         nobody has entered), but going through courseIds() keeps the intent
         explicit and survives a future writer being added here. */
      try {
        const known = typeof Save.courseIds === 'function' ? Save.courseIds() : null;
        if (known && known.indexOf(String(id)) !== -1) rec = Save.course(id);
      } catch (e) { rec = null; }
    }
    const got = new Set(rec && Array.isArray(rec.crests) ? rec.crests.map(String) : []);
    const bestMs = (rec && rec.bestMs) || {};

    /* --- the seven slots ------------------------------------------------ */
    const defs = Array.isArray(def.crests) ? def.crests : null;
    let bestOverall = null;
    for (let i = 0; i < CRESTS; i++) {
      const s = this._slots[i];
      const cd = defs ? defs[i] : null;
      const cid = cd && cd.id != null ? String(cd.id) : null;
      const has = cid ? got.has(cid) : false;
      s.pip.set(has, false);
      s.slot.classList.toggle('is-got', has);
      if (has) {
        s.nm.textContent = String((cd && cd.name) || prettyId(cid)).toUpperCase();
      } else if (cd) {
        const hint = TYPE_HINT[cd.type] || 'SOMEWHERE';
        s.nm.textContent = hint;
      } else {
        s.nm.textContent = '· · ·';
      }
      const ms = cid != null && bestMs && isFinite(bestMs[cid]) ? bestMs[cid] : null;
      s.best.textContent = ms != null ? fmtMs(ms) : '';
      if (ms != null && (bestOverall == null || ms < bestOverall)) bestOverall = ms;
      s.slot.style.display = (defs && i >= defs.length && defs.length > 0) ? 'none' : '';
    }

    /* --- stats ---------------------------------------------------------- */
    const coinsTotal = this._coinsThreshold(def);
    const coinsBest = rec && rec.coinsBest != null ? rec.coinsBest | 0 : 0;
    this.vCoins.textContent = '';
    this.vCoins.appendChild(document.createTextNode(String(coinsBest)));
    const small = el('small'); small.textContent = '/ ' + coinsTotal;
    this.vCoins.appendChild(small);
    this.vBest.textContent = bestOverall != null ? fmtMs(bestOverall) : '—';
    this.vDeaths.textContent = rec && rec.deaths != null ? String(rec.deaths | 0) : '0';

    /* --- locked gate ---------------------------------------------------- */
    const locked = !!o.locked;
    this.btnEnter.setDisabled(locked);
    this.btnEnter.setLabel(rec && rec.cleared ? 'RE-ENTER' : 'ENTER');
    this.btnBack.classList.toggle('is-primary', locked);
    if (locked) {
      const need = o.needCrests != null ? o.needCrests | 0 : ((meta && meta.gateCrests) | 0);
      const have = o.haveCrests != null ? o.haveCrests | 0 : this._crestTotal();
      this.nLock.textContent = 'SEALED · ' + Math.max(0, need - have) + ' MORE CRESTS (' + have + ' / ' + need + ')';
      this.nLock.style.display = '';
    } else {
      this.nLock.style.display = 'none';
    }

    /* --- raise ----------------------------------------------------------- */
    if (this._resolve) { const r = this._resolve; this._resolve = null; r('cancel'); }
    const promise = new Promise((resolve) => { this._resolve = resolve; });

    if (!this._open) {
      this._open = true;
      pushCapture(this.game);
      padNav.acquire(this._padHandler);
      if (UIRegistry.hud && typeof UIRegistry.hud.hideFor === 'function') UIRegistry.hud.hideFor('card');
    }
    this.el.classList.add('on');

    animateOnce(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    animateOnce(this.nFrame, [
      { opacity: 0, transform: 'translateY(30px) scale(.94) rotateX(9deg)' },
      { opacity: 1, transform: 'translateY(0) scale(1) rotateX(0)' },
    ], { duration: 520, easing: UI_TOKENS.ease.spring });
    const stagger = [this.nPaint, this.nCrests, this.nStats, this.nBtns, this.nHint];
    for (let i = 0; i < stagger.length; i++) {
      animateOnce(stagger[i], [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 340, delay: 110 + i * 60, easing: UI_TOKENS.ease.out });
    }
    for (let i = 0; i < this._slots.length; i++) {
      animateOnce(this._slots[i].slot, [{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 300, delay: 200 + i * 40, easing: UI_TOKENS.ease.spring });
    }

    this.nav.refresh();
    this.nav.index = -1;
    this.nav.focusIndex(locked ? 1 : 0, true);

    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._keyHandler, true);

    uiSfx(this.game, 'painting_enter');
    return promise;
  }

  /** Dismiss without resolving a choice (the game tore the card down). */
  close(choice) {
    if (!this._open) return;
    this._open = false;
    padNav.release(this._padHandler);
    if (this._keyHandler) { window.removeEventListener('keydown', this._keyHandler, true); this._keyHandler = null; }
    const a = animateOnce(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
    const done = () => { if (!this._open) this.el.classList.remove('on'); };
    if (a) a.onfinish = done; else done();
    popCapture(this.game, false);
    if (UIRegistry.hud && typeof UIRegistry.hud.showFor === 'function') UIRegistry.hud.showFor('card');
    const r = this._resolve; this._resolve = null;
    if (r) r(choice === 'enter' ? 'enter' : 'cancel');
  }

  _choose(which) {
    if (which === 'enter' && this.btnEnter.disabled) { uiSfx(this.game, 'ui_back'); return; }
    uiSfx(this.game, which === 'enter' ? 'ui_ok' : 'ui_back');
    if (which === 'enter') uiRumble(this.game, 0.4, 0.6, 120);
    this.close(which);
  }

  /* ======================================================================
   * INPUT
   * ====================================================================*/

  _onKey(e) {
    if (!this._open) return;
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault(); e.stopPropagation();
      this._choose('cancel');
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault(); e.stopPropagation();
      /* Space/Enter always confirm the FOCUSED button, so the hint never lies. */
      if (!this.nav.activate()) this._choose('enter');
      return;
    }
    if (this.nav.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
  }

  _onPadNav(name) {
    if (!this._open) return;
    if (name === 'back') { this._choose('cancel'); return; }
    if (name === 'confirm') { this.nav.activate(); return; }
    this.nav.handleNav(name);
  }

  /* ======================================================================
   * HELPERS
   * ====================================================================*/

  _crestTotal() {
    try { return Save && typeof Save.crestTotal === 'function' ? Save.crestTotal() | 0 : 0; }
    catch (e) { return 0; }
  }

  /** The coins-crest threshold this course authored (default 100). */
  _coinsThreshold(def) {
    const list = def && Array.isArray(def.crests) ? def.crests : null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i].type === 'coins') return (list[i].threshold | 0) || UI_TOKENS.counts.coins;
      }
    }
    return UI_TOKENS.counts.coins;
  }

  /** rgba glow from a hex, for the scoped --accent-glow. */
  _glow(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.5)';
  }

  /* ======================================================================
   * THE PAINTING  (deterministic, drawn once per course)
   * ====================================================================*/

  /** Draw (or restore) the painting for `key`, in `themeId`'s palette. */
  _paint(key, themeId) {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const cached = this._paintCache.get(key);
    if (cached) { ctx.putImageData(cached, 0, 0); return; }
    this._render(ctx, PAINT_W, PAINT_H, themeId, key);
    try { this._paintCache.set(key, ctx.getImageData(0, 0, PAINT_W, PAINT_H)); }
    catch (e) { /* tainted/oversized canvas: repaint next time, no harm */ }
  }

  /**
   * A whole landscape in ~90 lines. Everything derives from one seeded RNG so
   * the picture is stable per course, and every layer is drawn with real
   * gradients and silhouettes — no flat rectangles standing in for scenery.
   */
  _render(ctx, w, h, themeId, key) {
    const P = REALM_PAINT[themeId] || REALM_PAINT.keep;
    const rng = mulberry32(hashString(String(key), 0x9e37));

    ctx.clearRect(0, 0, w, h);

    /* --- sky ----------------------------------------------------------- */
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, P.sky[0]);
    sky.addColorStop(0.55, P.sky[1]);
    sky.addColorStop(1, P.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /* --- sun / moon + halo --------------------------------------------- */
    const sx = w * (0.18 + rng() * 0.64);
    const sy = h * (0.20 + rng() * 0.22);
    const sr = 26 + rng() * 16;
    const halo = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 9);
    halo.addColorStop(0, P.sunGlow);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = P.sun;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();

    /* --- theme sky feature --------------------------------------------- */
    if (themeId === 'rime') this._aurora(ctx, w, h, rng);
    else if (themeId === 'ember') this._plume(ctx, w, h, rng, sx);
    else if (themeId === 'azure') this._seaGlints(ctx, w, h, rng);
    else this._clouds(ctx, w, h, rng);

    /* --- three parallax ridges ------------------------------------------ */
    const base = [0.60, 0.72, 0.86];
    const amp = [0.10, 0.14, 0.18];
    for (let layer = 0; layer < 3; layer++) {
      const a1 = rng() * Math.PI * 2, a2 = rng() * Math.PI * 2, a3 = rng() * Math.PI * 2;
      const f1 = 1.1 + rng() * 0.7, f2 = 2.3 + rng() * 1.4, f3 = 5.1 + rng() * 2.6;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const t = x / w;
        const n = Math.sin(t * Math.PI * 2 * f1 + a1) * 0.55 +
          Math.sin(t * Math.PI * 2 * f2 + a2) * 0.30 +
          Math.sin(t * Math.PI * 2 * f3 + a3) * 0.15;
        const y = h * (base[layer] - n * amp[layer]);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, h * base[layer] - h * amp[layer], 0, h);
      g.addColorStop(0, P.ridges[layer]);
      g.addColorStop(1, layer === 2 ? P.ground : P.ridges[layer]);
      ctx.fillStyle = g;
      ctx.fill();
      /* atmospheric haze between layers so the depth reads */
      if (layer < 2) {
        ctx.fillStyle = P.haze;
        ctx.globalAlpha = 0.5 - layer * 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    /* --- the realm landmark, sitting on the middle ridge ----------------- */
    this._landmark(ctx, w, h, P, rng);

    /* --- motes ---------------------------------------------------------- */
    ctx.fillStyle = P.mote;
    for (let i = 0; i < P.motes; i++) {
      const mx = rng() * w;
      const my = h * (0.12 + rng() * 0.78);
      const mr = 0.8 + rng() * 2.4;
      ctx.globalAlpha = 0.25 + rng() * 0.65;
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* --- varnish: warm vignette + a brushed sheen ------------------------ */
    const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.25, w * 0.5, h * 0.5, h * 1.15);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(18,10,26,.72)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#fff6dc';
    ctx.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      const y = rng() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (rng() - 0.5) * 12);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _clouds(ctx, w, h, rng) {
    ctx.fillStyle = 'rgba(255,252,238,.62)';
    for (let i = 0; i < 5; i++) {
      const cx = rng() * w;
      const cy = h * (0.12 + rng() * 0.28);
      const s = 26 + rng() * 40;
      ctx.globalAlpha = 0.30 + rng() * 0.4;
      ctx.beginPath();
      for (let p = 0; p < 5; p++) {
        ctx.arc(cx + (p - 2) * s * 0.62, cy + Math.sin(p * 1.7) * s * 0.16, s * (0.5 + rng() * 0.5), 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _aurora(ctx, w, h, rng) {
    for (let b = 0; b < 3; b++) {
      const y0 = h * (0.10 + b * 0.07 + rng() * 0.05);
      const g = ctx.createLinearGradient(0, y0 - 40, 0, y0 + 62);
      g.addColorStop(0, 'rgba(120,255,214,0)');
      g.addColorStop(0.5, b % 2 ? 'rgba(150,210,255,.28)' : 'rgba(126,255,206,.30)');
      g.addColorStop(1, 'rgba(190,150,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 16) {
        ctx.lineTo(x, y0 + Math.sin(x / w * Math.PI * (2 + b) + b) * 26);
      }
      for (let x = w; x >= 0; x -= 16) {
        ctx.lineTo(x, y0 + 58 + Math.sin(x / w * Math.PI * (2 + b) + b) * 26);
      }
      ctx.closePath(); ctx.fill();
    }
  }

  _plume(ctx, w, h, rng, sx) {
    const g = ctx.createLinearGradient(0, h * 0.62, 0, 0);
    g.addColorStop(0, 'rgba(255,132,40,.42)');
    g.addColorStop(1, 'rgba(90,20,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - 130, h * 0.66);
    ctx.quadraticCurveTo(sx - 40, h * 0.30, sx - 84, 0);
    ctx.lineTo(sx + 96, 0);
    ctx.quadraticCurveTo(sx + 40, h * 0.30, sx + 138, h * 0.66);
    ctx.closePath(); ctx.fill();
  }

  _seaGlints(ctx, w, h, rng) {
    ctx.strokeStyle = 'rgba(226,250,255,.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const y = h * (0.52 + rng() * 0.16);
      const x = rng() * w;
      const len = 10 + rng() * 46;
      ctx.globalAlpha = 0.2 + rng() * 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Silhouetted realm landmark — the thing you recognise the painting by. */
  _landmark(ctx, w, h, P, rng) {
    const x = w * (0.24 + rng() * 0.5);
    const y = h * 0.74;
    ctx.fillStyle = P.ridges[2];
    ctx.strokeStyle = 'rgba(255,240,200,.22)';
    ctx.lineWidth = 2;

    if (P.landmark === 'fort') {
      const bw = 128, bh = 92;
      ctx.beginPath();
      ctx.moveTo(x - bw / 2, y);
      ctx.lineTo(x - bw / 2, y - bh);
      for (let i = 0; i < 5; i++) {                       // crenellations
        const cx = x - bw / 2 + (i * bw) / 5;
        ctx.lineTo(cx, y - bh - 14);
        ctx.lineTo(cx + bw / 10, y - bh - 14);
        ctx.lineTo(cx + bw / 10, y - bh);
        ctx.lineTo(cx + bw / 5, y - bh);
      }
      ctx.lineTo(x + bw / 2, y);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(x + bw * 0.32, y - bh * 1.7, 34, bh * 1.7);   // tower
      ctx.beginPath();                                            // tower roof
      ctx.moveTo(x + bw * 0.28, y - bh * 1.7);
      ctx.lineTo(x + bw * 0.49, y - bh * 2.15);
      ctx.lineTo(x + bw * 0.70, y - bh * 1.7);
      ctx.closePath(); ctx.fill();
    } else if (P.landmark === 'foundry') {
      for (let i = 0; i < 3; i++) {
        const cx = x + (i - 1) * 62;
        const ch = 90 + rng() * 70;
        ctx.beginPath();
        ctx.moveTo(cx - 17, y);
        ctx.lineTo(cx - 12, y - ch);
        ctx.lineTo(cx + 12, y - ch);
        ctx.lineTo(cx + 17, y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,150,60,.5)';
        ctx.fillRect(cx - 12, y - ch - 5, 24, 6);
        ctx.fillStyle = P.ridges[2];
      }
      ctx.fillRect(x - 96, y - 40, 192, 40);
    } else if (P.landmark === 'peak') {
      ctx.beginPath();
      ctx.moveTo(x - 150, y);
      ctx.lineTo(x - 36, y - 150);
      ctx.lineTo(x + 8, y - 108);
      ctx.lineTo(x + 62, y - 176);
      ctx.lineTo(x + 168, y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(245,252,255,.86)';                    // snow cap
      ctx.beginPath();
      ctx.moveTo(x + 62, y - 176);
      ctx.lineTo(x + 30, y - 128);
      ctx.lineTo(x + 50, y - 132);
      ctx.lineTo(x + 68, y - 118);
      ctx.lineTo(x + 92, y - 134);
      ctx.closePath(); ctx.fill();
    } else if (P.landmark === 'temple') {
      ctx.fillRect(x - 104, y - 96, 208, 12);
      for (let i = 0; i < 6; i++) ctx.fillRect(x - 96 + i * 36, y - 84, 15, 84);
      ctx.beginPath();                                            // pediment
      ctx.moveTo(x - 116, y - 96);
      ctx.lineTo(x, y - 148);
      ctx.lineTo(x + 116, y - 96);
      ctx.closePath(); ctx.fill();
    } else {
      /* keep: an arched window throwing a god-ray */
      ctx.fillRect(x - 92, y - 156, 184, 156);
      ctx.fillStyle = 'rgba(255,226,160,.34)';
      ctx.beginPath();
      ctx.moveTo(x - 32, y - 40);
      ctx.lineTo(x - 32, y - 106);
      ctx.arc(x, y - 106, 32, Math.PI, 0);
      ctx.lineTo(x + 32, y - 40);
      ctx.closePath(); ctx.fill();
      const ray = ctx.createLinearGradient(x, y - 120, x - 150, y + 40);
      ray.addColorStop(0, 'rgba(255,232,180,.30)');
      ray.addColorStop(1, 'rgba(255,232,180,0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(x - 32, y - 120);
      ctx.lineTo(x + 32, y - 120);
      ctx.lineTo(x - 60, y + 60);
      ctx.lineTo(x - 190, y + 60);
      ctx.closePath(); ctx.fill();
    }
  }

  /* ======================================================================
   * TEARDOWN
   * ====================================================================*/

  dispose() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    padNav.release(this._padHandler);
    const r = this._resolve; this._resolve = null;
    if (r) r('cancel');
    this._paintCache.clear();
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.card === this) UIRegistry.card = null;
  }
}

export default CourseCard;
