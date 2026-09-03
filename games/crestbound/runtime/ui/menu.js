/* ============================================================================
 * CRESTBOUND — runtime/ui/menu.js
 * Title / pause / settings / controls / credits / confirm. Contract §27:
 *
 *   export class Menu { constructor(root, game); open(page); close(); isOpen; }
 *
 * plus `confirm(text) -> Promise<boolean>` (slice brief), used by NEW GAME and
 * QUIT TO TITLE so a destructive choice always passes through a real gate.
 *
 * DESIGN
 * ------
 * Every page is a storybook-glass panel over the LIVE render — the scrim is a
 * backdrop-filter blur, never an opaque plate, and the title page's scrim is a
 * soft left column only, so THE KEEP keeps turning behind the wordmark while
 * the player reads it. Nothing here looks like dat.gui: no native <input>, no
 * default browser buttons, no debug readouts. Widgets come from ui/style.js
 * (makeButton / makeSegmented / makeSlider / makeToggle / makeRow), all of which
 * carry `cb-btn`/`data-nav` and an `__activate()` so `loopcheck.py` can drive a
 * menu without synthesising pointer events.
 *
 * PAGES
 *   title     logo treatment, NEW GAME / CONTINUE / SETTINGS / CONTROLS / CREDITS
 *             + the run's totals (crests / courses cleared / deaths / time)
 *   pause     RESUME / RESTART COURSE / RETURN TO KEEP / SETTINGS / CONTROLS /
 *             QUIT TO TITLE, with the live course's stats in the header
 *   settings  quality · camera mode · sensitivity X/Y · invert X/Y · volumes ·
 *             timer · HUD scale · vibration · reduced motion — every row bound
 *             straight to core/settings.js and pushed into the live systems
 *   controls  the WHOLE moveset as a keyboard + gamepad glyph table; the rows
 *             that map to a real bindable action are rebindable in place
 *   credits   who made it and what it is made of
 *   confirm   a narrow yes/no gate that resolves a Promise
 *
 * NAVIGATION
 * ----------
 * One FocusList per page gives roving focus shared by mouse hover, keyboard and
 * gamepad (through the single shared `padNav` poller in style.js, which only
 * runs while a surface is open — zero cost during play). ESC backs out one
 * level, and from the pause page it resumes. The menu never writes
 * `input.suspended` itself: the game derives suspension from
 * `UIRegistry.anyOpen()` every frame (see style.js §10).
 * ==========================================================================*/

import { clamp } from '../core/util.js';
import { Settings, QUALITY_ORDER, CAM_MODES, RANGES } from '../core/settings.js';
import { Save } from '../core/save.js';
import { REALMS, COURSE_META, ALL_COURSE_IDS, CREST_TOTAL, COURSE_COUNT } from '../data/index.js';
import { codeLabel, DEFAULT_BINDINGS } from '../core/input.js';
import {
  injectStyles, UI_TOKENS, UIRegistry, el, fmtMs, fmtClock, makeButton, makeSegmented,
  makeSlider, makeToggle, makeRow, makeGlyphs, makeCrestPip, emblemSVG, animateOnce,
  FocusList, padNav, uiAction, uiSfx, pushCapture, popCapture, resolveInput, prettyId,
} from './style.js';

/** Shown on the title page and in the credits. Bump with the game, not the file. */
export const VERSION = '1.0.0';

/** Pages, in the order `open()` accepts them. */
export const PAGES = ['title', 'pause', 'settings', 'controls', 'credits', 'confirm'];

/**
 * A course's save record, or null when the player has never played it.
 * `Save.course(id)` no longer mints a record on read (that is what made a
 * virgin profile look like a saved game and put CONTINUE above NEW GAME), but
 * it returns a shared EMPTY record for an unknown id — null is what the callers
 * here want, so they can tell "never played" from "played and scored zero".
 * @returns {object|null}
 */
function savedCourse(id, known) {
  try {
    if (!id || !Save || typeof Save.course !== 'function') return null;
    const set = known || (typeof Save.courseIds === 'function' ? new Set(Save.courseIds()) : null);
    if (set && !set.has(String(id))) return null;
    return Save.course(id);
  } catch (e) { return null; }
}

/* ---------------------------------------------------------------------------
 * THE CONTROLS TABLE
 *
 * `action` names a bindable action in core/input.js (§4) — those rows rebind in
 * place. Rows without one are derived moves (the triple, the long jump, the wall
 * kick …): they are read-only, and their glyphs are COMPOSED FROM THE LIVE
 * BINDINGS, so re-binding CROUCH re-letters LONG JUMP too. `pad` is the glyph
 * spec for makeGlyphs() ('pad:A', 'kbd:SPACE', 'how:free text', '/' = or).
 * -------------------------------------------------------------------------*/
