// The Menu (UI.md 6, 6.1): the pause screen and the way to everything else. A jelly "Menu" heading, ONE close button, Resume (the gel), then the rows: Settings, Trophies,
// How to play, Credits (a row exists only where its screen does: the shell passes the rows it has), and two switches, Full screen (only where the page may use it) and Sound.
// A card on a wide screen, a bottom sheet on a phone held upright, the whole screen on a phone held sideways and on the portal phone (the rows in two columns, scrolling when
// taller). It stands on `openLayer` (modal.ts): everything behind is inert, Tab stays inside, Esc closes it, focus comes back.
//
// Opening it SUSPENDS the game ('covered': the sim stops, the music fades, the audio context sleeps, no finger reaches the toy: so the Menu itself is silent) and closing resumes: the Menu is the pause. `onOpen` / `onClose` are the
// shell's hooks for that (hudBinding.ts), so this file knows nothing about the game. First-play code (never a later-* chunk): `window.__PAUSE__.pause()` is synchronous.
import type { DestId } from '../shell/destinations.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import { jelly } from './jelly/jelly.ts';
import './jelly/jelly.css';
import { openLayer } from './modal.ts';
import type { Layer } from './modal.ts';
import { cue } from './uiSound.ts';
import './overlay.css';

export interface MenuRow {
  id: DestId;
  label: string;
  icon: IconName;
  /** the screen opens (the Menu has already closed and the game resumed) */
  open(): void;
  /** a dim line after the label, read each time the Menu opens ("3 / 20") */
  detail?(): string;
}
export interface MenuSwitch {
  /** false = the row is not drawn (no full screen where the page may not use it) */
  available: boolean;
  get(): boolean;
  set(on: boolean): void;
}
export interface MenuOptions {
  root: HTMLElement;
  /** the HUD's Menu button (aria-expanded follows) */
  button: HTMLButtonElement;
  rows: readonly MenuRow[];
  sound: MenuSwitch;
  fullscreen: MenuSwitch;
  /** the Menu opened: suspend the game */
  onOpen(): void;
  /** the Menu closed (why: 'escape' | 'resume' | 'button' | 'scrim' | 'row' | 'code'): resume the game */
  onClose(why: string): void;
  say(text: string): void;
  /** where focus goes when it closes (default: the control that had it when the Menu opened, else the squishy) */
  returnFocus?(): HTMLElement | null;
}
export interface Menu {
  readonly isOpen: boolean;
  readonly el: HTMLElement | null;
  open(): boolean;
  close(why?: string): boolean;
  toggle(): boolean;
  /** the Sound / Full screen switches follow the game (a key, another control) */
  sync(): void;
}

export const MENU_LINE = 'Menu open.';
/** the audio resumes asynchronously after `onClose`: the close cue follows this long after */
const CLOSE_CUE_MS = 170;

