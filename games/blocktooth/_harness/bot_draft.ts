// BLOCKTOOTH v2 — gate-bot draft scoring for v2 cards and evolutions (FEATURES_V2 §7; lane L2).
//
// null = "no opinion": bot.ts botScoreUpgrade scores the card with its generic stat/trigger formula (every
// v2 base / unlockable card goes through that path unchanged — they are ordinary stat + trigger cards).
//
// Evolutions: the bot always takes a ready evolution when one is offered, as a player chasing the recipe
// would. The score sits above any ordinary card (the generic formula tops out around 40 for the strongest
// legendary mutations), so the choice is deterministic and independent of the rest of the offer.
// The bot never BANISHes or LOCKs (probe_sim's GATE 2 driver does not call them), so the gate measures the
// draft exactly as the loot stream deals it.

import type { World } from '../src/core/types.ts';
import { UPGRADE_BY_ID } from '../src/data/upgrades.ts';

/** Score that makes the bot take an offered evolution over any ordinary card. */
export const BOT_EVO_SCORE = 1000;

export function botDraftScore(w: World, id: string): number | null {
  const u = UPGRADE_BY_ID[id];
  if (!u) return null;
  if (u.evo) {
    // a stale offer could hold an evolution the titan can no longer take: never prefer it
    if ((w.upgrades.owned[id] ?? 0) > 0 || (u.titan && u.titan !== w.titanId)) return -1e9;
    return BOT_EVO_SCORE;
  }
  return null;
}
