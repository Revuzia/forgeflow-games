// The options bar kit (UI.md 4.2, 4.4): what the Cut bar and the Snap bar share. A bar is ONE row of kit controls that the toolbar (toolbar.ts
// `attach`) holds above the dock (inline beside the tools in strip and tiny), so it must fit whatever room that slot has. Three pieces live here:
//   * `optButton`   a kit button (glass, or the gel for the primary) with an icon and a label that has three wordings: long, short, aria.
//   * `createOptionsFit`  picks the richest label mode that fits the bar's slot BY MEASUREMENT (the slot's width, not the viewport's: UI.md 4.2's
//                   >= 600 / 341-599 / <= 340 thresholds are the same idea, B3a found a viewport rule cannot work), then wraps as a last resort.
//   * `watchBody`   body[data-layout] watcher (tiny puts Done FIRST, so DOM order = Tab order = visual order).
// Modes (bar attribute `data-labels`), richest first:
//   long   every word ("Split in two", "Reconnect all", "Clean cut | Minis")
//   short  the buttons' short words ("Split", "Reconnect"), the style words kept
//   icon   the buttons are icons; the style words stay (their icons alone say nothing: a circle, three nodes); a button with no icon (Done) keeps its word
//   tight  the style faces are icons too
// When even tight does not fit, the strip layout (the tools stand beside the bar, so the bar's Done is the tray's Hand button again) sheds its Done (`data-shed="true"`,
// the control marked `opts-shed` is not drawn); when that is not enough either, `data-wrap="true"` lets the row wrap onto a second line. The accessible name never changes with the mode.
import './base.css';
import './kit.css';
import './a11y.css';
import './optionsBar.css';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import type { OptLabel } from './cutContract.ts';
import { attachTooltip } from './tooltip.ts';

export type LabelMode = 'long' | 'short' | 'icon' | 'tight';
export const LABEL_MODES: readonly LabelMode[] = ['long', 'short', 'icon', 'tight'];

export type { OptLabel } from './cutContract.ts';

export interface OptButton {
  readonly el: HTMLButtonElement;
  readonly hasIcon: boolean;
  setLabel(l: OptLabel): void;
  setMode(m: LabelMode): void;
  destroy(): void;
}

export interface OptButtonOptions {
  icon?: IconName;
  label: OptLabel;
  /** the primary (the gel) */
  gel?: boolean;
  /** data-key (the harness and the shell find the button by it) */
  key?: string;
  /** extra classes */
  cls?: string;
  /** draw the kit's three jelly dots while the button is aria-busy (the label keeps its width underneath) */
  dots?: boolean;
  /** why the button is off now ('' / undefined = no reason to show); a tooltip carries it, and the bar's reason line is its aria-describedby */
  reason?: () => string | undefined;
}

