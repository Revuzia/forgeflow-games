/* ============================================================================
 * CRESTBOUND — runtime/ui/hud.js
 * The in-game interface. DOM overlay in #hud (contract §27):
 *
 *   export class HUD {
 *     constructor(root, game); update(dt, snap); toast(text, sub?, kind?);
 *     crestGet(def); checkpointFlash(); deathFlash(cause); courseClear(summary);
 *     setVisible(v);
 *   }
 *   snap = {courseName, realmName, crests, crestsTotal, crestIds:[{id, got}],
 *           coins, sigils, sigilsTotal, timeMs, sessionMs, deaths, cpIndex, cpCount,
 *           power:{id, t}|null, raceMs|null, warden:{hp}|null, speed}
 *
 * Composition (storybook glass, see style.js):
 *   top-left     realm eyebrow / course name / CREST TALLY (7 octagonal pips that
 *                fill gold; hover or expand reveals the crest names)
 *   top-centre   RACE timer (big, pulses red under 10 s) · WARDEN hearts
 *   top-right    course timer + session clock (Settings.showTimer) · deaths
 *   bottom-left  coins (odometer roll-up) · 8 sigil pips · checkpoint pip
 *   bottom-ctr   POWER timer bar · queued toasts
 *   edges        subtle speed streaks (ribbon + wind lines at long-jump/dive speed)
 *   overlays     crest ribbon · checkpoint ring · death vignette · course-clear panel
 *
 * Ported from ASCENDANT's ui/hud.js (change-cached readouts, queued toasts,
 * WAAPI flashes, finish card) and rebuilt for the analog platformer's snapshot.
 *
 * Performance: update() writes ONLY values that changed (every readout is
 * cached in this._c), never queries layout, and allocates nothing in the hot
 * path except the time strings when the millisecond actually changed.
 * Everything is pointer-events:none except the crest tally (hover reveal) and
 * the course-clear panel (buttons).
 * ==========================================================================*/

import { clamp } from '../core/util.js';
import { Settings } from '../core/settings.js';
import { THEMES } from '../world/themes.js';
import {
  injectStyles, UI_TOKENS, UIRegistry, el, textNode, icon, splitTime, fmtMs, fmtClock,
  fmtSplit, makeButton, animateOnce, causeInfo, setUITheme, countUp, RollingNumber,
  FocusList, uiAction, uiSfx, uiRumble, pushCapture, popCapture, cssColor, makeCrestPip,
  makeSigilPip, pulseClass, padNav, prettyId,
} from './style.js';

/* --- module-scope constants / scratch (no per-frame allocation) ----------- */
const TOAST_LIFE = 2600;
const TOAST_MAX = 3;
const CRESTS = UI_TOKENS.counts.crests;     // 7
const SIGILS = UI_TOKENS.counts.sigils;     // 8
const COINS_FOR_CREST = UI_TOKENS.counts.coins;  // 100
const SPEED_NORM = 12.0;                    // m/s that fills the ribbon (long jump 17 saturates)
const RACE_LOW_MS = 10000;
const POWER_LOW_S = 5;
const RIBBON_MS = 3200;
const TALLY_PEEK_MS = 3400;

/* --- centre-screen announcement layer -----------------------------------
 * .ch-ribbon (crest reveal) and .ch-word (checkpoint / death wordmark) are both
 * absolutely centred, so two of them on screen at once is four superimposed
 * lines and nothing legible. ONE announcement owns the centre at a time; the
 * rest queue behind it by priority, and a higher priority takes the stage
 * immediately (dying mid-celebration must read as dying).
 * -------------------------------------------------------------------- */
const ANN_PRI = { checkpoint: 1, crest: 2, death: 3 };
const ANN_MAX_WAIT = 1200;   // ms a queued announcement will ever wait for the stage
const ANN_STALE = 2600;      // ms after which a queued announcement is no longer news
const ANN_TAIL_MS = 260;     // the authored fade-out we skip to when we cut one short
const ANN_QUEUE_MAX = 2;
const POWER_LABEL = { wing: 'WING', metal: 'METAL', vanish: 'VANISH' };
const POWER_ICON = { wing: 'wing', metal: 'crest', vanish: 'sigil' };

export class HUD {
  /**
   * @param {HTMLElement} root  the #hud element
   * @param {object} game       the Game instance (read-only + uiAction routing)
   */
  constructor(root, game) {
    injectStyles();
    this.game = game || null;
    this.root = root || document.getElementById('hud') || document.body;

    this.el = el('div', 'cb-hud cb-ui');
    this.root.appendChild(this.el);

    /** master visibility + reason stack (death sequence, menus, cinematics) */
    this._visible = true;
    this._hidden = new Set();

    /** last-written value cache — the whole point of a cheap HUD */
    this._c = {
      realm: '', course: '', theme: null, crests: -1, crestsTotal: -1, isKeep: null,
      coins: -1, coinsOf: -1, coinsFull: null, sigils: -1, sigilsTotal: -1, sigilsFull: null,
      timeRaw: -1, timeMain: '', timeFrac: '', sessionRaw: -1, session: '',
      deaths: -1, cpIndex: -2, cpCount: -1, cpOn: null,
      powerId: null, powerMax: 0, powerQ: -1, powerLow: null, powerT: -1,
      raceOn: null, raceRaw: -1, raceMain: '', raceFrac: '', raceLow: null,
      wardenOn: null, wardenHp: -1, wardenMax: 0,
      speed: -1, streak: -1, speedOn: null,
      showTimer: null, hudScale: -1, reduce: null,
    };

    this._crestPips = [];        // [{node, li, liPip, id}] in def order
    this._crestById = new Map(); // id -> record
    this._sigilPips = [];
    this._hearts = [];
    this._toastLive = [];
    this._toastQueue = [];
    this._deathTimers = [];
    this._tallyTimer = 0;

    /* centre-stage announcement (see ANN_PRI) — exactly one at a time */
    this._annKind = '';
    this._annNode = null;
    this._annAnims = [];
    this._annTimer = 0;
    this._annEndAt = 0;
    this._annQueue = [];
    this._clearOpen = false;
    this._clearKeyHandler = null;
    this._clearResolve = null;
    this._clearOnChoice = null;
    this._cancelCount = null;
    this._padHandler = (name) => this._onPadNav(name);

    this._build();

    this._onSettings = () => this._applySettings();
    try { if (Settings && typeof Settings.on === 'function') Settings.on(this._onSettings); } catch (e) { /* ignore */ }
    this._applySettings();

    UIRegistry.hud = this;
  }

  /* ======================================================================
   * BUILD
   * ====================================================================*/

