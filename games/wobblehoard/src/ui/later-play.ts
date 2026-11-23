// PLAYGROUND round 5 (VERDICT_PG B3, B8; QUESTS.md 8 and 15, PLAYGROUND_BUILD.md 11.8 and 11.10): the play-time UI that makes purpose visible, in the kit style.
// A `later-*` chunk of its own (boot.ts loads it once the LIFE host has attached): never in the first-play download, and not in the life chunk (it is over
// its 150 KB cap, VERDICT_PG C1). It imports the screens chunk (ui/later-journal.ts) for the wish words and the Journal, and the Journal's words.
//
//   the tracker pill  "Next: Chase the yarn" (QUESTS 15, SH-20): the first unfinished main quest that can be done now (the journal's own tracker(): this place's
//                     chapter, then Home's, then Friends Everywhere's; never a hidden quest, one blocked by autonomy off, or one with no keyboard route when the
//                     last input was a key), in one short line at the top left under the top row; a tap opens the Journal at that quest; a small x hides it
//                     until the next stamp; hidden while a tool other than the Hand is in hand, a sheet, the Hoard, a ceremony or a trip is up, and while a
//                     stamp moment or a wish card uses its slot.
//   the moments       "New stamp: ..." one at a time in the same slot (the plate slot of QUESTS 15, moved to the left of the Journal column so it never covers
//                     the Journal and Places buttons, an open sheet's title or the Put back chip), 2.4 s each, waiting while a sheet, the Hoard, a modal or a
//                     ceremony is up; at most 3 waiting, more become "N new stamps"; each said once in the polite live region.
//   the wish card     a tapped wish bubble opens a small card in that slot with the wish's line ("Dollop wishes for a warm place: Hearthlog Cabin.") and, for a
//                     place that is open and not here, "Let's go" (the Travel sheet's own path) and "Not now"; Esc or "Not now" closes it.
//   the party popover "Your squishies" (the name tag's popover, 11.8): a tap on the name tag or the column's button opens it; a chip per squishy out (the keyboard
//                     player addresses each one here) and "Go play with..." the things of the place (the host's playWith: LIFE's PLAY_WITH, which works with
//                     autonomy off; a ride is reached by physics' carryTo, never paid).
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { attachTooltip } from './tooltip.ts';
import { cue } from './uiSound.ts';
import { wishLine } from './later-journal.ts';
import { attachPartyStrip } from './later-party.ts';
import { attachRoomHints } from './later-room.ts';
import { attachCutChips } from './later-cutchips.ts';
import { chipLabel, chipsGroup, chipsLead, wholeOf } from '../shell/cutText.ts';
import type { LifeHostApi } from '../shell/lifeLink.ts';
import type { Game } from '../shell/game.ts';
import { CATALOG } from '../data/catalog.ts';
import { PLACE_INFO } from '../data/places.ts';
import { CHAPTERS, EV, QUESTS } from '../data/quests.ts';
import { QUEST_TEXT, THING_TEXT, UI_TEXT, WISH_LINES, fill } from '../data/journal_text.ts';
import { WISH_KIND } from '../data/life.ts';
import './play.css';

export interface PlayUiOpts {
  root: HTMLElement;
  host: LifeHostApi;
  game: Game;
  /** the polite live region */
  say(text: string): void;
  /** open the Journal (at a quest id when given); the opener gets the focus back */
  openJournal(from?: HTMLElement, at?: string): void;
  /** round 6: open the Places sheet (the pill's "go there" for a place that has just opened); the opener gets the focus back */
  openTravel?(from?: HTMLElement): void;
}
export interface PlayUi {
  /** a quest moment ("New stamp: ...") or another short moment line; `said`: already said in the live region (the moment only shows it) */
  moment(text: string, said?: boolean): void;
  /** a tapped wish bubble: the card (opened by a key: the focus goes into it) */
  showWish(species: number, kind: number, target: number, byKey?: boolean): void;
  /** the party popover (from the name tag or the column's button) */
  openParty(from?: HTMLElement | null): void;
  /** the tracker's text now ('' while hidden): the harness reads it */
  readonly trackerText: string;
  destroy(): void;
}

