// BLOCKTOOTH — title, pause and settings screens (CONTRACT.md §12, §14). ui lane.
//   TitleScreen   BLOCKTOOTH logotype (CSS, with a bite taken out of it), "a WARD-7 special report",
//                 PRESS ENTER, slow parallax city silhouette, bottom crawl.
//   PauseMenu     "WE'LL BE RIGHT BACK" test card (station-palette colour bars) — Resume / Settings /
//                 Retry / Quit (Retry and Quit ask twice). Esc resumes.
//   SettingsPanel "STATION ENGINEERING": master/music/sfx volume, picture quality, screen shake,
//                 reduce flashing. Returns the edited Settings (the caller saves + applies them).
// Every screen: input.mode = 'ui' while open (runModal), keyboard + mouse + gamepad.

import type { Input } from '../core/input.ts';
import type { Settings } from '../core/save.ts';
import { loadSettings, saveSettings } from '../core/save.ts';
import { STR, TICKER } from '../data/strings.ts';
import {
  type ModalSession, type UiPress, applyUiSettings, clearEl, cosmeticRng, div, el, fmtClock, keyChip, onTap, pulse,
  runModal, wrapIndex, flashesReduced,
} from './dom.ts';

// ─────────────────────────────── shared bits ───────────────────────────────

/** WARD-7 • LIVE station bug (same markup/classes as the HUD bug). */
export function buildBug(parent: HTMLElement, clockText?: string): HTMLDivElement {
  const bug = div('bt-bug', parent);
  const net = div('bt-bug-net', bug);
  div('bt-dot', net);
  net.appendChild(el('b', '', STR.network));
  net.appendChild(el('i', '', '•'));
  net.appendChild(el('span', '', STR.live));
  if (clockText !== undefined) {
    const clk = div('bt-bug-clock', bug);
    clk.appendChild(el('span', 'bt-clock', clockText));
  }
  return bug;
}

/** Local wall-clock "HH:MM" for menu bugs (cosmetic; UI may read clocks). */
export function wallClock(): string {
  const d = new Date();
  return fmtClock(d.getHours() * 60 + d.getMinutes());
}

/** A CSS-painted skyline silhouette row (divs only), deterministic from a seed. */
export function buildSkyline(parent: HTMLElement, cls: string, seed: number, count: number, opts: {
  minH?: number; maxH?: number; windows?: boolean; antennas?: boolean;
} = {}): HTMLDivElement {
  const row = div(`bt-skyline ${cls}`, parent);
  const r = cosmeticRng(seed);
  const minH = opts.minH ?? 18, maxH = opts.maxH ?? 90;
  for (let i = 0; i < count; i++) {
    const b = div('bt-sky-b', row);
    const h = minH + (maxH - minH) * Math.pow(r(), 1.4);
    b.style.height = `${h.toFixed(1)}%`;
    b.style.flexGrow = (0.6 + r() * 1.6).toFixed(2);
    if (opts.windows && r() > 0.35) b.classList.add('win');
    if (opts.antennas && h > maxH * 0.6 && r() > 0.5) div('bt-sky-ant', b);
    if (r() > 0.78) b.classList.add('step');
  }
  return row;
}

// ─────────────────────────────── TITLE ───────────────────────────────