  _build() {
    /* Everything the death sequence / cinematics fade lives inside .ch-play;
       the flash layers and the clear panel are siblings so they stay visible. */
    this.nPlay = el('div', 'ch-play');
    this.nPlay.appendChild(el('div', 'ch-scrim'));
    this.el.appendChild(this.nPlay);
    const E = this.nPlay;

    /* --- top-left: realm / course / crest tally ----------------------- */
    const tl = el('div', 'ch-cluster ch-tl');
    this.nRealm = el('div', 'cb-eyebrow ch-realm');
    this.tRealm = textNode(this.nRealm, '');
    this.nCourse = el('div', 'ch-course');
    this.tCourse = textNode(this.nCourse, '');
    this.nTally = el('div', 'ch-tally');
    const pips = el('div', 'ch-pips');
    const names = el('div', 'ch-names');
    const namesInner = el('div');
    const ul = el('ul');
    for (let i = 0; i < CRESTS; i++) {
      const node = makeCrestPip(false);
      pips.appendChild(node);
      const li = el('li');
      const liPip = makeCrestPip(false);
      const liTxt = el('span');
      li.appendChild(liPip); li.appendChild(liTxt);
      ul.appendChild(li);
      this._crestPips.push({ node, li, liPip, liTxt, id: null, got: false });
    }
    /* THE HUB READS DIFFERENTLY. In a course the row is 7 pips = this course's
       7 crests. The Keep has none of its own, so the pips asserted 7 empty
       slots next to a '0 / 0' tally: two readouts contradicting each other and
       neither meaning anything. In the Keep the pips are hidden and the tally
       becomes the number the hub actually runs on — the save's crest total,
       which is what every gate compares against (contract §29 crestTotal). */
    const kLab = el('span', 'ch-tally-k');
    kLab.textContent = 'CRESTS';
    kLab.style.display = 'none';
    pips.appendChild(kLab);
    this.nTallyK = kLab;
    const tn = el('span', 'ch-tally-n');
    this.tTally = textNode(tn, '0 / ' + CRESTS);
    pips.appendChild(tn);
    namesInner.appendChild(ul); names.appendChild(namesInner);
    this.nPips = pips; this.nNames = names;
    this.nTally.appendChild(pips); this.nTally.appendChild(names);
    tl.appendChild(this.nRealm); tl.appendChild(this.nCourse); tl.appendChild(this.nTally);
    E.appendChild(tl);
    this.nTL = tl;

    /* --- top-centre: race timer + warden hearts ----------------------- */
    const tc = el('div', 'ch-cluster ch-tc');
    this.nRace = el('div', 'ch-race ch-chip');
    const rk = el('div', 'k'); rk.textContent = 'RACE';
    const rv = el('div', 'v');
    const rBig = el('span', 'big'); this.tRaceMain = textNode(rBig, '0:00');
    const rMs = el('span', 'ms'); this.tRaceFrac = textNode(rMs, '.000');
    rv.appendChild(rBig); rv.appendChild(rMs);
    this.nRace.appendChild(rk); this.nRace.appendChild(rv);
    this.nWarden = el('div', 'ch-warden ch-chip');
    const wk = el('div', 'k'); wk.textContent = 'WARDEN';
    this.nHearts = el('div', 'hearts');
    this.nWarden.appendChild(wk); this.nWarden.appendChild(this.nHearts);
    this._ensureHearts(3);
    tc.appendChild(this.nRace); tc.appendChild(this.nWarden);
    E.appendChild(tc);

    /* --- top-right: timers + deaths ------------------------------------ */
    const tr = el('div', 'ch-cluster ch-tr');
    this.nTimers = el('div', 'ch-timers');
    const timer = el('div', 'ch-timer');
    const big = el('span', 'big'); this.tTimeMain = textNode(big, '0:00');
    const ms = el('span', 'ms'); this.tTimeFrac = textNode(ms, '.000');
    timer.appendChild(big); timer.appendChild(ms);
    const ses = el('div', 'ch-session');
    const sesK = el('span'); sesK.textContent = 'SESSION';
    const sesV = el('b'); this.tSession = textNode(sesV, '0:00');
    ses.appendChild(sesK); ses.appendChild(sesV);
    this.nTimers.appendChild(timer); this.nTimers.appendChild(ses);
    this.nDeaths = el('div', 'ch-deaths ch-chip');
    this.nDeaths.innerHTML = icon('skull');
    this.rollDeaths = new RollingNumber('n');
    this.nDeaths.appendChild(this.rollDeaths.el);
    this.rollDeaths.set('0', false);
    tr.appendChild(this.nTimers); tr.appendChild(this.nDeaths);
    E.appendChild(tr);
    this.nTR = tr;

    /* --- bottom-left: coins / sigils / checkpoint ---------------------- */
    const bl = el('div', 'ch-cluster ch-bl');
    this.nCoins = el('div', 'ch-coins ch-chip');
    this.nCoins.innerHTML = icon('coin');
    this.rollCoins = new RollingNumber('n');
    this.nCoins.appendChild(this.rollCoins.el);
    this.rollCoins.set('0', false);
    const of = el('span', 'of'); this.tCoinOf = textNode(of, '/ ' + COINS_FOR_CREST);
    this.nCoins.appendChild(of);

    this.nSigils = el('div', 'ch-sigils ch-chip');
    this.nSigils.innerHTML = icon('sigil');
    const sp = el('div', 'pips');
    for (let i = 0; i < SIGILS; i++) { const p = makeSigilPip(false); sp.appendChild(p); this._sigilPips.push(p); }
    this.nSigils.appendChild(sp);

    this.nCp = el('div', 'ch-cp ch-chip');
    this.nCp.appendChild(el('div', 'pip'));
    const cpT = el('span', 't'); cpT.textContent = 'CHECKPOINT';
    const cpN = el('span', 'n'); this.tCp = textNode(cpN, '—');
    this.nCp.appendChild(cpT); this.nCp.appendChild(cpN);

    bl.appendChild(this.nCoins); bl.appendChild(this.nSigils); bl.appendChild(this.nCp);
    E.appendChild(bl);

    /* --- speed streaks ------------------------------------------------- */
    this.nSpeed = el('div', 'ch-speed');
    const rib = el('div', 'rib'); this.nSpeedFill = el('i'); rib.appendChild(this.nSpeedFill);
    const stk = el('div', 'streaks');
    for (let i = 0; i < 4; i++) stk.appendChild(el('i'));
    this.nSpeed.appendChild(rib); this.nSpeed.appendChild(stk);
    E.appendChild(this.nSpeed);

    /* --- bottom-centre: power bar + toasts ----------------------------- */
    this.nPower = el('div', 'ch-power ch-chip');
    this.nPower.style.cssText = 'position:absolute;left:50%;bottom:178px;transform:translateX(-50%) scale(var(--hud-scale));transform-origin:bottom center';
    const ph = el('div', 'h');
    const pk = el('span', 'k'); this.tPowerK = textNode(pk, 'POWER');
    const pv = el('span', 'v'); this.tPowerV = textNode(pv, '');
    ph.appendChild(pk); ph.appendChild(pv);
    const prail = el('div', 'rail'); this.nPowerFill = el('i'); prail.appendChild(this.nPowerFill);
    this.nPower.appendChild(ph); this.nPower.appendChild(prail);
    E.appendChild(this.nPower);

    this.nToasts = el('div', 'ch-bc');
    E.appendChild(this.nToasts);

    /* --- overlays (siblings of .ch-play) ------------------------------- */
    this.nRibbon = el('div', 'ch-ribbon');
    const emb = el('div', 'emblem'); emb.appendChild(el('div', 'halo')); emb.appendChild(el('i'));
    const band = el('div', 'band');
    const bk = el('div', 'k'); this.tRibK = textNode(bk, 'CREST CLAIMED');
    const bn = el('div', 'n'); this.tRibN = textNode(bn, '');
    const bs = el('div', 's'); this.tRibS = textNode(bs, '');
    band.appendChild(bk); band.appendChild(bn); band.appendChild(bs);
    this.nRibbon.appendChild(emb); this.nRibbon.appendChild(band);
    this.nRibbonEmblem = emb;

    this.nRing = el('div', 'ch-ring');
    this.nVig = el('div', 'ch-vig');
    this.nWord = el('div', 'ch-word');
    this.tWord = textNode(this.nWord, '');
    this.nWordSub = el('span', 'sub');
    this.nWord.appendChild(this.nWordSub);
    this.el.appendChild(this.nVig); this.el.appendChild(this.nRing);
    this.el.appendChild(this.nRibbon); this.el.appendChild(this.nWord);

    this._buildClear();
  }

