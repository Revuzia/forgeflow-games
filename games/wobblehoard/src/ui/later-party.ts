// R10_PLAYUX item 2 (owner, 2026-11-19: "there needs to be an easier way to take out squishies for them to play together"): the FRIENDS strip of the
// play screen. Part of the later-play chunk (ui/later-play.ts imports it), so the first-play download does not grow.
//
//   the strip   in the info row right after the name tag: the friends out now (small overlapping faces, at most 4 and "+N") and a labelled "Friends" button
//               with a plus. ONE button (one Tab stop); a tap opens the picker. Shown once the player owns a second squishy, with the Hand in hand and nothing
//               covering the play view; never in the tiny layout (no name tag there). It steps to icon-only (and drops the faces) when the row has no room,
//               so it never reaches the dock or the ring (measured each tick).
//   the picker  a small card over the strip: "Friends out to play" + "2 of 3"; "Bring friends" (one tap fills the party to the cap with the squishies played
//               with most recently, then the hearted, then the newest); a chip per owned species (the copy out, else the one played last, else the hearted,
//               else the newest): tap to take it out, tap one that is out to send it back; the one you play with is marked and stays. The mat's own rules
//               decide (the tier's cap and the frame-time guard, mat.ts): a refusal is said in words in the card and in the live region, never a silent no-op.
//   taps        from the play screen: a second squishy out in 2 taps (Friends, a face), three in 3 (or 2 with Bring friends when the cap allows 3).
import type { Game } from '../shell/game.ts';
import type { HoardItem } from '../collection/types.ts';
import { bringCandidates, bringFriends, joinNames, pickOrder, refusalLine, toggleOut } from './partyPick.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { speciesIcon } from './speciesIcon.ts';
import { cue } from './uiSound.ts';
import './party.css';

export interface PartyStrip { open(from?: HTMLElement | null): void; readonly shown: boolean; destroy(): void }
export interface PartyOpts {
  game: Game;
  root: HTMLElement;
  say(text: string): void;
  /** something covers the play view (later-play's own rule) */
  covered(): boolean;
}

const FACES = 4;

