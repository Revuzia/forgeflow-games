/* ============================================================================
 * ASCENDANT — runtime/ui/hud.js
 * The in-game interface. DOM overlay in #hud (contract §20).
 *
 * Composition:
 *   top-left     world / GLOBAL stage number (obby convention: "STAGE 37 / 101",
 *                one checkpoint segment = one numbered stage) / level name +
 *                difficulty pips + difficulty band label
 *   top-centre   progress rail, checkpoint pips, pace ghost
 *   top-right    stage timer, live split vs best, run total, stage best
 *   bottom-left  deaths, coins, speed ribbon
 *   centre       crosshair (expands airborne / at speed)
 *   bottom-ctr   queued contextual prompts + the danger meter
 *   overlays     checkpoint ring wipe, death vignette, finish card
 *
 * update(dt, snapshot) writes ONLY values that changed (every readout is
 * cached in this._c) and never allocates in the hot path.
 * ==========================================================================*/

import { clamp } from '../core/util.js';
import { Settings } from '../core/settings.js';
import { THEMES } from '../world/themes.js';
import { WORLDS } from '../data/index.js';
import {
  injectStyles, UI_TOKENS, UIRegistry, el, textNode, icon, splitTime, fmtMs, fmtSplit,
  medalFor, makeMedal, makeButton, animateOnce, causeInfo, setUITheme, countUp,
  RollingNumber, FocusList, uiAction, uiSfx, pushCapture, popCapture, cssColor,
  diffBand,
} from './style.js';

/* --- module-scope scratch (no per-frame allocation) --------------------- */
const _S = { grounded: true, danger: 0, label: '' };
const TOAST_LIFE = 2600;
const TOAST_MAX = 3;
const DANGER_NEAR = 2.5;   // metres — full meter
const DANGER_FAR = 26;     // metres — meter appears

/* Map a world display name -> theme id, once. */
const _worldTheme = new Map();
try {
  for (const w of WORLDS || []) {
    if (!w) continue;
    if (w.name) _worldTheme.set(String(w.name).toUpperCase(), w.theme || w.id);
    if (w.id) _worldTheme.set(String(w.id).toUpperCase(), w.theme || w.id);
  }
} catch (e) { /* data not critical to the HUD */ }

export class HUD {
  /**
   * @param {HTMLElement} root  the #hud element
   * @param {object} game       the Game instance (used read-only + for actions)
   */
  constructor(root, game) {
    injectStyles();
    this.game = game || null;
    this.root = root || document.getElementById('hud') || document.body;

    this.el = el('div', 'asc-hud asc-ui');
    this.root.appendChild(this.el);

    /** master visibility + reason stack (death sequence, open menus) */
    this._visible = true;
    this._hidden = new Set();

    /** last-written value cache — the whole point of a cheap HUD */
    this._c = {
      world: '', stage: '', stageNum: '', levelName: '', diffBand: '', diff: -1,
      prog: -1, ghost: -1, cpOn: -1, cpCount: -1,
      timeMain: '', timeFrac: '', split: '', splitCls: '', total: '', best: '',
      deaths: -1, coins: -1, coinTotal: -1, speed: -1,
      air: null, danger: -1, dangerLabel: '', showTimer: null, theme: null,
      hudScale: -1, isHub: null,
    };

    this._toastLive = [];
    this._toastQueue = [];
    this._dangerStage = null;
    this._dangerSrc = null;
    this._dangerSmooth = 0;
    this._deathTimers = [];
    this._finishOpen = false;
    this._finishKeyHandler = null;

    this._build();

    /* live-apply HUD scale + timer visibility from Settings */
    this._onSettings = () => this._applySettings();
    try { if (Settings && typeof Settings.on === 'function') Settings.on(this._onSettings); } catch (e) { /* ignore */ }
    this._applySettings();

    UIRegistry.hud = this;
  }

  /* ======================================================================
   * BUILD
   * ====================================================================*/

