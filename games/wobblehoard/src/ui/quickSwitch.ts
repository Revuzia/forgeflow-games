// The HUD quick switcher (SHELL-2b "switch anytime"): a short row of the squishies played lately and the hearted ones, above the name
// tag, each a round button with the species icon. One tap makes it the play squishy; [ and ] do the same from the keyboard (handled by
// src/input/keyboard.ts). Hidden when there is nothing to switch to, while a ceremony runs and while the Hoard is open.
import type { TierName } from '../contracts.ts';
import { h } from './dom.ts';
import { tierLabel } from './gem.ts';
import { speciesIcon } from './speciesIcon.ts';

export interface SwitchChoice { id: string; species: string; name: string; tier: TierName }

export interface QuickSwitch {
  readonly el: HTMLElement;
  set(choices: readonly SwitchChoice[]): void;
  destroy(): void;
}

export const QUICK_MAX = 4;

export function createQuickSwitch(parent: HTMLElement, onPick: (id: string) => void): QuickSwitch {
  const el = h('div', { class: 'qswitch', attrs: { role: 'group', 'aria-label': 'Switch squishy', hidden: '' } });
  parent.append(el);
  let key = '';
  return {
    el,
    set(choices) {
      const list = choices.slice(0, QUICK_MAX);
      const k = list.map((c) => c.id).join(',');
      document.body.dataset.switch = String(list.length > 0);
      if (k === key) return;
      key = k;
      el.textContent = '';
      el.hidden = list.length === 0;
      for (const c of list) {
        const b = h('button', { class: 'qs-btn', attrs: { type: 'button', 'data-tier': c.tier, 'data-id': c.id, 'aria-label': `Play with ${c.name}, ${tierLabel(c.tier)}` } },
          speciesIcon(c.species, { cls: 'sp-icon qs-icon' }));
        b.title = c.name;
        b.addEventListener('click', () => onPick(c.id));
        el.append(b);
      }
    },
    destroy() { delete document.body.dataset.switch; el.remove(); },
  };
}