export function attachPartyStrip(o: PartyOpts): PartyStrip {
  const g = o.game;
  const offs: Array<() => void> = [];
  const faces = h('span', { class: 'pt-faces', attrs: { 'aria-hidden': 'true' } });
  const label = h('span', { class: 'pt-label', text: 'Friends' });
  const btn = h('button', { class: 'k-btn k-glass pt-btn', attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-sound': 'open' } },
    faces, h('span', { class: 'pt-plus', attrs: { 'aria-hidden': 'true' } }, icon('plus')), label);
  const strip = h('div', { class: 'pt-strip', attrs: { hidden: '' } }, btn);
  const bottom = document.querySelector<HTMLElement>('.hud-bottom');
  const tag = bottom?.querySelector<HTMLElement>('.nametag') ?? null;
  if (bottom) { if (tag && tag.nextSibling) bottom.insertBefore(strip, tag.nextSibling); else bottom.append(strip); } else o.root.append(strip);
  offs.push(() => strip.remove());

  // ---- the picker ----
  const title = h('h2', { class: 'pt-title', attrs: { id: 'pt-title' }, text: 'Friends out to play' });
  const count = h('span', { class: 'pt-count' });
  const close = h('button', { class: 'k-btn k-iconbtn k-btn--sm pt-close', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close'));
  const bring = h('button', { class: 'k-btn k-btn--sm k-gel pt-bring', attrs: { type: 'button' } }, icon('user'), h('span', { text: 'Bring friends' }));
  const chips = h('div', { class: 'k-chips pt-chips', attrs: { role: 'group', 'aria-label': 'Your squishies' } });
  const note = h('p', { class: 'pt-note', attrs: { hidden: '' } });
  const card = h('section', { class: 'pt-card k-card', attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'pt-title', hidden: '' } },
    h('header', { class: 'pt-head' }, title, count, close), bring, chips, note);
  o.root.append(card);
  offs.push(() => card.remove());

  const playId = (): string | null => g.identity.itemId;
  const outIds = (): string[] => { const p = playId(); return [...(p ? [p] : []), ...g.mat.itemIds]; };
  /** one copy per owned species, in a stable order for this opening (partyPick.ts: the ones out first, then the most recently played, the hearted, the newest) */
  let order: HoardItem[] = [];
  const setNote = (t: string): void => { note.textContent = t; note.hidden = !t; };
  const renderCard = (): void => {
    const out = new Set(outIds()), lim = g.mat.limit, n = g.mat.count;
    count.textContent = `${n} of ${lim}`;
    count.setAttribute('aria-label', `${n} of ${lim} out`);
    const room = n < lim, cand = room ? bringCandidates(g) : [];
    bring.hidden = cand.length === 0;
    bring.setAttribute('aria-label', `Bring friends: ${Math.min(cand.length, lim - n)} more come out to play`);
    chips.replaceChildren(...order.map((it) => {
      const isOut = out.has(it.id), isPlay = it.id === playId();
      const b = h('button', { class: 'k-chip pt-chip', attrs: { type: 'button', 'data-item': it.id, 'data-species': it.species, 'aria-pressed': String(isOut),
        'aria-label': isPlay ? `${it.name}, the one you play with` : isOut ? `${it.name}, out: send back` : `${it.name}: take out` } },
      speciesIcon(it.species, { cls: 'sp-icon pt-chip-icon' }), h('span', { class: 'pt-chip-name', text: it.name }), isOut ? h('span', { class: 'pt-chip-mark', attrs: { 'aria-hidden': 'true' } }, icon('check')) : null);
      if (isPlay) { b.setAttribute('aria-disabled', 'true'); b.dataset.play = 'true'; b.title = 'The one you play with'; }
      b.addEventListener('click', () => toggle(it));
      return b;
    }));
  };
  function toggle(it: HoardItem): void {
    const t = toggleOut(g, it);
    if (t.play) { setNote(`${it.name} is the one you play with.`); return; }
    if (t.refused) { const line = refusalLine(t.refused, g.mat.limit); setNote(line); o.say(line); try { cue('error'); } catch { /* sound off */ } }
    else if (t.out) { o.say(`${it.name} came out to play (${g.mat.count} of ${g.mat.limit}).`); setNote(''); }
    else { o.say(`${it.name} went back to the shelf.`); setNote(''); }
    renderCard(); renderStrip();
    (chips.querySelector(`[data-item="${CSS.escape(it.id)}"]`) as HTMLElement | null)?.focus();
  }
  bring.addEventListener('click', () => {
    const { came, why } = bringFriends(g);
    const line = came.length ? `${joinNames(came)} came out to play.` : refusalLine(why ?? 'full', g.mat.limit);
    o.say(line); setNote(came.length ? '' : line);
    renderCard(); renderStrip();
    if (came.length) closeCard(true);
  });

  const placeCard = (): void => {
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    const r = btn.getBoundingClientRect(), w = Math.min(360, vw - 32);
    card.style.width = `${w}px`;
    card.style.left = `${Math.max(16, Math.min(vw - w - 16, r.left))}px`;
    card.style.bottom = `${Math.max(16, vh - r.top + 8)}px`;
    card.style.maxHeight = `${Math.max(160, Math.min(440, r.top - 8 - 72))}px`;   // (clear of the top row)
  };
  let from: HTMLElement | null = null;
  function closeCard(back: boolean): void {
    if (card.hidden) return;
    card.hidden = true; btn.setAttribute('aria-expanded', 'false'); setNote('');
    if (back && from && from.isConnected) from.focus();
    from = null;
  }
  function openCard(f?: HTMLElement | null): void {
    if (!card.hidden) { closeCard(true); return; }
    if (o.covered()) return;
    from = f ?? btn;
    order = pickOrder(g);
    renderCard();
    placeCard();
    card.hidden = false; btn.setAttribute('aria-expanded', 'true');
    ((bring.hidden ? chips.querySelector<HTMLElement>('.pt-chip:not([data-play])') : bring) ?? close).focus();
    try { cue('open'); } catch { /* sound off */ }
  }
  btn.addEventListener('click', () => openCard(btn));
  close.addEventListener('click', () => closeCard(true));
  const onKey = (e: KeyboardEvent): void => { if (!card.hidden && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeCard(true); } };
  window.addEventListener('keydown', onKey, true);
  offs.push(() => window.removeEventListener('keydown', onKey, true));
  const onAway = (e: PointerEvent): void => { if (!card.hidden && !card.contains(e.target as Node) && !strip.contains(e.target as Node)) closeCard(false); };
  window.addEventListener('pointerdown', onAway, true);
  offs.push(() => window.removeEventListener('pointerdown', onAway, true));

  // ---- the strip: who is out, and room for it in the row ----
  let key = '';
  function renderStrip(): void {
    const ids = g.mat.itemIds, k = ids.join(',');
    if (k !== key) {
      key = k;
      const shown = ids.slice(0, FACES);
      faces.replaceChildren(...shown.map((id) => { const it = g.hoard.item(id); return h('span', { class: 'pt-face' }, speciesIcon(it?.species ?? 'dollop', { cls: 'sp-icon pt-face-icon' })); }),
        ...(ids.length > FACES ? [h('span', { class: 'pt-face pt-more', text: `+${ids.length - FACES}` })] : []));
      const names = ids.map((id) => g.hoard.item(id)?.name ?? 'A squishy');
      btn.dataset.out = String(ids.length);
      btn.setAttribute('aria-label', ids.length ? `Friends out to play: ${joinNames(names)}. Take more out or send one back` : 'Friends: take squishies out to play together');
    }
  }
  const fits = (): boolean => {
    const r = strip.getBoundingClientRect();
    if (!(r.width > 0)) return true;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    for (const sel of ['#wh-dock .dock-bar', '.meter-cluster']) {
      const e = document.querySelector<HTMLElement>(sel);
      if (!e) continue;
      const q = e.getBoundingClientRect();
      if (q.width > 0 && !(r.right + 6 <= q.left || q.right + 6 <= r.left || r.bottom <= q.top || q.bottom <= r.top)) return false;
    }
    return r.right <= vw - 4;
  };
  const tick = (): void => {
    const owned = (() => { try { return new Set(g.hoard.items().map((it) => it.species)).size; } catch { return 0; } })();
    const hand = (document.body.dataset.tool ?? 'hand') === 'hand';
    const show = g.phase === 'play' && owned >= 2 && hand && !o.covered() && document.body.dataset.layout !== 'tiny';
    if (strip.hidden === show) strip.hidden = !show;
    if (!show) { closeCard(false); return; }
    renderStrip();
    // the room: full (faces + plus + "Friends") -> no faces -> the plus alone, until it clears the dock and the ring
    let form = 'full';
    strip.dataset.form = form;
    if (!fits()) { form = 'nofaces'; strip.dataset.form = form; if (!fits()) { form = 'icon'; strip.dataset.form = form; } }
    if (!card.hidden) placeCard();
  };
  const timer = window.setInterval(tick, 250);
  offs.push(() => window.clearInterval(timer));
  const offMat = g.mat.onChange(() => { renderStrip(); if (!card.hidden) renderCard(); });
  offs.push(offMat);
  tick();

  return {
    open: openCard,
    get shown() { return !strip.hidden; },
    destroy() { for (const f of offs.splice(0)) { try { f(); } catch { /* gone */ } } },
  };
}