  _build() {
    /* Everything the death sequence fades lives inside .ah-play; the flash
       layers and the finish card are siblings of it so they stay visible. */
    this.nPlay = el('div', 'ah-play');
    this.nPlay.appendChild(el('div', 'ah-scrim'));
    this.el.appendChild(this.nPlay);
    const E = this.nPlay;

    /* --- top-left ----------------------------------------------------- */
    /* Obby convention: the GLOBAL stage number is the headline ("STAGE 37 / 101")
       and the world / level name is secondary context. The big .ah-stage line
       carries the global number while numbering is available, the level name
       otherwise (and always in the hub). */
    const tl = el('div', 'ah-cluster ah-tl');
    this.nWorld = el('div', 'ah-world');
    this.tWorld = textNode(this.nWorld, '');
    this.nStage = el('div', 'ah-stage');
    this.tStage = textNode(this.nStage, '');
    const num = el('div', 'ah-stagenum');
    this.tStageNum = textNode(num, '');
    this.nDiff = el('div', 'ah-diff');
    for (let i = 0; i < 10; i++) this.nDiff.appendChild(el('i'));
    num.appendChild(this.nDiff);
    this.nDiffBand = el('span', 'ah-diffband');
    num.appendChild(this.nDiffBand);
    tl.appendChild(this.nWorld); tl.appendChild(this.nStage); tl.appendChild(num);
    E.appendChild(tl);
    this.nTL = tl;

    /* --- top-centre: progress ----------------------------------------- */
    const tc = el('div', 'ah-cluster ah-tc');
    const prog = el('div', 'ah-prog');
    this.nRail = el('div', 'ah-prog-rail');
    this.nFill = el('div', 'ah-prog-fill');
    this.nHead = el('div', 'ah-prog-head');
    this.nGhost = el('div', 'ah-ghost');
    this.nRail.appendChild(this.nFill);
    this.nRail.appendChild(this.nHead);
    this.nRail.appendChild(this.nGhost);
    prog.appendChild(this.nRail);
    const legend = el('div', 'ah-prog-legend');
    const lgA = el('span'); lgA.textContent = 'START';
    const lgB = el('span'); lgB.textContent = 'FINISH';
    legend.appendChild(lgA); legend.appendChild(lgB);
    prog.appendChild(legend);
    tc.appendChild(prog);
    E.appendChild(tc);
    this.nTC = tc;
    this._pips = [];

    /* --- top-right: timers -------------------------------------------- */
    const tr = el('div', 'ah-cluster ah-tr');
    const timer = el('div', 'ah-timer');
    const big = el('span', 'big'); this.tTimeMain = textNode(big, '0:00');
    const ms = el('span', 'ms'); this.tTimeFrac = textNode(ms, '.000');
    timer.appendChild(big); timer.appendChild(ms);
    this.nSplit = el('div', 'ah-split');
    this.tSplit = textNode(this.nSplit, '');
    const tot = el('div', 'ah-total');
    const totK = el('span'); totK.textContent = 'RUN';
    const totV = el('b'); this.tTotal = textNode(totV, '0:00.000');
    tot.appendChild(totK); tot.appendChild(totV);
    this.nBest = el('div', 'ah-best');
    this.tBest = textNode(this.nBest, '');
    tr.appendChild(timer); tr.appendChild(this.nSplit); tr.appendChild(tot); tr.appendChild(this.nBest);
    E.appendChild(tr);
    this.nTR = tr;

    /* --- bottom-left: deaths / coins / speed --------------------------- */
    const bl = el('div', 'ah-cluster ah-bl');
    this.nDeaths = el('div', 'ah-stat deaths');
    this.nDeaths.innerHTML = icon('skull');
    this.rollDeaths = new RollingNumber('n');
    this.nDeaths.appendChild(this.rollDeaths.el);
    this.rollDeaths.set('0', false);

    this.nCoins = el('div', 'ah-stat coins');
    this.nCoins.innerHTML = icon('coin');
    this.rollCoins = new RollingNumber('n');
    this.nCoins.appendChild(this.rollCoins.el);
    this.rollCoins.set('0', false);
    this.nCoinOf = el('span', 'of');
    this.tCoinOf = textNode(this.nCoinOf, '/0');
    this.nCoins.appendChild(this.nCoinOf);

    bl.appendChild(this.nDeaths); bl.appendChild(this.nCoins);
    E.appendChild(bl);
    this.nBL = bl;

    /* speed ribbon sits under the two counters */
    const spd = el('div', 'ah-cluster');
    spd.style.cssText = 'bottom:14px;left:26px;width:158px;height:3px;border-radius:2px;' +
      'background:rgba(255,255,255,.07);overflow:hidden;transform-origin:bottom left;' +
      'transform:scale(var(--hud-scale));opacity:0;transition:opacity .25s var(--e-out)';
    this.nSpeedFill = el('div');
    this.nSpeedFill.style.cssText = 'height:100%;width:100%;transform:scaleX(0);transform-origin:left center;' +
      'background:linear-gradient(90deg,var(--accent-dim),var(--accent-hot));' +
      'box-shadow:0 0 10px -2px var(--accent-glow);transition:transform .09s linear';
    spd.appendChild(this.nSpeedFill);
    E.appendChild(spd);
    this.nSpeed = spd;

    /* --- crosshair ----------------------------------------------------- */
    this.nCross = el('div', 'ah-cross');
    this.nCross.appendChild(el('i'));
    E.appendChild(this.nCross);

    /* --- toasts -------------------------------------------------------- */
    this.nToasts = el('div', 'ah-bc');
    E.appendChild(this.nToasts);

    /* --- danger meter -------------------------------------------------- */
    const dg = el('div', 'ah-danger');
    const dh = el('div', 'dg-head');
    dh.innerHTML = icon('warn');
    this.tDanger = textNode(dh, 'HAZARD');
    const drail = el('div', 'dg-rail');
    this.nDangerFill = el('div', 'dg-fill');
    drail.appendChild(this.nDangerFill);
    drail.appendChild(el('div', 'dg-chev'));
    dg.appendChild(dh); dg.appendChild(drail);
    E.appendChild(dg);
    this.nDanger = dg;

    /* --- flash layers -------------------------------------------------- */
    this.nRing = el('div', 'ah-ring');
    this.nVig = el('div', 'ah-vig');
    this.nWord = el('div', 'ah-word');
    this.tWord = textNode(this.nWord, '');
    this.nWordSub = el('span', 'sub');
    this.nWord.appendChild(this.nWordSub);
    this.el.appendChild(this.nVig); this.el.appendChild(this.nRing); this.el.appendChild(this.nWord);

    this._buildFinish();
  }

