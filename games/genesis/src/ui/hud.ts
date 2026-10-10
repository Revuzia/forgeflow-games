// GENESIS — the HUD (CONTRACT.md §16.1): top left the world's name, its calendar (year, season, day, the local hour
// where the camera looks) and the time controls (pause, 1×, 10×, 100×, 1000×, step a minute / an hour / a day) with the
// achieved multiplier; top right the worlds strip (click to fly; the living on each) and, under it, worship and belief;
// bottom centre the dock (the current tool's card sits above it: src/ui/tools.ts) with the doors to the palette, the
// radial, the "do this" field, gestures, overlays, the chronicle, settings and the controls card; bottom left the toasts
// and a one-line chronicle ticker. Settlement names float over the world, planet markers over the system view, and
// the dev overlay (?dev=1) lists draw calls, triangles, patches and the life layer's counts.
// Two layers: `world` (things pinned to places on screen: labels, markers, the selection, "here") is never scaled;
// `root` (the panels) takes the interface scale from the settings. Only a settlement's NAME takes a click (the label
// box does not), and while the pointer belongs to a tool, a gesture or the hand the names let presses through to the
// world (the world layer's `gn-busy`); while the radial, the palette or a gesture card is up they hide (`gn-hush`).
// The frame rate shows only on request (?dev=1 or the setting): it is the developer's number, not the player's. Worship
// spent on a miracle pulses the worship card with what was spent.

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
import { h, fmtNum } from './dom.ts';
import { icon } from './icons.ts';

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
  private v2 = new Vector2();
  private actions: HudActions;

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
    const speedIds: Record<number, string> = { 0: 'time.pause', 1: 'time.speed1', 10: 'time.speed10', 100: 'time.speed100', 1000: 'time.speed1000' };
    for (const s of SPEED_PRESETS) {
      const b = el('button', 'gn-btn', s === 0 ? ICON_PAUSE : `${s}×`) as HTMLButtonElement;
      b.type = 'button';
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
    speeds.appendChild(stepWrap);
    this.achieved = el('div', 'gn-achieved');
    speeds.appendChild(this.achieved);
    time.append(world, cal, speeds);
    this.root.appendChild(time);
    // ── top right: worlds strip + worship / belief ──
    const right = el('div', 'gn-topright');
    this.worlds = el('div', 'gn-panel gn-worlds');
    this.faith = el('div', 'gn-panel gn-faith');
    this.faith.title = 'Worship gathered and how the living feel about you';
    right.append(this.worlds, this.faith);
    this.root.appendChild(right);
    // ── world-pinned layers ──
    this.markers = el('div', 'gn-markers');
    this.world.appendChild(this.markers);
    this.labels = el('div', 'gn-markers gn-labels');
    this.world.appendChild(this.labels);
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
    door('gesture', 'gesture', 'Gesture', 'ui.gesture');
    this.dock.append(el('span', 'gn-dock-sep'));
    door('overlay', 'overlay', 'Overlay', 'ui.overlayNext');
    door('chronicle', 'chronicle', 'Chronicle', 'ui.chronicle');
    door('laws', 'law', 'Laws', 'ui.laws');
    this.dock.append(el('span', 'gn-dock-sep'));
    door('saves', 'save', 'Saves', 'ui.saves');
    door('settings', 'settings', 'Settings', 'ui.settings');
    door('help', 'help', 'Controls', 'ui.help');
    this.root.appendChild(this.dock);
    this.hint = el('div', 'gn-hint');
    this.root.appendChild(this.hint);
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

  /** the shell's layout pass: where the toasts sit, how far the ticker may run */
  layout(o: { toastBottom: number; toastTop: boolean; tickerMax: number }): void {
    this.root.style.setProperty('--gn-toast-bottom', `${Math.round(o.toastBottom)}px`);
    this.root.style.setProperty('--gn-ticker-max', `${Math.round(o.tickerMax)}px`);
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

  /** refresh the controls hint line (keys may have been rebound) */
  setHint(show: boolean): void {
    this.hint.hidden = !show;
    if (!show) return;
    const a = this.actions;
    const k = (id: string, fallback: string) => a.hint(id) || fallback;
    this.hint.innerHTML = [
      ['drag', 'turn'], ['wheel', 'descend'], ['click', 'inspect'], [k('ui.palette', '/'), 'powers'], [k('ui.freeform', 'Enter'), 'do this'],
      [k('ui.radial', 'Q'), 'radial'], [k('ui.gesture', 'G'), 'gesture'], [k('ui.help', 'F1'), 'controls'],
    ].map(([key, what]) => `<kbd>${key}</kbd> ${what}`).join('<span class="gn-sep">·</span>');
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

  /** worship (the pool of the player god) and belief: the living's love and fear, weighted by how many they are */
  private syncFaith(view: WorldView): void {
    let pop = 0, belief = 0, love = 0, fear = 0, towns = 0;
    for (const pv of view.planets) for (const s of pv.settlements) {
      if (s.flags & 2) continue;
      const n = Math.max(1, s.population);
      pop += n;
      belief += s.belief * n;
      if (s.alignment >= 0) love += s.belief * n * s.alignment; else fear += s.belief * n * -s.alignment;
      towns++;
    }
    const w = view.worship[0] ?? 0;
    // worship spent (a miracle drew on it for strength): pulse the card and say how much
    const now = performance.now();
    if (this.lastWorship >= 0 && w < this.lastWorship - 0.5) {
      this.spent = (now - this.spentAt < 2500 ? this.spent : 0) + (this.lastWorship - w);
      this.spentAt = now;
      this.faith.classList.remove('gn-spent');
      void this.faith.offsetWidth;
      this.faith.classList.add('gn-spent');
      this.faith.title = `Worship spent: ${Math.round(this.spent)} — miracles draw on worship for strength (up to ×1.5)`;
    }
    this.lastWorship = w;
    if (this.spentEl && now - this.spentAt > 2600) { this.spentEl.remove(); this.spentEl = null; }
    const rivals = view.worship.slice(1).map((x, i) => ({ god: i + 1, w: x })).filter((r) => r.w > 0.5);
    const b = pop ? belief / pop : 0;
    const tone = love + fear > 0.0001 ? (love - fear) / (love + fear) : 0;
    const key = `${Math.round(w)}|${Math.round(b * 100)}|${Math.round(tone * 20)}|${rivals.map((r) => Math.round(r.w)).join(',')}|${view.restraint}|${towns}|${now - this.spentAt < 2500 ? Math.round(this.spent) : 0}`;
    if (key === this.faithKey) return;
    this.faithKey = key;
    this.faith.hidden = !towns && w < 0.5;
    const pct = Math.round(b * 100);
    this.faith.innerHTML = '';
    this.faith.append(
      h('span', { class: 'gn-faith-i', html: icon('worship') }),
      h('span', { class: 'gn-faith-w' }, h('b', { text: fmtNum(Math.round(w)) }), h('small', { text: view.restraint ? 'worship · restraint' : 'worship' })),
      h('span', { class: 'gn-faith-b' },
        h('span', { class: 'gn-faith-track' }, h('i', { class: `gn-faith-fill ${tone >= 0 ? 'gn-love' : 'gn-fear'}`, style: `width:${pct}%` })),
        h('small', { text: !towns ? 'no one yet' : pct === 0 ? 'no one believes yet' : `${pct}% believe · ${tone > 0.25 ? 'loved' : tone < -0.25 ? 'feared' : 'loved and feared'}` })),
      ...(rivals.length ? [h('span', { class: 'gn-faith-r', title: 'worship of rival gods', text: `rivals ${rivals.map((r) => fmtNum(Math.round(r.w))).join(' · ')}` })] : []));
    if (now - this.spentAt < 2500 && this.spent >= 1) {
      this.spentEl = h('span', { class: 'gn-faith-spent', text: `−${Math.round(this.spent)} worship · a stronger miracle` });
      this.faith.append(this.spentEl);
    }
  }

  private syncMarkers(f: HudFrame): void {
    const show = f.systemView;
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
  private syncLabels(f: HudFrame, pv: PlanetView | undefined): void {
    const seen = new Set<string>();
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
        const sub = `${s.population} · ${s.flags & 1 ? 'wandering' : `${s.era} age`}${s.besieged ? ' · besieged' : s.war?.length ? ' · at war' : ''}`;
        const text = `${s.name}|${sub}`;
        if (rec.text !== text) {
          rec.text = text;
          (rec.el.firstElementChild as HTMLElement).textContent = s.name;
          (rec.el.lastElementChild as HTMLElement).textContent = sub;
        }
        const fade = Math.max(0.25, Math.min(1, 1.4 - d / Math.max(900, alt * 2.2)));
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
    this.syncFaith(view);
    this.syncMarkers(f);
    this.syncLabels(f, view.planet(f.primary));
    this.syncTicker(view, f.ticker !== false, now);
    if (pv) {
      this.dayH = pv.params.dayHours;
      const cal = view.calendar(pv);
      const lonHours = this.cameraLonHours(f, pv);
      let hour = cal.hour + lonHours;
      hour = ((hour % pv.params.dayHours) + pv.params.dayHours) % pv.params.dayHours;
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const text = `Year ${cal.year}<span class="gn-sep">·</span>${cal.season}<span class="gn-sep">·</span>Day ${cal.day}`;
      if (text !== this.lastText) { this.calText.innerHTML = text; this.lastText = text; }
      this.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
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
    this.achieved.innerHTML = `<b>${view.speed === 0 ? 'paused' : '×' + fmtSpeed(view.achievedSpeed)}</b>${f.showFps ? ` · ${f.fps < 10 ? f.fps.toFixed(1) : f.fps.toFixed(0)} fps` : ''}`;
    this.achieved.title = view.speed > 0 ? `Asked for ×${view.speed}; the worlds are keeping ×${fmtSpeed(view.achievedSpeed)}` : 'Time stands still';
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