const CONTROL_GROUPS = [
  {
    title: 'MOVE',
    rows: [
      { action: 'moveForward', label: 'MOVE FORWARD', hint: 'Analog: stick magnitude sets the speed', pad: ['pad:LS', '/', 'pad:D-PAD'] },
      { action: 'moveBack', label: 'MOVE BACK', pad: ['pad:LS', '/', 'pad:D-PAD'] },
      { action: 'moveLeft', label: 'MOVE LEFT', pad: ['pad:LS', '/', 'pad:D-PAD'] },
      { action: 'moveRight', label: 'MOVE RIGHT', pad: ['pad:LS', '/', 'pad:D-PAD'] },
      { label: 'WALK / RUN', hint: 'Tap a key to walk, hold to run — a full stick is a full sprint',
        keys: ['how:STICK 15–55% WALKS'], pad: ['pad:LS'] },
      { label: 'PIVOT', hint: 'Reverse at speed and Nim plants a foot and turns instead of arcing',
        keys: ['how:REVERSE AT SPEED'], pad: ['pad:LS'] },
    ],
  },
  {
    title: 'JUMP FAMILY',
    rows: [
      { action: 'jump', label: 'JUMP', hint: 'Hold for height, release early to cut it short', pad: ['pad:A'] },
      { label: 'DOUBLE JUMP', hint: 'Jump again within a beat of landing, still moving',
        keysFrom: [['jump'], ['jump']], pad: ['pad:A', 'pad:A'] },
      { label: 'TRIPLE JUMP', hint: 'Third in the chain — a somersault, and the highest jump there is',
        keysFrom: [['jump'], ['jump'], ['jump']], pad: ['pad:A', 'pad:A', 'pad:A'] },
      { label: 'LONG JUMP', hint: 'Crouch and jump at a run: low, flat and very far',
        keysFrom: [['crouch'], ['jump']], pad: ['pad:B', 'pad:A'] },
      { label: 'BACKFLIP', hint: 'Crouch and jump from a standstill: straight up and back',
        keysFrom: [['crouch'], ['jump']], pad: ['pad:B', 'pad:A'] },
      { label: 'SIDEFLIP', hint: 'Flick the stick back at speed, then jump inside the window',
        keysFrom: [['moveBack'], ['jump']], pad: ['pad:LS', 'pad:A'] },
      { label: 'WALL KICK', hint: 'Jump the moment you touch a wall in mid-air; chain them up a shaft',
        keysFrom: [['jump']], pad: ['pad:A'] },
      { label: 'POUND JUMP', hint: 'Jump the instant a ground pound lands',
        keysFrom: [['jump']], pad: ['pad:A'] },
    ],
  },
  {
    title: 'GROUND & AIR',
    rows: [
      { action: 'dive', label: 'DIVE', hint: 'From a run or mid-air; land on your belly and slide', pad: ['pad:X'] },
      { label: 'SLIDE HOP', hint: 'Jump out of the belly slide to keep every metre of the speed',
        keysFrom: [['jump']], pad: ['pad:A'] },
      { action: 'crouch', label: 'CROUCH', hint: 'Lower profile; the start of the long jump and backflip', pad: ['pad:B'] },
      { action: 'pound', label: 'GROUND POUND', hint: 'Crouch in mid-air: hang, then drop hard. Breaks things.', pad: ['pad:B'] },
      { label: 'SWIM', hint: 'Jump strokes upward, crouch sinks, jump at the surface hops out',
        keysFrom: [['jump'], ['crouch']], pad: ['pad:A', 'pad:B'] },
      { label: 'CLIMB', hint: 'Press into a pole, net or tree; jump kicks away from it',
        keysFrom: [['moveForward'], ['jump']], pad: ['pad:LS', 'pad:A'] },
    ],
  },
  {
    title: 'CAMERA',
    rows: [
      { label: 'ORBIT', hint: 'Drag with the mouse, or use the right stick — it never fights you',
        keys: ['how:MOUSE DRAG'], pad: ['pad:RS'] },
      { action: 'orbitLeft', label: 'ORBIT LEFT', pad: ['pad:RS'] },
      { action: 'orbitRight', label: 'ORBIT RIGHT', pad: ['pad:RS'] },
      { action: 'orbitUp', label: 'ORBIT UP', pad: ['pad:RS'] },
      { action: 'orbitDown', label: 'ORBIT DOWN', pad: ['pad:RS'] },
      { action: 'recenter', label: 'RECENTER', hint: 'Swing the camera back behind Nim', pad: ['pad:RB', '/', 'pad:R3'] },
      { action: 'peek', label: 'PEEK', hint: 'Hold for a first-person look around', pad: ['pad:LB'] },
      { action: 'camToggle', label: 'CAMERA MODE', hint: 'Follow / free', pad: ['how:—'] },
    ],
  },
  {
    title: 'COURSE',
    rows: [
      { action: 'interact', label: 'INTERACT', hint: 'Paintings, doors, Old Fen', pad: ['pad:Y'] },
      { action: 'toCheckpoint', label: 'TO CHECKPOINT', hint: 'Warp back to the last checkpoint', pad: ['how:—'] },
      { action: 'restart', label: 'RESTART COURSE', pad: ['pad:BACK'] },
      { action: 'pause', label: 'PAUSE', pad: ['pad:START'] },
      { action: 'mute', label: 'MUTE', pad: ['how:—'] },
      { action: 'fullscreen', label: 'FULLSCREEN', pad: ['how:—'] },
    ],
  },
];

export class Menu {
  /**
   * @param {HTMLElement} root the #ui element
   * @param {object} game      the Game instance
   */
  constructor(root, game) {
    injectStyles();
    this.game = game || null;
    this.root = root || document.getElementById('ui') || document.body;

    this._open = false;
    this.page = null;
    this._back = 'title';            // where ESC goes from a sub-page
    this._listening = null;          // the control row capturing a key
    this._cancelCapture = null;      // Input.captureBinding's cancel fn
    this._bootWait = null;
    this._confirmResolve = null;
    this._confirmReturn = null;
    this._confirmWasOpen = false;
    this._padHandler = (n) => this._onPadNav(n);

    this.el = el('div', 'cb-menu cb-ui');
    this.el.appendChild(el('div', 'cm-scrim'));
    this.el.appendChild(el('div', 'cm-grain'));
    this.el.appendChild(el('div', 'cm-vig'));
    this.root.appendChild(this.el);

    this.pages = {};
    this.nav = {};

    this._buildTitle();
    this._buildPause();
    this._buildSettings();
    this._buildControls();
    this._buildCredits();
    this._buildConfirm();

    this._onKey = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKey, true);

    /* The ForgeFlow portal's control bar drives this when the page provides one. */
    try {
      if (!window.__PAUSE__) {
        window.__PAUSE__ = { toggle: () => { if (this._open) this.close(); else this.open('pause'); } };
      }
    } catch (e) { /* ignore */ }

