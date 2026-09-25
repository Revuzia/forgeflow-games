// BLOCKTOOTH — two-step select (CONTRACT.md §12; v2 FEATURES_V2 §8.4, lane L9). ui lane.
//   STEP 1 TITAN   four portrait cards (live portraits from titans/portraits.ts, passed in as data
//                  URLs) + SUBJECT FILE lore column (name, species, role, tagline, lore, AUTO / HOOK /
//                  DASH with names + descs, difficulty pips) + v2 COLOURWAY row under the lore column
//                  (canonical + 2 unlockable palettes; the portrait swaps through opts.portraitFor).
//   STEP 2 BIOME   three cards with CSS-painted mini skylines in each biome's palette + ZONE FILE
//                  lore column + v2 STARTING PERK row under the cards + confirm bar "DROP IN".
//   Both steps     v2 NEXT PERMIT PENDING slip clipped to the lore column (ui/goals.ts NextUnlockPanel),
//                  YOUR BEST ON FILE on the focused card's foot, GOALS & RECORDS [G] chip in the bar.
// Row model (v2): ←/→ act on the focused row (cards: move the focus; palette / perk: change the value);
// ↓ from the cards focuses the extra row, ↑ returns. ENTER / SPACE / pad A / pad Y confirm the step from
// any row · ESC / pad B / pad Select back a step (step 1 → resolves null) · G / pad X → GOALS & RECORDS
// (resolves {kind: 'goals', resume}; the app re-runs select with initial = resume) · click a card to
// choose it, click it again (or the bar) to confirm; swatches and perk arrows are clickable.

import type { Input } from '../core/input.ts';
import type { BiomeDef, BiomeId, EnemyKind, PerkId, Profile, TitanDef, TitanId } from '../core/types.ts';
import { BIOME_IDS, PERK_IDS, TITAN_IDS } from '../core/types.ts';
import type { SelectResultV2, SelectResume, SelectRow, SelectRunOpts } from '../v2types.ts';
import { bestKey } from '../core/save.ts';
import { TITANS } from '../data/titans.ts';
import { BIOMES } from '../data/biomes.ts';
import { BOSSES } from '../data/bosses.ts';
import { ENEMIES } from '../data/enemies.ts';
import { PERKS_DEF } from '../data/perks.ts';
import { TITAN_PALETTES } from '../data/palettes.ts';
import { STR } from '../data/strings.ts';
import { SCREENS } from '../data/strings_screens.ts';
import { paletteUnlocked, perkUnlocked } from '../meta/goals.ts';
import { glyphSvg } from './icons.ts';
import {
  type ModalSession, type UiPress, clearEl, cosmeticRng, div, el, fmt, fmtInt, fmtTime, keyChip, onTap, pulse, roman, runModal, wrapIndex,
  flashesReduced,
} from './dom.ts';
import { buildBug, wallClock } from './menus.ts';
import { NextUnlockPanel, goalUnlocking } from './goals.ts';

type Step = 1 | 2;

/** The regular HALVARD roster in escalation order (the elite RAMROD is announced separately). */
const RESPONSE_KINDS: readonly EnemyKind[] = ['android', 'squad', 'drone', 'buggy', 'apc', 'tank', 'walker'];

/** perk row values: index 0 = none, 1.. = PERK_IDS */
const PERK_VALUES: readonly (PerkId | null)[] = [null, ...PERK_IDS];

export class SelectScreen {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly clock: HTMLElement;
  private readonly tab1: HTMLElement;
  private readonly tab2: HTMLElement;
  private readonly stepLine: HTMLElement;
  private readonly stage: HTMLDivElement;
  private readonly titanRow: HTMLDivElement;
  private readonly biomeRow: HTMLDivElement;
  private readonly lore: HTMLDivElement;
  private readonly loreCol: HTMLDivElement;
  private readonly palRow: HTMLDivElement;
  private readonly palSwatches: HTMLElement[] = [];
  private readonly palNote: HTMLElement;
  private readonly deskRec: HTMLDivElement;
  private readonly perkRow: HTMLDivElement;
  private readonly perkVal: HTMLElement;
  private readonly permit: NextUnlockPanel;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly confirmLbl: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly rowHint: HTMLElement;
  private titanCards: HTMLElement[] = [];
  private titanImgs: (HTMLImageElement | null)[] = [];
  private titanBest: HTMLElement[] = [];
  private biomeCards: HTMLElement[] = [];
  private biomeBest: HTMLElement[] = [];
  private step: Step = 1;
  private ti = 0;
  private bi = 0;
  private row: SelectRow = 'cards';
  /** palette cursor per titan (0 = canonical); a locked cursor shows but starts the run canonical */
  private pal: Record<TitanId, number> = { molo: 0, voltkite: 0, hearthback: 0, briarwick: 0 };
  private perkIx = 0;
  private portraits: Record<TitanId, string> = {} as Record<TitanId, string>;
  private portraitFor: SelectRunOpts['portraitFor'] | null = null;
  private portraitReq: Record<string, number> = {};
  private profile: Profile | null = null;
  private bests: Record<string, number> = {};
  private session: ModalSession<SelectResultV2> | null = null;
  /** Focus at the moment select was backed out of (ESC at step 1): the next open resumes there
   *  instead of snapping back to the app's last-run choice. Consumed by the next run(). */
  private resume: { titan: TitanId; biome: BiomeId } | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt-select bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', STR.select.header);
    div('bt-sel-bg', L);
    div('bt-halftone soft', L);

