/* ============================================================================
 * ASCENDANT — runtime/ui/menu.js
 * Title / pause / settings / controls / credits.  Contract §20:
 *   export class Menu { constructor(root, game); open(page); close(); isOpen; }
 *
 * The 3D scene keeps rendering behind every page — the scrim is a
 * backdrop-filter blur + darken, never an opaque plate.
 * ==========================================================================*/

import { clamp } from '../core/util.js';
import { Settings, QUALITY } from '../core/settings.js';
import { Save } from '../core/save.js';
import { WORLDS, stageNumbering } from '../data/index.js';
import {
  injectStyles, UI_TOKENS, UIRegistry, el, fmtMs, makeButton, makeSegmented,
  makeSlider, makeToggle, makeRow, animateOnce, FocusList, uiAction, uiSfx,
  pushCapture, popCapture, resolveInput,
} from './style.js';

export const VERSION = '1.0.0';
const BIND_KEY = 'ascendant.bindings';

/* --- action table: label, binding aliases, defaults, controller glyph ---- */
const ACTIONS = [
  { id: 'forward', label: 'MOVE FORWARD', alias: ['forward', 'moveForward', 'up', 'w'], def: ['KeyW', 'ArrowUp'], pad: 'LEFT STICK' },
  { id: 'back', label: 'MOVE BACK', alias: ['back', 'backward', 'moveBack', 'down', 's'], def: ['KeyS', 'ArrowDown'], pad: 'LEFT STICK' },
  { id: 'left', label: 'STRAFE LEFT', alias: ['left', 'moveLeft', 'strafeLeft', 'a'], def: ['KeyA', 'ArrowLeft'], pad: 'LEFT STICK' },
  { id: 'right', label: 'STRAFE RIGHT', alias: ['right', 'moveRight', 'strafeRight', 'd'], def: ['KeyD', 'ArrowRight'], pad: 'LEFT STICK' },
  { id: 'jump', label: 'JUMP', alias: ['jump', 'space'], def: ['Space'], pad: 'A / CROSS' },
  { id: 'sprint', label: 'SPRINT', alias: ['sprint', 'run', 'shift'], def: ['ShiftLeft'], pad: 'L1 / LB' },
  { id: 'crouch', label: 'CROUCH / SLIDE', alias: ['crouch', 'slide', 'ctrl'], def: ['ControlLeft', 'KeyC'], pad: 'B / CIRCLE' },
  { id: 'interact', label: 'INTERACT', alias: ['interact', 'use', 'e'], def: ['KeyE'], pad: 'X / SQUARE' },
  { id: 'restart', label: 'RESTART STAGE', alias: ['restart', 'reset', 'r'], def: ['KeyR'], pad: 'Y / TRIANGLE' },
  { id: 'pause', label: 'PAUSE / BACK', alias: ['pause', 'menu', 'escape'], def: ['Escape'], pad: 'START' },
];

