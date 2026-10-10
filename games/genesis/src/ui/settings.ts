// GENESIS — settings (CONTRACT.md §16.9; F10 or Ctrl+,): graphics (quality preset + individual toggles — quality never
// removes a power, never changes the sim), audio volumes (through the audio module's API), interface (scale — automatic
// from the window by default —, colour-blind palettes, motion, hints, toasts, the frame rate), controls (every action
// rebindable on keyboard and gamepad; a key bound twice is marked on that key alone; saved in localStorage), and the
// game (restraint mode, natural disasters, autosave). The tabs stay at the top while the page scrolls; every opening and
// every tab starts at the top; the window keeps one height whichever tab is shown.

import type { UiHost } from './host.ts';
import type { Prefs } from './prefs.ts';
import { ACTIONS, comboLabel, comboOf, splitCombo, type ActionDef } from './keybinds.ts';
import { Panel, field, slider, toggle, select, segmented } from './panel.ts';
import { h, clear, fmtNum } from './dom.ts';
import { icon } from './icons.ts';

type Tab = 'graphics' | 'audio' | 'interface' | 'controls' | 'game';

export interface SettingsDeps {
  host: UiHost;
  /** wait for the next gamepad button (rebinding); returns its name, or null when cancelled */
  nextPadButton(cancel: AbortSignal): Promise<string | null>;
  /** is an audio module present (else the audio tab says so) */
  audioReady(): boolean;
}

export class Settings {
  readonly panel: Panel;
  private host: UiHost;
  private deps: SettingsDeps;
  private tab: Tab = 'graphics';
  private tabs: HTMLDivElement;
  private content: HTMLDivElement;
  private capturing: { id: string; slot: number; pad: boolean; abort?: AbortController } | null = null;

  constructor(parent: HTMLElement, deps: SettingsDeps) {
    this.deps = deps;
    this.host = deps.host;
    this.panel = new Panel(parent, { name: 'settings', title: 'Settings', subtitle: 'the look, the sound, the hands', icon: 'settings', place: 'center', veil: true });
    this.tabs = h('div', { class: 'gn-tabs gn-tabs-sticky', role: 'tablist' });
    this.content = h('div', { class: 'gn-set-content' });
    this.panel.body.append(this.tabs, this.content);
    this.panel.onOpen = () => { this.render(); this.panel.body.scrollTop = 0; };
    this.panel.onClose = () => this.stopCapture();
    this.host.keybinds.listen(() => { if (this.panel.isOpen && this.tab === 'controls') this.render(); });
    // capture keys for rebinding before anything else sees them
    window.addEventListener('keydown', (e) => this.captureKey(e), true);
  }

  get isOpen(): boolean { return this.panel.isOpen; }
  open(tab?: Tab): void { if (tab) this.tab = tab; this.panel.open(); this.render(); this.panel.body.scrollTop = 0; }
  close(): void { this.panel.close(); }

