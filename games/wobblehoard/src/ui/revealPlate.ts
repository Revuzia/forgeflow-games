// The name plate of a reveal (DESIGN 6.3 B3 / 6.4 T4): it slides in at the 'reveal' beat with the species name, the tier gem and label,
// and a NEW badge or an "x2 spare" chip; a merge that moved up adds TIER UP. It is also the plain reveal card when the stage has no
// round-2 ceremonies (the result is never hidden). Calm / reduced motion: a fade, no slide.
import type { TierName } from '../contracts.ts';
import { h } from './dom.ts';
import { gemSvg, setGem, tierLabel } from './gem.ts';

export interface RevealPlateInfo { species: string; tier: TierName; isNew: boolean; copies: number; tierUp: boolean; nickname: string | null }

export interface RevealPlate {
  readonly el: HTMLElement;
  show(i: RevealPlateInfo): void;
  hide(): void;
  readonly shown: boolean;
  destroy(): void;
}

export function plateText(i: RevealPlateInfo): string {
  const chip = i.isNew ? 'New!' : `You have ${i.copies}.`;
  return `${i.tierUp ? 'Tier up! ' : ''}${chip} ${i.species}, ${tierLabel(i.tier)}${i.nickname ? `, called ${i.nickname}` : ''}.`;
}

export function createRevealPlate(root: HTMLElement): RevealPlate {
  const gem = gemSvg('common', 'gem gem-lg');
  const banner = h('p', { class: 'plate-banner', text: 'Tier up!' });
  const chip = h('span', { class: 'plate-chip' });
  const name = h('p', { class: 'plate-name' });
  const tier = h('span', { class: 'plate-tier' });
  const nick = h('p', { class: 'plate-nick' });
  const el = h('div', { class: 'plate', attrs: { 'data-show': 'false', 'aria-hidden': 'true' } },
    banner, h('div', { class: 'plate-row' }, chip), name, h('p', { class: 'plate-tierline' }, gem, tier), nick);
  root.append(el);
  let shown = false;
  let timer = 0;
  return {
    el,
    show(i) {
      setGem(gem, i.tier);
      banner.hidden = !i.tierUp;
      chip.textContent = i.isNew ? 'NEW' : `x${Math.max(2, i.copies)} spare`;
      chip.dataset.kind = i.isNew ? 'new' : 'spare';
      name.textContent = i.species;
      tier.textContent = tierLabel(i.tier);
      nick.textContent = i.nickname ? `“${i.nickname}”` : '';
      nick.hidden = !i.nickname;
      el.dataset.tier = i.tier;
      el.dataset.show = 'true';
      shown = true;
      clearTimeout(timer);
      timer = window.setTimeout(() => { el.dataset.show = 'false'; shown = false; }, 3600);
    },
    hide() { clearTimeout(timer); el.dataset.show = 'false'; shown = false; },
    get shown() { return shown; },
    destroy() { clearTimeout(timer); el.remove(); },
  };
}
