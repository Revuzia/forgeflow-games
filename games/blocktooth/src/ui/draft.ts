// BLOCKTOOTH — level-up draft: the "MUTATION REPORT" (CONTRACT.md §11, §12; v2 FEATURES_V2 §7.5, lane L9).
// Three manila dossier cards on a science-desk backdrop. Rarity = frame colour + rubber stamp
// (never colour-only). Each card: case number, the card's glyph (ui/icons.ts, the same one the ability
// bar shows), name, one-line per-stack desc, tags, stack pips "owned → next", NEW / FINAL /
// SUBJECT-SPECIFIC flags, a big key number.
// v2: BANISH (X · hold pad Y 0.5 s · the ✕ corner button) and LOCK (C · pad LB · the ▣ corner button)
// resolve {banish} / {lock}; the app applies them and re-opens the same draft with the new offer (only the
// replacement card deals in). Charges in the header (`REROLL 1 · BANISH 2 · LOCK 2`). A held card wears a
// HELD padlock badge; last report's hold arrives in slot 0 stamped HELD FROM LAST REPORT. Evolution cards
// are stamped RESTRUCTURED with a gold→coral frame, `EVOLVES <BASE>` (base glyph → evo glyph) and the foot
// `REPLACES <BASE> · KEEPS <WITH>`. Newly unlocked cards (DraftCtx.newIds) wear a NEW ribbon.
// Input: 1/2/3 pick instantly · ←/→ + ENTER · click · R (or pad X) reroll · pad A picks the
// highlighted card. Space does NOT pick (it is the in-game HOOK and players mash it).
// Mash guards for BANISH (§2.4): UiKeys edge-detects pad buttons against the state at start() (a Y held
// from play is no press); BANISH ignores presses for DRAFT_V2.banishArmS after open; on pad it is a HOLD
// polled every frame through navigator.getGamepads() (a tap never completes it).
// TITAN PASS D1 BUILD SLOTS (FEATURES_V2 §7.7, lane DRAFT): the header counts `SLOTS n/8` and turns into the
// `SLOTS FULL — UPGRADES ONLY` banner once every slot is taken; every card carries a slot tab beside its case tab
// (upgrades/draft.ts cardSlot): NEW — TAKES A SLOT (n/8) · UPGRADE LV a → b · SHARES A SLOT · ONE-OFF — NO SLOT.
// OVERFLOW rewards (slots full, nothing left to deepen) are OFF THE RECORD cards; they cannot be banished, locked
// or rerolled, and an all-overflow draft swaps the header for NOTHING NEW TO FILE.

import type { Input } from '../core/input.ts';
import type { UpgradeDef, World } from '../core/types.ts';
import type { DraftCtx, DraftResultV2, GlyphId } from '../v2types.ts';
import { DRAFT_V2 } from '../core/config.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { TITANS } from '../data/titans.ts';
import { STR } from '../data/strings.ts';
import { SCREENS } from '../data/strings_screens.ts';
import { OVERFLOW, SLOT_CAP, cardSlot, deliveredHold, isOverflowReward, recipeHint, slotsFull, slotsUsed } from '../upgrades/draft.ts';
import { familyColor, glyphSvg, iconFor } from './icons.ts';
import {
  type ModalSession, type UiPress, clearEl, div, el, fmt, keyChip, onTap, pulse, runModal, wrapIndex, flashesReduced,
} from './dom.ts';

type Reopen = 'banish' | 'lock' | null;