  _ensureHearts(n) {
    while (this._hearts.length < n) {
      const h = el('div', 'cb-heart');
      h.innerHTML = icon('heart');
      this.nHearts.appendChild(h);
      this._hearts.push({ node: h, on: false });
    }
  }

  _buildClear() {
    const wrap = el('div', 'ch-clear');
    const card = el('div', 'ch-ccard cb-glass cb-plate');
    const corners = el('div', 'cb-corners');
    for (let i = 0; i < 4; i++) corners.appendChild(el('i'));
    card.appendChild(corners);

    this.cKicker = el('div', 'ch-ck'); this.cKicker.textContent = 'CREST CLAIMED';
    this.cName = el('div', 'ch-cname');
    this.cRealm = el('div', 'ch-crealm');
    const rEye = el('div', 'cb-eyebrow'); this.cRealmTxt = textNode(rEye, '');
    this.cRealm.appendChild(rEye);
    this.cRule = el('div', 'cb-rule ch-crule');
    this.cPips = el('div', 'ch-cpips');
    this._clearPips = [];
    for (let i = 0; i < CRESTS; i++) { const p = makeCrestPip(false); this.cPips.appendChild(p); this._clearPips.push(p); }

    const time = el('div', 'ch-ctime');
    this.cTimeBig = el('span', 'big'); this.cTimeMs = el('span', 'ms');
    time.appendChild(this.cTimeBig); time.appendChild(this.cTimeMs);
    this.cTime = time;
    this.cSplit = el('div', 'ch-csplit');
    this.cRecord = el('div', 'ch-crecord'); this.cRecord.textContent = 'NEW BEST';
    this.cRecord.style.display = 'none';

    const grid = el('div', 'ch-cgrid');
    const mk = (k) => {
      const c = el('div', 'ch-ccell');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v');
      c.appendChild(kk); c.appendChild(vv);
      grid.appendChild(c);
      return { cell: c, v: vv };
    };
    this.cCrestCell = mk('CRESTS');
    this.cCoinCell = mk('COINS');
    this.cSigilCell = mk('SIGILS');
    this.cDeathCell = mk('DEATHS');
    this.cGrid = grid;

    const btns = el('div', 'ch-cbtns');
    this.cBtnStay = makeButton('STAY', { primary: true, centered: true, onClick: () => this._clearAction('stay') });
    this.cBtnKeep = makeButton('RETURN TO KEEP', { centered: true, onClick: () => this._clearAction('keep') });
    btns.appendChild(this.cBtnStay); btns.appendChild(this.cBtnKeep);
    this.cBtns = btns;

    this.cHint = el('div', 'ch-chint');
    this.cHint.innerHTML = '<b class="cb-kbd">←</b><b class="cb-kbd">→</b> SELECT<i>·</i><b class="cb-kbd">ENTER</b> CONFIRM';

    card.appendChild(this.cKicker); card.appendChild(this.cName); card.appendChild(this.cRealm);
    card.appendChild(this.cRule); card.appendChild(this.cPips); card.appendChild(time);
    card.appendChild(this.cSplit); card.appendChild(this.cRecord); card.appendChild(grid);
    card.appendChild(btns); card.appendChild(this.cHint);
    wrap.appendChild(card);
    this.el.appendChild(wrap);

    this.nClear = wrap;
    this.nClearCard = card;
    this.clearNav = new FocusList(btns, { columns: 2, wrap: true, onMove: () => uiSfx(this.game, 'ui_move') });
    this.clearNav.bindHover();
  }

  /* ======================================================================
   * SETTINGS / THEME
   * ====================================================================*/

  _applySettings() {
    let s = null;
    try { s = Settings && typeof Settings.get === 'function' ? Settings.get() : null; } catch (e) { s = null; }
    if (!s) return;
    const c = this._c;
    const scale = clamp(Number(s.hudScale) || 1, 0.7, 1.6);
    if (scale !== c.hudScale) {
      c.hudScale = scale;
      document.documentElement.style.setProperty('--hud-scale', String(scale));
    }
    const show = s.showTimer !== false;
    if (show !== c.showTimer) {
      c.showTimer = show;
      this.nTimers.classList.toggle('is-off', !show);
    }
    const reduce = !!s.reduceMotion;
    if (reduce !== c.reduce) {
      c.reduce = reduce;
      document.documentElement.classList.toggle('cb-reduce', reduce);
    }
  }

  /** Re-tint the HUD from a theme id or ThemeDef (theme.palette.accent → --accent). */
  setTheme(theme) {
    if (!theme) return;
    let def = theme;
    let id = theme;
    if (typeof theme === 'string') { def = (THEMES && THEMES[theme]) || null; id = theme; }
    else { id = theme.id || null; }
    if (!def) return;
    if (id && id === this._c.theme) return;
    this._c.theme = id;
    setUITheme(def, id);
  }

  _syncTheme(snap) {
    let id = snap.theme || snap.themeId || null;
    if (!id) {
      try {
        const g = this.game;
        const d = g && g.course && g.course.def;
        id = (d && (d.theme || d.realm)) || (g && g.realmId) || null;
      } catch (e) { id = null; }
    }
    if (id && id !== this._c.theme) this.setTheme(id);
  }

  /* ======================================================================
   * VISIBILITY  (quiet during cinematics)
   * ====================================================================*/

  /**
   * Master visibility. Turning the HUD OFF is a state change (course load, Keep
   * return, cinematic), and the centre-stage layers are siblings of .ch-play, so
   * they must be struck too — otherwise a crest ribbon rides the whole load and
   * is still on screen in the Keep. `hideFor()` is the death dip and must NOT.
   */
  setVisible(v) {
    this._visible = !!v;
    if (!this._visible) this._annClear(true);
    this._paintVisible();
  }

  /** Reason-scoped hide so the death sequence, menus and cinematics never fight. */
  hideFor(reason) { this._hidden.add(reason); this._paintVisible(); }
  showFor(reason) { this._hidden.delete(reason); this._paintVisible(); }

  _paintVisible() {
    const on = this._visible && this._hidden.size === 0;
    this.nPlay.classList.toggle('is-off', !on);
  }

  /** Force the crest-name list open/closed (also opens for a beat after a crest). */
  expandCrests(open) { this.nTally.classList.toggle('is-open', !!open); }

  /* ======================================================================
   * PER-FRAME UPDATE
   * ====================================================================*/

