// PLAYGROUND: THE JOURNAL and THE TRAVEL SHEET (QUESTS.md 15, PLAYGROUND_BUILD.md 11.7, 11.10). A `later-*` chunk (the file name is the chunk name: G0b counts
// first-play files only): the dock's Journal and Places entries open it with a dynamic import, like the Trophies screen (ui/later-trophies.ts), and it stands on
// the same `openLayer` (modal.ts): the page behind is inert, Tab stays inside, Esc closes (the shell's Esc order: the top layer first), focus comes back to the
// opener. LIFE is quiet while either sheet is open (the host's setSheet). All player text comes from src/data/journal_text.ts (it ships here, never in the
// first load). Nothing pays and nothing nags: no countdown, no streak, no number badge; a quest says what it needs in plain words.
//
//   Journal  four tabs (Stamps, Squishies, Friends, Keepsakes): the shown quests of each open chapter with "2 of 3" and "Needs: Squishies move on their own",
//            the facts of each owned species with its family's name (D-82), the friendships, the 20 keepsakes; "Wishes now" and the gift card on Stamps.
//   Travel   the postcards of the SHIPPED places (QUESTS 15: an unshipped one is not shown at all): an open one says "N of M stamps" of its chapter and
//            goes there (the host's travel path: the crossfade, the party at rest); a shut one says how many stamps open it.
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { jelly } from './jelly/jelly.ts';
import { openLayer } from './modal.ts';
import type { Layer } from './modal.ts';
import { cue } from './uiSound.ts';
import { interactiveTarget } from '../input/keyboard.ts';
import type { LifeHostApi } from '../shell/lifeLink.ts';
import type { Game } from '../shell/game.ts';
import type { JournalView } from '../collection/types.ts';
import { CATALOG } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import { MATERIAL_FAMILIES } from '../data/materials.ts';
import { PLACE_INFO } from '../data/places.ts';
import { CHAPTERS, FACT, GIFT_LISTS, QUESTS } from '../data/quests.ts';
import { CHAPTER_TEXT, FACT_LINES, GIFT_LINES, KEEPSAKE_TEXT, QUEST_TEXT, UI_TEXT, WISH_LINES, fill } from '../data/journal_text.ts';
import { WISH_KIND, SPECIES_LIFE } from '../data/life.ts';
import './journal.css';

export interface LifeScreenOpts {
  root: HTMLElement;
  host: LifeHostApi;
  game: Game;
  say(text: string): void;
  from?: HTMLElement | null;
  onClose?(why: string): void;
  /** round 5: the Journal opens at this quest id (the tracker pill's tap): its row is scrolled into view and marked for a moment */
  at?: string;
}
export interface LifeScreen { readonly el: HTMLElement; readonly open: boolean; close(why?: string): boolean; refresh(): void }

type Tab = 'stamps' | 'squishies' | 'friends' | 'keepsakes';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'stamps', label: UI_TEXT.tabs[0] }, { id: 'squishies', label: UI_TEXT.tabs[1] }, { id: 'friends', label: UI_TEXT.tabs[2] }, { id: 'keepsakes', label: UI_TEXT.tabs[3] },
];
const spName = (sp: number): string => CATALOG[sp]?.name ?? 'A squishy';
const famName = (sp: number): string => { const f = CATALOG[sp]?.family; return f ? MATERIAL_FAMILIES[f]?.name ?? '' : ''; };
const placeName = (idx: number): string => PLACE_INFO.find((p) => p.idx === idx)?.name ?? '';