    const head = div('bt-sel-head', L);
    const bug = buildBug(head, '');
    this.clock = bug.querySelector('.bt-clock') as HTMLElement;
    const ht = div('bt-sel-htxt', head);
    div('bt-sel-title', ht, STR.select.header);
    this.stepLine = div('bt-sel-step', ht);
    const tabs = div('bt-sel-tabs', head);
    this.tab1 = div('bt-sel-tab', tabs);
    this.tab1.appendChild(el('b', '', '1'));
    this.tab1.appendChild(el('span', '', STR.select.step1Short));
    this.tab2 = div('bt-sel-tab', tabs);
    this.tab2.appendChild(el('b', '', '2'));
    this.tab2.appendChild(el('span', '', STR.select.step2Short));

    const body = div('bt-sel-body', L);
    this.stage = div('bt-sel-stage', body);
    this.titanRow = div('bt-sel-cards titans', this.stage);
    this.titanRow.setAttribute('role', 'listbox');
    this.biomeRow = div('bt-sel-cards biomes', this.stage);
    this.biomeRow.setAttribute('role', 'listbox');

    // v2 STARTING PERK row (step 2, under the biome cards)
    const pr = this.perkRow = div('bt2-xrow bt2-perkrow', this.stage);
    pr.dataset.row = 'perk';
    pr.appendChild(el('span', 'bt2-xrow-lbl', SCREENS.select.perkLabel));
    const prev = el('button', 'bt2-arrow', '◀');
    prev.type = 'button'; prev.tabIndex = -1;
    pr.appendChild(prev);
    this.perkVal = div('bt2-perkval', pr);
    const next = el('button', 'bt2-arrow', '▶');
    next.type = 'button'; next.tabIndex = -1;
    pr.appendChild(next);
    onTap(prev, () => { this.focusRow('perk'); this.changePerk(-1); });
    onTap(next, () => { this.focusRow('perk'); this.changePerk(1); });
    pr.addEventListener('mouseenter', () => { if (this.step === 2) this.focusRow('perk'); });

    // lore column; under it a band: v2 COLOURWAY row (step 1) or the zone's DESK RECORD (step 2) on the
    // left, and the NEXT PERMIT PENDING slip clipped to the column's right edge
    this.loreCol = div('bt2-lore-col', body);
    this.lore = div('bt-lore', this.loreCol);
    const band = div('bt2-lore-band', this.loreCol);
    const pl = this.palRow = div('bt2-xrow bt2-palrow', band);
    pl.dataset.row = 'palette';
    pl.appendChild(el('span', 'bt2-xrow-lbl', SCREENS.select.paletteLabel));
    const sw = div('bt2-swatches', pl);
    for (let i = 0; i < 3; i++) {
      const b = el('button', 'bt2-swatch');
      b.type = 'button'; b.tabIndex = -1;
      sw.appendChild(b);
      this.palSwatches.push(b);
      onTap(b, () => { this.focusRow('palette'); this.setPalette(i); });
    }
    this.palNote = div('bt2-palnote', pl);
    pl.addEventListener('mouseenter', () => { if (this.step === 1) this.focusRow('palette'); });
    this.deskRec = div('bt2-deskrec bt-lore-rec', band);
    this.permit = new NextUnlockPanel(div('bt2-permit-slot', band));

    const bar = div('bt-sel-bar bt-confirmbar', L);
    const hints = div('bt-hints', bar);
    hints.appendChild(keyChip('← →'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.select.choose));
    hints.appendChild(el('span', 'bt-hint-gap'));
    hints.appendChild(keyChip('↑ ↓'));
    this.rowHint = el('span', 'bt-hint-txt', SCREENS.select.rowHint);
    hints.appendChild(this.rowHint);
    hints.appendChild(el('span', 'bt-hint-gap'));
    hints.appendChild(keyChip('ENTER'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.select.confirm));
    const goals = el('button', 'bt-btn bt-btn-ghost bt2-goals-chip');
    goals.type = 'button';
    goals.tabIndex = -1;
    goals.dataset.v2 = 'goals-chip';
    goals.appendChild(keyChip(SCREENS.goalsKey));
    goals.appendChild(el('span', '', SCREENS.goalsChip));
    bar.appendChild(goals);
    onTap(goals, () => this.openGoals());
    this.backBtn = el('button', 'bt-btn bt-btn-ghost');
    this.backBtn.type = 'button';
    this.backBtn.tabIndex = -1;
    this.backBtn.appendChild(keyChip('ESC'));
    this.backBtn.appendChild(el('span', '', STR.select.back));
    bar.appendChild(this.backBtn);
    this.confirmBtn = el('button', 'bt-btn bt-btn-coral bt-sel-go');
    this.confirmBtn.type = 'button';
    this.confirmBtn.tabIndex = -1;
    this.confirmLbl = el('span', '', STR.select.confirm);
    this.confirmBtn.appendChild(this.confirmLbl);
    this.confirmBtn.appendChild(keyChip('ENTER', 'dark'));
    bar.appendChild(this.confirmBtn);
    onTap(this.backBtn, () => this.back());
    onTap(this.confirmBtn, () => this.confirm());

