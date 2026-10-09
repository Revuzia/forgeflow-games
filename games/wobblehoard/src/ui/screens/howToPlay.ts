// How to play (UI.md 6): five cards (Squish, Stretch, Capsules, Tools, Hoard and merge), each with a small picture, and the key table under a "Keyboard" disclosure (open where a
// keyboard is likely: a fine pointer, or after a key was used). The words are data (screenCopy.ts GUIDE_CARDS / GUIDE_KEYS). Real headings: the dialog's h2, the cards' h3.
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { guideArt } from './guideArt.ts';
import { GUIDE_CARDS, GUIDE_KEYS, GUIDE_KEYS_TITLE, GUIDE_TITLE } from './screenCopy.ts';
import { openScreen } from './screenFrame.ts';
import type { Screen } from './screenFrame.ts';

/** words in the key table that are not keys (drawn as plain text, not as a key cap) */
const NOT_A_KEY = new Set(['drag', 'Right-drag']);

export interface HowToOpts {
  parent: HTMLElement;
  returnFocus?: () => HTMLElement | null;
  onClose?(why: string): void;
}

export function buildHowToBody(): HTMLElement[] {
  const cards = h('div', { class: 'guide-cards' }, ...GUIDE_CARDS.map((c) =>
    h('article', { class: 'k-card guide-card', attrs: { 'data-card': c.id } },
      h('div', { class: 'guide-art-box' }, guideArt(c.id)),
      h('div', { class: 'guide-copy' }, h('h3', { class: 'k-card-title', text: c.title }), h('p', { class: 'k-card-text', text: c.text })))));
  const cap = (k: string): HTMLElement => (NOT_A_KEY.has(k) ? h('span', { class: 'gk-plain', text: k }) : h('kbd', { class: 'k-kbd', text: k }));
  const rows = GUIDE_KEYS.map((r) => h('tr', {}, h('th', { attrs: { scope: 'row' }, class: 'gk-keys' }, ...r.keys.map(cap)), h('td', { class: 'gk-does', text: r.does })));
  const keys = h('details', { class: 'guide-keys' },
    h('summary', {}, icon('keyboard'), h('span', { text: GUIDE_KEYS_TITLE }), icon('chevronDown', 'k-icon guide-chev')),
    h('table', { class: 'guide-table' }, h('caption', { class: 'sr-only', text: 'Keys and what they do' }), h('tbody', {}, ...rows)));
  if (matchMedia('(pointer: fine)').matches || document.body.dataset.kbd === '1') keys.open = true;
  return [cards, keys];
}

export function openHowTo(o: HowToOpts): Screen {
  return openScreen({ id: 'howto', title: GUIDE_TITLE, parent: o.parent, body: buildHowToBody(), returnFocus: o.returnFocus, onClose: o.onClose });
}
