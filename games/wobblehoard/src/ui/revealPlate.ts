// The name plate of a reveal (DESIGN 6.3 B3 / 6.4 T4, UI.md 6): it slides in at the 'reveal' beat on a tier-framed plate (a double rim, 3 px of
// the tier colour and 2 px of ink) with the species name, the tier gem and its name in jelly lettering, and a "New" sticker or an "x2 spare"
// chip; a merge that moved up adds TIER UP. It is also the plain reveal card when the stage has no round-2 ceremonies (the result is never
// hidden). Calm / reduced motion: a fade, no slide. It stays until hide(): the HUD binding hides it on the next interaction or PLATE_MS of game
// time after it showed (game time: a hidden tab or a paused frame loop does not eat it). Where it sits is hoard.css's (top centre; tiny: it
// replaces the bottom row while it shows). The plate is aria-hidden: the live region speaks plateText() once.
import type { TierName } from '../contracts.ts';
import { h } from './dom.ts';
import { gemSvg, setGem, tierLabel } from './gem.ts';
import { jelly, setJelly } from './jelly/jelly.ts';
import './jelly/jelly.css';

export const PLATE_MS = 3600;
/** the tier word's jelly size on the card form: it grows with the tier (the line form keeps the small optical size) */
const TIER_JELLY: Record<TierName, 'sm' | 'md' | 'lg'> = { common: 'sm', uncommon: 'sm', rare: 'md', epic: 'md', legendary: 'md', mythic: 'lg' };

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
  const tier = jelly('Common', { size: 'sm', tone: 'common', tag: 'span' });
  tier.classList.add('plate-tier');
  const nick = h('p', { class: 'plate-nick' });
  const el = h('div', { class: 'plate k-frame', attrs: { 'data-show': 'false', 'aria-hidden': 'true' } },
    banner, h('div', { class: 'plate-row' }, chip), name, h('p', { class: 'plate-tierline' }, gem, tier), nick);
  root.append(el);
  let shown = false;
  return {
    el,
    show(i) {
      setGem(gem, i.tier);
      banner.hidden = !i.tierUp;
      chip.textContent = i.isNew ? 'NEW' : `x${Math.max(2, i.copies)} spare`;
      chip.dataset.kind = i.isNew ? 'new' : 'spare';
      name.textContent = i.species;
      // the LINE form (hoard.css): tiny, strip, the portal's desktop box and a short phone get ONE line over the dock row; tall and roomy screens get the tier-scaled card
      const b = document.body.dataset, line = b.layout === 'tiny' || b.layout === 'strip' || b.density === 'short' || (b.layout === 'stack' && b.tall !== 'true');
      el.dataset.form = line ? 'line' : 'card';
      setJelly(tier, tierLabel(i.tier), { tone: i.tier, size: line ? 'sm' : TIER_JELLY[i.tier] });
      nick.textContent = i.nickname ?? '';
      nick.hidden = !i.nickname;
      el.dataset.tier = i.tier;
      el.dataset.show = 'true';
      shown = true;
    },
    hide() { el.dataset.show = 'false'; shown = false; },
    get shown() { return shown; },
    destroy() { el.remove(); },
  };
}
