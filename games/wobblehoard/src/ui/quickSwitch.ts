// The HUD quick switcher (SHELL-2b "switch anytime"; UI.md 4.2, R12): the other squishies played lately and the hearted ones. One tap makes it the play
// squishy; [ and ] do the same from the keyboard (src/input/keyboard.ts). Hidden when there is nothing to switch to, while a ceremony runs and while the
// Hoard is open. Two forms live in the DOM and CSS (hud.css, keyed on body[data-layout] / data-tall) shows one:
//   row   (wide, tall stack)  up to 5 round 44 px buttons with the species icon and a double tier rim (3 px tier + 2 px ink, never colour alone: the button's
//         name says the tier word). Where the Hoard has no room (strip, tiny) the switcher is not drawn: [ and ] stay.
//   fold  (stack under 700 high)  [<] "1/6" [>]: two 44 px chevrons around the count (the squishy in hand is 1 of the rotation). UI.md R12 puts it in the info row,
//         but at 320 wide plate + fold + ring + Open do not fit one row (measured on the kit sheet), so hud.css sets the fold at the top left, which a short
//         stack leaves empty (no brand there); the shell moves it back into the info row only if the row ever has the room.
//         [>] plays the newest other squishy, [<] the oldest of the five: the same two answers [ ] give.
import type { TierName } from '../contracts.ts';
import { h } from './dom.ts';
import { tierLabel } from './gem.ts';
import { icon } from './icons.ts';
import { speciesIcon } from './speciesIcon.ts';
import { attachTooltip } from './tooltip.ts';

export interface SwitchChoice { id: string; species: string; name: string; tier: TierName }

export interface QuickSwitch {
  readonly el: HTMLElement;
  /** the OTHER squishies, newest first (the shell's list; the squishy in hand is not in it, so the fold counts it as 1 of the rotation) */
  set(choices: readonly SwitchChoice[]): void;
  /** the form CSS draws now: row | fold | off (strip and tiny draw none) */
  form(): 'row' | 'fold' | 'off';
  destroy(): void;
}

/** the owner's requirement: the last five played and hearted squishies */
export const QUICK_MAX = 5;

/** which form a layout draws (the same rule hud.css has; the probes read it) */
export function switchFormFor(layout: string, tall: boolean): 'row' | 'fold' | 'off' {
  if (layout === 'strip' || layout === 'tiny') return 'off';
  if (layout === 'stack' && !tall) return 'fold';
  return 'row';
}

export function createQuickSwitch(parent: HTMLElement, onPick: (id: string) => void): QuickSwitch {
  const row = h('div', { class: 'qs-row' });
  const prev = h('button', { class: 'k-btn k-iconbtn qs-step', attrs: { type: 'button', 'data-dir': 'prev', 'aria-label': 'Previous squishy' } }, icon('chevronLeft'));
  const next = h('button', { class: 'k-btn k-iconbtn qs-step', attrs: { type: 'button', 'data-dir': 'next', 'aria-label': 'Next squishy' } }, icon('chevronRight'));
  const count = h('span', { class: 'qs-count', attrs: { 'aria-hidden': 'true' } });
  const fold = h('div', { class: 'qs-fold' }, prev, count, next);
  const el = h('div', { class: 'qswitch', attrs: { role: 'group', 'aria-label': 'Switch squishy', hidden: '' } }, row, fold);
  parent.append(el);
  let key = '';
  let list: readonly SwitchChoice[] = [];
  next.addEventListener('click', () => { if (list.length) onPick(list[0].id); });
  prev.addEventListener('click', () => { if (list.length) onPick(list[list.length - 1].id); });
  return {
    el,
    set(choices) {
      list = choices.slice(0, QUICK_MAX);
      const k = list.map((c) => c.id).join(',');
      document.body.dataset.switch = String(list.length > 0);
      if (k === key) return;
      key = k;
      row.textContent = '';
      el.hidden = list.length === 0;
      count.textContent = `1/${list.length + 1}`;
      el.setAttribute('aria-label', `Switch squishy, ${list.length} other${list.length === 1 ? '' : 's'}`);
      for (const c of list) {
        const b = h('button', { class: 'k-btn qs-btn', attrs: { type: 'button', 'data-tier': c.tier, 'data-id': c.id, 'aria-label': `Play with ${c.name}, ${tierLabel(c.tier)}` } },
          speciesIcon(c.species, { cls: 'sp-icon qs-icon' }));
        attachTooltip(b, c.name);   // (a fine pointer only; the name is the accessible name already, with the tier word)
        b.addEventListener('click', () => onPick(c.id));
        row.append(b);
      }
    },
    form() { return switchFormFor(document.body.dataset.layout ?? 'wide', document.body.dataset.tall === 'true'); },
    destroy() { delete document.body.dataset.switch; el.remove(); },
  };
}
