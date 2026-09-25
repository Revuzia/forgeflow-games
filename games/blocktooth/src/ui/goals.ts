// BLOCKTOOTH v2 — GOALS & RECORDS screen + the NEXT PERMIT PENDING slip (FEATURES_V2 §8.4). UI.
// Lane L9 (SCREENS).
//
//   GoalsScreen      a full-screen manila case binder in the WARD-7 package style. Index tabs across the
//                    top (GENERAL · MOLO · VOLT-KITE · HEARTHBACK · BRIARWICK · CITIES · RECORDS), one row
//                    per goal (glyph · name · condition · progress bar x / y · unlock chip), done rows
//                    rubber-stamped FILED with the date; RECORDS = the 4 × 3 titan × zone table of bests.
//                    ←/→ tabs · ↑/↓ rows · Esc / pad B back · mouse wheel scrolls · tabs clickable.
//   NextUnlockPanel  the tilted manila permit slip clipped to the select screen's lore column: the unlock's
//                    glyph and name, the goal in small caps, a progress bar, and a PENDING / ISSUED stamp.
//
// Reads only the Profile + bests it is handed (the app owns loading and saving). Imports ./screens_v2.css,
// which also styles the v2 parts of select / draft / pause / tabloid (all L9).

import type { BiomeId, GoalDef, GoalMetric, Profile, TitanId, UnlockRef } from '../core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../core/types.ts';
import type { Input } from '../core/input.ts';
import type { GlyphId, GoalsScreenApi, NextUnlockPanelApi } from '../v2types.ts';
import { bestKey } from '../core/save.ts';
import { GOALS } from '../data/goals.ts';
import { PERKS_DEF } from '../data/perks.ts';
import { TITAN_PALETTES } from '../data/palettes.ts';
import { TITANS } from '../data/titans.ts';
import { BIOMES } from '../data/biomes.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { SCREENS } from '../data/strings_screens.ts';
import { goalFrac, goalParts, goalProgress, nextUnlock, unlockLabel } from '../meta/goals.ts';
import { SLOT_BG, barFill, glyphSvg, iconFor } from './icons.ts';
import {
  type ModalSession, type UiPress, clearEl, div, el, fmt, fmtInt, fmtTime, keyChip, onTap, pulse, roman, runModal, wrapIndex,
} from './dom.ts';
import { buildBug, wallClock } from './menus.ts';
import './screens_v2.css';

// ─────────────────────────────── shared helpers (select / draft / pause use them too) ───────────────────────────────

/** A goal's row glyph, by what it measures. */
const METRIC_GLYPH: Record<GoalMetric, GlyphId> = {
  runsFinished: 'notice', peakRank: 'arrowUp', clears: 'ribbon', biomesCleared: 'ribbon', kills: 'claw',
  cleanClear: 'heart', ults: 'megaphone', banishesLife: 'banish', blocks: 'wreck', endlessS: 'hourglass',
  bossesInRun: 'burst', evolutionsLife: 'evo', powerups: 'coin', objectives: 'annex', vacuumBest: 'vortex',
  crushed: 'foot', titanClears: 'ribbon', titanBiomesCleared: 'ribbon', wiresBest: 'wire', hookKillsBest: 'hook',
  fullVents: 'dome', bloomsBest: 'turret', healed: 'bandage', props: 'chunk', overloadSites: 'overload',
  tier4CollapseFrac: 'wreck', bossKillsLife: 'bullseye', staggersBestFight: 'ripple', boats: 'ripple', fastClearS: 'rush',
};

export function goalGlyph(g: GoalDef): GlyphId { return METRIC_GLYPH[g.metric] ?? 'ribbon'; }

