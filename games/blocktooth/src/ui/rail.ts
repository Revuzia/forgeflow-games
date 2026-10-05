// BLOCKTOOTH ONLINE VS — the CARD RAIL UI (lane B-VIEW; vs_design.md §7, §12).
//
// A level-up in VS never opens the modal MUTATION REPORT: the sim never pauses. Instead 3 compact cards slide up above
// the ability bar while play continues. 1 / 2 / 3 pick (pad: A on the focused card, tap / click), R rerolls, and a ring
// timer drains for the 12 s auto-pick (the SIM auto-picks at PlayerState.rail.expireT; this is only the picture). Each
// card shows name, icon, the slot tag (NEW / UPGRADE LV a → b / SHARES A SLOT / ONE-OFF) and the effect line. Banish and
// lock are never shown (VS.rail.banish / lock are false). Queued offers show as a "+n" badge.
//
// This file READS the sim (World.pl.rail + World.upgrades.offer through the cursor, i.e. the VIEW seat's) and reports
// the player's choice through onPick / onReroll; the app turns those into TitanInput.railPick / railReroll for the next
// tick. It never calls pickUpgrade / rerollOffer itself.

import './vs.css';
import type { UpgradeDef, World } from '../core/types.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { STR } from '../data/strings.ts';
import { SLOT_CAP, cardSlot, isOverflowReward, slotsUsed } from '../upgrades/draft.ts';
import { VS as STR_VS, vsFmt } from '../data/strings_vs.ts';
import { familyColor, glyphSvg, iconFor } from './icons.ts';
import { ClassSlot, TextSlot, VarSlot, clearEl, div, el } from './dom.ts';

const OVF: Record<string, { name: string; desc: string }> = {
  ovf_sick_day: { name: STR.draft.overflow.ovf_sick_day.name, desc: STR.draft.overflow.ovf_sick_day.desc.replace('{n}', '35') },
  ovf_hot_tip: { name: STR.draft.overflow.ovf_hot_tip.name, desc: STR.draft.overflow.ovf_hot_tip.desc.replace('{n}', '35') },
  ovf_hard_hat: { name: STR.draft.overflow.ovf_hard_hat.name, desc: STR.draft.overflow.ovf_hard_hat.desc.replace('{n}', '20') },
};

/** one short effect line: the first sentence of the card text, capped */
function shortDesc(d: string): string {
  const s = d.trim();
  const cut = s.search(/[.;](\s|$)/);
  const one = cut > 12 ? s.slice(0, cut) : s;
  return one.length > 78 ? one.slice(0, 75).trimEnd() + '…' : one;
}

export class CardRail {
  private readonly layer: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly cards: HTMLDivElement;
  private readonly title: TextSlot;
  private readonly keys: TextSlot;
  private readonly queued: TextSlot;
  private readonly timerBar: HTMLElement;
  private readonly timer: VarSlot;
  private readonly timerLow: ClassSlot;
  private readonly reroll: HTMLElement;
  private readonly rerollT: TextSlot;
  private key = '';
  private shown = false;
  private open = false;
  private hideTimer = 0;
  /** a card was clicked / tapped (1..3) */
  onPick: ((n: number) => void) | null = null;
  /** the reroll button was clicked */
  onReroll: (() => void) | null = null;

  constructor(root: HTMLElement) {
    const L = this.layer = div('bt-layer bt-vs-rail bt-hidden', root);
    L.dataset.v2 = 'rail';
    const box = this.box = div('bt-vs-railbox', L);
    const head = div('bt-vs-rail-head', box);
    this.title = new TextSlot(el('b'));
    head.appendChild(this.title.node);
    this.keys = new TextSlot(el('span', '', STR_VS.rail.keys));
    head.appendChild(this.keys.node);
    this.queued = new TextSlot(el('span', 'q'));
    head.appendChild(this.queued.node);
    this.timerBar = div('bt-vs-rail-timer', box);
    const tf = el('b');
    this.timerBar.appendChild(tf);
    this.timer = new VarSlot(tf, '--p', 0.005);
    this.timerLow = new ClassSlot(this.timerBar, 'low');
    this.cards = div('bt-vs-rail-cards', box);
    const rr = this.reroll = div('bt-vs-rail-reroll', box);
    this.rerollT = new TextSlot(rr);
    rr.addEventListener('mousedown', (e) => e.preventDefault());
    rr.addEventListener('click', () => { if (this.onReroll && !rr.classList.contains('off')) this.onReroll(); });
  }

  show(on: boolean): void {
    this.shown = on;
    this.layer.classList.toggle('bt-hidden', !on);
    if (!on) this.setOpen(false, true);
  }