export class DraftScreen {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly charges: HTMLElement;
  private readonly slots: HTMLElement;
  private readonly cardsBox: HTMLDivElement;
  private readonly foot: HTMLDivElement;
  private readonly hints: HTMLDivElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly rerollLeft: HTMLElement;
  private cards: HTMLElement[] = [];
  private ids: string[] = [];
  private sel = 0;
  private ctx: DraftCtx = { rerollsLeft: 0, banishLeft: 0, lockLeft: 0, locked: null, newIds: [] };
  private openedAt = 0;
  private hold: { t0: number; i: number } | null = null;
  private padMode = false;
  private reopen: Reopen = null;
  /** when reopen was set: honoured only by an open() soon after (the app re-opens the same draft at once) */
  private reopenAt = 0;
  private lastIds: string[] = [];
  private lastSel = 0;
  private session: ModalSession<DraftResultV2> | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    injectSlotCss();
    const L = this.layer = div('bt-layer bt-screen bt-draft bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR.draft.title);
    div('bt-draft-bg', L);
    const head = this.head = div('bt-draft-head', L);
    const stamp = div('bt-draft-desk', head);
    stamp.appendChild(el('span', 'bt-draft-bureau', STR.network));
    stamp.appendChild(el('span', 'bt-draft-filed', STR.draft.filed));
    this.title = div('bt-draft-title', head, STR.draft.title);
    this.kicker = div('bt-draft-kicker', head);
    this.charges = div('bt2-draft-charges', head);
    this.charges.dataset.v2 = 'draft-charges';
    this.slots = div('bt3-draft-slots', head);
    this.slots.dataset.v2 = 'draft-slots';
    this.cardsBox = div('bt-draft-cards', L);
    this.cardsBox.setAttribute('role', 'listbox');
    const foot = this.foot = div('bt-draft-foot bt-confirmbar', L);
    this.hints = div('bt-hints', foot);
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

  /** v2 (DraftScreenApi, FEATURES_V2 §7.5 / §13.1): resolves {pick} | {reroll: true} | {banish} | {lock}. */
  open(w: World, offer: string[], ctx: DraftCtx): Promise<DraftResultV2> {
    this.ctx = {
      rerollsLeft: ctx ? Math.max(0, ctx.rerollsLeft | 0) : 0,
      banishLeft: ctx ? Math.max(0, ctx.banishLeft | 0) : 0,
      lockLeft: ctx ? Math.max(0, ctx.lockLeft | 0) : 0,
      locked: ctx ? ctx.locked : null,
      newIds: ctx && ctx.newIds ? ctx.newIds : [],
    };
    const rerollsLeft = this.ctx.rerollsLeft;
    if (this.session && !this.session.done) this.session.abort();
    const reopen = performance.now() - this.reopenAt < 2000 ? this.reopen : null;
    this.reopen = null;
    this.hold = null;
    const ids = offer.filter((id) => !!id).slice(0, 3);
    const prevIds = this.lastIds;
    this.ids = ids;
    this.sel = reopen ? Math.max(0, Math.min(ids.length - 1, this.lastSel)) : 0;
    const U = w.upgrades;
    const chest = U.pendingDrafts <= 0 && U.chestDrafts > 0;
    this.layer.classList.toggle('chest', chest);
    // D1: an all-OVERFLOW draft (slots full, nothing left to deepen) gets its own header and no controls
    const allOvf = ids.length > 0 && ids.every((id) => isOverflowReward(id));
    const full = slotsFull(w);
    this.layer.classList.toggle('ovf', allOvf);
    this.layer.classList.toggle('slots-full', full);
    this.title.textContent = allOvf ? STR.draft.overflowTitle : STR.draft.title;
    this.kicker.textContent = allOvf
      ? STR.draft.overflowSub
      : chest
        ? STR.draft.crate
        : fmt(STR.draft.level, { n: w.titan.level }) + ' · ' + (TITANS[w.titanId]?.name ?? '');
    this.charges.textContent = fmt(SCREENS.draft.charges, { r: rerollsLeft, b: this.ctx.banishLeft, l: this.ctx.lockLeft });
    this.charges.classList.toggle('bt-hidden', allOvf);
    const used = Math.max(0, Math.round(slotsUsed(w)));
    this.slots.textContent = full ? STR.draft.slotsFull : fmt(STR.draft.slotCount, { n: used, cap: SLOT_CAP });
    this.slots.classList.toggle('full', full);

    const canReroll = rerollsLeft > 0 && ids.length > 0 && !allOvf;
    this.rerollBtn.disabled = !canReroll;
    this.rerollBtn.classList.toggle('off', !canReroll);
    this.rerollLeft.textContent = canReroll ? fmt(STR.draft.rerollLeft, { n: rerollsLeft }) : STR.draft.noReroll;
    this.padMode = this.padMode || padConnected();
    this.renderHints();

    const delivered = deliveredHold(w);
    clearEl(this.cardsBox);
    this.cards = [];
    ids.forEach((id, i) => {
      const def = UPGRADE_BY_ID[id];
      const card = this.buildCard(w, id, def, i, delivered === id && i === 0);
      this.cardsBox.appendChild(card);
      this.cards.push(card);
      onTap(card, () => this.pick(i));
      card.addEventListener('mouseenter', () => this.select(i));
    });
    this.select(this.sel);

    this.layer.classList.remove('bt-hidden');
    const reduced = flashesReduced();
    if (reopen === 'lock') {
      // same cards: only the hold badge changes
    } else if (reopen === 'banish') {
      this.cards.forEach((c, i) => {
        if (prevIds.includes(ids[i])) return;
        pulse(c, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
          { transform: 'translateY(40%) rotate(6deg) scale(.85)', opacity: 0 },
          { transform: 'translateY(0) rotate(0) scale(1)', opacity: 1 },
        ], 360);
      });
    } else {
      DraftScreen.animateIn(this.cards, this.head, reduced);
    }
    this.openedAt = performance.now();

    const { promise, session } = runModal<DraftResultV2>(this.layer, this.input, (p, s) => this.onPress(p, s), {
      armMs: 260,
      spaceConfirms: false,
      onFrame: () => this.pollHold(),
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; this.hold = null; },
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

  private onPress(p: UiPress, _s: ModalSession<DraftResultV2>): void {
    if (p.source === 'pad' && !this.padMode) { this.padMode = true; this.renderHints(); }
    else if (p.source === 'key' && this.padMode && p.key !== 'pad:stick') { this.padMode = false; this.renderHints(); }
    // v2 screen bindings, read from p.key before the act switch (FEATURES_V2 §2.4)
    if (p.key === 'x') { this.banish(this.sel); return; }
    if (p.key === 'pad:3') { this.startHold(); return; }
    if (p.key === 'c' || p.key === 'pad:4') { this.lock(this.sel); return; }
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

  private renderHints(): void {
    const H = this.hints;
    clearEl(H);
    const rows = this.padMode ? SCREENS.draft.hintsPad : SCREENS.draft.hintsKey;
    rows.forEach(([k, t], i) => {
      if (i > 0) H.appendChild(el('span', 'bt-hint-gap'));
      H.appendChild(keyChip(k));
      H.appendChild(el('span', 'bt-hint-txt', t));
    });
    this.rerollBtn.firstElementChild!.textContent = this.padMode ? 'X' : 'R';
  }

  private select(i: number): void {
    if (!this.cards.length) return;
    const next = Math.max(0, Math.min(this.cards.length - 1, i));
    if (next !== this.sel && this.hold) this.cancelHold();
    this.sel = next;
    this.cards.forEach((c, j) => {
      c.classList.toggle('is-sel', j === this.sel);
      c.setAttribute('aria-selected', j === this.sel ? 'true' : 'false');
    });
  }

  private pick(i: number): void {
    const s = this.session;
    if (!s || s.done || i < 0 || i >= this.ids.length) return;
    this.cancelHold();
    this.select(i);
    const card = this.cards[i];
    card.classList.add('is-picked');
    this.cards.forEach((c, j) => { if (j !== i) c.classList.add('is-dropped'); });
    this.lastIds = [];
    s.finish({ pick: this.ids[i] }, 260);
  }

  private reroll(): void {
    const s = this.session;
    if (!s || s.done || this.rerollBtn.disabled) return;
    this.cancelHold();
    pulse(this.rerollBtn, [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], 200);
    this.cards.forEach((c) => { if (!c.classList.contains('is-held')) c.classList.add('is-dropped'); });
    this.lastIds = [];
    s.finish({ reroll: true }, 160);
  }

  /** BANISH the card in slot i: refused inside the arm window, with no charge left, or on a lone card
   *  (the sim refuses the last card of a 1-card offer). */
  private banish(i: number): void {
    const s = this.session;
    if (!s || s.done || i < 0 || i >= this.ids.length) return;
    if (performance.now() - this.openedAt < DRAFT_V2.banishArmS * 1000) return;
    const card = this.cards[i];
    if (this.ctx.banishLeft <= 0 || this.ids.length <= 1 || isOverflowReward(this.ids[i])) { this.refuse(card, '.bt2-corner.b'); return; }
    this.cancelHold();
    this.select(i);
    card.classList.add('is-banished');
    this.reopen = 'banish';
    this.reopenAt = performance.now();
    this.lastIds = this.ids.filter((_, j) => j !== i);
    this.lastSel = i;
    s.finish({ banish: this.ids[i] }, flashesReduced() ? 120 : 350);
  }

  /** LOCK toggle on slot i (unlocking the held card refunds; moving the hold costs nothing more). */
  private lock(i: number): void {
    const s = this.session;
    if (!s || s.done || i < 0 || i >= this.ids.length) return;
    const id = this.ids[i];
    const card = this.cards[i];
    if (isOverflowReward(id)) { this.refuse(card, '.bt2-corner.l'); return; }   // D1: an OVERFLOW reward is never held
    if (this.ctx.locked !== id && !this.ctx.locked && this.ctx.lockLeft <= 0) { this.refuse(card, '.bt2-corner.l'); return; }
    this.cancelHold();
    this.select(i);
    card.classList.toggle('is-held', this.ctx.locked !== id);
    pulse(card, [{ transform: 'translateY(calc(var(--u) * -1.2)) scale(1.035) rotate(-1.5deg)' }, { transform: '' }], 160);
    this.reopen = 'lock';
    this.reopenAt = performance.now();
    this.lastIds = this.ids.slice();
    this.lastSel = i;
    s.finish({ lock: id }, 120);
  }

  private refuse(card: HTMLElement | undefined, sel: string): void {
    if (!card) return;
    const b = card.querySelector(sel) as HTMLElement | null;
    pulse(b ?? card, [{ transform: 'translateX(-8%)' }, { transform: 'translateX(8%)' }, { transform: 'none' }], 200);
  }

  // ── pad-Y hold → BANISH ──
  private startHold(): void {
    if (!this.session || this.session.done || !this.cards.length) return;
    if (performance.now() - this.openedAt < DRAFT_V2.banishArmS * 1000) return;   // mash guard
    if (this.ctx.banishLeft <= 0 || this.ids.length <= 1 || isOverflowReward(this.ids[this.sel])) { this.refuse(this.cards[this.sel], '.bt2-corner.b'); return; }
    this.hold = { t0: performance.now(), i: this.sel };
    this.cards[this.sel].classList.add('is-holding');
    this.cards[this.sel].style.setProperty('--hold', '0');
  }

  private cancelHold(): void {
    if (!this.hold) return;
    const c = this.cards[this.hold.i];
    if (c) { c.classList.remove('is-holding'); c.style.setProperty('--hold', '0'); }
    this.hold = null;
  }

  private pollHold(): void {
    const h = this.hold;
    if (!h) return;
    if (!padButtonHeld(3)) { this.cancelHold(); return; }
    const k = (performance.now() - h.t0) / (DRAFT_V2.banishHoldS * 1000);
    const c = this.cards[h.i];
    if (c) c.style.setProperty('--hold', Math.min(1, k).toFixed(3));
    if (k >= 1) { this.hold = null; if (c) c.classList.remove('is-holding'); this.banish(h.i); }
  }

  private buildCard(w: World, id: string, def: UpgradeDef | undefined, i: number, heldFromLast: boolean): HTMLElement {
    if (isOverflowReward(id)) return this.buildOverflowCard(id, i);
    const rarity = def ? def.rarity : 'common';
    const owned = w.upgrades.owned[id] || 0;
    const max = def ? Math.max(1, def.maxStacks) : 1;
    const next = Math.min(max, owned + 1);
    const evo = def && def.evo ? def.evo : null;
    const isNew = this.ctx.newIds.includes(id);
    const held = this.ctx.locked === id;

    const card = el('button', `bt-dossier r-${rarity}${evo ? ' evo' : ''}${held ? ' is-held' : ''}`);
    card.type = 'button';
    card.tabIndex = -1;
    card.setAttribute('role', 'option');
    card.dataset.card = id;

    const tabs = div('bt3-tabs', card);
    const tab = div('bt-dossier-tab', tabs);
    tab.appendChild(el('span', '', fmt(STR.draft.caseFile, { n: String(caseNo(id)).padStart(3, '0') })));
    // D1 slot tab (upgrades/draft.ts cardSlot): what taking this card does to the build slots
    const slot = cardSlot(w, id);
    const slotTxt = slot === 'new' ? `${STR.draft.slotNew} (${Math.round(slotsUsed(w)) + 1}/${SLOT_CAP})`
      : slot === 'upgrade' ? `${STR.draft.slotUpgrade} LV ${owned} → ${next}`
        : slot === 'shared' ? STR.draft.slotShared
          : slot === 'free' ? slotFreeText()
            : '';
    if (slotTxt) {
      const st = div(`bt3-slottab s-${slot}`, tabs, slotTxt);
      st.dataset.v2 = 'slot-tag';
    }
    div('bt-dossier-key', card, String(i + 1));

    // v2 corner buttons (focused card): ✕ BANISH · ▣ LOCK — plus the pad-hold fill ring
    const corners = div('bt2-corners', card);
    const bb = el('button', 'bt2-corner b', '✕');
    bb.type = 'button'; bb.tabIndex = -1; bb.title = SCREENS.draft.banish;
    bb.classList.toggle('off', this.ctx.banishLeft <= 0);
    corners.appendChild(bb);
    const lb = el('button', 'bt2-corner l', '▣');
    lb.type = 'button'; lb.tabIndex = -1; lb.title = SCREENS.draft.lock;
    lb.classList.toggle('off', this.ctx.lockLeft <= 0 && !this.ctx.locked);
    corners.appendChild(lb);
    bb.addEventListener('click', (ev) => { ev.stopPropagation(); this.banish(i); });
    lb.addEventListener('click', (ev) => { ev.stopPropagation(); this.lock(i); });
    bb.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    lb.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    div('bt2-holdring', card);

    const paper = div('bt-dossier-paper', card);
    div('bt-dossier-stamp', paper, evo ? SCREENS.draft.evoStamp : STR.draft.rarity[rarity]);
    if (heldFromLast) div('bt2-heldlast', paper, SCREENS.draft.heldFromLast);
    const heldBadge = div('bt2-held', card);
    heldBadge.appendChild(el('i', ''));
    heldBadge.appendChild(el('b', '', SCREENS.draft.held));
    if (isNew) { const rb = div('bt2-ribbon', card); rb.appendChild(el('span', '', SCREENS.draft.newRibbon)); }
    const flags = div('bt-dossier-flags', paper);
    // D1: the slot tab (NEW — TAKES A SLOT) replaces the plain NEW flag (FEATURES_V2 §7.7 rule 7)
    if (next >= max && max > 1) flags.appendChild(el('span', 'bt-flag final', STR.draft.maxTag));
    if (def && def.titan) flags.appendChild(el('span', 'bt-flag locked', STR.draft.locked));
    // Gate F: this card advances a started evolution recipe (COMPLETES = taking it makes the recipe ready)
    const hint = evo ? null : recipeHint(w, id);
    if (hint) {
      const ed = UPGRADE_BY_ID[hint.evo];
      const nm = ed ? ed.name.toUpperCase() : hint.evo.toUpperCase();
      const f = el('span', `bt-flag evo${hint.completes ? ' ready' : ''}`, fmt(hint.completes ? SCREENS.draft.evoCompletes : SCREENS.draft.evoToward, { evo: nm }));
      f.dataset.v2 = 'evo-hint';
      flags.appendChild(f);
    }

    if (evo) {
      // EVOLVES <BASE>: base glyph → evo glyph
      const base = UPGRADE_BY_ID[evo.base];
      const eh = div('bt2-evohead', paper);
      const g1 = el('span', 'bt2-glyph sm');
      g1.innerHTML = base ? glyphSvg(iconFor(base), familyColor(base)) : '';
      eh.appendChild(g1);
      eh.appendChild(el('i', 'bt2-evo-arrow', '→'));
      const g2 = el('span', 'bt2-glyph sm evo');
      g2.innerHTML = def ? glyphSvg(iconFor(def), familyColor(def)) : '';
      eh.appendChild(g2);
      eh.appendChild(el('b', '', fmt(SCREENS.draft.evolves, { base: base ? base.name.toUpperCase() : evo.base })));
    }
    const nameRow = div('bt2-dname', paper);
    const g = el('span', `bt2-glyph dg r-${rarity}${evo ? ' evo' : ''}`);
    g.innerHTML = def ? glyphSvg(iconFor(def), familyColor(def)) : '';
    nameRow.appendChild(g);
    div('bt-dossier-name', nameRow, def ? def.name.toUpperCase() : id.toUpperCase());
    div('bt-dossier-rule', paper);
    const body = div('bt-dossier-body', paper);
    div('bt-dossier-desc', body, def ? def.desc : '');
    // clipped "specimen photo": the mutation's monogram on a halftone swatch, tinted by its first tag
    const tag0 = def ? (evo ? def.tags[1] ?? def.tags[0] : def.tags[0]) : 'misc';
    const emb = div(`bt-dossier-emblem tag-${tag0 || 'misc'}`, body);
    emb.appendChild(el('b', '', monogram(def ? def.name : id)));
    emb.appendChild(el('small', '', (tag0 || 'misc').toUpperCase()));
    div('bt-dossier-clip', emb);

    const tags = div('bt-dossier-tags', paper);
    for (const t of def ? def.tags : []) tags.appendChild(el('span', 'bt-tag', t.toUpperCase()));

    if (evo) {
      const base = UPGRADE_BY_ID[evo.base], wth = UPGRADE_BY_ID[evo.with];
      div('bt2-evofoot', paper, fmt(SCREENS.draft.evoFoot, {
        base: base ? base.name.toUpperCase() : evo.base, with: wth ? wth.name.toUpperCase() : evo.with,
      }));
    } else {
      const st = div('bt-dossier-stacks', paper);
      st.appendChild(el('span', 'bt-dossier-stacks-lbl', STR.draft.stacks));
      const pips = div('bt-dossier-pips', st);
      for (let k = 0; k < max; k++) {
        const cls = k < owned ? 'bt-spip have' : k < next ? 'bt-spip gain' : 'bt-spip';
        div(cls, pips);
      }
      st.appendChild(el('span', 'bt-dossier-stacks-num', `${owned} → ${next}`));
    }
    return card;
  }

  /** D1 OVERFLOW reward card (never owned, no slot): OFF THE RECORD stamp, STR.draft.overflow name / desc. */
  private buildOverflowCard(id: string, i: number): HTMLElement {
    const card = el('button', 'bt-dossier r-common ovf');
    card.type = 'button';
    card.tabIndex = -1;
    card.setAttribute('role', 'option');
    card.dataset.card = id;
    const tabs = div('bt3-tabs', card);
    const tab = div('bt-dossier-tab', tabs);
    tab.appendChild(el('span', '', fmt(STR.draft.caseFile, { n: String(caseNo(id)).padStart(3, '0') })));
    const st = div('bt3-slottab s-overflow', tabs, STR.draft.overflowStamp);
    st.dataset.v2 = 'slot-tag';
    div('bt-dossier-key', card, String(i + 1));
    const paper = div('bt-dossier-paper', card);
    div('bt-dossier-stamp', paper, STR.draft.overflowStamp);
    div('bt-dossier-flags', paper);
    const txt = overflowText(id);
    const nameRow = div('bt2-dname', paper);
    const g = el('span', 'bt2-glyph dg');
    g.innerHTML = glyphSvg(OVF_GLYPH[id] ?? 'plus', OVF_COLOR[id] ?? '#ffd166');
    nameRow.appendChild(g);
    div('bt-dossier-name', nameRow, txt.name);
    div('bt-dossier-rule', paper);
    const body = div('bt-dossier-body', paper);
    div('bt-dossier-desc', body, txt.desc);
    const emb = div('bt-dossier-emblem tag-misc', body);
    emb.appendChild(el('b', '', monogram(txt.name)));
    emb.appendChild(el('small', '', STR.draft.overflowStamp));
    div('bt-dossier-clip', emb);
    return card;
  }
}

// ── D1 OVERFLOW rewards: glyph, colour, text ({n} = the rounded percentage from upgrades/draft.ts OVERFLOW) ──
const OVF_GLYPH: Record<string, GlyphId> = { ovf_sick_day: 'bandage', ovf_hot_tip: 'megaphone', ovf_hard_hat: 'plate' };
const OVF_COLOR: Record<string, string> = { ovf_sick_day: '#ff6f5e', ovf_hot_tip: '#ffd166', ovf_hard_hat: '#4fb3b0' };
const OVF_PCT: Record<string, number> = {
  ovf_sick_day: OVERFLOW.sickDayHeal, ovf_hot_tip: OVERFLOW.hotTipUproar, ovf_hard_hat: OVERFLOW.hardHatShield,
};
function overflowText(id: string): { name: string; desc: string } {
  const t = (STR.draft.overflow as Record<string, { name: string; desc: string } | undefined>)[id] ?? { name: id.toUpperCase(), desc: '' };
  return { name: t.name, desc: fmt(t.desc, { n: Math.round(100 * (OVF_PCT[id] ?? 0)) }) };
}
function slotFreeText(): string {
  return STR.draft.slotFree;
}

const SLOT_CSS = `
.bt3-tabs { display: flex; align-items: flex-end; gap: calc(var(--u) * .35); margin-left: calc(var(--u) * 1); margin-right: calc(var(--u) * 2.4); min-width: 0; }
.bt3-tabs .bt-dossier-tab { margin-left: 0; flex: 0 0 auto; }
.bt3-slottab {
  flex: 0 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border: calc(var(--u) * .18) solid var(--ink); border-bottom: 0; border-radius: calc(var(--u) * .4) calc(var(--u) * .4) 0 0;
  padding: calc(var(--u) * .2) calc(var(--u) * .7) calc(var(--u) * .1); font-weight: 800; font-size: calc(var(--u) * .78);
  letter-spacing: .08em; text-transform: uppercase;
}
.bt3-slottab.s-new { background: var(--teal); color: var(--cream); }
.bt3-slottab.s-upgrade { background: var(--navy); color: var(--gold); }
.bt3-slottab.s-shared { background: var(--gold); color: var(--ink); }
.bt3-slottab.s-free { background: #6b5a8e; color: var(--cream); }
.bt3-slottab.s-overflow { background: var(--red); color: var(--cream); }
.bt3-draft-slots {
  margin-top: calc(var(--u) * .35); font-family: var(--f-mono); font-weight: 700; font-size: calc(var(--u) * .95); letter-spacing: .1em;
  color: var(--cream); background: rgba(47, 127, 134, .9); padding: calc(var(--u) * .1) calc(var(--u) * .8);
  border: calc(var(--u) * .12) solid rgba(244, 236, 216, .5);
}
.bt3-draft-slots.full { color: var(--ink); background: var(--gold); border-color: var(--ink); font-size: calc(var(--u) * 1.05); }
.bt-dossier.ovf .bt-dossier-paper { background: repeating-linear-gradient(135deg, #fbf5e6 0 calc(var(--u) * 1.4), #f3e6c4 calc(var(--u) * 1.4) calc(var(--u) * 2.8)); }
.bt-dossier.ovf .bt-dossier-stamp { color: var(--red); border-color: var(--red); }
.bt-dossier.ovf .bt2-corners { display: none !important; }
.bt-draft.ovf .bt-draft-title { color: var(--gold); text-shadow: calc(var(--u) * .4) calc(var(--u) * .4) 0 var(--red); }
`;
let slotCssOn = false;
function injectSlotCss(): void {
  if (slotCssOn || typeof document === 'undefined') return;
  slotCssOn = true;
  const st = document.createElement('style');
  st.dataset.bt = 'titanpass-draft-slots';
  st.textContent = SLOT_CSS;
  document.head.appendChild(st);
}

/** true when any connected pad has button `b` down (the BANISH hold poll). */
function padButtonHeld(b: number): boolean {
  try {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) {
      if (!p || !p.connected) continue;
      const btn = p.buttons[b];
      if (btn && (btn.pressed || btn.value > 0.6)) return true;
    }
  } catch { /* gamepads blocked */ }
  return false;
}

function padConnected(): boolean {
  try {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) if (p && p.connected) return true;
  } catch { /* ignore */ }
  return false;
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
