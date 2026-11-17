// PLAYGROUND (PG_SHELL round 4): the play-time HUD elements PLAYGROUND adds, in every state, on the kit's backdrops (UI.md 5: "every new HUD element in
// _harness/uikit/"). The DOM is built exactly as the game builds it (src/ui/thingAuto.ts, src/shell/hudBinding.ts lifeBtn, src/ui/hoard/panel.ts matChip).
import { h } from '../../../src/ui/dom.ts';
import { icon } from '../../../src/ui/icons.ts';
import { cell, grid, sub } from './types.ts';
import type { KitSection } from './types.ts';

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
