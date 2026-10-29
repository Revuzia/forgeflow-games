// GENESIS — the HUD (CONTRACT.md §16.1): top left the world's name, its calendar (year, season, day, the local hour
// where the camera looks) and the time controls (pause and every speed step, 1× to 3000×, the step a minute / an hour /
// a day) with the achieved multiplier and the time-lapse badge; top right the worlds strip (click to fly; the living on
// each) and, under it, the god's card: worship, how the people hold you (feared · awed · trusted, and their faith,
// fear, trust and loyalty), the open prayers, the wrath law and the rival gods by name — a click opens The god
// (src/ui/living.ts). Bottom centre the dock (the current tool's card sits above it: src/ui/tools.ts) with the doors to
// the palette, the radial, the "do this" field, sigils, overlays, the chronicle, settings and the controls card; bottom
// left the toasts and a one-line chronicle ticker. Settlement names float over the world (with their age, and a lamp
// while they pray), planet markers over the system view, prayer lamps over praying towns from orbit, and the dev
// overlay (?dev=1) lists draw calls, triangles, patches and the life layer's counts.
// Two layers: `world` (things pinned to places on screen: labels, markers, the selection, "here") is never scaled;
// `root` (the panels) takes the interface scale from the settings. Only a settlement's NAME takes a click (the label
// box does not), and while the pointer belongs to a tool, a sigil or the Touch the names let presses through to the
// world (the world layer's `gn-busy`); while the radial, the palette or a sigil card is up they hide (`gn-hush`).
// The frame rate shows only on request (?dev=1 or the setting): it is the developer's number, not the player's. Worship
// spent on a miracle pulses the god's card with what was spent.
// The calendar is the local one where the camera looks: the hour, the day, the season and the year roll over together
// (a day begins at local midnight). Each speed step carries its key in its corner (1–0 for 1× … 3000×). While the
// opening speaks the HUD is quiet (`setQuiet`: pause, 1×, 10×, 100×, 1000× only, no key strip); the key strip under it
// forgets each control once it has been used (`used`), and goes when all are learnt.

/// <reference types="vite/client" />
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import './styles.css';
import interDigits500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import interDigits600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import { Vector2 } from 'three';
import type { WorldView, PlanetView } from '../client/worldview.ts';
import type { RenderStats } from '../render/renderer.ts';
import type { CameraPose } from '../render/frame.ts';
import type { UnitVec, ChronicleEntry } from '../sim/types.ts';
import { SPEED_PRESETS } from '../sim/types.ts';
import { qRotate, qRotateInv } from '../client/orbits.ts';
import { Toasts, type ToastSpec } from './toasts.ts';
import { stripYear } from './words.ts';
import { h, fmtNum, cap } from './dom.ts';
import { icon } from './icons.ts';
import { wrathWord, WRATH_DEFAULT } from './powers.ts';
import { PrayerMarks, labelSigns, regardOf, regardValue, bandOf, meterRow, openPrayers, godTitle, METERS, PRAYER_WORDS, type GodRow } from './living.ts';

export interface HudActions {
  setSpeed(x: number): void;
  step(ticks: number): void;
  flyTo(planet: number): void;
  /** fly the camera to a place on a world (a toast was clicked) */
  lookAt(planet: number, pos: UnitVec): void;
  /** select a settlement (its label was clicked) */
  selectSettlement(planet: number, id: number): void;
  /** a UI action by id (keybinds.ts): the dock's buttons */
  action(id: string): void;
  /** the key hint of an action ("/", "Ctrl K") */
  hint(id: string): string;
}

export interface HudFrame {
  view: WorldView;
  pose: CameraPose;
  stats: RenderStats;
  fps: number;
  primary: number;
  systemView: boolean;
  project(sys: ArrayLike<number>, out: Vector2): Vector2 | null;
  source: string;
  snapshotHz: number;
  /** camera altitude above the ground (m): settlement labels show between a hamlet's roofs and orbit */
  altitude: number;
  /** the selected thing: its own marker names it, so its label steps aside */
  selected?: { kind: string; id: number; planet?: number } | null;
  /** body-frame ground radius at a unit vector of a planet (labels stand on the ground) */
  groundRadius(planet: number, u: ArrayLike<number>): number;
  /** life layer counts for the dev overlay */
  life?: { people: number; ambient: number; animals: number; buildings: number; variants: number; pending: number; roads: number } | null;
  /** the dock's state: which doors are open */
  open?: { palette: boolean; radial: boolean; freeform: boolean; gesture: boolean; overlay: string | null; chronicle: boolean; tool: boolean };
  labels?: boolean;
  ticker?: boolean;
  /** show the frame rate beside the achieved speed */
  showFps?: boolean;
}

const ICON_PAUSE = '<svg viewBox="0 0 12 12"><rect x="2" y="1.5" width="2.8" height="9" rx=".6"/><rect x="7.2" y="1.5" width="2.8" height="9" rx=".6"/></svg>';
const ICON_STEP = '<svg viewBox="0 0 12 12"><path d="M2 1.8v8.4L7.6 6z"/><rect x="8.4" y="1.8" width="1.8" height="8.4" rx=".5"/></svg>';
const ICON_CARET = '<svg viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Lining figures inside the serif face: Cormorant Garamond's old-style numerals read "Year 1" as "Year ı" and "50" as
 * "5o". The serif family (styles.css --gn-serif) begins with 'GN Digits', a face that covers ONLY the digits (its
 * unicode-range) with Inter's, sized down to sit with Cormorant's small x-height; every other letter falls through to
 * Cormorant. Upright and italic, regular and bold weights all map to it.
 */
