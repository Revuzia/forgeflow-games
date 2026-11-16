// The frame of a reading screen (How to play, Credits; UI.md 6): a jelly heading, ONE close button, a body that scrolls inside itself. It stands on `openLayer` (ui/modal.ts):
// everything behind is inert, Tab stays inside, Esc closes (hudBinding's Esc order, layers 2 and 3), focus comes back to the control that opened it. A card on a wide screen, a
// bottom sheet on a stack, a card of two columns on a strip, the whole screen on the portal phone (screens.css decides from body[data-layout]).
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { headRoom, jelly, keepFitted } from '../jelly/jelly.ts';
import { openLayer } from '../modal.ts';
import { cue } from '../uiSound.ts';

export interface ScreenOpts {
  /** 'howto' | 'credits': the scrim's `data-screen` and the id stem */
  id: string;
  title: string;
  parent: HTMLElement;
  body: readonly Node[];
  returnFocus?: () => HTMLElement | null;
  onClose?(why: string): void;
}
export interface Screen { readonly el: HTMLElement; readonly open: boolean; close(why?: string): boolean }

export function openScreen(o: ScreenOpts): Screen {
  const tid = `wh-${o.id}-title`;
  const title = jelly(o.title, { size: 'md', tone: 'amber', tag: 'h2' });
  title.id = tid;
  title.classList.add('scr-title');
  const close = h('button', { class: 'k-btn k-iconbtn scr-close', attrs: { type: 'button', 'aria-label': `Close ${o.title.toLowerCase()}`, title: 'Close (Esc)' } }, icon('close'));
  const head = h('header', { class: 'k-panel-head' }, title, close);
  const panel = h('section', { class: `scr scr-${o.id} k-panel`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid } },
    h('div', { class: 'k-panel-grip', attrs: { 'aria-hidden': 'true' } }),
    head,
    h('div', { class: 'k-panel-body scr-body' }, ...o.body));
  const scrim = h('div', { class: 'k-scrim scr-scrim', attrs: { 'data-screen': o.id } }, panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) layer.close('scrim'); });   // a press on the dim area closes it, the way a sheet does everywhere
  const layer = openLayer({
    el: scrim, parent: o.parent,
    initialFocus: () => close,
    returnFocus: o.returnFocus,
    onClose: (why) => { unfit(); if (why === 'escape') cue('back'); o.onClose?.(why); },
  });
  const unfit = keepFitted(title, () => headRoom(head, close), panel);
  close.addEventListener('click', () => layer.close('button'));
  return { el: scrim, get open() { return layer.open; }, close: (why) => layer.close(why) };
}
