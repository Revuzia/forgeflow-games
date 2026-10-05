// BLOCKTOOTH VS — the CARD RAIL step (vs_design.md §7; lane B-TITAN owns this file). Solo never calls it (solo drafts go
// through the modal draft screen + the sim freeze).
//
// Called by core/world.ts stepWorldN, in VS mode only, once per active seat with that seat BOUND (w.cur = slot, w.upgrades /
// w.titan / w.input are that player's), immediately BEFORE stepUpgrades, in slot order. By then this tick's stepPickups has
// already granted level-ups (`upgrades.pendingDrafts` is current).
//
// STATE (all of it lives in the sim, so every peer holds the same rail and a late joiner replays into it):
//   * the offer          = `upgrades.offer` (string[] | null), exactly as the modal draft uses it (draft.ts rollOffer /
//                          pickUpgrade / rerollOffer work on it unchanged)
//   * the rail's timing  = `PlayerState.rail`: open, openedT, expireT (the 12 s auto-pick), chest, seq, openingDone, data
//   * owed drafts        = `upgrades.pendingDrafts` (level-ups on the VS cadence, decided in titansim addXp) + `chestDrafts`
//                          (a PUBLIC TENDER's top bidder; the offer is then rare+)
//
// INPUT: `TitanInput.railPick` 1..3 (index into the open offer) and `railReroll` arrive on ANY tick (they are the 4th input
// byte on the wire); the sim never pauses. They are EDGES: stepRail clears them from the player's latched input after reading
// (it swaps in a copy), so a repeated "keep previous input" frame for a late guest can never pick twice. A pick / reroll
// sent on the tick an offer opens is ignored (the player had not seen it); the next tick's counts.
//
// ONE TICK, in this order (deterministic; only w.t and w.rng.loot are read):
//   1. consume this tick's reroll / pick against the offer that was already open at the start of the tick
//   2. auto-pick when w.t >= rail.expireT (the autopick.ts scorer = the bot's choice)
//   3. open the next owed offer (opening card first, then drafts owed): an offer made only of OVERFLOW rewards has nothing to
//      choose, so it is filed at once (draft.ts overflowAutoPick), like the solo UI does
// Events (stamped p = this seat): `railOffer {cards, chest}` when an offer opens or is rerolled, `railPick {id, auto}` on
// every pick. Banish / lock have no input in VS (VS.rail.banish / lock = false): the UI hides them.
//
// Not here: the 3 s minimum a reroll leaves on the clock is `REROLL_MIN_LEFT_S` below (a reroll at 11.9 s must not auto-pick
// 0.1 s later).

import type { World } from '../core/types.ts';
import { VS } from '../core/config.ts';
import { overflowAutoPick, pickUpgrade, rerollOffer, rollOffer, hasPendingDraft } from './draft.ts';
import { autoPickCard } from './autopick.ts';

/** after a reroll the offer stays up at least this long (s) */
export const REROLL_MIN_LEFT_S = 3;

function closeRail(w: World): void {
  const R = w.pl.rail;
  R.open = false; R.openedT = -1; R.expireT = Infinity; R.chest = false;
}

/** Consume the one pick; returns true if a draft was actually spent (a stale / unappliable id spends none). */
function takeCard(w: World, id: string, auto: boolean): boolean {
  const U = w.upgrades;
  const owed0 = U.pendingDrafts + U.chestDrafts;
  pickUpgrade(w, id);
  const spent = U.pendingDrafts + U.chestDrafts < owed0;
  closeRail(w);
  if (spent) w.events.push({ type: 'railPick', id, auto });
  else U.offer = null;                       // stale offer (the card became unavailable): the next owed offer re-rolls it
  return spent;
}

export function stepRail(w: World): void {
  const P = w.pl, R = P.rail, U = w.upgrades;

  // the opening card (vs_design §7 "pre-match pick"): one extra owed draft per seat, taken during the countdown
  if (!R.openingDone) {
    R.openingDone = true;
    if (VS.rail.openingCard) U.pendingDrafts++;
  }

  // ── 1. input edges ──
  let pick = 0, reroll = false;
  const I = w.input;
  if ((I.railPick !== undefined && I.railPick !== 0) || I.railReroll) {
    pick = Math.floor(Number.isFinite(I.railPick as number) ? (I.railPick as number) : 0);
    reroll = !!I.railReroll;
    const clean = { ...I, railPick: 0, railReroll: false };   // edges consumed: a repeated frame cannot act twice
    P.input = clean; w.input = clean;
  }
  if (R.open && (!U.offer || U.offer.length === 0)) closeRail(w);   // the offer vanished under us
  const wasOpen = R.open && !!U.offer && U.offer.length > 0;
  if (wasOpen) {
    const offer = U.offer as string[];
    if (reroll && U.rerolls > 0) {
      const next = rerollOffer(w);
      if (next) {
        R.expireT = Math.max(R.expireT, w.t + REROLL_MIN_LEFT_S);
        w.events.push({ type: 'railOffer', cards: next.slice(), chest: R.chest });
      }
    } else if (pick >= 1 && pick <= offer.length) {
      takeCard(w, offer[pick - 1], false);
    }
  }

  // ── 2. auto-pick ──
  if (R.open && U.offer && U.offer.length > 0 && w.t >= R.expireT) {
    takeCard(w, autoPickCard(w, U.offer), true);
  }

  // ── 3. open the next owed offer ──
  if (!R.open && !U.offer && hasPendingDraft(w)) {
    const chest = U.pendingDrafts <= 0 && U.chestDrafts > 0;
    const ids = rollOffer(w, chest);
    if (ids.length > 0) {
      const ovf = overflowAutoPick(w, ids);
      if (ovf !== null) {
        R.chest = chest;
        R.seq++;
        takeCard(w, ovf, true);            // nothing new to file: no rail, the reward is paid and stamped
      } else {
        R.open = true; R.openedT = w.t; R.expireT = w.t + VS.rail.autoPickS; R.chest = chest;
        R.seq++;
        w.events.push({ type: 'railOffer', cards: ids.slice(), chest });
      }
    }
  }
}