  private render(): void {
    clear(this.tabs);
    const names: [Tab, string, string][] = [['graphics', 'Graphics', 'eye'], ['audio', 'Audio', 'sound'], ['interface', 'Interface', 'layers'], ['controls', 'Controls', 'keyboard'], ['game', 'Game', 'law']];
    for (const [id, label, ic] of names) {
      const b = h('button', { class: `gn-tab${this.tab === id ? ' gn-on' : ''}`, role: 'tab', aria: { selected: String(this.tab === id) } }, h('span', { html: icon(ic) }), label);
      b.addEventListener('click', () => { this.tab = id; this.stopCapture(); this.render(); this.panel.body.scrollTop = 0; });
      this.tabs.append(b);
    }
    clear(this.content);
    const P = this.host.prefs;
    const v = P.value;
    const set = (path: string) => (x: unknown) => P.set(path, x);
    switch (this.tab) {
      case 'graphics': {
        this.content.append(h('div', { class: 'gn-set-h', text: 'Quality' }),
          segmented(['auto', 'low', 'medium', 'high', 'ultra', 'cinematic'].map((q) => ({ value: q, label: q === 'auto' ? 'Auto' : q.charAt(0).toUpperCase() + q.slice(1) })), v.quality, (q) => P.set('quality', q)),
          h('div', { class: 'gn-set-note', text: 'Quality trades pixels, samples and ranges. It never changes the world or takes a power away.' }));
        const g = v.gfx;
        this.content.append(h('div', { class: 'gn-set-h', text: 'Fine-tune' }),
          field('Resolution', slider({ min: 0.5, max: 1.25, step: 0.05, value: g.renderScale, fmt: (x) => `${Math.round(x * 100)}%`, on: set('gfx.renderScale') })),
          field('Shadows', toggle(g.shadows, set('gfx.shadows'), 'Shadows')),
          field('Ambient occlusion', toggle(g.ssao, set('gfx.ssao'), 'Ambient occlusion')),
          field('God rays', toggle(g.godRays, set('gfx.godRays'), 'God rays')),
          field('Bloom', slider({ min: 0, max: 2, step: 0.05, value: g.bloom, fmt: (x) => `${Math.round(x * 100)}%`, on: set('gfx.bloom') })),
          field('Lens flare', toggle(g.flare, set('gfx.flare'), 'Lens flare')),
          field('Anti-aliasing (FXAA)', toggle(g.fxaa, set('gfx.fxaa'), 'FXAA')),
          field('Film grain', toggle(g.grain, set('gfx.grain'), 'Film grain')),
          field('Vignette', toggle(g.vignette, set('gfx.vignette'), 'Vignette')),
          field('Vegetation', slider({ min: 0.25, max: 1.5, step: 0.05, value: g.vegetation, fmt: (x) => `${Math.round(x * 100)}%`, on: set('gfx.vegetation') }), 'density and range'),
          field('Grass', toggle(g.grass, set('gfx.grass'), 'Grass')),
          field('Orbit lines', toggle(g.orbits, set('gfx.orbits'), 'Orbit lines')),
          field('Exposure', slider({ min: -2, max: 2, step: 0.1, value: g.exposure, fmt: (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)} EV`, on: set('gfx.exposure') })),
          h('button', { class: 'gn-btn gn-set-reset', text: 'Reset graphics', on: { click: () => { P.reset('gfx'); P.set('quality', 'auto'); this.render(); } } }));
        break;
      }
      case 'audio': {
        const a = v.audio;
        if (!this.deps.audioReady()) this.content.append(h('div', { class: 'gn-set-note', text: 'The sound of the worlds is still being tuned; these volumes are kept and take effect when it plays.' }));
        const pctF = (x: number) => `${Math.round(x * 100)}%`;
        this.content.append(
          field('Master', slider({ min: 0, max: 1, step: 0.01, value: a.master, fmt: pctF, on: set('audio.master') })),
          field('Music', slider({ min: 0, max: 1, step: 0.01, value: a.music, fmt: pctF, on: set('audio.music') }), 'the peoples\' songs, the score of orbit'),
          field('Effects', slider({ min: 0, max: 1, step: 0.01, value: a.sfx, fmt: pctF, on: set('audio.sfx') }), 'the hand, miracles, disasters'),
          field('Ambience', slider({ min: 0, max: 1, step: 0.01, value: a.ambience, fmt: pctF, on: set('audio.ambience') }), 'wind, surf, birds, rain, crowds'),
          field('Mute', toggle(a.muted, set('audio.muted'), 'Mute')));
        break;
      }
      case 'interface': {
        const u = v.ui;
        const auto = Math.max(1, Math.min(2, Math.round((window.innerHeight / 820) * 20) / 20));
        const scaleSl = slider({ min: 0.8, max: 2, step: 0.05, value: u.autoScale ? auto : u.scale, fmt: (x) => `${Math.round(x * 100)}%`, on: (x) => { if (P.value.ui.autoScale) P.set('ui.autoScale', false); P.set('ui.scale', x); autoTg.classList.remove('gn-on'); autoTg.setAttribute('aria-checked', 'false'); } });
        const autoTg = toggle(u.autoScale, (on) => { P.set('ui.autoScale', on); if (on) (scaleSl as HTMLDivElement & { setValue?: (v: number) => void }).setValue?.(auto); }, 'Automatic interface scale');
        this.content.append(
          field('Interface scale', h('div', { class: 'gn-set-row' }, autoTg, h('span', { class: 'gn-set-inline', text: 'Auto' }), scaleSl), `auto follows the window: ×${auto.toFixed(2)} here`),
          field('Colour palette', select([
            { value: 'standard', label: 'Standard' }, { value: 'deuteranopia', label: 'Deuteranopia (red–green)' }, { value: 'protanopia', label: 'Protanopia (red–green)' },
            { value: 'tritanopia', label: 'Tritanopia (blue–yellow)' }, { value: 'monochrome', label: 'Monochrome' },
          ], u.palette, set('ui.palette')), 'map overlays, toasts, inspector bars'),
          field('Reduce motion', toggle(u.reduceMotion, set('ui.reduceMotion'), 'Reduce motion')),
          field('Hints', toggle(u.hints, set('ui.hints'), 'Hints'), 'the hand\'s hints and the controls line'),
          field('Toasts stay', slider({ min: 3, max: 30, step: 1, value: u.toastSeconds, fmt: (x) => `${x} s`, on: set('ui.toastSeconds') })),
          field('Chronicle ticker', toggle(u.ticker, set('ui.ticker'), 'Chronicle ticker')),
          field('Settlement names', toggle(u.labels, set('ui.labels'), 'Settlement names')),
          field('Frame rate', toggle(u.showFps, set('ui.showFps'), 'Frame rate'), 'beside the speed, top left'));
        break;
      }
      case 'controls': this.controls(); break;
      case 'game': {
        const restraint = this.host.view.restraint;
        this.content.append(
          field('Restraint', toggle(restraint, (on) => void this.host.cmd({ k: 'meta.restraint', on }), 'Restraint'), 'powers cost worship and need time — off: omnipotence'),
          field('Natural disasters', toggle(true, (on) => void this.host.cmd({ k: 'set', path: 'disasters.natural', value: on ? 1 : 0 }), 'Natural disasters'), 'the world sends its own (a law: see the laws of the world)'),
          field('Autosave', select([{ value: '0', label: 'Off' }, { value: '5', label: 'Every 5 minutes' }, { value: '10', label: 'Every 10 minutes' }, { value: '20', label: 'Every 20 minutes' }, { value: '30', label: 'Every 30 minutes' }],
            String(v.game.autosaveMinutes), (x) => P.set('game.autosaveMinutes', Number(x)))),
          h('div', { class: 'gn-set-note', text: 'Every other law of the world — gravity, the length of the day, the air, the star, how fast fire spreads — is in the laws of the world (U, or the inspector on a world).' }),
          h('button', { class: 'gn-btn gn-set-reset', text: 'Open the laws of this world', on: { click: () => { this.close(); this.host.action('ui.laws'); } } }));
        void this.host.query('laws').then((d) => {
          const l = (d as { laws?: Record<string, number> } | null)?.laws;
          const nat = l?.['disasters.natural'];
          if (typeof nat === 'number') {
            const tg = this.content.querySelector('[aria-label="Natural disasters"]');
            if (tg) { tg.classList.toggle('gn-on', nat > 0); tg.setAttribute('aria-checked', String(nat > 0)); }
          }
        });
        break;
      }
    }
  }

  // ───────────────────────────── controls ─────────────────────────────

  private controls(): void {
    const kb = this.host.keybinds;
    const conflicts = kb.conflicts();
    const pad = this.host.prefs.value.pad;
    const set = (path: string) => (x: unknown) => this.host.prefs.set(path, x);
    if (conflicts.length) {
      this.content.append(h('div', { class: 'gn-set-warn' }, h('span', { html: icon('help') }),
        `${conflicts.length} key${conflicts.length === 1 ? ' is' : 's are'} bound to more than one action (the key is marked in red; hover it to see where else). The first action listed wins.`));
    }
    const table = h('div', { class: 'gn-binds' });
    table.append(h('div', { class: 'gn-binds-h' }, h('span', { text: 'Action' }), h('span', { text: 'Key' }), h('span', { text: 'Second key' }), h('span', { text: 'Gamepad' }), h('span')));
    let group = '';
    for (const a of ACTIONS) {
      if (a.group !== group) { group = a.group; table.append(h('div', { class: 'gn-binds-g', text: group })); }
      table.append(this.bindRow(a));
    }
    this.content.append(table,
      h('div', { class: 'gn-set-row' },
        h('button', { class: 'gn-btn gn-set-reset', text: 'Reset every binding', on: { click: () => kb.resetAll() } }),
        h('span', { class: 'gn-set-note', text: 'Click a key to change it: press the new key (Esc cancels, Backspace clears).' })),
      h('div', { class: 'gn-set-h', text: 'Gamepad' }),
      field('Gamepad', toggle(pad.enabled, set('pad.enabled'), 'Gamepad')),
      field('Stick dead zone', slider({ min: 0.05, max: 0.45, step: 0.01, value: pad.deadzone, fmt: (x) => x.toFixed(2), on: set('pad.deadzone') })),
      field('Cursor speed', slider({ min: 300, max: 2400, step: 50, value: pad.cursorSpeed, fmt: (x) => `${fmtNum(x)} px/s`, on: set('pad.cursorSpeed') })),
      field('Camera speed', slider({ min: 0.3, max: 3, step: 0.05, value: pad.lookSpeed, fmt: (x) => `${x.toFixed(2)}×`, on: set('pad.lookSpeed') })),
      field('Invert camera tilt', toggle(pad.invertY, set('pad.invertY'), 'Invert camera tilt')),
      field('Edge pan', toggle(this.host.prefs.value.game.edgePan, set('game.edgePan'), 'Edge pan'), 'the camera pans when the cursor reaches the edge'));
  }

  private bindRow(a: ActionDef): HTMLDivElement {
    const kb = this.host.keybinds;
    // a conflict marks the KEY that is bound twice, not the whole row
    const clash = new Map<string, string[]>();
    for (const c of kb.conflicts()) if (c.actions.includes(a.id)) clash.set(`${c.pad ? 'pad:' : ''}${c.combo}`, c.actions.filter((o) => o !== a.id));
    const name = (ids: string[]) => ids.map((o) => ACTIONS.find((x) => x.id === o)?.label ?? o).join(', ');
    const keyClash = (combo: string): string[] | undefined => clash.get(combo) ?? (a.hold ? clash.get(splitCombo(combo).code) : undefined);
    const row = h('div', { class: 'gn-binds-r', title: a.label });
    row.append(h('span', { class: 'gn-binds-l' }, a.label, a.hold ? h('small', { text: 'hold' }) : null, a.modifier ? h('small', { text: 'modifier' }) : null));
    const keys = kb.keysOf(a.id);
    for (let slot = 0; slot < 2; slot++) {
      const cap = this.capturing && !this.capturing.pad && this.capturing.id === a.id && this.capturing.slot === slot;
      const other = keys[slot] ? keyClash(keys[slot]) : undefined;
      const b = h('button', { class: `gn-key${cap ? ' gn-capturing' : ''}${other ? ' gn-key-clash' : ''}`, title: other ? `Also bound to: ${name(other)}` : '', text: cap ? (a.modifier ? 'press Alt / Ctrl / Shift…' : 'press a key…') : comboLabel(keys[slot] ?? '') });
      b.addEventListener('click', () => { this.stopCapture(); this.capturing = { id: a.id, slot: Math.min(slot, keys.length), pad: false }; this.render(); });
      row.append(b);
    }
    const pads = kb.padOf(a.id);
    const capPad = this.capturing?.pad && this.capturing.id === a.id;
    const padOther = pads[0] ? clash.get(`pad:${pads[0]}`) : undefined;
    const pb = h('button', { class: `gn-key gn-pad${capPad ? ' gn-capturing' : ''}${padOther ? ' gn-key-clash' : ''}`, title: padOther ? `Also bound to: ${name(padOther)}` : '', text: capPad ? 'press a button…' : pads[0] ?? '—' });
    pb.addEventListener('click', () => {
      this.stopCapture();
      const abort = new AbortController();
      this.capturing = { id: a.id, slot: 0, pad: true, abort };
      this.render();
      void this.deps.nextPadButton(abort.signal).then((btn) => {
        if (this.capturing?.abort !== abort) return;
        this.capturing = null;
        if (btn) kb.setPad(a.id, 0, btn); else this.render();
      });
    });
    row.append(pb);
    const reset = h('button', { class: 'gn-btn gn-binds-reset', title: 'Default', html: icon('history') });
    reset.addEventListener('click', () => kb.reset(a.id));
    row.append(reset);
    return row;
  }

  private captureKey(e: KeyboardEvent): void {
    const c = this.capturing;
    if (!c || c.pad || !this.panel.isOpen) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const a = ACTIONS.find((x) => x.id === c.id);
    if (!a) return;
    if (e.code === 'Escape') { this.capturing = null; this.render(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { this.capturing = null; this.host.keybinds.setKey(c.id, c.slot, ''); return; }
    const combo = comboOf(e);
    const isMod = ['Ctrl', 'Alt', 'Shift', 'Meta'].includes(combo);
    // a modifier action takes a bare modifier; any other action waits for a real key
    if (a.modifier ? !isMod : isMod) return;
    // hold actions are bound to the key itself (Shift runs them faster)
    const final = a.hold ? e.code : combo;
    this.capturing = null;
    this.host.keybinds.setKey(c.id, c.slot, final);
  }

  private stopCapture(): void {
    this.capturing?.abort?.abort();
    this.capturing = null;
  }
}

export type { Prefs };
