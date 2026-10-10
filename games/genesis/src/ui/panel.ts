// GENESIS — the window frame shared by the UI's larger panels (chronicle, settings, saves, help, menu, laws): a dark
// glass card with a serif title, an icon, a close button and a scrolling body (CONTRACT.md §16 look). Panels open over
// the live world — the sim never pauses for them unless the player pauses it.

import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface PanelOptions {
  name: string;
  title: string;
  subtitle?: string;
  icon?: string;
  /** where it sits: centre (modal-ish), left column, right column */
  place?: 'center' | 'left' | 'right' | 'wide';
  /** a dim veil behind it (menus) */
  veil?: boolean;
}

/** windows stack in the order they were opened: the newest is drawn on top (its veil over the older ones) */
let zTop = 10;


/** interface sound for window open/close (panels have no host; the app sets this once the audio lane is wired) */
let panelSound: ((cue: string) => void) | null = null;
export function setPanelSound(f: ((cue: string) => void) | null): void { panelSound = f; }

export class Panel {
  readonly root: HTMLDivElement;
  /** veiled windows are modal: world input pauses while one is open */
  readonly modal: boolean;
  readonly head: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly tools: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private veil: HTMLDivElement | null = null;
  onClose: (() => void) | null = null;
  onOpen: (() => void) | null = null;

  constructor(parent: HTMLElement, o: PanelOptions) {
    this.modal = !!o.veil;
    if (o.veil) {
      this.veil = h('div', { class: 'gn-veil', on: { pointerdown: () => this.close() } });
      this.veil.hidden = true;
      parent.appendChild(this.veil);
    }
    this.root = h('div', { class: `gn-panel gn-win gn-win-${o.place ?? 'center'} gn-win-${o.name}`, role: 'dialog', aria: { label: o.title } });
    this.root.hidden = true;
    this.titleEl = h('div', { class: 'gn-win-title', text: o.title });
    this.subEl = h('div', { class: 'gn-win-sub', text: o.subtitle ?? '' });
    this.tools = h('div', { class: 'gn-win-tools' });
    const close = h('button', { class: 'gn-btn gn-win-close', title: 'Close (Esc)', aria: { label: `Close ${o.title}` }, html: icon('close'), on: { click: () => this.close() } });
    this.head = h('div', { class: 'gn-win-head' },
      o.icon ? h('span', { class: 'gn-win-icon', html: icon(o.icon) }) : null,
      h('div', { class: 'gn-win-titles' }, this.titleEl, this.subEl),
      this.tools, close);
    this.body = h('div', { class: 'gn-win-body' });
    this.root.append(this.head, this.body);
    // keys typed into a panel stay in it (the world's shortcuts do not fire while a field has focus)
    this.root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    parent.appendChild(this.root);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  setTitle(t: string, sub?: string): void {
    this.titleEl.textContent = t;
    if (sub !== undefined) this.subEl.textContent = sub;
  }

  open(): void {
    if (this.isOpen) return;
    panelSound?.('ui.open');
    this.root.hidden = false;
    // z-order follows open order: a window opened over another is drawn over it (and its veil over the other)
    zTop += 2;
    this.root.style.zIndex = String(zTop);
    if (this.veil) { this.veil.hidden = false; this.veil.style.zIndex = String(zTop - 1); }
    this.onOpen?.();
  }

  /** bring an open window to the top */
  raise(): void {
    if (!this.isOpen) return;
    zTop += 2;
    this.root.style.zIndex = String(zTop);
    if (this.veil) this.veil.style.zIndex = String(zTop - 1);
  }

  close(): void {
    if (!this.isOpen) return;
    panelSound?.('ui.close');
    this.root.hidden = true;
    if (this.veil) this.veil.hidden = true;
    this.onClose?.();
  }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
}

/** a labelled row of a settings-like form */
export function field(label: string, control: HTMLElement, hint?: string): HTMLDivElement {
  return h('div', { class: 'gn-field' }, h('label', { class: 'gn-field-l' }, label, hint ? h('small', { text: hint }) : null), h('div', { class: 'gn-field-c' }, control));
}

/** a range slider with its value shown; calls back on input */
export function slider(o: { min: number; max: number; step: number; value: number; fmt?: (v: number) => string; on: (v: number) => void; log?: boolean }): HTMLDivElement {
  const toS = (v: number) => (o.log ? Math.log(Math.max(v, o.min)) : v);
  const fromS = (s: number) => (o.log ? Math.exp(s) : s);
  const inp = h('input', { type: 'range', class: 'gn-range', min: String(toS(o.min)), max: String(toS(o.max)), step: o.log ? 'any' : String(o.step) }) as HTMLInputElement;
  inp.value = String(toS(o.value));
  const out = h('span', { class: 'gn-range-v', text: (o.fmt ?? String)(o.value) });
  const snap = (v: number) => (o.step > 0 ? Math.round(v / o.step) * o.step : v);
  inp.addEventListener('input', () => {
    const v = Math.min(o.max, Math.max(o.min, snap(fromS(Number(inp.value)))));
    out.textContent = (o.fmt ?? String)(v);
    o.on(v);
  });
  const wrap = h('div', { class: 'gn-slider' }, inp, out);
  (wrap as HTMLDivElement & { setValue?: (v: number) => void }).setValue = (v: number) => { inp.value = String(toS(v)); out.textContent = (o.fmt ?? String)(v); };
  return wrap;
}

/** an on/off switch */
export function toggle(value: boolean, on: (v: boolean) => void, label = ''): HTMLButtonElement {
  const b = h('button', { class: `gn-toggle${value ? ' gn-on' : ''}`, role: 'switch', aria: { checked: String(value), label: label || 'toggle' } }, h('i'));
  b.addEventListener('click', () => {
    const v = !b.classList.contains('gn-on');
    b.classList.toggle('gn-on', v);
    b.setAttribute('aria-checked', String(v));
    on(v);
  });
  return b;
}

/** a select from choices */
export function select(choices: { value: string; label: string }[], value: string, on: (v: string) => void): HTMLSelectElement {
  const s = h('select', { class: 'gn-select' }) as HTMLSelectElement;
  for (const c of choices) s.append(h('option', { value: c.value, text: c.label }));
  s.value = value;
  s.addEventListener('change', () => on(s.value));
  return s;
}

/** segmented buttons */
export function segmented(choices: { value: string; label: string; title?: string }[], value: string, on: (v: string) => void): HTMLDivElement {
  const wrap = h('div', { class: 'gn-seg' });
  for (const c of choices) {
    const b = h('button', { class: `gn-seg-b${c.value === value ? ' gn-on' : ''}`, text: c.label, title: c.title ?? c.label });
    b.addEventListener('click', () => {
      for (const x of Array.from(wrap.children)) x.classList.remove('gn-on');
      b.classList.add('gn-on');
      on(c.value);
    });
    wrap.append(b);
  }
  return wrap;
}
