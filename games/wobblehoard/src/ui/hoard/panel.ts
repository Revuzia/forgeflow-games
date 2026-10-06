// The Hoard (COLLECTION 9.1-9.3, 9.5, 9.6, 9.9, 9.10): the shelf of all 50 species, the detail card with the LIVE squishy, the daily
// gift (restock) and today's tasks, plus the HUD entry button and the "put them back" chip of the play mat.
//
// Layout: an overlay above the live stage. Desktop: an 880 px panel; the card is a right-hand column with the stage visible (and
// pokeable) beside it. Phone (< 640 px): a full-screen sheet (the stage is paused under it); the card is a bottom sheet with the
// squishy shown above it. Everything is keyboard-operable: the plinths are a roving-tabindex grid (arrows, Home / End, Enter), Tab
// stays inside the open panel, Escape closes the innermost thing (merge pad, card, then the Hoard) and focus returns to where it was.
// Player words come from collection/copy.ts or are plain English in the same voice. Counts are text, never only a badge.
import type { TierName } from '../../contracts.ts';
import {
  COPY, collectionCountCopy, mergeButtonCopy, oddsCopy, originCopy, plinthLabel, restockErrorCopy, restockOwnedCopy, sparesCopy,
  taskErrorCopy, taskProgressCopy,
} from '../../collection/copy.ts';
import { filterStacks, ownedCount, rowComplete, sortStacks } from '../../collection/stacks.ts';
import type { HoardItem, HoardPrefs, SortKey, Stack } from '../../collection/types.ts';
import { h, icon } from '../dom.ts';
import { createMergePad } from './merge.ts';
import type { MergePad } from './merge.ts';
import type { HoardEnv } from './types.ts';

export type HoardTab = 'shelf' | 'gift' | 'today';

export interface HoardUi {
  /** the HUD entry button ("Hoard 3 of 50") */
  readonly button: HTMLButtonElement;
  /** the play mat chip ("Put back 2"), shown while squishies are out */
  readonly matChip: HTMLButtonElement;
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  readonly cardOpen: boolean;
  open(tab?: HoardTab): void;
  close(): void;
  toggle(): void;
  /** open the card of a species (its keeper) */
  openCard(species: string, itemId?: string): void;
  /** Escape: close the innermost open thing; true = something closed */
  escape(): boolean;
  refresh(): void;
  destroy(): void;
}

const SORTS: ReadonlyArray<[SortKey, string]> = [['tier', 'Tier'], ['newest', 'Newest'], ['name', 'Name'], ['spares', 'Most spares'], ['catalog', 'Collection order']];
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const hoursLeft = (ms: number): string => `free in ${Math.max(1, Math.ceil(ms / 3_600_000))} h`;