/** The glyph (as inline SVG) of an unlock: the card's own glyph, the perk keycard, or palette swatches. */
export function unlockGlyphEl(u: UnlockRef, cls = ''): HTMLElement {
  const box = el('span', `bt2-glyph${cls ? ' ' + cls : ''}`);
  if (u.kind === 'palette') {
    box.classList.add('swatch');
    const pal = TITAN_PALETTES[u.titan] ? TITAN_PALETTES[u.titan][u.index - 1] : undefined;
    for (const c of pal ? [pal.primary, pal.secondary, pal.accent] : ['#888', '#666', '#aaa']) {
      const chip = el('i', '');
      chip.style.background = c;
      box.appendChild(chip);
    }
    return box;
  }
  // F4 (critic: dark-on-dark glyphs): the card / perk glyphs are ink-stroked, and on the navy box their
  // 2 px ink outline vanished and the thinner shapes (claw, ripple, links) read as dark smudges. The
  // unlock chip is now the ability-bar slot face (cream) with the bar's contrast-checked fill.
  box.style.background = SLOT_BG;
  if (u.kind === 'perk') { box.innerHTML = glyphSvg('key', '#d9901a'); return box; }
  const d = UPGRADE_BY_ID[u.id];
  box.innerHTML = d ? glyphSvg(iconFor(d), barFill(d)) : glyphSvg('star', '#d9901a');
  if (d && d.evo) box.classList.add('evo');
  return box;
}

/** "CARD" / "RESTRUCTURE" / "PERK" / "COLOURWAY". */
export function unlockKind(u: UnlockRef): string {
  const P = SCREENS.permit;
  if (u.kind === 'perk') return P.kindPerk;
  if (u.kind === 'palette') return P.kindPalette;
  const d = UPGRADE_BY_ID[u.id];
  return d && d.evo ? P.kindEvo : P.kindCard;
}

/** "x / y" progress text + fraction for a goal (lower-is-better goals show best vs limit). */
export function goalProgressText(g: GoalDef, p: Profile): { text: string; frac: number } {
  const v = goalProgress(g, p, null, null);
  const frac = goalFrac(g, v);
  if (g.lowerIsBetter) {
    return { text: fmt(SCREENS.goals.lower, { x: v > 0 ? fmtTime(v) : SCREENS.goals.none, y: fmtTime(g.target) }), frac };
  }
  if (g.metric === 'peakRank') {   // a Size: roman numerals, 1-based (rank 0 = SIZE I)
    const r = Math.max(0, Math.min(g.target, Math.floor(v)));
    return { text: `${roman(r)} / ${roman(g.target)}`, frac };
  }
  const { x, y } = goalParts(g, p, null, null);
  const show = (n: number) => (g.metric === 'tier4CollapseFrac' ? `${fmtInt(n)}%` : fmtInt(n));
  return { text: `${show(Math.min(x, y))} / ${show(y)}`, frac };
}

/** The goal that unlocks a given perk / palette / card id (for the select screen's padlock lines). */
export function goalUnlocking(match: (u: UnlockRef) => boolean): GoalDef | null {
  for (const g of GOALS) for (const u of g.unlocks) if (match(u)) return g;
  return null;
}

function filedDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  return `${String(d.getDate()).padStart(2, '0')} ${m} ${d.getFullYear()}`;
}