export function createMenu(o: MenuOptions): Menu {
  let layer: Layer | null = null;
  let scrim: HTMLElement | null = null;
  let syncFns: Array<() => void> = [];

  const switchRow = (ic: IconName, label: string, sw: MenuSwitch, key: string): { el: HTMLElement; input: HTMLInputElement } => {
    const input = h('input', { class: 'k-switch-input', attrs: { type: 'checkbox', role: 'switch', 'data-key': key } });
    input.checked = sw.get();
    input.addEventListener('change', () => sw.set(input.checked));
    const el = h('label', { class: 'k-switch menu-row' }, input,
      h('span', { class: 'k-switch-label menu-row-label' }, icon(ic), h('span', { text: label })),
      h('span', { class: 'k-switch-ui', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'k-switch-thumb' }, icon('check'))));
    return { el, input };
  };

  const build = (): { scrim: HTMLElement; resume: HTMLButtonElement } => {
    syncFns = [];
    const title = jelly('Menu', { size: 'md', tone: 'amber', tag: 'h2' });
    title.id = 'wh-menu-title';
    title.classList.add('menu-title');
    const close = h('button', { class: 'k-btn k-iconbtn menu-close', attrs: { type: 'button', 'aria-label': 'Close menu', title: 'Close (Esc)', 'data-sound': 'none' } }, icon('close'));
    close.addEventListener('click', () => api.close('button'));
    const resume = h('button', { class: 'k-btn k-gel k-cta menu-resume', attrs: { type: 'button', 'data-sound': 'none', 'data-key': 'resume' } }, icon('play', 'k-icon', { fill: true }), h('span', { class: 'k-btn-label', text: 'Resume' }));
    resume.addEventListener('click', () => api.close('resume'));
    const list = h('div', { class: 'menu-rows', attrs: { role: 'group', 'aria-label': 'Menu' } });
    for (const r of o.rows) {
      const detail = r.detail?.() ?? '';
      const b = h('button', { class: 'k-btn menu-row menu-link', attrs: { type: 'button', 'data-key': r.id, 'data-sound': 'none', ...(r.id === 'settings' ? { 'aria-haspopup': 'dialog' } : {}) } },
        icon(r.icon), h('span', { class: 'menu-row-label' }, h('span', { text: r.label }), detail ? h('span', { class: 'menu-row-detail', text: detail }) : null), icon('chevronRight', 'k-icon menu-chev'));
      b.addEventListener('click', () => { api.close('row'); r.open(); });
      list.append(b);
    }
    if (o.fullscreen.available) { const s = switchRow('fullscreen', 'Full screen', o.fullscreen, 'fullscreen'); list.append(s.el); syncFns.push(() => { s.input.checked = o.fullscreen.get(); }); }
    { const s = switchRow('soundOn', 'Sound', o.sound, 'sound'); list.append(s.el); syncFns.push(() => { s.input.checked = o.sound.get(); }); }
    const panel = h('section', { class: 'menu k-panel', attrs: { id: 'wh-menu', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-menu-title' } },
      h('div', { class: 'k-panel-grip', attrs: { 'aria-hidden': 'true' } }),
      h('header', { class: 'k-panel-head' }, title, close),
      h('div', { class: 'k-panel-body menu-body' }, resume, list));
    const sc = h('div', { class: 'k-scrim menu-scrim', attrs: { 'data-menu': 'true' } }, panel);
    // a press on the dim area (not on the panel) closes it, the way a sheet does everywhere
    sc.addEventListener('click', (e) => { if (e.target === sc) api.close('scrim'); });
    return { scrim: sc, resume };
  };

  const api: Menu = {
    get isOpen() { return !!layer?.open; },
    get el() { return layer?.open ? scrim : null; },
    open() {
      if (layer?.open) return false;
      const b = build();
      scrim = b.scrim;
      o.button.setAttribute('aria-expanded', 'true');
      layer = openLayer({
        el: b.scrim, parent: o.root,
        initialFocus: () => b.resume,
        returnFocus: () => o.returnFocus?.() ?? null,   // null = the control that had the focus when it opened (else the squishy)
        onClose: (why) => {
          o.button.setAttribute('aria-expanded', 'false');
          scrim = null;
          o.onClose(why);
          // the Menu is a pause: the audio is stopped while it is open (nothing could be heard going in), so the "closing" cue waits until the game runs again
          window.setTimeout(() => cue(why === 'row' ? 'open' : why === 'escape' ? 'back' : 'close'), CLOSE_CUE_MS);   // (a row opens a screen: "open"; Resume, the X, the dim area: "close"; Esc: "back")
        },
      });
      o.say(MENU_LINE);
      o.onOpen();
      return true;
    },
    close(why = 'code') { return layer?.open ? layer.close(why) : false; },
    toggle() { return api.isOpen ? api.close('button') : api.open(); },
    sync() { for (const f of syncFns) f(); },
  };
  return api;
}