  _buildFinish() {
    const wrap = el('div', 'ah-finish');
    const card = el('div', 'ah-fcard asc-glass asc-scan');

    this.fKicker = el('div', 'ah-fk');
    this.fKicker.textContent = 'LEVEL COMPLETE';
    this.fName = el('div', 'ah-fname');
    this.fWorld = el('div', 'ah-fworld');
    /* Which global stages this level covers, and — on a resumed run — which of
       them were actually played. Stage select and this card have to say the
       same thing or the player is reading two different scoreboards. */
    this.fRange = el('div', 'ah-frange');
    this.fRule = el('div', 'ah-frule');

    const time = el('div', 'ah-ftime');
    this.fTimeBig = el('span', 'big');
    this.fTimeMs = el('span', 'ms');
    time.appendChild(this.fTimeBig); time.appendChild(this.fTimeMs);
    this.fTime = time;

    this.fSplit = el('div', 'ah-fsplit');
    this.fRecord = el('div', 'ah-frecord');
    this.fRecord.textContent = 'NEW RECORD';
    this.fRecord.style.display = 'none';

    const grid = el('div', 'ah-fgrid');
    const mk = (k) => {
      const c = el('div', 'ah-fcell');
      const kk = el('div', 'k'); kk.textContent = k;
      const vv = el('div', 'v');
      c.appendChild(kk); c.appendChild(vv);
      grid.appendChild(c);
      return { cell: c, v: vv };
    };
    this.fMedalCell = mk('MEDAL');
    this.fDeathCell = mk('DEATHS');
    this.fCoinCell = mk('COINS');
    this.fParCell = mk('PAR');
    this.fGrid = grid;

    const btns = el('div', 'ah-fbtns');
    this.fBtnContinue = makeButton('CONTINUE', {
      primary: true, onClick: () => this._finishAction('continue'),
    });
    this.fBtnRetry = makeButton('RETRY', { onClick: () => this._finishAction('retry') });
    this.fBtnSelect = makeButton('STAGES', { onClick: () => this._finishAction('select') });
    btns.appendChild(this.fBtnContinue); btns.appendChild(this.fBtnRetry); btns.appendChild(this.fBtnSelect);
    this.fBtns = btns;

    this.fHint = el('div', 'ah-fhint');
    this.fHint.innerHTML = '<b class="asc-kbd">←</b><b class="asc-kbd">→</b> SELECT' +
      '<i>·</i><b class="asc-kbd">ENTER</b> CONFIRM';

    card.appendChild(this.fKicker); card.appendChild(this.fName); card.appendChild(this.fWorld);
    card.appendChild(this.fRange);
    card.appendChild(this.fRule); card.appendChild(time); card.appendChild(this.fSplit);
    card.appendChild(this.fRecord); card.appendChild(grid); card.appendChild(btns); card.appendChild(this.fHint);
    wrap.appendChild(card);
    this.el.appendChild(wrap);

    this.nFinish = wrap;
    this.nFinishCard = card;
    this.finishNav = new FocusList(btns, { columns: 3, wrap: true, onMove: () => uiSfx(this.game, 'ui_move') });
    this.finishNav.bindHover();
  }

  /* ======================================================================
   * SETTINGS / THEME
   * ====================================================================*/

  _applySettings() {
    let s = null;
    try { s = Settings && typeof Settings.get === 'function' ? Settings.get() : null; } catch (e) { s = null; }
    if (!s) return;
    const scale = clamp(Number(s.hudScale) || 1, 0.7, 1.6);
    if (scale !== this._c.hudScale) {
      this._c.hudScale = scale;
      document.documentElement.style.setProperty('--hud-scale', String(scale));
    }
    const show = s.showTimer !== false;
    if (show !== this._c.showTimer) {
      this._c.showTimer = show;
      this._paintTimerVis();
    }
  }

  /** Timers show only when the setting allows AND we are not in the hub. */
  _paintTimerVis() {
    const on = this._c.showTimer !== false && this._c.isHub !== true;
    this.nTR.style.display = on ? '' : 'none';
  }