function bar(parent: HTMLElement, frac: number, cls = ''): HTMLElement {
  const b = div(`bt2-bar${cls ? ' ' + cls : ''}`, parent);
  const f = div('bt2-bar-fill', b);
  f.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(4)})`;
  return b;
}

// ─────────────────────────────── GOALS & RECORDS ───────────────────────────────

type TabId = 'general' | TitanId | 'cities' | 'records';
const TABS: readonly TabId[] = ['general', 'molo', 'voltkite', 'hearthback', 'briarwick', 'cities', 'records'];

function goalsFor(tab: TabId): GoalDef[] {
  if (tab === 'general') return GOALS.filter((g) => g.group === 'general');
  if (tab === 'cities') return GOALS.filter((g) => g.group === 'city');
  if (tab === 'records') return [];
  return GOALS.filter((g) => g.group === 'titan' && g.titan === tab);
}

export class GoalsScreen implements GoalsScreenApi {
  private readonly input: Input;
  private readonly layer: HTMLDivElement;
  private readonly clock: HTMLElement;
  private readonly count: HTMLElement;
  private readonly tabEls: HTMLElement[] = [];
  private readonly list: HTMLDivElement;
  private rows: HTMLElement[] = [];
  private tab = 0;
  private row = 0;
  private p: Profile | null = null;
  private bests: Record<string, number> = {};
  private session: ModalSession<void> | null = null;

  constructor(root: HTMLElement, input: Input) {
    this.input = input;
    const L = this.layer = div('bt-layer bt-screen bt2-goals bt-hidden', root);
    L.setAttribute('role', 'dialog');
    L.setAttribute('aria-label', SCREENS.goals.title);
    L.dataset.v2 = 'goals';
    div('bt2-goals-desk', L);
    div('bt-halftone soft', L);

    const head = div('bt2-goals-head', L);
    const bug = buildBug(head, '');
    this.clock = bug.querySelector('.bt-clock') as HTMLElement;
    const ht = div('bt2-goals-htxt', head);
    div('bt2-goals-title', ht, SCREENS.goals.title);
    div('bt2-goals-sub', ht, SCREENS.goals.sub);
    this.count = div('bt2-goals-count', head);

    const binder = div('bt2-binder', L);
    const tabs = div('bt2-tabs', binder);
    tabs.setAttribute('role', 'tablist');
    TABS.forEach((id, i) => {
      const t = el('button', `bt2-tab t-${id}`);
      t.type = 'button';
      t.tabIndex = -1;
      t.setAttribute('role', 'tab');
      t.textContent = SCREENS.goals.tabs[id] ?? id.toUpperCase();
      if (id !== 'general' && id !== 'cities' && id !== 'records' && TITANS[id as TitanId]) {
        t.style.setProperty('--tc', TITANS[id as TitanId].colors.primary);
      }
      onTap(t, () => this.setTab(i));
      tabs.appendChild(t);
      this.tabEls.push(t);
    });
    const sheet = div('bt2-sheet', binder);
    div('bt2-sheet-holes', sheet);
    this.list = div('bt2-list', sheet);
    this.list.setAttribute('role', 'list');

    const barEl = div('bt-confirmbar bt2-goals-bar', L);
    const hints = div('bt-hints', barEl);
    hints.appendChild(keyChip('← →'));
    hints.appendChild(el('span', 'bt-hint-txt', 'TABS'));
    hints.appendChild(el('span', 'bt-hint-gap'));
    hints.appendChild(keyChip('↑ ↓'));
    hints.appendChild(el('span', 'bt-hint-txt', 'ROWS'));
    const back = el('button', 'bt-btn bt-btn-ghost');
    back.type = 'button';
    back.tabIndex = -1;
    back.appendChild(keyChip('ESC'));
    back.appendChild(el('span', '', SCREENS.goals.back));
    barEl.appendChild(back);
    onTap(back, () => this.close());
  }

  open(p: Profile, bests: Record<string, number>): Promise<void> {
    if (this.session && !this.session.done) this.session.abort();
    this.p = p;
    this.bests = bests || {};
    this.clock.textContent = wallClock();
    const filed = GOALS.filter((g) => p.done[g.id] !== undefined).length;
    this.count.textContent = fmt(SCREENS.goals.count, { n: filed, t: GOALS.length });
    this.layer.classList.remove('bt-hidden');
    this.setTab(this.tab, false);
    pulse(this.layer, [{ opacity: 0 }, { opacity: 1 }], 200);
    pulse(this.layer.querySelector('.bt2-binder') as HTMLElement, [
      { transform: 'translateY(6%) rotate(-1.2deg)', opacity: 0 }, { transform: 'none', opacity: 1 },
    ], 320);
    const { promise, session } = runModal<void>(this.layer, this.input, (q) => this.onPress(q), {
      armMs: 220,
      onClose: () => { this.layer.classList.add('bt-hidden'); this.session = null; },
    });
    this.session = session;
    return promise;
  }

  private onPress(q: UiPress): void {
    switch (q.act) {
      case 'left': this.setTab(wrapIndex(this.tab - 1, TABS.length)); break;
      case 'right': this.setTab(wrapIndex(this.tab + 1, TABS.length)); break;
      case 'up': this.setRow(this.row - 1); break;
      case 'down': this.setRow(this.row + 1); break;
      case 'back': case 'pause': this.close(); break;
      default: break;
    }
  }

  private close(): void {
    const s = this.session;
    if (!s || s.done) return;
    s.finish(undefined, 0);
  }

  private setTab(i: number, animate = true): void {
    this.tab = i;
    this.layer.dataset.tab = TABS[i];
    this.tabEls.forEach((t, j) => {
      t.classList.toggle('on', j === i);
      t.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    this.render();
    this.row = 0;
    this.setRow(0);
    if (animate) pulse(this.list, [{ opacity: 0.2, transform: 'translateX(1.5%)' }, { opacity: 1, transform: 'none' }], 180);
  }

  private setRow(i: number): void {
    if (!this.rows.length) return;
    this.row = Math.max(0, Math.min(this.rows.length - 1, i));
    this.rows.forEach((r, j) => r.classList.toggle('is-sel', j === this.row));
    const r = this.rows[this.row];
    try { r.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
  }

  private render(): void {
    const p = this.p;
    clearEl(this.list);
    this.rows = [];
    if (!p) return;
    const tab = TABS[this.tab];
    if (tab === 'records') { this.renderRecords(); return; }
    for (const g of goalsFor(tab)) this.rows.push(this.goalRow(g, p));
  }

  private goalRow(g: GoalDef, p: Profile): HTMLElement {
    const done = p.done[g.id] !== undefined;
    const r = div(`bt2-grow${done ? ' done' : ''}`, this.list);
    r.setAttribute('role', 'listitem');
    r.dataset.goal = g.id;
    const gl = div('bt2-grow-glyph', r);
    gl.innerHTML = glyphSvg(goalGlyph(g), done ? '#ffd166' : '#f4ecd8', 28);
    const mid = div('bt2-grow-mid', r);
    const nm = div('bt2-grow-name', mid, g.name);
    if (g.scope === 'run') nm.appendChild(el('small', '', 'ONE RUN'));
    div('bt2-grow-desc', mid, g.desc);
    const pr = div('bt2-grow-prog', mid);
    const { text, frac } = goalProgressText(g, p);
    bar(pr, done ? 1 : frac, done ? 'done' : '');
    pr.appendChild(el('span', 'bt2-grow-num', text));
    const un = div('bt2-grow-unlock', r);
    un.appendChild(el('small', '', SCREENS.goals.unlocks));
    for (const u of g.unlocks) {
      const chip = div('bt2-uchip', un);
      chip.appendChild(unlockGlyphEl(u));
      const tx = div('bt2-uchip-txt', chip);
      tx.appendChild(el('i', '', unlockKind(u)));
      tx.appendChild(el('b', '', u.kind === 'palette' ? (TITAN_PALETTES[u.titan]?.[u.index - 1]?.name ?? unlockLabel(u)) : unlockLabel(u).toUpperCase()));
    }
    if (done) {
      const st = div('bt2-stamp filed', r);
      st.appendChild(el('b', '', SCREENS.goals.filed));
      st.appendChild(el('span', '', filedDate(p.done[g.id])));
    }
    r.addEventListener('mouseenter', () => { const j = this.rows.indexOf(r); if (j >= 0) this.setRow(j); });
    return r;
  }

  private renderRecords(): void {
    const B = this.bests;
    const C = SCREENS.goals.recCols;
    div('bt2-rec-head', this.list, SCREENS.goals.recordsHead);
    const tbl = div('bt2-rec', this.list);
    div('bt2-rec-corner', tbl);
    for (const b of BIOME_IDS) div('bt2-rec-col', tbl, BIOMES[b]?.name ?? b.toUpperCase());
    for (const t of TITAN_IDS) {
      const def = TITANS[t];
      const rh = div('bt2-rec-titan', tbl);
      rh.style.setProperty('--tc', def.colors.primary);
      rh.appendChild(el('b', '', def.name));
      rh.appendChild(el('small', '', def.role));
      const rowCells: HTMLElement[] = [rh];
      for (const b of BIOME_IDS) {
        const v = (k: string) => B[bestKey(t, b, k)];
        const cell = div('bt2-rec-cell', tbl);
        rowCells.push(cell);
        const lv = v('level'), rk = v('peakRank');
        if (lv === undefined && rk === undefined) { cell.classList.add('empty'); cell.appendChild(el('span', 'bt2-rec-none', SCREENS.goals.recEmpty)); continue; }
        const line = (k: string, val: string, hot = false) => {
          const d = div(`bt2-rec-kv${hot ? ' hot' : ''}`, cell);
          d.appendChild(el('small', '', k));
          d.appendChild(el('b', '', val));
        };
        line(C.level, lv !== undefined ? String(lv) : SCREENS.goals.none);
        line(C.size, rk !== undefined ? roman(rk) : SCREENS.goals.none);
        const cs = v('clearS');
        line(C.clear, cs !== undefined ? fmtTime(cs) : SCREENS.goals.none, cs !== undefined);
        const es = v('endlessS'), sc = v('endlessScore');
        line(C.ext, es !== undefined ? fmtTime(es) : SCREENS.goals.none);
        line(C.score, sc !== undefined ? fmtInt(sc) : SCREENS.goals.none);
      }
      this.rows.push(rh);
    }
  }
}

// ─────────────────────────────── NEXT PERMIT PENDING slip ───────────────────────────────

export class NextUnlockPanel implements NextUnlockPanelApi {
  private readonly slip: HTMLDivElement;
  private key = '';

  constructor(host: HTMLElement) {
    this.slip = div('bt2-permit', host);
    this.slip.dataset.v2 = 'permit';
  }

  /** Hide / show the slip (the select screen hides it while a step is animating). */
  show(on: boolean): void { this.slip.classList.toggle('bt-hidden', !on); }

  set(p: Profile, titan: TitanId, biome: BiomeId | null): void {
    const nu = nextUnlock(p, titan, biome);
    const key = nu ? `${nu.goal.id}:${nu.value}` : 'all';
    if (key === this.key) return;
    this.key = key;
    const S = this.slip;
    clearEl(S);
    div('bt2-permit-clip', S);
    const head = div('bt2-permit-head', S);
    head.appendChild(el('b', '', SCREENS.permit.header));
    if (!nu) {
      S.classList.add('issued');
      div('bt2-permit-all', S, SCREENS.permit.allIssued);
      div('bt2-permit-goal', S, SCREENS.permit.allIssuedSub);
      div('bt2-stamp issued', S, SCREENS.permit.issued);
      return;
    }
    const g = nu.goal;
    const done = p.done[g.id] !== undefined;
    S.classList.toggle('issued', done);
    S.dataset.goal = g.id;
    const u = g.unlocks[0];
    const row = div('bt2-permit-row', S);
    row.appendChild(unlockGlyphEl(u, 'lg'));
    const tx = div('bt2-permit-txt', row);
    tx.appendChild(el('i', '', unlockKind(u)));
    const extra = g.unlocks.length > 1 ? ` +${g.unlocks.length - 1}` : '';
    tx.appendChild(el('b', '', (u.kind === 'palette' ? (TITAN_PALETTES[u.titan]?.[u.index - 1]?.name ?? unlockLabel(u)) : unlockLabel(u).toUpperCase()) + extra));
    div('bt2-permit-goal', S, g.name);
    const pr = div('bt2-permit-prog', S);
    const { text, frac } = goalProgressText(g, p);
    bar(pr, done ? 1 : frac);
    pr.appendChild(el('span', '', text));
    div(`bt2-stamp ${done ? 'issued' : 'pending'}`, S, done ? SCREENS.permit.issued : SCREENS.permit.pending);
    if (u.kind === 'perk' && PERKS_DEF[u.id]) S.title = PERKS_DEF[u.id].desc;
  }
}
