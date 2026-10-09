// The TROPHIES and RECORDS screen (UI.md 6, B6b): the 20 trophies as cards (earned / not yet / hidden, a tier medal with rank pips and its XP, progress where a count exists), and
// the Records numbers, behind one segmented switch. A `later-*` chunk (the file name is the chunk name: G0b counts first-play files only): the Menu row, the title chip and
// the dev hook open it with a dynamic import, so nothing here is in the first download. It stands on `openLayer` (modal.ts) like the Menu: the page behind is inert, Tab stays
// inside, Esc closes (the shell's Esc order), focus comes back to the opener. The game keeps running behind the scrim (like Settings); nothing here can change a trophy.
//
// Nothing pays and nothing nags: no streak, no "you are missing", no timer. A hidden trophy says "???" until it is found; the account line is set with textContent and never
// holds a name (the bridge never reads one). Every state has a word and an icon beside its colour (earned: a tick and a date; not yet / hidden: a lock).
import type { Collection } from '../collection/types.ts';
import { ACH_TOTAL_POINTS } from '../core/achievements.ts';
import type { AchTier, AchievementDef, Evaluator } from '../core/achievements.ts';
import { accountLine, xpLine } from '../portal/copy.ts';
import type { PortalBridge } from '../portal/bridge.ts';
import { h } from './dom.ts';
import { interactiveTarget } from '../input/keyboard.ts';
import { gemSvg } from './gem.ts';
import { icon } from './icons.ts';
import { jelly, setJelly } from './jelly/jelly.ts';
import type { JellySize } from './jelly/jelly.ts';
import { openLayer } from './modal.ts';
import type { Layer } from './modal.ts';
import { cue } from './uiSound.ts';
import {
  FILTERS, TIER_RANK, TIER_WORDS, conditionOf, countLine, filterLine, filterRows, heroNote, hoardFacts, nameOf, rarestLine, recordTiles, sinceLine, statusWord,
  tierCounts, trophyRowsOf,
} from './trophiesData.ts';
import type { TierFilter, TrophyRow } from './trophiesData.ts';
import './trophies.css';

export type TrophiesTab = 'trophies' | 'records';

/** What the screen reads of the trophies (shell/achievementsBinding.ts `Achievements` satisfies it; the kit page passes a real one over scripted events). */
export interface TrophiesSource {
  readonly evaluator: Pick<Evaluator, 'earnedAt' | 'progress' | 'earnedCount' | 'earnedPoints' | 'save'>;
  readonly bridge: Pick<PortalBridge, 'state' | 'onChange'>;
  onUnlock(fn: (def: AchievementDef) => void): () => void;
}
export interface TrophiesOpts {
  /** the UI root (the layer's parent) */
  root: HTMLElement;
  trophies: TrophiesSource;
  /** the Hoard, for the Records numbers */
  hoard: Pick<Collection, 'stacks'>;
  /** the live region */
  say(text: string): void;
  /** the control that gets the focus back (default: the one that had it) */
  from?: HTMLElement | null;
  tab?: TrophiesTab;
  filter?: TierFilter;
  onClose?(why: string): void;
}
export interface TrophiesScreen {
  readonly el: HTMLElement;
  readonly open: boolean;
  readonly tab: TrophiesTab;
  readonly filter: TierFilter;
  close(why?: string): boolean;
  show(tab: TrophiesTab): void;
  setFilter(f: TierFilter): void;
  /** redraw from the current facts */
  refresh(): void;
}

const TITLE: Record<TrophiesTab, string> = { trophies: 'Trophies', records: 'Records' };
const SEG_LABEL = 'Show';
/** a card fades in on the first drawing of the list, this many ms apart (only the first dozen: it is a settle, not a show) */
const ENTER_STEP_MS = 22;
const ENTER_MAX = 12;

function dateText(ms: number): string {
  try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms)); } catch { return ''; }
}

/** The medal: a round plate in the tier colour with the trophy (earned) or a lock (not yet, hidden). Decorative: the words beside it say all of it. */
function medal(earned: boolean): HTMLElement {
  return h('span', { class: 'tro-medal', attrs: { 'aria-hidden': 'true' } }, icon(earned ? 'trophy' : 'lock'));
}
/** The rank pips (1 bronze, 2 silver, 3 gold, 4 diamond) before the tier word: a rank cue that is not a colour. */
function pips(tier: AchTier): HTMLElement {
  const p = h('span', { class: 'tro-pips', attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < TIER_RANK[tier]; i++) p.append(h('i'));
  return p;
}

function progressBar(value: number, max: number, label: string): HTMLElement {
  const fill = h('span', { class: 'k-progress-fill' });
  const bar = h('div', { class: 'k-progress', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value), 'aria-label': label } }, fill);
  bar.style.setProperty('--p', String(max > 0 ? Math.min(1, value / max) : 0));
  return bar;
}