export class TitleScreen {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly clock: HTMLElement;
  private readonly crawl: HTMLElement;
  private session: ModalSession<void> | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-title bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR.game);

    // backdrop: sky wash, sun disc, three parallax skyline bands, street glow
    const sky = div('bt-title-sky', L);
    div('bt-title-sun', sky);
    const city = div('bt-title-city', L);
    const far = div('bt-title-band far', city);
    buildSkyline(far, 'a', 11, 34, { minH: 20, maxH: 70 });
    buildSkyline(far, 'b', 11, 34, { minH: 20, maxH: 70 });
    const mid = div('bt-title-band mid', city);
    buildSkyline(mid, 'a', 23, 26, { minH: 16, maxH: 80, windows: true, antennas: true });
    buildSkyline(mid, 'b', 23, 26, { minH: 16, maxH: 80, windows: true, antennas: true });
    const near = div('bt-title-band near', city);
    buildSkyline(near, 'a', 37, 18, { minH: 12, maxH: 55, windows: true });
    buildSkyline(near, 'b', 37, 18, { minH: 12, maxH: 55, windows: true });
    div('bt-title-street', L);
    div('bt-halftone', L);
    div('bt-scanlines', L);

    const bug = buildBug(L, '');
    this.clock = bug.querySelector('.bt-clock') as HTMLElement;

    const band = div('bt-title-band-red', L);
    band.appendChild(el('span', 'bt-title-band-tag', STR.title.band));
    band.appendChild(el('span', 'bt-title-band-txt', STR.networkLong));

    const logoWrap = div('bt-logo-wrap', L);
    const logoBox = div('bt-logo-box', logoWrap);
    const logo = div('bt-logo', logoBox);
    logo.setAttribute('aria-label', STR.game);
    logo.appendChild(el('span', 'bt-logo-fill', STR.game));
    // crumbs fall out of the bite (outside the masked logo so they are not clipped by it)
    const crumbs = div('bt-logo-crumbs', logoBox);
    for (let i = 0; i < 5; i++) div('bt-crumb', crumbs);
    div('bt-logo-sub', logoWrap, STR.specialReport);
    div('bt-logo-tag', logoWrap, STR.tagline);

    const press = div('bt-title-press', L);
    press.appendChild(el('span', 'bt-title-press-main', STR.title.press));
    press.appendChild(el('span', 'bt-title-press-sub', STR.title.pressSub));
    onTap(L, () => this.go());

    const lower = div('bt-title-lower', L);
    // the legal line sits on its own navy strip so it never reads over the painted lane dashes
    const legal = div('bt-title-legal', lower);
    legal.appendChild(el('span', '', STR.title.legal));
    const tk = div('bt-ticker bt-title-ticker', lower);
    div('bt-ticker-label', tk, STR.title.standby);
    const win = div('bt-ticker-win', tk);
    this.crawl = div('bt-ticker-strip bt-css-crawl', win);
  }

  run(): Promise<void> {
    if (this.session && !this.session.done) this.session.abort();
    this.clock.textContent = wallClock();
    // CSS crawl: title lines + a few wire headlines, duplicated so the loop is seamless
    clearEl(this.crawl);
    const items = [...STR.title.crawl, ...TICKER.slice(0, 4)];
    for (let rep = 0; rep < 2; rep++) {
      for (const t of items) {
        const n = el('span', 'bt-tk-item');
        n.appendChild(el('i', 'bt-tk-sep', '◆'));
        n.appendChild(document.createTextNode(t));
        this.crawl.appendChild(n);
      }
    }
    this.layer.classList.remove('bt-hidden');
    this.layer.classList.remove('leaving');
    const { promise, session } = runModal<void>(this.layer, this.input, (p) => {
      if (p.act === 'confirm' || p.act === 'alt' || p.key === 'pad:0' || p.key === 'pad:9') this.go();
    }, {
      armMs: 350,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  private go(): void {
    const s = this.session;
    if (!s || s.done) return;
    this.layer.classList.add('leaving');
    s.finish(undefined, flashesReduced() ? 120 : 380);
  }
}

// ─────────────────────────────── PAUSE ───────────────────────────────

type PauseChoice = 'resume' | 'retry' | 'quit';
type PauseItem = 'resume' | 'settings' | 'retry' | 'quit';
const PAUSE_ITEMS: readonly PauseItem[] = ['resume', 'settings', 'retry', 'quit'];

export class PauseMenu {
  /** Called with the new Settings after the player edits them from this menu (already saved). */
  onSettings: ((s: Settings) => void) | null = null;

  private readonly input: Input;
  private readonly root: HTMLElement;
  private readonly layer: HTMLDivElement;
  private readonly items: HTMLButtonElement[] = [];
  private readonly confirmLine: HTMLElement;
  private settings: SettingsPanel | null = null;
  private sel = 0;
  private armed: PauseItem | null = null;
  private busy = false;
  private session: ModalSession<PauseChoice> | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.root = root;
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-pause bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR.pause.title);

    // test-card bars (top 2/3), castellations, pluge strip — in the station palette
    const bars = div('bt-tc-bars', L);
    for (let i = 0; i < 7; i++) div(`bt-tc-bar c${i}`, bars);
    const cast = div('bt-tc-cast', L);
    for (let i = 0; i < 7; i++) div(`bt-tc-cb c${i}`, cast);
    const pl = div('bt-tc-pluge', L);
    for (let i = 0; i < 6; i++) div(`bt-tc-pl c${i}`, pl);
    div('bt-scanlines', L);
    buildBug(L);

    const card = div('bt-pause-card', L);
    div('bt-pause-tc', card, STR.pause.testCard);
    div('bt-pause-title', card, STR.pause.title);
    div('bt-pause-sub', card, STR.pause.sub);
    const list = div('bt-pause-list', card);
    list.setAttribute('role', 'menu');
    PAUSE_ITEMS.forEach((id, i) => {
      const b = el('button', 'bt-menu-item');
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('role', 'menuitem');
      b.appendChild(el('span', 'bt-menu-num', String(i + 1).padStart(2, '0')));
      b.appendChild(el('span', 'bt-menu-lbl', this.label(id)));
      list.appendChild(b);
      this.items.push(b);
      b.addEventListener('mouseenter', () => { if (!this.busy) this.select(i); });
      onTap(b, () => { if (!this.busy) { this.select(i); this.activate(); } });
    });
    this.confirmLine = div('bt-pause-confirm', card);
    div('bt-pause-keys', card, STR.pause.keys);
  }

  open(): Promise<PauseChoice> {
    if (this.session && !this.session.done) this.session.abort();
    this.armed = null;
    this.busy = false;
    this.confirmLine.textContent = '';
    this.select(0);
    this.layer.classList.remove('bt-hidden');
    pulse(this.layer, [{ opacity: 0 }, { opacity: 1 }], 160);
    const { promise, session } = runModal<PauseChoice>(this.layer, this.input, (p) => this.onPress(p), {
      armMs: 200,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  private label(id: PauseItem): string {
    switch (id) {
      case 'resume': return STR.pause.resume;
      case 'settings': return STR.pause.settings;
      case 'retry': return STR.pause.retry;
      case 'quit': return STR.pause.quit;
    }
  }

  private onPress(p: UiPress): void {
    if (this.busy) return;
    switch (p.act) {
      case 'up': case 'left': this.select(wrapIndex(this.sel - 1, this.items.length)); break;
      case 'down': case 'right': this.select(wrapIndex(this.sel + 1, this.items.length)); break;
      case 'confirm': this.activate(); break;
      case 'back': case 'pause': this.finish('resume'); break;
      case 'pick1': this.select(0); this.activate(); break;
      case 'pick2': this.select(1); this.activate(); break;
      case 'pick3': this.select(2); this.activate(); break;
      default: break;
    }
  }

  private select(i: number): void {
    if (i !== this.sel && this.armed) { this.armed = null; this.confirmLine.textContent = ''; this.refreshArmed(); }
    this.sel = i;
    this.items.forEach((b, j) => b.classList.toggle('is-sel', j === i));
  }

  private refreshArmed(): void {
    this.items.forEach((b, j) => b.classList.toggle('armed', this.armed !== null && PAUSE_ITEMS[j] === this.armed));
  }

  private activate(): void {
    const id = PAUSE_ITEMS[this.sel];
    if (id === 'resume') { this.finish('resume'); return; }
    if (id === 'settings') { void this.openSettings(); return; }
    // retry / quit: second press confirms
    if (this.armed === id) { this.finish(id); return; }
    this.armed = id;
    this.confirmLine.textContent = id === 'retry' ? STR.pause.confirmRetry : STR.pause.confirmQuit;
    this.refreshArmed();
    pulse(this.items[this.sel], [{ transform: 'translateX(-3%)' }, { transform: 'translateX(2%)' }, { transform: 'translateX(0)' }], 220);
  }

  private finish(v: PauseChoice): void {
    const s = this.session;
    if (!s || s.done) return;
    s.finish(v, v === 'resume' ? 0 : 120);
  }

  private async openSettings(): Promise<void> {
    const outer = this.session;
    if (!outer || outer.done || this.busy) return;
    this.busy = true;
    // the pause session keeps its UiKeys running; it ignores presses while busy (the settings
    // panel runs its own session on top and restores 'ui' mode when it closes)
    if (!this.settings) this.settings = new SettingsPanel(this.root, this.input);
    this.layer.classList.add('dim');
    const next = await this.settings.open(loadSettings());
    saveSettings(next);
    applyUiSettings(next);
    try { window.dispatchEvent(new CustomEvent('bt-settings', { detail: next })); } catch { /* ignore */ }
    if (this.onSettings) { try { this.onSettings(next); } catch (e) { console.error(e); } }
    this.layer.classList.remove('dim');
    // swallow the key that closed the settings panel before the pause menu listens again
    setTimeout(() => { this.busy = false; }, 120);
  }
}

// ─────────────────────────────── SETTINGS ───────────────────────────────

type RowKind = 'master' | 'music' | 'sfx' | 'quality' | 'screenShake' | 'reduceFlashing' | 'done';
const ROWS: readonly RowKind[] = ['master', 'music', 'sfx', 'quality', 'screenShake', 'reduceFlashing', 'done'];
const VOL_STEPS = 20;

interface RowUi { row: HTMLElement; segs: HTMLElement[]; val: HTMLElement; }

export class SettingsPanel {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly rows: Partial<Record<RowKind, RowUi>> = {};
  private s: Settings = loadSettings();
  private sel = 0;
  private session: ModalSession<Settings> | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-settings bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR.settings.title);
    const panel = div('bt-set-panel', L);
    const head = div('bt-set-head', panel);
    head.appendChild(el('span', 'bt-set-tag', STR.network));
    head.appendChild(el('span', 'bt-set-title', STR.settings.title));
    head.appendChild(el('span', 'bt-set-sub', STR.settings.sub));
    const body = div('bt-set-body', panel);

    ROWS.forEach((k, i) => {
      const row = div(`bt-set-row k-${k}`, body);
      row.addEventListener('mouseenter', () => this.select(i));
      if (k === 'done') {
        row.classList.add('done');
        const b = el('button', 'bt-btn bt-btn-coral', STR.settings.done);
        b.type = 'button';
        b.tabIndex = -1;
        row.appendChild(b);
        onTap(b, () => this.done());
        this.rows[k] = { row, segs: [], val: b };
        return;
      }
      row.appendChild(el('span', 'bt-set-lbl', this.label(k)));
      const ctl = div('bt-set-ctl', row);
      const segs: HTMLElement[] = [];
      if (k === 'master' || k === 'music' || k === 'sfx') {
        ctl.classList.add('vol');
        for (let j = 0; j < VOL_STEPS; j++) {
          const sg = div('bt-set-seg', ctl);
          segs.push(sg);
          onTap(sg, () => { this.select(i); this.setVol(k, (j + 1) / VOL_STEPS); });
        }
      } else if (k === 'quality') {
        ctl.classList.add('opts');
        STR.settings.qualityLevels.forEach((q, j) => {
          const o = div('bt-set-opt', ctl, q);
          segs.push(o);
          onTap(o, () => { this.select(i); this.s.quality = j as 0 | 1 | 2; this.render(); });
        });
      } else {
        ctl.classList.add('opts');
        [STR.settings.off, STR.settings.on].forEach((q, j) => {
          const o = div('bt-set-opt', ctl, q);
          segs.push(o);
          onTap(o, () => { this.select(i); this.setBool(k, j === 1); });
        });
      }
      const val = el('span', 'bt-set-val');
      row.appendChild(val);
      this.rows[k] = { row, segs, val };
    });
    div('bt-set-keys', panel, STR.settings.keys);
  }

  open(s: Settings): Promise<Settings> {
    if (this.session && !this.session.done) this.session.abort();
    this.s = { ...s };
    this.sel = 0;
    this.render();
    this.select(0);
    this.layer.classList.remove('bt-hidden');
    pulse(this.layer.firstElementChild as HTMLElement, [
      { transform: 'translateY(4%) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 },
    ], 200);
    const { promise, session } = runModal<Settings>(this.layer, this.input, (p) => this.onPress(p), {
      armMs: 180,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  private label(k: RowKind): string {
    switch (k) {
      case 'master': return STR.settings.master;
      case 'music': return STR.settings.music;
      case 'sfx': return STR.settings.sfx;
      case 'quality': return STR.settings.quality;
      case 'screenShake': return STR.settings.screenShake;
      case 'reduceFlashing': return STR.settings.reduceFlashing;
      case 'done': return STR.settings.done;
    }
  }

  private onPress(p: UiPress): void {
    const k = ROWS[this.sel];
    switch (p.act) {
      case 'up': this.select(wrapIndex(this.sel - 1, ROWS.length)); break;
      case 'down': this.select(wrapIndex(this.sel + 1, ROWS.length)); break;
      case 'left': this.adjust(k, -1); break;
      case 'right': this.adjust(k, 1); break;
      case 'confirm': case 'alt':
        if (k === 'done') this.done();
        else if (k === 'screenShake' || k === 'reduceFlashing') this.setBool(k, !this.s[k]);
        else if (k === 'quality') { this.s.quality = ((this.s.quality + 1) % 3) as 0 | 1 | 2; this.render(); }
        else this.select(ROWS.length - 1);
        break;
      case 'back': case 'pause': this.done(); break;
      default: break;
    }
  }

  private adjust(k: RowKind, d: number): void {
    if (k === 'master' || k === 'music' || k === 'sfx') this.setVol(k, this.s[k] + d / VOL_STEPS);
    else if (k === 'quality') { this.s.quality = Math.max(0, Math.min(2, this.s.quality + d)) as 0 | 1 | 2; this.render(); }
    else if (k === 'screenShake' || k === 'reduceFlashing') this.setBool(k, d > 0);
  }

  private setVol(k: 'master' | 'music' | 'sfx', v: number): void {
    this.s[k] = Math.round(Math.max(0, Math.min(1, v)) * VOL_STEPS) / VOL_STEPS;
    this.render();
  }

  private setBool(k: 'screenShake' | 'reduceFlashing', v: boolean): void {
    this.s[k] = v;
    if (k === 'reduceFlashing') applyUiSettings(this.s);   // live preview of the calmer UI
    this.render();
  }

  private select(i: number): void {
    this.sel = i;
    ROWS.forEach((k, j) => this.rows[k]?.row.classList.toggle('is-sel', j === i));
  }

  private render(): void {
    for (const k of ROWS) {
      const r = this.rows[k];
      if (!r || k === 'done') continue;
      if (k === 'master' || k === 'music' || k === 'sfx') {
        const n = Math.round(this.s[k] * VOL_STEPS);
        r.segs.forEach((sg, j) => sg.classList.toggle('on', j < n));
        r.val.textContent = `${Math.round(this.s[k] * 100)}%`;
      } else if (k === 'quality') {
        r.segs.forEach((sg, j) => sg.classList.toggle('on', j === this.s.quality));
        r.val.textContent = '';
      } else {
        const on = !!this.s[k];
        r.segs.forEach((sg, j) => sg.classList.toggle('on', (j === 1) === on));
        r.val.textContent = '';
      }
    }
  }

  private done(): void {
    const s = this.session;
    if (!s || s.done) return;
    s.finish({ ...this.s }, 0);
  }
}