  /** drop the current offer's DOM (a new match) */
  clear(): void {
    this.key = '';
    clearEl(this.cards);
    this.setOpen(false, true);
  }

  /** `active` = the view seat is the local human (a spectate hides the rail) */
  update(w: World, active: boolean, pad = false): void {
    if (!this.shown) return;
    this.keys.set(pad ? STR_VS.rail.padKeys : STR_VS.rail.keys);
    const R = w.pl.rail, U = w.upgrades;
    const offer = U.offer;
    const want = active && !!R && R.open && !!offer && offer.length > 0 && !w.run.result;
    if (!want || !offer) { this.setOpen(false, false); return; }
    const key = String(w.cur) + ':' + R.seq + ':' + offer.join(',');
    if (key !== this.key) { this.key = key; this.build(w, offer); }
    this.setOpen(true, false);
    const span = Math.max(0.5, R.expireT - R.openedT);
    const left = Number.isFinite(R.expireT) ? Math.max(0, Math.min(1, (R.expireT - w.t) / span)) : 1;
    this.timer.set(left);
    this.timerLow.set(left < 0.25);
    const rer = Math.max(0, U.rerolls | 0);
    this.rerollT.set('R · ' + STR_VS.rail.reroll + (rer > 0 ? ' (' + rer + ')' : ''));
    this.reroll.classList.toggle('off', rer <= 0);
    const q = Math.max(0, (U.pendingDrafts | 0) + (U.chestDrafts | 0) - 1);
    this.queued.set(q > 0 ? vsFmt(STR_VS.rail.queued, { n: q }) : '');
  }

  private setOpen(on: boolean, instant: boolean): void {
    if (on === this.open && !instant) return;
    this.open = on;
    window.clearTimeout(this.hideTimer);
    if (on) {
      this.box.classList.add('on');
      requestAnimationFrame(() => { if (this.open) this.box.classList.add('in'); });
    } else {
      this.box.classList.remove('in');
      if (instant) this.box.classList.remove('on');
      else this.hideTimer = window.setTimeout(() => { if (!this.open) this.box.classList.remove('on'); }, 260);
    }
  }

  private build(w: World, offer: readonly string[]): void {
    clearEl(this.cards);
    const R = w.pl.rail;
    this.title.set(R.chest ? STR_VS.rail.chest : !R.openingDone && w.t < 12 ? STR_VS.rail.opening : STR_VS.rail.title);
    offer.forEach((id, i) => {
      const def: UpgradeDef | undefined = UPGRADE_BY_ID[id];
      const ovf = isOverflowReward(id);
      const rarity = def ? def.rarity : 'common';
      const card = el('button', 'bt-vs-card r-' + rarity + (def && def.evo ? ' evo' : ''));
      card.type = 'button'; card.tabIndex = -1;
      card.dataset.card = id; card.dataset.v2 = 'rail-card';
      card.appendChild(el('span', 'bt-vs-card-key', String(i + 1)));
      const ic = div('bt-vs-card-ic', card);
      if (def) ic.innerHTML = glyphSvg(iconFor(def), familyColor(def));
      const slot = cardSlot(w, id);
      const owned = w.upgrades.owned[id] || 0;
      const max = def ? Math.max(1, def.maxStacks) : 1;
      const tagTxt = ovf ? STR.draft.overflowStamp
        : slot === 'new' ? 'NEW · SLOT ' + Math.min(SLOT_CAP, Math.round(slotsUsed(w)) + 1) + '/' + SLOT_CAP
          : slot === 'upgrade' ? STR.draft.slotUpgrade + ' LV ' + owned + ' → ' + Math.min(max, owned + 1)
            : slot === 'shared' ? STR.draft.slotShared
              : slot === 'free' ? STR.draft.slotFree
                : slot === 'evolution' ? 'EVOLUTION' : '';
      if (tagTxt) div('bt-vs-card-tag s-' + slot, card, tagTxt);
      div('bt-vs-card-name', card, ovf ? (OVF[id]?.name ?? id).toUpperCase() : def ? def.name.toUpperCase() : id.toUpperCase());
      div('bt-vs-card-desc', card, ovf ? shortDesc(OVF[id]?.desc ?? '') : def ? shortDesc(def.desc) : '');
      // the full text rides a tooltip (hover; long-press on touch): the card itself shows one short line (vs_design.md 7)
      card.title = ovf ? (OVF[id]?.name ?? id) + ' — ' + (OVF[id]?.desc ?? '') : def ? def.name + ' — ' + def.desc : id;
      card.addEventListener('mousedown', (e) => e.preventDefault());
      card.addEventListener('click', () => { card.classList.add('picked'); if (this.onPick) this.onPick(i + 1); });
      this.cards.appendChild(card);
    });
  }
}