/* Pretty names for KeyboardEvent.code */
const KEY_NAMES = {
  Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP',
  ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL',
  AltLeft: 'L ALT', AltRight: 'R ALT', CapsLock: 'CAPS',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
function keyName(code) {
  if (!code) return '';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code.toUpperCase();
}

export class Menu {
  constructor(root, game) {
    injectStyles();
    this.game = game || null;
    this.root = root || document.getElementById('ui') || document.body;

    this._open = false;
    this.page = null;
    this._back = 'title';
    this._listening = null;
    this._bootWait = null;

    this.el = el('div', 'asc-menu asc-ui');
    this.el.appendChild(el('div', 'am-scrim'));
    this.el.appendChild(el('div', 'am-grain'));
    this.el.appendChild(el('div', 'am-vig'));
    this.root.appendChild(this.el);

    this.pages = {};
    this.nav = {};

    this._buildTitle();
    this._buildPause();
    this._buildSettings();
    this._buildControls();
    this._buildCredits();

    this._onKey = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKey, true);

    /* the ForgeFlow page control bar drives this when present */
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
    const p = el('div', 'am-page ' + (cls || ''));
    this.el.appendChild(p);
    this.pages[id] = p;
    return p;
  }

  /** A glass panel page with a head / scrolling body / footer.
   *  `hints` is the per-page footer key legend — a page only advertises the
   *  controls its widgets actually have (a button list has no ←→ ADJUST). */
  _panel(page, eyebrow, title, wide, hints) {
    const panel = el('div', 'am-panel asc-glass asc-scan' + (wide ? ' wide' : ''));
    const head = el('div', 'am-head');
    const hl = el('div', 'h-l');
    const eb = el('div', 'h-eyebrow'); eb.textContent = eyebrow;
    const h2 = el('h2'); h2.textContent = title;
    hl.appendChild(eb); hl.appendChild(h2);
    const hr = el('div', 'h-r');
    head.appendChild(hl); head.appendChild(hr);
    const body = el('div', 'am-body');
    const foot = el('div', 'am-foot');
    const keys = el('div', 'keys');
    const hs = hints || [
      [['↑', '↓'], 'NAVIGATE'], [['←', '→'], 'ADJUST'],
      [['ENTER'], 'SELECT'], [['ESC'], 'BACK'],
    ];
    keys.innerHTML = hs.map(([ks, label]) =>
      '<span>' + ks.map((k) => '<b class="asc-kbd">' + k + '</b>').join('') + label + '</span>'
    ).join('');
    const brand = el('div');
    brand.textContent = 'ASCENDANT';
    foot.appendChild(keys); foot.appendChild(brand);
    panel.appendChild(head); panel.appendChild(body); panel.appendChild(foot);
    page.appendChild(panel);
    return { panel, head, hl, hr, h2, eyebrow: eb, body, foot };
  }

  /* ======================================================================
   * TITLE
   * ====================================================================*/

  _buildTitle() {
    const p = this._page('title', 'am-title');
    const wrap = el('div', 'am-title-wrap');

    const eb = el('div', 'am-eyebrow');
    eb.textContent = 'FORGEFLOW GAMES';
    const wm = el('div', 'am-wordmark');
    wm.textContent = 'ASCENDANT';
    const sub = el('div', 'am-sub');
    sub.textContent = 'PARKOUR TRIALS';
    const rule = el('div', 'am-rule');

    const list = el('div', 'am-menu-list');
    this.tBtnPlay = makeButton('PLAY', { primary: true, onClick: () => this._act('play') });
    this.tBtnCont = makeButton('CONTINUE', { onClick: () => this._act('continue', this._continueTarget()) });
    this.tBtnSel = makeButton('STAGE SELECT', { onClick: () => this._act('stageSelect') });
    this.tBtnSet = makeButton('SETTINGS', { onClick: () => { this._back = 'title'; this.open('settings'); } });
    this.tBtnCtl = makeButton('CONTROLS', { onClick: () => { this._back = 'title'; this.open('controls'); } });
    this.tBtnCred = makeButton('CREDITS', { onClick: () => { this._back = 'title'; this.open('credits'); } });
    for (const b of [this.tBtnPlay, this.tBtnCont, this.tBtnSel, this.tBtnSet, this.tBtnCtl, this.tBtnCred]) {
      list.appendChild(b);
    }

    wrap.appendChild(eb); wrap.appendChild(wm); wrap.appendChild(sub);
    wrap.appendChild(rule); wrap.appendChild(list);
    p.appendChild(wrap);

    /* version only — the middleware readout ("THREE R172 · WEBGL 2") was
       debug-overlay smell, not player information */
    const ver = el('div', 'am-version');
    ver.innerHTML = '<b>V' + VERSION + '</b>';
    p.appendChild(ver);

    /* Same stat vocabulary as stage select: CLEARED / MEDALS / DEATHS / TIME. */
    const stats = el('div', 'am-title-stats');
    this.tStats = {};
    for (const k of ['CLEARED', 'MEDALS', 'DEATHS', 'TIME']) {
      const s = el('div', 'am-tstat');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v'); vv.textContent = '—';
      s.appendChild(kk); s.appendChild(vv);
      stats.appendChild(s);
      this.tStats[k] = vv;
    }
    p.appendChild(stats);
    this.titleWrap = wrap;

    const nav = new FocusList(list, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.title = nav;
  }

  _refreshTitle() {
    const sel = UIRegistry.stageSelect;
    if (sel && typeof sel.preload === 'function' && !this._preloaded) {
      this._preloaded = true;
      sel.preload().then(() => { if (this.page === 'title') this._refreshTitle(); }).catch(() => {});
    }
    let totals = null;
    try { totals = Save && typeof Save.totals === 'function' ? Save.totals() : null; } catch (e) { totals = null; }

    /* CLEARED counts GLOBAL stages (one checkpoint segment = one stage) from
       stageNumbering() — the SAME source stage select uses, so the front door
       and the grid can never disagree ("0 / 101", not "0 / 12"). Falls back
       to level counts only until the numbering has loaded (the preload above
       re-runs this refresh the moment it lands). */
    let num = null;
    try { num = typeof stageNumbering === 'function' ? stageNumbering() : null; } catch (e) { num = null; }
    if (num && num.total) {
      let seg = 0;
      try {
        for (const [id, e] of num.perStage) {
          const st = Save.stage(id);
          if (st && st.cleared) seg += e.segments;
          else seg += Math.min(Math.max(0, st ? st.cpIndex | 0 : 0), e.segments - 1);
        }
      } catch (e) { seg = 0; }
      this.tStats.CLEARED.textContent = seg + ' / ' + num.total;
    } else {
      let stageCount = 0;
      try { for (const w of WORLDS || []) stageCount += (w.stages || []).length; } catch (e) { /* ignore */ }
      this.tStats.CLEARED.textContent = ((totals && totals.cleared) | 0) + ' / ' + stageCount;
    }

    /* MEDALS needs the stage defs (par times) — stage select owns that cache. */
    let medals = null;
    try {
      medals = sel && typeof sel.medalCount === 'function' ? sel.medalCount() : null;
    } catch (e) { medals = null; }
    this.tStats.MEDALS.textContent = medals == null ? '—' : String(medals);

    if (totals) {
      this.tStats.DEATHS.textContent = String(totals.deaths | 0);
      this.tStats.TIME.textContent = totals.timeMs ? fmtMs(totals.timeMs) : '—';
    }

    const target = this._continueTarget();
    const has = this._hasProgress();
    this.tBtnCont.setDisabled(!has || !target);
    this.tBtnCont.style.display = has && target ? '' : 'none';
    if (target && target.stageId) this.tBtnCont.setSub(this._stageLabel(target.stageId));
    this.tBtnPlay.setLabel(has ? 'PLAY' : 'NEW RUN');
    this.nav.title.refresh();
  }

  /** Display name for a stage id — real name when the defs are cached. */
  _stageLabel(id) {
    const sel = UIRegistry.stageSelect;
    if (sel && typeof sel.stageName === 'function') {
      const n = sel.stageName(id);
      if (n) return String(n).toUpperCase();
    }
    return String(id).replace(/[-_]/g, ' ').toUpperCase();
  }

  _hasProgress() {
    try {
      for (const w of WORLDS || []) {
        for (const id of w.stages || []) {
          const st = Save.stage(id);
          if (!st) continue;
          if (st.cleared || (st.best != null) || (st.deaths | 0) > 0 || (st.cpIndex | 0) > 0) return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /** First uncleared stage in an unlocked world; falls back to the last stage. */
  _continueTarget() {
    try {
      let unlocked = null;
      if (Save && typeof Save.unlockedWorlds === 'function') {
        const u = Save.unlockedWorlds();
        if (Array.isArray(u) && u.length) unlocked = new Set(u);
      }
      let last = null;
      for (const w of WORLDS || []) {
        if (unlocked && !unlocked.has(w.id)) continue;
        for (const id of w.stages || []) {
          last = { stageId: id, worldId: w.id, stageName: id };
          const st = Save.stage(id);
          if (!st || !st.cleared) return last;
        }
      }
      return last;
    } catch (e) { return null; }
  }

  /* ======================================================================
   * PAUSE
   * ====================================================================*/

  _buildPause() {
    const p = this._page('pause', 'am-pause');
    /* buttons only — no adjustable rows, so no ←→ ADJUST hint */
    const ui = this._panel(p, 'PAUSED', 'STAGE', false, [
      [['↑', '↓'], 'NAVIGATE'], [['ENTER'], 'SELECT'], [['ESC'], 'RESUME'],
    ]);
    this.pauseUI = ui;

    this.pStats = {};
    this.pStatEls = {};
    for (const k of ['TIME', 'DEATHS', 'BEST', 'CHECKPOINT']) {
      const s = el('div', 'am-hstat');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v'); vv.textContent = '—';
      s.appendChild(kk); s.appendChild(vv);
      ui.hr.appendChild(s);
      this.pStats[k] = vv;
      this.pStatEls[k] = s;
    }

    const list = el('div', 'am-list');
    this.pBtnResume = makeButton('RESUME', { primary: true, onClick: () => this._act('resume') });
    this.pBtnRestart = makeButton('RESTART STAGE', { onClick: () => this._act('restartStage') });
    this.pBtnRun = makeButton('RESTART RUN', { onClick: () => this._act('restartRun') });
    this.pBtnSel = makeButton('STAGE SELECT', { onClick: () => this._act('stageSelect') });
    this.pBtnSet = makeButton('SETTINGS', { onClick: () => { this._back = 'pause'; this.open('settings'); } });
    this.pBtnCtl = makeButton('CONTROLS', { onClick: () => { this._back = 'pause'; this.open('controls'); } });
    this.pBtnQuit = makeButton('QUIT TO TITLE', { danger: true, onClick: () => this._act('title') });
    for (const b of [this.pBtnResume, this.pBtnRestart, this.pBtnRun, this.pBtnSel,
      this.pBtnSet, this.pBtnCtl, this.pBtnQuit]) list.appendChild(b);
    ui.body.appendChild(list);

    const nav = new FocusList(list, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.pause = nav;
  }

  _refreshPause() {
    const g = this.game || {};
    const stage = g.stage;
    const def = stage && stage.def ? stage.def : null;
    const name = def ? (def.name || def.id || 'STAGE') : 'PAUSED';
    this.pauseUI.h2.textContent = String(name);

    let worldName = '';
    try {
      const w = (WORLDS || []).find((x) => x.id === (def && def.world));
      worldName = w ? w.name : (def && def.world ? String(def.world).toUpperCase() : '');
    } catch (e) { /* ignore */ }
    this.pauseUI.eyebrow.textContent = worldName ? 'PAUSED · ' + worldName : 'PAUSED';

    this.pStats.TIME.textContent = g.timeMs != null ? fmtMs(g.timeMs) : '—';
    this.pStats.DEATHS.textContent = g.deaths != null ? String(g.deaths | 0) : '0';

    let rec = null;
    try { rec = def && Save && typeof Save.stage === 'function' ? Save.stage(def.id) : null; } catch (e) { rec = null; }
    this.pStats.BEST.textContent = rec && rec.best != null ? fmtMs(rec.best) : '—';

    const cpCount = def && Array.isArray(def.checkpoints) ? def.checkpoints.length : 0;
    const cpIdx = rec ? (rec.cpIndex | 0) : 0;
    this.pStats.CHECKPOINT.textContent = cpCount ? cpIdx + ' / ' + cpCount : '—';

    /* The hub is a lobby — checkpoint bookkeeping and best times are race
       stats and have no meaning there. */
    const isHub = !!def && (def.isHub === true || def.id === 'hub' || def.world == null);
    this.pStatEls.CHECKPOINT.style.display = isHub ? 'none' : '';
    this.pStatEls.BEST.style.display = isHub ? 'none' : '';

    this.pBtnRestart.setSub(def ? (def.name || def.id) : '');
    this.nav.pause.refresh();
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

  /** Push changes into the live systems that may not subscribe to Settings. */
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
        if (g.fx && typeof g.fx.setQuality === 'function') g.fx.setQuality(q);
        if (g.fx && g.fx.particles && typeof g.fx.particles.setQuality === 'function') g.fx.particles.setQuality(q);
      }
    } catch (e) { /* ignore */ }
    try {
      if ('showViewmodel' in patch) {
        const vm = g.viewmodel || (g.player && g.player.viewmodel);
        if (vm && typeof vm.setVisible === 'function') vm.setVisible(!!s.showViewmodel);
      }
    } catch (e) { /* ignore */ }
    try {
      if ('fov' in patch) {
        const cam = g.fpcamera || g.fpCamera || (g.player && g.player.camera);
        if (cam && typeof cam.setFov === 'function') cam.setFov(s.fov);
      }
    } catch (e) { /* ignore */ }
  }

  _buildSettings() {
    const p = this._page('settings', 'am-settings');
    const ui = this._panel(p, 'OPTIONS', 'SETTINGS');
    this.settingsUI = ui;
    const s = this._s();

    const qKeys = (QUALITY && typeof QUALITY === 'object' ? Object.keys(QUALITY) : null) ||
      ['low', 'medium', 'high', 'ultra'];

    const list = el('div', 'am-list');
    const group = (t) => { const g = el('div', 'am-group-title'); g.textContent = t; list.appendChild(g); };

    group('DISPLAY');
    this.cQuality = makeSegmented({
      options: qKeys.map((k) => ({ v: k, label: String(k).toUpperCase() })),
      value: s.quality || 'high',
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ quality: v }); },
    });
    list.appendChild(makeRow('QUALITY PRESET', 'Shadows, bloom, particles, resolution', this.cQuality));

    this.cFov = makeSlider({
      min: 70, max: 110, step: 1, value: clamp(Number(s.fov) || 82, 70, 110),
      format: (v) => v.toFixed(0) + '°',
      onChange: (v) => this._set({ fov: v }),
    });
    list.appendChild(makeRow('FIELD OF VIEW', 'Base FOV; sprint adds a kick on top', this.cFov));

    this.cHud = makeSlider({
      min: 0.8, max: 1.4, step: 0.05, value: clamp(Number(s.hudScale) || 1, 0.8, 1.4),
      format: (v) => Math.round(v * 100) + '%',
      onChange: (v) => this._set({ hudScale: v }),
    });
    list.appendChild(makeRow('HUD SCALE', null, this.cHud));

    this.cTimer = makeToggle({
      value: s.showTimer !== false,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ showTimer: v }); },
    });
    list.appendChild(makeRow('SHOW TIMER', 'Stage clock, split and run total', this.cTimer));

    this.cVm = makeToggle({
      value: s.showViewmodel !== false,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ showViewmodel: v }); },
    });
    list.appendChild(makeRow('SHOW HANDS', 'First-person arms', this.cVm));

    this.cDip = makeToggle({
      value: s.motionBlurDip !== false,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ motionBlurDip: v }); },
    });
    list.appendChild(makeRow('LANDING DIP', 'Camera impact dip and speed blur', this.cDip));

    group('INPUT');
    this.cSens = makeSlider({
      min: 0.2, max: 3, step: 0.05, value: clamp(Number(s.sens) || 1, 0.2, 3),
      format: (v) => v.toFixed(2),
      onChange: (v) => this._set({ sens: v }),
    });
    list.appendChild(makeRow('MOUSE SENSITIVITY', null, this.cSens));

    this.cInv = makeToggle({
      value: !!s.invertY,
      onChange: (v) => { uiSfx(this.game, 'ui_ok'); this._set({ invertY: v }); },
    });
    list.appendChild(makeRow('INVERT Y AXIS', null, this.cInv));

    group('AUDIO');
    const vol = (label, key) => {
      const c = makeSlider({
        min: 0, max: 1, step: 0.05, value: clamp(Number(s[key]) != null ? Number(s[key]) : 0.8, 0, 1),
        format: (v) => Math.round(v * 100) + '%',
        onChange: (v) => { const pch = {}; pch[key] = v; this._set(pch); },
      });
      list.appendChild(makeRow(label, null, c));
      return c;
    };
    this.cMaster = vol('MASTER VOLUME', 'master');
    this.cMusic = vol('MUSIC', 'music');
    this.cSfx = vol('EFFECTS', 'sfx');

    const back = makeButton('BACK', { onClick: () => this._backOut() });
    back.style.marginTop = '18px';
    list.appendChild(back);

    ui.body.appendChild(list);
    const nav = new FocusList(list, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.settings = nav;
  }

  _refreshSettings() {
    const s = this._s();
    if (this.cQuality.set) this.cQuality.set(s.quality || 'high');
    this.cFov.set(clamp(Number(s.fov) || 82, 70, 110));
    this.cHud.set(clamp(Number(s.hudScale) || 1, 0.8, 1.4));
    this.cTimer.set(s.showTimer !== false);
    this.cVm.set(s.showViewmodel !== false);
    this.cDip.set(s.motionBlurDip !== false);
    this.cSens.set(clamp(Number(s.sens) || 1, 0.2, 3));
    this.cInv.set(!!s.invertY);
    this.cMaster.set(clamp(s.master != null ? Number(s.master) : 0.8, 0, 1));
    this.cMusic.set(clamp(s.music != null ? Number(s.music) : 0.6, 0, 1));
    this.cSfx.set(clamp(s.sfx != null ? Number(s.sfx) : 0.9, 0, 1));
    this.nav.settings.refresh();
  }

  /* ======================================================================
   * CONTROLS  (rebindable)
   * ====================================================================*/

  _buildControls() {
    const p = this._page('controls', 'am-controls');
    const ui = this._panel(p, 'INPUT MAP', 'CONTROLS', true, [
      [['↑', '↓'], 'NAVIGATE'], [['ENTER'], 'REBIND'], [['ESC'], 'BACK'],
    ]);
    this.controlsUI = ui;

    const head = el('div', 'am-ctlhead');
    const h1 = el('div'); h1.textContent = 'ACTION';
    const h2 = el('div'); h2.textContent = 'KEYBOARD';
    const h3 = el('div'); h3.textContent = 'CONTROLLER';
    head.appendChild(h1); head.appendChild(h2); head.appendChild(h3);
    ui.body.appendChild(head);

    const list = el('div', 'am-list');
    this.ctlRows = [];
    for (const a of ACTIONS) {
      const row = el('div', 'am-ctlrow');
      row.setAttribute('data-nav', '1');
      row.tabIndex = -1;
      const nm = el('div', 'nm'); nm.textContent = a.label;
      const keys = el('div', 'keys');
      const pad = el('div', 'pad');
      const padK = el('b', 'asc-kbd'); padK.textContent = a.pad;
      pad.appendChild(padK);
      row.appendChild(nm); row.appendChild(keys); row.appendChild(pad);
      const rec = { action: a, node: row, keysEl: keys, codes: a.def.slice() };
      row.__activate = () => this._listen(rec);
      row.addEventListener('click', () => this._listen(rec));
      this.ctlRows.push(rec);
      list.appendChild(row);
    }

    const look = el('div', 'am-ctlrow');
    look.setAttribute('data-nav-skip', '1');
    const ln = el('div', 'nm'); ln.textContent = 'LOOK';
    const lk = el('div', 'keys'); lk.innerHTML = '<b class="asc-kbd">MOUSE</b>';
    const lp = el('div', 'pad'); lp.innerHTML = '<b class="asc-kbd">RIGHT STICK</b>';
    look.appendChild(ln); look.appendChild(lk); look.appendChild(lp);
    look.style.opacity = '.7';
    list.appendChild(look);

    const reset = makeButton('RESET TO DEFAULTS', { onClick: () => this._resetBindings() });
    reset.style.marginTop = '16px';
    list.appendChild(reset);
    const back = makeButton('BACK', { onClick: () => this._backOut() });
    back.style.marginTop = '6px';
    list.appendChild(back);

    ui.body.appendChild(list);
    const nav = new FocusList(list, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.controls = nav;
  }

  /** Read bindings from Input (any shape) merged with our persisted overrides. */
  _loadBindings() {
    let stored = null;
    try {
      const raw = window.localStorage ? window.localStorage.getItem(BIND_KEY) : null;
      if (raw) stored = JSON.parse(raw);
    } catch (e) { stored = null; }

    const inp = resolveInput(this.game);
    const src = inp && inp.bindings && typeof inp.bindings === 'object' ? inp.bindings : null;

    for (const rec of this.ctlRows) {
      let codes = null;
      const a = rec.action;
      if (src) {
        for (const key of a.alias) {
          if (Object.prototype.hasOwnProperty.call(src, key)) {
            const v = src[key];
            rec.srcKey = key;
            rec.srcArray = Array.isArray(v);
            codes = Array.isArray(v) ? v.slice() : (typeof v === 'string' ? [v] : null);
            break;
          }
        }
      }
      if (stored && Array.isArray(stored[a.id]) && stored[a.id].length) codes = stored[a.id].slice();
      rec.codes = (codes && codes.length ? codes : a.def.slice()).filter((c) => typeof c === 'string');
      this._writeBinding(rec, false);
    }
    this._paintBindings();
  }

  /** Push a row's codes back into Input.bindings in the shape it uses. */
  _writeBinding(rec, persist) {
    const inp = resolveInput(this.game);
    if (inp && inp.bindings && typeof inp.bindings === 'object') {
      const key = rec.srcKey || rec.action.alias[0];
      if (rec.srcArray === false) inp.bindings[key] = rec.codes[0];
      else inp.bindings[key] = rec.codes.slice();
      try {
        if (typeof inp.saveBindings === 'function') inp.saveBindings();
        else if (typeof inp.rebind === 'function') inp.rebind(key, rec.codes.slice());
      } catch (e) { /* ignore */ }
    }
    if (persist) {
      try {
        const out = {};
        for (const r of this.ctlRows) out[r.action.id] = r.codes.slice();
        if (window.localStorage) window.localStorage.setItem(BIND_KEY, JSON.stringify(out));
      } catch (e) { /* ignore */ }
    }
  }

  _paintBindings() {
    for (const rec of this.ctlRows) {
      const listening = this._listening === rec;
      rec.keysEl.textContent = '';
      if (listening) {
        const k = el('b', 'asc-kbd is-listening');
        k.textContent = 'PRESS A KEY';
        rec.keysEl.appendChild(k);
      } else if (!rec.codes.length) {
        const k = el('b', 'asc-kbd is-empty');
        k.textContent = 'NONE';
        rec.keysEl.appendChild(k);
      } else {
        for (const c of rec.codes.slice(0, 2)) {
          const k = el('b', 'asc-kbd');
          k.textContent = keyName(c);
          rec.keysEl.appendChild(k);
        }
      }
      rec.node.classList.toggle('is-listening', listening);
    }
  }

  _listen(rec) {
    if (this._listening === rec) { this._listening = null; this._paintBindings(); return; }
    this._listening = rec;
    uiSfx(this.game, 'ui_move');
    this._paintBindings();
  }

  _resetBindings() {
    uiSfx(this.game, 'ui_ok');
    for (const rec of this.ctlRows) { rec.codes = rec.action.def.slice(); this._writeBinding(rec, false); }
    try { if (window.localStorage) window.localStorage.removeItem(BIND_KEY); } catch (e) { /* ignore */ }
    this._listening = null;
    this._paintBindings();
  }

  /* ======================================================================
   * CREDITS
   * ====================================================================*/

  _buildCredits() {
    const p = this._page('credits', 'am-credits-page');
    const ui = this._panel(p, 'ASCENDANT', 'CREDITS', false, [
      [['↑', '↓'], 'NAVIGATE'], [['ENTER'], 'SELECT'], [['ESC'], 'BACK'],
    ]);
    const body = el('div', 'am-credits');
    const block = (k, v) => {
      const b = el('div', 'c-block');
      const kk = el('div', 'c-k'); kk.textContent = k;
      const vv = el('div', 'c-v'); vv.innerHTML = v;
      b.appendChild(kk); b.appendChild(vv);
      body.appendChild(b);
    };
    block('GAME', '<b>ASCENDANT</b> — a first-person parkour trial across four worlds.<br>' +
      'Neon Dojo · Lava Foundry · Frozen Spire · Sky Temple');
    block('BUILT WITH', 'Three.js r172 · WebGL 2 · Web Audio<br>' +
      'ES modules, no build step, no external assets at runtime.');
    block('DESIGN NOTES',
      'Asymmetric gravity (rise 38, fall 54), coyote time, jump buffering and<br>' +
      'variable jump height. Every hazard is a pure function of the stage clock —<br>' +
      'a gauntlet always presents the same phase after a death, so it is learnable.');
    block('MUSIC & SOUND', 'Fully procedural. Every bed, impact and pickup is synthesised<br>' +
      'at runtime with the Web Audio API — no sample files ship with the game.');
    block('STUDIO', '<b>ForgeFlow Games</b><br>Version ' + VERSION);
    ui.body.appendChild(body);

    const back = makeButton('BACK', { onClick: () => this._backOut() });
    back.style.margin = '0 20px 8px';
    ui.body.appendChild(back);

    const nav = new FocusList(ui.body, { columns: 1, onMove: () => uiSfx(this.game, 'ui_move') });
    nav.bindHover();
    this.nav.credits = nav;
  }

  /* ======================================================================
   * OPEN / CLOSE
   * ====================================================================*/

  get isOpen() { return this._open; }

  /** @param {'title'|'pause'|'settings'|'controls'|'credits'} page */
  open(page) {
    const id = this.pages[page] ? page : 'title';
    const wasOpen = this._open;

    if (!wasOpen) {
      this._open = true;
      pushCapture(this.game);
      if (UIRegistry.hud) UIRegistry.hud.hideFor('menu');
      this.el.classList.add('on');
    }

    for (const k in this.pages) this.pages[k].classList.toggle('on', k === id);
    this.el.classList.toggle('is-title', id === 'title');
    this.page = id;
    this._listening = null;

    if (id === 'title') this._refreshTitle();
    else if (id === 'pause') this._refreshPause();
    else if (id === 'settings') this._refreshSettings();
    else if (id === 'controls') this._loadBindings();

    const nav = this.nav[id];
    if (nav) { nav.refresh(); nav.index = -1; nav.focusIndex(0, true); }

    /* Boot handoff: game.boot() opens the title while the #boot splash still
       covers the screen. Revealing now double-exposes two ASCENDANT lockups
       and burns the whole staggered entrance behind the splash — so hold the
       menu invisible and play the entrance only after the splash has faded. */
    if (this._deferForBoot()) return;

    this._reveal(id);
  }

  /** Fade the menu in and run the page entrance. */
  _reveal(id) {
    this.el.classList.remove('asc-gone');
    animateOnce(this.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    this._animateIn(id);
    uiSfx(this.game, 'ui_ok');
  }

  /**
   * True while the boot splash (#boot, index.html) is still covering the
   * screen — the reveal is queued for the moment its fade-out finishes
   * (transitionend on opacity, with a poll fallback).
   */
  _deferForBoot() {
    let boot = null;
    try { boot = document.getElementById('boot'); } catch (e) { boot = null; }
    const covering = !!(boot && boot.parentNode && !boot.classList.contains('gone'));
    if (!covering) { this._cancelBootWait(); return false; }
    this.el.classList.add('asc-gone');
    if (this._bootWait) return true;           /* already queued */
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
      const kids = [this.titleWrap.children[0], this.titleWrap.children[1], this.titleWrap.children[2],
        this.titleWrap.children[3]];
      for (let i = 0; i < kids.length; i++) {
        if (!kids[i]) continue;
        animateOnce(kids[i], [
          { opacity: 0, transform: 'translateX(-22px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ], { duration: 520, delay: i * 70, easing: UI_TOKENS.ease.out });
      }
      const list = this.titleWrap.children[4];
      if (list) {
        const b = list.children;
        for (let i = 0; i < b.length; i++) {
          animateOnce(b[i], [
            { opacity: 0, transform: 'translateX(-16px)' },
            { opacity: 1, transform: 'translateX(0)' },
          ], { duration: 380, delay: 260 + i * 55, easing: UI_TOKENS.ease.out });
        }
      }
      return;
    }
    const panel = p.querySelector('.am-panel');
    if (panel) {
      animateOnce(panel, [
        { opacity: 0, transform: 'translate(-50%,-50%) translateY(20px) scale(.975)' },
        { opacity: 1, transform: 'translate(-50%,-50%) translateY(0) scale(1)' },
      ], { duration: 340, easing: UI_TOKENS.ease.spring });
    }
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this._listening = null;
    this._cancelBootWait();
    const a = animateOnce(this.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 190 });
    const done = () => {
      if (!this._open) { this.el.classList.remove('on'); this.el.classList.remove('asc-gone'); }
    };
    if (a) a.onfinish = done; else done();
    if (UIRegistry.hud) UIRegistry.hud.showFor('menu');
    const playing = !this.game || this.game.state === 'playing' || this.game.state === 'hub' ||
      this.game.state === undefined;
    popCapture(this.game, playing);
  }

  _backOut() {
    uiSfx(this.game, 'ui_move');
    const back = this._back === 'pause' && this.pages.pause ? 'pause' : 'title';
    this.open(back);
  }

  _act(action, payload) {
    uiSfx(this.game, 'ui_ok');
    uiAction(this.game, action, payload);
  }

  /* ======================================================================
   * KEYBOARD
   * ====================================================================*/

  _handleKey(e) {
    if (!this._open) return;
    if (UIRegistry.stageSelect && UIRegistry.stageSelect.isOpen) return;
    if (UIRegistry.hud && UIRegistry.hud.finishOpen) return;

    /* rebind capture takes every key */
    if (this._listening) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { this._listening = null; this._paintBindings(); return; }
      const code = e.code || e.key;
      if (!code) return;
      const rec = this._listening;
      /* strip this code from any other action so a key is never double-bound */
      for (const r of this.ctlRows) {
        if (r === rec) continue;
        const i = r.codes.indexOf(code);
        if (i >= 0) { r.codes.splice(i, 1); this._writeBinding(r, false); }
      }
      rec.codes = [code];
      this._listening = null;
      this._writeBinding(rec, true);
      this._paintBindings();
      uiSfx(this.game, 'ui_ok');
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (this.page === 'pause') { uiSfx(this.game, 'ui_ok'); uiAction(this.game, 'resume'); this.close(); }
      else if (this.page === 'title') { /* nowhere to go back to */ }
      else this._backOut();
      return;
    }

    const nav = this.nav[this.page];
    if (nav && nav.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
  }

  /* ======================================================================
   * TEARDOWN
   * ====================================================================*/

  dispose() {
    this._cancelBootWait();
    window.removeEventListener('keydown', this._onKey, true);
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.menu === this) UIRegistry.menu = null;
  }
}

export default Menu;
