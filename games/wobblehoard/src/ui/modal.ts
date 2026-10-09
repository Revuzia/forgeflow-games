// Modal layers (UI.md 3.3, 8 B4 first-play): the focus trap and the dialog every overlay stands on. `openLayer` is the trap (inert behind, Tab wraps, focus goes in and comes
// back); `openModal` is the kit's small dialog on it (a title, a line, one to three buttons; Esc closes it; its buttons ignore the first 250 ms so a tap that opened it cannot
// also answer it). The Menu (menu.ts) and the Photo card (B4b) stand on the same `openLayer`. First-play code: no later-* chunk may be needed to show one.
//
//   * Inert, not just aria-modal: everything else under the layer's parent is `inert` while it is open (no Tab, no pointer, not in the accessibility tree), EXCEPT the
//     live region and anything marked `data-keep-live` (the toasts): an announcement made while a layer is open must still be heard.
//   * The layers stack: the top one owns Esc (`closeTopLayer`, the Esc order of UI.md 4.5 layers 2 and 3). The Menu is a layer, a modal over it is a layer over that.
//   * Focus returns to the control that had it (or `returnFocus()`), else the play target of the page.
import { h } from './dom.ts';
import { cue } from './uiSound.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';
/** the time a fresh dialog ignores presses (UI.md 3.3: "250 ms input arm") */
export const ARM_MS = 250;

export interface Layer {
  readonly el: HTMLElement;
  readonly open: boolean;
  /** close it (why: 'escape' | 'button' | 'code'); returns false when it was already closed */
  close(why?: string): boolean;
}
export interface LayerOpts {
  /** the element that holds the layer's DOM (a scrim); it is appended to `parent` */
  el: HTMLElement;
  parent: HTMLElement;
  /** the element that should take the focus first (default: the first focusable) */
  initialFocus?: () => HTMLElement | null;
  /** where the focus goes on close (default: the control that had it, if it is still in the page) */
  returnFocus?: () => HTMLElement | null;
  /** Esc closes it (default true) */
  escapeCloses?: boolean;
  onClose?(why: string): void;
}

interface Entry { layer: Layer; o: LayerOpts; opener: Element | null; inerted: Array<[Element, boolean]> }
const stack: Entry[] = [];

/** content of a closed <details> cannot take focus (its summary can): a Tab trap that counted it would let the focus walk out of the layer */
const inClosedDetails = (n: HTMLElement): boolean => { const d = n.closest('details:not([open])'); return !!d && !(n.tagName === 'SUMMARY' && n.parentElement === d); };
const focusablesOf = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hidden && !n.closest('[hidden], [inert]') && !inClosedDetails(n) && (n.offsetParent !== null || n === document.activeElement || getComputedStyle(n).position === 'fixed'));

export function openLayer(o: LayerOpts): Layer {
  const opener = document.activeElement;
  const parent = o.parent;
  const inerted: Array<[Element, boolean]> = [];
  // everything beside the layer goes inert (its previous state is restored, so a layer over a layer leaves the lower one inert until it is the top again)
  for (const kid of [...parent.children]) {
    if (kid === o.el || kid.id === 'wh-live' || kid.hasAttribute('data-keep-live')) continue;
    inerted.push([kid, kid.hasAttribute('inert')]);
    kid.setAttribute('inert', '');
  }
  parent.append(o.el);
  let isOpen = true;
  const layer: Layer = {
    el: o.el,
    get open() { return isOpen; },
    close(why = 'code') {
      if (!isOpen) return false;
      isOpen = false;
      const i = stack.findIndex((e) => e.layer === layer);
      if (i >= 0) stack.splice(i, 1);
      o.el.removeEventListener('keydown', onKey);
      const hadFocus = o.el.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement;
      for (const [k, was] of inerted) if (!was) k.removeAttribute('inert');
      o.el.remove();
      try { o.onClose?.(why); } catch (e) { console.error(e); }
      if (hadFocus) {
        const back = o.returnFocus?.() ?? (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]') ? opener : null);
        (back ?? document.getElementById('wh-play') ?? document.body).focus?.({ preventScroll: true });
      }
      return true;
    },
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') {
      const f = focusablesOf(o.el);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !o.el.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !o.el.contains(a))) { e.preventDefault(); first.focus(); }
    }
  };
  o.el.addEventListener('keydown', onKey);
  const entry: Entry = { layer, o, opener, inerted };
  stack.push(entry);
  // focus goes in on the next frame (the layer is in the page and measurable)
  const focusIn = (): void => {
    if (!isOpen) return;
    const t = o.initialFocus?.() ?? focusablesOf(o.el)[0] ?? null;
    (t ?? o.el).focus?.({ preventScroll: true });
  };
  focusIn();
  return layer;
}