function installDigits(): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  const faces: [string, string][] = [['300 550', interDigits500], ['551 800', interDigits600]];
  for (const [weight, url] of faces) for (const style of ['normal', 'italic']) {
    try {
      const f = new FontFace('GN Digits', `url(${url}) format('woff2')`, { weight, style, unicodeRange: 'U+0030-0039', display: 'swap', sizeAdjust: '86%' } as FontFaceDescriptors);
      document.fonts.add(f);
      void f.load().catch(() => { /* the serif's own figures remain */ });
    } catch { /* an engine without FontFace descriptors: the serif's own figures remain */ }
  }
}
installDigits();

/** the key strip's controls, in order: the id `used` takes, the key (or its action), what it does */
const HINTS: [string, string, string][] = [
  ['drag', 'drag', 'turn'], ['wheel', 'wheel', 'descend'], ['click', 'click', 'inspect'], ['ui.palette', '/', 'powers'], ['ui.freeform', 'Enter', 'do this'],
  ['ui.radial', 'Q', 'radial'], ['ui.gesture', 'G', 'sigil'], ['ui.help', 'F1', 'controls'],
];
const HINTS_KEY = 'genesis.hints.learnt.v1';
/** the presets the quiet HUD keeps (the opening): pause, the slow real 1×, and a few steps toward the time-lapse */
const QUIET_SPEEDS = new Set<number>([0, 1, 10, 100, 1000]);

/** a day length in hours as the clock says it: 30 → "30", 26.5 → "26.5" */
export function fmtDayHours(h: number): string { return String(Math.round(h * 10) / 10); }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function planetColor(kind: string): string {
  switch (kind) {
    case 'terran': return 'radial-gradient(circle at 35% 30%, #bfe0ff, #3a7fc4 40%, #2d6b3a 62%, #0b1d33)';
    case 'ocean': return 'radial-gradient(circle at 35% 30%, #d4ecff, #2f73c0 45%, #0b2550)';
    case 'jungle': return 'radial-gradient(circle at 35% 30%, #d6f2c0, #3c8a3a 45%, #0f2b14)';
    case 'desert': return 'radial-gradient(circle at 35% 30%, #ffd2a8, #c46a3a 50%, #4a1d0c)';
    case 'moon': return 'radial-gradient(circle at 35% 30%, #f0f0f0, #8d8d8d 55%, #232323)';
    case 'ice': return 'radial-gradient(circle at 35% 30%, #fff, #a6d2ef 55%, #29475e)';
    case 'volcanic': case 'lava': return 'radial-gradient(circle at 35% 30%, #ffb07a, #8a2a12 45%, #1a0805)';
    case 'methane': return 'radial-gradient(circle at 35% 30%, #ffe2a8, #b0803a 50%, #3a2408)';
    default: return 'radial-gradient(circle at 35% 30%, #d8d0c8, #6f665e 55%, #1b1815)';
  }
}

export class Hud {
  /** the panels (scaled by the interface scale) */
  readonly root: HTMLDivElement;
  /** things pinned to places in the world (never scaled) */
  readonly world: HTMLDivElement;
  private worldName: HTMLSpanElement;
  private worldKind: HTMLSpanElement;
  private calText: HTMLSpanElement;
  private clock: HTMLSpanElement;
  private skyDot: HTMLSpanElement;
  private speedBtns = new Map<number, HTMLButtonElement>();
  private achieved: HTMLDivElement;
  private stepMenu: HTMLDivElement;
  private worlds: HTMLDivElement;
  private worldBtns = new Map<number, HTMLButtonElement>();
  private faith: HTMLDivElement;
  private faithKey = '';
  /** the rival gods by name and epithet (the shell asks the sim now and then: query 'gods') */
  private gods: GodRow[] = [];
  /** prayer lamps over praying towns, from orbit */
  readonly prayerMarks: PrayerMarks;
  /** worship as last shown, and the "−15" that floats when some is spent */
  private lastWorship = -1;
  private spentEl: HTMLSpanElement | null = null;
  private spentAt = -1e9;
  private spent = 0;
  private markers: HTMLDivElement;
  private markerEls = new Map<number, HTMLDivElement>();
  private labels: HTMLDivElement;
  private labelEls = new Map<string, { el: HTMLDivElement; text: string }>();
  readonly toasts: Toasts;
  readonly dock: HTMLDivElement;
  private dockBtns = new Map<string, HTMLButtonElement>();
  private ticker: HTMLButtonElement;
  private tickerSeen = 0;
  private tickerAt = -1e9;
  private hint: HTMLDivElement;
  private dev: HTMLDivElement | null = null;
  private lastText = '';
  private lastClock = '';
  private v2 = new Vector2();
  private actions: HudActions;
  private speedIds: Record<number, string> = Object.fromEntries(SPEED_PRESETS.map((x) => [x, x === 0 ? 'time.pause' : `time.speed${x}`]));
  /** the key strip's controls already used (kept in this browser) */
  private learnt = new Set<string>();
  private hintOn = true;
  private quiet = false;