const isOff = (b: HTMLElement): boolean => (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true';
const tipPlace = (): 'above' | 'below' => (document.body.dataset.layout === 'strip' ? 'below' : 'above');

export function optButton(o: OptButtonOptions): OptButton {
  let label = o.label;
  let mode: LabelMode = 'long';
  const word = h('span', { class: 'k-btn-label opts-label', text: label.long });
  const b = h('button', { class: `k-btn k-btn--sm opts-btn${o.icon ? ' opts-btn--ic' : ''}${o.gel ? ' k-gel' : ''}${o.cls ? ` ${o.cls}` : ''}`, attrs: { type: 'button' } },
    o.icon ? icon(o.icon) : null, word,
    o.dots ? h('span', { class: 'k-dots', attrs: { 'aria-hidden': 'true' } }, h('i', { class: 'k-dot' }), h('i', { class: 'k-dot' }), h('i', { class: 'k-dot' })) : null);
  if (o.key) b.dataset.key = o.key;
  const paintName = (): void => { b.setAttribute('aria-label', label.aria ?? label.long); };
  paintName();
  const shown = (): string => (mode === 'short' ? label.short : label.long);
  // the tooltip: the full name when the word is not drawn (icon mode), the reason when the button is off (a native-disabled button gets no pointer events,
  // so there the reason line of the bar and aria-describedby carry it)
  const tip = attachTooltip(b, () => {
    const why = isOff(b) ? o.reason?.() : undefined;
    const name = label.aria ?? label.long;
    return why ? `${name}: ${why}` : name;
  }, { place: tipPlace, when: () => (o.icon !== undefined && (mode === 'icon' || mode === 'tight')) || (isOff(b) && !!o.reason?.()) });
  return {
    el: b,
    hasIcon: o.icon !== undefined,
    setLabel(l) { label = l; paintName(); word.textContent = shown(); },
    setMode(m) {
      mode = m;
      b.dataset.mode = m;
      const t = shown();
      if (word.textContent !== t) word.textContent = t;
    },
    destroy() { tip.destroy(); b.remove(); },
  };
}

// ---------------------------------------------------------------- fitting the label mode to the slot

export interface OptionsFit {
  readonly mode: LabelMode;
  readonly wrapped: boolean;
  /** measure and apply now */
  fit(): void;
  destroy(): void;
}

/**
 * Keep `bar` in the richest label mode whose controls fit the bar's own width (`scrollWidth <= clientWidth`). `buttons()` lists the bar's option
 * buttons; `apply` may do more per mode (the Cut bar's style control hides its words in icon mode through CSS on `data-labels`). Safe to call
 * while the bar is hidden (it keeps its last mode) and from observers: a pass that ends where it started writes nothing.
 */
export function createOptionsFit(bar: HTMLElement, buttons: () => readonly OptButton[], onMode?: (m: LabelMode, wrapped: boolean) => void, shed?: () => HTMLElement | null): OptionsFit {
  let mode: LabelMode = 'long';
  let wrapped = false;
  let raf = 0;
  let watched: Element | null = null;
  const apply = (m: LabelMode, wrap: boolean): void => {
    mode = m; wrapped = wrap;
    bar.dataset.labels = m;
    if (wrap) bar.dataset.wrap = 'true'; else delete bar.dataset.wrap;
    for (const b of buttons()) b.setMode(m);
    onMode?.(m, wrap);
  };
  const over = (): boolean => bar.scrollWidth > bar.clientWidth + 1;
  function fit(): void {
    if (!bar.isConnected || bar.getClientRects().length === 0) return;   // not drawn (hidden, display:none, detached): keep the last mode
    watch();   // (the slot may have changed since the last pass: the dock's size is what a re-measure follows)
    let done = false;
    delete bar.dataset.shed;
    for (const m of LABEL_MODES) { apply(m, false); if (!over()) { done = true; break; } }
    // strip: the tools are beside the bar, so its Done (the way back to the Hand) is the tray's Hand button too: drop it before wrapping (568x320: Snap needs 311 px, the slot has 266)
    if (!done && shed && document.body.dataset.layout === 'strip' && shed()) { bar.dataset.shed = 'true'; if (!over()) done = true; else delete bar.dataset.shed; }
    if (!done) apply('tight', true);
  }
  const soon = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(soon) : null;
  function watch(): void {
    // the dock (or, in the kit's fixed specimens and the live HUD, the bar's parent) is the slot whose size decides the room
    const slot = bar.closest('.dock') ?? bar.parentElement;
    if (slot && slot !== watched) { if (watched) ro?.unobserve(watched); watched = slot; ro?.observe(slot); }
  }
  ro?.observe(bar);
  ro?.observe(document.body);
  mo?.observe(document.body, { attributes: true, attributeFilter: ['data-layout', 'data-density', 'data-tall', 'data-dock'] });
  void document.fonts?.ready.then(soon);
  apply('long', false);
  return {
    get mode() { return mode; },
    get wrapped() { return wrapped; },
    fit,
    destroy() { if (raf) cancelAnimationFrame(raf); ro?.disconnect(); mo?.disconnect(); },
  };
}

// ---------------------------------------------------------------- the layout watcher

/** Run `cb` with the body's layout now and whenever `body[data-layout]` changes. Returns the unsubscribe. */
export function watchBody(cb: (layout: string) => void): () => void {
  const read = (): string => document.body.dataset.layout ?? '';
  let last = read();
  cb(last);
  if (typeof MutationObserver !== 'function') return () => {};
  const mo = new MutationObserver(() => { const l = read(); if (l !== last) { last = l; cb(l); } });
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });
  return () => mo.disconnect();
}

let uid = 0;
/** a unique id for the bar's reason line (aria-describedby target) */
export const optId = (p: string): string => `opts-${p}-${++uid}`;