    this.buildBiomeCards();
  }

  /** v2 (SelectScreenApi, FEATURES_V2 §8.4 / §13.1). Resolves {kind: 'start', titan, biome, perk, palette},
   *  {kind: 'goals', resume} (G / pad X / the chip) or null (ESC on step 1). */
  run(opts: SelectRunOpts): Promise<SelectResultV2> {
    if (this.session && !this.session.done) this.session.abort();
    this.portraits = opts.portraits || ({} as Record<TitanId, string>);
    this.portraitFor = typeof opts.portraitFor === 'function' ? opts.portraitFor : null;
    this.profile = opts.profile ?? null;
    this.bests = opts.bests || {};
    this.buildTitanCards(this.portraits);
    const init = opts.initial ?? {};
    const from = this.resume ?? init;
    this.resume = null;
    this.ti = Math.max(0, TITAN_IDS.indexOf(from.titan ?? TITAN_IDS[0]));
    this.bi = Math.max(0, BIOME_IDS.indexOf(from.biome ?? BIOME_IDS[0]));
    // palette cursors: the profile's last choice per titan, the resume value for the resumed titan
    const P = this.profile;
    for (const t of TITAN_IDS) this.pal[t] = clampPal(P && P.palette ? P.palette[t] : 0);
    if (init.palette !== undefined) this.pal[TITAN_IDS[this.ti]] = clampPal(init.palette);
    const perk = init.perk !== undefined ? init.perk : (P ? P.perk : null);
    this.perkIx = Math.max(0, PERK_VALUES.indexOf(perk ?? null));
    this.clock.textContent = wallClock();
    this.layer.classList.remove('bt-hidden');
    const step: Step = init.step === 2 && !this.resumeWasEsc(from, init) ? 2 : 1;
    this.row = 'cards';
    this.setStep(step, false);
    const row = init.row;
    if (row && ((row === 'palette' && step === 1) || (row === 'perk' && step === 2))) this.focusRow(row);
    this.renderPalette();
    this.renderPerk();
    for (const t of TITAN_IDS) if (this.pal[t] > 0) this.swapPortrait(t);
    pulse(this.layer, [{ opacity: 0 }, { opacity: 1 }], 220);
    const { promise, session } = runModal<SelectResultV2>(this.layer, this.input, (p) => this.onPress(p), {
      armMs: 250,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  /** an ESC-resume (this.resume) always reopens on step 1, whatever `initial` says */
  private resumeWasEsc(from: Partial<SelectResume>, init: Partial<SelectResume>): boolean { return from !== init; }

  // ─────────────────────────────── input ───────────────────────────────

  private onPress(p: UiPress): void {
    // v2 screen bindings are read from p.key before the act switch (FEATURES_V2 §2.4)
    if (p.key === 'g' || p.key === 'pad:2') { this.openGoals(); return; }
    switch (p.act) {
      case 'left': this.horiz(-1); break;
      case 'right': this.horiz(1); break;
      case 'down': if (this.row === 'cards') this.focusRow(this.step === 1 ? 'palette' : 'perk'); break;
      case 'up': if (this.row !== 'cards') this.focusRow('cards'); break;
      case 'confirm': case 'alt': this.confirm(); break;
      case 'back': this.back(); break;
      case 'pick1': this.jump(0); break;
      case 'pick2': this.jump(1); break;
      case 'pick3': this.jump(2); break;
      default: break;
    }
  }

  private horiz(d: number): void {
    if (this.row === 'palette') { this.setPalette(wrapIndex(this.pal[TITAN_IDS[this.ti]] + d, 3)); return; }
    if (this.row === 'perk') { this.changePerk(d); return; }
    this.move(d);
  }

  private move(d: number): void {
    if (this.step === 1) this.selectTitan(wrapIndex(this.ti + d, TITAN_IDS.length));
    else this.selectBiome(wrapIndex(this.bi + d, BIOME_IDS.length));
  }

  private jump(i: number): void {
    this.focusRow('cards');
    if (this.step === 1 && i < TITAN_IDS.length) this.selectTitan(i);
    else if (this.step === 2 && i < BIOME_IDS.length) this.selectBiome(i);
  }

  private focusRow(r: SelectRow): void {
    if (r === 'palette' && this.step !== 1) r = 'cards';
    if (r === 'perk' && this.step !== 2) r = 'cards';
    this.row = r;
    this.layer.dataset.row = r;
    this.palRow.classList.toggle('is-focus', r === 'palette');
    this.perkRow.classList.toggle('is-focus', r === 'perk');
    this.rowHint.textContent = r === 'cards' ? SCREENS.select.rowHint : SCREENS.select.rowHintUp;
  }

  private resumeState(): SelectResume {
    const titan = TITAN_IDS[this.ti];
    return { step: this.step, titan, biome: BIOME_IDS[this.bi], perk: PERK_VALUES[this.perkIx] ?? null, palette: this.pal[titan], row: this.row };
  }

  private openGoals(): void {
    const s = this.session;
    if (!s || s.done) return;
    s.finish({ kind: 'goals', resume: this.resumeState() }, 0);
  }

  private confirm(): void {
    const s = this.session;
    if (!s || s.done) return;
    if (this.step === 1) {
      pulse(this.titanCards[this.ti], [{ transform: 'translateY(-4%) scale(1.1)' }, { transform: '' }], 260);
      this.setStep(2, true);
      return;
    }
    const card = this.biomeCards[this.bi];
    if (card) card.classList.add('is-picked');
    this.resume = null;
    const titan = TITAN_IDS[this.ti];
    s.finish({
      kind: 'start', titan, biome: BIOME_IDS[this.bi],
      perk: this.perkChoice(), palette: this.palUnlocked(titan, this.pal[titan]) ? this.pal[titan] : 0,
    }, flashesReduced() ? 80 : 280);
  }

  private back(): void {
    const s = this.session;
    if (!s || s.done) return;
    if (this.step === 2) { this.setStep(1, true); return; }
    this.resume = { titan: TITAN_IDS[this.ti], biome: BIOME_IDS[this.bi] };
    s.finish(null, 0);
  }

  private setStep(step: Step, animate: boolean): void {
    this.step = step;
    this.layer.dataset.step = String(step);
    this.focusRow('cards');
    this.tab1.classList.toggle('on', step === 1);
    this.tab2.classList.toggle('on', step === 2);
    this.tab1.classList.toggle('done', step === 2);
    this.stepLine.textContent = step === 1 ? STR.select.step1 : STR.select.step2;
    this.confirmLbl.textContent = step === 1 ? STR.select.confirm : STR.select.dropIn;
    this.titanRow.classList.toggle('bt-hidden', step !== 1);
    this.biomeRow.classList.toggle('bt-hidden', step !== 2);
    this.palRow.classList.toggle('bt-hidden', step !== 1);
    this.deskRec.classList.toggle('bt-hidden', step !== 2);
    this.perkRow.classList.toggle('bt-hidden', step !== 2);
    if (step === 1) this.selectTitan(this.ti); else this.selectBiome(this.bi);
    if (step === 2) this.refreshBiomeBests();
    this.refreshPermit();
    if (animate) {
      const row = step === 1 ? this.titanRow : this.biomeRow;
      const cards = step === 1 ? this.titanCards : this.biomeCards;
      const dir = step === 2 ? 1 : -1;
      cards.forEach((c, i) => pulse(c, [
        { transform: `translateX(${dir * 40}%)`, opacity: 0 },
        { transform: 'translateX(0)', opacity: 1 },
      ], 260 + i * 60));
      pulse(row, [{ opacity: 0.4 }, { opacity: 1 }], 200);
    }
  }

  // ─────────────────────────────── v2 rows: palette / perk / permit / best ───────────────────────────────

  private palUnlocked(t: TitanId, i: number): boolean {
    if (i === 0) return true;
    const P = this.profile;
    return !!P && paletteUnlocked(P, t, i);
  }

  private perkChoice(): PerkId | null {
    const perk = PERK_VALUES[this.perkIx] ?? null;
    if (!perk) return null;
    return this.profile && perkUnlocked(this.profile, perk) ? perk : null;
  }

  private setPalette(i: number): void {
    const t = TITAN_IDS[this.ti];
    if (this.pal[t] === i) return;
    this.pal[t] = i;
    this.renderPalette();
    this.swapPortrait(t);
    const s = this.palSwatches[i];
    if (s) pulse(s, [{ transform: 'translateY(-12%) scale(1.08)' }, { transform: 'none' }], 200);
  }

  /** swap the focused titan's portrait for its palette (canonical when locked); stale replies are dropped */
  private swapPortrait(t: TitanId): void {
    const i = TITAN_IDS.indexOf(t);
    const img = this.titanImgs[i];
    if (!img) return;
    const pal = this.palUnlocked(t, this.pal[t]) ? this.pal[t] : 0;
    const req = (this.portraitReq[t] = (this.portraitReq[t] ?? 0) + 1);
    if (pal === 0 || !this.portraitFor) { img.src = this.portraits[t] || img.src; return; }
    this.portraitFor(t, pal).then((url) => {
      if (req !== this.portraitReq[t] || !url) return;
      img.src = url;
    }).catch(() => { /* keep the current portrait */ });
  }

  private renderPalette(): void {
    const t = TITAN_IDS[this.ti];
    const def = TITANS[t];
    const cur = this.pal[t];
    this.palSwatches.forEach((b, i) => {
      clearEl(b);
      const pal = i === 0 ? null : TITAN_PALETTES[t][i - 1];
      const cols = pal ? [pal.primary, pal.secondary, pal.accent] : [def.colors.primary, def.colors.secondary, def.colors.accent];
      const chips = div('bt2-swatch-chips', b);
      for (const c of cols) { const ch = el('i', ''); ch.style.background = c; chips.appendChild(ch); }
      b.appendChild(el('span', 'bt2-swatch-name', pal ? pal.name : SCREENS.select.paletteCanon));
      const open = this.palUnlocked(t, i);
      b.classList.toggle('locked', !open);
      b.classList.toggle('on', i === cur);
      if (!open) div('bt2-lock', b);
    });
    if (!this.palUnlocked(t, cur)) {
      const g = goalUnlocking((u) => u.kind === 'palette' && u.titan === t && u.index === cur);
      this.palNote.textContent = fmt(SCREENS.select.lockedBy, { goal: g ? g.name : '?' });
      this.palNote.classList.add('locked');
    } else {
      this.palNote.textContent = '';
      this.palNote.classList.remove('locked');
    }
  }

  private changePerk(d: number): void {
    this.perkIx = wrapIndex(this.perkIx + d, PERK_VALUES.length);
    this.renderPerk();
    pulse(this.perkVal, [{ transform: `translateX(${d * 6}%)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], 160);
  }

  private renderPerk(): void {
    const V = this.perkVal;
    clearEl(V);
    const perk = PERK_VALUES[this.perkIx] ?? null;
    const gl = div('bt2-perkval-glyph', V);
    const tx = div('bt2-perkval-txt', V);
    if (!perk) {
      gl.innerHTML = glyphSvg('key', 'rgba(244,236,216,.5)', 22);
      tx.appendChild(el('b', '', SCREENS.select.perkNone));
      tx.appendChild(el('span', '', SCREENS.select.perkNoneDesc));
      V.classList.remove('locked');
    } else {
      const def = PERKS_DEF[perk];
      const open = !!this.profile && perkUnlocked(this.profile, perk);
      gl.innerHTML = glyphSvg(open ? 'key' : 'lock', '#ffd166', 22);
      tx.appendChild(el('b', '', def ? def.name : perk));
      if (open) tx.appendChild(el('span', '', def ? def.desc : ''));
      else {
        const g = goalUnlocking((u) => u.kind === 'perk' && u.id === perk);
        tx.appendChild(el('span', 'lk', fmt(SCREENS.select.lockedBy, { goal: g ? g.name : '?' })));
      }
      V.classList.toggle('locked', !open);
    }
    V.appendChild(el('small', 'bt2-perkval-n', `${this.perkIx + 1} / ${PERK_VALUES.length}`));
  }

  private refreshPermit(): void {
    if (!this.profile) { this.permit.show(false); return; }
    this.permit.show(true);
    this.permit.set(this.profile, TITAN_IDS[this.ti], this.step === 2 ? BIOME_IDS[this.bi] : null);
  }

  /** YOUR BEST ON FILE: LV n · SIZE r · m:ss over the given titan × biome pairs (bests handed in by the app). */
  private bestLine(titans: readonly TitanId[], biomes: readonly BiomeId[]): string {
    const B = this.bests;
    let lv = -1, rank = -1, clear = Infinity, air = -1;
    for (const t of titans) for (const b of biomes) {
      const l = B[bestKey(t, b, 'level')], r = B[bestKey(t, b, 'peakRank')], c = B[bestKey(t, b, 'clearS')], s = B[bestKey(t, b, 'survivedS')];
      if (l !== undefined) lv = Math.max(lv, l);
      if (r !== undefined) rank = Math.max(rank, r);
      if (c !== undefined) clear = Math.min(clear, c);
      if (s !== undefined) air = Math.max(air, s);
    }
    if (lv < 0 && rank < 0) return STR.select.recordNone;
    const time = Number.isFinite(clear) ? clear : Math.max(0, air);
    return fmt(SCREENS.select.bestOnFile, { lv: lv >= 0 ? fmtInt(lv) : '—', size: rank >= 0 ? roman(rank) : '—', time: fmtTime(time) });
  }

  /** DESK RECORD for a zone (every titan): the band's left on step 2 (the pre-v2 lore footer, relocated). */
  private renderDeskRecord(b: BiomeId): void {
    const f = this.deskRec;
    clearEl(f);
    const B = this.bests;
    let tons = -1, rank = -1, clear = Infinity;
    for (const t of TITAN_IDS) {
      const tn = B[bestKey(t, b, 'tonnage')], rk = B[bestKey(t, b, 'peakRank')], cs = B[bestKey(t, b, 'clearS')];
      if (tn !== undefined) tons = Math.max(tons, tn);
      if (rk !== undefined) rank = Math.max(rank, rk);
      if (cs !== undefined) clear = Math.min(clear, cs);
    }
    f.appendChild(el('span', 'bt-kit-tag', STR.select.record));
    if (tons < 0 && rank < 0) { f.appendChild(el('span', 'bt-lore-rec-none', STR.select.recordNone)); return; }
    const cell = (k: string, v: string) => {
      const c = div('bt-lore-rec-cell', f);
      c.appendChild(el('small', '', k));
      c.appendChild(el('b', '', v));
    };
    cell(STR.select.recTons, tons >= 0 ? `${fmtInt(tons)} T` : '—');
    cell(STR.select.recSize, rank >= 0 ? roman(rank) : '—');
    cell(STR.select.recClear, Number.isFinite(clear) ? fmtTime(clear) : '—');
  }

  /** The dossier column is overflow-hidden: drop flavour lines (last first, keep one) until the kit fits. */
  private fitLore(): void {
    const L = this.lore;
    if (L.clientHeight <= 0) return;
    const ul = L.querySelector('.bt-lore-lines');
    while (L.scrollHeight > L.clientHeight + 1 && ul && ul.children.length > 1) ul.lastElementChild!.remove();
    if (L.scrollHeight > L.clientHeight + 1) {
      const tag = L.querySelector('.bt-lore-tagline');
      if (tag) tag.remove();
    }
  }

  private refreshBiomeBests(): void {
    const t = TITAN_IDS[this.ti];
    BIOME_IDS.forEach((b, i) => { const e = this.biomeBest[i]; if (e) e.textContent = this.bestLine([t], [b]); });
  }

  // ─────────────────────────────── titans ───────────────────────────────

  private buildTitanCards(portraits: Record<TitanId, string>): void {
    clearEl(this.titanRow);
    this.titanCards = [];
    this.titanImgs = [];
    this.titanBest = [];
    TITAN_IDS.forEach((id, i) => {
      const def = TITANS[id];
      const c = el('button', `bt-tcard t-${id}`);
      c.type = 'button';
      c.tabIndex = -1;
      c.setAttribute('role', 'option');
      c.style.setProperty('--c1', def.colors.primary);
      c.style.setProperty('--c2', def.colors.secondary);
      c.style.setProperty('--c3', def.colors.accent);
      c.style.setProperty('--glow', def.colors.glow);
      div('bt-tcard-bg', c);
      div('bt-tcard-rays', c);
      const src = portraits[id];
      if (src) {
        const img = el('img', 'bt-tcard-img');
        img.alt = def.name;
        img.src = src;
        img.draggable = false;
        c.appendChild(img);
        this.titanImgs.push(img);
      } else {
        const np = div('bt-tcard-nophoto', c);
        np.appendChild(el('span', '', STR.select.noPortrait));
        this.titanImgs.push(null);
      }
      div('bt-tcard-num', c, String(i + 1).padStart(2, '0'));
      const plate = div('bt-tcard-plate', c);
      plate.appendChild(el('b', '', def.name));
      plate.appendChild(el('span', '', def.role));
      const pips = div('bt-pips3', plate);
      for (let k = 1; k <= 3; k++) div(k <= def.difficulty ? 'on' : '', pips);
      // v2 YOUR BEST ON FILE (shown on the focused card only): this titan over every zone
      this.titanBest.push(div('bt2-best', plate, this.bestLine([id], BIOME_IDS)));
      div('bt-tcard-tag', c, STR.select.selected);
      onTap(c, () => {
        if (this.step !== 1) return;
        this.focusRow('cards');
        if (this.ti === i) this.confirm(); else this.selectTitan(i);
      });
      this.titanRow.appendChild(c);
      this.titanCards.push(c);
    });
  }

  private selectTitan(i: number): void {
    const changed = i !== this.ti || !this.lore.dataset.for || this.lore.dataset.for !== 't:' + TITAN_IDS[i];
    this.ti = i;
    this.titanCards.forEach((c, j) => {
      c.classList.toggle('is-sel', j === i);
      c.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (changed) this.renderTitanLore(TITANS[TITAN_IDS[i]], i);
    this.renderPalette();
    if (this.step === 1) this.refreshPermit();
  }

  private renderTitanLore(def: TitanDef, i: number): void {
    const L = this.lore;
    clearEl(L);
    L.dataset.for = 't:' + def.id;
    L.style.setProperty('--c1', def.colors.primary);
    L.style.setProperty('--c2', def.colors.secondary);
    L.style.setProperty('--glow', def.colors.glow);
    const k = div('bt-lore-kicker', L);
    k.appendChild(el('span', '', STR.select.file));
    k.appendChild(el('b', '', `${String(i + 1).padStart(2, '0')} / ${String(TITAN_IDS.length).padStart(2, '0')}`));
    div('bt-lore-name', L, def.name);
    div('bt-lore-species', L, def.species);
    const meta = div('bt-lore-meta', L);
    meta.appendChild(el('span', 'bt-lore-role', def.role));
    const diff = div('bt-lore-diff', meta);
    diff.appendChild(el('small', '', STR.select.handling));
    const pips = div('bt-pips3', diff);
    for (let d = 1; d <= 3; d++) div(d <= def.difficulty ? 'on' : '', pips);
    diff.appendChild(el('span', '', STR.select.difficulty[def.difficulty] ?? ''));
    div('bt-lore-tagline', L, `“${def.tagline}”`);
    const ul = el('ul', 'bt-lore-lines');
    for (const line of def.lore.slice(0, 3)) ul.appendChild(el('li', '', line));
    L.appendChild(ul);
    this.vitals(L, def);
    const kit = div('bt-lore-kit', L);
    const row = (tag: string, name: string, desc: string, key?: string) => {
      const r = div('bt-kit-row', kit);
      const h = div('bt-kit-head', r);
      h.appendChild(el('span', 'bt-kit-tag', tag));
      h.appendChild(el('b', 'bt-kit-name', name));
      if (key) h.appendChild(keyChip(key));
      div('bt-kit-desc', r, desc);
    };
    row(STR.select.auto, def.auto.name, def.auto.desc);
    row(STR.select.hook, def.hook.name, def.hook.desc, STR.hud.keyHook);
    row(STR.select.dash, def.dash.name, def.dash.desc, STR.hud.keyDash);
    this.fitLore();
    pulse(L, [{ opacity: 0.2, transform: 'translateX(2%)' }, { opacity: 1, transform: 'none' }], 200);
  }

  // ─────────────────────────────── biomes ───────────────────────────────

  private buildBiomeCards(): void {
    clearEl(this.biomeRow);
    this.biomeCards = [];
    this.biomeBest = [];
    BIOME_IDS.forEach((id, i) => {
      const def = BIOMES[id];
      const c = el('button', `bt-bcard b-${id}`);
      c.type = 'button';
      c.tabIndex = -1;
      c.setAttribute('role', 'option');
      paintBiomeVars(c, def);
      const art = div('bt-bcard-art', c);
      paintSkyline(art, def, 1000 + i * 77);
      div('bt-bcard-num', c, String(i + 1).padStart(2, '0'));
      const plate = div('bt-bcard-plate', c);
      plate.appendChild(el('b', '', def.name));
      plate.appendChild(el('span', '', def.subtitle.toUpperCase()));
      const meta = div('bt-bcard-meta', plate);
      meta.appendChild(el('span', '', STR.select.time[def.time] ?? def.time.toUpperCase()));
      meta.appendChild(el('span', '', STR.select.weather[def.weather] ?? def.weather.toUpperCase()));
      this.biomeBest.push(div('bt2-best', plate));
      div('bt-tcard-tag', c, STR.select.selected);
      onTap(c, () => {
        if (this.step !== 2) return;
        this.focusRow('cards');
        if (this.bi === i) this.confirm(); else this.selectBiome(i);
      });
      this.biomeRow.appendChild(c);
      this.biomeCards.push(c);
    });
  }

  private selectBiome(i: number): void {
    const changed = i !== this.bi || this.lore.dataset.for !== 'b:' + BIOME_IDS[i];
    this.bi = i;
    this.biomeCards.forEach((c, j) => {
      c.classList.toggle('is-sel', j === i);
      c.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    if (changed) { this.renderBiomeLore(BIOMES[BIOME_IDS[i]], i); this.renderDeskRecord(BIOME_IDS[i]); }
    if (this.step === 2) this.refreshPermit();
  }

  private renderBiomeLore(def: BiomeDef, i: number): void {
    const L = this.lore;
    clearEl(L);
    L.dataset.for = 'b:' + def.id;
    L.style.setProperty('--c1', def.palette.sign);
    L.style.setProperty('--c2', def.palette.road);
    L.style.setProperty('--glow', def.palette.signB);
    const k = div('bt-lore-kicker', L);
    k.appendChild(el('span', '', STR.select.zone));
    k.appendChild(el('b', '', `${String(i + 1).padStart(2, '0')} / ${String(BIOME_IDS.length).padStart(2, '0')}`));
    div('bt-lore-name', L, def.name);
    div('bt-lore-species', L, def.subtitle);
    const meta = div('bt-lore-meta', L);
    meta.appendChild(el('span', 'bt-lore-role', `${STR.select.time[def.time] ?? def.time} · ${STR.select.weather[def.weather] ?? def.weather}`));
    meta.appendChild(el('span', 'bt-lore-blocks', fmt(STR.select.blocks, { x: def.blocks[0], z: def.blocks[1] })));
    div('bt-lore-tagline', L, def.slate);
    const ul = el('ul', 'bt-lore-lines');
    for (const line of def.lore.slice(0, 3)) ul.appendChild(el('li', '', line));
    L.appendChild(ul);
    // HALVARD response profile: the director's per-zone enemy weights (BiomeDef.enemyBias)
    const resp = div('bt-lore-resp', L);
    const rh = div('bt-lore-resp-head', resp);
    rh.appendChild(el('span', 'bt-kit-tag', STR.select.response));
    rh.appendChild(el('small', '', STR.select.responseSub));
    const grid = div('bt-lore-resp-grid', resp);
    for (const k of RESPONSE_KINDS) {
      const bias = def.enemyBias[k] ?? 1;
      const lvl = Math.max(1, Math.min(5, Math.round(bias * 3)));
      const r = div(`bt-resp-row${bias >= 1.3 ? ' heavy' : bias <= 0.8 ? ' light' : ''}`, grid);
      r.appendChild(el('span', 'nm', ENEMIES[k] ? ENEMIES[k].name : k.toUpperCase()));
      const m = div('bt-resp-meter', r);
      for (let i = 1; i <= 5; i++) div(i <= lvl ? 'on' : '', m);
    }
    const boss = BOSSES[def.boss];
    const kit = div('bt-lore-kit', L);
    const r = div('bt-kit-row boss', kit);
    const h = div('bt-kit-head', r);
    h.appendChild(el('span', 'bt-kit-tag', STR.select.containment));
    h.appendChild(el('b', 'bt-kit-name', boss ? boss.name : def.boss.toUpperCase()));
    div('bt-kit-desc', r, boss ? `${boss.title}. ${STR.select.meterHint} ${boss.meterName}.` : '');
    if (boss && boss.attacks.length) {
      const pr = div('bt-lore-procs', r);
      for (const ph of [1, 2, 3] as const) {
        const names = boss.attacks.filter((a) => a.phase === ph).map((a) => a.name);
        if (!names.length) continue;
        const line = div('bt-lore-proc', pr);
        line.appendChild(el('b', '', fmt(STR.select.phase, { n: ph })));
        line.appendChild(el('span', '', names.join(' · ')));
      }
    }
    const c = div('bt-kit-row', kit);
    const ch = div('bt-kit-head', c);
    ch.appendChild(el('span', 'bt-kit-tag', STR.select.conditions));
    ch.appendChild(el('b', 'bt-kit-name', STR.select.zoneNote[def.id] ?? ''));
    this.fitLore();
    pulse(L, [{ opacity: 0.2, transform: 'translateX(2%)' }, { opacity: 1, transform: 'none' }], 200);
  }

  /** VITALS: the four base stats that actually differ between titans, as 5-step meters scaled
   *  across the roster (TitanDef.base), each with its real figure. */
  private vitals(L: HTMLElement, def: TitanDef): void {
    const all = TITAN_IDS.map((id) => TITANS[id].base);
    const rows: [string, (b: TitanDef['base']) => number, (b: TitanDef['base']) => string][] = [
      [STR.select.vHull, (b) => b.maxHp, (b) => fmtInt(b.maxHp)],
      [STR.select.vPlate, (b) => b.armor, (b) => fmtInt(b.armor)],
      [STR.select.vStride, (b) => b.moveSpeed, (b) => `${b.moveSpeed.toFixed(2)}×`],
      // dash readiness = charges per recharge second (the HUD's recharge is 3 s × max(.35, dashCooldown))
      [STR.select.vDash, (b) => b.dashCharges / Math.max(0.35, b.dashCooldown), (b) => `${b.dashCharges} / ${(3 * Math.max(0.35, b.dashCooldown)).toFixed(1)}s`],
    ];
    const box = div('bt-lore-vitals', L);
    const head = div('bt-lore-resp-head', box);
    head.appendChild(el('span', 'bt-kit-tag', STR.select.vitals));
    head.appendChild(el('small', '', STR.select.vitalsSub));
    const grid = div('bt-lore-resp-grid', box);
    for (const [label, get, show] of rows) {
      const vals = all.map(get);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const lvl = hi > lo ? 1 + Math.round(4 * (get(def.base) - lo) / (hi - lo)) : 3;
      const r = div('bt-resp-row', grid);
      const nm = el('span', 'nm', label);
      nm.appendChild(el('i', '', show(def.base)));
      r.appendChild(nm);
      const m = div('bt-resp-meter', r);
      for (let i = 1; i <= 5; i++) div(i <= lvl ? 'on' : '', m);
    }
  }
}


// ─────────────────────────────── CSS-painted biome art ───────────────────────────────

function paintBiomeVars(c: HTMLElement, b: BiomeDef): void {
  const P = b.palette;
  const set = (k: string, v: string) => c.style.setProperty(k, v);
  set('--sky', P.sky); set('--sky2', P.skyHorizon); set('--road', P.road); set('--line', P.roadLine);
  set('--walk', P.sidewalk); set('--a', P.bodyA); set('--b', P.bodyB); set('--c', P.bodyC);
  set('--trim', P.trimA); set('--roof', P.roofA); set('--glass', P.glass); set('--lit', P.glassLit);
  set('--sign', P.sign); set('--signB', P.signB); set('--leaf', P.foliage); set('--leaf2', P.foliageB);
  set('--water', P.water); set('--sun', P.sun);
}

/** Diorama-style mini skyline: far silhouettes, painted near blocks with windows, a street with a
 *  zebra crossing; per-biome extras (blossom trees, tanks + dish + snow, containers + neon + rain). */
function paintSkyline(art: HTMLElement, b: BiomeDef, seed: number): void {
  const r = cosmeticRng(seed);
  div('bt-ba-sky', art);
  div('bt-ba-orb', art);
  const far = div('bt-ba-far', art);
  for (let i = 0; i < 16; i++) {
    const s = div('bt-ba-fb', far);
    s.style.height = `${(25 + r() * 60).toFixed(0)}%`;
    s.style.flexGrow = (0.5 + r()).toFixed(2);
  }
  const near = div('bt-ba-near', art);
  const bodies = ['var(--a)', 'var(--b)', 'var(--c)'];
  const n = b.id === 'grideast' ? 7 : 6;
  for (let i = 0; i < n; i++) {
    let kind = 'box';
    if (b.id === 'whitestacks') kind = i === 1 || i === 4 ? 'tank' : i === 2 ? 'stack' : 'shed';
    if (b.id === 'lockwater') kind = i % 3 === 1 ? 'crane' : 'cont';
    const d = div(`bt-ba-nb k-${kind}`, near);
    const h = kind === 'box' ? 30 + r() * 55 : kind === 'tank' ? 28 + r() * 10 : kind === 'stack' ? 70 : kind === 'crane' ? 78 : kind === 'cont' ? 14 + Math.floor(r() * 3) * 10 : 22 + r() * 12;
    d.style.height = `${h.toFixed(0)}%`;
    d.style.flexGrow = (kind === 'stack' ? 0.35 : kind === 'crane' ? 0.8 : 0.7 + r() * 0.9).toFixed(2);
    d.style.setProperty('--body', bodies[Math.floor(r() * 3)]);
    if (kind === 'box' || kind === 'shed') div('bt-ba-win', d);
    if (kind === 'box' && r() > 0.45) div('bt-ba-sign', d);
    if (kind === 'cont') { for (let k = 0; k < 3; k++) div('bt-ba-crate', d); }
  }
  if (b.id === 'whitestacks') div('bt-ba-dish', art);
  if (b.id === 'grideast') {
    const trees = div('bt-ba-trees', art);
    for (let i = 0; i < 5; i++) div('bt-ba-tree', trees);
  }
  const street = div('bt-ba-street', art);
  div('bt-ba-zebra', street);
  div('bt-ba-dash', street);
  if (b.weather === 'snow') div('bt-ba-snow', art);
  if (b.weather === 'rain') div('bt-ba-rain', art);
  if (b.time === 'night') div('bt-ba-glow', art);
}

function clampPal(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(2, Math.round(v))) : 0;
}
