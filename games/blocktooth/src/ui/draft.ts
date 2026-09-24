// BLOCKTOOTH — level-up draft: the "MUTATION REPORT" (CONTRACT.md §11, §12). ui lane.
// Three manila dossier cards on a science-desk backdrop. Rarity = frame colour + rubber stamp
// (never colour-only). Each card: case number, name, one-line per-stack desc, tags, stack pips
// "owned → next", NEW / FINAL / SUBJECT-SPECIFIC flags, a big key number.
// Input: 1/2/3 pick instantly · ←/→ + ENTER · click · R (or pad X) reroll · pad A picks the
// highlighted card. Space does NOT pick (it is the in-game HOOK and players mash it).

import type { Input } from '../core/input.ts';
import type { UpgradeDef, World } from '../core/types.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { TITANS } from '../data/titans.ts';
import { STR } from '../data/strings.ts';
import {
  type ModalSession, type UiPress, clearEl, div, el, fmt, keyChip, onTap, pulse, runModal, wrapIndex, flashesReduced,
} from './dom.ts';

type DraftResult = { pick: string } | { reroll: true };

export class DraftScreen {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly kicker: HTMLElement;
  private readonly cardsBox: HTMLDivElement;
  private readonly foot: HTMLDivElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly rerollLeft: HTMLElement;
  private cards: HTMLElement[] = [];
  private ids: string[] = [];
  private sel = 0;
  private session: ModalSession<DraftResult> | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-draft bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR.draft.title);
    div('bt-draft-bg', L);
    const head = this.head = div('bt-draft-head', L);
    const stamp = div('bt-draft-desk', head);
    stamp.appendChild(el('span', 'bt-draft-bureau', STR.network));
    stamp.appendChild(el('span', 'bt-draft-filed', STR.draft.filed));
    div('bt-draft-title', head, STR.draft.title);
    this.kicker = div('bt-draft-kicker', head);
    this.cardsBox = div('bt-draft-cards', L);
    this.cardsBox.setAttribute('role', 'listbox');
    const foot = this.foot = div('bt-draft-foot bt-confirmbar', L);
    const hints = div('bt-hints', foot);
    hints.appendChild(keyChip('1'));
    hints.appendChild(keyChip('2'));
    hints.appendChild(keyChip('3'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.draft.pick));
    hints.appendChild(el('span', 'bt-hint-gap'));
    hints.appendChild(keyChip('← →'));
    hints.appendChild(keyChip('ENTER'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.draft.choose));
    this.rerollBtn = el('button', 'bt-btn bt-btn-ghost bt-draft-reroll');
    this.rerollBtn.type = 'button';
    this.rerollBtn.tabIndex = -1;
    this.rerollBtn.appendChild(keyChip('R'));
    this.rerollBtn.appendChild(el('span', '', STR.draft.reroll));
    this.rerollLeft = el('small', '');
    this.rerollBtn.appendChild(this.rerollLeft);
    foot.appendChild(this.rerollBtn);
    onTap(this.rerollBtn, () => this.reroll());
  }

  open(w: World, offer: string[], rerollsLeft: number): Promise<DraftResult> {
    if (this.session && !this.session.done) this.session.abort();
    const ids = offer.filter((id) => !!id).slice(0, 3);
    this.ids = ids;
    this.sel = 0;
    const U = w.upgrades;
    const chest = U.pendingDrafts <= 0 && U.chestDrafts > 0;
    this.layer.classList.toggle('chest', chest);
    this.kicker.textContent = chest
      ? STR.draft.crate
      : fmt(STR.draft.level, { n: w.titan.level }) + ' · ' + (TITANS[w.titanId]?.name ?? '');

    const canReroll = rerollsLeft > 0 && ids.length > 0;
    this.rerollBtn.disabled = !canReroll;
    this.rerollBtn.classList.toggle('off', !canReroll);
    this.rerollLeft.textContent = canReroll ? fmt(STR.draft.rerollLeft, { n: rerollsLeft }) : STR.draft.noReroll;

    clearEl(this.cardsBox);
    this.cards = [];
    ids.forEach((id, i) => {
      const def = UPGRADE_BY_ID[id];
      const card = this.buildCard(w, id, def, i);
      this.cardsBox.appendChild(card);
      this.cards.push(card);
      onTap(card, () => this.pick(i));
      card.addEventListener('mouseenter', () => this.select(i));
    });
    this.select(0);

    this.layer.classList.remove('bt-hidden');
    DraftScreen.animateIn(this.cards, this.head, flashesReduced());

    const { promise, session } = runModal<DraftResult>(this.layer, this.input, (p, s) => this.onPress(p, s), {
      armMs: 260,
      spaceConfirms: false,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  /** The deal-in animation of the cards + header. The app's compositor pre-warm replays it on a
   *  detached copy: a warm-up with a generic fade/scale left the first real draft compiling 9–10 new
   *  Skia raster programs in one 50–80 ms GPU-process flush (draft frame #4); replaying exactly this
   *  animation leaves 3, none in a slow flush (Chrome trace, GrShaderCache::store). */
  static animateIn(cards: readonly HTMLElement[], head: HTMLElement | null, reduced: boolean): void {
    cards.forEach((c, i) => pulse(c, reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
        { transform: `translateY(60%) rotate(${(i - 1) * 9}deg) scale(.8)`, opacity: 0 },
        { transform: `translateY(-4%) rotate(${(i - 1) * -1.5}deg) scale(1.02)`, opacity: 1, offset: 0.7 },
        { transform: 'translateY(0) rotate(0) scale(1)', opacity: 1 },
      ], 420 + i * 90));
    if (head) pulse(head, [{ transform: 'translateY(-60%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 380);
  }

  // ─────────────────────────────── internals ───────────────────────────────

  private onPress(p: UiPress, _s: ModalSession<DraftResult>): void {
    switch (p.act) {
      case 'left': case 'up': this.select(wrapIndex(this.sel - 1, this.cards.length)); break;
      case 'right': case 'down': this.select(wrapIndex(this.sel + 1, this.cards.length)); break;
      case 'pick1': this.pick(0); break;
      case 'pick2': this.pick(1); break;
      case 'pick3': this.pick(2); break;
      case 'confirm': this.pick(this.sel); break;
      case 'reroll': this.reroll(); break;
      default: break;
    }
  }

  private select(i: number): void {
    if (!this.cards.length) return;
    this.sel = Math.max(0, Math.min(this.cards.length - 1, i));
    this.cards.forEach((c, j) => {
      c.classList.toggle('is-sel', j === this.sel);
      c.setAttribute('aria-selected', j === this.sel ? 'true' : 'false');
    });
  }

  private pick(i: number): void {
    const s = this.session;
    if (!s || s.done || i < 0 || i >= this.ids.length) return;
    this.select(i);
    const card = this.cards[i];
    card.classList.add('is-picked');
    this.cards.forEach((c, j) => { if (j !== i) c.classList.add('is-dropped'); });
    s.finish({ pick: this.ids[i] }, 260);
  }

  private reroll(): void {
    const s = this.session;
    if (!s || s.done || this.rerollBtn.disabled) return;
    pulse(this.rerollBtn, [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], 200);
    this.cards.forEach((c) => c.classList.add('is-dropped'));
    s.finish({ reroll: true }, 160);
  }

  private buildCard(w: World, id: string, def: UpgradeDef | undefined, i: number): HTMLElement {
    const rarity = def ? def.rarity : 'common';
    const owned = w.upgrades.owned[id] || 0;
    const max = def ? Math.max(1, def.maxStacks) : 1;
    const next = Math.min(max, owned + 1);

    const card = el('button', `bt-dossier r-${rarity}`);
    card.type = 'button';
    card.tabIndex = -1;
    card.setAttribute('role', 'option');

    const tab = div('bt-dossier-tab', card);
    tab.appendChild(el('span', '', fmt(STR.draft.caseFile, { n: String(caseNo(id)).padStart(3, '0') })));
    div('bt-dossier-key', card, String(i + 1));

    const paper = div('bt-dossier-paper', card);
    div('bt-dossier-stamp', paper, STR.draft.rarity[rarity]);
    const flags = div('bt-dossier-flags', paper);
    if (owned === 0) flags.appendChild(el('span', 'bt-flag new', STR.draft.newTag));
    if (next >= max && max > 1) flags.appendChild(el('span', 'bt-flag final', STR.draft.maxTag));
    if (def && def.titan) flags.appendChild(el('span', 'bt-flag locked', STR.draft.locked));
    div('bt-dossier-name', paper, def ? def.name.toUpperCase() : id.toUpperCase());
    div('bt-dossier-rule', paper);
    const body = div('bt-dossier-body', paper);
    div('bt-dossier-desc', body, def ? def.desc : '');
    // clipped "specimen photo": the mutation's monogram on a halftone swatch, tinted by its first tag
    const emb = div(`bt-dossier-emblem tag-${(def && def.tags[0]) || 'misc'}`, body);
    emb.appendChild(el('b', '', monogram(def ? def.name : id)));
    emb.appendChild(el('small', '', (def && def.tags[0] ? def.tags[0] : 'misc').toUpperCase()));
    div('bt-dossier-clip', emb);

    const tags = div('bt-dossier-tags', paper);
    for (const t of def ? def.tags : []) tags.appendChild(el('span', 'bt-tag', t.toUpperCase()));

    const st = div('bt-dossier-stacks', paper);
    st.appendChild(el('span', 'bt-dossier-stacks-lbl', STR.draft.stacks));
    const pips = div('bt-dossier-pips', st);
    for (let k = 0; k < max; k++) {
      const cls = k < owned ? 'bt-spip have' : k < next ? 'bt-spip gain' : 'bt-spip';
      div(cls, pips);
    }
    st.appendChild(el('span', 'bt-dossier-stacks-num', `${owned} → ${next}`));
    return card;
  }
}

/** "Load-Bearing Gut" → "LG" (first letters of the first and last words). */
function monogram(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 \-]/g, '').split(/[\s\-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0] || '?').slice(0, 2).toUpperCase();
}

/** Stable pseudo case number from the upgrade id (cosmetic). */
function caseNo(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 100 + (h % 900);
}
