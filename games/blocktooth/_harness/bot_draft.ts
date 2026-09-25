// BLOCKTOOTH v2 — gate-bot draft scoring for v2 cards and evolutions (FEATURES_V2 §7; lane L2, F1).
//
// null = "no opinion": bot.ts botScoreUpgrade scores the card with its generic stat/trigger formula (every
// v2 base / unlockable card goes through that path unchanged — they are ordinary stat + trigger cards).
//
// Evolutions: the bot always takes a ready evolution when one is offered, as a player chasing the recipe
// would. The score sits above any ordinary card (the generic formula tops out around 40 for the strongest
// legendary mutations), so the choice is deterministic and independent of the rest of the offer.
//
// F1 recipe preference (botRecipeBonus, added by bot.ts on top of the generic score): a player who sees the
// draft's recipe hint (upgrades/draft.ts recipeHint) leans toward a STARTED recipe — the bot adds
// BOT_RECIPE_TOWARD for a card that advances one and BOT_RECIPE_COMPLETES for the card that makes it
// ready. It never starts a recipe on purpose (a first half is taken only on its generic merit), so which
// evolutions a run gets still follows the loot stream. GATE 2 therefore measures evolution power.
// The bot never BANISHes or LOCKs (probe_sim's GATE 2 driver does not call them), so the gate measures the
// draft exactly as the loot stream deals it.

import type { World } from '../src/core/types.ts';
import { UPGRADE_BY_ID } from '../src/data/upgrades.ts';
import { recipeHint } from '../src/upgrades/draft.ts';

/** Score that makes the bot take an offered evolution over any ordinary card. */
export const BOT_EVO_SCORE = 1000;
/** F1: bonus for a card that advances a started recipe / that makes it ready. */
export const BOT_RECIPE_TOWARD = 14;
export const BOT_RECIPE_COMPLETES = 30;

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

/** F1: extra score for a card that advances a started evolution recipe (0 otherwise). */
export function botRecipeBonus(w: World, id: string): number {
  const h = recipeHint(w, id);
  if (!h) return 0;
  if (h.completes) return BOT_RECIPE_COMPLETES;
  return BOT_RECIPE_TOWARD;
}