  /**
   * @param {number} dt seconds
   * @param {object} snap see contract §27
   */
  update(dt, snap) {
    const s = snap;
    if (!s) return;
    const c = this._c;

    this._syncTheme(s);

    /* --- names ---------------------------------------------------------- */
    if (s.realmName !== undefined && s.realmName !== c.realm) {
      c.realm = s.realmName;
      this.tRealm.nodeValue = String(s.realmName || '');
    }
    if (s.courseName !== undefined && s.courseName !== c.course) {
      c.course = s.courseName;
      this.tCourse.nodeValue = String(s.courseName || '');
      this._bindCrestNames();
      animateOnce(this.nTL, [
        { opacity: 0, transform: 'translateX(-14px) scale(var(--hud-scale))' },
        { opacity: 1, transform: 'translateX(0) scale(var(--hud-scale))' },
      ], { duration: 460, easing: UI_TOKENS.ease.out });
    }

    /* --- hub vs course: which collectible readouts mean anything ---------- */
    /* `isKeep` has been in the snapshot since the hub existed (game.js sets it
       every frame) and the HUD never read it, so the hub wore the whole course
       cluster: 7 empty crest pips over '0 / 0', a coin chip counting to 100 in
       a hub that places no coins, an empty sigil pill and a '—' checkpoint. */
    const isKeep = !!s.isKeep;
    if (isKeep !== c.isKeep) {
      c.isKeep = isKeep;
      this._setHubMode(isKeep);
      c.crests = -1; c.crestsTotal = -1;      // force the tally text to rewrite
    }

    /* --- crest tally ----------------------------------------------------- */
    const ids = s.crestIds;
    if (!isKeep && Array.isArray(ids)) {
      for (let i = 0; i < ids.length && i < CRESTS; i++) {
        const e = ids[i];
        if (!e) continue;
        let rec = e.id != null ? this._crestById.get(e.id) : null;
        if (!rec) { rec = this._crestPips[i]; if (rec && rec.id == null && e.id != null) { rec.id = e.id; this._crestById.set(e.id, rec); } }
        if (!rec) continue;
        const got = !!e.got;
        if (got !== rec.got) {
          rec.got = got;
          rec.node.set(got, true);
          rec.liPip.set(got, false);
          rec.li.classList.toggle('is-got', got);
          if (rec.liTxt) rec.liTxt.textContent = got ? (rec.name || prettyId(e.id)) : (rec.name ? rec.name : '· · ·');
        }
      }
    }
    /* In the hub the pair is the SAVE's global total over every crest in the
       game (game.js already publishes both, `crestTotal` / `crestGrandTotal`) —
       the number the gates compare against. In a course it is this course's 7. */
    const crests = isKeep
      ? (s.crestTotal != null ? s.crestTotal | 0 : 0)
      : (s.crests != null ? s.crests | 0 : this._countGot());
    const crestsTotal = isKeep
      ? (s.crestGrandTotal != null ? s.crestGrandTotal | 0 : 0)
      : (s.crestsTotal != null ? s.crestsTotal | 0 : CRESTS);
    if (crests !== c.crests || crestsTotal !== c.crestsTotal) {
      c.crests = crests; c.crestsTotal = crestsTotal;
      this.tTally.nodeValue = crests + ' / ' + crestsTotal;
    }

    /* --- coins / sigils (hub: hidden, so not even measured) --------------- */
    if (!isKeep) {
    const coins = s.coins != null ? s.coins | 0 : 0;
    if (coins !== c.coins) {
      const up = c.coins >= 0 && coins > c.coins;
      c.coins = coins;
      this.rollCoins.set(String(coins), true);
      if (up) pulseClass(this.nCoins, 'is-hit', 520);
      const full = coins >= this._coinsThreshold();
      if (full !== c.coinsFull) { c.coinsFull = full; this.nCoins.classList.toggle('is-full', full); }
    }
    const thr = this._coinsThreshold();
    if (thr !== c.coinsOf) { c.coinsOf = thr; this.tCoinOf.nodeValue = '/ ' + thr; }

    /* --- sigils ---------------------------------------------------------- */
    const sig = s.sigils != null ? s.sigils | 0 : 0;
    const sigTotal = s.sigilsTotal != null ? s.sigilsTotal | 0 : SIGILS;
    if (sigTotal !== c.sigilsTotal) {
      c.sigilsTotal = sigTotal;
      for (let i = 0; i < this._sigilPips.length; i++) this._sigilPips[i].style.display = i < sigTotal ? '' : 'none';
    }
    if (sig !== c.sigils) {
      const up = c.sigils >= 0 && sig > c.sigils;
      c.sigils = sig;
      for (let i = 0; i < this._sigilPips.length; i++) this._sigilPips[i].set(i < sig, up && i === sig - 1);
      const full = sig >= sigTotal && sigTotal > 0;
      if (full !== c.sigilsFull) { c.sigilsFull = full; this.nSigils.classList.toggle('is-full', full); }
    }
    }

    /* --- timers ---------------------------------------------------------- */
    const timeMs = Number(s.timeMs) || 0;
    const tRaw = timeMs | 0;
    if (tRaw !== c.timeRaw) {
      c.timeRaw = tRaw;
      const st = splitTime(tRaw);
      if (st.main !== c.timeMain) { c.timeMain = st.main; this.tTimeMain.nodeValue = st.main; }
      if (st.frac !== c.timeFrac) { c.timeFrac = st.frac; this.tTimeFrac.nodeValue = st.frac; }
    }
    const sesRaw = (Number(s.sessionMs) || 0) / 1000 | 0;      // whole seconds only
    if (sesRaw !== c.sessionRaw) {
      c.sessionRaw = sesRaw;
      const txt = fmtClock(sesRaw * 1000);
      if (txt !== c.session) { c.session = txt; this.tSession.nodeValue = txt; }
    }

    /* --- deaths ---------------------------------------------------------- */
    const deaths = s.deaths != null ? s.deaths | 0 : 0;
    if (deaths !== c.deaths) {
      const up = c.deaths >= 0 && deaths > c.deaths;
      c.deaths = deaths;
      this.rollDeaths.set(String(deaths), true);
      if (up) pulseClass(this.nDeaths, 'is-hit', 420);
    }

    /* --- checkpoint pip -------------------------------------------------- */
    /* `cpIndex` is the index into course.checkpoints[], where slot 0 IS the
       spawn — so it is already the count of checkpoints REACHED (0 = none yet),
       and `cpCount` is `checkpoints.length - 1`, the number of real ones. The
       pip therefore renders it straight. Adding 1 here claimed "CHECKPOINT 1/4"
       at the spawn, and put "2 / 4" on screen beside the toast that game.js was
       raising for the same event as "CHECKPOINT 1 / 4". One fact, one number. */
    const cpCount = s.cpCount != null ? s.cpCount | 0 : 0;
    const cpIndex = s.cpIndex == null ? -1 : s.cpIndex | 0;
    if (!isKeep && (cpIndex !== c.cpIndex || cpCount !== c.cpCount)) {
      const on = cpIndex > 0 && cpCount > 0;
      c.cpIndex = cpIndex; c.cpCount = cpCount;
      this.tCp.nodeValue = cpCount > 0 ? Math.min(Math.max(cpIndex, 0), cpCount) + ' / ' + cpCount : '—';
      if (on !== c.cpOn) { c.cpOn = on; this.nCp.classList.toggle('on', on); }
    }

    /* --- power timer bar ------------------------------------------------- */
    const pw = s.power;
    const pid = pw && pw.id ? String(pw.id) : null;
    if (pid !== c.powerId) {
      c.powerId = pid; c.powerMax = 0; c.powerQ = -1; c.powerLow = null; c.powerT = -1;
      this.nPower.classList.toggle('on', !!pid);
      if (pid) {
        this.tPowerK.nodeValue = POWER_LABEL[pid] || pid.toUpperCase();
        animateOnce(this.nPower, [
          { opacity: 0, transform: 'translateX(-50%) translateY(10px) scale(var(--hud-scale))' },
          { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(var(--hud-scale))' },
        ], { duration: 320, easing: UI_TOKENS.ease.out });
      }
    }
    if (pid) {
      /* `t` = seconds remaining; the largest value seen for this activation is
         the bar's full width, so a 30 s power drains from full without the HUD
         needing the def. */
      const t = Math.max(0, Number(pw.t) || 0);
      if (t > c.powerMax) c.powerMax = t;
      const q = Math.round(clamp(c.powerMax > 0 ? t / c.powerMax : 0, 0, 1) * 200) / 200;
      if (q !== c.powerQ) { c.powerQ = q; this.nPowerFill.style.transform = 'scaleX(' + q.toFixed(3) + ')'; }
      const tShow = Math.ceil(t);
      if (tShow !== c.powerT) { c.powerT = tShow; this.tPowerV.nodeValue = tShow + ' S'; }
      const low = t < POWER_LOW_S;
      if (low !== c.powerLow) { c.powerLow = low; this.nPower.classList.toggle('is-low', low); }
    }

    /* --- race timer ------------------------------------------------------ */
    /* raceMs = milliseconds REMAINING on the active race crest, null when none. */
    const race = s.raceMs;
    const raceOn = race != null && isFinite(race);
    if (raceOn !== c.raceOn) {
      c.raceOn = raceOn; c.raceLow = null; c.raceRaw = -1;
      this.nRace.classList.toggle('on', raceOn);
      if (raceOn) animateOnce(this.nRace, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 300, easing: UI_TOKENS.ease.spring });
    }
    if (raceOn) {
      const rRaw = Math.max(0, race | 0);
      if (rRaw !== c.raceRaw) {
        c.raceRaw = rRaw;
        const st = splitTime(rRaw);
        if (st.main !== c.raceMain) { c.raceMain = st.main; this.tRaceMain.nodeValue = st.main; }
        if (st.frac !== c.raceFrac) { c.raceFrac = st.frac; this.tRaceFrac.nodeValue = st.frac; }
      }
      const low = rRaw < RACE_LOW_MS;
      if (low !== c.raceLow) { c.raceLow = low; this.nRace.classList.toggle('is-low', low); }
    }

    /* --- warden hearts --------------------------------------------------- */
    const w = s.warden;
    const wOn = !!(w && w.hp != null);
    if (wOn !== c.wardenOn) {
      c.wardenOn = wOn; c.wardenHp = -1;
      if (wOn) c.wardenMax = Math.max(3, w.hpMax | 0, w.hp | 0);
      this.nWarden.classList.toggle('on', wOn);
    }
    if (wOn) {
      const hp = Math.max(0, w.hp | 0);
      if (hp !== c.wardenHp) {
        const prev = c.wardenHp;
        c.wardenHp = hp;
        this._ensureHearts(c.wardenMax);
        for (let i = 0; i < this._hearts.length; i++) {
          const h = this._hearts[i];
          const on = i < hp;
          h.node.style.display = i < c.wardenMax ? '' : 'none';
          if (on !== h.on) { h.on = on; h.node.classList.toggle('on', on); if (!on && prev >= 0) pulseClass(h.node, 'is-hit', 460); }
        }
      }
    }

    /* --- speed streaks --------------------------------------------------- */
    const spd = Number(s.speed) || 0;
    const sq = Math.round(clamp(spd / SPEED_NORM, 0, 1.2) * 40) / 40;
    if (sq !== c.speed) {
      c.speed = sq;
      this.nSpeedFill.style.transform = 'scaleX(' + Math.min(sq, 1).toFixed(3) + ')';
      const on = sq > 0.28;
      if (on !== c.speedOn) { c.speedOn = on; this.nSpeed.style.opacity = on ? '1' : '0'; }
      /* wind lines only past run speed (long jump / dive / slide territory) */
      const stk = Math.round(clamp((sq - 0.78) / 0.32, 0, 1) * 0.65 * 20) / 20;
      if (stk !== c.streak) { c.streak = stk; this.nSpeed.style.setProperty('--stk', stk.toFixed(2)); }
    }
  }

