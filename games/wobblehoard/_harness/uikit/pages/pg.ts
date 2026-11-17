// PLAYGROUND (PG_SHELL round 4): the play-time HUD elements PLAYGROUND adds, in every state, on the kit's backdrops (UI.md 5: "every new HUD element in
// _harness/uikit/"). The DOM is built exactly as the game builds it (src/ui/thingAuto.ts, src/shell/hudBinding.ts lifeBtn, src/ui/hoard/panel.ts matChip).
import { h } from '../../../src/ui/dom.ts';
import { icon } from '../../../src/ui/icons.ts';
import { cell, grid, sub } from './types.ts';
import type { KitSection } from './types.ts';
import '../../../src/ui/play.css';

/** round 5 (VERDICT_PG B3): the play UI's pieces, as ui/later-play.ts builds them (UI.md 5: every new HUD element in every state) */
const pill = (text: string): HTMLElement => h('div', { class: 'pl-pill', attrs: { role: 'group', 'aria-label': 'Next stamp' } },
  h('button', { class: 'k-btn k-btn--sm k-glass pl-pill-go', attrs: { type: 'button', 'aria-label': `Next stamp: ${text}. Open the Journal` } }, icon('book'), h('span', { class: 'pl-pill-text', text: `Next: ${text}` })),
  h('button', { class: 'k-btn k-iconbtn k-btn--sm pl-pill-x', attrs: { type: 'button', 'aria-label': 'Hide the next stamp' } }, icon('close')));
const moment = (text: string): HTMLElement => h('div', { class: 'pl-moment k-card', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'pl-moment-icon' }, icon('stamp')), h('span', { class: 'pl-moment-text', text }));
const wish = (text: string, go: boolean): HTMLElement => h('section', { class: 'pl-wish k-card', attrs: { role: 'dialog', 'aria-label': 'A wish' } },
  h('span', { class: 'pl-wish-icon' }, icon('star')), h('p', { class: 'pl-wish-text', text }),
  h('div', { class: 'pl-wish-row' }, ...(go ? [h('button', { class: 'k-btn k-btn--sm k-btn--gel pl-wish-go', attrs: { type: 'button' } }, icon('arrowRight'), h('span', { text: "Let's go" }))] : []), h('button', { class: 'k-btn k-btn--sm pl-wish-no', attrs: { type: 'button' } }, h('span', { text: 'Not now' }))));
const pop = (): HTMLElement => {
  const p = h('section', { class: 'pl-pop k-card', attrs: { role: 'dialog', 'aria-label': 'Your squishies' } },
    h('header', { class: 'pl-pop-head' }, h('h2', { class: 'pl-pop-title', text: 'Your squishies' }), h('button', { class: 'k-btn k-iconbtn k-btn--sm pl-pop-close', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close'))),
    h('div', { class: 'k-chips pl-pop-who' }, ...['Dollop', 'Crimpo', 'Wisplet'].map((n, i) => h('button', { class: 'k-chip pl-pop-chip', attrs: { type: 'button', 'aria-pressed': String(i === 0) } }, h('span', { text: n })))),
    h('p', { class: 'pl-pop-label', text: 'Go play with...' }),
    h('div', { class: 'pl-pop-things' }, ...['Felt Ball', 'Music Box', 'Snooze Rug'].map((n) => h('button', { class: 'k-btn k-btn--sm pl-pop-thing', attrs: { type: 'button' } }, h('span', { text: n })))));
  p.style.position = 'static'; p.style.width = '320px';
  return p;
};

/** the AUTO chip of a hinge ride (D-95 revised), as thingAuto.ts builds it */
const autoChip = (on: boolean, name: string): HTMLElement =>
  h('button', { class: 'k-chip thing-auto', attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Auto: the ${name} moves by itself` } }, icon('reset'), h('span', { class: 'thing-auto-label', text: 'Auto' }));
/** "Put back n", as panel.ts builds it (a kit button since round 4) */
const matChip = (n: number): HTMLElement =>
  h('button', { class: 'mat-chip k-btn k-btn--sm', attrs: { type: 'button', 'aria-label': `Put the ${n === 1 ? 'squishy' : `${n} squishies`} you brought out back on the shelf` } },
    h('span', { class: 'k-btn-label', text: 'Put back' }), h('span', { class: 'mat-chip-n', text: String(n) }));
/** the Journal and Places dock entries, as hudBinding.ts lifeBtn builds them */
const dockEntry = (cls: string, ico: 'book' | 'map', label: string): HTMLElement =>
  h('button', { class: `k-btn k-tool dock-tool ${cls}`, attrs: { type: 'button', 'aria-label': label } }, icon(ico), h('span', { class: 'k-btn-label k-tool-label dock-tool-label', text: label }));

export function pgSections(): KitSection[] {
  return [
    {
      id: 'pg-play', title: 'PLAYGROUND round 5: the tracker pill, a stamp moment, the wish card, the party popover (ui/later-play.ts)',
      note: 'The slot under the top row, left of the Journal column: one at a time. 44 px targets; the pill is one line with an ellipsis; the wish card at most min(358px, 100vw - 32px).',
      build(host) {
        host.append(sub('The tracker pill (short and long), a stamp moment'));
        host.append(grid((['white', 'felt', 'ink'] as const).map((tone) => cell(`${tone}`, [pill('Chase the yarn'), pill('Watch a squishy nap on the Snooze Rug by the lamp · 1 of 2'), moment('New stamp: A gentle squeeze')], { tone }))));
        host.append(sub('The wish card (a place: Let\'s go; another wish: Not now only)'));
        host.append(grid([cell('a place wish', wish('Dollop wishes for a warm place: Hearthlog Cabin.', true), { tone: 'felt' }), cell('a nap wish', wish('Wisplet is sleepy.', false), { tone: 'ink' })]));
        host.append(sub('Your squishies (the name tag\'s popover)'));
        host.append(grid([cell('three out, Dollop addressed', pop(), { tone: 'felt' })]));
      },
    },
    {
      id: 'pg-auto', title: 'PLAYGROUND: the Auto chip of a swing or a rocker (D-95 revised)',
      note: 'Off by default; the player turns it on (aria-pressed). 32 px to see, 44 px to hit (k-chip). Anchored to the ride, never over the HUD.',
      build(host) {
        host.append(sub('Off and on, on each backdrop'));
        host.append(grid((['white', 'amber', 'felt', 'ink'] as const).map((tone) => cell(`${tone}: off, on`, [autoChip(false, 'Pillow Swing'), autoChip(true, 'Rocker Board')], { tone }))));
      },
    },
    {
      id: 'pg-dock', title: 'PLAYGROUND: Put back, the Journal and Places entries',
      note: '"Put back n" is a kit button (round 3 found the published chip unstyled). The Journal and Places sit in the dock\'s Collection group beside the Hoard.',
      build(host) {
        host.append(sub('Put back'));
        host.append(grid([cell('one out', matChip(1), { tone: 'felt' }), cell('four out', matChip(4), { tone: 'ink' }), cell('on white', matChip(2), { tone: 'white' })]));
        host.append(sub('Dock entries'));
        host.append(grid([cell('Journal', dockEntry('dock-journal', 'book', 'Journal'), { tone: 'ink' }), cell('Places', dockEntry('dock-places', 'map', 'Places'), { tone: 'ink' })]));
      },
    },
  ];
}