    UIRegistry.menu = this;
  }

  /* ======================================================================
   * PAGE SCAFFOLD
   * ====================================================================*/

  _page(id, cls) {
    const p = el('div', 'cm-page ' + (cls || ''));
    this.el.appendChild(p);
    this.pages[id] = p;
    return p;
  }

  /**
   * A glass panel with head / scrolling body / footer legend.
   * `hints` is per page: a page only advertises the keys its widgets have (a
   * list of buttons has no ←→ ADJUST).
   */
  _panel(page, eyebrow, title, size, hints) {
    const panel = el('div', 'cm-panel cb-glass cb-plate' + (size ? ' ' + size : ''));
    const corners = el('div', 'cb-corners');
    for (let i = 0; i < 4; i++) corners.appendChild(el('i'));
    panel.appendChild(corners);

    const head = el('div', 'cm-head');
    const hl = el('div', 'h-l');
    const eb = el('div', 'cb-eyebrow h-eyebrow'); eb.textContent = eyebrow;
    const h2 = el('h2'); h2.textContent = title;
    hl.appendChild(eb); hl.appendChild(h2);
    const hr = el('div', 'h-r');
    head.appendChild(hl); head.appendChild(hr);

    const body = el('div', 'cm-body');
    const foot = el('div', 'cm-foot');
    const keys = el('div', 'keys');
    const hs = hints || [
      [['↑', '↓'], 'NAVIGATE'], [['←', '→'], 'ADJUST'], [['ENTER'], 'SELECT'], [['ESC'], 'BACK'],
    ];
    for (const [ks, label] of hs) {
      const span = el('span');
      for (const k of ks) { const b = el('b', 'cb-kbd'); b.textContent = k; span.appendChild(b); }
      span.appendChild(document.createTextNode(label));
      keys.appendChild(span);
    }
    const brand = el('div', 'brand');
    brand.textContent = 'CRESTBOUND';
    foot.appendChild(keys); foot.appendChild(brand);

    /* Action row between the scrolling body and the footer legend. A button
       parked at the end of `.cm-body` gets sliced by the scroll viewport's
       bottom edge — the credits BACK button was drawn 40% visible above the
       footer bar. Anything a page must always be able to press goes here. */
    const actions = el('div', 'cm-actions');
    actions.style.display = 'none';

    panel.appendChild(head); panel.appendChild(body); panel.appendChild(actions); panel.appendChild(foot);
    page.appendChild(panel);
    return { panel, head, hl, hr, h2, eyebrow: eb, body, actions, foot };
  }

  /** A header stat cell (pause page + title). */
  _hstat(host, key) {
    const s = el('div', 'cm-hstat');
    const kk = el('div', 'k'); kk.textContent = key;
    const vv = el('div', 'v'); vv.textContent = '—';
    s.appendChild(kk); s.appendChild(vv);
    host.appendChild(s);
    return { cell: s, v: vv };
  }

  /* ======================================================================
   * TITLE
   * ====================================================================*/

  _buildTitle() {
    const p = this._page('title', 'cm-title-page');
    const wrap = el('div', 'cm-title-wrap');

    const eb = el('div', 'cb-eyebrow cm-eyebrow');
    eb.textContent = 'FORGEFLOW GAMES';

    const logo = el('div', 'cm-logo');
    const emb = el('div', 'emb');
    emb.innerHTML = emblemSVG(112);
    const spin = el('div', 'spin');
    spin.innerHTML =
      '<svg viewBox="0 0 100 100"><polygon points="30,4 70,4 96,30 96,70 70,96 30,96 4,70 4,30" ' +
      'fill="none" stroke="#e9c36b" stroke-width="1.4" stroke-dasharray="5 9" opacity=".75"/></svg>';
    emb.appendChild(spin);
    const wordbox = el('div');
    const wm = el('div', 'cm-wordmark');
    wm.textContent = 'CRESTBOUND';
    const sub = el('div', 'cm-sub');
    sub.textContent = 'NIM AND THE HOLLOW KEEP';
    wordbox.appendChild(wm); wordbox.appendChild(sub);
    logo.appendChild(emb); logo.appendChild(wordbox);

    const rule = el('div', 'cm-rule');

    const list = el('div', 'cm-menu-list');
    this.tBtnNew = makeButton('NEW GAME', { primary: true, onClick: () => this._newGame() });
    this.tBtnCont = makeButton('CONTINUE', { onClick: () => this._continue() });
    this.tBtnSet = makeButton('SETTINGS', { onClick: () => { this._back = 'title'; this.open('settings'); } });
    this.tBtnCtl = makeButton('CONTROLS', { onClick: () => { this._back = 'title'; this.open('controls'); } });
    this.tBtnCred = makeButton('CREDITS', { onClick: () => { this._back = 'title'; this.open('credits'); } });
    for (const b of [this.tBtnNew, this.tBtnCont, this.tBtnSet, this.tBtnCtl, this.tBtnCred]) list.appendChild(b);

    wrap.appendChild(eb); wrap.appendChild(logo); wrap.appendChild(rule); wrap.appendChild(list);
    p.appendChild(wrap);
    this.titleWrap = wrap;
    this.titleList = list;

    const ver = el('div', 'cm-version');
    ver.innerHTML = '<b>V' + VERSION + '</b>';
    p.appendChild(ver);

    const stats = el('div', 'cm-title-stats');
    this.tStats = {};
    for (const k of ['CRESTS', 'COURSES', 'DEATHS', 'TIME']) {
      const s = el('div', 'cm-tstat');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v');
      if (k === 'CRESTS') { const pip = makeCrestPip(true); vv.appendChild(pip); }
      const t = document.createTextNode('—');
      vv.appendChild(t);
      s.appendChild(kk); s.appendChild(vv);
      stats.appendChild(s);
      this.tStats[k] = t;
    }
    p.appendChild(stats);

    const nav = new FocusList(list, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.title = nav;
  }

  _refreshTitle() {
    let totals = null;
    try { totals = Save && typeof Save.totals === 'function' ? Save.totals() : null; } catch (e) { totals = null; }
    const crests = totals ? totals.crests | 0 : 0;
    this.tStats.CRESTS.nodeValue = crests + ' / ' + CREST_TOTAL;
    this.tStats.COURSES.nodeValue = (totals ? totals.coursesCleared | 0 : 0) + ' / ' + COURSE_COUNT;
    this.tStats.DEATHS.nodeValue = String(totals ? totals.deaths | 0 : 0);
    this.tStats.TIME.nodeValue = totals && totals.timeMs ? fmtClock(totals.timeMs) : '—';

    const has = this._hasProgress();
    const target = this._continueTarget();
    this.tBtnCont.style.display = has ? '' : 'none';
    this.tBtnCont.setDisabled(!has);
    this.tBtnCont.setSub(has ? (target ? this._courseLabel(target) : 'THE KEEP') : '');
    this.tBtnNew.classList.toggle('is-primary', !has);
    this.tBtnCont.classList.toggle('is-primary', has);
    this.nav.title.refresh();
  }

  /** Display name for a course id, from the static meta (never loads a module). */
  _courseLabel(id) {
    const m = COURSE_META[id];
    return m ? m.name : prettyId(id);
  }

  _hasProgress() {
    try {
      const t = Save && typeof Save.totals === 'function' ? Save.totals() : null;
      if (!t) return false;
      return (t.crests | 0) > 0 || (t.coursesPlayed | 0) > 0 || (t.deaths | 0) > 0 || (t.timeMs | 0) > 0;
    } catch (e) { return false; }
  }

  /** The furthest unlocked course that is not yet cleared — where CONTINUE goes. */
  _continueTarget() {
    try {
      const total = Save && typeof Save.crestTotal === 'function' ? Save.crestTotal() | 0 : 0;
      const known = typeof Save.courseIds === 'function' ? new Set(Save.courseIds()) : null;
      let last = null;
      for (const id of ALL_COURSE_IDS) {
        const meta = COURSE_META[id];
        if (!meta || (meta.gateCrests | 0) > total) continue;
        last = id;
        const rec = savedCourse(id, known);
        if (!rec || !rec.cleared) return id;
      }
      return last;
    } catch (e) { return null; }
  }

  /** NEW GAME. Existing progress is erased only behind an explicit confirm. */
  _newGame() {
    uiSfx(this.game, 'ui_ok');
    const has = this._hasProgress();
    if (!has) { this._act('newGame'); return; }
    this.confirm('ERASE EVERY CREST, TIME AND COIN, AND START AGAIN FROM THE KEEP?', {
      title: 'NEW GAME', yes: 'ERASE AND START', no: 'KEEP MY PROGRESS', danger: true,
    }).then((ok) => {
      if (!ok) return;
      /* The game owns the wipe when it can (it may have caches to drop too). */
      const g = this.game;
      const owns = !!(g && (typeof g.newGame === 'function' || typeof g.startNewGame === 'function'));
      if (!owns) { try { Save.reset(); } catch (e) { /* ignore */ } }
      this._act('newGame');
    });
  }

  _continue() {
    const target = this._continueTarget();
    this._act('continue', target ? { courseId: target } : null);
  }

  /* ======================================================================
   * PAUSE
   * ====================================================================*/

  _buildPause() {
    const p = this._page('pause', 'cm-pause-page');
    const ui = this._panel(p, 'PAUSED', 'COURSE', null, [
      [['↑', '↓'], 'NAVIGATE'], [['ENTER'], 'SELECT'], [['ESC'], 'RESUME'],
    ]);
    this.pauseUI = ui;

    this.pStats = {};
    for (const k of ['CRESTS', 'COINS', 'TIME', 'DEATHS']) this.pStats[k] = this._hstat(ui.hr, k);

    const list = el('div', 'cm-list');
    this.pBtnResume = makeButton('RESUME', { primary: true, onClick: () => this._act('resume') });
    this.pBtnRestart = makeButton('RESTART COURSE', { onClick: () => this._act('restartCourse') });
    this.pBtnKeep = makeButton('RETURN TO KEEP', { onClick: () => this._act('keep') });
    this.pBtnSet = makeButton('SETTINGS', { onClick: () => { this._back = 'pause'; this.open('settings'); } });
    this.pBtnCtl = makeButton('CONTROLS', { onClick: () => { this._back = 'pause'; this.open('controls'); } });
    this.pBtnQuit = makeButton('QUIT TO TITLE', { danger: true, onClick: () => this._quitToTitle() });
    for (const b of [this.pBtnResume, this.pBtnRestart, this.pBtnKeep, this.pBtnSet, this.pBtnCtl, this.pBtnQuit]) {
      list.appendChild(b);
    }
    ui.body.appendChild(list);

    const nav = new FocusList(list, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.pause = nav;
  }

  _refreshPause() {
    const g = this.game || {};
    const def = (g.course && g.course.def) || null;
    const isKeep = !!(def && (def.isHub === true || def.id === 'keep'));
    const name = def ? String(def.name || prettyId(def.id)) : 'PAUSED';
    this.pauseUI.h2.textContent = name;

    let realmName = '';
    if (def && def.realm) {
      const r = REALMS.find((x) => x.id === def.realm);
      realmName = r ? r.name : prettyId(def.realm);
    }
    this.pauseUI.eyebrow.textContent = isKeep ? 'PAUSED · THE KEEP' : (realmName ? 'PAUSED · ' + realmName : 'PAUSED');

    const rec = def ? savedCourse(def.id) : null;
    const crestsHere = rec && Array.isArray(rec.crests) ? rec.crests.length : 0;
    /* LIVE run, not the save. TIME and DEATHS in this same row are the current
       run's; reading `coinsBest` here printed "0 / 100" while the player stood
       there holding 37. `game.coins` / `game.coinsGoal` are the single source
       the HUD chip and the clear panel read too. */
    const coinsNow = (this.game && typeof this.game.coins === 'number') ? this.game.coins | 0 : 0;
    const coinsGoal = (this.game && typeof this.game.coinsGoal === 'number' && this.game.coinsGoal > 0)
      ? this.game.coinsGoal | 0 : UI_TOKENS.counts.coins;

    this.pStats.CRESTS.v.textContent = isKeep
      ? (this._safeCrestTotal() + ' / ' + CREST_TOTAL)
      : (crestsHere + ' / ' + UI_TOKENS.counts.crests);
    this.pStats.COINS.v.textContent = isKeep ? '—' : (coinsNow + ' / ' + coinsGoal);
    this.pStats.TIME.v.textContent = g.timeMs != null ? fmtMs(g.timeMs) : '—';
    this.pStats.DEATHS.v.textContent = g.deaths != null ? String(g.deaths | 0) : '0';
    this.pStats.COINS.cell.style.display = isKeep ? 'none' : '';

    /* In the Keep there is no course to restart and nowhere to return to. */
    this.pBtnRestart.style.display = isKeep ? 'none' : '';
    this.pBtnKeep.style.display = isKeep ? 'none' : '';
    this.pBtnRestart.setSub(def && !isKeep ? String(def.name || def.id) : '');
    this.nav.pause.refresh();
  }

  _safeCrestTotal() {
    try { return Save && typeof Save.crestTotal === 'function' ? Save.crestTotal() | 0 : 0; }
    catch (e) { return 0; }
  }

  _quitToTitle() {
    uiSfx(this.game, 'ui_ok');
    this.confirm('LEAVE THE RUN AND GO BACK TO THE TITLE? YOUR CRESTS ARE SAVED.', {
      title: 'QUIT TO TITLE', yes: 'QUIT', no: 'STAY', danger: true,
    }).then((ok) => { if (ok) this._act('title'); });
  }

  /* ======================================================================
   * SETTINGS
   * ====================================================================*/

  _s() {
    try { return (Settings && typeof Settings.get === 'function' ? Settings.get() : null) || {}; }
    catch (e) { return {}; }
  }

  _set(patch) {
    try { if (Settings && typeof Settings.set === 'function') Settings.set(patch); } catch (e) { /* ignore */ }
    this._applyLive(patch);
  }

  /**
   * Push a change into the systems that do not subscribe to Settings themselves.
   * (HUD scale, timer visibility and reduced motion are the HUD's subscription;
   * Input mirrors sensitivity/invert/vibrate through its own store watcher — this
   * is belt and braces so a settings change is felt on the very next frame.)
   */
  _applyLive(patch) {
    const g = this.game || {};
    const s = this._s();
    try {
      if (('master' in patch || 'music' in patch || 'sfx' in patch) && g.audio && g.audio.setVolumes) {
        g.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
      }
    } catch (e) { /* ignore */ }
    try {
      if ('quality' in patch) {
        const q = s.quality;
        const eng = g.engine || g.eng;
        if (eng && eng.post && typeof eng.post.setQuality === 'function') eng.post.setQuality(q);
        if (eng && typeof eng.setQuality === 'function') eng.setQuality(q);
        if (g.fx && typeof g.fx.setQuality === 'function') g.fx.setQuality(q);
        if (g.fx && g.fx.particles && typeof g.fx.particles.setQuality === 'function') g.fx.particles.setQuality(q);
        if (g.hero && typeof g.hero.setQuality === 'function') g.hero.setQuality(q);
      }
    } catch (e) { /* ignore */ }
    try {
      const inp = resolveInput(g);
      if (inp && typeof inp.applySettings === 'function' &&
        ('camSensX' in patch || 'camSensY' in patch || 'invertX' in patch || 'invertY' in patch ||
          'gamepadVibrate' in patch)) {
        inp.applySettings(s);
      }
    } catch (e) { /* ignore */ }
    try {
      if ('camMode' in patch && g.cam && typeof g.cam.setMode === 'function') g.cam.setMode(s.camMode);
      else if ('camMode' in patch && g.cam) g.cam.mode = s.camMode;
    } catch (e) { /* ignore */ }
  }

  _buildSettings() {
    const p = this._page('settings', 'cm-settings-page');
    const ui = this._panel(p, 'OPTIONS', 'SETTINGS');
    this.settingsUI = ui;
    const s = this._s();

    const list = el('div', 'cm-list');
    const group = (t) => { const g = el('div', 'cm-group-title'); g.textContent = t; list.appendChild(g); };
    const R = RANGES || {};
    const rng = (k, d) => R[k] || d;

    /* --- display ------------------------------------------------------- */
    group('DISPLAY');
    const qKeys = Array.isArray(QUALITY_ORDER) && QUALITY_ORDER.length
      ? QUALITY_ORDER : ['low', 'medium', 'high', 'ultra'];
    this.cQuality = makeSegmented({
      options: qKeys.map((k) => ({ v: k, label: String(k).toUpperCase() })),
      value: s.quality || 'high',
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ quality: v }); },
    });
    list.appendChild(makeRow('QUALITY', 'Shadows, bloom, particles, grass and resolution', this.cQuality));

    const hs = rng('hudScale', { min: 0.8, max: 1.4, step: 0.05 });
    this.cHud = makeSlider({
      min: hs.min, max: hs.max, step: hs.step, value: clamp(Number(s.hudScale) || 1, hs.min, hs.max),
      format: (v) => Math.round(v * 100) + '%',
      onChange: (v) => this._set({ hudScale: v }),
    });
    list.appendChild(makeRow('HUD SCALE', null, this.cHud));

    this.cTimer = makeToggle({
      value: s.showTimer !== false,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ showTimer: v }); },
    });
    list.appendChild(makeRow('SHOW TIMER', 'Course clock and session clock', this.cTimer));

    this.cReduce = makeToggle({
      value: !!s.reduceMotion,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ reduceMotion: v }); },
    });
    list.appendChild(makeRow('REDUCED MOTION', 'Calms camera shake, screen pulses and speed lines', this.cReduce));

    /* --- camera --------------------------------------------------------- */
    group('CAMERA');
    const modes = Array.isArray(CAM_MODES) && CAM_MODES.length ? CAM_MODES : ['follow', 'free'];
    this.cCamMode = makeSegmented({
      options: modes.map((k) => ({ v: k, label: String(k).toUpperCase() })),
      value: s.camMode || 'follow',
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ camMode: v }); },
    });
    list.appendChild(makeRow('CAMERA MODE', 'Follow swings behind Nim; free stays where you put it', this.cCamMode));

    const sx = rng('camSensX', { min: 0.15, max: 4, step: 0.05 });
    this.cSensX = makeSlider({
      min: sx.min, max: sx.max, step: sx.step, value: clamp(Number(s.camSensX) || 1, sx.min, sx.max),
      format: (v) => v.toFixed(2),
      onChange: (v) => this._set({ camSensX: v }),
    });
    list.appendChild(makeRow('SENSITIVITY X', null, this.cSensX));

    const sy = rng('camSensY', { min: 0.15, max: 4, step: 0.05 });
    this.cSensY = makeSlider({
      min: sy.min, max: sy.max, step: sy.step, value: clamp(Number(s.camSensY) || 1, sy.min, sy.max),
      format: (v) => v.toFixed(2),
      onChange: (v) => this._set({ camSensY: v }),
    });
    list.appendChild(makeRow('SENSITIVITY Y', null, this.cSensY));

    this.cInvX = makeToggle({
      value: !!s.invertX,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ invertX: v }); },
    });
    list.appendChild(makeRow('INVERT X', null, this.cInvX));

    this.cInvY = makeToggle({
      value: !!s.invertY,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ invertY: v }); },
    });
    list.appendChild(makeRow('INVERT Y', null, this.cInvY));

    /* --- audio ---------------------------------------------------------- */
    group('AUDIO');
    const vol = (label, key, dflt, hint) => {
      const r = rng(key, { min: 0, max: 1, step: 0.05 });
      const c = makeSlider({
        min: r.min, max: r.max, step: r.step,
        value: clamp(s[key] != null ? Number(s[key]) : dflt, r.min, r.max),
        format: (v) => Math.round(v * 100) + '%',
        onChange: (v) => { const patch = {}; patch[key] = v; this._set(patch); },
      });
      list.appendChild(makeRow(label, hint || null, c));
      return c;
    };
    this.cMaster = vol('MASTER', 'master', 0.8);
    this.cMusic = vol('MUSIC', 'music', 0.6, 'The realm bed — every note is synthesised at runtime');
    this.cSfx = vol('EFFECTS', 'sfx', 0.9);

    /* --- controller ------------------------------------------------------ */
    group('CONTROLLER');
    this.cVibrate = makeToggle({
      value: s.gamepadVibrate !== false,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ gamepadVibrate: v }); },
    });
    list.appendChild(makeRow('VIBRATION', 'Rumble on landings, crests and hits', this.cVibrate));

    ui.body.appendChild(list);

    /* Action buttons live in the fixed row, NEVER at the end of the scrolling
       list: down there the panel's scroll viewport slices them in half against
       the footer legend, and a player who has not scrolled cannot reach BACK. */
    const reset = makeButton('RESET TO DEFAULTS', { onClick: () => this._resetSettings() });
    const back = makeButton('BACK', { primary: true, onClick: () => this._backOut() });
    ui.actions.style.display = '';
    ui.actions.appendChild(reset);
    ui.actions.appendChild(back);

    const nav = new FocusList(ui.panel, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.settings = nav;
  }

  _resetSettings() {
    uiSfx(this.game, 'ui_ok');
    try { if (Settings && typeof Settings.reset === 'function') Settings.reset(); } catch (e) { /* ignore */ }
    const s = this._s();
    this._applyLive(s);
    this._refreshSettings();
  }

  _refreshSettings() {
    const s = this._s();
    this.cQuality.set(s.quality || 'high');
    this.cHud.set(Number(s.hudScale) || 1);
    this.cTimer.set(s.showTimer !== false);
    this.cReduce.set(!!s.reduceMotion);
    this.cCamMode.set(s.camMode || 'follow');
    this.cSensX.set(Number(s.camSensX) || 1);
    this.cSensY.set(Number(s.camSensY) || 1);
    this.cInvX.set(!!s.invertX);
    this.cInvY.set(!!s.invertY);
    this.cMaster.set(s.master != null ? Number(s.master) : 0.8);
    this.cMusic.set(s.music != null ? Number(s.music) : 0.6);
    this.cSfx.set(s.sfx != null ? Number(s.sfx) : 0.9);
    this.cVibrate.set(s.gamepadVibrate !== false);
    this.nav.settings.refresh();
  }

  /* ======================================================================
   * CONTROLS  (the whole moveset; bindable rows rebind in place)
   * ====================================================================*/

  _buildControls() {
    const p = this._page('controls', 'cm-controls-page');
    const ui = this._panel(p, 'INPUT MAP', 'CONTROLS', 'wide', [
      [['↑', '↓'], 'NAVIGATE'], [['ENTER'], 'REBIND'], [['ESC'], 'BACK'],
    ]);
    this.controlsUI = ui;

    const head = el('div', 'cm-ctlhead');
    for (const t of ['MOVE / ACTION', 'KEYBOARD', 'CONTROLLER']) {
      const d = el('div'); d.textContent = t; head.appendChild(d);
    }
    ui.body.appendChild(head);

    const list = el('div', 'cm-list');
    this.ctlRows = [];
    for (const grp of CONTROL_GROUPS) {
      const gt = el('div', 'cm-group-title');
      gt.textContent = grp.title;
      list.appendChild(gt);
      for (const spec of grp.rows) {
        const row = el('div', 'cm-ctlrow');
        const nm = el('div', 'nm');
        nm.appendChild(document.createTextNode(spec.label));
        if (spec.hint) { const sm = el('small'); sm.textContent = spec.hint; nm.appendChild(sm); }
        const keys = el('div', 'keys');
        const pad = el('div', 'pad');
        pad.appendChild(makeGlyphs(spec.pad || ['how:—']));
        row.appendChild(nm); row.appendChild(keys); row.appendChild(pad);
        list.appendChild(row);

        const rec = { spec, node: row, keysEl: keys };
        if (spec.action) {
          row.setAttribute('data-nav', '1');
          row.tabIndex = -1;
          row.__activate = () => this._listen(rec);
          row.addEventListener('click', () => this._listen(rec));
        } else {
          row.setAttribute('data-nav-skip', '1');
          row.style.opacity = '.82';
        }
        this.ctlRows.push(rec);
      }
    }

    ui.body.appendChild(list);

    /* Same rule as settings: the page's actions sit in the fixed row. */
    const reset = makeButton('RESET TO DEFAULTS', { onClick: () => this._resetBindings() });
    const back = makeButton('BACK', { primary: true, onClick: () => this._backOut() });
    ui.actions.style.display = '';
    ui.actions.appendChild(reset);
    ui.actions.appendChild(back);

    const nav = new FocusList(ui.panel, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.controls = nav;
  }

  /** The live Input, or null (the page still renders the defaults, read-only). */
  _input() {
    const inp = resolveInput(this.game);
    return inp && inp.bindings ? inp : null;
  }

  /** Pretty label for slot `slot` of a bindable action, live or default. */
  _bindLabel(action, slot) {
    const inp = this._input();
    if (inp) {
      if (typeof inp.bindingLabel === 'function') {
        const s = inp.bindingLabel(action, slot);
        return s === '—' ? '' : s;
      }
      const list = inp.bindings[action];
      if (Array.isArray(list) && list[slot]) return codeLabel(list[slot]);
      return '';
    }
    const d = DEFAULT_BINDINGS[action];
    return Array.isArray(d) && d[slot] ? codeLabel(d[slot]) : '';
  }

  /** Repaint every keyboard cell (cheap: only runs on open / rebind). */
  _paintBindings() {
    const canBind = !!this._input();
    for (const rec of this.ctlRows) {
      const spec = rec.spec;
      const keys = rec.keysEl;
      keys.textContent = '';

      if (spec.action) {
        rec.node.setAttribute('data-nav-skip', canBind ? '0' : '1');
        if (this._listening === rec) {
          const k = el('b', 'cb-kbd is-listening');
          k.textContent = 'PRESS A KEY';
          keys.appendChild(k);
        } else {
          const a = this._bindLabel(spec.action, 0);
          const b = this._bindLabel(spec.action, 1);
          if (!a && !b) {
            const k = el('b', 'cb-kbd is-empty'); k.textContent = 'NONE'; keys.appendChild(k);
          } else {
            if (a) { const k = el('b', 'cb-kbd'); k.textContent = a; keys.appendChild(k); }
            if (b) { const k = el('b', 'cb-kbd'); k.textContent = b; keys.appendChild(k); }
          }
        }
        rec.node.classList.toggle('is-listening', this._listening === rec);
        continue;
      }

      /* Derived move: compose the glyphs out of the LIVE bindings so rebinding
         CROUCH re-letters LONG JUMP as well. */
      if (spec.keysFrom) {
        const parts = [];
        for (let i = 0; i < spec.keysFrom.length; i++) {
          const label = this._bindLabel(spec.keysFrom[i][0], 0) || '—';
          parts.push('kbd:' + label);
        }
        keys.appendChild(makeGlyphs(parts));
      } else if (spec.keys) {
        keys.appendChild(makeGlyphs(spec.keys));
      } else {
        const k = el('span', 'how'); k.textContent = '—'; keys.appendChild(k);
      }
    }
    if (this.nav.controls) this.nav.controls.refresh(true);
  }

  /** Start (or cancel) a rebind capture on a row. */
  _listen(rec) {
    if (this._listening === rec) { this._cancelListen(); return; }
    this._cancelListen();
    const inp = this._input();
    if (!inp || typeof inp.captureBinding !== 'function') return;
    this._listening = rec;
    uiSfx(this.game, 'ui_move');
    this._paintBindings();
    this._cancelCapture = inp.captureBinding(rec.spec.action, 0, (code) => {
      this._cancelCapture = null;
      this._listening = null;
      uiSfx(this.game, code ? 'ui_ok' : 'ui_back');
      this._paintBindings();
    });
  }

  _cancelListen() {
    const c = this._cancelCapture;
    this._cancelCapture = null;
    this._listening = null;
    if (c) { try { c(); } catch (e) { /* ignore */ } }
  }

  _resetBindings() {
    uiSfx(this.game, 'ui_ok');
    this._cancelListen();
    const inp = this._input();
    if (inp && typeof inp.resetBindings === 'function') inp.resetBindings();
    this._paintBindings();
  }

  /* ======================================================================
   * CREDITS
   * ====================================================================*/

  _buildCredits() {
    const p = this._page('credits', 'cm-credits-page');
    const ui = this._panel(p, 'CRESTBOUND', 'CREDITS', null, [
      [['↑', '↓'], 'NAVIGATE'], [['ENTER'], 'SELECT'], [['ESC'], 'BACK'],
    ]);
    const body = el('div', 'cm-credits');
    const block = (k, v) => {
      const b = el('div', 'c-block');
      const kk = el('div', 'c-k'); kk.textContent = k;
      const vv = el('div', 'c-v'); vv.innerHTML = v;
      b.appendChild(kk); b.appendChild(vv);
      body.appendChild(b);
    };
    block('THE GAME',
      '<b>CRESTBOUND</b> — Nim goes looking for seven crests in every course of a Keep ' +
      'that has lost most of them.<br>' +
      REALMS.map((r) => r.name).join(' · '));
    block('BUILT WITH',
      'Three.js r172 · WebGL 2 · Web Audio<br>' +
      'ES modules, no build step. Every mesh, material, sound and note is generated at runtime.');
    block('MOVEMENT',
      'Asymmetric gravity so a jump rises slowly and falls fast, analog speed from the stick, ' +
      'a three-jump chain, the long jump, the backflip, the sideflip, the wall kick, the dive ' +
      'and the ground pound — coyote time and jump buffering underneath all of it.');
    block('DETERMINISM',
      'Every hazard is a pure function of the course clock, so the same room always presents the ' +
      'same phase after a death. Learnable, never lucky.');
    block('MUSIC & SOUND',
      'Fully procedural. One bed per realm, crossfaded on entry, with an intensity layer that ' +
      'follows what is trying to kill you.');
    block('STUDIO', '<b>ForgeFlow Games</b><br>Version ' + VERSION);
    ui.body.appendChild(body);

    /* In the fixed action row, never at the end of the scrolling body. */
    const back = makeButton('BACK', { primary: true, onClick: () => this._backOut() });
    ui.actions.style.display = '';
    ui.actions.appendChild(back);

    const nav = new FocusList(ui.panel, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.credits = nav;
  }

  /* ======================================================================
   * CONFIRM
   * ====================================================================*/

  _buildConfirm() {
    const p = this._page('confirm', 'cm-confirm-page');
    const ui = this._panel(p, 'CONFIRM', 'ARE YOU SURE', 'narrow', [
      [['←', '→'], 'SELECT'], [['ENTER'], 'CONFIRM'], [['ESC'], 'CANCEL'],
    ]);
    this.confirmUI = ui;
    this.nConfirmText = el('div', 'cm-confirm-text');
    const btns = el('div', 'cm-confirm-btns');
    this.cfYes = makeButton('YES', { primary: true, centered: true, onClick: () => this._resolveConfirm(true) });
    this.cfNo = makeButton('NO', { centered: true, onClick: () => this._resolveConfirm(false) });
    btns.appendChild(this.cfNo); btns.appendChild(this.cfYes);
    ui.body.appendChild(this.nConfirmText);
    ui.body.appendChild(btns);

    const nav = new FocusList(btns, { columns: 2, wrap: true, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.confirm = nav;
  }

  /**
   * A modal yes/no gate.
   * @param {string} text the question, in the player's words
   * @param {{title?:string, yes?:string, no?:string, danger?:boolean, defaultYes?:boolean}} [opts]
   * @returns {Promise<boolean>}
   */
  confirm(text, opts) {
    const o = opts || {};
    /* A second confirm while one is up answers the first with `false`. */
    if (this._confirmResolve) { const r = this._confirmResolve; this._confirmResolve = null; r(false); }

    this.confirmUI.h2.textContent = String(o.title || 'ARE YOU SURE');
    this.confirmUI.eyebrow.textContent = 'CONFIRM';
    this.nConfirmText.textContent = String(text == null ? '' : text);
    this.cfYes.setLabel(String(o.yes || 'YES'));
    this.cfNo.setLabel(String(o.no || 'NO'));
    /* On a destructive gate the SAFE answer wears the primary gold and the
       destructive one wears the danger outline — the eye must not be led to it. */
    this.cfYes.classList.toggle('is-danger', !!o.danger);
    this.cfYes.classList.toggle('is-primary', !o.danger);
    this.cfNo.classList.toggle('is-primary', !!o.danger);

    this._confirmWasOpen = this._open;
    this._confirmReturn = this._open ? this.page : null;
    const p = new Promise((resolve) => { this._confirmResolve = resolve; });
    this.open('confirm');
    /* The safe answer is focused first — a mashed ENTER never erases a save. */
    const nav = this.nav.confirm;
    nav.refresh(); nav.index = -1; nav.focusIndex(o.defaultYes ? 1 : 0, true);
    return p;
  }

  _resolveConfirm(v) {
    uiSfx(this.game, v ? 'ui_ok' : 'ui_back');
    const r = this._confirmResolve;
    this._confirmResolve = null;
    const back = this._confirmReturn;
    const wasOpen = this._confirmWasOpen;
    this._confirmReturn = null;
    if (wasOpen && back && back !== 'confirm') this.open(back);
    else this.close();
    if (r) r(!!v);
  }

  /* ======================================================================
   * OPEN / CLOSE
   * ====================================================================*/

  get isOpen() { return this._open; }

  /** @param {'title'|'pause'|'settings'|'controls'|'credits'|'confirm'} page */
  open(page) {
    const id = this.pages[page] ? page : 'title';
    const wasOpen = this._open;

    if (!wasOpen) {
      this._open = true;
      pushCapture(this.game);
      padNav.acquire(this._padHandler);
      if (UIRegistry.hud && typeof UIRegistry.hud.hideFor === 'function') UIRegistry.hud.hideFor('menu');
      this.el.classList.add('on');
    }

    for (const k in this.pages) this.pages[k].classList.toggle('on', k === id);
    this.el.classList.toggle('is-title', id === 'title');
    this.el.classList.toggle('is-confirm', id === 'confirm');
    this.page = id;
    if (id !== 'controls') this._cancelListen();

    if (id === 'title') this._refreshTitle();
    else if (id === 'pause') this._refreshPause();
    else if (id === 'settings') this._refreshSettings();
    else if (id === 'controls') this._paintBindings();

    const nav = this.nav[id];
    if (nav && id !== 'confirm') { nav.refresh(); nav.index = -1; nav.focusIndex(0, true); }
    /* focusIndex() scrolls the focused item into view; when a page's only nav
       item is the BACK button at the bottom (credits, or controls with no live
       Input) that would open the page scrolled to its end. Always show the top. */
    const body = this.pages[id] ? this.pages[id].querySelector('.cm-body') : null;
    if (body) body.scrollTop = 0;

    /* Boot handoff: game.boot() opens the title while #boot still covers the
       screen. Revealing now would double-expose two CRESTBOUND lockups and burn
       the staggered entrance behind the splash — so hold the menu invisible and
       play the entrance the moment the splash has faded. */
    if (this._deferForBoot()) return;
    this._reveal(id);
  }

  _reveal(id) {
    this.el.classList.remove('cb-gone');
    animateOnce(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    this._animateIn(id);
    uiSfx(this.game, 'ui_ok');
  }

  /** True while #boot is still covering the screen; queues the reveal for after. */
  _deferForBoot() {
    let boot = null;
    try { boot = document.getElementById('boot'); } catch (e) { boot = null; }
    const covering = !!(boot && boot.parentNode && boot.classList && !boot.classList.contains('gone'));
    if (!covering) { this._cancelBootWait(); return false; }
    this.el.classList.add('cb-gone');
    if (this._bootWait) return true;
    const fire = () => {
      if (!this._bootWait) return;
      this._cancelBootWait();
      if (!this._open) return;
      this._reveal(this.page);
    };
    const onEnd = (ev) => { if (ev.target === boot && ev.propertyName === 'opacity') fire(); };
    boot.addEventListener('transitionend', onEnd);
    const timer = setInterval(() => {
      try {
        if (!boot.parentNode || parseFloat(getComputedStyle(boot).opacity) <= 0.02) fire();
      } catch (e) { fire(); }
    }, 120);
    this._bootWait = { boot, onEnd, timer };
    return true;
  }

  _cancelBootWait() {
    const w = this._bootWait;
    if (!w) return;
    this._bootWait = null;
    try { w.boot.removeEventListener('transitionend', w.onEnd); } catch (e) { /* ignore */ }
    clearInterval(w.timer);
  }

  _animateIn(id) {
    const p = this.pages[id];
    if (!p) return;
    if (id === 'title') {
      const kids = [this.titleWrap.children[0], this.titleWrap.children[1], this.titleWrap.children[2]];
      for (let i = 0; i < kids.length; i++) {
        if (!kids[i]) continue;
        animateOnce(kids[i], [
          { opacity: 0, transform: 'translateX(-24px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ], { duration: 540, delay: i * 80, easing: UI_TOKENS.ease.out });
      }
      const b = this.titleList.children;
      for (let i = 0; i < b.length; i++) {
        animateOnce(b[i], [
          { opacity: 0, transform: 'translateX(-18px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ], { duration: 400, delay: 280 + i * 60, easing: UI_TOKENS.ease.out });
      }
      return;
    }
    const panel = p.querySelector('.cm-panel');
    if (panel) {
      animateOnce(panel, [
        { opacity: 0, transform: 'translate(-50%,-50%) translateY(22px) scale(.972)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translateY(0) scale(1)' },
      ], { duration: 360, easing: UI_TOKENS.ease.spring });
    }
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this._cancelListen();
    this._cancelBootWait();
    padNav.release(this._padHandler);
    /* A pending confirm must never outlive its dialog. */
    if (this._confirmResolve) { const r = this._confirmResolve; this._confirmResolve = null; r(false); }
    const a = animateOnce(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    const done = () => {
      if (!this._open) { this.el.classList.remove('on'); this.el.classList.remove('cb-gone'); }
    };
    if (a) a.onfinish = done; else done();
    if (UIRegistry.hud && typeof UIRegistry.hud.showFor === 'function') UIRegistry.hud.showFor('menu');
    const g = this.game;
    const playing = !g || g.state === 'playing' || g.state === 'keep' || g.state === undefined;
    popCapture(g, playing);
  }

  /** Re-read save + settings for the page that is currently up. */
  refresh() {
    if (!this._open) return;
    if (this.page === 'title') this._refreshTitle();
    else if (this.page === 'pause') this._refreshPause();
    else if (this.page === 'settings') this._refreshSettings();
    else if (this.page === 'controls') this._paintBindings();
  }

  _backOut() {
    uiSfx(this.game, 'ui_back');
    const back = this._back === 'pause' && this.pages.pause ? 'pause' : 'title';
    this.open(back);
  }

  _act(action, payload) {
    uiSfx(this.game, 'ui_ok');
    uiAction(this.game, action, payload);
  }

  /* ======================================================================
   * KEYBOARD + GAMEPAD
   * ====================================================================*/

  _handleKey(e) {
    if (!this._open) return;
    /* A course card or the clear panel on top owns the keyboard. */
    if (UIRegistry.card && UIRegistry.card.isOpen) return;
    if (UIRegistry.hud && UIRegistry.hud.clearOpen) return;
    /* Input.captureBinding() owns every key while a rebind is listening. */
    if (this._listening) return;

    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      this._escape();
      return;
    }
    const nav = this.nav[this.page];
    if (nav && nav.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
  }

  _escape() {
    if (this.page === 'confirm') { this._resolveConfirm(false); return; }
    if (this.page === 'pause') { uiSfx(this.game, 'ui_back'); uiAction(this.game, 'resume'); this.close(); return; }
    if (this.page === 'title') return;    // nowhere further back
    this._backOut();
  }

  _onPadNav(name) {
    if (!this._open) return;
    if (UIRegistry.card && UIRegistry.card.isOpen) return;
    if (UIRegistry.hud && UIRegistry.hud.clearOpen) return;
    if (this._listening) return;
    if (name === 'back') { this._escape(); return; }
    if (name === 'start') {
      if (this.page === 'pause') { uiSfx(this.game, 'ui_back'); uiAction(this.game, 'resume'); this.close(); return; }
      name = 'confirm';
    }
    const nav = this.nav[this.page];
    if (nav) nav.handleNav(name);
  }

  /* ======================================================================
   * TEARDOWN
   * ====================================================================*/

  dispose() {
    this._cancelListen();
    this._cancelBootWait();
    padNav.release(this._padHandler);
    window.removeEventListener('keydown', this._onKey, true);
    if (this._confirmResolve) { const r = this._confirmResolve; this._confirmResolve = null; r(false); }
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.menu === this) UIRegistry.menu = null;
  }
}

export default Menu;