  _countGot() {
    let n = 0;
    for (let i = 0; i < this._crestPips.length; i++) if (this._crestPips[i].got) n++;
    return n;
  }

  /**
   * Coins-crest threshold from the course def (type 'coins' → threshold).
   *
   * Returns 0 when the def declares NO coin crest — the honest answer, and the
   * one the chip needs: the fallback used to be a flat 100 borrowed from the
   * course rules, which is how the Keep (`coins: []`, no `crests` key at all)
   * ended up printing '0 / 100'. Mirrors Game.coinsGoal — one rule, two
   * surfaces; the clear panel, which only ever runs on a cleared COURSE, keeps
   * its own 100 fallback.
   */
  _coinsThreshold() {
    try {
      const d = this.game && this.game.course && this.game.course.def;
      if (d && Array.isArray(d.crests)) {
        for (let i = 0; i < d.crests.length; i++) {
          const cr = d.crests[i];
          if (cr && cr.type === 'coins') return (cr.threshold | 0) || COINS_FOR_CREST;
        }
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  /**
   * Swap the top-left tally and the bottom-left collectible cluster between
   * COURSE mode (7 crest pips + coins + sigils + checkpoint) and HUB mode
   * (one global crest total, nothing else). Runs on the transition only.
   */
  _setHubMode(on) {
    for (let i = 0; i < this._crestPips.length; i++) {
      const n = this._crestPips[i].node;
      if (n && n.style) n.style.display = on ? 'none' : '';
    }
    if (this.nNames) this.nNames.style.display = on ? 'none' : '';
    if (this.nTallyK) this.nTallyK.style.display = on ? '' : 'none';
    if (this.nCoins) this.nCoins.style.display = on ? 'none' : '';
    if (this.nSigils) this.nSigils.style.display = on ? 'none' : '';
    if (this.nCp) this.nCp.style.display = on ? 'none' : '';
    if (on) this.expandCrests(false);
  }

  /** Bind the 7 pips to the current course's crest defs (id + name). Runs on course change. */
  _bindCrestNames() {
    this._crestById.clear();
    let defs = null;
    try { const d = this.game && this.game.course && this.game.course.def; defs = d && Array.isArray(d.crests) ? d.crests : null; } catch (e) { defs = null; }
    for (let i = 0; i < this._crestPips.length; i++) {
      const rec = this._crestPips[i];
      const cd = defs ? defs[i] : null;
      rec.id = cd && cd.id != null ? cd.id : null;
      rec.name = cd && cd.name ? String(cd.name).toUpperCase() : '';
      rec.got = false;
      rec.node.set(false, false);
      rec.liPip.set(false, false);
      rec.li.classList.remove('is-got');
      rec.liTxt.textContent = '· · ·';   // names are revealed only once collected
      if (rec.id != null) this._crestById.set(rec.id, rec);
    }
    this._c.crests = -1;
  }

  /* ======================================================================
   * TOASTS  (queued — they never overlap)
   * ====================================================================*/

  /**
   * @param {string} text  headline
   * @param {string} [sub] secondary line
   * @param {string} [kind] 'info'|'good'|'warn'|'bad'|'crest'|'sigil'
   */
  toast(text, sub, kind) {
    if (text == null) return;
    this._toastQueue.push({ text: String(text), sub: sub ? String(sub) : '', kind: kind || 'info' });
    if (this._toastQueue.length > 8) this._toastQueue.splice(0, this._toastQueue.length - 8);
    this._pumpToasts();
  }

  _pumpToasts() {
    while (this._toastLive.length < TOAST_MAX && this._toastQueue.length) this._showToast(this._toastQueue.shift());
  }

  _showToast(t) {
    const k = t.kind;
    const kindCls = k === 'good' ? 'k-good' : k === 'warn' ? 'k-warn' : k === 'bad' ? 'k-bad'
      : k === 'crest' ? 'k-crest' : k === 'sigil' ? 'k-sigil' : 'k-info';
    const node = el('div', 'ch-toast ' + kindCls);
    const ic = el('div', 'ic');
    ic.innerHTML = icon(k === 'good' ? 'tick' : k === 'bad' || k === 'warn' ? 'warn'
      : k === 'crest' ? 'crest' : k === 'sigil' ? 'sigil' : 'chevron');
    const tx = el('div', 'tx');
    const t1 = el('div', 't1'); t1.textContent = t.text;
    tx.appendChild(t1);
    if (t.sub) { const t2 = el('div', 't2'); t2.textContent = t.sub; tx.appendChild(t2); }
    node.appendChild(ic); node.appendChild(tx);
    this.nToasts.appendChild(node);

    const rec = { node, timer: 0 };
    this._toastLive.push(rec);
    animateOnce(node, [
      { opacity: 0, transform: 'translate3d(0,22px,0) scale(.96)' },
      { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
    ], { duration: 300, easing: UI_TOKENS.ease.out });

    rec.timer = setTimeout(() => {
      const a = animateOnce(node, [
        { opacity: 1, transform: 'translate3d(0,0,0)' },
        { opacity: 0, transform: 'translate3d(0,-14px,0)' },
      ], { duration: 260, easing: UI_TOKENS.ease.in });
      const done = () => {
        node.remove();
        const i = this._toastLive.indexOf(rec);
        if (i >= 0) this._toastLive.splice(i, 1);
        this._pumpToasts();
      };
      if (a) a.onfinish = done; else done();
    }, TOAST_LIFE);
  }

  clearToasts() {
    for (const r of this._toastLive) { clearTimeout(r.timer); r.node.remove(); }
    this._toastLive.length = 0;
    this._toastQueue.length = 0;
  }

  /* ======================================================================
   * CENTRE-STAGE ANNOUNCEMENTS  (crest ribbon / checkpoint / death wordmark)
   *
   * Every centred reveal goes through here, so two of them can never paint on
   * top of each other. The stage holds one; a higher priority takes it away
   * from a lower one on the spot; a lower one waits (never longer than
   * ANN_MAX_WAIT — the live one is skipped to its own fade-out to make room)
   * and is dropped entirely once it is older than ANN_STALE.
   * ====================================================================*/

  /**
   * @param {string} kind 'checkpoint'|'crest'|'death'
   * @param {number} ms   how long the reveal runs
   * @param {function():HTMLElement} play writes the text, starts the WAAPI
   *        animations (pushing each into this._annAnims) and returns the node.
   */
  _announce(kind, ms, play) {
    const pri = ANN_PRI[kind] || 0;
    if (this._annKind) {
      const live = ANN_PRI[this._annKind] || 0;
      if (pri >= live) this._annClear(false);      // same or better: take the stage now
      else { this._annEnqueue(kind, ms, play, pri); return; }
    }
    this._annRun(kind, ms, play);
  }

  _annRun(kind, ms, play) {
    this._annKind = kind;
    this._annAnims.length = 0;
    const node = play();
    if (!node) { this._annKind = ''; this._annNext(); return; }
    this._annNode = node;
    node.classList.add('is-on');
    this._annEndAt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + ms;
    clearTimeout(this._annTimer);
    this._annTimer = setTimeout(() => { this._annClear(false); this._annNext(); }, ms + 40);
  }

  _annEnqueue(kind, ms, play, pri) {
    const q = this._annQueue;
    const at = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    for (let i = q.length - 1; i >= 0; i--) if (q[i].kind === kind) q.splice(i, 1);
    q.push({ kind, ms, play, pri, at });
    q.sort((a, b) => (b.pri - a.pri) || (a.at - b.at));
    while (q.length > ANN_QUEUE_MAX) q.pop();
    /* Make room: skip the live reveal to its authored fade-out rather than let a
       checkpoint wait out a 3.2 s ribbon (or cut it dead, which reads as a bug). */
    const wait = this._annEndAt - at;
    if (wait > ANN_MAX_WAIT) {
      const skip = wait - ANN_MAX_WAIT;
      for (let i = 0; i < this._annAnims.length; i++) {
        const a = this._annAnims[i];
        if (!a) continue;
        try {
          const dur = a.effect && a.effect.getTiming ? a.effect.getTiming().duration : 0;
          if (typeof dur === 'number' && dur > 0) {
            const t = typeof a.currentTime === 'number' ? a.currentTime : 0;
            a.currentTime = Math.min(dur, Math.max(t, t + skip, dur - ANN_TAIL_MS));
          }
        } catch (e) { /* a finished animation throws on seek — nothing to skip */ }
      }
      this._annEndAt = at + ANN_MAX_WAIT;
      clearTimeout(this._annTimer);
      this._annTimer = setTimeout(() => { this._annClear(false); this._annNext(); }, ANN_MAX_WAIT + 40);
    }
  }

  /** Take the stage down: cancel its animations, hide it, blank its text. */
  _annClear(dropQueue) {
    clearTimeout(this._annTimer);
    this._annTimer = 0;
    for (let i = 0; i < this._annAnims.length; i++) {
      const a = this._annAnims[i];
      if (a && typeof a.cancel === 'function') { try { a.cancel(); } catch (e) { /* already gone */ } }
    }
    this._annAnims.length = 0;
    if (this._annNode) this._annNode.classList.remove('is-on');
    this._annNode = null;
    this._annKind = '';
    this._annEndAt = 0;
    /* Blank the words too: a hidden node still answers textContent, and a stale
       "CREST CLAIMED" reported from the Keep is a real defect either way. */
    this.tRibK.nodeValue = ''; this.tRibN.nodeValue = ''; this.tRibS.nodeValue = '';
    this.tWord.nodeValue = ''; this.nWordSub.textContent = '';
    if (dropQueue) this._annQueue.length = 0;
  }

  _annNext() {
    const q = this._annQueue;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    while (q.length) {
      const it = q.shift();
      if (now - it.at > ANN_STALE) continue;        // no longer news
      this._annRun(it.kind, it.ms, it.play);
      return;
    }
  }

  /** Public: the centre of the screen belongs to whatever comes next (state change). */
  clearAnnounce() { this._annClear(true); }

  /* ======================================================================
   * CREST REVEAL  (big centred ribbon)
   * ====================================================================*/

  /** @param {object} def the crest def {id, name, type} being claimed */
  crestGet(def) {
    const d = def || {};
    const rec = d.id != null ? this._crestById.get(d.id) : null;
    if (rec && !rec.got) {
      rec.got = true;
      rec.node.set(true, true);
      rec.liPip.set(true, false);
      rec.li.classList.add('is-got');
      rec.liTxt.textContent = d.name ? String(d.name).toUpperCase() : (rec.name || prettyId(d.id));
    } else if (rec && d.name) {
      rec.liTxt.textContent = String(d.name).toUpperCase();
    }
    const n = this._countGot();
    const kick = d.type === 'boss' ? 'WARDEN FELLED' : d.type === 'race' ? 'RACE WON' : 'CREST CLAIMED';
    const name = d.name ? String(d.name).toUpperCase() : 'A CREST';
    const sub = n + ' OF ' + CRESTS + (n >= CRESTS ? ' · COURSE COMPLETE' : '');

    this._announce('crest', RIBBON_MS, () => {
      this.tRibK.nodeValue = kick;
      this.tRibN.nodeValue = name;
      this.tRibS.nodeValue = sub;
      this._annAnims.push(animateOnce(this.nRibbon, [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.82)', filter: 'blur(6px)', easing: UI_TOKENS.ease.spring },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', filter: 'blur(0)', offset: 0.14 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.01)', filter: 'blur(0)', offset: 0.82, easing: UI_TOKENS.ease.in },
        { opacity: 0, transform: 'translate(-50%,-52%) scale(1.04)', filter: 'blur(3px)' },
      ], { duration: RIBBON_MS, easing: 'linear', fill: 'forwards' }));
      this._annAnims.push(animateOnce(this.nRibbonEmblem, [
        { transform: 'rotate(-90deg) scale(.4)' },
        { transform: 'rotate(0) scale(1)' },
      ], { duration: 700, easing: UI_TOKENS.ease.spring }));
      return this.nRibbon;
    });

    /* peek the tally names so the player sees which slot just filled */
    this.expandCrests(true);
    clearTimeout(this._tallyTimer);
    this._tallyTimer = setTimeout(() => this.expandCrests(false), TALLY_PEEK_MS);
    this._c.crests = -1;
    uiRumble(this.game, 0.6, 0.9, 220);
  }

  /* ======================================================================
   * FLASHES
   * ====================================================================*/

  /** Full-screen ring wipe in the checkpoint colour + a CHECKPOINT wordmark. */
  checkpointFlash() {
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    const target = (Math.sqrt(w * w + h * h) / 100) * 1.15;

    this.nRing.style.borderColor = 'var(--cp)';
    this.nRing.style.boxShadow = '0 0 60px 6px var(--cp), inset 0 0 40px 2px var(--cp)';
    animateOnce(this.nRing, [
      { opacity: 0, transform: 'scale(.06)', borderWidth: '10px', easing: UI_TOKENS.ease.out },
      { opacity: 0.95, transform: 'scale(' + (target * 0.34).toFixed(2) + ')', borderWidth: '5px', offset: 0.26, easing: UI_TOKENS.ease.out },
      { opacity: 0, transform: 'scale(' + target.toFixed(2) + ')', borderWidth: '1px' },
    ], { duration: 900, easing: 'linear', fill: 'forwards' });

    this._announce('checkpoint', 900, () => {
      this.nWord.style.setProperty('--wc', 'var(--cp)');
      this.tWord.nodeValue = 'CHECKPOINT';
      this.nWordSub.textContent = 'PROGRESS KEPT';
      this._annAnims.push(animateOnce(this.nWord, [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1.22)', filter: 'blur(6px)', easing: UI_TOKENS.ease.out },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', filter: 'blur(0)', offset: 0.24 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.01)', filter: 'blur(0)', offset: 0.66, easing: UI_TOKENS.ease.in },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05)', filter: 'blur(2px)' },
      ], { duration: 900, easing: 'linear', fill: 'forwards' }));
      return this.nWord;
    });
    pulseClass(this.nCp, 'is-hit', 500);
    animateOnce(this.nCp, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.3 }, { transform: 'scale(1)' }],
      { duration: 480, easing: UI_TOKENS.ease.spring });
  }

  /** Edge-vignette pulse in the cause colour + the cause name. HUD dips out for the rewind. */
  deathFlash(cause) {
    const info = causeInfo(cause);
    const col = cssColor(info.color, '#ff5f4a');

    this.nVig.style.setProperty('--vc', col);
    animateOnce(this.nVig, [
      { opacity: 0 }, { opacity: 0.95, offset: 0.09 }, { opacity: 0.58, offset: 0.42 }, { opacity: 0 },
    ], { duration: 760, easing: 'linear', fill: 'forwards' });

    /* Dying outranks every other reveal: the queue is dropped, not deferred —
       a "CHECKPOINT" that lands during the rewind is no longer true. */
    this._annQueue.length = 0;
    this._announce('death', 760, () => {
      this.nWord.style.setProperty('--wc', col);
      this.tWord.nodeValue = info.label;
      this.nWordSub.textContent = '';
      this._annAnims.push(animateOnce(this.nWord, [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(.9)', filter: 'blur(5px)', easing: UI_TOKENS.ease.out },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.02)', filter: 'blur(0)', offset: 0.18 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.02)', filter: 'blur(0)', offset: 0.62, easing: UI_TOKENS.ease.in },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05)', filter: 'blur(3px)' },
      ], { duration: 760, easing: 'linear', fill: 'forwards' }));
      return this.nWord;
    });

    /* HUD dips for the 220 ms rewind + respawn (§28 budget ≤ 700 ms median). */
    for (const t of this._deathTimers) clearTimeout(t);
    this._deathTimers.length = 0;
    this._deathTimers.push(setTimeout(() => this.hideFor('death'), 60));
    this._deathTimers.push(setTimeout(() => this.showFor('death'), 520));
    this.clearToasts();
    uiRumble(this.game, 0.9, 0.5, 180);
  }

  /** Called by the game when the player is back in control (optional). */
  respawned() {
    for (const t of this._deathTimers) clearTimeout(t);
    this._deathTimers.length = 0;
    this.showFor('death');
  }

  /* ======================================================================
   * COURSE CLEAR PANEL  (STAY / RETURN TO KEEP)
   * ====================================================================*/

  /**
   * @param {object} summary {courseName, realmName, crestName, crestId, crests, crestsTotal,
   *                          crestIds:[{id,got}], timeMs, bestMs, prevBest, isRecord,
   *                          coins, coinsTotal, sigils, sigilsTotal, deaths, firstClear,
   *                          canStay, onChoice(choice)}
   * @returns {Promise<'stay'|'keep'>}  resolves with the player's choice.
   *   Routing: if summary.onChoice is a function it receives the choice and the
   *   uiAction router is NOT called; otherwise 'stay' → game.stayInCourse|afterClear|resume
   *   and 'keep' → game.returnToKeep(). The promise resolves either way.
   */
  courseClear(summary) {
    const s = summary || {};
    const c = this._c;
    /* The panel owns the screen now — a crest ribbon still fading behind it
       reads as ghost letters through the card. */
    this._annClear(true);
    const timeMs = s.timeMs != null ? Number(s.timeMs) : c.timeRaw;
    const prev = s.prevBest != null ? s.prevBest : (s.bestMs != null && s.bestMs < timeMs ? s.bestMs : null);
    const isRecord = s.isRecord != null ? !!s.isRecord : (prev == null || timeMs < prev);

    this.cKicker.textContent = s.kicker || (s.firstClear ? 'COURSE CLEAR' : 'CREST CLAIMED');
    this.cName.textContent = String(s.crestName || s.courseName || c.course || 'CREST');
    this.cRealmTxt.nodeValue = String(s.courseName && s.crestName ? s.courseName + ' · ' + (s.realmName || c.realm || '') : (s.realmName || c.realm || ''));

    /* crest pips: from the summary's crestIds, else the live tally */
    const ids = Array.isArray(s.crestIds) ? s.crestIds : null;
    for (let i = 0; i < this._clearPips.length; i++) {
      const got = ids ? !!(ids[i] && ids[i].got) : (this._crestPips[i] ? this._crestPips[i].got : false);
      this._clearPips[i].set(got, false);
    }

    const st = splitTime(timeMs);
    this.cTimeBig.textContent = st.main;
    this.cTimeMs.textContent = st.frac;
    if (prev != null && isFinite(prev)) {
      const d = timeMs - prev;
      this.cSplit.textContent = fmtSplit(d) + '  VS BEST';
      this.cSplit.className = 'ch-csplit ' + (d <= 0 ? 'ahead' : 'behind');
    } else {
      this.cSplit.textContent = s.firstClear ? 'FIRST CLEAR' : 'FIRST TIME';
      this.cSplit.className = 'ch-csplit';
    }
    this.cRecord.style.display = isRecord && prev != null ? '' : 'none';

    const crests = s.crests != null ? s.crests | 0 : this._countGot();
    const crestsTotal = s.crestsTotal != null ? s.crestsTotal | 0 : CRESTS;
    const coins = s.coins != null ? s.coins | 0 : Math.max(0, c.coins);
    /* ONE denominator everywhere: the crest threshold (100 unless the course
       authors its own), never the count of coins PLACED in the course — the
       clear panel used to print "0 / 121" beside a HUD chip reading "37 / 100". */
    const coinsTotal = this._coinsThreshold() || COINS_FOR_CREST;
    const sig = s.sigils != null ? s.sigils | 0 : Math.max(0, c.sigils);
    const sigTotal = s.sigilsTotal != null ? s.sigilsTotal | 0 : SIGILS;
    const deaths = s.deaths != null ? s.deaths | 0 : Math.max(0, c.deaths);

    const cell = (rec, total) => {
      rec.v.innerHTML = '';
      const n = document.createTextNode('0');
      rec.v.appendChild(n);
      if (total != null) { const sm = el('small'); sm.textContent = '/ ' + total; rec.v.appendChild(sm); }
      return n;
    };
    const nCrest = cell(this.cCrestCell, crestsTotal);
    const nCoin = cell(this.cCoinCell, coinsTotal);
    const nSig = cell(this.cSigilCell, sigTotal);
    const nDeath = cell(this.cDeathCell, null);
    if (this._cancelCount) { for (const f of this._cancelCount) f(); }
    this._cancelCount = [
      countUp(0, crests, 480, (v) => { nCrest.nodeValue = String(Math.round(v)); }),
      countUp(0, coins, 620, (v) => { nCoin.nodeValue = String(Math.round(v)); }),
      countUp(0, sig, 520, (v) => { nSig.nodeValue = String(Math.round(v)); }),
      countUp(0, deaths, 520, (v) => { nDeath.nodeValue = String(Math.round(v)); }),
    ];

    const canStay = s.canStay !== false;
    this.cBtnStay.style.display = canStay ? '' : 'none';
    this.cBtnKeep.classList.toggle('is-primary', !canStay);
    this._clearOnChoice = typeof s.onChoice === 'function' ? s.onChoice : null;

    /* show + staggered entrance */
    if (this._clearResolve) { const r = this._clearResolve; this._clearResolve = null; r('keep'); }
    const promise = new Promise((resolve) => { this._clearResolve = resolve; });
    this.nClear.classList.add('on');
    this._clearOpen = true;
    pushCapture(this.game);
    this.hideFor('clear');
    padNav.acquire(this._padHandler);

    animateOnce(this.nClear, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    animateOnce(this.nClearCard, [
      { opacity: 0, transform: 'translateY(26px) scale(.965)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 460, easing: UI_TOKENS.ease.spring });
    const stagger = [this.cKicker, this.cName, this.cRealm, this.cPips, this.cTime, this.cSplit, this.cRecord, this.cGrid, this.cBtns, this.cHint];
    for (let i = 0; i < stagger.length; i++) {
      animateOnce(stagger[i], [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 380, delay: 120 + i * 55, easing: UI_TOKENS.ease.out });
    }
    animateOnce(this.cRule, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 0.75 }],
      { duration: 560, delay: 200, easing: UI_TOKENS.ease.out });

    this.clearNav.refresh();
    this.clearNav.index = -1;
    this.clearNav.focusIndex(0, true);
    if (this._clearKeyHandler) window.removeEventListener('keydown', this._clearKeyHandler, true);
    this._clearKeyHandler = (e) => {
      if (!this._clearOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      if (this.clearNav.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', this._clearKeyHandler, true);
    /* no stinger here — Game.onCourseClear owns the audio (double-fire lesson from Ascendant) */
    return promise;
  }

  _onPadNav(name) {
    if (!this._clearOpen) return;
    if (name === 'back') { if (this.cBtnStay.style.display !== 'none') this._clearAction('stay'); return; }
    if (name === 'confirm') { uiSfx(this.game, 'ui_ok'); }
    this.clearNav.handleNav(name);
  }

  hideClear() {
    if (!this._clearOpen) return;
    this._clearOpen = false;
    padNav.release(this._padHandler);
    if (this._clearKeyHandler) { window.removeEventListener('keydown', this._clearKeyHandler, true); this._clearKeyHandler = null; }
    if (this._cancelCount) { for (const f of this._cancelCount) f(); this._cancelCount = null; }
    const a = animateOnce(this.nClear, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    const done = () => { if (!this._clearOpen) this.nClear.classList.remove('on'); };
    if (a) a.onfinish = done; else done();
    popCapture(this.game, false);
    this.showFor('clear');
  }

  _clearAction(which) {
    uiSfx(this.game, 'ui_ok');
    this.hideClear();
    const resolve = this._clearResolve; this._clearResolve = null;
    const cb = this._clearOnChoice; this._clearOnChoice = null;
    if (cb) { try { cb(which); } catch (e) { console.warn('[crestbound.hud] onChoice threw', e); } }
    else uiAction(this.game, which === 'keep' ? 'keep' : 'stay');
    if (resolve) resolve(which);
  }

  get clearOpen() { return this._clearOpen; }

  /* ======================================================================
   * TEARDOWN
   * ====================================================================*/

  dispose() {
    try { if (Settings && typeof Settings.off === 'function') Settings.off(this._onSettings); } catch (e) { /* ignore */ }
    if (this._clearKeyHandler) window.removeEventListener('keydown', this._clearKeyHandler, true);
    padNav.release(this._padHandler);
    for (const t of this._deathTimers) clearTimeout(t);
    clearTimeout(this._tallyTimer);
    this._annClear(true);
    this.clearToasts();
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.hud === this) UIRegistry.hud = null;
  }
}

export default HUD;