/** the wish card's line (QUESTS 8; journal_text WISH_LINES) */
export function wishLine(species: number, kind: number, target: number): string {
  const name = spName(species);
  switch (kind) {
    case WISH_KIND.PLACE: return target === 1 ? fill(WISH_LINES.firstWish, { name, place: placeName(1) }) : fill(WISH_LINES.place, { name, place: placeName(target) });
    case WISH_KIND.FRIEND: return fill(WISH_LINES.friend, { name, friend: spName(target) });
    case WISH_KIND.NAP: return fill(WISH_LINES.nap, { name });
    case WISH_KIND.SONG: return fill(WISH_LINES.song, { name });
    case WISH_KIND.WARM: return fill(WISH_LINES.warm, { name });
    case WISH_KIND.RIDE: return fill(WISH_LINES.ride, { name, thing: 'swing' });
    case WISH_KIND.TOUCH: return fill(WISH_LINES.squeeze, { name });
    default: return fill(WISH_LINES.thing, { name, kind: WISH_LINES.kinds.ball });
  }
}

function frame(o: LifeScreenOpts, titleText: string, id: string, extraHead?: HTMLElement | null): { scrim: HTMLElement; scroll: HTMLElement; close: HTMLButtonElement; title: HTMLElement } {
  const title = jelly(titleText, { tag: 'h2', size: 'md', tone: 'amber' });
  title.id = `${id}-title`; title.classList.add('jn-title'); title.setAttribute('tabindex', '-1');
  const close = h('button', { class: 'k-btn k-iconbtn jn-close', attrs: { type: 'button', 'aria-label': `Close ${titleText}`, title: 'Close (Esc)', 'data-sound': 'none' } }, icon('close'));
  const head = h('header', { class: 'jn-head' }, title, extraHead ?? h('span'), close);
  const scroll = h('div', { class: 'jn-scroll', attrs: { tabindex: '0', role: 'region', 'aria-label': titleText } });
  const panel = h('section', { class: 'jn k-panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id, id } },
    h('div', { class: 'k-panel-grip', attrs: { 'aria-hidden': 'true' } }), head, scroll);
  const scrim = h('div', { class: 'k-scrim jn-scrim', attrs: { 'data-journal': id } }, panel);
  void o;
  return { scrim, scroll, close, title };
}
function guardKeys(): () => void {
  // the game runs behind the sheet: a key that is not for a control stops at the window (it must not poke the squishy), as on the Trophies screen
  const guard = (e: KeyboardEvent): void => { if (e.key !== 'Escape' && e.key !== 'Tab' && !interactiveTarget(e.target)) e.stopPropagation(); };
  window.addEventListener('keydown', guard, true);
  return () => window.removeEventListener('keydown', guard, true);
}

/* ═══════════════════════════════════════ the Journal ═══════════════════════════════════════ */
export function openJournal(o: LifeScreenOpts): LifeScreen {
  let tab: Tab = 'stamps';
  const seg = h('div', { class: 'k-seg jn-tabs', attrs: { role: 'tablist', 'aria-label': 'Journal pages' } });
  const tabBtns = TABS.map((t) => {
    const b = h('button', { class: 'k-btn jn-tab', attrs: { type: 'button', role: 'tab', 'aria-selected': String(t.id === tab), 'data-tab': t.id } }, h('span', { text: t.label }));
    b.addEventListener('click', () => { tab = t.id; render(); });
    seg.append(b);
    return b;
  });
  const f = frame(o, UI_TEXT.journal, 'wh-journal', seg);
  f.close.addEventListener('click', () => api.close('button'));
  const offs: Array<() => void> = [guardKeys()];

  const questRow = (v: JournalView, qi: number): HTMLElement | null => {
    const q = v.quests[qi];
    if (!q || !q.shown) return null;
    const [title, hint] = QUEST_TEXT[q.idx] ?? ['', ''];
    const state = q.done ? 'done' : q.open ? 'open' : 'later';
    const need = q.need > 1 && !q.done ? fill(UI_TEXT.ofN, { a: String(Math.min(q.have, q.need)), b: String(q.need) }) : '';
    return h('li', { class: 'jn-quest k-card', attrs: { 'data-state': state, 'data-quest': q.id } },
      h('span', { class: 'jn-stamp', attrs: { 'aria-hidden': 'true' } }, q.done ? icon('check') : icon(q.kind === 'finale' ? 'star' : 'book')),
      h('span', { class: 'jn-q-text' },
        h('b', { class: 'jn-q-title', text: title }),
        h('span', { class: 'jn-q-hint', text: q.done ? 'Done.' : q.needsAutonomy && !o.game.settings.autonomy ? UI_TEXT.needsAutonomy : hint }),
        need ? h('span', { class: 'jn-q-need', text: need }) : null));
  };
  function stampsPane(v: JournalView): HTMLElement {
    const pane = h('div', { class: 'jn-pane' });
    pane.append(h('p', { class: 'jn-lead', text: fill(UI_TEXT.stampsOf, { a: String(v.stamps), b: String(v.quests.filter((q) => q.shown).length) }) }));
    // Wishes now (the open wishes of the squishies out, then the ones resting in the Journal)
    const now = o.host.wishesNow();
    const rest = v.wishes;
    if (now.length || rest.length || v.firstWish === 1) {
      const list = h('ul', { class: 'jn-wishes', attrs: { role: 'list' } });
      for (const wsh of now) list.append(h('li', { class: 'jn-wish k-card' }, icon('star'), h('span', { text: wishLine(wsh.species, wsh.kind, wsh.target) })));
      for (const wsh of rest) list.append(h('li', { class: 'jn-wish k-card', attrs: { 'data-rest': 'true' } }, icon('clock'), h('span', { text: wsh.kind === WISH_KIND.PLACE ? fill(WISH_LINES.rest, { name: spName(wsh.species), place: placeName(wsh.target) }) : fill(WISH_LINES.restAny, { name: spName(wsh.species) }) })));
      if (v.firstWish === 1 && !now.length && !rest.length) list.append(h('li', { class: 'jn-wish k-card', attrs: { 'data-rest': 'true' } }, icon('clock'), h('span', { text: fill(WISH_LINES.firstWishRest, { place: placeName(1) }) })));
      pane.append(h('section', { class: 'jn-group', attrs: { 'aria-label': UI_TEXT.wishesNow } }, h('h3', { class: 'k-group-title', text: UI_TEXT.wishesNow }), list));
    }
    // the gift card (QUESTS 11): a ready gift lets the player pick one of three
    for (const gft of v.gifts) {
      if (gft.state === 'granted') continue;
      const list = GIFT_LISTS[gft.chapter] ?? [];
      const card = h('section', { class: 'jn-gift k-card', attrs: { 'aria-label': 'A gift' } }, h('h3', { class: 'k-group-title', text: 'A gift' }));
      const ch = CHAPTERS[gft.chapter];
      // (round 6, D-96: the place the gift's three love is the chapter's `giftPlace`, the next KEPT place; "place + 1" named the dropped Fizzwell Tub (5) after Rainleaf)
      const placeIdx = ch && typeof ch.giftPlace === 'number' ? ch.giftPlace : -1;
      const nextShipped = PLACE_INFO.find((p) => p.idx === placeIdx)?.shipped === true;
      card.append(h('p', { class: 'jn-gift-line', text: nextShipped ? fill(GIFT_LINES.loves, { place: placeName(placeIdx) }) : GIFT_LINES.unshipped }));
      if (!v.giftsAllowed) card.append(h('p', { class: 'jn-gift-line', text: GIFT_LINES.later }));
      else {
        const row = h('div', { class: 'jn-gift-row' });
        for (const sp of list) {
          const def = CATALOG.find((c) => c.id === sp);
          const b = h('button', { class: 'k-btn k-btn--glass jn-gift-pick', attrs: { type: 'button' } }, h('span', { text: def?.name ?? sp }));
          b.addEventListener('click', () => {
            b.disabled = true;
            const claim = o.game.hoard.claimGift?.(gft.chapter, sp as SpeciesId);
            if (!claim) { b.disabled = false; return; }
            void claim.then((r) => { o.say(r.ok ? fill(GIFT_LINES.ask, { name: def?.name ?? sp }).replace('?', '.') : (r as { message?: string }).message ?? GIFT_LINES.wait); render(); });
          });
          row.append(b);
        }
        card.append(row);
      }
      pane.append(card);
    }
    // the chapters that are open: Home, Hearthlog (S1), Friends Everywhere when open
    for (const ch of CHAPTERS) {
      const open = ch.place < 0 ? v.friendsOpen : (v.places & (1 << ch.place)) !== 0;
      if (!open) continue;
      const rows = QUESTS.filter((q) => q.chapter === ch.idx).map((q) => questRow(v, q.idx)).filter((x): x is HTMLElement => !!x);
      if (!rows.length) continue;
      pane.append(h('section', { class: 'jn-group', attrs: { 'aria-label': CHAPTER_TEXT[ch.idx] ?? '' } },
        h('h3', { class: 'k-group-title', text: CHAPTER_TEXT[ch.idx] ?? '' }), h('ul', { class: 'jn-quests', attrs: { role: 'list' } }, ...rows)));
    }
    return pane;
  }
  function squishiesPane(v: JournalView): HTMLElement {
    const pane = h('div', { class: 'jn-pane' });
    const owned = new Set<number>();
    try { for (const it of o.game.hoard.items()) owned.add(it.speciesIdx); } catch { /* none */ }
    const list = h('ul', { class: 'jn-tiles', attrs: { role: 'list' } });
    for (const sp of [...owned].sort((a, b) => a - b)) {
      const mask = v.facts[sp] ?? 0;
      let found = 0;
      for (let b = 0; b < 12; b++) if (mask & (1 << b)) found++;
      const name = spName(sp);
      const lines: HTMLElement[] = [];
      for (let b = 0; b < 12; b++) {
        if (!(mask & (1 << b))) continue;
        const raw = FACT_LINES.found[b] ?? '';
        if (raw.includes('{place}') || raw.includes('{thing}') || raw.includes('{friend}') || raw.includes('{line}') || raw.includes('{touch}') || raw.includes('{wish}')) lines.push(h('li', { text: b === 1 ? `${name} has a favourite place.` : b === 2 ? 'It has a favourite thing.' : b === 3 ? 'It has a best friend.' : 'Found.' }));
        else lines.push(h('li', { text: fill(raw, { name }) }));
      }
      list.append(h('li', { class: 'jn-tile k-card', attrs: { 'data-species': CATALOG[sp]?.id ?? '' } },
        h('b', { class: 'jn-tile-name', text: name }), h('span', { class: 'jn-tile-fam', text: famName(sp) }),
        h('span', { class: 'jn-tile-n', text: fill(UI_TEXT.ofN, { a: String(found), b: '12' }) }),
        lines.length ? h('ul', { class: 'jn-facts' }, ...lines) : h('p', { class: 'jn-q-hint', text: FACT_LINES.hint[0] })));
    }
    pane.append(list);
    return pane;
  }
  function friendsPane(v: JournalView): HTMLElement {
    const pane = h('div', { class: 'jn-pane' });
    if (!v.friends.length) { pane.append(h('p', { class: 'jn-lead', text: 'Bring two squishies out together and they will say hello.' })); return pane; }
    const list = h('ul', { class: 'jn-tiles', attrs: { role: 'list' } });
    for (const fr of v.friends) {
      const level = fr.best && fr.level >= 1 ? UI_TEXT.bestFriends : UI_TEXT.levels[Math.max(0, Math.min(2, fr.level - 1))];
      list.append(h('li', { class: 'jn-tile k-card' }, h('b', { class: 'jn-tile-name', text: `${spName(fr.a)} and ${spName(fr.b)}` }), h('span', { class: 'jn-tile-fam', text: level })));
    }
    pane.append(list);
    return pane;
  }
  function keepsakesPane(v: JournalView): HTMLElement {
    const pane = h('div', { class: 'jn-pane' });
    const list = h('ul', { class: 'jn-tiles', attrs: { role: 'list' } });
    KEEPSAKE_TEXT.forEach(([name, how, from], bit) => {
      const got = (v.keepsakes & (1 << bit)) !== 0;
      list.append(h('li', { class: 'jn-tile k-card', attrs: { 'data-got': String(got) } }, h('span', { class: 'jn-stamp', attrs: { 'aria-hidden': 'true' } }, got ? icon('sparkle') : icon('lock')),
        // (round 6, R6_DATA: a finale keepsake's line names its own place outright; "placeName(bit + 1)" named the NEXT place: "Ember Pinecone ... From Ripple Shore.")
        h('b', { class: 'jn-tile-name', text: got ? name : '???' }), h('span', { class: 'jn-q-hint', text: got ? from : how })));
    });
    pane.append(list);
    return pane;
  }
  function render(): void {
    const v = o.host.journal();
    for (const b of tabBtns) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    if (!v) { f.scroll.replaceChildren(h('p', { class: 'jn-lead', text: 'The Journal is getting ready.' })); return; }
    f.scroll.replaceChildren(tab === 'stamps' ? stampsPane(v) : tab === 'squishies' ? squishiesPane(v) : tab === 'friends' ? friendsPane(v) : keepsakesPane(v));
  }
  const offEvents = o.game.hoard.onEvent((e) => { if (layer.open && (e.type === 'quest' || e.type === 'fact' || e.type === 'keepsake' || e.type === 'gift' || e.type === 'friend')) render(); });
  offs.push(offEvents);
  const layer: Layer = openLayer({
    el: f.scrim, parent: o.root,
    initialFocus: () => f.title,
    returnFocus: () => (o.from && o.from.isConnected && !o.from.closest('[inert]') ? o.from : null),
    onClose: (why) => { for (const x of offs.splice(0)) x(); cue(why === 'escape' ? 'back' : 'close'); o.onClose?.(why); },
  });
  cue('open');
  render();
  if (o.at) {
    const row = f.scroll.querySelector<HTMLElement>(`[data-quest="${CSS.escape(o.at)}"]`);
    if (row) { row.dataset.at = 'true'; try { row.scrollIntoView({ block: 'center' }); } catch { /* an old browser */ } window.setTimeout(() => { delete row.dataset.at; }, 2400); }
  }
  const api: LifeScreen = { el: f.scrim, get open() { return layer.open; }, close: (why = 'code') => layer.close(why), refresh: render };
  return api;
}

/* ═══════════════════════════════════════ the Travel sheet ═══════════════════════════════════════ */
export function openTravel(o: LifeScreenOpts): LifeScreen {
  const f = frame(o, UI_TEXT.places, 'wh-travel', null);
  f.close.addEventListener('click', () => api.close('button'));
  const offs: Array<() => void> = [guardKeys()];
  function render(): void {
    const v = o.host.journal();
    const open = o.host.openPlaces();
    const here = o.host.place;
    const grid = h('ul', { class: 'jn-cards', attrs: { role: 'list' } });
    // round 6 (QUESTS 15, VERDICT_PG B10): "3 of yours love it": the owned species whose favourite place (F1) the player has FOUND and that is this place
    // (an unfound favourite is never given away)
    const fans = new Map<string, number>();
    if (v) { try { for (const sp of new Set([...o.game.hoard.items()].map((it) => it.speciesIdx))) {
      const id = CATALOG[sp]?.id, fav = id ? (SPECIES_LIFE as Readonly<Record<string, { place: string } | undefined>>)[id]?.place : undefined;
      if (fav && ((v.facts[sp] ?? 0) & (1 << FACT.PLACE)) !== 0) fans.set(fav, (fans.get(fav) ?? 0) + 1);
    } } catch { /* no shelf */ } }
    for (const p of PLACE_INFO) {
      // QUESTS 15 (round 5, VERDICT_PG B4): a place with `shipped: false` is not shown at all (no "coming soon" card, no line names it)
      if (!p.shipped) continue;
      const isOpen = (open & (1 << p.idx)) !== 0;
      const card = h('li', { class: 'jn-card k-card', attrs: { 'data-place': p.id, 'data-open': String(isOpen), 'data-sky': p.sky } });
      // (round 6, R6_RENDER 4: the postcard's picture, drawn by render/postcard.ts into this canvas once the sheet is in the DOM; the CSS sky gradient behind it is the fallback)
      card.append(h('canvas', { class: 'jn-sky', attrs: { 'aria-hidden': 'true', 'data-place': p.id } }), h('b', { class: 'jn-card-name', text: p.name }));
      const nf = fans.get(p.id) ?? 0;
      if (nf > 0) card.append(h('span', { class: 'jn-card-fans', attrs: { 'data-fans': String(nf) }, text: fill(UI_TEXT.fans, { n: String(nf) }) }));
      // its chapter's stamps ("6 of 10 stamps": the shown quests of the place's own chapter, done of shown), once the place is open
      if (v && isOpen) {
        const ch = CHAPTERS.find((c) => c.place === p.idx);
        if (ch) {
          let shown = 0, done = 0;
          for (const q of v.quests) if (q.chapter === ch.idx && q.shown) { shown++; if (q.done) done++; }
          if (shown > 0) card.append(h('span', { class: 'jn-card-stamps', attrs: { 'data-stamps': `${done}/${shown}` }, text: fill(UI_TEXT.stampsOf, { a: String(done), b: String(shown) }) }));
        }
      }
      if (p.idx === here) card.append(h('span', { class: 'jn-q-hint', text: UI_TEXT.here }));
      else if (isOpen) {
        const go = h('button', { class: 'k-btn k-btn--gel jn-go', attrs: { type: 'button', 'data-place': p.id } }, icon('arrowRight'), h('span', { text: fill(UI_TEXT.goTo, { place: p.name }) }));
        go.addEventListener('click', () => {
          go.disabled = true;
          const slow = window.setTimeout(() => o.say(UI_TEXT.packing), 300);
          void o.host.travel(p.id).then((ok) => { window.clearTimeout(slow); if (ok) api.close('code'); else { go.disabled = false; } });
        });
        card.append(go);
      } else if (typeof p.stampsToOpen === 'number') card.append(h('span', { class: 'jn-q-hint', text: fill(UI_TEXT.opensAt, { n: String(p.stampsToOpen) }) }));
      else card.append(h('span', { class: 'jn-q-hint', text: 'A wish will show the way here.' }));
      grid.append(card);
    }
    const kids: HTMLElement[] = [grid];
    if (v) kids.unshift(h('p', { class: 'jn-lead', text: fill(UI_TEXT.stampsOf, { a: String(v.stamps), b: String(v.quests.filter((q) => q.shown).length) }) }));
    f.scroll.replaceChildren(...kids);
    // the postcards' pictures (a lazy module of its own, `later-postcard`: a 2D canvas each, nothing else); a failed load keeps the gradients
    void import('../render/postcard.ts').then(({ drawPostcard }) => {
      for (const cv of f.scroll.querySelectorAll<HTMLCanvasElement>('canvas.jn-sky')) { try { if (drawPostcard(cv, cv.dataset.place ?? '')) cv.dataset.drawn = 'true'; } catch { /* the gradient stays */ } }
    }, () => { /* the gradients stay */ });
  }
  const layer: Layer = openLayer({
    el: f.scrim, parent: o.root,
    initialFocus: () => f.title,
    returnFocus: () => (o.from && o.from.isConnected && !o.from.closest('[inert]') ? o.from : null),
    onClose: (why) => { for (const x of offs.splice(0)) x(); cue(why === 'escape' ? 'back' : 'close'); o.onClose?.(why); },
  });
  cue('open');
  render();
  const api: LifeScreen = { el: f.scrim, get open() { return layer.open; }, close: (why = 'code') => layer.close(why), refresh: render };
  return api;
}
