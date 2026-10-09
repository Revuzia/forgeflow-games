// Credits (UI.md 6): the version, what the game is made of, the libraries with their licences, the privacy line, and a "Licences" disclosure with the three.js MIT text (the
// notice has to travel with the code; the minified bundle carries none). All text is set with textContent. The words are data (screenCopy.ts).
import { version } from '../../../package.json';
import { h } from '../dom.ts';
import { icon } from '../icons.ts';
import { CREDITS_BUILT_WITH, CREDITS_CRAFT, CREDITS_LICENCES_TITLE, CREDITS_LICENCE_NAME, CREDITS_MADE_BY, CREDITS_PRIVACY, CREDITS_TITLE, THREE_LICENCE } from './screenCopy.ts';
import { openScreen } from './screenFrame.ts';
import type { Screen } from './screenFrame.ts';

export interface CreditsOpts {
  parent: HTMLElement;
  returnFocus?: () => HTMLElement | null;
  onClose?(why: string): void;
}

export function buildCreditsBody(): HTMLElement[] {
  const hero = h('div', { class: 'credits-hero' },
    h('p', { class: 'credits-made', text: CREDITS_MADE_BY }),
    h('span', { class: 'credits-version', text: `Version ${version}` }));
  const craft = h('p', { class: 'credits-craft', text: CREDITS_CRAFT });
  const built = h('div', { class: 'credits-built', attrs: { role: 'group', 'aria-labelledby': 'wh-credits-built' } },
    h('h3', { class: 'k-group-title', text: 'Built with', attrs: { id: 'wh-credits-built' } }),
    h('ul', { class: 'credits-list' }, ...CREDITS_BUILT_WITH.map((c) =>
      h('li', { class: 'k-card credits-item' }, h('span', { class: 'credits-name', text: c.name }), h('span', { class: 'credits-licence', text: c.licence }), h('span', { class: 'credits-what', text: c.what })))));
  const privacy = h('p', { class: 'credits-privacy' }, icon('lock'), h('span', { text: CREDITS_PRIVACY }));
  const licences = h('details', { class: 'credits-licences' },
    h('summary', {}, icon('book'), h('span', { text: CREDITS_LICENCES_TITLE }), icon('chevronDown', 'k-icon guide-chev')),
    h('div', { class: 'credits-text', attrs: { role: 'region', 'aria-label': CREDITS_LICENCE_NAME, tabindex: '0' } },
      ...THREE_LICENCE.map((t, i) => h('p', { class: i === 0 ? 'credits-text-head' : '', text: t }))));
  return [hero, craft, built, privacy, licences];
}

export function openCredits(o: CreditsOpts): Screen {
  return openScreen({ id: 'credits', title: CREDITS_TITLE, parent: o.parent, body: buildCreditsBody(), returnFocus: o.returnFocus, onClose: o.onClose });
}