/** The topmost layer, or null. */
export const topLayer = (): Layer | null => stack[stack.length - 1]?.layer ?? null;
export const layerCount = (): number => stack.length;
/** Esc: close the top layer when it allows it; true when something closed (UI.md 4.5 layers 2 and 3). */
export function closeTopLayer(why = 'escape'): boolean {
  const e = stack[stack.length - 1];
  if (!e || e.o.escapeCloses === false) return false;
  return e.layer.close(why);
}

export interface ModalButton {
  label: string;
  /** 'gel' (the main answer), 'coral' (a destructive one), 'glass' (the rest) */
  kind?: 'gel' | 'coral' | 'glass';
  /** runs on press; return false to keep the dialog open */
  onPress?(): void | boolean;
}
export interface ModalOpts {
  title: string;
  text: string;
  buttons: readonly ModalButton[];
  /** an alertdialog (something went wrong, or a choice that cannot be undone) */
  danger?: boolean;
  /** where the focus goes on close (default: the control that had it) */
  returnFocus?: () => HTMLElement | null;
  onClose?(why: string): void;
  /** the node the dialog lives under (default: the UI root) */
  parent?: HTMLElement;
}
export interface Modal { readonly el: HTMLElement; readonly open: boolean; close(why?: string): boolean }

let uid = 0;

/** The kit's small dialog (a reference build: `k-scrim > k-modal`). The first button is focused unless the dialog is a danger one (then the last, the safe answer). */
export function openModal(o: ModalOpts): Modal {
  const parent = o.parent ?? document.getElementById('ui') ?? document.body;
  const tid = `wh-modal-t${++uid}`, did = `wh-modal-d${uid}`;
  const armedAt = performance.now() + ARM_MS;
  const buttons = o.buttons.map((b) => {
    const kind = b.kind ?? 'glass';
    const el = h('button', { class: `k-btn${kind === 'glass' ? '' : ' k-gel'}${kind === 'coral' ? ' k-gel--coral' : ''}`, attrs: { type: 'button', 'data-sound': 'none' } }, h('span', { class: 'k-btn-label', text: b.label }));
    el.addEventListener('click', () => {
      if (performance.now() < armedAt) return;   // the tap that opened the dialog must not answer it
      const keep = b.onPress?.() === false;
      if (!keep) layer.close('button');
    });
    return el;
  });
  const dialog = h('div', { class: 'k-modal', attrs: { role: o.danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, 'aria-describedby': did } },
    h('h2', { class: 'k-modal-title', text: o.title, attrs: { id: tid } }), h('p', { class: 'k-modal-text', text: o.text, attrs: { id: did } }),
    h('div', { class: 'k-modal-actions' }, ...buttons));
  const scrim = h('div', { class: 'k-scrim wh-modal', attrs: { 'data-modal': 'true' } }, dialog);
  const layer = openLayer({
    el: scrim, parent,
    initialFocus: () => (o.danger ? buttons[buttons.length - 1] : buttons[0]) ?? null,
    returnFocus: o.returnFocus,
    onClose: (why) => { cue(why === 'escape' ? 'back' : 'close'); o.onClose?.(why); },
  });
  cue('open');
  return { el: scrim, get open() { return layer.open; }, close: (why) => layer.close(why) };
}