  constructor(parent: HTMLElement, actions: HudActions, devOverlay: boolean) {
    this.actions = actions;
    this.world = el('div', 'gn-world-layer');
    parent.appendChild(this.world);
    this.root = el('div', 'gn-ui');
    parent.appendChild(this.root);
    // ── time panel ──
    const time = el('div', 'gn-panel gn-time');
    const world = el('div', 'gn-world');
    this.worldName = el('span', 'gn-world-name');
    this.worldKind = el('span', 'gn-world-kind');
    world.append(this.worldName, this.worldKind);
    const cal = el('div', 'gn-cal');
    this.skyDot = el('span', 'gn-sky');
    this.calText = el('span');
    this.clock = el('span', 'gn-clock');
    cal.append(this.skyDot, this.calText, this.clock);
    const speeds = el('div', 'gn-speeds');
    const speedIds = this.speedIds;
    for (const s of SPEED_PRESETS) {
      const b = el('button', 'gn-btn gn-spd', s === 0 ? ICON_PAUSE : `${s}×`) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.s = String(s);
      b.setAttribute('aria-label', s === 0 ? 'Pause' : `Speed ${s} times`);
      b.addEventListener('mouseenter', () => { const k = actions.hint(speedIds[s]); b.title = `${s === 0 ? 'Pause' : `Speed ${s}×`}${k ? ` (${k})` : ''}`; });
      b.addEventListener('click', () => actions.setSpeed(s));
      this.speedBtns.set(s, b);
      speeds.appendChild(b);
    }
    const stepWrap = el('div', 'gn-stepwrap');
    const step = el('button', 'gn-btn gn-step', ICON_STEP) as HTMLButtonElement;
    step.type = 'button';
    step.setAttribute('aria-label', 'Step an hour');
    step.addEventListener('mouseenter', () => { step.title = `Step one hour (${actions.hint('time.stepHour') || '.'}) · shift: one day`; });
    step.addEventListener('click', (e) => actions.step(e.shiftKey ? this.dayTicks() : 60));
    const caret = el('button', 'gn-btn gn-step-caret', ICON_CARET) as HTMLButtonElement;
    caret.type = 'button';
    caret.title = 'Step by…';
    caret.setAttribute('aria-label', 'Step by');
    this.stepMenu = el('div', 'gn-panel gn-stepmenu');
    this.stepMenu.hidden = true;
    const stepItem = (label: string, ticks: () => number, id: string) => {
      const b = el('button', 'gn-stepmenu-b') as HTMLButtonElement;
      b.type = 'button';
      b.append(document.createTextNode(label));
      const k = el('kbd');
      b.append(k);
      b.addEventListener('mouseenter', () => { k.textContent = actions.hint(id); });
      b.addEventListener('click', () => { this.stepMenu.hidden = true; actions.step(ticks()); });
      this.stepMenu.append(b);
    };
    stepItem('one minute', () => 1, 'time.stepTick');
    stepItem('one hour', () => 60, 'time.stepHour');
    stepItem('one day', () => this.dayTicks(), 'time.stepDay');
    caret.addEventListener('click', () => { this.stepMenu.hidden = !this.stepMenu.hidden; caret.setAttribute('aria-expanded', String(!this.stepMenu.hidden)); });
    document.addEventListener('pointerdown', (e) => { if (!this.stepMenu.hidden && !stepWrap.contains(e.target as Node)) this.stepMenu.hidden = true; });
    stepWrap.append(step, caret, this.stepMenu);
    // (the presets are one segmented row; the step and the speed the worlds keep sit under it)
    const row = el('div', 'gn-timerow');
    row.appendChild(stepWrap);
    this.achieved = el('div', 'gn-achieved');
    row.appendChild(this.achieved);
    time.append(world, cal, speeds, row);
    this.root.appendChild(time);
    // the world switcher on the right never reaches over the time panel (the site's 888-px frame, seven worlds): it
    // wraps within what the panel leaves (styles.css .gn-worlds reads --gn-time-r)
    const timeEdge = () => { const r = time.getBoundingClientRect(); if (r.width > 0) this.root.style.setProperty('--gn-time-r', `${Math.ceil(r.right)}px`); };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(timeEdge).observe(time);
    addEventListener('resize', timeEdge);
    // ── top right: worlds strip + worship / belief ──
    const right = el('div', 'gn-topright');
    this.worlds = el('div', 'gn-panel gn-worlds');
    this.faith = el('div', 'gn-panel gn-faith');
    this.faith.setAttribute('role', 'button');
    this.faith.tabIndex = 0;
    this.faith.addEventListener('mouseenter', () => { const k = actions.hint('ui.god'); this.faith.title = `How the people hold you — open The god${k ? ` (${k})` : ''}`; });
    this.faith.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-god]');
      actions.action(chip ? `ui.god@${chip.dataset.god}` : 'ui.god');
    });
    this.faith.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); actions.action('ui.god'); } });
    right.append(this.worlds, this.faith);
    this.root.appendChild(right);
    // ── world-pinned layers ──
    this.markers = el('div', 'gn-markers');
    this.world.appendChild(this.markers);
    this.labels = el('div', 'gn-markers gn-labels');
    this.world.appendChild(this.labels);
    this.prayerMarks = new PrayerMarks(this.world);
    // ── toasts + ticker ──
    this.toasts = new Toasts(this.root, { lookAt: (planet, pos) => actions.lookAt(planet, pos) });
    this.ticker = el('button', 'gn-ticker') as HTMLButtonElement;
    this.ticker.type = 'button';
    this.ticker.title = `The chronicle (${actions.hint('ui.chronicle') || 'C'})`;
    this.ticker.hidden = true;
    this.ticker.addEventListener('click', () => actions.action('ui.chronicle'));
    this.root.appendChild(this.ticker);
    // ── dock ──
    this.dock = el('div', 'gn-panel gn-dock');
    const door = (id: string, ic: string, label: string, action: string) => {
      const b = el('button', 'gn-dock-b', icon(ic)) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.append(el('span', 'gn-dock-l', label));
      b.addEventListener('mouseenter', () => { const k = actions.hint(action); b.title = `${label}${k ? ` (${k})` : ''}`; });
      b.addEventListener('click', (e) => {
        if (action === 'ui.radial') { const r = b.getBoundingClientRect(); actions.action(`ui.radial@${Math.round(r.left + r.width / 2)},${Math.round(r.top - 280)}`); return; }
        void e;
        actions.action(action);
      });
      this.dockBtns.set(id, b);
      this.dock.append(b);
    };
    door('palette', 'palette', 'Powers', 'ui.palette');
    door('radial', 'radial', 'Radial', 'ui.radial');
    door('freeform', 'words', 'Do this', 'ui.freeform');
    door('gesture', 'gesture', 'Sigil', 'ui.gesture');
    this.dock.append(el('span', 'gn-dock-sep'));
    door('overlay', 'overlay', 'Overlay', 'ui.overlayNext');
    door('chronicle', 'chronicle', 'Chronicle', 'ui.chronicle');
    door('laws', 'law', 'Laws', 'ui.laws');
    door('camera', 'camera', 'Camera', 'cam.menu');
    this.dock.append(el('span', 'gn-dock-sep'));
    door('saves', 'save', 'Saves', 'ui.saves');
    door('settings', 'settings', 'Settings', 'ui.settings');
    door('help', 'help', 'Controls', 'ui.help');
    this.root.appendChild(this.dock);
    this.hint = el('div', 'gn-hint');
    this.root.appendChild(this.hint);
    try { for (const id of JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]') as string[]) this.learnt.add(id); } catch { /* a fresh strip */ }
    this.refreshSpeedKeys();
    this.clock.title = 'The local hour where you look';
    if (devOverlay) {
      this.dev = el('div', 'gn-panel gn-dev');
      this.root.appendChild(this.dev);
    }
  }

  private dayH = 24;
  private dayTicks(): number { return Math.max(60, Math.round(this.dayH * 60)); }

  /** labels built from key bindings (after a rebinding) */
  refreshKeys(): void {
    const k = this.actions.hint('ui.chronicle');
    this.ticker.title = `The chronicle${k ? ` (${k})` : ''}`;
    this.refreshSpeedKeys();
  }

  /** each speed preset with a key of its own shows it in its corner (a short key only: "3", not "Shift Space") */
  private refreshSpeedKeys(): void {
    for (const [s, b] of this.speedBtns) {
      const id = this.speedIds[s];
      const k = id && s !== 0 ? this.actions.hint(id) : '';
      if (k && k.length <= 2) b.dataset.key = k; else delete b.dataset.key;
    }
  }

  /**
   * The opening's quiet HUD: pause, 1×, 10×, 100× and nothing of the key strip, so the first whispers are not read
   * through a list of controls (every power still works; the dock stays)
   */
  setQuiet(q: boolean): void {
    this.quiet = q;
    this.root.classList.toggle('gn-quiet', q);
    for (const [s, b] of this.speedBtns) b.hidden = q && !QUIET_SPEEDS.has(s);
    this.setHint(this.hintOn);
  }

  /** a control of the key strip was used: it fades from the strip (and stays learnt in this browser) */
  used(id: string): void {
    if (this.learnt.has(id) || !HINTS.some((x) => x[0] === id)) return;
    this.learnt.add(id);
    try { localStorage.setItem(HINTS_KEY, JSON.stringify([...this.learnt])); } catch { /* learnt for this visit only */ }
    const item = this.hint.querySelector<HTMLElement>(`[data-hint="${id}"]`);
    if (!item) return;
    item.classList.add('gn-gone');
    setTimeout(() => this.setHint(this.hintOn), 650);
  }

  /** Esc: close a popover (the step menu); true when one was open */
  closePopovers(): boolean {
    if (this.stepMenu.hidden) return false;
    this.stepMenu.hidden = true;
    return true;
  }

  /** the world layer's mode: busy (names let presses through to the world), hushed (names and markers hidden) */
  setWorldMode(busy: boolean, hush: boolean): void {
    this.world.classList.toggle('gn-busy', busy);
    this.world.classList.toggle('gn-hush', hush);
  }

  /** the controls hint line's box while it is on screen (null when hidden or faded out) */
  hintRect(): DOMRect | null {
    if (this.hint.hidden || getComputedStyle(this.hint).opacity === '0' || getComputedStyle(this.hint).display === 'none') return null;
    const r = this.hint.getBoundingClientRect();
    return r.width > 0 ? r : null;
  }

  /** where the chronicle ticker stands while it shows (null when hidden or faded out) */
  tickerRect(): DOMRect | null {
    if (this.ticker.hidden || this.ticker.classList.contains('gn-fade')) return null;
    const r = this.ticker.getBoundingClientRect();
    return r.width > 0 ? r : null;
  }

  /** the shell's layout pass: where the toasts sit, how far the ticker may run */
  layout(o: { toastBottom: number; toastTop: boolean; tickerMax: number; toastLeft?: number; toastMaxW?: number }): void {
    this.root.style.setProperty('--gn-toast-bottom', `${Math.round(o.toastBottom)}px`);
    // (a window open on the left — the chronicle, The god — would cover the column: it stands beside the window instead)
    if (o.toastLeft !== undefined) this.root.style.setProperty('--gn-toast-left', `${Math.round(o.toastLeft)}px`); else this.root.style.removeProperty('--gn-toast-left');
    if (o.toastMaxW !== undefined) this.root.style.setProperty('--gn-toast-maxw', `${Math.round(o.toastMaxW)}px`); else this.root.style.removeProperty('--gn-toast-maxw');
    this.root.style.setProperty('--gn-ticker-max', `${Math.round(o.tickerMax)}px`);
    // too narrow beside the dock (the site's 888 × 500 frame) for the date and the line side by side: the date stands
    // over the line, and the line may take two lines
    this.ticker.classList.toggle('gn-ticker-stack', o.tickerMax < 320);
    this.toasts.root.classList.toggle('gn-toasts-top', o.toastTop);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('gn-hidden', !v);
    this.world.classList.toggle('gn-hidden', !v);
  }

  /** a plain message (command results, warnings) */
  toast(text: string, ms = 4200, kind: ToastSpec['kind'] = 'info'): void {
    this.toasts.show({ text, ms, kind });
  }

  /** refresh the controls hint line (keys may have been rebound; controls used are left out) */
  setHint(show: boolean): void {
    this.hintOn = show;
    const a = this.actions;
    const items = HINTS.filter(([id]) => !this.learnt.has(id));
    this.hint.hidden = !show || this.quiet || !items.length;
    if (this.hint.hidden) return;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
    this.hint.innerHTML = items.map(([id, key, what]) => `<span class="gn-hint-i" data-hint="${id}"><kbd>${esc(id.startsWith('ui.') ? a.hint(id) || key : key)}</kbd> ${what}</span>`).join('<span class="gn-sep">·</span>');
  }

  private syncWorlds(view: WorldView, primary: number): void {
    for (const pv of view.planets) {
      let b = this.worldBtns.get(pv.id);
      if (!b) {
        b = el('button', 'gn-btn gn-worldbtn') as HTMLButtonElement;
        b.type = 'button';
        const i = el('i');
        const s = el('span');
        s.textContent = pv.name;
        const n = el('small', 'gn-pop');
        b.append(i, s, n);
        b.title = `Fly to ${pv.name}`;
        const id = pv.id;
        b.addEventListener('click', () => this.actions.flyTo(id));
        this.worldBtns.set(pv.id, b);
        this.worlds.appendChild(b);
      }
      (b.firstElementChild as HTMLElement).style.background = planetColor(pv.params.atmosphere.pressure > 0.05 && pv.params.kind === 'barren' ? 'terran' : pv.params.kind);
      b.classList.toggle('gn-here', pv.id === primary);
      b.classList.toggle('gn-moonbtn', pv.params.orbit.parent >= 0);
      let pop = 0;
      for (const v of pv.population) pop += v;
      const badge = b.lastElementChild as HTMLElement;
      const txt = pop > 0 ? fmtNum(pop) : '';
      if (badge.textContent !== txt) { badge.textContent = txt; b.title = `Fly to ${pv.name}${pop ? ` — ${pop} living` : ''}`; }
      const name = b.children[1] as HTMLElement;
      if (name.textContent !== pv.name) name.textContent = pv.name;
    }
    for (const [id, b] of this.worldBtns) if (!view.planet(id)) { b.remove(); this.worldBtns.delete(id); }
  }

  /** the rival gods by name and epithet (query 'gods') */
  setGods(list: GodRow[]): void { this.gods = list; }

  /**
   * The god's card: worship (the pool miracles draw on), how the people of this world hold you — the band (feared ·
   * awed · trusted) on its gauge and their faith, fear, trust and loyalty — the open prayers, the wrath law and the
   * rival gods by name. A click opens The god; its chips open it at their section.
   */
  private syncFaith(view: WorldView, primary: number): void {
    const m = regardOf(view, primary);
    const r = regardValue(view, m);
    const prayers = openPrayers(view, primary);
    const w = view.worship[0] ?? 0;
    const wrath = view.wrath ?? WRATH_DEFAULT;
    // worship spent (a miracle drew on it for strength): pulse the card and say how much
    const now = performance.now();
    if (this.lastWorship >= 0 && w < this.lastWorship - 0.5) {
      this.spent = (now - this.spentAt < 2500 ? this.spent : 0) + (this.lastWorship - w);
      this.spentAt = now;
      this.faith.classList.remove('gn-spent');
      void this.faith.offsetWidth;
      this.faith.classList.add('gn-spent');
    }
    this.lastWorship = w;
    if (this.spentEl && now - this.spentAt > 2600) { this.spentEl.remove(); this.spentEl = null; }
    const rivals = this.gods.filter((g) => g.id !== 0 && g.alive !== false && (view.worship[g.id] ?? g.worship ?? 0) > 0.5);
    const key = `${Math.round(w)}|${r.toFixed(2)}|${m ? METERS.map((k) => Math.round(m[k] * 100)).join(',') : '-'}|${prayers.length}:${prayers[0]?.settlement ?? ''}|${wrath.toFixed(2)}|${rivals.map((g) => `${g.id}:${Math.round(view.worship[g.id] ?? 0)}`).join(',')}|${view.restraint}|${now - this.spentAt < 2500 ? Math.round(this.spent) : 0}`;
    if (key === this.faithKey) return;
    this.faithKey = key;
    this.faith.hidden = !m && w < 0.5;
    this.faith.innerHTML = '';
    const band = bandOf(r, m);
    this.faith.append(
      h('div', { class: 'gn-faith-top' },
        h('span', { class: 'gn-faith-i', html: icon('worship') }),
        h('span', { class: 'gn-faith-w' }, h('b', { text: fmtNum(Math.round(w)) }), h('small', { text: view.restraint ? 'worship · restraint' : 'worship' })),
        h('span', { class: `gn-faith-band gn-band-${band}` },
          h('b', { text: cap(band) }),
          h('span', { class: 'gn-faith-gauge' }, h('i', { style: `left:${Math.round((Math.max(-1, Math.min(1, r)) + 1) * 50)}%` })))),
    );
    if (m) {
      const g = h('div', { class: 'gn-faith-m' });
      for (const k of METERS) g.append(meterRow(k, m[k], true));
      this.faith.append(g);
    }
    const chips = h('div', { class: 'gn-faith-chips' });
    if (prayers.length) {
      const p = prayers[0];
      chips.append(h('span', { class: 'gn-faith-chip gn-faith-pray', data: { god: 'prayers' }, title: `${prayers.length === 1 ? 'A prayer is' : `${prayers.length} prayers are`} open: ${prayers.slice(0, 3).map((q) => `${q.name} — ${PRAYER_WORDS[q.kind] ?? q.kind}`).join('; ')}` },
        h('span', { html: icon('prayer') }), prayers.length === 1 ? `${p.name} prays for ${PRAYER_WORDS[p.kind] ?? p.kind}` : `${prayers.length} prayers`));
    }
    chips.append(h('span', { class: `gn-faith-chip gn-faith-wrath${wrath >= 0.45 ? ' gn-hot' : ''}`, data: { god: 'wrath' }, title: `Wrath ${wrath.toFixed(2)}: how hard your harm falls` }, h('span', { html: icon('wrath') }), `wrath: ${wrathWord(wrath)}`));
    if (rivals.length) chips.append(h('span', { class: 'gn-faith-chip gn-faith-r', data: { god: 'rivals' }, title: 'Rival gods and the worship they hold' }, rivals.slice(0, 2).map((g) => `${godTitle(g)} ${fmtNum(Math.round(view.worship[g.id] ?? g.worship ?? 0))}`).join(' · ') + (rivals.length > 2 ? ` +${rivals.length - 2}` : '')));
    this.faith.append(chips);
    if (now - this.spentAt < 2500 && this.spent >= 1) {
      this.spentEl = h('span', { class: 'gn-faith-spent', text: `−${Math.round(this.spent)} worship · a stronger miracle` });
      this.faith.append(this.spentEl);
    }
  }

  private syncMarkers(f: HudFrame): void {
    const show = f.systemView;
    // where each world is on screen (a moon close to its world keeps its ring but not its name: the two would overlap)
    const at = new Map<number, [number, number]>();
    if (show) for (const pv of f.view.planets) { const q = f.project(pv.center, this.v2); if (q) at.set(pv.id, [q.x, q.y]); }
    for (const pv of f.view.planets) {
      let m = this.markerEls.get(pv.id);
      if (!m) {
        m = el('div', 'gn-marker' + (pv.params.orbit.parent >= 0 ? ' gn-moon' : ''));
        m.append(el('div', 'gn-ring'), el('div', 'gn-label'));
        const id = pv.id;
        m.addEventListener('click', () => this.actions.flyTo(id));
        this.markerEls.set(pv.id, m);
        this.markers.appendChild(m);
      }
      const p = show ? f.project(pv.center, this.v2) : null;
      if (!p) { m.style.opacity = '0'; m.style.pointerEvents = 'none'; continue; }
      m.style.opacity = '1';
      m.style.pointerEvents = 'auto';
      m.style.left = `${p.x.toFixed(1)}px`;
      m.style.top = `${p.y.toFixed(1)}px`;
      const parent = pv.params.orbit.parent >= 0 ? at.get(pv.params.orbit.parent) : undefined;
      m.classList.toggle('gn-near', !!parent && Math.hypot(parent[0] - p.x, parent[1] - p.y) < 64);
      const label = m.lastElementChild as HTMLDivElement;
      let pop = 0;
      for (const v of pv.population) pop += v;
      const txt = `${pv.name}<small>${pv.params.kind}${pop ? ` · ${fmtNum(pop)}` : ''}</small>`;
      if (label.innerHTML !== txt) label.innerHTML = txt;
    }
    for (const [id, m] of this.markerEls) if (!f.view.planet(id)) { m.remove(); this.markerEls.delete(id); }
  }

  /**
   * Settlement names over the primary world, from a few hundred metres up to low orbit: name, people and age (the
   * nearest dozen, fading with distance; a band's label follows its people). Click: select the settlement.
   */
  /** a screen rectangle names stay out of (the opening's whisper while it speaks), or null */
  keepOut: DOMRect | null = null;

  /**
   * The open windows' screen rectangles (the shell's layout pass). The HUD panels a window covers step back while it
   * is open, and so do the names under it: their text would otherwise read through the window's glass and compete
   * with its own.
   */
  private winRects: DOMRect[] = [];
  coverUnder(wins: DOMRect[]): void {
    this.winRects = wins;
    for (const c of this.root.children) {
      if (!(c instanceof HTMLElement) || c.matches('.gn-win, .gn-veil, .gn-toasts, .gn-title, .gn-open-veil')) continue;
      let under = false;
      // (what stands over the windows — the camera and photo layers, notes — is not under them)
      if (wins.length && !c.hidden && !((Number.parseInt(getComputedStyle(c).zIndex, 10) || 0) >= 9)) {
        const r = c.getBoundingClientRect();
        under = r.width > 0 && wins.some((w) => Math.min(r.right, w.right) - Math.max(r.left, w.left) > 6 && Math.min(r.bottom, w.bottom) - Math.max(r.top, w.top) > 6);
      }
      if (c.classList.contains('gn-under-win') !== under) c.classList.toggle('gn-under-win', under);
    }
  }

  private syncLabels(f: HudFrame, pv: PlanetView | undefined): void {
    const seen = new Set<string>();
    const ko = this.keepOut;
    const alt = f.altitude;
    if (pv && f.labels !== false && !f.systemView && alt > 70 && alt < 9000 && pv.settlements.length) {
      const R = pv.params.radius;
      const cam = f.pose.pos;
      const rel: [number, number, number] = [cam[0] - pv.center[0], cam[1] - pv.center[1], cam[2] - pv.center[2]];
      const cb = qRotateInv(pv.quat, rel);
      const cl = Math.hypot(cb[0], cb[1], cb[2]) || 1;
      const near = pv.settlements
        .filter((s) => !(s.flags & 2))
        .map((s) => ({ s, d: Math.acos(Math.min(1, (s.pos[0] * cb[0] + s.pos[1] * cb[1] + s.pos[2] * cb[2]) / cl)) * R }))
        .filter((q) => q.d < Math.max(900, alt * 2.2))
        .sort((a, b) => a.d - b.d)
        .slice(0, 12);
      const sel = f.selected && f.selected.kind === 'settlement' ? f.selected.id : -1;
      for (const { s, d } of near) {
        if (s.id === sel) continue;
        const key = `${pv.id}:${s.id}`;
        const g = f.groundRadius(pv.id, s.pos) + Math.min(40, 12 + alt * 0.02);
        const w = qRotate(pv.quat, [s.pos[0] * g, s.pos[1] * g, s.pos[2] * g]);
        const sys = [pv.center[0] + w[0], pv.center[1] + w[1], pv.center[2] + w[2]];
        const p = f.project(sys, this.v2);
        if (!p || p.x < -80 || p.y < -40 || p.x > window.innerWidth + 80 || p.y > window.innerHeight + 40) continue;
        // behind the planet's limb from orbit: the label's point is farther than the horizon
        const eye = Math.hypot(rel[0], rel[1], rel[2]);
        const toLabel = Math.hypot(sys[0] - cam[0], sys[1] - cam[1], sys[2] - cam[2]);
        if (toLabel > Math.sqrt(Math.max(0, eye * eye - R * R)) + 200) continue;
        seen.add(key);
        let rec = this.labelEls.get(key);
        if (!rec) {
          const e = el('div', 'gn-slabel');
          const nm = el('div', 'gn-slabel-name');
          // the name takes presses (the App forwards them to the world's pointer handling, so a drag that starts on a
          // name still turns the world and a tool still works there); a keyboard / gamepad click selects
          nm.dataset.sid = String(s.id);
          nm.dataset.planet = String(pv.id);
          e.append(nm, el('div', 'gn-slabel-sub'));
          const id = s.id, planet = pv.id;
          nm.addEventListener('click', (ev) => { if ((ev as MouseEvent).detail === 0) this.actions.selectSettlement(planet, id); });
          this.labels.appendChild(e);
          rec = { el: e, text: '' };
          this.labelEls.set(key, rec);
        }
        const sub = `${s.population} · ${s.flags & 1 ? 'wandering' : s.eraLabel ?? `${s.era} age`}${s.besieged ? ' · besieged' : s.war?.length ? ' · at war' : ''}`;
        const sg = labelSigns(s);
        const text = `${s.name}|${sub}|${sg.prayer.toFixed(1)}|${sg.prophet}|${sg.sacred}`;
        if (rec.text !== text) {
          rec.text = text;
          const nm = rec.el.firstElementChild as HTMLElement;
          nm.textContent = s.name;
          // its small signs: a lamp while it prays (brighter the more pressing), a star where its prophet lives, a leaf
          // where it keeps something holy
          if (sg.prayer >= 0) nm.prepend(h('span', { class: 'gn-slabel-sign gn-slabel-pray', html: icon('prayer'), style: `opacity:${(0.6 + 0.4 * sg.prayer).toFixed(2)}`, title: `${s.name} prays for ${(s.prayers ?? []).map((q) => PRAYER_WORDS[q.kind] ?? q.kind).join(' and ')}` }));
          if (sg.prophet) nm.append(h('span', { class: 'gn-slabel-sign gn-slabel-prophet', html: icon('prophet'), title: `${s.prophet!.name}, your prophet, lives here` }));
          if (sg.sacred) nm.append(h('span', { class: 'gn-slabel-sign gn-slabel-sacred', html: icon('sacred'), title: s.sacred?.animal ? `They revere the ${s.sacred.animal.replace(/-/g, ' ')}` : 'They keep a holy place' }));
          (rec.el.lastElementChild as HTMLElement).textContent = sub;
        }
        // (under the whisper's words a name steps back: the two would read as one)
        const under = (!!ko && p.x > ko.left - 90 && p.x < ko.right + 90 && p.y > ko.top - 10 && p.y < ko.bottom + 44)
          || this.winRects.some((w) => p.x > w.left - 70 && p.x < w.right + 70 && p.y > w.top && p.y < w.bottom + 40);
        const fade = under ? 0 : Math.max(0.25, Math.min(1, 1.4 - d / Math.max(900, alt * 2.2)));
        rec.el.style.opacity = fade.toFixed(2);
        rec.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    for (const [k, r] of this.labelEls) if (!seen.has(k)) { r.el.remove(); this.labelEls.delete(k); }
  }

  /** the newest notable chronicle line, for a while */
  private syncTicker(view: WorldView, on: boolean, now: number): void {
    if (!on) { this.ticker.hidden = true; return; }
    const ch = view.chronicle;
    if (this.tickerSeen > ch.length) this.tickerSeen = ch.length;
    let pick: ChronicleEntry | null = null;
    for (let i = ch.length - 1; i >= this.tickerSeen; i--) if (ch[i].weight >= 1 && ch[i].kind !== 'death') { pick = ch[i]; break; }
    this.tickerSeen = ch.length;
    if (pick) {
      this.tickerAt = now;
      const w = view.planet(pick.planet)?.name;
      this.ticker.innerHTML = '';
      this.ticker.append(h('span', { class: 'gn-ticker-d', text: `${w ? `${w} · ` : ''}Year ${pick.year}` }), h('span', { class: 'gn-ticker-t', text: stripYear(pick.text) }));
      this.ticker.hidden = false;
      this.ticker.classList.remove('gn-fade');
    } else if (!this.ticker.hidden && now - this.tickerAt > 24000) this.ticker.classList.add('gn-fade');
  }

  update(f: HudFrame): void {
    const view = f.view;
    const pv: PlanetView | undefined = view.planet(f.primary) ?? view.planets[0];
    const now = performance.now();
    this.syncWorlds(view, f.primary);
    this.syncFaith(view, f.primary);
    this.syncMarkers(f);
    this.syncLabels(f, view.planet(f.primary));
    // prayer lamps from high up, where the names do not show (the names carry their own lamp closer in)
    this.prayerMarks.update({
      view, pv: view.planet(f.primary), cam: f.pose.pos, altitude: f.altitude, systemView: f.systemView, project: f.project, v2: this.v2,
      groundRadius: f.groundRadius, labelsShown: f.labels !== false && f.altitude > 70 && f.altitude < 9000,
    });
    this.syncTicker(view, f.ticker !== false, now);
    if (pv) {
      this.dayH = pv.params.dayHours;
      // the local time where the camera looks: the calendar a quarter of a turn east is that many hours later — its
      // day, season and year roll over at its own midnight (a sun stood still keeps the world's day, its hour shifted)
      const lonHours = this.cameraLonHours(f, pv);
      const frozen = !!pv.params.sunFrozen;
      const cal = frozen ? view.calendar(pv) : view.calendar(pv, view.renderTick + lonHours * 60);
      let hour = frozen ? cal.hour + lonHours : cal.hour;
      hour = ((hour % pv.params.dayHours) + pv.params.dayHours) % pv.params.dayHours;
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const text = `Year ${cal.year}<span class="gn-sep">·</span>${cal.season}<span class="gn-sep">·</span>Day ${cal.day}`;
      if (text !== this.lastText) { this.calText.innerHTML = text; this.lastText = text; }
      // (a world whose day is not 24 hours counts its own hours: 24:41 on a 30-hour day is late evening, not a bug —
      // the clock says so with a small "/30 h" and its title)
      const dh = pv.params.dayHours;
      const odd = Math.abs(dh - 24) > 0.05;
      const clockText = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${odd ? `|${fmtDayHours(dh)}` : ''}`;
      if (clockText !== this.lastClock) {
        this.lastClock = clockText;
        this.clock.textContent = clockText.split('|')[0]!;
        if (odd) this.clock.append(el('small', 'gn-clock-day', `/${fmtDayHours(dh)} h`));
        this.clock.title = odd
          ? `The local hour where you look. A day on this world is ${fmtDayHours(dh)} hours, so its clock runs from 00:00 to ${fmtDayHours(dh)}:00.`
          : 'The local hour where you look';
      }
      // the sky's colour at that hour, in the planet's own day
      const t = hour / pv.params.dayHours * 24;
      const day = t > 6 && t < 18;
      const dusk = (t > 5 && t <= 7) || (t >= 17 && t < 19.5);
      this.skyDot.style.color = dusk ? '#f0a46b' : day ? '#f3dfae' : '#7d9cd6';
      this.skyDot.style.background = this.skyDot.style.color;
      if (this.worldName.textContent !== pv.name) this.worldName.textContent = pv.name;
      const kind = pv.params.atmosphere.pressure > 0 ? pv.params.kind : `${pv.params.kind} · airless`;
      if (this.worldKind.textContent !== kind) this.worldKind.textContent = kind;
    }
    for (const [s, b] of this.speedBtns) b.classList.toggle('gn-on', view.speed === s);
    const behind = view.speed > 0 && view.achievedSpeed < view.speed * 0.9;
    this.achieved.classList.toggle('gn-behind', behind);
    // the time-lapse the sim runs at (the snapshot's lapseLevel when the mirror carries it, else from the preset:
    // 1x–300x the plain sim, 1000x time-lapse, 3000x deep time-lapse — sim/perf/lapse.ts)
    const lv = view.lapseLevel ?? (view.speed >= 3000 ? 2 : view.speed >= 1000 ? 1 : 0);
    const lapse = view.speed > 0 && lv > 0 ? ` <i class="gn-lapse">${lv > 1 ? 'deep time-lapse' : 'time-lapse'}</i>` : '';
    this.achieved.innerHTML = `<b>${view.speed === 0 ? 'paused' : '×' + fmtSpeed(view.achievedSpeed)}</b>${lapse}${f.showFps ? ` · ${f.fps < 10 ? f.fps.toFixed(1) : f.fps.toFixed(0)} fps` : ''}`;
    this.achieved.title = view.speed > 0 ? `Asked for ×${view.speed}; the worlds are keeping ×${fmtSpeed(view.achievedSpeed)}${lv > 0 ? ' — in time-lapse: the slow systems take longer steps, the same world' : ''}` : 'Time stands still';
    if (f.open) {
      const o = f.open;
      this.dockBtns.get('palette')?.classList.toggle('gn-on', o.palette);
      this.dockBtns.get('radial')?.classList.toggle('gn-on', o.radial);
      this.dockBtns.get('freeform')?.classList.toggle('gn-on', o.freeform);
      this.dockBtns.get('gesture')?.classList.toggle('gn-on', o.gesture);
      this.dockBtns.get('overlay')?.classList.toggle('gn-on', !!o.overlay);
      this.dockBtns.get('chronicle')?.classList.toggle('gn-on', o.chronicle);
      this.dock.classList.toggle('gn-dock-tool', o.tool);
    }
    if (this.dev) {
      const st = f.stats;
      this.dev.innerHTML = [
        ['draw calls', st.drawCalls.toLocaleString()],
        ['triangles', st.triangles.toLocaleString()],
        ['frame', `${st.frameMs.toFixed(1)} ms cpu`],
        ['patches', `${st.gpuPatches} (+${st.waterPatches} water)`],
        ['render', `${st.renderW}×${st.renderH}`],
        ['altitude', st.altitude < 1e5 ? `${st.altitude.toFixed(1)} m` : `${(st.altitude / 1000).toFixed(0)} km`],
        ['world', st.primary],
        ['tick', view.renderTick.toFixed(1)],
        ['sim', `${f.source} · ${f.snapshotHz.toFixed(0)} Hz · ${view.msPerTick.toFixed(2)} ms/tick`],
        ...(f.life ? [
          ['people', `${f.life.people} drawn${f.life.ambient ? ` + ${f.life.ambient} ambient` : ''}`],
          ['animals', `${f.life.animals}`],
          ['buildings', `${f.life.buildings} · ${f.life.variants} variants${f.life.pending ? ` (${f.life.pending} pending)` : ''}`],
          ['roads', `${f.life.roads} chains`],
        ] : []),
      ].map(([k, v]) => `<div class="gn-row"><span>${k}</span><b>${v}</b></div>`).join('');
    }
  }

  private cameraLonHours(f: HudFrame, pv: PlanetView): number {
    // camera position in the body frame → longitude (0 at +Z, east positive) → hours east of the meridian
    const b = qRotateInv(pv.quat, [f.pose.pos[0] - pv.center[0], f.pose.pos[1] - pv.center[1], f.pose.pos[2] - pv.center[2]]);
    return (Math.atan2(b[0], b[2]) / (2 * Math.PI)) * pv.params.dayHours;
  }
}

function fmtSpeed(x: number): string {
  if (x >= 100) return x.toFixed(0);
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}
