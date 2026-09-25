// BLOCKTOOTH — two-step select (CONTRACT.md §12). ui lane.
//   STEP 1 TITAN   four portrait cards (live portraits from titans/portraits.ts, passed in as data
//                  URLs) + SUBJECT FILE lore column (name, species, role, tagline, lore, AUTO / HOOK /
//                  DASH with names + descs, difficulty pips) + confirm bar.
//   STEP 2 BIOME   three cards with CSS-painted mini skylines in each biome's palette + ZONE FILE
//                  lore column + confirm bar "DROP IN".
// ←/→ (A/D, stick, d-pad) choose · ENTER / SPACE / pad A confirm · ESC / pad B back a step
// (step 1 → resolves null) · click a card to choose it, click it again (or the bar) to confirm.

import type { Input } from '../core/input.ts';
import type { BiomeDef, BiomeId, EnemyKind, TitanDef, TitanId } from '../core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../core/types.ts';
import type { SelectResultV2, SelectRunOpts } from '../v2types.ts';
import { bestKey, loadBest } from '../core/save.ts';
import { TITANS } from '../data/titans.ts';
import { BIOMES } from '../data/biomes.ts';
import { BOSSES } from '../data/bosses.ts';
import { ENEMIES } from '../data/enemies.ts';
import { STR } from '../data/strings.ts';
import {
  type ModalSession, type UiPress, clearEl, cosmeticRng, div, el, fmt, fmtInt, fmtTime, keyChip, onTap, pulse, roman, runModal, wrapIndex,
  flashesReduced,
} from './dom.ts';
import { buildBug, wallClock } from './menus.ts';

type SelectResult = { titan: TitanId; biome: BiomeId } | null;
type Step = 1 | 2;