  /** Re-tint the HUD from a theme id or ThemeDef. */
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
    if (!id && snap.worldName) id = _worldTheme.get(String(snap.worldName).toUpperCase()) || null;
    if (!id && snap.worldId) id = _worldTheme.get(String(snap.worldId).toUpperCase()) || null;
    if (!id) {
      try {
        const t = this.game && this.game.stage && this.game.stage.def && this.game.stage.def.world;
        if (t) id = _worldTheme.get(String(t).toUpperCase()) || t;
      } catch (e) { /* ignore */ }
    }
    if (id && id !== this._c.theme) this.setTheme(id);
  }

  /* ======================================================================
   * VISIBILITY
   * ====================================================================*/

  setVisible(v) { this._visible = !!v; this._paintVisible(); }

  /** Reason-scoped hide so the death sequence and menus never fight. */
  hideFor(reason) { this._hidden.add(reason); this._paintVisible(); }
  showFor(reason) { this._hidden.delete(reason); this._paintVisible(); }

  _paintVisible() {
    const on = this._visible && this._hidden.size === 0;
    this.nPlay.classList.toggle('is-off', !on);
  }

  /* ======================================================================
   * PER-FRAME UPDATE
   * ====================================================================*/

  /**
   * @param {number} dt seconds
   * @param {object} snapshot see contract §20
   */
  update(dt, snapshot) {
    const s = snapshot;
    if (!s) return;
    const c = this._c;

    this._syncTheme(s);

    /* --- hub: a lobby shows no race chrome ---------------------------- */
    /* The progress rail (+ checkpoint pips + START/FINISH legend), the
       timers and the difficulty pips are stage furniture; the hub renders
       none of them (the difficulty BAND already gates on isHub below). */
    const isHub = !!s.isHub;
    if (isHub !== c.isHub) {
      c.isHub = isHub;
      this.nTC.style.display = isHub ? 'none' : '';
      this.nDiff.style.display = isHub ? 'none' : '';
      this._paintTimerVis();
    }

    /* --- names ------------------------------------------------------- */
    if (s.worldName !== undefined && s.worldName !== c.world) {
      c.world = s.worldName;
      this.tWorld.nodeValue = String(s.worldName || '');
    }
    /* Entrance animation fires on a LEVEL change only — the global stage number
       also ticks up on every checkpoint, and that must not replay the slide. */
    if (s.stageName !== undefined && s.stageName !== c.levelName) {
      c.levelName = s.stageName;
      animateOnce(this.nTL, [
        { opacity: 0, transform: 'translateX(-14px) scale(var(--hud-scale))' },
        { opacity: 1, transform: 'translateX(0) scale(var(--hud-scale))' },
      ], { duration: 460, easing: UI_TOKENS.ease.out });
    }
    /* Headline: the global stage number (obby convention). Fallback (numbering
       not loaded yet, or the hub): the level name, as before. */
    const hasGlobal = (s.globalStage | 0) > 0 && (s.globalTotal | 0) > 0;
    const bigTxt = hasGlobal
      ? 'STAGE ' + (s.globalStage | 0) + ' / ' + (s.globalTotal | 0)
      : String(s.stageName || '');
    if (bigTxt !== c.stage) {
      c.stage = bigTxt;
      this.tStage.nodeValue = bigTxt;
    }
    /* Secondary line: the level name under a global headline; the world-local
       index when there is no numbering (never "STAGE 1 / 0" in the hub). */
    const subTxt = hasGlobal
      ? String(s.stageName || '')
      : (s.stageIdx > 0 && s.stageCount > 0 ? 'STAGE ' + s.stageIdx + ' / ' + s.stageCount : '');
    if (subTxt !== c.stageNum) { c.stageNum = subTxt; this.tStageNum.nodeValue = subTxt; }

    const diff = s.difficulty != null ? s.difficulty
      : (this.game && this.game.stage && this.game.stage.def ? this.game.stage.def.difficulty : null);
    if (diff != null && diff !== c.diff) {
      c.diff = diff;
      const lv = clamp(diff | 0, 0, 10);
      const kids = this.nDiff.children;
      for (let i = 0; i < kids.length; i++) {
        const on = i < lv;
        kids[i].className = on ? (i >= 7 ? 'hot' : 'on') : '';
      }
    }
    /* chart-obby convention: a named difficulty band next to the pips.
       Keyed on its own cache so a hub transition clears it even when the raw
       difficulty number happens not to change. */
    const band = s.isHub || diff == null ? null : diffBand(clamp(diff | 0, 0, 10));
    const bandTxt = band ? band.label : '';
    if (bandTxt !== c.diffBand) {
      c.diffBand = bandTxt;
      this.nDiffBand.textContent = bandTxt;
      this.nDiffBand.className = 'ah-diffband' + (band ? ' db-' + band.cls : '');
    }

    /* --- progress ----------------------------------------------------- */
    const cpCount = s.cpCount != null ? s.cpCount | 0 : 0;
    if (cpCount !== c.cpCount) { c.cpCount = cpCount; this._buildPips(cpCount, s.cpProgress); c.cpOn = -1; }

    const p01 = clamp(Number(s.progress01) || 0, 0, 1);
    if (Math.abs(p01 - c.prog) > 0.0015) {
      c.prog = p01;
      this.nFill.style.transform = 'scaleX(' + p01.toFixed(4) + ')';
      this.nHead.style.left = (p01 * 100).toFixed(2) + '%';
    }

    const cpIndex = s.cpIndex != null ? s.cpIndex | 0 : 0;
    if (cpIndex !== c.cpOn || Math.abs(p01 - (c._pipProg || 0)) > 0.02) {
      c.cpOn = cpIndex; c._pipProg = p01;
      for (let i = 0; i < this._pips.length; i++) {
        const pip = this._pips[i];
        const on = pip.finish ? p01 >= 0.999 : (i < cpIndex || p01 >= pip.at - 0.004);
        if (on !== pip.on) { pip.on = on; pip.node.classList.toggle('is-on', on); }
      }
    }

    /* pace ghost — where your best run would be at this elapsed time */
    const best = s.best != null && isFinite(s.best) && s.best > 0 ? s.best : null;
    const timeMs = Number(s.timeMs) || 0;
    if (best) {
      const g = clamp(timeMs / best, 0, 1);
      if (Math.abs(g - c.ghost) > 0.004) {
        c.ghost = g;
        this.nGhost.style.left = (g * 100).toFixed(2) + '%';
        this.nGhost.style.opacity = g >= 1 ? '0.35' : '1';
      }
    } else if (c.ghost !== -1) {
      c.ghost = -1;
      this.nGhost.style.opacity = '0';
    }

    /* --- timers -------------------------------------------------------- */
    const st = splitTime(timeMs);
    if (st.main !== c.timeMain) { c.timeMain = st.main; this.tTimeMain.nodeValue = st.main; }
    if (st.frac !== c.timeFrac) { c.timeFrac = st.frac; this.tTimeFrac.nodeValue = st.frac; }

    if (best && p01 > 0.02) {
      const delta = timeMs - best * p01;
      const txt = fmtSplit(delta);
      const cls = delta <= 0 ? 'ah-split ahead' : 'ah-split behind';
      if (txt !== c.split) { c.split = txt; this.tSplit.nodeValue = txt; }
      if (cls !== c.splitCls) { c.splitCls = cls; this.nSplit.className = cls; }
    } else if (c.splitCls !== 'ah-split') {
      c.splitCls = 'ah-split'; c.split = '';
      this.nSplit.className = 'ah-split'; this.tSplit.nodeValue = '';
    }

    if (s.totalMs != null) {
      const t = fmtMs(s.totalMs);
      if (t !== c.total) { c.total = t; this.tTotal.nodeValue = t; }
    }
    const bestTxt = best ? 'BEST ' + fmtMs(best) : '';
    if (bestTxt !== c.best) { c.best = bestTxt; this.tBest.nodeValue = bestTxt; }

    /* --- counters ------------------------------------------------------ */
    const deaths = s.deaths != null ? s.deaths | 0 : 0;
    if (deaths !== c.deaths) {
      const up = c.deaths >= 0 && deaths > c.deaths;
      c.deaths = deaths;
      this.rollDeaths.set(String(deaths), true);
      if (up) {
        this.nDeaths.classList.remove('is-hit');
        void this.nDeaths.offsetWidth;
        this.nDeaths.classList.add('is-hit');
        setTimeout(() => this.nDeaths.classList.remove('is-hit'), 420);
      }
    }
    const coins = Array.isArray(s.coins) ? s.coins.length : (s.coins != null ? s.coins | 0 : 0);
    if (coins !== c.coins) {
      const up = c.coins >= 0 && coins > c.coins;
      c.coins = coins;
      this.rollCoins.set(String(coins), true);
      if (up) {
        this.nCoins.classList.remove('is-hit');
        void this.nCoins.offsetWidth;
        this.nCoins.classList.add('is-hit');
        setTimeout(() => this.nCoins.classList.remove('is-hit'), 520);
      }
    }
    const ct = s.coinTotal != null ? s.coinTotal | 0 : 0;
    if (ct !== c.coinTotal) {
      c.coinTotal = ct;
      this.tCoinOf.nodeValue = '/' + ct;
      this.nCoins.style.display = ct > 0 ? '' : 'none';
    }

    /* --- crosshair + speed --------------------------------------------- */
    _S.grounded = s.grounded != null ? !!s.grounded
      : (this.game && this.game.player ? !!this.game.player.grounded : true);
    if (_S.grounded !== c.air) {
      c.air = _S.grounded;
      this.nCross.classList.toggle('air', !_S.grounded);
    }
    const spd = Number(s.speed) || 0;
    const sq = Math.round(clamp(spd / 12.2, 0, 1.15) * 40) / 40;
    if (sq !== c.speed) {
      c.speed = sq;
      this.nSpeedFill.style.transform = 'scaleX(' + Math.min(sq, 1).toFixed(3) + ')';
      this.nSpeed.style.opacity = sq > 0.06 ? String(clamp(0.25 + sq * 0.75, 0, 1)) : '0';
    }

    /* --- danger meter --------------------------------------------------- */
    this._updateDanger(dt, s);
  }

  _buildPips(cpCount, cpProgress) {
    for (const p of this._pips) p.node.remove();
    this._pips.length = 0;
    const n = Math.max(0, cpCount | 0);
    for (let i = 0; i < n; i++) {
      const at = Array.isArray(cpProgress) && isFinite(cpProgress[i])
        ? clamp(cpProgress[i], 0, 1)
        : (i + 1) / (n + 1);
      const node = el('div', 'ah-pip');
      node.style.left = (at * 100).toFixed(2) + '%';
      this.nRail.appendChild(node);
      this._pips.push({ node, at, on: false, finish: false });
    }
    const fin = el('div', 'ah-pip is-finish');
    fin.style.left = '100%';
    this.nRail.appendChild(fin);
    this._pips.push({ node: fin, at: 1, on: false, finish: true });
  }

  /* ----------------------------------------------------------------------
   * Danger — snapshot.danger wins; otherwise derived analytically from the
   * stage def + stage clock (hazards are pure functions of the clock, §16).
   * --------------------------------------------------------------------*/

  _scanDanger(stage) {
    this._dangerSrc = null;
    const def = stage && stage.def;
    if (!def || !Array.isArray(def.objects)) return;
    for (const o of def.objects) {
      if (!o) continue;
      if (o.kind === 'chase') {
        const mat = o.mat || 'wall';
        this._dangerSrc = {
          type: 'chase',
          axis: o.axis === 'y' ? 1 : 2,
          from: Number(o.from) || 0, to: Number(o.to) || 0,
          speed: Number(o.speed) || 0, delay: Number(o.delay) || 0,
          label: mat === 'lava' ? 'LAVA SURGE' : mat === 'void' ? 'THE VOID' : 'COLLAPSE',
        };
        return;
      }
      if (o.kind === 'lava' && o.rising) {
        const r = o.rising;
        this._dangerSrc = {
          type: 'lava',
          axis: 1,
          from: Number(r.from) || 0, to: Number(r.to) || 0,
          speed: Number(r.speed) || 0, delay: Number(r.delay) || 0,
          label: 'RISING LAVA',
        };
        return;
      }
    }
  }

  _updateDanger(dt, s) {
    let v = null;
    let label = s.dangerLabel || '';

    if (s.danger != null && isFinite(s.danger)) {
      v = clamp(Number(s.danger), 0, 1);
    } else {
      const stage = this.game && this.game.stage;
      const player = this.game && this.game.player;
      const id = stage && stage.def ? stage.def.id : null;
      if (id !== this._dangerStage) { this._dangerStage = id; this._scanDanger(stage); }
      const src = this._dangerSrc;
      if (src && stage && player && player.pos) {
        const t = Number(stage.clock) || 0;
        const el0 = Math.max(0, t - src.delay);
        const dir = src.to >= src.from ? 1 : -1;
        let at = src.from + dir * el0 * src.speed;
        at = dir > 0 ? Math.min(at, src.to) : Math.max(at, src.to);
        const pc = src.axis === 1 ? player.pos.y : player.pos.z;
        const gap = dir > 0 ? (pc - at) : (at - pc);
        if (t > src.delay - 1.2 && gap < DANGER_FAR) {
          v = clamp(1 - (gap - DANGER_NEAR) / (DANGER_FAR - DANGER_NEAR), 0, 1);
          if (!label) label = src.label;
        }
      }
    }

    const target = v == null ? 0 : v;
    const k = 1 - Math.exp(-(dt > 0 ? dt : 0.016) * 11);
    this._dangerSmooth += (target - this._dangerSmooth) * k;
    const on = target > 0.001 || this._dangerSmooth > 0.02;

    const q = Math.round(this._dangerSmooth * 40) / 40;
    const c = this._c;
    if (q !== c.danger) {
      c.danger = q;
      this.nDangerFill.style.transform = 'scaleX(' + q.toFixed(3) + ')';
      this.nDanger.style.setProperty('--dg', q.toFixed(2));
    }
    if (label && label !== c.dangerLabel) { c.dangerLabel = label; this.tDanger.nodeValue = label; }
    if (on !== c._dangerOn) { c._dangerOn = on; this.nDanger.classList.toggle('on', on); }
  }

  /** Manual danger override (game.js may drive this instead of the snapshot). */
  setDanger(v, label) {
    this._c.danger = -1;
    const q = clamp(Number(v) || 0, 0, 1);
    this._dangerSmooth = q;
    this.nDangerFill.style.transform = 'scaleX(' + q.toFixed(3) + ')';
    this.nDanger.style.setProperty('--dg', q.toFixed(2));
    if (label) { this._c.dangerLabel = label; this.tDanger.nodeValue = label; }
    const on = q > 0.001;
    this._c._dangerOn = on;
    this.nDanger.classList.toggle('on', on);
  }

  /* ======================================================================
   * TOASTS  (queued — they never overlap)
   * ====================================================================*/

  /**
   * @param {string} text  headline
   * @param {string} [sub] secondary line
   * @param {string} [kind] 'info'|'good'|'warn'|'bad'
   */
  toast(text, sub, kind) {
    if (text == null) return;
    this._toastQueue.push({ text: String(text), sub: sub ? String(sub) : '', kind: kind || 'info' });
    if (this._toastQueue.length > 8) this._toastQueue.splice(0, this._toastQueue.length - 8);
    this._pumpToasts();
  }

  _pumpToasts() {
    while (this._toastLive.length < TOAST_MAX && this._toastQueue.length) {
      this._showToast(this._toastQueue.shift());
    }
  }

  _showToast(t) {
    const kindCls = t.kind === 'good' ? 'k-good' : t.kind === 'warn' ? 'k-warn'
      : t.kind === 'bad' ? 'k-bad' : 'k-info';
    const node = el('div', 'ah-toast ' + kindCls);
    const ic = el('div', 'ic');
    ic.innerHTML = icon(t.kind === 'good' ? 'tick' : t.kind === 'bad' ? 'warn'
      : t.kind === 'warn' ? 'warn' : 'chevron');
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
   * FLASHES
   * ====================================================================*/

  /**
   * Full-screen ring wipe in the checkpoint colour + a stage-number wordmark.
   * Obby convention: touching a checkpoint means entering a new global stage, so
   * the wordmark is "STAGE 38" (with the total in the sub line). Called with no
   * arguments — numbering not loaded — it falls back to the classic CHECKPOINT
   * wordmark.
   *
   * @param {number} [globalStage] global stage number just entered (1-based)
   * @param {number} [globalTotal] total global stages in the game
   */
  checkpointFlash(globalStage, globalTotal) {
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

    this.nWord.style.setProperty('--wc', 'var(--cp)');
    const num = globalStage | 0;
    if (num > 0) {
      this.tWord.nodeValue = 'STAGE ' + num;
      /* Same word stage select uses for this number: a checkpoint means the
         stage is REACHED, not that the level is complete. */
      this.nWordSub.textContent = (globalTotal | 0) > 0
        ? 'REACHED · ' + num + ' / ' + (globalTotal | 0) : 'STAGE REACHED';
    } else {
      this.tWord.nodeValue = 'CHECKPOINT';
      this.nWordSub.textContent = 'PROGRESS SAVED';
    }
    animateOnce(this.nWord, [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.22)', filter: 'blur(6px)', easing: UI_TOKENS.ease.out },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', filter: 'blur(0)', offset: 0.24 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.01)', filter: 'blur(0)', offset: 0.66, easing: UI_TOKENS.ease.in },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05)', filter: 'blur(2px)' },
    ], { duration: 900, easing: 'linear', fill: 'forwards' });
  }

  /** Edge-vignette pulse in the cause colour + the cause name. HUD dips out. */
  deathFlash(cause) {
    const info = causeInfo(cause);
    const col = cssColor(info.color, '#ff5546');

    this.nVig.style.setProperty('--vc', col);
    animateOnce(this.nVig, [
      { opacity: 0 },
      { opacity: 0.95, offset: 0.09 },
      { opacity: 0.58, offset: 0.42 },
      { opacity: 0 },
    ], { duration: 760, easing: 'linear', fill: 'forwards' });

    this.nWord.style.setProperty('--wc', col);
    this.tWord.nodeValue = info.label;
    this.nWordSub.textContent = '';
    animateOnce(this.nWord, [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.9)', filter: 'blur(5px)', easing: UI_TOKENS.ease.out },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.02)', filter: 'blur(0)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.02)', filter: 'blur(0)', offset: 0.62, easing: UI_TOKENS.ease.in },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.05)', filter: 'blur(3px)' },
    ], { duration: 760, easing: 'linear', fill: 'forwards' });

    /* HUD dips out for the death sequence and returns with the camera
       (contract §21 budget: 620 ms door to door). */
    for (const t of this._deathTimers) clearTimeout(t);
    this._deathTimers.length = 0;
    this._deathTimers.push(setTimeout(() => this.hideFor('death'), 80));
    this._deathTimers.push(setTimeout(() => this.showFor('death'), 440));
    this.clearToasts();
  }

  /** Called by the game when the player is back in control (optional). */
  respawned() {
    for (const t of this._deathTimers) clearTimeout(t);
    this._deathTimers.length = 0;
    this.showFor('death');
  }

  /* ======================================================================
   * FINISH CARD
   * ====================================================================*/

  /**
   * @param {object} summary {stageName, worldName, timeMs, best, prevBest, isRecord,
   *                          deaths, coins, coinTotal, par, medal, hasNext}
   */
  finish(summary) {
    const s = summary || {};
    const timeMs = Number(s.timeMs) || 0;
    /* A PARTIAL run started mid-level from stage select. It skipped stages, so
       its clock is not comparable to a whole-level time: no record, no split
       against the best, no medal. Saying so on the card is the point — a player
       who saw "GOLD" for walking the last 20 m would never trust the medal
       again (and Game does not bank the time either). */
    const partial = !!s.partial;
    const prev = partial ? null
      : (s.prevBest != null ? s.prevBest : (s.best != null && s.best < timeMs ? s.best : null));
    const isRecord = partial ? false
      : (s.isRecord != null ? !!s.isRecord : (prev == null || timeMs < prev));
    const par = s.par != null ? s.par
      : (this.game && this.game.stage && this.game.stage.def ? this.game.stage.def.par : null);
    const medal = partial ? null : (s.medal || medalFor(timeMs, par));

    this.fName.textContent = String(s.stageName || this._c.stage || 'STAGE');
    this.fWorld.textContent = String(s.worldName || this._c.world || '');
    this.fKicker.textContent = s.kicker || (partial ? 'STAGES CLEARED' : 'LEVEL COMPLETE');

    const range = partial ? String(s.ranRange || '') : String(s.stageRange || '');
    this.fRange.textContent = range;
    this.fRange.style.display = range ? '' : 'none';

    const st = splitTime(timeMs);
    this.fTimeBig.textContent = st.main;
    this.fTimeMs.textContent = st.frac;

    if (partial) {
      this.fSplit.textContent = 'PARTIAL RUN · NO TIME BANKED · LEVEL NOT COMPLETED';
      this.fSplit.className = 'ah-fsplit partial';
    } else if (prev != null && isFinite(prev)) {
      const d = timeMs - prev;
      this.fSplit.textContent = fmtSplit(d) + '  VS BEST';
      this.fSplit.className = 'ah-fsplit ' + (d <= 0 ? 'ahead' : 'behind');
    } else {
      this.fSplit.textContent = 'FIRST COMPLETION';
      this.fSplit.className = 'ah-fsplit';
    }
    this.fRecord.style.display = isRecord && prev != null ? '' : 'none';

    /* medal cell */
    this.fMedalCell.v.innerHTML = '';
    this.fMedalCell.v.appendChild(makeMedal(medal || 'none'));
    const mt = el('span', 'mt');
    mt.textContent = medal ? medal.toUpperCase() : '—';
    if (medal) mt.style.color = 'var(--' + medal + ')';
    this.fMedalCell.v.appendChild(mt);

    /* counters (count-up) */
    const deaths = s.deaths != null ? s.deaths | 0 : (this._c.deaths > 0 ? this._c.deaths : 0);
    const coins = Array.isArray(s.coins) ? s.coins.length : (s.coins != null ? s.coins | 0 : this._c.coins);
    const coinTotal = s.coinTotal != null ? s.coinTotal | 0 : this._c.coinTotal;

    this.fDeathCell.v.textContent = '0';
    this.fCoinCell.v.innerHTML = '';
    const coinN = document.createTextNode('0');
    const coinOf = el('small'); coinOf.textContent = ' / ' + (coinTotal || 0);
    this.fCoinCell.v.appendChild(coinN); this.fCoinCell.v.appendChild(coinOf);
    this.fParCell.v.textContent = par ? fmtMs(par) : '—';

    if (this._cancelCount) { for (const f of this._cancelCount) f(); }
    this._cancelCount = [
      countUp(0, deaths, 520, (v) => { this.fDeathCell.v.textContent = String(Math.round(v)); }),
      countUp(0, coins || 0, 620, (v) => { coinN.nodeValue = String(Math.round(v)); }),
    ];

    /* buttons */
    const hasNext = s.hasNext !== false;
    this.fBtnContinue.setLabel(hasNext ? 'CONTINUE' : 'RETURN TO HUB');

    /* show + staggered entrance */
    this.nFinish.classList.add('on');
    this._finishOpen = true;
    pushCapture(this.game);
    this.hideFor('finish');

    animateOnce(this.nFinish, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    animateOnce(this.nFinishCard, [
      { opacity: 0, transform: 'translateY(26px) scale(.965)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 460, easing: UI_TOKENS.ease.spring });

    const stagger = [
      this.fKicker, this.fName, this.fWorld, this.fTime, this.fSplit,
      this.fRecord, this.fGrid, this.fBtns, this.fHint,
    ];
    for (let i = 0; i < stagger.length; i++) {
      animateOnce(stagger[i], [
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 380, delay: 120 + i * 55, easing: UI_TOKENS.ease.out });
    }
    animateOnce(this.fRule, [
      { transform: 'scaleX(0)', opacity: 0 },
      { transform: 'scaleX(1)', opacity: 0.7 },
    ], { duration: 560, delay: 200, easing: UI_TOKENS.ease.out });

    /* keyboard */
    this.finishNav.refresh();
    this.finishNav.focusIndex(0, true);
    if (this._finishKeyHandler) window.removeEventListener('keydown', this._finishKeyHandler, true);
    this._finishKeyHandler = (e) => {
      if (!this._finishOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      if (this.finishNav.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', this._finishKeyHandler, true);
    // NO finish sfx here: Game.onFinish owns it (game.js). The HUD is optional —
    // firing it from both places double-triggered the fanfare on every clear.
  }

  hideFinish() {
    if (!this._finishOpen) return;
    this._finishOpen = false;
    if (this._finishKeyHandler) {
      window.removeEventListener('keydown', this._finishKeyHandler, true);
      this._finishKeyHandler = null;
    }
    if (this._cancelCount) { for (const f of this._cancelCount) f(); this._cancelCount = null; }
    const a = animateOnce(this.nFinish, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    const done = () => { this.nFinish.classList.remove('on'); };
    if (a) a.onfinish = done; else done();
    popCapture(this.game, false);
    this.showFor('finish');
  }

  _finishAction(which) {
    uiSfx(this.game, 'ui_ok');
    this.hideFinish();
    if (which === 'continue') uiAction(this.game, 'nextStage');
    else if (which === 'retry') uiAction(this.game, 'restartStage');
    else uiAction(this.game, 'stageSelect');
  }

  get finishOpen() { return this._finishOpen; }

  /* ======================================================================
   * TEARDOWN
   * ====================================================================*/

  dispose() {
    try { if (Settings && typeof Settings.off === 'function') Settings.off(this._onSettings); } catch (e) { /* ignore */ }
    if (this._finishKeyHandler) window.removeEventListener('keydown', this._finishKeyHandler, true);
    for (const t of this._deathTimers) clearTimeout(t);
    this.clearToasts();
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (UIRegistry.hud === this) UIRegistry.hud = null;
  }
}

export default HUD;