const MOMENT_MS = 2400, MOMENT_GAP_MS = 200, MOMENT_MAX = 3, WISH_MS = 12000;
const spName = (sp: number): string => CATALOG[sp]?.name ?? 'A squishy';
const thingName = (id: string): string => (THING_TEXT as Readonly<Record<string, readonly [string, string]>>)[id]?.[0] ?? id;

export function attachPlayUi(o: PlayUiOpts): PlayUi {
  const { host, game } = o;
  const offs: Array<() => void> = [];
  const hud = document.querySelector<HTMLElement>('.hud') ?? o.root;
  const lifeCol = document.querySelector<HTMLElement>('.hud-life');
  // ---- the slot (top left, under the top row, left of the Journal column): the pill, a moment or a wish card, one at a time ----
  const slot = h('div', { class: 'pl-slot' });
  // the pill: [book + "Next: ..."] [x]
  const pillText = h('span', { class: 'pl-pill-text' });
  const pillGo = h('button', { class: 'k-btn k-btn--sm k-glass pl-pill-go', attrs: { type: 'button', 'data-sound': 'open' } }, icon('book'), pillText);
  const pillX = h('button', { class: 'k-btn k-iconbtn k-btn--sm pl-pill-x', attrs: { type: 'button', 'aria-label': 'Hide the next stamp' } }, icon('close'));
  const pill = h('div', { class: 'pl-pill', attrs: { role: 'group', 'aria-label': 'Next stamp', hidden: '' } }, pillGo, pillX);
  // a moment (aria-hidden: the live region says it once)
  const momentEl = h('div', { class: 'pl-moment k-card', attrs: { 'aria-hidden': 'true', hidden: '' } });
  // the wish card
  const wishText = h('p', { class: 'pl-wish-text', attrs: { id: 'pl-wish-text' } });
  const wishGo = h('button', { class: 'k-btn k-btn--sm k-btn--gel pl-wish-go', attrs: { type: 'button' } }, icon('arrowRight'), h('span', { text: WISH_LINES.go }));
  const wishNo = h('button', { class: 'k-btn k-btn--sm pl-wish-no', attrs: { type: 'button' } }, h('span', { text: WISH_LINES.notNow }));
  const wishCard = h('section', { class: 'pl-wish k-card', attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pl-wish-text', hidden: '' } },
    h('span', { class: 'pl-wish-icon', attrs: { 'aria-hidden': 'true' } }, icon('star')), wishText, h('div', { class: 'pl-wish-row' }, wishGo, wishNo));
  slot.append(pill, momentEl, wishCard);
  hud.insertBefore(slot, lifeCol ?? hud.firstChild);   // (DOM order = the Tab order: the pill before the Journal column, both before Full screen)
  offs.push(() => slot.remove());

  /** something covers the play view now (a sheet, a modal, the Menu, Settings, the Hoard, a ceremony, a trip, another phase) */
  const covered = (): boolean => {
    const b = document.body.dataset;
    return game.phase !== 'play' || b.ceremony !== undefined || b.hoard === 'open' || b.hoard === 'card' || host.travelling
      || !!document.querySelector('[data-journal], .k-scrim:not([hidden]), .k-modal:not([hidden]), .panel[data-open="true"], #wh-menu:not([hidden])');
  };
  const handTool = (): boolean => (document.body.dataset.tool ?? 'hand') === 'hand';

  // ---- the moments queue ----
  const queue: string[] = [];
  const quietQ = new Set<string>();   // (round 6: moments already said in the live region, a place that opened: shown, not said twice)
  let momentUntil = 0, extra = 0;
  const moment = (text: string, said = false): void => {
    if (queue.length >= MOMENT_MAX) { extra++; return; }
    queue.push(text);
    if (said) quietQ.add(text);
    pump();
  };
  const pump = (): void => {
    const t = performance.now();
    if (t < momentUntil) return;
    if (!momentEl.hidden) { momentEl.hidden = true; momentUntil = t + MOMENT_GAP_MS; layoutSlot(); return; }
    if (!queue.length || covered() || !wishCard.hidden) return;
    let text = queue.shift()!;
    if (!queue.length && extra > 0) { text = fill(UI_TEXT.newStamps, { n: String(extra + 1) }); extra = 0; }
    momentEl.replaceChildren(h('span', { class: 'pl-moment-icon', attrs: { 'aria-hidden': 'true' } }, icon('stamp')), h('span', { class: 'pl-moment-text', text }));
    momentEl.hidden = false;
    momentUntil = t + MOMENT_MS;
    try { cue('toast'); } catch { /* sound off */ }
    if (!quietQ.delete(text)) o.say(text);
    layoutSlot();
  };

  // ---- the tracker pill ----
  let lastKey = false, trackIdx = -1, dismissed = -2, trackerText = '';
  const onKey = (e: KeyboardEvent): void => { if (e.key !== 'Shift' && e.key !== 'Tab') lastKey = true; };
  const onPtr = (): void => { lastKey = false; };
  window.addEventListener('keydown', onKey, true); window.addEventListener('pointerdown', onPtr, true);
  offs.push(() => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPtr, true); });
  // (round 6: while the pill points the way to a place that opened and was never visited, a tap opens the Places sheet, where its postcard says "Go to ...")
  pillGo.addEventListener('click', () => { const q = QUESTS[trackIdx]; if (trackGo && o.openTravel) o.openTravel(pillGo); else o.openJournal(pillGo, q?.id); });
  pillX.addEventListener('click', () => { dismissed = trackIdx; pill.hidden = true; o.say('The next stamp is hidden until a new one comes.'); layoutSlot(); });
  // round 6 (QUESTS 7 / 15, "how each place opens ... with the tracker pointing the way"): at Home (or where nothing of the place's own chapter is left to do now),
  // a place that opened by stamps and was never visited comes first: its chapter's VISIT quest ("Next: Sand and sea", whose hint is "Go to Ripple Shore."), shown,
  // open and not done; the journal's own tracker() only offers quests that can be done HERE, so a VISIT of another place never showed. Its tap opens the Places
  // sheet. Once there (the VISIT done) that place's chapter takes over; in a place, its own chapter keeps the pill.
  let trackGo = false;
  const visitNext = (v: NonNullable<ReturnType<typeof host.journal>>): number => {
    if (!o.openTravel) return -1;   // (a VISIT is keyboard-complete, K: the pill's Enter opens Places as a tap does)
    const open = host.openPlaces();
    for (const p of PLACE_INFO) {
      // (a place that opens BY STAMPS: the cabin opens with the first wish, whose own card says "Let's go"; its pill stays the Journal's, as published)
      if (!p.shipped || typeof p.stampsToOpen !== 'number' || p.stampsToOpen <= 0 || p.idx === host.place || (open & (1 << p.idx)) === 0) continue;
      for (const qd of QUESTS) {
        if (qd.dropped || qd.kind !== 'main' || CHAPTERS[qd.chapter]?.place !== p.idx || !qd.clauses.some((c) => c.ev === EV.VISIT && c.place === p.idx)) continue;
        const qv = v.quests[qd.idx];
        if (qv && qv.shown && qv.open && !qv.done) return qd.idx;
      }
    }
    return -1;
  };
  const refreshTracker = (): void => {
    let idx = -1, go = false;
    try { const v = host.journal(); if (v) {
      const here = v.tracker(host.place, lastKey, game.settings.autonomy), hereOwn = here >= 0 && CHAPTERS[QUESTS[here]?.chapter ?? -1]?.place === host.place;
      if (host.place === 0 || !hereOwn) { idx = visitNext(v); go = idx >= 0; }
      if (!go) idx = here;
    } if (idx >= 0 && v) {
      const qv = v.quests[idx], title = QUEST_TEXT[idx]?.[0] ?? '';
      // (round 7: the count is one unit, kept on the title's line by its dot: a phone's two-line pill broke "· 0 of" / "2"; now "... watchers ·" / "0 of 2")
      const count = qv && qv.need > 1 && !qv.done ? `\u00a0· ${fill(UI_TEXT.ofN, { a: String(Math.min(qv.have, qv.need)), b: String(qv.need) }).replace(/ /g, '\u00a0')}` : '';
      const text = title ? `Next: ${title}${count}` : '';
      if (text !== trackerText || go !== trackGo) { trackerText = text; pillText.textContent = text; pillGo.setAttribute('aria-label', `Next stamp: ${title}${count}. ${go ? 'Open Places' : 'Open the Journal'}`); }
    } } catch { idx = -1; go = false; }
    trackGo = go;
    if (idx !== trackIdx) { trackIdx = idx; if (dismissed !== idx) dismissed = -2; }
  };
  // (it also steps aside while a toast shows: the toast stack is the top centre, and on a phone it spans the slot)
  const toastUp = (): boolean => !!document.querySelector('.toasts > .k-toast:not([hidden])');
  // (round 6: not in the 200 ms gap between two queued moments either: it flashed there)
  const showPill = (): boolean => trackIdx >= 0 && !!trackerText && dismissed !== trackIdx && handTool() && !covered() && momentEl.hidden && queue.length === 0 && wishCard.hidden && document.body.dataset.layout !== 'tiny' && !toastUp();

  // ---- the wish card ----
  let wishUntil = 0, wishPlace: string | null = null, wishFrom: Element | null = null;
  const closeWish = (back = false): void => {
    if (wishCard.hidden) return;
    wishCard.hidden = true; wishPlace = null;
    if (back && wishFrom instanceof HTMLElement && wishFrom.isConnected) wishFrom.focus();
    wishFrom = null;
    layoutSlot();
  };
  wishNo.addEventListener('click', () => closeWish(true));
  wishGo.addEventListener('click', () => {
    const id = wishPlace;
    closeWish(false);
    if (!id) return;
    const slow = window.setTimeout(() => o.say(UI_TEXT.packing), 300);
    void host.travel(id).then(() => window.clearTimeout(slow), () => window.clearTimeout(slow));
  });
  const showWish = (species: number, kind: number, target: number, byKey = false): void => {
    const line = wishLine(species, kind, target);
    wishText.textContent = line;
    const p = kind === WISH_KIND.PLACE ? PLACE_INFO.find((x) => x.idx === target) : undefined;
    const canGo = !!p && p.shipped && p.idx !== host.place && (host.openPlaces() & (1 << p.idx)) !== 0;
    wishPlace = canGo ? p!.id : null;
    wishGo.hidden = !canGo;
    if (canGo) wishGo.setAttribute('aria-label', `${WISH_LINES.go}: ${fill(UI_TEXT.goTo, { place: p!.name })}`); else wishGo.removeAttribute('aria-label');
    momentEl.hidden = true;
    wishFrom = document.activeElement;
    wishCard.hidden = false;
    wishUntil = performance.now() + WISH_MS;
    o.say(line);
    layoutSlot();
    if (byKey) (canGo ? wishGo : wishNo).focus();
  };
  const onWishKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !wishCard.hidden && (wishCard.contains(document.activeElement) || !covered())) { e.stopPropagation(); e.preventDefault(); closeWish(true); }
  };
  window.addEventListener('keydown', onWishKey, true);
  offs.push(() => window.removeEventListener('keydown', onWishKey, true));
  const onDownAway = (e: PointerEvent): void => { if (!wishCard.hidden && !wishCard.contains(e.target as Node)) closeWish(false); };
  window.addEventListener('pointerdown', onDownAway, true);
  offs.push(() => window.removeEventListener('pointerdown', onDownAway, true));

  // ---- the party popover ("Your squishies": the name tag's popover) ----
  const partyBtn = h('button', { class: 'k-btn k-iconbtn hud-life-btn dock-party', attrs: { type: 'button', 'aria-label': 'Your squishies', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' } }, icon('user'));
  offs.push(attachTooltip(partyBtn, 'Your squishies', { place: 'below' }).destroy);
  if (lifeCol) { lifeCol.append(partyBtn); offs.push(() => partyBtn.remove()); }
  const popTitle = h('h2', { class: 'pl-pop-title', attrs: { id: 'pl-pop-title' }, text: 'Your squishies' });
  const popClose = h('button', { class: 'k-btn k-iconbtn k-btn--sm pl-pop-close', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close'));
  const popWho = h('div', { class: 'k-chips pl-pop-who', attrs: { role: 'group', 'aria-label': 'Who' } });
  const popThings = h('div', { class: 'pl-pop-things', attrs: { role: 'group', 'aria-label': UI_TEXT.goPlay } });
  const pop = h('section', { class: 'pl-pop k-card', attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pl-pop-title', hidden: '' } },
    h('header', { class: 'pl-pop-head' }, popTitle, popClose), popWho, h('p', { class: 'pl-pop-label', text: UI_TEXT.goPlay }), popThings);
  o.root.append(pop);
  offs.push(() => pop.remove());
  let popFrom: HTMLElement | null = null, who = '';
  const closeParty = (back = true): void => {
    if (pop.hidden) return;
    pop.hidden = true; partyBtn.setAttribute('aria-expanded', 'false');
    if (back && popFrom && popFrom.isConnected) popFrom.focus();
    popFrom = null;
  };
  popClose.addEventListener('click', () => closeParty(true));
  const renderParty = (): void => {
    const party = host.partyNow?.() ?? [];
    if (!party.some((p) => p.itemId === who)) who = party.find((p) => p.play)?.itemId ?? party[0]?.itemId ?? '';
    popWho.replaceChildren(...party.map((p) => {
      const b = h('button', { class: 'k-chip pl-pop-chip', attrs: { type: 'button', 'aria-pressed': String(p.itemId === who), 'data-item': p.itemId } }, h('span', { text: spName(p.species) }));
      b.addEventListener('click', () => { who = p.itemId; renderParty(); (popWho.querySelector(`[data-item="${CSS.escape(who)}"]`) as HTMLElement | null)?.focus(); });
      return b;
    }));
    const me = party.find((p) => p.itemId === who);
    const things = host.thingsNow?.() ?? [];
    popThings.replaceChildren(...things.map((t) => {
      const name = thingName(t.id);
      const b = h('button', { class: 'k-btn k-btn--sm pl-pop-thing', attrs: { type: 'button', 'data-thing': t.id } }, h('span', { text: name }));
      b.addEventListener('click', () => {
        const ok = !!me && host.playWith?.(me.itemId, t.k) === true;
        o.say(ok ? `${spName(me!.species)} goes to play with the ${name}.` : `${me ? spName(me.species) : 'It'} can't play with that right now.`);
        if (ok) closeParty(true);
      });
      return b;
    }));
    if (!things.length) popThings.append(h('p', { class: 'pl-pop-none', text: 'Nothing to play with here yet.' }));
  };
  const placePop = (): void => {
    const tag = document.querySelector<HTMLElement>('.nametag');
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const r = tag?.getBoundingClientRect();
    const w = Math.min(340, vw - 32);
    pop.style.width = `${w}px`;
    if (r && r.width > 0) { pop.style.left = `${Math.max(16, Math.min(vw - w - 16, r.left))}px`; pop.style.bottom = `${Math.max(16, vh - r.top + 8)}px`; pop.style.top = ''; }
    else { pop.style.left = `${(vw - w) / 2}px`; pop.style.bottom = '96px'; pop.style.top = ''; }
  };
  const openParty = (from?: HTMLElement | null): void => {
    if (!pop.hidden) { closeParty(true); return; }
    if (covered()) return;
    closeWish(false);
    popFrom = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    renderParty();
    placePop();
    pop.hidden = false; partyBtn.setAttribute('aria-expanded', 'true');
    (popWho.querySelector('[aria-pressed="true"]') as HTMLElement | null ?? popClose).focus();
    cue('open');
  };
  partyBtn.addEventListener('click', () => openParty(partyBtn));
  const tag = document.querySelector<HTMLElement>('.nametag');
  const onTag = (): void => { if (handTool()) openParty(tag); };
  if (tag) { tag.addEventListener('click', onTag); tag.dataset.party = 'true'; offs.push(() => { tag.removeEventListener('click', onTag); delete tag.dataset.party; }); }
  const onPopKey = (e: KeyboardEvent): void => {
    if (pop.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeParty(true); return; }
    // the game's single-letter keys must not act while a control of the popover has the focus (the keyboard's own rule for controls covers buttons)
  };
  window.addEventListener('keydown', onPopKey, true);
  offs.push(() => window.removeEventListener('keydown', onPopKey, true));
  const onPopAway = (e: PointerEvent): void => { if (!pop.hidden && !pop.contains(e.target as Node) && !partyBtn.contains(e.target as Node) && !(tag && tag.contains(e.target as Node))) closeParty(false); };
  window.addEventListener('pointerdown', onPopAway, true);
  offs.push(() => window.removeEventListener('pointerdown', onPopAway, true));

  // ---- one 250 ms tick: the slot's contents and the popover's visibility ----
  function layoutSlot(): void {
    const show = showPill();
    if (pill.hidden === show) pill.hidden = !show;
  }
  let tick = 0;
  const timer = window.setInterval(() => {
    if (++tick % 4 === 0) refreshTracker();
    if (!wishCard.hidden && (performance.now() > wishUntil && !wishCard.contains(document.activeElement) || covered())) closeWish(false);
    if (!pop.hidden && (covered() || !handTool())) closeParty(false);
    pump();
    layoutSlot();
    partyBtn.hidden = covered() && pop.hidden;
  }, 250);
  offs.push(() => window.clearInterval(timer));
  const offEv = game.hoard.onEvent((e) => { if (e.type === 'quest' || e.type === 'unlock') { dismissed = -2; refreshTracker(); } });
  offs.push(offEv);
  refreshTracker();
  layoutSlot();
  // R10_PLAYUX item 2: the Friends strip beside the name tag (ui/later-party.ts, in this chunk)
  const friends = attachPartyStrip({ game, root: o.root, say: o.say, covered });
  offs.push(() => friends.destroy());
  // D-103: "Reconnect one": a chip per cut squishy in the Cut bar while two or more are in pieces (ui/later-cutchips.ts, in this chunk; the words are cutText.ts's)
  const cutChips = attachCutChips({ game, labels: { group: chipsGroup, lead: chipsLead, chip: chipLabel, whole: wholeOf }, say: o.say });
  offs.push(() => cutChips.destroy());
  // round 14 (R14_ROOMS): the room camera's edge chips: a squishy out of view, a tap brings the camera to it (ui/later-room.ts, in this chunk)
  const roomHints = attachRoomHints({ game, root: o.root, say: o.say, covered });
  offs.push(() => roomHints.destroy());

  return {
    moment,
    showWish,
    openParty,
    get trackerText() { return pill.hidden ? '' : trackerText; },
    destroy() { for (const f of offs.splice(0)) { try { f(); } catch { /* gone */ } } },
  };
}