/** The regular HALVARD roster in escalation order (the elite RAMROD is announced separately). */
const RESPONSE_KINDS: readonly EnemyKind[] = ['android', 'squad', 'drone', 'buggy', 'apc', 'tank', 'walker'];

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
  private readonly confirmBtn: HTMLButtonElement;
  private readonly confirmLbl: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  private titanCards: HTMLElement[] = [];
  private biomeCards: HTMLElement[] = [];
  private step: Step = 1;
  private ti = 0;
  private bi = 0;
  private session: ModalSession<SelectResult> | null = null;
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
    this.lore = div('bt-lore', body);

    const bar = div('bt-sel-bar bt-confirmbar', L);
    const hints = div('bt-hints', bar);
    hints.appendChild(keyChip('← →'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.select.choose));
    hints.appendChild(el('span', 'bt-hint-gap'));
    hints.appendChild(keyChip('ENTER'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.select.confirm));
    hints.appendChild(el('span', 'bt-hint-gap'));
    hints.appendChild(keyChip('ESC'));
    hints.appendChild(el('span', 'bt-hint-txt', STR.select.back));
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

  /** v2 signature (SelectScreenApi, FEATURES_V2 §13.1). L0: today's behaviour — only `portraits` and
   *  `initial.titan/biome` are read; resolves {kind: 'start', titan, biome, perk: null, palette: 0} or null,
   *  never {kind: 'goals'} (lane L9 adds the palette/perk rows, NEXT PERMIT PENDING and G / pad X). */
  run(opts: SelectRunOpts): Promise<SelectResultV2> {
    return this.runV1(opts.portraits, opts.initial).then((r): SelectResultV2 => (
      r ? { kind: 'start', titan: r.titan, biome: r.biome, perk: null, palette: 0 } : null));
  }

  private runV1(portraits: Record<TitanId, string>, initial?: { titan?: TitanId; biome?: BiomeId }): Promise<SelectResult> {
    if (this.session && !this.session.done) this.session.abort();
    this.buildTitanCards(portraits || ({} as Record<TitanId, string>));
    const from = this.resume ?? initial;
    this.resume = null;
    this.ti = Math.max(0, TITAN_IDS.indexOf(from?.titan ?? TITAN_IDS[0]));
    this.bi = Math.max(0, BIOME_IDS.indexOf(from?.biome ?? BIOME_IDS[0]));
    this.clock.textContent = wallClock();
    this.layer.classList.remove('bt-hidden');
    this.setStep(1, false);
    pulse(this.layer, [{ opacity: 0 }, { opacity: 1 }], 220);
    const { promise, session } = runModal<SelectResult>(this.layer, this.input, (p) => this.onPress(p), {
      armMs: 250,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  // ─────────────────────────────── input ───────────────────────────────

  private onPress(p: UiPress): void {
    switch (p.act) {
      case 'left': case 'up': this.move(-1); break;
      case 'right': case 'down': this.move(1); break;
      case 'confirm': case 'alt': this.confirm(); break;
      case 'back': this.back(); break;
      case 'pick1': this.jump(0); break;
      case 'pick2': this.jump(1); break;
      case 'pick3': this.jump(2); break;
      default: break;
    }
  }

  private move(d: number): void {
    if (this.step === 1) this.selectTitan(wrapIndex(this.ti + d, TITAN_IDS.length));
    else this.selectBiome(wrapIndex(this.bi + d, BIOME_IDS.length));
  }

  private jump(i: number): void {
    if (this.step === 1 && i < TITAN_IDS.length) this.selectTitan(i);
    else if (this.step === 2 && i < BIOME_IDS.length) this.selectBiome(i);
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
    s.finish({ titan: TITAN_IDS[this.ti], biome: BIOME_IDS[this.bi] }, flashesReduced() ? 80 : 280);
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
    this.tab1.classList.toggle('on', step === 1);
    this.tab2.classList.toggle('on', step === 2);
    this.tab1.classList.toggle('done', step === 2);
    this.stepLine.textContent = step === 1 ? STR.select.step1 : STR.select.step2;
    this.confirmLbl.textContent = step === 1 ? STR.select.confirm : STR.select.dropIn;
    this.titanRow.classList.toggle('bt-hidden', step !== 1);
    this.biomeRow.classList.toggle('bt-hidden', step !== 2);
    if (step === 1) this.selectTitan(this.ti); else this.selectBiome(this.bi);
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

  // ─────────────────────────────── titans ───────────────────────────────

  private buildTitanCards(portraits: Record<TitanId, string>): void {
    clearEl(this.titanRow);
    this.titanCards = [];
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
      } else {
        const np = div('bt-tcard-nophoto', c);
        np.appendChild(el('span', '', STR.select.noPortrait));
      }
      div('bt-tcard-num', c, String(i + 1).padStart(2, '0'));
      const plate = div('bt-tcard-plate', c);
      plate.appendChild(el('b', '', def.name));
      plate.appendChild(el('span', '', def.role));
      const pips = div('bt-pips3', plate);
      for (let k = 1; k <= 3; k++) div(k <= def.difficulty ? 'on' : '', pips);
      div('bt-tcard-tag', c, STR.select.selected);
      onTap(c, () => {
        if (this.step !== 1) return;
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
    this.recordFooter(L, TITAN_IDS.map(() => def.id), BIOME_IDS.slice());
    pulse(L, [{ opacity: 0.2, transform: 'translateX(2%)' }, { opacity: 1, transform: 'none' }], 200);
  }

  // ─────────────────────────────── biomes ───────────────────────────────

  private buildBiomeCards(): void {
    clearEl(this.biomeRow);
    this.biomeCards = [];
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
      div('bt-tcard-tag', c, STR.select.selected);
      onTap(c, () => {
        if (this.step !== 2) return;
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
    if (changed) this.renderBiomeLore(BIOMES[BIOME_IDS[i]], i);
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
    this.recordFooter(L, TITAN_IDS.slice(), BIOME_IDS.map(() => def.id));
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

  /**
   * DESK RECORD footer: the personal bests (core/save.ts, written by the app at every run end)
   * over the given titan × biome pairs — a titan's file spans every zone, a zone's file every
   * titan. Pinned to the foot of the dossier; hidden again if it would not fit.
   */
  private recordFooter(L: HTMLElement, titans: readonly TitanId[], biomes: readonly BiomeId[]): void {
    const best = loadBest();
    let tons = -1, rank = -1, clear = Infinity;
    const pairs = new Set<string>();
    for (const t of titans) for (const b of biomes) pairs.add(t + '|' + b);
    for (const pr of pairs) {
      const [t, b] = pr.split('|');
      const tn = best[bestKey(t, b, 'tonnage')], rk = best[bestKey(t, b, 'peakRank')], cs = best[bestKey(t, b, 'clearS')];
      if (tn !== undefined) tons = Math.max(tons, tn);
      if (rk !== undefined) rank = Math.max(rank, rk);
      if (cs !== undefined) clear = Math.min(clear, cs);
    }
    const f = div('bt-lore-rec', L);
    f.appendChild(el('span', 'bt-kit-tag', STR.select.record));
    if (tons < 0 && rank < 0) {
      f.appendChild(el('span', 'bt-lore-rec-none', STR.select.recordNone));
    } else {
      const cell = (k: string, v: string) => {
        const c = div('bt-lore-rec-cell', f);
        c.appendChild(el('small', '', k));
        c.appendChild(el('b', '', v));
      };
      cell(STR.select.recTons, tons >= 0 ? `${fmtInt(tons)} T` : '—');
      cell(STR.select.recSize, rank >= 0 ? roman(rank) : '—');
      cell(STR.select.recClear, Number.isFinite(clear) ? fmtTime(clear) : '—');
    }
    // never let the footer push dossier text out of the (overflow: hidden) column
    if (L.scrollHeight > L.clientHeight + 1) f.remove();
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