export function createHoard(root: HTMLElement, env: HoardEnv): HoardUi {
  const c = env.collection;
  const off: Array<() => void> = [];
  let open = false;
  let tab: HoardTab = 'shelf';
  let filtersOpen = false;
  let noteDismissed = false;
  let lastFocus: HTMLElement | null = null;
  let card: { species: string; selected: string | null; opener: HTMLElement | null } | null = null;
  let giftPick: string | null = null;
  let rovingIdx = 0;

  /* ─────────────── HUD entry + mat chip ─────────────── */
  const btnCount = h('span', { class: 'hoard-btn-count' });
  const btnDot = h('span', { class: 'hoard-btn-dot', attrs: { 'aria-hidden': 'true' } });
  const button = h('button', { class: 'hoard-btn', attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } },
    cabinetGlyph(), h('span', { class: 'hoard-btn-text' }, h('span', { class: 'hoard-btn-word', text: 'Hoard' }), btnCount), btnDot);
  button.addEventListener('click', () => ui.toggle());
  const matChip = h('button', { class: 'mat-chip', attrs: { type: 'button', hidden: '' } });
  matChip.addEventListener('click', () => { const n = env.mat.count - 1; env.mat.clear(); env.announce(n === 1 ? 'Put back on the shelf.' : `${n} put back on the shelf.`); });

  /* ─────────────── the panel ─────────────── */
  const title = h('h2', { class: 'hoard-title', text: 'Hoard', attrs: { id: 'wh-hoard-title', tabindex: '-1' } });
  const count = h('p', { class: 'hoard-count' });
  const bar = h('div', { class: 'hoard-bar', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '50', 'aria-labelledby': 'wh-hoard-count-label' } }, h('span', { class: 'hoard-bar-fill' }));
  const countLabel = h('span', { class: 'sr-only', attrs: { id: 'wh-hoard-count-label' }, text: 'Species collected' });
  const ledger = h('span', { class: 'hoard-ledger', text: COPY.practiceLabel });
  const closeBtn = h('button', { class: 'icon-btn hoard-close', attrs: { type: 'button', 'aria-label': 'Close the Hoard' } }, icon('close'));
  closeBtn.addEventListener('click', () => ui.close());
  const head = h('header', { class: 'hoard-head' }, h('div', { class: 'hoard-head-l' }, title, ledger), h('div', { class: 'hoard-head-c' }, count, bar, countLabel), closeBtn);
  const noteText = h('p', { class: 'hoard-note-text' }, h('strong', { text: COPY.practiceShelf }), ' ', h('span', { class: 'hoard-note-chip', text: COPY.signInChip }));
  const noteClose = h('button', { class: 'icon-btn small', attrs: { type: 'button', 'aria-label': 'Dismiss this note' } }, icon('close'));
  noteClose.addEventListener('click', () => { noteDismissed = true; note.hidden = true; title.focus(); });
  const note = h('div', { class: 'hoard-note' }, noteText, noteClose);

  const tabs: Record<HoardTab, HTMLButtonElement> = {
    shelf: tabBtn('shelf', 'Shelf'),
    gift: tabBtn('gift', COPY.dailyGift),
    today: tabBtn('today', 'Today'),
  };
  const tablist = h('div', { class: 'hoard-tabs', attrs: { role: 'tablist', 'aria-label': 'Hoard sections' } }, tabs.shelf, tabs.gift, tabs.today);
  tablist.addEventListener('keydown', (e) => {
    const order: HoardTab[] = ['shelf', 'gift', 'today'];
    const i = order.indexOf(tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % 3; else if (e.key === 'ArrowLeft') n = (i + 2) % 3; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = 2;
    if (n < 0) return;
    e.preventDefault();
    showTab(order[n]); tabs[order[n]].focus();
  });

  const shelfPanel = h('section', { class: 'hoard-pane', attrs: { role: 'tabpanel', id: 'wh-pane-shelf', 'aria-labelledby': 'wh-tab-shelf' } });
  const giftPanel = h('section', { class: 'hoard-pane', attrs: { role: 'tabpanel', id: 'wh-pane-gift', 'aria-labelledby': 'wh-tab-gift', hidden: '' } });
  const todayPanel = h('section', { class: 'hoard-pane', attrs: { role: 'tabpanel', id: 'wh-pane-today', 'aria-labelledby': 'wh-tab-today', hidden: '' } });
  const body = h('div', { class: 'hoard-body' }, shelfPanel, giftPanel, todayPanel);
  const el = h('div', { class: 'hoard', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-hoard-title', 'data-open': 'false', hidden: '' } },
    head, note, tablist, body);
  root.append(el);

  /* ─────────────── the card ─────────────── */
  const cardEl = h('div', { class: 'hcard', attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'wh-card-name', 'data-open': 'false', hidden: '' } });
  root.append(cardEl);

  /* ─────────────── merge pad and Tidy-up (merge.ts) ─────────────── */
  const pad: MergePad = createMergePad(root, env, {
    onMerged: () => { ui.close(); },
    onClosed: (focusBack) => { (focusBack ?? (card ? cardEl.querySelector<HTMLElement>('.hcard-merge') : null) ?? title)?.focus(); },
  });

  function tabBtn(id: HoardTab, label: string): HTMLButtonElement {
    const b = h('button', { class: 'hoard-tab', attrs: { type: 'button', role: 'tab', id: `wh-tab-${id}`, 'aria-controls': `wh-pane-${id}`, 'aria-selected': 'false', tabindex: '-1' } },
      h('span', { text: label }), h('span', { class: 'hoard-tab-dot', attrs: { 'aria-hidden': 'true' } }));
    b.addEventListener('click', () => showTab(id));
    return b;
  }

  function showTab(t: HoardTab): void {
    tab = t;
    for (const k of Object.keys(tabs) as HoardTab[]) {
      const on = k === t;
      tabs[k].setAttribute('aria-selected', String(on));
      tabs[k].tabIndex = on ? 0 : -1;
    }
    shelfPanel.hidden = t !== 'shelf'; giftPanel.hidden = t !== 'gift'; todayPanel.hidden = t !== 'today';
    render();
  }

  /* ─────────────── state helpers ─────────────── */
  const giftWaiting = (): boolean => { try { return !c.restock().claimed; } catch { return false; } };
  const taskWaiting = (): boolean => { try { return c.tasks().some((t) => t.done && !t.claimed && !t.weeklyLimitReached); } catch { return false; } };

  function renderButton(): void {
    const stacks = c.stacks();
    const owned = ownedCount(stacks);
    btnCount.textContent = collectionCountCopy(owned, stacks.length);
    const gift = giftWaiting(), task = taskWaiting();
    button.dataset.dot = String(gift || task);
    const extra = [gift ? 'a gift is waiting' : '', task ? 'a task is ready to collect' : ''].filter(Boolean).join(', ');
    button.setAttribute('aria-label', `Hoard, ${owned} of ${stacks.length} species${extra ? `, ${extra}` : ''}`);
    tabs.gift.dataset.dot = String(gift);
    tabs.today.dataset.dot = String(task);
    const out = env.mat.count - 1;
    matChip.hidden = out < 1;
    matChip.textContent = '';
    matChip.append(h('span', { text: 'Put back' }), h('span', { class: 'mat-chip-n', text: String(out) }));
    matChip.setAttribute('aria-label', `Put the ${out === 1 ? 'squishy' : `${out} squishies`} you brought out back on the shelf`);
  }

  function renderHead(): void {
    const stacks = c.stacks();
    const owned = ownedCount(stacks);
    count.textContent = `${collectionCountCopy(owned, stacks.length)} species`;
    bar.setAttribute('aria-valuenow', String(owned));
    bar.setAttribute('aria-valuemax', String(stacks.length));
    bar.setAttribute('aria-valuetext', collectionCountCopy(owned, stacks.length));
    (bar.firstElementChild as HTMLElement).style.setProperty('--fill', String(owned / Math.max(1, stacks.length)));
    note.hidden = noteDismissed;
  }

  /* ─────────────── the shelf ─────────────── */
  function chip(label: string, on: boolean, n: number | null, onClick: () => void, lead?: Element): HTMLButtonElement {
    const b = h('button', { class: 'fchip', attrs: { type: 'button', 'aria-pressed': String(on) } }, lead ?? null, h('span', { text: label }), n === null ? null : h('span', { class: 'fchip-n', text: `(${n})` }));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderShelf(): void {
    const prefs = c.prefs();
    const all = c.stacks();
    const shown = sortStacks(filterStacks(all, prefs), prefs.sort);
    const nFilters = popcount(prefs.tiers) + popcount(prefs.lanes) + (prefs.onlySpares ? 1 : 0) + (prefs.onlyMissing ? 1 : 0) + (prefs.onlyHearts ? 1 : 0);
    const keepFocus = document.activeElement && shelfPanel.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key ?? null : null;
    shelfPanel.textContent = '';

    // tools: filters toggle, sort, view, Tidy-up
    const fBtn = h('button', { class: 'tool-btn', attrs: { type: 'button', 'aria-expanded': String(filtersOpen), 'aria-controls': 'wh-filters', 'data-key': 'filters' } },
      h('span', { text: 'Filters' }), nFilters ? h('span', { class: 'tool-n', text: String(nFilters) }) : null);
    fBtn.addEventListener('click', () => { filtersOpen = !filtersOpen; renderShelf(); shelfPanel.querySelector<HTMLElement>('[data-key="filters"]')?.focus(); });
    const sortSel = h('select', { class: 'tool-select', attrs: { id: 'wh-hoard-sort', 'data-key': 'sort' } });
    for (const [k, label] of SORTS) { const o = h('option', { text: label, attrs: { value: k } }); if (k === prefs.sort) o.selected = true; sortSel.append(o); }
    sortSel.addEventListener('change', () => { c.setPrefs({ sort: sortSel.value as SortKey }); });
    const sortWrap = h('label', { class: 'tool-sort' }, h('span', { text: 'Sort' }), sortSel);
    const viewBtn = (v: HoardPrefs['view'], label: string): HTMLButtonElement => {
      const b = h('button', { class: 'seg-btn', text: label, attrs: { type: 'button', 'aria-pressed': String(prefs.view === v), 'data-key': `view-${v}` } });
      b.addEventListener('click', () => c.setPrefs({ view: v }));
      return b;
    };
    const views = h('div', { class: 'tool-seg', attrs: { role: 'group', 'aria-label': 'View' } }, viewBtn('cabinet', 'Shelves'), viewBtn('grid', 'Grid'));
    const plan = c.tidyPlan({ includeRare: false });
    const planRare = plan.length ? plan : c.tidyPlan({ includeRare: true });
    const tidy = h('button', { class: 'tool-btn tidy', attrs: { type: 'button', 'data-key': 'tidy' } }, h('span', { text: 'Tidy up' }));
    tidy.disabled = planRare.length === 0;
    if (tidy.disabled) tidy.title = COPY.noSpares;
    tidy.addEventListener('click', () => pad.openTidy(tidy));
    shelfPanel.append(h('div', { class: 'hoard-tools' }, fBtn, sortWrap, views, tidy));

    if (filtersOpen) {
      const tierRow = h('div', { class: 'fchips', attrs: { role: 'group', 'aria-label': 'Tier' } });
      env.tiers.forEach((t, i) => {
        const n = filterStacks(all, { ...prefs, tiers: 1 << i }).length;
        tierRow.append(chip(t.label, !!(prefs.tiers & (1 << i)), n, () => c.setPrefs({ tiers: prefs.tiers ^ (1 << i) }), env.gem(t.id, 'gem gem-sm')));
      });
      const laneRow = h('div', { class: 'fchips', attrs: { role: 'group', 'aria-label': 'Feel' } });
      env.lanes.forEach((l, i) => {
        const n = filterStacks(all, { ...prefs, lanes: 1 << i }).length;
        laneRow.append(chip(l, !!(prefs.lanes & (1 << i)), n, () => c.setPrefs({ lanes: prefs.lanes ^ (1 << i) })));
      });
      const togRow = h('div', { class: 'fchips', attrs: { role: 'group', 'aria-label': 'Show' } },
        chip('Only spares', prefs.onlySpares, filterStacks(all, { ...prefs, onlySpares: true }).length, () => c.setPrefs({ onlySpares: !prefs.onlySpares })),
        chip('Only missing', prefs.onlyMissing, filterStacks(all, { ...prefs, onlyMissing: true }).length, () => c.setPrefs({ onlyMissing: !prefs.onlyMissing })),
        chip('Hearts', prefs.onlyHearts, filterStacks(all, { ...prefs, onlyHearts: true }).length, () => c.setPrefs({ onlyHearts: !prefs.onlyHearts })));
      const clear = h('button', { class: 'link-btn', text: 'Clear filters', attrs: { type: 'button' } });
      clear.disabled = nFilters === 0;
      clear.addEventListener('click', () => c.setPrefs({ tiers: 0, lanes: 0, onlySpares: false, onlyMissing: false, onlyHearts: false, onlyShelf: false }));
      shelfPanel.append(h('div', { class: 'hoard-filters', attrs: { id: 'wh-filters' } },
        h('p', { class: 'fgroup', text: 'Tier' }), tierRow, h('p', { class: 'fgroup', text: 'Feel' }), laneRow, h('p', { class: 'fgroup', text: 'Show' }), togRow, clear));
    }

    const items = c.items();
    if (items.length <= 1 && ownedCount(all) <= 1) shelfPanel.append(h('p', { class: 'hoard-empty-hint', text: COPY.firstRun }));
    shelfPanel.append(h('p', { class: 'hoard-showing', text: shown.length === all.length ? `All ${all.length} species` : `Showing ${shown.length} of ${all.length}` }));
    if (!shown.length) {
      const clear = h('button', { class: 'link-btn', text: 'Clear filters', attrs: { type: 'button' } });
      clear.addEventListener('click', () => c.setPrefs({ tiers: 0, lanes: 0, onlySpares: false, onlyMissing: false, onlyHearts: false, onlyShelf: false }));
      shelfPanel.append(h('div', { class: 'hoard-none' }, h('p', { text: 'Nothing matches these filters.' }), clear));
      return;
    }

    const grid = h('div', { class: 'cabinet', attrs: { role: 'grid', 'aria-label': 'Your squishies', 'aria-describedby': 'wh-grid-help' } });
    const help = h('p', { class: 'sr-only', attrs: { id: 'wh-grid-help' }, text: 'Arrow keys move between squishies. Enter opens one.' });
    const plinths: HTMLButtonElement[] = [];
    if (prefs.view === 'cabinet') {
      env.tiers.forEach((t, i) => {
        const row = shown.filter((s) => s.tierIdx === i);
        if (!row.length) return;
        const tierAll = all.filter((s) => s.tierIdx === i);
        const done = rowComplete(all, i);
        const shelf = h('div', { class: 'shelf', attrs: { role: 'row', 'data-tier': t.id } });
        for (const s of row) shelf.append(cell(plinth(s, plinths)));
        grid.append(h('div', { class: 'shelf-head', attrs: { role: 'presentation' } }, env.gem(t.id, 'gem gem-sm'),
          h('h3', { class: 'shelf-title', text: t.label }), h('span', { class: 'shelf-count', text: `${tierAll.filter((s) => s.copies > 0).length} of ${tierAll.length}` }),
          done ? h('span', { class: 'shelf-done', text: COPY.rowComplete }) : null), shelf);
      });
    } else {
      const shelf = h('div', { class: 'shelf flat', attrs: { role: 'row' } });
      for (const s of shown) shelf.append(cell(plinth(s, plinths)));
      grid.append(shelf);
    }
    shelfPanel.append(help, grid);
    // roving tabindex: one tab stop in the grid
    rovingIdx = Math.max(0, Math.min(plinths.length - 1, rovingIdx));
    plinths.forEach((p, i) => { p.tabIndex = i === rovingIdx ? 0 : -1; });
    grid.addEventListener('keydown', (e) => roveKey(e, plinths));
    if (keepFocus) shelfPanel.querySelector<HTMLElement>(`[data-key="${keepFocus}"]`)?.focus();
  }

  const cell = (b: HTMLElement): HTMLElement => h('div', { class: 'plinth-cell', attrs: { role: 'gridcell' } }, b);

  function plinth(s: Stack, list: HTMLButtonElement[]): HTMLButtonElement {
    const owned = s.copies > 0;
    const marks = h('span', { class: 'plinth-marks', attrs: { 'aria-hidden': 'true' } },
      s.keeperHearted ? h('span', { class: 'mark heart', text: '♥' }) : null,
      s.allLocked ? h('span', { class: 'mark clock', text: '◷' }) : null);
    const label = plinthLabel(s) + (s.keeperHearted ? ', hearted' : '') + (s.allLocked ? ', resting' : '') + (env.mat.has(s.keeper ?? '') ? ', out on the mat' : '');
    const b = h('button', { class: 'plinth', attrs: { type: 'button', 'data-owned': String(owned), 'data-tier': s.tier, 'data-key': `p-${s.species}`, 'data-species': s.species, 'aria-label': label } },
      env.gem(s.tier as TierName, 'gem plinth-gem'),
      s.unseen > 0 ? h('span', { class: 'plinth-new', attrs: { 'aria-hidden': 'true' } }) : null,
      env.icon(s.species, { silhouette: !owned, cls: 'sp-icon plinth-icon' }),
      h('span', { class: 'plinth-name', text: s.name }),
      h('span', { class: 'plinth-sub', text: owned ? (s.copies >= 2 ? `x${s.copies}` : '') : COPY.notYet }),
      marks);
    const idx = list.length;
    list.push(b);
    b.addEventListener('click', () => { rovingIdx = idx; ui.openCard(s.species); });
    b.addEventListener('focus', () => { rovingIdx = idx; });
    return b;
  }

  function roveKey(e: KeyboardEvent, list: HTMLButtonElement[]): void {
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let n = -1;
    const r = (k: number): DOMRect => list[k].getBoundingClientRect();
    const vertical = (dir: 1 | -1): number => {
      const me = r(i);
      let best = -1, bestScore = Infinity;
      for (let k = 0; k < list.length; k++) {
        const o = r(k);
        const dy = (o.top - me.top) * dir;
        if (dy < 4) continue;
        const score = dy * 4 + Math.abs(o.left + o.width / 2 - (me.left + me.width / 2));
        if (score < bestScore) { bestScore = score; best = k; }
      }
      return best;
    };
    switch (e.key) {
      case 'ArrowRight': n = Math.min(list.length - 1, i + 1); break;
      case 'ArrowLeft': n = Math.max(0, i - 1); break;
      case 'ArrowDown': n = vertical(1); break;
      case 'ArrowUp': n = vertical(-1); break;
      case 'Home': n = 0; break;
      case 'End': n = list.length - 1; break;
      default: return;
    }
    e.preventDefault();
    if (n < 0) return;
    list[i].tabIndex = -1; list[n].tabIndex = 0; rovingIdx = n; list[n].focus();
  }

  /* ─────────────── the card (9.3) ─────────────── */
  function renderCard(): void {
    if (!card) { cardEl.hidden = true; cardEl.dataset.open = 'false'; return; }
    const s = c.stacks().find((x) => x.species === card!.species);
    if (!s) { closeCard(); return; }
    const words = env.species(s.species);
    const copies = c.items().filter((it) => it.species === s.species).sort((a, b) => (a.id === s.keeper ? -1 : b.id === s.keeper ? 1 : b.bornAt - a.bornAt));
    if (card.selected && !copies.some((x) => x.id === card!.selected)) card.selected = s.keeper;
    const sel = copies.find((x) => x.id === card!.selected) ?? null;
    const keep = document.activeElement && cardEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key ?? null : null;
    cardEl.textContent = '';

    const back = h('button', { class: 'tool-btn hcard-back', attrs: { type: 'button', 'data-key': 'back' } }, h('span', { text: '‹ Shelf' }));
    back.setAttribute('aria-label', 'Back to the shelf');
    back.addEventListener('click', () => closeCard());
    const x = h('button', { class: 'icon-btn small', attrs: { type: 'button', 'aria-label': 'Close the Hoard', 'data-key': 'x' } }, icon('close'));
    x.addEventListener('click', () => ui.close());
    const nameRow = h('div', { class: 'hcard-title' }, env.gem(s.tier as TierName, 'gem gem-md'),
      h('h2', { class: 'hcard-name', text: s.name, attrs: { id: 'wh-card-name', tabindex: '-1' } }));
    const tierWord = env.tiers.find((t) => t.id === s.tier)?.label ?? s.tier;
    const facts = h('p', { class: 'hcard-facts', text: s.copies ? `${tierWord} · ${plural(s.copies, 'copy', 'copies')}${s.spares ? ` · ${sparesCopy(s.spares)}` : ''}` : `${tierWord} · ${COPY.notYet}` });
    cardEl.append(h('div', { class: 'hcard-top' }, back, x), nameRow, facts);

    if (!s.copies) {
      cardEl.append(h('div', { class: 'hcard-pic' }, env.icon(s.species, { silhouette: true, cls: 'sp-icon hcard-icon' })),
        h('p', { class: 'hcard-blurb', text: words?.blurb ?? '' }),
        h('p', { class: 'hcard-feel' }, h('strong', { text: words?.family ?? '' }), h('span', { text: words ? ` · ${words.familyBlurb}` : '' })),
        h('p', { class: 'hcard-odds', text: oddsCopy(s.tier) }),
        h('p', { class: 'hcard-hint', text: 'Squish to earn capsules: this one could be in any of them.' }));
    } else {
      cardEl.append(h('p', { class: 'hcard-live', text: 'This is the real squishy: poke it, squeeze it, stretch it.' }),
        h('p', { class: 'hcard-blurb', text: words?.blurb ?? '' }),
        h('p', { class: 'hcard-feel' }, h('strong', { text: words?.family ?? '' }), h('span', { text: words ? ` · ${words.familyBlurb}` : '' })),
        h('p', { class: 'hcard-odds', text: oddsCopy(s.tier) }));
      // the instance strip: one swatch per copy
      const strip = h('div', { class: 'hcard-strip', attrs: { role: 'radiogroup', 'aria-label': 'Your copies' } });
      copies.forEach((it, i) => {
        const now = env.now();
        const locked = it.lockedUntil !== null && it.lockedUntil > now;
        const tags = [it.id === s.keeper ? 'Keeper' : '', it.fav ? 'Hearted' : '', locked ? hoursLeft((it.lockedUntil ?? 0) - now) : '', originCopy(it.origin), !it.seen ? 'New' : '', env.mat.has(it.id) ? 'On the mat' : ''].filter(Boolean);
        const on = it.id === card!.selected;
        const b = h('button', { class: 'copy', attrs: { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', 'data-key': `c-${it.id}`, 'aria-label': `Copy ${i + 1}: ${tags.join(', ')}` } },
          env.swatch(it), h('span', { class: 'copy-tags', text: tags.join(' · ') }), it.fav ? h('span', { class: 'mark heart', text: '♥', attrs: { 'aria-hidden': 'true' } }) : null);
        b.addEventListener('click', () => selectCopy(it));
        b.addEventListener('keydown', (e) => {
          const k = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!k) return;
          e.preventDefault();
          const nx = copies[(i + k + copies.length) % copies.length];
          selectCopy(nx);
          cardEl.querySelector<HTMLElement>(`[data-key="c-${nx.id}"]`)?.focus();
        });
        strip.append(b);
      });
      cardEl.append(h('p', { class: 'hcard-sub', text: 'Your copies' }), strip);

      // actions
      const acts = h('div', { class: 'hcard-actions' });
      if (sel) {
        const heart = h('button', { class: 'act-btn', attrs: { type: 'button', 'aria-pressed': String(sel.fav), 'data-key': 'heart' } }, h('span', { class: 'mark heart', text: sel.fav ? '♥' : '♡', attrs: { 'aria-hidden': 'true' } }), h('span', { text: sel.fav ? 'Hearted' : 'Heart' }));
        heart.title = 'A hearted squishy is kept safe from merging and tidying up.';
        heart.addEventListener('click', () => { void c.setFav([sel.id], !sel.fav).then(() => env.announce(sel.fav ? 'Heart removed.' : 'Hearted: kept safe from merging.')); });
        acts.append(heart);
        if (env.playItemId() !== sel.id) {
          const play = h('button', { class: 'act-btn primary', attrs: { type: 'button', 'data-key': 'play' } }, h('span', { text: 'Play with this one' }));
          play.addEventListener('click', () => { if (env.playWith(sel)) { env.announce(`${s.name} is your squishy now.`); ui.close(); } });
          acts.append(play);
        } else acts.append(h('p', { class: 'act-note', text: 'This is the one you play with.' }));
        if (env.mat.has(sel.id)) {
          const back2 = h('button', { class: 'act-btn', attrs: { type: 'button', 'data-key': 'mat' } }, h('span', { text: 'Put back' }));
          back2.addEventListener('click', () => { env.mat.putBack(sel.id); env.announce(`${s.name} is back on the shelf.`); });
          acts.append(back2);
        } else if (env.playItemId() !== sel.id) {
          const why = env.mat.refusal(sel);
          const out = h('button', { class: 'act-btn', attrs: { type: 'button', 'data-key': 'mat' } }, h('span', { text: 'Bring out' }));
          out.disabled = !!why;
          out.addEventListener('click', () => {
            const r = env.mat.bringOut(sel);
            if (r) { env.toast(r); return; }
            env.announce(`${s.name} is out on the mat (${env.mat.count} of ${env.mat.limit}).`);
            ui.close();
          });
          acts.append(out);
          if (why) acts.append(h('p', { class: 'act-note', text: why }));
        }
        if (!sel.seen) {
          const rep = h('button', { class: 'act-btn', attrs: { type: 'button', 'data-key': 'replay' } }, h('span', { text: COPY.replayReveal }));
          rep.addEventListener('click', () => { ui.close(); void env.replayReveal(sel); });
          acts.append(rep);
        }
      }
      const mergeWhy = mergeButtonCopy(s, env.topTierIdx);
      const merge = h('button', { class: 'act-btn hcard-merge', attrs: { type: 'button', 'data-key': 'merge' } }, h('span', { text: 'Merge' }));
      merge.disabled = !!mergeWhy;
      merge.addEventListener('click', () => pad.open(s.species, merge));
      acts.append(merge);
      if (mergeWhy) acts.append(h('p', { class: 'act-note', text: mergeWhy }));
      cardEl.append(acts);
    }
    cardEl.hidden = false;
    cardEl.dataset.open = 'true';
    if (keep) cardEl.querySelector<HTMLElement>(`[data-key="${keep}"]`)?.focus();
  }

  function selectCopy(it: HoardItem): void {
    if (!card) return;
    card.selected = it.id;
    if (!env.focus(it)) env.toast(COPY.somethingWrong);
    renderCard();
  }

  function closeCard(): void {
    if (!card) return;
    const opener = card.opener;
    card = null;
    pad.close();
    cardEl.hidden = true; cardEl.dataset.open = 'false';
    document.body.dataset.hcard = 'closed';
    env.restore();
    if (open) {
      el.hidden = false; el.dataset.open = 'true';
      layoutCover();
      render();
      const sp = opener?.dataset.species;
      (sp ? shelfPanel.querySelector<HTMLElement>(`[data-species="${sp}"]`) : null)?.focus();
    }
  }

  /* ─────────────── gift (9.5) ─────────────── */
  function renderGift(): void {
    giftPanel.textContent = '';
    const r = c.restock();
    if (r.claimed) {
      giftPanel.append(h('div', { class: 'gift-done' }, h('p', { class: 'gift-big', text: COPY.comeBackTomorrow }),
        h('p', { class: 'gift-sub', text: "Today's gift is on your shelf. A new choice of three is here every day." })));
      return;
    }
    giftPanel.append(h('p', { class: 'gift-lead', text: 'Pick one of these three to keep. A new choice comes every day.' }));
    const row = h('div', { class: 'gift-row', attrs: { role: 'radiogroup', 'aria-label': "Today's gift" } });
    r.display.forEach((d, i) => {
      const on = giftPick === d.species;
      const b = h('button', { class: 'gift', attrs: { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on || (!giftPick && i === 0) ? '0' : '-1', 'data-species': d.species } },
        env.gem(d.tier as TierName, 'gem plinth-gem'), env.icon(d.species, { cls: 'sp-icon gift-icon' }),
        h('span', { class: 'gift-name', text: d.name }), h('span', { class: 'gift-tier', text: env.tiers.find((t) => t.id === d.tier)?.label ?? d.tier }),
        h('span', { class: 'gift-own', text: restockOwnedCopy(d.copies) }));
      b.addEventListener('click', () => { giftPick = d.species; renderGift(); giftPanel.querySelector<HTMLElement>(`[data-species="${d.species}"]`)?.focus(); });
      b.addEventListener('keydown', (e) => {
        const k = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        giftPick = r.display[(i + k + r.display.length) % r.display.length].species;
        renderGift();
        giftPanel.querySelector<HTMLElement>(`[data-species="${giftPick}"]`)?.focus();
      });
      row.append(b);
    });
    const take = h('button', { class: 'cta-btn', text: COPY.takeThisOne, attrs: { type: 'button', 'data-key': 'take' } });
    take.disabled = !giftPick || env.busy();
    take.addEventListener('click', () => {
      if (!giftPick) return;
      void c.claimRestock(giftPick as never).then((res) => {
        if (!res.ok) { env.toast(res.message ?? restockErrorCopy(res.error)); renderGift(); return; }
        giftPick = null;
        env.announce(`${res.is_new ? 'New! ' : ''}${res.item.name} is yours.`);
        ui.close();
        void env.revealClaim(res);
      });
    });
    giftPanel.append(row, take);
  }

  /* ─────────────── today (9.6) ─────────────── */
  function renderToday(): void {
    todayPanel.textContent = '';
    const rows = c.tasks();
    if (!rows.length) { todayPanel.append(h('p', { class: 'gift-lead', text: 'No tasks today.' })); return; }
    if (rows.every((t) => t.weeklyLimitReached && !t.claimed)) {
      todayPanel.append(h('p', { class: 'gift-big', text: COPY.weekDone }));
      return;
    }
    todayPanel.append(h('p', { class: 'gift-lead', text: 'Two little things to try today. Each one done is a capsule.' }));
    const list = h('ul', { class: 'tasks' });
    rows.forEach((t, i) => {
      const fill = h('span', { class: 'task-fill' });
      fill.style.setProperty('--fill', String(Math.min(1, t.progress / Math.max(1, t.target))));
      const barEl = h('div', { class: 'task-bar', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(t.target), 'aria-valuenow': String(t.progress), 'aria-valuetext': taskProgressCopy(t), 'aria-labelledby': `wh-task-${i}` } }, fill);
      const li = h('li', { class: 'task', attrs: { 'data-done': String(t.done), 'data-claimed': String(t.claimed) } },
        h('p', { class: 'task-text', text: t.def.text, attrs: { id: `wh-task-${i}` } }), barEl, h('p', { class: 'task-n', text: taskProgressCopy(t) }));
      if (t.claimed) li.append(h('p', { class: 'task-state', text: 'Collected' }));
      else if (t.weeklyLimitReached) li.append(h('p', { class: 'task-state', text: COPY.weekDone }));
      else if (t.done) {
        const b = h('button', { class: 'cta-btn small', text: COPY.collectCapsule, attrs: { type: 'button', 'data-key': `task-${t.def.id}` } });
        b.addEventListener('click', () => {
          void c.completeTask(t.def.id).then((r) => {
            if (!r.ok) { env.toast(r.message ?? taskErrorCopy(r.error, r.progress, r.target)); return; }
            env.announce('Task done. A capsule is waiting for you.');
            render();
            todayPanel.querySelector<HTMLElement>('button')?.focus() ?? title.focus();
          });
        });
        li.append(b);
      }
      list.append(li);
    });
    todayPanel.append(list);
  }

  /* ─────────────── open / close / layout ─────────────── */
  const isPhone = (): boolean => window.innerWidth < 640;
  function layoutCover(): void {
    // the full-screen sheet covers the stage on a phone: pause the sim and sound under it (the card shows the stage again)
    env.cover(open && !card && isPhone());
    env.holdInput(open && !card);
    document.body.dataset.hoard = open ? (card ? 'card' : 'open') : 'closed';
  }

  function render(): void {
    renderButton();
    if (!open) return;
    renderHead();
    if (card) { renderCard(); return; }
    if (tab === 'shelf') renderShelf(); else if (tab === 'gift') renderGift(); else renderToday();
  }

  // focus stays inside the open dialog (the card is not modal: the stage beside it is meant to be touched, but Tab cycles the card)
  const trap = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !open) return;
    const scope = pad.isOpen ? pad.el : card ? cardEl : el;
    const f = [...scope.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex="0"], input:not([disabled])')].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!scope.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', trap, true);
  off.push(() => document.removeEventListener('keydown', trap, true));

  off.push(c.onChange(() => { render(); pad.refresh(); }));
  off.push(env.mat.onChange(() => render()));
  const onResize = (): void => { if (open) layoutCover(); };
  window.addEventListener('resize', onResize);
  off.push(() => window.removeEventListener('resize', onResize));

  const ui: HoardUi = {
    button, matChip, el,
    get isOpen() { return open; },
    get cardOpen() { return !!card; },
    open(t) {
      if (env.busy()) { env.announce('The Hoard opens when this is done.'); env.whenIdle(() => ui.open(t)); return; }
      if (!open) lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      open = true;
      el.hidden = false; el.dataset.open = 'true';
      button.setAttribute('aria-expanded', 'true');
      layoutCover();
      showTab(t ?? tab);
      requestAnimationFrame(() => { if (open && !card) title.focus(); });
    },
    close() {
      if (!open) return;
      pad.close();
      if (card) { card = null; cardEl.hidden = true; cardEl.dataset.open = 'false'; env.restore(); }
      open = false;
      el.hidden = true; el.dataset.open = 'false';
      button.setAttribute('aria-expanded', 'false');
      layoutCover();
      renderButton();
      const back = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : env.returnFocus();
      lastFocus = null;
      back?.focus();
    },
    toggle() { if (open) ui.close(); else ui.open(); },
    openCard(species, itemId) {
      if (!open) ui.open('shelf');
      const s = c.stacks().find((x) => x.species === species);
      if (!s) return;
      const opener = shelfPanel.querySelector<HTMLElement>(`[data-species="${species}"]`);
      card = { species, selected: itemId ?? s.keeper, opener };
      const it = card.selected ? c.item(card.selected) : null;
      if (it && !env.focus(it)) env.toast(COPY.somethingWrong);
      el.hidden = true; el.dataset.open = 'false';
      layoutCover();
      renderCard();
      requestAnimationFrame(() => cardEl.querySelector<HTMLElement>('#wh-card-name')?.focus());
    },
    escape() {
      if (pad.escape()) return true;
      if (card) { closeCard(); return true; }
      if (open) { ui.close(); return true; }
      return false;
    },
    refresh: render,
    destroy() { for (const f of off.splice(0)) f(); pad.destroy(); el.remove(); cardEl.remove(); button.remove(); matChip.remove(); },
  };
  renderButton();
  return ui;
}

function popcount(n: number): number { let k = 0; for (let x = n; x; x &= x - 1) k++; return k; }

/** A small cabinet glyph (three shelves) for the HUD button. */
function cabinetGlyph(): SVGSVGElement {
  const svg = icon('none', 'icon hoard-glyph');
  const ns = 'http://www.w3.org/2000/svg';
  for (const d of ['M5 4h14v16H5z', 'M5 9.5h14M5 15h14', 'M9 7h2M13 12.3h2M9 17.6h2']) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