let uid = 0;

export function openTrophies(o: TrophiesOpts): TrophiesScreen {
  const ev = o.trophies.evaluator;
  const n = ++uid;
  const titleId = n === 1 ? 'wh-trophies-title' : `wh-trophies-title-${n}`;   // (the game has one screen; a kit page may show several)
  let tab: TrophiesTab = o.tab ?? 'trophies';
  let filter: TierFilter = o.filter ?? 'all';
  let entered = false;
  let raf = 0;
  const offs: Array<() => void> = [];
  let pendingMore: string | null = null;

  const layoutOf = (): string => document.body.dataset.layout ?? 'wide';
  const heroSize = (): JellySize => { const l = layoutOf(); return l === 'tiny' ? 'sm' : l === 'wide' ? 'lg' : 'md'; };
  const titleSize = (): JellySize => { const l = layoutOf(); return l === 'tiny' || l === 'strip' ? 'sm' : 'md'; };

  /* ─────────────── the frame: heading, the switch, one close button ─────────────── */
  const title = jelly(TITLE[tab], { tag: 'h2', size: titleSize(), tone: 'amber' });
  title.id = titleId; title.tabIndex = -1; title.classList.add('tro-title');
  const seg = h('div', { class: 'k-seg tro-seg', attrs: { role: 'radiogroup', 'aria-label': SEG_LABEL } });
  const radios: Record<TrophiesTab, HTMLInputElement> = {} as Record<TrophiesTab, HTMLInputElement>;
  for (const [id, label, ic] of [['trophies', 'Trophies', 'trophy'], ['records', 'Records', 'records']] as const) {
    const input = h('input', { class: 'k-seg-input', attrs: { type: 'radio', name: `wh-trophies-tab-${n}`, value: id } });
    input.checked = id === tab;
    input.addEventListener('change', () => { if (input.checked) api.show(id); });
    radios[id] = input;
    seg.append(h('label', { class: 'k-seg-opt', attrs: { title: label } }, input, h('span', { class: 'k-seg-face' }, icon(ic), h('span', { text: label }))));
  }
  const closeBtn = h('button', { class: 'k-btn k-iconbtn tro-close', attrs: { type: 'button', 'aria-label': 'Close trophies', title: 'Close (Esc)', 'data-sound': 'none' } }, icon('close'));
  closeBtn.addEventListener('click', () => api.close('button'));
  const head = h('header', { class: 'tro-head' }, title, seg, closeBtn);
  // the pane scrolls inside itself and is always a stop of its own: the keyboard can reach it first (arrows, Page Up / Down, Space scroll it), and no key goes on to the toy
  const scroll = h('div', { class: 'tro-scroll', attrs: { tabindex: '0', role: 'region' } });
  const panel = h('section', { class: 'tro k-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-tab': tab } },
    h('div', { class: 'k-panel-grip', attrs: { 'aria-hidden': 'true' } }), head, scroll);
  const scrim = h('div', { class: 'k-scrim tro-scrim', attrs: { 'data-trophies': 'true' } }, panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) api.close('scrim'); });

  /* ─────────────── the Trophies pane ─────────────── */
  function card(r: TrophyRow, index: number): HTMLElement {
    const d = r.def;
    const meta = h('p', { class: 'tro-meta' },
      h('span', { class: 'tro-tier' }, pips(d.tier), h('span', { text: TIER_WORDS[d.tier] })), h('span', { class: 'tro-xp', text: `${d.points} XP` }),
      h('span', { class: 'tro-status', attrs: { 'data-state': r.state } }, icon(r.state === 'earned' ? 'check' : 'lock', 'k-icon'), h('span', { text: r.state === 'earned' && r.at !== null ? `${statusWord(r)} ${dateText(r.at)}`.trim() : statusWord(r) })));
    const body = h('div', { class: 'tro-body' }, h('h3', { class: 'tro-name', text: nameOf(r) }), h('p', { class: 'tro-cond', text: conditionOf(r) }));
    if (r.progress && r.state !== 'earned') {
      body.append(h('div', { class: 'tro-prog' }, progressBar(r.progress.value, r.progress.target, `${d.name}: species owned`), h('span', { class: 'tro-prog-n', text: `${r.progress.value} of ${r.progress.target} species` })));
    }
    body.append(meta);
    const li = h('li', { class: 'tro-card', attrs: { 'data-tier': d.tier, 'data-state': r.state, 'data-slug': d.slug } }, medal(r.state === 'earned'), body);
    if (!entered && index < ENTER_MAX) { li.classList.add('tro-in'); li.style.setProperty('--i', String(index)); li.style.setProperty('--tro-step', `${ENTER_STEP_MS}ms`); }
    return li;
  }

  function trophiesPane(): HTMLElement {
    const rows = trophyRowsOf(ev);
    const counts = tierCounts(rows);
    const all = counts.all;
    // hero: the count in jelly, a gel bar, the XP line, the account line, one kind sentence
    const count = jelly(countLine(all.earned, all.total), { size: heroSize(), tone: all.earned >= all.total ? 'gold' : 'amber', tag: 'p' });
    count.classList.add('tro-count');
    const acct = h('p', { class: 'tro-acct' }, icon('user', 'k-icon'), h('span', { class: 'tro-acct-text', text: accountLine(o.trophies.bridge.state) }));
    const hero = h('section', { class: 'tro-hero k-card k-card--hero', attrs: { 'aria-label': 'Progress' } },
      h('div', { class: 'tro-hero-main' }, count, h('span', { class: 'tro-hero-cap', text: 'trophies' })),
      h('div', { class: 'tro-hero-side' },
        progressBar(all.earned, all.total, 'Trophies earned'),
        h('p', { class: 'tro-xpline', text: xpLine(all.earnedPoints, ACH_TOTAL_POINTS) }), acct,
        h('p', { class: 'tro-note', text: heroNote(all.earned, all.total) })));
    // the medal rail doubles as the tier filter
    const rail = h('div', { class: 'k-chips tro-rail', attrs: { role: 'group', 'aria-label': 'Show tier' } });
    for (const f of FILTERS) {
      const c = counts[f];
      const chip = h('button', { class: 'k-chip tro-chip', attrs: { type: 'button', 'aria-pressed': String(f === filter), 'data-filter': f, ...(f === 'all' ? {} : { 'data-tier': f }) } },
        icon(f === 'all' ? 'star' : 'trophy', 'k-icon'), h('span', { text: f === 'all' ? 'All' : TIER_WORDS[f] }), h('span', { class: 'k-chip-n', text: `${c.earned}/${c.total}` }));
      chip.addEventListener('click', () => api.setFilter(f));
      rail.append(chip);
    }
    const shown = filterRows(rows, filter);
    const list = h('ul', { class: 'tro-list', attrs: { role: 'list', 'aria-label': filter === 'all' ? 'All trophies' : `${TIER_WORDS[filter]} trophies` } }, ...shown.map(card));
    return h('div', { class: 'tro-pane', attrs: { 'data-pane': 'trophies' } }, hero, rail, list);
  }

  /* ─────────────── the Records pane ─────────────── */
  function recordsPane(): HTMLElement {
    const since = ev.save.since;
    const pane = h('div', { class: 'tro-pane', attrs: { 'data-pane': 'records' } }, h('p', { class: 'tro-since', text: sinceLine(dateText(since) || 'on this device') }));
    let facts: ReturnType<typeof hoardFacts> | null = null;
    try { facts = hoardFacts(o.hoard.stacks()); } catch { facts = null; }
    if (facts) {
      const f = facts;
      const rarest = f.rarest;
      const rar = h('div', { class: 'tro-fact' }, h('span', { class: 'tro-fact-l', text: 'Rarest' }),
        h('span', { class: 'tro-fact-v tro-rarest' }, rarest ? gemSvg(rarest.tier, 'gem') : null, h('span', { text: rarestLine(rarest) })));
      const spec = h('div', { class: 'tro-fact tro-fact--wide' }, h('span', { class: 'tro-fact-l', text: 'Species' }), h('span', { class: 'tro-fact-v', text: countLine(f.species, f.total) }),
        progressBar(f.species, f.total, 'Species collected'));
      const squ = h('div', { class: 'tro-fact' }, h('span', { class: 'tro-fact-l', text: 'Squishies' }), h('span', { class: 'tro-fact-v', text: String(f.squishies) }));
      const bars = h('ul', { class: 'tro-bars', attrs: { role: 'list', 'aria-label': 'Species by rarity' } },
        ...f.bars.map((b) => h('li', { class: 'tro-bar', attrs: { 'data-tier': b.tier } },
          h('span', { class: 'tro-bar-name' }, gemSvg(b.tier, 'gem'), h('span', { text: b.name })),
          progressBar(b.owned, b.total, `${b.name} species owned`), h('span', { class: 'tro-bar-n', text: countLine(b.owned, b.total) }))));
      pane.append(h('section', { class: 'tro-group', attrs: { 'aria-label': 'Your Hoard' } }, h('h3', { class: 'k-group-title', text: 'Your Hoard' }),
        h('div', { class: 'tro-facts k-card' }, spec, squ, rar), bars));
    }
    const tiles = h('ul', { class: 'tro-tiles', attrs: { role: 'list' } },
      ...recordTiles(ev.save.counters).map((t) => h('li', { class: 'tro-tile', attrs: { 'data-record': t.id } }, h('span', { class: 'tro-tile-n', text: String(t.value) }), h('span', { class: 'tro-tile-l', text: t.label }))));
    pane.append(h('section', { class: 'tro-group', attrs: { 'aria-label': 'Play' } }, h('h3', { class: 'k-group-title', text: 'Play' }), tiles));
    return pane;
  }

  /* ─────────────── drawing ─────────────── */
  function render(): void {
    const keep = scroll.scrollTop;
    const focusFilter = scroll.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.filter ?? null : null;
    panel.dataset.tab = tab;
    scroll.replaceChildren(tab === 'trophies' ? trophiesPane() : recordsPane());
    scroll.setAttribute('aria-label', tab === 'trophies' ? 'Trophy cards' : 'Records');
    entered = true;
    scroll.scrollTop = keep;
    if (focusFilter) scroll.querySelector<HTMLElement>(`[data-filter="${focusFilter}"]`)?.focus({ preventScroll: true });
    if (pendingMore) { o.say(pendingMore); pendingMore = null; }
  }

  const onResize = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      setJelly(title, TITLE[tab], { size: titleSize() });
      const c = scroll.querySelector<HTMLElement>('.tro-count');
      if (c) setJelly(c, c.textContent ?? '', { size: heroSize() });
    });
  };
  window.addEventListener('resize', onResize);
  offs.push(() => { window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf); });
  // The game keeps running behind this screen, and keyboard.ts gives Space, the letters and the arrows to the toy unless a CONTROL has the focus; here the focus rests on the heading or the
  // scrolling pane. So while the screen is open a key that is not for a control (and not Tab or Escape) stops at the window: it still scrolls the pane, it no longer pokes the squishy.
  const guard = (e: KeyboardEvent): void => { if (e.key !== 'Escape' && e.key !== 'Tab' && !interactiveTarget(e.target)) e.stopPropagation(); };
  window.addEventListener('keydown', guard, true);
  offs.push(() => window.removeEventListener('keydown', guard, true));
  offs.push(o.trophies.onUnlock(() => { if (layer.open) render(); }));
  offs.push(o.trophies.bridge.onChange(() => { const a = scroll.querySelector('.tro-acct-text'); if (a) a.textContent = accountLine(o.trophies.bridge.state); }));

  /* ─────────────── the layer ─────────────── */
  const layer: Layer = openLayer({
    el: scrim, parent: o.root,
    initialFocus: () => scroll,
    returnFocus: () => (o.from && o.from.isConnected && !o.from.closest('[inert]') ? o.from : null),
    onClose: (why) => {
      for (const f of offs.splice(0)) f();
      cue(why === 'escape' ? 'back' : 'close');
      o.onClose?.(why);
    },
  });
  cue('open');
  render();

  const api: TrophiesScreen = {
    el: scrim,
    get open() { return layer.open; },
    get tab() { return tab; },
    get filter() { return filter; },
    close: (why = 'code') => layer.close(why),
    show(t) {
      if (t === tab || !layer.open) { radios[t].checked = true; return; }
      tab = t;
      radios[t].checked = true;
      setJelly(title, TITLE[t], { size: titleSize() });
      scroll.scrollTop = 0;
      render();
    },
    setFilter(f) {
      if (f === filter || !layer.open) return;
      filter = f;
      pendingMore = filterLine(f, tierCounts(trophyRowsOf(ev))[f]);
      render();
    },
    refresh() { if (layer.open) render(); },
  };
  return api;
}
